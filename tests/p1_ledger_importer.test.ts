/**
 * T-#LEDGER-ENGINE **L2** —— importer / 关系层（subject 锚点）/ 双向对账 / 待人工队列。
 *
 * ## 判据（每条都能打断即红；括号里是"打断它的最小改法"）
 *  1. 老库迁移：L1 形状的 `tasks.db` 打开**不抛**、新列补齐、两索引建好、老行逐字不变；再跑一次 `added=[]`
 *     （把 `ensureLedgerIndexes` 挪到 `migrateLedgerColumns` 之前 ⇒ 红在 `no such column`）。
 *  2. 幂等：同一份 MD 连跑两遍 ⇒ 第二遍 `added=0` 且 `derived_rebuilt=0`（改成每次 INSERT ⇒ 红）。
 *  3. 漂移不静默：改一个字 ⇒ `reconcile` **抛**并点名 ref_id；`refresh` 才写，且旧原文逐字进 annotate 事件
 *     （改成静默 UPDATE ⇒ 红；改成 UPDATE 事件 ⇒ 触发器 ABORT，现成红）。
 *  4. 双向对账：两侧差集各点名一次（删掉任一方向 ⇒ 红）。
 *  5. 三态：无库/无表/不可达 ⇒ `ok=false` 且 `unavailable` 各报各的，**不许印"一致"**（漏一态 ⇒ 红）。
 *  6. 解析器：转义感知 / code span 感知 / 无表头表首行**不许被当表头吃掉** / 半转义行整行进桶 /
 *     引用 id 不许当身份（把 `split('|')` 换回来 ⇒ 红；把"每节第一行当表头"换回来 ⇒ 红）。
 *  7. subject 唯一：engine 行同 subject 拒并点名 → `declareSupersedes` 成（旧行仍 active + 指针 + 事件）→
 *     销账后可重挂；`import` 行**豁免**但 `subjectConflicts()` 点名 + 队列里有一组（去掉谓词 ⇒ 红）。
 *  8. §F 裁决是第三实体：只在 §F 的围栏里产 ruling（§A 的围栏不产）、捆绑行拆 key、
 *     默认 `listActive` 不含 ruling（用"任何围栏都进 ruling"实现 ⇒ 红）。
 *  9. 全保真：从库里**逐字拼回**原 MD（丢掉散文/纪律的导入 ⇒ 红 —— 这是 L3 能不能"复现"而不是"重新创作"的前提）。
 *
 * 夹具仿 `tests/p1_ledger_engine.test.ts:29-55`：makeTempHome + AGENT_IO_HOME + registerFeature + rmRf。
 * ★ **不写任何计数判据**：MD 一天能长几十行，计数一写死就红在与代码无关的地方（L2 判据 ⑤）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getTasksDbFile, openTasksDb, migrateLedgerColumns, ensureLedgerIndexes } from '../src/infrastructure/task_history.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import {
  hangRow, closeRow, getRow, listActive, listRows, subjectConflicts, listReviewQueue, resolveReview,
} from '../src/application/ledger/ledger.js';
import {
  importLedger, parseTodoMd, reconstructMarkdown, splitTableRow, businessIdOfCell, extractSubjectAnchors,
  type ImportError,
} from '../src/application/ledger/importer.js';
import { reconcileLedgerIds } from '../src/application/ledger/reconcile.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REPO_MD = path.resolve(process.cwd(), 'docs', 'todo.md');
const FEATURE = `__ledger_l2_${process.pid}`;

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
  prevDataRoot: string | undefined;
}

function setup(opts?: { withMd?: boolean }): Fixture {
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-l2-proj-'));
  delete process.env.AGENT_IO_DATA_ROOT; // ★ DATA_ROOT 优先级高于 HOME，会抢走夹具
  process.env.AGENT_IO_HOME = home;
  registerFeature(FEATURE, project, 'p1_ledger_importer.test');
  if (opts?.withMd !== false) {
    fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
    fs.copyFileSync(REPO_MD, path.join(project, 'docs', 'todo.md'));
  }
  return { home, project, prevHome, prevDataRoot };
}

function teardown(fx: Fixture): void {
  if (fx.prevHome === undefined) delete process.env.AGENT_IO_HOME; else process.env.AGENT_IO_HOME = fx.prevHome;
  if (fx.prevDataRoot === undefined) delete process.env.AGENT_IO_DATA_ROOT; else process.env.AGENT_IO_DATA_ROOT = fx.prevDataRoot;
  rmRf(fx.home);
  rmRf(fx.project);
}

function inSandbox(fn: (fx: Fixture) => void, opts?: { withMd?: boolean }): void {
  const fx = setup(opts);
  try { fn(fx); } finally { teardown(fx); }
}

/** 夹具里那份 MD 的原文（**与库无关**：断言"从库拼回来的东西"要和它对上） */
function mdText(fx: Fixture): string {
  return fs.readFileSync(path.join(fx.project, 'docs', 'todo.md'), 'utf-8');
}

