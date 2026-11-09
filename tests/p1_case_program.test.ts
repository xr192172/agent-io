/**
 * touches: src/application/design/intent/case_program.ts
 *
 * P1 · **契约形态扩展（cases）** 的机器回归 —— 2026-11-09
 *
 * 钉住四件事：
 *  ① 新形态四种能力都能跑：`steps`（同实例多步）/ `effects`（副作用真发生了）/ `throws`（该抛）/ `budget`（耗时上限）；
 *  ② 异步：`steps` 里返回 Promise 的方法会被 await；
 *  ③ **变异必须红**：删实现里的一步行为 / 撤掉写文件 / 改错抛错消息 ⇒ 各红一次（不然契约是摆设）；
 *  ④ `budget` 超时 ⇒ `fail` + `at='budget'`（**不是** unsupported、不是崩溃）。
 *
 * ★ 每次变异写到**不同文件名**：`import()` 有模块缓存，同名改内容读不到新实现（这坑真踩过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isCaseProgram, runCaseProgram, type CaseProgram } from '../src/application/design/intent/case_program.js';

/** 造一个真实带 I/O 的类：多步、写盘、抛错、异步 */
function queueSource(opts: { dropPush?: boolean; dropWrite?: boolean; throwMsg?: string } = {}): string {
  const push = opts.dropPush ? '' : '    this.items.push(id)\n';
  const write = opts.dropWrite
    ? ''
    : "    fs.writeFileSync(path.join(this.dir, 'queue.jsonl'), JSON.stringify(this.items))\n";
  const msg = opts.throwMsg ?? '缺 id';
  return `import fs from 'node:fs'
import path from 'node:path'

export class Q {
  items: string[] = []
  constructor(private dir: string) {}
  add(id: string): number {
    if (!id) throw new Error('${msg}')
${push}${write}    return this.items.length
  }
  async flush(ms: number): Promise<number> {
    await new Promise((r) => setTimeout(r, ms))
    return this.items.length
  }
  size(): number {
    return this.items.length
  }
}
`;
}

function mkProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'case-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [rel, code] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), code);
  return root;
}

const PASS_CASE: CaseProgram = {
  ctor: ['<DIR>'],
  steps: [
    { method: 'add', args: ['t1'], expect: 1 },
    { method: 'size', expect: 1 },
  ],
  effects: [{ writes: 'queue.jsonl', mustContain: 't1' }, { handles: 'items.length', equals: 1 }],
};

const withDir = (c: CaseProgram, dir: string): CaseProgram => ({
  ...c,
  ...(c.ctor ? { ctor: c.ctor.map((x) => (x === '<DIR>' ? dir : x)) } : {}),
});

