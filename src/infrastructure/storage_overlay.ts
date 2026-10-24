/**
 * 设计层 overlay 持久化 + 合并入口
 *
 * ★★ 2026-10-23（overlay 并入设计册）：**overlay 不再是独立文件**。
 *   运行时状态（status/progress/stale/lifecycle）就住在设计册的 `nodes[].overlay`，
 *   全局件（title/theme/goals…）住在册上的 `overlay_global` —— 与设计意图同一个文件、同一个写手
 *   （`saveDesignSheet`，带写闸 + 事务重定向）。
 *   旧 `<features>/<f>.overlay.json` 已退役；`loadOverlay`/`saveOverlay` 接口不变，只换存储。
 */
import { getDesignSheet, saveDesignSheet } from './storage.js';
import type { DesignDSL } from '../domain/types.js';
import type {
  DesignOverlay,
  OverlayAnchor,
  OverlayGlobal,
  ReconcileStats,
} from '../domain/overlay.js';
import { reconcileOverlay, buildCandidates, buildEdgeCandidates, seedOverlayFromDsl, applyOverlay, statsLine, mergeTagsIntoOverlay, mergeLifecycleIntoOverlay, hasAnchorPayload } from '../domain/overlay.js';

/** 保存 overlay（权威写）。设计册不存在 ⇒ **抛**（绝不静默建册）。 */
export function saveOverlay(ov: DesignOverlay): string {
  const dsl = getDesignSheet(ov.feature);
  if (!dsl) throw new Error(`saveOverlay：设计册不存在（${ov.feature}）⇒ 先经 manage_feature create / import_project 建册，overlay 不再独立落盘（2026-10-23 并入设计册）`);
  const nodes = dsl.geometry?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const [id, a] of Object.entries(ov.anchors ?? {})) {
    const n = byId.get(id);
    // ★ 孤儿不静默丢：写侧拿到册上没有的锚点 id ⇒ 抛（合法流不会走到这 —— reconcile 先对过账）
    if (!n) throw new Error(`saveOverlay：锚点 "${id}" 在设计册（${ov.feature}）里没有对应节点 ⇒ 拒写（孤儿要人看，不许静默丢）`);
    n.overlay = a;
  }
  // overlay 里有、循环里没碰到的节点（即被 prune 掉的锚点）⇒ 清掉节点上的旧 overlay
  for (const n of nodes) {
    if (n.overlay && !(n.id in (ov.anchors ?? {}))) delete n.overlay;
  }
  (dsl as unknown as { overlay_global?: OverlayGlobal }).overlay_global = ov.global;
  return saveDesignSheet(dsl); // ★ 带写闸（assertDslWriteAllowed）+ 事务重定向（txnRedirect）
}

/** 读取 overlay，不存在返回 null。读端唯一：从设计册的 `nodes[].overlay` + `overlay_global` 现算。 */
export function loadOverlay(feature: string): DesignOverlay | null {
  const dsl = getDesignSheet(feature); // ← 走设计册（已受事务重定向）
  if (!dsl) return null;
  const anchors: Record<string, OverlayAnchor> = {};
  for (const n of dsl.geometry?.nodes ?? []) if (n.overlay) anchors[n.id] = n.overlay;
  const global = (dsl as unknown as { overlay_global?: OverlayGlobal }).overlay_global;
  if (!Object.keys(anchors).length && !global) return null;
  return { version: 1, feature, anchors, ...(global ? { global } : {}) };
}

export interface MergeResult {
  dsl: DesignDSL;
  stats: ReconcileStats;
  /** 是否有 overlay 参与（首次可能为空 overlay） */
  seeded: boolean;
  message: string;
}

/**
 * ★★★ 把 base 上的**决策卡**同步进 overlay，并落盘（2026-10-09，`docs/todo.md` T75）。
 *
 * ## 为什么要有这个入口（实测病灶）
 * `edit_dsl` 以前只写 base，而 `import_project` 会**重建 base** ⇒
 * **人写的决策卡（含 `acceptance`/`expectations`）一重建就丢** —— 与 overlay 存在的全部理由矛盾
 * （"base 可再生成，overlay 独立保留"）。⇒ 每次改完 base，**当场把决策同步过去**。
 *
 * ★ **纯搬运在 `domain/overlay.ts` 的 `mergeDecisionsIntoOverlay`**（那里可测、无 IO）；
 *   本函数只负责 **读旧的 + 落盘 + 报账**（IO 住 infrastructure，是本仓分层）。
 * ★ **没有变化就不写盘**（避免无谓 churn 与 mtime 抖动）。
 * ★ 返回 `changed=false` 时**不要**把它当成"失败了" —— 那是"本来就已经同步过"。
 */