function withoutTrailingNewline(text: string, eol: string): string {
  return text.endsWith(eol) ? text.slice(0, text.length - eol.length) : text;
}

// ─────────────────────────────────────────── ① 老库迁移（最高危：全仓 tasks.db 使用者共用这条路径）

test('① 老库（L1 形状）迁移：不抛、列补齐、索引建成、老行逐字不变；再跑幂等', () =>
  inSandbox((fx) => {
    fs.mkdirSync(path.join(fx.project, '.agent-io'), { recursive: true });
    const dbFile = getTasksDbFile(fx.project);
    // ★ 手造 **L1 形状**（只含 L1 列与 L1 的两条索引）—— 不是"当前 schema 去掉几列"，是当年那条 DDL
    {
      const db = new DatabaseSync(dbFile);
      db.exec(`
        CREATE TABLE ledger_rows (
          rowid           INTEGER PRIMARY KEY,
          ref_id          TEXT NOT NULL,
          section         TEXT NOT NULL,
          title           TEXT NOT NULL,
          problem         TEXT,
          proposal        TEXT,
          state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','done','void')),
          superseded_by   TEXT,
          opened_at       TEXT NOT NULL,
          closed_at       TEXT,
          closed_reason   TEXT,
          closed_evidence TEXT
        );
        CREATE UNIQUE INDEX ledger_rows_active_ref_id ON ledger_rows(ref_id) WHERE state = 'active';
        CREATE INDEX idx_ledger_rows_section_state ON ledger_rows(section, state);
      `);
      db.prepare(
        `INSERT INTO ledger_rows (ref_id, section, title, problem, proposal, state, opened_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      ).run('T-#L1-SHAPE-ROW', '§E', '老行的标题  含双空格', '老问题\n含换行', '老提案', '2026-01-01T00:00:00.000Z');
      db.close();
    }

    // ★ 陷阱本体：老库上**先建引用新列的索引** ⇒ no such column（这就是"索引必须后置"的理由）
    {
      const db = new DatabaseSync(dbFile);
      assert.throws(
        () => db.exec(`CREATE UNIQUE INDEX probe_bad ON ledger_rows(subject_path) WHERE state = 'active'`),
        /no such column/,
        '索引引用后加列在老库上必须失败 —— 这条用例就是"索引后置"的出生证明',
      );
      db.close();
    }

    // 打开写端：建表（no-op）+ 补列 + 建索引
    const db = openTasksDb(fx.project);
    try {
      const cols = (db.prepare('PRAGMA table_info(ledger_rows)').all() as Array<{ name: string }>).map((c) => c.name);
      for (const c of ['record_kind', 'origin', 'subject_path', 'subject_symbol', 'ordinal', 'source_json']) {
        assert.ok(cols.includes(c), `迁移后必须补齐列 ${c}（只改 schema 串不 ALTER ⇒ 红）`);
      }
      const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map(
        (r) => r.name,
      );
      assert.ok(idx.includes('ledger_rows_active_subject'), 'subject 唯一索引必须建成');
      assert.ok(idx.includes('idx_ledger_rows_subject'), 'subject 查询索引必须建成');

      const old = db
        .prepare('SELECT * FROM ledger_rows WHERE ref_id = ?')
        .get('T-#L1-SHAPE-ROW') as Record<string, unknown>;
      assert.equal(old.title, '老行的标题  含双空格', '老行标题逐字不变（ALTER 不许重写行）');
      assert.equal(old.problem, '老问题\n含换行');
      assert.equal(old.proposal, '老提案');
      assert.equal(old.opened_at, '2026-01-01T00:00:00.000Z');
      assert.equal(old.record_kind, 'task', '老行读出默认 record_kind=task');
      assert.equal(old.origin, 'engine', '老行读出默认 origin=engine');
      assert.equal(old.subject_path, null, '老行没有 subject（NULL，不参与唯一索引）');

      assert.deepEqual(migrateLedgerColumns(db), [], '第二次补列必须 added=[]（幂等）');
      assert.deepEqual(ensureLedgerIndexes(db), [], '第二次建索引必须 added=[]（幂等）');
    } finally {
      db.close();
    }
  }));

// ─────────────────────────────────────────── ② 幂等 + ⑨ 逐字 round-trip

test('② 幂等：同一份 MD 连跑两遍 ⇒ 第二遍 added=0 / derived_rebuilt=0；整表逐字不变', () =>
  inSandbox((fx) => {
    const first = importLedger(fx.project, { mode: 'refresh' });
    assert.ok(first.added > 0, '首跑必须有新增（否则这个夹具没测到东西）');
    const digestOf = (): string => {
      const rows = listRows(fx.project, { withSource: true });
      return JSON.stringify(rows.map((r) => [r.row_id, r.ref_id, r.record_kind, r.ordinal, r.source_json]));
    };
    const before = digestOf();
    const second = importLedger(fx.project, { mode: 'reconcile' });
    assert.equal(second.added, 0, '第二遍不许再 INSERT（每次 INSERT ⇒ 唯一索引抛 / 行数翻倍）');
    assert.equal(second.refreshed, 0);
    assert.equal(second.derived_rebuilt, 0);
    assert.equal(second.drifted.length, 0);
    assert.equal(digestOf(), before, '整表逐字不变（幂等的硬判据）');
  }));

test('⑨ 全保真：从库里**逐字拼回**原 MD；丢掉散文/纪律行 ⇒ 拼不回来（消融）', () =>
  inSandbox((fx) => {
    importLedger(fx.project, { mode: 'refresh' });
    const text = mdText(fx);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const rows = listRows(fx.project, { withSource: true });
    const rebuilt = reconstructMarkdown(rows, eol);
    assert.equal(rebuilt, withoutTrailingNewline(text, eol), '库 → MD 必须逐字相等（否则 L3 只能"重新创作"）');

    // ★ 消融：把散文/标题/纪律行去掉 ⇒ 拼回来的东西就不等（证明这些行**真的**被用来重建）
    const onlyLedgerRows = rows.filter((r) => r.record_kind === 'task' || r.record_kind === 'ruling');
    assert.notEqual(
      reconstructMarkdown(onlyLedgerRows, eol),
      withoutTrailingNewline(text, eol),
      '删掉 prose/meta/discipline 还能拼回原文件 ⇒ 说明这些行没进库（静默丢内容）',
    );
  }));

test('⑨b §H 纪律段（`> ①…` / `> ↳ …`）逐字在库里；且它属于 discipline 而不是 prose', () =>
  inSandbox((fx) => {
    importLedger(fx.project, { mode: 'refresh' });
    const discipline = listRows(fx.project, { recordKinds: ['discipline'], withSource: true });
    assert.ok(discipline.length > 0, '§H 的纪律段必须有对应的 discipline 行（否则 L3 一生成就删掉用户拍板的 PR 链纪律）');
    for (const r of discipline) assert.equal(r.section, '§H', 'discipline 只该来自 §H（其余节是 prose）');
    const quotes = discipline.filter((r) => (r.source_json ?? '').includes('"detail":"quote"'));
    assert.ok(quotes.length > 0, '§H 的引用式纪律（> …）必须以 quote 形态入册');
  }));

// ─────────────────────────────────────────── ③ 漂移（拒写 + 留痕）

test('③ 漂移：改一个字 ⇒ reconcile 抛且点名 ref_id；refresh 才写，旧原文逐字进 annotate 事件', () =>
  inSandbox((fx) => {
    importLedger(fx.project, { mode: 'refresh' });
    const file = path.join(fx.project, 'docs', 'todo.md');
    const text = mdText(fx);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    // 挑一条**账行**（task）改它的一句话：账行有业务身份 ⇒ 内容变了就是漂移
    const parsed = parseTodoMd(text, { sourceName: 'docs/todo.md' });
    const victim = parsed.rows.find((r) => r.kind === 'task' && r.detail === 'table_row');
    assert.ok(victim, '真实 MD 里必须有带表头的账行（否则这条用例没测到漂移）');
    const oldRaw = victim!.raw;
    const lines = text.split(eol);
    lines[victim!.ordinal - 1] = `${oldRaw} <!-- drift-probe -->`;
    fs.writeFileSync(file, lines.join(eol), 'utf-8');

    const err = (() => {
      try {
        importLedger(fx.project, { mode: 'reconcile' });
        return null;
      } catch (e) {
        return e as ImportError;
      }
    })();
    assert.ok(err, 'reconcile 遇到漂移必须抛（静默 UPDATE ⇒ 这一行红）');
    assert.match(String(err!.message), new RegExp(victim!.refId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '报文必须点名 ref_id');
    assert.ok(err!.report && err!.report.drifted.length > 0, '错误上必须挂完整读数（点名的漂移列表）');
    // 拒写 = 一个字节都没动
    assert.equal(getRow(fx.project, victim!.refId)!.source_json!.includes('drift-probe'), false, 'reconcile 不许写');

    const rep = importLedger(fx.project, { mode: 'refresh' });
    assert.ok(rep.refreshed >= 1, 'refresh 才写');
    const row = getRow(fx.project, victim!.refId)!;
    assert.ok(row.source_json!.includes('drift-probe'), 'refresh 后列已更新');
    const ann = row.events.filter((e) => e.kind === 'annotate').at(-1);
    assert.ok(ann, '刷新必须留一条 annotate 事件');
    assert.ok(ann!.body!.includes(oldRaw), '事件 body 里必须含**旧原文逐字**（否则"改之前长什么样"考古不了）');
  }));

// ─────────────────────────────────────────── ④ 双向对账 + ⑤ 三态

test('④ 双向对账：真实 MD 双向差集为空；各造一条 ⇒ 各自点名', () =>
  inSandbox((fx) => {
    importLedger(fx.project, { mode: 'refresh' });
    const parsed = parseTodoMd(mdText(fx), { sourceName: 'docs/todo.md' });
    const ids = parsed.rows.filter((r) => r.kind === 'task').map((r) => r.refId);
    const ok = reconcileLedgerIds(fx.project, ids);
    assert.equal(ok.ok, true, `双向必须一致：${ok.note}`);
    assert.deepEqual(ok.mdOnly, []);
    assert.deepEqual(ok.ledgerOnly, []);
    assert.ok(ok.ledgerActive > 0 && ok.mdCount > 0, '回执必须带分母');

    // 引擎有、册无
    hangRow(fx.project, { refId: 'T-#ORPHAN-ROW', section: '§E', title: '只在引擎里的一条账', by: 'tester' });
    const orphan = reconcileLedgerIds(fx.project, ids);
    assert.equal(orphan.ok, false);
    assert.ok(orphan.ledgerOnly.includes('T-#ORPHAN-ROW'), '反向差集必须点名');
    assert.deepEqual(orphan.mdOnly, [], '只造了引擎侧 ⇒ MD 侧不该多');

    // 册有、引擎无（不重新 import）
    const ghost = reconcileLedgerIds(fx.project, [...ids, 'T-#GHOST-PROPOSAL']);
    assert.ok(ghost.mdOnly.includes('T-#GHOST-PROPOSAL'), '正向差集必须点名');
    assert.ok(ghost.ledgerOnly.includes('T-#ORPHAN-ROW'), '两个方向不许互相掩盖');
  }));

test('⑤ 三态：无库 / 无表 / 不可达 ⇒ ok=false 且 unavailable 各报各的（不许印"一致"）', () =>
  inSandbox((fx) => {
    // ① no-db：根可达但没有 tasks.db
    const noDb = reconcileLedgerIds(fx.project, ['T-#X']);
    assert.equal(noDb.ok, false);
    assert.equal(noDb.unavailable, 'no-db');
    assert.ok(!noDb.note.startsWith('一致'), `读不到时不许说"一致"：${noDb.note}`);
    assert.ok(noDb.note.includes('不是「对账通过」'), '必须显式说明"这不是对账通过"');

    // ② no-table：库在但表还没建
    fs.mkdirSync(path.join(fx.project, '.agent-io'), { recursive: true });
    {
      const db = new DatabaseSync(getTasksDbFile(fx.project));
      db.exec('CREATE TABLE probe_only (x INTEGER)'); // ★ 名字不能叫 nothing（SQLite 关键字）
      db.close();
    }
    const noTable = reconcileLedgerIds(fx.project, ['T-#X']);
    assert.equal(noTable.unavailable, 'no-table');
    assert.ok(!noTable.note.startsWith('一致'));

    // ③ unreachable：目录不在盘上（★ 这不是"没有行"，是读不到）
    const ghostRoot = path.join(os.tmpdir(), `agentio-l2-ghost-${process.pid}-${Date.now()}`);
    const unreachable = reconcileLedgerIds(ghostRoot, ['T-#X']);
    assert.equal(unreachable.unavailable, 'unreachable');
    assert.equal(unreachable.ok, false);
    assert.ok(!unreachable.note.startsWith('一致'));;
  }));

// ─────────────────────────────────────────── ⑥ 解析器（纯函数 + 真实 MD 上的一致性）

test('⑥a 切分：`\\|` 是字面竖线、code span 里的 `|` 不切格、末尾 `\\|` 不 pop', () => {
  assert.deepEqual(splitTableRow('| a | b \\| c | d |').cells, [' a ', ' b | c ', ' d ']);
  assert.deepEqual(splitTableRow('| `a|b` | c |').cells, [' `a|b` ', ' c ']);
  assert.deepEqual(splitTableRow('| a \\|').cells, [' a |'], '末尾转义竖线不是分隔符');
  assert.deepEqual(splitTableRow('| a | b |').cells, [' a ', ' b ']);
});

test('⑥b id 口径：整格才是身份；行内出现只进引用', () => {
  assert.equal(businessIdOfCell('**T-#X**'), 'T-#X');
  assert.equal(businessIdOfCell(' `R53` '), 'R53');
  assert.equal(businessIdOfCell('见 R53'), null, '含 id 不等于就是 id（strict 口径）');
  const parsed = parseTodoMd('| T-#ONE | 见 R53 与 A7 与 T-#OTHER | 出处 |\n', { sourceName: 'x.md' });
  const row = parsed.rows.find((r) => r.refId === 'T-#ONE')!;
  assert.ok(row.referencedIds.includes('R53'), '非首格出现的 id 归 referenced_ids');
  assert.equal(parsed.rows.some((r) => r.refId === 'R53'), false, '引用不许变成行身份（否则 hangRow 撞唯一索引）');
});

test('⑥c 无表头表：首行**不许**被当表头吃掉（同一份文件里有表头的表和没表头的表）', () => {
  const md = [
    '## §G · 历史账区',
    '',
    '| 编号 | 任务 |',
    '|---|---|',
    '| T1 | 有表头的表第一行 |',
    '| T2 | 有表头的表第二行 |',
    '',
    '| T3 | 无表头的 2 列表 |',
    '| T4 | 又一行 |',
    '',
  ].join('\n');
  const parsed = parseTodoMd(md, { sourceName: 'x.md' });
  const ids = parsed.rows.filter((r) => r.kind === 'task').map((r) => r.refId);
  assert.ok(ids.includes('T1') && ids.includes('T2'), '有表头的表两行都是数据');
  assert.ok(ids.includes('T3') && ids.includes('T4'), '无表头表的**第一条数据行**也必须在（按"每节第一行当表头"⇒ 红）');
  assert.ok(parsed.stats.headerless_tables >= 1, '必须认出"没有分隔行 ⇒ 无表头表"');
});

test('⑥d 真实 MD：半转义行整行进桶（cells=1）；每条整格 id 行都在库里；围栏分节正确', () =>
  inSandbox((fx) => {
    const text = mdText(fx);
    const parsed = parseTodoMd(text, { sourceName: 'docs/todo.md' });
    // ① 半转义行：许切不许丢 —— cells 只有一格（整行），且原文逐字在
    const halfEscaped = parsed.rows.filter((r) => r.dirty?.bucket === 'half-escaped');
    assert.ok(halfEscaped.length > 0, '本文件的 §E 里必须有"一行粘了另一行"的行（否则这条用例没测到东西）');
    for (const r of halfEscaped) {
      assert.equal(r.cells.length, 1, '半转义行**不许切**（切了就丢内容）');
      assert.equal(r.cells[0], r.raw.trim(), '整行原文逐字保留');
    }
    // ② 独立复算 id 集合：**不抄解析器的中间结果**，用导出的切分原语从源文本重新数一遍
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const expected = new Set<string>();
    let fence = false;
    for (const line of text.split(eol)) {
      if (/^\s*```/.test(line)) { fence = !fence; continue; }
      if (fence || !/^\s*\|/.test(line)) continue;
      const id = businessIdOfCell(splitTableRow(line).cells[0]);
      if (id) expected.add(id);
    }
    const got = new Set(parsed.rows.filter((r) => r.kind === 'task').map((r) => r.refId));
    const missing = [...expected].filter((id) => !got.has(id));
    assert.deepEqual(missing, [], '整格是 id 的表格行一条都不许漏（漏行与"本来没有"在库里长得一样）');
    assert.equal(got.size, parsed.rows.filter((r) => r.kind === 'task').length, 'task 行不许出现重复 ref_id');
    // ③ 围栏分节：ruling **只**来自 §F；§A 的围栏行是 meta/prose
    const rulings = parsed.rows.filter((r) => r.kind === 'ruling');
    assert.ok(rulings.length > 0, '§F 必须产出裁决行');
    for (const r of rulings) assert.equal(r.section, '§F', '§A 的围栏不是裁决（"任何围栏都进 ruling"⇒ 红）');
    assert.equal(parsed.stats.fence_body_unparsed, 0, '§F 围栏里不许有"认不出"的行（认不出 = 一条裁决被降级成散文）');
  }));

