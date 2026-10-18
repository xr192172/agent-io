/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_application_write_gate_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_application_write_gate_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/application/write_gate.js'; // src/application/write_gate.ts
export type _0 = m0.WriteActor; // ★ WriteActor（type）—— ★ 写闸要知道"谁在写" —— 现在 assertSourceWriteRegistered(pro
import * as m1 from '../../src/application/write_gate.js'; // src/application/write_gate.ts
export type _1 = typeof m1.assertSourceWriteRegisteredFor; // ★ assertSourceWriteRegisteredFor（function）—— ★ 按 actor 判定的入口：要求"覆盖该文件的节点上存在 claimed 卡，且 owner =
