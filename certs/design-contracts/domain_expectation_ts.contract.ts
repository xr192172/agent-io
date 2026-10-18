/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_domain_expectation_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_domain_expectation_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _0 = typeof m0.EXPECTATION_KINDS; // ★ EXPECTATION_KINDS（const）—— ★ 六种 kind 的唯一清单（填卡时查它，不许拟造）
import * as m1 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _1 = typeof m1.expectationPhase; // ★ expectationPhase（function）—— ★ 分类由期望自带 ⇒ 状态机不必"记得剔除"前态判据
import * as m2 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _2 = typeof m2.postExpectations; // ★ postExpectations（function）—— ★ 满足度只由后态算（这是 edge-absent 不污染满足度的关键）
import * as m3 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _3 = typeof m3.assertValidExpectations; // ★ assertValidExpectations（function）—— 运行时抛错并列出合法值 ⇒ 拟造不出来
import * as m4 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _4 = typeof m4.expectationSubjectPath; // ★ expectationSubjectPath（function）—— ★ 一只红落在谁的 path 上 —— cardStanding 的归属判据靠它
