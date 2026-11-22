/**
 * attempt_recorder.ts —— 正式 runner（`run_tests.ts`）的 Attempt 事件记录器。
 *
 * ## 职责边界（P2 硬约束）
 * · 只在**解析出实际命令之后、spawn 之前**落 `attempt_started`；退出后落 `attempt_finished`。
 * · `spawnSync` 同步句柄拿不到子进程 pid ⇒ `process.pid='unavailable'`、`observation='unknown'`，
 *   **绝不编造 pid**；进程活性首切片无可靠探针 ⇒ 读端只能是 unknown（不凭 TTL/pid 判 alive/dead）。
 * · Attempt 是「正式 runner 的一次具体调用」；同一 Run 允许多个顺序 Attempt（不实现重试/调度分组）。
 * · 事件是审计旁路：追加失败回 `error`（不假定已记），不阻断测试执行；runner 通道无独立持久回执，事件缺失只能靠现场 Git 漂移侧证（见 recover.ts#reconciliation）；
 *   非任务上下文的通用 runner 保持可用 —— 未记录必须在回执里**显式标注原因**，不静默。
 */
import { createHash } from 'node:crypto';
import { gitSnapshot } from '../../../infrastructure/git.js';
import { resolveSessionId } from '../../../domain/actor_spec.js';
import { getDesignSheet } from '../../../infrastructure/storage.js';
import { todosForNode, taskOfNode, type TaskSpec } from '../../../domain/task_schema.js';
import { isLeaseHolding, leaseGenerationOf } from '../../../domain/task_machine.js';
import {
  appendRunEvent,
  ensureRunStarted,
  type AppendEventResult,
} from './run_events.js';
import type { ContextCheck } from '../../../domain/run_events.js';

/** 执行上下文（来自工具入参；缺任务字段 = 通用 runner，记录不可用要显式）。 */
export interface AttemptContext {
  feature?: string;
  node_id?: string;
  actor?: string;
  lease_generation?: number;
  via?: string;
  session?: string;
}

export interface AttemptStartFact {
  command: string;
  filter?: string;
  cwd: string;
  timeoutMs?: number;
}

/** 一次 Attempt 记录的回执（`recorded=false` 时 `reason` 必须说清为什么没记）。 */
export interface AttemptRecord {
  recorded: boolean;
  reason?: string;
  run_id?: string;
  attempt_ref?: string;
  started?: AppendEventResult;
  finished?: AppendEventResult;
  git_started?: AppendEventResult;
  git_finished?: AppendEventResult;
  /** run_started 幂等确保的回执（失败时保留缺口读数） */
  run_started?: AppendEventResult;
  /** 开工时对当前 Task 事实的校验；`matched=false` ⇒ 不得当当前代际活跃 Attempt */
  context_check?: ContextCheck;
  /** finish 事件是否真正落库（false ⇒ 事件缺失只能靠持久账/漂移侧证） */
  append_ok?: boolean;
  /** finish 落库失败原因；成功 ⇒ null */
  append_error?: string | null;
}

function canonicalInput(fact: AttemptStartFact): string {
  return JSON.stringify({
    command: fact.command,
    filter: fact.filter ?? null,
    cwd: fact.cwd,
    timeoutMs: fact.timeoutMs ?? null,
  });
}

function inputFingerprint(fact: AttemptStartFact): string {
  return createHash('sha1').update(canonicalInput(fact), 'utf8').digest('hex');
}

function sessionOf(ctx: AttemptContext): string | null {
  const s = String(ctx.session ?? '').trim();
  return s ? s : resolveSessionId();
}

