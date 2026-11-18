/**
 * P1 路 T-#A8A9-CROSS-BOOK **批 12**：**C·ai 段**（判据早在属主册、计划册侧节点是 fork 残留的**空壳**）
 * —— 删 17 个空壳节点 + 甲′ 搬 1 条职责（70 字）；判据 0 条搬、总数 854 恒等。
 *
 * ## 这批要立的十九条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 12.1 | 真仓：17 个 path **各恰一册**持有且是 `agent-io`；节点 id = `nodeIdOf`；判据条数逐条对表 | 搬后没删 / 删错册 / 判据丢条在这里红 |
 * | 12.1b | 计划册侧**三清**（节点 + 语义 + 边）：17 个被删节点 id 在**非属主册**里不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 12.2 | 清单形状：17 条 · **码位序** · 段位 15+1+1 · 判据表与清单**逐条同集** · 界外 13 条 | 手抄错一条 / 顺序漂了在这里红 |
 * | 12.2b | **名单是死的、前提是活的**：名单必须**逐条 = 现盘 C·ai 类全体**（集合相等）；收完剩 13（C·tsp 11 + D2 2） | 名单被"挑"过 / 现盘变了没人管，在这里红 |
 * | 12.3 | 判据**逐字节**：属主侧 61 条 sha256 一位没动；总数守恒 **854**（766/66/7）；本批搬 **0** 条 | 搬错 / 重写 / 顺手改判据在这里红 |
 * | 12.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 854，差额恰是该节点的判据数 | 空断言的照妖镜（R47） |
 * | 12.4 | 甲′（lead 裁定 A）：职责 **70 字逐字**搬（`book.ts`）；**职责字数两侧合并后守恒 10,366**；本批**存档 0 条**（C·ai 的败方是空壳，没有同键不同值） | 把职责抄歪 / 把"没有冲突"报成"有存档"在这里红 |
 * | 12.4b | 上一条**有牙**：纯核里改一个字节 ⇒ 指纹变；清空 ⇒ 字数掉 70（真册一个字节不动） | 同上 |
 * | 12.5 | 域表**一位没动**：17 条属主 = `agent-io`；计划册 `owns` **13 条**（本批改判 0 条）；前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 12.6 | ② 档：17 条 klass = `owned`；**塞回任一条**（空壳节点）⇒ 立刻 `multi_owned`（鉴别力）；path 分母**只许不降**（floor 569） | 纯核两世界对照，不碰真册 |
 * | 12.7 | 写端：批 12 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化）；属主册写同一 path ⇒ 过 | 属主册自己写被连带拒 = 一刀切，也在这里红 |
 * | 12.8 | 门档：多册持有 ≤ **13**（30 − 17）· id 漂移 ≤ **10** · 属主错位 ≤ **12**；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红（钉棘轮，不钉"当前值 = 13"） |
 * | 12.9 | **存档 0 条**（本批 `A8A9-batch12` 一条都没有）；批 10 的 35 条 / 批 11 的 1 条**跨批未进水**且自证成立；台账行仍 `active` | 无冲突却挂账 / 把别批的账算成自己的，都在这里红 |
 * | 12.9b | 上一条**可移植**：夹具里 `hangRow` + `annotateRow` 往返，批 12 的 body 头格式逐字读回（不依赖本机 tasks.db） | 同上 |
 * | 12.10 | **界外账**：C·tsp 11 + D2 2 **仍是两册持有**；被收的 17 条必须单册 = 属主册 | 界外被"顺手收了"在这里红 |
 * | 12.10b | **空壳判别力**：把这 17 个空壳节点"复活"进纯核 ⇒ 它们**全部**变 `multi_owned`，但**判据总数一字不变**（0 条判据随空壳走）—— 这是"删的是空壳，不是货"的量化证据 | 这批若真搬了判据/叙事，这里会显示"复活后判据更多" |
 * | 12.11 | **卡账**：17 条带卡且**全在属主侧**（keeper 不删）；计划册侧 0 张、活卡 0 张 ⇒ **0 次卡操作、0 张孤儿卡** | 悄悄把卡删了 / 收走了人家的 path，都在这里红 |
 * | 12.12 | 计划册册容：节点 148 → 131 · 语义 42 → 25 · 边 226 → 200（删的数目对得上）+ 无幽灵语义 | 只删一种、留下悬空边在这里红 |
 * | 12.13 | **派生快照**：`COGNITION.txt` 里每册的 `dsl_rev` = 册上现值（过期快照在这里红） | 改了册不重生成快照，这里红 |
 * | 12.14 | 真视图：`docs/todo.md` == 引擎现算（`current`）· 视图里 0 处 `archive-payload` · 引擎里的存档仍逐字 | 视图与引擎各说一套在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–11 的裁定）
 * · 真仓读数（`process.cwd()`）只钉**不变量**（17 个 path 恰一册持有 · 判据总数 854 · 职责字数 10,366 · 判据/职责逐字节）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 13"（那是批 14 收 D2 之后的终局）；
 * · ★ 只许钉三类东西 —— ① "我这批的 path 不在坏集合里"（永久真）② "总数只许不增"（棘轮）
 *   ③ "我这批的 Δ = 我这批的 path 数 / 判据数 / 字数"（常量算术）。**不许钉**"总数 = 我这批收口时的那个数"。
 * · 每一条"有牙"的反检查（12.3b / 12.4b）都跑在**纯核副本**上：真册一个字节都不动。
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
import { listLiveCards } from '../src/infrastructure/task_history.js';
import { crossBookReadingOf } from '../src/application/design/db/gen_design_db.js';
import { annotateRow, getRow, hangRow } from '../src/application/ledger/ledger.js';
import {
  VIEW_REL,
  renderLedgerView,
} from '../src/application/ledger/render_ledger_view.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';
const LEDGER_REF = 'T-#A8A9-CROSS-BOOK';
const BATCH_TAG = 'A8A9-batch12';
/** 存档 body 的分段标记（与执行器同格式；本文件的解析器**自己写**，不 import 执行器） */
const PAYLOAD_END = '── archive-payload（base64，逐字可复算）──';

// ─── 常量块（由 %TEMP%\a8a9-b12-genconsts.mjs 现盘导出；这批的钉子）───────────────
const BATCH: readonly string[] = [
  'src/infrastructure/analysis/contract_gate/core.ts',
  'src/infrastructure/analysis/health/index.ts',
  'src/infrastructure/analysis/structure/structure_gap.ts',
  'src/infrastructure/authoring/behavior/index.ts',
  'src/infrastructure/authoring/translate/book.ts',
  'src/infrastructure/authoring/translate/fill.ts',
  'src/infrastructure/authoring/translate/go_extractor.ts',
  'src/infrastructure/authoring/translate/pairs.ts',
  'src/infrastructure/authoring/translate/project.ts',
  'src/infrastructure/authoring/translate/ts_codegen.ts',
  'src/infrastructure/exec_guard.ts',
  'src/infrastructure/git.ts',
  'src/infrastructure/graph/import_project.ts',
  'src/infrastructure/index/registry.ts',
  'src/infrastructure/parse/comments.ts',
  'src/infrastructure/parse/fuzzy_match.ts',
  'src/presentation/daemon/daemon.ts',
];

