/**
 * P1 · T-#A8A9-CROSS-BOOK **批 2**（A 类空壳第一段：50 个 path，删计划册侧节点，**0 搬运**）—— 红 → 绿。
 *
 * ## 这批要立的五条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 2.1 | 50 个 path **各恰一册**持有，且是 `agent-io`；计划册侧节点 / 语义 / 边全没了 | 半删（幽灵节点、悬空边）在这里红 |
 * | 2.2 | 判据**总数守恒**（A 类零负载 ⇒ 822 一条不动） | 删错一侧（删到有判据的那侧）立刻少几条 |
 * | 2.3 | 清单就是**批 2 的清单**（字典序前 50 · 4 dogfood + 41 scripts + 5 src） | 手抄错一条 / 顺序漂了都在这里红 |
 * | 2.4 | ② 档：这 50 个 path 的 klass = `owned`；把它们塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 2.5 | 写端：删完之后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是"一刀切"） |
 *
 * ## 纪律（本仓 0.14 / R47）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 50 个 path 恰一册持有"·"判据总数守恒"），
 *   **不断**会随批下降的单册读数（`tsp` 的 206 条在批 9–13 会继续降，那不是本批的账）；
 * · 门档断的是**集合指纹与基线逐字一致**（谁改了册而不改基线，这里红），不是"多册持有 = 0"（那是批 13 之后的终局）。
 * · 夹具一律落 `%TEMP%`（`AGENT_IO_HOME` 指到临时目录），绝不动仓里的 `src/` `dist/` `tests/`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import {
  bookHoldings,
  crossBookOwnership,
  ownerOf,
  readDesignBooks,
  type BookSheetLike,
  type DesignBooksTable,
} from '../src/infrastructure/design_books.js';
import { nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { saveDSL, readDesignSheetsForGate } from '../src/infrastructure/storage.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { crossBookReadingOf } from '../src/application/design/db/gen_design_db.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';

/**
 * 批 2 的 50 个 path（字典序前 50 个 A 类空壳）。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（2.1/2.4/2.5）就无处可断。
 */
const PATHS = [
  'dogfood/build_cache.mjs',
  'dogfood/check_cache.mjs',
  'dogfood/verify_space_bug.mjs',
  'dogfood/verify_spec_form.mjs',
  'scripts/check-receipt.mjs',
  'scripts/demo.mjs',
  'scripts/dev.mjs',
  'scripts/diff_language_rosters.py',
  'scripts/freeze_grammar_sources.py',
  'scripts/gen_cognition.mjs',
  'scripts/gen_endpoints_schema.mjs',
  'scripts/gen_teach.cjs',
  'scripts/grammar_shim.mjs',
  'scripts/hub.mjs',
  'scripts/install_global_skill.mjs',
  'scripts/mcp/mcp_call.mjs',
  'scripts/mcp/mcp_scan.mjs',
  'scripts/mcp/mcp_smoke.mjs',
  'scripts/measure_b_contract.mjs',
  'scripts/merge_language_roster.py',
  'scripts/net_probe.mjs',
  'scripts/new-observe-lang.mjs',
  'scripts/plan-assertions.mjs',
  'scripts/probe_cc_equiv.mjs',
  'scripts/probe_closure_multi.mjs',
  'scripts/probe_demand_side.mjs',
  'scripts/probe_edge_diff.mjs',
  'scripts/probe_extract_hard.mjs',
  'scripts/probe_extract_quality.mjs',
  'scripts/probe_impact_reverse.mjs',
  'scripts/probe_tool_smells.mjs',
  'scripts/probe_tool_surface.mjs',
  'scripts/probe_verdict_grid.mjs',
  'scripts/probe_xfile_resolve.mjs',
  'scripts/promote_agent_io_mcp.mjs',
  'scripts/rebuild_feature.mjs',
  'scripts/rebuild_teach.cjs',
  'scripts/relink_specifiers.mjs',
  'scripts/run-invariant-checks.mjs',
  'scripts/scan_canvas.ts',
  'scripts/setup.mjs',
  'scripts/task-system-static.mjs',
  'scripts/ts_kernel_probe.mjs',
  'scripts/verify_grammar_rebuild.mjs',
  'scripts/vocabulary.mjs',
  'src/application/design/derive/derive_algorithm.ts',
  'src/application/design/derive/derive_chain.ts',
  'src/application/design/derive/opl.ts',
  'src/application/design/intent/set_design_intent.ts',
  'src/application/design/lifecycle/simulation.ts',
];

