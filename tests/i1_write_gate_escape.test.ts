/**
 * I1 · 第 1 条：写闸拒绝的出路文案**必须含 authorize 方案**。
 *
 * 判据（寄风批准的 8 条之一）：批量写被「任务闸」拒绝时，出路列表里要有 authorize 捷径
 * （含示例 `authorize: 'files:packages/xxx/'`），否则调用方只看得到"逐文件立卡"一条路。
 * 常量唯一住处 = `write_gate.ts#AUTHORIZE_ESCAPE_HATCH`（被「怎么领」段引用）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTHORIZE_ESCAPE_HATCH, GATE_REJECTION_PREFIX } from '../src/application/write_gate.js';

test('AUTHORIZE_ESCAPE_HATCH：含 authorize 示例（files: 前缀）', () => {
  assert.match(AUTHORIZE_ESCAPE_HATCH, /authorize:\s*'files:packages\/xxx\/'/);
});

test('AUTHORIZE_ESCAPE_HATCH：点名文法唯一落点 domain/scope.ts 与放行判据', () => {
  assert.match(AUTHORIZE_ESCAPE_HATCH, /domain\/scope\.ts/);
  assert.match(AUTHORIZE_ESCAPE_HATCH, /claimed/); // 放行判据 = scope 里有"你领的"卡
});

test('AUTHORIZE_ESCAPE_HATCH：明示 authorize:all 被拒（不给人关闸的口子）', () => {
  assert.match(AUTHORIZE_ESCAPE_HATCH, /authorize:'all'/);
  assert.match(AUTHORIZE_ESCAPE_HATCH, /拒绝/);
});

test('AUTHORIZE_ESCAPE_HATCH：不破坏 ①②（逐文件判定照旧可用）', () => {
  assert.match(AUTHORIZE_ESCAPE_HATCH, /③/);
  assert.match(AUTHORIZE_ESCAPE_HATCH, /照旧可用/);
  // 前缀纪律：出路文案挂在闸拒绝信息里 ⇒ 与 GATE_REJECTION_PREFIX 同族（文案家族一致性）
  assert.equal(GATE_REJECTION_PREFIX, '拒绝落盘');
});
