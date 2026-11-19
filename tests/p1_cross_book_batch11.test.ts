/**
 * P1 · T-#A8A9-CROSS-BOOK **批 11**（**C 类收尾**：判据单边段最后 28 条 + 批 9 §3.2-C 的
 * **断言级那一对** `pool.ts` + `query_feature.ts` **并批**；甲′ 继续；**视图侧「迁移存档」收敛为一行摘要**）—— 红 → 绿。
 *
 * ## 这批要立的十四条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 11.1 | 真仓：28 个 path **各恰一册**持有且是 `agent-io`；节点 id = `nodeIdOf`；判据条数逐条对表 | 搬后没删 / 删错册 / 判据丢条在这里红 |
 * | 11.1b | 计划册侧**三清**（节点 + 语义 + 边）；28 个被删节点 id 在任何**非属主册**里都不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 11.2 | 清单形状：28 条 · **码位序** · 段位 24/4 · 两张判据表与清单**逐条同集** · 界外 30 条 | 手抄错一条 / 顺序漂了在这里红 |
 * | 11.2b | **名单是死的、前提是活的**：名单必须**逐条等于现盘 56 条 C 类码位序的前 28 条** | 名单被"挑"过 / 现盘变了没人管，在这里红 |
 * | 11.3 | 判据**逐字节**：搬的 32 条 sha256 相同；本来就在属主册的 52 条**一位没动**；总数守恒 **854**（766 / 66 / 7；826 + EEP triage 13） | 搬歪 / 重写 / 顺手改判据在这里红 |
 * | 11.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 854，差额恰是那个节点的判据数 | 空断言的照妖镜（R47） |
 * | 11.4 | 甲′ 双向：胜方原文 **sha256 一个字节没动**（`KEEPER_KEPT`）· 属主侧空白/缺失的键**搬过来**（`MOVED_PROSE`）· 整份 `decision` 采用 10 条 | 把"属主侧为准"做成"顺手改成属主侧的模样"在这里红 |
 * | 11.4b | 上一条**有牙**：改一个字节 / 清空一处 ⇒ 指纹立刻变（纯核，不碰真册） | 同上 |
 * | 11.5 | 域表**收窄**：28 条属主 = `agent-io`；改判 11 条摘掉精确条目；计划册 `owns` 24 → 13；前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 11.6 | ② 档：这 28 条 klass = `owned`；塞回任一条 ⇒ 立刻 `multi_owned`（鉴别力）；path 分母**只许不降**（floor 568） | 纯核两世界对照，不碰真册 |
 * | 11.7 | 写端：批 11 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化）；属主册写同一 path ⇒ 过 | 属主册自己写被连带拒 = 一刀切，也在这里红 |
 * | 11.8 | 门档：多册持有 ≤ **30**（58 − 28）、id 漂移 ≤ **10**、属主错位 ≤ 12；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红（钉棘轮，不钉"当前值 = 30"） |
 * | 11.9 | **败方原文存档**：本批 1 条 path / 4 个值的 payload 逐字可读回；**跨批不进水**（批 10 的 35 条仍在且自证成立） | 存档丢字 / 挂错 ref / 把别批的账算成自己的，都在这里红 |
 * | 11.10 | **界外账**：C 类余 28 条 + D2 2 条**仍是两册持有**；被收的 28 条必须单册 = 属主册 | 界外被"顺手收了"在这里红 |
 * | 11.10b | **断言级那一对**：⑦ 档现算 **0 处**；**反证**（只收 `query_feature.ts`）= **1 处** | "两条必须同批"沦为口号（判据在本树上空转）在这里红 |
 * | 11.11 | **卡账**：25 条带卡留账；计划册分区 **5 张活卡** state 一个字节没动（本批 0 次卡操作） | 悄悄把卡删了 / 悄悄收了人家的 path，都在这里红 |
 * | 11.12 | 计划册册容：节点 176 → 148 · 语义 70 → 42 · 边 284 → 226（删的数目对得上） | 只删一种、留下悬空边在这里红 |
 * | 11.13 | **视图渲染细化**：`annotate` ∧ body 以「迁移存档」开头 ⇒ **一行摘要**（36 条 ⇒ 1 行）；其余事件仍逐字 | 存档把视图淹掉（批 10 实测 +896 行）在这里红 |
 * | 11.14 | 真视图 == 引擎现算（`ledger:check` 的 current）∧ 视图里 0 处 `archive-payload` ∧ 引擎里存档仍**逐字** | 视图与引擎各说一套 / "离开视图"退化成"删了证据"，都在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–10 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 28 个 path 恰一册持有"·"判据总数守恒 854"·"判据/散文逐字节"）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 0"（那是批 13 之后的终局）；
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数 / 判据数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ 每一条"有牙"的反检查（11.3b / 11.4b / 11.13 的两世界对照）都跑在**纯核副本**上：真册一个字节都不动。
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
  archiveSummaryLine,
  isArchiveEvent,
  renderEventLines,
  renderLedgerView,
  renderRowEventLines,
  renderRowsToView,
  type ViewEvent,
  type ViewRow,
} from '../src/application/ledger/render_ledger_view.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';

/**
 * 一张卡的"归宿"三态（批 16 起用它判卡账，见 11.11）：
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
const LEDGER_REF = 'T-#A8A9-CROSS-BOOK';
/** 存档 body 的分段标记（与执行器同格式；本文件的解析器**自己写**，不 import 执行器） */
const PAYLOAD_END = '── archive-payload（base64，逐字可复算）──';

// ─── 常量块（由 %TEMP%\a8a9-b11-genconsts.mjs 现盘导出；这批的钉子）───────────────

const BATCH: readonly string[] = [
  'src/application/design/board/pool.ts',
  'src/application/meta/explore/query_feature.ts',
  'src/application/meta/handlers.ts',
  'src/application/meta/index.ts',
  'src/application/meta/integrity/index_integrity.ts',
  'src/application/meta/llm/semantic_search.ts',
  'src/application/observe/index.ts',
  'src/application/observe/reconcile/reason_validator.ts',
  'src/application/observe/runtime/run_tests.ts',
  'src/application/observe/runtime/stale_check.ts',
  'src/application/observe/runtime/watch_project_tool.ts',
  'src/application/patrol/task_drift.ts',
  'src/application/read_set.ts',
  'src/application/refactor/diff_views/diff_views.ts',
  'src/application/refactor/edit/edit_code.ts',
  'src/application/refactor/edit/remove_dead_imports.ts',
  'src/application/refactor/find/field_refs.ts',
  'src/application/refactor/handlers.ts',
  'src/application/refactor/pipeline/refactor_plan.ts',
  'src/application/refactor/rename/rename_file.ts',
  'src/application/refactor/snapshot/file_snapshot.ts',
  'src/application/stage_registry.ts',
  'src/application/tool_registry.ts',
  'src/application/types.ts',
  'src/domain/animation.ts',
  'src/domain/b_terms.ts',
  'src/domain/contract.ts',
  'src/domain/design_sheet.ts',
];

/** 批 9 §3.2-C 的断言级那一对（断言者 pool.ts ↔ 被断言者 query_feature.ts）—— **必须同批** */
const PAIR: readonly string[] = [
  'src/application/design/board/pool.ts',
  'src/application/meta/explore/query_feature.ts',
];

const CRITERIA_MOVED: Record<string, { crit: number; sha: string }> = {
  'src/application/design/board/pool.ts': { crit: 1, sha: '9484125ff41f1b2aa50c24da367c0f96117c20028a0a3b15e8321c50af2602e6' },
  'src/application/meta/explore/query_feature.ts': { crit: 7, sha: '02d4d8894c0c3c92418444a4d1ee3c0920062187b11e930f96908bdb00b974f3' },
  'src/application/observe/runtime/watch_project_tool.ts': { crit: 1, sha: '20643e57f128106980e338aa56e300cdf0428ad5fbcee7bd26e942418e92e349' },
  'src/application/patrol/task_drift.ts': { crit: 5, sha: '2c2f66e06dc54adf5f180e997ebfd27b9022f417ed01cde990804d3755817741' },
  'src/application/refactor/diff_views/diff_views.ts': { crit: 7, sha: '458db70edfb8e49ee757b7681777532128590bd58956cf0e84432303eea4a6d7' },
  'src/application/refactor/edit/remove_dead_imports.ts': { crit: 1, sha: '0ba8c2b86cd38417481a19151d922cf191f834693ce52820a8f80ba1059cf39f' },
  'src/application/refactor/handlers.ts': { crit: 2, sha: 'b0762b76a0447c0a56a2fbf4cd0e17ffd7f5ad00ccbe831b35f45387f4608321' },
  'src/domain/animation.ts': { crit: 2, sha: '080ea012ebc5494da672342f23c6512f4c8531d33b2699e8d6516120c8899f29' },
  'src/domain/b_terms.ts': { crit: 3, sha: '5ddae771a761128bcb7cf887ab3f93e317f4d3805cc7a6c9b0a1360ffff2319a' },
  'src/domain/contract.ts': { crit: 2, sha: 'fd6cfe9fb14fa9df28b0fc318f5a71708ae3304161b943c3717e4e2a42ae3324' },
  'src/domain/design_sheet.ts': { crit: 1, sha: '02d46b85cfc0fb128811cbb8e33a2ba7d7592c39b2d1e614f215f59f2e1ebdf1' },
};

