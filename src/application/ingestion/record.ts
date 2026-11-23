/**
 * record.ts —— ingestion 切片的记录形状（冻结企划 §2.5 候选分类 + §2.2 九态轨迹）。
 *
 * ## 候选四类（§2.5）
 * 外部文本解析为 **候选事实 / 意图 / 判据 / 任务卡** 四类；不直接成权威行。
 *
 * ## 两层状态（勿混）
 * · 生命周期态（本记录 `state`）：复用 `docs_view/lifecycle.ts` 九态，是流水线位置；
 * · 投影对账态：块核对视图新鲜度，见 `docs_view/check_doc_blocks.ts`，不在本切片。
 *
 * ## 轨迹留痕
 * 每次迁移一条 `TransitionEvent`（时刻 / 前后态 / 理由 / 写者），append-only；
 * 不落快照读数，不复制可由索引现算的事实（对齐 task_schema 铁律 1/2）。
 */
import type { LifecycleState } from '../docs_view/lifecycle.js';
import type { Provenance } from './provenance.js';
import type { NonsemanticStep } from './roads.js';

/** 候选分类闭集（§2.5）。 */
export const RECORD_CATEGORIES = ['fact', 'intent', 'expectation', 'card'] as const;

export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

/** 一次状态迁移留痕事件。 */
export interface TransitionEvent {
  at: string;
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
  writer: string;
}

/** 非语义增强路的降级留痕（可见化：环节 + 口径 + 理由 + 时刻 + 写者）；语义路降级不落这里，走 blocked。 */
export interface DegradationNote {
  at: string;
  step: NonsemanticStep;
  outcome: 'degraded-visible';
  reason: string;
  writer: string;
}

/**
 * 吸收主张的结构化载荷。
 * · `claim`：对齐现役口径后的吸收主张（翻译后；仍受闸，不是权威行）；
 * · `absorbed_as`：Main 口径下的落位形状 / 现役机制对齐方式；
 * · `alignment_anchors`：现役对齐锚点（文件 / 符号 / 关系列），防第二事实源；
 * · `boundary_notes`：不吸收项 / 翻译假设标注 / 与现役的边界；
 * · `blocked_points`：未决 blocked 点（阈值 / 对账 / 范围待裁），逐条点名。
 */
export interface AbsorbedPayload {
  claim: string;
  absorbed_as: string;
  alignment_anchors: readonly string[];
  boundary_notes: readonly string[];
  blocked_points: readonly string[];
}

/** 一条 ingestion 记录（九态位置 + provenance + 轨迹 + 行指纹）。 */
export interface AbsorbedRecord {
  id: string;
  category: RecordCategory;
  state: LifecycleState;
  payload: AbsorbedPayload;
  provenance: Provenance;
  trace: readonly TransitionEvent[];
  /** 非语义增强路降级留痕（可见化）；缺省空数组 */
  degradations: readonly DegradationNote[];
  /** 行级稳定字段指纹（M3 分期；见 provenance.ts#rowFingerprint） */
  row_fingerprint: string;
}
