/**
 * P1 —— **台账工具面**（`ledger` 单工具 + 10 action）：`closeRow` / `reopenRow` 从 L1 就在，
 * 而在此之前**全仓零工具面** ⇒ 销账只能靠"在批注里说已落地"（实测后果：`T-#LEDGER-STATE-HYGIENE`，
 * 台账 task 行 315 条全 active）。本文件钉住"这面真的接到了引擎上"。
 *
 * ## 判据（每条都能打断即红 —— "打断"= 改坏哪一处会让它红，见各用例尾注）
 *  ① 工具面存在且形态对：`ledger` 在 `TOOL_DEFS`、注解齐、`action` 闭集 = 10 个、`writes:false`；
 *     `handler({})` 回**人话**（`缺参数 "action"`）而不是 Node 原始异常 —— 改成静默返 undefined ⇒ 红。
 *  ② 未知 action 被拒并**列出全部合法值**：删掉 `actionOf` 的闭集判断 ⇒ 红。
 *  ③ hang：挂账落到引擎（list/get 都看得见）· 参数形状错（只给 subject_symbol）⇒ 拒。
 *  ④ annotate：**只追加事件、不改 state**（这条是本次指令的核心反面：批注 ≠ 销账）。
 *  ⑤ close：**状态翻转**（state=done + closed_* + close 事件）；之后再 annotate 也不会把它拉回 active。
 *  ⑥ close 的结局闭集 = **done / void**：`wontfix` 在两面都被拒（MCP 面 = zod；绕过 zod = 引擎原文）。
 *  ⑦ reopen：state 回 active + reopen 留痕 + closed_* 清空但 close 事件体仍在（可考古）。
 *  ⑧ supersede：指针 + 事件，**state 仍 active**（关系不是结局）。
 *  ⑨ verdict：只追加，前一条 annotate 逐字仍在。
 *  ⑩ review_queue / resolve_review：读数带 availability；消项后默认不再出现，`open_only:false` 仍给历史。
 *  ⑪ 读的诚实：库不在场时 `list`/`get` 给 `availability != 'ok'` 且报文**明说"读不到 ≠ 0 条"**
 *     —— 把 availability 从回执里删掉 ⇒ 红。
 *  ⑫ **写闸口径**：`writes:false` 有牙（`via:'tool'` 拿 ledger 的名字写设计册 ⇒ 点名拒绝），
 *     而台账自己的写动作**不需要**任何 DSL 写授权且**不产设计册**；
 *     消融：把声明临时改成 true ⇒ 同一次写就放行（证明判定真的读那个声明）。
 *  ⑬ 消融（透传零重写）：活跃期重复挂、销账不存在的行、空 body 批注 —— 报文**逐字来自引擎**
 *     （本工具一旦自己组织这些话，就不再是透传）。
 *
 * 夹具仿 `tests/p1_ledger_engine.test.ts:34-55`：makeTempHome + AGENT_IO_HOME + rmRf。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { TOOL_ANNOTATIONS } from '../src/application/tool_annotations.js';
import { getRow, queueReview, readReviewQueue, supersedeRow } from '../src/application/ledger/ledger.js';
import { getTasksDbFile } from '../src/infrastructure/task_history.js';
import { parseDataBlock } from '../src/application/plumbing.js';
import { LEDGER_ACTIONS } from '../src/application/meta/ledger/tool.js';
import { bindWritesOf, runDslWriteScope, toolWritesOf, toolWritesTable } from '../src/infrastructure/dsl_write_scope.js';
import { getDesignSheet, saveDSL } from '../src/infrastructure/storage.js';
import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { makeTempHome, rmRf, writeMinimalFeature } from './helpers/i1_fixture.js';

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
  prevDataRoot: string | undefined;
  prevBackfill: string | undefined;
}

/** 每个用例自己的临时数据仓 + 临时项目根（`openTasksDb` 要可达目录才肯建库） */
function setup(): Fixture {
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const prevBackfill = process.env.AGENT_IO_AUTO_BACKFILL;
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-ledger-tool-proj-'));
  delete process.env.AGENT_IO_DATA_ROOT; // ★ DATA_ROOT 优先级高于 HOME，会抢走夹具
  process.env.AGENT_IO_HOME = home;
  // ★ 关掉"首触建索引"：本文件钉的是台账面，不是索引；否则每个用例白建一份 cache.db。
  process.env.AGENT_IO_AUTO_BACKFILL = '0';
  return { home, project, prevHome, prevDataRoot, prevBackfill };
}

