/**
 * P1 路 T-#A8A9-CROSS-BOOK **批 14**：**D2 终局**（两侧**都带判据**的最后 2 条真歧义）
 * —— `parse/kernel.ts`（1v3）· `storage.ts`（1v15）：
 * 判据 **并集**（属主侧原件 2 条一位不动 + 计划册侧 **18 条**逐字跟在后）+ 计划册独有散文 **3 键**搬 +
 * 两侧同键不同值 **10 个值**逐字进台账存档 + 计划册侧 2 个节点三清 + 域表 `owns` **2 → 0**。
 * 出口：**多册持有 2 → 0**（T-#A8A9 的迁移阶段收官）· 判据 839 守恒 · 职责字数 10,366 守恒。
 *
 * ## 这批要立的十九条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 14.1 | 真仓：2 个 path **各恰一册**持有且是 `agent-io`；节点 id = `nodeIdOf`；判据条数 4 / 16（并集） | 并集没落 / 删错册 / 判据丢条在这里红 |
 * | 14.1b | 计划册侧**三清**（节点 + 语义 + 边）：2 个被删节点 id 在**非属主册**里不再出现 | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 14.2 | 清单形状：2 条 · **码位序** · 判据表与清单**逐条同集** · 存档 10 值 · 独有键 3 · 算术 2 + 0 = 2 | 手抄错一条 / 顺序漂了在这里红 |
 * | 14.2b | **终局断言：多册持有 = 0**（② 档 + 独立复算两条路都 0）；D2 类余 0 | 谁又造出双册持有，这里红 |
 * | 14.3 | 判据**逐字节并集**：并集 sha 逐条对表；前段 = 属主侧原件；后段 18 条 = 计划册侧原件；总数守恒 **839** | 搬重 / 重写 / 顺手改判据在这里红 |
 * | 14.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 839，差额恰是该节点的判据数 | 空断言的照妖镜（R47） |
 * | 14.4 | 甲′ 散文：胜利侧原文逐字未动 + 计划册**独有**键 3 个逐字搬过来 | 把散文抄歪 / 把败方叙事顶掉在这里红 |
 * | 14.4b | 甲′ 节点字段：属主侧 `status`/`overlay` 与 `semantic.status` **一位不动**（计划册的 `draft`/`draft` 只进存档） | 把属主侧状态改成败方值在这里红 |
 * | 14.4c | 甲′ 职责 + 存档：0 字搬（两侧空串）· 三册总字数 **10,366** 守恒 · 本批存档 **10 值** | 报"搬了 0 字"却改了总数 / 存档漏值在这里红 |
 * | 14.5 | 域表**改判 2 条**：属主 = `agent-io`；计划册 `owns` **2 → 0**（空数组）；前缀仍在 | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 14.6 | ② 档：2 条 klass = `owned`；**塞回任一条** ⇒ 立刻 `multi_owned`（鉴别力）；path 分母**只许不降** | 纯核两世界对照，不碰真册 |
 * | 14.7 | 写端：批 14 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 改判可逆 / 一刀切都在这里红 |
 * | 14.8 | 门档：多册持有 **= 0**（**终局**）· id 漂移 10 · 属主错位 12；三组集合指纹与基线逐字一致 | 谁改了册而不改基线，这里红 |
 * | 14.9 | **存档读回逐字（10 值）**：本批 2 条事件 / 10 个值逐字节可复算 + 人读段含原文；批 10/11 的 36 条不进水 | 存档少一个值 / 改写过 / 把别批算成自己的，都在这里红 |
 * | 14.9b | 上一条**可移植**：夹具里 `hangRow` + `annotateRow` 往返（10 值 payload 与空 payload 两种都要读得回） | 同上 |
 * | 14.10 | 算术闭合：三册判据 `803 + 29 + 7 = 839`；两册都还在（**不是**"删册"换来的归零） | 用删册凑 0 在这里红 |
 * | 14.10b | **判据只搬一次**：纯核里补回 2 个**空壳** ⇒ 多册 +2 而判据仍 839；再把 18 条补回 ⇒ **857**（双份） | 判据被复制成两份 / 只删节点没搬，都在这儿露 |
 * | 14.11 | **卡账（CARD_LEAVE）**：2 条带卡；**0 次卡操作**、活卡仍在库里（kernel candidate）、属主册卡投影原样 | 悄悄把卡删了 / 顺手把卡搬成"属主侧卡"，都在这里红 |
 * | 14.12 | 计划册册容：120 → 118 · 14 → 12 · 182 → 175（删 2 / 2 / 7）+ 无幽灵语义 | 只删一种、留下悬空边在这里红 |
 * | 14.13 | **派生快照**：`COGNITION.txt` 里每册的 `dsl_rev` = 册上现值（过期快照在这里红） | 改了册不重生成快照，这里红 |
 * | 14.14 | 真视图：`docs/todo.md` == 引擎现算（`current`）· 视图里 0 处 `archive-payload` · 摘要行 = 引擎里 38 条 | 视图与引擎各说一套在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–13 的裁定）
 * · 真仓读数（`process.cwd()`）只钉**不变量**（2 个 path 恰一册持有 · 判据总数 839 · 职责字数 10,366 · 判据逐条 sha）；
 * · 门档断的是**集合指纹与基线逐字一致** + 多册持有 **= 0**（这是批 14 的出口，不是"当前值恰好 0"）；
 * · ★ 只许钉三类东西 —— ① "我这批的 path 不在坏集合里"（永久真）② "总数只许不增"（棘轮）
 *   ③ "我这批的 Δ = 我这批的 path 数 / 判据数 / 字数"（常量算术）。**不许钉**"总数 = 我这批收口时的那个数"。
 * · 每一条"有牙"的反检查（14.3b / 14.10b）都跑在**纯核副本**上：真册一个字节都不动。
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
import { VIEW_REL, renderLedgerView } from '../src/application/ledger/render_ledger_view.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TSP = 'task-system-plan';
const TOOLFACE = 'agent-io-toolface';
const LEDGER_REF = 'T-#A8A9-CROSS-BOOK';
const BATCH_TAG = 'A8A9-batch14';
/** 存档 body 的分段标记（与执行器同格式；本文件的解析器**自己写**，不 import 执行器） */
const PAYLOAD_END = '── archive-payload（base64，逐字可复算）──';

// ─── 常量块（由 %TEMP%\a8a9-b14-genconsts.mjs 现盘导出；这批的钉子）───────────────

const BATCH: readonly string[] = [
  'src/infrastructure/parse/kernel.ts',
  'src/infrastructure/storage.ts',
];

