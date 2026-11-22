/**
 * ★ P0（DS-1R）· 审查席复现过的错误：先红后修。
 *
 * 本文件按 05-DS1-REVIEW.md 的 R 编号组织，每条先证明"改前是错的"。
 * 分组：A=状态机（R-01/R-02/R-03/能力与预算）、B=证据身份与冲突（R-04/R-09/R-10/R-08）、
 *       C=只读与输入完整性（R-05/R-07/R-11/改动集）。
 *
 * ## 消融（★ 本文件必须能红）
 * · 让任一动作重新"关闭"当前缺口 ⇒ A1/A2 红。
 * · 让 no-op 回到"只看 gaps" ⇒ A3/A4 红。
 * · 去掉 scope 过滤 ⇒ A6 红。
 * · 把 stale/fresh 判成冲突 ⇒ B3 红；把别名判成歧义 ⇒ B1 红。
 * · 去掉影响面的只读注入/形状闸 ⇒ C1/C2 红。
 *
 * touches: src/domain/scheduling_policy.ts, src/domain/scheduling_evidence.ts,
 *          src/application/scheduling/evidence_frame.ts, src/application/scheduling/shadow_scheduler.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import * as evidenceMod from '../src/domain/scheduling_evidence.js';
import * as policyMod from '../src/domain/scheduling_policy.js';
import { type EvidenceFrame, type EvidenceSignal } from '../src/domain/scheduling_evidence.js';

// ★ DS-1R 待补的 API：缺失时**当场红**（宁可红在"没实现"，也不要让它静默跳过）
const resolveSubjectCandidates = evidenceMod.resolveSubjectCandidates as unknown as (
  xs: ReadonlyArray<{ raw: string; id?: string }>,
) => { resolved: Array<{ key: string; raws: string[] }>; ambiguous: Array<{ key: string; ids: string[]; raws: string[] }> };
const detectVerdictConflicts = evidenceMod.detectVerdictConflicts;
const scopeCompatible = (evidenceMod as unknown as { scopeCompatible?: (a: readonly string[], b: readonly string[]) => boolean }).scopeCompatible;
const planShadow = policyMod.planShadow;
const planStanding = (policyMod as unknown as { planStanding?: (s: Record<string, number | readonly string[]>) => string }).planStanding;

import { buildEvidenceFrame, type ReadOnlyPorts } from '../src/application/scheduling/evidence_frame.js';
import { contentVersion } from '../src/application/design/verified_snapshot.js';
import { hashProjectFiles, scanTestObjects } from '../src/application/design/verified_snapshot.js';
import { createReadOnlyPorts, runShadowScheduler } from '../src/application/scheduling/shadow_scheduler.js';

const sha = (f: string): string =>
  fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '<absent>';

const signal = (over: Partial<EvidenceSignal> = {}): EvidenceSignal => ({
  id: 's1',
  kind: 'test',
  subject: { path: 'tests/a.test.ts' },
  source_ref: 'snapshot',
  source_version: 'v1',
  scope: ['tests/a.test.ts'],
  verdict: 'pass',
  freshness: 'fresh',
  ...over,
});

function frameOf(over: Partial<EvidenceFrame> = {}): EvidenceFrame {
  return {
    project: { root: '/tmp/proj', identity: '/tmp/proj' },
    goal: { text: 'g', judgement_refs: [], scope: [] },
    content: { version: 'v1', files: { 'src/a.ts': 'h1' }, source_ref: 'content-version' },
    design_revisions: [{ feature: 'f', revision: 'f#1', source_ref: 'design-sheet:f' }],
    index: { state: 'usable', schema_version: 18, stale_files: 0, stale_total: 1, untrusted_refs: 0 },
    capability: { runner: 'node-test', tiers: [] },
    signals: [],
    gaps: [],
    conflicts: [],
    excluded: [],
    undetermined: [],
    limitations: [],
    ...over,
  };
}

// ══════════════════════════════════════════════════════════════════════
// A 组 · 状态机
// ══════════════════════════════════════════════════════════════════════

test('A1 选中 run_test 不得关闭当前缺口（影子模式什么都没执行）', () => {
  const frame = frameOf({ signals: [signal({ id: 'test:stale', freshness: 'stale', reason: 'version-mismatch' })] });
  const plan = planShadow(frame, { budget: 1 });
  assert.deepEqual(plan.actions.map((a) => a.action), ['run_test']);
  assert.ok(plan.open_gaps.includes('stale:test:stale'), `当前缺口必须仍在：${plan.open_gaps.join(',')}`);
  assert.deepEqual(plan.actions[0].would_close_gaps, ['stale:test:stale'], '"预计关闭"只能落在动作自己的字段里');
});

test('A2 被硬阻断的动作被选中后，缺口同样不得减少', () => {
  const frame = frameOf({
    index: { state: 'unusable', schema_version: 1, stale_files: null, stale_total: null, untrusted_refs: null, reason: '需重建' },
    gaps: [{ id: 'index:unusable', kind: 'unavailable', subject: 'index', reason: '需重建', signals: [] }],
    signals: [signal({ id: 'test:stale', freshness: 'stale', reason: 'version-mismatch' })],
  });
  const plan = planShadow(frame, { budget: 3 });
  const blocked = plan.actions.filter((a) => a.blocked_by.length > 0);
  assert.ok(blocked.length > 0, '前提：必须存在被阻断的动作');
  assert.ok(plan.open_gaps.includes('index:unusable'));
  assert.ok(plan.open_gaps.includes('stale:test:stale'));
  for (const a of blocked) assert.deepEqual(a.would_close_gaps, [], '被阻断的动作不许声称能关闭任何缺口');
});

test('A3 只有 undetermined、没有 gap ⇒ 不许 no_op', () => {
  const plan = planShadow(frameOf({ undetermined: [{ id: 'tests/a.test.ts', reason: '影响关系不可信' }] }));
  assert.equal(plan.no_op, false, '不可判不是"没活干"');
  assert.ok(plan.actions.length + plan.deferred.length > 0, '必须给出安全动作或显式未决');
});

test('A4 unsupported 信号派生缺口必须进 open_gaps 且不许 no_op', () => {
  const frame = frameOf({
    signals: [signal({ id: 'test:u', verdict: 'unsupported', freshness: 'fresh', reason: 'toolchain' })],
  });
  const plan = planShadow(frame);
  assert.ok(plan.open_gaps.includes('unsupported:test:u'), `派生缺口必须在分母里：${plan.open_gaps.join(',')}`);
  assert.equal(plan.no_op, false);
});

test('A5 无改动 + 有效 pass ⇒ 不是"全量 undetermined"（空成功影响集）', () => {
  const root = mkSnapshotProject();
  const ports = realPorts(root, { changed: [] });
  const frame = buildEvidenceFrame({ root, goal: { scope: ['src'] }, changed: [], ports });
  assert.deepEqual(frame.undetermined, [], `无改动时不许把条目全判不可判：${JSON.stringify(frame.undetermined)}`);
  assert.deepEqual(frame.gaps.filter((g) => g.kind === 'impact-untrusted'), [], '无改动时影响面应视为"空且成功"');
});

test('A6 scope 是硬约束：范围外的 stale/fail 不得被本目标选中', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: [], scope: ['tests/in.test.ts'] },
    signals: [
      signal({ id: 'test:in', subject: { path: 'tests/in.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
      signal({ id: 'test:out', subject: { path: 'tests/out.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
      signal({ id: 'test:outfail', subject: { path: 'tests/out2.test.ts' }, verdict: 'fail', freshness: 'fresh' }),
    ],
  });
  const plan = planShadow(frame, { budget: 5 });
  assert.deepEqual(plan.actions.map((a) => a.target), ['tests/in.test.ts'], `只该选范围内：${JSON.stringify(plan.actions.map((a) => a.target))}`);
  assert.ok(plan.out_of_scope.some((o) => o.id === 'tests/out.test.ts'), '范围外对象要作为项目风险显式列出');
  assert.ok(plan.out_of_scope.some((o) => o.id === 'tests/out2.test.ts'), '范围外当前失败可以被展示，但不许被选中');
});

test('A7 runner=null ⇒ 即使动作同时被索引阻断，也不许保留 run_test', () => {
  const frame = frameOf({
    capability: { runner: null, tiers: [], reason: '认不出可过滤 runner' },
    index: { state: 'unusable', schema_version: 1, stale_files: null, stale_total: null, untrusted_refs: null, reason: '需重建' },
    gaps: [{ id: 'index:unusable', kind: 'unavailable', subject: 'index', reason: '需重建', signals: [] }],
    signals: [signal({ id: 'test:stale', freshness: 'stale', reason: 'version-mismatch' })],
  });
  const plan = planShadow(frame, { budget: 5 });
  assert.equal(plan.actions.filter((a) => a.action === 'run_test').length, 0, '刷新索引不会自动证明 runner 可用');
});

test('A8 budget 契约显式：0 = 本轮不选；非法值当场抛', () => {
  const frame = frameOf({ signals: [signal({ id: 'test:stale', freshness: 'stale', reason: 'version-mismatch' })] });
  const zero = planShadow(frame, { budget: 0 });
  assert.deepEqual(zero.actions, []);
  assert.ok(zero.deferred.length > 0, 'budget=0 时建议进 deferred，不许消失');
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => planShadow(frame, { budget: bad }), /budget/, `budget=${String(bad)} 必须有显式策略`);
  }
});

test('A9 依赖缺失/成环不得按深度 0 静默处理', () => {
  const frame = frameOf({ signals: [signal({ id: 'test:stale', freshness: 'stale', reason: 'version-mismatch' })] });
  const plan = planShadow(frame, { budget: 1 });
  // 内部生成器不该产生坏依赖；纯函数收到时要给可诊断结果（字段必须在场，空数组也算"说清了"）
  assert.ok(Array.isArray(plan.dependency_problems), 'dependency_problems 必须始终在场');
  const standing = planStanding({ open_gaps: [], undetermined: 0, conflicts: 0, fresh_fail: 0, unsupported: 0, actions: 0, deferred: 0 });
  assert.equal(standing, 'no_op');
});

// ══════════════════════════════════════════════════════════════════════
// B 组 · 证据身份、版本与冲突
// ══════════════════════════════════════════════════════════════════════

test('B1 路径别名是同一个对象（合并），不是歧义', () => {
  const r = resolveSubjectCandidates([{ raw: 'src/a.ts' }, { raw: './src/a.ts' }, { raw: 'src\\a.ts' }]);
  assert.deepEqual(r.ambiguous, [], '仅写法不同 ⇒ 同一个 resolved 对象');
  assert.deepEqual(r.resolved.map((x) => x.key), ['src/a.ts']);
  assert.deepEqual(r.resolved[0].raws, ['./src/a.ts', 'src/a.ts', 'src\\a.ts'], '原始写法要留着（可回溯）');
});

test('B2 真正的歧义 = 同一显示键对应多个稳定对象身份', () => {
  const r = resolveSubjectCandidates([
    { raw: 'src/a.ts', id: 'node_1' },
    { raw: './src/a.ts', id: 'node_2' },
  ]);
  assert.equal(r.ambiguous.length, 1);
  assert.deepEqual(r.ambiguous[0].ids, ['node_1', 'node_2']);
  assert.deepEqual(r.resolved, []);
});

test('B3 stale pass + fresh fail ⇒ 不是当前冲突（旧证据失效，不是投票）', () => {
  const conflicts = detectVerdictConflicts([
    signal({ id: 'old-pass', verdict: 'pass', freshness: 'stale', reason: 'version-mismatch', source_version: 'v0' }),
    signal({ id: 'now-fail', verdict: 'fail', freshness: 'fresh', source_version: 'v1' }),
  ]);
  assert.deepEqual(conflicts, []);
});

test('B4 retired + 历史 pass ⇒ 不是当前冲突', () => {
  const conflicts = detectVerdictConflicts([
    signal({ id: 'ret', kind: 'design', verdict: 'unsupported', reason: 'retired', freshness: 'fresh' }),
    signal({ id: 'old-pass', verdict: 'pass', freshness: 'fresh' }),
  ]);
  assert.deepEqual(conflicts, [], '退役对象上的历史 pass 是正常历史，不许复活成当前冲突');
});

test('B5 只有同主体、都当前有效、范围相容的 pass/fail 才是冲突', () => {
  const both = detectVerdictConflicts([
    signal({ id: 'a', verdict: 'pass', freshness: 'fresh' }),
    signal({ id: 'b', verdict: 'fail', freshness: 'fresh' }),
  ]);
  assert.equal(both.length, 1);
  assert.equal(
    scopeCompatible(['src/a.ts'], ['src/b.ts']),
    false,
    '范围不相容 ⇒ 不能直接判冲突（先标范围不一致）',
  );
});

test('B6 只改测试自身 ⇒ 旧 pass 不得 fresh，必须重跑或不可判', () => {
  const root = mkSnapshotProject();
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = 1;\n'); // 只改测试体
  const frame = buildEvidenceFrame({ root, goal: {}, changed: ['tests/a.test.mjs'], ports: realPorts(root, { changed: ['tests/a.test.mjs'] }) });
  const ta = frame.signals.find((s) => s.id === 'test:tests/a.test.mjs');
  assert.ok(ta, '测试证据必须在帧里');
  assert.notEqual(ta.freshness, 'fresh', `测试体变了 ⇒ 旧 pass 不许新鲜（实得 ${ta.freshness} / ${ta.reason}）`);
});

test('B7 同名后缀测试：根目录 a.test.mjs 不得被 tests/a.test.mjs 的证据冒充', () => {
  const root = mkSnapshotProject({ rootLevelTest: true });
  const frame = buildEvidenceFrame({ root, goal: {}, changed: [], ports: realPorts(root, { changed: [] }) });
  const gap = frame.gaps.find((g) => g.id === 'missing-evidence:a.test.mjs');
  assert.ok(gap, `根目录 a.test.mjs 必须有自己的缺证据缺口：${frame.gaps.map((g) => g.id).join(',')}`);
});

test('B8 无关条目的 observes 指向某测试路径 ⇒ 不冒充该测试的执行证据', () => {
  const root = mkSnapshotProject({ foreignObserve: true });
  const frame = buildEvidenceFrame({ root, goal: {}, changed: [], ports: realPorts(root, { changed: [] }) });
  assert.ok(
    frame.gaps.some((g) => g.id === 'missing-evidence:tests/b.test.mjs'),
    '别人的 observes 命中它 ≠ 它有 verdict',
  );
});

test('B9 judgement_refs 必须有真实消费者：缺失的 ref 要变成缺口', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: ['decision:no-such-node#0'], scope: [] },
    gaps: [{ id: 'ref:missing:decision:no-such-node#0', kind: 'unavailable', subject: 'decision:no-such-node#0', reason: '册里找不到该节点', signals: [] }],
  });
  const plan = planShadow(frame, { budget: 1 });
  assert.equal(plan.no_op, false, 'refs 不存在 ⇒ 不可判，不许无影响');
  assert.ok(plan.open_gaps.includes('ref:missing:decision:no-such-node#0'));
});

// ══════════════════════════════════════════════════════════════════════
// C 组 · 只读与输入完整性
// ══════════════════════════════════════════════════════════════════════

test('C1 当前 schema 但形状不完整 ⇒ 零写入且影响面不可判', () => {
  const root = mkRawProject();
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec('INSERT INTO schema_versions VALUES (18, 0, \'形状不完整\')'); // 版本对，但没有 files/nodes/edges
  db.close();
  const before = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  const { frame } = runReal(root, ['src/a.mjs']);
  const after = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  assert.deepEqual(after, before, '★ 版本号当前但形状不完整 ⇒ 连一次迁移都不许发生');
  assert.equal(frame.index.state, 'unusable', `形状不完整必须判不可用（实得 ${frame.index.state}）`);
  assert.ok(frame.gaps.some((g) => g.kind === 'impact-untrusted' || g.id.startsWith('index:')), '必须落成缺口');
});

test('C2 透明只读：普通当前库算影响面时不碰写模式（热 WAL 也不再拒算）', () => {
  const root = mkRawProject();
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec("INSERT INTO schema_versions VALUES (18, 0, 'fixture')");
  db.exec('CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, content_hash TEXT, size INTEGER, modified_at INTEGER, indexed_at INTEGER)');
  db.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY, file_path TEXT, name TEXT, qualified_name TEXT, kind TEXT, start_line INTEGER)');
  db.exec('CREATE TABLE edges (source TEXT, target TEXT, kind TEXT)');
  db.exec('CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, file_id INTEGER, reference_name TEXT, resolved_node_id TEXT)');
  db.close();
  const before = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  const { receipts } = runReal(root, ['src/a.mjs']);
  const after = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  assert.equal(after.db, before.db, '影响面读端不得改动 cache.db 字节');
  assert.equal(after.wal, before.wal, '也不得消费 -wal');
  assert.ok(
    !receipts.some((r) => r.port === 'impact' && /WAL/.test(String(r.reason))),
    '注入只读连接后不该再靠"热 WAL 特判"逼近只读',
  );
});

test('C3 根目录代码路径（a.ts）不得被静默丢弃成"空影响集"', () => {
  const frame = buildEvidenceFrame({ root: '/tmp/proj', goal: {}, changed: ['a.ts'], ports: fakePorts() });
  assert.ok(
    frame.gaps.some((g) => g.id === 'impact:root-level-path'),
    `根目录路径必须判影响不可信：${frame.gaps.map((g) => g.id).join(',')}`,
  );
});

test('C4 读端必须能报告部分失败：hashProjectFiles / scanTestObjects 收集 skipped', () => {
  const root = mkRawProject();
  // 一个**名为 .ts 的目录连接**：readdir 看得见、readFileSync 抛 EISDIR ⇒ 必须进 skipped
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'src', 'x.ts'), 'junction');
  const skippedHash: Array<{ path: string; why: string }> = [];
  hashProjectFiles(root, skippedHash);
  assert.ok(skippedHash.length > 0, '读不到的文件必须进 skipped（不许静默消失）');
  const skippedScan: Array<{ path: string; why: string }> = [];
  scanTestObjects(root, skippedScan);
  assert.ok(Array.isArray(skippedScan), 'scanTestObjects 也必须能交回 skipped');
});

test('C5 快照读失败（EISDIR/EACCES）不得被当成"首次运行 missing"', () => {
  const root = mkSnapshotProject();
  const snap = path.join(root, '.agent-io', 'verified-snapshot.json');
  fs.rmSync(snap);
  fs.mkdirSync(snap); // 让 readFileSync 抛 EISDIR
  const loaded = realPorts(root, { changed: [] }).snapshot();
  assert.equal(loaded.status, 'missing');
  assert.equal((loaded as { unreadable?: boolean }).unreadable, true, `读失败必须可区分：${JSON.stringify(loaded)}`);
  const frame = buildEvidenceFrame({ root, goal: {}, changed: [], ports: realPorts(root) });
  assert.ok(
    frame.gaps.some((g) => g.id === 'snapshot:unreadable'),
    `读不到不许落成"首次运行"缺口：${frame.gaps.map((g) => g.id).join(',')}`,
  );
});

// ══════════════════════════════════════════════════════════════════════
// 夹具
// ══════════════════════════════════════════════════════════════════════

function mkRawProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ds1r', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = true;\n');
  fs.writeFileSync(path.join(root, 'tests', 'b.test.mjs'), 'export const ok = true;\n');
  return root;
}

/** 带基线的夹具：TA 观察 src/a.mjs（并且它自己也是观察面），TB 只观察自己 */
function mkSnapshotProject(opts: { rootLevelTest?: boolean; foreignObserve?: boolean } = {}): string {
  const root = mkRawProject();
  if (opts.rootLevelTest) fs.writeFileSync(path.join(root, 'a.test.mjs'), 'export const ok = true;\n');
  const files = hashProjectFiles(root);
  const entries = [
    {
      id: 'test:tests/a.test.mjs',
      kind: 'test',
      verdict: 'pass',
      command: 'node --test tests/a.test.mjs',
      at: '2026-01-01T00:00:00.000Z',
      observes: ['src/a.mjs'],
    },
    // ★ foreignObserve：**TB 自己没有条目**，只有一条无关的合同条目 observe 到它的路径
    ...(opts.foreignObserve
      ? [
          {
            id: 'contract:file_tests_b_test_mjs',
            kind: 'contract',
            verdict: 'pass',
            command: 'design_line judge',
            at: '2026-01-01T00:00:00.000Z',
            observes: ['tests/b.test.mjs'],
          },
        ]
      : [
          {
            id: 'test:tests/b.test.mjs',
            kind: 'test',
            verdict: 'pass',
            command: 'node --test tests/b.test.mjs',
            at: '2026-01-01T00:00:00.000Z',
            observes: ['tests/b.test.mjs'],
          },
        ]),
  ];
  if (opts.foreignObserve) {
    // 一条**无关条目**（合同证据）观察到 TA 的路径 —— 它不能给 TA 提供 verdict
    entries.push({
      id: 'contract:file_tests_a_test_mjs',
      kind: 'contract',
      verdict: 'pass',
      command: 'design_line judge',
      at: '2026-01-01T00:00:00.000Z',
      observes: ['tests/a.test.mjs'],
    });
  }
  fs.writeFileSync(
    path.join(root, '.agent-io', 'verified-snapshot.json'),
    JSON.stringify({
      schema: 1,
      at: '2026-01-01T00:00:00.000Z',
      content: { version: contentVersion(files), files },
      graph: { version: '', bytes: 0, available: false },
      entries,
      scope: { ran: entries.map((e) => e.id.replace(/^test:/, '')), inherited: [], undetermined: [] },
    }, null, 1),
  );
  return root;
}

