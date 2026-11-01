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

/** 入口注入的跨工具保留键（`actor` / `authorize`）：它们**不是**任何 action 的参数 ⇒ 平铺形态下必须剥掉，
 * 否则会被 `assertExploreArgKeys` 当成拼错的键拒掉（工具面统一注入，见 `server_registry#withCallActor`）。 */
const RESERVED_CALL_KEYS = new Set(['actor', 'authorize']);

/** explore_code：参数化代码理解（用 wrapData：data 不丢弃，杜绝「有结果却静默空输出」）
 * ★★ 主形态 = **平铺**：`{action, ...该 action 的参数}`（AGENTS.md / README / capability_map 举的全是它，
 *   本仓其余工具也都是平铺）⇒ 顶层 `action` 只用来**选动作**，**不进 args**。
 * ★ 不变量：顶层 `action` 一旦漏进 args，就会被 per-action 键表当「不认识的键」拒掉 ——
 *   实测后果是 12 个 action 里 11 个全死（只有 `watch` 活着，因为它的键表本就有 `action`）。
 * ★ `args` 信封只作**兼容别名**保留，且只有 `watch` 真的需要它：它的子动作自己也叫 `action`
 *   （status/declare/ledger/impact/stop），与顶层同名 ⇒ 平铺形态表达不了**两个** action。
 * 缺 action 时从平铺参数反推（query→search / fields→facts / file→read）——
 * 缺 action 时从平铺参数反推（query→search / fields→facts / file→read），消除"习惯平铺传参 → -32602 invalid action"的摩擦。
 * ★ 2026-10-21：加 `fields`→`facts` —— `fields` 是 **facts 独有**的键（read 不认识它）；
 *   只用它反推，**不拿 `file` 去猜**（file 在 read / facts 上都是必填，猜错等于静默换语义）。 */
function resolveExploreAction(a: Record<string, unknown>, args: Record<string, unknown>): string {
  if (typeof a['action'] === 'string') return a['action'] as string;
  if ('query' in args) return 'search';
  // ★ facts 的**独有**键（read 不认识 `fields`）⇒ 只有它才能无歧义地反推出 facts。
  if ('fields' in args) return 'facts';
  if ('file' in args) return 'read';
  const msg = `explore_code 缺顶层 action。可用: ${EXPLORE_ACTIONS.join(' / ')}。search 传 {query, project_dir}，read 传 {file, project_dir}，facts 传 {file, fields?, name?, limit?}（读索引事实；读源码用 read）；其余路径请显式给 action[+args]。`;
  throw new Error(msg);
}

export const exploreCodeHandler = wrapData(async (a) => {
  const hasNested = typeof a.args === 'object' && a.args !== null && !Array.isArray(a.args);
  /** 该 action 的参数袋（**不含**选动作用的顶层 `action`，也不含入口注入的保留键） */
  let args: Record<string, unknown>;
  if (hasNested) {
    args = { ...(a.args as Record<string, unknown>) };
  } else {
    const rest = { ...(a as Record<string, unknown>) };
    delete rest.action;
    for (const k of RESERVED_CALL_KEYS) delete rest[k];
    args = rest;
  }
  const action = resolveExploreAction(a as Record<string, unknown>, args) as never;
  const result = await exploreCode({ action, args });
  return { message: result.message, data: result.data };
});

/** sync_contracts：以 server_registry zod schema 为唯一源，回填 DSL expected_apis。★ wrapData：回 `data: r` */
export const syncContractsHandler = wrapData((a) => {
  const r = syncContracts({ feature: a.feature as string, include_all: a.include_all as boolean | undefined });
  return { message: r.message, data: r };
});