function teardown(fx: Fixture): void {
  if (fx.prevHome === undefined) delete process.env.AGENT_IO_HOME;
  else process.env.AGENT_IO_HOME = fx.prevHome;
  if (fx.prevDataRoot === undefined) delete process.env.AGENT_IO_DATA_ROOT;
  else process.env.AGENT_IO_DATA_ROOT = fx.prevDataRoot;
  if (fx.prevBackfill === undefined) delete process.env.AGENT_IO_AUTO_BACKFILL;
  else process.env.AGENT_IO_AUTO_BACKFILL = fx.prevBackfill;
  rmRf(fx.home);
  rmRf(fx.project);
}

async function inSandbox(fn: (fx: Fixture) => Promise<void>): Promise<void> {
  const fx = setup();
  try {
    await fn(fx);
  } finally {
    teardown(fx);
  }
}

/** 注册表里的 `ledger` def（缺失 ⇒ 每条用例都当场红，而不是"跳过"） */
function ledgerDef() {
  const def = TOOL_DEFS.find((d) => d.name === 'ledger');
  assert.ok(def, '`ledger` 必须注册在 TOOL_DEFS（台账写/读面的唯一入口）');
  return def;
}

/** 走**唯一咽喉** `invokeTool`（= MCP / CLI 同一个面：先 zod、再 handler） */
async function call(fx: Fixture, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; data: any }> {
  const r = await invokeTool(ledgerDef(), { project_dir: fx.project, ...args }, 'cert');
  const text = String(r.text ?? '');
  return { text, isError: r.isError === true, data: parseDataBlock(text) as any };
}

const hangArgs = (refId: string, extra: Record<string, unknown> = {}) => ({
  action: 'hang',
  ref_id: refId,
  section: '§I',
  title: `标题 ${refId}`,
  problem: '原问题：逐字保留  含空格',
  proposal: '原提案：逐字保留\n含换行',
  by: 'alice',
  ...extra,
});

test('① 工具面形态：已注册 · 注解齐 · action 闭集 10 个 · writes:false · handler({}) 回人话', async () => {
  const def = ledgerDef();
  assert.equal(def.writes, false, '台账写的是 tasks.db，不是设计册 ⇒ writes 必须 false（口径见 ToolDef.writes）');
  assert.ok(TOOL_ANNOTATIONS.ledger, 'TOOL_ANNOTATIONS 必须有 ledger 的键（缺键 ⇒ tool_registry 加载期就抛）');
  assert.equal(TOOL_ANNOTATIONS.ledger.readOnlyHint, false, '它有 7 个写动作 ⇒ readOnlyHint 必须是 false（保守方向）');
  assert.deepEqual([...LEDGER_ACTIONS], [
    'hang',
    'annotate',
    'close',
    'reopen',
    'supersede',
    'verdict',
    'list',
    'get',
    'conflicts',
    'review_queue',
    'resolve_review',
  ]);
  // ★ 二席驳斥 #1：`origin` **不在面上**（工具只许造 engine 行；import 行只能由 importer 产生）
  assert.equal('origin' in def.inputSchema, false, 'origin 不许出现在工具 schema 里（后门必须从面上消失）');
  // ★ 二席驳斥 #5：审计链边界必须写在工具面上（模型读的那一面）
  assert.match(def.description, /真相状态变更/, 'description 必须写明"台账写 = 真相状态变更"');
  assert.match(def.description, /write_log/, 'description 必须写明 write_log 不覆盖台账写（审计链边界）');
  // ★ mcp_scan 的口径：**绕过 zod** 直接调 handler，看缺参守卫回的是人话还是 Node 原始异常。
  const r = await def.handler({});
  assert.equal(r.isError, true);
  assert.match(String(r.text), /^缺参数 "action"/, `handler({}) 必须回人话缺参报文，实际：${r.text}`);
});

