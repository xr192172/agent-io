/**
 * touches: src/infrastructure/analysis/facts/incsel_cron.ts, scripts/ablation-cron.mjs, scripts/verify-changed.mjs
 *
 * P1 · G-4 · G8 周期 reference run 编排 + 结构化对照台账（T-#INC-TEST-SEL 柱 4 周期化）。
 *
 * 守什么（缺一就不信）：
 *   ① 触发枚举：WIDEN / holes>0 / unknown 边新增 / 每 N 次收口提交 / 夜间空闲窗；无触发不跑；
 *   ② 轻量配额：本机 ≤20 文件、jobs ≤2，超配额 fail-closed 拒跑；full 留 CI；
 *   ③ 九类抽样场景每类 ≥1 样本，缺类记 missing，不冒充齐全；
 *   ④ 隔离快照：干净 + 独立 worktree，禁活树；非隔离拒跑；
 *   ⑤ 台账记录字段齐全（选择集/全量红/hole/skip/干扰/must-run/影子趋势/触发因/快照标识/抢占事件），
 *      hole ⇒ widen_required 信号；reading_only=true（读数不进硬判据、不抬退出码）；
 *   ⑥ 影子趋势：runs<2 ⇒ insufficient，不硬判方向。
 *
 * 纯函数直测，不碰真 cache.db / 不写真册；只读仓断言核既有入口与 gitignore 边界。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ABLATION_TRIGGER_KINDS,
  ABLATION_SCENARIO_CLASSES,
  LIGHT_SAMPLE_MAX_FILES,
  LIGHT_SAMPLE_MAX_JOBS,
  OBSERVATION_HOLES_ZERO_RUNS,
  evaluateTriggers,
  validateSamplingQuota,
  coverageOfScenarios,
  snapshotRefOf,
  buildAblationRecord,
  summarizeShadowTrend,
  evaluateObservationWindow,
} from '../src/infrastructure/analysis/facts/incsel_cron.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('触发枚举：各触发因独立命中，无命中 ⇒ 不跑', () => {
  const base = { widenChanged: false, holes: 0, unknownEdgesAdded: 0, commitsSinceLast: 0, inNightWindow: false, intervalCommits: 20 };
  assert.equal(evaluateTriggers(base).shouldRun, false);
  assert.deepEqual(evaluateTriggers(base).fired, []);

  assert.deepEqual(evaluateTriggers({ ...base, widenChanged: true }).fired, ['widen']);
  assert.deepEqual(evaluateTriggers({ ...base, holes: 3 }).fired, ['holes_present']);
  assert.deepEqual(evaluateTriggers({ ...base, unknownEdgesAdded: 2 }).fired, ['unknown_edge']);
  assert.deepEqual(evaluateTriggers({ ...base, commitsSinceLast: 20 }).fired, ['commit_interval']);
  assert.deepEqual(evaluateTriggers({ ...base, inNightWindow: true }).fired, ['night_window']);

  const multi = evaluateTriggers({ ...base, holes: 1, inNightWindow: true, commitsSinceLast: 21 });
  assert.equal(multi.shouldRun, true);
  assert.deepEqual(multi.fired, ['holes_present', 'commit_interval', 'night_window']);

  // 阈值边界：19 < 20 不触发；intervalCommits ≤0 不据此触发
  assert.equal(evaluateTriggers({ ...base, commitsSinceLast: 19 }).shouldRun, false);
  assert.equal(evaluateTriggers({ ...base, commitsSinceLast: 5, intervalCommits: 0 }).shouldRun, false);
});

test('配额：light 边界放行，超文件/超并发拒跑；full 不压本机上限', () => {
  const ok = validateSamplingQuota({ files: LIGHT_SAMPLE_MAX_FILES, jobs: LIGHT_SAMPLE_MAX_JOBS, mode: 'light' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.reasons, []);

  const tooManyFiles = validateSamplingQuota({ files: LIGHT_SAMPLE_MAX_FILES + 1, jobs: 1, mode: 'light' });
  assert.equal(tooManyFiles.ok, false);
  assert.match(tooManyFiles.reasons.join(';'), /文件数/);

  const tooManyJobs = validateSamplingQuota({ files: 5, jobs: LIGHT_SAMPLE_MAX_JOBS + 1, mode: 'light' });
  assert.equal(tooManyJobs.ok, false);
  assert.match(tooManyJobs.reasons.join(';'), /并发/);

  const full = validateSamplingQuota({ files: 500, jobs: 16, mode: 'full' });
  assert.equal(full.ok, true);
  assert.deepEqual(full.reasons, []);
});

test('场景覆盖：九类每类 ≥1 样本 ⇒ 齐全；缺类记 missing', () => {
  const all = Object.fromEntries(ABLATION_SCENARIO_CLASSES.map((c) => [c, [`samples/${c}.ts`]]));
  const full = coverageOfScenarios(all);
  assert.equal(full.ok, true);
  assert.deepEqual(full.missing, []);
  assert.equal(full.covered.length, ABLATION_SCENARIO_CLASSES.length);

  const partial = { ...all };
  delete partial.java_delegate;
  const short = coverageOfScenarios(partial);
  assert.equal(short.ok, false);
  assert.deepEqual(short.missing, ['java_delegate']);

  const emptySample = coverageOfScenarios({ ...all, reflection: ['   '] });
  assert.equal(emptySample.ok, false);
  assert.ok(emptySample.missing.includes('reflection'));
});

test('隔离快照：干净独立 worktree ⇒ 隔离；活树/脏树/缺路径拒隔离', () => {
  const live = '/home/dev/agent-io';
  const good = snapshotRefOf({ commitSha: 'abc123', worktreePath: '/tmp/wt-abc123', clean: true, liveWorktree: live });
  assert.equal(good.isolated, true);
  assert.deepEqual(good.reasons, []);
  assert.match(good.snapshot_id, /^snapshot:abc123/);

  const sameTree = snapshotRefOf({ commitSha: 'abc123', worktreePath: live, clean: true, liveWorktree: live });
  assert.equal(sameTree.isolated, false);
  assert.match(sameTree.reasons.join(';'), /活工作树/);

  const dirty = snapshotRefOf({ commitSha: 'abc123', worktreePath: '/tmp/wt', clean: false, liveWorktree: live });
  assert.equal(dirty.isolated, false);
  assert.match(dirty.reasons.join(';'), /不干净/);

  const noTree = snapshotRefOf({ commitSha: null, worktreePath: null, clean: true, liveWorktree: live });
  assert.equal(noTree.isolated, false);
  assert.match(noTree.reasons.join(';'), /worktree/);
});

test('台账记录：字段齐全；holes>0 ⇒ widen_required；reading_only；序列化往返', () => {
  const rec = buildAblationRecord({
    run_id: 'ablation:abc123:t1',
    triggered_by: ['holes_present', 'night_window'],
    started_at: '2026-11-24T20:00:00.000Z',
    snapshot: { commit_sha: 'abc123', worktree: '/tmp/wt', clean: true, isolated: true },
    mode: 'light',
    quota: { files: 12, jobs: 2 },
    selection: ['tests/b.ts', 'tests/a.test.ts'],
    full_red: ['tests/a.test.ts'],
    holes: ['tests/a.test.ts'],
    skipped: ['tests/c.test.ts'],
    disturbing: [],
    must_run: ['tests/a.test.ts'],
    shadow_coverage: ['src/x.ts'],
    scenario_coverage: { java_delegate: ['tests/fixtures/java-proj'] },
  });

  assert.equal(rec.widen_required, true);
  assert.equal(rec.reading_only, true);
  assert.deepEqual(rec.selection, ['tests/a.test.ts', 'tests/b.ts']); // 排序归一
  assert.deepEqual(rec.holes, ['tests/a.test.ts']);
  assert.equal(rec.triggered_by.length, 2);
  assert.ok(rec.snapshot.isolated);
  assert.equal(rec.preemption.preempted, false);

  // 序列化往返不丢字段
  const back = JSON.parse(JSON.stringify(rec));
  assert.equal(back.schema, 1);
  assert.equal(back.widen_required, true);
  assert.equal(back.reading_only, true);
  assert.deepEqual(back.holes, rec.holes);

  const cleanRun = buildAblationRecord({
    run_id: 'ablation:abc123:t2',
    triggered_by: ['commit_interval'],
    started_at: '2026-11-24T20:05:00.000Z',
    snapshot: { commit_sha: 'abc123', worktree: '/tmp/wt2', clean: true, isolated: true },
    mode: 'light',
    quota: { files: 5, jobs: 1 },
  });
  assert.equal(cleanRun.widen_required, false);
});

test('影子趋势：不足两次 insufficient；递减 improving；递增 regressing', () => {
  const mk = (holes: number, shadow: number) =>
    buildAblationRecord({
      run_id: `r-${holes}-${shadow}`,
      triggered_by: ['night_window'],
      started_at: '2026-11-24T20:00:00.000Z',
      snapshot: { commit_sha: null, worktree: null, clean: true, isolated: true },
      mode: 'light',
      quota: { files: 0, jobs: 1 },
      holes: Array.from({ length: holes }, (_, i) => `h${i}`),
      shadow_coverage: Array.from({ length: shadow }, (_, i) => `s${i}`),
    });

  assert.equal(summarizeShadowTrend([mk(3, 5)]).direction, 'insufficient');
  assert.equal(summarizeShadowTrend([]).direction, 'insufficient');

  const improving = summarizeShadowTrend([mk(3, 5), mk(1, 4)]);
  assert.equal(improving.direction, 'improving');

  const regressing = summarizeShadowTrend([mk(1, 2), mk(4, 3)]);
  assert.equal(regressing.direction, 'regressing');

  const flat = summarizeShadowTrend([mk(2, 2), mk(2, 2)]);
  assert.equal(flat.direction, 'flat');
});

test('观察期窗口：连续 N 次 holes=0 才达标；不足/有洞 ⇒ not-eligible', () => {
  const zeroRun = (id: string) =>
    buildAblationRecord({
      run_id: id,
      triggered_by: ['night_window'],
      started_at: '2026-11-24T20:00:00.000Z',
      snapshot: { commitSha: null, worktree: null, clean: true, isolated: true },
      mode: 'light',
      quota: { files: 0, jobs: 1 },
      holes: [],
    });
  const holeRun = (id: string, holes: string[]) =>
    buildAblationRecord({
      run_id: id,
      triggered_by: ['holes_present'],
      started_at: '2026-11-24T20:00:00.000Z',
      snapshot: { commitSha: null, worktree: null, clean: true, isolated: true },
      mode: 'light',
      quota: { files: 0, jobs: 1 },
      holes,
    });

  // 空记录 ⇒ 不足，不冒充达标
  const empty = evaluateObservationWindow([]);
  assert.equal(empty.eligible, false);
  assert.equal(empty.runs, 0);
  assert.equal(empty.consecutiveZero, 0);
  assert.equal(empty.reason, 'insufficient-runs');

  // 不足 N 条全零 ⇒ insufficient-runs
  const few = evaluateObservationWindow([zeroRun('r1'), zeroRun('r2')]);
  assert.equal(few.eligible, false);
  assert.equal(few.consecutiveZero, 2);
  assert.equal(few.reason, 'insufficient-runs');

  // 末尾连续 N 条零、更早有洞 ⇒ eligible（漏选已修复，重新计数达门槛）
  const withHistory = [holeRun('h0', ['tests/old.ts']), ...Array.from({ length: OBSERVATION_HOLES_ZERO_RUNS }, (_, i) => zeroRun(`z${i}`))];
  const ok = evaluateObservationWindow(withHistory);
  assert.equal(ok.eligible, true);
  assert.equal(ok.consecutiveZero, OBSERVATION_HOLES_ZERO_RUNS);
  assert.equal(ok.reason, 'eligible');

  // 最近一条有洞 ⇒ hole-in-window，连续段归零（回退条件：出现漏选重新计观察期）
  const freshHole = [zeroRun('z1'), zeroRun('z2'), holeRun('h1', ['tests/a.test.ts'])];
  const rh = evaluateObservationWindow(freshHole);
  assert.equal(rh.eligible, false);
  assert.equal(rh.consecutiveZero, 0);
  assert.equal(rh.reason, 'hole-in-window');

  // 末尾连续零但更早有洞 ⇒ hole-in-window，连续段只数末尾零段
  const trailing = [holeRun('h0', ['tests/b.test.ts']), zeroRun('z1'), zeroRun('z2')];
  const rt = evaluateObservationWindow(trailing);
  assert.equal(rt.eligible, false);
  assert.equal(rt.consecutiveZero, 2);
  assert.equal(rt.reason, 'hole-in-window');

  // 自定义门槛：N=3 时 3 条零即达标
  const custom = evaluateObservationWindow([zeroRun('z1'), zeroRun('z2'), zeroRun('z3')], 3);
  assert.equal(custom.eligible, true);
  assert.equal(custom.threshold, 3);
  assert.equal(custom.reason, 'eligible');
});

test('只读仓：编排入口 / 纯函数导出 / 台账 gitignore / npm script 就位', () => {
  assert.ok(fs.existsSync(path.join(REPO, 'scripts', 'ablation-cron.mjs')));
  assert.ok(fs.existsSync(path.join(REPO, 'scripts', 'incsel-audit.mjs')));

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['audit:ablation'], 'node --import tsx scripts/ablation-cron.mjs');

  // 台账落点在 .agent-io/ 下（gitignore 覆盖，不入库）
  const gitignore = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.agent-io\//);

  // 触发因 / 场景闭集与企划枚举一致
  assert.deepEqual([...ABLATION_TRIGGER_KINDS], ['widen', 'holes_present', 'unknown_edge', 'commit_interval', 'night_window']);
  assert.equal(ABLATION_SCENARIO_CLASSES.length, 9);
  for (const c of ['dynamic_import', 'reflection', 'generated', 'java_delegate', 'cache_skip', 'verifier_change', 'retired_object', 'stale_evidence', 'pollution']) {
    assert.ok((ABLATION_SCENARIO_CLASSES as readonly string[]).includes(c), `缺场景 ${c}`);
  }
});
