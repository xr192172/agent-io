/**
 * edge_diff_full —— 把"两条独立路径对照"**扩到全量**：
 *   ① 现扫 `buildImpactGraph` 的全部 import 边
 *   ② 索引库 `edges(kind='import')` 的全部 import 边
 * 在**两边都认识的文件范围**内比差异，并**分类差异原因**（范围差 / 索引过期 / 待查）。
 *
 * ★ 为什么要限定范围：图会**跳过 `.inspect/`**（实测），而索引没跳；且索引是**时点快照**。
 *   不限定范围地比，会把"范围不同"误报成"缺口"——那正是我这几轮反复踩的坑。
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const { buildImpactGraph } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/analysis/impact/index.js').replace(/\\/g, '/'));
const DB = path.join(REPO, '.agent-io', 'cache.db');
const PY = 'C:/Users/Admin/.workbuddy/binaries/python/versions/3.13.12/python.exe';
// ★ 必须去掉行尾 `\r`：Windows 上 Python 的 print 出 CRLF，不去 ⇒ 每个路径都带 `\r`
//   ⇒ 与 JS 侧的路径**永不相等** ⇒ 交集 0（我这一版第一次跑就是这么错的，白跑一轮）。
const sql = (q) => execFileSync(PY, ['-c', `import sqlite3\nc=sqlite3.connect(r'${DB}')\nfor r in c.execute(${JSON.stringify(q)}): print('\\t'.join(str(x) for x in r), end='\\n')`], { encoding: 'utf8' })
  .split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);

console.log('建图（现扫）…');
const g = await buildImpactGraph(REPO);

// ① 现扫的 import 边对
const live = new Set();
for (const [consumer, m] of g.edges) {
  for (const [provider, sites] of m) {
    if (Array.isArray(sites) && sites.some((s) => s.kind === 'import')) live.add(`${consumer}\t${provider}`);
  }
}
// ② 索引库的 import 边对 + 索引里的文件集 + 索引时间
const idxPairs = new Set(sql("select distinct source, target from edges where kind='import'").map((l) => l.replace(/\t/g, '\t')));
const idxFiles = new Set(sql('select path from files'));
const idxTimes = new Map(sql('select path, indexed_at from files').map((l) => { const [p, t] = l.split('\t'); return [p, t]; }));
const idxEpoch = Math.max(...[...idxTimes.values()].map((t) => Date.parse(t) || 0));
console.log(`图内文件 ${g.rels.size} · 索引文件 ${idxFiles.size} · 交集 ${[...g.rels].filter((r) => idxFiles.has(r)).length}`);
console.log(`现扫 import 边 ${live.size} · 索引 import 边 ${idxPairs.size}`);
console.log(`索引时点（files.indexed_at 最大值）: ${new Date(idxEpoch).toISOString()}`);
console.log();

// ③ 只在**两边都认识的文件**范围内比
const inBoth = (p) => g.rels.has(p) && idxFiles.has(p);
const liveIn = new Set([...live].filter((k) => { const [a, b] = k.split('\t'); return inBoth(a) && inBoth(b); }));
const idxIn = new Set([...idxPairs].filter((k) => { const [a, b] = k.split('\t'); return inBoth(a) && inBoth(b); }));
const onlyLive = [...liveIn].filter((k) => !idxIn.has(k));
const onlyIdx = [...idxIn].filter((k) => !liveIn.has(k));
console.log(`限定两边共同文件范围后：现扫 ${liveIn.size} · 索引 ${idxIn.size}`);
console.log(`★ 只在现扫 ${onlyLive.length} · 只在索引 ${onlyIdx.length}`);

// ④ 按 consumer 分组 + 分类（consumer 文件在索引之后被改过 ⇒ 归"索引过期"）
const group = (arr) => {
  const m = new Map();
  for (const k of arr) { const [c, p] = k.split('\t'); m.set(c, (m.get(c) ?? []).concat(p)); }
  return m;
};
const gl = group(onlyLive), gi = group(onlyIdx);
const classify = (m) => {
  let stale = 0, unknown = 0;
  for (const c of m.keys()) {
    const t = idxTimes.get(c);
    stale += t && Date.parse(t) < idxEpoch ? 1 : 0;
  }
  return { consumers: m.size, stale };
};
console.log(`  只在现扫：涉及 ${gl.size} 个 consumer（其 consumer 早于索引时点的: ${classify(gl).stale}）`);
console.log(`  只在索引：涉及 ${gi.size} 个 consumer`);
console.log('\n只在现扫的 top 6：');
for (const [c, ps] of [...gl].slice(0, 6)) console.log(`  ${c}\n      → ${ps.slice(0, 4).join('  ')}`);
console.log('\n只在索引的 top 6：');
for (const [c, ps] of [...gi].slice(0, 6)) console.log(`  ${c}\n      → ${ps.slice(0, 4).join('  ')}`);

// ─────────────── 第二层：call 边 ───────────────
// ★ 粒度不同：索引是**符号级** `file#symbol`（1868 个 distinct source），图是**文件级**。
//   ⇒ 把索引**折叠到文件级**（取 `#` 前那段）+ **剔除同文件对**（图的 call 边只收跨文件：
//     `impact/index.ts` 里 `if (c.resolved) continue; // 同文件内，不构成"外部受影响"`）。
const liveCall = new Set();
for (const [consumer, m] of g.edges) for (const [provider, sites] of m) if (Array.isArray(sites) && sites.some((s) => s.kind === 'call')) liveCall.add(`${consumer}\t${provider}`);
const idxCallAll = sql("select distinct source, target from edges where kind='call'")
  .map((l) => l.split('\t'))
  .map(([s, t]) => [s.split('#')[0], t.split('#')[0]])
  .filter(([a, b]) => a !== b);
const idxCall = new Set(idxCallAll.map(([a, b]) => `${a}\t${b}`));
const inBoth2 = (k) => { const [a, b] = k.split('\t'); return inBoth(a) && inBoth(b); };
const lc = new Set([...liveCall].filter(inBoth2)), ic = new Set([...idxCall].filter(inBoth2));
const oc1 = [...lc].filter((k) => !ic.has(k)), oc2 = [...ic].filter((k) => !lc.has(k));
console.log(`\n── call 边（索引已折叠到文件级、剔同文件对）──`);
console.log(`  图 ${liveCall.size} · 索引（折叠后）${idxCall.size} · 限定共同范围后：图 ${lc.size} · 索引 ${ic.size}`);
console.log(`  ★ 只在图 ${oc1.length} · 只在索引 ${oc2.length}`);
if (oc1.length) { console.log('  只在图（前 6）:'); for (const k of oc1.slice(0, 6)) console.log('    ' + k.replace('\t', '  →  ')); }
if (oc2.length) { console.log('  只在索引（前 6）:'); for (const k of oc2.slice(0, 6)) console.log('    ' + k.replace('\t', '  →  ')); }

// ★ 分类：只在图的那些里，**跨语言**的有多少？（consumer 扩展名 ≠ provider 扩展名）
//   一条 `.go` 文件"调用"到 `.ts` 文件，几乎不可能是真的 —— 可疑度最高的子集。
const extOf = (p) => path.extname(p);
const cross = oc1.filter((k) => { const [a, b] = k.split('\t'); return extOf(a) !== extOf(b); });
console.log(`  其中**跨语言**的: ${cross.length} / ${oc1.length}  ← 可疑度最高`);
for (const k of cross.slice(0, 8)) console.log('    ' + k.replace('\t', '  →  '));

// ─────────────── 逐条归因 ───────────────
// 用**可判定的判据**给每条差异归类（不靠"看着像"）：
//   · imported：consumer 在图里有到 provider 的 **import 边** ⇒ 这条 call 是**强证据**（有依赖关系支撑）
//   · weak    ：没有 import 边 ⇒ 只能来自"裸名→全局唯一"兜底 ⇒ **弱证据**（正是上一轮逮到假边的那条路）
//   · stale   ：consumer 文件 mtime **晚于**它的索引时点 ⇒ 索引里那份可能已过期
// 说明：`files.indexed_at` 是**毫秒数**（不是 ISO 串）——上一版我按 ISO 解析，恒 NaN（坏的），这里按毫秒比。
const fsmod = await import('node:fs');
const mtimeOf = (rel) => { try { return fsmod.statSync(path.join(REPO, rel)).mtimeMs; } catch { return null; } };
const isStale = (rel) => { const t = idxTimes.get(rel); const m = mtimeOf(rel); return typeof t === 'number' && m !== null && m > t + 1000; };
const bucket = (arr, hasImportFn) => {
  const c = { weak: [], strong: [], staleOnly: [] };
  for (const k of arr) {
    const [a, b] = k.split('\t');
    const imp = hasImportFn(a, b);
    if (imp) c.strong.push(k);
    else if (isStale(a) || isStale(b)) c.staleOnly.push(k);
    else c.weak.push(k);
  }
  return c;
};
const bl = bucket(oc1, (a, b) => live.has(`${a}\t${b}`));
const bi = bucket(oc2, (a, b) => idxPairs.has(`${a}\t${b}`));
console.log('\n★ 逐条归因（判据：有没有 import 边支撑 / 索引是否过期）');
console.log(`  只在图 ${oc1.length}：弱证据（无 import 边）${bl.weak.length} · 强证据 ${bl.strong.length} · 仅索引过期可解释 ${bl.staleOnly.length}`);
console.log(`  只在索引 ${oc2.length}：弱证据 ${bi.weak.length} · 强证据（索引侧有 import 边）${bi.strong.length} · 仅过期 ${bi.staleOnly.length}`);
console.log('  只在图的**弱证据**样例（最该查的）:');
for (const k of bl.weak.slice(0, 8)) {
  const [a, b] = k.split('\t');
  console.log(`    ${k.replace('\t', '  →  ')}   [${extOf(a)}→${extOf(b)}]${isStale(a) ? ' （consumer 晚于索引时点）' : ''}`);
}

// ★★ 弱证据**不能一刀切**：**Go 同一 package 内文件互不 import 却可互调** ⇒ 同目录的 go→go 多半**合法**。
//   按"同目录 / 跨目录"分档，才看得出**真正要查的**还剩多少。
const dirOf = (p) => path.posix.dirname(p);
const pl = bl.weak.map((k) => k.split('\t'));
const sameDir = pl.filter(([a, b]) => dirOf(a) === dirOf(b));
const crossDir = pl.filter(([a, b]) => dirOf(a) !== dirOf(b));
const byLang = (arr) => { const m = new Map(); for (const [a, b] of arr) { const k2 = extOf(a) + '→' + extOf(b); m.set(k2, (m.get(k2) ?? 0) + 1); } return [...m].sort((x, y) => y[1] - x[1]); };
console.log(`\n★ 弱证据 ${bl.weak.length} 条再分档：**同目录 ${sameDir.length}** · **跨目录 ${crossDir.length}**`);
console.log(`  同目录的按扩展名: ${byLang(sameDir).map(([k2, n]) => `${k2}×${n}`).join('  ')}`);
console.log(`     ⇒ Go 同目录 = 同一 package（合法）；.ts/.mjs 同目录仍可疑`);
console.log(`  跨目录的按扩展名: ${byLang(crossDir).map(([k2, n]) => `${k2}×${n}`).join('  ')}`);
console.log('  跨目录弱证据样例（**最像假边**）:');
for (const [a, b] of crossDir.slice(0, 8)) console.log(`    ${a}  →  ${b}`);
console.log(`\n★ 反向（只在索引 ${oc2.length} 条 = **图漏了的**）样例:`);
for (const k of oc2.slice(0, 6)) console.log('    ' + k.replace('\t', '  →  '));

// ─────────────── ★★ 关键一问：那 66 条跨目录弱证据，"无 import 边"到底是 **call 假** 还是 **import 漏**？──
// 判据：**亲自重解析 consumer**，把它的 import 逐条解析成项目内文件；看 provider 在不在里面。
//   · 在 ⇒ consumer **确实 import 了** provider，而图的 import 边里没有 ⇒ **import 边漏了**（另一类缺陷）
//   · 不在 ⇒ consumer **根本没 import** provider ⇒ 这条 call 只能来自"全局同名唯一"⇒ **假边**
const k2mod = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/index.js').replace(/\\/g, '/'));
const { codeSourceExts: cse } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/source_exts.js').replace(/\\/g, '/'));
const EXTS2 = cse(k2mod.listSupportedExtensions());
const relSet = new Set([...g.rels]);
const consumerImports = new Map();
async function importsOf(rel) {
  if (consumerImports.has(rel)) return consumerImports.get(rel);
  const code = fsmod.readFileSync(path.join(REPO, rel), 'utf8');
  const pr2 = await k2mod.parseFileFull(path.join(REPO, rel), code);
  const out = new Set();
  for (const im of pr2.imports || []) {
    if (im.type_only) continue;
    const h = k2mod.resolveProjectImport(rel, im.source, relSet, { exts: EXTS2 });
    if (h.rel) out.add(h.rel);
  }
  consumerImports.set(rel, out);
  return out;
}
let realImport = 0, fakeCall = 0;
const realList = [], fakeList = [];
for (const [a, b] of crossDir) {
  const imps = await importsOf(a);
  if (imps.has(b)) { realImport++; realList.push([a, b]); } else { fakeCall++; fakeList.push([a, b]); }
}
console.log(`\n★★ 66 条跨目录弱证据的真相（重解析 consumer 的 import 亲自核）：`);
console.log(`   · consumer **确实 import 了** provider ⇒ **import 边漏了**（另一类缺陷）: ${realImport} 条`);
console.log(`   · consumer **根本没 import** ⇒ 这条 call 只能来自"全局同名唯一"⇒ **假边**: ${fakeCall} 条`);
console.log('   假边样例:'); for (const [a, b] of fakeList.slice(0, 6)) console.log(`     ${a}  →  ${b}`);
console.log('   import 漏了样例:'); for (const [a, b] of realList.slice(0, 6)) console.log(`     ${a}  →  ${b}`);
