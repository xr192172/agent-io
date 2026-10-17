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
 *   ⑥ ★★ **反面（这条证明它真在"翻卡"）**：**没有 decision 的节点 publish ⇒ 必拒**（点名"没有决策卡可翻"）；
 *      另：**给了手写 `data.summary` ⇒ 被"不被认的键"拒**（输入里塞不进我编的描述）；
 *   ⑦ **不覆盖已领的卡**：claimed 上再 publish ⇒ 拒（覆盖 = 换掉正在做的判据）；
 *   ⑧ **进度派生不受影响**：立卡**不写 progress**（overlay 无 progress 落盘），`candidate ⇒ draft` 由 `progressOf` 派生。
 *
 * ## ★★ "自己坏"的对照（B.1；证必须能被自己的反面打红）
 *   · ⑥a：把 publish 退回"造卡"（接受 `data.summary` 凭空立卡）⇒ **⑥b 会变绿**（手写 summary 能进卡）⇒ 本证报红；
 *   · ⑥a：把 publish 退回"接受任何节点"⇒ **⑥a 会变绿**（无 decision 也立出卡）⇒ 本证报红。
 *   （两条都在同一份夹具上、同一次读数里：⑥a 要拒、⑥b 要拒 —— **一条放宽，另一条就会露馅**。）
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
//   claim 链路（④/⑤c/⑦）不能再用"后态全过"的真卡（A/C 都是全绿），改用第三张**有红**的真卡
//   （漂移巡检：task_drift.ts 尚未实现 ⇒ 后态 file-exists 红 ⇒ work ⇒ 可领）。
//   ★ 这不是放宽判据：claim 自身的"可领/不可领"由 certs/t351-card-standing-cert.mjs 覆盖。
const NODED = 'file_src_application_patrol_task_drift_ts';
const REAL3 = PLAN.geometry.nodes.find((n) => n.id === NODED);
if (!REAL3?.decision) {
  console.error('✗ 夹具前置不成立：找不到第三张真决策卡（漂移巡检）');
  process.exit(1);
}

const FEAT = 't350';
const A = REAL.id;
const C = REAL2.id;
const D = REAL3.id; // ★ 有红的真卡（claim 链路用）
const N = 'node_without_decision'; // ★ ⑥ 反面夹具：没有 decision
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
        { id: D, path: REAL3.path, responsibility: '第三张真决策卡（有红 ⇒ claim 链路用）' },
        { id: N, path: 'src/domain/discussion_log.ts', responsibility: '无 decision 的节点' },
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
console.log('\n════ ⑥ 反面：没有决策卡 ⇒ publish **必拒**（它真在"翻卡"，不在"造卡"）════');
{
  const r1 = await run([{ type: 'task', op: 'publish', id: N }], `试图给无 decision 的节点立卡 ${N}`);
  chk(r1.isError && /没有决策卡可翻/.test(r1.text), '⑥a 拒绝并**点名"没有决策卡可翻"**', r1.text.split('\n')[0]);
  chk(nodeOf(N)?.task === undefined, '⑥b 该节点上**没有**留下任何卡（拒 = 一个字节都不写）');

  const r2 = await run(
    [{ type: 'task', op: 'publish', id: N, data: { summary: 'T350 我编的任务描述' } }],
    `试图手写 summary 立卡 ${N}`,
  );
  chk(
    r2.isError && /不被认的键/.test(r2.text) && /summary/.test(r2.text),
    '⑥c 手写 data.summary ⇒ 被"不被认的键"拒',
    r2.text.split('\n')[0],
  );
  chk(nodeOf(N)?.task === undefined, '⑥d 仍然没有卡（★ 这两条一起把"造卡"这条路封死）');

  const r3 = await run(
    [{ type: 'task', op: 'publish', id: N, data: { owner: 'agent-t350' } }],
    `试图给 publish 塞 data.owner ${N}`,
  );
  chk(r3.isError && /不接受 data/.test(r3.text) && /owner/.test(r3.text), '⑥e publish 连 data.owner 都拒（别让已知键被静默忽略）', r3.text.split('\n')[0]);
  chk(nodeOf(N)?.task === undefined, '⑥f 仍然没有卡');
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
console.log('\n════ ⑧ 回归：没有卡的节点 claim ⇒ 仍拒，且文案指向 publish ════');
{
  const r = await run([{ type: 'task', op: 'claim', id: N, data: { owner: 'agent-t350' } }], `无卡领取 ${N}`);
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
console.log('\n════ ⑩ 有 decision 但**只有前态判据** ⇒ 也拒（翻出来的卡必然领不了）════');
{
  const r = await run([{ type: 'task', op: 'publish', id: PRE }], `只有前态判据的卡 ${PRE}`);
  chk(r.isError && /前态判据/.test(r.text) && /必然领不了/.test(r.text), '⑩a 拒绝并说明"后态判据一条不剩"', r.text.split('\n')[0]);
  chk(nodeOf(PRE)?.task === undefined, '⑩b 没有留下卡');
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
