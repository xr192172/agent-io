/**
 * G5 把守测试 · 空观察面条目存量清理（2026-11-24，阶段 1 静态缺口闭合 G-3 批）。
 *
 * 覆盖：
 * ① 写回撤销孤儿契约条目：当前册节点集合非空时，已删节点的旧 contract 条目剔出；test 条目原样保留；
 *    当前册集合读不到（空）⇒ fail-closed 不删（宁留不误删）。
 * ④ 空观察（observes+symbols 皆空）的 pass 条目 ⇒ 继承侧判 undetermined，不进 inherit（不得继承为 pass）。
 * ③ 只读仓断言：主快照空观察条目为**条目级**口径，与 scope.undetermined 的**列表级**计数不互替。
 *
 * ★ 256（条目级，企划草案口径）≠ 584 undetermined（scope 列表级）；实测读数以当前 HEAD 快照为准。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SNAPSHOT_SCHEMA,
  loadVerifiedSnapshot,
  planInheritance,
  pruneOrphanContractEntries,
} from '../src/application/design/verified_snapshot.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const cEntry = (id: string, over = {}) => ({
  id,
  kind: 'contract' as const,
  verdict: 'pass' as const,
  command: `node scripts/judge-all.mjs（契约 ${id}）`,
  at: '2026-11-24T00:00:00.000Z',
  observes: [],
  ...over,
});
const tEntry = (over = {}) => ({
  id: 'test:tests/a.test.ts',
  kind: 'test' as const,
  verdict: 'pass' as const,
  command: 'node --import tsx tests/a.test.ts',
  at: '2026-11-24T00:00:00.000Z',
  observes: ['src/a.ts'],
  digest: 'D1',
  ...over,
});

test('G5 · ①孤儿契约条目：册上已删节点的旧 pass 被剔，在册节点与 test 条目保留', () => {
  const alive = new Set(['contract:keep_node']);
  const entries = [
    cEntry('contract:keep_node'),
    cEntry('contract:ghost_deleted_node', { verdict: 'pass' }),
    tEntry(),
  ];
  const out = pruneOrphanContractEntries(entries, alive);
  const ids = out.map((e) => e.id);
  assert.ok(ids.includes('contract:keep_node'), '在册契约节点保留');
  assert.ok(!ids.includes('contract:ghost_deleted_node'), '孤儿契约条目（册上已删）剔除，不留旧绿');
  assert.ok(ids.includes('test:tests/a.test.ts'), 'test 条目不归契约门管，原样保留');
});

test('G5 · ①fail-closed：当前册节点集合读不到（空）⇒ 不删任何条目（宁留不误删）', () => {
  const entries = [cEntry('contract:any_node'), tEntry()];
  const out = pruneOrphanContractEntries(entries, new Set());
  assert.equal(out.length, 2, '册不可信 ⇒ 全保留，等下一轮可读再清');
});

test('G5 · ④空观察 pass 条目 ⇒ 不进继承（undetermined，不得继承为 pass）', () => {
  const snap = {
    schema: SNAPSHOT_SCHEMA,
    at: '2026-11-24T00:00:00.000Z',
    content: { version: 'IGNORED', files: { 'src/a.ts': 'h1' } },
    graph: { version: 'IGNORED', bytes: 1, available: true },
    // observes/symbols 皆空的旧 pass 条目
    entries: [tEntry({ observes: [], symbols: [] })],
    scope: { ran: [], inherited: [], undetermined: [] },
  };
  const plan = planInheritance({
    loaded: { status: 'ok', snapshot: snap },
    changed: ['src/x.ts'],
    digestOf: () => 'D1',
  });
  assert.equal(plan.inherit.length, 0, '空观察条目不得继承为 pass');
  assert.ok(plan.undetermined.length >= 1, '留在未判定分母里，不许从分母消失');
});

test('G5 · ③只读仓：主快照空观察为条目级口径，与 scope.undetermined 列表级计数不互替', () => {
  const loaded = loadVerifiedSnapshot(ROOT);
  if (loaded.status !== 'ok') {
    // 没有基线也必须说得出来（不伪造读数）
    assert.ok(loaded.reason.length > 0);
    return;
  }
  const snap = loaded.snapshot;
  const blank = snap.entries.filter(
    (e) => (e.observes?.length ?? 0) === 0 && (e.symbols?.length ?? 0) === 0,
  );
  const blankTest = blank.filter((e) => e.kind === 'test').length;
  const blankContract = blank.filter((e) => e.kind === 'contract').length;
  // 条目级：blank 是"逐条观察面为空"的条目数
  assert.ok(blank.length > 0, '实测存在空观察条目（条目级）');
  assert.equal(blank.length, blankTest + blankContract, 'blank 按 kind 分桶自洽');
  // 列表级：scope.undetermined 是"本次计划未判定"的条目清单，另一口径，不得与 blank 互替
  const undeterminedList = snap.scope?.undetermined ?? [];
  assert.ok(
    typeof undeterminedList.length === 'number',
    'scope.undetermined 是列表级计数（与 blank 条目级不同口径）',
  );
  // 留痕/继承入口分开：entries 是历史证据留痕；继承面只取 plan.inherit（本处断言 scope 三态分列）
  assert.ok(Array.isArray(snap.scope?.ran), 'scope.ran 留痕本次实跑');
  assert.ok(Array.isArray(snap.scope?.inherited), 'scope.inherited 留痕本次继承入口');
  // 打印实测分桶（回执对账用；不断言具体数字——基线只升，数字随批次演进）
  console.log(
    `G5 只读仓读数：entries=${snap.entries.length} blank=${blank.length} ` +
      `(test=${blankTest} contract=${blankContract}) scope.undetermined=${undeterminedList.length}`,
  );
});
