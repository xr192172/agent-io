#!/usr/bin/env node
/**
 * design:check —— 【项目级】契约的执行器（★ `judgeExpectations` 的项目级版）
 *
 * ## 为什么需要它
 * 节点级判据住在 `decision.expectations`（`judgeExpectations` 跑）；
 * 而**项目级判据**（"设计全不全"）住在 `task_plan.design_completeness.criteria[].rule` ——
 * ★ 而 `rule` 是【纯文本】⇒ **没有执行器** ⇒ `criteria[].unjudged` 一直写着"没有检查器"。
 * ⇒ 本脚本就是那个执行器：**读 `criteria[].expect`（可执行断言）⇒ 跑 ⇒ 报 pass/fail/pending**。
 *
 * ## 判据从哪来（★ 别在这里写死业务规则）
 * - **有 `expect`** ⇒ 跑它（求值域：`dsl` / `nodes` / `paths` / `fs` / `path`）
 * - **没有 `expect`** ⇒ ★ **判 `pending`**（不假绿：没写断言 = 还没到能判的程度）
 * - **有 `blocked_by`** ⇒ 也判 `pending`（写明卡在哪）
 *
 * ## 加语言 / 加目录要不要改它
 * ★ **不用**。它只读 `criteria`，不认语言、不认目录 —— 那是扫描器（`import_project`）的事。
 *
 * ## 用法
 *   node scripts/design-check.mjs                 # 默认 feature: task-system-plan
 *   node scripts/design-check.mjs --feature x      # 指定 feature
 *   node scripts/design-check.mjs --json           # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const FEATURE = argOf('--feature') ?? 'task-system-plan';
const JSON_OUT = args.includes('--json');
const ROOT = process.cwd();
const FILE = path.join(ROOT, '.agent-io', 'design', `${FEATURE}.dsl.json`);

if (!fs.existsSync(FILE)) {
  console.error(`★ 找不到 ${FILE}`);
  process.exit(2);
}
const dsl = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const criteria = dsl?.task_plan?.design_completeness?.criteria ?? [];
const nodes = dsl?.geometry?.nodes ?? [];
const paths = nodes.map((n) => String(n.description ?? '').replace(/\\/g, '/'));

if (!criteria.length) {
  console.error('★ 这份 DSL 没有 task_plan.design_completeness.criteria');
  process.exit(2);
}

const results = [];
for (const c of criteria) {
  const id = c.id ?? '?';
  const name = c.name ?? '';
  if (c.blocked_by) {
    results.push({ id, name, verdict: 'pending', detail: `进行中 · 卡在：${c.blocked_by}` });
    continue;
  }
  if (typeof c.expect !== 'string' || !c.expect.trim()) {
    results.push({ id, name, verdict: 'pending', detail: '★ 没有可执行断言（`expect`）—— 还没到能判的程度' });
    continue;
  }
  try {
    // ★ 求值域：dsl / nodes / paths / fs / path / root（root = 被分析项目根，D4 要读源码查"迁移有没有执行者"）
    const fn = new Function('dsl', 'nodes', 'paths', 'fs', 'path', 'root', `"use strict"; return (${c.expect});`);
    const ok = Boolean(fn(dsl, nodes, paths, fs, path, ROOT));
    results.push({ id, name, verdict: ok ? 'pass' : 'fail', detail: ok ? '断言成立' : `断言**不成立**：${c.expect.slice(0, 90)}` });
  } catch (e) {
    results.push({ id, name, verdict: 'fail', detail: `判不了：${e.message}` });
  }
}

const count = (v) => results.filter((r) => r.verdict === v).length;

if (JSON_OUT) {
  console.log(JSON.stringify({ feature: FEATURE, checked: results.length, passed: count('pass'), failed: count('fail'), pending: count('pending'), items: results }, null, 2));
} else {
  console.log(`══ design:check · ${FEATURE} ══`);
  for (const r of results) {
    const mark = r.verdict === 'pass' ? '✓' : r.verdict === 'fail' ? '✗' : '…';
    console.log(`  ${mark} ${r.id}${r.name ? ' [' + r.name + ']' : ''} — ${r.detail}`);
  }
  console.log(`\n  通过 ${count('pass')} · ★ 不通过 ${count('fail')} · 进行中 ${count('pending')}（共 ${results.length} 条）`);
  if (count('pending')) {
    console.log('  ★ pending 不是"通过" —— 是"还没写断言 / 卡在某处"。要它变绿，先写 expect 或解掉 blocked_by。');
  }
}
process.exit(count('fail') ? 1 : 0);
