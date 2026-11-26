/**
 * P2 · **引擎原生可恢复执行（Task / Run / Checkpoint）** 垂直切片回归。
 *
 * ## 本证覆盖（真跑真库 / 真子进程，不打桩代活）
 * 1. `run_started` 幂等：首个有 task/lease 上下文的动作处创建一次，重复触发不重插；
 * 2. 开工后进程被杀（有 start 无 finish）⇒ 只读恢复仍能重建目标 / actor / 代际 / HEAD / 脏树 / 最近验证 / 下一步；
 *    生命周期标 `interrupted`，进程观察 `unknown`（不凭 pid/TTL 判死）；Task 状态不变，不产生判据 verdict；
 * 3. 正常完成进程（exit 0）⇒ Attempt completed；非零退出 ⇒ Attempt `failed`，**不是** Task failed/done；
 * 4. done/void 只展示历史，绝不建议自动重启；当前代际活跃 Attempt（活性 unknown）⇒ 只读 `inspect_pending_attempt`，不重附/不判死/不重复派工；
 * 5. 旧代际 Run 标 stale/superseded，恢复不重新附着，续作建议既有 claim/takeover；
 * 6. 引擎外直写 = `unreconciled_external_write`（不归因 actor）；无基线 / Git 不可读显式 gap；
 * 7. 同一事件前缀重 fold，digest 一致（无持久投影表；删不掉不存在的投影，重读重建相同）；
 * 8. 坏事件体 / 缺权威源不静默放行；通用 runner 无任务上下文 ⇒ 不记事件但回执显式标注原因；
 * 9. completeTask 证据落盘处记 `evidence_added`（引用/指纹，不复制 verdict，不另立权威）；
 * 10. Attempt 上下文按当前 Task 事实校验（持租/owner/代际）：不符或缺失 ⇒ unmatched/unverified，不挂当前代际活跃 Attempt；
 * 11. 持久对账反查：write_log/卡证据有账无事件 ⇒ 缺口标注；runner 无独立持久回执显式标限制；
 * 12. 仓内正式路径：openSourceWrite 映射卡落盘回读 `source_written`；recover_run/run_tests 经 def.handler + invokeTool 信封往返。
 *
 * ## 夹具口径
 * 临时 AGENT_IO_HOME + 临时项目根；tasks.db 落在项目根 `.agent-io/`，不污染主仓真实数据。
 * touches: src/domain/run_events.ts, src/application/observe/runtime/run_events.ts, src/application/observe/runtime/attempt_recorder.ts, src/application/observe/runtime/recover.ts, src/application/observe/runtime/run_tests.ts, src/application/observe/index.ts, src/application/tool_annotations.ts, src/application/source_writer.ts, src/application/design/dsl_ops/task_ops.ts, src/infrastructure/task_history.ts, src/infrastructure/git.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTests } from '../src/application/observe/runtime/run_tests.js';
import { startAttempt, finishAttempt } from '../src/application/observe/runtime/attempt_recorder.js';
import { appendRunEvent, ensureRunStarted, eventsForTask, listRunEvents } from '../src/application/observe/runtime/run_events.js';
import { recoverRun } from '../src/application/observe/runtime/recover.js';
import { foldCheckpoint } from '../src/domain/run_events.js';
import { completeTask } from '../src/application/design/dsl_ops/task_ops.js';
import { openSourceWrite } from '../src/application/source_writer.js';
import { openTasksDb } from '../src/infrastructure/task_history.js';
import { recordWriteLog, writeLogRowOf } from '../src/infrastructure/write_log.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { parseDataBlock } from '../src/application/plumbing.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const FEATURE = `__p2rec_${process.pid}`;
const ACTOR = 'subagent:p2-a';
const NODE = 't1';

interface Case {
  home: string;
  project: string;
  feature: string;
}

async function withCase(fn: (ctx: Case) => Promise<void>): Promise<void> {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p2-'));
  const prevHome = process.env.AGENT_IO_HOME;
  const prevDataRoot = process.env.AGENT_IO_DATA_ROOT;
  const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
  delete process.env.AGENT_IO_DATA_ROOT;
  process.env.AGENT_IO_HOME = home;
  process.env.AGENT_IO_REQUIRE_PLAN = '0';
  registerFeature(FEATURE, project, 'p2_run_recovery.test');
  try {
    await fn({ home, project, feature: FEATURE });
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    if (prevDataRoot === undefined) delete process.env.AGENT_IO_DATA_ROOT;
    else process.env.AGENT_IO_DATA_ROOT = prevDataRoot;
    if (prevPlan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
    else process.env.AGENT_IO_REQUIRE_PLAN = prevPlan;
    rmRf(home);
    rmRf(project);
  }
}

/** 落一张 todo 卡（权威住册）；默认 claimed / ACTOR / 第 1 代。`mappedFile` 给出 ⇒ 几何层挂一个文件型节点（写闸可映射到本卡）。 */
function seedCard(
  home: string,
  feature: string,
  project: string,
  patch: Record<string, unknown> = {},
  mappedFile?: string,
): void {
  const card = {
    id: NODE,
    node_id: NODE,
    state: 'claimed',
    summary: 'P2 夹具任务：验证执行可恢复',
    owner: ACTOR,
    claimed_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    lease_generation: 1,
    claimed_session: 'unknown',
    evidence: [] as unknown[],
    reopened_at: null,
    read_set: [],
    ...patch,
  };
  const dsl = {
    id: feature,
    type: 'design',
    feature,
    version: 1,
    title: feature,
    source_root: project,
    geometry: {
      nodes: mappedFile ? [{ id: NODE, type: 'file', path: mappedFile }] : [],
      edges: [],
    },
    semantic: { files: [] },
    todos: [card],
  };
  // ★ 册必须落在项目根 `.agent-io/design/`：写闸 `isSameProject` 只认册住在谁家（项目根下），
  //   写数据仓 home 里的旧位置会被闸判成「非本项目册」⇒ 无卡放行（card_of=null）。
  const dir = path.join(project, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

function writePackage(project: string, exitCode: number): void {
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ name: 'p2-fixture', scripts: { test: `node -e "process.exit(${exitCode})"` } }),
    'utf-8',
  );
}