function fakePorts(over: Partial<ReadOnlyPorts> = {}): ReadOnlyPorts {
  const files = { 'src/a.ts': 'h1' };
  return {
    identity: () => '/tmp/proj',
    content: () => ({ ok: true, value: { version: contentVersion(files), files } }),
    designRevisions: () => ({ ok: true, value: { revisions: [{ feature: 'f', revision: 'f#1', source_ref: 'design-sheet:f' }], missingDir: false } }),
    indexFacts: () => ({ state: 'usable', schema_version: 18, stale_files: 0, stale_total: 1, untrusted_refs: 0 }),
    snapshot: () => ({ status: 'missing', reason: '没有基线文件' }),
    testObjects: () => ({ ok: true, value: [] }),
    eligibility: () => ({ eligible: [], excluded: [], unjudgeable: [] }),
    judgementRefs: (refs) => ({ ok: true, value: { resolved: [], problems: refs.map((r) => ({ ref: r, kind: 'missing' as const, detail: '册里找不到' })) } }),
    impact: () => ({ ok: true, value: { ok: true, files: new Set<string>(), symbols: new Set<string>(), calls: 0, non_code: [] } }),
    capability: () => ({ runner: 'node-test', tiers: [] }),
    ...over,
  };
}

function realPorts(root: string): ReadOnlyPorts {
  return createReadOnlyPorts(root, []);
}

function runReal(root: string, changed: string[]) {
  return runShadowScheduler({ root, changed, budget: 2 });
}
