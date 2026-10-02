#!/usr/bin/env node
/**
 * structure_gap —— 「结构意图 vs 现状」的**四态读数**。
 *
 * ★ 它补的是重构工具缺的那一位：**"域"这个概念**。
 *   现有 DSL 的维度是「功能 → 文件 → API」，管的是"一条功能线该有哪些文件、暴露哪些 API"；
 *   **它不表达"哪个目录算哪个域、谁不许 import 谁"** ⇒ 于是"整仓分层/搬家"这类重构
 *   只能靠人在会话里手工摊一张表（2026-10-02 实测：`infrastructure/analysis/` 一个目录 84 个文件，
 *   其中 19 个**没分类**直接堆着，还有 11 个已按域分子目录 —— **两种标准并存**）。
 *
 * ★ 与既有纪律的关系（**这三条决定了"补什么、不补什么"**，别只看结论）：
 *   · `expected_apis` = **意图**（进 DSL）；`actual_apis`/`actual_deps` = **事实**（已摘掉，因为
 *     "第二份可写副本 = 判据分叉"）。⇒ 本读数**只读意图 + 现扫磁盘**，不复制任何事实。
 *   · **依赖方向不在这里**：`dep-cruiser` 已在算（`layer-downward-only` 等）⇒ 搬进来就是第二副本。
 *   · **实际依赖边也不在这里**：从 `cache.db` 现取。
 *
 * 四态（对齐 `checkConsistency` 的既有形状）：
 *   missing    目标声明了某域，但那个目录**还不存在**（或域里一个文件都没有）
 *              ★ 与 `misplaced` 是**一体两面**：搬迁完成 ⇒ 目录出现、misplaced 归零、本项自然消失。
 *              若你**并不打算建**这个域，那它就是**配置写错**（不必多开一态，同一读数两种读法）
 *   ★ misplaced 文件在，但**不在目标域**（= 该搬还没搬）⇒ **这就是待办清单**
 *   unlisted   文件在，且**没在任何域里登记** ⇒ 要决定归属（**不猜**）
 *
 * 用法：node scripts/structure_gap.mjs [--domain <id>] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const REPO = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
const CFG = JSON.parse(fs.readFileSync(path.join(REPO, 'structure.domains.json'), 'utf-8'));
const onlyDomain = process.argv.includes('--domain') ? process.argv[process.argv.indexOf('--domain') + 1] : null;

// ★ id 必须唯一：否则 `--domain <id>` 会静默命中多个、过滤失效（实测教训：加 meta/ 域时
//   差点造出第二个 id=impact —— 已有的 impact 域在 infrastructure/analysis/ 下）。
const dupIds = CFG.domains.map((d) => d.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dupIds.length) {
  console.error(`✗ structure.domains.json 里有重复的域 id：${[...new Set(dupIds)].join(', ')}`);
  process.exit(2);
}
const asJson = process.argv.includes('--json');

/** 域目录的**父目录**集合：只在这些父目录下判"该不该在域里"（避免全仓乱报） */
const parents = new Set(CFG.domains.map((d) => path.posix.dirname(d.dir)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(path.join(REPO, 'src')).map((f) => path.relative(REPO, f).split(path.sep).join('/'));
const inDomain = (rel, dir) => rel === `${dir}.ts` || rel.startsWith(dir + '/');

const missing = [];
const misplaced = [];
const unlisted = [];

for (const d of CFG.domains) {
  if (onlyDomain && d.id !== onlyDomain) continue;
  const abs = path.join(REPO, d.dir);
  const inside = files.filter((f) => inDomain(f, d.dir));
  if (!fs.existsSync(abs)) {
    // 目录还不存在 —— 但也许"域"就体现在同名的**单文件**里（收编场景）
    const asFile = files.filter((f) => f === `${d.dir}.ts`);
    if (asFile.length) missing.push({ domain: d.id, dir: d.dir, note: `目标是目录，现在是单文件 ${asFile[0]}` });
    else missing.push({ domain: d.id, dir: d.dir, note: '目录不存在，域里也没有文件' });
  } else if (inside.length === 0) {
    missing.push({ domain: d.id, dir: d.dir, note: '目录存在但域里一个 .ts 都没有' });
  }
}

// ★ misplaced / unlisted：只看**域目录的父目录下、直接堆放**的文件（那才是"没分类"）
for (const parent of parents) {
  const absParent = path.join(REPO, parent);
  if (!fs.existsSync(absParent)) continue;
  for (const e of fs.readdirSync(absParent, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.ts') || e.name.endsWith('.d.ts')) continue;
    if (e.name === 'index.ts') continue; // 父目录自己的 barrel 合法
    const rel = `${parent}/${e.name}`;
    if (onlyDomain) continue;
    const stem = e.name.replace(/\.ts$/, '');
    if (CFG.unassigned.includes(stem)) unlisted.push({ file: rel, note: 'structure.domains.json 的 unassigned 里 —— 归属未定' });
    else misplaced.push({ file: rel, note: `${stem} 没进任何域目录` });
  }
}

const report = { misplaced, unlisted, missing };

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const sec = (title, arr, hint) => {
    console.log(`${arr.length ? '⚠️ ' : '✅ '}${title}: ${arr.length}${arr.length ? '   ' + hint : ''}`);
    for (const x of arr) console.log(`      ${x.file ?? `${x.domain}(${x.dir})`}   ${x.note ?? ''}`);
    console.log();
  };
  console.log(`\n=== structure_gap：结构意图 vs 现状 ===`);
  console.log(`域表: structure.domains.json（${CFG.domains.length} 个域；父目录 ${[...parents].join(', ')}）\n`);
  sec('★ misplaced（在，但不在目标域 —— 这就是待搬清单）', misplaced, '');
  sec('unlisted（在，归属未定 —— 要决定，不要猜）', unlisted, '');
  sec('missing（域目录还不存在 / 域里没有文件 —— 与 misplaced 一体两面）', missing, '');
  const todo = misplaced.length + unlisted.length;
  console.log(
    todo + missing.length === 0
      ? '⇒ 结构意图与现状一致 ✓'
      : `⇒ 待处置：**${misplaced.length} 个待搬** + **${unlisted.length} 个待定归属**；另有 ${missing.length} 个**待建域**（搬完自然消失）`,
  );
  console.log('★ 搬完记得：node scripts/preflight_move.mjs <旧> <新> → npm run arch（0 违规）→ 全量。');
}
