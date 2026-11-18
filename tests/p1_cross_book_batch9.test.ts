/**
 * P1 · T-#A8A9-CROSS-BOOK **批 9**（C 类**判据单边**第一段 37 条：24 条"判据搬进属主册后删计划册侧"
 * + 13 条"判据本来就在属主册、只删计划册侧空载节点"）—— 红 → 绿。
 *
 * ## 这批要立的十三条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 9.1 | 37 个 path **各恰一册**持有且是 `agent-io`；节点 id 仍由 `nodeIdOf` 单点派生；判据条数逐条对表 | 搬后没删 / 删错册 / 判据丢条在这里红 |
 * | 9.1b | 计划册侧**三清**（节点 + 语义 + 边）；14 个漂移旧 id 在任何册里都不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 9.2 | 清单形状：37 条 · **码位序**（`sort()`）· 段位 14/9/14 · 两张判据表与清单逐条同集 | 手抄错一条 / 顺序漂了在这里红 |
 * | 9.3 | 判据**逐字节**：搬的 23 条 sha256 相同；本来就在属主册的 14 条**一位没动**；总数守恒 **826**（652 / 167 / 7） | 搬歪 / 重写 / 顺手改判据在这里红 |
 * | 9.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 826，差额恰是那个节点的判据数 | 空断言的照妖镜（R47） |
 * | 9.4 | 散文搬运：整份 `decision` 23 条 sha256 相同 · `responsibility` 19 条 sha256 + 字数 · `semantic.status` 7 条 · 节点 `status`/`overlay` 7 条 | 只搬判据、把叙事蒸发在这里红 |
 * | 9.4b | 上一条**有牙**：清空一处职责 / 改一个字节 / 动一下 decision ⇒ 指纹立刻变（纯核，不碰真册） | 同上 |
 * | 9.5 | 域表**收窄**：37 条属主 = `agent-io`；计划册 `owns[]` 43 → 34（摘掉 9 条精确条目）；`src/` `scripts/` `observe-lang-* 目录` 前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 9.6 | ② 档：这 37 条 klass = `owned`；塞回任一条 ⇒ 立刻 `multi_owned`（鉴别力）；path 分母仍是 555 | 纯核两世界对照，不碰真册 |
 * | 9.7 | 写端：批 9 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化）；属主册写同一 path ⇒ 过 | 属主册自己写被连带拒 = 一刀切，也在这里红 |
 * | 9.8 | 门档：多册持有 ≤ **95**（132 − 37）、id 漂移 ≤ **10**（24 − 14）、属主错位 ≤ 12；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红（钉棘轮，不钉"当前值 = 95"） |
 * | 9.9 | **带卡留账 15 条**（卡一个字节没动：本批 0 次卡操作）；门档 `why` 逐条点着名字 | 悄悄把卡删了、或悄悄把人家的 path 收了，都在这里红 |
 * | 9.10 | **界外账**：39 条界外（36 条散文/状态/节点字段冲突 + 2 条 A 类带卡空壳 + 1 条断言级冲突 `pool.ts`）**仍是两册持有**，一条没被半搬 | 界外被"顺手收了"在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–8 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 37 个 path 恰一册持有"·"判据总数守恒 826"·"判据/散文逐字节"）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 0"（那是批 13 之后的终局）；
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数 / 判据数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ 每一条"有牙"的反检查（9.3b / 9.4b）都跑在**纯核副本**上：真册一个字节都不动。
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

// ─── 常量块（由 %TEMP%\a8a9-b9-genconsts.mjs 现盘导出；这批的钉子） ───────────────
const BATCH: readonly string[] = [
  'observe-lang-go/cmd/instrument/main.go',
  'observe-lang-go/cmd/observev2-demo/main.go',
  'observe-lang-go/cmd/observev2-record/main.go',
  'observe-lang-go/internal/instrument/contract.go',
  'observe-lang-go/internal/instrument/effects.go',
  'observe-lang-go/internal/instrument/instrument.go',
  'observe-lang-go/probe/export.go',
  'observe-lang-go/probe/global.go',
  'observe-lang-go/probe/probe.go',
  'observe-lang-go/probe/run_recorder.go',
  'observe-lang-go/probe/tiered.go',
  'observe-lang-go/probe/trace.go',
  'observe-lang-java/observe/probe/Camprobe.java',
  'observe-lang-py/camprobe.py',
  'scripts/clean_dist.mjs',
  'scripts/gen-db-check.mjs',
  'scripts/gen_manifest.mjs',
  'scripts/hook-task-gate.mjs',
  'scripts/impl-mutate.mjs',
  'scripts/install_mcp.mjs',
  'scripts/mutate.mjs',
  'scripts/verify-changed.mjs',
  'scripts/verify.mjs',
  'src/application/claim_conflict.ts',
  'src/application/cross/index.ts',
  'src/application/design/api_signature.ts',
  'src/application/design/derive/derive_split.ts',
  'src/application/design/dsl_ops/api_ops.ts',
  'src/application/design/dsl_ops/edge_ops.ts',
  'src/application/design/dsl_ops/edit_result.ts',
  'src/application/design/dsl_ops/status_tools.ts',
  'src/application/design/intent/consistency.ts',
  'src/application/design/intent/detect_drift.ts',
  'src/application/design/rewrite/rewrite.ts',
  'src/application/dispatch.ts',
  'src/application/meta/explore/contract_page.ts',
  'src/application/meta/explore/explore_arg_spec.ts',
];

/** 判据搬运：计划册侧 → agent-io 的 23 条 path（条数 + `decision.expectations` 的 JSON sha256） */
const CRITERIA_MOVED: Record<string, { crit: number; sha: string }> = {
  'observe-lang-go/cmd/instrument/main.go': { crit: 2, sha: 'cbeb9f5956a5ad97718660b4bf6b78e7860717171d36b40cc6ae4712152de325' },
  'observe-lang-go/cmd/observev2-demo/main.go': { crit: 2, sha: '3e54cc4accf58116be74aa565b3bab2a97747e1defcad83541f4c7b82cf66a92' },
  'observe-lang-go/cmd/observev2-record/main.go': { crit: 2, sha: 'a37341c605764d53cabf1ea6fd20635ec1ef38227d0eb0dd586f9bf75f3735b3' },
  'observe-lang-go/internal/instrument/contract.go': { crit: 2, sha: '0f18d7517c275c2afd08ea3ec6339d030bbdf71a92676be60473123943c7f469' },
  'observe-lang-go/internal/instrument/effects.go': { crit: 2, sha: '0711ed39353ce0bed9a0b1b47d5ef6fd112cda7fe943c80c3814683956681c99' },
  'observe-lang-go/internal/instrument/instrument.go': { crit: 2, sha: '4dc1cac3c602b349f353ac3f0747fe2895900811cceb965bf7bce8f068de6caf' },
  'observe-lang-go/probe/export.go': { crit: 2, sha: 'bb451e439e187e99e6b9f4c02c0b3d7bb7f816d30441240a0370ea88031a9a36' },
  'observe-lang-go/probe/global.go': { crit: 2, sha: '43934144117c95f5df1cb8e332353dc8c399450aadf7c9dd50185fc658758ba1' },
  'observe-lang-go/probe/probe.go': { crit: 2, sha: '9dc11bba90956a89a87c141c9dd5ee4a415eb257dd39524e552added1d602887' },
  'observe-lang-go/probe/run_recorder.go': { crit: 1, sha: 'a7385de78f23e68b93706b6ed0dab33daee0a46a99d09c3c410ec383d6b32c94' },
  'observe-lang-go/probe/tiered.go': { crit: 2, sha: 'a4e0c90e924f8feb51d62f9d250f14bcf8a3643fd7ddea2757cd4f1538e58ecb' },
  'observe-lang-go/probe/trace.go': { crit: 2, sha: '80036064f580b3c7fdaf05fb0ca6bafb05a5eefb27db229e23cec999f22f3688' },
  'observe-lang-java/observe/probe/Camprobe.java': { crit: 2, sha: 'a71eed15e5953efa466ecb0b86090c02cb2efb0db12c68153919acb7ddbb62f4' },
  'observe-lang-py/camprobe.py': { crit: 2, sha: '40a331518b05be69c24b0697f5e13d9bcbdf2c4abe0795ffc16fae5e51366760' },
  'scripts/hook-task-gate.mjs': { crit: 1, sha: '55a13b63f3db64b8a0d5cc48298ab70dd442131c73ad38001104300e9ccab327' },
  'scripts/impl-mutate.mjs': { crit: 2, sha: 'e9f8df71807ef228cac2020f9409f89e50a0039453ab70011280615597c2a226' },
  'scripts/install_mcp.mjs': { crit: 1, sha: '07c580e94d9a3e0bc9763864e4830e683168ecfd49727947d984d9d4f883c07b' },
  'scripts/verify-changed.mjs': { crit: 2, sha: '5ee802944c87856f235ba6bf9df5f73b1c3f614b827d4adbb0b21d34bab82210' },
  'src/application/design/dsl_ops/api_ops.ts': { crit: 1, sha: 'beee4358f15a277efdbafa2c05bdb86c0a11280ae305941261676fbf9b56b785' },
  'src/application/design/dsl_ops/edge_ops.ts': { crit: 2, sha: 'b9b2ca7fe02c2675148867288d780ebc28eeb3fe2fcdcf3ee6f2b940fe9d8947' },
  'src/application/design/dsl_ops/edit_result.ts': { crit: 1, sha: '131557fc14ffd9b774ccf96eec08bb3054e06c66fd4b05e1b01e7c4588eaa920' },
  'src/application/design/dsl_ops/status_tools.ts': { crit: 2, sha: 'b8cb2352f64d982be813b9af2da8275fcee4ebbe5f7f2146921e0d01dbeca801' },
  'src/application/design/rewrite/rewrite.ts': { crit: 2, sha: '360974ae1db6cd1c9af57fdc802330a0615bca1550c72dec77239d3517c838c3' },
};

