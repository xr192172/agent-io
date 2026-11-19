/**
 * P1 路 T-#A8A9-CROSS-BOOK **批 13**：**C·tsp 段**（判据在计划册侧、属主册侧**连 `decision` 都是空的**）
 * —— 判据 **19 条**逐字搬进属主册同 path 节点 + 散文随整份 `decision` 搬（49 键）+ 节点 `status`/`overlay`
 * 随迁（4 条）+ 计划册侧 11 个节点三清 + 域表 `owns` **13 → 2**；判据 854 守恒、职责字数 10,366 守恒。
 *
 * ## 这批要立的二十条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 13.1 | 真仓：11 个 path **各恰一册**持有且是 `agent-io`；节点 id = `nodeIdOf`；判据条数逐条对表 | 搬后没删 / 删错册 / 判据丢条在这里红 |
 * | 13.1b | 计划册侧**三清**（节点 + 语义 + 边）：11 个被删节点 id 在**非属主册**里不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 13.2 | 清单形状：11 条 · **码位序** · 段位 9+2 · 判据表与清单**逐条同集** · 界外 2 条 · 算术 11+2=13 | 手抄错一条 / 顺序漂了在这里红 |
 * | 13.2b | **名单是死的、前提是活的**：名单必须**逐条 = 现盘 C·tsp 类全体**（集合相等）；收完**恰好剩 2**（= D2 2） | 名单被"挑"过 / 现盘变了没人管，在这里红 |
 * | 13.3 | 判据**逐字节**搬：19 条逐条 sha256 搬前=搬后；总数守恒 **854**（766→785 / 66→47 / 7） | 搬错 / 重写 / 顺手改判据在这里红 |
 * | 13.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 854，差额恰是该节点的判据数 | 空断言的照妖镜（R47） |
 * | 13.4 | 甲′ 散文：**整份 `decision` 采用**（属主侧搬前 0 decision ⇒ 是"搬"）；散文键集合逐条对表（4–8 键 / 共 49 键） | 把散文抄歪 / 少搬一个键在这里红 |
 * | 13.4b | 甲′ 节点字段：`status` / `overlay` **随判据迁**（4 条，值逐字 sha256；属主侧原本空白） | 把 `done`/`draft` 状态或 progress_evidence 搬丢在这里红 |
 * | 13.4c | 甲′ 职责：`mutants.ts` **24 字逐字**搬；**职责字数两侧合并后守恒 10,366**；本批**存档 0 条** | 把职责抄歪 / 把"没有冲突"报成"有存档"在这里红 |
 * | 13.5 | 域表**改判 11 条**：这 11 条属主 = `agent-io`；计划册 `owns` **13 → 2**（余 `kernel.ts` + `storage.ts`）；前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 13.6 | ② 档：11 条 klass = `owned`；**塞回任一条** ⇒ 立刻 `multi_owned`（鉴别力）；path 分母**只许不降**（floor 569） | 纯核两世界对照，不碰真册 |
 * | 13.7 | 写端：批 13 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化）；属主册写同一 path ⇒ 过 | 属主册自己写被连带拒 = 一刀切，也在这里红 |
 * | 13.8 | 门档：多册持有 ≤ **2**（13 − 11）· id 漂移 ≤ **10** · 属主错位 ≤ **12**；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红（钉棘轮，不钉"当前值 = 2"） |
 * | 13.9 | **存档 0 条**（本批 `A8A9-batch13` 一条都没有）；批 10 的 35 条 / 批 11 的 1 条**跨批未进水**且自证成立 | 无冲突却挂账 / 把别批的账算成自己的，都在这里红 |
 * | 13.9b | 上一条**可移植**：夹具里 `hangRow` + `annotateRow` 往返（空存档 + 非空存档两种 payload 都要读得回） | 同上 |
 * | 13.10 | **界外账**：D2 2 条**仍是两册持有**；被收的 11 条必须单册 = 属主册 | 界外被"顺手收了"在这里红 |
 * | 13.10b | **判据只搬一次**：给 fixture 的计划册补回 11 个**空壳** ⇒ 多册 +11 但判据仍 857；再补回 19 条 ⇒ **876**（= 857 + 19 的重复；原批历史为 854 / 858）。⇒ 这 19 条在快照里**恰好存在一份** | 判据被复制成两份 / 只删节点没搬，都在这儿露 |
 * | 13.11 | **卡账（CARD_LEAVE）**：3 条带卡且**全在计划册侧**；删节点后**卡不动**（0 次卡操作）、活卡仍在库里、属主册**不伪造**册上卡投影 | 悄悄把卡删了 / 顺手把卡搬成"属主侧卡"，都在这里红 |
 * | 13.12 | 计划册册容：131 → 120 · 25 → 14 · 200 → 182（删的数目对得上）+ 无幽灵语义 | 只删一种、留下悬空边在这里红 |
 * | 13.13 | **派生快照**：`COGNITION.txt` 里每册的 `dsl_rev` = 册上现值（过期快照在这里红） | 改了册不重生成快照，这里红 |
 * | 13.14 | 真视图：`docs/todo.md` == 引擎现算（`current`）· 视图里 0 处 `archive-payload` · 本批 0 条存档 ⇒ 摘要行不长 | 视图与引擎各说一套在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–12 的裁定）
 * · 真仓读数（`process.cwd()`）只钉**不变量**（11 个 path 恰一册持有 · 判据总数 854 · 职责字数 10,366 · 判据逐条 sha）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 2"（那是批 14 收 D2 之后的终局）；
 * · ★ 只许钉三类东西 —— ① "我这批的 path 不在坏集合里"（永久真）② "总数只许不增"（棘轮）
 *   ③ "我这批的 Δ = 我这批的 path 数 / 判据数 / 字数"（常量算术）。**不许钉**"总数 = 我这批收口时的那个数"。
 * · 每一条"有牙"的反检查（13.3b / 13.4c / 13.10b）都跑在**纯核副本**上：真册一个字节都不动。
 * · 夹具一律落 `%TEMP%`（`AGENT_IO_HOME` 指到临时目录），绝不动仓里的 `src/` `dist/` `tests/`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { MIGRATION_BOOKS } from './fixtures/cross-book/migration-books.js';
import {
  bookHoldings,
  crossBookOwnership,
  ownerOf,
  readDesignBooks,
  type BookSheetLike,
  type DesignBooksTable,
} from '../src/infrastructure/design_books.js';
import { nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { saveDSL } from '../src/infrastructure/storage.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { listLiveCards } from '../src/infrastructure/task_history.js';
// ★ 2026-11-18（批 16 棘轮）：`cardHomeLite`（上面那个三态读法）—— 判"这张卡现在在哪"。
import { crossBookReadingOf } from '../src/application/design/db/gen_design_db.js';
import { annotateRow, getRow, hangRow } from '../src/application/ledger/ledger.js';
import {
  VIEW_REL,
  renderLedgerView,
} from '../src/application/ledger/render_ledger_view.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';

/**
 * 一张卡的"归宿"三态（批 16 起用它判卡账，见 13.11）：
 * ① `live` 活卡 —— `listLiveCards(REPO, feature)`（按项目根直接开库，不依赖注册表）；
 * ② `history` 已入史 —— 读**入库的** `tasks.jsonl`（活卡 + 历史同一条载体；干净克隆里也在）；
 * ③ `null` —— 既不在活卡表、也不在历史载体 ⇒ **丢卡**。
 * ★ 不用 `queryTaskHistory`：它走「feature → 项目根（注册表）」，而 `run-tests.mjs` 给每个测试文件注入临时
 *   `AGENT_IO_HOME` ⇒ 注册表读不到 ⇒ 它按 0 行返回（0.12 的老病：把"读不到"混成"没有"）。
 * ★ 不另立 `tests/helpers/*.ts`：`tests/helpers/**` 在结构门的"源码"面上，新文件 = 新缺口。
 */
