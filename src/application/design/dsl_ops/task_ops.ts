/**
 * task_ops.ts —— **任务格的唯一写端**（`claim` / `release` / `complete`）。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的 `task_plan.task_home`（OQ11 裁定 B 的展开）：
 *   · **家** = `geometry.nodes[].task`（与节点同居；★ 不设顶层 `tasks[]`）；
 *   · **唯一写端** = `edit_dsl {type:'task'}`（三个 action 都从这里进）；
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
 * `t_claim` 的 guard 逐字要求 **`canClaim(card) === true`**，而 `canClaim` 要跑
 * `judgeExpectations`（读索引 / 读盘，异步）。⇒ 若把"先判可领性"留给调用方"记得调"，
 * 那就是**补丁**（别处要记得配合）⇒ 于是把 **claim→判定** 收进本函数，写链随之 async。
 *
 * ## 边界（★ 如实写明，别让读端以为它管得更宽）
 * · 本文件**不创建**任务格（发布 = 榜单/`board` 组件的事，T8）—— 格子在设计侧就位后，
 *   本文件只负责它的**状态迁移**；拿不到卡时**点名**这件事，不替人凭空造一张。
 * · 本文件**不判**判据的语义（六类判据的判定器只有 `judgeExpectations` 一把尺）；
 *   证据闸只有 `validateProgressEvidence` 一把尺 —— 这里只**调**它们。
 */
import type { EditResult } from './edit_result.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { loadOverlay } from '../../../infrastructure/storage_overlay.js';
import { applyOverlay, seedOverlayFromDsl, validateProgressEvidence, type ProgressEvidence } from '../../../domain/overlay.js';
import { applicableTransitions, canClaim } from '../../../domain/task_machine.js';
import { progressOf, type TaskSpec, type TaskState } from '../../../domain/task_schema.js';
import { updateStatus } from './status_tools.js';

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
  /** 释放原因（release 必填；`t_release`：显式 release 事件要带 reason） */
  reason?: string;
  /** 完成证据（complete 必填 —— 复用 `validateProgressEvidence` 三档） */
  evidence?: ProgressEvidence;
  /** 发起者身份（写进 `released_by` / 回执；★ 工具不伪造） */
  agent?: string;
}

// ─────────────────────────────────────────────────────────────
// 读格子（唯一入口：取 DSL + 节点 + 任务格）
// ─────────────────────────────────────────────────────────────

interface Loaded {
  dsl: NonNullable<ReturnType<typeof getDSL>>;
  nodeId: string;
  card: TaskSpec;
}

function loadTask(feature: string, nodeId: string): Loaded {
  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在 —— 任务格住在设计 DSL 的节点上，先有 feature 才有家。`);
  }
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(
      `节点 "${nodeId}" 不在 feature "${feature}" 的 geometry.nodes 里 —— 任务与节点同居，找不到节点就没有家。`,
    );
  }
  if (!node.task) {
    throw new Error(
      `节点 "${nodeId}" 上**没有任务格**（「geometry.nodes[].task」）⇒ 无卡可 claim / release / complete。\n` +
        `★ 本工具**只改状态**，**不造卡**：发布任务（立卡）是榜单 / board 的事（docs/board.md）—— ` +
        `卡在设计侧就位后再回来。★ 不替你凭空造一张空卡 —— 那会让"已领"看起来像"有任务"。`,
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
        `★ 迁移表唯一住处 = src/domain/task_machine.ts#TRANSITIONS（docs/task-system-plan.dsl.json 的 state_machine）。`,
    );
  }
}

/**
 * 落盘：**只改 `node.task`**（唯一写端），然后把派生进度**投影**回 base（`applyOverlay`）。
 * ★ 投影这一步与 `updateStatus` 同款（T328）：base 上的 `status` 是**应用结果**，不是独立副本；
 *   权威始终是 `task.state`（`progressOf` 是唯一映射，读端见 `overlay.ts#applyOverlay`）。
 */
