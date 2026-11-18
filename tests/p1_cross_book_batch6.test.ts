/**
 * P1 · T-#A8A9-CROSS-BOOK **批 6**（A 类空壳**收官段**：51 个 path —— 50 条直删 + 1 条**搬运后删**）—— 红 → 绿。
 *
 * ## 这批要立的十条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 6.1 | 51 个 path **各恰一册**持有，且是 `agent-io`；计划册侧节点 / 语义 / 边全没了 | 半删（幽灵节点、悬空边）在这里红 |
 * | 6.1b | 这 51 个 id 在**别的册**里一个不留（只许在属主册） | 删错册 / 删了一半在这里红 |
 * | 6.2 | 判据**总数守恒**（A 类零负载 ⇒ 822 一条不动） | 删错一侧（删到有判据的那侧）立刻少几条 |
 * | 6.3 | 清单就是**批 6 的清单**（**码位序**接批 5 的第五段 · 51 = 50 + 1 · 首次落进 `src/presentation/**`） | 手抄错一条 / 顺序漂了都在这里红 |
 * | 6.3b | 两条**带卡**的界外没被偷偷收进本批，且**现盘上仍是界外**（清单过期会在这里红） | 把任一条混进来 ⇒ 前置 exit 3，这里红 |
 * | 6.4 | **搬运**：`go_instrument.ts` 的 394 字叙事 + `status:done` + `overlay` 口供**逐字节**搬进了属主册同 path 节点，计划册侧节点已删 | 只删不搬（叙事蒸发）/ 搬歪（贴在别的 path）在这里红 |
 * | 6.4b | ② 档：这 51 个 path 的 klass = `owned`；把它们塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 6.5 | 写端：删完之后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是"一刀切"） |
 * | 6.6 | 门档：多册持有 ≤ 157（批 6 收 −51：208 → 157）；三组集合指纹与 `design-books-baseline.json` 逐字一致 | 谁改了册而不改基线，这里红（**钉的是棘轮 ≤157 与 208−157=51**，不是"当前值 = 157"） |
 * | 6.7 | **A 类空壳清零**：现盘复算（双持 ∧ 0 判据 ∧ 0 职责 ∧ 0 卡 ∧ 0 散文）⇒ **0 条**；剩下 157 个双持 path **每个都带负载** | 谁再手搓一个空壳双持节点，这里红（这条是"收官"这个名字的**唯一**机器定义） |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2/3/4/5 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 51 个 path 恰一册持有"·"判据总数守恒"·"空壳清零"），
 *   **不断**会随批下降的单册读数（`tsp` 的 206 条在批 9–13 会继续降，那不是本批的账）；
 * · 门档断的是**集合指纹与基线逐字一致**（谁改了册而不改基线，这里红），不是"多册持有 = 0"（那是批 13 之后的终局）。
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ 批 4 裁定②：清单顺序的权威是**默认 `sort()`（码位序）**，不是 `localeCompare`。
 *   ★ 批 6 的清单是 **50（码位序连续段）+ 1（搬运名单）** —— 51 条整体**不是**码位序（搬运那条按字典序
 *   该排在最前），所以 6.3 断的是"**前 50 条**是码位序连续段 + 第 51 条恰好是搬运名单那一条"，
 *   而不是"51 条整体有序"（后者是假的，别钉假的东西）。
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
 * 批 6 的 **50 条直删**（**剩余**可收 A 类空壳的码位序；批 2/3/4/5 收掉了前 200）。
 * 与批 5 交付书 §4.2 的"剩下的 50 条"**集合逐条相同**（实测：只在批6=0 / 只在批5=0）。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（6.1/6.4b/6.5）就无处可断。
 * ★ 段位：`infrastructure/` 根 12 · `{graph,index,packages,parse,render,rules,text}` 29 · `presentation/` 8
 *   + 搬运 1（`analysis/observe/`）= 51 ⇒ **A 类批第一次落进 `src/presentation/**`**（批 5 首次跨出 `analysis/`）。
 */
