/**
 * P3 · 既有裸奔对账（批 3）：镜像对账比较器 / 结案投影点名 / 索引 verdict 三态映射。
 *
 * ## 口径
 * · 夹具全部在隔离 TEMP 目录跑，不写主仓 docs / 真数据仓；AGENT_IO_HOME 指到 TEMP（注册表空）；
 * · 开发只跑本聚焦子集；全量留最终收口；
 * · 反向突变夹具：改字段 / 缺行 / 多行 / 坏行 / 册单侧投影 / blocker 断言，逐条必须被抓到。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { reconcileTasksMirror } from '../src/application/meta/reconcile/tasks_mirror.js';
import { classifyClosedOnly, nameClosedOnlyProjections } from '../src/application/meta/reconcile/stale_projection.js';
import { integrityVerdict } from '../src/application/meta/integrity/index_integrity.js';
import { getTasksJsonlFile } from '../src/infrastructure/task_history.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p3-reconcile-'));
}

const LIVE_DDL = `CREATE TABLE live_cards (
  id TEXT NOT NULL, feature TEXT NOT NULL, state TEXT NOT NULL,
  card_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (feature, id));`;
const HIST_DDL = `CREATE TABLE task_history (
  id TEXT NOT NULL, feature TEXT NOT NULL, node_id TEXT, state TEXT NOT NULL,
  summary TEXT NOT NULL, card_json TEXT NOT NULL, moved_at TEXT NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY (feature, id, moved_at));`;

const LIVE = { id: 'todo_live-1', feature: 'agent-io', state: 'candidate', card: { summary: '活卡', owner: 'tester' }, updated_at: '2026-11-23T01:00:00Z' };
const HIST = { id: 'todo_hist-1', feature: 'agent-io', node_id: 'file_x_ts', state: 'done', summary: '了结卡', card: {}, moved_at: '2026-11-22T10:00:00Z', reason: '销账' };

function seedDb(root: string, live: unknown[] = [LIVE], hist: unknown[] = [HIST]): void {
  const dir = path.join(root, '.agent-io');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'tasks.db'));
  db.exec(LIVE_DDL + HIST_DDL);
  const insLive = db.prepare('INSERT INTO live_cards (id, feature, state, card_json, updated_at) VALUES (?,?,?,?,?)');
  for (const c of live as typeof LIVE[]) insLive.run(c.id, c.feature, c.state, JSON.stringify(c.card ?? {}), c.updated_at);
  const insHist = db.prepare('INSERT INTO task_history (id, feature, node_id, state, summary, card_json, moved_at, reason) VALUES (?,?,?,?,?,?,?,?)');
  for (const h of hist as typeof HIST[]) insHist.run(h.id, h.feature, h.node_id ?? null, h.state, h.summary, JSON.stringify(h.card ?? {}), h.moved_at, h.reason);
  db.close();
}

function mirrorLive(c: typeof LIVE) {
  return { kind: 'live', feature: c.feature, id: c.id, state: c.state, card: c.card, updated_at: c.updated_at };
}
function mirrorHist(h: typeof HIST) {
  return { kind: 'history', feature: h.feature, id: h.id, node_id: h.node_id, state: h.state, summary: h.summary, moved_at: h.moved_at, reason: h.reason };
}

function writeMirror(root: string, rows: unknown[]): void {
  fs.writeFileSync(getTasksJsonlFile(root), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

// ── G3 镜像对账：一致 ⇒ ok ────────────────────────────────────────

test('镜像对账：库与镜像一致 ⇒ ok，两侧分母闭合', () => {
  const root = mkTemp();
  seedDb(root);
  writeMirror(root, [mirrorLive(LIVE), mirrorHist(HIST)]);
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'ok');
  assert.equal(r.live.dbRows, 1);
  assert.equal(r.live.mirrorRows, 1);
  assert.equal(r.history.dbRows, 1);
  assert.equal(r.history.mirrorRows, 1);
  assert.equal(r.badLines.length, 0);
});

// ── 反向突变①：改镜像一行字段 ⇒ 字段不符红 ─────────────────────────

test('突变①：镜像活卡 state 被改 ⇒ 字段不符点名，分叉红', () => {
  const root = mkTemp();
  seedDb(root);
  const mutated = { ...mirrorLive(LIVE), state: 'claimed' };
  writeMirror(root, [mutated, mirrorHist(HIST)]);
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'diverged');
  assert.equal(r.live.mismatches.length, 1);
  assert.match(r.live.mismatches[0].detail, /state/);
  assert.equal(r.live.missing.length, 0);
  assert.equal(r.live.extra.length, 0);
});

// ── 反向突变②：缺行 / 多行 ─────────────────────────────────────────

test('突变②a：镜像缺一条活卡 ⇒ 缺行点名', () => {
  const root = mkTemp();
  seedDb(root);
  writeMirror(root, [mirrorHist(HIST)]); // 只写历史
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'diverged');
  assert.equal(r.live.missing.length, 1);
  assert.equal(r.history.mismatches.length, 0);
});

test('突变②b：镜像多一条库里没有的活卡 ⇒ 多行点名', () => {
  const root = mkTemp();
  seedDb(root);
  const ghost = { kind: 'live', feature: 'agent-io', id: 'todo_ghost', state: 'candidate', card: {}, updated_at: '2026-11-23T02:00:00Z' };
  writeMirror(root, [mirrorLive(LIVE), mirrorHist(HIST), ghost]);
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'diverged');
  assert.equal(r.live.extra.length, 1);
  assert.match(r.live.extra[0].key, /todo_ghost/);
});

test('突变②c：历史行 reason 被改 ⇒ 历史字段不符点名', () => {
  const root = mkTemp();
  seedDb(root);
  const mutated = { ...mirrorHist(HIST), reason: '被手改的理由' };
  writeMirror(root, [mirrorLive(LIVE), mutated]);
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'diverged');
  assert.equal(r.history.mismatches.length, 1);
  assert.match(r.history.mismatches[0].detail, /reason/);
});

test('突变②d：镜像坏行（JSON 解析失败）⇒ 坏行点名，不静默跳过', () => {
  const root = mkTemp();
  seedDb(root);
  fs.writeFileSync(getTasksJsonlFile(root), `${JSON.stringify(mirrorLive(LIVE))}\n{broken json\n${JSON.stringify(mirrorHist(HIST))}\n`, 'utf-8');
  const r = reconcileTasksMirror(root);
  assert.equal(r.status, 'diverged');
  assert.equal(r.badLines.length, 1);
  assert.match(r.badLines[0].detail, /解析失败/);
});

test('镜像文件缺失：库空 ⇒ 一致；库有行 ⇒ 缺镜像分叉', () => {
  const empty = mkTemp();
  fs.mkdirSync(path.join(empty, '.agent-io'), { recursive: true });
  fs.writeFileSync(path.join(empty, '.agent-io', 'tasks.db'), Buffer.alloc(0));
  const rEmpty = reconcileTasksMirror(empty);
  assert.equal(rEmpty.status, 'ok');

  const withDb = mkTemp();
  seedDb(withDb);
  const rMissing = reconcileTasksMirror(withDb);
  assert.equal(rMissing.status, 'diverged');
  assert.equal(rMissing.live.missing.length, 1);
  assert.equal(rMissing.history.missing.length, 1);
});

// ── C6 结案投影点名（纯归类，隔离合成 lives/why）────────────────────

test('C6：仅册单侧凭据的结案投影被点名；库两侧有凭据 / 活卡不入选', () => {
  const lives = new Map<string, 'live' | 'closed' | 'gone'>([
    ['card-a', 'closed'], // live_cards 凭据
    ['card-b', 'closed'], // task_history 凭据
    ['card-c', 'closed'], // 仅册单侧 ⇒ 命中
    ['card-d', 'live'], // 活卡不入选
  ]);
  const why = new Map<string, string>([
    ['card-a', 'live_cards(agent-io)=claimed'],
    ['card-b', 'task_history(agent-io) + 册(agent-io)=done'],
    ['card-c', '册(agent-io)=done'],
    ['card-d', 'live_cards(agent-io)=claimed'],
  ]);
  const hits = classifyClosedOnly(lives, why);
  assert.deepEqual(hits.map((h) => h.cardId), ['card-c']);
  assert.equal(hits[0].feature, 'agent-io');
  assert.equal(hits[0].state, 'done');
});

test('C6：适配器层空数据家不抛错，册读成功且点名清单为空', () => {
  const root = mkTemp();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = mkTemp();
  try {
    const r = nameClosedOnlyProjections(root);
    assert.equal(r.sheetsOk, true);
    assert.equal(r.closedTotal, 0);
    assert.deepEqual(r.closedOnly, []);
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
  }
});

// ── G4 verdict 三态映射（纯函数；门脚本只做退出码翻译）─────────────

test('G4：verdict 三态映射 —— 无索引 unknown / 干净 trusted / blocker 或幽灵 untrusted', () => {
  assert.equal(integrityVerdict({ hasIndex: false, hasBlocker: false, hasGhost: false }), 'unknown');
  assert.equal(integrityVerdict({ hasIndex: true, hasBlocker: false, hasGhost: false }), 'trusted');
  assert.equal(integrityVerdict({ hasIndex: true, hasBlocker: true, hasGhost: false }), 'untrusted');
  assert.equal(integrityVerdict({ hasIndex: true, hasBlocker: false, hasGhost: true }), 'untrusted');
});
