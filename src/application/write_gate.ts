/**
 * write_gate —— **我们自己改的，我们自己登记**：把「写源码」与「索引保鲜」合成同一件事
 *
 * ★ 2026-10-05 从 `application/observe/runtime/` 搬到**本层根**（`application/write_gate.ts`）——
 *   判据与 2026-10-04 `dispatch` 的那次同型，逐字复述那条：**它被多条线消费**（现 11 处 / 4 条线 +
 *   presentation），**留在 observe 里反而让 design / refactor / meta 依赖 observe 内部**。
 *   而 `application/` 根的 flatDirs 声明写的就是「应用层横切件，被各工具线共用、彼此无父子 ⇒ 平铺是终态」
 *   ⇒ 本文件正是这一类，搬进来是**归位**不是新增目录。
 *   搬后 `application/observe/runtime/` 只剩 3 个文件（run_tests / stale_check / watch_project_tool），
 *   全是 observe 线自己的东西。
 *   ★ 同步更新：`structure.domains.json` 的 `flat-application` note（文件数 6 → 7）。
 *   ★ 用项目自带的 `rename_files` 搬的（联动 11 处 import 说明符），不是手改。
 *
 * 为什么需要它（用户 2026-09-14）：
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

import { selfWritesPath, SELF_WRITE_TTL_MS, readSelfWrites, type SelfWriteEntry } from '../infrastructure/index/self_writes.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb, beginBatch, endBatch, projectCacheDbPath, type Database } from '../infrastructure/index/db.js';
import { syncFile, syncFileSync, removeFile, changedSymbolNames, reopenRefsTo, resolveCrossFileCalls, type SyncStatus, type CrossFileResolveStats , toIndexKey, toRelPath } from '../infrastructure/index/symbols.js';
import { canParseFileSync } from '../infrastructure/parse/index.js';
import { snapshotBeforeWrite, type FileSnapshotMeta } from './refactor/snapshot/file_snapshot.js';
import { indexCoversDisk } from '../infrastructure/index/index_freshness.js';
// ★★★ T328 步 6：**任务闸**要读「项目 → 设计 feature」的反查与 overlay 的 progress（唯一权威）。
//   ★ 反查口径**与 `file_snapshot.ts`（T90）逐字同款**（`DSL.source_root === 项目根`）——
//     那条路已在本仓跑过（它记"写前那一刻的决策"），此处**复用同一把尺**，不另立一套。
import { listFeatures } from '../infrastructure/storage.js';
import { loadOverlay } from '../infrastructure/storage_overlay.js';

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
  /**
   * ★★★ **任务闸的一句话留痕**（T328 步 6）—— "这次写入有没有挂到任务/进度登记上"。
   * ★ **非空即已报**（不静默）：要么"已登记"，要么"闸不适用 + 依据"。
   * ★ 被拒时**不会**走到这里（`assertSourceWriteRegistered` 直接抛）。
   */
  task_gate?: string;
}

const EMPTY_CROSS = { total: 0, resolved: 0, external: 0, failed: 0 };

// ─────────────────────────────────────────────────────────────
// 路径工具
// ─────────────────────────────────────────────────────────────


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
//
// 读侧原语（selfWritesPath / SELF_WRITE_TTL_MS / readSelfWrites / pendingSelfWrites /
// SelfWriteEntry）已下沉到 `infrastructure/index/self_writes.ts`（消「下层 import 上层」
// 的分层违规），本文件从那里 import 使用；此处只保留**写**（writeSelfWrites / recordSelfWrite）。