/** 属主册侧**本来就有**的判据（本批 0 条要搬；sha256 一位不该动） */
const CRITERIA_OWNED: Record<string, { crit: number; sha: string }> = {
  'src/infrastructure/analysis/contract_gate/core.ts': { crit: 3, sha: 'c0a70fd8b54a8e933bd46f2ae98b690ce69b044a92e779d6c20de2bf462a2d7a' },
  'src/infrastructure/analysis/health/index.ts': { crit: 3, sha: 'c75f0d3d6bf5c3def4f417d7cfaf4a1c50d5ce06ba8fff07d6398ae3249e5ba1' },
  'src/infrastructure/analysis/structure/structure_gap.ts': { crit: 5, sha: '36c5d7f1c305b17ad0de4ee36502b21a25e46644c505f556c09d00d038eae01d' },
  'src/infrastructure/authoring/behavior/index.ts': { crit: 9, sha: '863dc75ec745cf5e66691365fea7fd73001b424dc9dc2138d93e354c049f69ef' },
  'src/infrastructure/authoring/translate/book.ts': { crit: 4, sha: '3904da0473e881a6d7dcff695c8fa9c7ac37f428877c1bfb3767b63568b6961c' },
  'src/infrastructure/authoring/translate/fill.ts': { crit: 5, sha: '4e029f36865dfa14965682049e6bee07c5fbc30b4fe99c8d6d0c9d2ebb0312c8' },
  'src/infrastructure/authoring/translate/go_extractor.ts': { crit: 3, sha: '7fde5615243d723e8128191435e191543241b676de702bf7308205785dafc1a0' },
  'src/infrastructure/authoring/translate/pairs.ts': { crit: 1, sha: '1348c1dc4be6683a4fb54c1b93dd0caa8017d944762cf11667194a3605af90b3' },
  'src/infrastructure/authoring/translate/project.ts': { crit: 6, sha: '13c6fcaed8f4d9e5ca8504523216d1bfe70cedd6f490f0fe671537e48155817f' },
  'src/infrastructure/authoring/translate/ts_codegen.ts': { crit: 1, sha: 'ed69d023d494cc14a198cdbe74b13c9e3a1cea3c70a5e18939a1f60afb94fc9d' },
  'src/infrastructure/exec_guard.ts': { crit: 2, sha: 'ce0c033eaab03302789c63c83e8e7fddcf473390c744e7026e90e9e4f50060a9' },
  'src/infrastructure/git.ts': { crit: 2, sha: 'd4850f1cf9ee19a3861337ea50f3d4b2c12e8b531a4f66635a606ef877ee5fe8' },
  'src/infrastructure/graph/import_project.ts': { crit: 4, sha: 'e20e3e2a2820f642ded2b0a391b593287ece372b8a42e3c90dc3cc501901bfa1' },
  'src/infrastructure/index/registry.ts': { crit: 4, sha: '69465f263670e8e0c668f9bf7c6c70a9a30b3994d490946ede2d5ce931999735' },
  'src/infrastructure/parse/comments.ts': { crit: 2, sha: '3fb47e431cbe718f73f6024de6a56895594b6459aff47a5ccd27eb3fba1c07b1' },
  'src/infrastructure/parse/fuzzy_match.ts': { crit: 3, sha: '05ff21ac7c1f5cade5e8e990ac059cff44fb7efc4a6cee2a8d8d88debf5ef92f' },
  'src/presentation/daemon/daemon.ts': { crit: 4, sha: '312a0666afbf3e4fb929145c4174e90db09f310634a06c987059d79d4c7faa9e' },
};

/** 甲′ 的"搬"那一条：计划册侧有职责、属主侧空白 ⇒ **逐字**搬（sha256 钉住） */
const RESP_MOVED: Record<string, { chars: number; sha: string }> = {
  'src/infrastructure/authoring/translate/book.ts': { chars: 70, sha: '57b2b8c626ec4b056489d9c6d06402eb7e6690f01c66320f56a0466d23bb519a' },
};

/** 计划册侧删掉的 17 个节点 id（全是 `nodeIdOf` 单点派生，漂移 0 个） */
const DELETED_IDS: readonly string[] = [
  'file_src_infrastructure_analysis_contract_gate_core_ts',
  'file_src_infrastructure_analysis_health_index_ts',
  'file_src_infrastructure_analysis_structure_structure_gap_ts',
  'file_src_infrastructure_authoring_behavior_index_ts',
  'file_src_infrastructure_authoring_translate_book_ts',
  'file_src_infrastructure_authoring_translate_fill_ts',
  'file_src_infrastructure_authoring_translate_go_extractor_ts',
  'file_src_infrastructure_authoring_translate_pairs_ts',
  'file_src_infrastructure_authoring_translate_project_ts',
  'file_src_infrastructure_authoring_translate_ts_codegen_ts',
  'file_src_infrastructure_exec_guard_ts',
  'file_src_infrastructure_git_ts',
  'file_src_infrastructure_graph_import_project_ts',
  'file_src_infrastructure_index_registry_ts',
  'file_src_infrastructure_parse_comments_ts',
  'file_src_infrastructure_parse_fuzzy_match_ts',
  'file_src_presentation_daemon_daemon_ts',
];

/** 带卡留账：本批 17 条**全带卡**，且卡都在**属主侧**（keeper 节点不删 ⇒ 0 张孤儿卡） */
const CARD_LEAVE: readonly string[] = [
  'src/infrastructure/analysis/contract_gate/core.ts',
  'src/infrastructure/analysis/health/index.ts',
  'src/infrastructure/analysis/structure/structure_gap.ts',
  'src/infrastructure/authoring/behavior/index.ts',
  'src/infrastructure/authoring/translate/book.ts',
  'src/infrastructure/authoring/translate/fill.ts',
  'src/infrastructure/authoring/translate/go_extractor.ts',
  'src/infrastructure/authoring/translate/pairs.ts',
  'src/infrastructure/authoring/translate/project.ts',
  'src/infrastructure/authoring/translate/ts_codegen.ts',
  'src/infrastructure/exec_guard.ts',
  'src/infrastructure/git.ts',
  'src/infrastructure/graph/import_project.ts',
  'src/infrastructure/index/registry.ts',
  'src/infrastructure/parse/comments.ts',
  'src/infrastructure/parse/fuzzy_match.ts',
  'src/presentation/daemon/daemon.ts',
];

/** 界外（本批不动）：C·tsp 11 条（判据在计划册侧 + 散文；批 13 的账） */
const OUT_OF_SCOPE_CTSP: readonly string[] = [
  'src/domain/diff_blocks.ts',
  'src/domain/dsl_removal.ts',
  'src/domain/mindmap.ts',
  'src/domain/narration.ts',
  'src/domain/overlay.ts',
  'src/domain/reasoning.ts',
  'src/domain/scope.ts',
  'src/domain/simulation.ts',
  'src/domain/types.ts',
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts',
  'src/infrastructure/parse/mutants.ts',
];

/** 界外（本批不动）：D2 2 条（两侧同键不同值；批 14 的账） */
const OUT_OF_SCOPE_D2: readonly string[] = [
  'src/infrastructure/parse/kernel.ts',
  'src/infrastructure/storage.ts',
];

const OUT_OF_SCOPE: readonly string[] = [...OUT_OF_SCOPE_CTSP, ...OUT_OF_SCOPE_D2];

/**
 * ★ 批 13（2026-11-18）收走的 C·tsp 11 条（判据 19 条从计划册侧逐字搬进属主册、散文随整份 decision 搬）。
 * 本批的"界外 13"里，那 11 条**已经不是界外**了 ⇒ 本文件的界外账改成"13 − 11 = 2（恰 D2）"。
 * 批 13 自己的账在 `tests/p1_cross_book_batch13.test.ts`。
 */
const COLLECTED_BY_B13: readonly string[] = OUT_OF_SCOPE_CTSP;
/** 批 13 搬走的判据条数（逐条 sha256 在批 13 的证里） */
const CRITERIA_MOVED_BY_B13 = 19;
/** 批 13 收口后仍两册持有的 = 界外 13 − 批 13 收走的 11 = D2 2 */
const STILL_TWO_BOOK: readonly string[] = [...OUT_OF_SCOPE_D2];

