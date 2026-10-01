/**
 * write_gate —— **我们自己改的，我们自己登记**：把「写源码」与「索引保鲜」合成同一件事
 *
 * 为什么需要它（用户 2026-09-14）：
 *   「通过了我们这个工具修改了以后的……能不能**监视这些工具**？改了的部分才是改了，
 *     就不需要说后台那样做。」
 * 对。`fs.watch` 是在**猜**"什么变了"；而**我们自己写的文件，我们本来就知道**。
 * 靠猜必然有延迟、有漏事件（目录整树删除只发一次事件、编辑器原子保存会丢 rename……）；
 * 靠登记则零延迟、零遗漏。
 *
 * ─────────────────────────────────────────────────────────────
 * 核心不变量（整个索引层只服务这一个目标）
 * ─────────────────────────────────────────────────────────────
 *   **任何时刻，LLM 通过工具读到的索引内容，要么与磁盘一致，要么明确标注它可能旧/不全。**
 *   —— 也就是"绝不撒谎"。索引存在的意义是让 LLM **敢用**；一次静默的旧数据就足以毁掉这个信任。
 *
 * 为此分层（从便宜到贵，前一层失效才用后一层）：
 *   L1a **写穿**（`writeSourceFiles`，给本就是 async 的工具用）：
 *        写完立刻同步 + 重开受影响的引用方 ⇒ **本进程内读己之写立即可信**，零延迟。
 *   L1b **自写登记**（`recordSelfWrite`，给同步签名的工具用，或写穿失败时兜底）：
 *        `syncFile` 依赖异步解析器（`parseFileFull`），同步工具 await 不了；
 *        退一步登记到 `.agent-io/self-writes.json`，**读路径优先消费**（见 L3）——
 *        比"全库 stat 扫"更便宜也更精确。
 *        （⑤ 2026-09-15：进程启动 `prewarmKernel()` 预热 Parser 缓存后，同步工具可走
 *        `syncSelfWritesSync` **同步直连 L1a**；未预热 ⇒ 预热闸整批落回本层，绝不半同步。）
 *   L2  `watch_project`：**别人的**写（git pull / 编辑器 / 另一个 agent）→ fs.watch + debounce。
 *   L3  `ensureFreshIndex` / `ensureProjectIndex`：**读前自证** —— 不信任任何上游，
 *        每次读都先消费自写登记、再按 stat 比对自己引用的文件；L1/L2 都漏了也能兜住。
 *   L4  `reconcileProject`：低频全量扫盘，兜 L2 覆盖不到的（目录级删除等）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要"写穿"而不是"等 watch 发现"
 * ─────────────────────────────────────────────────────────────
 *   1. **时序**：watch 有 debounce（默认 150ms）+ 事件队列；LLM 常常"改完立刻读"，
 *      这中间的空窗就会读到旧索引 —— 而 LLM 会拿旧索引做下一轮编辑决策。
 *   2. **一致性**：`edges.target → nodes.id` 是 `ON DELETE CASCADE`。我们自己改掉一个符号名，
 *      引用方的边会被数据库**静默删掉且不重建** ⇒ `find_references`/`impact` 漏报。
 *      必须在"我们知道自己改了什么"的这一刻把引用**重开**（`reopenRefsTo`），而不是等谁去猜。
 *   3. **可撤回**：写前快照 + 索引同步放在同一个闸里，"改坏了能退"和"索引不错"一起保证。
 *
 * 纪律：
 *   - **绝不因为一次编辑就凭空建索引**（`hasLiveIndex` 为假 ⇒ 只真写、不写穿）。
 *     否则会造出一个"只有这几个文件"的半成品索引，被后续查询当成完整索引 —— 比不建更糟。
 *   - 写穿**不受拼图边界限制**：我们刚写的文件，LLM 下一步就要读它（读己之写），
 *     这与 `watch` 的"只保鲜已建拼图"是两条不同的纪律，别混。
 *   - 失败**不吞**：任何一步出错都写进 `note`/`error`，主流程照常返回写入结果
 *     （索引是增强，不是写盘的前提）。
 */