/** 批 2 的判据守恒读数（A 类零负载 ⇒ 删 50 个节点，一条判据都不动） */
// ★ 2026-11-18：822 → 826 —— globals-fix 两卡合法 +4（merge b7b89f24）；批 6 后 lead 又将其中 2 条
//   迁回属主册 tsp（一 path 一册断言不变量，batch1 1.3 实测冲突修复），总数不变分册变。
// ★ 2026-11-18（EEP 真修复链）：826 → 839 —— 19 个被吞 gap 的 triage 给 13 个活源码文件补了 13 条 file-exists 出处判据（T-#EXCLUDED-EMPTY-PATH 真修复），合法新增。
const CRITERIA_TOTAL = 839;
/** 批 2 之前的 `多册持有` 读数（recon 414 → 批 1 收 6 → 批 2 前 408；批 2 收 50） */
const MULTI_OWNED_BEFORE_B2 = 408;
/**
 * 批 2 收口时的 `多册持有` 读数（358）= **上限**，不是"当前值"。
 * ★ 2026-11-17（批 3 实证）：这里原先钉的是"必须恰好 358"，批 3 一落地它就红（358 → 308）——
 *   而那不是缺陷，是本卡的批计划在往前走。**批的证只能钉不变量**：本批的 50 个 path 不再出现在
 *   多册持有集合里（永久成立）+ 总数只许不增（棘轮）+ 408 − 358 = 50（历史算术，不随批漂）。
 *   会随批下降的"当前值"归当批的证去钉（批 3 那 308 在 `p1_cross_book_batch3.test.ts` 里）。★
 */
const MULTI_OWNED_AFTER_B2 = 358;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const nodesOf = (s: BookSheetLike) => (s.geometry?.nodes ?? []) as Array<Record<string, unknown>>;

function repoSheets(): Array<BookSheetLike & { feature: string }> {
  return readDesignSheetsForGate(REPO).sheets as unknown as Array<BookSheetLike & { feature: string }>;
}
function bookOf(feature: string): BookSheetLike & { feature: string } {
  const s = repoSheets().find((x) => x.feature === feature);
  assert.ok(s, `真仓必须有 ${feature} 册（读数不许靠猜）`);
  return s;
}
function criteriaTotal(sheets: readonly BookSheetLike[]): number {
  let n = 0;
  for (const s of sheets) for (const node of nodesOf(s)) n += ((node.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length;
  return n;
}
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

// ════════════════════════════════════════════════════════════════════
// 2.1 50 个 path 各恰一册持有（agent-io），计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('2.1 真仓：50 个 path 各自**恰一册**持有，且持有者是 agent-io（批 2 前是两册各一节点）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of PATHS) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.equal(feats.length, 1, `\`${p}\` 必须恰一册持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(feats[0], AI, `\`${p}\` 的持有册必须是 ${AI}（实测 ${feats[0]}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个：${hs.map((h) => h.node).join(',')}）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
  }
});

