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
 *   ⇒ 本脚本把那几处**机械同步**掉，于是门只在"真坏了"时才红。
 *
 * ─────────────────────────────────────────────────────────────
 * 做什么
 * ─────────────────────────────────────────────────────────────
 *   给一份 `旧路径=新路径` 映射，扫**仓里所有"把源码路径当字符串用"的地方**，替换掉。
 *   扫的范围：`tests/**`、`scripts/**`、根目录的 `*.json` / `*.mjs` / `*.config.*`
 *   ★ **不扫 `src/**`** —— 那边是**真 import**，`rename_files` 已经改过了；再改一遍反而危险。
 *   ★ **不扫 `.inspect/**`**（会话工作区，gitignored）。
 *
 * 用法:
 *   node scripts/move_finish.mjs src/health=src/infrastructure/analysis/health [...] [--apply]
 *   不带 --apply 时只列出**将要改的地方**（dry run）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const pairs = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  if (i < 0) { console.error(`参数形状错（要 old=new）：${a}`); process.exit(2); }
  return { from: a.slice(0, i).replace(/\/+$/, ''), to: a.slice(i + 1).replace(/\/+$/, '') };
});
if (pairs.length === 0) {
  console.error('用法: node scripts/move_finish.mjs <旧路径>=<新路径> [...] [--apply]');
  process.exit(2);
}

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

const files = targets();
const changed = new Map(); // file → [{from, to, n}]
for (const f of files) {
  let s;
  try { s = fs.readFileSync(path.join(ROOT, f), 'utf-8'); } catch { continue; }
  const hits = [];
  let n = s;
  for (const { from, to } of pairs) {
    // ★ 只在**路径边界**上替换：`from` 后面必须是 `/`、`'`、`"`、`,`、`]`、`}` 或行尾，
    //   且前面不能是字母数字（避免 `src/healthier/` 这类前缀误伤）。
    const re = new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/'",\\]} \\n]|$)`, 'g');
    const cnt = (n.match(re) ?? []).length;
    if (cnt > 0) { n = n.replace(re, to); hits.push({ from, to, n: cnt }); }
  }
  if (hits.length) changed.set(f, hits);
}

if (changed.size === 0) {
  console.log('✓ 没有任何"把源码路径当字符串用"的地方需要同步（收尾已干净）');
  process.exit(0);
}

console.log(`映射：${pairs.map((p) => `${p.from} → ${p.to}`).join('  |  ')}\n`);
let total = 0;
for (const [f, hits] of changed) {
  const sub = hits.reduce((a, h) => a + h.n, 0);
  total += sub;
  console.log(`  ${f}   （${sub} 处）`);
  for (const h of hits) console.log(`      ${h.from} → ${h.to}  ×${h.n}`);
}
console.log(`\n共 ${changed.size} 个文件、${total} 处需要同步`);

if (!APPLY) {
  console.log('\n（dry run）加 --apply 才真的改。');
  process.exit(0);
}
for (const [f] of changed) {
  let s = fs.readFileSync(path.join(ROOT, f), 'utf-8');
  for (const { from, to } of pairs) {
    const re = new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/'",\\]} \\n]|$)`, 'g');
    s = s.replace(re, to);
  }
  fs.writeFileSync(path.join(ROOT, f), s);
}
console.log(`\n✓ 已同步 ${changed.size} 个文件`);
console.log('提醒：还要跑 `npx depcruise src --config .dependency-cruiser.cjs --baseline` 重收架构基线（它带绝对路径）。');
