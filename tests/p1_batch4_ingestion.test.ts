/**
 * touches: src/application/ingestion/provenance.ts, record.ts, roads.ts, store.ts, candidates.ts
 *
 * 批 4 · ingestion 最小垂直切片聚焦测试：
 * ① 九态转移边表；② committed 闸拒非 adjudicated；③ 两路降级非绿（语义路阻断 / 非语义路可见化）；
 * ④ provenance 必填；⑤ 单写者；⑥ 四候选受闸吸收断言 + 二期观察 blocked + 候选 8 移出。
 *
 * 口径：只跑本聚焦子集；全量留收口一次。夹具在进程内内存态，不写主仓 docs / DSL / DB。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFECYCLE_STATES,
  canTransition,
  assertCommittable,
} from '../src/application/docs_view/lifecycle.js';
import {
  evaluateRoad,
  SEMANTIC_STEPS,
  NONSEMANTIC_STEPS,
} from '../src/application/ingestion/roads.js';
import { IngestionStore, verifyRecordsFingerprints, type SemanticPort } from '../src/application/ingestion/store.js';
import type { Provenance, Adjudication } from '../src/application/ingestion/provenance.js';
import { verifyRowFingerprint } from '../src/application/ingestion/provenance.js';
import type { AbsorbedPayload } from '../src/application/ingestion/record.js';
import {
  buildBatch4Store,
  ADOPTED_IDS,
  OBSERVATION_IDS,
  EXCLUDED_CANDIDATES,
  BATCH4_WRITER,
  FAILURE_ORIGINS,
  FAILURE_ORIGIN_EXTENSIONS,
  CONTENT_PLACEBO_ABLATION,
  INCSEL_ABLATION,
} from '../src/application/ingestion/candidates.js';
const NOW = '2026-11-23T00:00:00.000Z';
const WRITER = 'engine:test';

function prov(over: Partial<Provenance> = {}): Provenance {
  return {
    source_kind: '外部散文',
    source_ref: 'https://example.test/candidate-x',
    captured_at: NOW,
    writer: WRITER,
    raw: '逐字原文片段，不去格式不 unescape。',
    model: null,
    ...over,
  };
}

function adjudication(over: Partial<Adjudication> = {}): Adjudication {
  return {
    ruling_at: NOW,
    ruling_by: 'Main',
    ruling_ref: 'Main 2026-11-23 裁决口径（测试夹具）',
    basis: ['https://example.test/one-hand-source'],
    note: '测试裁决回执',
    ...over,
  };
}

function payload(over: Partial<AbsorbedPayload> = {}): AbsorbedPayload {
  return {
    claim: '测试候选主张',
    absorbed_as: '测试落位形状',
    alignment_anchors: ['src/domain/rate.ts#rateOf'],
    boundary_notes: [],
    blocked_points: [],
    ...over,
  };
}

function makeStore(): IngestionStore {
  return new IngestionStore(WRITER, { now: () => NOW });
}

const okPort: SemanticPort = {
  available: true,
  translate: async () => ({ claim: '模型产出的结构化候选' }),
};

test('① 九态：状态集与边表对齐冻结企划 §2.2', () => {
  assert.deepEqual([...LIFECYCLE_STATES], [
    'ingested', 'parsed', 'translated', 'blocked', 'adjudicated',
    'committed', 'projected', 'stale', 'archived',
  ]);
  // 关键边：adjudicated → committed 唯一落权威入口
  assert.equal(canTransition('adjudicated', 'committed'), true);
  // 不可判态不得直落 committed
  for (const s of ['ingested', 'parsed', 'translated', 'blocked', 'projected', 'stale', 'archived']) {
    assert.equal(canTransition(s, 'committed'), false, `${s} → committed 必须被边表拒绝`);
  }
  const gate = assertCommittable('adjudicated');
  assert.equal(gate.ok, true);
  for (const s of ['blocked', 'translated', 'parsed', 'ingested']) {
    assert.equal(assertCommittable(s).ok, false, `assertCommittable(${s}) 必须拒`);
  }
});

test('② committed 闸：非 adjudicated 一律拒；happy path 走完九态前段', async () => {
  const store = makeStore();
  let rec = store.register({ id: 't-gate', category: 'fact', payload: payload(), provenance: prov() });

  // ingested 直落 committed 被拒
  assert.throws(() => store.commit(rec.id, WRITER), /committed 闸拒绝/);

  rec = store.parse(rec.id, '结构校验通过', WRITER);
  // parsed 落 committed 被拒
  assert.throws(() => store.commit(rec.id, WRITER), /committed 闸拒绝/);

  rec = await store.runSemanticStep(rec.id, 'pivot-translate', okPort, WRITER);
  assert.equal(rec.state, 'translated');
  // translated 落 committed 被拒（未裁决）
  assert.throws(() => store.commit(rec.id, WRITER), /committed 闸拒绝/);

  rec = store.adjudicate(rec.id, adjudication(), WRITER);
  assert.equal(rec.state, 'adjudicated');
  rec = store.commit(rec.id, WRITER);
  assert.equal(rec.state, 'committed');
  // 轨迹留痕：每次迁移一条事件
  assert.ok(rec.trace.some((e) => e.from === 'adjudicated' && e.to === 'committed'));
});

test('③ 降级非绿：语义路缺模型/失败/空候选 ⇒ blocked；非语义路缺外设 ⇒ 降级可见化', async () => {
  const store = makeStore();

  // 语义路：端口缺席
  const absentPort: SemanticPort = { available: false, translate: async () => ({ claim: '' }) };
  let r1 = store.register({ id: 't-sem-absent', category: 'fact', payload: payload(), provenance: prov() });
  r1 = store.parse(r1.id, '结构校验', WRITER);
  r1 = await store.runSemanticStep(r1.id, 'narrative-extraction', absentPort, WRITER);
  assert.equal(r1.state, 'blocked');
  assert.match(r1.trace[r1.trace.length - 1].reason, /不 Noop 降级成功|不产候选/);

  // 语义路：调用抛错
  const throwPort: SemanticPort = {
    available: true,
    translate: async () => { throw new Error('502 模型不可用'); },
  };
  let r2 = store.register({ id: 't-sem-throw', category: 'fact', payload: payload(), provenance: prov() });
  r2 = store.parse(r2.id, '结构校验', WRITER);
  r2 = await store.runSemanticStep(r2.id, 'schema-candidate-gen', throwPort, WRITER);
  assert.equal(r2.state, 'blocked');

  // 语义路：空候选（解析失败）不得原文兜底
  const emptyPort: SemanticPort = { available: true, translate: async () => ({ claim: '  ' }) };
  let r3 = store.register({ id: 't-sem-empty', category: 'fact', payload: payload(), provenance: prov() });
  r3 = store.parse(r3.id, '结构校验', WRITER);
  r3 = await store.runSemanticStep(r3.id, 'semantic-review', emptyPort, WRITER);
  assert.equal(r3.state, 'blocked');

  // 非语义路：缺外设 ⇒ 降级留痕，生命周期态不变，理由可见
  let r4 = store.register({ id: 't-nonsem', category: 'fact', payload: payload(), provenance: prov() });
  r4 = store.recordNonsemanticStep(r4.id, 'rerank', false, WRITER);
  assert.equal(r4.state, 'ingested');
  assert.equal(r4.degradations.length, 1);
  assert.equal(r4.degradations[0].outcome, 'degraded-visible');
  assert.match(r4.degradations[0].reason, /降级可见化/);

  // 路别口径：语义路降级 ≠ 可见化降级；非语义路不阻断语义态
  const sem = evaluateRoad('pivot-translate', false);
  assert.equal(sem.outcome, 'blocked');
  assert.equal(sem.degraded, false);
  const non = evaluateRoad('heat-decay', false);
  assert.equal(non.outcome, 'degraded-visible');
  assert.equal(non.degraded, true);
  assert.ok(SEMANTIC_STEPS.length > 0 && NONSEMANTIC_STEPS.length > 0);
});

test('④ provenance 必填：缺字段拒登记；committed 缺裁决回执拒落位', () => {
  const store = makeStore();
  assert.throws(
    () => store.register({ id: 't-no-ref', category: 'fact', payload: payload(), provenance: prov({ source_ref: '' }) }),
    /source_ref/,
  );
  assert.throws(
    () => store.register({ id: 't-no-raw', category: 'fact', payload: payload(), provenance: prov({ raw: '' }) }),
    /raw/,
  );

  // 裁决回执缺一手依据 ⇒ adjudicate 拒
  const r = store.register({ id: 't-no-adj', category: 'fact', payload: payload(), provenance: prov() });
  assert.throws(
    () => store.adjudicate(r.id, adjudication({ basis: [] }), WRITER),
    /basis/,
  );
});

test('⑤ 单写者：封写者之外的身份迁移 / 落位一律拒；空写者构造拒', () => {
  assert.throws(() => new IngestionStore('   '), /写者身份为空/);
  const store = makeStore();
  const r = store.register({ id: 't-writer', category: 'fact', payload: payload(), provenance: prov() });
  assert.throws(() => store.parse(r.id, '越权迁移', 'engine:other'), /单写者闸/);
  assert.throws(() => store.commit(r.id, 'engine:other'), /单写者闸/);
  assert.equal(store.getWriter(), WRITER);
});

test('⑥ 四候选受闸吸收：committed + 裁决回执 + 一手 URL；口径边界逐条在册', () => {
  const store = buildBatch4Store();
  const byId = new Map(store.list().map((r) => [r.id, r]));

  for (const id of ADOPTED_IDS) {
    const rec = byId.get(id);
    assert.ok(rec, `${id} 应在册`);
    assert.equal(rec.state, 'committed', `${id} 应落 committed`);
    assert.equal(rec.provenance.adjudication?.ruling_by, 'Main');
    assert.match(rec.provenance.adjudication?.ruling_ref ?? '', /2026-11-23/);
    assert.ok(rec.provenance.adjudication!.basis.length > 0, `${id} 裁决依据逐条点名`);
    assert.ok(rec.provenance.raw.length > 0, `${id} raw 逐字保留`);
    assert.ok(rec.trace.some((e) => e.from === 'adjudicated' && e.to === 'committed'));
  }

  // 候选 1：不恢复 superseded 状态；对齐现役关系列 / 墓碑 / active 过滤
  const c1 = byId.get('batch4-cand-1')!;
  assert.match(c1.payload.absorbed_as, /superseded_by|关系列/);
  assert.match(c1.payload.claim, /墓碑|过滤/);
  assert.ok(c1.payload.boundary_notes.join('\n').includes('不是状态') ||
    c1.payload.alignment_anchors.join('\n').includes('RETIRED.md'));

  // 候选 2：枚举四值在册；harness/unknown 标注为扩展；噪声不混能力分
  const c2 = byId.get('batch4-cand-2')!;
  assert.deepEqual([...FAILURE_ORIGINS], ['agent', 'infra', 'harness', 'unknown']);
  assert.deepEqual([...FAILURE_ORIGIN_EXTENSIONS], ['harness', 'unknown']);
  for (const v of FAILURE_ORIGINS) {
    assert.match(c2.payload.absorbed_as, new RegExp(v));
  }
  assert.match(c2.payload.boundary_notes.join('\n'), /harness、unknown.*扩展|AgentIO 扩展/);
  assert.match(c2.payload.boundary_notes.join('\n'), /不进模型能力分|不与模型能力分混算/);

  // 候选 5：命名 content_placebo_ablation，与 incsel_ablation 严格区分
  const c5 = byId.get('batch4-cand-5')!;
  assert.equal(CONTENT_PLACEBO_ABLATION, 'content_placebo_ablation');
  assert.notEqual(CONTENT_PLACEBO_ABLATION, INCSEL_ABLATION);
  assert.match(c5.payload.absorbed_as, /content_placebo_ablation/);
  assert.match(c5.payload.alignment_anchors.join('\n'), /incsel_ablation/);

  // 候选 6：双口径 + 失败判据 id 清单；失实数字不进 claim；走现役 rateOf
  const c6 = byId.get('batch4-cand-6')!;
  assert.match(c6.payload.claim, /criteria_pass_rate/);
  assert.match(c6.payload.claim, /all_criteria_pass/);
  assert.match(c6.payload.absorbed_as, /rateOf/);
  // 失实数字只允许出现在 boundary_notes 的「剔除留痕」里，不得进吸收正文（claim / absorbed_as）
  const absorbedText = c6.payload.claim + c6.payload.absorbed_as;
  for (const bad of ['92%', '73%', '63 轮', '11 套']) {
    assert.ok(!absorbedText.includes(bad), `候选 6 吸收正文不得含失实数字 ${bad}`);
  }
  assert.match(c6.payload.boundary_notes.join('\n'), /失实数字/);
});

test('⑦ 二期观察 3/4/7 保持 blocked 且带 blocked 点；候选 8 移出不在册', () => {
  const store = buildBatch4Store();
  const byId = new Map(store.list().map((r) => [r.id, r]));

  for (const id of OBSERVATION_IDS) {
    const rec = byId.get(id);
    assert.ok(rec, `${id} 应登记为观察条目`);
    assert.equal(rec.state, 'blocked', `${id} 保持 blocked`);
    assert.ok(rec.payload.blocked_points.length > 0, `${id} blocked 点逐条在册`);
    assert.ok(rec.provenance.adjudication === undefined, `${id} 未裁决，不得带 adjudication`);
  }

  // 候选 4：heartbeat 是翻译假设，不得写成已实现字段
  const c4 = byId.get('batch4-cand-4')!;
  assert.match(c4.payload.boundary_notes.join('\n'), /heartbeat.*翻译假设|翻译假设/);

  // 候选 8：移出批 4，不进记录册
  assert.equal(byId.has('batch4-cand-8'), false);
  assert.equal(EXCLUDED_CANDIDATES[0].id, 'batch4-cand-8');
  assert.match(EXCLUDED_CANDIDATES[0].reason, /动作级权限企划/);
});

test('⑧ 写者署名与登记册写者一致；行指纹非空', () => {
  const store = buildBatch4Store();
  for (const rec of store.list()) {
    assert.equal(rec.provenance.writer, BATCH4_WRITER);
    assert.ok(rec.row_fingerprint.length > 0);
  }
});

test('⑨ 行指纹读端：在册记录重算比对通过；字段漂移后失配 fail-closed 点名（C14 · O2）', () => {
  const store = makeStore();
  const r = store.register({ id: 't-fp', category: 'fact', payload: payload(), provenance: prov() });

  // 读端闸：在册记录落账指纹与重算一致 ⇒ ok，recorded == recomputed
  const okCheck = store.verifyFingerprint(r.id);
  assert.equal(okCheck.ok, true, okCheck.reasons.join('；'));
  assert.equal(okCheck.recorded, okCheck.recomputed);
  const all = store.verifyAllFingerprints();
  assert.equal(all.ok, true, all.reasons.join('；'));

  // 纯函数层：稳定字段被改（claim 漂移）⇒ 重算值变，比对红且逐条点名
  const bad = verifyRowFingerprint({
    provenance: r.provenance,
    claim: '被手改的主张',
    absorbed_as: r.payload.absorbed_as,
    row_fingerprint: r.row_fingerprint,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.some((x) => x.includes('行指纹不符')));
  assert.notEqual(bad.recorded, bad.recomputed);

  // 空落账指纹 ⇒ 同样红（未落账不算接线）
  const empty = verifyRowFingerprint({
    provenance: r.provenance,
    claim: r.payload.claim,
    absorbed_as: r.payload.absorbed_as,
    row_fingerprint: '',
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.reasons.some((x) => x.includes('row_fingerprint 为空')));
});

test('⑩ H-a · 批量对账出口：纯函数按记录集对账，失配 id 进 failed_ids 一等清单；verifyAll 委托同口径', () => {
  const store = makeStore();
  const okRec = store.register({ id: 't-fp-ok', category: 'fact', payload: payload(), provenance: prov() });

  // 一致记录集 ⇒ ok=true，分母 checked=1，failed_ids 空
  const good = verifyRecordsFingerprints(store.list());
  assert.equal(good.ok, true, good.reasons.join('；'));
  assert.equal(good.checked, 1);
  assert.deepEqual(good.failed_ids, []);

  // 一条记录稳定字段被改（claim 漂移）⇒ 纯函数 ok=false，failed_ids 点名该 id
  const mutated: typeof okRec = { ...okRec, payload: { ...okRec.payload, claim: '被手改的主张' } };
  const bad = verifyRecordsFingerprints([mutated]);
  assert.equal(bad.ok, false);
  assert.equal(bad.checked, 1);
  assert.deepEqual(bad.failed_ids, ['t-fp-ok']);
  assert.ok(bad.reasons.some((x) => x.includes('t-fp-ok') && x.includes('行指纹不符')));

  // 实例方法委托同一纯函数：一致 ⇒ ok，failed_ids 空
  const all = store.verifyAllFingerprints();
  assert.equal(all.ok, true, all.reasons.join('；'));
  assert.deepEqual(all.failed_ids, []);
});
