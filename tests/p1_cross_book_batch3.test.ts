/**
 * P1 · T-#A8A9-CROSS-BOOK **批 3**（A 类空壳第二段：50 个 path，删计划册侧节点，**0 搬运**）—— 红 → 绿。
 *
 * ## 这批要立的六条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 3.1 | 50 个 path **各恰一册**持有，且是 `agent-io`；计划册侧节点 / 语义 / 边全没了 | 半删（幽灵节点、悬空边）在这里红 |
 * | 3.2 | 判据**总数守恒**（A 类零负载 ⇒ 822 一条不动） | 删错一侧（删到有判据的那侧）立刻少几条 |
 * | 3.3 | 清单就是**批 3 的清单**（字典序接批 2 的第 51–100 个 · 39 application + 11 infrastructure） | 手抄错一条 / 顺序漂了都在这里红 |
 * | 3.3b | 词典窗口里那 2 个**带卡**的 path 没被偷偷收进本批（它们要人判，留账） | 把 `discussion_log.ts` 混进来 ⇒ 这里红（A 类定义是 0 卡） |
 * | 3.4 | ② 档：这 50 个 path 的 klass = `owned`；把它们塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 3.5 | 写端：删完之后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是"一刀切"） |
 * | 3.6 | 门档：多册持有 358 → 308（−50）；三组集合指纹与 `design-books-baseline.json` 逐字一致 | 谁改了册而不改基线，这里红（**钉的是棘轮 ≤308 与 358−308=50**，不是"当前值 = 308"） |
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
 * 批 3 的 50 个 path（**剩余**严格 A 类空壳的字典序前 50；批 2 收掉了整段的前 50）。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（3.1/3.4/3.5）就无处可断。
 */
const PATHS = [
  'src/application/design/lifecycle/snapshot.ts',
  'src/application/design/no_file_entries.ts',
  'src/application/design/workbench/dag_layout.ts',
  'src/application/meta/diagnosis/diagnose_loop.ts',
  'src/application/meta/docs/project_docs.ts',
  'src/application/meta/explore/explore_code.ts',
  'src/application/meta/explore/first_hop_args.ts',
  'src/application/meta/explore/next_hop_args.ts',
  'src/application/meta/impact/impact_report.ts',
  'src/application/meta/upgrade/upgrade.ts',
  'src/application/meta/view/derive_anim_flow.ts',
  'src/application/meta/view/derive_mind_map.ts',
  'src/application/meta/view/explain_gen.ts',
  'src/application/meta/view/overview.ts',
  'src/application/observe/capture/feature_line.ts',
  'src/application/observe/capture/memory_observe.ts',
  'src/application/observe/capture/observe_points.ts',
  'src/application/observe/capture/observe_trace.ts',
  'src/application/observe/capture/trace_evidence.ts',
  'src/application/observe/handlers.ts',
  'src/application/observe/reconcile/reconcile_chain.ts',
  'src/application/observe/reconcile/reconcile_effects.ts',
  'src/application/refactor/annotate/function_annotation.ts',
  'src/application/refactor/deprecate_offline/deprecate_offline.ts',
  'src/application/refactor/edit/apply_writes.ts',
  'src/application/refactor/find/ast_suggest.ts',
  'src/application/refactor/find/find_references.ts',
  'src/application/refactor/find/similar_names.ts',
  'src/application/refactor/parse_capability/parse_capability.ts',
  'src/application/refactor/pipeline/refactor_judge.ts',
  'src/application/refactor/pipeline/refactor_pipeline.ts',
  'src/application/refactor/rename/move_domain.ts',
  'src/application/refactor/rename/rename_files.ts',
  'src/application/refactor/rename/rename_local.ts',
  'src/application/refactor/rename/rename_symbols.ts',
  'src/application/refactor/rename/symbol_move.ts',
  'src/application/refactor/rule_library/rule_apply.ts',
  'src/application/refactor/rule_library/rule_extract.ts',
  'src/application/refactor/rule_library/rule_library.ts',
  'src/infrastructure/alert_inbox.ts',
  'src/infrastructure/analysis/capability/capability_matrix.ts',
  'src/infrastructure/analysis/capability/language_concepts.ts',
  'src/infrastructure/analysis/capability/register_capabilities.ts',
  'src/infrastructure/analysis/contract_gate/index.ts',
  'src/infrastructure/analysis/contract_gate/languages/c.ts',
  'src/infrastructure/analysis/contract_gate/languages/cs.ts',
  'src/infrastructure/analysis/contract_gate/languages/go.ts',
  'src/infrastructure/analysis/contract_gate/languages/java.ts',
  'src/infrastructure/analysis/contract_gate/languages/py.ts',
  'src/infrastructure/analysis/contract_gate/languages/registry.ts',
];

