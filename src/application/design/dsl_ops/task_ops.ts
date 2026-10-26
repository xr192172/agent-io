/**
 * task_ops.ts —— **任务格的唯一写端**（`publish` / `claim` / `release` / `complete`）。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.task_home`（OQ11 裁定 B 的展开）：
 *   · **家** = `geometry.nodes[].task`（与节点同居；★ 不设顶层 `tasks[]`）；
 *   · **唯一写端** = `edit_dsl {type:'task'}`（四个 action 都从这里进）；
 *   · **两轴消歧** = `task.state` 是唯一权威，`node.status`（progress 三轴）对它只是
 *     **派生值**（`task_schema.ts#progressOf`，读时现算）。
 *
 * ## ★★ 为什么状态必须只有一个写端（T5 停手时核出的病）
 * 收归前：`updateStatus` 写 overlay 的 `progress`（三值轴），而任务态是**另一条五值轴**
 * （`candidate|claimed|done|void|superseded`）⇒ **两轴无映射 = 一事实两权威**。
 * ⇒ 现在：**任务态只在这里改**；progress 由 `task.state` 派生（`progressOf`），
 *   本文件的写动作在落盘时**顺带把派生值投影回 base**（`applyOverlay`，T328 既有的守则：
 *   base 上那份是"应用结果"，不是独立副本）—— 这样 `get_dsl` 当下即可读到，而权威仍是 `task.state`。
 *
 * ## ★★★ 为什么这几步是 async
 * `t_claim` 的 guard 逐字要求 **`isClaimable(cardStanding(card)) === true`**，而 `cardStanding` 要跑
 * `judgeExpectations`（读索引 / 读盘，异步）。⇒ 若把"先判可领性"留给调用方"记得调"，
 * 那就是**补丁**（别处要记得配合）⇒ 于是把 **claim→判定** 收进本函数，写链随之 async。
 *
 * ## ★★★ `publish` 是什么（2026-10-17 · 铁律 3 的那一维）
 * **把该节点上已有的决策卡翻成一张任务卡**——但按**两级**（`two_level_tasks`）：
 * · 有**可判的后态判据** ⇒ **L2 实现卡**：`decision.summary` + `decision.expectations` 逐字搬；
 * · 无 decision / decision 太粗（**没有后态判据**）⇒ **L1 建构卡**：`summary` 只从
 *   `semantic.responsibility`/`title`/`label`/文件名/id 里**已有的**拼，`expectations` **空**（★ 不编判据）。
 * ⇒ ★ **输入里没有"我编的任务描述"**：`publish` 的 `data` 一个键都不收
 *   （`op_data_spec.ts` 的 `TYPE_KNOWN_KEYS.task` 只有 `owner/reason/evidence`，
 *    给 `summary` 会被"不被认的键"当场拒）—— 内容**只能**来自节点/语义层既有字段。
 * ⇒ ★ 旧判据"没有 decision 的节点 publish **必拒**"**已按 `publish_rule.corrected` 纠正**：
 *   那会鸡生蛋（第一个 decision 从哪来）；现在改成 L1 建构卡。
 *   行为面判据见 `certs/t350-publish-task-cert.mjs`（L2 翻卡）与 `certs/t353-*.mjs`（L1 / L2 对照）。
 *
 * ## 边界（★ 如实写明，别让读端以为它管得更宽）
 * · `publish` **只做两件事**：翻 L2（逐字搬 decision）· 立 L1（summary 只拼既有字段、**0 条期望**）。
 *   ★ 它**不补判据、不替人编一条期望**（缺 ⇒ L1 并**如实说缺什么**，不猜）。
 *   它**不负责让 `docs/board.md` 显示**这张卡 —— 榜单是**读端**（T8，未建），
 *   应当由它读「对拍的红 + 设计 DSL 里现有的 task 格」派生，而不是靠人抄表。
 * · 本文件**不判**判据的语义（六类判据的判定器只有 `judgeExpectations` 一把尺）；
 *   证据闸只有 `validateProgressEvidence` 一把尺 —— 这里只**调**它们。
 */
import type { EditResult } from './edit_result.js';
import fs from 'node:fs';
import { getDesignSheet, saveDesignSheet, getDesignSheetFile } from '../../../infrastructure/storage.js';
import { loadOverlay } from '../../../infrastructure/storage_overlay.js';
import path from 'node:path';
import { applyOverlay, seedOverlayFromDsl, validateProgressEvidence, type ProgressEvidence } from '../../../domain/overlay.js';
import {
  applicableTransitions,
  cardStanding,
  isClaimable,
  isLeaseExpired,
  // ★ 2026-10-23：哪些状态持租约的唯一值域（`preparing` 也持）—— 本文件不自写 `=== 'claimed'`
  isLeaseHolding,
  isSatisfied,
  leaseAgeHours,
  LEASE_TTL_MS,
  type CardStanding,
  type ClaimIntent,
} from '../../../domain/task_machine.js';
// ★ 2026-10-21（D-judge-port）：判定器的**实现**住 application，由这里**注入**给 domain 的状态机
//   （`cardStanding` / `isSatisfied` 的 `opts.judge`）—— domain 不再向上 import application。
// ★ 2026-10-23（增量测试 · 选量）：`indexStaleFor` = 「索引是否与源码一致」的**既有那一把尺** ——
//   选量（`planEvidenceRerun`）的第三个复用条件读它，不另写一个"索引新不新"。
import { indexStaleFor, judgeExpectations } from '../intent/expectations.js';
import { expectationPaths, expectationPhase, postExpectations, type Expectation } from '../../../domain/expectation.js';
import {
  ABSENT_FILE_HASH,
  codeFingerprintOf,
  fingerprintOf,
  // ★ 2026-10-22（task.expectations 去副本）：**判据的唯一读法** —— 从节点的 decision 现取；
  //   本文件不再读卡上的副本（`TaskSpec` 已无该字段）。
  expectationsOf,
  // ★ 2026-10-21：`todo.update` / `retire` 要判「这张卡还开着吗」—— ★ 读**既有那一把尺**
  //   （done / void 都算了结），不在本文件里再写一遍 `state === 'done' || state === 'void'`
  //   （那正是 `task_schema.ts` 2026-10-20 花了一笔改成 `isClosedTaskState` 的病）。
  isClosedTaskState,
  // ★★★ 2026-10-22（软归档）：归档判据**只读这一个函数**（`archived_at` 非空的唯一读法），
  //   本文件不写 `!!card.archived_at`（判据住两处 = 本仓头号病）。
  isArchivedTask,
  // ★ 2026-10-22（卡迁移）：`todo.import` 要挡「不是四态的 state」—— ★ 读**既有那一把尺**（同 task_machine 的判定），
  //   不在 import 里再列一遍四个字面量（那会变成第二份状态表）。
  isTaskState,
  progressOf,
  taskLevel,
  // ★★★ 2026-10-23：证据落盘的**唯一裁口**（白名单住 `task_schema.ts#TASK_EVIDENCE_KEYS`）——
  //   本文件不逐字段手写证据：那种写法正是 `observed` / `command` 被静默丢掉的形状。
  pickTaskEvidence,
  // ★★★ 2026-10-22（迁移第②步 · 读端切到 todos[]）：卡的**权威住处**判据只住 `task_schema`（本文件不自写）。
  taskOfNode,
  // ★ 2026-10-23：设计册 `state_machine.states` 的写端要拿它做**逐字比对**（同步 = 改不动就漂不了）
  TASK_STATES,
  todosForNode,
  type TaskDiscussion,
  type TaskEvidenceFingerprint,
  // ★ 2026-10-23（增量测试 · 选量）：证据"还作数吗"的唯一判据 + 它要的两种形状
  evidenceFreshness,
  type EvidenceFreshness,
  type TaskEvidenceRecord,
  type TaskHistoryEntry,
  type PreparedSnapshot,
  type TaskReadSet,
  type TaskSpec,
  type TaskState,
} from '../../../domain/task_schema.js';
// ★ 2026-10-21：`todo.delete` 的**墓碑**（物理删是唯一让卡真的从册上消失的操作 ⇒ 必须有卡外留痕）。
import { appendTodoTombstone, todoJournalFile } from '../board/todo_journal.js';
// ★★★ 2026-10-23（history 表）：已了结卡**出册**的落点 —— 项目级**独立库**
//   `.agent-io/task-history.db`（★ 不是 cache.db：那个库会被 import_project 重建 ⇒ 审计数据会被删光）。
import { dropTaskHistoryBatch, getTaskHistoryFile, recordTaskHistory, type TaskHistoryRow } from '../../../infrastructure/task_history.js';
// ★★★ 2026-10-21（跑环继任链）：链的**位置**（depth / total / children / broken）与**入口校验**
//   （自指 / 悬挂 / 接作废卡 / 成环）**唯一住处** = `domain/todo_chain.ts` ——
//   ★ 本文件只调它：读端（complete 的提示）与写端（add / follows）共读同一把尺，不各算一遍。
import { assertFollowsTarget, buildTodoChains, chainBadge } from '../../../domain/todo_chain.js';
import { contentHash } from '../../../infrastructure/index/symbols.js';
import type { DecisionHistoryEntry } from '../../../domain/geometry.js';
// ★★★ 2026-10-21（并发控制·账户）：**规范唯一定义处**（`domain/actor_spec.ts`）。
//   ★ 这里只用它做两件事：① 写入的 `data.owner` 过关（新值必须合规）② 与顶层 `agent` 比"是不是同一个人"。
//   ★ 也读**同一个**严格开关（`actorStrictMode`），不自己再读一次 env。
import {
  admitActor,
  actorStrictMode,
  normalizedActorNote,
  sameActor,
  type ActorAdmission,
} from '../../../domain/actor_spec.js';
import { updateStatus } from './status_tools.js';
// ★★★ 2026-10-21（并发控制·读集比对）：claim 时把「这张卡要碰什么」与其他活跃卡比交 —— **相交即拒领**。
//   ★ 判据/取舍（含“为什么不用 imports 兜底”的实测读数）全在 `application/claim_conflict.ts` 文件头。
//   ★ 与写前的 `assumption_check`（`application/read_set.ts`，**只报**）**不是一套**：两个时机、两种强度。
import {
  claimConflictLine,
  claimConflictMessage,
  collectActiveClaims,
  computeClaimReadSet,
  detectClaimConflicts,
  parseDeclaredReadSet,
  type ClaimConflictReport,
  type DeclaredReadSet,
} from '../../claim_conflict.js';
// ★★★ P0 保鲜链第 4 环（2026-10-26）：**claim 前置的索引可信度提醒**。
//   判定复用 `index_integrity` 现有函数（`indexTrustReminderForClaim` 唯一住处）；
//   ★ **不拒领**：untrusted（陈旧断言>0）只在回执里追加提醒行，避免阻塞正常领卡。
import { indexTrustReminderForClaim } from '../../meta/integrity/index_integrity.js';

/**
 * ★★★ 2026-10-22（链 C · 身份归一化）：**卡上的「谁」只走一套规范**。
 *
 * ## 为什么要有它
 * `claim` 写 `owner` 时过了 `admitActor`（`workbuddy` ⇒ `agent:workbuddy`），而 `release` 的
 * `released_by` / `todo.retire` 的 `retired_by` / `complete` 的 `evidence[].agent` / `reopen` 的 `owner`
 * 原先都是 `input.agent ?? null`（或 `input.owner`）**原样落盘** ⇒ **同一张卡上两处署名两种格式**。
 * ★ 实测证据：`certs/t349-task-home-cert.mjs` 的 `released_by === 'agent-t349'` 至今是绿的，
 *   而同一张卡的 `owner` 已是 `agent:agent-t349` —— 两种格式同住一张卡。
 *
 * ## 判据（与 `domain/actor_spec.ts` 文件头逐字同源，不另立）
 * · 合法（`<kind>:<name>`）⇒ 原样；老格式（无前缀）⇒ 补 `agent:` 并在回执留痕（STRICT 下拒）；
 * · 完全非法 ⇒ **抛**（`admitActor` 给正确写法 + 机械建议）；
 * · 空 ⇒ `null`（= 没自报；纪律②「不造默认身份」）。
 *
 * ★ **不造第二种留痕**：回执统一用 `actor_spec.ts#normalizedActorNote`（`invokeTool` 用的就是它）。
 */
function signTaskActor(
  raw: string | undefined | null,
  field: string,
): { actor: string | null; adm: ActorAdmission } {
  const adm = admitActor(raw ?? '', null, { strict: actorStrictMode() });
  if (!adm.ok) {
    throw new Error(
      `${adm.error}\n★ \`${field}\` 与 claim 的 \`data.owner\` 走**同一套规范**（唯一定义 = \`domain/actor_spec.ts#admitActor\`）` +
        `—— 同一张卡上两处署名必须同格式，否则读端要按两套文法解释「谁」。`,
    );
  }
  return { actor: adm.actor, adm };
}

/**
 * 归一化留痕的**首行片段** —— `edit_dsl` 批量回执只印首行，所以「已归一化」必须挤进首行。
 * ★ 措辞与 `normalizedActorNote` 的标题行同源（同一份留痕，不是第二份）。
 */
function normalizedInline(adm: ActorAdmission): string {
  return adm.normalizedFrom ? `，★ 已归一化自 \`${adm.normalizedFrom}\`` : '';
}

/** 本文件接受的 op（**结构类型**，不 import `update_feature` —— 那是反向依赖，会成环）。 */
export interface TaskOpRequest {
  type: string;
  op: string;
  id?: string;
  data?: Record<string, unknown>;
}

export interface TaskOpInput {
  feature: string;
  node_id: string;
  /** 领取者身份（claim 必填 —— CAS 写的就是它） */
  owner?: string;
  /**
   * 领取**意图**（claim 可选；★ 2026-10-20）：
   * · `work`（缺省）= 判据有红，来**补红**；
   * · `modify`        = 判据**可以全过**，仍要改文件（改判据 / 重构 / 改注释）—— 取的是**写权**。
   * ⇒ 没有它，"已满足的卡"就领不到 ⇒ 写闸不认 ⇒ **文件永久只读**（见 `task_machine.ts` 文件头）。
   */
  intent?: ClaimIntent;
  /** 释放原因（release 必填；`t_release`：显式 release 事件要带 reason） */
  reason?: string;
  /** 完成证据（complete 必填 —— 复用 `validateProgressEvidence` 三档） */
  evidence?: ProgressEvidence;
  /** 发起者身份（写进 `released_by` / 回执；★ 工具不伪造） */
  agent?: string;
  /**
   * ★★★ 2026-10-21（并发控制·读集比对）：claim 时**显式声明**「我要碰这些符号/文件」（`data.read_set`）。
   *
   * 这是读集的**第一判据** —— 最准，因为「这张卡要做什么」只存在于领卡人的意图里；
   * 缺省 ⇒ 从卡上判据点名的符号 + 节点自己的文件兜底（见 `claim_conflict.ts` 文件头）。
   * ★ 形状校验唯一住处 = `claim_conflict.ts#parseDeclaredReadSet`（本接口只声明类型）。
   */
  read_set?: DeclaredReadSet;
}

// ─────────────────────────────────────────────────────────────
// 读格子（唯一入口：取 DSL + 节点 + 任务格）
// ─────────────────────────────────────────────────────────────

interface Loaded {
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>;
  nodeId: string;
  card: TaskSpec;
}

function loadTask(feature: string, nodeId: string): Loaded {
  const dsl = getDesignSheet(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在 —— 任务格住在设计 DSL 的节点上，先有 feature 才有家。`);
  }
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  // ★★★ 2026-10-18（Q5）：**节点找不到 ⇒ 找 todos**（无节点任务，同一套状态机/op）
  if (!node) {
    const todo = (dsl.todos ?? []).find((t) => t.id === nodeId);
    if (todo) return { dsl, nodeId, card: todo };
  }
  if (!node) {
    throw new Error(
      `节点 "${nodeId}" 不在 feature "${feature}" 的 geometry.nodes 里 —— 任务与节点同居，找不到节点就没有家。`,
    );
  }
  // ★★★ 2026-10-22（迁移第②步 · 读端切到 todos[]）：**先按 `todos[]` 找它的卡**（迁移后权威在那儿）。
  //   ① `id === nodeId` 的卡（迁移镜像 = 节点自己的卡）优先 —— `claim id:<节点id>` 的对外契约就钉在它上面；
  //   ② 否则 `taskOfNode`（指向本节点的卡；一条都没有才回落 `node.task` 这个**派生投影**）。
  //   ★ 旧写法 `if (!node.task) throw` 把投影当权威 ⇒ 在 todos 侧 claim 完，`node.task` 仍是旧态。
  const ownCard = (dsl.todos ?? []).find((t) => t.id === nodeId);
  const card = ownCard ?? taskOfNode(node, dsl.todos);
  if (!card) {
    throw new Error(
      `节点 "${nodeId}" 上**没有任务格**（「geometry.nodes[].task」）⇒ 无卡可 claim / release / complete。\n` +
        `★ 立卡 = \`publish\`：\`{ type:'task', op:'publish', id:'${nodeId}' }\` —— 它把该节点的**决策卡**` +
        `（\`decision.summary\` + \`decision.expectations\`）翻成任务卡（★ 内容来自 decision，**不接受手写 summary**）。` +
        `★ 没有 decision / decision 太粗（无后态判据）⇒ 立的是 **L1 建构卡**（0 条期望，判据 = DSL 建构完整）；` +
        `有可判的后态判据 ⇒ **L2 实现卡**。★ 本工具**不替你凭空造一张空卡**。`,
    );
  }
  return { dsl, nodeId, card };
}

/** 判据（`judgeExpectations`）要一个**被分析项目的根**；缺了就不判（★ 绝不兜底到 cwd）。 */
function requireRoot(dsl: { source_root?: string }): string {
  const root = dsl.source_root;
  if (!root || !root.trim()) {
    throw new Error(
      '该 feature 没有 `source_root` ⇒ 没有"被分析项目的根"，后态判据**判不了**（claim/complete 都要过判据）。\n' +
        '★ 这里**故意不兜底到 cwd**：cwd 是"另一个项目"，不是"更弱的答案"。',
    );
  }
  return root;
}

/** 迁移存在性（★ 迁移表只有一处 = `task_machine.TRANSITIONS`；本文件不抄第二份字面量）。 */
function assertTransition(from: TaskState, to: TaskState, action: string): void {
  const ok = applicableTransitions(from).some((t) => t.to === to);
  if (!ok) {
    const can = applicableTransitions(from).map((t) => t.to);
    throw new Error(
      `${action} 被拒：state=${from} 没有到 ${to} 的**可用**迁移（可走：${can.length ? can.join(' / ') : '（无 —— 终态）'}）。` +
        `★ 迁移表唯一住处 = src/domain/task_machine.ts#TRANSITIONS（.agent-io/design/task-system-plan.dsl.json 的 state_machine）。`,
    );
  }
}

/**
 * 落盘：**只改 `todos[]`**（唯一写端；`node.task` 是**派生投影**），然后把派生进度**投影**回 base（`applyOverlay`）。
 * ★ 投影这一步与 `updateStatus` 同款（T328）：base 上的 `status` 是**应用结果**，不是独立副本；
 *   权威始终是 `task.state`（`progressOf` 是唯一映射，读端见 `overlay.ts#applyOverlay`）。
 *
 * ★★★ 2026-10-22（软归档）：本条路径拆成三段 ——
 *   ① `assertCardWritable`（**写端结构不变量**，两条）；② `withCardWritten`（卡片 ⇒ DSL 内存副本，**纯函数**）；
 *   ③ `writeTask`（校验 → 改副本 → 投影 → 存盘）。
 *   ★ 为什么要拆：`todo.archive` 要一次改 100+ 张卡，若逐张 `writeTask` = 每张都把 5 MB 的册子读写一遍
 *     （实测不可接受）⇒ 它必须能"改完再存一次"。而「写哪一份 / 投影到哪」这条规则**只能有一处**，
 *     所以抽成 `withCardWritten` 给两条路共用 —— 否则 archive 会变成第二份投影实现。
 */
function assertCardWritable(nodeId: string, next: TaskSpec): void {
  // ★★★ 2026-10-22（task.expectations 去副本）：**结构不变量** —— 任务格**不得自持判据**。
  //   判据只住 `decision.expectations`；这里是最靠近落盘的一道，写在它上面照样会被拒。
  //   ★ 旧 DSL 里的副本必须先迁掉（否则任何 task op 都会在这里响亮失败，而不是悄悄写回一份新副本）。
  if ((next as unknown as Record<string, unknown>).expectations !== undefined) {
    throw new Error(
      `任务格被拒（写端结构不变量）：节点 "${nodeId}" 的 task 里带了 \`expectations\` —— ` +
        `判据只住 \`decision.expectations\`（TaskSpec 已无该字段）。\n` +
        `★ 要改判据 ⇒ 改 decision（\`edit_dsl { type:'decision', op:'update', … }\`）；` +
        `★ 旧 DSL 里的历史副本 ⇒ 先执行迁移（去掉 task.expectations），再写卡。`,
    );
  }
  // ★★★ 2026-10-22（软归档）：**结构不变量 —— 归档只属于已了结的卡**。
  //   归档一张还在跑的卡 = 让「正在干的活」从待办/池里**静默消失**（最坏的那种丢活）。
  //   写在最靠近落盘的一道：任何 op 想这么写都会被拒，而不是靠每个 op 自己记得。
  //   ★ 已归档的卡要重新进活态 ⇒ 先 `todo.unarchive`（**显式**）。**不在这里替它清**：
  //     静默清除会让「这张卡曾经归档过」这件事没人知道（而它正是判据 A/C 的证据）。
  if (isArchivedTask(next) && !isClosedTaskState(next.state)) {
    throw new Error(
      `任务卡被拒（写端结构不变量）："${nodeId}" 是 ${next.state}（**未了结**）却带着 archived_at=${String(next.archived_at)}。\n` +
        `★ 归档只给**已了结**（done / void）的卡 —— 归档一张还在跑的卡，等于让正在干的活从待办里消失。\n` +
        `★ 要让它重新进活态：\`edit_dsl { type:'todo', op:'unarchive', data:{ ids:['${nodeId}'] } }\`（先把标记清掉，再 claim / reopen）。`,
    );
  }
}

/** 「写哪一份、投影到哪」的**唯一实现**（纯函数：不读盘、不写盘）—— `writeTask` 与 `todo.archive` 共用。 */
function withCardWritten(
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>,
  nodeId: string,
  next: TaskSpec,
): NonNullable<ReturnType<typeof getDesignSheet>> {
  // ★★★ 2026-10-18（Q5）：**按"挂在哪"分叉** —— todo 写 `todos[]`，节点任务写 `geometry.nodes[].task`。
  // ★★★ 2026-10-22（卡迁移 · 兼容层）：**按卡的【住处】写回** —— 不再「todos 里有同 id 就当它是 todo 卡」。
  //   旧判据 `some(t => t.id === nodeId)` 在迁移后对 104 个节点**全部为真**（todos[] 里都有同 id 的镜像）
  //   ⇒ 节点卡的每一次 claim / complete 都会落进 todos[] 镜像，而节点卡**冻结在旧态**；
  //   而读端（`loadTask` 节点优先、`progressOfNode` ①）读的仍是节点卡 ⇒ **一张卡两个答案、claim 永远不生效**。
  //   判据：**节点上有卡** ⇒ 节点是主住处（与读端同序）；`todos[]` 里那条同 id·同 node_id 的
  //   **迁移镜像**跟着写同一份（否则下一步把读端切到 todos[] 时，这一步之间写入的数据会丢）。
  //   ★ 纯 todo 卡（节点上没有它的 id）行为不变：仍是只在 `todos[]` 里改。
  // ★★★ 2026-10-22（迁移第②步 · 写端跟着读端走）：**先写权威 `todos[]`，再刷派生投影 `node.task`**。
  //   上一版（第①步的兼容层）是反的：节点优先写、todos 跟着镜像 —— 那是"读端还没切"时的临时序。
  //   现在读端（`loadTask` / `taskOfNode` / `pool` / 闸 / `progressOfNode`）全部以 todos 为准
  //   ⇒ 写端必须先落那里；`node.task` 只剩"字段不撒谎"这一个用途（读端**不认**它）。
  //   ★ 还没迁移的 feature（todos 里没有这张卡）仍写节点 —— 那是**过渡**，不是第二权威。
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  const todoIdx = (dsl.todos ?? []).findIndex((t) => t.id === nodeId);
  let nextDsl: typeof dsl;
  if (todoIdx >= 0) {
    const prev = (dsl.todos ?? [])[todoIdx];
    const todos = [...(dsl.todos ?? [])];
    // ★ `node_id` 是**住处**（`todos[]` 里这张卡挂在哪个节点上）：原样保留，否则卡会从节点上掉下来。
    todos[todoIdx] = { ...next, ...(prev.node_id !== undefined ? { node_id: prev.node_id } : {}) };
    nextDsl = { ...dsl, todos };
    if (node?.task) {
      const nodes = (dsl.geometry?.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, task: next } : n));
      nextDsl = { ...nextDsl, geometry: { ...dsl.geometry!, nodes } };
    }
  } else if (node) {
    // ★ 节点存在但**还没有卡** ⇒ publish 就是"给没卡的节点立卡"，这里负责**新建**那一格
    //   （t350 ①/⑥ 打的就是它 —— 少了这一支，publish 对无卡节点会报"卡没有住处"）。
    const nodes = (dsl.geometry?.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, task: next } : n));
    nextDsl = { ...dsl, geometry: { ...dsl.geometry!, nodes } };
  } else {
    throw new Error(
      `落盘目标「${nodeId}」既不是带卡的节点、也不在 todos[] —— 卡没有住处，不写（绝不静默降级）。`,
    );
  }
  return nextDsl;
}

function writeTask(feature: string, nodeId: string, next: TaskSpec): void {
  assertCardWritable(nodeId, next);
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 在落盘前读不到 ⇒ 不写（绝不静默降级）。`);
  const nextDsl = withCardWritten(dsl, nodeId, next);
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
  saveDesignSheet(applyOverlay(nextDsl, ov));
}

/**
 * ★★★ **一次「判据空」的体检 + 照做清单**（2026-10-23 · 两段式领取的**反馈**那一半 = 判据 D）。
 *
 * ## 为什么必须能"照做"，而不只是"请补判据"
 * 用户 2026-10-22 原话：*「接任务的时候应该要有反馈」*。而「请补判据」这种回执等于**没说**：
 * 补哪一类？补几条？写到哪个字段？—— 都得自己再想一遍，于是这一步会被跳过，
 * 结果就是今天这个读数：**candidate 137 张里 85%（117 张）判据 0 条**。
 * ⇒ 本函数把"缺什么"算成**具体到能抄**的东西：节点 id、类别、条数、以及每条可直接粘的 JSON 模板
 *   （模板里的 `path` / `symbol` 从该节点的 `semantic.files` 现取，不是占位符）。
 *
 * ## ★ 它**不编判据**
 * 模板里的 `signature` / `must` / `why` 是**空白待填**的（只填入真实的 path / symbol）——
 * 替人编一条"必须这样"的验收，等于用一个假判据换掉"没有判据"，比空着更坏。
 */
interface CriteriaGap {
  /** 要补几条 */
  need: number;
  /** 哪几类（`Expectation['kind']` 里挑） */
  kinds: string[];
  /** 人读清单（逐行，直接进回执） */
  lines: string[];
  /** 可直接粘的模板（每条一个 JSON 串） */
  templates: string[];
}

function criteriaGap(
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>,
  node:
    | {
        id?: string;
        type?: string;
        path?: string;
        decision?: { expectations?: Expectation[] };
      }
    | undefined,
  cardId: string,
): CriteriaGap {
  const expectations = node?.decision?.expectations ?? [];
  const post = postExpectations(expectations);
  const pre = expectations.filter((e) => expectationPhase(e) === 'pre');
  const sem = (dsl.semantic?.files ?? []).find((f) => f.id === node?.id);
  // ★ T-#37：回落 `description` 的分支已删（`Node.description` 不存在）
  const filePath = (node?.path ?? '').trim() || (sem?.path ?? '').trim();
  /** ★ 从这个节点**已有的符号**里取一个真实名字（模板里不写 `<symbol>` 这种占位符 —— 那还是要人再查一遍） */
  const symbols = (sem?.symbols ?? []).map((s) => String((s as { name?: unknown }).name ?? '')).filter(Boolean);
  const sample = symbols[0];
  const kinds = sample ? ['signature-matches', 'source-has'] : ['file-exists', 'source-has'];
  const need = kinds.length;

  const lines: string[] = [
    `节点 ${cardId} 的 \`decision.expectations\` 里**后态判据（phase=post）0 条**` +
      (pre.length
        ? `（现有 ${pre.length} 条**全是前态** —— 前态判据"还没施工就天然成立"，拿它当验收 = 永远绿）`
        : '（**一条判据都没有**）'),
    `要补 **${need} 条**：${kinds.join(' + ')} —— ` +
      (sample
        ? `一个"结构"（\`${sample}\` 的签名就算证据）+ 一个"行为/文本"（关键写法必须在）`
        : `一个"文件在"（该文件必须存在）+ 一个"文本在"（关键写法必须在）`),
    `写到哪：\`edit_dsl { type:'decision', op:'update', id:'${cardId}', data:{ expectations:[…] } }\`` +
      `（判据**只住 decision**，不在卡上；卡上的是一张回滚快照）`,
    `补齐后：\`edit_dsl { type:'task', op:'start', id:'${cardId}', data:{ owner:'<你>' } }\`` +
      `（第二段：删快照 + state→claimed，**一次落盘**）`,
    `放弃：\`release\`（会按 \`prepared_snapshot\` 把判据**逐字还原** ⇒ 零残留）`,
  ];
  if (!filePath) {
    lines.push(
      `★★ 该节点**没有 path**（\`node.path\` / \`semantic.files[].path\` 皆空）⇒ 判据无处可指：` +
        `先给它补 path（\`node update\`）或改用带 node_id 的 todo 卡，否则这一类判据写不出来`,
    );
  }

  const templates: string[] = sample
    ? [
        `{"kind":"signature-matches","path":${JSON.stringify(filePath || '<该节点 path>')},"symbol":${JSON.stringify(sample)},` +
          `"signature":"<目标签名：把当前签名抄过来，只改你要改的那部分>","why":"<谁依赖它 / 为什么必须长这样>"}`,
        `{"kind":"source-has","path":${JSON.stringify(filePath || '<该节点 path>')},"must":["<必须出现的关键写法>"],` +
          `"why":"<为什么这段必须在>"}`,
      ]
    : [
        `{"kind":"file-exists","path":${JSON.stringify(filePath || '<该节点 path>')},"why":"<为什么这个文件必须在>"}`,
        `{"kind":"source-has","path":${JSON.stringify(filePath || '<该节点 path>')},"must":["<必须出现的关键写法>"],` +
          `"why":"<为什么这段必须在>"}`,
      ];
  return { need, kinds, lines, templates };
}

