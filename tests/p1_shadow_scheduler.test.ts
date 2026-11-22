/**
 * ★ P1（DS-1 卡）· 影子调度器**端到端**：真仓只读、夹具项目、确定性重放、schema 落后不许迁移。
 *
 * ## 病（改前最可能的错做法）
 * 1. 为了"方便"直接走 `invokeTool` 或 `getProjectCacheDb()` ⇒ 顺手建索引/迁移 cache.db/写快照。
 * 2. 读不到索引 ⇒ 返回空事实 ⇒ 下游把"没读到"读成"没影响"。
 * 3. 同输入跑两次因遍历顺序/时间戳不同而不一致 ⇒ 无从重放，也无法追责。
 * 4. schema 落后时开库 ⇒ 静默迁移（写盘），把只读诊断变成了一次隐式迁移。
 *
 * ## 本证断言什么（每条都双向）
 * · **真仓**：跑两次影子调度，`cache.db` / `verified-snapshot.json` / `tasks.db` / 设计册的
 *   sha256 前后**逐字节不变**；两份计划 `planDigest` 相同（唯一允许的差异是显式时间戳）。
 * · **夹具**：改动 `src/a.mjs` 后，观察面含它的 TA 判 stale、不含它的 TB 判 fresh
 *   —— 差一格的证据不许混着用。
 * · **schema 落后**：状态判 `unusable` 且**不迁移**（cache.db 哈希不变）；第一条建议是 `refresh_index`。
 * · **没有索引**：影响面判 `untrusted`，第一条建议是扩大验证而不是 no_op。
 *
 * ## 消融（★ 本文件必须能红）
 * · 把 `createReadOnlyPorts().indexFacts` 里的 `raw.version !== SCHEMA_VERSION` 早退删掉
 *   ⇒ 用例「schema 落后不许迁移」红（cache.db 被迁移，哈希变化）。
 * · 把 `impact()` 里的索引状态检查删掉 ⇒ 用例「没有索引时影响面不可信」红。
 * · 把 `observesAlignment` 换成"整份基线版本相同即 fresh" ⇒ 用例「TA 过期 / TB 新鲜」红。
 *
 * ## 诚实清单
 * · 夹具项目**没有真实索引**（`cache.db` 缺失）：本文件证明的是"缺索引时的行为正确"，
 *   不是"有索引时选材正确"（后者由既有 `p1_impact_selection` / `p1_verified_snapshot` 承担）。
 * · 真仓用例不改任何文件；它证明的是**本入口**在这棵树上的零写入，不证明别的入口。
 * · 未验证：跨机器/跨盘符路径身份、runtime 动态证据（本期未接入）。
 *
 * touches: src/application/scheduling/shadow_scheduler.ts, src/application/scheduling/evidence_frame.ts,
 *          src/domain/scheduling_policy.ts, scripts/schedule-shadow.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { runShadowScheduler } from '../src/application/scheduling/shadow_scheduler.js';
import { planDigest } from '../src/domain/scheduling_policy.js';
import { contentVersion, SNAPSHOT_REL } from '../src/application/design/verified_snapshot.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (f: string): string =>
  fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '<absent>';

/** 夹具项目：两个测试对象、一份基线、（可选）一个 schema 落后的 cache.db。 */
function mkProject(opts: { outdatedDb?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-sched-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shadow-fixture', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), "import { a } from '../src/a.mjs';\nexport const ok = a === 1;\n");
  fs.writeFileSync(path.join(root, 'tests', 'b.test.mjs'), 'export const ok = true;\n');

  // 基线：TA 观察 src/a.mjs，TB 只观察自己
  const files = {
    'src/a.mjs': sha(path.join(root, 'src', 'a.mjs')),
    'tests/a.test.mjs': sha(path.join(root, 'tests', 'a.test.mjs')),
    'tests/b.test.mjs': sha(path.join(root, 'tests', 'b.test.mjs')),
  };
  const snapshot = {
    schema: 1,
    at: '2026-01-01T00:00:00.000Z',
    content: { version: contentVersion(files), files },
    graph: { version: '', bytes: 0, available: false },
    entries: [
      { id: 'test:tests/a.test.mjs', kind: 'test', verdict: 'pass', command: 'node --test tests/a.test.mjs', at: '2026-01-01T00:00:00.000Z', observes: ['src/a.mjs'] },
      { id: 'test:tests/b.test.mjs', kind: 'test', verdict: 'pass', command: 'node --test tests/b.test.mjs', at: '2026-01-01T00:00:00.000Z', observes: ['tests/b.test.mjs'] },
    ],
    scope: { ran: ['tests/a.test.mjs', 'tests/b.test.mjs'], inherited: [], undetermined: [] },
  };
  fs.writeFileSync(path.join(root, SNAPSHOT_REL), JSON.stringify(snapshot, null, 1));

  if (opts.outdatedDb) {
    const db = new DatabaseSync(path.join(root, '.agent-io', 'cache.db'));
    db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
    db.exec('CREATE TABLE files (path TEXT)');
    db.exec("INSERT INTO schema_versions VALUES (1, 0, '夹具：故意落后')");
    db.exec("INSERT INTO files VALUES ('src/a.mjs')");
    db.close();
  }
  return root;
}

test('① 改动 src/a.mjs ⇒ TA 判过期（版本不一致），TB 保持新鲜', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 2;\n'); // 改内容 ⇒ 指纹变
  const { frame, plan } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 3 });

  const ta = frame.signals.find((s) => s.id === 'test:tests/a.test.mjs');
  const tb = frame.signals.find((s) => s.id === 'test:tests/b.test.mjs');
  assert.ok(ta && tb, '两个测试对象都必须在帧里');
  assert.equal(ta.freshness, 'stale', `TA 观察面含被改文件 ⇒ 必须过期（实得 ${ta.freshness} / ${ta.reason}）`);
  assert.equal(tb.freshness, 'fresh', `TB 观察面没变 ⇒ 保持新鲜（实得 ${tb.freshness} / ${tb.reason}）`);
  assert.ok(plan.actions.some((a) => a.action === 'run_test' && a.target === 'tests/a.test.mjs'), '过期证据必须被建议重跑');
  assert.ok(!plan.actions.some((a) => a.action === 'run_test' && a.target === 'tests/b.test.mjs'), '没受影响的 TB 不许被建议重跑');
});

