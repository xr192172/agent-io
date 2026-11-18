/**
 * P1 · T-#A8A9-CROSS-BOOK **批 8**（B 类**职责文本** 25 条：24 条搬运后删 + 1 条"属主侧已逐字相同、只删"）—— 红 → 绿。
 *
 * ## 这批要立的十一条
 * | # | 判据 | 绿的真身（本文件断的东西） |
 * |---|---|---|
 * | 8.1 | 25 个 path **各恰一册**持有，且是 `agent-io`；节点 id 仍由 `nodeIdOf` 单点派生 | 搬运后没删 / 删错册在这里红 |
 * | 8.1b | 计划册侧**三清**（节点 + 语义 + 边）；别的册也不许留这些 id | 半删（幽灵节点、悬空边、幽灵语义）在这里红 |
 * | 8.2 | 清单形状：25 条 · **码位序**（`sort()`）· 段位分布固定 | 手抄错一条 / 顺序漂了在这里红 |
 * | 8.3 | 判据**总数守恒**：三册合计 **826** 条；本批 25 个 path 上判据 = **0**（搬的是职责文本，不是判据） | 搬运顺手带上/带走判据在这里红 |
 * | 8.3b | 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 826（同一把尺两个世界） | 空断言的照妖镜（R47） |
 * | 8.4 | 职责文本**逐字节**落在属主册 `semantic.files[].responsibility`（25 条 sha256 + 字数）；`status` 随迁 3 条 | 只删不搬（文本蒸发）/ 改写过（"大意相同"）/ 搬歪在这里红 |
 * | 8.4b | 上一条**有牙**：把属主侧职责清空 ⇒ 8.4 的检查立刻红（纯核，不碰真册） | 同上 |
 * | 8.5 | 域表**改判**：25 条 path 的属主 = `agent-io`；计划册 `owns[]` 里这 24 条精确条目没了（67 → 43） | 只删节点不改表 ⇒ 门立刻报"属主错位" |
 * | 8.6 | ② 档：这 25 条 klass = `owned`；把任一条塞回计划册 ⇒ 立刻 `multi_owned`（鉴别力） | 纯核两世界对照，不碰真册 |
 * | 8.7 | 写端：批 8 完成后**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 `saveDSL`，盘上零字节变化） | 属主册自己写同一 path ⇒ 过（不是一刀切） |
 * | 8.8 | 门档：多册持有 ≤ **132**（批 8 收 −25：157 → 132）；三组集合指纹与 `design-books-baseline.json` 逐字一致 | 谁改了册而不改基线，这里红（钉棘轮 + 常量算术，不钉"当前值 = 132"） |
 * | 8.9 | **带卡留账 2 条**（卡一个字节没动）：`symbol_diff.ts`（活卡 candidate）/ `judge_port.ts`（陈旧投影），门档 `why` 点名 | 悄悄把卡删了、或悄悄把人家的 path 收了，都在这里红 |
 *
 * ## 纪律（本仓 0.14 / R47 + 批 2–6 的裁定）
 * · 真仓读数（`process.cwd()`）只断**不变量**（"这 25 个 path 恰一册持有"·"判据总数守恒"·"职责逐字节"），
 *   **不断**会随批下降的单册读数（`tsp` 的 208 条在批 9–13 会继续降，那不是本批的账）；
 * · 门档断的是**集合指纹与基线逐字一致**，不是"多册持有 = 0"（那是批 13 之后的终局）；
 * · ★ 只许钉三类东西 —— ①"我这批的 path 不在坏集合里"（永久真）②"总数只许不增"（棘轮）
 *   ③"我批的 Δ = 我批的 path 数"（常量算术）。**不许钉**"总数 = 我批收口时的那个数"。
 * · ★ 每一条"有牙"的反检查（8.3b / 8.4b）都跑在**纯核副本**上：真册一个字节都不动。
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
 * 批 8 的清单（**码位序 = `sort()`**，批 4 裁定②）：侦察方案 §1.3 的 **B 类 = 0 判据 ∧ 有职责文本**，全收 25 条。
 * ★ 这是**交付清单的钉子**，不是第二份权威：清单一变，本批的出口判据（8.1/8.4/8.6）就无处可断。
 * ★ 段位：`scripts/` 7 · `src/application/{design,observe,refactor}/` 8 · `src/domain/` 2 ·
 *   `src/infrastructure/{analysis,authoring,parse}/` 6 · `src/infrastructure/` 根 1。
 */