test('② 未知 action ⇒ 两面都拒：MCP 面 zod 拦、绕过 zod 时 handler 列出全部合法值（删掉闭集判断则红）', () =>
  inSandbox(async (fx) => {
    // ① MCP 面（`invokeTool` = 先 zod）：未知枚举值在这里就被拦下
    const face = await call(fx, { action: 'closeRow' });
    assert.equal(face.isError, true, '未知 action 必须拒');
    assert.match(face.text, /schema 校验/, `MCP 面应报入参校验失败，实际：${face.text}`);
    // ② 绕过 zod（= mcp_scan / CLI 的直调形态）：handler 自己必须点名未知动作 + 列出合法值
    const r = await ledgerDef().handler({ action: 'closeRow', project_dir: fx.project });
    assert.equal(r.isError, true);
    assert.match(String(r.text), /未知 action "closeRow"/, `应该点名未知动作，实际：${r.text}`);
    for (const a of LEDGER_ACTIONS) assert.ok(String(r.text).includes(a), `报文必须列出合法值 ${a}`);
  }));

test('③ hang：挂账落到引擎（list / get 都看得见）；subject_symbol 单给 ⇒ 拒', () =>
  inSandbox(async (fx) => {
    const r = await call(fx, hangArgs('T-#LT-1'));
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.row_id > 0, true, '挂账回执必须带 row_id（来自引擎返回值）');
    assert.match(r.text, /state=active/);

    const list = await call(fx, { action: 'list' });
    assert.equal(list.isError, false, list.text);
    assert.deepEqual(
      list.data.rows.map((x: any) => x.ref_id),
      ['T-#LT-1'],
    );
    assert.equal(list.data.availability, 'ok');

    const got = await call(fx, { action: 'get', ref_id: 'T-#LT-1' });
    assert.equal(got.data.found, true);
    assert.equal(got.data.row.problem, '原问题：逐字保留  含空格', 'problem 必须逐字（工具不许加工）');
    assert.equal(got.data.row.events.at(-1).kind, 'hang');

    const bad = await call(fx, hangArgs('T-#LT-1b', { subject_symbol: 'fn' }));
    assert.equal(bad.isError, true);
    assert.match(bad.text, /subject_symbol.*subject_path/, '单给符号是"说错话"，必须拒');
  }));

test('④ annotate：只追加事件、**不改 state**（批注 ≠ 销账 —— 本次指令的核心反面）', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-2'));
    const r = await call(fx, { action: 'annotate', ref_id: 'T-#LT-2', body: '  批注：保留首尾空格  ', by: 'bob' });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /不翻转 state/);

    const row = getRow(fx.project, 'T-#LT-2')!; // ★ 断言走**引擎**（独立于工具的回执）
    assert.equal(row.state, 'active', 'annotate 之后行必须仍 active（这就是"批注代替销账"的病根）');
    assert.equal(row.problem, '原问题：逐字保留  含空格', '批注不碰任何列');
    const ann = row.events.find((e) => e.kind === 'annotate')!;
    assert.equal(ann.body, '  批注：保留首尾空格  ', '批注逐字（不 trim、不摘要）');
  }));

