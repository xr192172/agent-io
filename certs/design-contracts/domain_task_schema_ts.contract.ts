/**
 * ★★★ 符号级契约（**自动生成**，勿手改）—— file_src_domain_task_schema_ts
 *
 * 来源：`.agent-io/design/<f>.dsl.json` 的 `geometry.nodes[file_src_domain_task_schema_ts].decision.expectations`
 * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）
 *
 * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。
 * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。
 */

import * as m0 from '../../src/domain/task_schema.js'; // src/domain/task_schema.ts
export type _0 = m0.TaskState; // ★ TaskState（type）—— 五态要是显式类型，不许散落字符串
import * as m1 from '../../src/domain/task_schema.js'; // src/domain/task_schema.ts
export type _1 = m1.TaskSpec; // ★ TaskSpec（interface）—— 任务格的结构要有具名类型
