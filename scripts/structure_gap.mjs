#!/usr/bin/env node
/**
 * structure_gap 的**本地壳** —— 判据**全在** `src/infrastructure/analysis/structure/structure_gap.ts`（唯一实现）。
 *
 * ★ 为什么还留这个壳，而不是直接删：
 *   MCP 跑的是 **dist 旧构建**（重构期间刻意不动它）⇒ 本仓自己读缺口时，需要一条
 *   **不依赖 dist** 的路。本壳用 `vite-node`（本仓已有）把源码里的实现直接跑起来。
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
// ★ 这里刻意**不写 `.js` 扩展名**：本壳由 vite-node 跑（不是 tsc），
//   而 vite-node 对 **`.mjs` 里**的 import 不做「`.js` → `.ts`」映射（实测报 ERR_LOAD_URL）。
//   去掉扩展名 ⇒ 走 vite 的 `resolve.extensions`（含 `.ts`）⇒ 能直接加载源码。
//   （源码内部那些 `./x.js` 的 import 不受影响 —— 它们出自 `.ts` 文件，vite 会映射。）
import { structureGap } from '../src/infrastructure/analysis/structure/structure_gap';

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
  const todo = r.misplaced.length + r.unlisted.length;
  console.log(
    todo + r.missing.length === 0
      ? '⇒ 结构意图与现状一致 ✓（★ 这只说明"已开垦区整齐"，不等于"全仓都登记了"）'
      : `⇒ 待处置：**${r.misplaced.length} 个待搬** + **${r.unlisted.length} 个待定归属**；另有 ${r.missing.length} 个**待建域**（搬完自然消失）`,
  );
  console.log('★ 搬完记得：node scripts/preflight_move.mjs <旧> <新> → npm run arch（0 违规）→ 全量。\n');
}
