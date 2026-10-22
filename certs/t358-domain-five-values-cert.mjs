#!/usr/bin/env node
/**
 * cert T358 —— **domain 五值单测**（假 Judge，不碰 fs / cache.db / 真实项目根）。
 *
 * ## 为什么要这张证（它验的不是产品行为，是**判据的可测性**）
 * D-judge-port 把判定器抽成端口后，`cardStanding(card, {root, nodes, judge})` 可以在
 * **没有文件系统**的上下文里跑。本证就是那个「没有文件系统」的上下文：
 *   · `root` 是一个永远不存在的哨兵字符串；
 *   · `judge` 是内存函数，收到几条就回几条；
 *   · 全程不 import `node:fs`，不读 `cache.db`，不建临时目录。
 * ⇒ 若哪天有人把判定器又焊回 domain（或某个分支偷偷读盘），本证会先红。
 *
 * ## 覆盖矩阵（五值 × 前后态）
 *   work       —— ① 后态红落在本节点（own） ② 后态红不对应任何节点（orphan）
 *   violated   —— 后态全过 ∧ 前态 failed > 0
 *   blocked    —— 后态红全落在别人节点：① 未完成（dep-pending） ② 已 done（dep-done）
 *   satisfied  —— 后态全过 ∧ 前态无红（含 pre 绿对照）
 *   unknowable —— ① post.length === 0 ② 后态 unsupported > 0 ③ 残报 checked !== post.length
 *                 ④ 后态全过但前态 unsupported > 0
 *   pending    —— ★【当前不实现】只钉「当前行为 = satisfied」，为链 A 环2 留对照：
 *                 环2 修好后，`pending ⇒ unknowable` 会让本证这一段变红（这是**故意**的）。
 *
 * ## 判据
 *   · 五值各至少一个读数，且 reason 能看出是哪种处境；
 *   · `isClaimable` / `isSatisfied` 各读一侧（satisfied 不可领但可 modify；violated 可领不可收口）；
 *   · 假 Judge 收到的 `root` 逐字等于哨兵 ⇒ domain 没有把它改写/拼路径；
 *   · 总耗时 < 1000ms。
 *
 * ## 消融自证（★ 跑这张证的人必须做一次）
 *   把 `src/domain/task_machine.ts` 的 `satisfaction.unsupported > 0 ⇒ unknowable` 改成 `⇒ satisfied`，
 *   重新 build ⇒ 本证 ②e 必须红；还原 ⇒ 再绿。
 *   —— 红不了，说明这条断言是装饰。
 *
 * ## 用法
 *   npm run build && node certs/t358-domain-five-values-cert.mjs
 */
const { cardStanding: standingRaw, isClaimable, isSatisfied: satisfiedRaw } = await import('../dist/src/domain/task_machine.js');
/**
 * ★ 2026-10-22（task.expectations 去副本）：判据不再住卡（TaskSpec 无该字段）⇒ 夹具把它挂在 `criteria` 上，
 *   由这两行适配器作为**第二个参数**送给领域函数（卡上不再有 expectations）。
 */
const cardStanding = (c, opts) => standingRaw(c, c.criteria ?? [], opts);
const isSatisfied = (c, opts) => satisfiedRaw(c, c.criteria ?? [], opts);

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ════════════════════════════════════════════════════════════════════
// 夹具：假 Judge 与判据
// ════════════════════════════════════════════════════════════════════
const ROOT = 'fake-root:never-exists';

