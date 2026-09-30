/**
 * index_backfill —— **后台续建**：前台按需建块之后，空闲时把剩下的拼图补全
 *
 * 用户意图（2026-09-14）：「读是为了冷启动。选定好读了之后，**没有其他任务的时候就持续跑这个补件**。
 * 首次读主要是为了**防止出现读不到** —— 读不到会打击 LLM 的使用感受。」
 *
 * 分工：
 *   - **前台**（`ensureIndexAround`）：只建"选中文件 + 直接协作者"那一块（有预算/时长封顶），
 *     保证**第一次读立刻有东西**，绝不长时间空转；
 *   - **后台**（本模块）：第一块建完后，分小批、可中断地把整个项目补齐；
 *     每批之间让出事件循环（不阻塞 MCP 请求），并有单飞锁防重复起循环。
 *
 * 诚实纪律：**补齐前不许声称完整** —— 进度由 `backfillState()` 如实暴露
 * （running / done / total / finishedAt / lastError）。
 *
 * 纯本地：只读源码、写自己的 `<projectRoot>/.agent-io/cache.db`。
 */

import path from 'node:path';
import { getProjectCacheDb, beginBatch, endBatch, type Database } from '../infrastructure/index/db.js';
import { syncFile, resolveCrossFileCalls } from '../infrastructure/index/symbols.js';
import { getProjectView } from '../infrastructure/parse/project_view.js';
import { indexedRelativeSet } from './index_freshness.js';

export interface BackfillState {
  running: boolean;
  root: string;
  /** 走查到的源码文件总数（口径 = tools/refs_text.walkSourceFiles） */
  total: number;
  /** 已索引（含此前就已索引的） */
  done: number;
  /** 本轮新建/更新的文件数 */
  synced: number;
  failed: number;
  rounds: number;
  /** 计时拆分（诊断用）：同步 / 跨文件解析 / 其余(扫描+让出) */
  syncMs: number;
  resolveMs: number;
  overheadMs: number;
  startedAt: number;
  finishedAt?: number;
  /** 最近一次错误（不吞：如实暴露） */
  lastError?: string;
}

export interface BackfillOptions {
  /** 每批同步多少个文件（默认 20；每批后让出事件循环） */
  batch?: number;
  /** 两批之间等多久（默认 200ms；让前台请求优先） */
  intervalMs?: number;
  /** 整个后台任务最多同步多少个文件（默认不限；设了就是个安全阀） */
  maxFiles?: number;
  /** 每隔几批做一次跨文件引用解析（默认 5） */
  resolveEvery?: number;
}

const states = new Map<string, BackfillState>();
const timers = new Map<string, NodeJS.Timeout>();

/** 查后台续建进度（未起过 → null） */
export function backfillState(root: string): BackfillState | null {
  return states.get(path.resolve(root)) ?? null;
}

/** 停掉某个项目的后台续建（幂等） */
export function stopBackfill(root: string): void {
  const key = path.resolve(root);
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.delete(key);
  const s = states.get(key);
  if (s) s.running = false;
}

/**
 * ★ 索引**还不完整**吗？（= 后台续建正在跑，符号表还没补齐）
 *
 * 为什么把它单独抽出来当**统一口径**：任何"重开引用 → 重解析"的路径都必须知道这件事 ——
 * 不完整时**不能**把"连不上"判成 `failed`（目标可能只是还没索引到；一旦标 failed 就永不重试，
 * 最终索引会永久缺边）。`watch_project.flushBatch` 与 `write_gate.syncSelfWrites` 共用本函数，
 * 避免两处各写一套判断而慢慢漂移。
 */
export function isIndexIncomplete(root: string): boolean {
  return backfillState(root)?.running === true;
}

