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

import { readCanvas, writeCanvas } from '../infrastructure/canvas_store.js';
import { selfWritesPath, SELF_WRITE_TTL_MS, readSelfWrites, type SelfWriteEntry } from '../infrastructure/index/self_writes.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectCacheDb, beginBatch, endBatch, projectCacheDbPath, type Database } from '../infrastructure/index/db.js';
import { syncFile, syncFileSync, removeFile, changedSymbolNames, reopenRefsTo, resolveCrossFileCalls, type SyncStatus, type CrossFileResolveStats , toIndexKey, toRelPath } from '../infrastructure/index/symbols.js';
import { canParseFileSync } from '../infrastructure/parse/index.js';
import { snapshotBeforeWrite, type FileSnapshotMeta } from './refactor/snapshot/file_snapshot.js';
import { indexCoversDisk } from '../infrastructure/index/index_freshness.js';
// ★★★ T328 步 6：**任务闸**要读「项目 → 设计 feature」的反查与 overlay 的 progress（唯一权威）。
//   ★ 反查口径**与 `file_snapshot.ts`（T90）逐字同款**（`DSL.source_root === 项目根`）——
//     那条路已在本仓跑过（它记"写前那一刻的决策"），此处**复用同一把尺**，不另立一套。
import { listDesignSheets, getDSL, saveDSL } from '../infrastructure/storage.js';
import { loadOverlay } from '../infrastructure/storage_overlay.js';
import type { Annotation } from '../domain/annotation.js';
// ★★★ 2026-10-20（`docs/certs-4-ways.md` 裁决 ③）：豁免判据的**取值域**住 `domain/geometry.ts`，
//   本文件**只读**它（`nodes[].gate`）—— **不按路径前缀判**（路径前缀 = 本仓头号病根）。
import type { DiagramStatus, NodeGate } from '../domain/geometry.js';
// ★★★ T356（2026-10-20）：「按 run 授权」（`authorize`）的**文法不新造** —— 直接用 `domain/scope.ts`
//   那一对（`parseScope` / `resolveScope`，与 `get_dsl` 的 `scope` 参数、`design_diff` 的圈定**同一份**）。
//   ★★ 但 **scope → 文件** 这一步**不许**用 `resolveScope().paths` —— 那是 `semantic.files` 口径，
//     实测会漏掉「只有节点 `path`、不在 `semantic.files` 里」的文件（本仓 `src/application/design/board/pool.ts`
//     就是这种）⇒ 必须**反查闸自己的 `byPath`**（`collectGateCoverage` 建的那张，`nodeFilePath` 的
//     「`path` 优先、回落 `description`」口径）。★ 判据只有一份，别再造第二个读端。
import { formatScope, parseScope, resolveScope, type Scope } from '../domain/scope.js';
// ★★★ 2026-10-21（并发控制·账户）：**"什么算合法身份"的定义住 `domain/actor_spec.ts`**（唯一处）。
//   本文件只**消费**它（解析 / 比对 / 开关）—— 不在这里写第二套正则：否则 read_set 的分桶与
//   写闸的判定会各判一套，"同一个人"在两边含义不同（本仓头号病：第二份判据）。
import { admitActor, actorStrictMode, sameActor } from '../domain/actor_spec.js';
// ★★★ 2026-10-17（OQ10 裁定）：闸的判据从「overlay 的 progress 是否登记过」改成
//   「**该节点上是否有 state=claimed 的 task**」—— 任务格是唯一权威（`task_plan.task_home`），
//   progress 对它只是派生值（`progressOf`）。
import { progressOfNode, taskOfNode, type NodeProgress, type TaskSpec } from '../domain/task_schema.js';
// ★★★ 2026-10-21（并发控制·读集比对）：**假设检定**（「我读过的东西是不是被别人改了」）。
//   ★ 与 A7（谁在写）**两个字段、两条判据**：A7 管身份，这一条管"假设是否过期" ⇒ 别混。
//   ★ 这里只 import **判定内核 + 类型**：记录端在 `invokeTool`（读集从 read/facts 的产物里来），
//     本文件**不**去读工具回执（那是 presentation 的事）。
import { checkAssumptions, refreshAfterOwnWrite, type AssumptionCheck, type AssumptionTarget } from './read_set.js';

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
  /**
   * ★★★ 2026-10-21（A7 回执闭合）：**闸的一句话留痕** —— 与 `SourceWriteReport.task_gate` **同名同义**。
   *
   * ## 补的是什么
   * `snapshotAndRecordSelfWrite` 一直调 `assertSourceWriteRegistered`（判据跑了），但**把返回值丢了**
   * ⇒ `remove_dead_imports` / `deprecate_offline` 走这条同步写路时，闸判了、豁免点名了，回执里一个字都没有
   * （实测：`data` 里连 `task_gate` 字段都没有）。
   * ⇒ 判据仍只住 `assertSourceWriteRegistered` **一处**，本字段只是把它的 `note` **逐字**带出来。
   * ★ 被拒时不会走到这里（闸直接抛）。
   */
  task_gate?: string;
  /** ★ 2026-10-21（读集比对）：假设检定读数 —— 与 `task_gate` **两件事**，见 `TaskGateOutcome.assumption_check` */
  assumption_check?: AssumptionCheck;
}

// ─────────────────────────────────────────────────────────────
// 写源码的**回执类型**已搬到 `application/source_writer.ts#SourceWriteReceipt`
// ─────────────────────────────────────────────────────────────
// 为什么搬：回执只有写入器才产出；本文件不再有写入器 ⇒ 也不该再持有"写入回执"的形状
// （否则调用方会以为"从闸里能拿到写入回执"，而闸只给判据）。
// ★ `task_gate` 在新回执里是**必填**（这里原先是 `task_gate?: string`）—— 见 source_writer 的说明。

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
  opts: {
    syncIndex?: boolean;
    /**
     * 逐文件回报索引同步结果（`SyncStatus`）—— 与 async 版的 `onFile` **同名同义**。
     * ★ 2026-10-22：给 `source_writer` 的调用方用（`apply_writes` 的 `index_synced` 要逐文件 `updated`）。
     *   它只是**读数**，不改判据、不改写盘顺序 —— 不是绕过口。
     */
    onFile?: (rel: string, status: SyncStatus) => void;
  } = {},
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
        opts.onFile?.(rel, r.status);
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

/** 任务闸的判据结果 —— `applicable:false` **只**表示「本项目不用任务系统」（**要报出来，不许静默**） */
export interface TaskGateOutcome {
  applicable: boolean;
  /** 人读原因（放行时给出依据：凭什么放行） */
  note: string;
  /**
   * ★★★ 放行/不适用的**依据分类**（2026-10-17 · T352 · `docs/_extract/flow-check-1.md` F7）。
   *
   * 为什么必须分类：`applicable:false` 原先同时装着两种完全不同的处境 ——
   *   ①「本项目**不用**任务系统」（配置层面，合法放行）；
   *   ②「我**该找到节点却没找到**」（收集失败：节点缺 `path`/`description`）。
   * ⇒ ② 被静默混进 ① ⇒ 注释写着"不许静默"，代码在静默 ⇒ **闸看不见卡**。
   * ⇒ 现在 `applicable:false` **只许**来自 `no-files` / `no-feature-for-root`；
   *   收集失败**不走本字段**：它走 `basis:'unaddressable'`（`applicable:true` = 放行）+
   *   `warnings`（★ 2026-10-17：从"抛错"退成"点名 + 放行 + 留痕"，见 `recordUnaddressableWarnings`）。
   */
  basis: TaskGateBasis;
  /**
   * ★★★ **放行时留下的警告**（2026-10-17 · 闸原则「提醒」= `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.core`）。
   *
   * 来源只有一个：**收集失败**（文件节点既无 `path` 也无 `description`）。
   * ★ 它**不损坏数据**（只是"这次写没在账上被核对"）⇒ 按原则**放行 + 留痕**，
   *   而不是抛错（抛错仍然是把流程堵死：`write_gate` 是"改源码"的咽喉，
   *   一个缺 `path` 的老节点会让**整个项目的源码都改不动** = 死循环）。
   * ★ 留痕的**真落点**不是这里（这里是"本次调用"的读数）：每条警告同时写进该 feature 的
   *   `dsl.annotations[]`（`type:'issue'` · `severity:'warning'` · `resolved:false` · `author:'write_gate'`），
   *   读端 = `query_feature {query:'annotations', feature, unresolved_only:true}`（`annotation_tools.ts#listAnnotations`）。
   *   ★ 为什么落那儿：它是本仓**唯一**带"问题/未解决"语义、且**已有读工具**的记录位；
   *   `overlay` 的警告列表没有读端（写进去等于又一处"写而无人读"）。
   */
  warnings: string[];
  /**
   * ★★★ 2026-10-20（`docs/certs-4-ways.md` ③）：本次**靠设计侧声明豁过去**的文件。
   *
   * ★ “豁免必须可查，不许静默”的**结构保证**：闸给出清单，调用方（`edit_code`）按它**点名**。
   * ★ 空数组 = 本次没有任何豁免（不是“没算”——没算就跑不到这里）。
   */
  exempted: GateExemption[];
  /**
   * ★★★ 2026-10-21（并发控制·读集比对）：**假设检定** —— 「本次要写的符号，是不是已经和某人的读集不一样了」。
   *
   * ★ **独立字段，别混进 `task_gate`**：`task_gate` 回答「这次写有没有挂到任务上 / 卡是不是你的」（A7 身份），
   *   本字段回答「你/别人**读到的那个版本**还是不是现在这一版」（假设是否过期）。
   *   混进一个判据 = 判据分叉（本仓头号病）。
   * ★ **不阻塞**：`stale` 非空也照常落盘（用户 2026-10-21：「只报，不拦」）。
   * ★ 恒有值（`checked:0` 也是读数：读集里没有与本次写集相交的东西）；唯一例外是检定自身抛错，
   *   那时 `error` 字段如实说明（**不是**"没查"）。
   */
  assumption_check?: AssumptionCheck;
}

