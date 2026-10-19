/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_domain_task_machine_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_domain_task_machine_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/domain/task_machine.js'; // src/domain/task_machine.ts
export type _0 = typeof m0.cardStanding; // ★ cardStanding（function）—— ★ 讨论 2 · P30：『这张卡此刻处在哪种处境』要有**一个具名读数**（work/violat
import * as m1 from '../../src/domain/task_machine.js'; // src/domain/task_machine.ts
export type _1 = typeof m1.isSatisfied; // ★ isSatisfied（function）—— ★ 讨论 2 · P30：收口侧要能**独立**被问（complete 与 patrol 的 mis
import * as m2 from '../../src/domain/expectation.js'; // src/domain/expectation.ts
export type _2 = typeof m2.expectationPhase; // ★ expectationPhase（function）—— ★ T10 收归：前态判据（edge-absent 等）的分类由「期望自带的 phase」决定，不再
import * as m3 from '../../src/domain/task_machine.js'; // src/domain/task_machine.ts
export type _3 = typeof m3.releaseIfExpired; // ★ releaseIfExpired（function）—— TTL 超时回收：claimed_at 不配超时就是死锁字段
