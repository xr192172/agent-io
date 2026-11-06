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
import { claimTask, completeTask } from '../src/application/design/dsl_ops/task_ops.js';
import { LEGACY_TASK_STATES, TASK_STATES, expectationsOf, isStoredTaskState, isTaskState } from '../src/domain/task_schema.js';
import { getDSL, saveDSL } from '../src/infrastructure/storage.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** ★ `source_root` 必须是**真仓根**（只读）：claim 会真跑判定器，而 `file-exists` 要一个能解析的根 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEAT = 'p0two';
const OWNER = 'subagent:p0-two-phase';
const ABSENT = 'src/domain/p0two_fixture_absent.ts'; // 盘上不存在 ⇒ file-exists 必红 ⇒ L2 站位 work（可领）
/** ★ T-35：N_HAS_POST 用自己的不存在路径 —— claim 现在会落 read_set，共用同一路径会与 node_empty_criteria 撞读集 */
const ABSENT_HAS_POST = 'src/domain/p0two_has_post_absent.ts';
const PRESENT = 'src/domain/task_machine.ts';

const N_EMPTY = 'node_empty_criteria'; // A/B：strict + 判据空
const N_EMPTY_ABANDON = 'node_empty_abandon'; // C：放弃
const N_EMPTY_TIMEOUT = 'node_empty_timeout'; // C'：超时
const N_HAS_POST = 'node_has_post'; // ⑥：已存在判据 ⇒ 一段式
const N_LEGACY = 'node_legacy_empty'; // ⑥：存量卡（无 judge_gate）
/** ★ 2026-11-07（PROJECT-DESIGN §4.4/§7.3/§9.2）：后态**只有 pending** 的卡 —— 用来钉「判不了不许当通过，且这条链真的接在 claim / complete 上」 */
const N_DUNNO = 'node_dunno_pending';

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

/**
 * ★ T-35：把一张已立的卡改成**存量 preparing 卡**（带 prepared_snapshot）。
 * T-28 后 claim 不再产生这个态，但旧册 / 历史快照 / 别人的数据根里仍有
 * ⇒ release / expire 的 legacy 出口（按快照逐字还原）必须继续被守住。
 */
function makeLegacyPreparing(nodeId: string, snapshotExps: unknown[] = []): void {
  const dsl: any = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n: any) =>
    n.id === nodeId
      ? {
          ...n,
          task: {
            ...(n.task ?? {}),
            id: nodeId,
            state: 'preparing',
            owner: OWNER,
            claimed_at: '2026-10-30T00:00:00.000Z',
            judge_gate: 'strict',
            prepared_snapshot: { expectations: snapshotExps, at: '2026-10-30T00:00:00.000Z', missing: [] },
          },
        }
      : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } } as any);
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
            expectations: [{ kind: 'file-exists', path: ABSENT_HAS_POST, why: '夹具：该文件不存在 ⇒ 后态红 ⇒ work' }],
          },
        },
        { id: N_LEGACY, type: 'file', label: '存量卡（无 judge_gate）', description: 'src/domain/p0two_legacy.ts', decision: emptyDecision('夹具：存量卡') },
        {
          id: N_DUNNO,
          type: 'file',
          label: '判不了（后态只有 pending）',
          description: 'src/domain/p0two_dunno.ts',
          decision: {
            summary: '夹具：后态判据全 pending（blocked_by）⇒ 站位 unknowable',
            expectations: [
              { kind: 'run', expect: 'true', blocked_by: ['夹具：上游没就绪'], why: '夹具：这一条今天判不了（pending），用来钉「判不了不许当通过」' },
            ],
          },
          // ★ 夹具先停在 candidate：G1/G2 要考「领不了」，G3 再把它手写成 claimed 去考「收不了口」
          task: { id: N_DUNNO, state: 'candidate', owner: null },
        },
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
        { id: N_DUNNO, path: 'src/domain/p0two_dunno.ts', responsibility: '夹具：判不了' },
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
test('A · 判据不够 ⇒ claim **原子拒领**（state 仍 candidate、无 owner、无快照）', async () => {
  aRes = await run([{ type: 'task', op: 'claim', id: N_EMPTY, data: { owner: OWNER } }], `A：claim 判据空的 ${N_EMPTY}（src/domain/p0two_empty.ts）`);
  const aCard = cardOf(N_EMPTY);
  assert.equal(aRes.isError, false, `A0) claim 本身没抛错（"判据不够"是**预期内结果**，不是程序错误）（${first(aRes.text)}）`);
  // ★ T-35：三件套才算"没拿到写权" —— 只钉 state=candidate 会被"没人领"混同
  assert.equal(aCard?.state, 'candidate', `A1) ★ state 仍 candidate（不是 claimed，也不再是 preparing）（state=${aCard?.state}）`);
  assert.equal(aCard?.owner ?? null, null, `A2) **一个字节都不落盘**：owner 仍为空（实测 owner=${JSON.stringify(aCard?.owner ?? null)}）`);
  assert.equal(aCard?.prepared_snapshot ?? null, null, 'A3) 也不拍快照（没有可还原的中间态 —— 这正是 T-28 的理由）');
});