test('⑤ close：**状态翻转**（state=done + closed_* + close 事件），之后 annotate 也拉不回来', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-3'));
    const r = await call(fx, {
      action: 'close',
      ref_id: 'T-#LT-3',
      state: 'done',
      reason: '已落地',
      evidence: 'commit abc123',
      by: 'carol',
    });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /状态已翻转/);

    const done = getRow(fx.project, 'T-#LT-3')!;
    assert.equal(done.state, 'done', 'closeRow 必须真的翻转 state（改成只追加事件 ⇒ 红）');
    assert.equal(done.closed_reason, '已落地');
    assert.equal(done.closed_evidence, 'commit abc123');
    assert.equal(typeof done.closed_at, 'string');
    assert.equal(done.events.filter((e) => e.kind === 'close').length, 1);

    await call(fx, { action: 'annotate', ref_id: 'T-#LT-3', body: '再补一句', by: 'carol' });
    assert.equal(getRow(fx.project, 'T-#LT-3')!.state, 'done', '补批注不许把已销账的行拉回 active');
    const list = await call(fx, { action: 'list' });
    assert.deepEqual(list.data.rows, [], '销账后不在活跃集里');

    const closed = await call(fx, { action: 'list', include_closed: true });
    assert.equal(closed.data.closed_count, 1, 'include_closed 才给已销账行数');
  }));

test('⑥ close 的结局闭集 = done / void：wontfix 两面都被拒（MCP 面 zod · 绕过 zod 走引擎原文）', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-4'));
    // ① MCP 面：zod enum 拦下（报文点名字段，不点值 —— 与既有 schema 层同形）
    const viaFace = await call(fx, {
      action: 'close',
      ref_id: 'T-#LT-4',
      state: 'wontfix',
      reason: '不修',
      evidence: 'x',
      by: 'dave',
    });
    assert.equal(viaFace.isError, true, 'wontfix 不是闭集里的值 ⇒ MCP 面必须拒（不是静默当 void）');
    assert.match(viaFace.text, /state/, `报文要点名 state 字段，实际：${viaFace.text}`);
    // ② 绕过 zod（= mcp_scan 的调用形态）⇒ 引擎自己的闭集判断原文
    const viaEngine = await ledgerDef().handler({
      action: 'close',
      project_dir: fx.project,
      ref_id: 'T-#LT-4',
      state: 'wontfix',
      reason: '不修',
      evidence: 'x',
      by: 'dave',
    });
    assert.equal(viaEngine.isError, true);
    assert.match(String(viaEngine.text), /只能是 done\/void/, '闭集判定必须来自引擎（本工具不重写它）');
    assert.equal(getRow(fx.project, 'T-#LT-4')!.state, 'active', '被拒的销账不许留下任何痕迹（state 仍是 active）');
  }));

test('⑦ reopen：state 回 active · reopen 留痕 · closed_* 清空但 close 事件体仍可考古', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-5'));
    await call(fx, { action: 'close', ref_id: 'T-#LT-5', state: 'void', reason: '先作废', evidence: 'old-evidence', by: 'eve' });
    const r = await call(fx, { action: 'reopen', ref_id: 'T-#LT-5', by: 'frank' });
    assert.equal(r.isError, false, r.text);

    const row = getRow(fx.project, 'T-#LT-5')!;
    assert.equal(row.state, 'active');
    assert.equal(row.closed_at, null);
    assert.equal(row.events.at(-1)!.kind, 'reopen', '重开必须留痕');
    assert.match(row.events.find((e) => e.kind === 'close')!.body!, /old-evidence/, '上次销账证据在 close 事件体里');
  }));

test('⑧ supersede：指针 + 事件，**state 仍 active**（关系不是结局）', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-6a'));
    await call(fx, hangArgs('T-#LT-6b'));
    const r = await call(fx, { action: 'supersede', ref_id: 'T-#LT-6a', superseded_by: 'T-#LT-6b', by: 'judy' });
    assert.equal(r.isError, false, r.text);
    const row = getRow(fx.project, 'T-#LT-6a')!;
    assert.equal(row.state, 'active', 'superseded 不是结局（不许用 state 表达它）');
    assert.equal(row.superseded_by, 'T-#LT-6b');
    assert.equal(row.events.find((e) => e.kind === 'supersede')!.body, 'superseded_by=T-#LT-6b');
  }));

