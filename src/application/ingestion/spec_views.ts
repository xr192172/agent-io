/**
 * spec_views.ts —— 候选 1 active/archived 分层与取代指针解析（committed 档案 → 现役只读消费；批 4 阶段 2）。
 *
 * ## 接线口径（Main 2026-11-23 裁决 · 候选 batch4-cand-1）
 * · **active 规格**参与现行判据 / 上下文注入；**archived** 只作证据检索（历史可查，非常驻指导）；
 * · 取代以**关系**表达（`superseded_by` 指针 + supersede 事件 + 归档墓碑），**不恢复 / 不新增**
 *   `superseded` 持久状态（2026-10-22 退役裁决：取代是关系，不是状态）；
 * · 取代指针必须可解析：指向记录不在册 ⇒ `unsupported`（悬空不静默忽略）。
 *
 * ## 对齐现役锚点（不另立第二事实源）
 * · `src/domain/semantic.ts#SymbolLifecycle.superseded_by`（现役关系列）；
 * · `src/application/ledger/ledger.ts#supersedeRow`（supersede 事件；被取代行 state 仍 active）；
 * · `.agent-io/design/archived/`（归档册 overlay 墓碑：文件离开 `semantic.files`，属墓碑而非数据错）。
 *
 * ## 边界（停报项）
 * · 归档读端过滤口径（哪些节点不参与判据与上下文注入）与现役归档册 / 墓碑机制的对账未决；
 *   本模块只给基于九态位置的只读分层视图，不改现役读端过滤实现。
 *
 * provenance：口径追溯到阶段 1 committed 条目 `batch4-cand-1`
 * （一手源 https://dev.to/pvgomes/specs-are-not-agent-memory-5a9n）。
 */
import type { LifecycleState } from '../docs_view/lifecycle.js';
import type { Verdict } from '../../domain/judge_port.js';
import type { AbsorbedRecord } from './record.js';

/** 参与现行判据 / 上下文注入的九态位置（已落权威并投影；blocked / 未裁决不进注入）。 */
const INJECTION_STATES: readonly LifecycleState[] = ['committed', 'projected'];

/** 只作证据检索的九态位置（归档墓碑；历史可查，非常驻指导）。 */
const EVIDENCE_ONLY_STATES: readonly LifecycleState[] = ['archived'];

/** active 分层视图：参与判据 / 上下文注入的记录。 */
export function activeInjectionRecords(records: readonly AbsorbedRecord[]): AbsorbedRecord[] {
  return records.filter((r) => INJECTION_STATES.includes(r.state));
}

/** archived 分层视图：只作证据检索的记录。 */
export function archivedEvidenceRecords(records: readonly AbsorbedRecord[]): AbsorbedRecord[] {
  return records.filter((r) => EVIDENCE_ONLY_STATES.includes(r.state));
}

/** 可被取代指针指向的最小主体形状（对齐现役 `superseded_by` 关系列）。 */
export interface SupersedeSubject {
  id: string;
  superseded_by?: string | null;
}

/** 指针解析结果。 */
export type SupersedeResolution =
  | { kind: 'none'; verdict: null; target: null; why: string }
  | { kind: 'resolved'; verdict: null; target: SupersedeSubject; why: string }
  | { kind: 'dangling'; verdict: 'unsupported'; target: null; why: string };

/**
 * 解析一条主体的 `superseded_by` 指针。
 * · 无指针 ⇒ `none`；
 * · 指针在册 ⇒ `resolved`（返回目标主体；**不把任何主体置成 superseded 状态**——取代是关系不是结局）；
 * · 指针悬空（目标不在册）⇒ `dangling`，verdict = `unsupported`，不静默忽略。
 */
export function resolveSupersededPointer<T extends SupersedeSubject>(
  subject: T,
  subjects: readonly T[],
): SupersedeResolution {
  const ptr = subject.superseded_by == null ? '' : String(subject.superseded_by).trim();
  if (!ptr) {
    return { kind: 'none', verdict: null, target: null, why: '无取代指针' };
  }
  const target = subjects.find((s) => s.id === ptr);
  if (!target) {
    return {
      kind: 'dangling',
      verdict: 'unsupported',
      target: null,
      why: `取代指针悬空：superseded_by=${ptr} 在记录集中解析不到目标 —— 判不了，不静默忽略`,
    };
  }
  return { kind: 'resolved', verdict: null, target, why: `取代目标 = ${target.id}（关系指向；双方状态不因此改写）` };
}

/** 现役四值透传类型别名（供读端对齐；悬空口径见 {@link resolveSupersededPointer}）。 */
export type { Verdict };
