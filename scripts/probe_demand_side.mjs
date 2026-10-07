/**
 * probe_demand_side —— **需求侧**扫描：从**下游往上看**，找"被声称、却没有门"的上游（只读）。
 *
 * ★ 为什么要它（2026-10-07，用户纠正的方法）：**从上游往下看**（枚举"谁产了什么 → 谁能接"）
 *   **永远发现不了**这一类缺口 —— 一个被下游声称、却**根本没有门**的能力，**不在任何名单里**。
 *   而"从下游往上看"只要问一句：**这个工具的入参，谁给？**
 + ★ 这也是本仓立仓时的做法：`Touched` 的立论依据就是「入参侧 18 个 [B]、产物侧 12 个已用」。
 *
 * ★★ **为什么它不是"门"（2026-10-07 用户追问后的更正）**：
 *   同一个门报出的两条，**该修的方向可能相反**（`dead_deps` 该**补上游**；`render_dsl` 该**改描述**）。
 *   门只说"不一致"，**分不出往哪边修** ⇒ 它拦不住、也不该拦。
 *   ⇒ 它该是 **`/proc` 读数**（当场算出的事实），而**判据 = 名字在仓里的"存在性"**：
 *
 *   | 类 | 判据（当场可查） | 该怎么办 |
 *   |---|---|---|
 *   | ① 注册表内 | 在 61 个工具名里 | 正常 |
 *   | ② **能力在、门没有** | **有同名模块文件**，或**同名字符串字面量出现在 src** | ★ **补门**（真缺口） |
 *   | ③ 其余 | 都不存在 | **人读**（过期引用 / 产物字段名 —— 机器分不开） |
 *
 * 用法：npm run build && node scripts/probe_demand_side.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { collectInputKeys } from '../dist/src/application/meta/registry/capability_map.js';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

// ── 仓内全部 .ts 路径（一次遍历，用于"同名模块文件"判据）
const allTs = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) allTs.push(p.replace(/\\/g, '/'));
  }
})(SRC);
const moduleNames = new Set(allTs.map((p) => path.basename(p, '.ts')));

// ── 仓内源码全文（用于"同名字符串字面量"判据：抓 action / op 名）
const srcText = allTs.map((p) => fs.readFileSync(p, 'utf-8')).join('\n');

const tools = new Set(TOOL_DEFS.map((d) => d.name));
const params = new Set();
for (const d of TOOL_DEFS) for (const k of collectInputKeys(d.inputSchema)) params.add(k);

const mentions = new Map(); // 标识符 -> Set(提到它的工具)
for (const d of TOOL_DEFS) {
  for (const m of d.description.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    const t = m[0];
    if (tools.has(t) || params.has(t)) continue;
    if (!mentions.has(t)) mentions.set(t, new Set());
    mentions.get(t).add(d.name);
  }
}

const cls = { module: [], literal: [], unknown: [] };
for (const [t, by] of mentions) {
  if (moduleNames.has(t)) cls.module.push([t, by]);
  else if (srcText.includes(`'${t}'`) || srcText.includes(`"${t}"`)) cls.literal.push([t, by]);
  else cls.unknown.push([t, by]);
}

const show = (title, rows, hint) => {
  console.log(`\n${title}（${rows.length} 个）${hint}`);
  for (const [t, by] of rows.sort((a, b) => b[1].size - a[1].size))
    console.log(`  ${t.padEnd(26)} ← ${[...by].join(', ')}`);
};

console.log(`注册工具 ${tools.size} 个；描述里提到"非注册工具名"的候选 ${mentions.size} 个`);
show('★ ② 能力在、门没有（有同名模块文件）', cls.module, '⇒ **真缺口：该补门**');
show('② 能力在、门没有（有同名字面量，多半是 action/op）', cls.literal, '⇒ 多半正常（action 名），人扫一眼');
show('③ 都不存在 ⇒ 交人读（过期引用 / 产物字段名）', cls.unknown, '⇒ 机器分不开');
