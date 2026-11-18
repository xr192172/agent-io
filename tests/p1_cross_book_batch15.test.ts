/**
 * P1 路 T-#A8A9-CROSS-BOOK **批 15**：**属主错位 12 → 0** + **id 漂移 10 → 0**
 * —— `structure-gate` ② 档的**最后两组存量**（多册持有一组已由批 14 归零）。
 *
 * ## 这批的两件事（各一条出口）
 * 1. **属主错位 12**（`design-books.json` 判属主 = `agent-io`，册上节点却在计划册）⇒ 按**终态**（本体册）校正：
 *    · 10 条盘上存在的 path：属主册侧**完全空白** ⇒ **整份搬**（节点 + 语义条目），id 换成 `nodeIdOf(path)`，
 *      走 `saveDSL` 的**产品化换手**（`ownership:{from:['task-system-plan']}`）—— 写端在**同一次调用**里
 *      把计划册侧节点三清（节点 + 语义 + 边），不留 h=2 中间态；
 *    · 2 条盘上**不存在**（`feature_map.ts` / `inject_replay.ts`）：它们是幽灵，直接删计划册侧节点 ——
 *      域表改判成 unowned 会把"盘上没有的东西"写成"有主的东西"，那是反的。
 * 2. **id 漂移 10**（`id ≠ nodeIdOf(path)`，老一代派生式）⇒ 按 `nodeIdOf` **单点派生规范化**：
 *    · 3 条随节点搬走 / 删除而消失（`file_docs_vision_md` / `file_scripts_rejection_stats_mjs` /
 *      `file_application_meta_archive_archive_node_ts`，**不是改名**）；
 *    · 7 条**改名**（1 条 agent-io + 6 条工具面手写式），节点 id / 语义 id / `task.id` / **册内边的 from-to** 同步；
 *    · 前置 = `judgement_ref` 引用完整性：7 个旧 id 在台账（`plans`/`live_cards`/`write_log`/`ledger_*`）里 **0 行**引用，
 *      在仓里只有册 / 基线 / 历史 / 文档命中 ⇒ 改名不破任何既有引用。
 *
 * ## 这批要立的十九条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 15.1 | 真仓：**12 条 path 各恰一册**持有且是 `agent-io`；节点 id = `nodeIdOf`；计划册侧 0 节点 | 搬错册 / 只删不搬 / id 没规范，都在这里红 |
 * | 15.1b | 计划册侧**三清**：10 个被搬的旧 id 与 2 个幽灵 id 在**三册里都不再出现** | 半删（幽灵节点 / 悬空边 / 幽灵语义）在这里红 |
 * | 15.2 | 清单形状：10 搬 + 2 幽灵 + 7 改名 · 码位序 · 判据表与清单**逐条同集** · 其中 3 条顺带消漂移 | 手抄错一条 / 顺序漂了在这里红 |
 * | 15.3 | **整份搬「除 id 外逐字节」**：节点 / 散文 / 判据 / `status`+`overlay`+`gate` / 语义 五组 sha 逐条对表 | 搬重 / 重写 / 顺手改判据在这里红 |
 * | 15.3b | 上一条**有牙**：纯核副本删掉属主节点里 1 条判据 ⇒ 总数立刻 838，差额恰 1 | 空断言的照妖镜（R47） |
 * | 15.4 | 判据守恒：**839 → 839**（803+7+29 → 832+7+0；搬 29 条） | 判据丢条 / 复制成两份在这里红 |
 * | 15.5 | 职责守恒：**10,366 → 10,366**（计划册 538 字逐字跟走）；逐条 chars + sha | 改写职责 / 丢字在这里红 |
 * | 15.6 | **幽灵**：盘上不存在 · 三册 0 节点 0 语义 · 原文 sha 钉住；塞回 ⇒ ② 档立刻 `owner_mismatch 1` | 幽灵"复活" / 删错文件在这里红 |
 * | 15.7 | **id 漂移 0**：7 条改名逐条（旧 id 全册消失 · 新 id = `nodeIdOf` · 语义 id 同步 · 边端点同步 · 除 id 外逐字节） | 改一半（节点改了语义没改 / 边断头）在这里红 |
 * | 15.8 | **三零终局**：`multi_owned = 0` ∧ `owner_mismatch = 0` ∧ `id_drift = 0`（② 档现读 + 基线三组 count=0 且 sha = 空集合指纹） | 谁又造出错位 / 漂移，或改册不改基线，这里红 |
 * | 15.9 | 写端有牙：非属主册再建这些 path 的节点 ⇒ 拒（`not_owner` / `new_duplicate` / `bad_id` 三码各一世界）· 属主册自写放行 · 真 `saveDSL` 被拒时盘上**零字节变化** | 写端一刀切或干脆不判，都在这里红 |
 * | 15.10 | 漂移判据有牙（纯函数两世界）：同一个节点 id 换成手写式 ⇒ `nodeIdDriftOf` 0 → 1 | 判据恒 0 的假绿 |
 * | 15.11 | 册容：计划册 118 → 106 · 12 → 0 · 175 → 173（删 12 / 12 / 2）；属主册 649 → 659 · 544 → 554 | 只删一种 / 少搬在这里红 |
 * | 15.12 | **派生快照**：`COGNITION.txt` 每册 `dsl_rev` = 册上现值 · `--check` 一致 | 改了册不重生成快照 |
 * | 15.13 | 旧证棘轮：批 1 的 **6 个手写 id 已不在册**（改成派生式）；批 14 的 `属主错位 = 12` 已归零 | 批 15 不落地时批 1/14 的证会红 |
 * | 15.14 | **搬完还判得动**：抽 2 条搬来的判据（`behavior-cases` / `call-exists`）在属主册节点上现判 ⇒ pass | 判据搬成"死字节"在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–14 的裁定）
 * · 真仓读数（`process.cwd()`）只钉**不变量**（12 条 path 恰一册 · 判据总数 839 · 职责字数 10,366 · 逐条 sha）；
 * · 门档断的是**三组读数为 0 + 集合指纹与基线逐字一致**（这是本批的出口，不是"当前值恰好 0"）；
 * · ★ 只许钉三类东西 —— ① "我这批的 path 不在坏集合里"（永久真）② "总数只许不增"（棘轮）
 *   ③ "我这批的 Δ = 我这批的 path 数 / 判据数 / 字数"（常量算术）。**不许钉**"总数 = 我这批收口时的那个数"；
 * · 每一条"有牙"的反检查都跑在**纯核副本 / 夹具**上：真册一个字节都不动；
 * · 夹具一律落 `%TEMP%`（`AGENT_IO_HOME` 指到临时目录），绝不动仓里的 `src/` `dist/` `tests/`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import {
  assessWriteEnd,
  bookHoldings,
  crossBookOwnership,
  nodeIdDriftOf,
  ownerOf,
  readDesignBooks,
  type BookSheetLike,
  type DesignBooksTable,
} from '../src/infrastructure/design_books.js';
import { nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { saveDSL } from '../src/infrastructure/storage.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { crossBookReadingOf } from '../src/application/design/db/gen_design_db.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';
const TOOLFACE = 'agent-io-toolface';
const FEATURES = [AI, TOOLFACE, TSP] as const;

// ─── 小工具（本文件自己写，不 import 执行器）────────────────────────────────
const norm = (s: unknown): string => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const sha = (v: unknown): string =>
  createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v), 'utf8').digest('hex');
/** 门档口径的集合指纹（与 `structure-gate.mjs#shaOf` 同一式：排序后按 `\n` 连） */
const shaOfList = (list: readonly string[]): string =>
  createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');

const BOOK_CACHE = new Map<string, Record<string, unknown>>();
function bookOf(feature: string): Record<string, unknown> {
  if (!BOOK_CACHE.has(feature)) {
    BOOK_CACHE.set(
      feature,
      JSON.parse(fs.readFileSync(bookFileOf(feature), 'utf8')) as Record<string, unknown>,
    );
  }
  return BOOK_CACHE.get(feature)!;
}
const nodesOf = (feature: string): Array<Record<string, unknown>> =>
  ((bookOf(feature).geometry as { nodes?: Array<Record<string, unknown>> } | undefined)?.nodes ?? []);
