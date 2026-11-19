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
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { getProjectCacheDb, beginBatch, endBatch, projectCacheDbPath, type Database } from '../infrastructure/index/db.js';
import { syncFile, syncFileSync, removeFile, changedSymbolNames, reopenRefsTo, resolveCrossFileCalls, contentHash, type SyncStatus, type CrossFileResolveStats , toIndexKey, toRelPath } from '../infrastructure/index/symbols.js';
import { canParseFileSync } from '../infrastructure/parse/index.js';
import { snapshotBeforeWrite, type FileSnapshotMeta } from './refactor/snapshot/file_snapshot.js';
import { indexCoversDisk } from '../infrastructure/index/index_freshness.js';
// ★★★ T328 步 6：**任务闸**要读「项目 → 设计 feature」的反查与 overlay 的 progress（唯一权威）。
//   ★ 反查口径**只认 `storage#isSameProject`**（册住在谁家）—— 与 `file_snapshot.ts`（T90）、
//     `ledger_membership`、`claim_conflict` 共用同一把尺；**不许**再比 `DSL.source_root`
//     （那是写册那台机器的绝对路径 ⇒ 换机器恒 false ⇒ 本闸静默放行）。
import { listDesignSheets, getDSL, saveDSL, isSameProject } from '../infrastructure/storage.js';
import { loadOverlay } from '../infrastructure/storage_overlay.js';
// ★★★ 2026-10-30（租约 fencing / 心跳）：两件事的**判据都住在别处**，本文件只调 ——
//   · 代际的读法 = `domain/task_machine.ts#leaseGenerationOf`（缺省 0 的规则只有那一处）；
//   · 心跳的写盘 = `design/dsl_ops/task_ops.ts#touchTaskHeartbeat`（唯一写端；写闸只判不写）。
import { leaseGenerationOf } from '../domain/task_machine.js';
// ★★★ 2026-11-04（G13/G17）：`TaskGateBasis` 的**词表 + 分诊表**已搬去
//   `src/domain/task_gate_basis.ts`（那里还有 `BASIS_CARDABILITY` 与三个纯分诊函数）——
//   本文件只**转出**类型（见下方 `export type { TaskGateBasis }`），不复制第二份。
//   为什么搬：分诊必须有**行为落点**，而本文件有 20+ 个值 import ⇒ `behavior-cases` 的执行核
//   load 不了它（`E-CRIT-006` / `domain/batch_diff.ts` 头注的实测）；判据住在 load 得起来的地方才不是文本代理。
import type { TaskGateBasis } from '../domain/task_gate_basis.js';
import { touchTaskHeartbeat } from './design/dsl_ops/task_ops.js';
// ★ 2026-10-28（重写计划层 · 第 3 步）：判据的唯一实现住 `rewrite_plan.ts#planGaps`，这里只调用
import {
  readRewritePlan,
  planGaps,
  planCoverageGapsOf,
  planUntouchedGaps,
  absorbUnplanned,
  writeRewritePlan,
  planJudgementGaps,
  planDependencyGaps,
  planKindGaps,
  parseJudgementRef,
  type SymbolsInFileResult,
} from './design/db/rewrite_plan.js';
import { checkRewriteExit, renderExitCheck } from './design/db/plan_exit_check.js';
// ★ 判定引用解析的家：归属账 + 解析器都住 gen_design_db（与 gen-db-check 读同一本账）
import { excludedPathsOf, isExcludedPath, loadDesignSheetsForGate, resolveDecisionExpectation, type DesignSheetLike } from './design/db/gen_design_db.js';
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
// ★ 第⑪项：插桩通道豁免的前置检查（台账在场 = 插桩器先写台账后写源码的顺序证明）
import { loadProbeLedger } from '../infrastructure/analysis/observe/instrument.js';
import { emitTelemetry, TELEMETRY_STAGES } from './telemetry.js';
// ★★★ 2026-11-17（T-#LEDGER-ENGINE **L3b / E9**）：**派生视图的路径常量不新造** —— 问 `render_ledger_view`。
//   它自己声明 `VIEW_REL` 是"只此一处"的权威（渲染器 / `--check` / patrol 都问它）⇒ 本文件若再写一份
//   字面量 `'docs/todo.md'`，就是"同一事实两个住处"：视图改名那天，其中一处会**静默**失效。
import { VIEW_REL } from './ledger/render_ledger_view.js';

/**
 * ★★★ 2026-11-17（T-#LEDGER-ENGINE **L3b / E9**）：**派生视图不许经 agent 写路直写**。
 *
 * ## 判据（一句话）
 * `docs/todo.md` 自 2026-11-17 起是**引擎的派生层**（真相住 `.agent-io/tasks.db#ledger_rows/ledger_events`，
 * 唯一渲染器 = `application/ledger/render_ledger_view.ts`）。直写它 = 造**第二真相**：
 * 下一次 `ledger:render` 会把你的字**覆盖掉**，而 `ledger:check` 只会说"有人手改了"
 * （它分不清是你写的还是别人写的；`hand-edited` 态就是这条的读数）。
 *
 * ## 为什么改前"能写"，而且拦它的东西是**假拦截**
 * L3 之前它靠 `files-not-in-design` **放行**（设计册里没有它的节点 ⇒ 无任务可挂），
 * 唯一拦住直写的是**重写计划闸**（"没有够格的重写计划"）—— 那是流程闸，不是真相边界：
 * 只要写一张画布（`design_line action=plan`）就能直写派生视图，而画布闸只回答"你想清楚了没有"，
 * 它**不回答**"这个文件该不该由你写"。
 *
 * ## 为什么是**终局拒绝**（`direct` / `authorize` / `exempt` / 首跑都放不行）
 * 那些开关的意思是"跳过**流程**"，而这里拦的是"不许造第二真相"—— 流程可以省，真相不能有第二份。
 * ★ 唯一"逃生口"是**去用引擎**（挂账 / 批注 / 销账 / 裁定），然后让视图重生成：这不是绕过，是正路。
 *
 * ## 为什么住**写闸入口**（而不是 `evaluateTaskGate` 里某一支）
 * `assertSourceWriteRegistered` 是**所有** agent 写路的唯一收口（`source_writer#openSourceWrite`、
 * `rename_files` / `rename_file` / `symbol_move` 都经它）⇒ 判据住这里，才不可能出现"某条写路没接"。
 */
export const DERIVED_VIEW_PATHS: readonly string[] = [VIEW_REL];

/** 这批路径里有哪些是派生视图（拒绝文案要**点名**；路径归一与闸的其余判据同一把尺 `toIndexKey`） */
export function derivedViewHits(projectRoot: string, files: readonly string[]): string[] {
  const root = path.resolve(projectRoot);
  const rels = new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r));
  return DERIVED_VIEW_PATHS.filter((p) => rels.has(p));
}

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
  /**
   * ★★★ 2026-10-28（T-#RP-3 前置）：**逐文件明细** —— 批级结果里必须有"每个文件发生了什么"。
   *
   * ## 为什么必须有它
   * 合并"两条收尾"（`edit_code` 的逐分支 sync vs `source_writer.close()`）之前，
   * 逐文件事实只存在于**调用方自己的 Map** 里（`symbolDiffByFile` / `indexStatusByFile`）。
   * 一旦改成统一 `close()`，那些 Map 就没了 ⇒ `files[]`（T150 刚立起来的）会**当场蒸发**。
   * ⇒ 先把事实放进批级结果，再谈合并：**顺序反了就是用一个读数蒸发换一次结构统一。**
   */
  byFile?: Record<
    string,
    { status: SyncStatus | 'removed'; removed?: boolean; symbol_diff?: { added: number; removed: number; changed: number } }
  >;
  /** 同步成功（新建或更新）的文件数 */
  synced?: number;
  /** 判为 skipped（内容 hash 未变）的文件数 */
  skippedFiles?: number;
  /** 从索引里移除的文件数（磁盘上已不存在） */
  removed?: number;
  /** 同步失败的文件数 */
  failed?: number;
  /** 因"变动符号改名/删除"而重新打开的引用行数（>0 = 引用方被正确重算） */
  /**
   * ★★★ 2026-10-28（重写计划层 · 第 6 步）：**出口闭环读数**（每行一个文件）。
   * 写完之后立刻对账：计划里的锚点落了没、文件变没变、有没有**计划外改动**。
   * ★ 只对**有画布**的文件出声（没有计划的情况由写前的 `planGate` 点名，不在这里重复刷）。
   * ★ 为什么挂在写穿结果上：这是**所有写路径共用**的那一处（async/sync 都经 `finishWriteThrough`），
   *   挂别处就得逐工具各接一遍（同一判据住 N 处 = 本仓头号病）。
   */
  plan_exit?: string[];
  /** ★ 2026-10-28：画布基线的新陈代谢（吸收设计缺口 / 基线挪到写后）—— 不静默 */
  plan_baseline?: string[];
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
  // ★ 2026-10-28（第 6 步）：**出口闭环** —— 写穿之后立刻对账（有画布的文件才出声）
  // ★★ 2026-10-28（用户："流程还有哪里不对吗" → 自查发现**真会堵死路**的洞）：
  //   出口闭环用的是**写之前**的冻结基线，所以它必须在这里跑；但画布基线**写完必须跟着往前挪**，
  //   否则严格档下同一个文件**只能改一次**（实测：第二次写被"画布过期"拦，任务被锁死）。
  //   顺序：① 用旧基线判（才知道"改了却没计划"）→ ② 吸收缺口进画布 → ③ 基线挪到写后。
  try {
    const lines: string[] = [];
    const absorbed: string[] = [];
    const refreshed: string[] = [];
    for (const rel of rels) {
      const plan = readRewritePlan(root, rel);
      if (!plan) continue; // 没计划 ⇒ 写前的 planGate 已经点名过，不重复刷
      const exit = checkRewriteExit(root, rel);
      lines.push(renderExitCheck(exit));
      // ② 设计缺口记账（改了却没计划 ⇒ 追加缺判据的 entry）
      const ab = absorbUnplanned(plan, exit.changed_unplanned);
      let next = ab.plan;
      if (ab.absorbed.length) absorbed.push(...ab.absorbed.map((s) => `${rel}#${s}`));
      // ③ 基线挪到写后（否则下一次写必被"画布过期"拦）
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) {
        // ★★ 0.12（2026-10-31）：指纹**算不出**时**不许**写空 `fps_at_freeze` —— 那等于把
        //   "改了却没计划"这条守卫关掉，而读端与"文件没有顶层符号"分辨不出来。
        //   ⇒ 只有 `ok` 才写；失败进 `plan_baseline`（回执里出声，不静默降级）。
        const fpsR = symbolFpsOf(root, rel);
        next = {
          ...next,
          frozen_at: new Date().toISOString(),
          base: { content_hash: contentHash(fs.readFileSync(abs, 'utf-8')) },
          ...(fpsR.ok ? { fps_at_freeze: fpsR.fps } : {}),
        };
        writeRewritePlan(root, next);
        refreshed.push(rel);
        if (!fpsR.ok) {
          out.plan_baseline = [
            ...(out.plan_baseline ?? []),
            `⚠ ${rel} 冻结指纹**算不出**（${fpsR.reason ?? '未知'}）⇒ 画布没记 \`fps_at_freeze\`` +
              ` ⇒ 下一次「改了却没计划」这条判不了（修：重建索引后重跑 \`design_line action=plan\`）`,
          ];
        }
      }
    }
    if (absorbed.length) {
      out.plan_baseline = [
        ...(out.plan_baseline ?? []),
        `★ 记成设计缺口 ${absorbed.length} 处（改完发现画布没计划）：${absorbed.slice(0, 4).join(', ')}` +
          `
   ⇒ 这些条目**缺 judgement_ref** ⇒ 写前闸会一直点名，直到补全设计`,
      ];
    }
    if (refreshed.length) {
      out.plan_baseline = [...(out.plan_baseline ?? []), `★ 画布基线已挪到写后（${refreshed.length} 个文件）⇒ 下一次写不会被"画布过期"拦`];
    }
    if (lines.length) out.plan_exit = lines;
  } catch {
    /* 对账是增强：失败不连累写穿结果（但也不静默——写前 planGate 的 warning 仍在） */
  }
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
          out.byFile = { ...(out.byFile ?? {}), [rel]: { status: 'removed', removed: true } };
          out.removed = (out.removed ?? 0) + 1;
          continue;
        }
        const r = syncFileSync(db, root, abs);
        out.byFile = {
          ...(out.byFile ?? {}),
          [rel]: { status: r.status, ...(r.symbol_diff ? { symbol_diff: r.symbol_diff } : {}) },
        };
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
   * ★ 不变量（2026-11-02 ⓪ 校正）：留痕的**唯一落点就是本字段** —— 它随**本次调用的回执**出去。
   *   2026-10-23 批注层退场后**不再落盘**：`dsl.annotations[]` 已无写端、也无读端
   *   （`query_feature {query:'annotations'}` 无 case ⇒ 传进去只抛「未知 query 类型」，2026-11-02 实测）。
   *   ⇒ 任何“去看某处的 annotations”的指路都是死路，别再写回来。
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
  /**
   * ★★★ 2026-11-03（`docs/todo.md` §一 0.8「无卡变更」第三本账 · 步骤③）：**逐文件的卡归属读数**。
   *
   * 判据：**有卡 ⇒ `{feature,nodeId}`；放行但没卡 ⇒ `null`**。`null` 不是"没算"—— 它就是这个文件
   * 「本次写没有任何任务卡在账上」的正解（`write_log` 的 `card_id` 直接取它）。
   *
   * ★ 为什么必须在这一层给：卡身份本来就在下面的循环里逐文件算出来了，但只聚合进 `coveredCards`
   *   （**去重后的卡清单**）⇒ `rel → card` 的对应关系被丢掉，下游只能得到"这批里有哪几张卡"，
   *   而不知道"哪个文件是谁的卡" ⇒ `write_log` 就写不出 `card_id`，「无卡写」永远只能事后猜。
   * ★ 键空间与 `toIndexKey` 同一把尺（项目相对 posix）；本批 `rels` 之外的键不会出现在这里。
   * ★ 与 `branch_of` 是两个读数、不是一件事：一个答"谁的卡"，一个答"哪一支放行的"。
   */
  card_of: Record<string, { feature: string; nodeId: string } | null>;
  /**
   * ★★★ 2026-11-03（同上 · 步骤③）：**逐文件「是哪一支放行的」**（`basis` 的 per-file 版）。
   *
   * ★ 为什么不能只留整批的 `basis`：一批里可能同时有 exempt 与 covered（`covered` 支的 note 就这么写的），
   *   整批一个 `basis` 会把豁免文件记成"有卡"。而本账要回答的正是
   *   「62 个 exempt 节点里哪些真的在被改」⇒ 支名必须**逐文件**。
   */
  branch_of: Record<string, TaskGateBasis>;
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