// ── D：反馈可读（首行 + 点名 node / 条数 / 类别 / 下一步）────────────────
test('D · 反馈可读：首行说清哪个 node、补几条、哪几类、下一步', async () => {
  const aFirst = first(aRes.text);
  assert.ok(/\*\*未领取\*\*/.test(aFirst) && aFirst.includes(N_EMPTY), `D1) 首行点名了"未领取"与**哪个 node**（${aFirst}）`);
  assert.match(aFirst, /补 \*\*\d+ 条\*\*/, `D2) 首行说清**补几条**（数字 + 条）（${aFirst}）`);
  // ★ 2026-10-31：补判据模板从**存在类**换成语义类（存在类当画布 `judgement_ref` 会被
  //   `planJudgementGaps` 判「永远发现不了逻辑错」⇒ 第 5 步必被挡）。
  //   ⇒ D3 判的是「说清哪几类 **且** 那几类是语义类」，不钉某个具体 kind、也不钉固定 2 条。
  assert.ok(
    /(run|call-exists|behavior-cases)/.test(aFirst) && !/补[^\n]*(signature-matches|file-exists|symbol-exists)/.test(aFirst),
    `D3) 首行说清**哪几类**判据（且必须是语义类，不许给存在类）（${aFirst}）`,
  );
  assert.match(aFirst, /再 claim/, 'D4) 首行给出下一步（**再 claim** —— start 已随 T-28 退场）');
});

// ── B：两段式原子 ──────────────────────────────────────────────────────
test('B · 门槛原子：补到 need 条之前再 claim 仍拒领 ⇒ 补够后再 claim 成功', async () => {
  // ★ T-35：T-28 后 start 只服务存量 preparing 卡（对 candidate 卡恒拒、与条数无关）⇒
  //   它在这里**没有鉴别力**。判断"够不够"的判据点只剩 claim，于是 B1/B2 改钉**同一件事**：
  //   门槛 unmet ⇒ 仍"未领取" ⇒ 卡原地不动（state / owner / 快照都没变）。
  const bFail = await run([{ type: 'task', op: 'claim', id: N_EMPTY, data: { owner: OWNER } }], `B：判据还空就再 claim ${N_EMPTY}`);
  assert.equal(bFail.isError, false, `B1) ★ 门槛 unmet 时**仍拒领**（预期内结果，不是抛错）（${first(bFail.text)}）`);
  assert.match(first(bFail.text), /未领取/, 'B1′) 拒领回执必须点名「未领取」');
  assert.equal(cardOf(N_EMPTY)?.state, 'candidate', 'B2) 拒领后 state **仍是** candidate（没有半生效）');
  assert.equal(cardOf(N_EMPTY)?.owner ?? null, null, 'B2′) 拒领后 owner **仍为空**（一个字节都没落盘）');
  assert.equal(cardOf(N_EMPTY)?.prepared_snapshot ?? null, null, 'B3) 全程没有快照（中间态已不存在）');

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

  const bOk = await run([{ type: 'task', op: 'claim', id: N_EMPTY, data: { owner: OWNER } }], `B：判据补齐后再 claim ${N_EMPTY}`);
  assert.equal(bOk.isError, false, `B5) ★ 补够门槛后再 claim 成功（${first(bOk.text)}）`);
  assert.equal(cardOf(N_EMPTY)?.state, 'claimed', 'B6) state = claimed（这时才有写权）');
  assert.equal(cardOf(N_EMPTY)?.prepared_snapshot ?? null, null,
    `B7) 全程没有快照（"claimed 但快照还在"这种半态在 T-28 后不可能出现）（snapshot=${JSON.stringify(cardOf(N_EMPTY)?.prepared_snapshot ?? null)}）`);
});