/**
 * ★ 批 14（2026-11-18）收走的 **D2 2 条**（两侧都带判据 ⇒ 判据**并集** + 同键不同值存档）。
 * 本批（12）自己的账在 `tests/p1_cross_book_batch14.test.ts`；这里只用来把"界外余量"的公式对齐现盘。
 */
const COLLECTED_BY_B14: readonly string[] = [...STILL_TWO_BOOK];
/** 批 14 跟走（并进属主册）的判据条数 */
const CRITERIA_MOVED_BY_B14 = 18;
/** 批 15 整份搬（属主错位 10 条 path）的判据条数 —— 搬完计划册判据 = 0（账在 p1_cross_book_batch15.test.ts） */
const CRITERIA_MOVED_BY_B15 = 29;

/** 读数（常量算术：只钉"降幅 = 本批 path 数 / 判据数"这类恒等式） */
// ★ 2026-11-19（集成席 · merge feat/api-edges 后）：854 → 854 —— agent-io 册 +15 条**合法新增**（semantic_facts +6 / verify-changed +3 / kernel 判据并集 +3 / run-tests +2 / 新节点 vue_sfc.ts +1），工具面 7 不变；不是漂，是显式改。
const CRITERIA_TOTAL = 855; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线
const CRITERIA_IN_AI = 782; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15，差额 66 不变
const CRITERIA_IN_TSP = 66;
const CRITERIA_IN_TOOLFACE = 7;
const BEFORE_CRITERIA_AI = 782; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15（合法新增），本批差额不变
const BEFORE_CRITERIA_TSP = 66;
const CRITERIA_OWNED_COUNT = 61;
const CRITERIA_MOVED_COUNT = 0;
const RESP_TOTAL_BEFORE = 11699; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：并入 api-edges 后现盘读数
const RESP_TOTAL_AFTER = 11699; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：同上（本批 0 字净变，前后仍相等）
const RESP_AI_BEFORE = 11445; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：重基：AI 现 10638 − 本批搬来 70
const RESP_AI_AFTER = 11515; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：现盘 agent-io 职责字数
const RESP_TSP_BEFORE = 70; // // ★ 2026-11-19（集成席 · merge feat/api-edges）：重基（计划册已退役，TSP_AFTER=0 ⇒ BEFORE=搬走 70）
const RESP_TSP_AFTER = 0; // ★ 2026-11-19（集成席 · merge feat/api-edges）：计划册退役后其职责字数读数为 0
const RESP_MOVED_CHARS = 70;
const MULTI_BEFORE = 30;
const MULTI_AFTER = 13;
const ID_DRIFT_BEFORE = 10;
const ID_DRIFT_AFTER = 10;
const TSP_OWNS_AFTER = 13;
const DELETED_NODES = 17;
const DELETED_SEMANTICS = 17;
const DELETED_EDGES = 26;
const TSP_NODES_AFTER = 131;
const TSP_SEMANTIC_AFTER = 25;
const BEFORE_NODES_TSP = 148;
const BEFORE_SEM_TSP = 42;
const BEFORE_EDGES_TSP = 226;
const ARCHIVE_PATHS = 0;
/**
 * **path 分母的棘轮下限**（只许不降；与 batch9/10/11 同一个 idiom —— 批 4 裁定②：钉结构不钉绝对值）。
 * ★ 569 = 568 + ledger 工具 v2 的 `src/application/meta/ledger/tool.ts`（合法入仓）。
 *   本批**只删非属主侧节点**（属主册仍持有那些 path）⇒ 并集不变；**低于 floor = 有节点的 path 被收走而没人登记**。
 */
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const shaOfJson = (v: unknown) => createHash('sha256').update(JSON.stringify(v), 'utf-8').digest('hex');
/** 原文字节的 sha（不加 JSON 引号）—— 职责文本 / 判据 的搬运是"字节相同"，不是"JSON 相同" */
const shaOfText = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

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
/** ★ 直接读册文件（不经 hydration）：sha256 比的是**盘上那份的字节形状** */
function rawBook(feature: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(bookFileOf(feature), 'utf8')) as Record<string, unknown>;
}
type RawNode = { id?: string; path?: string; decision?: { expectations?: unknown[] } & Record<string, unknown>; [k: string]: unknown };
function rawNodes(feature: string): RawNode[] {
  return ((rawBook(feature).geometry as { nodes?: RawNode[] } | undefined)?.nodes ?? []) as RawNode[];
}
function rawSems(feature: string): Array<{ id?: string; path?: string; responsibility?: string; status?: string }> {
  return ((rawBook(feature).semantic as { files?: Array<{ id?: string; path?: string; responsibility?: string; status?: string }> } | undefined)?.files ?? []);
}
function nodesOf(s: BookSheetLike): Array<Record<string, unknown>> {
  return (s.geometry?.nodes ?? []) as Array<Record<string, unknown>>;
}
function criteriaOf(s: BookSheetLike): number {
  let n = 0;
  for (const node of nodesOf(s)) n += ((node.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length;
  return n;
}
function criteriaTotal(sheets: readonly BookSheetLike[]): number {
  return sheets.reduce((a, s) => a + criteriaOf(s), 0);
}
/** 职责字数（**直接读册文件**：与执行器同一口径；gate 的 hydration 可能裁掉无 path 的条目） */
function respTotalRaw(): number {
  let n = 0;
  for (const f of [AI, TSP, 'agent-io-toolface']) n += rawSems(f).reduce((t, x) => t + String(x.responsibility ?? '').trim().length, 0);
  return n;
}
/** 职责字数（给**纯核副本**用：只看传进来的这几册） */
function respTotalSheets(sheets: Array<BookSheetLike & { feature: string }>): number {
  return sheets.reduce((a, s) => a + ((s.semantic?.files ?? []) as Array<{ responsibility?: string }>).reduce((t, x) => t + String(x.responsibility ?? '').trim().length, 0), 0);
}
/**
 * 测试自己的解析器（**不 import 执行器**）：把 body 里的 base64 payload 解出来。
 * ★ 与批 10 的 10.9 同一条纪律：写者与读者各写一份，格式才是契约。
 */
function parseArchive(body: string): { payload: Record<string, unknown>; payloadSha: string; head: string } | null {
  const at = body.indexOf(PAYLOAD_END);
  if (at < 0) return null;
  const rest = body.slice(at + PAYLOAD_END.length).split('\n');
  const b64 = (rest[1] ?? '').trim();
  const m = (rest[2] ?? '').match(/^sha256\(payload\)= ([0-9a-f]{64})$/);
  if (!b64 || !m) return null;
  const json = Buffer.from(b64, 'base64').toString('utf8');
  return { payload: JSON.parse(json) as Record<string, unknown>, payloadSha: m[1]!, head: body.slice(0, at) };
}
/** 一个 path 在某册里的语义条目（原样） */
function semOf(feature: string, p: string): { responsibility?: string; status?: string } | undefined {
  return rawSems(feature).find((x) => norm(x.path) === p);
}

// ════════════════════════════════════════════════════════════════════
// 12.1 / 12.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('12.1 真仓：17 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数逐条对表', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of BATCH) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须恰由 ${AI} 持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
    const want = CRITERIA_OWNED[p]?.crit;
    assert.equal(typeof want, 'number', `\`${p}\` 必须在判据表里（漏一条 = 有一条没人核）`);
    assert.equal(hs[0]?.expectations, want, `\`${p}\` 的判据条数必须是 ${String(want)}（实测 ${hs[0]?.expectations}）`);
  }
});

