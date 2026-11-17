/**
 * P1 · T-#A8A9-CROSS-BOOK **批 4**（A 类空壳第三段：50 个 path，删计划册侧节点，**0 搬运**）—— 红 → 绿。
 *
 * ## 这批要立的七条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 4.1 | 50 个 path **各恰一册**持有，且是 `agent-io`；计划册侧节点 / 语义 / 边全没了 | 半删（幽灵节点、悬空边）在这里红 |
 * | 4.2 | 判据**总数守恒**（A 类零负载 ⇒ 822 一条不动） | 删错一侧（删到有判据的那侧）立刻少几条 |
 * | 4.3 | 清单就是**批 4 的清单**（字典序接批 3 的第三段 · 全部落在 `src/infrastructure/analysis/**`） | 手抄错一条 / 顺序漂了都在这里红 |
 * | 4.3b | 三条**界外**没被偷偷收进本批：2 条带卡（`discussion_log.ts` / `cli.ts`）+ 1 条**非属主侧带 decision 散文**（`go_instrument.ts`，本批新发现） | 把 `go_instrument.ts` 混进来 ⇒ 前置 exit 3（消融 §2.4），这里红 |
 * | 4.4 | ② 档：这 50 个 path 的 klass = `owned`；把它们塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 4.5 | 写端：删完之后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是"一刀切"） |
 * | 4.6 | 门档：多册持有 308 → 258（−50）；三组集合指纹与 `design-books-baseline.json` 逐字一致 | 谁改了册而不改基线，这里红（**钉的是棘轮 ≤258 与 308−258=50**，不是"当前值 = 258"） |
 *
 * ## 纪律（本仓 0.14 / R47）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 50 个 path 恰一册持有"·"判据总数守恒"），
 *   **不断**会随批下降的单册读数（`tsp` 的 206 条在批 9–13 会继续降，那不是本批的账）；
 * · 门档断的是**集合指纹与基线逐字一致**（谁改了册而不改基线，这里红），不是"多册持有 = 0"（那是批 13 之后的终局）。
 * · ★ 批 3 的教训（§3.2）：**只许钉三类东西** —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
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
 * 批 4 的 50 个 path（**剩余**严格 A 类空壳的字典序前 50；批 2 / 批 3 收掉了前 100）。
 * 三条界外见 `BOUNDARY`：清单在这里是"严格 A 类 − 带卡 2 − 带散文 1"的字典序前缀，所以相对严格 A 原序**有一个洞**
 * （第 24 位 `observe/go_instrument.ts`），最后一格跨到严格 A 的第 51 条（`project_root/index.ts`）。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（4.1/4.4/4.5）就无处可断。
 * ★ 顺序的权威是**默认 `sort()`（码位序）**，不是 `localeCompare`：本批第一次撞到两者不同序
 *   （`diff.ts` vs `diff_impact.ts` · `instrument.ts` vs `instrument_java.ts` · `judge.ts` vs `judge_guard.ts` ——
 *   `localeCompare` 把 `_` 排在 `.` 之前，码位序反之）。**集合不变**（两种序切出的前 50 是同一集合，已实测），
 *   但"字典序前缀"这句话只有在码位序下才与本文件的断言一致 ⇒ 清单按码位序书写，分析器的 `localeCompare` 只用于选集合。
 */