const POST_OK = { kind: 'file-exists', path: 'src/ok.ts', why: 'T358 夹具：后态已成立' };
const RED_OWN = { kind: 'file-exists', path: 'src/mine.ts', why: 'T358 夹具：本节点自己的洞' };
const RED_ORPHAN = { kind: 'run', expect: 'true', why: 'T358 夹具：run 没有主体文件 ⇒ 不对应任何节点' };
const RED_DEP = { kind: 'file-exists', path: 'src/dep.ts', why: 'T358 夹具：依赖节点的洞' };
const RED_DONE = { kind: 'file-exists', path: 'src/done.ts', why: 'T358 夹具：已 done 节点的旧判据' };
const PRE_RED = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/b.ts', why: 'T358 夹具：a 不该依赖 b' };
const PRE_GREEN = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/c.ts', why: 'T358 夹具：a 不依赖 c' };
const PRE_UNSUP = { kind: 'edge-absent', from: 'src/a.ts', to: 'src/u.ts', why: 'T358 夹具：前态判不了' };
const POST_UNSUP = { kind: 'symbol-exists', path: 'src/x.ts', symbol: 'X', why: 'T358 夹具：后态判不了' };
const POST_PENDING = { kind: 'run', expect: 'true', blocked_by: '等 X', why: 'T358 夹具：只有 pending 的卡（当前假绿）' };

/** 基准判定表：判据本身**不读盘**，只按夹具的约定回四值。 */
const baseVerdict = (e) => {
  if (e.kind === 'edge-absent') {
    if (e.to === 'src/b.ts') return 'fail';
    if (e.to === 'src/u.ts') return 'unsupported';
    return 'pass';
  }
  if (e.kind === 'run') return e.blocked_by ? 'pending' : 'fail';
  if (e.kind === 'symbol-exists') return 'unsupported';
  if (e.path === 'src/mine.ts' || e.path === 'src/dep.ts' || e.path === 'src/done.ts') return 'fail';
  return 'pass';
};