const semsOf = (feature: string): Array<Record<string, unknown>> =>
  ((bookOf(feature).semantic as { files?: Array<Record<string, unknown>> } | undefined)?.files ?? []);
const edgesOf = (feature: string): Array<Record<string, unknown>> =>
  ((bookOf(feature).geometry as { edges?: Array<Record<string, unknown>> } | undefined)?.edges ?? []);
const nodeOn = (feature: string, p: string): Record<string, unknown> | undefined =>
  nodesOf(feature).find((n) => norm(n.path) === p);
const semOn = (feature: string, p: string): Record<string, unknown> | undefined =>
  semsOf(feature).find((s) => norm(s.path) === p);
const expsOf = (node: Record<string, unknown> | undefined): Array<Record<string, unknown>> =>
  ((node?.decision as { expectations?: Array<Record<string, unknown>> } | undefined)?.expectations ?? []);
/** decision 的散文部分（判据之外的全部键；**键序规范化**后比 —— 原文顺序由 nodeSha 那一组钉住）—— 与执行器同口径 */
const proseOf = (node: Record<string, unknown> | undefined): Record<string, unknown> => {
  const d = { ...((node?.decision as Record<string, unknown> | undefined) ?? {}) };
  delete d.expectations;
  return Object.fromEntries(Object.keys(d).sort().map((k) => [k, d[k]]));
};
const fieldOf = (node: Record<string, unknown> | undefined): Record<string, unknown> => ({
  status: node?.status ?? null,
  overlay: node?.overlay ?? null,
  gate: node?.gate ?? null,
});
const criteriaOf = (feature: string): number => nodesOf(feature).reduce((s, n) => s + expsOf(n).length, 0);
const respCharsOf = (feature: string): number =>
  semsOf(feature).reduce((s, x) => s + String(x.responsibility ?? '').trim().length, 0);
const sheets = (): BookSheetLike[] =>
  FEATURES.map((f) => ({ feature: f, geometry: bookOf(f).geometry as BookSheetLike['geometry'] }));