import { DATA_DIR_NAME } from '../../infrastructure/data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb, beginBatch, endBatch, projectCacheDbPath, type Database } from '../../infrastructure/index/db.js';
import { syncFile, syncFileSync, removeFile, changedSymbolNames, reopenRefsTo, resolveCrossFileCalls, type SyncStatus, type CrossFileResolveStats } from '../../infrastructure/index/symbols.js';
import { canParseFileSync } from '../../infrastructure/parse/index.js';
import { snapshotBeforeWrite, type FileSnapshotMeta } from '../refactor/file_snapshot.js';
import { isIndexIncomplete } from '../../infrastructure/index/index_backfill.js';

// ─────────────────────────────────────────────────────────────
// 索引写穿的结果类型（一个类型 + 可选字段：调用方统一渲染，不用分三种形状）
// ─────────────────────────────────────────────────────────────

export interface WriteThroughOutcome {
  /** 索引是否已经与本次写入一致（`deferred`/`skipped` 时为 false，如实标注） */
  ok: boolean;
  /**
   * `synced`   = 已同步进索引，**下一步读可信**
   * `deferred` = 已登记自写，**读路径会优先同步**（同步工具用这条）
   * `skipped`  = 没做（该项目还没有索引 / 调用方显式关闭 / 定位不到项目根）
   */
  mode: 'synced' | 'deferred' | 'skipped';
  /** 人读说明（`skipped`/`deferred` 时给出理由） */
  note?: string;
  /** 同步成功（新建或更新）的文件数 */
  synced?: number;
  /** 判为 skipped（内容 hash 未变）的文件数 */
  skippedFiles?: number;
  /** 从索引里移除的文件数（磁盘上已不存在） */
  removed?: number;
  /** 同步失败的文件数 */
  failed?: number;
  /** 因"变动符号改名/删除"而重新打开的引用行数（>0 = 引用方被正确重算） */
  refsReopened?: number;
  /** 被重开的引用分布在多少个引用方文件里 */
  refsReopenedFiles?: number;
  /** 跨文件引用解析统计 */
  cross?: { total: number; resolved: number; external: number; failed: number };
  ms?: number;
  /** 过程中的异常（**不吞**；主流程仍成功） */
  error?: string;
}

export interface SourceWriteReport {
  /** 本次被改动的文件（相对项目根，posix 分隔） */
  touched: string[];
  /** 写前快照（可撤回；null = 没建，如文件不存在或快照失败） */
  snapshot?: FileSnapshotMeta | null;
  /** 索引写穿结果 */
  index: WriteThroughOutcome | null;
}

const EMPTY_CROSS = { total: 0, resolved: 0, external: 0, failed: 0 };

// ─────────────────────────────────────────────────────────────
// 路径工具
// ─────────────────────────────────────────────────────────────

/** 自写登记文件路径 */
export function selfWritesPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), DATA_DIR_NAME, 'self-writes.json');
}