/**
 * ★★★ 2026-10-22（写闸覆盖面 · ③）：「这次要写的**主体**是什么」——**一条判据，四类取值**。
 *
 * ## 为什么是分类而不是逐个工具 if（这是本仓头号病的形状）
 * 2026-10-22 盘点：全仓有 10 处「源码写」在闸外，牵涉 6 个工具。若按工具一个个问「给不给它闸」，
 * 答案会散落在 6 个文件里、下次加第 7 个工具时**没人知道该照哪条**。
 * ⇒ 判据只回答**一类问题**：「这条路径上的字节，是不是用户的源码？」
 *   是 ⇒ **必须过闸**；不是 ⇒ **不必过**（且必须能说出它属于哪一类）。
 *
 * ## 四类（取值互斥、可机械判定）
 * | subject | 判据（按顺序，先命中先定） | 要不要闸 |
 * |---|---|---|
 * | `outside-root` | `toIndexKey(root, abs) === null`（根外） | **判不了也管不着**（闸的键空间是「相对根的路径」） |
 * | `temp` | 在 `os.tmpdir()` 之下 | **不要**（探针/编译/试跑文件，不是用户源码） |
 * | `product` | 首段是产物目录（`.agent-io` / `.agent` / `design-db` / `dist` / `node_modules` / `output`），或本身就是产物文件（`agent-io.json`） | **不要**（工具自有状态，另一条通道） |
 * | `source` | 其余 | **必须**（这就是「改用户源码」） |
 *
 * ## 实测锚点（2026-10-22，用来校准分类，别当结论抄）
 * · `upgrade` 的 4 个 adapter 写点（java.ts:110/163 · node.ts:106 · python.ts:122）全在 `os.tmpdir()` ⇒ `temp`
 *   —— 它们写的是**单文件编译/试跑的临时副本**，不是用户源码 ⇒ **豁免不是懒，是判据**。
 * · `go_instrument.ts:345`（go.mod 修补）是 `source` ⇒ **该有闸**。★ 2026-10-22 收口：它原本是
 *   本文下面点名的“已知缺口”（裸 `fs.writeFileSync`），现改走 `source_write_port#commitSourceWrite`
 *   —— 缺注入就抛、闸拒就上抛（不再回落裸写）。
 * · `derive_split` / `diagnose_loop` / `observe_instrument` / `upgrade apply` 全 `source` ⇒ 已接闸。
 */
export type WriteSubject = 'source' | 'product' | 'temp' | 'outside-root';

/** 产物目录首段（★ 唯一住处：别在别处再列一遍） */
const PRODUCT_TOP_DIRS = new Set(['.agent-io', '.agent', 'design-db', 'dist', 'node_modules', 'output']);
/**
 * ★ 2026-10-22（分类口径补格）：**本身就是产物文件**的顶层条目（不是目录）。
 *   唯一成员 `agent-io.json` = `storage.ts#getLiveDslFile()` 的活态视图（`data_dir.ts` 里点名的“第三份”，
 *   现只删不写）。它住在 dataHome 根下 ⇒ 首段不是目录 ⇒ 只靠 {@link PRODUCT_TOP_DIRS} 会被误判成 `source`。
 */
const PRODUCT_TOP_FILES = new Set(['agent-io.json']);

/** 判「这个写属于哪一类主体」（纯函数，无 IO） */
export function classifyWriteSubject(root: string, abs: string): { subject: WriteSubject; why: string } {
  // ★ 顺序即判据（先命中先定）：temp 要在 outside-root **之前** ——
  //   系统临时目录本来就在项目根外，若先判 outside-root，就永远说不出「这是临时副本」这件更有用的事实。
  const norm = abs.replace(/\\/g, '/');
  const tmp = path.resolve(os.tmpdir()).replace(/\\/g, '/');
  if (norm === tmp || norm.startsWith(tmp + '/')) return { subject: 'temp', why: `在系统临时目录下（${os.tmpdir()}）：临时副本，不是用户源码` };
  const rel = toIndexKey(root, abs);
  if (rel === null) return { subject: 'outside-root', why: '不在项目根内：造不出「相对根的路径」⇒ 闸的键空间里没有它' };
  const top = rel.split('/')[0];
  if (PRODUCT_TOP_FILES.has(rel)) return { subject: 'product', why: '「' + rel + '」是产物文件（工具自有的活态视图）' };
  if (PRODUCT_TOP_DIRS.has(top)) return { subject: 'product', why: '首段「' + top + '」是产物/状态目录（工具自有，不是用户源码）' };
  return { subject: 'source', why: '项目根内的普通路径 ⇒ 改它就是改用户源码' };
}

/**
 * ★ 闸拒绝的**前缀**（唯一取值处）：所有拒绝文案都以它开头（`拒绝落盘（…）：`）。
 * ★ 为什么要有它：调用方要把「被闸拦下」和「世界不好」分开（前者必须 `isError`，否则脚本里
 *   "没写成"与"做成了"长得一样）；而拿散文去 `includes('拒绝')` 嗅探 = 判据住两处。
 */
export const GATE_REJECTION_PREFIX = '拒绝落盘';

/** 这个错误是不是**闸的拒绝**（唯一判据：文案前缀 = {@link GATE_REJECTION_PREFIX}） */
export function isGateRejection(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err ?? '');
  return m.startsWith(GATE_REJECTION_PREFIX);
}

/** 任务闸放行的依据分类（★ 唯一取值处；`applicable:false` 只许前两格） */
export type TaskGateBasis =
  | 'no-files' // 没有落在项目根内的文件
  | 'no-feature-for-root' // 没有任何 feature 的 source_root 指到项目根（= 本项目不用任务系统）
  | 'files-not-in-design' // 有 feature 指到根，但这批文件不在任何一条里（新建 / 未纳入设计）
  | 'unaddressable' // ★ 2026-10-17：有文件节点**收集失败**（缺 path/description）⇒ 放行 + 留痕（不再抛错）
  | 'exempt' // ★ 2026-10-20：**设计侧声明豁免**（指向它的节点全部 gate='exempt'）⇒ 放行 + 点名
  | 'authorized' // ★★★ T356（2026-10-20）：**按 run 授权**（`authorize`）—— 本批**全部**落在该 scope 内 ∧ scope 里有你的 claimed 卡
  | 'covered'; // 有覆盖 feature，已逐个判过任务卡

/** 一条 covering feature 的 `path → node_id` 表 + 任务格 */
export interface GateCoverageFeature {
  feature: string;
  byPath: Map<string, string>;
  /**
   * ★★★ 2026-10-20：**与 `byPath` 同键空间**的 `gate` 读数（`undefined` = 节点没声明 ⇒ 按 `gated`）。
   *
   * ★ 为什么另开一张表而不是改 `byPath` 的值形状：`byPath` 是既有契约
   *   （`certs/t352-*` / `t353-*` 直接把值当 node_id 比对）⇒ 改形状 = 多破两条证。
   * ★ 两张表**在同一个循环里建**（见 `collectGateCoverage`）—— 不许在别处再建第三张。
   */
  gateByPath: Map<string, NodeGate | undefined>;
  /** ★ node_id → **权威卡**（`todos[]` 里 `node_id` 指向它的那张；没有才回落 `geometry.nodes[].task` 投影）—— 闸的判据读它（OQ10） */
  taskById: Map<string, TaskSpec>;
  /**
   * ★★★ 2026-10-22（progress 权威归一）：`todos[]`（预决策卡）—— 交给 `progressOfNode` 判“是否有卡指向本节点”。
   * ★ 为什么闸也要它：`domain/overlay.ts#applyOverlay` 已经把「`todos[].node_id` 指向本节点」算作“有卡”，
   *   闸不带上它就会对同一节点给出**另一个答案** —— 那正是本笔要治的病。
   */
  todos: readonly TaskSpec[];
}

/**
 * ★★★ 一次**被豁免**的写入（2026-10-20 · `docs/certs-4-ways.md` ③）——“豁免必须可查，不许静默”
 * 的结构化载体：闸把“哪些文件靠什么豁的”交回给调用方，调用方**必须**在回执里点名。
 *
 * ★ 为什么是结构化而不是只拼字符串：`note` 是给人读的；调用方要判“这次要不要点名”，
 *   只能靠 `note.includes('豁免')` 那种**字符串嗅探** —— 那是本仓反复报过的“拿文本当判据”。
 */
export interface GateExemption {
  /** 仓库相对路径（posix 分隔） */
  path: string;
  /** 依据：哪个 feature 的哪个节点声明了 `gate:'exempt'`（AND 语义 ⇒ 指向它的节点全部列出） */
  by: Array<{ feature: string; nodeId: string }>;
}

/**
 * ★★★ **收集**的结果（与"判定放行"分家 —— 这是本刀的结构）。
 *
 * 为什么分开：放行是一句**结论**，而"有没有收集到节点"是它的**前提**。
 * 前提失败而结论照给（`applicable:false`）就是**静默 fail-open**。
 * ⇒ 收集失败那一格（`unaddressable`）在 `assertSourceWriteRegistered` 里
 *   **先于**任何"看起来像不适用"的分支被单独处理：★ 2026-10-17 起 = **点名 + 放行 + 留痕**
 *   （`basis:'unaddressable'` + 写 `annotations`）—— **不是静默**，也**不是抛错**（那会造死循环）。
 */
export interface GateCoverage {
  /** 收集到的 covering feature（有 `path → node_id` 表的那些） */
  features: GateCoverageFeature[];
  /** 设计侧（`design/*.dsl.json`）一共列到多少条（放行 note 的依据读数） */
  totalFeatures: number;
  /** `source_root` 指到项目根的 feature 条数（= 0 ⇒ 合法的 applicable:false） */
  rootFeatureCount: number;
  /** ★ 收集失败：文件/文档节点**既无 `path` 也无 `description`** ⇒ 必须点名报出 */
  unaddressable: Array<{ feature: string; nodeId: string; type: string | undefined }>;
}

/**
 * 一个节点指向的**仓库相对路径**（`path → node_id` 的左边）。
 *
 * ★★ 口径（2026-10-17 · T352）：**`path` 优先，回落 `description`** —— 两个都是既有字段，不新造。
 *   · `path` = **显式文件指针**（`Node` 类型没声明它，但设计 DSL 里已有；`task_machine.ts` 的
 *     `StandingNode.path` 与 `task_ops` 的归属判定读的是同一个字段）⇒ 一律认，不看 `type`；
 *   · `description` = **老写法**（scan 产出的文件/文档节点把路径写在 `description` 里）⇒
 *     只对 `file`/`doc` 节点读（别的节点上那是人话，不是路径）。
 *
 * ★ 为什么必须补 `path`：本仓的 `task-system-plan` feature 5 个文件节点**全部用 `path`、
 *   `description` 为 0** ⇒ 旧口径（只认 description）把它们全漏掉 ⇒ 整条 feature 被跳过
 *   ⇒ 写闸对"人写的 DSL"是装饰（F7 实测）。
 */
function nodeFilePath(
  n: { type?: string; description?: string } & { path?: string },
  sep: string,
): string | undefined {
  const explicit = n.path;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.split(sep).join('/');
  if (n.type !== 'file' && n.type !== 'doc') return undefined;
  const legacy = n.description;
  if (typeof legacy !== 'string' || !legacy.trim()) return undefined;
  return legacy.split(sep).join('/');
}