test('P1-case-program · ①steps+effects 全跑通（同实例多步 + 写盘真发生 + 进程内状态）', async () => {
  const root = mkProject({ 'src/q_ok.ts': queueSource() });
  try {
    const r = await runCaseProgram({ projectRoot: root, file: 'src/q_ok.ts', symbol: 'Q', testCase: withDir(PASS_CASE, root) });
    assert.equal(r.status, 'pass', `期望 pass，实得 ${r.status}：${r.detail.join('；')}`);
    assert.ok(fs.existsSync(path.join(root, 'queue.jsonl')), '效果断言过了 ⇒ 文件应真实存在');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-case-program · ②async：steps 里的 Promise 会被 await', async () => {
  const root = mkProject({ 'src/q_ok.ts': queueSource() });
  try {
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/q_ok.ts',
      symbol: 'Q',
      testCase: { ctor: [root], steps: [{ method: 'add', args: ['t1'] }, { method: 'flush', args: [10], expect: 1 }], budget: { ms: 500 } },
    });
    assert.equal(r.status, 'pass', `异步步失败：${r.detail.join('；')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-case-program · ③throws：该抛要抛、消息要对（没抛 ⇒ fail）', async () => {
  const root = mkProject({ 'src/q_ok.ts': queueSource() });
  try {
    const ok = await runCaseProgram({
      projectRoot: root,
      file: 'src/q_ok.ts',
      symbol: 'Q',
      testCase: { ctor: [root], steps: [{ method: 'add', args: [''] }], throws: { messageContains: '缺 id' }, effects: [{ writes: 'queue.jsonl', absent: true }] },
    });
    assert.equal(ok.status, 'pass', `该抛却判 fail：${ok.detail.join('；')}`);

    // 变异：实现不再抛 ⇒ 契约必须红
    const root2 = mkProject({ 'src/q_nothrow.ts': queueSource().replace("if (!id) throw new Error('缺 id')", 'if (!id) return 0') });
    try {
      const bad = await runCaseProgram({
        projectRoot: root2,
        file: 'src/q_nothrow.ts',
        symbol: 'Q',
        testCase: { ctor: [root2], steps: [{ method: 'add', args: [''] }], throws: { messageContains: '缺 id' } },
      });
      assert.equal(bad.status, 'fail', '不抛错时 throws 契约必须红');
      assert.equal(bad.at, 'throws');
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-case-program · ④budget 超时 ⇒ fail（不是 unsupported、不是崩溃）', async () => {
  const root = mkProject({ 'src/q_ok.ts': queueSource() });
  try {
    const t0 = Date.now();
    const r = await runCaseProgram({
      projectRoot: root,
      file: 'src/q_ok.ts',
      symbol: 'Q',
      testCase: { ctor: [root], steps: [{ method: 'flush', args: [400] }], budget: { ms: 50 } },
    });
    assert.equal(r.status, 'fail', `超时必须是 fail（实得 ${r.status}）`);
    assert.equal(r.at, 'budget', `失败定位必须指到 budget（实得 ${r.at}）`);
    assert.ok(Date.now() - t0 < 3000, '超时要**真的**在预算附近返回，不能挂住');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-case-program · ⑤变异三连：删一步 / 撤 effect / 改错抛错消息 ⇒ 各红一次', async () => {
  // (a) 删掉 `push` 那一步行为 ⇒ size 步期望 1 实得 0
  const a = mkProject({ 'src/q_m1.ts': queueSource({ dropPush: true }) });
  try {
    const r = await runCaseProgram({ projectRoot: a, file: 'src/q_m1.ts', symbol: 'Q', testCase: withDir(PASS_CASE, a) });
    assert.equal(r.status, 'fail', '删掉一步行为 ⇒ 契约必须红');
    assert.match(String(r.at), /第 1 步|第 2 步/, `失败要定位到具体步（实得 ${r.at}）`);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
  }

  // (b) 撤掉写盘 ⇒ effects[0] 红
  const b = mkProject({ 'src/q_m2.ts': queueSource({ dropWrite: true }) });
  try {
    const r = await runCaseProgram({ projectRoot: b, file: 'src/q_m2.ts', symbol: 'Q', testCase: withDir(PASS_CASE, b) });
    assert.equal(r.status, 'fail', '副作用没发生 ⇒ 契约必须红');
    assert.equal(r.at, 'effects[0]', `失败要定位到 effects（实得 ${r.at}）`);
  } finally {
    fs.rmSync(b, { recursive: true, force: true });
  }

  // (c) 抛错消息改错 ⇒ throws 红
  const c = mkProject({ 'src/q_m3.ts': queueSource({ throwMsg: '缺标识' }) });
  try {
    const r = await runCaseProgram({
      projectRoot: c,
      file: 'src/q_m3.ts',
      symbol: 'Q',
      testCase: { ctor: [c], steps: [{ method: 'add', args: [''] }], throws: { messageContains: '缺 id' } },
    });
    assert.equal(r.status, 'fail', '抛错消息不符 ⇒ 契约必须红');
    assert.equal(r.at, 'throws');
  } finally {
    fs.rmSync(c, { recursive: true, force: true });
  }
});

test('P1-case-program · ⑥形态识别：旧形态不被误判成新形态（存量 815 条不受影响）', () => {
  assert.equal(isCaseProgram({ given: [1, 2], expect: '3' }), false, '旧形态必须走原路径');
  assert.equal(isCaseProgram({ given: ['x'], expect: 'throws:boom' }), false, 'throws: 前缀是旧口径，不属新形态');
  assert.equal(isCaseProgram({ ctor: [], steps: [] }), true);
  assert.equal(isCaseProgram({ given: [], expect: {}, budget: { ms: 10 } }), true);
});

test('P1-case-program · ⑦子串/存在类断言不许被**上次残留**满足（实测抓到的假绿）', async () => {
  // 先造一个"上次运行留下"的产物，内容里就含 t1
  const root = mkProject({ 'src/q_stale.ts': queueSource({ dropWrite: true }) });
  try {
    fs.writeFileSync(path.join(root, 'queue.jsonl'), '["t1"]');
    const r = await runCaseProgram({ projectRoot: root, file: 'src/q_stale.ts', symbol: 'Q', testCase: withDir(PASS_CASE, root) });
    assert.equal(r.status, 'fail', '残留文件不许把 effects 断言满足掉（否则撤掉写盘也绿）');
    assert.equal(r.at, 'effects[0]', `失败要定位到 effects（实得 ${r.at}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