// ─────────────────────────────────────────── ⑦ subject 关系层 + ⑧ §F 第三实体

test('⑦ subject：engine 同 subject 拒并点名 → declareSupersedes 成 → 销账后可重挂', () =>
  inSandbox((fx) => {
    const subject = { path: 'src/l2/subject_probe.ts', symbol: 'fnY' };
    hangRow(fx.project, { refId: 'T-#SUBJ-A', section: '§E', title: 'A 占着这个 subject', subject, by: 'tester' });
    assert.throws(
      () => hangRow(fx.project, { refId: 'T-#SUBJ-B', section: '§E', title: 'B 也想要', subject, by: 'tester' }),
      /已被 T-#SUBJ-A 占用/,
      '同 subject 两条活跃 engine 行必须被拒，且报文点名占用者',
    );

    hangRow(fx.project, {
      refId: 'T-#SUBJ-B', section: '§E', title: 'B 明确取代 A', subject, declareSupersedes: 'T-#SUBJ-A', by: 'tester',
    });
    const a = getRow(fx.project, 'T-#SUBJ-A')!;
    assert.equal(a.superseded_by, 'T-#SUBJ-B', '关系指针必须落下');
    assert.equal(a.state, 'active', 'superseded 是关系不是结局（state 不许改成 done）');
    assert.ok(a.events.some((e) => e.kind === 'supersede'), '取代必须留痕');
    assert.doesNotThrow(
      () => hangRow(fx.project, { refId: 'T-#SUBJ-C', section: '§E', title: 'C 另起 subject', subject: { path: 'src/l2/other.ts' }, by: 'tester' }),
      '不同 subject 互不影响',
    );

    // 销账后可重挂（部分索引只钉活跃行；且被取代行不再占键）
    closeRow(fx.project, 'T-#SUBJ-A', 'void', '已被 B 取代', 'T-#SUBJ-B', 'tester');
    closeRow(fx.project, 'T-#SUBJ-B', 'done', 'B 自己落地了', 'commit deadbeef', 'tester');
    assert.doesNotThrow(
      () => hangRow(fx.project, { refId: 'T-#SUBJ-D', section: '§E', title: 'D 接管', subject, by: 'tester' }),
      '占用者被销账之后，同 subject 必须可重挂',
    );
  }));

