/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_application_design_dsl_ops_op_data_spec_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_application_design_dsl_ops_op_data_spec_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/application/design/dsl_ops/op_data_spec.js'; // src/application/design/dsl_ops/op_data_spec.ts
export type _0 = typeof m0.OP_SPECS; // ★ OP_SPECS（const）—— ★ 四个 op 的唯一清单（publish/claim/release/complete）
import * as m1 from '../../src/application/design/dsl_ops/op_data_spec.js'; // src/application/design/dsl_ops/op_data_spec.ts
export type _1 = m1.NodeKeysMissingFromList; // ★ NodeKeysMissingFromList（type）—— ★ 类型级断言：interface 有、清单没有 ⇒ tsc 红
