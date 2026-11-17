/**
 * source_writer —— **改用户源码的唯一原语**（写闸 / 快照 / 自写登记的**唯一**组合点）
 *
 * ## 它解决的是什么（实测病灶，不是推测）
 * 写闸（`write_gate#assertSourceWriteRegistered`）早就写好了，但**它和执行落盘的那一行不住在一起**：
 *   · `write_gate#writeSourceFiles` 收的是 `mutate: () => T` 回调 —— 它**自己不写**，落盘永远在调用方；
 *   · `edit_code` 干脆不走它，内联"闸 → 快照 → `fs.writeFileSync` → `syncFile`"四件套，**抄了 6 份**；
 *   · 于是全仓对用户源码的覆盖写有 25 处是**裸 `fs.writeFileSync`**，闸的判据与落盘点之间隔着几十行。
 * ⇒ 同一件事（"判闸了没有"）被 8 条写路各自记一遍，漏一处就是一个静默撒谎点。
 *
 * ## 判据（本模块的边界，机械可查）
 * `src/` 内对**用户源码路径**的 `fs.writeFileSync` 只许存在**本文件两处**：
 *   ① `commit`（覆盖写：判闸 → 快照 → 写 → 登记）；
 *   ② `restoreSourceBytes`（**回滚**：把删之前读到的字节放回去 —— 判据见该函数头注）。
 * 写 `.agent-io/` / `design-db/` / `dist/` 的**产物写不在此限**（那是另一条通道，本模块不管）。
 *
 * ## 三步顺序（顺序本身就是判据，别调换）
 *   ① `assertSourceWriteRegistered` —— **判**（拒绝就抛，一个字节都不落盘）
 *   ② `snapshotBeforeWrite`         —— **存**（可撤回；失败不阻断：增强不是前提）
 *   ③ `fs.writeFileSync`            —— **写**
 *   ④ `recordSelfWrite` + `syncSelfWritesSync` —— **登记/写穿**（读己之写可信）
 * ①② 在 `openSourceWrite` 里**整批一次**做完，③ 在 `commit` 里逐文件做，④ 在 `close` 里整批一次。
 *
 * ## 为什么是"事务"而不是"一个函数写完"
 * 有些写路的**内容在写之前算不出来**（`rename_symbols`：第 2 条改名要看第 1 条落盘后的盘面）。
 * 若只给 `writeSourceFile`，它们就只能"逐文件判闸" —— 那会把 `authorize` 的
 * **整批原子**退化成"能过的先落"（制造半写），也会让 `T214` 的"一份快照 = 一个撤回点"碎成 N 份。
 * ⇒ 给**同一道闸**开一个事务：`openSourceWrite` 整批判一次 + 拍一份快照，`commit` 只许落**判过的那些路径**。
 *
 * ## ★ 这不是"lower-level 逃生口"（判据写在代码里，不是写在注释里）
 * `commit` 会**校验路径是否在 open 时声明过**，没声明就抛 —— 拿不到"绕开闸的那个入口"。
 * 三个导出是同一件事的三种用法：`writeSourceFile` = open + commit + close；
 * `writeSourceBatch` = open + commit×N + close。**没有**"不判闸就能写"的出口。
 *
 * ## ★★★ P0-A2（十维审计 §① A2 · T2 逐条实测）：**pre-hash 冲突检测** —— 把"静默丢更新"变响亮
 * ### 它挡的事故（实测读数，不是推测）
 * 两席**同时** `openSourceWrite` 同一个文件 ⇒ **双双成功**（写闸判的是"这张卡覆盖了这些文件"，
 * 与"盘上内容在你 open 之后变没变"是**两件不同的事**）⇒ B 先落盘、A 后落盘，
 * **A 基于 v0 算出来的内容把 B 的 v1 整段覆盖**（静默 lost update）；随后 A 的 `rollback()` 拿
 * 写前快照把 B 的写**一起抹回 v0**。全程 `write_log` 两条、零冲突读数 ——
 * 事故的形状不是"抛错"，是"**什么都没发生**"。
 * ### 判据（一句话，机械可查）
 * `open` 时记下每个声明文件的**内容 sha**；每个写动词**落盘前**重算并比对：
 * 盘上 sha ≠ 打开时 sha ⇒ **一个字节都不写**，抛 `WriteConflictError`（`code='E-WRITE-CONFLICT'`），
 * 报文点名"打开后被**谁**改过"（来自 `write_log` 最近一条）+ 两个 sha + 修法（重读再改）。
 * `rollback()` 同一条判据的反面：**本批写过的文件在 open 之后又被别人改过 ⇒ 拒绝回滚**
 * （用写前快照回滚会把别人的写入一起抹掉），改报 `ok:false` + 点名 + 已落盘清单。
 * ### 为什么住这里（而不是画布闸 `base.content_hash`）
 * 画布 CAS 是**条件 CAS**：只覆盖"有画布"的文件（审计实测 189/436），且 `direct` / 首跑 /
 * `AGENT_IO_REQUIRE_PLAN=0` / **根本没有画布** 这四条让位路径上它都缺席 —— T2 正是在这里静默的。
 * 本闸住在**唯一写原语**里 ⇒ 四条路自动覆盖，且**不是第二份判据**：它判"盘上内容是不是我读到的那一版"，
 * 与"我有没有权改"（任务闸 / 画布闸）不是同一件事（判据分叉的判据是"同一件事实两处判定"，不是"两件事两个闸"）。
 * ### 为什么**没有** `force` 逃生口（审计原建议 `force:true`，这里**不采纳**）
 * 唯一正解是"重读 → 基于新内容重算 → 重新 open"；`force` 会把"省一次重读"的价值建立在
 * "下一次静默丢更新"的代价上。本仓判据：**能落盘的那一版，必须是基于盘上现存内容算出来的**
 * （要留档的是"我基于哪一版写的"，那是快照 + 写账已经在做的事）。
 * ### 已知限度（如实写）
 * · 它把"静默覆盖"变**响亮**，**不提供合并**：语义冲突仍要人/模型判断（CRDT 那一路对代码不适用）；
 * · 比对到 `fs.write` 之间仍有微秒级窗口 —— 真互斥要 worktree / 每仓一锁（审计 A5，动 §十一）；
 * · `append` 也判（追加同样会踩别人刚写的那一版的行区间）；`copy` / `move` 的**两端**都判；
 * · 比对基线在**本批自己写完**之后刷新（否则同一事务连写两次会变成假冲突 —— 这一条有反例用例）。
 *
 * ## 已知限度（如实写）
 * · **只管 TS 侧**：`bash` / 编辑器 / 另一个 agent 直写磁盘，本原语看不见（那是 `watch_project` L2 的事）。
 * · **只覆盖"覆盖写"**：移动 / 删除 / 追加（本仓 `fs.renameSync|copyFileSync|unlinkSync|rmSync` 50 处、
 *   `appendFileSync` 7 处）**尚未收口** —— 判据只对覆盖写成立，别拿它当"源码写全收口"。
 * · **同步签名**：索引走 `syncSelfWritesSync`（解析器已预热则当场写穿 L1a，未预热整批落回 L1b 登记）。
 *   需要逐文件 `SyncStatus` 的调用方（`edit_code` 的符号 diff）仍自己再 `syncFile` 一次 ——
 *   那是**索引增强**，不是第二条写路。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  assertSourceWriteRegistered,
  resolveActor,
  recordSelfWrite,
  syncSelfWritesSync,
  type GateExemption,
  type WriteActor,
  type WriteThroughOutcome,
} from './write_gate.js';
// ★ 2026-11-01（第二轮外审 P0-1）：`rollbackFileSnapshot` 是**唯一回滚实现**（`rename_files` 走的就是它）
//   —— 事务的 `rollback()` 只调它，不新写第二份。
import { snapshotBeforeWrite, rollbackFileSnapshot, type FileSnapshotMeta, type RollbackResult } from './refactor/snapshot/file_snapshot.js';
import { refreshAfterOwnWrite, ownWriteRefreshLines, type AssumptionCheck, type AssumptionTarget } from './read_set.js';
// ★ 内容指纹**只有一把尺**（`contentHash` = `files.content_hash` 存的那个 sha1）：
//   pre-hash 冲突检测要跟索引、读集说同一句话 —— 别在这里再写一份哈希（判据分叉）。
import { contentHash, toIndexKey, type SyncStatus } from '../infrastructure/index/symbols.js';
// ★★★ 2026-11-03（docs/todo.md §一 0.8「无卡变更」第三本账 · 步骤④）：**写账**。
//   ★ 为什么账要在这里记：本文件是**改用户源码的唯一原语** —— 5 个写动词的落盘点全在它手上，
//     而 `watch` 不知道"谁改的"（`WatchBatchSummary` 里没有 actor）⇒ 绕开这里就再也追不到责任人。
//   ★★ P0-A2 起它还多一个消费者：冲突报文里的"**打开后被谁改过**"就是这张账的最近一条
//     （`readWriteLog`）—— 所以"写账失败"从此不只是审计欠账，还会让冲突点名降级为"账上查不到"。
import { recordWriteLog, readWriteLog, writeLogRowOf, type WriteLogKind } from '../infrastructure/write_log.js';
// ★ 回滚通道也要入账，而它只拿得到绝对路径 ⇒ 项目根问**唯一那把尺**（不在这里自己往上找目录）
import { resolveProjectRoot } from '../infrastructure/analysis/project_root/index.js';
import { emitTelemetry, TELEMETRY_STAGES } from './telemetry.js';

/**
 * 一次写入的**上下文**（身份 + 授权 + 标签）。
 * ★ `actor` / `authorize` 只是**交上去** —— 解释它们的是闸（`evaluateTaskGate`），本层不判第二遍。
 */