/**
 * ★★★ **落卡 + 按快照还原 decision.expectations**（2026-10-23 · 两段式领取的**回滚**那一半）。
 *
 * ## 为什么必须是一个函数、一次 saveDSL（判据 B / C 的共同地基）
 * 「把判据写回去」与「把卡退回 candidate」若分两次落盘，中间崩掉就得到
 * **判据已还原、卡还在 preparing**（或反之）—— 而 `preparing` 的快照是**唯一**的还原依据，
 * 那一格一旦丢了，谁都不知道该退回什么。⇒ 两步写在**同一份内存副本**里，`saveDesignSheet` 只调一次。
 *
 * ★ 还原是**逐字**的（`snapshot.expectations` 原样写回 `decision.expectations`），
 *   不是"删掉这次新增的"—— 后者要判"哪些是新增的"，而判据没有 id，判不出来（这是本仓反复踩的坑）。
 * ★ 没有 `decision` 的节点 ⇒ **抛**（不当成"还原成功"）：快照本身就是从 decision 拍的，
 *   它不在说明节点被删过，静默放过会让"零残留"变成一句空话。
 */
function writeTaskAndRestoreSnapshot(
  feature: string,
  nodeId: string,
  next: TaskSpec,
  snapshot: PreparedSnapshot,
): void {
  assertCardWritable(nodeId, next);
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 在落盘前读不到 ⇒ 不写（绝不静默降级）。`);
  let nextDsl = withCardWritten(dsl, nodeId, next);
  const nodes = (nextDsl.geometry?.nodes ?? []).map((n) => {
    if (n.id !== nodeId) return n;
    if (!n.decision) {
      throw new Error(
        `回滚被拒：节点 "${nodeId}" 现在**没有 decision**（快照是从 decision 拍的）⇒ 无法把判据写回。` +
          `★ 这不是"还原成功"：先确认节点没被删/没被重建，再手工处理 —— 工具不假装做了。`,
      );
    }
    return { ...n, decision: { ...n.decision, expectations: snapshot.expectations } };
  });
  nextDsl = { ...nextDsl, geometry: { ...nextDsl.geometry!, nodes } };
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
  saveDesignSheet(applyOverlay(nextDsl, ov));
}

/**
 * 判据在 `since` **之后**换过吗 —— `publish` 结清重开账的唯一判据。
 *
 * ★ 为什么不能像以前那样「卡上那份 vs decision」：任务格已不自持判据（`TaskSpec` 无该字段）
 *   ⇒ 「换了没换」只能与 **decision 自己的上一版**比；现成的上一版 = `decision_history`
 *   （`applyDecisionWrite` 每次更新把旧决策压栈；栈顶 = 刚被换掉的那一版）。
 * ★ 取 `since` 之后的**第一条**历史：它的 `.decision` 就是 `since` 那一刻的决策样子
 *   （第一条更新的前一版）；`since` 之后没有任何更新 ⇒ 现在的 decision 就是那版。
 */
function criteriaChangedSince(
  node: { decision?: { expectations?: Expectation[] }; decision_history?: DecisionHistoryEntry[] },
  since: string | null | undefined,
): boolean {
  if (!since) return false;
  const later = (node.decision_history ?? []).filter((h) => h.at > since);
  if (!later.length) return false;
  return canonCriteria(later[0].decision?.expectations ?? []) !== canonCriteria(node.decision?.expectations ?? []);
}

/**
 * 判据集合的**规范形态**（按键名排序的 JSON，逐条一行）。
 * ★ 「判据是否换过」（`criteriaChangedSince`，与 `decision_history` 比）与「判据的输入指纹」（`fingerprintEvidence`）**共用这一把尺** ——
 *   分叉的后果是"换了判据"和"指纹没变"各说一套，而那正是证据失效判据的根。
 */
function canonCriteria(xs: readonly unknown[]): string {
  return xs
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return JSON.stringify(
        Object.keys(o)
          .sort()
          .map((k) => [k, o[k]]),
      );
    })
    .join('\n');
}

/**
 * 现算一组文件的**代码指纹**（`covers` = 调用方给的文件集 —— ★ 本函数**不发明覆盖关系**）。
 *
 * ★ 读盘、不读 `cache.db`：`files.content_hash` 可能是旧值（索引陈旧），而"证据还作数吗"
 *   必须按**此刻的磁盘**判 —— 与 `intent/expectations.ts#indexStaleFor` 同一把尺（都走 `contentHash`）。
 * ★ 读不到的文件记 `ABSENT_FILE_HASH`（不是跳过）：跳过去会让"被覆盖的文件被删了"伪装成"没变"。
 */
export function codeFingerprintAt(root: string, rels: readonly string[]): { code: string; covers: string[] } {
  const abs = path.resolve(root);
  const entries = [...new Set(rels)].map((rel) => {
    let hash = ABSENT_FILE_HASH;
    try {
      hash = contentHash(fs.readFileSync(path.join(abs, rel.split('/').join(path.sep)), 'utf-8'));
    } catch {
      /* 读不到 ⇒ 保留占位（意图在常量名里，不静默跳过） */
    }
    return { path: rel, hash };
  });
  return codeFingerprintOf(entries);
}

/**
 * 给「这一条证据」算指纹（四件里除"输出"之外的三件 —— ★ **输出就是顶层 `verdict`**，不重复落）。
 *
 * ## 覆盖集**只能从判据本身算**
 * `covers` = 这张卡所有判据点名的文件（`expectationPaths`，含 `edge-*` 的对端 —— 对端变了判定也可能翻）。
 * ★ 这是**现成的口径**，不是"这套测试覆盖哪些文件"的猜测：后者在 npm 生态里**算不出来**
 *   （没有覆盖率数据就没有映射）⇒ 算不出来时**不填** `code`，由读端判 `unverifiable`；
 *   拿"全仓指纹"或"空集"冒充会分别变成**零增量**和**假有效**，两个都比"说不知道"坏。
 *
 * @param sourceRoot 被分析项目的根（feature 的 `source_root`）；缺省 ⇒ 只算 `what` / `input`
 */
export function fingerprintEvidence(
  expectations: readonly Expectation[],
  sourceRoot: string | undefined,
  nodeId: string,
  ev: EvidenceWhatSource,
): TaskEvidenceFingerprint {
  const exp = expectations;
  const what =
    ev.kind === 'expectations'
      ? `judgeExpectations:${nodeId}（${exp.length} 条判据）`
      : ev.kind === 'reading'
        ? // ★ 2026-10-23：`command` 在**读端**可能是缺的（历史证据 / 白名单上线前的记录）——
          //   缺就写清“没记”，不拿 `` 冒充“跑了个空命令”。`what` 不参与 `evidenceFreshness` 的比较。
          ev.command ?? 'reading（未记命令原文）'
        : `attestation:${ev.by}`;
  const base: TaskEvidenceFingerprint = { what, input: fingerprintOf([canonCriteria(exp)]) };
  const covers = [...new Set(exp.flatMap((e) => expectationPaths(e)))];
  const root = typeof sourceRoot === 'string' && sourceRoot.trim() ? sourceRoot : null;
  if (!covers.length || !root) return base;
  const { code, covers: sorted } = codeFingerprintAt(root, covers);
  return { ...base, code, covers: sorted };
}

/**
 * ★★★ 2026-10-23（增量测试 · 选量）：**这条证据现在还要不要重跑** —— `evidenceFreshness` 的第一个读端。
 *
 * ## 它回答的问题
 * 「`covers` 这批文件 ⇒ 该重跑哪些证」。给定卡上已有的证据逐条问“还作数吗”，分三桶：
 * `skip`（按设计**不重跑**）· `rerun`（要重跑）· `unknown`（**不知道** ⇒ 必须重跑）。
 *
 * ## ★★ 为什么 `unknown ⊆ rerun`（不是第四个“通过”桶）
 * `unverifiable` = 没有指纹（历史证据）或覆盖集算不出。单列出来是**为了读数**（让人看见
 * “这批里有多少是当年没记指纹”），但**不许**停在“不跑”那一侧 —— 那正是卡上写死的判据：
 * 「`unverifiable` 必须进 `rerun` —— 否则历史证据会永远冒充通过」。
 *
 * ## ★★★ 复用的三个条件（少一个都不许 skip）
 * ① `evidenceFreshness === 'valid'` —— 判据指纹 / 代码指纹 / 覆盖集三样都与此刻相同
 *    （**唯一判据**；本函数不自比、不重定义“什么算变了”）；
 * ② 这张卡必须是 **L2**（`postExpectations` 非空）—— 因为**只有 L2 的 `complete` 会跑 `isSatisfied`**
 *    （见本文件 L1220 那张两级表：L1 的收口判据是「DSL 建构完整」，**一条判据都没判过**）。
 *    ⇒ 证据档是 `reading` 还是 `attestation` **不影响**：只要这张卡是 L2，那条证据就是
 *    “`isSatisfied` 全绿之后落的”，它的 `code` 就是“判过的那版代码”。
 *    ★ 反过来，L1 卡的证据哪怕指纹一字不差也**不可复用** —— 它的“完成”本来就不含判据结论。
 * ③ 覆盖集上的**索引**不许陈旧（`indexStaleFor`）—— 依判据只看索引；代码一字未改而索引旧，
 *    重判会红、复用会把它**藏起来**（假绿）。
 *
 * ## 它**不是**第二套“受影响集合”
 * 覆盖集只有一处定义：写指纹时 `fingerprintEvidence` 用 `expectationPaths` 算出的 `covers`；
 * 本函数**现算**也调同一个 `fingerprintEvidence`（不重算路径、不另写 sha1）⇒
 * “写进去的指纹”与“用来比的指纹”天然同一把尺。
 * `opts.changed` 只用来**标**“覆盖集里哪几个文件在本次改动里”（读数用），**不参与判定**。
 */
export type EvidencePlanBucket = 'rerun' | 'skip' | 'unknown';

/** 规划的一行（★ 每个字段都能直接读，不要求读端回查卡） */
export interface EvidencePlanItem {
  card_id: string;
  node_id: string;
  /** 证据档（`expectations` / `reading` / `attestation`）—— 决定能不能复用的第二条件 */
  kind: TaskEvidenceRecord['kind'];
  at: string;
  /** ★ 唯一判据的读数（`evidenceFreshness` 的返回值，不在本文件重算） */
  freshness: EvidenceFreshness;
  bucket: EvidencePlanBucket;
  /** 记录里的覆盖集（★ 空 = 当年没记 ⇒ 复算不了） */
  covers: string[];
  /** 覆盖集里**落在本次改动**的那几个（`opts.changed` 给了才有；★ 只做读数，不进判据） */
  hits: string[];
  why: string;
}

/** 规划的一行输入：一张卡 + 它的判据 + 它的证据（★ 判据只从 `decision` 现取，不从卡上副本取） */
export interface EvidencePlanCard {
  id: string;
  feature?: string;
  node_id: string;
  expectations: readonly Expectation[];
  evidence?: readonly TaskEvidenceRecord[];
}

/**
 * `fingerprintEvidence` 建 `what` 所需的**最小输入**（不是整套证据）。
 *
 * ★ 2026-10-23（选量）：本函数现在有**两个**调用方 —— 写端（`complete`）手里是 `ProgressEvidence`，
 *   读端（`planEvidenceRerun`）手里只有落盘的 `TaskEvidenceRecord`。两者形状不同、需要的三个字段相同
 *   ⇒ 参数按需收窄；否则读端只能**重造**一条假 `ProgressEvidence`（那是“为了过类型编数据”）。
 */
export type EvidenceWhatSource = {
  kind: ProgressEvidence['kind'];
  command?: string;
  by?: 'human' | 'llm';
};

/**
 * 把一批卡上的证据分成 `skip` / `rerun` / `unknown`。
 *
 * @param root 被分析项目的根（feature 的 `source_root`）；缺省 ⇒ 全判 `unverifiable`（不静默当有效）
 * @param cards 卡 + 判据 + 证据
 * @param opts.changed 本次改动文件（★ 只做 `hits` 读数）
 */
export function planEvidenceRerun(
  root: string | undefined,
  cards: readonly EvidencePlanCard[],
  opts?: { changed?: readonly string[] },
): { rerun: EvidencePlanItem[]; skip: EvidencePlanItem[]; unknown: EvidencePlanItem[] } {
  const changed = new Set((opts?.changed ?? []).map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')));
  const atRoot = typeof root === 'string' && root.trim() ? root : null;
  const rerun: EvidencePlanItem[] = [];
  const skip: EvidencePlanItem[] = [];
  const unknown: EvidencePlanItem[] = [];
  for (const c of cards) {
    const recs = c.evidence ?? [];
    // ★ 没证据 ⇒ 没有可选的东西（既不“有效”也不“要重跑”，不能凭空造一行）
    if (!recs.length) continue;
    // ★ 只看**最新一条**（证据是压栈的：newest last）
    const rec = recs[recs.length - 1];
    const covers = [...(rec.fingerprint?.covers ?? [])];
    const hits = covers.filter((p) => changed.has(p));
    // ★★ 现算 = 写端那一把尺（`fingerprintEvidence`）：不另算覆盖集 / 不另算输入指纹
    let current: { code: string; covers: readonly string[]; input?: string } | null = null;
    if (atRoot) {
      const fp = fingerprintEvidence(c.expectations, atRoot, c.node_id, rec);
      if (fp.code && fp.covers?.length) current = { code: fp.code, covers: fp.covers, input: fp.input };
    }
    const freshness = evidenceFreshness(rec, current);
    let bucket: EvidencePlanBucket;
    let why: string;
    if (freshness === 'unverifiable') {
      bucket = 'unknown';
      why = !atRoot
        ? '没给 root ⇒ 覆盖集算不出来（★ 不许当有效）'
        : !rec.fingerprint?.code || !covers.length
          ? '当年没记代码指纹（`fingerprint.code`/`covers` 缺）⇒ 不知道还算不算数（★ 不许当有效）'
          : '此刻算不出代码指纹（判据没点名文件 / 文件全读不到）⇒ 不知道还算不算数';
    } else if (freshness === 'stale') {
      bucket = 'rerun';
      why = '判据换了 / 代码动过 / 覆盖集变了 ⇒ 这条读数属于**旧代码**';
    } else if (postExpectations(c.expectations).length === 0) {
      bucket = 'rerun';
      why = '指纹相同，但这张卡没有**后态判据**（L1 建构卡）⇒ 收口只判过「DSL 建构完整」，判据一条没判 ⇒ 不能复用';
    } else {
      const stale = atRoot ? indexStaleFor(atRoot, covers) : '没有 root';
      if (stale) {
        bucket = 'rerun';
        why = `指纹相同，但索引与源码不一致 ⇒ 重判会读到旧事实：${String(stale).split('\n')[0]}`;
      } else {
        bucket = 'skip';
        why = '判据指纹 + 代码指纹 + 覆盖集三样都与此刻相同，且索引不陈旧 ⇒ 按设计不重跑';
      }
    }
    const item: EvidencePlanItem = {
      card_id: c.id,
      node_id: c.node_id,
      kind: rec.kind,
      at: rec.at,
      freshness,
      bucket,
      covers,
      hits,
      why: c.feature ? `[${c.feature}] ${why}` : why,
    };
    if (bucket === 'skip') skip.push(item);
    else rerun.push(item);
    if (bucket === 'unknown') unknown.push(item);
  }
  return { rerun, skip, unknown };
}

/**
 * ★★★ **重开账本闸**（`complete` 侧；`reopen` 是借方，这里是贷方）。
 *
 * ## 判据（一条）
 * `reopened_at == null` ⇒ 放行；否则必须满足其一：
 *  · 输入的 evidence 是 `reading` / `attestation`，且 `at` **不早于** `reopened_at`；
 *  · （`publish` 真换了判据 ⇒ 写盘时已把 `reopened_at` 置 `null`，走不到这里。）
 *
 * ## ★ 为什么 `kind:'expectations'` 不算新证据（这不是苛刻，是白洞的定义）
 * 这一档是**机器判**、**没有调用方时间戳**，它的内容恒等于"卡上这些判据现在全绿"——
 * 而重开**不改判据** ⇒ 只要旧活做完过，它**必然**全绿，与"这次干没干活"无关。
 * ⇒ 拿它当重开后的收口证据 = 把旧判据再跑一遍 = 白洞本身。
 *
 * ★ `at` 是调用方给的 ⇒ 本闸挡的是"零动作"，挡不住"存心伪造时间戳"（如实声明）。
 */
function reopenGate(
  card: TaskSpec,
  evidence: ProgressEvidence | undefined,
): { ok: true } | { ok: false; reason: string } {
  const reopenedAt = card.reopened_at;
  if (!reopenedAt) return { ok: true };
  const at = evidence && (evidence.kind === 'reading' || evidence.kind === 'attestation') ? evidence.at : undefined;
  const t = at ? Date.parse(at) : NaN;
  const r = Date.parse(reopenedAt);
  if (Number.isFinite(t) && Number.isFinite(r) && t >= r) return { ok: true };
  return {
    ok: false,
    reason:
      `这张卡重开于 ${reopenedAt}，此后判据没换、也没有一条 at ≥ 该时刻的证据 ⇒ 现在收口只是把**旧判据**再跑一遍。` +
      `\n★ 两条正路：① 改 decision 再 \`publish\`（带 data.reason ⇒ 原地换判据，账即结清）；` +
      `② \`complete\` 带 \`reading\` / \`attestation\`，且 data.evidence.at 不早于 ${reopenedAt}。` +
      `\n★ \`kind:'expectations'\` 在重开未结清时**不算新证据**：它没有时间戳，内容就是"旧判据仍然全绿" —— 而那正是本闸堵的白洞。` +
      (at
        ? `\n★ 实得 evidence.at=${at}（${Number.isFinite(t) ? '解析成功但早于重开时刻' : '不是合法时间'}）。`
        : `\n★ 实得 evidence.kind=${evidence?.kind ?? '（无）'}（这一档没有调用方时间戳）。`),
  };
}

// ─────────────────────────────────────────────────────────────
// publish（立卡 = 翻决策卡）
// ─────────────────────────────────────────────────────────────

/**
 * 立卡（`∅ → candidate`）：**两级**（`task_plan.two_level_tasks` + `publish_rule.corrected`）。
 *
 * ## ★★★ 为什么这一条从"拒"改成"L1 建构卡"（2026-10-17 · 闸原则：`.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle`）
 * 旧判据（T12）：`没有 decision / 没有 expectations / 只有前态判据 ⇒ 一律拒`。
 * ★ 用户 2026-10-17 的原话与裁定（`two_level_tasks.why_needed` 逐字）：
 *   "**第一个 decision 从哪来？**" —— 拒的这条**把第一个决策卡也挡在门外** = 鸡生蛋 = 环。
 * ⇒ 现在按**两级**分：
 *   · **L1 建构卡**（无 decision / decision 太粗 = **没有后态判据**）：
 *     ★ 判据 = **DSL 建构完整**（不是代码跑通）；★ 卡上 **0 条期望**（★ **不编实现判据**）；
 *   · **L2 实现卡**（有可判的后态判据）：`summary` + `expectations` **逐字来自 decision**（旧行为不变）。
 * ★ "哪一级"**不是落盘字段**，是派生值（`task_schema.ts#taskLevel`：有 post 判据 ⇒ L2）。
 *
 * ## L1 卡的内容从哪来（★ 不许凭空造）
 * `summary` **只**由这四样里**已有的**拼：
 *   ① `semantic.files[id].responsibility`（本仓的"语义层"，最像"这是干什么的"）·
 *   ② `node.title` / `node.label`（且 `label !== id` —— 自动生成的 label 等于 id，不算内容）·
 *   ③ 文件名（`node.path` / `semantic.files[].path` / file|doc 节点的 `description`）·
 *   ④ `node.id`（**最后兜底**）。
 * ★ 若 ①~③ **一个都没有** ⇒ 卡上只有 id，并在 `discussion.open` 里**如实写明**：
 *   "要做什么需要用户/我手写一句『我要实现什么』（**本工具不编**）"。
 * ★ 同时把"出处"写进 `discussion.micro`（`summary` 是从哪一格读来的）—— 让"卡的内容可对拍"。
 *
 * ## 已有任务格时
 * · `state === 'candidate'`（没人领）⇒ **重翻**（用当下的 decision 覆盖）—— 决策改了，卡要跟上；
 * · `state === 'done'` 且**旧卡是 L1** ∧ 现在够得上 L2 ⇒ **升一级**（L1 干完了，正路是出 L2 卡）；
 *   ★ 旧卡的 `evidence` **逐条搬进新卡**（`TaskSpec` 没有卡片历史 —— 不静默丢证据）；
 * · `state === 'claimed'` **且带 `data.reason`** ⇒ **原地换判据**（2026-10-20）：
 *   ★ 只换 `summary` + `expectations`；`state` / `owner` / `claimed_at` / **`evidence`** / `discussion` 全部保留。
 *   ★ 为什么要有它：`done` 的卡改判据原先要走 `reopen → release → 改 decision → publish → claim`
 *     五步，其中 `release` / `claim` **纯为过校验**（publish 只认 candidate、写闸只认 claimed）；
 *     而那条路上 publish 会**重建**卡 ⇒ 旧 `evidence` 静默丢失。现在 `reopen → 改 decision → publish`
 *     三步，且证据一条不丢。
 *   ★ 边界：不带 `reason` ⇒ 拒（改动要有理由）；新 decision 没有后态判据（= L1）⇒ 拒
 *     （claimed 卡换成一 0 条判据的 L1 ⇒ `complete` 判"建构未完成"、只能 release 回 candidate 重来）。
 * · 其余（L2 已 done / void / …）⇒ **拒**：覆盖会把"已完成/已作废"的判据换掉。
 *
 * ★ 本函数**不写 progress**：`node.status` 是 `task.state` 的派生值（`progressOf`），
 *   落盘时由 `applyOverlay` 投影（candidate ⇒ draft）。
 */

/** L1 卡的 `summary` 出处（人读一句话；进 `discussion.micro`，让"内容来自哪"可对拍） */
interface ConstructBasis {
  summary: string;
  source: string;
  /** 缺什么（空数组 = 至少有 ①~③ 之一）。非空 ⇒ 原话进 `discussion.open` */
  missing: string[];
}

/**
 * ★ L1 建构卡的 `summary` **只**从既有字段拼（见函数上方的 ①~④），**一个字的实现判据都不编**。
 */
function constructBasis(
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>,
  node: { id: string; type?: string; label?: string; title?: string; path?: string },
): ConstructBasis {
  const sem = (dsl.semantic?.files ?? []).find((f) => f.id === node.id);
  const resp = (sem?.responsibility ?? '').trim();
  const title = (node.title ?? '').trim();
  // ★ 自动生成的 label 等于 id（`addNode` 的 `label || node_id`）⇒ 它不携带任何信息，不算"内容"
  const label = (node.label ?? '').trim();
  const labelUsable = label && label !== node.id ? label : '';
  // ★ T-#37：回落 `description` 的分支已删（`Node.description` 不存在）
  const filePath = (node.path ?? '').trim() || (sem?.path ?? '').trim();
  const where = filePath ? `（${filePath}）` : '';
  const what = resp || title || labelUsable;
  if (what) {
    const source = resp
      ? `semantic.files["${node.id}"].responsibility`
      : (node.title ?? '').trim()
        ? `node.title`
        : `node.label`;
    return { summary: `【L1 待建构】${what}${where} ← 节点 ${node.id}`, source, missing: [] };
  }
  return {
    summary: `【L1 待建构】节点 ${node.id}${where}`,
    source: 'node.id（★ 没有 semantics / title / 有意义的 label / 文件名可依）',
    missing: [
      `节点 ${node.id} 上**没有任何可用的"这是干什么的"**（semantic.files[].responsibility / title / label / 文件名皆无）` +
        ` ⇒ 卡上只有 id。**要做什么需要用户/我手写一句"我要实现什么"**（★ 本工具不编）。`,
    ],
  };
}

/**
 * ★★ **L1 的验收判据**（`two_level_tasks.L1_construct`）：**DSL 建构完整**，不是代码跑通。
 *
 * 判据逐字来自设计 DSL 的 `L1_construct.output` = "**可判的期望** / 节点 / 边（… + **至少一条 expectation**）"
 * ⇒ 机器可判的形态只有两条（且都在**该节点的 decision** 上，不在卡上）：
 *   ① `decision.summary` 非空（"我要实现什么"说清楚了）；
 *   ② `decision.expectations` 里**至少一条后态判据**（`phase='post'` —— 否则建出来的卡仍领不了）。
 * ★ 这是**同一个判据的正反两面**：publish/claim 说"还没建好"、complete 说"建好了"，用的是同一个函数。
 */
function constructionVerdict(
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>,
  nodeId: string,
): { complete: boolean; missing: string[]; post: number } {
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  const decision = node?.decision;
  const hasSummary = typeof decision?.summary === 'string' && decision.summary.trim().length > 0;
  const post = postExpectations(decision?.expectations ?? []);
  const missing: string[] = [];
  if (!hasSummary) missing.push('决策卡的 `summary` 还是空的（"我要实现什么"没有一句结论）');
  if (!post.length) {
    missing.push(
      `决策卡没有**后态判据**（phase=post）：现有 ${decision?.expectations?.length ?? 0} 条` +
        `${(decision?.expectations?.length ?? 0) > 0 ? '（全是前态/或形状不对）' : '（一条都没有）'}`,
    );
  }
  return { complete: missing.length === 0, missing, post: post.length };
}

export function publishTask(input: TaskOpInput): EditResult {
  const { feature, node_id } = input;
  const dsl = getDesignSheet(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在 —— 任务格住在设计 DSL 的节点上，先有 feature 才有家。`);
  }
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === node_id);
  if (!node) {
    throw new Error(
      `节点 "${node_id}" 不在 feature "${feature}" 的 geometry.nodes 里 —— 立卡的对象是**节点**，找不到节点就没有决策卡可翻。`,
    );
  }

  // ★★★ 2026-10-22（迁移第②步）：**读权威**（`todos[]` 有它的卡就用那张；没有才回落 `node.task` 投影）。
  const existing = taskOfNode(node, dsl.todos);
  /**
   * ★★ 2026-10-20：**已领卡的原地换判据**（`reopen` 之后的正路）。
   * ★ 判据只需两条：`state === 'claimed'` ∧ 带 `reason`（改动要有理由）。
   * ★ 它只换 `summary` + `expectations` —— 其余字段（含 `evidence`）**逐条保留**。
   */
  const onClaimed = existing?.state === 'claimed';
  /** ★ 2026-10-23：两段式第一段的卡（`preparing`）—— 允许 publish **只刷 summary**，见下面的分支 */
  const onPreparing = existing?.state === 'preparing';
  const reason = (input.reason ?? '').trim();

  // ★★★ publish 的输入**没有内容**：内容只能来自 decision。`owner/evidence` 是别的 action 的参数，
  //   对 publish 无意义 ⇒ 显式拒，别让它们被静默忽略（"你以为生效了、其实没有"）。
  //   ★ `reason` 是例外，但**只在 claimed 原地换判据时**才被接受（它是"为什么换"的理由，不是卡的内容）。
  const extra = [
    input.owner !== undefined ? 'owner' : '',
    input.reason !== undefined ? 'reason' : '',
    input.evidence !== undefined ? 'evidence' : '',
  ].filter(Boolean);
  const notAccepted = extra.filter((k) => !(k === 'reason' && onClaimed));
  if (notAccepted.length) {
    throw new Error(
      `publish 被拒（不接受 data）：收到 data.${notAccepted.join(' / data.')} —— ★ 立卡的内容**只能**来自该节点的 \`decision\`。\n` +
        `★ 领任务请走 \`op:'claim'\`（data.owner 是**那个** action 的参数）；立卡这一步没有可填的字段。` +
        (notAccepted.includes('reason')
          ? `\n★ \`data.reason\` **只在**已领（state=claimed）的卡上被接受（原地换判据要说明为什么改）；` +
            `当前 state=${existing?.state ?? '（该节点上没有任务格）'} ⇒ 不收。`
          : ''),
    );
  }

  const decision = node.decision;
  const hasSummary = typeof decision?.summary === 'string' && (decision?.summary ?? '').trim().length > 0;
  const expectations = decision?.expectations ?? [];
  const post = postExpectations(expectations);
  // ★★ 级别是**派生值**（`taskSchema.ts#taskLevel` 同一把尺）：有后态判据 ⇒ L2；否则 ⇒ L1 建构卡。
  const level: 'L1' | 'L2' = hasSummary && post.length > 0 ? 'L2' : 'L1';

  // ★ 为什么是 L1（点名原因 —— 旧版这三条是"拒"，现在改成"建档卡并说明为什么不是 L2"；
  //   ★ 信息一点不丢，只是不再把流程堵死）。
  const whyL1 = !hasSummary
    ? `节点 "${node_id}" 上**没有决策卡可翻**（\`decision.summary\` 为空/缺失）`
    : !expectations.length
      ? `节点 "${node_id}" 的决策卡**没有判据**（\`decision.expectations\` 为空）⇒ 翻成 L2 也**无法验收**`
      : `节点 "${node_id}" 的决策卡只有**前态判据**（\`phase='pre'\`，如 edge-absent）：现有 ${expectations.length} 条、` +
        `后态判据（\`phase='post'\`）**0 条** ⇒ 翻成 L2 的卡**必然不可领取**（\`cardStanding\` 对空集给 unknowable）`;

  // 已有任务格：只允许 ① 重翻 candidate ② L1(done) ⇒ L2 升一级 ③ claimed + reason ⇒ 原地换判据
  let advance = false;
  let refresh = false;
  if (existing && existing.state !== 'candidate' && existing.state !== 'preparing') {
    advance = existing.state === 'done' && taskLevel(expectations) === 'L1' && level === 'L2';
    refresh = onClaimed && reason.length > 0;
    if (onClaimed && !refresh) {
      throw new Error(
        `publish 被拒：节点 "${node_id}" 上有一张 **state=claimed** 的任务卡` +
          (existing.owner ? `（owner=${existing.owner}）` : '') +
          ` —— 换掉它的判据等于把"正在做的活"换了验收标准，必须说明为什么。\n` +
          `★ 确实要换 ⇒ 带上 \`data.reason\`：\`{ type:'task', op:'publish', id:'${node_id}', data:{ reason:'…' } }\`\n` +
          `  这样只换 \`summary\` + \`expectations\`；state / owner / claimed_at / **evidence** 全部保留。`,
      );
    }
    if (!advance && !refresh) {
      throw new Error(
        `publish 被拒：节点 "${node_id}" 上已有一张 state=${existing.state} 的任务卡` +
          (existing.owner ? `（owner=${existing.owner}）` : '') +
          `（级别 ${taskLevel(expectations)}） —— 覆盖它等于把"已完成/已作废"的判据换掉。\n` +
          `★ 允许重翻 \`candidate\`（无人领取）；★ 允许 **L1 已 done 且现已达到 L2** ⇒ 升一级；` +
          `★ 允许 **claimed 带 \`data.reason\`** ⇒ 原地换判据。\n` +
          (existing.state === 'done'
            ? `★ 换这张**已完成（L2）**卡的判据的正路：\`reopen\`（带 owner + reason）→ 改 \`decision\` → ` +
              `\`publish\`（带 data.reason；原地换判据，evidence 逐条保留）。`
            : `★ state=${existing.state} 不可换判据 —— ` +
              `要重做请先 \`relaunch\`（带 reason，void → candidate），再改 \`decision\`、\`publish\`；` +
              `★ 不必另开节点（节点 id 就是文件）。`),
      );
    }
    if (refresh && level === 'L1') {
      throw new Error(
        `publish 被拒（原地换判据会得到一张收不了口的卡）：节点 "${node_id}" 的 decision 现在**没有后态判据**` +
          `（phase='post' 0 条）⇒ 换上去的是一张 0 条期望的 L1 卡，而它 state 仍是 claimed ⇒ ` +
          `\`complete\` 走 L1 尺会判"建构未完成"，先 release 回 candidate 才能重来。\n` +
          `★ 怎么办：先给 decision 补至少一条相位 post 的判据（如 \`file-exists\`），再 publish。`,
      );
    }
  }

  const nextSummary = decision?.summary ?? '';
  /**
   * ★ 这次 publish 是否**真的换了判据**（重开账结清要靠它）。
   * ★ 判据住 decision（卡不自持）⇒ “换了没换” = 「重开那一刻的 decision」vs「现在」，
   *   上一版从 `decision_history` 现取（`criteriaChangedSince`）；summary 仍与卡上那份比（summary 仍是副本）。
   */
  const sameAsCard = existing
    ? (existing.summary ?? '') === nextSummary && !criteriaChangedSince(node, existing.reopened_at)
    : false;

  /**
   * ★★★ 2026-10-23（两段式领取的配套）：**准备中的卡也能被 `publish` 刷新**。
   *
   * ## 为什么非要开这一格
   * 第一段期间干的活就是"改 `decision`" —— 而改完 decision 的正路是 `publish`（把卡对齐 decision）。
   * 若 publish 见到 `preparing` 就拒，那就等于**要人绕回 candidate 再重新领**，
   * 而绕回 candidate 的那一步（`release`）会把判据**按快照还原掉** ⇒ 刚补的判据被自己抹了。
   *
   * ## ★ 它与 candidate 的「重翻」**不是**同一件事
   * candidate 重翻是**整卡重建**（新建一个 candidate 卡，owner/快照全没有）——
   * 对 preparing 那么做等于**把事务账本丢了**（快照没了 ⇒ 放弃时无从还原）。
   * ⇒ 这里只换 `summary`，**state / owner / claimed_at / prepared_snapshot 全部原样留着**。
   */
  if (onPreparing) {
    writeTask(feature, node_id, {
      ...existing!,
      summary: nextSummary,
      judge_gate: 'strict',
    });
    const nowPost = postExpectations(expectationsOf(node)).length;
    return {
      message:
        `已刷新**准备中**任务 "${node_id}"（state=preparing 不变，owner=${existing?.owner ?? '（空）'}）：` +
        `summary 已按 decision 重写；当前后态判据 ${nowPost} 条` +
        (nowPost > 0 ? ` ⇒ 可以 \`start\`（第二段）了` : ` ⇒ 还差后态判据，\`start\` 仍会被拒`) +
        `\n★ 事务账本**没动**：\`prepared_snapshot\` 原样留着（放弃时按它逐字还原），owner / claimed_at 也没动。` +
        `\n★ 与 candidate「重翻」的区别：那个是整卡重建（快照会丢失），这个只换 summary。`,
      feature,
      data: {
        node_id,
        level,
        state: 'preparing' as TaskState,
        summary: decision?.summary ?? '',
        post_expectations: nowPost,
        refreshed: true,
        progress: progressOf({ state: 'preparing' }),
      },
    };
  }

  if (level === 'L2') {
    // ★★ 已领卡的**原地换判据**：只换 summary + expectations，其余逐条保留（★ 尤其 evidence）。
    if (refresh) {
      // ★★★ 重开账：`publish` 是唯一的结清口 ⇒ "换了等于没换"必须拒（否则结清作废、缺陷照旧）。
      if (existing?.reopened_at && sameAsCard) {
        throw new Error(
          `publish 被拒（重开账未结清）：节点 "${node_id}" 的卡**重开于 ${existing.reopened_at}**，` +
            `而这次 decision 的 summary + ${expectations.length} 条判据与卡上**逐字相同** ⇒ 换了等于没换。\n` +
            `★ 要么真改 decision（summary 或至少一条判据），要么别用 publish 结账 —— ` +
            `直接给一条带时间的新证据（\`reading\` / \`attestation\`，at 不早于 ${existing.reopened_at}）再 complete。`,
        );
      }
      const kept = existing?.evidence ?? [];
      writeTask(feature, node_id, {
        ...existing!,
        summary: nextSummary,
        // ★ 判据真换了 ⇒ 重开账结清（旧判据的"绿"不再算这次工作的证据）
        ...(existing?.reopened_at ? { reopened_at: null } : {}),
      });
      return {
        message:
          // ★ 首行自足（回执只透出首行）
          `已原地换判据任务 "${node_id}"（state=claimed 不变，owner=${existing?.owner ?? '（空）'}）：` +
          `summary 已按 decision 重写；判据本就住 decision（${expectations.length} 条已是生效值），evidence ${kept.length} 条**逐条保留**。\n` +
          `★ 理由：${reason}\n` +
          `★ 只换 \`summary\`；判据不搬家（唯一住处 = decision）；state / owner / claimed_at / evidence / discussion 全保留 —— ` +
          `这正是它比"release → publish → claim"少两步、又不丢证据的原因。\n` +
          `★ 内容来源 = \`geometry.nodes[${node_id}].decision\`（summary 逐字 + expectations 逐字）。\n` +
          `★ 进度派生：task.state=claimed ⇒ progress=in_progress。下一步直接执行 → \`complete\`（写闸只认 claimed，已就位）。`,
        feature,
        data: {
          node_id,
          level: 'L2',
          state: 'claimed' as TaskState,
          owner: existing?.owner ?? null,
          summary: decision?.summary ?? '',
          expectations: expectations.length,
          post_expectations: post.length,
          evidence_kept: kept.length,
          refreshed: true,
          progress: progressOf({ state: 'claimed' }),
        },
      };
    }

    const refreshed = !!existing;
    writeTask(feature, node_id, {
      id: node.id,
      // ★★ 逐字来自决策卡（不裁剪、不改写、不拼 acceptance）—— 这样"卡的内容来自哪里"可对拍
      summary: decision?.summary ?? '',
      state: 'candidate',
      // ★★★ 2026-10-23：`publish` 是**判据门的盖章处** —— 从此新立的卡判据空就不许直接 claim
      judge_gate: 'strict',
      // ★ L1 ⇒ L2 升级：旧 L1 卡的证据**逐条搬进新卡**（TaskSpec 无卡片历史 ⇒ 不静默丢证据）
      ...(advance && existing?.evidence?.length ? { evidence: existing.evidence } : {}),
      // ★★★ 重开账：candidate 重翻是**整卡重建**（下面的字段就是全部）⇒ 若判据与旧卡逐字相同，
      //   必须把账带过去；否则 `reopen → release → publish → claim → complete` 就绕开了 complete 的闸。
      ...(existing?.reopened_at && sameAsCard ? { reopened_at: existing.reopened_at } : {}),
    });

    return {
      message:
        `${advance ? '已升级为 L2 实现卡' : refreshed ? '已重翻' : '已立卡'}任务 "${node_id}"：**从该节点的决策卡翻出** ` +
        `${expectations.length} 条判据（其中后态 ${post.length} 条可领判定）。\n` +
        `★ 级别 = **L2 实现卡**（有可判的后态判据 ⇒ 验收看"对拍红变绿"）。\n` +
        `★ 内容来源 = \`geometry.nodes[${node_id}].decision\`（summary 逐字 + expectations 逐字）—— ` +
        `publish 不收任何手写描述。\n` +
        (advance ? `★ 上一张 L1 建构卡的 \`evidence\` 已逐条搬进本卡（不静默丢）。\n` : '') +
        `★ 进度是**派生值**：task.state=candidate ⇒ progress=draft（不落第二份）；` +
        `下一步 \`{ op:'claim', data:{ owner } }\` 才能开工（闸只认 claimed）。\n` +
        `★ 榜单显示不靠抄表：board 应当**读**「对拍的红 + 设计 DSL 里现有的 task 格」派生（T8，未建）。`,
      feature,
      data: {
        node_id,
        level: 'L2',
        state: 'candidate' as TaskState,
        summary: decision?.summary ?? '',
        expectations: expectations.length,
        post_expectations: post.length,
        refreshed,
        ...(advance ? { advanced_from: 'L1' } : {}),
        progress: progressOf({ state: 'candidate' }),
      },
    };
  }

  // ── L1 建构卡（★ 0 条期望：L1 的验收不看对拍，看"DSL 建构完整"）──────────────────
  const basis = constructBasis(dsl, node);
  const discussion: TaskDiscussion = {
    micro: `L1 建构卡 · summary 出处：${basis.source}`,
    ...(basis.missing.length ? { open: basis.missing } : {}),
  };
  writeTask(feature, node_id, {
    id: node.id,
    summary: basis.summary,
    // ★ 不落判据：L1 的判据是"DSL 建构完整"（`constructionVerdict` 读 decision）——
    //   这里**不编**一条实现判据，也不再往卡上写空副本（判据唯一住处 = decision）。
    state: 'candidate',
    // ★★★ 2026-10-23：L1 卡也盖章 —— L1 的活正是「去把判据建起来」，它才是两段式的主战场
    judge_gate: 'strict',
    // ★ L1 ⇒ L2 之外的重翻：若旧卡是 L1（candidate）也不带证据（从没被 complete 过）；带上更安全。
    ...(existing?.evidence?.length ? { evidence: existing.evidence } : {}),
    discussion,
  });

  return {
    message:
      // ★★★ 首行必须自足：`edit_dsl` 的回执**只透出首行**（其余行进 `data`/被丢弃，实测）。
      //   所以"级别 / 0 条期望 / 不编判据 / 缺什么"全放首行，后面的行只是展开。
      `${existing ? '已重翻' : '已立卡'}任务 "${node_id}" —— 级别 = **L1 建构卡**` +
      `（**0 条期望**：判据 = **DSL 建构完整**，**不是代码跑通**；★ 不编实现判据）：${whyL1}` +
      (basis.missing.length ? `。★★ 缺"要做什么"：需要用户/我手写一句"我要实现什么"（本工具不编）` : '') +
      `\n★ summary 出处：${basis.source} ⇒ ${JSON.stringify(basis.summary)}\n` +
      (basis.missing.length ? `★★ ${basis.missing.join('\n★★ ')}\n` : '') +
      `★ 做完 L1 = 给该节点写决策卡（summary + 至少一条相位 post 的 expectation），再 \`complete\`；` +
      `之后再 \`publish\` 就会翻成 **L2 实现卡**（旧的 L1 证据会带过去）。\n` +
      `★ 进度派生：task.state=candidate ⇒ progress=draft。卡**住在 \`todos[]\`**（带 \`node_id\` 指向该节点）；\`geometry.nodes[].task\` 只是**派生投影**（读端不认它）。`,
    feature,
    data: {
      node_id,
      level: 'L1',
      state: 'candidate' as TaskState,
      summary: basis.summary,
      summary_source: basis.source,
      expectations: 0,
      post_expectations: 0,
      missing: basis.missing,
      refreshed: !!existing,
      progress: progressOf({ state: 'candidate' }),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// claim
// ─────────────────────────────────────────────────────────────

/**
 * 领取（`candidate → claimed`）。
 *
 * guard（逐条照 `task_plan.state_machine.transitions[t_claim]`）：
 *  ① `isClaimable(cardStanding(card), intent)`（★ 本函数内直接调用 —— 不把"记得先判"留给调用方）；
 *     ★ 读的是**五值读数里的"可领"两格**（`work` / `violated`），**不是**"判据全过"。
 *     ★★ `satisfied` 卡的处置**由意图决定**（2026-10-20）：
 *        · 缺省 `intent='work'` ⇒ **必拒**（没活干不许领）—— 这条与 `complete` 的判据**分开**：
 *          收口侧读 `isSatisfied`，两侧同源（都读 `cardStanding`）但**不是同一个谓词**；
 *          ★ 这一句**只说 L2 卡**：L1 两侧读的是**另一个**函数 `constructionVerdict`
 *            （与 `cardStanding` 是**两把尺**，各自显式命名 —— 见下面「L1 建构卡」那段）；
 *        · `intent='modify'` ⇒ **放行**（判据已全过，但文件要改：改判据 / 重构 / 改注释）——
 *          ★ 放行的是**写权**，不是"这张卡又有活了"：回执逐字写"本次是【修改】不是【补红】"。
 *     ★ 为什么不能只靠 reopen：`t_reopen` 只从 `done` 起跳；`candidate` + `satisfied` 既领不了、
 *        也没有 reopen 可走 ⇒ 那张卡指向的文件**谁也改不了**（2026-10-20 实测：改一行注释都不行）。
 *  ② CAS：`state === 'candidate'` ∧ `owner` 为空 ⇒ 就地写；`state === 'done'` ⇒ 走**重开**（见下节）；
 *     `claimed`（别人的在办活）/ `void`（**已宣布弃做**）⇒ **拒**（不覆盖别人的领，也不复活弃掉的卡；
 *     ★ 判据本身**没作废**，它仍在 decision —— 拒的理由是「这活已被宣布不做」，不是「判据坏了」）；
 *  ③ 写 `owner` + `claimed_at`（`releaseIfExpired` 的 TTL 靠它）。
 *
 * ## ★★★ `done` 卡：重开式领取（2026-10-20 · 第二笔）
 * `done` 的卡不是「不能用」，而是「上一轮已结账」。判据：
 * **已完结不许锁文件 —— 它要能像没下过任务的文件一样，继续被下一个任务承载。**
 * ⇒ `state === done` 时 `claim` = **`t_reopen` + `t_claim`**（一步对外，两步对内）：
 *   · **不新造状态迁移**：`done → claimed` 本来就只有 `t_reopen` 一条，复用它；
 *   · `reason` 必填（`t_reopen` 的 guard 第 4 条）；
 *   · `intent=modify` 不判判据（重开不改判据）；`intent=work` 仍判（没红可修 ⇒ 拒；退化了 ⇒ 放行）；
 *   · owner 换手 + `reopened_from` / `reopen_reason` 记账，`evidence[]` 原样保留。
 * ★ `void` **不走这条路**（见 `relaunchTask`）：它只能 `relaunch` 回 candidate 再走 claim ——
 *   写权不从"复活一张弃做的卡"来（判据仍在 decision，但拿一件不做了的活的验收去写盘 = 自欺）。
 *
 * ## ★★★ L1 建构卡为什么不走 `cardStanding`（2026-10-17）
 * L1 卡 `expectations: []` ⇒ `cardStanding` 必给 **`unknowable`**（空集不按全过算）⇒ 若照②拒，
 * **L1 卡永远领不了** = 把"生成 L1 卡"这道口子又堵回去（同一个环的另一种形态）。
 * ★ L1 的"有没有活"是**另一把可判的尺**（不是放宽标准，是换对尺）：
 * **DSL 建构完整吗？** 不完整 ⇒ 有活（可领）；已完整 ⇒ 没活（拒，并指向 publish 出 L2）。
 * 判据唯一出处 = `constructionVerdict`。
 *
 * ## ★★★ 两把尺的分工（2026-10-22 运行时取证，`certs/t359`）
 * | 卡 | claim 侧 | complete 侧 | 尺 |
 * |---|---|---|---|
 * | **L1**（decision 没有 post 判据） | `constructionVerdict().complete === false` ⇒ 可领 | `constructionVerdict().complete === true` ⇒ 可收口 | **同一把**（方向相反） |
 * | **L2**（有 post 判据） | `isClaimable(cardStanding(card))` | `isSatisfied(card)` = `cardStanding === 'satisfied'` | 同一个读数、两个谓词 |
 * ⇒ 所以**不是**"claim 用一把、状态判定用另一把"：**每一级内部两侧用同一把**；
 *   跨级才是两把尺（`constructionVerdict` vs `cardStanding`），各自显式命名、不互相冒充。
 * ★ 已知结构性风险（**不在本段**）：选哪把尺由 `taskLevel`（**派生值**）决定 ⇒ 给 decision 补一条
 *   post 判据就当场从 L1 变 L2 —— 交接流待裁，见 `todo_l1-l2-handoff-gap`。
 */
export async function claimTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const ownerRaw = (input.owner ?? '').trim();
  if (!ownerRaw) {
    throw new Error(
      'claim 需要 `data.owner`（领取者身份）—— CAS 写的就是它；★ 工具**不替你编一个身份**（那是伪造）。' +
        (input.agent ? `\n★ 你本次已经传了顶层 \`agent: '${input.agent}'\` ⇒ 把它原样填进 \`data.owner\` 即可。` : ''),
    );
  }
  // ★★★ 2026-10-21（并发控制·账户）：**写进卡里的新值也过同一套规范** ——
  //   「历史不追改，新值必须合规」：老卡上的 owner 原样留着（写闸比对时按等价折算，见 `write_gate`），
  //   但从**这一刻起**写进去的 owner 一律是 `<kind>:<name>`。
  //   ★ 归一化留痕：`data.owner='workbuddy'` ⇒ 落盘 `agent:workbuddy`，并在回执里明说（下面 message 那段）。
  //   ★ STRICT 下老格式**不猜**、直接拒（`admitActor` 给正确写法）。
  const ownerAdm = admitActor(ownerRaw, null, { strict: actorStrictMode() });
  if (!ownerAdm.ok || !ownerAdm.actor) {
    throw new Error(
      `${ownerAdm.error ?? `✗ claim 被拒：\`data.owner\` 不合法（收到 ${JSON.stringify(ownerRaw)}）`}` +
        `\n★ 这套规范同样管 \`data.owner\` —— claim 写进去的就是它，写闸之后拿它和本次 \`actor\` 比。`,
    );
  }
  const owner = ownerAdm.actor;
  // ★★★ 2026-10-20（**写闸授权检查**（内部编号 `A7`）闭环 · c）：**actor 与 owner 必须一致**。
  //
  // ## 补的是什么洞
  // 写闸授权检查在写侧摊：“卡 owner ≠ 本次 actor ⇒ 拒”。但**领卡侧根本没看 actor** ——
  // 顶层 `agent` 只拿去署名（decision.agent / released_by / evidence.agent），
  // owner 只从 `data.owner` 来 ⇒ ⇒ **两个人可以用同一个 actor 各自领卡、或帮别人领一卡**，
  // 写闸那条判据就变成一个“自己跟自己比”的空转。
  // ⇒ 领卡这一步就对：**你只能说“我是谁”**，不能说“这张卡是他的”。
  //
  // ## 为什么只在“两个都给了且不一致”时拒
  // · 只给 owner、没给 agent（老调用方）：行为**不变**（自报体系下“不报”仍是合法用法，只是写闸授权检查在写侧
  //   就只能“提醒 + 放行”）—— ★ 一刀切会把现有工作流全卡死。
  // · 只给 agent、不给 owner：**不派生**（`data.owner` 仍是必填，见 `op_data_spec` 的
  //   `required.claim`）；派生的代价是改那份契约，收益只是少写一个键。
  // ★ 2026-10-21：顶层 `agent` 与 `data.owner` 用**同一套规范**再过一遍（两边归一化之后才比）。
  //   ★ 比用的是 `sameActor`（等价），不是逐字 —— `agent='workbuddy'` + `owner='agent:workbuddy'`
  //     描述的是同一个人，不该在这里被判成"替别人领卡"。
  const actorAdm = admitActor(input.agent ?? '', null, { strict: actorStrictMode() });
  if (!actorAdm.ok) {
    throw new Error(`${actorAdm.error}\n★ 顶层 \`agent\` 与 \`data.owner\` 是**同一套规范**（两者会被拿来互相核对）。`);
  }
  const actor = actorAdm.actor ?? '';
  if (actor && !sameActor(actor, owner)) {
    throw new Error(
      `claim 被拒（A7）：本次调用的身份 \`actor\`（顶层 agent）= **${actor}**，` +
        `而你要写进去的 \`data.owner\` = **${owner}** —— 两者不一致。\n` +
        `★ 为什么拦：写闸核对的是“卡的 owner 是不是**你**”；允许替别人领卡，A7 就成了空转。\n` +
        `★ 怎么办：\`data.owner\` 填 \`${actor}\`（你自己的身份）；要替别人领，就让对方自己领。`,
    );
  }
  const { dsl, card } = loadTask(feature, node_id);
  /** ★ 判据现取的落点：卡挂的那个节点（todo 卡没有节点 ⇒ 0 条判据） */
  const cardNode = (dsl.geometry?.nodes ?? []).find((n) => n.id === node_id);
  /**
   * ★★★ 2026-10-23（两段式领取 · **第一段 = 领了但不能干**）。
   *
   * ## 判据（三条，缺一不可）
   * ① 有节点（`todo` 卡结构上没有挂判据的地方 ⇒ 不适用）；
   * ② 该节点的**后态判据 0 条**（有一条就够开工 ⇒ 一段式）；
   * ③ 这张卡是 `judge_gate='strict'`（`publish` 之后新立的）——
   *    ★ 存量卡不走这条（迁移期规则，见 `TaskSpec.claimed_without_judge` 那段）。
   *
   * ## 为什么 ② 是「后态判据」而不是「判据条数」
   * 一张卡可以只有 `edge-absent`（前态）：它**还没施工就天然成立** ⇒ `cardStanding` 会给
   * `unknowable`（后态空集不按全过算）⇒ 那种卡**根本领不了**（constructionVerdict 也说没建完）。
   * ⇒ "判据空"的准确含义 = **后态判据 0 条**（`postExpectations`，与 level / cardStanding 同一把尺）。
   */
  const twoPhase =
    !!cardNode &&
    card.state === 'candidate' &&
    card.judge_gate === 'strict' &&
    postExpectations(expectationsOf(cardNode)).length === 0;
  // ★★★ 2026-10-21：`state=claimed` 单独立一条报文（默认的“没有 claimed→claimed 迁移”不指路）。
  //   ★ 判据：**重复 claim 不幂等**。claim 是一次**事件**（写 `claimed_at`）—— 放过重领就等于
  //     悄悄**重置租约**：TTL 回收再也看不见“这个人其实已经停了”，`releaseIfExpired` 变成装饰。
  //   ★ 要换读集（这一轮要碰的东西变了）⇒ 先 `release` 再 `claim`：读集**覆盖**重算（不是追加）。
  /**
   * ★★★ **接管痕迹**（2026-10-22 · 租约熔断）。
   * 只有"卡是 claimed 但租约已过期"这一种情况会填；落盘时写进 task，供审计。
   */
  let takeover: { from_owner?: string; from_claimed_at: string; age_hours: number | null } | undefined;
  if (card.state === 'claimed') {
    // ★★★ 2026-10-22 用户裁定（熔断）：**租约到期 ⇒ 视为无主，允许接管**。
    //   用户原话：*「正常的互联网的租约不是过了一段时间会自己断掉的吗？…要不然 agent 一直不回报，
    //            那岂不是任务一直卡别人的线程」*
    //   ★ 实测现场：29 个文件节点被 10~27h 前的租约锁着，锁住 write_gate/edit_code/server_registry ⇒ 全仓改不动。
    //   ★ 纪律：接管**不静默** —— 旧 owner / 旧 claimed_at / 挂了多久，全部写进 task（`taken_over_from`）。
    const nowMs = Date.now();
    if (isLeaseExpired(card, nowMs)) {
      takeover = { from_owner: card.owner ?? undefined, from_claimed_at: card.claimed_at ?? '', age_hours: leaseAgeHours(card, nowMs) };
    } else {
      const alreadyMine = !!card.owner && sameActor(card.owner, owner);
      throw new Error(
        `claim 被拒（这张卡**已经在办**）：节点 "${node_id}" 的 state=claimed，` +
          `owner=${card.owner ?? '（空）'}，claimed_at=${card.claimed_at ?? '（无）'}，` +
          `已挂 ${leaseAgeHours(card, nowMs) ?? '?'}h（租约 ${Math.round(LEASE_TTL_MS / 3.6e6)}h 未到期）。\n` +
          (alreadyMine
            ? '★ 它**已经在你自己手上** —— 重复 claim **不幂等**：放过它就等于**重置租约**' +
              '（`claimed_at` 会被刷新，TTL 回收再也看不见真正的停工）。\n' +
              '★ 怎么办：① 直接继续执行；② 这一轮**要动的符号/文件变了**（读集要换）⇒ 先 `release` 再 `claim`，' +
              '读集会被**重算并覆盖**（不是追加）。\n'
            : '★ 这是**别人的在办活**（A7：卡不是你的）⇒ 等它到期（到期后**任何 agent 都能接管**，' +
              '接管会记 `taken_over_from`），或等它 `release` / `complete`。\n') +
          '★ 另：`claimed → claimed` 本来就不在迁移表里（唯一住处 `domain/task_machine.ts#TRANSITIONS`）。',
      );
    }
  }
  // ★ 租约已过期的 claimed 卡 ⇒ **语义上等于 candidate**（无主），不按 claimed→claimed 拦
  // ★ 两段式的第一段是 candidate → **preparing**（不是 claimed）—— 目标态由判据决定，不在这里写死
  if (!takeover) assertTransition(card.state, twoPhase ? 'preparing' : 'claimed', 'claim');

  // ★★ 领取**意图**（2026-10-20）：缺省 `work` ⇒ **老调用方的行为逐字不变**。
  //   ★ 运行期守卫：JSON 里的值不可信（`op_data_spec` 只查"键认不认"，不查枚举）。
  const rawIntent = (input.intent ?? 'work') as string;
  if (rawIntent !== 'work' && rawIntent !== 'modify') {
    throw new Error(
      `claim 被拒（intent 非法）：${JSON.stringify(input.intent)} —— 只认 work / modify：work=有活要补红（缺省）；modify=判据可以全过，来改文件、取写权。`,
    );
  }
  const intent: ClaimIntent = rawIntent;

  /**
   * ★★★ 2026-10-20（第二笔）：`done` 卡的**重开式领取** = `t_reopen` + `t_claim`。
   *
   * ## 为什么要它
   * 规则：**任务完结不锁文件** —— 文件要能像没下过任务一样，继续被下一个任务承载。
   * 上一笔只放开了 `candidate + satisfied`（`intent=modify`）；`done` 卡在**更外层的 CAS** 就被拦下，
   * `intent` 根本没被读到 ⇒ 那 4 个文件的注释仍然改不了。
   *
   * ## 形态（★ 不新造状态迁移）
   * `done → claimed` 本来就只有 `t_reopen` 一条 ⇒ 这里**复用它**：guard 照旧（`reason` 必填），
   * 只是把「重开」与「领取」并成**一次对外**的调用。
   * ★ 审计一分不丢：`evidence[]` 逐条保留（上一轮干过什么）、`reopened_from` 记原 owner、
   *   `reopen_reason` 记为什么又开、`reopened_at` 记账本借方（`reopenGate` 仍要求新证据）。
   */
  const reopening = card.state === 'done';
  const reopenReason = (input.reason ?? '').trim();
  if (reopening && !reopenReason) {
    throw new Error(
      `claim 被拒（重开缺理由）：节点 "${node_id}" 的任务格已是 state=done（上一轮 owner=${card.owner ?? '（空）'}）` +
        ` ⇒ 领取它 = **重开**（t_reopen + t_claim 一步完成），必须带 \`data.reason\`（为什么又开）。\n` +
        `★ 这是有意的一条闸：无理由的重开等于把「完成」当摆设（t_reopen 的 guard 第 4 条）。\n` +
        `★ 上一轮的 evidence（${(card.evidence ?? []).length} 条）会原样保留；新账另起（reopened_at / reopen_reason / reopened_from）。\n` +
        `★ 只是要改这个文件（改判据 / 重构 / 改注释）⇒ \`data:{ owner:'<你>', reason:'…', intent:'modify' }\`。`,
    );
  }

  // ── L1 建构卡：可领性看「DSL 建构完整吗」，不看对拍 ───────────────────────────
  const level = taskLevel(expectationsOf(cardNode));
  let levelNote: string;
  /** L2 的站位读数（L1 没有它 —— 不伪造成 `work`：那是把"判不了"读成"有活"） */
  let claimStanding: CardStanding | undefined;
  if (twoPhase) {
    // ★ 两段式：**不判"有没有活"** —— 这一段要回答的问题不是"能否施工"，而是"验收标准在不在"。
    //   顺序是有意的：判据都没有的时候，`constructionVerdict` / `cardStanding` 的读数只会误导
    //   （前者说"建构未完成"想让你去写 DSL，后者对空集给 unknowable）⇒ 先解决判据。
    levelNote =
      `★ 两段式第一段：判据（后态）0 条 ⇒ 进 **preparing（领了不能开工）**，` +
      `判据已按快照存档（放弃/超时会逐字还原）；补齐后 \`start\` 才进 claimed`;
  } else if (reopening && intent === 'modify') {
    // ★ 不判判据：与 t_reopen 一致（重开不改判据，也不拿判据决定能不能重开）。
    //   ★ 若这里再判一次，节点后来退化成 blocked / unknowable 就会把文件重新锁上 —— 那正是本条要拆的锁。
    //   ★ 安全不靠它：`reopened_at` 已记账本借方 ⇒ 想再 done 必须给**新**证据或真换判据（`reopenGate`）。
    levelNote =
      `站位=未判（done 卡重开）；★ 本次是【修改】不是【补红】—— 上一轮已完成（evidence ${(card.evidence ?? []).length} 条保留），` +
      `这一步 = t_reopen + t_claim：取的是**写权**（改判据 / 重构 / 改注释），不是「又有活干了」；收口仍走 complete 的 isSatisfied`;
  } else if (level === 'L1') {
    const c = constructionVerdict(dsl, node_id);
    if (c.complete) {
      throw new Error(
        `claim 被拒（L1 无活可干）：节点 "${node_id}" 的 **DSL 已经建构完整**` +
          `（decision.summary 有、后态判据 ${c.post} 条）⇒ 这张 L1 建构卡没有活。\n` +
          `★ 下一步是 \`publish\`（现在会翻成 **L2 实现卡**，旧的 L1 证据会带过去），不是领取该卡。`,
      );
    }
    levelNote =
      `★ 级别 = **L1 建构卡**：可领性判据 = **DSL 建构完整吗**（不看对拍）—— 当前**不完整**` +
      `（${c.missing.join('；')}）⇒ 有活可干。`;
  } else {
    const root = requireRoot(dsl as { source_root?: string });
    // ★★ 判据复用（不新造第二把尺）：`cardStanding` 按 phase 分区 + `judgeExpectations` 判 + 派生五值。
    //   ★ 判据由**这里**从节点 decision 现取（唯一住处）；`cardStanding` 不读卡。
    const standing = await cardStanding(card, expectationsOf(cardNode), {
      root,
      nodes: dsl.geometry?.nodes ?? [],
      judge: judgeExpectations,
    });
    if (!isClaimable(standing.standing, intent)) {
      throw new Error(
        `claim 被拒（可领性：${standing.standing}）：${standing.reason}\n` +
          `★ 可领判据唯一出处 = src/domain/task_machine.ts#isClaimable（work / violated 恒可领；` +
          `satisfied 只在 intent=modify 时可领；blocked / unknowable 连 modify 也拒）。
` +
          (standing.standing === 'satisfied'
            ? `★ 你是来**修改**这个文件（改判据 / 重构 / 改注释）⇒ 同一调用加 data.intent:modify —— ` +
              `判据已全过，claim 取的是**写权**，不是"又有活干了"。`
            : ''),
      );
    }
    // ★★ 回执**必须区分意图**：否则读端分不清"这次领到的是红"还是"写权"（用户 2026-10-20 的要求）。
    levelNote =
      intent === 'modify' && standing.standing === 'satisfied'
        ? `站位=satisfied；★ 本次是【修改】不是【补红】（判据 ${standing.satisfaction.passed} 条全过 —— ` +
          `claim 取的是**写权**：改判据 / 重构 / 改注释都走这条路；收口仍走 complete 的 isSatisfied）`
        : `站位=${standing.standing}；${standing.reason}`;
    claimStanding = standing.standing;
  }

  // ★ CAS（单写者队列下等价于"读到的还是那张 candidate 卡"）：不满足 ⇒ 拒，不抢别人的领。
  //   ★ 2026-10-20：`done` 走的是**重开**（`t_reopen`），不是"抢别人的在办活"——
  //     上一轮的 owner 只记进 `reopened_from`。
  //   ★★★ 2026-10-22（租约熔断）：`takeover` 有值 ⇒ 那张 claimed 卡的**租约已过期** ⇒
  //     **视为无主**，这一步放行。★ 不这么改，上面分支里写的"允许接管"就是装饰 ——
  //     真正的门在这里（实测：改完分支仍然被这句 CAS 拦死，是证抓出来的）。
  const casOk = reopening || !!takeover || (card.state === 'candidate' && !card.owner);
  if (!casOk) {
    throw new Error(
      `claim 被拒（CAS）：节点 "${node_id}" 的任务格已是 state=${card.state} / owner=${JSON.stringify(card.owner ?? null)} —— ` +
        `只在 state=candidate ∧ owner 为空时就地写；state=done 走【重开】（带 reason）；` +
        `state=claimed 是别人的在办活（★ 租约 ${Math.round(LEASE_TTL_MS / 3.6e6)}h 内不可夺，到期后任何人可接管并记 taken_over_from）；` +
        `state=void 先 relaunch。`,
    );
  }

  // ── ★★★ 读集比对（2026-10-21 · 并发控制）：**claim 时**现算 + 与其他活跃卡对照，相交即**拒领** ──
  //
  // 判据（唯一住处 = `application/claim_conflict.ts` 文件头）：
  //   · 读集怎么算：`data.read_set` 显式声明（最准）→ 卡上判据点名的符号 → 节点自己的文件（兜底）；
  //   · 与谁比：**同一 `source_root`** 的所有 feature 里 `state=claimed` 的卡（排除自己）；
  //     符号交集或文件交集 ⇒ 拒。
  // ★ 为什么拦在这里是安全的：**还没开工**，拒了没有任何工作被丢掉 —— 这正是它与写前
  //   `assumption_check`（**只报**）强度不同的原因（成本不对称，不是风格差异）。
  // ★ 每一次 claim 都**重算一遍**并**覆盖**落卡（用户 2026-10-21：「读集只取最后一次」）。
  const sourceRoot = String(dsl.source_root ?? '').trim();
  let readSet: TaskReadSet | undefined;
  let claimConflict: ClaimConflictReport | undefined;
  let conflictNote: string;
  if (!sourceRoot) {
    conflictNote =
      '★ 该 feature 没有 `source_root` ⇒ 读集算不出来，也**没有可对照的项目** ⇒ 本次**不做**读集冲突检测' +
      '（这是“未比对”，不是“无冲突”）。';
  } else {
    const computed = computeClaimReadSet({
      root: sourceRoot,
      cardId: node_id,
      node: cardNode,
      declared: input.read_set,
    });
    readSet = computed.readSet;
    const active = collectActiveClaims(sourceRoot, { feature, id: node_id });
    claimConflict = detectClaimConflicts(readSet, active.claims, active);
    if (claimConflict.conflicts.length) {
      // ★ **强制**，不降级成“提醒 + 放行”：那等于把并发控制关掉。
      throw new Error(claimConflictMessage(claimConflict, readSet));
    }
    conflictNote = claimConflictLine(claimConflict, readSet);
  }

  // ★ 首行自足：`edit_dsl` 的批量回执**只印 `message` 的第一行**（`update_feature.ts`）⇒
  //   “比了几张卡 / 读集多大 / 有没有没比的卡”必须挤进首行，否则读回执的人看不见（= 假绿灯）。
  const readHead = readSet
    ? `；读集 ${readSet.symbols.length} 符号 / ${readSet.files.length} 文件` +
      `（依据 ${readSet.basis.join('+') || '空'}），与 ${claimConflict?.checked ?? 0} 张活跃卡对照**无相交**` +
      (claimConflict?.unchecked.length ? `（另 ${claimConflict.unchecked.length} 张活跃卡无读集、这次未比对）` : '')
    : '；★ 读集**未算**（该 feature 没有 source_root）';

  // ★★★ P0 保鲜链第 4 环（2026-10-26）：claim 时**带出**索引可信度提醒（不拒领）。
  //   untrusted（陈旧断言>0）⇒ find_references / impact 正在静默漏报，领卡人该知道；
  //   判定与阈值全部复用 `index_integrity` 现有函数（唯一住处在那边）。无索引 / trusted / 异常 ⇒ 空串不加噪声。
  const integrityReminder = sourceRoot ? indexTrustReminderForClaim(sourceRoot) : '';
  const integrityNote = integrityReminder ? `\n★ 提醒：${integrityReminder}` : '';

  if (twoPhase) {
    // ── 两段式第一段：落 preparing + 快照（★ 判据**不动**：这一段不写 decision，只记账）──
    const gap = criteriaGap(dsl, cardNode, node_id);
    const at = new Date().toISOString();
    writeTask(feature, node_id, {
      ...card,
      state: 'preparing',
      owner,
      claimed_at: at,
      // ★★★ 事务的快照：改之前的 expectations **逐字**存一份（`start` 删、`release`/`expire` 还原）
      prepared_snapshot: { expectations: expectationsOf(cardNode), at, missing: gap.lines },
      read_set: readSet,
      release_reason: undefined,
      released_by: undefined,
      released_at: undefined,
    });
    return {
      message:
        // ★ 首行自足（`edit_dsl` 批量回执只印首行）—— ★ 判据 D 的读数就在这一行里：
        //   哪个节点 / 缺几条 / 哪几类 / 下一步是什么，全在首行，读回执的人不必再问一遍。
        `已领取但**不能开工**（preparing）任务 "${node_id}"（owner=${owner}）：` +
        `该节点的**后态判据 0 条** ⇒ 先给 ${node_id} 补 **${gap.need} 条**（${gap.kinds.join(' + ')}）再 start；` +
        `判据已按快照存档（放弃/超时会**逐字还原**）` +
        `\n★ **缺什么（照做清单）**：\n` +
        gap.lines.map((l) => `  · ${l}`).join('\n') +
        `\n★ **可直接粘的模板**（只差你填 \`<…>\` 那几处）：\n` +
        gap.templates.map((t, i) => `  ${i + 1}) ${t}`).join('\n') +
        `\n★ 为什么不在 claimed：\`write_gate\` 只认 \`state=claimed\` ⇒ preparing 期间**拿不到写权**` +
        `（这就是"已领取但不可开工"的机制形态，不是靠谁记得拦）。判据写进 \`decision\` 走 \`edit_dsl\`，不受写闸管。` +
        `\n★ 租约：preparing 也持租约（TTL 同 claimed）⇒ 你未按期收口（租约到期）时，\`expire\` 会**还原判据**并退回 candidate。` +
        readHead +
        integrityNote,
      feature,
      data: {
        node_id,
        level,
        state: 'preparing' as TaskState,
        owner,
        claimed_at: at,
        intent,
        snapshot_expectations: expectationsOf(cardNode).length,
        missing: {
          node_id,
          need: gap.need,
          kinds: gap.kinds,
          lines: gap.lines,
          templates: gap.templates,
        },
        next: `edit_dsl { type:'task', op:'start', id:'${node_id}', data:{ owner:'${owner}' } }`,
        progress: progressOf({ state: 'preparing' }),
      },
    };
  }

  /**
   * ★★★ 2026-10-23（**迁移期规则**）：存量卡（`publish` 盖 `judge_gate` 之前立的）判据空也**放它领**，
   * 但落 `claimed_without_judge` + 回执里**响亮警告**。
   *
   * ## 为什么不能一刀切（这条有实测读数，不是妥协）
   * 2026-10-22 盘点：candidate 137 张里 **117 张（85%）判据 0 条**。
   * 一刀切 = 这 117 张**同时不可领** = 与今早「29 个文件被租约锁死」**同效**（用户点名的病）。
   * ⇒ 硬约束只对**新立的卡**生效（`judge_gate='strict'`，由 `publish` 盖章）；
   *   存量卡**留痕但不拦**：账上能查到"这张卡是在没有判据的情况下开工的"，
   *   收口那一步照样要过 `complete` 的判据闸（该红还是会红）。
   */
  const legacyGap =
    !!cardNode && postExpectations(expectationsOf(cardNode)).length === 0 && card.judge_gate !== 'strict'
      ? criteriaGap(dsl, cardNode, node_id)
      : undefined;
  const claimedAt = new Date().toISOString();
  writeTask(feature, node_id, {
    ...card,
    state: 'claimed',
    owner,
    claimed_at: claimedAt,
    // ★ 存量卡的免检痕迹（不是豁免：收口照旧要过判据闸）
    ...(legacyGap
      ? { claimed_without_judge: { at: claimedAt, missing: legacyGap.lines } }
      : {}),
    // ★★★ 2026-10-22：**接管痕迹**（只有"上一任租约过期"才有）—— 不静默接手别人的活
    ...(takeover ? { taken_over_from: takeover } : {}),
    // ★ 读集**覆盖**写回（不是 append）；`undefined` ⇒ 不留下一次 claim 的幽灵占位
    read_set: readSet,
    // ★★ 2026-10-20：`done` 卡的**新账另起** —— 只写这一轮的「从谁手里、为什么开」；
    //   上一轮的 `evidence[]` / `summary` / `expectations` 由 `...card` **逐条原样带过来**（不重建卡）。
    ...(reopening
      ? {
          reopened_at: claimedAt,
          reopen_reason: reopenReason,
          reopened_from: card.owner ?? null,
        }
      : {}),
    // 新的一次领 ⇒ 上一次的释放痕迹不再是"当前状态"（保留原因会让"为什么现在有人领"读起来自相矛盾）
    release_reason: undefined,
    released_by: undefined,
    released_at: undefined,
  });

  return {
    message:
      // ★ 首行自足（回执只透出首行）—— ★★ 2026-10-21：`edit_dsl` 的批量回执只印 `result.message` 的第一行
      //   （见 `update_feature.ts`）⇒ "已归一化"这件事必须落在**首行**，否则就是"库里悄悄改了、
      //   调用方没被告知"（正是本仓禁的静默兜底）。
      `已领取任务 "${node_id}"（owner=${owner}` +
      (ownerAdm.normalizedFrom ? `，★ 已归一化自 \`${ownerAdm.normalizedFrom}\`` : '') +
      `，claimed_at=${claimedAt}）—— ${levelNote}` +
      // ★★★ 迁移期：存量卡免检必须**在首行说出来**（`edit_dsl` 只印首行 ⇒ 写在第 2 行等于没说）
      (legacyGap
        ? `；★★ 警告（存量卡·判据为空）：后态判据 0 条 ⇒ **放行**（迁移期不拦，已落 claimed_without_judge），要补 ${legacyGap.need} 条（${legacyGap.kinds.join(' + ')}）`
        : '') +
      `${readHead}` +
      // ★★★ 迁移期：存量卡免检也要**说出来**（静默放行 = 假绿灯）
      (legacyGap
        ? `\n★★ **警告（存量卡·判据为空）**：该节点的**后态判据 0 条**，而这张卡是 \`judge_gate\` 之前的存量卡 ⇒ ` +
          `放行开工（**不拦**，否则 117 张存量卡会同时不可领）。已落 \`claimed_without_judge\`。` +
          `\n★ 要补的话：**${legacyGap.need} 条**（${legacyGap.kinds.join(' + ')}）；收口时 \`complete\` 仍会按判据闸判（不会因为这条记录放绿）。`
        : '') +
      // ★★★ 2026-10-22（链 C）：留痕**只有一份实现** —— `actor_spec.ts#normalizedActorNote`（`invokeTool` 用的就是它）。
      //   ★ 这里原先手抄了同一段文案 ⇒ 两处文案一改就漂（本仓最贵的病是「第二份判据/第二份留痕」）。
      normalizedActorNote(ownerAdm) +
      `\n★ 进度是**派生值**：task.state=claimed ⇒ progress=in_progress（不落第二份）。` +
      (reopening
        ? `\n★ 这是**重开**（done → claimed = t_reopen + t_claim）：上一轮 owner=${JSON.stringify(card.owner ?? null)} 记进 \`reopened_from\`；` +
          `\`reopened_at\`=${claimedAt}、\`reopen_reason\` 已记；上一轮 evidence ${(card.evidence ?? []).length} 条**逐条保留**。` +
          `\n★ 收口时 \`reopened_at\` 已在账 ⇒ 要么真换判据（\`publish\` 带 reason），要么给一条 at ≥ ${claimedAt} 的 \`reading\` / \`attestation\`。`
        : level === 'L1'
          ? `\n★ L1 收口判据 = **DSL 建构完整**（给该节点写 decision.summary + 至少一条 phase=post 的 expectation），` +
            `\`complete\` 也是用这同一把尺判。`
          : '') +
      // ★★ 读集读数**必须在首行之后**出现：它回答「这次有没有真的比过」（比了 0 张 ≠ 谁都不冲突）
      `\n${conflictNote}` +
      // ★★★ P0 保鲜链第 4 环：索引 untrusted ⇒ 提醒行（非空才追加；**不拒领**）
      integrityNote,
    feature,
    data: {
      node_id,
      level,
      state: 'claimed' as TaskState,
      owner,
      claimed_at: claimedAt,
      intent,
      ...(claimStanding ? { standing: claimStanding } : {}),
      // ★ 重开这一轮的可对拍读数（不必再读卡就知道「从谁手里、为什么开」）
      ...(reopening
        ? { reopened: true, reopened_from: card.owner ?? null, reopened_at: claimedAt, reopen_reason: reopenReason }
        : {}),
      progress: progressOf({ state: 'claimed' }),
      // ★★★ P0 保鲜链第 4 环：机读提醒（非空才有；判定与文案唯一住处 = `indexTrustReminderForClaim`）
      ...(integrityReminder ? { index_trust: integrityReminder } : {}),
      // ★★★ 2026-10-21（并发控制·读集比对）：**独立字段**，别与写前的 `assumption_check` 混。
      //   `assumption_check` = 「我读的东西变了吗」（写前，只报）；`claim_conflict` = 「我要碰的东西被占了吗」（领卡，阻塞）。
      claim_conflict: {
        checked: claimConflict?.checked ?? 0,
        unchecked: claimConflict?.unchecked ?? [],
        features: claimConflict?.features ?? [],
        ...(readSet
          ? {
              read_set: {
                symbols: readSet.symbols.length,
                files: readSet.files.length,
                basis: readSet.basis,
                computed_at: readSet.computed_at,
                ...(readSet.note ? { note: readSet.note } : {}),
              },
            }
          : { skipped: 'no-source-root' }),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────
// release
// ─────────────────────────────────────────────────────────────

/**
 * 释放（`claimed → candidate`）。
 *
 * guard：state 必须是 `claimed`；**必须带 reason**（`t_release`：显式 release 事件带 by + reason）。
 * ★ `releaseIfExpired` 只**产出事件**、不静默改 state（那是它的纪律）；真改 state 的只有这里。
 */
/**
 * ★★★ **续租**（`renew` · 2026-10-22 用户裁定）
 *
 * ## 为什么必须是**独立的 op**，不是"再 claim 一次"
 * 用户问过：*「如果再做的话，就续租应该也是可以的呀」* —— 对，但**不能复用 claim**：
 * `claim` 会**重算并覆盖读集**（`read_set`），而续租的语义只是"我还在，别收回"，
 * 它不该改动「这一轮要碰什么」。⇒ 一个只刷时间戳的 op。
 *
 * ## 三条必须拒的
 * 1. `state !== 'claimed'` ⇒ 没在办，无从续
 * 2. **不是你的卡** ⇒ 别人不能替你续命（`sameActor` 折算，与写闸授权检查同一套）
 * 3. **租约已经过期** ⇒ **不许自己续活** —— 那是熔断的反面（过期后唯一的出路是 `claim` 接管，
 *    接管会记 `taken_over_from`，留痕）。
 *
 * ★ 与"自己重复 claim 也被拒"的关系：重复 claim 会被拒（不幂等），但 **`renew` 是合法路径** ——
 *   这是 2026-10-22 用户追问后补的（原契约把两件事都堵死了，等于没有续租）。
 */
export async function renewTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id, owner, agent } = input;
  if (!node_id) throw new Error('renew 需要 `operations[].id`（要续哪张卡）。');
  const { card } = loadTask(feature, node_id);
  if (card.state !== 'claimed') {
    throw new Error(
      `renew 被拒：节点 "${node_id}" 的 state=${card.state} —— 只有 claimed 能续租（candidate 请直接 claim）。`,
    );
  }
  const who = owner ?? agent;
  if (!who) throw new Error('renew 被拒：要给 `data.owner`（续租必须证明"你还在"，不认匿名续命）。');
  if (!card.owner || !sameActor(card.owner, who)) {
    throw new Error(
      `renew 被拒：这张卡不是你领的（owner=${card.owner ?? '（空）'}，你=${who}）⇒ 别人不能替你续命。`,
    );
  }
  const now = Date.now();
  if (isLeaseExpired(card, now)) {
    throw new Error(
      `renew 被拒：租约**已经过期**（挂了 ${leaseAgeHours(card, now) ?? '?'}h，TTL=${Math.round(LEASE_TTL_MS / 3.6e6)}h）` +
        `⇒ 过期后**不许自己续活**（那是熔断的反面）。\n` +
        `★ 出路：① 直接继续执行并**重新 claim**（会被判为"接管"，记 taken_over_from）；` +
        `② 或者别人已经接管了 —— 那就该停下，先看当前 owner 是谁。`,
    );
  }
  const at = new Date(now).toISOString();
  const count = (card.renewed_count ?? 0) + 1;
  writeTask(feature, node_id, {
    ...card,
    claimed_at: at,
    last_renewed_at: at,
    renewed_count: count,
  });
  const ttlH = Math.round(LEASE_TTL_MS / 3.6e6);
  return {
    message:
      `✓ 已续租 "${node_id}"（第 ${count} 次，owner=${who}，新到期≈${new Date(now + LEASE_TTL_MS).toISOString().slice(11, 16)}Z + ${ttlH}h）。` +
      `\n★ **续租不改任何判据、不动读集** —— 它只回答"我还在"，不回答"我改了要碰什么"。` +
      `\n★ 过期后不能续（只能接管），这是熔断的边界：${'过期 = 你停了，不是你没空。'}`,
    feature,
    data: { node_id, renewed_count: count, last_renewed_at: at, ttl_ms: LEASE_TTL_MS },
  };
}

/**
 * ★★★ **自己过期**（`expire` · 2026-10-22 用户裁定）
 *
 * 用户原话：*「而且有没有自己过期的手段」* / *「任务就该自己暂时终止」*。
 *
 * ## 它补的是什么
 * - `releaseIfExpired` **只产出事件**（纯函数，纪律：不静默改 state）；
 * - 接管（`claim` 过期卡）只是"**别人来了**才发生"；
 * - ⇒ **没人来的时候，卡会永远停在 claimed**。这就是用户说的"一直卡别人的线程"。
 *
 * 本 op 是那个**主动回收**：扫本 feature 里所有 `claimed` 且过期的卡，**回 candidate**，
 * 并记 `expired_from { owner, claimed_at, age_hours, ttl_ms }` + `expired_at`。
 *
 * ## 与 `release` 的区别（别混）
 * - `release` = **人**主动放回去（带 `reason`，算一次决策）；
 * - `expire` = **时间**到了自动回（`reason='lease_ttl'`，不带人的意志）。
 *   ⇒ 两者落的痕迹不同（`release_reason` vs `expired_from`），审计时能分清"人放弃"还是"超时"。
 *
 * ★ 它**不是**定时器：本仓不建后台 daemon（`verify` 里也没有常驻进程）。调用方是
 *   `scripts/patrol.mjs` 或任何想清理的人 —— 但**判据只有一处**（`isLeaseExpired`），
 *   所以"谁调"不再影响"判得对不对"。
 */
export async function expireTasks(input: TaskOpInput): Promise<EditResult> {
  const { feature } = input;
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在。`);
  const now = Date.now();

  // ★ 节点卡 + todo 卡**都扫**（两处都可能有 claimed）—— 口径只有 `isLeaseExpired` 一处
  // ★★★ 2026-10-22（迁移第②步）：**同一张卡只扫一次**（第①步之后它在 nodes 与 todos 各一份 ⇒ 旧写法会
  //   把同一张过期卡「收两次」：第二次拿到的已是 candidate，`isLeaseExpired` 不再为真 —— 看似无害，
  //   但账上是两条 `expired_from`，且第二次会把第一次刚写的痕迹冲掉）。
  //   判据与 `pool#listPool` 同一把尺：`todos[]` 里有卡指向该节点 ⇒ 节点那份是派生投影，跳过。
  const all: Array<{ id: string; card: TaskSpec }> = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    if (!n.task) continue;
    if (todosForNode(n.id, dsl.todos).length) continue;
    all.push({ id: n.id, card: n.task as TaskSpec });
  }
  for (const t of dsl.todos ?? []) all.push({ id: t.id, card: t as TaskSpec });

  const expired = all.filter((x) => isLeaseExpired(x.card, now));
  const lines: string[] = [];
  for (const e of expired) {
    const age = leaseAgeHours(e.card, now);
    /**
     * ★★★ 2026-10-23（两段式 · **超时 = 回滚**）：`preparing` 的卡超时不能只是"回 candidate" ——
     * 它在此期间**真改过 `decision.expectations`** ⇒ 必须按 `prepared_snapshot` **逐字写回**，
     * 否则"人跑了"这件事会在设计侧留下半套判据（下一个领的人会拿它当验收）。
     * ★ 这与 `release`（人主动放弃）走的是**同一个**还原函数 —— 两种来路、一套口径。
     */
    const snapshot = e.card.state === 'preparing' ? (e.card.prepared_snapshot ?? null) : null;
    const next: TaskSpec = {
      ...e.card,
      state: 'candidate',
      owner: null,
      claimed_at: null,
      prepared_snapshot: null,
      // ★ 痕迹：谁被收回、挂了多久、按什么 TTL 判的（审计要能复原当时的口径）
      expired_from: {
        owner: e.card.owner ?? null,
        claimed_at: e.card.claimed_at ?? null,
        age_hours: age,
        ttl_ms: LEASE_TTL_MS,
      },
      expired_at: new Date(now).toISOString(),
    };
    if (snapshot) writeTaskAndRestoreSnapshot(feature, e.id, next, snapshot);
    else writeTask(feature, e.id, next);
    lines.push(
      `  · ${e.id}（原 owner=${e.card.owner ?? '（空）'}，挂了 ${age ?? '?'}h）→ candidate` +
        (snapshot ? `，★ 判据已按快照还原（${snapshot.expectations.length} 条）` : ''),
    );
  }

  const ttlH = Math.round(LEASE_TTL_MS / 3.6e6);
  return {
    message:
      expired.length === 0
        ? `✓ 没有过期的租约（扫了 ${all.filter((x) => isLeaseHolding(x.card.state)).length} 张持租约卡（claimed + preparing），TTL=${ttlH}h）。`
        : `✓ 已收回 ${expired.length} 张过期租约（TTL=${ttlH}h）→ candidate：\n${lines.join('\n')}` +
          `\n★ 痕迹落在各自的 \`expired_from\` / \`expired_at\`（与 release 的 \`release_reason\` 可区分：一个是"人放弃"，一个是"超时"）。`,
    feature,
    data: {
      expired: expired.map((e) => e.id),
      ttl_ms: LEASE_TTL_MS,
      scanned_claimed: all.filter((x) => x.card.state === 'claimed').length,
      // ★ 2026-10-23：preparing 也持租约（它跑了不回来同样要回收，且回收要**还原判据**）
      scanned_preparing: all.filter((x) => x.card.state === 'preparing').length,
    },
  };
}

// ─────────────────────────────────────────────────────────────

export async function releaseTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new Error('release 需要 `data.reason` —— 显式释放必须说清为什么（t_release 的 guard）。');

  const { card } = loadTask(feature, node_id);
  assertTransition(card.state, 'candidate', 'release');
  /**
   * ★★★ 2026-10-23（两段式 · 放弃 = 回滚）：从 `preparing` 退出来时，`decision.expectations` 是
   * **真被改过**的（不是草稿）⇒ 必须按 `prepared_snapshot` **逐字写回**，否则"没领成的活"
   * 会在设计侧留下半套判据，下一个领的人会拿它当既有验收（用户说的"设计 DB 残留"）。
   */
  const snapshot = card.state === 'preparing' ? (card.prepared_snapshot ?? null) : null;
  const releasedAt = new Date().toISOString();
  // ★★★ 2026-10-22（链 C · 身份归一化）：`by` 与 claim 的 `owner` 走**同一套规范**。
  //   原先 `const by = input.agent ?? null` 原样落盘 ⇒ 同一张卡上 `owner=agent:agent-t349`、
  //   `released_by=agent-t349`（两种格式同住一张卡；t349 的旧断言正是这个洞的绿灯）。
  //   ★ 老格式补前缀 + 回执留痕；完全非法（及 STRICT 下的老格式）⇒ 当场拒。
  const bySign = signTaskActor(input.agent, 'release 的署名（released_by / 回执 by）');
  const by = bySign.actor;

  const next: TaskSpec = {
    ...card,
    state: 'candidate',
    owner: null,
    claimed_at: null,
    // ★ 快照用掉即删：它是**回滚依据**，不是历史（留着会让下一次 prepare 的快照对不上）
    prepared_snapshot: null,
    release_reason: reason,
    released_by: by,
    released_at: releasedAt,
  };
  if (snapshot) {
    // ★★★ 还原与改态在**同一次 saveDSL**（否则会留下"判据回了一半"的中间态）
    writeTaskAndRestoreSnapshot(feature, node_id, next, snapshot);
  } else {
    writeTask(feature, node_id, next);
  }

  return {
    message:
      `已释放任务 "${node_id}"（candidate；by=${by ?? '未署名'}${normalizedInline(bySign.adm)}，reason=${reason}）` +
      (snapshot
        ? `★ **判据已按快照回滚**（${snapshot.expectations.length} 条，拍于 ${snapshot.at}）⇒ 与 claim 之前**逐字相同**，零残留。`
        : '') +
      // ★ 首行自足：`edit_dsl` 批量回执只印首行 ⇒ 归一化必须在首行点名；下面这行给人话规则（同一份留痕实现）。
      normalizedActorNote(bySign.adm) +
      `\n★ 进度派生：task.state=candidate ⇒ progress=draft。` +
      // ★ 2026-10-21（读集比对）：**不清**读集（它仍是“最后一次领的时候占过什么”这个事实），
      //   但比对只读 `state==='claimed'` 的卡 ⇒ 释放即**不再占位**（下一次 claim 重算并覆盖）。
      (card.read_set
        ? `\n★ 读集（${card.read_set.symbols.length} 符号 / ${card.read_set.files.length} 文件，算于 ${card.read_set.computed_at}）**留在卡上**，` +
          `但 state=candidate ⇒ **不再占位**；下一次 claim 会重算并**覆盖**它。`
        : ''),
    feature,
    data: { node_id, state: 'candidate' as TaskState, released_by: by, released_at: releasedAt, progress: progressOf({ state: 'candidate' }) },
  };
}

// ─────────────────────────────────────────────────────────────
// complete
// ─────────────────────────────────────────────────────────────

/**
 * 完成（`claimed → done`）。
 *
 * guard（逐条照 `t_done_from_claimed`）：
 *  ① `owner` 非空（★ 必须已领）；
 *  ② `isSatisfied(card) === true`（★ 读**收口**那一侧：`cardStanding === 'satisfied'`）——
 *     ★★ **不再调旧的「可领」判据**：那个函数已从状态机删除（本文件对它的引用数为 **0**，可 grep 验）；
 *        若这里与 claim 共用"全过"判据，收口闸会放行 `violated` 卡（后态全过、前态越权）——
 *        那比收归前更坏（讨论 2 的 P31）。
 *  ③ `validateProgressEvidence` 过（★ 复用既有证据闸，不新造第二把尺）；
 *  ④ 写完 task 状态后**调 `updateStatus`**（既有状态入口）—— 交接期让 overlay 的 `progress`
 *     仍有一份**投影**，读端不断（★ 第 ④ 步"overlay progress 退役"另上榜单）。
 */
export async function completeTask(input: TaskOpInput): Promise<EditResult> {
  // ★★★ 2026-10-18（D-complete-nonatomic）：**完工前备份原始字节** ——
  //   病：先 `writeTask`（写 done）再 `updateStatus`（投影）；后者失败 ⇒ **状态已变 done 但调用报错**。
  //   药：失败时把调用前的字节写回（★ 和 `updateFeature` 的 `restoreRaw` 同一手法）。
  //   ★ Q5 已封了"todo 会触发"那条路径（todo 跳过 updateStatus）⇒ 本修复是**防御性**的（节点任务路径上 updateStatus 很少失败）。
  const designFileForRollback = getDesignSheetFile(input.feature);
  const rawBeforeComplete = fs.existsSync(designFileForRollback)
    ? fs.readFileSync(designFileForRollback, 'utf8')
    : null;
  const { feature, node_id } = input;
  const evidence = input.evidence;
  const { dsl, card } = loadTask(feature, node_id);
  /** ★ 判据现取的落点：卡挂的那个节点（todo 卡没有节点 ⇒ 0 条判据） */
  const cardNode = (dsl.geometry?.nodes ?? []).find((n) => n.id === node_id);
  assertTransition(card.state, 'done', 'complete');

  /**
   * ★★ 2026-10-20（OQ1 裁定）：**从 candidate 直接收口时允许 owner 为空** ——
   *   这张卡一出生就 satisfied，"领"对它没有意义（`claim` 会拒它），所以它可能从没被领过。
   *   ★ 但 `claimed → done`（t_done_from_claimed）**仍然要求 owner**：
   *     那条路的语义是"我领了并做完了"，没有 owner 就没有主体。
   */
  const fromCandidate = card.state === 'candidate';
  if (!card.owner && !fromCandidate) {
    throw new Error(`complete 被拒：节点 "${node_id}" 的任务格没有 owner ⇒ 未领不可能被收口（t_done_from_claimed 第 1 条）。`);
  }

  // ★ L1 / L2 两条收口尺（★ 各自唯一，别在这里就地判期望条数）
  //   · L1 ⇒ constructionVerdict（与 claim 侧**同一个函数**：那边判 false 才可领，这边判 true 才可收口）
  //   · L2 ⇒ isSatisfied（= cardStanding === 'satisfied'；与 claim 的 isClaimable 同源、不同谓词）
  //   ★ 2026-10-22 取证：certs/t359 逐条钉住"每一级内部两侧同一把尺"（跨级才是两把尺）。
  const level = taskLevel(expectationsOf(cardNode));
  let closeNote: string;
  let standing: CardStanding | undefined;
  // ★★★ 2026-10-18（Q5）：**todo（无节点任务）没有判据** ⇒ 不走 L1/L2 两条尺。
  //   ★ 为什么：todo 不是代码（整理 Skill / 改 CI / 调研），`expectations` 判不了 ⇒
  //     `taskLevel` 会给 L1 ⇒ `constructionVerdict` 要求 decision ⇒ **永远收不了口**。
  //   ⇒ 它只凭 `evidence`（`attestation`：谁、何时、为什么算完成）——那正是"人负责"的形态。
  const isTodo = (dsl.todos ?? []).some((t) => t.id === node_id);
  if (isTodo) {
    // ★★★ 2026-10-23（僵尸格）：**candidate + 一出生就满足** 的 todo 卡曾死锁 ——
    //   complete 要求 claimed，而 claim 又说 satisfied 只可收口（要用 intent:modify 才绕得过去）。
    //   ★ 状态机层【早就】备了这条路（`t_done_from_candidate`，2026-10-20 OQ1 的「不领也能收口」），
    //   只是本文件的代码没跟 ⇒ 这里放开：todo 卡可以从 candidate 直接收口（★ 仍要求 agent 署名）。
    if (card.state !== 'claimed' && card.state !== 'candidate') {
      throw new Error(
        `complete 被拒：todo 的 state=${card.state}，只有 claimed / candidate 才能收口。` +
          `（preparing ⇒ 先 start；done ⇒ 已完成；void ⇒ 先 relaunch）`,
      );
    }
    if (card.state === 'candidate' && !input.agent) {
      throw new Error(
        'complete 被拒：从 candidate 直接收口必须给 `agent`（谁干的）—— ' +
          '这张卡没被领过，署名只能来自这次调用；★ 不替你编一个署名。',
      );
    }
    assertTransition(card.state, 'done', 'complete');
    closeNote = 'todo 完成（无判据）—— ★ 只凭 attestation 证据：谁、何时、为什么算完成';
  } else if (level === 'L1') {
    const c = constructionVerdict(dsl, node_id);
    if (!c.complete) {
      throw new Error(
        `complete 被拒（L1 建构未完成）：${c.missing.join('；')}。\n` +
          `★ L1 的收口判据 = **DSL 建构完整**（\`.agent-io/design/task-system-plan.dsl.json\` 的 \`two_level_tasks.L1_construct\`：` +
          `输出"可判的期望"，判据"建构完整" —— ★ **不是代码跑通**）。\n` +
          `★ 怎么办：给节点写决策卡 \`edit_dsl {type:'decision', op:'update', id:'${node_id}', data:{ summary, expectations } }\` ` +
          `（至少一条**相位 post** 的期望，如 \`file-exists\` / \`symbol-exists\`），再 complete。\n` +
          `★ 本工具**不替你编一条期望**（那会变成"永远不判的假验收"）。`,
      );
    }
    closeNote = `L1 建构完整（decision.summary + 后态判据 ${c.post} 条）—— ★ 判据是"DSL 建构完整"，不是代码跑通`;
  } else {
    const root = requireRoot(dsl as { source_root?: string });
    const satisfied = await isSatisfied(card, expectationsOf(cardNode), {
      root,
      nodes: dsl.geometry?.nodes ?? [],
      judge: judgeExpectations,
    });
    if (!satisfied.satisfied) {
      throw new Error(
        `complete 被拒（可收口性：${satisfied.standing}）：${satisfied.reason}\n` +
          `★ 收口判据唯一出处 = src/domain/task_machine.ts#isSatisfied（只有 satisfied 可收口；work/violated 可领但不可收口）。`,
      );
    }
    standing = satisfied.standing;
    closeNote =
      `站位=satisfied（后态判据 ${satisfied.verdict.satisfaction.passed} 条全过、` +
      `前态判据 ${satisfied.verdict.violation.checked} 条无红）`;
  }
  // ★ 证据闸（唯一一把尺）：没证据 / 形状不对/期望类证据没全绿 ⇒ 当场拒。
  const gate = validateProgressEvidence('done', evidence);
  if (!gate.ok) throw new Error(`complete 被拒（证据闸）：${gate.reason}`);
  // ★★★ 重开账闸（2026-10-20）：重开后的收口必须带**新的**东西 —— 判据换了（publish 结清）或新时间戳证据。
  //   插在这里（satisfied / 建构完整 **之后**）的理由：它不回答"做没做完"，只回答"这次的 done 是不是新的"；
  //   放前面会用"需要新证据"盖掉更可行动的"判据未过"。
  const reopenCheck = reopenGate(card, evidence);
  if (!reopenCheck.ok) throw new Error(`complete 被拒（重开账本）：${reopenCheck.reason}`);

  // ★★★ 2026-10-22（链 C · 身份归一化）：`evidence[].agent` 是「谁宣布的」⇒ 与 claim 的 `owner` 同一套规范。
  const signer = signTaskActor(input.agent, 'complete 的署名（evidence[].agent / 回执）');
  const at = new Date().toISOString();
  // ★★★ 2026-10-21：**证据带代码指纹**（`task_schema.ts#TaskEvidenceFingerprint`）—— 「增量测试」的地基：
  //   指纹没变 ⇒ 这条证据仍有效 ⇒ 不必重跑；变了 ⇒ 自动失效 ⇒ 只重跑这一处。
  //   ★ `covers` 只从**判据自己点名的文件**算（`expectationPaths`），不发明"这套测试覆盖谁"；
  //     算不出来就只落 `what`/`input`，读端判 `unverifiable`（**不是**"有效"）。
  const fingerprint = fingerprintEvidence(expectationsOf(cardNode), dsl.source_root, node_id, evidence!);
  // ★★★ 2026-10-23（证据落盘白名单）：**入参原样交给白名单裁**，不再逐字段手写。
  //   手写那版的实测后果：跨册 192 条证据里 **0 条**带 `observed` / `command` ——
  //   `reading` 的「我看到了什么读数」被**静默丢弃**，卡上只剩「谁、何时、什么结论」
  //   ⇒ 收口门形同「我说完成了」。
  //   ★ 裁口只有一个（`task_schema.ts#TASK_EVIDENCE_KEYS`）：名单外的键（如 `hack:'x'`）**照样丢**。
  //   ★ 派生字段（`at` / `by` / `agent` / `fingerprint` / `verdict`）写在展开**之后** ⇒ 覆盖入参同名键。
  const persisted = pickTaskEvidence({
    ...(evidence as unknown as Record<string, unknown>),
    at,
    // ★★★ 2026-10-20：**主体必记**（OQ1 的另一半）——
    //   此前 `by` 只在 attestation 时写 ⇒ expectations 收口的卡看不出"谁宣布的"。
    //   现在所有 kind 都记：`by` 分人/机器，`agent` 记具体是谁。
    by: evidence!.kind === 'attestation' ? evidence!.by : 'llm',
    ...(signer.actor ? { agent: signer.actor } : {}),
    // ★ 2026-10-21：这条证据的**代码指纹**（`what` / `input` / `code` / `covers`）—— 见上面那段。
    fingerprint,
    verdict: 'pass',
  });
  writeTask(feature, node_id, {
    ...card,
    state: 'done',
    evidence: [...(card.evidence ?? []), persisted],
  });

  // ★★★ 2026-10-23：**说清"哪些键真落了盘"** —— 「有意不存」和「静默丢掉」在回执上长得一样，
  //   所以把**实际落盘的键**逐个念出来（名单外的键不会被念：它们本来就不该进证据）。
  //   ★ 旧版这段写的是「`observed` 不落盘」—— 那正是本卡要修的行为，注释已随之改写。
  const persistedNote =
    ` ★ 证据落盘（白名单内）：${Object.keys(persisted).join(' · ')}` +
    '（★ 名单 = `task_schema.ts#TASK_EVIDENCE_KEYS`；名单外的键一律丢）。';

  // ★★★ 2026-10-21（跑环继任链）：**收口的这一刻正是"还有没有下一环"该被问的时候**——
  //   规则：**做完一环发现还有新的 ⇒ 就直接在这一环下面登记第二步**。
  //   ★ 但**只是提示**：不许阻塞。提示一阻塞，就会有人为了过闸乱填一张（那比没有链更坏）。
  //   ★ 必须在 writeTask **之后**算：这里要读的是「收口之后」的链（本卡已经是 done）。
  //   ★ 入参要按**收口后**的样子算（`dsl` 是写盘前读的那一份，本卡还停在 claimed）——
  //     否则"上一环 done 了没 / 整条链走完没"会看着像还没走完。
  const chainNote = isTodo
    ? todoChainNote(
        (dsl.todos ?? []).map((t) => (t.id === node_id ? { ...t, state: 'done' as TaskState } : t)),
        node_id,
      )
    : { head: '', detail: '' };

  // ★ 交接期：仍调既有状态入口（设计期望 `completeTask → updateStatus`），让 overlay 的 progress
  //   有一份与派生值一致的投影（★ 权威仍是 task.state；第 ④ 步退役 overlay 后这一行随之下线）。
  // ★★★ 2026-10-18（Q5）：**todo 没有"节点 status"可投影**（它不在 geometry/semantic）⇒ 跳过。
  //   ★ 不跳会怎样（实测）：先 writeTask（写 done）再 updateStatus（报"节点未找到"）⇒
  //     **报错但数据已改** —— 和 Q2 同族（"失败不等于没发生"）。
  let legacy: ReturnType<typeof updateStatus> | null = null;
  if (!isTodo) {
    try {
      /**
       * ★★★ 2026-10-22（reopen-evidence-deadlock）：**把"这条证据已过 reopenGate"这件事交给投影端**。
       *
       * 走到这里时：① `isSatisfied` / `constructionVerdict` 已经跑过并全过（上面的 L1/L2 两支）；
       * ② `reopenGate` 已放行（重开过的卡 ⇒ 这条证据的 `at` ≥ `reopened_at`）
       * ⇒ 锚点上那条更老的 `expectations` 证据**不该**把这次收口噎死（那正是本卡修的死锁），
       * 但它也**不该被覆盖**（机器判据比口供强）—— 这两件都在 `updateStatus` 里按这个标记办。
       * ★ 反过来说：手工 `edit_dsl {type:'status'}` **传不进这个标记**（`update_feature.ts` 逐字段构造）
       *   ⇒ "点一下 done"那条路的闸**没松**。
       */
      legacy = updateStatus({ feature, node_id, status: 'done', evidence, evidenceClearedBy: 'task-complete' });
    } catch (e) {
      // ★ 失败 ⇒ 把调用前的字节写回（否则"状态已变 done、调用报错"）
      if (rawBeforeComplete !== null) fs.writeFileSync(designFileForRollback, rawBeforeComplete, 'utf-8');
      throw new Error(
        `complete 失败（投影 updateStatus 报错，已回滚到调用前状态）：${(e as Error).message}\n` +
          '★ 回滚方式是写回调用前的原始字节（不走 saveDSL —— 否则元数据会前进，那是 Q2 的坑）。',
      );
    }
  }

  return {
    message:
      `已完成任务 "${node_id}"（owner=${card.owner}，级别=${level}${normalizedInline(signer.adm)}）—— ${closeNote}、证据 kind=${evidence!.kind}。${persistedNote}${chainNote.head}` +
      chainNote.detail +
      normalizedActorNote(signer.adm) +
      (legacy ? `\n${legacy.message.split('\n')[0]}` : '\n★ todo：无节点 status 可投影（不在 geometry）⇒ 跳过 updateStatus') +
      (level === 'L1' ? `\n★ 下一步：\`publish\` 会把这个节点翻成 **L2 实现卡**（旧 L1 卡的证据会带过去）。` : ''),
    feature,
    data: {
      node_id,
      level,
      state: 'done' as TaskState,
      ...(standing ? { standing } : {}),
      progress: progressOf({ state: 'done' }),
      evidence_kind: evidence!.kind,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// edit_dsl 路由（applyOperation 的 case 'task' 只调这里）
// ─────────────────────────────────────────────────────────────

/** `edit_dsl {type:'task', op:publish|claim|release|complete|void|reopen|relaunch}` 的分派（★ **唯一入口**；合法值只由 `op_data_spec.ts#OP_SPECS` 判）。 */
/**
 * ★★★ 2026-10-19：**重开已完成的任务**（`done → claimed`）。
 *
 * ## 为什么要有它（有真实成本）
 * `done` 是终态时，同一节点的**第二个工作项无处安放**：
 *   `publish` 拒（"覆盖它等于把已完成的判据换掉"）· `release` 只能 `claimed → candidate`。
 * 而"一个文件会被反复改"是常态 —— 2026-10-19 晚上就有一笔改动（T20 正式化）
 * 因为无处立卡而只能**无卡提交**。
 *
 * ## 三条判据（都在 `t_reopen` 的 guard 里，这里只执行）
 * ① `owner` 必填（谁来重开 = 谁接手）
 * ② `reason` 必填（为什么重开）—— ★ 无理由的重开等于把"完成"当摆设
 * ③ CAS：`state === done` 才写（`assertTransition` 从迁移表读，不另写一把尺）
 *
 * ★ **重开不改判据**：本函数只 `{ ...card, state:'claimed', owner, claimed_at, reopened_at, reopen_reason, reopened_from }` —— 它**不重读 decision**，
 *   卡上的 `expectations` 原样留着（`evidence` 也原样留着）。⇒ 要换判据必须**再走一步 `publish`**：
 *   `reopen` → 改 `decision` → `publish`（state 已是 claimed，带 `data.reason` ⇒ 原地换判据，evidence 逐条保留）。
 *   ★ 只改 decision 不 publish ⇒ 卡上仍是**旧判据**（判据不跟着 decision 自动变）。
 * ★★★ 2026-10-20：`reopened_at` 是**账本借方** —— 重开后"判据没换 + 没有新时间戳证据"的 `complete` 被拒
 *   （否则 done → reopen → complete 就是零工作量再 done 一次）。结清口只有 `publish`（真换判据）与
 *   `complete` 的新证据两条；判据见 `reopenGate`。
 */
export async function reopenTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  if (!input.owner) {
    throw new Error(`reopen 被拒：缺 \`owner\` —— 重开必须有接手人（t_reopen 第 3 条）。`);
  }
  if (!input.reason) {
    throw new Error(`reopen 被拒：缺 \`reason\` —— 为什么重开？（t_reopen 第 4 条）无理由的重开等于把"完成"当摆设。`);
  }
  const { card, dsl } = loadTask(feature, node_id);
  assertTransition(card.state, 'claimed', 'reopen');
  // ★★★ 2026-10-22（链 C · 身份归一化）：`reopen` 写的也是 `owner` ⇒ 与 claim 同一套规范（老格式补前缀 + 留痕）。
  const ownerSign = signTaskActor(input.owner, 'reopen 的署名（data.owner）');
  if (!ownerSign.actor) {
    throw new Error('reopen 被拒：`data.owner` 去掉空白后为空 —— 重开必须有接手人（t_reopen 第 3 条）。');
  }
  const owner = ownerSign.actor;
  // ★ 重开时刻 = 账本借方（`TaskSpec.reopened_at`）；`claimed_at` 与它同源，不取两次时钟。
  const now = new Date().toISOString();
  const next: TaskSpec = {
    ...card,
    state: 'claimed',
    owner,
    claimed_at: now,
    reopened_at: now,
    // ★★ 2026-10-20：重开要**留痕** —— 为什么又开（`reopen_reason`）、从谁手里接的（`reopened_from`）。
    //   原先理由只活在回执里；回执会丢，账不会。`evidence[]` 由 `...card` 原样保留（上一轮干过什么）。
    reopen_reason: input.reason,
    reopened_from: card.owner ?? null,
  };
  writeTask(feature, node_id, next);
  return {
    message:
      // ★ 首行自足（`edit_dsl` 只透出每个 op 的**首行**）—— 所以"判据没变 + 账本已记 + 下一步"必须在首行。
      `已重开任务 "${node_id}"（done → claimed，owner=${owner}${normalizedInline(ownerSign.adm)}）：判据（decision 上现取）仍是那 ${expectationsOf((dsl.geometry?.nodes ?? []).find((n) => n.id === node_id)).length} 条、` +
      `**重开账已记（reopened_at=${now}）** —— 判据没换、又没有 at ≥ 该时刻的新证据，\`complete\` 会被拒。\n` +
      `  理由：${input.reason}\n` +
      `  ★ 两步：① \`edit_dsl { type:'decision', op:'update', id:'${node_id}', data:{ summary, expectations } }\`；` +
      `② \`{ type:'task', op:'publish', id:'${node_id}', data:{ reason:'…' } }\` ⇒ **原地换判据**` +
      `（state 仍 claimed，owner / claimed_at / evidence / discussion 全部保留 —— 不用 release，也不用 claim）。\n` +
      `  ★ 进度派生：task.state=claimed ⇒ progress=in_progress。` +
      normalizedActorNote(ownerSign.adm),
    feature,
  };
}

/**
 * ★★★ 2026-10-20（新增「t_relaunch：void→candidate，理由必填」）：
 * **重新立卡**（`void → candidate`）。
 *
 * ## 与 `reopen` 的分界（★ 必须写在代码里，否则两个词会互相吃掉）
 * ```
 * t_reopen   : done → claimed     「接手」    —— 判据不变，原卡继续
 * t_relaunch : void → candidate   「重新立卡」—— 判据要重给，卡回到没人领
 * ```
 * `void` 的语义是「**这件事不做了**」，不是「**这件事不存在过**」⇒ 要做回来了，
 * 不该逼人另开节点（节点 id 就是文件，另开 = 同一文件两张卡）。
 *
 * ## ★ 判据不随卡走 ⇒ `relaunch` **清不了也改不了**判据（旧注释已作废）
 * 卡上**没有** `expectations` 字段（`TaskSpec` 无它；判据唯一住处 = `decision`）。
 * ⇒ `relaunch` 只把 `state` 放回 `candidate`，判据仍是 decision 上那几条 ——
 *   **不存在**"清空旧判据"这个动作（卡的副本已于 2026-10-20 删除）。
 * ★ 后果必须说清：卡回到 candidate 后，若 decision 的判据**仍然全绿**，`claim` 会判 `satisfied`
 *   （没活干）⇒ 拒领。**这不是死锁**，两条正路：
 *   ① 这活真要重做 ⇒ 改 `decision`（换/加判据）再 `publish`；
 *   ② 只是要改文件（取写权）⇒ `claim` 带 `intent:'modify'`。
 * 保留：`summary`（原来做的是什么）· `evidence`（"这活存在过"）—— 作废的是"要做"，不是"存在过"。
 *
 * ## 三条判据（`t_relaunch` 的 guard，这里只执行）
 * ① `reason` 必填（为什么重新立卡）—— ★ 无理由的复活等于把"作废"当摆设
 * ② `state === void` —— 由 `assertTransition` 从迁移表读，不另写一把尺
 * ③ 清空后不可能"一出生就满足"（`expectations: []` ⇒ 没有可判绿的判据）
 */
export function relaunchTask(input: TaskOpInput): EditResult {
  const { feature, node_id } = input;
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    throw new Error(
      'relaunch 被拒：缺 `data.reason` —— 为什么重新立卡？（t_relaunch 第 1 条）无理由的复活等于把"作废"当摆设。',
    );
  }
  const { dsl, card } = loadTask(feature, node_id);
  assertTransition(card.state, 'candidate', 'relaunch');
  /** ★ 重新立卡**不动判据**（判据不住卡）：这里只报读数 —— decision 上现有几条 */
  const kept = expectationsOf((dsl.geometry?.nodes ?? []).find((n) => n.id === node_id)).length;
  writeTask(feature, node_id, {
    ...card,
    state: 'candidate',
    owner: null,
    claimed_at: null,
    // ★ 重新立卡 = 新账：上一轮的重开欠账不跟过来（否则 publish 之后 complete 会被"旧账"拒）
    reopened_at: null,
  });
  return {
    message:
      // ★ 首行自足（`edit_dsl` 只透出每个 op 的**首行**）
      `已重新立卡任务 "${node_id}"（void → candidate）：判据不由卡持有（decision 上现有 ${kept} 条，**未清空**），summary / evidence 保留。\n` +
      `  理由：${reason}\n` +
      `  ★ 下一步：① 改 decision（判据的唯一来源）；② \`{ type:'task', op:'publish', id:'${node_id}' }\` ⇒ 把 summary 对齐 decision；然后 \`claim\`。\n` +
      `  ★ 判据没换（decision 仍是那 ${kept} 条）：直接 claim 可能被判无活（satisfied / unknowable）—— 那时正路是改 decision，不是清卡。\n` +
      `  ★ 与 reopen 的区别：reopen = done → claimed「接手」；relaunch = void → candidate「重新立卡」（判据仍住 decision，不随卡走）。`,
    feature,
    data: {
      node_id,
      state: 'candidate' as TaskState,
      expectations_kept: kept,
      progress: progressOf({ state: 'candidate' }),
    },
  };
}

/**
 * ★★★ **两段式领取 · 第二段（`start`）**（2026-10-23）：`preparing → claimed`。
 *
 * ## 一句话
 * 「判据补齐了」这件事**由主体宣布**，然后**一次落盘**完成两件事：**删快照** + **state→claimed**。
 *
 * ## 为什么是"一次"（判据 B 的全部）
 * 拆成两次写会出现两种半生效态：
 *   · 删了快照、没改态 ⇒ 卡还在 preparing，但**回滚依据已经没了**（放弃时无从还原）；
 *   · 改了态、没删快照 ⇒ 卡在 claimed 却带着一张"旧判据"的快照，
 *     下一次 prepare 会拿它当底账 ⇒ **回滚到别人的版本**。
 * ⇒ 这里只调**一次** `writeTask`（内部一次 `saveDesignSheet`），结构上不给中间态存在的机会。
 *
 * ## 三条判据（`t_start` 的 guard，这里只执行）
 * ① `state === 'preparing'`（别的一段式卡请直接 `claim`）；
 * ② **后态判据 ≥ 1 条** —— 空判据不许进 claimed，否则两段式就白做了（这就是它的全部目的）；
 * ③ `owner` 必须是**你**（`sameActor`）—— 不能替别人把他"准备中"的卡开工。
 *
 * ★ 它**不判定"有没有活"**（`cardStanding` / `constructionVerdict` 一个都不调）：
 *   start 回答的是"验收标准在不在"，不是"这活还剩多少"。判据的满足度在 `complete` 那一侧判。
 */
export function startTask(input: TaskOpInput): EditResult {
  const { feature, node_id } = input;
  const { dsl, card } = loadTask(feature, node_id);
  if (card.state !== 'preparing') {
    throw new Error(
      `start 被拒：节点 "${node_id}" 的 state=${card.state} —— start 只用于**两段式第一段**（preparing → claimed）。\n` +
        (card.state === 'candidate'
          ? `★ 它还没被领：判据已就位的话直接 \`claim\`（一段式）；判据空的话 claim 会把它带进 preparing。`
          : `★ state=${card.state} 的可走迁移见 domain/task_machine.ts#TRANSITIONS。`),
    );
  }
  const whoRaw = (input.owner ?? input.agent ?? '').trim();
  if (!whoRaw) {
    throw new Error(
      `start 被拒：要给 \`data.owner\`（谁在宣布"判据补齐了"）—— 不认匿名开工（与 claim 同一条纪律）。` +
        (card.owner ? `\n★ 这张卡现在挂在 ${card.owner} 手上。` : ''),
    );
  }
  const whoAdm = admitActor(whoRaw, null, { strict: actorStrictMode() });
  if (!whoAdm.ok || !whoAdm.actor) {
    throw new Error(`${whoAdm.error ?? `✗ start 被拒：\`data.owner\` 不合法（收到 ${JSON.stringify(whoRaw)}）`}`);
  }
  if (!card.owner || !sameActor(card.owner, whoAdm.actor)) {
    throw new Error(
      `start 被拒：这张卡不是你准备的（owner=${card.owner ?? '（空）'}，你=${whoAdm.actor}）—— ` +
        `不能替别人把他"准备中"的卡开工。★ 别人的 preparing 到期后会被 \`expire\` **还原判据**并退回 candidate。`,
    );
  }
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === node_id);
  const post = postExpectations(expectationsOf(node));
  if (!post.length) {
    // ★ 判据 D 的第二个出口：第①段没补够就想开工 —— 回执照样得说清"还差什么"，不能只说"不行"。
    const gap = criteriaGap(dsl, node, node_id);
    throw new Error(
      `start 被拒（判据还是空的）：节点 ${node_id} 的**后态判据（phase=post）0 条** ⇒ ` +
        `说"准备完了"没有依据（两段式的全部意义就是这一条）。\n` +
        `★ 还差：**${gap.need} 条**（${gap.kinds.join(' + ')}）\n` +
        gap.lines.map((l) => `  · ${l}`).join('\n') +
        `\n★ 可直接粘的模板：\n` +
        gap.templates.map((t, i) => `  ${i + 1}) ${t}`).join('\n') +
        `\n★ 卡**原地不动**（仍是 preparing、快照仍在）—— 补完再 start 即可；要放弃就 release（会还原判据）。`,
    );
  }
  assertTransition(card.state, 'claimed', 'start');
  const at = new Date().toISOString();
  // ★★★ 一次写：删快照 + 改态（`writeTask` 内部只有一次 `saveDesignSheet`）—— 判据 B 就靠这一行。
  writeTask(feature, node_id, {
    ...card,
    state: 'claimed',
    // ★ 新租约从此刻起算（preparing 那段的时间不算"施工中"，否则 TTL 会替你算错年龄）
    claimed_at: at,
    prepared_snapshot: null,
  });
  return {
    message:
      `已开始任务 "${node_id}"（preparing → claimed，owner=${card.owner}${normalizedInline(whoAdm)}）：` +
      `后态判据 ${post.length} 条已就位、**快照已删** —— 两件事在**同一次落盘**里完成（原子，判据 B）。` +
      `\n★ 现在才有写权：\`write_gate\` 只认 \`state=claimed\`（preparing 期间它一直没放行，这就是"已领取但不可开工"）。` +
      `\n★ 收口仍走 \`complete\`（判据仍然是 decision 上那 ${post.length} 条，快照已不存在 ⇒ 无从"还原成旧判据"）。` +
      `\n★ 进度派生：task.state=claimed ⇒ progress=in_progress。` +
      normalizedActorNote(whoAdm),
    feature,
    data: {
      node_id,
      state: 'claimed' as TaskState,
      owner: card.owner,
      claimed_at: at,
      post_expectations: post.length,
      snapshot_dropped: true,
      progress: progressOf({ state: 'claimed' }),
    },
  };
}

/**
 * ★★★ **设计册 `task_plan.state_machine` 的唯一写入口**（2026-10-23）。
 *
 * ## 为什么非有它不可（今天撞到的墙）
 * 加第 5 态 `preparing` 之后，代码侧 `TASK_STATES` 改了，而设计册
 * `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.state_machine.states` 还是 4 值 ——
 * **同一件事两处权威**（本仓头号病）。而此前这个字段**没有任何写入口**
 * （`TYPE_KNOWN_KEYS` 里没有 `task_plan`）⇒ 只能手改 JSON = 绕过唯一写端
 * （`task_schema.ts` 的 `retire_reason` 那段注释里记着这条债）。
 *
 * ## 判据（写在最靠近落盘的地方，别处不再判一遍）
 * ① `data.states` **必须与 `TASK_STATES` 逐字相同**（顺序也相同）—— 不一致就**拒**，
 *    并把两边逐项报出来。★ 这是"同步"这两个字的机制形态：不是"记得去改"，而是**改不动**。
 * ② `data.transition` 按 `id` **upsert**（不整表替换 ⇒ 不用一次贴 10 条 guard 原文）。
 *    每条必须有 `id` / `from` / `to`（两个都必须落在 `TASK_STATES` 里）∧ **非空 `guard.clauses`**
 *    （一条说不出判据的迁移 = 没人知道它凭什么可走）。
 * ③ `data.note` 可选（`state_machine` 的人读附注）。
 *
 * ★ 它**只管 `state_machine` 这一格**，不碰 `task_plan` 的其它键
 *   （`two_level_tasks` / `gate_principle` … 那些还没有写入口，别在这里顺手开一个后门）。
 */
export function applyTaskPlanOp(feature: string, op: TaskOpRequest): EditResult {
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 ⇒ 没有设计册可写。`);
  if (op.op !== 'update') {
    throw new Error(`task_plan 只支持 op:'update'（收到 ${JSON.stringify(op.op)}）—— 状态机只有"改"，没有"整表增删"。`);
  }
  const data = (op.data ?? {}) as Record<string, unknown>;

  const rec = dsl as unknown as { task_plan?: Record<string, unknown> };
  const tp: Record<string, unknown> = { ...(rec.task_plan ?? {}) };
  const prevSm = (tp.state_machine as Record<string, unknown> | undefined) ?? {};
  const sm: Record<string, unknown> = { ...prevSm };
  const changed: string[] = [];

  // ── ① states：必须与代码侧逐字一致 ───────────────────────────────
  if (data.states !== undefined) {
    const got = data.states;
    if (!Array.isArray(got) || got.some((s) => typeof s !== 'string')) {
      throw new Error(`task_plan.update 被拒：\`data.states\` 必须是字符串数组（收到 ${JSON.stringify(got)}）。`);
    }
    const same = got.length === TASK_STATES.length && got.every((s, i) => s === TASK_STATES[i]);
    if (!same) {
      throw new Error(
        `task_plan.update 被拒（**设计册与代码不许漂**）：\`data.states\` 必须与 ` +
          `\`src/domain/task_schema.ts#TASK_STATES\` **逐字相同**（含顺序）。\n` +
          `  代码：${JSON.stringify([...TASK_STATES])}\n` +
          `  收到：${JSON.stringify(got)}\n` +
          `★ 这条不是形式主义：状态表住两处，迟早有一处是旧的 —— 而"哪一份算数"会由**调用方**临时决定。`,
      );
    }
    sm.states = [...got];
    changed.push(`states ${JSON.stringify(prevSm.states ?? [])} → ${JSON.stringify(got)}`);
  }

  // ── ② transition：按 id upsert ────────────────────────────────
  if (data.transition !== undefined) {
    const t = data.transition as {
      id?: unknown;
      from?: unknown;
      to?: unknown;
      guard?: { clauses?: unknown };
      executor?: unknown;
    };
    if (typeof t?.id !== 'string' || !t.id.trim()) {
      throw new Error(`task_plan.update 被拒：\`data.transition.id\` 必填（迁移 id，如 t_start）。`);
    }
    if (!isTaskState(t.from) || !isTaskState(t.to)) {
      throw new Error(
        `task_plan.update 被拒：\`${t.id}\` 的 from/to 必须落在 TASK_STATES 里` +
          `（收到 from=${JSON.stringify(t.from)} / to=${JSON.stringify(t.to)}）。`,
      );
    }
    const clauses = t.guard?.clauses;
    if (!Array.isArray(clauses) || !clauses.length || clauses.some((c) => typeof c !== 'string')) {
      throw new Error(
        `task_plan.update 被拒：\`${t.id}\` 的 \`guard.clauses\` 必须是非空字符串数组 —— ` +
          `一条说不出判据的迁移 = 没人知道它凭什么可走（本仓把 guard 当**正文**，不是装饰）。`,
      );
    }
    const list = Array.isArray(sm.transitions) ? [...(sm.transitions as Array<Record<string, unknown>>)] : [];
    const idx = list.findIndex((x) => x.id === t.id);
    const nextTr: Record<string, unknown> = {
      id: t.id,
      from: t.from,
      to: t.to,
      guard: { clauses: [...(clauses as string[])] },
    };
    if (typeof t.executor === 'string' && t.executor.trim()) nextTr.executor = t.executor;
    // ★★★ 2026-10-26（T-#21）：**`state` 也要能写**。
    //   病史：D4 [迁移状态] 要求**每条** transition 有 `state.kind`（`applicableTransitions` 靠它过滤：
    //   只返回 `kind==='ready'` 的）。而本写端原先**不产 `state`** ⇒ 后来加的
    //   `t_prepare` / `t_start` / `t_abandon`（2026-10-23 的 preparing 三态）永远缺它
    //   （实测 7/10 有、3/10 没有；那 7 条是**手改 JSON** 留下的）。
    //   ⇒ 判据要求的东西，写端必须产得出来 —— 否则 D4 永远红，而人会以为"再写一次就好"。
    const trState = (t as { state?: unknown }).state;
    if (trState !== undefined) {
      const st = trState as Record<string, unknown> | null;
      if (!st || typeof st !== 'object') {
        throw new Error('task_plan.update 被拒：`data.transition.state` 必须是对象。');
      }
      const k = typeof st.kind === 'string' ? st.kind.trim() : '';
      if (!['ready', 'blocked', 'unimplemented'].includes(k)) {
        throw new Error(
          `task_plan.update 被拒：\`data.transition.state.kind\` 必须是 ready / blocked / unimplemented（收到 ${JSON.stringify(
            st.kind,
          )}）。`,
        );
      }
      nextTr.state = { ...st, kind: k };
    }
    if (idx >= 0) list[idx] = { ...list[idx], ...nextTr };
    else list.push(nextTr);
    sm.transitions = list;
    changed.push(`transition ${t.id}（${t.from} → ${t.to}）${idx >= 0 ? '已更新' : '已新增'}`);
  }

  if (data.note !== undefined) {
    if (typeof data.note !== 'string') throw new Error(`task_plan.update 被拒：\`data.note\` 必须是字符串。`);
    sm.note = data.note;
    changed.push('note');
  }

  // ★★★ 2026-10-26（T-#20 / 寄风）：**项目级判据（`criteria`）的写入口**。
  //   此前它**只有读端**（`scripts/design-check.mjs`），写端不存在 ——
  //   实测：`grep design_completeness src/` = **0 命中**，本 op 也只写 `state_machine`。
  //   ⇒ 那 4 条红（D1/D3/D4/D9）**只能手改 JSON** = 绕过写闸。
  //   ★ 三条纪律：
  //     ① `why` 必填（说不出理由的判据不许进册 —— 与 expectation 同款）；
  //     ② `expect` 写前必须用 `new Function` **试解析**（design:check 就是用它求值的，
  //        写坏一个字节会让**整道门崩**，而不是"这条红"）；
  //     ③ **按 `id` upsert**，不整块覆盖别人的条目。
  if (data.criteria !== undefined) {
    const c = data.criteria as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') {
      throw new Error('task_plan.update 被拒：`data.criteria` 必须是对象（单条按 id upsert）。');
    }
    const cid = typeof c.id === 'string' ? c.id.trim() : '';
    if (!cid) throw new Error('task_plan.update 被拒：`data.criteria.id` 必填（按 id upsert）。');
    const why = typeof c.why === 'string' ? c.why.trim() : '';
    if (!why) {
      throw new Error(`task_plan.update 被拒：判据 \`${cid}\` 缺 \`why\` —— 说不出理由的判据不许进册。`);
    }
    const expect = typeof c.expect === 'string' ? c.expect : '';
    if (!expect.trim()) {
      throw new Error(`task_plan.update 被拒：判据 \`${cid}\` 的 \`expect\` 必须是非空字符串。`);
    }
    // ★ 写前试解析 —— 求值域必须与 design-check.mjs 逐字一致，否则"能过写端却跑不起来"
    try {
      // eslint-disable-next-line no-new-func
      new Function(
        'dsl',
        'nodes',
        'paths',
        'fs',
        'path',
        'root',
        'mutateReport',
        'callReport',
        'results',
        'KINDS',
        `"use strict"; return (${expect});`,
      );
    } catch (e) {
      throw new Error(
        `task_plan.update 被拒：判据 \`${cid}\` 的 \`expect\` 语法不成立（design:check 会**整体崩**）—— ${String(
          (e as Error).message,
        )}`,
      );
    }
    const dc = (tp.design_completeness as Record<string, unknown> | undefined) ?? {};
    const list = Array.isArray(dc.criteria) ? [...(dc.criteria as Array<Record<string, unknown>>)] : [];
    const ci = list.findIndex((x) => x && (x as { id?: string }).id === cid);
    const merged = { ...(ci >= 0 ? list[ci] : {}), ...c, id: cid, why, expect };
    if (ci >= 0) list[ci] = merged;
    else list.push(merged);
    tp.design_completeness = { ...dc, criteria: list };
    changed.push(`criteria ${cid}（${ci >= 0 ? '已更新' : '已新增'}）`);
  }

  if (!changed.length) {
    throw new Error(
      `task_plan.update 被拒：没有可写的键 —— 认 \`states\`（必须 === TASK_STATES）/ \`transition\`（单条 upsert）/ \`note\` / \`criteria\`（项目级判据，按 id upsert，why 必填）。`,
    );
  }

  tp.state_machine = sm;
  const nextDsl = { ...(dsl as unknown as Record<string, unknown>), task_plan: tp };
  saveDesignSheet(nextDsl as unknown as typeof dsl);

  return {
    message:
      `已写设计册 \`task_plan\`（feature=${feature}）：${changed.join('；')}。` +
      `\n★ 判据：\`states\` 与代码 \`TASK_STATES\` **逐字一致**（写端强制比对，不靠"记得去改"）；迁移按 id upsert。` +
      `\n★ 下一步：\`design_line { action:'gen-db' }\` 让 design-db 跟上（否则契约门读的是旧要求）。`,
    feature,
    data: {
      states: sm.states,
      transition_count: Array.isArray(sm.transitions) ? sm.transitions.length : 0,
      changed,
    },
  };
}

