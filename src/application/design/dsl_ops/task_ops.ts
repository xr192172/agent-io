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
  isSatisfied,
  leaseAgeHours,
  LEASE_TTL_MS,
  type CardStanding,
  type ClaimIntent,
} from '../../../domain/task_machine.js';
// ★ 2026-10-21（D-judge-port）：判定器的**实现**住 application，由这里**注入**给 domain 的状态机
//   （`cardStanding` / `isSatisfied` 的 `opts.judge`）—— domain 不再向上 import application。
import { judgeExpectations } from '../intent/expectations.js';
import { expectationPaths, postExpectations, type Expectation } from '../../../domain/expectation.js';
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
  progressOf,
  taskLevel,
  type TaskDiscussion,
  type TaskEvidenceFingerprint,
  type TaskHistoryEntry,
  type TaskReadSet,
  type TaskSpec,
  type TaskState,
} from '../../../domain/task_schema.js';
// ★ 2026-10-21：`todo.delete` 的**墓碑**（物理删是唯一让卡真的从册上消失的操作 ⇒ 必须有卡外留痕）。
import { appendTodoTombstone, todoJournalFile } from '../board/todo_journal.js';
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
  if (!node.task) {
    throw new Error(
      `节点 "${nodeId}" 上**没有任务格**（「geometry.nodes[].task」）⇒ 无卡可 claim / release / complete。\n` +
        `★ 立卡 = \`publish\`：\`{ type:'task', op:'publish', id:'${nodeId}' }\` —— 它把该节点的**决策卡**` +
        `（\`decision.summary\` + \`decision.expectations\`）翻成任务卡（★ 内容来自 decision，**不接受手写 summary**）。` +
        `★ 没有 decision / decision 太粗（无后态判据）⇒ 立的是 **L1 建构卡**（0 条期望，判据 = DSL 建构完整）；` +
        `有可判的后态判据 ⇒ **L2 实现卡**。★ 本工具**不替你凭空造一张空卡**。`,
    );
  }
  return { dsl, nodeId, card: node.task };
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
 * 落盘：**只改 `node.task`**（唯一写端），然后把派生进度**投影**回 base（`applyOverlay`）。
 * ★ 投影这一步与 `updateStatus` 同款（T328）：base 上的 `status` 是**应用结果**，不是独立副本；
 *   权威始终是 `task.state`（`progressOf` 是唯一映射，读端见 `overlay.ts#applyOverlay`）。
 */