/** 判据**并集**的钉子：属主侧原件（own）+ 计划册侧跟走（moved）⇒ 并集 sha（落盘后必须逐字相同） */
const CRITERIA_UNION: Record<string, { own: number; ownSha: string; moved: number; movedSha: string; union: number; unionSha: string }> = {
  'src/infrastructure/parse/kernel.ts': { own: 1, ownSha: '39dce0e9ff3b579873d297fe7fe10270f45bb82ef9117c87fd90671b2892da8a', moved: 3, movedSha: '081b25068dcfe459e42fec9cc9a0be777c733b152065f6f1584db0f2774c5c69', union: 4, unionSha: '59a0e6f2d3d917e8d2fa80614ae336c41ea1d966784451b2c177b47ce42030a1' },
  'src/infrastructure/storage.ts': { own: 1, ownSha: 'd974f047d6d147f7a6715ffec4df09302b712dd71719b84d959bac8569a04731', moved: 15, movedSha: 'f1e87ecd1a3dd1c09c157c5960233a26ca0424916277e2a8fded6f5ef79b2e74', union: 16, unionSha: '0c4e96182896a59df4b5d623a66808e6b6b404c36e32a6cf8ad54e17999be573' },
};

/** 甲′ 的"存档"那一支：两侧**同键不同值**被"属主侧为准"顶掉、逐字进台账的 10 个值（sha256 钉住原文） */
const ARCHIVE: Record<string, Record<string, string>> = {
  'src/infrastructure/parse/kernel.ts': { 'decision.rationale': 'e271aca50d180675af0e65816cf62053946e7c27237ea802fc0f9525173f274c', 'decision.summary': '0c6c4af84b3edd9c376de0017451a02a04b0d3f969523420115a4fd7d5e51c5e', 'decision.updated_at': '74159fb5175f2aef4047b8083866b7b466ba2042da4fec12fe9c072722d0be2d', 'node.overlay': '5cbce9d0cc020dc834c5502c2cf6c703cee55c4e067b6ddad3497c112bbe8eaa', 'node.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1', 'semantic.status': '6ae048f08fcab44bfbc8463f074bfdb40f94c6bdf56d3aad9a7e1c05e5d5b5c1' },
  'src/infrastructure/storage.ts': { 'decision.agent': '5e9ec57c9b11efc5737db09b40194e056dfb796d8929ff9ceac1833d5b6e8e5d', 'decision.summary': 'd218a295bd05e38eafc23fd136ebec9aadcf50a64889a6bfda6dc09a050f9b35', 'decision.updated_at': '5b5514573fcbafa4adda66bfa828cf7443ee08cab98c547d773ab393efa0e0f1', 'node.overlay': 'c4eb2f23037a39bb7b999852c318ffbd50bdaa21f0eac0c92a1417b732d4ecc7' },
};

/** 甲′ 的"搬"那一支：计划册**独有**键（属主侧没有 ⇒ 搬过来；sha256 钉住原文） */
const PROSE_MOVED: Record<string, Record<string, string>> = {
  'src/infrastructure/parse/kernel.ts': { 'acceptance': '4fac306ec51dae1081ed127e5f2d9fcf0bde51a8f7fe10eb9dadc6f2a7581872', 'consequences': 'fd3d7ad2d88f49c18ba985264c56294ae845d1e16c639590065eee0e7cf0577f' },
  'src/infrastructure/storage.ts': { 'rationale': '3f5bbce41f545b9d7c80215bf44aadcc760ffe06816a5009b5483de6819c9789' },
};

/** 属主侧**胜方原文**必须一位不动：decision 散文（被存档的那些键）+ 节点 status/overlay + semantic.status（`__node__` / `__sem__` 是后两者的合并 sha） */
const KEEPER_KEPT: Record<string, Record<string, string>> = {
  'src/infrastructure/parse/kernel.ts': { 'decision.rationale': '77bfcdcbeb2d0815efab101c617d5095bf15357ee908dac50d9211ff912619be', 'decision.summary': '684d0818c1510231f2346301d12ccf0936075f518d9bfa2a918a7bc3084a2716', 'decision.updated_at': '9424368bc3f459f9dff63ba8f933aca6f1249f5c326a025d207cf32d35f3e744', '__node__': 'e501e163010c747fe3546dd55ed2758189840532c8004a33c616598c50b2a0a2', '__sem__': '841f535e1da99e115502c1355abdf4bc68ec287836e6a22a3ee5899b46d321c9' },
  'src/infrastructure/storage.ts': { 'decision.agent': '89050178a6f51aa5e59f885866b9c5fec554a75c437ddfdcc5875c2ba87117a1', 'decision.summary': '00a1e29e4e8a6d0f8a865e71f8cc5acc7952bb332ad6cdbc93711a655b170809', 'decision.updated_at': '46745ef3c9e92a682f3a68b01856de9bcd381af0c715e37f3074db21b88ca205', '__node__': 'b360a8ddaa15c23c83e60cff67156774a8fbbb2166956016d29e3906b5a0bb07', '__sem__': '841f535e1da99e115502c1355abdf4bc68ec287836e6a22a3ee5899b46d321c9' },
};

/** 卡的原始快照（CARD_LEAVE 口径：本批 0 次卡操作 ⇒ 卡的状态/位置一个字节都不许变） */
const CARD_SNAPSHOT: Record<string, readonly string[]> = {
  'src/infrastructure/parse/kernel.ts': ['candidate@book:task-system-plan', 'done@book:agent-io', 'candidate@live:task-system-plan'],
  'src/infrastructure/storage.ts': ['done@book:task-system-plan', 'done@book:agent-io'],
};

/** 迁移后属主册的 decision 键集合（逐条对表：多一个 = 凭空造 / 少一个 = 丢叙事） */
const DECISION_KEYS: Record<string, readonly string[]> = {
  'src/infrastructure/parse/kernel.ts': ['acceptance', 'agent', 'author', 'consequences', 'expectations', 'rationale', 'status', 'summary', 'updated_at'],
  'src/infrastructure/storage.ts': ['acceptance', 'agent', 'author', 'expectations', 'rationale', 'status', 'summary', 'tags', 'updated_at'],
};

/** 计划册侧删掉的 2 个节点 id（全是 `nodeIdOf` 单点派生，漂移 0 个） */
const DELETED_IDS: readonly string[] = [
  'file_src_infrastructure_parse_kernel_ts',
  'file_src_infrastructure_storage_ts',
];

/** 带卡留账（CARD_LEAVE 口径：卡一个字节不动，仅记录） */
const CARD_LEAVE: readonly string[] = [
  'src/infrastructure/parse/kernel.ts',
  'src/infrastructure/storage.ts',
];

