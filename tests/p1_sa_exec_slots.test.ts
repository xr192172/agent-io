/**
 * touches: scripts/lib/exec_slots.mjs, scripts/lib/gate_caps.mjs
 *
 * P1 · S-EXEC 准入原语底座（§13.12 10.2 / 10.5 / 10.7 / 10.9）。
 *
 * ## 断言口径
 * ① CPU 池：并发不超 limit；每个任务恰好取/放；active/granted/released 读数正确。
 * ② 写面 mutex：单写者；第二 acquire 立即抛 WriteLockBusyError 点名持有者，不排队；释放后可再取。
 * ③ 门面 acquireSlot 按能力池分派：cpu → CPU 池；db-write/heavy → 写面 mutex。
 * ④ 诊断聚合含 cpu/write 两池；release 幂等不重复计数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCpuPool,
  createWriteMutex,
  acquireSlot,
  slotDiagnostics,
  WriteLockBusyError,
  PART_KIND,
} from '../scripts/lib/exec_slots.mjs';
import { POOL } from '../scripts/lib/gate_caps.mjs';

test('① CPU 池：并发不超 limit，取放计数正确', async () => {
  const pool = createCpuPool(2);
  let maxActive = 0;
  let activeNow = 0;
  const tasks = Array.from({ length: 6 }, (_, i) => async () => {
    const release = await pool.acquire();
    activeNow += 1;
    maxActive = Math.max(maxActive, activeNow);
    await new Promise((r) => setTimeout(r, 5));
    activeNow -= 1;
    release();
    return i;
  });
  const out = await Promise.all(tasks.map((t) => t()));
  assert.deepEqual([...out].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  assert.ok(maxActive <= 2, `并发峰值 ${maxActive} 超过 limit 2`);
  const s = pool.stats();
  assert.equal(s.active, 0);
  assert.equal(s.granted, 6);
  assert.equal(s.released, 6);
});

test('② 写面 mutex：第二取立即抛错点名持有者，不排队；释放后可再取', () => {
  const mutex = createWriteMutex();
  const rel1 = mutex.acquire('part-a', 'dist');
  assert.equal(mutex.currentHolder()?.part, 'part-a');

  assert.throws(
    () => mutex.acquire('part-b', 'cache.db'),
    (e) => {
      assert.ok(e instanceof WriteLockBusyError);
      assert.equal(e.holder, 'part-a');
      assert.equal(e.want, 'part-b');
      assert.equal(e.resource, 'cache.db');
      return true;
    },
  );
  // 抛错不排队：持有者仍是 part-a，waiting 恒 0。
  assert.equal(mutex.currentHolder()?.part, 'part-a');
  assert.equal(mutex.stats().waiting, 0);

  rel1();
  assert.equal(mutex.currentHolder(), null);
  const rel2 = mutex.acquire('part-b', 'cache.db');
  assert.equal(mutex.currentHolder()?.part, 'part-b');
  rel2();
});

test('③ 门面 acquireSlot 按池类别分派', async () => {
  const slots = { cpuPool: createCpuPool(2), writeMutex: createWriteMutex() };

  const cpuCap = { pool: POOL.CPU, writes: [] };
  const relCpu = await acquireSlot(cpuCap, { part: 'read-gate', kind: PART_KIND.VERIFY_SCOPED }, slots);
  assert.equal(slots.cpuPool.stats().active, 1);
  assert.equal(slots.writeMutex.stats().active, 0);
  relCpu();

  const dbCap = { pool: POOL.DB_WRITE, writes: ['design-db'] };
  const relDb = await acquireSlot(dbCap, { part: 'commit', kind: PART_KIND.COMMIT }, slots);
  assert.equal(slots.writeMutex.stats().active, 1);
  relDb();

  const heavyCap = { pool: POOL.HEAVY, writes: ['dist', 'judge-cache'] };
  const relHeavy = await acquireSlot(heavyCap, { part: 'mutation', kind: PART_KIND.MUTATION }, slots);
  assert.equal(slots.writeMutex.currentHolder()?.part, 'mutation');
  relHeavy();
});

test('④ 诊断聚合 + release 幂等', () => {
  const slots = { cpuPool: createCpuPool(1), writeMutex: createWriteMutex() };
  const rel = slots.writeMutex.acquire('p1', 'cache.db');
  const diag = slotDiagnostics(slots);
  assert.ok('cpu' in diag && 'write' in diag);
  assert.equal(diag.write.active, 1);
  rel();
  rel(); // 重复 release 不抛、不重复计数
  assert.equal(slots.writeMutex.stats().released, 1);
  assert.equal(slots.writeMutex.currentHolder(), null);
});
