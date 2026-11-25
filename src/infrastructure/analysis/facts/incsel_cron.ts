/**
 * incsel_cron.ts —— G8 · 周期 reference run 编排与结构化对照台账的**纯域**（零 IO）。
 *
 * ## 边界
 * · 本文件**零 IO**：不读盘、不开库、不起进程、不碰时钟（时刻由调用方传入）；
 *   事件落盘 / 开库 / 子进程编排住 `scripts/ablation-cron.mjs`；本文件只给可复算的纯语义。
 * · 对照读数是**读数**：`reading_only=true`，不进 verify 硬判据、不抬退出码；
 *   漏选（hole）只产出 `widen_required` 扩宽信号（台账留痕），不在编排层就地扩宽。
 * · 信任 fail-closed：触发无命中 ⇒ 不跑；配额超 light 上限 ⇒ 拒跑；快照不隔离 ⇒ 拒跑；
 *   场景缺类 ⇒ 记 missing（不冒充覆盖齐全）。
 *
 * ## 冻结阈值（§5 L1/L4）
 * · L1 周期全量：每 7 天或每 20 次收口提交先到先触发（CI/云端）；
 * · L4 频率：事件触发 + 夜间空闲窗 + 每 20 次收口；
 * · 本机轻量抽样：每次 ≤ 20 文件、jobs ≤ 2、低优先级可被前台开发验证抢占；重量级全量对照在 CI/云端。
 */

/** 触发因闭集（台账 `triggered_by` 逐字一致；新增种类必须先改这里）。 */
export const ABLATION_TRIGGER_KINDS = [
  /** WIDEN / 选材器 / mapper / 边 schema 变更 */
  'widen',
  /** 上次对照 holes > 0（存在漏选） */
  'holes_present',
  /** 本次新增 unknown 边 */
  'unknown_edge',
  /** 每 N 次收口提交（L4 间隔阈值） */
  'commit_interval',
  /** 夜间空闲窗 */
  'night_window',
] as const;

export type AblationTriggerKind = (typeof ABLATION_TRIGGER_KINDS)[number];

/** 编排信号（采集由脚本侧完成；本函数只判命中）。 */
export interface AblationTriggerSignal {
  /** 选材器 / mapper / 边 schema 本轮是否变更 */
  widenChanged: boolean;
  /** 上次参考运行的漏选（洞）数 */
  holes: number;
  /** 本次新增 unknown 边数 */
  unknownEdgesAdded: number;
  /** 距上次参考运行的收口提交数 */
  commitsSinceLast: number;
  /** 当前是否落在夜间空闲窗 */
  inNightWindow: boolean;
  /** commit_interval 触发阈值（L4=20） */
  intervalCommits: number;
}

export interface TriggerEvaluation {
  /** 命中的触发因（有序去重）；空 ⇒ 无触发不跑 */
  fired: AblationTriggerKind[];
  /** 任一触发因命中 ⇒ true；无命中 ⇒ false（无触发不跑） */
  shouldRun: boolean;
}

/**
 * 触发枚举求值（纯函数）。
 * 命中口径：widenChanged ⇒ widen；holes>0 ⇒ holes_present；unknownEdgesAdded>0 ⇒ unknown_edge；
 * commitsSinceLast ≥ intervalCommits ⇒ commit_interval；inNightWindow ⇒ night_window。
 * 阈值 ≤0 / 负 commits 按 0 处理，不据此误触发。
 */
export function evaluateTriggers(signal: AblationTriggerSignal): TriggerEvaluation {
  const fired: AblationTriggerKind[] = [];
  if (signal.widenChanged) fired.push('widen');
  if (signal.holes > 0) fired.push('holes_present');
  if (signal.unknownEdgesAdded > 0) fired.push('unknown_edge');
  if (Number(signal.commitsSinceLast) >= Number(signal.intervalCommits) && Number(signal.intervalCommits) > 0) {
    fired.push('commit_interval');
  }
  if (signal.inNightWindow) fired.push('night_window');
  return { fired, shouldRun: fired.length > 0 };
}

/** C 九类抽样场景闭集（非随机改动集；每类 ≥1 样本）。 */
export const ABLATION_SCENARIO_CLASSES = [
  'dynamic_import',
  'reflection',
  'generated',
  'java_delegate',
  'cache_skip',
  'verifier_change',
  'retired_object',
  'stale_evidence',
  'pollution',
] as const;

export type AblationScenarioClass = (typeof ABLATION_SCENARIO_CLASSES)[number];

/** 本机轻量抽样配额（§5 L4）：≤20 文件、jobs ≤2；重量级全量对照在 CI/云端。 */
export const LIGHT_SAMPLE_MAX_FILES = 20;
export const LIGHT_SAMPLE_MAX_JOBS = 2;

export type RunMode = 'light' | 'full';

export interface SamplingQuota {
  files: number;
  jobs: number;
  mode: RunMode;
}

export interface QuotaCheck {
  ok: boolean;
  reasons: string[];
  files: number;
  jobs: number;
}

