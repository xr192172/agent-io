/**
 * T-#LEDGER-ENGINE L1 —— 台账引擎（tasks.db 新表 + 写端 + 只读查询）。
 *
 * ## 判据（每条都能打断即红）
 *  1. 销账后 problem/proposal/title 逐字取回；把实现改成 DELETE ⇒ 红。
 *  2. listActive 默认滤掉已销账；去掉过滤 ⇒ 红；includeClosed:true ⇒ closed_count=1。
 *  3. 重复销账被拒并点名首次时刻/证据；活跃 ref_id 重复挂被拒；reopen 后可再销。
 *  4. append-only 双保险：直接 SQL UPDATE/DELETE ledger_events ⇒ 触发器 ABORT（打断即红）；
 *     批注/裁定/销账各追加事件，第一条 body 永远逐字在。
 *  5. manifest:check 跑在干净仓上仍绿（加表不撞卷表）；只读查询不产 0 字节文件。
 *  6. superseded 是关系不是结局：state 保持 active + superseded_by 指针 + supersede 事件。
 *
 * 夹具仿 tests/p0_task_write_locked.test.ts:40-51：makeTempHome + AGENT_IO_HOME + rmRf + closeAll。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { getTasksDbFile, openTasksDb } from '../src/infrastructure/task_history.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import {
  hangRow, annotateRow, closeRow, reopenRow, supersedeRow, writeVerdict, listActive, getRow,
} from '../src/application/ledger/ledger.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const FEATURE = `__ledger_l1_${process.pid}`;

interface Fixture { home: string; project: string; prevHome: string | undefined; prevDataRoot: string | undefined }

/** 每个用例自己的临时数据仓 + 临时项目根（projectRoot 必须是可达目录，openTasksDb 才肯建库） */
function setup(): Fixture {
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-ledger-proj-'));
  delete process.env.AGENT_IO_DATA_ROOT; // ★ 必须删：DATA_ROOT 优先级高于 HOME，会抢走夹具
  process.env.AGENT_IO_HOME = home;
  registerFeature(FEATURE, project, 'p1_ledger_engine.test'); // 注册表 = 唯一入口
  return { home, project, prevHome, prevDataRoot };
}

function teardown(fx: Fixture): void {
  if (fx.prevHome === undefined) delete process.env.AGENT_IO_HOME; else process.env.AGENT_IO_HOME = fx.prevHome;
  if (fx.prevDataRoot === undefined) delete process.env.AGENT_IO_DATA_ROOT; else process.env.AGENT_IO_DATA_ROOT = fx.prevDataRoot;
  rmRf(fx.home);
  rmRf(fx.project);
}

function inSandbox(fn: (fx: Fixture) => void): void {
  const fx = setup();
  try { fn(fx); } finally { teardown(fx); }
}

const hang = (fx: Fixture, refId: string, extra?: { problem?: string; proposal?: string }) =>
  hangRow(fx.project, {
    refId, section: '§E', title: `标题 ${refId}`,
    problem: extra?.problem ?? '原问题：逐字保留  含空格',
    proposal: extra?.proposal ?? '原提案：逐字保留\n含换行',
    by: 'alice',
  });

test('① 销账不是删：done 行的 body 逐字可取回；UPDATE 不碰 problem/proposal', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-A');
    annotateRow(fx.project, 'T-#LEDGER-L1-A', '  反驳：保留首尾空格  ', 'bob');
    const before = getRow(fx.project, 'T-#LEDGER-L1-A')!;
    closeRow(fx.project, 'T-#LEDGER-L1-A', 'done', '已落地', 'commit abc123', 'carol');
    const after = getRow(fx.project, 'T-#LEDGER-L1-A')!;
    assert.equal(after.title, before.title, 'title 必须逐字不改写');
    assert.equal(after.problem, before.problem, 'problem 必须逐字不改写（改 DELETE 则红）');
    assert.equal(after.proposal, before.proposal, 'proposal 必须逐字不改写');
    assert.equal(after.state, 'done');
    assert.equal(after.closed_reason, '已落地');
    assert.equal(after.closed_evidence, 'commit abc123');
    const ann = after.events.find((e) => e.kind === 'annotate')!;
    assert.equal(ann.body, '  反驳：保留首尾空格  ', '批注逐字取回（不 trim、不摘要）');
  }));

