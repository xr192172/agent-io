/**
 * P0 · **domain 五值**（`cardStanding` 五值 × 前后态；假 Judge，不碰 fs / cache.db / 真实项目根）。
 *
 * ★★★ 2026-10-31：本文件从 `certs/t358-domain-five-values-cert.mjs` **整张迁来**。
 *   它此前是 `npm run verify` 的**第 6 道门**（`scripts/verify.mjs` 的「domain 五值」）。
 *   `certs/` 要整目录删 ⇒ 迁进 `tests/`，由**「测试」门**统一收走
 *   （0.9 一处权威：内容只有一个住处，也不让同一件事被两道门各跑一遍）。
 *
 * ## 它挡的事故（从 verify.mjs 那道门的 `why` 搬来，别丢）
 *   · `impl-fixture` 只覆盖 `cardStanding` 的 **1 个**分支条件，而五值 × 前后态是 **5×2** 组合
 *     ⇒ 这一层此前**没有任何门**。
 *   · 它挡的具体事故：把 `unsupported > 0 ⇒ unknowable` 改成 `⇒ satisfied`（**判不了退化成通过**）。
 *     `tsc` 对此一声不响 —— 那是"值"不是"形状"。
 *   · 为什么毫秒级可跑：2026-10-21 拆掉了 `domain → application` 倒挂（judge 走**端口注入**），
 *     `cardStanding(card, expectations, {root, nodes, judge})` 现在能喂**假 Judge**、不碰 fs。
 *     若哪天有人把判定器又焊回 domain（或某个分支偷偷读盘），⑦ 那三条先红。
 *   · 「待定」那条也钉在里面：`pending > 0` **不许**被读成「全过」（2026-10-22 由"假绿"改成
 *     「压过 satisfied」⇒ 只有 pending 也判 `unknowable`）。
 *
 * ## 消融（★ 本文件必须能红 —— 2026-10-31 迁移时实测，两次读数都记在这里）
 *   ① **改哪一行**：`src/domain/task_machine.ts` 的 `if (satisfaction.unsupported > 0) {` ⇒ `if (false) {`。
 *      **红读数**：`用例 6/8`（⑤ 组「⑤b 后态 unsupported>0 ⇒ unknowable」红，standing=satisfied；
 *      ⑥ 组「⑥a 后态判不了压过前态红」红，standing=violated）· exit 1。
 *   ② **从备份还原**（`git diff` 为空 = 逐字节相同）⇒ **用例 8/8 · 43 条断言全绿** · exit 0。
 *   ★ 为什么不动 `dist`：本文件 import 的是 `../src/…`（与 `tests/` 既有 20 个文件同口径，
 *     `run-tests.mjs` 也明写「测试读源码不读 dist」）⇒ 实测**改 `dist` 同样一行仍是 8/8 绿**。
 *     把测试改成读 `dist` 会引入「dist 陈旧 ⇒ 静默测旧代码」这个 AGENTS-RULES 0.12 ② 明令禁止的输入。
 *   ★ 原证（verify 门时期）的读数：改坏 `task_machine` L300 ⇒ PASS=36 FAIL=2 EXIT=1；还原 ⇒ 38/38 EXIT=0。
 *
 * ## 边界（诚实清单）
 *   · 全程**不** `import node:fs`、不建临时目录、不读 `cache.db` —— `root` 是永远不存在的哨兵字符串；
 *   · 「五值 reason 文案」也钉了几条（`/本节点/`、`/不许收口/`…）—— 那是**用户可见字符串**，
 *     与 GUIDE-GATE 的优先级一致（用户可见字符串 > 内部注释）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardStanding, isClaimable, isSatisfied } from '../src/domain/task_machine.js';

type AnyRec = Record<string, any>;
/** 判据/卡：形状由各 kind 决定 ⇒ 这里只做「透传给领域函数」的容器（运行期不校验类型） */
const asExps = <T>(xs: AnyRec[]): T => xs as unknown as T;
const asCard = <T>(c: AnyRec): T => c as unknown as T;

// ════════════════════════════════════════════════════════════════════
// 夹具：假 Judge 与判据（逐字搬自原证，只有标识前缀 T358 ⇒ P0-five）
// ════════════════════════════════════════════════════════════════════
const ROOT = 'fake-root:never-exists';