test('⑦b import 存量行**豁免**唯一索引，但 subjectConflicts() 点名 + 队列里有一组（灯亮但不阻塞）', () =>
  inSandbox((fx) => {
    // 一份**小夹具 MD**：两行指向同一个 subject（存量冲突的最小形态）
    const md = [
      '## §A · 夹具',
      '',
      '| T-#DUP-1 | 甲：改 `src/dup.ts` 的那处 | x |',
      '| T-#DUP-2 | 乙：也改 `src/dup.ts` | x |',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(fx.project, 'docs', 'dup.md'), md, 'utf-8');
    const rep = importLedger(fx.project, { mode: 'refresh', sourcePath: 'docs/dup.md' });
    assert.ok(rep.added >= 2, '两行都该进库（import 行不许被新约束当场判非法）');

    const groups = subjectConflicts(fx.project);
    assert.equal(groups.length, 1, '同 subject 的两条 import 行必须被点名成一组');
    assert.equal(groups[0].subject_path, 'src/dup.ts');
    assert.deepEqual(groups[0].members.map((m) => m.ref_id).sort(), ['T-#DUP-1', 'T-#DUP-2']);
    assert.ok(groups[0].members.every((m) => m.origin === 'import'), '成员必须标明来路（import）');

    const queued = listReviewQueue(fx.project, { reason: 'subject-conflict' });
    assert.equal(queued.length, 1, '每组冲突必须同时插一条可消项（灯亮着，但不阻塞迁移）');
    // 再导一遍：队列不许刷屏（未消项唯一）
    importLedger(fx.project, { mode: 'reconcile', sourcePath: 'docs/dup.md' });
    assert.equal(listReviewQueue(fx.project, { reason: 'subject-conflict' }).length, 1, '重复 import 不许把队列撑大');
    // 可消项：消掉之后不再亮
    resolveReview(fx.project, queued[0].id, 'tester');
    assert.equal(listReviewQueue(fx.project, { reason: 'subject-conflict' }).length, 0);

    // ★ 存量行（import）不许挡住 engine 挂账：这正是"豁免但可查"的语义
    assert.doesNotThrow(() =>
      hangRow(fx.project, {
        refId: 'T-#ENG-ON-IMPORTED', section: '§E', title: '引擎在这一处也挂了一条', subject: { path: 'src/dup.ts' }, by: 'tester',
      }),
    );
  }));

