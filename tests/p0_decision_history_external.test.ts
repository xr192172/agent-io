/**
 * p0_decision_history_external —— `decision_history` **外置**（`<f>.history.jsonl`）的判据。
 *
 * ## 它守的是什么（每条都能"该红就红"）
 * 1. **字节守恒**：append 进去的 entry 必须能**原样**读回 —— 包括当前 `NodeDecision` **没有**的字段
 *    （实测历史里带 `provenance` / `creator` / `source` / `handoff`）。任何"过类型 / 白名单"的实现都会静默丢。
 * 2. **append-only**：`decision:null` 的"减"只能是**追加一条 `clear` 标记**（有留痕），不是删行。
 * 3. **union 四态**（0.9.1 / 0.9.4 第 1 行）：
 *    内联 / 侧车 / **两处都在（必须报错）** / **侧车缺失（读不到，不许说"没有修订"）**。
 * 4. **坏行不静默吞**：截断的行必须被计数。
 *
 * ★ 消融（0.25② 有鉴别力）：把 `resolveHistory` 里 `both` 那一支去掉 ⇒ 用例 ③ 必须红；
 *   把 `index.missing` 那一支去掉 ⇒ 用例 ④ 必须红。两条都是"删掉就红"的写法。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// ★ 路径权威是 `getDesignSheetFile` ⇒ 用 AGENT_IO_HOME 把它指到临时目录（不碰真册）。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'r54-history-'));
process.env.AGENT_IO_HOME = TMP;

const H = await import('../src/infrastructure/decision_history.ts');
// ★ 写端：本卡把 `applyDecisionWrite` 的返回值从"新数组"改成"**新压栈的那一条**" ——
//   这一条正是"册里不再长出血史"的机械保证（返回新数组会诱导调用方写回册）。
const { applyDecisionWrite } = await import('../src/application/design/dsl_ops/node_ops.ts');
type NextArg = Parameters<typeof applyDecisionWrite>[2];

const FEATURE = 'fixture-hist';

/** 造一条"带当前 NodeDecision 没有的字段"的历史条目（这正是实测里丢了会静默的那种） */
function entry(over: Record<string, unknown> = {}) {
  return {
    at: '2026-11-06T00:00:00.000Z',
    note: 'n',
    decision: { summary: 's', expectations: [{ kind: 'file-exists', path: 'a.ts', why: 'w' }], provenance: { from: 'cache.db@x' } },
    ...over,
  };
}

test('① 字节守恒：append 的 entry 原样读回（含 NodeDecision 没有的字段）', () => {
  H.ensureHistoryLog(FEATURE);
  const e1 = entry({ at: '2026-11-06T00:00:01.000Z' });
  const e2 = { at: '2026-11-06T00:00:02.000Z', decision: { summary: 's2', creator: 'x', source: 'y', handoff: 'z' } };
  H.appendHistoryEntries(FEATURE, 'node_a', 0, [e1, e2]);
  const idx = H.readHistoryLog(FEATURE);
  assert.equal(idx.missing, false);
  assert.equal(idx.bad_lines, 0);
  const got = idx.byNode.get('node_a') ?? [];
  assert.equal(got.length, 2);
  // ★ 逐字节相等：`provenance` / `creator` / `source` / `handoff` 一个都不许丢
  assert.deepEqual(got[0], e1);
  assert.deepEqual(got[1], e2);
  assert.deepEqual((got[0] as { decision: { provenance: unknown } }).decision.provenance, { from: 'cache.db@x' });
});

test('② append-only：clear 标记只作废该节点，且有留痕（不是删行）', () => {
  H.appendHistoryEntries(FEATURE, 'node_b', 0, [entry()]);
  const before = fs.readFileSync(H.historyLogFile(FEATURE), 'utf-8').split('\n').filter(Boolean).length;
  H.appendHistoryClear(FEATURE, 'node_b', '2026-11-06T01:00:00.000Z');
  const idx = H.readHistoryLog(FEATURE);
  assert.equal(idx.byNode.get('node_b')?.length, 0, 'clear 之后该节点作废');
  assert.equal(idx.byNode.get('node_a')?.length, 2, '别的节点不许被波及');
  assert.equal(idx.clears, 1);
  const after = fs.readFileSync(H.historyLogFile(FEATURE), 'utf-8').split('\n').filter(Boolean).length;
  assert.equal(after, before + 1, '只加不减：行数必须 +1（删行就会变少）');
});

