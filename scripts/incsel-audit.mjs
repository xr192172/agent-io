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
 *   node scripts/incsel-audit.mjs [--json] [--no-cache]   # 全量参照模式：无 changed ⇒ 选择集=全量保守纳入，
 *                                                          #   contrastive=false（平凡弱证据，holes=0 不构成真对照）
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
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const ROOT = path.resolve(val('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const changed = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--changed') for (const p of String(argv[i + 1] ?? '').split(',')) if (p.trim()) changed.push(p.trim());
}
const jsonOut = argv.includes('--json');
const noCache = argv.includes('--no-cache');
const explain = val('--explain');
// ★ 全量参照模式：无 --changed 且非 --explain ⇒ 不判"缺参数"，走全量对照（选择集=全量保守纳入，contrastive=false）。
const contrastive = changed.length > 0;
// ★ --sample N：轻量抽样上限（本机 L4 ≤20 文件；顺序截断，非分层抽样，读数仅本机探针；全量 227 参考跑归 CI/阶段边界）。
const sampleArg = val('--sample');
const sampleN = sampleArg === undefined ? Infinity : Number(sampleArg);
if (sampleArg !== undefined && (!Number.isInteger(sampleN) || sampleN < 1)) {
  process.stderr.write('incsel-audit: --sample 必须给 ≥1 的整数\n');
  process.exit(2);
}

const allTests = collectTestFiles(path.join(ROOT, 'tests')).map((f) => `tests/${f}`);
const tests = Number.isFinite(sampleN) ? allTests.slice(0, sampleN) : allTests;
const coverage = buildCoverageMap(ROOT, { testFiles: allTests });

/** TAP 汇总四态计数（口径对齐 run-tests#tapCounts）；缺汇总行 ⇒ null。 */
function tapCounts(out) {
  const n = (re) => { const m = out.match(re); return m ? Number(m[1]) : null; };
  return { tests: n(/^# tests (\d+)$/m), fail: n(/^# fail (\d+)$/m), skipped: n(/^# skipped (\d+)$/m), todo: n(/^# todo (\d+)$/m) };
}

/** 逐文件 verdict 四态：fail>0 / 退出码非 0 / 无用例 ⇒ fail；skip·todo>0 ⇒ skip；否则 pass。error 归 fail。 */
function verdictOf(r, out) {
  const c = tapCounts(out);
  if (r.status !== 0 || (c.fail ?? 0) > 0 || !c.tests) return 'fail';
  if ((c.skipped ?? 0) > 0 || (c.todo ?? 0) > 0) return 'skip';
  return 'pass';
}

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
// 对照模式（有 changed）：走真选量；全量参照模式（无 changed）：选择集=全量保守纳入（fail-closed 不缩面），
//   此时全量红必然都在选择集内 ⇒ holes 恒空是**平凡弱证据**，contrastive=false 显形，不冒充真对照。
let sel = null;
let selSelected = [];
if (contrastive) {
  sel = selectChangedTests(ROOT, changed, { testFiles: tests, coverage, noCache });
  if (!sel.ok) {
    process.stderr.write(`incsel-audit: 选量失败（${sel.reason}）\n`);
    process.exit(2);
  }
  selSelected = sel.selected;
} else {
  selSelected = [...tests];
}

// ── ① 全量跑（逐文件，拿真实 verdict 四态）──
// 用 node:test 直接跑每个测试文件（与 run-tests 相同的口径：--import tsx --test --test-reporter tap）
const fullVerdicts = {};
const skipFiles = [];
for (const rel of tests) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter', 'tap', rel], {
    cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const v = verdictOf(r, out);
  fullVerdicts[rel] = v;
  if (v === 'skip') skipFiles.push(rel);
}

// ── ③ 逐文件对照（元判据）──
const ab = ablationCheck(fullVerdicts, selSelected, { map: coverage, changedFiles: changed });
const verdictCounts = { pass: 0, fail: 0, skip: 0, error: 0 };
for (const v of Object.values(fullVerdicts)) verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
const redFiles = Object.entries(fullVerdicts).filter(([, v]) => v === 'fail' || v === 'error').map(([f]) => f).sort();
const result = {
  ok: ab.ok,
  contrastive,
  changed,
  selection: {
    selected: selSelected.length,
    selectedFiles: [...selSelected].sort(),
    total: sel?.denominator.total ?? tests.length,
    skippedByCache: sel?.skippedByCache ?? [],
    conservative: sel?.denominator.conservative ?? tests.length,
    impactUnavailable: sel?.denominator.impactUnavailable ?? null,
  },
  fullRun: { files: ab.denominator.fullFiles, red: ab.denominator.fullRed, redFiles, ...verdictCounts },
  holes: ab.holes,
  skipped: skipFiles.sort(),
  uncoveredChanged: ab.uncoveredChanged,
  cacheRel: CACHE_REL,
  note: contrastive
    ? null
    : '非对照模式：无 --changed，选择集=全量保守纳入；holes=0 为平凡弱证据，不构成漏选闭合证明（真对照需 changed 集 + 全量参照）。',
  verdict: !contrastive
    ? '○ 全量参照模式：选择集=全量，holes 平凡为空（非真对照；读数仅作 fullVerdicts 基线）'
    : ab.ok
      ? '✓ 消融通过：全量红的测试全在增量选择里（选择无洞）'
      : `✗ 消融红：${ab.holes.length} 个全量红的测试被增量选择漏掉（选择有洞）`,
};
if (jsonOut) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
else {
  console.log(`incsel-audit —— 增量选择消融验证（changed=${JSON.stringify(changed)}${contrastive ? '' : ' · 全量参照模式'}）`);
  console.log(`  选择：${result.selection.selected} / ${result.selection.total}（缓存跳过 ${result.selection.skippedByCache.length} · 保守纳入 ${result.selection.conservative}）`);
  console.log(`  全量：${result.fullRun.files} 文件 / 红 ${result.fullRun.red} / skip ${result.fullRun.skip}`);
  if (result.uncoveredChanged.length) console.log(`  ⚠ 影子覆盖（改动但无测试覆盖）：${result.uncoveredChanged.join(', ')}`);
  if (result.skipped.length) console.log(`  ○ skip 计洞口径内（未验）：${result.skipped.join(', ')}`);
  if (result.holes.length) console.log(`  ✗ 漏选（洞）：${result.holes.join(', ')}`);
  if (result.note) console.log(`  ${result.note}`);
  console.log(`  ${result.verdict}`);
}
// 非对照模式不判红（选择集=全量，无漏选可判）；对照模式 holes>0 ⇒ exit 1。
process.exit(contrastive && !ab.ok ? 1 : 0);
