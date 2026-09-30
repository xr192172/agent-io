#!/usr/bin/env node
/**
 * ★★★ 搬迁收尾器 —— 把「搬迁之后要同步的那几处」一次做完，让门**不再因为搬迁而红**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么有它（2026-09-30 实测，用户提出的心智负担）
 * ─────────────────────────────────────────────────────────────
 *   搬完 5 个目录后，全量与提交**各报了一次红**，**全是"登记表/硬编码路径没跟着搬"**：
 *     · `tests/fixtures/single_source_registry.json` 的 `frozen` 里还是旧路径
 *     · `tests/server_registry.consistency.test.ts` 的 `INTERNAL_MODULES.importedBy`
 *     · `scripts/capability_scan.mjs` 的 `FEATURE_FILES` —— ★ 它一红，**pre-commit 钩子直接崩、提交被拦**
 *   ⇒ ★ 这些红**不是"代码坏了"，是"收尾漏了"** —— **纯人工负担**。
 *
 * ─────────────────────────────────────────────────────────────
 * ★★ 2026-09-30 补强：从"只覆盖 2 种形态"扩到 **5 种**（台账 §44.7(3) 的形态清单）
 * ─────────────────────────────────────────────────────────────
 *   实测把 6 种"路径知识"集齐了；本器原先只处理 ①②，另 4 种全靠人扫 —— 而人扫漏了两次
 *   （`acceptance_decision_sync` 的节点 id、`capability_scan` 的 FEATURE_FILES）。
 *   形态         例子                                             本器是否覆盖
 *   ① import 说明符  `from '../tools/x.js'`                        ✗ 不在本器职责（`relink_specifiers.mjs` 管）
 *   ② 连续路径串     `'src/tools/x.ts'`                             ✅
 *   ③ **分段拼**     `path.join(ROOT,'src','tools','x.ts')`         ✅ 新增
 *   ④ 路径前缀判断   `nf.startsWith('tools/ts_kernel/')`             ⚠ 默认只**报告**，`--with-src-relative` 才改
 *   ⑤ **带后缀**     `'src/tools/x.ts'`（from 后面跟 `.ts`）          ✅ 新增
 *   ⑥ **数层级**     `new URL('../../go-slim', import.meta.url)`    ✗ **不可字符串替换**，只能靠 marker 纪律 + 门
 *   ⇒ ★ ④ 为何默认只报告：它要求"把 `src/` 前缀去掉再匹配"，误伤面比 ②③⑤ 大（裸 `tools/x` 可能出现在别处）
 *     —— 宁可让人看一眼，也不要静默改错。
 *   ⇒ ⑥ 与 ④ 的残留**每次都打印出来**（`需人工确认`），不许静默放过。
 *
 * ─────────────────────────────────────────────────────────────
 * 做什么
 * ─────────────────────────────────────────────────────────────
 *   给一份 `旧路径=新路径` 映射，扫**仓里所有"把源码路径当字符串用"的地方**，替换掉。
 *   扫的范围：`tests/**`、`scripts/**`、根目录的 `*.json` / `*.mjs` / `*.config.*`
 *   ★ **不扫 `src/**`** —— 那边是**真 import**，`relink_specifiers.mjs` 已经改过了；再改一遍反而危险。
 *   ★ **不扫 `.inspect/**`**（会话工作区，gitignored）。
 *
 * 用法:
 *   node scripts/move_finish.mjs src/health=src/infrastructure/analysis/health [...] [--apply] [--with-src-relative]
 *   不带 --apply 时只列出**将要改的地方**（dry run）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const WITH_REL = process.argv.includes('--with-src-relative');
const pairs = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  if (i < 0) { console.error(`参数形状错（要 old=new）：${a}`); process.exit(2); }
  return { from: a.slice(0, i).replace(/\/+$/, ''), to: a.slice(i + 1).replace(/\/+$/, '') };
});
if (pairs.length === 0) {
  console.error('用法: node scripts/move_finish.mjs <旧路径>=<新路径> [...] [--apply] [--with-src-relative]');
  process.exit(2);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 源码后缀：⑤ 形态 —— `from` 后面直接跟 `.ts`（原先的边界要求后面是 `/` 或引号 ⇒ 漏） */
const SRC_EXT = String.raw`\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)\b`;
/** ② 形态的边界：后面是路径分隔、引号、括号、逗号、空白或行尾 */
const TAIL = String.raw`[/'",\]}\s]|$`;

/** ② 连续路径串（含 ⑤ 带后缀） */
const contRe = (from) => new RegExp(String.raw`(?<![\w-])${esc(from)}(?=${TAIL}|${SRC_EXT})`, 'g');
/** ③ 分段拼：'a' , 'b' , 'c'（各段可各自引号；`path.join(...)` 的形态） */
function segRe(from) {
  const segs = from.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const body = segs.map((s) => String.raw`['"]${esc(s)}['"]`).join(String.raw`\s*,\s*`);
  return new RegExp(body, 'g');
}
const segTo = (to) => to.split('/').filter(Boolean).map((s) => `'${s}'`).join(', ');

