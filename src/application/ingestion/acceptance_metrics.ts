/**
 * acceptance_metrics.ts —— 候选 6 双口径验收（committed 档案 → 现役只读消费；批 4 阶段 2）。
 *
 * ## 接线口径（Main 2026-11-23 裁决 · 候选 batch4-cand-6）
 * · 双口径并列：`criteria_pass_rate`（宽松均分口径，MUST/SHOULD 都计入）+
 *   `all_criteria_pass`（严格二元口径：**MUST 全过**才算严格通过）；
 * · 失败判据 id 作为**一等清单** `failed_criteria_ids`，不许被汇总成一个数消失；
 * · 两个率都走现役 `domain/rate.ts#rateOf` 注册表（分子 ⊆ 分母、双数同印、禁自造问题）——
 *   本模块不另造统计权威，也不复制 `ratioPercent` 取整口径。
 *
 * ## MUST / SHOULD 分层
 * · **MUST**：全过才算严格通过（`all_criteria_pass = MUST 分子 === MUST 分母`）；
 * · **SHOULD**：分期登记，不强制进严格通过口径；仍计入宽松均分率。
 *
 * ## 边界（停报项，不在本模块施工）
 * · MUST/SHOULD 分层与现役判据类型（`Expectation` kind/phase）的对账未决：分层由调用方作为
 *   入参传入，本模块不替现役判据自造 tier 字段；
 * · 双口径字段是否入一期 ledger 落库属后续对账批次（既有受闸写端之外不新建写端）。
 *
 * provenance：口径追溯到阶段 1 committed 条目 `batch4-cand-6`
 * （一手源 https://stripe.dev/blog/stripe-integration-evals-methodology）。
 */
import { rateOf } from '../../domain/rate.js';
import type { Verdict } from '../../domain/judge_port.js';

/** 判据分层（入参；现役判据类型对账见模块头注边界）。 */
export type CriteriaTier = 'MUST' | 'SHOULD';

/** 一条验收判据读数（id 一等清单键；verdict 对齐现役四值）。 */
export interface AcceptanceItem {
  id: string;
  verdict: Verdict;
  tier: CriteriaTier;
}

/** 一条率读数（问题 + 分子 + 分母 + 文本，四件同场，口径来自 rateOf）。 */
export interface RateReading {
  text: string;
  question: string;
  n: number;
  d: number;
}

/** 双口径验收结果。 */
export interface AcceptanceMetrics {
  /** 全部验收判据条数（分母）。 */
  total: number;
  /** 判 `pass` 的条数（宽松分子）。 */
  passed: number;
  /** 失败判据 id 一等清单（fail / unsupported / pending 全部点名；不汇总成数）。 */
  failed_criteria_ids: readonly string[];
  /** 宽松均分口径：pass / 全部判据。 */
  criteria_pass_rate: RateReading;
  /** 严格口径：MUST 全过才算通过。 */
  must: {
    total: number;
    passed: number;
    /** MUST 全过 ⇒ true；有任一 MUST 非 pass ⇒ false。 */
    all_criteria_pass: boolean;
    rate: RateReading;
  };
  /** SHOULD 分期登记：不强制进严格通过口径；条数留痕。 */
  should: { total: number; phased: true };
}

function isPass(v: Verdict): boolean {
  return v === 'pass';
}

/**
 * 计算双口径验收读数。
 * @param items 验收判据读数（id 唯一；tier 由调用方按现役分层口径给）。
 */
export function evaluateAcceptance(items: readonly AcceptanceItem[]): AcceptanceMetrics {
  const allIds = items.map((it) => it.id);
  const passedIds = items.filter((it) => isPass(it.verdict)).map((it) => it.id);
  const failedIds = items.filter((it) => !isPass(it.verdict)).map((it) => it.id);

  const must = items.filter((it) => it.tier === 'MUST');
  const should = items.filter((it) => it.tier === 'SHOULD');
  const mustPassed = must.filter((it) => isPass(it.verdict));

  const criteriaPassRate = rateOf({
    n: passedIds.length,
    d: allIds.length,
    question: 'criteria-pass-rate',
    nItems: passedIds,
    dItems: allIds,
  });
  const mustRate = rateOf({
    n: mustPassed.length,
    d: must.length,
    question: 'must-criteria-all-pass',
    nItems: mustPassed.map((it) => it.id),
    dItems: must.map((it) => it.id),
  });

  return {
    total: items.length,
    passed: passedIds.length,
    failed_criteria_ids: failedIds,
    criteria_pass_rate: {
      text: criteriaPassRate.text,
      question: criteriaPassRate.question,
      n: passedIds.length,
      d: allIds.length,
    },
    must: {
      total: must.length,
      passed: mustPassed.length,
      all_criteria_pass: must.length > 0 && mustPassed.length === must.length,
      rate: { text: mustRate.text, question: mustRate.question, n: mustPassed.length, d: must.length },
    },
    should: { total: should.length, phased: true },
  };
}