const PATHS = [
  'src/infrastructure/analysis/contract_gate/languages/ts.ts',
  'src/infrastructure/analysis/contract_gate/parts.ts',
  'src/infrastructure/analysis/cross_repo/index.ts',
  'src/infrastructure/analysis/deadcode/dead_statements.ts',
  'src/infrastructure/analysis/diagnosis/candidate_locator.ts',
  'src/infrastructure/analysis/diagnosis/chain_tracer.ts',
  'src/infrastructure/analysis/diagnosis/contract.ts',
  'src/infrastructure/analysis/diagnosis/diagnose.ts',
  'src/infrastructure/analysis/diagnosis/impact_analyzer.ts',
  'src/infrastructure/analysis/diagnosis/repair.ts',
  'src/infrastructure/analysis/diagnosis/root_cause_aggregator.ts',
  'src/infrastructure/analysis/diagnosis/symptom_parser.ts',
  'src/infrastructure/analysis/diagnosis/verifier.ts',
  'src/infrastructure/analysis/health/health_cache.ts',
  'src/infrastructure/analysis/impact/diff.ts',
  'src/infrastructure/analysis/impact/diff_impact.ts',
  'src/infrastructure/analysis/impact/impact_ledger_store.ts',
  'src/infrastructure/analysis/impact/index.ts',
  'src/infrastructure/analysis/observe/approve_gated.ts',
  'src/infrastructure/analysis/observe/chain.ts',
  'src/infrastructure/analysis/observe/contract.ts',
  'src/infrastructure/analysis/observe/decl_review.ts',
  'src/infrastructure/analysis/observe/dsl_store.ts',
  'src/infrastructure/analysis/observe/index.ts',
  'src/infrastructure/analysis/observe/instrument.ts',
  'src/infrastructure/analysis/observe/instrument_java.ts',
  'src/infrastructure/analysis/observe/instrument_py.ts',
  'src/infrastructure/analysis/observe/instrument_skeleton.ts',
  'src/infrastructure/analysis/observe/judge.ts',
  'src/infrastructure/analysis/observe/judge_guard.ts',
  'src/infrastructure/analysis/observe/judge_service.ts',
  'src/infrastructure/analysis/observe/ledger_fold.ts',
  'src/infrastructure/analysis/observe/log_query.ts',
  'src/infrastructure/analysis/observe/observe_langs.ts',
  'src/infrastructure/analysis/observe/probe.ts',
  'src/infrastructure/analysis/observe/proposal_store.ts',
  'src/infrastructure/analysis/observe/run_loop.ts',
  'src/infrastructure/analysis/observe/run_sentinel.ts',
  'src/infrastructure/analysis/observe/run_trace_replay.ts',
  'src/infrastructure/analysis/observe/snapshot_needle.ts',
  'src/infrastructure/analysis/observe/trace_exec.ts',
  'src/infrastructure/analysis/observe/verify_gate.ts',
  'src/infrastructure/analysis/package_migration/core.ts',
  'src/infrastructure/analysis/package_migration/index.ts',
  'src/infrastructure/analysis/package_migration/languages/go.ts',
  'src/infrastructure/analysis/package_migration/languages/py.ts',
  'src/infrastructure/analysis/package_migration/languages/registry.ts',
  'src/infrastructure/analysis/package_migration/languages/ts.ts',
  'src/infrastructure/analysis/package_migration/parts.ts',
  'src/infrastructure/analysis/project_root/index.ts',
];

/**
 * 批 4 的三条**界外**（故意不收）。
 * | path | 为什么不是零负载 | 本批处理 |
 * |---|---|---|
 * | `src/domain/discussion_log.ts` | 域表属主是**计划册** + 计划册侧 `candidate` 卡 | 跳过（要人判；属主不是 agent-io ⇒ 连"删非属主侧"都要另判） |
 * | `src/presentation/cli/cli.ts` | 属主册侧 `candidate` 卡 | 跳过（不在本窗口内，批 2/批 3 已登记） |
 * | `src/infrastructure/analysis/observe/go_instrument.ts` | **计划册侧节点带 decision 散文**（summary 97 + rationale 115 + acceptance 182 字，tsp 独有，agent-io 侧一片空白） | 跳过（删节点会连带删掉这段叙事 = 批 8 型的活，不是空壳直删；清单跨到第 51 条） |
 * 前两条是批 2 就登记过的老账；第三条是**本批新发现**：批 2 的 A 类定义（0 判据 / 0 职责 / 0 卡）**漏了"decision 散文"这一维**
 * —— 实测剩余严格 A 类 151 个里**恰有这 1 个**带非属主侧散文，且正好落在批 4 的窗口第 24 位。
 */
const BOUNDARY = {
  cards: ['src/domain/discussion_log.ts', 'src/presentation/cli/cli.ts'],
  prose: 'src/infrastructure/analysis/observe/go_instrument.ts',
} as const;
const DEFERRED_WITH_CARDS = BOUNDARY.cards;

