/**
 * probe_demand_side —— **需求侧**扫描：从**下游往上看**，找"被声称、却没有门"的上游（只读）。
 *
 * ★ 为什么要它（2026-10-07，用户纠正的方法）：**从上游往下看**（枚举"谁产了什么 → 谁能接"）
 *   **永远发现不了**这一类缺口 —— 一个被下游声称、却**根本没有门**的能力，**不在任何名单里**，
 *   你枚举产物时不会想起它。而"从下游往上看"只要问一句：**这个工具的入参，谁给？**
 *   ★ 这也是本仓立仓时的做法：`Touched` 的立论依据就是「入参侧 18 个 [B]、产物侧 12 个已用」。
 *
 * ★★ **判据 = 标识符 vs 注册表**（**不是判散文语义** —— 那是本仓刚修过的坑）：
 *   抽出描述里所有 snake_case 标识符 → 排掉【已注册工具名】+【所有已知入参名（含深层）】
 *   → **剩下的交人读**（机器只提名，不下结论）。
 *   ★ 实测提名里有**大量产物字段名**（`expected_apis`/`fell_back`…）—— 说明"描述里混着字段名与工具名"，
 *     所以**这一层必须人读**；想让它可以机检，得先让"提到的工具名"有**显式写法**。
 *
 * 用法：npm run build && node scripts/probe_demand_side.mjs
 */
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { collectInputKeys } from '../dist/src/application/meta/registry/capability_map.js';

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

const rows = [...mentions.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
console.log(`注册工具 ${tools.length} 个；描述里提到"非注册工具名"的候选标识符 ${rows.length} 个`);
console.log('★ 下面**交人读**：像【工具名/模块名】的多半是缺口；像【产物字段/action/op】的不是。\n');
for (const [t, by] of rows) console.log(`  ${t.padEnd(26)} ← ${[...by].join(', ')}`);