const CRITERIA_OWNED: Record<string, { crit: number; sha: string }> = {
  'src/application/meta/handlers.ts': { crit: 1, sha: '5984ccbdd12056f50fc5ec24ec1aa54e588919bdff4ed93fbb57c198b502f2c2' },
  'src/application/meta/index.ts': { crit: 2, sha: '53d604820d1f2df50eca7457a819646fdb2fd31f284213b30d9607736047ba9c' },
  'src/application/meta/integrity/index_integrity.ts': { crit: 11, sha: '9de42ec2f34f0a6092845cda577c3eb1643083ae5fe44a17d9665a319030bbb0' },
  'src/application/meta/llm/semantic_search.ts': { crit: 1, sha: 'dd57d479fffe4e26168cfe8cb2735b5d4557832428ad255146623140fc5f9d9a' },
  'src/application/observe/index.ts': { crit: 2, sha: 'a0dfa7ed211ec63edc46776bb4ffc12a0426b4ec1b66f1ff3956c3caf6581573' },
  'src/application/observe/reconcile/reason_validator.ts': { crit: 2, sha: 'bb3cf4c4b9993105f9e0d52fdcec3867442f7415deb110b5e6628d296b18a79b' },
  'src/application/observe/runtime/run_tests.ts': { crit: 2, sha: '993e6f65f940cbbf433348524cd622edeb6772326bea9173e07886e57c9b28da' },
  'src/application/observe/runtime/stale_check.ts': { crit: 1, sha: '2c1e21fc0a6f5b410a0ef7c4ee62205ea1e094cabfc8df3e5d7a09aa169bef59' },
  'src/application/read_set.ts': { crit: 3, sha: 'f75e53f253abc1ec5925c4a40dd3e15172aed4dfd3ff4390b77b1e865a3a6660' },
  'src/application/refactor/edit/edit_code.ts': { crit: 10, sha: '06a4c005f14c8a706fe9822cd24001fa90f85f93f829c41903ef5801fa29b65c' },
  'src/application/refactor/find/field_refs.ts': { crit: 2, sha: '6700c2b21147c57dd0a84f162c37a7a73282a0e89c72b7958fb40c743469ae75' },
  'src/application/refactor/pipeline/refactor_plan.ts': { crit: 4, sha: 'acdcb855f6898e0d6a428b11448f919f46895379214d3ff7dac3e0c47e0841a6' },
  'src/application/refactor/rename/rename_file.ts': { crit: 2, sha: '56bbba2eb7a68cea5249af1741d3c93c28d80fb561d36437d6b1d64c0b19acd8' },
  'src/application/refactor/snapshot/file_snapshot.ts': { crit: 1, sha: 'fea1160b3a4b784301fbfc4df7cbffbe6e49555888a2c3071073f0af07231e92' },
  'src/application/stage_registry.ts': { crit: 2, sha: 'f2627cfb014178a3d05a53a6548485e2df11d08bd4fcb92f894bd2a8e3363560' },
  'src/application/tool_registry.ts': { crit: 2, sha: '8d9fa48801cf0a291272a45ecd0f7ed34e978e875cf92125592580cadad2cb97' },
  'src/application/types.ts': { crit: 4, sha: 'f44f41078f4f7fba4405274be06bed4cd3e190e27353ab885f6efd3013b097fb' },
};

/** 甲′ 的"胜方原文逐字未动"：两侧同键不同值时，属主侧（agent-io）那份**一个字节不动**（sha256 钉住） */
const KEEPER_KEPT: Record<string, Record<string, string>> = {
  'src/application/meta/explore/query_feature.ts': {
    summary: '606173e1ff934380e7e276561e833feb0ff7be017b7fde0355bfaaf68d6156db',
    updated_at: 'c2aa4234b9f199a71d54166dbabdfb73b042413eca6354c4d467f145b573ca31',
  },
};

/** 属主侧**空白**的键：照旧**搬**过来（败方独有叙事不蒸发） */
const MOVED_PROSE: Record<string, Record<string, string>> = {
  'src/application/design/board/pool.ts': {
    acceptance: 'e281aa856eb9a5cc25ef3a75b0084fbe4ed871f604c16abe4266efd5ae22d86d',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    provenance: 'b1e1f795d7d7da97c4de69926029fc3a37738bd51688bef81d14899dc7ecf5aa',
    summary: '5a873b008a4640a150e64f3ad184c91867383be12f68bc686772c7a13dbf27f4',
    updated_at: 'be35856d4e7fc65c9fb8f8d05b0a2f8ca3978fff859857dc2d8f5b973bec736b',
  },
  'src/application/meta/explore/query_feature.ts': {
    acceptance: '3a2b87ff522034e2c12ca787908bba20b7249a8de8f71ceec5ca3d4e1c19676c',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    rationale: 'da06590bcc66db8265c5e80286c5791e7e3ac9c3daa0df53ac3cc8b1353233dc',
    thread: 'bb36ccaec71d11614c756ea88170078c8d5cbe12115fa02c3a62acdea57bf167',
  },
  'src/application/observe/runtime/watch_project_tool.ts': {
    agent: '0e0bc6f02e48b91cc24917b787016fb7cfc4d6b54bbae237e993f5f1ae38003a',
    summary: '09b0fd254a01c76ae632d9a022cef76ef2f514eda65cfaac626ba25193c085b9',
    updated_at: 'da7161c65c860d170b91475b6bc96d8d8057cd056ebb8826de90a9657a016ad2',
  },
  'src/application/patrol/task_drift.ts': {
    acceptance: 'abd7baa68558bf9506dcf3d20b0eb65896114b28f13b79e2a3e4b2c4ba034d26',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    summary: 'bffdea551b9d78ae0899fb072aa67eb059d537348568a8adafa751c95b52f4c8',
    updated_at: 'a42795ba5c601d1b811e44e9b9618631aac957a57f859b0c73e035cf16fb4489',
  },
  'src/application/refactor/diff_views/diff_views.ts': {
    acceptance: 'b0c5e2640b31464684f6a6112b68233c63d970c428d40a6fe9ac0c689427fde5',
    agent: '3abe7b9a11a161d1952d2d4a0a43e17e62519a93a782ae51ee4918a074a36a12',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    consequences: '033b448ebd1db2f08c82fd6d402aca3c9e4cc750e3d3f07cd53b658b5858bfee',
    rationale: 'ac70258321879fa8e1f6ea1dd97a660db40d82915e51c2dcae2dae405f36a649',
    status: 'db0fb2bf5ebc424454c3e11b5ee8bfb43af24a52e561aa49e94143831dc6fd93',
    summary: '70cf9584ea46f31896678a281db69b40c9d46f903f36760a8ffdf0bcc945f7ca',
    updated_at: 'f7422ab531887e1b5fb0ab19887314f9e4bcf896dde2f1f834777c0ab5b1d19a',
  },
  'src/application/refactor/edit/remove_dead_imports.ts': {
    acceptance: '540c972e6bf69c88c1653b8fa2423b6d12ad3e2eaf52dededeeb3b8415518009',
    agent: 'a257213a9d34a5faec984c139a6a07f4be953b3dc67fb47084ad6723b0f4714b',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    consequences: 'c7176bf2fb5daaac21bcccb9f0822525d44287b2fb8ee0fffd08facf01fade4c',
    rationale: '5ac7d1f7e84cddf32da71c5c91e6d8893e65735810bb47e3e65bad2af6d5a12d',
    status: 'db0fb2bf5ebc424454c3e11b5ee8bfb43af24a52e561aa49e94143831dc6fd93',
    summary: '2a7077baa14f0e5a1d401e3d0f1f34a7c9a308a153ff825c0bc407a97201a35e',
    updated_at: 'c8d5b7a9f95da3ab2eb9d6f1eafb298ed08d701441f293754821d6e1eb783e8d',
  },
  'src/application/refactor/handlers.ts': {
    acceptance: 'd83b738425439cfe7c6d37182775dc80c5727333b759ee24c4a8b341cc49e563',
    agent: '3abe7b9a11a161d1952d2d4a0a43e17e62519a93a782ae51ee4918a074a36a12',
    rationale: 'abbf250c243e41bc89af53ae891e137d1455ee1e7b0c7bb6fcd28b9e27d5d2b3',
    summary: '9e60895ca8723566f6cad5ac10d16a86ebf0e45a9d226d82e4afa5c35c253da5',
    updated_at: '21056976991b120cb675a7ecd370ee8aeefbafd3c7509490e7cd823d1065858d',
  },
  'src/domain/animation.ts': {
    acceptance: '733c55b698bb8fedd14f2ce78e1fa33d8051629ceeedeb278f0c95590c8bb18e',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    summary: 'e9d11b7b6d91911dad089cf02f8fd56119b53a0bc1acde35c23dbaea986bbb99',
    updated_at: '27d82fb68a569348a9b73199eaa90b90a74af09ba8c57973701afce1f6646e7d',
  },
  'src/domain/b_terms.ts': {
    acceptance: '4a5f53fcccf3674e0931810dee9161611ef9b39a7253579144693b5d7efb16ac',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    summary: 'b272d3e96857eac8e59b6575dfe9517a19633b7d241c6c5d579317885042b5a0',
    updated_at: '2e210bf95bec889c2c2f717212f4910fdbaf49dc498a602776c2ab2709cc722a',
  },
  'src/domain/contract.ts': {
    acceptance: 'cc4369922137dc0be7f0e63970269c1a727e8307e34652aafbea50ef9bce1484',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    summary: 'ede742739c854e68233708e4c7da98a166409236ed2a0e29682309412a4724b3',
    updated_at: '9fc355599ffb0dd7f0cda9e5c7cf7881144f2e2798e8a37579e431597a8faa4a',
  },
  'src/domain/design_sheet.ts': {
    acceptance: '0f119e933170840e5b9831dc4ca4b9b36934519df31cea9e3389410bb65add9c',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    summary: '5d40e8e5b316ddac5cca8b30febf7298f4946bb673f3d42acbded08576142a8f',
    updated_at: '5e83c6a35b18bd1dfaaed0e16a3cf2d52d5b10b3dab48ff89ebdd2a6558fc328',
  },
};