/** 批 4 的判据守恒读数（A 类零负载 ⇒ 删 50 个节点，一条判据都不动） */
const CRITERIA_TOTAL = 822;
/**
 * `多册持有`：批 3 收口 308 → 批 4 再收 50 = **258**。
 * ★ 258 是**上限**（棘轮），不是"永远等于"：批 5 起它会继续往下走（批 3 §3.2 的双 Δ 判据）。
 *   会漂的"当前值"不许钉进证里（批 2 的证钉过 358，批 3 落地就把那条打红了）。
 */
const MULTI_OWNED_BEFORE_B4 = 308;
const MULTI_OWNED_AFTER_B4 = 258;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const nodesOf = (s: BookSheetLike) => (s.geometry?.nodes ?? []) as Array<Record<string, unknown>>;
const proseOf = (n: Record<string, unknown> | undefined) => {
  const d = (n?.decision ?? {}) as Record<string, unknown>;
  return ['summary', 'rationale', 'acceptance', 'consequences'].filter((k) => String(d[k] ?? '').trim());
};

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
// 4.1 50 个 path 各恰一册持有（agent-io），计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('4.1 真仓：50 个 path 各自**恰一册**持有，且持有者是 agent-io（批 4 前是两册各一节点）', () => {
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

test('4.1b 计划册里这 50 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
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
// 4.2 判据总数守恒
// ════════════════════════════════════════════════════════════════════
test('4.2 判据总数守恒：三册合计 822 条（A 类零负载 ⇒ 删 50 个节点一条判据不动）', () => {
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
// 4.3 清单就是批 4 的清单
// ════════════════════════════════════════════════════════════════════
test('4.3 清单形状：50 条 · 无重复 · 字典序已排好 · 全部落在 src/infrastructure/analysis/**', () => {
  assert.equal(PATHS.length, 50, `批 4 是 50 个 path（≤50 的硬上限，实测 ${PATHS.length}）`);
  assert.equal(new Set(PATHS).size, PATHS.length, '清单不许有重复 path');
  assert.deepEqual([...PATHS].sort(), PATHS, '清单必须按字典序（"第三段"的定义就是接在批 3 之后的前缀，顺序漂了就不是同一段）');
  // 字典序接批 3：批 3 的末位是 `src/infrastructure/analysis/contract_gate/languages/registry.ts`，本批首位必须排在它之后
  assert.ok(PATHS[0]! > 'src/infrastructure/analysis/contract_gate/languages/registry.ts', `本批首位必须接在批 3 末位之后（实测 ${PATHS[0]}）`);
  // 批 4 整段都在 analysis/ 下（字典序在这里刚好是一整块）
  for (const p of PATHS) assert.ok(p.startsWith('src/infrastructure/analysis/'), `批 4 的 path 都该在 src/infrastructure/analysis/ 下（实测 ${p}）`);
  const bucket = (p: string) => p.split('/').slice(0, 4).join('/') + '/';
  const hist: Record<string, number> = {};
  for (const p of PATHS) hist[bucket(p)] = (hist[bucket(p)] ?? 0) + 1;
  assert.deepEqual(
    hist,
    {
      'src/infrastructure/analysis/contract_gate/': 2,
      'src/infrastructure/analysis/cross_repo/': 1,
      'src/infrastructure/analysis/deadcode/': 1,
      'src/infrastructure/analysis/diagnosis/': 9,
      'src/infrastructure/analysis/health/': 1,
      'src/infrastructure/analysis/impact/': 4,
      'src/infrastructure/analysis/observe/': 24,
      'src/infrastructure/analysis/package_migration/': 7,
      'src/infrastructure/analysis/project_root/': 1,
    },
    `目录分布：${JSON.stringify(hist)}`,
  );
});

test('4.3b 界外：2 条带卡 + 1 条非属主侧带 decision 散文的 path 没被收进本批（留账，不是漏）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  for (const p of Object.values(BOUNDARY)) {
    assert.ok(!PATHS.includes(p), `\`${p}\` 是界外（带卡 / 带散文）⇒ 不许混进本批清单`);
  }
  // 带卡的两条：属主各在一侧 ⇒ 都**不能**直删（批 2 §3.1 / 批 3 §3.1 的留账）
  //   ★ 这两条"仍是两册持有"的读数由批 3 的证（3.3b）钉着，本文件不重复钉第二遍（同一读数钉两处 = 将来改两处）
  for (const p of DEFERRED_WITH_CARDS) {
    assert.ok(!PATHS.includes(p), `\`${p}\` 带 candidate 卡 ⇒ 不属于"零负载"，不许混进本批清单`);
  }
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/domain/discussion_log.ts').owner, TSP, '这条 path 的域表属主是计划册');
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/presentation/cli/cli.ts').owner, AI, '这条 path 的域表属主是本体册（带卡的那一侧在属主册 ⇒ 更不能直删）');
  // 带散文的那条：属主是本体册，但**非属主侧**的节点带着 tsp 独有的叙事 ⇒ 删它 = 删叙事（批 8 型的活）
  //   ★★ 批 6 把它收了，而且正是按"批 8 型"收的（叙事**先搬进属主册**、逐字节相同，再删计划册侧）。
  //      所以这条绊线**换了另一半**而不是被删掉：断"计划册侧副本没了 + 叙事没丢"，见 p1_cross_book_batch6 的 6.4。
  assert.equal(ownerOf(read.table as DesignBooksTable, BOUNDARY.prose).owner, AI, '这条 path 的域表属主是本体册');
  const tspNode = nodesOf(bookOf(TSP)).find((n) => norm(n.path) === BOUNDARY.prose);
  assert.equal(tspNode, undefined, `\`${BOUNDARY.prose}\` 的计划册侧节点必须已经没了（批 6 搬运后删）`);
  const aiNode = nodesOf(bookOf(AI)).find((n) => norm(n.path) === BOUNDARY.prose);
  assert.ok(aiNode, `\`${BOUNDARY.prose}\` 的叙事必须落在属主册（否则批 6 就成了"只删不搬" = 删了叙事）`);
  assert.ok(proseOf(aiNode).length > 0, `\`${BOUNDARY.prose}\` 在属主册上必须**仍带着**那段叙事（批 6 的搬运落点）`);
  // 留账必须写在**门档**里（机器可核的账），不是只写在交付书里
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as {
    multi_owned: { why?: string };
  };
  assert.ok(String(baseline.multi_owned.why ?? '').includes('go_instrument.ts'), '门档 multi_owned.why 必须记着这条界外（否则下次没人知道它为什么没被收）');
});

// ════════════════════════════════════════════════════════════════════
// 4.4 ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('4.4 ② 档：这 50 个 path 的 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
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
// 4.5 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('4.5 写端：批 4 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 4 的删除是可逆的，13 批都白做）',
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
// 4.6 新门档：多册持有 ≤ 258（批 4 收 −50：308 → 258），且指纹与基线逐字一致
// ════════════════════════════════════════════════════════════════════
test('4.6 门档：多册持有只许不增（批 4 收口 258 = 308 − 50）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  // ★ 棘轮（只许不增），不钉"当前值"：批 5 起这个数会继续往下走（258 → … → 0），那是批计划的账，不是本批的回退
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B4,
    `多册持有只许不增（批 4 收口 ${MULTI_OWNED_AFTER_B4}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：308 − 258 = 50 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B4 - MULTI_OWNED_AFTER_B4, PATHS.length, '批 4 的降幅必须逐字等于本批 path 数（A 类零例外）');
  for (const p of PATHS) assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
  // 另两笔账本批一位不该动（属主错位归批 14，id 漂移归批 15 / T-#NODE-ID-DRIFT）—— 棘轮，不钉"永远 12/31"
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 14 处理）：实测 ${now.owner_mismatch.length}`);
  assert.ok(now.id_drift.length <= 31, `id 漂移只许不增（本批不改名）：实测 ${now.id_drift.length}`);
});
