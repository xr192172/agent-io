/**
 * P0 · **两段式领取**（`preparing` 第 5 态 + `prepared_snapshot` 事务）。
 *
 * ★★★ 2026-10-31：本文件从 `certs/t360-two-phase-claim-cert.mjs` **整张迁来**。
 *   它此前是 `npm run verify` 的**第 8 道门**（`scripts/verify.mjs` 的「两段式领取」）。
 *   `certs/` 要整目录删 ⇒ 迁进 `tests/`，由**「测试」门**统一收走（0.9 一处权威）。
 *
 * ## 它挡的事故（从 verify.mjs 那道门的 `why` 搬来，别丢）
 *   · 「领了不能干」退化成「领了就能干」—— 那等于判据永远补不上，回到 117 张判据空的老状态；
 *   · 「事务」退化成「改了不回滚」—— 设计侧残留半套判据，下一个人拿它当验收。
 *   · `tsc` 对这四条一声不响（都是"值"不是"形状"）⇒ 只有行为夹具抓得住。
 *   · 原证（verify 门时期）的消融读数（直接改 `dist` 一行、再从备份还原）：
 *     claim 的 `preparing → claimed` ⇒ **7 条红**；start 不删快照 ⇒ **B7 红**；
 *     release 改成 `writeTask`（不还原）⇒ **C3 红**。
 *
 * ## 卡原文 A-D（本文件逐条用运行时读数钉住）
 *   * **A 没判据不许 claim**：判据空的卡 `claim` ⇒ **preparing**（不是 claimed），且回执**点名**缺什么；
 *   * **B 两段式原子**：`start` 中途失败 ⇒ state 仍 `preparing`、快照仍在（同一个字节）；
 *     成功 ⇒ 删快照与改态在**同一次落盘**里（不存在"claimed 但快照还在"）；
 *   * **C 放弃零残留**：`preparing` 中 `release` ⇒ `decision.expectations` 与 claim 前**逐字相同**、state 回 candidate；
 *     `expire`（超时）走**同一个还原函数**，读数一致；
 *   * **D 反馈可读**：回执首行说清「给哪个 node、补几条、哪几类」，且模板可直接粘；
 *   * **⑥ 不是所有任务都两段式**：判据已存在的卡**一段式** claim；存量卡（无 `judge_gate`）**留痕不拦**。
 *
 * ## 消融（★ 本文件必须能红 —— 2026-10-31 迁移时实测，两次读数都记在这里）
 *   ① **改哪一行**：`src/application/design/dsl_ops/task_ops.ts` 里两段式第一段的 `state: 'preparing',` ⇒ `'claimed',`。
 *      **红读数**：`用例 4/8` —— A1（state=claimed）/ B2（start 失败后不再 preparing）/ C0（不进 preparing）
 *      / C8（超时没按快照还原，残留还留着）· exit 1。
 *   ② **从备份还原**（`git diff` 为空）⇒ **用例 8/8 全绿** · exit 0。
 *   ★ 同 t358：本文件读 `src`（不读 dist）⇒ 消融只能在被断言的**那一处逻辑**上做，不能只改 build 产物。
 *
 * ## 边界（诚实清单）
 *   · 只写**仓外**临时 home（`makeTempHome` + `AGENT_IO_HOME`），**不碰** `.agent-io/` 真册；
 *   · 判据 `file-exists` 指向的是**真仓里一个不存在的路径**（`p0two_fixture_absent.ts`）⇒ claim 时
 *     真判定器**只读**它、判红 ⇒ 卡站位 `work`（可领）；★ 本文件**不写**真仓任何文件；
 *   · **不证明**「preparing 没有写权」本身 —— 那由 `write_gate` 的 `state==='claimed'` 判据决定；
 *     本文件只证明 preparing 与 claimed 是**两个格**；
 *   · **不证明** git/verify 的接线（那是 `scripts/verify.mjs` 的事）。
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { editDslHandler } from '../src/application/design/handlers.js';
import { TASK_STATES, expectationsOf } from '../src/domain/task_schema.js';
import { getDSL, saveDSL } from '../src/infrastructure/storage.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** ★ `source_root` 必须是**真仓根**（只读）：claim 会真跑判定器，而 `file-exists` 要一个能解析的根 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEAT = 'p0two';
const OWNER = 'subagent:p0-two-phase';
const ABSENT = 'src/domain/p0two_fixture_absent.ts'; // 盘上不存在 ⇒ file-exists 必红 ⇒ L2 站位 work（可领）
const PRESENT = 'src/domain/task_machine.ts';

const N_EMPTY = 'node_empty_criteria'; // A/B：strict + 判据空
const N_EMPTY_ABANDON = 'node_empty_abandon'; // C：放弃
const N_EMPTY_TIMEOUT = 'node_empty_timeout'; // C'：超时
const N_HAS_POST = 'node_has_post'; // ⑥：已存在判据 ⇒ 一段式
const N_LEGACY = 'node_legacy_empty'; // ⑥：存量卡（无 judge_gate）

const emptyDecision = (summary: string) => ({ summary, expectations: [] as unknown[] });

/** 全部读盘/写盘都经 `storage` ⇒ 走的是**应用层同一条路**（不是测试自己发明的第二条）。 */
const nodeOf = (id: string): any => (getDSL(FEAT)?.geometry?.nodes ?? []).find((n: any) => n.id === id);
const cardOf = (id: string): any => nodeOf(id)?.task;
const expsOf = (id: string): string => JSON.stringify(expectationsOf(nodeOf(id)));

