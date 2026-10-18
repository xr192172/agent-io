/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_domain_validator_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_domain_validator_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/domain/validator.js'; // src/domain/validator.ts
export type _0 = typeof m0.validateDSL; // ★ validateDSL（function）—— 唯一入口：DSL ⇒ 错误清单
import * as m1 from '../../src/domain/validator.js'; // src/domain/validator.ts
export type _1 = typeof m1.validateDSLJson; // ★ validateDSLJson（function）—— JSON 层的入口（先拒语法错，再谈语义）
import * as m2 from '../../src/domain/validator.js'; // src/domain/validator.ts
export type _2 = m2.ValidationResult; // ★ ValidationResult（interface）—— 返回值形状是契约（errors + keys，调用方按它对账）