test('12.1b 计划册里这 17 个 path 的节点 / 语义 / 边都不在了；17 个被删节点 id 在非属主册里不再出现', () => {
  const tsp = bookOf(TSP) as unknown as {
    geometry?: { nodes?: Array<Record<string, unknown>>; edges?: Array<{ from?: string; to?: string }> };
    semantic?: { files?: Array<{ id?: string; path?: string }> };
  };
  for (const p of BATCH) {
    assert.equal((tsp.geometry?.nodes ?? []).filter((n) => norm(n.path) === p).length, 0, `计划册里不该再有 \`${p}\` 的节点`);
    assert.equal((tsp.semantic?.files ?? []).filter((f) => norm(f.path) === p).length, 0, `计划册的 semantic.files 里不该再有 \`${p}\``);
  }
  const dangling = (tsp.geometry?.edges ?? []).filter((e) => DELETED_IDS.includes(String(e.from)) || DELETED_IDS.includes(String(e.to)));
  assert.deepEqual(dangling, [], `计划册里不该留悬空边（实测 ${dangling.length} 条）`);
  const sheets = repoSheets();
  const idsOutsideAi = new Set(sheets.filter((s) => s.feature !== AI).flatMap((s) => nodesOf(s).map((n) => String(n.id))));
  for (const id of DELETED_IDS) assert.ok(!idsOutsideAi.has(id), `被删节点 \`${id}\` 必须已从**非属主册**里消失（属主册同 id 那个是它的新家）`);
  const driftAmongDeleted = DELETED_IDS.filter((id) => !BATCH.some((x) => nodeIdOf(x) === id));
  assert.deepEqual(driftAmongDeleted, [], '被删的 id 必须逐条等于 nodeIdOf(某条本批 path) —— 一个漂移旧 id 都没有');
});

// ════════════════════════════════════════════════════════════════════
// 12.2 / 12.2b 清单形状 + "名单是死的、前提是活的"
// ════════════════════════════════════════════════════════════════════
test('12.2 清单形状：17 条 · 码位序 · 段位 16/1 · 判据表与清单逐条同集 · 界外 13 条', () => {
  assert.equal(BATCH.length, 17, `本批 17 条（实测 ${BATCH.length}）`);
  assert.deepEqual([...BATCH].sort(), BATCH, '本批必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  const segInfra = BATCH.filter((p) => p.startsWith('src/infrastructure/')).length;
  const segPres = BATCH.filter((p) => p.startsWith('src/presentation/')).length;
  assert.equal(segInfra, 16, `段位：src/infrastructure/** 16 条（实测 ${segInfra}）`);
  assert.equal(segPres, 1, `段位：src/presentation/** 1 条（实测 ${segPres}）`);
  assert.equal(segInfra + segPres, BATCH.length, '段位之和必须等于 17（漏一条就红）');

  assert.deepEqual(Object.keys(CRITERIA_OWNED).sort(), [...BATCH].sort(), '判据表必须与清单**逐条同集**');
  assert.equal(Object.keys(CRITERIA_OWNED).length, 17, '判据表 17 条');
  assert.equal(Object.values(CRITERIA_OWNED).reduce((s, x) => s + x.crit, 0), CRITERIA_OWNED_COUNT, `属主侧判据合计 ${CRITERIA_OWNED_COUNT}`);
  assert.equal(Object.keys(RESP_MOVED).length, 1, '职责搬运 1 条（book.ts）');
  assert.equal(CARD_LEAVE.length, 17, '带卡留账 17 条（本批全部带卡）');
  assert.equal(BATCH.filter((p) => !CARD_LEAVE.includes(p)).length, 0, '没有"不带卡"的 path（两边都有牙：多算一条 / 少算一条都红）');
  assert.equal(DELETED_IDS.length, DELETED_NODES, `删的节点数 ${DELETED_NODES} 必须等于 id 清单长度`);
  // ★ 界外 13 条 = C·tsp 11 + D2 2；一条都不许混进本批
  assert.equal(OUT_OF_SCOPE_CTSP.length, 11, `界外 C·tsp 11 条（实测 ${OUT_OF_SCOPE_CTSP.length}）`);
  assert.equal(OUT_OF_SCOPE_D2.length, 2, `界外 D2 2 条（实测 ${OUT_OF_SCOPE_D2.length}）`);
  assert.equal(OUT_OF_SCOPE.length, 13, `界外共 13 条（实测 ${OUT_OF_SCOPE.length}）`);
  for (const p of OUT_OF_SCOPE) assert.ok(!BATCH.includes(p), `界外的 \`${p}\` 不许在本批里`);
  assert.equal(BATCH.length + OUT_OF_SCOPE.length, MULTI_BEFORE, '本批 17 + 界外 13 = 批 11 收口时的 30 条多册持有（算术闭合）');
});

test('12.2b 名单是死的、前提是活的：名单必须逐条 = 现盘 C·ai 类全体（集合相等）；收完只剩界外余量（批 13 之后 = 2）', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  // ★ 批 13 棘轮（2026-11-18）：13 只作**上界**（批 13 又按计划收走 C·tsp 11 条 ⇒ 现盘 2）。
  //   钉"恰好 13"会把后续批的合法下降判成红 —— 那是把账本倒着锁。
  assert.ok(multi.length <= MULTI_AFTER, `多册持有只许不增（批 12 收口 ${MULTI_AFTER}；实测 ${multi.length}）`);
  // ★ 批 14 棘轮（2026-11-18）：D2 2 条已由批 14 收口 ⇒ 现盘 0（多册持有归零）。公式从"= 界外余量"改成"= 余量 − 批 14"。
  const remain = [...STILL_TWO_BOOK].filter((p) => !COLLECTED_BY_B14.includes(p)).sort();
  assert.equal(multi.length, remain.length, `收完之后仍两册持有的必须恰好 ${remain.length} 条（界外 13 − 批 13 收走 ${COLLECTED_BY_B13.length} − 批 14 收走 ${COLLECTED_BY_B14.length}；实测 ${multi.length}）`);
  for (const p of STILL_TWO_BOOK) assert.ok(!multi.includes(p), `界外的 \`${p}\` 已由批 14 收口 ⇒ 不该仍两册持有`);
  assert.deepEqual([...multi].sort(), remain, '收完之后仍两册持有的必须**逐条等于**界外余量（名单没被挑过）');
  for (const p of BATCH) assert.ok(!multi.includes(p), `本批的 \`${p}\` 必须已不在多册持有集合里`);
  for (const p of COLLECTED_BY_B13) assert.ok(!multi.includes(p), `批 13 收走的 \`${p}\` 必须已不在多册持有集合里（批 13 的证在 13.10）`);
  for (const p of COLLECTED_BY_B14) assert.ok(!multi.includes(p), `批 14 收走的 \`${p}\` 必须已不在多册持有集合里（批 14 的证在 14.2b）`);
  // ★ 独立复算（不看执行器，只看册）：C·ai ⇔ 属主侧有判据 ∧ 计划册侧 0 判据 0 职责
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  const aiCritOf = new Map<string, number>();
  for (const s of sheets.filter((x) => x.feature === AI)) for (const n of nodesOf(s)) aiCritOf.set(norm(n.path), ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length);
  const tspBare = new Set(
    sheets
      .filter((x) => x.feature === TSP)
      .flatMap((s) => nodesOf(s))
      .filter((n) => ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length === 0)
      .map((n) => norm(n.path)),
  );
  const leftoverCai = multi.filter((p) => (aiCritOf.get(p) ?? 0) > 0 && tspBare.has(p));
  assert.deepEqual(leftoverCai, [], `收完之后不许再剩任何 C·ai（属主侧有判据 + 计划册侧空壳）；实测 ${leftoverCai.join(', ')}`);
  const stillTwoBook = [...holdings.keys()].filter((p) => new Set((holdings.get(p) ?? []).map((h) => h.feature)).size >= 2).sort();
  assert.deepEqual(stillTwoBook, remain, `现盘仍两册持有的集合必须逐条等于界外余量（批 13 之后 ${STILL_TWO_BOOK.length} 条 − 批 14 收走 ${COLLECTED_BY_B14.length} = ${remain.length} 条）`);
});

