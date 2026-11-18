/**
 * 市场吸收 P1 —— **未消项闸接线**（`ledger_review_queue` 的零消费点补牙）。
 *
 * ## 治的病（硬证据）
 * `ledger.ts#listReviewQueue` 在全仓 `src/` 里**零消费点**（2026-11-17 审计 grep 实测）⇒
 * 「未消项」只是事后清理面，`complete` 不把它当前置条件 ⇒ done 照样盖得下去。
 *
 * ## 判据（每条都能打断即红）
 *  1. **有相交未消项 ⇒ complete 拒**，报文点名 `#id / reason / 锚点` 且给出 `resolveReview` 修法；
 *     摘掉接线（消融）⇒ 这条**必红**（沙箱实测：src-ablate 下同一夹具 PASS）。
 *  2. **resolve 后 ⇒ 过**（同一个夹具，只多一次 `resolveReview`）。
 *  3. **无关卡不受影响**：全局有未消项、但与本卡相交 0 ⇒ 过，且回执**说出全局条数**（不是静默）。
 *  4. **判不了 ≠ 通过**：队列库打不开（损坏）⇒ **拒**，报文含「判不了（≠ 通过）」。
 *  5. **「没有」要能证**：库/表不在场 ⇒ 过，且回执写明"0 条可证"（与「查过以后没有」分开说）。
 *  6. **纯核五态 + 相交口径 + 折叠点名**（`domain/review_gate.ts#evaluateReviewGate` 单测，不开库）。
 *  7. **接线位置**：`completeTask` 里调了 `evaluateReviewGate`，且**在 `writeTask` 之前**
 *     （否则拒的时候状态已经写成 done —— D-complete-nonatomic 同族）。
 *
 * 夹具仿 `tests/p1_ledger_engine.test.ts:33-55`（makeTempHome + AGENT_IO_HOME + rmRf）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerFeature } from '../src/infrastructure/project_registry.js';
import { getDesignSheetFile } from '../src/infrastructure/storage.js';
import { getTasksDbFile } from '../src/infrastructure/task_history.js';
import { queueReview, resolveReview, readReviewQueue, listReviewQueue } from '../src/application/ledger/ledger.js';
import { evaluateReviewGate, REVIEW_GATE_MAX_LISTED, REVIEW_GATE_REFUSAL_HEAD, type ReviewGateItemFact } from '../src/domain/review_gate.js';
import { completeTask } from '../src/application/design/dsl_ops/task_ops.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const FEATURE = `__p1rv_${process.pid}`;

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
  prevDataRoot: string | undefined;
}

/**
 * 临时数据仓 + 临时项目根 + 一份**够走到未消项闸**的设计册。
 *
 * 册形状（每样都必要）：
 * · `todos[]` 两张卡（`isTodo` ⇒ 不走 L1/L2 判据、跳过 `updateStatus` 投影）；
 * · 每张卡带 `read_set.files` —— 这就是"本卡这一轮要碰什么"（闸的 subject 来源之一）；
 * · `source_root` = 项目根 —— 队列库（`<root>/.agent-io/tasks.db`）按它定位。
 */
function setup(opts?: { sourceRoot?: string | null }): Fixture {
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p1rv-proj-'));
  delete process.env.AGENT_IO_DATA_ROOT; // ★ 必须删：DATA_ROOT 优先级高于 HOME，会抢走夹具
  process.env.AGENT_IO_HOME = home;
  registerFeature(FEATURE, project, 'p1_review_gate.test');
  const rs = (files: string[]) => ({
    symbols: [],
    files: files.map((p) => ({ path: p, content_hash: 'deadbeef' })),
    computed_at: '2026-11-18T00:00:00.000Z',
    basis: ['declared'],
  });
  const dsl: Record<string, unknown> = {
    id: FEATURE,
    type: 'design',
    feature: FEATURE,
    version: 1,
    title: 'p1 review gate fixture',
    geometry: { nodes: [] },
    semantic: { files: [] },
    todos: [
      { id: 'todo_a', summary: '卡 A（read_set = src/a.ts）', state: 'claimed', owner: 'agent:sbx', claimed_at: '2026-11-18T00:00:00.000Z', read_set: rs(['src/a.ts']) },
      { id: 'todo_b', summary: '卡 B（read_set = src/b.ts）', state: 'claimed', owner: 'agent:sbx', claimed_at: '2026-11-18T00:00:00.000Z', read_set: rs(['src/b.ts']) },
    ],
  };
  if (opts?.sourceRoot === null) delete dsl.source_root;
  else dsl.source_root = opts?.sourceRoot ?? project;
  const file = getDesignSheetFile(FEATURE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(dsl, null, 2));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  for (const f of ['a.ts', 'b.ts', 'zzz.ts']) fs.writeFileSync(path.join(project, 'src', f), 'export const X = 1;\n');
  return { home, project, prevHome, prevDataRoot };
}