/** 按 feature/node_id 从 DSL 取当前任务卡（与 recover.ts 同一套域辅助，不另造查找口径）。 */
function lookupCard(
  feature: string,
  nodeId: string,
): { card: TaskSpec | null; sheetError: string | null } {
  let dsl: ReturnType<typeof getDesignSheet>;
  try {
    dsl = getDesignSheet(feature);
  } catch (e) {
    return { card: null, sheetError: (e as Error).message };
  }
  if (!dsl) return { card: null, sheetError: 'missing' };
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  const byTodo = todosForNode(nodeId, dsl.todos);
  if (byTodo.length) {
    const open = byTodo.filter((t) => t.state !== 'done' && t.state !== 'void');
    return { card: (open.length ? open[open.length - 1] : byTodo[byTodo.length - 1]) ?? null, sheetError: null };
  }
  return { card: taskOfNode(node, dsl.todos) ?? null, sheetError: null };
}

/**
 * ★ P2 上下文校验（不信任自报 generation）：有 task 上下文时，从当前 Task 事实验证
 *   持租状态 / owner / 代际；任一不符 ⇒ `matched=false`，读端不得把这次 Attempt 挂成当前代际活跃。
 *   校验失败（册读不到 / 卡不存在）同样 unmatched —— 不可验证 ≠ 有效。
 */
function validateContext(ctx: AttemptContext): ContextCheck {
  const feature = ctx.feature?.trim();
  const nodeId = ctx.node_id?.trim();
  const base: ContextCheck = {
    matched: false,
    reason: null,
    current_owner: null,
    current_generation: null,
    current_state: null,
  };
  if (!feature || !nodeId) return { ...base, reason: 'no-task-context' };
  const { card, sheetError } = lookupCard(feature, nodeId);
  if (!card) {
    return {
      ...base,
      reason: sheetError ? 'design-sheet-unreadable' : 'task-not-found',
    };
  }
  const currentGeneration = leaseGenerationOf(card);
  const owner = card.owner ?? null;
  const holding = isLeaseHolding(card.state as never);
  const actor = String(ctx.actor ?? '').trim();
  const ownerMatch = actor !== '' && actor === String(owner ?? '').trim();
  const generationMatch =
    typeof ctx.lease_generation === 'number' && ctx.lease_generation === currentGeneration;
  const current: ContextCheck = {
    matched: false,
    reason: null,
    current_owner: owner,
    current_generation: currentGeneration,
    current_state: String(card.state),
  };
  if (!holding) return { ...current, reason: 'task-not-holding-lease' };
  if (!ownerMatch) return { ...current, reason: 'owner-mismatch' };
  if (!generationMatch) return { ...current, reason: 'generation-mismatch' };
  return { ...current, matched: true };
}

function contextArgs(ctx: AttemptContext): {
  task: { feature: string; node_id: string } | null;
  owner: string | null;
  leaseGeneration: number | null;
  actor: string | null;
  via: string | null;
  session: string | null;
} {
  return {
    task: ctx.feature && ctx.node_id ? { feature: ctx.feature, node_id: ctx.node_id } : null,
    owner: ctx.actor ?? null,
    leaseGeneration: typeof ctx.lease_generation === 'number' ? ctx.lease_generation : null,
    actor: ctx.actor ?? null,
    via: ctx.via ?? 'run_tests',
    session: sessionOf(ctx),
  };
}

/** 任务上下文是否齐（feature + node_id 都给了）；不齐 = 通用 runner 档。 */
export function hasTaskContext(ctx: AttemptContext | undefined): boolean {
  return Boolean(ctx?.feature?.trim() && ctx?.node_id?.trim());
}

/**
 * 落 `attempt_started`（含 `run_started` 幂等确保 + 开工边界 `git_observed`）。
 * @returns 记录回执；非任务上下文 ⇒ `recorded=false, reason='no-task-context'`（通用 runner 可用）。
 */
