/**
 * touches: src/application/design/intent/journey_program.ts
 *
 * P1 · **journey 卡级契约** 的机器回归 —— 2026-11-10
 *
 * 钉住四件事（目标项目 = review-hub 的 router，组合行为跨 protocol/queue/registry/router 四文件）：
 *  ① 正例：handoff.submit 合格 ⇒ review-board 收 1 帧 handoff.submit + 投递席收 handoff_accepted notice；
 *  ② fail-closed：校验器不可用（validatorThrows）⇒ 只有 handoff_validator_unavailable，review-board 零帧；
 *  ③ 校验不过：handoffValidateOk=false ⇒ handoff_invalid，不转交；
 *  ④ 无接收者：fixture 里没有 review-board 席位 ⇒ relays=0，notice relayed=false 如实报。
 *
 * 变异验收：对 review-hub 真源做转交行/拦截摘除变异 ⇒ 契约必须红（run_journey_mutations.mjs）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runJourneyCase } from '../src/application/design/intent/journey_program.js';

const ROOT = 'D:/agentio/dev/review-hub';
const ROUTER = 'src/router.ts';

test('P1-journey · ①正例：合格交接包转交 review-board + 回执投递席', () => {
  const r = runJourneyCase({
    projectRoot: ROOT,
    file: ROUTER,
    journeyCase: {
      deliver: {
        type: 'handoff.submit',
        from: { role: 'executor', id: 'executor-1' },
        payload: { markdown: '# 交接包\n\n## 结论\n做完了' },
        correlation_id: 'h1',
      },
      fixture: { handoffValidateOk: true },
      expect: {
        relays: [{ to: 'review-board', type: 'handoff.submit', count: 1 }],
        notices: [{ to: 'executor-1', code: 'handoff_accepted' }],
      },
    },
  });
  assert.equal(r.status, 'pass', `期望 pass，实得 ${r.status}：${r.detail.join('；')}`);
});

test('P1-journey · ②fail-closed：校验器不可用 ⇒ 拦截 + review-board 零帧', () => {
  const r = runJourneyCase({
    projectRoot: ROOT,
    file: ROUTER,
    journeyCase: {
      deliver: {
        type: 'handoff.submit',
        from: { role: 'executor', id: 'executor-1' },
        payload: { markdown: '# x' },
      },
      fixture: { validatorThrows: true },
      expect: {
        relays: [{ to: 'review-board', type: 'handoff.submit', count: 0 }],
        notices: [{ to: 'executor-1', code: 'handoff_validator_unavailable' }],
      },
    },
  });
  assert.equal(r.status, 'pass', `fail-closed 旅程应 pass，实得 ${r.status}：${r.detail.join('；')}`);
});

test('P1-journey · ③校验不过 ⇒ handoff_invalid 不转交', () => {
  const r = runJourneyCase({
    projectRoot: ROOT,
    file: ROUTER,
    journeyCase: {
      deliver: {
        type: 'handoff.submit',
        from: { role: 'executor', id: 'executor-1' },
        payload: { markdown: '缺结论的交接包' },
      },
      fixture: { handoffValidateOk: false, validatorProblems: ['缺少结论'] },
      expect: {
        relays: [{ to: 'review-board', type: 'handoff.submit', count: 0 }],
        notices: [{ to: 'executor-1', code: 'handoff_invalid' }],
      },
    },
  });
  assert.equal(r.status, 'pass', `校验不过旅程应 pass，实得 ${r.status}：${r.detail.join('；')}`);
});

test('P1-journey · ④无 review-board 在线 ⇒ relays=0 且 notice 如实报 relayed=false', () => {
  const r = runJourneyCase({
    projectRoot: ROOT,
    file: ROUTER,
    journeyCase: {
      deliver: {
        type: 'handoff.submit',
        from: { role: 'executor', id: 'executor-1' },
        payload: { markdown: '# x' },
      },
      fixture: {
        handoffValidateOk: true,
        seats: [{ id: 'executor-1', role: 'executor' }],
      },
      expect: {
        relays: [{ to: 'review-board', type: 'handoff.submit', count: 0 }],
        notices: [{ to: 'executor-1', code: 'handoff_accepted' }],
      },
    },
  });
  assert.equal(r.status, 'pass', `无接收者旅程应 pass，实得 ${r.status}：${r.detail.join('；')}`);
});

test('P1-journey · ⑤主体缺失 ⇒ unsupported（判不了 ≠ 通过）', () => {
  const r = runJourneyCase({
    projectRoot: ROOT,
    file: 'src/router_not_exist.ts',
    journeyCase: {
      deliver: { type: 'handoff.submit', payload: {} },
      expect: {},
    },
  });
  assert.equal(r.status, 'unsupported', `主体缺失必须 unsupported（实得 ${r.status}）`);
});