/** 造一个假 Judge；`checkedDelta` 专门用来造「残报」。 */
function makeJudge({ checkedDelta = 0 } = {}) {
  const calls = [];
  const judge = async (root, items) => {
    calls.push({ root, n: items.length });
    const out = items.map((it) => {
      const verdict = baseVerdict(it.expectation);
      return { ...it, verdict, detail: `fake:${verdict}` };
    });
    const count = (v) => out.filter((i) => i.verdict === v).length;
    return {
      checked: out.length - checkedDelta,
      passed: count('pass'),
      failed: count('fail'),
      unsupported: count('unsupported'),
      items: out,
      notes: [],
      conflicts: [],
    };
  };
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

const card = (id, criteria) => ({ id, summary: `T358 ${id}`, criteria, state: 'candidate' });
const opts = (judge = makeJudge()) => ({ root: ROOT, nodes: NODES, judge });
const brief = (v) =>
  `standing=${v.standing} · sat=${JSON.stringify(v.satisfaction)} · vio=${JSON.stringify(v.violation)} · redSeen=${v.redSeen}`;

console.log('══ T358 · domain 五值单测（假 Judge，不碰 fs）══');
const t0 = performance.now();

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ① work：后态有红且可修 ════');
{
  const j = makeJudge();
  const v = await cardStanding(card('card_work', [RED_OWN]), opts(j));
  chk(v.standing === 'work', '①a own 红 ⇒ work', brief(v));
  chk(v.satisfaction.failed === 1 && v.violation.failed === 0, '①b 计数落在满足度轴（前态无红）', JSON.stringify(v.satisfaction));
  chk(isClaimable(v.standing), '①c work ⇒ 可领');
  chk(/本节点/.test(v.reason) && /src\/mine\.ts/.test(v.reason), '①d reason 点名本节点路径', v.reason);

  const v2 = await cardStanding(card('card_orphan', [RED_ORPHAN]), opts());
  chk(v2.standing === 'work', '①e 红不对应任何节点（orphan）⇒ 仍 work（不是 blocked）', brief(v2));
  chk(/不对应任何节点/.test(v2.reason), '①f reason 明说 orphan（不把它当“等别人”）', v2.reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② violated：后态全过 ∧ 前态 failed > 0（★ 最易漏）════');
{
  const v = await cardStanding(card('card_violated', [POST_OK, PRE_RED]), opts());
  chk(v.standing === 'violated', '②a 前态红 ⇒ violated', brief(v));
  chk(v.satisfaction.failed === 0 && v.violation.failed === 1, '②b 满足度无红、违约轴 1 红（两轴分开）', `${JSON.stringify(v.satisfaction)} / ${JSON.stringify(v.violation)}`);
  chk(isClaimable(v.standing), '②c violated ⇒ 可领（去拆依赖）');
  chk(!(await isSatisfied(card('card_violated', [POST_OK, PRE_RED]), opts())).satisfied, '②d violated ⇒ **不可收口**（isSatisfied=false）');
  chk(/不许收口/.test(v.reason), '②e reason 明说“不许收口”', v.reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ blocked：后态有红但不可修 ════');
{
  const b1 = await cardStanding(card('card_blocked', [RED_DEP]), opts());
  chk(b1.standing === 'blocked', '③a 红全落在未完成节点 ⇒ blocked', brief(b1));
  chk(JSON.stringify(b1.blockedBy) === JSON.stringify(['dep_pending']), '③b blockedBy 点名 dep_pending', JSON.stringify(b1.blockedBy));
  chk(!isClaimable(b1.standing), '③c blocked ⇒ 拒领');

  const b2 = await cardStanding(card('card_blocked', [RED_DONE]), opts());
  chk(b2.standing === 'blocked', '③d 红落在已 done 节点 ⇒ 也 blocked（闸只认该节点 claimed 卡）', brief(b2));
  chk(b2.blockedBy?.includes('dep_done') && /重开/.test(b2.reason), '③e reason 点名 dep_done 且指路“重开那张卡”', b2.reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ satisfied：全过 ════');
{
  const v = await cardStanding(card('card_satisfied', [POST_OK, PRE_GREEN]), opts());
  chk(v.standing === 'satisfied', '④a 后态全过 + 前态无红 ⇒ satisfied', brief(v));
  chk(!isClaimable(v.standing), '④b satisfied 默认**不可领**（没活干）');
  chk(isClaimable(v.standing, 'modify'), '④c satisfied ∧ intent=modify ⇒ 可领（取写权）');
  chk((await isSatisfied(card('card_satisfied', [POST_OK, PRE_GREEN]), opts())).satisfied, '④d satisfied ⇒ 可收口');
  chk(v.judged.post.length === 1 && v.judged.pre.length === 1, '④e phase 分区：post 1 / pre 1（前态不混进满足度）', JSON.stringify({ post: v.judged.post.length, pre: v.judged.pre.length }));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ unknowable：判不了（四种来路）════');
{
  const j = makeJudge();
  const e1 = await cardStanding(card('card_empty', [PRE_RED]), opts(j));
  chk(e1.standing === 'unknowable', '⑤a post.length===0 ⇒ unknowable（空集不当全过）', brief(e1));
  chk(/一条不剩/.test(e1.reason), '⑤a′ reason 明说“一条不剩”', e1.reason);
  chk(j.calls[0]?.n === 0, '⑤a″ 空批也交给判定器（计数口径只有一处），calls[0].n=0', JSON.stringify(j.calls));

  const e2 = await cardStanding(card('card_unsupported', [POST_UNSUP]), opts());
  chk(e2.standing === 'unknowable', '⑤b 后态 unsupported>0 ⇒ unknowable', brief(e2));
  chk(e2.satisfaction.unsupported === 1 && e2.satisfaction.failed === 0, '⑤b′ unsupported 计入自己的格，不混进 failed', JSON.stringify(e2.satisfaction));

  const e3 = await cardStanding(card('card_residual', [RED_OWN]), opts(makeJudge({ checkedDelta: 1 })));
  chk(e3.standing === 'unknowable', '⑤c 残报 checked!==post.length ⇒ unknowable', brief(e3));
  chk(/只回了部分条目/.test(e3.reason), '⑤c′ reason 明说残缺报告（不许当全过）', e3.reason);

  const e4 = await cardStanding(card('card_pre_unsup', [POST_OK, PRE_UNSUP]), opts());
  chk(e4.standing === 'unknowable', '⑤d 后态全过、前态 unsupported>0 ⇒ unknowable', brief(e4));
  chk(e4.violation.unsupported === 1, '⑤d′ 违约轴 unsupported=1（不敢说“没有违约”）', JSON.stringify(e4.violation));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤e pending：★ 2026-10-22 由「假绿」改成「压过 satisfied」════');
{
  const v = await cardStanding(card('card_pending', [POST_PENDING]), opts());
  // ★★★ 2026-10-22：这一条**从钉旧行为翻成了钉新行为**。
  //   本证原先写的是「只有 pending ⇒ satisfied（既有洞，不是本证认可的语义）」，并预言
  //   「链 A 环2 修好后，⑤e 必须变红 —— 红是预期的，不是回归」。
  //   ⇒ 那一天到了：`pending > 0 ⇒ unknowable`，理由：pending = 「活还没干完，在等前置」，
  //     与 unsupported（判据判不了）不同，但**两者都不许被读成「全过」**。
  chk(v.standing === 'unknowable', '⑤e ★ 只有 pending ⇒ unknowable（在等前置 ≠ 可收口）', brief(v));
  chk(v.satisfaction.pending === 1, '⑤e′ pending 被**计数**了（此前五值里唯一没人数的那个）', JSON.stringify(v.satisfaction));
  chk(/pending|在等前置/.test(v.reason) && String(v.reason).includes('等 X'),
    '⑤e″ reason 里带 blocked_by 原文 —— 「卡在哪」必须读得出来', v.reason);
  // ★ 反向对照：换成一条**明确绿**的后态判据 ⇒ satisfied。
  //   ★ 为什么不用「同一条去掉 blocked_by」：本文件的 `baseVerdict` 对**无 blocked_by 的 run 一律给 fail**
  //     （那条分支是给 ① work 用的），拿它当对照会测到「run 无 blocked_by ⇒ fail」而不是「pending 归零 ⇒ 绿」。
  //   ⇒ 对照用 `POST_OK`（`file-exists src/ok.ts` ⇒ pass），它验的是同一件事：
  //     **pending 计数为 0 时，reason 里不出现「在等前置」、standing 回到 satisfied**。
  const v2 = await cardStanding(card('card_pending2', [POST_OK]), opts());
  chk(v2.standing === 'satisfied', '⑤e‴ 对照组：换一条明确绿的判据 ⇒ satisfied（证明能分辨）', brief(v2));
  chk(v2.satisfaction.pending === 0, '⑤e⁗ 对照组 satisfaction.pending === 0');
  chk(!/在等前置/.test(v2.reason), '⑤e⁵ 对照组 reason 里不出现「在等前置」');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ 优先级与不吞红 ════');
{
  const v = await cardStanding(card('card_unsupported', [POST_UNSUP, PRE_RED]), opts());
  chk(v.standing === 'unknowable', '⑥a 后态判不了压过前态红（仍 unknowable）', brief(v));
  chk(v.redSeen === 1 && /红/.test(v.reason), '⑥b 但把“另看到 1 条红”带出来（unknowable 不吞红）', v.reason);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑦ 端口纯度：root 是不透明字符串，且全程不读盘 ════');
{
  const judges = [];
  for (const exp of [[POST_OK], [RED_OWN], [POST_OK, PRE_RED], [RED_DEP]]) {
    const j = makeJudge();
    judges.push(j);
    await cardStanding(card('card_work', exp), opts(j));
  }
  const allCalls = judges.flatMap((j) => j.calls);
  chk(allCalls.length > 0 && allCalls.every((c) => c.root === ROOT), '⑦a 每次判定收到的 root 逐字等于哨兵（domain 没改写/拼路径）', JSON.stringify(allCalls));
  chk(allCalls.every((c) => Number.isInteger(c.n) && c.n >= 0), '⑦b 假 Judge 只收到“条数”，没有任何路径被解析');
  const elapsed = performance.now() - t0;
  chk(elapsed < 1000, `⑦c 全程 < 1s（实测 ${elapsed.toFixed(1)}ms）—— 没有读盘/建库的延迟`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