export async function applyTaskOp(
  feature: string,
  op: TaskOpRequest,
  agent?: string,
): Promise<EditResult> {
  const nodeId = op.id as string; // ★ 由 OP_SPECS 的 idRequired 保证（不是新判据）
  const data = op.data ?? {};
  const input: TaskOpInput = {
    feature,
    node_id: nodeId,
    owner: typeof data.owner === 'string' ? data.owner : undefined,
    // ★★ 2026-10-20：`intent` 只有 claim 读（其余 op 忽略）—— 合法值由 `claimTask` 的运行期守卫判。
    intent: typeof data.intent === 'string' ? (data.intent as ClaimIntent) : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    evidence: data.evidence as ProgressEvidence | undefined,
    // ★★★ 2026-10-21（读集比对）：claim 的读集声明 —— 形状校验（唯一住处）在 `parseDeclaredReadSet`，
    //   不合规就**当场抛**（不静默忽略：静默忽略 = 你以为声明生效了，其实闸用的是兜底）。
    read_set: parseDeclaredReadSet(data.read_set),
    agent,
  };
  switch (op.op) {
    case 'publish':
      // ★★★ 立卡：内容**只能**来自该节点的 decision ⇒ 这里**不传 data 的任何键**进卡片
      //   （`data` 里有 key 也会被 `checkOpSpec` 的"不被认的键"先拒）。
      return publishTask(input);
    case 'claim':
      return claimTask(input);
    case 'release':
      return releaseTask(input);
    case 'complete':
      return completeTask(input);
    case 'void':
      return voidTask(input);
    case 'reopen':
      return reopenTask(input);
    case 'relaunch':
      // ★★★ 2026-10-20：void → candidate「重新立卡」（判据由 publish 重给）
      return relaunchTask(input);
    case 'start':
      // ★★★ 2026-10-23（两段式第二段）：preparing → claimed —— 删快照 + 改态，**一次落盘**
      return startTask(input);
    case 'renew':
      // ★★★ 2026-10-22：**显式续租** —— 只刷 `claimed_at`，不动读集、不动判据
      return renewTask(input);
    case 'expire':
      // ★★★ 2026-10-22：**自己过期** —— 过期的 claimed 卡回 candidate（记 expired_from）
      return expireTasks(input);
    default:
      // ★ 合法性由 `OP_SPECS` 判（`task.ops` 是唯一清单）；走到这里说明表与分派漂了。
      throw new Error(`task 不支持操作: ${op.op}（合法值由 op_data_spec.ts 的 OP_SPECS.task.ops 判定）`);
  }
}

