#!/usr/bin/env node
/**
 * tasks-mirror-gate —— 「tasks.db ↔ tasks.jsonl 镜像对账」门（批 3 · G3）。
 *
 * ## 治哪个洞
 * `tasks.jsonl` 是 `tasks.db` 的投影（权威永远是库）。此前导出失败只告警不影响主写，镜像静默
 * 落后 / 缺行 / 多行 / 字段漂移时没有机器会发现。本门逐行对账库两侧（`live_cards` ∪ `task_history`）
 * 与镜像，分叉即红。
 *
 * ## 判据（判定核在 `src/application/meta/reconcile/tasks_mirror.ts`，本脚本只做 I/O 与三态退出）
 * · `ok`        ⇒ 退出 0（两侧一致）；
 * · `diverged`  ⇒ 退出 1（缺行 / 多行 / 字段不一致 / 坏行 / 未知 kind，逐条点名）；
 * · `unavailable` ⇒ 退出 2（库读端不可判 —— 不折成 0）。
 *
 * ★ 只读：不建库、不导出、不写镜像。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;

const argv = process.argv.slice(2);
const projectDir = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : process.cwd());

let reconcileTasksMirror;
try {
  ({ reconcileTasksMirror } = await import(distUrl('application', 'meta', 'reconcile', 'tasks_mirror.js')));
} catch (e) {
  console.error(`✗ 判不了（退出码 2）：读不到对账模块（${(e && e.message) || e}）⇒ 先 \`npm run build\`。`);
  process.exit(2);
}

const report = reconcileTasksMirror(projectDir);

const countSide = (s) => s.missing.length + s.extra.length + s.mismatches.length;
const total = countSide(report.live) + countSide(report.history) + report.badLines.length;

console.log(
  `任务镜像对账：${report.status === 'ok' ? '一致' : report.status === 'diverged' ? '分叉' : '判不了'}` +
    `（活卡 库 ${report.live.dbRows} / 镜像 ${report.live.mirrorRows}；` +
    `历史 库 ${report.history.dbRows} / 镜像 ${report.history.mirrorRows}）`,
);
if (report.reason) console.log(`  ${report.reason}`);

const dump = (side, label) => {
  for (const m of side.missing) console.error(`  ✗ [${label} 缺行] ${m.key} —— ${m.detail}`);
  for (const m of side.extra) console.error(`  ✗ [${label} 多行] ${m.key} —— ${m.detail}`);
  for (const m of side.mismatches) console.error(`  ✗ [${label} 字段不符] ${m.key} —— ${m.detail}`);
};
dump(report.live, '活卡');
dump(report.history, '历史');
for (const m of report.badLines) console.error(`  ✗ [镜像坏行] ${m.key} —— ${m.detail}`);

if (report.status === 'unavailable') process.exit(2);
if (report.status === 'diverged' || total > 0) process.exit(1);
process.exit(0);