const execCtx = (ctx: Case) => ({
  feature: ctx.feature,
  node_id: NODE,
  actor: ACTOR,
  lease_generation: 1,
  via: 'run_tests',
});

test('P2-1 run_started 幂等：同一 run 只落一条；重复触发返回既有 seq', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    const base = { task: { feature, node_id: NODE }, owner: ACTOR, leaseGeneration: 1, actor: ACTOR };
    const first = ensureRunStarted(project, base);
    const second = ensureRunStarted(project, base);
    assert.ok(first.ok, '首次 ensureRunStarted 必须成功');
    assert.ok(second.ok, '重复 ensureRunStarted 必须成功（幂等，不重插）');
    assert.equal(first.seq, second.seq, '幂等返回既有 seq');
    const read = eventsForTask(project, feature, NODE);
    const started = read.events.filter((e) => e.kind === 'run_started');
    assert.equal(started.length, 1, 'run_started 全表只有一条');
  });
});

test('P2-2 开工后进程被杀：中断 Attempt 可恢复，活性 unknown，Task 不判 done，下一步只读检查不重附', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    // 只落 attempt_started，不落 attempt_finished（模拟引擎/进程被杀）
    const rec = startAttempt(project, execCtx({ home, project, feature }), 'a-killed-1', {
      command: 'npm test',
      cwd: project,
      timeoutMs: 30_000,
    });
    assert.ok(rec.recorded, '任务上下文齐且 start 落库 ⇒ recorded=true');

    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.ok(report.task, '恢复必须读出任务卡');
    assert.equal(report.task!.state, 'claimed', '中断 Attempt 不改 Task 状态（仍 claimed）');
    assert.equal(report.task!.owner, ACTOR, 'owner 重建');
    assert.equal(report.task!.lease_generation, 1, '代际重建');
    assert.equal(report.task!.evidence_count, 0, '被杀不产生证据 / verdict');
    assert.ok(report.active_run, '存在当前代际活跃 Run');
    const attempt = report.active_run!.active_attempt;
    assert.ok(attempt, '活跃 Attempt 必须被派生出来');
    assert.equal(attempt!.outcome, 'interrupted', '有 start 无 finish ⇒ interrupted');
    assert.equal(attempt!.process_observation, 'unknown', '无可靠探针 ⇒ 活性 unknown（不许判死）');
    assert.equal(report.next_action.action, 'inspect_pending_attempt', '活性 unknown ⇒ 只读检查，不重附旧进程');
    assert.equal(report.next_action.grants, 'none', '恢复工具 grants 恒 none');
    assert.ok(!report.next_action.suggestions.some((s) => /续接该 Attempt 的现场|重附/.test(s)), '建议不得含重附/续接现场语义');
    assert.ok(report.active_run!.checkpoint.digest, 'checkpoint digest 可重建');
    assert.ok(report.target.summary, '目标（summary）可重建');
  });
});

