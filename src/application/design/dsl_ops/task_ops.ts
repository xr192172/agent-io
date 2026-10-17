/**
 * task_ops.ts —— **任务格的唯一写端**（`publish` / `claim` / `release` / `complete`）。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的 `task_plan.task_home`（OQ11 裁定 B 的展开）：
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
 * **不是"凭空新建一张卡"**，而是**把该节点上已有的决策卡翻成一张任务卡**：
 * `decision.summary` + `decision.expectations` ⇒ `TaskSpec{summary, expectations}`。
 * ⇒ ★ **输入里没有"我编的任务描述"**：`publish` 的 `data` 一个键都不收
 *   （`op_data_spec.ts` 的 `TYPE_KNOWN_KEYS.task` 只有 `owner/reason/evidence`，
 *    给 `summary` 会被"不被认的键"当场拒）—— 内容**只能**来自 `decision`。
 * ⇒ ★ 没有 `decision` 的节点 **publish 必拒**（点名"没有决策卡可翻"）——
 *   这条正是"它在翻卡、不在造卡"的行为面判据（`certs/t350-publish-task-cert.mjs`）。
 *
 * ## 边界（★ 如实写明，别让读端以为它管得更宽）
 * · `publish` 只**翻卡**：不写 summary、不补判据、不替人编一条期望（缺 ⇒ 拒，不猜）。
 *   它**不负责让 `docs/board.md` 显示**这张卡 —— 榜单是**读端**（T8，未建），
 *   应当由它读「对拍的红 + 设计 DSL 里现有的 task 格」派生，而不是靠人抄表。
 * · 本文件**不判**判据的语义（六类判据的判定器只有 `judgeExpectations` 一把尺）；
 *   证据闸只有 `validateProgressEvidence` 一把尺 —— 这里只**调**它们。
 */
import type { EditResult } from './edit_result.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { loadOverlay } from '../../../infrastructure/storage_overlay.js';
import { applyOverlay, seedOverlayFromDsl, validateProgressEvidence, type ProgressEvidence } from '../../../domain/overlay.js';
import { applicableTransitions, cardStanding, isClaimable, isSatisfied } from '../../../domain/task_machine.js';
import { postExpectations } from '../../../domain/expectation.js';
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
        `★ 立卡 = \`publish\`：\`{ type:'task', op:'publish', id:'${nodeId}' }\` —— 它把该节点的**决策卡**` +
        `（\`decision.summary\` + \`decision.expectations\`）翻成任务卡（★ 内容来自 decision，**不接受手写 summary**）。` +
        `★ 本工具**不替你凭空造一张空卡** —— 那会让"已领"看起来像"有任务"；没有 decision 的节点 publish 会拒。`,
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
// publish（立卡 = 翻决策卡）
// ─────────────────────────────────────────────────────────────

/**
 * 立卡（`∅ → candidate`）：**把节点上已有的决策卡翻成一张任务卡**。
 *
 * 语义来源：`docs/task-system-plan.dsl.json` 的 `task_plan.provenance.chain`
 *   （④ 天然差异：DSL 现状 vs 决策卡 ⇒ 红 ⇒ ⑤ 红 = 任务 ⇒ publish 上榜单）。
 *
 * ## ★★★ 判据（本函数的全部意义：它在"翻卡"，不在"造卡"）
 * 1. **有决策卡**：`node.decision.summary` 非空 —— 否则**拒**，并点名"没有决策卡可翻"；
 * 2. **有判据**：`decision.expectations` 里**至少一条后态判据**（`phase==='post'`）——
 *    否则拒。★ 理由不是"我加个规矩"，而是 `t_claim` 自己的 guard：`cardStanding` 对
 *    "后态判据一条不剩"给 `unknowable`（空集不按全过算）⇒ 翻出来的卡**必然领不了** ⇒
 *    在 publish 当场点名，好过让人到 claim 时才发现；
 * 3. **内容逐字来自 decision**：`summary = decision.summary` · `expectations = decision.expectations`
 *    （浅拷贝一层，避免与 `node.decision` 共享同一批对象）。★ **不接受任何手写内容**：
 *    `publish` 不读 `data` —— 给 `data.summary` 会被 `checkOpSpec` 的"不被认的键"拒。
 *
 * ## 已有任务格时
 * · `state === 'candidate'`（没人领）⇒ **重翻**（用当下的 decision 覆盖）—— 决策改了，卡要跟上；
 * · 其余态（`claimed`/`done`/…）⇒ **拒**：覆盖会把"正在做的判据"换掉（那是两个写端各自为政）。
 *
 * ★ 本函数**不写 progress**：`node.status` 是 `task.state` 的派生值（`progressOf`），
 *   落盘时由 `applyOverlay` 投影（candidate ⇒ draft）。
 */
