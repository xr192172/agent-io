#!/usr/bin/env node
/**
 * ★★★ cert T360 —— **两段式领取**（`preparing` 第 5 态 + `prepared_snapshot` 事务）
 *
 * ## 它在问什么
 * 用户 2026-10-22 的 RFC：*「在接取任务的时候不能直接接，而是要先把判据补全……
 * 先是领了任务但是还不能开始，而是要先去把设计 DB 完善好，才能正式开始这个任务。」*
 * 以及 2026-10-23 的裁定：**不要「草稿判据」**（那会让判据住两个家），
 * *「你如果因为选择了这个导致难度增大的话，那你还不如搞成事务呢，反正也就是一个快照的事情」*。
 *
 * ## 判据（卡原文 A-D，逐条用运行时读数钉住）
 * * **A 没判据不许 claim**：判据空的卡 `claim` ⇒ **preparing**（不是 claimed），且回执**点名**缺什么；
 * * **B 两段式原子**：`start` 中途失败 ⇒ state 仍 `preparing`、快照仍在（同一个字节）；
 *   成功 ⇒ 删快照与改态在**同一次落盘**里（不存在"claimed 但快照还在"）；
 * * **C 放弃零残留**：`preparing` 中 `release` ⇒ `decision.expectations` 与 claim 前**逐字相同**、state 回 candidate；
 *   `expire`（超时）走**同一个还原函数**，读数一致；
 * * **D 反馈可读**：回执首行说清「给哪个 node、补几条、哪几类」，且 `data.missing.templates` 可直接粘。
 * * **⑥ 不是所有任务都两段式**：判据已存在的卡**一段式** claim；存量卡（无 `judge_gate`）**留痕不拦**。
 *
 * ## ★ 本证怎么被打红（自己坏，见每条后面的「消融」）
 * · claim 里把 `state: 'preparing'` 改回 `'claimed'` ⇒ **A1/A2** 红；
 * · `startTask` 里把 `prepared_snapshot: null` 删掉 ⇒ **B3** 红（claimed 却带着快照）；
 * · `startTask` 的判据检查改成 `post.length >= 0`（永真）⇒ **B1/B2** 红；
 * · `releaseTask` 里改成 `writeTask`（不还原）⇒ **C1/C2** 红；
 * · `criteriaGap` 的 `need` 写死 0 / 去掉 templates ⇒ **D2/D3** 红；
 * · claim 的 `twoPhase` 去掉 `judge_gate` 条件 ⇒ **⑥2**（存量卡）会变成 preparing ⇒ 红。
 *
 * ## 边界（诚实清单）
 * · 只写真仓之外的临时 home（`AGENT_IO_HOME`），**不碰** `.agent-io/` 真册；
 * · 判据 `file-exists` 现读真仓（**只读**）；
 * · **不证明**"preparing 没有写权"这件事本身 —— 那由 `write_gate` 的 `state==='claimed'` 判据决定
 *   （本证只证明 preparing 与 claimed 是**两个格**，`task_machine.ts` 的 `LEASE_STATES` / `isClaimable` 各自读它）；
 * · **不证明** `git`/`verify` 的接线（那是 `scripts/verify.mjs` 的事；本证要挂进门才算接线）。
 *
 * ## 用法
 *   node certs/t360-two-phase-claim-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
fs.mkdirSync(path.join(HERE, '.work'), { recursive: true });
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp360-'));
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
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { TASK_STATES } = await import('../dist/src/domain/task_schema.js');
const { expectationsOf } = await import('../dist/src/domain/task_schema.js');

const FEAT = 't360';
const OWNER = 'agent-t360';
const ABSENT = 'src/domain/t360_fixture_absent.ts'; // 盘上不存在 ⇒ file-exists 必红 ⇒ L2 站位 work（可领）
const PRESENT = 'src/domain/task_machine.ts';

const N_EMPTY = 'node_empty_criteria'; // A/B：strict + 判据空
const N_EMPTY_ABANDON = 'node_empty_abandon'; // C：放弃
const N_EMPTY_TIMEOUT = 'node_empty_timeout'; // C'：超时
const N_HAS_POST = 'node_has_post'; // ⑥：已存在判据 ⇒ 一段式
const N_LEGACY = 'node_legacy_empty'; // ⑥：存量卡（无 judge_gate）

const emptyDecision = (id, summary) => ({ summary, expectations: [] });

saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: REPO,
  geometry: {
    layout: 'free',
    width: 400,
    height: 300,
    nodes: [
      { id: N_EMPTY, type: 'file', label: '判据空（strict）', description: 'src/domain/t360_empty.ts', decision: emptyDecision(N_EMPTY, 'T360 夹具：判据空') },
      { id: N_EMPTY_ABANDON, type: 'file', label: '判据空（放弃）', description: 'src/domain/t360_abandon.ts', decision: emptyDecision(N_EMPTY_ABANDON, 'T360 夹具：放弃') },
      { id: N_EMPTY_TIMEOUT, type: 'file', label: '判据空（超时）', description: 'src/domain/t360_timeout.ts', decision: emptyDecision(N_EMPTY_TIMEOUT, 'T360 夹具：超时') },
      {
        id: N_HAS_POST,
        type: 'file',
        label: '判据已在',
        description: 'src/domain/t360_has_post.ts',
        decision: {
          summary: 'T360 夹具：判据已在（后态必红 ⇒ work）',
          expectations: [{ kind: 'file-exists', path: ABSENT, why: 'T360 夹具：该文件不存在 ⇒ 后态红 ⇒ work' }],
        },
      },
      { id: N_LEGACY, type: 'file', label: '存量卡（无 judge_gate）', description: 'src/domain/t360_legacy.ts', decision: emptyDecision(N_LEGACY, 'T360 夹具：存量卡') },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: N_EMPTY, path: 'src/domain/t360_empty.ts', responsibility: 'T360 夹具：判据空' },
      { id: N_EMPTY_ABANDON, path: 'src/domain/t360_abandon.ts', responsibility: 'T360 夹具：放弃' },
      { id: N_EMPTY_TIMEOUT, path: 'src/domain/t360_timeout.ts', responsibility: 'T360 夹具：超时' },
      { id: N_HAS_POST, path: 'src/domain/t360_has_post.ts', responsibility: 'T360 夹具：判据已在' },
      { id: N_LEGACY, path: 'src/domain/t360_legacy.ts', responsibility: 'T360 夹具：存量卡' },
    ],
  },
});

const run = async (ops, reason) => {
  const r = await editDslHandler({ feature: FEAT, weight: 'routine', agent: OWNER, reason, operations: ops });
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};
/**
 * ★ `edit_dsl` 的批量回执**只印每个 op 的 `message` 首行** ⇒ 所有断言必须打在那一行上。
 * （这条本身是今天踩出来的：我把"缺什么"写进 message 第 2 行 ⇒ 回执里**根本看不到**。）
 */