test('P2-3 正常完成进程 exit 0 ⇒ Attempt completed；非零退出 ⇒ failed（Task 仍 claimed）', async () => {
  await withCase(async ({ home, project, feature }) => {
    // 3a 成功
    seedCard(home, feature, project);
    writePackage(project, 0);
    const ok = runTests({ project_dir: project, execution: execCtx({ home, project, feature }) });
    assert.equal(ok.success, true, '夹具脚本 exit 0 ⇒ runner 判 success');
    assert.equal(ok.attempt?.recorded, true, '任务上下文齐 ⇒ Attempt 记上');
    let report = recoverRun({ project_dir: project, feature, node_id: NODE });
    const completed = report.runs.flatMap((r) => r.attempts).find((a) => a.outcome === 'completed');
    assert.ok(completed, '应派生出 completed Attempt');
    assert.equal(completed!.exit_code, 0, '退出码 0');

    // 3b 失败（同项目换脚本为 exit 1）
    writePackage(project, 1);
    const bad = runTests({ project_dir: project, execution: execCtx({ home, project, feature }) });
    assert.equal(bad.success, false, 'exit 1 ⇒ runner 判失败');
    report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.task!.state, 'claimed', '非零退出不改 Task 为 failed/done');
    const failed = report.runs.flatMap((r) => r.attempts).find((a) => a.outcome === 'failed' && a.exit_code === 1);
    assert.ok(failed, '应派生出 failed Attempt（exit_code=1）');
    assert.equal(report.next_action.action, 'fix', '新鲜失败验证 ⇒ fix');
  });
});

test('P2-4 done/void 只展示历史，不建议自动重启；当前代际活跃 Attempt 不重复派工', async () => {
  await withCase(({ home, project, feature }) => {
    // done 卡：恢复必须 inspect_closed，且建议里不出现"重启/续作旧卡"
    seedCard(home, feature, project, { state: 'done', evidence: [{ kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: '旧一轮已收口' }] });
    const closed = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(closed.task!.state, 'done');
    assert.equal(closed.next_action.action, 'inspect_closed', 'done ⇒ inspect_closed');
    assert.ok(!closed.active_run || closed.active_run.active_attempt == null, '已关闭卡不挂活跃 Attempt');
    assert.ok(closed.next_action.suggestions.some((s) => /新开|不要在已关闭/.test(s)), '建议新开，不重启旧卡');
  });
});

test('P2-5 旧代际 Run fencing：标 stale，不重新附着，续作走既有 claim/takeover', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project); // 当前卡：owner=A 第 1 代
    // 旧代际 Run：owner=B 第 2 代（接管前的历史执行）
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 2,
      actor: ACTOR,
      kind: 'run_started',
      body: { note: '旧代际执行' },
    });
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 2,
      actor: ACTOR,
      kind: 'attempt_started',
      dedupeKey: 'a-stale-1',
      body: { attempt_ref: 'a-stale-1', input_fingerprint: 'fp-stale' },
    });
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.runs.length, 1);
    assert.equal(report.runs[0].stale, true, '旧代际 Run 标 stale');
    assert.equal(report.runs[0].current, false);
    assert.equal(report.next_action.action, 'reconcile_stale', '无当前代际 Run ⇒ reconcile_stale');
    assert.ok(report.next_action.suggestions.some((s) => /claim|takeover|接管/.test(s)), '续作建议既有 claim/takeover');
  });
});

test('P2-6 引擎外直写 ⇒ unreconciled_external_write，不归因 actor；无基线显式 gap', async () => {
  await withCase(async ({ home, project, feature }) => {
    seedCard(home, feature, project);
    // 建一个真 git 仓作为基线
    const { spawnSync } = await import('node:child_process');
    fs.writeFileSync(path.join(project, 'base.txt'), 'base\n');
    spawnSync('git', ['init'], { cwd: project });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: project });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: project });
    spawnSync('git', ['add', '-A'], { cwd: project });
    spawnSync('git', ['commit', '-m', 'base'], { cwd: project });
    let head = '';
    for (let i = 0; i < 20; i++) {
      const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' });
      head = (r.stdout ?? '').trim();
      if (head) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(head, '夹具 git 基线必须可建');

    // 引擎在收尾边界观察到一次 HEAD/脏树
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 1,
      actor: ACTOR,
      kind: 'git_observed',
      body: {
        stage: 'evidence_added',
        snapshot: { git_ok: true, head, dirty: false, modified: [], untracked: [], reason: null },
      },
    });

    // 引擎外直写：新增一个未跟踪文件（不经任何写闸/事件）
    fs.writeFileSync(path.join(project, 'leak.txt'), 'external write\n');

    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.drift.status, 'unreconciled_external_write', '观察后出现无法解释的改动 ⇒ 未对账外部写');
    assert.match(report.drift.note, /不归因|actor|外部/, '漂移说明不归因给某 actor');
  });
});

test('P2-7 同一事件前缀重 fold：digest 一致（无投影表，重读重建相同）', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    appendRunEvent(project, { task: { feature, node_id: NODE }, owner: ACTOR, leaseGeneration: 1, actor: ACTOR, kind: 'source_written', body: { files: [{ rel: 'src/a.ts' }] } });
    appendRunEvent(project, { task: { feature, node_id: NODE }, owner: ACTOR, leaseGeneration: 1, actor: ACTOR, kind: 'evidence_added', body: { evidence: { kind: 'reading' } } });

    const first = listRunEvents(project, { feature, node_id: NODE });
    const firstCp = foldCheckpoint(first.events[0].run_id, first.events);
    // 重新开库重读（模拟投影/缓存删除后的冷重建）
    const second = listRunEvents(project, { feature, node_id: NODE });
    const secondCp = foldCheckpoint(second.events[0].run_id, second.events);
    assert.equal(firstCp.digest, secondCp.digest, '相同前缀重建 digest 必须一致');
    assert.equal(firstCp.last_event_seq, secondCp.last_event_seq);
    assert.ok(firstCp.digest, 'digest 非空');
  });
});

