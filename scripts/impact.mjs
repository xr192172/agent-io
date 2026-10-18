#!/usr/bin/env node
/**
 * impact —— **影响面**：从【设计侧】的 `calls` 算反向可达闭包（不依赖 MCP）。
 *
 * ## 为什么要有它（VISION §8）
 * "设计侧 DB 的第三个用途：重写时看影响面 —— 你重写也不能胡乱重写。"
 * 设计侧现在有：符号（contract.ts）· 调用（calls）· ★ 影响面（本脚本）。
 *
 * ## 它算什么
 * 输入一个文件（或符号），沿 `calls` 的边做 BFS：
 *   · **反向**（谁调我）—— ★ 这是"改这里会炸哪里"的主轴
 *   · 正向（我调谁）—— 顺带给出，用于"重写时要一起改的"
 *
 * ## ★ 它和 `impact_analysis` 的差别（必须明说）
 * | | 本脚本（设计侧） | `impact_analysis`（MCP） |
 * |---|---|---|
 * | 边 | **只有 call**（`calls.json`） | **call + import + type_ref** |
 * | 证据 | 调用行（from → to） | **引用证据行 + 风险排序** |
 * | 依赖 | ★ **设计侧自足**（不调 MCP） | 要调 MCP |
 * ⇒ ★ **所以本脚本会少报**（缺 import / type_ref 两类边）—— 这是口径差异，不是 bug。
 *
 * 用法：
 *   node scripts/impact.mjs --file src/application/write_gate.ts
 *   node scripts/impact.mjs --file src/application/write_gate.ts --depth 2
 *   node scripts/impact.mjs --file src/application/write_gate.ts --json
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join('certs', 'design-contracts');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const asJson = argv.includes('--json');

const target = (arg('file') ?? '').replace(/\\/g, '/');
if (!target) {
  console.error('★ 需要 --file <相对路径>');
  process.exit(2);
}
const maxDepth = Number(arg('depth') ?? '1');

// ── 读设计侧的全部调用（from/to 形如 `path#symbol`）──
// ★★★ 只算【事实】：`calls` 里同时装着"事实"（fork 复制的，无 why）和"意图"（dep 加的，有 why）。
//   影响面必须只算【事实】—— 否则"还没实现的意图"会被当成"已有的影响"，把清单虚高。
const edges = [];
let intentSkipped = 0;
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.calls.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const c of j.calls ?? []) {
    if (c.why) { intentSkipped++; continue; } // ★ 有 why = 意图，不是事实
    edges.push({ from: String(c.from).replace(/\\/g, '/'), to: String(c.to).replace(/\\/g, '/') });
  }
}

const fileOf = (id) => id.split('#')[0];
const symOf = (id) => id.split('#')[1] ?? '';

// 邻接：反向（to → from）
const rev = new Map();
const fwd = new Map();
for (const e of edges) {
  if (!rev.has(e.to)) rev.set(e.to, []);
  rev.get(e.to).push(e);
  if (!fwd.has(e.from)) fwd.set(e.from, []);
  fwd.get(e.from).push(e);
}

/** 某文件的所有符号 */
const symsOfFile = new Set(edges.map((e) => e.to).filter((t) => fileOf(t) === target));

/** BFS：从 target 的所有符号出发，沿反向边找"谁调了它" */
function closure(depth) {
  const seenFiles = new Map(); // file → {depth, via}
  const frontier = [...symsOfFile].map((s) => ({ node: s, d: 0 }));
  const visited = new Set(frontier.map((x) => x.node));
  while (frontier.length) {
    const { node, d } = frontier.shift();
    if (d >= depth) continue;
    for (const e of rev.get(node) ?? []) {
      const callerFile = fileOf(e.from);
      if (callerFile === target) continue; // 文件内部调用不算"受影响的外部文件"
      if (!seenFiles.has(callerFile)) seenFiles.set(callerFile, { depth: d + 1, via: [] });
      seenFiles.get(callerFile).via.push(`${symOf(e.from)} → ${symOf(e.to)}`);
      if (!visited.has(e.from)) {
        visited.add(e.from);
        frontier.push({ node: e.from, d: d + 1 });
      }
    }
  }
  return seenFiles;
}

const affected = closure(maxDepth);
const out = [...affected.entries()]
  .map(([file, v]) => ({ file, depth: v.depth, via: [...new Set(v.via)].slice(0, 6), n: v.via.length }))
  .sort((a, b) => a.depth - b.depth || b.n - a.n);

if (asJson) {
  console.log(JSON.stringify({ target, maxDepth, affected: out, total: out.length }, null, 2));
} else {
  console.log('════ 影响面（设计侧 calls 的反向闭包）════');
  console.log(`变更点：${target} · 深度 ${maxDepth} · ★ 只有 call 边（缺 import / type_ref）\n`);
  if (!out.length) {
    console.log('  （没有其他文件调用它 ⇒ 影响面为空。★ 这不等于"改了没事"——见下面口径说明）');
  }
  for (const a of out) {
    console.log(`  ${a.depth === 1 ? '⚠' : '·'} ${a.file.replace(/^src\//, '')}  (depth=${a.depth}, ${a.n} 处调用)`);
    for (const v of a.via) console.log(`      ${v}`);
  }
  console.log(`\n合计 ${out.length} 个文件受影响`);
  console.log('★ 口径：只数 call 边 ⇒ 会比 impact_analysis（call+import+type_ref）少。');
  console.log('★ 要完整影响面（含 import / type_ref / 风险排序）⇒ 用 impact_analysis（MCP）。');
}