const first = (s) => {
  const opLine = s.split('\n').find((l) => /^\s*\[\d+\/\d+\]/.test(l));
  if (opLine) return opLine.replace(/^\s*\[\d+\/\d+\]\s*/, '');
  return s.split('\n').find((l) => l.trim()) ?? '';
};
const nodeOf = (id) => (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === id);
const cardOf = (id) => nodeOf(id)?.task;
const expsOf = (id) => JSON.stringify(expectationsOf(nodeOf(id)));

console.log('\n════ T360 两段式领取（preparing + prepared_snapshot） ════\n');

// ── 准备：publish 立卡（★ publish 是判据门的盖章处）──────────────────
for (const id of [N_EMPTY, N_EMPTY_ABANDON, N_EMPTY_TIMEOUT, N_HAS_POST, N_LEGACY]) {
  await run([{ type: 'task', op: 'publish', id }], `T360 夹具：为 ${id} 立卡`);
}
chk(cardOf(N_EMPTY)?.judge_gate === 'strict', '0) publish 给新卡盖 judge_gate=strict（判据门只在"新立的卡"上生效）');
chk(cardOf(N_EMPTY)?.state === 'candidate', '0b) 立出来的卡是 candidate');

// ★ 存量卡：判据门上线**之前**立的卡 —— 没有 judge_gate（模拟迁移期的 137 张）
{
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n) => (n.id === N_LEGACY ? { ...n, task: { ...n.task, judge_gate: undefined } } : n));
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
}
chk(cardOf(N_LEGACY)?.judge_gate === undefined, '0c) 存量卡夹具：已去掉 judge_gate（= 迁移期那 137 张的形态）');

