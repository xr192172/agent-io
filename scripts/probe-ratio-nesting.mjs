#!/usr/bin/env node
/**
 * 只读探针 3：design_line ⑥ 的分子是否真在分母里（分子/分母嵌套性）
 *
 * ★ 升格说明（2026-11-03 · `docs/todo.md` §一 2.5「分母口径」）：本文件原住
 *   `.agent-io/scratch/batch1-recon/probe_ratio_nesting.mjs`。升格的理由是「**读数可复算**」的载体
 *   不能住 scratch —— scratch 被 gitignore、且 2026-11-03 已被误删过一次。
 *
 * ★ **逻辑一字不改**（它是取证产物，改了就不再是那份读数）：本文件本来就没有 `src/` import，
 *   搬家只改了位置 + 这段注释。
 *
 * ★ 读法（重要，别把最后一行当"现在的覆盖率"）：`rate =` 那一行印的是**修复前**的式子
 *   `covered.size / sourceFiles.size`（分子不与分母取交）—— 它存在的意义正是**展示那个缺陷**
 *   （越界几项、虚高多少）。修复后的口径在 `design_line.ts` ⑥ 与 `scripts/design-node-coverage.mjs`
 *   （都走 `src/domain/rate.ts#rateOf`）。
 *
 * ★ 跑法：`node scripts/probe-ratio-nesting.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(process.argv[2] ?? '.');
const dbp = path.join(root, '.agent-io/cache.db');
const db = new DatabaseSync(dbp, { readOnly: true });
const sourceFiles = new Set(
  db.prepare("SELECT path FROM files WHERE path NOT LIKE 'scripts/%' AND path NOT LIKE 'dogfood/%'").all().map((r) => r.path.replace(/\\/g, '/')),
);
db.close();

const ddb = path.join(root, 'design-db');
const covered = new Set();
for (const f of fs.readdirSync(ddb).filter((x) => x.endsWith('.calls.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(ddb, f), 'utf8'));
  if (typeof j.path === 'string') covered.add(j.path.replace(/\\/g, '/'));
}
let outside = 0;
const outsideSample = [];
for (const c of covered) if (!sourceFiles.has(c)) { outside++; if (outsideSample.length < 5) outsideSample.push(c); }
console.log('分母 sourceFiles =', sourceFiles.size);
console.log('分子 covered(design-db 份数, 去重后) =', covered.size);
console.log('★ 分子里**不在分母**的 =', outside, '例:', outsideSample.join(' , '));
console.log('rate =', ((covered.size / sourceFiles.size) * 100).toFixed(1) + '%');
