#!/usr/bin/env node
/**
 * ★★★ cert T351 —— **`cardStanding` 五值 + 两处判据分家**（2026-10-17 · T13 ·
 * `docs/_extract/task-system-discussion-2.md` §5.1 `P30` 一族）。
 *
 * ## 本笔新增的**方向**（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ① 新读数 `cardStanding ∈ {work, violated, blocked, satisfied, unknowable}`（一个读数，取代四处零散判断）；
 *   ② 新谓词 `isClaimable`（claim 侧）与 `isSatisfied`（complete 侧）—— **同一个节点、两个判据**；
 *   ③ `canClaim` **已删除**（`grep -c canClaim src/ = 0`）⇒ 不许再"一处判据两用"。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **五值各有夹具**：work / violated / blocked / satisfied / unknowable 各得一个读数；
 *   ② **两处调用已分开**（工具层 `edit_dsl`，**同一个节点**）：
 *      `satisfied` 卡 ⇒ **claim 拒**、**complete 放**；`violated` 卡 ⇒ **claim 放**、**complete 拒**；
 *   ③ **`isSatisfied` 可独立调用**（不经 `cardStanding` 的调用方、不写盘）；
 *   ④ ★ **`edge-absent` 不参与满足度**：同一批后态判据，只换前态（pass ⇄ fail）⇒
 *      `satisfaction` 四个计数**逐字不变**，变的只有违约轴；
 *   ⑤ **`blocked` 的拒因点名依赖节点 id**（不是一句"被阻塞"）；
 *   ⑥ **`unknowable` 不吞红**：`redSeen` 如实带出（讨论 2 的 R2）。
 *
 * ## ★★ "自己坏"的对照（B.1；证必须能被自己的反面打红）
 *   ⑦ 用**收归前 `canClaim` 的语义**（"后态全过 ⇒ 可领"）重算同一批夹具：
 *      它在 `satisfied` 卡上说 **可领**，而 `isClaimable('satisfied')` 说 **不可** ⇒
 *      若有人把 claim 侧退回旧判据，②的"satisfied ⇒ claim 拒"**当场变红**（本证不是恒真）。
 *      同理，旧语义在 `violated` 卡上说 **可收口**，而 `isSatisfied` 说 **不可** ⇒ ③的同族。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` 指向临时 home，代码根是临时根（索引现刷 `syncFile`）；
 *   · **MCP 传输层 [未核]**：直接 import `editDslHandler`，不经 server 的 `tools/list`；
 *   · **`blocked` 的"依赖已 done ⇒ 转 work" [未核]**：本证只证"未 done ⇒ blocked + 点名 dep"；
 *   · **`touches` 求交（P26）[未核]**：`work` 卡开工后仍可能撞别人的闸，本证不涉。
 *
 * ## 用法
 *   node certs/t351-card-standing-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 夹具用 `mkdtempSync`（每次新目录、**不删**旧目录）：宿主有"每回合 50 次删除"的闸
//   （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），`rmSync` 会让本证在批量跑里崩成假红
//   （`docs/frictions.jsonl` 里 T11 已记该条）。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp351-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ── 夹具代码根（★ 自成一体：判据要读的三种事实都在这）──
fs.writeFileSync(path.join(ROOT, 'src/ok.ts'), 'export const ok = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/b.ts'), 'export const b = 2;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), "import { b } from './b.js';\nexport const a = b;\n", 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/fixture.weird'), 'package fixture\n\nfunc Keep() {}\n', 'utf-8');

const { cardStanding: standingRaw, isClaimable, isSatisfied: satisfiedRaw } = await import('../dist/src/domain/task_machine.js');
/**
 * ★ 2026-10-22（task.expectations 去副本）：判据不再住卡（TaskSpec 无该字段）⇒ 夹具把它挂在 `criteria` 上，
 *   由这两行适配器作为**第二个参数**送给领域函数（卡上不再有 expectations）。
 */