const POST_OK = { kind: 'file-exists', path: 'src/ok.ts', why: '夹具：后态已成立' };
const RED_OWN = { kind: 'file-exists', path: 'src/mine.ts', why: '夹具：本节点自己的洞' };
const RED_ORPHAN = { kind: 'run', expect: 'true', why: '夹具：run 没有主体文件 ⇒ 不对应任何节点' };
const RED_DEP = { kind: 'file-exists', path: 'src/dep.ts', why: '夹具：依赖节点的洞' };
const RED_DONE = { kind: 'file-exists', path: 'src/done.ts', why: '夹具：已 done 节点的旧判据' };
const PRE_RED = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/b.ts', why: '夹具：a 不该依赖 b' };
const PRE_GREEN = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/c.ts', why: '夹具：a 不依赖 c' };
const PRE_UNSUP = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/u.ts', why: '夹具：前态判不了' };
const POST_UNSUP = { kind: 'symbol-exists', path: 'src/x.ts', symbol: 'X', why: '夹具：后态判不了' };
const POST_PENDING = { kind: 'run', expect: 'true', blocked_by: '等 X', why: '夹具：只有 pending' };

/** 基准判定表：判据本身**不读盘**，只按夹具的约定回四值。 */
function baseVerdict(e: AnyRec): string {
  if (e.kind === 'edge-absent') {
    if (e.to === 'src/b.ts') return 'fail';
    if (e.to === 'src/u.ts') return 'unsupported';
    return 'pass';
  }
  if (e.kind === 'run') return e.blocked_by ? 'pending' : 'fail';
  if (e.kind === 'symbol-exists') return 'unsupported';
  if (e.path === 'src/mine.ts' || e.path === 'src/dep.ts' || e.path === 'src/done.ts') return 'fail';
  return 'pass';
}

interface FakeJudge {
  (root: string, items: AnyRec[]): Promise<AnyRec>;
  calls: Array<{ root: string; n: number }>;
}

/** 造一个假 Judge；`checkedDelta` 专门用来造「残报」。 */
function makeJudge({ checkedDelta = 0 }: { checkedDelta?: number } = {}): FakeJudge {
  const calls: Array<{ root: string; n: number }> = [];
  const judge = (async (root: string, items: AnyRec[]) => {
    calls.push({ root, n: items.length });
    const out = items.map((it) => {
      const verdict = baseVerdict(it.expectation);
      return { ...it, verdict, detail: `fake:${verdict}` };
    });
    const count = (v: string) => out.filter((i) => i.verdict === v).length;
    return {
      checked: out.length - checkedDelta,
      passed: count('pass'),
      failed: count('fail'),
      unsupported: count('unsupported'),
      items: out,
      notes: [],
      conflicts: [],
    };
  }) as FakeJudge;
  judge.calls = calls;
  return judge;
}

const NODES = [
  { id: 'card_satisfied', path: 'src/ok.ts' },
  { id: 'card_work', path: 'src/mine.ts' },
  { id: 'card_orphan', path: 'src/other.ts' },
  { id: 'card_blocked', path: 'src/mine2.ts' },
  { id: 'card_violated', path: 'src/a.ts' },
  { id: 'card_empty', path: 'src/empty.ts' },
  { id: 'card_unsupported', path: 'src/x.ts' },
  { id: 'card_pre_unsup', path: 'src/a.ts' },
  { id: 'card_residual', path: 'src/mine.ts' },
  { id: 'card_pending', path: 'src/pending.ts' },
  { id: 'dep_pending', path: 'src/dep.ts' },
  { id: 'dep_done', path: 'src/done.ts', task: { id: 'dep_done', summary: 'dep done', state: 'done' } },
];

const card = (id: string, criteria: AnyRec[]) => ({ id, summary: `P0-five ${id}`, criteria, state: 'candidate' });
const opts = (judge: AnyRec = makeJudge()) => ({ root: ROOT, nodes: NODES, judge });
const brief = (v: AnyRec) =>
  `standing=${v.standing} · sat=${JSON.stringify(v.satisfaction)} · vio=${JSON.stringify(v.violation)} · redSeen=${v.redSeen}`;

/** 判五值（原证的 `cardStanding` 适配器：判据挂在 `criteria` 上传第二参，卡上不再有 expectations） */
const standing = (c: AnyRec, j: AnyRec = makeJudge()) =>
  cardStanding(asCard(c), asExps(c.criteria ?? []), opts(j)) as Promise<AnyRec>;
const satisfied = (c: AnyRec, j: AnyRec = makeJudge()) =>
  isSatisfied(asCard(c), asExps(c.criteria ?? []), opts(j)) as Promise<AnyRec>;