// ── A：没判据不许 claim ────────────────────────────────────────
const aRes = await run([{ type: 'task', op: 'claim', id: N_EMPTY, data: { owner: OWNER } }], 'T360 A：claim 判据空的卡');
const aCard = cardOf(N_EMPTY);
chk(!aRes.isError, 'A0) claim 本身没抛错（它是"进 preparing"，不是"失败"）', first(aRes.text));
chk(aCard?.state === 'preparing', 'A1) ★ state = preparing（**不是** claimed —— 没判据不许开工）', `state=${aCard?.state}`);
// ★ owner 按身份规范归一化（`agent-t360` ⇒ `agent:agent-t360`）—— 断言只看**名字那一段**
chk(String(aCard?.owner ?? '').endsWith('agent-t360'), 'A2) owner 记上了（preparing 也持租约；身份按规范归一化成 `<kind>:<name>`）', `owner=${aCard?.owner}`);
chk(aCard?.prepared_snapshot?.expectations?.length === 0, 'A3) 快照已落（改之前 0 条判据的逐字副本）');

// ── D：反馈可读（首行 + data.missing）────────────────────────────
const aFirst = first(aRes.text);
chk(/preparing/.test(aFirst) && aFirst.includes(N_EMPTY), 'D1) 首行点名了 state 与**哪个 node**', aFirst);
chk(/补 \*\*2 条\*\*/.test(aFirst), 'D2) 首行说清**补几条**（2 条）', aFirst);
chk(/signature-matches|file-exists/.test(aFirst) && /source-has/.test(aFirst), 'D3) 首行说清**哪几类**判据', aFirst);
chk(/start/.test(aFirst), 'D4) 首行给出下一步（start）');

// ── B：两段式原子 ───────────────────────────────────────────────
const snapBefore = JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot);
const bFail = await run([{ type: 'task', op: 'start', id: N_EMPTY, data: { owner: OWNER } }], 'T360 B：判据还空就 start');
chk(bFail.isError, 'B1) ★ 判据空时 start **被拒**（不是静默成功）', first(bFail.text));
chk(cardOf(N_EMPTY)?.state === 'preparing', 'B2) start 失败后 state **仍是** preparing（没有半生效）');
chk(JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot) === snapBefore, 'B3) start 失败后快照**逐字未变**（还原依据还在）');

// 补判据（准备期照常改 decision —— 不走卡、不走草稿字段）
await run(
  [
    {
      type: 'decision',
      op: 'update',
      id: N_EMPTY,
      data: {
        summary: 'T360 夹具：补上一条后态判据',
        expectations: [{ kind: 'file-exists', path: ABSENT, why: 'T360：后态判据（该文件尚未创建 ⇒ 红 ⇒ 有活）' }],
      },
    },
  ],
  'T360 B：prepare 期间补判据',
);
chk(expectationsOf(nodeOf(N_EMPTY)).length === 1, 'B4) prepare 期间判据写进了 decision（唯一住处，不是卡上的草稿字段）');

const bOk = await run([{ type: 'task', op: 'start', id: N_EMPTY, data: { owner: OWNER } }], 'T360 B：判据补齐后 start');
chk(!bOk.isError, 'B5) ★ 判据补齐后 start 成功', first(bOk.text));
chk(cardOf(N_EMPTY)?.state === 'claimed', 'B6) state = claimed（第二段完成）');
chk(cardOf(N_EMPTY)?.prepared_snapshot === null, 'B7) ★ 快照已删（与改态**同一次落盘**：不存在"claimed 但快照还在"）', `snapshot=${JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot)}`);

// ── C：放弃零残留 ───────────────────────────────────────────────
const beforeC = expsOf(N_EMPTY_ABANDON);
await run([{ type: 'task', op: 'claim', id: N_EMPTY_ABANDON, data: { owner: OWNER } }], 'T360 C：领判据空的卡');
chk(cardOf(N_EMPTY_ABANDON)?.state === 'preparing', 'C0) 进入 preparing');
// 准备期乱改判据（模拟"补了一半又发现不该这么做"）
await run(
  [
    {
      type: 'decision',
      op: 'update',
      id: N_EMPTY_ABANDON,
      data: {
        summary: 'T360 夹具：放弃前乱写的一条判据',
        expectations: [
          { kind: 'file-exists', path: ABSENT, why: 'T360：这条是"准备到一半"的残留' },
          { kind: 'source-has', path: PRESENT, must: ['T360 不该留下这个'], why: 'T360：残留 2' },
        ],
      },
    },
  ],
  'T360 C：准备期改判据',
);
chk(expectationsOf(nodeOf(N_EMPTY_ABANDON)).length === 2, 'C1) 准备期判据**真的**被改了（不是草稿 —— 所以必须有回滚）');

