/**
 * P1 · T-#A8A9-CROSS-BOOK **批 1**（registry 6 path 换手到 `agent-io-toolface`）—— 红 → 绿。
 *
 * ## 这批要立的七条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 1.1 | 6 个 registry path **各恰一册**持有，且是 `agent-io-toolface` | 三册各一节点 → 一册一节点；败方册的节点/语义/边一起没了 |
 * | 1.2 | 判据**一条不丢**（9 条：agent-io 6 + 计划册 3），逐条带「原住」出处 | 内容仍在（kind + 特征串）· 出处逐条可点名 |
 * | 1.2b | 散文不丢：被删节点上的 `rationale` / `acceptance` / `consequences` | 在接管节点上仍能读到原文 |
 * | 1.3 | **断言档**（`gen-db-check` ⑦ 同一把尺）：一个 path 只许一册断言 | 真仓 0 条；把"断言别处"的判据搬进本册 ⇒ 立刻 1 条（鉴别力） |
 * | 1.4 | ② 档：这 6 个 path 的 klass 由 `multi_owned` 变 `owned` | 逐条点名，且不硬编码"408"这种会随批下降的总数 |
 * | 1.5 | 写端：换手之后**败方册再想给这个 path 建节点 ⇒ 拒** | 真 `saveDSL`（夹具三册）· 被拒时盘上零字节变化 |
 * | 1.6 | 本批**刻意不改 id**：toolface 的 6 个手写 id 仍在册上 | 改名归批 15 / `T-#NODE-ID-DRIFT`（改名的代价见交付书 §5） |
 *
 * ## 纪律（本仓 0.14 / R47）
 * · 每条判据都造**两个世界**（换手前 / 换手后、本册断言 / 另一册断言），结论必须不同；
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 6 个 path 恰一册持有"），**不断**会随批下降的总数；
 * · 夹具一律落 `%TEMP%`（`AGENT_IO_HOME` 指到临时目录），绝不动仓里的 `src/` `dist/` `tests/`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import {
  bookHoldings,
  crossBookOwnership,
  nodeIdDriftOf,
  ownerOf,
  ownsOf,
  readDesignBooks,
  type BookSheetLike,
  type DesignBooksTable,
} from '../src/infrastructure/design_books.js';
import { nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { saveDSL, readDesignSheetsForGate } from '../src/infrastructure/storage.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { assertedPathsBySheet, crossBookReadingOf, ownershipConflictsOf } from '../src/application/design/db/gen_design_db.js';
import { validateDSL } from '../src/domain/validator.js';

const REPO = process.cwd();
const TF = 'agent-io-toolface';
const AI = 'agent-io';
const TSP = 'task-system-plan';

/** 批 1 的 6 个 path（**逐条精确**；域表里也是逐条精确条目，不是前缀） */
const PATHS = [
  'src/application/meta/registry/capability_map.ts',
  'src/application/meta/registry/cli_extract.ts',
  'src/application/meta/registry/collect_functions.ts',
  'src/application/meta/registry/registry_extract.ts',
  'src/application/meta/registry/sync_contracts.ts',
  'src/application/meta/registry/tool_faces.ts',
];

/**
 * 9 条判据的**身份**（kind + 特征串）：`why` 是判据的载体，特征串取它原文里不会漂的一段。
 * ★ 这不是"第二份权威"—— 判据本体只在册上；本表是**回归钉子**：谁把这几条搬丢/搬错册，这里当场红。
 */
const MOVED = [
  // agent-io → toolface（断言的就是这两条 path 自己）
  // ★ 2026-11-18（批 15）：toolface 的 6 个**手写 id** 已按 `nodeIdOf` 规范化 ——
  //   本表从"手写式"改成"派生式"，判据本体与出处一字未动（批 15 的证 15.13 钉住这件事）。
  { to: 'file_src_application_meta_registry_capability_map_ts', kind: 'run', needle: 'guided_tour', from: AI },
  { to: 'file_src_application_meta_registry_capability_map_ts', kind: 'run', needle: 'design_line action=rules', from: AI },
  { to: 'file_src_application_meta_registry_capability_map_ts', kind: 'source-has', needle: 'LANE_META', from: AI },
  { to: 'file_src_application_meta_registry_capability_map_ts', kind: 'call-exists', needle: 'renderAuthoritiesText', from: AI },
  { to: 'file_src_application_meta_registry_sync_contracts_ts', kind: 'call-exists', needle: 'runDslWriteScope', from: AI },
  { to: 'file_src_application_meta_registry_sync_contracts_ts', kind: 'source-has', needle: "who: 'sync_contracts'", from: AI },
  // 计划册 → **它断言的那个 path 的节点**（断言档：一个 path 只许一册断言）
  // ★ 2026-11-18（批 15）：这 3 条随节点**搬进属主册**（scan_authorities.ts 的属主错位由批 15 收口），
  //   判据与「原住」出处一字未动 ⇒ 本表只换"该去哪册找它"。
  { to: 'file_src_infrastructure_authority_scan_authorities_ts', kind: 'file-exists', needle: 'scan_authorities.ts', from: TSP },
  { to: 'file_src_infrastructure_authority_scan_authorities_ts', kind: 'symbol-exists', needle: 'scanAuthorities', from: TSP },
  { to: 'file_src_infrastructure_authority_scan_authorities_ts', kind: 'symbol-exists', needle: 'parseAuthorityMarks', from: TSP },
];