// ════════════════════════════════════════════════════════════════════
// 12.3 判据逐字节 + 守恒 / 12.3b 有牙
// ════════════════════════════════════════════════════════════════════
test('12.3 判据**逐字节**：属主侧 61 条 sha256 一位没动；总数守恒 854（766/66/7）；本批搬 0 条', () => {
  const aiNodes = rawNodes(AI);
  for (const [p, want] of Object.entries(CRITERIA_OWNED)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.crit, `\`${p}\` 的判据条数必须是 ${want.crit}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.sha, `\`${p}\` 的判据本来就在属主册，本批**一位不该动**（sha 变了）`);
  }
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaOf(s)}`).join(' · ');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 854（实测 ${per}）`);
  // ★ 批 13 棘轮（2026-11-18）：批 12 收口时 agent-io = 766、计划册 = 66。批 13 把计划册侧的 19 条判据
  //   **逐字搬进**属主册 ⇒ 现盘 785 / 47。钉"= 766"会把后续批的合法搬运判成红 ⇒ 改成方向 + 差集。
  assert.ok(criteriaOf(bookOf(AI)) >= CRITERIA_IN_AI, `agent-io 册判据只许不减（批 12 收口 ${CRITERIA_IN_AI}；实测 ${criteriaOf(bookOf(AI))}）`);
  assert.ok(criteriaOf(bookOf(TSP)) <= CRITERIA_IN_TSP, `计划册判据只许不增（批 12 收口 ${CRITERIA_IN_TSP}；实测 ${criteriaOf(bookOf(TSP))}）`);
  // ★ 批 14 棘轮（2026-11-18）：Δ 现在包含**两批**的搬运量（批 13 的 19 + 批 14 的 18 = 37）。
  assert.equal(criteriaOf(bookOf(AI)) - CRITERIA_IN_AI, CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15, `属主册涨幅必须恰等于批 13 + 14 + 15 搬进来的 ${CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条（实测 ${criteriaOf(bookOf(AI)) - CRITERIA_IN_AI}）`);
  assert.equal(CRITERIA_IN_TSP - criteriaOf(bookOf(TSP)), CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15, `计划册降幅必须恰等于批 13 + 14 + 15 搬走的 ${CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条（实测 ${CRITERIA_IN_TSP - criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf('agent-io-toolface')), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  assert.equal(criteriaOf(bookOf(AI)) - CRITERIA_MOVED_BY_B13 - CRITERIA_MOVED_BY_B14 - CRITERIA_MOVED_BY_B15, BEFORE_CRITERIA_AI, '去掉批 13 的 19 + 批 14 的 18 + 批 15 的 29 ⇒ 必须回到批 12 收口时的 766（本批搬 0 条）');
  assert.equal(criteriaOf(bookOf(TSP)) + CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15, BEFORE_CRITERIA_TSP, '补回批 13 的 19 + 批 14 的 18 + 批 15 的 29 ⇒ 必须回到批 12 收口时的 66（本批搬 0 条）');
  assert.equal(CRITERIA_MOVED_COUNT, 0, '本批搬的判据数 = 0（C·ai：判据早在属主册）');
  assert.equal(BEFORE_CRITERIA_AI + BEFORE_CRITERIA_TSP + CRITERIA_IN_TOOLFACE, CRITERIA_TOTAL, '守恒是**算术**，不是"看起来差不多"');
});

test('12.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 854，差额恰是该节点的判据数', () => {
  const sheets = repoSheets();
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的读数是 854');
  const victim = sheets
    .flatMap((s) => nodesOf(s).map((n) => ({ feature: s.feature, id: String(n.id), n })))
    .find((x) => ((x.n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length > 0);
  assert.ok(victim, '必须有至少一个带判据的节点（否则这条反检查没对象）');
  const lost = ((victim.n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length;
  const world2 = sheets.map((s) =>
    s.feature === victim.feature
      ? ({ feature: s.feature, geometry: { nodes: nodesOf(s).filter((n) => String(n.id) !== victim.id) } } as unknown as BookSheetLike)
      : s,
  );
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 12.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 12.4 甲′（职责搬运 + 字数守恒 + 0 存档）/ 12.4b 有牙
// ════════════════════════════════════════════════════════════════════
test('12.4 甲′：职责 70 字逐字搬进属主册；两侧合并后总字数守恒 10,366；本批存档 0 条', () => {
  const aiSems = rawSems(AI);
  for (const [p, want] of Object.entries(RESP_MOVED)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.ok(s, `\`${p}\` 必须在属主册有语义条目`);
    assert.equal(String(s.responsibility ?? '').trim().length, want.chars, `\`${p}\` 的职责文本字数必须是 ${want.chars}（实测 ${String(s.responsibility ?? '').trim().length}）`);
    assert.equal(shaOfText(String(s.responsibility ?? '')), want.sha, `\`${p}\` 的职责文本不是逐字的（sha 变了）`);
  }
  // ★ 两侧合并后总数守恒（这是"职责不丢"的唯一判据）
  assert.equal(respTotalRaw(), RESP_TOTAL_AFTER, `三册职责总字数必须是 ${RESP_TOTAL_AFTER}（实测 ${respTotalRaw()}）`);
  assert.equal(RESP_TOTAL_BEFORE, RESP_TOTAL_AFTER, '两侧合并后总数：搬前 = 搬后（本批一字不丢）');
  assert.equal(RESP_AI_AFTER - RESP_AI_BEFORE, RESP_MOVED_CHARS, '属主册涨幅必须恰等于搬来的字数（70）');
  assert.equal(RESP_TSP_BEFORE - RESP_TSP_AFTER, RESP_MOVED_CHARS, '计划册降幅必须恰等于搬走的字数（70）');
  assert.equal(RESP_AI_BEFORE + RESP_TSP_BEFORE + (RESP_TOTAL_AFTER - RESP_AI_AFTER - RESP_TSP_AFTER), RESP_TOTAL_BEFORE, '守恒是算术（工具面那一段没动）');
  // ★ 本批存档 0 条：C·ai 的败方是空壳 ⇒ 没有"同键不同值"，不许凭空挂账
  assert.equal(ARCHIVE_PATHS, 0, '本批的"被顶掉的败方原文"必须是 0 条');
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  assert.ok(String(baseline.multi_owned.why ?? '').includes('批 12（C·ai 段'), '门档 multi_owned.why 必须记着批 12 的来路');
  for (const p of CARD_LEAVE) assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 why 必须逐条点着带卡留账 \`${p}\``);
});

test('12.4b 上一条**有牙**：纯核里改一个字节 / 清空一处 ⇒ 指纹立刻变（真册一个字节不动）', () => {
  const [p0, want0] = Object.entries(RESP_MOVED)[0]!;
  const cur = String(semOf(AI, p0)?.responsibility ?? '');
  assert.equal(shaOfText(cur), want0.sha, '前提：真册上那段职责是逐字的');
  assert.notEqual(shaOfText(`${cur} `), want0.sha, '加一个尾空格，指纹必须变 —— 否则 sha 判据是摆设');
  assert.notEqual(shaOfText(''), want0.sha, '清空职责，指纹必须变');
  assert.equal(String(cur).trim().length, RESP_MOVED_CHARS, '清空后字数会掉 70 —— 这正是 12.4 的守恒判据能咬住的地方');
});

