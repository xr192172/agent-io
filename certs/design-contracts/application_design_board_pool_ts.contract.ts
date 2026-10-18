/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_application_design_board_pool_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_application_design_board_pool_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/application/design/board/pool.js'; // src/application/design/board/pool.ts
export type _0 = m0.BoardView; // ★ BoardView（interface）—— 池的读数是具名类型（不许散装对象 —— 否则又是"形状没人定"）
import * as m1 from '../../src/application/design/board/pool.js'; // src/application/design/board/pool.ts
export type _1 = typeof m1.listPool; // ★ listPool（function）—— ★ 唯一的读取入口；没有它，pool 就又只能 node -e 看
