/**
 * observe_log 的 use case —— **HTTP 面（`GET /api/observe/log`）与 MCP 面（`observe_log`）的唯一实现**。
 *
 * 为什么要有它：这两个面原先各写一遍「取 files / 归一 all → queryObserveLog」
 * （serve.ts 的 handler 与 `application/observe/handlers.ts` 各一份）⇒ 同一能力判据住两处。
 * 入参归一（`files` 去空、`all` 认 true/'true'/'1'）搬到这里之后，两个面只剩「取参 → 调它 → 序列化」。
 *
 * ★ 事件文件路径**不在这里解析**：HTTP 面取 `OBSERVE_EVENTS_FILE`、MCP 面取 `events_file` 入参，
 *   那是「配置/入参从哪来」的问题，属于各自的面；本用例只收已经解析好的路径。
 */

import { queryObserveLog, type LogQueryResult } from '../../../infrastructure/analysis/observe/log_query.js';

export interface ObserveLogQueryInput {
  /** 事件文件绝对/相对路径（HTTP 面传 OBSERVE_EVENTS_FILE，MCP 面传 events_file） */
  events_path: string;
  /** 按文件过滤（可多值；空串/非字符串项被剔除） */
  files?: unknown;
  /** 未按文件过滤时是否全量（true / 'true' / '1' 均为真） */
  all?: unknown;
}

/** 查 Observe 事件日志。返回仓储层原样结果（`missing` 表示「文件压根不在」，与「无匹配事件」分开）。 */
export function queryObserveLogUseCase(input: ObserveLogQueryInput): LogQueryResult {
  // ★ 只剔「空串 / 非字符串」：**不 trim** —— 原 MCP 面是 `filter(Boolean)`、HTTP 面在取参时已剔过空白串，
  //   两者在这里保持各自原有的口径（本用例只收「已经取好的 filter 结果」，不追加第二套过滤规则）。
  const files = Array.isArray(input.files)
    ? input.files.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : [];
  const all = input.all === true || input.all === 'true' || input.all === '1';
  return queryObserveLog(input.events_path, { files, all });
}