export interface SourceWriteCtx {
  /** 人读标签（进快照 `reason` 与自写登记 `note`）：写清"哪个工具、改了什么" */
  label: string;
  actor?: WriteActor | null;
  authorize?: string | null;
  /**
   * 逐文件【索引】读数（SyncStatus）—— 只是读数，不改判据、不改写盘顺序。
   * ★ 给「回执里要逐文件 updated」的调用方用（apply_writes 的 index_synced）。
   */
  onFile?: (rel: string, status: SyncStatus) => void;
  /**
   * 本次要写的**符号**（`{file, symbol}`）—— 交给闸做**符号级**假设检定；不给 ⇒ 文件级。
   * ★ 只有「动符号本体」的写路才该给（`replace` / `delete`）；文本级写给了就是假装更精确。
   */
  symbols?: readonly AssumptionTarget[];
  /**
   * ★★★ 2026-10-30（租约 fencing）：调用方**持有哪一代**的写权（`claim` 回执里的 `lease_generation`）。
   * ★ **不传 ⇒ 写闸不校验**（老 CLI / 老脚本照常跑 —— 向后兼容是硬约束）；传了且与卡上不等
   *   ⇒ 拒（`E-WRITE-004`：这张卡已被接管，你的写权已失效）。
   */
  leaseGeneration?: number;
  /**
   * ★★ 第⑪项（2026-11-10 · 用户批准方案 b）：**插桩通道标记** —— 只有 `observe_instrument` 该传。
   * 传了 ⇒ 写闸走"观测基建豁免"支（判据：探针台账在场 + 可整体还原 + 记 actor/写账；
   * 详见 `write_gate.ts` 的 instrument 豁免块——那是**唯一判据**，本层只透传）。
   * ★ **别处不许传**：这是"不改设计改源码"的唯一合法通道，滥用 = 关闸（账上 basis=instrument 可追责）。
   */
  instrumentChannel?: boolean;
  /**
   * ★★ 第⑬项任务 1（2026-11-10 · 用户拍板"直通车"）：**direct 模式标记** —— 模型按改动性质自判。
   * 传了 ⇒ 写闸跳过设计流程闸（领卡/画布/任务闸），保留语法门/快照/写穿/契约反馈。
   * ★ 教育性读数：契约反馈红 = 违反设计，下次走设计链（判据在 write_gate 的 direct 支，本层只透传）。
   * ★ 别处不许传：滥用 = 关闸（basis=direct 可追责）。
   */
  direct?: boolean;
}

