#!/usr/bin/env node
/**
 * incsel-select.mjs —— `--changed` 选量的**进程内实现**（run-tests.mjs 通过它取 JSON）。
 *
 * 为什么要单独一个进程：`scripts/run-tests.mjs` 自己是被裸 `node` 启动的（不带 --import tsx），
 * 而选量核心住 src 下的 TS 模块（与 `impactOfChanged` 同源）。本文件用 `node --import tsx` 起，
 * import 真实现、算完把结果打到 stdout（唯一一行 JSON），run-tests 只解析不重算 —— 判据只有一处。
 *
 * 用法（内部，不需人直接调）：
 *   node --import tsx scripts/incsel-select.mjs --root <root> --changed <p> [--changed <p2>] [--no-cache] [--json]
 * stdout = 一行 JSON（SelectionResult）；stderr 只放警告/实验特性噪声。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoverageMap, selectChangedTests, CACHE_REL } from '../src/infrastructure/analysis/facts/test_coverage.ts';
import { collectTestFiles } from './lib/test_files.mjs';

const argv = process.argv.slice(2);
const val = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = path.resolve(val('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const changed = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--changed') {
    const v = argv[i + 1] ?? '';
    for (const p of v.split(',')) if (p.trim()) changed.push(p.trim());
  }
}
const noCache = argv.includes('--no-cache');
const tests = collectTestFiles(path.join(root, 'tests')).map((f) => `tests/${f}`);
const coverage = buildCoverageMap(root, { testFiles: tests });
const result = selectChangedTests(root, changed, { testFiles: tests, coverage, noCache });
process.stdout.write(JSON.stringify({ ...result, cacheRel: CACHE_REL }) + '\n');
