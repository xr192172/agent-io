#!/usr/bin/env node
/**
 * cert T326 —— **工具面固定开销**（那段每轮都要重付的 tools 块）**不许无理由增长**。
 *
 * ## 为什么需要这张证（2026-10-15）
 * 用户问：*"我们每一次使用工具它都会每一次都重复一遍吗？那这笔消耗就可能有点大"* ——
 *   ★ 机制：不是每次**工具调用**付一遍，是**每个请求**付一遍（一轮调 3 次 = 3 个请求，整段重发）
 *     ⇒ 成本 ≈ **工具面大小 × 轮数**。
 *   ★ 实测（本条出证时的读数）：**69 个工具 / 156,765 字符 / 平均 2,273**；Top-10 占 **39.6%**。
 *   ★★ 而**这个数此前没人盯着** —— 谁加几句描述，成本就静默上涨，没有一处会红。
 *
 * ## 判据（三条）
 *   ① **总字符数不许超过基线**（可以更小；更小会被提示"可以把基线收紧"）；
 *   ② **工具数不许超过基线**（加工具是有意识的事，不该悄悄发生）；
 *   ③ **基线本身要能被评审看见** —— 基线里存 **Top-10 明细**，任何"把一个工具悄悄撑大"的改动
 *      都会在 `certs/t326-tool-surface-baseline.json` 的 diff 里现形（★ T224 的原则：验收依据必须可见）。
 *   ④ **dist 不许比 src 旧** —— 否则这张证量的是**旧产物**（★ 本仓踩过"dist 旧 ⇒ 对账三处对不上"）。
 *
 * ## 怎么用
 *   node certs/t326-tool-surface-cost-cert.mjs            # 判红/绿
 *   node certs/t326-tool-surface-cost-cert.mjs --update    # ★ 有意识地更新基线（会打印逐工具增减）
 * ★ 改了 `src/` 的描述后请先 `npm run build`，否则 ④ 会红（这是**故意的**：不许拿旧 dist 交差）。
 *
 * ★ 估算 token 只是**粗估**（中英混排按 ~3 字符/token 的中心值给区间）：**字符数才是实测**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const BASELINE = path.join(HERE, 't326-tool-surface-baseline.json');
const UPDATE = process.argv.includes('--update');

const REG = path.join(REPO, 'dist/src/application/tool_registry.js');
if (!fs.existsSync(REG)) {
  console.error(`✗ 找不到 ${path.relative(REPO, REG)} ⇒ 先 npm run build`);
  process.exit(1);
}

let P = 0;
let F = 0;
const check = (name, ok, detail) => {
  if (ok) P++;
  else F++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

// ── 读数 ──
const { TOOL_DEFS } = require(REG);
const sizeOf = (t) => JSON.stringify({ name: t.name, description: t.description, title: t.title, inputSchema: t.inputSchema }).length;
const sized = TOOL_DEFS.map((t) => [t.name, sizeOf(t)]).sort((a, b) => b[1] - a[1]);
const chars = sized.reduce((n, [, l]) => n + l, 0);
const tools = TOOL_DEFS.length;
const top10 = sized.slice(0, 10);
const top10Share = ((100 * top10.reduce((n, [, l]) => n + l, 0)) / chars).toFixed(1);

/** 字符 → token 区间（粗估：中文密 ≈2.5 字符/token，英文/JSON 疏 ≈3.5） */
const tok = (c) => `${Math.round(c / 3.5 / 1000)}k–${Math.round(c / 2.5 / 1000)}k`;

console.log('=== T326 · 工具面固定开销 ===');
console.log(`  读数（实测）：工具 ${tools} 个 · tools 块 **${chars} 字符** · 平均 ${Math.round(chars / tools)} 字符/工具`);
console.log(`  粗估 token：约 ${tok(chars)}（每请求重付；稳定前缀可走缓存）`);
console.log(`  Top-10 占 ${top10Share}%：${top10.map(([n, l]) => `${n} ${l}`).join(' · ')}`);

// ── dist 新鲜度（④）：不许拿旧产物当读数 ──
const newestSrc = (() => {
  let newest = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(path.join(REPO, 'src/application'));
  return newest;
})();
const distMtime = fs.statSync(REG).mtimeMs;

// ── 基线 ──
const cur = { tools, chars, top10, capturedAt: new Date().toISOString().slice(0, 10) };
if (UPDATE || !fs.existsSync(BASELINE)) {
  const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
  const rec = {
    note: 'T326 工具面固定开销基线。★ 只许"不增长"自动通过；增长必须显式 --update（有意识的动作），且本文件的 diff 会在评审里可见。',
    tools,
    chars,
    capturedAt: cur.capturedAt,
    top10,
  };
  fs.writeFileSync(BASELINE, JSON.stringify(rec, null, 2) + '\n', 'utf8');
  console.log(`\n  ${prev ? '★ 已更新' : '已建立'}基线 → ${path.relative(REPO, BASELINE)}`);
  if (prev) {
    console.log(`    字符 ${prev.chars} → ${chars}（${chars > prev.chars ? '+' : ''}${chars - prev.chars}）`);
    const pm = new Map(prev.top10 ?? []);
    for (const [n, l] of top10) {
      const was = pm.get(n);
      if (was !== undefined && was !== l) console.log(`    · ${n}: ${was} → ${l}（${l > was ? '+' : ''}${l - was}）`);
      else if (was === undefined) console.log(`    · ${n}: 新入 Top-10（${l}）`);
    }
  }
  console.log('  ★ 更新基线 = 声明"我知道工具面变大了"。请在提交信息里写清理由。');
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

console.log('');
check('④ dist 不比 src 旧（否则本证量的是旧产物）', distMtime >= newestSrc, distMtime >= newestSrc ? '一致' : 'dist 旧 ⇒ 先 npm run build');
check('① 工具面开销未增长（≤ 基线）', chars <= base.chars, `当前 ${chars} / 基线 ${base.chars}（差 ${chars - base.chars}）`);
check('② 工具数未增长', tools <= base.tools, `当前 ${tools} / 基线 ${base.tools}`);
check(
  '③ 基线含 Top-10 明细（增长能在评审里现形）',
  Array.isArray(base.top10) && base.top10.length >= 5 && base.top10.every((x) => Array.isArray(x) && typeof x[1] === 'number'),
  `top10 条目 ${Array.isArray(base.top10) ? base.top10.length : '缺失'}`,
);

if (chars < base.chars) {
  console.log(`\n  ★ 比基线小了 ${base.chars - chars} 字符 —— 可以把基线收紧：node certs/t326-tool-surface-cost-cert.mjs --update`);
}
if (chars > base.chars) {
  console.log('\n  ★★ 工具面变大了。两条路（二选一，都要有意识）：');
  console.log('     ① 把描述压回去（★ Top-10 占四成，见上面读数）；');
  console.log('     ② 若确有必要 ⇒ --update 更新基线，并在提交信息里写清理由。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
console.log('★ 工具面固定开销在预算内 —— 这段"每轮重付"的账有人盯着了。');