export function startAttempt(
  projectRoot: string,
  ctx: AttemptContext | undefined,
  attemptRef: string,
  fact: AttemptStartFact,
): AttemptRecord {
  if (!hasTaskContext(ctx)) {
    return { recorded: false, reason: 'no-task-context：通用 runner 未给 feature/node_id，事件不记（上下文不可用，非静默）' };
  }
  const c = contextArgs(ctx!);
  // ★ 不信任自报 generation：开工前从当前 Task 事实验证持租/owner/代际；不匹配记 unmatched，
  //   读端据此排除出当前代际活跃 Attempt（约束 3 / 5）。
  const check = validateContext(ctx!);
  const startedAt = new Date().toISOString();
  const fp = inputFingerprint(fact);
  const started: AppendEventResult = appendRunEvent(projectRoot, {
    ...c,
    kind: 'attempt_started',
    dedupeKey: `start:${attemptRef}`,
    body: {
      attempt_ref: attemptRef,
      context_check: check,
      input_fingerprint: fp,
      input: { command: fact.command, filter: fact.filter ?? null, cwd: fact.cwd, timeoutMs: fact.timeoutMs ?? null },
      // ★ spawnSync 同步句柄：pid 拿不到 ⇒ unavailable，observation unknown（约束 5c / 8）。
      process: { pid: 'unavailable', observation: 'unknown', note: 'spawnSync 同步句柄，拿不到子进程 pid' },
      started_at: startedAt,
    },
  });
  const startedRun = ensureRunStarted(projectRoot, c);
  const git: AppendEventResult = appendRunEvent(projectRoot, {
    ...c,
    kind: 'git_observed',
    dedupeKey: `git:${attemptRef}:start`,
    body: { stage: 'attempt_started', snapshot: gitSnapshot(fact.cwd) },
  });
  // ★ F5：`recorded` 必须反映 **start 事件真实落库**结果 —— 上下文齐（feature/node_id 都给了）
  //   ≠ 已落库（开库/写入可能失败）。落不上 ⇒ recorded=false + 错误原因；finish 侧据此不再补记。
  const recorded = started.ok;
  return {
    recorded,
    reason: recorded ? undefined : `attempt_started 未落库：${started.error ?? '未知错误'}`,
    run_id: started.run_id,
    attempt_ref: attemptRef,
    started,
    git_started: git,
    context_check: check,
    // run_started 的回执单独留着，便于读端对账缺口
    ...(startedRun.ok ? {} : { run_started: startedRun }),
  };
}

export interface AttemptFinishFact {
  command: string;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  /** 日志/回执引用（不复制整段输出；尾部由 runner 结果返回） */
  log_ref: Record<string, unknown>;
}

/** finish 落库回执：`append_ok` 显式陈述 finished 事件是否真正落库（失败带 error）。 */
export interface AttemptFinishRecord {
  finished: AppendEventResult;
  git_finished: AppendEventResult;
  /** attempt_finished 事件是否真正落库（false ⇒ 事件缺失只能靠持久账/漂移侧证，不把警告当对账） */
  append_ok: boolean;
  /** finished 落库失败原因；成功 ⇒ null */
  error: string | null;
}

/** 落 `attempt_finished` + 收尾边界 `git_observed`。只在 `startAttempt.recorded` 时调用。 */
export function finishAttempt(
  projectRoot: string,
  ctx: AttemptContext | undefined,
  attemptRef: string,
  fact: AttemptFinishFact,
  cwd: string,
): AttemptFinishRecord | null {
  if (!hasTaskContext(ctx)) return null;
  const c = contextArgs(ctx!);
  const check = validateContext(ctx!);
  const finished: AppendEventResult = appendRunEvent(projectRoot, {
    ...c,
    kind: 'attempt_finished',
    dedupeKey: `finish:${attemptRef}`,
    body: {
      attempt_ref: attemptRef,
      context_check: check,
      exit_code: fact.exit_code,
      signal: fact.signal,
      timed_out: fact.timed_out,
      completed: fact.exit_code === 0 && !fact.signal && !fact.timed_out,
      // ★ interrupted/unknown 由读端派生：这里只记自己确知的退出事实。
      log_ref: fact.log_ref,
      finished_at: new Date().toISOString(),
    },
  });
  const git: AppendEventResult = appendRunEvent(projectRoot, {
    ...c,
    kind: 'git_observed',
    dedupeKey: `git:${attemptRef}:finish`,
    body: { stage: 'attempt_finished', snapshot: gitSnapshot(cwd) },
  });
  return { finished, git_finished: git, append_ok: finished.ok, error: finished.error ?? null };
}
