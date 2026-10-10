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

/** harvest_decisions：把注释/文档/提交信息提取成「这个文件为什么存在」的决策（LLM 判定）。
 * ★ 「判」可开可关：judge:true 强制判（无密钥抛）；judge:false 降级只给三份证据（回执明说）；省略=自动。
 * ★ wrapData：回 `data: r`（含 judged 位，调用方可机器判定"这次判没判"） */
export const harvestDecisionsHandler = wrapData(async (a) => {
  const r = await harvestDecisions({
    feature: a.feature as string,
    doc_dir: a.doc_dir as string | undefined,
    git_root: a.git_root as string | undefined,
    limit: a.limit as number | undefined,
    files: a.files as string[] | undefined,
    judge: a.judge as boolean | undefined,
  });
  return { message: r.message, data: r };
});
