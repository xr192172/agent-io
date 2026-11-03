/**
 * P0 · **软消解**（`dissolve ≠ delete`）—— 画布的"设计性自动消失，叙事一个字节不动"。
 *
 * ## 用户模型（原话）
 * 「只要你的设计册被编辑了，那被编辑的那一块就是画布，直到对拍之后发现两边对拍完成，然后画布的
 *   **设计性就自动消解，因为它已经是实际了**」+「如果他的卡已经结案了，那就可以放心的把这个卡直接取消掉」。
 * 而 2026-11-02 的保留裁决（`rewrite_plan.ts#prunePlans`）禁止物理删：「已了结卡的画布是复核时看
 *   当初想干什么的**唯一记录**」⇒ 两个都要：**消解**（从对拍范围消失）**不删**（rows 与叙事原样）。
 *
 * ## 本证锁四条（双向 —— 0.14：只有"同义必命中"的用例不具鉴别力）
 * ① **消解**：卡已结案 ⇒ 该份画布打上 `dissolved_at`，且 `entries_json` 一个字节不动；
 * ② **复活**：已消解的行再被冻结（= 那一块被编辑）⇒ `dissolved_at` 变 NULL；
 * ③ **不许误清**：写 A 行**不许**把 B 行的 `dissolved_at` 清掉（防"无条件 UPDATE 全表"）；
 * ④ **消融点**：卡**只活在设计册**（`geometry.nodes[].task.state='candidate'`，`live_cards` / `task_history`
 *    都没有）⇒ 必须判 `live`、必须留着。把 `cardLivesOf` 换成"只查 live_cards" ⇒ 本条变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cardLivesOf, dissolvePlans, writeRewritePlan, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { getTasksDbFile, openTasksDbForRead } from '../src/infrastructure/task_history.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

/** 最小册：每个节点带一个 `task.state`，并各写一份画布（`card` = 节点 id） */
function seed(home: string, project: string, feature: string, nodes: Array<{ id: string; state: string; file: string }>): void {
  const dsl = {
    feature,
    title: feature,
    source_root: project,
    geometry: {
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.id,
        type: 'service',
        x: 0,
        y: 0,
        path: n.file,
        task: { id: n.id, state: n.state, summary: `${n.id} 的卡` },
      })),
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  for (const n of nodes) {
    fs.writeFileSync(path.join(project, n.file), 'export function a() { return 1; }\n', 'utf-8');
    writeRewritePlan(project, {
      path: n.file,
      card: n.id,
      frozen_at: '2026-10-30T00:00:00.000Z',
      entries: [{ anchor: { symbol: 'a' }, kind: 'rewrite', detail: '改 a', judgement_ref: '', status: 'open' }],
    } as RewritePlan);
  }
}

/** 读一行画布的消解列 + 叙事列（**只读**开库；库/表不在 ⇒ 抛，不静默当 NULL —— 0.12） */
function rowOf(project: string, card: string, file: string): { at: string | null; reason: string | null; entries: string } {
  const dbFile = getTasksDbFile(project);
  assert.ok(fs.existsSync(dbFile), `画布库不在：${dbFile}`);
  const o = openTasksDbForRead(project, 'plans');
  if ('skip' in o) throw new Error(`读不到画布表：${JSON.stringify(o)}`);
  try {
    const r = o.db
      .prepare('SELECT dissolved_at, dissolve_reason, entries_json FROM plans WHERE card_id = ? AND file = ?')
      .get(card, file) as { dissolved_at: string | null; dissolve_reason: string | null; entries_json: string } | undefined;
    assert.ok(r, `画布行不存在：${card}|${file}`);
    return { at: r!.dissolved_at, reason: r!.dissolve_reason, entries: r!.entries_json };
  } finally {
    o.db.close();
  }
}