const PATHS = [
  'src/infrastructure/data_dir.ts',
  'src/infrastructure/dictionary.ts',
  'src/infrastructure/dogfood_coverage.ts',
  'src/infrastructure/dogfood_stats.ts',
  'src/infrastructure/graph/dead_deps.ts',
  'src/infrastructure/graph/import_graph.ts',
  'src/infrastructure/index/file_facts.ts',
  'src/infrastructure/index/function_outline.ts',
  'src/infrastructure/index/guided_tour.ts',
  'src/infrastructure/index/index_backfill.ts',
  'src/infrastructure/index/live_render.ts',
  'src/infrastructure/index/scan_rev.ts',
  'src/infrastructure/index/self_writes.ts',
  'src/infrastructure/llm_agnes.ts',
  'src/infrastructure/llm_focus.ts',
  'src/infrastructure/llm_gateway.ts',
  'src/infrastructure/llm_pool.ts',
  'src/infrastructure/packages/package_pins.ts',
  'src/infrastructure/packages/template_compat.ts',
  'src/infrastructure/parse/ast_node.ts',
  'src/infrastructure/parse/ast_rename.ts',
  'src/infrastructure/parse/import_resolve.ts',
  'src/infrastructure/parse/import_text.ts',
  'src/infrastructure/parse/lang_hint.ts',
  'src/infrastructure/parse/languages.ts',
  'src/infrastructure/parse/loader.ts',
  'src/infrastructure/parse/module_analysis.ts',
  'src/infrastructure/parse/probe.ts',
  'src/infrastructure/parse/type_members.ts',
  'src/infrastructure/project_view.ts',
  'src/infrastructure/render/anim_core.ts',
  'src/infrastructure/render/dataflow_core.ts',
  'src/infrastructure/render/export.ts',
  'src/infrastructure/render/simulation_engine.ts',
  'src/infrastructure/rules/rule_match.ts',
  'src/infrastructure/rules/rule_tokens.ts',
  'src/infrastructure/scan_bounds.ts',
  'src/infrastructure/storage_overlay.ts',
  'src/infrastructure/text/arg_suggest.ts',
  'src/infrastructure/text/line_utils.ts',
  'src/infrastructure/text/refs_text.ts',
  'src/infrastructure/verify_refactor.ts',
  'src/presentation/cli/diagnose_loop_cli.ts',
  'src/presentation/cli/install_package_cli.ts',
  'src/presentation/daemon/memory_watch.ts',
  'src/presentation/daemon/server.ts',
  'src/presentation/http/contract.ts',
  'src/presentation/http/dict_gen.ts',
  'src/presentation/mcp/lifecycle.ts',
  'src/presentation/mcp/tool_warnings.ts',
];

/**
 * 批 6 的**第 51 条 = 搬运后删**（不是直删）。
 *
 * | 为什么它不能直删 | 本批的处置 |
 * |---|---|
 * | 计划册侧节点带 **394 字** decision 散文（summary 97 + rationale 115 + acceptance 182）+ `status:done` + `overlay{progress:done, progress_evidence:attestation}` —— 它是 `T268` 那次"不再改被测工程 go.mod"的**叙事与口供**，删节点就一并蒸发 | **整份记录先搬进属主册同 path 节点**（逐字段 sha256 相同）**再删计划册侧节点** = 批 8 的动作在 1 条上提前落地 |
 * ★ 它**不是**判据搬运：搬过去的 `expectations` 仍是 0（判据总数 822 一位没动），搬的是"为什么长成这样"。
 * ★ 叙事指纹钉的是**内容**（三个字段的 JSON sha256），不是"当前值"：谁改了这段叙事，6.4 红。
 */
const MIGRATED = 'src/infrastructure/analysis/observe/go_instrument.ts';
/** 批 6 = 50 直删 + 1 搬运（顺序即"清单的写法"：先连续段、后单独登记的例外） */
const BATCH6 = [...PATHS, MIGRATED];

/** 批 5 的末位（"第五段接在它之后"这句话的锚点） */
const BATCH5_LAST = 'src/infrastructure/daemon/client.ts';

/** 搬运的叙事指纹（只含 summary/rationale/acceptance 三个字段，顺序固定） */
const NARRATIVE_SHA256 = 'c566186794815f8e973571589a035c58d80b2b10a2f42c718c396e20c5aa09f7';
const NARRATIVE_CHARS = 394;

/**
 * 批 6 剩下的两条**界外**（A 类判据上成立，但**带卡** ⇒ 不零负载；本批一条没动）。
 * | path | 为什么不是零负载 | 谁处理 |
 * |---|---|---|
 * | `src/domain/discussion_log.ts` | 域表属主是**计划册** + 计划册侧 `candidate` 卡 | 批 16（卡收敛）/ 批 14（属主错位） |
 * | `src/presentation/cli/cli.ts` | **属主册侧** `candidate` 卡 | 批 16（卡收敛） |
 * 两条都**现盘上仍是界外**（不是"清单里没写就算"）：6.3b 逐条核卡还在、仍两册持有、门档 `why` 点着名字。
 */