/** 读数（常量算术：只钉"Δ = 本批 path 数 / 判据数 / 字数"这类恒等式） */
const CRITERIA_TOTAL = 839;
const BEFORE_CRITERIA_AI = 785;
const CRITERIA_IN_AI = 803;
const BEFORE_CRITERIA_TSP = 47;
const CRITERIA_IN_TSP = 29;
const CRITERIA_IN_TOOLFACE = 7;
const CRITERIA_MOVED_COUNT = 18;
const UNION_CRITERIA = 20;
const RESP_TOTAL_BEFORE = 10366;
const RESP_TOTAL_AFTER = 10366;
const RESP_AI_BEFORE = 9644;
const RESP_AI_AFTER = 9644;
const RESP_TSP_BEFORE = 538;
const RESP_TSP_AFTER = 538;
const RESP_TOOLFACE = 184;
const RESP_MOVED_CHARS = 0;
const MULTI_BEFORE = 2;
const MULTI_AFTER = 0;
const ID_DRIFT_BEFORE = 10;
const ID_DRIFT_AFTER = 10;
const OWNER_MISMATCH = 12;
const TSP_OWNS_BEFORE = 2;
const TSP_OWNS_AFTER = 0;
const DELETED_NODES = 2;
const DELETED_SEMANTICS = 2;
const DELETED_EDGES = 7;
const TSP_EDGES_AFTER = 175;
const BEFORE_NODES_TSP = 120;
const TSP_NODES_AFTER = 118;
const BEFORE_SEM_TSP = 14;
const TSP_SEMANTIC_AFTER = 12;
const BEFORE_EDGES_TSP = 182;
const ARCHIVE_PATHS = 2;
const ARCHIVE_VALUES = 10;
const PROSE_MOVED_KEYS = 3;
const LIVE_CARDS = 1;
// ★ 2026-11-18（批 15）：568/569 → **567** —— 2 个**幽灵** path（盘上根本不存在：feature_map.ts / inject_replay.ts）
//   的计划册侧节点被删 ⇒ "持有 path 的分母"掉 2。这不是"有人删了活文件的节点"（活文件的 10 条是**换册**，分母不动）。

const PATHS_FLOOR = 567;
const BEFORE_NODES_AI = 649;

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
// 14.1 / 14.1b 持有者唯一 + 计划册三清
// ════════════════════════════════════════════════════════════════════
test('14.1 真仓：2 个 path 各自**恰一册**持有且是 agent-io；节点 id = nodeIdOf；判据条数 4 / 16（并集）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of BATCH) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.deepEqual(feats, [AI], `\`${p}\` 必须恰由 ${AI} 持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
    const want = CRITERIA_UNION[p]?.union;
    assert.equal(typeof want, 'number', `\`${p}\` 必须在判据表里（漏一条 = 有一条没人核）`);
    assert.equal(hs[0]?.expectations, want, `\`${p}\` 的判据条数必须是 ${String(want)}（实测 ${hs[0]?.expectations}）`);
  }
});

test('14.1b 计划册里这 2 个 path 的节点 / 语义 / 边都不在了；2 个被删节点 id 在非属主册里不再出现', () => {
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
  for (const id of DELETED_IDS) assert.ok(!idsOutsideAi.has(id), `被删节点 \`${id}\` 必须已从**非属主册**里消失（属主册同 id 那个是它的家）`);
  const driftAmongDeleted = DELETED_IDS.filter((id) => !BATCH.some((x) => nodeIdOf(x) === id));
  assert.deepEqual(driftAmongDeleted, [], '被删的 id 必须逐条等于 nodeIdOf(某条本批 path) —— 一个漂移旧 id 都没有');
});

