/**
 * 标注与审批类型
 */

/** 审批状态 */
export type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'needs_revision';

/**
 * ★★★ T198（2026-10-12）：`ApprovalStatus` 的**运行时形态**。
 *
 * ## 为什么类型不够、还要一个值
 * `ApprovalStatus` 是**类型** —— ★ **类型渲染不进 MCP 描述**（描述是运行时字符串）。
 * ⇒ 于是"合法值有哪些"就只能在**描述里手写一份** ⇒ ★ 那就是第二份、会漂。
 * ⇒ 本常量 = **唯一可渲染处**；`describe` 里从它**渲染**；★★ 由下面两条**类型级断言**钉死与 `ApprovalStatus` 一致。
 * （★ 照本仓 `op_data_spec.ts` 里 `_assert...` 的同款防漂移手法。）
 */
export const APPROVAL_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'needs_revision'] as const;

/** ★ 断言一：常量**不漏**类型的成员（漏了 ⇒ 不是 never ⇒ `tsc` 红） */
export type _AssertStatusesCover = Exclude<ApprovalStatus, (typeof APPROVAL_STATUSES)[number]> extends never
  ? true
  : ['★ `APPROVAL_STATUSES` 漏了这些状态 ⇒ 补上：', Exclude<ApprovalStatus, (typeof APPROVAL_STATUSES)[number]>];
export const _assertStatusesCover: _AssertStatusesCover = true;

/** ★ 断言二：常量**不多**（多了 ⇒ 不是 never ⇒ `tsc` 红） */
export type _AssertStatusesNoExtra = Exclude<(typeof APPROVAL_STATUSES)[number], ApprovalStatus> extends never
  ? true
  : ['★ `APPROVAL_STATUSES` 多了这些（不在 `ApprovalStatus` 里）⇒ 删掉：', Exclude<(typeof APPROVAL_STATUSES)[number], ApprovalStatus>];
export const _assertStatusesNoExtra: _AssertStatusesNoExtra = true;

/** 审批记录 */
export interface ApprovalHistoryEntry {
  id: string;
  status: ApprovalStatus;
  action: 'submit' | 'approve' | 'reject' | 'request_revision' | 'revise' | 'close';
  comment?: string;
  actor: string;
  timestamp: string;
}

/** 标注 */
export interface Annotation {
  id: string;
  /** 指向 node.id 或 edge.id（兼容字段：也支持 node_id） */
  target_id?: string;
  /** 新版：直接指明所属节点 ID */
  node_id?: string;
  text: string;
  /** 标注类型 */
  type?: 'comment' | 'question' | 'issue' | 'suggestion' | 'approval';
  /** 严重程度 */
  severity?: 'info' | 'warning' | 'critical';
  author?: 'human' | 'llm' | string;
  /** 创建时间 */
  created?: string;
  /** 时间戳（新增字段） */
  timestamp?: string;
  /** 是否已解决 */
  resolved?: boolean;
  /** 解决时间 */
  resolved_at?: string;
  /** 解决说明 */
  resolution_note?: string;
  /** 审批状态 */
  approval_status?: ApprovalStatus;
  /** 审批历史（审计日志） */
  approval_history?: ApprovalHistoryEntry[];
  /** 指派给谁 */
  assignee?: string;
  /** 标签（自定义分类） */
  tags?: string[];
  /** 思维导图画布坐标（便签位置，用户拖动后持久化） */
  pos?: { x: number; y: number };
}
