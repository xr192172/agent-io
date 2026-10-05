#!/usr/bin/env node
/**
 * structure_gap 的**本地壳** —— 判据**全在** `src/infrastructure/analysis/structure/structure_gap.ts`（唯一实现）。
 *
 * ★ 2026-10-04 改：**去掉 `vite-node`**，本壳直接读 `dist/`。
 *   原因：`vite-node` 是 vitest 的传递依赖 —— 用户裁定「把框架全删掉」后它一并消失。
 *   走 dist 反而更对：MCP 跑的就是 dist ⇒ **本地读数与产品读数同一份代码**（判据真正唯一）。
 *   代价：跑之前要 `npm run build`（没 build 就如实报错，不静默降级）。
 *
 * ★★ 判据**禁止**写在本文件里（这是本仓头号病根「判据分叉」的典型形态）：
 *   2026-10-02 本文件原本自带一整套四态判据，产品化时已**逐字搬进** `structure_gap.ts`。
 *   往这里再抄一份（哪怕只是"顺手加个小过滤"）⇒ 工具与本地读数**口径不一致**，
 *   而"哪份是对的"没人能判定。要改判据 ⇒ 改 `.ts`，本壳跟着变。
 *
 * 用法：npm run structure:gap [-- <项目根>] [--json]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★ 从 `dist/` 读（与 MCP 跑的是同一份产物）⇒ 必须带 `.js` 扩展名（Node ESM 不做扩展名推断）。
import { structureGap } from '../dist/src/infrastructure/analysis/structure/structure_gap.js';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const rootArg = argv.find((a) => !a.startsWith('--'));
const projectDir = rootArg ? path.resolve(rootArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const r = structureGap(projectDir);

if (asJson) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(`\n=== structure_gap：结构意图 vs 现状 ===`);
  console.log(`项目: ${projectDir}`);
  if (!r.configured) {
    console.log(`⚠️ 未声明结构意图（根下 ${r.config_path} 不存在）—— 这不是错误，是"尚未开垦"。\n`);
    process.exit(0);
  }
  console.log(`域表: ${r.config_path}（${r.domain_count} 个域 + ${r.flat_count} 个平铺目录）\n`);
  const sec = (title, items) => {
    console.log(`${items.length ? '⚠️ ' : '✅ '}${title}: ${items.length}`);
    for (const it of items) console.log(`      ${it.path}   ${it.note}`);
    console.log();
  };
  sec('★ misplaced（在，但不在目标域 —— 这就是待搬清单）', r.misplaced);
  sec('unlisted（在，归属未定 —— 要决定，不要猜）', r.unlisted);
  sec('missing（域目录还不存在 / 域里没有源码 —— 与 misplaced 一体两面）', r.missing);
  sec('⚠ misnested（role=capability 的域，却住在另一个域/混装筐里 —— 拆不拆请拍板）', r.misnested);
  const todo = r.misplaced.length + r.unlisted.length;
  const clean = todo + r.missing.length + r.misnested.length === 0;
  console.log(
    clean
      ? '⇒ 结构意图与现状一致 ✓（★ 这只说明"已开垦区整齐"，不等于"全仓都登记了"）'
      : `⇒ 待处置：**${r.misplaced.length} 个待搬** + **${r.unlisted.length} 个待定归属**` +
          `${r.missing.length ? `；${r.missing.length} 个**待建域**（搬完自然消失）` : ''}` +
          `${r.misnested.length ? `；**${r.misnested.length} 处声明与位置打架**（域表已登记，只是位置与 role 不配 —— 搬目录 or 改 role，先想清楚哪个是真的）` : ''}`,
  );
  console.log('★ 搬完记得：用 code_health 看环与分层违规 → 逐个工具试用一遍。\n');
}
