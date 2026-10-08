/**
 * impact_reverse —— 验**反向**（"改这个文件会影响谁"），并用**独立方法**对照。
 *
 * ★ 两条独立路径（这才是"对照"的意义）：
 *   ① 现扫：`buildImpactGraph(root)` —— 当场解析所有代码文件建图（**不读索引**）
 *   ② 索引器：`.agent-io/cache.db` 的 `edges(kind='import')` —— 索引器早先建的边（**SQL 直查**）
 *   若两者对同一目标的依赖者不一致，要**说清为什么**（范围不同 / 索引过期 / 真缺口），不许含糊过去。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { buildImpactGraph, computeImpact } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/analysis/impact/index.js').replace(/\\/g, '/'));

const TARGET = 'src/infrastructure/parse/languages.ts';

// ① 现扫建图（不读索引）
console.log('① 现扫建图 buildImpactGraph(root) …');
const g = await buildImpactGraph(REPO);
const rels = g.rels;
const revOf = (f) => [...(g.reverse.get(f) ?? [])];
console.log(`   图内文件 ${rels.size} · reverse 键 ${g.reverse.size} · edges 键 ${g.edges.size}`);
console.log(`   口径排除（可解析但不算源码）: ${JSON.stringify(g.excludedNonCode)}`);
const liveDeps = new Set(revOf(TARGET));
console.log(`   ★ 直接依赖 ${TARGET} 的（现扫）: ${liveDeps.size} 个`);
console.log(`      ${[...liveDeps].slice(0, 6).join('  ')}`);

// ② 索引库 SQL 反查（独立方法）
const db = path.join(REPO, '.agent-io', 'cache.db');
const sql = `SELECT DISTINCT source FROM edges WHERE kind='import' AND target='${TARGET}'`;
const indexed = new Set(
  execFileSync('C:/Users/Admin/.workbuddy/binaries/python/versions/3.13.12/python.exe',
    ['-c', `import sqlite3,sys\nc=sqlite3.connect(r'${db}')\nfor r in c.execute(${JSON.stringify(sql)}): print(r[0])`],
    { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean));
console.log(`   ★ 直接依赖 ${TARGET} 的（索引库）: ${indexed.size} 个`);
console.log(`      ${[...indexed].slice(0, 6).join('  ')}`);

// ③ 差异 + 解释
const onlyLive = [...liveDeps].filter((x) => !indexed.has(x));
const onlyIdx = [...indexed].filter((x) => !liveDeps.has(x));
console.log(`\n③ 差异：只在现扫 ${onlyLive.length} 个 · 只在索引 ${onlyIdx.length} 个`);
console.log(`   只在现扫: ${onlyLive.slice(0, 8).join('  ') || '（无）'}`);
console.log(`   只在索引: ${onlyIdx.slice(0, 8).join('  ') || '（无）'}`);

// ④ 影响面报告（对外形状）
const rep = await computeImpact(g, REPO, [{ file: TARGET }]);
console.log(`\n④ computeImpact 报告：total=${rep.total} direct=${rep.direct} high_risk=${rep.high_risk} fell_back=${rep.fell_back}`);
console.log(`   bounds.skipped: ${JSON.stringify(rep.bounds?.skipped)}`);

// ⑤ 索引库里也在的文件范围（解释差异用）
const idxFiles = new Set(
  execFileSync('C:/Users/Admin/.workbuddy/binaries/python/versions/3.13.12/python.exe',
    ['-c', `import sqlite3\nc=sqlite3.connect(r'${db}')\nfor r in c.execute('select path from files'): print(r[0])`],
    { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean));
console.log(`\n⑤ 范围对照：索引 files=${idxFiles.size} · 图 rels=${rels.size} · 交集=${[...rels].filter((r) => idxFiles.has(r)).length}`);
console.log(`   图里有、索引没有的（前 6）: ${[...rels].filter((r) => !idxFiles.has(r)).slice(0, 6).join('  ')}`);
console.log(`   索引有、图里没有的（前 6）: ${[...idxFiles].filter((r) => !rels.has(r)).slice(0, 6).join('  ')}`);
