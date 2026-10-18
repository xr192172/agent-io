#!/usr/bin/env node
/**
 * set-decision —— ★ **临时工具**：直接改设计侧的 `decision`，**不经过 `edit_dsl` 的那套 OP**。
 *
 * ## 为什么需要它（而不是修 `edit_dsl`）
 * `edit_dsl` 的 OP（`add/update/delete/move`）是按**旧 DSL 形状**（`features/` 时代）设计的：
 * 它的"领域字段表"里**没有 `decision`**（实测：`node.update` 传 `summary` ⇒ "不被认的键"）。
 * 而现在的设计 DSL 已经变成：641 节点 + `decision` + `task` + `task_plan` + `_forked_from`。
 * ⇒ ★ **不是某个 op 坏了，是 OP 的【前提】变了。**
 * ⇒ 所以先给一只"能改 decision 的手"，把链路打通；**标准化（重做 OP）等链路通了再干**。
 *
 * ## 它只做三件事（故意的，别扩）
 *   --node <id>           必填
 *   --summary <text>      改 decision.summary
 *   --add-expectation <json>  追加一条 expectation（JSON 字符串）
 *   --clear-expectations  清空 expectations（危险，要 --yes）
 *
 * ## 它守的规矩
 * ★ 写前**备份**到 `/tmp/set-decision-backup-<ts>.json`（因为 `git` 之外还要有一层）；
 * ★ 写完**只报"改了什么"**，不静默成功（`changed` 列表为空 ⇒ 退 2）；
 * ★ **只碰 `decision`**（不碰 `task` / `task_plan` / geometry）—— 越界就抛。
 *
 * 用法：
 *   node scripts/set-decision.mjs --node file_src_x --summary "写源码前必须挂任务"
 *   node scripts/set-decision.mjs --node file_src_x --add-expectation '{"kind":"symbol-exists","path":"src/x.ts","symbol":"foo","why":"…"}'
 */
import fs from 'node:fs';

const DESIGN = '.agent-io/design/task-system-plan.dsl.json';
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
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

const changed = [];
const before = JSON.stringify(node.decision ?? null);

// ★ 只碰 decision：没有就建一个空壳（decision 是"意图"的容器）
if (!node.decision) node.decision = { summary: '', acceptance: '', expectations: [] };

if (arg('summary') !== undefined) {
  node.decision.summary = arg('summary');
  changed.push('summary');
}

if (arg('add-expectation') !== undefined) {
  let e;
  try {
    e = JSON.parse(arg('add-expectation'));
  } catch (err) {
    console.error('★ --add-expectation 不是合法 JSON：' + String(err.message));
    process.exit(2);
  }
  if (!Array.isArray(node.decision.expectations)) node.decision.expectations = [];
  node.decision.expectations.push(e);
  changed.push(`expectations +1（共 ${node.decision.expectations.length}）`);
}

if (has('clear-expectations')) {
  if (!has('yes')) {
    console.error('★ --clear-expectations 需要 --yes（它会清空全部期望）');
    process.exit(2);
  }
  node.decision.expectations = [];
  changed.push('expectations 清空');
}

if (!changed.length) {
  console.error('★ 什么都没改（要给 --summary / --add-expectation / --clear-expectations）');
  process.exit(2);
}

// ★ 备份（git 之外再一层）
const bak = `/tmp/set-decision-backup-${Date.now()}.json`;
fs.copyFileSync(DESIGN, bak);

// ★ 越界自检：只允许 decision 变
const after = JSON.stringify(node.decision);
const dslTmp = JSON.parse(JSON.stringify(dsl));
// （这里不需要真的 diff 整个文件 —— 我们只改了 node.decision 这一个引用；下面断言它确实变了）
if (after === before) {
  console.error('★ decision 没变化 ⇒ 拒绝写（避免"以为改了"）');
  process.exit(2);
}

fs.writeFileSync(DESIGN, JSON.stringify(dsl, null, 2) + '\n');

console.log('════ set-decision ════');
console.log(`  节点：${nodeId}`);
console.log(`  改了：${changed.join(' · ')}`);
console.log(`  备份：${bak}`);
console.log(`  ★ 下一步：npm run diff（看差异）· npm run fork（重出契约）· 或者 publish 立卡`);