// ════════════════════════════════════════════════════════════════════
// 14.2 / 14.2b 清单形状 + **终局**（多册持有 = 0）
// ════════════════════════════════════════════════════════════════════
test('14.2 清单形状：2 条 · 码位序 · 判据表与清单逐条同集 · 存档 10 值 · 独有键 3 · 算术 2 + 0 = 2', () => {
  assert.equal(BATCH.length, 2, `本批 2 条（实测 ${BATCH.length}）`);
  assert.deepEqual([...BATCH].sort(), BATCH, '本批必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.equal(new Set(BATCH).size, BATCH.length, '清单不许有重复 path');
  assert.deepEqual(BATCH, ['src/infrastructure/parse/kernel.ts', 'src/infrastructure/storage.ts'], '本批逐条 = D2 2 条（kernel + storage）');
  assert.deepEqual(Object.keys(CRITERIA_UNION).sort(), [...BATCH].sort(), '判据表必须与清单**逐条同集**');
  assert.equal(Object.values(CRITERIA_UNION).reduce((s, x) => s + x.moved, 0), CRITERIA_MOVED_COUNT, `跟走的判据合计 ${CRITERIA_MOVED_COUNT} 条`);
  assert.equal(Object.values(CRITERIA_UNION).reduce((s, x) => s + x.union, 0), UNION_CRITERIA, `并集合计 ${UNION_CRITERIA} 条`);
  assert.equal(Object.values(CRITERIA_UNION).reduce((s, x) => s + x.own, 0), 2, '属主侧原件 2 条（1 + 1）');
  for (const [p, x] of Object.entries(CRITERIA_UNION)) {
    assert.equal(x.union, x.own + x.moved, `\`${p}\`：并集必须是"原件 + 跟走"的算术和`);
    assert.equal(x.own, 1, `\`${p}\` 属主侧原件恰 1 条（1v3 / 1v15）`);
  }
  assert.equal(Object.keys(ARCHIVE).length, ARCHIVE_PATHS, '存档表必须逐条覆盖本批 path');
  assert.equal(Object.values(ARCHIVE).reduce((s, o) => s + Object.keys(o).length, 0), ARCHIVE_VALUES, `存档值合计 ${ARCHIVE_VALUES} 个`);
  assert.equal(Object.keys(ARCHIVE['src/infrastructure/parse/kernel.ts'] ?? {}).length, 6, 'kernel.ts 存档 6 个值');
  assert.equal(Object.keys(ARCHIVE['src/infrastructure/storage.ts'] ?? {}).length, 4, 'storage.ts 存档 4 个值');
  assert.equal(Object.values(PROSE_MOVED).reduce((s, o) => s + Object.keys(o).length, 0), PROSE_MOVED_KEYS, `独有键 ${PROSE_MOVED_KEYS} 个`);
  assert.equal(BATCH.length + MULTI_AFTER, MULTI_BEFORE, '本批 2 + 收完 0 = 批 13 收口时的 2 条多册持有（算术闭合）');
  assert.equal(LIVE_CARDS, 1, '活卡 1 张（kernel.ts 的 candidate）');
});

test('14.2b **终局断言：多册持有 = 0**（② 档 + 独立复算两条路都要 0）；D2 类余 0', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  assert.deepEqual(multi, [], `② 档：多册持有必须**恰好 0**（实测 ${multi.length}：${multi.join(', ')}）`);
  assert.equal(MULTI_AFTER, 0, '收口读数必须是 0（本批的出口判据）');
  // ★ 独立复算（不看 ② 档，只看册）：任何 path 都不许被 ≥2 册持有
  const holdings = bookHoldings(repoSheets());
  const stillTwoBook = [...holdings.keys()].filter((p) => new Set((holdings.get(p) ?? []).map((h) => h.feature)).size >= 2).sort();
  assert.deepEqual(stillTwoBook, [], `独立复算：仍两册持有的 path 必须为空（实测 [${stillTwoBook.join(', ')}]）`);
  // ★ D2 类（两侧都带判据）也必须归零 —— 本批不是"把它们藏起来"，是"收成单册"
  const sheets = repoSheets();
  const aiCritOf = new Map<string, number>();
  for (const s of sheets.filter((x) => x.feature === AI)) for (const n of nodesOf(s)) aiCritOf.set(norm(n.path), ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length);
  const tspCritOf = new Map<string, number>();
  for (const s of sheets.filter((x) => x.feature === TSP)) for (const n of nodesOf(s)) tspCritOf.set(norm(n.path), ((n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length);
  const leftoverD2 = [...holdings.keys()].filter((p) => (aiCritOf.get(p) ?? 0) > 0 && (tspCritOf.get(p) ?? 0) > 0);
  assert.deepEqual(leftoverD2, [], `现盘不许再剩任何 D2（两侧都有判据）：实测 [${leftoverD2.join(', ')}]`);
  for (const p of BATCH) {
    assert.equal(tspCritOf.get(p) ?? 0, 0, `\`${p}\` 计划册侧判据必须已清零（跟走，不是复制）`);
    assert.ok((aiCritOf.get(p) ?? 0) > 0, `\`${p}\` 属主册侧必须有判据（并被并集）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 14.3 判据逐字节并集 + 守恒 / 14.3b 有牙
// ════════════════════════════════════════════════════════════════════
test('14.3 判据**逐字节并集**：并集 sha 逐条对表；前段 = 属主侧原件；后段 18 条 = 计划册侧原件；总数守恒 839', () => {
  const aiNodes = rawNodes(AI);
  let moved = 0;
  const kinds: Record<string, number> = {};
  for (const [p, want] of Object.entries(CRITERIA_UNION)) {
    const n = aiNodes.find((x) => norm(x.path) === p);
    assert.ok(n, `\`${p}\` 必须在 agent-io 册里有节点`);
    const exps = n.decision?.expectations ?? [];
    assert.equal(exps.length, want.union, `\`${p}\` 的并集条数必须是 ${want.union}（实测 ${exps.length}）`);
    assert.equal(shaOfJson(exps), want.unionSha, `\`${p}\` 的判据并集必须**逐字节**等于"原件 + 计划册那份"（sha 变了 = 重写/改编）`);
    // ★ 前段 = 属主侧原件（一位不动）；后段 = 计划册侧 18 条（逐字跟走）
    assert.equal(shaOfJson(exps.slice(0, want.own)), want.ownSha, `\`${p}\` 前 ${want.own} 条必须是属主侧原件（一位不动）`);
    assert.equal(shaOfJson(exps.slice(want.own)), want.movedSha, `\`${p}\` 后 ${want.moved} 条必须是计划册侧原件（逐字跟走，不是重造）`);
    moved += exps.length - want.own;
    for (const e of exps as Array<Record<string, unknown>>) kinds[String(e.kind)] = (kinds[String(e.kind)] ?? 0) + 1;
  }
  assert.equal(moved, CRITERIA_MOVED_COUNT, `本批跟走的判据数必须是 ${CRITERIA_MOVED_COUNT}（实测 ${moved}）`);
  assert.deepEqual(kinds, { 'call-exists': 4, 'source-has': 4, run: 7, 'signature-matches': 4, 'symbol-exists': 1 }, '并集后的 kind 分布（搬的是原件，不是重造的）');
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaOf(s)}`).join(' · ');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `判据总数必须守恒 839（实测 ${per}）`);
  // ★ 批 15 棘轮（2026-11-18）：批 15 又往属主册搬进 29 条（属主错位收口）⇒ 现盘 832。钉"= 803"会挡住后续批。
  assert.ok(criteriaOf(bookOf(AI)) >= CRITERIA_IN_AI, `agent-io 册判据只许不减（批 14 收口 ${CRITERIA_IN_AI}；实测 ${criteriaOf(bookOf(AI))}）`);
  // ★ 批 15 棘轮（2026-11-18）：批 15 把计划册最后的 29 条判据**整份搬**进属主册（属主错位 12 收口）
  //   ⇒ 现盘 832 / 0。这里钉方向 + 差集（Δ 必 = 18 + 29），不再钉"计划册还有 29 条"。
  assert.ok(criteriaOf(bookOf(TSP)) <= CRITERIA_IN_TSP, `计划册判据只许不增（批 14 收口 ${CRITERIA_IN_TSP}；实测 ${criteriaOf(bookOf(TSP))}）`);
  assert.equal(criteriaOf(bookOf(TOOLFACE)), CRITERIA_IN_TOOLFACE, '工具面册判据一位不该动');
  assert.equal(CRITERIA_IN_AI - BEFORE_CRITERIA_AI, CRITERIA_MOVED_COUNT, '属主册涨幅必须恰等于跟走的判据数（18）');
  assert.equal(BEFORE_CRITERIA_TSP - CRITERIA_IN_TSP, CRITERIA_MOVED_COUNT, '计划册降幅必须恰等于跟走的判据数（18）');
  assert.equal(BEFORE_CRITERIA_AI + BEFORE_CRITERIA_TSP + CRITERIA_IN_TOOLFACE, CRITERIA_TOTAL, '守恒是**算术**，不是"看起来差不多"');
});

test('14.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 839，差额恰是该节点的判据数', () => {
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
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 14.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), lost, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 14.4 甲′（散文 / 节点字段 / 职责 + 存档 10 值）
// ════════════════════════════════════════════════════════════════════
test('14.4 甲′ 散文：胜方原文逐字未动 + 计划册**独有键** 3 个逐字搬过来（一个不多一个不少）', () => {
  for (const p of BATCH) {
    const n = nodeOf(AI, p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    const d = (n.decision ?? {}) as Record<string, unknown>;
    // ★ 搬来的独有键：逐字（sha 对表）
    for (const [k, sha] of Object.entries(PROSE_MOVED[p] ?? {})) {
      assert.ok(k in d, `\`${p}.${k}\` 必须从计划册搬过来（独有键不是"丢"）`);
      assert.equal(shaOfJson(d[k]), sha, `\`${p}.${k}\` 必须**逐字**搬（sha 变了 = 改写过）`);
      assert.ok(typeof d[k] === 'string' && String(d[k]).trim().length > 0, `\`${p}.${k}\` 不许是空串`);
    }
    // ★ 胜方原文：被存档的那些键，属主侧的值必须还是原样
    for (const [k, sha] of Object.entries(KEEPER_KEPT[p] ?? {})) {
      if (k === '__node__' || k === '__sem__') continue;
      const dk = k.replace(/^decision\./, '');
      assert.ok(dk in d, `\`${p}.${dk}\` 必须仍在 decision 里（属主侧为准，不是删掉）`);
      assert.equal(shaOfJson(d[dk]), sha, `\`${p}.${dk}\` 的胜方原文被动了（甲′ 是"属主侧为准"）`);
    }
    // ★ decision 只许 = 属主侧原有键 + 计划册独有键（多一个 = 凭空造）
    const wantKeys = [...(DECISION_KEYS[p] ?? [])].sort();
    assert.deepEqual(Object.keys(d).sort(), wantKeys, `\`${p}\` 的 decision 键集合必须逐条对表（多一个 = 凭空造；少一个 = 丢叙事）`);
  }
  assert.equal(Object.keys(PROSE_MOVED['src/infrastructure/parse/kernel.ts'] ?? {}).sort().join(','), 'acceptance,consequences', 'kernel.ts 的两个独有键必须是 acceptance + consequences');
  assert.equal(Object.keys(PROSE_MOVED['src/infrastructure/storage.ts'] ?? {}).sort().join(','), 'rationale', 'storage.ts 的独有键必须是 rationale');
});

