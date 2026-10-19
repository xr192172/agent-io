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
import { applyOverlay, seedOverlayFromDsl, validateProgressEvidence, type ProgressEvidence } from '../../../domain/overlay.js';
import { applicableTransitions, cardStanding, isClaimable, isSatisfied, type CardStanding } from '../../../domain/task_machine.js';
import { postExpectations } from '../../../domain/expectation.js';
import { progressOf, taskLevel, type TaskDiscussion, type TaskSpec, type TaskState } from '../../../domain/task_schema.js';
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

// ─────────────────────────────────────────────────────────────
// publish（立卡 = 翻决策卡）
// ─────────────────────────────────────────────────────────────

/**
 * 立卡（`∅ → candidate`）：**两级**（`task_plan.two_level_tasks` + `publish_rule.corrected`）。
 *
 * ## ★★★ 为什么这一条从"拒"改成"L1 建构卡"（2026-10-17 · `docs/gate-principle.md`）
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
 * · 其余（`claimed` / L2 已 done / …）⇒ **拒**：覆盖会把"正在做的判据"换掉。
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

  // 已有任务格：只允许 ① 重翻 candidate ② L1(done) ⇒ L2 升一级；其余拒
  let advance = false;
  if (node.task && node.task.state !== 'candidate') {
    advance = node.task.state === 'done' && taskLevel(node.task) === 'L1' && level === 'L2';
    if (!advance) {
      throw new Error(
        `publish 被拒：节点 "${node_id}" 上已有一张 state=${node.task.state} 的任务卡` +
          (node.task.owner ? `（owner=${node.task.owner}）` : '') +
          `（级别 ${taskLevel(node.task)}） —— 覆盖它等于把"正在做/已完成"的判据换掉。\n` +
          `★ 允许重翻 \`candidate\`（没人领）；★ 另允许一件事：**L1 已 done 且现在够得上 L2** ⇒ 升一级（` +
          `这正是两级流程的正路，不是覆盖别人的活）。\n` +
          `★ 要换其他已领/已完成（L2）的卡 ⇒ 先 \`release\`（或走 replaces/superseded —— 未实现）。`,
      );
    }
  }

  if (level === 'L2') {
    const refreshed = !!node.task;
    writeTask(feature, node_id, {
      id: node.id,
      // ★★ 逐字来自决策卡（不裁剪、不改写、不拼 acceptance）—— 这样"卡的内容来自哪里"可对拍
      summary: decision?.summary ?? '',
      expectations: expectations.map((e) => ({ ...e })),
      state: 'candidate',
      // ★ L1 ⇒ L2 升级：旧 L1 卡的证据**逐条搬进新卡**（TaskSpec 无卡片历史 ⇒ 不静默丢证据）
      ...(advance && node.task?.evidence?.length ? { evidence: node.task.evidence } : {}),
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
    // ★★★ **空数组**（不是我没填）：L1 的判据是"DSL 建构完整"，用现有六类期望**表达不出来**；
    //   编一条 `file-exists` 之类 = **编造实现判据** ⇒ 那正是本笔要避免的。
    expectations: [],
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
 *  ① `isClaimable(cardStanding(card))`（★ 本函数内直接调用 —— 不把"记得先判"留给调用方）；
 *     ★ 读的是**五值读数里的"可领"两格**（`work` / `violated`），**不是**"判据全过"。
 *     ★★ `satisfied` 卡在这里**必拒**（没活干不许领）—— 这条与 `complete` 的判据**分开**：
 *        收口侧读 `isSatisfied`，两侧同源（都读 `cardStanding`）但**不是同一个谓词**。
 *  ② CAS：`state === 'candidate'` ∧ `owner` 为空 —— 否则**拒**（不覆盖别人的领）；
 *  ③ 写 `owner` + `claimed_at`（`releaseIfExpired` 的 TTL 靠它）。
 *
 * ## ★★★ L1 建构卡为什么不走 `cardStanding`（2026-10-17）
 * L1 卡 `expectations: []` ⇒ `cardStanding` 必给 **`unknowable`**（空集不按全过算）⇒ 若照②拒，
 * **L1 卡永远领不了** = 把"生成 L1 卡"这道口子又堵回去（同一个环的另一种形态）。
 * ★ L1 的"有没有活"是**另一把可判的尺**（不是放宽标准，是换对尺）：
 * **DSL 建构完整吗？** 不完整 ⇒ 有活（可领）；已完整 ⇒ 没活（拒，并指向 publish 出 L2）。
 * 判据唯一出处 = `constructionVerdict`（complete 侧用**同一个函数**判收口）。
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

  // ── L1 建构卡：可领性看「DSL 建构完整吗」，不看对拍 ───────────────────────────
  const level = taskLevel(card);
  let levelNote: string;
  /** L2 的站位读数（L1 没有它 —— 不伪造成 `work`：那是把"判不了"读成"有活"） */
  let claimStanding: CardStanding | undefined;
  if (level === 'L1') {
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
    const standing = await cardStanding(card, { root, nodes: dsl.geometry?.nodes ?? [] });
    if (!isClaimable(standing.standing)) {
      throw new Error(
        `claim 被拒（可领性：${standing.standing}）：${standing.reason}\n` +
          `★ 可领判据唯一出处 = src/domain/task_machine.ts#isClaimable（work / violated 才可领；satisfied 只可收口）。`,
      );
    }
    levelNote = `站位=${standing.standing}；${standing.reason}`;
    claimStanding = standing.standing;
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
      // ★ 首行自足（回执只透出首行）
      `已领取任务 "${node_id}"（owner=${owner}，claimed_at=${claimedAt}）—— ${levelNote}` +
      `\n★ 进度是**派生值**：task.state=claimed ⇒ progress=in_progress（不落第二份）。` +
      (level === 'L1'
        ? `\n★ L1 收口判据 = **DSL 建构完整**（给该节点写 decision.summary + 至少一条 phase=post 的 expectation），` +
          `\`complete\` 也是用这同一把尺判。`
        : ''),
    feature,
    data: {
      node_id,
      level,
      state: 'claimed' as TaskState,
      owner,
      claimed_at: claimedAt,
      ...(claimStanding ? { standing: claimStanding } : {}),
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
  const level = taskLevel(card);
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
          `★ L1 的收口判据 = **DSL 建构完整**（\`docs/task-system-plan.dsl.json\` 的 \`two_level_tasks.L1_construct\`：` +
          `输出"可判的期望"，判据"建构完整" —— ★ **不是代码跑通**）。\n` +
          `★ 怎么办：给节点写决策卡 \`edit_dsl {type:'decision', op:'update', id:'${node_id}', data:{ summary, expectations } }\` ` +
          `（至少一条**相位 post** 的期望，如 \`file-exists\` / \`symbol-exists\`），再 complete。\n` +
          `★ 本工具**不替你编一条期望**（那会变成"永远不判的假验收"）。`,
      );
    }
    closeNote = `L1 建构完整（decision.summary + 后态判据 ${c.post} 条）—— ★ 判据是"DSL 建构完整"，不是代码跑通`;
  } else {
    const root = requireRoot(dsl as { source_root?: string });
    const satisfied = await isSatisfied(card, { root, nodes: dsl.geometry?.nodes ?? [] });
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

  const at = new Date().toISOString();
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
        ...(input.agent ? { agent: input.agent } : {}),
        verdict: 'pass',
      },
    ],
  });

  // ★ 交接期：仍调既有状态入口（设计期望 `completeTask → updateStatus`），让 overlay 的 progress
  //   有一份与派生值一致的投影（★ 权威仍是 task.state；第 ④ 步退役 overlay 后这一行随之下线）。
  // ★★★ 2026-10-18（Q5）：**todo 没有"节点 status"可投影**（它不在 geometry/semantic）⇒ 跳过。
  //   ★ 不跳会怎样（实测）：先 writeTask（写 done）再 updateStatus（报"节点未找到"）⇒
  //     **报错但数据已改** —— 和 Q2 同族（"失败不等于没发生"）。
  let legacy: ReturnType<typeof updateStatus> | null = null;
  if (!isTodo) {
    try {
      legacy = updateStatus({ feature, node_id, status: 'done', evidence });
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
      `已完成任务 "${node_id}"（owner=${card.owner}，级别=${level}）—— ${closeNote}、证据 kind=${evidence!.kind}。` +
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

/** `edit_dsl {type:'task', op:publish|claim|release|complete}` 的分派（★ 四个 action 的唯一入口）。 */
/**
 * ★★★ 2026-10-19：**重开已完成的任务**（`done → claimed`）。
 *
 * ## 为什么要有它（用户裁定，且有真实成本）
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
 * ★ **重开不改判据**（`expectations` 仍来自 decision）。要换判据：先 `edit_dsl type=decision`
 *   改 decision，再 `reopen` —— 否则你会得到一张"用旧判据去验收新工作"的卡。
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
  const next: TaskSpec = {
    ...card,
    state: 'claimed',
    owner: input.owner,
    claimed_at: new Date().toISOString(),
  };
  writeTask(feature, node_id, next);
  return {
    message:
      `已重开任务 "${node_id}"（done → claimed，owner=${input.owner}）\n` +
      `  理由：${input.reason}\n` +
      `  ★ 判据未变（仍来自 decision，${(card.expectations ?? []).length} 条）；` +
      `要换判据请先 edit_dsl type=decision，再 reopen。`,
    feature,
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
    case 'void':
      return voidTask(input);
    case 'reopen':
      return reopenTask(input);
    default:
      // ★ 合法性由 `OP_SPECS` 判（`task.ops` 只有三个）；走到这里说明表与分派漂了。
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
 * ★ 已 `done` / 已 `void` 的卡不许再 void（终态不可变）。
 */
export function voidTask(input: TaskOpInput): EditResult {
  const { feature, node_id, reason } = input;
  if (!reason || !reason.trim()) {
    throw new Error('void 被拒：必须给 `data.reason`（为什么这张卡不需要做了 —— 不留理由的作废等于静默丢弃）。');
  }
  const { card } = loadTask(feature, node_id);
  if (card.state === 'done' || card.state === 'void') {
    throw new Error(`void 被拒：state=${card.state} 是终态，不可再作废。`);
  }
  assertTransition(card.state, 'void', 'void');
  writeTask(feature, node_id, { ...card, state: 'void' });
  return {
    message:
      `已作废任务 "${node_id}"：${card.state} → void。\n` +
      `★ 理由：${reason.trim()}\n` +
      `★ 卡上的判据（${(card.expectations ?? []).length} 条）与证据都保留 —— 作废的是"这活要做"，不是"这活存在过"。`,
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
export function applyTodoOp(
  feature: string,
  op: { op: string; id?: string; data?: Record<string, unknown> },
  agent?: string,
): EditResult {
  // ★★★ 2026-10-18（用户校准）：**promote = 只填 node_id（指向）**，不建卡、不改节点。
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
    if (cur.state === 'done' || cur.state === 'void') {
      throw new Error(`todo.link 被拒：${todoId} 已是终态（${cur.state}）`);
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

  if (op.op !== 'add') throw new Error(`todo 仅支持 add / link（收到 ${op.op}）`);
  const data = op.data ?? {};
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
  if (!summary) throw new Error('todo.add 被拒：必须给 data.summary（要做什么，一句人话）');

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

  const card: TaskSpec = {
    id,
    summary,
    expectations: [], // ★ todo 没有判据（不是代码，判不了）
    state: 'candidate',
    owner: null,
  };
  todos.push(card);
  next.todos = todos;

  const ov = loadOverlay(feature) ?? seedOverlayFromDsl(next);
  saveDesignSheet(applyOverlay(next, ov));

  return {
    message:
      `已新建 todo "${id}"：state=candidate（★ 无节点任务，挂在顶层 todos[]）。\n` +
      `★ 要做什么：${summary}\n` +
      `★ 它和节点任务**同一套规矩**：\`claim\`（要 owner）→ \`complete\`（要 evidence，只有 attestation）→ 或 \`void\`（要 reason）。\n` +
      `★ 而它**没有判据**（不是代码）⇒ 巡检不会对它喊"漏收口"，只会在它 claimed 超期时报 expired。\n` +
      (agent ? `★ 发起者：${agent}\n` : ''),
    feature,
    data: { todo_id: id, state: 'candidate' as TaskState, summary },
  };
}
