/**
 * touches: src/infrastructure/analysis/health/index.ts, src/infrastructure/analysis/health/wiring_ledger.ts, src/infrastructure/analysis/health/wiring_claims.ts, src/infrastructure/analysis/health/wiring_enumerate.ts
 *
 * P1 · **接线账进真实 payload**（从 `p1_wiring_toolface.test.ts` 拆出来的**慢**那一半）。
 *
 * ## 为什么单独立一个文件
 * 实测（2026-11-09）：这个用例 111.3s，而同一文件的另外三条只要 4.4s —— 因为它要跑一次
 * `analyzeHealth(ROOT)`（整仓体检）。拆开之后：
 *   · 改 `src/application/tool_registry.ts` ⇒ 只跑快的那半（~5s，原来 121s）；
 *   · 改**健康分析这一条链**（`health/index.ts` / `wiring_*`）⇒ 本文件仍然跑（它确实受影响）。
 * ★ **不是把慢测试标"跳过"**：`touches:` 写的是它**真正观察的**那几个文件，链一改它就重验。
 *
 * ## 它断言什么（能力判据，不是读数）
 * ④ 真实 payload 暴露接线账：缺省档只有聚合、明细档才给明细；四对象不退化。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/application/tool_registry.ts';
import { analyzeHealth, projectHealthPayload } from '../src/infrastructure/analysis/health/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('④ 真实 payload 暴露接线账（缺省聚合 + detail 明细）；四对象不退化', async () => {
  const rep = await analyzeHealth(ROOT, {});

  // 缺省档：只有聚合层（本仓载荷纪律：明细实测把 payload 顶到 128 KB ⇒ 明细要显式要）
  const agg = projectHealthPayload(rep, { top: 3 });
  assert.ok(agg.wiring_summary, '缺省档必须带 wiring_summary');
  assert.equal(agg.wiring, undefined, '缺省档不带明细');
  const sum = agg.wiring_summary;
  assert.ok(sum.total > 0);
  assert.equal(
    Object.values(sum.by_status).reduce((a, b) => a + b, 0),
    sum.total,
    '各态之和必须等于总条数（分母齐）',
  );
  assert.equal(sum.sources.length, 4, '四类来源都要在 payload 里');
  assert.match(sum.static_only_meaning, /未验证/, 'static-only 的含义必须写明是"未验证"而不是"没接线"');
  for (const s of sum.sources) if (s.status !== 'ok') assert.ok((s.reason ?? '').length > 0, '不可用来源必须带原因');

  // 兼容：原有字段仍在
  for (const k of ['root', 'fileCount', 'score', 'grade', 'summary', 'byKind', 'counts', 'truncation']) {
    assert.ok(k in agg, `原有字段 ${k} 不许丢`);
  }

  // 明细档：四对象结论
  const det = projectHealthPayload(rep, { top: 3, detail: true });
  assert.ok(Array.isArray(det.wiring) && det.wiring.length === sum.total);
  const get = (re) => det.wiring.find((w) => re.test(w.subject));
  assert.equal(get(/#includeComments$/).status, 'connected');
  assert.equal(get(/#deriveJudgements$/).status, 'missing-input');
  assert.equal(get(/^judgement-kind:runtime$/).status, 'connected');
  assert.equal(get(/#BrickContract$/).status, 'reserved-experiment');
});