const run = async (operations: any[], reason: string): Promise<{ text: string; isError: boolean }> => {
  const r: any = await editDslHandler({ feature: FEAT, weight: 'routine', agent: OWNER, reason, operations });
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};

/**
 * ★ `edit_dsl` 的批量回执**只印每个 op 的 `message` 首行** ⇒ 所有断言必须打在那一行上。
 * （这条本身是原证踩出来的：把"缺什么"写进 message 第 2 行 ⇒ 回执里**根本看不到**。）
 * 没有 `[n/m]` 前缀时给**前 6 行**（自洽性闸把"新引入的错误原文"放在后面几行）。
 */
function first(s: string): string {
  const opLine = s.split('\n').find((l) => /^\s*\[\d+\/\d+\]/.test(l));
  if (opLine) return opLine.replace(/^\s*\[\d+\/\d+\]\s*/, '');
  return s.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n     ');
}

let home = '';
/** A 段的回执要在 D 段断言（同一个字节，不重跑一次 claim） */
let aRes: { text: string; isError: boolean };

before(async () => {
  home = makeTempHome();
  process.env.AGENT_IO_HOME = home; // ★ storage 的 getDataHome() 每次调用都读它 ⇒ 运行期隔离
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
        { id: N_EMPTY, type: 'file', label: '判据空（strict）', description: 'src/domain/p0two_empty.ts', decision: emptyDecision('夹具：判据空') },
        { id: N_EMPTY_ABANDON, type: 'file', label: '判据空（放弃）', description: 'src/domain/p0two_abandon.ts', decision: emptyDecision('夹具：放弃') },
        { id: N_EMPTY_TIMEOUT, type: 'file', label: '判据空（超时）', description: 'src/domain/p0two_timeout.ts', decision: emptyDecision('夹具：超时') },
        {
          id: N_HAS_POST,
          type: 'file',
          label: '判据已在',
          description: 'src/domain/p0two_has_post.ts',
          decision: {
            summary: '夹具：判据已在（后态必红 ⇒ work）',
            expectations: [{ kind: 'file-exists', path: ABSENT, why: '夹具：该文件不存在 ⇒ 后态红 ⇒ work' }],
          },
        },
        { id: N_LEGACY, type: 'file', label: '存量卡（无 judge_gate）', description: 'src/domain/p0two_legacy.ts', decision: emptyDecision('夹具：存量卡') },
      ],
      edges: [],
    },
    semantic: {
      files: [
        { id: N_EMPTY, path: 'src/domain/p0two_empty.ts', responsibility: '夹具：判据空' },
        { id: N_EMPTY_ABANDON, path: 'src/domain/p0two_abandon.ts', responsibility: '夹具：放弃' },
        { id: N_EMPTY_TIMEOUT, path: 'src/domain/p0two_timeout.ts', responsibility: '夹具：超时' },
        { id: N_HAS_POST, path: 'src/domain/p0two_has_post.ts', responsibility: '夹具：判据已在' },
        { id: N_LEGACY, path: 'src/domain/p0two_legacy.ts', responsibility: '夹具：存量卡' },
      ],
    },
  } as any);
});