// ─────────────────────────────────────────────────────────────
// publishFromDiff：从 diff 的差异建卡（VISION §7 「无卡 ⇒ 补卡」）
// ─────────────────────────────────────────────────────────────

/**
 * ★ **从 diff 的差异建卡**（`diff` 之后「无卡 ⇒ 补卡」的唯一入口）。
 *
 * ## 它是什么（不是新机制，是 `publishTask` 的一个**命名清楚的入口**）
 * 设计侧 `docs/VISION.md §7`：
 * ```
 * diff 出差异
 *   ├─ 无卡 ⇒ 补卡 → 再上架
 *   └─ 有卡且未实现 ⇒ 直接上架
 * ```
 * 而 `publishTask` 本来就干这个：**该节点有 decision ⇒ 翻成 L2；没有 ⇒ 建 L1 建构卡（活 = 补 decision）**。
 * ⇒ 所以本函数**只是把"从差异来"这个来意说清楚**，实现直接复用 `publishTask`（★ 不复制逻辑）。
 *
 * ## 为什么需要它（而不是让人手点 publish）
 * 差异是**批量**的（`diff` 一次几十条）。手点 = 漏。而"差异 → 卡"该是一次调用。
 *
 * @param feature feature 名
 * @param nodeId 差异里的节点 id
 */
