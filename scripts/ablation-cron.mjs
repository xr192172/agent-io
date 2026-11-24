#!/usr/bin/env node
/**
 * ablation-cron.mjs —— G8 · 周期 reference run 编排 + 结构化对照台账（L4 频率归属）。
 *
 * ## 职责边界
 * · 触发枚举 / 配额 / 隔离标识 / 记录装配 / 趋势汇总的**纯语义**住
 *   `src/infrastructure/analysis/facts/incsel_cron.ts`；本脚本只做信号采集、编排调度、台账落盘。
 * · **对照读数是读数**：本脚本编排层恒 exit 0；hole / 影子覆盖只进台账 `widen_required` 信号，
 *   不进 verify 硬判据、不抬退出码（§5 L5 ④）。前置守卫（无触发不跑 / 超配额拒跑 / 非隔离拒跑）
 *   失败走 exit 2，与对照读数分开。
 * · **禁在活工作树跑**：真实对照必须在独立干净快照 worktree；本批只建 infrastructure，
 *   默认 `--dry`（不起全量对照、不克隆 worktree），重量级全量对照留 CI/阶段边界。
 *
 * 用法：
 *   node --import tsx scripts/ablation-cron.mjs [--root <dir>] [--dry] [--json]
 *     [--widen] [--unknown-edges N] [--night-window] [--interval-commits N]
 *     [--mode light|full] [--files N] [--jobs N] [--worktree <path>]
 *
 * 台账：`.agent-io/ablation-runs.jsonl`（append-only；.agent-io/* gitignore 覆盖，不入库）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateTriggers,
  validateSamplingQuota,
  snapshotRefOf,
  buildAblationRecord,
  summarizeShadowTrend,
} from '../src/infrastructure/analysis/facts/incsel_cron.ts';

const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (f) => argv.includes(f);

const ROOT = path.resolve(val('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const jsonOut = has('--json');
const dry = !has('--real'); // 默认 dry：不起全量对照、不克隆 worktree
const mode = val('--mode') === 'full' ? 'full' : 'light';
const jobs = Number(val('--jobs') ?? '2');
const files = Number(val('--files') ?? '0');
const intervalCommits = Number(val('--interval-commits') ?? '20');
const widen = has('--widen');
const unknownEdges = Number(val('--unknown-edges') ?? '0');
const nightWindow = has('--night-window');
const worktreeArg = val('--worktree');

const LEDGER_REL = path.join('.agent-io', 'ablation-runs.jsonl');
const LEDGER_ABS = path.join(ROOT, LEDGER_REL);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false }).trim();
  } catch {
    return '';
  }
}

/** 读台账末条记录（读不到 ⇒ null；坏行不静默，标注 skip）。 */
function readLastRecord() {
  if (!fs.existsSync(LEDGER_ABS)) return null;
  const lines = fs.readFileSync(LEDGER_ABS, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* 坏行跳过，继续往前找 */ }
  }
  return null;
}

function appendRecord(record) {
  fs.mkdirSync(path.dirname(LEDGER_ABS), { recursive: true });
  fs.appendFileSync(LEDGER_ABS, JSON.stringify(record) + '\n', 'utf8');
}

// ── 信号采集（真信号源在 CI/云端；本机 dry 只取可本地核读的部分）──
const last = readLastRecord();
const holesLast = Number(last?.holes?.length ?? 0);
const lastCommit = last?.snapshot?.commit_sha ?? null;
const commitsSinceLast = lastCommit
  ? Number(git(['rev-list', '--count', `${lastCommit}..HEAD`]) || '0')
  : 0;
const headSha = git(['rev-parse', 'HEAD']) || null;
const clean = git(['status', '--porcelain']).length === 0;

const signal = {
  widenChanged: widen,
  holes: holesLast,
  unknownEdgesAdded: unknownEdges,
  commitsSinceLast,
  inNightWindow: nightWindow,
  intervalCommits,
};
const eval_ = evaluateTriggers(signal);

// 无触发不跑（①）
if (!eval_.shouldRun) {
  const out = { triggered: false, fired: [], signal, ledger: LEDGER_REL };
  if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else console.log(`ablation-cron: 无触发因命中，本次不跑参考对照（signal=${JSON.stringify(signal)}）`);
  process.exit(0);
}

// 配额前置守卫（③ 本机轻量 ≤20 文件 / jobs ≤2；full 留 CI）
const quota = validateSamplingQuota({ files, jobs, mode });
if (!quota.ok) {
  process.stderr.write(`ablation-cron: 配额拒跑：${quota.reasons.join('；')}\n`);
  process.exit(2);
}

// 隔离快照守卫（① 干净快照 / 独立 worktree，禁活树）
const snapshot = snapshotRefOf({
  commitSha: headSha,
  worktreePath: worktreeArg,
  clean,
  liveWorktree: ROOT,
});
if (!dry && !snapshot.isolated) {
  process.stderr.write(`ablation-cron: 隔离拒跑：${snapshot.reasons.join('；')}\n`);
  process.exit(2);
}

const now = new Date().toISOString();
const record = buildAblationRecord({
  run_id: `ablation:${headSha?.slice(0, 12) ?? 'unpinned'}:${now}`,
  triggered_by: eval_.fired,
  started_at: now,
  finished_at: dry ? null : now,
  snapshot: {
    commit_sha: headSha,
    worktree: worktreeArg ?? null,
    clean,
    isolated: snapshot.isolated,
  },
  preemption: { preempted: false, reason: dry ? 'dry-run：未起真实对照（重量级全量留 CI/阶段边界）' : null },
  mode,
  quota: { files: quota.files, jobs: quota.jobs },
  selection: [],
  full_red: [],
  holes: [],
  skipped: [],
  disturbing: [],
  must_run: [],
  shadow_coverage: [],
  scenario_coverage: {},
});

appendRecord(record);
const all = fs.readFileSync(LEDGER_ABS, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const trend = summarizeShadowTrend(all);

const out = {
  triggered: true,
  fired: eval_.fired,
  mode,
  quota: { files: quota.files, jobs: quota.jobs, reasons: quota.reasons },
  snapshot: { ...snapshot, clean },
  dry,
  record,
  trend,
  ledger: LEDGER_REL,
  reading_only: true,
};
if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
else {
  console.log(`ablation-cron: 触发因=${eval_.fired.join(',')} mode=${mode} files=${quota.files} jobs=${quota.jobs}`);
  console.log(`  快照 ${snapshot.snapshot_id} isolated=${snapshot.isolated}${snapshot.reasons.length ? `（${snapshot.reasons.join('；')}）` : ''}`);
  console.log(`  台账=${LEDGER_REL} 趋势=${trend.direction}（runs=${trend.runs}）`);
  console.log('  对照读数 reading-only：不进硬判据、不抬退出码；漏选扩宽信号见台账 widen_required。');
}
// ④ 编排层恒 exit 0：对照读数不抬退出码（前置守卫失败已在上面 exit 2）。
process.exit(0);
