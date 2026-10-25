/**
 * I1 · 第 2 条：edit_dsl **顶层孤儿键响亮拒**。
 *
 * 判据：`operations[]` 之外出现业务键（type/id/data/op 等）⇒ 报错**点名键名**（此前静默忽略，
 * 调用方"以为写进去了"）。已知顶层键 = schema 声明的 + actor/authorize + project_dir（通用边）。
 * 检查在 handler 最前（view 护栏之后、任何存储访问之前）⇒ 测试无需夹具。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editDslHandler } from '../src/application/design/handlers.js';

test('顶层孤儿键（type/id/data/op）⇒ 报错并逐个点名', async () => {
  const r = await editDslHandler({
    feature: 'whatever',
    reason: '孤儿键测试',
    operations: [],
    type: 'node',
    op: 'add',
    id: 'n1',
    data: { label: 'x' },
  } as never);
  assert.equal(r.isError, true);
  for (const k of ['type', 'op', 'id', 'data']) {
    assert.match(r.text, new RegExp(`\`${k}\``), `报错必须点名 ${k}`);
  }
  assert.match(r.text, /operations/);
});

test('未知顶层键（如误传 note）⇒ 同样拒绝并给合法键清单', async () => {
  const r = await editDslHandler({
    feature: 'whatever',
    reason: '孤儿键测试',
    operations: [],
    note: 'misplaced',
  } as never);
  assert.equal(r.isError, true);
  assert.match(r.text, /`note`/);
  assert.match(r.text, /feature, agent, view, weight, reason, operations, evidence, actor, authorize/);
});

test('合法顶层键（含 actor/authorize/project_dir）⇒ 不触发孤儿键拒绝（走到后续逻辑才失败，且失败原因不是孤儿键）', async () => {
  const r = await editDslHandler({
    feature: 'no-such-feature-i1',
    reason: '合法键放行测试',
    operations: [{ op: 'update', type: 'decision', id: 'x', data: { summary: 's' } }],
    actor: 'subagent:agentio-iter1',
    authorize: 'files:src/',
    project_dir: '.',
  } as never);
  // feature 不存在 ⇒ 后续逻辑报"不存在"；关键是**不含**「顶层孤儿键」
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.text, /顶层孤儿键/);
});
