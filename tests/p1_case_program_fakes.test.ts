/**
 * touches: src/application/design/intent/case_program.ts · src/application/design/intent/case_program_fakes.ts
 *
 * P1 · **fakes 注入缝** 的机器回归 —— 2026-11-10
 *
 * 钉住五件事（变异验收三条由 ③④⑤ 承担）：
 *  ① node: 内置整模块替换：目标 import node:fs，契约给假 readFileSync ⇒ 契约能看到假值；
 *  ② `.ts` 目标 + 相对 import 闭包：经 transpileToFakesEsm + 镜像拷贝后能跑（v1 依赖面承诺）;
 *  ③ 替身假实现改坏 ⇒ 契约红（fail，不是 unsupported）—— fakes 新能力的"牙"；
 *  ④ 未声明 fakes + 不可解析 import ⇒ unsupported 不回归（现有语义不变）;
 *  ⑤ 契约没动到的替身模块不受影响：只声明一个模块，别的 import 照常解析。
 *
 * ★ 每次变异写到不同文件：`import()` 有模块缓存，同名改内容读不到新实现（这坑真踩过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isCaseProgram, runCaseProgram, type CaseProgram } from '../src/application/design/intent/case_program.js';
import { validateFakes } from '../src/application/design/intent/case_program_fakes.js';

/** 依赖 node:fs 的 .ts 目标：把读到的内容写进 effects 要看的位置（可断言"拿到的是替身值"） */
function fsTargetSource(opts: { broken?: boolean } = {}): string {
  const ret = opts.broken ? "return 'MUTATED'" : "return first";
  return `import fs from 'node:fs'
export function readFirstLine(p: string): string {
  const all: string = fs.readFileSync(p, 'utf-8')
  const first = all.split('\\n')[0]
  ${ret}
}
`;
}

function mkProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fakes-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [rel, code] of Object.entries(files)) {
    fs.mkdirSync(path.join(path.dirname(path.join(root, rel)), '/'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), code);
  }
  return root;
}

const FAKE_READ: CaseProgram = {
  steps: [{ args: ['<P>'], expect: 'FAKE-CONTENT' }],
  fakes: [{ module: 'node:fs', exports: { readFileSync: '() => "FAKE-CONTENT\\nsecond"' } }],
};
const withPath = (c: CaseProgram, p: string): CaseProgram => ({
  ...c,
  steps: (c.steps ?? []).map((s) => ({ ...s, args: (s.args ?? []).map((a) => (a === '<P>' ? p : a)) })),
});