// ★★★ I1（2026-10-25）：任务闸拒绝的**出路文案**里必须有 authorize 方案。
//   ★ 为什么单拎成一个导出常量：① 出路列表是调用方**唯一的行动指引**，漏一条 = 把人堵死在闸外
//     （实测：批量改 packages/ 下文件时，出路只有"逐文件立卡"一条，authorize 已支持却不说）；
//     ② 抽成常量才能被单测钉住内容（tests/i1_write_gate_escape.test.ts），文案改坏测试会红。
//   ★ 判据不在这里：authorize 的文法唯一落点 = `domain/scope.ts`；放行判据 = 本文件 T356 那段
//     （本批 ⊆ scope ∧ scope 里有你的 claimed 卡）。这里只负责**指路**（被「怎么领」段引用）。
export const AUTHORIZE_ESCAPE_HATCH =
  `  ③ 本批文件**同属一个范围**、且你已在该范围内领了卡 ⇒ 用「按 run 授权」**一次放行整批**（免逐文件立卡）：\n` +
  `     在本次写调用（edit_code / rename_files / apply_refactor_plan …）的入参里带：authorize: 'files:packages/xxx/'\n` +
  `     · 文法唯一落点 = domain/scope.ts（files:目录/ / nodes:id,id / subtree:节点 / layer:main）；\n` +
  `     · 判据 = 本批要写的文件**全部**落在该 scope 内 ∧ 该 scope 的节点里有**你领的** claimed 卡（A7 不放宽）；\n` +
  `     · ★ authorize:'all' **明令拒绝**（把整份 DSL 都授权出去 = 关闸）。不传 authorize ⇒ 逐文件判定（上面的 ①②）照旧可用。`;

/**
 * 任务闸放行的依据分类 —— ★ **词表已搬到 `src/domain/task_gate_basis.ts`**（那里连同它的
 * 分诊表 `BASIS_CARDABILITY` 与 `cardabilityOfBranch` / `countsAsNoCardWrite` 三个纯函数一起住）。
 *
 * ★ 为什么搬走：这张表要回答的问题（「这一支放行的写，本来就该有卡吗」）是**可判定的**，
 *   判据必须有行为落点；而本文件 20+ 个值 import ⇒ `behavior-cases` 的执行核 load 不了它
 *   （`E-CRIT-006`）⇒ 判据住在这里只能退化成 `source-has`（存在类，永远发现不了逻辑错）。
 * ★ 为什么不是"复制一份到 domain"：那会让加第 9 个支时要改两处（0.9.1 第二处权威）。
 *   现在 `Record<TaskGateBasis, BasisCardability>` 在同一文件里**穷尽** ⇒ 漏分类 = 编译不过。
 * ★ 这里只**转出**（type-only re-export）：既有 import 点一行不用改。
 */
export type { TaskGateBasis };

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
  /**
   * 依据（第一种写法）：哪个 feature 的哪个节点声明了 `gate:'exempt'`（AND 语义 ⇒ 指向它的节点全部列出）。
   * ★ 册级 `excluded` 声明那一路**为空数组**（它不是节点）—— 那时候看 {@link declared}。
   */
  by: Array<{ feature: string; nodeId: string }>;
  /**
   * ★★★ 2026-11-04（F3）：依据（第二种写法）—— 册级 `excluded` 前缀声明。
   * ★ 为什么同一个字段里带两种依据而不新开一个字段：调用方（`edit_code` 回执）只关心
   *   「这次为什么能写」，两种依据的回答是同一个问题（0.9.1：一个是「叫什么」，一个是「凭什么」，不拆两个读数）。
   */
  declared?: { path: string; reason: string };
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
  /**
   * ★★★ 2026-11-04（F3）：**册级 `excluded` 声明的并集**（只收住在本项目里的那几册）。
   *
   * ★ 为什么必须有它：「设计侧声明豁免」在册上有**两种写法** —— ① 节点上 `gate='exempt'`
   * （逐文件声明）；② 册级 `excluded: [{path, reason}]`（**前缀**声明，用于整目录，如 `scripts/` 63 个量具）。
   * 闸原先只读① ⇒ 改量具时文件落进 `files-not-in-design` ⇒ 「每改一次 verify.mjs 基线必然 +1」
   * （G17 原话）⇒ 那就是「加机制必然加噪音」的确切机制。
   * ★ 所有权不新造：并集 = `gen_design_db#excludedPathsOf`，前缀匹配 = `#isExcludedPath`（唯一实现）。
   */
  declaredExcluded: ReadonlyArray<{ path: string; reason: string }>;
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
function nodeFilePath(n: { type?: string; path?: string }, sep: string): string | undefined {
  // ★★★ 2026-10-27（T-#37）：**回落 `description` 的分支已删** —— `Node.description` 已不存在，
  //   那个分支是死代码。
  //   ★ 顺带纠正一条**过期断言**：此前注释说它与 `overlay.ts#nodePath` 是“**同一把尺**”——
  //     其实**不是同一个概念**：
  //       · `nodePath` 给的是“路径**或** id”（展示/认亲用，**一定有值**）
  //       · 本函数给的是“**真实文件路径，没有就 `undefined`**”（写闸要判“这个节点指不指文件”）
  //     ⇒ 两个概念，各留一份实现；但**取值口径一致**（`path` 优先、`\`→`/`）。
  const explicit = n.path;
  if (typeof explicit !== 'string' || !explicit.trim()) return undefined;
  return explicit.split(sep).join('/');
}