const BOUNDARY_CARDS = ['src/domain/discussion_log.ts', 'src/presentation/cli/cli.ts'] as const;

/** 批 6 的判据守恒读数（A 类零负载 ⇒ 删 51 个节点，一条判据都不动）
 * ★ 2026-11-18：822 → 826 —— globals-fix 分支的 card-globals 两张卡合法新增 4 条判据
 *   （merge `b7b89f24`，与 A 类迁移无关的独立增量），按本文件"改这里是显式动作"规则更新。 */
// ★ 2026-11-18（EEP 真修复链）：826 → 839 —— 19 个被吞 gap 的 triage 给 13 个活源码文件补了 13 条 file-exists 出处判据（T-#EXCLUDED-EMPTY-PATH 真修复），合法新增。
const CRITERIA_TOTAL = 839;
/**
 * path 分母的**棘轮下限**（只许不降；不是“精确值”）。
 * ★ 2026-11-18（T-#EXCLUDED-EMPTY-PATH 链，出处）：555 → **568** —— 13 个活源码**合法入仓**。`excluded`
 *   形状修好后结构门现形出 13 个「盘上有 ∧ 册上无节点」的活源码，triage 逐个补了节点
 *   （`criteria_worker`.ts ×3 / `review_gate.ts` / `parser_presence.ts` …）⇒ **持有 path 的分母按定义 +13**。
 *   与本批无关：批内换手 / 删非属主侧节点都**不动**分母（这正是原来那条断言要守的东西）。
 * ★ 为什么从「精确 555」改成 floor（批 4 裁定：**钉结构不钉绝对值**）：精确钉的本意是“防删节点的副作用”，
 *   但它把**合法增仓**也一起判红（本次就是）。分母的语义是“持有面被谁动过、变化要有出处”，不是“永远等于某个数”。
 *   反向钉法照样有牙：**低于它 = 有节点的 path 被删 / 被收走而没人登记** ⇒ 红；往上 = 合法新增，不拦。
 */
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;
/**
 * `多册持有`：批 5 收口 208 → 批 6 再收 51 = **157**。
 * ★ 157 是**上限**（棘轮），不是"永远等于"：批 8–13 还会继续往下走（批 3 §3.2 的双 Δ 判据）。
 */
const MULTI_OWNED_BEFORE_B6 = 208;
const MULTI_OWNED_AFTER_B6 = 157;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const nodesOf = (s: BookSheetLike) => (s.geometry?.nodes ?? []) as Array<Record<string, unknown>>;
const proseOf = (n: Record<string, unknown> | undefined) => {
  const d = (n?.decision ?? {}) as Record<string, unknown>;
  return ['summary', 'rationale', 'acceptance', 'consequences'].filter((k) => String(d[k] ?? '').trim());
};
const semanticOf = (s: BookSheetLike) =>
  ((s as unknown as { semantic?: { files?: Array<{ id?: string; path?: string; responsibility?: string }> } }).semantic?.files ?? []);

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
// 6.1 51 个 path 各恰一册持有（agent-io），计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('6.1 真仓：51 个 path 各自**恰一册**持有，且持有者是 agent-io（批 6 前是两册各一节点）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of BATCH6) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.equal(feats.length, 1, `\`${p}\` 必须恰一册持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(feats[0], AI, `\`${p}\` 的持有册必须是 ${AI}（实测 ${feats[0]}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个：${hs.map((h) => h.node).join(',')}）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
  }
});

