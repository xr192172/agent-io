#!/usr/bin/env node
/**
 * audit:reach —— **工具有没有人用**（三个独立口径，避免单一信号误判）
 *
 * ## 为什么需要它
 * `npm run dogfood:coverage` 只答"烟测跑过哪些"（死工具 / 过期记录）。
 * 但它答不了另一个问题：**一个工具"零真调用"到底意味着"该删"还是"还没到用它的时候"？**
 * ⇒ 本脚本再加两个口径：
 *   ① **代码级引用**：该工具名在 `src/` 里除注册点外被提到多少次（0 = 真正孤立）
 *   ② **文档/测试提及**：`docs/` + `tests/` + `scripts/` + README 里被提到多少次（有提及 = 有人在指望它）
 *   ③ **真调用 / 扫射调用**：`usage.jsonl`（★ 默认排除 `via=sweep|gate`）
 *
 * ## 三口径的判读（写死在这里，避免每次重新猜）
 * | 真调用 | 代码引用 | 文档提及 | 判读 |
 * |---|---|---|---|
 * | 0 | 0 | 0 | **孤立** ⇒ 退役候选（先跑 deprecate_offline 看它能否判） |
 * | 0 | 0 | >0 | **被宣传但没人用** ⇒ 要么补证（能力真实、还没到用的时候），要么删（前提不成立） |
 * | 0 | >0 | >0 | **有内部消费或强耦合** ⇒ 保留，补证 |
 * | >0 | — | — | 有真实使用 ⇒ 直接补证 |
 *
 * ## 用法
 *   npm run build && node scripts/audit-tool-reach.mjs            # 全部工具
 *   node scripts/audit-tool-reach.mjs translate ...               # 只看指定几个
 */
import fs from 'node:fs';
import path from 'node:path';

import { collectReach } from './lib/tool_reach.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

const only = process.argv.slice(2).filter((x) => !x.startsWith('-'));
const tools = TOOL_DEFS.map((t) => t.name).filter((n) => (only.length ? only.includes(n) : true));

// ★★★ 2026-11-07（J6 / PROJECT-DESIGN §14.1）：口径**搬到共享模块** `scripts/lib/tool_reach.mjs` ——
//   `scripts/mcp/mcp_scan.mjs` 的棘轮 ⑤ 也要用同一份（否则「一个工具有没有下游信号」就有两把尺，0.9.1）。
//   本文件只剩「人读报告」那一半；计数与判读词在那一处。
const { rows: reachRows, scannedFiles } = collectReach({ root: ROOT, toolNames: tools });

console.log('工具'.padEnd(28), '真调用'.padEnd(8), '扫射'.padEnd(6), '代码引用'.padEnd(9), '文档提及'.padEnd(9), '判读');
console.log('─'.repeat(110));
// ★ 分母（0.12③）：扫了多少文件要说出来 —— 否则"0 命中"与"没扫"读起来一样
console.log(`（扫描 ${scannedFiles.code} 个代码文件 / ${scannedFiles.doc} 个文档文件）`);
const rows = reachRows.map((r) => ({ t: r.tool, real: r.real, sweep: r.sweep, codeHits: r.codeHits, docHits: r.docHits, v: r.verdict }));
for (const r of rows) {
  console.log(r.t.padEnd(28), String(r.real).padEnd(8), String(r.sweep).padEnd(6), String(r.codeHits).padEnd(9), String(r.docHits).padEnd(9), r.v);
}

const orphans = rows.filter((r) => r.v.startsWith('★'));
console.log(`\n合计 ${rows.length} 个工具；其中**需要判断**的 ${orphans.length} 个：`);
for (const o of orphans) console.log(`  · ${o.t} —— ${o.v}`);
console.log('\n★ 本脚本**只报告不判定**：退役要走 \`deprecate_offline\`（它的判据是"自研 + 无活跃消费 + 编译级验收"）。');
process.exit(0);
