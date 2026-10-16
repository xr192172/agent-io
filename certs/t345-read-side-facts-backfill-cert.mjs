#!/usr/bin/env node
/**
 * ★★★ cert T345 —— **读取侧"扫描事实缺席 ⇒ 按需从 DB 现渲染补齐"** 的出生证（2026-10-16）。
 *
 * ## 这一笔要钉住什么（`docs/dsl-keep-list-2026-10-16.md` §三' 第 2 步 **(c) 的前置**）
 *   (c) 要把 DSL 里**可 DB 现算**的那部分摘掉（`semantic.files[].symbols[]` / `.lines` /
 *   `geometry.edges[]` 的纯事实部分）。★ 消费点实测 **~14 个文件**
 *   （`query_feature` / `derive_mind_map` / `diff_views` / `validator` / `export` / `dag_layout` / …）。
 *   ⇒ 逐个改 = 改动面大、易漏、难回滚。**本笔改在"唯一读取入口"**（`storage.ts#getDSL` /
 *     `#getLiveFeatureResolved`）⇒ ★ **消费点一字未改**（题面 (ii)：一处收口）。
 *
 * ## ★★ 开关（**为什么不是"看字段在不在"**）
 *   若按"字段缺席就补"，会**误伤现有夹具**：`t335`/`t336`/`t343` 手搭的 DSL **本就不带**
 *   `symbols`/`lines` 且 `source_root` 指着一份真 `cache.db` ⇒ 会被补出**它们从没写过**的数据。
 *   ⇒ 开关 = **DSL 自己声明"事实外置"**：`_sync.facts === 'db'`（(c) 摘字段时写下它）。
 *     **没这个标记 ⇒ 读取逐项不变**（判据③，本证用 `nobf` 这一档**当场对照**）。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ **字段缺席仍拿到数据**：同一份图，三档并排 ——
 *      `full`（事实内嵌）· `strip`（**剥掉 symbols/lines/edges 且带 `_sync.facts='db'`**）· `nobf`（剥掉但**不声明**）
 *      ⇒ ★ **三个消费点**读数（`query_feature` 符号数 · `derive_mind_map` 的 lines 过滤 · `diff_views` 符号数）
 *        必须 **`strip` == `full`**，且 **`nobf` ≠ `full`**（后者是"闸关掉就退化"的**对照**，证明本笔确实在补）。
 *   ② ★ **走工具层**：`query_feature` 那一条经 **`getDslHandler`**（= `get_dsl` 工具，`wrapData`）取数。
 *   ③ ★★ **文件在位 ⇒ 行为逐项不变**：`nobf` 档就是"没有声明"的等价物 —— 它的读数 == 改前读数
 *      （见 ①-对照：`nobf` 与"不补齐"的读数逐项相同）。
 *
 * ## ★ 接法选择：题面 **(ii)**（读取入口补齐），不选 (i)（改 10+ 消费点）—— 理由
 *   · 改动面：本笔只动 `storage.ts` **一个文件**（+ 一处 `syncMeta` 保留标记）；
 *   · 可回滚：删掉 `withFacts` 的两次调用即回到改前；
 *   · 一处收口 ⇒ 不会"改漏第 11 个消费点"；
 *   · (i) 会把"DB 渲染"这一**重活**散进每个消费点（每处都要自己拿 root/开库），重复度更高、口径更易分叉。
 *
 * ## 用法
 *   node certs/t345-read-side-facts-backfill-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp345`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**；
 * ★ 真仓 `cache.db` **本证根本不打开**（只开夹具自己的 `CODE/.agent-io/cache.db`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp345');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, saveLiveFeature } = await import('../dist/src/infrastructure/storage.js');
const { renderLiveFromDb } = await import('../dist/src/infrastructure/index/live_render.js');
const { getProjectCacheDb } = await import('../dist/src/infrastructure/index/db.js');
const { syncFile, resolveCrossFileCalls } = await import('../dist/src/infrastructure/index/symbols.js');
const { queryFeature } = await import('../dist/src/application/meta/explore/query_feature.js');
const { deriveMindMap } = await import('../dist/src/application/meta/view/derive_mind_map.js');
const { diffViews } = await import('../dist/src/application/refactor/diff_views/diff_views.js');
const { getDslHandler } = await import('../dist/src/application/design/handlers.js');

// ── 夹具源码树（★ 一份真源码 ⇒ 真 cache.db ⇒ `renderLiveFromDb` 有东西可渲）──
const CODE = path.join(TMP, 'code');
const SRC = {
  'src/alpha.ts': `export class Alpha {
  run(): number { return 1; }
  stop(): void { /* noop */ }
}

