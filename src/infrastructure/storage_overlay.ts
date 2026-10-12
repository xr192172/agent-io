/**
 * 设计层 overlay 持久化 + 合并入口
 *
 * 存储：<features>/<feature>.overlay.json（与 base 分离，base 可再生成，overlay 独立保留）
 * 入口：mergeDesignLayer(base) —— 读旧 overlay（无则从既有设计 DSL 一次性迁移），
 * 按稳定锚点 reconcile 到新 base，落盘 overlay，并把设计意图合回 base 返回。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getFeaturesDir, getDSL } from './storage.js';
import type { DesignDSL } from '../domain/types.js';
import type {
  DesignOverlay,
  ReconcileStats,
} from '../domain/overlay.js';
import { reconcileOverlay, buildCandidates, buildEdgeCandidates, seedOverlayFromDsl, applyOverlay, statsLine, mergeDecisionsIntoOverlay, mergeTagsIntoOverlay, mergeLifecycleIntoOverlay, hasAnchorPayload } from '../domain/overlay.js';

function getOverlayFile(feature: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getFeaturesDir(), `${feature}.overlay.json`);
}

/** 保存 overlay（权威写） */
export function saveOverlay(ov: DesignOverlay): string {
  const file = getOverlayFile(ov.feature);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ov, null, 2), 'utf-8');
  return file;
}

/** 读取 overlay，不存在返回 null */
export function loadOverlay(feature: string): DesignOverlay | null {
  const file = getOverlayFile(feature);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as DesignOverlay;
  } catch {
    return null;
  }
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
export function syncDecisionsToOverlay(
  feature: string,
  dsl: DesignDSL,
): { changed: boolean; written: number; cleared: number; file: string | null; notes: string[] } {
  const before = loadOverlay(feature);
  const ov: DesignOverlay = before ?? { version: 1, feature, anchors: {} };
  const r = mergeDecisionsIntoOverlay(ov, dsl);
  const a = JSON.stringify(before?.anchors ?? {});
  const b = JSON.stringify(r.overlay.anchors);
  if (a === b) return { changed: false, written: r.written, cleared: r.cleared, file: null, notes: r.notes };
  const file = saveOverlay(r.overlay);
  return { changed: true, written: r.written, cleared: r.cleared, file, notes: r.notes };
}

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
 * 合并设计层：base（新扫描结构）→ 读旧 overlay（或从既有设计 DSL 一次性迁移）
 * → reconcile 到新 base 锚点 → 落盘 overlay → 把设计意图合回 base。
 */
export function mergeDesignLayer(base: DesignDSL): MergeResult {
  const existing = loadOverlay(base.feature);
  const legacyDSL = getDSL(base.feature);
  let old: DesignOverlay;
  let seeded = false;
  if (existing) {
    old = existing;
  } else if (legacyDSL) {
    // 首次无 overlay 文件：从既有设计 DSL 迁移一次（以后不再走这里）
    old = seedOverlayFromDsl(legacyDSL);
    seeded = true;
  } else {
    old = { version: 1, feature: base.feature, anchors: {}, global: undefined };
  }

  const candidates = buildCandidates(base);
  const edgeCandidates = buildEdgeCandidates(base);
  const { overlay, stats } = reconcileOverlay(old, candidates, edgeCandidates);
  const file = saveOverlay(overlay);
  const dsl = applyOverlay(base, overlay);

  const message = [
    statsLine(stats),
    `overlay: ${file}`,
    seeded ? '（首次从既有设计 DSL 迁移铺底，之后只做增量对账）' : '',
  ].filter(Boolean).join(' · ');

  return { dsl, stats, seeded, message };
}