/**
 * P0 · 读数脚本的分层（A / B / C）—— **分母闭合 + 鉴别力（合成消融）+ 文案不许把 B 混进 A**
 *
 * ## 它挡的事故
 * 「`npm run <script>` 能跑」被读成「有人跑」（原型：`scripts/contract-calls.mjs:97` 的注释）。
 * 于是"有 npm script"这一档**看起来有消费者**，实际是**跑了没人看、不跑没人知**（AGENTS 0.9.4 推论③）。
 *
 * ## 断言口径（每条都可判真假）
 * ① 分母**必须闭合**：A + B + C === 总数；且读数脚本的分子 ≤ 全量分母（不许"分子大过分母"）。
 * ② **鉴别力（消融，双向）**：往合成输入里塞一个"会判真假 + 无人消费 + 未声明"的脚本 ⇒ 必须点名
 *    （`TIER_C_READING`）；把它删掉 ⇒ 必须从清单里消失。★ 只断"现状是绿的"不算检测点（0.25②）。
 * ③ 文案断言：tier B 那一段必须出现「靠自觉 / 没有东西保证它跑过」，且 A 档每道门都有五列
 *    （不许出现只有门名的行 —— 假绿全在 A 里，一句"自动门"就是这条检查自己的假 assure）。
 * ④ tier B 缺理由**不许判红**（只标 ⚠）—— 判红就是 0.16 的永远会亮的灯。
 *
 * touches: scripts/lib/script_tiers.mjs, scripts/audit-script-tiers.mjs, scripts/script-tiers.registry.json, scripts/verify.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { analyze, collect, classifyReading } from '../scripts/lib/script_tiers.mjs';
import { render } from '../scripts/audit-script-tiers.mjs';

/** 合成快照：a 是自动门的目标 · b 只有 npm script · orphan-probe 什么都没有 */
function fixture(extraFiles = []) {
  const files = ['a.mjs', 'b.mjs', ...extraFiles];
  const texts = {
    'a.mjs': 'export const x = 1;\n',
    'b.mjs': 'if (bad) { console.log("✗ 不通过"); process.exit(1); }\n',
  };
  for (const f of extraFiles) texts[f] = 'if (!ok) { console.log("✓ 通过 / ✗ 违例"); process.exit(1); }\n';
  return {
    files,
    texts,
    npmScripts: { 'b.mjs': ['b'] },
    auto: { 'a.mjs': ['verify.mjs#GATES:示例门'] },
    other: {},
    gates: [{ name: '示例门', consumer: 'npm run verify', tier: 'A', cmd: 'node', args: ['scripts/a.mjs'] }],
    gateNotes: { 示例门: { verifies: '跑 scripts/a.mjs', false_green: '' } },
    readoutGates: [],
    declarations: {},
  };
}

test('① 三条判据逐条成立才算读数脚本（口径即判据）', () => {
  const cls = classifyReading('x.mjs', 'console.log("✓ 通过"); process.exit(1);');
  assert.equal(cls.verdictVocab, true);
  assert.equal(cls.conditionalExit, true);
  assert.equal(cls.isReading, true);

  // 缺"条件性非零退出"（只 return 码 1）⇒ 不算：放宽口径会把分母从十位数抬到二十几（实测 17 → 28）
  assert.equal(classifyReading('y.mjs', 'console.log("✗ 不通过"); return 1;').isReading, false);
  // 构建/安装/生成类 ⇒ 不算（它退 1 是"生成失败"，不是判真假）
  assert.equal(classifyReading('gen-x.mjs', 'process.exit(1); // ✓ 通过').isReading, false);
});

test('② 分母闭合：A + B + C = 总数，且三档各自的值都钉住', () => {
  const r = analyze(fixture());
  assert.equal(r.total, 2);
  assert.deepEqual(r.tiers, { A: 1, B: 1, C: 0 });
  assert.equal(r.tiers.A + r.tiers.B + r.tiers.C, r.total);
  assert.equal(r.readingCount, 1); // 只有 b.mjs 会判真假
  assert.deepEqual(r.readingTiers, { A: 0, B: 1, C: 0 });
});

test('③ 消融（正向）：塞一个"会判真假 + 无消费者 + 未声明"的脚本 ⇒ 必须**点名**', () => {
  const r = analyze(fixture(['orphan-probe.mjs']));
  assert.equal(r.tiers.C, 1);
  const hit = r.problems.filter((p) => p.code === 'TIER_C_READING');
  assert.equal(hit.length, 1);
  assert.match(hit[0].file, /^orphan-probe\.mjs$/, '必须点名到文件，不许只说"有一个孤儿"');
  assert.match(hit[0].msg, /三条出路/, '拒绝必须可定位（0.12 第 4 条）：要说清怎么修');
});

test('③ 消融（反向）：删掉它 ⇒ 必须从清单里消失（证明不是硬编码清单）', () => {
  const r = analyze(fixture());
  assert.equal(r.tiers.C, 0);
  assert.equal(r.problems.filter((p) => p.code === 'TIER_C_READING').length, 0);
});

test('④ tier B 缺理由**不判红**，只显形（0.16：永远会亮的灯 = 被关掉的告警）', () => {
  const r = analyze(fixture());
  assert.equal(r.tierBUnreasoned, 1, 'b.mjs 没声明理由 ⇒ 计数 +1');
  assert.equal(r.problems.length, 0, '但不许因此判红');
  // 反向：给了理由就减下去（这个数只该降）
  const withReason = fixture();
  withReason.declarations = { 'b.mjs': { status: 'manual-only', reason: '按需排障用' } };
  assert.equal(analyze(withReason).tierBUnreasoned, 0);
});