test('P2-8 缺权威源不静默放行；坏事件体保留并标解析失败；通用 runner 无上下文显式不记', async () => {
  await withCase(({ home, project, feature }) => {
    // 8a 册里没有这张卡 ⇒ task=null，ask_human，gaps 非空
    const missing = recoverRun({ project_dir: project, feature: 'no-such-feature', node_id: NODE });
    assert.equal(missing.task, null);
    assert.equal(missing.next_action.action, 'ask_human');
    assert.ok(missing.gaps.length > 0, '缺口必须显式带出，不许静默当空');

    // 8b 坏事件体：直插一行非法 JSON；读端保留行 + _parse_error，不抛、不丢
    seedCard(home, feature, project);
    const db = openTasksDb(project);
    db.prepare(
      `INSERT INTO run_events (run_id, task_feature, task_node_id, seq, kind, at, actor, via, session, body)
       VALUES (?, ?, ?, ?, 'git_observed', ?, ?, ?, ?, ?)`,
    ).run('run:bad', feature, NODE, 99, new Date().toISOString(), ACTOR, 'test', 'unknown', '{not-json}');
    db.close();
    const read = listRunEvents(project, { feature, node_id: NODE });
    assert.equal(read.total, 1, '坏行仍计入总数，不静默丢');
    assert.ok(read.events[0].body._parse_error, '坏行必须标注解析失败');
    assert.equal(read.events[0].body._raw, '{not-json}', '坏行原文保留，不裁掉');

    // 8c 通用 runner（无 feature/node_id）⇒ 不记事件，回执显式给原因
    writePackage(project, 0);
    const generic = runTests({ project_dir: project });
    assert.equal(generic.attempt?.recorded, false, '无任务上下文不记 Attempt');
    assert.ok(generic.attempt?.reason, '未记录原因必须显式给出（非静默）');
  });
});

test('P2-9 completeTask 证据落盘处记 evidence_added；证据本体/verdict 权威仍在卡上', async () => {
  await withCase(async ({ home, project, feature }) => {
    seedCard(home, feature, project);
    const done = await completeTask({
      feature,
      node_id: NODE,
      agent: ACTOR,
      evidence: { kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: '夹具：显式收口确认' },
    });
    assert.match(done.message, /done|完成/, 'todo attestation 应收口');
    const read = eventsForTask(project, feature, NODE);
    const added = read.events.filter((e) => e.kind === 'evidence_added');
    assert.equal(added.length, 1, 'complete 证据追加处必须记一条 evidence_added');
    assert.equal(added[0].body.card_ref?.node_id, NODE, '事件软引用任务');
    assert.equal(added[0].body.evidence?.verdict, undefined, '事件不复制 verdict（结论唯一权威在卡上证据）');
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.task!.state, 'done', '卡上状态才是权威');
    assert.equal(report.task!.evidence_count, 1, '证据仍压在卡上');
  });
});

test('P2-10 上下文与当前 Task 事实不符（owner/代际）⇒ 不挂当前代际活跃 Attempt', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project); // owner=ACTOR 第 1 代 claimed
    // owner 不符：自报 actor 不是当前 owner
    const badOwner = startAttempt(
      project,
      { feature, node_id: NODE, actor: 'intruder', lease_generation: 1, via: 'run_tests' },
      'a-mismatch-owner',
      { command: 'npm test', cwd: project },
    );
    assert.ok(badOwner.recorded, '事件仍留审计；但校验不通过');
    assert.equal(badOwner.context_check?.matched, false);
    assert.equal(badOwner.context_check?.reason, 'owner-mismatch');
    // 代际不符：自报 generation 不是当前代际
    const badGen = startAttempt(
      project,
      { feature, node_id: NODE, actor: ACTOR, lease_generation: 99, via: 'run_tests' },
      'a-mismatch-gen',
      { command: 'npm test', cwd: project },
    );
    assert.equal(badGen.context_check?.matched, false);
    assert.equal(badGen.context_check?.reason, 'generation-mismatch');

    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.ok(
      report.active_run == null || report.active_run.active_attempt == null,
      '未校验通过的 Attempt 不得当当前代际活跃',
    );
    assert.notEqual(report.next_action.action, 'inspect_pending_attempt', '不匹配上下文不得建议续接/检查该 Attempt');
    const all = report.runs.flatMap((r) => r.attempts);
    assert.ok(all.some((a) => a.context_check?.reason === 'owner-mismatch'), 'owner 不符 Attempt 留审计展示');
    assert.ok(all.some((a) => a.context_check?.reason === 'generation-mismatch'), '代际不符 Attempt 留审计展示');
  });
});

