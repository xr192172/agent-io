/**
 * P0 · tsc-fix 的两条不变量。
 *
 * ## 病（实测，不是推测）
 * `applyTscDrivenFixes(outDir)` 向上找 `tsconfig.json`，然后**用它的 `include`** 跑 tsc。
 * 产物 tsconfig 的 `include` 是 `src/**`（= **上一版产物**），而改写打在本次目录上 ⇒
 * 同一份输入连跑两次，产物随"上一版内容"变（实测 435 ↔ 367 交替）。
 * 另一头：找不到 tsconfig 直接 `return null`，零诊断 ⇒ 后处理没跑也没人知道。
 *
 * ## 本证锁两条（都要能判真假）
 * 1. **喂给 tsc 的是被改写的那个目录自己**：
 *    `result.tsconfig` 必须落在该目录内；且两次运行（"上一版"内容不同）产物**逐字节相同**、
 *    前后 errors **逐数字相同**。同时断言 `changed ≥ 1` —— 否则"两次都是 no-op"会假绿。
 * 2. **前置缺失不许静默**：缺 tsconfig ⇒ `ran=false` + `notes` 里一条 `[tsc-fix] skipped:`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyTscDrivenFixes } from '../src/infrastructure/authoring/translate/tsc_fix.js';

/** 被改写的模块：`b.Bar()` ⇒ tsc 报 TS2339(type=Foo)，同目录有自由函数 `Foo_Bar` ⇒ 可改写 */
const MODULE_TS = [
  'class Foo {',
  '  v = 1;',
  '}',
  '',
  'export function Foo_Bar(x: Foo): number {',
  '  return x.v;',
  '}',
  '',
  'export function demo(): number {',
  '  const b = new Foo();',
  '  return b.Bar();',
  '}',
  '',
].join('\n');

/** "上一版产物"：与本次输入无关的陈旧内容 —— 旧实现会拿它的诊断去打本次目录 */
const STALE_WITH_DIAG = MODULE_TS;
const STALE_WITHOUT_DIAG = ['class Foo {', '  v = 1;', '}', ''].join('\n');

const BASE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ES2022',
    moduleResolution: 'bundler',
    strict: false,
    skipLibCheck: true,
    noImplicitAny: false,
  },
  // ★ 这一行就是病根：陈旧实现的 tsc 输入是**上一版产物**
  include: ['src/**/*.ts'],
});

function writeModule(dir: string, src: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mod.ts'), src, 'utf8');
}

test('P0 · tsc-fix 的输入是本目录自己：连跑两次产物逐字节相同、errors 逐数字相同', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-tscfix-det-'));
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), BASE_TSCONFIG, 'utf8');
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    writeModule(a, MODULE_TS);
    writeModule(b, MODULE_TS);

    // 第 1 次：上一版产物**有**这条诊断；第 2 次：上一版产物**没有**
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'mod.ts'), STALE_WITH_DIAG, 'utf8');
    const notesA: string[] = [];
    const rA = applyTscDrivenFixes(a, notesA);

    fs.writeFileSync(path.join(root, 'src', 'mod.ts'), STALE_WITHOUT_DIAG, 'utf8');
    const notesB: string[] = [];
    const rB = applyTscDrivenFixes(b, notesB);

    // ① 输入必须是"被改写的那个目录"（而不是上层的 src/**）
    assert.equal(rA.ran, true, `第 1 次必须真跑（notes=${JSON.stringify(notesA)}）`);
    assert.equal(rB.ran, true, `第 2 次必须真跑（notes=${JSON.stringify(notesB)}）`);
    assert.ok(
      path.resolve(rA.tsconfig).startsWith(path.resolve(a) + path.sep),
      `tsc 的 tsconfig 必须落在被改写目录内，实际 ${rA.tsconfig}`,
    );

    // ② 真的改了东西（否则"两次都 no-op"也是逐字节相同 ⇒ 假绿）
    assert.ok(rA.changed >= 1, `第 1 次必须真改写，实际 changed=${rA.changed}`);
    assert.ok(rB.changed >= 1, `第 2 次必须真改写，实际 changed=${rB.changed}`);

    // ③ 同一份输入 ⇒ 同一份读数 + 同一份产物
    assert.equal(rA.before, rB.before, `before 必须相同（实际 ${rA.before} vs ${rB.before}）`);
    assert.equal(rA.after, rB.after, `after 必须相同（实际 ${rA.after} vs ${rB.after}）`);
    const outA = fs.readFileSync(path.join(a, 'mod.ts'), 'utf8');
    const outB = fs.readFileSync(path.join(b, 'mod.ts'), 'utf8');
    assert.equal(outA, outB, '同一份输入连跑两次，产物必须逐字节相同');
    assert.ok(outA.includes('Foo_Bar(b)'), `产物里应出现改写结果，实际：\n${outA}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P0 · 缺 tsconfig ⇒ 显式 skipped 诊断（不是静默 null）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-tscfix-notsconfig-'));
  // 再下潜 4 层：向上 4 层全在本目录树内，保证沿途真的没有 tsconfig.json
  const dir = path.join(base, 'a', 'b', 'c', 'd');
  try {
    writeModule(dir, MODULE_TS);
    const notes: string[] = [];
    const r = applyTscDrivenFixes(dir, notes);

    assert.equal(r.ran, false, '缺 tsconfig 时不得声称跑过');
    assert.match(r.skipReason, /tsconfig/, `skipReason 要说明缺什么，实际 "${r.skipReason}"`);
    const line = notes.find((n) => n.startsWith('[tsc-fix] skipped:'));
    assert.ok(line, `必须往 diagnostics 写一条显式跳过记录，实际 notes=${JSON.stringify(notes)}`);
    assert.match(line!, /tsconfig/, '跳过记录要指名缺的东西');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