test('14.4b 甲′ 节点字段：属主侧 `status`/`overlay` 与 `semantic.status` **一位不动**（计划册的 draft/draft 只进存档）', () => {
  for (const [p, want] of Object.entries(KEEPER_KEPT)) {
    const n = nodeOf(AI, p);
    assert.ok(n, `\`${p}\` 必须在属主册有节点`);
    assert.equal(shaOfJson({ status: n.status ?? null, overlay: n.overlay ?? null }), want['__node__'], `\`${p}\` 的 status/overlay 必须逐字等于搬前（属主侧为准）`);
    const sem = semOf(AI, p);
    assert.equal(shaOfJson({ responsibility: String(sem?.responsibility ?? ''), status: sem?.status ?? null }), want['__sem__'], `\`${p}\` 的 semantic.responsibility/status 必须逐字等于搬前`);
  }
  // ★ 具体到值：属主侧本来就是 done / done（计划册的 draft 被存档，没有被顶上来）
  assert.equal(String(nodeOf(AI, 'src/infrastructure/parse/kernel.ts')?.status), 'done', 'kernel.ts 的节点 status 必须仍是属主侧的 done（不是计划册的 draft）');
  assert.equal(String(semOf(AI, 'src/infrastructure/parse/kernel.ts')?.status), 'done', 'kernel.ts 的 semantic.status 必须仍是 done（计划册的 draft 只进存档）');
  assert.equal(String(nodeOf(AI, 'src/infrastructure/storage.ts')?.status), 'done', 'storage.ts 的节点 status 必须仍是 done');
  // ★ 存档里确实存着被顶掉的那个 draft（"不丢"的证据在台账，不在册上）
  assert.equal(Object.keys(ARCHIVE['src/infrastructure/parse/kernel.ts'] ?? {}).includes('node.status'), true, 'kernel.ts 的 node.status 必须在存档表里');
  assert.equal(Object.keys(ARCHIVE['src/infrastructure/parse/kernel.ts'] ?? {}).includes('semantic.status'), true, 'kernel.ts 的 semantic.status 必须在存档表里');
});

test('14.4c 甲′ 职责 + 存档：0 字搬（两侧空串）· 三册总字数 **10,366** 守恒 · 本批存档 **10 值**', () => {
  // ★ 职责：本批 0 字搬 —— 两侧 responsibility 都是空串（不是漏跑）
  for (const p of BATCH) {
    assert.equal(String(semOf(AI, p)?.responsibility ?? '').trim().length, 0, `\`${p}\` 属主册职责必须是空串（本批 0 字搬）`);
  }
  assert.equal(RESP_MOVED_CHARS, 0, '本批职责搬运字数必须是 0');
  assert.equal(respTotalRaw(), RESP_TOTAL_AFTER, `三册职责总字数必须是 ${RESP_TOTAL_AFTER}（实测 ${respTotalRaw()}）`);
  assert.equal(RESP_TOTAL_BEFORE, RESP_TOTAL_AFTER, '两侧合并后总数：搬前 = 搬后（本批一字不丢）');
  assert.equal(RESP_AI_BEFORE, RESP_AI_AFTER, '属主册职责字数一位不动（本批 0 字搬）');
  assert.equal(RESP_TSP_BEFORE, RESP_TSP_AFTER, '计划册职责字数一位不动（本批 0 字搬）');
  // ★ 存档：10 值（常量算术）
  assert.equal(ARCHIVE_PATHS, 2, '本批存档 2 条 path');
  assert.equal(ARCHIVE_VALUES, 10, '本批存档 10 个值（6 + 4）');
  const perPath = Object.values(ARCHIVE).map((o) => Object.keys(o).length);
  assert.deepEqual(perPath, [6, 4], '逐条点数：kernel 6 · storage 4');
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as { multi_owned: { why?: string } };
  assert.ok(String(baseline.multi_owned.why ?? '').includes('批 14（D2 终局'), '门档 multi_owned.why 必须记着批 14 的来路');
  for (const p of BATCH) assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 why 必须逐条点着本批 \`${p}\``);
  assert.ok(String(baseline.multi_owned.why ?? '').includes('10 个值') || String(baseline.multi_owned.why ?? '').includes('存档'), '门档 why 必须记着"存档"这一支');
});