/**
 * 该项目根上「**覆盖某批文件**」的设计 feature 列表（每个带 `path → node_id` 表）。
 *
 * ★★★ 2026-10-20：**枚举源 = 设计侧**（`storage.ts#listDesignSheets` → `getDesignSheet`，与 `getDSL` 同一处）。
 *   此前走 `listFeatures()` 读 `features/` —— 那个目录 2026-10-18 搬走后只剩 overlay ⇒ 返回 `[]`
 *   ⇒ `rootFeatureCount=0` ⇒ `applicable:false`（"本项目不用任务系统"）⇒ **闸对全仓源码恒放行**。
 *   ★ 实测（本仓）：`totalFeatures=2 / rootFeatureCount=2 / covering=2`，`write_gate.ts` 判 `covered`。
 *
 * ★ 反查口径与 `file_snapshot.ts`（T90）**逐字同款**：`path.resolve(DSL.source_root) === 项目根`。
 * ★ 与 T90 的差别（**有意**，别照着 T90 的 `hits.length===1` 改回来）：T90 是"给快照**贴一条**意图"，
 *   贴错比不贴坏 ⇒ 只认**唯一命中**；本闸问的是"这次改动**有没有挂在任何一条**任务上"
 *   （要求原文："**没有挂到任何任务/进度登记上** ⇒ 拒绝"）⇒ 只要**覆盖了**就要登记，
 *   多feature 时只要**任一**登记过就算通过 —— ★ 仍然**不需要替人挑**哪一条。
 *
 * ★★★ 与旧版的差别（T352）：**收集失败不再被 `if (byPath.size)` 静默吞掉** —— 旧版
 *   一个 feature 的 `byPath` 为空就 `continue`，于是"节点缺 description"变成"这条 feature 不存在"
 *   ⇒ 调用方读到 `applicable:false`（放行）。现在把它们分装在 `unaddressable`
 *   里**交给调用方点名 + 留痕**（★ 2026-10-17：不再抛 —— 见 `recordUnaddressableWarnings`），
 *   并额外带出 `totalFeatures` / `rootFeatureCount` 作为放行依据的读数。
 */
export function collectGateCoverage(rootArg: string): GateCoverage {
  // ★ 入口自己归一（导出函数，调用方可能给相对路径；与 `assertSourceWriteRegistered` 同一把尺）
  const absRoot = path.resolve(rootArg);
  const cov: GateCoverage = {
    features: [],
    totalFeatures: 0,
    rootFeatureCount: 0,
    unaddressable: [],
  };
  // ★★★ 2026-10-20：读**设计侧**（`getDesignSheet` 同一处），不是 `listFeatures()` 的 `features/`。
  //   实测病：features/ 搬走后只剩 overlay ⇒ listFeatures() 返回 [] ⇒ rootFeatureCount=0
  //   ⇒ applicable:false（"本项目不用任务系统"）⇒ **闸对全仓源码恒放行**。
  for (const d of listDesignSheets()) {
    cov.totalFeatures++;
    if (!d.source_root || path.resolve(d.source_root) !== absRoot) continue;
    cov.rootFeatureCount++;
    const byPath = new Map<string, string>();
    // ★★★ 2026-10-20：**与 `byPath` 在同一个循环里建**（同键空间）—— 豁免判据的唯一读数处。
    const gateByPath = new Map<string, NodeGate | undefined>();
    /** ★ 只给下面 `semantic.files` 兜底用：那一路只知道 id，要按 id 找节点上有没有声明 gate */
    const gateById = new Map<string, NodeGate>();
    const taskById = new Map<string, TaskSpec>();
    // ★★★ 2026-10-22（迁移第②步 · 读端切到 todos[]）：**闸问「谁占着」改读权威住处**。
    //   旧写法 `if (n.task) taskById.set(n.id, n.task)` 读的是**派生投影** ⇒ 第①步之后同一张卡
    //   在 `nodes[]` 与 `todos[]` 各一份，闸读哪一份没写明（在 todos 侧 claim / complete 它看不见）。
    //   ★ 判据只住 `task_schema#taskOfNode`（todos 卡优先；没有 todos 卡才回落 `node.task`）。
    for (const n of d.geometry?.nodes ?? []) {
      const card = taskOfNode(n, d.todos ?? []);
      if (card) taskById.set(n.id, card);
      if (n.gate) gateById.set(n.id, n.gate);
      const rel = nodeFilePath(n as { type?: string; description?: string } & { path?: string }, path.sep);
      if (rel) {
        byPath.set(rel, n.id);
        gateByPath.set(rel, n.gate); // ★ 未声明 ⇒ undefined ⇒ 下面一律按 gated 处理（安全方向）
        continue;
      }
      // ★ 只有"文件型节点"才算收集失败 —— 聚合/模块节点本来就不指文件。
      if (n.type === 'file' || n.type === 'doc') {
        cov.unaddressable.push({ feature: d.feature, nodeId: n.id, type: n.type });
      }
    }
    // 兜底：`semantic.files` 里有、几何层没有同名节点的（不该发生，但**不静默漏判**）
    for (const f of d.semantic?.files ?? []) {
      if (f.path && !byPath.has(f.path)) {
        const rel = f.path.split(path.sep).join('/');
        byPath.set(rel, f.id);
        // ★ 这条路只知道 id：按 id 回查节点有没有声明 gate。查不到 ⇒ undefined（按 gated）。
        //   ★ 不补这一行的话，「只有 semantic.files 指着的文件」将**永远无法被豁免**
        //   （今天实测 0 条这样的路径，但那是数据现状，不是设计）。
        gateByPath.set(rel, gateById.get(f.id));
      }
    }
    // ★ `byPath` 为空且 `fileNodes > 0` 已在上面进 `unaddressable`（那只可能是"节点不可寻址"这一种病因）
    if (byPath.size) cov.features.push({ feature: d.feature, byPath, gateByPath, taskById, todos: d.todos ?? [] });
  }
  return cov;
}

/**
 * ★★★ **收集失败的留痕**（2026-10-17 · 闸原则「提醒」+ 当时「4 处堵」清单第 3 条「收集失败 ⇒ 点名 + 放行 + 留痕」；
 * 判据典 = `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.core`「不会毁坏数据 ⇒ 提醒 + 放行」）。
 *
 * ## 改前 / 改后（一句话）
 * · 改前（T352）：`unaddressable` 非空 ⇒ **抛错**，源码**一个字节都不写**；
 * · 改后（本笔）：**点名 + 放行 + 留痕** —— 因为"某个老节点没写 `path`"**不损坏数据**，
 *   它只说明"这次写**没在账上**"（= 记录问题，不是数据问题）。
 *   ★ 继续抛的代价是**死循环**：`write_gate` 是所有源码写的咽喉，一个缺字段的节点
 *     会让整个项目改不动，而要补字段又得先改……（正是闸原则 §三 说的"环"：`.agent-io/design/task-system-plan.dsl.json`
 *     的 `task_plan.gate_principle.independent_entries`「必须有下游的产物才能进 ⇒ 那不是闸，是环」）。
 * ★★ **"不许静默"这条没有退**：改前是"抛"，现在必须**点名 + 落盘留痕**，
 *    退回"不报、直接放行"照样是本证要打红的错。
 *
 * ## 留痕落点（为什么是 `dsl.annotations[]`）
 * 候选三处，逐条否掉两处：
 *   · `overlay` 锚点的警告列表 —— **没有读端**（本仓头号病：写进去没人读）；
 *   · 卡上的 `discussion` —— **该节点没有卡**（收集失败恰恰发生在"连节点都指不出文件"时）；
 *   · ✅ `dsl.annotations[]` —— 唯一**既有读工具**（`query_feature {query:'annotations'}` /
 *     `annotation_tools.ts#listAnnotations`）且语义就是"问题、可 resolve"的记录位；
 *     ★ 且 base 的 annotations 会被 `seedOverlayFromDsl` 搬进 overlay（`overlay.ts:634`）⇒ 重建不丢。
 * ★ 幂等：同一天同一节点**只留一条**（`gate_warn_<nodeId>_<yyyymmdd>`）；已被 `resolve` 的不重开。
 *
 * ★ 本函数**绝不抛**（留痕失败不许反过来堵住写盘）：失败如实写进返回的警告行里。
 */
function recordUnaddressableWarnings(
  items: GateCoverage['unaddressable'],
  rels: readonly string[],
): string[] {
  const out: string[] = [];
  const now = new Date().toISOString();
  const day = now.slice(0, 10).replace(/-/g, '');
  const files = rels.slice(0, 5).join(', ') + (rels.length > 5 ? ` 等 ${rels.length} 个` : '');
  for (const u of items) {
    const id = `gate_warn_${u.nodeId}_${day}`;
    const text =
      `写闸放行留痕（收集失败）：节点 "${u.nodeId}"**既无 path 也无 description** ⇒ 它指不出"哪个文件"，` +
      `本次写盘的任务闸**无法核对**该节点。\n` +
      `★ 本次放行的文件：${files}\n` +
      `★ 为什么不拦：缺字段**不损坏数据**，只是"这次写没在账上"（记录问题）；拦它会让整个项目改不动。\n` +
      `★ 怎么消掉这条：给该节点补 \`path\`（仓库相对路径，推荐）或 \`description\`（老写法，仅 file/doc 节点）：\n` +
      `  edit_dsl { feature:'${u.feature}', reason:'补文件指针', operations:[{ type:'node', op:'update', id:'${u.nodeId}', data:{ path:'<仓库相对路径>' } }] }\n` +
      `  或若它确实不指文件（聚合/概念节点）⇒ 把 type 改成非 file/doc。`;
    // ★★★ 2026-10-23（和前端切割·第二步）：**不再落盘留痕**。
    //   用户裁定「前端只是一个显示屏…给前端用的这些都不需要」⇒ 批注层整个退场。
    //   这些提示仍然有用，但它们是**给 Agent 的回执**，不是要人来看的画布数据 ⇒ 只进回执。
    const where = `★ 这条要在本轮回执里看到（不再写进任何画布文件）。`;
    out.push(
      `· 节点 ${u.nodeId}（feature=${u.feature}，type=${u.type ?? '?'}）**既无 path 也无 description**；${where}\n` +
        `  ★ 读它：query_feature { query:'annotations', feature:'${u.feature}', unresolved_only:true }`,
    );
  }
  return out;
}

/**
 * ★★★ 豁免的**回执点名**（唯一渲染处；2026-10-20 · `docs/certs-4-ways.md` ③）。
 *
 * 规则：**回执必须点名**：本次写入 `<path>` 被豁免（节点 `gate=exempt`）—— **不许静默**。
 * ⇒ 只要本批里有豁免，回执（含**拒绝**那种回执）就必须把它写出来：
 *   · 豁免了**什么**（路径）· **凭什么**（哪个 feature 的哪个节点）· **谁定的**（设计侧，不是闸）。
 * ★ 空数组 ⇒ 返回空串（不加噪声）——但“豁免了却不说”在任何分支都不允许。
 */
