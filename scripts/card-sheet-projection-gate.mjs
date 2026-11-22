#!/usr/bin/env node
/**
 * card-sheet-projection-gate —— 「卡 ↔ 册结案投影点名」（批 3 · C6 · M6 一期口径：点名优先于强制）。
 *
 * ## 治哪个洞
 * 一张已结案（done/void）的卡，凭据按 `cardLivesOf` 三来源合一：`live_cards` / `task_history` /
 * 设计册 `node.task`。本门点名：**册上自报结案、但库两侧都查不到下落**的册单侧投影。
 *
 * ## 一期边界（显式登记，不假红）
 * · 按设计 done/void 的 task 卡留在册里、从不迁出，册单侧结案投影在存量里是一大类；本批**只做只读
 *   点名可见化**，不挂强制红门、不建基线棘轮。是否收窄子集 / 二期转强制门，留 Main 裁。
 * · 判卡下落的唯一权威仍是 `cardLivesOf`；本脚本只格式化它产出的 `lives` / `why`，不重查三处。
 * · 读册失败 ⇒ 退出 2（报告不可信，不回落成"没有"）。
 *
 * 退出码：0 = 册读成功（点名清单已打印，存量不判红）；2 = 判不了。
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distUrl = (...p) => pathToFileURL(path.join(repoRoot, 'dist', 'src', ...p)).href;

const argv = process.argv.slice(2);
const projectDir = path.resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : process.cwd());

let nameClosedOnlyProjections;
try {
  ({ nameClosedOnlyProjections } = await import(
    distUrl('application', 'meta', 'reconcile', 'stale_projection.js')
  ));
} catch (e) {
  console.error(`✗ 判不了（退出码 2）：读不到点名模块（${(e && e.message) || e}）⇒ 先 \`npm run build\`。`);
  process.exit(2);
}

const report = nameClosedOnlyProjections(projectDir);

if (!report.sheetsOk) {
  console.error(`✗ 判不了（退出码 2）：读设计册失败 ⇒ 点名不可信：${report.reason ?? ''}`);
  process.exit(2);
}

console.log(
  `结案投影点名：结案 ${report.closedTotal} 张 · 册单侧（库两侧无凭据）${report.closedOnly.length} 张` +
    '（一期仅点名，不判红；强制门槛留二期/Main 裁）',
);
for (const h of report.closedOnly.slice(0, 20)) {
  console.log(`  · ${h.cardId} [${h.feature} ${h.state}] 凭据：${h.why}`);
}
if (report.closedOnly.length > 20) {
  console.log(`  … 其余 ${report.closedOnly.length - 20} 张略（完整清单走 ` +
    '`cardLivesOf` 现算）');
}
process.exit(0);
