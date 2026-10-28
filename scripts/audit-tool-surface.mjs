#!/usr/bin/env node
/**
 * ★★★ 2026-10-28：**工具面收敛盘点** —— 三维交叉，把"哪些是遗留、哪些能删"变成读数。
 *
 * ## 为什么要有它（用户 2026-10-28）
 * 「有很多工具和功能是早期遗留，有些被设计侧已经取代了，有些可以合并，有些可以删除」
 * —— 这句话是对的，但**不能凭感觉删**。删错一个在用的工具 = 打断别人的手。
 *
 * ## 三维（每个维度都有**权威来源**，本脚本不自己拼）
 * | 维度 | 来源 | 它回答 |
 * |---|---|---|
 * | **注册** | `application/tool_registry.ts#TOOL_DEFS`（唯一汇总点） | 还在不在台面上 |
 * | **用过** | `.agentio-data/dogfood/usage.jsonl`（`tool_usage` 同一口径） | 有人真调过吗 |
 * | **有证** | `certs/*.mjs` 文本出现（**提到 ≠ 验过**，见下） | 有判据吗 |
 * | **有指定用法** | `docs/AGENTS.md` 的「动作 → 工具」表 | 有没有人被要求用它 |
 *
 * ## 口径（诚实，照抄 `tool_usage` 的边界）
 * · "有证" = 名字在证里出现过 ⇒ **提到 ≠ 验过**；但**没提到的必定没验**；
 * · "用过" 只覆盖**本仓 dogfood 记过的那条通道** ⇒ 「没用过」是**弱证据**（可能是别人在别的机器上用过）；
 * · ⇒ 本脚本**只给候选分级**，不判"删"。最终判断必须结合"它有没有被取代"（语义，机器判不了）。
 *
 * ## 分级（只是提示，不是结论）
 * · `dead-3`  三维皆无（没证 / 没用过 / 不在动作表）⇒ **最可疑的遗留**
 * · `no-cert` 在用但没证 ⇒ 优先补证（`T-#CERT-1`）
 * · `ok`      至少有一维支撑
 *
 * ## 用法
 *   node scripts/audit-tool-surface.mjs          # 人读表
 *   node scripts/audit-tool-surface.mjs --json   # 机器读
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = 'file://' + path.join(ROOT, 'dist/src/').replace(/\\/g, '/');

// ── ① 注册表（唯一汇总点，不自己拼）──────────────────────
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const tools = TOOL_DEFS.map((t) => ({ name: t.name, title: String(t.title ?? '') }));

// ── ② 用过（与 tool_usage 同一口径：读 usage.jsonl）──────
const usageFile = path.join(ROOT, '.agentio-data/dogfood/usage.jsonl');
/**
 * ★★ 2026-10-28（实测教训）：**"有没有用过"这个布尔值在本仓没有分辨力** ——
 * 1590 行日志里 **63 个注册工具全部出现过**（含我自己测的那些）。
 * ⇒ 判据改成**次数 + 最近一次**：只用过一两次、且很久没动的，才是遗留候选。
 */
const useCount = new Map();
const lastUsed = new Map();
if (fs.existsSync(usageFile)) {
  for (const line of fs.readFileSync(usageFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (typeof j.tool !== 'string') continue;
      useCount.set(j.tool, (useCount.get(j.tool) ?? 0) + 1);
      const ts = String(j.ts ?? '');
      if (ts && (!lastUsed.has(j.tool) || ts > lastUsed.get(j.tool))) lastUsed.set(j.tool, ts);
    } catch {
      /* 坏行跳过（与 tool_usage 同口径） */
    }
  }
}

// ── ③ 有证（证文本出现）／④ 有指定用法（AGENTS 动作表）──
const certText = fs
  .readdirSync(path.join(ROOT, 'certs'))
  .filter((n) => n.endsWith('.mjs'))
  .map((n) => fs.readFileSync(path.join(ROOT, 'certs', n), 'utf8'))
  .join('\n');
const agentsFile = fs.existsSync(path.join(ROOT, 'AGENTS.md')) ? path.join(ROOT, 'AGENTS.md') : path.join(ROOT, 'docs/AGENTS.md');
const agents = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';

const rows = tools.map((t) => {
  const re = new RegExp(`(^|[^a-z0-9_])${t.name}([^a-z0-9_]|$)`, 'm');
  const cert = re.test(certText);
  const inAgents = re.test(agents);
  const n = useCount.get(t.name) ?? 0;
  const last = lastUsed.get(t.name) ?? '';
  // ★★ 2026-10-28 二次教训：**usage 计数不可用作判据** —— 日志里每个工具都恰好 17 次、同一天，
  //   那是**批量烟测**的痕迹，不是真实依赖。⇒ 只用两个**可靠正向**信号：① 在 AGENTS 动作表 ② 有证。
  //   两者都没有 ⇒ `legacy`（**遗留候选**：没人被要求用它、也没判据）。
  const grade = cert || inAgents ? 'ok' : 'legacy';
  return { name: t.name, title: t.title, cert, inAgents, useCount: n, lastUsed: last, grade };
});

const tally = { legacy: 0, ok: 0 };
for (const r of rows) tally[r.grade] += 1;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: rows.length, tally, rows }, null, 2));
  process.exit(0);
}

console.log(`工具 ${rows.length} 个 · 分级：ok（有证或在动作表）${tally.ok} · **legacy（两者皆无）${tally.legacy}**`);
console.log('★ 口径：提到≠验过 ⇒ ok 只是"有账"的下界；**usage 计数不可用**（日志含批量烟测：每工具恰好 17 次同日）。\n★ 本表只给**遗留候选**，不判删 —— 删前必须回答"它有没有被取代"（语义，机器判不了）。\n');

for (const grade of ['legacy']) {
  const list = rows.filter((r) => r.grade === grade);
  if (!list.length) continue;
  console.log(`── ${grade}（${list.length} 个）──`);
  for (const r of list) {
    console.log(`  · ${r.name.padEnd(28)} 证${r.cert ? '✓' : '✗'} 表${r.inAgents ? '✓' : '✗'} 用${String(r.useCount).padStart(3)}次 末${(r.lastUsed || '-').slice(0, 10)}  ${r.title.slice(0, 40)}`);
  }
  console.log('');
}
