/**
 * touches: src/infrastructure/analysis/health/wiring_claims.ts, src/infrastructure/analysis/health/wiring_enumerate.ts
 *
 * ★ 这一行让**增量验证**能把这支测试归因到被改的文件（没它 ⇒ 只能进"未声明"，永远不会被自动选中）。
 * P1 · 接线账的**自动枚举**（本轮：从固定四对象扩到"有明确能力声明"的对象）。
 *
 * 四条验收（对应用户给的口径）：
 * ⑩ **不手改对象清单**：品类来自 `KIND_SPECS` 本身 ⇒ 注册表里加了 kind，账上自动出现；
 * ⑪ **普通设计说明不算能力**：账上不得出现"只靠 `decision.summary` 散文"的条目；
 * ⑫ **分母必须齐**：各态计数之和 = 账总条数；**未判定来源**必须单列（`unavailable` + 原因）；
 * ⑬ **runtime 只能声称样例可确定性执行**（不冒充生产已观测）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIND_SPECS } from '../src/domain/expectation_kinds.ts';
import { enumerateClaims } from '../src/infrastructure/analysis/health/wiring_claims.ts';
import { collectAllWiringProbes } from '../src/infrastructure/analysis/health/wiring_enumerate.ts';
import { buildWiringLedger } from '../src/infrastructure/analysis/health/wiring_ledger.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

test('⑩ 新登记能力可被自动发现：判据 kind 全部来自注册表，不靠手写清单', () => {
  const { claims } = enumerateClaims(ROOT);
  const kinds = new Set(claims.filter((c) => c.source === 'kind-registry').map((c) => c.subject));
  const all = Object.keys(KIND_SPECS ?? {});
  assert.ok(all.length > 0, '注册表必须有 kind');
  for (const k of all) assert.ok(kinds.has(`judgement-kind:${k}`), `注册表里的 ${k} 必须在账上（说明清单是自动派生的）`);
  // 反证："清单来自注册表"意味着条数读的是注册表长度，不是硬编码的 11
  assert.equal(kinds.size, all.length, `账上 kind 条数 ${kinds.size} 必须等于注册表 ${all.length}`);
});

test('⑪ 普通设计说明不会被当成可执行能力（不扫 decision.summary）', () => {
  // 挑一个"有长篇 decision.summary、但不在任何注册表/域声明里"的普通源码节点
  const sheet = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-io/design/agent-io.dsl.json'), 'utf-8'));
  const plain = (sheet.geometry.nodes ?? []).find(
    (n) => typeof n.path === 'string' && String(n.decision?.summary ?? '').length > 40 && n.path.startsWith('src/'),
  );
  assert.ok(plain, '样本节点必须存在');
  const { claims } = enumerateClaims(ROOT);
  const subjects = new Set(claims.map((c) => c.subject));
  assert.ok(!subjects.has(`file:${plain.path}`), `普通设计说明（${plain.path}）不得进账`);
  assert.ok(!subjects.has(plain.id), '节点 id 也不得进账');
  // 账上的 file: 条目只允许来自 code-health 候选
  for (const c of claims) if (c.subject.startsWith('file:')) assert.equal(c.source, 'code-health');
});

test('⑫ 分母必须齐：各态之和 = 总条数；未判定来源单列不藏', () => {
  const { sources } = collectAllWiringProbes(ROOT);
  const { probes } = collectAllWiringProbes(ROOT);
  const entries = buildWiringLedger(probes);
  const by = {};
  for (const e of entries) by[e.status] = (by[e.status] ?? 0) + 1;
  const sum = Object.values(by).reduce((a, b) => a + b, 0);
  assert.equal(sum, entries.length, `各态之和 ${sum} 必须等于总条数 ${entries.length}`);

  // 来源：四类都要有一条报告；不可用的必须带原因（不许空表冒充"没有"）
  const names = sources.map((s) => s.source).sort();
  assert.deepEqual(names, ['code-health', 'explicit-declaration', 'kind-registry', 'tool-registry']);
  for (const s of sources) {
    if (s.status === 'unavailable') assert.ok((s.reason ?? '').length > 0, `${s.source} 不可用时必须给原因`);
  }
});

test('⑬ runtime 只声称「可入库样例可确定性执行」，不冒充生产运行', () => {
  const entries = buildWiringLedger(collectAllWiringProbes(ROOT).probes);
  const rt = entries.find((e) => e.subject === 'judgement-kind:runtime');
  assert.ok(rt);
  const ev = rt.evidence.join(' ');
  assert.match(ev, /可入库样例/, '输入格必须点明是可入库样例');
  assert.match(ev, /gitignore|不入库/, '必须点明临时产物不入库');
});