/** 判据本来就在 agent-io 的 14 条 path（本批只删计划册侧；判据**一位没动**，钉 sha 防"顺手改了"） */
const CRITERIA_OWNED: Record<string, { crit: number; sha: string }> = {
  'scripts/clean_dist.mjs': { crit: 1, sha: '03d724e940264dfa8ab971abe0166dbd802d9ee454760d36fdceb4bf5f6d7b68' },
  'scripts/gen-db-check.mjs': { crit: 1, sha: '95f55c7d6a08769b79fb60b6ea51b2b6291b1aa0703a859fd4f1cbf9edf41ad5' },
  'scripts/gen_manifest.mjs': { crit: 1, sha: 'a73157e7fff226ad15d71b467b3f3fdb56a9df76e464bfda0761b9e970df7f02' },
  'scripts/mutate.mjs': { crit: 2, sha: '94de5353702260c0857822995d263aa9f2a2f09ee523b240c6fa3e6f804382a1' },
  'scripts/verify.mjs': { crit: 5, sha: '6a49a5fa8706491c59cdc98f0b666a5c5de3cc7cf1ae2792c03fcf8b7d4efe27' },
  'src/application/claim_conflict.ts': { crit: 4, sha: '8ebc88fd6d24f459ff0249afe993b5d800a0d2d7c2b5d8afbb742b88d8ea15ed' },
  'src/application/cross/index.ts': { crit: 2, sha: '5d857c4a5f74eede48a562152ca0ced4db3b33a2277fddfdd44c04c2bd842bd2' },
  'src/application/design/api_signature.ts': { crit: 1, sha: '77003d96d873796a8a7dd6aa4588cad2ff9009937bdc048f69fc95801ee3fc58' },
  'src/application/design/derive/derive_split.ts': { crit: 2, sha: '6c25238eeaf6a741e78f030b7faa9b659406f1f943a4963a560104e6ebb316a5' },
  'src/application/design/intent/consistency.ts': { crit: 2, sha: '2885f8843d22cf201ff114f00bea647c288df497bb60ed33773d585cbc2b7489' },
  'src/application/design/intent/detect_drift.ts': { crit: 2, sha: '6b9c6363f7e749a552536ced74c0e0cf8a96a88bd1621393a83528f441c882c0' },
  'src/application/dispatch.ts': { crit: 2, sha: '543c186367064ed75f852514e0b8976e5c35e5d53ab08a28f9660f72266f2bb6' },
  'src/application/meta/explore/contract_page.ts': { crit: 2, sha: '5d5e77ad4a032fc25e7323af8b95cd3bc0c47ac931d1ce6651c58c3f29d960d1' },
  'src/application/meta/explore/explore_arg_spec.ts': { crit: 1, sha: '9c1e6627a9367a77bfbc81e522b6915395cd24599821a87f0eb47915d29546b0' },
};