after(() => {
  if (home) rmRf(home);
});

// ── 0：publish 立卡（★ publish 是判据门的盖章处）────────────────────────
test('0 · publish 立卡：判据门只对新卡盖 judge_gate；存量卡夹具 = 迁移期形态', async () => {
  for (const id of [N_EMPTY, N_EMPTY_ABANDON, N_EMPTY_TIMEOUT, N_HAS_POST, N_LEGACY]) {
    await run([{ type: 'task', op: 'publish', id }], `夹具：为 ${id} 立卡`);
  }
  assert.equal(cardOf(N_EMPTY)?.judge_gate, 'strict', '0) publish 给新卡盖 judge_gate=strict（判据门只在"新立的卡"上生效）');
  assert.equal(cardOf(N_EMPTY)?.state, 'candidate', '0b) 立出来的卡是 candidate');

  // ★ 存量卡：判据门上线**之前**立的卡 —— 没有 judge_gate（模拟迁移期那批卡）
  const dsl = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n: any) =>
    n.id === N_LEGACY ? { ...n, task: { ...n.task, judge_gate: undefined } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } } as any);
  assert.equal(cardOf(N_LEGACY)?.judge_gate, undefined, '0c) 存量卡夹具：已去掉 judge_gate（= 迁移期那批卡的形态）');
});

// ── A：没判据不许 claim ────────────────────────────────────────────────
test('A · 判据空 ⇒ claim 只进 preparing（不是 claimed），快照落盘', async () => {
  aRes = await run([{ type: 'task', op: 'claim', id: N_EMPTY, data: { owner: OWNER } }], `A：claim 判据空的 ${N_EMPTY}（src/domain/p0two_empty.ts）`);
  const aCard = cardOf(N_EMPTY);
  assert.equal(aRes.isError, false, `A0) claim 本身没抛错（它是"进 preparing"，不是"失败"）（${first(aRes.text)}）`);
  assert.equal(aCard?.state, 'preparing', `A1) ★ state = preparing（**不是** claimed —— 没判据不许开工）（state=${aCard?.state}）`);
  // ★ owner 按身份规范归一化（`subagent:p0-two-phase` 就是规范形）—— 断言只看**名字那一段**
  assert.ok(String(aCard?.owner ?? '').endsWith('p0-two-phase'),
    `A2) owner 记上了（preparing 也持租约；身份按规范归一化成 <kind>:<name>）（owner=${aCard?.owner}）`);
  assert.equal(aCard?.prepared_snapshot?.expectations?.length, 0, 'A3) 快照已落（改之前 0 条判据的逐字副本）');
});

// ── D：反馈可读（首行 + 点名 node / 条数 / 类别 / 下一步）────────────────
test('D · 反馈可读：首行说清哪个 node、补几条、哪几类、下一步', async () => {
  const aFirst = first(aRes.text);
  assert.ok(/preparing/.test(aFirst) && aFirst.includes(N_EMPTY), `D1) 首行点名了 state 与**哪个 node**（${aFirst}）`);
  assert.match(aFirst, /补 \*\*\d+ 条\*\*/, `D2) 首行说清**补几条**（数字 + 条）（${aFirst}）`);
  // ★ 2026-10-31：补判据模板从**存在类**换成语义类（存在类当画布 `judgement_ref` 会被
  //   `planJudgementGaps` 判「永远发现不了逻辑错」⇒ 第 5 步必被挡）。
  //   ⇒ D3 判的是「说清哪几类 **且** 那几类是语义类」，不钉某个具体 kind、也不钉固定 2 条。
  assert.ok(
    /(run|call-exists|behavior-cases)/.test(aFirst) && !/补[^\n]*(signature-matches|file-exists|symbol-exists)/.test(aFirst),
    `D3) 首行说清**哪几类**判据（且必须是语义类，不许给存在类）（${aFirst}）`,
  );
  assert.match(aFirst, /start/, 'D4) 首行给出下一步（start）');
});