/**
 * 单个文件的**写入回执** —— 闸说了什么、豁免了谁、快照是哪一份、索引写穿成什么样。
 *
 * ★★★ `task_gate` **必填**（不是 `task_gate?`）：本仓 4 处历史 bug 的病因就是
 * "闸判了、返回值被丢、回执里一个字没有"。可选字段 = 允许不说 ⇒ 必填才能让 `tsc` 挡住漏接。
 */
export interface SourceWriteReceipt {
  /** 项目相对路径（posix 分隔；与闸的 `toIndexKey` 同一把尺） */
  path: string;
  /** 闸的原话（放行依据 / 豁免点名 / 警告）——**逐字**带出，不在这里重新拼 */
  task_gate: string;
  /** 本次靠设计侧声明豁过去的文件（空数组 = 本次没有任何豁免，不是"没算"） */
  exemptions: GateExemption[];
  /** 闸留下的警告（收集失败等）；空数组 = 没有 */
  warnings: string[];
  /** 读集检定（「我/别人读的符号现在还是不是这一版」）—— 与 `task_gate` 两件事，别混 */
  assumption_check?: AssumptionCheck;
  /** 整批写前快照（一次改动 = 一份快照 = 一个撤回点；`null` = 没拍成，增强不许阻断写入） */
  snapshot?: FileSnapshotMeta;
  /** 索引写穿结果（`undefined` = 本批没落盘任何文件） */
  index?: WriteThroughOutcome;
}

/**
 * ★★★ 2026-10-22（写闸覆盖面 · ④）：**四种改源码的动作**，同一道闸。
 *
 * ## 为什么必须一起收（判据，不是凑数）
 * 改前本原语只有 `commit`（= **覆盖写**）。而「源码会消失」这件事，覆盖写只是其中一种：
 * 移动（`copyFileSync` + `unlinkSync`）**换个名字源码就在旧路径没了**；删除（`rmSync`）**直接没了**；
 * 追加（`appendFileSync`）**绕开整份快照**。
 * ⇒ 判据从「有没有 `writeFileSync`」扩成「**有没有动过用户源码的字节**」，四种动词一起过闸。
 *
 * ## 为什么闸不用改
 * `assertSourceWriteRegistered` 判的是**路径**（这批文件挂在谁的已领取任务上），与动作无关 ⇒
 * 四类共用同一次判定。**新增的不是闸，是动词**（改前只有 write 一个动词可走）。
 */
export type SourceMutationKind = 'write' | 'move' | 'delete' | 'append';

/**
 * 一次**已开闸**的批量写。`commit` / `copy` / `move` / `remove` / `append` 只接受 `paths` 里声明过的文件
 * —— 这是「没有逃生口」的实现：**没在 open 时判过闸的路径，任何动词都写不了**。
 */
export interface SourceWriteTxn {
  /** 本批已在 `openSourceWrite` 里判过闸的路径（项目相对 posix） */
  readonly paths: readonly string[];
  /** 闸的原话（整批一份） */
  readonly task_gate: string;
  readonly exemptions: GateExemption[];
  readonly warnings: string[];
  readonly assumption_check?: AssumptionCheck;
  /** 整批写前快照 */
  readonly snapshot?: FileSnapshotMeta;
  /** 落一个文件（路径必须在 `paths` 里；不在就抛） */
  commit(file: string, content: string): SourceWriteReceipt;
  /** 追加（★ 不走整份快照的"覆盖"语义 ⇒ 之前它完全在闸外） */
  append(file: string, content: string): SourceWriteReceipt;
  /** 复制/新建目标（两端的路径都必须声明过；`from` 只读） */
  copy(from: string, to: string): SourceWriteReceipt;
  /** 移动 = copy + remove（两端的路径都必须声明过） */
  move(from: string, to: string): SourceWriteReceipt;
  /** 删除（源码会**消失** —— 这是本卡最贵的一种静默） */
  remove(file: string): SourceWriteReceipt;
  /**
   * ★★★ 2026-11-01（第二轮外审 P0-1）：**整批撤回本批已落盘的字节** —— 用 `openSourceWrite` 拍下的
   * 那一份写前快照调 `rollbackFileSnapshot`（★ **不新写回滚实现**：`rename_files` 走的就是这一条），
   * 并把**还原成功**的文件从"本批写过"里剔掉。
   *
   * ## 为什么"剔掉"这一步是判据，不是顺手
   * `close()` 的登记口径是"`written` 里的文件" ⇒ 剔掉之后语义自动正确：
   *   · **完整回滚** ⇒ `written` 空 ⇒ `close()` **一条自写都不登记**（登记了就是"索引说变了、实际没变"的假读数）；
   *   · **回滚不全** ⇒ 没还原成的仍在 `written` 里 ⇒ 只登记**实际留在盘上**的那些。
   * ⇒ 调用方不需要另传"只登记哪些"的开关（那会变成同一事实的第二处权威）。
   *
   * ★ 没有快照时**不猜**：返回 `ok:false` + `failed` = 已落盘清单（`close()` 照旧登记它们 —— 盘上确实变了）。
   *
   * ★★★ P0-A2 / A3（**回滚不许覆盖别人的写**）：本批声明过的文件里，只要有一个在 `open` 之后
   * **被别人改过**（盘上 sha ≠ 我们知道的那一版）⇒ **拒绝回滚**，返回 `ok:false` +
   * `message`（`E-WRITE-CONFLICT` + 逐文件点名"谁改的"）+ `failed` = 已落盘清单，
   * `restored` / `removed` 一律空。改前这里是**无条件整批还原**：A 的回滚把 B 的写一起抹回 v0
   * （审计 T2 的第二半）。修法同落盘冲突：**重读再改**，不要整份回滚。
   */
  rollback(): RollbackResult;
  /** 收尾：自写登记 + 索引写穿 + 写者基线刷新。没落过盘 ⇒ `null` */
  close(): WriteThroughOutcome | null;
}

