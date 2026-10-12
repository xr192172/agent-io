/**
 * 人审/审批工作流工具
 *
 * - submit_approval: 提交审批
 * - review_annotation: 审批（通过/驳回/要求修改）
 * - list_approvals: 列出所有审批（支持按状态筛选）
 * - get_approval_history: 获取单条审批的完整审计日志
 */

import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { Annotation, ApprovalStatus, ApprovalHistoryEntry } from '../../../domain/types.js';
// ★ T198：状态**值**表（运行时）—— 用于把合法值渲染进报错/描述，并在 `listApprovals` 里**校验**。
import { APPROVAL_STATUSES } from '../../../domain/types.js';

function now(): string {
  return new Date().toISOString();
}

function uid(prefix: string = 'h'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 确保 annotation 有 approval_history */
function ensureHistory(ann: Annotation): ApprovalHistoryEntry[] {
  if (!ann.approval_history) ann.approval_history = [];
  return ann.approval_history;
}

/** 添加一条审批历史记录 */
function addHistory(ann: Annotation, action: ApprovalHistoryEntry['action'], status: ApprovalStatus, actor: string, comment?: string): void {
  const history = ensureHistory(ann);
  history.push({
    id: uid('ah'),
    action,
    status,
    actor,
    comment,
    timestamp: now(),
  });
  ann.approval_status = status;
  // 兼容旧字段
  if (status === 'approved') {
    ann.resolved = true;
    ann.resolved_at = now();
    ann.resolution_note = comment;
  }
}

// ─────────────────────────────────────────────────────────────
// submit_approval
// ─────────────────────────────────────────────────────────────

export interface SubmitApprovalInput {
  feature: string;
  annotation_id: string;
  assignee?: string;
  submitter?: string;
  comment?: string;
}

export interface SubmitApprovalResult {
  message: string;
  feature: string;
  annotation_id: string;
  status: ApprovalStatus;
}

export function submitApproval(input: SubmitApprovalInput): SubmitApprovalResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature "${input.feature}" 不存在`);
  if (!dsl.annotations) throw new Error('该 feature 没有标注');

  const ann = dsl.annotations.find(a => a.id === input.annotation_id);
  if (!ann) throw new Error(`标注 "${input.annotation_id}" 不存在`);

  if (ann.approval_status === 'pending_review') {
    throw new Error('该标注已在审批中，无法重复提交');
  }

  if (input.assignee) {
    ann.assignee = input.assignee;
  }

  addHistory(ann, 'submit', 'pending_review', input.submitter ?? 'llm', input.comment);
  saveDSL(dsl);

  return {
    message: `已提交审批：${ann.id}\n状态: pending_review\n指派人: ${ann.assignee ?? '(未指派)'}`,
    feature: input.feature,
    annotation_id: ann.id,
    status: 'pending_review',
  };
}

// ─────────────────────────────────────────────────────────────
// review_annotation
// ─────────────────────────────────────────────────────────────

/**
 * ★★ **`approval.review` 的 `data.decision` 合法值 —— 唯一住处**（2026-10-12 T198）。
 *
 * ## 为什么它是常量 + 从这里导出
 * 此前值域**只以三份散落的字面量存在**（本文件里的 interface 联合 / switch 分支 / 状态标签 map）
 * ⇒ ★ **MCP 描述里一个字都没有** ⇒ 读者（LLM）只能**试错**才知道填什么
 *   （实测：填 `approved` ⇒ `未知决策: approved`）。
 * ⇒ 现在值域**只此一处**：本常量。校验（`reviewAnnotation`）与描述
 *   （`op_data_spec.ts` 的 `approval` note，渲染进 `edit_dsl`）**都从它派生** ——
 *   改了这里，描述**自动跟**（不需要有人记得同步第二份）。
 *
 * ## ★ 是【动作词】，不是【状态词】
 * `approve`（动作）≠ `approved`（状态）；`reject` ≠ `rejected`。
 * `data.decision` 收的是**动作**；落地后的 `approval_status` 才是状态（见 `DECISION_EFFECT`）。
 */
export const APPROVAL_DECISIONS = ['approve', 'reject', 'request_revision'] as const;

/** ★ 合法决策值（从 {@link APPROVAL_DECISIONS} 推导 —— 别再手写第二份联合类型）。 */
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * ★ 每个决策的**效果**：动作（进历史）· 落地状态 · 中文标签。
 * ★★ 键集由 `ApprovalDecision` **约束** ⇒ `APPROVAL_DECISIONS` 加了值而这里没跟 ⇒ **`tsc` 直接红**
 *   （照本仓 `op_data_spec.ts` 里 `Record` 覆盖式断言的同款防漂移）。
 */
const DECISION_EFFECT: Record<ApprovalDecision, { action: ApprovalHistoryEntry['action']; status: ApprovalStatus; label: string }> = {
  approve: { action: 'approve', status: 'approved', label: '已通过' },
  reject: { action: 'reject', status: 'rejected', label: '已驳回' },
  request_revision: { action: 'request_revision', status: 'needs_revision', label: '要求修改' },
};

export interface ReviewAnnotationInput {
  feature: string;
  annotation_id: string;
  decision: ApprovalDecision;
  reviewer: string;
  comment?: string;
}

export interface ReviewAnnotationResult {
  message: string;
  feature: string;
  annotation_id: string;
  status: ApprovalStatus;
}

export function reviewAnnotation(input: ReviewAnnotationInput): ReviewAnnotationResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature "${input.feature}" 不存在`);
  if (!dsl.annotations) throw new Error('该 feature 没有标注');

  const ann = dsl.annotations.find(a => a.id === input.annotation_id);
  if (!ann) throw new Error(`标注 "${input.annotation_id}" 不存在`);

  if (ann.approval_status !== 'pending_review') {
    throw new Error(`当前状态为 ${ann.approval_status ?? 'draft'}，无法审批。请先提交审批。`);
  }

  // ★★ 2026-10-12 T198：值域以 `APPROVAL_DECISIONS` **一处**判定；★ 报错**点名合法值**
  //   （此前只说 `未知决策: approved` —— 不指路；照本仓"回执即文档"的经验补上合法值）。
  const effect = DECISION_EFFECT[input.decision as ApprovalDecision] as
    | (typeof DECISION_EFFECT)[ApprovalDecision]
    | undefined;
  if (!effect) {
    throw new Error(
      `未知决策: ${input.decision}（★ 合法值: ${APPROVAL_DECISIONS.join(' / ')}` +
        ` —— 注意是【动作词】不是状态词，如 \`approve\` 而非 \`approved\`）`,
    );
  }

  addHistory(ann, effect.action, effect.status, input.reviewer, input.comment);
  saveDSL(dsl);

  const statusLabel = effect.label;

  return {
    message: `审批${statusLabel}：${ann.id}\n审批人: ${input.reviewer}\n意见: ${input.comment ?? '(无)'}`,
    feature: input.feature,
    annotation_id: ann.id,
    status: effect.status,
  };
}