function cardHomeLite(id: string): { kind: 'live'; feature: string; state: string } | { kind: 'history'; state: string } | null {
  for (const f of [AI, TSP, 'agent-io-toolface']) {
    const hit = listLiveCards(REPO, f).find((c) => String(c.id) === id);
    if (hit) return { kind: 'live', feature: f, state: String(hit.state) };
  }
  const file = path.join(REPO, '.agent-io', 'tasks.jsonl');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try { row = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      if (row.kind === 'history' && row.id === id) return { kind: 'history', state: String(row.state) };
    }
  }
  return null;
}
const TOOLFACE = 'agent-io-toolface';
const LEDGER_REF = 'T-#A8A9-CROSS-BOOK';
const BATCH_TAG = 'A8A9-batch13';
/** 存档 body 的分段标记（与执行器同格式；本文件的解析器**自己写**，不 import 执行器） */
const PAYLOAD_END = '── archive-payload（base64，逐字可复算）──';

// ─── 常量块（由 %TEMP%\a8a9-b13-genconsts.mjs 现盘导出；这批的钉子）───────────────

const BATCH: readonly string[] = [
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

/** 从计划册**逐字搬进**属主册的判据（sha256 搬前 = 搬后；一位不该动） */
const CRITERIA_MOVED: Record<string, { crit: number; sha: string }> = {
  'src/domain/diff_blocks.ts': { crit: 1, sha: '245ed3c9759f29e3b94e67dd0d9ab495edc607a59b1c98e400e6f2ef5e3d9210' },
  'src/domain/dsl_removal.ts': { crit: 2, sha: '95bee20087fe2ea5f28a1c0a9963b5c60b38e92fb16d3ab8062f343a7ec6d7ba' },
  'src/domain/mindmap.ts': { crit: 2, sha: '8cb7b0118ebf9fc3e466a2fda947989659674fbd566404c5ea138ee97b043795' },
  'src/domain/narration.ts': { crit: 2, sha: '36be30dde6f86a8f8abfbf4527d1cb0f3a416c4cdc80c21e63d28b4244497dc6' },
  'src/domain/overlay.ts': { crit: 2, sha: 'ab3a594134dbb31848dbf863465d8c17b1feb32dfadce4e0476629770a2e3694' },
  'src/domain/reasoning.ts': { crit: 2, sha: 'a344e06b9fbf52259bf1d9e9e3aabc00642f4727cbc9cc42750a90619b9a6885' },
  'src/domain/scope.ts': { crit: 1, sha: '648214ecf11ae8c8866919b9cebe55cfa7d3ec5f859edc629ea4720739ff63a1' },
  'src/domain/simulation.ts': { crit: 2, sha: 'e5d07fc8f6ff76ff5deaa1124fc830573b2023eb842a21e6f7e70e93cc99d5cb' },
  'src/domain/types.ts': { crit: 2, sha: 'fbcbee02b049aba7f5d9b2c869cc44a3ca325bc4556cd2936b56754222191cf7' },
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts': { crit: 2, sha: '4c7591170755f6c6c7707bf99c346def1c4a71ab3a4f9ccdf13edf9b6a01be2b' },
  'src/infrastructure/parse/mutants.ts': { crit: 1, sha: 'b842fe44147358a603246898b8a213de83f67b61119c6a7449d55e159d9a47b0' },
};

/** 甲′ 的"搬"那一条：计划册侧有职责、属主侧空白 ⇒ **逐字**搬（sha256 钉住） */
const RESP_MOVED: Record<string, { chars: number; sha: string }> = {
  'src/infrastructure/parse/mutants.ts': { chars: 24, sha: 'e4fe7ca964c4c4982012fef758987500650b7d4daabe285fe3351d69c7348534' },
};

/** 随判据迁的**节点字段** `status` / `overlay`（属主侧空白 ⇒ 搬；sha256 钉住值） */
const NODE_FIELDS: Record<string, Record<string, string>> = {
  'src/domain/overlay.ts': { 'status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1', 'overlay': '7760e590a2a6c4c2f81a6b11f90dba8c726bed1795f4ba3eac1c2725c17ee177' },
  'src/domain/scope.ts': { 'status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da', 'overlay': 'abdabddab7ab6dae5c170bfdf0ab3d8d3d3724309b09878a93b18677ef3f6491' },
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts': { 'status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da', 'overlay': 'a351f8d43f83676ee365528c88d45d8222e1cd9d44597b437fc71d88d3869b21' },
  'src/infrastructure/parse/mutants.ts': { 'status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da', 'overlay': 'ce3937dc3606368871926be115e62abe62cf53ef96e7b95a4e381b2ba978d8e7' },
};

/** 随整份 decision 搬过来的**散文键**（属主侧原本连 decision 都没有 ⇒ 这是"搬"不是"覆盖"） */
const PROSE_KEYS: Record<string, readonly string[]> = {
  'src/domain/diff_blocks.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/dsl_removal.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/mindmap.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/narration.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/overlay.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/reasoning.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/scope.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/simulation.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/domain/types.ts': ['acceptance', 'agent', 'summary', 'updated_at'],
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts': ['agent', 'author', 'status', 'summary', 'updated_at'],
  'src/infrastructure/parse/mutants.ts': ['acceptance', 'agent', 'author', 'consequences', 'rationale', 'status', 'summary', 'updated_at'],
};

/** 卡的原始快照（CARD_LEAVE 口径：本批 0 次卡操作 ⇒ 卡的状态/位置一个字节都不许变） */
const CARD_SNAPSHOT: Record<string, readonly string[]> = {
  'src/domain/overlay.ts': ['candidate@book:task-system-plan', 'candidate@live:task-system-plan'],
  'src/domain/scope.ts': ['done@book:task-system-plan'],
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts': ['done@book:task-system-plan'],
};

/** 计划册侧删掉的 11 个节点 id（全是 `nodeIdOf` 单点派生，漂移 0 个） */
const DELETED_IDS: readonly string[] = [
  'file_src_domain_diff_blocks_ts',
  'file_src_domain_dsl_removal_ts',
  'file_src_domain_mindmap_ts',
  'file_src_domain_narration_ts',
  'file_src_domain_overlay_ts',
  'file_src_domain_reasoning_ts',
  'file_src_domain_scope_ts',
  'file_src_domain_simulation_ts',
  'file_src_domain_types_ts',
  'file_src_infrastructure_analysis_deadcode_detect_dead_imports_ts',
  'file_src_infrastructure_parse_mutants_ts',
];

/** 卡在**计划册侧**（CARD_LEAVE 口径：卡一个字节不动，仅记录） */
const CARD_LEAVE: readonly string[] = [
  'src/domain/overlay.ts',
  'src/domain/scope.ts',
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts',
];

/** 界外（本批不动）：D2 2 条（两侧同键不同值；批 14 的账） */
const OUT_OF_SCOPE_D2: readonly string[] = [
  'src/infrastructure/parse/kernel.ts',
  'src/infrastructure/storage.ts',
];

/**
 * ★ 批 14（2026-11-18）：D2 2 条**已被收口**（判据**并集** + 同键不同值存档 + 计划册侧节点删）。
 * 本批（13）自己的账在 `tests/p1_cross_book_batch14.test.ts`；这里只用来把"界外余量"的公式对齐现盘。
 */
const COLLECTED_BY_B14: readonly string[] = [...OUT_OF_SCOPE_D2];
/** 批 14 跟走（并进属主册）的判据条数 */
const CRITERIA_MOVED_BY_B14 = 18;
/** 批 15 整份搬（属主错位 10 条 path）的判据条数 —— 搬完计划册判据 = 0（账在 p1_cross_book_batch15.test.ts） */
const CRITERIA_MOVED_BY_B15 = 29;

/** 读数（常量算术：只钉"Δ = 本批 path 数 / 判据数 / 字数"这类恒等式） */
// ★ 2026-11-19（集成席 · merge feat/api-edges 后）：854 → 854 —— agent-io 册 +15 条**合法新增**（semantic_facts +6 / verify-changed +3 / kernel 判据并集 +3 / run-tests +2 / 新节点 vue_sfc.ts +1），工具面 7 不变；不是漂，是显式改。
const CRITERIA_TOTAL = 857; // 主控裁定：855 +2（T-#LEDGER-CURRENT-PROJECTION：ledger 当前性 1 条 + patrol 悬空取代 1 条；render/reconcile 为替换）
const BEFORE_CRITERIA_AI = 782; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15（合法新增），本批差额不变
const CRITERIA_IN_AI = 801; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15，差额 47 不变
const BEFORE_CRITERIA_TSP = 66;
const CRITERIA_IN_TSP = 47;
const CRITERIA_IN_TOOLFACE = 7;
const CRITERIA_MOVED_COUNT = 19;
const RESP_TOTAL_BEFORE = 11699; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：现盘读数
const RESP_TOTAL_AFTER = 11699; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：前后相等（本批 0 字净变）
const RESP_AI_BEFORE = 11491; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：重基：AI 现 10638 − 本批搬来 24
const RESP_AI_AFTER = 11515; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：现盘 agent-io 职责字数
const RESP_TSP_BEFORE = 24; // // ★ 2026-11-19（集成席 · merge feat/api-edges）：重基（计划册已退役，TSP_AFTER=0 ⇒ BEFORE=搬走 24）
const RESP_TSP_AFTER = 0; // ★ 2026-11-19（集成席 · merge feat/api-edges）：计划册退役 ⇒ 读数为 0
const RESP_MOVED_CHARS = 24;
const MULTI_BEFORE = 13;
const MULTI_AFTER = 2;
const ID_DRIFT_BEFORE = 10;
const ID_DRIFT_AFTER = 10;
const TSP_OWNS_BEFORE = 13;
const TSP_OWNS_AFTER = 2;
const DELETED_NODES = 11;
const DELETED_SEMANTICS = 11;
const DELETED_EDGES = 18;
const BEFORE_NODES_TSP = 131;
const TSP_NODES_AFTER = 120;
const BEFORE_SEM_TSP = 25;
const TSP_SEMANTIC_AFTER = 14;
const BEFORE_EDGES_TSP = 200;
const ARCHIVE_PATHS = 0;
const ARCHIVE_VALUES = 0;
const PROSE_MOVED_KEYS = 49;
const SEM_STATUS_MOVES = 4;
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const shaOfJson = (v: unknown) => createHash('sha256').update(JSON.stringify(v), 'utf-8').digest('hex');
/** 原文字节的 sha（不加 JSON 引号）—— 职责文本 / 判据 的搬运是"字节相同"，不是"JSON 相同" */
const shaOfText = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

function repoSheets(): Array<BookSheetLike & { feature: string }> {
  return [AI, 'agent-io-toolface', TSP].map((feature) => ({
    ...(MIGRATION_BOOKS[feature] as unknown as BookSheetLike),
    feature,
  }));
}

function bookOf(feature: string): BookSheetLike & { feature: string } {
  const raw = MIGRATION_BOOKS[feature];
  assert.ok(raw, `fixture 里必须有 ${feature} 册（历史迁移证据不许读当前活册）`);
  return { ...(raw as unknown as BookSheetLike), feature };
}
/** ★ 从不可变 fixture 读原文的盘上形状（历史迁移证据不随当前活册改判据而漂） */
function rawBook(feature: string): Record<string, unknown> {
  const raw = MIGRATION_BOOKS[feature];
  assert.ok(raw, `fixture 里必须有 ${feature} 册（历史迁移证据不许读当前活册）`);
  return raw as Record<string, unknown>;
}
/** 向快照中的既有册追加节点；不得追加同名第二册，否则反例会丢掉原册的其他节点。 */
function withExtraNodes(
  sheets: Array<BookSheetLike & { feature: string }>,
  feature: string,
  extra: Array<Record<string, unknown>>,
): Array<BookSheetLike & { feature: string }> {
  return sheets.map((s) => s.feature === feature
    ? { ...s, geometry: { ...s.geometry, nodes: [...(s.geometry?.nodes ?? []), ...extra] } }
    : s);
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
  for (const f of [AI, TSP, TOOLFACE]) n += rawSems(f).reduce((t, x) => t + String(x.responsibility ?? '').trim().length, 0);
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
function nodeOf(feature: string, p: string): RawNode | undefined {
  return rawNodes(feature).find((n) => norm(n.path) === p);
}

// ════════════════════════════════════════════════════════════════════
// 13.1 / 13.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('13.1 真仓：11 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数逐条对表', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of BATCH) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须恰由 ${AI} 持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
    const want = CRITERIA_MOVED[p]?.crit;
    assert.equal(typeof want, 'number', `\`${p}\` 必须在判据表里（漏一条 = 有一条没人核）`);
    assert.equal(hs[0]?.expectations, want, `\`${p}\` 的判据条数必须是 ${String(want)}（实测 ${hs[0]?.expectations}）`);
  }
});