test('③ union：两处都在 ⇒ 报"两处都在"（不许静默取其一）', () => {
  const idx = H.readHistoryLog(FEATURE);
  const node = { id: 'node_a', decision_history: [entry({ at: '2026-11-06T00:00:09.000Z' })] };
  const r = H.resolveHistory(node, idx, true);
  assert.equal(r.source, 'both');
  const msg = H.historyAnomaly(FEATURE, 'node_a', r);
  assert.ok(msg && msg.includes('两处都在'), '必须响亮报错');
  // ★ 反向（0.16）：单一来源**不许**报错
  const single = H.resolveHistory({ id: 'node_a' }, idx, false);
  assert.equal(single.source, 'sidecar');
  assert.equal(H.historyAnomaly(FEATURE, 'node_a', single), null);
});

test('④ union：册是外置形态却没有侧车 ⇒ "读不到"，不许说"没有修订"', () => {
  // 造一个"侧车不存在"的索引
  const missingIdx = { byNode: new Map(), bad_lines: 0, missing: true, lines: 0, clears: 0 };
  const r = H.resolveHistory({ id: 'nope' }, missingIdx, false);
  assert.equal(r.source, 'unreadable');
  const msg = H.historyAnomaly(FEATURE, 'nope', r);
  assert.ok(msg && msg.includes('读不到'), '必须报"读不到"');
  // ★ 反向：册还是内联形态（别处有内联）⇒ 该节点确实没修订过 = 'none'，不许冒充读不到
  const oldBook = H.resolveHistory({ id: 'nope' }, missingIdx, true);
  assert.equal(oldBook.source, 'none');
  assert.equal(H.historyAnomaly(FEATURE, 'nope', oldBook), null);
});

test('⑤ 坏行不静默吞：截断的行被计数', () => {
  fs.appendFileSync(H.historyLogFile(FEATURE), '{"node_id":"broken"\n', 'utf-8');
  const idx = H.readHistoryLog(FEATURE);
  assert.equal(idx.bad_lines, 1);
});

test('⑥ 审计：册里内联 / 两侧都在 / 缺侧车 三个数各自可判', () => {
  const books = [
    { feature: FEATURE, nodes: [{ id: 'node_a', decision_history: [entry()] }, { id: 'node_b' }] },
    { feature: 'no-sidecar', nodes: [{ id: 'x' }] },
  ];
  const a = H.auditHistory(books);
  assert.equal(a.inlineTotal, 1, '册里内联条数（迁移后必须 0）');
  assert.equal(a.bothTotal, 1, 'node_a 内联 + 侧车都有 ⇒ 两侧都在');
  assert.deepEqual(a.missingBooks, ['no-sidecar']);
  assert.ok(a.sidecarTotal >= 2);
});

test('⑦ 写端：applyDecisionWrite 只给"新压栈的那一条"（首版不压 / 更新压一条旧卡全文）', () => {
  const first = applyDecisionWrite(undefined, undefined, { summary: 's1' } as unknown as NextArg, { now: 'T1' });
  assert.equal(first.appended, undefined, '首版不压栈');
  assert.equal(first.decision_history, undefined);

  const prev = first.decision as NonNullable<typeof first.decision>;
  const second = applyDecisionWrite(prev, undefined, { summary: 's2' } as unknown as NextArg, { now: 'T2' });
  assert.ok(second.appended, '更新必须给出**新压栈的一条**（不是新数组）');
  assert.equal(second.appended!.at, 'T2');
  assert.equal((second.appended!.decision as { summary: string }).summary, 's1', '压进去的是**旧卡全文**');

  // 清除（decision:null）⇒ 不压栈（清卡走的是"追加 clear 标记"，见用例 ②）
  const cleared = applyDecisionWrite(prev, undefined, null, { now: 'T3' });
  assert.equal(cleared.appended, undefined);
  assert.equal(cleared.decision, undefined);
});