/** 把绝对/相对路径统一成"相对项目根的 posix 路径"；已在根外则返回 null（不参与索引，避免键污染） */
export function toRelPosix(projectRoot: string, p: string): string | null {
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * 该项目**是否已有可用的索引**（cache.db 存在且 files 表非空）。
 *
 * 为什么先看文件是否存在、而不是直接 `getProjectCacheDb`：后者**会顺手建库**。
 * 一次编辑不该凭空造出 `.agent-io/cache.db` —— 那会让后续的"零前置冷启"以为
 * 已经有了，也会让多进程互相抢建。
 */
export function hasLiveIndex(projectRoot: string): boolean {
  const dbFile = projectCacheDbPath(projectRoot);
  if (!fs.existsSync(dbFile)) return false;
  try {
    const db = getProjectCacheDb(projectRoot);
    const row = db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number } | undefined;
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// L1b：自写登记（同步、便宜；给 await 不了的工具用）
// ─────────────────────────────────────────────────────────────

/** 自写登记条目的有效期：够读路径消费到即可，过期自然消失（避免文件无限长大） */
export const SELF_WRITE_TTL_MS = 10 * 60 * 1000;
/** 自写登记最多保留多少条（安全阀） */
export const SELF_WRITE_MAX = 500;

interface SelfWriteEntry {
  at: number;
  files: string[];
  note?: string;
}

/** 读登记文件（坏数据当空，绝不抛；索引是增强不是前提） */
function readSelfWrites(root: string): SelfWriteEntry[] {
  try {
    const raw = fs.readFileSync(selfWritesPath(root), 'utf-8');
    const parsed = JSON.parse(raw) as { writes?: SelfWriteEntry[] };
    const list = Array.isArray(parsed?.writes) ? parsed.writes : [];
    return list.filter((e) => e && Array.isArray(e.files) && typeof e.at === 'number');
  } catch {
    return [];
  }
}

function writeSelfWrites(root: string, list: SelfWriteEntry[]): void {
  const p = selfWritesPath(root);
  const tmp = `${p}.tmp`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // 先写临时文件再 rename：避免读到半个 JSON（多进程/崩溃安全）
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, writes: list }), 'utf-8');
    fs.renameSync(tmp, p);
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * ★ **自写登记**：把"我们自己的工具改了这些源码文件"记下来（同步、便宜、可多进程读）。
 *
 * 用途：同步签名的写工具（await 不了 `syncFile` 的异步解析器）登记一下，
 * 读路径（`ensureFreshIndex`）会**优先消费**这份清单 —— 比全库 stat 扫更便宜、更精确。
 * 另一个用途：async 工具写穿**失败**时也登记一下，保证不静默丢变更。
 *
 * 读时**不清空**（避免多进程 read-clear 竞争）：条目按 `SELF_WRITE_TTL_MS` 过期，
 * 且消费方本来就会按内容 hash 判定，重复消费只是 `skipped`，无副作用。
 */
export function recordSelfWrite(projectRoot: string, files: readonly string[], note?: string): number {
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) return 0;
  const now = Date.now();
  const kept = readSelfWrites(root).filter((e) => now - e.at < SELF_WRITE_TTL_MS);
  kept.push({ at: now, files: rels, ...(note ? { note } : {}) });
  writeSelfWrites(root, kept.slice(-SELF_WRITE_MAX));
  return rels.length;
}

/**
 * 取**待消费**的自写登记（去重后的相对路径），供读路径优先同步。
 * 不过期项不会被清掉 —— 消费方要幂等（按 hash 判定），这里只做"提示"。
 */
export function pendingSelfWrites(projectRoot: string, opts: { maxAgeMs?: number } = {}): string[] {
  const root = path.resolve(projectRoot);
  const ttl = opts.maxAgeMs ?? SELF_WRITE_TTL_MS;
  const now = Date.now();
  const out = new Set<string>();
  for (const e of readSelfWrites(root)) {
    if (now - e.at >= ttl) continue;
    for (const f of e.files) out.add(f);
  }
  return [...out];
}

// ─────────────────────────────────────────────────────────────
// L1a：写穿（async）
// ─────────────────────────────────────────────────────────────

/**
 * **索引写穿**：把我们刚写过的文件同步进索引，并重算受影响的引用。
 *
 * 步骤（顺序有讲究，改顺序会静默失效）：
 *   ① `beginBatch` 包住全部 `syncFile`（实测：不包事务 = 每条语句一次 fsync，是主要耗时源）
 *   ② 每个文件同步后，用 `changedSymbolNames` 取它的 **added/removed/changed** 符号名
 *   ③ `reopenRefsTo` 把这些名字的**已解析引用重开为 pending**，并拿到"引用在哪些文件里"
 *   ④ 用 ③ 返回的**引用方文件 + 本批文件**做 scope 解析
 *      ★ 只放本批文件是不够的：重开的行属于引用方（它自己没变），不放 scope 就"开了却不解析"
 *   ⑤ 索引不完整时（后台续建在跑）`keepUnresolvedPending`，避免把"还没索引到"误判成 failed
 */