const bookTable = (): DesignBooksTable => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须读得出来：${read.error}`);
  return read.table;
};

// ─── 常量块（由 %TEMP%\a8a9-b15-genconsts.mjs 从迁移执行器的实测读数导出）──────────
// ── 本节常量全部由迁移执行器（%TEMP%\a8a9-b15-migrate.mjs）实测生成，逐条 64 位 sha256 ──

/** 10 条**盘上存在**的属主错位 path：整份搬（判据 / 职责 / status / overlay 除 id 外逐字节） */
const MOVED: Record<string, {
  from: string;
  to: string;
  crit: number;
  critSha: string;
  proseSha: string;
  nodeFieldSha: string;
  nodeSha: string;
  semSha: string;
  respChars: number;
  respSha: string;
  idDriftFixed: boolean;
}> = {
  'docs/VISION.md': { from: 'task-system-plan:file_docs_vision_md', to: 'agent-io:file_docs_VISION_md', crit: 0, critSha: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', proseSha: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', nodeFieldSha: 'd15ea3ab8559f3878ca7c6ca1c5d0472d5ba42c1cd5ba89ac3f247de04cec300', nodeSha: '0a98d86d7186083f97d193e9a68b61c8e15eeb437b39a7d64f0c0f5a95a599c5', semSha: 'aa7e2294515d892a5b6def9c230e5af9d1fc43f60186e8e795c6cde4a4d4d372', respChars: 39, respSha: 'df24cc6e0ceb00d43a60bb97974c52cf97244c5816b3ce77ce1bacc2f59e54b4', idDriftFixed: true },
  'scripts/rejection-stats.mjs': { from: 'task-system-plan:file_scripts_rejection_stats_mjs', to: 'agent-io:file_scripts_rejection-stats_mjs', crit: 0, critSha: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', proseSha: 'a122659798efef0f28b33b3b5c336649bba135da4183541731f8536db266289a', nodeFieldSha: 'd15ea3ab8559f3878ca7c6ca1c5d0472d5ba42c1cd5ba89ac3f247de04cec300', nodeSha: '1cf18e7559e77b756570587269ce8dfa0571c5602a6e40d54d3461acac854696', semSha: '227118848010cab29b32220fbd545dd1fedf79de3db7fe9e12afeb8b30dc90ac', respChars: 205, respSha: 'd5722bae73fa081d2dc252fd27d207e4bba6ef9c9446f1b89c8ca1422216e0bb', idDriftFixed: true },
  'scripts/slot-stats.mjs': { from: 'task-system-plan:file_scripts_slot-stats_mjs', to: 'agent-io:file_scripts_slot-stats_mjs', crit: 2, critSha: '021a9a7377436e29df1cf145b533ad6b68cf51be27138bddc19dcf587da3cdf2', proseSha: '821f9ac5de02326e265fcb04c115c4d62a9f1f8f9ce47770f9a21546f0a1f0b6', nodeFieldSha: '1d620a77255f20f936c776dd7161f2b5354a28678243ef2bfa6d602b153ef562', nodeSha: 'a7753564d35d6d5fb1d3281608bc1f7ca789f4d9e22907666460461c7792d8f5', semSha: '3eac721d5eeb2ace4dd3cd223ad8ba824c44ed53657fb1bd8bb73a6a73ed8a4a', respChars: 0, respSha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', idDriftFixed: false },
  'src/application/design/dsl_ops/slot_source.ts': { from: 'task-system-plan:file_src_application_design_dsl_ops_slot_source_ts', to: 'agent-io:file_src_application_design_dsl_ops_slot_source_ts', crit: 9, critSha: '76862ac7f1d3a452b9b7d762661a25df996ce208f9823966f68600396a497a77', proseSha: 'a0ae5585fcbd40a130196b5a0893d2031a24250f962a7baaed851f2722f0157f', nodeFieldSha: 'e8e2ed3b370480d3234120c88218f5b4bbe2fabe2aff3ba2ca5cbd32e99e753c', nodeSha: 'fbf5c956032116dfad96337e940caee94762b684f9f940cf6f4aa1f3ad0962d3', semSha: '4307da731e3d4cfd34df53c690e8dcda7ee00d08ea8f8abe7039450e320e1481', respChars: 0, respSha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', idDriftFixed: false },
  'src/application/meta/archive/archive_node.ts': { from: 'task-system-plan:file_application_meta_archive_archive_node_ts', to: 'agent-io:file_src_application_meta_archive_archive_node_ts', crit: 0, critSha: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', proseSha: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', nodeFieldSha: '41a04dac43eaa1b7fbea1eebc06703626cd42ff52ef3766fa2e11af1349acb06', nodeSha: 'e53f4ef8505ae0c4544f7fa5888703a2f38111c198a6e7e61308a0bb12232f80', semSha: '7f7234cb7619225e6a2c3639f15490321e2200371bf7c2fe5f63d5594a174fce', respChars: 29, respSha: '40b38c935b40244c563d02977f426b29b5efee9b7c74ee5e2defafc0b9a61d77', idDriftFixed: true },
  'src/domain/rejection_kind.ts': { from: 'task-system-plan:file_src_domain_rejection_kind_ts', to: 'agent-io:file_src_domain_rejection_kind_ts', crit: 2, critSha: '76b11cb7a50abb7c1bf95dab85023a9ab95fc878cff4fb888d8db1430491116f', proseSha: 'fdfb47872f8adcadf9cee635f5ba410cb77a7f240e7546f267823e840a3ab144', nodeFieldSha: 'd15ea3ab8559f3878ca7c6ca1c5d0472d5ba42c1cd5ba89ac3f247de04cec300', nodeSha: '0aacc799fe734478b8f234ef43e498048442c8b50eddcc68f95ec7a263d2921e', semSha: '0f2cec3ab583d80761d453f2e2c26f6531fd14126dfd7693665432a46b8c934b', respChars: 91, respSha: '9b12ce377d85aeb9ac931005a5e4ab3b756fcc7640d7036be14abcae623927fc', idDriftFixed: false },
  'src/domain/task_gate_basis.ts': { from: 'task-system-plan:file_src_domain_task_gate_basis_ts', to: 'agent-io:file_src_domain_task_gate_basis_ts', crit: 2, critSha: 'a6368310d6cd68a6fc7b570155c0f1b22c92861006b7a03088fd253124a0616d', proseSha: 'c5bf7a6673f4e028afa6604df0445ffc0ce9ae7db60d35de80cdd80a68c45463', nodeFieldSha: '441bdacbbf869faf79c34a3b34ccf2a5d724c64fdd89b7a23c0845ea65d5fde9', nodeSha: '0cdec8b143d2278d08870232670d5bd7dbb544dec4c9ad9f7744a0c6abf05d17', semSha: '95ddf72b9efc45288157ab86540e074665efc4255443d82d6472a924bdf7c6ef', respChars: 13, respSha: '441294f6bdc232e66b7b65fb55caf877ac7b77064221558887603655e61781c8', idDriftFixed: false },
  'src/infrastructure/authority/scan_authorities.ts': { from: 'task-system-plan:file_src_infrastructure_authority_scan_authorities_ts', to: 'agent-io:file_src_infrastructure_authority_scan_authorities_ts', crit: 8, critSha: 'f3d79559376ea843075a60d91836ee65f3c79ae58576879e8fde806c6a96ee53', proseSha: 'e95a17c21a14e7ace09b384a8b042c87c2b8454b54ba17f3921d885f27d17b0e', nodeFieldSha: '110abeb12604dc43c6ba5cf2e77ce594e9cb7529fe6b25b0ba417ca35fc6e98b', nodeSha: '500136b67e1eaa02f73005e23edae2b8c5c6dd9103a47cc9a737c3d721265f53', semSha: 'bc267b36e8769de644012f8abea2822da6b6f39cb4d9fffd0ddccc2249d94a29', respChars: 27, respSha: 'fef82e6421a63f80150bd86c60e4896748060a3106349bca8ae5f9138abe2ed7', idDriftFixed: false },
  'tests/p0_slot_source.test.ts': { from: 'task-system-plan:file_tests_p0_slot_source_test_ts', to: 'agent-io:file_tests_p0_slot_source_test_ts', crit: 4, critSha: '41c59f98e41886a3d67d5a3ca6e94cc8490a346b1bfb78b8ef0a3ea4a0029519', proseSha: 'a2e18e848b510faeddb74b575ecdd6c6130010dacb92aacc504156683f4846cb', nodeFieldSha: 'e2c107697f16ad4651bda770c508fe9f6a769b15ab7dfcb48fdae102a9fe97f4', nodeSha: 'e772fb1fdec09dbb7f3701bea4e6a941a0bbbb5d83416c24f4a204db18a04bd7', semSha: '5c9953e1c6988d8b86eaf822d70d5d55b27d25c97eb2dcbcb5ec8dba65e5fe25', respChars: 0, respSha: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', idDriftFixed: false },
  'tests/p0_wire_gates.test.ts': { from: 'task-system-plan:file_tests_p0_wire_gates_test_ts', to: 'agent-io:file_tests_p0_wire_gates_test_ts', crit: 2, critSha: 'e3f8885d8e3e7b571efb9c7affcc743f011ba5a1025aad16aad2b8b14140f117', proseSha: 'd20c4c10919f353526d622b1f727a972faa7004a039f511a9682bf272d73eb34', nodeFieldSha: 'e6ead44b292e73afcf07779c53cbe03ab20dd05dd50d1e0684d8e070dbdb0d58', nodeSha: '5d857a025a5dd39c0091023b78b15036a29d96a7107b215ca06dc4e72f22148d', semSha: 'f72976a51947b113efc364536ec4780f5f04e471474f6f82ab482b20b9eb3b9e', respChars: 134, respSha: '8b0be3d052881ac2dddd8a5cb50dfb75223fb6f02deb0dd879c358f829309037', idDriftFixed: false },
};

/** 2 条**幽灵**（盘上不存在 ⇒ 计划册侧节点 + 语义直接删；原文 sha 钉住，防"复活"） */
const GHOSTS: Record<string, { id: string; nodeSha: string; semSha: string; semKeys: string[] }> = {
  'src/infrastructure/analysis/structure/feature_map.ts': { id: 'file_src_infrastructure_analysis_structure_feature_map_ts', nodeSha: '5d5fed7722d841c205e604ffcefa3bf8ab3e9f9c9b986642b8334f8b892fbfff', semSha: 'e7b698a970c91e1ff2426f538b54f85c68b1a0e265f1501a4ba6ce3b68b16c62', semKeys: ["id","layer","lines","path","responsibility","symbols"] },
  'src/infrastructure/render/inject_replay.ts': { id: 'file_src_infrastructure_render_inject_replay_ts', nodeSha: '6f2891131dc8948dac66e8935d65101312f712f459369ae08083cb0a4cf06f05', semSha: '858472440839837adeae7d70c1a934c59871e9f91e1af7c78728929419684600', semKeys: ["id","layer","lines","path","responsibility","symbols"] },
};

/** 7 条 id 改名（`nodeIdOf` 单点派生）：旧 id 必须全册消失、新 id 必须逐字节等于派生式 */
const RENAMED: Array<{ feature: string; path: string; from: string; to: string; nodeSha: string; semSha: string; crit: number }> = [
  { feature: 'agent-io', path: 'scripts/verify-project.mjs', from: 'file_scripts_verify_project_mjs', to: 'file_scripts_verify-project_mjs', nodeSha: 'e9313bb5e27595f6684aedee26835267c96ab57651bd7bd7c20c7e257d45378a', semSha: '9163429b915f0570823241e0151c8a77f9ca5c9e6a6d01a7321161eb26545325', crit: 1 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/capability_map.ts', from: 'file_capability_map_ts', to: 'file_src_application_meta_registry_capability_map_ts', nodeSha: '5a47a84b2ca37460a7cf7b0e931dbdcbd35bfd00a0e870bb9d57e80fed749ffd', semSha: '8bc8d90bd670ffa03f770772f18ed468749a32790b8febe8d8fb8e38a1db2141', crit: 4 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/cli_extract.ts', from: 'file_cli_extract_ts', to: 'file_src_application_meta_registry_cli_extract_ts', nodeSha: 'd5aa882b6cab664f7433c19fd3cb9112884b37abd347edbe4237e7d55d8f4245', semSha: 'd65461ace9a2e818e29ccda959fcc60aef177233a7c233bde7f8cc27d5555664', crit: 0 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/collect_functions.ts', from: 'file_collect_functions_ts', to: 'file_src_application_meta_registry_collect_functions_ts', nodeSha: 'ec31d63539c76d559500de5f91e90284bfd31ee31c12dda35c0e81e4422d0c49', semSha: '334bb05889cd4f166922d4593319417e40c9a1d1e9993919171eed61d3c5c178', crit: 0 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/registry_extract.ts', from: 'file_registry_extract_ts', to: 'file_src_application_meta_registry_registry_extract_ts', nodeSha: '29eff87f2e930018c8329991c455a6597e6118c207dd53525a7ed9221171601c', semSha: 'e8b713ee3b39ae77632fbb3e3adcfad61d322ca4f5f552f64abd628461f57c9a', crit: 0 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/sync_contracts.ts', from: 'file_sync_contracts_ts', to: 'file_src_application_meta_registry_sync_contracts_ts', nodeSha: '7c59d441377d711cb3c2b6dde98a26aee137efc97380a3f7c0bd2154c308e6ae', semSha: '9f674b7ad30fc3071f9e7fe9341996c2514f7efc58f15deff13db1ab2ae47cd5', crit: 2 },
  { feature: 'agent-io-toolface', path: 'src/application/meta/registry/tool_faces.ts', from: 'file_tool_faces_ts', to: 'file_src_application_meta_registry_tool_faces_ts', nodeSha: '790efe4524713a9e38692b13f315a0efd0d59bfe19b5105f19f63f656de59ae9', semSha: '503855ce23a752cbe96d1322a593f5b6f4a768d7821837d38b9a2d8c6245ac0c', crit: 1 },
];

/** 判据守恒：三册合计 **839**（本批整份搬 29 条，不动总数） */
const CRITERIA_BEFORE = 839;
const CRITERIA_AFTER = 839;
const CRITERIA_AI_BEFORE = 803;
const CRITERIA_AI_AFTER = 832;
const CRITERIA_TSP_BEFORE = 29;
const CRITERIA_TSP_AFTER = 0;
const CRITERIA_TF_BEFORE = 7;
const CRITERIA_TF_AFTER = 7;
const CRITERIA_MOVED = 29;

/** 职责字数守恒：三册合计 **10,366**（计划册 538 字逐字跟走） */
const RESP_BEFORE = 10366;
const RESP_AFTER = 10366;
const RESP_AI_BEFORE = 9644;
const RESP_AI_AFTER = 10182;
const RESP_TSP_BEFORE = 538;
const RESP_TSP_AFTER = 0;
const RESP_MOVED = 538;

/** 册容（计划册：删 12 节点 / 12 语义 / 2 边；属主册 +10 / +10；工具面 0） */
const BEFORE_NODES_TSP = 118;
const TSP_NODES_AFTER = 106;
const BEFORE_SEM_TSP = 12;
const TSP_SEM_AFTER = 0;
const BEFORE_EDGES_TSP = 175;
const TSP_EDGES_AFTER = 173;
const BEFORE_NODES_AI = 649;
const AI_NODES_AFTER = 659;
const BEFORE_SEM_AI = 544;
const AI_SEM_AFTER = 554;
const DELETED_NODES_TSP = 12;

/** 三零终局（② 档三组读数的上界 = 0） */
const ZERO = 0;

/** 门档空集合指纹（sha256([]) = e3b0c442…） */
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const MOVED_PATHS = Object.keys(MOVED).sort();
const GHOST_PATHS = Object.keys(GHOSTS).sort();
/** 本批 12 条 path（集合相等，不是前缀） */
const BATCH_PATHS = [...MOVED_PATHS, ...GHOST_PATHS].sort();

// ════════════════════════════════════════════════════════════════════
// 15.1 真仓：12 条 path 各恰一册 = agent-io
// ════════════════════════════════════════════════════════════════════
test('15.1 真仓：12 条 path **各恰一册**持有且是 agent-io；节点 id = nodeIdOf；计划册侧 0 节点', () => {
  for (const p of BATCH_PATHS) {
    const holders = FEATURES.filter((f) => nodesOf(f).some((n) => norm(n.path) === p));
    if (GHOSTS[p]) {
      assert.deepEqual(holders, [], `\`${p}\` 是**幽灵**（盘上不存在）⇒ 三册都不许有节点（实测 ${holders.join('/')}）`);
      assert.equal(fs.existsSync(path.join(REPO, p)), false, `\`${p}\` 必须**真的**不在盘上（幽灵的定义）`);
      continue;
    }
    assert.deepEqual(holders, [AI], `\`${p}\` 必须恰一册持有且是 ${AI}（实测 ${holders.join('/') || '∅'}）`);
    const node = nodeOn(AI, p);
    assert.ok(node, `\`${p}\` 在 ${AI} 必须有节点`);
    assert.equal(String(node!.id), nodeIdOf(p), `\`${p}\` 的节点 id 必须 = nodeIdOf（实测 ${String(node!.id)}）`);
    assert.equal(String(nodeOn(TSP, p)?.id ?? ''), '', `\`${p}\` 的计划册侧节点必须已三清`);
    const sem = semOn(AI, p);
    assert.ok(sem, `\`${p}\` 在 ${AI} 必须有语义条目（一节点一条）`);
    assert.equal(String(sem!.id), nodeIdOf(p), `\`${p}\` 的语义 id 必须与节点 id 同源`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 15.1b 计划册侧三清（节点 / 语义 / 边）
// ════════════════════════════════════════════════════════════════════
test('15.1b 计划册侧**三清**：被搬/被删的旧 id 在**三册里都不再出现**（节点 + 语义 + 边端点）', () => {
  const ghostIds = GHOST_PATHS.map((p) => GHOSTS[p]!.id);
  // ★ 只有**漂移**的那些"旧 id"才会消失 —— 另外 7 条的 id 本来就等于派生式（换册不改 id），
  //   它们的"三清"判据是"只在属主册出现一次"（见下），不是"消失"。
  const driftedOldIds = MOVED_PATHS.filter((p) => MOVED[p]!.idDriftFixed).map((p) => MOVED[p]!.from.split(':')[1]!);
  assert.equal(ghostIds.length, 2, '幽灵 2 个');
  assert.equal(driftedOldIds.length, 3, '随节点搬家而消失的漂移旧 id 3 个');
  for (const id of [...ghostIds, ...driftedOldIds]) {
    for (const f of FEATURES) {
      assert.equal(nodesOf(f).filter((n) => String(n.id) === id).length, 0, `\`${id}\` 在 ${f} 仍是节点 id（半删）`);
      assert.equal(semsOf(f).filter((s) => String(s.id) === id).length, 0, `\`${id}\` 在 ${f} 仍是语义 id（幽灵语义）`);
      assert.equal(
        edgesOf(f).filter((e) => String(e.from) === id || String(e.to) === id).length,
        0,
        `\`${id}\` 在 ${f} 仍挂在边上（悬空边）`,
      );
    }
  }
  // 另外 7 条：id 不变（本来就 = 派生式）⇒ 只许在属主册出现一次，且计划册侧同 path 节点已三清
  const sameIdMoves = MOVED_PATHS.filter((p) => !MOVED[p]!.idDriftFixed);
  assert.equal(sameIdMoves.length, 7, '换册不改 id 的 7 条');
  for (const p of sameIdMoves) {
    const id = MOVED[p]!.to.split(':')[1]!;
    assert.equal(nodesOf(AI).filter((n) => String(n.id) === id).length, 1, `\`${id}\` 在 ${AI} 必须恰一个节点`);
    for (const f of [TOOLFACE, TSP]) {
      assert.equal(nodesOf(f).filter((n) => String(n.id) === id).length, 0, `\`${id}\` 不许在 ${f} 还有节点`);
      assert.equal(semsOf(f).filter((s) => String(s.id) === id).length, 0, `\`${id}\` 不许在 ${f} 还有语义`);
    }
    assert.equal(nodeOn(TSP, p), undefined, `\`${p}\` 的计划册侧节点必须已删（换手 = 搬家，不是复制）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 15.2 清单形状（常量算术）
// ════════════════════════════════════════════════════════════════════
test('15.2 清单形状：10 搬 + 2 幽灵 + 7 改名 · 码位序 · 判据表与清单逐条同集 · 3 条顺带消漂移', () => {
  assert.equal(MOVED_PATHS.length, 10, '盘上存在的属主错位 = 10 条');
  assert.equal(GHOST_PATHS.length, 2, '幽灵 = 2 条');
  assert.equal(RENAMED.length, 7, '改名 = 7 条（10 − 3 条随节点消失）');
  assert.equal(BATCH_PATHS.length, 12, '本批 path = 12（这就是"属主错位 12"）');
  assert.deepEqual([...BATCH_PATHS], [...BATCH_PATHS].sort(), '清单必须码位序（顺序漂了 = 换了名单）');
  // 3 条"随节点消失"的漂移 id 必须能在 MOVED 里点名（否则"漂移 10 → 0"的算术不闭合）
  const driftFixed = MOVED_PATHS.filter((p) => MOVED[p]!.idDriftFixed);
  assert.equal(driftFixed.length, 3, `顺带消掉的漂移必须是 3 条（实测 ${driftFixed.length}）`);
  assert.equal(driftFixed.length + RENAMED.length, 10, '3 随节点消失 + 7 改名 = 漂移 10（算术闭合）');
  // 搬走的判据逐条对表（清单里的条数就是计划册的全部）
  assert.equal(MOVED_PATHS.reduce((s, p) => s + MOVED[p]!.crit, 0), CRITERIA_MOVED, 'MOVED 的判据条数合计必须 = 29');
  assert.equal(CRITERIA_TSP_BEFORE, CRITERIA_MOVED, '计划册搬前判据 = 本批搬走的判据（一条不留）');
  // 每条改名都必须"新 id = nodeIdOf(path)"（常量自证，不靠跑）
  for (const r of RENAMED) assert.equal(r.to, nodeIdOf(r.path), `\`${r.path}\` 的目标 id 必须 = nodeIdOf`);
  for (const p of MOVED_PATHS) assert.equal(MOVED[p]!.to.split(':')[1], nodeIdOf(p), `\`${p}\` 的目标 id 必须 = nodeIdOf`);
});

// ════════════════════════════════════════════════════════════════════
// 15.3 整份搬「除 id 外逐字节」
// ════════════════════════════════════════════════════════════════════
test('15.3 **整份搬**：节点 / 散文 / 判据 / status+overlay+gate / 语义 五组 sha 逐条对表（除 id 外一位不动）', () => {
  let checked = 0;
  for (const p of MOVED_PATHS) {
    const want = MOVED[p]!;
    const node = nodeOn(AI, p);
    assert.ok(node, `\`${p}\` 必须在 ${AI} 有节点`);
    // 把 id / task.id 换回旧值 ⇒ sha 必须等于**搬前**原件的 sha（这是"整份搬"的唯一判据）
    const back = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
    const oldId = want.from.split(':')[1]!;
    back.id = oldId;
    const task = back.task as { id?: string } | undefined;
    if (task && String(task.id) === want.to.split(':')[1]) task.id = oldId;
    assert.equal(sha(back), want.nodeSha, `\`${p}\` 的节点被改过（除 id 外必须逐字节相同）`);
    assert.equal(sha(expsOf(node)), want.critSha, `\`${p}\` 的判据被改过（搬的是原件，不是重造）`);
    assert.equal(sha(proseOf(node)), want.proseSha, `\`${p}\` 的散文（decision 除 expectations）被改过`);
    assert.equal(sha(fieldOf(node)), want.nodeFieldSha, `\`${p}\` 的 status/overlay/gate 被改过`);
    const sem = semOn(AI, p);
    assert.ok(sem, `\`${p}\` 必须有语义条目`);
    const semBack = { ...JSON.parse(JSON.stringify(sem)) } as Record<string, unknown>;
    semBack.id = oldId;
    assert.equal(sha(semBack), want.semSha, `\`${p}\` 的语义条目被改过（职责 / expected_apis / symbols 都算）`);
    assert.equal(expsOf(node).length, want.crit, `\`${p}\` 的判据条数必须仍是 ${want.crit}`);
    checked += 1;
  }
  assert.equal(checked, 10, '10 条逐条都核过（分母要给出来）');
});

// ════════════════════════════════════════════════════════════════════
// 15.3b 上一条有牙（纯核副本）
// ════════════════════════════════════════════════════════════════════
test('15.3b **有牙**：纯核副本里从属主节点删 1 条判据 ⇒ 判据总数立刻 838（差额恰 1），真册不动', () => {
  type MutNode = { path?: string; decision?: { expectations?: Array<Record<string, unknown>> } };
  const world = sheets().map((s) => ({
    feature: s.feature,
    geometry: JSON.parse(JSON.stringify(s.geometry ?? {})) as { nodes?: MutNode[] },
  }));
  const total = (books: BookSheetLike[]): number =>
    books.reduce((s, b) => s + (b.geometry?.nodes ?? []).reduce((x, n) => x + (n.decision?.expectations ?? []).length, 0), 0);
  assert.equal(total(world as BookSheetLike[]), CRITERIA_AFTER, `副本起点必须 = ${CRITERIA_AFTER}`);
  const victimPath = MOVED_PATHS.find((p) => MOVED[p]!.crit > 0)!;
  assert.ok(victimPath, '至少要有一条带判据的 path 才能做反检查');
  const ai = world.find((b) => b.feature === AI)!;
  const node = (ai.geometry?.nodes ?? []).find((n) => norm(n.path) === victimPath)!;
  const before = (node.decision?.expectations ?? []).length;
  node.decision!.expectations!.pop();
  assert.equal(total(world as BookSheetLike[]), CRITERIA_AFTER - 1, '删一条判据 ⇒ 总数必须掉 1（否则这条判据是空转的）');
  assert.equal(before, MOVED[victimPath]!.crit, '被删的那条必须来自本批搬来的节点');
  // 真册一个字节没动
  assert.equal(criteriaOf(AI) + criteriaOf(TOOLFACE) + criteriaOf(TSP), CRITERIA_AFTER, '真册总数不许被副本影响');
});

// ════════════════════════════════════════════════════════════════════
// 15.4 判据守恒
// ════════════════════════════════════════════════════════════════════
test('15.4 判据守恒：**839 → 839**（agent-io 803 → 832 · 计划册 29 → 0 · 工具面 7 → 7）', () => {
  const ai = criteriaOf(AI);
  const tf = criteriaOf(TOOLFACE);
  const tsp = criteriaOf(TSP);
  assert.equal(CRITERIA_BEFORE, CRITERIA_AFTER, '本批整份搬：总数一位不动');
  assert.equal(CRITERIA_BEFORE, 839, '三册合计必须是 839（本卡的守恒式）');
  assert.equal(ai + tf + tsp, CRITERIA_BEFORE, `现盘三册合计必须 = 839（实测 ${ai + tf + tsp}）`);
  assert.equal(ai, CRITERIA_AI_AFTER, `agent-io 判据必须是 ${CRITERIA_AI_AFTER}（实测 ${ai}）`);
  assert.equal(tsp, CRITERIA_TSP_AFTER, `计划册判据必须是 ${CRITERIA_TSP_AFTER}（实测 ${tsp}）—— 它的真相一条不丢，全都搬进了属主册`);
  assert.equal(tf, CRITERIA_TF_AFTER, `工具面判据必须是 ${CRITERIA_TF_AFTER}（实测 ${tf}）—— 改名不动判据`);
  // Δ 算术：属主册涨的必须恰是本批搬走的
  assert.equal(ai - CRITERIA_AI_BEFORE, CRITERIA_MOVED, `agent-io 涨幅 ${ai - CRITERIA_AI_BEFORE} 必须 = 搬走 ${CRITERIA_MOVED}`);
  assert.equal(CRITERIA_TSP_BEFORE - tsp, CRITERIA_MOVED, '计划册降幅必须 = 搬走条数（一条不留）');
  // 逐条：搬来的 10 个节点的判据 sha 已在 15.3 核过；这里再核"计划册侧真的 0 判据"
  for (const p of MOVED_PATHS) assert.equal(expsOf(nodeOn(TSP, p)).length, 0, `\`${p}\` 计划册侧不许还挂判据`);
});

// ════════════════════════════════════════════════════════════════════
// 15.5 职责守恒
// ════════════════════════════════════════════════════════════════════
test('15.5 职责守恒：**10,366 → 10,366**（计划册 538 字逐字跟走，逐条 chars + sha）', () => {
  const ai = respCharsOf(AI);
  const tf = respCharsOf(TOOLFACE);
  const tsp = respCharsOf(TSP);
  assert.equal(RESP_BEFORE, RESP_AFTER, '本批整份搬：职责总字数一位不动');
  assert.equal(RESP_BEFORE, 10366, '三册职责合计必须是 10,366（本卡的守恒式）');
  assert.equal(ai + tf + tsp, RESP_BEFORE, `现盘三册合计必须 = 10,366（实测 ${ai + tf + tsp}）`);
  assert.equal(ai, RESP_AI_AFTER, `agent-io 职责字数必须是 ${RESP_AI_AFTER}（实测 ${ai}）`);
  assert.equal(tsp, RESP_TSP_AFTER, `计划册职责字数必须是 ${RESP_TSP_AFTER}（实测 ${tsp}）`);
  assert.equal(ai - RESP_AI_BEFORE, RESP_MOVED, `agent-io 涨幅必须 = 搬走 ${RESP_MOVED} 字`);
  assert.equal(RESP_TSP_BEFORE - tsp, RESP_MOVED, '计划册降幅必须 = 搬走字数（一字不丢）');
  for (const p of MOVED_PATHS) {
    const sem = semOn(AI, p);
    const resp = String(sem?.responsibility ?? '');
    assert.equal(resp.trim().length, MOVED[p]!.respChars, `\`${p}\` 的职责字数必须 = 搬前（${MOVED[p]!.respChars}）`);
    assert.equal(sha(resp), MOVED[p]!.respSha, `\`${p}\` 的职责原文被改写过（sha 变了）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 15.6 幽灵
// ════════════════════════════════════════════════════════════════════
test('15.6 **幽灵**：盘上不存在 · 三册 0 节点 0 语义 · 原文 sha 钉住；塞回 ⇒ ② 档立刻 owner_mismatch 1', () => {
  const table = bookTable();
  for (const p of GHOST_PATHS) {
    const g = GHOSTS[p]!;
    assert.equal(fs.existsSync(path.join(REPO, p)), false, `\`${p}\` 必须不在盘上`);
    for (const f of FEATURES) {
      assert.equal(nodeOn(f, p), undefined, `\`${p}\` 在 ${f} 不许有节点（幽灵已删）`);
      assert.equal(semOn(f, p), undefined, `\`${p}\` 在 ${f} 不许有语义条目`);
    }
    assert.deepEqual(g.semKeys, ['id', 'layer', 'lines', 'path', 'responsibility', 'symbols'], `\`${p}\` 的语义条目形状（原文的键集）`);
    // 域表：属主仍是 agent-io（"盘上没有" 不该被写成 "unowned"）
    const hit = ownerOf(table, p);
    assert.equal(hit.owner, AI, `\`${p}\` 的域表属主必须是 ${AI}（不是 unowned —— 那是把"没有的东西"写成"有主的东西"）`);
  }
  // 鉴别力：把 1 个幽灵塞回计划册 ⇒ ② 档立刻 owner_mismatch 1（这就是本批收掉的那一类）
  const world = sheets().map((s) => ({ feature: s.feature, geometry: JSON.parse(JSON.stringify(s.geometry ?? {})) }));
  const tsp = world.find((b) => b.feature === TSP)!;
  tsp.geometry!.nodes!.push({ id: GHOSTS[GHOST_PATHS[0]!]!.id, path: GHOST_PATHS[0]!, type: 'file' } as never);
  const read = crossBookOwnership(world, readDesignBooks(REPO));
  assert.equal(read.counts.owner_mismatch, 1, '塞回一个幽灵 ⇒ 属主错位必须是 1（本批的 12 就是这么来的）');
  assert.equal(crossBookOwnership(sheets(), readDesignBooks(REPO)).counts.owner_mismatch, 0, '真册仍是 0');
});

// ════════════════════════════════════════════════════════════════════
// 15.7 id 漂移 0（改名 7 条逐条）
// ════════════════════════════════════════════════════════════════════
test('15.7 **id 漂移 0**：7 条改名逐条（旧 id 全册消失 · 新 id = nodeIdOf · 语义同步 · 边端点同步 · 除 id 外逐字节）', () => {
  const read = crossBookReadingOf(REPO);
  assert.equal(read.id_drift.nodes, 0, `现盘 id 漂移必须是 0（实测 ${read.id_drift.nodes}）`);
  assert.equal(read.id_drift.paths, 0, '漂移 path 也必须是 0');
  for (const r of RENAMED) {
    const nodes = nodesOf(r.feature);
    const sems = semsOf(r.feature);
    assert.equal(nodes.filter((n) => String(n.id) === r.from).length, 0, `${r.feature}: 旧 id \`${r.from}\` 必须消失`);
    assert.equal(sems.filter((s) => String(s.id) === r.from).length, 0, `${r.feature}: 旧语义 id \`${r.from}\` 必须消失`);
    const node = nodes.find((n) => String(n.id) === r.to);
    assert.ok(node, `${r.feature}: 新 id \`${r.to}\` 必须在册`);
    assert.equal(r.to, nodeIdOf(r.path), `${r.feature}: 新 id 必须 = nodeIdOf(\`${r.path}\`)`);
    assert.equal(norm(node!.path), r.path, `${r.feature}: 改名不许换 path`);
    const sem = sems.find((s) => String(s.id) === r.to);
    assert.ok(sem, `${r.feature}: 语义条目必须同步改名（否则 validateDSL 报 anchor_broken）`);
    assert.equal(String(sem!.id), String(node!.id), `${r.feature}: 一节点一条语义且 id 同源`);
    // 边端点同步（不同步 = 断头边）
    assert.equal(
      edgesOf(r.feature).filter((e) => String(e.from) === r.from || String(e.to) === r.from).length,
      0,
      `${r.feature}: 旧 id 不许还挂在边上`,
    );
    // "除 id 外逐字节"：换回旧 id 后 sha 必须等于改名前的原件
    const back = JSON.parse(JSON.stringify(node)) as Record<string, unknown>;
    back.id = r.from;
    const task = back.task as { id?: string } | undefined;
    if (task && String(task.id) === r.to) task.id = r.from;
    assert.equal(sha(back), r.nodeSha, `${r.feature}:${r.from} 改名时被顺带改了内容（只许改 id / task.id / 边端点）`);
    const semBack = { ...JSON.parse(JSON.stringify(sem)) } as Record<string, unknown>;
    semBack.id = r.from;
    assert.equal(sha(semBack), r.semSha, `${r.feature}:${r.from} 的语义条目被顺带改了内容`);
    assert.equal(expsOf(node).length, r.crit, `${r.feature}:${r.from} 的判据条数必须不变（${r.crit}）`);
  }
  // 旧 id 的引用面（0 行）是"改名不破 judgement_ref"的依据；台账不入库 ⇒ 干净克隆里没有 tasks.db，这里不硬断
  const db = path.join(REPO, '.agent-io', 'tasks.db');
  if (fs.existsSync(db)) assert.ok(fs.statSync(db).size > 0, 'tasks.db 在但不为空才算数');
});

// ════════════════════════════════════════════════════════════════════
// 15.8 三零终局
// ════════════════════════════════════════════════════════════════════
test('15.8 **三零终局**：多册持有 0 ∧ 属主错位 0 ∧ id 漂移 0（② 档现读 + 基线三组 count=0 且 sha = 空集合指纹）', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.equal(now.multi_owned.length, ZERO, `多册持有必须是 ${ZERO}（实测 ${now.multi_owned.length}）`);
  assert.equal(now.owner_mismatch.length, ZERO, `属主错位必须是 ${ZERO}（实测 ${now.owner_mismatch.length}: ${now.owner_mismatch.join(',')}）`);
  assert.equal(now.id_drift.length, ZERO, `id 漂移必须是 ${ZERO}（实测 ${now.id_drift.length}: ${now.id_drift.join(',')}）`);
  // ★ 独立复算（不走 crossBookReadingOf）：三册节点级 holdings
  const holdings = bookHoldings(sheets());
  const multi = [...holdings.entries()].filter(([, hs]) => new Set(hs.map((h) => h.feature)).size >= 2);
  assert.equal(multi.length, 0, `独立复算：多册持有也必须是 0（实测 ${multi.length}）`);
  const table = bookTable();
  const mismatch = [...holdings.entries()].filter(([p, hs]) => {
    const feats = [...new Set(hs.map((h) => h.feature))];
    if (feats.length !== 1) return false;
    const hit = ownerOf(table, p);
    return hit.matched && hit.owner !== null && hit.owner !== feats[0];
  });
  assert.equal(mismatch.length, 0, `独立复算：属主错位也必须是 0（实测 ${mismatch.map(([p]) => p).join(',')}）`);
  // 门档：三组指纹 = 空集合指纹，且与基线逐字一致
  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}`);
    assert.equal(b.count, 0, `基线 ${key}.count 必须是 0（终局写进账）`);
    assert.equal(b.sha256, EMPTY_SHA, `基线 ${key}.sha256 必须是空集合指纹（实测 ${b.sha256.slice(0, 12)}）`);
    assert.equal(shaOfList(now[key]), EMPTY_SHA, `现盘 ${key} 的指纹必须是空集合指纹`);
    assert.equal(b.sha256, shaOfList(now[key]), `基线 ${key} 与现盘集合必须逐字一致（集合变了就该显式改基线）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 15.9 写端有牙（纯函数 4 世界 + 真 saveDSL 1 世界）
// ════════════════════════════════════════════════════════════════════
test('15.9 写端有牙：非属主册再建这些 path ⇒ 拒（not_owner / new_duplicate / bad_id 各一世界）· 属主册自写放行', () => {
  const table = bookTable();
  const read = { table, file: 'design-books.json', error: '' };
  const aiNodes = bookOf(AI).geometry as { nodes: Array<Record<string, unknown>> };
  const tspNodes = bookOf(TSP).geometry as { nodes: Array<Record<string, unknown>> };
  const before = JSON.stringify({ ai: aiNodes.nodes.length, tsp: tspNodes.nodes.length });

  // 世界①：计划册给**属主错位**的 path 建节点（id 正确）⇒ not_owner（域表说属主是 agent-io）
  const w1 = assessWriteEnd({
    feature: TSP,
    before: { feature: TSP, geometry: bookOf(TSP).geometry as BookSheetLike['geometry'] },
    after: { feature: TSP, geometry: { nodes: [...tspNodes.nodes, { id: nodeIdOf(MOVED_PATHS[5]!), type: 'file', path: MOVED_PATHS[5]! }] } },
    others: [{ feature: AI, geometry: bookOf(AI).geometry as BookSheetLike['geometry'] }],
    books: read,
  });
  assert.ok(w1.issues.some((i) => i.code === 'not_owner' && norm(i.path) === MOVED_PATHS[5]!), `世界①：非属主册建属主 path ⇒ not_owner（实得 ${JSON.stringify(w1.issues.map((i) => i.code))}）`);

  // 世界②：属主册自己建同一个节点 ⇒ 放行（这才是本批做的事）
  const w2 = assessWriteEnd({
    feature: AI,
    before: { feature: AI, geometry: bookOf(AI).geometry as BookSheetLike['geometry'] },
    after: { feature: AI, geometry: { nodes: [...aiNodes.nodes, { id: nodeIdOf('src/domain/space_probe.ts'), type: 'file', path: 'src/domain/space_probe.ts' }] } },
    others: [{ feature: TSP, geometry: bookOf(TSP).geometry as BookSheetLike['geometry'] }],
    books: read,
  });
  assert.equal(w2.issues.length, 0, `世界②：属主册写自己 owns 的 path 必须放行（实得 ${JSON.stringify(w2.issues)}）`);

  // 世界③：属主册用**老一代手写 id** 建节点 ⇒ bad_id（这就是本批收掉的 6 个工具面手写式）
  const tfPath = RENAMED.find((r) => r.feature === TOOLFACE)!.path;
  const w3 = assessWriteEnd({
    feature: TOOLFACE,
    before: { feature: TOOLFACE, geometry: bookOf(TOOLFACE).geometry as BookSheetLike['geometry'] },
    after: { feature: TOOLFACE, geometry: { nodes: [...nodesOf(TOOLFACE), { id: 'file_probe_ts', type: 'file', path: tfPath }] } },
    others: [],
    books: read,
  });
  assert.ok(w3.issues.some((i) => i.code === 'bad_id'), `世界③：手写 id ⇒ bad_id（实得 ${JSON.stringify(w3.issues.map((i) => i.code))}）`);

  // 世界④：计划册在**属主册已持有**的 path 上再建一个 ⇒ new_duplicate + 换手提示
  const w4 = assessWriteEnd({
    feature: TSP,
    before: { feature: TSP, geometry: bookOf(TSP).geometry as BookSheetLike['geometry'] },
    after: { feature: TSP, geometry: { nodes: [...tspNodes.nodes, { id: nodeIdOf(MOVED_PATHS[3]!), type: 'file', path: MOVED_PATHS[3]! }] } },
    others: [{ feature: AI, geometry: bookOf(AI).geometry as BookSheetLike['geometry'] }],
    books: read,
  });
  assert.ok(w4.issues.some((i) => i.code === 'new_duplicate'), `世界④：双持 ⇒ new_duplicate（实得 ${JSON.stringify(w4.issues.map((i) => i.code))}）`);
  assert.ok(w4.transfers.includes(MOVED_PATHS[3]!), '世界④必须把它记成 transfer（换手路径）');
  assert.equal(JSON.stringify({ ai: aiNodes.nodes.length, tsp: tspNodes.nodes.length }), before, '纯函数判据不许改真册');
});

test('15.9b 真 `saveDSL`：非属主册给这些 path 建节点 ⇒ **前置拒** 且盘上零字节变化；属主册自写 ⇒ 落盘', () => {
  const home = makeTempHome('a8a9b15');
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
    // 本批完成后的状态：属主册有节点，计划册没有（域表：计划册 owns 为空）
    sheet(AI, [{ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' }]);
    sheet(TSP, []);
    registerFeature(AI, proj, 'test');
    registerFeature(TSP, proj, 'test');

    // 世界一：计划册（非属主）想给这个 path 建节点 ⇒ 拒（not_owner + new_duplicate 两手）
    const tsp = JSON.parse(fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8')) as { geometry: { nodes: unknown[] } };
    tsp.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const beforeBytes = fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8');
    assert.throws(
      () => saveDSL(tsp as never, 'mcp', undefined, { baseDir: proj }),
      /归属判据|not_owner|new_duplicate|属主|已由/,
      '非属主册给属主 path 建节点必须**前置拒**（否则"批 15 收干净"是可撤销的）',
    );
    assert.equal(fs.readFileSync(path.join(dir, `${TSP}.dsl.json`), 'utf8'), beforeBytes, '被拒的写不许留下任何痕迹');

    // 世界二：属主册自己写自己 owns 的 path ⇒ 过（这才是本批真正做的事）
    const ai = JSON.parse(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8')) as {
      geometry: { nodes: Array<{ decision?: { expectations: unknown[] } }> };
    };
    ai.geometry.nodes[0]!.decision = { expectations: [] };
    saveDSL(ai as never, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(path.join(dir, `${AI}.dsl.json`), 'utf8')) as { _dsl_rev?: number };
    assert.equal(typeof after._dsl_rev, 'number', '属主册自写必须落盘（rev 前进）');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 15.10 漂移判据有牙（纯函数两世界）
// ════════════════════════════════════════════════════════════════════
test('15.10 **漂移判据有牙**（两世界）：同一个节点 id 换成手写式 ⇒ `nodeIdDriftOf` 0 → 1', () => {
  const base = sheets();
  assert.equal(nodeIdDriftOf(base).nodes, 0, '真册：漂移必须是 0');
  const world = base.map((s) => ({ feature: s.feature, geometry: JSON.parse(JSON.stringify(s.geometry ?? {})) }));
  const tf = world.find((b) => b.feature === TOOLFACE)!;
  const node = (tf.geometry?.nodes ?? []).find((n) => norm(n.path) === RENAMED.find((r) => r.feature === TOOLFACE)!.path)!;
  node.id = 'file_handwritten_ts';
  const drift = nodeIdDriftOf(world);
  assert.equal(drift.nodes, 1, '把手写 id 塞回 ⇒ 漂移必须是 1（判据不是恒 0 的摆设）');
  assert.equal(drift.rows[0]!.want, nodeIdOf(String(node.path)), 'want 必须是单点派生式（这就是"规范化"的目标）');
  // 反向：把 id 改成派生式 ⇒ 立刻回 0
  node.id = nodeIdOf(String(node.path));
  assert.equal(nodeIdDriftOf(world).nodes, 0, '改成派生式 ⇒ 漂移回 0');
});

// ════════════════════════════════════════════════════════════════════
// 15.11 册容
// ════════════════════════════════════════════════════════════════════
test('15.11 册容：计划册 118 → 106 · 12 → 0 · 175 → 173（删 12 / 12 / 2）；属主册 649 → 659 · 544 → 554', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES_TSP, TSP_NODES_AFTER, '计划册节点数：118 − 12 = 106（10 搬走 + 2 幽灵）');
  assert.equal(TSP_SEM_AFTER, 0, `计划册语义：12 − 12 = ${TSP_SEM_AFTER}（一节点一条，全跟走）`);
  assert.equal(BEFORE_SEM_TSP - 12, TSP_SEM_AFTER, `计划册语义降幅必须 = 12（实测 ${BEFORE_SEM_TSP} → ${TSP_SEM_AFTER}）`);
  assert.equal(BEFORE_EDGES_TSP - 2, TSP_EDGES_AFTER, '计划册边：175 − 2 = 173（两条幽灵各带 1 条；搬走的 10 条本来 0 边）');
  // ★ 棘轮：批 15 收口值只作上界（后续批还会继续删 —— 计划册退役在批 17）
  assert.ok(nodesOf(TSP).length <= TSP_NODES_AFTER, `计划册节点数只许减（批 15 收口 ${TSP_NODES_AFTER}；实测 ${nodesOf(TSP).length}）`);
  assert.ok(semsOf(TSP).length <= TSP_SEM_AFTER, `计划册语义只许减（批 15 收口 ${TSP_SEM_AFTER}；实测 ${semsOf(TSP).length}）`);
  assert.ok(edgesOf(TSP).length <= TSP_EDGES_AFTER, `计划册边只许减（批 15 收口 ${TSP_EDGES_AFTER}；实测 ${edgesOf(TSP).length}）`);
  // 语义条目与节点必须一节点一条（半删会留下幽灵语义）
  const nodeIds = new Set(nodesOf(TSP).map((n) => String(n.id)));
  assert.deepEqual(semsOf(TSP).filter((s) => !nodeIds.has(String(s.id))), [], '计划册不许留幽灵语义');
  // 属主册：+10 节点 / +10 语义（收的是节点，不是"只写了语义"）
  assert.equal(AI_NODES_AFTER - BEFORE_NODES_AI, 10, '属主册节点 +10');
  assert.equal(AI_SEM_AFTER - BEFORE_SEM_AI, 10, '属主册语义 +10');
  assert.ok(nodesOf(AI).length >= AI_NODES_AFTER, `属主册节点只许增（批 15 收口 ${AI_NODES_AFTER}；实测 ${nodesOf(AI).length}）`);
  // 工具面：改名不动册容
  assert.equal(nodesOf(TOOLFACE).length, 6, '工具面仍是 6 个节点（改名不是重建）');
  assert.equal(semsOf(TOOLFACE).length, 6, '工具面仍是 6 条语义');
});

// ════════════════════════════════════════════════════════════════════
// 15.12 派生快照
// ════════════════════════════════════════════════════════════════════
test('15.12 **派生快照**：COGNITION.txt 里每册的 dsl_rev = 册上现值（改册不重生成快照 ⇒ 这里红）', () => {
  const cogFile = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(cogFile), 'COGNITION.txt 必须在仓里（它是入库的派生快照）');
  const lines = fs.readFileSync(cogFile, 'utf8').split('\n');
  let seen = 0;
  for (const line of lines) {
    const m = line.match(/^===feature ([a-z0-9-]+)=== dsl_rev=(\d+) sha256=[0-9a-f]{16}$/);
    if (!m) continue;
    const f = m[1]!;
    const rev = Number(m[2]);
    const book = bookOf(f);
    assert.equal(rev, Number(book._dsl_rev ?? -1), `${f}: COGNITION 的 dsl_rev（${rev}）≠ 册上现值（${String(book._dsl_rev)}）—— 改册要 `+'`npm run cognition`');
    seen += 1;
  }
  // ★ 2026-11-18（批 17 · 计划册退役）：3 册 → **2 册**。快照里现在只有两本活册的段头；
  //   计划册那一段**必须消失**（否则读快照的人以为它还活着）—— 由 `p1_cross_book_batch17.test.ts` 的 17.8 钉。
  assert.equal(seen, 2, `快照必须覆盖**两本活册**（实测 ${seen} 段；计划册已于批 17 退役）`);
});

// ════════════════════════════════════════════════════════════════════
// 15.13 旧证棘轮
// ════════════════════════════════════════════════════════════════════
test('15.13 旧证棘轮：批 1 的 6 个手写 id 已不在册（改成派生式）；批 14 的"属主错位 12"已归零', () => {
  const tf = nodesOf(TOOLFACE).map((n) => String(n.id));
  for (const p of [
    'src/application/meta/registry/capability_map.ts',
    'src/application/meta/registry/cli_extract.ts',
    'src/application/meta/registry/collect_functions.ts',
    'src/application/meta/registry/registry_extract.ts',
    'src/application/meta/registry/sync_contracts.ts',
    'src/application/meta/registry/tool_faces.ts',
  ]) {
    const handwritten = `file_${path.basename(p).replace(/\.ts$/, '')}_ts`;
    assert.equal(tf.includes(handwritten), false, `批 1 保留的手写 id \`${handwritten}\` 必须已由批 15 规范化（仍在册 = 批 15 没落地）`);
    assert.equal(tf.includes(nodeIdOf(p)), true, `必须换成派生 id \`${nodeIdOf(p)}\``);
  }
  const read = crossBookReadingOf(REPO);
  assert.equal(read.counts.owner_mismatch, 0, '批 14 收口时的"属主错位 12"必须已归零（批 15 的全部工作）');
  // 三册都在（归零**不是**删册换来的）
  for (const f of FEATURES) assert.ok(nodesOf(f).length > 0, `${f} 必须还在（归零不是删册）`);
  assert.equal(criteriaOf(TOOLFACE), CRITERIA_TF_AFTER, '工具面的判据一条没丢（改名不动判据）');
});

// ════════════════════════════════════════════════════════════════════
// 15.14 搬完还判得动（抽样现判）
// ════════════════════════════════════════════════════════════════════
test('15.14 **搬完还判得动**：抽 2 条搬来的判据（behavior-cases / call-exists）在属主册节点上现判 ⇒ pass', async () => {
  const picks: Array<{ p: string; kind: string }> = [
    { p: 'src/application/design/dsl_ops/slot_source.ts', kind: 'behavior-cases' },
    { p: 'src/infrastructure/authority/scan_authorities.ts', kind: 'call-exists' },
  ];
  const items = picks.map(({ p, kind }) => {
    const node = nodeOn(AI, p);
    assert.ok(node, `\`${p}\` 必须在属主册`);
    const exp = expsOf(node).find((e) => String(e.kind) === kind);
    assert.ok(exp, `\`${p}\` 必须有 ${kind} 判据（搬的时候丢了？）`);
    return { node_id: String(node!.id), node_label: String(node!.label ?? p), expectation: exp! };
  });
  const report = await judgeExpectations(REPO, items as never);
  assert.equal(report.items.length, 2, '两条都要有判定（少一条 = 判不动）');
  for (const it of report.items) {
    assert.equal(String(it.verdict), 'pass', `搬来的判据必须仍判得动且为 pass（实得 ${String(it.verdict)}：${String(it.detail).slice(0, 300)}）`);
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