/** 自写登记最多保留多少条（安全阀）；只被写侧 recordSelfWrite 用，故留在本文件 */
export const SELF_WRITE_MAX = 500;

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
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) return 0;
  const now = Date.now();
  const kept = readSelfWrites(root).filter((e) => now - e.at < SELF_WRITE_TTL_MS);
  kept.push({ at: now, files: rels, ...(note ? { note } : {}) });
  writeSelfWrites(root, kept.slice(-SELF_WRITE_MAX));
  return rels.length;
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
 *   ⑤ ★★ 索引**没覆盖磁盘时**（`!indexCoversDisk`）`keepUnresolvedPending`，避免把"还没索引到"误判成 failed
 *      ★★★ T247（2026-10-13）：这里的判据**改过** —— 以前用 `isIndexIncomplete(root)`
 *        （= **后台续建在不在跑**）当"索引不完整"的**代理**，而同一件事在 `index_freshness` 里用的是
 *        **数据口径**（`已索引 >= 走查到的文件数`）⇒ ★ **两处会分歧**（复现见 `certs/t247-coverage-cert.mjs`），
 *        且**进程口径那一侧会把"还没索引到"判死**（`failed` 的边永不重试 ⇒ 索引永久缺边）。
 *        ⇒ 现在**两处都走 `index_freshness.indexCoversDisk`** —— 判据只有一处。
 */