export interface AlphaOptions {
  name: string;
}
`,
  'src/beta.ts': `import { Alpha } from './alpha';

export class Beta {
  go(): void {
    const a = new Alpha();
    a.run();
  }
}
`,
  // ★ **3 行、0 导出** ⇒ 是 `derive_mind_map` 的 `isHuskFile` 要滤掉的那个（`(f.lines??999)>=10`）
  'src/tiny.ts': `// 占位（无导出）
//
//
`,
};
for (const [rel, code] of Object.entries(SRC)) {
  const abs = path.join(CODE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code, 'utf-8');
}
const db = getProjectCacheDb(CODE);
for (const rel of Object.keys(SRC)) await syncFile(db, CODE, path.join(CODE, rel));
resolveCrossFileCalls(db, CODE, { scopeFiles: Object.keys(SRC) });

console.log('════ 0. 夹具就位：DSL = 从 DB 现渲染（"完整版"的原型）+ 三档（full / strip / nobf）════');

// ★ 0.1 先落一份**最小** DSL 只为把 `source_root` 写进去（`renderLiveFromDb` 靠它找根）
const MIN = (feature) => ({
  id: `feature_${feature}`,
  type: 'feature_diagram',
  feature,
  version: '1.0.0',
  title: feature,
  source_root: CODE,
  geometry: { layout: 'free', width: 800, height: 600, nodes: [], edges: [] },
  semantic: { files: [] },
});

const FEATS = ['full', 'strip', 'nobf'];
const renders = {};
for (const f of FEATS) {
  saveDSL(MIN(f));
  renders[f] = renderLiveFromDb(f);
}

const plan = {};
{
  const r = renders.full;
  const fileN = r?.semantic?.files?.length ?? 0;
  const symN = (r?.semantic?.files ?? []).reduce((a, x) => a + (x.symbols?.length ?? 0), 0);
  const edgeN = r?.geometry?.edges?.length ?? 0;
  console.log(
    `  现渲染（DB）读数：nodes=${r?.geometry?.nodes?.length} · edges=${edgeN} · files=${fileN} · symbols=${symN}`,
  );
  chk(
    r != null && fileN >= 3 && symN >= 3 && edgeN >= 1,
    '0 夹具可用：`renderLiveFromDb` 从**夹具自己的 cache.db** 渲出了一份带 symbols/lines/edges 的图',
    `files=${fileN} · symbols=${symN} · edges=${edgeN}`,
  );
}

/** 剥字段：删每个文件的 `symbols`/`lines`，并删整个 `geometry.edges`。 */
const stripFacts = (dsl, { mark }) => {
  const out = JSON.parse(JSON.stringify(dsl));
  for (const f of out.semantic?.files ?? []) {
    delete f.symbols;
    delete f.lines;
  }
  delete out.geometry.edges;
  if (mark) out._sync = { ...(out._sync ?? {}), facts: 'db' }; // ★ (c) 摘字段时写下的声明
  return out;
};

// ── 三档共用同一份"完整图"（= 现渲染），只差"有没有事实 / 有没有声明"；★ live 少一个文件 ⇒ diff 非平凡
for (const f of FEATS) {
  const base = JSON.parse(JSON.stringify(renders[f]));
  // design：改一个文件的 layer ⇒ `fileChanged` 判 modified（★ 该字段**不在** (c) 的摘除面内 ⇒ 三档一致）
  const design = JSON.parse(JSON.stringify(base));
  if (design.semantic?.files?.[0]) design.semantic.files[0].layer = 'DESIGN_LAYER';
  // live：去掉一个文件（tiny.ts）⇒ `added_files`/符号数在两侧**本就有差**
  const live = JSON.parse(JSON.stringify(base));
  live.semantic.files = (live.semantic.files ?? []).filter((x) => !/tiny\.ts$/.test(x.path));

  if (f === 'full') {
    plan[f] = { design, live };
  } else {
    plan[f] = { design: stripFacts(design, { mark: f === 'strip' }), live: stripFacts(live, { mark: f === 'strip' }) };
  }
}
{
  const d = plan.strip.design;
  const anyFacts = (d.semantic.files ?? []).some((x) => x.symbols !== undefined || typeof x.lines === 'number');
  chk(
    !anyFacts && d.geometry.edges === undefined && d._sync?.facts === 'db',
    '0-b ★ 夹具确凿：`strip` 档**确实剥掉了** signals/lines/edges 三字段，且带 `_sync.facts="db"`',
    `hasAnyFacts=${anyFacts} · edges=${d.geometry.edges === undefined ? 'undefined' : 'present'} · _sync.facts=${d._sync?.facts}`,
  );
  chk(
    plan.nobf.design._sync?.facts === undefined,
    '0-c ★ 对照档确凿：`nobf` 剥掉同样的字段、但**不声明** `_sync.facts` ⇒ 读取应**逐项退化到改前**',
    `_sync=${JSON.stringify(plan.nobf.design._sync ?? null)}`,
  );
}

/** 每个 feature 落盘：design 走 saveDSL（活态文件 = 它，读入口优先读它）；live 落 `CODE/.agent-io/live/`。 */
const install = (f) => {
  saveDSL(plan[f].design); // ★ 必须最后落 design ⇒ 活态文件 = 本 feature（`getDSL` 优先读活态文件）
  saveLiveFeature(plan[f].live, CODE);
};
for (const f of FEATS) install(f);

// ── 三档各自的读数（★ 每次读前重装，保证活态文件 = 被测 feature）──
const readAll = async (f) => {
  install(f);

  // ① query_feature（★ 经**工具层** getDslHandler = get_dsl）：每条文件的"符号数"
  const tool = await getDslHandler({ feature: f, query: 'dsl', view: 'design' });
  const toolText = tool.text ?? '';
  const symCounts = [...toolText.matchAll(/\[(\S+)\] (\S+) \([^)]*?(\d+) API, (\d+) 符号\)/g)].map((m) => [
    m[2],
    Number(m[4]),
  ]);
  const totalSym = symCounts.reduce((a, x) => a + x[1], 0);

  // ① query_feature 另一条（`file` 档）：符号表里的**名字**
  const detail = queryFeature({ feature: f, query: 'file', file_id: 'file_src_alpha_ts', view: 'design' });
  const symNames = [...String(detail.message).matchAll(/^\s+\d+\.\s+(\w+):\s+(\S+)/gm)].map((m) => m[2]);

  // ② derive_mind_map：`isHuskFile((f.lines??999)>=10)` 过滤后的**文件节点集合**
  const mm = await deriveMindMap({ feature: f, gen_descriptions: false, view: 'structure' });
  const fileNodes = [];
  const walk = (n) => {
    if (!n) return;
    if (n.kind === 'file') fileNodes.push(n.id || n.label);
    for (const c of n.children ?? []) walk(c);
  };
  walk(mm.mind_map?.root);
  fileNodes.sort();

  // ③ diff_views：`design_symbols` / `live_symbols` / `added_files` / `modified_files`
  const dv = diffViews({ feature: f });
  const s = dv.data?.summary ?? {};
  const diffSum = {
    design_files: s.design_files,
    live_files: s.live_files,
    added_files: s.added_files,
    removed_files: s.removed_files,
    modified_files: s.modified_files,
    design_symbols: s.design_symbols,
    live_symbols: s.live_symbols,
  };

  return { totalSym, symCounts, symNames, fileNodes, diffSum, toolIsError: tool.isError === true };
};

const R = {};
for (const f of FEATS) R[f] = await readAll(f);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (x) => JSON.stringify(x);

console.log('\n════ ① ★★ 字段缺席仍拿到数据：`strip` 必须 == `full`（且 `nobf` 退化 = 对照）════');
{
  console.log(`   full  : 符号总数=${R.full.totalSym} · alpha 符号表=${fmt(R.full.symNames)} · 导图文件=${fmt(R.full.fileNodes)}`);
  console.log(`   strip : 符号总数=${R.strip.totalSym} · alpha 符号表=${fmt(R.strip.symNames)} · 导图文件=${fmt(R.strip.fileNodes)}`);
  console.log(`   nobf  : 符号总数=${R.nobf.totalSym} · alpha 符号表=${fmt(R.nobf.symNames)} · 导图文件=${fmt(R.nobf.fileNodes)}`);

  chk(
    R.full.totalSym > 0 && eq(R.strip.symCounts, R.full.symCounts),
    '①-a ★【消费点 1 · query_feature 的符号数（走工具层 get_dsl）】`strip`（剥掉 symbols）**逐项等于** `full`',
    `full=${fmt(R.full.symCounts)}\n     strip=${fmt(R.strip.symCounts)}`,
  );
  chk(
    !eq(R.nobf.symCounts, R.full.symCounts),
    '①-a\' ★ 对照：`nobf`（不声明 ⇒ 不补齐）符号数**退化**（全 0）⇒ 证明 ①-a 的相等**来自本笔的补齐**，不是本来就有',
    `nobf=${fmt(R.nobf.symCounts)}`,
  );
  chk(
    R.full.symNames.length > 0 && eq(R.strip.symNames, R.full.symNames),
    '①-b ★【消费点 1-b · query_feature 的"符号表"名字】`strip` **逐项等于** `full`',
    `full=${fmt(R.full.symNames)} · strip=${fmt(R.strip.symNames)}`,
  );
  chk(
    !eq(R.nobf.fileNodes, R.full.fileNodes) && eq(R.strip.fileNodes, R.full.fileNodes),
    '①-c ★【消费点 2 · derive_mind_map 的 lines 过滤】`strip` 的**文件节点集合**等于 `full`（合取：微型文件仍被滤掉）；`nobf` 多出它',
    `full=${fmt(R.full.fileNodes)}\n     strip=${fmt(R.strip.fileNodes)}\n     nobf =${fmt(R.nobf.fileNodes)}`,
  );
  chk(
    R.full.diffSum.design_symbols > 0 && eq(R.strip.diffSum, R.full.diffSum),
    '①-d ★【消费点 3 · diff_views 的符号数/文件增删】`strip` 的 summary **逐项等于** `full`',
    `full=${fmt(R.full.diffSum)}\n     strip=${fmt(R.strip.diffSum)}`,
  );
  chk(
    !eq(R.nobf.diffSum, R.full.diffSum),
    '①-d\' ★ 对照：`nobf` 的 summary **退化**（design_symbols/live_symbols 掉到 0）⇒ 证明本笔在起作用',
    `nobf=${fmt(R.nobf.diffSum)}`,
  );
  chk(
    R.strip.toolIsError === false && R.full.totalSym > 0,
    '② ★ 走工具层：`get_dsl`（`getDslHandler`，`wrapData`）对 `strip` 档**正常返回**（无 isError），且它给出的符号数非空',
    `toolIsError=${R.strip.toolIsError} · strip 符号总数=${R.strip.totalSym}`,
  );
}

console.log('\n════ ③ ★★ 文件在位 ⇒ 行为逐项不变（"没声明"= 改前的一条）════');
{
  // `nobf` 档 = "字段缺席但**不声明**" —— 等价于"改前那份 DSL 本来就没有这些字段"
  // ⇒ 读取入口对它**一个字都不改**：拿到的就是原样的 0 符号 / 无 lines / 无 edges。
  const dslNobf = plan.nobf.design;
  const rawShape = {
    symbolsPresent: (dslNobf.semantic?.files ?? []).some((x) => x.symbols !== undefined),
    linesPresent: (dslNobf.semantic?.files ?? []).some((x) => typeof x.lines === 'number'),
    edgesPresent: dslNobf.geometry?.edges !== undefined,
  };
  chk(
    R.nobf.totalSym === 0 && R.nobf.symNames.length === 0 && !rawShape.symbolsPresent && !rawShape.linesPresent && !rawShape.edgesPresent,
    '③ ★ 不声明 ⇒ **读取入口不改一字**：`nobf` 的读数与它文件里的字段形状**完全一致**（0 符号 / 无 lines / 无 edges）',
    `nobf.totalSym=${R.nobf.totalSym} · symNames=${R.nobf.symNames.length} · 文件形状=${JSON.stringify(rawShape)}`,
  );
  console.log(
    '   ★ 说明：真仓 `live/self-2026-10-15.dsl.json` 与 `features/self-2026-10-15.json` **均无 `_sync.facts`**' +
      '\n     ⇒ 走的就是本档这条"不改一字"的路（本证不读真仓，只声明接入口径）。',
  );
}

// ★★ 清理：本证只此 1 次删除；失败响亮报告（宿主删除闸 ≠ 本证判红）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