test('P2-11 持久对账：write_log/卡证据有账无事件 ⇒ 缺口标注；runner 无独立回执显式限制', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project, {
      evidence: [{ kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: '卡上既有证据（未走本批事件）' }],
    });
    // 直写一条 write_log：模拟写已落盘，但 source_written 事件没落上
    recordWriteLog(project, [
      writeLogRowOf('src/a.ts', 'commit', {
        actor: ACTOR,
        card_of: { 'src/a.ts': { feature, nodeId: NODE } },
        branch_of: {},
      }),
    ]);
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.reconciliation.writes_without_event, 1, 'write_log 有账但无 source_written 事件 ⇒ 计缺口');
    assert.equal(report.reconciliation.evidence_without_event, 1, '卡上有证据但无 evidence_added 事件 ⇒ 计缺口');
    assert.equal(report.reconciliation.runner_receipt_durable, false, 'runner 无独立持久回执');
    assert.ok(report.gaps.some((g) => /write_log/.test(g)), '写侧缺口进 gaps');
    assert.ok(report.gaps.some((g) => /证据/.test(g)), '证据侧缺口进 gaps');
    assert.ok(report.gaps.some((g) => /回执|持久/.test(g)), 'runner 通道限制显式带出（不把警告当对账）');
  });
});

/** 册表里的工具 def（缺失 ⇒ 当场红，不 skip）。 */
function toolDef(name: string) {
  const def = TOOL_DEFS.find((d) => d.name === name);
  assert.ok(def, `${name} 必须注册在 TOOL_DEFS`);
  return def;
}

/** 经唯一咽喉 `invokeTool`（zod → handler）往返，解析 `---DATA---` 信封。 */
async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; data: Record<string, unknown> | null }> {
  const r = await invokeTool(toolDef(name), args, 'cert');
  const text = String(r.text ?? '');
  const data = parseDataBlock(text) as Record<string, unknown> | null;
  return { text, isError: r.isError === true, data };
}

test('P2-12 openSourceWrite 映射卡路径：commit/close 回读 source_written 全字段；重复 close 幂等；第二次新写可追加；无卡写不冒记', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project, {}, 'src/a.ts');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });

    // ① 映射卡写：open → commit → close
    const txn = openSourceWrite(project, ['src/a.ts'], {
      label: 'p2:mapped-write',
      actor: ACTOR,
      leaseGeneration: 1,
    });
    txn.commit('src/a.ts', '// v1\n');
    txn.close();

    let read = eventsForTask(project, feature, NODE);
    let written = read.events.filter((e) => e.kind === 'source_written');
    assert.equal(written.length, 1, '映射卡写必须落一条 source_written');
    const ev = written[0];
    const file = (ev.body.files as Array<Record<string, unknown>>)[0];
    assert.equal(file.rel, 'src/a.ts');
    assert.ok(typeof file.post_write_sha === 'string' && file.post_write_sha.length > 0, '写后内容指纹落事件');
    assert.ok('gate_branch' in file, 'gate_branch 字段在（取值可 null）');
    assert.equal((ev.body.write_log_ref as Record<string, unknown>).table, 'write_log', '只引用 write_log，不复制写账');
    assert.equal(ev.body.verdict, undefined, '事件不复制 verdict');
    assert.equal((ev.body as Record<string, unknown>).write_log, undefined, '事件不复制写账行内容');

    // ② 重复 close 幂等：同指纹重放不重插
    txn.close();
    read = eventsForTask(project, feature, NODE);
    written = read.events.filter((e) => e.kind === 'source_written');
    assert.equal(written.length, 1, '重复 close 同指纹 ⇒ 幂等，不产生第二条事件');

    // ③ 第二次写（新内容指纹）⇒ 新事实可追加
    const txn2 = openSourceWrite(project, ['src/a.ts'], {
      label: 'p2:mapped-write-2',
      actor: ACTOR,
      leaseGeneration: 1,
    });
    txn2.commit('src/a.ts', '// v2\n');
    txn2.close();
    read = eventsForTask(project, feature, NODE);
    written = read.events.filter((e) => e.kind === 'source_written');
    assert.equal(written.length, 2, '第二次新写（新指纹）必须追加为第二条事件');

    // ④ 无卡（unmapped）写：只进 write_log，不冒记任务事件
    const unmapped = openSourceWrite(project, ['src/unmapped.ts'], {
      label: 'p2:unmapped-write',
      actor: ACTOR,
    });
    unmapped.commit('src/unmapped.ts', '// no card\n');
    unmapped.close();
    read = eventsForTask(project, feature, NODE);
    assert.ok(
      read.events.every((e) => !(e.body.files as Array<Record<string, unknown>> | undefined)?.some((f) => f.rel === 'src/unmapped.ts')),
      '无卡写不得进任务事件流',
    );
  });
});