test('⑨ verdict：只追加，前一条 annotate 逐字仍在（不覆盖历史）', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-7'));
    await call(fx, { action: 'annotate', ref_id: 'T-#LT-7', body: '批注 A', by: 'ivan' });
    const r = await call(fx, { action: 'verdict', ref_id: 'T-#LT-7', body: 'lead 裁定：保留', by: 'lead' });
    assert.equal(r.isError, false, r.text);
    const row = getRow(fx.project, 'T-#LT-7')!;
    assert.deepEqual(
      row.events.map((e) => e.kind),
      ['hang', 'annotate', 'verdict'],
    );
    assert.equal(row.events.find((e) => e.kind === 'annotate')!.body, '批注 A');
  }));

test('⑩ review_queue / resolve_review：读数带 availability；消项后默认不再出现', () =>
  inSandbox(async (fx) => {
    const empty = await call(fx, { action: 'review_queue' });
    assert.equal(empty.isError, false, empty.text);
    // ★ 库里还没有 tasks.db ⇒ 读数是 `no-db`（**不是** ok + 0 条）：`ok` 以外都不是"0 条未消项"。
    assert.equal(empty.data.availability, 'no-db', '队列读数必须带 availability（ok 以外都不是"0 条"）');
    assert.equal(empty.data.items.length, 0);

    // 队列由 importer / patrol 写（本工具没有"入队"动作）⇒ 夹具直接用引擎 API 播种
    const id = queueReview(fx.project, { refId: 'T-#LT-8', reason: 'ragged', detail: '这一行机器判不了' });
    const seeded = await call(fx, { action: 'review_queue' });
    assert.equal(seeded.data.availability, 'ok');
    assert.deepEqual(
      seeded.data.items.map((x: any) => x.id),
      [id],
    );
    assert.match(seeded.text, /\[ragged\]/);

    const res = await call(fx, { action: 'resolve_review', review_id: id, by: 'judy' });
    assert.equal(res.isError, false, res.text);
    const after = await call(fx, { action: 'review_queue' });
    assert.deepEqual(after.data.items, [], '缺省只看未消项');
    const hist = await call(fx, { action: 'review_queue', open_only: false });
    assert.equal(hist.data.items.length, 1);
    assert.equal(hist.data.items[0].resolved_by, 'judy');

    const twice = await call(fx, { action: 'resolve_review', review_id: id, by: 'judy' });
    assert.equal(twice.isError, true, '重复消项必须拒（不静默）');
    assert.match(twice.text, /不存在或已消项/);
  }));

test('⑪ 读的诚实：库不在场 ⇒ availability != ok，且报文**明说"读不到 ≠ 0 条"**', () =>
  inSandbox(async (fx) => {
    const dbFile = getTasksDbFile(fx.project);
    assert.equal(fs.existsSync(dbFile), false, '夹具一开始没有 tasks.db');

    const list = await call(fx, { action: 'list' });
    assert.equal(list.data.availability, 'no-db', '没有库 ⇒ 读数必须是 no-db（不是 ok + 0 行）');
    assert.deepEqual(list.data.rows, []);
    assert.match(list.text, /这不是「0 条欠账」，是「读不到」/, '把 availability 从回执里删掉 ⇒ 红');

    const get = await call(fx, { action: 'get', ref_id: 'T-#NOPE' });
    assert.equal(get.data.found, false);
    assert.equal(get.data.availability, 'no-db');
    assert.match(get.text, /不要把它读成「不存在」/);
    assert.equal(fs.existsSync(dbFile), false, '只读动作不许创建 0 字节 tasks.db（openTasksDbForRead 口径）');
  }));

