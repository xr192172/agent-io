#!/usr/bin/env node
/**
 * ablation-ingest.mjs —— 观察期台账的**宿主侧唯一写者**消费端。
 *
 * ## 职责边界（D.6 三轴：单写者 · 多读者）
 * · **账本唯一写者 = 宿主 cron**：`.agent-io/ablation-runs.jsonl` 的追加落盘只由本脚本在宿主
 *   （本机 / 云主机隔离副本）上执行；CI 观察期车道**只产 reference artifact**，不直接写仓内账本
 *   （Actions 产物走自己的通道，见 `ablation-reference.yml`）。
 * · CI 侧 `ablation-cron.mjs --json` 跑 dry/light reference，回执里的 `record` 字段即本脚本的输入；
 *   本脚本把该 record 校验后 append-only 落进台账。记录内容不改写（CI 给什么落什么）。
 * · 纯语义校验沿用 `incsel_cron.ts` 的 record schema；本脚本不重判对照读数（holes/full_red 等
 *   只进台账，不抬退出码、不进 verify 硬判据）。
 *
 * ## 底座变更标记（≥1 轮底座变更）
 * · record 的 `snapshot.commit_sha` 标识本轮底座快照；ingest 回执打印台账内 **distinct commit_sha
 *   轮数**（首条即基线轮；出现 ≥2 个不同 sha ⇒ 已跨过一轮底座变更）。本脚本只计数披露，不据此
 *   进退码（观察期窗口评估属 `evaluateObservationWindow` 的读数口径）。
 *
 * 用法：
 *   node --import tsx scripts/ablation-ingest.mjs --artifact <json 文件> [--root <dir>] [--json]
 *
 * 幂等：同一 `run_id` 已在台账 ⇒ 跳过追加（不重复记账），exit 0。
 *
 * H1 诚实分母：落账前按 `classifyRunClass`（权威口径在 incsel_cron.ts）标定 `run_class`
 * （dry / untrusted / sampled / full-control）；旧台账行缺类别时由评估端现场分类兼容，
 * 新入账记录在此写死类别。仅 full-control 进观察期分母。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyRunClass } from '../src/infrastructure/analysis/facts/incsel_cron.ts';

const RUN_CLASSES = ['dry', 'untrusted', 'sampled', 'full-control'];

const argv = process.argv.slice(2);
const val = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (f) => argv.includes(f);

const ROOT = path.resolve(val('--root') ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const jsonOut = has('--json');
const artifactArg = val('--artifact');

const LEDGER_REL = path.join('.agent-io', 'ablation-runs.jsonl');
const LEDGER_ABS = path.join(ROOT, LEDGER_REL);

/** record 必填字段闭集（与 incsel_cron.ts `AblationRunRecord` 对齐；只校验落盘合法性）。 */
const REQUIRED = ['run_id', 'triggered_by', 'started_at', 'finished_at', 'snapshot', 'mode', 'reading_only'];