test('P1-fakes · ①node: 内置整模块替换：目标拿到的是替身值（.ts 目标 + 相对闭包可跑）', async () => {
  const root = mkProject({ 'src/reader.ts': fsTargetSource() });
  try {
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader.ts',
      symbol: 'readFirstLine',
      testCase: withPath(FAKE_READ, path.join(root, 'any.txt')),
    });
    assert.equal(r.status, 'pass', `期望 pass，实得 ${r.status}：${r.detail.join('；')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-fakes · ②变异：替身假实现改坏 ⇒ 契约红（fail，定位到具体步）', async () => {
  const root = mkProject({ 'src/reader_m.ts': fsTargetSource({ broken: true }) });
  try {
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader_m.ts',
      symbol: 'readFirstLine',
      testCase: withPath(FAKE_READ, path.join(root, 'any.txt')),
    });
    assert.equal(r.status, 'fail', `替身值变了 ⇒ 契约必须红（实得 ${r.status}）`);
    assert.match(String(r.at), /第 1 步/, `失败要定位到具体步（实得 ${r.at}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-fakes · ③未声明 fakes：node:fs 照常 pass；真三方包 ⇒ unsupported 不回归', async () => {
  const root = mkProject({ 'src/reader_n.ts': fsTargetSource() });
  try {
    // 先造真实文件：node:fs 由 node 自己解析 ⇒ 读真值应 pass（现有语义不变）
    fs.writeFileSync(path.join(root, 'real.txt'), 'REAL-LINE\n');
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader_n.ts',
      symbol: 'readFirstLine',
      testCase: { steps: [{ args: [path.join(root, 'real.txt')], expect: 'REAL-LINE' }] },
    });
    assert.equal(r.status, 'pass', `node:fs 由 node 解析 ⇒ 不该 unsupported（实得 ${r.status}：${r.detail.join('；')}）`);
    // 真正的不回归点：真三方包（本仓没装的包名）⇒ 必须 unsupported 而不是 fail
    fs.writeFileSync(
      path.join(root, 'src/reader_bare.ts'),
      "import { something } from 'pkg-that-does-not-exist-xyz'\nexport function use(): string { return String(something) }\n",
    );
    const bare = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader_bare.ts',
      symbol: 'use',
      testCase: { steps: [{ expect: 'x' }] },
    });
    assert.equal(bare.status, 'unsupported', `未声明 fakes 的不可解析包 ⇒ 判不了（实得 ${bare.status}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-fakes · ④相对 import 闭包：目标 import ./helper，helper 用替身的 node:fs', async () => {
  const root = mkProject({
    'src/helper.ts': "import fs from 'node:fs'\nexport function grab(p: string): string { return fs.readFileSync(p, 'utf-8') }\n",
    'src/main.ts': "import { grab } from './helper.js'\nexport function useGrab(p: string): string { return grab(p) }\n",
  });
  try {
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/main.ts',
      symbol: 'useGrab',
      testCase: withPath(
        {
          steps: [{ expect: 'CLOSURE-FAKE' }],
          fakes: [{ module: 'node:fs', exports: { readFileSync: '() => "CLOSURE-FAKE"' } }],
        },
        path.join(root, 'x.txt'),
      ),
    });
    assert.equal(r.status, 'pass', `闭包成员也应拿到替身（实得 ${r.status}：${r.detail.join('；')}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-fakes · ⑤形状闸：exports/file 二选一、空 exports、缺 module ⇒ unsupported（判不了，不冒充错）', () => {
  assert.equal(isCaseProgram({ fakes: [] }), true, 'fakes 字段出现 ⇒ 新形态');
  assert.equal(isCaseProgram({ given: [1], expect: '1' }), false, '旧形态不走 fakes 路径');
  assert.match(String(validateFakes([{ module: 'x' }])), /二选一/);
  assert.match(String(validateFakes([{ module: 'x', exports: {} }])), /空对象/);
  assert.match(String(validateFakes([{ exports: { a: '1' } }])), /module/);
  assert.equal(validateFakes([{ module: 'node:fs', exports: { readFileSync: '() => 1' } }]), null);
});

test('P1-fakes · ⑥file 型替身：指向本地模块文件（显式声明，不自动生成）', async () => {
  const root = mkProject({ 'src/reader2.ts': fsTargetSource() });
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakes-file-'));
  try {
    fs.writeFileSync(path.join(fakeDir, 'my_fs.mjs'), 'const readFileSync = () => "FILE-FAKE";\nexport default { readFileSync };\nexport { readFileSync };\n');
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader2.ts',
      symbol: 'readFirstLine',
      testCase: withPath(
        {
          steps: [{ expect: 'FILE-FAKE' }],
          fakes: [{ module: 'node:fs', file: path.join(fakeDir, 'my_fs.mjs') }],
        },
        path.join(root, 'any.txt'),
      ),
    });
    assert.equal(r.status, 'pass', `file 型替身应生效（实得 ${r.status}：${r.detail.join('；')}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }
});

test('P1-fakes · ⑦旧形态（只有 given/expect）带 fakes ⇒ unsupported（防"零断言假绿"）', async () => {
  const root = mkProject({ 'src/reader_old.ts': fsTargetSource() });
  try {
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/reader_old.ts',
      symbol: 'readFirstLine',
      testCase: { given: ['x'], expect: 'y', fakes: [{ module: 'node:fs', exports: { readFileSync: '() => "FAKE"' } }] } as unknown as CaseProgram,
    });
    assert.equal(r.status, 'unsupported', `旧形态带 fakes 必须拒（实得 ${r.status}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