function writeTask(feature: string, nodeId: string, next: TaskSpec): void {
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
  const dsl = getDesignSheet(feature);
  if (!dsl) throw new Error(`feature "${feature}" 在落盘前读不到 ⇒ 不写（绝不静默降级）。`);
  // ★★★ 2026-10-18（Q5）：**按"挂在哪"分叉** —— todo 写 `todos[]`，节点任务写 `geometry.nodes[].task`。
  const isTodo = (dsl.todos ?? []).some((t) => t.id === nodeId);
  const nextDsl = isTodo
    ? { ...dsl, todos: (dsl.todos ?? []).map((t) => (t.id === nodeId ? { ...t, ...next } : t)) }
    : { ...dsl, geometry: { ...dsl.geometry!, nodes: (dsl.geometry?.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, task: next } : n)) } };
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
  ev: ProgressEvidence,
): TaskEvidenceFingerprint {
  const exp = expectations;
  const what =
    ev.kind === 'expectations'
      ? `judgeExpectations:${nodeId}（${exp.length} 条判据）`
      : ev.kind === 'reading'
        ? ev.command
        : `attestation:${ev.by}`;
  const base: TaskEvidenceFingerprint = { what, input: fingerprintOf([canonCriteria(exp)]) };
  const covers = [...new Set(exp.flatMap((e) => expectationPaths(e)))];
  const root = typeof sourceRoot === 'string' && sourceRoot.trim() ? sourceRoot : null;
  if (!covers.length || !root) return base;
  const { code, covers: sorted } = codeFingerprintAt(root, covers);
  return { ...base, code, covers: sorted };
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
  node: { id: string; type?: string; label?: string; title?: string; description?: string; path?: string },
): ConstructBasis {
  const sem = (dsl.semantic?.files ?? []).find((f) => f.id === node.id);
  const resp = (sem?.responsibility ?? '').trim();
  const title = (node.title ?? '').trim();
  // ★ 自动生成的 label 等于 id（`addNode` 的 `label || node_id`）⇒ 它不携带任何信息，不算"内容"
  const label = (node.label ?? '').trim();
  const labelUsable = label && label !== node.id ? label : '';
  const filePath =
    (node.path ?? '').trim() ||
    (sem?.path ?? '').trim() ||
    (node.type === 'file' || node.type === 'doc' ? (node.description ?? '').trim() : '');
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

  const existing = node.task;
  /**
   * ★★ 2026-10-20：**已领卡的原地换判据**（`reopen` 之后的正路）。
   * ★ 判据只需两条：`state === 'claimed'` ∧ 带 `reason`（改动要有理由）。
   * ★ 它只换 `summary` + `expectations` —— 其余字段（含 `evidence`）**逐条保留**。
   */
  const onClaimed = existing?.state === 'claimed';
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
        `后态判据（\`phase='post'\`）**0 条** ⇒ 翻成 L2 的卡**必然领不了**（\`cardStanding\` 对空集给 unknowable）`;

  // 已有任务格：只允许 ① 重翻 candidate ② L1(done) ⇒ L2 升一级 ③ claimed + reason ⇒ 原地换判据
  let advance = false;
  let refresh = false;
  if (existing && existing.state !== 'candidate') {
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
          `★ 允许重翻 \`candidate\`（没人领）；★ 允许 **L1 已 done 且现在够得上 L2** ⇒ 升一级；` +
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

  if (level === 'L2') {
    // ★★ 已领卡的**原地换判据**：只换 summary + expectations，其余逐条保留（★ 尤其 evidence）。
    if (refresh) {
      // ★★★ 重开账：`publish` 是唯一的结清口 ⇒ "换了等于没换"必须拒（否则账白结、白洞照旧）。
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
          `★ 进度派生：task.state=claimed ⇒ progress=in_progress。下一步直接干活 → \`complete\`（写闸只认 claimed，已就位）。`,
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
    // ★ L1 ⇒ L2 之外的重翻：若旧卡是 L1（candidate）也不带证据（从没被 complete 过）；带上更安全。
    ...(node.task?.evidence?.length ? { evidence: node.task.evidence } : {}),
    discussion,
  });

  return {
    message:
      // ★★★ 首行必须自足：`edit_dsl` 的回执**只透出首行**（其余行进 `data`/被丢弃，实测）。
      //   所以"级别 / 0 条期望 / 不编判据 / 缺什么"全放首行，后面的行只是展开。
      `${node.task ? '已重翻' : '已立卡'}任务 "${node_id}" —— 级别 = **L1 建构卡**` +
      `（**0 条期望**：判据 = **DSL 建构完整**，**不是代码跑通**；★ 不编实现判据）：${whyL1}` +
      (basis.missing.length ? `。★★ 缺"要做什么"：需要用户/我手写一句"我要实现什么"（本工具不编）` : '') +
      `\n★ summary 出处：${basis.source} ⇒ ${JSON.stringify(basis.summary)}\n` +
      (basis.missing.length ? `★★ ${basis.missing.join('\n★★ ')}\n` : '') +
      `★ 做完 L1 = 给该节点写决策卡（summary + 至少一条相位 post 的 expectation），再 \`complete\`；` +
      `之后再 \`publish\` 就会翻成 **L2 实现卡**（旧的 L1 证据会带过去）。\n` +
      `★ 进度派生：task.state=candidate ⇒ progress=draft。任务格住在 \`geometry.nodes[].task\`（不设顶层 tasks[]）。`,
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
      refreshed: !!node.task,
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
  // ★★★ 2026-10-20（A7 闭环 · c）：**actor 与 owner 必须一致**。
  //
  // ## 补的是什么洞
  // A7 在写侧摊：“卡 owner ≠ 本次 actor ⇒ 拒”。但**领卡侧根本没看 actor** ——
  // 顶层 `agent` 只拿去署名（decision.agent / released_by / evidence.agent），
  // owner 只从 `data.owner` 来 ⇒ ⇒ **两个人可以用同一个 actor 各自领卡、或帮别人领一卡**，
  // 写闸那条判据就变成一个“自己跟自己比”的空转。
  // ⇒ 领卡这一步就对：**你只能说“我是谁”**，不能说“这张卡是他的”。
  //
  // ## 为什么只在“两个都给了且不一致”时拒
  // · 只给 owner、没给 agent（老调用方）：行为**不变**（自报体系下“不报”仍是合法用法，只是 A7 在写侧
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
              '★ 怎么办：① 直接干活；② 这一轮**要碰的东西变了**（读集要换）⇒ 先 `release` 再 `claim`，' +
              '读集会被**重算并覆盖**（不是追加）。\n'
            : '★ 这是**别人的在办活**（A7：卡不是你的）⇒ 等它到期（到期后**任何 agent 都能接管**，' +
              '接管会记 `taken_over_from`），或等它 `release` / `complete`。\n') +
          '★ 另：`claimed → claimed` 本来就不在迁移表里（唯一住处 `domain/task_machine.ts#TRANSITIONS`）。',
      );
    }
  }
  // ★ 租约已过期的 claimed 卡 ⇒ **语义上等于 candidate**（无主），不按 claimed→claimed 拦
  if (!takeover) assertTransition(card.state, 'claimed', 'claim');

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
  if (reopening && intent === 'modify') {
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
          `★ 下一步是 \`publish\`（现在会翻成 **L2 实现卡**，旧的 L1 证据会带过去），不是领它。`,
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
      '（这是“没比”，不是“不冲突”）。';
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
      (claimConflict?.unchecked.length ? `（另 ${claimConflict.unchecked.length} 张活跃卡没读集、这次没比）` : '')
    : '；★ 读集**未算**（该 feature 没有 source_root）';

  const claimedAt = new Date().toISOString();
  writeTask(feature, node_id, {
    ...card,
    state: 'claimed',
    owner,
    claimed_at: claimedAt,
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
      `，claimed_at=${claimedAt}）—— ${levelNote}${readHead}` +
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
      `\n${conflictNote}`,
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
 * 2. **不是你的卡** ⇒ 别人不能替你续命（`sameActor` 折算，与 A7 同一套）
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
        `★ 出路：① 直接继续干活并**重新 claim**（会被判为"接管"，记 taken_over_from）；` +
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
  const all: Array<{ id: string; card: TaskSpec }> = [];
  for (const n of dsl.geometry?.nodes ?? []) if (n.task) all.push({ id: n.id, card: n.task as TaskSpec });
  for (const t of dsl.todos ?? []) all.push({ id: t.id, card: t as TaskSpec });

  const expired = all.filter((x) => isLeaseExpired(x.card, now));
  const lines: string[] = [];
  for (const e of expired) {
    const age = leaseAgeHours(e.card, now);
    writeTask(feature, e.id, {
      ...e.card,
      state: 'candidate',
      owner: null,
      claimed_at: null,
      // ★ 痕迹：谁被收回、挂了多久、按什么 TTL 判的（审计要能复原当时的口径）
      expired_from: {
        owner: e.card.owner ?? null,
        claimed_at: e.card.claimed_at ?? null,
        age_hours: age,
        ttl_ms: LEASE_TTL_MS,
      },
      expired_at: new Date(now).toISOString(),
    });
    lines.push(`  · ${e.id}（原 owner=${e.card.owner ?? '（空）'}，挂了 ${age ?? '?'}h）→ candidate`);
  }

  const ttlH = Math.round(LEASE_TTL_MS / 3.6e6);
  return {
    message:
      expired.length === 0
        ? `✓ 没有过期的租约（扫了 ${all.filter((x) => x.card.state === 'claimed').length} 张 claimed 卡，TTL=${ttlH}h）。`
        : `✓ 已收回 ${expired.length} 张过期租约（TTL=${ttlH}h）→ candidate：\n${lines.join('\n')}` +
          `\n★ 痕迹落在各自的 \`expired_from\` / \`expired_at\`（与 release 的 \`release_reason\` 可区分：一个是"人放弃"，一个是"超时"）。`,
    feature,
    data: { expired: expired.map((e) => e.id), ttl_ms: LEASE_TTL_MS, scanned_claimed: all.filter((x) => x.card.state === 'claimed').length },
  };
}

// ─────────────────────────────────────────────────────────────

export async function releaseTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new Error('release 需要 `data.reason` —— 显式释放必须说清为什么（t_release 的 guard）。');

  const { card } = loadTask(feature, node_id);
  assertTransition(card.state, 'candidate', 'release');
  const releasedAt = new Date().toISOString();
  // ★★★ 2026-10-22（链 C · 身份归一化）：`by` 与 claim 的 `owner` 走**同一套规范**。
  //   原先 `const by = input.agent ?? null` 原样落盘 ⇒ 同一张卡上 `owner=agent:agent-t349`、
  //   `released_by=agent-t349`（两种格式同住一张卡；t349 的旧断言正是这个洞的绿灯）。
  //   ★ 老格式补前缀 + 回执留痕；完全非法（及 STRICT 下的老格式）⇒ 当场拒。
  const bySign = signTaskActor(input.agent, 'release 的署名（released_by / 回执 by）');
  const by = bySign.actor;

  writeTask(feature, node_id, {
    ...card,
    state: 'candidate',
    owner: null,
    claimed_at: null,
    release_reason: reason,
    released_by: by,
    released_at: releasedAt,
  });

  return {
    message:
      `已释放任务 "${node_id}"（candidate；by=${by ?? '未署名'}${normalizedInline(bySign.adm)}，reason=${reason}）。` +
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
    if (card.state !== 'claimed') {
      throw new Error(`complete 被拒：todo 的 state=${card.state}，只有 claimed 才能收口（先 claim）。`);
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
  writeTask(feature, node_id, {
    ...card,
    state: 'done',
    evidence: [
      ...(card.evidence ?? []),
      {
        kind: evidence!.kind,
        at,
        // ★★★ 2026-10-20：**主体必记**（OQ1 的另一半）——
        //   此前 `by` 只在 attestation 时写 ⇒ expectations 收口的卡看不出"谁宣布的"。
        //   现在所有 kind 都记：`by` 分人/机器，`agent` 记具体是谁。
        by: evidence!.kind === 'attestation' ? evidence!.by : 'llm',
        ...(evidence!.kind === 'attestation' && evidence!.why ? { why: evidence!.why } : {}),
        ...(signer.actor ? { agent: signer.actor } : {}),
        // ★ 2026-10-21：这条证据的**代码指纹**（`what` / `input` / `code` / `covers`）—— 见上面那段。
        fingerprint,
        verdict: 'pass',
      },
    ],
  });

  // ★★★ 2026-10-22：**说清"哪些字段没落盘"**（一个子代理实测 34/34 条 `observed` 都不见了，
  //   它以为遇到了 bug）。★ 那不是 bug，是 `task_schema.ts:140` 的**有意设计**：
  //   「不落 `observed` / 不落 passed/failed 计数 —— 那是**读数快照**，必陈旧」，
  //   任务格只留结论 `{kind, at, by, verdict}`，跑的命令原文落在 `fingerprint.what` 里。
  //   ⇒ 但**"有意不存"和"静默丢掉"在回执上长得一样** —— 所以这里必须明说，
  //     否则每个填了 `observed` 的人都会以为自己的读数留在卡上了（本仓最忌这种"沉默的丢"）。
  const notPersistedNote =
    evidence!.kind === 'reading' && (evidence! as { observed?: string }).observed
      ? '\n★ 注意：`observed`（你写的那段读数）**不落盘** —— 任务格只存结论 `{kind, at, by, verdict}`，' +
        '跑的命令原文在 `fingerprint.what` 里。理由：读数快照必陈旧（`task_schema.ts:140`）。' +
        '要留读数 ⇒ 写进 `docs/` 或回执里，别指望卡上。'
      : '';

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
      `已完成任务 "${node_id}"（owner=${card.owner}，级别=${level}${normalizedInline(signer.adm)}）—— ${closeNote}、证据 kind=${evidence!.kind}。${chainNote.head}` +
      notPersistedNote +
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
    default:
      throw new Error(`todo 不支持操作: ${op.op}（改/接链/作废/删分别是 update / follows / retire / delete）`);
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

  // ★★★ 2026-10-21：**改 / 作废 / 物理删** 三个 op 走同一处分发。
  //   ★ 它们的 id 由 `OP_SPECS` 的 `opsRequiringId` 保证（不是这里判的 —— 一处判据）。
  // ★ 2026-10-21：`follows`（跑环继任链：接链 / 摘链）走同一处分发 —— 它也是「按 id 动一张卡」的 op。
  if (op.op === 'update' || op.op === 'follows' || op.op === 'retire' || op.op === 'delete') {
    return applyTodoMutation(feature, op, agent);
  }

  if (op.op !== 'add') {
    throw new Error(`todo 仅支持 add / link / update / follows / retire / delete（收到 ${op.op}）`);
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
