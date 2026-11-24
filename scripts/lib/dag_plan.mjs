#!/usr/bin/env node
/**
 * dag_plan.mjs —— S-1 施工/验证/收口流水线 DAG 编排内核（§13.6 S-1 / §13.11 S 线范围扩）。
 *
 * ## 它是什么
 * 把一道批施工拆成显式节点：施工 part → per-part smoke → 阶段末全量 → 收口 commit；
 * 验证门同样是节点。**边 = 显式 needs 依赖**（不靠数组顺序隐式约定）。调度器按能力表
 * （gate_caps）分派并发槽 / 写面互斥；本模块只做**结构与判据**：建图、环检测、依赖不裁剪、
 * 拓扑分层、三态 verdict 聚合，不自己跑子进程（执行归 exec_slots / verify.mjs）。
 *
 * ## 纪律（fail-closed）
 * · 环 / 未知依赖引用 ⇒ validate 点名问题，不产出可执行层序。
 * · 依赖边**原样保留**：分层与并发分组不得裁剪 needs；缺依赖的节点不提前放行。
 * · 写面节点同一层只准一个（互斥串行）；同层出现多个写面 ⇒ 问题留痕，调度方降级串行。
 * · 三态 verdict：PASS / FAIL / SKIP；未跑 / unsupported / unknown 单列 unrun，
 *   **不进通过计数**（SKIP 不折 PASS）。
 *
 * ## 边界（一期）
 * · 现役 verify.mjs 17 门编排暂保持串行调用；本内核先就位结构与把守，现役门间依赖边
 *   接线留后续批探针标定并发安全后接入。
 * · 并发度数由 S-6 档位传入；本模块不冻结阈值。
 */

import { capOf, isWriteCap, isConcurrentRead } from './gate_caps.mjs';

/** 节点类型（与 exec_slots.PART_KIND 对齐；验证门用 verify-scoped/verify-full）。 */
export const NODE_KIND = Object.freeze({
  BUILD_PART: 'build-part',
  SMOKE_PART: 'smoke-part',
  VERIFY_SCOPED: 'verify-scoped',
  VERIFY_FULL: 'verify-full',
  COMMIT: 'commit',
  BACKGROUND: 'background',
  MUTATION: 'mutation',
});

/**
 * @typedef {Object} DagNode
 * @property {string} id 节点唯一标识
 * @property {string} kind 节点类型（NODE_KIND.*）
 * @property {string} [label] 人读标签
 * @property {string[]} needs 显式依赖节点 id（边 = 依赖）
 * @property {string} [gateName] 若对应 verify 门，门名（用于查 gate_caps 能力）
 * @property {object} [cap] 显式能力覆盖（缺省按 gateName 查 gate_caps）
 */

/** 建一张空 DAG。 */
export function createDag() {
  /** @type {Map<string, DagNode>} */
  const nodes = new Map();
  return { nodes };
}

/**
 * 登记一个节点；重复 id 抛错（同一意图两处登记 = 病根）。
 * @param {ReturnType<typeof createDag>} dag
 * @param {DagNode} node
 */
export function addNode(dag, node) {
  if (!node?.id) throw new Error('DAG 节点必须有 id');
  if (dag.nodes.has(node.id)) throw new Error(`DAG 节点重复登记：${node.id}`);
  dag.nodes.set(node.id, { needs: [], ...node });
  return dag;
}

/** 取节点能力：显式 cap 优先，否则按 gateName 查 gate_caps（未登记保守写面串行）。 */
export function nodeCap(node) {
  if (node.cap) return node.cap;
  return capOf(node.gateName ?? node.id);
}

