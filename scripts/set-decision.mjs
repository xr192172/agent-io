#!/usr/bin/env node
/**
 * dec —— 设计侧 `decision` 的 **CRUD**（临时工具，不经过 `edit_dsl` 的 OP）。
 *
 * ## 为什么需要它
 * `edit_dsl` 的 OP（`add/update/delete/move`）是按**旧 DSL 形状**设计的，它的领域字段里**没有 `decision`**
 * （实测：`node.update` 传 `summary` ⇒ "不被认的键"）。而现在的设计 DSL 是 641 节点 + `decision` + `task`。
 * ⇒ 先给一只"能增删改查 decision 的手"，把链路打通；标准化（重做 OP）等链路通了再干。
 *
 * ## 四件事（增删改查，一样不少）
 * | 操作 | 参数 |
 * |---|---|
 * | **查** | `--list` |
 * | **改** | `--summary "…"` · `--acceptance "…"` |
 * | **增** | `--add-expectation '{kind,path,symbol,why}'` |
 * | **删** | `--remove-expectation <索引 或 symbol>` |
 *
 * ## 它守的规矩
 * ★ 写前**备份**到 `/tmp/dec-backup-<ts>.json`；
 * ★ **只碰 `decision`**（不碰 `task` / `task_plan` / geometry 的其它字段）；
 * ★ **没变化就拒绝**（不许"以为改了"）；
 * ★ 删除按 **索引** 或 **symbol** 精确匹配 —— 匹配到 0 条或多条都拒绝（不许"删错"）。
 */
import fs from 'node:fs';

const DESIGN = '.agent-io/design/task-system-plan.dsl.json';
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);

const nodeId = arg('node');
if (!nodeId) {
  console.error('★ 需要 --node <id>');
  process.exit(2);
}

const dsl = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
if (!node) {
  console.error(`★ 节点不存在：${nodeId}`);
  process.exit(2);
}
if (!node.decision) node.decision = { summary: '', acceptance: '', expectations: [] };
const exps = Array.isArray(node.decision.expectations) ? node.decision.expectations : [];

// ── 查 ────────────────────────────────────────────────
if (has('list')) {
  console.log(`════ ${nodeId} ════`);
  console.log('summary:', String(node.decision.summary || '（空）'));
  if (node.decision.acceptance) console.log('acceptance:', String(node.decision.acceptance));
  console.log(`expectations（${exps.length} 条）：`);
  exps.forEach((e, i) => {
    console.log(`  [${i}] ${e.kind}  ${e.path ?? ''}${e.symbol ? '#' + e.symbol : ''}`);
    if (e.why) console.log(`      为什么：${String(e.why).slice(0, 90)}`);
  });
  if (node.task) console.log(`task: state=${node.task.state} · expectations=${(node.task.expectations ?? []).length} 条`);
  process.exit(0);
}

const changed = [];
const before = JSON.stringify(node.decision);

// ── 改 ────────────────────────────────────────────────
if (arg('summary') !== undefined) { node.decision.summary = arg('summary'); changed.push('summary'); }
if (arg('acceptance') !== undefined) { node.decision.acceptance = arg('acceptance'); changed.push('acceptance'); }

// ★★★ 2026-10-18（§10 决策卡=登记表）：补三个栏目
//   ① creator —— **自动获取**（读 AGENT_IO_ACTOR），**不许手填**（手填=自报家门）
//   ② source  —— 依据：{kind:'doc'|'user', ref:'…'}
//   ③ handoff —— 交办：{to:'design'|'impl'|'verify', brief:'…'} ⇒ ★ 没有它，单子就停在填单人手里
if (has('init')) {
  node.decision.creator = process.env.AGENT_IO_ACTOR ?? 'unknown（AGENT_IO_ACTOR 未设）';
  changed.push('creator（自动获取）');
}
if (arg('source') !== undefined) {
  try {
    node.decision.source = JSON.parse(arg('source'));
  } catch (err) {
    console.error('★ --source 不是合法 JSON（要 {kind,ref}）：' + String(err.message));
    process.exit(2);
  }
  changed.push('source');
}
if (arg('handoff') !== undefined) {
  try {
    node.decision.handoff = JSON.parse(arg('handoff'));
  } catch (err) {
    console.error("★ --handoff 不是合法 JSON（要 {to,brief}）：" + String(err.message));
    process.exit(2);
  }
  changed.push('handoff');
}

// ── 增 ────────────────────────────────────────────────
if (arg('add-expectation') !== undefined) {
  let e;
  try {
    e = JSON.parse(arg('add-expectation'));
  } catch (err) {
    console.error('★ --add-expectation 不是合法 JSON：' + String(err.message));
    process.exit(2);
  }
  node.decision.expectations = [...exps, e];
  changed.push(`expectations +1（共 ${node.decision.expectations.length}）`);
}

// ── 删 ────────────────────────────────────────────────
const rm = arg('remove-expectation');
if (rm !== undefined) {
  const asIdx = Number(rm);
  let idx = -1;
  if (Number.isInteger(asIdx) && asIdx >= 0) {
    idx = asIdx < exps.length ? asIdx : -1;
    if (idx < 0) { console.error(`★ 索引越界：${asIdx}（共 ${exps.length} 条）`); process.exit(2); }
  } else {
    // 按 symbol（或 path#symbol）精确匹配；匹配 0 或多条都拒绝
    const hits = exps.map((e, i) => ({ e, i })).filter(({ e }) =>
      e.symbol === rm || `${e.path}#${e.symbol}` === rm || e.kind === rm,
    );
    if (hits.length === 0) { console.error(`★ 没有匹配 "${rm}" 的期望`); process.exit(2); }
    if (hits.length > 1) {
      console.error(`★ "${rm}" 匹配到 ${hits.length} 条，拒绝（用索引精确删）：`);
      hits.forEach(({ e, i }) => console.error(`  [${i}] ${e.kind} ${e.path ?? ''}${e.symbol ? '#' + e.symbol : ''}`));
      process.exit(2);
    }
    idx = hits[0].i;
  }
  const gone = exps[idx];
  node.decision.expectations = exps.filter((_, i) => i !== idx);
  changed.push(`expectations −1（删掉 [${idx}] ${gone.kind} ${gone.symbol ?? gone.path ?? ''}）`);
}

if (!changed.length) {
  console.error('★ 什么都没改（要 --list / --summary / --add-expectation / --remove-expectation）');
  process.exit(2);
}

const after = JSON.stringify(node.decision);
if (after === before) {
  console.error('★ decision 没变化 ⇒ 拒绝写（避免"以为改了"）');
  process.exit(2);
}

const bak = `/tmp/dec-backup-${Date.now()}.json`;
fs.copyFileSync(DESIGN, bak);
fs.writeFileSync(DESIGN, JSON.stringify(dsl, null, 2) + '\n');

console.log('════ dec ════');
console.log(`  节点：${nodeId}`);
console.log(`  改了：${changed.join(' · ')}`);
console.log(`  备份：${bak}`);
console.log(`  ★ 下一步：npm run fork（重出契约）· npm run contract（tsc 验）`);
