/**
 * ProjectView —— 「一处算出来、多处取用」的项目视图（规划书 §17.5 / §19 的第 ① 步）
 *
 * ★ 为什么要有它（实测，不是设想）：
 *   「这个项目有哪些源码文件」这个问题在 `src/` 下被 walk 了 **29 处**
 *   （`walkSourceFiles` 15 处 + `feature_map.scanSourceFiles` 6 处 + `observe/instrument.collectTsFiles` 8 处
 *   + `monolith.ts` 一个同名遮蔽的 walker），**每次调用重新 walk 一遍**。
 *   本模块是这一层的**唯一落点**：取一次 → 缓存住 → 多处取用。
 *
 * ★★ 诚实标注缓存机制 —— **这不是"内容指纹"，别那么叫**：
 *   真正的"内容指纹"必须先遍历整棵树才能算出来，而那本身就等于 walk 了一次，毫无意义。
 *   所以这里是 **TTL 缓存（默认 5s，与仓内 `staleIndexWarning` 同一约定）+ 显式失效**：
 *     · 要精确失效 ⇒ 调 `invalidateProjectView(root)`（写工具落盘后应当调）
 *     · 想知道"到底算了几次" ⇒ 调 `projectViewStats()`（**测试靠它断言"只算一次"**）
 *   ⚠️ 边界：TTL 内磁盘变了它**不知道**。所以它服务的是"同一轮工作里的多次取用"，
 *      **不是**"跨轮的新鲜度保证"（后者由 `staleIndexWarning` / `ensureProjectIndex` 负责）。
 *
 * ★ 依赖方向：[A] 层原语（`refs_text.walkSourceFiles` + 内核判据）→ 本层（缓存）→ 消费者。
 *   本模块**不 import 任何消费者**（避免成环）。
 */

import { walkSourceFiles } from './text/refs_text.js';

export interface ProjectView {
  /** 项目根（绝对路径，已 resolve） */
  root: string;
  /** 源码文件（**相对 root**、`/` 分隔）—— 本次视图的 [A] 层数据 */
  sourceFiles: readonly string[];
  /** 这份视图的生成时刻（ms） */
  computedAt: number;
  /** 是否命中缓存 */
  fromCache: boolean;
}

export interface ProjectViewOptions {
  /** 缓存存活时长（ms）。默认 5000，与仓内 `staleIndexWarning` 的 5s 约定一致 */
  ttlMs?: number;
}

/** 默认 TTL：与 `staleIndexWarning` 同一约定（5s）——刻意用同一数字，避免出现"第二套时间约定" */
export const PROJECT_VIEW_TTL_MS = 5000;

const _cache = new Map<string, ProjectView>();
/** ★ 真实 walk 次数（**测试判据**：同一进程重复取同一个 root，只应为 1） */
const _walks = new Map<string, number>();
let _hits = 0;

/**
 * 取某个项目的视图。同一进程内 **TTL 内重复取只 walk 一次**。
 * @param root 项目根（会 resolve）
 */
export function getProjectView(root: string, opts: ProjectViewOptions = {}): ProjectView {
  const key = String(root);
  const ttl = opts.ttlMs ?? PROJECT_VIEW_TTL_MS;
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.computedAt < ttl) {
    _hits += 1;
    return { ...hit, fromCache: true };
  }
  const files = walkSourceFiles(key);
  _walks.set(key, (_walks.get(key) ?? 0) + 1);
  const view: ProjectView = { root: key, sourceFiles: files, computedAt: now, fromCache: false };
  _cache.set(key, view);
  return view;
}

/** 显式失效（不带 root = 清全部）。**写工具落盘后应当调**，否则 TTL 内读到的是旧的视图 */
export function invalidateProjectView(root?: string): void {
  if (root === undefined) _cache.clear();
  else _cache.delete(String(root));
}

/** 观测：真实 walk 次数 / 命中次数 —— 供测试断言"只算一次"，也供诊断"谁在重复取" */
export function projectViewStats(): { walks: Record<string, number>; hits: number; cachedRoots: number } {
  return { walks: Object.fromEntries(_walks), hits: _hits, cachedRoots: _cache.size };
}

/** 测试隔离：清缓存与计数 */
export function resetProjectViewForTest(): void {
  _cache.clear();
  _walks.clear();
  _hits = 0;
}