export function publishFromDiff(feature: string, nodeId: string): EditResult {
  const r = publishTask({ feature, node_id: nodeId });
  return {
    ...r,
    message:
      `★ 从 diff 建卡（VISION §7「无卡 ⇒ 补卡」）：\n` + String(r.message),
  };
}

// ─────────────────────────────────────────────────────────────
// void：作废一张卡（candidate → void）
// ─────────────────────────────────────────────────────────────

/**
 * ★ **作废一张卡**（`candidate → void`）—— **卡生命周期的出口**。
 *
 * ## 为什么需要它（2026-10-18 实测：没有它会死锁）
 * 三格全堵的情形：
 * ```
 * candidate + satisfied  ⇒  claim 拒（satisfied 只可收口）
 *                        ⇒  complete 拒（candidate 不能直接 done，OQ1 有意挡）
 *                        ⇒  ★ 永远卡在 candidate
 * ```
 * 而这在**"代码先于卡存在"**时必然发生（先写了代码，再立卡 ⇒ 卡一立就 satisfied）。
 * ⇒ **`void` 是唯一出口**：活不需要做 ⇒ 作废，而不是硬凑成 done。
 *
 * ## 为什么不复用 `release`
 * `release` 是 **`claimed → candidate`**（放回去，别人还能领）；
 * `void` 是 **`candidate → void`**（终结：这事不做了）。**两者语义相反，不能合并。**
 *
 * ## 规矩
 * ★ `reason` 必填（为什么这张卡不需要做了）—— 由 `OP_SPECS.task.required.void` 先拒。
 * ★ 只有 `candidate` 能 void（迁移表说了算）。★ 2026-10-20：void **不再是终态** —— 它有了 `t_relaunch`
 *   （void → candidate，重新立卡）；`done` 也早有 `t_reopen`。
 */
