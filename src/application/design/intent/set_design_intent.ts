/**
 * set_design_intent —— 写设计意图到 overlay（缺口①③④ 的写入口，LLM 即消费方）
 *
 * 写两类意图（均可选，至少传一类）：
 *   · goals：全量替换 feature 的结构化目标/方向（OverlayGlobal.goals → applyOverlay 落进 base meta.goals）
 *   · edge_intents：按 base 边（id 或 from+to 匹配）挂/改「A 为何依赖 B」与边界归属，写进 overlay.edges
 *                   → applyOverlay 落进 base 边 intent
 *
 * overlay 是意图的权威存储（<feature>.overlay.json）；落完随即把意图 apply 回 base 并 saveDSL，
 * 让 get_dsl / serve 当下就读到，无需等下一次代码扫描再生。
 *
 * 与 base 再生对账：写前先用 buildCandidates/buildEdgeCandidates 把旧 overlay reconcile 到当前 base，
 * 保证 edges 键与 base 边 id 一致、被删边按孤儿暂存；此前孤儿、边重现时复原。
 */
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { loadOverlay, saveOverlay } from '../../../infrastructure/storage_overlay.js';
import {
  reconcileOverlay,
  buildCandidates,
  buildEdgeCandidates,
  seedOverlayFromDsl,
  applyOverlay,
} from '../../../domain/overlay.js';
import type { OverlayGoal, OverlayEdgeIntent } from '../../../domain/overlay.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** 单条边意图写入：id 优先，其次 from+to 匹配 base 边 */
export interface DesignEdgeIntentWrite {
  /** 目标 base 边 id（与 from/to 同时给时以 id 为准，from/to 作校验） */
  id?: string;
  /** 源节点 id（无 id 时用 from+to 定位边） */
  from?: string;
  /** 目标节点 id */
  to?: string;
  /** A 为何依赖 B */
  reason?: string;
  /** 边界归属 */
  boundary?: string;
  /**
   * ★ T332：**任务前置**（显式声明）—— 引**节点 id**，语义 = 这些节点须先 `progress === 'done'`，
   * 该边**源节点（from）**的源码才允许被 `write_gate` 落盘。
   * ★ 不传 = 不声明前置 = 永不拦（edge 默认装 import 依赖，**不等于**任务前置）；传空数组 = 显式解除已有前置。
   */
  requires?: string[];
  status?: 'open' | 'resolved';
}

export interface SetDesignIntentInput {
  feature: string;
  goals?: OverlayGoal[];
  edge_intents?: DesignEdgeIntentWrite[];
}

export interface SetDesignIntentResult {
  message: string;
  feature: string;
  goals: number;
  edges_written: Array<{ id: string; from: string; to: string }>;
  unmatched: Array<{ id?: string; from?: string; to?: string; reason?: string }>;
}