function teardown(fx: Fixture): void {
  if (fx.prevHome === undefined) delete process.env.AGENT_IO_HOME; else process.env.AGENT_IO_HOME = fx.prevHome;
  if (fx.prevDataRoot === undefined) delete process.env.AGENT_IO_DATA_ROOT; else process.env.AGENT_IO_DATA_ROOT = fx.prevDataRoot;
  rmRf(fx.home);
  rmRf(fx.project);
}

async function inSandbox(fn: (fx: Fixture) => Promise<void>, opts?: { sourceRoot?: string | null }): Promise<void> {
  const fx = setup(opts);
  try {
    await fn(fx);
  } finally {
    teardown(fx);
  }
}

/** 一条"够走到未消项闸"的收口调用（todo 卡：无判据、只凭 attestation） */
function complete(fx: Fixture, nodeId: string) {
  return completeTask({
    feature: FEATURE,
    node_id: nodeId,
    agent: 'agent:sbx',
    evidence: { kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: 'p1 review gate test' },
  });
}

async function refusalOf(fx: Fixture, nodeId: string): Promise<string> {
  try {
    await complete(fx, nodeId);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail(`期望 complete 被拒，但它通过了（★ 接线被摘掉时就会这样）`);
}

// ── ① 有相交未消项 ⇒ 拒 + 点名（摘掉接线 ⇒ 本用例红）────────────────
test('① 有相交未消项 ⇒ complete 拒，并逐条点名 + 给 resolveReview 修法', () =>
  inSandbox(async (fx) => {
    const byRef = queueReview(fx.project, { refId: 'todo_a', reason: 'subject-conflict', detail: '甲：ref 命中本卡' });
    const bySub = queueReview(fx.project, { subject: { path: 'src/a.ts' }, reason: 'half-escaped', detail: '乙：subject 命中本卡 read_set' });
    const msg = await refusalOf(fx, 'todo_a');
    assert.ok(msg.startsWith(REVIEW_GATE_REFUSAL_HEAD), `首句必须是固定前缀（机器可反查）；实得：${msg.slice(0, 80)}`);
    assert.match(msg, new RegExp(`#${byRef} \\[subject-conflict\\] ref=todo_a`), '必须点名 ref 命中的那条（id + reason + 锚点）');
    assert.match(msg, new RegExp(`#${bySub} \\[half-escaped\\] src/a.ts`), '必须点名 subject 命中的那条');
    assert.match(msg, /甲：ref 命中本卡/, '必须带 detail 摘要（人读才知道要裁什么）');
    assert.match(msg, /相交 2 条 \/ 全局未消项 2 条/, '必须说出相交/全局两个数');
    assert.match(msg, /resolveReview/, '必须给出唯一写入口');
    assert.match(msg, /没有批量口/, '必须说明逐条消（否则会被批量 resolve 掉）');
    // ★ 拒的时候**状态没动**（不许"报错但已 done"）
    const after = JSON.parse(fs.readFileSync(getDesignSheetFile(FEATURE), 'utf8')) as { todos: Array<{ id: string; state: string }> };
    assert.equal(after.todos.find((t) => t.id === 'todo_a')!.state, 'claimed', '被拒时卡必须仍是 claimed');
    assert.equal(readReviewQueue(fx.project).items.length, 2, '队列不许被闸悄悄改（闸只读）');
  }));

// ── ② resolve 后 ⇒ 过 ────────────────────────────────────────────
test('② resolve 后 ⇒ 同一个夹具放行，且回执说出"相交 0 条"', () =>
  inSandbox(async (fx) => {
    const a = queueReview(fx.project, { refId: 'todo_a', reason: 'subject-conflict', detail: '甲' });
    const b = queueReview(fx.project, { subject: { path: 'src/a.ts' }, reason: 'drift', detail: '乙' });
    resolveReview(fx.project, a, 'human:sbx');
    resolveReview(fx.project, b, 'human:sbx');
    const r = await complete(fx, 'todo_a');
    assert.match(r.message, /未消项闸：与本卡相交 0 条/);
    assert.match(r.message, /全局未消项 0 条/);
  }));

// ── ③ 无关卡不受影响（范围口径）────────────────────────────────
test('③ 全局有未消项、本卡相交 0 ⇒ 放行，且回执说出全局条数（不静默）', () =>
  inSandbox(async (fx) => {
    queueReview(fx.project, { subject: { path: 'src/a.ts' }, reason: 'half-escaped', detail: '只命中卡 A' });
    queueReview(fx.project, { subject: { path: 'src/zzz.ts' }, reason: 'drift', detail: '谁都不命中' });
    const r = await complete(fx, 'todo_b');
    assert.match(r.message, /相交 0 条（全局未消项 2 条）/, '★ 全局条数必须打出来：0 相交 ≠ 队列空');
    // 反证：同一时刻卡 A 仍被挡（不是"闸坏了"，是"只挡相交的"）
    const msg = await refusalOf(fx, 'todo_a');
    assert.match(msg, /相交 1 条/);
  }));

// ── ④ 判不了 ≠ 通过 ────────────────────────────────────────────
test('④ 队列库打不开（损坏）⇒ 拒，报文含「判不了（≠ 通过）」', () =>
  inSandbox(async (fx) => {
    const dbFile = getTasksDbFile(fx.project);
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.writeFileSync(dbFile, Buffer.from('this is not a sqlite database\n'.repeat(60)));
    const msg = await refusalOf(fx, 'todo_a');
    assert.match(msg, /判不了（≠ 通过）/);
    assert.match(msg, /file is not a database|not a database/, '必须带原话（不许只说"失败"）');
  }));

// ── ⑤ 「没有」要能证 ────────────────────────────────────────────
test('⑤ 队列库不在场 ⇒ 放行，且回执写明"0 条可证"（与「查过以后没有」分开说）', () =>
  inSandbox(async (fx) => {
    assert.equal(fs.existsSync(getTasksDbFile(fx.project)), false, '夹具前提：还没有 tasks.db');
    const r = await complete(fx, 'todo_a');
    assert.match(r.message, /0 条未消项是可证的/);
    assert.match(r.message, /「查过以后没有」/, '必须把两种"没有"分开说');
  }));

// ── ⑥ 纯核（不开库）：五态 + 相交口径 + 折叠点名 ─────────────────
const fact = (id: number, over: Partial<ReviewGateItemFact> = {}): ReviewGateItemFact => ({
  id,
  ref_id: null,
  subject_path: null,
  subject_symbol: null,
  reason: 'half-escaped',
  detail: `第 ${id} 条`,
  ...over,
});

test('⑥ 纯核：ok + 相交 0 ⇒ 放行；ref 命中 / subject 命中 ⇒ 拒（matched 机器可读）', () => {
  const base = { reading: 'ok' as const, root: '/r', queue_file: '/r/.agent-io/tasks.db', ref_ids: ['C1'], subject_paths: ['src/a.ts'] };
  const none = evaluateReviewGate({ ...base, items: [fact(1, { subject_path: 'src/z.ts' })] });
  assert.equal(none.ok, true);
  assert.deepEqual(none.matched, []);
  const byRef = evaluateReviewGate({ ...base, items: [fact(2, { ref_id: 'C1' })] });
  assert.equal(byRef.ok, false);
  assert.deepEqual(byRef.matched, [2]);
  const bySub = evaluateReviewGate({ ...base, items: [fact(3, { subject_path: 'src/a.ts', subject_symbol: 'fn' })] });
  assert.equal(bySub.ok, false);
  assert.deepEqual(bySub.matched, [3]);
  assert.match(bySub.refusals.join('\n'), /src\/a\.ts#fn/, '点名要带 symbol');
});

test('⑥b 纯核：五态各走各的（error 拒 / unreachable 不适用 / no-db·no-table 可证为 0）', () => {
  const base = { items: [], root: '/r', queue_file: '/r/.agent-io/tasks.db', ref_ids: ['C1'], subject_paths: ['src/a.ts'] };
  const err = evaluateReviewGate({ ...base, reading: 'error', read_error: 'database is locked' });
  assert.equal(err.ok, false);
  assert.match(err.refusals.join('\n'), /判不了（≠ 通过）/);
  assert.match(err.refusals.join('\n'), /database is locked/);
  for (const reading of ['unreachable', 'no-db', 'no-table'] as const) {
    const v = evaluateReviewGate({ ...base, reading });
    assert.equal(v.ok, true, `${reading} 必须放行（否则根本走不到收口）`);
    assert.ok(v.note.length > 0, `${reading} 必须留痕（放行也要说出理由）`);
  }
  assert.match(evaluateReviewGate({ ...base, reading: 'unreachable' }).note, /本闸对本卡不适用/);
  assert.match(evaluateReviewGate({ ...base, reading: 'no-db' }).note, /可证的/);
});

test('⑥c 纯核：命中超过上限 ⇒ 列出前 N 条 + **说出另有几条**（被裁掉的不许静默丢）', () => {
  const items = Array.from({ length: REVIEW_GATE_MAX_LISTED + 3 }, (_, i) => fact(i + 1, { subject_path: 'src/a.ts' }));
  const v = evaluateReviewGate({ reading: 'ok', items, root: '/r', queue_file: '/x', ref_ids: [], subject_paths: ['src/a.ts'] });
  assert.equal(v.ok, false);
  assert.equal(v.matched.length, REVIEW_GATE_MAX_LISTED + 3);
  const text = v.refusals.join('\n');
  assert.match(text, new RegExp(`另有 3 条未列出`));
  assert.match(text, new RegExp(`#${REVIEW_GATE_MAX_LISTED + 1}`), '折叠时也必须点名剩下的 id');
});

// ── ⑦ 接线位置：在 completeTask 里，且在 writeTask 之前 ──────────────
test('⑦ 接线在场且位置正确（拒必须在落盘之前）', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/application/design/dsl_ops/task_ops.ts', import.meta.url)), 'utf8');
  const fnAt = src.indexOf('export async function completeTask(');
  assert.ok(fnAt > 0, '必须还找得到 completeTask');
  const gateAt = src.indexOf('evaluateReviewGate(', fnAt);
  assert.ok(gateAt > fnAt, '★ 接线被摘掉 ⇒ 本用例红（消融的可判形态）');
  const writeAt = src.indexOf('writeTask(feature, node_id, withHeartbeat(', gateAt);
  assert.ok(writeAt > gateAt, '闸必须在 writeTask 之前（否则拒的时候状态已经写成 done）');
});

// ── 附：读端不再把「读不到」和「0 条」混成一个 `[]` ────────────────────
test('附 readReviewQueue 给 availability；listReviewQueue 是它的投影（同一实现）', () =>
  inSandbox(async (fx) => {
    const empty = readReviewQueue(fx.project);
    assert.equal(empty.availability, 'no-db', '没库 ⇒ 必须报 no-db，不许只说"0 条"');
    assert.deepEqual(listReviewQueue(fx.project), []);
    queueReview(fx.project, { refId: 'todo_a', reason: 'drift', detail: 'x' });
    const ok = readReviewQueue(fx.project);
    assert.equal(ok.availability, 'ok');
    assert.equal(ok.items.length, 1);
    assert.deepEqual(listReviewQueue(fx.project).map((x) => x.id), ok.items.map((x) => x.id), '投影必须逐条一致');
  }));
