/**
 * P1 · **S-A / S-13 插队 + 安全点抢占 + 降级显形回退把守**。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 安全点三条件齐备才可抢占；任一缺失拒绝并点名缺项。
 * ② 高优插队：安全点 ⇒ 队头抢占；非安全点 ⇒ 排队头等待，不抢占在跑 part。
 * ③ 并行降级即挂起收口；附串行复跑且对账一致 ⇒ 可收口；不一致 ⇒ 显形不可收口。
 * ④ 未附串行复跑对账 ⇒ 不可收口（执行层不自行放宽护栏）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canPreempt, enqueuePrioritized, recordDegradation, attachSerialRerun, canCloseout,
} from '../scripts/lib/preempt_guard.mjs';

const SAFE = { mutationRestored: true, writeLockReleased: true, snapshotBooked: true };

test('① S-13 安全点：三条件齐备可抢占，缺一拒绝点名', () => {
  assert.equal(canPreempt(SAFE).ok, true);
  for (const missing of ['mutationRestored', 'writeLockReleased', 'snapshotBooked']) {
    const point = { ...SAFE, [missing]: false };
    const r = canPreempt(point);
    assert.equal(r.ok, false, `缺 ${missing} 必须拒绝抢占`);
    assert.ok(r.missing.length === 1, `点名缺项：${r.missing.join(',')}`);
  }
});

test('② S-13 插队：安全点高优抢占队头；非安全点排队不抢占', () => {
  const safe = enqueuePrioritized(['a', 'b'], 'c', { highPriority: true, point: SAFE });
  assert.deepEqual(safe.queue, ['c', 'a', 'b']);
  assert.equal(safe.preempted, true);

  const unsafe = enqueuePrioritized(['a', 'b'], 'c', {
    highPriority: true,
    point: { mutationRestored: true, writeLockReleased: false, snapshotBooked: true },
  });
  assert.deepEqual(unsafe.queue, ['c', 'a', 'b']);
  assert.equal(unsafe.preempted, false, '非安全点不得抢占在跑 part');
  assert.match(unsafe.reason, /非安全点/);
});

test('③ S-13 降级挂起：串行对账一致才可收口，不一致显形', () => {
  let rec = recordDegradation({ reason: '并行判不了污染者', parallelVerdict: 'PASS' });
  assert.equal(canCloseout(rec), false, '降级未串行复跑 ⇒ 收口挂起');

  rec = attachSerialRerun(rec, 'PASS');
  assert.equal(rec.mismatch, false);
  assert.equal(canCloseout(rec), true, '串行对账一致 ⇒ 可收口');

  const mismatch = attachSerialRerun(recordDegradation({ reason: 'x', parallelVerdict: 'PASS' }), 'FAIL');
  assert.equal(mismatch.mismatch, true);
  assert.equal(canCloseout(mismatch), false, '并行/串行结论不一致 ⇒ 不可收口');
});

test('④ S-13 执行层不自行放宽：无串行对账不得判收口通过', () => {
  const rec = recordDegradation({ reason: '护栏降级' });
  assert.equal(rec.serialRerunAttached, false);
  assert.equal(canCloseout(rec), false);
});