// ════════════════════════════════════════════════════════════════════
// 14.5 域表改判 2 条（owns 2 → 0）
// ════════════════════════════════════════════════════════════════════
test('14.5 域表**改判 2 条**：属主 = agent-io；计划册 `owns` **2 → 0**（空数组）；前缀仍在', () => {
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
  assert.equal(TSP_OWNS_BEFORE - tspOwns.length, BATCH.length, `计划册 owns 的降幅必须恰等于本批 path 数（2 − 2 = 0）`);
  // ★ 终局：计划册 owns **必须是空的**（批 17 退役的前置）
  assert.equal(TSP_OWNS_AFTER, 0, '计划册 owns 收口必须是 0 条');
  assert.deepEqual(tspOwns, [], `计划册 \`owns[]\` 必须**空**（实测 [${tspOwns.join(', ')}]）—— 这是"不再 owns 任何 path"的判据`);
  for (const pre of ['src/', 'scripts/', 'tests/', 'docs/', 'dogfood/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  for (const pre of ['observe-lang-go/', 'observe-lang-java/', 'observe-lang-py/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\``);
  const raw = fs.readFileSync(path.join(REPO, 'design-books.json'), 'utf8');
  assert.ok(raw.includes('批 14'), 'design-books.json 的 note/why 必须记着批 14（散文追加 + owns 改判）');
  assert.ok(raw.includes('owns 2 → 0') || raw.includes('2 → 0') || raw.includes('降到 **0**') || raw.includes('降到 0'), '域表散文必须点名"owns 2 → 0"');
});

// ════════════════════════════════════════════════════════════════════
// 14.6 ② 档 owned + 鉴别力
// ════════════════════════════════════════════════════════════════════
test('14.6 ② 档：2 条 klass = owned；**塞回任一条** ⇒ 立刻 multi_owned（鉴别力）；path 分母**只许不降**', () => {
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
  assert.equal(now.counts.multi_owned, 0, '② 档：多册持有必须是 0（终局）');
  assert.ok(now.paths >= PATHS_FLOOR, `path 分母只许不降（floor ${PATHS_FLOOR}；实测 ${now.paths}）`);
  assert.equal(now.books, 3, `册数不变（实测 ${now.books}）`);
  const p0 = BATCH[0]!;
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
// 14.7 写端
// ════════════════════════════════════════════════════════════════════
test('14.7 写端：批 14 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
      '非属主册再建节点必须**前置拒**（否则批 14 的改判是可逆的、多册归零也是可逆的）',
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
// 14.8 门档棘轮 + 指纹（多册 = 0 是终局）
// ════════════════════════════════════════════════════════════════════
test('14.8 门档：多册持有 **= 0**（终局）· id 漂移 10 · 属主错位 12；三组集合指纹与基线逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.equal(now.multi_owned.length, 0, `多册持有必须**归零**（实测 ${now.multi_owned.length}）`);
  assert.equal(MULTI_BEFORE - now.multi_owned.length, BATCH.length, '批 14 的降幅必须逐字等于本批 path 数（2 → 0）');
  assert.ok(now.id_drift.length <= ID_DRIFT_AFTER, `id 漂移只许不增（批 14 收口 ${ID_DRIFT_AFTER}；实测 ${now.id_drift.length}）`);
  assert.equal(ID_DRIFT_BEFORE, ID_DRIFT_AFTER, '本批删的全是单点派生 id ⇒ 漂移一条不该变');
  assert.ok(now.owner_mismatch.length <= OWNER_MISMATCH, `属主错位只许不增（批 14 收口 ${OWNER_MISMATCH}；实测 ${now.owner_mismatch.length}）—— 批 15 把它收到 0 是对的，不许又长回来`);
  for (const p of BATCH) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（本批把属主改判成它了）`);
  }

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
  assert.equal((baseline.multi_owned as unknown as { count: number }).count, 0, '基线里的多册持有也必须是 0 —— 终局写进账');
});

// ════════════════════════════════════════════════════════════════════
// 14.9 存档读回逐字（10 值）+ 跨批不进水 / 14.9b 机制可移植
// ════════════════════════════════════════════════════════════════════
test('14.9 **存档读回逐字（10 值）**：本批 2 条事件 / 10 个值逐字节可复算；批 10/11 的 36 条不进水', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip('本机没有 .agent-io/tasks.db（干净克隆 / 首次检出）⇒ 台账存档不在版本库里，读不回；机制由 14.9b 钉住');
    return;
  }
  const row = getRow(REPO, LEDGER_REF);
  if (!row) {
    t.skip(`台账里没有 \`${LEDGER_REF}\` 这一行（本机台账未导入）⇒ 读不回`);
    return;
  }
  assert.equal(row.state, 'active', `${LEDGER_REF} 必须是活跃行（批 14 还没收口；销账后不许再往上挂）`);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  const batches = new Map<string, number>();
  const mine: Array<{ path: string; payload: Record<string, unknown>; sha: string; body: string }> = [];
  for (const e of allArchive) {
    const parsed = parseArchive(String(e.body));
    assert.ok(parsed, `存档事件 id=${e.id} 的 body 解析不了（格式契约被改了）`);
    assert.equal(String((parsed.payload as { ref?: string }).ref ?? ''), LEDGER_REF, `存档事件 id=${e.id} 必须挂在 ${LEDGER_REF} 上`);
    const batch = String((parsed.payload as { batch?: string }).batch ?? '(缺)');
    batches.set(batch, (batches.get(batch) ?? 0) + 1);
    if (batch === BATCH_TAG) mine.push({ path: String((parsed.payload as { path?: string }).path), payload: parsed.payload, sha: parsed.payloadSha, body: String(e.body) });
  }
  assert.equal(mine.length, ARCHIVE_PATHS, `本批存档必须恰好 ${ARCHIVE_PATHS} 条事件（实测 ${mine.length}）`);
  let values = 0;
  for (const m of mine) {
    const want = ARCHIVE[m.path];
    assert.ok(want, `台账里的 \`${m.path}\` 必须是本批清单里的 path`);
    const dropped = (m.payload as { dropped?: Record<string, unknown> }).dropped ?? {};
    assert.deepEqual(Object.keys(dropped).sort(), Object.keys(want).sort(), `\`${m.path}\` 的存档键集合必须逐条对表`);
    for (const [k, sha] of Object.entries(want)) {
      assert.equal(shaOfJson(dropped[k]), sha, `\`${m.path}.${k}\` 的存档原文必须**逐字**（sha 变了 = 改写过）`);
      const v = dropped[k];
      const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      assert.ok(m.body.includes(text), `\`${m.path}.${k}\` 的人读段必须逐字含原文（"视图里丢、真相里不丢"）`);
    }
    // payload 自证
    assert.equal(m.sha, shaOfJson(m.payload), `\`${m.path}\` 的 payload sha 必须自证`);
    values += Object.keys(dropped).length;
  }
  assert.equal(values, ARCHIVE_VALUES, `本批存档**值**数必须是 ${ARCHIVE_VALUES}（实测 ${values}）`);
  assert.equal(batches.get('A8A9-batch10'), 35, `批 10 的 35 条存档必须原样还在（append-only；实测 ${String(batches.get('A8A9-batch10'))}）`);
  assert.equal(batches.get('A8A9-batch11'), 1, `批 11 的 1 条存档必须原样还在（实测 ${String(batches.get('A8A9-batch11'))}）`);
  assert.equal(batches.get(BATCH_TAG), 2, `台账里本批分组必须是 2 条（实测 ${String(batches.get(BATCH_TAG))}）`);
});

test('14.9b 上一条**可移植**：夹具里 hangRow + annotateRow 往返（10 值 payload 与空 payload 都必须读得回）', () => {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = path.join(home, 'proj');
    fs.mkdirSync(path.join(proj, '.agent-io'), { recursive: true });
    hangRow(proj, { refId: 'T-#FIXTURE-B14', section: 'fixture', title: '批 14 存档往返夹具', by: 'test' });
    const mk = (path14: string, dropped: Record<string, unknown>) => {
      const payload = {
        batch: BATCH_TAG,
        ref: 'T-#FIXTURE-B14',
        path: path14,
        loser: { book: TSP, node_id: 'file_src_infrastructure_fixture14_ts' },
        keeper: { book: AI, node_id: 'file_src_infrastructure_fixture14_ts' },
        dropped,
        moved_keys: Object.keys(dropped).map((k) => k.replace(/^decision\./, '')),
        moved_responsibility: false,
        moved_semantic_status: null,
        moved_node_fields: [],
        moved_expectations: 18,
        union_expectations: 18,
        keeper_expectations: 1,
        union_sha: 'fixture',
        identical_keys: [],
      };
      const json = JSON.stringify(payload);
      const body = [
        '迁移存档：败方原文',
        `批 14（甲′：散文口径 = 属主侧为准 + 败方原文逐字存档；D2 = 两侧都有判据 ⇒ 判据并集、散文存档）· T-#FIXTURE-B14 · ${BATCH_TAG}`,
        `path: ${path14}`,
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
    // ★ 本批的形态（10 个值）与"无冲突"的形态（0 个值）都要能往返
    const ten = mk('src/infrastructure/fixture14-ten.ts', Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`decision.k${i}`, `败方原文 ${i}`])));
    const empty = mk('src/infrastructure/fixture14-empty.ts', {});
    annotateRow(proj, 'T-#FIXTURE-B14', ten.body, 'test');
    annotateRow(proj, 'T-#FIXTURE-B14', empty.body, 'test');
    const row = getRow(proj, 'T-#FIXTURE-B14');
    assert.ok(row, '夹具台账行必须读得回来');
    const ev = row.events.filter((e) => e.kind === 'annotate');
    assert.equal(ev.length, 2, '必须恰好两条 annotate 事件');
    for (const [i, want] of [ten, empty].entries()) {
      assert.equal(String(ev[i]!.body), want.body, 'annotate 事件 body 必须**逐字**存下（首尾空白也不许剪）');
      const parsed = parseArchive(String(ev[i]!.body));
      assert.ok(parsed, '同一份格式必须解析得回来');
      assert.equal(parsed!.payloadSha, createHash('sha256').update(want.json, 'utf8').digest('hex'), 'payload sha 必须一致');
      assert.deepEqual(parsed!.payload.dropped, want.payload.dropped, `第 ${i + 1} 条 payload 的 dropped 必须逐字段相同`);
    }
    const tenBack = parseArchive(String(ev[0]!.body))!.payload.dropped as Record<string, string>;
    assert.equal(Object.keys(tenBack).length, 10, '10 个值的存档必须 10 个都读得回');
    assert.equal(tenBack['decision.k9'], '败方原文 9', '最后一个值也必须逐字读回（不是"前几个对就行"）');
    assert.deepEqual(parseArchive(String(ev[1]!.body))!.payload.dropped, {}, '空存档（0 个值）也必须往返成立 —— 否则"存档支"的边界不可证');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 14.10 算术闭合 / 14.10b 判据只搬一次
// ════════════════════════════════════════════════════════════════════
test('14.10 算术闭合：三册判据 803 + 29 + 7 = 839；两册都还在（**不是**"删册"换来的归零）', () => {
  const sheets = repoSheets();
  assert.deepEqual(sheets.map((s) => s.feature).sort(), [AI, TOOLFACE, TSP].sort(), '三册必须都还在（多册归零不是靠删册）');
  assert.equal(BEFORE_CRITERIA_AI + BEFORE_CRITERIA_TSP + CRITERIA_IN_TOOLFACE, CRITERIA_TOTAL, '搬前算术');
  assert.equal(CRITERIA_IN_AI + CRITERIA_IN_TSP + CRITERIA_IN_TOOLFACE, CRITERIA_TOTAL, '搬后算术');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '现实读数必须等于两条算术的共同值');
  // ★ 计划册的真相**没有丢**，它搬到了属主册：批 15 把最后的 29 条整份搬进 agent-io（计划册判据归 0）。
  //   这里守的是"归零**不是**删册换来的"：三册都在、判据总数守恒（计划册那 29 条现在算在 agent-io 上）。
  const tspNow = criteriaOf(bookOf(TSP));
  const aiNow = criteriaOf(bookOf(AI));
  assert.equal(aiNow + tspNow + criteriaOf(bookOf(TOOLFACE)), CRITERIA_TOTAL, `三册合计必须仍 = ${CRITERIA_TOTAL}（计划册的 ${CRITERIA_IN_TSP} 条搬进了属主册，没丢）`);
  assert.ok(tspNow <= CRITERIA_IN_TSP, `计划册判据只许不增（批 14 收口 ${CRITERIA_IN_TSP}；实测 ${tspNow}）`);
  assert.ok(aiNow >= BEFORE_CRITERIA_AI, `属主册判据只许不减（批 14 收口 ${BEFORE_CRITERIA_AI}；实测 ${aiNow}）`);
});

test('14.10b **判据只搬一次**：补回 2 个空壳 ⇒ 多册 +2 而判据仍 839；再把 18 条补回 ⇒ 857（双份）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在（否则判不了）：${read.error}`);
  const sheets = repoSheets();
  const now = crossBookOwnership(sheets, read);
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的判据总数是 839');
  // 世界 A：把 2 个**空壳**补回计划册（无 decision、无语义负载）—— 正是本批删掉的那个形状
  const shells = BATCH.map((p) => ({ id: nodeIdOf(p), label: path.basename(p), type: 'file', x: 0, y: 0, path: p }));
  const worldA = sheets.map((s) =>
    s.feature === TSP ? ({ ...s, feature: s.feature, geometry: { nodes: [...nodesOf(s), ...shells] } } as unknown as BookSheetLike & { feature: string }) : s,
  );
  const a = crossBookOwnership(worldA, read);
  for (const p of BATCH) assert.equal(a.rows.find((r) => r.path === p)?.klass, 'multi_owned', `\`${p}\` 在"没做本批"的世界里必须是 multi_owned`);
  assert.equal(a.counts.multi_owned, now.counts.multi_owned + BATCH.length, `补回 2 个空壳 ⇒ 多册持有必须恰好 +2（实测 ${a.counts.multi_owned - now.counts.multi_owned}）`);
  assert.equal(criteriaTotal(worldA), CRITERIA_TOTAL, `补回空壳后判据总数必须仍 ${CRITERIA_TOTAL} —— 本批删的是"壳"，判据已经并进属主册，没有丢`);
  // 世界 B：连那 18 条也补回计划册 ⇒ 857 = 839 + 18（**双份**）—— 说明现盘的 839 里它们恰好只有一份
  const revivedWithPayload = BATCH.map((p) => {
    const n = nodeOf(AI, p);
    const node: Record<string, unknown> = { id: nodeIdOf(p), label: path.basename(p), type: 'file', x: 0, y: 0, path: p };
    if (n?.decision) node.decision = { expectations: (n.decision.expectations ?? []).slice(CRITERIA_UNION[p]!.own) };
    return node;
  });
  const worldB = sheets.map((s) =>
    s.feature === TSP ? ({ ...s, feature: s.feature, geometry: { nodes: [...nodesOf(s), ...revivedWithPayload] } } as unknown as BookSheetLike & { feature: string }) : s,
  );
  assert.equal(criteriaTotal(worldB), CRITERIA_TOTAL + CRITERIA_MOVED_COUNT, `把 18 条判据也补回计划册 ⇒ 判据必须是 ${CRITERIA_TOTAL + CRITERIA_MOVED_COUNT}（双份）；实测 ${criteriaTotal(worldB)}`);
  assert.equal(respTotalSheets(worldA), respTotalSheets(sheets), '补回的空壳不带职责 ⇒ 职责总字数一字不变');
});

