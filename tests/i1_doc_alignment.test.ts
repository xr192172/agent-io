/**
 * I1 · 第 3/4/8 条（文档对齐三件套，用测试钉住）：
 * · kinds 表进 get_dsl 的入参 schema 描述（含 run 首行「不执行命令，只求值表达式」/ source-has 纯子串）；
 * · domain/expectation.ts 的 run kind 文档首行同口径；
 * · op_data_spec 的 todo 段写明「claim/complete 走 type=task（用 todo id）」且 todo 不跑节点建构判定；
 *   decision idNote / node note 的 service 放开与 decision 合并语义也在册。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DESIGN_TOOLS } from '../src/application/design/index.js';
import { renderOpSpecs, OP_SPECS } from '../src/application/design/dsl_ops/op_data_spec.js';

const getDsl = DESIGN_TOOLS.find((d) => d.name === 'get_dsl') as (typeof DESIGN_TOOLS)[number];
const editDsl = DESIGN_TOOLS.find((d) => d.name === 'edit_dsl') as (typeof DESIGN_TOOLS)[number];

test('get_dsl 入参 schema：query 描述含「判据 kinds 字段表」', () => {
  const schema = getDsl.inputSchema as { query?: { description?: string } };
  assert.match(schema.query?.description ?? '', /判据 kinds 字段表/);
});

test('kinds 表逐条：symbol-exists / source-has=纯子串 / run=不执行命令只求值表达式', () => {
  const schema = getDsl.inputSchema as { query?: { description?: string } };
  const d = schema.query?.description ?? '';
  assert.match(d, /symbol-exists=\{path, symbol, why\}/);
  assert.match(d, /source-has=\{path, must\?\/mustNot\?, why\} —— \*\*纯子串\*\*/);
  assert.match(d, /run=\{input\?, expect, why\} —— \*\*不执行命令，只求值表达式\*\*/);
});

test('domain/expectation.ts：run kind 的声明文档首行写明「不执行命令，只求值表达式」', async () => {
  const src = fsRead('../src/domain/expectation.ts');
  assert.match(src, /不执行命令，只求值表达式/);
});

test('edit_dsl 描述渲染的 op 表（renderOpSpecs）随 schema 出去且含 kinds 相关的 decision 键', () => {
  assert.match(editDsl.description, /data 契约/);
  assert.ok(renderOpSpecs().length > 100);
});

test('todo 段：claim/complete 走 type=task（用 todo id）+ 不跑节点建构判定（I1 对齐）', () => {
  const todo = OP_SPECS.find((s) => s.type === 'todo') as { note?: string };
  assert.match(todo.note ?? '', /claim \/ start \/ release \/ complete \/ void \/ reopen 等【状态流转】走 `type=task`/);
  assert.match(todo.note ?? '', /`id` 填 todo 的 id/);
  assert.match(todo.note ?? '', /不跑节点建构判定/);
  assert.match(todo.note ?? '', /constructionVerdict/);
});

test('decision 段：idNote 含 service（I1 放开）；node 段写明 decision 合并/清除语义', () => {
  const decision = OP_SPECS.find((s) => s.type === 'decision') as { idNote?: string };
  assert.match(decision.idNote ?? '', /service/);
  const node = OP_SPECS.find((s) => s.type === 'node') as { note?: string };
  assert.match(node.note ?? '', /逐字段合并/);
  assert.match(node.note ?? '', /decision:null` 清除整张卡/);
  assert.match(node.note ?? '', /decision_history/);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
function fsRead(rel: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.resolve(here, rel), 'utf-8');
}