/**
 * 已索引文件集合 —— 口径与拼图边界同一处（`index_freshness.indexedRelativeSet`）。
 *
 * ⚠️ 别图省事写成模块级别名 `const indexedSet = indexedRelativeSet`：
 * `index_backfill ⇄ index_freshness` 是**循环 import**（经 write_gate），
 * 别名会在本模块先被求值时捕获到 `undefined`，运行时报 `indexedSet is not a function`。
 * 直接调用（live binding 在调用时解析）才安全。
 */

/**
 * 同步一批：返回本批结果与剩余量（纯前台可用的"手动补一批"，也是后台循环的步进函数）。
 */
export async function backfillChunk(
  db: Database,
  root: string,
  opts: { batch?: number } = {},
): Promise<{ synced: number; failed: number; remaining: number; total: number }> {
  const absRoot = path.resolve(root);
  const batch = opts.batch ?? 20;
  const all = [...getProjectView(absRoot).sourceFiles]; // ★ §19②
  const indexed = indexedRelativeSet(db);
  const todo = all.filter((r) => !indexed.has(r));
  const take = todo.slice(0, batch);
  let synced = 0;
  let failed = 0;
  const scoped: string[] = [];
  beginBatch(db);
  try {
    for (const rel of take) {
      try {
        const r = await syncFile(db, absRoot, path.join(absRoot, rel));
        if (r.status === 'updated') {
          synced++;
          scoped.push(rel);
        } else if (r.status === 'failed') failed++;
      } catch {
        failed++;
      }
    }
  } finally {
    endBatch(db);
  }
  if (scoped.length) {
    try {
      // ★ 与后台循环同一口径：只解析本批文件的未决引用；索引尚未补完 ⇒ 留 pending 不判 failed。
      //   （旧实现是全量 `resolveCrossFileCalls(db, absRoot)`，120 文件规模一次要 9s。）
      resolveCrossFileCalls(db, absRoot, { scopeFiles: scoped, keepUnresolvedPending: true });
    } catch {
      /* 收尾失败不影响下一批 */
    }
  }
  return { synced, failed, remaining: Math.max(0, todo.length - take.length), total: all.length };
}

/**
 * 起后台续建（幂等：同一项目只会有一个循环在跑）。
 * 用 `setTimeout` 串行步进 + `unref()`（不阻止进程退出）；每批之间让出事件循环，
 * 所以它**不会**把 MCP 请求卡住。
 */