test('P2-13 recover_run 经 invokeTool 信封往返：中断 Attempt 只读检查；缺权威源 ask_human', async () => {
  await withCase(async ({ home, project, feature }) => {
    seedCard(home, feature, project);
    startAttempt(project, execCtx({ home, project, feature }), 'a-wire-1', { command: 'npm test', cwd: project });

    const r = await callTool('recover_run', { project_dir: project, feature, node_id: NODE, actor: ACTOR });
    assert.equal(r.isError, false, `recover_run 信封回执不得报错：${r.text}`);
    const data = r.data as Record<string, unknown>;
    assert.equal(data.ok, true);
    const next = data.next_action as Record<string, unknown>;
    assert.equal(next.action, 'inspect_pending_attempt', 'wire 层：活性 unknown ⇒ 只读检查动作');
    assert.equal(next.grants, 'none');
    const activeRun = data.active_run as Record<string, unknown>;
    const attempt = activeRun.active_attempt as Record<string, unknown>;
    assert.equal(attempt.outcome, 'interrupted');
    assert.equal(attempt.process_observation, 'unknown');
    assert.equal((attempt.context_check as Record<string, unknown>).matched, true);
    assert.ok((activeRun.checkpoint as Record<string, unknown>).digest, 'wire 层回读 checkpoint digest');

    // 缺权威源：册里没有这张卡 ⇒ ask_human，不静默放行
    const missing = await callTool('recover_run', { project_dir: project, feature: 'no-such-feature', node_id: NODE });
    assert.equal(missing.isError, false);
    const mData = missing.data as Record<string, unknown>;
    assert.equal(mData.task, null);
    assert.equal((mData.next_action as Record<string, unknown>).action, 'ask_human');
  });
});

test('P2-14 run_tests 经 invokeTool：无上下文 recorded=false + reason；合法上下文 recorded 且与落库一致', async () => {
  await withCase(async ({ home, project, feature }) => {
    seedCard(home, feature, project);
    writePackage(project, 0);

    // ① 无任务上下文：不记 Attempt，回执显式给原因
    const generic = await callTool('run_tests', { project_dir: project });
    assert.equal(generic.isError, false, `runner 回执不得报错：${generic.text}`);
    const gData = generic.data as Record<string, unknown>;
    const gAttempt = gData.attempt as Record<string, unknown>;
    assert.equal(gAttempt.recorded, false, '无上下文不记 Attempt');
    assert.ok(gAttempt.reason, '未记录原因必须显式给出');
    const genericEvents = listRunEvents(project, { feature, node_id: NODE });
    assert.ok(!genericEvents.events.some((e) => e.kind === 'attempt_started'), '无上下文不得落 attempt_started');

    // ② 合法上下文：recorded=true，start/finish 按同一 attempt_ref 落库，append_ok=true
    const matched = await callTool('run_tests', {
      project_dir: project,
      feature,
      node_id: NODE,
      actor: ACTOR,
      lease_generation: 1,
    });
    assert.equal(matched.isError, false, `runner 回执不得报错：${matched.text}`);
    const mData = matched.data as Record<string, unknown>;
    const mAttempt = mData.attempt as Record<string, unknown>;
    assert.equal(mAttempt.recorded, true, '合法上下文 ⇒ Attempt 落库');
    assert.equal(mAttempt.append_ok, true, 'finish 事件显式 append_ok=true');
    const ref = mAttempt.attempt_ref as string;
    const events = listRunEvents(project, { feature, node_id: NODE }).events;
    const started = events.find((e) => e.kind === 'attempt_started' && e.body.attempt_ref === ref);
    const finished = events.find((e) => e.kind === 'attempt_finished' && e.body.attempt_ref === ref);
    assert.ok(started, 'attempt_started 真落库');
    assert.ok(finished, 'attempt_finished 真落库，且与 start 配对同一 attempt_ref');
    assert.equal((started!.body.context_check as Record<string, unknown>).matched, true, '上下文校验通过');
  });
});

test('P2-15 去重事务内精确等值：同键幂等；不同键（含 %/_ 通配符）不互吞', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    const base = { task: { feature, node_id: NODE }, owner: ACTOR, leaseGeneration: 1, actor: ACTOR };
    const keyWild = 'k-a%_x';
    const first = appendRunEvent(project, { ...base, kind: 'git_observed', dedupeKey: keyWild, body: { n: 1 } });
    const replay = appendRunEvent(project, { ...base, kind: 'git_observed', dedupeKey: keyWild, body: { n: 1 } });
    assert.ok(first.ok && replay.ok);
    assert.equal(first.seq, replay.seq, '同键重放返回既有 seq');
    const other = appendRunEvent(project, { ...base, kind: 'git_observed', dedupeKey: 'k-a', body: { n: 2 } });
    assert.ok(other.ok);
    const read = listRunEvents(project, { feature, node_id: NODE });
    const git = read.events.filter((e) => e.kind === 'git_observed');
    assert.equal(git.length, 2, '含通配符的键不得 LIKE 误匹配到别的键；两条不同键都在');
  });
});

