/**
 * P1 · T-#A8A9-CROSS-BOOK **批 10**（C 类判据单边第二段 37 条 + 散文口径**甲′**首用）—— 红 → 绿。
 *
 * ## 这批要立的东西
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 10.1 | 37 个 path **各恰一册**持有且是 `agent-io`；节点 id 由 `nodeIdOf` 单点派生；判据条数逐条对表 | 搬后没删 / 删错册 / 判据丢条在这里红 |
 * | 10.1b | 计划册侧**三清**（节点 + 语义 + 边）；37 个被删节点 id 在任何册里都不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 10.2 | 名单 38（码位序）− 缓 1（断言级）= 本批 37；两张判据表 / 存档表 / 卡表与清单逐条同集 | 手抄错一条 / 顺序漂了在这里红 |
 * | 10.3 | 判据**逐字节**：搬的 69 条 sha256 相同；本来就在属主册的 192 条一位没动；总数守恒 **839**（734 / 98 / 7；826 + EEP triage 13） | 搬歪 / 重写 / 顺手改判据在这里红 |
 * | 10.3b | 上一条**有牙**：纯核副本删掉一个带判据的属主节点 ⇒ 总数立刻 < 839，差额恰是该节点的判据数 | 空断言的照妖镜（R47） |
 * | 10.4 | **甲′ 的胜方侧**：两侧同键不同值时属主侧原文**一个字节不动**（逐键 sha256）；属主侧空白/缺失的键**搬**过来（含整份 `decision` 1 条）；`responsibility` 7 · `semantic.status` 5 · 节点字段 6 | 把"属主侧为准"做成"按败方重写"在这里红 |
 * | 10.4b | 上一条**有牙**：给胜方任一键改一个字节 ⇒ 指纹立刻变（纯计算，不碰真册） | 空断言 |
 * | 10.5 | 域表**收窄**：37 条属主 = `agent-io`；计划册 `owns[]` 34 → 24（摘掉 10 条精确条目）；`src/` `scripts/` 等前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 10.6 | ② 档：这 37 条 klass = `owned`；塞回任一条 ⇒ 立刻 `multi_owned`（鉴别力）；path 分母**只许不降**（floor 568） | 纯核两世界对照，不碰真册 |
 * | 10.7 | 写端：批 10 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化）；属主册写 ⇒ 过 | 属主册自己写被连带拒 = 一刀切，也在这里红 |
 * | 10.8 | 门档：多册持有 ≤ **58**（95 − 37）、id 漂移 ≤ 10、属主错位 ≤ 12；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红（钉棘轮，不钉"当前值 = 58"） |
 * | 10.9 | **败方原文存档**：35 条 path / 138 个值的 base64 payload 逐字可读回（`annotateRow` 挂在 `T-#A8A9-CROSS-BOOK` 上的 annotate 事件）；克隆里无台账 ⇒ 显式跳过 | 存档丢字 / 挂错 ref / 少一条在这里红 |
 * | 10.9b | 上一条**可移植**：夹具里 `hangRow` + `annotateRow` 往返（同一份 body 格式，逐字读回）—— 不依赖本机 `tasks.db` | 机制只在"我这台机器上"成立的照妖镜 |
 * | 10.10 | **界外账**：`pool.ts` / `query_feature.ts`（断言级绑定）· D2 2 条 · 无冲突 C 类 **仍是两册持有**，判据仍在原来那一侧 | 界外被"顺手收了"在这里红 |
 * | 10.11 | **卡账**：37 个带卡 path 的 `node.task` 投影随节点消失；计划册分区里 **10 张活卡一个字节没动**（本批 0 次卡操作） | 悄悄把卡删了 / 悄悄把人家的 path 收了，都在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–9 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 37 个 path 恰一册持有"·"判据 839 守恒"·"判据/胜方散文逐字节"）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 0"（那是批 13 之后的终局）；
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数 / 判据数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ "有牙"的反检查（10.3b / 10.4b）跑在**纯核副本**上：真册一个字节都不动。
 * · ★ 甲′ 的"真相里不丢"在 `tasks.db`（**不入库**）：干净克隆里 10.9 显式 skip，10.9b 用夹具把机制钉住。
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
import { annotateRow, getRow, hangRow } from '../src/application/ledger/ledger.js';
import { listLiveCards } from '../src/infrastructure/task_history.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';
const LEDGER_REF = 'T-#A8A9-CROSS-BOOK';
/** 台账 body 的 payload 标记（**格式是契约**：写者与读者各写一份解析器，谁也不许偷偷改格式） */
const PAYLOAD_END = '── archive-payload（base64，逐字可复算）──';

// ─── 常量块（由 %TEMP%\a8a9-b10-genconsts.mjs 现盘导出；这批的钉子）───────────────

const BATCH: readonly string[] = [
  'src/application/design/db/gen_design_db.ts',
  'src/application/design/dsl_ops/file_ops.ts',
  'src/application/design/dsl_ops/node_ops.ts',
  'src/application/design/dsl_ops/op_data_spec.ts',
  'src/application/design/dsl_ops/task_ops.ts',
  'src/application/design/dsl_ops/update_feature.ts',
  'src/application/design/handlers.ts',
  'src/application/design/index.ts',
  'src/application/design/intent/expectations.ts',
  'src/application/design/intent/judge_cache.ts',
  'src/application/design/line/design_line.ts',
  'src/application/plumbing.ts',
  'src/application/refactor/index.ts',
  'src/application/source_writer.ts',
  'src/application/write_gate.ts',
  'src/domain/actor_spec.ts',
  'src/domain/chain_wiring.ts',
  'src/domain/discussion_log.ts',
  'src/domain/expectation.ts',
  'src/domain/geometry.ts',
  'src/domain/semantic.ts',
  'src/domain/task_machine.ts',
  'src/domain/task_schema.ts',
  'src/domain/validator.ts',
  'src/infrastructure/dsl_write_scope.ts',
  'src/infrastructure/index/db.ts',
  'src/infrastructure/index/index_freshness.ts',
  'src/infrastructure/index/schema.ts',
  'src/infrastructure/index/symbols.ts',
  'src/infrastructure/index/watch_project.ts',
  'src/infrastructure/parse/index.ts',
  'src/infrastructure/parse/source_exts.ts',
  'src/infrastructure/task_history.ts',
  'src/presentation/cli/cli.ts',
  'src/presentation/http/serve.ts',
  'src/presentation/mcp/server.ts',
  'src/presentation/mcp/server_registry.ts',
];

/** 名单（裁定甲′ 的 38 条 prose-conflict 路径）——本批实收 37 条，缓 1 条（断言级与 pool.ts 绑定） */
const PROSE_KEEP_OWNER: readonly string[] = [
  'src/application/design/db/gen_design_db.ts',
  'src/application/design/dsl_ops/file_ops.ts',
  'src/application/design/dsl_ops/node_ops.ts',
  'src/application/design/dsl_ops/op_data_spec.ts',
  'src/application/design/dsl_ops/task_ops.ts',
  'src/application/design/dsl_ops/update_feature.ts',
  'src/application/design/handlers.ts',
  'src/application/design/index.ts',
  'src/application/design/intent/expectations.ts',
  'src/application/design/intent/judge_cache.ts',
  'src/application/design/line/design_line.ts',
  'src/application/meta/explore/query_feature.ts',
  'src/application/plumbing.ts',
  'src/application/refactor/index.ts',
  'src/application/source_writer.ts',
  'src/application/write_gate.ts',
  'src/domain/actor_spec.ts',
  'src/domain/chain_wiring.ts',
  'src/domain/discussion_log.ts',
  'src/domain/expectation.ts',
  'src/domain/geometry.ts',
  'src/domain/semantic.ts',
  'src/domain/task_machine.ts',
  'src/domain/task_schema.ts',
  'src/domain/validator.ts',
  'src/infrastructure/dsl_write_scope.ts',
  'src/infrastructure/index/db.ts',
  'src/infrastructure/index/index_freshness.ts',
  'src/infrastructure/index/schema.ts',
  'src/infrastructure/index/symbols.ts',
  'src/infrastructure/index/watch_project.ts',
  'src/infrastructure/parse/index.ts',
  'src/infrastructure/parse/source_exts.ts',
  'src/infrastructure/task_history.ts',
  'src/presentation/cli/cli.ts',
  'src/presentation/http/serve.ts',
  'src/presentation/mcp/server.ts',
  'src/presentation/mcp/server_registry.ts',
];
const ASSERTION_DEFERRED: readonly string[] = [
  'src/application/meta/explore/query_feature.ts',
];

const CRITERIA_MOVED: Record<string, { crit: number; sha: string }> = {
  'src/application/design/dsl_ops/file_ops.ts': { crit: 3, sha: 'fc7b857f96a5f322e135b2b2d057b03876a4b9064d23673b7e6962d9e23285f9' },
  'src/application/write_gate.ts': { crit: 14, sha: '07054d26a43df33f298403518dc67bc94080d28f1b5de1972710163922703dbe' },
  'src/domain/chain_wiring.ts': { crit: 6, sha: 'b8bc50077455f859c45c94c00ed582ce48b753f6a16266007199b6b7564d4ddb' },
  'src/domain/expectation.ts': { crit: 17, sha: 'b2cdd0f9e8a1920b9bc2553889055ec1d6f0312b56c312d706b074cbc4291e6d' },
  'src/domain/semantic.ts': { crit: 2, sha: '0cd040b4ea74e0cee6eda3369871ba023fa58e845bf2849c690b3b299ca9e210' },
  'src/domain/task_schema.ts': { crit: 13, sha: '1daa2fdcd735ff6c9292aee72306953ee0c9126e9f221584f496186070914507' },
  'src/domain/validator.ts': { crit: 6, sha: 'f0882d46be60aba861c6fd40bd370147caa087b47f3fab5cda0a9eddd53c027d' },
  'src/infrastructure/index/symbols.ts': { crit: 5, sha: '51b84869de3e1ae3b02673a46a8042b7a241753b4fb025d227b7c092caac0efc' },
  'src/presentation/mcp/server.ts': { crit: 3, sha: '32e43b1d4f3f0b087ca2d5a60d20f79fe82ce4a41643c70f470b4f12995bfdc6' },
};

