#!/usr/bin/env node
/**
 * ★★★ cert T349 —— **给 task 格立原生家 + 唯一写端 + 两轴消歧 + 闸换判据**（2026-10-17 · T11 · `docs/board.md`）。
 *
 * 语义来源：`docs/task-system-plan.dsl.json` 的 `task_plan.task_home`（OQ11 裁定 B 的展开）。
 *
 * ## 本笔新增的**方向**（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ① **新家**：`geometry.nodes[].task`（Node 有了 `task` 字段）；
 *   ② **新写端**：`edit_dsl {type:'task'}`（claim / release / complete）—— 任务态**只**从这里改；
 *   ③ **新派生**：`progressOf(task)`（五态 ⇒ 三轴；`void`/`superseded` ⇒ `undefined`）+ 读端 `applyOverlay` 改为派生优先；
 *   ④ **新判据**：`assertSourceWriteRegistered` 从「overlay 的 progress 登记过」改成「该节点上有一张 claimed 任务卡」。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **两轴映射表**：candidate⇒draft · claimed⇒in_progress · done⇒done · **void/superseded⇒undefined**（★ 不许硬塞）。
 *   ② **读端派生（两个实测对照）**：(a) `state=claimed` 且 overlay 写着 `progress='draft'` ⇒ 读到 **in_progress**（派生压过影子）；
 *      (b) `state=void` 且 overlay 写着 `progress='done'` ⇒ 读到 **undefined**（★ 不硬塞、也不回落 overlay）；
 *      (c) 无 task 的节点仍回落 overlay（防回归）。
 *   ③ **闸两个对照**：(a) 无 task ⇒ **拒**；(b) 有 claimed task ⇒ **放行**。
 *      ★★ 外加**能自己坏**的对照：(c) **无 task 但 overlay 已播种 progress='done'** ⇒ **仍拒** ——
 *      旧判据（progress 非空即放行）在这条夹具上会**放行** ⇒ 这条一旦变绿，就说明判据退回旧版。
 *   ④ **走工具层**（`edit_dsl` → `editDslHandler` 真路径）：claim 成功并读回 `state/owner/claimed_at`；
 *      complete 带 evidence 成功；**无卡可领**时被拒且**点名"不造卡"**；claim 后**旧写端 `updateStatus` 改不动派生进度**。
 *   ⑤ **单一写端**（源码辅助判据）：`node.task` 的赋值只出现在 `task_ops.ts`（不在 `status_tools.ts`）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 不打开真仓 `cache.db` —— 全部落 `certs/.work/tmp349/`，`AGENT_IO_HOME` 指向临时 home；
 *   · **MCP 传输层 [未核]**：直接 import handler，不经 server 的 `tools/list` JSON Schema（但 `OP_SPECS` 与 zod enum 都改了）；
 *   · **跨进程并发 [未核]**：CAS 的"单写者"前提是 daemon 队列 / 单进程；本证只验单进程顺序；
 *   · ⑤ 是**源码文本**判据（本仓对文本有戒心），只作辅助；行为面由 ②③④ 承担。
 *
 * ## 用法
 *   node certs/t349-task-home-cert.mjs        # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp349');
fs.rmSync(TMP, { recursive: true, force: true });
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
for (const f of ['a.ts', 'b.ts', 'c.ts']) fs.writeFileSync(path.join(ROOT, 'src', f), `export const ${f[0]} = 1;\n`, 'utf-8');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 全部用**动态 import**
process.env.AGENT_IO_HOME = path.join(TMP, 'home');

const { progressOf } = await import('../dist/src/domain/task_schema.js');
const { applyOverlay } = await import('../dist/src/domain/overlay.js');
const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay, saveOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { assertSourceWriteRegistered } = await import('../dist/src/application/write_gate.js');
const { updateStatus } = await import('../dist/src/application/design/dsl_ops/status_tools.js');
// ★ 2026-10-22（链 C · 身份归一化）：断言用**同一份文法**（`domain/actor_spec.ts`），不在这里另写正则。
const { isCanonicalActor, isLegacyActorName, sameActor } = await import('../dist/src/domain/actor_spec.js');

const FEAT = 't349';
const A = 'file_src_a_ts'; // 有 task（可 claim / complete）
const B = 'file_src_b_ts'; // **无 task**（闸必须拒）
const C = 'file_src_c_ts'; // 有 task（claim → release）
const D = 'file_src_b_ts'; // 复用 B：补一份"overlay 已播种 progress"的影子 —— 见 ③c

// ★ 2026-10-17（T13 · cardStanding）：`satisfied` 卡**不可领**（没活干不许领）⇒
//   夹具卡必须是"有活干"的那一格（一条**未满足**的后态判据），否则 ④b 的 claim 会被拒。
//   ★ 施工完成由 `markSatisfied()` 摆态（真实流程里是"把活干完"）。
const card = (id, p) => ({
  id,
  summary: `T349 ${id}`,
  expectations: [{ kind: 'file-exists', path: `${p}.todo`, why: 'T349 夹具：**未满足**的后态判据（有活干 ⇒ 可领）' }],
  state: 'candidate',
});

/** ★ 夹具摆态：把该卡的判据换成一条**已满足**的（模拟"活干完了"）。不是产品行为。 */
const markSatisfied = (id, p) => {
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n) =>
    n.id === id ? { ...n, task: { ...n.task, expectations: [{ kind: 'file-exists', path: p, why: 'T349 夹具：活干完了（后态判据已满足）' }] } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
};

saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: ROOT,
  geometry: {
    layout: 'free',
    width: 400,
    height: 300,
    nodes: [
      { id: A, type: 'file', label: 'a.ts', description: 'src/a.ts', task: card(A, 'src/a.ts') },
      { id: B, type: 'file', label: 'b.ts', description: 'src/b.ts' },
      { id: C, type: 'file', label: 'c.ts', description: 'src/c.ts', task: card(C, 'src/c.ts') },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: A, path: 'src/a.ts', responsibility: 'a' },
      { id: B, path: 'src/b.ts', responsibility: 'b' },
      { id: C, path: 'src/c.ts', responsibility: 'c' },
    ],
  },
});

const edit = (ops, reason) =>
  editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t349', reason, operations: ops });
const nodeOf = (id) => (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === id);
const gate = (rel) => {
  try {
    return { ok: true, note: assertSourceWriteRegistered(ROOT, [rel]).note };
  } catch (e) {
    return { ok: false, msg: String(e.message) };
  }
};

// ════════════════════════════════════════════════════════════════════
console.log('════ ① 两轴映射表：progressOf(五态) ⇒ 三轴（★ void/superseded 返回 undefined，不许硬塞）════');
{
  const table = {
    candidate: progressOf({ state: 'candidate' }),
    claimed: progressOf({ state: 'claimed' }),
    done: progressOf({ state: 'done' }),
    void: progressOf({ state: 'void' }),
    superseded: progressOf({ state: 'superseded' }),
  };
  console.log(`     映射表 = ${JSON.stringify(table)}`);
  chk(table.candidate === 'draft', '①a candidate ⇒ draft');
  chk(table.claimed === 'in_progress', "①b claimed ⇒ in_progress");
  chk(table.done === 'done', '①c done ⇒ done');
  chk(table.void === undefined, '①d ★ void ⇒ undefined（不映射进三轴）', `实取 = ${JSON.stringify(table.void)}`);
  chk(table.superseded === undefined, '①e ★ superseded ⇒ undefined', `实取 = ${JSON.stringify(table.superseded)}`);
  chk(progressOf({ state: 'not-a-state' }) === undefined, '①f 认不出的态 ⇒ undefined（JSON 读回的运行期守卫，不猜）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 读端派生（applyOverlay）：派生压过 overlay 的影子；void 不硬塞 ════');
{
  const base = getDSL(FEAT);
  const ov = { version: 1, feature: FEAT, anchors: {}, edges: {}, global: {} };
  const shadow = (id, p, v) => ({ [id]: { path: p, kind: 'file', progress: v } });

  // (a) claimed + overlay 写 draft ⇒ 读 in_progress
  const claimedBase = {
    ...base,
    geometry: { ...base.geometry, nodes: base.geometry.nodes.map((n) => (n.id === A ? { ...n, task: { ...n.task, state: 'claimed' } } : n)) },
  };
  const a1 = applyOverlay(claimedBase, { ...ov, anchors: shadow(A, 'src/a.ts', 'draft') });
  chk(
    a1.geometry.nodes.find((n) => n.id === A)?.status === 'in_progress',
    "②a state=claimed 且 overlay.progress='draft' ⇒ 读到 **in_progress**（派生值优先，影子不得覆盖）",
    `实取 = ${JSON.stringify(a1.geometry.nodes.find((n) => n.id === A)?.status)}`,
  );

  // (b) void + overlay 写 done ⇒ 读 undefined
  const voidBase = {
    ...base,
    geometry: { ...base.geometry, nodes: base.geometry.nodes.map((n) => (n.id === A ? { ...n, task: { ...n.task, state: 'void' } } : n)) },
  };
  const a2 = applyOverlay(voidBase, { ...ov, anchors: shadow(A, 'src/a.ts', 'done') });
  chk(
    a2.geometry.nodes.find((n) => n.id === A)?.status === undefined,
    "②b state=void 且 overlay.progress='done' ⇒ 读到 **undefined**（不硬塞、不回落 overlay）",
    `实取 = ${JSON.stringify(a2.geometry.nodes.find((n) => n.id === A)?.status)}`,
  );
  chk(
    !('status' in a2.geometry.nodes.find((n) => n.id === A)),
    '②b′ 且该键被**删掉**（不是留一个 undefined 值）',
  );

  // (c) 无 task 的节点仍回落 overlay（防回归）
  const a3 = applyOverlay(base, { ...ov, anchors: shadow(B, 'src/b.ts', 'in_progress') });
  chk(
    a3.geometry.nodes.find((n) => n.id === B)?.status === 'in_progress',
    '②c 无 task 的节点仍按 overlay.progress 投影（既有行为未回归）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 闸：两个对照（无 task ⇒ 拒 / 有 claimed ⇒ 放行）＋ 能自己坏的对照 ════');
{
  const before = gate('src/a.ts');
  chk(before.ok === false, '③a ★ 无 task（A 还是 candidate / 无 claimed）⇒ **落盘被拒**', `拒因首行 = ${String(before.msg).split('\n')[0]}`);
  chk(/任务卡|claim/.test(String(before.msg)), '③a′ 拒因里点名"任务卡 / claim"（不是旧文案"progress 登记"）');

  const noCard = gate('src/b.ts');
  chk(noCard.ok === false, '③b 节点 B **根本没有任务格** ⇒ 拒');

  // ★★ 能自己坏：给 B 播种一份 progress（旧判据会因此放行）⇒ 新判据必须**仍拒**
  const ov = loadOverlay(FEAT) ?? { version: 1, feature: FEAT, anchors: {}, edges: {}, global: {} };
  saveOverlay({ ...ov, anchors: { ...ov.anchors, [D]: { path: 'src/b.ts', kind: 'file', progress: 'done' } } });
  const seeded = gate('src/b.ts');
  chk(
    seeded.ok === false,
    "③c ★★ **能自己坏**：B 的 overlay 已播种 progress='done'（旧判据会放行）⇒ 新判据**仍拒**",
    `拒因首行 = ${String(seeded.msg).split('\n')[0]}`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ 走工具层：edit_dsl {type:task}（claim / complete / release）════');
{
  // (a) 无卡可领 ⇒ 拒且点名"不造卡"
  const noCard = await edit([{ type: 'task', op: 'claim', id: B, data: { owner: 'agent-t349' } }], 'T349：给无任务格的节点 claim（应被拒，证明不造卡）');
  const noCardText = String(noCard.text ?? '');
  chk(noCard.isError === true || /没有任务格/.test(noCardText), '④a 无任务格 ⇒ claim 被拒', noCardText.split('\n').slice(-1)[0]);
  // ★ 2026-10-17（T12）：文案按新契约改了 —— 立卡现在**有**写端（`publish`，从决策卡翻），
  //   所以「不造卡」这句话的**落点**从"归 board 手抄"改成"走 publish、且 publish 不替你凭空造卡"。
  //   ⇒ 断言跟着改成新语义（★ 不是放宽：仍要求它点名 publish 并且明说不凭空造卡）。
  chk(
    /不替你凭空造/.test(noCardText) && /publish/.test(noCardText),
    '④a′ 拒因写明"不凭空造卡"且指向 publish（立卡有了写端之后的新契约）',
  );

  // (b) claim A（真路径）
  const r = await edit([{ type: 'task', op: 'claim', id: A, data: { owner: 'agent-t349' } }], 'T349：领取任务 file_src_a_ts（owner=agent-t349）');
  chk(r.isError !== true, '④b claim 经 edit_dsl 成功', String(r.text ?? '').split('\n')[1] ?? '');
  const a = nodeOf(A);
  // ★ 2026-10-21（A7 身份规范化）：`task.owner` 的**新写入**过 `domain/actor_spec.ts#admitActor`
  //   （三分 human/agent/subagent；“归一化**只补前缀**，不猜别的”且**必须留痕**）
  //   ⇒ 无前缀的 `agent-t349` 落盘为 `agent:agent-t349`（claim 回执会明说“已归一化自 agent-t349”）。
  //   ★ 过时的是**这条断言**，不是代码：归一化是对的（同一文件里 `sameActor` 让老值继续可用）。
  chk(a.task.state === 'claimed' && a.task.owner === 'agent:agent-t349' && !!a.task.claimed_at, '④b′ 读回：state=claimed · owner=agent:agent-t349（归一化后的规范格式）· claimed_at 非空', JSON.stringify({ state: a.task.state, owner: a.task.owner, claimed_at: a.task.claimed_at }));
  chk(a.status === 'in_progress', "④b″ 端到端投影：node.status='in_progress'（claimed 的派生值已落成读结果）", `实取 = ${JSON.stringify(a.status)}`);

  // (c) 闸放行（claimed）
  const after = gate('src/a.ts');
  chk(after.ok === true, '④c ★ 有 claimed task ⇒ **放行**', String(after.note));

  // (d) 旧写端改不动派生进度（同一事实只有一处权威）
  updateStatus({ feature: FEAT, node_id: A, status: 'draft' });
  const a2 = nodeOf(A);
  chk(
    a2.task.state === 'claimed' && a2.status === 'in_progress',
    "④d ★ 旧写端 updateStatus(status='draft') 之后：task.state 仍是 claimed、读到的 status 仍是 in_progress（派生压过旧轴）",
    JSON.stringify({ state: a2.task.state, status: a2.status }),
  );

  // ★ 2026-10-17（T13）：收口判据已换成 `isSatisfied`（只有 satisfied 可收口）⇒
  //   先把 A 的判据摆成"已满足"（模拟活干完了），④e/f 才测得的是**证据闸与收口**，不是"还有活"。
  markSatisfied(A, 'src/a.ts');

  // (e) complete 无证据 ⇒ 被 OP_SPECS 拒
  const noEv = await edit([{ type: 'task', op: 'complete', id: A, data: {} }], 'T349：完成任务但不给证据（应被拒）');
  chk(/evidence/.test(String(noEv.text ?? '')), '④e complete 不带 data.evidence ⇒ 被拒且点名 evidence（证据闸在形状层就挡住）');

  // (f) complete 带证据 ⇒ done
  const done = await edit(
    [{ type: 'task', op: 'complete', id: A, data: { evidence: { kind: 'attestation', by: 'human', at: new Date().toISOString(), why: 'T349 夹具：人工确认' } } }],
    'T349：完成任务 file_src_a_ts（证据 attestation）',
  );
  chk(done.isError !== true, '④f complete（带 evidence）成功', String(done.text ?? '').split('\n')[1] ?? '');
  const a3 = nodeOf(A);
  chk(a3.task.state === 'done' && a3.status === 'done', '④f′ 读回：state=done · status=done');
  chk((a3.task.evidence ?? []).some((e) => e.verdict === 'pass' && e.kind === 'attestation'), '④f″ 证据记录落格（只落 {kind,at,by,verdict}，不落读数）', JSON.stringify(a3.task.evidence));
  chk(loadOverlay(FEAT)?.anchors?.[A]?.progress === 'done', '④f‴ 交接期影子仍在：overlay.progress=done（第 ④ 步退役另上榜单）');

  // (g) claim → release（C）
  const cc = await edit([{ type: 'task', op: 'claim', id: C, data: { owner: 'agent-t349' } }], 'T349：领取 file_src_c_ts（为 release 路径准备）');
  chk(cc.isError !== true, '④g claim C 成功');
  const rel = await edit([{ type: 'task', op: 'release', id: C, data: { reason: 'T349 夹具：演示显式释放' } }], 'T349：释放 file_src_c_ts（显式 release 事件）');
  chk(rel.isError !== true, '④h release C 成功', String(rel.text ?? '').split('\n')[1] ?? '');
  const c = nodeOf(C);
  // ★★★ 2026-10-22（链 C · 身份归一化）：`released_by` 现在与 claim 的 `owner` **同一套规范**
  //   （`domain/actor_spec.ts#admitActor`：老格式 `agent-t349` ⇒ `agent:agent-t349`，回执里明说「已归一化」）。
  //   ★ 前一版断言的是**归一化上线前**的落盘值 `released_by === 'agent-t349'` —— 它当时是绿的，
  //     绿的原因恰恰是「release 这条写路没走归一化」（本笔要补的洞）⇒ 该值已不成立。
  chk(
    c.task.state === 'candidate' && !c.task.owner && c.task.released_by === 'agent:agent-t349' && !!c.task.released_at,
    '④h′ 读回：state=candidate · owner 清空 · released_by=agent:agent-t349（规范化后的新写入）· released_at 有值（t_release 要 by + reason）',
    JSON.stringify({ state: c.task.state, owner: c.task.owner, by: c.task.released_by, at: c.task.released_at }),
  );
  // ★★★ 判据（不硬断言「必须带前缀」）：`sameActor` 允许历史老值（`workbuddy` 等）继续等价可用，
  //   所以「任意 by 字段」只断言它**能被同一套文法解释**（规范值或等价老值）—— 老数据一个字不动；
  //   而【新写入的】必须是规范格式（下面两条）。
  chk(
    isCanonicalActor(c.task.released_by) || isLegacyActorName(c.task.released_by),
    '④h‴ released_by 形如 human:/agent:/subagent: 或等价老值（同一套文法可解释；不硬断言必须带前缀）',
    `实取 = ${JSON.stringify(c.task.released_by)}`,
  );
  chk(
    isCanonicalActor(a.task.owner) && isCanonicalActor(c.task.released_by),
    '④h⁗ ★ 新写入的 owner / released_by **都是规范格式**（claim 与 release 同格式；老数据不追改）',
    JSON.stringify({ claim_owner: a.task.owner, release_by: c.task.released_by }),
  );
  chk(
    sameActor(a.task.owner, c.task.released_by),
    '④h⁵ 两处署名按 `sameActor` 判定为**同一个人**（同一批身份、同一套文法）',
    `sameActor(${JSON.stringify(a.task.owner)}, ${JSON.stringify(c.task.released_by)})`,
  );
  // ★ 「任意 by 字段」的总判据（即卡上所有「谁」）：能被同一套文法解释（规范值 **或** 等价老值）。
  //   ★ 不写成「必须带前缀」：`sameActor` 允许 `workbuddy` 等 12 种历史老值继续可用 —— 老数据一个字不动。
  const byFieldsOf = (t) =>
    [t.owner, t.released_by, t.retired_by, ...(t.evidence ?? []).map((e) => e.agent)].filter((v) => v != null);
  const allBy = [...byFieldsOf(a.task), ...byFieldsOf(c.task)];
  chk(
    allBy.length > 0 && allBy.every((v) => isCanonicalActor(v) || isLegacyActorName(v)),
    '④h⁶ 任意 by 字段（owner / released_by / retired_by / evidence[].agent）形如 human:/agent:/subagent: 或等价老值',
    JSON.stringify(allBy),
  );
  chk(c.status === 'draft', "④h″ 派生：candidate ⇒ status='draft'");

  // (i) release 之后的节点 ⇒ 闸再拒（"claimed 才放行"不是"有过卡就放行"）
  const g2 = gate('src/c.ts');
  chk(g2.ok === false, '④i 已 release（candidate）⇒ 闸再次拒（判的是 **当前 claimed**，不是"曾领过"）', String(g2.msg).split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ 单一写端（源码辅助判据）：node.task 的赋值只在 task_ops.ts ════');
{
  const gateSrc = fs.readFileSync(path.join(REPO, 'src/application/write_gate.ts'), 'utf8');
  chk(/task\.state/.test(gateSrc) && /claimed/.test(gateSrc), '⑤a 闸读的是 task.state === claimed（不是 progress 非空）');
  const statusSrc = fs.readFileSync(path.join(REPO, 'src/application/design/dsl_ops/status_tools.ts'), 'utf8');
  chk(!/\btask\s*:/.test(statusSrc) && !/\.task\s*=/.test(statusSrc), '⑤b status_tools.ts（旧写端）里**没有**对 node.task 的赋值');
  const opsSrc = fs.readFileSync(path.join(REPO, 'src/application/design/dsl_ops/task_ops.ts'), 'utf8');
  chk(
    !/\btask\s*=(?!=)/.test(opsSrc) && /\{\s*\.\.\.n,\s*task:/.test(opsSrc),
    '⑤c task_ops.ts 用**对象重建**写 node.task（`{...n, task}`；没有原地赋值 ⇒ 写点可辨、只有这一处）',
  );
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F > 0 ? 1 : 0);