/** 败方原文存档：payload sha256 + 每个值的 sha256（台账读回逐字核对） */
const ARCHIVE: Record<string, { payload: string; values: Record<string, string> }> = {
  'src/application/meta/explore/query_feature.ts': {
    payload: '907a7a7294beac86350bcd2b907436ab13e01248c52560dbe2ed77122c3741a5',
    values: {
      'decision.summary': '36f8520dee2001a21f1db27f5391c7a513477e081ddcadbb6ebb519bb768eafa',
      'decision.updated_at': '084851d6ac2ac98c564625585ed848cf9c29ace5a4046f43b06951b4f34acf5c',
      'node.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
      'semantic.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
    },
  },
};

/** 计划册侧删掉的 28 个节点 id（全是 `nodeIdOf` 单点派生，漂移 0 个） */
const DELETED_IDS: readonly string[] = [
  'file_src_application_design_board_pool_ts',
  'file_src_application_meta_explore_query_feature_ts',
  'file_src_application_meta_handlers_ts',
  'file_src_application_meta_index_ts',
  'file_src_application_meta_integrity_index_integrity_ts',
  'file_src_application_meta_llm_semantic_search_ts',
  'file_src_application_observe_index_ts',
  'file_src_application_observe_reconcile_reason_validator_ts',
  'file_src_application_observe_runtime_run_tests_ts',
  'file_src_application_observe_runtime_stale_check_ts',
  'file_src_application_observe_runtime_watch_project_tool_ts',
  'file_src_application_patrol_task_drift_ts',
  'file_src_application_read_set_ts',
  'file_src_application_refactor_diff_views_diff_views_ts',
  'file_src_application_refactor_edit_edit_code_ts',
  'file_src_application_refactor_edit_remove_dead_imports_ts',
  'file_src_application_refactor_find_field_refs_ts',
  'file_src_application_refactor_handlers_ts',
  'file_src_application_refactor_pipeline_refactor_plan_ts',
  'file_src_application_refactor_rename_rename_file_ts',
  'file_src_application_refactor_snapshot_file_snapshot_ts',
  'file_src_application_stage_registry_ts',
  'file_src_application_tool_registry_ts',
  'file_src_application_types_ts',
  'file_src_domain_animation_ts',
  'file_src_domain_b_terms_ts',
  'file_src_domain_contract_ts',
  'file_src_domain_design_sheet_ts',
];

const RESP_MOVED: Record<string, { chars: number; sha: string }> = {
  'src/application/design/board/pool.ts': { chars: 33, sha: '67e10d232de5a1c77df6eb0300d2944d0082be503256855094b3a16ff3c36af5' },
  'src/application/read_set.ts': { chars: 47, sha: '633257a33628fe4267f25298f69a01c4a70c96e479ff456efdd0a668d05351a3' },
};

const SEM_STATUS: Record<string, string> = {
  'src/application/design/board/pool.ts': 'draft', // HEAD 原文为 draft；api-edges 侧 done 的说法已被当前 HEAD 否定
  'src/application/observe/runtime/watch_project_tool.ts': 'done',
  'src/application/refactor/diff_views/diff_views.ts': 'done',
  'src/application/refactor/edit/remove_dead_imports.ts': 'draft', // HEAD 原文为 draft；api-edges 侧 done 的说法已被当前 HEAD 否定
  'src/application/refactor/handlers.ts': 'done',
  'src/domain/b_terms.ts': 'draft',
  'src/domain/design_sheet.ts': 'draft',
};

const NODE_FIELDS: Record<string, readonly string[]> = {
  'src/application/design/board/pool.ts': ['status', 'overlay'],
  'src/application/meta/explore/query_feature.ts': ['overlay'],
  'src/application/observe/runtime/watch_project_tool.ts': ['status', 'overlay'],
  'src/application/refactor/diff_views/diff_views.ts': ['status', 'overlay'],
  'src/application/refactor/edit/remove_dead_imports.ts': ['status', 'overlay'],
  'src/application/refactor/handlers.ts': ['status', 'overlay'],
  'src/domain/b_terms.ts': ['status'],
  'src/domain/design_sheet.ts': ['status'],
};

const TRANSFERRED: readonly string[] = [
  'src/application/design/board/pool.ts',
  'src/application/meta/explore/query_feature.ts',
  'src/application/observe/runtime/watch_project_tool.ts',
  'src/application/patrol/task_drift.ts',
  'src/application/refactor/diff_views/diff_views.ts',
  'src/application/refactor/edit/remove_dead_imports.ts',
  'src/application/refactor/handlers.ts',
  'src/domain/animation.ts',
  'src/domain/b_terms.ts',
  'src/domain/contract.ts',
  'src/domain/design_sheet.ts',
];

/** 胜方没有 decision ⇒ 败方整份逐字采用（批 6 / 批 10 的形态） */
const ADOPT_WHOLE: Record<string, string> = {
  'src/application/design/board/pool.ts': 'dfa88b2252995676dd0cf83aadd866ff076bbb9dd52c10edb268ba0d91fb3c21',
  'src/application/observe/runtime/watch_project_tool.ts': '3db865f4f20d9e935e3b2fff624ee6c97a8c28865910c403af1568681bd3c4b7',
  'src/application/patrol/task_drift.ts': '33a6cd342a6ab50bf6cf79ae1a9e9e579937aa4f4a52e19a12e9bfb6cde95a11',
  'src/application/refactor/diff_views/diff_views.ts': '0b30d3bdae090f86f8fc1079056753c0595a2965a43911571691115229c6b9d8',
  'src/application/refactor/edit/remove_dead_imports.ts': '42a8373d8afffbd35cb8dbe866875e5c7644f9e982daa5e4814e80f2074373c1',
  'src/application/refactor/handlers.ts': '60798e3bebec0b225dcfca5ecef21c7a1a33a500f1fdcc5d83e1472365096e9f',
  'src/domain/animation.ts': '81ce1a02b9962422c487b60808c43e7f18bd098d1643fd6954123f70371756dd',
  'src/domain/b_terms.ts': 'eb08e73a792b85853bc7e3f08a7b96fbe832fe95073683a4b3e6f022b7d2282e',
  'src/domain/contract.ts': '97531558c965953f6c94ef05557e688ff2327fffbc7e7a3ac6e7718c0fa76fe2',
  'src/domain/design_sheet.ts': '0bab8921dc2a429f26b2cfffa3017005ae79d2915f3eff5f909a612337ec3393',
};

const CARD_LEAVE: readonly string[] = [
  'src/application/design/board/pool.ts',
  'src/application/meta/explore/query_feature.ts',
  'src/application/meta/handlers.ts',
  'src/application/meta/index.ts',
  'src/application/meta/integrity/index_integrity.ts',
  'src/application/meta/llm/semantic_search.ts',
  'src/application/observe/index.ts',
  'src/application/observe/reconcile/reason_validator.ts',
  'src/application/observe/runtime/run_tests.ts',
  'src/application/observe/runtime/stale_check.ts',
  'src/application/observe/runtime/watch_project_tool.ts',
  'src/application/read_set.ts',
  'src/application/refactor/diff_views/diff_views.ts',
  'src/application/refactor/edit/edit_code.ts',
  'src/application/refactor/edit/remove_dead_imports.ts',
  'src/application/refactor/find/field_refs.ts',
  'src/application/refactor/handlers.ts',
  'src/application/refactor/pipeline/refactor_plan.ts',
  'src/application/refactor/rename/rename_file.ts',
  'src/application/refactor/snapshot/file_snapshot.ts',
  'src/application/stage_registry.ts',
  'src/application/tool_registry.ts',
  'src/application/types.ts',
  'src/domain/b_terms.ts',
  'src/domain/design_sheet.ts',
];

/** 活卡（计划册分区）—— 本批**0 次卡操作**，节点删了卡还在（孤儿卡账归批 16） */
const LIVE_CARDS: readonly string[] = [
  'file_src_application_design_board_pool_ts:candidate',
  'file_src_application_refactor_diff_views_diff_views_ts:done',
  'file_src_application_refactor_edit_remove_dead_imports_ts:candidate',
  'file_src_domain_b_terms_ts:candidate',
  'file_src_domain_design_sheet_ts:candidate',
];

/** 界外（本批不动）：C 类余 28 条 + D2 2 条 —— 它们必须**仍是两册持有** */
const OUT_OF_SCOPE: readonly string[] = [
  'src/domain/diff_blocks.ts',
  'src/domain/dsl_removal.ts',
  'src/domain/mindmap.ts',
  'src/domain/narration.ts',
  'src/domain/overlay.ts',
  'src/domain/reasoning.ts',
  'src/domain/scope.ts',
  'src/domain/simulation.ts',
  'src/domain/types.ts',
  'src/infrastructure/analysis/contract_gate/core.ts',
  'src/infrastructure/analysis/deadcode/detect_dead_imports.ts',
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
  'src/infrastructure/parse/mutants.ts',
  'src/presentation/daemon/daemon.ts',
  'src/infrastructure/parse/kernel.ts',
  'src/infrastructure/storage.ts',
];