// ════════════════════════════════════════════════════════════════════
test('① work：后态有红且可修（own / orphan 两种来路）', async () => {
  const j = makeJudge();
  const v = await standing(card('card_work', [RED_OWN]), j);
  assert.equal(v.standing, 'work', `①a own 红 ⇒ work（${brief(v)}）`);
  assert.ok(v.satisfaction.failed === 1 && v.violation.failed === 0,
    `①b 计数落在满足度轴（前态无红）（${JSON.stringify(v.satisfaction)}）`);
  assert.ok(isClaimable(v.standing), '①c work ⇒ 可领');
  assert.match(v.reason, /本节点/);
  assert.match(v.reason, /src\/mine\.ts/); // ①d reason 点名本节点路径

  const v2 = await standing(card('card_orphan', [RED_ORPHAN]), makeJudge());
  assert.equal(v2.standing, 'work', `①e 红不对应任何节点（orphan）⇒ 仍 work（不是 blocked）（${brief(v2)}）`);
  assert.match(v2.reason, /不对应任何节点/, '①f reason 明说 orphan（不把它当“等别人”）');
});

test('② violated：后态全过 ∧ 前态 failed > 0（★ 最易漏）', async () => {
  const v = await standing(card('card_violated', [POST_OK, PRE_RED]), makeJudge());
  assert.equal(v.standing, 'violated', `②a 前态红 ⇒ violated（${brief(v)}）`);
  assert.ok(v.satisfaction.failed === 0 && v.violation.failed === 1,
    `②b 满足度无红、违约轴 1 红（两轴分开）（${JSON.stringify(v.satisfaction)} / ${JSON.stringify(v.violation)}）`);
  assert.ok(isClaimable(v.standing), '②c violated ⇒ 可领（去拆依赖）');
  const s = await satisfied(card('card_violated', [POST_OK, PRE_RED]), makeJudge());
  assert.equal(s.satisfied, false, '②d violated ⇒ **不可收口**（isSatisfied=false）');
  assert.match(v.reason, /不许收口/, '②e reason 明说“不许收口”');
});

test('③ blocked：后态有红但不可修（未完成 dep / 已 done dep）', async () => {
  const b1 = await standing(card('card_blocked', [RED_DEP]), makeJudge());
  assert.equal(b1.standing, 'blocked', `③a 红全落在未完成节点 ⇒ blocked（${brief(b1)}）`);
  assert.deepEqual(b1.blockedBy, ['dep_pending'], '③b blockedBy 点名 dep_pending');
  assert.equal(isClaimable(b1.standing), false, '③c blocked ⇒ 拒领');

  const b2 = await standing(card('card_blocked', [RED_DONE]), makeJudge());
  assert.equal(b2.standing, 'blocked', `③d 红落在已 done 节点 ⇒ 也 blocked（闸只认该节点 claimed 卡）（${brief(b2)}）`);
  assert.ok(Array.isArray(b2.blockedBy) && b2.blockedBy.includes('dep_done'), '③e blockedBy 含 dep_done');
  assert.match(b2.reason, /重开/, '③e′ reason 指路“重开那张卡”');
});

test('④ satisfied：后态全过 + 前态无红（含 modify 取写权、phase 分区）', async () => {
  const v = await standing(card('card_satisfied', [POST_OK, PRE_GREEN]), makeJudge());
  assert.equal(v.standing, 'satisfied', `④a 后态全过 + 前态无红 ⇒ satisfied（${brief(v)}）`);
  assert.equal(isClaimable(v.standing), false, '④b satisfied 默认**不可领**（没活干）');
  assert.equal(isClaimable(v.standing, 'modify'), true, '④c satisfied ∧ intent=modify ⇒ 可领（取写权）');
  const s = await satisfied(card('card_satisfied', [POST_OK, PRE_GREEN]), makeJudge());
  assert.equal(s.satisfied, true, '④d satisfied ⇒ 可收口');
  assert.ok(v.judged.post.length === 1 && v.judged.pre.length === 1,
    `④e phase 分区：post 1 / pre 1（前态不混进满足度）（${JSON.stringify({ post: v.judged.post.length, pre: v.judged.pre.length })}）`);
});

