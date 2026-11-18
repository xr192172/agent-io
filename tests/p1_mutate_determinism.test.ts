/**
 * P1 · mutate 的**抽样段**必须可复现；「判据抓不住的变异体」不许变成恒红的灯（T-#MUTATE-DET）。
 *
 * ## 病（实测，不是推测）
 * ① 卡面原话是「planMutants **随机抽样** ⇒ 同一改动两次跑出不同报告」。**实测不成立**：
 *    `scripts/mutate.mjs` 零 `Math.random`，抽样是 `sort(按 file#symbol)` + `slice(0,N)`；
 *    同一册连跑两次，报告 sha256 完全相同（sandbox `before-run1/2`）。
 * ② 真正的病是「**恒定相同**」：`slot_source.ts#checkSlotSources` 三类突变体（swap/bool/str）
 *    全 `pass`，而它**恒**进前 5 ⇒ D7 **恒红**。恒红不是更安全，是**更没信息**（0.16）。
 * ③ 排序键本身也不硬：`localeCompare` 跟随 ICU/locale（换机器可能换序），且键里没有
 *    feature / kind / 算子类 ⇒ 跨册同名候选谁在前取决于**册的遍历顺序**（去重是"首见即留"）。
 *
 * ## 这份测试要钉住的四件事（每件都配一条**反例**，否则断言可能永远绿）
 * ① 同输入两次 `planMutants` 逐字相同（真仓）；
 * ② **打乱候选顺序 ⇒ 样本集合不变** —— 并同时跑一遍**旧口径**（首见去重 + localeCompare + 先切片）
 *    证明它会变（这条断言有判别力）；
 * ③ 无突变体的候选**不吃额度**（旧口径会让它白吃 1/N），账内 id 被跳过（跳的是"已知"，
 *    跳完仍**点名**），且 `--only` **绕过**豁免；
 * ④ 账坏掉（无 why / 重复 id / 不是 JSON / 缺 rows）**必须抛**，不许静默当空账
 *    —— 空账 = 全部挂账同时复活成假红；缺文件才是空账（诚实）。
 *
 * ## 它不跑真 mutate
 * 判据执行核（`judgeExpectations`）不在这里跑：那要改 `src/` 再还原，属于 `p0_mutate_is_real`
 * 的地盘。本文件只测**纯选择段**（`selectSamples` / `rankCandidates` / `loadSurvivorBaseline`）
 * 与 `planMutants` 的**只读**口径 —— 快、无副作用、可注入。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUT: any = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mutate.mjs')).href);

type Mutant = { op: string; label?: string; line?: number };
type Cand = {
  feature: string;
  file: string;
  symbol: string;
  kind: string;
  class: string;
  node_id: string;
  target: string | null;
  mutants: Mutant[];
};

const mkCand = (
  feature: string,
  file: string,
  symbol: string,
  nodeId = 'n',
  cls = 'semantic',
  mutants: Mutant[] = [{ op: 'swap' }],
): Cand => ({ feature, file, symbol, kind: 'behavior-cases', class: cls, node_id: nodeId, target: null, mutants });

const idsOf = (sel: any): string[] => sel.samples.map((c: Cand) => MUT.survivorIdOf(c));
const idOf = (c: Cand): string => MUT.survivorIdOf(c);

/**
 * **旧口径**（HEAD `planMutants` 的抽样段，逐字复刻）：首见去重 → `localeCompare(file#symbol)` → 先切片后算突变体。
 * 它在这里的唯一用途是当**反例**：若某条断言在旧口径下也成立，那这条断言就没有判别力。
 */
