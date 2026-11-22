/**
 * T2 + T7 · runner `--json` 机器回执与 top-slow 榜单（Slice 1 · 企划 §4.2 / §4.5 / §7 T2、T7）。
 *
 * 覆盖：字段完整、四类 kind（green/red/crash/static-fail）、非 green 携 out、green 不携 out、
 *       JSON vs 文本同语料退出码一致、topSlow 由 ms 派生、无阈值判定、条数 ≤5。
 *
 * 夹具手法同 `p1_runner_explicit_list.test.ts`；夹具无 src/ ⇒ 护栏探针问不到，总退出码受护栏影响，
 * 本证以条目 kind / 回执字段 / JSON↔文本退出码一致性为判据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_TESTS = path.join(REPO, 'scripts', 'run-tests.mjs');

const plain = (s: string): string => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-json-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.copyFileSync(RUN_TESTS, path.join(root, 'scripts', 'run-tests.mjs'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'test_files.mjs'), path.join(root, 'scripts', 'lib', 'test_files.mjs'));
  return root;
}

function write(root: string, name: string, body: string): void {
  fs.writeFileSync(path.join(root, 'tests', name), body, 'utf8');
}

function run(root: string, args: string[]): { status: number | null; out: string; json: Record<string, any> | null } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.mjs'), ...args], {
    cwd: root, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024, env: base,
  });
  const so = plain(r.stdout ?? '');
  const se = plain(r.stderr ?? '');
  const out = `${so}${se}`;
  let json: Record<string, any> | null = null;
  // §4.2 契约：JSON 单一文档只在 stdout；人读文本走 stderr。回执只从 stdout 取。
  const last = so.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop() ?? '';
  if (last) { try { json = JSON.parse(last); } catch { json = null; } }
  return { status: r.status, out, json };
}

function rmRf(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 夹具不进 git */ }
}

const OK = `import { test } from 'node:test';\ntest('ok', () => {});\n`;
const RED = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('red', () => { assert.equal(1, 2); });\n`;
const EMPTY = '';
// 顶层导入缺失模块 / 强杀进程在本环境仍会被 node:test 包出 TAP 汇总（落 red）；
// crash（spawn 失败 / 无 TAP 汇总）由 classifyRecord 的 `status===null || tests===null` 分支静态锚定。
const CRASH_BRANCH = "r.status === null || r.tests === null ? 'crash'";

test('T2-① 回执字段完整：每选中文件一条目，含静态红不跑者', () => {
  const root = makeRoot('fields');
  try {
    write(root, 'ok.test.ts', OK);
    write(root, 'red.test.ts', RED);
    write(root, 'empty.test.ts', EMPTY);
    const r = run(root, ['--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x]));
    for (const rel of ['ok.test.ts', 'red.test.ts', 'empty.test.ts']) {
      const e = by.get(rel);
      assert.ok(e, `缺条目 ${rel}`);
      for (const k of ['rel', 'ms', 'status', 'tests', 'pass', 'fail', 'skipped', 'todo', 'staticDeclared', 'ok', 'kind']) {
        assert.ok(k in e, `条目 ${rel} 缺字段 ${k}`);
      }
    }
    const s = r.json!.summary;
    for (const k of ['files', 'tests', 'pass', 'fail', 'skipped', 'todo', 'staticDeclared']) {
      assert.ok(typeof s[k] === 'number', `summary 缺数字字段 ${k}`);
    }
    assert.ok('clean' in r.json!.registry, 'registry.clean 必须在场');
    assert.equal(typeof r.json!.jobs, 'number', 'jobs 必须在场');
    assert.ok(['subset', 'full'].includes(r.json!.mode), 'mode 必须是 subset/full');
    assert.equal(typeof r.json!.exitCode, 'number', 'exitCode 必须在场');
  } finally { rmRf(root); }
});

test('T2-② 四类 kind 可区分：green / red / static-fail 真跑可辨；crash 分支静态锚定', () => {
  const root = makeRoot('kinds');
  try {
    write(root, 'ok.test.ts', OK);
    write(root, 'red.test.ts', RED);
    write(root, 'empty.test.ts', EMPTY);
    const r = run(root, ['--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x]));
    assert.equal(by.get('ok.test.ts').kind, 'green', 'ok 文件必须 green');
    assert.equal(by.get('red.test.ts').kind, 'red', '断言失败必须 red');
    assert.equal(by.get('empty.test.ts').kind, 'static-fail', '0 字节必须 static-fail（不跑）');
    // crash 分支：进程起不来（status=null）或无 TAP 汇总（tests=null）⇒ crash，不折成 red
    const runnerSrc = fs.readFileSync(RUN_TESTS, 'utf8');
    assert.match(runnerSrc, new RegExp(CRASH_BRANCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'classifyRecord 必须保留 crash 分支（status/tests 缺失 ⇒ crash）');
  } finally { rmRf(root); }
});

test('T2-③ 非 green 携 out 归因尾巴；green 不携 out', () => {
  const root = makeRoot('out');
  try {
    write(root, 'ok.test.ts', OK);
    write(root, 'red.test.ts', RED);
    const r = run(root, ['--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x]));
    assert.ok(!('out' in by.get('ok.test.ts')) || by.get('ok.test.ts').out == null, 'green 不得携 out');
    assert.ok(typeof by.get('red.test.ts').out === 'string' && by.get('red.test.ts').out.length > 0, 'red 必须携 out 尾巴');
  } finally { rmRf(root); }
});

test('T2-④ JSON 与文本同语料退出码一致', () => {
  const root = makeRoot('agree');
  try {
    write(root, 'ok.test.ts', OK);
    write(root, 'red.test.ts', RED);
    const jj = run(root, ['--json']);
    const tt = run(root, []);
    assert.ok(jj.json, 'JSON 回执解析失败');
    assert.equal(jj.json!.exitCode, tt.status, 'JSON exitCode 必须与文本档退出码一致');
    assert.equal(jj.status, tt.status, '两档进程退出码必须一致');
  } finally { rmRf(root); }
});

test('T7-① topSlow 存在、由 ms 降序派生、≤5、无阈值判定', () => {
  const root = makeRoot('slow');
  try {
    const bodies = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) =>
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${n}', async () => { await new Promise((r) => setTimeout(r, ${n === 'a' ? 500 : 20})); assert.equal(1, 1); });\n`);
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((n, i) => write(root, `${n}.test.ts`, bodies[i]));
    const r = run(root, ['--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    const slow = r.json!.topSlow;
    assert.ok(Array.isArray(slow) && slow.length > 0 && slow.length <= 5, 'topSlow 必须 1..5 条');
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x.ms]));
    for (const s of slow) assert.equal(by.get(s.rel), s.ms, '榜单 ms 必须与条目 ms 一致（派生，不另判阈值）');
    const ms = slow.map((s: any) => s.ms);
    assert.deepEqual(ms, [...ms].sort((x, y) => y - x), '榜单必须按 ms 降序');
    assert.equal(slow[0].rel, 'a.test.ts', '最慢文件必须排第一');
  } finally { rmRf(root); }
});