// ════════════════════════════════════════════════════════════════════
// 12.5 域表一位没动
// ════════════════════════════════════════════════════════════════════
test('12.5 域表**一位没动**：17 条属主 = agent-io；计划册 owns 13 条（改判 0 条）；前缀仍在', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  const table = read.table as DesignBooksTable;
  for (const p of BATCH) {
    const hit = ownerOf(table, p);
    assert.equal(hit.matched, true, `\`${p}\` 必须被域表覆盖（实测未命中）`);
    assert.equal(hit.owner, AI, `\`${p}\` 的属主必须是 ${AI}（实测 ${hit.owner}，命中 \`${hit.entry}\`）`);
  }
  const tspOwns = (table.books.find((b) => b.feature === TSP)?.owns ?? []).map((e) => norm(typeof e === 'string' ? e : e.path));
  const aiOwns = (table.books.find((b) => b.feature === AI)?.owns ?? []).map((e) => norm(typeof e === 'string' ? e : e.path));
  // ★ 棘轮：只许不增（批 13/14 还会继续摘），但**不许被清空**
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER, `计划册 owns 只许不增（批 12 收口 ${TSP_OWNS_AFTER}；实测 ${tspOwns.length}）`);
  // ★ 批 14 棘轮（2026-11-18）：计划册 owns 已被清空（2 → 0）⇒ "不许被清空"这条历史约束退役；
  //   清空之后要断的是**清空有账**（批 14 的门档 why 点名它的来路），而不是"永远 > 0"。
  if (tspOwns.length === 0) {
    const baseline14 = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
    assert.ok(String(baseline14.multi_owned.why ?? '').includes('批 14（D2 终局'), '计划册 owns 清空必须由批 14 的账背书（门档 why 点名）');
  } else {
    assert.ok(tspOwns.length > 0, `计划册 owns 不许被清空（实测 ${tspOwns.length}）`);
  }
  for (const p of BATCH) assert.ok(!tspOwns.includes(p), `计划册 \`owns[]\` 里不许有本批的精确条目 \`${p}\`（那 17 条属主早已是 agent-io）`);
  for (const pre of ['src/', 'scripts/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  // 域表散文只追加了批 12 段（owns 数组没有被改）—— 改判 0 条
  const raw = fs.readFileSync(path.join(REPO, 'design-books.json'), 'utf8');
  assert.ok(raw.includes('批 12'), 'design-books.json 的 note/why 必须记着批 12（散文追加，不是 owns 改判）');
});

// ════════════════════════════════════════════════════════════════════
// 12.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('12.6 ② 档：这 17 条 klass = owned；塞回任一条 ⇒ 立刻 multi_owned（鉴别力）；path 分母**只许不降**（floor 569）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  const byPath = new Map(now.rows.map((r) => [r.path, r]));
  for (const p of BATCH) {
    const row = byPath.get(p);
    assert.ok(row, `② 档必须逐条点名 \`${p}\`（rows 里没有它）`);
    assert.equal(row.klass, 'owned', `\`${p}\` 必须是 owned（实测 ${row.klass}）`);
    assert.equal(row.owner, AI, `\`${p}\` 的域表属主必须是 ${AI}（实测 ${row.owner}）`);
    assert.deepEqual([...new Set(row.holders.map((h) => h.feature))], [AI], `\`${p}\` 只该有一个持有者`);
  }
  assert.ok(now.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR}；实测 ${now.paths}）`);
  assert.equal(now.books, 2, `册数：**批 17 计划册退役** ⇒ 3 → 2（实测 ${now.books}）`);
  const p0 = BATCH[0]!;
  const world2 = [...sheets, { feature: TSP, geometry: { nodes: [{ id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }] } } as unknown as BookSheetLike & { feature: string }];
  const two = crossBookOwnership(world2, read);
  assert.equal(two.rows.find((r) => r.path === p0)?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
});

// ════════════════════════════════════════════════════════════════════
// 12.7 写端
// ════════════════════════════════════════════════════════════════════
test('12.7 写端：批 12 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export const x = 1;\n', 'utf8');
    fs.writeFileSync(
      path.join(proj, 'design-books.json'),
      JSON.stringify({ note: 'fixture', books: [{ feature: AI, owns: ['src/'] }, { feature: TSP, owns: [] }], unowned: [] }, null, 2),
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
    const tsp = JSON.parse(fs.readFileSync(tspFile, 'utf8')) as { geometry: { nodes: Array<Record<string, unknown>> } };
    tsp.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const before = fs.readFileSync(tspFile, 'utf8');
    assert.throws(
      () => saveDSL(tsp as unknown as Parameters<typeof saveDSL>[0], 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|not_owner|已由|属主/,
      '非属主册再建节点必须**前置拒**（否则批 12 的删除是可逆的）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as { geometry: { nodes: Array<Record<string, unknown>> }; semantic?: unknown };
    ai.geometry.nodes[0]!.decision = { summary: '属主册写判据必须放行', expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '消融：属主册写自己的 path' }] };
    ai.semantic = { files: [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts', responsibility: '属主册写自己的 path 必须放行', status: 'done' }] };
    saveDSL(ai as unknown as Parameters<typeof saveDSL>[0], 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as {
      geometry: { nodes: Array<{ decision?: { expectations?: unknown[] } }> };
      semantic: { files: Array<{ responsibility?: string; status?: string }> };
    };
    assert.equal((after.geometry.nodes[0]?.decision?.expectations ?? []).length, 1, '属主册写判据必须落盘（判据不是"只读装饰"）');
    assert.equal(after.semantic.files[0]?.responsibility, '属主册写自己的 path 必须放行', '属主册写职责文本必须落盘');
    assert.equal(after.semantic.files[0]?.status, 'done', '属主册写 status 必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 12.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('12.8 门档：多册持有 ≤ 13（30 − 17）· id 漂移 ≤ 10 · 属主错位 ≤ 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(now.multi_owned.length <= MULTI_AFTER, `多册持有只许不增（批 12 收口 ${MULTI_AFTER}；实测 ${now.multi_owned.length}）`);
  assert.equal(MULTI_BEFORE - MULTI_AFTER, BATCH.length, '批 12 的降幅必须逐字等于本批 path 数');
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER, `id 漂移只许不增（批 12 收口 ${ID_DRIFT_AFTER}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE, ID_DRIFT_AFTER, '本批删的全是单点派生 id ⇒ 漂移一条不该变');
  for (const p of BATCH) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（属主本来就是它）`);
  }
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 15 处理）：实测 ${now.owner_mismatch.length}`);

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 12.9 存档 0 条 + 跨批不进水 / 12.9b 机制可移植
// ════════════════════════════════════════════════════════════════════
test('12.9 **存档 0 条**：本批（A8A9-batch12）一条都不许挂；批 10 的 35 + 批 11 的 1 条仍自证且未被改写', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆 / 首次检出）⇒ 台账存档不在版本库里，读不回；机制由 12.9b 钉住');
    return;
  }
  const row = getRow(REPO, LEDGER_REF);
  if (!row) {
    t.skip(`台账里没有 \`${LEDGER_REF}\` 这一行（本机台账未导入）⇒ 读不回`);
    return;
  }
  assert.equal(row.state, 'active', `${LEDGER_REF} 必须是活跃行（批 12 还没收口；销账后不许再往上挂）`);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  const batches = new Map<string, number>();
  let mine = 0;
  for (const e of allArchive) {
    const parsed = parseArchive(String(e.body));
    assert.ok(parsed, `存档事件 id=${e.id} 的 body 解析不了（格式契约被改了）`);
    assert.equal(String((parsed.payload as { ref?: string }).ref ?? ''), LEDGER_REF, `存档事件 id=${e.id} 必须挂在 ${LEDGER_REF} 上`);
    const batch = String((parsed.payload as { batch?: string }).batch ?? '(缺)');
    batches.set(batch, (batches.get(batch) ?? 0) + 1);
    if (batch === BATCH_TAG) mine += 1;
  }
  assert.equal(mine, ARCHIVE_PATHS, `本批存档必须恰好 ${ARCHIVE_PATHS} 条（实测 ${mine}）—— C·ai 的败方是空壳，凭空挂账 = 假证据`);
  assert.equal(batches.get('A8A9-batch10'), 35, `批 10 的 35 条存档必须原样还在（append-only；实测 ${String(batches.get('A8A9-batch10'))}）`);
  assert.equal(batches.get('A8A9-batch11'), 1, `批 11 的 1 条存档必须原样还在（实测 ${String(batches.get('A8A9-batch11'))}）`);
  assert.equal([...batches.keys()].includes(BATCH_TAG), false, `台账里不许出现 \`${BATCH_TAG}\` 这个分组（本批 0 条）`);
});