test('② 活跃集默认滤已销账；includeClosed:true 给 closed_count', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-ACTIVE');
    hang(fx, 'T-#LEDGER-L1-CLOSED');
    closeRow(fx.project, 'T-#LEDGER-L1-CLOSED', 'void', '重复账', '见 T-#N1', 'dave');

    const def = listActive(fx.project);
    assert.deepEqual(def.rows.map((r) => r.ref_id), ['T-#LEDGER-L1-ACTIVE'], '默认只含活跃行（去掉过滤则红）');
    assert.equal(def.closed_count, 0);

    const all = listActive(fx.project, { section: '§E', includeClosed: true });
    assert.deepEqual(all.rows.map((r) => r.ref_id), ['T-#LEDGER-L1-ACTIVE'], 'includeClosed 不改变 rows 的活跃语义');
    assert.equal(all.closed_count, 1, 'includeClosed:true 必须返回 closed_count');
    assert.deepEqual(listActive(fx.project, { section: '不存在' }).rows, [], 'section 过滤有效');
  }));

test('③ 活跃期重复挂被部分唯一索引拒；销账后同 ref_id 可重挂；重复销账被拒（首次证据可考古）', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-DUP');
    // ★ 部分唯一索引只钉**活跃**行：没销账就再挂 ⇒ 拒
    assert.throws(
      () => hang(fx, 'T-#LEDGER-L1-DUP'),
      /已在活跃期挂账/,
      '活跃期重复挂必须被部分唯一索引层拒绝',
    );
    closeRow(fx.project, 'T-#LEDGER-L1-DUP', 'done', '首次原因', '首次证据', 'eve');
    assert.throws(
      () => closeRow(fx.project, 'T-#LEDGER-L1-DUP', 'void', '再来一次', 'x', 'eve'),
      /没有活跃挂账行/,
      '第二次销账必须拒，不许静默覆盖',
    );
    const closed = getRow(fx.project, 'T-#LEDGER-L1-DUP')!;
    assert.equal(closed.closed_reason, '首次原因');
    assert.equal(closed.closed_at !== null, true, '首次销账时刻必须还在（重复销账没覆盖）');
    assert.equal(closed.events.filter((e) => e.kind === 'close').length, 1, 'close 事件只能有一条');
    assert.match(closed.events.filter((e) => e.kind === 'close')[0].body!, /首次证据/, '首次证据在事件 body 里可考古');

    // ★ 销账后同 ref_id **可重新挂账**（部分唯一索引只管活跃行）——这才是"逻辑删除"的完整语义
    hang(fx, 'T-#LEDGER-L1-DUP');
    const active = listActive(fx.project).rows.filter((r) => r.ref_id === 'T-#LEDGER-L1-DUP');
    assert.equal(active.length, 1, '重挂后活跃集里同 ref_id 恰一行');
    assert.notEqual(active[0].row_id, closed.row_id, '重挂是新行（旧行连同证据保留可考古）');
    assert.equal(getRow(fx.project, 'T-#LEDGER-L1-DUP')!.row_id, active[0].row_id, 'getRow 确定性取活跃行');
  }));

test('④ reopen 留痕且可再销；活跃期重复挂账仍被拒（重开后同 ref_id 只有一行）', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-REOPEN');
    closeRow(fx.project, 'T-#LEDGER-L1-REOPEN', 'void', '先作废', 'old-evidence', 'frank');
    reopenRow(fx.project, 'T-#LEDGER-L1-REOPEN', 'grace');
    const mid = getRow(fx.project, 'T-#LEDGER-L1-REOPEN')!;
    assert.equal(mid.state, 'active');
    assert.equal(mid.events.at(-1)!.kind, 'reopen', 'reopen 必须留痕');
    assert.throws(() => reopenRow(fx.project, 'T-#LEDGER-L1-REOPEN', 'grace'), /已经活跃/);
    closeRow(fx.project, 'T-#LEDGER-L1-REOPEN', 'done', '重开后落地', 'new-evidence', 'heidi');
    const done = getRow(fx.project, 'T-#LEDGER-L1-REOPEN')!;
    assert.equal(done.events.filter((e) => e.kind === 'close').length, 2, '两次销账 = 两条 close 事件');
    assert.match(done.events.filter((e) => e.kind === 'close')[1].body!, /new-evidence/);
    assert.equal(listActive(fx.project).rows.length, 0, '再销后活跃集又为空');
  }));