test('⑫ 写闸口径：writes:false 有牙（点名拒绝），但台账写动作不需要 DSL 授权、不产设计册；消融改声明 ⇒ 放行', () =>
  inSandbox(async (fx) => {
    assert.equal(toolWritesOf('ledger'), false, '注入表里 ledger 必须是 false（ToolDef.writes 是唯一事实源）');
    const table = toolWritesTable();
    assert.ok(table, 'tool_registry 加载期必须已 bindWritesOf');

    // ① 台账的写动作在**没有任何 DSL 写授权**的情况下照样成功（它写的是 tasks.db，不在写闸路径上）
    const r = await call(fx, hangArgs('T-#LT-9'));
    assert.equal(r.isError, false, r.text);
    assert.equal(fs.existsSync(getTasksDbFile(fx.project)), true, 'tasks.db 必须被建出来');
    assert.equal(fs.existsSync(path.join(fx.home, '.agent-io', 'design')), false, '台账写不许产设计册目录');

    // ② 反向（闸的牙）：拿 ledger 的名字经 via:'tool' 去写设计册 ⇒ 点名拒绝
    const feature = `__ledger_gate_${process.pid}`;
    writeMinimalFeature(fx.home, feature);
    const dsl = getDesignSheet(feature);
    assert.ok(dsl, '夹具册必须可读');
    assert.throws(
      () => runDslWriteScope({ via: 'tool', who: 'ledger' }, () => saveDSL(dsl as never, 'test')),
      /未声明 writes:true/,
      'writes:false 的工具拿 via:tool 写设计册必须被点名拒绝（否则 ledger 就是洗白通道）',
    );

    // ③ 消融：把声明临时改成 true ⇒ **同一次写**就放行（证明闸真的读那个声明，不是别的东西）
    try {
      bindWritesOf({ ...table, ledger: true });
      assert.doesNotThrow(() => runDslWriteScope({ via: 'tool', who: 'ledger' }, () => saveDSL(dsl as never, 'test')));
    } finally {
      bindWritesOf(table);
    }
    assert.equal(toolWritesOf('ledger'), false, '消融后必须还原（否则后面所有用例都跑在被放松的闸上）');
  }));

test('⑬ 消融（透传零重写）：重复挂账 / 销账不存在的行 / 空 body 的报文**逐字来自引擎**', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-10'));
    const dup = await call(fx, hangArgs('T-#LT-10'));
    assert.equal(dup.isError, true);
    assert.match(dup.text, /已在活跃期挂账/, '部分唯一索引的语义报文必须原样透出（本工具不自己组织）');

    const missing = await call(fx, {
      action: 'close',
      ref_id: 'T-#NOT-HUNG',
      state: 'done',
      reason: 'r',
      evidence: 'e',
      by: 'kate',
    });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /没有活跃挂账行/, '销账不存在的行 ⇒ 引擎原文（不许工具自己编一句"不存在"）');

    const blank = await call(fx, { action: 'annotate', ref_id: 'T-#LT-10', body: '   ', by: 'kate' });
    assert.equal(blank.isError, true);
    assert.match(blank.text, /body 必填/, '空 body 由引擎判空（工具不重写这条判定）');
  }));

// ══════════════════════════════════════════════════════════════════════════
// 二席驳斥批（2026-11-18 v2）：origin 后门 / conflicts / 跨 subject supersede /
// close 非阻断 precheck / 审计披露。每条都对准一个**具体失效**，不是"再多测一点"。
// ══════════════════════════════════════════════════════════════════════════

test('⑭ origin 后门：工具面只许造 engine 行（schema 无 origin 键 + handler 见到非 engine 就拒）', () =>
  inSandbox(async (fx) => {
    // ① 面上不给：schema 里没有 origin
    assert.equal('origin' in ledgerDef().inputSchema, false, 'schema 不许声明 origin（后门先从面上消失）');
    // ② 正面：正常 hang 出来的行 origin = engine
    await call(fx, hangArgs('T-#LT-11'));
    assert.equal(getRow(fx.project, 'T-#LT-11')!.origin, 'engine', '工具挂的账必须是 engine 行');
    // ③ 反向（这才是后门）：绕过 zod 直调 handler，塞 origin=import ⇒ **必须拒**，不许"静默当 engine"
    for (const bad of ['import', 'IMPORT', 'engine ']) {
      const r = await ledgerDef().handler({
        action: 'hang',
        project_dir: fx.project,
        ref_id: `T-#LT-11-${bad.trim()}`,
        section: '§I',
        title: 't',
        by: 'mallory',
        origin: bad,
      });
      assert.equal(r.isError, true, `origin="${bad}" 必须被拒（否则 import 行能被外部造出来）`);
      assert.match(String(r.text), /只能造 engine 行/, `报文必须说清为什么：${r.text}`);
    }
    // ④ 而且**一条行都没落库**（被拒的写不许留痕）：活跃集里只有 ② 挂的那一条
    const list = await call(fx, { action: 'list' });
    assert.deepEqual(
      list.data.rows.map((r: any) => r.ref_id),
      ['T-#LT-11'],
      '三次被拒的 hang 一条行都不许留下',
    );
    // ⑤ MCP 面同款（loose schema 会保留未知键 ⇒ 拦得住的是 handler，不是 zod）
    const viaFace = await call(fx, hangArgs('T-#LT-11-face', { origin: 'import' }));
    assert.equal(viaFace.isError, true, 'MCP 面塞 origin=import 也必须拒');
  }));