const PATHS = [
  'scripts/clean-dead-functions.mjs',
  'scripts/contract-calls.mjs',
  'scripts/coverage.mjs',
  'scripts/design-check.mjs',
  'scripts/gen-contracts.mjs',
  'scripts/impl-fixture.mjs',
  'scripts/patrol.mjs',
  'src/application/design/board/todo_journal.ts',
  'src/application/design/line/design_diff.ts',
  'src/application/design/rewrite/symbol_diff.ts',
  'src/application/observe/reconcile/proposal_approve.ts',
  'src/application/observe/reconcile/proposal_list.ts',
  'src/application/observe/reconcile/proposal_reject.ts',
  'src/application/observe/runtime/judge_observe_events.ts',
  'src/application/observe/runtime/observe_log_query.ts',
  'src/application/refactor/gate_note.ts',
  'src/domain/judge_port.ts',
  'src/domain/todo_chain.ts',
  'src/infrastructure/analysis/diagnosis/test_contract.ts',
  'src/infrastructure/authoring/translate/go_tests.ts',
  'src/infrastructure/authoring/translate/receipt.ts',
  'src/infrastructure/parse/symbol_docstring.ts',
  'src/infrastructure/parse/symbol_params.ts',
  'src/infrastructure/parse/symbol_shape.ts',
  'src/infrastructure/source_write_port.ts',
];

/**
 * 搬过去的**载体指纹**（`semantic.files[].responsibility` 的 sha256 + 字数 + 随迁的 `status`）。
 * ★ 钉的是**内容**，不是"看起来有字"：谁把职责改了、"大意相同"地重写一遍，8.4 红。
 * ★ `status` 是 `draft / in_progress / done`（`domain/semantic.ts` 的文件实现状态）—— 只搬
 *   "败方有、属主无"的那 3 条（design_diff `done` · symbol_diff `draft` · judge_port `done`）。
 */