/** 把批内路径归一成项目相对 posix；根外路径返回 `null`（闸那边同样会判 `no-files`） */
function relOf(root: string, file: string): string | null {
  return toIndexKey(root, file);
}

/**
 * ★★★ P0-A2：**写冲突**（`code = 'E-WRITE-CONFLICT'`）—— 独立成类，因为调用方需要**分型**：
 * 「盘上被别人改了」要重读再算（可以重试），而「路径没在 `files` 里声明」「根外路径」是**用法错**（不许重试）。
 * 改前这两件事在回执里同形（都只是一句 `Error.message`）⇒ 上层只能按字符串猜。
 */
export class WriteConflictError extends Error {
  /** 可编程识别（报文里也带着这个词：人读的两条路同一口径） */
  readonly code = 'E-WRITE-CONFLICT';
  /** 项目相对 posix 路径 */
  readonly file: string;
  /** `openSourceWrite` 那一刻盘上的内容 sha（`''` = 那一刻文件不存在） */
  readonly opened_sha: string;
  /** 落盘前那一刻盘上的内容 sha（`''` = 现在文件不存在） */
  readonly disk_sha: string;
  /** 写账里"最近一条不是本批的写"的人读串（点名"打开后被谁改过"） */
  readonly culprit: string;

  constructor(args: {
    message: string;
    file: string;
    opened_sha: string;
    disk_sha: string;
    culprit: string;
  }) {
    super(args.message);
    this.name = 'WriteConflictError';
    this.file = args.file;
    this.opened_sha = args.opened_sha;
    this.disk_sha = args.disk_sha;
    this.culprit = args.culprit;
  }
}

/**
 * 文件**不存在**的 pre-hash 哨兵：`''`（与 `read_set#FileFacts.file_fp` 同一口径 ——
 * "此刻还不存在"必须能与"存在但是空文件"（`contentHash('')`）区分开）。
 */
const ABSENT_SHA = '';

/** 盘上此刻的内容 sha，或**读不到的原因**（`0.12`：判不了必须说出来，不许回落成一个"相等"） */
type DiskSha = { sha: string } | { unreadable: string };

/**
 * 读一个文件此刻的内容 sha（`''` = 不存在）。**唯一实现** —— open 时记、落盘前比、回滚前比，三处同一把尺。
 * ★ 读不到（EACCES 等）**不造假**：返回 `unreadable`，由调用方决定"说出来"还是"拒写"。
 * ★ 用 utf8 解码后哈希（`contentHash` ⇒ 与索引 `files.content_hash` **同一把尺**，报文里的 sha
 *   可以直接跟索引/读集的读数对照）。★ 边界：本原语只覆盖**源码**（文本）—— 二进制路径上的
 *   字节漂移理论上可能被解码成同一串（极端、且不在本模块的判据面上），如实记在这里。
 */
function readDiskSha(root: string, rel: string): DiskSha {
  try {
    return { sha: contentHash(fs.readFileSync(path.join(root, rel), 'utf8')) };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { sha: ABSENT_SHA };
    return { unreadable: `${String(code ?? 'unknown')}：${(e as Error).message}` };
  }
}

/** 报文字段里的人读 sha（前 12 位足够定位；`''` 要说成人话） */
function showSha(sha: string): string {
  return sha === ABSENT_SHA ? '（文件此刻不存在）' : `${sha.slice(0, 12)}…（全 ${sha.length} 位）`;
}

/**
 * ★ **开闸**：整批一次判 + 整批一份快照。没有落盘动作（落盘只在 `commit` 里）。
 *
 * 拒绝时**抛**（`assertSourceWriteRegistered` 自己抛）⇒ 本函数返回前一个字节都没写。
 */
