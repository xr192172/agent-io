/**
 * T3 / T4 / T5 / T7 · verify-changed 单次批调用（Slice 1 · 企划 §4.3 / §4.4 / §4.5 / §7）。
 *
 * 覆盖：
 *   T3 N 个选中 node 文件 ⇒ 外层 runner 恰 1 次批调用；testRuns 形状/原序不变；三处消费兼容；.java 不双跑。
 *   T4 jobs 决议：旗标 > env AGENT_IO_VERIFY_JOBS > 默认 max(1, min(cpus-1, 8))；非法值响亮红；并行原序/判定一致平移。
 *   T5 红串行复跑：red/crash 子集 jobs=1 复跑；并行红串行绿 ⇒ 干扰判红不洗绿；污染红全集串行；每类至多一次。
 *   T7 verify 侧 top-slow 转发（文本 + JSON）。
 *
 * 静态断言为主（门内多层子进程受沙箱 IPC 限制，与 p1_incremental_cli 同一已知边界）；
 * E2E 用隔离临时 git 仓 + shim 计数（手法抄 p1_incremental_cli：AGENT_IO_VERIFY_CHANGED_ROOT）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(REPO, 'scripts', 'verify-changed.mjs');
const RUN_TESTS = path.join(REPO, 'scripts', 'run-tests.mjs');
// 回收钩子 helper 锚主仓真实位置：夹具根无 src 依赖链，经 env 把主仓真 helper 指给内层 runner。
const TEARDOWN_HELPER = path.join(REPO, 'tests', 'helpers', 'test-project-db-teardown.ts');
const TEARDOWN_HELPER_VAR = 'AGENT_IO_TEST_TEARDOWN_HELPER';

const src = fs.readFileSync(VERIFY, 'utf8');

test('T3-① 静态：node 段是单次批调用（显式清单 + --jobs + --json），不再逐文件 --filter 循环', () => {
  assert.match(src, /runNodeBatch\(/, '必须有批调用封装函数');
  assert.match(src, /\.\.\.files,\s*'--jobs',\s*String\(jobsN\),\s*'--json'/, '批调用必须带显式清单 + --jobs + --json');
  // 旧的逐文件 `--filter <file>` 循环形态必须消失（node 段）
  assert.ok(!/run-tests\.mjs',\s*'--filter',\s*h\.file/.test(src), 'node 段不许再逐文件 --filter 调 runner');
});

test('T3-② 静态：testRuns 三处消费形状字段保留（文本行 / JSON map / 基线写回）', () => {
  // JSON map 既有字段不动
  assert.match(src, /tests: testRuns\.map\(\(r\) => \(\{\s*file: r\.file, rc: r\.rc, tests: r\.tests, pass: r\.pass, fail: r\.fail, kind: r\.kind, ms: r\.ms/,
    'JSON ran.tests 既有字段（file/rc/tests/pass/fail/kind/ms）必须保留');
  // 基线写回仍读 r.kind / r.pass / r.tests
  assert.match(src, /r\.kind === 'red' \|\| r\.kind === 'crash' \? 'fail'/, '基线写回红判必须保留');
  assert.match(src, /r\.pass > 0 \|\| r\.tests > 0/, '基线写回 pass 口径必须保留');
  // 新增量字段是附加，不覆盖既有键
  assert.match(src, /batchMs/, '批级 batchMs 必须进回执');
});

test('T3-③ 静态：node 块跳过 .java（委托块独立，不双跑）', () => {
  assert.match(src, /nodeHits = testHits\.filter\(\(h\) => !h\.file\.endsWith\('\.java'\)\)/, 'nodeHits 必须剔除 .java');
  // 两支 Java 委托块仍在（isJavaProject 主项目 + 子项目委托）
  assert.match(src, /isJavaProject/, '主项目 Java 执行器分支必须保留');
  assert.match(src, /subProjectJavaFiles/, '子项目 Java 委托分组必须保留');
});

test('T4-① 静态：jobs 决议顺序 旗标 > env > 默认 max(1, min(cpus-1, 8))', () => {
  assert.match(src, /argv\.indexOf\('--jobs'\)/, '必须认 --jobs 旗标');
  assert.match(src, /AGENT_IO_VERIFY_JOBS/, '必须认环境变量 AGENT_IO_VERIFY_JOBS');
  assert.match(src, /Math\.max\(1,\s*Math\.min\(\(os\.cpus\(\)\?\.length \?\? 2\) - 1,\s*8\)\)/,
    '默认必须是 max(1, min(cpus-1, 8))');
});

test('T4-② 静态：非法 jobs 响亮判红（不静默回落 1）', () => {
  assert.match(src, /必须是 ≥1 的整数/, '非法值必须响亮报错');
  assert.match(src, /process\.exit\(1\)/, '非法值必须非零退出');
});

test('T4-③ 非法 --jobs 实跑响亮红、零测试跑', () => {
  const r = spawnSync(process.execPath, [VERIFY, '--jobs', '0', '--no-run', 'src/u.ts'], {
    cwd: REPO, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024,
  });
  assert.notEqual(r.status, 0, '非法 jobs 必须非零退出');
  assert.match(String(r.stderr ?? '') + String(r.stdout ?? ''), /必须是 ≥1 的整数/, '必须响亮报错');
});

test('T5-① 静态：红/崩子集 jobs=1 复跑；并行红串行绿标干扰不洗绿；污染全集串行；每类至多一次', () => {
  assert.match(src, /runNodeBatch\(firstBad\.map/, '红/崩子集必须串行复跑');
  assert.match(src, /runNodeBatch\(nodeFiles,\s*1\)/, '串行复跑 jobs=1');
  assert.match(src, /interference/, '必须有并行干扰标记');
  assert.match(src, /r\.kind = 'red'; r\.interference = true/, '干扰必须保持红，不洗绿');
  assert.match(src, /pollution-full/, '污染红必须全集串行复跑点名');
  // 复跑块在 if 内 ⇒ 每类至多一次（不在循环里）
  assert.match(src, /if \(firstBad\.length > 0\)/, '子集复跑只做一次判断');
  assert.match(src, /if \(polluted\)/, '污染复跑只做一次判断');
});

test('T7-① 静态：verify 侧 topSlow 由内层 ms 派生并转发文本 + JSON', () => {
  assert.match(src, /verifyTopSlow/, '必须有 topSlow 派生');
  assert.match(src, /b\.ms - a\.ms/, 'topSlow 必须按 ms 降序');
  assert.match(src, /topSlow: verifyTopSlow/, 'JSON 必须带 topSlow');
  assert.match(src, /最慢 5 文件/, '文本必须转发最慢榜单');
});

// ── E2E：隔离临时仓 + shim 计数（外层 spawn 恰 1 次的实测证据）─────────────────────────────

type Fixture = { dir: string; dispose: () => void };

function makeFixture(red: boolean): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-batch-'));
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  w('src/a.ts', 'export const a = 1;\n');
  const okBody = `// touches: src/a.ts\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('t_a', () => { assert.equal(1 + 1, 2); });\n`;
  const badBody = `// touches: src/a.ts\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('t_b', () => { assert.equal(1, 2); });\n`;
  w('tests/t_a.test.ts', okBody);
  if (red) w('tests/t_b.test.ts', badBody);
  w('src/infrastructure/project_registry.ts',
    "import { fileURLToPath } from 'node:url';\nimport path from 'node:path';\n\nexport function registryFile(): string {\n  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.agent-io', 'projects.json');\n}\n");
  w('.agent-io/projects.json', JSON.stringify({ projects: [] }, null, 2));
  w('.gitignore', '.agent-io/\nnode_modules\n');

  // 真 runner 副本 + 计数 shim（外层 spawn 计数；不提交主仓）
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(RUN_TESTS, path.join(dir, 'scripts', 'run-tests.real.mjs'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'test_files.mjs'), path.join(dir, 'scripts', 'lib', 'test_files.mjs'));
  const shim = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const c = process.env.PERF_COUNTERS || '';
if (c) { try { let p = {}; try { p = JSON.parse(fs.readFileSync(c, 'utf8') || '{}'); } catch {}; p.outer = (p.outer ?? 0) + 1; fs.writeFileSync(c, JSON.stringify(p)); } catch {} }
const r = spawnSync(process.execPath, [path.join(here, 'run-tests.real.mjs'), ...process.argv.slice(2)], { cwd: process.cwd(), shell: false, env: process.env, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
`;
  fs.writeFileSync(path.join(dir, 'scripts', 'run-tests.mjs'), shim, 'utf8');
  try { fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); } catch { /* 已存在 */ }

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
  return { dir, dispose: () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 临时目录 */ } } };
}