const CARRIED: Record<string, { sha: string; chars: number; status: string | null }> = {
  ['scripts/clean-dead-functions.mjs']: { sha: 'a51e2c5fe13d128858ce994109503424348e243b4901bbb68ab8e926642ea80c', chars: 58, status: null },
  ['scripts/contract-calls.mjs']: { sha: '4caa819e1cb6c44395b66d2aae041a468b0c990ac0d0afde984e9aeea833165f', chars: 44, status: null },
  ['scripts/coverage.mjs']: { sha: '4458fc8e7b182502e0ff5f578fb3ecb9487d517c64d1e431e59bd5c905dde525', chars: 65, status: null },
  ['scripts/design-check.mjs']: { sha: '262f59d48514ea277f9efe2e2a2095ff8e1d1dbdf9a9e08a6515c34640a87193', chars: 54, status: null },
  ['scripts/gen-contracts.mjs']: { sha: '1737d6fa3ed010d0b38e46ed78460bc683a85a02190ca008a0dc0bb39eca7e66', chars: 53, status: null },
  ['scripts/impl-fixture.mjs']: { sha: '611332fa5ac2631b06b33cf2c2d6a1bcb23b9303d4ce042df4504f724f104130', chars: 142, status: null },
  ['scripts/patrol.mjs']: { sha: '2df8184d2ef498f3672a2dc36f3dc08732e307b9e89fe16cbb92271a6710fa35', chars: 27, status: null },
  ['src/application/design/board/todo_journal.ts']: { sha: 'b5ddc2328ab7a3f17970197b9e214b8b5fac903508fa3b7eceb7c6ae005ce949', chars: 71, status: null },
  ['src/application/design/line/design_diff.ts']: { sha: '2335308969fd124274a1b4ce68b100b7e1666fb97fe4590099c49d5aa3fb1b91', chars: 36, status: 'done' },
  ['src/application/design/rewrite/symbol_diff.ts']: { sha: '87518cc1ddf14d970da6f265661216c16a31e6af1586c5f1c5490ddaa1266e9f', chars: 31, status: 'draft' },
  ['src/application/observe/reconcile/proposal_approve.ts']: { sha: '0d3d2a56fd66398438b87db8d7d47266ec8f3344377ffb8ecea1c13bb3339894', chars: 33, status: null },
  ['src/application/observe/reconcile/proposal_list.ts']: { sha: 'fb77c8d8b78cb20fb71112996e01d3ac3363130559fdfa6941d1917166f016bd', chars: 31, status: null },
  ['src/application/observe/reconcile/proposal_reject.ts']: { sha: '60aa311d660cad89946710e96a2a123fd5895accc131854be9e7c0f88f49b2e9', chars: 30, status: null },
  ['src/application/observe/runtime/judge_observe_events.ts']: { sha: 'b2cdc098c1948f2095f297cbcc443fe1d06bd91b091628f72ece8d8b0dc440a2', chars: 29, status: null },
  ['src/application/observe/runtime/observe_log_query.ts']: { sha: '566902fcdc5267cbe2d329fa880ec3cc850cf683542998bd1bc44eb6660d8784', chars: 34, status: null },
  ['src/application/refactor/gate_note.ts']: { sha: '145d016396a3466e28bb738d3c742d2df67905620fae21ecbbf4c1ff7a0efa2a', chars: 39, status: null },
  ['src/domain/judge_port.ts']: { sha: 'e150a8375ff6b793dcab47ff05c13b672f4024196f3c1993c67d472288286f58', chars: 69, status: 'done' },
  ['src/domain/todo_chain.ts']: { sha: 'af0173598937ff2986918a12ddb0b508d66c1f50a4e61b537f4f84fe1120f97d', chars: 52, status: null },
  ['src/infrastructure/analysis/diagnosis/test_contract.ts']: { sha: '0eec4b12087ce5c91d0755ce9963484b207926ea258786b467cfc6b0896633ef', chars: 28, status: null },
  ['src/infrastructure/authoring/translate/go_tests.ts']: { sha: '5f25a43a78e229ac8d6eb8d795b05e6babaf776b3fd9bb170a24edba0cbc3643', chars: 53, status: null },
  ['src/infrastructure/authoring/translate/receipt.ts']: { sha: '5b70de7d70d0b81afd86e78467ac10b6a3252da43cff4693de4923098676441c', chars: 51, status: null },
  ['src/infrastructure/parse/symbol_docstring.ts']: { sha: 'afc4c28103cbc0ba9b9dad70f13152004c7c84593ad78e9070dd4cee1eef7332', chars: 51, status: null },
  ['src/infrastructure/parse/symbol_params.ts']: { sha: 'e08f247939107c9d77f5197066470144157a1a2a145f56337ac678874d8e8e3f', chars: 46, status: null },
  ['src/infrastructure/parse/symbol_shape.ts']: { sha: '7ce4b323b255ddfdacfc15ed700c384b16d5912cf240422ec3ceec4fb82571f0', chars: 55, status: null },
  ['src/infrastructure/source_write_port.ts']: { sha: '45a401b3c6ce68d23de5b833b42d14d3fff479491831e5e7c3737056921f7949', chars: 26, status: null },
};

/** 属主侧**本来就已经逐字相同**的那一条（搬运是空操作，只剩删）—— 显式名单，不是"看起来一样" */
const ALREADY_OWNED = ['scripts/impl-fixture.mjs'] as const;