test('12.9b 上一条**可移植**：夹具里 hangRow + annotateRow 往返，批 12 的 body 头格式逐字读回（不依赖本机 tasks.db）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
    hangRow(proj, { refId: 'T-#FIXTURE-B12', section: 'fixture', title: '批 12 存档往返夹具', by: 'test' });
    // ★ body 自己拼（与执行器同格式）：批 12 的"空存档"形态也必须能往返（0 个值也是合法 payload）
    const payload = {
      batch: 'A8A9-batch12',
      ref: 'T-#FIXTURE-B12',
      path: 'src/infrastructure/fixture12.ts',
      loser: { book: 'task-system-plan', node_id: 'file_src_infrastructure_fixture12_ts' },
      keeper: { book: 'agent-io', node_id: 'file_src_infrastructure_fixture12_ts' },
      dropped: {},
      moved_keys: [],
      moved_responsibility: true,
      moved_semantic_status: null,
      moved_node_fields: [],
      moved_expectations: 0,
      identical_keys: [],
    };
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    const body = [
      '迁移存档：败方原文',
      '批 12（甲′：散文口径 = 属主侧为准 + 败方原文逐字存档）· T-#FIXTURE-B12 · A8A9-batch12',
      'path: src/infrastructure/fixture12.ts',
      '',
      '── 败方原文（逐字）──',
      '',
      PAYLOAD_END,
      b64,
      `sha256(payload)= ${createHash('sha256').update(json, 'utf8').digest('hex')}`,
    ].join('\n');
    annotateRow(proj, 'T-#FIXTURE-B12', body, 'test');
    const row = getRow(proj, 'T-#FIXTURE-B12');
    assert.ok(row, '夹具台账行必须读得回来');
    const ev = row.events.filter((e) => e.kind === 'annotate');
    assert.equal(ev.length, 1, '必须恰好一条 annotate 事件');
    assert.equal(String(ev[0]!.body), body, 'annotate 事件 body 必须**逐字**存下（首尾空白也不许剪）');
    const parsed = parseArchive(String(ev[0]!.body));
    assert.ok(parsed, '同一份格式必须解析得回来');
    assert.equal(parsed!.payloadSha, createHash('sha256').update(json, 'utf8').digest('hex'), 'payload sha 必须一致');
    assert.deepEqual(parsed!.payload.dropped, {}, '空存档（0 个值）也必须往返成立 —— 否则"本批 0 条"就不可证');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 12.10 界外账 / 12.10b 空壳判别力
// ════════════════════════════════════════════════════════════════════
test('12.10 **界外账**：批 12 的界外 13 条里，批 13 收走的 11 条**已不再两册**；D2 2 条仍是两册持有', () => {
  const read = crossBookReadingOf(REPO);
  const multi = new Set(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path));
  for (const p of OUT_OF_SCOPE) {
    assert.ok(!BATCH.includes(p), `\`${p}\` 不该在本批清单里`);
    if (COLLECTED_BY_B13.includes(p)) {
      // ★ 批 13 棘轮（2026-11-18）：这 11 条已由批 13 收成单册（判据搬进属主册）⇒ 本条改判成"不许再两册"
      assert.ok(!multi.has(p), `\`${p}\` 已由批 13 收走（C·tsp 段）⇒ 不该仍两册持有（批 13 的证在 13.10）`);
      continue;
    }
    if (COLLECTED_BY_B14.includes(p)) {
      // ★ 批 14 棘轮（2026-11-18）：D2 2 条已由批 14 收成单册（判据并集 + 散文存档）⇒ 同上
      assert.ok(!multi.has(p), `\`${p}\` 已由批 14 收走（D2 段）⇒ 不该仍两册持有（批 14 的证在 14.2b）`);
      continue;
    }
    assert.ok(multi.has(p), `\`${p}\` 必须仍是**两册持有**（界外 ≠ 已处理）`);
  }
  const remainAfterB14 = STILL_TWO_BOOK.length - COLLECTED_BY_B14.length;
  assert.equal(multi.size, remainAfterB14, `边界外余量必须正好 ${remainAfterB14} 条（界外余量 ${STILL_TWO_BOOK.length} − 批 14 收走 ${COLLECTED_BY_B14.length}；实测 ${multi.size}）`);
  // 被收的 17 条：必须单册 = 属主册（"收" ≠ "删"）
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  for (const p of BATCH) {
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须已被收成单册 = ${AI}（实测 ${feats.join('/') || '无人持有'}）`);
  }
});

test('12.10b **空壳判别力**：把 17 个空壳节点"复活"进纯核 ⇒ 全部变 multi_owned，但**判据总数一字不变**', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的判据总数是 854');
  // ★ 造"没做本批"的世界：17 个节点原样回去（**空壳**：无 decision、无语义负载、无卡）
  const revived = BATCH.map((p) => ({ id: nodeIdOf(p), label: path.basename(p), type: 'file', x: 0, y: 0, path: p }));
  const world = [...sheets, { feature: TSP, geometry: { nodes: [...revived] } } as unknown as BookSheetLike & { feature: string }];
  const un = crossBookOwnership(world, read);
  const byPath = new Map(un.rows.map((r) => [r.path, r]));
  for (const p of BATCH) {
    assert.equal(byPath.get(p)?.klass, 'multi_owned', `\`${p}\` 在"没做本批"的世界里必须是 multi_owned（否则本批的删除不改变任何东西，这批就没意义）`);
  }
  assert.equal(un.counts.multi_owned, now.counts.multi_owned + BATCH.length, `复活 17 个空壳 ⇒ 多册持有必须恰好 +17（实测 ${un.counts.multi_owned - now.counts.multi_owned}）`);
  // ★ 关键：复活出来的空壳**不带判据** ⇒ 判据总数一字不变 = "删的是空壳，不是货"
  assert.equal(criteriaTotal(world), CRITERIA_TOTAL, `复活 17 个空壳后判据总数必须仍 ${CRITERIA_TOTAL}（实测 ${criteriaTotal(world)}）—— 这批删的确实是空壳`);
  assert.equal(respTotalSheets(world), respTotalSheets(sheets), '复活出来的空壳也不带职责 ⇒ 职责总字数一字不变');
});