/** 环检测（DFS 三色）。返回环上节点 id 数组；空 = 无环。 */
export function detectCycle(dag) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  /** @type {Map<string, number>} */
  const color = new Map([...dag.nodes.keys()].map((id) => [id, WHITE]));
  /** @type {string[]} */
  const stack = [];

  const dfs = (id) => {
    color.set(id, GRAY);
    stack.push(id);
    const node = dag.nodes.get(id);
    for (const dep of node?.needs ?? []) {
      if (!dag.nodes.has(dep)) continue; // 未知引用由 validate 另报
      const c = color.get(dep);
      if (c === GRAY) return [...stack.slice(stack.indexOf(dep)), dep];
      if (c === WHITE) {
        const cyc = dfs(dep);
        if (cyc) return cyc;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  };

  for (const id of dag.nodes.keys()) {
    if (color.get(id) === WHITE) {
      const cyc = dfs(id);
      if (cyc) return cyc;
    }
  }
  return [];
}

/**
 * 校验 DAG 结构。返回问题数组；空 = 通过。
 * 问题码：DAG_DUP_ID / DAG_UNKNOWN_DEP / DAG_CYCLE / DAG_WRITE_SAME_LAYER。
 * @param {ReturnType<typeof createDag>} dag
 */
export function validateDag(dag) {
  const problems = [];

  for (const [id, node] of dag.nodes) {
    for (const dep of node.needs ?? []) {
      if (!dag.nodes.has(dep)) {
        problems.push({ code: 'DAG_UNKNOWN_DEP', msg: `节点「${id}」依赖未登记节点「${dep}」` });
      }
    }
  }

  const cycle = detectCycle(dag);
  if (cycle.length) {
    problems.push({ code: 'DAG_CYCLE', msg: `依赖成环：${cycle.join(' → ')}` });
  }

  if (problems.length) return { problems, layers: [], order: [] };

  const layers = topoLayers(dag);
  // 同层写面互斥：同层出现 ≥2 个写面 ⇒ 须串行，不能同窗并发。
  for (const layer of layers) {
    const writes = layer.filter((id) => isWriteCap(nodeCap(dag.nodes.get(id))));
    if (writes.length > 1) {
      problems.push({
        code: 'DAG_WRITE_SAME_LAYER',
        msg: `同层多个写面节点须串行互斥：${writes.join('、')}（不得同窗并发）`,
      });
    }
  }

  return { problems, layers, order: layers.flat() };
}

/**
 * Kahn 拓扑分层：无依赖的节点在第 0 层；层 = 1 + 最大依赖层。
 * 依赖边原样保留，不裁剪。
 * @param {ReturnType<typeof createDag>} dag
 * @returns {string[][]}
 */
export function topoLayers(dag) {
  const indeg = new Map([...dag.nodes.keys()].map((id) => [id, 0]));
  const dependents = new Map([...dag.nodes.keys()].map((id) => [id, []]));
  for (const [id, node] of dag.nodes) {
    for (const dep of node.needs ?? []) {
      if (!dag.nodes.has(dep)) continue;
      indeg.set(id, (indeg.get(id) ?? 0) + 1);
      dependents.get(dep)?.push(id);
    }
  }
  let frontier = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const layers = [];
  const placed = new Set();
  while (frontier.length) {
    layers.push([...frontier].sort());
    for (const id of frontier) placed.add(id);
    const next = [];
    for (const id of frontier) {
      for (const dep of dependents.get(id) ?? []) {
        indeg.set(dep, (indeg.get(dep) ?? 1) - 1);
        if ((indeg.get(dep) ?? 0) === 0 && !placed.has(dep)) next.push(dep);
      }
    }
    frontier = [...new Set(next)];
  }
  return layers;
}

/** 节点可否入并发槽（只读 + cpu 池）。 */
export function canConcurrentlyRun(node) {
  return isConcurrentRead(nodeCap(node));
}

/**
 * 三态 verdict 聚合。
 * @param {Map<string, {state?: string}>} results 节点 id → 结果（state: PASS/FAIL/SKIP/未定义）
 * @returns {{pass:number, fail:number, skip:number, unrun:number, total:number, passCountable:number}}
 *   passCountable = pass；SKIP / unrun 不计入通过计数。
 */
export function aggregateVerdict(results) {
  const out = { pass: 0, fail: 0, skip: 0, unrun: 0, total: 0, passCountable: 0 };
  for (const r of results.values()) {
    out.total += 1;
    switch (r?.state) {
      case 'PASS': out.pass += 1; out.passCountable += 1; break;
      case 'FAIL': out.fail += 1; break;
      case 'SKIP': out.skip += 1; break;
      default: out.unrun += 1; // 未跑 / unsupported / unknown 单列，不折 PASS
    }
  }
  return out;
}