export function scheduleBackfill(root: string, opts: BackfillOptions = {}): BackfillState {
  const absRoot = path.resolve(root);
  const existing = states.get(absRoot);
  if (existing?.running) return existing; // 单飞

  const db = getProjectCacheDb(absRoot);
  const state: BackfillState = {
    running: true,
    root: absRoot,
    total: 0,
    done: 0,
    synced: 0,
    failed: 0,
    rounds: 0,
    syncMs: 0,
    resolveMs: 0,
    overheadMs: 0,
    startedAt: Date.now(),
    ...(existing ? { synced: existing.synced, failed: existing.failed, rounds: existing.rounds } : {}),
  };
  states.set(absRoot, state);

  const batch = opts.batch ?? 20;
  const intervalMs = opts.intervalMs ?? 200;
  const maxFiles = opts.maxFiles ?? Number.POSITIVE_INFINITY;
  // 注： 参数保留兼容，但现在**只在全部补完后解析一次**（见 step 内注释）。

  let cachedAll: string[] | null = null;
  const step = async (): Promise<void> => {
    if (!state.running) return;
    state.rounds++;
    const roundStart = Date.now();
    try {
      // 每 5 轮才重扫一次文件清单（文件增删不频繁；每轮重扫纯属浪费）
      // ★ §19②：这里原本自己缓存「每 5 轮重扫」，现在交给 ProjectView 的 TTL（同一意图，单一落点）
      if (!state.rounds || state.rounds % 5 === 1 || !cachedAll) cachedAll = [...getProjectView(absRoot).sourceFiles];
      const all = cachedAll;
      state.overheadMs += Date.now() - roundStart;
      state.total = all.length;
      const indexed = indexedRelativeSet(db);
      // 进度口径：扫描列表 ∩ 已索引（用 Set，别在 filter 里 all.includes —— 那是 O(n²)）
      state.done = all.length === 0 ? indexed.size : all.filter((p) => indexed.has(p)).length;
      const todo = all.filter((r) => !indexed.has(r));
      // ★ 收尾解析：只在**全部补完之后**做一次（这一次是权威口径 —— 允许判 failed，
      //   因为此时符号表已完整，"连不上"是真结论）。
      //   中途则用增量口径（见下方每批的 resolveCrossFileCalls + keepUnresolvedPending），
      //   两宗罪都避开：① 不反复全量重扫（实测 120 文件规模一次 9s）② 不把"还没索引到"误判成 failed。
      if (!todo.length) {
        try {
          resolveCrossFileCalls(db, absRoot);
        } catch {
          /* 收尾失败：留待下次保鲜/查询时再解析 */
        }
        state.done = indexedRelativeSet(db).size;
        state.running = false;
        state.finishedAt = Date.now();
        timers.delete(absRoot);
        return;
      }
      if (state.synced >= maxFiles) {
        state.running = false;
        state.finishedAt = Date.now();
        timers.delete(absRoot);
        return;
      }
      const take = todo.slice(0, batch);
      // ★★ 增量解析（实测：全量 resolveCrossFileCalls 在 120 文件规模下要 9s，是"补齐 42s"的主因之一）：
      //   每批只解析**本批文件**的未决引用，并且 `keepUnresolvedPending`（索引还没补完，
      //   目标可能只是没索引到 —— 不能急着判 failed，否则永久缺边）。
      beginBatch(db);
      let resolvedScope: string[] = [];
      const syncT0 = Date.now();
      try {
        for (const rel of take) {
          try {
            const r = await syncFile(db, absRoot, path.join(absRoot, rel));
            if (r.status === 'updated') {
              state.synced++;
              resolvedScope.push(rel);
            } else if (r.status === 'failed') state.failed++;
          } catch {
            state.failed++;
          }
          // 让出事件循环：前台请求（MCP）优先
          await new Promise((r2) => setImmediate(r2));
        }
      } finally {
        try {
          endBatch(db);
        } catch (e) {
          state.lastError = `batch commit failed: ${(e as Error).message}`;
        }
        state.syncMs += Date.now() - syncT0;
      }
      if (resolvedScope.length) {
        const rt0 = Date.now();
        try {
          resolveCrossFileCalls(db, absRoot, { scopeFiles: resolvedScope, keepUnresolvedPending: true });
        } catch {
          /* 本批解析失败：留 pending，下轮/收尾再试 */
        }
        state.resolveMs += Date.now() - rt0;
      }
      state.done = indexedRelativeSet(db).size;
      state.overheadMs += Date.now() - roundStart;
    } catch (e) {
      state.lastError = (e as Error).message;
    }
    const t = setTimeout(() => void step(), intervalMs);
    (t as unknown as { unref?: () => void }).unref?.();
    timers.set(absRoot, t);
  };

  // 稍等一拍再开工，保证"首次读"先拿到结果
  const first = setTimeout(() => void step(), intervalMs);
  (first as unknown as { unref?: () => void }).unref?.();
  timers.set(absRoot, first);
  return state;
}

/** 人读进度串（供工具结果/诊断用） */
export function backfillSummary(state: BackfillState | null): string {
  if (!state) return '后台续建：未启动';
  if (state.running) {
    return `后台续建：进行中 ${state.done}/${state.total}（本轮新建 ${state.synced}${state.failed ? `，失败 ${state.failed}` : ''}）`;
  }
  const secs = state.finishedAt ? ((state.finishedAt - state.startedAt) / 1000).toFixed(1) : '?';
  return `后台续建：已完成 ${state.done}/${state.total}（本轮新建 ${state.synced}${state.failed ? `，失败 ${state.failed}` : ''}，${secs}s）${state.lastError ? `｜lastError: ${state.lastError}` : ''}`;
}
