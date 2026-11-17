/**
 * P1 · 源码写盘的 **pre-hash 冲突检测**（十维审计 §① A2 / T2 实测）
 *
 * ## 它挡的事故（审计 T2 逐条实测，不是推测）
 * 两席**同时** `openSourceWrite` 同一个文件 ⇒ **双双成功**（写闸判的是"这张卡覆盖了这些文件"，
 * 与"盘上内容在你 open 之后变没变"是两件事）⇒ B 先落盘、A 后落盘，**A 基于 v0 算出来的内容
 * 把 B 的 v1 整段覆盖**（静默 lost update）；随后 A 的 `rollback()` 用写前快照把 B 的写**一起抹回 v0**。
 * 全程 write_log 两条、零冲突读数 —— 事故的形状不是"抛错"，是"什么都没发生"。
 *
 * ## 本文件的五条断言（少一条就等于没验）
 * ① **T2 场景**：第二席落盘必须抛 `E-WRITE-CONFLICT`，且 ≠ 只有码 —— 报文要点名"打开后被谁改过"
 *    （`agent:seatb`）+ 两个 sha（打开时 / 现在）+ 修法（重读再改）；先落盘那一笔**逐字节不动**；
 * ② **不让位**：`direct` / 首跑模式 / 无画布 / `AGENT_IO_REQUIRE_PLAN=0` 四条让位路径下
 *    写的仍然是**同一道机制闸**（画布 CAS 在这四条路上都缺席，T2 正是在这里静默的）；
 * ③ **回滚不覆盖别人的写**：A 落盘、B 又改过 ⇒ `A.rollback()` 必须 `ok:false` + 点名，盘上仍是 B 的版本；
 *    而**单写者**回滚逐字不变（`ok:true` + 回到 v0）；
 * ④ **本批自己写的不算冲突**：同一事务连写两次（第二次基于第一次）不许被拦 —— 比对的是
 *    "盘上 vs **打开时**"，不是"盘上 vs 打开时（永不更新）"；
 * ⑤ **新建文件的并发创建**也拦：open 时不存在、落盘前别人建了 ⇒ 同样 `E-WRITE-CONFLICT`，
 *    报文里"打开时 = 文件不存在"。
 *
 * ## 消融（"摘掉就红"）
 * 把 `src/application/source_writer.ts#assertNoDrift` 的**比对那一行**摘掉（只留函数壳）⇒
 * ①③ 两条立刻红（落盘不再抛、回滚照样抹掉别人）。本文件就是那条消融的裁判。
 *
 * ## 为什么钉 `AGENT_IO_REQUIRE_PLAN=0`
 * 夹具项目**没有重写画布**（`plan/<rel>.plan.json`）—— 本文件验的是**盘面冲突**，不是画布闸。
 * 写闸自己把这一档列为"测试用"（`write_gate.ts#planStrictMode`：「测试与批量迁移用它」）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AGENT_IO_REQUIRE_PLAN = '0';

// ★ 只取**改前就存在**的导出：这样"改前跑本文件"红在**判据**上（第二席静默落盘），
//   而不是红在 `import` 一个还不存在的符号上（那种红什么也没验）。
const { openSourceWrite } = await import('../src/application/source_writer.js');
const { readWriteLog } = await import('../src/infrastructure/write_log.js');
const { contentHash } = await import('../src/infrastructure/index/symbols.js');

const REL = 'src/target.ts';
const V0 = '// v0\nexport const a = 0;\n';
const V_B = '// v1-by-B\nexport const a = 1;\n';
const V_A = '// v1-by-A\nexport const a = 2;\n';

/**
 * 夹具：**建 `.agent-io/`**（这样 `source_writer` 的写账真的落进 `tasks.db#write_log` ——
 * 断言②要靠它点名"谁改的"；不建 `.agent-io` 的项目里这笔账必然记不上）。
 */
function mkProject(): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-write-conflict-'));
  fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, REL), V0, 'utf8');
  return proj;
}

const read = (proj: string): string => fs.readFileSync(path.join(proj, REL), 'utf8');

/** `direct` 是"直通车"那一支：夹具没有卡、没有画布 ⇒ 只有它能让 open 通过（T2 的原样形态） */
function open(proj: string, actor: string, label: string, extra: Record<string, unknown> = {}) {
  return openSourceWrite(proj, [REL], { label, actor, direct: true, ...extra });
}

/**
 * 另一档夹具：**不带 `.agent-io/`**（= "本项目不用任务系统" ⇒ 任务闸按这一格放行）。
 * ★ 用处：验"首跑模式"这条让位路（它降级的是**计划闸/画布闸**；`direct` 会让整段短路 ⇒ 看不到横幅）。
 */
