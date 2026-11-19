/**
 * T-#LEDGER-ENGINE **L3b** —— 三项引擎加固（lead 裁定，基于 L3 提案 §E6 / §E6b / §E9）。
 *
 * ## 每一项守的是什么（括号里是"打断它的最小改法"）
 * **E6 · 批注护栏**：有 `annotate / close / verdict / reopen / supersede` 事件的行，`refresh` **不许**用 MD 文本
 *   覆盖它（只更新 `section / ordinal / subject_*` 元数据列），而且**派生层不许把它再插一遍**。
 *   · 判据红法：把 `pinned` 那一段删掉 ⇒ ①账行的 `source_json` 被覆盖（批注宿主的内容没了）、
 *     ②散文行直接 `UNIQUE constraint failed: ledger_rows.ref_id`（整笔 refresh 抛掉）。
 *   · 为什么不是"拒绝 refresh"：一条批注 = 一次全量 refresh 不可用，那是把闸变成墙（本仓 GUIDE-GATE 纪律）；
 *     冻结**那几行** + 点名 + 可消项队列才是"人看得见"的形状。
 *
 * **E6b · 视图不是源**：视图被**可证地**手改过（头里的 `body_sha256` 与盘上正文不符）且引擎里已经有存量行
 *   ⇒ `importLedger` **拒绝灌入**。判据只住 `render_ledger_view#viewSourceTrust`（一处权威）。
 *   · 判据红法：删掉那个 `throw` ⇒ 手写的一段话会被吸进引擎，而下一次 `ledger:render` 把它盖掉
 *     —— "被覆盖"与"本来就没有"在库里长得一样（0.12）。
 *   · **迁移例外**：引擎里一条 import 行都没有时照灌（那一刻 MD 就是唯一真相，L2 的全部前提）。
 *
 * **E9 · 写闸拒直写派生视图**：`docs/todo.md` 的真相住引擎，agent 写路（`edit_code` / 任何经
 *   `assertSourceWriteRegistered` 的写）**终局拒绝**它 —— 没有环境变量开关，`direct` 也不放行。
 *   · 判据红法：删掉 `derivedViewHits` 那一段 ⇒ `edit_code` 直写视图成功（改前**只**被"重写计划闸"偶然挡住，
 *     而写一张画布就能过去 —— 假拦截）。
 *
 * ★ 夹具与 `tests/p1_ledger_importer.test.ts` 同款（makeTempHome + AGENT_IO_HOME + registerFeature + rmRf）。
 * ★ **不写任何计数判据**：`docs/todo.md` 一天能长几十行，计数写死就红在与代码无关的地方。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerFeature } from '../src/infrastructure/project_registry.js';
import { annotateRow, closeRow, getRow, listReviewQueue, listRows } from '../src/application/ledger/ledger.js';
import { importLedger, type ImportError } from '../src/application/ledger/importer.js';
import { VIEW_REL, renderLedgerView, viewSourceTrust } from '../src/application/ledger/render_ledger_view.js';
import { assertSourceWriteRegistered, derivedViewHits, isGateRejection } from '../src/application/write_gate.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

// ★ 写路端到端（不只看闸的判据）：`edit_code` 是"agent 直写"最常用的一条路
const { editCode } = await import('../src/application/refactor/edit/edit_code.js');

const REPO_MD = path.resolve(process.cwd(), 'docs', 'todo.md');
const FEATURE = `__ledger_l3b_${process.pid}`;

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
  prevDataRoot: string | undefined;
}

function setup(): Fixture {
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-l3b-proj-'));
  delete process.env.AGENT_IO_DATA_ROOT; // ★ DATA_ROOT 优先级高于 HOME，会抢走夹具
  process.env.AGENT_IO_HOME = home;
  registerFeature(FEATURE, project, 'p1_ledger_l3b.test');
  fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
  fs.copyFileSync(REPO_MD, path.join(project, VIEW_REL));
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

function viewFile(fx: Fixture): string {
  return path.join(fx.project, VIEW_REL);
}

/** 视图原文按行改写（**行内**改动 ⇒ 行号不平移，别的判据（ordinal/漂移）不会被顺带搅动） */
function editViewLine(fx: Fixture, ordinal: number, mutate: (line: string) => string): void {
  const text = fs.readFileSync(viewFile(fx), 'utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(eol);
  lines[ordinal - 1] = mutate(lines[ordinal - 1]);
  fs.writeFileSync(viewFile(fx), lines.join(eol), 'utf-8');
}

function tryImport(fx: Fixture, mode: 'reconcile' | 'refresh'): ImportError | null {
  try {
    importLedger(fx.project, { mode });
    return null;
  } catch (e) {
    return e as ImportError;
  }
}

// ───────────────────────────────────────── E6 · 批注护栏

test('E6 批注护栏：annotate 过的行 refresh **不覆盖内容**、事件仍在、派生层不再插第二遍（UNIQUE 不再炸）', () =>
  inSandbox((fx) => {
    // ★ 为什么这一条从**非视图**的副本导（`sourcePath`）：E6 与 E6b 是**两条**判据 ——
    //   E6b 判"这份正文是不是引擎写的"（视图路径），E6 判"有批注的行内容还能不能被覆盖"（所有来源）。
    //   用视图路径测 E6，手改第一步就会被 E6b 拦掉（两条判据搅在一起，谁也测不准）。
    //   ★ 生产里 E6 的真实形态见本用例末尾的"真流程"段：annotate → `ledger:render` → 从视图 refresh。
    const srcRel = 'docs/ledger-src.md';
    fs.copyFileSync(path.join(fx.project, VIEW_REL), path.join(fx.project, srcRel));
    const mdFile = path.join(fx.project, srcRel);
    const readMd = (): string => fs.readFileSync(mdFile, 'utf-8');
    const refreshSrc = (): ReturnType<typeof importLedger> => importLedger(fx.project, { mode: 'refresh', sourcePath: srcRel });

    assert.doesNotThrow(refreshSrc, '首轮迁移必须成功');

    // ── ① 账行（业务身份）：正文被覆盖 = 批注宿主的内容没了
    const task = listRows(fx.project, { recordKinds: ['task'] }).find((r) => r.record_kind === 'task');
    assert.ok(task, '真实 MD 里必须有账行（否则这条用例没测到护栏）');
    annotateRow(fx.project, task!.ref_id, 'E6-KEEP-ME', 'tester');
    const beforeTask = getRow(fx.project, task!.ref_id)!;
    assert.ok(beforeTask.ordinal, '账行必须有源行号（护栏要用它定位）');

    const text0 = readMd();
    const eol = text0.includes('\r\n') ? '\r\n' : '\n';
    const lines0 = text0.split(eol);
    lines0[Number(beforeTask.ordinal) - 1] = `${lines0[Number(beforeTask.ordinal) - 1]} <!-- e6-probe -->`;
    fs.writeFileSync(mdFile, lines0.join(eol), 'utf-8');

    const rep = refreshSrc();
    const afterTask = getRow(fx.project, task!.ref_id)!;
    assert.ok(
      afterTask.events.some((e) => e.kind === 'annotate' && (e.body ?? '').includes('E6-KEEP-ME')),
      '批注事件必须还在（护栏的核心判据）',
    );
    assert.equal(afterTask.source_json, beforeTask.source_json, '有批注的账行**内容不许被 refresh 覆盖**（只更新元数据列）');
    assert.ok(
      rep.annotated_kept.some((k) => k.refId === task!.ref_id && k.kinds.includes('annotate')),
      '被钉住的行必须**点名**（`annotated_kept`）—— 静默不动 ⇒ 读端以为它跟上了 MD（0.12）',
    );
    assert.equal(
      rep.drifted.some((d) => d.refId === task!.ref_id),
      false,
      '被钉住的行**不算漂移**（算进去 = reconcile 永远红 = 0.16 那盏"永远亮的灯"）',
    );
    assert.ok(
      listReviewQueue(fx.project, { reason: 'drift' }).some((i) => (i.ref_id ?? '') === task!.ref_id),
      '"这一行没跟上 MD"必须进可消项队列（一次性回执会随着人走掉）',
    );

    // ── ② 派生行（位置身份）：改前 refresh 直接 UNIQUE constraint failed（整笔抛掉）
    const prose = listRows(fx.project, { recordKinds: ['prose'], withSource: true }).find((r) => r.record_kind === 'prose');
    assert.ok(prose, '真实 MD 里必须有散文行（派生层）');
    annotateRow(fx.project, prose!.ref_id, 'E6-PROSE-KEEP-ME', 'tester');
    const proseRaw = prose!.source_json;

    fs.appendFileSync(mdFile, `${eol}<!-- e6 derived rebuild probe -->${eol}`, 'utf-8');
    let rep2: ReturnType<typeof importLedger> | null = null;
    assert.doesNotThrow(() => {
      rep2 = refreshSrc();
    }, '有批注的派生行 ⇒ refresh **不许崩**（改前：UNIQUE constraint failed: ledger_rows.ref_id）');
    assert.ok(rep2!.derived_kept >= 1, '派生层里被钉住的位置必须被计入 `derived_kept`（否则"没重建"就是静默）');
    const proseAfter = listRows(fx.project, { recordKinds: ['prose'], withSource: true }).filter((r) => r.ref_id === prose!.ref_id);
    assert.equal(proseAfter.length, 1, '同一位置**只许一条**行（插第二遍 = 改前那个 UNIQUE 崩）');
    assert.equal(proseAfter[0].source_json, proseRaw, '被批注钉住的散文行内容不许被覆盖');
    assert.ok(
      (getRow(fx.project, prose!.ref_id)!.events ?? []).some((e) => (e.body ?? '').includes('E6-PROSE-KEEP-ME')),
      '散文行的批注事件必须还在',
    );

    // ── ③ 收敛：再导一遍不许再动（护栏不是"每次都重建"的永动机）
    const rep3 = importLedger(fx.project, { mode: 'reconcile', sourcePath: srcRel });
    assert.equal(rep3.added, 0, '护栏之后仍要幂等（reconcile 不许再报新增）');
    assert.equal(rep3.derived_rebuilt, 0, '派生层已收敛（被钉住的位置不参与比较 ⇒ 不永红）');

    // ── ④ 真流程（生产里 E6 的实际形状）：annotate → `ledger:render` → 从**视图** refresh
    //   ★ 这一步同时证明 E6b 与 E6 **不打架**：视图是引擎刚生成的（`engine-authored`）⇒ E6b 放行，
    //     而批注事件穿过整圈仍然在。
    const task2 = listRows(fx.project, { recordKinds: ['task'] }).find((r) => r.record_kind === 'task')!;
    annotateRow(fx.project, task2.ref_id, 'E6-LOOP-KEEP-ME', 'tester');
    fs.writeFileSync(path.join(fx.project, VIEW_REL), renderLedgerView(fx.project, { header: true }).text, 'utf-8');
    assert.equal(viewSourceTrust(fx.project).state, 'engine-authored', '刚重生成的视图必须是 `engine-authored`（否则 E6b 会拦真流程）');
    assert.doesNotThrow(() => importLedger(fx.project, { mode: 'refresh' }), '真流程（重生成 → 灌回）必须走得通');
    assert.ok(
      (getRow(fx.project, task2.ref_id)!.events ?? []).some((e) => (e.body ?? '').includes('E6-LOOP-KEEP-ME')),
      '整圈（annotate → render → refresh）之后批注必须还在',
    );
  }));

// ───────────────────────────────────────── E6b · 视图不是源

test('E6b 视图不是源：手改过的视图 importer **拒绝灌回**（一个字节都不进引擎）', () =>
  inSandbox((fx) => {
    // 迁移例外：引擎为空 ⇒ 这份视图照灌 —— 那一刻 MD 就是唯一真相
    const first = importLedger(fx.project, { mode: 'refresh' });
    assert.ok(first.added > 0, '首轮迁移必须成功');
    // ★ 2026-11-17：trust 状态**如实读**（'hand-edited' 或 'engine-authored' 都合法——
    //   取决于夹具拷贝时真仓视图是否与引擎一致；本步只验"首轮照灌"这个迁移例外，不验 trust）。
    //   手改拒绝路径在下面 L199 起有**夹具保证**（追加探针 ⇒ 必 hand-edited ⇒ 必拒）。
    assert.ok(
      first.view_trust?.state === 'hand-edited' || first.view_trust?.state === 'engine-authored',
      `view_trust 必须如实报状态，实得：${first.view_trust?.state}`,
    );

    // 手改视图：追加一段只存在于文件里的话
    const probe = 'HAND-EDIT-PROBE-6B';
    fs.appendFileSync(viewFile(fx), `\n## §Z · 手改探针\n\n${probe}\n`, 'utf-8');
    const trust = viewSourceTrust(fx.project);
    assert.equal(trust.state, 'hand-edited', '头里的 body_sha256 与盘上正文不符 ⇒ 可证的手改（不依赖 git）');
    assert.notEqual(trust.declared_sha, trust.body_sha);

    for (const mode of ['refresh', 'reconcile'] as const) {
      const err = tryImport(fx, mode);
      assert.ok(err, `${mode} 必须拒绝灌入（改前：手写的内容会被吸进引擎 = 第二真相）`);
      assert.match(String(err!.message), /手改视图|hand-edited/, `${mode} 的报文必须点名"手改视图"`);
      assert.match(String(err!.message), /视图不是源/, '报文必须说出犯规的是哪条不变量');
    }
    assert.equal(
      listRows(fx.project, { withSource: true }).some((r) => (r.source_json ?? '').includes(probe)),
      false,
      '**一个字节都不许进引擎**（拒写 = 不写，不是"写了再报错"）',
    );

    // 回到引擎写的那一份 ⇒ 立刻能导（判据是"可证的手改"，不是一盏永远亮着的灯）
    const rendered = renderLedgerView(fx.project, { header: true });
    fs.writeFileSync(viewFile(fx), rendered.text, 'utf-8');
    assert.equal(viewSourceTrust(fx.project).state, 'engine-authored', '写回渲染结果 ⇒ 头自证 + 与现算逐字相同');
    const again = tryImport(fx, 'refresh');
    assert.equal(again, null, `回到引擎那一份之后必须能导（否则护栏成了墙）：${again?.message ?? ''}`);
  }));

// ───────────────────────────────────────── T-#LEDGER-CURRENT-PROJECTION · current-only 渲染

test('CURRENT 投影：done prose + annotate 长文退出当前视图；原文/事件仍在，ordinal_gaps 仍按全量行算', () =>
  inSandbox((fx) => {
    const first = importLedger(fx.project, { mode: 'refresh' });
    assert.ok(first.added > 0, '首轮迁移必须成功');

    const prose = listRows(fx.project, { recordKinds: ['prose'], withSource: true }).find((r) => r.record_kind === 'prose');
    assert.ok(prose, '真实 MD 里必须有 prose 行');
    const raw = String(prose!.source_json ?? '');
    assert.ok(raw.includes('GENERATED'), '选中的 prose 原文必须含可核对标记（当前视图的 DO NOT EDIT 头）');

    const longNote = 'CURRENT-PROJECTION-LONG-ANNOTATE-DO-NOT-RENDER';
    const gapsBefore = renderLedgerView(fx.project, { header: true }).ordinal_gaps;
    annotateRow(fx.project, prose!.ref_id, longNote.repeat(8), 'tester');
    closeRow(fx.project, prose!.ref_id, 'done', '当前性反例', 'tests/p1_ledger_l3b.test.ts', 'tester');

    const rendered = renderLedgerView(fx.project, { header: true });
    assert.equal(rendered.error, null, `渲染不许失败：${rendered.error}`);
    assert.deepEqual(rendered.ordinal_gaps, gapsBefore, 'current 过滤不许改变 ordinal_gaps 的全量分母');
    assert.doesNotMatch(rendered.text, new RegExp(longNote), 'done prose 的 annotate 长文不许留在当前视图');
    // 头是另一种 prose/meta 素材，当前视图仍可能有 GENERATED；这里验的是**该行原文**已不在。
    assert.doesNotMatch(rendered.text, /CURRENT-PROJECTION-LONG-ANNOTATE-DO-NOT-RENDER/);

    const archived = getRow(fx.project, prose!.ref_id)!;
    assert.equal(archived.state, 'done', '历史行仍在引擎，state=done，不物理删');
    assert.equal(archived.source_json, prose!.source_json, '原文逐字保留，可考古');
    assert.ok(
      archived.events.some((e) => e.kind === 'annotate' && (e.body ?? '').includes(longNote)),
      'annotate 长文仍在 append-only 事件里',
    );
    assert.ok(
      archived.events.some((e) => e.kind === 'close'),
      'close 事件仍在（销账不是删）',
    );

    const ord = Number(prose!.ordinal);
    assert.ok(Number.isFinite(ord) && ord > 0, 'prose 行必须有源行号');
    assert.equal(rendered.ordinal_gaps.includes(ord), false, '当前性过滤不许改变 ordinal_gaps 的全量分母');
  }));

// ───────────────────────────────────────── E9 · 写闸拒直写派生视图

test('E9 写闸：`edit_code` 直写派生视图 ⇒ 终局拒绝（`direct` 也不放行；其它文件不受影响）', async () => {
  const fx = setup();
  try {
    const before = fs.readFileSync(viewFile(fx), 'utf-8');
    const marker = '不要手改本文件';
    assert.ok(before.includes(marker), '夹具里必须有那句 DO NOT EDIT（否则替换目标错了）');

    // ① 判据层：闸的唯一入口直接拒（`derivedViewHits` 点名）
    assert.deepEqual(derivedViewHits(fx.project, [VIEW_REL]), [VIEW_REL], '派生视图必须被认出来');
    let gateErr: unknown = null;
    try {
      assertSourceWriteRegistered(fx.project, [VIEW_REL], { actor: 'tester' });
    } catch (e) {
      gateErr = e;
    }
    assert.ok(gateErr, '闸必须抛（放行 = 直写成功）');
    assert.ok(isGateRejection(gateErr), '必须落在"闸的拒绝"家族里（文案前缀 = `拒绝落盘`）');
    assert.match(String((gateErr as Error).message), /派生视图/);

    // ② 接线层：真实的写工具 `edit_code` 必须被它挡住，且盘上一个字节都没动
    const denied = await (async () => {
      try {
        await editCode({
          project_dir: fx.project,
          file: VIEW_REL,
          op: 'replace_text',
          old_text: marker,
          new_text: '可以手改本文件',
          actor: 'tester',
        });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();
    assert.ok(denied, '`edit_code` 直写派生视图必须失败（改前：只被"重写计划闸"偶然挡住 ⇒ 画一张画布就能过去）');
    assert.ok(isGateRejection(denied), '`edit_code` 抛的必须是闸的拒绝（不是语法门 / 规划失败）');
    assert.match(String(denied!.message), /派生视图/);
    assert.match(String(denied!.message), /ledger:render/, '拒绝文案必须给出正路（重生成视图）');
    assert.equal(fs.readFileSync(viewFile(fx), 'utf-8'), before, '拒绝 = 一个字节都不许落盘');

    // ③ 没有开关：`direct`（模型自判"小改"的直通车）也不放行 —— 省流程 ≠ 允许多一个真相源
    let directErr: Error | null = null;
    try {
      await editCode({
        project_dir: fx.project,
        file: VIEW_REL,
        op: 'replace_text',
        old_text: marker,
        new_text: '可以手改本文件',
        actor: 'tester',
        direct: true,
      });
    } catch (e) {
      directErr = e as Error;
    }
    assert.ok(directErr && /派生视图/.test(directErr.message), '`direct: true` 必须同样被拒（这条闸不是流程闸）');
    assert.equal(fs.readFileSync(viewFile(fx), 'utf-8'), before, '`direct` 被拒后同样一个字节都没动');

    // ④ 判据不越界：别的 md 照写（否则就是把"禁一个派生视图"写成"禁所有文档"）
    const other = path.join(fx.project, 'docs', 'note.md');
    fs.writeFileSync(other, '# 便签\n\n旧一句\n', 'utf-8');
    const ok = await editCode({
      project_dir: fx.project,
      file: 'docs/note.md',
      op: 'replace_text',
      old_text: '旧一句',
      new_text: '新一句',
      actor: 'tester',
      direct: true,
    });
    assert.equal(ok.data.ok, true, '非派生视图的 md 必须照写（判据按路径，不按后缀）');
    assert.match(fs.readFileSync(other, 'utf-8'), /新一句/);
  } finally {
    teardown(fx);
  }
});
