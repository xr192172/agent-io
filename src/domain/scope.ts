/**
 * scope.ts —— 「**圈定范围**」的唯一原语（2026-10-09，`docs/todo.md` T72）。
 *
 * ## 为什么需要它（用户口述的目标工作流）
 * *"可以**任意圈定项目范围**，然后重写……对比项目现状与设计，得到区别的地方，然后**分区域**将它重写。"*
 * ⇒ 这条链的第一跳是"**能指哪一片**"。实测（2026-10-09）**原料全在、接线全缺**：
 *   `sub_dsl`(子图) / `swimlane`(泳道) / `arch_layer`(架构层) / `layer`(层次) 四个分组轴
 *   **都住在数据模型里**（`geometry.ts:115/119/129/131/133`），但**只服务画布与查询过滤**
 *   （`get_dsl` 的 `layer`/`type`/`file_layer` 参数），**没有一条能当"作用域"传给下游**。
 *   ⇒ 本模块把那四个轴**接到一个统一的 `Scope` 上**，并给出**确定的**文件集合。
 *
 * ## 三条纪律（★ 第 1 条是它存在的全部意义）
 * 1. ★★★ **解析必须确定**：同一 `(dsl, scope)` 两次解析 ⇒ **逐字相同**。
 *    理由：下游要说"**这块我改过了 / 这块和设计一致**"，靠的就是"同一名字指向同一片"。
 *    非确定的区域（如按 LLM 聚类、按 hash 分桶）**不能**做这个 —— 那正是本仓 §6.2「族」论证过的形状。
 *    ⇒ 实现手段：本模块是**纯函数**；所有输出**排序**；不依赖时间 / 随机 / IO。
 * 2. ★★ **不许静默**：一切"没命中 / 被按规则跳过 / 有子图没下钻"都进 `notes`。
 *    （本仓最忌的"不该绿的绿"在作用域上的形态 = "框了一片，实际解析出 0 个文件，但不吭声"。）
 * 3. ★ **语法住一处**：`parseScope` 与 `formatScope` 是**互逆**的**唯一一对**；
 *    别处不许再写"怎么把 scope 写成一行"或"怎么读它"（第二份 = 判据分叉）。
 *
 * ## 紧凑文法（一行写完，人和 LLM 都好写）
 * ```
 * all                    整份 DSL（**顶层**；有子图也不下钻，见 notes）
 * layer:main             按职责层（main | error | detail）
 * swimlane:<id>          按泳道
 * arch_layer:<id>        按架构层（api / service / data / ui …）
 * subtree:<node_id>      该节点 + 其 contains 后代（**顶层内**）
 * subtree:<node_id>!     同上，且**下钻子图**（`!` = 含 sub_dsl 里的后代）
 * nodes:<id>,<id>,…      显式点名单个节点
 * files:<p1>,<p2>,…      按**仓库相对路径**；以 `/` 结尾者按**前缀**匹配
 * ```
 */
import type { DesignDSL } from './types.js';
import type { Node, NodeLayer } from './geometry.js';

/** 圈定范围的表达（★ 只表达"哪一片"，不表达"要做什么"——后者是下游的事） */
export type Scope =
  | { kind: 'all' }
  | { kind: 'layer'; value: NodeLayer }
  | { kind: 'swimlane'; value: string }
  | { kind: 'arch_layer'; value: string }
  | { kind: 'subtree'; node_id: string; include_descent: boolean }
  | { kind: 'nodes'; node_ids: string[] }
  | { kind: 'files'; patterns: string[] };

export interface ResolvedScope {
  scope: Scope;
  /** 命中节点 id（**已排序**） */
  node_ids: string[];
  /** 其中是"文件节点"的那些（= `semantic.files` 里的 id） */
  file_ids: string[];
  /** 文件节点的仓库相对路径（**已排序**；这就是下游"重写"的作用面） */
  paths: string[];
  /** ★ 一切没命中 / 被跳过 / 没下钻的说明 —— **不许静默** */
  notes: string[];
}

const LAYERS: readonly NodeLayer[] = ['main', 'error', 'detail'];

/** 把路径写成**唯一规范形**（`\`→`/`、去前导 `./`）—— 匹配与输出都用它，避免两种写法各判一次 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

const uniqSorted = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/**
 * 解析一行 scope 文本 ⇒ `Scope`（★ 与 {@link formatScope} 互逆）。
 * ★ 解析不出来就**抛错并给出文法**——不返回"空范围"（那会被下游读成"这片没有要改的"）。
 */