test('13.1b 计划册里这 11 个 path 的节点 / 语义 / 边都不在了；11 个被删节点 id 在非属主册里不再出现', () => {
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
// 13.2 / 13.2b 清单形状 + "名单是死的、前提是活的"
// ════════════════════════════════════════════════════════════════════
test('13.2 清单形状：11 条 · 码位序 · 段位 9/2 · 判据表与清单逐条同集 · 界外 2 条 · 算术 11+2=13', () => {
  assert.equal(BATCH.length, 11, `本批 11 条（实测 ${BATCH.length}）`);
  assert.deepEqual([...BATCH].sort(), BATCH, '本批必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  const segDomain = BATCH.filter((p) => p.startsWith('src/domain/')).length;
  const segInfra = BATCH.filter((p) => p.startsWith('src/infrastructure/')).length;
  assert.equal(segDomain, 9, `段位：src/domain/** 9 条（实测 ${segDomain}）`);
  assert.equal(segInfra, 2, `段位：src/infrastructure/** 2 条（实测 ${segInfra}）`);
  assert.equal(segDomain + segInfra, BATCH.length, '段位之和必须等于 11（漏一条就红）');

  assert.deepEqual(Object.keys(CRITERIA_MOVED).sort(), [...BATCH].sort(), '判据表必须与清单**逐条同集**');
  assert.equal(Object.keys(CRITERIA_MOVED).length, 11, '判据表 11 条');
  assert.equal(Object.values(CRITERIA_MOVED).reduce((s, x) => s + x.crit, 0), CRITERIA_MOVED_COUNT, `判据合计 ${CRITERIA_MOVED_COUNT} 条`);
  assert.deepEqual(Object.keys(PROSE_KEYS).sort(), [...BATCH].sort(), '散文键表必须与清单**逐条同集**');
  assert.equal(PROSE_MOVED_KEYS, 49, `散文键总数 49（实测 ${PROSE_MOVED_KEYS}）`);
  for (const p of BATCH) {
    const k = PROSE_KEYS[p]?.length ?? 0;
    assert.ok(k >= 4 && k <= 8, `\`${p}\` 的散文键必须是 4–8 个（实测 ${k}）`);
  }
  assert.equal(Object.keys(RESP_MOVED).length, 1, '职责搬运 1 条（mutants.ts）');
  assert.equal(Object.keys(NODE_FIELDS).length, SEM_STATUS_MOVES, 'status/overlay 搬运条数必须与 semantic.status 搬运条数一致（4）');
  assert.equal(CARD_LEAVE.length, 3, '带卡留账 3 条（卡在计划册侧）');
  assert.deepEqual(Object.keys(CARD_SNAPSHOT).sort(), [...CARD_LEAVE].sort(), '卡快照必须与带卡留账名单逐条同集');
  assert.equal(DELETED_IDS.length, DELETED_NODES, `删的节点数 ${DELETED_NODES} 必须等于 id 清单长度`);
  assert.equal(OUT_OF_SCOPE_D2.length, 2, `界外 D2 2 条（实测 ${OUT_OF_SCOPE_D2.length}）`);
  for (const p of OUT_OF_SCOPE_D2) assert.ok(!BATCH.includes(p), `界外的 \`${p}\` 不许在本批里`);
  assert.equal(BATCH.length + OUT_OF_SCOPE_D2.length, MULTI_BEFORE, '本批 11 + 界外 2 = 批 12 收口时的 13 条多册持有（算术闭合）');
});

test('13.2b 名单是死的、前提是活的：名单必须逐条 = 现盘 C·tsp 类全体（集合相等）；收完恰好剩 2（= D2 2）', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  // ★ 批 14 棘轮（2026-11-18）：D2 2 条已由批 14 收口 ⇒ 现盘 0（多册持有归零）。公式从"= 2"改成"= 2 − 批 14"。
  const remain = [...OUT_OF_SCOPE_D2].filter((p) => !COLLECTED_BY_B14.includes(p)).sort();
  assert.equal(multi.length, remain.length, `多册持有必须恰好 ${remain.length}（批 13 收口 2 − 批 14 收走 ${COLLECTED_BY_B14.length}；实测 ${multi.length}）`);
  assert.deepEqual([...multi].sort(), remain, '收完之后仍两册持有的必须**逐条等于**界外余量（名单没被挑过）');
  for (const p of BATCH) assert.ok(!multi.includes(p), `本批的 \`${p}\` 必须已不在多册持有集合里`);
  for (const p of COLLECTED_BY_B14) assert.ok(!multi.includes(p), `批 14 收走的 \`${p}\` 必须已不在多册持有集合里（批 14 的证在 14.2b）`);
  // ★ 独立复算（不看执行器，只看册）：C·tsp ⇔ 计划册侧有判据 ∧ 属主侧 0 判据
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  const aiCritOf = new Map<string, number>();
  for (const s of sheets.filter((x) => x.feature === AI)) for (const n of nodesOf(s)) aiCritOf.set(norm(n.path), ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length);
  const tspCritOf = new Map<string, number>();
  for (const s of sheets.filter((x) => x.feature === TSP)) for (const n of nodesOf(s)) tspCritOf.set(norm(n.path), ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length);
  const leftoverCtsp = multi.filter((p) => (tspCritOf.get(p) ?? 0) > 0 && (aiCritOf.get(p) ?? 0) === 0);
  assert.deepEqual(leftoverCtsp, [], `收完之后不许再剩任何 C·tsp（计划册侧有判据 + 属主侧空白）；实测 ${leftoverCtsp.join(', ')}`);
  const stillTwoBook = [...holdings.keys()].filter((p) => new Set((holdings.get(p) ?? []).map((h) => h.feature)).size >= 2).sort();
  assert.deepEqual(stillTwoBook, remain, `现盘仍两册持有的集合必须逐条等于界外余量（批 13 收口 2 条 − 批 14 收走 ${COLLECTED_BY_B14.length}）`);
});

// ════════════════════════════════════════════════════════════════════
// 13.3 判据逐字节 + 守恒 / 13.3b 有牙
// ════════════════════════════════════════════════════════════════════
test(`13.3 判据**逐字节搬**：19 条逐条 sha256 搬前=搬后；总数守恒 ${CRITERIA_TOTAL}`, () => {
  const aiNodes = rawNodes(AI);
  let moved = 0;
  const kinds: Record<string, number> = {};
  for (const [p, want] of Object.entries(CRITERIA_MOVED)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.crit, `\`${p}\` 搬过来的判据条数必须是 ${want.crit}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.sha, `\`${p}\` 的判据必须**逐字节**等于计划册侧那份（sha 变了 = 重写/改编）`);
    moved += exps.length;
    for (const e of exps as Array<Record<string, unknown>>) kinds[String(e.kind)] = (kinds[String(e.kind)] ?? 0) + 1;
  }
  assert.equal(moved, CRITERIA_MOVED_COUNT, `本批搬的判据数必须是 ${CRITERIA_MOVED_COUNT}（实测 ${moved}）`);
  assert.deepEqual(kinds, { run: 16, 'source-has': 3 }, '判据 kind 分布必须是 16 run + 3 source-has（搬的是原件，不是重造的）');
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaOf(s)}`).join(' · ');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 ${CRITERIA_TOTAL}（实测 ${per}）`);
  // ★ 批 14 棘轮（2026-11-18）：批 13 收口时 agent-io = 785 / 计划册 = 47；批 14 把计划册侧的 18 条
  //   **并进**属主册（D2 并集）⇒ 现盘 803 / 29。钉"= 785 / = 47"会把批 14 的合法并集判红
  //   ⇒ 改成**方向 + 差集**（Δ 必须等于后续批跟走的条数；去掉它必须回到 785 / 47）。
  assert.ok(criteriaOf(bookOf(AI)) >= CRITERIA_IN_AI, `agent-io 册判据只许不减（批 13 收口 ${CRITERIA_IN_AI}；实测 ${criteriaOf(bookOf(AI))}）`);
  assert.ok(criteriaOf(bookOf(TSP)) <= CRITERIA_IN_TSP, `计划册判据只许不增（批 13 收口 ${CRITERIA_IN_TSP}；实测 ${criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf(AI)) - CRITERIA_IN_AI, CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15 + 2, `属主册涨幅 = 批 14 + 批 15 搬进来的 ${CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条 + current-projection 净增 2（实测 ${criteriaOf(bookOf(AI)) - CRITERIA_IN_AI}）`);
  assert.equal(CRITERIA_IN_TSP - criteriaOf(bookOf(TSP)), CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15, `计划册降幅必须恰等于批 14 + 批 15 搬走的 ${CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条（实测 ${CRITERIA_IN_TSP - criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf(TOOLFACE)), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  assert.equal(CRITERIA_IN_AI - BEFORE_CRITERIA_AI, CRITERIA_MOVED_COUNT, '属主册涨幅必须恰等于搬来的判据数（19）');
  assert.equal(BEFORE_CRITERIA_TSP - CRITERIA_IN_TSP, CRITERIA_MOVED_COUNT, '计划册降幅必须恰等于搬走的判据数（19）');
  assert.equal(BEFORE_CRITERIA_AI + BEFORE_CRITERIA_TSP + CRITERIA_IN_TOOLFACE + 2, CRITERIA_TOTAL, '守恒是**算术**：855 + current-projection 净增 2 = 857');
});

test(`13.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < ${CRITERIA_TOTAL}，差额恰是该节点的判据数`, () => {
  const sheets = repoSheets();
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `前提：fixture 的读数是 ${CRITERIA_TOTAL}`);
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
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 13.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 13.4 甲′（整份 decision / 散文键 / 节点字段 / 职责 / 0 存档）
// ════════════════════════════════════════════════════════════════════
test('13.4 甲′ 散文：**整份 decision 采用**（属主侧搬前 0 decision）；散文键集合逐条对表（49 键）', () => {
  for (const p of BATCH) {
    const n = nodeOf(AI, p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    const d = (n.decision ?? {}) as Record<string, unknown>;
    assert.ok(Object.keys(d).length > 0, `\`${p}\` 搬完后必须带 decision（属主侧原本连 decision 都没有 ⇒ 这是"搬"）`);
    const prose = Object.keys(d).filter((k) => k !== 'expectations').sort();
    const want = [...(PROSE_KEYS[p] ?? [])].sort();
    assert.deepEqual(prose, want, `\`${p}\` 的散文键集合必须逐条对表（少一个键 = 丢叙事；多一个键 = 凭空造）`);
    for (const k of prose) {
      const v = d[k];
      assert.equal(typeof v, 'string', `\`${p}.${k}\` 必须是字符串原文（实测 ${typeof v}）`);
      assert.ok(String(v).trim().length > 0, `\`${p}.${k}\` 不许是空串`);
    }
    // ★ 属主册侧的 upsert 不许把 decision 的其它键（如 attribution）洗掉 —— 逐键都在表里
    assert.deepEqual(Object.keys(d).sort(), ['expectations', ...want].sort(), `\`${p}\` 的 decision 只许 = expectations + 那 ${want.length} 个散文键`);
  }
  const keys = BATCH.reduce((s, p) => s + (PROSE_KEYS[p]?.length ?? 0), 0);
  assert.equal(keys, PROSE_MOVED_KEYS, `散文键合计必须是 ${PROSE_MOVED_KEYS}（实测 ${keys}）`);
});

test('13.4b 甲′ 节点字段：`status` / `overlay` **随判据迁**（4 条，值逐字 sha256；属主侧原本空白）', () => {
  const aiNodes = rawNodes(AI);
  let checked = 0;
  for (const [p, want] of Object.entries(NODE_FIELDS)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    for (const [k, sha] of Object.entries(want)) {
      assert.equal(shaOfJson(n[k]), sha, `\`${p}.${k}\` 必须**逐字**从计划册搬过来（sha 变了 = 改写过）`);
      checked += 1;
    }
  }
  assert.equal(Object.keys(NODE_FIELDS).length, 4, 'status/overlay 搬运 4 条（overlay/scope/detect_dead_imports/mutants）');
  assert.equal(checked, 8, '每条 path 两个字段（status + overlay）⇒ 8 处');
  // ★ status 的取值必须与搬前那个状态一致（不是"随手设成 done"）
  assert.equal(nodeOf(AI, 'src/domain/overlay.ts')?.status, 'draft', 'overlay.ts 的 status 搬过来必须是 draft（计划册侧原样）');
  assert.equal(nodeOf(AI, 'src/domain/scope.ts')?.status, 'done', 'scope.ts 的 status 搬过来必须是 done');
  for (const p of ['src/domain/diff_blocks.ts', 'src/domain/types.ts']) {
    assert.equal(nodeOf(AI, p)?.status, undefined, `\`${p}\` 计划册侧本来就没有 status ⇒ 属主册也不许凭空长出一个`);
  }
  // semantic.status 一并搬（draft / done×3）
  assert.equal(String(semOf(AI, 'src/domain/overlay.ts')?.status ?? ''), 'draft', 'semantic.status 必须随节点字段一起搬（overlay.ts = draft）');
  assert.equal(String(semOf(AI, 'src/infrastructure/parse/mutants.ts')?.status ?? ''), 'done', 'semantic.status 必须随节点字段一起搬（mutants.ts = done）');
});

test('13.4c 甲′ 职责 + 存档：`mutants.ts` 24 字逐字搬；职责字数两侧合并后守恒 10,366；本批存档 0 条', () => {
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
  assert.equal(RESP_AI_AFTER - RESP_AI_BEFORE, RESP_MOVED_CHARS, '属主册涨幅必须恰等于搬来的字数（24）');
  assert.equal(RESP_TSP_BEFORE - RESP_TSP_AFTER, RESP_MOVED_CHARS, '计划册降幅必须恰等于搬走的字数（24）');
  assert.equal(RESP_AI_BEFORE + RESP_TSP_BEFORE + (RESP_TOTAL_AFTER - RESP_AI_AFTER - RESP_TSP_AFTER), RESP_TOTAL_BEFORE, '守恒是算术（工具面那一段没动）');
  // ★ 有牙：改一个字节 / 清空 ⇒ 指纹与字数都变
  const [p0, want0] = Object.entries(RESP_MOVED)[0]!;
  const cur = String(semOf(AI, p0)?.responsibility ?? '');
  assert.notEqual(shaOfText(`${cur} `), want0.sha, '加一个尾空格，指纹必须变 —— 否则 sha 判据是摆设');
  assert.notEqual(shaOfText(''), want0.sha, '清空职责，指纹必须变');
  // ★ 本批存档 0 条：属主侧连 decision 都没有 ⇒ 没有"同键不同值"，不许凭空挂账
  assert.equal(ARCHIVE_PATHS, 0, '本批的"被顶掉的败方原文"必须是 0 条 path');
  assert.equal(ARCHIVE_VALUES, 0, '本批的"被顶掉的败方原文"必须是 0 个值');
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  assert.ok(String(baseline.multi_owned.why ?? '').includes('批 13（C·tsp 段'), '门档 multi_owned.why 必须记着批 13 的来路');
  for (const p of [...BATCH]) assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 why 必须逐条点着本批 \`${p}\``);
});

// ════════════════════════════════════════════════════════════════════
// 13.5 域表改判 11 条
// ════════════════════════════════════════════════════════════════════
test('13.5 域表**改判 11 条**：本批 11 条属主 = agent-io；计划册 owns 13 → 2（余 D2 两 path）；前缀仍在', () => {
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
  assert.equal(TSP_OWNS_BEFORE - tspOwns.length, BATCH.length + COLLECTED_BY_B14.length, `计划册 owns 的降幅必须恰等于"本批 path 数 + 批 14 的 2 条"（13 − 11 − 2 = 0）`);
  // ★ 棘轮：只许不增（批 14 还会继续摘），但**不许被清空**
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER, `计划册 owns 只许不增（批 13 收口 ${TSP_OWNS_AFTER}；实测 ${tspOwns.length}）`);
  // ★ 批 14 棘轮（2026-11-18）：计划册 owns 已被清空（2 → 0）⇒ "不许被清空"这条历史约束退役；
  //   清空之后要断的是**清空有账**（批 14 的门档 why 点名它的来路；逐条摘的是 D2 两条精确条目）。
  if (tspOwns.length === 0) {
    const baseline14 = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
    assert.ok(String(baseline14.multi_owned.why ?? '').includes('批 14（D2 终局'), '计划册 owns 清空必须由批 14 的账背书（门档 why 点名）');
    for (const p of COLLECTED_BY_B14) assert.ok(String(baseline14.multi_owned.why ?? '').includes(p), `门档 why 必须点着批 14 摘掉的 \`${p}\``);
  } else {
    assert.ok(tspOwns.length > 0, `计划册 owns 不许被清空（实测 ${tspOwns.length}）`);
  }
  for (const p of BATCH) assert.ok(!tspOwns.includes(p), `计划册 \`owns[]\` 里不许再有本批的精确条目 \`${p}\`（已改判）`);
  // ★ 剩下的必须逐条是"界外余量"（批 13 之后 = D2 2；批 14 之后 = 0）—— 不是"随手剩下的一堆"
  assert.deepEqual([...tspOwns].sort(), [...OUT_OF_SCOPE_D2].filter((p) => !COLLECTED_BY_B14.includes(p)).sort(), `计划册 owns 余下的必须逐条等于界外余量（实测 [${tspOwns.join(', ')}]）`);
  for (const pre of ['src/', 'scripts/', 'tests/', 'docs/', 'dogfood/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  const raw = fs.readFileSync(path.join(REPO, 'design-books.json'), 'utf8');
  assert.ok(raw.includes('批 13'), 'design-books.json 的 note/why 必须记着批 13（散文追加 + owns 改判）');
});

// ════════════════════════════════════════════════════════════════════
// 13.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('13.6 ② 档：这 11 条 klass = owned；塞回任一条 ⇒ 立刻 multi_owned（鉴别力）；path 分母**只许不降**（floor 569）', () => {
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
  assert.equal(now.books, 3, `fixture 保留迁移期三册快照（historical proof；当前活册数由独立当前性检查负责）`);
  const p0 = BATCH[0]!;
  // ★ 历史 fixture 含计划册：向**既有**计划册追加这个 path，保留其他节点；不得追加同名第二册。
  const world2 = withExtraNodes(sheets, TSP, [{ id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }]);
  const two = crossBookOwnership(world2, read);
  assert.equal(two.rows.find((r) => r.path === p0)?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
});

// ════════════════════════════════════════════════════════════════════
// 13.7 写端
// ════════════════════════════════════════════════════════════════════
test('13.7 写端：批 13 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 13 的改判是可逆的）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as { geometry: { nodes: Array<Record<string, unknown>> }; semantic?: unknown };
    ai.geometry.nodes[0]!.decision = { summary: '属主册写判据必须放行', expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '消融：属主册写自己的 path' }] };
    ai.semantic = { files: [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts', responsibility: '属主册写自己的 path 必须放行', status: 'done' }] };
    saveDSL(ai as unknown as Parameters<typeof saveDSL>[0], 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as {
      geometry: { nodes: Array<{ decision?: { expectations?: unknown[] }; status?: string; overlay?: unknown }> };
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
// 13.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('13.8 门档：多册持有 ≤ 2（13 − 11）· id 漂移 ≤ 10 · 属主错位 ≤ 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(now.multi_owned.length <= MULTI_AFTER, `多册持有只许不增（批 13 收口 ${MULTI_AFTER}；实测 ${now.multi_owned.length}）`);
  assert.equal(MULTI_BEFORE - MULTI_AFTER, BATCH.length, '批 13 的降幅必须逐字等于本批 path 数');
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER, `id 漂移只许不增（批 13 收口 ${ID_DRIFT_AFTER}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE, ID_DRIFT_AFTER, '本批删的全是单点派生 id ⇒ 漂移一条不该变');
  for (const p of BATCH) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（本批把属主改判成它了）`);
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
// 13.9 存档 0 条 + 跨批不进水 / 13.9b 机制可移植
// ════════════════════════════════════════════════════════════════════
test('13.9 **存档 0 条**：本批（A8A9-batch13）一条都不许挂；批 10 的 35 + 批 11 的 1 条仍自证且未被改写', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆 / 首次检出）⇒ 台账存档不在版本库里，读不回；机制由 13.9b 钉住');
    return;
  }
  const row = getRow(REPO, LEDGER_REF);
  if (!row) {
    t.skip(`台账里没有 \`${LEDGER_REF}\` 这一行（本机台账未导入）⇒ 读不回`);
    return;
  }
  assert.equal(row.state, 'done', `${LEDGER_REF} 必须是done（整卷已收口，078f8b77）（批 13 还没收口；销账后不许再往上挂）`);
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
  assert.equal(mine, ARCHIVE_PATHS, `本批存档必须恰好 ${ARCHIVE_PATHS} 条（实测 ${mine}）—— 属主侧连 decision 都没有，凭空挂账 = 假证据`);
  assert.equal(batches.get('A8A9-batch10'), 35, `批 10 的 35 条存档必须原样还在（append-only；实测 ${String(batches.get('A8A9-batch10'))}）`);
  assert.equal(batches.get('A8A9-batch11'), 1, `批 11 的 1 条存档必须原样还在（实测 ${String(batches.get('A8A9-batch11'))}）`);
  assert.equal([...batches.keys()].includes(BATCH_TAG), false, `台账里不许出现 \`${BATCH_TAG}\` 这个分组（本批 0 条）`);
});

test('13.9b 上一条**可移植**：夹具里 hangRow + annotateRow 往返（空存档 + 非空存档两种 payload 都必须读得回）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
    hangRow(proj, { refId: 'T-#FIXTURE-B13', section: 'fixture', title: '批 13 存档往返夹具', by: 'test' });
    const mk = (path13: string, dropped: Record<string, unknown>) => {
      const payload = {
        batch: BATCH_TAG,
        ref: 'T-#FIXTURE-B13',
        path: path13,
        loser: { book: TSP, node_id: 'file_src_domain_fixture13_ts' },
        keeper: { book: AI, node_id: 'file_src_domain_fixture13_ts' },
        dropped,
        moved_keys: Object.keys(dropped).map((k) => k.replace(/^decision\./, '')),
        moved_responsibility: true,
        moved_semantic_status: null,
        moved_node_fields: [],
        moved_expectations: 0,
        identical_keys: [],
      };
      const json = JSON.stringify(payload);
      const body = [
        '迁移存档：败方原文',
        `批 13（甲′：散文口径 = 属主侧为准 + 败方原文逐字存档）· T-#FIXTURE-B13 · ${BATCH_TAG}`,
        `path: ${path13}`,
        '',
        '── 败方原文（逐字）──',
        ...Object.entries(dropped).flatMap(([k, v]) => [`[${k}]`, String(v)]),
        '',
        PAYLOAD_END,
        Buffer.from(json, 'utf8').toString('base64'),
        `sha256(payload)= ${createHash('sha256').update(json, 'utf8').digest('hex')}`,
      ].join('\n');
      return { payload, json, body };
    };
    // ★ 本批的形态（0 个值）与"真有冲突"的形态（1 个值）都要能往返 —— 否则"0 条"这件事不可证
    const empty = mk('src/domain/fixture13-empty.ts', {});
    const full = mk('src/domain/fixture13-full.ts', { 'decision.summary': '败方原文：两册都写了 summary 且不一样' });
    annotateRow(proj, 'T-#FIXTURE-B13', empty.body, 'test');
    annotateRow(proj, 'T-#FIXTURE-B13', full.body, 'test');
    const row = getRow(proj, 'T-#FIXTURE-B13');
    assert.ok(row, '夹具台账行必须读得回来');
    const ev = row.events.filter((e) => e.kind === 'annotate');
    assert.equal(ev.length, 2, '必须恰好两条 annotate 事件');
    for (const [i, want] of [empty, full].entries()) {
      assert.equal(String(ev[i]!.body), want.body, 'annotate 事件 body 必须**逐字**存下（首尾空白也不许剪）');
      const parsed = parseArchive(String(ev[i]!.body));
      assert.ok(parsed, '同一份格式必须解析得回来');
      assert.equal(parsed!.payloadSha, createHash('sha256').update(want.json, 'utf8').digest('hex'), 'payload sha 必须一致');
      assert.deepEqual(parsed!.payload.dropped, want.payload.dropped, `第 ${i + 1} 条 payload 的 dropped 必须逐字段相同`);
    }
    assert.deepEqual(parseArchive(String(ev[0]!.body))!.payload.dropped, {}, '空存档（0 个值）也必须往返成立 —— 否则"本批 0 条"就不可证');
    assert.equal(String((parseArchive(String(ev[1]!.body))!.payload.dropped as Record<string, string>)['decision.summary']), '败方原文：两册都写了 summary 且不一样', '非空存档的原文必须逐字读回');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 13.10 界外账 / 13.10b 判据只搬一次
// ════════════════════════════════════════════════════════════════════
test('13.10 **界外账**：D2 2 条由批 14 收口（本批仍两册；批 14 之后单册 = 属主册）', () => {
  const read = crossBookReadingOf(REPO);
  const multi = new Set(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path));
  for (const p of OUT_OF_SCOPE_D2) {
    assert.ok(!BATCH.includes(p), `\`${p}\` 不该在本批清单里`);
    // ★ 批 14 棘轮（2026-11-18）：这 2 条已由批 14 收口 ⇒ 现盘**不再**两册持有。
    //   界外账改判成"收 ≠ 删"：单册 = 属主册，判据在属主册、计划册侧节点已删（下面两段逐条核）。
    assert.ok(!multi.has(p), `\`${p}\` 已由批 14 收口 ⇒ 不该仍两册持有（界外 ≠ 已处理；批 14 的证在 14.2b）`);
  }
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  for (const p of BATCH) {
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须已被收成单册 = ${AI}（实测 ${feats.join('/') || '无人持有'}）`);
  }
  // ★ 批 14 收口之后：D2 两册的"两侧判据都还在"必须反过来核 —— 计划册侧 0 条、属主册侧 > 0 条（收 ≠ 删）
  const d2Tsp = new Map<string, number>();
  for (const n of rawNodes(TSP)) d2Tsp.set(norm(n.path), (n.decision?.expectations ?? []).length);
  const d2Ai = new Map<string, number>();
  for (const n of rawNodes(AI)) d2Ai.set(norm(n.path), (n.decision?.expectations ?? []).length);
  for (const p of OUT_OF_SCOPE_D2) {
    assert.equal(d2Tsp.get(p) ?? 0, 0, `界外的 \`${p}\` 在计划册侧的节点与判据必须已由批 14 删掉（收 ≠ 复制）`);
    assert.ok((d2Ai.get(p) ?? 0) > 0, `界外的 \`${p}\` 的判据必须在属主册（收 ≠ 删）`);
  }
});

test(`13.10b **判据只搬一次**：补回 11 个空壳 ⇒ 多册 +11 而判据仍 ${CRITERIA_TOTAL}；再补回那 19 条 ⇒ ${CRITERIA_TOTAL + CRITERIA_MOVED_COUNT}（重复）`, () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `前提：fixture 的判据总数是 ${CRITERIA_TOTAL}`);
  // 世界 A：把 11 个**空壳**补回计划册（无 decision、无语义负载）—— 正是本批删掉的那个形状
  const shells = BATCH.map((p) => ({ id: nodeIdOf(p), label: path.basename(p), type: 'file', x: 0, y: 0, path: p }));
  // ★ 历史 fixture 含计划册：向既有册补回 11 个空壳，保留册内其他节点与判据。
  const worldA = withExtraNodes(sheets, TSP, shells);
  const a = crossBookOwnership(worldA, read);
  for (const p of BATCH) assert.equal(a.rows.find((r) => r.path === p)?.klass, 'multi_owned', `\`${p}\` 在"没做本批"的世界里必须是 multi_owned`);
  assert.equal(a.counts.multi_owned, now.counts.multi_owned + BATCH.length, `补回 11 个空壳 ⇒ 多册持有必须恰好 +11（实测 ${a.counts.multi_owned - now.counts.multi_owned}）`);
  assert.equal(criteriaTotal(worldA), CRITERIA_TOTAL, `补回空壳后判据总数必须仍 ${CRITERIA_TOTAL} —— 本批删的是"壳"，判据已经搬进属主册，没有丢`);
  // 世界 B：连那 19 条判据也补回计划册 ⇒ 当前快照总数 + 19（**双份**）—— 说明快照里它们恰好只有一份
  const revivedWithPayload = BATCH.map((p) => {
    const n = nodeOf(AI, p);
    const node: Record<string, unknown> = { id: nodeIdOf(p), label: path.basename(p), type: 'file', x: 0, y: 0, path: p };
    if (n?.decision) node.decision = { expectations: n.decision.expectations };
    return node;
  });
  const worldB = withExtraNodes(sheets, TSP, revivedWithPayload);
  assert.equal(criteriaTotal(worldB), CRITERIA_TOTAL + CRITERIA_MOVED_COUNT, `把 19 条判据也补回计划册 ⇒ 判据必须是 ${CRITERIA_TOTAL + CRITERIA_MOVED_COUNT}（双份）；实测 ${criteriaTotal(worldB)}`);
  assert.equal(respTotalSheets(worldA), respTotalSheets(sheets), '补回的空壳不带职责 ⇒ 职责总字数一字不变（24 字已经在属主册）');
});

