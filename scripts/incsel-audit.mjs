#!/usr/bin/env node
/**
 * incsel-audit.mjs —— **增量选择的消融验证**（T-#INC-TEST-SEL 柱 4 · "选择自身也有判据"）
 *
 * ## 信任的牙齿
 * 增量选择说"只跑 S"。凭据不是"增量绿了"，而是：
 *   ① **全量**跑一遍（node:test 逐文件，拿每文件真实 verdict）；
 *   ② **增量**选一遍（同 `--changed` 的真实现）拿选择集 S；
 *   ③ 逐文件对照：**全量红了但 S 没选中** ⇒ 选择有洞 ⇒ 判红（`ablationCheck`）。
 *
 * 另支持手动消融：对指定 changed 文件，`--explain <changed>` 打印"覆盖它的测试集合"与
 * "当前选择集"，让人手动剔除其中一个覆盖测试再跑全量 —— 若它红，证明选择有洞（真消融）。
 *
 * 用法：
 *   node scripts/incsel-audit.mjs --changed <path> [--jobs N] [--json] [--no-cache]
 *   node scripts/incsel-audit.mjs --explain <src/path> --changed <src/path>
 *
 * ★ 本脚本**不写任何仓库文件**（只读 cache.db / 源码，跑测试走 run-tests 的子进程隔离）；
 *   derived 指纹缓存由 run-tests 在真增量跑时写，这里不写。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildCoverageMap, selectChangedTests, coveringTestsOf, CACHE_REL } from '../src/infrastructure/analysis/facts/test_coverage.ts';
import { ablationCheck, assertAblationTarget } from '../src/infrastructure/analysis/facts/incsel_ablation.ts';
import { collectTestFiles } from './lib/test_files.mjs';

const argv = process.argv.slice(2);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const changed = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--changed') for (const p of String(argv[i + 1] ?? '').split(',')) if (p.trim()) changed.push(p.trim());
}
const jsonOut = argv.includes('--json');
const noCache = argv.includes('--no-cache');
const explain = val('--explain');
if (changed.length === 0 && !explain) {
  process.stderr.write('incsel-audit: 至少给一个 --changed <path>（或 --explain <src/path>）\n');
  process.exit(2);
}

const tests = collectTestFiles(path.join(ROOT, 'tests')).map((f) => `tests/${f}`);
const coverage = buildCoverageMap(ROOT, { testFiles: tests });

// ── 手动消融说明（审计席拿它挑一个覆盖测试剔除）──
if (explain) {
  const covering = coveringTestsOf(coverage, [explain]);
  let selSet = new Set();
  if (changed.length > 0) {
    const sel = selectChangedTests(ROOT, changed, { testFiles: tests, coverage, noCache });
    selSet = new Set(sel.ok ? sel.selected : []);
  }
  const out = {
    explain: explain,
    coveringTests: covering,
    coveringInSelection: covering.filter((t) => selSet.has(t)),
    validAblationTargets: covering.filter((t) => assertAblationTarget(coverage, explain, t).valid),
    hint: '从 coveringTests 里挑一个测试，手动从 --changed 选择中剔除后跑它；若它红 ⇒ 选择有洞（真消融）。',
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(0);
}

// ── ② 增量选择 ──
const sel = selectChangedTests(ROOT, changed, { testFiles: tests, coverage, noCache });
if (!sel.ok) {
  process.stderr.write(`incsel-audit: 选量失败（${sel.reason}）\n`);
  process.exit(2);
}
const selSet = new Set(sel.selected);

// ── ① 全量跑（逐文件，拿真实 verdict）──
// 用 node:test 直接跑每个测试文件（与 run-tests 相同的口径：--import tsx --test --test-reporter tap）
const fullVerdicts = {};
let fullRed = 0;
for (const rel of tests) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter', 'tap', rel], {
    cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const mFail = out.match(/^# fail (\d+)$/m);
  const mTests = out.match(/^# tests (\d+)$/m);
  let v = 'pass';
  if (r.status !== 0 || (mFail && Number(mFail[1]) > 0) || !mTests) v = 'fail';
  fullVerdicts[rel] = v;
  if (v !== 'pass') fullRed++;
}

// ── ③ 逐文件对照（元判据）──
const ab = ablationCheck(fullVerdicts, sel.selected, { map: coverage, changedFiles: changed });
const result = {
  ok: ab.ok,
  changed,
  selection: {
    selected: sel.selected.length,
    total: sel.denominator.total,
    skippedByCache: sel.skippedByCache,
    conservative: sel.denominator.conservative,
    impactUnavailable: sel.denominator.impactUnavailable,
  },
  fullRun: { files: ab.denominator.fullFiles, red: ab.denominator.fullRed },
  holes: ab.holes,
  uncoveredChanged: ab.uncoveredChanged,
  cacheRel: CACHE_REL,
  verdict: ab.ok
    ? '✓ 消融通过：全量红的测试全在增量选择里（选择无洞）'
    : `✗ 消融红：${ab.holes.length} 个全量红的测试被增量选择漏掉（选择有洞）`,
};
if (jsonOut) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
else {
  console.log(`incsel-audit —— 增量选择消融验证（changed=${JSON.stringify(changed)}）`);
  console.log(`  选择：${result.selection.selected} / ${result.selection.total}（缓存跳过 ${result.selection.skippedByCache.length} · 保守纳入 ${result.selection.conservative}）`);
  console.log(`  全量：${result.fullRun.files} 文件 / 红 ${result.fullRun.red}`);
  if (result.uncoveredChanged.length) console.log(`  ⚠ 影子覆盖（改动但无测试覆盖）：${result.uncoveredChanged.join(', ')}`);
  if (result.holes.length) console.log(`  ✗ 漏选（洞）：${result.holes.join(', ')}`);
  console.log(`  ${result.verdict}`);
}
process.exit(ab.ok ? 0 : 1);