export async function syncSelfWrites(
  projectRoot: string,
  files: readonly string[],
  opts: { syncIndex?: boolean; onFile?: (rel: string, status: SyncStatus) => void } = {},
): Promise<WriteThroughOutcome | null> {
  const root = path.resolve(projectRoot);
  if (opts.syncIndex === false) return null;
  if (!hasLiveIndex(root)) return null;

  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
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

  const keepPending = !indexCoversDisk(db, root); // ★ T247：判据收口 —— 不再拿"后台在跑"当"覆盖度"的代理
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
  // ★★★ T214 续5（2026-10-13）：**`ok` 必须把【文件级失败】并进来** —— ★ 外部评测指出的真缺口 ✓
  //   ★ 原来：★ **只要"引用重算"没抛就无条件 `out.ok = true`** ✗ ⇒ ★★ 于是
  //     `out.failed > 0`（**有文件写失败**）时，回执**照样报 ok** ✗ —— ★ 而调用方据此以为写穿成功 ✓
  //   ★★ 另一个方向也错：★ 引用重算**抛了** ⇒ ★ 原来**根本不设 `ok`** ⇒ ★ 它留成 `undefined` ✗
  //     ⇒ ★ 而"没设"与"明确 false"对读端是**两件事**（★ 本仓一贯口径 ✓）⇒ 必须**明确 `false`** ✓
  //   ⇒ ★ 判据（★ 只此一处，两个方向都收）：
  //     ★ **有文件级失败 ⇒ 不 ok** ✓ · ★ **引用重算失败 ⇒ 明确 `false`**（不留 `undefined` ✓）
  const hadFileFailures = (out.failed ?? 0) > 0;
  try {
    const r = resolveRefsAfterWrite(db, root, rels, keepPending);
    out.refsReopened = r.refsReopened;
    out.refsReopenedFiles = r.refsReopenedFiles;
    out.cross = r.cross;
    // ★ 文件级失败**也**要并进来 —— ★ 不许只看"引用重算有没有抛" ✓
    out.ok = !hadFileFailures;
    if (hadFileFailures) {
      errors.push(`写穿未全成功：有 ${out.failed} 个文件同步失败 ⇒ \`ok=false\`（★ 见 out.failed ✓）`);
    }
  } catch (e) {
    // 不吞：历史上这类异常被 catch 吞掉，导致 reopenRefsTo 长期"静默 0 条"
    errors.push(`reference re-resolve failed: ${(e as Error).message}`);
    // ★★ 明确 false（★ 不留 undefined —— ★ 那是"没结论"，而这里**有结论**：失败了 ✓）
    out.ok = false;
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

  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
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

  const keepPending = !indexCoversDisk(db, root); // ★ T247：判据收口 —— 不再拿"后台在跑"当"覆盖度"的代理
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
// ★★★ 任务闸（T328 步 6，2026-10-15）：**未登记不许落盘**
// ─────────────────────────────────────────────────────────────

/** 任务闸的判据结果 —— `applicable:false` = 该项目/该文件不在任务系统里（**要报出来，不许静默**） */
export interface TaskGateOutcome {
  applicable: boolean;
  /** 人读原因（放行时给出依据：凭什么放行） */
  note: string;
}

/**
 * 该项目根上「**覆盖某批文件**」的设计 feature 列表（每个带 `path → node_id` 表）。
 *
 * ★ 反查口径与 `file_snapshot.ts`（T90）**逐字同款**：`path.resolve(DSL.source_root) === 项目根`。
 * ★ 与 T90 的差别（**有意**，别照着 T90 的 `hits.length===1` 改回来）：T90 是"给快照**贴一条**意图"，
 *   贴错比不贴坏 ⇒ 只认**唯一命中**；本闸问的是"这次改动**有没有挂在任何一条**任务上"
 *   （要求原文："**没有挂到任何任务/进度登记上** ⇒ 拒绝"）⇒ 只要**覆盖了**就要登记，
 *   多feature 时只要**任一**登记过就算通过 —— ★ 仍然**不需要替人挑**哪一条。
 */
function coveringFeatures(absRoot: string): Array<{ feature: string; byPath: Map<string, string> }> {
  const out: Array<{ feature: string; byPath: Map<string, string> }> = [];
  for (const d of listFeatures()) {
    if (!d.source_root || path.resolve(d.source_root) !== absRoot) continue;
    const byPath = new Map<string, string>();
    for (const n of d.geometry?.nodes ?? []) {
      if (n.type !== 'file') continue;
      if (typeof n.description !== 'string' || !n.description) continue;
      byPath.set(n.description.split(path.sep).join('/'), n.id);
    }
    // 兜底：`semantic.files` 里有、几何层没有同名节点的（不该发生，但**不静默漏判**）
    for (const f of d.semantic?.files ?? []) {
      if (f.path && !byPath.has(f.path)) byPath.set(f.path.split(path.sep).join('/'), f.id);
    }
    if (byPath.size) out.push({ feature: d.feature, byPath });
  }
  return out;
}

/**
 * ★★★ **任务闸：改源码可以，但不登记不许悄悄改**（T328 步 6）。
 *
 * ## 它回答什么
 * 「这次要落盘的改动，**挂在哪一条任务/进度登记上**？」——没挂 ⇒ **拒绝落盘**，
 * 并在错误信息里给出「**怎么登记**」（工具名 + 最小参数）。
 *
 * ## ★ 为什么是"拒"而不是"提示"（本仓已证过的一类腐坏）
 * 靠提示词要求"自己记得登记"= **又一条会腐的软约束**（md todo 侧实测：26 勾 vs 77 未勾，
 * 且"勾了"≠"做了"）⇒ 唯一"结构上不可能绕过"的位置就是**写入咽喉**（`docs/replan-2026-10-15.md` §12.5）。
 *
 * ## ★★ 两条**硬**纪律（与 `validateProgressEvidence` 同族）
 * 1. **不静默**：被拒 ⇒ 抛错，且错误信息里含登记入口；放行的分支 ⇒ 由调用方**报出** `note`。
 * 2. **不自动补登记**：本函数**绝不**替调用方写 progress，也**不**把这次写入降级放行 —— 拒绝就是拒绝。
 *
 * ## 登记是什么（唯一权威）
 * `progress` 住在 **`<feature>.overlay.json` 锚点**上（`OverlayAnchor.progress`，T328 收归），
 * 写端只有一个：`status_tools.updateStatus`（经 `edit_dsl` 的 `{type:'status'}` 操作进入）。
 * ⇒ 本闸**只读**它，判据与权威**同源**（不另立第二份"登记"）。
 *
 * ## ★ 拦的范围（明写，便于判"谁被拦/谁不被拦"）
 * 拦：`项目根上有设计 feature 覆盖该文件（DSL.source_root === 项目根 ∧ 该文件是它的文件节点）`
 *    ∧ `覆盖它的那些 feature 里【没有一条】给该节点登记过 progress`。
 * 放行：该项目**没有** feature 指向它 · 文件**不是**任何一条的节点（新建文件 / 未纳入设计）·
 *      文件在**任一**覆盖它的 feature 里已登记（`progress` 非空）。
 *
 * ## ★★ T332（2026-10-15）**追加**的第二条判据：前置闸（解锁）
 * 上面这条（未登记）之外，**追加**：某条 edge intent **显式**声明了 `requires`（非空）∧ 该边源节点(from)
 * 是本次要改的文件节点 ∧ requires 里有节点未 `done` ⇒ 拒绝（"完成 A 才准开始 B"）。
 * ★ **只认显式 `requires`** —— edge 默认装 import 依赖 ≠ 任务前置 ⇒ **没标 requires 一律不拦**（防误伤，
 *   别把全仓 import 边当成解锁条件）。判据与"怎么办"见下方 `unmetPrereq` 段。
 */
export function assertSourceWriteRegistered(
  projectRoot: string,
  files: readonly string[],
): TaskGateOutcome {
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) return { applicable: false, note: '没有落在项目根内的文件 ⇒ 任务闸不适用（放行）' };

  const covering = coveringFeatures(root);
  if (!covering.length) {
    return {
      applicable: false,
      note: '项目根上没有设计 feature 指向它（没有任何 feature 的 source_root 指到这里）⇒ 任务闸不适用（放行）',
    };
  }

  // overlay 按 feature 懒读一次（权威 = `<feature>.overlay.json` 锚点的 progress）
  const ovByFeature = new Map<string, ReturnType<typeof loadOverlay>>();
  const progressOf = (feature: string, nodeId: string): unknown => {
    if (!ovByFeature.has(feature)) ovByFeature.set(feature, loadOverlay(feature));
    return ovByFeature.get(feature)?.anchors?.[nodeId]?.progress;
  };

  // ★★★ T332（2026-10-15）：**前置闸（解锁）** —— **追加判据**（不新建闸门，与下面"未登记"并列）。
  //
  // ## 判据（★ 只认**显式**声明 —— 本条的成败在此）
  // 覆盖该文件的 feature 的 overlay 里，**某条 edge intent 显式标了 `requires`（非空）**，
  // 该边**源节点 `from`** 正是本次要改的文件节点，而 `requires` 里有节点**未 `progress === 'done'`**
  // ⇒ **拒绝落盘**，并给出"怎么办"。
  //
  // ## ★★ 为什么只认显式 requires（防误伤，本条的全部意义）
  // edge 默认装的是 **import 依赖**（扫描产出的依赖边 / `Edge.intent`）—— ★ 它**不等于任务前置**。
  // ⇒ 若"有 import 边就拦"，会把**全仓 import 依赖误当解锁条件**（replan-log §28.3 记的"最贵一步"）。
  // ⇒ 判据：**`requires` 为 undefined / 空数组 ⇒ 一律不拦**；只有显式列了节点 id 的才拦。
  //
  // ## 拦的范围（明写，便于判"谁被拦/谁不被拦"）
  // 拦：该文件是某 covering feature 的文件节点 N ∧ 该 feature overlay 里存在 edge intent `e`，
  //     `e.from === N` ∧ `e.requires` 非空 ∧ 其中某被引节点 `progress !== 'done'`。
  // 放行：没有任何 requires 声明 · 该文件不是任何 covering feature 的节点 ·
  //      没有"源节点=N 且带 requires"的边 · requires 里的节点已全部 done。
  const unmetPrereq: Array<{
    rel: string;
    feature: string;
    nodeId: string;
    edgeId: string;
    missing: Array<{ id: string; progress: unknown }>;
  }> = [];
  {
    const edgesOf = (feature: string) => {
      if (!ovByFeature.has(feature)) ovByFeature.set(feature, loadOverlay(feature));
      return ovByFeature.get(feature)?.edges ?? {};
    };
    for (const rel of rels) {
      const cands = covering
        .map((c) => ({ feature: c.feature, nodeId: c.byPath.get(rel) }))
        .filter((x): x is { feature: string; nodeId: string } => !!x.nodeId);
      for (const { feature, nodeId } of cands) {
        for (const [edgeId, ei] of Object.entries(edgesOf(feature))) {
          if (!ei.requires || ei.requires.length === 0) continue; // ★★ 没标 requires ⇒ 不拦
          if (ei.from !== nodeId) continue; // ★ 只拦"该边源节点(from)"的源码写入
          const missing = ei.requires
            .map((rid) => ({ id: rid, progress: progressOf(feature, rid) }))
            .filter((x) => x.progress !== 'done');
          if (missing.length) unmetPrereq.push({ rel, feature, nodeId, edgeId, missing });
        }
      }
    }
  }
  if (unmetPrereq.length) {
    const first = unmetPrereq[0];
    const list = unmetPrereq
      .map(
        (u) =>
          `  · ${u.rel}（节点 ${u.nodeId}，feature=${u.feature}）被边 ${u.edgeId} 的任务前置挡住：` +
          u.missing.map((m) => `${m.id}（progress=${JSON.stringify(m.progress)}）`).join(' / ') +
          ' **尚未 done**',
      )
      .join('\n');
    const need = first.missing[0].id;
    throw new Error(
      `拒绝落盘（前置闸）：这次要改的 ${unmetPrereq.length} 个文件**任务前置未满足** —— ` +
        `本仓纪律：\`requires\` 是**显式声明**的前置，被引节点未 done ⇒ 不许开工（**完成 A 才准开始 B**）。\n` +
        `${list}\n` +
        `\n★ 怎么办（二选一）：\n` +
        `  ① 先完成前置节点（唯一权威写端 \`edit_dsl\`，最小参数；★ 置 done 另需 evidence）：\n` +
        `     { feature: '${first.feature}',\n` +
        `       reason: '完成前置 ${need}',\n` +
        `       operations: [{ type:'status', op:'update', id:'${need}',\n` +
        `                      data:{ status:'done', evidence:{ kind:'attestation', by:'human', at:'<ISO>', why:'<为什么算完成>' } } }] }\n` +
        `★ 建议（不强制，但请当真）：**不要自己验收自己** —— 发布任务后派**子代理**去完成，**自己来验收**；\n` +
        `  验收要附**你自己跑过的读数**（命令 + 输出），**不要只读对方的总结**（对方报的常与实况不符）。\n` +
        `  ② 若这个前置判断已过时 ⇒ 用 \`design_intent\` 显式**解除**它（requires 住 overlay = 权威）：\n` +
        `     { action:'set', feature:'${first.feature}', edge_intents:[{ id:'${first.edgeId}', requires: [] }] }   // 空数组 = 解除该边前置\n` +
        `\n★ 本闸**不会替你登记进度、不会自动补前置、也不会降级放行** —— 拒绝就是拒绝。\n` +
        `★ 拦的范围（只此一条）：覆盖该文件的 feature 里，某条 edge intent **显式**标了 \`requires\`（非空）` +
        `∧ 该边源节点(from) 正是本次要改的文件节点 ∧ requires 里有节点未 done。\n` +
        `  放行：没有任何 requires 声明 / 该文件不是 covering feature 的节点 / requires 里的节点已全部 done。`,
    );
  }

  const unregistered: Array<{ rel: string; cands: Array<{ feature: string; nodeId: string }> }> = [];
  let checked = 0;
  for (const rel of rels) {
    const cands = covering
      .map((c) => ({ feature: c.feature, nodeId: c.byPath.get(rel) }))
      .filter((x): x is { feature: string; nodeId: string } => !!x.nodeId);
    if (!cands.length) continue; // 不是任何一条 feature 的节点（新建/未纳入设计）⇒ 无任务可挂 ⇒ 不拦
    checked++;
    // ★ "挂到【任何】一条任务上" ⇒ 任一 feature 登记过 progress 即通过（不替人挑哪一条）
    if (cands.some((c) => progressOf(c.feature, c.nodeId) !== undefined)) continue;
    unregistered.push({ rel, cands });
  }
  if (!unregistered.length) {
    return {
      applicable: true,
      note:
        `已登记：${checked} 个设计节点都有 progress（覆盖 feature：${covering.map((c) => c.feature).join(', ')}；` +
        `另有 ${rels.length - checked} 个文件不是任何一条的节点，不计）`,
    };
  }

  const first = unregistered[0];
  const list = unregistered
    .map(
      (u) =>
        `  · ${u.rel}  ⇒ ${u.cands
          .map((c) => `${c.nodeId}（feature=${c.feature}）`)
          .join(' / ')} **都没有 progress 登记**`,
    )
    .join('\n');
  throw new Error(
    `拒绝落盘（任务闸）：这次要改的 ${unregistered.length} 个文件**没有挂到任何任务/进度登记上** —— ` +
      `本仓纪律：改源码可以，但**不登记不许悄悄改**。\n` +
      `${list}\n` +
      `\n★ 怎么登记（唯一权威写端；工具名 \`edit_dsl\`，最小参数）：\n` +
      `  { feature: '${first.cands[0].feature}',\n` +
      `    reason: '开始实现 ${first.cands[0].nodeId}',\n` +
      `    operations: [{ type:'status', op:'update', id:'${first.cands[0].nodeId}', data:{ status:'in_progress' } }] }\n` +
      `  · status 三态：draft / in_progress / done（★ 置 done 另有一道 evidence 闸，见 update_status）。\n` +
      `  · 覆盖这条改动的 feature 有多条时，登记**任一条**即可（本闸不替你挑）。\n` +
      `\n★ 本闸**不会替你登记**，也**不会把这次写入降级放行** —— 拒绝就是拒绝；登记后再改即可。\n` +
      `★ 拦的范围（只此一条）：项目根上有设计 feature 覆盖该文件（` +
      `source_root === 项目根 ∧ 该文件是它的文件节点）∧ 覆盖它的 feature 里**没有一条**给该节点登记过 progress。\n` +
      `  放行：项目无 feature 指向它 / 文件不是任何一条的节点（新建或未纳入设计）/ 已在任一条里登记。`,
  );
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
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  if (!rels.length || !hasLiveIndex(root)) return empty;
  let db: Database;
  try {
    db = getProjectCacheDb(root);
  } catch (e) {
    return { ...empty, error: `open cache db failed: ${(e as Error).message}` };
  }
  try {
    // ★ ②③④ 走**唯一内核**（与闸内 `finishWriteThrough` 同一份实现，勿在此另写一套）
    return resolveRefsAfterWrite(db, root, rels, !indexCoversDisk(db, root));
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
    [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];

  // ★★★ T328 步 6：**未登记不许落盘** —— 闸在快照/真写**之前**（拒绝就是拒绝，绝不偷偷写一半）。
  //   ★ 它抛 ⇒ 本次一个字节都不落盘（`mutate` 不会被调用），调用方按普通错误上抛即可。
  const taskGate = assertSourceWriteRegistered(root, files);

  // ① 写前快照（失败绝不阻断：可撤回是增强，不是前提）
  //    用"写前可见的列表" —— 有些改动集合只有跑完才知道，那时再补快照已经晚了。
  const snapshot = opts.snapshot === false ? null : snapshotBeforeWrite(root, opts.label ?? 'source write', norm());

  // ② 真写
  //    ★ T229：目标目录可能**尚不存在**（写"新目录下的新文件"）——
  //    与 `edit_code.ts:501`「insert 建新文件」**同一做法**：先建目录再落盘，否则 `ENOENT`。
  //    （此前 `applyWrites` 写陌生目录必 `ENOENT`；只补这一处目录创建，不动写入/快照/索引/根外任何政策。）
  for (const f of files) {
    const abs = path.isAbsolute(f) ? path.resolve(f) : path.resolve(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
  }
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

  return { value, report: { touched: rels, snapshot, index, task_gate: taskGate.note } };
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
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  // ★★★ T328 步 6：**未登记不许落盘** —— 同步签名的工具（remove_dead_imports / scaffold）走这条。
  //   ★ 闸在快照 + 自写登记**之前**（拒绝就是拒绝；否则"登记了自写却没落盘"会留下假账）。
  assertSourceWriteRegistered(root, files);
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
