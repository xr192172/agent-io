/**
 * P0 · 行为基线 `file_hash` 同源比对（C14 · O5 接线）。
 *
 * ## 它钉的是什么
 * `runWithLangPack` 对目标文件算 sha256 前 12 位写进 `run.file_hash`，`captureBaseline`
 * 落基线；但 `diffRuns` 原先只逐 case 比 `ok/ret/error` + stdout，**从不比对 file_hash**
 * —— 基线快照对应的源码被换过（hash 漂移）会静默混在"行为一致"里。
 *
 * 本文件对纯函数 `diffRuns` 钉住：两侧 file_hash 非空且不等 ⇒ 一条 `(file_hash)` changed
 * 条目，verdict=diff，message 点名源码同源漂移；hash 一致 ⇒ 不产生该条目。
 *
 * 夹具在进程内内存态，不写真册 DB / 基线 JSON。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffRuns, type BehaviorRun } from '../src/infrastructure/authoring/behavior/index.js';

function run(over: Partial<BehaviorRun> = {}): BehaviorRun {
  return {
    file_abs: '/proj/src/x.ts',
    file_hash: 'aaa111aaa111',
    source: 'export function f(): number { return 1; }',
    stdout: '',
    results: [],
    ...over,
  };
}

test('hash 一致 + stdout 一致 + 无 case ⇒ verdict same，无 (file_hash) 条目', () => {
  const diff = diffRuns(run(), run());
  assert.equal(diff.verdict, 'same');
  assert.equal(diff.changed, 0);
  assert.equal(diff.details.some((d) => d.case === '(file_hash)'), false);
  assert.match(diff.message, /file_hash/);
});

test('file_hash 漂移（基线源码被换）⇒ verdict diff，(file_hash) 条目点名前后值', () => {
  const before = run({ file_hash: 'aaa111aaa111' });
  const after = run({ file_hash: 'bbb222bbb222' });
  const diff = diffRuns(before, after);
  assert.equal(diff.verdict, 'diff');
  assert.equal(diff.changed, 1);
  const entry = diff.details.find((d) => d.case === '(file_hash)');
  assert.ok(entry, '必须出现 (file_hash) 比对条目');
  assert.equal(entry.status, 'changed');
  assert.equal(entry.before, 'aaa111aaa111');
  assert.equal(entry.after, 'bbb222bbb222');
  assert.match(diff.message, /file_hash/);
  assert.match(diff.message, /源码同源漂移/);
});

test('stdout 漂移仍归 diff；file_hash 一致不产生额外条目', () => {
  const before = run({ stdout: 'v1' });
  const after = run({ stdout: 'v2' });
  const diff = diffRuns(before, after);
  assert.equal(diff.verdict, 'diff');
  assert.equal(diff.details.some((d) => d.case === '(stdout)'), true);
  assert.equal(diff.details.some((d) => d.case === '(file_hash)'), false);
});

test('进程级 error 早退：不进 hash 比对，verdict=error', () => {
  const before = run();
  const after = run({ error: '解释器不可用', file_hash: 'bbb222bbb222' });
  const diff = diffRuns(before, after);
  assert.equal(diff.verdict, 'error');
  assert.equal(diff.details.length, 0);
  assert.match(diff.message, /进程级失败/);
});

test('H-a 同源守卫：跨目标文件（Go 原函数 vs TS 翻译，file_abs 不同）hash 不等 ⇒ 不产生 (file_hash) 条目', () => {
  // 跨实现对拍：落不同临时文件（calc.go / calc.ts），两侧本就不是同一源码，file_hash 恒不等；
  // 纳入比对会把正常的跨语言对拍误报成源码漂移 ⇒ 跨 file_abs 不比同源指纹。
  const before = run({ file_abs: '/proj/src/calc.go', file_hash: 'aaa111aaa111' });
  const after = run({ file_abs: '/proj/src/calc.ts', file_hash: 'bbb222bbb222' });
  const diff = diffRuns(before, after);
  assert.equal(diff.details.some((d) => d.case === '(file_hash)'), false, '跨 file_abs 不得比对 file_hash');
});
