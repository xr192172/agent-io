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
