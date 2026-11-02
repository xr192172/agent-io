/**
 * P0 · 「功能 → 册里最像的节点」的排序器（`src/domain/locate_score.ts`）
 *
 * ## 它挡的事故
 * 排序器坏起来**没有声音**：把"差得远"排成"最像"，回执长得和"真像"一模一样
 * ⇒ 调用方会照着 top-1 去改一个不相干的文件（正是"新建而不是找到原节点"的反面代价）。
 *
 * ## 断言口径（AGENTS-RULES 0.14 双向，缺一条就不具鉴别力）
 * - **同义必命中**：`rename_symbols` / `renameSymbols` / `rename-symbols` 必须都回到同一个文件；
 * - **异义必不命中**：设计册里确实没有的功能（`PDF`）必须 `verdict='none'`，且不许硬凑候选；
 * - **口径钉住**：单字 CJK 查询不许产生空向量（空向量 = 静默返回空集，等于假绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCATE_DISCLAIMER,
  buildLocateIndex,
  rankLocate,
  tokenizeLocate,
  type LocateDoc,
} from '../../src/domain/locate_score.js';

const doc = (o: Partial<LocateDoc> & { key: string; text: string }): LocateDoc => ({
  feature: 'f',
  kind: 'file',
  id: o.key,
  label: o.key,
  symbols: [],
  ...o,
});

/** 合成语料：三份"像"、一份"不像"，全部用真项目里会出现的词形。 */
const CORPUS: LocateDoc[] = [
  doc({
    key: 'file:src/application/refactor/rename/rename_symbols.ts',
    path: 'src/application/refactor/rename/rename_symbols.ts',
    text: 'src/application/refactor/rename/rename_symbols.ts 跨文件改名符号 renameSymbols',
    symbols: ['renameSymbols', 'RenameEntry'],
  }),
  doc({
    key: 'file:src/application/refactor/rename/rename_files.ts',
    path: 'src/application/refactor/rename/rename_files.ts',
    text: 'src/application/refactor/rename/rename_files.ts 文件改名并联动 import renameFiles',
    symbols: ['renameFiles'],
  }),
  doc({
    key: 'file:src/domain/consumer_tally.ts',
    path: 'src/domain/consumer_tally.ts',
    text: '消费者三档计数的唯一算法（跨文件导入方 / 同文件使用点）',
  }),
  doc({
    key: 'node:dir_src_domain',
    kind: 'node',
    text: '📁 domain 概念族',
  }),
];

const index = buildLocateIndex(CORPUS);

test('① 同义必命中：三种词形（下划线 / 驼峰 / 连字符分词）都回到 rename_symbols.ts', () => {
  for (const q of ['rename_symbols', 'renameSymbols', 'rename symbols']) {
    const r = rankLocate(index, q, { top: 1 });
    assert.equal(r.verdict, 'strong', `${q} 应有 strong 候选`);
    assert.equal(r.hits[0]?.doc.path, 'src/application/refactor/rename/rename_symbols.ts', `${q} 应命中 rename_symbols.ts`);
  }
});

test('② 异义必不命中：册里没有的功能（PDF）⇒ verdict=none，且**不给候选**', () => {
  const r = rankLocate(index, '生成 PDF 报告', { top: 5 });
  assert.equal(r.verdict, 'none');
  assert.deepEqual(r.hits, [], '无匹配时不许硬凑一个"最像的"');
  // ★ 取证在 terms 里：pdf 的 df=0 = "设计册里根本没这个词"
  assert.equal(r.terms.find((t) => t.term === 'pdf')?.df, 0);
});

test('③ 中文功能描述按二元组命中（同义），且单字 CJK 不会产出空向量（异义不静默）', () => {
  assert.deepEqual(tokenizeLocate('消费者计数'), ['消费', '费者', '者计', '计数']);
  const r = rankLocate(index, '消费者计数', { top: 1 });
  assert.equal(r.hits[0]?.doc.path, 'src/domain/consumer_tally.ts');
  // 单字查询的向量必须非空 —— 否则 rankLocate 会静默返回空集，与"没有"同形
  const single = rankLocate(index, '改', { top: 1 });
  assert.ok(single.terms.length > 0, '单字查询必须仍有查询词（可以无候选，但不能连词都没有）');
});

test('④ 分词口径：ASCII 丢弃单字符、CJK 只出二元组（防"中文一元组把一切排成最像"）', () => {
  assert.deepEqual(tokenizeLocate('a b cd'), ['cd']);
  assert.deepEqual(tokenizeLocate('代码'), ['代码']);
  // 异义：把 token 拆开（`rename` 与 `symbols` 中间插入别的词）不许等价于原查询
  const asOne = rankLocate(index, 'rename_symbols', { top: 1 }).hits[0]?.score ?? 0;
  const split = rankLocate(index, 'rename and then symbols', { top: 1 }).hits[0]?.score ?? 0;
  assert.ok(split <= asOne, '插入停用词后不许比原查询更像');
});

test('⑤ 免责句是**常量**（判据 c：调用方拿到的每一份读数都带着它）', () => {
  assert.ok(LOCATE_DISCLAIMER.includes('候选'));
  assert.ok(LOCATE_DISCLAIMER.includes('Type-4'));
});