/** 整份 `decision` 逐字搬的 23 条（散文 + 判据一起走；sha 是**搬完之后**属主册那份的指纹） */
const DECISION_WHOLE: Record<string, string> = {
  'observe-lang-go/cmd/instrument/main.go': '7d2f618c22457a958ec56896e8001a0c3a901aa94feb7e7f8a798ed98440a743',
  'observe-lang-go/cmd/observev2-demo/main.go': '04d6cee00f400f61602dfa2bfdecb81e8528aa31d6fe01d8c752b06d6874f1e9',
  'observe-lang-go/cmd/observev2-record/main.go': 'a5f3b9e71d8922105896a3032b3f7cc2fc02f31b66604f107de812ebff0499dd',
  'observe-lang-go/internal/instrument/contract.go': '3c255a0a41f81d10be590359d47f5946cb05ee08e6f0c0ae41da2a1bf1af171e',
  'observe-lang-go/internal/instrument/effects.go': 'bb53137197c25d5b7625e8e051ad0d7754007c6741a39319eb18568393ce0624',
  'observe-lang-go/internal/instrument/instrument.go': '732e3f27841e19234166252a98e82e1df2315816b846be122e55c4f5abb537f2',
  'observe-lang-go/probe/export.go': 'a88cdeb9ee314e567bf6d30b08e3889f3fa774aa4fccf0f142b78c03dda01d05',
  'observe-lang-go/probe/global.go': '6cc411791995548811c43a65723a1daa256081b520a61c7df40aba344c29225f',
  'observe-lang-go/probe/probe.go': '63e07febce8c10a187c024e521d2ba69a0bd55797f0ae0d331c8ea3787eb04ee',
  'observe-lang-go/probe/run_recorder.go': '1af85bb7620ab84c73ebb0f44ddefa43cb7715a4baa329e0899af0ae8a781180',
  'observe-lang-go/probe/tiered.go': 'fd7e8de5ab9641f5d6c0509c6310f7537c3459abdac896df0780ac6b14b1483b',
  'observe-lang-go/probe/trace.go': 'b4d7778f698cfc540a6dc12e0bf0446c81b2eb851cbee876e23a6f0b98b9e4f0',
  'observe-lang-java/observe/probe/Camprobe.java': '4439d3d87d6ff4ff4ac081c6608e0ec8deedaf317b3c6912e15e4018c32ecd77',
  'observe-lang-py/camprobe.py': '6d0dd3feb6c36f3e260cb96b247ad9ab4375e5a961663be9e7c366dc118bea75',
  'scripts/hook-task-gate.mjs': 'd4b4de5488684097cc803e1f376068cd29681639cc13bf17fee6363bab3d0369',
  'scripts/impl-mutate.mjs': '8e4817f481e69d8cb4e9915949b0051a0efacf460f57bf54ad535575d3061b07',
  'scripts/install_mcp.mjs': 'b776a409d499ed8a6332e668e4b09b90c5e10f9d29437c87fa8387ae9d2a0355',
  'scripts/verify-changed.mjs': '16a0a03492860e00cf124bc91653d2e7b0c8f7dfea5b80784f2981a71baf8a7e',
  'src/application/design/dsl_ops/api_ops.ts': '8debbd5e739b3e09cae68e3bf4b607a147688708983c66d9307e5ccab7d35fa8',
  'src/application/design/dsl_ops/edge_ops.ts': 'e9343ac09b0f54fe964eec2d1b98b5a82074dd6bf5baff4fa32f6b2463417079',
  'src/application/design/dsl_ops/edit_result.ts': 'b76bc5129499139a71d79e8c8a207b48550259712c5c5102ba1ce3863a1f75a5',
  'src/application/design/dsl_ops/status_tools.ts': '1ed7fdb1e8d004996347653fa95c18a7828324d405c7b78ef9adcc8595bf732c',
  'src/application/design/rewrite/rewrite.ts': '15aecb206ecabb9b392cd076fe4c3b137325ba3d969a87460346e5495ea21809',
};