test('P0-dissolve ① 卡已结案 ⇒ 打 dissolved_at（叙事不动）· 重跑幂等', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-dissolve-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    seed(home, project, 'p0ds1', [{ id: 'n1', state: 'done', file: 'src/x.ts' }]);
    const narrativeBefore = rowOf(project, 'n1', 'src/x.ts').entries;

    const first = dissolvePlans(project);
    assert.equal(first.total, 1, '分母：表里 1 份');
    assert.equal(first.dissolved, 1, '卡已结案 ⇒ 这 1 份应被消解');
    assert.equal(first.kept_live, 0);
    assert.equal(first.narrative_intact, true, '消解≠删除：叙事三列逐行必须没动');
    const after = rowOf(project, 'n1', 'src/x.ts');
    assert.ok(after.at, '必须留下时间戳');
    assert.match(String(after.reason), /^卡已结案：/, '理由必须带依据档，不是一句空话');
    assert.match(String(after.reason), /册\(p0ds1\)=done/, '依据档要指名"哪一处说了什么"');
    assert.equal(after.entries, narrativeBefore, 'entries_json 一个字节都不许变');

    const second = dissolvePlans(project);
    assert.equal(second.dissolved, 0, '幂等：第二次不许再写');
    assert.equal(second.already, 1);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-dissolve ② 已消解 ⇒ 那一块被重新编辑（再冻结）⇒ dissolved_at 必须变回 NULL', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-dissolve-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    seed(home, project, 'p0ds2', [{ id: 'n1', state: 'done', file: 'src/x.ts' }]);
    assert.equal(dissolvePlans(project).dissolved, 1);
    assert.ok(rowOf(project, 'n1', 'src/x.ts').at, '前提：确实消解过');

    writeRewritePlan(project, {
      path: 'src/x.ts',
      card: 'n1',
      frozen_at: '2026-11-03T00:00:00.000Z',
      entries: [{ anchor: { symbol: 'a' }, kind: 'rewrite', detail: '又改一次', judgement_ref: '', status: 'open' }],
    } as RewritePlan);

    const after = rowOf(project, 'n1', 'src/x.ts');
    assert.equal(after.at, null, '被编辑的那一块重新成为画布 ⇒ 消解标记必须失效');
    assert.equal(after.reason, null);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-dissolve ③ 写 A 行**不许**把 B 行的 dissolved_at 清掉（防无条件清空）', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-dissolve-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    seed(home, project, 'p0ds3', [
      { id: 'n1', state: 'done', file: 'src/a.ts' },
      { id: 'n2', state: 'done', file: 'src/b.ts' },
    ]);
    assert.equal(dissolvePlans(project).dissolved, 2);
    const bBefore = rowOf(project, 'n2', 'src/b.ts');
    assert.ok(bBefore.at && bBefore.reason);

    writeRewritePlan(project, {
      path: 'src/a.ts',
      card: 'n1',
      frozen_at: '2026-11-03T00:00:00.000Z',
      entries: [{ anchor: { symbol: 'a' }, kind: 'rewrite', detail: '只动 a', judgement_ref: '', status: 'open' }],
    } as RewritePlan);

    assert.equal(rowOf(project, 'n1', 'src/a.ts').at, null, '被写的那一行复活');
    const bAfter = rowOf(project, 'n2', 'src/b.ts');
    assert.equal(bAfter.at, bBefore.at, '没被写的行**一个字节都不许动**（粒度是 file，不是卡/全表）');
    assert.equal(bAfter.reason, bBefore.reason);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-dissolve ④ 消融点：卡只活在设计册 ⇒ 必须判 live、必须留着', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-dissolve-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    // ★ live_cards / task_history 都没有 n1：它**只**存在于 geometry.nodes[].task
    seed(home, project, 'p0ds4', [{ id: 'n1', state: 'candidate', file: 'src/x.ts' }]);

    const { lives, sheets_ok, why } = cardLivesOf(project);
    assert.equal(sheets_ok, true, '册读成功（false ⇒ 下面"留着"这个结论不可信）');
    assert.equal(lives.get('n1'), 'live', '册里 task.state=candidate ⇒ 活卡（唯一权威的第三处腿）');
    assert.match(String(why.get('n1')), /册\(p0ds4\)=candidate/, '凭据必须来自册那一腿（拆掉它就变红）');

    const rep = dissolvePlans(project);
    assert.equal(rep.dissolved, 0, '活卡的画布**永不消解**');
    assert.equal(rep.kept_live, 1);
    assert.equal(rowOf(project, 'n1', 'src/x.ts').at, null);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