/**
 * 该项目根上「**覆盖某批文件**」的设计 feature 列表（每个带 `path → node_id` 表）。
 *
 * ★★★ 2026-10-20：**枚举源 = 设计侧**（`storage.ts#listDesignSheets` → `getDesignSheet`，与 `getDSL` 同一处）。
 *   此前走 `listFeatures()` 读 `features/` —— 那个目录 2026-10-18 搬走后只剩 overlay ⇒ 返回 `[]`
 *   ⇒ `rootFeatureCount=0` ⇒ `applicable:false`（"本项目不用任务系统"）⇒ **闸对全仓源码恒放行**。
 *   ★ 实测（本仓）：`totalFeatures=2 / rootFeatureCount=2 / covering=2`，`write_gate.ts` 判 `covered`。
 *
 * ★ 反查口径**只认 `storage#isSameProject`**（册住在谁家：`<根>/.agent-io/design/` 之下）；
 *   **不许**比 `DSL.source_root` —— 那是写册那台机器的绝对路径 ⇒ 换机器恒 false ⇒ 本闸静默放行。
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
    declaredExcluded: [],
  };
  /** ★ F3：住在本项目里的那几册（册级 `excluded` 的并集只许从它们的并集算） */
  const rootSheets: DesignSheetLike[] = [];
  // ★★★ 2026-10-20：读**设计侧**（`getDesignSheet` 同一处），不是 `listFeatures()` 的 `features/`。
  //   实测病：features/ 搬走后只剩 overlay ⇒ listFeatures() 返回 [] ⇒ rootFeatureCount=0
  //   ⇒ applicable:false（"本项目不用任务系统"）⇒ **闸对全仓源码恒放行**。
  for (const d of listDesignSheets()) {
    cov.totalFeatures++;
    // ★★★ 2026-11-01（第二个 P0 · 0.9 一处权威）：判「这册是不是本项目的」**只认一个口径** ——
    //   `storage#isSameProject`（册住在谁家：`<absRoot>/.agent-io/design/` 之下）。
    //   ★ 别再写 `path.resolve(d.source_root) === absRoot`：`source_root` 是**写册那台机器**的绝对路径
    //   ⇒ 换机器恒 false ⇒ `rootFeatureCount = 0` ⇒ 本闸 `applicable:false` ⇒ **对全仓静默放行**。
    if (!isSameProject(d, absRoot)) continue;
    cov.rootFeatureCount++;
    // ★★★ F3：留下「住在本项目里的册」本身 —— 册级 `excluded` 的并集与前缀匹配都只许走
    //   `gen_design_db#excludedPathsOf` / `#isExcludedPath`（唯一实现，不在这里重写一份）。
    rootSheets.push(d as unknown as DesignSheetLike);
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
      // ★ T-#37：cast 里的 `description?: string` 已删（`nodeFilePath` 不再接受它）
      const rel = nodeFilePath(n as { type?: string; path?: string }, path.sep);
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
  // ★★★ F3：「设计侧声明豁免」的第二种写法 —— 册级 `excluded`（前缀声明，如 `scripts/` 量具整目录）。
  //   并集只算**本项目的册**（与上面 `isSameProject` 同一把尺），前置条件不满足时它就是空数组
  //   （空数组 = 「本批没有任何册级豁免声明」，不是「没算」）。
  cov.declaredExcluded = excludedPathsOf(rootSheets);
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
 * ## 留痕落点（**就是本轮回执**）
 * ★ 2026-11-02（⓪ 清死枚举）校正：`dsl.annotations[]` 那条路**已经不存在**（2026-10-23 批注层退场：
 *   无写端、`query_feature {query:'annotations'}` 也无 case）⇒ 留痕的唯一落点 = 本次调用的回执。
 *   当时三选一的取舍过程见 `docs/RETIRED.md`。
 * ★ 幂等：同一天同一节点**只留一条**（`gate_warn_<nodeId>_<yyyymmdd>`）。
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
      `写闸放行留痕（收集失败）：节点 "${u.nodeId}"**无 path** ⇒ 它指不出"哪个文件"，` +
      `本次写盘的任务闸**无法核对**该节点。\n` +
      `★ 本次放行的文件：${files}\n` +
      `★ 为什么不拦：缺字段**不损坏数据**，只是"这次写没在账上"（记录问题）；拦它会让整个项目改不动。\n` +
      `★ 怎么消掉这条：给该节点补 \`path\` —— **唯一落点**（仓库相对路径、正斜杠，例：\`src/application/write_gate.ts\`）：\n` +
      `  edit_dsl { feature:'${u.feature}', reason:'补文件指针', operations:[{ type:'node', op:'update', id:'${u.nodeId}', data:{ path:'src/application/write_gate.ts' } }] }\n` +
      `  ★ \`description\` **已删除**（T-#35/#37：\`AnyNode.description\` 已不存在，读写两端都不认）⇒ 不要再往它写路径。\n` +
      `  或若它确实不指文件（聚合/概念节点）⇒ 把 type 改成非 file/doc。`;
    // ★★★ 2026-10-23（和前端切割·第二步）：**不再落盘留痕**。
    //   用户裁定「前端只是一个显示屏…给前端用的这些都不需要」⇒ 批注层整个退场。
    //   这些提示仍然有用，但它们是**给 Agent 的回执**，不是要人来看的画布数据 ⇒ 只进回执。
    const where = `★ 这条要在本轮回执里看到（不再写进任何画布文件）。`;
    out.push(
      `· 节点 ${u.nodeId}（feature=${u.feature}，type=${u.type ?? '?'}）**无 path**（\`description\` 已删，不再是退路）；${where}`,
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
  /**
   * ★ 2026-11-04（F3）：豁免的**两种写法**分开渲染，但都回答同一个问句「凭什么能写」。
   * ★ 节点那一路的句式**逐字不变**（`tests/p0_gate_exemption.test.ts` ⑥a 钌着它）
   *   —— 那是既有契约，改它就是“为了让新代码好看而改旧判据”。
   */
  const whyOf = (e: GateExemption): string =>
    e.by.length
      ? `节点 ${e.by.map((b) => `${b.nodeId}，feature=${b.feature}`).join(' / ')}，gate=exempt`
      : `册级 excluded 声明 \`${e.declared?.path ?? '（未记）'}\` —— ${e.declared?.reason ?? '（无 reason）'}`;
  return (
    `★ 本次写入 ${exempted.length} 个文件被豁免（依据：**设计侧**声明（节点 \`gate='exempt'\` 或册级 \`excluded\`）；闸不替你豁免，只读它）：\n` +
    exempted.map((e) => `  · 本次写入 ${e.path} 被豁免（${whyOf(e)}）`).join('\n')
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
 * 拦：`项目根上有设计册覆盖该文件（册住在本项目 .agent-io/design/ 下 · storage#isSameProject ∧ 该文件是它的文件节点）`
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
 * ★★★ 2026-10-28（重写计划层 · 迭代 ②）：**把 `plan_exit` 搬进人读回执的唯一渲染处**。
 * 与 `gateHumanLines(task_gate)` 同款：结构化读数在写穿结果里（机器侧），这里只出一行给人/agent 看。
 * ★ 只在**有异常**时出声（全绿闭嘴）—— 版面孔径与今晚"40 行散文"那条一致。
 */
/**
 * ★★★ 2026-10-28（用户："正好开个默认试试"）：**严格档默认开**，唯一读法住这里。
 *
 * ## 判据（三态）
 * · `AGENT_IO_REQUIRE_PLAN=0` / `off` / `false` ⇒ **关**（只报不拦）—— 测试与批量迁移用它；
 * · 其他任何值（含**不设**）⇒ **开**（没计划 / 画布过期 ⇒ 拒写）。
 *
 * ## 为什么敢默认开
 * ① 计划成本已被压到「1 条 entry + 一句 why」（紧凑 `untouched_default` 实测四判据全过）；
 * ② 误报只有一类（`create` 做完后文件已存在）且**已修**（跳过 `done`）；
 * ③ 拦的只是**写源码**这一步，且错误里都带「怎么办」三步 —— 不是死路。
 * ★ 关掉的口子必须留着：证 / 工具会在**没有画布**的临时项目上跑，不能因为默认开而全红。
 */
export function planStrictMode(): boolean {
  const v = (process.env.AGENT_IO_REQUIRE_PLAN ?? '').toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false');
}

/**
 * ★★★ 2026-11-01（首跑墙 · 外部审计 ①）：**首跑模式** —— 两道闸一起降级为"只点名不拦"。
 *
 * ## 为什么必须是一个开关，而不是让新人去读两份文档
 * README 原来的"救命开关"只有 `AGENT_IO_REQUIRE_PLAN=0`（= 画布闸 E-PLAN-021/023），
 * 而**任务闸 E-TASK-001** 它一个字都没提 ⇒ 新用户照着 README 走，第一行 `edit_code` 仍被拒
 * （2026-11-01 实测：空 home + 演示项目 + `AGENT_IO_REQUIRE_PLAN=0` ⇒ 改一行**照样被拒**）。
 * 一个开关同时管两道闸 ⇒ "新人的第一次"只有一种写法。
 *
 * ## 判据（唯一读法就在本函数）
 * · `AGENT_IO_FIRST_RUN=1` / `true` / `on` ⇒ **开**（两道闸只点名）；
 * · 其他任何值（含**不设**）⇒ **关** —— 受保护是默认。
 * ★ **不许默认开**：闸是用来防"忘了写画布 / 忘了领卡"的，不是用来考新人的；但也不能替所有人关掉
 *   ⇒ "我在首跑"这个事实必须由人**说出来**。
 *
 * ## 降级的**只有**这两道
 * A7「卡不是你领的」/ 租约代际 / 前置闸未 done —— **照拦**：它们拦的是**真损坏**
 * （覆盖别人的工作、拿过期写权覆盖新接管的活），不是"你还不熟"。首跑模式不替任何人打开这三条。
 */
export function firstRunMode(): boolean {
  const v = (process.env.AGENT_IO_FIRST_RUN ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/**
 * 首跑模式那一行 —— **唯一文案处**（写闸的 `note` 与 `invokeTool` 的回执都从这里取，别处不许再写一份）。
 *
 * ★ 为什么要求"每次回执都打印"而不是启动日志打一行：首跑模式下**拦截消失得无声无息**，
 *   用户看不出自己没受保护 ⇒ 每次落盘回执都重复一遍"现在两道闸都只点名"，并给出恢复方法。
 */
export const FIRST_RUN_BANNER =
  '本次是首跑模式：任务闸 + 画布闸都只点名不拦；要恢复请 unset AGENT_IO_FIRST_RUN';


/**
 * ★★★ 2026-10-28（T245 复查出的真身）：**写路回执的"计划读数"只许有一份实现**。
 *
 * ## 两条写路原来各写一遍
 * `apply_writes` 从写穿结果里读 `plan_exit` / `plan_baseline`；而 `edit_code` **自己调
 * `checkRewriteExit` 重算一遍**（回执时算，不是写穿时算）⇒ 同一判据住两处，且 `plan_baseline`
 * （画布基线新陈代谢："吸收设计缺口 / 基线已挪到写后"）在 `edit_code` 这条路上**被整个丢掉**。
 *
 * ## 判据（本函数就是判据）
 * 只读 `WriteThroughOutcome` 上那两份读数，**不重算**：`plan_exit`（出口闭环）+
 * `plan_baseline`（新陈代谢）。空 ⇒ 返回空串（全绿闭嘴，与其它回执同一口径）。
 */
export function renderPlanReadings(
  out: WriteThroughOutcome | null | undefined,
  /** @deprecated 2026-10-28（T-#RP-3 之后 edit_code 也走 `close()`）⇒ 读数恒从写穿结果来，本参数不再使用 */
  /**
   * ★ 2026-10-28（T245 复查的**第二层**真因）：`edit_code` 是**逐分支** `txn.commit()` + 自己 `syncFile`，
   * 拿不到 `close()` 的**批级**读数 ⇒ `out` 上常常没有 `plan_exit` / `plan_baseline`。
   * 当初正因为如此，`edit_code` 才自己重算一遍 —— **不是重复实现，是拿不到读数**。
   * ⇒ 把"拿不到就现算"收进**这一个函数**（写在一处、理由写在这里），调用方只管调。
   *
   * ## ★ 为什么"在 `commit()` 时就把读数算好"这条路**走不通**（2026-10-28 验证过，别再试）
   * `checkRewriteExit` 的判据（锚点在不在、`body_hash` 变没变）**读的是索引** `cache.db`；
   * 而 `commit()` 只落了盘、索引要等 `close()` 的 `syncSelfWritesSync` 才更新
   * ⇒ 在 `commit()` 时算出来的读数是**对着旧索引**算的（会误报 not_yet / 看不见 `changed_unplanned`）。
   * ⇒ 结构解只有一条：**写路只许有一种收尾**（统一走 `close()`，再按文件取读数），见 `docs/todo.md` T-#RP-3。
   * ★ 本函数的回退**不是第二套判据**：它调的还是 `checkRewriteExit`，且此时调用方已自己 `syncFile`
   *   ⇒ 索引是新的 ⇒ 与 `close()` 时算出的结果**等价**；差别只是"多做一次计算"，不是"另一把尺"。
   */
  ctx?: { root: string; rel: string },
): string {
  const parts: string[] = [];
  const exit = planExitHumanLine(out);
  if (exit) parts.push(exit);
  for (const l of out?.plan_baseline ?? []) parts.push(`  ${l}`);
  // ★ T-#RP-3 之后**没有回退**：读数只从写穿结果来（写路统一收尾 close()）。\n  //   若这里为空 = 这次写没有画布 / 没有异常 ⇒ 闭嘴（与其它回执同一口径）。\n
  return parts.length ? '\n' + parts.join('\n') : '';
}
export function planExitHumanLine(out: WriteThroughOutcome | null | undefined): string {
  const lines = out?.plan_exit ?? [];
  if (!lines.length) return '';
  return lines.map((l) => `  ★ ${l}`).join('\n');
}

/**
 * ★★★ 2026-10-28（重写计划层 · 第 3 步）：**"先读懂再改"的闸** —— 与任务闸**并列**的一条独立判据。
 *
 * ## 判据（一句话）
 * 要写的文件必须有一份**够格的**重写计划（`<proj>/.agent-io/plan/<rel>.plan.json`）：
 * 每条 entry 有锚点（符号名）· `detail` · **`judgement_ref`** · 无 `stale`。
 * 判据的**唯一实现**在 `design/db/rewrite_plan.ts#planGaps`（这里不重写一遍）。
 *
 * ## 两档：严格档**默认开**（权威见 `docs/GUIDE-GATE.md`）
 * ★ 默认开必须配**成本可付**的计划格式（1 条 entry + 一句 why + 紧凑 `untouched_default`），否则等于让所有源码都改不动 —— 那正是"闸堵死流程"。
 * ⇒ 分两档：
 *   · **只点名**（仅当 `AGENT_IO_REQUIRE_PLAN=0|off|false`）：把缺口**逐文件点名**进 warnings（可见、可追，不静默）；
 *   · **严格（默认）**：没计划 / 画布过期 ⇒ **拒绝落盘**；只有 `AGENT_IO_REQUIRE_PLAN=0|off|false` 退回"只点名"。
 * ★ 与 T360 的 `judge_gate` 同一路数：**存量先记账**；但本闸**默认开**（不需要人打开），要退回"只点名"必须显式设 `AGENT_IO_REQUIRE_PLAN=0|off|false`。
 */
/**
 * ★ 2026-10-28（迭代 ④）：把一条计划的 `judgement_ref` 解成**判据种类**。
 * 只认 `decision:<node_id>#<index>`（判据的唯一住处 = 册里节点的 `decision.expectations`）；
 * `cert:` 形态**解不出种类**（证的检查号不登记 kind）⇒ 如实报"解不出来"，不假装强。
 */
export function resolveJudgementKind(
  entry: { judgement_ref?: string },
  /** 项目根：册按项目分居 ⇒ 解析必须知道读**哪一本册**（改前不给根，只能走跨项目的册序） */
  projectRoot: string,
  /** 已读好的册（一次 plan 有 N 条 entry，别每条重读十几 MB JSON；省略则现读一次） */
  sheets?: readonly DesignSheetLike[],
): { kind?: string; why_not?: string } {
  const parsed = parseJudgementRef(entry.judgement_ref);
  if (!parsed) return { why_not: '引用不是规范形态' };
  if (parsed.kind === 'cert') return { why_not: `\`cert:\` 形态不登记判据种类（${parsed.file}#${parsed.check}）` };
  try {
    const list = sheets ?? loadDesignSheetsForGate(projectRoot).sheets;
    // ★ R72：3 段写法（`decision:<feature>:<node>#<i>`）带的**显式册名**必须传下去 ——
    //   丢在这里就是"解析到了却静默忽略"，与本条要治的"册名被吞进 nodeId"同病，只是更隐蔽。
    const sheetName = 'feature' in parsed ? parsed.feature : undefined;
    const r = resolveDecisionExpectation(parsed.nodeId, parsed.index, list, sheetName);
    if (!r.ok) return { why_not: r.why_not };
    return { kind: String((r.exp as { kind?: string }).kind ?? '') };
  } catch (err) {
    return { why_not: `读册失败：${(err as Error).message}` };
  }
}

/**
 * 该文件每个顶层符号的 `body_hash`「冻结指纹」的**结果形状**。
 *
 * ★★★ AGENTS-RULES 0.12：`ok` 把「算不出」与「文件真的没有顶层符号」分开 ——
 * 与兄弟函数 `symbolsInFileOf`（`SymbolsInFileResult`）**同一把尺**。
 * `ok:false` 的 `fps` 恒为空对象，**读端不许**把它当"没有符号"用。
 */
export interface SymbolFpsResult {
  ok: boolean;
  /** 符号名 → body_hash（`ok:false` 时恒空，不猜） */
  fps: Record<string, string>;
  /** `ok:false` 时的原因（索引不在 / 读索引失败）：不许空手返回 */
  reason?: string;
}

/** ★ 2026-10-28：该文件**每个顶层符号的 `body_hash`**（画布冻结用）。
 *
 * ★★★ AGENTS-RULES 0.12（2026-10-31）：**算不出 ≠ 文件没有顶层符号** → 返回 `ok`。
 * 改前 `catch { return {} }`：索引不在/被锁/坏库 ⇒ 指纹集空 ⇒ 画布写进 `fps_at_freeze: {}`
 * ⇒ `plan_exit_check` 里 `if (fpsAtFreeze && Object.keys(...).length)` 整条不判
 * ⇒ **「改了却没计划」这条守卫静默失效**（而它读起来和"这个文件没有顶层符号"一模一样）。
 * 调用方一律按 `ok` 分支：失败要么**拒冻结**（`design_line action=plan`），
 * 要么写进回执（`WriteThroughOutcome.plan_baseline`）—— 禁止回落成空对象了事。
 */
export function symbolFpsOf(projectRoot: string, rel: string): SymbolFpsResult {
  try {
    const dbFile = projectCacheDbPath(path.resolve(projectRoot));
    if (!fs.existsSync(dbFile)) return { ok: false, fps: {}, reason: `索引不存在：${dbFile}` };
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db
      .prepare("SELECT name, body_hash FROM nodes WHERE file_path = ? AND kind != 'file' AND parent IS NULL")
      .all(rel) as Array<{ name: string; body_hash: string | null }>;
    db.close();
    const out: Record<string, string> = {};
    for (const x of rows) if (x.body_hash) out[x.name] = x.body_hash;
    return { ok: true, fps: out };
  } catch (e) {
    // ★ 0.12：不许空手返回 —— 锁 / 坏库 / 权限各是各的病（与 symbolsInFileOf 同一口径）
    return { ok: false, fps: {}, reason: `读索引失败：${(e as Error).message}` };
  }
}

/**
 * 该文件在**实际 DB**里的符号名（排除 `kind='file'`）。
 *
 * ★★★ AGENTS-RULES 0.12：**读不到索引 ≠ 文件没有顶层符号** —— 返回 `ok` 分开这两件事。
 * 改前是 `catch { return [] }`：`cache.db` 不在/被锁 ⇒ 清单空 ⇒ `planCoverageGaps` 的 `silent`
 * 为空 ⇒ **A7「每个顶层符号都要表态」整格静默失效**（唯一有守卫的只有 `untouched_default` 那支）。
 * 调用方**一律**走 `planCoverageGapsOf`（覆盖判据的唯一入口），别自己判 `ok`。
 */
export function symbolsInFileOf(projectRoot: string, rel: string): SymbolsInFileResult {
  try {
    const dbFile = projectCacheDbPath(path.resolve(projectRoot));
    if (!fs.existsSync(dbFile)) {
      return { ok: false, symbols: [], reason: `索引不存在：${dbFile}` };
    }
    const db = new DatabaseSync(dbFile, { readOnly: true });
    // ★ 2026-10-28（真实开发试点发现）：**只算顶层符号**（`parent IS NULL`）——
    //   内层 helper（实测：`planTopoOrder` 里的 `visit`）不该要求人"表态"，
    //   它属于外层函数的实现细节。这条规则与设计 DB 投影（`design_db_projection.ts`）**同一把尺**。
    const rows = db
      .prepare("SELECT name FROM nodes WHERE file_path = ? AND kind != 'file' AND parent IS NULL")
      .all(rel) as Array<{ name: string }>;
    db.close();
    return { ok: true, symbols: rows.map((r) => r.name) };
  } catch (e) {
    // ★ 0.12：不许空手返回 —— 读失败要带出原因（锁 / 坏库 / 权限各是各的病）
    return { ok: false, symbols: [], reason: `读索引失败：${(e as Error).message}` };
  }
}

function planGate(projectRoot: string, rels: readonly string[]): { warnings: string[]; blocking: string[] } {
  const warnings: string[] = [];
  const blocking: string[] = [];
  // ★ 册只读一次（一次写有 N 个文件、每条 entry 都要解析 ⇒ 别每条重读十几 MB JSON）。
  //   ★ 读不到 ⇒ **逐条点名**，不许回落成"找不到节点"（0.12：读失败与"没有"必须可区分）。
  let sheets: DesignSheetLike[] = [];
  let sheetsErr = '';
  try {
    sheets = loadDesignSheetsForGate(projectRoot).sheets;
  } catch (e) {
    sheetsErr = (e as Error).message;
  }
  const loadGaps = sheetsErr
    ? [`judgement_ref 解析**未生效**：读册失败（${sheetsErr}）—— 这不是"册里没有这条判据"`]
    : [];
    for (const rel of rels) {
      const plan = readRewritePlan(projectRoot, rel);
      // ★ 2026-10-28（迭代 ③）：**"通读"的可判形态** —— 符号全集逐个表态。
      //   符号清单只从实际 DB 取（`cache.db` 的 nodes）。
      // ★★ 0.12：**取不到索引 ≠ 文件没有顶层符号** —— `symbolsInFileOf` 现在回 `{ok,symbols,reason}`，
      //   失败由 `planCoverageGapsOf` 变成一条**可见**的缺口（改前回 `[]` ⇒ `silent` 为空 ⇒ A7 整格静默失效）。
      const inFile = symbolsInFileOf(projectRoot, rel);
      // ★★★ 2026-11-05（R12②）：**档位读 `tier`，不读文案**。
      //   改前这里是 `const covGaps = planCoverageGapsOf(...)` + 末尾 `gaps.filter((g) => !covGaps.includes(g))`
      //   —— 按**字符串内容**把整族覆盖缺口从 blocking 里筛掉（0.18① 违例：结构判据不许用文本比内容）。
      //   后果（实测）：`E-PLAN-008/009/010` 整族**只进 warnings、从不拦落盘**，而注释本意只放行
      //   "索引读不到"那**一条**；改一个标点就静默改档位。
      //   ⇒ 现在 blocking / info 由 `rewrite_plan#PLAN_COVERAGE_TIER` 判（唯一住处），这里只按档位分桶。
      const cov = planCoverageGapsOf(plan, inFile);
      const gaps = [
        ...planGaps(plan),
        ...planUntouchedGaps(plan),
        ...cov.blocking,
        // ★ 迭代 ④：判据**强不强**（存在性判据发现不了逻辑错）
        ...loadGaps,
        ...planJudgementGaps(plan, (e) => resolveJudgementKind(e, projectRoot, sheets)),
        // ★ 迭代 ⑤：**路线**（依赖/顺序）成不成立
        ...planDependencyGaps(plan),
        // ★ 试点：\kind\ 的前提（create/delete 与文件现状对不上 ⇒ 路线建在错前提上）
        ...planKindGaps(plan, fs.existsSync(path.join(projectRoot, rel))),
      ];
      // ★★ `info` 档：**点名、不拦**（`E-PLAN-009` 该重冻结 / `index-unavailable` ⇒ A7 这一格本次没生效）。
      //   它仍然逐条点名（0.12：不许静默），只是**不进 blocking** —— 档位出自 `PLAN_COVERAGE_TIER`，不是这里判的。
      if (cov.info.length) {
        warnings.push(
          `· ${rel} 计划闸点名（${cov.info.length} 处）：**不拦落盘**（该重新冻结 / 这一格本次没生效 ⇒ 不是"计划不成立"）\n` +
            cov.info.map((g) => `    - ${g}`).join('\n'),
        );
      }
      if (!gaps.length) continue;
      const head = `· ${rel} 没有够格的重写计划（${gaps.length} 处）：`;
      const body = gaps.slice(0, 4).map((g) => `    - ${g}`).join('\n');
      const how =
        `    ★ 怎么办：先通读该文件在设计里指向的区域 → 选定要改的符号 → 用 ` +
        `\`design_line { action:'plan', file:'${rel}', card:'<卡 id>', entries:[…], apply:true }\` 写画布` +
        `（★ 画布住 \`tasks.db#plans\`，不再有盘上的 .plan.json）：\n` +
        `      { "path": "${rel}", "entries": [{ "anchor": { "symbol": "<符号名>" }, "kind": "rewrite",\n` +
        `        "detail": "<要改成什么样>", "judgement_ref": "<拿什么验>", "status": "open" }] }`;
      const line = `${head}\n${body}\n${how}`;
      warnings.push(line);
      // ★ 走到这里 ⇒ `gaps` 里**全是 blocking 档**（info 已在上面单独点名）⇒ 第一条就是拒绝理由。
      //   ★ 改前这一行是 `const blockGaps = gaps.filter((g) => !covGaps.includes(g))` —— 那行就是缺陷本体，已删。
      blocking.push(`${rel}（${gaps[0]}）`);
    }
    return { warnings, blocking };
  }

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
  /**
   * ★★★ 2026-10-30（fencing）：调用方**持有哪一代**的写权（`claim` 回执里的 `lease_generation`）。
   * ★ **不传 ⇒ 不校验**（老 CLI / 老脚本照常跑 —— 否则全仓写会一夜变红，那是停摆不是变严）。
   */
  leaseGeneration?: number,
): TaskGateOutcome {
  return assertSourceWriteRegistered(projectRoot, files, { actor: resolveActor(actor), authorize, symbols, leaseGeneration });
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
   * ★★ 第⑪项：`instrumentChannel` = 插桩通道（见 evaluateTaskGate 的豁免块；handleInstrument 传）。
   */
  opts?: { actor?: WriteActor | null; authorize?: string | null; symbols?: readonly AssumptionTarget[]; leaseGeneration?: number; instrumentChannel?: boolean; direct?: boolean },
): TaskGateOutcome {
  // ★★★ 2026-11-17（L3b / E9）：**派生视图直写 ⇒ 终局拒绝**。
  //   ★ 位置在最前（`direct` 短路与计划闸的让位都在后面）：这道闸**不是流程闸**，没有"跳过流程"的开关 ——
  //     `direct`（模型自判小改）/ `authorize`（按 run 授权）/ 设计侧 `exempt` / 首跑模式
  //     全都不许放行它（它们的语义是"这次不走流程"，不是"允许造第二真相"）。
  const derivedHits = derivedViewHits(projectRoot, files);
  if (derivedHits.length) {
    throw new Error(
      `拒绝落盘（**派生视图** · 第二真相的入口）：${derivedHits.join(', ')} 是台账引擎的**派生层**，` +
        `agent 写路不许直写它。\n` +
        `★ 为什么拦：它的真相住 \`.agent-io/tasks.db\`（\`ledger_rows\` / \`ledger_events\`），` +
        `唯一渲染器 = \`src/application/ledger/render_ledger_view.ts\`（\`npm run ledger:render\`）。` +
        `直写它 ⇒ 下一次渲染**覆盖你的字**，而 \`npm run ledger:check\` 只会说"有人手改了"（` +
        `它分不清是谁写的）—— 这就是"第二真相"的形状。\n` +
        `★ 怎么办（三条，都是正路）：\n` +
        `  ① 要**记一条账**（新增/批注/销账/裁定）⇒ 用 \`ledger\` 工具（hang / annotate / close / verdict）；\n` +
        `  ② 要让视图跟上引擎 ⇒ \`npm run ledger:render\`（重生成；不是由你写视图）；\n` +
        `  ③ 要确认视图是否最新 ⇒ \`npm run ledger:check\`（` +
        `\`0\` 最新 / \`3\` 陈旧或缺 / \`1\` 手改或判不了）。\n` +
        `★ 本闸**没有**环境变量开关：\`direct\` / \`authorize\` / 设计侧 \`exempt\` / 首跑模式都不放行它` +
        `（省流程 ≠ 允许多一个真相源）。若 \`${derivedHits[0]}\` 真的不该再是派生视图（例如引擎要退役），` +
        `那是一次**架构裁定**：改 \`DERIVED_VIEW_PATHS\` 并留下裁定记录，而不是这一次写绕过它。`,
    );
  }
  const out = evaluateTaskGate(projectRoot, files, opts);

  // ★★ 第⑬项任务 1（直通车 · lead 实测抓到的缺口）：**计划闸/画布闸也要给 direct 让位**——
  //   evaluateTaskGate 里 direct 短路只跳过了任务闸；这里的重写计划闸（E-PLAN-023）与画布闸
  //   是**并列**的独立判据 ⇒ direct 改动会先被计划闸拒（"没有够格的重写计划"），短路根本没到。
  //   ⇒ direct 传入时**两道设计流程闸都让位**（领卡/画布/计划闸一整套）；语法门/快照/写穿/契约反馈保留。
  if (opts?.direct === true) {
    return out;
  }

  // ★ 2026-10-28（第 3 步）：**重写计划闸** —— 与任务闸**并列**（不改上面任何一条判据）。
  //   ★ 默认**开**（没计划 / 画布过期 ⇒ 拒写）；只有 `AGENT_IO_REQUIRE_PLAN=0|off|false` 才降为"只点名"。唯一读法：`planStrictMode()`。
  const inRootRels = [...new Set(files.map((f) => toIndexKey(path.resolve(projectRoot), f)).filter((r): r is string => !!r))];
  const planR = planGate(path.resolve(projectRoot), inRootRels);
  // ★ 2026-11-01（首跑墙 ①）：首跑模式下**两道画布闸一起降级**（只点名不拦）—— 判据仍只住 `firstRunMode` 一处。
  const firstRun = firstRunMode();
  if (planR.blocking.length && planStrictMode() && !firstRun) {
    throw new Error(
      `拒绝落盘（重写计划闸）：这次要改的 ${planR.blocking.length} 个文件**没有够格的重写计划** —— ` +
        `本仓纪律：写源码前必须"**通读 → 选定范围 → 写完细节**"，细节要落进 \`plan/<rel>.plan.json\`。\n` +
        planR.warnings.join('\n') +
        `\n★ 闸的范围（只此一条）：\`planGaps\` 的五态判据（没计划 / 空 entries / 缺锚点 / 缺 detail / 缺 judgement_ref / stale）。\n` +
        `★ 为什么这样要求：计划写不下来的细节 = 还没想清楚；而"想清楚"是写完之后**没人能验**的东西。\n` +
        `★ 要关掉本闸：设 \`AGENT_IO_REQUIRE_PLAN=0\`（或 off/false）才只报不拦。（★ 不设 = 拦 —— 严格档默认开。）`,
    );
  }
  let ac: AssumptionCheck;
  let canvasStale: string[] = [];
  try {
    // ★ 2026-10-28（用户提议 → 落地）：把**画布冻结指纹**一并交给检定 ——
    //   读集要求"有人读过"（没读过就 checked:0，等于不设防）；画布是**显式冻结**的，恒有判据。
    const canvas = inRootRels
      .map((rel) => {
        const hash = readRewritePlan(path.resolve(projectRoot), rel)?.base?.content_hash;
        return hash ? { file: rel, content_hash: hash } : null;
      })
      .filter((x): x is { file: string; content_hash: string } => !!x);
    ac = checkAssumptions({
      projectRoot,
      files,
      targets: opts?.symbols,
      canvas,
    });
  } catch (e) {
    // ★ 检定是增强，不许把写入拖下水；但也**不许静默** ⇒ 读数里带 error。
    ac = { checked: 0, stale: [], readers: 0, error: (e as Error).message };
  }
  // ★ 2026-10-28（T-#RP-2 收尾）：**严格档下"画布过期"要拦** —— 严格档本来就是人开的，
  //   开了还放过"你的计划是对着旧内容写的"，那严格档等于没开。★ 严格档**默认开**（不设即拦）；只有 `AGENT_IO_REQUIRE_PLAN=0|off|false` 才只报不拦。
  canvasStale = (ac.stale ?? []).filter((s) => s.via === 'canvas').map((s) => String(s.file));
  if (canvasStale.length && planStrictMode() && !firstRun) {
    throw new Error(
      `拒绝落盘（画布过期）：这次要改的 ${canvasStale.length} 个文件，**内容已经不是画布冻结时那一版** —— ` +
        `${canvasStale.join(', ')}\n` +
        `★ 本仓纪律：画布冻结的 \`base.content_hash\` 变了 ⇒ 你**对着旧内容写的计划**，先重读再改（否则就是覆盖率最高的那种错）。\n` +
        `★ 怎么办：① 重读这些文件（确认现在的样子）；② \`design_line { action:'plan', file:'<rel>', sync_status:true }\` ` +
        `重跑闭环并刷新快照；③ 若计划本身要改 ⇒ 带新 \`entries\` 再从 \`apply:true\` 落盘。\n` +
        `★ 要关掉本闸：设 \`AGENT_IO_REQUIRE_PLAN=0\`（或 off/false）才只报不拦（回执里仍会看到这一行）。（★ 不设 = 拦。）`,
    );
  }
  // ★ 2026-11-01（首跑墙 ①）：首跑模式下**每次回执**都带两件事 —— ①这次那两道闸没拦谁（逐文件点名）
  //   ②`FIRST_RUN_BANNER` 那一行（否则用户以为自己在受保护，而拦截已经消失）。
  if (firstRun) {
    const named: string[] = [];
    if (planR.blocking.length) {
      named.push(
        `首跑模式·重写计划闸只点名（${planR.blocking.length} 个文件没有够格的重写计划）：${planR.blocking.join(', ')}`,
      );
    }
    if (canvasStale.length) {
      named.push(`首跑模式·画布过期只点名（${canvasStale.length} 个文件）：${canvasStale.join(', ')}`);
    }
    named.push(FIRST_RUN_BANNER);
    return {
      ...out,
      note: [out.note, ...named].filter((l) => !!l).join('\n'),
      warnings: [...out.warnings, ...planR.warnings, FIRST_RUN_BANNER],
      assumption_check: ac,
    };
  }
  return {
    ...out,
    warnings: [...out.warnings, ...planR.warnings],
    assumption_check: ac,
  };
}

/**
 * ★★★ 2026-10-30：**A7 通过 ⇒ 顺手刷心跳**（用户裁定："写闸触碰也算一次'我还在动手'"）。
 *
 * ★ 为什么放在写闸而不是各写工具里：这里是"这张卡**覆盖了我要写的文件**"的**唯一**判定点 ——
 *   换作在每个写工具里刷，就要 5 处各写一遍（而漏掉一处 = 那张卡被误判僵死，由别人承担）。
 * ★ 热路径不狂写："要不要写"由 `touchTaskHeartbeat`（内部 `shouldTouchHeartbeat`）判，< 60s 直接返回 `fresh`。
 * ★ 跳过**不打印**（那是常态）；失败**必须点名**（否则“心跳停在哪”无人知晓）。
 */
function touchCoveredHeartbeats(cards: readonly { feature: string; nodeId: string }[]): string {
  const seen = new Set<string>();
  const touched: string[] = [];
  const failed: string[] = [];
  const now = Date.now();
  for (const c of cards) {
    const key = c.feature + '/' + c.nodeId;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = touchTaskHeartbeat(c.feature, c.nodeId, now);
    if (r === 'touched') touched.push(key);
    else if (typeof r === 'object' && r && 'error' in r) failed.push(key + '（' + String(r.error).slice(0, 120) + '）');
  }
  if (!touched.length && !failed.length) return '';
  return (
    '\n★ 心跳（A7 通过 ⇒ 这张卡证明了"我还在动手"，顺手刷新）：' +
    (touched.length ? touched.join(' / ') + ' 已刷新' : '') +
    (failed.length ? (touched.length ? '；' : '') + '刷新失败 ' + failed.join(' / ') : '')
  );
}

function evaluateTaskGate(
  projectRoot: string,
  files: readonly string[],
  opts?: {
    actor?: WriteActor | null;
    authorize?: string | null;
    symbols?: readonly AssumptionTarget[];
    /** ★ 2026-10-30（fencing）：本次调用带来的租约代际（`undefined` = 没带 ⇒ 不校验） */
    leaseGeneration?: number;
    /** ★★ 第⑪项：**插桩通道标记**——observe handler 传入即声明走"可还原基建"纪律（见豁免块注释） */
    instrumentChannel?: boolean;
    /** ★★ 第⑬项任务 1：**直通车**——模型按改动性质自判的小改（函数体/文案/变量名）跳过设计流程闸。
     *  ★ 保留：写授权闸 / 语法门 / 写前快照 / 写穿 / 契约反馈（事后兜底——红 = 违反设计，模型必须面对）。
     *  ★ 别处不许传：这是"模型显式放弃设计流程"的通道，滥用 = 关闸（basis=direct 可追责）。 */
    direct?: boolean;
  },
): TaskGateOutcome {
  const root = path.resolve(projectRoot);
  const rels = [...new Set(files.map((f) => toIndexKey(root, f)).filter((r): r is string => !!r))];
  /**
   * ★★★ 2026-11-03（`docs/todo.md` §一 0.8「无卡变更」第三本账 · 步骤③）：**逐文件读数**
   * （`card_of` = 谁的卡，`branch_of` = 哪一支放行的）。
   *
   * 不变量（两条，都能变红）：
   *   ① 记卡**只许经 `recordCard()`**（它内部那一行是全党唯一赋值）—— 多一处就是第二把尺，写账会记错卡；
   *     ★ 2026-11-04（G13）：三条路径（A7 直接过 / A7 拿不到 actor / 按 run 授权）都走它。
   *   ② 每个 `return` 都必须经 `readings()` 落读数 —— 漏一支，那一支放行的写到了下游就是
   *      "读不到"，而它必须与"无卡"可区分（AGENTS-RULES 0.12）。
   */
  const cardOf: Record<string, { feature: string; nodeId: string } | null> = Object.fromEntries(
    rels.map((r) => [r, null]),
  );
  const branchOf: Record<string, TaskGateBasis> = {};
  const readings = (
    basis: TaskGateBasis,
    overrides?: ReadonlyArray<readonly [string, TaskGateBasis]>,
  ): Pick<TaskGateOutcome, 'card_of' | 'branch_of'> => {
    for (const rel of rels) branchOf[rel] = basis;
    for (const [rel, b] of overrides ?? []) branchOf[rel] = b;
    return { card_of: cardOf, branch_of: branchOf };
  };
  /**
   * ★★★ 2026-11-04（G13 的修法）：「这次写挂在哪张卡上」的**唯一写点**。
   *
   * 不变量（两条，都能变红）：
   *   ① `cardOf[rel] =` **全函数只出现一处** —— 就是下面这一行；三条记卡路径
   *     （A7 直接过 / A7 拿不到 actor / 按 run 授权）都**经它**，而不是各写一行（多写一行 = 第二把尺）。
   *   ② 记不记卡**与「卡是不是你的」严格分开**：凭证（卡存在）是**事实**，归属（owner===actor）是**核对**；
   *     拿不到 actor 只说明「没核对」，不说明「没有卡」⇒ 记卡 + 在回执里标未核对
   *     （0.12：要报「未验证」，不是「没有」）。
   */
  const recordCard = (rel: string, card: { feature: string; nodeId: string }): void => {
    cardOf[rel] = { feature: card.feature, nodeId: card.nodeId };
  };
  if (!rels.length) {
    return {
      applicable: false,
      basis: 'no-files',
      note: '没有落在项目根内的文件 ⇒ 任务闸不适用（放行；依据：入参里 0 个文件落在项目根内）',
      warnings: [],
      exempted: [],
      ...readings('no-files'),
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
        `本项目不用任务系统：${cov.totalFeatures} 条设计册里，**0 条**住在本项目的 .agent-io/design/ 下（root=${root}）` +
        `（判据：storage#isSameProject —— 册住在谁家，**不看**册里记的 source_root）⇒ 任务闸不适用（放行）`,
      warnings,
      exempted: [],
      ...readings('no-feature-for-root'),
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
  /**
   * ★ 2026-10-30（fencing）：本次调用带来的**租约代际**（`undefined` = 没带 ⇒ 不校验）。
   * ★ 只认数字：字符串/NaN 一律当"没带"（宁可放过也不要把格式错读成越权 —— 与 `resolveActor` 同一条纪律）。
   */
  const generation =
    typeof opts?.leaseGeneration === 'number' && Number.isFinite(opts.leaseGeneration) ? opts.leaseGeneration : undefined;

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

  // ════════════════════════════════════════════════════════════════════
  // ★★★ 第⑪项（2026-11-10 · 用户批准方案 b）：**插桩通道豁免** —— 观测基建的独立写路径。
  //
  // ## 为什么插桩不该走任务闸（类别错配，lead 裁定原文）
  // 任务闸的存在意义是「改动要对**设计**负责」（画布锚定 + 判据验收）；而 observe_instrument 的写入是
  // **机械注入 + 可整体还原**：字节来自插桩器（不是人写的语义改动）、`uninstrument` 一键回滚、
  // 台账（observe-ledger.json）全程记名。它**没有设计意图**——让"为它领卡"是类别错配：
  // 卡锚的是设计意图，插桩没有设计意图。实测代价：review-hub 试点插桩 5 文件被拒
  // （"没有挂到已领取的任务"），且三条改判据/加标记的路全被判为语义污染。
  //
  // ## 豁免判据（三条**同时**成立；护栏不是橡皮章）
  // ① **台账在场**（`loadProbeLedger(root)` 非 null）—— 首次插桩时台账还不存在，由插桩器**先写台账
  //    后写源码**的顺序保证（instrument.ts 的写序）；台账不在 = 不是插桩器写的 ⇒ 不豁免。
  // ② **快照已拍**（调用方 `openSourceWrite` 在闸**之后**拍快照——但本函数**先于** planGate 的
  //    各 throw，快照无法在本函数内验证）⇒ 以**可还原承诺**替代：`SourceWriteCtx.instrumentChannel`
  //    由 observe handler 传入，handler 侧的 restore 通道（`uninstrument`/`restoreSourceBytes`）
  //    是同一工具面的**常驻能力**——把"必须可还原"落成**调用方的义务**（handler 传入本标记即声明
  //    走还原通道；误用 = 调用方违约，账上 `basis:'instrument'` 可追责）。
  // ③ **仍记 actor + 写账**：豁免不是静默——走 `readings('instrument')`，账上可区分、可追责。
  //
  // ## 与 62 条 exempt 的区别（别混成第二份豁免机制）
  // `gate:'exempt'` 是**设计侧声明**（节点级，"这个节点不归闸管"）；本豁免是**通道级**（"这一类写入
  // 走独立纪律"），不进册、不进域表，作用面 = 携带本标记的那一次调用。
  // ════════════════════════════════════════════════════════════════════
  if (opts?.instrumentChannel === true) {
    const ledger = loadProbeLedger(root);
    if (!ledger) {
      throw new Error(
        `拒绝落盘（插桩通道豁免的前置不满足）：台账 \`.agent-io/observe-ledger.json\` 不存在 —— ` +
          `豁免只服务**插桩器自己的写入**（台账先写、源码后写的顺序是豁免的前提之一）。` +
          `台账不在 = 本次写入不是插桩器产物（或已全拔后重插的首批 ⇒ 那请让插桩器先落台账再写源码）。`,
      );
    }
    return {
      applicable: true,
      basis: 'instrument',
      note:
        `插桩通道放行（观测基建豁免）：本批 ${rels.length} 个文件由 observe_instrument 机械注入 ` +
        `（探针台账在场：${ledger.stats.total} 探针点 / ${ledger.stats.files} 文件）。\n` +
        `  ★ 豁免纪律（三条）：字节来自插桩器（非人工语义改动）；\`observe_instrument action=uninstrument\` ` +
        `可整体还原（写入已拍快照，回滚通道常驻）；本次写入已记 actor 与写账（basis=instrument 可追责）。\n` +
        `  ★ 与 \`gate:'exempt'\` 无关：那是**设计侧**的节点级豁免；这是**通道级**豁免，不进册。`,
      warnings,
      exempted,
      ...readings('instrument'),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // ★★ 第⑬项任务 1（2026-11-10 · 用户拍板"直通车"）：**direct 模式前置短路**——
  //    模型按改动性质自判（改函数体/文案/变量名 ⇒ direct；改类型签名/新文件/接口 ⇒ 走设计链），
  //    传入 `direct:true` 即**跳过计划闸/画布闸/领卡判定**（设计流程闸整体让位）。
  //  ★ 保留三件（直通不是裸奔）：写授权闸照走（authRaw 分支在下面，direct 短路**在它之后**不成立——
  //    本块放在授权分支**之前**会绕过授权闸 ⇒ 放在 instrument 豁免后、authorize 分支前，
  //    与授权闸的关系：direct 不带 authorize ⇒ 授权闸本来就不拦它（走 files-not-in-design 等）；
  //    带 authorize ⇒ 授权闸先判（互不冲突）。实际位置：**authorize 分支之后**——见下。
  //  ★ 契约反馈是事后兜底：handler 层的 contractFeedback 照跑，红 = 改动违反设计，模型必须面对、
  //    下次走设计链（教育性读数写进 note）。
  // ══════════════════════════════════════════════════════════════════
  if (opts?.direct === true) {
    // ★★ 开发遥测（第⑬项队列）：direct 放行也是故事线的一帧——发射后照常 return
    emitTelemetry(root, TELEMETRY_STAGES.gate, {
      text: `直通车放行：${rels.length} 个文件按模型自判走 direct（跳过设计流程闸，契约反馈事后兜底）`,
      data: { basis: 'direct', files: rels },
    });
    return {
      applicable: true,
      basis: 'direct',
      note:
        `直通车放行（direct 模式）：本批 ${rels.length} 个文件按模型自判走直通（跳过领卡/画布/任务闸——设计流程闸让位）。\n` +
        `  ★ 保留：语法门 / 写前快照（可回滚）/ 索引写穿 / 契约反馈（回执尾部自动出现）。\n` +
        `  ★ 契约反馈红 = 本次改动**违反设计**——必须面对，下次同类改动走设计链（挂卡）。\n` +
        `  ★ 滥用边界：改类型签名 / 新文件 / 接口 ⇒ **不许** direct（那是设计变更）——模型自判，判错由契约反馈抓。`,
      warnings,
      exempted,
      ...readings('direct'),
    };
  }

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
      // ★★★ 2026-11-04（G13 同族）：**授权也是一种凭证，必须记账**。
      //   这条支的成立条件是「scope 里有**你领的** claimed 卡」（A7 不放宽，见下）⇒ 卡**确实存在**；
      //   但改前「authorized 那一支的逐文件读数」不给任何 per-file 卡归属 ⇒ 账上 card_id 空 ⇒
      //   又一条「有卡写」被记成「无卡写」（实测存量 1 条）。
      //   ★ 记的是**anchor 卡**：它是「这笔写凭哪张卡授权」那一张；「卡的节点 ≠ 本文件节点」这个事实
      //     不丢 —— 账上 `gate_branch='authorized'` 就是把它说出来（covered 与 authorized 在账上可区分）。
      for (const rel of rels) recordCard(rel, { feature: verdict.feature, nodeId: verdict.anchor.nodeId });
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
          `后者会漏掉只有 \`path\` 的节点。` +
          // ★ 2026-10-30：授权档同样"A7 通过 ⇒ 刷心跳"（anchor 卡就是那张被你领着的卡）
          touchCoveredHeartbeats([{ feature: verdict.feature, nodeId: verdict.anchor.nodeId }]),
        warnings,
        exempted,
        ...readings('authorized'),
      };
    }
    authorizeMiss = `\n★ 本次带了 \`authorize='${authRaw}'\`，但**没能覆盖本批**（已落回逐文件判定）：\n${verdict.reason}`;
  }

  const unclaimed: Array<{ rel: string; cands: Array<{ feature: string; nodeId: string; state: string | undefined }> }> = [];
  /**
   * ★★★ 2026-10-30（fencing）：有 claimed 卡、owner 也是你，但**代际对不上** ⇒ 阻断。
   * 场景：你领了第 1 代 → 租约过期 → 别人接管（第 2 代）→ **你回来接着写**。
   * ★ 只比"带了的代际"：调用方**没带** generation（老 CLI / 老脚本）⇒ 不校验（向后兼容是硬约束）。
   */
  const staleGeneration: Array<{ rel: string; feature: string; nodeId: string; held: number; current: number }> = [];
  /** ★ A7 通过（卡是我的 ∧ 覆盖了我要写的文件）的那些卡 —— 最后顺手刷心跳（"我还在动手"） */
  const coveredCards: Array<{ feature: string; nodeId: string }> = [];
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
      // ★★★ 2026-11-04（F3）：「设计侧声明豁免」的**第二种写法** —— 册级 `excluded` 前缀声明。
      //   它原先被当成「不在设计里」（`files-not-in-design`）⇒ 改量具（`scripts/` 整目录就这么声明的）
      //   每次都变成一条「无卡写」⇒ 基线必然 +1（G17：加机制必然加噪音）。
      //   ★ 拦截行为**一点没变**（两种支都是放行），变的只是账上支名与回执点名（0.9.1 一处权威）。
      const declaredHits = cov.declaredExcluded.filter((x) => isExcludedPath([x], rel));
      if (declaredHits.length) {
        exempted.push({ path: rel, by: [], declared: declaredHits[0] });
        continue;
      }
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
      //   ★★★ 2026-11-04（G13 的修法，本卡就改这一行）：**仍然记卡**。
      //     claimed 卡是**事实**（上面已经查到它了），拿不到 actor 只意味着「这张卡是不是你的」**未核对**
      //     ⇒ 记卡 + 在回执里标未核对。改前这里直接 `continue`（不写 cardOf）⇒ 账上 card_id 恒空
      //     ⇒ 「有卡写」被记成「无卡写」（实测 14 条 + authorized 1 条 = 本门 31 条噪音里的 15 条）。
      recordCard(rel, claimed);
      actorWarnings.push(
        `${rel}：节点 ${claimed.nodeId} 上有 claimed 卡（owner=${owner || '（空）'}），但**拿不到"谁在写"**` +
          `（本次调用未传 \`actor\`，也没有 AGENT_IO_ACTOR）⇒ 按 G2 **提醒 + 放行**` +
          `（★ 凭证**已记账**：` +
          `card_id=${claimed.nodeId}，标 owner 未核对 —— 不知道该是谁不等于没有卡）` +
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
    // ★★★ 2026-10-30（fencing）：**代际校验** —— 在"卡是我的"之后比"这是第几代"。
    //   ★ 为什么必须在这里：A7 只回答"卡是不是你的"，而**接手那一刻 owner 会换手**；
    //     若同一 owner 名下的新旧两轮同时活着（同一 agent 两次租约），名字相同就再也分不开 ⇒ 只有代际能分。
    if (generation !== undefined) {
      const cardGen = leaseGenerationOf(claimed.task as unknown as TaskSpec);
      if (cardGen !== generation) {
        staleGeneration.push({ rel, feature: claimed.feature, nodeId: claimed.nodeId, held: generation, current: cardGen });
        continue;
      }
    }
    // ★ A7 通过（卡是我的 ∧ 覆盖了我要写的文件）⇒ 记一笔，最后顺手刷心跳
    coveredCards.push({ feature: claimed.feature, nodeId: claimed.nodeId });
    // ★ 2026-11-03（0.8 第三本账 ③）：**逐文件**记下这张卡 —— 下游（`write_log`）要的是 rel→card，
    //   而 `coveredCards` 是去重后的卡清单，它答不出"哪个文件是谁的卡"。
    //   ★ 2026-11-04（G13）：改经 `recordCard()` —— 单写点（同一张卡还要被另外两条路径记，见上）。
    recordCard(rel, claimed);
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
        `\n  ★ 依据读数：${cov.totalFeatures} 条设计册里 ${cov.rootFeatureCount} 条住在本项目 design/ 下、` +
        `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。`,
      warnings,
      exempted,
      // ★ unmapped（不在任何 covering feature 里）不是豁免 ⇒ 支名逐个纠正回它真正的那一支
      ...readings('exempt', unmapped.map((r) => [r, 'files-not-in-design'] as const)),
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
          // ★★★ 2026-11-04（F2）：**口径改成说真话** —— 原来的“其中 N 个文件节点收集失败”是一句假话：
          //   缺 path 的节点**无法按路径映射到具体文件** ⇒ “本批哪一条其实是「有节点、只是节点缺 path」”
          //   **判不了**（0.12：判不了 ≠ 没有）。支名 `unaddressable` 的真实含义 = **本批不可归因**：
          //   两个数（本批未入册的、全仓缺 path 的）各自独立，**不许相减**。
          `放行（归不了因）：本批 ${unmapped.length} 个文件**都不在任何"可寻址"的节点上**；` +
          `而全仓有 ${cov.unaddressable.length} 个 file/doc 节点**缺 path**（指不出它指哪个文件）。` +
          `⇒ ★ 这两个数**不能相减**：“本批里有没有哪一条其实是『有节点、只是节点缺 path』” **判不了**` +
          `（缺 path 的节点无路径可比）—— 0.12：判不了就报判不了，不挑一个支名冒充。` +
          `⇒ 支名记 unaddressable（= 本批不可归因），按闸原则「提醒」**点名 + 放行 + 留痕**` +
          `（缺字段不损坏数据，只是"这批写没在账上" = 记录问题，不是数据问题）。\n` +
          `★ 点名（全仓缺 path 的节点，前几条）：\n${warnings.join('\n')}\n` +
          `★ 要消掉这条：给那 ${cov.unaddressable.length} 个节点补 path（缺 path 的 file/doc 节点数必须为 0，` +
          `决策卡上有 run 判据钉着）—— 它们不为 0 时，一批“未入册就写”的文件会被这里当成“判不了”而**跳过**。\n` +
          `★ 依据读数：${cov.totalFeatures} 条设计册里 ${cov.rootFeatureCount} 条住在本项目 design/ 下、` +
          `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。`,
        warnings,
        exempted: [],
        ...readings('unaddressable'),
      };
    }
    return {
      applicable: true, // 本项目**有**任务系统，只是这批文件不在设计里 ⇒ 不是"不适用"，是"这次没有可挂的节点"
      basis: 'files-not-in-design',
      note:
        `本批 ${unmapped.length} 个文件都**不在任何 covering feature 里**（不是任何一个文件节点的 path/description、` +
        `也不在 semantic.files）⇒ 无任务可挂、放行。逐个点名：${unmapped.join(', ')}\n` +
        `  ★ 依据读数：${cov.totalFeatures} 条设计册里 ${cov.rootFeatureCount} 条住在本项目 design/ 下、` +
        `${covering.length} 条收集到了 path→node 表（共 ${covering.reduce((s, c) => s + c.byPath.size, 0)} 条路径）。\n` +
        `  ★ 若其中某条其实**已经在设计里**（只是节点缺 path/description）⇒ 那属于"收集失败"：` +
        `本函数**不抛**，而是**放行 + 把警告写进该 feature 的 annotations**（见 basis:'unaddressable' 那一支）。`,
      warnings,
      exempted: [],
      ...readings('files-not-in-design'),
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

  // ★★★ 2026-10-30（fencing）：**代际对不上** ⇒ 阻断（"僵尸回来写"的唯一拦法）。
  //   ★ 为什么必须是一条独立拒绝：A7 只比名字，而接管时 owner 会换手；同一个人两轮租约名字相同。
  if (staleGeneration.length) {
    throw new Error(
      `拒绝落盘（任务闸 · 租约代际）[E-WRITE-004]：这次要改的 ${staleGeneration.length} 个文件，` +
        `你手上的租约代际已经**失效** —— 这张卡已被接管。\n` +
        staleGeneration
          .map((x) => `  · ${x.rel} → 节点 ${x.nodeId}（feature=${x.feature}）：你拿的是第 ${x.held} 代，现在是第 ${x.current} 代`)
          .join('\n') +
        `\n★ 为什么拦：租约过期后**别人接管了这张卡**（` +
        '`claim` 会记 `taken_over_from` 并把 `lease_generation` +1）—— 你当时只是"暂时没回报"，\n' +
        `  但**写权已经不在你手上**；继续写就是拿旧判据覆盖新接管人的活。\n` +
        `★ 怎么办（二选一）：\n` +
        `  ① 重新 claim（拿到最新一代）再写：\n` +
        `     edit_dsl { type:'task', op:'claim', id:'${staleGeneration[0].nodeId}', data:{ owner:'<你>', supersedes:{ … } } }\n` +
        `  ② 这活已经不用你做了 ⇒ 停下，先看当前 owner 是谁（\`get_dsl query=todo\` 的行尾有"心跳 X 分钟前"）。\n` +
        `★ 向后兼容：写调用**不带** \`lease_generation\` 时这条校验**不生效**（老 CLI / 老脚本不受影响）—— ` +
        `所以看到这条红，说明你**带了**一个过期的代数。` +
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
          : '') +
        // ★ 2026-10-30：A7 通过 ⇒ 顺手刷心跳（"我还在动手"最自然的信号；跳过/失败都如实说）
        touchCoveredHeartbeats(coveredCards),
      warnings,
      exempted,
      // ★ 一批里可能混着两种放行：豁免的与不在设计里的，各按自己那一支记（不许一律记成 covered）
      ...readings('covered', [
        ...exempted.map((e) => [e.path, 'exempt'] as const),
        ...unmapped.map((r) => [r, 'files-not-in-design'] as const),
      ]),
    };
  }

  // ★★★ 2026-11-01（首跑墙 ① · 外部审计实测的那道墙）：首跑模式下 **E-TASK-001 只点名不拦** ——
  //   逐文件点名"哪个文件 ⇒ 哪个节点没有 claimed 卡"，然后放行。
  //   ★ 放行依据单列一个 basis（`first-run-unclaimed`），**不许**混进 `covered`：
  //     两者读起来一样，而"有卡放行"与"没卡也放了"是两件完全不同的事（读端会据此误判受保护状态）。
  if (firstRunMode()) {
    const named = unclaimed
      .map(
        (u) =>
          `  · ${u.rel}  ⇒ ${u.cands
            .map((c) => `${c.nodeId}（feature=${c.feature}，task.state=${JSON.stringify(c.state ?? null)}）`)
            .join(' / ')} **没有 claimed 的任务卡**（首跑模式：只点名）`,
      )
      .join('\n');
    return {
      applicable: true,
      basis: 'first-run-unclaimed',
      note:
        `首跑模式（AGENT_IO_FIRST_RUN=1）· 任务闸只点名不拦：这次要改的 ${unclaimed.length} 个文件**没有挂到已领取的任务上**。\n` +
        `${named}\n` +
        `★ 本仓纪律没有变：不领卡就改 = 没人对这笔改动负责（租约 / 代际 / 读集冲突 / A7 全失去锚点）—— 首跑只是**这一次**的例外。\n` +
        `★ 要恢复拦截：unset AGENT_IO_FIRST_RUN（不设 = 拦）。`,
      warnings: [...warnings, FIRST_RUN_BANNER],
      exempted,
      ...readings('first-run-unclaimed'),
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
      `\n★ 怎么领（唯一写端 = \`edit_dsl\`；**五步**，顺序不可换）：\n` +
      `  ① 立卡 \`publish\`（把该节点的**决策卡**翻成任务卡，★ 不接受手写 summary）：\n` +
      `  { feature: '${first.cands[0].feature}', agent: '<你的身份>', reason: '从决策卡立卡 ${first.cands[0].nodeId}',\n` +
      `    operations: [{ type:'task', op:'publish', id:'${first.cands[0].nodeId}' }] }\n` +
      `  · 该节点**没有 decision / 没有后态判据** ⇒ 这一步立的是 **L1 建构卡（0 条期望）**，**不是拒绝**；` +
      `有可判的后态判据 ⇒ **L2 实现卡**。两条都不收手写 summary。\n` +
      `  ② 领卡 \`claim\`（这笔改动的**唯一责任人登记**）：\n` +
      `  { …同 feature / agent… operations: [{ type:'task', op:'claim', id:'${first.cands[0].nodeId}', data:{ owner: '<你的身份>' } }] }\n` +
      `  · 判据不够（后态判据少于门槛）⇒ **原子拒领**：state 仍 candidate，owner / 租约 / 快照**一个字节都不写**；` +
      `回执点名「要补 N 条 + 哪几类 + 可粘模板」⇒ **先补齐，再 claim 一次**（T-28 后没有"领了不能干"的中间态）。\n` +
      `  ③ 补判据（判据只住 \`decision\`，不在卡上）：\n` +
      `  { …同 feature / agent… operations: [{ type:'decision', op:'update', id:'${first.cands[0].nodeId}',\n` +
      `      data:{ summary: '<一句话：这个文件负责什么>', expectations: [{ kind:'run', expect:'<可求值表达式>', why:'<带实体>' }] } }] }\n` +
      `  · 节点**还没有 decision** ⇒ 必须用 \`op:'update'\` 一次给 summary + expectations（\`expectation.add\` 不带 summary，首版会被拒：决策卡缺 summary）。\n` +
      `  · 必须是**语义类**（run / behavior-cases / call-exists / edge-absent / domain-independent）：` +
      `存在类（source-has / symbol-exists / file-exists / signature-matches）当不了画布的 \`judgement_ref\`，会被计划闸挡。\n` +
      `  ④ 再 claim 一次（补够门槛后**第二次领卡** —— 这一次才进 claimed、才有写权）：\n` +
      `  { …同 feature / agent… operations: [{ type:'task', op:'claim', id:'${first.cands[0].nodeId}', data:{ owner: '<你的身份>' } }] }\n` +
      `  · ★ 补的判据**已经全绿**（= 这个文件当下没有活，你只是要取写权）⇒ 加 \`data.intent:'modify'\`，否则会被「可领性」拒。\n` +
      `  ⑤ 落盘 \`edit_code\`（★ 另需画布 \`design_line action=plan\`，见 docs/DEVELOPMENT.md 与 docs/GUIDE-GATE.md）：\n` +
      `  { project_dir: '<根>', actor: '<你的身份>', file: '<rel>', op: 'replace_text', old_text: '…', new_text: '…' }\n` +
      `  · ★ 卡在哪一步就从哪一步接：上面 task.state=null ⇒ ①；=candidate 且回执说「未领取」⇒ ③；=claimed 且 owner 是你 ⇒ ⑤。\n` +
      `  · ★ **不要绕开 \`edit_code\` 用文件工具落盘**：那样这笔改动没有责任人、没有回滚点、没有判据（本闸读的就是卡）。\n` +
      `★ **为什么不能跳过**：不领卡就改 = **没人对这笔改动负责** —— 租约（谁占着）· 代际（第几轮）· ` +
      `读集冲突（会不会撞别人的活）· A7「谁在写」四件事全部失去锚点，而它们只认 \`state=claimed\` 的卡。\n` +
      `  · 卡住在 \`todos[]\`（带 \`node_id\` 指向该节点）；\`geometry.nodes[].task\` 只是派生投影（读端不认它）。\n` +
      `  · 任务态**四态**：candidate / claimed / done / void（★ 那个"领了不能干"的中间态已由 T-28 砍掉 —— 它只剩"存量卡可读"；superseded 已退场；void 可用 relaunch 重新立卡）；\n` +
      `    ★ \`node.status\`（draft / in_progress / done）对它是**派生值**（progressOf），**不许直接改**。\n` +
      `  · claim 写前必过「可领」读数（cardStanding ∈ work/violated）；complete 必过「可收口」读数（isSatisfied）且另需 \`data.evidence\`（与 status 同一把证据尺）。\n` +
      `  · 覆盖这条改动的 feature 有多条时，在**任一条**里 claim 即可（本闸不替你挑）。\n` +
      AUTHORIZE_ESCAPE_HATCH +
      `\n★ 本闸**不会替你 claim**，也**不会把这次写入降级放行** —— 拒绝就是拒绝；领到后再改即可。\n` +
      `★ 拦的范围（只此一条）：项目根上有设计册覆盖该文件（` +
      `册住在本项目 .agent-io/design/ 下 · storage#isSameProject ∧ 该文件是它的文件节点）` +
      `∧ 覆盖它的 feature 里**没有一条**在该节点上有一张 ` +
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