export async function syncSelfWrites(
  projectRoot: string,
  files: readonly string[],
  opts: { syncIndex?: boolean; onFile?: (rel: string, status: SyncStatus) => void } = {},
): Promise<WriteThroughOutcome | null> {
  const root = path.resolve(projectRoot);
  if (opts.syncIndex === false) return null;
  if (!hasLiveIndex(root)) return null;

  const rels = [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) return null;

  const t0 = Date.now();
  const out: WriteThroughOutcome = {
    ok: false,
    mode: 'synced',
    synced: 0,
    skippedFiles: 0,
    removed: 0,
    failed: 0,
    refsReopened: 0,
    refsReopenedFiles: 0,
    cross: { ...EMPTY_CROSS },
    ms: 0,
  };
  const errors: string[] = [];
  let db: Database;
  try {
    db = getProjectCacheDb(root);
  } catch (e) {
    out.error = `open cache db failed: ${(e as Error).message}`;
    out.ms = Date.now() - t0;
    return out;
  }

  const keepPending = isIndexIncomplete(root);
  beginBatch(db);
  try {
    for (const rel of rels) {
      const abs = path.join(root, rel);
      try {
        if (!fs.existsSync(abs)) {
          removeFile(db, root, abs);
          out.removed = (out.removed ?? 0) + 1;
          opts.onFile?.(rel, 'ignored');
          continue;
        }
        const r = await syncFile(db, root, abs);
        if (r.status === 'updated') out.synced = (out.synced ?? 0) + 1;
        else if (r.status === 'skipped') out.skippedFiles = (out.skippedFiles ?? 0) + 1;
        else if (r.status === 'failed') out.failed = (out.failed ?? 0) + 1;
        opts.onFile?.(rel, r.status);
      } catch (e) {
        out.failed = (out.failed ?? 0) + 1;
        errors.push(`${rel}: ${(e as Error).message}`);
        opts.onFile?.(rel, 'failed');
      }
    }
  } finally {
    try {
      endBatch(db);
    } catch (e) {
      errors.push(`commit failed: ${(e as Error).message}`);
    }
  }

  // ②③④ 引用方重算（与 watch_project.flushBatch 同一套口径，别各写一套）
  finishWriteThrough(db, root, rels, out, errors, keepPending);

  if (errors.length) out.error = errors.join('; ');
  out.ms = Date.now() - t0;
  return out;
}

/**
 * ★ **写后引用重算的唯一内核**（②③④）—— 两条落盘路径共用**这一份**：
 *   · `finishWriteThrough`（闸内：`syncSelfWrites` / `syncSelfWritesSync`，服务于 `applyWrites`）
 *   · `reopenAndResolveAfterWrite`（闸外：`edit_code` 这类"自己 syncFile 再收尾"的工具）
 * 两者此前是**逐字同形的两份实现**（同一意图两份实现 = 本仓点名的病根），故一并收在这里。
 *
 *   ② `changedSymbolNames` 取本批 added/removed/changed 符号名
 *   ③ `reopenRefsTo` 重开已解析引用，拿到"引用在哪些文件里"
 *   ④ 用引用方文件 + 本批文件做 scope 解析（★ 只放本批不够：重开的行属于引用方，它自己没变）
 *
 * ★ 本函数**抛**（不吞）：调用方各自决定"怎么把失败说出去"——
 *   闸内进 `errors`（历史上这类异常被 catch 吞掉，导致 `reopenRefsTo` 长期"静默 0 条"），
 *   闸外进回执的 `error` 字段。**两条路都不许静默。**
 */
function resolveRefsAfterWrite(
  db: Database,
  root: string,
  rels: readonly string[],
  keepPending: boolean,
): { refsReopened: number; refsReopenedFiles: number; cross: CrossFileResolveStats } {
  const names = new Set<string>();
  for (const rel of rels) {
    for (const nm of changedSymbolNames(db, rel)) names.add(nm);
  }
  const scope = new Set<string>(rels);
  let refsReopened = 0;
  let refsReopenedFiles = 0;
  if (names.size) {
    const r = reopenRefsTo(db, [...names]);
    refsReopened = r.reopened;
    refsReopenedFiles = r.files.length;
    for (const f of r.files) scope.add(f);
  }
  const cross = resolveCrossFileCalls(db, root, {
    scopeFiles: [...scope],
    keepUnresolvedPending: keepPending,
  });
  return { refsReopened, refsReopenedFiles, cross };
}