/** 职责文本（`semantic.files[].responsibility`）搬过去的 19 条：字数 + sha256 */
const RESP_MOVED: Record<string, { chars: number; sha: string }> = {
  'observe-lang-go/cmd/instrument/main.go': { chars: 34, sha: '091d7ed51165696211f5a60ca424f0d893c1def25410ee22aa7c819d33a20b33' },
  'observe-lang-go/cmd/observev2-demo/main.go': { chars: 32, sha: 'eb44464eb7d6fbbb33a305c614cd87a6161e9248c3fcd00fcbf27a155dc1f126' },
  'observe-lang-go/cmd/observev2-record/main.go': { chars: 32, sha: '0a79b6b27f879977ff7a47ed17439a5bcd2c946b9d792a9122b801daafacc923' },
  'observe-lang-go/internal/instrument/contract.go': { chars: 24, sha: '7c918f3871b758605b9d6c6b94db674a6d0ff024f7c6655be11ac5cc006bca02' },
  'observe-lang-go/internal/instrument/effects.go': { chars: 24, sha: '3c8a69f726a2b8a30e88bb505de24481cabbbfd7a2c4e4a2083e8e9671f3c866' },
  'observe-lang-go/internal/instrument/instrument.go': { chars: 24, sha: '68e585aa796ae85100065bd2169a4d5be685df15837d0fc66809c4d7bb539e04' },
  'observe-lang-go/probe/export.go': { chars: 22, sha: 'b3152c952fa4ae46fdda16896059648798beae3b1e56ada87146b0031033a32c' },
  'observe-lang-go/probe/global.go': { chars: 24, sha: '0971ced79128a51f17732008064ebfae5d168035f3e345f659429df685e2bf65' },
  'observe-lang-go/probe/probe.go': { chars: 22, sha: '2ff23c60067c0fc33c093301ea13a0f199ef9103b6597f9cbc9aac79da176d02' },
  'observe-lang-go/probe/run_recorder.go': { chars: 23, sha: 'be85ca79b880a043ce762d7edff688141ed178e9fc682615b0a5f13e72c57345' },
  'observe-lang-go/probe/tiered.go': { chars: 22, sha: '296454885178890b1eef750d7a6d59db4f84c817a30fca947f76261726c7cbf3' },
  'observe-lang-go/probe/trace.go': { chars: 22, sha: '5703da61b6488cd011c051a7e6bca6d886bd6bf22b1eeb550c6495acfc4b130b' },
  'observe-lang-java/observe/probe/Camprobe.java': { chars: 31, sha: '165e118b60cf331b0c639b6fc7519b8541db65d6d245378f40d2d76d5f309974' },
  'observe-lang-py/camprobe.py': { chars: 29, sha: 'fa56f36d148f992e3c6ddfae3e4dd6b9e856c51b13e966b6f81bae0977b3d7ed' },
  'scripts/gen-db-check.mjs': { chars: 41, sha: '24e7cd93819f031aaf17d2848ccb887e89b32a7fdde2d05eb30bf9a82320809f' },
  'scripts/impl-mutate.mjs': { chars: 20, sha: 'f7e10787adce4f784d9100c028919a71fea2240788ed071f8864e6642b1e8c21' },
  'scripts/mutate.mjs': { chars: 51, sha: 'a83a57bec8d6ff6c1276ae7971c27f2fc16d589a9d162202ccdc44c7cb17e5dc' },
  'src/application/claim_conflict.ts': { chars: 51, sha: 'dc86e87af8f082abc251f4c85e58228dbd5cb4694baefc3f28bb5fc4569d9b96' },
  'src/application/design/rewrite/rewrite.ts': { chars: 35, sha: 'b40426d68c90bab7758f1cd0e2ce102a6a05fe635827d84ee971314b06afecb6' },
};

/** `semantic.files[].status` 随迁的 7 条（属主侧本来空白） */
const SEM_STATUS: Record<string, string> = {
  'scripts/hook-task-gate.mjs': 'done',
  'scripts/impl-mutate.mjs': 'done',
  'scripts/install_mcp.mjs': 'done',
  'scripts/verify-changed.mjs': 'done',
  'src/application/design/dsl_ops/api_ops.ts': 'done',
  'src/application/design/dsl_ops/status_tools.ts': 'done',
  'src/application/design/rewrite/rewrite.ts': 'done',
};

/** 节点字段 `status` / `overlay` 随迁的 7 条（批 6 的 go_instrument 形态） */
const NODE_FIELDS: readonly string[] = [
  'scripts/hook-task-gate.mjs',
  'scripts/impl-mutate.mjs',
  'scripts/install_mcp.mjs',
  'scripts/verify-changed.mjs',
  'src/application/design/dsl_ops/api_ops.ts',
  'src/application/design/dsl_ops/status_tools.ts',
  'src/application/design/rewrite/rewrite.ts',
];

