#!/usr/bin/env node
/**
 * ★★★ cert T350 —— **`publish`（立卡 = 翻决策卡）**（2026-10-17 · T12 · `docs/board.md`）。
 *
 * 语义来源：`docs/task-system-plan.dsl.json` 的 `task_plan.task_home`（谁写）
 *   + `task_plan.board.flow[0]`（"从设计 DSL 抽出这一块 ⇒ 形成任务 ⇒ 发布到榜单"）
 *   + `task_plan.provenance.chain`（④ 决策卡 vs DSL 现状 = 红 ⇒ ⑤ 红 = 任务 ⇒ **publish**）。
 *
 * ## 本笔新增的**方向**（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   新 op `edit_dsl {type:'task', op:'publish'}` —— **它不造卡，它翻卡**：
 *   `decision.summary` + `decision.expectations` ⇒ `TaskSpec{summary, expectations, state:'candidate'}`。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **工具层立卡**：对**真决策卡**（`docs/task-system-plan.dsl.json` 的节点，decision 逐字搬进夹具）
 *      调 publish ⇒ 读回 `state=candidate` / `summary` / `expectations`；
 *   ② **内容来自 decision（不是手写）**：`summary` **逐字等于** `decision.summary`、`expectations` 深等；
 *      ★ 且**改掉 decision 再重翻** ⇒ 卡跟着变（不是常量、不是我编的）；
 *   ③ **谁负责让 board 显示它**：publish **不写** board、也不写 progress —— 榜单是**读端**（T8）；
 *   ④ **claim 链路**：candidate ⇒ `claim` ⇒ claimed；
 *   ⑤ **闸两个对照 + 一个中间态**：无卡 ⇒ **拒** · candidate ⇒ **仍拒** · claimed ⇒ **放行**；
 *   ⑥ ★★ **两级对照（2026-10-17 按 `publish_rule.corrected` 改）**：
 *      · **没有 decision ⇒ 不再是"拒"**，而是 **L1 建构卡**（summary 只拼既有字段 + **0 条期望**）；
 *      · **只有前态判据 ⇒ 同样是 L1**（翻成 L2 必 `unknowable`，旧版拒、现在立 L1 并说明原因）；
 *      · **有可判的后态判据 ⇒ L2 实现卡**（①/② 的逐字搬运）。
 *      ★ L1 的详细判据（summary 出处 / 不编判据 / claim / complete / 升 L2）住 `certs/t353-*.mjs`；
 *        本节只保留"L2 → L1 的分界没有把 ① 的翻卡行为改坏"。
 *   ⑦ **不覆盖已领的卡**：claimed 上再 publish ⇒ 拒（覆盖 = 换掉正在做的判据）；
 *   ⑧ **进度派生不受影响**：立卡**不写 progress**（overlay 无 progress 落盘），`candidate ⇒ draft` 由 `progressOf` 派生。
 *
 * ## ★★ "自己坏"的对照（B.1；证必须能被自己的反面打红）
 *   · ⑥：把 publish 退回"造卡"（接受 `data.summary` 凭空立卡）⇒ **⑥d 会变绿**（手写 summary 能进卡）⇒ 本证报红；
 *   · ⑥：把 publish 退回"L1 也编一条期望"⇒ **⑥c 会变绿**（卡上出现实现判据）⇒ 本证报红；
 *   · ⑥：把 L2 分支也降成 L1（不再逐字搬 decision）⇒ **②a/②b 会变绿失败** ⇒ 本证报红。
 *   （三条都在同一份夹具上、同一次读数里：L1 要"无判据"、L2 要"逐字"—— **一条放宽，另一条就会露馅**。）
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 不写真仓 `.agent-io/`：`AGENT_IO_HOME` 指向临时 home；夹具 feature 住那里；
 *   · 判据 `file-exists`/`symbol-exists` 是**现读现解析**（不碰 `cache.db`）⇒ 本证对真仓源码**只读**；
 *   · **MCP 传输层 [未核]**：直接 import handler，不经 server 的 `tools/list` JSON Schema（但 zod enum 已加 `publish`）；
 *   · **board 组件（T8）[未核]**：本证只证"卡被写出来 + 内容来自 decision"，**不证榜单显示**（那一维未建，见回执）。
 *
 * ## 用法
 *   node certs/t350-publish-task-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 夹具用 `mkdtempSync`（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸
//   （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），`rmSync` 夹具会让本证在批量跑里**崩**成假红
//   （`docs/frictions.jsonl` 里 T11 已记该条；这里是它的第一条落地）。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp350-'));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { assertSourceWriteRegistered } = await import('../dist/src/application/write_gate.js');
const { progressOf } = await import('../dist/src/domain/task_schema.js');

// ── 夹具：把**真决策卡**从设计 DSL 逐字搬进来（不是我手写的） ──
const PLAN = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/task-system-plan.dsl.json'), 'utf-8'));
const REAL = PLAN.geometry.nodes.find((n) => n.id === 'file_src_domain_task_schema_ts');
if (!REAL?.decision) {
  console.error('✗ 夹具前置不成立：docs/task-system-plan.dsl.json 里找不到带 decision 的 task_schema 节点');
  process.exit(1);
}
const NODEC = 'file_src_application_design_dsl_ops_task_ops_ts'; // 第二张真卡（用来演示"改 decision ⇒ 卡跟着变"）
const REAL2 = PLAN.geometry.nodes.find((n) => n.id === NODEC);
if (!REAL2?.decision) {
  console.error('✗ 夹具前置不成立：找不到第二张真决策卡');
  process.exit(1);
}
// ★★ 2026-10-17（T13 · cardStanding）：`satisfied` 卡**不可领**（没活干不许领）⇒
//   claim 链路（④/⑤c/⑦）不能用"后态全过"的真卡（A/C 都是全绿）。
// ★★★ 2026-10-17（流程体检 #1）：原先借的是**真卡**「漂移巡检（task_drift）」—— 那卡当时红。
//   而 task_drift 一旦被**做完**（本笔就做完了），该卡变 `satisfied` ⇒ **证自己红**。
//   ⇒ 那是一条"证的夹具依赖外部真实待办"的隐式耦合（★ 与 `docs/frictions.jsonl` 里
//     『夹具前置是隐形消费方』同族，方向相反：不是改判据打断夹具，而是**待办被做完**打断夹具）。
//   ⇒ 改成**自造**一张 work 卡：盘上不存在的路径 + 一条 `file-exists` ⇒ 永远红、永远可领。
//     ★ 这不动任何断言：claim 的"可领/不可领"仍由 certs/t351-card-standing-cert.mjs 覆盖。
const NODED = 'node_work_fixture';
const WORK_PATH = 'src/domain/t350_work_fixture.ts'; // ★ 盘上不存在 ⇒ file-exists 必红 ⇒ standing=work
const REAL3 = {
  id: NODED,
  type: 'file',
  label: 'work 夹具卡（自造）',
  path: WORK_PATH,
  description: WORK_PATH,
  decision: {
    summary: 'T350 夹具：一条必红的 file-exists ⇒ 这张卡永远 work（可领）',
    expectations: [
      { kind: 'file-exists', path: WORK_PATH, why: 'T350 夹具：该文件不存在 ⇒ 后态必红 ⇒ claim 链路可跑' },
    ],
  },
};

const FEAT = 't350';
const A = REAL.id;
const C = REAL2.id;
const D = REAL3.id; // ★ 有红的真卡（claim 链路用）
const N = 'node_without_decision'; // ★ ⑥ 夹具：没有 decision（⇒ 现在立 L1 建构卡）
const N2 = 'node_no_card'; // ★ ⑧ 夹具：**既没有 decision 也没有卡**（claim 的"无任务格"仍要拒）
const PRE = 'node_only_pre_criteria'; // ★ ⑩ 夹具：有 decision，但**只有前态判据**
const EDIT = 'src/domain/overlay.ts'; // ★ 只用于"没有任何卡"的闸对照（该文件不是本夹具的节点 ⇒ 见下方 ⑤a 说明）

const nodeOf = (id) => (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === id);
const seed = (overrides = {}) =>
  saveDSL({
    id: `feature_${FEAT}`,
    type: 'feature_diagram',
    feature: FEAT,
    version: '1.0.0',
    title: FEAT,
    source_root: REPO, // ★ 真仓 = 被分析项目的根（判据现读现解析，只读）
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [
        // ★ decision 逐字搬（JSON 深拷，夹具不改一个字段）
        { ...JSON.parse(JSON.stringify(REAL)), description: REAL.path },
        { ...JSON.parse(JSON.stringify(REAL2)), description: REAL2.path },
        { ...JSON.parse(JSON.stringify(REAL3)), description: REAL3.path },
        { id: N, type: 'file', label: 'no decision', description: 'src/domain/discussion_log.ts' },
        { id: N2, type: 'file', label: 'no card', description: 'src/domain/no_card_fixture.ts' },
        {
          id: PRE,
          type: 'file',
          label: 'only pre criteria',
          description: 'src/domain/pre_only_fixture.ts',
          decision: {
            summary: 'T350 夹具：只有前态判据的决策卡',
            expectations: [
              {
                kind: 'edge-absent',
                from: 'src/domain/pre_only_fixture.ts',
                to: 'src/domain/task_schema.ts',
                why: 'T350 夹具：前态判据（未施工时天然成立）',
              },
            ],
          },
        },
        ...(overrides.extraNodes ?? []),
      ],
      edges: [],
    },
    semantic: {
      files: [
        { id: A, path: REAL.path, responsibility: '真决策卡夹具' },
        { id: C, path: REAL2.path, responsibility: '第二张真决策卡' },
        { id: D, path: REAL3.path, responsibility: 'work 夹具卡（自造：file-exists 必红 ⇒ 可领）' },
        { id: N, path: 'src/domain/discussion_log.ts', responsibility: '讨论记录：把讨论日志落成设计 DSL 里的一条' },
        { id: N2, path: 'src/domain/no_card_fixture.ts', responsibility: '无卡节点（⑧ 用）' },
        { id: PRE, path: 'src/domain/pre_only_fixture.ts', responsibility: '只有前态判据的节点' },
      ],
    },
  });
seed();

const edit = (ops, reason) =>
  editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t350', reason, operations: ops });
/** ★ handler 是 `wrap`（`plumbing.ts:48`）：**不抛错**，错误走 `{ text, isError:true }` ⇒ 本证如实读它。 */
const run = async (ops, reason) => {
  const r = await edit(ops, reason);
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};
const gate = (rel) => {
  try {
    return { ok: true, note: assertSourceWriteRegistered(REPO, [rel]).note };
  } catch (e) {
    return { ok: false, msg: String(e.message) };
  }
};