/** 读数（常量算术：只钉"降幅 = 本批 path 数 / 判据数"这类恒等式） */
// ★ 2026-11-19（集成席 · merge feat/api-edges 后）：854 → 854 —— agent-io 册 +15 条**合法新增**（semantic_facts +6 / verify-changed +3 / kernel 判据并集 +3 / run-tests +2 / 新节点 vue_sfc.ts +1），工具面 7 不变；不是漂，是显式改。
const CRITERIA_TOTAL = 857; // 主控裁定：855 +2（T-#LEDGER-CURRENT-PROJECTION：ledger 当前性 1 条 + patrol 悬空取代 1 条；render/reconcile 为替换）
const CRITERIA_IN_AI = 782; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15（merge 合法新增），差额 66 不变
const CRITERIA_IN_TSP = 66;
const CRITERIA_IN_TOOLFACE = 7;
const CRITERIA_MOVED_COUNT = 32;
const CRITERIA_OWNED_COUNT = 52;
const MULTI_BEFORE_B11 = 58;
const MULTI_AFTER_B11 = 30;
const ID_DRIFT_BEFORE_B11 = 10;
const ID_DRIFT_AFTER_B11 = 10;
const TSP_OWNS_BEFORE_B11 = 24;
const TSP_OWNS_AFTER_B11 = 13;
const DELETED_NODES = 28;
const DELETED_SEMANTICS = 28;
const DELETED_EDGES = 58;
const TSP_NODES_AFTER_B11 = 148;
const TSP_SEMANTIC_AFTER_B11 = 42;
const ARCHIVE_PATHS = 1;
const ARCHIVE_VALUES = 4;
const BEFORE_CRITERIA_AI = 750; // ★ 2026-11-19（集成席 · merge callexists-barrel + lang-adapter-semantic）：按现盘重定基线 // ★ 2026-11-19（集成席 · merge feat/api-edges）：基线 +15（合法新增），本批差额不变
const BEFORE_CRITERIA_TSP = 98;
const BEFORE_NODES_TSP = 176;
const BEFORE_SEM_TSP = 70;
const BEFORE_EDGES_TSP = 284;

/**
 * **D2**（两侧都带判据的真歧义）的 2 条 —— 批 13 的账，本批一条都不碰。
 * ★ 单列出来是因为 11.2b / 11.10 都要把"界外 30 = C 28 + D2 2"拆开数：混着数，
 *   "C 类收尾"与"D2 不动"就分不开了。
 */
/**
 * **path 分母的棘轮下限**（只许不降；与 batch9/10 同一个 idiom —— 批 4 裁定②：钉结构不钉绝对值）。
 * ★ 568 = 555 + EEP triage 的 13 个活源码**合法入仓**（T-#EXCLUDED-EMPTY-PATH 真修复，落库 `c03ac2d8`）。
 *   本批**只删非属主侧节点**（属主册仍持有那些 path）⇒ 并集不变；**低于 floor = 有节点的 path 被收走而没人登记**。
 */
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;
const D2_PATHS: readonly string[] = ['src/infrastructure/parse/kernel.ts', 'src/infrastructure/storage.ts'];

/**
 * **批 12 从本批界外里收走的 17 条**（C·ai 段：判据早在属主册、计划册侧是 fork 残留的空壳）。
 * ★ 单列出来是"跨批棘轮"的形态（与批 9/10 被批 11 收走那一对同款）：批 11 的 11.2b / 11.10
 *   必须能区分"界外仍在"与"已被后续批合法收走"—— 混着算，这份证据就会被下一批的合法下降点红。
 *   逐条 sha 与读回在 `tests/p1_cross_book_batch12.test.ts` 里，不复述。
 */
const COLLECTED_BY_B12: readonly string[] = [
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

/**
 * ★ 批 13（2026-11-18）收走的 C·tsp 11 条（判据 19 条在计划册侧、属主册侧空白 ⇒ 逐字搬进属主册）。
 * 本批（11）自己的账在 `tests/p1_cross_book_batch13.test.ts`；这里只用来把"界外余量"的公式对齐现盘。
 */
const COLLECTED_BY_B13: readonly string[] = [
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
/** 批 13 搬走的判据条数（逐条 sha256 在批 13 的证里） */
const CRITERIA_MOVED_BY_B13 = 19;

/**
 * ★ 批 14（2026-11-18）收走的 **D2 2 条**（两侧都带判据 ⇒ 判据**并集** + 同键不同值存档）。
 * 本批（11）自己的账在 `tests/p1_cross_book_batch14.test.ts`；这里只用来把"界外余量"的公式对齐现盘。
 */
const COLLECTED_BY_B14: readonly string[] = [...D2_PATHS];
/** 批 14 跟走（并进属主册）的判据条数 */
const CRITERIA_MOVED_BY_B14 = 18;

/**
 * ★ 批 15（2026-11-18）收走的**属主错位 12**：10 条 path 的计划册侧节点**整份搬**进属主册
 * （判据 29 条逐字节跟走）+ 2 个幽灵删。计划册判据因此**归零**（`29 → 0`）。
 * 本批（11）自己的账在 `tests/p1_cross_book_batch15.test.ts`；这里只把"计划册降幅"的公式对齐现盘。
 */
const CRITERIA_MOVED_BY_B15 = 29;

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

/**
 * **断言级归属**（`gen-db-check` ⑦「归属重复」的同一条口径，纯核重算）：一条判据断言的是
 * `e.path`（缺省回落节点自身的 `path`）—— 与"节点挂在哪一册"是两个问题。
 * 同一断言目标被 **≥2 册** 断言 ⇒ 冲突（批 9 §3.2-C 的"断言者与被断言者必须同批"说的就是这件事）。
 * @param extra 追加到副本里的节点（反证用：把"只搬了被断言者"那个世界造出来）
 */
function assertionDupes(
  sheets: Array<BookSheetLike & { feature: string }>,
  targets: readonly string[],
  extra?: (s: BookSheetLike & { feature: string }) => Array<Record<string, unknown>>,
): string[] {
  const holders = new Map<string, Set<string>>();
  for (const s of sheets) {
    const nodes = [...((s.geometry?.nodes ?? []) as Array<Record<string, unknown>>), ...(extra ? extra(s) : [])];
    for (const n of nodes) {
      const rel = norm(n.path);
      for (const e of ((n.decision as { expectations?: Array<{ path?: string }> } | undefined)?.expectations ?? [])) {
        const asserted = norm(e.path) || rel;
        if (!asserted) continue;
        const set = holders.get(asserted) ?? new Set<string>();
        set.add(s.feature);
        holders.set(asserted, set);
      }
    }
  }
  return targets.filter((t) => (holders.get(norm(t))?.size ?? 0) > 1);
}

// ════════════════════════════════════════════════════════════════════
// 11.1 / 11.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('11.1 真仓：28 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数逐条对表', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of BATCH) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须恰由 ${AI} 持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
    const want = CRITERIA_MOVED[p]?.crit ?? CRITERIA_OWNED[p]?.crit;
    assert.equal(typeof want, 'number', `\`${p}\` 必须在乎两张判据表之一里（漏一条 = 有一条没人核）`);
    assert.equal(hs[0]?.expectations, want, `\`${p}\` 的判据条数必须是 ${String(want)}（实测 ${hs[0]?.expectations}）`);
  }
});

