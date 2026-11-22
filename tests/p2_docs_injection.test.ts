/**
 * P2 · 取数侧接线（批 2）：注入新鲜度标注 / 活卡台账取代 join / 取数顺序冻结。
 *
 * ## 口径
 * · 夹具全部在隔离 TEMP 目录跑，不写主仓 docs / 真数据仓；
 * · 开发只跑本聚焦子集；全量留最终收口；
 * · 对账 check 地图用合成 BlockCheck，不跑真适配器现算（隔离写验分离）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { annotateDocForInjection, segmentDoc } from '../src/application/docs_view/inject_annotate.js';
import { buildHeader, buildFooter } from '../src/application/docs_view/markers.js';
import { READ_ORDER_KEYS } from '../src/application/docs_view/read_order.js';
import { liveCardsAdapter } from '../src/application/docs_view/adapters/live_cards.js';
import type { BlockCheck, ReconState } from '../src/application/docs_view/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doc-view-p2-'));
}

function mkCheck(blockId: string, state: ReconState): BlockCheck {
  return {
    blockId,
    docRel: 'docs/X.md',
    state,
    rev: 'rev-1',
    reasons: ['夹具原因'],
    exitCode: state === 'current' ? 0 : 1,
  };
}

function blockText(blockId: string, body: string, rev = 'rev-1'): string {
  const header = buildHeader({ blockId, source: `adapter.${blockId}`, rev, cmd: 'npm run doc:render', generator: 'docs-view.render@0.1.3', bodySha16: '0123456789abcdef' });
  const footer = buildFooter(blockId, '0123456789abcdef');
  return `${header}\n${body}\n${footer}`;
}

// ── 注入标注：绿态保留 / 非绿剔除正文 ──────────────────────────────

test('注入标注：current 块正文保留并带状态/rev', () => {
  const doc = `## 手写标题\n\n一段人写散文。\n\n${blockText('demo.current', '正文里的现行数字 42 工具。')}`;
  const { text, blocks } = annotateDocForInjection(doc, new Map([['demo.current', mkCheck('demo.current', 'current')]]));
  assert.equal(blocks[0].state, 'current');
  assert.equal(blocks[0].retained, true);
  assert.ok(text.includes('现行数字 42 工具'));
  assert.ok(text.includes('状态=current'));
  assert.ok(text.includes('人写段'));
});

test('注入标注：degraded-current 保留但明示「没验引擎」', () => {
  const doc = blockText('demo.degraded', '降级缓冲正文。');
  const { text, blocks } = annotateDocForInjection(doc, new Map([['demo.degraded', mkCheck('demo.degraded', 'degraded-current')]]));
  assert.equal(blocks[0].state, 'degraded-current');
  assert.equal(blocks[0].retained, true);
  assert.ok(text.includes('降级未验引擎'));
  assert.ok(text.includes('降级缓冲正文'));
});

test('注入标注：stale 块正文剔除，不引用陈旧数字，转内部视图现取', () => {
  const doc = `人写引言。\n\n${blockText('demo.stale', '陈旧快照：42 工具（权威已前进到 43）。')}`;
  const { text, blocks } = annotateDocForInjection(doc, new Map([['demo.stale', mkCheck('demo.stale', 'stale')]]));
  assert.equal(blocks[0].state, 'stale');
  assert.equal(blocks[0].retained, false);
  assert.ok(!text.includes('42 工具'));
  assert.ok(text.includes('不得引用其中数字与结论'));
  assert.ok(text.includes('转内部视图现取'));
});

test('注入标注：hand-edited / missing / render-failed 同样剔除正文', () => {
  for (const state of ['hand-edited', 'missing', 'render-failed'] as const) {
    const doc = blockText(`demo.${state}`, '被手改/缺失/自洽失败的正文 999。');
    const { text, blocks } = annotateDocForInjection(doc, new Map([[`demo.${state}`, mkCheck(`demo.${state}`, state)]]));
    assert.equal(blocks[0].state, state);
    assert.equal(blocks[0].retained, false);
    assert.ok(!text.includes('999'));
  }
});

test('注入标注：未注册对账适配器的块 ⇒ unregistered（非绿），不冒充 current', () => {
  const doc = blockText('demo.unknown', '未对账正文 777。');
  const { text, blocks } = annotateDocForInjection(doc);
  assert.equal(blocks[0].state, 'unregistered');
  assert.equal(blocks[0].retained, false);
  assert.ok(!text.includes('777'));
  assert.ok(text.includes('未对账'));
});

test('注入标注：缺 END 的错配块落非绿（missing 形态），不保留正文', () => {
  const doc = `<!-- DOC:GEN:demo.broken:BEGIN source=adapter.demo.broken@rev-1 cmd="x" format=docs-view-v1 generator=g body_sha256=aaa -->\n孤儿正文 555。`;
  const { blocks } = annotateDocForInjection(doc);
  assert.equal(blocks[0].blockId, 'demo.broken');
  assert.equal(blocks[0].retained, false);
});

test('segmentDoc：人写段与投影块分段，块外散文不被当块', () => {
  const doc = `# 标题\n\n散文一段。\n\n${blockText('demo.seg', '块正文。')}\n\n文末散文。`;
  const segs = segmentDoc(doc);
  assert.equal(segs.filter((s) => s.kind === 'block').length, 1);
  assert.ok(segs[0].kind === 'prose');
  assert.ok(segs.some((s) => s.kind === 'prose' && s.text.includes('文末散文')));
});

// ── 活卡台账取代 join（只读 TEMP tasks.db）────────────────────────

function seedTasksDb(root: string, cards: Array<{ id: string; state: string; card: Record<string, unknown> }>, supersededRefIds: string[]): void {
  const dir = path.join(root, '.agent-io');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'tasks.db'));
  db.exec('CREATE TABLE live_cards (id TEXT, feature TEXT, state TEXT, card_json TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE ledger_rows (ref_id TEXT, state TEXT, superseded_by TEXT)');
  const insCard = db.prepare('INSERT INTO live_cards (id, feature, state, card_json, updated_at) VALUES (?, ?, ?, ?, ?)');
  cards.forEach((c, i) =>
    insCard.run(c.id, 'fx', c.state, JSON.stringify({ id: c.id, ...c.card }), `2026-11-23T0${i}:00:00Z`),
  );
  const sup = db.prepare('INSERT INTO ledger_rows (ref_id, state, superseded_by) VALUES (?, ?, ?)');
  supersededRefIds.forEach((id) => sup.run(id, 'active', 'R-new-ref'));
  db.close();
}

test('活卡 join：open ∧ 台账未被取代；done 与被取代 ref_id 同号的卡剔除', () => {
  const root = mkTemp();
  seedTasksDb(
    root,
    [
      { id: 'todo_kept', state: 'candidate', card: { summary: '保留卡' } },
      { id: 'todo_superseded', state: 'candidate', card: { summary: '被台账取代' } },
      { id: 'todo_done', state: 'done', card: { summary: '已了结' } },
    ],
    ['todo_superseded'],
  );
  const source = liveCardsAdapter.read(root);
  const ids = source.items.map((it) => it.id);
  assert.deepEqual(ids, ['todo_kept']);
});

test('活卡 join：台账读不到（无表）⇒ 不炸，按无取代指针计（空集）', () => {
  const root = mkTemp();
  seedTasksDb(root, [{ id: 'todo_alone', state: 'claimed', card: { summary: '独资卡' } }], []);
  // 删掉 ledger_rows 表模拟台账无表
  const db = new DatabaseSync(path.join(root, '.agent-io', 'tasks.db'));
  db.exec('DROP TABLE ledger_rows');
  db.close();
  const source = liveCardsAdapter.read(root);
  assert.deepEqual(source.items.map((it) => it.id), ['todo_alone']);
  assert.ok(source.availability.reason); // join 跳过原因可见化，不静默
});

// ── 取数顺序冻结 ─────────────────────────────────────────────────

test('取数顺序：READ_ORDER_KEYS 冻结为内部视图优先六步', () => {
  assert.deepEqual(READ_ORDER_KEYS, ['capability_map', 'index_integrity', 'get_dsl', 'design_line', 'ledger', 'capability_audit']);
});