test('⑧ §F 裁决：捆绑行拆多 key；默认 listActive 不含 ruling/prose/meta', () =>
  inSandbox((fx) => {
    const text = mdText(fx);
    const parsed = parseTodoMd(text, { sourceName: 'docs/todo.md' });
    const rulings = parsed.rows.filter((r) => r.kind === 'ruling');
    const byOrdinal = new Map<number, typeof rulings>();
    for (const r of rulings) byOrdinal.set(r.ordinal, [...(byOrdinal.get(r.ordinal) ?? []), r]);
    // key 必须真的出现在那一行里；捆绑行（`A / B / C  说明`）必须拆成多条
    for (const [ordinal, group] of byOrdinal) {
      for (const r of group) assert.ok(r.raw.includes(r.refId), `ruling ${r.refId} 的 key 必须逐字出现在原行（L${ordinal}）`);
      const raw = group[0].raw;
      const keySeg = raw.trim().split(/\s{2,}/)[0];
      if (keySeg.includes('/')) {
        assert.ok(group.length > 1, `捆绑行（L${ordinal}：${keySeg}）必须拆成多 key —— 按物理行落库 ⇒ 红`);
      }
    }
    importLedger(fx.project, { mode: 'refresh' });
    const active = listActive(fx.project);
    assert.ok(active.rows.every((r) => r.record_kind === 'task'), '默认活跃集只含 task（去不掉 record_kind 过滤 ⇒ 红）');
    const all = listActive(fx.project, { recordKind: 'all' });
    assert.ok(all.rows.some((r) => r.record_kind === 'ruling'), 'recordKind:all 时必须能读到裁决行（它确实在库里）');
    const ruling = listRows(fx.project, { recordKinds: ['ruling'], withSource: true });
    assert.ok(ruling.every((r) => r.section === '§F'));
    assert.ok(ruling.every((r) => r.state === 'active'), '裁决行不被"销账"——它没有生命周期');
  }));

// ─────────────────────────────────────────── 语义原语（subject 归一）

test('subject 归一：`:行号` 剥掉、`\\`→`/`、裸文件名不认、通配不认', () => {
  const a = extractSubjectAnchors('见 `src/x.ts:103-121` 与 `src/x.ts`');
  assert.deepEqual(a.map((x) => x.path), ['src/x.ts'], '行号剥掉且同文件去重（坐标不是身份）');
  const b = extractSubjectAnchors('改 `src/x.ts#fnY` 这一处');
  assert.deepEqual(b, [{ path: 'src/x.ts', symbol: 'fnY' }]);
  assert.deepEqual(extractSubjectAnchors('`write_gate.ts:2088-2099`'), [], '裸文件名不解析（猜错就造出假冲突）');
  assert.deepEqual(extractSubjectAnchors('`.agent-io/design/*.dsl.json`'), [], '通配是一组文件，不是一个 subject');
  assert.deepEqual(extractSubjectAnchors('`src\\a.ts`').map((x) => x.path), ['src/a.ts'], '反斜杠归一为 /');
  assert.deepEqual(extractSubjectAnchors('`C:\\proj\\src\\a.ts`'), [], '盘符绝对路径不是仓库相对锚点（不猜）');
});
