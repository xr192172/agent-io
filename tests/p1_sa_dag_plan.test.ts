/**
 * P1 · **S-A / S-1 DAG 编排内核把守**：施工/验证/收口节点建进 DAG，显式 needs 边、环检测、
 * 依赖不裁剪、写面同层互斥、三态 verdict 聚合（SKIP/unrun 不折 PASS）。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 施工链：build-part → smoke-part → verify-full → commit 分层正确，边随 needs 建进 DAG。
 * ② 环检测：A→B→A ⇒ DAG_CYCLE 点名环上节点。
 * ③ 未知依赖：needs 引用未登记节点 ⇒ DAG_UNKNOWN_DEP。
 * ④ 依赖不裁剪：层序保留全部节点，needs 边原样进入拓扑。
 * ⑤ 写面同层互斥：两个写面节点同层 ⇒ DAG_WRITE_SAME_LAYER（不得同窗并发）。
 * ⑥ 三态聚合：PASS/FAIL/SKIP/unrun 分列；SKIP 与 unrun 不计入 passCountable。
 * ⑦ 读面可入并发槽；写面拒绝并发槽。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDag, addNode, validateDag, topoLayers, detectCycle,
  aggregateVerdict, canConcurrentlyRun, NODE_KIND,
} from '../scripts/lib/dag_plan.mjs';

// ① 施工链分层正确。
test('① S-1 施工链：part → smoke → full → commit 显式边分层', () => {
  const dag = createDag();
  addNode(dag, { id: 'part-1', kind: NODE_KIND.BUILD_PART, gateName: 'Go 编译' });
  addNode(dag, { id: 'smoke-1', kind: NODE_KIND.SMOKE_PART, needs: ['part-1'], gateName: 'ts 类型' });
  addNode(dag, { id: 'full', kind: NODE_KIND.VERIFY_FULL, needs: ['smoke-1'] });
  addNode(dag, { id: 'commit', kind: NODE_KIND.COMMIT, needs: ['full'] });
  const v = validateDag(dag);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.layers, [['part-1'], ['smoke-1'], ['full'], ['commit']]);
});

// ② 环检测点名。
test('② S-1 环检测：A→B→A 成环 ⇒ DAG_CYCLE', () => {
  const dag = createDag();
  addNode(dag, { id: 'A', kind: NODE_KIND.BACKGROUND, needs: ['B'] });
  addNode(dag, { id: 'B', kind: NODE_KIND.BACKGROUND, needs: ['A'] });
  const cycle = detectCycle(dag);
  assert.ok(cycle.length >= 2, '必须检出环');
  const v = validateDag(dag);
  assert.ok(v.problems.some((p) => p.code === 'DAG_CYCLE'));
});

// ③ 未知依赖点名。
test('③ S-1 未知依赖 ⇒ DAG_UNKNOWN_DEP', () => {
  const dag = createDag();
  addNode(dag, { id: 'x', kind: NODE_KIND.BACKGROUND, needs: ['ghost'] });
  const v = validateDag(dag);
  assert.ok(v.problems.some((p) => p.code === 'DAG_UNKNOWN_DEP' && p.msg.includes('ghost')));
});

// ④ 依赖不裁剪：全部节点进层序，needs 边原样保留。
test('④ S-1 依赖不裁剪：层序含全部节点，needs 原样进拓扑', () => {
  const dag = createDag();
  addNode(dag, { id: 'a', kind: NODE_KIND.BACKGROUND });
  addNode(dag, { id: 'b', kind: NODE_KIND.BACKGROUND, needs: ['a'] });
  addNode(dag, { id: 'c', kind: NODE_KIND.BACKGROUND, needs: ['a'] });
  const v = validateDag(dag);
  assert.deepEqual(v.problems, []);
  assert.deepEqual([...v.order].sort(), ['a', 'b', 'c']);
  assert.deepEqual(dag.nodes.get('b').needs, ['a']);
  assert.deepEqual(dag.nodes.get('c').needs, ['a']);
});

// ⑤ 写面同层互斥。
test('⑤ S-1 写面同层 ⇒ DAG_WRITE_SAME_LAYER（须串行）', () => {
  const dag = createDag();
  addNode(dag, { id: 'judge', kind: NODE_KIND.VERIFY_FULL, gateName: '设计册判据' });
  addNode(dag, { id: 'mutate', kind: NODE_KIND.MUTATION, gateName: '判据突变' });
  const v = validateDag(dag);
  assert.ok(v.problems.some((p) => p.code === 'DAG_WRITE_SAME_LAYER'),
    `两个写面同层必须报互斥：${JSON.stringify(v.problems)}`);
});

// ⑥ 三态聚合：SKIP/unrun 不折 PASS。
test('⑥ S-1 三态聚合：PASS/FAIL/SKIP/unrun 分列，未跑不进通过计数', () => {
  const results = new Map([
    ['p1', { state: 'PASS' }],
    ['p2', { state: 'PASS' }],
    ['f1', { state: 'FAIL' }],
    ['s1', { state: 'SKIP' }],
    ['u1', { state: 'unsupported' }],
    ['u2', {}],
  ]);
  const agg = aggregateVerdict(results);
  assert.equal(agg.total, 6);
  assert.equal(agg.pass, 2);
  assert.equal(agg.fail, 1);
  assert.equal(agg.skip, 1);
  assert.equal(agg.unrun, 2);
  assert.equal(agg.passCountable, 2, 'SKIP 与 unrun 不得计入通过计数');
});

// ⑦ 读面可并发；写面拒绝并发槽。
test('⑦ S-1 并发槽分派：只读门可入槽，写面/重活拒绝同窗', () => {
  const read = { id: 'r', kind: NODE_KIND.VERIFY_SCOPED, gateName: 'Go 编译' };
  const write = { id: 'w', kind: NODE_KIND.VERIFY_FULL, gateName: '设计册判据' };
  assert.equal(canConcurrentlyRun(read), true, '只读 cpu 门可入并发槽');
  assert.equal(canConcurrentlyRun(write), false, '写面/重活不得入并发槽');
});

// 分层辅助：无依赖同层。
test('辅助 topoLayers：无依赖节点同在第 0 层', () => {
  const dag = createDag();
  addNode(dag, { id: 'x', kind: NODE_KIND.BACKGROUND });
  addNode(dag, { id: 'y', kind: NODE_KIND.BACKGROUND });
  assert.deepEqual(topoLayers(dag), [['x', 'y']]);
});