test('2.1b 计划册里这 50 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
  const tsp = bookOf(TSP) as unknown as {
    geometry?: { nodes?: Array<Record<string, unknown>>; edges?: Array<{ from?: string; to?: string }> };
    semantic?: { files?: Array<{ id?: string; path?: string }> };
  };
  const deletedIds = PATHS.map((p) => nodeIdOf(p));
  for (const p of PATHS) {
    assert.equal((tsp.geometry?.nodes ?? []).filter((n) => norm(n.path) === p).length, 0, `计划册里不该再有 \`${p}\` 的节点`);
    assert.equal((tsp.semantic?.files ?? []).filter((f) => norm(f.path) === p).length, 0, `计划册的 semantic.files 里不该再有 \`${p}\``);
  }
  const dangling = (tsp.geometry?.edges ?? []).filter((e) => deletedIds.includes(String(e.from)) || deletedIds.includes(String(e.to)));
  assert.deepEqual(dangling, [], `计划册里不该留悬空边（实测 ${dangling.length} 条）`);
  // 别的册同样不许留这些 id
  for (const s of repoSheets()) {
    const ids = new Set(nodesOf(s).map((n) => String(n.id)));
    for (const id of deletedIds) assert.ok(!ids.has(id) || s.feature === AI, `${s.feature} 册里不该再有节点 \`${id}\`（它只该在 ${AI} 册里）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 2.2 判据总数守恒
// ════════════════════════════════════════════════════════════════════
test('2.2 判据总数守恒：三册合计 822 条（A 类零负载 ⇒ 删 50 个节点一条判据不动）', () => {
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaTotal([s])}`).join(' · ');
  assert.equal(
    criteriaTotal(sheets),
    CRITERIA_TOTAL,
    `删节点不许带走判据（实测 ${per}）。若某批之后总数合法地变了，改这里是显式动作，不是让它漂`,
  );
  // 每一条批 2 的 path 上（属主侧）都不该因此多出判据 —— 本批是"删空壳"，不是"清判据"
  const holdings = bookHoldings(sheets);
  for (const p of PATHS) {
    const hs = holdings.get(p) ?? [];
    for (const h of hs) assert.equal(h.expectations, 0, `\`${p}\` 在 ${h.feature} 册上不该有判据（实测 ${h.expectations} 条）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 2.3 清单就是批 2 的清单
// ════════════════════════════════════════════════════════════════════
test('2.3 清单形状：50 条 · 无重复 · 字典序已排好 · 目录分布 4 dogfood + 41 scripts + 5 src', () => {
  assert.equal(PATHS.length, 50, `批 2 是 50 个 path（≤50 的硬上限，实测 ${PATHS.length}）`);
  assert.equal(new Set(PATHS).size, PATHS.length, '清单不许有重复 path');
  assert.deepEqual([...PATHS].sort(), PATHS, '清单必须按字典序（"第一段"的定义就是字典序前缀，顺序漂了就不是同一段）');
  const hist: Record<string, number> = {};
  for (const p of PATHS) {
    const key = p.startsWith('src/') ? 'src/application/design/' : `${p.split('/')[0]}/`;
    hist[key] = (hist[key] ?? 0) + 1;
  }
  assert.deepEqual(hist, { 'dogfood/': 4, 'scripts/': 41, 'src/application/design/': 5 }, `目录分布：${JSON.stringify(hist)}`);
});

// ════════════════════════════════════════════════════════════════════
// 2.4 ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('2.4 ② 档：这 50 个 path 的 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  const byPath = new Map(now.rows.map((r) => [r.path, r]));
  for (const p of PATHS) {
    const row = byPath.get(p);
    assert.ok(row, `② 档必须逐条点名 \`${p}\`（rows 里没有它）`);
    assert.equal(row.klass, 'owned', `\`${p}\` 必须是 owned（实测 ${row.klass}）`);
    assert.equal(row.owner, AI, `\`${p}\` 的域表属主必须是 ${AI}（实测 ${row.owner}）`);
    assert.deepEqual([...new Set(row.holders.map((h) => h.feature))], [AI], `\`${p}\` 只该有一个持有者`);
  }
  // 分母还在（0.12：分子必须带分母）
  assert.equal(now.paths, 555, `path 分母不该被删节点改动（实测 ${now.paths}）`);
  assert.equal(now.books, 3, `册数不变（实测 ${now.books}）`);

  // ── 世界二：给计划册再造一个同 path 的空节点 ⇒ 这个 path 立刻变 multi_owned，且计数 +1 ──
  const p0 = PATHS[0] as string;
  const twoWorld = sheets.map((s) =>
    s.feature === TSP
      ? {
          feature: s.feature,
          geometry: {
            nodes: [...nodesOf(s), { id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }],
          },
        }
      : s,
  );
  const two = crossBookOwnership(twoWorld, read);
  const row2 = two.rows.find((r) => r.path === p0);
  assert.equal(row2?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned（实测 ${row2?.klass}）`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
  // 属主判定不因"有没有节点"而变（这是域表的独立性：删除不改变属主，只改变谁持有）
  const hit = ownerOf(read.table as DesignBooksTable, p0);
  assert.equal(hit.owner, AI, `\`${p0}\` 的属主必须仍是 ${AI}（实测 ${hit.owner}）`);
});

