#!/usr/bin/env node
/**
 * ★★★ cert T348 —— **「Expectation 自带 phase」收归** 的出生证（2026-10-16 · T10 · `docs/board.md`）。
 *
 * ## 这一笔要钉住什么（方向 = `docs/principle-rewrite-not-patch.md` §四）
 * 原先「前态判据（`edge-absent`）不参与『已满足』判定」是 `src/domain/task_machine.ts` 里
 * 的一份**清单 + 剔除**（`NEGATIVE_KINDS` / `positiveExpectations`）—— ★ 那是补丁
 * （别处要"记得剔"；同类再来一次要"再加一条"）。收归后：**分类由「期望自带的 phase」决定**，
 * 状态机里不再有任何清单。本证要钉住的**新方向** =
 *   ★ **「phase 决定是否参与『已满足』判定」且「无需外部清单」**。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **结构**：`expectationPhase` 由 `kind` 自带 —— `edge-absent ⇒ 'pre'`，其余五种 ⇒ `'post'`；
 *   ② ★★ **反例对照（本笔必须有）**：一张**未领**（candidate）的卡，其判据**只有一条 `edge-absent`**
 *      ⇒ 后态判据一条不剩 ⇒ 读数 = **`unknowable` 且不可领**（★ 不许因"前态判据天然成立"被判 `satisfied`）；
 *   ③ **正例对照（前态不外溢）**：同上卡再挂一条**不满足的后态判据** ⇒ `standing='work'`、
 *      且 `satisfaction.failed===1`（证明前态 `edge-absent` **没有**把"未满足的后态判据"掩盖过去）；
 *   ④ **正例**：后态判据**满足** ⇒ `standing='satisfied'`、`isSatisfied=true`，且**分区**清楚：
 *      `judged.post` 只有那 1 条、`judged.pre` 只有前态那 1 条（前态按 phase 排除出**满足度**）；
 *      ★ 2026-10-17（T13）订正：本项原先断言"后态全过 ⇒ 可领"，那是 `canClaim` 的旧语义；
 *      现在"后态全过 ⇒ **只可收口、不可领**"（讨论 2 · P30），故改断 `satisfied` 与 `isSatisfied`。
 *   ⑤ ★ **走工具层**：经 `edit_dsl`（`editDslHandler`）把一条 `edge-absent` 写进决策卡 ——
 *      ★ 成功且原样读回 ⇒ 证明收归**没有**给数据加"必填字段"（`Expectation` 的数据形状未变）；
 *   ⑥ **补丁已删**：`src/domain/task_machine.ts` **源码**里不再有 `NEGATIVE_KINDS` /
 *      `positiveExpectations` / `isNegativeExpectation` 的**导出**，且它的分类**从 phase 派生**。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 本证**不打开真仓 `cache.db`** —— 只在**夹具根** `certs/.work/tmp348/root` 现刷一份自己的索引
 *     （★ 为什么必须刷：没有索引时 `edge-absent` 只会判 `unsupported`，② 的反例就"混进去也不红"）；
 *   · **传输 / schema 层 [未核]**：直接 import handler，**没经** MCP server 的 `tools/list` JSON Schema；
 *   · **索引层 [未核]**：本证只在夹具内 `syncFile` 一个文件，**不声称**覆盖全量/跨语言索引；
 *   · ⑥ 是**源码文本**判据（本仓对文本判据有戒心）—— 它只作"补丁确实不在代码里"的**辅助**，
 *     行为面由 ②③④ 与 `certs/.work/probe-t348-compare.mjs`（同底逐条对拍）承担。
 *
 * ## 用法
 *   node certs/t348-phase-classification-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp348');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { expectationPhase, postExpectations } = await import('../dist/src/domain/expectation.js');
const { cardStanding, isClaimable, isSatisfied } = await import('../dist/src/domain/task_machine.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { saveDSL, getFeaturesDir } = await import('../dist/src/infrastructure/storage.js');
const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');
const { getProjectCacheDb, closeProjectCacheDb } = await import('../dist/src/infrastructure/index/db.js');
const { syncFile } = await import('../dist/src/infrastructure/index/symbols.js');

// ── 夹具：代码根（`file-exists` 用 fs；`edge-absent` 要索引 ⇒ **现刷**一份夹具自己的 cache.db）──
//   ★ 为什么非刷不可：没有索引时 `edge-absent` 判 **unsupported** ⇒ 反例就成了"混进去也不红"的空判据；
//     有了索引（exists.ts 不依赖 missing.ts）它才真的判 **pass** ⇒ 才能分辨"按 phase 排除 vs 不排除"。
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/exists.ts'), 'export const ok = 1;\n', 'utf-8');
const db = getProjectCacheDb(ROOT);
await syncFile(db, ROOT, path.join(ROOT, 'src/exists.ts'));

const EDGE_ABSENT = { kind: 'edge-absent', from: 'src/exists.ts', to: 'src/missing.ts', why: 'T348 夹具：前态判据（不该依赖一个不存在的目标 ⇒ 未施工时天然成立）' };
const POST_MISSING = { kind: 'file-exists', path: 'src/missing.ts', why: 'T348 夹具：不存在的后态判据' };
const POST_OK = { kind: 'file-exists', path: 'src/exists.ts', why: 'T348 夹具：存在的后态判据' };
const card = (id, expectations) => ({ id, summary: `T348 ${id}`, expectations, state: 'candidate' });
// ★ 2026-10-21（D-judge-port）：判定器改成**注入**（`StandingInput.judge` 必填）—— 四段夹具共用这一份 opts
//   （★ 必须放在 `ROOT` 定义**之后**：ESM 的 `const` 不是 hoisted 的，提前引用会 ReferenceError）。
//   ★ 注入的仍是生产那个 `judgeExpectations`（本证验的是「phase 分区」，不是另写一个判定器）。
const OPTS = { root: ROOT, nodes: [], judge: judgeExpectations };

// ════════════════════════════════════════════════════════════════════
console.log('════ ① 结构：phase 由 kind 自带（分类不再来自任何外部清单）════');
{
  const pre = expectationPhase(EDGE_ABSENT);
  const others = [
    { kind: 'file-exists', path: 'x', why: 'w' },
    { kind: 'symbol-exists', path: 'x', symbol: 's', why: 'w' },
    { kind: 'signature-matches', path: 'x', symbol: 's', signature: 'f()', why: 'w' },
    { kind: 'edge-exists', from: 'x', to: 'y', why: 'w' },
    { kind: 'call-exists', path: 'x', symbol: 's', target: 't', why: 'w' },
  ].map((e) => expectationPhase(e));
  chk(pre === 'pre', `①a expectationPhase(edge-absent) === 'pre'`, `实取 = ${JSON.stringify(pre)}`);
  chk(others.every((p) => p === 'post'), `①b 其余五种 kind ⇒ 'post'`, `实取 = ${JSON.stringify(others)}`);
  chk(postExpectations([EDGE_ABSENT, POST_OK]).length === 1, '①c postExpectations 只留后态（前态按 phase 排除）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② ★★ 反例对照：只有前态判据的【未领】卡，不许被判「已满足」════');
{
  const v = await cardStanding(card('only-pre', [EDGE_ABSENT]), OPTS);
  chk(v.standing === 'unknowable' && !isClaimable(v.standing), '②a standing=unknowable 且不可领（前态天然成立，但不许据此收口）', `reason = ${v.reason}`);
  chk(v.judged.post.length === 0, '②b judged.post 为空（前态不参与「满足度」判定）', `judged.post.length = ${v.judged.post.length}`);
  chk(/后态判据|phase/.test(v.reason), '②c 拒因**点名**是"后态判据一条不剩"（不是"剔前态后空集"这句补丁措辞）', v.reason);

  // ②d ★ 前提自证（让反例"能分辨"）：同一条 edge-absent **单独**判 = **pass**（未施工时天然成立）
  //   ⇒ 若不按 phase 排除，未领的卡会「全过」= **假绿**。★ 反过来也说明：夹具**必须**有索引，
  //     否则 edge-absent 只会判 unsupported，反例就成了"混进去也不红"的空判据。
  const rep = await judgeExpectations(ROOT, [{ node_id: 'only-pre', node_label: 'x', expectation: EDGE_ABSENT }]);
  chk(rep.passed === 1, '②d 前提自证：edge-absent 单独判 = pass（"天然成立"确实会假绿）⇒ 必须由 phase 排除', JSON.stringify({ passed: rep.passed, failed: rep.failed, unsupported: rep.unsupported }));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 正例对照：前态 edge-absent 不许"掩盖"一条未满足的后态判据 ════');
{
  const v = await cardStanding(card('pre+post-fail', [EDGE_ABSENT, POST_MISSING]), OPTS);
  chk(v.standing === 'work' && isClaimable(v.standing), '③a standing=work（前态天然成立，但后态没满足 ⇒ 有活干）', `reason = ${v.reason}`);
  chk(v.satisfaction.failed === 1 && v.satisfaction.passed === 0, '③b satisfaction：failed=1 且 passed=0（判的是那条后态，不是前态）', JSON.stringify(v.satisfaction));
  chk(v.judged.post.length === 1 && v.judged.post[0].kind === 'file-exists', '③c judged.post 只含那 1 条后态判据');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ 正例：后态判据满足 ⇒ standing=satisfied（只可收口），judged 按 phase 分区 ════');
{
  const v = await cardStanding(card('pre+post-ok', [EDGE_ABSENT, POST_OK]), OPTS);
  chk(v.standing === 'satisfied', `④a standing === 'satisfied'`, `reason = ${v.reason}`);
  chk(v.judged.post.length === 1 && expectationPhase(v.judged.post[0]) === 'post', '④b judged.post 只含 1 条**后态**判据（前态已按 phase 排除出满足度）');
  chk((await isSatisfied(card('pre+post-ok', [EDGE_ABSENT, POST_OK]), OPTS)).satisfied === true, '④c isSatisfied === true（独立调用；收口侧读这一条）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ ★ 走工具层：edge-absent 经 edit_dsl 写入决策卡（证明数据形状未被加"必填字段"）════');
const FEAT = 't348';
const NODE = 'file_src_domain_task_schema_ts';
{
  saveDSL({
    id: `feature_${FEAT}`,
    type: 'feature_diagram',
    feature: FEAT,
    version: '1.0.0',
    title: FEAT,
    source_root: ROOT,
    geometry: { layout: 'free', width: 400, height: 300, nodes: [{ id: NODE, type: 'file', label: 'task_schema.ts' }], edges: [] },
  });
  const res = await editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: 'T348 夹具：经 edit_dsl 给节点写一条前态判据 edge-absent（证明收归后写入路径未加必填字段）',
    operations: [{ type: 'decision', op: 'update', id: NODE, data: { summary: 'T348 夹具卡', acceptance: '夹具', expectations: [EDGE_ABSENT] } }],
  });
  chk(res.isError !== true, '⑤a edit_dsl 未拒（edge-absent 未带 phase 也能写 ⇒ 收归没把 phase 变成必填字段）', res.isError ? `★ 被拒：${String(res.text).split('\n').slice(-1)[0]}` : String(res.text).split('\n')[0]);
  const stored = JSON.parse(fs.readFileSync(path.join(getFeaturesDir(), `${FEAT}.json`), 'utf8'));
  const got = (stored.geometry?.nodes ?? []).find((n) => n.id === NODE)?.decision?.expectations ?? [];
  chk(got.some((e) => e.kind === 'edge-absent'), '⑤b 读回：存盘里那条 edge-absent 原样在（数据形状 = kind/from/to/why，无 phase 字段）', JSON.stringify(got));
  chk(got.every((e) => !('phase' in e)), '⑤c ★ 且**没有**任何期望被塞进 phase 字段（phase 是派生维，不落盘 ⇒ 不复制事实）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ 补丁已删（源码）＋ 分类已从 phase 派生 ════');
{
  const m = fs.readFileSync(path.join(REPO, 'src/domain/task_machine.ts'), 'utf8');
  const gone = !/export (const|function) (NEGATIVE_KINDS|positiveExpectations|isNegativeExpectation)/.test(m);
  const derives = /postExpectations|expectationPhase/.test(m);
  chk(gone, '⑥a task_machine.ts 里**不再有** NEGATIVE_KINDS / positiveExpectations / isNegativeExpectation 的导出');
  chk(derives, '⑥b task_machine.ts 的选取**从 phase 派生**（调用 expectation.ts 的 postExpectations/expectationPhase）');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
closeProjectCacheDb(ROOT);
process.exit(F > 0 ? 1 : 0);
