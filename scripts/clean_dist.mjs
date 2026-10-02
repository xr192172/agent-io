#!/usr/bin/env node
/**
 * clean_dist —— 清掉 `dist/` 里「**源文件已不存在**」的孤儿产物。
 *
 * ★ 为什么需要它（2026-10-02 实测，这是 MCP server 起不来的**根因**）：
 *   `tsc` **不清 outDir**。而本仓刚经历 200+ 文件的大搬迁（按域重组）⇒ 旧位置编译出的
 *   `.js` / `.js.map` **一直留在 dist 里**，实测：**产物 1253 个，孤儿 609 个**（接近一半）。
 *   后果不是"占空间"，而是**新旧两套相对 import 混在同一条链上**：
 *     `dist/src/application/tool_registry.js` 里写着 `../../application/observe/index.js`
 *     ——那是它**还在 `presentation/mcp/` 时**的相对路径，被放在新位置后解析成
 *     `dist/application/observe/index.js`（不存在）⇒ **server 启动即 ERR_MODULE_NOT_FOUND**。
 *   更险的是 `dist/src/server.js`：源文件 `src/server.ts` 早搬走了，产物却还在 ——
 *   而 `~/.workbuddy/mcp.json` 曾**指着它**,于是整条 MCP 通道静默失效了很久没人发现。
 *
 * ★ 它同时是一把**量具**：读数（产物数 / 孤儿数）就是"dist 干净度"。
 *   ★★ 判据要问一句：「dist 里还有多少东西**没有任何源文件对应**」——
 *   只要不是 0，就说明"当前 dist 并不等于当前源码编译出来的东西"。
 *
 * 用法：
 *   node scripts/clean_dist.mjs --dry-run   # 只报读数与清单，不删
 *   node scripts/clean_dist.mjs             # 真删（顺带清理清空的目录）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
/**
 * ★ 只扫 `dist/src/` —— **判据范围要收窄，不能整个 dist 一起判**（2026-10-02 实测）：
 *   `dist/schema/design_dsl.schema.json` 是 `npm run gen:schema` 生成的，**不是 tsc 产物**，
 *   没有对应的 `.ts` ⇒ 按"源不存在即孤儿"会被**误删**。
 *   本脚本只管「tsc 编出来的东西」，别的生成物各归各的生成器管。
 */
const SCAN = path.join(DIST, 'src');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(SCAN)) {
  console.log('[clean_dist] dist/src 不存在，跳过。');
  process.exit(0);
}

/** 收集 dist 下所有产物（相对 dist 的 posix 路径） */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(DIST, p).split(path.sep).join('/'));
  }
  return out;
}

const all = walk(SCAN);

/** 产物 → 它应当来自的源文件（tsc 的 outDir=dist，rootDir=仓根 ⇒ 产物 path = src 的相对 path） */
function sourceCandidates(rel) {
  const stem = rel.replace(/\.js\.map$/, '').replace(/\.js$/, '');
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`];
}

const orphans = all.filter((rel) => !sourceCandidates(rel).some((s) => fs.existsSync(path.join(ROOT, s))));

console.log(`[clean_dist] dist 产物 ${all.length} 个；**孤儿**（源文件已不存在）${orphans.length} 个。`);

if (orphans.length === 0) {
  console.log('[clean_dist] ⇒ dist 与源码一一对应 ✓');
  process.exit(0);
}

if (dryRun) {
  for (const o of orphans.slice(0, 40)) console.log(`   (would remove) ${o}`);
  if (orphans.length > 40) console.log(`   …还有 ${orphans.length - 40} 个`);
  console.log('⇒ --dry-run：未删除任何文件。');
  process.exit(0);
}

for (const rel of orphans) fs.rmSync(path.join(DIST, rel), { force: true });

/** 顺带清掉因此变空的目录（自底向上，删到 dist 为止） */
let removedDirs = 0;
function pruneEmpty(dir) {
  if (dir === SCAN) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) pruneEmpty(p);
  }
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      removedDirs += 1;
    }
  } catch {
    /* 非空或占用：留着，不是错误 */
  }
}
for (const e of fs.readdirSync(SCAN)) {
  const p = path.join(SCAN, e);
  if (fs.statSync(p).isDirectory()) pruneEmpty(p);
}

console.log(`[clean_dist] 已删除 ${orphans.length} 个孤儿产物、${removedDirs} 个空目录。`);
console.log('★ 现在 dist 只含"当前源码编译出来的东西"——这才配得上"dist 是最新的"这句话。');