// ─────────────────────────────────────────────────────────────
// list_approvals
// ─────────────────────────────────────────────────────────────

export interface ListApprovalsInput {
  feature: string;
  status?: ApprovalStatus;
  assignee?: string;
}

export interface ListApprovalsResult {
  message: string;
  feature: string;
  annotations: Array<{
    id: string;
    text: string;
    type?: string;
    status: ApprovalStatus | 'draft';
    assignee?: string;
    node_id?: string;
    history_count: number;
  }>;
}

export function listApprovals(input: ListApprovalsInput): ListApprovalsResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature "${input.feature}" 不存在`);

  const annotations = dsl.annotations ?? [];
  let filtered = annotations;

  if (input.status) {
    // ★★★ T198：**未知状态 ⇒ 抛**。★ 原先这里**不校验** ⇒ 传个写错的状态会**静默返回 0 行**
    //   ⇒ ★ 读者会读成"没有待审批的"，而**不是**"你参数写错了"（§2.3「不报错的错」）。
    //   ★ 与 T197 治 `explore_code` 的"键名错就抛"是**同一把尺**：**错的输入不许静默变成空结果**。
    if (!(APPROVAL_STATUSES as readonly string[]).includes(input.status)) {
      throw new Error(
        `未知审批状态 "${input.status}" —— ★ 合法值：${APPROVAL_STATUSES.map((s) => '`' + s + '`').join(' · ')}。` +
          '★ 注意：尚未提交审批的批注状态是 `draft`，**默认不过滤时它也会出现在本查询里**。',
      );
    }
    filtered = filtered.filter(a => (a.approval_status ?? 'draft') === input.status);
  }
  if (input.assignee) {
    filtered = filtered.filter(a => a.assignee === input.assignee);
  }

  const result = filtered.map(a => ({
    id: a.id,
    text: a.text.slice(0, 60) + (a.text.length > 60 ? '...' : ''),
    type: a.type,
    status: a.approval_status ?? 'draft',
    assignee: a.assignee,
    node_id: a.node_id ?? a.target_id,
    history_count: a.approval_history?.length ?? 0,
  }));

  const statusLabel = input.status ? ` (状态: ${input.status})` : '';
  const assigneeLabel = input.assignee ? ` (指派人: ${input.assignee})` : '';

  const lines: string[] = [];
  lines.push(`审批列表${statusLabel}${assigneeLabel}：共 ${result.length} 条`);
  lines.push('');
  for (const a of result) {
    const icon = {
      draft: '📝',
      pending_review: '⏳',
      approved: '✅',
      rejected: '❌',
      needs_revision: '🔄',
    }[a.status] ?? '❓';
    lines.push(`  ${icon} [${a.status}] ${a.id} — ${a.text}`);
    if (a.assignee) lines.push(`     指派人: ${a.assignee}`);
    if (a.node_id) lines.push(`     节点: ${a.node_id}`);
    lines.push('');
  }

  return {
    message: lines.join('\n'),
    feature: input.feature,
    annotations: result,
  };
}

// ─────────────────────────────────────────────────────────────
// get_approval_history
// ─────────────────────────────────────────────────────────────

export interface GetApprovalHistoryInput {
  feature: string;
  annotation_id: string;
}

export interface GetApprovalHistoryResult {
  message: string;
  feature: string;
  annotation_id: string;
  current_status: ApprovalStatus | 'draft';
  history: ApprovalHistoryEntry[];
}

export function getApprovalHistory(input: GetApprovalHistoryInput): GetApprovalHistoryResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature "${input.feature}" 不存在`);
  if (!dsl.annotations) throw new Error('该 feature 没有标注');

  const ann = dsl.annotations.find(a => a.id === input.annotation_id);
  if (!ann) throw new Error(`标注 "${input.annotation_id}" 不存在`);

  const history = ann.approval_history ?? [];
  const currentStatus = ann.approval_status ?? 'draft';

  const lines: string[] = [];
  lines.push(`审批历史：${ann.id}`);
  lines.push(`当前状态: ${currentStatus}`);
  lines.push(`标注内容: ${ann.text}`);
  lines.push('');
  lines.push('历史记录：');
  for (const h of history) {
    const actionLabel = {
      submit: '📤 提交',
      approve: '✅ 通过',
      reject: '❌ 驳回',
      request_revision: '🔄 要求修改',
      revise: '✏️ 修改后提交',
      close: '🔒 关闭',
    }[h.action] ?? h.action;
    lines.push(`  ${h.timestamp}`);
    lines.push(`    ${actionLabel} — ${h.actor}`);
    if (h.comment) lines.push(`    意见: ${h.comment}`);
    lines.push('');
  }

  return {
    message: lines.join('\n'),
    feature: input.feature,
    annotation_id: ann.id,
    current_status: currentStatus,
    history,
  };
}
