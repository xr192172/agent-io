/**
 * harvest 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import { wrap, wrapData } from '.././plumbing.js';
import { harvestDecisions } from '.././harvest/harvest_decisions.js';

/** harvest_decisions：从文档/git日志/注释提取决策卡候选（draft，供 review 补录）。★ wrapData：回 `data: r` */
export const harvestDecisionsHandler = wrapData(async (a) => {
  const r = harvestDecisions({
    feature: a.feature as string,
    doc_dir: a.doc_dir as string | undefined,
    git_root: a.git_root as string | undefined,
    limit: a.limit as number | undefined,
    comment_files: a.comment_files as string[] | undefined,
  });
  return { message: r.message, data: r };
});