function readLedgerRecords() {
  if (!fs.existsSync(LEDGER_ABS)) return { records: [], bad: [] };
  const records = [];
  const bad = [];
  const lines = fs.readFileSync(LEDGER_ABS, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  lines.forEach((line, idx) => {
    try {
      records.push(JSON.parse(line));
    } catch {
      bad.push({ line: idx + 1, raw: line.trim() });
    }
  });
  return { records, bad };
}

function validate(record) {
  const reasons = [];
  if (record == null || typeof record !== 'object' || Array.isArray(record)) {
    return ['artifact 记录不是 JSON 对象'];
  }
  if (record.schema !== 1) reasons.push(`schema=${record.schema}（期望 1）`);
  for (const k of REQUIRED) {
    if (!(k in record)) reasons.push(`缺字段 ${k}`);
  }
  if (typeof record.run_id !== 'string' || record.run_id.trim() === '') reasons.push('run_id 非空字符串');
  if (!Array.isArray(record.triggered_by)) reasons.push('triggered_by 非数组');
  if (record.reading_only !== true) reasons.push('reading_only 必须为 true（对照读数不进硬判据）');
  if (record.snapshot == null || typeof record.snapshot !== 'object') reasons.push('snapshot 非对象');
  if (record.run_class != null && !RUN_CLASSES.includes(record.run_class)) {
    reasons.push(`run_class=${record.run_class} 不在闭集 ${RUN_CLASSES.join('/')}`);
  }
  return reasons;
}

// ── 读 artifact：兼容「整份 cron 回执（{ record }）」与「裸 record」两种形态 ──
if (!artifactArg) {
  process.stderr.write('ablation-ingest: 缺 --artifact <json 文件>\n');
  process.exit(2);
}
const artifactAbs = path.resolve(ROOT, artifactArg);
if (!fs.existsSync(artifactAbs)) {
  process.stderr.write(`ablation-ingest: artifact 不存在：${artifactAbs}\n`);
  process.exit(2);
}

let artifact;
try {
  artifact = JSON.parse(fs.readFileSync(artifactAbs, 'utf8'));
} catch (err) {
  process.stderr.write(`ablation-ingest: artifact 不是合法 JSON：${err.message}\n`);
  process.exit(2);
}
const record = artifact && typeof artifact === 'object' && 'record' in artifact ? artifact.record : artifact;

const reasons = validate(record);
if (reasons.length > 0) {
  process.stderr.write(`ablation-ingest: record 校验失败：${reasons.join('；')}\n`);
  process.exit(2);
}

// H1：缺类别 ⇒ 按权威口径现算回填；已有类别已在 validate 闭集内校验。
if (record.run_class == null) {
  record.run_class = classifyRunClass({
    finished_at: record.finished_at ?? null,
    snapshot: { clean: !!record.snapshot.clean, isolated: !!record.snapshot.isolated },
    mode: record.mode,
  });
}

const { records: existing, bad } = readLedgerRecords();
const seenRunIds = new Set(existing.map((r) => r?.run_id).filter(Boolean));
const distinctBases = new Set(existing.map((r) => r?.snapshot?.commit_sha).filter((v) => v != null));

const skipped = seenRunIds.has(record.run_id);
if (skipped) {
  const out = {
    ingested: false,
    skipped: true,
    reason: `run_id=${record.run_id} 已在台账（幂等）`,
    ledger: LEDGER_REL,
    records: existing.length,
    base_sha_rounds: distinctBases.size,
  };
  if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else console.log(`ablation-ingest: ${out.reason}；台账 ${existing.length} 条，底座轮数 ${distinctBases.size}`);
  process.exit(0);
}

// ── append-only：只追加，不改旧行；目录不存在则建 ──
fs.mkdirSync(path.dirname(LEDGER_ABS), { recursive: true });
fs.appendFileSync(LEDGER_ABS, JSON.stringify(record) + '\n', 'utf8');

const after = [...existing, record];
const afterBases = new Set(after.map((r) => r?.snapshot?.commit_sha).filter((v) => v != null));
const out = {
  ingested: true,
  run_id: record.run_id,
  mode: record.mode,
  run_class: record.run_class,
  triggered_by: record.triggered_by,
  base_sha: record.snapshot.commit_sha,
  ledger: LEDGER_REL,
  records: after.length,
  base_sha_rounds: afterBases.size,
  base_change_crossed: afterBases.size >= 2,
  bad_lines: bad,
};
if (jsonOut) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
else {
  console.log(`ablation-ingest: 已记账 run_id=${record.run_id}（mode=${record.mode} · 类别=${record.run_class}）`);
  console.log(`  台账 ${after.length} 条；底座 sha 轮数 ${afterBases.size}${afterBases.size >= 2 ? '（已跨 ≥1 轮底座变更）' : '（基线轮）'}`);
  if (bad.length > 0) console.log(`  ⚠ 台账既有坏行 ${bad.length} 处（不静默）：${bad.map((b) => `#${b.line}`).join(', ')}`);
}
process.exit(0);
