/**
 * meta 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import { wrap, wrapData } from '.././plumbing.js';
import { EXPLORE_ACTIONS, exploreCode } from '.././meta/explore/explore_code.js';
import { syncContracts } from '.././meta/registry/sync_contracts.js';

/** explore_code：参数化代码理解（用 wrapData：data 不丢弃，杜绝「有结果却静默空输出」）
 * 兼容两种入参形态：`{ action, args:{...} }`（嵌套，规范）或平铺 `{ action, query, ... }`——
 * 缺 action 时从平铺参数反推（query→search / file→read），消除"习惯平铺传参 → -32602 invalid action"的摩擦。 */
function resolveExploreAction(a: Record<string, unknown>, args: Record<string, unknown>): string {
  if (typeof a['action'] === 'string') return a['action'] as string;
  if ('query' in args) return 'search';
  if ('file' in args) return 'read';
  const msg = `explore_code 缺顶层 action。可用: ${EXPLORE_ACTIONS.join(' / ')}。search 传 {query, project_dir}，read 传 {file, project_dir}；其余路径请显式给 action[+args]。`;
  throw new Error(msg);
}

export const exploreCodeHandler = wrapData(async (a) => {
  const hasNested = typeof a.args === 'object' && a.args !== null && !Array.isArray(a.args);
  const args = (hasNested ? a.args : a) as Record<string, unknown>;
  const action = resolveExploreAction(a as Record<string, unknown>, args) as never;
  const result = await exploreCode({ action, args });
  return { message: result.message, data: result.data };
});

/** sync_contracts：以 server_registry zod schema 为唯一源，回填 DSL expected_apis。★ wrapData：回 `data: r` */
export const syncContractsHandler = wrapData((a) => {
  const r = syncContracts({ feature: a.feature as string, include_all: a.include_all as boolean | undefined });
  return { message: r.message, data: r };
});
