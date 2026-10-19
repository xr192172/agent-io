/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_application_design_dsl_ops_node_ops_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_application_design_dsl_ops_node_ops_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/application/design/dsl_ops/op_data_spec.js'; // src/application/design/dsl_ops/op_data_spec.ts
export type _0 = typeof m0.NODE_DATA_KEYS; // ★ NODE_DATA_KEYS（const）—— ★ data 键的唯一清单（含 path）—— 写端能造什么由它钉死；★ 它住在 op_data_s
import * as m1 from '../../src/application/design/dsl_ops/node_ops.js'; // src/application/design/dsl_ops/node_ops.ts
export type _1 = typeof m1.addNode; // ★ addNode（function）—— 节点新增入口
import * as m2 from '../../src/application/design/dsl_ops/node_ops.js'; // src/application/design/dsl_ops/node_ops.ts
export type _2 = typeof m2.updateNode; // ★ updateNode（function）—— 节点更新入口
