#!/usr/bin/env node
/**
 * dep —— ★ **第③层：依赖**（设计侧加/删调用关系）。
 *
 * ## 它补的是哪一层（见 `DESIGN.md §9`）
 * ```
 * ① 意图  decision.summary        ← npm run dec
 * ② 约束  decision.expectations   ← npm run dec --add-expectation
 * ③ 依赖  设计 DB 的 calls         ← ★ 本脚本
 * ④ 源码  写代码
 * ```
 *
 * ## 语义（关键：改的是"设计说该有/不该有"）
 * 设计 DB 的 `*.calls.json` 是 fork 自 `cache.db` 的**事实副本**。
 * **"改设计"就是在这份副本上【加 / 删】**：
 *   `--add`    ⇒ 设计说"这条调用**必须**有" ⇒ 实际没有 ⇒ ★ 差异（要接线）
 *   `--remove` ⇒ 设计说"这条调用**不该**有" ⇒ 实际还有 ⇒ ★ 差异（要拆）
 *   ★ 而 `--remove` 不是删掉记录，是**移到 `removed`** —— 因为"设计说不要"本身是一条信息。
 *
 * ## 用法
 * `node scripts/dep.mjs --from src/a.ts#f --to src/b.ts#g --why "…"`
 * `node scripts/dep.mjs --from src/a.ts#f --to src/b.ts#g --remove --why "…"`
 *
 * ★ 文件级的 `geometry.edges` 暂不在这里改（它归 `fork` 从 live 复制）——
 *   本脚本只动**符号级调用**，那是"依赖"里最细、也最容易被漏的一层。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join('certs', 'design-contracts');
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (n) => argv.includes(`--${n}`);

const from = arg('from');
const to = arg('to');
const why = arg('why') ?? '';
const remove = has('remove');

if (!from || !to || !from.includes('#') || !to.includes('#')) {
  console.error('★ 需要 --from <file#fn> 与 --to <file#fn>（都要带 # 函数名）');
  process.exit(2);
}

const srcFile = from.split('#')[0].replace(/\\/g, '/');
const slug = (p) => p.replace(/^src\//, '').replace(/\.ts$/, '').replace(/\//g, '-');
const file = path.join(DIR, `${slug(srcFile)}.calls.json`);

if (!fs.existsSync(file)) {
  console.error(`★ 没有这个文件的调用契约：${file}`);
  console.error('  ⇒ 先跑 npm run fork（它会给每个文件生成一份全量副本）');
  process.exit(2);
}

const j = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(j.calls)) j.calls = [];
if (!Array.isArray(j.removed)) j.removed = [];

const key = (c) => `${c.from}|${c.to}`;
const target = { from: from.replace(/\\/g, '/'), to: to.replace(/\\/g, '/'), why };

if (remove) {
  const i = j.calls.findIndex((c) => key(c) === key(target));
  if (i < 0) {
    console.error(`★ 设计里没有这条调用（不能"删一个不存在的"）：${from} → ${to}`);
    process.exit(2);
  }
  j.calls.splice(i, 1);
  j.removed.push({ ...target, removed_at: new Date().toISOString() });
} else {
  if (j.calls.some((c) => key(c) === key(target))) {
    console.error(`★ 这条调用已经在设计里了：${from} → ${to}`);
    process.exit(2);
  }
  j.calls.push(target);
}

fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');

console.log('════ dep（第③层：依赖）════');
console.log(`  ${remove ? '−' : '+'} ${from.split('#').pop()} → ${to.split('#').pop()}`);
if (why) console.log(`  为什么：${why}`);
console.log(`  文件：${file}`);
console.log(`  现在 calls ${j.calls.length} 条 · removed ${j.removed.length} 条`);
console.log(`  ★ 下一步：npm run contract:calls（它会告诉你"设计要的调用，实际有没有"）`);
