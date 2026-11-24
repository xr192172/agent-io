/**
 * touches: scripts/lib/gate_caps.mjs, scripts/verify.mjs, scripts/lib/verify_inheritance.mjs,
 *         scripts/docs-facts-check.mjs
 *
 * P1 · S-2 读写能力分类一处权威（§13.6 S-2 / §13.12 10.6）。
 *
 * ## 断言口径（每条可判真假）
 * ① GATES 全部门在 GATE_CAPS 登记；资源/池/秩枚举合法；validateCaps 真仓 problems 空。
 * ② 只读继承白名单门全部 writes 空 ∧ 无副作用（写面不得混进只读白名单）。
 * ③ 重活两门（设计册判据 / 判据突变）归 heavy 池、写面非空。
 * ④ 鉴别力（合成消融）：写面门误标只读 ⇒ validateCaps 点名 GATE_CAP_WRITE_MISLABELED；
 *    未登记门 ⇒ capOf 保守 db-write + unregistered 留痕（fail-closed，不当只读）。
 * ⑤ 聚合门「文档与事实」六个子检查逐子登记且全只读（次级写面逐子核对）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GATES, ROOT } from '../scripts/verify.mjs';
import { INHERITABLE } from '../scripts/lib/verify_inheritance.mjs';
import {
  GATE_CAPS,
  SUBCHECK_CAPS,
  POOL,
  RES,
  capOf,
  isWriteCap,
  isConcurrentRead,
  validateCaps,
} from '../scripts/lib/gate_caps.mjs';

/** 求值函数门（judge 选量门是 `(root) => ({...})`）。 */
const gates = GATES.map((g) => (typeof g === 'function' ? g(ROOT) : g));
const gateNames = gates.map((g) => g.name);

test('① GATES 全部门登记；枚举合法；真仓 validateCaps 无问题', () => {
  const problems = validateCaps(gates, INHERITABLE);
  assert.deepEqual(problems, [], `能力表问题：${problems.map((p) => `${p.code}: ${p.msg}`).join('；')}`);
  for (const name of gateNames) {
    assert.ok(GATE_CAPS[name], `门「${name}」缺能力登记`);
  }
});

test('② 只读继承白名单门全部只读（writes 空 ∧ 无副作用）', () => {
  for (const name of INHERITABLE) {
    const cap = GATE_CAPS[name] ?? SUBCHECK_CAPS[name];
    assert.ok(cap, `白名单「${name}」未登记`);
    assert.deepEqual(cap.writes, [], `白名单「${name}」不得有写资源：${JSON.stringify(cap.writes)}`);
    assert.equal(cap.side_effect, false, `白名单「${name}」不得有外部副作用`);
    assert.equal(isWriteCap(cap), false, `白名单「${name}」不得被判为写面`);
  }
});

test('③ 重活两门归 heavy 池且写面非空', () => {
  for (const name of ['设计册判据', '判据突变']) {
    const cap = capOf(name);
    assert.equal(cap.pool, POOL.HEAVY, `「${name}」应归 heavy 池，实得 ${cap.pool}`);
    assert.ok(isWriteCap(cap), `「${name}」应判写面`);
    assert.ok(cap.writes.length > 0, `「${name}」写资源不得为空`);
  }
});

test('④a 鉴别力：写面门误标只读 ⇒ validateCaps 拒绝（合成消融）', () => {
  const fakeGates = [{ name: '假写面门' }];
  // 假登记：声称只读 cpu，却写 dist（共享写资源）⇒ 必须被点名。
  const fakeCaps = {
    '假写面门': { reads: [RES.SRC], writes: [RES.DIST], side_effect: false, pool: POOL.CPU, rank: 0 },
  };
  const problems = validateCaps(fakeGates, [], fakeCaps);
  const codes = problems.map((p) => p.code);
  assert.ok(codes.includes('GATE_CAP_POOL_MISMATCH'), `应点名池类别错配，实得 ${JSON.stringify(codes)}`);

  // 写面进只读白名单 ⇒ WRITE_MISLABELED。
  const problems2 = validateCaps([{ name: '假写面门' }], ['假写面门'], fakeCaps);
  assert.ok(
    problems2.some((p) => p.code === 'GATE_CAP_WRITE_MISLABELED'),
    `写面门进白名单应被拒，实得 ${JSON.stringify(problems2.map((p) => p.code))}`,
  );
});

test('④b 鉴别力：未登记门 ⇒ 保守 db-write + unregistered（fail-closed，不当只读）', () => {
  const cap = capOf('不存在的门');
  assert.equal(cap.unregistered, true);
  assert.equal(cap.pool, POOL.DB_WRITE);
  assert.equal(isConcurrentRead(cap), false, '未登记门不得入并发槽');
  const problems = validateCaps([{ name: '不存在的门' }], []);
  assert.ok(problems.some((p) => p.code === 'GATE_CAP_UNREGISTERED'));
});

test('⑤ 聚合门六子检查逐子登记且全只读', () => {
  const subs = Object.keys(SUBCHECK_CAPS);
  assert.deepEqual([...subs].sort(), ['cognition:check', 'doc:check', 'gen-facts:check', 'ledger:check', 'lint:prose', 'manifest:check']);
  for (const [name, cap] of Object.entries(SUBCHECK_CAPS)) {
    assert.deepEqual(cap.writes, [], `子检查「${name}」只读`);
    assert.equal(cap.side_effect, false, `子检查「${name}」无副作用`);
  }
});