test('② 没有索引 ⇒ 影响面判不可信，第一条建议是扩大验证（不是 no_op）', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 3;\n');
  const { frame, plan, receipts } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 1 });
  assert.equal(frame.index.state, 'missing');
  assert.ok(frame.gaps.some((g) => g.id === 'index:missing'), '缺索引必须显式成缺口');
  assert.ok(frame.gaps.some((g) => g.kind === 'impact-untrusted'), '影响面不可信必须显式');
  assert.equal(plan.no_op, false);
  assert.equal(plan.actions[0].action, 'refresh_index', `索引是第一前置，实得 ${plan.actions[0].action}`);
  // ★ DS-1R3 T-03b：索引不可用时**连影响面端口都不碰**（旧断言要求"留 impact 回执"，已被证错）
  assert.ok(
    !receipts.some((r) => r.port === 'impact'),
    `索引不可用时不许碰影响面端口（实得 ${JSON.stringify(receipts.filter((r) => r.port === 'impact'))}）`,
  );
});

test('③ schema 落后 ⇒ 判 unusable 且**不迁移**（cache.db 逐字节不变）', () => {
  const root = mkProject({ outdatedDb: true });
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const before = sha(dbFile);
  const { frame, plan } = runShadowScheduler({ root, changed: [], budget: 1 });
  const after = sha(dbFile);

  assert.equal(frame.index.state, 'unusable');
  assert.match(String(frame.index.reason), /需重建/);
  assert.equal(after, before, '★ 只读诊断不许把 schema 落后的库就地迁移（开库即写）');
  assert.equal(plan.actions[0].action, 'refresh_index');
});

test('④ 同输入两次运行 ⇒ planDigest 逐字相同（A5）', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 4;\n');
  const one = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 2 });
  const two = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 2 });
  assert.equal(planDigest(one.plan), planDigest(two.plan));
});

test('⑤ 改动集不可信 ⇒ 不许把空交集当安全', () => {
  const root = mkProject();
  const { frame, plan } = runShadowScheduler({ root, changed: [], changedTrusted: false, budget: 2 });
  assert.ok(frame.gaps.some((g) => g.id === 'changed:untrusted'));
  assert.ok(frame.limitations.some((l) => /改动集不可信/.test(l)));
  assert.equal(plan.no_op, false, '改动集不可信时不许给 no_op');
});