/** 被删掉的 12 个节点 id（6 path × 2 册） */
const DELETED_IDS = PATHS.flatMap((p) => [nodeIdOf(p)]);

// ───────────────────────────────────────────────────────────────────────────
// 真仓读数（只读）
// ───────────────────────────────────────────────────────────────────────────
function repoSheets(): Array<BookSheetLike & { feature: string }> {
  return readDesignSheetsForGate(REPO).sheets as unknown as Array<BookSheetLike & { feature: string }>;
}
function bookOf(feature: string): BookSheetLike & { feature: string } {
  const s = repoSheets().find((x) => x.feature === feature);
  // ★ 批 17：计划册退役 ⇒ 它不在**活册**集合里了。旧证仍要跑在**同一份内容**上（归档件逐字节相同），
  //   所以这里回落读归档件，而不是把断言删掉 / 改成恒真。
  if (!s && feature === 'task-system-plan') {
    const archived = bookFileOf(feature);
    assert.ok(fs.existsSync(archived), `真仓必须有 ${feature} 册（活册或归档件）——读数不许靠猜`);
    return { ...(JSON.parse(fs.readFileSync(archived, 'utf8')) as BookSheetLike), feature };
  }
  assert.ok(s, `真仓必须有 ${feature} 册（读数不许靠猜）`);
  return s;
}
const nodesOf = (sheet: BookSheetLike) => (sheet.geometry?.nodes ?? []) as Array<Record<string, unknown>>;
const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

// ════════════════════════════════════════════════════════════════════
// 1.1 6 个 path 各恰一册持有，且是 agent-io-toolface
// ════════════════════════════════════════════════════════════════════
test('1.1 真仓：6 个 registry path 各自**恰一册**持有，且持有者是 agent-io-toolface（换手前是 3 册各一节点）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of PATHS) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.equal(feats.length, 1, `\`${p}\` 必须恰一册持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(feats[0], TF, `\`${p}\` 的持有册必须是 ${TF}（实测 ${feats[0]}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个：${hs.map((h) => h.node).join(',')}）`);
  }
});

