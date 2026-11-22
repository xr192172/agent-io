/**
 * ★ P0（DS-1R3 收口）· T-01～T-04 的反例（先红后修）。
 *
 * 复核席点名了本轮最关键的鉴别力问题：**不能再只测手工注入的策略分支**。
 * 因此 T-01/T-02 走真实 `buildEvidenceFrame`（真端口 + 真快照夹具），
 * T-03 用 spy 数影响面调用次数（0 次才成立），T-04 注入**会抛错**的连接。
 *
 * ## 消融（★ 必须能红）
 * · 让 snapshot:no-evidence/empty-observes 绕过全量裁决 ⇒ T1-* 红。
 * · 把 cert: 从判据侧身份里去掉 ⇒ T2 红。
 * · 删掉生产者的 ref-verdict-pending 缺口 ⇒ T3-a 红（这次它跑真生产者）。
 * · 让影响面内部读失败折成空集并返回 ok ⇒ T4-a 红。
 *
 * touches: src/application/scheduling/evidence_frame.ts, src/domain/scheduling_policy.ts,
 *          src/application/scheduling/shadow_scheduler.ts, src/infrastructure/analysis/facts/impact_set.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildEvidenceFrame, type ReadOnlyPorts } from '../src/application/scheduling/evidence_frame.js';
import { planShadow } from '../src/domain/scheduling_policy.js';
import * as evidenceMod from '../src/domain/scheduling_evidence.js';
import { scopeCompatible } from '../src/domain/scheduling_evidence.js';
// ★ T-02 待补的 API：缺失时当场红（不许静默跳过）
const isJudgementRef =
  (evidenceMod as unknown as { isJudgementRef?: (t: string) => boolean }).isJudgementRef ??
  ((): never => {
    throw new Error('isJudgementRef 未实现（T-02 待补）');
  });
import { contentVersion, hashProjectFiles } from '../src/application/design/verified_snapshot.js';
import { impactOfChanged } from '../src/infrastructure/analysis/facts/impact_set.js';
import { createReadOnlyPorts, runShadowScheduler } from '../src/application/scheduling/shadow_scheduler.js';
import { DatabaseSync } from 'node:sqlite';

// ── 夹具：真项目 + 真快照（用于 snapshot:no-evidence / empty-observes） ──────────

function mkProject(opts: { entries: 'empty' | 'blank-observes' }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r3-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ds1r3', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = true;\n');
  const files = hashProjectFiles(root);
  const entries =
    opts.entries === 'empty'
      ? []
      : [
          {
            id: 'test:tests/a.test.mjs',
            kind: 'test',
            verdict: 'pass',
            command: 'node --test tests/a.test.mjs',
            at: '2026-01-01T00:00:00.000Z',
            observes: [],
            symbols: [],
          },
        ];
  fs.writeFileSync(
    path.join(root, '.agent-io', 'verified-snapshot.json'),
    JSON.stringify(
      {
        schema: 1,
        at: '2026-01-01T00:00:00.000Z',
        content: { version: contentVersion(files), files },
        graph: { version: '', bytes: 0, available: false },
        entries,
        scope: { ran: [], inherited: [], undetermined: [] },
      },
      null,
      1,
    ),
  );
  return root;
}

function portsOf(root: string, over: Partial<ReadOnlyPorts> = {}): ReadOnlyPorts {
  const files = hashProjectFiles(root);
  return {
    identity: () => root,
    content: () => ({ ok: true, value: { version: contentVersion(files), files } }),
    designRevisions: () => ({ ok: true, value: { revisions: [{ feature: 'f', revision: 'f#1', source_ref: 'design-sheet:f' }], missingDir: false } }),
    indexFacts: () => ({ state: 'missing', schema_version: null, stale_files: null, stale_total: null, untrusted_refs: null, reason: 'cache.db 不存在' }),
    snapshot: () => {
      const raw = JSON.parse(fs.readFileSync(path.join(root, '.agent-io', 'verified-snapshot.json'), 'utf8'));
      return { status: 'ok', snapshot: raw };
    },
    testObjects: () => ({ ok: true, value: ['tests/a.test.mjs'] }),
    eligibility: () => ({ eligible: ['tests/a.test.mjs'], excluded: [], unjudgeable: [] }),
    judgementRefs: () => ({ ok: true, value: { resolved: [], problems: [] } }),
    impact: () => ({ ok: false, reason: '本用例不提供影响面' }),
    capability: () => ({ runner: 'node-test', tiers: [] }),
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════
// T-01 · snapshot 的三个"需要扩大验证"状态共用同一 scope/widen 裁决
// ══════════════════════════════════════════════════════════════════════

for (const state of ['no-evidence', 'empty-observes'] as const) {
  test(`T1-${state} 真生产者：snapshot:${state} 必须进全量裁决（范围已声明 ⇒ widen，不许直接跑）`, () => {
    const root = mkProject({ entries: state === 'no-evidence' ? 'empty' : 'blank-observes' });
    const frame = buildEvidenceFrame({ root, goal: { scope: ['src/a.mjs'] }, changed: [], ports: portsOf(root) });
    assert.ok(
      frame.gaps.some((g) => g.id === `snapshot:${state}`),
      `前提：真实生产者必须产出 snapshot:${state}（实得 ${frame.gaps.map((g) => g.id).join(',')}）`,
    );
    const plan = planShadow(frame, { budget: 3 });
    assert.equal(
      plan.actions.filter((a) => a.target === 'all-eligible' && a.action === 'run_test').length,
      0,
      `范围已声明时必须走 widen，不许直接跑全量：${JSON.stringify(plan.actions.map((a) => `${a.action}:${a.target}`))}`,
    );
    assert.ok(plan.widen && plan.widen.gaps.includes(`snapshot:${state}`), '必须产生显式 widen 授权需求');
    assert.ok(plan.open_gaps.includes(`snapshot:${state}`), '缺口保持 open');
  });

  test(`T1-${state} 不许把目录 'tests' 当成单个测试对象来建议`, () => {
    const root = mkProject({ entries: state === 'no-evidence' ? 'empty' : 'blank-observes' });
    const frame = buildEvidenceFrame({ root, goal: { scope: ['tests'] }, changed: [], ports: portsOf(root) });
    const plan = planShadow(frame, { budget: 3 });
    assert.equal(
      plan.actions.filter((a) => a.target === 'tests').length,
      0,
      `集合语义不许变成"跑 tests 这个目录"：${JSON.stringify(plan.actions.map((a) => `${a.action}:${a.target}`))}`,
    );
  });
}

test('T1-d 显式允许全量（scope 未声明）且 runner 可用 ⇒ 才允许 all-eligible', () => {
  const root = mkProject({ entries: 'empty' });
  const frame = buildEvidenceFrame({ root, goal: {}, changed: [], ports: portsOf(root) });
  const plan = planShadow(frame, { budget: 3 });
  assert.ok(
    plan.actions.some((a) => a.action === 'run_test' && a.target === 'all-eligible'),
    `未声明范围时按既有语义可给全量：${JSON.stringify(plan.actions.map((a) => `${a.action}:${a.target}`))}`,
  );
});

// ══════════════════════════════════════════════════════════════════════
// T-02 · 判据侧 ref 的身份统一（cert: 也算判据侧，不按文件越界）
// ══════════════════════════════════════════════════════════════════════

test('T2 真实端口（U-03 方案 B）：cert ref 走真实解析器 ⇒ 明确 unsupported，且不生成 run_judgement', () => {
  // ★ 这条**必须走真实 createReadOnlyPorts**：模拟端口曾把 cert 标成 resolved，
  //   而真实解析器返回 malformed ⇒ 策略/生产/测试三头语义不一致（复核席实测）。
  const root = mkProject({ entries: 'empty' });
  fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.agent-io', 'design', 'f.dsl.json'),
    JSON.stringify(
      {
        id: 'imported_f',
        type: 'feature_diagram',
        feature: 'f',
        version: '1.0.0',
        title: 'f',
        source_root: root.replace(/\\/g, '/'),
        _dsl_rev: 3,
        geometry: { nodes: [{ id: 'n1', decision: { expectations: [{ kind: 'run', expect: 'true' }] } }] },
        semantic: { files: [] },
      },
      null,
      1,
    ),
  );
  const ports = createReadOnlyPorts(root, []);
  try {
    const ref = 'cert:unit#3';
    const read = ports.judgementRefs([ref]);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value.resolved.length, 0, `cert 不该被当成已解析：${JSON.stringify(read.value)}`);
    assert.equal(read.value.problems[0].kind, 'unsupported', `必须显式 unsupported（实得 ${JSON.stringify(read.value.problems)}）`);

    const frame = buildEvidenceFrame({ root, goal: { judgement_refs: [ref], scope: ['src/a.mjs'] }, changed: [], ports });
    assert.ok(
      frame.gaps.some((g) => g.id.startsWith('ref:unsupported:') || g.kind === 'unsupported'),
      `cert 不支持必须成缺口：${frame.gaps.map((g) => `${g.id}/${g.kind}`).join(',')}`,
    );
    const plan = planShadow(frame, { budget: 5 });
    assert.equal(
      plan.actions.filter((a) => a.action === 'run_judgement').length,
      0,
      '本期不支持 cert ⇒ 不许建议 run_judgement',
    );
    assert.equal(plan.no_op, false, '不支持的引用不许静默 no-op');

    // decision: ref 走同一条真实端口时必须仍然能解析（不许因修 cert 打坏 decision）
    const ok = ports.judgementRefs(['decision:f:n1#0']);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value.problems, [], `decision ref 必须仍可解析：${JSON.stringify(ok.value)}`);
  } finally {
    ports.close();
  }
});

test('T2-b 判据侧身份是**同一处**判定（decision/cert/design），不是逐个前缀', () => {
  for (const t of ['decision:n1#0', 'cert:unit#3', 'design:f', 'decision:f:n1#2']) {
    assert.equal(isJudgementRef(t), true, `${t} 必须被判据侧身份识别`);
  }
  for (const t of ['src/a.ts', 'tests/a.test.mjs', 'D:/other/repo', 'all-eligible']) {
    assert.equal(isJudgementRef(t), false, `${t} 不是判据侧对象`);
  }
});

test('T2-c 非 ref 的越界规则不变（绝对路径/.. 仍判 out）', () => {
  assert.equal(scopeCompatible(['src/a.ts'], ['tests/a.test.mjs']), false);
});

// ══════════════════════════════════════════════════════════════════════
// T-03 · 测试必须观察真实生产者与调用边界
// ══════════════════════════════════════════════════════════════════════

test('T3-a 真实生产者：resolved ref 由 buildEvidenceFrame 产缺口 ⇒ planShadow 才给 run_judgement', () => {
  const root = mkProject({ entries: 'empty' });
  const ref = 'decision:f:n1#0';
  const frame = buildEvidenceFrame({
    root,
    goal: { judgement_refs: [ref], scope: [] },
    changed: [],
    ports: portsOf(root, {
      judgementRefs: () => ({ ok: true, value: { resolved: [{ ref, feature: 'f', node_id: 'n1', index: 0 }], problems: [] } }),
    }),
  });
  // ★ 生产者必须自己产出这条缺口（删掉生产者 ⇒ 本断言红）
  assert.ok(
    frame.gaps.some((g) => g.id === `ref-verdict-pending:${ref}`),
    `生产者必须产 ref-verdict-pending：${frame.gaps.map((g) => g.id).join(',')}`,
  );
  const plan = planShadow(frame, { budget: 2 });
  assert.equal(plan.no_op, false);
  assert.ok(plan.actions.some((a) => a.action === 'run_judgement'));
  assert.ok(plan.open_gaps.includes(`ref-verdict-pending:${ref}`), '建议未执行 ⇒ 缺口仍 open');
});

test('T3-b 影响面"未被调用"必须用 spy 计数证明（0 次），不是"没有 ok 回执"', () => {
  const root = mkProject({ entries: 'empty' });
  let calls = 0;
  const ports = portsOf(root, {
    indexFacts: () => ({ state: 'unusable', schema_version: 1, stale_files: null, stale_total: null, untrusted_refs: null, reason: '需重建' }),
    impact: () => {
      calls += 1;
      return { ok: false, reason: '不该被调用' };
    },
  });
  const frame = buildEvidenceFrame({ root, goal: {}, changed: ['src/a.mjs'], ports });
  planShadow(frame, { budget: 2 });
  assert.equal(calls, 0, `索引不可用时不许碰影响面（实测调用 ${calls} 次）`);
});

// ══════════════════════════════════════════════════════════════════════
// T-04 · 影响面内部读失败必须 fail-closed
// ══════════════════════════════════════════════════════════════════════

test('T4-a 注入连接查询失败 ⇒ 不许折成空集后继续 ok:true', () => {
  const boom = { prepare: () => { throw new Error('injected: query failed'); } };
  const out = impactOfChanged('/tmp/proj', ['src/a.ts'], { db: boom as never, exists: () => true });
  assert.equal(out.ok, false, `内部读失败必须不可判，实得 ${JSON.stringify(out).slice(0, 160)}`);
});

test('T4-b 索引查询成功但零对象 ⇒ 仍按"改动不在索引"判不可判（区分"零对象"与"查询失败"）', () => {
  const empty = { prepare: () => ({ all: () => [], get: () => undefined }) };
  const out = impactOfChanged('/tmp/proj', ['src/a.ts'], {
    db: empty as never,
    exists: () => true,
    impactFn: (() => ({ has_call_edges: true, impacted_files: [], impacted_symbols: [] })) as never,
  });
  assert.equal(out.ok, false, 'src/ 改动不在索引里 ⇒ 影响不可信（不许 ok:true + 空集）');
});

test('T4-c 探测抛错 ⇒ 不可判且不向外崩（连接不泄漏，状态如实降级）', () => {
  // 形状闸只看 files.id + unresolved_refs.resolved_node_id + 版本 ⇒ 通过；
  // 但 files 缺 size/modified_at ⇒ detectStaleIndex 的查询会抛 ⇒ 必须降级成 unavailable。
  const root = mkdtemp();
  const db = new DatabaseSync(path.join(root, '.agent-io', 'cache.db'));
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec("INSERT INTO schema_versions VALUES (18, 0, 'fixture')");
  db.exec('CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT)'); // ← 缺 size/modified_at
  db.exec("INSERT INTO files VALUES (1, 'src/a.mjs')");
  db.exec('CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, file_id INTEGER, reference_name TEXT, resolved_node_id TEXT)');
  db.close();

  const out = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 1 });
  assert.equal(out.frame.index.state, 'unavailable', `探测抛错必须判 unavailable（实得 ${out.frame.index.state}）`);
  assert.ok(out.frame.gaps.some((g) => g.id.startsWith('index:')), '必须形成明确缺口');
  assert.ok(!out.receipts.some((r) => r.port === 'impact' && r.status === 'ok'), '不许成功调用影响面');
});

function mkdtemp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r3-c-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ds1r3c', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  return root;
}