// ════════════════════════════════════════════════════════════════════
// 14.11 卡账（CARD_LEAVE）
// ════════════════════════════════════════════════════════════════════
test('14.11 **卡账（CARD_LEAVE）**：2 条带卡 · **0 次卡操作**、活卡仍在库里、属主册卡投影原样', (t) => {
  const tspNodes = rawNodes(TSP);
  const aiNodes = rawNodes(AI);
  for (const p of BATCH) {
    assert.equal(tspNodes.find((n) => norm(n.path) === p), undefined, `\`${p}\` 的计划册节点必须已删`);
    const ai = aiNodes.find((n) => norm(n.path) === p);
    assert.ok(ai, `\`${p}\` 必须在属主册有节点`);
    // ★ 属主侧的卡投影是**原来就有的**（不是本批伪造的）：state 必须还是 done
    assert.equal((ai.task as { state?: string } | undefined)?.state, 'done', `\`${p}\` 属主册节点的卡投影必须原样（done）—— 本批 0 次卡操作`);
  }
  assert.equal(Object.keys(CARD_SNAPSHOT).length, 2, '带卡留账 2 条');
  assert.deepEqual([...CARD_SNAPSHOT['src/infrastructure/parse/kernel.ts']!].sort(), ['candidate@book:task-system-plan', 'candidate@live:task-system-plan', 'done@book:agent-io'], 'kernel.ts 的卡：册上（计划册 candidate + 属主册 done）+ 活卡 candidate');
  assert.deepEqual([...CARD_SNAPSHOT['src/infrastructure/storage.ts']!].sort(), ['done@book:agent-io', 'done@book:task-system-plan'], 'storage.ts 的卡：两册册上各一张 done（无活卡）');
  const cards = listLiveCards(REPO);
  if (cards.length === 0) {
    t.skip('本机没有活卡（干净克隆：卡的家不在版本库里）⇒ 活卡那半读不回；册上那半已由上面钉住');
    return;
  }
  // ★ 0 次卡操作 ⇒ 那张活卡必须**原样还在**（state 未变、仍挂在本批被删的那个 id 上）
  const kernelCard = cards.find((c) => String(c.id) === 'file_src_infrastructure_parse_kernel_ts');
  assert.ok(kernelCard, 'kernel.ts 的活卡必须还在（本批 0 次卡操作 —— 卡不动、仅记录）');
  assert.equal(String(kernelCard.state), 'candidate', '活卡的 state 必须是 candidate（没人动过它）');
  assert.equal(String(kernelCard.feature), TSP, '活卡仍归计划册（本批不搬卡）');
  assert.equal(cards.find((c) => String(c.id) === 'file_src_infrastructure_storage_ts'), undefined, 'storage.ts 不该凭空长出一张活卡');
});

