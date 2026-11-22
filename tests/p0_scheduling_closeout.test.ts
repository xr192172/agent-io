/**
 * ★ P0（DS-1R2 收尾）· 复核席 S-01～S-04 + R-06 的反例（先红后修）。
 *
 * 每条都对应 07-DS1R-REVIEW 的编号；夹具尽量走**真实读端**（createReadOnlyPorts / runShadowScheduler），
 * 只有"计划语义"才用注入帧。
 *
 * ## 消融（★ 必须能红）
 * · 让 snapshot/其他入口绕过 scope 裁决 ⇒ S1 红。
 * · 让 resolved ref 不产生未决缺口 ⇒ S2 红。
 * · 让 stale-ref 查询失败仍判 usable ⇒ S3 红。
 * · 让 budget=0 仍强制选动作 ⇒ S4 红。
 *
 * touches: src/domain/scheduling_policy.ts, src/application/scheduling/evidence_frame.ts,
 *          src/application/scheduling/shadow_scheduler.ts, scripts/schedule-shadow.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { planShadow } from '../src/domain/scheduling_policy.js';
import { buildEvidenceFrame, type ReadOnlyPorts } from '../src/application/scheduling/evidence_frame.js';
import { createReadOnlyPorts, runShadowScheduler } from '../src/application/scheduling/shadow_scheduler.js';
import { contentVersion } from '../src/application/design/verified_snapshot.js';
import type { EvidenceFrame, EvidenceSignal } from '../src/domain/scheduling_evidence.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const sha = (f: string): string =>
  fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '<absent>';

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

const sig = (over: Partial<EvidenceSignal> = {}): EvidenceSignal => ({
  id: 'ref:decision:f:n1#0',
  kind: 'design',
  subject: { judgement_ref: 'decision:f:n1#0' },
  source_ref: 'design-sheet:f',
  scope: ['design:f'],
  verdict: 'unknown',
  freshness: 'fresh',
  ...over,
});

// ══════════════════════════════════════════════════════════════════════
// S-01 · 所有"全量/扩大验证"入口共用 scope 裁决
// ══════════════════════════════════════════════════════════════════════

test('S1-a 仅 snapshot:missing + 明确小 scope ⇒ 不出现可执行 all-eligible，widen 非空', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: [], scope: ['tests/in.test.ts'] },
    gaps: [{ id: 'snapshot:missing', kind: 'missing', subject: 'snapshot', reason: '没有基线文件', signals: [] }],
  });
  const plan = planShadow(frame, { budget: 3 });
  assert.equal(
    plan.actions.filter((a) => a.target === 'all-eligible' && a.action === 'run_test').length,
    0,
    `越界不许生成可执行全量：${JSON.stringify(plan.actions.map((a) => `${a.action}:${a.target}`))}`,
  );
  assert.ok(plan.widen && plan.widen.gaps.includes('snapshot:missing'), '必须给出显式 widen 授权需求');
  assert.ok(plan.actions.some((a) => a.action === 'ask_human' && a.target === 'widen-verification'), '并给出安全裁决动作');
  assert.ok(plan.open_gaps.includes('snapshot:missing'), '缺口保持 open');
});

test('S1-b snapshot:unreadable/corrupt 不得被当成"可以全跑"的普通 missing', () => {
  for (const [id, kind] of [['snapshot:unreadable', 'unavailable'], ['snapshot:corrupt', 'conflicting']] as const) {
    const frame = frameOf({
      gaps: [{ id, kind, subject: 'snapshot', reason: '读不到/坏了', signals: [] }],
    });
    const plan = planShadow(frame, { budget: 3 });
    assert.equal(
      plan.actions.filter((a) => a.target === 'all-eligible').length,
      0,
      `${id} 不许被当作普通 missing 全跑`,
    );
    assert.equal(plan.no_op, false);
  }
});

test('S1-c scope 未声明 ⇒ 允许全量但必须显式标明"未授权"', () => {
  const frame = frameOf({ gaps: [{ id: 'snapshot:missing', kind: 'missing', subject: 'snapshot', reason: '没有基线', signals: [] }] });
  const plan = planShadow(frame, { budget: 3 });
  const full = plan.actions.find((a) => a.target === 'all-eligible');
  assert.ok(full, '未声明范围时按既有语义仍可给全量建议');
  assert.equal(plan.widen, null);
  assert.ok(
    plan.limitations.some((l) => /未声明/.test(l)),
    `必须显式说明"未授权全量"：${plan.limitations.join(' / ')}`,
  );
});

test('S1-d impact-untrusted 与 snapshot:missing 共用同一套 widen 裁决（形状一致）', () => {
  const mk = (id: string, kind: 'impact-untrusted' | 'missing'): ReturnType<typeof planShadow> =>
    planShadow(
      frameOf({
        goal: { text: 'g', judgement_refs: [], scope: ['src/a.ts'] },
        gaps: [{ id, kind, subject: 'x', reason: 'r', signals: [] }],
      }),
      { budget: 2 },
    );
  const a = mk('impact:untrusted', 'impact-untrusted');
  const b = mk('snapshot:missing', 'missing');
  assert.equal(a.widen !== null, b.widen !== null, '两个入口必须同判');
  assert.deepEqual(
    a.actions.map((x) => `${x.action}:${x.target}`).sort(),
    b.actions.map((x) => `${x.action}:${x.target}`).sort(),
    '同一套算法 ⇒ 建议形状一致',
  );
});

test('S1-e 越界 + runner 不可用 ⇒ 仍按能力规则降级，不留 run_test', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: [], scope: ['tests/in.test.ts'] },
    capability: { runner: null, tiers: [], reason: '认不出 runner' },
    gaps: [{ id: 'snapshot:missing', kind: 'missing', subject: 'snapshot', reason: 'r', signals: [] }],
  });
  const plan = planShadow(frame, { budget: 3 });
  assert.equal(plan.actions.filter((a) => a.action === 'run_test').length, 0);
});

// ══════════════════════════════════════════════════════════════════════
// S-02 · resolved ref 的当前 verdict 未读 ⇒ 必须未决
// ══════════════════════════════════════════════════════════════════════

test('S2-a 只有 resolved ref（verdict 未读）⇒ 不得 no-op，且有 run_judgement 建议', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: ['decision:f:n1#0'], scope: [] },
    signals: [sig()],
    gaps: [
      {
        id: 'ref-verdict-pending:decision:f:n1#0',
        kind: 'pending',
        subject: 'decision:f:n1#0',
        reason: '引用已解析，但当前 verdict 未读',
        signals: ['ref:decision:f:n1#0'],
      },
    ],
  });
  const plan = planShadow(frame, { budget: 2 });
  assert.equal(plan.no_op, false, '引用存在 ≠ 目标没有未决证据');
  assert.ok(
    plan.actions.some((a) => a.action === 'run_judgement' && a.target.includes('decision:f:n1#0')),
    `应有 run_judgement 建议：${JSON.stringify(plan.actions.map((a) => `${a.action}:${a.target}`))}`,
  );
});

test('S2-b run_judgement 只被建议、未执行 ⇒ 缺口仍 open', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: ['decision:f:n1#0'], scope: [] },
    signals: [sig()],
    gaps: [{ id: 'ref-verdict-pending:decision:f:n1#0', kind: 'pending', subject: 'decision:f:n1#0', reason: 'r', signals: [] }],
  });
  const plan = planShadow(frame, { budget: 1 });
  const act = plan.actions.find((a) => a.action === 'run_judgement');
  assert.ok(act);
  assert.deepEqual(act.would_close_gaps, ['ref-verdict-pending:decision:f:n1#0'], '预计关闭只写在动作里');
  assert.ok(plan.open_gaps.includes('ref-verdict-pending:decision:f:n1#0'), '当前缺口不因建议而关闭');
});

test('S2-c 缺失/越界/歧义 ref 保持各自错误类型（不被降级成 pending）', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: ['decision:nope#0'], scope: [] },
    gaps: [
      { id: 'ref:missing:decision:nope#0', kind: 'unavailable', subject: 'decision:nope#0', reason: '册里找不到', signals: [] },
      { id: 'ref:out-of-range:decision:f:n1#9', kind: 'unavailable', subject: 'decision:f:n1#9', reason: '越界', signals: [] },
      { id: 'ref:ambiguous:decision:n1#0', kind: 'ambiguous', subject: 'decision:n1#0', reason: '同名', signals: [] },
    ],
  });
  const plan = planShadow(frame, { budget: 5 });
  for (const id of ['ref:missing:decision:nope#0', 'ref:out-of-range:decision:f:n1#9', 'ref:ambiguous:decision:n1#0']) {
    assert.ok(plan.open_gaps.includes(id), `${id} 必须保持 open`);
  }
  assert.equal(plan.actions.filter((a) => a.action === 'run_judgement').length, 0, '错的 ref 不许建议跑判据');
});

// ══════════════════════════════════════════════════════════════════════
// S-03 · 索引内部任何必要读取失败都必须降级（打真读端）
// ══════════════════════════════════════════════════════════════════════

function mkDbProject(opts: { refsTable: 'no-status' | 'ok'; files: Array<[string, number]>; }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r2-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ds1r2', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = true;\n');
  const db = new DatabaseSync(path.join(root, '.agent-io', 'cache.db'));
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec("INSERT INTO schema_versions VALUES (18, 0, 'fixture')");
  db.exec('CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, content_hash TEXT, size INTEGER, modified_at INTEGER, indexed_at INTEGER)');
  for (const [p, size] of opts.files) db.exec(`INSERT INTO files VALUES (NULL, '${p}', 'h', ${size}, 0, 0)`);
  db.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY, file_path TEXT, name TEXT, qualified_name TEXT, kind TEXT, start_line INTEGER)');
  db.exec('CREATE TABLE edges (source TEXT, target TEXT, kind TEXT)');
  // ★ no-status：形状闸只看 resolved_node_id，所以能穿过；但 COUNT 查询用到 u.status ⇒ 查询失败
  if (opts.refsTable === 'ok') {
    db.exec('CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, file_id INTEGER, reference_name TEXT, status TEXT, resolved_node_id TEXT)');
  } else {
    db.exec('CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, file_id INTEGER, reference_name TEXT, resolved_node_id TEXT)');
  }
  db.close();
  return root;
}

test('S3-a 覆盖成功但 stale-ref 查询失败 ⇒ 索引不得判 usable，且不调用影响面', () => {
  const root = mkDbProject({ refsTable: 'no-status', files: [['src/a.mjs', 21]] });
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const before = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  const { frame, receipts } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 2 });
  const after = { db: sha(dbFile), wal: sha(`${dbFile}-wal`), shm: sha(`${dbFile}-shm`) };
  assert.equal(frame.index.state, 'unavailable', `stale-ref 查询失败必须判 unavailable（实得 ${frame.index.state}）`);
  assert.equal(frame.index.untrusted_refs, null);
  assert.ok(frame.gaps.some((g) => g.id.startsWith('index:')), '必须形成明确缺口');
  assert.ok(!receipts.some((r) => r.port === 'impact' && r.status === 'ok'), '影响面不得被调用成功');
  assert.deepEqual(after, before, '三种失败下 cache.db/WAL/SHM 均不得变化');
});

test('S3-b probe.unreadable 字段在位且默认空（EACCES/竞态分支**未构造出反例**，如实标注）', () => {
  // ★ 诚实边界：`unreadable` 只在"磁盘走查看得见、stat 却失败"时触发（EACCES / walk 与 stat 之间被删）。
  //   本夹具装了 danger-full-access 也无法稳定复现该时序 ⇒ 只证明**字段接线**，降级分支由 S3-a/S3-c 覆盖。
  const root = mkDbProject({ refsTable: 'ok', files: [['src/a.mjs', 21]] });
  const { frame } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 1 });
  assert.ok(frame.index.stale_files !== null, 'probe 读数必须真的跑过（不是 null）');
  assert.notEqual(frame.index.state, 'missing', '有库 ⇒ 不许判成"没有索引"');
});

test('S3-c Frame 层防御：untrusted_refs=null 且无其他索引原因 ⇒ 补不可判缺口（不许 ??0）', () => {
  const frame = buildEvidenceFrame({
    root: '/tmp/proj',
    goal: {},
    changed: [],
    ports: fakePorts({ indexFacts: () => ({ state: 'usable', schema_version: 18, stale_files: 0, stale_total: 1, untrusted_refs: null }) }),
  });
  assert.ok(
    frame.gaps.some((g) => g.id === 'index:untrusted-unknown'),
    `null 必须补防御性缺口：${frame.gaps.map((g) => g.id).join(',')}`,
  );
});

// ══════════════════════════════════════════════════════════════════════
// S-04 · budget=0 是真正"只诊断"
// ══════════════════════════════════════════════════════════════════════

test('S4-a budget=0 + 无候选但有未决 ⇒ actions/deferred 全空、no_op=false、未决保留', () => {
  const frame = frameOf({ undetermined: [{ id: 'tests/a.test.ts', reason: '影响关系不可信' }] });
  const plan = planShadow(frame, { budget: 0 });
  assert.deepEqual(plan.actions, [], 'budget=0 不许用"安全动作"旁路');
  assert.deepEqual(plan.deferred, []);
  assert.equal(plan.no_op, false, '未决必须仍然可见');
});

test('S4-b budget=0 + 帧形状坏 ⇒ 同样不选动作', () => {
  const broken = { ...frameOf(), signals: [{ ...sig(), scope: 'all' }] } as unknown as EvidenceFrame;
  const plan = planShadow(broken, { budget: 0 });
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.open_gaps, ['frame-shape'], '形状问题仍要如实报');
});

test('S4-c budget>0 的未决安全动作保持原样（不回退）', () => {
  const frame = frameOf({ undetermined: [{ id: 'tests/a.test.ts', reason: '影响关系不可信' }] });
  const plan = planShadow(frame, { budget: 1 });
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].action, 'ask_human');
});

// ══════════════════════════════════════════════════════════════════════
// R-06 · 脚本改动集来源完整性
// ══════════════════════════════════════════════════════════════════════

test('R06-a git 仓但缺"上次判据锚" ⇒ 不得 trusted（已提交历史不可见）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ds1r2-git-'));
  const git = (args: string[]): void => {
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf-8' });
  };
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'x\n');
  git(['add', '.']);
  git(['commit', '-qm', 'init']);
  const out = spawnSync(process.execPath, [path.join(REPO, 'scripts/schedule-shadow.mjs'), '--project-dir', root, '--json'], {
    cwd: REPO,
    encoding: 'utf-8',
    maxBuffer: 32 << 20,
  });
  const j = JSON.parse(String(out.stdout ?? '{}'));
  assert.equal(j.changed_trusted, false, `缺锚 ⇒ 已提交历史不可见，不许 trusted（实得 ${j.changed_trusted}）`);
  assert.match(String(JSON.stringify(j.changed)), /sources|note/i, 'changed 矩阵要能被机器读到');
  assert.ok(
    (j.frame?.limitations ?? []).some((l: string) => /改动集来源/.test(l)),
    'changedNote 必须进 frame.limitations（不只是脚本局部）',
  );
});

// ══════════════════════════════════════════════════════════════════════
// 夹具
// ══════════════════════════════════════════════════════════════════════

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
    judgementRefs: () => ({ ok: true, value: { resolved: [], problems: [] } }),
    impact: () => ({ ok: true, value: { ok: true, files: new Set<string>(), symbols: new Set<string>(), calls: 0, non_code: [] } }),
    capability: () => ({ runner: 'node-test', tiers: [] }),
    ...over,
  };
}

void createReadOnlyPorts;
