#!/usr/bin/env node
/**
 * design-diff —— **设计侧 × 实际侧的 diff**（像 `git diff`，只报不一致）。
 *
 * ## 语义（用户 2026-10-18 明确）
 * > "所谓的对拍其实就像 Git 的 diff 啊，你把两份文件进行一个 diff，看看 diff 出来的问题在哪里。"
 *
 * ★★★ 所以：
 * - **设计侧 = fork(实际侧)** ⇒ 两边**本来就该完全一样**；
 * - **"没动过"不是 diff** —— 它两边一样，`git diff` 不会显示它；
 * - **diff 只显示三类**：
 *     `+` 只在设计侧（★ 设计了但还没有 ⇒ 要建）
 *     `-` 只在实际侧（★ 实际有但设计没收录 ⇒ 要补设计）
 *     `~` 两边都有但【内容不同】（★ 我改过的地方 = 决策卡 + label + 边）
 *
 * ## 为什么这比"缺陷检测"健康
 * 它不是判"你错没错"，是告诉你**"这份图纸和现状差在哪"** —— 差在哪儿，下一步就改哪儿。
 *
 * 用法：
 *   node scripts/design-diff.mjs              # 摘要
 *   node scripts/design-diff.mjs --detail     # 逐条列
 */
import fs from 'node:fs';

const DESIGN = '.agent-io/design/task-system-plan.dsl.json'; // ★ 唯一位置（2026-10-18 统一）
const LIVE = '.agent-io/live/task-system-plan.dsl.json';

const argv = process.argv.slice(2);
const detail = argv.includes('--detail');

const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));

const dNodes = new Map((design.geometry?.nodes || []).map((n) => [n.id, n]));
const lNodes = new Map((live.geometry?.nodes || []).map((n) => [n.id, n]));

const onlyDesign = [...dNodes.keys()].filter((id) => !lNodes.has(id));
const onlyLive = [...lNodes.keys()].filter((id) => !dNodes.has(id));

/** 内容比较：只比"有意义的字段"（跳过坐标/尺寸/颜色这些渲染噪声） */
const MEANINGFUL = ['decision', 'task', 'label', 'type', 'arch_layer', 'description'];
const changed = [];
for (const [id, d] of dNodes) {
  const l = lNodes.get(id);
  if (!l) continue;
  const diffFields = MEANINGFUL.filter((k) => JSON.stringify(d[k] ?? null) !== JSON.stringify(l[k] ?? null));
  if (diffFields.length) changed.push({ id, fields: diffFields, design: d, live: l });
}

// 边：按 (from,to) 比
const key = (e) => `${e.from}|${e.to}`;
const dEdges = new Map((design.geometry?.edges || []).map((e) => [key(e), e]));
const lEdges = new Map((live.geometry?.edges || []).map((e) => [key(e), e]));
const eOnlyDesign = [...dEdges.keys()].filter((k) => !lEdges.has(k));
const eOnlyLive = [...lEdges.keys()].filter((k) => !dEdges.has(k));

const short = (s) => String(s).replace(/^file_src_/, '').replace(/\.ts$/, '');

console.log('════ 设计侧 × 实际侧 diff ════');
console.log(`设计 ${dNodes.size} 节点 · ${dEdges.size} 边    实际 ${lNodes.size} 节点 · ${lEdges.size} 边\n`);

console.log(`+ 只在设计侧（设计了、实际还没有 ⇒ ★ 要建）：${onlyDesign.length} 个`);
for (const id of detail ? onlyDesign : onlyDesign.slice(0, 10)) console.log(`    + ${short(id)}`);

console.log(`\n- 只在实际侧（实际有、设计没收录 ⇒ ★ 要补设计）：${onlyLive.length} 个`);
for (const id of detail ? onlyLive : onlyLive.slice(0, 10)) console.log(`    - ${short(id)}`);

console.log(`\n~ 两边都有但内容不同（★ 我改过的地方 = 决策卡/标签）：${changed.length} 个`);
for (const c of detail ? changed : changed.slice(0, 12)) {
  console.log(`    ~ ${short(c.id)}   [${c.fields.join(', ')}]`);
  if (detail && c.fields.includes('decision')) {
    const ex = c.design.decision?.expectations?.length ?? 0;
    console.log(`        decision: summary ${c.design.decision?.summary ? '有' : '空'} · expectations ${ex} 条`);
  }
}

console.log(`\n边：+ ${eOnlyDesign.length} 条只在设计侧 · - ${eOnlyLive.length} 条只在实际侧`);
if (detail) {
  for (const k of eOnlyDesign) console.log(`    + ${k.split('|').map(short).join(' → ')}`);
  for (const k of eOnlyLive) console.log(`    - ${k.split('|').map(short).join(' → ')}`);
}

const total = dNodes.size;
const designed = [...dNodes.values()].filter((n) => n.decision).length;
console.log(`\n────────────────────────────────────`);
console.log(`进度：已设计 ${designed}/${total}（${((designed / total) * 100).toFixed(1)}%）`);
console.log(`★ 上面前三类就是"要动的地方"：+ 要建 · - 要补设计 · ~ 是我已经改过的`);