const CRITERIA_OWNED: Record<string, { crit: number; sha: string }> = {
  'src/application/design/db/gen_design_db.ts': { crit: 9, sha: '0cfc85eef4a6a855097c10f8d2e16958c189c69a0cd9f1eae7bbf0ac4622e900' },
  'src/application/design/dsl_ops/node_ops.ts': { crit: 3, sha: 'c77d3ccd4a0995aaf347bd50c56d1ac18390f8df2de9b808d46cf09bc442c807' },
  'src/application/design/dsl_ops/op_data_spec.ts': { crit: 6, sha: '9d5d492ddd36bef582f479ffd8df74f0076aabf3e3710bc7d5f4440d182e7808' },
  'src/application/design/dsl_ops/task_ops.ts': { crit: 16, sha: '1900f72e7dc7a95dcf1df295a1cbdfe46fea483ad6e9df0bcf0cb866bc6c62e9' },
  'src/application/design/dsl_ops/update_feature.ts': { crit: 7, sha: 'daf3f79c7692b31a43c37abbbe34f1a1ac862634ab2c66c7d223eb7a5809aed3' },
  'src/application/design/handlers.ts': { crit: 5, sha: '511cf0cea6af87cd94ea21a288514a948171fba599b84f643a241b6a3210d525' },
  'src/application/design/index.ts': { crit: 13, sha: '9ecd8fcfa68209712e9bb5eab18f4c1b15a15a41e703e9b57d6abec598fa4266' },
  'src/application/design/intent/expectations.ts': { crit: 11, sha: '13ba8717f223a736977706dcf0b015d0c8b7876e60c1a7532394a893ec554338' },
  'src/application/design/intent/judge_cache.ts': { crit: 4, sha: 'f9fd2627750e98a8ac7982747207d22b12ef11cb78b20a54daf19cfce77f57fe' },
  'src/application/design/line/design_line.ts': { crit: 12, sha: '8c01d93a90b3d240ba33cca0b158fe18ecc1b1591e77b185c2ceb8f5b2b1f7cd' },
  'src/application/plumbing.ts': { crit: 25, sha: '1b64c6462adc158232c50567fcc87d974742ae7f2c0b1dabf7fd31cdef23061f' },
  'src/application/refactor/index.ts': { crit: 6, sha: '9bc0bd6bbacd8098d4a12e93a908f27f6d2d62f3b453cf9398fe93981dbdeb3c' },
  'src/application/source_writer.ts': { crit: 6, sha: 'a22f1ce3781fdba4047b4b31e5302fe062bea8f0b6045a717ffe12c5a70eee3e' },
  'src/domain/actor_spec.ts': { crit: 2, sha: 'a8002747657fdf7c64d810a27a8fef949cc2597d028a7837304632fea32d72ee' },
  'src/domain/discussion_log.ts': { crit: 0, sha: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
  'src/domain/geometry.ts': { crit: 2, sha: '16bd64cd0085fef08535f55e75cc112309c62b713971a50eb9385a860ae652b0' },
  'src/domain/task_machine.ts': { crit: 8, sha: '7ba8151c5e086eaba5c7177a12767a1c39ccb642da49ef6c9bfe65b713101dd9' },
  'src/infrastructure/dsl_write_scope.ts': { crit: 4, sha: '3e188ade8daee1cf840064c41c8c9ef96633a6175a5f6f821ad6c2afb439eee0' },
  'src/infrastructure/index/db.ts': { crit: 11, sha: '48ed2e489cf9f0c027e353a0228bc56c9c0e1f9a181cfb477850b85a691e9fe1' },
  'src/infrastructure/index/index_freshness.ts': { crit: 7, sha: 'f7e31c2704484295ff12f8dcc3583fe31a779cb479a3c9f74522d45d5b91d3e7' },
  'src/infrastructure/index/schema.ts': { crit: 6, sha: '8ffb71e9f4c4d992dafad82e0001cc4cc0a7c38c462e34820833363de3312419' },
  'src/infrastructure/index/watch_project.ts': { crit: 1, sha: 'd9832ebe1cf7ba1c5497522743819c0d20044c838a5de2d847e6a29963c7539d' },
  'src/infrastructure/parse/index.ts': { crit: 3, sha: '2d67a734998064c4b2523279e626d58a742c696126094763969cea171a7eea18' },
  'src/infrastructure/parse/source_exts.ts': { crit: 7, sha: '203d3dc268013c6f77c58d279503d72d69325d30baf8073aff3ae3a2d0955bc5' },
  'src/infrastructure/task_history.ts': { crit: 9, sha: 'abf2a2fc89f3cffd03c412787a104dc84a5642143bbcd106a58785dd700db796' },
  'src/presentation/cli/cli.ts': { crit: 0, sha: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
  'src/presentation/http/serve.ts': { crit: 3, sha: 'd27f6ab4b23aa07b3e90af7704b67e75aaf9e610ef4644ab70162f0625b18848' },
  'src/presentation/mcp/server_registry.ts': { crit: 6, sha: '85d78dd2500d69ad7cb5165139f1819fd1b1b9eaa02b3ae099dbc03fe4c84885' },
};

/** 甲′ 的"胜方原文逐字未动"：两侧同键不同值时，属主侧（agent-io）那份**一个字节不动**（sha256 钉住） */
const KEEPER_KEPT: Record<string, Record<string, string>> = {
  'src/application/design/db/gen_design_db.ts': {
    acceptance: '407e0ab45de12965e77eada3e98f3351717a8dd1b0f283a87f6107009da960e7',
    agent: 'b29a984dff37053f7f5445ff939a10bab7cf82d48516c468cd53e1f81f93d38d',
    rationale: '31e4fa473a8336e1d4561303efef195694b535feaf24b163f796ca34a158a6ff',
    summary: '84ad90d50c2e4023046b1b889eb8405e83e9f92ca45fe04c0c7dc443e0b45e4a',
    updated_at: 'ffa937bb9d92e9b4f63f79c6e570d6abed46f1a26286649822e93386ef54e45c',
  },
  'src/application/design/dsl_ops/file_ops.ts': {
    summary: 'd2cdffbeb27bf0b207e6efa17b1319be46c59b71b0beb5065436673c2b51e508',
    updated_at: 'd7b5ed86d1d7250f7e2dac16ffcd4dca814d96ee3e9907d5ff50948c8391d893',
  },
  'src/application/design/dsl_ops/node_ops.ts': {
    acceptance: '607d7ea85834f26575c6a0fc4f9e43549206be85a9a7bdcef877589a149e738b',
    summary: '40511eef9051204d379eb11a3692740ad1ac5693146980fa8fa87d8330381d31',
    updated_at: 'f5e8ceda64e32d8ca2b7e4f683105e005c24fe5204fc4432d8ccad392b9a5c7d',
  },
  'src/application/design/dsl_ops/op_data_spec.ts': {
    agent: 'af60052ecc0ee4da0ceab33731998afb332c7d194cb7fe14738849b81bf3cb04',
    summary: 'd80f7f8805f9e950daf2b64c9af6cb6cd301d85238aab76cd157e3e349a8efda',
    updated_at: 'a0565fabaed4fe38f356ebbb4a3f3a5fb9e625c063131b0f04cd18c565b4b86c',
  },
  'src/application/design/dsl_ops/task_ops.ts': {
    acceptance: '891503070a1a210565c62fdef30bb41e50b40668dfebfbda5fdb7f2ddd438adb',
    agent: '7694caea2ab4272b01312ca75170dfc97a4adac98389fd325da1cd89fb168959',
    summary: '2900fd89ac3194f8db0ff5b5f4e290ae5a9e84506ed5eac33276e9d87c571c36',
    tags: 'b7725bb01eb005ec4136da4cf208eae7c0b5fe93891ce0e5e63810e5a8db19ae',
    updated_at: '59057b113496f4f1859a3b9b7926833bb8a4b9741b9b9718d92e506989e4b3fd',
  },
  'src/application/design/dsl_ops/update_feature.ts': {
    acceptance: 'aa50fba2fbbc5285329e9e581870b14b9535c8dddb71575d93f9a8235290df6e',
    agent: 'af60052ecc0ee4da0ceab33731998afb332c7d194cb7fe14738849b81bf3cb04',
    summary: '8cb63be332e65203ac2e359818b68b135146ecdabe1eb9313f6a0acca7c33e15',
    updated_at: '5e4c0c611afc9b49bc7ea9db92bd43b99de601bde46e9e6b8a3f9f99e2d84c56',
  },
  'src/application/design/handlers.ts': {
    acceptance: '814c5810f6bd562c49b226b62d687cf5677e46b373e30cd3a2cd874fe6683f6d',
    agent: 'c5dab4835e9fb4b74d445b2b64931a3114cceeecdbdf9d0aa6ec2317ddbe8c47',
    summary: '7bbf0547be0b796676efeb83116fce6cdae0ac08c328f069862196587b4f0bd8',
    updated_at: '8a7706d65117ee7d4ac8e782d7c43ce42d6a7b3c689ad87368223104bcc1344f',
  },
  'src/application/design/index.ts': {
    acceptance: '4c9c6679c41fdaf63bf2b90a4331d21f59adfa5fb69940d465a9348db07de826',
    agent: '5e9ec57c9b11efc5737db09b40194e056dfb796d8929ff9ceac1833d5b6e8e5d',
    summary: 'd59ca3128a96ca17c504e1666c688a85bf8270b8383afead594a5f83319dd6df',
    tags: 'a0b229f6c10223bf70ac6d7aa7942b983c0e1c6a131fad77fa770388b5916a92',
    updated_at: 'b6d19061cfc432c31af3f8fede3b59a7ffa2c5173a168fba8f4bdc9f336ec30f',
  },
  'src/application/design/intent/expectations.ts': {
    agent: '9369a7b5dd5dccf1ed705bbf4f9f27437855fb695b3c26cd70c2b04007d06ef4',
    summary: 'fad7ce578afc9452aa781a7d121b99be2d975ab9a7f4b2034baafa3706820c81',
    updated_at: '151f455fcd130f1440cf39850aaf5c5f17c4b1d8ece7e99f49f5ffcd8ae9fc65',
  },
  'src/application/design/intent/judge_cache.ts': {
    agent: 'e5df4af7359dc85d7fd40a7a3931dfc04cf51f50d93756f3dc3865048d8768b9',
    summary: '4c609db6b2fe49273cfbdb9b62c2ef4d0e9f701729c2538880225642e1c6421e',
    updated_at: '7be2d0d628596fb29e6d86321668432c19e4a69357b7737be53212b4c494235c',
  },
  'src/application/design/line/design_line.ts': {
    agent: 'c6726500050366c5259a3d79296321a30543723b96877fc032e733526104bfde',
    summary: '135726b7481d281c92515a6d54278994c0e64f1442b726439ae859752073ba63',
    updated_at: '0614f68229195235e07b1b5fe0b1812e9f9f2ac5e7e923c2ba34047f8e5f5fe8',
  },
  'src/application/plumbing.ts': {
    summary: 'dba2c19ccfa0cba1638e770167b2c74395b46b37a03ed7fe25f6e2a73f06a397',
    updated_at: '416471ccf044deb6484641653efb59be406d98c6f174b72494141718ce452613',
  },
  'src/application/refactor/index.ts': {
    agent: 'ad335251a7a0fb6bea4f7c9f8635dff69b6f119b75b47d210109d509fdb3631e',
    summary: 'a52a9cc284a764429b23b61fb87f638721e571fd7d2781b25479c867e39b9710',
    updated_at: '48f10d0dcd66233df6bbcb3105fe5d65d5e201932b023229a69779107e1e0b44',
  },
  'src/application/source_writer.ts': {
    agent: '5e9ec57c9b11efc5737db09b40194e056dfb796d8929ff9ceac1833d5b6e8e5d',
    summary: '531f51c8a7fe8d81c5b9f52ddb376de8d7cb79fb1f66f3667096800b6197c2bd',
    updated_at: 'd6543adfea84fa2ef3317b851d98f49569828f59c0d9d9dd21036c8d533631ab',
  },
  'src/application/write_gate.ts': {
    agent: 'ec5dc36e0cf0c0c43648ac78c9470c54ce842033bdb391c73e7cd3b5d77a4553',
    summary: 'a55de9e9a54b7298d71dc7c0692c123d63d309853b22fc51884da08780134045',
    updated_at: '7af4ee37642a6f95eb619a0ceff9efa702b15b055b24da4d29f10fa8bac2c9ae',
  },
  'src/domain/actor_spec.ts': {
    agent: 'fdc840690f8d377f9a438278adc496ddcb73ec0ddeefc6f724414ee4bf1402f2',
    summary: '85861c8e0490dcd1dcf4dd6a1a5b60460882f6c680a58b7665c94e2746a68915',
    updated_at: '927c331ba362b33d063e4ad7744bbcc84b133344fe80173f989b60044da215fc',
  },
  'src/domain/chain_wiring.ts': {
    summary: 'ca72df7d1163785bffc5d210d1dfec43717e99aadd8e0151c0afee6d037addfd',
    updated_at: 'ddce7e6409491ef143d9390f974e47eef913732a7e6ac4e6e4729405f9d9c9bd',
  },
  'src/domain/expectation.ts': {
    summary: '0386670fab3af80bc0727e9a0e9cb53157c43548c16836513a20fd7cc84425dc',
    updated_at: 'e23db62557e33147fba631a849404dd84d392bc9ba9e9aeb82742e3b217928ed',
  },
  'src/domain/geometry.ts': {
    acceptance: 'caf85371e4f0a6df1f623f6d8106513e4924f7f802ed99989c3461e67d70b630',
    summary: 'b8687c0f49a55056131defab5f9b264608300aa116c8de0543f238cdf132d074',
    updated_at: '140955386241a8776cf22349f4798ce0a0b1ed90751d8bc75f6d250ce3066b5e',
  },
  'src/domain/semantic.ts': {
    summary: 'd66ac6b163d183f728a6dc7857141329d6b1b0a2817c4cb88222db3395043d49',
    updated_at: 'efb355d7d8286dcc87330d80a00a4b37220bf659f22082524ea14e20df632f30',
  },
  'src/domain/task_machine.ts': {
    summary: '0449c012d4df2b05a88d4d71f6cfc7f3c4195446471f7102287bc936a24b1ffb',
    updated_at: '82b414b764909e97a966a7efc7bf5e87122cd0f30642452adad7cf1d25b02857',
  },
  'src/domain/task_schema.ts': {
    summary: '09052831cc59781c5551cc00efa6e9b806ee275b4284f9d5c09896f3dc434f90',
    updated_at: 'e79c7c2ce8ff401ad2790c1204f6a9b70e5f8e4fd2d5c8410717feed29276323',
  },
  'src/domain/validator.ts': {
    acceptance: '348e2f9ee070672e26add8ee56854b009cd8db6d9dc70ddc915d1f3e8a6356bc',
    agent: '3a5d90b0a66abc86ff7e550054f893630e91ea187502838b79e85031ae04fd3d',
    rationale: '115624b80b95daf35fd2075bf04ad54d87a828715c0f0d101ed14e6ecc8079fa',
    summary: '3b680a38dd1ae4e3ffe3abf9e42251b6cc81d8340f660cccbe259392aee3c486',
    updated_at: '74788c55513d93d62e244587b1e218fddee1fc9ac8413da3efc1a1ec7e97012e',
  },
  'src/infrastructure/dsl_write_scope.ts': {
    summary: 'b081b4602e0c408dd77ce59551714e1edc554db9a8001d634478a9ba2fafdf43',
    updated_at: 'd3ec2ed9c1b177f56476345e5d31b788fc225e0a5bc19c1f2a13bc65e10b2f03',
  },
  'src/infrastructure/index/db.ts': {
    agent: '5e9ec57c9b11efc5737db09b40194e056dfb796d8929ff9ceac1833d5b6e8e5d',
    summary: 'd0e254943ee5c81cab48fffd82515dc46e94aad182d65f5f768071ac6ffbedb0',
    updated_at: '522960d8fabf88ce7ac410b26f4933bd898cf6025312d1d6c0b881a7d73ec82b',
  },
  'src/infrastructure/index/index_freshness.ts': {
    agent: '877fef6fbb20e40c16b9e407082c4711556dab3ea91403bfd53fbe481ad36f8b',
    summary: 'de23f7a4b2d8a4841159997048be03b81f7fcf8099f69534ffda4d8510cd0606',
    updated_at: '3ac267bf7c7328d7d875a89ae8b0657abf68de0352d06267a28dc79914ded469',
  },
  'src/infrastructure/index/schema.ts': {
    acceptance: '322d6fa3fa6f1aedbb25764c78438db4ad3acf1efcab98895745a348754cecf8',
    agent: '82c258390c7adba81482fb0b9e4004dc4bce97f368dc1a9bc32bb05f1bff7320',
    summary: 'f3cd3f25bef2744d025a6c2905d273194b8beb8b775b615815462b936f6b866e',
    updated_at: 'cbd4bd3ce52195d02f5a877d7e10730078cc974e5b566bebd6ff995ab1f82f52',
  },
  'src/infrastructure/index/symbols.ts': {
    agent: 'ce7c1f5d4de728f33ae03c39c07742a25ad8c1cb3a051bc3b7ca3d9dab9ad6d8',
    summary: '010f34e8f6e05a7b6e1f1aeab7dfec469eaf1f48a0d65a15424627d7c59d47cc',
    updated_at: '6c430b1cdc9952269438f49e46516c79c67e9b5be563aa45991704a0ec0d95b2',
  },
  'src/infrastructure/index/watch_project.ts': {
    updated_at: '5598420a5465e960bc8e3ea29cf0c96c4416f4c22433e8df968f61b2f30434ad',
  },
  'src/infrastructure/parse/source_exts.ts': {
    summary: 'c2d0b3cd75fdf9264ec25fa6a0b21137ef8fa01242eec33088a23756cb77d657',
    updated_at: 'a771f177813e98022b971dedf85214fd9bca70701999f7e9e6d891e03fc7a8c3',
  },
  'src/infrastructure/task_history.ts': {
    summary: 'b28d157fe4a0dfb6d671261a33f7bea7c74edbaeb65bf334eb74bc01f9af27aa',
    updated_at: 'ae342b47a352d8b92cea3b50ad8c05c645e69ba0a68dd5196eab636ebe271c49',
  },
  'src/presentation/mcp/server.ts': {
    agent: '3a395d6e9a65717926bd6b36c671bc53e437d3ee8e02e154f1ec9e98939549d8',
    summary: 'c60c1e88f40d254f7a613a98f65e7a157aad73c799404748ca952c289b3b21bf',
    updated_at: '54ee631f8c900e066ec53318225b23a1a3973cfd2e6813523522a6b06788321a',
  },
  'src/presentation/mcp/server_registry.ts': {
    acceptance: 'e31dba123e0ec965b1b205ed3390aaf816b8dc6c8a6c6052a89056e5a2df79f5',
    agent: '877fef6fbb20e40c16b9e407082c4711556dab3ea91403bfd53fbe481ad36f8b',
    summary: '2661d5519745ce56e15b11131fb6ab3912f5ae9fd6445c92debfc65dbd8f97cb',
    updated_at: 'f9443f0d608a35949bd204133b5773830b7b14ab56c73f4d649561e1e0dacdee',
  },
};

/** 属主侧**空白**的键：照旧**搬**过来（败方独有叙事不蒸发） */
const MOVED_PROSE: Record<string, Record<string, string>> = {
  'src/application/design/db/gen_design_db.ts': {
    consequences: '15da9af5da9dd7eecc38d6d65dd9e43794a12682c65ce3bc1582f7f26adddaa9',
    thread: '24d52bdd1647d36f62983cc9c71fd27778c1a7b6089e2b131deac7f6fe7e6d07',
  },
  'src/application/design/dsl_ops/file_ops.ts': {
    acceptance: 'd84534ede87a2d4e60b7b69d345014fde70999b10eca6fde9723fe211c252f23',
  },
  'src/application/design/dsl_ops/node_ops.ts': {
    provenance: '704f1673c2061c088c607c2136f8310ad8826a88642448786a4b23b06301e6ed',
  },
  'src/application/design/dsl_ops/op_data_spec.ts': {
    acceptance: '468ad977f5df5f2196269a0f9977e4a2c7166c0c81d50fa7d3ebbf22e2f43aab',
    provenance: '64f7b183ba263b9c6374e9d384b458b90b21ed1a45f167cd74d11bdbc11bb66f',
  },
  'src/application/design/dsl_ops/task_ops.ts': {
    alternatives: 'cef207ecd855b288eb4e78dcec0d0a8fee7d4556c0653f48cc61805bfe3ad930',
    consequences: 'df18eb5c80b5b305bf6796f6e2f915d41e533209594fc37fdc8167332734caf6',
    rationale: '1d07512c07dad4c74cef4aef6d4aba9485fe4c7d0e422987eca25a1cb988ab0c',
    thread: 'bb36ccaec71d11614c756ea88170078c8d5cbe12115fa02c3a62acdea57bf167',
  },
  'src/application/design/handlers.ts': {
    consequences: 'dd658e61c442d4bb106b9d8bbdae4a6335f448b07628b06ca459c0e0af97b5a3',
    rationale: 'e15739bf7589ded403c782eddd28d6acae3f14f31535239847b96ff2b7187fc5',
  },
  'src/application/design/intent/expectations.ts': {
    acceptance: '98502511456325b0ccc3586f396e97bdd796124d0991012d87d1f1e92b1e2bb9',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
  },
  'src/application/design/line/design_line.ts': {
    acceptance: 'f5c9cafe1c740433f3b225811703667b7e15101d235c8ab967dd9949213a6762',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    consequences: 'f660cda72284dee8cdd78f41d89f43c7121528dcbfffca578c8dc71d75662e9c',
    rationale: '86d72809e47f4592002358ea597c041cc388fe284dc45f02392c52d597ad3a1d',
    status: 'db0fb2bf5ebc424454c3e11b5ee8bfb43af24a52e561aa49e94143831dc6fd93',
  },
  'src/application/plumbing.ts': {
    acceptance: '1ba2cc23c91c2aaf022c4aaf7e551cc23d2dc042430ce598ca135357c8e4895b',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    consequences: '9bbe797146f3edc0e51145f4e0c668ff86fdb003f50c732aaee690fc8290127b',
    rationale: '88da8722cbad8352486d0138b28b1e9c153c1680c03f2f54a7e1c5d3276a053b',
  },
  'src/application/refactor/index.ts': {
    acceptance: 'e073d50d220449fa6534f5cb8ea87b41b26dbb725e73eaa8f9ae6cec08025ba8',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
  },
  'src/application/write_gate.ts': {
    acceptance: 'e03941c3973a9c76ca7da95a4c55ae588af0d3a3fa666aab7eff182b6872276a',
    creator: '64124380267d25733474f2955a254c083c4262889ea5876d5c6e53b0862ee8b2',
    handoff: '8c48b23853de57c6b210740195e0be8112ed482bc499853df36edc8455e12dee',
    provenance: '51d10d95a48e9c6c8c11d7b3044c143dd8c614886d9f0f1f69007eef4eeb0d5a',
    source: 'dd1378c090250112e02be6226d1d6977746a35fdf083b469aaa47338392b49ac',
  },
  'src/domain/actor_spec.ts': {
    acceptance: 'd428b233e6f4b7ddf8136d760d783406f317b79369f407df04121f04ec47508e',
  },
  'src/domain/chain_wiring.ts': {
    acceptance: 'bb06e134ae17a5ba5ec9b158322878a423ebdff5058ae9caf72a5225a274e6e9',
  },
  'src/domain/discussion_log.ts': {
    acceptance: 'ef1383e0eb6b8bd9a878d9b387a80d92b500c954fae3a61fc95519fd6a140851',
    agent: '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
    rationale: '893c0bd1588b160367e0d6db504ad17548a8aa15d34d24686ea932cae3d8e690',
    summary: '7832c6a8736f5dd0c83180ab817212ff126323936b548f8f97918ce5c4c12c05',
    updated_at: '4af9ad76e62f8254aae9e95f14730f3706bdb6699844b3cddb4b722d4a981453',
  },
  'src/domain/expectation.ts': {
    acceptance: '8b42d2924a6845dfde9d330de33d6c3add6799db0894c2d3c92d6a89cc5d83d0',
    provenance: '704f1673c2061c088c607c2136f8310ad8826a88642448786a4b23b06301e6ed',
  },
  'src/domain/geometry.ts': {
    provenance: '704f1673c2061c088c607c2136f8310ad8826a88642448786a4b23b06301e6ed',
  },
  'src/domain/semantic.ts': {
    acceptance: 'e374371bae371acdd87e8c0e99c246576fd1f9663e1c3241e1e27ff6b2116f83',
  },
  'src/domain/task_machine.ts': {
    acceptance: 'fb44a71bc0ecc96532f9c1c7dbee5bcbd7c4d2401348901d025baaf8f681804f',
  },
  'src/domain/task_schema.ts': {
    acceptance: '4b549ec4606277b0a122736466f0424ed460aed3bf08dcb587ae3ead681688fa',
  },
  'src/domain/validator.ts': {
    consequences: '075c3e3b4dfeb9b13a984a1e90e4aaf8f3298e60946e12f22dc229eb6c41a433',
  },
  'src/infrastructure/index/schema.ts': {
    consequences: 'af5c755f32983a9a110d9ee8177a15217689da81fabb70e22280ec534128858d',
    rationale: 'd8936d6d389d8f4b5e188074df470cc0abc51920d724673240eebfc86f372fe3',
  },
  'src/presentation/mcp/server.ts': {
    acceptance: 'e6fcb26f2c8fcfb6aca67d239a2f618fdbda467ede18395b619f83539f305865',
    author: 'c6e760a00a7fc1f91c82cc160b7ced886ca1580a2b9ba10706886c1d37fcb716',
    rationale: '628a7d75553c8d18e830c01e588358bee2f877130e80854ad42ea91aadc80f0c',
  },
};

/** 败方原文存档：payload sha256 + 每个值的 sha256（台账读回逐字核对） */
const ARCHIVE: Record<string, { payload: string; values: Record<string, string> }> = {
  'src/application/design/db/gen_design_db.ts': {
    payload: 'dc347c39ea32fabe500462148393c679d5a3b56c5a8e598f61face4757c9032a',
    values: {
      'decision.acceptance': 'cb43dc3d2c2192da474a426720eb4872e7c19de12404b00fa419bbdf265eb539',
      'decision.agent': 'd4e848a6829455794024c6cddfaa084a7d86d27dadbb17cbe07a8a63c7a9844f',
      'decision.rationale': 'aa3ecef92d9907839e91afd58524a1b574185ca328b84b6cfa69ab79ad6660f2',
      'decision.summary': 'c06b62198bce007e1af21d93eef40674a3dc6fbe9b78830983b2c27ef744916f',
      'decision.updated_at': '0ce52d12ca0e01f08e5a64c97848ac8ded0bf6da79553e1e744a5f6c5d1cb3fe',
      'node.overlay': 'ecb9c73e9378b5ebef5c0285f963331a314b1cfc0c9a073a124df03058812bf3',
    },
  },
  'src/application/design/dsl_ops/file_ops.ts': {
    payload: '69ac9a2cc9948c18b60799316dc90e5ec95d4f631d335676286e2419a239b13e',
    values: {
      'decision.summary': '84cd2cc1953ab16177310a68dd2c088c4da8be898640d479b5c92dfc88cfe381',
      'decision.updated_at': '6bb85555946d0e94ba6b45d848c367d9b4355cc4d8cbbb3fdc403264a8ffcb6c',
    },
  },
  'src/application/design/dsl_ops/node_ops.ts': {
    payload: 'b04d1c1d2fce3af1c94f6007e5455e3fff365e48ef8aeea6b2439a49b49dc80d',
    values: {
      'decision.acceptance': '03aef339ab4560c78f980af1fe5e5fc6716b1237e4a9ef9946f758bb51e97d7b',
      'decision.summary': 'a25dde7a4abddde41f0170e68aaef379a8fe8c613f098737cb117b2ae33d11c8',
      'decision.updated_at': '13158f2523132968e7888ba3d06f119cd78fb2a88f480dfb12d709a613a19ff2',
    },
  },
  'src/application/design/dsl_ops/op_data_spec.ts': {
    payload: '586a462d418960123f06018dea8a70d0bc51faea0785bd81d9c1b89f72b25b1d',
    values: {
      'decision.agent': '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
      'decision.summary': '8422877b093dcda45566160fca9c010e97c5af38ebeae51712cb01681b8f47e9',
      'decision.updated_at': '0b7f9e7b94e7e7f8cbea8d571ab3d2ad882e508bd48109179ea5ef320c152c5d',
      'node.overlay': 'd8ca6192061aaf414f6e58156c4d28629d428bb3df613f1049a1eef33de35d41',
    },
  },
  'src/application/design/dsl_ops/task_ops.ts': {
    payload: '1cd1c38e23c892df00151375b6760386872791eb63b009685c9a00235b575e24',
    values: {
      'decision.acceptance': '419227467a590e6a23e95d4aaedb631284404b1ce2c8904fab2d574eb1e51d42',
      'decision.agent': 'a568451becc11df5d27fb2e106a15ea03de169cb165b75065b8e15d51a4faf54',
      'decision.summary': 'a9c47f622734216e61265e8918ee21d80fb1efc97c22d40d5ad40734131ad0e2',
      'decision.tags': '84065a4df5e465803b4891d56af3616949fe66d1954ee0dbbbfacc9119f75255',
      'decision.updated_at': '5c70ce57cf664f416e829ce2afaf45b0e80c857f3a5f6a623340f20149f15934',
      'node.overlay': 'da3efbdca05a5a9d77067b6978d12f089c7ca12d463e2badc6d2dda21cc044c6',
    },
  },
  'src/application/design/dsl_ops/update_feature.ts': {
    payload: '9ec58c7dc656417db135d060cbdee9525e6c25edd86c6315c8bdd4934dee9dd2',
    values: {
      'decision.acceptance': '9a2d9df2814025d1097db10e2e71c1293d42652dd111efcbb821efb7b0beba98',
      'decision.agent': 'd1ca7ec211af435a913a2c935834168c4d98e93146137bc85064ccbc885fb432',
      'decision.summary': '2222d125906fb9cafb1aa7144bea6469387c32865cc4471a7273136d336a58bc',
      'decision.updated_at': '92ce00241ca002edc2055c85b71ef8867a7ebeb69e95a24a381babfb2c2d9e86',
      'node.overlay': '5d6eba62dc2237a8e0ccdaf2f166c5bcf70a7e5c6e2dd27d07fbbdb728930721',
    },
  },
  'src/application/design/handlers.ts': {
    payload: 'd0d3eb3880ab4e5b27b409f1737ad859e90a860a481974e5f40b0111389dfff1',
    values: {
      'decision.acceptance': 'efb38c43afd61ccfd53e63e503b4352244496fa192126672b7826ffc4a4ddd51',
      'decision.agent': 'd1ca7ec211af435a913a2c935834168c4d98e93146137bc85064ccbc885fb432',
      'decision.summary': '713eef6c626c7d8a9eb5939a6d07fe41982ea5aaff936e23d973422575a3f3ef',
      'decision.updated_at': '9d378efa960b959b70486032f6c204a7afe4cb4978aac16ef04e81b1c1e4f922',
      'node.overlay': '289f4d72206873a3b77094818f051d8b8182ac22631522e26f3e62252638eed0',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/application/design/index.ts': {
    payload: 'fc0b78f375845e33d86121b48667d00fc4e0db678b64ddb59936d762b10504e9',
    values: {
      'decision.acceptance': 'e0ca6020e2143b340b994ad8c7424ac8b45169d1fca0f9f919de5eb03f11ae80',
      'decision.agent': 'd1ca7ec211af435a913a2c935834168c4d98e93146137bc85064ccbc885fb432',
      'decision.summary': '4b63a96113422e3dc8e9d96babc04a668fa6b38ef042c61821f7e694005c67c3',
      'decision.tags': 'dfbb55bba55144a8166f7477b5bcfbac321954ec3972fe9226a3bf8621830295',
      'decision.updated_at': 'd647191f13e5bcc71198c2ba87746118f2077ae4feb3120540f7edd9bf963946',
    },
  },
  'src/application/design/intent/expectations.ts': {
    payload: 'a5739c9ac2ec12eb91822a3b2a8217635535f66566d1d05dd1a749604976fe4f',
    values: {
      'decision.agent': '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
      'decision.summary': 'c20a67ad6f33bc3d53c87bb751d34b9e3247a4cfbb9c49fa7472de203a29cf7e',
      'decision.updated_at': '2529cade062f9850bfde574ef9bc01a32aadab397d31d7513aee480120fd0596',
      'node.overlay': 'cc0858edcca126f5478919c90fe4ca616a27b577da00a98ca1a43281ccd97b89',
      'node.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
      'semantic.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
    },
  },
  'src/application/design/intent/judge_cache.ts': {
    payload: 'a4dccc3084d34a029011b3c622d2002deabdf460430ab996a696e2868c44313b',
    values: {
      'decision.agent': 'd1ca7ec211af435a913a2c935834168c4d98e93146137bc85064ccbc885fb432',
      'decision.summary': '1a42b4cfac20b394edd3a82b6a044ebba94fb0dbfedf6787f819476f33a37063',
      'decision.updated_at': '72ccb6a9b6637bd88a23b92fc539953534a3d6681f0953cf9bb86833b3cc33de',
    },
  },
  'src/application/design/line/design_line.ts': {
    payload: '0bc9a812245bc4e05bcac975421cdf0b6e654f862a8180173208d6c679879005',
    values: {
      'decision.agent': 'c7dc195ccf754d8990f81661ab580edde2fca2fd0670cd72ade59815f3540337',
      'decision.summary': '8bfa6bad5beeb9f69d0527d75d609ce62a277af0f474ebdf98f75ecdf6e272a2',
      'decision.updated_at': '94447fb0f08bd9d311d60fc4ba21c2940dc7e1088c27ac5014c95ec5a9e3d7ce',
      'node.overlay': '52e3b83f9fc2b284ed41a32f3a98041e3a0ec4c94387e8ac70b2e4905a4794e0',
    },
  },
  'src/application/plumbing.ts': {
    payload: 'c19280df5447fcac35d278d7af66b0f0c7ae5b08ff9cab110ac87f54250a4e96',
    values: {
      'decision.summary': 'a69c6b7c49becba3ce6eea74c02c1c45c27535fa4e03b54a0d9e26d13dd1d294',
      'decision.updated_at': '3f0943fa6c8d499e007f12713f6a9527c47d3b71be6688bc67f4140d8b78322f',
      'node.overlay': 'b006faf1e70737a80113af2fea13d8929503e6342a1ddb5933661ced43318301',
    },
  },
  'src/application/refactor/index.ts': {
    payload: 'ee9c739267d8797f9b3dd582abe85d10a7125c97d5e1f36ec3568f072c11e228',
    values: {
      'decision.agent': '2717bbb04d0a1d329a565befb5ecec8e9d695fa7b78e82acf3770c85eefaafff',
      'decision.summary': 'a640ea8b3199b8734ebb19fadb31d13ad9d0f257c48f758c1c798d50f0c30c7b',
      'decision.updated_at': '22c2f322feb80cf1b0562ab84bc91f664c997716959427ba075096b56d8c82cd',
      'node.overlay': '544d2caebf3cbc0337aa36d9c2162913a9d1da6f67df0340e860eb62da7e1928',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/application/source_writer.ts': {
    payload: '8b51ca0ef58b6f268626c54c044a6a3c0b6eb0d2c39261b99e6541e08c7b1905',
    values: {
      'decision.agent': '185f69ad22b64663c9b1619ce7f153c780ba236936f2d35aea23617618f51a50',
      'decision.summary': 'ebe6b2009bd44cbbfe02e5fcb0f35887346eae1627af60eda1a2e7852591987b',
      'decision.updated_at': 'c642f2326dc4233226443a885d7c58f711d8aeeff5c83b0ff8418c0bf372af50',
    },
  },
  'src/application/write_gate.ts': {
    payload: '2ab93e1e899134022b21dd1c0ee63b72c8ef1bce55067b133785d333403c79b6',
    values: {
      'decision.agent': 'e5a386714a65a8c9b7aae233cbd78622e9955b977a4f8d8199e223c2bdfc30fe',
      'decision.summary': '2084c20b74a044c7c620ec75f82bdeaa6d719908fedf236308b606bd1c317524',
      'decision.updated_at': '78873c934b58c1ee301cffc6b73197f54d4c021f415f1f8e0656e41fb7c7dc0b',
      'node.overlay': '1499179c65a6f4ccb6b6aa99f897db8928b83bcdf9e248325df93fd55550e07f',
      'node.status': 'de2bc7968076346e1ae2e62d3fd6385361b3855025678cd2732d9132eb9965cb',
      'semantic.status': 'de2bc7968076346e1ae2e62d3fd6385361b3855025678cd2732d9132eb9965cb',
    },
  },
  'src/domain/actor_spec.ts': {
    payload: '0857d318d66b720e0062dc4a4320401f86e2884370b3e628fb5eaa9c3e9a0a73',
    values: {
      'decision.agent': '976d16f82a5beeb6eb7ed3e78a25668b7a6d12cb8fe169fa5026dc4b42678787',
      'decision.summary': '82fe64442e942e2f171c71997ef6ac297425c5936b7b4f1db945a92153b96c39',
      'decision.updated_at': '08fd59ad416ed1526fe109a2139a294865b81471dff4292c10ccbf3a57189002',
    },
  },
  'src/domain/chain_wiring.ts': {
    payload: 'c43abf1969b1dae82aabead1c9a6bded4f4fcc7771ebb84565e84e8899aaadff',
    values: {
      'decision.summary': '235a42bf0780abbe51301f5892883e2fe2138a459376c3a20d216fcb43e6b926',
      'decision.updated_at': '987b1fc28826509dcf431607687f244e39adc71a0971413d83deb0bb71e7280e',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/domain/expectation.ts': {
    payload: 'e35cd60165b4d1b3b5e92158f3dac63fc866187c0fa0425cea58b0b8bad71535',
    values: {
      'decision.summary': '6a2d522d31749083be90c147729871bda0ecf8d1185577421b21a4dcbba3bfcc',
      'decision.updated_at': 'f4db069cfe5435d16e9c39861c6a2a611a219e6894ea9f179912920d14803616',
      'node.overlay': '04c7cd85a4743f9e0a7f8eb473f790c4634840094f2a19cff1d9d18c86cd0cc2',
    },
  },
  'src/domain/geometry.ts': {
    payload: '63f0522f6c2702ad654a4c8c34c3714faf1fba58667f06e92245a7308dc3c183',
    values: {
      'decision.acceptance': 'e8e596576063d61dd762fba1725638865f0a4c41c937f41974c3ca813ea83534',
      'decision.summary': 'dd13a967dbd976b9d3658e19309923e912ea759b42cd5d1b188cce2683cf6e1d',
      'decision.updated_at': 'c9a4cc8c29e97afc2930706ec901f8d71aa469d673c0201a0f2e15ff771b182b',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/domain/semantic.ts': {
    payload: '2353807c6903e03daca1db0e294077dce796cd8be7530c30b64d25913cd1adba',
    values: {
      'decision.summary': '102ba927986a7379e4b93d6a7ae2d2a80b11b09b1675260a686808c0c49594f4',
      'decision.updated_at': '8d036285856b5dae0251568d754319911208704246c6bed555ac7caf27ce94ab',
    },
  },
  'src/domain/task_machine.ts': {
    payload: '337ce4fab7482d5f6d8bb8b08e4de0f755dad34c82a353c80d4f4ec792fd839d',
    values: {
      'decision.summary': '6dd4e5851eac2c3301c8e270836569cf540ec490328d07cbcf30725abc120029',
      'decision.updated_at': '5809d3740bed9b3237ce425b2301b322981f053c59c0d4cd36490aeffcc31306',
      'node.overlay': '39046788145d4ceb34d676a72562c59bde792160fbd2b808799b0b14c10902c1',
    },
  },
  'src/domain/task_schema.ts': {
    payload: 'e89661c6fbb6c78ddea43fb4d33abf514a78904bafb536bfd220984308131875',
    values: {
      'decision.summary': '251ce8813bdd866496910ea0dc19b44d677ea4edd7f0202a4ccf31f9b57ff73d',
      'decision.updated_at': '2450d711f7b7187c3774736a72732df697b775b00ec7ff79a22b54acdf8326a6',
    },
  },
  'src/domain/validator.ts': {
    payload: '3a3a9d9ee02c1421b8d78047a74592b5b176ff46a82bb069abcdc586de465140',
    values: {
      'decision.acceptance': 'f96cf719ad4af7664370961f447bbde9097284c8f7583efd2f42a9976e0c4199',
      'decision.agent': '2717bbb04d0a1d329a565befb5ecec8e9d695fa7b78e82acf3770c85eefaafff',
      'decision.rationale': 'e33573a5f4042e94f807506d8d81d130be1315b321e2c3b3c63321fe27767c1a',
      'decision.summary': 'cefcbd1e4e2dc6b1fb39cd8c77d7197666c7e4b95194fb3dfd6ea377f38ba7b2',
      'decision.updated_at': '42cc6f831281b096f35806456077bba9a56515f313d441fbf1efcae3abe9a2c9',
    },
  },
  'src/infrastructure/dsl_write_scope.ts': {
    payload: '640f1b3626461bdba767890664c235158e30b7b4abfa0355ed3a718c7256694f',
    values: {
      'decision.summary': '18372d13f7b2b9ea7ac1ac1e3a626223a6e74296fc0c5b9613b16570f0d56c67',
      'decision.updated_at': '73315c4c76a7d1f0cbe75e207cf42f009f471695b515359225f66d4ae229024d',
    },
  },
  'src/infrastructure/index/db.ts': {
    payload: 'f5af0455f6ab2d23b145296b716a5857918943a5c213d78355ca39bf61438e6c',
    values: {
      'decision.agent': 'dd175f3afc4e3c6f64dde32e8d9b80b2435e3268e870755d3034bb7c285dff8d',
      'decision.summary': 'f7da4fdf937bec0859efa3033eabb3d78fa2870956ecc60a5a9a04b3591f258c',
      'decision.updated_at': 'a221c42c61e6db7393bf4e93a03f1c51f37b38ebb13fd9333d7f0bae1d8199e0',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/infrastructure/index/index_freshness.ts': {
    payload: '992834eb50732b32d8a07c1eab0d0ff559c11ff907125679257b8596ea2ccb02',
    values: {
      'decision.agent': '70b47728b438332faaeae2110ba7c7a336ce0a776d563a5bdd6612563de803a3',
      'decision.summary': '5fe8ecd2c6baf3f785508abb515a445dede04bef287c5ad7f58ae2ff91252126',
      'decision.updated_at': 'e975c4e1e91ab908b14c566fcc4ceb0c6c752d635fd66472abf0fb4bff885a00',
      'node.overlay': '75118633f7e90556f60786accb70c623e66fcf259424511d25338d1388678626',
    },
  },
  'src/infrastructure/index/schema.ts': {
    payload: '94db6c275eacec2e0dbe717d8ce78e9cdd60cd3da5ae2434185ddbbe5e83348d',
    values: {
      'decision.acceptance': 'a8200f5eb4e0ef1cb0ea5464d5b9994ce38dd5fe6b2bc8f06316a5bce7db35ee',
      'decision.agent': '5114c7e4584087a4758f86158e4aba57e7a4c8f4a5fcc564efcb043303f65814',
      'decision.summary': '85d1491a39aace1dd2be1f2b7fe82de031aecd4ec11e5449547d28b02bf08e95',
      'decision.updated_at': 'f1b447ed2938c381ead428ccc6d5a5b2531a5c50c456050ca8d1f38e15a79cc0',
      'node.overlay': 'b2738f0e24a7ef4348305cd75b2564ada60b7323221d3e8893a0853930f34ce1',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/infrastructure/index/symbols.ts': {
    payload: 'b10888b8168844641b79348c18bdc355694958796f88f52d7f26a06b6eef71aa',
    values: {
      'decision.agent': '5114c7e4584087a4758f86158e4aba57e7a4c8f4a5fcc564efcb043303f65814',
      'decision.summary': '12c73008c70d36cae523253f10fc022a6e7da004440acca0ea27fca0932ba68b',
      'decision.updated_at': 'fb1781fa4470ba15fa31bbd83188fd9964b27bb526d7c2c3ee4ab29eee797046',
      'node.overlay': 'f07a631b646480b36903dd2a611b44979d01c3775c84c70761fc862b5c2d1c40',
    },
  },
  'src/infrastructure/index/watch_project.ts': {
    payload: 'afe78415933051a85cd52235672adfc4b67c1e98f24147f3e92478939dbb3db0',
    values: {
      'decision.updated_at': 'a9a912a858d0bf099b1b3d8e78f36f29bd767bf135a4bcd5541bfddf5c0f8554',
    },
  },
  'src/infrastructure/parse/index.ts': {
    payload: 'dfd5405c845de2841a30d6ada4586368894ac51c148f7af4283b55c0d8c85f35',
    values: {
      'node.overlay': 'af0a55655c09bb76017258a9ecf7da39ddd9c5ed2ae29349e6c050e0a1bbc338',
    },
  },
  'src/infrastructure/parse/source_exts.ts': {
    payload: 'e657ce6d89bbe8fffd34461b989993d16801a2243c5ddfb597d0780e066ac5b2',
    values: {
      'decision.summary': '8c2b9d7811cad02dab3c0ec8774506b806249ff20d62b7c84d1769e534744402',
      'decision.updated_at': '7ed41ceeb31126232f748c76023f750b3df0396c94aa20db414523b26af90509',
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/infrastructure/task_history.ts': {
    payload: 'd37a6f33b6de051ed7e796fb35f1bfd8537314a07cba3c6eeab750668af72909',
    values: {
      'decision.summary': '77228d770f99797029911d8dcb5a9c508ebc7917eda535f27025179aeb1a1908',
      'decision.updated_at': 'e8806cd32fd0ccc7e80185958fafc6f7f8488e6164e9fd139888fb009e8c2bd4',
    },
  },
  'src/presentation/http/serve.ts': {
    payload: '338a486a5cc26ca87a797aa183e907ef4b1a22a2a18a41c9b07ade74b9bb4495',
    values: {
      'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
      'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1',
    },
  },
  'src/presentation/mcp/server.ts': {
    payload: '9bfc35522df9d96f4d6aed4146529871db76e3b09e8085a33e81c20918d6e025',
    values: {
      'decision.agent': '5e9ec57c9b11efc5737db09b40194e056dfb796d8929ff9ceac1833d5b6e8e5d',
      'decision.summary': '81aa86783ee59dd1fe9afae6ead36bf28d9047d3c6a5edc7e0bb0889b3322d00',
      'decision.updated_at': 'ccfef0c0fb0c45920697004fb4a333dff9777f6f29cd0f0e5a5527ec437dc987',
      'node.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
      'semantic.status': '58bf5b5478e5d1fb7441daeff9fd1ed60a4ad5fbfabc64715cd8608f3f59f6da',
    },
  },
  'src/presentation/mcp/server_registry.ts': {
    payload: '70df9751947cd353a2a5183e12db859d55d04e096a54ca17481158d42c6c525e',
    values: {
      'decision.acceptance': '837015fd13d967a53cdb42a0c337452f3ac7f60bdc77549d0df94e21b45577a0',
      'decision.agent': 'a568451becc11df5d27fb2e106a15ea03de169cb165b75065b8e15d51a4faf54',
      'decision.summary': '3c3d2c96653229e8487c8fd5b0ef1b6e91412fb69508e2ed4b96dcefb7ec7233',
      'decision.updated_at': 'bc62c1397330837e196a28e3f8de498aa80e826e476e68c2ec26625154c418b1',
      'node.overlay': '9ed9b916af89c531354d6c196674f8177a1a2a8104c0749f94f34381b3d57342',
    },
  },
};

/** 计划册侧删掉的 37 个节点 id（全是 `nodeIdOf` 单点派生，漂移 0 个） */
const DELETED_IDS: readonly string[] = [
  'file_src_application_design_db_gen_design_db_ts',
  'file_src_application_design_dsl_ops_file_ops_ts',
  'file_src_application_design_dsl_ops_node_ops_ts',
  'file_src_application_design_dsl_ops_op_data_spec_ts',
  'file_src_application_design_dsl_ops_task_ops_ts',
  'file_src_application_design_dsl_ops_update_feature_ts',
  'file_src_application_design_handlers_ts',
  'file_src_application_design_index_ts',
  'file_src_application_design_intent_expectations_ts',
  'file_src_application_design_intent_judge_cache_ts',
  'file_src_application_design_line_design_line_ts',
  'file_src_application_plumbing_ts',
  'file_src_application_refactor_index_ts',
  'file_src_application_source_writer_ts',
  'file_src_application_write_gate_ts',
  'file_src_domain_actor_spec_ts',
  'file_src_domain_chain_wiring_ts',
  'file_src_domain_discussion_log_ts',
  'file_src_domain_expectation_ts',
  'file_src_domain_geometry_ts',
  'file_src_domain_semantic_ts',
  'file_src_domain_task_machine_ts',
  'file_src_domain_task_schema_ts',
  'file_src_domain_validator_ts',
  'file_src_infrastructure_dsl_write_scope_ts',
  'file_src_infrastructure_index_db_ts',
  'file_src_infrastructure_index_index_freshness_ts',
  'file_src_infrastructure_index_schema_ts',
  'file_src_infrastructure_index_symbols_ts',
  'file_src_infrastructure_index_watch_project_ts',
  'file_src_infrastructure_parse_index_ts',
  'file_src_infrastructure_parse_source_exts_ts',
  'file_src_infrastructure_task_history_ts',
  'file_src_presentation_cli_cli_ts',
  'file_src_presentation_http_serve_ts',
  'file_src_presentation_mcp_server_ts',
  'file_src_presentation_mcp_server_registry_ts',
];

const RESP_MOVED: Record<string, { chars: number; sha: string }> = {
  'src/application/design/db/gen_design_db.ts': { chars: 28, sha: 'ac1460277fa80a587cf4d7716b7730bfa4eebde4789eb33eed216e4239a7c313' },
  'src/application/design/intent/judge_cache.ts': { chars: 52, sha: '072516c834c6cfcfb77da25baea9feeae10418e2301a90ff72c75de1c85c5ba3' },
  'src/application/design/line/design_line.ts': { chars: 39, sha: 'd582c0867584c33350c33990de2a9ac415ac80ab5e461ff99e2912d2ba63328f' },
  'src/application/source_writer.ts': { chars: 49, sha: '4c3f4112f3c9feb41891af7b4e0a04a2cb449ab55a43f10d2f531de55c227fee' },
  'src/domain/actor_spec.ts': { chars: 30, sha: 'da9a0dcb0bfc2b924c62480a1feeffd6ac2982ff3294aa85e76d915d6fa62adb' },
  'src/infrastructure/dsl_write_scope.ts': { chars: 36, sha: 'f30f2c549677d89b13f03a214e7d08e764eb725244e7f11b621b4e7273f044c5' },
  'src/infrastructure/task_history.ts': { chars: 51, sha: '58a8157d0227519296a15270068f1839e247593ecc785f3c236dde1c6937cb66' },
};

// ★ 2026-11-18 裁定②（batchassert 诊断）：file_ops.ts / semantic.ts 的 status 是**裸写 base**（无锚点，
//   卡 state=void）⇒ overlay 投影删除属正确行为 —— 期望改 absent；归真走批 16 卡收敛（updateStatus+证据）。
const SEM_STATUS: Record<string, string | null> = {
  'src/application/design/dsl_ops/file_ops.ts': null,
  'src/domain/discussion_log.ts': 'draft',
  'src/domain/semantic.ts': null,
  'src/domain/task_schema.ts': 'done',
  'src/infrastructure/index/watch_project.ts': 'done',
};

const NODE_FIELDS: Record<string, readonly string[]> = {
  'src/application/design/dsl_ops/file_ops.ts': [],
  'src/domain/discussion_log.ts': ['status'],
  'src/domain/semantic.ts': [],
  'src/domain/task_schema.ts': ['status', 'overlay'],
  'src/infrastructure/index/watch_project.ts': ['status', 'overlay'],
  'src/presentation/mcp/server.ts': ['overlay'],
};

const TRANSFERRED: readonly string[] = [
  'src/application/design/dsl_ops/file_ops.ts',
  'src/application/write_gate.ts',
  'src/domain/chain_wiring.ts',
  'src/domain/discussion_log.ts',
  'src/domain/expectation.ts',
  'src/domain/semantic.ts',
  'src/domain/task_schema.ts',
  'src/domain/validator.ts',
  'src/infrastructure/index/symbols.ts',
  'src/presentation/mcp/server.ts',
];

/** 胜方没有 decision ⇒ 败方整份逐字采用（批 6 的形态） */
const ADOPT_WHOLE: Record<string, string> = {
  'src/domain/discussion_log.ts': '2e11a724f420d47b10812cde02d576b1c1536070c98d84822068cccfaa6ff6a3',
};

const CARD_LEAVE: readonly string[] = [
  'src/application/design/db/gen_design_db.ts',
  'src/application/design/dsl_ops/file_ops.ts',
  'src/application/design/dsl_ops/node_ops.ts',
  'src/application/design/dsl_ops/op_data_spec.ts',
  'src/application/design/dsl_ops/task_ops.ts',
  'src/application/design/dsl_ops/update_feature.ts',
  'src/application/design/handlers.ts',
  'src/application/design/index.ts',
  'src/application/design/intent/expectations.ts',
  'src/application/design/intent/judge_cache.ts',
  'src/application/design/line/design_line.ts',
  'src/application/plumbing.ts',
  'src/application/refactor/index.ts',
  'src/application/source_writer.ts',
  'src/application/write_gate.ts',
  'src/domain/actor_spec.ts',
  'src/domain/chain_wiring.ts',
  'src/domain/discussion_log.ts',
  'src/domain/expectation.ts',
  'src/domain/geometry.ts',
  'src/domain/semantic.ts',
  'src/domain/task_machine.ts',
  'src/domain/task_schema.ts',
  'src/domain/validator.ts',
  'src/infrastructure/dsl_write_scope.ts',
  'src/infrastructure/index/db.ts',
  'src/infrastructure/index/index_freshness.ts',
  'src/infrastructure/index/schema.ts',
  'src/infrastructure/index/symbols.ts',
  'src/infrastructure/index/watch_project.ts',
  'src/infrastructure/parse/index.ts',
  'src/infrastructure/parse/source_exts.ts',
  'src/infrastructure/task_history.ts',
  'src/presentation/cli/cli.ts',
  'src/presentation/http/serve.ts',
  'src/presentation/mcp/server.ts',
  'src/presentation/mcp/server_registry.ts',
];

/** 活卡（计划册分区）—— 本批**0 次卡操作**，节点删了卡还在（孤儿卡账归批 16） */
const LIVE_CARDS: readonly string[] = [
  'file_src_application_design_dsl_ops_file_ops_ts:done',
  'file_src_application_design_handlers_ts:candidate',
  'file_src_application_write_gate_ts:claimed',
  'file_src_domain_chain_wiring_ts:candidate',
  'file_src_domain_discussion_log_ts:candidate',
  'file_src_domain_geometry_ts:candidate',
  'file_src_domain_semantic_ts:done',
  'file_src_domain_validator_ts:done',
  'file_src_infrastructure_index_schema_ts:candidate',
  'file_src_presentation_http_serve_ts:candidate',
];

/** 读数（常量算术：只钉"降幅 = 本批 path 数 / 判据数"这类恒等式） */
// ★ 2026-11-18（EEP 真修复链，出处）：826 → **839** —— 19 个被吞 gap 的 triage 给 13 个**活源码**文件补了
//   13 条 file-exists 出处判据（T-#EXCLUDED-EMPTY-PATH 真修复，落库 `c03ac2d8`），**全在属主册 agent-io**
//   （721 → **734**；计划册 98 / 工具面 7 一位没动）。★ 它不是本批"搬"来的（搬数仍恰是 69）⇒ 算术里显式单列，
//   否则就是把"合法新增"记成"我搬的"，下一批再算账永远对不上。
const CRITERIA_TOTAL = 839;
/** ★ 2026-11-18（EEP 真修复链）：triage 给 13 个活源码补的 file-exists 判据条数（见上注；只在算术里出现） */
const CRITERIA_TRIAGE_ADD = 13;
/** 属主册判据：批 10 前 652 + 本批搬来 69 = 721；再加 EEP triage 的 13 ⇒ 真读数 **734** */
const CRITERIA_IN_AI = 721 + CRITERIA_TRIAGE_ADD;
const CRITERIA_IN_TSP = 98;
const CRITERIA_IN_TOOLFACE = 7;
const CRITERIA_MOVED_COUNT = 69;
const MULTI_BEFORE_B10 = 95;
const MULTI_AFTER_B10 = 58;
const ID_DRIFT_BEFORE_B10 = 10;
const ID_DRIFT_AFTER_B10 = 10;
const TSP_OWNS_BEFORE_B10 = 34;
const TSP_OWNS_AFTER_B10 = 24;
const DELETED_NODES = 37;
const DELETED_SEMANTICS = 37;
const DELETED_EDGES = 111;
const TSP_NODES_AFTER_B10 = 176;
const TSP_SEMANTIC_AFTER_B10 = 70;
const ARCHIVE_PATHS = 35;
const ARCHIVE_VALUES = 138;
/** ★ 2026-11-18（读数修正）：存档事件 body 里的**批次标**。台账行 `T-#A8A9-CROSS-BOOK` 是**多批共用**的，
 *  按批次过滤才等于「本批 35 条」（批 11 后来往同一行又挂了自己的一条 —— 见 10.9 里的病灶注）。 */
const ARCHIVE_BATCH = 'A8A9-batch10';
const BEFORE_CRITERIA_AI = 652;
const BEFORE_CRITERIA_TSP = 167;
const BEFORE_NODES_TSP = 213;
const BEFORE_SEM_TSP = 107;
const BEFORE_EDGES_TSP = 395;
/**
 * path 分母的**棘轮下限**（只许不降；不是“精确值”）。
 * ★ 2026-11-18（T-#EXCLUDED-EMPTY-PATH 链，出处）：555 → **568** —— 13 个活源码**合法入仓**
 *   （`criteria_worker`.ts ×3 / `review_gate.ts` / `parser_presence.ts` …，就是上面 `CRITERIA_TRIAGE_ADD`
 *   那 13 条判据的宿主）⇒ 持有 path 的分母按定义 +13。与本批无关：本批删的是**非属主侧**节点，
 *   属主册仍持有 ⇒ 并集不变（这正是原断言「分母不该被删节点改动」的本意）。
 * ★ 为什么从「精确 555」改成 floor（批 4 裁定：**钉结构不钉绝对值**）：精确钉把**合法增仓**也一起判红
 *   （本次就是：13 个新源码入册）。分母的语义是"持有面被谁动过、变化要有出处"。反向钉法照样有牙：
 *   **低于它 = 有节点的 path 被删 / 被收走而没人登记** ⇒ 红；往上 = 合法新增，不拦。
 */
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const shaOfJson = (v: unknown) => createHash('sha256').update(JSON.stringify(v), 'utf-8').digest('hex');
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

function repoSheets(): Array<BookSheetLike & { feature: string }> {
  return readDesignSheetsForGate(REPO).sheets as unknown as Array<BookSheetLike & { feature: string }>;
}
function bookOf(feature: string): BookSheetLike & { feature: string } {
  const s = repoSheets().find((x) => x.feature === feature);
  assert.ok(s, `真仓必须有 ${feature} 册（读数不许靠猜）`);
  return s;
}
/** ★ 直接读册文件（不经 hydration）：sha256 比的是**盘上那份的字节形状** */
function rawBook(feature: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(REPO, '.agent-io', 'design', `${feature}.dsl.json`), 'utf8')) as Record<string, unknown>;
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
/** 测试自己的解析器（**不 import 执行器**）：把 body 里的 base64 payload 解出来 */
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

// ════════════════════════════════════════════════════════════════════
// 10.1 / 10.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('10.1 真仓：37 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数逐条对表', () => {
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

test('10.1b 计划册里这 37 个 path 的节点 / 语义 / 边都不在了；37 个被删节点 id 在任何册里都不再出现', () => {
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
  // 本批删的 37 个 id 全是 nodeIdOf 单点派生 ⇒ 删它们不产生"漂移数下降"的假象
  const driftAmongDeleted = DELETED_IDS.filter((id) => {
    const p = BATCH.find((x) => nodeIdOf(x) === id);
    return !p;
  });
  assert.deepEqual(driftAmongDeleted, [], '被删的 id 必须逐条等于 nodeIdOf(某条本批 path) —— 一个漂移旧 id 都没有（这是与批 9 的不同点）');
});

// ════════════════════════════════════════════════════════════════════
// 10.2 清单形状
// ════════════════════════════════════════════════════════════════════
test('10.2 清单形状：名单 38 − 缓 1 = 本批 37 · 码位序 · 四张表与清单逐条同集', () => {
  assert.equal(PROSE_KEEP_OWNER.length, 38, `裁定甲′ 的名单是 38 条（实测 ${PROSE_KEEP_OWNER.length}）`);
  assert.deepEqual([...PROSE_KEEP_OWNER].sort(), [...PROSE_KEEP_OWNER], '名单必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.equal(ASSERTION_DEFERRED.length, 1, '缓名单 1 条（query_feature.ts 与 pool.ts 的断言级绑定）');
  assert.deepEqual(BATCH, PROSE_KEEP_OWNER.filter((p) => !ASSERTION_DEFERRED.includes(p)), '本批 = 名单 − 缓（逐条同集、同序）');
  assert.equal(BATCH.length, 37, `本批 37 条（实测 ${BATCH.length}）`);
  assert.deepEqual([...BATCH].sort(), BATCH, '本批必须按码位序');
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  for (const p of ASSERTION_DEFERRED) assert.ok(!BATCH.includes(p), `缓收的 \`${p}\` 不许在本批里`);

  const tablePaths = [...Object.keys(CRITERIA_MOVED), ...Object.keys(CRITERIA_OWNED)].sort();
  assert.deepEqual(tablePaths, [...BATCH].sort(), '两张判据表必须与清单**逐条同集**（搬的 9 + 本来就在的 28 = 37）');
  assert.equal(Object.keys(CRITERIA_MOVED).length, 9, '搬判据的 9 条');
  assert.equal(Object.keys(CRITERIA_OWNED).length, 28, '判据本来就在属主册的 28 条');
  assert.deepEqual([...Object.keys(ARCHIVE)].sort(), [...Object.keys(ARCHIVE)].filter((p) => BATCH.includes(p)).sort(), '存档表只能覆盖本批 path');
  assert.equal(Object.keys(ARCHIVE).length, ARCHIVE_PATHS, `有败方原文被顶掉的 path 必须是 ${ARCHIVE_PATHS} 条`);
  assert.equal(Object.values(ARCHIVE).reduce((s, x) => s + Object.keys(x.values).length, 0), ARCHIVE_VALUES, `存档值总数必须是 ${ARCHIVE_VALUES}`);
  assert.deepEqual([...CARD_LEAVE].sort(), [...BATCH].sort(), '带卡留账必须是**全批 37 条**（一条 path 一张卡都没少）');
  assert.equal(LIVE_CARDS.length, 10, '计划册分区里的活卡 10 张（本批 0 次卡操作）');
  assert.deepEqual([...TRANSFERRED].sort(), [...Object.keys(CRITERIA_MOVED), 'src/domain/discussion_log.ts'].sort(), '改判的 10 条必须 = 搬判据的 9 条 + discussion_log（A 类空壳，0 判据但属主换手）');
});

// ════════════════════════════════════════════════════════════════════
// 10.3 判据逐字节 + 守恒 / 10.3b 有牙
// ════════════════════════════════════════════════════════════════════
test('10.3 判据**逐字节**：搬的 69 条 sha256 相同；本来就在属主册的 192 条一位没动；总数守恒 839', () => {
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
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 839（实测 ${per}）`);
  // ★ 2026-11-18（批 11 棘轮化）：分册读数**只许朝迁移方向走** —— 批 10 收口那一刻是 **734 / 98**（含 EEP triage 13），
  //   批 11 又搬了 32 条 ⇒ 现在是 766 / 66。把"批 10 那一刻的数"钉死，正是批 3 §3.2 明令禁止的形态
  //   （任何后续批次都会把它撞红，而撞红的理由与批 10 无关）；守恒仍由最后三行**精确**保证。
  assert.ok(criteriaOf(bookOf(AI)) >= CRITERIA_IN_AI, `agent-io 册判据只许增（批 10 收口 ${CRITERIA_IN_AI}；实测 ${criteriaOf(bookOf(AI))}）`);
  assert.ok(criteriaOf(bookOf(TSP)) <= CRITERIA_IN_TSP, `计划册判据只许减（批 10 收口 ${CRITERIA_IN_TSP}；实测 ${criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf('agent-io-toolface')), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  const movedSum = Object.values(CRITERIA_MOVED).reduce((s, x) => s + x.crit, 0);
  assert.equal(movedSum, CRITERIA_MOVED_COUNT, `搬的判据条数必须是 ${CRITERIA_MOVED_COUNT}（实测 ${movedSum}）`);
  assert.ok(
    criteriaOf(bookOf(AI)) - BEFORE_CRITERIA_AI >= movedSum + CRITERIA_TRIAGE_ADD,
    `属主册涨幅不许小于"本批搬来的 ${movedSum} + EEP triage ${CRITERIA_TRIAGE_ADD}"（后续批只许再往上加；这两项必须分开记，不许并进搬数）`,
  );
  assert.ok(BEFORE_CRITERIA_TSP - criteriaOf(bookOf(TSP)) >= movedSum, '计划册降幅不许小于搬走的条数（triage 不碰计划册，后续批只许再减）');
  assert.equal(criteriaOf(bookOf(AI)) + criteriaOf(bookOf(TSP)) + CRITERIA_IN_TOOLFACE, CRITERIA_TOTAL, '守恒是**算术**，不是"看起来差不多"');
});

test('10.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 839，差额恰是该节点的判据数', () => {
  const sheets = repoSheets();
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的读数是 839');
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
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 10.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 10.4 甲′ 散文（胜方原文不动 / 败方独有键搬过来）/ 10.4b 有牙
// ════════════════════════════════════════════════════════════════════
/**
 * ★ 2026-11-18（**诊断存档** —— 本条**不改表**、不放宽；红就让它红，等着裁）：
 *   10.4 现在红在哪：`src/application/design/dsl_ops/file_ops.ts` 与 `src/domain/semantic.ts` 的
 *   `semantic.status` **和** `node.status` 都没了（batch 10 收口时是 `done`）。
 *
 *   ## 机制（实测复现，不是推测）
 *   base 上的 `status` 是 `domain/overlay.ts#applyOverlay` 的**投影**，派生顺序见 `overlay.ts:579-585`
 *   / `600-611`：**有卡（`node.task` / `todos[]` 指向它）⇒ 卡片派生值压过一切**，`void` ⇒ 无值 ⇒
 *   `delete merged.status`。这两个节点的卡正是 `state:'void'`（【L1 待建构】）⇒ 任何一次 `edit_dsl`
 *   落盘的重投影都会把 base 上那条 `done` 删掉。
 *   · 触发时刻：2026-11-18T14:54:02 那次册写（`_sync.via = 'edit_dsl:edit_dsl'`，与 EEP triage 同一次落盘）；
 *   · 同一次落盘还**补**了一条投影：`src/infrastructure/analysis/observe/go_instrument.ts` 的
 *     `semantic.status ← done`（它自己的锚点 `progress=done`，之前只是没有投影过去）—— 同样是投影的正常结果；
 *   · 排除过的替代解释：`saveDSL` 读→写往返**不丢** status（探针：157 条一条不少）；
 *     把两条 base `status` 手写补回去再跑一次**纯投影** `applyOverlay(base, overlay)` ⇒ 立刻又被删（探针复现）。
 *
 *   ## 结论（要裁，不是我能裁的）
 *   **不是读法问题，也不是"谁把册改坏了"** —— 是「批 10 写进 base 的快照」与「卡片权威」的**矛盾**被
 *   一次投影曝光了：批 10 的甲′「`semantic.status` 5 条随迁」里有 **2 条是裸写 base**（那两条没有 overlay 锚点，
 *   卡也没对齐），`file_ops.ts` 源码里 T328 的注释就写着这件事会发生（"裸写 base 会在 rebuild 时被冲掉"）。
 *   ⇒ 两条出路，都属**裁定/数据动作**，都不在测试里偷偷做：
 *     ① 认定"这两个文件就是 done" ⇒ 把卡补齐（走 `updateStatus` + 证据闸）⇒ 投影会**稳定**产 `done`，本条自绿；
 *     ② 认定卡（`void`）是真相 ⇒ 批 10 的「状态 5（≡3 持久 + 2 裸写：void 卡投影删 status 属正确行为，批 16 卡收敛归真——2026-11-18 lead 裁定②） 条」需要修订成"3 条持久 + 2 条裸写"，那是批 10 的账。
 *   ★ 本条**不许**改成"投影说啥算啥"：那等于把「属主侧原文一个字节不动」降级，也等于把两条 `void` 卡当真。
 */
test('10.4 甲′：两侧同键不同值时**属主侧原文一个字节不动**；属主侧空白的键搬过来；职责 7 · 状态 5 · 节点字段 6', () => {
  const aiNodes = rawNodes(AI);
  const aiSems = rawSems(AI);
  let keeperKeys = 0;
  for (const [p, keys] of Object.entries(KEEPER_KEPT)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n?.decision, `\`${p}\` 的 decision 必须在属主册（否则谈不到"胜方保留"）`);
    for (const [k, want] of Object.entries(keys)) {
      const now = shaOfJson(n.decision[k]);
      assert.equal(now, want, `\`${p}\` 的 \`${k}\` 被改了 —— 甲′ 是"属主侧为准"（保留原文），不是"按败方重写"`);
      keeperKeys += 1;
    }
  }
  assert.equal(keeperKeys, Object.values(KEEPER_KEPT).reduce((s, x) => s + Object.keys(x).length, 0), '逐键核过的条数必须对得上表');
  for (const [p, keys] of Object.entries(MOVED_PROSE)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n?.decision, `\`${p}\` 的 decision 必须存在`);
    for (const [k, want] of Object.entries(keys)) {
      assert.ok(n.decision[k] !== undefined, `\`${p}\` 的 \`${k}\` 只在败方有 ⇒ 必须**搬**过来（不是丢）`);
      assert.equal(shaOfJson(n.decision[k]), want, `\`${p}\` 的 \`${k}\` 搬运不是逐字节的`);
    }
  }
  for (const [p, want] of Object.entries(RESP_MOVED)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.ok(String(s?.responsibility ?? '').trim(), `\`${p}\` 的职责文本丢了（删它 = 让叙事蒸发）`);
    assert.equal(createHash('sha256').update(String(s?.responsibility), 'utf8').digest('hex'), want.sha, `\`${p}\` 的职责文本被改过`);
    assert.equal(String(s?.responsibility).trim().length, want.chars, `\`${p}\` 的职责字数必须仍是 ${want.chars}`);
  }
  for (const [p, want] of Object.entries(SEM_STATUS)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.equal(String(s?.status ?? '') || null, want, `\`${p}\` 的 semantic.status 必须随迁为 ${want}`);
  }
  for (const [p, fields] of Object.entries(NODE_FIELDS)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    for (const f of fields) assert.ok(n?.[f] !== undefined, `\`${p}\` 的节点字段 ${f} 必须随迁（属主侧空白才搬）`);
  }
  // 整份采用的那 1 条（胜方没有 decision ⇒ 败方整份逐字搬过来）
  const whole = rawNodes(AI).find((x) => norm(x.path) === 'src/domain/discussion_log.ts');
  assert.ok(whole?.decision, 'discussion_log.ts 的整份 decision 必须落在属主册');
  assert.equal(shaOfJson(whole.decision), ADOPT_WHOLE['src/domain/discussion_log.ts'], '整份 decision 必须是**逐字**采用');
  assert.ok(!rawNodes(TSP).some((x) => norm(x.path) === 'src/domain/discussion_log.ts'), '计划册侧节点必须已删');
});

test('10.4b 上一条**有牙**：给胜方任一键改一个字节 / 把胜方原文换成败方口径 ⇒ 指纹立刻变（纯计算，不碰真册）', () => {
  const [p0, keys0] = Object.entries(KEEPER_KEPT)[0] as [string, Record<string, string>];
  const [k0, want0] = Object.entries(keys0)[0] as [string, string];
  const node = rawNodes(AI).find((x) => norm(x.path) === p0);
  const val = node?.decision?.[k0];
  assert.equal(shaOfJson(val), want0, '前提：不改动时指纹一致');
  assert.notEqual(shaOfJson(`${String(val)} `), want0, '加一个空格也必须让指纹变（逐字节 = 逐字节）');
  assert.notEqual(shaOfJson(''), want0, '清空该键必须让指纹变');
  assert.notEqual(shaOfJson({ replaced: true }), want0, '换成别的叙事必须让指纹变 —— 否则 10.4 是空断言');
});

// ════════════════════════════════════════════════════════════════════
// 10.5 域表收窄
// ════════════════════════════════════════════════════════════════════
test('10.5 域表**收窄**：37 条属主 = agent-io；计划册 owns 34 → 24；前缀仍在（不是"掉成无人认领"）', () => {
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
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER_B10, `计划册 owns 只许不增（批 10 收口 ${TSP_OWNS_AFTER_B10}；实测 ${tspOwns.length}）`);
  assert.equal(TSP_OWNS_BEFORE_B10 - TSP_OWNS_AFTER_B10, TRANSFERRED.length, '降幅必须恰等于改判条数（常量算术）');
  for (const pre of ['src/', 'scripts/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  // ★ 2026-11-18（批 11 棘轮化）：上一行已钉"只许不增"（批 11 又摘 11 条 ⇒ 24 → 13）；这里再钉**不许被清空**。
  //   两边的牙都留着：涨一条红（往上）、清空红（往下到底）。
  // ★ 2026-11-18（批 14 · D2 终局）：计划册 owns 已被清空（2 → 0）⇒ "不许被清空"这条历史约束退役。
  //   清空之后这条要断的是**清空有账**：批 14 的门档 why 必须点名它的来路（不是悄悄删空）。
  if (tspOwns.length === 0) {
    const baseline14 = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
    assert.ok(String(baseline14.multi_owned.why ?? '').includes('批 14（D2 终局'), '计划册 owns 清空必须由批 14 的账背书（门档 why 点名）');
  } else {
    assert.ok(tspOwns.length > 0, `计划册 owns 不许被清空（本批只摘改判条目；实测 ${tspOwns.length}）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 10.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('10.6 ② 档：这 37 条 klass = owned；塞回任一条 ⇒ 立刻 multi_owned（鉴别力）；path 分母只许不降（floor 568）', () => {
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
  // ★ 棘轮（不是精确值，见 `PATHS_FLOOR` 的出处注释）：低于 floor ⇒ 有人删了节点 / 收走了 path 却没登记。
  assert.ok(now.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR}；实测 ${now.paths}）—— 掉下去 = 有节点被删/有 path 被收走而没人登记`);
  // ★ 结构侧的第二道钉（分母的**分区闭合**：六档相加必须 = 分母本身）—— 即使分母一起被算错也红。
  const c = now.counts;
  assert.equal(
    c.owned + c.multi_owned + c.owner_mismatch + c.unowned_but_held + c.undeclared + c.owner_ambiguous + c.unjudged,
    now.paths,
    `六档必须分区闭合（owned+multi+错位+unowned+未声明+歧义+判不了 = 分母）：${JSON.stringify(c)} / ${now.paths}`,
  );
  assert.equal(now.books, 3, `册数不变（实测 ${now.books}）`);
  const p0 = BATCH.find((p) => p.startsWith('src/domain/')) as string;
  const world2 = sheets.map((s) =>
    s.feature === TSP
      ? ({ feature: s.feature, geometry: { nodes: [...nodesOf(s), { id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }] } } as unknown as BookSheetLike & { feature: string })
      : s,
  );
  const two = crossBookOwnership(world2, read);
  assert.equal(two.rows.find((r) => r.path === p0)?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
});

// ════════════════════════════════════════════════════════════════════
// 10.7 写端
// ════════════════════════════════════════════════════════════════════
test('10.7 写端：批 10 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 10 的删除是可逆的）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as { geometry: { nodes: Array<Record<string, unknown>> }; semantic?: unknown };
    ai.geometry.nodes[0]!.decision = { summary: '属主册写判据必须放行', expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '消融：属主册写自己的 path' }] };
    ai.semantic = { files: [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts', responsibility: '属主册写自己的 path 必须放行', status: 'done' }] };
    saveDSL(ai as unknown as Parameters<typeof saveDSL>[0], 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8')) as { geometry: { nodes: Array<{ decision?: { expectations?: unknown[] } }> }; semantic: { files: Array<{ responsibility?: string; status?: string }> } };
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
// 10.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('10.8 门档：多册持有 ≤ 58（95 − 37）· id 漂移 ≤ 10 · 属主错位 ≤ 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(now.multi_owned.length <= MULTI_AFTER_B10, `多册持有只许不增（批 10 收口 ${MULTI_AFTER_B10}；实测 ${now.multi_owned.length}）`);
  assert.equal(MULTI_BEFORE_B10 - MULTI_AFTER_B10, BATCH.length, '批 10 的降幅必须逐字等于本批 path 数');
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER_B10, `id 漂移只许不增（批 10 收口 ${ID_DRIFT_AFTER_B10}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE_B10, ID_DRIFT_AFTER_B10, '本批删的全是单点派生 id ⇒ 漂移一条不该变（与批 9 的"降 14"不同）');
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
// 10.9 败方原文存档（台账读回）/ 10.9b 机制可移植
// ════════════════════════════════════════════════════════════════════
test('10.9 **败方原文存档**：35 条 path / 138 个值的 payload 逐字可读回（`annotateRow` 挂在 T-#A8A9-CROSS-BOOK）', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆 / 首次检出）⇒ 台账存档不在版本库里，读不回；机制由 10.9b 钉住');
    return;
  }
  const row = getRow(REPO, LEDGER_REF);
  if (!row) {
    t.skip(`台账里没有 \`${LEDGER_REF}\` 这一行（本机台账未导入）⇒ 读不回`);
    return;
  }
  /**
   * ★ 2026-11-18（读数修正 —— 修的是**读法**，不是放宽语义）：本条钉的是「**批 10** 的 35 条败方原文存档」，
   *   所以必须**按批次过滤**，不能"凡是这个 body 前缀就数进来"。
   *   实测病灶：`T-#A8A9-CROSS-BOOK` 是**多批共用的一行**；批 11 后来往同一行挂了自己的一条存档
   *   （`by=a8a9-b11-annotate` / `at=2026-11-18T07:03:53Z` / path `src/application/meta/explore/query_feature.ts`，
   *   body 头写的是「批 11 … A8A9-batch11」）⇒ 旧读法把 36 读成"存档多了 1 条"，而批 10 的 35 条**一条没少**
   *   （35 条 path 全在、payload sha 全对、键集全对 —— 这些断言都在下面，一条没删）。
   *   ★ 同时**加一道**：别批次的存档事件必须标着**别的**批次（挂错批次 / 少算本批 ⇒ 红）。
   */
  const archiveEvents = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  const events = archiveEvents.filter((e) => String(e.body).includes(ARCHIVE_BATCH));
  for (const e of archiveEvents.filter((x) => !String(x.body).includes(ARCHIVE_BATCH))) {
    const other = parseArchive(String(e.body));
    assert.ok(other, `id=${e.id} 的存档事件 body 解析不了（格式契约被改了）`);
    assert.notEqual(
      (other!.payload as { batch?: string }).batch,
      ARCHIVE_BATCH,
      `id=${e.id} 的存档事件标着本批 \`${ARCHIVE_BATCH}\` 却没进本批计数 —— 那是"少算本批"，不是"别的批次"`,
    );
  }
  const byPath = new Map<string, { body: string; parsed: ReturnType<typeof parseArchive> }>();
  for (const e of events) {
    const parsed = parseArchive(String(e.body));
    assert.ok(parsed, `存档事件 id=${e.id} 的 body 解析不了（格式契约被改了）`);
    const p = String((parsed.payload as { path?: string }).path ?? '');
    assert.ok(!byPath.has(p), `\`${p}\` 在台账里出现了两次存档（重复挂账）`);
    byPath.set(p, { body: String(e.body), parsed });
  }
  assert.equal(events.length, ARCHIVE_PATHS, `存档事件必须恰好 ${ARCHIVE_PATHS} 条（实测 ${events.length}）`);
  for (const [p, want] of Object.entries(ARCHIVE)) {
    const hit = byPath.get(p);
    assert.ok(hit, `\`${p}\` 的败方原文必须在台账里可查（视图里丢了，真相里不许丢）`);
    assert.equal(hit.parsed!.payloadSha, want.payload, `\`${p}\` 的 payload sha256 不符`);
    const dropped = (hit.parsed!.payload as { dropped?: Record<string, unknown> }).dropped ?? {};
    assert.deepEqual(Object.keys(dropped).sort(), Object.keys(want.values).sort(), `\`${p}\` 的存档键集不符`);
    for (const [k, vsha] of Object.entries(want.values)) {
      assert.equal(shaOfJson(dropped[k]), vsha, `\`${p}\` 的存档值 \`${k}\` 不是逐字的（sha 变了）`);
    }
    const payload = hit.parsed!.payload as { batch?: string; ref?: string; loser?: { book?: string }; keeper?: { book?: string } };
    assert.equal(payload.batch, ARCHIVE_BATCH, `\`${p}\` 的存档必须标着批次（否则下次分不清是谁的账）`);
    assert.equal(payload.ref, LEDGER_REF, `\`${p}\` 的存档必须挂在 ${LEDGER_REF} 上`);
    assert.equal(payload.loser?.book, TSP, '败方必须是计划册');
    assert.equal(payload.keeper?.book, AI, '胜方必须是属主册');
    // 人读段必须**逐字**含原文（不是只存了个指纹）
    for (const k of Object.keys(want.values)) {
      const v = dropped[k];
      const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      assert.ok(hit.body.includes(text), `\`${p}\` 的人读段里找不到 \`${k}\` 的原文 —— "逐字存档"退化成"只存指纹"`);
    }
  }
  // 视图里丢 = 这些值确实不在册上了（否则这条其实是"什么都没做"）
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

test('10.9b 上一条**可移植**：夹具里 hangRow + annotateRow 往返，同一份 body 格式逐字读回（不依赖本机 tasks.db）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
    hangRow(proj, { refId: 'T-#FIXTURE-B10', section: 'fixture', title: '批 10 存档往返夹具', by: 'test' });
    // ★ body 自己拼（与执行器同格式）：原文含换行 / 引号 / 中文，专门试"逐字"
    const payload = {
      batch: 'A8A9-batch10',
      ref: 'T-#FIXTURE-B10',
      path: 'src/domain/fixture.ts',
      loser: { book: 'task-system-plan', node_id: 'file_src_domain_fixture_ts' },
      keeper: { book: 'agent-io', node_id: 'file_src_domain_fixture_ts' },
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
      '批 10（甲′：散文口径 = 属主侧为准 + 败方原文逐字存档）· T-#FIXTURE-B10 · A8A9-batch10',
      'path: src/domain/fixture.ts',
      '',
      '── 败方原文（逐字）──',
      '[decision.summary]',
      String(payload.dropped['decision.summary']),
      '',
      PAYLOAD_END,
      b64,
      `sha256(payload)= ${createHash('sha256').update(json, 'utf8').digest('hex')}`,
    ].join('\n');
    annotateRow(proj, 'T-#FIXTURE-B10', body, 'test');
    const row = getRow(proj, 'T-#FIXTURE-B10');
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
// 10.10 界外账
// ════════════════════════════════════════════════════════════════════
test('10.10 **界外账**：断言级绑定的 2 条 / D2 2 条 / 无冲突 C 类**仍是两册持有**，判据仍在原来那一侧', () => {
  const read = crossBookReadingOf(REPO);
  const multi = new Set(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path));
  // ★ 2026-11-18（批 11 棘轮化）：`pool.ts` + `query_feature.ts`（断言级绑定）已由批 11 **并批收走**
  //   ⇒ 它们从"界外"挪到"已收"；界外只剩 D2 那 2 条（真正的两侧皆有判据，批 13 的账）。
  //   两边都留牙：界外被"顺手收了" ⇒ 下面的 `multi.has` 红；"收"退化成"删" ⇒ 9.10 的单册断言红。
  const mustStay = ['src/infrastructure/parse/kernel.ts', 'src/infrastructure/storage.ts'];
  assert.equal(mustStay.length, 2, '界外锚点 2 条（都是 D2：两侧都带判据）');
  // ★ 2026-11-18（批 14 · D2 终局）：这 2 条已被本卡收口（判据并集 + 散文存档 + 计划册节点删）
  //   ⇒ 它们**不再**两册持有。界外账改判成"收 ≠ 删"：单册 = 属主册，判据在属主册。
  for (const p of mustStay) {
    assert.ok(!BATCH.includes(p), `\`${p}\` 不该在本批清单里`);
    assert.ok(!multi.has(p), `\`${p}\` 已由批 14 收口 ⇒ 不该仍在多册持有集合里（界外 ≠ 已处理）`);
    assert.equal(rawNodes(TSP).filter((x) => norm(x.path) === p).length, 0, `\`${p}\` 的计划册侧节点必须已由批 14 删掉`);
    const nAi = rawNodes(AI).find((x) => norm(x.path) === p);
    assert.ok(nAi && (nAi.decision?.expectations ?? []).length > 0, `\`${p}\` 的判据必须在属主册（收 ≠ 删）`);
  }
  const tspNodes = rawNodes(TSP);
  for (const p of ['src/application/design/board/pool.ts', ...ASSERTION_DEFERRED]) {
    assert.equal(tspNodes.filter((x) => norm(x.path) === p).length, 0, `\`${p}\` 的计划册侧节点已由批 11 收走`);
  }
  // 无冲突 C 类余量：多册持有集合只许**更少**（批 11/12/13 逐批收走：28 + 17 + 11 ⇒ 余量 21 + 28 → 2）。
  // ★ 批 13 棘轮（2026-11-18）：原先这里钉的是 `≥ 界外那批`（= 余量不许缩）。后续批按计划收走它们
  //   ⇒ 那条下界会把**合法的收口**判成红（把账本倒着锁）。改成上界 + "D2 两条仍在"两条：
  //   上界防"多册变多"，`mustStay` 防"把界外锚点顺手收了"（D2 的账在 14 批）。
  assert.ok(multi.size <= MULTI_AFTER_B10 - 21 - 28, `多册持有只许少（批 10 收口 ${MULTI_AFTER_B10} − 21 − 28 = ${MULTI_AFTER_B10 - 21 - 28}；实测 ${multi.size}）`);
  assert.ok(multi.size <= MULTI_AFTER_B10, `批 10 收口时是 ${MULTI_AFTER_B10}，后续批只许更少（实测 ${multi.size}）`);
});

// ════════════════════════════════════════════════════════════════════
// 10.11 卡账
// ════════════════════════════════════════════════════════════════════
test('10.11 **卡账**：37 个带卡 path 的册上投影随节点消失；计划册分区 10 张活卡一个字节没动（0 次卡操作）', () => {
  assert.equal(CARD_LEAVE.length, BATCH.length, '带卡留账必须覆盖全批（一个 path 的卡都没被"顺手处理"）');
  // 册上投影：删掉的计划册节点不许还在册里
  const tspIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  for (const id of DELETED_IDS) assert.ok(!tspIds.has(id), `册上节点 \`${id}\` 必须已删`);
  // 活卡：本机台账里有卡才核（干净克隆没有 tasks.db）
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  for (const p of CARD_LEAVE) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着带卡留账 \`${p}\``);
  }
  const cards = listLiveCards(REPO, TSP);
  if (cards.length === 0) return; // 干净克隆：卡的家不在版本库里
  const byId = new Map(cards.map((c) => [String(c.id), c]));
  for (const spec of LIVE_CARDS) {
    const [id, state] = [spec.slice(0, spec.lastIndexOf(':')), spec.slice(spec.lastIndexOf(':') + 1)];
    const card = byId.get(id);
    assert.ok(card, `活卡 \`${id}\` 必须仍在计划册分区（卡的家在 tasks.db，本批一个字节没动）`);
    assert.equal(String(card.state), state, `活卡 \`${id}\` 的 state 被动了（本批 0 次卡操作）`);
  }
  // 计划册侧的"节点已删、卡还在"必须显式记账（孤儿卡 → 批 16）
  const orphan = LIVE_CARDS.filter((spec) => !tspIds.has(spec.slice(0, spec.lastIndexOf(':'))));
  assert.equal(orphan.length, LIVE_CARDS.length, '10 张活卡的节点**全部**已删 ⇒ 它们是孤儿卡（门档 why 里写明了归批 16）');
});

// 计划册节点数 / 语义数 / 边数：删掉的必须是 37 + 37 + DELETED_EDGES（一个不多一个不少）
test('10.12 计划册册容：节点 213 → 176 · 语义 107 → 70 · 边 395 → 284（删的数目对得上）', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER_B10, '计划册节点数：213 − 37 = 176');
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER_B10, '计划册节点数：213 − 37 = 176');
  // ★ 2026-11-18（批 11 棘轮化）：批 11 又删了 28 个计划册节点（176 → 148）/ 28 语义 / 58 边
  //   ⇒ 读数改成"≤ 批 10 收口值"（棘轮只许减），算术恒等式只对**批 10 那一段**成立。
  assert.ok(rawNodes(TSP).length <= TSP_NODES_AFTER_B10, `计划册节点数只许减（批 10 收口 ${TSP_NODES_AFTER_B10}；实测 ${rawNodes(TSP).length}）`);
  assert.ok(rawSems(TSP).length <= TSP_SEMANTIC_AFTER_B10, `计划册语义条目数只许减（批 10 收口 ${TSP_SEMANTIC_AFTER_B10}；实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.ok(edgesNow <= BEFORE_EDGES_TSP - DELETED_EDGES, `计划册边数只许减（批 10 收口 ${BEFORE_EDGES_TSP - DELETED_EDGES}；实测 ${edgesNow}）`);
  // ★ 与"只许减"配一条有牙的：删掉的节点 id 一个都不许再出现（半删在这里红）
  const tspIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  for (const id of DELETED_IDS) assert.ok(!tspIds.has(id), `册上节点 \`${id}\` 必须已删`);
});