// ── B：两段式原子 ──────────────────────────────────────────────────────
test('B · 两段式原子：判据空 start 被拒 ⇒ 补判据 ⇒ start 成功且同一次落盘删快照', async () => {
  const snapBefore = JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot);
  const bFail = await run([{ type: 'task', op: 'start', id: N_EMPTY, data: { owner: OWNER } }], `B：判据还空就 start ${N_EMPTY}`);
  assert.equal(bFail.isError, true, `B1) ★ 判据空时 start **被拒**（不是静默成功）（${first(bFail.text)}）`);
  assert.equal(cardOf(N_EMPTY)?.state, 'preparing', 'B2) start 失败后 state **仍是** preparing（没有半生效）');
  assert.equal(JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot), snapBefore, 'B3) start 失败后快照**逐字未变**（还原依据还在）');

  // 补判据（准备期照常改 decision —— 不走卡、不走草稿字段）
  await run(
    [
      {
        type: 'decision',
        op: 'update',
        id: N_EMPTY,
        data: {
          summary: '夹具：补上一条后态判据',
          expectations: [{ kind: 'file-exists', path: ABSENT, why: '后态判据（该文件尚未创建 ⇒ 红 ⇒ 有活）' }],
        },
      },
    ],
    `B：prepare 期间为 ${N_EMPTY} 补判据`,
  );
  assert.equal(expectationsOf(nodeOf(N_EMPTY)).length, 1, 'B4) prepare 期间判据写进了 decision（唯一住处，不是卡上的草稿字段）');

  const bOk = await run([{ type: 'task', op: 'start', id: N_EMPTY, data: { owner: OWNER } }], `B：判据补齐后 start ${N_EMPTY}`);
  assert.equal(bOk.isError, false, `B5) ★ 判据补齐后 start 成功（${first(bOk.text)}）`);
  assert.equal(cardOf(N_EMPTY)?.state, 'claimed', 'B6) state = claimed（第二段完成）');
  assert.equal(cardOf(N_EMPTY)?.prepared_snapshot, null,
    `B7) ★ 快照已删（与改态**同一次落盘**：不存在"claimed 但快照还在"）（snapshot=${JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot)}）`);
});

// ── C：放弃零残留 ──────────────────────────────────────────────────────
test('C · 放弃（release）⇒ 判据与 claim 前逐字相同、快照删、回 candidate', async () => {
  const beforeC = expsOf(N_EMPTY_ABANDON);
  await run([{ type: 'task', op: 'claim', id: N_EMPTY_ABANDON, data: { owner: OWNER } }], `C：领判据空的 ${N_EMPTY_ABANDON}`);
  assert.equal(cardOf(N_EMPTY_ABANDON)?.state, 'preparing', 'C0) 进入 preparing');

  // 准备期乱改判据（模拟"补了一半又发现不该这么做"）
  await run(
    [
      {
        type: 'decision',
        op: 'update',
        id: N_EMPTY_ABANDON,
        data: {
          summary: '夹具：放弃前乱写的一条判据',
          expectations: [
            { kind: 'file-exists', path: ABSENT, why: '这条是"准备到一半"的残留' },
            { kind: 'source-has', path: PRESENT, must: ['不该留下这个'], why: '残留 2' },
          ],
        },
      },
    ],
    `C：准备期改 ${N_EMPTY_ABANDON} 的判据`,
  );
  assert.equal(expectationsOf(nodeOf(N_EMPTY_ABANDON)).length, 2, 'C1) 准备期判据**真的**被改了（不是草稿 —— 所以必须有回滚）');

  const cRes = await run([{ type: 'task', op: 'release', id: N_EMPTY_ABANDON, data: { reason: '放弃这次准备' } }], `C：放弃 ${N_EMPTY_ABANDON} 这次准备`);
  assert.equal(cRes.isError, false, `C2) release 成功（${first(cRes.text)}）`);
  assert.equal(expsOf(N_EMPTY_ABANDON), beforeC,
    `C3) ★★ 判据与 claim 前**逐字相同**（零残留）（before=${beforeC} after=${expsOf(N_EMPTY_ABANDON)}）`);
  assert.equal(cardOf(N_EMPTY_ABANDON)?.state, 'candidate', 'C4) state 回 candidate');
  assert.equal(cardOf(N_EMPTY_ABANDON)?.prepared_snapshot, null, 'C5) 快照已删（用掉了就不是历史）');
});

