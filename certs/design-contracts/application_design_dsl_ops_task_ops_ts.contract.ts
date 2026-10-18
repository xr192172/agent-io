/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_application_design_dsl_ops_task_ops_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_application_design_dsl_ops_task_ops_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/application/design/dsl_ops/task_ops.js'; // src/application/design/dsl_ops/task_ops.ts
export type _0 = typeof m0.publishTask; // ★ publishTask（function）—— 立卡：从设计 DSL 抽出这一块 ⇒ 形成任务卡（= board 的发布动作）。★ 缺它则闸对'尚无
import * as m1 from '../../src/application/design/dsl_ops/task_ops.js'; // src/application/design/dsl_ops/task_ops.ts
export type _1 = typeof m1.publishFromDiff; // ★ publishFromDiff（function）—— ★ diff 之后「无卡 ⇒ 补卡」的唯一入口（VISION §7）；它让差异能被上架，而不是靠人手
import * as m2 from '../../src/application/design/dsl_ops/task_ops.js'; // src/application/design/dsl_ops/task_ops.ts
export type _2 = typeof m2.voidTask; // ★ voidTask（kind 未知⇒按 value）—— ★ 卡生命周期的出口（candidate → void）；没有它，代码先于卡存在会让卡永久卡在 ca
