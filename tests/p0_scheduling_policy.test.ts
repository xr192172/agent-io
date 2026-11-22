/**
 * ★ P0（DS-1 卡）· 影子调度**策略**：硬约束先于排序、no-op 不制造工作、预算不吃分母、计划里没有写动作。
 *
 * ## 病（改前最自然的错做法，逐条都能把它变红）
 * 1. 用"打分/confidence"混合一切 ⇒ retired 的高分建议绕过硬约束（B6/B7）。
 * 2. 交集为空 ⇒ 当成"没影响 ⇒ 可继承"（C11）。
 * 3. 空 eligible、空观察面 ⇒ 读成"零对象成功 / 通过"（B8/C12）。
 * 4. 预算不足时把未选动作从分母里删掉 ⇒ 看起来"全都处理完了"（D17）。
 * 5. 索引落后却先建议继承 / 先跑测试 ⇒ 顺序反了（D15）。
 * 6. 成本未知被当成 0 ⇒ 未知排在已知前面，或"没成本"被当成"免费"（D18）。
 * 7. 建议里混进写动作（D19）。
 *
 * ## 本证断言什么（每条都双向）
 * · 规则号是排序第一段键；同一规则内才看依赖深度/相关度/成本/字典序。
 * · `excluded` 的对象**永远**不会得到 run_test / run_judgement。
 * · 每个动作都带：缺口、证据 id、为何先做、前置/硬阻断、关闭什么、成本事实、不做的后果。
 * · `assertReadOnlyPlan` 对写类动作当场抛。
 *
 * ## 消融（★ 本文件必须能红）
 * · 去掉 `excludedIds` 过滤 ⇒ 用例「retired 不得 run_test」与「空 eligible 不是成功」红。
 * · 把排序里的 `x.rule !== y.rule` 一段删掉 ⇒ 用例「当前失败先于过期重跑」「索引前置」红。
 * · 把 `openSet` 里 deferred 的缺口删掉 ⇒ 用例「预算不吃分母」红。
 * · 把 `impact-untrusted` 映射成 no_op ⇒ 用例「影响面不可信 ⇒ 扩大验证」红。
 *
 * ## 诚实清单
 * · 成本恒为未知（首版没有任何实测耗时）⇒ 本文件只能证明"未知不当 0"，不能证明"省了多少"。
 *
 * touches: src/domain/scheduling_policy.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHADOW_ACTIONS,
  assertReadOnlyPlan,
  costRank,
  planDigest,
  planShadow,
  type ShadowPlan,
} from '../src/domain/scheduling_policy.js';
import { type EvidenceFrame, type EvidenceSignal } from '../src/domain/scheduling_evidence.js';

const signal = (over: Partial<EvidenceSignal> = {}): EvidenceSignal => ({
  id: 's1',
  kind: 'test',
  subject: { path: 'tests/a.test.ts' },
  source_ref: 'snapshot',
  scope: ['tests/a.test.ts'],
  verdict: 'pass',
  freshness: 'fresh',
  ...over,
});

function frameOf(over: Partial<EvidenceFrame> = {}): EvidenceFrame {
  return {
    project: { root: '/tmp/proj', identity: '/tmp/proj' },
    goal: { text: 'g', judgement_refs: [], scope: [] },
    content: { version: 'content-v1', files: { 'src/a.ts': 'h1' }, source_ref: 'content-version' },
    design_revisions: [{ feature: 'f', revision: 'f#1', source_ref: 'design-sheet:f' }],
    index: { state: 'usable', schema_version: 18, stale_files: 0, stale_total: 1, untrusted_refs: 0 },
    capability: { runner: 'node-test', tiers: [] },
    signals: [],
    gaps: [],
    conflicts: [],
    excluded: [],
    undetermined: [],
    limitations: [],
    ...over,
  };
}

const targets = (plan: ShadowPlan): string[] => plan.actions.map((a) => a.target);
const kinds = (plan: ShadowPlan): string[] => plan.actions.map((a) => a.action);

// ── D16：没有缺口 ⇒ 唯一 no_op ─────────────────────────────────────────────

test('① 全部新鲜且无缺口 ⇒ 唯一 no_op，不制造工作', () => {
  const plan = planShadow(frameOf({ signals: [signal()] }), { budget: 3 });
  assert.equal(plan.no_op, true);
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.open_gaps, []);
});

// ── D15：索引前置先于依赖它的动作 ─────────────────────────────────────────

test('② 索引落后 ⇒ refresh_index 先做，run_test 被显式硬阻断在前置之后', () => {
  const plan = planShadow(
    frameOf({
      index: { state: 'partial', schema_version: 18, stale_files: 2, stale_total: 10, untrusted_refs: 0 },
      gaps: [{ id: 'index:stale', kind: 'stale', subject: 'index', reason: '2/10 不一致', signals: [] }],
      signals: [signal({ freshness: 'stale', reason: 'version-mismatch' })],
    }),
    { budget: 2 },
  );
  assert.equal(plan.actions[0].action, 'refresh_index', `第一条必须是 refresh，实得 ${plan.actions[0].action}`);
  assert.equal(plan.actions[0].rule, 2);
  const rerun = plan.actions.find((a) => a.target === 'tests/a.test.ts');
  assert.ok(rerun, '过期的测试证据仍要被建议重跑（不是被删）');
  assert.ok(rerun.depends_on.includes('refresh_index::/tmp/proj'), '重跑必须声明它等索引');
  assert.ok(rerun.blocked_by.some((b) => b.startsWith('index-unusable:')), '索引未好之前这条是硬阻断，不是"可选"');
});

// ── B6 / B8：excluded 与"空 eligible" ─────────────────────────────────────

test('③ retired 对象进 excluded，永远得不到 run_test', () => {
  const plan = planShadow(
    frameOf({
      excluded: [{ id: 'tests/old.test.ts', reason: 'retired' }],
      signals: [
        signal({ id: 'design:excluded:tests/old.test.ts', kind: 'design', subject: { path: 'tests/old.test.ts' }, verdict: 'unsupported', freshness: 'fresh', reason: 'retired' }),
        signal({ id: 'test:test:tests/old.test.ts', subject: { path: 'tests/old.test.ts' }, verdict: 'fail', freshness: 'fresh' }),
      ],
    }),
    { budget: 5 },
  );
  assert.deepEqual(plan.excluded.map((e) => e.id), ['tests/old.test.ts']);
  assert.ok(!plan.actions.some((a) => a.action === 'run_test' && a.target === 'tests/old.test.ts'), 'retired 不许建议 run_test');
  assert.ok(!plan.actions.some((a) => a.action === 'run_judgement'), 'retired 不许建议 run_judgement');
});

test('④ 空 eligible 但 excluded 非空 ⇒ 不是"零对象成功"（要人判，不许 no_op）', () => {
  const plan = planShadow(
    frameOf({
      excluded: [{ id: 'tests/a.test.ts', reason: 'retired' }],
      gaps: [
        {
          id: 'eligible:empty-by-exclusion',
          kind: 'retired',
          subject: 'tests',
          reason: '全部可执行对象都被设计册判为不执行',
          signals: ['design:excluded:tests/a.test.ts'],
        },
      ],
    }),
  );
  assert.equal(plan.no_op, false, '★ 没有可验证对象 ≠ 没有缺口');
  assert.deepEqual(kinds(plan), ['ask_human']);
  assert.ok(plan.open_gaps.includes('eligible:empty-by-exclusion'));
});

test('⑤ 坏册/生命周期冲突（unjudgeable）⇒ ask_human，不执行不继承', () => {
  const plan = planShadow(
    frameOf({
      undetermined: [{ id: 'tests/a.test.ts', reason: 'conflicting-lifecycle' }],
      gaps: [{ id: 'eligibility:unjudgeable', kind: 'conflicting', subject: 'eligibility', reason: 'conflicting-lifecycle', signals: [] }],
    }),
  );
  assert.deepEqual(kinds(plan), ['ask_human']);
  assert.deepEqual(plan.undetermined.map((u) => u.id), ['tests/a.test.ts']);
});

// ── C10 / C11 / C12 ───────────────────────────────────────────────────────

test('⑥ 只改了影响 TA 的东西 ⇒ 只建议 TA；未受影响的 TB 不被建议', () => {
  const plan = planShadow(
    frameOf({
      goal: { text: 'g', judgement_refs: [], scope: ['tests'] },
      signals: [
        signal({ id: 'test:TA', subject: { path: 'tests/a.test.ts' }, verdict: 'pass', freshness: 'stale', reason: 'version-mismatch:观察面已变' }),
        signal({ id: 'test:TB', subject: { path: 'tests/b.test.ts' }, verdict: 'pass', freshness: 'fresh', reason: 'version-aligned' }),
      ],
    }),
    { budget: 3 },
  );
  assert.deepEqual(targets(plan), ['tests/a.test.ts'], `只该建议 TA，实得 ${targets(plan).join(',')}`);
});

test('⑦ 影响关系不可信 ⇒ 扩大验证（不许空交集当安全，也不许 no_op）', () => {
  const plan = planShadow(
    frameOf({
      gaps: [{ id: 'impact:untrusted', kind: 'impact-untrusted', subject: 'impact', reason: 'src/ 改动不在索引里', signals: [] }],
    }),
  );
  assert.deepEqual(kinds(plan), ['run_test']);
  assert.deepEqual(targets(plan), ['all-eligible']);
  assert.match(plan.actions[0].if_skipped, /不许当"没影响到"/);
});

test('⑧ 对象存在但无证据 ⇒ run_test（不许猜 pass，也不许 no_op）', () => {
  const plan = planShadow(
    frameOf({
      gaps: [{ id: 'missing-evidence:tests/a.test.ts', kind: 'missing-evidence', subject: 'tests/a.test.ts', reason: '基线里没有它的证据', signals: [] }],
    }),
  );
  assert.deepEqual(kinds(plan), ['run_test']);
  assert.match(plan.actions[0].if_skipped, /不许读成通过/);
});

test('⑨ 当前失败 + 两条 pass ⇒ 失败主体先被确认（rule 3 先于 rule 4）', () => {
  const plan = planShadow(
    frameOf({
      goal: { text: 'g', judgement_refs: [], scope: ['tests'] },
      signals: [
        signal({ id: 'test:fail', subject: { path: 'tests/z.test.ts' }, verdict: 'fail', freshness: 'fresh' }),
        signal({ id: 'test:s1', subject: { path: 'tests/a.test.ts' }, verdict: 'pass', freshness: 'stale', reason: 'version-mismatch' }),
        signal({ id: 'test:s2', subject: { path: 'tests/b.test.ts' }, verdict: 'pass', freshness: 'stale', reason: 'version-mismatch' }),
      ],
    }),
    { budget: 1 },
  );
  assert.deepEqual(targets(plan), ['tests/z.test.ts'], `失败必须先确认，实得 ${targets(plan).join(',')}`);
  assert.equal(plan.actions[0].rule, 3);
});

test('⑩ 两条 pass 不许压过一条当前失败（预算 3 也要把 fail 排第一）', () => {
  const plan = planShadow(
    frameOf({
      goal: { text: 'g', judgement_refs: [], scope: ['tests'] },
      signals: [
        signal({ id: 'p1', subject: { path: 'tests/a.test.ts' }, verdict: 'pass', freshness: 'fresh' }),
        signal({ id: 'p2', subject: { path: 'tests/b.test.ts' }, verdict: 'pass', freshness: 'fresh' }),
        signal({ id: 'f1', subject: { path: 'tests/z.test.ts' }, verdict: 'fail', freshness: 'fresh' }),
      ],
    }),
    { budget: 3 },
  );
  assert.equal(plan.actions[0].target, 'tests/z.test.ts');
});

// ── D17：预算不吃分母 ─────────────────────────────────────────────────────

test('⑪ 预算只够一条 ⇒ 未选的仍显式存在，缺口不从分母消失', () => {
  const plan = planShadow(
    frameOf({
      goal: { text: 'g', judgement_refs: [], scope: ['tests'] },
      signals: [
        signal({ id: 'a', subject: { path: 'tests/a.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
        signal({ id: 'b', subject: { path: 'tests/b.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
        signal({ id: 'c', subject: { path: 'tests/c.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
      ],
    }),
    { budget: 1 },
  );
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.deferred.length, 2);
  assert.ok(plan.open_gaps.includes('stale:b'), `未选动作的缺口必须留在 open_gaps：${plan.open_gaps.join(',')}`);
  assert.ok(plan.open_gaps.includes('stale:c'));
  assert.ok(plan.limitations.some((l) => /预算 1 只够给 1 条建议/.test(l)));
});

// ── D18：成本未知 ≠ 0 ────────────────────────────────────────────────────

test('⑫ 成本未知不许当 0（排序键显式分开）', () => {
  assert.deepEqual(costRank({ known: false, why: '未实测' }), [1, 0]);
  assert.deepEqual(costRank({ known: true, ms: 0 }), [0, 0], '真·零成本与未知必须落在不同组');
  const plan = planShadow(frameOf({ gaps: [{ id: 'impact:untrusted', kind: 'impact-untrusted', subject: 'impact', reason: 'r', signals: [] }] }));
  assert.equal(plan.actions[0].cost.known, false, '首版不许伪造实测成本');
  assert.ok(plan.actions[0].cost.known === false && plan.actions[0].cost.why.length > 0, '未知必须说清为什么未知');
});

test('⑬ 同输入两次规划 ⇒ 结构化逐字相同（时间戳不参与）', () => {
  const frame = frameOf({
    goal: { text: 'g', judgement_refs: [], scope: ['tests'] },
    signals: [
      signal({ id: 'a', subject: { path: 'tests/a.test.ts' }, freshness: 'stale', reason: 'version-mismatch' }),
      signal({ id: 'f', subject: { path: 'tests/z.test.ts' }, verdict: 'fail', freshness: 'fresh' }),
    ],
  });
  const one = planShadow(frame, { budget: 2 });
  const two = planShadow(frame, { budget: 2 });
  assert.equal(planDigest(one), planDigest(two));
  assert.equal(planDigest({ ...one, generated_at: '2026-01-01T00:00:00.000Z' }), planDigest(one), '显式时间戳必须被忽略');
});

// ── D19：只读 ────────────────────────────────────────────────────────────

test('⑭ 动作词表里没有任何写/完成/提交/回滚', () => {
  for (const a of SHADOW_ACTIONS) {
    assert.ok(!/^(write|complete|commit|rollback|edit|apply|publish|merge)/i.test(a), `词表混入写类动作：${a}`);
  }
  assert.ok(SHADOW_ACTIONS.includes('no_op'), 'no_op 必须是一等动作（"没缺口"要能被表达）');
});

test('⑭ 反证：混入写动作的计划必须当场抛', () => {
  const plan = planShadow(frameOf({ gaps: [{ id: 'impact:untrusted', kind: 'impact-untrusted', subject: 'impact', reason: 'r', signals: [] }] }));
  assert.doesNotThrow(() => assertReadOnlyPlan(plan));
  const bad = { ...plan, actions: [{ ...plan.actions[0], action: 'commit' as never }] };
  assert.throws(() => assertReadOnlyPlan(bad), /词表外动作/);
});

test('⑮ 形状坏的帧 ⇒ 只给 ask_human，不产生任何执行建议', () => {
  const broken = { ...frameOf(), signals: [{ ...signal(), scope: 'all' }] } as unknown as EvidenceFrame;
  const plan = planShadow(broken, { budget: 5 });
  assert.deepEqual(kinds(plan), ['ask_human']);
  assert.deepEqual(plan.open_gaps, ['frame-shape']);
  assert.ok(plan.limitations.some((l) => /证据帧形状错误/.test(l)));
});

test('⑯ 认不出 runner ⇒ run_test 降级成 ask_human（能力不支持是硬阻断）', () => {
  const plan = planShadow(
    frameOf({
      capability: { runner: null, tiers: [], reason: '没有可过滤的 runner' },
      gaps: [{ id: 'impact:untrusted', kind: 'impact-untrusted', subject: 'impact', reason: 'r', signals: [] }],
    }),
  );
  assert.deepEqual(kinds(plan), ['ask_human']);
  assert.match(plan.actions[0].why_before_others, /能力不支持/);
});

test('⑰ 冲突 ⇒ 两边都留（ask_human），不会自动融合成 pass', () => {
  const plan = planShadow(
    frameOf({
      signals: [
        signal({ id: 'snap', freshness: 'conflicting', source_ref: 'snapshot' }),
        signal({ id: 'now', verdict: 'fail', freshness: 'conflicting', source_ref: 'run' }),
      ],
      conflicts: [{ id: 'conflict:0', kind: 'conflicting', subject: 'tests/a.test.ts', reason: 'pass vs fail', signals: ['now', 'snap'] }],
      gaps: [{ id: 'conflict:0', kind: 'conflicting', subject: 'tests/a.test.ts', reason: 'pass vs fail', signals: ['now', 'snap'] }],
    }),
  );
  assert.deepEqual(kinds(plan), ['ask_human']);
  assert.deepEqual(plan.actions[0].evidence, ['now', 'snap'], '冲突两边都要出现在证据里');
});