export function exemptionLines(exempted: readonly GateExemption[]): string {
  if (!exempted.length) return '';
  return (
    `★ 本次写入 ${exempted.length} 个文件被豁免（依据：**设计侧**节点声明 \`gate='exempt'\`；闸不替你豁免，只读它）：\n` +
    exempted
      .map(
        (e) =>
          `  · 本次写入 ${e.path} 被豁免（节点 ${e.by.map((b) => `${b.nodeId}，feature=${b.feature}`).join(' / ')}，gate=exempt）`,
      )
      .join('\n')
  );
}

/**
 * ★★★ **任务闸：改源码可以，但不领任务不许悄悄改**（T328 步 6；★ 判据 2026-10-17 按 OQ10 换过）。
 *
 * ## 它回答什么
 * 「这次要落盘的改动，**挂在哪个已领取的任务上**？」——没有 ⇒ **拒绝落盘**，
 * 并在错误信息里给出「**怎么领**」（工具名 + 最小参数）。
 *
 * ## ★ 为什么是"拒"而不是"提示"（本仓已证过的一类腐坏）
 * 靠提示词要求"自己记得登记"= **又一条会腐的软约束**（md todo 侧实测：26 勾 vs 77 未勾，
 * 且"勾了"≠"做了"）⇒ 唯一"结构上不可能绕过"的位置就是**写入咽喉**（`docs/replan-2026-10-15.md` §12.5）。
 *
 * ## ★★ 两条**硬**纪律（与 `validateProgressEvidence` 同族）
 * 1. **不静默**：被拒 ⇒ 抛错，且错误信息里含领取入口；放行的分支 ⇒ 由调用方**报出** `note`。
 * 2. **不自动补登记**：本函数**绝不**替调用方 claim，也**不**把这次写入降级放行 —— 拒绝就是拒绝。
 *
 * ## ★★★ 登记是什么（唯一权威 = `task.state`；2026-10-17 换判据）
 * 旧判据（T328）：`<feature>.overlay.json` 锚点的 `progress !== undefined`。
 * ★ 实测它**对已播种的 feature 是装饰**（OQ10）：`seedOverlayFromDsl` 会把几何节点的 `status`
 *   播种成 `progress` ⇒ 每个节点"都已登记"（哪怕从没调过 `edit_dsl`）。
 * 新判据（OQ10 裁定）：**该节点上有 `state === 'claimed'` 的 task**（任务格 = `geometry.nodes[].task`，
 *   唯一写端 `edit_dsl {type:'task', op:'claim'}`，见 `dsl_ops/task_ops.ts`）。
 * ⇒ 本闸**只读**任务格，与"唯一权威"同源（不另立第二份"登记"）。
 *
 * ## ★ 拦的范围（明写，便于判"谁被拦/谁不被拦"）
 * 拦：`项目根上有设计 feature 覆盖该文件（DSL.source_root === 项目根 ∧ 该文件是它的文件节点）`
 *    ∧ `覆盖它的那些 feature 里【没有一条】在该节点上有一张 claimed 任务卡`。
 * 放行：该项目**没有** feature 指向它（`no-feature-for-root`，合法）· 文件**不是**任何一条的节点
 *      （新建文件 / 未纳入设计，`files-not-in-design`，逐个点名）·
 *      在**任一**覆盖它的 feature 里该节点有 `state='claimed'` 的 task（`covered`）。
 * ★★★ 拒绝之外的第三种结果（T352 → **2026-10-17 改**）：收集失败 ⇒ 既**不是拒绝**、也**不许**被读成"不适用"：
 *      **放行 + 点名 + 留痕**（`basis:'unaddressable'`；留痕写进该 feature 的 `annotations`）。
 *      ★ 为什么不拒：它**不损坏数据**（只是"这次写没在账上"）；拒会让"一个老节点缺字段"把整个项目锁死
 *      （闸原则「提醒」的判据「**它会损坏数据吗**」⇒ 不会就放行；`.agent-io/design/task-system-plan.dsl.json`
 *      的 `task_plan.gate_principle.core`）。★ 前置闸（下一条）**仍然拒** —— 那一条会真的造成不一致。
 *
 * ## ★★ T332（2026-10-15）**追加**的第二条判据：前置闸（解锁）
 * 上面这条之外，**追加**：某条 edge intent **显式**声明了 `requires`（非空）∧ 该边源节点(from)
 * 是本次要改的文件节点 ∧ requires 里有节点未 `done` ⇒ 拒绝（"完成 A 才准开始 B"）。
 * ★ **只认显式 `requires`** —— edge 默认装 import 依赖 ≠ 任务前置 ⇒ **没标 requires 一律不拦**（防误伤，
 *   别把全仓 import 边当成解锁条件）。判据与"怎么办"见下方 `unmetPrereq` 段。
 * ★ 本条里的"是否 done"读**派生进度**：有 task ⇒ `progressOf(task)`；没有才回落 overlay 的 `progress`
 *   （交接期两轴并存，派生值优先 —— 与 `overlay.ts#applyOverlay` 同一把尺）。
 */
/**
 * ★★★ **谁在写**（2026-10-17 · A7 · `docs/DESIGN.md` A7）。
 *
 * ## 它补的是什么洞
 * 闸原来的唯一判据是「覆盖该文件的节点上**存在** `state==='claimed'` 的卡」——
 * ★ **不问 owner、不问时效** ⇒ 历史上任何人领过的卡，都是该文件的**永久万能钥匙**。
 * ★ 叠加另一个洞（`patrolDrift` 全仓零调用 ⇒ 卡永不过期）后：**任务闸对"谁在改"完全不设防**。
 *   ★★ **2026-10-22 更新**：那个洞已补 —— `scripts/patrol.mjs:39` import 了 `patrolDrift`、`:50` 调用它，
 *      并已挂 `npm run patrol`（`package.json`）。⇒ 上面这句"零调用"**已经过期**，留作历史；
 *      真正要盯的是「**它有没有被定期跑**」（这是"接入点没接"那一类，不是"零调用"）。
 *
 * ## 三种情形三种处置（`docs/GOAL.md` G2 的一次实演 —— 同一道闸，不是"要么全放要么全拦"）
 * | 情形 | 处置 | 依据 |
 * |---|---|---|
 * | 有 actor，且 `owner` 不匹配 | ★ **阻断**（throw） | "改别人的活"**会**覆盖别人的工作 ⇒ 损坏数据 ⇒ 该堵 |
 * | 有 actor，且 `owner` 匹配 | 放行 | |
 * | **拿不到 actor** | ★ **提醒 + 放行 + 留痕**（warning） | 不知道是谁 ⇒ 不损坏数据 ⇒ 不该堵 |
 * ★ 还有一格：卡上 `owner` 为空（匿名领的）⇒ 无法比对 ⇒ 放行（同上）。
 */
export type WriteActor = string;

/**
 * ★★★ 2026-10-20（A7 闭合 · 逐调用自报）：**actor 的唯一解析处**。
 *
 * 三个来源，优先级从上到下（**只有这一处**，claim 与写共用它 ⇒ 才保证 `owner === actor`）：
 *   ① 显式入参 `actor`（MCP/CLI 逐调用传的顶层保留键，见 `server_registry#RESERVED_CALL_ARG`）；
 *   ② 环境变量 `AGENT_IO_ACTOR`（会话级兜底；★ `scripts/install_mcp.mjs` 明确说**不在安装时写死**）；
 *   ③ 都没有 ⇒ `null`（走"提醒 + 放行"那一格；`AGENT_IO_ACTOR_STRICT=1` 时改为拒绝，见下）。
 *
 * ★ 边界（如实写在这里，别在别处包装）：**自报拦不住冒充** —— stdio 侧的 MCP server
 *   拿不到宿主可信身份（宿主只给 HTTP connector 注入 `X-WorkBuddy-MCP-Context`，stdio 只注入目录变量）
 *   ⇒ A7 能买到的是**协作防撞**（两个人不会静默改同一处），**不是防冒充**。
 */
export function resolveActor(explicit?: WriteActor | null): WriteActor | null {
  // ★★★ 2026-10-21（并发控制·账户）：解析 / 校验 / 归一化**只有一份实现**（`domain/actor_spec#admitActor`），
  //   本函数是它的**薄壳** —— 否则 read_set 的分桶键与写闸的判定会各判一套。
  //   ★ 不合法 ⇒ `null`（= "没自报" ⇒ 闸走"提醒 + 放行"；STRICT 下由 `missingActor` 那一支拒）。
  //     ★ 为什么**不**原样透传：透传会让 `actor='my agent!'` 去和卡上 owner 逐字比 ⇒ 判成
  //     **"改别人的活"** —— 把一次**格式错**说成**越权**，既误导人，还把活堵住。
  //   ★ 显式给了但不合法 ⇒ **不回落**到 env：回落是静默兜底，会掩盖调用方的错。
  //   ★ STRICT 的那道"老格式也拒"在 `invokeTool`（唯一入口，回执挂得上）；侧门（不经 invokeTool
  //     的内部调用）走的是同一条归一化规则，但**没有回执可挂** —— 这一点如实写在这里，不假装有。
  const adm = admitActor(explicit, process.env.AGENT_IO_ACTOR, { strict: false });
  return adm.ok ? adm.actor : null;
}

/**
 * ★★★ 2026-10-20（A7 **渐进开关**）：`AGENT_IO_ACTOR_STRICT=1` ⇒ 有 claimed 卡却**拿不到 actor** 时也拒绝。
 *
 * ## 为什么默认关（这是**判断**，不是懒）
 * 一刀切（"没有 actor 就拒"）的代价是**立刻卡死现有工作流**：本仓现状是
 *   · 绝大多数写调用（含正在跑的多个子代理）**不带** actor；
 *   · 而带 claimed 卡的文件是主流（本文件自己就是）。
 * ⇒ 打开当天，所有不带 actor 的写都会失败 —— 那不是"变严格"，是"停摆"。
 * ⇒ 所以把它做成**可开可关的一次性开关**：先在"要防撞"的会话里打开，跑顺了再谈默认。
 * ★ 关着的时候**也不是静默**：那条提醒会进闸的 `note`（进而进写工具回执），见 `assertSourceWriteRegistered`。
 */
export function actorStrict(): boolean {
  // ★ 2026-10-21：开关的**唯一读点**搬到 `domain/actor_spec#actorStrictMode` ——
  //   `task_ops#claimTask`（写入 owner 时）与 `invokeTool`（校验 actor 时）读的是**同一处**；
  //   若各读一次 env，就是两份判据（改一处漏一处）。
  return actorStrictMode();
}

/**
 * ★★ **按 actor 判定的入口**（A7 的正式写法）。
 * ★ 旧入口 `assertSourceWriteRegistered(root, files)` 保留 —— 不关心身份的调用方不受影响
 *   （它等价于 `actor = null` ⇒ 走"提醒 + 放行"那一格，**行为不变**）。
 */