test('⑮ conflicts：同 subject 的活跃行 ≥2 组可读；销一条就消失；读数带 availability', () =>
  inSandbox(async (fx) => {
    const empty = await call(fx, { action: 'conflicts' });
    assert.equal(empty.data.availability, 'no-db', '库里没有 tasks.db ⇒ 读数是 no-db（不是 ok + 0 组）');
    assert.deepEqual(empty.data.groups, []);

    // 造一组冲突：engine 行的 subject 唯一索引只管 engine 行 ⇒ 用 import 行造冲突不可能，
    // 所以这里用**同一 subject 的两条 engine 行**走"先让位再进座"（declare_supersedes 会让旧行的
    // superseded_by 非空 ⇒ 唯一索引放行，两条行都 active、同 subject ⇒ 正是冲突组的形态）。
    await call(fx, hangArgs('T-#LT-12a', { subject_path: 'src/x.ts' }));
    await call(fx, hangArgs('T-#LT-12b', { subject_path: 'src/x.ts', declare_supersedes: 'T-#LT-12a' }));
    const r = await call(fx, { action: 'conflicts' });
    assert.equal(r.data.availability, 'ok');
    assert.equal(r.data.groups.length, 1, '同 subject 两条活跃行 ⇒ 恰一组');
    assert.equal(r.data.groups[0].subject_path, 'src/x.ts');
    assert.deepEqual(
      r.data.groups[0].members.map((m: any) => m.ref_id).sort(),
      ['T-#LT-12a', 'T-#LT-12b'],
    );
    assert.match(r.text, /src\/x\.ts/);

    // 销掉一条 ⇒ 冲突组消失（冲突是**现算**的，不落表 ⇒ 不需要"清冲突"这一步）
    await call(fx, { action: 'close', ref_id: 'T-#LT-12b', state: 'void', reason: '重复账', evidence: 'T-#LT-12a', by: 'lee' });
    const after = await call(fx, { action: 'conflicts' });
    assert.equal(after.data.groups.length, 0);
  }));

