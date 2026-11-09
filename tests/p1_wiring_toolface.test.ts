/**
 * touches: src/application/tool_registry.ts, src/infrastructure/analysis/health/wiring_claims.ts, src/infrastructure/analysis/health/wiring_enumerate.ts, src/infrastructure/analysis/health/wiring_ledger.ts
 *
 * ★ 2026-11-09 拆分：原来还观察 `health/index.ts`，其中「真实 payload」那条实测 111.3s
 *   （要跑一次整仓 `analyzeHealth`）⇒ 已搬到 `p1_wiring_payload.test.ts`。
 *   本文件只保留「注册表 → 账本」侧，实测 ~4.4s（原来整份 121.6s）。
 *
 * ★ 这一行让**增量验证**能把这支测试归因到被改的文件（没它 ⇒ 只能进"未声明"，永远不会被自动选中）。
 * P1 · 接线账接入**真实工具面**（本轮：工具注册表 + payload 透传）。
 *
 * 四条验收：
 * ① `tool-registry` 不再 `unavailable`，且条数**等于**注册表长度（**不写死 43**）；
 * ② 增/减一个注册项 ⇒ 账上对应条目**自动出现/消失**（清单是派生的，不是抄的）；
 * ③ 工具条目落 `static-only`（= 静态证据齐全、**未验证真实执行**），且 evidence 说得清；
 * ④ `projectHealthPayload` 的真实返回里能看到 `wiring` / `wiring_sources`（且四对象不退化）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★ 先加载真实工具面（= 生产路径上的初始化），再读接线账
import '../src/application/tool_registry.ts';
import { listToolDefs } from '../src/application/meta/registry/capability_map.ts';
import { bindToolDefsForWiring } from '../src/infrastructure/analysis/health/wiring_claims.ts';
import { collectAllWiringProbes } from '../src/infrastructure/analysis/health/wiring_enumerate.ts';
import { buildWiringLedger } from '../src/infrastructure/analysis/health/wiring_ledger.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const ledger = () => buildWiringLedger(collectAllWiringProbes(ROOT).probes);
const toolsOf = (l) => l.filter((w) => w.subject.startsWith('tool:'));

test('① tool-registry 不再 unavailable，条数等于注册表长度（不写死数量）', () => {
  const { sources } = collectAllWiringProbes(ROOT);
  const tr = sources.find((s) => s.source === 'tool-registry');
  assert.ok(tr, '必须有 tool-registry 这一条来源报告');
  assert.equal(tr.status, 'ok', `tool-registry 应可用，实得 ${tr.status}（${tr.reason ?? ''}）`);
  // ★ 分母来自注册表本身：注册表变了这条断言自动跟着变
  assert.equal(tr.claims, listToolDefs().length, '账上工具条数必须等于 listToolDefs() 的长度');
  assert.equal(toolsOf(ledger()).length, listToolDefs().length);
});

test('② 增/减注册项 ⇒ 账上条目自动出现/消失', () => {
  const original = listToolDefs().map((d) => ({ name: d.name, description: d.description }));
  assert.ok(original.length > 0, '前置：注册表非空');

  try {
    // 减一个
    bindToolDefsForWiring(original.slice(1));
    const after = toolsOf(ledger());
    assert.equal(after.length, original.length - 1, '摘掉一个注册项后账上应少一条');
    assert.ok(!after.some((w) => w.subject === `tool:${original[0].name}`), '被摘掉的那条必须消失');

    // 加一个（凭空造一个注册项）
    bindToolDefsForWiring([...original, { name: '__wiring_probe_tool__', description: '临时探针' }]);
    const added = toolsOf(ledger());
    assert.ok(added.some((w) => w.subject === 'tool:__wiring_probe_tool__'), '新增的注册项必须自动出现');
    assert.equal(added.length, original.length + 1);
  } finally {
    bindToolDefsForWiring(original); // 还原，避免污染其它用例
  }
});

test('③ 工具条目落 static-only，并说清"未验证真实执行"（不是"没接线"）', () => {
  const tools = toolsOf(ledger());
  assert.ok(tools.length > 0);
  for (const t of tools) {
    assert.equal(t.status, 'static-only', `${t.subject} 应 static-only，实得 ${t.status}`);
    assert.equal(t.broken_at, 'execution');
    const ev = t.evidence.join(' ');
    assert.match(ev, /无运行读数/, 'evidence 必须点明没有运行读数');
    assert.match(String(t.next_action), /没有运行记录 ≠ 没有价值/);
  }
});
