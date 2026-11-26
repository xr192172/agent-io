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

/**
 * 观察期落账类别（H1 诚实分母）—— 只有 `full-control` 足额对照进观察期分母，
 * 其余三类的平凡空 holes **不构成漏选闭合证明**，不计零洞段、不进分母。
 * · `dry`：未起真实对照（finished_at=null / dry-run 占位）；
 * · `untrusted`：跑了对照但快照不可信（脏树 / 非独立 worktree / 非干净快照）；
 * · `sampled`：快照可信但 light 抽样（未达足额 quota）；
 * · `full-control`：可信快照 + 足额 quota（mode=full）+ 对照完成，唯一计入观察期的类别。
 */
export type RunClass = 'dry' | 'untrusted' | 'sampled' | 'full-control';

/**
 * 快照身份可证明性档位（B-M1 诚实收据）：
 * · `pinned`：git 可用且 HEAD commit + 内容树哈希均取到，被测副本身份可证明；
 * · `unprovable`：git 不可用 / 非 git 仓 / 取 HEAD 或树哈希失败 ⇒ 副本身份无法证明，
 *   不得用空 ref 或旧指针冒充已钉；该档不进底座轮数计数。
 */
export type SnapshotShaStatus = 'pinned' | 'unprovable';

/** 观察期窗口长度 K（周），已冻结：2 周。 */
export const OBSERVATION_WINDOW_DAYS = 14;

/** 观察期起钟（window_start，已录台账）；窗口内记录才进诚实分母。 */
export const OBSERVATION_WINDOW_START = '2026-11-25T18:53:43+08:00';

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
  /** 快照身份可证明性档位；unprovable 表示副本身份未能取到内容指纹。 */
  sha_status: SnapshotShaStatus;
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
  shaStatus?: SnapshotShaStatus;
}): SnapshotRef {
  const reasons: string[] = [];
  const worktree = String(input.worktreePath ?? '').replace(/\\/g, '/');
  const live = String(input.liveWorktree ?? '').replace(/\\/g, '/');
  if (!input.clean) reasons.push('快照不干净（活工作树有未提交改动）');
  if (!worktree) reasons.push('缺独立 worktree 路径');
  else if (live && worktree === live) reasons.push('worktree 就是活工作树（禁在活树跑）');
  // 缺省档位：有 commitSha ⇒ pinned；无 ⇒ unprovable（显式档优先于缺省推导）。
  const shaStatus: SnapshotShaStatus = input.shaStatus ?? (input.commitSha ? 'pinned' : 'unprovable');
  const snapshot_id = shaStatus === 'unprovable'
    ? 'snapshot:unprovable'
    : input.commitSha ? `snapshot:${input.commitSha.slice(0, 12)}` : 'snapshot:unpinned';
  return { snapshot_id, isolated: reasons.length === 0, reasons, sha_status: shaStatus };
}

/** 台账快照身份字段（cron 采集、ingest 落账共用；纯语义不绑定采集手段）。 */
export interface AblationSnapshot {
  /** HEAD commit ref sha；git 不可用时为 null。 */
  commit_sha: string | null;
  /** 被测副本内容树哈希（`HEAD^{tree}`，git 原生跟踪文件内容树指纹）；取不到为 null。 */
  tree_sha: string | null;
  /** 快照身份可证明性档位；unprovable 不进底座轮数计数。 */
  sha_status: SnapshotShaStatus;
  worktree: string | null;
  clean: boolean;
  isolated: boolean;
}

/** 一条周期参考运行的结构化台账记录（append-only JSONL 落盘由脚本侧完成）。 */
export interface AblationRunRecord {
  schema: 1;
  run_id: string;
  triggered_by: AblationTriggerKind[];
  started_at: string;
  finished_at: string | null;
  snapshot: AblationSnapshot;
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
  /** 落账类别（H1 诚实分母）：仅 full-control 进观察期分母 */
  run_class: RunClass;
  /** 对照读数：不进 verify 硬判据、不抬退出码 */
  reading_only: true;
}

export interface AblationRecordInput {
  run_id: string;
  triggered_by: readonly AblationTriggerKind[];
  started_at: string;
  finished_at?: string | null;
  snapshot: {
    commit_sha: string | null;
    tree_sha?: string | null;
    sha_status?: SnapshotShaStatus;
    worktree: string | null;
    clean: boolean;
    isolated: boolean;
  };
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
  /** 显式指定类别；缺省由 `classifyRunClass` 按快照/完成态/配额现算（旧台账行现场分类兼容）。 */
  run_class?: RunClass;
}