function mkBareProject(): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-write-conflict-bare-'));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, REL), V0, 'utf8');
  return proj;
}

/** 这个文件在写账里的 `commit` 行（按时间倒序，最近一条在前） */
function commitRowsOf(proj: string) {
  const r = readWriteLog(proj, { file: REL, limit: 50 });
  assert.equal(r.skip, null, `写账必须读得到（否则"点名"这条断言验的是空气）：${r.skip}`);
  return r.rows.filter((row) => row.kind === 'commit');
}

test('① T2 复现：第二席落盘抛 E-WRITE-CONFLICT（点名 B + 两个 sha + 修法），先落盘那一笔逐字节不动', async () => {
  const proj = mkProject();
  try {
    const sha0 = contentHash(V0);
    // ── 两席同时 open（T2 的形状：双双成功，谁也不知道对方在飞） ──
    const a = open(proj, 'agent:seata', 'seata:edit_code');
    const b = open(proj, 'agent:seatb', 'seatb:edit_code');

    b.commit(REL, V_B);
    b.close();
    assert.equal(read(proj), V_B, 'B 先落盘：此时盘上是 B 的版本');

    // ── A 后落盘：改前**静默覆盖**（本条断言就是 T2 的红） ──
    let err: unknown;
    try {
      a.commit(REL, V_A);
    } catch (e) {
      err = e;
    }
    assert.ok(err, '★ 第二席落盘**必须被拒**（改前它静默成功，B 的写就此消失）');
    const e = err as Error & { code?: string; file?: string };
    assert.equal(e.code, 'E-WRITE-CONFLICT', `必须是可编程识别的冲突码，实际：${String(e.code)}`);
    const sw = await import('../src/application/source_writer.js');
    assert.equal(
      typeof (sw as { WriteConflictError?: unknown }).WriteConflictError,
      'function',
      '必须导出一个可 `instanceof` 的冲突错误类（调用方要能分型处理）',
    );

    const msg = e.message;
    // 报文四件事：码 · 点名"谁改的" · 两个 sha · 修法
    assert.match(msg, /E-WRITE-CONFLICT/, '报文必须自带码');
    assert.match(msg, /agent:seatb/, `必须点名"打开后被谁改过"（写账最近一条 = seatb）：\n${msg}`);
    assert.ok(msg.includes(sha0.slice(0, 12)), `必须给出**打开时**的 sha：\n${msg}`);
    assert.ok(msg.includes(contentHash(V_B).slice(0, 12)), `必须给出**现在**的 sha：\n${msg}`);
    assert.match(msg, /重读/, '必须给修法（重读再改）');

    // ── 盘面与写账：B 的写还在，被拒的那一笔不伪造"已写"的账 ──
    assert.equal(read(proj), V_B, '★ A 的写被拒 ⇒ 盘上必须还是 B 的版本（改前这里变成 A 的版本）');
    const rows = commitRowsOf(proj);
    assert.equal(rows.length, 1, `被拒的写不许进写账（账上只应有 B 那一条）：${JSON.stringify(rows)}`);
    assert.equal(rows[0]?.actor, 'agent:seatb', '账上那一条必须是 B');
    assert.equal(a.close(), null, '一个字节都没落盘 ⇒ close() 不许登记自写（否则索引会说"变了"）');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('② 让位路径同一道闸：首跑模式（严格计划档 + 无画布）下照样拦', () => {
  const proj = mkBareProject();
  const prevFirstRun = process.env.AGENT_IO_FIRST_RUN;
  const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
  try {
    // ★ 严格计划档（本夹具没有 `plan/*.plan.json` ⇒ 计划闸本该拒）+ 首跑模式（降级为只点名）
    process.env.AGENT_IO_REQUIRE_PLAN = '1';
    process.env.AGENT_IO_FIRST_RUN = '1';
    const a = openSourceWrite(proj, [REL], { label: 'seata:first-run', actor: 'agent:seata' });
    const b = openSourceWrite(proj, [REL], { label: 'seatb:first-run', actor: 'agent:seatb' });
    // 先证明"闸确实让位了"：首跑模式的横幅必须出现在回执里（否则本用例只是在验严格档）
    assert.match(a.task_gate, /首跑/, `首跑模式必须真的让位（否则验的是另一条路）：\n${a.task_gate}`);
    b.commit(REL, V_B);
    b.close();
    assert.throws(
      () => a.commit(REL, V_A),
      (err: unknown) => (err as { code?: string }).code === 'E-WRITE-CONFLICT',
      '画布/计划闸让位的那几条路，pre-hash 冲突检测**必须照拦**',
    );
    assert.equal(read(proj), V_B);
  } finally {
    if (prevFirstRun === undefined) delete process.env.AGENT_IO_FIRST_RUN;
    else process.env.AGENT_IO_FIRST_RUN = prevFirstRun;
    if (prevPlan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
    else process.env.AGENT_IO_REQUIRE_PLAN = prevPlan;
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('③ 回滚不许覆盖别人的写：A 落盘 → B 改过 ⇒ A.rollback() ok:false 且点名 B，盘上仍是 B 的版本', () => {
  const proj = mkProject();
  try {
    const a = open(proj, 'agent:seata', 'seata:rollback');
    a.commit(REL, V_A);
    // B 在 A 落盘**之后**打开（它看到的就是 A 的版本）⇒ B 的写是合法的、基于新内容的
    const b = open(proj, 'agent:seatb', 'seatb:after-a');
    b.commit(REL, V_B);
    b.close();
    assert.equal(read(proj), V_B);

    const rb = a.rollback();
    assert.equal(rb.ok, false, '★ 别人写过的文件**不许**被这次回滚覆盖（改前它照样 ok:true，把 B 抹回 v0）');
    assert.match(rb.message, /E-WRITE-CONFLICT/, '拒绝的理由必须可识别');
    assert.match(rb.message, /agent:seatb/, `必须点名改过它的那一席：\n${rb.message}`);
    assert.deepEqual(rb.restored, [], '拒绝回滚 ⇒ 一个文件都不许还原');
    assert.deepEqual(rb.removed, [], '拒绝回滚 ⇒ 一个文件都不许删');
    assert.deepEqual(rb.failed, [REL], '已落盘清单必须原样交回（诚实上报，不许假装没写过）');
    assert.equal(read(proj), V_B, '★ 盘上必须还是 B 的版本');

    // 被拒的回滚通道**没有**落盘 ⇒ 也不许往账里写一条 rollback（写账口径：先落盘再记账）
    const rbRows = readWriteLog(proj, { file: REL, limit: 50 }).rows.filter((row) => row.kind === 'rollback');
    assert.deepEqual(rbRows, [], `被拒的回滚一条账都不许记：${JSON.stringify(rbRows)}`);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('④ 单写者回滚逐字不变：open → commit → rollback ⇒ ok:true，文件回到 v0', () => {
  const proj = mkProject();
  try {
    const a = open(proj, 'agent:seata', 'seata:single');
    a.commit(REL, V_A);
    assert.equal(read(proj), V_A);
    const rb = a.rollback();
    assert.equal(rb.ok, true, `单写者回滚不许被新闸误伤：${rb.message}`);
    assert.deepEqual(rb.restored, [REL]);
    assert.equal(read(proj), V0, '回到 v0（逐字节）');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('⑤ 本批自己写的不算冲突：同一事务连写两次（第二次基于第一次）不被拦', () => {
  const proj = mkProject();
  try {
    const a = open(proj, 'agent:seata', 'seata:twice');
    a.commit(REL, V_A);
    // 第二次落盘：比对基线必须已经刷新成"我刚写的那一版"，否则这是**假冲突**
    a.commit(REL, `${V_A}// tail\n`);
    assert.equal(read(proj), `${V_A}// tail\n`);
    assert.equal(commitRowsOf(proj).length, 2, '两次落盘 ⇒ 两条写账（逐文件逐次一条）');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('⑥ 新建文件的并发创建也拦：open 时不存在、落盘前别人建了 ⇒ E-WRITE-CONFLICT（"打开时 = 不存在"）', () => {
  const proj = mkProject();
  const newRel = 'src/brand_new.ts';
  try {
    const a = openSourceWrite(proj, [newRel], { label: 'seata:new', actor: 'agent:seata', direct: true });
    const b = openSourceWrite(proj, [newRel], { label: 'seatb:new', actor: 'agent:seatb', direct: true });
    b.commit(newRel, '// by B\n');
    b.close();
    let err: unknown;
    try {
      a.commit(newRel, '// by A\n');
    } catch (e) {
      err = e;
    }
    assert.ok(err, '★ 别人先建了同一个新文件 ⇒ 后建的那一席必须被拒');
    assert.equal((err as { code?: string }).code, 'E-WRITE-CONFLICT');
    assert.match((err as Error).message, /不存在/, `报文要说清"打开时它还不存在"：\n${(err as Error).message}`);
    assert.equal(fs.readFileSync(path.join(proj, newRel), 'utf8'), '// by B\n', 'B 建的文件逐字节不动');
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
});
