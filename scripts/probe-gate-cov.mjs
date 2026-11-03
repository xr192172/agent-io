#!/usr/bin/env node
/**
 * 只读探针 2：闸覆盖 vs design_line 分母（2.5 的两个"覆盖"口径）
 *
 * ★ 升格说明（2026-11-03 · `docs/todo.md` §一 2.5「分母口径」）：本文件原住
 *   `.agent-io/scratch/batch1-recon/probe_gate_cov.mjs`。升格的理由是「**读数可复算**」的载体
 *   不能住 scratch —— scratch 被 gitignore、且 2026-11-03 已被误删过一次
 *   ⇒ 判据/文档里引用的"现算命令"不能指向一个随时会消失的文件。
 *
 * ★ **逻辑一字不改**（它是取证产物，改了就不再是那份读数）：唯一改动是两处相对 import
 *   从 `../../../src/…` 改为 `../src/…`（文件换了层级）。
 *
 * ★ 跑法：`node --import tsx scripts/probe-gate-cov.mjs`
 *   （它 import 的 `write_gate.ts` 内部有 `.js` 相对 import ⇒ 需要 tsx 的解析）
 */
import fs from 'node:fs';
import path from 'node:path';
import { collectGateCoverage } from '../src/application/write_gate.ts';
import { codeSourceExtSet, isIndexSkippedFileName, SKIP_DIR_BASE } from '../src/infrastructure/parse/source_exts.ts';

const root = path.resolve(process.argv[2] ?? '.');

// ── A. 闸口径：root features 的 byPath 并集（"写闸管得到哪些源文件"）
const cov = collectGateCoverage(root);
const union = new Set();
for (const f of cov.features) for (const k of f.byPath.keys()) union.add(k);
console.log('[闸] totalFeatures=%d rootFeatureCount=%d unaddressable=%d unionPaths=%d', cov.totalFeatures, cov.rootFeatureCount, cov.unaddressable.length, union.size);

// ── B. watch 视野（代码扩展名 ∧ 非噪音/非测试 ∧ 非跳过目录）
const exts = codeSourceExtSet();
let watch = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR_BASE.has(e.name)) continue;
      walk(path.join(dir, e.name));
    } else {
      const ext = path.extname(e.name);
      if (!exts.has(ext)) continue;
      if (isIndexSkippedFileName(e.name, false)) continue;
      watch++;
    }
  }
};
walk(root);
let coveredInWatch = 0;
for (const rel of union) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  const ext = path.extname(rel);
  if (!exts.has(ext)) continue;
  if (isIndexSkippedFileName(path.basename(rel), false)) continue;
  coveredInWatch++;
}
console.log('[watch] 视野=%d covered=%d unmapped=%d  => %s%%', watch, coveredInWatch, watch - coveredInWatch, ((coveredInWatch / watch) * 100).toFixed(1));