function setDesignIntentCore(input: SetDesignIntentInput): SetDesignIntentResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature "${input.feature}" 不存在`);

  // 读旧 overlay（无则从现有设计 DSL 一次性迁移铺底），再对账到当前 base
  const base = loadOverlay(input.feature) ?? seedOverlayFromDsl(dsl);
  const { overlay } = reconcileOverlay(base, buildCandidates(dsl), buildEdgeCandidates(dsl));

  // —— 目标：全量替换（空数组 = 清空展开式目标）——
  const goals = Array.isArray(input.goals) ? input.goals : undefined;
  if (goals) overlay.global = { ...(overlay.global ?? {}), goals };

  // —— 边意图：按 id / from+to 匹配 base 边挂载 ——
  const intents = Array.isArray(input.edge_intents) ? input.edge_intents : [];

  // ★★★ T332：**写路径校验（引用存在性）** —— `requires` 引的节点 id 必须在当前 base 里**真的存在**。
  //   ★ 与 T329 的 `scope` 那个坑（"只做语法校验、不校验引用存在性"）不同：`scope` 引的是**路径词**
  //     （全仓口径未统一 ⇒ 只能做语法校验）；而 `requires` 引的是 **base 节点 id**，id 就住在
  //     `dsl.geometry.nodes` / `dsl.semantic.files` 上 ⇒ ★ **这里能做、也真的做**存在性校验（不跳步）。
  //   ★ **不静默、不自动补节点、不降级放行**：非法 ⇒ 当场抛，且**一个字节都不落盘**（校验在 save 之前）。
  const nodeIds = new Set<string>([
    ...(dsl.geometry?.nodes ?? []).map((n) => n.id),
    ...(dsl.semantic?.files ?? []).map((f) => f.id),
  ]);
  const badRequires: Array<{ edge: string; missing: string[] }> = [];
  for (const it of intents) {
    if (!it.requires || it.requires.length === 0) continue;
    const missing = it.requires.filter((id) => !nodeIds.has(id));
    if (missing.length) badRequires.push({ edge: it.id || `${it.from}->${it.to}`, missing });
  }
  if (badRequires.length) {
    throw new Error(
      `拒绝写入（requires 引用不存在）：edge 的 \`requires\` 必须引**已存在的节点 id**` +
        `（id 住在 base 的 geometry.nodes / semantic.files 上）。\n` +
        badRequires.map((b) => `  · edge ${b.edge} 引了不存在的节点：${b.missing.join(', ')}`).join('\n') +
        `\n★ 怎么办：\n` +
        `  1. 用 \`get_dsl\`（或 design_intent 读侧）核对该 feature 里**真实的节点 id**，改对拼写；\n` +
        `  2. 若该节点还不存在，先用 \`import_project\` / \`edit_dsl\` 把它建成节点，再回来加 requires；\n` +
        `  3. ★ 本校验**不静默、不自动补节点、不降级放行** —— 要么改对 id，要么去掉该 requires。\n` +
        `★ 拦的范围（只此一条）：requires 里出现当前 feature base 上不存在的节点 id。`,
    );
  }

  const edges_written: SetDesignIntentResult['edges_written'] = [];
  const unmatched: SetDesignIntentResult['unmatched'] = [];
  if (intents.length > 0) {
    const byId = new Map((dsl.geometry?.edges ?? []).map((e) => [e.id, e]));
    const byPair = new Map((dsl.geometry?.edges ?? []).map((e) => [`${e.from}\u0000${e.to}`, e]));
    const changed: Record<string, OverlayEdgeIntent> = { ...(overlay.edges ?? {}) };
    for (const it of intents) {
      const edge = it.id ? byId.get(it.id) : it.from && it.to ? byPair.get(`${it.from}\u0000${it.to}`) : undefined;
      if (!edge) {
        unmatched.push({ id: it.id, from: it.from, to: it.to, reason: it.reason });
        continue;
      }
      const prev = changed[edge.id];
      changed[edge.id] = {
        from: edge.from,
        to: edge.to,
        reason: it.reason ?? prev?.reason,
        boundary: it.boundary ?? prev?.boundary,
        // ★ T332：任务前置 —— 显式传入即覆盖（含空数组=解除前置）；未传则沿用旧值（不静默清空）。
        requires: it.requires ?? prev?.requires,
        status: it.status ?? prev?.status,
      };
      // 此前孤儿、现在真相重现 → 复原（清孤儿标记）
      delete changed[edge.id].orphaned;
      delete changed[edge.id]._migratedFrom;
      edges_written.push({ id: edge.id, from: edge.from, to: edge.to });
    }
    if (intents.length) overlay.edges = changed;
  }

  // 有改动才落盘 + 落回 base（让 get_dsl 当下读到）
  const hasChange = goals !== undefined || intents.length > 0;
  if (hasChange) {
    saveOverlay(overlay);
    const merged = applyOverlay(dsl, overlay);
    saveDSL(merged, 'tool');
  }

  const parts: string[] = [`写入设计意图 · feature=${input.feature}`];
  if (goals) parts.push(`目标 ${goals.length} 条（全量替换）`);
  if (intents.length) parts.push(`边意图 ${edges_written.length}/${intents.length} 条（${edges_written.map((w) => w.id).join(',')}）`);
  if (unmatched.length) parts.push(`未匹配边 ${unmatched.length} 条（${unmatched.map((u) => u.id || `${u.from}->${u.to}`).join(',')}）`);
  if (!hasChange) parts.push('（未传 goals / edge_intents，无改动）');
  const msg = [...(unmatched.length ? ['[部分写入]'] : []), ...parts].join(' · ');

  return { message: msg, feature: input.feature, goals: goals?.length ?? 0, edges_written, unmatched };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: SetDesignIntentInput): Touched {
  // 只给作用域类 feature：本次写的是 **overlay + DSL 意图**（不是源文件）⇒ 不给 written_files。
  return { feature: input.feature };
}

export function setDesignIntent(input: SetDesignIntentInput): TouchedProduct<SetDesignIntentResult> {
  const r = setDesignIntentCore(input);
  return withTouched(r, touchedOf(input));
}