test('1.1 败方册里这 6 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
  for (const feature of [AI, TSP]) {
    const sheet = bookOf(feature) as unknown as {
      geometry?: { nodes?: Array<Record<string, unknown>>; edges?: Array<{ from?: string; to?: string }> };
      semantic?: { files?: Array<{ id?: string; path?: string }> };
    };
    for (const p of PATHS) {
      const nodes = (sheet.geometry?.nodes ?? []).filter((n) => norm(n.path) === p);
      assert.equal(nodes.length, 0, `${feature} 册里不该再有 \`${p}\` 的节点（实测 ${nodes.length} 个）`);
      const sems = (sheet.semantic?.files ?? []).filter((f) => norm(f.path) === p);
      assert.equal(sems.length, 0, `${feature} 册的 semantic.files 里不该再有 \`${p}\``);
    }
    // 边：指向被删 id 的边必须一起走（removeFileFromDsl 的"三清"）
    const dangling = (sheet.geometry?.edges ?? []).filter((e) => DELETED_IDS.includes(String(e.from)) || DELETED_IDS.includes(String(e.to)));
    assert.deepEqual(dangling, [], `${feature} 册里不该留悬空边（实测 ${dangling.length} 条）`);
  }
  // 三册一起看：这 6 个派生 id 只许在 toolface 里、且各恰一个
  // ★ 2026-11-18（批 15）：toolface 的 6 个**手写 id** 已按 `nodeIdOf` 规范化 ⇒ 这 6 个派生 id 现在
  //   就是 toolface 的**正式 id**（批 1 当时它们是被删掉的那两册的 id）。判据方向随之改成"只在属主册、恰一个"，
  //   而不是"任何册都没有" —— 后者在批 15 之后会与"派生式唯一"直接矛盾。
  for (const s of repoSheets()) {
    const ids = nodesOf(s).map((n) => String(n.id));
    for (const id of DELETED_IDS) {
      if (s.feature === TF) assert.equal(ids.filter((x) => x === id).length, 1, `${TF} 必须恰有一个 \`${id}\`（批 15 改名之后的正式 id）`);
      else assert.ok(!ids.includes(id), `${s.feature} 册里不该再有节点 \`${id}\`（换手已完成，它只在 ${TF} 里）`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════
// 1.2 判据一条不丢 + 逐条带出处
// ════════════════════════════════════════════════════════════════════
test('1.2 9 条判据一条不丢：内容（kind + 特征串）仍在，且逐条带「原住」出处', () => {
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of repoSheets()) for (const n of nodesOf(s)) byId.set(`${s.feature}/${String(n.id)}`, n);
  for (const want of MOVED) {
    const owner = want.to.startsWith('file_src_infrastructure') ? AI : TF;
    const node = byId.get(`${owner}/${want.to}`);
    assert.ok(node, `接管节点不在了：${owner}/${want.to}`);
    const exps = ((node.decision as { expectations?: Array<Record<string, unknown>> } | undefined)?.expectations ?? []) as Array<
      Record<string, unknown>
    >;
    const hit = exps.find(
      (e) =>
        String(e.kind) === want.kind &&
        JSON.stringify(e).includes(want.needle) &&
        /〔原住 /.test(String(e.why ?? '')),
    );
    assert.ok(hit, `${owner}/${want.to} 上必须还留着那条 ${want.kind} 判据（特征串 ${want.needle} + 「原住」出处）—— 实测 ${exps.length} 条`);
    assert.match(
      String(hit.why ?? ''),
      new RegExp(`〔原住 (${AI}|${TSP}):file_src_application_meta_registry_\\w+#\\d+〕`),
      `判据的 why 末尾必须带出处（原住 agent-io:… / task-system-plan:…）：${String(hit.why ?? '').slice(-120)}`,
    );
  }
});

test('1.2b 散文不丢：被删节点上的 rationale / acceptance / consequences 在接管节点上还能读到', () => {
  const tf = bookOf(TF);
  const cap = nodesOf(tf).find((n) => norm(n.path) === 'src/application/meta/registry/capability_map.ts');
  assert.ok(cap, 'toolface 必须持有 capability_map.ts 的节点');
  const dec = (cap.decision ?? {}) as Record<string, unknown>;
  const blob = JSON.stringify(dec);
  // agent-io 侧三段原文的**特征句**（删了就没有第二处能读到）
  assert.ok(blob.includes('策展文本是模型选工具的第一站'), 'agent-io 的 rationale 必须搬过来（否则"为什么"随节点一起消失）');
  assert.ok(blob.includes('WHEN_OVERRIDES 的 key 必须 ⊆ TOOL_DEFS'), 'agent-io 的 consequences 必须搬过来');
  assert.ok(blob.includes('tests/i1_doc_alignment.test.ts'), 'agent-io 的 acceptance 必须搬过来');
  assert.ok(blob.includes('权威自带标记由工具现扫'), '计划册侧那条 rationale 必须留在册上（它随 3 条判据留在计划册）');
  // ★ 旧的"本节点不持有判据 …权威在 agent-io"那句换手后是假的，必须已经不在
  assert.ok(
    !String(dec.summary ?? '').includes('本节点不持有判据'),
    `换手后"本节点不持有判据"这句必须删掉（它是换手前的假话）：${String(dec.summary ?? '').slice(0, 120)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// 1.3 断言档（gen-db-check ⑦ 同一把尺）：一个 path 只许一册断言
// ════════════════════════════════════════════════════════════════════
test('1.3 断言档：真仓 0 条跨册断言冲突；把「断言别处」的判据搬进本册 ⇒ 立刻 1 条（鉴别力）', () => {
  const conflicts = ownershipConflictsOf(assertedPathsBySheet(repoSheets()));
  assert.deepEqual(
    conflicts.map((c) => `${c.path} ← ${c.claims.map((x) => `${x.feature}(${x.count})`).join(' / ')}`),
    [],
    '一个 path 只能一册断言（⑦ 档）。把断言别处的判据搬进本册就会在这里红',
  );
  // 世界二：两册都断言同一个 path ⇒ 必须报出来
  const two = [
    { feature: 'a', geometry: { nodes: [{ id: 'file_src_x_ts', path: 'src/x.ts', decision: { expectations: [{ kind: 'file-exists', path: 'src/x.ts' }] } }] } },
    { feature: 'b', geometry: { nodes: [{ id: 'file_src_y_ts', path: 'src/y.ts', decision: { expectations: [{ kind: 'file-exists', path: 'src/x.ts' }] } }] } },
  ] as unknown as BookSheetLike[];
  const bad = ownershipConflictsOf(assertedPathsBySheet(two));
  assert.equal(bad.length, 1, `两册断言同一 path 必须报 1 条：${JSON.stringify(bad)}`);
  assert.equal(bad[0]?.path, 'src/x.ts');
});

// ════════════════════════════════════════════════════════════════════
// 1.4 ② 档：这 6 个 path 从 multi_owned 变 owned
// ════════════════════════════════════════════════════════════════════
test('1.4 ② 档：这 6 个 path 的 klass = owned；多册持有集合里**不再有**这 6 个（总数不硬编码）', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须在（否则判不了）：${read.table_error}`);
  const byPath = new Map(read.rows.map((r) => [r.path, r]));
  for (const p of PATHS) {
    const row = byPath.get(p);
    assert.ok(row, `② 档必须逐条点名 \`${p}\`（rows 里没有它）`);
    assert.equal(row.klass, 'owned', `\`${p}\` 必须是 owned（实测 ${row.klass}）`);
    assert.equal(row.owner, TF, `\`${p}\` 的域表属主必须是 ${TF}（实测 ${row.owner}）`);
    assert.deepEqual([...new Set(row.holders.map((h) => h.feature))], [TF], `\`${p}\` 只该有一个持有者`);
  }
  // 分母还在（0.12：分子必须带分母）
  // ★ 2026-11-18（T-#EXCLUDED-EMPTY-PATH 链，出处）：**555 → 568**。批 1 换手一个 path 都没动分母；这 13 是
  //   另一件事贡献的：`excluded` 形状修正后结构门现形出 13 个「盘上有 ∧ 册上无节点」的活源码，
  //   triage 给它们补了节点（`criteria_worker*` / `review_gate` / `parser_presence` 等）⇒ 持有 path 的分母按定义 +13。
  // ★ 同时**棘轮化**（批 4 裁定：钉结构不钉绝对值）：`555`/`568` 这种精确值把**合法增仓**也一起判红（本次就是）。
  //   分母的语义是「持有面被谁动过、变化要有出处」，所以改成反向钉法 —— **低于 floor = 有节点的 path 被删 /
  //   被收走而没人登记** ⇒ 红；往上 ⇒ 合法新增（带出处即可，不拦）。
    // ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
  //   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

  const PATHS_FLOOR = 567;
  assert.ok(read.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR} = 批收口 555 + 合法入仓 13；实测 ${read.paths}）—— 掉下去 = 有节点被删/有 path 被收走而没人登记`);
  assert.equal(read.books, 2, `册数：**批 17 计划册退役** ⇒ 3 → 2（实测 ${read.books}）`);
});

test('1.4b 域表：toolface 的 owns 仍是**6 条精确路径**，且与"册上恰一册持有"的 6 个 path 逐个相等', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须读得出来：${read.error}`);
  const entries = ownsOf(read.table as DesignBooksTable, TF);
  assert.equal(entries.length, 6, `必须仍是 6 条（写前缀会把 project_actual_fields.ts 也划过去）：${entries.join(',')}`);
  for (const e of entries) assert.ok(!e.endsWith('/'), `条目必须是精确路径，不是前缀：${e}`);
  assert.deepEqual([...entries].sort(), [...PATHS].sort(), '域表条目必须逐字等于批 1 的 6 个 path');
  for (const p of PATHS) {
    const hit = ownerOf(read.table as DesignBooksTable, p);
    assert.equal(hit.matched, true, `\`${p}\` 必须被域表覆盖`);
    assert.equal(hit.owner, TF, `\`${p}\` 的属主是 ${hit.owner}，不是 ${TF}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 1.5 写端：换手之后败方册再想建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('1.5 写端：换手完成后，**败方册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export const x = 1;\n', 'utf8');
    // 域表：toolface 精确持有 src/x.ts，本体册持 src/（前缀）
    fs.writeFileSync(
      path.join(proj, 'design-books.json'),
      JSON.stringify(
        {
          note: 'fixture',
          books: [
            { feature: AI, owns: ['src/'] },
            { feature: TF, owns: ['src/x.ts'] },
          ],
          unowned: [],
        },
        null,
        2,
      ),
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
    // 换手后的状态：toolface 有节点，本体册没有
    sheet(TF, [{ id: 'file_capability_map_ts', label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts', decision: { expectations: [{ kind: 'file-exists', path: 'src/x.ts' }] } }]);
    sheet(AI, [{ id: 'file_src_a_ts', label: 'a.ts', type: 'file', x: 0, y: 0, path: 'src/a.ts' }]);
    registerFeature(AI, proj, 'test');
    registerFeature(TF, proj, 'test');

    // 世界一：本体册想把这个 path 拿回去（不显式换手）⇒ 拒
    const ai = JSON.parse(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8'));
    ai.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const before = fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8');
    assert.throws(
      () => saveDSL(ai, 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|not_owner|已由|属主/,
      '换手后败方册再建节点必须**前置拒**（否则换手就是可撤销的）',
    );
    assert.equal(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8'), before, '被拒的写不许留下任何痕迹');

    // 世界二：属主册自己往自己节点上加判据 ⇒ 过（这才是本批真正做的事）
    const tf = JSON.parse(fs.readFileSync(path.join(dir, `${TF}.dsl.json`), 'utf8'));
    tf.geometry.nodes[0].decision.expectations.push({ kind: 'file-exists', path: 'src/x.ts', why: '加一条（属主册写自己的 path 必须放行）' });
    saveDSL(tf, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(path.join(dir, `${TF}.dsl.json`), 'utf8'));
    assert.equal(after.geometry.nodes[0].decision.expectations.length, 2, '属主册加判据必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 1.6 本批刻意不改 id
// ════════════════════════════════════════════════════════════════════
test('1.6 批 1 的"刻意不改 id"已被**批 15 规范化**：6 个手写 id 不在册、改成了派生式；漂移 0', () => {
  const tf = bookOf(TF);
  const ids = new Set(nodesOf(tf).map((n) => String(n.id)));
  for (const p of PATHS) {
    const handwritten = `file_${path.basename(p).replace(/\.ts$/, '')}_ts`;
    assert.equal(ids.has(handwritten), false, `批 1 保留的手写 id \`${handwritten}\` 必须已由批 15 规范化（还在册 = 批 15 没落地）`);
    assert.equal(ids.has(nodeIdOf(p)), true, `必须换成派生 id \`${nodeIdOf(p)}\`（批 1 当时的"改名归批 15"就是这一条）`);
  }
  // ★ 批 15 收口：漂移 **10 → 0**（本文件批 1 时是 31，批 8/9 随节点删降到 10，批 15 把最后 10 条清干净）
  const drift = nodeIdDriftOf(repoSheets());
  assert.equal(drift.nodes, 0, `全仓 id 漂移必须是 0（实测 ${drift.nodes}）—— 批 15 的出口`);
  for (const r of drift.rows) assert.notEqual(r.id, r.want, `漂移行的 id 必须真的不等于派生：${r.feature}:${r.id}`);
});

test('1.6b 结构闸：改过的三册 `validateDSL` 读数不因本批变坏（toolface 仍是 0 条）', () => {
  const tfBook = JSON.parse(fs.readFileSync(path.join(REPO, '.agent-io', 'design', 'agent-io-toolface.dsl.json'), 'utf8'));
  const v = validateDSL(tfBook);
  assert.equal((v.errors ?? []).length, 0, `toolface 册必须仍然结构合法：${JSON.stringify(v.errors ?? []).slice(0, 400)}`);
});

/**
 * ★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 17 · **计划册退役**）：`task-system-plan` 已归档进
 * `.agent-io/design/archived/`，同名 feature 也从注册表注销 ⇒ **活册集合只剩 2 本**
 * （`agent-io` + `agent-io-toolface`）。
 *
 * ★ 本证（批 N 的那条）读的是**真仓**的计划册。裁决：**不删断言、不改成恒真**，只让读端跟到归档件 ——
 * 归档件与退役前那份**逐字节相同**（sha256 由 `tests/p1_cross_book_batch17.test.ts` 钉住）
 * ⇒ 旧证今天判的仍是**同一份内容**，只是它现在叫"归档件"。
 * ★ 谁改了归档件一个字节：`p1_cross_book_batch17.test.ts` 的 sha 断言先红 —— 本条不会变成假绿。
 */
function bookFileOf(feature: string): string {
  const live = path.join(REPO, '.agent-io', 'design', `${feature}.dsl.json`);
  if (fs.existsSync(live)) return live;
  return path.join(REPO, '.agent-io', 'design', 'archived', `${feature}.dsl.json`);
}