export function openSourceWrite(rootArg: string, files: readonly string[], ctx: SourceWriteCtx): SourceWriteTxn {
  const root = path.resolve(rootArg);
  const declared: string[] = [];
  for (const f of files) {
    const rel = relOf(root, f);
    if (rel && !declared.includes(rel)) declared.push(rel);
  }
  // ★ 判据只住 `write_gate`：这里**只接住回执**，不重算一遍（第二份判据 = 本仓头号病）。
  const gate = assertSourceWriteRegistered(root, declared, {
    actor: resolveActor(ctx.actor),
    authorize: ctx.authorize,
    symbols: ctx.symbols,
    // ★ 2026-10-30：代际只**透传**（判据住 `write_gate#evaluateTaskGate`，本层不判第二次）
    leaseGeneration: ctx.leaseGeneration,
    // ★ 第⑪项：插桩通道标记透传（判据在闸的豁免块，本层不判第二次）
    instrumentChannel: ctx.instrumentChannel === true ? true : undefined,
    direct: ctx.direct === true ? true : undefined,
  });
  const snapshot = declared.length ? snapshotBeforeWrite(root, ctx.label, declared) : null;
  // ★★★ P0-A2：**pre-hash**（打开时盘上那一版）。顺序：判闸 → 快照 → 记 pre-hash。
  //   放在快照**之后**是有意的：这一版 sha 描述的正是"快照所代表的那一版"
  //   ⇒ 落盘前的比对与回滚用的快照**同一口径**（否则两处各说一版，冲突判定与回滚判定会互相打架）。
  const openedAt = new Date().toISOString();
  const knownSha = new Map<string, DiskSha>();
  for (const rel of declared) knownSha.set(rel, readDiskSha(root, rel));
  /** 本批自己的写账时刻（`rel|at`）—— 点名"谁改的"时必须**先把自己的账排掉**（否则会点名自己） */
  const ownLogAt = new Set<string>();
  const allowed = new Set(declared);
  const written: string[] = [];
  /**
   * ★★★ 2026-11-03（`docs/todo.md` §一 0.8「无卡变更」第三本账 · 步骤④）：**逐文件**记一条写账。
   *
   * 不变量（三条，都能变红）：
   *   ① 在 fs 调用**成功之后**记 —— 先记后写 = 账上说改了、盘上没改；
   *   ② **逐文件一条**（`move` 记 from + to 两条）：整批一条会把 N 个文件抹成一个 card_id，
   *      那样"哪个文件无卡"就再也查不出来；
   *   ③ 记账失败**不许吞也不许阻断**：推进 `gate.warnings`（随回执出去），写盘照常完成 ——
   *      审计是旁路，但"没记上"必须看得见（AGENTS-RULES 0.12）。
   * ★ card_id 取自闸的逐文件读数 `card_of`；取不到卡时 `source='unmapped'`（判据住 `write_log#writeLogRowOf`）——
   *   这样"无卡写"与"有卡写"在账上可区分，正是本账要抓的东西。
   */
  const logWrite = (rel: string, kind: WriteLogKind): void => {
    // ★ P0-A2：`at` 由这里显式给出并记进 `ownLogAt` —— 冲突报文的"谁改的"要能**排除本批自己**
    //   （否则 A 在本批里先落过盘、第二个文件冲突时，报文会点名 A 自己，等于没点名）。
    const at = new Date().toISOString();
    const r = recordWriteLog(root, [
      writeLogRowOf(rel, kind, {
        actor: resolveActor(ctx.actor),
        at,
        card_of: gate.card_of,
        branch_of: gate.branch_of,
      }),
    ]);
    ownLogAt.add(`${rel}|${at}`);
    if (r.error) {
      const line = `⚠️ 写账未记（write_log · ${rel} · ${kind}）：${r.error}`;
      if (!gate.warnings.includes(line)) gate.warnings.push(line);
    }
  };

  /**
   * ★★★ P0-A2：**"打开后被谁改过"** —— 只从 `write_log` 读，不猜。
   *
   * 读数口径（三条）：
   *   ① 只认**本文件**的行（`readWriteLog(file)`）且**排除本批自己的写**（`ownLogAt`）；
   *   ② 优先"在你 open 之后"的行（`at >= openedAt`，ISO-8601 UTC 可直接比串）；
   *   ③ 账上**什么都没有**也必须说出来 —— 那说明改它的不是本原语（`bash` / 编辑器 / 另一个进程直写），
   *      这是本模块已声明的边界（见文件头「已知限度」），**不许**静默成"没人改过"。
   */
  const culpritOf = (rel: string): string => {
    const r = readWriteLog(root, { file: rel, limit: 20 });
    if (r.skip) return `账上查不到 —— ${r.skip}`;
    const notMine = r.rows.filter((row) => !ownLogAt.has(`${row.file}|${row.at}`));
    const fresh = notMine.filter((row) => row.at >= openedAt);
    const pick = fresh[0] ?? notMine[0];
    if (!pick) {
      return '账上一条都没有（本原语此前没写过这个文件 ⇒ 很可能是 bash / 编辑器 / 别的进程**直写**，本原语看不见）';
    }
    const when = fresh.length ? '在你 open 之后' : '（早于你 open 的时刻 ⇒ 可能正好同刻并行）';
    const card = pick.card_id ? `卡 ${pick.card_id}` : '无卡';
    const basis = pick.gate_branch ? ` · 支=${pick.gate_branch}` : '';
    return `${pick.actor ?? '（未署名 actor）'} ${when}写过：${pick.at} · kind=${pick.kind} · ${card}${basis}`;
  };

  /**
   * ★★★ P0-A2：**落盘前的 pre-hash 比对**（5 个动词 + `copy`/`move` 的两端全走 `assertDeclared` ⇒ 全走它）。
   *
   * 判据只有一条：`盘上此刻的 sha === 打开时（或本批上一次写完时）的 sha`。
   * 不等 ⇒ 抛 `WriteConflictError`，**一个字节都不写**（改前这里是静默覆盖：T2 实测）。
   *
   * ★ 为什么基线要在本批写完后就刷新：同一事务里"写 A → 基于刚写的 A 再写 A"是**正常用法**
   *   （`rename_symbols` 的第 2 条改名要看第 1 条落盘后的盘面）。基线不刷新 = 造出**假冲突**。
   */
  const assertNoDrift = (rel: string, verb: string): void => {
    const was = knownSha.get(rel);
    if (!was) return; // 没在 open 时声明过（`assertDeclared` 已先抛，这条只是防御）
    if ('unreadable' in was) {
      // 打开时就读不到 ⇒ 本闸对**这个文件**没生效。不假装判过：推进回执 warnings（0.12）。
      const line = `⚠️ pre-hash 冲突检测未生效（${rel} 打开时读不到：${was.unreadable}）—— 本文件落盘前没有比对`;
      if (!gate.warnings.includes(line)) gate.warnings.push(line);
      return;
    }
    const now = readDiskSha(root, rel);
    if ('sha' in now && now.sha === was.sha) return;
    const nowSha = 'sha' in now ? now.sha : '';
    const nowLine = 'sha' in now ? showSha(now.sha) : `读不到（${now.unreadable}）—— 判不了你写的是不是这一版`;
    const culprit = culpritOf(rel);
    throw new WriteConflictError({
      file: rel,
      opened_sha: was.sha,
      disk_sha: nowSha,
      culprit,
      message:
        `拒绝落盘（写冲突 [E-WRITE-CONFLICT] · ${verb}）：\`${rel}\` **在你 open 之后被改过** —— 一个字节都没写。\n` +
        `  ★ 打开时（${openedAt}）盘上 sha = ${showSha(was.sha)}\n` +
        `  ★ 现在（落盘前）盘上 sha = ${nowLine}\n` +
        `  ★ 谁改的：${culprit}\n` +
        `  ★ 为什么拒：你这一版内容是**对着打开时那一版**算出来的 ⇒ 放它落盘就是把别人的改动**静默覆盖**\n` +
        `    （审计 T2 实测：两席同时 open 双双通过，后落盘的那个把先落盘的整段抹掉，账上两条、零冲突读数）。\n` +
        `  ★ 怎么办（三步，缺一不可）：① 重读 \`${rel}\`（看清现在的样子）；② 基于**新内容**重算你的改动；\n` +
        `    ③ 重新 \`openSourceWrite\`（它会重新记 pre-hash）再落盘。\n` +
        `  ★ 本闸**没有 force**：能落盘的那一版，必须是基于**盘上现存内容**算出来的。`,
    });
  };

  /**
   * ★ 四种动词**共用**的声明校验（唯一实现）—— 与 `commit` 原来那段逐字同义，只是抽出来给 5 个动词用。
   *   ★ 抽出来不是为了少写几行：是为了**不可能**出现"某个动词忘了校验"（本卡的病灶就是这个形状）。
   */
  const assertDeclared = (file: string, verb: string): string => {
    const rel = relOf(root, file);
    if (!rel) {
      throw new Error(
        `拒绝落盘（source_writer · ${verb}）：\`${file}\` 不在项目根内（${root}）—— 根外文件进不了快照、也进不了索引。`,
      );
    }
    if (!allowed.has(rel)) {
      throw new Error(
        `拒绝落盘（source_writer · ${verb}）：\`${rel}\` **没有在 \`openSourceWrite\` 的 \`files\` 里声明过**。\n` +
          `  ★ 本次已判过的路径（${declared.length} 条）：${declared.join(', ')}\n` +
          '  ★ 怎么办：把这条路径加进 `files` 再开闸（判据只许走一次闸，不许绕）。',
      );
    }
    // ★★★ P0-A2（pre-hash）：**落盘前**的盘面比对 —— 位置在 `written.push` **之前**是有意的：
    //   被冲突拒掉的文件既没落盘、也不进本批"写过"清单 ⇒ `close()` 不会为它登记自写，
    //   `rollback()` 也不会把它算成"本批的改动"（改前那两件事都会把一次**没发生**的写说成发生过）。
    assertNoDrift(rel, verb);
    if (!written.includes(rel)) written.push(rel);
    return path.join(root, rel);
  };
  /** 收据（与 `commit` 逐字段同形 —— 5 个动词的回执不许有两种形状） */
  const receiptOf = (file: string): SourceWriteReceipt => {
    const rel = relOf(root, file) as string;
    return {
      path: rel,
      task_gate: gate.note,
      exemptions: gate.exempted,
      warnings: gate.warnings,
      ...(gate.assumption_check ? { assumption_check: gate.assumption_check } : {}),
      ...(snapshot ? { snapshot } : {}),
    };
  };

  const txn: SourceWriteTxn = {
    paths: declared,
    task_gate: gate.note,
    exemptions: gate.exempted,
    warnings: gate.warnings,
    ...(gate.assumption_check ? { assumption_check: gate.assumption_check } : {}),
    ...(snapshot ? { snapshot } : {}),
    commit(file: string, content: string): SourceWriteReceipt {
      // ★★ 这就是"没有逃生口"那一行（与另外 4 个动词**共用** `assertDeclared`）：
      //   没在 open 时判过闸的路径，这里**不许**写。
      const abs = assertDeclared(file, 'commit');
      const rel = relOf(root, file) as string;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      // ★ P0-A2：基线刷成"我刚写的那一版"（`writeFileSync(content,'utf8')` ⇒ 读回来的就是 `content`）
      knownSha.set(rel, { sha: contentHash(content) });
      logWrite(rel, 'commit');
      return {
        path: rel,
        task_gate: gate.note,
        exemptions: gate.exempted,
        warnings: gate.warnings,
        ...(gate.assumption_check ? { assumption_check: gate.assumption_check } : {}),
        ...(snapshot ? { snapshot } : {}),
      };
    },
    append(file: string, content: string): SourceWriteReceipt {
      const abs = assertDeclared(file, 'append');
      const rel = relOf(root, file) as string;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.appendFileSync(abs, content, 'utf8');
      // ★ P0-A2：追加后的内容这里没算过 ⇒ **读回来**当基线（不猜、不拼）
      knownSha.set(rel, readDiskSha(root, rel));
      logWrite(rel, 'append');
      return receiptOf(file);
    },
    copy(from: string, to: string): SourceWriteReceipt {
      // ★ P0-A2：**两端都判**（`from` 只读，但它决定了写进 `to` 的是不是你以为的那一版）
      const fromAbs = assertDeclared(from, 'copy(from)');
      const toAbs = assertDeclared(to, 'copy(to)');
      const fromRel = relOf(root, from) as string;
      const toRel = relOf(root, to) as string;
      fs.mkdirSync(path.dirname(toAbs), { recursive: true });
      fs.copyFileSync(fromAbs, toAbs);
      // 复制出来的字节 = `from` 此刻的字节（上面刚比对过没漂移）⇒ 两端的基线现在同值
      knownSha.set(toRel, knownSha.get(fromRel) ?? readDiskSha(root, toRel));
      logWrite(toRel, 'copy');
      return receiptOf(to);
    },
    move(from: string, to: string): SourceWriteReceipt {
      const fromAbs = assertDeclared(from, 'move(from)');
      const toAbs = assertDeclared(to, 'move(to)');
      const fromRel = relOf(root, from) as string;
      const toRel = relOf(root, to) as string;
      fs.mkdirSync(path.dirname(toAbs), { recursive: true });
      fs.renameSync(fromAbs, toAbs);
      // ★ P0-A2：rename 不换字节 ⇒ 老路径的基线直接搬到新路径上；老路径现在是"不存在"
      knownSha.set(toRel, knownSha.get(fromRel) ?? readDiskSha(root, toRel));
      knownSha.set(fromRel, { sha: ABSENT_SHA });
      // ★ 移动**两头都变了**（旧路径没了、新路径有了）⇒ 两条账；只记一条会让旧路径的消失无人可查
      logWrite(fromRel, 'move');
      logWrite(toRel, 'move');
      written.push(fromRel);
      return receiptOf(to);
    },
    remove(file: string): SourceWriteReceipt {
      const abs = assertDeclared(file, 'remove');
      const rel = relOf(root, abs) as string;
      fs.rmSync(abs, { force: true });
      // ★ P0-A2：删完就是"不存在"（回滚判据要知道这是**我们的**状态，不是别人改的）
      knownSha.set(rel, { sha: ABSENT_SHA });
      logWrite(rel, 'remove');
      if (!written.includes(rel)) written.push(rel);
      return receiptOf(file);
    },
    rollback(): RollbackResult {
      // ★ 没有快照 ⇒ **不猜、不假装已回滚**（0.12：这里必须与"没什么可回滚"可区分）
      if (!snapshot) {
        return {
          ok: false,
          message: '★★ 本批**没有写前快照** ⇒ 无法自动回滚（已落盘的文件仍在盘上）',
          restored: [],
          removed: [],
          failed: [...written],
        };
      }
      // ★★★ P0-A2 / A3：**别人写过的文件不许被这次回滚覆盖**（同一条 pre-hash 判据的反面）。
      //   改前：A 的 `rollback()` 用写前快照无条件整批还原 ⇒ 把 **B 的写**一起抹回 v0（T2 的第二半）。
      //   判据：本批声明过的每个路径，盘上此刻必须仍是"我们知道的那个版本"（打开时 / 本批刚写完的）。
      //   ★ 比对范围是**声明过的全部路径**，不只是 `written`：快照回滚会还原**整批**
      //     （含"声明了但没写成"的），那些文件被别人改过同样会被抹掉。
      const drifted: Array<{ rel: string; was: string; now: string | null }> = [];
      for (const rel of declared) {
        const was = knownSha.get(rel);
        if (!was || !('sha' in was)) continue; // 打开时就读不到 ⇒ 判不了（回执已在落盘时说过一次）
        const now = readDiskSha(root, rel);
        const nowSha = 'sha' in now ? now.sha : null;
        if (nowSha !== was.sha) drifted.push({ rel, was: was.sha, now: nowSha });
      }
      if (drifted.length) {
        const lines = drifted.map((d) => {
          const nowText = d.now === null ? '读不到（判不了）' : showSha(d.now);
          return `  · \`${d.rel}\`：打开时 ${showSha(d.was)} → 现在 ${nowText}；${culpritOf(d.rel)}`;
        });
        return {
          ok: false,
          message:
            `拒绝回滚（写冲突 [E-WRITE-CONFLICT]）：这 ${drifted.length} 个文件**在你 open 之后被别人改过** —— ` +
            `拿本批的写前快照回滚，会把**别人的写入一起抹掉**（审计 T2 实测：A 的 rollback 把 B 的写抹回 v0）。\n` +
            `${lines.join('\n')}\n` +
            `  ★ 本批一个文件都没还原、没删（盘上仍是**别人那一版**）；已落盘清单原样交回（\`failed\`）：` +
            `${written.join(', ') || '（空）'}\n` +
            `  ★ 怎么办：① 重读这些文件；② 若确实要撤回**你自己那一次**改动 ⇒ 逐段核清"哪一段是我的"再改，` +
            `不要整份回滚；③ 要把这份快照留档 ⇒ 快照 id = ${snapshot.id}（\`snapshot action='list'\` 可查），` +
            `别让回滚替你判断。`,
          restored: [],
          removed: [],
          failed: [...written],
          snapshot,
        };
      }
      // ★ 回滚实现**不新写**：`rename_files` 走的就是这一条（`rollbackFileSnapshot`）
      const rb = rollbackFileSnapshot(root, snapshot.id);
      // ★★★ 关键一步：**还原成功的从"本批写过"里剔掉** ⇒ 之后 `close()` 只登记真正留在盘上的
      //   （完整回滚 ⇒ `written` 空 ⇒ 一条自写都不登记；回滚不全 ⇒ 只登记没还原成的）
      const backToOld = new Set([...rb.restored, ...rb.removed]);
      for (let i = written.length - 1; i >= 0; i--) {
        const rel = written[i];
        if (rel !== undefined && backToOld.has(rel)) written.splice(i, 1);
      }
      // ★ P0-A2：**回滚自己也是一次写** ⇒ 还原成功的路径基线刷成"我刚还原的那一版"。
      //   不刷的话，第二次 `rollback()` 会把"我刚还原的字节"误报成"别人改的"（假冲突）。
      for (const rel of backToOld) knownSha.set(rel, readDiskSha(root, rel));
      return rb;
    },
    close(): WriteThroughOutcome | null {
      if (!written.length) return null;
      // ④a 自写登记（L1b）：写穿失败时读路径靠它兜 —— 必须**先**登记，否则失败就没兜底了
      recordSelfWrite(root, written, ctx.label);
      // ④b 同步写穿（L1a）：解析器已预热 ⇒ 当场直连；未预热 ⇒ 整批落回 L1b（绝不半同步）
      // ★★ 2026-10-28（T-#RP-3 续）：**逐文件读数必须喂回去** —— 原来这里没传 `opts.onFile`，
      //   于是 `SourceWriteCtx.onFile`（`apply_writes` 靠它拿逐文件 `updated`）**从来没被调用过**
      //   ⇒ 回执报 `index_synced:[{updated:false}]`，而 `index.synced=1`（真同步了）—— 读数自相矛盾。
      //   ★ 这与 T150 / T245 同一族：**读数在中间层被丢**（不是算错，是没交出去）。
      const index = syncSelfWritesSync(root, written, { ...(ctx.onFile ? { onFile: ctx.onFile } : {}) });
      // ④c 写者自己的读集基线刷到写后 —— 不刷会让同一个 actor 下一次写必然报一条假 stale
      //   ★ AGENTS-RULES 0.12：刷新的**读数**也要带出来 —— 原来返回値被直接丢掉，而
      //     "算不出指纹"与"整段失败"在旧调用点上都与"没什么可刷"同形（读集悄悄缩小，无人知）。
      //     推进 `gate.warnings`（= `SourceWriteReceipt.warnings` 的**同一个数组引用**）⇒ 回执带着它。
      for (const line of ownWriteRefreshLines(refreshAfterOwnWrite(root, resolveActor(ctx.actor), written))) {
        if (!gate.warnings.includes(line)) gate.warnings.push(line);
      }
      // ★★ 开发遥测（第⑬项队列）：落盘是故事线的执行帧——文件清单进 data（GUI 用）
      emitTelemetry(root, TELEMETRY_STAGES.write, {
        text: `正在落盘 ${written.length} 个文件：${written.slice(0, 3).join(', ')}${written.length > 3 ? ' 等' : ''}`,
        data: { files: written, label: ctx.label, index_ok: index?.ok ?? false },
      });
      return index;
    },
  };
  return txn;
}

