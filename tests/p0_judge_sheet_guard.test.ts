/**
 * P0 · **册身份守卫（sheetMismatch）直调单元向量** —— 纵深红路径把守。
 *
 * touches: scripts/lib/sheet_guard.mjs, scripts/judge-all.mjs, scripts/lib/path_identity.mjs
 *
 * ## 背景（复核 §4.2.5 / §9）
 * `judge-all.mjs` 的册身份守卫（回执 `rec.sheet` vs 本次检查 `wantSheet`）在显式
 * `project_dir` 前插锚（fe40d843）落地后，注册表 decoy 端到端红路径在现役布局下不可达，
 * 内联守卫的「sheet ≠ wantSheet ⇒ 红」路径不再被任何用例触达。本证直调抽出的守卫纯函数，
 * 把纵深红路径重新纳入测试面：缺 sheet 字段 / 路径不等 ⇒ 必红；同路径（含归一差异）⇒ 放行。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 回执缺 `sheet` 字段 ⇒ 不通过，文案点名「回执里没有 sheet 字段」（读不到 ≠ 通过，不放行）。
 * ② 回执为 null ⇒ 不通过。
 * ③ `sheet` 与 `wantSheet` 指向不同处 ⇒ 不通过，文案带两侧路径「不是同一份」。
 * ④ 同一路径（反斜杠/正斜杠/大小写变体，归一后同一处）⇒ 放行。
 * ⑤ 守卫比较口径仍是唯一实现 `path_identity.samePath`，不另造字符串比较。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { guardSheetMismatch } from '../scripts/lib/sheet_guard.mjs';

/** 造一个真实存在的册路径（realpath 可解析；不存在时守卫退 resolve 字面比，绿态用真实目录更稳）。 */
function sheetPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-sheet-guard-'));
  const want = path.join(root, '.agent-io', 'design', 'fake-book.dsl.json');
  fs.mkdirSync(path.dirname(want), { recursive: true });
  fs.writeFileSync(want, '{}', 'utf8');
  return want;
}

test('① 回执缺 sheet 字段 ⇒ 不通过，点名「回执里没有 sheet 字段」', () => {
  const want = sheetPath();
  const r = guardSheetMismatch({ feature: 'fake-book', rec: {}, wantSheet: want });
  assert.equal(r.ok, false);
  assert.match(r.sheetMismatch, /回执里没有 sheet 字段/);
  assert.match(r.sheetMismatch, /不是同一份/);
});

test('② 回执为 null ⇒ 不通过（执行核残件不许折绿）', () => {
  const want = sheetPath();
  const r = guardSheetMismatch({ feature: 'fake-book', rec: null, wantSheet: want });
  assert.equal(r.ok, false);
  assert.match(r.sheetMismatch, /回执里没有 sheet 字段/);
});

test('③ sheet 指向另一处 ⇒ 不通过，文案带两侧路径', () => {
  const want = sheetPath();
  const decoy = path.join(path.dirname(want), '..', '..', 'decoy', 'other.dsl.json');
  const r = guardSheetMismatch({ feature: 'fake-book', rec: { sheet: decoy }, wantSheet: want });
  assert.equal(r.ok, false);
  assert.match(r.sheetMismatch, /other\.dsl\.json/);
  assert.match(r.sheetMismatch, /不是同一份/);
});

test('④ 同一路径（斜杠/大小写变体归一）⇒ 放行', () => {
  const want = sheetPath();
  // 正斜杠 + 全小写（Windows 不区分大小写）：归一后与 want 同一处。
  const slashed = want.replace(/\\/g, '/').toLowerCase();
  const r = guardSheetMismatch({ feature: 'fake-book', rec: { sheet: slashed }, wantSheet: want });
  assert.equal(r.ok, true);
  assert.equal(r.sheetMismatch, undefined);
});

test('⑤ 守卫对同一物理册放行（原值逐字相等对照）', () => {
  const want = sheetPath();
  const r = guardSheetMismatch({ feature: 'fake-book', rec: { sheet: want }, wantSheet: want });
  assert.equal(r.ok, true);
});
