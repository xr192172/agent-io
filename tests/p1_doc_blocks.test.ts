/**
 * P1 · 文档投影核（批 1）：注册表形状 / 九态生命周期 / 确定性 / 自洽断言 / 五类反向突变 / 可扩展性。
 *
 * ## 口径
 * · 反向突变夹具全部在隔离 TEMP 目录跑，不写主仓 docs；
 * · 开发只跑本聚焦子集；全量留最终收口；
 * · 读端可注入（合成适配器），不新写 SQL / 不重解析 DSL。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADAPTERS, listAdapters } from '../src/application/docs_view/registry.js';
import { renderDocBlocks, renderBlock, defaultSelfCheck } from '../src/application/docs_view/render_doc_blocks.js';
import { checkDocBlocks } from '../src/application/docs_view/check_doc_blocks.js';
import {
  LIFECYCLE_STATES,
  canTransition,
  assertCommittable,
  isLifecycleState,
} from '../src/application/docs_view/lifecycle.js';
import { listSources, getSource, registerProjectionSource } from '../src/application/docs_view/authority_sources.js';
import type { AdapterSource, DocBlockAdapter, SourceItem } from '../src/application/docs_view/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doc-view-p1-'));
}

function writeDoc(root: string, rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

function synthSource(over: Partial<AdapterSource> = {}): AdapterSource {
  const items: SourceItem[] = [
    { id: 'card-a', labels: { lane: 'design', state: 'claimed' }, detail: '第一条' },
    { id: 'card-b', labels: { lane: 'meta', state: 'candidate' }, detail: '第二条' },
  ];
  return {
    adapterId: 'synth.block',
    rev: 'rev-1',
    items,
    labelSets: { lane: ['design', 'refactor', 'observe', 'cross', 'meta'], state: ['candidate', 'claimed', 'done', 'void', 'preparing'] },
    availability: { readable: true },
    ...over,
  };
}

function renderTable(source: AdapterSource): string {
  const rows = source.items.map((it) => `| \`${it.id}\` | ${it.labels.lane} | ${it.labels.state} | ${it.detail ?? ''} |`);
  return ['| 卡 | 线 | 状态 | 说明 |', '|---|---|---|---|', ...rows].join('\n');
}

function synthAdapter(holder: { source: AdapterSource }, render?: (s: AdapterSource) => string): DocBlockAdapter {
  return {
    id: 'synth.block',
    docRel: 'docs/SYNTH.md',
    title: '合成投影块',
    lifecycleStage: 'committed',
    read: () => holder.source,
    render: render ?? renderTable,
  };
}

function checkOne(root: string, adapter: DocBlockAdapter) {
  const r = checkDocBlocks(root, { adapters: [adapter] });
  assert.equal(r.blocks.length, 1);
  return r.blocks[0];
}

// ── 注册表形状 ──────────────────────────────────────────────────────────────

test('注册表：3 个投影适配器，block-id 唯一且 docRel 落 docs/', () => {
  const adapters = listAdapters();
  assert.equal(adapters.length, 3);
  const ids = adapters.map((a) => a.id);
  assert.deepEqual([...ids].sort(), ['dev.live-cards', 'guide.gates', 'index.tools'].sort());
  for (const a of adapters) {
    assert.match(a.docRel, /^docs\//);
    assert.equal(a.lifecycleStage, 'committed');
    assert.equal(typeof a.read, 'function');
    assert.equal(typeof a.render, 'function');
  }
});

test('权威地图：人写权威输入不可再生 / 归档不挂 fresh 门 / 投影可再生，三类分清', () => {
  const inputs = listSources('authority-input');
  const archives = listSources('archive');
  const projections = listSources('projection');
  assert.ok(inputs.length >= 4);
  for (const e of inputs) {
    assert.equal(e.regenerable, false, `权威输入 \`${e.id}\` 不可再生`);
    assert.ok(e.owner, '权威输入必须有 owner');
  }
  for (const e of archives) assert.equal(e.state, 'archived');
  assert.equal(projections.length, 3);
  for (const e of projections) {
    assert.equal(e.regenerable, true);
    assert.equal(e.state, 'projected');
  }
  const vision = getSource('vision-original');
  assert.ok(vision);
  assert.equal(vision?.kind, 'authority-input');
});

test('权威输入源不允许被投影条目覆盖（视图不是源）', () => {
  assert.throws(
    () =>
      registerProjectionSource({
        id: 'vision-original',
        kind: 'projection',
        path: 'docs/VISION-ORIGINAL.md',
        owner: 'kernel',
        state: 'projected',
        regenerable: true,
        provenance: { source_kind: 'x', source_ref: 'x' },
        note: '越权覆盖',
      }),
    /权威输入源/,
  );
});

// ── 九态生命周期 ────────────────────────────────────────────────────────────

test('九态闭集完整：ingested…archived 全建模', () => {
  assert.deepEqual([...LIFECYCLE_STATES], [
    'ingested', 'parsed', 'translated', 'blocked', 'adjudicated',
    'committed', 'projected', 'stale', 'archived',
  ]);
  for (const s of LIFECYCLE_STATES) assert.ok(isLifecycleState(s));
  assert.equal(isLifecycleState('nope'), false);
});

test('生命周期迁移：A 段预留链 ingested→parsed→translated→adjudicated→committed→projected 合法', () => {
  const flow = ['ingested', 'parsed', 'translated', 'adjudicated', 'committed', 'projected'] as const;
  for (let i = 0; i < flow.length - 1; i += 1) {
    assert.ok(canTransition(flow[i], flow[i + 1]), `${flow[i]} → ${flow[i + 1]} 应合法`);
  }
  // blocked 可回候选 / 进裁决；projected 可落 stale；stale 可重生成回 projected
  assert.ok(canTransition('blocked', 'adjudicated'));
  assert.ok(canTransition('blocked', 'translated'));
  assert.ok(canTransition('projected', 'stale'));
  assert.ok(canTransition('stale', 'projected'));
});

test('committed 闸：blocked / translated / unknown / 未验证不得落权威', () => {
  assert.equal(assertCommittable('adjudicated').ok, true);
  for (const bad of ['blocked', 'translated', 'parsed', 'ingested', 'projected', 'stale', 'archived']) {
    const r = assertCommittable(bad as never);
    assert.equal(r.ok, false, `\`${bad}\` 不得落 committed`);
  }
  assert.equal(canTransition('blocked', 'committed'), false);
  assert.equal(canTransition('translated', 'committed'), false);
});

// ── 确定性 ───────────────────────────────────────────────────────────────────

test('确定性：同输入两次渲染逐字节相同（不渗本机态/时区）', () => {
  const first = renderDocBlocks(ROOT, { adapters: ADAPTERS }).map((b) => b.blockText);
  const second = renderDocBlocks(ROOT, { adapters: ADAPTERS }).map((b) => b.blockText);
  assert.deepEqual(first, second);
  // 元数据行（块头/块尾）不渗本机时刻；正文里的日期来自权威源读数，不算渲染渗态
  for (const b of renderDocBlocks(ROOT, { adapters: ADAPTERS })) {
    for (const line of [b.header, b.footer]) {
      assert.doesNotMatch(line, /\d{4}-\d{2}-\d{2}T/, `元数据行不得带本机时刻：${line}`);
    }
  }
});

// ── 自洽断言（独立实体现算）─────────────────────────────────────────────────

test('自洽断言：计数 == 源集合长度；标签 ∈ 闭集；矛盾给 violation', () => {
  const okSrc = synthSource();
  const ok = defaultSelfCheck(okSrc, renderTable(okSrc));
  assert.equal(ok.ok, true);
  assert.equal(ok.renderedCount, 2);
  assert.equal(ok.sourceCount, 2);

  // 计数矛盾：源 2 条，渲染只出 1 行
  const shortBody = ['| 卡 | 线 | 状态 | 说明 |', '|---|---|---|---|', '| `card-a` | design | claimed | 第一条 |'].join('\n');
  const countBad = defaultSelfCheck(okSrc, shortBody);
  assert.equal(countBad.ok, false);
  assert.match(countBad.violations[0], /渲染行数 1 ≠ 源集合长度 2/);

  // 标签越闭集
  const badLabel = synthSource({ items: [{ id: 'card-z', labels: { lane: 'ghost', state: 'claimed' } }] });
  const labelBad = defaultSelfCheck(badLabel, renderTable(badLabel));
  assert.equal(labelBad.ok, false);
  assert.ok(labelBad.violations.some((v) => v.includes('ghost')));
});

// ── 五类反向突变（隔离 TEMP）───────────────────────────────────────────────

test('突变① 手改生成区 ⇒ hand-edited（非绿 exit 1）', () => {
  const root = mkTemp();
  const holder = { source: synthSource() };
  const adapter = synthAdapter(holder);
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, `散文前缀（块外逐字保留）\n\n${block.blockText}\n`);

  const before = checkOne(root, adapter);
  assert.equal(before.state, 'current');

  const disk = fs.readFileSync(path.join(root, adapter.docRel), 'utf8');
  const tampered = disk.replace('第一条', '被手改的一行');
  writeDoc(root, adapter.docRel, tampered);

  const after = checkOne(root, adapter);
  assert.equal(after.state, 'hand-edited');
  assert.equal(after.exitCode, 1);
});

test('突变② 删乱标记 ⇒ missing（exit 3）', () => {
  const root = mkTemp();
  const holder = { source: synthSource() };
  const adapter = synthAdapter(holder);
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, block.blockText);

  const disk = fs.readFileSync(path.join(root, adapter.docRel), 'utf8');
  const noBegin = disk.replace(/<!--[^\n]*DOC:GEN:synth\.block:BEGIN[^\n]*-->\n/, '');
  writeDoc(root, adapter.docRel, noBegin);

  const res = checkOne(root, adapter);
  assert.equal(res.state, 'missing');
  assert.equal(res.exitCode, 3);
});

test('突变③ 计数/标签矛盾 ⇒ 自洽断言红（render-failed exit 1）', () => {
  const root = mkTemp();
  const holder = { source: synthSource() };
  // 渲染器只出 1 行，源有 2 条
  const adapter = synthAdapter(holder, () => '| 卡 | 线 |\n|---|---|\n| `card-a` | design |');
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, block.blockText);

  const res = checkOne(root, adapter);
  assert.equal(res.state, 'render-failed');
  assert.equal(res.exitCode, 1);
  assert.ok(res.reasons.length > 0);
});

test('突变④ 权威前进未重生成 ⇒ stale（rev 不一致，exit 3）', () => {
  const root = mkTemp();
  const holder = { source: synthSource() };
  const adapter = synthAdapter(holder);
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, block.blockText);
  assert.equal(checkOne(root, adapter).state, 'current');

  // 权威前进：rev 与条目都变，盘上仍旧版
  holder.source = synthSource({
    rev: 'rev-2',
    items: [
      { id: 'card-a', labels: { lane: 'design', state: 'claimed' }, detail: '第一条改了' },
      { id: 'card-b', labels: { lane: 'meta', state: 'done' }, detail: '第二条' },
      { id: 'card-c', labels: { lane: 'cross', state: 'claimed' }, detail: '新增第三条' },
    ],
  });
  const res = checkOne(root, adapter);
  assert.equal(res.state, 'stale');
  assert.equal(res.exitCode, 3);
});

test('突变⑤ 块外散文手改 ⇒ 块仍 current（不误判生成区）', () => {
  const root = mkTemp();
  const holder = { source: synthSource() };
  const adapter = synthAdapter(holder);
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, `## 手写标题\n\n一段手写散文。\n\n${block.blockText}\n\n文末手写散文。\n`);
  assert.equal(checkOne(root, adapter).state, 'current');

  const disk = fs.readFileSync(path.join(root, adapter.docRel), 'utf8');
  const edited = disk.replace('一段手写散文。', '一段被人改写的手写散文（块外）。');
  writeDoc(root, adapter.docRel, edited);

  const res = checkOne(root, adapter);
  assert.equal(res.state, 'current');
  assert.equal(res.exitCode, 0);
});

// ── O1 终局序：可用性闸先于自洽断言（不可用源带条目也不得落 render-failed）─────

test('O1：读端不可用（engineAbsent）带条目 ⇒ degraded-current，不落 render-failed', () => {
  const root = mkTemp();
  const holder = {
    source: synthSource({
      availability: { readable: false, engineAbsent: true, reason: '引擎缺席（夹具）' },
    }),
  };
  // 渲染只出 1 行（与 2 条目计数矛盾）：若自洽断言先跑必落 render-failed；
  // 断言落 degraded-current 即证明可用性闸先于自洽断言。
  const adapter = synthAdapter(holder, () => '| 卡 | 线 | 状态 | 说明 |\n|---|---|---|---|\n| `card-a` | design | claimed | 第一条 |');
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, block.blockText);

  const res = checkOne(root, adapter);
  assert.equal(res.state, 'degraded-current');
  assert.equal(res.exitCode, 1);
  assert.notEqual(res.state, 'render-failed');
});

test('O1：读端不可用（unjudgeable）带条目 ⇒ unjudgeable，不落 render-failed', () => {
  const root = mkTemp();
  const holder = {
    source: synthSource({
      availability: { readable: false, engineAbsent: false, reason: '读不到（夹具）' },
    }),
  };
  const adapter = synthAdapter(holder, () => '| 卡 | 线 | 状态 | 说明 |\n|---|---|---|---|\n| `card-a` | design | claimed | 第一条 |');
  const block = renderBlock(adapter, root);
  writeDoc(root, adapter.docRel, block.blockText);

  const res = checkOne(root, adapter);
  assert.equal(res.state, 'unjudgeable');
  assert.equal(res.exitCode, 1);
  assert.notEqual(res.state, 'render-failed');
});

// ── 可扩展性证明：后续规范源吸收适配器无需改内核 ─────────────────────────────

test('可扩展性：合成规范源走 authority-input→…→committed→projected 流转，投影适配器读 committed 源', () => {
  // ① 未来 A 段管线：权威输入候选经九态流转（本批只建模状态机，不施工语义翻译）
  const pipeline = ['ingested', 'parsed', 'translated', 'blocked', 'adjudicated', 'committed', 'projected'] as const;
  for (let i = 0; i < pipeline.length - 1; i += 1) {
    assert.ok(canTransition(pipeline[i], pipeline[i + 1]), `规范源流转 ${pipeline[i]}→${pipeline[i + 1]} 应被契约接纳`);
  }
  // blocked（缺模型/冲突未决）不得直接 committed
  assert.equal(assertCommittable('blocked').ok, false);

  // ② 规范源适配器契约位：lifecycleStage / availability / selfCheck 可携带 A 段轨迹
  const specHolder: { source: AdapterSource } = {
    source: synthSource({ adapterId: 'spec.goal-node', rev: 'spec-1' }),
  };
  const specAdapter: DocBlockAdapter = {
    id: 'spec.goal-node',
    docRel: 'docs/SPEC.md',
    title: '后续规范源投影（夹具）',
    lifecycleStage: 'committed', // A 段裁决落 committed 后接入投影
    read: () => specHolder.source,
    render: renderTable,
  };

  const root = mkTemp();
  const block = renderBlock(specAdapter, root);
  writeDoc(root, specAdapter.docRel, block.blockText);
  const res = checkDocBlocks(root, { adapters: [specAdapter] });
  assert.equal(res.green, true);
  assert.equal(res.blocks[0].state, 'current');

  // ③ 权威输入源仍登记为不可再生；规范语义化入 DSL 留后续 A 段，本批不硬造伪判据
  const input = getSource('retired');
  assert.equal(input?.regenerable, false);
});