test('⑧ 热 WAL（DS-1R 反转）：注入只读连接后能算影响面，且仍不碰 cache.db / -wal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-wal-"));
  const inner = { root, lock: null };
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'wal-fixture', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = true;\n');
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA wal_autocheckpoint = 0');
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec("INSERT INTO schema_versions VALUES (18, 0, 'fixture')");
  db.exec('CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, content_hash TEXT, size INTEGER, modified_at INTEGER, indexed_at INTEGER)');
  db.exec('CREATE TABLE nodes (id TEXT PRIMARY KEY, file_path TEXT, name TEXT, qualified_name TEXT, kind TEXT, start_line INTEGER)');
  db.exec('CREATE TABLE edges (source TEXT, target TEXT, kind TEXT)');
  db.exec('CREATE TABLE unresolved_refs (id INTEGER PRIMARY KEY, file_id INTEGER, reference_name TEXT, resolved_node_id TEXT)');
  db.exec("INSERT INTO files VALUES (1, 'src/a.mjs', 'h', 21, 0, 0)");
  // ★ 不 close：让 -wal 里留下热帧
  const walFile = dbFile + "-wal";
  const before = sha(dbFile);
  const walBefore = fs.existsSync(walFile) ? fs.statSync(walFile).size : -1;
  assert.ok(walBefore > 0, `前提：夹具必须留下热 WAL（实测 ${walBefore} 字节）`);
  const { receipts } = runShadowScheduler({ root, changed: ["src/a.mjs"], budget: 1 });
  const after = sha(dbFile);
  const walAfter = fs.existsSync(walFile) ? fs.statSync(walFile).size : -1;
  assert.equal(after, before, '注入只读连接：热 WAL 也不许被 checkpoint 进主库');
  assert.equal(walAfter, walBefore, '也不许消费掉 -wal 帧');
  assert.ok(!receipts.some((r) => r.port === 'impact' && /WAL/.test(String(r.reason))), '不再靠热 WAL 特判逼近只读');
  db.close();
  void inner;
});

test('① 改动 src/a.mjs ⇒ TA 判过期，TB 保持新鲜', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 2;\n');
  const { frame, plan } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 3 });
  const ta = frame.signals.find((s) => s.id === 'test:tests/a.test.mjs');
  const tb = frame.signals.find((s) => s.id === 'test:tests/b.test.mjs');
  assert.ok(ta && tb, '两个测试对象都必须在帧里');
  assert.equal(ta.freshness, 'stale', `TA 观察面含被改文件 ⇒ 必须过期（实得 ${ta.freshness} / ${ta.reason}）`);
  assert.equal(tb.freshness, 'fresh', `TB 观察面没变 ⇒ 保持新鲜（实得 ${tb.freshness} / ${tb.reason}）`);
  assert.ok(plan.actions.some((a) => a.action === 'run_test' && a.target === 'tests/a.test.mjs'), '过期证据必须被建议重跑');
  assert.ok(!plan.actions.some((a) => a.action === 'run_test' && a.target === 'tests/b.test.mjs'), '没受影响的 TB 不许被建议重跑');
});

test('② 没有索引 ⇒ 影响面判不可信，第一条建议是扩大验证（不是 no_op）', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 3;\n');
  const { frame, plan, receipts } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 1 });
  assert.equal(frame.index.state, 'missing');
  assert.ok(frame.gaps.some((g) => g.id === 'index:missing'), '缺索引必须显式成缺口');
  assert.ok(frame.gaps.some((g) => g.kind === 'impact-untrusted'), '影响面不可信必须显式');
  assert.equal(plan.no_op, false);
  assert.equal(plan.actions[0].action, 'refresh_index', `索引是第一前置，实得 ${plan.actions[0].action}`);
  // ★ DS-1R3 T-03b：索引不可用时**连影响面端口都不碰**（旧断言要求"留 impact 回执"，已被证错）
  assert.ok(
    !receipts.some((r) => r.port === 'impact'),
    `索引不可用时不许碰影响面端口（实得 ${JSON.stringify(receipts.filter((r) => r.port === 'impact'))}）`,
  );
});

test('③ schema 落后 ⇒ 判 unusable 且**不迁移**（cache.db 逐字节不变）', () => {
  const root = mkProject({ outdatedDb: true });
  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const before = sha(dbFile);
  const { frame, plan } = runShadowScheduler({ root, changed: [], budget: 1 });
  const after = sha(dbFile);

  assert.equal(frame.index.state, 'unusable');
  assert.match(String(frame.index.reason), /需重建/);
  assert.equal(after, before, '★ 只读诊断不许把 schema 落后的库就地迁移（开库即写）');
  assert.equal(plan.actions[0].action, 'refresh_index');
});

test('④ 同输入两次运行 ⇒ planDigest 逐字相同（A5）', () => {
  const root = mkProject();
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 4;\n');
  const one = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 2 });
  const two = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 2 });
  assert.equal(planDigest(one.plan), planDigest(two.plan));
});