/** 计划册侧被删的 51 个节点 id（含 14 个漂移旧 id） */
const DELETED_IDS: readonly string[] = [
  'file_observe-lang-go_cmd_instrument_main_go',
  'file_observe_lang_go_cmd_instrument_main_go',
  'file_observe-lang-go_cmd_observev2-demo_main_go',
  'file_observe_lang_go_cmd_observev2_demo_main_go',
  'file_observe-lang-go_cmd_observev2-record_main_go',
  'file_observe_lang_go_cmd_observev2_record_main_go',
  'file_observe-lang-go_internal_instrument_contract_go',
  'file_observe_lang_go_internal_instrument_contract_go',
  'file_observe-lang-go_internal_instrument_effects_go',
  'file_observe_lang_go_internal_instrument_effects_go',
  'file_observe-lang-go_internal_instrument_instrument_go',
  'file_observe_lang_go_internal_instrument_instrument_go',
  'file_observe-lang-go_probe_export_go',
  'file_observe_lang_go_probe_export_go',
  'file_observe-lang-go_probe_global_go',
  'file_observe_lang_go_probe_global_go',
  'file_observe-lang-go_probe_probe_go',
  'file_observe_lang_go_probe_probe_go',
  'file_observe-lang-go_probe_run_recorder_go',
  'file_observe_lang_go_probe_run_recorder_go',
  'file_observe-lang-go_probe_tiered_go',
  'file_observe_lang_go_probe_tiered_go',
  'file_observe-lang-go_probe_trace_go',
  'file_observe_lang_go_probe_trace_go',
  'file_observe-lang-java_observe_probe_Camprobe_java',
  'file_observe_lang_java_observe_probe_Camprobe_java',
  'file_observe-lang-py_camprobe_py',
  'file_observe_lang_py_camprobe_py',
  'file_scripts_clean_dist_mjs',
  'file_scripts_gen-db-check_mjs',
  'file_scripts_gen_manifest_mjs',
  'file_scripts_hook-task-gate_mjs',
  'file_scripts_impl-mutate_mjs',
  'file_scripts_install_mcp_mjs',
  'file_scripts_mutate_mjs',
  'file_scripts_verify-changed_mjs',
  'file_scripts_verify_mjs',
  'file_src_application_claim_conflict_ts',
  'file_src_application_cross_index_ts',
  'file_src_application_design_api_signature_ts',
  'file_src_application_design_derive_derive_split_ts',
  'file_src_application_design_dsl_ops_api_ops_ts',
  'file_src_application_design_dsl_ops_edge_ops_ts',
  'file_src_application_design_dsl_ops_edit_result_ts',
  'file_src_application_design_dsl_ops_status_tools_ts',
  'file_src_application_design_intent_consistency_ts',
  'file_src_application_design_intent_detect_drift_ts',
  'file_src_application_design_rewrite_rewrite_ts',
  'file_src_application_dispatch_ts',
  'file_src_application_meta_explore_contract_page_ts',
  'file_src_application_meta_explore_explore_arg_spec_ts',
];

/** 14 个"老一代漂移旧 id"（`id ≠ nodeIdOf(path)`；删它们 = 删存量重复，**不是改名**） */
const DRIFT_IDS: readonly string[] = [
  'file_observe_lang_go_cmd_instrument_main_go',
  'file_observe_lang_go_cmd_observev2_demo_main_go',
  'file_observe_lang_go_cmd_observev2_record_main_go',
  'file_observe_lang_go_internal_instrument_contract_go',
  'file_observe_lang_go_internal_instrument_effects_go',
  'file_observe_lang_go_internal_instrument_instrument_go',
  'file_observe_lang_go_probe_export_go',
  'file_observe_lang_go_probe_global_go',
  'file_observe_lang_go_probe_probe_go',
  'file_observe_lang_go_probe_run_recorder_go',
  'file_observe_lang_go_probe_tiered_go',
  'file_observe_lang_go_probe_trace_go',
  'file_observe_lang_java_observe_probe_Camprobe_java',
  'file_observe_lang_py_camprobe_py',
];

/** 判据守恒读数：本批搬 41 条、三册合计 826（agent-io 611 → 652 / 计划册 208 → 167 / 工具面 7） */
const CRITERIA_TOTAL = 826;
const CRITERIA_IN_AI = 652;
const CRITERIA_IN_TSP = 167;
const CRITERIA_IN_TOOLFACE = 7;
const CRITERIA_MOVED_COUNT = 41;

/**
 * `多册持有`：批 8 收口 132 → 批 9 再收 37 = **95**。
 * ★ 95 是**上限**（棘轮），不是"永远等于"：批 10–13 还会继续往下走（批 3 §3.2 的双 Δ 判据）。
 */
const MULTI_OWNED_BEFORE_B9 = 132;
const MULTI_OWNED_AFTER_B9 = 95;
/** `id 漂移`：24 → 10（14 个老一代漂移旧 id 节点随批 9 删除；**不是改名**） */
const ID_DRIFT_BEFORE_B9 = 24;
const ID_DRIFT_AFTER_B9 = 10;
/** 计划册 `owns[]`：43 → 34（9 条精确条目摘掉 = 属主改判；agent-io 的前缀/精确条目接住它们） */
const TSP_OWNS_BEFORE_B9 = 43;
const TSP_OWNS_AFTER_B9 = 34;
/** 计划册侧删掉的节点数 = 37 path 里的 51 个节点（14 个 path 各有"新 id + 漂移旧 id"两个节点） */
const DELETED_NODES = 51;
const DELETED_SEMANTICS = 51;
const DELETED_EDGES = 54;
const TSP_NODES_AFTER_B9 = 213;
const TSP_SEMANTIC_AFTER_B9 = 107;

/** 带卡却仍在本批的 15 条（**卡一个字节没动**：卡的家在 `tasks.db`；本批 0 次卡操作） */
const CARD_LEAVE: readonly string[] = [
  'scripts/clean_dist.mjs',
  'scripts/gen-db-check.mjs',
  'scripts/gen_manifest.mjs',
  'scripts/mutate.mjs',
  'scripts/verify-changed.mjs',
  'scripts/verify.mjs',
  'src/application/claim_conflict.ts',
  'src/application/cross/index.ts',
  'src/application/design/api_signature.ts',
  'src/application/design/derive/derive_split.ts',
  'src/application/design/intent/consistency.ts',
  'src/application/design/intent/detect_drift.ts',
  'src/application/dispatch.ts',
  'src/application/meta/explore/contract_page.ts',
  'src/application/meta/explore/explore_arg_spec.ts',
];

/**
 * 本批**界外**的锚点（批 4/5/6 的界外纪律：不是"漏了"，是"两条叙事打架，机器不许自己选"）。
 * ★ 它们必须**仍是两册持有**且判据仍在原来那一侧 —— 界外被"顺手收了"这里就红。
 */