/**
 * ★★★ T356（2026-10-20）：「**按 run 授权**」的判定内核 —— **唯一一处**（`assertSourceWriteRegistered` 里那一个分支调它）。
 *
 * ## 它回答什么
 * 「本次这一批文件，能不能靠**一个 scope** 一次授权完？」
 *   本批 rels **全部 ⊆ scope 反查出来的可写路径** ∧ **该 scope 的节点里至少有一张卡是你领的** ⇒ 放行（basis=`authorized`）。
 *   否则 ⇒ 返回理由，由调用处**落回原来的逐文件判定**（并把这些理由拼进拒绝信息 —— 不许静默降级）。
 *
 * ## ★★ `authorize` 为什么**不加在 DSL 里**（写在这里，别再被别人推翻重来）
 *   ① **feature 级太粗**：一个 feature 是 200~516 个文件 ⇒ 授权整个 feature ≈ 关闸；
 *   ② **节点级结构上不成立**：两册都没有 `parent`、`edges` 为空 ⇒ 节点无法「包含」一批文件
 *      （`node.path` 只有 8 个，也只是次要理由）；
 *   ③ 做成 DSL 字段 = **新增第三份路径事实**（`semantic.files` 515 + `node.description` 508 + 新 scope 清单）
 *      —— 本仓最贵的病就是「第二份判据」；
 *   ④ `scope` 这个词已被占用（`NodeDecision.scope`，T329）⇒ 用 `authorize`。
 *   ⇒ 它只是一个**跨工具的保留入参**（`presentation/mcp/server_registry.ts#CALL_AUTHORIZE_FIELD`，与 `actor` 同一处注入），
 *     **只影响这一次调用**，不落任何库。
 *
 * ## ★★ 判据的「一个不能少」
 *   · **文件集反查 `byPath`** —— 不是 `resolveScope().paths`。后者是 `semantic.files` 口径，实测会漏
 *     只有节点 `path` 的文件（`src/application/design/board/pool.ts`）；`byPath` 才是闸自己认的那张表。
 *   · **A7 不放宽** —— 授权只换「要不要逐文件找卡」，**没有**换「卡是不是你的」：
 *     scope 里必须有一张 `state==='claimed'` ∧ `owner===actor` 的卡，否则一律不放行。
 *   · **一条都不许漏** —— 本批只要有一个文件不在 scope 内，就**不授权**（并点名那一个）。
 */
function evaluateRunAuthorize(args: {
  scope: Scope;
  rels: readonly string[];
  covering: readonly GateCoverageFeature[];
  actor: WriteActor | null;
}):
  | { ok: true; feature: string; scopeText: string; nodeCount: number; allowedCount: number; anchor: { nodeId: string; owner: string } }
  | { ok: false; reason: string } {
  const { scope, rels, covering, actor } = args;
  if (!covering.length) {
    return {
      ok: false,
      reason: '本项目根上没有任何**可寻址**的 covering feature（`byPath` 全空）⇒ scope 无从解析。',
    };
  }
  /** 每条 covering feature 上试过的理由（失败时逐条给出来，不许只说"不行"） */
  const tried: string[] = [];
  for (const c of covering) {
    let dsl: ReturnType<typeof getDSL> = null;
    try {
      dsl = getDSL(c.feature);
    } catch (e) {
      tried.push(`${c.feature}：读设计 DSL 抛错（${(e as Error).message}）`);
      continue;
    }
    if (!dsl) {
      tried.push(`${c.feature}：设计 DSL 读不到（feature ${c.feature} 没有落盘）`);
      continue;
    }
    let res: ReturnType<typeof resolveScope>;
    try {
      res = resolveScope(dsl, scope);
    } catch (e) {
      tried.push(`${c.feature}：${(e as Error).message}`);
      continue;
    }
    const nodeIds = new Set(res.node_ids);
    // ★★ scope → 文件：**反查闸自己的 `byPath`**（左=仓库相对路径，右=node_id）—— 不是 `res.paths`
    const allowed = new Set<string>();
    for (const [rel, id] of c.byPath) if (nodeIds.has(id)) allowed.add(rel);
    const missing = rels.filter((rel) => !allowed.has(rel));
    // ★ A7：scope 的节点里**至少一张卡是你领的**（claimed ∧ owner === actor）
    const anchors: Array<{ nodeId: string; owner: string }> = [];
    const others: string[] = [];
    for (const id of res.node_ids) {
      const t = c.taskById.get(id);
      if (!t || t.state !== 'claimed' || !t.owner) continue;
      // ★ 2026-10-21：`sameActor`（同一规范下的**等价**）而不是逐字相等 —— 历史 owner 是老格式，
      //   逐字比会让"我自己领的卡"在规范化 actor 下变成"别人的卡"（详见 `domain/actor_spec#actorKey`）。
      if (actor && sameActor(t.owner, actor)) anchors.push({ nodeId: id, owner: t.owner });
      else others.push(`${id}（owner=${t.owner}）`);
    }
    if (missing.length) {
      tried.push(
        `${c.feature}：scope \`${formatScope(scope)}\` 命中 ${res.node_ids.length} 个节点、反查 \`byPath\` 得 ${allowed.size} 条可写路径，` +
          `但本批有 ${missing.length} 个**不在 scope 内**：${missing.join(', ')}` +
          (res.notes.length ? `（scope 附注：${res.notes.join('；')}）` : ''),
      );
      continue;
    }
    if (!anchors.length) {
      tried.push(
        `${c.feature}：scope 覆盖了本批全部 ${rels.length} 个文件，但该 scope 的节点上**没有一张 owner=${actor ?? '（本次未传 actor）'} 的 claimed 卡**` +
          (others.length ? `（scope 里被别人领着的：${others.join(', ')}）` : '（scope 里没有任何 claimed 卡）') +
          '—— ★ 授权**不放宽 A7**：卡必须是你的。',
      );
      continue;
    }
    return {
      ok: true,
      feature: c.feature,
      scopeText: formatScope(scope),
      nodeCount: res.node_ids.length,
      allowedCount: allowed.size,
      anchor: anchors[0],
    };
  }
  return { ok: false, reason: tried.map((t) => `  · ${t}`).join('\n') };
}

/**
 * ★★ **按 actor 判定的入口**（A7 的正式写法）。
 * ★ 旧入口 `assertSourceWriteRegistered(root, files)` 保留 —— 不关心身份的调用方不受影响
 *   （它等价于 `actor = null` ⇒ 走"提醒 + 放行"那一格，**行为不变**）。
 * ★★★ T356：`authorize`（按 run 授权）也走这一个入口 —— 第 4 个形参。
 *   ★ 为什么一起放这里：**判据只许一处**。若另开一个 `assertSourceWriteRegisteredByScope()`，
 *     那两条路迟早会对同一批文件给出两个答案（本仓头号病）。
 * ★★★ 2026-10-21（读集比对）：第 5 个形参 `symbols` = 本次要写的**符号**（可选）。
 *   给了 ⇒ 假设检定到符号级；不给 ⇒ 退到文件级（`replace_text` 这类文本级写只能如此）。
 */
export function assertSourceWriteRegisteredFor(
  projectRoot: string,
  files: readonly string[],
  actor?: WriteActor | null,
  authorize?: string | null,
  symbols?: readonly AssumptionTarget[],
): TaskGateOutcome {
  return assertSourceWriteRegistered(projectRoot, files, { actor: resolveActor(actor), authorize, symbols });
}

/**
 * ★★★ **写闸的唯一入口**（判据仍住下面那个 `evaluateTaskGate`）。
 *
 * 为什么要在外面包一层：任务闸有 **6 个 return + 4 个 throw**，逐个 return 去挂 `assumption_check`
 * 迟早漏一个（本仓已发生过"算出来了但回执里丢掉"：A7 的 `task_gate` 就是这样丢了两轮）。
 * ⇒ **先算、后合并**：检定的读数**无条件**挂到任何一条放行回执上；被拒（throw）时本来就没落盘，
 *   也就没有"基于旧假设继续写"的风险（拒绝信息里不需要这一段）。
 *
 * ★ 检定**绝不阻塞**：`checkAssumptions` 自己吞掉内部异常并回 `error`（写进读数，不写进判据）。
 */
export function assertSourceWriteRegistered(
  projectRoot: string,
  files: readonly string[],
  /**
   * ★★★ T356：`authorize` = **按 run 授权**（一个 scope 一次授权一批文件）——
   * 值 = `domain/scope.ts` 的**现成文法**（`files:` / `nodes:` / `subtree:` / `layer:` / `swimlane:` / `arch_layer:`）。
   * ★ 它**只影响本次调用**：不写库、不新增路径事实（理由见 `evaluateRunAuthorize` 的注释）。
   * ★ 2026-10-21：`symbols` = 本次要写的符号（假设检定的符号级粒度；不给 ⇒ 文件级）。
   */
  opts?: { actor?: WriteActor | null; authorize?: string | null; symbols?: readonly AssumptionTarget[] },
): TaskGateOutcome {
  const out = evaluateTaskGate(projectRoot, files, opts);
  let ac: AssumptionCheck;
  try {
    ac = checkAssumptions({
      projectRoot,
      files,
      targets: opts?.symbols,
    });
  } catch (e) {
    // ★ 检定是增强，不许把写入拖下水；但也**不许静默** ⇒ 读数里带 error。
    ac = { checked: 0, stale: [], readers: 0, error: (e as Error).message };
  }
  return { ...out, assumption_check: ac };
}