test('6.1b 计划册里这 51 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
  const tsp = bookOf(TSP) as unknown as {
    geometry?: { nodes?: Array<Record<string, unknown>>; edges?: Array<{ from?: string; to?: string }> };
    semantic?: { files?: Array<{ id?: string; path?: string }> };
  };
  const deletedIds = BATCH6.map((p) => nodeIdOf(p));
  for (const p of BATCH6) {
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
// 6.2 判据总数守恒（★ 搬运的是叙事，不是判据 —— 这条正是"搬运 ≠ 搬判据"的机器证据）
// ════════════════════════════════════════════════════════════════════
test('6.2 判据总数守恒：三册合计 822 条（A 类零负载 ⇒ 删 51 个节点一条判据不动；搬运也没带上一条）', () => {
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaTotal([s])}`).join(' · ');
  assert.equal(
    criteriaTotal(sheets),
    CRITERIA_TOTAL,
    `删节点/搬叙事都不许带走判据（实测 ${per}）。若某批之后总数合法地变了，改这里是显式动作，不是让它漂`,
  );
  const holdings = bookHoldings(sheets);
  // ★ 2026-11-18：`index_backfill.ts` 豁免 —— globals-fix 分支的 card-globals 给它合法挂了 2 条
  //   判据（merge `b7b89f24`，独立于本批的增量；6.2 总数 822→826 的去向就在这里）。
  const ZERO_CRITERIA_EXEMPT = new Set(['src/infrastructure/index/index_backfill.ts']);
  for (const p of BATCH6) {
    for (const h of holdings.get(p) ?? []) {
      if (ZERO_CRITERIA_EXEMPT.has(p)) continue;
      assert.equal(h.expectations, 0, `\`${p}\` 在 ${h.feature} 册上不该有判据（实测 ${h.expectations} 条）`);
    }
  }
});