// ── C'：超时（expire）走**同一个还原函数** ──────────────────────────────
test("C' · 超时（expire）也按快照还原 —— 与 release 同一函数、同一口径", async () => {
  await run([{ type: 'task', op: 'claim', id: N_EMPTY_TIMEOUT, data: { owner: OWNER } }], `C'：领判据空的 ${N_EMPTY_TIMEOUT}`);
  await run(
    [
      {
        type: 'decision',
        op: 'update',
        id: N_EMPTY_TIMEOUT,
        data: { summary: '夹具：超时前乱写', expectations: [{ kind: 'file-exists', path: ABSENT, why: '超时残留' }] },
      },
    ],
    `C'：准备期改 ${N_EMPTY_TIMEOUT} 的判据`,
  );
  {
    // 把「最后一次活动」拨回 3h 前 ⇒ 让它"真的过期"（TTL=10 分钟）
    // ★ 年龄基准是 `last_heartbeat_at ?? claimed_at` ⇒ 两个都拨，模拟的才是"这个人 3 小时没动过"。
    const dsl = getDSL(FEAT);
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    const nodes = dsl.geometry.nodes.map((n: any) =>
      n.id === N_EMPTY_TIMEOUT ? { ...n, task: { ...n.task, claimed_at: old, last_heartbeat_at: old } } : n,
    );
    saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } } as any);
  }
  const beforeTimeout = JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT)));
  const expRes = await run([{ type: 'task', op: 'expire' }], `C'：超时回收 ${N_EMPTY_TIMEOUT}`);
  assert.ok(/preparing/.test(expRes.text) || /判据已按快照还原/.test(expRes.text),
    `C6) expire 把 preparing 也收（它持租约）（${first(expRes.text)}）`);
  assert.equal(cardOf(N_EMPTY_TIMEOUT)?.state, 'candidate', 'C7) 超时后 state 回 candidate');
  const after = JSON.stringify(expectationsOf(nodeOf(N_EMPTY_TIMEOUT)));
  assert.ok(after.length > 0 && !/超时残留/.test(after),
    `C8) ★ 超时也**按快照还原**（与 release 同一个函数：残留被抹掉、旧内容回来）（before=${beforeTimeout} after=${after}）`);
});

// ── E：不是所有任务都两段式 ────────────────────────────────────────────
test('E · 判据已在 ⇒ 一段式 claimed；存量卡（无 judge_gate）⇒ 留痕不拦 + 响亮警告', async () => {
  const hasPost = await run([{ type: 'task', op: 'claim', id: N_HAS_POST, data: { owner: OWNER } }], `⑥：领 ${N_HAS_POST}（判据已在）`);
  assert.equal(hasPost.isError, false, `E1) 判据已存在的卡 claim 成功（${first(hasPost.text)}）`);
  assert.equal(cardOf(N_HAS_POST)?.state, 'claimed', 'E2) ★ 它**直接** claimed（没有走 preparing —— 不是所有任务都两段式）');
  assert.ok(
    cardOf(N_HAS_POST)?.prepared_snapshot === undefined || cardOf(N_HAS_POST)?.prepared_snapshot === null,
    'E3) 也没留快照（没准备过就没有回滚依据）',
  );

  const legacy = await run([{ type: 'task', op: 'claim', id: N_LEGACY, data: { owner: OWNER } }], `⑥：领存量卡 ${N_LEGACY}（判据空、无 judge_gate）`);
  assert.equal(legacy.isError, false, `E4) ★ 存量卡（判据空）**仍可领**（迁移期不拦 —— 否则那批卡会同时不可领）（${first(legacy.text)}）`);
  assert.equal(cardOf(N_LEGACY)?.state, 'claimed', 'E5) 它是 claimed（一段式，不进 preparing）');
  assert.ok(!!cardOf(N_LEGACY)?.claimed_without_judge,
    `E6) ★ 留痕 claimed_without_judge（不静默放行）（${JSON.stringify(cardOf(N_LEGACY)?.claimed_without_judge ?? null)}）`);
  assert.match(legacy.text, /警告/, 'E7) 回执里**响亮警告**（不是悄悄放过）');
});

// ── F：静态对拍：5 态与设计册同步（判据住两处就要能查）────────────────
test('F · TASK_STATES 是 5 态且含 preparing（与设计册逐字同）', () => {
  assert.equal(TASK_STATES.length, 5, `F1) TASK_STATES 是 5 态且含 preparing（${TASK_STATES.join(',')}）`);
  assert.ok((TASK_STATES as readonly string[]).includes('preparing'), 'F1′ 含 preparing');
});
