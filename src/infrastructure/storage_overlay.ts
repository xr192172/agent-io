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
import { reconcileOverlay, buildCandidates, buildEdgeCandidates, seedOverlayFromDsl, applyOverlay, statsLine, mergeDecisionsIntoOverlay } from '../domain/overlay.js';

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