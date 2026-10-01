/**
 * package_migration —— 包改名/提级线（对外入口）
 *
 * 场景（用户洞见）：屎山积木换代时，新包常沿用旧目录/旧包名的历史残留——
 *   1. 目录已物理提到新位置，但 `package` 还是旧名（如 package v2）；
 *   2. 全项目 import 还指向"旧逻辑路径"（如 internal/hub/v2，但目录已不存在）；
 *   3. import 别名保留（hubv2 / hubclientv2 / v2），名字与换代后的包名不符；
 *   4. 日志/插桩字符串里残留旧路径字样。
 * 本线把这些一次性、确定性地涤荡干净，交给验证闭环兜底（改后黄了就回滚）。
 *
 * ★ 2026（拆分）：原单文件 `package_migration.ts`（639 行）按语言拆成
 *   `core.ts` / `parts.ts` / `languages/{registry,go,ts,py}.ts`。
 *   本 `index.ts` 对外再导出**与拆分前逐字相同**的 API（仅下面两条）。
 */
export { computeMigrationPlan } from './core.js';
export type { MigrationPlanOptions } from './core.js';