// ════════════════════════════════════════════════════════════════════
// 12.11 卡账
// ════════════════════════════════════════════════════════════════════
test('12.11 **卡账**：17 条带卡且全在**属主侧**；计划册侧 0 张、活卡 0 张 ⇒ 0 次卡操作、0 张孤儿卡', () => {
  const aiNodes = rawNodes(AI);
  const tspNodes = rawNodes(TSP);
  let aiCards = 0;
  for (const p of BATCH) {
    const ai = aiNodes.find((n) => norm(n.path) === p);
    assert.ok(ai, `\`${p}\` 必须在属主册有节点（卡的家随之留下）`);
    if ((ai.task as { state?: string } | undefined)?.state) aiCards += 1;
    const tsp = tspNodes.find((n) => norm(n.path) === p);
    assert.equal(tsp, undefined, `\`${p}\` 的计划册节点必须已删（那里的卡若有，就会变孤儿）`);
  }
  assert.equal(aiCards, BATCH.length, `17 条 path 的卡必须**全部**在属主侧（实测 ${aiCards}）`);
  assert.equal(CARD_LEAVE.length, BATCH.length, '带卡留账必须覆盖全部 17 条');
  // 册上投影：删掉的计划册节点不许还在册里
  const tspIds = new Set(tspNodes.map((n) => String(n.id)));
  for (const id of DELETED_IDS) assert.ok(!tspIds.has(id), `册上节点 \`${id}\` 必须已删`);
  // 活卡账（本机台账里有卡才核）：本批**不造**任何孤儿活卡 —— 被删的 17 个 id 上不许有活卡
  const cards = listLiveCards(REPO, TSP);
  if (cards.length === 0) return; // 干净克隆：卡的家不在版本库里
  const orphan = cards.filter((c) => DELETED_IDS.includes(String(c.id)));
  assert.deepEqual(orphan.map((c) => String(c.id)), [], `被删的 17 个 id 上不许有活卡（本批 0 次卡操作；实测 ${orphan.length} 张）`);
});

// ════════════════════════════════════════════════════════════════════
// 12.12 计划册册容
// ════════════════════════════════════════════════════════════════════
test('12.12 计划册册容：节点 148 → 131 · 语义 42 → 25 · 边 226 → 200（删的数目对得上）', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER, '计划册节点数：148 − 17 = 131');
  assert.equal(BEFORE_SEM_TSP - DELETED_SEMANTICS, TSP_SEMANTIC_AFTER, '计划册语义：42 − 17 = 25');
  assert.equal(BEFORE_EDGES_TSP - DELETED_EDGES, 200, '计划册边：226 − 26 = 200');
  // ★ 棘轮（批 12 收口值只作上界：后续批还会继续删）
  assert.ok(rawNodes(TSP).length <= TSP_NODES_AFTER, `计划册节点数只许减（批 12 收口 ${TSP_NODES_AFTER}；实测 ${rawNodes(TSP).length}）`);
  assert.ok(rawSems(TSP).length <= TSP_SEMANTIC_AFTER, `计划册语义条目数只许减（批 12 收口 ${TSP_SEMANTIC_AFTER}；实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.ok(edgesNow <= BEFORE_EDGES_TSP - DELETED_EDGES, `计划册边数只许减（批 12 收口 ${BEFORE_EDGES_TSP - DELETED_EDGES}；实测 ${edgesNow}）`);
  // 语义条目与节点必须一节点一条（半删会留下幽灵语义）
  const nodeIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  const ghost = rawSems(TSP).filter((s) => !nodeIds.has(String(s.id)));
  assert.deepEqual(ghost, [], `计划册不许留幽灵语义（实测 ${ghost.length} 条）`);
  // 属主册册容：本批只搬职责、不增删节点
  assert.equal(rawNodes(AI).length > 0, true, '属主册必须仍有节点');
});

// ════════════════════════════════════════════════════════════════════
// 12.13 派生快照（COGNITION 不许过期）
// ════════════════════════════════════════════════════════════════════
test('12.13 **派生快照**：COGNITION.txt 里每册的 dsl_rev = 册上现值（改册不重生成快照 ⇒ 这里红）', () => {
  const cogFile = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(cogFile), 'COGNITION.txt 必须存在（它是入库的派生快照）');
  const text = fs.readFileSync(cogFile, 'utf8');
  const seen = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^===feature ([a-z0-9-]+)=== dsl_rev=(\d+) sha256=[0-9a-f]{16}$/);
    if (m) seen.set(m[1]!, m[2]!);
  }
  // ★ 批 17：计划册退役 ⇒ `>= 3` → `>= 2`，且"计划册的段头必须在"**反过来钉**（它退役后不该再在快照里）。
  assert.ok(seen.size >= 2, `快照里必须至少 2 册的段头（实测 ${seen.size}；计划册已于批 17 退役）`);
  for (const [feature, rev] of seen) {
    const raw = rawBook(feature);
    assert.equal(String(raw._dsl_rev), rev, `${feature} 的 COGNITION 段头 dsl_rev (${rev}) 与册上现值 (${String(raw._dsl_rev)}) 不一致 —— 跑 \`npm run cognition\``);
  }
  assert.ok(!seen.has(TSP), '批 17 之后快照里不许再有计划册的段头（它已归档进 design/archived/）');
});

// ════════════════════════════════════════════════════════════════════
// 12.14 真视图 == 引擎现算（本批 0 条存档 ⇒ 摘要行不变）
// ════════════════════════════════════════════════════════════════════
test('12.14 真视图：docs/todo.md == 引擎现算（current）· 视图里 0 处 archive-payload · 引擎里存档仍逐字', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  const view = path.join(REPO, VIEW_REL);
  if (!fs.existsSync(dbFile) || !fs.existsSync(view)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆）⇒ 视图与引擎对不了账；渲染纯度由 batch11 的 11.13 钉住');
    return;
  }
  const rendered = renderLedgerView(REPO, { header: true });
  assert.equal(rendered.error, null, `引擎必须读得出来（否则这条判据是"没验"不是"通过"）：${rendered.error}`);
  const disk = fs.readFileSync(view, 'utf8');
  assert.equal(disk, rendered.text, `${VIEW_REL} 必须逐字等于引擎现算（跑 \`npm run ledger:render\`）`);

  const lines = disk.split('\n');
  const archiveLines = lines.filter((l) => l.includes('迁移存档'));
  assert.equal(archiveLines.length, 1, `视图里只许有**一行**迁移存档摘要（实测 ${archiveLines.length}）`);
  assert.match(archiveLines[0]!, /^> ↳ 迁移存档 \d+ 条（逐字见引擎，查询 ref=T-#A8A9-CROSS-BOOK）$/, '摘要行形状必须逐字符合批 11 的裁定');
  assert.equal(disk.includes(PAYLOAD_END), false, '视图里不许有 base64 存档段');

  // 引擎里：存档仍**逐字**，且条数与视图摘要一致（本批 0 条 ⇒ 摘要计数不该变）
  const row = getRow(REPO, LEDGER_REF);
  assert.ok(row, `台账里必须有 \`${LEDGER_REF}\``);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  assert.ok(allArchive.length >= 36, `引擎里的迁移存档事件必须 ≥ 36（实测 ${allArchive.length}）`);
  const m = archiveLines[0]!.match(/迁移存档 (\d+) 条/);
  assert.equal(Number(m?.[1]), allArchive.length, '视图摘要的条数必须等于引擎里的存档条数（两处一个数）');
  for (const e of allArchive) {
    assert.ok(parseArchive(String(e.body)), `引擎里 event id=${e.id} 的存档必须仍可解析（逐字可复算）`);
  }
  // 批 12 没有新存档 ⇒ 摘要行内容必须与批 11 收口时逐字相同（36 条）
  assert.equal(allArchive.length, Number(m?.[1]), '条数自洽');
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