/**
 * 批 8 里**带卡却仍被收**的 2 条（卡**一个字节没动**：卡的家在 `tasks.db`，本批不碰卡操作）。
 * | path | 卡的真身 | 谁收口 |
 * |---|---|---|
 * | `src/application/design/rewrite/symbol_diff.ts` | 计划册侧**活卡 candidate**（`listLiveCards` 现读） | 批 16（卡收敛） |
 * | `src/domain/judge_port.ts` | 册上 `node.task` 投影 `done`，库里**无活卡**（陈旧投影，随节点消失） | 无需收口 |
 * ★ 为什么它们进得来而批 6 的"带卡一律不进"不适用：批 8 的批次定义是 **B 类 25 条全收**，
 *   而这两条正是 B 类成员；卡不是被删除的对象（db 行 + write_log 一个字节没动）。
 */
const CARD_LEAVE = ['src/application/design/rewrite/symbol_diff.ts', 'src/domain/judge_port.ts'] as const;

/** 判据守恒读数（B 类零判据 ⇒ 删 25 个节点、搬 24 条职责文本，一条判据都不动） */
const CRITERIA_TOTAL = 826;
/**
 * `多册持有`：批 6 收口 157 → 批 8 再收 25 = **132**。
 * ★ 132 是**上限**（棘轮），不是"永远等于"：批 9–13 还会继续往下走（批 3 §3.2 的双 Δ 判据）。
 */
const MULTI_OWNED_BEFORE_B8 = 157;
const MULTI_OWNED_AFTER_B8 = 132;
/** 计划册 `owns[]`：67 → 43（24 条精确条目摘掉 = 属主改判；agent-io 的 `src/` `scripts/` 前缀接住它们） */
const TSP_OWNS_AFTER_B8 = 43;

const norm = (s: unknown) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');
const shaOf = (list: readonly string[]) => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');
const nodesOf = (s: BookSheetLike) => (s.geometry?.nodes ?? []) as Array<Record<string, unknown>>;
const semanticOf = (s: BookSheetLike) =>
  (s as unknown as { semantic?: { files?: Array<{ id?: string; path?: string; responsibility?: string; status?: string }> } }).semantic?.files ?? [];

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
function respOn(sheet: BookSheetLike, p: string): string {
  return semanticOf(sheet).filter((f) => norm(f.path) === p).map((f) => String(f.responsibility ?? '')).join('');
}

// ════════════════════════════════════════════════════════════════════
// 8.1 25 个 path 各恰一册持有（agent-io）；8.1b 计划册侧三清
// ════════════════════════════════════════════════════════════════════
test('8.1 真仓：25 个 path 各自**恰一册**持有，且持有者是 agent-io（批 8 前是两册各一节点）', () => {
  const holdings = bookHoldings(repoSheets());
  for (const p of PATHS) {
    const hs = holdings.get(p) ?? [];
    const feats = [...new Set(hs.map((h) => h.feature))];
    assert.equal(feats.length, 1, `\`${p}\` 必须恰一册持有（实测 ${feats.join(' / ') || '无人持有'}）`);
    assert.equal(feats[0], AI, `\`${p}\` 的持有册必须是 ${AI}（实测 ${feats[0]}）`);
    assert.equal(hs.length, 1, `\`${p}\` 只许一个节点（实测 ${hs.length} 个）`);
    assert.equal(hs[0]?.node, nodeIdOf(p), `\`${p}\` 的节点 id 必须是单点派生 \`${nodeIdOf(p)}\`（实测 ${hs[0]?.node}）`);
    assert.equal(hs[0]?.expectations, 0, `\`${p}\` 上不该有判据（B 类 = 0 判据；实测 ${hs[0]?.expectations} 条）`);
  }
});