// ════════════════════════════════════════════════════════════════════
// 13.11 卡账（CARD_LEAVE）
// ════════════════════════════════════════════════════════════════════
test('13.11 **卡账（CARD_LEAVE）**：3 条带卡且全在**计划册侧**；删节点后**卡不动**、活卡仍在库里、属主册不伪造册上卡', (t) => {
  const tspNodes = rawNodes(TSP);
  const aiNodes = rawNodes(AI);
  for (const p of BATCH) {
    assert.equal(tspNodes.find((n) => norm(n.path) === p), undefined, `\`${p}\` 的计划册节点必须已删`);
    const ai = aiNodes.find((n) => norm(n.path) === p);
    assert.ok(ai, `\`${p}\` 必须在属主册有节点`);
    // ★ CARD_LEAVE 口径：卡不搬到属主册（不伪造"册上卡"）—— 册上投影随败方节点一起消失，卡的真相在 tasks.db
    assert.equal((ai.task as { state?: string } | undefined)?.state, undefined, `\`${p}\` 的属主册节点**不许**凭空长出卡投影（卡的家在 tasks.db）`);
  }
  assert.equal(Object.keys(CARD_SNAPSHOT).length, 3, '带卡留账 3 条');
  // 卡快照逐条对上（state@where）：overlay = candidate（册上 + 活卡）/ scope = done（册上）/ detect_dead_imports = done（册上）
  assert.deepEqual([...CARD_SNAPSHOT['src/domain/overlay.ts']!].sort(), ['candidate@book:task-system-plan', 'candidate@live:task-system-plan'], 'overlay.ts 的卡必须是 candidate（册上 + 活卡）');
  assert.deepEqual([...CARD_SNAPSHOT['src/domain/scope.ts']!].sort(), ['done@book:task-system-plan'], 'scope.ts 的卡必须是 done（册上）');
  const cards = listLiveCards(REPO);
  if (cards.length === 0) {
    t.skip('本机没有活卡（干净克隆：卡的家不在版本库里）⇒ 活卡那半读不回；册上那半已由上面钉住');
    return;
  }
  // ★★★ 2026-11-18（批 16 棘轮）：批 13 的口径是「0 次卡操作、活卡仍挂在计划册分区」。
  //   批 16 已把这张活卡**逐字重挂**到属主册（属主册该节点本批之前没有自己的卡）⇒ 现在合法断言是
  //   **归宿**：仍在（属主册、同名、state 原样）或已入史；**两个都不是 = 丢卡 ⇒ 红**。
  const overlayHome = cardHomeLite('file_src_domain_overlay_ts');
  assert.ok(overlayHome, 'overlay.ts 的活卡不许凭空消失（要么在属主册活着，要么已入史）');
  if (overlayHome.kind === 'live') {
    assert.equal(overlayHome.feature, AI, `overlay.ts 的活卡必须落在属主册（批 16 重挂；实测 ${overlayHome.feature}）`);
    assert.equal(overlayHome.state, 'candidate', '活卡的 state 必须是 candidate（重挂是逐字搬，不改状态）');
  } else {
    assert.ok(['done', 'void'].includes(overlayHome.state), `若已入史，只能是已了结态（实测 ${overlayHome.state}）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 13.12 计划册册容
// ════════════════════════════════════════════════════════════════════
test('13.12 计划册册容：节点 131 → 120 · 语义 25 → 14 · 边 200 → 182（删的数目对得上）', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER, '计划册节点数：131 − 11 = 120');
  assert.equal(BEFORE_SEM_TSP - DELETED_SEMANTICS, TSP_SEMANTIC_AFTER, '计划册语义：25 − 11 = 14');
  assert.equal(BEFORE_EDGES_TSP - DELETED_EDGES, 182, '计划册边：200 − 18 = 182');
  // ★ 棘轮（批 13 收口值只作上界：后续批还会继续删）
  assert.ok(rawNodes(TSP).length <= TSP_NODES_AFTER, `计划册节点数只许减（批 13 收口 ${TSP_NODES_AFTER}；实测 ${rawNodes(TSP).length}）`);
  assert.ok(rawSems(TSP).length <= TSP_SEMANTIC_AFTER, `计划册语义条目数只许减（批 13 收口 ${TSP_SEMANTIC_AFTER}；实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.ok(edgesNow <= BEFORE_EDGES_TSP - DELETED_EDGES, `计划册边数只许减（批 13 收口 ${BEFORE_EDGES_TSP - DELETED_EDGES}；实测 ${edgesNow}）`);
  // 语义条目与节点必须一节点一条（半删会留下幽灵语义）
  const nodeIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  const ghost = rawSems(TSP).filter((s) => !nodeIds.has(String(s.id)));
  assert.deepEqual(ghost, [], `计划册不许留幽灵语义（实测 ${ghost.length} 条）`);
  // 属主册册容：本批只搬负载、不增删节点
  assert.equal(rawNodes(AI).filter((n) => BATCH.includes(norm(n.path))).length, BATCH.length, '属主册这 11 条必须一条不少（收的是负载，不是"删了重扫的壳"）');
});

// ════════════════════════════════════════════════════════════════════
// 13.13 派生快照（COGNITION 不许过期）
// ════════════════════════════════════════════════════════════════════
test('13.13 **派生快照**：COGNITION.txt 里每册的 dsl_rev = 册上现值（改册不重生成快照 ⇒ 这里红）', () => {
  const cogFile = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(cogFile), 'COGNITION.txt 必须存在（它是入库的派生快照）');
  const text = fs.readFileSync(cogFile, 'utf8');
  const seen = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^===feature ([a-z0-9-]+)=== dsl_rev=(\d+) sha256=[0-9a-f]{16}$/);
    if (m) seen.set(m[1]!, m[2]!);
  }
  // ★ 2026-11-18（批 17 · 计划册退役）：`>= 3` → `>= 2`，并把"计划册的段头必须在"**反过来钉**
  //   （它退役后**不该**再在快照里 —— 那一段留在快照里 = 读的人以为它还活着）。
  assert.ok(seen.size >= 2, `快照里必须至少 2 册的段头（实测 ${seen.size}）`);
  for (const [feature, rev] of seen) {
    // 这是当前性检查，不是迁移历史证明：必须读当前活册，不能读不可变迁移夹具。
    const raw = JSON.parse(fs.readFileSync(bookFileOf(feature), 'utf8')) as Record<string, unknown>;
    assert.equal(String(raw._dsl_rev), rev, `${feature} 的 COGNITION 段头 dsl_rev (${rev}) 与册上现值 (${String(raw._dsl_rev)}) 不一致 —— 跑 \`npm run cognition\``);
  }
  assert.ok(!seen.has(TSP), '批 17 之后快照里**不许**再有计划册的段头（它已退役进 design/archived/）');
  assert.ok(seen.has(AI) && seen.has(TOOLFACE), `两本活册的段头都必须在：${[...seen.keys()].join('/')}`);
});