/**
 * ②③④ 的**闸内挂载点**：把内核结果写进 `out`（并在成功时置 `out.ok = true`）；
 * 失败进 `errors`（调用方必须把它带进结果）。逻辑本身在 `resolveRefsAfterWrite`，别在这重写。
 */
function finishWriteThrough(
  db: Database,
  root: string,
  rels: readonly string[],
  out: WriteThroughOutcome,
  errors: string[],
  keepPending: boolean,
): void {
  try {
    const r = resolveRefsAfterWrite(db, root, rels, keepPending);
    out.refsReopened = r.refsReopened;
    out.refsReopenedFiles = r.refsReopenedFiles;
    out.cross = r.cross;
    out.ok = true;
  } catch (e) {
    // 不吞：历史上这类异常被 catch 吞掉，导致 reopenRefsTo 长期"静默 0 条"
    errors.push(`reference re-resolve failed: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// L1a'：写穿（sync，⑤ 同步工具直连 2026-09-15）
// ─────────────────────────────────────────────────────────────

/**
 * **同步写穿**：`syncSelfWrites` 的同步孪生。给同步签名的写工具
 * （remove_dead_imports / scaffold 等——await 不了 async 版）用。
 *
 * 为什么现在可能：L1a 链路里唯一的 await 是 `syncFile → parseFileFull → getParser`
 * （动态 import 语言包）；解析与 SQLite 全部同步 ⇒ 进程启动 `prewarmKernel()` 预热
 * Parser 缓存后，本函数全程无 await，**当场**写穿，不再只能登记（L1b）等读路径兜。
 *
 * ★ 预热闸（绝不半同步）：本批里只要有任何一个**存在文件**的扩展名 Parser 未预热，
 *   整批**一起**落回 L1b（`recordSelfWrite` + `mode:'deferred'`）——绝不出现
 *   "一半同步了一半没同步"的批次。要删的文件（磁盘上已不存在）不需要解析器，
 *   不受闸影响；不支持的扩展名（.md/.json…）解析返回空，同样不受闸影响。
 *
 * 与 async 版逐段同构（步骤与口径一致）：②③④ 走共用的 `finishWriteThrough`。
 */
export function syncSelfWritesSync(
  projectRoot: string,
  files: readonly string[],
  opts: { syncIndex?: boolean } = {},
): WriteThroughOutcome | null {
  const root = path.resolve(projectRoot);
  if (opts.syncIndex === false) return null;
  if (!hasLiveIndex(root)) return null;

  const rels = [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) return null;

  const t0 = Date.now();
  const out: WriteThroughOutcome = {
    ok: false,
    mode: 'synced',
    synced: 0,
    skippedFiles: 0,
    removed: 0,
    failed: 0,
    refsReopened: 0,
    refsReopenedFiles: 0,
    cross: { ...EMPTY_CROSS },
    ms: 0,
  };

  // ★ 预热闸：全批先验。任何未预热 ⇒ 整批落回 L1b（登记 + deferred），绝不半同步
  const unready: string[] = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // 删除路径不需要解析器
    if (!canParseFileSync(abs)) unready.push(rel);
  }
  if (unready.length) {
    const n = recordSelfWrite(root, rels, 'sync write-through: 解析器未预热（kernel 未 prewarm）');
    return {
      ok: false,
      mode: 'deferred',
      note: `解析器未预热（涉及 ${unready.join(', ')}），整批已登记 ${n} 个文件走读路径同步（绝不半同步）`,
      ms: Date.now() - t0,
    };
  }

  const errors: string[] = [];
  let db: Database;
  try {
    db = getProjectCacheDb(root);
  } catch (e) {
    out.error = `open cache db failed: ${(e as Error).message}`;
    out.ms = Date.now() - t0;
    return out;
  }

  const keepPending = isIndexIncomplete(root);
  beginBatch(db);
  try {
    for (const rel of rels) {
      const abs = path.join(root, rel);
      try {
        if (!fs.existsSync(abs)) {
          removeFile(db, root, abs);
          out.removed = (out.removed ?? 0) + 1;
          continue;
        }
        const r = syncFileSync(db, root, abs);
        if (r.status === 'updated') out.synced = (out.synced ?? 0) + 1;
        else if (r.status === 'skipped') out.skippedFiles = (out.skippedFiles ?? 0) + 1;
        else if (r.status === 'failed') out.failed = (out.failed ?? 0) + 1;
      } catch (e) {
        out.failed = (out.failed ?? 0) + 1;
        errors.push(`${rel}: ${(e as Error).message}`);
      }
    }
  } finally {
    try {
      endBatch(db);
    } catch (e) {
      errors.push(`commit failed: ${(e as Error).message}`);
    }
  }

  // ②③④ 引用方重算（与 async 版共用同一实现，别各写一套）
  finishWriteThrough(db, root, rels, out, errors, keepPending);

  if (errors.length) out.error = errors.join('; ');
  out.ms = Date.now() - t0;
  return out;
}

// ─────────────────────────────────────────────────────────────
// 统一写入闸
// ─────────────────────────────────────────────────────────────

/**
 * ★ 写盘后的**另一半**收尾：重开"指向本批被改符号"的引用，并按 scope 重解析。
 *
 * 为什么必须单独存在：`syncFile` 只负责**被改文件自己**；而**引用方文件没变、不会被重解析**，
 * 它那条指向旧符号的边已被 FK `ON DELETE CASCADE` 静默删掉 ⇒ `find_references` / `impact` 漏报。
 * 之前只有 `ensureFreshIndex` 与 `watch_project` 做了这件事，`edit_code` / `rename_file` /
 * `symbol_move` 这类"自己 syncFile"的工具漏了 —— 本函数就是给它们的收尾点。
 *
 * 绝不抛错；失败写进 `error`，**调用方必须把它带进结果**（别吞：这类异常历史上被吞成"静默 0 条"）。
 */
export async function reopenAndResolveAfterWrite(
  projectRoot: string,
  files: readonly string[],
): Promise<{
  refsReopened: number;
  refsReopenedFiles: number;
  cross: { total: number; resolved: number; external: number; failed: number };
  error?: string;
}> {
  const empty = { refsReopened: 0, refsReopenedFiles: 0, cross: { total: 0, resolved: 0, external: 0, failed: 0 } };
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];
  if (!rels.length || !hasLiveIndex(root)) return empty;
  let db: Database;
  try {
    db = getProjectCacheDb(root);
  } catch (e) {
    return { ...empty, error: `open cache db failed: ${(e as Error).message}` };
  }
  try {
    // ★ ②③④ 走**唯一内核**（与闸内 `finishWriteThrough` 同一份实现，勿在此另写一套）
    return resolveRefsAfterWrite(db, root, rels, isIndexIncomplete(root));
  } catch (e) {
    return { ...empty, error: `reopen/resolve failed: ${(e as Error).message}` };
  }
}

/** 人读短注（拼进"索引已重建"那类句子里）。失败必须可见 —— 绝不静默。 */
export function reopenNote(r: { refsReopened: number; error?: string }): string {
  if (r.error) return `｜⚠️ 引用方重算失败：${r.error}`;
  return r.refsReopened > 0 ? `｜引用方重算 ${r.refsReopened} 条` : '';
}

/**
 * ★ **统一写入闸**：`快照 → 真写 → 索引写穿`（async 版）。
 *
 * 所有"会改源码"的工具都应走这里（或同步版走 `记录自写`），而不是各自 `fs.writeFileSync` ——
 * 这是"我们自己改的我们自己登记"能成立的**结构保证**：漏接一个工具就等于多一个静默撒谎点。
 *
 * @param files  将要改动的文件（绝对或相对项目根均可）。**按引用读**：
 *               算不全时可以在 `mutate` 里继续 `push` 实际写到的文件 ——
 *               快照用"写前可见的"，写穿用"写后的全集"。
 */
export async function writeSourceFiles<T>(
  projectRoot: string,
  files: readonly string[],
  mutate: () => T | Promise<T>,
  opts: {
    label?: string;
    snapshot?: boolean;
    syncIndex?: boolean;
    before?: () => void;
    /** 逐文件回报索引同步结果（`SyncStatus`）—— 供需要逐文件回执的调用方（如 `applyWrites`）用 */
    onFile?: (rel: string, status: SyncStatus) => void;
  } = {},
): Promise<{ value: T; report: SourceWriteReport }> {
  const root = path.resolve(projectRoot);
  const norm = (): string[] =>
    [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];

  // ① 写前快照（失败绝不阻断：可撤回是增强，不是前提）
  //    用"写前可见的列表" —— 有些改动集合只有跑完才知道，那时再补快照已经晚了。
  const snapshot = opts.snapshot === false ? null : snapshotBeforeWrite(root, opts.label ?? 'source write', norm());

  // ② 真写
  opts.before?.();
  const value = await mutate();

  // ③ 索引写穿，用"写后的列表"（mutate 期间可能 push 过新发现的目标文件）
  const rels = norm();
  let index: WriteThroughOutcome | null = null;
  try {
    index = await syncSelfWrites(root, rels, { syncIndex: opts.syncIndex, onFile: opts.onFile });
    if (!index) index = { ok: false, mode: 'skipped', note: '该项目还没有索引 ⇒ 只真写，未写穿' };
  } catch (e) {
    // 写穿崩了也不能静默：登记自写，让读路径去兜（L1b → L3）
    const n = recordSelfWrite(root, rels, 'write-through failed');
    index = {
      ok: false,
      mode: 'deferred',
      note: `写穿异常（已登记 ${n} 个文件，读路径会优先同步）：${(e as Error).message}`,
    };
  }

  return { value, report: { touched: rels, snapshot, index } };
}

/**
 * 同步工具用：只做**快照 + 自写登记**（不做写穿 —— `syncFile` 是异步的，同步调用者 await 不了）。
 * 索引一致性由读路径（`ensureFreshIndex` 优先消费自写登记）保证。
 */
export function snapshotAndRecordSelfWrite(
  projectRoot: string,
  files: readonly string[],
  opts: { label?: string; snapshot?: boolean } = {},
): WriteThroughOutcome {
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toRelPosix(root, f)).filter((r): r is string => !!r))];
  const hasIndex = hasLiveIndex(root);
  if (opts.snapshot !== false) snapshotBeforeWrite(root, opts.label ?? 'source write', rels);
  if (!hasIndex) return { ok: false, mode: 'skipped', note: '该项目还没有索引 ⇒ 只真写，未登记' };
  const n = recordSelfWrite(root, rels, opts.label);
  return { ok: false, mode: 'deferred', note: `已登记 ${n} 个文件的改动，读路径会优先同步（本工具是同步签名）` };
}

/** 人读一行（供工具结果附注：让 LLM 知道"索引眼下可信不可信"） */
export function writeThroughLine(index: WriteThroughOutcome | null): string {
  if (!index) return '索引写穿：未执行';
  if (index.mode === 'skipped') return `索引写穿：跳过 —— ${index.note ?? '无索引或未启用'}`;
  if (index.mode === 'deferred') return `索引写穿：已登记待同步 —— ${index.note ?? ''}`;
  if (index.error) return `索引写穿：部分失败 —— ${index.error}`;
  const parts = [`同步 ${index.synced ?? 0} 文件`];
  if (index.skippedFiles) parts.push(`未变跳过 ${index.skippedFiles}`);
  if (index.removed) parts.push(`移除 ${index.removed}`);
  if (index.failed) parts.push(`失败 ${index.failed}`);
  if (index.refsReopened) parts.push(`重开引用 ${index.refsReopened} 条/${index.refsReopenedFiles} 文件`);
  if (index.cross?.total) parts.push(`重解析引用 ${index.cross.total} 条`);
  return `索引写穿：${parts.join(' ｜ ')}（${index.ms ?? 0}ms）`;
}
