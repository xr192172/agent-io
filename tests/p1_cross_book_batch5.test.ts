/**
 * P1 · T-#A8A9-CROSS-BOOK **批 5**（A 类空壳第四段：50 个 path，删计划册侧节点，**0 搬运**）—— 红 → 绿。
 *
 * ## 这批要立的七条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 5.1 | 50 个 path **各恰一册**持有，且是 `agent-io`；计划册侧节点 / 语义 / 边全没了 | 半删（幽灵节点、悬空边）在这里红 |
 * | 5.2 | 判据**总数守恒**（A 类零负载 ⇒ 839 一条不动；822 ⇒ 826 ⇒ **839** 的两次合法变化都记在下面常量注里） | 删错一侧（删到有判据的那侧）立刻少几条 |
 * | 5.3 | 清单就是**批 5 的清单**（**码位序**接批 4 的第四段 · 首次跨出 `analysis/` 落进 `authoring/` + `daemon/`） | 手抄错一条 / 顺序漂了都在这里红 |
 * | 5.3b | 三条**界外**没被偷偷收进本批：2 条带卡（`discussion_log.ts` / `cli.ts`）+ 1 条**非属主侧带 decision 散文**（`go_instrument.ts`），且三条**现盘上仍是界外**（清单过期会在这里红） | 把任一条混进来 ⇒ 前置 exit 3（消融 §2.4 四世界），这里红 |
 * | 5.4 | ② 档：这 50 个 path 的 klass = `owned`；把它们塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 5.5 | 写端：删完之后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是"一刀切"） |
 * | 5.6 | 门档：多册持有 ≤ 208（批 5 收 −50：258 → 208）；三组集合指纹与 `design-books-baseline.json` 逐字一致 | 谁改了册而不改基线，这里红（**钉的是棘轮 ≤208 与 258−208=50**，不是"当前值 = 208"） |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2/3/4 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 50 个 path 恰一册持有"·"判据总数守恒"），
 *   **不断**会随批下降的单册读数（`tsp` 的 206 条在批 9–13 会继续降，那不是本批的账）；
 * · 门档断的是**集合指纹与基线逐字一致**（谁改了册而不改基线，这里红），不是"多册持有 = 0"（那是批 13 之后的终局）。
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ 批 4 裁定②：清单顺序的权威是**默认 `sort()`（码位序）**，不是 `localeCompare`
 *   （`localeCompare` 把 `_` 排在 `.` 之前，码位序反之；本批清单里 `adapters/*.ts` 与 `daemon/client.ts` 都踩不到，
 *   但断言必须与"字典序"这句话同一个口径）。
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
 * 批 5 的 50 个 path（**剩余**可收 A 类空壳的码位序前 50；批 2/3/4 收掉了前 150）。
 * 与批 4 的 `plan2.tail`（100 条）**集合逐条相同**（已实测：只在批5=0 / 只在批4=0），本批取前 50。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（5.1/5.4/5.5）就无处可断。
 * ★ 段位：`analysis/{refactor,rename_symbol,structure,submit_gate}` 26 + `authoring/{translate,version_upgrade}` 23
 *   + `daemon/client.ts` 1 = 50 ⇒ **A 类批第一次跨出 `src/infrastructure/analysis/**`**（批 2 在 dogfood/scripts/application，
 *   批 3/4 全在 analysis/）。这条本身是判据：字典序在这里是跨目录的连续段，不是"一个目录一批"。
 */