/**
 * 落账类别判定（纯函数，fail-closed 从严；优先级自上而下）：
 * 1. 未完成对照（`finished_at == null`）⇒ `dry`：占位跑，无对照读数；
 * 2. 快照不可信（脏树 / 非独立 worktree）⇒ `untrusted`：读数不背书；
 * 3. 非足额 quota（`mode !== 'full'`）⇒ `sampled`：light 抽样，平凡空不证明闭合；
 * 4. 否则 ⇒ `full-control`：可信快照 + 足额 quota + 对照完成，唯一进观察期分母的类别。
 */
export function classifyRunClass(record: {
  finished_at: string | null;
  snapshot: { clean: boolean; isolated: boolean };
  mode: RunMode;
}): RunClass {
  if (record.finished_at == null) return 'dry';
  if (!record.snapshot.clean || !record.snapshot.isolated) return 'untrusted';
  if (record.mode !== 'full') return 'sampled';
  return 'full-control';
}

/**
 * 底座轮数计数口径（B-M1）：返回身份可证明（pinned）的 commit_sha；
 * `unprovable` 档返回 null（不进底座轮数，避免空档/旧指针虚增轮数）。
 * 旧台账行缺 `sha_status` 字段时按 commit_sha 非 null 兼容计入（向后兼容）。
 */
export function pinnedBaseSha(record: { snapshot?: AblationSnapshot | null } | null | undefined): string | null {
  const snap = record?.snapshot;
  if (!snap) return null;
  if (snap.sha_status === 'unprovable') return null;
  return snap.commit_sha ?? null;
}