export function voidTask(input: TaskOpInput): EditResult {
  const { feature, node_id, reason } = input;
  if (!reason || !reason.trim()) {
    throw new Error('void 被拒：必须给 `data.reason`（为什么这张卡不需要做了 —— 不留理由的作废等于静默丢弃）。');
  }
  const { dsl, card } = loadTask(feature, node_id);
  if (card.state === 'done' || card.state === 'void') {
    throw new Error(
      `void 被拒：state=${card.state} 只能从 candidate 作废。` +
        '★ 已 done 的卡要重做走 reopen；已 void 的卡要重做走 relaunch —— 都不是"再作废"这条路。',
    );
  }
  assertTransition(card.state, 'void', 'void');
  writeTask(feature, node_id, { ...card, state: 'void' });
  return {
    message:
      `已作废任务 "${node_id}"：${card.state} → void。\n` +
      `★ 理由：${reason.trim()}\n` +
      `★ 判据（decision 上 ${expectationsOf((dsl.geometry?.nodes ?? []).find((n) => n.id === node_id)).length} 条）与证据都保留 —— 作废的是"这活要做"，不是"这活存在过"。`,
    feature,
    data: { node_id, state: 'void' as TaskState, reason: reason.trim() },
  };
}

// ─────────────────────────────────────────────────────────────
// todo：新建一个【无节点任务】（Q5 的进口）
// ─────────────────────────────────────────────────────────────

/**
 * ★ **新建一个 todo**（`todos[]` 的进口）。
 *
 * ## 为什么不复用 `publish`
 * `publish` 是"**翻决策卡**"（内容只能来自 `node.decision`）—— 它**要求有节点**。
 * 而 todo **没有节点**，内容只能**手给**（`data.summary`）⇒ 两者是**不同的进口**，不能合并。
 *
 * ## id 怎么来
 * `todo_<summary 的 slug>`；撞了加 `-2` / `-3`（**可读**比 `todo_<时间戳>` 重要 —— 人要在榜单上认它）。
 *
 * ## 与 `task` 的一致（★ 别在这里另写一套）
 * 新建后 `state='candidate'`、`expectations=[]` —— **之后 claim / complete / void 全部复用 `task_ops` 的同一套 op**
 * （`loadTask` 会在 `geometry` 找不到时回退到 `todos`）。
 */
// ─────────────────────────────────────────────────────────────
// todo 的「改 / 作废 / 物理删」（2026-10-21）
//
// ★ 判据：**所有的增删改查操作都要配齐**，包括 Todo ——
//   否则**以后有变化、旧的怎么样新的怎么样，就答不上来**。
// ⇒ 三个 op 各答一个问题：
//   · update —— 内容变了，**旧值怎么查**（`history[]`，压栈不覆盖）
//   · retire —— 这条不做了，**为什么**（`retire_reason` 落卡上，卡留在册里）
//   · delete —— 这张根本是误建，**怎么证明它没生效过**（机器判据 + 墓碑）
// ─────────────────────────────────────────────────────────────

/** 一次 `todos[]` 定位的结果（`index` 给 `delete` 用；update / retire 只读 `card`）。 */
interface TodoHit {
  dsl: NonNullable<ReturnType<typeof getDesignSheet>>;
  card: TaskSpec;
  index: number;
}

