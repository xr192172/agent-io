/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_domain_geometry_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_domain_geometry_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/domain/geometry.js'; // src/domain/geometry.ts
export type _0 = m0.Node; // ★ Node（interface）—— ★ 节点的形状（path 是正式字段 —— 写端造得出"只带路径"的节点）
import * as m1 from '../../src/domain/geometry.js'; // src/domain/geometry.ts
export type _1 = m1.NodeDecision; // ★ NodeDecision（interface）—— ★ 决策卡的形状：summary + acceptance + expectations