// ════════════════════════════════════════════════════════════════════
// 13.14 真视图 == 引擎现算（本批 0 条存档 ⇒ 摘要行不长）
// ════════════════════════════════════════════════════════════════════
test('13.14 真视图：docs/todo.md == 引擎现算（current）· 视图里 0 处 archive-payload · 本批 0 条存档 ⇒ 摘要行不长', (t) => {
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
  assert.equal(archiveLines.length, 0, 'current-only：存档宿主行已非当前，视图不渲染历史摘要');
  assert.equal(disk.includes(PAYLOAD_END), false, '视图里不许有 base64 存档段');

  const row = getRow(REPO, LEDGER_REF);
  assert.ok(row, `台账里必须有 \`${LEDGER_REF}\``);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  assert.ok(allArchive.length >= 36, `引擎里的迁移存档事件必须 ≥ 36（实测 ${allArchive.length}）`);
  for (const e of allArchive) {
    assert.ok(parseArchive(String(e.body)), `引擎里 event id=${e.id} 的存档必须仍可解析（逐字可复算）`);
  }
  // ★ 批 14 棘轮（2026-11-18）：批 13 收口时是 36 条；批 14 又挂 2 条（D2 两条 path 的败方原文）⇒ 现盘 38。
  //   钉死 36 会把批 14 的合法存档判红 ⇒ 改成**只许不增 + 增量 = 后续批的存档条数**（批 14 = 2）。
  assert.equal(allArchive.length, 36 + 2, `批 13 的 36 + 批 14 的 2 条 = 38（实测 ${allArchive.length}）`);
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