test('8.1b 计划册里这 25 个 path 的节点 / 语义文件 / 边都不在了（不留幽灵半删）；别的册也不许留这些 id', () => {
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
  for (const s of repoSheets()) {
    const ids = new Set(nodesOf(s).map((n) => String(n.id)));
    for (const id of deletedIds) assert.ok(!ids.has(id) || s.feature === AI, `${s.feature} 册里不该再有节点 \`${id}\`（它只该在 ${AI} 册里）`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 8.2 清单就是批 8 的清单
// ════════════════════════════════════════════════════════════════════
test('8.2 清单形状：25 条 · **码位序**（`sort()`，不是 `localeCompare`）· 段位分布固定', () => {
  assert.equal(PATHS.length, 25, `批 8 是 25 个 path（侦察方案 §1.3 的 B 类，实测 ${PATHS.length}）`);
  assert.equal(new Set(PATHS).size, PATHS.length, '清单不许有重复 path');
  assert.deepEqual([...PATHS].sort(), PATHS, '清单必须按码位序（批 4 裁定②：顺序权威是 `sort()`）');
  assert.deepEqual(Object.keys(CARRIED).sort(), [...PATHS].sort(), '载体指纹表必须与清单**逐条同集**（漏一条 = 有一条没人核）');
  for (const p of PATHS) {
    if (p === ALREADY_OWNED[0]) continue;
    assert.ok(CARRIED[p]!.chars > 0, `\`${p}\` 的职责文本不许空（B 类 = 有职责文本）`);
  }
  const bucket = (re: RegExp) => PATHS.filter((p) => re.test(p)).length;
  assert.equal(bucket(/^scripts\/[^/]+$/), 7, 'scripts/ 段位');
  assert.equal(bucket(/^src\/application\//), 9, 'src/application/ 段位');
  assert.equal(bucket(/^src\/domain\/[^/]+$/), 2, 'src/domain/ 段位');
  assert.equal(bucket(/^src\/infrastructure\/(analysis|authoring|parse)\//), 6, 'src/infrastructure/<子目录>/ 段位');
  assert.equal(bucket(/^src\/infrastructure\/[^/]+$/), 1, 'src/infrastructure/ 根文件段位');
});

// ════════════════════════════════════════════════════════════════════
// 8.3 判据总数守恒 + 8.3b 有牙
// ════════════════════════════════════════════════════════════════════
test('8.3 判据总数守恒：三册合计 826 条（B 类零判据 ⇒ 删 25 个节点、搬 24 条职责文本，一条判据不动）', () => {
  const sheets = repoSheets();
  const per = sheets.map((s) => `${s.feature}=${criteriaTotal([s])}`).join(' · ');
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, `搬职责文本不许带走判据（实测 ${per}）。若某批之后总数合法地变了，改这里是显式动作，不是让它漂`);
  for (const p of PATHS) for (const s of sheets) assert.equal(criteriaTotal([s as unknown as BookSheetLike]) >= 0, true, `\`${p}\` 读数必须可算`);
  const holdings = bookHoldings(sheets);
  for (const p of PATHS) {
    for (const h of holdings.get(p) ?? []) assert.equal(h.expectations, 0, `\`${p}\` 在 ${h.feature} 册上不该有判据（实测 ${h.expectations} 条）`);
  }
});

test('8.3b 上一条**有牙**：纯核副本里删掉一个带判据的属主节点 ⇒ 总数立刻 < 826（同一把尺两个世界）', () => {
  const sheets = repoSheets();
  assert.equal(criteriaTotal(sheets), CRITERIA_TOTAL, '前提：现实的读数是 826');
  const victim = sheets
    .flatMap((s) => nodesOf(s).map((n) => ({ feature: s.feature, id: String(n.id), n })))
    .find((x) => ((x.n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length > 0);
  assert.ok(victim, '必须有至少一个带判据的节点（否则这条反检查没对象）');
  const world2 = sheets.map((s) =>
    s.feature === victim.feature
      ? ({ feature: s.feature, geometry: { nodes: nodesOf(s).filter((n) => String(n.id) !== victim.id) } } as unknown as BookSheetLike)
      : s,
  );
  assert.ok(criteriaTotal(world2) < CRITERIA_TOTAL, '删掉带判据的节点后总数必须变小 —— 否则 8.3 是空断言');
  assert.equal(CRITERIA_TOTAL - criteriaTotal(world2), ((victim.n.decision as { expectations?: unknown[] } | undefined)?.expectations ?? []).length, '差额必须恰是那个节点的判据数');
});

// ════════════════════════════════════════════════════════════════════
// 8.4 职责文本逐字节落在属主册 + 8.4b 有牙
// ════════════════════════════════════════════════════════════════════
test('8.4 搬运：25 条职责文本**逐字节**落在属主册 `semantic.files[].responsibility`；`status` 随迁 3 条', () => {
  const ai = bookOf(AI);
  const tsp = bookOf(TSP);
  let moved = 0;
  let already = 0;
  const statusMoved: string[] = [];
  for (const p of PATHS) {
    const want = CARRIED[p]!;
    const got = respOn(ai, p);
    assert.ok(got.trim(), `\`${p}\` 的职责文本丢了（属主册上没有）—— 删它 = 让叙事蒸发`);
    assert.equal(sha(got), want.sha, `\`${p}\` 的职责文本被改过（sha ${sha(got).slice(0, 16)}… ≠ ${want.sha.slice(0, 16)}…）—— 搬运是**逐字节**的，不是重写`);
    assert.equal(got.trim().length, want.chars, `\`${p}\` 的职责字数必须仍是 ${want.chars}（实测 ${got.trim().length}）`);
    const entry = semanticOf(ai).find((f) => norm(f.path) === p);
    assert.equal(String(entry?.status ?? '') || null, want.status, `\`${p}\` 的 status 必须随迁为 ${String(want.status)}（实测 ${String(entry?.status ?? '∅')}）`);
    if (want.status) statusMoved.push(`${p}=${want.status}`);
    if (p === ALREADY_OWNED[0]) already += 1;
    else moved += 1;
    // 计划册侧同一条 path 的语义条目必须没了（"搬完不删" = 双持还在）
    assert.equal(respOn(tsp, p), '', `计划册侧不该再有 \`${p}\` 的职责文本`);
  }
  assert.equal(moved, 24, `搬运 24 条（实测 ${moved}）`);
  assert.equal(already, 1, `"属主侧已逐字相同"的 1 条（实测 ${already}）`);
  assert.deepEqual(statusMoved.sort(), [
    'src/application/design/line/design_diff.ts=done',
    'src/application/design/rewrite/symbol_diff.ts=draft',
    'src/domain/judge_port.ts=done',
  ], `status 随迁的必须恰好是这 3 条（实测 ${statusMoved.join(', ')}）`);
});

test('8.4b 上一条**有牙**：把属主侧职责清空 / 改一个字节 ⇒ 8.4 的检查立刻红（纯核，不碰真册）', () => {
  const ai = bookOf(AI);
  const p0 = 'scripts/clean-dead-functions.mjs';
  const blank = (p: string, mutate: (s: string) => string) => {
    const sheet = {
      ...ai,
      semantic: {
        files: semanticOf(ai).map((f) => (norm(f.path) === p ? { ...f, responsibility: mutate(String(f.responsibility ?? '')) } : f)),
      },
    } as unknown as BookSheetLike;
    return respOn(sheet, p);
  };
  assert.equal(sha(blank(p0, (s) => s)), CARRIED[p0]!.sha, '前提：不改动时指纹一致');
  assert.notEqual(sha(blank(p0, () => '')), CARRIED[p0]!.sha, '清空职责必须让指纹变 —— 否则 8.4 是空断言');
  assert.notEqual(sha(blank(p0, (s) => `${s} `)), CARRIED[p0]!.sha, '加一个空格也必须让指纹变（逐字节 = 逐字节）');
});

// ════════════════════════════════════════════════════════════════════
// 8.5 域表改判
// ════════════════════════════════════════════════════════════════════
test('8.5 域表改判：25 条属主 = agent-io；计划册 `owns[]` 里这 24 条精确条目没了（67 → 43）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须在：${read.error}`);
  const table = read.table as DesignBooksTable;
  for (const p of PATHS) {
    const hit = ownerOf(table, p);
    assert.equal(hit.matched, true, `\`${p}\` 必须被域表覆盖（实测未命中）`);
    assert.equal(hit.owner, AI, `\`${p}\` 的属主必须是 ${AI}（实测 ${hit.owner}，命中 \`${hit.entry}\`）`);
  }
  const tspOwns = (table.books.find((b) => b.feature === TSP)?.owns ?? []).map((e) => norm(typeof e === 'string' ? e : e.path));
  for (const p of PATHS) {
    if ((ALREADY_OWNED as readonly string[]).includes(p)) continue;
    assert.ok(!tspOwns.includes(p), `计划册 \`owns[]\` 里不该再有精确条目 \`${p}\`（属主已改判）`);
  }
  assert.ok(tspOwns.length <= TSP_OWNS_AFTER_B8, `计划册 owns 只许不增（批 8 收口 ${TSP_OWNS_AFTER_B8}；实测 ${tspOwns.length}）`);
  // 前缀接住：agent-io 的 owns 里有 `src/` 与 `scripts/` ⇒ 摘掉精确条目后这些 path 仍有属主（不是"掉成无人认领"）
  const aiOwns = (table.books.find((b) => b.feature === AI)?.owns ?? []).map((e) => norm(typeof e === 'string' ? e : e.path));
  for (const pre of ['src/', 'scripts/']) assert.ok(aiOwns.includes(pre), `agent-io 的 owns 必须留着前缀 \`${pre}\`（否则改判会让 ${PATHS.length} 条 path 变无人认领）`);
});

// ════════════════════════════════════════════════════════════════════
// 8.6 ② 档：owned + 鉴别力（两世界）
// ════════════════════════════════════════════════════════════════════
test('8.6 ② 档：这 25 条 klass = owned；把它们塞回计划册 ⇒ 立刻 multi_owned（鉴别力）', () => {
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
  const p0 = 'src/domain/todo_chain.ts';
  const world2 = sheets.map((s) =>
    s.feature === TSP
      ? ({
          feature: s.feature,
          geometry: { nodes: [...nodesOf(s), { id: nodeIdOf(p0), label: path.basename(p0), type: 'file', x: 0, y: 0, path: p0 }] },
        } as unknown as BookSheetLike & { feature: string })
      : s,
  );
  const two = crossBookOwnership(world2, read);
  const row2 = two.rows.find((r) => r.path === p0);
  assert.equal(row2?.klass, 'multi_owned', `把 \`${p0}\` 塞回计划册必须判 multi_owned（实测 ${row2?.klass}）`);
  assert.equal(two.counts.multi_owned, now.counts.multi_owned + 1, '多册持有计数必须恰好 +1');
  assert.equal(ownerOf(read.table as DesignBooksTable, p0).owner, AI, `\`${p0}\` 的属主必须仍是 ${AI}`);
});

// ════════════════════════════════════════════════════════════════════
// 8.7 写端：删完之后非属主册再建节点 ⇒ 拒
// ════════════════════════════════════════════════════════════════════
test('8.7 写端：批 8 完成后，**非属主册**再给这个 path 建节点 ⇒ 前置拒（真 saveDSL，盘上零字节变化）', () => {
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
    const tsp = JSON.parse(fs.readFileSync(tspFile, 'utf8'));
    tsp.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const before = fs.readFileSync(tspFile, 'utf8');
    assert.throws(
      () => saveDSL(tsp, 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|not_owner|已由|属主/,
      '非属主册再建节点必须**前置拒**（否则批 8 的删除是可逆的）',
    );
    assert.equal(fs.readFileSync(tspFile, 'utf8'), before, '被拒的写不许留下任何痕迹');

    // 属主册给同一 path 写**职责文本 + status**（与批 8 的搬运同形）⇒ 必须放行
    const aiFile = path.join(dir, `${AI}.dsl.json`);
    const ai = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    ai.semantic = { files: [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts', responsibility: '属主册写自己的 path 必须放行', status: 'done' }] };
    saveDSL(ai, 'mcp', undefined, { baseDir: proj });
    const after = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    assert.equal(after.semantic.files[0].responsibility, '属主册写自己的 path 必须放行', '属主册写职责文本必须落盘（搬运的字段不是"只读装饰"）');
    assert.equal(after.semantic.files[0].status, 'done', '属主册写 status 必须落盘');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 8.8 门档棘轮 + 指纹
// ════════════════════════════════════════════════════════════════════
test('8.8 门档：多册持有只许不增（批 8 收口 132 = 157 − 25）；三组集合指纹与 design-books-baseline.json 逐字一致', () => {
  const read = crossBookReadingOf(REPO);
  assert.ok(read.applied, `域表必须读得出来：${read.table_error}`);
  const now = {
    multi_owned: read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path),
    owner_mismatch: read.rows.filter((r) => r.klass === 'owner_mismatch').map((r) => r.path),
    id_drift: read.id_drift.rows.map((r) => `${r.feature}:${r.id}`),
  };
  assert.ok(
    now.multi_owned.length <= MULTI_OWNED_AFTER_B8,
    `多册持有只许不增（批 8 收口 ${MULTI_OWNED_AFTER_B8}；实测 ${now.multi_owned.length}）—— 变多说明有人把重复节点塞回来了`,
  );
  // 历史算术：157 − 132 = 25 = 本批 path 数（常量对常量，不随批漂）
  assert.equal(MULTI_OWNED_BEFORE_B8 - MULTI_OWNED_AFTER_B8, PATHS.length, '批 8 的降幅必须逐字等于本批 path 数（B 类 25 条，全部只删非属主侧）');
  for (const p of PATHS) {
    assert.ok(!now.multi_owned.includes(p), `\`${p}\` 必须已从多册持有集合里消失`);
    assert.ok(!now.owner_mismatch.includes(p), `\`${p}\` 不该在属主错位集合里（本批改判了域表，所以它该是 owned）`);
  }

  const baselineFile = path.join(REPO, 'scripts', 'design-books-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as Record<string, { count: number; sha256: string }>;
  for (const key of ['multi_owned', 'owner_mismatch', 'id_drift'] as const) {
    const b = baseline[key] as unknown as { count: number; sha256: string };
    assert.ok(b, `基线里必须有 ${key}（否则此档无账可挂）`);
    assert.equal(b.count, now[key].length, `基线 ${key}.count 落后了（实测 ${now[key].length} / 基线 ${b.count}）`);
    assert.equal(b.sha256, shaOf(now[key]), `基线 ${key}.sha256 必须与当前集合逐字一致（集合变了就该显式改基线）`);
  }
  // 另两笔账本批一位不该动（属主错位归批 14，id 漂移归批 15 / T-#NODE-ID-DRIFT）—— 棘轮
  assert.ok(now.owner_mismatch.length <= 12, `属主错位只许不增（批 14 处理）：实测 ${now.owner_mismatch.length}`);
  assert.ok(now.id_drift.length <= 31, `id 漂移只许不增（本批不改名）：实测 ${now.id_drift.length}`);
});

// ════════════════════════════════════════════════════════════════════
// 8.9 带卡留账 2 条（卡一个字节没动）
// ════════════════════════════════════════════════════════════════════
test('8.9 带卡留账：这 2 条 path **仍单持**（不在多册持有集合里），且门档 `why` 逐条点着名字（留账不是漏）', () => {
  const read = crossBookReadingOf(REPO);
  const multi = read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path);
  for (const p of CARD_LEAVE) {
    assert.ok(PATHS.includes(p), `\`${p}\` 必须在本批清单里（它是 B 类成员；批次定义是 25 条全收）`);
    assert.ok(!multi.includes(p), `\`${p}\` 本批已收 ⇒ 不该还在多册持有集合里`);
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8')) as {
    multi_owned: { why?: string };
  };
  for (const p of CARD_LEAVE) {
    assert.ok(String(baseline.multi_owned.why ?? '').includes(p), `门档 multi_owned.why 必须记着带卡留账 \`${p}\`（否则下次没人知道它为什么被收了而不是留到批 16）`);
  }
  // 1 条"属主侧已逐字相同"的例外也必须写在账上
  assert.ok(String(baseline.multi_owned.why ?? '').includes(ALREADY_OWNED[0]), '门档 why 必须记着那条"属主侧已逐字相同、只删"的例外');
});