test('⑯ supersede 跨 subject：引擎拒（点名两个 subject），工具只做透传', () =>
  inSandbox(async (fx) => {
    await call(fx, hangArgs('T-#LT-13a', { subject_path: 'src/a.ts' }));
    await call(fx, hangArgs('T-#LT-13b', { subject_path: 'src/b.ts' }));

    // ① 工具面：跨 subject 取代 ⇒ 拒，且报文点名两端
    const cross = await call(fx, { action: 'supersede', ref_id: 'T-#LT-13a', superseded_by: 'T-#LT-13b', by: 'mo' });
    assert.equal(cross.isError, true);
    assert.match(cross.text, /取代必须同 subject/);
    assert.ok(cross.text.includes('src/a.ts') && cross.text.includes('src/b.ts'), `必须点名两端：${cross.text}`);
    // ② 引擎层同款（证明判定**不在**工具层：工具只是把它透出来）
    assert.throws(
      () => supersedeRow(fx.project, 'T-#LT-13a', 'T-#LT-13b', 'mo'),
      /取代必须同 subject/,
      '跨 subject 的判定必须住在引擎（CLI / importer / 直调同一把尺）',
    );
    // ③ 指针没被写下去（被拒的写不留痕）
    assert.equal(getRow(fx.project, 'T-#LT-13a')!.superseded_by, null);

    // ④ 声明的锚点与实际不符 ⇒ 拒（"新声明的 subject 与原行一致"这半条）
    const lie = await call(fx, {
      action: 'supersede',
      ref_id: 'T-#LT-13a',
      superseded_by: 'T-#LT-FORWARD',
      subject_path: 'src/not-this.ts',
      by: 'mo',
    });
    assert.equal(lie.isError, true);
    assert.match(lie.text, /你声明的 subject/);

    // ⑤ 声明正确 + 目标行不存在（前向引用）⇒ 放行（比不了的事不假装比过）
    const ok = await call(fx, {
      action: 'supersede',
      ref_id: 'T-#LT-13a',
      superseded_by: 'T-#LT-FORWARD',
      subject_path: 'src/a.ts',
      by: 'mo',
    });
    assert.equal(ok.isError, false, ok.text);
    assert.equal(getRow(fx.project, 'T-#LT-13a')!.superseded_by, 'T-#LT-FORWARD');
  }));

test('⑰ close 的非阻断 precheck：被取代 / 有未消项 ⇒ 警告行进回执，但**照常销账**', () =>
  inSandbox(async (fx) => {
    // ① 被取代的行：销账照办 + 回执点名"已被 X 取代"
    await call(fx, hangArgs('T-#LT-14a'));
    await call(fx, hangArgs('T-#LT-14b'));
    await call(fx, { action: 'supersede', ref_id: 'T-#LT-14a', superseded_by: 'T-#LT-14b', by: 'ned' });
    const closedOld = await call(fx, {
      action: 'close',
      ref_id: 'T-#LT-14a',
      state: 'done',
      reason: '旧账收口',
      evidence: 'T-#LT-14b 接管',
      by: 'ned',
    });
    assert.equal(closedOld.isError, false, '被取代的旧账**可以**销（precheck 不阻断）');
    assert.equal(closedOld.data.warnings.length, 1, '必须给一条警告行');
    assert.match(closedOld.text, /已被 \*\*T-#LT-14b\*\* 取代/, `警告要点名取代者：${closedOld.text}`);
    assert.equal(getRow(fx.project, 'T-#LT-14a')!.state, 'done', '状态照常翻转');

    // ② 有未消项的行：警告进回执，但销账不被拦；**队列项不会被销账顺手消掉**
    await call(fx, hangArgs('T-#LT-14c'));
    const reviewId = queueReview(fx.project, { refId: 'T-#LT-14c', reason: 'multi-anchor', detail: '两个锚点机器判不了' });
    const closedWithReview = await call(fx, {
      action: 'close',
      ref_id: 'T-#LT-14c',
      state: 'void',
      reason: '不做了',
      evidence: 'T-#LT-14a',
      by: 'ned',
    });
    assert.equal(closedWithReview.isError, false, '有未消项**不阻断**销账');
    assert.match(closedWithReview.text, /未消项/, `警告要说明还有未消项：${closedWithReview.text}`);
    assert.ok(closedWithReview.text.includes(`#${reviewId}`), '警告要点名队列项 id');
    const stillOpen = readReviewQueue(fx.project, { openOnly: true });
    assert.equal(stillOpen.items.filter((x) => x.id === reviewId).length, 1, '销账**不消项**（队列项要单独 resolve_review）');

    // ③ 干净的行：一条警告都没有（别把 precheck 变成永远亮的灯）
    await call(fx, hangArgs('T-#LT-14d'));
    const clean = await call(fx, { action: 'close', ref_id: 'T-#LT-14d', state: 'done', reason: 'r', evidence: 'e', by: 'ned' });
    assert.deepEqual(clean.data.warnings, [], '没有这两件事的行不许挂警告');
  }));