export function parseScope(text: string): Scope {
  const s = (text ?? '').trim();
  if (s === '' || s === 'all') return { kind: 'all' };
  const at = s.indexOf(':');
  const head = at < 0 ? s : s.slice(0, at);
  const body = at < 0 ? '' : s.slice(at + 1).trim();
  const need = (what: string): string => {
    if (!body) throw new Error(`scope "${s}" 缺参数：${head}:<${what}>。文法见 src/domain/scope.ts 头部注释。`);
    return body;
  };
  switch (head) {
    case 'layer': {
      const v = need('main|error|detail');
      if (!LAYERS.includes(v as NodeLayer)) throw new Error(`scope layer 只接受 ${LAYERS.join(' | ')}，收到 "${v}"`);
      return { kind: 'layer', value: v as NodeLayer };
    }
    case 'swimlane': return { kind: 'swimlane', value: need('泳道 id') };
    case 'arch_layer': return { kind: 'arch_layer', value: need('架构层 id，如 api/service/data/ui') };
    case 'subtree': {
      const raw = need('node_id，可加尾缀 ! 表示下钻子图');
      const include_descent = raw.endsWith('!');
      const node_id = include_descent ? raw.slice(0, -1) : raw;
      if (!node_id) throw new Error(`scope "${s}"：subtree 的 node_id 为空`);
      return { kind: 'subtree', node_id, include_descent };
    }
    case 'nodes': {
      const ids = need('逗号分隔的节点 id').split(',').map((x) => x.trim()).filter(Boolean);
      if (!ids.length) throw new Error(`scope "${s}"：nodes 列表为空`);
      return { kind: 'nodes', node_ids: uniqSorted(ids) };
    }
    case 'files': {
      const ps = need('逗号分隔的路径，以 / 结尾者按前缀匹配').split(',').map((x) => normPath(x.trim())).filter(Boolean);
      if (!ps.length) throw new Error(`scope "${s}"：files 列表为空`);
      return { kind: 'files', patterns: uniqSorted(ps) };
    }
    default:
      throw new Error(`未知 scope 种类 "${head}"。可用：all / layer: / swimlane: / arch_layer: / subtree: / nodes: / files:`);
  }
}

/** `Scope` ⇒ 规范一行（★ **下游"块的稳定命名"就用它** —— 同一片任何时候都写同一个名字） */
export function formatScope(scope: Scope): string {
  switch (scope.kind) {
    case 'all': return 'all';
    case 'layer': return `layer:${scope.value}`;
    case 'swimlane': return `swimlane:${scope.value}`;
    case 'arch_layer': return `arch_layer:${scope.value}`;
    case 'subtree': return `subtree:${scope.node_id}${scope.include_descent ? '!' : ''}`;
    case 'nodes': return `nodes:${uniqSorted(scope.node_ids).join(',')}`;
    case 'files': return `files:${uniqSorted(scope.patterns).join(',')}`;
  }
}

/** 沿 `contains` 边走出的后代（**在给定节点集内**；`ids` 用 id 判存在） */
function descendantsOf(ids: ReadonlySet<string>, edges: readonly { from: string; to: string; label?: string }[], root: string): string[] {
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (e.label !== 'contains') continue;
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
  }
  const seen = new Set<string>([root]);
  const out: string[] = [root];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const k of (kids.get(cur) ?? []).slice().sort()) {
      if (seen.has(k)) continue;
      seen.add(k); out.push(k); stack.push(k);
    }
  }
  return out;
}

/**
 * ★★ 解析 scope ⇒ **确定的**节点/文件集合（纯函数；见文件头纪律 1）。
 * ★ 顶层图与子图（`sub_dsl`）分开处理：默认只在**顶层**里解析；只有 `subtree:<id>!` 才下钻，
 *   且**下钻了会写进 notes**（否则"框了一片却少了一半"是静默的）。
 */
