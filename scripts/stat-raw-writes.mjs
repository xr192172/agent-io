#!/usr/bin/env node
/**
 * 统计：**谁能绕过 `edit_dsl` 直接写设计 DSL**（2026-10-22 · 用户要求"挂同类任务统计"）
 *
 * ## 为什么要有它
 * 实测：`saveDSL` 有 **60 个调用点**（`src/` 内），而 `edit_dsl` 只是其中一条链。
 * 用户 2026-10-22 点破：*"似乎看起来你根本就没有用工具，而是直接自己手写的吧"*
 * ⇒ 当天 41 次 DSL 改动全走 `saveDSL` 直写，**没有 checkOpSpec / 没有 validateDSL / 没有 rev 校验**。
 *
 * ## 它区分什么（这才是关键）
 * ```\n
 * · 人/agent 改设计   ⇒ 【必须】走 edit_dsl（才有键闸+结构校验+rev 乐观锁）
 * · 系统派生（derive / opl / annotation / migrate）⇒ 允许直写，但调用点必须【说得清自己是谁】
 * ⇒ 所以本脚本不是"数有几处"，是【按来源分类】，把"说不清自己是谁"的点名
 * ```
 *
 * ## 出口
 * 0 = 全部调用点都能归到已知来源；1 = 有"来源不明"的（需要逐条判）
 *
 * ★ 它不是门（不挂 verify），是**人工排查器**：判"来源不明"要人看，不能自动化。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
};
walk(SRC);

/** 已知的系统写来源（它们不是"人改设计"，允许直写） */
const KNOWN_SOURCES = ['derive', 'opl', 'annotation', 'migrate', 'repair', 'rebuild', 'import', 'seed', 'archive', 'sync'];

const hits = [];
for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf-8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/\bsaveDSL\s*\(/);
    if (!m || /function\s+saveDSL/.test(line)) return;
    // 取同一次调用里的第二个参数（如果有）
    const rest = line.slice(m.index);
    const argMatch = rest.match(/saveDSL\s*\(\s*[^,)]+(?:,\s*([^,)]+))?/);
    const secondArg = (argMatch?.[1] ?? '').trim();
    const hasSource = secondArg && !secondArg.startsWith('{') && !/^base_?dsl/i.test(secondArg);
    const srcHint = KNOWN_SOURCES.find((k) => rel.includes(k));
    // ★★ 2026-10-22：`dsl_ops/**` = `edit_dsl` 的 op 实现本身 ⇒ 那是【正路】，不是绕过
    //   （第一版没排除它，把 19 处正路误报成"来源不明"—— 量具第一次就错，符合本仓的规律）
    const isEditDslChain = /design\/dsl_ops\/[^/]+\.ts$/.test(rel);
    hits.push({
      rel, line: i + 1, hasSource, secondArg,
      verdict: isEditDslChain ? 'edit_dsl 正路'
        : hasSource ? '显式 source'
        : srcHint ? `系统派生（${srcHint}）`
        : '★ 来源不明',
    });
  });
}

const unknownOnes = hits.filter((h) => h.verdict === '★ 来源不明');

console.log(`══ saveDSL 直写点统计 ══`);
console.log(`共 ${hits.length} 处（src/ 内）`);
const byVerdict = {};
for (const h of hits) byVerdict[h.verdict] = (byVerdict[h.verdict] || 0) + 1;
for (const [k, v] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

if (unknownOnes.length) {
  console.log(`\n★ 来源不明的 ${unknownOnes.length} 处（要逐条判：是"人改设计"还是"系统派生"）：`);
  for (const h of unknownOnes.slice(0, 20)) console.log(`  · ${h.rel}:${h.line}  saveDSL(${h.secondArg || '—'})`);
  if (unknownOnes.length > 20) console.log(`  … 另 ${unknownOnes.length - 20} 处`);
}

// 单独点名：`edit_dsl` 自己的链路应该是唯一"人改设计"的写端
const editDslChain = hits.filter((h) => /dsl_ops\/(apply_operation|node_ops|task_ops|file_ops|api_ops|status_tools|update_feature|annotation_tools)\.ts$/.test(h.rel));
console.log(`\n── edit_dsl 链路内的写点：${editDslChain.length} 处（这些是"人改设计"的正路）──`);
for (const h of editDslChain) console.log(`  · ${h.rel}:${h.line}`);

process.exit(unknownOnes.length === 0 ? 0 : 1);