/** 要扫的目录 / 文件（**故意不含 src/ 与 .inspect/**） */
function targets() {
  const out = [];
  const walk = (rel, exts) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(rel, e.name);
      if (e.isDirectory()) walk(p, exts);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p.split(path.sep).join('/'));
    }
  };
  walk('tests', ['.ts', '.json', '.mjs']);
  walk('scripts', ['.ts', '.mjs', '.json']);
  // 根目录的 json / mjs / config
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && /\.(json|mjs|cjs|ts)$/.test(e.name) && !e.name.startsWith('.')) out.push(e.name);
  }
  return out;
}

/** 对一段文本施加全部形态的替换；返回 {text, hits} */
function applyTo(text, onlyReport = false) {
  let n = text;
  const hits = [];
  for (const { from, to } of pairs) {
    const re = contRe(from);
    const cnt = (n.match(re) ?? []).length;
    if (cnt > 0) { if (!onlyReport) n = n.replace(re, to); hits.push({ from, to, n: cnt, form: '②⑤连续串' }); }
    const sr = segRe(from);
    if (sr) {
      const c2 = (n.match(sr) ?? []).length;
      if (c2 > 0) { if (!onlyReport) n = n.replace(sr, segTo(to)); hits.push({ from, to, n: c2, form: '③分段拼' }); }
    }
    // ④ 前缀判断 / 拼接里的「去 src/ 前缀」形态
    const rel = from.replace(/^src\//, '');
    const relTo = to.replace(/^src\//, '');
    if (rel !== from) {
      const rre = new RegExp(String.raw`(?<![\w./-])${esc(rel)}(?=${TAIL}|${SRC_EXT})`, 'g');
      const c3 = (n.match(rre) ?? []).length;
      if (c3 > 0) {
        if (WITH_REL && !onlyReport) n = n.replace(rre, relTo);
        hits.push({ from: rel, to: relTo, n: c3, form: WITH_REL ? '④去src前缀' : '④去src前缀（仅报告）' });
      }
    }
  }
  return { text: n, hits };
}

const files = targets();
const changed = new Map();
const reportOnly = new Map(); // 只报告、不改的（④ 与 ⑥ 的人工确认项）
for (const f of files) {
  let s;
  try { s = fs.readFileSync(path.join(ROOT, f), 'utf-8'); } catch { continue; }
  if (!WITH_REL) {
    const r = applyTo(s, true);
    const relHits = r.hits.filter((h) => h.form.includes('仅报告'));
    if (relHits.length) reportOnly.set(f, relHits);
  }
  const { hits } = applyTo(s);
  const real = hits.filter((h) => !h.form.includes('仅报告'));
  if (real.length) changed.set(f, real);
}

if (changed.size === 0 && reportOnly.size === 0) {
  console.log('✓ 没有任何"把源码路径当字符串用"的地方需要同步（收尾已干净）');
  process.exit(0);
}

console.log(`映射：${pairs.map((p) => `${p.from} → ${p.to}`).join('  |  ')}\n`);
let total = 0;
for (const [f, hits] of changed) {
  const sub = hits.reduce((a, h) => a + h.n, 0);
  total += sub;
  console.log(`  ${f}   （${sub} 处）`);
  for (const h of hits) console.log(`      [${h.form}] ${h.from} → ${h.to}  ×${h.n}`);
}
console.log(`\n共 ${changed.size} 个文件、${total} 处需要同步`);

if (reportOnly.size) {
  console.log('\n★ 需人工确认（本器默认不动 —— "去掉 src/ 前缀"的形态误伤面大）：');
  for (const [f, hits] of reportOnly) {
    console.log(`  ${f}`);
    for (const h of hits) console.log(`      ${h.from}（×${h.n}）→ 若确属搬迁，请人工改；或加 --with-src-relative 重跑`);
  }
}
console.log(
  '\n★ 仍**不可能**自动覆盖的形态（见脚本头注释）：\n' +
  '   ⑥ 数层级（`new URL("../../x", import.meta.url)`）—— 必须改成**按路标上溯**，靠门兜（见 tests/*_locating*.test.ts）\n' +
  '   ① import 说明符 —— 由 `scripts/relink_specifiers.mjs` 负责（它在 src/ 与 tests/ 都改）',
);

if (!APPLY) {
  console.log('\n（dry run）加 --apply 才真的改。');
  process.exit(0);
}
for (const [f] of changed) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf-8');
  const { text } = applyTo(s);
  // ★ 保持原行尾（`fs.writeFileSync` 写字符串不改行尾，但读的时候已按原样读入 ⇒ 安全）
  fs.writeFileSync(path.join(ROOT, f), text);
}
console.log(`\n✓ 已同步 ${changed.size} 个文件`);
console.log('提醒：还要跑 `npx depcruise src --config .dependency-cruiser.cjs --baseline` 重收架构基线（它带绝对路径）。');