/**
 * 配额校验（纯函数）。
 * · light：files ≤ LIGHT_SAMPLE_MAX_FILES 且 jobs ≤ LIGHT_SAMPLE_MAX_JOBS；
 * · full：不压本机轻量上限（留 CI/云端全量对照）。
 * 超配额 ⇒ ok=false + 具体原因（fail-closed，不放行）。
 */
export function validateSamplingQuota(sample: SamplingQuota): QuotaCheck {
  const reasons: string[] = [];
  const files = Number(sample.files);
  const jobs = Number(sample.jobs);
  if (!Number.isFinite(files) || files < 0 || !Number.isFinite(jobs) || jobs < 0) {
    reasons.push(`配额非法：files=${sample.files} jobs=${sample.jobs}`);
  }
  if (sample.mode === 'light') {
    if (files > LIGHT_SAMPLE_MAX_FILES) {
      reasons.push(`light 抽样文件数 ${files} > 上限 ${LIGHT_SAMPLE_MAX_FILES}`);
    }
    if (jobs > LIGHT_SAMPLE_MAX_JOBS) {
      reasons.push(`light 并发 ${jobs} > 上限 ${LIGHT_SAMPLE_MAX_JOBS}`);
    }
  }
  return { ok: reasons.length === 0, reasons, files, jobs };
}

/** 场景覆盖核对（纯函数）：九类每类 ≥1 非空样本。 */
export interface ScenarioCoverage {
  covered: AblationScenarioClass[];
  missing: AblationScenarioClass[];
  ok: boolean;
}

export function coverageOfScenarios(
  assignments: Partial<Record<AblationScenarioClass, readonly string[]>>,
): ScenarioCoverage {
  const covered: AblationScenarioClass[] = [];
  const missing: AblationScenarioClass[] = [];
  for (const cls of ABLATION_SCENARIO_CLASSES) {
    const samples = assignments[cls];
    if (samples && samples.some((s) => String(s).trim().length > 0)) covered.push(cls);
    else missing.push(cls);
  }
  return { covered, missing, ok: missing.length === 0 };
}

/** 隔离快照标识（纯函数；路径归一由调用方给绝对路径，本函数只做字符串比较）。 */
export interface SnapshotRef {
  snapshot_id: string;
  isolated: boolean;
  reasons: string[];
}

/**
 * 隔离判定：必须干净快照 + 独立 worktree（路径 ≠ 活工作树）；禁在活工作树跑。
 * 任一不满足 ⇒ isolated=false + 原因（fail-closed）。
 */
export function snapshotRefOf(input: {
  commitSha: string | null;
  worktreePath: string | null;
  clean: boolean;
  liveWorktree: string;
}): SnapshotRef {
  const reasons: string[] = [];
  const worktree = String(input.worktreePath ?? '').replace(/\\/g, '/');
  const live = String(input.liveWorktree ?? '').replace(/\\/g, '/');
  if (!input.clean) reasons.push('快照不干净（活工作树有未提交改动）');
  if (!worktree) reasons.push('缺独立 worktree 路径');
  else if (live && worktree === live) reasons.push('worktree 就是活工作树（禁在活树跑）');
  const snapshot_id = input.commitSha ? `snapshot:${input.commitSha.slice(0, 12)}` : 'snapshot:unpinned';
  return { snapshot_id, isolated: reasons.length === 0, reasons };
}

/** 一条周期参考运行的结构化台账记录（append-only JSONL 落盘由脚本侧完成）。 */
export interface AblationRunRecord {
  schema: 1;
  run_id: string;
  triggered_by: AblationTriggerKind[];
  started_at: string;
  finished_at: string | null;
  snapshot: {
    commit_sha: string | null;
    worktree: string | null;
    clean: boolean;
    isolated: boolean;
  };
  preemption: { preempted: boolean; reason: string | null };
  mode: RunMode;
  quota: { files: number; jobs: number };
  selection: string[];
  full_red: string[];
  holes: string[];
  skipped: string[];
  disturbing: string[];
  must_run: string[];
  shadow_coverage: string[];
  scenario_coverage: Partial<Record<AblationScenarioClass, readonly string[]>>;
  /** 漏选 ⇒ 选材 fail-closed 扩宽信号（记录留痕，不在编排层就地扩宽） */
  widen_required: boolean;
  /** 对照读数：不进 verify 硬判据、不抬退出码 */
  reading_only: true;
}

export interface AblationRecordInput {
  run_id: string;
  triggered_by: readonly AblationTriggerKind[];
  started_at: string;
  finished_at?: string | null;
  snapshot: { commit_sha: string | null; worktree: string | null; clean: boolean; isolated: boolean };
  preemption?: { preempted: boolean; reason: string | null };
  mode: RunMode;
  quota: { files: number; jobs: number };
  selection?: readonly string[];
  full_red?: readonly string[];
  holes?: readonly string[];
  skipped?: readonly string[];
  disturbing?: readonly string[];
  must_run?: readonly string[];
  shadow_coverage?: readonly string[];
  scenario_coverage?: Partial<Record<AblationScenarioClass, readonly string[]>>;
}