const PATHS = [
  'src/infrastructure/analysis/refactor/langs/java/executor.ts',
  'src/infrastructure/analysis/refactor/langs/java/layering.ts',
  'src/infrastructure/analysis/refactor/langs/python/dead_imports.ts',
  'src/infrastructure/analysis/refactor/langs/python/index.ts',
  'src/infrastructure/analysis/refactor/langs/python/verify_commands.ts',
  'src/infrastructure/analysis/refactor/protect.ts',
  'src/infrastructure/analysis/refactor/refactor_langs.ts',
  'src/infrastructure/analysis/rename_symbol/core.ts',
  'src/infrastructure/analysis/rename_symbol/index.ts',
  'src/infrastructure/analysis/rename_symbol/languages/c.ts',
  'src/infrastructure/analysis/rename_symbol/languages/cs.ts',
  'src/infrastructure/analysis/rename_symbol/languages/go.ts',
  'src/infrastructure/analysis/rename_symbol/languages/java.ts',
  'src/infrastructure/analysis/rename_symbol/languages/py.ts',
  'src/infrastructure/analysis/rename_symbol/languages/registry.ts',
  'src/infrastructure/analysis/rename_symbol/languages/ts.ts',
  'src/infrastructure/analysis/rename_symbol/namespace_family.ts',
  'src/infrastructure/analysis/rename_symbol/parts.ts',
  'src/infrastructure/analysis/structure/analyze_monolith.ts',
  'src/infrastructure/analysis/structure/arch_layer.ts',
  'src/infrastructure/analysis/structure/cfg.ts',
  'src/infrastructure/analysis/structure/derive_feature_tree.ts',
  'src/infrastructure/analysis/structure/layer_detect.ts',
  'src/infrastructure/analysis/structure/monolith.ts',
  'src/infrastructure/analysis/structure/role_title.ts',
  'src/infrastructure/analysis/submit_gate/index.ts',
  'src/infrastructure/authoring/translate/const_eval.ts',
  'src/infrastructure/authoring/translate/fixers.ts',
  'src/infrastructure/authoring/translate/llm.ts',
  'src/infrastructure/authoring/translate/prompts.ts',
  'src/infrastructure/authoring/translate/referenced.ts',
  'src/infrastructure/authoring/translate/tool.ts',
  'src/infrastructure/authoring/translate/unit.ts',
  'src/infrastructure/authoring/translate/verify.ts',
  'src/infrastructure/authoring/translate/verify_behavior.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/c.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/csharp.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/go.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/java.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/node.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/python.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/registry.ts',
  'src/infrastructure/authoring/version_upgrade/adapters/types.ts',
  'src/infrastructure/authoring/version_upgrade/detect.ts',
  'src/infrastructure/authoring/version_upgrade/features.ts',
  'src/infrastructure/authoring/version_upgrade/gate.ts',
  'src/infrastructure/authoring/version_upgrade/removed.ts',
  'src/infrastructure/authoring/version_upgrade/rewrite.ts',
  'src/infrastructure/authoring/version_upgrade/toolchain.ts',
  'src/infrastructure/daemon/client.ts',
];

/** 批 4 的末位（"第五段接在它之后"这句话的锚点） */
const BATCH4_LAST = 'src/infrastructure/analysis/project_root/index.ts';

/**
 * 批 5 的三条**界外**（故意不收，一条都没动）。
 * | path | 为什么不是零负载 | 处置 |
 * |---|---|---|
 * | `src/domain/discussion_log.ts` | 域表属主是**计划册** + 计划册侧 `candidate` 卡 | 跳过（属主不是 agent-io ⇒ 连"删非属主侧"都要另判） |
 * | `src/presentation/cli/cli.ts` | **属主册侧** `candidate` 卡 | 跳过（A 类定义 = 四零，卡在任一侧都不算空壳；批 2/3/4 起就登记着） |
 * | `src/infrastructure/analysis/observe/go_instrument.ts` | **计划册侧节点带 decision 散文**（summary 97 + rationale 115 + acceptance 182 = 394 字，tsp 独有，agent-io 侧一片空白） | 跳过（删节点会连带删掉这段叙事 = 批 8 型的活，不是空壳直删；批 4 §3.1 的绊线） |
 * 三条都**现盘上仍是界外**（不是"清单里没写就算"）：下面 5.3b 逐条核它们的负载还在。
 */
const BOUNDARY = {
  cards: ['src/domain/discussion_log.ts', 'src/presentation/cli/cli.ts'],
  prose: 'src/infrastructure/analysis/observe/go_instrument.ts',
} as const;
const DEFERRED = [...BOUNDARY.cards, BOUNDARY.prose];

/** 批 5 的判据守恒读数（A 类零负载 ⇒ 删 50 个节点，一条判据都不动） */
// ★ 2026-11-18：822 → 826 —— globals-fix 两卡合法 +4（merge b7b89f24）；批 6 后 lead 又将其中 2 条
//   迁回属主册 tsp（一 path 一册断言不变量，batch1 1.3 实测冲突修复），总数不变分册变。
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
 * `多册持有`：批 4 收口 258 → 批 5 再收 50 = **208**。
 * ★ 208 是**上限**（棘轮），不是"永远等于"：批 6 起它会继续往下走（批 3 §3.2 的双 Δ 判据）。
 *   会漂的"当前值"不许钉进证里（批 2 的证钉过 358，批 3 落地就把那条打红了）。
 */