test('⑤ 门缺 consumer / tier ⇒ 判红（新增门忘了写就红，不靠自觉）', () => {
  const input = fixture();
  input.gates = [{ name: '裸门', cmd: 'node', args: ['scripts/a.mjs'] }];
  const r = analyze(input);
  const codes = r.problems.map((p) => p.code);
  assert.equal(codes.filter((c) => c === 'GATE_FIELD_MISSING').length, 2);
  // 反向：补上两个字段就消失
  input.gates = [{ name: '裸门', consumer: 'npm run verify', tier: 'A', cmd: 'node', args: ['scripts/a.mjs'] }];
  input.gateNotes = { 裸门: { verifies: '跑 scripts/a.mjs', false_green: '' } };
  assert.equal(analyze(input).problems.filter((p) => p.code === 'GATE_FIELD_MISSING').length, 0);
});

test('⑥ 门在登记表里没有「它跑到的到底是什么 / 已知假绿形态」⇒ 判红（A 档不许只有名字）', () => {
  const input = fixture();
  input.gateNotes = {};
  assert.equal(analyze(input).problems.filter((p) => p.code === 'GATE_NOTES_MISSING').length, 1);
  // `false_green: ''`（已声明为"没有"）必须与"没声明"分开：空串是合法值
  input.gateNotes = { 示例门: { verifies: '跑 scripts/a.mjs', false_green: '' } };
  assert.equal(analyze(input).problems.filter((p) => p.code === 'GATE_NOTES_MISSING').length, 0);
});

test('⑦ 登记表里声明了已不存在的文件 ⇒ 判红（声明会过期，不许悄悄留着）', () => {
  const input = fixture();
  input.declarations = { 'gone.mjs': { status: 'informational', reason: '曾经存在' } };
  assert.equal(analyze(input).problems.filter((p) => p.code === 'STALE_DECLARATION').length, 1);
});

test('⑧ 人读输出：tier B 必须被**单独成段**且带"靠自觉"，不许与 A 混成一堆', () => {
  const out = render(analyze(fixture(['orphan-probe.mjs'])));
  assert.match(out, /tier B/);
  assert.match(out, /靠自觉/);
  assert.match(out, /没有东西保证它跑过/);
  // 分母：总数、读数脚本数、三档数必须同时出现（只给"A 有几个"= 违反 0.12③）
  assert.match(out, /scripts\/\*\.mjs 总数\s+3/);
  assert.match(out, /读数脚本三档\s+A 0 · B 1 · C 1/);
  assert.match(out, /全部条目三档\s+A 1 · B 1 · C 1/);
  // 最后调用：没有账本就写"拿不到"，不许猜
  assert.match(out, /拿不到/);
});

test('⑨ A 档逐门五列：门数与"已知假绿形态"行数必须相等（不许出现只有门名的行）', () => {
  const r = analyze(fixture());
  const out = render(r);
  assert.equal((out.match(/已知假绿形态/g) ?? []).length, r.gateRows.length);
  assert.equal((out.match(/它跑到的到底是什么/g) ?? []).length, r.gateRows.length);
  for (const g of r.gateRows) assert.ok(String(g.verifies).trim().length > 0, `门「${g.name}」没写它跑到的到底是什么`);
});

test('⑪ 那个假 assure 的原型句必须已被改准（`有 npm script` ≠ `有人跑`）', () => {
  // 0.9.4 推论③ 的**文字形态**：`scripts/contract-calls.mjs:97` 曾逐字写「这个键（有人跑）」。
  // 判定逻辑本卡不动（它需要的是"入口存在"这个必要条件）⇒ 只钉这句话说得准不准。
  const text = readFileSync(new URL('../scripts/contract-calls.mjs', import.meta.url), 'utf8');
  // ★ 钉的是**原句**（`…里有这个键（有人跑）`）—— 注释里可以引用它作反面教材（本文件正在这么做），
  //   但**不许把它当成判据口径**再写回代码。子串选"只在判据要防的那件事发生时才会变"的那一段（0.2）。
  assert.equal(text.includes('这个键（有人跑）'), false, '「键在 ⇒ 有人跑」那个等式不许回来');
  assert.equal(text.includes('有人工入口'), true, '必须说清它证明的是"有入口"，不是"有人跑"');
});

test('⑩ 真仓一趟：分母闭合 + 每道门都有五列（这道断言就是"新门忘了登记表"的检测点）', async () => {
  const r = await collect(process.cwd());
  assert.equal(r.gatesError, '', 'GATES 读不到 ⇒ 是"判不了"，不许当通过');
  assert.ok(r.total > 0, '总数不许是 0（0 就是没验）');
  assert.equal(r.tiers.A + r.tiers.B + r.tiers.C, r.total, '三档必须闭合到总数');
  assert.ok(r.gateRows.length > 0, 'GATES 不许是空的');
  for (const g of r.gateRows) {
    assert.ok(String(g.verifies ?? '').trim().length > 0, `门「${g.name}」在登记表里没有 verifies`);
    assert.notEqual(g.falseGreen, null, `门「${g.name}」在登记表里没有 false_green（没有就写空串，不许缺）`);
  }
});