const cardStanding = (c, opts) => standingRaw(c, c.criteria ?? [], opts);
const isSatisfied = (c, opts) => satisfiedRaw(c, c.criteria ?? [], opts);
// ★ 2026-10-21（D-judge-port）：判定器改成**注入**（`StandingInput.judge` 必填）—— 这里注入的就是生产那个
//   `judgeExpectations`（不是为了夹具另写一个实现；本证验的仍是「五值在主表上的读数」）。
const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');
const { getProjectCacheDb, closeProjectCacheDb } = await import('../dist/src/infrastructure/index/db.js');
const { syncFile } = await import('../dist/src/infrastructure/index/symbols.js');
const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');

// ★ 索引现刷（`edge-absent` 要 fileFacts.deps；不刷 ⇒ 一律 unsupported ⇒ 反例成了空判据）
const db = getProjectCacheDb(ROOT);
for (const rel of ['src/ok.ts', 'src/b.ts', 'src/a.ts']) await syncFile(db, ROOT, path.join(ROOT, rel));
closeProjectCacheDb(ROOT);

// ── 判据常量 ──
const POST_OK = { kind: 'file-exists', path: 'src/ok.ts', why: 'T351 夹具：已存在的后态判据' };
const POST_RED_OWN = { kind: 'file-exists', path: 'src/missing-own.ts', why: 'T351 夹具：本节点自己的洞' };
const POST_RED_FOREIGN = { kind: 'file-exists', path: 'src/dep-target.ts', why: 'T351 夹具：别人节点的洞' };
const PRE_RED = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/b.ts', why: 'T351 夹具：a 不该依赖 b（实际依赖了 ⇒ 违约）' };
const PRE_GREEN = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/c.ts', why: 'T351 夹具：a 不依赖 c（天然成立）' };
const POST_UNSUPPORTED = { kind: 'symbol-exists', path: 'src/fixture.weird', symbol: 'Keep', why: 'T351 夹具：.weird 扩展名不走任何解析器 ⇒ 判不了（★ 别用 .go/.py/.rs：它们在本仓是**支持**的语言，会判成 pass —— 实测踩过）' };

const card = (id, criteria) => ({ id, summary: `T351 ${id}`, criteria, state: 'candidate' });
const NODES = [
  { id: 'node_satisfied', path: 'src/ok.ts' },
  { id: 'node_work', path: 'src/missing-own.ts' },
  { id: 'node_blocked', path: 'src/mine.ts' },
  { id: 'node_dep', path: 'src/dep-target.ts' }, // ★ 没有 task（= 依赖未做）
  { id: 'node_violated', path: 'src/a.ts' },
  { id: 'node_pre_green', path: 'src/a.ts' },
  { id: 'node_unknowable', path: 'src/fixture.weird' },
];
const opts = { root: ROOT, nodes: NODES, judge: judgeExpectations };
const show = (v) =>
  `standing=${v.standing} · satisfaction=${JSON.stringify(v.satisfaction)} · violation=${JSON.stringify(v.violation)} · redSeen=${v.redSeen}`;