// ★★★ 2026-10-19（设计只住一处）：syncDecisionsToOverlay **已删除** ——
//   它是"把 decision 从 base 同步进 overlay"的 IO 入口，正是"写两处"的另一半。
//   decision 只住 design/，由 edit_dsl 直接写；overlay 不再需要"决策同步"。

/**
 * ★★★ 把 base 上的**功能标记**（`meta.function_tags`）同步进 `overlay.global.function_tags` 并落盘
 * （2026-10-09，功能标记 MVP）。
 *
 * ★ **纯搬运在 `domain/overlay.ts` 的 `mergeTagsIntoOverlay`**（那里可测、无 IO）；
 *   本函数只负责 **读旧的 + 落盘 + 报账**（IO 住 infrastructure，是本仓分层）。
 * ★ **没有变化就不写盘**（避免无谓 churn 与 mtime 抖动）。
 * ★ 返回 `changed=false` 时**不要**把它当成"失败了" —— 那是"本来就已经同步过"。
 */
export function syncTagsToOverlay(
  feature: string,
  dsl: DesignDSL,
): { changed: boolean; written: number; cleared: boolean; file: string | null } {
  const before = loadOverlay(feature);
  const ov: DesignOverlay = before ?? { version: 1, feature, anchors: {} };
  const r = mergeTagsIntoOverlay(ov, dsl);
  const a = JSON.stringify(before?.global?.function_tags ?? null);
  const b = JSON.stringify(r.overlay.global?.function_tags ?? null);
  if (a === b) return { changed: false, written: r.written, cleared: r.cleared, file: null };
  const file = saveOverlay(r.overlay);
  return { changed: true, written: r.written, cleared: r.cleared, file };
}

/**
 * ★★★ 把 base 上的**文件生命周期**（`semantic.files[].lifecycle`）同步进 overlay 锚点并落盘
 * （T182，2026-10-11）。
 *
 * ## 为什么必须有（与 T75 的决策卡、T100 的功能标记**同款病灶**）
 * `import_project` 的显式重建（`rebuild_design=true`）**整个替换 base**（`:1066` 逐字
 * "真相刷新只替换 base"）⇒ ★ 只写在 base 的 `deprecated`（**待删标记**）**一重建就丢**。
 * ★ 且它是**静默**丢的：同一段重建代码已有 `allow_design_drop` 闸，但判据只覆盖
 * "**扫描产不出的节点**"（非 `file_`/`dir_`/`doc_` 前缀）—— 而待删标记恰恰标在
 * **扫描产出**的文件节点上 ⇒ **不报、不拦**（`docs/todo.md` §2.3「不报错的错」）。
 *
 * ★ 纯搬运在 `domain/overlay.ts` 的 `mergeLifecycleIntoOverlay`（可测、无 IO）；
 *   本函数只负责 **读旧的 + 落盘 + 报账**（IO 住 infrastructure，是本仓分层）。
 * ★ **没有变化就不写盘**（避免无谓 churn 与 mtime 抖动）。
 * ★ 返回 `changed=false` 时**不要**把它当成"失败了" —— 那是"本来就已经同步过"。
 */
export function syncLifecycleToOverlay(
  feature: string,
  dsl: DesignDSL,
): { changed: boolean; written: number; cleared: number; file: string | null; notes: string[] } {
  const before = loadOverlay(feature);
  const ov: DesignOverlay = before ?? { version: 1, feature, anchors: {} };
  const r = mergeLifecycleIntoOverlay(ov, dsl);
  // ★ 只比**生命周期那一半**：否则"同一次调用里决策也变了"会被误算成本函数改了东西。
  const pick = (a: DesignOverlay | null) =>
    JSON.stringify(
      Object.entries(a?.anchors ?? {})
        .filter(([, v]) => v.lifecycle)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, v.lifecycle]),
    );
  if (pick(before) === pick(r.overlay)) {
    return { changed: false, written: r.written, cleared: r.cleared, file: null, notes: r.notes };
  }
  const file = saveOverlay(r.overlay);
  return { changed: true, written: r.written, cleared: r.cleared, file, notes: r.notes };
}

