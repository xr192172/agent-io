/**
 * failure_origin.ts —— 候选 2 失败归因口径（committed 档案 → 现役只读消费；批 4 阶段 2）。
 *
 * ## 接线口径（Main 2026-11-23 裁决 · 候选 batch4-cand-2）
 * · 归因枚举 `agent / infra / harness / unknown`：`agent` / `infra` 为一手原文口径；
 *   `harness` / `unknown` 为 AgentIO 扩展值（原文没有，provenance 注明；与现役 unsupported/pending
 *   的语义边界待裁）。
 * · **unknown 不得 pass**：归因落到 `unknown` 的判据，即便原判 `pass` 也退为 `unsupported`
 *   （判不了 ≠ 通过；对齐现役 verdict 四值端口纪律）。
 * · `judge_noise` / 翻转率只作判据校准信号**记录**，不混进模型能力分；**阈值未实验前保持 pending**，
 *   本模块不自造翻转率 / 噪声阈值。
 *
 * ## 边界（停报项，不在本模块施工）
 * · 真正落 ledger 字段 / 挂现役 verdict 事件走既有受闸写端；本模块只给归因 → 判定的纯口径，
 *   不新建写端、不另立第二套失败分类；
 * · 翻转率阈值、双评审重判成本、归因枚举取值对账需 Main 裁决 + 实验定标。
 *
 * provenance：口径追溯到阶段 1 committed 条目 `batch4-cand-2`
 * （一手源 https://www.stet.sh/blog/benchmark-agreed-with-frontier-code）。
 */
import type { Verdict } from '../../domain/judge_port.js';
import { FAILURE_ORIGINS, FAILURE_ORIGIN_EXTENSIONS } from './candidates.js';

/** 失败归因取值（闭集；与 `candidates.ts#FAILURE_ORIGINS` 同一住处，不抄第二份）。 */
export type FailureOrigin = (typeof FAILURE_ORIGINS)[number];

/** 扩展值注明（provenance 留痕：哪些枚举值不是一手原文口径）。 */
export const FAILURE_ORIGIN_PROVENANCE_NOTE =
  'agent/infra 为一手原文口径；harness/unknown 为 AgentIO 扩展值（provenance 注明，与现役 unsupported/pending 边界待裁）。';

/** 归因取值是否在闭集内；表外值不静默归到 `unknown`。 */
export function isFailureOrigin(value: unknown): value is FailureOrigin {
  return typeof value === 'string' && (FAILURE_ORIGINS as readonly string[]).includes(value);
}

/** 该取值是否属 AgentIO 扩展（非一手原文）。 */
export function isExtensionOrigin(origin: FailureOrigin): boolean {
  return (FAILURE_ORIGIN_EXTENSIONS as readonly string[]).includes(origin);
}

/**
 * 归因 × 判定口径：`unknown` 兜底值不得产出 `pass`。
 * · `origin=unknown` 且原判 `pass` ⇒ 退为 `unsupported`（判不了 ≠ 通过）；
 * · 其余组合按现役四值原样穿过，不重判、不折算。
 *
 * @throws 归因不在闭集内（表外值不许静默归类）。
 */
export function verdictWithOrigin(origin: unknown, verdict: Verdict): Verdict {
  if (!isFailureOrigin(origin)) {
    throw new Error(
      `failure_origin「${String(origin)}」不在闭集（${[...FAILURE_ORIGINS].join(' / ')}）—— 表外归因不许静默归类`,
    );
  }
  if (origin === 'unknown' && verdict === 'pass') {
    return 'unsupported';
  }
  return verdict;
}

/** judge_noise 校准信号读数（只记录，不进能力分；阈值未实验 ⇒ pending）。 */
export interface JudgeNoiseReading {
  /** 信号已记录（喂判据校准，不作一票否决）。 */
  recorded: true;
  /** 永不混进模型能力分。 */
  mixed_into_capability_score: false;
  /** 阈值状态：未实验定标前恒 `pending`；本模块不自造阈值。 */
  threshold: 'pending';
}

/**
 * 登记一条 judge_noise 信号读数。
 * ★ 阈值未实验前保持 `pending`；不与能力分混算，不做一票否决。
 */
export function recordJudgeNoise(): JudgeNoiseReading {
  return { recorded: true, mixed_into_capability_score: false, threshold: 'pending' };
}