/**
 * 批 3 的界外（**故意不收**）：A 类定义里唯一的两条"带卡"path。
 * 它们落在本批的字典序窗口里（`discussion_log.ts` 正好在第 40 位），但两张 `candidate` 卡说明还有人在等结论
 * ⇒ 按批 2 §3.1 的留账，逐条人判，不在本批直删。
 */
const DEFERRED_WITH_CARDS = ['src/domain/discussion_log.ts', 'src/presentation/cli/cli.ts'];

/** 批 3 的判据守恒读数（A 类零负载 ⇒ 删 50 个节点，一条判据都不动） */
// ★ 2026-11-18：822 → 826 —— globals-fix 两卡合法 +4（merge b7b89f24）；批 6 后 lead 又将其中 2 条
//   迁回属主册 tsp（一 path 一册断言不变量，batch1 1.3 实测冲突修复），总数不变分册变。
// ★ 2026-11-18（EEP 真修复链）：826 → 839 —— 19 个被吞 gap 的 triage 给 13 个活源码文件补了 13 条 file-exists 出处判据（T-#EXCLUDED-EMPTY-PATH 真修复），合法新增。
const CRITERIA_TOTAL = 839;
/**
 * `多册持有`：批 2 收口 358 → 批 3 再收 50 = **308**。
 * ★ 308 是**上限**（棘轮），不是"永远等于"：批 4 起它会继续往下走（批 3 交付书 §3.2 的双 Δ 判据）。
 *   会漂的"当前值"不许钉进证里 —— 批 2 的证钉过 358，批 3 落地就把那条打红了（本补丁顺手改成棘轮）。
 */
const MULTI_OWNED_BEFORE_B3 = 358;
const MULTI_OWNED_AFTER_B3 = 308;

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
// 3.1 50 个 path 各恰一册持有（agent-io），计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('3.1 真仓：50 个 path 各自**恰一册**持有，且持有者是 agent-io（批 3 前是两册各一节点）', () => {
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