const cRes = await run([{ type: 'task', op: 'release', id: N_EMPTY_ABANDON, data: { reason: 'T360：放弃这次准备' } }], 'T360 C：放弃');
chk(!cRes.isError, 'C2) release 成功', first(cRes.text));
chk(expsOf(N_EMPTY_ABANDON) === beforeC, 'C3) ★★ 判据与 claim 前**逐字相同**（零残留）', `before=${beforeC}\n     after =${expsOf(N_EMPTY_ABANDON)}`);
chk(cardOf(N_EMPTY_ABANDON)?.state === 'candidate', 'C4) state 回 candidate');
chk(cardOf(N_EMPTY_ABANDON)?.prepared_snapshot === null, 'C5) 快照已删（用掉了就不是历史）');

// ── C'：超时（expire）走**同一个还原函数** ────────────────────────
await run([{ type: 'task', op: 'claim', id: N_EMPTY_TIMEOUT, data: { owner: OWNER } }], 'T360 C\'：领判据空的卡');
await run(
  [
    {
      type: 'decision',
      op: 'update',
      id: N_EMPTY_TIMEOUT,
      data: { summary: 'T360 夹具：超时前乱写', expectations: [{ kind: 'file-exists', path: ABSENT, why: 'T360：超时残留' }] },
    },
  ],
  'T360 C\'：准备期改判据',
);
{
  // 把 claimed_at 拨回 3h 前 ⇒ 让它"真的过期"（TTL=2h）
  const dsl = getDSL(FEAT);
  const old = new Date(Date.now() - 3 * 3600_000).toISOString();
  const nodes = dsl.geometry.nodes.map((n) =>
    n.id === N_EMPTY_TIMEOUT ? { ...n, task: { ...n.task, claimed_at: old } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } });
}
const beforeTimeout = JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT)));
const expRes = await run([{ type: 'task', op: 'expire' }], 'T360 C\'：超时回收');
chk(/preparing/.test(expRes.text) || /判据已按快照还原/.test(expRes.text), 'C6) expire 把 preparing 也收（它持租约）', first(expRes.text));
chk(cardOf(N_EMPTY_TIMEOUT)?.state === 'candidate', 'C7) 超时后 state 回 candidate');
chk(
  JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT))).length > 0 && !/T360：超时残留/.test(JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT)))),
  'C8) ★ 超时也**按快照还原**（与 release 同一个函数：残留被抹掉、旧内容回来）',
  `before=${beforeTimeout}\n     after =${JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT)))}`,
);

// ── ⑥：不是所有任务都两段式 ─────────────────────────────────────
const hasPost = await run([{ type: 'task', op: 'claim', id: N_HAS_POST, data: { owner: OWNER } }], 'T360 ⑥：领"判据已在"的卡');
chk(!hasPost.isError, 'E1) 判据已存在的卡 claim 成功', first(hasPost.text));
chk(cardOf(N_HAS_POST)?.state === 'claimed', 'E2) ★ 它**直接** claimed（没有走 preparing —— 不是所有任务都两段式）');
chk(cardOf(N_HAS_POST)?.prepared_snapshot === undefined || cardOf(N_HAS_POST)?.prepared_snapshot === null, 'E3) 也没留快照（没准备过就没有回滚依据）');

const legacy = await run([{ type: 'task', op: 'claim', id: N_LEGACY, data: { owner: OWNER } }], 'T360 ⑥：领存量卡（判据空、无 judge_gate）');
chk(!legacy.isError, 'E4) ★ 存量卡（判据空）**仍可领**（迁移期不拦 —— 否则 137 张会同时不可领）', first(legacy.text));
chk(cardOf(N_LEGACY)?.state === 'claimed', 'E5) 它是 claimed（一段式，不进 preparing）');
chk(!!cardOf(N_LEGACY)?.claimed_without_judge, 'E6) ★ 留痕 claimed_without_judge（不静默放行）', JSON.stringify(cardOf(N_LEGACY)?.claimed_without_judge ?? null));
chk(/警告/.test(legacy.text), 'E7) 回执里**响亮警告**（不是悄悄放过）');

// ── 静态对拍：5 态与设计册同步（判据住两处就要能查） ─────────────
chk(TASK_STATES.length === 5 && TASK_STATES.includes('preparing'), 'F1) TASK_STATES 是 5 态且含 preparing', TASK_STATES.join(','));

console.log(`\n═══ T360 读数：PASS=${P} FAIL=${F} ═══`);
process.exit(F === 0 ? 0 : 1);