export function resolveScope(dsl: DesignDSL, scope: Scope): ResolvedScope {
  const nodes: Node[] = dsl.geometry?.nodes ?? [];
  const edges = dsl.geometry?.edges ?? [];
  const semFiles = dsl.semantic?.files ?? [];
  const semById = new Map(semFiles.map((f) => [f.id, f]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const notes: string[] = [];

  const nestedCount = nodes.filter((n) => n.sub_dsl).length;

  let picked: string[];
  switch (scope.kind) {
    case 'all':
      picked = nodes.map((n) => n.id);
      break;
    case 'layer':
      picked = nodes.filter((n) => n.layer === scope.value).map((n) => n.id);
      if (!picked.length) notes.push(`scope layer:${scope.value} **没命中任何节点**（该层为空）`);
      break;
    case 'swimlane': {
      picked = nodes.filter((n) => n.swimlane === scope.value).map((n) => n.id);
      if (!picked.length) {
        const lanes = (dsl.geometry?.swimlanes ?? []).map((s) => s.id).sort();
        notes.push(`scope swimlane:${scope.value} **没命中任何节点**；本 DSL 的泳道有 [${lanes.join(', ') || '（无）'}]`);
      }
      break;
    }
    case 'arch_layer': {
      picked = nodes.filter((n) => n.arch_layer === scope.value || semById.get(n.id)?.layer === scope.value).map((n) => n.id);
      if (!picked.length) {
        const have = uniqSorted(nodes.map((n) => n.arch_layer ?? semById.get(n.id)?.layer).filter((x): x is string => !!x));
        notes.push(`scope arch_layer:${scope.value} **没命中任何节点**；本 DSL 出现过的架构层 [${have.join(', ') || '（无）'}]`);
      }
      break;
    }
    case 'subtree': {
      if (!byId.has(scope.node_id)) {
        // ★ 抛错而不是"空范围"：框错了对象必须当场知道，不能悄悄变成"这片没东西要改"
        throw new Error(`scope subtree: 节点 "${scope.node_id}" 不存在（本 DSL 共 ${nodes.length} 个节点）`);
      }
      const topIds = new Set(nodes.map((n) => n.id));
      picked = descendantsOf(topIds, edges, scope.node_id);
      const n = byId.get(scope.node_id)!;
      if (n.sub_dsl) {
        const inner = n.sub_dsl.geometry?.nodes?.length ?? 0;
        if (scope.include_descent) {
          const innerIds = (n.sub_dsl.geometry?.nodes ?? []).map((x) => x.id);
          picked = uniqSorted([...picked, ...innerIds]);
          notes.push(`已下钻子图：节点 ${scope.node_id} 的 sub_dsl 另有 ${inner} 个节点，**已并入**（其 id 与顶层同一命名空间，未命名空间隔离）`);
        } else {
          notes.push(`节点 ${scope.node_id} 有子图（sub_dsl，${inner} 个节点）**未下钻**；要并入请用 subtree:${scope.node_id}!`);
        }
      }
      break;
    }
    case 'nodes': {
      const miss = scope.node_ids.filter((id) => !byId.has(id));
      if (miss.length) notes.push(`scope nodes: 以下 id **不存在，已忽略**：${miss.join(', ')}`);
      picked = scope.node_ids.filter((id) => byId.has(id));
      if (!picked.length) notes.push('scope nodes: **一个都没命中**（全部 id 都不存在）');
      break;
    }
    case 'files': {
      const hits: string[] = [];
      for (const f of semFiles) {
        const p = normPath(f.path);
        if (scope.patterns.some((pat) => (pat.endsWith('/') ? p.startsWith(pat) : p === pat))) hits.push(f.id);
      }
      if (!hits.length) notes.push(`scope files: **没命中任何文件**；本 DSL 有 ${semFiles.length} 个文件，例如 ${semFiles.slice(0, 3).map((f) => normPath(f.path)).join(', ')}${semFiles.length > 3 ? ' …' : ''}`);
      picked = hits;
      break;
    }
  }

  const nodeIds = uniqSorted(picked);
  const fileIds = nodeIds.filter((id) => semById.has(id));
  const nonFile = nodeIds.length - fileIds.length;
  if (nonFile > 0 && scope.kind !== 'all') {
    notes.push(`命中 ${nodeIds.length} 个节点，其中 ${nonFile} 个**不是文件节点**（目录/模块等）⇒ 作用面只取 ${fileIds.length} 个文件`);
  }
  if (nodes.length && nestedCount && scope.kind === 'all') {
    notes.push(`顶层有 ${nestedCount} 个节点带子图（sub_dsl）—— 本 scope **不下钻**（子图节点不在此列）`);
  }
  if (nodeIds.length === 0) {
    // ★★ 解析出空集**必须显式说出来**：这类"看起来框住了、其实什么也没有"是最危险的静默失败
    notes.push('★★ 本 scope 解析出的**节点集为空** ⇒ 作用面为空。**别把它当成"这片没问题"**。');
  }

  return {
    scope,
    node_ids: nodeIds,
    file_ids: uniqSorted(fileIds),
    paths: uniqSorted(fileIds.map((id) => normPath(semById.get(id)!.path))),
    notes,
  };
}

/** 便捷：一行文本 ⇒ 解析好的作用面（`parseScope` + `resolveScope`） */
export function resolveScopeText(dsl: DesignDSL, text: string): ResolvedScope {
  return resolveScope(dsl, parseScope(text));
}
