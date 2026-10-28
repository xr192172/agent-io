#!/usr/bin/env node
/**
 * ★★★ 2026-10-28：**功能重合度 & 可吸收性**盘点 —— 把"这两个工具是不是一回事"从感觉变成读数。
 *
 * ## 用户之问
 * 「能不能从功能上判定是否重合和能否吸收」 —— **能**，但要分成两个问题，用的判据完全不同：
 *
 * | 问题 | 判据 | 机械可得吗 |
 * |---|---|---|
 * | **重合吗**（是不是一类事） | ① 入参集合的 **Jaccard 相似度**（同一类事往往要同一批参数）<br>② 共享**同一份输入事实**（都吃 `project_dir` / `events_*` / `feature`） | ✅ 完全机械 |
 * | **能吸收吗**（并了会不会坏） | ③ **副作用形态相同**（只读 / 写盘 / spawn）<br>④ **前置条件相同**（都依赖设计册/卡，或都不依赖）<br>⑤ **没有自己的 `action` 命名空间**（否则合并要造 action 套 action） | ✅ 机械（扫实现模块的写 API + 看 schema） |
 *
 * ⇒ **重合度高 ≠ 能吸收**。实证：`observe_instrument` / `observe_proposals` 与 `observe_log` 参数高度重合，
 * 但它们**各有自己的 `action` 且会写盘** ⇒ 只能并成 3 个，不是 1 个（`certs/t407` 就是这个结论）。
 *
 * ## 口径（诚实边界）
 * · 参数 Jaccard 只是**代理指标**：两个工具可以参数相同却做不同的事（反例也要人看一眼）；
 * · 副作用形态靠**扫实现模块的写 API**（`writeFileSync` / `save*` / `rm` / `execSync`…）判定 —— 启发式，可能漏；
 * · **[未核]** 不做深度调用图：`handler` 是函数值，本脚本不追它的传递闭包（那要符号级调用图，另做）。
 *
 * ## 用法
 *   node scripts/audit-tool-overlap.mjs             # 人读：候选合并组
 *   node scripts/audit-tool-overlap.mjs --json      # 机器读
 *
 * 不设阈值、不拦提交（本仓"不加新门"）：它只**报候选**，拍板仍是人的事。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = 'file://' + path.join(ROOT, 'dist/src/').replace(/\\/g, '/');
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

/** 工具定义所在文件（用于扫副作用形态） */
function defSiteOf(name) {
  const lanes = ['observe', 'cross', 'design', 'meta', 'refactor'];
  for (const lane of lanes) {
    const p = path.join(ROOT, 'src/application', lane, 'index.ts');
    if (!fs.existsSync(p)) continue;
    const s = fs.readFileSync(p, 'utf8');
    if (s.includes(`name: '${name}'`)) return p;
  }
  return null;
}

const WRITE_APIS = [
  'writeFileSync', 'writeFile(', 'saveDSL', 'saveProjects', 'rmSync', 'unlinkSync', 'renameSync', 'mkdirSync',
  'execFileSync', 'execSync', 'spawnSync', 'recordSelfWrite', 'appendFileSync', 'db.prepare(', 'INSERT INTO', 'UPDATE ',
];
function sideEffectClass(file) {
  if (!file) return 'unknown';
  const s = fs.readFileSync(file, 'utf8');
  const hits = WRITE_APIS.filter((w) => s.includes(w)).length;
  // 启发式：同一文件里出现 ≥1 个写 API ⇒ 该线可能写盘（线级粒度，粗但可复现）
  return hits > 0 ? 'writes-possible' : 'read-only';
}

/** 入参字段集合（去掉 action 之外的控制字段） */
function paramsOf(t) {
  const shape = t.inputSchema ?? {};
  return new Set(Object.keys(shape));
}

const tools = TOOL_DEFS.map((t) => {
  const site = defSiteOf(t.name);
  return {
    name: t.name,
    lane: t.lane,
    params: paramsOf(t),
    hasOwnAction: t.name !== 'observe' ? Object.keys(t.inputSchema ?? {}).includes('action') : true, // observe 自己就是 action 入口
    needsDesign: [...paramsOf(t)].some((k) => ['feature', 'card', 'plan', 'node_id'].includes(k)),
    side: sideEffectClass(site),
    site: site ? path.relative(ROOT, site) : null,
  };
});

const jac = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
};

const pairs = [];
for (let i = 0; i < tools.length; i++) {
  for (let j = i + 1; j < tools.length; j++) {
    const A = tools[i];
    const B = tools[j];
    const sim = jac(A.params, B.params);
    const shared = [...A.params].filter((x) => B.params.has(x));
    // ★★ 2026-10-28（实测教训）：**参数少时 Jaccard 会虚高** —— `structure_gap` 只有 `project_dir`、
    //   `plan_refactor` 两个字段，重叠 1 个就 0.5。⇒ 只靠比例会造出一堆假候选。
    //   加两条硬约束：共享字段 **≥2** 且 至少一方**字段数 ≥3**（都不是"一个参数的工具"）。
    if (sim < 0.34) continue;
    if (shared.length < 2) continue;
    if (A.params.size < 3 && B.params.size < 3) continue;
    const blockers = [];
    if (A.hasOwnAction || B.hasOwnAction) blockers.push('有各自的 action 命名空间');
    if (A.needsDesign !== B.needsDesign) blockers.push('前置条件不同（设计册/卡）');
    if (A.side !== B.side) blockers.push('副作用形态不同');
    pairs.push({
      a: A.name,
      b: B.name,
      similarity: Number(sim.toFixed(3)),
      shared,
      verdict: blockers.length ? '不可吸收' : '可吸收候选',
      blockers,
    });
  }
}
pairs.sort((x, y) => y.similarity - x.similarity);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: tools.length, pairs }, null, 2));
  process.exit(0);
}

const ok = pairs.filter((p) => p.verdict === '可吸收候选');
console.log(`工具 ${tools.length} 个 · 参数相似度 ≥ 0.34 的工具对 ${pairs.length} 对 · 其中**可吸收候选 ${ok.length} 对**\n`);
console.log('── 可吸收候选（重合高 + 副作用/前置/action 全相容）──');
for (const p of ok.slice(0, 15)) {
  console.log(`  ${p.a.padEnd(22)} ↔ ${p.b.padEnd(22)} 相似 ${p.similarity}  共享 ${p.shared.length} 个: ${p.shared.join(',')}`);
}
console.log('\n── 重合高但**不可吸收**（正是 t407 的结论：并了会撞命名空间 / 混写能力）──');
for (const p of pairs.filter((x) => x.verdict !== '可吸收候选').slice(0, 12)) {
  console.log(`  ${p.a.padEnd(22)} ↔ ${p.b.padEnd(22)} 相似 ${p.similarity}  ✗ ${p.blockers.join(' / ')}`);
}
