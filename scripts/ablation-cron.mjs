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
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateTriggers,
  validateSamplingQuota,
  snapshotRefOf,
  buildAblationRecord,
  summarizeShadowTrend,
  evaluateObservationWindow,
  OBSERVATION_HOLES_ZERO_RUNS,
} from '../src/infrastructure/analysis/facts/incsel_cron.ts';
import { buildCoverageMap } from '../src/infrastructure/analysis/facts/test_coverage.ts';

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
// 真对照 changed 集（可选；本机信号源缺 ⇒ 空 ⇒ 非对照模式，holes 平凡空；真对照 changed 源在 CI/云端）。
const changedCron = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--changed') continue;
  for (const p of String(argv[i + 1] ?? '').split(',')) if (p.trim()) changedCron.push(p.trim());
}

const LEDGER_REL = path.join('.agent-io', 'ablation-runs.jsonl');
const LEDGER_ABS = path.join(ROOT, LEDGER_REL);

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', shell: false }).trim();
  } catch {
    return '';
  }
}

/** 在指定目录跑 git（隔离快照副本的干净度判定用；默认仍活树 ROOT）。 */
function gitIn(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', shell: false }).trim();
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
// 隔离快照干净度判副本（--worktree 指向的独立 worktree）；活树自身的未提交改动不影响快照判定。
const targetRoot = worktreeArg ? path.resolve(worktreeArg) : ROOT;
const clean = gitIn(targetRoot, ['status', '--porcelain']).length === 0;

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

// ── ③ 索引存在/新鲜度守卫：空/stale 显形报缺索引 fail-closed，绝不把保守全量 227/227 当选择读数 ──
//   索引自建是隔离快照前置步骤（rebuild_feature/importProject 扫描 src 写 cache.db，重量级归 CI/云主机），
//   不在 cron 编排内自动全量扫描（L4）；守卫只判可信性，不替快照补索引。
const coverageProbe = buildCoverageMap(targetRoot);
let auditResult = null;
let auditNote = null;
if (!dry && !coverageProbe.trusted) {
  process.stderr.write(
    `ablation-cron: 索引守卫拒跑：隔离快照 ${targetRoot} 覆盖映射不可信（空索引 / stale / 边型对账不可读）⇒ ` +
    `需先在快照内自建索引（rebuild_feature/importProject）；不把保守全量当选择读数\n`,
  );
  process.exit(2);
}

// ── ② --real 调 incsel-audit 取真实对照读数（一处权威：判定住 incsel_ablation.ts，cron 只编排 + 落台账）──
if (!dry) {
  const auditArgs = ['--root', targetRoot, '--json'];
  if (changedCron.length) auditArgs.push('--changed', changedCron.join(','));
  if (files > 0) auditArgs.push('--sample', String(files));
  const ar = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts/incsel-audit.mjs'), ...auditArgs], {
    cwd: targetRoot, encoding: 'utf8', shell: false, maxBuffer: 32 * 1024 * 1024,
  });
  try { auditResult = JSON.parse(String(ar.stdout ?? '').trim()); } catch { auditNote = `audit 回执解析失败 rc=${ar.status}`; }
  if (ar.status !== 0 && !auditResult) {
    process.stderr.write(`ablation-cron: audit 调用失败 rc=${ar.status}：${String(ar.stderr ?? '').trim().split('\n').slice(-3).join(' | ')}\n`);
    process.exit(2);
  }
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
  preemption: { preempted: false, reason: dry ? 'dry-run：未起真实对照（重量级全量留 CI/阶段边界）' : auditNote },
  mode,
  quota: { files: quota.files, jobs: quota.jobs },
  selection: auditResult?.selection?.selectedFiles ?? [],
  full_red: auditResult?.fullRun?.redFiles ?? [],
  holes: auditResult?.holes ?? [],
  skipped: auditResult?.skipped ?? [],
  disturbing: [],
  must_run: [],
  shadow_coverage: auditResult?.uncoveredChanged ?? [],
  scenario_coverage: {},
});

appendRecord(record);
const all = fs.readFileSync(LEDGER_ABS, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const trend = summarizeShadowTrend(all);
// ⑤ 观察期机制：纯函数守门（连续 holes=0 计数 vs 门槛 N）；本批只接机制+读数，连续 10 次积累归阶段 3/CI。
//   eligible 仅作读数挂出，不进硬判据、不抬退出码（reading-only）。
const observation = evaluateObservationWindow(all, OBSERVATION_HOLES_ZERO_RUNS);

const out = {
  triggered: true,
  fired: eval_.fired,
  mode,
  quota: { files: quota.files, jobs: quota.jobs, reasons: quota.reasons },
  snapshot: { ...snapshot, clean },
  dry,
  record,
  trend,
  observation,
  ledger: LEDGER_REL,
  reading_only: true,
};
if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
else {
  console.log(`ablation-cron: 触发因=${eval_.fired.join(',')} mode=${mode} files=${quota.files} jobs=${quota.jobs}`);
  console.log(`  快照 ${snapshot.snapshot_id} isolated=${snapshot.isolated}${snapshot.reasons.length ? `（${snapshot.reasons.join('；')}）` : ''}`);
  console.log(`  台账=${LEDGER_REL} 趋势=${trend.direction}（runs=${trend.runs}）`);
  console.log(`  观察期：足额对照=${observation.eligibleRuns}/${observation.runs} 连续零洞=${observation.consecutiveZero} 类别=${JSON.stringify(observation.classified)} 窗外=${observation.outsideWindow} reason=${observation.reason}`);
  console.log('  对照读数 reading-only：不进硬判据、不抬退出码；漏选扩宽信号见台账 widen_required。');
}
// ④ 编排层恒 exit 0：对照读数不抬退出码（前置守卫失败已在上面 exit 2）。
process.exit(0);