/**
 * ★ 单文件写入（最常用）：`open → commit → close`，一次调用做完四件事。
 * `root` 之后的所有路径都必须是**项目内**的（根外直接抛，理由见 `commit`）。
 */
export function writeSourceFile(
  root: string,
  file: string,
  content: string,
  ctx: SourceWriteCtx,
): SourceWriteReceipt {
  const txn = openSourceWrite(root, [file], ctx);
  const receipt = txn.commit(file, content);
  const index = txn.close();
  return index ? { ...receipt, index } : receipt;
}

/**
 * ★ 批量写入：**整批判一次闸 + 拍一份快照**，再逐文件落盘，最后一次性登记/写穿。
 *
 * ★ 为什么不做成"逐文件调 `writeSourceFile`"：那会让 `authorize` 的**整批原子**退化成
 *   "能过的先落"（半写），并让一份改动碎成 N 个撤回点。批的语义必须由一次判闸保证。
 */
export function writeSourceBatch(
  root: string,
  entries: ReadonlyArray<readonly [string, string]>,
  ctx: SourceWriteCtx,
): SourceWriteReceipt[] {
  if (!entries.length) return [];
  const txn = openSourceWrite(root, entries.map((e) => e[0]), ctx);
  const receipts = entries.map(([f, c]) => txn.commit(f, c));
  const index = txn.close();
  return index ? receipts.map((r) => ({ ...r, index })) : receipts;
}

