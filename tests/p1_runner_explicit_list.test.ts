/**
 * T1 · runner 显式文件清单（Slice 1 · 企划 §4.1 / §7 T1）。
 *
 * 覆盖：精确选中、原序、不存在文件响亮红零跑、重复去重保首现序、清单 ∩ filter、空交集红、子集不判棘轮。
 *
 * 夹具手法抄 `p1_test_runner_jobs.test.ts`：夹具根落仓内 `.agent-io/`（tsx 要逐级上溯 node_modules），
 * 真脚本原样拷进 `scripts/`（import.meta.url 定 ROOT ⇒ 扫的是夹具 tests/，仓里一个字节不碰）。
 * ★ 夹具根没有 src/ ⇒ 真册探针问不到 ⇒ 产者护栏自报判不了、退出码非 0；本证不拿总退出码当判据，
 *   只判选中集 / 条目形状 / 文本清单行。
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
  const root = path.join(REPO, '.agent-io', `gate-fixture-list-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.copyFileSync(RUN_TESTS, path.join(root, 'scripts', 'run-tests.mjs'));
  fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'test_files.mjs'), path.join(root, 'scripts', 'lib', 'test_files.mjs'));
  return root;
}

function writeTest(root: string, name: string, body?: string): void {
  const text = body ?? `import { test } from 'node:test';\ntest('${name}', () => {});\n`;
  fs.writeFileSync(path.join(root, 'tests', name), text, 'utf8');
}

function runRunner(root: string, extraArgs: string[] = []): { status: number | null; out: string; json: Record<string, any> | null } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.mjs'), ...extraArgs], {
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

test('T1-① 显式清单精确选中并保首现序（逆序传入 ⇒ 回执顺序 = 传入顺序）', () => {
  const root = makeRoot('order');
  try {
    writeTest(root, 'a.test.ts');
    writeTest(root, 'b.test.ts');
    writeTest(root, 'c.test.ts');
    const r = runRunner(root, ['c.test.ts', 'a.test.ts', 'b.test.ts', '--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    assert.deepEqual(r.json!.files.map((x: any) => x.rel), ['c.test.ts', 'a.test.ts', 'b.test.ts'], '回执必须保传入首现序');
    assert.equal(r.json!.summary.files, 3, '选中集必须是清单 3 个');
    assert.equal(r.json!.mode, 'subset', '显式清单是子集档，不判规模棘轮');
  } finally { rmRf(root); }
});

test('T1-② 重复项去重保首现序', () => {
  const root = makeRoot('dedup');
  try {
    writeTest(root, 'a.test.ts');
    writeTest(root, 'b.test.ts');
    const r = runRunner(root, ['a.test.ts', 'a.test.ts', 'b.test.ts', '--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    assert.deepEqual(r.json!.files.map((x: any) => x.rel), ['a.test.ts', 'b.test.ts'], '重复必须去重，保首现序');
    assert.match(r.out, /去重/, '文本必须显形去重');
  } finally { rmRf(root); }
});

test('T1-③ 不存在的文件 ⇒ 响亮判红、零文件跑（fail-closed）', () => {
  const root = makeRoot('missing');
  try {
    writeTest(root, 'a.test.ts');
    const r = runRunner(root, ['nope_missing.test.ts', '--json']);
    assert.equal(r.status, 1, 'fail-closed 必须非零退出');
    assert.ok(r.json, '失败路径也必须给 JSON 回执');
    assert.equal(r.json!.files.length, 0, '零文件跑');
    assert.equal(r.json!.summary.files, 0, '汇总文件数必须 0');
    assert.match(r.out, /不存在\/非测试文件/, '必须响亮点名缺失项');
  } finally { rmRf(root); }
});

test('T1-④ 清单 ∩ filter：只收两者交集', () => {
  const root = makeRoot('inter');
  try {
    writeTest(root, 'aaa.test.ts');
    writeTest(root, 'bbb.test.ts');
    const r = runRunner(root, ['aaa.test.ts', 'bbb.test.ts', '--filter', 'bbb', '--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    assert.deepEqual(r.json!.files.map((x: any) => x.rel), ['bbb.test.ts'], '清单与 filter 必须取交集');
  } finally { rmRf(root); }
});

test('T1-⑤ 清单与 filter 空交集 ⇒ 红（0 文件）', () => {
  const root = makeRoot('empty');
  try {
    writeTest(root, 'aaa.test.ts');
    const r = runRunner(root, ['aaa.test.ts', '--filter', 'zzz-no-match', '--json']);
    assert.equal(r.status, 1, '空交集必须红');
    assert.equal(r.json!.files.length, 0, '空交集零文件');
  } finally { rmRf(root); }
});

test('T1-⑥ 子集档不判规模棘轮：JSON mode=subset，文本打"清单跑绿/不判规模"', () => {
  const root = makeRoot('subset');
  try {
    writeTest(root, 'a.test.ts');
    const jr = runRunner(root, ['a.test.ts', '--json']);
    assert.equal(jr.json!.mode, 'subset', '显式清单必须标 subset');
    const tr = runRunner(root, ['a.test.ts']);
    assert.match(tr.out, /子集跑|定向跑|增量跑/, '文本必须标明子集档');
    assert.match(tr.out, /规模棘轮本轮不判|不判规模/, '子集必须显形"不判规模"');
  } finally { rmRf(root); }
});

test('T1-⑦ 清单接受 tests/ 前缀路径（与裸文件名等价解析）', () => {
  const root = makeRoot('prefix');
  try {
    writeTest(root, 'a.test.ts');
    const r = runRunner(root, ['tests/a.test.ts', '--json']);
    assert.ok(r.json, 'JSON 回执解析失败');
    assert.deepEqual(r.json!.files.map((x: any) => x.rel), ['a.test.ts'], '带 tests/ 前缀必须精确匹配到裸文件名');
  } finally { rmRf(root); }
});