test('⑤ 改动集不可信 ⇒ 不许把空交集当安全', () => {
  const root = mkProject();
  const { frame, plan } = runShadowScheduler({ root, changed: [], changedTrusted: false, budget: 2 });
  assert.ok(frame.gaps.some((g) => g.id === 'changed:untrusted'));
  assert.ok(frame.limitations.some((l) => /改动集不可信/.test(l)));
  assert.equal(plan.no_op, false, '改动集不可信时不许给 no_op');
});

test('⑧ 热 WAL：不许替别的写者 checkpoint（cache.db 与 -wal 都逐字节不变）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-wal-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'wal-fixture', type: 'module' }));
  fs.writeFileSync(path.join(root, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), 'export const ok = true;\n');

  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA wal_autocheckpoint = 0'); // ★ 不自动 checkpoint：让 -wal 里留下热帧
  db.exec('CREATE TABLE schema_versions (version INTEGER, applied_at INTEGER, description TEXT)');
  db.exec("INSERT INTO schema_versions VALUES (18, 0, 'fixture')");
  db.exec('CREATE TABLE files (path TEXT PRIMARY KEY, size INTEGER, modified_at INTEGER, indexed_at INTEGER)');
  db.exec("INSERT INTO files VALUES ('src/a.mjs', 21, 0, 0)");
  // ★ 刻意不 close：close 会 checkpoint，热 WAL 的前提就没了

  const walFile = `${dbFile}-wal`;
  const before = sha(dbFile);
  const walBefore = fs.existsSync(walFile) ? fs.statSync(walFile).size : -1;
  assert.ok(walBefore > 0, `前提：夹具必须真的留下热 WAL（实测 -wal ${walBefore} 字节）`);

  const { receipts, plan } = runShadowScheduler({ root, changed: ['src/a.mjs'], budget: 1 });
  const after = sha(dbFile);
  const walAfter = fs.existsSync(walFile) ? fs.statSync(walFile).size : -1;

  assert.equal(after, before, '★ 只读诊断不许把热 WAL checkpoint 进主库（那会让 cache.db 字节变化）');
  assert.equal(walAfter, walBefore, '★ 也不许顺手消费掉 -wal 帧');
  assert.ok(
    !receipts.some((r) => r.port === 'impact' && /WAL/.test(String(r.reason))),
    'DS-1R：注入只读连接后不再靠热 WAL 特判（旧断言要求拒绝算影响面，已被证错）',
  );
  assert.equal(plan.actions[0].action, 'refresh_index', '正确出口是显式刷新，不是在诊断里替它落盘');
  db.close();
});

test('⑥ 真仓：两次运行后 cache.db / 快照 / tasks.db / 设计册逐字节不变', () => {
  const watch = [
    path.join(REPO, '.agent-io', 'cache.db'),
    path.join(REPO, '.agent-io', 'verified-snapshot.json'),
    path.join(REPO, '.agent-io', 'tasks.db'),
    path.join(REPO, '.agent-io', 'design', 'agent-io.dsl.json'),
    path.join(REPO, 'src', 'application', 'design', 'verified_snapshot.ts'),
  ];
  const before = watch.map(sha);
  const changed = ['src/application/design/verified_snapshot.ts'];
  const one = runShadowScheduler({ root: REPO, changed, budget: 1 });
  const two = runShadowScheduler({ root: REPO, changed, budget: 1 });
  const after = watch.map(sha);

  assert.deepEqual(after, before, `只读路径改写了这些文件：${watch.filter((_, i) => after[i] !== before[i]).join(', ')}`);
  assert.equal(planDigest(one.plan), planDigest(two.plan), '真仓上重复运行也必须逐字相同');
  assert.ok(one.frame.content.version, '真仓内容版本必须读得到');
  assert.ok(one.frame.design_revisions.length > 0, '真仓设计册 revision 必须读得到');
});

test('⑦ 真仓：计划里没有任何写动作（词表与外层断言双保险）', () => {
  const { plan } = runShadowScheduler({ root: REPO, changed: ['src/domain/scheduling_policy.ts'], budget: 3 });
  const all = [...plan.actions, ...plan.deferred];
  for (const a of all) {
    assert.ok(
      ['refresh_index', 'read_facts', 'run_test', 'run_judgement', 'observe', 'ask_human', 'wait', 'no_op'].includes(a.action),
      `出现词表外动作：${a.action}`,
    );
  }
  assert.ok(all.every((a) => a.why_before_others.length > 0 && a.closes.length > 0 && a.if_skipped.length > 0), '每条建议都要说清为什么/关什么/不做会怎样');
});