const OUT_OF_SCOPE: ReadonlyArray<{ path: string; why: string }> = [
  { path: 'src/application/design/dsl_ops/task_ops.ts', why: '散文冲突（summary/acceptance/tags 两侧都不同）' },
  { path: 'src/application/design/dsl_ops/file_ops.ts', why: '散文冲突（summary 两侧都不同）' },
  { path: 'src/application/design/db/gen_design_db.ts', why: '散文冲突 + overlay 冲突' },
  { path: 'src/application/write_gate.ts', why: '散文冲突 + semantic.status 冲突 + 活卡' },
  { path: 'src/infrastructure/storage.ts', why: '两侧都带判据（1 / 15）⇒ 批 13 的真歧义' },
  { path: 'src/application/design/board/pool.ts', why: '断言级冲突：它的 call-exists 断言 query_feature.ts（后者仍在计划册）⇒ 搬它会造出 ⑦ 档归属重复' },
  { path: 'src/infrastructure/index/symbols.ts', why: '散文冲突（summary/agent/updated_at 两侧都不同）+ overlay 冲突' },
];

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
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
/** ★ 直接读册文件（不经 `readDesignSheetsForGate` 的 hydration）：sha256 比的是**盘上那份的字节形状** */
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

// ════════════════════════════════════════════════════════════════════
// 9.1 / 9.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('9.1 真仓：37 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数逐条对表', () => {
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

test('9.1b 计划册里这 37 个 path 的节点 / 语义 / 边都不在了；14 个漂移旧 id 在任何册里都不再出现', () => {
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
  for (const s of repoSheets()) {
    const ids = new Set(nodesOf(s).map((n) => String(n.id)));
    for (const id of DELETED_IDS) assert.ok(!ids.has(id) || s.feature === AI, `${s.feature} 册里不该再有被删节点 \`${id}\``);
  }
  // ★ 14 个漂移旧 id：它们**不在任何册**了（删存量重复，不是改名）
  const allIds = new Set(repoSheets().flatMap((s) => nodesOf(s).map((n) => String(n.id))));
  for (const id of DRIFT_IDS) assert.ok(!allIds.has(id), `漂移旧 id \`${id}\` 必须已从所有册里消失`);
  assert.equal(DRIFT_IDS.length, 14, '漂移旧 id 必须是 14 个（observe-lang-{go,java,py} 那一代）');
});