// ════════════════════════════════════════════════════════════════════
console.log('════ ⑤a 闸对照一：无卡 ⇒ 拒（立卡之前）════');
{
  const g = gate(REAL.path);
  chk(!g.ok, `立卡前：${REAL.path} 被闸拒`, (g.msg ?? '').split('\n')[0]);
  chk(/op:'publish'/.test(g.msg ?? ''), '★ 拒绝文案已经指向 publish（不再只教 claim —— 那对新 feature 不可满足）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ① 工具层立卡：publish 真节点（内容来自 decision）════');
const DEC_A = JSON.parse(JSON.stringify(REAL.decision));
{
  const before = nodeOf(A);
  const r = await run([{ type: 'task', op: 'publish', id: A }], `从决策卡立卡 ${A}`);
  const after = nodeOf(A);
  console.log('     message =', r.text.split('\n').slice(0, 3).join(' ｜ '));
  chk(!r.isError, '①a 工具层**成功**（isError=false）');
  chk(!before.task, '①b 立卡前该节点**没有** task（不是覆盖）');
  chk(after.task?.state === 'candidate', `①c task.state = ${JSON.stringify(after.task?.state)}`);
  chk(after.task?.id === A, `①d task.id = node_id = ${A}`);
  chk(
    after.task?.summary === DEC_A.summary,
    '②a summary **逐字等于** decision.summary（不是我编的描述）',
    `card=${JSON.stringify(after.task?.summary)}\n     decision=${JSON.stringify(DEC_A.summary)}`,
  );
  chk(
    JSON.stringify(after.task?.expectations) === JSON.stringify(DEC_A.expectations),
    `②b expectations **深等**（${DEC_A.expectations.length} 条，逐字来自 decision）`,
    `card=${JSON.stringify(after.task?.expectations?.map((e) => e.kind))}`,
  );
  chk(
    after.task?.expectations?.every((e, i) => JSON.stringify(e) === JSON.stringify(DEC_A.expectations[i])),
    '②c 逐条 expectations 与 decision 一致（顺序也不动）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤b 闸对照二：有 candidate（未领）⇒ **仍拒**（闸只认 claimed）════');
{
  const g = gate(REAL.path);
  chk(!g.ok, 'candidate 不解锁落盘（否则"立了卡"就等于"已开工"）', (g.msg ?? '').split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 进度派生：立卡**不写 progress**（candidate ⇒ draft 由 progressOf 派生）════');
{
  const n = nodeOf(A);
  const ov = loadOverlay(FEAT);
  chk(n.status === 'draft', `③a 读回 node.status = ${JSON.stringify(n.status)}（派生投影，不是第二份权威）`);
  chk(progressOf(n.task) === 'draft', `③b progressOf(candidate) = ${JSON.stringify(progressOf(n.task))}`);
  chk(
    ov?.anchors?.[A]?.progress === undefined,
    `③c overlay 里**没有** progress 落盘（anchors[${A}].progress = ${JSON.stringify(ov?.anchors?.[A]?.progress ?? null)}）`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ claim（candidate ⇒ claimed；★ 用**有红**的真卡 D —— satisfied 卡不可领）════');
{
  await run([{ type: 'task', op: 'publish', id: D }], `从漂移巡检的决策卡立卡 ${D}`);
  const r = await run([{ type: 'task', op: 'claim', id: D, data: { owner: 'agent-t350' } }], `领取 ${D}`);
  const n = nodeOf(D);
  console.log('     message =', r.text.split('\n')[0]);
  chk(!r.isError, '④a 工具层 claim 成功');
  chk(n.task?.state === 'claimed' && n.task?.owner === 'agent-t350', `④a state=${n.task?.state} owner=${n.task?.owner}`);
  chk(progressOf(n.task) === 'in_progress' && n.status === 'in_progress', `④b claimed ⇒ progress=in_progress（${n.status}）`);
}

console.log('\n════ ⑤c 闸对照三：claimed ⇒ **放行**════');
{
  const g = gate(REAL3.path);
  chk(g.ok, `claimed 后同一文件**放行**`, (g.note ?? '').split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ 两级分界：没有 decision ⇒ **L1 建构卡**（不再是拒；0 条期望，不编判据）════');
{
  const r1 = await run([{ type: 'task', op: 'publish', id: N }], `给无 decision 的节点立 L1 卡 ${N}`);
  console.log('     message =', r1.text.split('\n').slice(0, 3).join(' ｜ '));
  const card = nodeOf(N)?.task;
  chk(!r1.isError && /L1 建构卡/.test(r1.text), '⑥a 立卡**成功**，回执点名"级别 = L1 建构卡"', r1.text.split('\n')[0]);
  chk(card?.state === 'candidate', `⑥b 卡落在节点上：state=${JSON.stringify(card?.state)}`);
  chk(
    Array.isArray(card?.expectations) && card.expectations.length === 0,
    '⑥c ★★ 卡上 **0 条期望** —— L1 的验收是"DSL 建构完整"，**不编实现判据**',
    `expectations=${JSON.stringify(card?.expectations)}`,
  );
  chk(
    /待建构/.test(card?.summary ?? '') && (card?.summary ?? '').includes(N) && /讨论记录/.test(card?.summary ?? ''),
    '⑥d summary 注明"待建构"，且**出处来自既有字段**（semantic.responsibility + id），不是编的',
    `summary=${JSON.stringify(card?.summary)}\n     summary_source=${JSON.stringify(r1.text.includes('semantic.files') ? 'semantic.files[].responsibility（回执已显形）' : '?')}`,
  );
  chk(
    /不编/.test(r1.text) && /不是代码跑通|不是"代码跑通"|不是代码跑通/.test(r1.text),
    '⑥e 回执明说"不编判据"+"判据不是代码跑通"',
    r1.text.split('\n')[1] ?? '',
  );
  chk(
    card?.discussion?.micro?.includes('summary 出处') === true,
    '⑥f 卡上 `discussion.micro` 记了 **summary 的出处**（内容可对拍）',
    JSON.stringify(card?.discussion),
  );

  // ★ 手写内容仍然进不来（这条没变）
  const r2 = await run(
    [{ type: 'task', op: 'publish', id: N2, data: { summary: 'T350 我编的任务描述' } }],
    `试图手写 summary 立卡 ${N2}`,
  );
  chk(r2.isError && /不被认的键/.test(r2.text) && /summary/.test(r2.text), '⑥g 手写 data.summary ⇒ 仍被"不被认的键"拒', r2.text.split('\n')[0]);
  const r3 = await run(
    [{ type: 'task', op: 'publish', id: N2, data: { owner: 'agent-t350' } }],
    `试图给 publish 塞 data.owner ${N2}`,
  );
  chk(r3.isError && /不接受 data/.test(r3.text) && /owner/.test(r3.text), '⑥h publish 连 data.owner 都拒（别让已知键被静默忽略）', r3.text.split('\n')[0]);
  chk(nodeOf(N2)?.task === undefined, '⑥i 两次被拒 ⇒ 该节点上**一个字节都没写**（拒 = 不落盘）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 内容跟随 decision（改 decision ⇒ 重翻的卡跟着变；不是常量）════');
{
  // C 是第二张**真卡**（task_ops 节点：它的 decision.expectations 有 6 条）
  await edit([{ type: 'task', op: 'publish', id: C }], `从第二张决策卡立卡 ${C}`);
  const first = nodeOf(C).task;
  console.log('     第一次 summary =', JSON.stringify(first?.summary));
  chk(first?.summary === REAL2.decision.summary, '②d 第一次立卡 = 该节点的 decision.summary');

  // ★ 改 decision（只改夹具里的这张卡的 summary），再重翻 candidate
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n) =>
    n.id === C ? { ...n, decision: { ...n.decision, summary: 'T350-SENTINEL：决策已改，卡必须跟着变' } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
  const r = await run([{ type: 'task', op: 'publish', id: C }], `决策改了，重翻 ${C}`);
  const second = nodeOf(C).task;
  console.log('     重翻后 summary =', JSON.stringify(second?.summary));
  chk(second?.summary === 'T350-SENTINEL：决策已改，卡必须跟着变', '②e 重翻 = 新 decision.summary（★ 证明它是"读"出来的）');
  chk(/已重翻/.test(r.text), '②f 回执说"已重翻"（candidate 允许重翻）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑦ 不覆盖已领的卡（claimed 上再 publish ⇒ 拒）════');
{
  const r = await run([{ type: 'task', op: 'publish', id: D }], `试图覆盖已领的卡 ${D}`);
  chk(r.isError && /state=claimed/.test(r.text), '⑦a 拒绝并点名已有卡的 state', r.text.split('\n')[0]);
  chk(nodeOf(D)?.task?.owner === 'agent-t350', '⑦b 已领的卡**原样还在**（owner 没被抹掉）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑧ 回归：**没有任何卡**的节点 claim ⇒ 仍拒，且文案指向 publish ════');
{
  const r = await run([{ type: 'task', op: 'claim', id: N2, data: { owner: 'agent-t350' } }], `无卡领取 ${N2}`);
  chk(
    r.isError && /没有任务格/.test(r.text) && /publish/.test(r.text),
    '⑧a 无卡 claim 被拒，且教的是 publish（不是"去 board 手抄"）',
    r.text.split('\n')[0],
  );
  chk(/不替你凭空造/.test(r.text), '⑧b 仍明说"不替你凭空造一张空卡"');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑨ "自己坏"对照：把卡改成手写内容 ⇒ 出处判据**当场变假**（证明 ② 的等值不是恒真）════');
{
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n) =>
    n.id === C ? { ...n, task: { ...n.task, summary: 'T350 我手写的任务描述' } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
  const card = nodeOf(C).task;
  const decisionNow = nodeOf(C).decision;
  chk(
    card?.summary !== decisionNow.summary,
    '⑨a 篡改后："card.summary === decision.summary" **变假**（若将来判据恒真，这条会露馅）',
    `card=${JSON.stringify(card?.summary)} · decision=${JSON.stringify(decisionNow.summary)}`,
  );
  chk(
    JSON.stringify(card?.expectations) === JSON.stringify(decisionNow.expectations),
    '⑨b 但 expectations 仍等 ⇒ 变的只有被篡改的那一格（对照不是"整体比较失败"）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑩ 有 decision 但**只有前态判据** ⇒ 也是 L1（翻成 L2 必 unknowable）════');
{
  const r = await run([{ type: 'task', op: 'publish', id: PRE }], `只有前态判据的卡 ${PRE}`);
  chk(
    !r.isError && /L1/.test(r.text) && /前态判据/.test(r.text) && /0 条/.test(r.text),
    '⑩a 立 **L1**，回执**点名原因**（"只有前态判据 / 后态 0 条"）',
    r.text.split('\n')[0],
  );
  chk(
    nodeOf(PRE)?.task?.expectations?.length === 0,
    `⑩b 卡上 0 条期望（★ 不把前态判据抄进 L1 卡 —— 抄进去就变成"天然全过"的假判据）`,
    JSON.stringify(nodeOf(PRE)?.task?.expectations),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