export function publishTask(input: TaskOpInput): EditResult {
  const { feature, node_id } = input;
  // ★★★ publish 的输入**没有内容**：内容只能来自 decision。`owner/reason/evidence` 是 task 的已知键
  //   （claim/release/complete 用），但**对 publish 无意义** ⇒ 显式拒，别让它们被静默忽略
  //   （"你以为生效了、其实没有"正是 `checkOpSpec` 要防的那一类；`data.summary` 那种**未知键**由它先拒）。
  const extra = [
    input.owner !== undefined ? 'owner' : '',
    input.reason !== undefined ? 'reason' : '',
    input.evidence !== undefined ? 'evidence' : '',
  ].filter(Boolean);
  if (extra.length) {
    throw new Error(
      `publish 被拒（不接受 data）：收到 data.${extra.join(' / data.')} —— ★ 立卡的内容**只能**来自该节点的 \`decision\`，` +
        `publish 不收任何 data 键。\n` +
        `★ 领任务请走 \`op:'claim'\`（data.owner 是**那个** action 的参数）；立卡这一步没有可填的字段。`,
    );
  }
  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在 —— 任务格住在设计 DSL 的节点上，先有 feature 才有家。`);
  }
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === node_id);
  if (!node) {
    throw new Error(
      `节点 "${node_id}" 不在 feature "${feature}" 的 geometry.nodes 里 —— 立卡的对象是**节点**，找不到节点就没有决策卡可翻。`,
    );
  }

  const decision = node.decision;
  if (!decision || typeof decision.summary !== 'string' || !decision.summary.trim()) {
    throw new Error(
      `publish 被拒：节点 "${node_id}" 上**没有决策卡可翻**（\`decision.summary\` 为空/缺失）。\n` +
        `★ publish 是"把已有的决策卡翻成任务卡"，**不是凭空造一张卡** —— 没有 decision 就没有内容可翻。\n` +
        `★ 先给该节点写决策卡（edit_dsl { type:'decision', op:'update', id:'${node_id}', data:{ summary, expectations } } ），` +
        `再 publish；★ 本工具**不会**替你编一条 summary。`,
    );
  }
  const expectations = decision.expectations ?? [];
  if (!expectations.length) {
    throw new Error(
      `publish 被拒：节点 "${node_id}" 的决策卡**没有判据**（\`decision.expectations\` 为空）—— ` +
        `任务卡翻出来也**无法验收**（board 的验收就是按该卡的 expectations 判）。\n` +
        `★ 先给决策卡补判据（\`edit_dsl {type:'decision', op:'update', ... data:{expectations:[…]}}\`），再 publish。`,
    );
  }
  const post = postExpectations(expectations);
  if (!post.length) {
    throw new Error(
      `publish 被拒：节点 "${node_id}" 的决策卡只有**前态判据**（\`phase='pre'\`，如 edge-absent），` +
        `后态判据（\`phase='post'\`）一条不剩 ⇒ 翻出来的卡**必然领不了**（\`cardStanding\` 对空集给 unknowable —— 空集不按"全过"算）。\n` +
        `★ decision.expectations 现有 ${expectations.length} 条，全是 pre-phase。`,
    );
  }

  if (node.task && node.task.state !== 'candidate') {
    throw new Error(
      `publish 被拒：节点 "${node_id}" 上已有一张 state=${node.task.state} 的任务卡` +
        (node.task.owner ? `（owner=${node.task.owner}）` : '') +
        ` —— 覆盖它等于把"正在做/已完成"的判据换掉。\n` +
        `★ 只允许重翻 \`candidate\`（没人领）的卡；要换已领的卡，先 \`release\`（或走 replaces/superseded —— 未实现）。`,
    );
  }

  const refreshed = !!node.task;
  writeTask(feature, node_id, {
    id: node.id,
    // ★★ 逐字来自决策卡（不裁剪、不改写、不拼 acceptance）—— 这样"卡的内容来自哪里"可对拍
    summary: decision.summary,
    expectations: expectations.map((e) => ({ ...e })),
    state: 'candidate',
  });

  return {
    message:
      `${refreshed ? '已重翻' : '已立卡'}任务 "${node_id}"：**从该节点的决策卡翻出** ` +
      `${expectations.length} 条判据（其中后态 ${post.length} 条可领判定）。\n` +
      `★ 内容来源 = \`geometry.nodes[${node_id}].decision\`（summary 逐字 + expectations 逐字）—— ` +
      `publish 不收任何手写描述。\n` +
      `★ 进度是**派生值**：task.state=candidate ⇒ progress=draft（不落第二份）；` +
      `下一步 \`{ op:'claim', data:{ owner } }\` 才能开工（闸只认 claimed）。\n` +
      `★ 榜单显示不靠抄表：board 应当**读**「对拍的红 + 设计 DSL 里现有的 task 格」派生（T8，未建）。`,
    feature,
    data: {
      node_id,
      state: 'candidate' as TaskState,
      summary: decision.summary,
      expectations: expectations.length,
      post_expectations: post.length,
      refreshed,
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
 *  ① `isClaimable(cardStanding(card))`（★ 本函数内直接调用 —— 不把"记得先判"留给调用方）；
 *     ★ 读的是**五值读数里的"可领"两格**（`work` / `violated`），**不是**"判据全过"。
 *     ★★ `satisfied` 卡在这里**必拒**（没活干不许领）—— 这条与 `complete` 的判据**分开**：
 *        收口侧读 `isSatisfied`，两侧同源（都读 `cardStanding`）但**不是同一个谓词**。
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
  // ★★ 判据复用（不新造第二把尺）：`cardStanding` 按 phase 分区 + `judgeExpectations` 判 + 派生五值。
  const standing = await cardStanding(card, { root, nodes: dsl.geometry?.nodes ?? [] });
  if (!isClaimable(standing.standing)) {
    throw new Error(
      `claim 被拒（可领性：${standing.standing}）：${standing.reason}\n` +
        `★ 可领判据唯一出处 = src/domain/task_machine.ts#isClaimable（work / violated 才可领；satisfied 只可收口）。`,
    );
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
      `已领取任务 "${node_id}"（owner=${owner}，claimed_at=${claimedAt}）—— 站位=${standing.standing}；${standing.reason}` +
      `\n★ 进度是**派生值**：task.state=claimed ⇒ progress=in_progress（不落第二份）。`,
    feature,
    data: {
      node_id,
      state: 'claimed' as TaskState,
      owner,
      claimed_at: claimedAt,
      standing: standing.standing,
      progress: progressOf({ state: 'claimed' }),
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
 *  ② `isSatisfied(card) === true`（★ 读**收口**那一侧：`cardStanding === 'satisfied'`）——
 *     ★★ **不再调旧的「可领」判据**：那个函数已从状态机删除（本文件对它的引用数为 **0**，可 grep 验）；
 *        若这里与 claim 共用"全过"判据，收口闸会放行 `violated` 卡（后态全过、前态越权）——
 *        那比收归前更坏（讨论 2 的 P31）。
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
  const satisfied = await isSatisfied(card, { root, nodes: dsl.geometry?.nodes ?? [] });
  if (!satisfied.satisfied) {
    throw new Error(
      `complete 被拒（可收口性：${satisfied.standing}）：${satisfied.reason}\n` +
        `★ 收口判据唯一出处 = src/domain/task_machine.ts#isSatisfied（只有 satisfied 可收口；work/violated 可领但不可收口）。`,
    );
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
      `已完成任务 "${node_id}"（owner=${card.owner}）—— 站位=satisfied（后态判据 ${satisfied.verdict.satisfaction.passed} 条全过、` +
      `前态判据 ${satisfied.verdict.violation.checked} 条无红）、证据 kind=${evidence!.kind}。` +
      `\n${legacy.message.split('\n')[0]}`,
    feature,
    data: {
      node_id,
      state: 'done' as TaskState,
      standing: satisfied.standing,
      progress: progressOf({ state: 'done' }),
      evidence_kind: evidence!.kind,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// edit_dsl 路由（applyOperation 的 case 'task' 只调这里）
// ─────────────────────────────────────────────────────────────

/** `edit_dsl {type:'task', op:publish|claim|release|complete}` 的分派（★ 四个 action 的唯一入口）。 */
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
    default:
      // ★ 合法性由 `OP_SPECS` 判（`task.ops` 只有三个）；走到这里说明表与分派漂了。
      throw new Error(`task 不支持操作: ${op.op}（合法值由 op_data_spec.ts 的 OP_SPECS.task.ops 判定）`);
  }
}