function evaluateTaskGate(
  projectRoot: string,
  files: readonly string[],
  opts?: { actor?: WriteActor | null; authorize?: string | null; symbols?: readonly AssumptionTarget[] },
): TaskGateOutcome {
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  if (!rels.length) {
    return {
      applicable: false,
      basis: 'no-files',
      note: '没有落在项目根内的文件 ⇒ 任务闸不适用（放行；依据：入参里 0 个文件落在项目根内）',
      warnings: [],
      exempted: [],
    };
  }

  // ★ T352：**先收集、再判定**。★ 2026-10-17：收集失败（`unaddressable`）从"抛"改成"放行 + 留痕"，
  //   但**仍先收集**、且**仍点名**（见 `recordUnaddressableWarnings`）—— 退回"静默跳过"照样是错。
  const cov = collectGateCoverage(root);
  // ★★★ 2026-10-17（闸原则「提醒」+「4 处堵」清单第 3 条 = `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.core`）：**收集失败不再抛** ——
  //   它不损坏数据（只是"这次写没在账上"），按"**点名 + 放行 + 留痕**"处理。
  //   ★ 判据仍是 T352 那条不变量：`applicable:false` **只许**表示「本项目不用任务系统」；
  //     所以收集失败**不走** `applicable:false`，而是走 `basis:'unaddressable'`（applicable:true）。
  const warnings = cov.unaddressable.length ? recordUnaddressableWarnings(cov.unaddressable, rels) : [];
  if (!cov.rootFeatureCount) {
    return {
      applicable: false,
      basis: 'no-feature-for-root',
      note:
        `本项目不用任务系统：${cov.totalFeatures} 条 feature 里，**0 条**的 source_root 指到 ${root} ` +
        `（判据：path.resolve(source_root) === 项目根）⇒ 任务闸不适用（放行）`,
      warnings,
      exempted: [],
    };
  }
  const covering = cov.features;

  // ★★★ 2026-10-20（第③步 · `docs/certs-4-ways.md` 裁决 ③）：**豁免判据（唯一一处）**
  //
  // ## 判据
  //   「**所有**指向这个文件的节点都显式声明 `gate:'exempt'`」才豁免；否则仍受闸。
  //   · 没声明（`undefined`）⇒ 按 `gated` ⇒ 仍受闸（漏标 ≠ 豁免 —— 安全方向）；
  //   · 两份 feature 各持一份节点时（实测 certs/ 89+77、scripts/ 60+51）⇒ **AND**。
  //
  // ## 为什么 AND 而不是 OR
  //   现有“claim”那条用的是 OR（任一 feature 有卡就算登记，不替人挑）。豁免**不能照抄**：
  //   OR 会让“在**任意一份** feature 里标一行”就静默打开**另一个 feature 的地盘** ——
  //   那正是 Step-5 警告的「静默的豁免扩张」，而且标的那个节点可能是个幽灵。
  //   ★ AND 的代价写在失败信息里：只标一份 = 仍被拦，且**点名是哪一侧没标**（下面 `partialExempt`）。
  const candidatesOf = (rel: string) =>
    covering
      .map((c) => ({ feature: c.feature, nodeId: c.byPath.get(rel), gate: c.gateByPath.get(rel) }))
      .filter((x): x is { feature: string; nodeId: string; gate: NodeGate | undefined } => !!x.nodeId);
  const isExempt = (cands: ReturnType<typeof candidatesOf>): boolean =>
    cands.length > 0 && cands.every((c) => c.gate === 'exempt');
  /** 本次被豁免的（回执要逐个点名） */
  const exempted: GateExemption[] = [];
  /** ★ 只标了一份的：仍受闸，但**必须说清是哪一侧没标**（否则“我标了呀”会变成一次没头冤案） */
  const partialExempt: Array<{ rel: string; exempt: Array<{ feature: string; nodeId: string }>; gated: Array<{ feature: string; nodeId: string; gate: NodeGate | undefined }> }> = [];

  // overlay 按 feature 懒读一次（★ 只作**回落值**：有卡的节点用派生进度 —— 判据在 `progressOfNode`）
  const ovByFeature = new Map<string, ReturnType<typeof loadOverlay>>();
  const overlayProgress = (feature: string, nodeId: string): DiagramStatus | undefined => {
    if (!ovByFeature.has(feature)) ovByFeature.set(feature, loadOverlay(feature));
    return ovByFeature.get(feature)?.anchors?.[nodeId]?.progress;
  };

  // ★★★ 2026-10-22（progress 权威归一）：**这一处不再自带判据** —— 调 `domain/task_schema.ts#progressOfNode`
  //   （唯一读端入口：有卡 ⇒ 派生；没卡 ⇒ 回落 overlay 并标 `possibly_stale`）。
  //   ★ 以前这里写 `t ? progressOf(t) : overlayProgress(...)`，而 `domain/overlay.ts#applyOverlay` 里又有两份
  //     同型判据 ⇒ 同一个问句**三个答案**（实测 task-system-plan 上 11 个节点就是两种答案）。
  const taskByFeature = new Map(covering.map((c) => [c.feature, c.taskById] as const));
  const todosByFeature = new Map(covering.map((c) => [c.feature, c.todos] as const));
  const effectiveProgress = (feature: string, nodeId: string): NodeProgress =>
    progressOfNode(
      { id: nodeId, task: taskByFeature.get(feature)?.get(nodeId) },
      { progress: overlayProgress(feature, nodeId) },
      todosByFeature.get(feature),
    );

  // ★★★ T332（2026-10-15）：**前置闸（解锁）** —— **追加判据**（不新建闸门，与下面"未领"并列）。
  //
  // ## 判据（★ 只认**显式**声明 —— 本条的成败在此）
  // 覆盖该文件的 feature 的 overlay 里，**某条 edge intent 显式标了 `requires`（非空）**，
  // 该边**源节点 `from`** 正是本次要改的文件节点，而 `requires` 里有节点**未 done**（派生进度）
  // ⇒ **拒绝落盘**，并给出"怎么办"。
  //
  // ## ★★ 为什么只认显式 requires（防误伤，本条的全部意义）
  // edge 默认装的是 **import 依赖**（扫描产出的依赖边 / `Edge.intent`）—— ★ 它**不等于任务前置**。
  // ⇒ 若"有 import 边就拦"，会把**全仓 import 依赖误当解锁条件**（replan-log §28.3 记的"最贵一步"）。
  // ⇒ 判据：**`requires` 为 undefined / 空数组 ⇒ 一律不拦**；只有显式列了节点 id 的才拦。
  //
  // ## 拦的范围（明写，便于判"谁被拦/谁不被拦"）
  // 拦：该文件是某 covering feature 的文件节点 N ∧ 该 feature overlay 里存在 edge intent `e`，
  //     `e.from === N` ∧ `e.requires` 非空 ∧ 其中某被引节点**进度不是 done**（派生进度优先）。
  // 放行：没有任何 requires 声明 · 该文件不是任何 covering feature 的节点 ·
  //      没有"源节点=N 且带 requires"的边 · requires 里的节点已全部 done。
  const unmetPrereq: Array<{
    rel: string;
    feature: string;
    nodeId: string;
    edgeId: string;
    missing: Array<{ id: string; progress: unknown; stale: boolean; source: NodeProgress['source'] }>;
  }> = [];
  {
    const edgesOf = (feature: string) => {
      if (!ovByFeature.has(feature)) ovByFeature.set(feature, loadOverlay(feature));
      return ovByFeature.get(feature)?.edges ?? {};
    };
    for (const rel of rels) {
      const cands = candidatesOf(rel);
      // ★★★ 2026-10-20：豁免的文件**不参与任务闸的任何一条判据**（含前置闸）——
      //   它是量具：证坏着的时候也要能修，否则“证坏了 → 改不进去 → 证修不好”就是那个环
      //   （`docs/certs-4-ways.md` 里四家都指过）。★ 豁免是设计侧声明，不是本闸给的。
      if (isExempt(cands)) continue;
      for (const { feature, nodeId } of cands) {
        for (const [edgeId, ei] of Object.entries(edgesOf(feature))) {
          if (!ei.requires || ei.requires.length === 0) continue; // ★★ 没标 requires ⇒ 不拦
          if (ei.from !== nodeId) continue; // ★ 只拦"该边源节点(from)"的源码写入
          const missing = ei.requires
            .map((rid) => {
              const r = effectiveProgress(feature, rid);
              return { id: rid, progress: r.status, stale: r.possibly_stale, source: r.source };
            })
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
          u.missing
            .map(
              (m) =>
                `${m.id}（progress=${JSON.stringify(m.progress)}` +
                // ★ progress 权威归一：回落 overlay 的读数**必须自己招认可能过期**（不许静默）
                (m.stale ? '，★ 来自 overlay 回落，**可能过期**（该节点没有卡）' : `，来自 ${m.source}`) +
                '）',
            )
            .join(' / ') +
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

  const actor = resolveActor(opts?.actor);

  // ★★★ T356（2026-10-20）：「**按 run 授权**」（`authorize`）—— **一个分支**，位置在 `cov` 收集之后、
  //   逐文件 `unclaimed` 判定**之前**（前置闸 T332 已在上面跑过，**不被跳过**：授权不换"能不能开工"）。
  //
  // ## 判据（三条同时成立才放行；否则**落回原逐文件判定**并把理由拼进拒绝信息）
  //   ① 本批 rels **全部 ⊆** scope 反查出来的可写路径（反查的是**闸自己的 `byPath`**，不是 `resolveScope().paths`）；
  //   ② 该 scope 的节点里**至少一张卡的 `owner === actor`**（且 `state==='claimed'`）—— **A7 不因授权放宽**；
  //   ③ `authorize` 不许是 `all`（那等于关闸，明令不支持），也不许是解不出来的 scope（当场报错，**不静默降级**）。
  //
  // ## 为什么值得有它
  //   一次 run（= 一个子代理的一轮活）往往要改十几个文件，而它手上只有**一张**卡 ——
  //   逐文件判就会拒 12 次（"改个字段要 12 张卡"），于是大家会去寻绕过口。
  //   授权把"领活"与"圈范围"拆开：**卡证明'这块是我的'，scope 证明'这批文件都在这块里'**。
  const authRaw = typeof opts?.authorize === 'string' ? opts.authorize.trim() : '';
  /** 授权没生效时的理由（拼进后面**每一条拒绝**；空串 = 本次没带 authorize） */
  let authorizeMiss = '';
  if (authRaw) {
    let scope: Scope;
    try {
      scope = parseScope(authRaw);
    } catch (e) {
      throw new Error(
        `拒绝落盘（按 run 授权）：\`authorize\` 不是合法 scope —— ${(e as Error).message}\n` +
          `★ 文法（唯一住处 = \`src/domain/scope.ts\` 头部）：all / layer:<main|error|detail> / swimlane:<id> / ` +
          `arch_layer:<id> / subtree:<node_id>[!] / nodes:<id>,… / files:<p1>,<p2>,…（以 / 结尾按前缀匹配）。\n` +
          `★ 为什么不静默降级成逐文件判定：那样拼错一个字母就会得到一份"授权没生效但没人说"的回执（本仓最忌的静默）。`,
      );
    }
    if (scope.kind === 'all') {
      throw new Error(
        `拒绝落盘（按 run 授权）：\`authorize:'all'\` **明令不支持** —— 把整份 DSL 都授权出去 = **关闸**，` +
          `而写闸的全部价值就是"不领任务不许悄悄改"。\n` +
          `★ 要圈一大片请写出**那个片**（如 \`files:src/application/refactor/\` 或 \`subtree:<模块节点>\`）——` +
          `宽度要你负责，不许用一个词把责任推掉。`,
      );
    }
    const verdict = evaluateRunAuthorize({ scope, rels, covering, actor });
    if (verdict.ok) {
      return {
        applicable: true,
        basis: 'authorized',
        note:
          `按 run 授权放行（\`authorize='${verdict.scopeText}'\`，feature=${verdict.feature}）：` +
          `本批 ${rels.length} 个文件**全部**落在该 scope 内（scope 命中 ${verdict.nodeCount} 个节点、` +
          `反查写闸自己的 \`byPath\` 得 ${verdict.allowedCount} 条可写路径）；` +
          `anchor 卡 = 节点 ${verdict.anchor.nodeId}（state=claimed，owner=${verdict.anchor.owner}）。\n` +
          `  ★ 授权**不放宽 A7**：那张卡必须是你的（本次在 scope 的节点里核对了 owner===actor）。\n` +
          `  ★ 反查的是**闸自己的 \`byPath\`**（\`path\` 优先、回落 \`description\`），**不是** \`semantic.files\` 口径 ——` +
          `后者会漏掉只有 \`path\` 的节点。`,
        warnings,
        exempted,
      };
    }
    authorizeMiss = `\n★ 本次带了 \`authorize='${authRaw}'\`，但**没能覆盖本批**（已落回逐文件判定）：\n${verdict.reason}`;
  }

  const unclaimed: Array<{ rel: string; cands: Array<{ feature: string; nodeId: string; state: string | undefined }> }> = [];
  /** ★ A7：有 claimed 卡，但 **owner 不是本次写入者** ⇒ 阻断（会覆盖别人的工作） */
  const foreignClaim: Array<{ rel: string; feature: string; nodeId: string; owner: string; actor: string }> = [];
  /** ★ A7：有 claimed 卡，但**拿不到 actor / 卡上没有 owner** ⇒ 提醒 + 放行（不知道是谁，不损坏数据） */
  const actorWarnings: string[] = [];
  /** ★★ 2026-10-20：同一批事实的**结构化读数**（给 `AGENT_IO_ACTOR_STRICT=1` 的拒绝用；不许再从 `actorWarnings` 反推） */
  const missingActor: Array<{ rel: string; nodeId: string; owner: string | null }> = [];
  /**
   * ★★ 2026-10-21（并发控制·账户）：owner 是**老格式**、靠 `sameActor` 折算才匹配上的（放行但**留痕**）。
   * ★ 为什么必须留痕：等价放行**不改历史数据**，如果不记一条，读回执的人会以为"库里就是规范格式"，
   *   下一次审计又会对不上 —— 这正是本仓禁的"静默兜底"的另一种形状。
   */
  const legacyOwner: string[] = [];
  /** ★ 这批文件里**不在任何 covering feature 里**的（新建文件 / 未纳入设计）—— 放行，但**逐个点名** */
  const unmapped: string[] = [];
  let checked = 0;
  for (const rel of rels) {
    const cands = candidatesOf(rel);
    if (!cands.length) {
      unmapped.push(rel); // 本项目有任务系统，但这条路径确实不在设计里 ⇒ 放行（下面 note 逐个点名）
      continue;
    }
    // ★★★ 2026-10-20：设计侧声明了豁免（指向它的节点**全部** `gate='exempt'`）⇒ 放行，但**记名**
    //   （`exempted` 会在每一条回执里点名；不许静默）。
    if (isExempt(cands)) {
      exempted.push({ path: rel, by: cands.map((c) => ({ feature: c.feature, nodeId: c.nodeId })) });
      continue;
    }
    // ★ 只标了一份（另一份没标/是幽灵）⇒ **仍受闸**，但把“哪一侧没标”记下来，进拒绝信息。
    const markedExempt = cands.filter((c) => c.gate === 'exempt');
    if (markedExempt.length) {
      partialExempt.push({
        rel,
        exempt: markedExempt.map((c) => ({ feature: c.feature, nodeId: c.nodeId })),
        gated: cands.filter((c) => c.gate !== 'exempt'),
      });
    }
    checked++;
    // ★★★ OQ10 裁定：只有"该节点上有一张 **claimed** 的任务卡"才算登记。
    //   ★ 任一 feature 满足即通过（不替人挑哪一条）；★ 看的是 `task.state`，**不看** progress
    //   （progress 是派生值，且"已播种"的 progress 会让旧判据变成装饰 —— 那正是 OQ10）。
    // ★★★ A7（2026-10-17）：**还要问"这张卡是不是你的"** —— 三种情形三种处置（见 `WriteActor` 的注释表）。
    const cards = cands.map((c) => ({ ...c, task: taskByFeature.get(c.feature)?.get(c.nodeId) }));
    const claimed = cards.find((c) => c.task?.state === 'claimed');
    if (!claimed) {
      unclaimed.push({
        rel,
        cands: cards.map((c) => ({ feature: c.feature, nodeId: c.nodeId, state: c.task?.state })),
      });
      continue;
    }
    const owner = claimed.task?.owner ?? null;
    if (!actor) {
      // ★ G2 的"提醒"那一支：不知道是谁 ⇒ 不损坏数据 ⇒ 不该堵。
      //   ★★★ 2026-10-20：**同一条事实记两处** —— `actorWarnings` 给人读（进回执 note），
      //     `missingActor` 给 `AGENT_IO_ACTOR_STRICT=1` 的拒绝分支用（判据与读数同源，不各算一遍）。
      actorWarnings.push(
        `${rel}：节点 ${claimed.nodeId} 上有 claimed 卡（owner=${owner || '（空）'}），但**拿不到"谁在写"**` +
          `（本次调用未传 \`actor\`，也没有 AGENT_IO_ACTOR）⇒ 按 G2 **提醒 + 放行**` +
          `（要它变拒绝：写调用带 \`actor:\'<你的身份>\'\`，或设 \`AGENT_IO_ACTOR_STRICT=1\`）`,
      );
      missingActor.push({ rel, nodeId: claimed.nodeId, owner });
      continue;
    }
    // ★★★ 2026-10-21（并发控制·账户）：比对用 `sameActor`（**同一规范下的等价**），不是逐字相等。
    //   ★ 为什么：历史 `task.owner` 全是老格式（实测 12 种取值、无一有前缀）。逐字比会把
    //     `owner=workbuddy` 的卡在 `actor=agent:workbuddy` 下判成"改别人的活" ⇒ **自己的卡把自己的文件锁死**。
    //   ★ 这是**判"是不是你"**，不是读时归一化：库里一个字节都没动（见 `domain/actor_spec#actorKey`）。
    //   ★ 但**不静默**：折算才相等的情况记一条进 `legacyOwner`（进 warnings / 进 note）。
    if (owner && owner !== actor) {
      if (!sameActor(owner, actor)) {
        // ★ G2 的"阻断"那一支：改别人的活会覆盖别人的工作 ⇒ 真损坏
        foreignClaim.push({ rel, feature: claimed.feature, nodeId: claimed.nodeId, owner, actor });
        continue;
      }
      legacyOwner.push(
        `${rel}：卡上 owner=\`${owner}\` 是**老格式**（无类前缀），与本次 actor=\`${actor}\` 按同一规范**等价** ⇒ 放行；` +
          `★ 历史值不追改（下次在这张卡上 claim / reopen 时写入的 owner 才是规范格式）`,
      );
    }
    // owner 匹配（或按规范等价），或卡上没有 owner（无法比对）⇒ 放行
  }
  // ★★★ 2026-10-20（A7 **渐进开关**）：有 claimed 卡却拿不到 actor ⇒ `AGENT_IO_ACTOR_STRICT=1` 时**拒绝**。
  //   ★ 位置在"整批都豁免"之前：豁免是**设计侧**的权力（`gate='exempt'`），与"谁在写"无关；
  //     而那些文件根本没进下面的核对循环 ⇒ `missingActor` 里不会有它们，这里不会误伤。
  //   ★ 错误文案必须给出**两步就能过**的路（传 actor / 关开关），否则又是一条"只说不行"的墙。
  if (missingActor.length && actorStrict()) {
    throw new Error(
      `拒绝落盘（任务闸 · A7 严格模式 AGENT_IO_ACTOR_STRICT=1）：${missingActor.length} 个文件有 claimed 卡，` +
        `但**本次调用没有自报身份**（未传 \`actor\`，也没有 AGENT_IO_ACTOR）⇒ 无法核对"这张卡是不是你的"。\n` +
        missingActor.map((x) => `  · ${x.rel} → 节点 ${x.nodeId} 的卡 owner=${x.owner ?? '（空）'}`).join('\n') +
        `\n★ 怎么办（二选一）：\n` +
        `  ① 写调用带身份：在同一个入参里加 \`actor: '<你的身份>'\`（与 claim 时 \`data.owner\` **一致**）；\n` +
        `  ② 临时关掉严格模式：\`AGENT_IO_ACTOR_STRICT=0\`（或去掉该环境变量）⇒ 回到"提醒 + 放行"。` +
        // ★ T356：带了 authorize 但没生效时，拒绝信息里**必须**带出理由（否则调用方只看得到逐文件拒绝，
        //   会以为是"卡没领"，而真相可能是"scope 圈错了"或"anchor 卡不是你的"）。
        authorizeMiss,
    );
  }

  // ★★★ 2026-10-20：**整批都靠设计侧豁免**（没有一张卡被核对）—— 这是一种独立的放行依据，
  //   不许混进下面 `files-not-in-design`（那会说成“不在设计里”，而事实相反：**设计里写了**，
  //   而且写的是“不用立卡”）。也不许静默：note 逐个点名。
  if (!checked && exempted.length) {
    const also: string[] = [];
    if (unmapped.length) {
      also.push(`${unmapped.length} 个文件不在任何 covering feature 里（无任务可挂、放行）：${unmapped.join(', ')}`);
    }
    if (cov.unaddressable.length) {
      also.push(`${cov.unaddressable.length} 个文件节点收集失败（缺 path/description，已放行 + 留痕）：\n${warnings.join('\n')}`);
    }
    return {
      applicable: true, // ★ 本项目**有**任务系统；只是这批文件被设计侧明确宣布“不受闸”
      basis: 'exempt',
      note:
        exemptionLines(exempted) +
        (also.length ? `\n★ 本批另有别的放行情形：\n${also.map((s) => `  · ${s}`).join('\n')}` : '') +
        `\n  ★ 依据读数：${cov.totalFeatures} 条 feature 里 ${cov.rootFeatureCount} 条 source_root 指到本根、` +
        `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。`,
      warnings,
      exempted,
    };
  }
  if (!checked) {
    // ★ 2026-10-17：收集失败**不再抛**（闸原则「提醒」= `task_plan.gate_principle.core`）。★ 但也不许混进
    //   `files-not-in-design` 那句"都不在设计里"——那会变成**一句假话**（节点在，只是指不出文件）。
    if (cov.unaddressable.length) {
      return {
        applicable: true, // ★ 本项目**有**任务系统 ⇒ 不许 applicable:false（T352 的不变量）
        basis: 'unaddressable',
        note:
          `放行（收集失败）：本批 ${unmapped.length} 个文件**都不在任何"可寻址"的节点上**，` +
          `其中 ${cov.unaddressable.length} 个文件节点**收集失败**（既无 path 也无 description）⇒ ` +
          `闸对它们**是瞎的** ⇒ 按闸原则「提醒」**点名 + 放行 + 留痕**（★ 缺字段不损坏数据，只是"没在账上" = 记录问题，不是数据问题）。\n` +
          `★ 点名：\n${warnings.join('\n')}\n` +
          `★ 依据读数：${cov.totalFeatures} 条 feature 里 ${cov.rootFeatureCount} 条 source_root 指到本根、` +
          `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。`,
        warnings,
        exempted: [],
      };
    }
    return {
      applicable: true, // 本项目**有**任务系统，只是这批文件不在设计里 ⇒ 不是"不适用"，是"这次没有可挂的节点"
      basis: 'files-not-in-design',
      note:
        `本批 ${unmapped.length} 个文件都**不在任何 covering feature 里**（不是任何一个文件节点的 path/description、` +
        `也不在 semantic.files）⇒ 无任务可挂、放行。逐个点名：${unmapped.join(', ')}\n` +
        `  ★ 依据读数：${cov.totalFeatures} 条 feature 里 ${cov.rootFeatureCount} 条 source_root 指到本根、` +
        `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。\n` +
        `  ★ 若其中某条其实**已经在设计里**（只是节点缺 path/description）⇒ 那属于"收集失败"：` +
        `本函数**不抛**，而是**放行 + 把警告写进该 feature 的 annotations**（见 basis:'unaddressable' 那一支）。`,
      warnings,
      exempted: [],
    };
  }
  // ★★★ A7（2026-10-17）：`owner` 不匹配 ⇒ **阻断**。
  //   ★ 这一支与"没挂任务"**不同**：不是"没在账上"（那是记录问题，按 G2 只提醒），
  //     而是**会覆盖别人的工作**（真损坏）⇒ 该堵。
  if (foreignClaim.length) {
    throw new Error(
      `拒绝落盘（任务闸 · A7「谁在写」）：这次要改的 ${foreignClaim.length} 个文件，其任务卡**不是你领的**\n` +
        foreignClaim
          .map((x) => `  · ${x.rel} → 节点 ${x.nodeId} 的卡 owner=${x.owner}，本次写入者=${x.actor}`)
          .join('\n') +
        `\n★ 为什么拦：改别人的活**会**覆盖对方的工作 ⇒ 那是**真损坏**，不是"没在账上"（后者按 G2 只提醒）。\n` +
        `★ 怎么办（二选一）：\n` +
        `  ① 对方已放弃 ⇒ 先 \`release\` 那张卡，再 claim 一张自己的；\n` +
        `  ② 对方还在做 ⇒ 别动这个文件（你改了会和它对撞）。` +
        authorizeMiss,
    );
  }

  // ★ A7：拿不到 actor 的那些 ⇒ 提醒（放行，但要留痕 —— 否则"不知道是谁"从此无人知晓）
  if (actorWarnings.length) warnings.push(...actorWarnings);
  // ★ 2026-10-21：老格式 owner 等价匹配的那些也进 warnings（放行，但"这次是折算出来的"必须说）
  if (legacyOwner.length) warnings.push(...legacyOwner);

  if (!unclaimed.length) {
    return {
      applicable: true,
      basis: 'covered',
      note:
        `已领任务：${checked} 个设计节点上都有 state=claimed 的任务卡（覆盖 feature：${covering.map((c) => c.feature).join(', ')}` +
        `${unmapped.length ? `；另有 ${unmapped.length} 个文件不在设计里、无任务可挂：${unmapped.join(', ')}` : ''}）` +
        (exempted.length ? `\n${exemptionLines(exempted)}` : '') +
        // ★★★ 2026-10-20：**两个来源分开写**。改前这两句是同一条 —— 拿 `cov.unaddressable.length`
        //   去当"下面这些警告是什么"的标题 ⇒ 只有 A7 提醒时它会印成「另有 **0** 个节点收集失败：<A7 提醒>」
        //   （标题与内容对不上，读的人会以为闸在说梦话）。
        (cov.unaddressable.length
          ? `\n★ 另有 ${cov.unaddressable.length} 个节点收集失败（已放行 + 留痕）：\n${warnings.slice(0, cov.unaddressable.length).join('\n')}`
          : '') +
        (actorWarnings.length
          ? `\n★ A7「谁在写」**未核对**：${actorWarnings.length} 个文件有 claimed 卡，但本次调用没自报身份（已提醒 + 放行）：\n${actorWarnings.join('\n')}`
          : '') +
        // ★ 2026-10-21：**折算才相等**的那一档单独说（不许混进"逐字相等"里 —— 那不是同一件事）
        (legacyOwner.length
          ? `\n★ A7「谁在写」按规范**等价**放行 ${legacyOwner.length} 处（历史 owner 未改写）：\n${legacyOwner.join('\n')}`
          : ''),
      warnings,
      exempted,
    };
  }

  const first = unclaimed[0];
  const list = unclaimed
    .map(
      (u) =>
        `  · ${u.rel}  ⇒ ${u.cands
          .map((c) => `${c.nodeId}（feature=${c.feature}，task.state=${JSON.stringify(c.state ?? null)}）`)
          .join(' / ')} **都没有 claimed 的任务卡**`,
    )
    .join('\n');
  throw new Error(
    `拒绝落盘（任务闸）：这次要改的 ${unclaimed.length} 个文件**没有挂到任何已领取的任务上** —— ` +
      `本仓纪律：改源码可以，但**不领任务不许悄悄改**。\n` +
      `${list}\n` +
      `\n★ 怎么领（唯一写端；工具名 \`edit_dsl\`，最小参数）：\n` +
      `  ① 还没有任务卡（上面 task.state=null）⇒ **先立卡**（\`publish\`：把该节点的**决策卡**翻成任务卡，★ 不接受手写 summary）：\n` +
      `  { feature: '${first.cands[0].feature}',\n` +
      `    reason: '从决策卡立卡 ${first.cands[0].nodeId}',\n` +
      `    agent: '<你的身份>',\n` +
      `    operations: [{ type:'task', op:'publish', id:'${first.cands[0].nodeId}' }] }\n` +
      `  · ★ 该节点**没有 decision / 太粗**（无后态判据）⇒ publish 会立 **L1 建构卡**（0 条期望，验收看"DSL 建构完整"）；` +
      `有可判的后态判据 ⇒ **L2 实现卡**。两条都不收手写 summary。\n` +
      `  ② 有了卡（candidate）⇒ 领取：\n` +
      `  { feature: '${first.cands[0].feature}',\n` +
      `    reason: '开始实现 ${first.cands[0].nodeId}',\n` +
      `    agent: '<你的身份>',\n` +
      `    operations: [{ type:'task', op:'claim', id:'${first.cands[0].nodeId}', data:{ owner: '<你的身份>' } }] }\n` +
      `  · 卡住在 \`todos[]\`（带 \`node_id\` 指向该节点）；\`geometry.nodes[].task\` 只是派生投影（读端不认它）。\n` +
      `  · 任务态五态：candidate / preparing / claimed / done / void（★ superseded 已退场；void 可用 relaunch 重新立卡）；\n` +
      `    ★ preparing（领了但还不能干）**没有写权** —— 它等于 candidate，先把判据补全再 start。\n` +
      `    ★ \`node.status\`（draft / in_progress / done）对它是**派生值**（progressOf），**不许直接改**。\n` +
      `  · claim 写前必过「可领」读数（cardStanding ∈ work/violated）；complete 必过「可收口」读数（isSatisfied）且另需 \`data.evidence\`（与 status 同一把证据尺）。\n` +
      `  · 覆盖这条改动的 feature 有多条时，在**任一条**里 claim 即可（本闸不替你挑）。\n` +
      `\n★ 本闸**不会替你 claim**，也**不会把这次写入降级放行** —— 拒绝就是拒绝；领到后再改即可。\n` +
      `★ 拦的范围（只此一条）：项目根上有设计 feature 覆盖该文件（` +
      `source_root === 项目根 ∧ 该文件是它的文件节点）∧ 覆盖它的 feature 里**没有一条**在该节点上有一张 ` +
      `state='claimed' 的任务卡。\n` +
      `  放行：项目无 feature 指向它 / 文件不是任何一条的节点（新建或未纳入设计）/ 已在任一条里 claim。` +
      (exempted.length ? `\n${exemptionLines(exempted)}` : '') +
      (partialExempt.length
        ? `\n★ 注意（只标了一半）：本批 ${partialExempt.length} 个文件**只有部分 feature 标了 \`gate:'exempt'\`** ⇒ 仍受闸：\n` +
          partialExempt
            .map(
              (p) =>
                `  · ${p.rel}：已标 ${p.exempt.map((e) => `${e.nodeId}（${e.feature}）`).join(' / ')}；` +
                `**没标/仍是 gated** ${p.gated.map((g) => `${g.nodeId}（${g.feature}，gate=${g.gate ?? '未声明'}）`).join(' / ')}`,
            )
            .join('\n')
        : '') +
      `\n★ 若这条其实是**量具/工具**（证、脚本、生成物 —— 不该立卡）⇒ **在设计侧声明豁免**（★ 不是本闸的权力，闸只读）：\n` +
      `  { feature: '<覆盖它的 feature>', reason: '把 <路径> 标为量具（豁免写闸）', agent: '<你>',\n` +
      `    operations: [{ type:'node', op:'update', id:'<该路径在该 feature 里的节点 id>', data:{ gate:'exempt' } }] }\n` +
      `  · ★ 多份 feature 指向同一文件时**每一份都要标**（AND；漏一份 = 仍受闸，本回执会点名是哪一侧没标）。\n` +
      (warnings.length ? `\n★ 另：本批有 ${cov.unaddressable.length} 个节点**收集失败**（已按"放行 + 留痕"处理）：\n${warnings.join('\n')}` : '') +
      // ★ T356：带了 authorize 而它没生效 ⇒ 拒绝信息里点名理由（"没生效"不许看不出来）
      authorizeMiss,
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

// ─────────────────────────────────────────────────────────────
// 写入**已搬走**：`application/source_writer.ts`
// ─────────────────────────────────────────────────────────────
// 本文件从此只留三件事：**判据**（`assertSourceWriteRegistered` / `evaluateTaskGate`）、
// **自写登记**（`recordSelfWrite`）、**索引写穿**（`syncSelfWrites*`）。
//
// 原先这里还有两个"写入器"：
//   · `writeSourceFiles(root, files, mutate)` —— 收的是 `mutate` 回调，**它自己不写** ⇒ 闸与落盘隔着调用方；
//   · `snapshotAndRecordSelfWrite(root, files)` —— 同步版，同样只判不写。
// 实测后果：全仓 25 处对用户源码的覆盖写是**裸 `fs.writeFileSync`**，闸判了、写在别处；
// 4 处工具还把闸的返回值丢了（回执里一个字没有）。
// ⇒ 现在两者合并成**一个原语** `source_writer`（`openSourceWrite` / `writeSourceFile` / `writeSourceBatch`）：
//   闸、快照、落盘、登记在**同一处**，`commit` 只接受开闸时声明过的路径（没有绕过口）。
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