test('⑤ append-only：直接 SQL UPDATE / DELETE ledger_events 被触发器 ABORT（打断即红）', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-IMMUTABLE');
    annotateRow(fx.project, 'T-#LEDGER-L1-IMMUTABLE', '第一条批注', 'ivan');
    const first = getRow(fx.project, 'T-#LEDGER-L1-IMMUTABLE')!.events.find((e) => e.kind === 'annotate')!;

    const db = openTasksDb(fx.project);
    try {
      assert.throws(
        () => db.prepare('UPDATE ledger_events SET body = ? WHERE id = ?').run('篡改', first.id),
        /append-only/,
        '绕过模块直接 UPDATE 事件也必须被触发器打回',
      );
      assert.throws(
        () => db.prepare('DELETE FROM ledger_events WHERE id = ?').run(first.id),
        /append-only/,
        '绕过模块直接 DELETE 事件也必须被触发器打回',
      );
    } finally {
      db.close();
    }
    const after = getRow(fx.project, 'T-#LEDGER-L1-IMMUTABLE')!.events.find((e) => e.kind === 'annotate')!;
    assert.equal(after.body, '第一条批注', '正文逐字未变');

    // 多轮追加：前一条逐字仍在，seq 严格递增
    annotateRow(fx.project, 'T-#LEDGER-L1-IMMUTABLE', '第二条批注\n多行', 'ivan');
    writeVerdict(fx.project, 'T-#LEDGER-L1-IMMUTABLE', 'lead 裁定：保留', 'lead');
    const evs = getRow(fx.project, 'T-#LEDGER-L1-IMMUTABLE')!.events;
    const ann = evs.filter((e) => e.kind === 'annotate');
    assert.deepEqual(ann.map((e) => e.body), ['第一条批注', '第二条批注\n多行']);
    assert.deepEqual(evs.map((e) => e.seq), evs.map((_, i) => i + 1), 'seq 从 1 连续递增');
    assert.equal(evs.at(-1)!.kind, 'verdict');
  }));

test('⑥ supersede 是关系不是结局：state 仍 active + 指针 + 事件', () =>
  inSandbox((fx) => {
    hang(fx, 'T-#LEDGER-L1-OLD');
    hang(fx, 'T-#LEDGER-L1-NEW');
    supersedeRow(fx.project, 'T-#LEDGER-L1-OLD', 'T-#LEDGER-L1-NEW', 'judy');
    const old = getRow(fx.project, 'T-#LEDGER-L1-OLD')!;
    assert.equal(old.state, 'active', 'superseded 不是结局（不许用 state=superseded）');
    assert.equal(old.superseded_by, 'T-#LEDGER-L1-NEW');
    // ★ T-#LEDGER-CURRENT-PROJECTION 的另一半：默认只回 current，includeSuperseded 保留考古口径（旧行仍 active，不新增 superseded state）
    assert.equal(listActive(fx.project, { includeSuperseded: true }).rows.length, 2, 'includeSuperseded:true 必须能查回被取代行');
    assert.equal(old.state, 'active', '取代不改 state（不新增 superseded 值）');
    const sup = old.events.find((e) => e.kind === 'supersede')!;
    assert.equal(sup.body, 'superseded_by=T-#LEDGER-L1-NEW');
    assert.equal(typeof sup.supersedes_event_id, 'number', 'supersede 事件指向前一条事件');
    assert.equal(listActive(fx.project).rows.length, 1, '默认活跃集只回 current：被取代行不进派单/提醒');
  }));

test('⑦ 只读路径不产 0 字节库；manifest:check 仍绿（加表不撞卷表）', () =>
  inSandbox((fx) => {
    // 只读查询一个从未写过的 tasks.db ⇒ 不许建库（T-#DBSYNC-CREATES-SHELL 先例）
    const dbFile = getTasksDbFile(fx.project);
    assert.equal(fs.existsSync(dbFile), false, '夹具一开始没有 tasks.db');
    assert.deepEqual(listActive(fx.project), { rows: [], closed_count: 0 });
    assert.equal(getRow(fx.project, 'T-#NOPE'), null);
    assert.equal(fs.existsSync(dbFile), false, '只读查询不许创建 0 字节 tasks.db（openTasksDbForRead 口径）');

    // 写一行后仍有库；manifest 卷表声明的是 tasks.db 这个文件，不是表 ⇒ 加表不影响对账
    hang(fx, 'T-#LEDGER-L1-MANIFEST');
    assert.equal(fs.statSync(dbFile).size > 0, true);
    const repoRoot = path.resolve(process.cwd()); // runner 的 cwd = 仓库根（scripts/run-tests.mjs:319 cwd: ROOT）
    const r = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'gen_manifest.mjs'), '--check'], {
      cwd: repoRoot, encoding: 'utf8', shell: false,
    });
    assert.equal(r.status, 0, `manifest:check 必须仍绿：${(r.stdout ?? '') + (r.stderr ?? '')}`);
  }));
