/**
 * P1 · **S-A / S-6 并发档位策略把守**：三输入联合定档 + 下限保护 + 退出分类分流 + 退避防抖。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 起步上限 4：空环境建议并发不超过 MAX_JOBS。
 * ② RSS 紧张 ⇒ 降档（越线到 1，偏高到 2）。
 * ③ 句柄紧张 ⇒ 降到下限。
 * ④ HEAVY 重量门类起步单并发。
 * ⑤ 下限保护：非法/0 请求 ⇒ jobs ≥ 1（永不并发 0）。
 * ⑥ 退出分类：ok / assert-fail / oom-kill / signal-kill / crash 分流，OOM·kill 不折断言失败。
 * ⑦ 退避环：空闲次数不足不许回升（防抖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planJobs, classifyExit, allowUpscale, MAX_JOBS, MIN_JOBS,
} from '../scripts/lib/concurrency_policy.mjs';

test('① S-6 起步上限 4：空环境并发封顶 MAX_JOBS', () => {
  const r = planJobs({ requested: 8, env: {} });
  assert.equal(r.jobs, MAX_JOBS);
  assert.equal(r.degraded, false);
});

test('② S-6 RSS 联合判档：越线到 1，偏高到 2', () => {
  const hot = planJobs({ requested: 4, env: { rssMb: 900, rssLimitMb: 1000 } });
  assert.equal(hot.jobs, MIN_JOBS);
  assert.ok(hot.reasons.some((s) => /RSS/.test(s)));

  const warm = planJobs({ requested: 4, env: { rssMb: 780, rssLimitMb: 1000 } });
  assert.equal(warm.jobs, 2);
});

test('③ S-6 句柄紧张 ⇒ 降到下限', () => {
  const r = planJobs({ requested: 4, env: { openHandles: 900, handleLimit: 1000 } });
  assert.equal(r.jobs, MIN_JOBS);
  assert.ok(r.reasons.some((s) => /句柄/.test(s)));
});

test('④ S-6 HEAVY 重量门类起步单并发', () => {
  const r = planJobs({ pool: 'heavy', requested: 4, env: {} });
  assert.equal(r.jobs, 1);
  assert.equal(r.degraded, true);
});

test('⑤ S-6 下限保护：非法/0 请求 ⇒ jobs ≥ 1', () => {
  for (const requested of [0, -3, NaN, undefined]) {
    const r = planJobs({ requested, env: {} });
    assert.ok(r.jobs >= MIN_JOBS, `requested=${requested} 不得降到下限以下`);
  }
});

test('⑥ S-6 退出分类分流：OOM/kill 不折断言失败', () => {
  assert.equal(classifyExit({ status: 0 }), 'ok');
  assert.equal(classifyExit({ status: 1 }), 'assert-fail');
  assert.equal(classifyExit({ status: null }), 'crash');
  assert.equal(
    classifyExit({ status: null, killed: true, signal: 'SIGKILL', errorMessage: 'JavaScript heap out of memory' }),
    'oom-kill',
  );
  assert.equal(
    classifyExit({ status: null, killed: true, signal: 'SIGTERM', errorMessage: 'terminated' }),
    'signal-kill',
  );
  assert.equal(classifyExit({ status: 1, errorMessage: 'out of memory' }), 'oom-kill');
});

test('⑦ S-6 退避环：空闲不足不许回升，连续空闲达标允许', () => {
  assert.equal(allowUpscale({ consecutiveRelaxed: 0 }), false);
  assert.equal(allowUpscale({ consecutiveRelaxed: 1 }), false); // upRuns 起步 2
  assert.equal(allowUpscale({ consecutiveRelaxed: 2 }), true);
});
