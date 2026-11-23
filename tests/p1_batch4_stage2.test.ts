/**
 * touches: scripts/mutate.mjs, src/application/ingestion/{spec_views,failure_origin,ablation_scope,acceptance_metrics}.ts,
 *          src/domain/rate.ts（注册两条验收率问题）
 *
 * 批 4 · 阶段 2 聚焦测试：
 * A 门 15 复发根治反向夹具：变异 + 旧口径还原（只还字节/mtime）⇒ 索引行陈旧（红）；
 *   走现役索引写端失效重同步后 ⇒ 行与磁盘事实一致（trusted）。
 * B 四候选只读消费接线：
 *   C1 active/archived 分层 + 取代指针解析（悬空 → unsupported，不恢复 superseded 状态）；
 *   C2 failure_origin 枚举 / unknown 拒 pass / judge_noise pending 不混能力分；
 *   C5 content_placebo_ablation 一期范围 + 二期边界登记 + 与 incsel_ablation 分名；
 *   C6 双口径（criteria_pass_rate / all_criteria_pass）+ failed_criteria_ids 一等清单 + MUST 严格 / SHOULD 分期。
 *
 * 口径：只跑本聚焦子集；全量留收口一次。A 夹具在临时目录内自建 cache.db，不写主仓索引。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mutate.mjs')).href);

import {
  getProjectCacheDb,
  projectCacheDbPath,
  closeProjectCacheDb,
} from '../src/infrastructure/index/db.js';
// 索引写端经 dist 加载（与 mutate.mjs 同一 pool 实例）；收尾需同 pool 释放句柄，避免 Windows EBUSY。
const distDb = await import('../dist/src/infrastructure/index/db.js');
import { syncFile } from '../src/infrastructure/index/symbols.js';

import { activeInjectionRecords, archivedEvidenceRecords, resolveSupersededPointer } from '../src/application/ingestion/spec_views.js';
import {
  verdictWithOrigin,
  recordJudgeNoise,
  isFailureOrigin,
  isExtensionOrigin,
  FAILURE_ORIGIN_PROVENANCE_NOTE,
} from '../src/application/ingestion/failure_origin.js';
import {
  classifyAblation,
  PLACEBO_PHASE1_SCOPE,
  PLACEBO_PHASE2_BOUNDARY,
} from '../src/application/ingestion/ablation_scope.js';
import { evaluateAcceptance } from '../src/application/ingestion/acceptance_metrics.js';
import { buildBatch4Store, INCSEL_ABLATION, CONTENT_PLACEBO_ABLATION } from '../src/application/ingestion/candidates.js';
import { IngestionStore, type SemanticPort } from '../src/application/ingestion/store.js';
import type { Provenance, Adjudication } from '../src/application/ingestion/provenance.js';
import type { AbsorbedPayload } from '../src/application/ingestion/record.js';

const NOW = '2026-11-23T00:00:00.000Z';
const WRITER = 'engine:test-stage2';

function prov(over: Partial<Provenance> = {}): Provenance {
  return {
    source_kind: '外部散文',
    source_ref: 'https://example.test/stage2',
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
    ruling_ref: 'Main 2026-11-23 阶段 2 裁决口径（测试夹具）',
    basis: ['https://example.test/one-hand-source'],
    note: '测试裁决回执',
    ...over,
  };
}

function payload(over: Partial<AbsorbedPayload> = {}): AbsorbedPayload {
  return {
    claim: '测试候选主张',
    absorbed_as: '测试落位形状',
    alignment_anchors: [],
    boundary_notes: [],
    blocked_points: [],
    ...over,
  };
}

const okPort: SemanticPort = {
  available: true,
  translate: async () => ({ claim: '模型产出的结构化候选' }),
};

async function commitRecord(store: IngestionStore, id: string): Promise<ReturnType<IngestionStore['get']>> {
  let r = store.register({ id, category: 'fact', payload: payload(), provenance: prov() });
  r = store.parse(r.id, '结构校验', WRITER);
  r = await store.runSemanticStep(r.id, 'pivot-translate', okPort, WRITER);
  r = store.adjudicate(r.id, adjudication(), WRITER);
  return store.commit(r.id, WRITER);
}

// ════════════════════════════════════════════════════════════════════════
// A · 门 15 反向突变夹具：还原后索引行必须与磁盘事实一致
// ════════════════════════════════════════════════════════════════════════
const ORIGINAL = 'export const stage2Fixture = 42;\n';
const MUTATED = 'export const stage2Fixture = 0;\n';

function rowStat(db: ReturnType<typeof getProjectCacheDb>, rel: string) {
  return db.prepare('SELECT size, modified_at FROM files WHERE path = $p').get({ p: rel }) as
    | { size: number; modified_at: number }
    | undefined;
}

test('A1 反向夹具：旧口径还原（只还字节 + mtime）后索引行仍陈旧（红，能抓住回归）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch4-stage2-a-'));
  const rel = 'src/fixture.ts';
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ORIGINAL, 'utf8');

  try {
    const db = getProjectCacheDb(tmp);
    const first = await syncFile(db, tmp, abs);
    assert.equal(first.status, 'updated', '原始文件应能入索引');

    // 模拟测量窗口：变异写盘 → 按需索引同步把行事实记成变异时刻
    fs.writeFileSync(abs, MUTATED, 'utf8');
    const mutated = await syncFile(db, tmp, abs);
    assert.equal(mutated.status, 'updated');

    // 旧口径还原：只写回字节 + utimes 回写 mtime，不回写索引行（门 15 病史）
    const st0 = fs.statSync(abs);
    fs.writeFileSync(abs, ORIGINAL, 'utf8');
    fs.utimesSync(abs, st0.atimeMs / 1000, st0.mtimeMs / 1000);

    const row = rowStat(db, rel);
    assert.ok(row, '索引行应存在');
    const cur = fs.statSync(abs);
    const stale = row.size !== cur.size || row.modified_at !== Math.round(cur.mtimeMs);
    assert.equal(stale, true, '旧口径还原后行事实必须仍陈旧（否则夹具抓不住回归）');
  } finally {
    closeProjectCacheDb(tmp);
    distDb.closeProjectCacheDb(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('A2 根治：还原后失效重同步 ⇒ 行与磁盘 stat 一致（trusted）；无库跳过不造第二权威', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch4-stage2-a-'));
  const rel = 'src/fixture.ts';
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ORIGINAL, 'utf8');

  try {
    const db = getProjectCacheDb(tmp);
    await syncFile(db, tmp, abs);
    fs.writeFileSync(abs, MUTATED, 'utf8');
    await syncFile(db, tmp, abs);

    // 还原字节 + mtime
    const st0 = fs.statSync(abs);
    fs.writeFileSync(abs, ORIGINAL, 'utf8');
    fs.utimesSync(abs, st0.atimeMs / 1000, st0.mtimeMs / 1000);

    // 根治路径：失效旧行 → 从磁盘事实重同步（现役索引写端）
    const rs = await M.resyncRestoredIndex(tmp, abs);
    assert.equal(rs.status, 'resynced', `重同步应成功：${JSON.stringify(rs)}`);

    const row = rowStat(db, rel);
    assert.ok(row, '重同步后行应存在');
    const cur = fs.statSync(abs);
    assert.equal(row.size, cur.size, 'size 必须与磁盘一致');
    assert.equal(row.modified_at, Math.round(cur.mtimeMs), 'modified_at 必须与磁盘 mtime 一致');
  } finally {
    closeProjectCacheDb(tmp);
    distDb.closeProjectCacheDb(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 无 cache.db 的项目：跳过（门 15 不计未索引文件），不造空库行
  const tmpNoDb = fs.mkdtempSync(path.join(os.tmpdir(), 'batch4-stage2-nodb-'));
  try {
    const abs2 = path.join(tmpNoDb, 'src/x.ts');
    fs.mkdirSync(path.dirname(abs2), { recursive: true });
    fs.writeFileSync(abs2, ORIGINAL, 'utf8');
    const rs = await M.resyncRestoredIndex(tmpNoDb, abs2);
    assert.equal(rs.status, 'no-db');
    assert.equal(fs.existsSync(projectCacheDbPath(tmpNoDb)), false, 'no-db 跳过不得自建库');
  } finally {
    fs.rmSync(tmpNoDb, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════════
// C1 · active/archived 分层 + 取代指针解析
// ════════════════════════════════════════════════════════════════════════
test('C1 分层：committed/projected 进判据/上下文注入；archived 只证据检索；blocked 不进注入', async () => {
  const store = new IngestionStore(WRITER, { now: () => NOW });
  const c1 = await commitRecord(store, 'spec-active-1');
  const c2 = await commitRecord(store, 'spec-active-2');
  const archived = store.archive(c2!.id, '退役归档（墓碑）', WRITER);
  const blocked = store.register({ id: 'spec-blocked', category: 'fact', payload: payload(), provenance: prov() });

  const injection = activeInjectionRecords(store.list());
  const evidence = archivedEvidenceRecords(store.list());

  assert.deepEqual(injection.map((r) => r.id), [c1!.id], '只有 committed/projected 进注入');
  assert.deepEqual(evidence.map((r) => r.id), [archived.id], 'archived 只进证据检索');
  assert.equal(injection.some((r) => r.id === blocked.id), false, 'blocked 不进注入');
});

test('C1 取代指针：可解析 → resolved；悬空 → unsupported（不静默忽略）；无指针 → none；不改状态', () => {
  const subjects = [
    { id: 'spec-old', superseded_by: 'spec-new' },
    { id: 'spec-new', superseded_by: null },
    { id: 'spec-dangling', superseded_by: 'spec-ghost' },
    { id: 'spec-no-pointer' },
  ];

  const resolved = resolveSupersededPointer(subjects[0], subjects);
  assert.equal(resolved.kind, 'resolved');
  assert.equal(resolved.target?.id, 'spec-new');
  assert.equal(resolved.verdict, null);

  const dangling = resolveSupersededPointer(subjects[2], subjects);
  assert.equal(dangling.kind, 'dangling');
  assert.equal(dangling.verdict, 'unsupported');
  assert.match(dangling.why, /悬空/);

  const none = resolveSupersededPointer(subjects[3], subjects);
  assert.equal(none.kind, 'none');

  // 取代是关系不是状态：解析结果不改写任何主体的生命周期状态
  assert.deepEqual(
    subjects.map((s) => s.superseded_by),
    ['spec-new', null, 'spec-ghost', undefined],
  );
});

// ════════════════════════════════════════════════════════════════════════
// C2 · failure_origin 归因口径
// ════════════════════════════════════════════════════════════════════════
test('C2 枚举闭集 + 扩展注明；unknown 不得 pass；表外归因抛错不静默归类', () => {
  assert.deepEqual([...new Set(['agent', 'infra', 'harness', 'unknown'].filter(isFailureOrigin))], [
    'agent', 'infra', 'harness', 'unknown',
  ]);
  assert.equal(isExtensionOrigin('harness'), true);
  assert.equal(isExtensionOrigin('unknown'), true);
  assert.equal(isExtensionOrigin('agent'), false);
  assert.match(FAILURE_ORIGIN_PROVENANCE_NOTE, /harness\/unknown.*扩展/);

  // unknown + 原判 pass ⇒ 退 unsupported（判不了 ≠ 通过）
  assert.equal(verdictWithOrigin('unknown', 'pass'), 'unsupported');
  // unknown + 非 pass 原样穿过
  assert.equal(verdictWithOrigin('unknown', 'fail'), 'fail');
  assert.equal(verdictWithOrigin('unknown', 'pending'), 'pending');
  // 其余归因四值原样穿过
  assert.equal(verdictWithOrigin('agent', 'pass'), 'pass');
  assert.equal(verdictWithOrigin('infra', 'fail'), 'fail');
  assert.equal(verdictWithOrigin('harness', 'unsupported'), 'unsupported');

  assert.throws(() => verdictWithOrigin('model', 'pass'), /不在闭集/);
});

test('C2 judge_noise：记录为校准信号，不混能力分；阈值未实验 ⇒ pending（不自造阈值）', () => {
  const noise = recordJudgeNoise();
  assert.equal(noise.recorded, true);
  assert.equal(noise.mixed_into_capability_score, false);
  assert.equal(noise.threshold, 'pending');
});

// ════════════════════════════════════════════════════════════════════════
// C5 · 安慰剂消融范围与分名
// ════════════════════════════════════════════════════════════════════════
test('C5 一期范围 = DSL/判据/提示注入；二期边界登记不施工；与 incsel 严格分名', () => {
  const placebo = classifyAblation(CONTENT_PLACEBO_ABLATION);
  assert.equal(placebo.kind, 'content-placebo');
  assert.deepEqual([...(placebo.phase1_scope ?? [])], [...PLACEBO_PHASE1_SCOPE]);
  assert.deepEqual([...(placebo.phase2_boundary ?? [])], [...PLACEBO_PHASE2_BOUNDARY]);
  assert.deepEqual([...PLACEBO_PHASE1_SCOPE], ['dsl', 'criteria', 'prompt-injection']);
  assert.deepEqual([...PLACEBO_PHASE2_BOUNDARY], ['long-session', 'multi-turn']);

  const incsel = classifyAblation(INCSEL_ABLATION);
  assert.equal(incsel.kind, 'incsel');
  assert.equal(incsel.phase1_scope, null);
  assert.notEqual(CONTENT_PLACEBO_ABLATION, INCSEL_ABLATION);

  const unknown = classifyAblation('something-else-ablation');
  assert.equal(unknown.kind, 'unknown');
});

// ════════════════════════════════════════════════════════════════════════
// C6 · 验收双口径 + 失败清单 + MUST 严格 / SHOULD 分期
// ════════════════════════════════════════════════════════════════════════
test('C6 双口径：宽松均分率并列 MUST 严格通过；失败判据 id 一等清单；SHOULD 分期不进严格口径', () => {
  const items = [
    { id: 'm1', verdict: 'pass' as const, tier: 'MUST' as const },
    { id: 'm2', verdict: 'fail' as const, tier: 'MUST' as const },
    { id: 's1', verdict: 'fail' as const, tier: 'SHOULD' as const },
    { id: 's2', verdict: 'pass' as const, tier: 'SHOULD' as const },
  ];
  const m = evaluateAcceptance(items);

  assert.equal(m.total, 4);
  assert.equal(m.passed, 2);
  assert.deepEqual([...m.failed_criteria_ids], ['m2', 's1']);

  // 宽松口径：MUST/SHOULD 都计入（2/4）
  assert.equal(m.criteria_pass_rate.n, 2);
  assert.equal(m.criteria_pass_rate.d, 4);
  assert.match(m.criteria_pass_rate.text, /2\/4/);

  // 严格口径：只数 MUST；m2 非 pass ⇒ all_criteria_pass = false
  assert.equal(m.must.total, 2);
  assert.equal(m.must.passed, 1);
  assert.equal(m.must.all_criteria_pass, false);
  assert.equal(m.must.rate.n, 1);
  assert.equal(m.must.rate.d, 2);

  // SHOULD 分期登记，不强制
  assert.equal(m.should.total, 2);
  assert.equal(m.should.phased, true);
});

test('C6 MUST 全过 ⇒ 严格通过；SHOULD 有非 pass 不影响 all_criteria_pass', () => {
  const items = [
    { id: 'm1', verdict: 'pass' as const, tier: 'MUST' as const },
    { id: 's1', verdict: 'fail' as const, tier: 'SHOULD' as const },
  ];
  const m = evaluateAcceptance(items);
  assert.equal(m.must.all_criteria_pass, true, 'MUST 全过即严格通过；SHOULD 分期不强制');
  assert.equal(m.must.passed, 1);
  assert.equal(m.must.total, 1);
  assert.deepEqual([...m.failed_criteria_ids], ['s1']);
});

test('C6 空验收集：两个率都印「不算率」，不印 0.0%；失败清单为空', () => {
  const m = evaluateAcceptance([]);
  assert.equal(m.total, 0);
  assert.match(m.criteria_pass_rate.text, /0\/0/);
  assert.match(m.must.rate.text, /0\/0/);
  assert.equal(m.must.all_criteria_pass, false, '无 MUST 不构成严格通过（空集不算全过）');
  assert.deepEqual([...m.failed_criteria_ids], []);
});

test('C6 committed 档案可追溯：四候选读数与阶段 1 committed 条目在册', () => {
  const store = buildBatch4Store();
  const ids = store.list().map((r) => r.id);
  for (const id of ['batch4-cand-1', 'batch4-cand-2', 'batch4-cand-5', 'batch4-cand-6']) {
    assert.ok(ids.includes(id), `${id} 应在册（接线只读消费阶段 1 committed 条目）`);
  }
});