/** 装配一条台账记录（纯函数；排序归一，未知字段不进记录）。 */
export function buildAblationRecord(input: AblationRecordInput): AblationRunRecord {
  const holes = [...(input.holes ?? [])].sort();
  const list = (v: readonly string[] | undefined) => [...(v ?? [])].sort();
  const finishedAt = input.finished_at ?? null;
  const inSnap = input.snapshot;
  const snapshot: AblationSnapshot = {
    commit_sha: inSnap.commit_sha ?? null,
    tree_sha: inSnap.tree_sha ?? null,
    sha_status: inSnap.sha_status ?? (inSnap.commit_sha ? 'pinned' : 'unprovable'),
    worktree: inSnap.worktree ?? null,
    clean: !!inSnap.clean,
    isolated: !!inSnap.isolated,
  };
  const runClass = input.run_class ?? classifyRunClass({ finished_at: finishedAt, snapshot, mode: input.mode });
  return {
    schema: 1,
    run_id: input.run_id,
    triggered_by: [...input.triggered_by],
    started_at: input.started_at,
    finished_at: finishedAt,
    snapshot,
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
    run_class: runClass,
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

export type ObservationWindowReason =
  | 'eligible'
  | 'insufficient-runs'
  | 'hole-in-window'
  | 'ineligible-class'
  | 'outside-window';

export interface ObservationWindowResult {
  /** 末尾连续 holes=0 的次数（仅足额对照段内，从最后一条纳入记录往前数，遇任一 holes>0 即中断） */
  consecutiveZero: number;
  /** 台账记录总数（含 dry/抽样/非对照，仅披露不进分母） */
  runs: number;
  /** 纳入观察期分母的足额对照条数（full-control 且窗口内） */
  eligibleRuns: number;
  /** 四类落账计数（dry / untrusted / sampled / full-control） */
  classified: Record<RunClass, number>;
  /** 类别合规但落在时间窗外的条数 */
  outsideWindow: number;
  /** 窗口内足额对照段中带全量红样本（full_red>0）的条数（红哨兵披露，中断连续零段） */
  redSamples: number;
  /** 零洞门槛 N（L2 起步 10） */
  threshold: number;
  /** 连续零洞次数 ≥ N ⇒ true；不足 / 窗口内有洞 / 无足额对照 ⇒ false */
  eligible: boolean;
  /** 读数口径：eligible=达标；insufficient-runs=足额对照条数/连续零洞不足 N；hole-in-window=纳入段内存在漏选洞；ineligible-class=无足额对照（全为 dry/抽样/非对照）；outside-window=记录均在窗口外 */
  reason: ObservationWindowReason;
  /** 窗口起钟 ISO（回显入参或冻结默认） */
  windowStart: string;
  /** 窗口长度（天，K=2 周=14） */
  windowKDays: number;
}

/**
 * ⑤ 观察期机制（纯函数，零 IO，H1 诚实分母）。
 *
 * 口径：
 * · **只有 `full-control`（可信快照 + 足额 quota + 对照完成）且 `started_at` 落在窗口内**的记录进分母；
 *   dry / untrusted / sampled 三类的平凡空 holes **不构成漏选闭合证明**：不计零洞段、不进分母；
 * · 从纳入集合最后一条向前遍历，`holes.length === 0` 计入连续段；纳入段内第一条 holes>0 即中断（真实洞重置连续零洞）；
 * · `eligible = consecutiveZero >= N`；N ≤0 按 OBSERVATION_HOLES_ZERO_RUNS 起步值；
 * · 最近纳入记录就有洞 ⇒ consecutiveZero=0，reason='hole-in-window'（回退条件：出现漏选即重新计观察期）；
 * · 无足额对照记录 ⇒ 不冒充达标：全为非足额类别记 'ineligible-class'，均在窗外记 'outside-window'。
 * ★ 本判定只数 holes 与类别/时间窗；unknown 占比 / undetermined 占比 / 边型完备性等并列准入证据不在本函数内。
 */
export function evaluateObservationWindow(
  records: readonly AblationRunRecord[],
  threshold: number = OBSERVATION_HOLES_ZERO_RUNS,
  opts: { windowStart?: string; windowKDays?: number } = {},
): ObservationWindowResult {
  const N = Number.isFinite(threshold) && threshold > 0 ? Math.floor(threshold) : OBSERVATION_HOLES_ZERO_RUNS;
  const windowStart = opts.windowStart ?? OBSERVATION_WINDOW_START;
  const kDays = opts.windowKDays;
  const windowKDays = Number.isFinite(kDays) && (kDays as number) > 0 ? Math.floor(kDays as number) : OBSERVATION_WINDOW_DAYS;
  const startMs = Date.parse(windowStart);
  const endMs = Number.isFinite(startMs) ? startMs + windowKDays * 86_400_000 : NaN;

  const classified: Record<RunClass, number> = { dry: 0, untrusted: 0, sampled: 0, 'full-control': 0 };
  const eligible: AblationRunRecord[] = [];
  let outsideWindow = 0;

  for (const rec of records) {
    const cls: RunClass = rec.run_class ?? classifyRunClass(rec);
    classified[cls] = (classified[cls] ?? 0) + 1;
    if (cls !== 'full-control') continue;
    const ts = Date.parse(rec.started_at);
    const inWindow = Number.isFinite(startMs) && Number.isFinite(ts) && ts >= startMs && ts < endMs;
    if (!inWindow) {
      outsideWindow++;
      continue;
    }
    eligible.push(rec);
  }

  let consecutiveZero = 0;
  let sawHole = false;
  let redSamples = 0;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const holesN = eligible[i].holes?.length ?? 0;
    const redN = eligible[i].full_red?.length ?? 0;
    if (redN > 0) redSamples++;
    // 真实洞（holes>0）或全量红样本（full_red>0）都中断连续零段：任一真实红/洞 ⇒ 重新计观察期。
    if (holesN === 0 && redN === 0) {
      consecutiveZero++;
    } else {
      sawHole = true;
      break;
    }
  }

  const eligibleRuns = eligible.length;
  const eligiblePass = consecutiveZero >= N;
  let reason: ObservationWindowReason;
  if (eligiblePass) {
    reason = 'eligible';
  } else if (eligibleRuns === 0) {
    reason = records.length === 0
      ? 'insufficient-runs'
      : outsideWindow > 0 && classified['full-control'] === outsideWindow
        ? 'outside-window'
        : 'ineligible-class';
  } else if (sawHole) {
    reason = 'hole-in-window';
  } else {
    reason = 'insufficient-runs';
  }

  return {
    consecutiveZero,
    runs: records.length,
    eligibleRuns,
    classified,
    outsideWindow,
    redSamples,
    threshold: N,
    eligible: eligiblePass,
    reason,
    windowStart,
    windowKDays,
  };
}