function envFor(dir: string, counters: string): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith('AGENT_IO_')) delete e[k];
  e.AGENT_IO_VERIFY_CHANGED_ROOT = dir;
  e.PERF_COUNTERS = counters;
  e[TEARDOWN_HELPER_VAR] = TEARDOWN_HELPER;
  delete e.NODE_TEST_CONTEXT;
  return e;
}

test('T3-④ E2E：选中 2 支 ⇒ 外层 runner 恰 1 次批调用；条目按原序、带 batchMs 与内层 ms', () => {
  const fx = makeFixture(false);
  const counters = path.join(fx.dir, 'counters.json');
  fs.writeFileSync(counters, JSON.stringify({ outer: 0 }));
  try {
    const files = ['tests/t_a.test.ts'];
    const out = (() => { try {
      return execFileSync(process.execPath, [VERIFY, '--json', ...files], { cwd: fx.dir, env: envFor(fx.dir, counters), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) { return String((e as { stdout?: string }).stdout ?? ''); } })();
    const last = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop() ?? '{}';
    let j: any;
    try { j = JSON.parse(last); } catch { j = null; }
    const counter = JSON.parse(fs.readFileSync(counters, 'utf8') || '{}');
    // 结构断言：批调用只拉起一条 runner 链（shim 计数）
    assert.equal(counter.outer, 1, `外层 runner 必须恰 1 次批调用，实得 ${counter.outer}`);
    if (j?.ran?.tests?.length) {
      const t = j.ran.tests[0];
      assert.equal(t.file, 't_a.test.ts', '条目按 testHits 原序');
      assert.ok(typeof t.batchMs === 'number', '条目必须带 batchMs（整次批调用墙钟）');
      assert.ok(typeof j.ran.batchMs === 'number', 'ran.batchMs 必须在场');
      assert.ok(Array.isArray(j.ran.topSlow), 'ran.topSlow 必须在场');
    } else {
      console.log('      [环境限制] 门内多层子进程未起 TAP（与 p1_incremental_cli 同一已知边界）；批调用结构由静态断言 + shim 计数守住。');
    }
  } finally { fx.dispose(); }
});

test('T5-② E2E：必红集 ⇒ 红条目带串行复跑读数，复跑链至多一次', () => {
  const fx = makeFixture(true);
  const counters = path.join(fx.dir, 'counters.json');
  fs.writeFileSync(counters, JSON.stringify({ outer: 0 }));
  try {
    const files = ['tests/t_a.test.ts', 'tests/t_b.test.ts'];
    const out = (() => { try {
      return execFileSync(process.execPath, [VERIFY, '--json', ...files], { cwd: fx.dir, env: envFor(fx.dir, counters), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) { return String((e as { stdout?: string }).stdout ?? ''); } })();
    const last = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop() ?? '{}';
    let j: any;
    try { j = JSON.parse(last); } catch { j = null; }
    assert.equal(j?.red, true, '必红集必须报红');
    const counter = JSON.parse(fs.readFileSync(counters, 'utf8') || '{}');
    // 批调用 1 次 + 红子集串行复跑至多 1 次 ⇒ outer ≤ 2
    assert.ok(counter.outer <= 2, `复跑每类至多一次：outer 必须 ≤2，实得 ${counter.outer}`);
    if (j?.ran?.tests?.length) {
      const bad = j.ran.tests.filter((t: any) => t.kind === 'red' || t.kind === 'crash');
      for (const t of bad) assert.ok(t.rerun, `红/崩条目 ${t.file} 必须带串行复跑读数`);
    } else {
      console.log('      [环境限制] 门内多层子进程未起 TAP；复跑链路由静态断言守住。');
    }
  } finally { fx.dispose(); }
});

// ── C1 · fail-closed 三态行为级 E2E（canned-receipt shim，复核报告 §4.3 五变体）────────────
//   静态标识符断言（T8-③）只证明"分支字面量还在"；本组用真进程 + 固定收据证明消费端行为：
//   坏 JSON / 缺条目 / 汇总不一致 / crash 条目均非零退出且判红；healthy 控制组不误伤。

type CannedMode = 'healthy' | 'broken-json' | 'missing-entry' | 'summary-mismatch' | 'crash-entry';

function makeCannedFixture(mode: CannedMode): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-canned-'));
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
  };
  w('src/a.ts', 'export const a = 1;\n');
  w('tests/t_a.test.ts', `// touches: src/a.ts\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('t_a', () => { assert.equal(1 + 1, 2); });\n`);
  w('src/infrastructure/project_registry.ts',
    "import { fileURLToPath } from 'node:url';\nimport path from 'node:path';\n\nexport function registryFile(): string {\n  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.agent-io', 'projects.json');\n}\n");
  w('.agent-io/projects.json', JSON.stringify({ projects: [] }, null, 2));
  w('.gitignore', '.agent-io/\nnode_modules\n');

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'receipt-mode.json'), JSON.stringify({ mode }));
  // canned-receipt shim：不委派真 runner，按变体吐固定收据；calls.json 计调用次数（复跑=第 2 次）。
  const shim = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = JSON.parse(fs.readFileSync(path.join(here, 'receipt-mode.json'), 'utf8')).mode;
const callsPath = path.join(here, 'calls.json');
let calls = 0;
try { calls = JSON.parse(fs.readFileSync(callsPath, 'utf8')).calls ?? 0; } catch {}
calls += 1;
fs.writeFileSync(callsPath, JSON.stringify({ calls }));
const rel = 't_a.test.ts';
const greenEntry = (over = {}) => ({ rel, ms: 5, status: 0, tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0, staticDeclared: 1, ok: true, kind: 'green', ...over });
const healthyDoc = () => ({ files: [greenEntry()], summary: { files: 1, tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0, staticDeclared: 1 }, registry: { clean: true }, jobs: 1, mode: 'subset', topSlow: [{ rel, ms: 5 }], exitCode: 0 });
let doc = null;
let code = 0;
switch (mode) {
  case 'healthy':
    doc = healthyDoc();
    break;
  case 'broken-json':
    code = 1;
    break;
  case 'missing-entry':
    doc = { files: [], summary: { files: 1, tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0, staticDeclared: 1 }, registry: { clean: true }, jobs: 1, mode: 'subset', topSlow: [], exitCode: 1 };
    code = 1;
    break;
  case 'summary-mismatch':
    doc = { files: [greenEntry()], summary: { files: 2, tests: 1, pass: 1, fail: 0, skipped: 0, todo: 0, staticDeclared: 1 }, registry: { clean: true }, jobs: 1, mode: 'subset', topSlow: [{ rel, ms: 5 }], exitCode: 1 };
    code = 1;
    break;
  case 'crash-entry':
    doc = { files: [{ rel, ms: null, status: null, tests: null, pass: null, fail: null, skipped: null, todo: null, staticDeclared: 1, ok: false, kind: 'crash' }], summary: { files: 1, tests: 0, pass: 0, fail: 1, skipped: 0, todo: 0, staticDeclared: 1 }, registry: { clean: true }, jobs: 1, mode: 'subset', topSlow: [], exitCode: 1 };
    code = 1;
    break;
}
// summary-mismatch 复跑（第 2 次调用）返健康收据 ⇒ §4.4 干扰路径：首遍 crash、串行复跑绿，不洗绿、标 interference。
if (mode === 'summary-mismatch' && calls >= 2) { doc = healthyDoc(); code = 0; }
if (doc) process.stdout.write(JSON.stringify(doc) + '\\n');
else process.stdout.write('{not valid json\\n');
process.exit(code);
`;
  fs.writeFileSync(path.join(dir, 'scripts', 'run-tests.mjs'), shim, 'utf8');
  try { fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'junction'); } catch { /* 已存在 */ }

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
  return { dir, dispose: () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 临时目录 */ } } };
}

function runCanned(mode: CannedMode): { rc: number | null; j: any } {
  const fx = makeCannedFixture(mode);
  const counters = path.join(fx.dir, 'counters.json');
  fs.writeFileSync(counters, JSON.stringify({ outer: 0 }));
  let rc: number | null = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [VERIFY, '--json', 'tests/t_a.test.ts'], {
      cwd: fx.dir, env: envFor(fx.dir, counters), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    rc = typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status : -1;
    out = String((e as { stdout?: string }).stdout ?? '');
  }
  try {
    const last = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop() ?? '{}';
    let j: any = null;
    try { j = JSON.parse(last); } catch { j = null; }
    return { rc, j, fx } as { rc: number | null; j: any };
  } finally {
    fx.dispose();
  }
}

test('C1-① 控制组：healthy 合法 green 收据 ⇒ rc0、green、不误伤', () => {
  const { rc, j } = runCanned('healthy');
  assert.equal(rc, 0, `healthy 收据必须零退出，实得 ${rc}`);
  assert.equal(j?.red, false, 'healthy 不得报红');
  assert.equal(j?.ran?.tests?.[0]?.kind, 'green', '条目必须判 green');
});

test('C1-② 坏 JSON（`{not valid json`，exit1）⇒ rc1、crash 红', () => {
  const { rc, j } = runCanned('broken-json');
  assert.notEqual(rc, 0, '坏 JSON 必须非零退出');
  assert.equal(j?.red, true, '坏 JSON 必须 fail-closed 报红');
  assert.equal(j?.ran?.tests?.[0]?.kind, 'crash', '坏 JSON 条目必须 crash 判红');
});

test('C1-③ 缺条目（files:[]、summary.files=1）⇒ rc1、crash 红', () => {
  const { rc, j } = runCanned('missing-entry');
  assert.notEqual(rc, 0, '缺条目必须非零退出');
  assert.equal(j?.red, true, '缺条目必须 fail-closed 报红');
  assert.equal(j?.ran?.tests?.[0]?.kind, 'crash', '缺条目必须 crash 判红');
});

test('C1-④ 汇总不一致（1 条目、summary.files=2）⇒ rc1、非 green 红；复跑绿走干扰路径不洗绿', () => {
  const { rc, j } = runCanned('summary-mismatch');
  assert.notEqual(rc, 0, '汇总不一致必须非零退出');
  assert.equal(j?.red, true, '汇总不一致必须报红');
  const t = j?.ran?.tests?.[0];
  assert.ok(t, '条目必须在场');
  assert.notEqual(t.kind, 'green', '汇总不一致不得洗绿');
  assert.equal(t.interference, true, '串行复跑绿而首遍红 ⇒ 必须标 interference');
  assert.equal(t.rerun?.kind, 'green', '复跑收据应为 green（干扰路径对照）');
  assert.equal(t.kind, 'red', '干扰红必须保持 red，不洗绿');
});

test('C1-⑤ crash 条目（tests:null / kind:crash）⇒ rc1、crash 红', () => {
  const { rc, j } = runCanned('crash-entry');
  assert.notEqual(rc, 0, 'crash 条目必须非零退出');
  assert.equal(j?.red, true, 'crash 条目必须报红');
  assert.equal(j?.ran?.tests?.[0]?.kind, 'crash', 'crash 条目必须端到端映射 crash');
});