// ════════════════════════════════════════════════════════════════════
// 9.2 清单形状
// ════════════════════════════════════════════════════════════════════
test('9.2 清单形状：37 条 · **码位序**（`sort()`）· 段位 14/9/14 · 两张判据表与清单逐条同集', () => {
  assert.equal(BATCH.length, 37, `批 9 是 37 个 path（C 类无冲突段第一段，实测 ${BATCH.length}）`);
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  assert.deepEqual([...BATCH].sort(), BATCH, '清单必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  const tablePaths = [...Object.keys(CRITERIA_MOVED), ...Object.keys(CRITERIA_OWNED)].sort();
  assert.deepEqual(tablePaths, [...BATCH].sort(), '两张判据表必须与清单**逐条同集**（搬的 23 + 本来就在的 14 = 37）');
  assert.equal(Object.keys(CRITERIA_MOVED).length, 23, '搬判据的 23 条');
  assert.equal(Object.keys(CRITERIA_OWNED).length, 14, '判据本来就在属主册的 14 条');
  const bucket = (re: RegExp) => BATCH.filter((p) => re.test(p)).length;
  assert.equal(bucket(/^observe-lang-(go|java|py)\//), 14, 'observe-lang-* 段位');
  assert.equal(bucket(/^scripts\/[^/]+$/), 9, 'scripts/ 段位');
  assert.equal(bucket(/^src\/application\//), 14, 'src/application/ 段位');
  assert.equal(Object.keys(DECISION_WHOLE).length, 23, '整份 decision 搬的 23 条（= 判据搬的那些：属主侧原本没有 decision）');
  assert.equal(Object.keys(RESP_MOVED).length, 19, '职责文本搬的 19 条');
  assert.equal(Object.keys(SEM_STATUS).length, 7, 'semantic.status 随迁的 7 条');
  assert.equal(NODE_FIELDS.length, 7, '节点 status/overlay 随迁的 7 条');
  // 段位加总 = 清单长度（分母必须对得上）
  assert.equal(bucket(/^observe-lang-(go|java|py)\//) + bucket(/^scripts\/[^/]+$/) + bucket(/^src\/application\//), BATCH.length, '三段位加总必须等于 37');
});

// ════════════════════════════════════════════════════════════════════
// 9.3 判据逐字节 + 守恒 / 9.3b 有牙
// ════════════════════════════════════════════════════════════════════
test('9.3 判据**逐字节**：搬的 23 条 sha256 相同；本来就在属主册的 14 条一位没动；总数守恒 826', () => {
  const aiNodes = rawNodes(AI);
  for (const [p, want] of Object.entries(CRITERIA_MOVED)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.crit, `\`${p}\` 的判据条数必须是 ${want.crit}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.sha, `\`${p}\` 的判据 JSON 被改过（sha ${shaOfJson(exps).slice(0, 16)}… ≠ ${want.sha.slice(0, 16)}…）—— 搬运是**逐字节**的`);
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
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 826（实测 ${per}）`);
  assert.equal(criteriaOf(bookOf(AI)), CRITERIA_IN_AI, `agent-io 册判据必须是 ${CRITERIA_IN_AI}（611 + 搬来的 41）`);
  assert.equal(criteriaOf(bookOf(TSP)), CRITERIA_IN_TSP, `计划册判据必须是 ${CRITERIA_IN_TSP}（208 − 搬走的 41）`);
  assert.equal(criteriaOf(bookOf('agent-io-toolface')), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  // 算术：搬的条数 = 两张表里"搬"的那部分之和；且 = 计划册的降幅 = 属主册的涨幅
  const movedSum = Object.values(CRITERIA_MOVED).reduce((s, x) => s + x.crit, 0);
  assert.equal(movedSum, CRITERIA_MOVED_COUNT, `搬的判据条数必须是 ${CRITERIA_MOVED_COUNT}（实测 ${movedSum}）`);
  assert.equal(CRITERIA_IN_AI - 611, movedSum, '属主册涨幅必须恰等于搬来的条数');
  assert.equal(208 - CRITERIA_IN_TSP, movedSum, '计划册降幅必须恰等于搬走的条数');
  assert.equal(611 + movedSum + 208 - movedSum + 7, CRITERIA_TOTAL, '守恒是**算术**，不是"看起来差不多"');
});

test('9.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 826，差额恰是该节点的判据数', () => {
  const sheets = repoSheets();
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的读数是 826');
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
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 9.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 9.4 散文搬运 / 9.4b 有牙
// ════════════════════════════════════════════════════════════════════
test('9.4 散文：整份 decision 23 条逐字搬（sha256）· responsibility 19 条 · semantic.status 7 条 · 节点 status/overlay 7 条', () => {
  const aiNodes = rawNodes(AI);
  const tspNodes = rawNodes(TSP);
  const aiSems = rawSems(AI);
  for (const [p, want] of Object.entries(DECISION_WHOLE)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n?.decision, `\`${p}\` 的 decision 必须落在属主册（只删不搬 = 叙事蒸发）`);
    assert.equal(shaOfJson(n.decision), want, `\`${p}\` 的整份 decision 被改过 —— 批 6 的 go_instrument 形态是**整份记录逐字搬**`);
    assert.ok(tspNodes.every((x) => norm(x.path) !== p), `\`${p}\` 计划册侧节点必须已删（否则"搬了没删"）`);
  }
  for (const [p, want] of Object.entries(RESP_MOVED)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.ok(s, `\`${p}\` 的语义条目必须在属主册`);
    assert.ok(String(s.responsibility ?? '').trim(), `\`${p}\` 的职责文本丢了（删它 = 让叙事蒸发）`);
    assert.equal(sha(String(s.responsibility)), want.sha, `\`${p}\` 的职责文本被改过（搬运是**逐字节**的）`);
    assert.equal(String(s.responsibility).trim().length, want.chars, `\`${p}\` 的职责字数必须仍是 ${want.chars}（实测 ${String(s.responsibility).trim().length}）`);
    assert.ok(!rawSems(TSP).some((x) => norm(x.path) === p), `计划册侧不该再有 \`${p}\` 的语义条目`);
  }
  for (const [p, want] of Object.entries(SEM_STATUS)) {
    const s = aiSems.find((x) => norm(x.path) === p);
    assert.equal(String(s?.status ?? '') || null, want, `\`${p}\` 的 semantic.status 必须随迁为 ${want}（实测 ${String(s?.status ?? '∅')}）`);
  }
  for (const p of NODE_FIELDS) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n?.status, `\`${p}\` 的节点 status 必须随迁（批 6 的做法：status + overlay 是原生字段，一起走才不留半吊子状态）`);
    assert.ok(n?.overlay, `\`${p}\` 的节点 overlay 必须随迁`);
  }
});

test('9.4b 上一条**有牙**：清空职责 / 改一个字节 / 动一下 decision ⇒ 指纹立刻变（纯核，不碰真册）', () => {
  const [p0, want] = Object.entries(RESP_MOVED)[0] as [string, { chars: number; sha: string }];
  const sem = rawSems(AI).find((x) => norm(x.path) === p0);
  assert.equal(sha(String(sem?.responsibility)), want.sha, '前提：不改动时指纹一致');
  assert.notEqual(sha(''), want.sha, '清空职责必须让指纹变');
  assert.notEqual(sha(`${String(sem?.responsibility)} `), want.sha, '加一个空格也必须让指纹变（逐字节 = 逐字节）');
  const [p1, dsha] = Object.entries(DECISION_WHOLE)[0] as [string, string];
  const node = rawNodes(AI).find((x) => norm(x.path) === p1);
  assert.equal(shaOfJson(node?.decision), dsha, '前提：整份 decision 指纹一致');
  const mut = { ...(node?.decision as Record<string, unknown>), summary: '改一个字节' };
  assert.notEqual(shaOfJson(mut), dsha, '改 decision 的任何一处都必须让指纹变 —— 否则 9.4 是空断言');
});

// ════════════════════════════════════════════════════════════════════
// 9.5 域表收窄
// ════════════════════════════════════════════════════════════════════
test('9.5 域表**收窄**：37 条属主 = agent-io；计划册 owns 43 → 34；前缀仍在（不是"掉成无人认领"）', () => {
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
  // 本批 9 条"属主原本是计划册"的 path：精确条目必须摘掉了
  const transferred = ['scripts/hook-task-gate.mjs', 'scripts/impl-mutate.mjs', 'scripts/install_mcp.mjs', 'scripts/verify-changed.mjs', 'src/application/design/dsl_ops/api_ops.ts', 'src/application/design/dsl_ops/edge_ops.ts', 'src/application/design/dsl_ops/edit_result.ts', 'src/application/design/dsl_ops/status_tools.ts', 'src/application/design/rewrite/rewrite.ts'];
  assert.equal(transferred.length, 9, '改判的 9 条（属主原为计划册）');
  for (const p of transferred) {
    assert.ok(BATCH.includes(p), `改判的 \`${p}\` 必须在本批清单里`);
    assert.ok(!tspOwns.includes(p), `计划册 \`owns[]\` 里不该再有精确条目 \`${p}\`（属主已改判）`);
  }
  // 棘轮：只许不增；且降幅 = 9
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER_B9, `计划册 owns 只许不增（批 9 收口 ${TSP_OWNS_AFTER_B9}；实测 ${tspOwns.length}）`);
  assert.equal(TSP_OWNS_BEFORE_B9 - TSP_OWNS_AFTER_B9, transferred.length, '降幅必须恰等于改判条数（常量算术）');
  // 前缀接住：摘掉精确条目后这些 path 仍有属主
  for (const pre of ['src/', 'scripts/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\`（否则 14 条 observe-lang 会掉成无人认领）`);
});

// ════════════════════════════════════════════════════════════════════
// 9.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('9.6 ② 档：这 37 条 klass = owned；塞回任一条 ⇒ 立刻 multi_owned（鉴别力）；path 分母仍是 555', () => {
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
  // 分母还在（0.12：分子必须带分母）
  assert.equal(now.paths, 555, `path 分母不该被删节点改动（实测 ${now.paths}）`);
  assert.equal(now.books, 3, `册数不变（实测 ${now.books}）`);

  // 世界二：给计划册再造一个同 path 的空节点 ⇒ 这个 path 立刻变 multi_owned，且计数 +1
  const p0 = BATCH.find((p) => p.startsWith('src/application/')) as string;
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
// 9.7 写端
// ════════════════════════════════════════════════════════════════════
test('9.7 写端：批 9 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 9 的删除是可逆的）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    // 属主册给同一 path 写**判据 + 职责文本**（与批 9 的搬运同形）⇒ 必须放行
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
// 9.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('9.8 门档：多册持有 ≤ 95（132 − 37）· id 漂移 ≤ 10 · 属主错位 ≤ 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(now.multi_owned.length <= MULTI_OWNED_AFTER_B9, `多册持有只许不增（批 9 收口 ${MULTI_OWNED_AFTER_B9}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`);
  // 历史算术：132 − 95 = 37 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B9 - MULTI_OWNED_AFTER_B9, BATCH.length, '批 9 的降幅必须逐字等于本批 path 数');
  // id 漂移：24 − 10 = 14 = 本批删掉的漂移旧 id 节点数
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER_B9, `id 漂移只许不增（批 9 收口 ${ID_DRIFT_AFTER_B9}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE_B9 - ID_DRIFT_AFTER_B9, DRIFT_IDS.length, '漂移降幅必须恰等于本批删掉的漂移旧 id 数（删存量重复，不是改名）');
  for (const id of DRIFT_IDS) assert.ok(!now.id_drift.some((x) => x.endsWith(`:${id}`)), `漂移旧 id \`${id}\` 必须已从漂移集合里消失`);
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
// 9.9 带卡留账
// ════════════════════════════════════════════════════════════════════
test('9.9 带卡留账 15 条：卡一个字节没动（本批 0 次卡操作），门档 `why` 逐条点着名字', () => {
  const read = crossBookReadingOf(REPO);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  assert.equal(CARD_LEAVE.length, 15, '带卡留账必须是 15 条（实测清单）');
  for (const p of CARD_LEAVE) {
    assert.ok(BATCH.includes(p), `\`${p}\` 必须在本批清单里（它是本批成员，不是"漏网的"）`);
    assert.ok(!multi.includes(p), `\`${p}\` 本批已收 ⇒ 不该还在多册持有集合里`);
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  for (const p of CARD_LEAVE) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着带卡留账 \`${p}\`（否则下次没人知道它的卡为什么没跟着走）`);
  }
  // 计划册侧的节点数 / 语义数：删掉的必须是 51 + 51（一个不多一个不少）
  assert.equal(TSP_NODES_AFTER_B9, 264 - DELETED_NODES, '计划册节点数：264 − 51 = 213');
  assert.equal(rawNodes(TSP).length, TSP_NODES_AFTER_B9, `计划册节点数必须是 ${TSP_NODES_AFTER_B9}（实测 ${rawNodes(TSP).length}）`);
  assert.equal(rawSems(TSP).length, TSP_SEMANTIC_AFTER_B9, `计划册语义条目数必须是 ${TSP_SEMANTIC_AFTER_B9}（实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.equal(edgesNow, 449 - DELETED_EDGES, `计划册边数：449 − ${DELETED_EDGES} = ${449 - DELETED_EDGES}（实测 ${edgesNow}）`);
});

// ════════════════════════════════════════════════════════════════════
// 9.10 界外账
// ════════════════════════════════════════════════════════════════════
test('9.10 **界外账**：散文冲突 / 断言级冲突的锚点**仍是两册持有**（没有被"顺手收了"）', () => {
  const read = crossBookReadingOf(REPO);
  const multi = new Set(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path));
  assert.equal(OUT_OF_SCOPE.length, 7, '界外锚点 7 条（覆盖三类理由）');
  for (const { path: p, why } of OUT_OF_SCOPE) {
    assert.ok(!BATCH.includes(p), `\`${p}\` 不该在本批清单里（${why}）`);
    assert.ok(multi.has(p), `\`${p}\` 必须仍是**两册持有**（界外 ≠ 已处理；${why}）`);
  }
  // 判据仍在"原来那一侧"：pool.ts / symbols.ts 的判据本来就在计划册，一条没搬走
  const tspNodes = rawNodes(TSP);
  for (const p of ['src/application/design/board/pool.ts', 'src/infrastructure/index/symbols.ts']) {
    const n = tspNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 的计划册侧节点必须还在（界外）`);
    assert.ok((n.decision?.expectations ?? []).length > 0, `\`${p}\` 的判据必须还在计划册那一侧（本批没搬它）`);
  }
  // ⑤ 断言级归属（gen-db-check ⑦）：本批没有把任何 path 变成"两册都断言" —— 多册持有集合 ≤ 95 且 37 条全在里面之外
  assert.ok(multi.size >= MULTI_OWNED_AFTER_B9 - 39, '多册持有集合必须仍 ≥ 界外 39 条（说明界外一条都没被半搬）');
});