/**
 * ★ **回滚通道**（不是写路）：把「本次调用刚读走 / 删掉」的字节**逐字放回**。
 *
 * ## 为什么它可以不过闸（这是判据，不是偷懒）
 * 1. **它写的不是新内容**：手上那份是**删之前**读到的原样（`deprecate_offline` 的 `backups`）。
 *    「改源码」的定义是**产生新版本**；把旧版本放回去不产生任何新版本。
 * 2. **闸在这里会制造数据丢失**：调用它的那一刻是「文件已经 `rmSync` 删掉、随后编译回归」——
 *    闸拒绝一次 = 源码**永久**没了。回滚没有「换个写法重试」的余地 ⇒ 它的正确性优先于闸的仪式。
 * 3. **该判闸的是「删」，不是「删错了再放回来」** ⇒ 闸必须挪到 `rmSync` **之前**
 *    （见 todo 卡：写闸判据只覆盖覆盖写 · 要扩成 写/移/删/追加 四类）。
 *
 * ★ 用法**唯一**（`deprecate_offline.ts` 的编译回归分支），且必须与「先把内容读进内存」在同一个函数里，
 *   中间不许夹别的写 —— 否则就不叫回滚了。
 */
export function restoreSourceBytes(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  // ★★★ 2026-11-03（0.8 第三本账 ④）：**回滚也入账**（kind='rollback'）。
  //   它是回滚通道、本来就不过闸 ⇒ `card_id` 必为 null 且 `source='restoreSourceBytes'`：
  //   **回滚不是"无卡写"** —— 混起来会把回滚算成欠账（0.12：两者必须可区分）。
  //   ★ 项目根只问 `resolveProjectRoot`（唯一那把尺）；根外路径没有账可入（不进任何项目的 tasks.db）。
  const root = resolveProjectRoot(abs);
  const rel = toIndexKey(root, abs);
  if (!rel) return;
  const logged = recordWriteLog(root, [writeLogRowOf(rel, 'rollback', { actor: null, card_of: {}, branch_of: {} })]);
  if (logged.error) process.stderr.write(`[source_writer] 写账未记（write_log · ${rel} · rollback）：${logged.error}\n`);
}