test('P2-16 证据/写事件去重键纳入事实指纹：同次重放幂等，第二条新事实可追加', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    const base = { task: { feature, node_id: NODE }, owner: ACTOR, leaseGeneration: 1, actor: ACTOR };
    // 第一条证据（指纹 fp1，时刻 at1）
    const ev1 = appendRunEvent(project, {
      ...base,
      kind: 'evidence_added',
      dedupeKey: `evidence:${NODE}:fp1:2026-01-01T00:00:00.000Z`,
      body: { evidence: { kind: 'attestation', fingerprint: { what: 'fp1' } } },
    });
    // 同次重放：同键幂等
    const ev1Replay = appendRunEvent(project, {
      ...base,
      kind: 'evidence_added',
      dedupeKey: `evidence:${NODE}:fp1:2026-01-01T00:00:00.000Z`,
      body: { evidence: { kind: 'attestation', fingerprint: { what: 'fp1' } } },
    });
    assert.equal(ev1.seq, ev1Replay.seq, '同指纹同时刻重放幂等');
    // 第二条证据（新指纹/新时刻）⇒ 追加
    const ev2 = appendRunEvent(project, {
      ...base,
      kind: 'evidence_added',
      dedupeKey: `evidence:${NODE}:fp2:2026-01-02T00:00:00.000Z`,
      body: { evidence: { kind: 'reading', fingerprint: { what: 'fp2' } } },
    });
    assert.ok(ev2.ok);
    const read = listRunEvents(project, { feature, node_id: NODE });
    const evidence = read.events.filter((e) => e.kind === 'evidence_added');
    assert.equal(evidence.length, 2, '第二条新证据不得被旧键吞掉');
  });
});

test('P2-17 F3 反例：缺 context_check 的 Attempt 不算有效，不进当前活跃档，缺口显式带出', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project);
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 1,
      actor: ACTOR,
      kind: 'attempt_started',
      dedupeKey: 'start:a-null-check',
      body: { attempt_ref: 'a-null-check', input_fingerprint: 'fp-null' },
    });
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.active_run?.active_attempt ?? null, null, '缺校验不得挂当前代际活跃 Attempt');
    assert.ok(
      report.gaps.some((g) => /missing-context-check|上下文校验未通过|缺失/.test(g)),
      '缺校验 Attempt 必须进 gaps/unverifiable',
    );
    const unverified = report.runs.flatMap((r) => r.unverified_attempts);
    assert.ok(unverified.some((a) => a.attempt_ref === 'a-null-check'), '未校验 Attempt 留审计展示');
  });
});

test('P2-18 F8 漂移基线收敛当前 Run：当前 Run 无基线不借旧代际 Run 的 git_observed', async () => {
  await withCase(async ({ home, project, feature }) => {
    const { spawnSync } = await import('node:child_process');
    seedCard(home, feature, project); // 当前卡：owner=A 第 1 代
    spawnSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: project, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: project, stdio: 'ignore' });
    fs.writeFileSync(path.join(project, '.gitkeep'), 'init', 'utf-8');
    spawnSync('git', ['add', '.'], { cwd: project, stdio: 'ignore' });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: project, stdio: 'ignore' });
    // 旧代际 Run（第 2 代）里有一条 git_observed 基线
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 2,
      actor: ACTOR,
      kind: 'git_observed',
      body: { stage: 'stale', snapshot: { git_ok: true, head: 'stale-head', dirty: false, modified: [], untracked: [], reason: null } },
    });
    // 当前代际 Run（第 1 代）只有 run_started，无 git_observed
    appendRunEvent(project, {
      task: { feature, node_id: NODE },
      owner: ACTOR,
      leaseGeneration: 1,
      actor: ACTOR,
      kind: 'run_started',
      body: { note: 'current run' },
    });
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.drift.status, 'no-observed-baseline', '当前 Run 无基线 ⇒ no-observed-baseline');
    assert.equal(report.drift.last_observed, null, '不借旧代际 Run 的快照当基线');
  });
});

test('P2-19 F9 write_log 对账按 actor 分桶：他人署名归历史缺口，无卡写仅 write_log 对账', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project, {
      evidence: [{ kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: '卡上既有证据' }],
    });
    recordWriteLog(project, [
      // 当前 owner 名下一行
      writeLogRowOf('src/a.ts', 'commit', {
        actor: ACTOR,
        card_of: { 'src/a.ts': { feature, nodeId: NODE } },
        branch_of: {},
      }),
      // 他人署名一行：不归当前 owner
      writeLogRowOf('src/b.ts', 'commit', {
        actor: 'subagent:other',
        card_of: { 'src/b.ts': { feature, nodeId: NODE } },
        branch_of: {},
      }),
      // 无卡写
      writeLogRowOf('src/c.ts', 'commit', { actor: ACTOR, card_of: {}, branch_of: {} }),
    ]);
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    const rec = report.reconciliation;
    assert.equal(rec.writes_without_event, 1, '只把当前 owner 名下缺事件行计当前缺口');
    assert.equal(rec.writes_other_actor, 1, '他人署名行单列历史缺口，不归当前 owner');
    assert.equal(rec.unmapped_writes, 1, '无卡写单列计数');
    assert.ok(rec.notes.some((n) => /代际列|generation/.test(n)), 'write_log 无代际列的限制必须写明');
    assert.ok(report.gaps.some((g) => /unmapped|无卡|write_log 对账/.test(g)), '无卡写仅 write_log 对账的限制进 gaps');
  });
});

