#!/usr/bin/env node
/**
 * incsel-record.mjs —— 测试通过后落"源码指纹"（柱 3 的写端）。
 * run-tests.mjs 在 `--changed` 模式下、每个测试文件判 **PASS** 后调它一次写盘。
 * 设计成独立进程（带 --import tsx）与选量端同构：真实现只有一份 src 下的 TS 模块。
 *
 * 用法（内部）：
 *   node --import tsx scripts/incsel-record.mjs --root <root> --test <tests/foo.test.ts> [--test <tests/bar.test.ts>] [--mode changed]
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoverageMap, recordPass } from '../src/infrastructure/analysis/facts/test_coverage.ts';
import { collectTestFiles } from './lib/test_files.mjs';

const argv = process.argv.slice(2);
const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const root = path.resolve(val('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const testsToRecord = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--test' && argv[i + 1]) testsToRecord.push(argv[i + 1]);
const mode = val('--mode') ?? 'changed';
if (testsToRecord.length === 0) { process.stderr.write('incsel-record: 至少一个 --test 必填\n'); process.exit(1); }
const tests = collectTestFiles(path.join(root, 'tests')).map((f) => `tests/${f}`);
const coverage = buildCoverageMap(root, { testFiles: tests });
for (const t of testsToRecord) recordPass(root, t, coverage, mode);
process.stdout.write(JSON.stringify({ ok: true, recorded: testsToRecord.length }) + '\n');