test('11.1b 计划册里这 28 个 path 的节点 / 语义 / 边都不在了；28 个被删节点 id 在非属主册里不再出现', () => {
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
// 11.2 / 11.2b 清单形状 + "名单是死的、前提是活的"
// ════════════════════════════════════════════════════════════════════
test('11.2 清单形状：28 条 · 码位序 · 段位 24/4 · 两张判据表与清单逐条同集 · 界外 30 条', () => {
  assert.equal(BATCH.length, 28, `本批 28 条（实测 ${BATCH.length}）`);
  assert.deepEqual([...BATCH].sort(), BATCH, '本批必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  const seg = BATCH.filter((p) => p.startsWith('src/application/')).length;
  assert.equal(seg, 24, `段位：src/application/** 24 条（实测 ${seg}）`);
  assert.equal(BATCH.length - seg, 4, `段位：src/domain/** 4 条（实测 ${BATCH.length - seg}）`);

  const tablePaths = [...Object.keys(CRITERIA_MOVED), ...Object.keys(CRITERIA_OWNED)].sort();
  assert.deepEqual(tablePaths, [...BATCH].sort(), '两张判据表必须与清单**逐条同集**');
  assert.equal(Object.keys(CRITERIA_MOVED).length, 11, '搬判据的 11 条');
  assert.equal(Object.keys(CRITERIA_OWNED).length, 17, '判据本来就在属主册的 17 条');
  assert.deepEqual([...Object.keys(ARCHIVE)].sort(), [...Object.keys(ARCHIVE)].filter((p) => BATCH.includes(p)).sort(), '存档表只能覆盖本批 path');
  assert.equal(Object.keys(ARCHIVE).length, ARCHIVE_PATHS, `有败方原文被顶掉的 path 必须是 ${ARCHIVE_PATHS} 条`);
  assert.equal(Object.values(ARCHIVE).reduce((s, x) => s + Object.keys(x.values).length, 0), ARCHIVE_VALUES, `存档值总数必须是 ${ARCHIVE_VALUES}`);
  assert.equal(CARD_LEAVE.length, 25, '带卡留账 25 条（其余 3 条本来就没卡）');
  assert.equal(BATCH.filter((p) => !CARD_LEAVE.includes(p)).length, 3, '没卡的 3 条必须逐条不差（两边都有牙：多算一条 / 少算一条都红）');
  assert.equal(LIVE_CARDS.length, 5, '计划册分区里的活卡 5 张（本批 0 次卡操作）');
  assert.deepEqual([...TRANSFERRED].sort(), [...Object.keys(CRITERIA_MOVED)].sort(), '改判的 11 条必须 = 搬判据的 11 条（本批没有 A 类空壳换手）');
  assert.equal(DELETED_IDS.length, DELETED_NODES, `删的节点数 ${DELETED_NODES} 必须等于 id 清单长度`);
  assert.equal(Object.keys(MOVED_PROSE).length, 11, '搬散文键的 11 条 path');
  assert.equal(Object.keys(ADOPT_WHOLE).length, 10, '整份 decision 采用 10 条（属主侧原先没有 decision）');
  assert.equal(ARCHIVE_PATHS, 1, '本批只有 1 条 path 的败方原文被顶掉（其余都是"搬"，不是"丢"）');
  // ★ 界外 30 条 = 28 条 C + 2 条 D2；一条都不许混进本批
  assert.equal(OUT_OF_SCOPE.length, 30, `界外 30 条（实测 ${OUT_OF_SCOPE.length}）`);
  for (const p of OUT_OF_SCOPE) assert.ok(!BATCH.includes(p), `界外的 \`${p}\` 不许在本批里`);
  // ★ 断言级那一对必须都在本批（批 9 §3.2-C）
  assert.equal(PAIR.length, 2, '断言级那一对是 2 条');
  for (const p of PAIR) assert.ok(BATCH.includes(p), `\`${p}\` 必须在本批里（断言者与被断言者同批）`);
});

test('11.2b 名单是死的、前提是活的：名单必须逐条 = 现盘 56 条 C 类码位序的前 28 条；收完剩 30（C 28 + D2 2）', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  // ★ 批 12 棘轮（2026-11-18）：批 11 收口 30 只作**上界**（批 12 已收走其中 17 条 C·ai ⇒ 现盘 13）。
  //   钉"恰好 30"会把后续批的合法下降判成红 —— 那是把账本倒着锁。
  assert.ok(multi.length <= MULTI_AFTER_B11, `多册持有只许不增（批 11 收口 ${MULTI_AFTER_B11}；实测 ${multi.length}）`);
  // ★ 批 14 棘轮（2026-11-18）：D2 2 条已由批 14 收口（判据并集 18 条 + 同键不同值 10 值存档）⇒ 现盘不再两册持有。
  //   两边仍留牙：界外被"顺手收了" ⇒ 下面 `!multi.includes` 与 11.10 的单册断言会红；"收"退化成"删" ⇒ 批 14 的证红。
  for (const p of D2_PATHS) assert.ok(!multi.includes(p), `D2 的 \`${p}\` 已由批 14 收口 ⇒ 不该仍两册持有（实测在集合里）`);
  // ★ 批 13 棘轮（2026-11-18）：C·tsp 11 条也已由批 13 收走（判据 19 条搬进属主册）⇒ 现盘 C 余量 = 28 − 17 − 11 = 0。
  const cLeft = multi.filter((p) => !D2_PATHS.includes(p));
  assert.equal(cLeft.length, 28 - COLLECTED_BY_B12.length - COLLECTED_BY_B13.length, `收完之后仍两册持有的 C 类必须恰好 ${28 - COLLECTED_BY_B12.length - COLLECTED_BY_B13.length} 条（实测 ${cLeft.length}）`);
  assert.deepEqual(
    [...cLeft].sort(),
    OUT_OF_SCOPE.filter((p) => !D2_PATHS.includes(p) && !COLLECTED_BY_B12.includes(p) && !COLLECTED_BY_B13.includes(p)).sort(),
    '剩下的 C 必须逐条等于"界外 28 条 − 批 12 收走的 17 条 − 批 13 收走的 11 条"（名单没被挑过）',
  );
  for (const p of COLLECTED_BY_B12) assert.ok(!multi.includes(p), `批 12 收走的 \`${p}\` 必须已不在多册持有集合里（批 12 的证在 12.10）`);
  for (const p of COLLECTED_BY_B13) assert.ok(!multi.includes(p), `批 13 收走的 \`${p}\` 必须已不在多册持有集合里（批 13 的证在 13.10）`);
  for (const p of COLLECTED_BY_B14) assert.ok(!multi.includes(p), `批 14 收走的 \`${p}\` 必须已不在多册持有集合里（批 14 的证在 14.2b）`);
  for (const p of BATCH) assert.ok(!multi.includes(p), `本批的 \`${p}\` 必须已不在多册持有集合里`);
  // 名单 = 本批 28 + 界外 C 28：两条拼起来必须等于"批 10 收口时的 56 条 C 全集"
  const union = [...BATCH, ...OUT_OF_SCOPE.filter((p) => !D2_PATHS.includes(p))].sort();
  assert.equal(union.length, 56, '本批 28 + 界外 C 28 = 批 10 收口时的 56 条 C');
  assert.equal(new Set(union).size, 56, '并集里不许有重复（一条不多一条不少）');
  // 批 12 收走的 17 条必须**全在**界外 C 里（不许收界外之外的东西）
  for (const p of COLLECTED_BY_B12) assert.ok(OUT_OF_SCOPE.includes(p), `批 12 收走的 \`${p}\` 必须本来就在批 11 的界外清单里`);
});

// ════════════════════════════════════════════════════════════════════
// 11.3 判据逐字节 + 守恒 / 11.3b 有牙
// ════════════════════════════════════════════════════════════════════
test(`11.3 判据**逐字节**：搬的 32 条 sha256 相同；本来就在属主册的 52 条一位没动；总数守恒 ${CRITERIA_TOTAL}`, () => {
  const aiNodes = rawNodes(AI);
  for (const [p, want] of Object.entries(CRITERIA_MOVED)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.crit, `\`${p}\` 的判据条数必须是 ${want.crit}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.sha, `\`${p}\` 的判据 JSON 被改过 —— 搬运是**逐字节**的`);
  }
  for (const [p, want] of Object.entries(CRITERIA_OWNED)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.crit, `\`${p}\` 的判据条数必须是 ${want.crit}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.sha, `\`${p}\` 的判据本来就在属主册，本批**一位不该动**（sha 变了）`);
  }
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaOf(s)}`).join(' · ');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 ${CRITERIA_TOTAL}（实测 ${per}）`);
  // ★ 批 13 棘轮（2026-11-18）：批 12 收口时 agent-io = 766、计划册 = 66。批 13 又把计划册侧的 19 条
  //   判据**逐字搬进**属主册 ⇒ 现盘是 785 / 47。钉"= 766"会把后续批的合法搬运判成红（账本倒着锁），
  //   所以这里改成**方向 + 差集**：属主册只许不减、计划册只许不增、两边的 Δ 必须等于后续批搬走的条数。
  assert.ok(criteriaOf(bookOf(AI)) >= CRITERIA_IN_AI, `agent-io 册判据只许不减（批 11 收口 ${CRITERIA_IN_AI}；实测 ${criteriaOf(bookOf(AI))}）`);
  assert.ok(criteriaOf(bookOf(TSP)) <= CRITERIA_IN_TSP, `计划册判据只许不增（批 11 收口 ${CRITERIA_IN_TSP}；实测 ${criteriaOf(bookOf(TSP))}）`);
  // ★ 批 14 棘轮（2026-11-18）：Δ 现在包含**两批**的搬运量（批 13 的 19 + 批 14 的 18 = 37）。
  //   钉死 19 会把批 14 的合法并集判红；钉 37 属于"常量算术"（后续批只要再搬，这条就得跟着改，是有意的）。
  assert.equal(criteriaOf(bookOf(AI)) - CRITERIA_IN_AI, CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15 + 2, `属主册涨幅 = 批 13 + 14 + 15 搬进来的 ${CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条 + current-projection 净增 2（实测 ${criteriaOf(bookOf(AI)) - CRITERIA_IN_AI}）`);
  assert.equal(CRITERIA_IN_TSP - criteriaOf(bookOf(TSP)), CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15, `计划册降幅必须恰等于批 13 + 14 + 15 搬走的 ${CRITERIA_MOVED_BY_B13 + CRITERIA_MOVED_BY_B14 + CRITERIA_MOVED_BY_B15} 条（实测 ${CRITERIA_IN_TSP - criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf('agent-io-toolface')), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  const movedSum = Object.values(CRITERIA_MOVED).reduce((s, x) => s + x.crit, 0);
  assert.equal(movedSum, CRITERIA_MOVED_COUNT, `搬的判据条数必须是 ${CRITERIA_MOVED_COUNT}（实测 ${movedSum}）`);
  const ownedSum = Object.values(CRITERIA_OWNED).reduce((s, x) => s + x.crit, 0);
  assert.equal(ownedSum, CRITERIA_OWNED_COUNT, `本来就在属主册的判据条数必须是 ${CRITERIA_OWNED_COUNT}（实测 ${ownedSum}）`);
  assert.equal(criteriaOf(bookOf(AI)) - CRITERIA_MOVED_BY_B13 - CRITERIA_MOVED_BY_B14 - CRITERIA_MOVED_BY_B15 - 2, BEFORE_CRITERIA_AI + movedSum, '属主册判据 = 批 11 的 734 + 搬来的 32 + 批 13/14/15 搬入 + current-projection 净增 2（算术闭合）');
  assert.equal(BEFORE_CRITERIA_AI + movedSum + BEFORE_CRITERIA_TSP - movedSum + CRITERIA_IN_TOOLFACE + 2, CRITERIA_TOTAL, '守恒是**算术**：855 + current-projection 净增 2 = 857');
});

test(`11.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < ${CRITERIA_TOTAL}，差额恰是该节点的判据数`, () => {
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
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 11.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 11.4 甲′ 双向（胜方不动 / 败方独有键搬过来 / 整份采用）/ 11.4b 有牙
// ════════════════════════════════════════════════════════════════════
test('11.4 甲′ 双向：胜方原文 sha256 一个字节没动 · 属主侧空白的键逐字节搬过来 · 整份 decision 采用 10 条', () => {
  const aiNodes = rawNodes(AI);
  const aiSems = rawSems(AI);
  // ① 胜方原文未动（被"属主侧为准"钉住的键）
  for (const [p, keys] of Object.entries(KEEPER_KEPT)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    for (const [k, want] of Object.entries(keys)) {
      assert.equal(shaOfJson(n.decision?.[k]), want, `\`${p}\` 的 \`${k}\` 被动了 —— 甲′ 是"属主侧为准"，不是"顺手改成属主侧的模样"`);
    }
  }
  // ② 属主侧空白/缺失的键：**搬**过来（逐字节）
  for (const [p, keys] of Object.entries(MOVED_PROSE)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    for (const [k, want] of Object.entries(keys)) {
      assert.equal(shaOfJson(n.decision?.[k]), want, `\`${p}\` 的 \`${k}\` 必须**逐字节**搬过来（败方独有叙事不许蒸发）`);
    }
  }
  // ③ 整份 decision 采用（属主侧原先没有 decision ⇒ 5 键以上整份逐字，不是"挑几个搬"）
  for (const [p, want] of Object.entries(ADOPT_WHOLE)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    assert.equal(shaOfJson(n.decision), want, `\`${p}\` 的 decision 整份采用必须逐字节相同（sha 变了 = 抄歪了）`);
  }
  // ④ 职责文本 / semantic.status / 节点字段
  for (const [p, want] of Object.entries(RESP_MOVED)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.ok(s, `\`${p}\` 必须在属主册有语义条目`);
    assert.equal(String(s.responsibility ?? '').trim().length, want.chars, `\`${p}\` 的职责文本字数必须是 ${want.chars}`);
    assert.equal(shaOfText(String(s.responsibility ?? '')), want.sha, `\`${p}\` 的职责文本不是逐字的（sha 变了）`);
  }
  for (const [p, want] of Object.entries(SEM_STATUS)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.ok(s, `\`${p}\` 必须在属主册有语义条目`);
    assert.equal(s.status, want, `\`${p}\` 的 semantic.status 必须是 ${want}`);
  }
  for (const [p, keys] of Object.entries(NODE_FIELDS)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    for (const k of keys) assert.ok(n[k] !== undefined, `\`${p}\` 的节点字段 \`${k}\` 必须搬过来（实测 ${n[k] === undefined ? '缺失' : '在'}）`);
  }
});