// ════════════════════════════════════════════════════════════════════
console.log('════ ① 五值夹具：一个读数，五个格子各一个读数 ════');
{
  const w = await cardStanding(card('node_work', [POST_RED_OWN]), opts);
  chk(w.standing === 'work', '①a work（后态有红、主体是本节点）', show(w));
  chk(isClaimable(w.standing), '①a′ work ⇒ 可领', `isClaimable=${isClaimable(w.standing)}`);

  const v = await cardStanding(card('node_violated', [POST_OK, PRE_RED]), opts);
  chk(v.standing === 'violated', '①b violated（后态全过、前态有红）', show(v));
  chk(isClaimable(v.standing), '①b′ violated ⇒ 可领（去拆非法依赖）', `isClaimable=${isClaimable(v.standing)}`);
  chk(!(await isSatisfied(card('node_violated', [POST_OK, PRE_RED]), opts)).satisfied, '①b″ violated ⇒ **不可收口**');

  const b = await cardStanding(card('node_blocked', [POST_RED_FOREIGN]), opts);
  chk(b.standing === 'blocked', '①c blocked（后态红全落在别人未完成的节点上）', show(b));
  chk(!isClaimable(b.standing), '①c′ blocked ⇒ 拒', `isClaimable=${isClaimable(b.standing)}`);

  const s = await cardStanding(card('node_satisfied', [POST_OK]), opts);
  chk(s.standing === 'satisfied', '①d satisfied（后态全过、无前态）', show(s));
  chk(!isClaimable(s.standing), '①d′ ★ satisfied ⇒ **不可领**（没活干不许领）', `isClaimable=${isClaimable(s.standing)}`);

  const u = await cardStanding(card('node_unknowable', [POST_UNSUPPORTED]), opts);
  chk(u.standing === 'unknowable', '①e unknowable（后态判不了）', show(u));
  chk(!isClaimable(u.standing), '①e′ unknowable ⇒ 拒', `isClaimable=${isClaimable(u.standing)}`);

  console.log(`     五值读数 = ${JSON.stringify([w.standing, v.standing, b.standing, s.standing, u.standing])}`);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ blocked 的拒因点名依赖节点（不是一句"被阻塞"）════');
{
  const b = await cardStanding(card('node_blocked', [POST_RED_FOREIGN]), opts);
  chk(JSON.stringify(b.blockedBy) === JSON.stringify(['node_dep']), `⑤a blockedBy = ${JSON.stringify(b.blockedBy)}`);
  chk(/node_dep/.test(b.reason), '⑤b 拒因里**出现 dep 节点 id**', b.reason);
  chk(b.reason.startsWith('等别人'), '⑤c 拒因的句子与 work/violated **不是同一句**（开头即"等别人"）', b.reason.slice(0, 24));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ edge-absent 不参与满足度（只换前态 ⇒ satisfaction 逐字不变）════');
{
  const green = await cardStanding(card('node_pre_green', [POST_OK, PRE_GREEN]), opts);
  const red = await cardStanding(card('node_violated', [POST_OK, PRE_RED]), opts);
  console.log('     前态绿 =', show(green));
  console.log('     前态红 =', show(red));
  chk(
    JSON.stringify(green.satisfaction) === JSON.stringify(red.satisfaction),
    '④a 两卡的 **satisfaction 四个计数逐字相同**（满足度只由后态得出）',
    `green=${JSON.stringify(green.satisfaction)} red=${JSON.stringify(red.satisfaction)}`,
  );
  chk(green.violation.checked === 1 && green.violation.failed === 0, '④b 前态绿 ⇒ violation.failed=0', JSON.stringify(green.violation));
  chk(red.violation.failed === 1, '④c 前态红 ⇒ violation.failed=1（它有自己的轴，不被算进满足度）', JSON.stringify(red.violation));
  chk(green.standing === 'satisfied' && red.standing === 'violated', '④d 变化的只有**违约轴**（standing: satisfied → violated）');
  chk(green.judged.post.length === 1 && red.judged.post.length === 1, '④e 两卡的判据条数相同（夹具的差别只在前态那一条）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ unknowable 不吞红（R2：判不了 ≠ 没活）════');
{
  const mixed = await cardStanding(card('node_unknowable', [POST_UNSUPPORTED, POST_RED_OWN]), opts);
  chk(mixed.standing === 'unknowable', '⑥a 仍是 unknowable（判不了压过一切）', show(mixed));
  chk(mixed.redSeen === 1, `⑥b redSeen = ${mixed.redSeen}（如实带出"另看到 1 条红"）`, mixed.reason);
  chk(/红/.test(mixed.reason), '⑥c 拒因**写出**了那几条红（不是只说"判不了"）', mixed.reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ isSatisfied 可独立调用（不写盘、不经任何调用方）════');
{
  const s1 = await isSatisfied(card('node_satisfied', [POST_OK]), opts);
  const s2 = await isSatisfied(card('node_work', [POST_RED_OWN]), opts);
  console.log('     满足卡 =', JSON.stringify({ satisfied: s1.satisfied, standing: s1.standing }));
  console.log('     有活卡 =', JSON.stringify({ satisfied: s2.satisfied, standing: s2.standing }));
  chk(s1.satisfied === true && s1.standing === 'satisfied', '③a 满足卡 ⇒ satisfied=true');
  chk(s2.satisfied === false && s2.standing === 'work', '③b 有活卡 ⇒ satisfied=false（work 不可收口）');
  chk(typeof s1.verdict?.satisfaction?.passed === 'number', '③c 独立调用也带回完整读数（satisfaction 可用）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 两处调用已分开（★ 工具层 edit_dsl，同一个节点）════');
const FEAT = 't351';
const N_S = 'node_satisfied';
const N_W = 'node_work';
const N_V = 'node_violated';
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: ROOT, // ★ 判据读这个根（不是真仓）
  geometry: {
    layout: 'free',
    width: 400,
    height: 300,
    nodes: [
      { id: N_S, type: 'file', label: 'satisfied', path: 'src/ok.ts', decision: { summary: 'T351 已满足卡', expectations: [POST_OK] } },
      { id: N_W, type: 'file', label: 'work', path: 'src/missing-own.ts', decision: { summary: 'T351 有活卡', expectations: [POST_RED_OWN] } },
      {
        id: N_V,
        type: 'file',
        label: 'violated',
        path: 'src/a.ts',
        decision: { summary: 'T351 违约卡', expectations: [POST_OK, PRE_RED] },
      },
    ],
    edges: [],
  },
  semantic: { files: [{ id: N_S, path: 'src/ok.ts', responsibility: 'satisfied' }, { id: N_W, path: 'src/missing-own.ts', responsibility: 'work' }, { id: N_V, path: 'src/a.ts', responsibility: 'violated' }] },
});

const nodeOf = (id) => (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === id);
const run = async (ops, reason) => {
  const r = await editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t351', reason, operations: ops });
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};
/** ★ 夹具摆态（不是产品路径）：把卡直接放到 `claimed`，模拟"当初有活、领了、现在活干完了"。 */
const seedClaimed = (id) => {
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n) =>
    n.id === id ? { ...n, task: { id, summary: n.decision.summary, state: 'claimed', owner: 'agent-t351', claimed_at: new Date().toISOString() } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
};
const EVID = { kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: 'T351 夹具：确认可收口' };

{
  // ②a 同一个节点（satisfied）先 publish（翻决策卡 ⇒ candidate），再 claim ⇒ **应拒**
  const p = await run([{ type: 'task', op: 'publish', id: N_S }], `立卡 ${N_S}`);
  chk(!p.isError, '②a(i) publish 成功（卡 = candidate）');
  const c = await run([{ type: 'task', op: 'claim', id: N_S, data: { owner: 'agent-t351' } }], `领取 ${N_S}`);
  console.log('     claim 读数 =', c.text.split('\n')[0]);
  chk(c.isError, '②a ★ satisfied 节点：**claim 拒**（没活干不许领）');
  chk(/satisfied/.test(c.text) && /只可收口/.test(c.text), '②a′ 拒因点名 standing=satisfied 且说"只可收口"', c.text.split('\n')[0]);
  chk(nodeOf(N_S)?.task?.state === 'candidate', '②a″ 拒 = 一个字节都不写（state 仍 candidate）');

  // ②b **同一个节点**（satisfied）已领 ⇒ complete ⇒ **应放**
  seedClaimed(N_S);
  const done = await run([{ type: 'task', op: 'complete', id: N_S, data: { evidence: EVID } }], `收口 ${N_S}`);
  console.log('     complete 读数 =', done.text.split('\n')[0]);
  chk(!done.isError, '②b ★ 同一节点：**complete 放**（satisfied 只可收口）');
  chk(nodeOf(N_S)?.task?.state === 'done', `②b′ 落盘 state=${nodeOf(N_S)?.task?.state}`);

  // ②c 对照：work 卡 claim ⇒ **放**（证明 claim 不是恒拒）
  await run([{ type: 'task', op: 'publish', id: N_W }], `立卡 ${N_W}`);
  const cw = await run([{ type: 'task', op: 'claim', id: N_W, data: { owner: 'agent-t351' } }], `领取 ${N_W}`);
  console.log('     work claim 读数 =', cw.text.split('\n')[0]);
  chk(!cw.isError, '②c work 卡 claim 放（有活干 ⇒ 可领）');
  chk(nodeOf(N_W)?.task?.state === 'claimed', '②c′ state=claimed');

  // ②d violated 卡 claim ⇒ **放**，随后 complete ⇒ **拒**（同一张卡、两个判据各判一次）
  await run([{ type: 'task', op: 'publish', id: N_V }], `立卡 ${N_V}`);
  const cv = await run([{ type: 'task', op: 'claim', id: N_V, data: { owner: 'agent-t351' } }], `领取 ${N_V}`);
  console.log('     violated claim 读数 =', cv.text.split('\n')[0]);
  chk(!cv.isError, '②d ★ violated 卡：claim 放（可领，去拆非法依赖）');
  chk(/violated/.test(cv.text), '②d′ 放行回执点名 standing=violated（不是一句"已领取"）', cv.text.split('\n')[0]);
  const dv = await run([{ type: 'task', op: 'complete', id: N_V, data: { evidence: EVID } }], `收口 ${N_V}`);
  console.log('     violated complete 读数 =', dv.text.split('\n')[0]);
  chk(dv.isError, '②d″ ★ 同一张卡：**complete 拒**（后态全过也不许收口 —— R4 的洞）');
  chk(/violated/.test(dv.text) && /不许收口/.test(dv.text), '②d‴ 拒因点名 violated 且说"不许收口"', dv.text.split('\n')[0]);
  chk(nodeOf(N_V)?.task?.state === 'claimed', '②d⁗ 拒 = 不写（state 仍 claimed）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑦ "自己坏"对照：把判据退回收归前的语义 ⇒ 本证当场变红 ════');
{
  const s = await cardStanding(card('node_satisfied', [POST_OK]), opts);
  const v = await cardStanding(card('node_violated', [POST_OK, PRE_RED]), opts);
  // ★ 收归前 canClaim 的语义：**只看后态全过**（unsupported=0 ∧ failed=0）
  const oldCanClaim = (x) => x.satisfaction.unsupported === 0 && x.satisfaction.failed === 0;
  chk(
    oldCanClaim(s) === true && isClaimable(s.standing) === false,
    '⑦a 旧语义在 satisfied 卡上说"可领"，新谓词说"不可" ⇒ 若 claim 退回旧判据，②a 会红',
    `oldCanClaim=${oldCanClaim(s)} · isClaimable=${isClaimable(s.standing)}`,
  );
  chk(
    oldCanClaim(v) === true && v.standing !== 'satisfied',
    '⑦b 旧语义在 violated 卡上说"可收口"，isSatisfied 说"不可" ⇒ 若 complete 退回旧判据，②d″ 会红',
    `oldCanClaim=${oldCanClaim(v)} · standing=${v.standing}`,
  );
  chk(
    (await isSatisfied(card('node_violated', [POST_OK, PRE_RED]), opts)).satisfied === false,
    '⑦c 新谓词对同一张 violated 卡给 false（上一条不是"两句话都说对了"的空对照）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