/**
 * 在 `todos[]` 里按 id 定位。**找不到就是失败**（不降级成「新建一张」—— 那会把「改错 id」变成「悄悄多一张卡」）。
 * ★ 报错把两条最常见的来路都指了：① 刚被 delete（册上**故意**没有它了，墓碑里有）；② id 记错。
 */
function findTodoCard(feature: string, action: string, id: string): TodoHit {
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 —— todo 住在设计 DSL 的顶层 todos[]。`);
  const todos = dsl.todos ?? [];
  const index = todos.findIndex((t) => t.id === id);
  if (index < 0) {
    throw new Error(
      `todo.${action} 被拒：todos[] 里没有 "${id}"。\n` +
        `★ 两条常见来路：① 它刚被 todo.delete 过 ⇒ 册上**故意**没有它了（墓碑在 ${todoJournalFile(feature)}，可用 get_dsl query=todo 查）；② id 记错了 ⇒ get_dsl query=todo 拿一遍当前 id。`,
    );
  }
  return { dsl, card: todos[index], index };
}

/**
 * ★ **身份不可变**：`data.id` 只许在 `add` 时给（那时它是「新卡要什么 id」）。
 * 改/作废/删都认 `operations[].id`（要动**哪一张**）—— 两件事混在一个键里就会有人以为能「改 id」。
 */
function assertNoIdentityChange(action: string, data: Record<string, unknown>): void {
  if (data.id !== undefined) {
    throw new Error(
      `todo.${action} **不改身份**：要动哪一张请用 \`operations[].id\`，\`data.id\` 只在 add 时能给。\n` +
        `★ 为什么拦：id 是这张卡在册上的身份（todos[] 的下标、node_id 的指向、别的卡 reason 里对它的引用都靠它）—— 改了它，等于让「被取代的那张」凭空消失。`,
    );
  }
}

/**
 * `todo.update` —— 改 `summary`，★ **旧值压进 `history[]`**（压栈，不覆盖）。
 *
 * ## 为什么必须留旧值（这是本 op 存在的全部理由）
 * 规则：**有变化时必须答得出「旧的怎么样、新的怎么样」**。
 * ⇒ 只写新值 = 判据被悄悄改掉 ⇒ 下一个接手的人看不出「这条 todo 原来要求什么」
 *   ⇒ 三张互相矛盾的卡就会一直矛盾下去（2026-10-21 的真实事故）。
 *
 * ## 允许改的只有**活卡**
 * `done` / `void` 是**已了结**的卡 —— 改它的内容就是改写历史。要再来一轮请重新立卡
 * （判据 = `isClosedTaskState`，★ 不在本文件里再写一遍 done|void 的字面量）。
 */
function updateTodoCard(feature: string, id: string, data: Record<string, unknown>, agent?: string): EditResult {
  assertNoIdentityChange('update', data);
  const next = String(data.summary ?? '').trim();
  const reason = String(data.reason ?? '').trim();
  const { card } = findTodoCard(feature, 'update', id);

  if (isClosedTaskState(card.state)) {
    throw new Error(
      `todo.update 被拒：${id} 已经是 ${card.state}（了结的卡不改内容 —— 改了就是改写历史）。` +
        (card.retire_reason ? `\n  已记录的作废理由：${card.retire_reason}` : '') +
        `\n★ 要在旧结论之上开新活 ⇒ 新 add 一张（并在它的 reason 里点名它取代了 ${id}）；\n★ 真是误建 ⇒ todo.delete（**只在从未生效时**才放行）。`,
    );
  }
  if (card.summary === next) {
    throw new Error(
      `todo.update 被拒：新 summary 与现值**逐字相同** ⇒ 没有改动可记。\n` +
        `★ 这里**故意不留空 history**：修订史只记真发生过的改动，否则「这张卡被改过几次」这个读数就是假的。`,
    );
  }

  const at = new Date().toISOString();
  const entry: TaskHistoryEntry = { at, from: card.summary, to: next, reason, ...(agent ? { by: agent } : {}) };
  const history = [...(card.history ?? []), entry];
  writeTask(feature, id, { ...card, summary: next, history });

  return {
    message:
      `已改 todo "${id}" 的内容（★ 旧值已进 history，没有丢）：\n` +
      `  旧：${card.summary}\n  新：${next}\n  为什么改：${reason}\n` +
      `  history 现 ${history.length} 条 —— get_dsl query=todo 可逐条看 from/to/reason。`,
    feature,
    data: { todo_id: id, from: card.summary, to: next, reason, history_count: history.length },
  };
}

/**
 * `todo.retire` —— 作废：**卡留在册里**，但**不再出现在待办里**。
 *
 * ## 语义（照 `design-principles` §6.7 的三步退役流，不发明第二套）
 * 文件那边是 `lifecycle={status:'deprecated', retire_reason}`；这里同一个词、同一条纪律：
 * 「这条**曾经有效**，被新的取代了」⇒ 卡留着（历史有价值），理由落卡上（能考古）。
 *
 * ## 状态落在哪
 * `state` 置 **`void`**（复用既有终态，不新造第 5 个态 —— 理由见 `TaskSpec.retire_reason` 的注释）。
 * ⇒ 「不在待办里」不是靠这条 op 自己保证的，而是靠**既有的那把尺** `isClosedTaskState`：
 *   `get_dsl query=todo` 默认只列活卡 ⇒ 作废的卡自动出去（不需要在读端再写一条 if）。
 *
 * ## 迁移存在性读迁移表
 * `assertTransition(card.state, 'void', …)` —— 谁能作废由 `task_machine.TRANSITIONS` 一处回答。
 */
function retireTodoCard(feature: string, id: string, data: Record<string, unknown>, agent?: string): EditResult {
  assertNoIdentityChange('retire', data);
  const reason = String(data.reason ?? '').trim();
  const { dsl, card } = findTodoCard(feature, 'retire', id);

  if (isClosedTaskState(card.state)) {
    throw new Error(
      `todo.retire 被拒：${id} 已经是 ${card.state}（了结的卡不能再作废一次）。` +
        (card.retire_reason ? `\n  已记录的作废理由：${card.retire_reason}` : '') +
        `\n★ 它**还在册里**（这正是 retire 的意义）—— 用 get_dsl query=todo state=void 能查到。`,
    );
  }
  // ★ 提示（不是第二份判据）：`t_void` 的 from 只有 candidate ⇒ **已被领的卡退不了**。
  //   ★ 真判据仍是下面那行 `assertTransition`（读迁移表）；这里只是把「该怎么办」提前说清 ——
  //     否则调用方只会看到「可走：candidate / done」，还得自己去翻迁移表才知道要先 release。
  if (card.state === 'claimed') {
    throw new Error(
      `todo.retire 被拒：${id} 正被 ${card.owner ?? '（空 owner）'} 领取着 —— 迁移表里作废只从 candidate 走（t_void）。\n` +
        `★ 两条正路：① 先 \`release\`（data.reason）交回候选，再 retire；② 其实已经干完了 ⇒ 走 \`complete\`。\n` +
        `★ 为什么不让 claimed 直接作废：那会让「谁领的、干到哪」凭空断掉（release 才是留痕的放下动作）。`,
    );
  }
  assertTransition(card.state, 'void', 'todo.retire');

  const at = new Date().toISOString();
  // ★★★ 2026-10-22（链 C · 身份归一化）：`retired_by` 与 claim 的 `owner` 同一套规范（老格式补前缀 + 留痕）。
  const sign = signTaskActor(agent, 'todo.retire 的署名（retired_by）');
  writeTask(feature, id, {
    ...card,
    state: 'void',
    retire_reason: reason,
    retired_at: at,
    ...(sign.actor ? { retired_by: sign.actor } : {}),
  });

  // ★★★ 2026-10-21（跑环继任链）：作废一环时**只报、不改别人的卡** ——
  //   后面的环**不会**被级联作废（那会杀掉可能仍然有效的活；用户 2026-10-21 明确否掉）。
  const kids = (dsl.todos ?? []).filter((t) => t.follows === id);

  return {
    message:
      `已作废 todo "${id}"（★ 卡**留在册里**，只是不再进待办）` +
      `${kids.length ? ` · 下挂 ${kids.length} 个下一环（★ 不级联作废）` : ''}：\n` +
      `  为什么：${reason}\n` +
      `  state=void · retired_at=${at}${sign.actor ? ` · retired_by=${sign.actor}${normalizedInline(sign.adm)}` : ''}\n` +
      `★ 之后：get_dsl query=todo **不再列它**；get_dsl query=todo state=void 仍能查到（含 retire_reason）。` +
      (kids.length
        ? `\n★ 它下面还挂着 ${kids.length} 个下一环（${kids.map((t) => t.id).join(' / ')}）—— **不会**被自动作废\n` +
          `  （级联会杀掉可能仍然有效的活）；它们在 query=todo 里会标「上一环已作废」。\n` +
          `  ★ 真要一起废 ⇒ 逐张 retire（每张留自己的理由）；确实是新开一条 ⇒ 用 todo.follows 把它们摘下来/重接。`
        : '') +
      normalizedActorNote(sign.adm),
    feature,
    data: { todo_id: id, state: 'void' as TaskState, retire_reason: reason, retired_at: at },
  };
}

/**
 * `todo.delete` —— **物理删**，只给「从未生效的误建」用。
 *
 * ## 判据是机器判的，不是自觉
 * 「从未生效」= `state === 'candidate'` **∧** 没被领过（`claimed_at` 空）**∧** 一条证据都没有。
 * 任一不满足 ⇒ **拒**，并指路 `retire`。
 * ⇒ 这样「retire 还是 delete」不是靠文档约定，而是**发错就报错**（本仓的纪律：判据要有执行者）。
 *
 * ## 删了以后怎么追溯（★ 不是无声消失）
 * ① 卡从 `todos[]` 移出；② 整张卡（原样）追加进墓碑日志 `<feature>.journal.jsonl`。
 * ★ **顺序有意义**：先落盘、后写墓碑 —— 墓碑写失败会抛 ⇒ `edit_dsl` 把整批回滚成调用前的字节
 *   ⇒ 不会出现「卡没了、也没留痕」这一格。
 */
function deleteTodoCard(feature: string, id: string, data: Record<string, unknown>, agent?: string): EditResult {
  assertNoIdentityChange('delete', data);
  const reason = String(data.reason ?? '').trim();
  const { dsl, card } = findTodoCard(feature, 'delete', id);

  // ★★★ 2026-10-21（跑环继任链）：**有下一环就不许物理删** —— 删掉后它们的 `follows`
  //   就指向册上没有的 id（正是写端入口要拒的"悬挂引用"，G）。
  //   留一条"删完才发现链断了"的路，比当场拦住坏得多。
  const kids = (dsl.todos ?? []).filter((t) => t.follows === id);
  if (kids.length > 0) {
    throw new Error(
      `todo.delete 被拒：${id} 下面还挂着 ${kids.length} 个下一环（${kids.map((t) => t.id).join(' / ')}）—— 删了它们就成孤儿（follows 指向不存在的 id）。\n` +
        `★ 三条路：① 先把这几张的 follows 摘掉 / 重接（todo.follows，data.follows=null 或另一环的 id）；\n` +
        `  ② 这条链确实废了 ⇒ todo.retire（卡**留在册里**，子环仍能查到"上一环已作废"）；\n` +
        `  ③ 它们本来就是误建 ⇒ 先把子环 delete 掉，再删这一张。`,
    );
  }

  const evidenceCount = card.evidence?.length ?? 0;
  const tookEffect = card.state !== 'candidate' || !!card.claimed_at || evidenceCount > 0;
  if (tookEffect) {
    throw new Error(
      `todo.delete 被拒：${id} **曾经生效过**（state=${card.state}` +
        (card.claimed_at ? `，claimed_at=${card.claimed_at}` : '') +
        (evidenceCount ? `，evidence ${evidenceCount} 条` : '') +
        `）⇒ 这不是误建，是历史。\n` +
        `★ 判据（机器判，不靠自觉）：delete 只放行「candidate ∧ 从未被 claim ∧ 一条证据都没有」的卡。\n` +
        `  · **retire**：这条曾经有效、被新的取代了（历史有价值）⇒ todo.retire，reason 点名取代它的那张\n` +
        `  · **delete**：这条从未生效、纯粹误操作 ⇒ 才是这里`,
    );
  }

  const at = new Date().toISOString();
  const todos = (dsl.todos ?? []).filter((t) => t.id !== id);
  const nextDsl = { ...dsl, todos };
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
  saveDesignSheet(applyOverlay(nextDsl, ov));
  const journal = appendTodoTombstone(feature, {
    kind: 'todo.delete',
    at,
    ...(agent ? { by: agent } : {}),
    reason,
    card,
  });

  return {
    message:
      `已物理删除 todo "${id}"（★ 它从未生效，所以是误建而不是历史）：\n` +
      `  为什么删：${reason}\n` +
      `  墓碑：${journal}（整张卡原样留在那里 ⇒ 仍然可追溯）\n` +
      `★ 待办里不再有它；要查「删过什么」⇒ get_dsl query=todo 的 deleted 段。`,
    feature,
    data: { todo_id: id, deleted: true, reason, journal, summary: card.summary },
  };
}

/**
 * `todo.move_to_history` —— **已了结的卡出册入史**（`todos[]` 从此只放活卡）。
 *
 * ## 它回答的问题（用户 2026-10-23 原话）
 * 「void 卡本身不是也应该被归档进历史里吗？为什么还放在 To Do 里？……给它单独建一张 history 的表，
 *   然后给它归纳进去，要查的话你就搜索 history」
 *
 * ## 与 `archive` / `delete` 的三分（★ 别混：三个 op 回答三个不同的问题）
 * | op | 卡还在 `todos[]` 吗 | 还能 claim / relaunch 吗 | 数据去哪 |
 * |---|---|---|---|
 * | `archive`（软归档） | 在 | 能（先 `unarchive`） | 册上，盖 `archived_at` |
 * | `move_to_history`（本 op） | **不在** | **不能**（历史只读） | `.agent-io/task-history.db` 的 `task_history` |
 * | `delete` | 不在 | 不能 | 墓碑 `<feature>.journal.jsonl`（只给"从未生效的误建"） |
 *
 * ## ★★★ 顺序（本 op 唯一的失败契约）
 * **先写历史表成功，再从 `todos[]` 移除并落盘**；落盘失败 ⇒ **撤掉刚写的那一批行**
 * （`dropTaskHistoryBatch`，按 `moved_at` 精确匹配）。
 * ⇒ 任何一种失败都不会出现「册上没了、历史里也没有」（那才是真丢卡）；
 *   最坏情形是「两边都有」—— 可重跑，因为历史 append-only 且每次 `moved_at` 不同。
 *
 * ## 判据（任一不过 ⇒ 整批不做）
 * ① 每张卡都必须在 `todos[]` 里（清单里有一个错 id 就不猜其余几张）；
 * ② 只有**已了结**（`isClosedTaskState`：done / void）的卡能入史 —— 活卡入史 = 让正在干的活消失；
 * ③ **还有下一环挂在它下面** ⇒ 拒（与 `delete` 同一条纪律：入史后那些 `follows` 会指向册上不存在的 id）；
 * ④ `data.reason` 必填（由 `OP_SPECS.required.move_to_history` 先拒）—— 理由**落库**，不只活在回执里。
 *
 * ## 它顺带做的一件事：摘掉 `node.task` 派生投影
 * `todos[]` 是权威、`node.task` 只是投影（见 `withCardWritten` 的注释）。卡出册后若把投影留在节点上，
 * `pool` 的 `todosForNode(node.id, todos).length === 0` 会让它**重新被当成节点卡数进池**
 * ⇒ 那就是"移走了、To Do 里还在"。所以**同一个 id** 的投影必须一起摘掉（节点上另一张卡不动）。
 *
 * ## 边界（★ 如实写明）
 * · 入史**不可逆**：`relaunch` / `reopen` 都按 id 在 `todos[]` 里找卡 ⇒ 出册后就找不到。
 *   要重做 ⇒ `todo.add` 一张新卡（summary 里点名它接的是哪段历史）。
 * · 本 op **不改 state**、**不改 card_json 一个字节** —— 它只是"换一张表"。
 */
/**
 * `excluded.update` —— **设计册排除清单的唯一写端**（2026-10-24，裁 A）。
 *
 * ## 它回答的问题
 * 沉默缺口 = 「盘上有 ∧ 册上无 ∧ 无 excluded_reason」。册上无的文件连节点都没有 ⇒
 * `excluded_reason` 挂不上 ⇒ 排除**没有落点**（实测 176 个缺口里 ~160 个是量具/夹具，
 * 它们本来就不该进设计册——该走的是册子级声明，不是批量建壳节点）。
 *
 * ## 形状
 * `dsl.excluded = [{path, reason}]`，path 支持目录前缀（如 `"certs/"`）。
 * 读端：`design_line report` ⑥（沉默缺口过滤）、未来的对账读数 —— 一处声明，处处引用。
 */
export function applyExcludedOp(feature: string, data: Record<string, unknown>): EditResult {
  const raw = data.excluded;
  if (!Array.isArray(raw)) {
    throw new Error('excluded.update 需要 data.excluded（数组：[{path, reason}]，path 支持目录前缀如 "certs/"）');
  }
  const normalized = raw.map((e) => {
    const p = typeof (e as { path?: unknown }).path === 'string' ? String((e as { path: string }).path).trim() : '';
    const r = typeof (e as { reason?: unknown }).reason === 'string' ? String((e as { reason: string }).reason).trim() : '';
    if (!p) throw new Error(`excluded.update 的每条都要有非空 path（收到 ${JSON.stringify(e)}）`);
    if (!r) throw new Error(`excluded.update 的每条都要有非空 reason（排除是管辖范围声明，要说清为什么不管——${p}）`);
    return { path: p, reason: r };
  });
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);
  const next = { ...dsl, excluded: normalized } as typeof dsl;
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(next);
  saveDesignSheet(applyOverlay(next, ov));
  return {
    message:
      `已把 feature "${feature}" 的排除清单更新为 ${normalized.length} 条（path 支持目录前缀）：\n` +
      normalized.map((e) => `  · ${e.path} —— ${e.reason}`).join('\n') +
      `\n★ 之后：design_line report 的沉默缺口、未来的对账读数都会跳过这些路径（显式排除 = 账面声明，不再是沉默缺口）。`,
    feature,
    data: { excluded: normalized },
  };
}

function moveTodoCardsToHistory(feature: string, data: Record<string, unknown>, agent?: string): EditResult {
  const raw = data.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `todo.move_to_history 需要 data.ids（**非空**数组：要入史哪几张，逐张列 id）。\n` +
        `★ 与 todo.archive 同一条纪律：**没有**「把所有已了结的都移走」这种开关 —— 那种开关会在某天顺手吃掉别人刚 done 完的卡。`,
    );
  }
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) {
    throw new Error('todo.move_to_history 的 data.ids 里没有任何有效 id（全是空串）⇒ 什么都不做，也不假装做了。');
  }
  const reason = String(data.reason ?? '').trim();
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 —— todo 住在设计 DSL 的顶层 todos[]。`);

  const todos = dsl.todos ?? [];
  // ★ 2026-10-24（闭环⑨补全）：**两处找卡** —— todos[]（todo 卡）与 geometry.nodes[].task（publish 产的节点卡）。
  //   此前只扫 todos[] ⇒ done 的节点卡永远入不了史（实测被拒两次）。同一张表、同一条纪律。
  const nodes = dsl.geometry?.nodes ?? [];
  const picked: TaskSpec[] = [];
  for (const id of ids) {
    const cur =
      todos.find((t) => t.id === id) ??
      (nodes.find((n) => (n.task as TaskSpec | undefined)?.id === id)?.task as TaskSpec | undefined);
    if (!cur) {
      throw new Error(
        `todo.move_to_history 被拒：todos[] 与节点任务格里都没有 "${id}"（★ 整批不落盘 —— 清单里有一个错 id，就不猜其余几张要不要动）。\n` +
          `★ 两条常见来路：① 它已经入史 ⇒ 用 \`get_dsl { query:'history', feature:'${feature}', card_id:'${id}' }\` 查；` +
          `② id 记错了 ⇒ \`get_dsl query=todo state=all\` 拿一遍当前 id。`,
      );
    }
    if (!isClosedTaskState(cur.state)) {
      throw new Error(
        `todo.move_to_history 被拒："${id}" 是 ${cur.state}（**未了结**）—— 只有已了结（done / void）的卡能入史。\n` +
          `★ 活卡入史 = 让执行中的任务从待办里消失（而且 claim / relaunch 都按 id 找卡 ⇒ 届时无法再取回）。\n` +
          `★ 真要收尾 ⇒ 先 complete / retire。`,
      );
    }
    picked.push(cur);
  }

  // ★ 判据③：入史后不能留下悬挂的 follows（与 todo.delete 的"有下一环就不许删"同一条纪律）
  const idSet = new Set(picked.map((c) => c.id));
  const stillInBook = todos.filter((t) => !idSet.has(t.id));
  const orphans = stillInBook.filter((t) => t.follows && idSet.has(t.follows));
  if (orphans.length) {
    throw new Error(
      `todo.move_to_history 被拒：${orphans.length} 张仍在册的卡把 \`follows\` 指向本批要入史的卡（${orphans
        .map((t) => `${t.id}→${t.follows}`)
        .join(' / ')}）。\n` +
        `★ 入史后它们的上一环就不在册上了（\`buildTodoChains\` 会把它读成**悬挂**，那是假警报）。\n` +
        `★ 三条路：① 把这些下一环**一并**列进 data.ids（同批入史）；② 它们的上一环还有活着的环 ⇒ 先 todo.follows 重接；③ 留在册里（不列它）。`,
    );
  }

  // ★ 投影清单**先算好**（纯读、不抛）—— 写表之后只剩「落盘」一件事，失败窗口最小
  //   （nodes 已在上方两处找卡时定义；idSet 含 todos 卡与节点卡 ⇒ 节点卡的投影一并摘掉）
  const mirrored = nodes.filter((n) => n.task && idSet.has(String((n.task as TaskSpec).id)));

  const movedAt = new Date().toISOString();
  const rows: TaskHistoryRow[] = picked.map((card) => ({
    id: card.id,
    feature,
    ...(card.node_id ? { node_id: card.node_id } : {}),
    state: card.state,
    summary: card.summary,
    // ★ 整张卡原样：evidence / retire_reason / history[] / read_set 一个字节都不动（审计数据不许摘要化）
    card_json: JSON.stringify(card),
    moved_at: movedAt,
    reason,
  }));
  // ★★★ 第一步：写历史表（失败 ⇒ 抛，todos[] 一个字节没动）
  recordTaskHistory(rows);

  // ★★★ 第二步：从册上移除（顺带摘掉同 id 的 node.task 投影）
  //   ★★ **整段都在 try 里**：从「写表成功」到「落盘成功」之间任何一步抛都必须撤表。
  //      实测（2026-10-23 消融）：把装 nextDsl 那几行漏在 try 外时，中途一抛就留下
  //      「册上还在、历史里也有一条」的残行 —— 那不是"两边都没有"，但同样是脏账。
  //      ⇒ 判据不写成"这几行不会抛"（改一行就破），而是**构造上就在同一段保护里**。
  try {
    let nextDsl: typeof dsl = { ...dsl, todos: stillInBook };
    if (mirrored.length) {
      const nextNodes = nodes.map((n) =>
        n.task && idSet.has(String((n.task as TaskSpec).id)) ? { ...n, task: undefined } : n,
      );
      nextDsl = { ...nextDsl, geometry: { ...dsl.geometry!, nodes: nextNodes } };
    }
    const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
    saveDesignSheet(applyOverlay(nextDsl, ov));
  } catch (e) {
    // ★ 反向补偿：表已经写进去了，册没落下 ⇒ 撤掉这一批（两边都不留半截）
    const dropped = dropTaskHistoryBatch(feature, movedAt);
    throw new Error(
      `todo.move_to_history 失败：历史表已写入 ${rows.length} 行，但**设计册落盘失败**（${(e as Error).message}）。\n` +
        `★ 已按 moved_at=${movedAt} 撤掉刚写的 ${dropped} 行，todos[] 一个字节没动（不出现"两边都没有"）。`,
    );
  }

  const byState: Record<string, number> = {};
  for (const c of picked) byState[c.state] = (byState[c.state] ?? 0) + 1;
  const dist = Object.entries(byState)
    .map(([s, n]) => `${s} ${n}`)
    .join(' · ');
  return {
    message:
      `已把 ${picked.length} 张已了结卡移入历史（★ 出册：todos[] 里不再有它们）· ${dist}：\n` +
      `  落点：${getTaskHistoryFile()} 的 task_history 表（feature=${feature} · moved_at=${movedAt}）\n` +
      `  todos[]：${todos.length} → ${stillInBook.length} 张` +
      (mirrored.length ? ` · 同时摘掉 ${mirrored.length} 个 node.task 派生投影` : '') +
      `\n  为什么：${reason}${agent ? ` · 谁：${agent}` : ''}\n` +
      `★ 之后：get_dsl query=todo **不再列**它们（不是被藏了，是换了一张表）；` +
      `要查 ⇒ \`get_dsl { query:'history', feature:'${feature}' }\`（可按 card_id / state / search 过滤，card_json 是整张卡原样）。\n` +
      `★ 历史**只读**：入史的卡不能再 claim / relaunch；要重做 ⇒ todo.add 一张新卡。`,
    feature,
    data: {
      moved: picked.map((c) => c.id),
      by_state: byState,
      todos_before: todos.length,
      todos_after: stillInBook.length,
      node_projections_cleared: mirrored.map((n) => n.id),
      moved_at: movedAt,
      history_file: getTaskHistoryFile(),
    },
  };
}

/**
 * `todo.archive` / `todo.unarchive` —— **软归档**：卡留在册，只是**不再进活态**。
 *
 * ## 语义（一句话）
 * 归档 = 给一张**已了结**的卡盖一个时间戳（`archived_at`）。`state` 一个字节不改
 * （done / void 仍**是两种结局**，归档不是第 5 个状态），只是池 / 待办默认列表不再列它。
 *
 * ## 为什么是软归档，不是把卡搬进 `archive[]`
 * 三处读端**按 id 找卡**：`loadTask`（重开一张卡）、`follows` 链（`todoChainNote` 要读回父卡）、
 * `claim_conflict`（扫全量算读集）—— 物理搬走会把三处一起打断（卡里实测过）。
 * 软归档**零迁移风险、可回滚**；代价只是册子体积不减（按年分片是后续另一件事）。
 *
 * ## 为什么 `data.ids` 是**显式清单**（不做 `state=closed` 这种开关）
 * 一个"归档所有已了结的卡"的开关，某天会在别人刚 done 完还没看完的时候把它吃掉。
 * 批量是必须的（存量一次 100+ 张，一张一 op = 每张读写一遍 5 MB 的册子），
 * 但**名字要点全**：归档哪几张，调用方自己列。
 *
 * ## 判据（任一不满足 ⇒ **整批回滚**；`edit_dsl` 是事务）
 * ① 每张卡都必须在册上（找不到 ⇒ 拒，不静默跳）；
 * ② 只有**已了结**（`isClosedTaskState`）的卡能归档 —— 归档一张 claimed 的卡 = 让正在干的活消失；
 * ③ `archive` 的 `data.reason` 必填且**落卡上**（`archived_reason`，不只活在回执里）；
 * ④ 已归档的**跳过**（幂等），并在回执里点名 —— 不重复盖时间戳（否则「何时归档的」会变成最后一次调用的时刻）。
 *
 * ## `unarchive` 为什么不收 reason
 * 它是**去掉一层标记**，不是一次有内容的决定：清掉 `archived_at` / `archived_by`，**保留** `archived_reason`
 * （=「上一次为什么归档」，照 `reopened_at` 结清后 `reopen_reason` 仍留着的先例）。
 * 真正有理由的那一步必然是随后的 `claim` / `reopen`（那两处都要 `reason` 且会落卡）。
 * ★ 所以这里**不编一个只活在回执里的理由**（那正是本仓说的"回执会丢"）。
 */
