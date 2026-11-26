#!/usr/bin/env node
/**
 * sheet_guard.mjs —— 册身份守卫（judge-all.mjs 册不重合纵深红路径的唯一判据住处）。
 *
 * ## 它守什么
 * 一道册的回执 `rec.sheet` 必须与本次检查的 `wantSheet` 归一后指向同一处；
 * 回执缺 `sheet` 字段 / 路径不等 ⇒ 不通过并点名「不是同一份」。
 *
 * ## 为什么单独成模块（可直调把守）
 * 原判据内联在 `judge-all.mjs#judgeOne`；显式 `project_dir` 前插锚（fe40d843）落地后，
 * 注册表 decoy 端到端红路径在现役布局下不可达，内联守卫的红路径不再被任何用例触达。
 * 抽出纯函数供单元向量直调（缺字段 / 不等 ⇒ 必红），把纵深路径重新纳入测试面；
 * 守卫源码口径未改，比较仍走 `path_identity.samePath` 唯一实现（软链/大小写/斜杠归一），
 * 本模块不另造第二把路径尺。
 *
 * ## fail-closed 纪律
 * 回执无 `sheet`（老 CLI / 旧 dist / 执行核崩后残件）⇒ 判不通过（读不到 ≠ 通过），不许静默放行。
 */
import { samePath } from './path_identity.mjs';

/**
 * 判册身份是否重合。
 * @param {{feature:string, rec:{sheet?:string}|null, wantSheet:string}} input
 * @returns {{ok:boolean, sheetMismatch?:string}} `ok:false` 时带 `sheetMismatch` 点名文案。
 */
export function guardSheetMismatch({ feature, rec, wantSheet }) {
  if (!rec?.sheet || !samePath(rec.sheet, wantSheet)) {
    return {
      ok: false,
      sheetMismatch: `CLI 判的册 = ${rec?.sheet ?? '(回执里没有 sheet 字段)'}，与本次检查的 ${wantSheet} 不是同一份`,
    };
  }
  return { ok: true };
}