// ════════════════════════════════════════════════════════════════════
// 2.5 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('2.5 写端：批 2 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export const x = 1;\n', 'utf8');
    // 域表：agent-io 持 src/（前缀）；计划册**一条都不持**（批 2 之后它的域与这些 path 无关）
    fs.writeFileSync(
      path.join(proj, 'design-books.json'),
      JSON.stringify({ note: 'fixture', books: [{ feature: AI, owns: ['src/'] }], unowned: [] }, null, 2),
      'utf8',
    );
    const dir = path.join(proj, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    const sheet = (feature: string, nodes: Array<Record<string, unknown>>) =>
      fs.writeFileSync(
        path.join(dir, `${feature}.dsl.json`),
        JSON.stringify({ feature, title: feature, source_root: proj, geometry: { nodes, edges: [] }, semantic: { files: [] } }, null, 2),
        'utf8',
      );
    // 批 2 之后的状态：属主册有节点（带 0 条判据 = 空壳），计划册没有
    sheet(AI, [{ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' }]);
    sheet(TSP, [{ id: 'file_src_y_ts', label: 'y.ts', type: 'file', x: 0, y: 0, path: 'src/y.ts' }]);
    registerFeature(AI, proj, 'test');
    registerFeature(TSP, proj, 'test');

    // 世界一：计划册想把空壳塞回去（不显式换手）⇒ 拒
    const tsp = JSON.parse(fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8'));
    tsp.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const before = fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8');
    assert.throws(
      () => saveDSL(tsp, 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|not_owner|已由|属主/,
      '非属主册再建节点必须**前置拒**（否则批 2 的删除是可逆的，41 批都白做）',
    );
    assert.equal(fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8'), before, '被拒的写不许留下任何痕迹');

    // 世界二：属主册给同一个 path 加一条判据 ⇒ 过（不是"一刀切"）
    const ai = JSON.parse(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8'));
    ai.geometry.nodes[0].decision = { expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '属主册写自己的 path 必须放行' }] };
    saveDSL(ai, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8'));
    assert.equal(after.geometry.nodes[0].decision.expectations.length, 1, '属主册加判据必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 2.6 新门档：多册持有 ≤ 358（批 2 收 −50：408 → 358），且指纹与基线逐字一致
// ════════════════════════════════════════════════════════════════════
test('2.6 门档：多册持有只许不增（批 2 收口 358 = 408 − 50）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  // ★ 棘轮（只许不增），不钉"当前值"：批 3 起这个数会继续往下走（358 → 308 → … → 0），那是批计划的账，不是本批的回退
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B2,
    `多册持有只许不增（批 2 收口 ${MULTI_OWNED_AFTER_B2}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：408 − 358 = 50 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B2 - MULTI_OWNED_AFTER_B2, PATHS.length, '批 2 的降幅必须逐字等于本批 path 数（A 类零例外）');
  for (const p of PATHS) assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key];
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
  // 另两笔账本批一位不该动（属主错位归批 14，id 漂移归批 15 / T-#NODE-ID-DRIFT）
  // ★ 2026-11-18：这两条从"等于"改成**棘轮**（只许不增）—— 批 8 删掉的 25 个计划册节点里有 7 个是存量异 id
  //   （随节点消失，不是改名）⇒ id 漂移 31 → 24。等于号是"批 2 收口那一刻"的读数，钉它会挡住后续批计划。
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 14 处理）：实测 ${now.owner_mismatch.length}`);
  assert.ok(now.id_drift.length <= 31, `id 漂移只许不增（本批不改名）：实测 ${now.id_drift.length}`);
});