/** 装配一条台账记录（纯函数；排序归一，未知字段不进记录）。 */
export function buildAblationRecord(input: AblationRecordInput): AblationRunRecord {
  const holes = [...(input.holes ?? [])].sort();
  const list = (v: readonly string[] | undefined) => [...(v ?? [])].sort();
  return {
    schema: 1,
    run_id: input.run_id,
    triggered_by: [...input.triggered_by],
    started_at: input.started_at,
    finished_at: input.finished_at ?? null,
    snapshot: { ...input.snapshot },
    preemption: input.preemption ?? { preempted: false, reason: null },
    mode: input.mode,
    quota: { ...input.quota },
    selection: list(input.selection),
    full_red: list(input.full_red),
    holes,
    skipped: list(input.skipped),
    disturbing: list(input.disturbing),
    must_run: list(input.must_run),
    shadow_coverage: list(input.shadow_coverage),
    scenario_coverage: { ...(input.scenario_coverage ?? {}) },
    widen_required: holes.length > 0,
    reading_only: true,
  };
}

/** 影子覆盖 / 漏选趋势走向（纯函数；不足两次 ⇒ insufficient，不硬判方向）。 */
export type TrendDirection = 'improving' | 'regressing' | 'flat' | 'insufficient';

export interface ShadowTrendSummary {
  runs: number;
  holes: number[];
  shadow_coverage: number[];
  direction: TrendDirection;
}

/**
 * 按记录顺序汇总趋势：holes 与影子覆盖条数逐次递减 ⇒ improving；递增 ⇒ regressing；
 * 持平 ⇒ flat；runs < 2 ⇒ insufficient（样本不足，不冒充趋势）。
 */
export function summarizeShadowTrend(records: readonly AblationRunRecord[]): ShadowTrendSummary {
  const holes = records.map((r) => r.holes.length);
  const shadow = records.map((r) => r.shadow_coverage.length);
  if (records.length < 2) {
    return { runs: records.length, holes, shadow_coverage: shadow, direction: 'insufficient' };
  }
  const deltaHoles = holes[holes.length - 1] - holes[0];
  const deltaShadow = shadow[shadow.length - 1] - shadow[0];
  const direction: TrendDirection =
    deltaHoles < 0 && deltaShadow <= 0 ? 'improving'
    : deltaHoles > 0 || deltaShadow > 0 ? 'regressing'
    : 'flat';
  return { runs: records.length, holes, shadow_coverage: shadow, direction };
}

/**
 * L2 连续零 hole 观察期门槛（起步值，已冻结）：连续 N 次 reference run holes=0。
 * ★ holes=0 是退场必要非充分条件（§M1）：本函数只数连续零洞次数，不背书盲区闭合；
 *   连续积累本身在阶段 3 / CI 观察期完成，本文件只给可复算的纯语义。
 */
export const OBSERVATION_HOLES_ZERO_RUNS = 10;

export type ObservationWindowReason = 'eligible' | 'insufficient-runs' | 'hole-in-window';

export interface ObservationWindowResult {
  /** 末尾连续 holes=0 的次数（从最后一条往前数，遇任一 holes>0 即中断） */
  consecutiveZero: number;
  /** 台账记录总数 */
  runs: number;
  /** 零洞门槛 N（L2 起步 10） */
  threshold: number;
  /** 连续零洞次数 ≥ N ⇒ true；不足或窗口内有洞 ⇒ false */
  eligible: boolean;
  /** 读数口径：eligible=达标；insufficient-runs=记录数/连续零洞不足 N；hole-in-window=末尾连续段之前（或最近一条）存在漏选洞 */
  reason: ObservationWindowReason;
}

/**
 * ⑤ 观察期机制（纯函数，零 IO）：数台账末尾连续 holes=0 的次数，对照 L2 门槛 N。
 *
 * 口径：
 * · 从最后一条记录向前遍历，`holes.length === 0` 计入连续段；遇到第一条 holes>0 即中断；
 * · `eligible = consecutiveZero >= N`；N ≤0 按 OBSERVATION_HOLES_ZERO_RUNS 起步值；
 * · 最近一条就有洞 ⇒ consecutiveZero=0，reason='hole-in-window'（回退条件：出现漏选即重新计观察期）；
 * · 记录为空 ⇒ runs=0，insufficient，不冒充达标。
 * ★ 本判定只看 holes 计数；unknown 占比 / undetermined 占比 / 边型完备性等并列准入证据不在本函数内。
 */
export function evaluateObservationWindow(
  records: readonly AblationRunRecord[],
  threshold: number = OBSERVATION_HOLES_ZERO_RUNS,
): ObservationWindowResult {
  const N = Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : OBSERVATION_HOLES_ZERO_RUNS;
  const runs = records.length;
  let consecutiveZero = 0;
  let sawHole = false;
  for (let i = runs - 1; i >= 0; i--) {
    if ((records[i].holes?.length ?? 0) === 0) {
      consecutiveZero++;
    } else {
      sawHole = true;
      break;
    }
  }
  const eligible = consecutiveZero >= N;
  const reason: ObservationWindowReason = eligible
    ? 'eligible'
    : sawHole
      ? 'hole-in-window'
      : 'insufficient-runs';
  return { consecutiveZero, runs, threshold: N, eligible, reason };
}