test('11.4b 上一条**有牙**：改一个字节 / 清空一处 ⇒ 指纹立刻变（纯核，真册一个字节不动）', () => {
  const aiNodes = rawNodes(AI);
  const [p0, keys0] = Object.entries(KEEPER_KEPT)[0] ?? [];
  assert.ok(p0 && keys0, '必须有"胜方原文被钉住"的样本（否则这条反检查没对象）');
  const n0 = aiNodes.find((x) => norm(x.path) === p0);
  const [k0, want0] = Object.entries(keys0!)[0]!;
  const cur = n0?.decision?.[k0];
  assert.equal(shaOfJson(cur), want0, '前提：真册上那个值是逐字的');
  const tweaked = typeof cur === 'string' ? `${cur} ` : { ...(cur as Record<string, unknown>), probe: 1 };
  assert.notEqual(shaOfJson(tweaked), want0, '改一个字节 / 加一个空格，指纹必须变 —— 否则 sha 判据是摆设');
  const [p1, keys1] = Object.entries(MOVED_PROSE)[0] ?? [];
  assert.ok(p1 && keys1, '必须有"搬过来的键"的样本');
  const [k1, want1] = Object.entries(keys1!)[0]!;
  assert.notEqual(shaOfJson('（清空）'), want1, '把搬来的键清空，指纹必须变');
});

// ════════════════════════════════════════════════════════════════════
// 11.5 域表收窄
// ════════════════════════════════════════════════════════════════════
test('11.5 域表**收窄**：28 条属主 = agent-io；计划册 owns 24 → 13；前缀仍在（不是"掉成无人认领"）', () => {
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
  for (const p of TRANSFERRED) {
    assert.ok(BATCH.includes(p), `改判的 \`${p}\` 必须在本批清单里`);
    assert.ok(!tspOwns.includes(p), `计划册 \`owns[]\` 里不该再有精确条目 \`${p}\`（属主已改判）`);
  }
  assert.equal(TSP_OWNS_BEFORE_B11 - TSP_OWNS_AFTER_B11, TRANSFERRED.length, '降幅必须恰等于改判条数（常量算术）');
  // ★ 与批 10 同款棘轮：只许不增（后续批会继续摘），但**不许被清空**
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER_B11, `计划册 owns 只许不增（批 11 收口 ${TSP_OWNS_AFTER_B11}；实测 ${tspOwns.length}）`);
  // ★ 批 14 棘轮（2026-11-18）：计划册 owns 已被清空（2 → 0）⇒ "不许被清空"这条历史约束退役；
  //   清空之后要断的是**清空有账**（批 14 的门档 why 点名它的来路），而不是"永远 > 0"。
  if (tspOwns.length === 0) {
    const baseline14 = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
    assert.ok(String(baseline14.multi_owned.why ?? '').includes('批 14（D2 终局'), '计划册 owns 清空必须由批 14 的账背书（门档 why 点名）');
  } else {
    assert.ok(tspOwns.length > 0, `计划册 owns 不许被清空（实测 ${tspOwns.length}）`);
  }
  for (const pre of ['src/', 'scripts/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
});

// ════════════════════════════════════════════════════════════════════
// 11.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('11.6 ② 档：这 28 条 klass = owned；塞回任一条 ⇒ 立刻 multi_owned（鉴别力）；path 分母**只许不降**（floor 568）', () => {
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
  const p0 = BATCH.find((p) => p.startsWith('src/domain/')) as string;
  const world2 = withExtraNodes(sheets, TSP, [{ id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }]);
  const two = crossBookOwnership(world2, read);
  assert.equal(two.rows.find((r) => r.path === p0)?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
});

// ════════════════════════════════════════════════════════════════════
// 11.7 写端
// ════════════════════════════════════════════════════════════════════
test('11.7 写端：批 11 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 11 的删除是可逆的）',
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
// 11.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('11.8 门档：多册持有 ≤ 30（58 − 28）· id 漂移 ≤ 10 · 属主错位 ≤ 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(now.multi_owned.length <= MULTI_AFTER_B11, `多册持有只许不增（批 11 收口 ${MULTI_AFTER_B11}；实测 ${now.multi_owned.length}）`);
  assert.equal(MULTI_BEFORE_B11 - MULTI_AFTER_B11, BATCH.length, '批 11 的降幅必须逐字等于本批 path 数');
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER_B11, `id 漂移只许不增（批 11 收口 ${ID_DRIFT_AFTER_B11}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE_B11, ID_DRIFT_AFTER_B11, '本批删的全是单点派生 id ⇒ 漂移一条不该变');
  for (const p of BATCH) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（本批改判了域表，所以它该是 owned）`);
  }
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 14 处理）：实测 ${now.owner_mismatch.length}`);

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
// 11.9 败方原文存档（台账读回 + 跨批不进水）/ 11.9b 机制可移植
// ════════════════════════════════════════════════════════════════════
test('11.9 **败方原文存档**：本批 1 条 path / 4 个值的 payload 逐字可读回；批 10 的 35 条跨批未进水', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆 / 首次检出）⇒ 台账存档不在版本库里，读不回；机制由 11.9b 钉住');
    return;
  }
  const row = getRow(REPO, LEDGER_REF);
  if (!row) {
    t.skip(`台账里没有 \`${LEDGER_REF}\` 这一行（本机台账未导入）⇒ 读不回`);
    return;
  }
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  assert.ok(allArchive.length >= ARCHIVE_PATHS + 35, `迁移存档事件总数必须 ≥ ${ARCHIVE_PATHS + 35}（本批 ${ARCHIVE_PATHS} + 批 10 的 35；实测 ${allArchive.length}）`);
  const mine = new Map<string, { body: string; parsed: ReturnType<typeof parseArchive> }>();
  const batches = new Map<string, number>();
  for (const e of allArchive) {
    const parsed = parseArchive(String(e.body));
    assert.ok(parsed, `存档事件 id=${e.id} 的 body 解析不了（格式契约被改了）`);
    const batch = String((parsed.payload as { batch?: string }).batch ?? '(缺)');
    batches.set(batch, (batches.get(batch) ?? 0) + 1);
    assert.equal(String((parsed.payload as { ref?: string }).ref ?? ''), LEDGER_REF, `存档事件 id=${e.id} 必须挂在 ${LEDGER_REF} 上`);
    if (batch !== 'A8A9-batch11') continue;
    const p = String((parsed.payload as { path?: string }).path ?? '');
    assert.ok(!mine.has(p), `\`${p}\` 在台账里出现了两次存档（重复挂账）`);
    mine.set(p, { body: String(e.body), parsed });
  }
  assert.equal(mine.size, ARCHIVE_PATHS, `本批存档必须恰好 ${ARCHIVE_PATHS} 条 path（实测 ${mine.size}）`);
  assert.equal(batches.get('A8A9-batch10'), 35, `批 10 的 35 条存档必须原样还在（append-only；实测 ${String(batches.get('A8A9-batch10'))}）`);
  assert.equal(batches.get('A8A9-batch11'), ARCHIVE_PATHS, `本批的存档条数必须 = ${ARCHIVE_PATHS}`);
  for (const [p, want] of Object.entries(ARCHIVE)) {
    const hit = mine.get(p);
    assert.ok(hit, `\`${p}\` 的败方原文必须在台账里可查（视图里收敛了，真相里不许丢）`);
    assert.equal(hit.parsed!.payloadSha, want.payload, `\`${p}\` 的 payload sha256 不符`);
    const dropped = (hit.parsed!.payload as { dropped?: Record<string, unknown> }).dropped ?? {};
    assert.deepEqual(Object.keys(dropped).sort(), Object.keys(want.values).sort(), `\`${p}\` 的存档键集不符`);
    for (const [k, vsha] of Object.entries(want.values)) {
      assert.equal(shaOfJson(dropped[k]), vsha, `\`${p}\` 的存档值 \`${k}\` 不是逐字的（sha 变了）`);
      const v = dropped[k];
      const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      assert.ok(hit.body.includes(text), `\`${p}\` 的人读段里找不到 \`${k}\` 的原文 —— "逐字存档"退化成"只存指纹"`);
    }
    const payload = hit.parsed!.payload as { loser?: { book?: string }; keeper?: { book?: string } };
    assert.equal(payload.loser?.book, TSP, '败方必须是计划册');
    assert.equal(payload.keeper?.book, AI, '胜方必须是属主册');
  }
  // 反向：被顶掉的键在属主册上**不许**仍等于败方原文（否则"属主侧为准"根本没落实、存档是空转）
  const aiNodes = rawNodes(AI);
  for (const [p, want] of Object.entries(ARCHIVE)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    for (const k of Object.keys(want.values)) {
      if (!k.startsWith('decision.')) continue;
      const key = k.slice(9);
      const v = n?.decision?.[key];
      if (v === undefined) continue;
      assert.notEqual(shaOfJson(v), want.values[k], `\`${p}\` 的 \`${key}\` 若仍等于败方原文，说明"属主侧为准"没落实`);
    }
  }
});

