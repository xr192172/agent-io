/**
 * refactor 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import { wrap, wrapData } from '.././plumbing.js';
import { diffViews } from '.././refactor/diff_views/diff_views.js';

/** diff_views：设计视图 vs 实际代码快照双栏对比。★ wrapData：handler 本就回 `data: r.data`（结构化对比表） */
export const diffViewsHandler = wrapData(async (a) => {
  const r = diffViews({
    feature: a.feature as string,
    live_dir: a.live_dir as string | undefined,
  });
  // ★ 2026-10-05：**必须显式转发 `touched`** —— 本行原先只取 `r.message` / `r.data`，
  //   而 `touched` 挂在 [B] 产物的**顶层** ⇒ 会被静默丢掉（实测 `diff_views` 的 DATA 里没有 `touched`）。
  //   ⇒ 见 `plumbing.ts` 的 `machinePayload` 头注：**[B] 接了契约 ≠ 交付，还要看 [C] 是否把它透出去**。
  return { message: r.message, data: r.data, touched: r.touched };
});
