/**
 * 同名顶层符号冻结指纹回归。
 *
 * 真实 DSH 试点里 failure/refused 有多个 parent IS NULL 的索引行。
 * 冻结端 Record<name,hash> 最后一行覆盖，出口端又逐行比较，导致只改变
 * SQLite 行序就把未改文件报成 changed_unplanned。本证先固定这个假阳性，
 * 再用真实变化证明修复没有靠关闭 changed_unplanned 来变绿。
 *
 * 边界：这是排序多重集兼容修复，不是 occurrence 身份系统；plannedAnchors
 * 仍按整个名字豁免，NULL body_hash 与整名新增/删除保持既有独立语义。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { symbolFpsOf } from '../src/application/write_gate.js';
import { checkRewriteExit } from '../src/application/design/db/plan_exit_check.js';
import { writeRewritePlan, type RewritePlan, type RewritePlanEntry } from '../src/application/design/db/rewrite_plan.js';
import { closeProjectCacheDb, getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { contentHash } from '../src/infrastructure/index/symbols.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REL = 'src/duplicate.ts';
const CARD = 'duplicate-symbol-fingerprint-test';
const SOURCE = '// 数据库夹具只模拟索引行；源码字节始终不变。\n';

type Row = { id: string; name: string; hash: string; line: number };

const ORIGINAL: Row[] = [
  { id: 'failure-1', name: 'failure', hash: 'h1', line: 10 },
  { id: 'refused-1', name: 'refused', hash: 'r1', line: 20 },
  { id: 'failure-2', name: 'failure', hash: 'h2', line: 30 },
  { id: 'stable', name: 'stable', hash: 's1', line: 40 },
  { id: 'refused-2', name: 'refused', hash: 'r2', line: 50 },
];
const REINDEXED = [ORIGINAL[4], ORIGINAL[2], ORIGINAL[3], ORIGINAL[1], ORIGINAL[0]];

function replaceRows(root: string, rows: Row[]): void {
  // getProjectCacheDb 是池化连接；只能在整份夹具结束时经 closeProjectCacheDb 关闭。
  const db = getProjectCacheDb(root);
  db.exec('BEGIN');
  db.prepare('DELETE FROM nodes WHERE file_path = ?').run(REL);
  const insert = db.prepare(`INSERT INTO nodes
    (id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, body_hash, updated_at)
    VALUES (?, 'function', ?, ?, ?, 'typescript', ?, ?, NULL, ?, ?)`);
  for (const row of rows) {
    insert.run(`${REL}#${row.id}`, row.name, row.name, REL, row.line, row.line + 1, row.hash, Date.now());
  }
  db.exec('COMMIT');
}

function updateHash(root: string, id: string, hash: string): void {
  const db = getProjectCacheDb(root);
  db.prepare('UPDATE nodes SET body_hash = ? WHERE id = ?').run(hash, `${REL}#${id}`);
}

function planWith(fps: Record<string, string>, entries: RewritePlanEntry[] = []): RewritePlan {
  return {
    path: REL,
    card: CARD,
    entries,
    untouched: [
      { symbol: 'failure', why: '除 planned 豁免用例外，本回归不计划修改 failure。' },
      { symbol: 'refused', why: '同名行序变化不是源码改动。' },
      { symbol: 'stable', why: '单符号旧 raw hash 兼容性控制。' },
    ],
    symbols_at_freeze: ['failure', 'refused', 'stable'],
    fps_at_freeze: fps,
    frozen_at: '2026-11-20T00:00:00.000Z',
    base: { content_hash: contentHash(SOURCE) },
  };
}

test('duplicate symbol fingerprints survive index row reorder', () => {
  const root = makeTempHome();
  const home = makeTempHome();
  const previousHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, REL), SOURCE, 'utf-8');
    replaceRows(root, ORIGINAL);
    const frozen = symbolFpsOf(root, REL);
    assert.equal(frozen.ok, true, frozen.reason);
    assert.equal(frozen.fps.stable, 's1', '单符号必须保留旧 raw body_hash');
    writeRewritePlan(root, planWith(frozen.fps));

    // 修前红：没有 body 变化，只把同一批行逆序重插，last-row-wins 就换值。
    replaceRows(root, REINDEXED);
    const reindexed = symbolFpsOf(root, REL);
    assert.equal(reindexed.ok, true, reindexed.reason);
    assert.equal(reindexed.fps.failure, frozen.fps.failure, 'failure 指纹不得依赖数据库行序');
    assert.equal(reindexed.fps.refused, frozen.fps.refused, 'refused 指纹不得依赖数据库行序');
    assert.deepEqual(
      checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned,
      [],
      '同一组同名体仅索引行序变化，不是计划外源码改动',
    );

    // 真改一个同名体必须仍然报红；不能只修掉假阳性就关闭整条守卫。
    updateHash(root, 'failure-1', 'h1-changed');
    assert.deepEqual(checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned, ['failure']);

    // 精确恢复后重新变绿，证明上一条红来自 body 变化而不是夹具漂移。
    replaceRows(root, REINDEXED);
    assert.deepEqual(checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned, []);

    // 重复 hash 也代表一行：增加一个相同 body 的同名体不能被 Set 去重吞掉。
    replaceRows(root, [...REINDEXED, { id: 'failure-3', name: 'failure', hash: 'h1', line: 60 }]);
    assert.deepEqual(checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned, ['failure']);

    // 删除一个同名体同样必须报红（本范围是部分删除；整名删除是既有独立边界）。
    replaceRows(root, REINDEXED.filter((row) => row.id !== 'failure-1'));
    assert.deepEqual(checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned, ['failure']);

    // legacy duplicate 已丢失其余行的冻结事实：旧 raw hash 命中任一行也不许猜放行。
    writeRewritePlan(root, planWith({ failure: 'h2', refused: 'r2', stable: 's1' }));
    replaceRows(root, REINDEXED);
    assert.deepEqual(
      checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned.sort(),
      ['failure', 'refused'],
      '旧重复名画布即使完全未变也必须重冻结；单元素 stable 仍兼容',
    );

    // 旧 raw 与“本来就只有一个符号”没有格式位可区分：若 legacy duplicate 在
    // 重冻结前已删成单行，本兼容格式无法事后识别；所以旧画布必须主动重冻结。
    // 这里只断言可判定边界：同名多行仍在时绝不接受旧 raw，重冻结后立即恢复。
    const refrozen = symbolFpsOf(root, REL);
    assert.equal(refrozen.ok, true, refrozen.reason);
    assert.equal(refrozen.fps.failure?.startsWith('multiset:'), true);
    assert.equal(refrozen.fps.refused?.startsWith('multiset:'), true);
    writeRewritePlan(root, planWith(refrozen.fps));
    assert.deepEqual(checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned, []);

    // 既有 plannedAnchors 是整名豁免，本最小修复不冒充 occurrence 级锚点。
    replaceRows(root, REINDEXED);
    writeRewritePlan(root, planWith(frozen.fps, [
      {
        anchor: { symbol: 'failure' },
        kind: 'rewrite',
        detail: '计划允许修改 failure 这个名字。',
        judgement_ref: 'decision:duplicate-symbol-fingerprint-test#0',
        status: 'open',
      },
    ]));
    updateHash(root, 'failure-1', 'h1-planned-change');
    assert.deepEqual(
      checkRewriteExit(root, REL, { cardId: CARD }).changed_unplanned,
      [],
      'planned 名字仍按既有语义豁免，其他未改名字也不得误报',
    );
  } finally {
    if (previousHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = previousHome;
    closeProjectCacheDb(root);
    rmRf(root);
    rmRf(home);
  }
});