test('11.9b 上一条**可移植**：夹具里 hangRow + annotateRow 往返，同一份 body 格式逐字读回（不依赖本机 tasks.db）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
    hangRow(proj, { refId: 'T-#FIXTURE-B11', section: 'fixture', title: '批 11 存档往返夹具', by: 'test' });
    // ★ body 自己拼（与执行器同格式）：原文含换行 / 引号 / 中文，专门试"逐字"
    const payload = {
      batch: 'A8A9-batch11',
      ref: 'T-#FIXTURE-B11',
      path: 'src/domain/fixture11.ts',
      loser: { book: 'task-system-plan', node_id: 'file_src_domain_fixture11_ts' },
      keeper: { book: 'agent-io', node_id: 'file_src_domain_fixture11_ts' },
      dropped: { 'decision.summary': '第一行\n第二行 "带引号" 与\\反斜杠', 'decision.tags': ['a', 'b'], 'node.overlay': { x: 1, y: 2 } },
      moved_keys: ['acceptance'],
      moved_responsibility: false,
      moved_semantic_status: null,
      moved_node_fields: [],
      moved_expectations: 0,
      identical_keys: [],
    };
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, 'utf8').toString('base64');
    const body = [
      '迁移存档：败方原文',
      '批 11（甲′：散文口径 = 属主侧为准 + 败方原文逐字存档）· T-#FIXTURE-B11 · A8A9-batch11',
      'path: src/domain/fixture11.ts',
      '',
      '── 败方原文（逐字）──',
      '[decision.summary]',
      String(payload.dropped['decision.summary']),
      '',
      PAYLOAD_END,
      b64,
      `sha256(payload)= ${createHash('sha256').update(json, 'utf8').digest('hex')}`,
    ].join('\n');
    annotateRow(proj, 'T-#FIXTURE-B11', body, 'test');
    const row = getRow(proj, 'T-#FIXTURE-B11');
    assert.ok(row, '夹具台账行必须读得回来');
    const ev = row.events.filter((e) => e.kind === 'annotate');
    assert.equal(ev.length, 1, '必须恰好一条 annotate 事件');
    assert.equal(String(ev[0]!.body), body, 'annotate 事件 body 必须**逐字**存下（首尾空白也不许剪）');
    const parsed = parseArchive(String(ev[0]!.body));
    assert.ok(parsed, '同一份格式必须解析得回来');
    assert.equal(parsed!.payloadSha, createHash('sha256').update(json, 'utf8').digest('hex'), 'payload sha 必须一致');
    assert.deepEqual(parsed!.payload.dropped, payload.dropped, 'payload 深度相等（含换行 / 引号 / 数组 / 对象）');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 11.10 界外账 / 11.10b 断言级那一对
// ════════════════════════════════════════════════════════════════════
test('11.10 **界外账**：C 类余 28 条 + D2 2 条**仍是两册持有**（没有被"顺手收了"）', () => {
  const read = crossBookReadingOf(REPO);
  const multi = new Set(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path));
  assert.equal(OUT_OF_SCOPE.length, 30, '界外 30 条（C 类余 28 + D2 2）');
  for (const p of OUT_OF_SCOPE) {
    assert.ok(!BATCH.includes(p), `\`${p}\` 不该在本批清单里`);
    if (COLLECTED_BY_B12.includes(p)) {
      // ★ 批 12（C·ai 17 条）收走了它 ⇒ 本条改判：**不许**再是两册持有（批 12 自己的证在 12.10）
      assert.ok(!multi.has(p), `\`${p}\` 已由批 12 收走（C·ai 段）⇒ 不该仍两册持有`);
      continue;
    }
    if (COLLECTED_BY_B13.includes(p)) {
      // ★ 批 13（C·tsp 11 条）收走了它 ⇒ 同上（批 13 自己的证在 13.10）
      assert.ok(!multi.has(p), `\`${p}\` 已由批 13 收走（C·tsp 段）⇒ 不该仍两册持有`);
      continue;
    }
    if (COLLECTED_BY_B14.includes(p)) {
      // ★ 批 14（D2 2 条）收走了它 ⇒ 同上（批 14 自己的证在 14.2b）
      assert.ok(!multi.has(p), `\`${p}\` 已由批 14 收走（D2 段）⇒ 不该仍两册持有`);
      continue;
    }
    assert.ok(multi.has(p), `\`${p}\` 必须仍是**两册持有**（界外 ≠ 已处理）`);
  }
  assert.equal(OUT_OF_SCOPE.filter((p) => !COLLECTED_BY_B12.includes(p) && !COLLECTED_BY_B13.includes(p)).length, 2, '批 11 界外 30 − 批 12 收走 17 − 批 13 收走 11 = 2（恰 D2）');
  // 被收的 28 条：必须单册 = 属主册（"收" ≠ "删"）
  const sheets = repoSheets();
  const holdings = bookHoldings(sheets);
  for (const p of BATCH) {
    const feats = [...new Set((holdings.get(p) ?? []).map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须已被收成单册 = ${AI}（实测 ${feats.join('/') || '无人持有'}）`);
  }
});

test('11.10b **断言级那一对**：⑦ 档现算 0 处；反证（只收 query_feature.ts）= 1 处 ⇒ "必须同批"不是空话', () => {
  const sheets = repoSheets();
  // ① 现状：这三个 path 的判据都不再被两册同时断言
  const now = assertionDupes(sheets, [...PAIR, ...D2_PATHS]);
  assert.deepEqual(now, [], `⑦ 档（断言级归属）现算必须为空（实测冲突 ${now.join(', ')}）`);
  // ② 前提：断言者 pool.ts 的计划册侧节点**已被本批删掉**（否则"同批收"这件事没发生）
  const qf = PAIR[1]!;
  assert.equal(rawNodes(TSP).filter((x) => norm(x.path) === PAIR[0]!).length, 0, 'pool.ts 的计划册侧节点必须已删（断言者随本批一起走）');
  // ③ 反证：把"只搬了被断言者"那个世界造出来（query_feature 的判据在 agent-io，pool.ts 的 call-exists 还在计划册）
  //    ⇒ query_feature.ts 立刻被两册断言。没有这一步，"本批 0 处冲突"与"这条判据在本树上空转"长得一模一样。
  const synth = {
    id: 'probe_pool_ts',
    path: PAIR[0]!,
    decision: { expectations: [{ kind: 'call-exists', path: qf, why: '反证：只搬被断言者的世界' }] },
  };
  // ★ 历史 fixture 含计划册：向既有 TSP 只补回断言者，保留其他节点。
  //   只有"被断言者搬了、断言者没搬"时才该看见冲突；追加同名第二册会丢掉原册，不是同一反例。
  const proof = assertionDupes(withExtraNodes(sheets, TSP, [synth]), [qf]);
  assert.deepEqual(proof, [qf], `反证必须打得出冲突（只收 \`${qf}\` 时它会被 ${AI} 与 ${TSP} 同时断言）—— 否则这条判据在本树上是空转`);
  // ④ 反证后把断言者也收走（= 现状：pool.ts 的节点已删）⇒ 冲突必须消失
  const fixed = assertionDupes(sheets, [qf]);
  assert.deepEqual(fixed, [], '"同批收走断言者"之后冲突必须消失 —— 这一步让 ③ 的冲突归因到"两条必须同批"而不是别的东西');
});

// ════════════════════════════════════════════════════════════════════
// 11.11 卡账
// ════════════════════════════════════════════════════════════════════
test('11.11 **卡账**：25 条带卡留账；计划册分区 5 张活卡**批 16 已逐张收敛**（每张有归宿，没有一张被静默删）', () => {
  assert.equal(CARD_LEAVE.length, 25, '带卡留账必须覆盖 25 条（一条 path 的一张卡都没被"顺手处理"）');
  for (const p of CARD_LEAVE) assert.ok(BATCH.includes(p), `带卡留账的 \`${p}\` 必须在本批清单里`);
  // 册上投影：删掉的计划册节点不许还在册里
  const tspIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  for (const id of DELETED_IDS) assert.ok(!tspIds.has(id), `册上节点 \`${id}\` 必须已删`);
  // 门档 why 必须逐条点着名字（否则下次没人知道它的卡为什么没跟着走）
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  for (const p of CARD_LEAVE) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着带卡留账 \`${p}\``);
  }
  // 活卡：本机台账里有卡才核（干净克隆没有 tasks.db）
  const cards = listLiveCards(REPO, TSP);
  const anyCards = cards.length > 0 || listLiveCards(REPO, 'agent-io').length > 0;
  if (!anyCards) return; // 干净克隆：卡的家不在版本库里
  // ★★★ 2026-11-18（批 16 棘轮）：这 5 张当初是"节点已删、卡在计划册分区"的孤儿卡。批 16 逐张裁定后
  //   判**归宿**（活卡原状 / 已入史 / 都没有 = 丢卡 ⇒ 红），不再判"仍在计划册分区"。
  const lost: string[] = [];
  for (const spec of LIVE_CARDS) {
    const [id, state] = [spec.slice(0, spec.lastIndexOf(':')), spec.slice(spec.lastIndexOf(':') + 1)];
    const home = cardHomeLite(id);
    if (!home) {
      lost.push(id);
      continue;
    }
    if (home.kind === 'live') assert.equal(home.state, state, `活卡 \`${id}\` 的 state 被改了（${state} → ${home.state}）`);
    else assert.ok(['done', 'void'].includes(home.state), `已入史的 \`${id}\` 只能是已了结态（实测 ${home.state}）`);
  }
  assert.deepEqual(lost, [], `这 5 张一张都不许丢：${lost.join(',')}`);
  const orphan = LIVE_CARDS.filter((spec) => !tspIds.has(spec.slice(0, spec.lastIndexOf(':'))));
  assert.equal(orphan.length, LIVE_CARDS.length, '5 张活卡的节点**全部**已删 ⇒ 它们当初都是孤儿卡（门档 why 里写明了归批 16）');
});

