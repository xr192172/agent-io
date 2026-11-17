/**
 * touches: scripts/lib/evidence_ratchet.mjs, scripts/judge-all.mjs, scripts/evidence-baseline.json
 *
 * 市场吸收 P1 卡 · documented 档缺引源**计数棘轮**（audit P1-② 裁定：首版只警告 → 升为计数棘轮）。
 *
 * 守的是"涨必被点名、掉不拦、不进退出码、--changed 语义不动"：
 * ① 纯计数：只数 tier=documented && !cited；读不到 / 非法 tier 不误计
 * ② 点名格式：前 10 + "…另有 N 条"；空清单显式"（无）"
 * ③ 基线读：缺文件 ⇒ null；坏文件 / 缺计数字段 ⇒ 抛（读不到 ≠ 没涨）
 * ④ 方向棘轮：涨 ⇒ red、掉/平 ⇒ green、无基线 ⇒ green 且明说"不是没涨"
 * ⑤ 写基线：只显式调用才写，形状含 documented_missing_citation + format + capturedAt
 * ⑥ judge-all 报告层：与 commit 04e09cc9 的 evidence 聚合**共存**（不覆盖），新增三行齐全
 * ⑦ 消融：删掉 judge-all 里的棘轮接线 ⇒ 源码断言红（"摘比对 ⇒ 红"的可判性）
 * ⑧ --changed 语义不变：选量建账被拒 / 选量不覆盖全量读数的既有行为不动
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOD = process.env.EVIDENCE_RATCHET_MODULE
  ? pathToFileURL(process.env.EVIDENCE_RATCHET_MODULE).href
  : pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'evidence_ratchet.mjs')).href;
const R = await import(MOD);

const item = (id, tier, cited) => ({ node_id: id, evidence: cited === undefined ? { tier } : { tier, cited } });

// ── ① 纯计数：只数 documented 缺引源；读不到 / 非法 / 别的档不算 ──
test('① countDocumentedMissingCitation 只数 documented && !cited；读不到/非法不误计', () => {
  const items = [
    item('d1', 'documented'),                       // ✗ 缺引源
    item('d2', 'documented', 'docs/X.md'),          // ✓ 有引源
    item('c1', 'community_practice'),               // 二手但本棘轮不数（另有自检行）
    item('a1', 'assumption'),                       // 假设档不数
    item('t1', 'tested'),                           // 一手档不数
    { node_id: 'no-ev' },                            // 读不到 ⇒ 最弱档 assumption，不数
    item('bad1', 'not-a-tier'),                     // 非法 tier ⇒ 不数（不是 documented）
    item('d3', 'documented', ''),                    // ✗ 空串 cited 也算缺
    item('d4', 'documented', null),                  // ✗ null cited 算缺
  ];
  const out = R.countDocumentedMissingCitation(items);
  assert.equal(out.documented_missing_citation, 3);
  assert.deepEqual(out.documented_missing_ids, ['d1', 'd3', 'd4']);
  assert.deepEqual(R.countDocumentedMissingCitation(null), { documented_missing_citation: 0, documented_missing_ids: [] });
});

// ── ② 点名格式 ──
test('② rollCall 前 10 条 + "…另有 N 条"；空清单显式"（无）"', () => {
  assert.equal(R.rollCall([]), '（无）');
  assert.equal(R.rollCall(['a', 'b']), 'a, b');
  const many = Array.from({ length: 13 }, (_, i) => `n${i}`);
  assert.equal(R.rollCall(many), 'n0, n1, n2, n3, n4, n5, n6, n7, n8, n9 …另有 3 条');
  assert.equal(R.rollCall(many, 2), 'n0, n1 …另有 11 条');
});

// ── ③ 基线读：缺/坏/合法 ──
test('③ readEvidenceBaseline：缺文件 ⇒ null；坏文件/缺计数字段 ⇒ 抛；合法 ⇒ 原样回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1dr-base-'));
  const rel = R.EVIDENCE_BASELINE_REL;
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  assert.equal(R.readEvidenceBaseline(dir), null, '缺文件 = 无基线（绿 + 明说），不是 0');
  fs.writeFileSync(abs, '{ not json', 'utf8');
  assert.throws(() => R.readEvidenceBaseline(dir), /解析失败/, '坏基线不许当空基线');
  fs.writeFileSync(abs, JSON.stringify({ format: 1 }), 'utf8');
  assert.throws(() => R.readEvidenceBaseline(dir), /缺数值 documented_missing_citation/);
  fs.writeFileSync(abs, JSON.stringify({ documented_missing_citation: 7 }), 'utf8');
  assert.equal(R.readEvidenceBaseline(dir).documented_missing_citation, 7);
});

// ── ④ 方向棘轮（核心验收：涨红 / 掉绿 / 平绿 / 无基线绿但不冒充没涨）──
test('④ compareEvidenceRatchet：只拦涨；掉/平绿；无基线绿且明说"不是没涨"', () => {
  const base = (n) => ({ documented_missing_citation: n });
  const up = R.compareEvidenceRatchet(base(128), 129);
  assert.equal(up.regressed, true);
  assert.equal(up.ok, false);
  assert.equal(up.delta, 1);
  assert.match(up.note, /涨了 1 条/);
  assert.match(up.note, /只拦涨不拦掉/);

  const down = R.compareEvidenceRatchet(base(129), 128);
  assert.equal(down.regressed, false);
  assert.equal(down.ok, true);
  assert.equal(down.state, 'improved');
  assert.match(down.note, /降了 1 条/);

  const flat = R.compareEvidenceRatchet(base(128), 128);
  assert.equal(flat.ok, true);
  assert.equal(flat.state, 'flat');

  const none = R.compareEvidenceRatchet(null, 128);
  assert.equal(none.ok, true);
  assert.equal(none.state, 'no-baseline');
  assert.match(none.note, /不是"没涨"/);
});

// ── ⑤ 写基线：显式调用、形状正确 ──
test('⑤ writeEvidenceBaseline 只在显式调用时写，形状含 format/count/capturedAt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1dr-write-'));
  const body = R.writeEvidenceBaseline(dir, 128, ['n1', 'n2']);
  assert.equal(body.documented_missing_citation, 128);
  assert.equal(body.format, 1);
  assert.match(body.capturedAt, /^\d{4}-\d{2}-\d{2}$/);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, R.EVIDENCE_BASELINE_REL), 'utf8'));
  assert.deepEqual(onDisk, body, '落盘内容 = 返回内容（不偷偷多写字段）');
});

// ── ⑥ judge-all 报告层：与 04e09cc9 evidence 聚合共存 + 三行齐全 ──
test('⑥ judge-all 报告层：04e09cc9 evidence 聚合与 P1-② 棘轮共存，不互相覆盖', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/judge-all.mjs'), 'utf8');
  // 04e09cc9 那一层（既有，不许被本卡覆盖）
  assert.match(src, /function evidenceOfItems\(items\)/, '既有证据聚合函数还在');
  assert.match(src, /ev\?\.tier \?\? 'assumption'/, '读不到按最弱档（既有口径）');
  assert.match(src, /EVIDENCE_TIERS\.map/, '七档分布仍在');
  assert.match(src, /assumption 级判据（下一步验证清单/, 'assumption 点名仍在');
  assert.match(src, /badMarks/, '五道自检警告仍在');
  // P1-② 新增这一层
  assert.match(src, /countDocumentedMissingCitation\(items\)/, '计数必须来自唯一口径（不重数）');
  assert.match(src, /documented_missing_citation/, '报告必须打印计数字段');
  assert.match(src, /rollCallEvidence\(ev\.documented_missing_ids, 10\)/, '逐条点名前 10');
  assert.match(src, /compareEvidenceRatchet\(evBase, ev\.documented_missing_citation\)/, '棘轮比对必须接线');
  assert.match(src, /不进退出码/, '裁定必须写死在报告行（不偷偷进 exit）');
  assert.match(src, /writeEvidenceBaseline\(ROOT, ev\.documented_missing_citation/, '--write-baseline 显式更新');
  assert.match(src, /from '\.\/lib\/evidence_ratchet\.mjs'/, '接线 import 必须在');
  // 基线文件入仓（形态仿 mutate-existence-baseline：只许人工增/改）
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/evidence-baseline.json'), 'utf8'));
  assert.equal(typeof base.documented_missing_citation, 'number');
  assert.match(base['//'], /只许人工增\/改/);
  assert.match(base['//'], /不进退出码/);
});

// ── ⑦ 消融：删掉 judge-all 里的棘轮接线 ⇒ 本测试红（"摘比对 ⇒ 红"的可判性）──
test('⑦ 消融：把 judge-all 的 compareEvidenceRatchet 摘掉 ⇒ 源码断言必红', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/judge-all.mjs'), 'utf8');
  const ablated = src.replace(/compareEvidenceRatchet\(evBase, ev\.documented_missing_citation\)/g, '/* ABLATED */');
  // 不真改仓库：在内存里验断言对缺失敏感 —— 摘掉后必须"找不到那行"（这就是 ⑥ 会红的同一条件）
  assert.ok(!/compareEvidenceRatchet\(evBase, ev\.documented_missing_citation\)/.test(ablated));
  assert.notEqual(ablated, src, '消融必须真的改掉了源（否则这个测试恒真，没有牙）');
  assert.ok(!ablated.includes('compareEvidenceRatchet(evBase'), '摘掉比对后源码里不该再有该接线');
});

// ── ⑧ --changed 语义不变：选量不建账的既有护栏还在 ──
test('⑧ --changed 语义不变：选量模式不写 evidence 基线（既有 judge-baseline 护栏不动）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/judge-all.mjs'), 'utf8');
  assert.match(src, /不能与 --changed 同时用 --write-baseline/, '既有 judge 基线护栏逐字还在');
  assert.match(src, /writeBase && !repo\.selection/, '新棘轮写基线同样只在全量（选量不建账）');
  assert.match(src, /不覆盖.*judge-readings\.json/, '既有选量不覆盖全量读数不动');
  assert.match(src, /不覆盖.*verified-snapshot\.json/, '既有选量不覆盖快照不动');
});