function applyArchiveOp(
  feature: string,
  data: Record<string, unknown>,
  agent: string | undefined,
  mode: 'archive' | 'unarchive',
): EditResult {
  const raw = data.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `todo.${mode} 需要 data.ids（**非空**数组：要${mode === 'archive' ? '归档' : '恢复'}哪几张，逐张列 id）。\n` +
        `★ 这里**故意没有**「归档所有已了结的」这种开关：那种开关会在某天顺手吃掉别人刚 done 完的卡。`,
    );
  }
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) throw new Error(`todo.${mode} 的 data.ids 里没有任何有效 id（全是空串）⇒ 什么都不做，也不假装做了。`);
  if (mode === 'archive' && !String(data.reason ?? '').trim()) {
    throw new Error(`todo.archive 需要 data.reason（为什么归档 —— ★ 理由要落卡上，不只活在回执里）。`);
  }
  const reason = mode === 'archive' ? String(data.reason).trim() : '';
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 —— todo 住在设计 DSL 的顶层 todos[]。`);

  const at = new Date().toISOString();
  // ★ 署名与 claim 的 owner 同一套规范（老格式补前缀 + 留痕）—— 同 `retired_by` 的做法。
  const sign = mode === 'archive' ? signTaskActor(agent, 'todo.archive 的署名（archived_by）') : null;

  let working: NonNullable<ReturnType<typeof getDesignSheet>> = dsl;
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const cur = (working.todos ?? []).find((t) => t.id === id);
    if (!cur) {
      throw new Error(
        `todo.${mode} 被拒：todos[] 里没有 "${id}"（★ 整批不落盘 —— 清单里有一个错 id，就不猜其余几张要不要动）。\n` +
          `★ 两条常见来路：① 刚被 todo.delete 过（墓碑在 ${todoJournalFile(feature)}）；② id 记错了 ⇒ get_dsl query=todo state=all 拿一遍当前 id。`,
      );
    }
    if (mode === 'archive') {
      if (isArchivedTask(cur)) {
        skipped.push(id); // 幂等：不重复盖时间戳
        continue;
      }
      if (!isClosedTaskState(cur.state)) {
        throw new Error(
          `todo.archive 被拒："${id}" 是 ${cur.state}（**未了结**）—— 归档只给已经结束的卡（done / void）。\n` +
            `★ 归档一张还在跑的卡 = 让正在干的活从待办里消失（静默丢活）。真要收尾 ⇒ 先 complete / retire。`,
        );
      }
      const next: TaskSpec = {
        ...cur,
        archived_at: at,
        ...(sign?.actor ? { archived_by: sign.actor } : {}),
        archived_reason: reason,
      };
      assertCardWritable(id, next);
      working = withCardWritten(working, id, next);
      changed.push(id);
    } else {
      if (!isArchivedTask(cur)) {
        skipped.push(id); // 幂等：本来就在活态
        continue;
      }
      const next: TaskSpec = { ...cur };
      // ★ 摘标记必须写 `undefined`，**不能** `delete next.archived_at`（同 `todo.follows` 摘链那条实测）：
      //   `withCardWritten` 是 `{...旧卡, ...新卡}` 合并 ⇒ 新卡上"没有这个键"合并出来仍是**旧值**。
      next.archived_at = undefined;
      next.archived_by = undefined;
      assertCardWritable(id, next);
      working = withCardWritten(working, id, next);
      changed.push(id);
    }
  }

  if (changed.length) {
    const ov = loadOverlay(feature) ?? seedOverlayFromDsl(working);
    saveDesignSheet(applyOverlay(working, ov));
  }

  const todos = working.todos ?? [];
  const live = todos.length - todos.filter((t) => isArchivedTask(t)).length;
  const archivedTotal = todos.length - live;
  const head =
    mode === 'archive'
      ? `已归档 ${changed.length} 张 todo（★ 卡**留在册里**，只是不再进活态：池 / 待办默认列表不再列它们）`
      : `已把 ${changed.length} 张 todo **恢复**到活态（清掉 archived_at，state 本来就没变）`;
  return {
    message:
      `${head}${skipped.length ? ` · 跳过 ${skipped.length} 张（${mode === 'archive' ? '本来就已经归档' : '本来就在活态'}）` : ''}：\n` +
      (changed.length ? `  ${changed.join('\n  ')}\n` : '') +
      (skipped.length ? `  ★ 跳过：${skipped.join(' / ')}\n` : '') +
      `  读数：todos[] 共 ${todos.length} 张 —— 活态 ${live} · 归档 ${archivedTotal}` +
      (mode === 'archive'
        ? `\n  archived_at=${at}${sign?.actor ? ` · archived_by=${sign.actor}${normalizedInline(sign.adm)}` : ''}\n` +
          `★ 之后：get_dsl query=todo（待办）不再列它们；\`state=done|void|all\` 仍**查得到**（每张带 archived_at）；` +
          `\`loadTask\` 按 id 照旧能取到（重开一张卡要先用 \`todo.unarchive\` 把它放回活态）。`
        : `\n★ 之后：它们重新进池 / 待办；archived_reason **保留**（= 上一次为什么归档，供审计）。`) +
      (sign ? normalizedActorNote(sign.adm) : ''),
    feature,
    data: {
      archived: mode === 'archive' ? changed : [],
      unarchived: mode === 'unarchive' ? changed : [],
      skipped,
      ...(mode === 'archive' ? { archived_at: at } : {}),
      live,
      archived_total: archivedTotal,
    },
  };
}

/**
 * `todo.follows` —— **把一张卡接到另一张卡下面**（或摘下来成为链根）。
 *
 * ## 为什么不是 `update`
 * `update` 回答的是「这张卡**要做什么**变了吗」（旧值压 `history[]`）；`follows` 回答的是
 * 「它在**哪条链**上」。内容变更与结构变更是两件事 —— 混进一个 op，迟早有人以为改 `summary`
 * 会带着链一起走（或者反过来：改链时会顺手把 history 写脏）。
 *
 * ## 为什么必须有这个 op（而不是只在 add 时给 follows）
 * ① 接错链要能改：否则只能 `retire` 重立一张，把证据一起丢掉；
 * ② ★ 它是**唯一能造出环**的入口（`add` 只加叶子）⇒ 无环判据（H）真正被考到的地方在这里，
 *   若没有它，「链必须无环」这条门就只是一句注解。
 *
 * ## 判据
 * · **活卡才能改链**（`done` / `void` 是了结的卡 —— 与 `update` 同一条纪律）；
 * · `data.follows` = 上一环 id，或字面 `null` = 摘下来（成链根）；
 *   ★ 给空串**不算**「摘」：那是忘记填。两种意图必须能被区分，工具不替调用方猜；
 * · 校验 = `assertFollowsTarget`（自指 / 悬挂 / 接作废卡 / 成环）—— **唯一一处**。
 */
function followTodoCard(feature: string, id: string, data: Record<string, unknown>, agent?: string): EditResult {
  assertNoIdentityChange('follows', data);
  const reason = String(data.reason ?? '').trim();
  const { dsl, card } = findTodoCard(feature, 'follows', id);

  if (isClosedTaskState(card.state)) {
    throw new Error(
      `todo.follows 被拒：${id} 已经是 ${card.state}（了结的卡不改链的位置 —— 改了就是改写它和上一环的关系）。\n` +
        `★ 要在旧结论之上开新活 ⇒ 新 add 一张并给 data.follows="${id}"（那就是**下一环**，不是改这一环）。`,
    );
  }
  if (!('follows' in data)) {
    throw new Error(
      `todo.follows 需要 data.follows：上一环的 todo id，或字面 null（= 摘下来，成为链根）。\n` +
        `★ 不传这个键与传 null **不是一回事**：前者是"忘记填"，后者是"明确摘链" —— 工具不替调用方猜。`,
    );
  }
  const raw = data.follows;
  if (raw !== null && typeof raw !== 'string') {
    throw new Error(`todo.follows 被拒：data.follows 要么是上一环的 todo id（字符串），要么是字面 null —— 收到 ${typeof raw}。`);
  }
  const target = raw === null ? null : raw.trim();
  if (target === '') {
    throw new Error(
      `todo.follows 被拒：data.follows 是空串 —— 要接谁就写谁的 id；要**摘下来**（成为链根）请给字面 null。`,
    );
  }

  const todos = [...(dsl.todos ?? [])];
  if (target) assertFollowsTarget(todos, id, target);

  const next: TaskSpec = { ...card };
  // ★★★ 摘链必须写 `undefined`，**不能** `delete next.follows`：
  //   `writeTask` 是 `{...旧卡, ...新卡}` 合并 ⇒ 新卡上"没有这个键"合并出来仍是**旧值**（实测踩过）。
  //   写 undefined ⇒ 合并后是 undefined ⇒ 落盘时 JSON 丢掉这个键（正是「摘下来」的语义）。
  next.follows = target ?? undefined;
  writeTask(feature, id, next);

  const idx = buildTodoChains(todos.map((t) => (t.id === id ? next : t)));
  const place = idx.places.get(id)!;
  return {
    message:
      (target
        ? `已把 todo "${id}" 接到 "${target}" 下面（${chainBadge(place)}）。\n`
        : `已把 todo "${id}" **摘下来**（它现在是链根：${chainBadge(place)}）。\n`) +
      `  为什么改：${reason}${agent ? ` · 谁：${agent}` : ''}\n` +
      `★ 环次是**现算**的（不落盘）：改它之前的下一环、之前的上一环，展示会立刻跟着变。`,
    feature,
    data: { todo_id: id, follows: target, chain: place },
  };
}

/** 四个「改/作废/删/接链」op 的分发（id 的存在由 `OP_SPECS` 的 `opsRequiringId` 保证）。 */
function applyTodoMutation(
  feature: string,
  op: { op: string; id?: string; data?: Record<string, unknown> },
  agent?: string,
): EditResult {
  const id = op.id as string;
  const data = op.data ?? {};
  switch (op.op) {
    case 'update':
      return updateTodoCard(feature, id, data, agent);
    case 'follows':
      return followTodoCard(feature, id, data, agent);
    case 'retire':
      return retireTodoCard(feature, id, data, agent);
    case 'delete':
      return deleteTodoCard(feature, id, data, agent);
    // ★★★ 2026-10-22（软归档）：批量、按 `data.ids`（**不要 id** —— 见 `applyArchiveOp` 文件头）
    case 'archive':
      return applyArchiveOp(feature, data, agent, 'archive');
    case 'unarchive':
      return applyArchiveOp(feature, data, agent, 'unarchive');
    // ★★★ 2026-10-23（history 表）：已了结卡**出册入史**（批量、按 data.ids —— 同 archive）
    case 'move_to_history':
      return moveTodoCardsToHistory(feature, data, agent);
    default:
      throw new Error(
        `todo 不支持操作: ${op.op}（改/接链/作废/删分别是 update / follows / retire / delete；软归档/恢复是 archive / unarchive；出册入史是 move_to_history）`,
      );
  }
}

/**
 * `complete` 的**链提示**（★ 只出文本，**不阻塞**）。
 *
 * ## 为什么返回两段（`head` / `detail`）
 * `edit_dsl` 的批量回执**只保证被看见的是首行**（`update_feature.ts`：「摘要 = 首行 ⇒ op 的首行必须自足」）
 * ⇒ 提示写在第 3 行等于没写。所以：
 * · `head` = **接在首行末尾**的一句（链位置 + 三种形态之一）；
 * · `detail` = 展开说明（挂在后面，完整文本里仍能看到）。
 *
 * ## 三种形态（这一张卡刚收口之后）
 * 1. **没有下一环** ⇒ 「链到头了」+ 明确给出登记下一环的那一行调用；
 * 2. **有下一环、还没走完** ⇒ 点名还开着的是哪几环（state + owner）；
 * 3. **下面的环都了结** ⇒ 「整条链走完了」。
 *
 * ★ 为什么只提示不拦（用户 2026-10-21 的纪律）：「**提示阻塞就会有人为了过而乱填**」——
 *   链的价值在**如实**，不在**齐全**：确实收尾的活就该允许它到头。
 *
 * ★ 断链也在这里说一句（上面某一环 `void`）：本环仍成立，只是链在上面断了 —— 不级联作废。
 */
function todoChainNote(cards: readonly TaskSpec[], id: string): { head: string; detail: string } {
  const idx = buildTodoChains(cards);
  const place = idx.places.get(id);
  if (!place) return { head: '', detail: '' };
  const byId = new Map(cards.map((t) => [t.id, t]));
  const parent = place.parent ? byId.get(place.parent) : undefined;
  const pos = place.branch ? `链第 ${place.depth} 环（支环）` : `链 ${place.depth}/${place.total}`;

  // 下一环（含支环）里还有谁开着 —— BFS 走 children，不假设一条直线
  const open: string[] = [];
  const queue = [...place.children];
  const seen = new Set<string>();
  while (queue.length) {
    const x = queue.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    const c = byId.get(x);
    if (!c) continue;
    if (!isClosedTaskState(c.state)) open.push(x);
    queue.push(...(idx.places.get(x)?.children ?? []));
  }

  const lines: string[] = [
    `★ 链位置：${chainBadge(place)}` + (parent ? ` · 上一环 ${parent.id}（${parent.state}）` : '（链根）'),
  ];
  let head = ` · ${pos}`;
  if (place.broken) {
    head += ` · ⚠ 上一环已作废(${place.broken.id})`;
    lines.push(
      `★ 链在上面断了：${place.broken.id} 已作废（void` +
        (place.broken.reason ? `：${place.broken.reason}` : '') +
        `）—— **本环仍然成立**，也没有任何卡被级联作废。`,
    );
  }

  if (place.children.length === 0) {
    head += ` · 链到头了（有下一环就 add data.follows="${id}"）`;
    lines.push(
      `★ 这条链**到头了**（本卡是第 ${place.depth} 环${place.branch ? '，支环' : `/${place.total}`}）—— ` +
        `收尾就到此为止；若「做完发现还有新的」⇒ 在**这张卡**下面登记下一环：\n` +
        `    edit_dsl { type:'todo', op:'add', data:{ summary:'…', follows:'${id}' } }\n` +
        `  ★ 只是提示：链可以在这里结束，不必为了凑环数硬填。`,
    );
  } else if (open.length === 0) {
    head += ` · 整条链走完了`;
    lines.push(
      `★ **整条链走完了**（本卡是第 ${place.depth} 环，下面的环已全部了结）。` +
        `\n  ★ 新的一环该接在**最后一个环**下面（不是接在本卡上，否则环次会错）。`,
    );
  } else {
    head +=
      ` · 下一环还没走完：` +
      open.map((x) => `${x}（${byId.get(x)?.state}）`).join(' / ');
    lines.push(
      `★ 下一环还没走完：` +
        open
          .map((x) => `${x}（${byId.get(x)?.state}${byId.get(x)?.owner ? `，owner=${byId.get(x)!.owner}` : ''}）`)
          .join(' / ') +
        `\n  ★ 要再加一环 ⇒ 接在**最后一个活环**下面（follows 指向它，不要指向本卡）。`,
    );
  }
  return { head, detail: '\n' + lines.join('\n') };
}

export function applyTodoOp(
  feature: string,
  op: { op: string; id?: string; data?: Record<string, unknown> },
  agent?: string,
): EditResult {
  // ★★★ 2026-10-18：**promote = 只填 node_id（指向）**，不建卡、不改节点。
  //   预决策（todos[]）**只挂「决策 + 现象」**；**落地人**看 node_id 去读那里的设计 DSL、
  //   **重新设计**（改 decision / 加判据），改完再 `publish` 挂载 —— **建卡是 publish 的事**。
  //   ★ 早先版本会"从 decision 翻判据、建卡、todo 标 done" ⇒ **越权**（做了落地人 + publish 的活）；
  //     且建出来的卡判据不覆盖债（实测：validator.ts 4 条全是"符号存在"，债要的是"edges.id 唯一"）。
  //   ★ ★ 名字就叫 `link`（只是"指向"）—— 2026-10-18 从 promote 改名，因为 promote 暗示"升级/建卡"，而它不建。
  if (op.op === 'link') {
    const todoId = op.id;
    const nodeId = typeof op.data?.node_id === 'string' ? op.data.node_id.trim() : '';
    if (!todoId) throw new Error('todo.link 需要 id（要挂的 todo）');
    if (!nodeId) throw new Error('todo.link 需要 data.node_id（这张预决策归哪个节点）');

    const dsl0 = getDesignSheet(feature);
    if (!dsl0) throw new Error(`feature "${feature}" 不存在`);
    const todos0 = [...(dsl0.todos ?? [])];
    const ti = todos0.findIndex((t) => t.id === todoId);
    if (ti < 0) throw new Error(`todo.link 被拒：todos[] 里没有 "${todoId}"`);
    const cur = todos0[ti];
    // ★ 2026-10-21：读**既有那把尺**（`done`/`void` 都算了结），不在这里再抄一遍两个状态名。
    if (isClosedTaskState(cur.state)) {
      throw new Error(`todo.link 被拒：${todoId} 已了结（${cur.state}）—— 已作废/已完成的不再挂节点。`);
    }
    const node = (dsl0.geometry?.nodes ?? []).find((n) => n.id === nodeId);
    if (!node) throw new Error(`todo.link 被拒：geometry.nodes 里没有 "${nodeId}"`);

    // ★ 只改 todo：填 node_id。★ 状态不变（它还等人领）；★ 节点的 decision / task 一概不动。
    todos0[ti] = { ...cur, node_id: nodeId };
    const nextDsl = { ...dsl0, todos: todos0 };
    const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
    saveDesignSheet(applyOverlay(nextDsl, ov));

    return {
      message:
        `已把预决策 "${todoId}" 指向节点 "${nodeId}"（只填 node_id，不建卡）。\n` +
        `  · todo 状态仍是 ${cur.state}（等人领）\n` +
        `  · 该节点有没有 decision：${node.decision ? '有' : '★ 没有 —— 落地人得先给它写设计'}\n` +
        `★ 下一步（落地人）：读该节点的设计 DSL → 重新设计（改 decision / 加判据）→ publish 挂载 → 领 → 办。\n` +
        `★ 若无对应节点 ⇒ 别 link，就在 todos[] 里 claim → complete（凭 attestation）。`,
      feature,
      data: { todo_id: todoId, node_id: nodeId, todo_state: cur.state as TaskState },
    };
  }

  // ★★★ 2026-10-22（卡迁移）：`import` = 把 `geometry.nodes[].task` 里**已有的卡**逐字并进 `todos[]`。
  //   ★ 它与 `add` 的分工不是风格：`add` **造**一张卡（只能造出 candidate / owner=null），
  //     `import` **搬**一张卡（state / owner / claimed_at / evidence / read_set 一个字节不改）。
  if (op.op === 'import') return importTodoCards(feature, op.data ?? {}, agent);

  // ★★★ 2026-10-21：**改 / 作废 / 物理删** 三个 op 走同一处分发。
  //   ★ 它们的 id 由 `OP_SPECS` 的 `opsRequiringId` 保证（不是这里判的 —— 一处判据）。
  // ★ 2026-10-21：`follows`（跑环继任链：接链 / 摘链）走同一处分发 —— 它也是「按 id 动一张卡」的 op。
  if (
    op.op === 'update' ||
    op.op === 'follows' ||
    op.op === 'retire' ||
    op.op === 'delete' ||
    // ★★★ 2026-10-22（软归档）：归档/恢复也是「按清单动卡」，走同一处分发。
    op.op === 'archive' ||
    op.op === 'unarchive' ||
    // ★★★ 2026-10-23：入史也是「按清单动卡」⇒ 同一处分发
    op.op === 'move_to_history'
  ) {
    return applyTodoMutation(feature, op, agent);
  }

  if (op.op !== 'add') {
    throw new Error(`todo 仅支持 add / link / import / update / follows / retire / delete / archive / unarchive / move_to_history（收到 ${op.op}）`);
  }
  const data = op.data ?? {};
  // ★ 2026-10-21：`todo.add 需要 data.summary` **不在这里判** —— 判据只有一处 = `OP_SPECS.required.add`
  //   （`checkOpSpec` 在 `applyOperation` 入口跑，空串/全空白也算缺）。这里只做取值。
  const summary = String(data.summary ?? '').trim();

  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 —— todo 也住在设计 DSL 里（顶层 todos[]）。`);

  const next = { ...dsl };
  const todos = [...(next.todos ?? [])];

  const slug = summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'item';
  // ★ 允许 data.id 指定（批量导入债时用 `todo_<debt-id>`，便于追溯回 DESIGN.md#D-xxx）
  const wantId = typeof data.id === 'string' && /^todo_[A-Za-z0-9_-]+$/.test(data.id) ? data.id : null;
  let id = wantId ?? `todo_${slug}`;
  let k = 2;
  while (todos.some((t) => t.id === id)) {
    if (wantId) throw new Error(`todo.add 被拒：id "${wantId}" 已存在（指定的 id 不许覆盖）`);
    id = `todo_${slug}-${k++}`;
  }

  // ★★★ 2026-10-21（跑环继任链）：`data.follows` = **上一环的 todo id**（做完一环发现还有新的，
  //   就直接在这一环下面登记第二步、第三步）。
  //   ★ 校验只有一处 = `assertFollowsTarget`（自指 / 悬挂 / 接作废卡 / 成环）；
  //   ★ 它拒就**整张卡不建** —— 绝不留半条链（先建了再拒，册上就多一张解释不了的卡）。
  const rawFollows = data.follows;
  if (rawFollows !== undefined && typeof rawFollows !== 'string') {
    throw new Error(
      `todo.add 被拒：data.follows 必须是**上一环的 todo id**（字符串）—— 收到 ${typeof rawFollows}。\n` +
        `★ 第一环（链根）**不传** follows；要接在谁下面就写谁的 id。`,
    );
  }
  const follows = rawFollows === undefined ? '' : rawFollows.trim();
  if (follows) assertFollowsTarget(todos, id, follows);

  const card: TaskSpec = {
    id,
    summary,
    state: 'candidate',
    owner: null,
    // ★ 缺省 = 链根（不落 `follows: undefined`，让册上少一个空键）
    ...(follows ? { follows } : {}),
  };
  todos.push(card);
  next.todos = todos;

  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(next);
  saveDesignSheet(applyOverlay(next, ov));

  // ★ 链位置进**首行**（批量回执只保证首行被看见 —— `update_feature.ts` 的「摘要 = 首行」）
  const place = buildTodoChains(todos).places.get(id)!;
  return {
    message:
      `已新建 todo "${id}"：state=candidate（★ 无节点任务，挂在顶层 todos[]）· ${chainBadge(place)}` +
      `${follows ? `（接在 ${follows} 下面）` : '（链根）'}。\n` +
      `★ 要做什么：${summary}\n` +
      `★ 它和节点任务**同一套规矩**：\`claim\`（要 owner）→ \`complete\`（要 evidence，只有 attestation）→ 或 \`void\`（要 reason）。\n` +
      `★ 而它**没有判据**（不是代码）⇒ 巡检不会对它喊"漏收口"，只会在它 claimed 超期时报 expired。\n` +
      (follows
        ? `★ 链：上一环 ${follows}；**本环**做完若还有新的 ⇒ 再 add 一张并给 data.follows="${id}"。\n`
        : `★ 链：它是**链根**（第一环）。做完发现还有新的 ⇒ 再 add 一张并给 data.follows="${id}"。\n`) +
      (agent ? `★ 发起者：${agent}\n` : ''),
    feature,
    data: { todo_id: id, state: 'candidate' as TaskState, summary },
  };
}

/**
 * ★★★ 2026-10-22（卡迁移 · `nodes[].task` → `todos[]`）：**把已有的卡逐字并进 `todos[]`**。
 *
 * ## 它回答的问题
 * 「同一个概念住了两个容器」——`geometry.nodes[].task` 是**单数**（一个节点只能一张卡 ⇒ 历史被原地覆盖），
 * `todos[]` 是独立的（可多张）。用户裁定：卡应当住 `todos[]`，用 `node_id` 指向**入口节点**。
 * 本函数是「搬家」的那一只手：把节点上已有的那张卡**原样**放进 `todos[]`，补 `node_id`。
 *
 * ## 为什么不能直接走 `add`
 * `add` 只收 `summary`：`state` 恒写 `candidate`、`owner` 恒 `null`、`claimed_at` / `evidence` / `read_set` 全丢
 * ⇒ 搬 104 张卡 = **把 94 张的「已了结」和 103 个 owner 抹平**（那是丢历史，不是迁移）。
 *
 * ## 判据（三条，缺一不可）
 * ① **不编**：卡上每个字段都从 `cards[i]` 逐字搬；本函数**只校验** `id` / `node_id`，不造任何值；
 * ② **幂等**：`(id, node_id)` 已在册 ⇒ 跳过（不重复、不覆盖、不改既有那张的一个字节）；
 * ③ **不许顶替**：同 `id` 已在册但指向**另一个** `node_id` ⇒ 拒（一个 id 两个入口，`follows` / `node_id` 的引用就失去唯一解）；
 * ★ 同守 `writeTask` 那条结构不变量：带 `expectations` 的卡不收（判据只住 `decision.expectations`）。
 * ★ 入口节点必须**真实存在**（`geometry.nodes` 里查得到）—— 悬挂的 `node_id` 就是「指不到触发点」，拒。
 */
function importTodoCards(feature: string, data: Record<string, unknown>, agent?: string): EditResult {
  const raw = data.cards;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('todo.import 需要 data.cards（非空数组：每项是一张要并入的卡，字段逐字搬、不重编）');
  }
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在 —— todo 住在设计 DSL 的顶层 todos[]。`);
  const nodeIds = new Set((dsl.geometry?.nodes ?? []).map((n) => n.id));
  const todos = [...(dsl.todos ?? [])];
  /** 幂等键 = `(id, node_id)`（★ 不是单个 id：同一张卡在不同入口下是两条历史） */
  const keyOf = (id: string, nodeId: string): string => `${id}||${nodeId}`;
  const seen = new Map(todos.map((t) => [keyOf(String(t.id), String(t.node_id ?? '')), t]));
  const byId = new Map(todos.map((t) => [String(t.id), t]));

  const imported: string[] = [];
  const skipped: string[] = [];
  for (const [i, item] of raw.entries()) {
    const card = (item ?? {}) as Record<string, unknown>;
    const at = `cards[${i}]`;
    const id = typeof card.id === 'string' ? card.id.trim() : '';
    const nodeId = typeof card.node_id === 'string' ? card.node_id.trim() : '';
    if (!id) throw new Error(`todo.import 被拒：${at} 没有 id —— 卡的 id 必须带上（写端不替你编一个）。`);
    if (!nodeId) throw new Error(`todo.import 被拒：${at}（${id}）没有 node_id —— 住 todos[] 的卡必须指向一个入口节点。`);
    if (!nodeIds.has(nodeId)) {
      throw new Error(`todo.import 被拒：${at}（${id}）的 node_id "${nodeId}" 不在 geometry.nodes 里（悬挂的入口）。`);
    }
    if (!isTaskState(String(card.state))) {
      throw new Error(
        `todo.import 被拒：${at}（${id}）的 state "${String(card.state)}" 不是四态之一（candidate / claimed / done / void）。`,
      );
    }
    if (card.expectations !== undefined) {
      throw new Error(
        `todo.import 被拒：${at}（${id}）带了 expectations —— 判据只住 \`decision.expectations\`（同 \`writeTask\` 的结构不变量）。`,
      );
    }
    const sameId = byId.get(id);
    if (sameId && String(sameId.node_id ?? '') !== nodeId) {
      throw new Error(
        `todo.import 被拒：id "${id}" 在 todos[] 里已指向 "${String(sameId.node_id ?? '（无）')}"，本次要指向 "${nodeId}"` +
          ` —— 一个 id 两个入口会让 follows / node_id 的引用全部失去唯一解。`,
      );
    }
    const k = keyOf(id, nodeId);
    if (seen.has(k)) {
      skipped.push(id);
      continue;
    }
    // ★ 只改两个键：`id` 去空白、`node_id` 必填；其余**逐字搬**（state / owner / claimed_at / evidence / read_set …）
    const next = { ...card, id, node_id: nodeId } as unknown as TaskSpec;
    todos.push(next);
    seen.set(k, next);
    byId.set(id, next);
    imported.push(id);
  }

  const listed = skipped.slice(0, 5).join(' / ');
  const message =
    `todo.import：并入 ${imported.length} 张 · 跳过 ${skipped.length} 张（(id, node_id) 已在册 ⇒ 幂等）` +
    `${skipped.length ? `\n  · 跳过：${listed}${skipped.length > 5 ? ` …共 ${skipped.length} 张` : ''}` : ''}` +
    `\n  · todos[] 现有 ${todos.length} 张（原 ${(dsl.todos ?? []).length} 张）` +
    (agent ? `\n  · 发起者：${agent}` : '');

  if (imported.length === 0) {
    return { message, feature, data: { imported: 0, skipped: skipped.length, total: todos.length } };
  }
  const nextDsl = { ...dsl, todos };
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
  saveDesignSheet(applyOverlay(nextDsl, ov));
  return { message, feature, data: { imported: imported.length, skipped: skipped.length, total: todos.length } };
}