// ════════════════════════════════════════════════════════════════════
// 11.12 计划册册容
// ════════════════════════════════════════════════════════════════════
test('11.12 计划册册容：节点 176 → 148 · 语义 70 → 42 · 边 284 → 226（删的数目对得上）', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER_B11, '计划册节点数：176 − 28 = 148');
  assert.equal(BEFORE_SEM_TSP - DELETED_SEMANTICS, TSP_SEMANTIC_AFTER_B11, '计划册语义：70 − 28 = 42');
  assert.equal(BEFORE_EDGES_TSP - DELETED_EDGES, 226, '计划册边：284 − 58 = 226');
  // ★ 棘轮（批 11 收口值只作上界：后续批还会继续删）
  assert.ok(rawNodes(TSP).length <= TSP_NODES_AFTER_B11, `计划册节点数只许减（批 11 收口 ${TSP_NODES_AFTER_B11}；实测 ${rawNodes(TSP).length}）`);
  assert.ok(rawSems(TSP).length <= TSP_SEMANTIC_AFTER_B11, `计划册语义条目数只许减（批 11 收口 ${TSP_SEMANTIC_AFTER_B11}；实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.ok(edgesNow <= BEFORE_EDGES_TSP - DELETED_EDGES, `计划册边数只许减（批 11 收口 ${BEFORE_EDGES_TSP - DELETED_EDGES}；实测 ${edgesNow}）`);
  // 语义条目与节点必须一节点一条（半删会留下幽灵语义）
  const nodeIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  const ghost = rawSems(TSP).filter((s) => !nodeIds.has(String(s.id)));
  assert.deepEqual(ghost, [], `计划册不许留幽灵语义（实测 ${ghost.length} 条）`);
});

// ════════════════════════════════════════════════════════════════════
// 11.13 视图渲染细化（纯核：36 条存档 ⇒ 1 行摘要）
// ════════════════════════════════════════════════════════════════════
test('11.13 **视图渲染细化**：迁移存档收敛为一行摘要（36 条 ⇒ 1 行），其余事件仍逐字', () => {
  const ROW: ViewRow = {
    row_id: 236,
    ref_id: LEDGER_REF,
    section: '§I',
    title: '跨册归属',
    problem: null,
    proposal: null,
    state: 'active',
    superseded_by: null,
    record_kind: 'task',
    origin: 'engine',
    ordinal: null,
    source_json: null,
  };
  const MARK = '存档原文探针-EOF7f3a';
  const archiveBody = (i: number) => `迁移存档：败方原文\n批 11（甲′）· ${LEDGER_REF} · A8A9-batch11\npath: src/probe/${i}.ts\n\n── 败方原文（逐字）──\n${MARK}-${i}\n\n${PAYLOAD_END}\nAAAA\nsha256(payload)= ${'0'.repeat(64)}`;
  const events: ViewEvent[] = [
    { row_id: 236, seq: 1, kind: 'annotate', at: '2026-11-18T05:00:00.000Z', by: 'lead', body: '批 11 落地：28 条 / 58→30 / 854 守恒' },
    ...Array.from({ length: 36 }, (_, i) => ({
      row_id: 236,
      seq: 2 + i,
      kind: 'annotate' as const,
      at: '2026-11-18T05:01:00.000Z',
      by: 'a8a9-b11-annotate',
      body: archiveBody(i),
    })),
    { row_id: 236, seq: 40, kind: 'close', at: '2026-11-18T06:00:00.000Z', by: 'lead', body: '销账' },
  ];
  const rendered = renderRowsToView([ROW], events, { header: false });
  const lines = rendered.body.split('\n');

  // ① 只有**一行**摘要，且格式就是裁定那一句
  const summary = lines.filter((l) => l.includes('迁移存档'));
  assert.deepEqual(summary, [archiveSummaryLine(36, LEDGER_REF)], `视图里必须恰好一行摘要（实测 ${summary.length} 行）`);
  assert.equal(summary[0], `> ↳ 迁移存档 36 条（逐字见引擎，查询 ref=${LEDGER_REF}）`, '摘要行必须逐字等于裁定给的形状');

  // ② 存档正文**一个字都没进视图**
  const bodyText = rendered.body;
  assert.equal(bodyText.includes(MARK), false, '存档原文不许出现在视图里（批 10 实测 +896 行就是这么来的）');
  assert.equal(bodyText.includes(PAYLOAD_END), false, 'base64 段更不许进视图');
  assert.equal(bodyText.includes('sha256(payload)='), false, 'payload 指纹段同样不进视图');

  // ③ 其余事件仍**逐字**（收敛只针对「迁移存档」这一类）
  assert.ok(bodyText.includes('批 11 落地：28 条 / 58→30 / 854 守恒'), '普通批注必须逐字渲染（收敛别把台账批注也吃掉）');
  assert.ok(bodyText.includes('✅ 销账'), 'close 事件必须仍渲染');

  // ④ 事件行计数：1（普通批注）+ 1（存档组）+ 1（销账）= 3（不是 38）
  assert.equal(rendered.event_lines, 3, `event_lines 必须按"渲染进视图的条数"算（实测 ${rendered.event_lines}）`);

  // ⑤ **两世界对照**（有牙）：旧行为（逐条 + 逐行铺进视图）会把 36 条存档的正文全渲染出来。
  //    ★ 这里**照抄批 10 的渲染形态**（`> ↳ by day：body` + 续行补 `> `）：批 11 之后那条路已经不可达
  //      （存档分支必收敛），所以"旧世界"只能在测试里显式写出来 —— 这正是这条对照的意义：
  //      它把"收敛前会是什么样"从记忆变成可计算的读数。
  const oldWorld = events.filter(isArchiveEvent).flatMap((e) =>
    String(e.body)
      .split('\n')
      .map((p, i) => (i === 0 ? `> ↳ ${e.by} ${e.at.slice(0, 10)}：${p}` : `> ${p}`)),
  );
  assert.ok(oldWorld.length > 36 * 3, `旧行为（逐条 + 逐行）会渲染成上百行（实测 ${oldWorld.length} 行）—— 这条让"收敛"变成可量化的差别`);
  assert.ok(oldWorld.join('\n').includes(MARK), '旧行为会把原文铺进视图（这就是要修的病）');
  assert.ok(oldWorld.length / rendered.body.split('\n').length > 3, '收敛后的正文行数必须**显著少于**旧行为（不是一个数说了算）');
  // ⑥ 单条事件**不知道**同类有几条 ⇒ 不给 group 时必须返回空（不猜"1 条"）
  assert.deepEqual(renderEventLines(events[1]!, ROW), [], '单条存档事件在无分组上下文时必须返回空（不许猜条数）');
  assert.deepEqual(renderRowEventLines([events[1]!], ROW), [archiveSummaryLine(1, LEDGER_REF)], '分组器对单条也只出一行（条数 = 1）');
});

// ════════════════════════════════════════════════════════════════════
// 11.14 真视图 == 引擎现算 ∧ 视图里没有存档正文 ∧ 引擎里存档仍逐字
// ════════════════════════════════════════════════════════════════════
test('11.14 真视图：docs/todo.md == 引擎现算（current）· 视图里 0 处 archive-payload · 引擎里存档仍逐字', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  const view = path.join(REPO, VIEW_REL);
  if (!fs.existsSync(dbFile) || !fs.existsSync(view)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆）⇒ 视图与引擎对不了账；渲染纯度由 11.13 钉住');
    return;
  }
  const rendered = renderLedgerView(REPO, { header: true });
  assert.equal(rendered.error, null, `引擎必须读得出来（否则这条判据是"没验"不是"通过"）：${rendered.error}`);
  const disk = fs.readFileSync(view, 'utf8');
  assert.equal(disk, rendered.text, `${VIEW_REL} 必须逐字等于引擎现算（跑 \`npm run ledger:render\`）`);

  const lines = disk.split('\n');
  const archiveLines = lines.filter((l) => l.includes('迁移存档'));
  assert.equal(archiveLines.length, 0, 'current-only：承载存档摘要的宿主行已非当前，视图不渲染历史摘要（引擎逐字仍在）');
  assert.equal(disk.includes(PAYLOAD_END), false, '视图里不许再有 base64 存档段（那是批 10 的形态）');

  // 引擎里：存档仍**逐字**（"离开视图" ≠ "删了证据"）
  const row = getRow(REPO, LEDGER_REF);
  assert.ok(row, `台账里必须有 \`${LEDGER_REF}\``);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  assert.ok(allArchive.length >= 36, `引擎里的迁移存档事件必须 ≥ 36（实测 ${allArchive.length}）`);
  for (const e of allArchive) {
    assert.ok(parseArchive(String(e.body)), `引擎里 event id=${e.id} 的存档必须仍可解析（逐字可复算）`);
  }
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