test('3.1b 计划册里这 50 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
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
  // 别的册同样不许留这些 id（属主册除外）
  for (const s of repoSheets()) {
    const ids = new Set(nodesOf(s).map((n) => String(n.id)));
    for (const id of deletedIds) assert.ok(!ids.has(id) || s.feature === AI, `${s.feature} 册里不该再有节点 \`${id}\`（它只该在 ${AI} 册里）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 3.2 判据总数守恒
// ════════════════════════════════════════════════════════════════════
test('3.2 判据总数守恒：三册合计 822 条（A 类零负载 ⇒ 删 50 个节点一条判据不动）', () => {
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaTotal([s])}`).join(' · ');
  assert.equal(
    criteriaTotal(sheets),
    CRITERIA_TOTAL,
    `删节点不许带走判据（实测 ${per}）。若某批之后总数合法地变了，改这里是显式动作，不是让它漂`,
  );
  const holdings = bookHoldings(sheets);
  for (const p of PATHS) {
    for (const h of holdings.get(p) ?? []) {
      assert.equal(h.expectations, 0, `\`${p}\` 在 ${h.feature} 册上不该有判据（实测 ${h.expectations} 条）`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════
// 3.3 清单就是批 3 的清单
// ════════════════════════════════════════════════════════════════════
test('3.3 清单形状：50 条 · 无重复 · 字典序已排好 · 39 application + 11 infrastructure', () => {
  assert.equal(PATHS.length, 50, `批 3 是 50 个 path（≤50 的硬上限，实测 ${PATHS.length}）`);
  assert.equal(new Set(PATHS).size, PATHS.length, '清单不许有重复 path');
  assert.deepEqual([...PATHS].sort(), PATHS, '清单必须按字典序（"第二段"的定义就是接在批 2 之后的前缀，顺序漂了就不是同一段）');
  // 字典序接批 2：批 2 的末位是 `src/application/design/lifecycle/simulation.ts`，本批首位必须排在它之后
  assert.ok(PATHS[0] > 'src/application/design/lifecycle/simulation.ts', `本批首位必须接在批 2 末位之后（实测 ${PATHS[0]}）`);
  const bucket = (p: string) => {
    if (p.startsWith('src/application/')) return p.split('/').slice(0, 3).join('/') + '/';
    if (p.startsWith('src/infrastructure/analysis/')) return 'src/infrastructure/analysis/';
    return 'src/infrastructure/';
  };
  const hist: Record<string, number> = {};
  for (const p of PATHS) hist[bucket(p)] = (hist[bucket(p)] ?? 0) + 1;
  assert.deepEqual(
    hist,
    {
      'src/application/design/': 3,
      'src/application/meta/': 11,
      'src/application/observe/': 8,
      'src/application/refactor/': 17,
      'src/infrastructure/analysis/': 10,
      'src/infrastructure/': 1,
    },
    `目录分布：${JSON.stringify(hist)}`,
  );
});

test('3.3b 界外：两条**带卡**的 A 类 path 没被收进本批，仍是两册持有（留给人判，不是漏）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of DEFERRED_WITH_CARDS) {
    assert.ok(!PATHS.includes(p), `\`${p}\` 带 candidate 卡 ⇒ 不属于"0 卡"的 A 类，不许混进本批清单`);
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    // ★ 2026-11-18（批 10 · 甲′）：这两条 A 类带卡空壳进了 `PROSE_KEEP_OWNER` 显式名单 ⇒ 计划册侧节点已删、
    //   败方散文逐字进台账存档。本判据的牙换成**两态择一**：要么仍是两册持有（界外未收），要么已收干净
    //   （恰一册 = 属主册）。半收（0 册 / 册数 > 2 / 收给了别人）照样红。
    assert.ok(
      feats.length === 2 || (feats.length === 1 && feats[0] === AI),
      `\`${p}\` 要么仍是两册持有（界外未收），要么已收成单册属主；实测 ${feats.join(' / ') || '无人持有'}`,
    );
  }
  // 其中 `discussion_log.ts` 的域表属主曾是计划册 ⇒ 批 10 的甲′ 先把它改判给 agent-io 再收（改判与删节点同批落地）
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/domain/discussion_log.ts').owner, AI, '这条 path 的域表属主：批 10 已改判给本体册（甲′：终态属主 = agent-io）');
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/presentation/cli/cli.ts').owner, AI, '这条 path 的域表属主是本体册（带卡的那一侧在属主册 ⇒ 更不能直删）');
});

// ════════════════════════════════════════════════════════════════════
// 3.4 ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('3.4 ② 档：这 50 个 path 的 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
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
  const hit = ownerOf(read.table as DesignBooksTable, p0);
  assert.equal(hit.owner, AI, `\`${p0}\` 的属主必须仍是 ${AI}（实测 ${hit.owner}）`);
});

// ════════════════════════════════════════════════════════════════════
// 3.5 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('3.5 写端：批 3 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export const x = 1;\n', 'utf8');
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
    sheet(AI, [{ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' }]);
    sheet(TSP, [{ id: 'file_src_y_ts', label: 'y.ts', type: 'file', x: 0, y: 0, path: 'src/y.ts' }]);
    registerFeature(AI, proj, 'test');
    registerFeature(TSP, proj, 'test');

    const tspFile = path.join(dir, `${TSP}.dsl.json`);
    const tsp = JSON.parse(fs.readFileSync(tspFile, 'utf8'));
    tsp.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const before = fs.readFileSync(tspFile, 'utf8');
    assert.throws(
      () => saveDSL(tsp, 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|not_owner|已由|属主/,
      '非属主册再建节点必须**前置拒**（否则批 3 的删除是可逆的，13 批都白做）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    ai.geometry.nodes[0].decision = { expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '属主册写自己的 path 必须放行' }] };
    saveDSL(ai, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    assert.equal(after.geometry.nodes[0].decision.expectations.length, 1, '属主册加判据必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 3.6 新门档：多册持有 ≤ 308（批 3 收 −50：358 → 308），且指纹与基线逐字一致
// ════════════════════════════════════════════════════════════════════
test('3.6 门档：多册持有只许不增（批 3 收口 308 = 358 − 50）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  // ★ 棘轮（只许不增），不钉"当前值"：批 4 起这个数会继续往下走（308 → … → 0），那是批计划的账，不是本批的回退
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B3,
    `多册持有只许不增（批 3 收口 ${MULTI_OWNED_AFTER_B3}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：358 − 308 = 50 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B3 - MULTI_OWNED_AFTER_B3, PATHS.length, '批 3 的降幅必须逐字等于本批 path 数（A 类零例外）');
  for (const p of PATHS) assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
  // 另两笔账本批一位不该动（属主错位归批 14，id 漂移归批 15 / T-#NODE-ID-DRIFT）
  // ★ 2026-11-18：这两条从"等于"改成**棘轮**（只许不增）—— 批 8 删掉的 25 个计划册节点里有 7 个是存量异 id
  //   （随节点消失，不是改名）⇒ id 漂移 31 → 24。等于号是"批 3 收口那一刻"的读数，钉它会挡住后续批计划。
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 14 处理）：实测 ${now.owner_mismatch.length}`);
  assert.ok(now.id_drift.length <= 31, `id 漂移只许不增（本批不改名）：实测 ${now.id_drift.length}`);
});