test('⑤ unknowable：判不了（四种来路：空集 / unsupported / 残报 / 前态判不了）', async () => {
  const j = makeJudge();
  const e1 = await standing(card('card_empty', [PRE_RED]), j);
  assert.equal(e1.standing, 'unknowable', `⑤a post.length===0 ⇒ unknowable（空集不当全过）（${brief(e1)}）`);
  assert.match(e1.reason, /一条不剩/, '⑤a′ reason 明说“一条不剩”');
  assert.equal(j.calls[0]?.n, 0, '⑤a″ 空批也交给判定器（计数口径只有一处），calls[0].n=0');

  const e2 = await standing(card('card_unsupported', [POST_UNSUP]), makeJudge());
  assert.equal(e2.standing, 'unknowable', `⑤b 后态 unsupported>0 ⇒ unknowable（${brief(e2)}）`);
  assert.ok(e2.satisfaction.unsupported === 1 && e2.satisfaction.failed === 0,
    `⑤b′ unsupported 计入自己的格，不混进 failed（${JSON.stringify(e2.satisfaction)}）`);

  const e3 = await standing(card('card_residual', [RED_OWN]), makeJudge({ checkedDelta: 1 }));
  assert.equal(e3.standing, 'unknowable', `⑤c 残报 checked!==post.length ⇒ unknowable（${brief(e3)}）`);
  assert.match(e3.reason, /只回了部分条目/, '⑤c′ reason 明说残缺报告（不许当全过）');

  const e4 = await standing(card('card_pre_unsup', [POST_OK, PRE_UNSUP]), makeJudge());
  assert.equal(e4.standing, 'unknowable', `⑤d 后态全过、前态 unsupported>0 ⇒ unknowable（${brief(e4)}）`);
  assert.equal(e4.violation.unsupported, 1, '⑤d′ 违约轴 unsupported=1（不敢说“没有违约”）');
});

test('⑤e pending：在等前置 ⇒ 压过 satisfied（含反向对照组）', async () => {
  const v = await standing(card('card_pending', [POST_PENDING]), makeJudge());
  // ★ 2026-10-22：这一条从钉旧行为翻成了钉新行为 —— pending = 「活还没干完，在等前置」，
  //   与 unsupported（判据判不了）不同，但**两者都不许被读成「全过」**。
  assert.equal(v.standing, 'unknowable', `⑤e ★ 只有 pending ⇒ unknowable（在等前置 ≠ 可收口）（${brief(v)}）`);
  assert.equal(v.satisfaction.pending, 1, '⑤e′ pending 被**计数**了（此前五值里唯一没人数的那个）');
  assert.ok(/pending|在等前置/.test(v.reason) && String(v.reason).includes('等 X'),
    '⑤e″ reason 里带 blocked_by 原文 —— 「卡在哪」必须读得出来');

  // 反向对照：换成一条**明确绿**的后态判据 ⇒ satisfied（证明五值能分辨，不是"什么都说 unknowable"）
  const v2 = await standing(card('card_pending2', [POST_OK]), makeJudge());
  assert.equal(v2.standing, 'satisfied', `⑤e‴ 对照组：换一条明确绿的判据 ⇒ satisfied（${brief(v2)}）`);
  assert.equal(v2.satisfaction.pending, 0, '⑤e⁗ 对照组 satisfaction.pending === 0');
  assert.doesNotMatch(v2.reason, /在等前置/, '⑤e⁵ 对照组 reason 里不出现「在等前置」');
});

test('⑥ 优先级与不吞红：unknowable 压过前态红，但把红的条数带出来', async () => {
  const v = await standing(card('card_unsupported', [POST_UNSUP, PRE_RED]), makeJudge());
  assert.equal(v.standing, 'unknowable', `⑥a 后态判不了压过前态红（仍 unknowable）（${brief(v)}）`);
  assert.ok(v.redSeen === 1 && /红/.test(v.reason),
    `⑥b 但把“另看到 1 条红”带出来（unknowable 不吞红）（${v.reason}）`);
});

test('⑦ 端口纯度：root 是不透明字符串，且全程不读盘', async () => {
  const t0 = performance.now();
  const judges: FakeJudge[] = [];
  for (const exp of [[POST_OK], [RED_OWN], [POST_OK, PRE_RED], [RED_DEP]]) {
    const j = makeJudge();
    judges.push(j);
    await standing(card('card_work', exp), j);
  }
  const allCalls = judges.flatMap((j) => j.calls);
  assert.ok(allCalls.length > 0 && allCalls.every((c) => c.root === ROOT),
    `⑦a 每次判定收到的 root 逐字等于哨兵（domain 没改写/拼路径）（${JSON.stringify(allCalls)}）`);
  assert.ok(allCalls.every((c) => Number.isInteger(c.n) && c.n >= 0),
    '⑦b 假 Judge 只收到“条数”，没有任何路径被解析');
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 1000, `⑦c 全程 < 1s（实测 ${elapsed.toFixed(1)}ms）—— 没有读盘/建库的延迟`);
});
