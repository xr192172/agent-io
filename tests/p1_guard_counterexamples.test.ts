/**
 * T8 · 反例集（Slice 1 · 企划 §7 T8）。
 *
 * 真跑夹具：空文件、全注释、skip、todo、0 用例执行 ⇒ 各就各位判红点名；
 * 静态：JSON 缺条目/坏 JSON 消费方 fail-closed 判红；filter+changed+清单三交集联用；
 *       污染注入串行点名 / 并行降级 + 复跑点名。
 *
 * 夹具手法同 `p1_runner_json_receipt.test.ts`；无 src/ ⇒ 护栏探针问不到，总退出码受护栏影响，
 * 本证以条目 kind / 红行点名为判据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_TESTS = path.join(REPO, 'scripts', 'run-tests.mjs');
const VERIFY = path.join(REPO, 'scripts', 'verify-changed.mjs');

const plain = (s: string): string => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-guard-${tag}-${process.pid}-${Date.now()}`);
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
  const so = plain(`${r.stdout ?? ''}`);
  const se = plain(`${r.stderr ?? ''}`);
  const out = `${so}${se}`;
  let json: Record<string, any> | null = null;
  // §4.2 契约：JSON 单一文档只在 stdout；人读文本走 stderr。回执只从 stdout 取。
  const last = so.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop() ?? '';
  if (last) { try { json = JSON.parse(last); } catch { json = null; } }
  return { status: r.status, out, json };
}
function rmRf(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 }); } catch { /* 夹具 */ }
}

test('T8-① 空文件 / 全注释 ⇒ static-fail 红点名，不跑', () => {
  const root = makeRoot('empty');
  try {
    write(root, 'empty.test.ts', '');
    write(root, 'commented.test.ts', '// 全是注释\n// 第二行注释\n');
    const r = run(root, ['--json']);
    assert.ok(r.json);
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x]));
    assert.equal(by.get('empty.test.ts').kind, 'static-fail');
    assert.equal(by.get('commented.test.ts').kind, 'static-fail');
    assert.match(r.out, /empty\.test\.ts/, '空文件必须点名');
    assert.match(r.out, /commented\.test\.ts/, '全注释必须点名');
  } finally { rmRf(root); }
});

test('T8-② skip / todo 用例 ⇒ 红（本仓不许用它关门）', () => {
  const root = makeRoot('skip');
  try {
    write(root, 'skip.test.ts', `import { test } from 'node:test';\ntest('skipped', { skip: true }, () => {});\n`);
    write(root, 'todo.test.ts', `import { test } from 'node:test';\ntest('todo me', { todo: true }, () => {});\n`);
    const r = run(root, ['--json']);
    assert.ok(r.json);
    const by = new Map(r.json!.files.map((x: any) => [x.rel, x]));
    assert.equal(by.get('skip.test.ts').kind, 'red', 'skip>0 必须红');
    assert.equal(by.get('todo.test.ts').kind, 'red', 'todo>0 必须红');
  } finally { rmRf(root); }
});

test('T8-③ 静态（补充守卫）：JSON 缺条目 / 坏 JSON / 汇总不一致 ⇒ 消费方 crash fail-closed（不留 nosummary 洞）', () => {
  // ★ 行为级主守卫见 p1_verify_batch_run.test.ts 的 C1-①~⑤（canned-receipt shim 五变体 E2E）；
  //   本静态断言只兜底"分支标识符/字面量未被整体删去"，标识符存在 ≠ 行为正确。
  const src = fs.readFileSync(VERIFY, 'utf8');
  assert.match(src, /batchParseFail/, 'JSON 解析失败必须标 fail-closed');
  assert.match(src, /summaryMismatch/, '汇总不一致必须判不了');
  assert.match(src, /missingEntry/, '缺条目必须显形');
  assert.match(src, /kind: 'crash'/, 'fail-closed 条目必须 crash 判红');
});

test('T8-④ 静态：filter + changed + 显式清单三交集联用（收窄方向一致，保守）', () => {
  const runner = fs.readFileSync(RUN_TESTS, 'utf8');
  assert.match(runner, /files = explicitList\.filter\(\(f\) => filesAll\.includes\(f\)\)/, '清单先与 filter 候选取交集');
  assert.match(runner, /files = files\.filter\(\(f\) => selSet\.has\(f\)\)/, 'changed 再在当前 files 上取交集');
});

test('T8-⑤ 静态：污染注入 ⇒ 串行逐文件点名；并行诚实降级；污染红全集串行复跑点名', () => {
  const runner = fs.readFileSync(RUN_TESTS, 'utf8');
  const src = fs.readFileSync(VERIFY, 'utf8');
  // 串行：逐步比对点名 polluters
  assert.match(runner, /registryPolluters\.push/, '串行档必须逐文件点名污染者');
  // 并行：判不了是谁，要求 jobs=1 复跑
  assert.match(runner, /无法点名污染者|判不了是谁/, '并行档必须诚实降级自白');
  // verify 侧：污染红全集串行复跑
  assert.match(src, /pollution-full/, '污染红必须全集串行复跑');
  assert.match(src, /polluted/, '污染判定必须接 runner registry.clean');
});