test('P2-20 B-M3 清卡（release 回候选）后首 op 失败：旧 interrupted 账不挂当前活跃，新失败独立成账不冒充既有账', async () => {
  await withCase(({ home, project, feature }) => {
    seedCard(home, feature, project); // claimed / ACTOR / g1
    // 旧代际活跃 Run：开工无收尾（interrupted），上下文校验通过
    startAttempt(project, execCtx({ home, project, feature }), 'a-released-1', {
      command: 'npm test',
      cwd: project,
    });

    // 模拟清卡（releaseTask 落账后态）：回 candidate、owner / claimed_at 清空；读集 / 证据留卡上作历史事实。
    const dslPath = path.join(project, '.agent-io', 'design', `${feature}.dsl.json`);
    const dsl = JSON.parse(fs.readFileSync(dslPath, 'utf-8'));
    const card = dsl.todos.find((t: { id: string }) => t.id === NODE);
    assert.ok(card, '夹具卡必须在册');
    card.state = 'candidate';
    card.owner = null;
    card.claimed_at = null;
    card.prepared_snapshot = null;
    fs.writeFileSync(dslPath, JSON.stringify(dsl, null, 2), 'utf-8');

    // 清卡后恢复：旧 interrupted Run 与当前卡 owner/代际不符 ⇒ stale，不进当前活跃档
    const report = recoverRun({ project_dir: project, feature, node_id: NODE });
    assert.equal(report.task!.state, 'candidate', '清卡后回候选态');
    assert.equal(report.task!.owner, null, '清卡后 owner 清空');
    assert.equal(report.active_run, null, '旧 interrupted Run 清卡后不得挂当前代际活跃');
    // 下一步只能是「对账旧代际 / 领卡」档：不得挂旧活跃只读检查，也不得把旧 interrupted 当新鲜失败要修
    assert.notEqual(report.next_action.action, 'inspect_pending_attempt', '旧账不挂当前活跃 ⇒ 不给只读检查续接');
    assert.notEqual(report.next_action.action, 'fix', '旧 interrupted 不是新鲜失败 ⇒ 不进失败修复档');
    assert.ok(
      ['reconcile_stale', 'claim_takeover'].includes(report.next_action.action),
      `清卡后下一步应是对账旧代际 / 领卡，实际=${report.next_action.action}`,
    );
    assert.ok(
      !report.next_action.suggestions.some((s) => /续接该 Attempt 的现场|重附旧进程/.test(s)),
      '提示不得冒充旧进行中账',
    );

    // 旧账仍在事件流可查，但标 stale；旧 Attempt 留审计展示（视图层派生历史 active_attempt，
    // 但主流程只认 currentRun ⇒ 不进当前活跃档，见上方 report.active_run=null）。
    assert.equal(report.runs.length, 1, '旧账仍在历史事件流');
    const staleRun = report.runs[0];
    assert.equal(staleRun.stale, true, '旧 Run 与清卡后当前卡 owner/代际不符 ⇒ stale');
    assert.equal(staleRun.current, false);
    const oldAttempt = staleRun.attempts.find((a) => a.attempt_ref === 'a-released-1');
    assert.ok(oldAttempt, '旧 Attempt 留审计展示');
    assert.equal(oldAttempt.outcome, 'interrupted');

    // 首 op 失败：清卡后新会话带 actor 跑一次失败验证（exit 1）⇒ 新 Attempt 独立成账；
    // 候选态不持租 ⇒ 上下文校验不通过，不冒当前活跃；失败不并入旧 stale Run。
    writePackage(project, 1);
    const fail = runTests({ project_dir: project, execution: execCtx({ home, project, feature }) });
    assert.equal(fail.success, false, '首 op 失败（exit 1）');
    const after = recoverRun({ project_dir: project, feature, node_id: NODE });
    const failedAttempts = after.runs.flatMap((r) => r.attempts).filter((a) => a.outcome === 'failed');
    assert.ok(failedAttempts.length >= 1, '首 op 失败独立落一条 failed Attempt');
    assert.equal(after.active_run, null, '未校验挂租的失败 Attempt 不冒当前代际活跃');
    assert.ok(
      after.runs.filter((r) => r.current).every((r) => r.active_attempt == null),
      '当前代际 Run 不挂任何活跃 Attempt（旧 interrupted 与新失败都未校验挂租）',
    );
  });
});