// ── C：放弃零残留 ──────────────────────────────────────────────────────
test('C · 放弃（release）⇒ 判据与 claim 前逐字相同、快照删、回 candidate', async () => {
  const beforeC = expsOf(N_EMPTY_ABANDON);
  // ★ T-28 后 claim 不再产生 preparing ⇒ 用**存量卡夹具**（直接写态 + 快照）
  makeLegacyPreparing(N_EMPTY_ABANDON);
  assert.equal(cardOf(N_EMPTY_ABANDON)?.state, 'preparing', 'C0) 夹具：已是存量 preparing 卡');

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
  // ★ T-28 后 claim 不再产生 preparing ⇒ 存量卡夹具（快照 0 条）
  makeLegacyPreparing(N_EMPTY_TIMEOUT);
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
test('F · TASK_STATES 是四态（preparing 不许回流），存量态仍必须可读（与设计册逐字同）', () => {
  // ★ T-35：“正着守不住就反着守”：原来断的是"5 态且含 preparing"，现在断四态逐字 + preparing **不得**进入写词汇，
  //   同时把另一半（读旧册认得它）也钉住 —— 少任一半，旧册里的卡就会静默变成"读不出来的态"。
  assert.deepEqual([...TASK_STATES], ['candidate', 'claimed', 'done', 'void'], `F1) 写词汇逐字四态（实测 ${TASK_STATES.join(',')}）`);
  assert.ok(!(TASK_STATES as readonly string[]).includes('preparing'), 'F1′ ★ preparing **不许**回到写词汇（T-28 的方向）');
  assert.deepEqual([...LEGACY_TASK_STATES], ['preparing'], 'F2) 存量态集合逐字 = [preparing]');
  assert.equal(isTaskState('preparing'), false, 'F2′ 写端守卫：preparing 不是现行态');
  assert.equal(isStoredTaskState('preparing'), true, 'F2″ 读端守卫：旧册里的 preparing 必须认得（否则存量卡静默丢失）');
});

// ── G：**判不了 ≠ 通过**（PROJECT-DESIGN §4.4「索引陈旧 ⇒ 依赖该事实的判据为不可判定」
//      · §7.3 停止条件第 4 条「所需事实不可信」 · §9.2「unsupported/pending 不算违反，也不算通过；它们阻止核销」）
//
// ## 它挡的事故（P30 型：删掉一段分支，它承载的不变量跟着没了，而判据不喊）
// 「pending 只是'还没跑完'，不计入 fail/unsupported ⇒ 那就算满足吧」—— 这一句话就能把整条
// 「判不了不许收口」的规矩洗掉，而且**改完是全绿的**：`tsc` 不看值，`judge-all` 只证明判据成立。
// ★ 与 `tests/p0_domain_five_values.test.ts` 的分工（0.9.1，别混）：
//   那边用**假 Judge** 钉 `cardStanding` 的五值**算术**（domain 层，不碰 fs）；
//   这里用**真 Judge**（`judgeExpectations`）+ 真 DSL 钉**接线**：`claimTask` / `completeTask`
//   有没有真的把这个五值当门用。少任一半都可能"算对了但没人看"。
//
// ## 消融（本组必须能红 —— 2026-11-07 实测，两个方向各一次）
//   ① 把 `src/domain/task_machine.ts` 里 `isSatisfied` 的判据从 `standing === 'satisfied'`
//      改成 `standing === 'satisfied' || standing === 'unknowable'` ⇒ **G3 红**（complete 放行），
//      而 `p0_domain_five_values` **仍全绿**（它只判五值算术，不判这个谓词）⇒ 正是本组存在的理由。
//   ② 把 `claimTask` 里对 `unknown` 的拒绝摘掉 ⇒ **G1/G2 红**。
test('G · 后态只剩 pending ⇒ 领不了也收不了口（unknowable 在 claim / complete 两处都拒，且点名卡在哪）', async () => {
  const whyPending = /在等前置|blocked_by|待定|pending/i;
  // G1 领不了（work）：判不了 ⇒ 没有"活"可干，也没有"干完了"可报
  await assert.rejects(
    () => claimTask({ feature: FEAT, node_id: N_DUNNO, owner: OWNER, intent: 'work' } as never),
    (e: Error) => /可领性：unknowable/.test(e.message) && whyPending.test(e.message),
    'G1) 后态只剩 pending ⇒ claim(work) 必须拒，且**点名卡在哪**（不是一句"判不了"）',
  );
  // G2 ★ 连 modify 也拒 —— 否则"先领个写权再说"能把 unknowable 洗成 claimed（task_machine 105 行）
  await assert.rejects(
    () => claimTask({ feature: FEAT, node_id: N_DUNNO, owner: OWNER, intent: 'modify' } as never),
    (e: Error) => /可领性：unknowable/.test(e.message),
    'G2) ★ unknowable **连 modify 也拒**（"判不了"不是"卡不活跃"，是"改了也验不了"）',
  );
  assert.equal(cardOf(N_DUNNO)?.state, 'candidate', 'G2′) 两次拒绝都没有写入 state（被拒 = 一个字节不写）');

  // G3 收不了口：把它手写成 claimed（模拟"领的时候是红的、干到一半判不了了"）
  const dsl: any = getDSL(FEAT);
  const nodes = dsl.geometry.nodes.map((n: any) =>
    n.id === N_DUNNO ? { ...n, task: { ...n.task, state: 'claimed', owner: OWNER, claimed_at: '2026-11-07T00:00:00.000Z' } } : n,
  );
  saveDSL({ ...dsl, geometry: { ...dsl.geometry, nodes } } as never);
  const before = JSON.stringify(cardOf(N_DUNNO));
  await assert.rejects(
    () => completeTask({ feature: FEAT, node_id: N_DUNNO, agent: OWNER, evidence: { kind: 'attestation', reason: 'probe：判不了也想收口' } } as never),
    (e: Error) => /可收口性：unknowable/.test(e.message) && whyPending.test(e.message),
    'G3) 后态只剩 pending ⇒ complete 必须拒，且点名「在等前置」',
  );
  assert.equal(JSON.stringify(cardOf(N_DUNNO)), before, 'G3′) 被拒的 complete 一个字节都没改（不是"写了 done 再回滚"）');
});