// ════════════════════════════════════════════════════════════════════
// 14.12 计划册册容
// ════════════════════════════════════════════════════════════════════
test('14.12 计划册册容：120 → 118 · 14 → 12 · 182 → 175（删 2 / 2 / 7）+ 无幽灵语义', () => {
  assert.equal(BEFORE_NODES_TSP - DELETED_NODES, TSP_NODES_AFTER, '计划册节点数：120 − 2 = 118');
  assert.equal(BEFORE_SEM_TSP - DELETED_SEMANTICS, TSP_SEMANTIC_AFTER, '计划册语义：14 − 2 = 12');
  assert.equal(BEFORE_EDGES_TSP - DELETED_EDGES, TSP_EDGES_AFTER, '计划册边：182 − 7 = 175');
  assert.equal(DELETED_EDGES, 7, '删的边数：kernel 1 + storage 6 = 7');
  // ★ 棘轮（批 14 收口值只作**上界**：批 15 又拿走了 12 个节点 / 12 条语义 / 2 条边 —— 计划册退役在批 17）
  assert.ok(rawNodes(TSP).length <= TSP_NODES_AFTER, `计划册节点数只许减（批 14 收口 ${TSP_NODES_AFTER}；实测 ${rawNodes(TSP).length}）`);
  assert.ok(rawSems(TSP).length <= TSP_SEMANTIC_AFTER, `计划册语义条目数只许减（批 14 收口 ${TSP_SEMANTIC_AFTER}；实测 ${rawSems(TSP).length}）`);
  const edgesNow = ((rawBook(TSP).geometry as { edges?: unknown[] } | undefined)?.edges ?? []).length;
  assert.ok(edgesNow <= TSP_EDGES_AFTER, `计划册边数只许减（批 14 收口 ${TSP_EDGES_AFTER}；实测 ${edgesNow}）`);
  // 语义条目与节点必须一节点一条（半删会留下幽灵语义）
  const nodeIds = new Set(rawNodes(TSP).map((n) => String(n.id)));
  const ghost = rawSems(TSP).filter((s) => !nodeIds.has(String(s.id)));
  assert.deepEqual(ghost, [], `计划册不许留幽灵语义（实测 ${ghost.length} 条）`);
  // 属主册册容：本批只搬负载、不增删节点（★ 棘轮：批 15 往属主册 +10 节点 / +10 语义 是对的，只许增）
  assert.ok(rawNodes(AI).length >= BEFORE_NODES_AI, `属主册节点数只许增（批 14 收口 ${BEFORE_NODES_AI}；实测 ${rawNodes(AI).length}）`);
  assert.equal(rawNodes(AI).filter((n) => BATCH.includes(norm(n.path))).length, BATCH.length, '属主册这 2 条必须一条不少');
});

// ════════════════════════════════════════════════════════════════════
// 14.13 派生快照（COGNITION 不许过期）
// ════════════════════════════════════════════════════════════════════
test('14.13 **派生快照**：COGNITION.txt 里每册的 dsl_rev = 册上现值（改册不重生成快照 ⇒ 这里红）', () => {
  const cogFile = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(cogFile), 'COGNITION.txt 必须存在（它是入库的派生快照）');
  const text = fs.readFileSync(cogFile, 'utf8');
  const seen = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^===feature ([a-z0-9-]+)=== dsl_rev=(\d+) sha256=[0-9a-f]{16}$/);
    if (m) seen.set(m[1]!, m[2]!);
  }
  assert.ok(seen.size >= 3, `快照里必须至少 3 册的段头（实测 ${seen.size}）`);
  for (const [feature, rev] of seen) {
    const raw = rawBook(feature);
    assert.equal(String(raw._dsl_rev), rev, `${feature} 的 COGNITION 段头 dsl_rev (${rev}) 与册上现值 (${String(raw._dsl_rev)}) 不一致 —— 跑 \`npm run cognition\``);
  }
  // 批 14 动过两册 ⇒ 它们的段头必须已跟着走（"重生成过"的正面证据）
  assert.ok(seen.has(TSP), '快照里必须有计划册的段头');
  assert.ok(seen.has(AI), '快照里必须有本体册的段头');
});

// ════════════════════════════════════════════════════════════════════
// 14.14 真视图 == 引擎现算（存档 38 条 ⇒ 摘要行跟着走）
// ════════════════════════════════════════════════════════════════════
test('14.14 真视图：docs/todo.md == 引擎现算（current）· 视图里 0 处 archive-payload · 摘要行 = 引擎里 38 条', (t) => {
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

  const row = getRow(REPO, LEDGER_REF);
  assert.ok(row, `台账里必须有 \`${LEDGER_REF}\``);
  const allArchive = row.events.filter((e) => typeof e.body === 'string' && e.body.startsWith('迁移存档：败方原文'));
  assert.ok(allArchive.length >= 38, `引擎里的迁移存档事件必须 ≥ 38（实测 ${allArchive.length}）`);
  const m = archiveLines[0]!.match(/迁移存档 (\d+) 条/);
  assert.equal(Number(m?.[1]), allArchive.length, '视图摘要的条数必须等于引擎里的存档条数（两处一个数）');
  for (const e of allArchive) {
    assert.ok(parseArchive(String(e.body)), `引擎里 event id=${e.id} 的存档必须仍可解析（逐字可复算）`);
  }
  // 本批 +2 条事件（2 个 path）⇒ 36 + 2 = 38
  assert.equal(allArchive.length, 38, `本批 2 条存档 ⇒ 引擎里应恰好 38 条（实测 ${allArchive.length}）`);
});