function naiveSelect(cands: Cand[], n: number): Cand[] {
  const seen = new Set<string>();
  const out: Cand[] = [];
  for (const c of cands) {
    const k = `${c.file}#${c.symbol}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  out.sort((a, b) => `${a.file}#${a.symbol}`.localeCompare(`${b.file}#${b.symbol}`));
  return out.slice(0, n);
}

test('① 同一输入两次 planMutants ⇒ 逐字相同（真仓 agent-io）', async () => {
  // ★ 2026-11-18（批 15）：样本来源从 `task-system-plan` 换成 `agent-io` —— 计划册的文件节点与判据
  //   已整份搬进属主册（计划册判据 29 → 0）⇒ 再拿它当样本源，样本恒为 0，这条断言会退化成空转（0.16）。
  const opts = { n: 3, structural: 1 };
  const a = await MUT.planMutants(ROOT, ['agent-io'], opts);
  const b = await MUT.planMutants(ROOT, ['agent-io'], opts);
  const fingerprint = (p: any): string =>
    JSON.stringify({
      plans: p.plans.map((x: any) => [x.class, x.feature, x.file, x.symbol, x.target, x.mutants.map((m: any) => `${m.op}@${m.line}`)]),
      skip: p.skipReasons,
      baselined: p.baselined.map((x: any) => x.id),
      stale: p.stale_baseline,
    });
  assert.equal(fingerprint(a), fingerprint(b), '同输入两次的计划不一致 ⇒ 抽样不可复现（报告会随运行漂移）');
  assert.ok(a.plans.length > 0, '样本为 0 ⇒ 这条断言无从成立（先修下更根本的问题）');
});

test('② 打乱候选顺序 ⇒ 样本不变（反例：旧口径会变）', () => {
  // 造"同键跨册重复"：旧口径留**首见**（feature 随顺序变），新口径留 min(feature)
  const cands: Cand[] = [
    mkCand('a-book', 'src/a.ts', 'alpha', 'n1'),
    mkCand('b-book', 'src/a.ts', 'alpha', 'n1'),
    mkCand('a-book', 'src/b.ts', 'beta', 'n2'),
    mkCand('c-book', 'src/b.ts', 'beta', 'n2'),
    mkCand('a-book', 'src/c.ts', 'gamma', 'n3'),
    mkCand('b-book', 'src/d.ts', 'delta', 'n4'),
  ];
  const order1 = [...cands];
  const order2 = [...cands].reverse();

  const s1 = idsOf(MUT.selectSamples(order1, { n: 3 }));
  const s2 = idsOf(MUT.selectSamples(order2, { n: 3 }));
  assert.deepEqual(s1, s2, `换顺序换了样本：${JSON.stringify(s1)} vs ${JSON.stringify(s2)}`);
  // 排序键里没有 feature/kind/算子类时，跨册同名候选谁在前取决于遍历顺序
  assert.ok(s1.includes('a-book|src/a.ts|alpha|behavior-cases'), `同键重复应留 min(feature)：${JSON.stringify(s1)}`);

  // ★ 反例（判别力）：旧口径在两种顺序下**不同** ⇒ 上面的断言不是"永远绿"
  const old1 = naiveSelect(order1, 3).map(idOf);
  const old2 = naiveSelect(order2, 3).map(idOf);
  assert.notDeepEqual(old1, old2, `旧口径居然也稳定（${JSON.stringify(old1)}）⇒ 本用例的对照组失效，得换个更像真实候选池的夹具`);
});

test('③ 无突变体的候选不吃额度；账内 id 被跳过（且 `--only` 绕过豁免）', () => {
  // (a) 额度：`src/a.ts#aaa` 函数体内没有可突变点 —— 旧口径先切片 ⇒ 它白吃 1/N
  const noMut = mkCand('a-book', 'src/a.ts', 'aaa', 'n0', 'semantic', []);
  const c1 = mkCand('a-book', 'src/b.ts', 'one', 'n1');
  const c2 = mkCand('a-book', 'src/c.ts', 'two', 'n2');
  const sel = MUT.selectSamples([noMut, c1, c2], { n: 1 });
  assert.deepEqual(idsOf(sel), [idOf(c1)], '额度被"没有可突变点"的候选吃掉了');
  assert.equal(sel.noMutant.length, 1);
  assert.equal(sel.notSelected, 1);
  assert.deepEqual(naiveSelect([noMut, c1, c2], 1).map(idOf), [idOf(noMut)], '反例失效：旧口径没吃掉额度？');

  // (b) 豁免：账内 id 被跳过，且**如实计数**（不静默）
  const weak = mkCand('book', 'src/s.ts', 'weak', 'n1');
  const ok = mkCand('book', 'src/t.ts', 'ok', 'n2');
  const weakId = idOf(weak);
  const off = MUT.selectSamples([weak, ok], { n: 5 });
  assert.deepEqual(idsOf(off), [weakId, idOf(ok)], '没有账时它就该在样本里（这条保证"豁免"不是空的）');
  assert.equal(off.baselined.length, 0);

  const ledger = new Map([[weakId, { id: weakId, why: '判据没有覆盖这一支' }]]);
  const on = MUT.selectSamples([weak, ok], { n: 5, baseline: ledger });
  assert.deepEqual(idsOf(on), [idOf(ok)]);
  assert.equal(on.baselined.length, 1);
  assert.equal(on.baselined[0].id, weakId);
  assert.equal(on.baselined[0].why, '判据没有覆盖这一支', '豁免必须带 why（否则没人知道为什么放过它）');

  // (c) `--only` 是人点名的格 ⇒ 绕过豁免（不许给一个"什么都没量"的结果）
  const only = MUT.selectSamples([weak], { n: 5, only: 'src/s.ts#weak', baseline: ledger });
  assert.deepEqual(idsOf(only), [weakId]);
  assert.equal(only.baselined.length, 0);
});

test('④ 账坏掉必须抛（不许静默当空账）；缺文件才是空账', () => {
  const mkRoot = (body: string | null): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mdet-baseline-'));
    if (body !== null) {
      fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(d, MUT.SURVIVORS_BASELINE), body, 'utf8');
    }
    return d;
  };
  const roots: string[] = [];
  try {
    const r1 = mkRoot('{ "rows": [ { "id": "a|b|c|d" } ] }');
    roots.push(r1);
    assert.throws(() => MUT.loadSurvivorBaseline(r1), /没有 why/, '无 why 的行必须抛（无 why 的账 = 消红按钮）');

    const r2 = mkRoot(JSON.stringify({ rows: [{ id: 'x', why: 'a' }, { id: 'x', why: 'b' }] }));
    roots.push(r2);
    assert.throws(() => MUT.loadSurvivorBaseline(r2), /重复 id/);

    const r3 = mkRoot('这不是 JSON');
    roots.push(r3);
    assert.throws(() => MUT.loadSurvivorBaseline(r3), /解析失败/);

    const r4 = mkRoot(JSON.stringify({ rows: 'nope' }));
    roots.push(r4);
    assert.throws(() => MUT.loadSurvivorBaseline(r4), /缺 rows/);

    const r5 = mkRoot(null); // 没有账文件 ⇒ 空账（诚实：没账就没豁免）
    roots.push(r5);
    const empty = MUT.loadSurvivorBaseline(r5);
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.missing, true);

    const r6 = mkRoot(JSON.stringify({ rows: [{ id: 'x|y|z|behavior-cases', why: '因为这一支没用例' }] }));
    roots.push(r6);
    const one = MUT.loadSurvivorBaseline(r6);
    assert.equal(one.byId.size, 1);
    assert.equal(one.byId.get('x|y|z|behavior-cases').why, '因为这一支没用例');
  } finally {
    for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('⑤ 真仓的账 ↔ 现役判据：stale 为空、每条有 why、**每条都真的顶掉了一个样本位**', async () => {
  // ★ 2026-11-18（批 15）：样本源与额度都跟着换了 —— 账内两行现在都属于 `agent-io` 册（判据搬册），
  //   而属主册候选池从 29 条判据涨到 832 条 ⇒ 两行分别落在第 6 / 第 25 位，额度要放到 40 才覆盖到。
  //   （额度 5 时账是"对的但没用上"，那是额度问题不是账的问题 —— 所以这条钉的是"在额度内生效"。）
  const live = await MUT.planMutants(ROOT, ['agent-io'], { n: 40, structural: 1 });
  assert.deepEqual(live.stale_baseline, [], `账里有对不上现役判据的 id（stale）：${JSON.stringify(live.stale_baseline)}`);
  assert.equal(live.baseline_path, MUT.SURVIVORS_BASELINE);
  assert.ok(live.baselined.length >= 1, '账里一条也没命中 ⇒ 账是装饰（要么删账，要么改 id 形态）');
  assert.equal(live.skipReasons.baselined_survivor, live.baselined.length, '豁免必须进 skipReasons（带分母，不静默）');
  assert.ok(live.baseline_rows >= live.baselined.length, `账内行数(${live.baseline_rows}) 不该少于生效行数(${live.baselined.length})`);
  for (const b of live.baselined) {
    assert.ok(String(b.why ?? '').length > 20, `豁免 ${b.id} 的 why 太短 ⇒ 挂账没点名"为什么抓不住"`);
    assert.match(String(b.file), /^src\//, `豁免的 file 必须是 src/ 下的代码：${b.file}`);
    // ★ 豁免必须**真的**顶掉了一个样本位（额度满了之后才轮到的账目对 D7 没有作用，计数会把读数吹大）
    assert.ok(Number.isInteger(b.slot) && b.slot < 40, `豁免 ${b.id} 的位次 ${b.slot} 不在本次额度内 ⇒ 它对样本没有作用`);
  }
  assert.equal(live.semSamples.length, 40, '额度没被填满 ⇒ 豁免之外还有别的东西在吃额度');

  // 反向：把账撤掉 ⇒ 至少一条账内 id 回到样本里（证明"豁免"作用在抽样上，不是只写进报告）
  const off = await MUT.planMutants(ROOT, ['agent-io'], { n: 40, structural: 1, baseline: [] });
  assert.equal(off.skipReasons.baselined_survivor, 0);
  const back = off.semSamples.map((c: any) => MUT.survivorIdOf(c));
  const returned = live.baselined.filter((b: any) => back.includes(b.id));
  assert.ok(returned.length >= 1, `撤掉账后一条都没回到样本里（账内 ${JSON.stringify(live.baselined.map((b: any) => b.id))} / 样本 ${JSON.stringify(back)}）`);
  // 撤账后样本里必然出现"账内没有"的 id，且样本仍恰好 N 条（豁免不是靠少抽样实现的）
  assert.equal(off.semSamples.length, 40);
});

test('⑥ 账的 id 形态 = `册|文件|符号|kind[|target]`（同 write-log-baseline 的竖线口径）', () => {
  assert.equal(MUT.survivorIdOf(mkCand('book', 'src/a.ts', 'f')), 'book|src/a.ts|f|behavior-cases');
  const ce = { ...mkCand('book', 'src/a.ts', 'f'), kind: 'call-exists', target: 'g', class: 'structural' };
  assert.equal(MUT.survivorIdOf(ce), 'book|src/a.ts|f|call-exists|g', 'call-exists 同一符号多条 ⇒ target 必须进键');
});

test('⑦ 账里对不上现役判据的 id ⇒ stale 点名（账不许变成永久免死牌）', async () => {
  const ghost = {
    id: 'task-system-plan|src/domain/不存在的文件.ts|ghostSymbol|behavior-cases',
    why: '注入的幽灵行（用来证明 stale 检测在岗）',
  };
  const p = await MUT.planMutants(ROOT, ['task-system-plan'], { n: 3, structural: 1, baseline: [ghost] });
  assert.deepEqual(p.stale_baseline, [ghost.id], 'stale 没点名 ⇒ 账里过期的行永远不会被人发现');
  assert.equal(p.baselined.length, 0, '幽灵行不该顶掉任何样本位');

  // 账是**按册**判 stale 的：别的册的行不该因为本书没扫到就被点名（否则单册跑一律噪声）
  const other = { id: 'some-other-book|src/domain/diff_scope.ts|rebasePath|behavior-cases', why: '别册的行' };
  const q = await MUT.planMutants(ROOT, ['task-system-plan'], { n: 3, structural: 1, baseline: [ghost, other] });
  assert.deepEqual(q.stale_baseline, [ghost.id], '别册的账行被误判成 stale ⇒ 单册跑会天天报噪声');
});