// ════════════════════════════════════════════════════════════════════
// 6.3 清单就是批 6 的清单
// ════════════════════════════════════════════════════════════════════
test('6.3 清单形状：51 = 50（码位序连续段）+ 1（搬运）· 接在批 5 末位之后 · 首次落进 presentation/', () => {
  assert.equal(BATCH6.length, 51, `批 6 是 51 个 path（收官破例一次：50 直删 + 1 搬运，实测 ${BATCH6.length}）`);
  assert.equal(new Set(BATCH6).size, BATCH6.length, '清单不许有重复 path');
  // ★ 码位序（`sort()`），不是 `localeCompare`（批 4 裁定②）—— 断的是**前 50 条**这个连续段
  assert.deepEqual([...PATHS].sort(), PATHS, '前 50 条必须按码位序（"接在批 5 之后的前缀"这个定义，顺序漂了就不是同一段）');
  assert.ok(PATHS[0]! > BATCH5_LAST, `本批首位必须接在批 5 末位之后（批 5 末位 ${BATCH5_LAST}；实测首位 ${PATHS[0]}）`);
  assert.equal(MIGRATED, 'src/infrastructure/analysis/observe/go_instrument.ts', '第 51 条必须恰好是登记为"搬运"的那一条（不许悄悄换人）');
  // 段位：首次落进 presentation/（批 5 首次跨出 analysis/，落进 authoring/ + daemon/）
  const infraRoot = BATCH6.filter((p) => /^src\/infrastructure\/[^/]+\.ts$/.test(p));
  const infraSub = BATCH6.filter((p) => /^src\/infrastructure\/[^/]+\//.test(p));
  const presentation = BATCH6.filter((p) => p.startsWith('src/presentation/'));
  assert.equal(infraRoot.length + infraSub.length + presentation.length, BATCH6.length, '本批 path 只该落在这三处');
  assert.equal(infraRoot.length, 12, `infrastructure/ 根文件段位（实测 ${infraRoot.length}）`);
  assert.equal(infraSub.length, 31, `infrastructure/<子目录>/ 段位（实测 ${infraSub.length}）`);
  assert.equal(presentation.length, 8, `presentation/ 段位（实测 ${presentation.length}）`);
  assert.ok(presentation.length > 0, '批 6 是 A 类批第一次落进 presentation/（这条本身是判据：字典序是跨目录的连续段）');
  // 子目录分布（逐条数出来的，不是估的）
  const hist: Record<string, number> = {};
  for (const p of infraSub) {
    const k = p.split('/').slice(0, 3).join('/') + '/';
    hist[k] = (hist[k] ?? 0) + 1;
  }
  assert.deepEqual(
    hist,
    {
      'src/infrastructure/graph/': 2,
      'src/infrastructure/index/': 7,
      'src/infrastructure/packages/': 2,
      'src/infrastructure/parse/': 10,
      'src/infrastructure/render/': 4,
      'src/infrastructure/rules/': 2,
      'src/infrastructure/text/': 3,
      'src/infrastructure/analysis/': 1,
    },
    `子目录分布：${JSON.stringify(hist)}`,
  );
});

test('6.3b 界外：2 条**带卡**的 path 没被收进本批，且**现盘上仍是界外**（留账，不是漏）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  for (const p of BOUNDARY_CARDS) assert.ok(!BATCH6.includes(p), `\`${p}\` 是界外（带卡）⇒ 不许混进本批清单`);
  const cardOn = (feature: string, p: string) => nodesOf(bookOf(feature)).find((n) => norm(n.path) === p)?.task as { state?: string } | undefined;
  // ★ 2026-11-18（批 10 · 甲′）：这两条进了 `PROSE_KEEP_OWNER` 显式名单 ⇒ 计划册侧节点已删（册上投影消失），
  //   卡本身一个字节没动（卡的家在 `tasks.db`，归批 16 卡收敛）。
  assert.equal(cardOn(TSP, 'src/domain/discussion_log.ts'), undefined, '`src/domain/discussion_log.ts` 的计划册侧节点已随批 10 删除（册上投影随之消失）');
  assert.equal(cardOn(AI, 'src/presentation/cli/cli.ts')?.state, 'candidate', '`src/presentation/cli/cli.ts` 的属主册侧卡必须还在（批 10 只删了非属主侧节点，卡一个字节没动）');
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/domain/discussion_log.ts').owner, AI, '这条 path 的域表属主：批 10 已改判给本体册（终态属主）');
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/presentation/cli/cli.ts').owner, AI, '这条 path 的域表属主是本体册（带卡的那一侧在属主册 ⇒ 更不能直删）');
  // 界外两条：批 10（甲′）已把它们收成单册 ⇒ 判据改成**两态择一**（仍是两册 = 未收 / 恰一册且是属主册 = 已收干净）
  const holdings = bookHoldings(repoSheets());
  for (const p of BOUNDARY_CARDS) {
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    assert.ok(
      feats.length === 2 || (feats.length === 1 && feats[0] === AI),
      `\`${p}\` 要么仍是两册持有（未收），要么已收成单册属主；实测 ${feats.join(' / ') || '无人持有'}`,
    );
  }
  // 留账必须写在**门档**里（机器可核的账），不是只写在交付书里
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as {
    multi_owned: { why?: string };
  };
  for (const p of BOUNDARY_CARDS) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着界外 \`${p}\`（否则下次没人知道它为什么没被收）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 6.4 搬运：叙事逐字节搬进属主册，计划册侧节点已删
// ════════════════════════════════════════════════════════════════════
test('6.4 搬运：`go_instrument.ts` 的 394 字叙事 + status + overlay 口供**逐字节**落在属主册同 path 节点上', () => {
  const ai = bookOf(AI);
  const node = nodesOf(ai).find((n) => norm(n.path) === MIGRATED);
  assert.ok(node, `属主册必须有 \`${MIGRATED}\` 的节点（否则叙事在哪？）`);
  assert.equal(node.id, nodeIdOf(MIGRATED), '搬运不许换 id（id 仍由 nodeIdOf 单点派生）');

  // ★ 内容指纹（不是"看起来有字"）：三个字段按固定顺序拼 JSON 的 sha256
  const d = (node.decision ?? {}) as Record<string, unknown>;
  const picked = { summary: String(d.summary ?? ''), rationale: String(d.rationale ?? ''), acceptance: String(d.acceptance ?? '') };
  const digest = createHash('sha256').update(JSON.stringify(picked), 'utf-8').digest('hex');
  assert.equal(digest, NARRATIVE_SHA256, `叙事内容变了（sha256 ${digest.slice(0, 16)}… ≠ ${NARRATIVE_SHA256.slice(0, 16)}…）—— 搬运是**逐字节**的，不是重写`);
  const chars = Object.values(picked).reduce((s, x) => s + x.trim().length, 0);
  assert.equal(chars, NARRATIVE_CHARS, `叙事字数必须仍是 ${NARRATIVE_CHARS}（实测 ${chars}）`);
  // 三个字段都在（summary 97 / rationale 115 / acceptance 182 —— 加起来才是 394）
  assert.deepEqual(proseOf(node), ['summary', 'rationale', 'acceptance'], `搬过去的散文键（实测 ${proseOf(node).join('+') || '空'}）`);

  // ★ 口供与进度也搬了：`status:done` + `overlay{progress:done, progress_evidence.kind=attestation}`
  assert.equal(String(node.status ?? ''), 'done', `属主册节点必须带 status=done（实测 ${String(node.status ?? '∅')}）`);
  const ov = (node.overlay ?? {}) as { progress?: string; progress_evidence?: { kind?: string; why?: string } };
  assert.equal(ov.progress, 'done', 'overlay.progress 必须搬过来（这是"T268 已落地"的口供所在）');
  assert.equal(ov.progress_evidence?.kind, 'attestation', 'progress_evidence.kind 必须是 attestation');
  assert.ok(String(ov.progress_evidence?.why ?? '').trim().length > 0, 'progress_evidence.why 不许空（口供的正文在 why 里）');

  // ★ 搬运**不是**搬判据：这条 path 上判据必须仍是 0（6.2 的 822 才成立）
  assert.equal(((node.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length, 0, '搬过去的不许带判据');

  // ★ 计划册侧节点已删：语义层里这条 path 也没了（否则"搬运后删"只做了一半）
  const tsp = bookOf(TSP);
  assert.equal(nodesOf(tsp).filter((n) => norm(n.path) === MIGRATED).length, 0, '计划册侧节点必须已删（搬完不删 = 双持还在）');
  assert.equal(semanticOf(tsp).filter((f) => norm(f.path) === MIGRATED).length, 0, '计划册侧语义条目必须已删');
});

// ════════════════════════════════════════════════════════════════════
// 6.4b ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('6.4b ② 档：这 51 个 path 的 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  const byPath = new Map(now.rows.map((r) => [r.path, r]));
  for (const p of BATCH6) {
    const row = byPath.get(p);
    assert.ok(row, `② 档必须逐条点名 \`${p}\`（rows 里没有它）`);
    assert.equal(row.klass, 'owned', `\`${p}\` 必须是 owned（实测 ${row.klass}）`);
    assert.equal(row.owner, AI, `\`${p}\` 的域表属主必须是 ${AI}（实测 ${row.owner}）`);
    assert.deepEqual([...new Set(row.holders.map((h) => h.feature))], [AI], `\`${p}\` 只该有一个持有者`);
  }
  // 分母还在（0.12：分子必须带分母）
  assert.ok(now.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR}；实测 ${now.paths}）—— 掉下去 = 有节点被删/有 path 被收走而没人登记`);
  assert.equal(now.books, 3, `册数不变（实测 ${now.books}）`);

  // ── 世界二：给计划册再造一个同 path 的空节点 ⇒ 这个 path 立刻变 multi_owned，且计数 +1 ──
  //   ★ 用**搬运**的那条来试：它是本批唯一"带叙事"的 path ⇒ 鉴别力必须与纯空壳同款。
  const p0 = MIGRATED;
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
  assert.equal(ownerOf(read.table as DesignBooksTable, p0).owner, AI, `\`${p0}\` 的属主必须仍是 ${AI}`);
});