/**
 * ★★★ **显式清掉某个锚点上的文件生命周期**（T185，2026-10-12）—— 供**归档工具**在终态调用。
 *
 * ## 为什么不能靠 `syncLifecycleToOverlay` 顺手清（即：为什么必须有个"显式"入口）
 * T182b 立的规矩是「**文件不在 base ⇒ 墓碑，不清**」，因为"文件不在 base"**可能是**
 * "代码先删了、等着走③归档"—— 那时标记**必须留着**（它就是②的信号）。
 * ⇒ 所以同一个"文件不在 base"的状态**有两种含义**，`syncLifecycleToOverlay` **分不出来**
 *   —— ★ 而**归档工具分得出**（是它自己把文件从 DSL 里摘掉的）。
 * ⇒ ⇒ **谁摘掉的文件，谁负责清这笔意图**（这是本仓一贯的"动作方负责收口"）。
 *
 * ★ 不清的后果（真实存在，不是假想）：归档后 overlay 仍留着这笔 `deprecated`，
 *   而 T184b 说②看不到它（②只迭代 `semantic.files`）⇒ ★ **一个谁都看不见的僵尸**。
 *
 * ★ 没有变化就不写盘；返回 `changed=false` = "本来就没有"，**不是失败**。
 */
export function dropLifecycleFromOverlay(
  feature: string,
  fileId: string,
): { changed: boolean; file: string | null } {
  const before = loadOverlay(feature);
  if (!before) return { changed: false, file: null };
  const a = before.anchors[fileId];
  if (!a?.lifecycle) return { changed: false, file: null };

  const anchors = { ...before.anchors };
  const next = { ...a };
  delete next.lifecycle;
  // ★ 与 `hasAnchorPayload` 同一条纪律：删完只剩 path/kind ⇒ 这个锚点没了意义，prune 掉
  delete anchors[fileId];
  if (hasAnchorPayload(next)) anchors[fileId] = next;

  const file = saveOverlay({ ...before, anchors });
  return { changed: true, file };
}

/**
 * 合并设计层：base（新扫描结构）→ 读旧 overlay → reconcile 到新 base 锚点
 * → 把设计意图（含 stamp 好的 `nodes[].overlay`）合回 base 返回。
 *
 * ★★ 2026-10-23（overlay 并入设计册）：**这里不再独立落盘 overlay** ——
 *   `applyOverlay` 会把 reconcile 后的锚点 stamp 到 `nodes[].overlay`（含 `overlay_global`），
 *   调用方（import_project）紧接着 `saveDSL(designDsl)` 一次性落盘。
 *   ★ 为什么不能保留原来的 `saveOverlay(overlay)`：fork 首次导入时设计册**还不存在**
 *     （merge 在 saveDSL 之前跑）⇒ 按新语义会抛「设计册不存在」—— 顺序雷。
 *     而 rebuild 场景它写的也是**旧册**，马上会被新册整个覆盖 —— 纯属多余一笔。
 */
export function mergeDesignLayer(base: DesignDSL): MergeResult {
  const existing = loadOverlay(base.feature);
  const legacyDSL = getDesignSheet(base.feature);
  let old: DesignOverlay;
  let seeded = false;
  if (existing) {
    old = existing;
  } else if (legacyDSL) {
    // 首次无 overlay：从既有设计 DSL 迁移一次（以后不再走这里）
    old = seedOverlayFromDsl(legacyDSL);
    seeded = true;
  } else {
    old = { version: 1, feature: base.feature, anchors: {}, global: undefined };
  }

  const candidates = buildCandidates(base);
  const edgeCandidates = buildEdgeCandidates(base);
  const { overlay, stats } = reconcileOverlay(old, candidates, edgeCandidates);
  const dsl = applyOverlay(base, overlay);

  const message = [
    statsLine(stats),
    `overlay：已并入设计册（${Object.keys(overlay.anchors ?? {}).length} 锚点 · 随 saveDSL 落盘）`,
    seeded ? '（首次从既有设计 DSL 迁移铺底，之后只做增量对账）' : '',
  ].filter(Boolean).join(' · ');

  return { dsl, stats, seeded, message };
}