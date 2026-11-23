/**
 * ablation_scope.ts —— 候选 5 安慰剂消融范围与分名口径（committed 档案 → 现役只读消费；批 4 阶段 2）。
 *
 * ## 接线口径（Main 2026-11-23 裁决 · 候选 batch4-cand-5）
 * · **一期范围**：DSL / 判据 / 提示注入「内容上线前」的等长中性文本安慰剂消融；
 * · **二期边界（只登记不施工）**：长会话 / 多轮场景边界 —— 短任务测不出长会话收益，门设计须承认该边界；
 * · **严格分名**：本门 = `content_placebo_ablation`；现役选择漏选消融 = `incsel_ablation`。
 *   两者不同构（等长中性文本安慰剂臂 ≠ 全量 vs 增量选中集合逐文件对照），不替代、不混淆、不共用 ablation 口径。
 *
 * ## 边界（停报项）
 * · 消融任务集、模型对照、CI 成本是否入一期范围待 Main 裁；不吸收外部 trials / 任务数为内部阈值；
 * · 长会话 / 多轮边界二期登记，本批不施工。
 *
 * provenance：口径追溯到阶段 1 committed 条目 `batch4-cand-5`
 * （一手源 https://github.com/simonether/skill-placebo）。
 */
import { CONTENT_PLACEBO_ABLATION, INCSEL_ABLATION } from './candidates.js';

/** 一期消融作用域（内容上线前：DSL / 判据 / 提示注入）。 */
export const PLACEBO_PHASE1_SCOPE = ['dsl', 'criteria', 'prompt-injection'] as const;

/** 二期边界（只登记范围，不在本批施工）。 */
export const PLACEBO_PHASE2_BOUNDARY = ['long-session', 'multi-turn'] as const;

export type PlaceboScopeItem = (typeof PLACEBO_PHASE1_SCOPE)[number];
export type PlaceboPhase2Boundary = (typeof PLACEBO_PHASE2_BOUNDARY)[number];

/** 消融核分类结果。 */
export type AblationKind = 'content-placebo' | 'incsel' | 'unknown';

export interface AblationScopeReading {
  kind: AblationKind;
  /** content-placebo 的一期作用域；其余为 null。 */
  phase1_scope: readonly PlaceboScopeItem[] | null;
  /** 二期边界登记；其余为 null。 */
  phase2_boundary: readonly PlaceboPhase2Boundary[] | null;
  /** 分名对照：现役漏选消融核名（不共用口径）。 */
  incsel_name: typeof INCSEL_ABLATION;
}

/**
 * 按门名归类消融核。
 * · `content_placebo_ablation` ⇒ 一期范围 + 二期边界登记；
 * · `incsel_ablation` ⇒ 现役漏选消融（对照锚点，不归入安慰剂臂）；
 * · 表外名 ⇒ `unknown`（不静默并入任一臂；不替它造口径）。
 */
export function classifyAblation(name: string): AblationScopeReading {
  if (name === CONTENT_PLACEBO_ABLATION) {
    return {
      kind: 'content-placebo',
      phase1_scope: PLACEBO_PHASE1_SCOPE,
      phase2_boundary: PLACEBO_PHASE2_BOUNDARY,
      incsel_name: INCSEL_ABLATION,
    };
  }
  if (name === INCSEL_ABLATION) {
    return { kind: 'incsel', phase1_scope: null, phase2_boundary: null, incsel_name: INCSEL_ABLATION };
  }
  return { kind: 'unknown', phase1_scope: null, phase2_boundary: null, incsel_name: INCSEL_ABLATION };
}