const MULTI_OWNED_BEFORE_B5 = 258;
const MULTI_OWNED_AFTER_B5 = 208;

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
function criteriaTotal(sheets: readonly BookSheetLike[]): number {
  let n = 0;
  for (const s of sheets) for (const node of nodesOf(s)) n += ((node.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length;
  return n;
}
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

// ════════════════════════════════════════════════════════════════════
// 5.1 50 个 path 各恰一册持有（agent-io），计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('5.1 真仓：50 个 path 各自**恰一册**持有，且持有者是 agent-io（批 5 前是两册各一节点）', () => {
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

test('5.1b 计划册里这 50 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）', () => {
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
// 5.2 判据总数守恒
// ════════════════════════════════════════════════════════════════════
test('5.2 判据总数守恒：三册合计 839 条（A 类零负载 ⇒ 删 50 个节点一条判据不动）', () => {
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
// 5.3 清单就是批 5 的清单
// ════════════════════════════════════════════════════════════════════
test('5.3 清单形状：50 条 · 无重复 · 码位序已排好 · 接在批 4 末位之后 · 首次跨出 analysis/', () => {
  assert.equal(PATHS.length, 50, `批 5 是 50 个 path（≤50 的硬上限，实测 ${PATHS.length}）`);
  assert.equal(new Set(PATHS).size, PATHS.length, '清单不许有重复 path');
  // ★ 码位序（`sort()`），不是 `localeCompare`（批 4 裁定②）
  assert.deepEqual([...PATHS].sort(), PATHS, '清单必须按码位序（"第四段"的定义就是接在批 4 之后的前缀，顺序漂了就不是同一段）');
  assert.ok(PATHS[0]! > BATCH4_LAST, `本批首位必须接在批 4 末位之后（批 4 末位 ${BATCH4_LAST}；实测首位 ${PATHS[0]}）`);
  // 段位：首次跨出 analysis/（批 3/4 全在 analysis/ 下）
  const inAnalysis = PATHS.filter((p) => p.startsWith('src/infrastructure/analysis/'));
  const inAuthoring = PATHS.filter((p) => p.startsWith('src/infrastructure/authoring/'));
  const inDaemon = PATHS.filter((p) => p.startsWith('src/infrastructure/daemon/'));
  assert.equal(inAnalysis.length + inAuthoring.length + inDaemon.length, PATHS.length, '本批 path 只该落在这三处');
  assert.equal(inAnalysis.length, 26, `analysis/ 段位（实测 ${inAnalysis.length}）`);
  assert.equal(inAuthoring.length, 23, `authoring/ 段位（实测 ${inAuthoring.length}）`);
  assert.equal(inDaemon.length, 1, `daemon/ 段位（实测 ${inDaemon.length}）`);
  assert.ok(inAuthoring.length > 0 && inDaemon.length > 0, '批 5 是 A 类批第一次跨出 analysis/（这条本身是判据：字典序是跨目录的连续段）');
  const bucket = (p: string) => {
    const seg = p.split('/');
    return (seg.length > 4 ? seg.slice(0, 4) : seg.slice(0, 3)).join('/') + '/';
  };
  const hist: Record<string, number> = {};
  for (const p of PATHS) hist[bucket(p)] = (hist[bucket(p)] ?? 0) + 1;
  assert.deepEqual(
    hist,
    {
      'src/infrastructure/analysis/refactor/': 7,
      'src/infrastructure/analysis/rename_symbol/': 11,
      'src/infrastructure/analysis/structure/': 7,
      'src/infrastructure/analysis/submit_gate/': 1,
      'src/infrastructure/authoring/translate/': 9,
      'src/infrastructure/authoring/version_upgrade/': 14,
      'src/infrastructure/daemon/': 1,
    },
    `目录分布：${JSON.stringify(hist)}`,
  );
});

test('5.3b 界外：2 条带卡 + 1 条非属主侧带 decision 散文的 path 没被收进本批，且**现盘上仍是界外**（留账，不是漏）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  for (const p of DEFERRED) {
    assert.ok(!PATHS.includes(p), `\`${p}\` 是界外（带卡 / 带散文）⇒ 不许混进本批清单`);
  }
  // ① 带卡的两条：卡必须**还在册上**（否则它们就该进某个 A 类批的清单了 —— 清单过期会在这里红）
  const cardOn = (feature: string, p: string) =>
    nodesOf(bookOf(feature)).find((n) => norm(n.path) === p)?.task as { state?: string } | undefined;
  // ★ 2026-11-18（批 10 · 甲′）：这两条 A 类带卡空壳进了 `PROSE_KEEP_OWNER` 显式名单 ⇒ 计划册侧节点已删
  //   （册上 `node.task` 投影随之消失），**卡本身一个字节没动**（卡的家在 `tasks.db`，归批 16 卡收敛）。
  assert.equal(cardOn(TSP, 'src/domain/discussion_log.ts'), undefined, '`src/domain/discussion_log.ts` 的计划册侧节点已随批 10 删除（册上投影随之消失）');
  assert.equal(cardOn(AI, 'src/presentation/cli/cli.ts')?.state, 'candidate', `\`src/presentation/cli/cli.ts\` 的属主册侧卡必须还在（批 10 只删了非属主侧节点，卡一个字节没动）`);
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/domain/discussion_log.ts').owner, AI, '这条 path 的域表属主：批 10 已改判给本体册（终态属主）');
  assert.equal(ownerOf(read.table as DesignBooksTable, 'src/presentation/cli/cli.ts').owner, AI, '这条 path 的域表属主是本体册（带卡的那一侧在属主册 ⇒ 更不能直删）');
  // ② 带散文的那条：属主是本体册，但**非属主侧**的节点带着 tsp 独有的叙事 ⇒ 删它 = 删叙事（批 8 型的活）
  //    ★★ 批 6 把它收了，而且正是按"批 8 型"收的（叙事**先搬进属主册**、逐字节相同，再删计划册侧）。
  //       所以这条绊线**换了另一半**而不是被删掉：断"计划册侧副本没了 + 叙事没丢"，见 p1_cross_book_batch6 的 6.4。
  assert.equal(ownerOf(read.table as DesignBooksTable, BOUNDARY.prose).owner, AI, '这条 path 的域表属主是本体册');
  const tspNode = nodesOf(bookOf(TSP)).find((n) => norm(n.path) === BOUNDARY.prose);
  assert.equal(tspNode, undefined, `\`${BOUNDARY.prose}\` 的计划册侧节点必须已经没了（批 6 搬运后删）`);
  const aiNode = nodesOf(bookOf(AI)).find((n) => norm(n.path) === BOUNDARY.prose);
  assert.ok(aiNode, `\`${BOUNDARY.prose}\` 的叙事必须落在属主册（否则批 6 就成了"只删不搬" = 删了叙事）`);
  assert.ok(proseOf(aiNode).length > 0, `\`${BOUNDARY.prose}\` 在属主册上必须**仍带着**那段叙事（批 6 的搬运落点）`);
  // ③ 带卡的两条：批 10（甲′）已把它们收成单册（计划册侧节点删除）⇒ 判据改成**两态择一**
  //    （仍是两册 = 未收 / 恰一册且是属主册 = 已收干净）；半收照样红。
  const holdings = bookHoldings(repoSheets());
  for (const p of BOUNDARY.cards) {
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    assert.ok(
      feats.length === 2 || (feats.length === 1 && feats[0] === AI),
      `\`${p}\` 要么仍是两册持有（未收），要么已收成单册属主；实测 ${feats.join(' / ') || '无人持有'}`,
    );
  }
  // ④ 留账必须写在**门档**里（机器可核的账），不是只写在交付书里
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as {
    multi_owned: { why?: string };
  };
  for (const p of DEFERRED) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着界外 \`${p}\`（否则下次没人知道它为什么没被收）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 5.4 ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('5.4 ② 档：这 50 个 path 的 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
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
  assert.ok(now.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR}；实测 ${now.paths}）—— 掉下去 = 有节点被删/有 path 被收走而没人登记`);
  assert.equal(now.books, 2, `册数：**批 17 计划册退役** ⇒ 3 → 2（实测 ${now.books}）`);

  // ── 世界二：给计划册再造一个同 path 的空节点 ⇒ 这个 path 立刻变 multi_owned，且计数 +1 ──
  const p0 = PATHS[0] as string;
  const twoWorld = [...sheets, { feature: TSP, geometry: { nodes: [{ id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }] } } as unknown as BookSheetLike & { feature: string }];
  const two = crossBookOwnership(twoWorld, read);
  const row2 = two.rows.find((r) => r.path === p0);
  assert.equal(row2?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned（实测 ${row2?.klass}）`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
  const hit = ownerOf(read.table as DesignBooksTable, p0);
  assert.equal(hit.owner, AI, `\`${p0}\` 的属主必须仍是 ${AI}（实测 ${hit.owner}）`);
});

// ════════════════════════════════════════════════════════════════════
// 5.5 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('5.5 写端：批 5 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 5 的删除是可逆的，14 批都白做）',
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
// 5.6 新门档：多册持有 ≤ 208（批 5 收 −50：258 → 208），且指纹与基线逐字一致
// ════════════════════════════════════════════════════════════════════
test('5.6 门档：多册持有只许不增（批 5 收口 208 = 258 − 50）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  // ★ 棘轮（只许不增），不钉"当前值"：批 6 起这个数会继续往下走（208 → … → 0），那是批计划的账，不是本批的回退
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B5,
    `多册持有只许不增（批 5 收口 ${MULTI_OWNED_AFTER_B5}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：258 − 208 = 50 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B5 - MULTI_OWNED_AFTER_B5, PATHS.length, '批 5 的降幅必须逐字等于本批 path 数（A 类零例外）');
  // 逐条不在坏集合（这一条永久真，不随批漂）
  for (const p of PATHS) {
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
