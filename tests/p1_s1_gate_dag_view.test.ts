/**
 * touches: scripts/lib/gate_dag_view.mjs, scripts/lib/dag_plan.mjs, scripts/lib/gate_caps.mjs,
 *         scripts/verify.mjs, scripts/lib/verify_inheritance.mjs
 *
 * P1 · S-1 现役门静态调度结构视图 + 静态 delta 并列对账把守（§13.6 S-1 / §13.11；一期执行仍串行）。
 *
 * ## 断言口径（每条可判真假）
 * ① 真仓 GATES 全部门进视图：门集与现役清单逐字一致；结构致命问题（环 / 未知依赖 / 重复 id）空；
 *    未登记门留痕空（现役门全在 gate_caps 登记）。
 * ② 名单对账：heavy 两门（设计册判据 / 判据突变）归重活排他；并发只读候选与写面名单不交；
 *    只读继承白名单门不得出现在写面名单。
 * ③ 静态 delta 并列：视图枚举门集 == 现役串行门清单；视图写面名单与 gate_caps 权威写面集一致；
 *    并发候选全是只读 + CPU 池。静态视图只描述候选，不改现役 verdict。
 * ④ 鉴别力（合成消融）：未登记门 ⇒ unregistered 留痕且不进并发候选；写面门不可能被归入只读并发候选。
 *
 * ★ 边界：本证不跑并行、不产 verdict 对拍、不冻结并发度数；门间真依赖边 / 执行器接入属后续批（A 待冻结）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GATES, ROOT } from '../scripts/verify.mjs';
import { INHERITABLE } from '../scripts/lib/verify_inheritance.mjs';
import { buildGateView } from '../scripts/lib/gate_dag_view.mjs';
import { capOf, isWriteCap, isConcurrentRead, GATE_CAPS, POOL } from '../scripts/lib/gate_caps.mjs';

/** 求值函数门（judge 选量门是 `(root) => ({...})`）。 */
const gates = GATES.map((g) => (typeof g === 'function' ? g(ROOT) : g));
const view = buildGateView(gates);

test('① 现役门集逐字进视图；结构致命问题空；未登记留痕空', () => {
  assert.deepEqual(view.gateNames, gates.map((g) => g.name), '视图门集必须与现役 GATES 逐字一致');
  assert.deepEqual(
    view.structuralProblems,
    [],
    `结构致命问题：${view.structuralProblems.map((p) => `${p.code}: ${p.msg}`).join('；')}`,
  );
  assert.deepEqual(view.unregistered, [], `未登记门须补登记：${view.unregistered.join('、')}`);
});

test('② heavy 两门归重活排他；并发候选与写面不交；白名单不在写面', () => {
  assert.deepEqual([...view.heavy].sort(), ['判据突变', '设计册判据'].sort(), '重活排他名单');
  const overlap = view.concurrentRead.filter((n) => view.write.includes(n));
  assert.deepEqual(overlap, [], `同一门不得既在并发只读候选又在写面：${overlap.join('、')}`);
  for (const name of INHERITABLE) {
    if (gates.some((g) => g.name === name)) {
      assert.ok(!view.write.includes(name), `只读白名单「${name}」不得进写面名单`);
    }
  }
});

test('③ 静态 delta 并列：写面名单与 gate_caps 权威一致；并发候选全只读 CPU', () => {
  // 视图写面名单 == 权威表判为写面的现役门（静态枚举并列对账，不重算口径）。
  const expectedWrite = gates.map((g) => g.name).filter((n) => isWriteCap(capOf(n)));
  assert.deepEqual([...view.write].sort(), [...expectedWrite].sort(), '写面名单须与 gate_caps 权威一致');

  for (const name of view.concurrentRead) {
    const cap = capOf(name);
    assert.equal(isWriteCap(cap), false, `并发候选「${name}」不得是写面`);
    assert.equal(cap.pool, POOL.CPU, `并发候选「${name}」须归 cpu 池`);
  }
});

test('④ 鉴别力：未登记门留痕且不进并发候选；写面门不被归入只读候选', () => {
  const synthetic = buildGateView([{ name: '幽灵未登记门' }]);
  assert.deepEqual(synthetic.unregistered, ['幽灵未登记门'], '未登记门须保守串行留痕');
  assert.deepEqual(synthetic.concurrentRead, [], '未登记门不得进并发只读候选');
  assert.ok(synthetic.structuralProblems.length === 0, '合成单门无环 / 未知依赖');

  // 权威表内写面门（heavy）即便合成进视图，也不得进并发候选。
  for (const name of view.heavy) {
    assert.ok(!view.concurrentRead.includes(name), `heavy 门「${name}」不得进并发候选`);
  }
});

test('⑤ 视图不改动现役门：节点 needs 为空（边接线留后续批），分层为静态枚举', () => {
  for (const node of view.dag.nodes.values()) {
    assert.deepEqual(node.needs, [], '现役门静态视图不预设依赖边（needs=[]）');
  }
  // 无边 ⇒ 全部门落在第 0 层；分层语义待边登记后生效。
  assert.equal(view.layers.length >= 1, true);
  assert.deepEqual(view.order.length, gates.length, '静态视图门数与现役一致');
});