// ════════════════════════════════════════════════════════════════════
// 6.5 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('6.5 写端：批 6 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 6 的删除是可逆的，收官也白收）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    // 属主册给同一 path 加**叙事 + 口供 + 一条判据**（与批 6 的搬运同形）⇒ 必须放行
    ai.geometry.nodes[0].status = 'done';
    ai.geometry.nodes[0].overlay = { path: 'src/x.ts', kind: 'file', progress: 'done', progress_evidence: { kind: 'attestation', why: '属主册写自己的 path 必须放行' } };
    ai.geometry.nodes[0].decision = {
      summary: '属主册写自己的 path 必须放行',
      rationale: '0.9：归属唯一的写端判据只该拦"别的册"，不拦属主',
      acceptance: '落盘且判据数 +1',
      expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '属主册写自己的 path 必须放行' }],
    };
    saveDSL(ai, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    assert.equal(after.geometry.nodes[0].decision.expectations.length, 1, '属主册加判据必须落盘');
    assert.equal(after.geometry.nodes[0].status, 'done', '属主册写 status 必须落盘（搬运的字段不是"只读装饰"）');
    assert.equal(after.geometry.nodes[0].overlay?.progress, 'done', '属主册写 overlay 必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 6.6 新门档：多册持有 ≤ 157（批 6 收 −51：208 → 157），且指纹与基线逐字一致
// ════════════════════════════════════════════════════════════════════
test('6.6 门档：多册持有只许不增（批 6 收口 157 = 208 − 51）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  // ★ 棘轮（只许不增），不钉"当前值"：批 8–13 会继续往下走（157 → … → 0），那是批计划的账，不是本批的回退
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B6,
    `多册持有只许不增（批 6 收口 ${MULTI_OWNED_AFTER_B6}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：208 − 157 = 51 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B6 - MULTI_OWNED_AFTER_B6, BATCH6.length, '批 6 的降幅必须逐字等于本批 path 数（50 直删 + 1 搬运）');
  // 逐条不在坏集合（这一条永久真，不随批漂）
  for (const p of BATCH6) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（本批只删非属主侧节点，没搬判据）`);
  }

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

// ════════════════════════════════════════════════════════════════════
// 6.7 A 类空壳清零（"收官"这个名字的唯一机器定义）
// ════════════════════════════════════════════════════════════════════
test('6.7 **A 类空壳清零**：现盘复算（双持 ∧ 0 判据 ∧ 0 职责 ∧ 0 卡 ∧ 0 散文）⇒ 0 条；剩下的双持 path 每个都带负载', () => {
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  const byFeature = new Map(sheets.map((s) => [s.feature, s]));
  const holdersOf = (p: string) => [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
  const respOn = (feature: string, p: string) => {
    const s = byFeature.get(feature);
    return s ? semanticOf(s).filter((f) => norm(f.path) === p).map((f) => String(f.responsibility ?? '').trim()).join('') : '';
  };

  const shells: string[] = [];
  const doubleHeld: string[] = [];
  for (const [p] of holdings) {
    const feats = holdersOf(p);
    if (feats.length !== 2) continue;
    doubleHeld.push(p);
    const zeroExp = (holdings.get(p) ?? []).every((h) => h.expectations === 0);
    const noResp = feats.every((f) => !respOn(f, p));
    const noCard = feats.every((f) => nodesOf(byFeature.get(f)!).every((n) => !(n.task as { state?: string } | undefined)?.state));
    const noProse = feats.every((f) => nodesOf(byFeature.get(f)!).every((n) => proseOf(n).length === 0));
    if (zeroExp && noResp && noCard && noProse) shells.push(p);
  }
  assert.deepEqual(shells, [], `A 类空壳必须清零（实测还剩 ${shells.length} 条：${shells.slice(0, 5).join(', ')}）`);
  // ★ 分母必须带上：清零说的是"双持 157 个 path 里 0 个是空壳"，不是"没有双持了"
  //   ★ 2026-11-18（批 8）：分母从常量 157 改成**门档的现读数** —— 批 8 收走 25 条 B 类后双持是 132，
  //     而这条要断的是"空壳清零的分母与门档同口径"，不是"双持永远 157"（那会在批 9–13 每批都误红）。
  const baselineNow = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as {
    multi_owned: { count: number };
  };
  assert.equal(doubleHeld.length, baselineNow.multi_owned.count, `双持分母必须与门档同口径（实测 ${doubleHeld.length} / 门档 ${baselineNow.multi_owned.count}）`);
  // ★ 2026-11-18（批 14 · D2 终局）：多册持有**已归零** ⇒ "双持 > 0" 这条历史前提退役。
  //   归零之后这条要断的是**同一个口径**（现盘 0 = 门档 0 = 空壳 0），而不是"永远 > 0"。
  if (doubleHeld.length === 0) {
    assert.equal(baselineNow.multi_owned.count, 0, '双持归零必须是**账上也是 0**（不是现盘悄悄为 0 而门档还挂着数）');
    assert.deepEqual(shells, [], '双持归零 ⇒ 空壳必然 0（这条与上面那句互相印证）');
  }
  assert.ok(doubleHeld.length <= baselineNow.multi_owned.count, `双持只许不增（实测 ${doubleHeld.length} / 门档 ${baselineNow.multi_owned.count}）`);
  // 每一条剩下的双持 path 必须**至少带一种负载**（这就是"空壳清零"的反面表述，逐条核）
  for (const p of doubleHeld) {
    const feats = holdersOf(p);
    const hasPayload =
      (holdings.get(p) ?? []).some((h) => h.expectations > 0) ||
      feats.some((f) => respOn(f, p)) ||
      feats.some((f) => nodesOf(byFeature.get(f)!).some((n) => (n.task as { state?: string } | undefined)?.state)) ||
      feats.some((f) => nodesOf(byFeature.get(f)!).some((n) => proseOf(n).length > 0));
    assert.ok(hasPayload, `\`${p}\` 仍是双持却**没有任何负载** ⇒ 它是漏收的空壳（该进批 6 的清单）`);
  }
});