function writeTask(feature: string, nodeId: string, next: TaskSpec): void {
  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 在落盘前读不到 ⇒ 不写（绝不静默降级）。`);
  const nodes = (dsl.geometry?.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, task: next } : n));
  const nextDsl = { ...dsl, geometry: { ...dsl.geometry!, nodes } };
  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(nextDsl);
  saveDSL(applyOverlay(nextDsl, ov));
}

// ─────────────────────────────────────────────────────────────
// claim
// ─────────────────────────────────────────────────────────────

/**
 * 领取（`candidate → claimed`）。
 *
 * guard（逐条照 `task_plan.state_machine.transitions[t_claim]`）：
 *  ① `canClaim(card) === true`（★ 本函数内直接调用 —— 不把"记得先判"留给调用方）；
 *  ② CAS：`state === 'candidate'` ∧ `owner` 为空 —— 否则**拒**（不覆盖别人的领）；
 *  ③ 写 `owner` + `claimed_at`（`releaseIfExpired` 的 TTL 靠它）。
 */
export async function claimTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const owner = (input.owner ?? '').trim();
  if (!owner) {
    throw new Error(
      'claim 需要 `data.owner`（领取者身份）—— CAS 写的就是它；★ 工具**不替你编一个身份**（那是伪造）。',
    );
  }
  const { dsl, card } = loadTask(feature, node_id);
  assertTransition(card.state, 'claimed', 'claim');

  const root = requireRoot(dsl as { source_root?: string });
  // ★★ 判据复用（不新造第二把尺）：`canClaim` 按 phase 选后态判据 + `judgeExpectations` 判。
  const verdict = await canClaim(card, { root });
  if (!verdict.ok) {
    throw new Error(`claim 被拒（可领性）：${verdict.reason}\n★ 判据唯一出处 = src/domain/task_machine.ts#canClaim。`);
  }

  // ★ CAS（单写者队列下等价于"读到的还是那张 candidate 卡"）：不满足 ⇒ 拒，不抢别人的领。
  if (card.state !== 'candidate' || card.owner) {
    throw new Error(
      `claim 被拒（CAS）：节点 "${node_id}" 的任务格已是 state=${card.state} / owner=${JSON.stringify(card.owner ?? null)} —— ` +
        `只在 state=candidate ∧ owner 为空时才写。`,
    );
  }

  const claimedAt = new Date().toISOString();
  writeTask(feature, node_id, {
    ...card,
    state: 'claimed',
    owner,
    claimed_at: claimedAt,
    // 新的一次领 ⇒ 上一次的释放痕迹不再是"当前状态"（保留原因会让"为什么现在有人领"读起来自相矛盾）
    release_reason: undefined,
    released_by: undefined,
    released_at: undefined,
  });

  return {
    message:
      `已领取任务 "${node_id}"（owner=${owner}，claimed_at=${claimedAt}）—— 后态判据 ${verdict.judged.length} 条全过。` +
      `\n★ 进度是**派生值**：task.state=claimed ⇒ progress=in_progress（不落第二份）。`,
    feature,
    data: { node_id, state: 'claimed' as TaskState, owner, claimed_at: claimedAt, progress: progressOf({ state: 'claimed' }) },
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
export async function releaseTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new Error('release 需要 `data.reason` —— 显式释放必须说清为什么（t_release 的 guard）。');

  const { card } = loadTask(feature, node_id);
  assertTransition(card.state, 'candidate', 'release');
  const releasedAt = new Date().toISOString();
  const by = input.agent ?? null;

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
      `已释放任务 "${node_id}"（candidate；by=${by ?? '未署名'}，reason=${reason}）。` +
      `\n★ 进度派生：task.state=candidate ⇒ progress=draft。`,
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
 *  ② 后态判据 `failed === 0`（★ 复用 `canClaim`，不另写一把判据）；
 *  ③ `validateProgressEvidence` 过（★ 复用既有证据闸，不新造第二把尺）；
 *  ④ 写完 task 状态后**调 `updateStatus`**（既有状态入口）—— 交接期让 overlay 的 `progress`
 *     仍有一份**投影**，读端不断（★ 第 ④ 步"overlay progress 退役"另上榜单）。
 */
export async function completeTask(input: TaskOpInput): Promise<EditResult> {
  const { feature, node_id } = input;
  const evidence = input.evidence;
  const { dsl, card } = loadTask(feature, node_id);
  assertTransition(card.state, 'done', 'complete');

  if (!card.owner) {
    throw new Error(`complete 被拒：节点 "${node_id}" 的任务格没有 owner ⇒ 未领不可能被收口（t_done_from_claimed 第 1 条）。`);
  }

  const root = requireRoot(dsl as { source_root?: string });
  const verdict = await canClaim(card, { root });
  if (!verdict.ok) {
    throw new Error(`complete 被拒（判据未满足）：${verdict.reason}`);
  }
  // ★ 证据闸（唯一一把尺）：没证据 / 形状不对/期望类证据没全绿 ⇒ 当场拒。
  const gate = validateProgressEvidence('done', evidence);
  if (!gate.ok) throw new Error(`complete 被拒（证据闸）：${gate.reason}`);

  const at = new Date().toISOString();
  writeTask(feature, node_id, {
    ...card,
    state: 'done',
    evidence: [
      ...(card.evidence ?? []),
      { kind: evidence!.kind, at, ...(evidence!.kind === 'attestation' ? { by: evidence!.by } : {}), verdict: 'pass' },
    ],
  });

  // ★ 交接期：仍调既有状态入口（设计期望 `completeTask → updateStatus`），让 overlay 的 progress
  //   有一份与派生值一致的投影（★ 权威仍是 task.state；第 ④ 步退役 overlay 后这一行随之下线）。
  const legacy = updateStatus({ feature, node_id, status: 'done', evidence });

  return {
    message:
      `已完成任务 "${node_id}"（owner=${card.owner}）—— 后态判据 ${verdict.judged.length} 条全过、证据 kind=${evidence!.kind}。` +
      `\n${legacy.message.split('\n')[0]}`,
    feature,
    data: {
      node_id,
      state: 'done' as TaskState,
      progress: progressOf({ state: 'done' }),
      evidence_kind: evidence!.kind,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// edit_dsl 路由（applyOperation 的 case 'task' 只调这里）
// ─────────────────────────────────────────────────────────────

/** `edit_dsl {type:'task', op:claim|release|complete}` 的分派（★ 三个 action 的唯一入口）。 */
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
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    evidence: data.evidence as ProgressEvidence | undefined,
    agent,
  };
  switch (op.op) {
    case 'claim':
      return claimTask(input);
    case 'release':
      return releaseTask(input);
    case 'complete':
      return completeTask(input);
    default:
      // ★ 合法性由 `OP_SPECS` 判（`task.ops` 只有三个）；走到这里说明表与分派漂了。
      throw new Error(`task 不支持操作: ${op.op}（合法值由 op_data_spec.ts 的 OP_SPECS.task.ops 判定）`);
  }
}
