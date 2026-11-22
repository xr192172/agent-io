/**
 * run_events.ts —— P2「引擎原生可恢复执行」的**纯域**：事件种类、Run 上下文键、Attempt 派生、Checkpoint fold。
 *
 * ## 边界（与 application 层严格分开）
 * · 本文件**零 IO**：不读盘、不开库、不起进程、不碰时钟（除调用方传入的固定时刻外）。
 *   事件的**落盘 / 开库 / 读写**住 `application/observe/runtime/run_events.ts`；本文件只给可复算的纯语义。
 * · **不存当前态**：Run / Attempt / Checkpoint 都是「同一事件前缀」派生出来的读模型 ——
 *   不建 `task_runs` 表，不持久化 status / result_summary / last_checkpoint_seq / current HEAD /
 *   next_step / is_alive / verdict / satisfied（硬约束 2、4）。
 * · actor / via / session 只是审计列，**不授权、不证明存活**；本文件也不拿它们判生死。
 *
 * ## Checkpoint 语义（硬约束 4）
 * Checkpoint = 同一事件前缀经**唯一纯 fold** 得到的 `{ run_id, last_event_seq, digest }`：
 * · digest 只由「同序事件的 seq + kind + 规范化 body」折叠得到；
 * · `built_at` / 实时探测时刻 / 进程探针读数**一律不进 digest** —— 同一前缀重建 digest 必须一致；
 * · 首切片**不建持久投影表**，也不提供模型手存 checkpoint 的 API。
 */
import { createHash } from 'node:crypto';

/** 事件种类闭集（DB CHECK 逐字一致；新增种类必须先改这里 + 迁移 + 触发器）。 */
export const RUN_EVENT_KINDS = [
  'run_started',
  'attempt_started',
  'attempt_finished',
  'source_written',
  'evidence_added',
  'git_observed',
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

/** 一条已落盘事件的读出口（body 已解析回对象；坏行由写端标注，读端不猜）。 */
export interface RunEventRecord {
  /** 行号（DB rowid；只做排序投影，不进 digest） */
  id: number;
  /** 一次执行上下文的稳定身份（见 {@link runIdOf}） */
  run_id: string;
  /** 软引用任务（feature）；无任务上下文 ⇒ null（**不建 FK**） */
  task_feature: string | null;
  /** 软引用任务（节点 id）；无任务上下文 ⇒ null */
  task_node_id: string | null;
  /** 同 run 内的顺序号（UNIQUE(run_id, seq)） */
  seq: number;
  kind: RunEventKind;
  /** 事件落盘时刻（ISO；审计列，不进 digest） */
  at: string;
  /** 执行者（审计；不授权） */
  actor: string | null;
  /** 来源通道（审计；不授权） */
  via: string | null;
  /** 会话 id（审计；不参与授权） */
  session: string | null;
  /** 完整事件体（未知键逐字保留，不静默裁剪） */
  body: Record<string, unknown>;
}

/** Run 上下文键：某 task + owner + lease_generation 下的一次实际执行上下文。 */
export interface RunContextKey {
  feature: string | null;
  node_id: string | null;
  /** 写盘 actor / 领卡 owner（审计 + 上下文分桶；授权仍只认卡上事实） */
  owner: string | null;
  /** 调用方持有的租约代际；取不到 ⇒ null（读端按卡上当前代际判 stale，不据此授写权） */
  lease_generation: number | null;
}

/** 规范化一个可空字符串：null/undefined/空白 ⇒ 'unknown'。 */
function dim(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return s ? s : 'unknown';
}

/**
 * Run 身份的**唯一派生处**（纯函数；同上下文必同 id，不同上下文必分桶）。
 *
 * · 有任务：`run:<feature>/<node_id>/<owner>/g<lease_generation>`；
 * · 无任务上下文：`run:anon/<owner>`（通用 runner 的一次执行；不伪造 task/lease 事实）。
 *
 * ★ 代际取不到时落 `gunknown`：这只是**分桶键**，不是写权证明 —— 授写权仍由既有租约/写闸判。
 */
export function runIdOf(ctx: RunContextKey): string {
  if (ctx.feature && ctx.node_id) {
    const gen = ctx.lease_generation == null ? 'unknown' : String(ctx.lease_generation);
    return `run:${dim(ctx.feature)}/${dim(ctx.node_id)}/${dim(ctx.owner)}/g${gen}`;
  }
  return `run:anon/${dim(ctx.owner)}`;
}

/** 递归排序键的稳定序列化（同对象不同遍历顺序不得换 digest）；undefined 不进对象。 */
function stableStringify(value: unknown, seen: WeakSet<object> = new WeakSet()): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (seen.has(value)) return '"<cyclic>"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stableStringify(v, seen)).join(',')}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * 折叠一条事件前缀 → Checkpoint 读模型。
 *
 * @param events 同 run 的事件（调用方负责按 seq 升序；本函数内再排一次，顺序不由传入方保证）
 * @returns `last_event_seq` = 前缀最后一条的 seq；`digest` = 纯折叠结果；无事件 ⇒ last_event_seq=null、digest=null。
 */
export function foldCheckpoint(
  runId: string,
  events: readonly Pick<RunEventRecord, 'seq' | 'kind' | 'body'>[],
): { run_id: string; last_event_seq: number | null; digest: string | null } {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  if (!ordered.length) return { run_id: runId, last_event_seq: null, digest: null };
  let digest = createHash('sha1').update(`run:${runId}`, 'utf8').digest('hex');
  let lastSeq: number | null = null;
  for (const ev of ordered) {
    lastSeq = ev.seq;
    const body = stableStringify(ev.body ?? {});
    digest = createHash('sha1')
      .update(`${digest}\u0000${ev.seq}\u0000${ev.kind}\u0000${body}`, 'utf8')
      .digest('hex');
  }
  return { run_id: runId, last_event_seq: lastSeq, digest };
}

/** Attempt 的派生结局（读模型，不是落盘状态）。 */
export type AttemptOutcome = 'completed' | 'failed' | 'interrupted';

/** 进程活性派生档（★ 无可靠探针 ⇒ 恒 unknown；不许凭 pid / TTL 伪造 alive/dead）。 */
export type ProcessObservation = 'alive' | 'dead' | 'unknown';

/** 开工时对当前 Task 事实（owner / 代际 / 持租）的校验结果；不匹配 ⇒ 不得挂成当前代际活跃 Attempt。 */
export interface ContextCheck {
  matched: boolean;
  /** 不匹配原因：task-not-found / task-not-holding-lease / owner-mismatch / generation-mismatch / design-sheet-unreadable */
  reason: string | null;
  current_owner: string | null;
  current_generation: number | null;
  current_state: string | null;
}

/** 一次正式 runner 调用的派生视图（attempt_started ↔ attempt_finished 按 attempt_ref 配对）。 */
export interface AttemptView {
  /** 配对键（body.attempt_ref；缺省回退 started seq） */
  attempt_ref: string;
  started_seq: number | null;
  finished_seq: number | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean | null;
  /** completed=退出码 0；failed=非零/信号/超时；interrupted=有 start 无 finish（进程死活未知） */
  outcome: AttemptOutcome;
  /** 进程探针读数；首切片无可靠探针 ⇒ unknown */
  process_observation: ProcessObservation;
  /** started 时记录的输入指纹（命令 / filter / cwd / 输入规范指纹） */
  input_fingerprint: string | null;
  /** 日志 / 回执引用（★ 不复制整段输出；引用既有回执/尾部） */
  log_ref: Record<string, unknown>;
  /** 上下文与当前 Task 事实的校验；matched=false ⇒ 读端不得当当前代际活跃 Attempt */
  context_check: ContextCheck | null;
}

/** 从一条 run 的事件流派生 Attempt 列表（纯函数；started 无 finish ⇒ interrupted，不判进程已死）。 */
export function attemptsOf(events: readonly RunEventRecord[]): AttemptView[] {
  const started = new Map<string, RunEventRecord>();
  const finished = new Map<string, RunEventRecord>();
  const order: string[] = [];
  for (const ev of events) {
    if (ev.kind === 'attempt_started') {
      const ref = String(ev.body.attempt_ref ?? `seq:${ev.seq}`);
      if (!started.has(ref)) {
        started.set(ref, ev);
        order.push(ref);
      }
    } else if (ev.kind === 'attempt_finished') {
      const ref = String(ev.body.attempt_ref ?? `seq:${ev.seq}`);
      finished.set(ref, ev);
    }
  }
  const views: AttemptView[] = [];
  for (const ref of order) {
    const s = started.get(ref);
    const f = finished.get(ref);
    if (!s) continue;
    const exitCode = f && f.body.exit_code !== undefined && f.body.exit_code !== null ? Number(f.body.exit_code) : null;
    const signal = f && typeof f.body.signal === 'string' ? f.body.signal : null;
    const timedOut = f && typeof f.body.timed_out === 'boolean' ? Boolean(f.body.timed_out) : null;
    const outcome: AttemptOutcome = !f
      ? 'interrupted'
      : exitCode === 0 && !signal && timedOut !== true
        ? 'completed'
        : 'failed';
    const rawCheck = s.body.context_check as Partial<ContextCheck> | null | undefined;
    const contextCheck: ContextCheck | null = rawCheck
      ? {
          matched: rawCheck.matched === true,
          reason: typeof rawCheck.reason === 'string' ? rawCheck.reason : null,
          current_owner: typeof rawCheck.current_owner === 'string' ? rawCheck.current_owner : null,
          current_generation:
            typeof rawCheck.current_generation === 'number' ? rawCheck.current_generation : null,
          current_state: typeof rawCheck.current_state === 'string' ? rawCheck.current_state : null,
        }
      : null;
    views.push({
      attempt_ref: ref,
      started_seq: s.seq,
      finished_seq: f?.seq ?? null,
      started_at: s.at,
      finished_at: f?.at ?? null,
      exit_code: exitCode,
      signal,
      timed_out: timedOut,
      outcome,
      // ★ 首切片：没有可靠进程探针 ⇒ 一律 unknown（约束 8）。
      process_observation: 'unknown',
      input_fingerprint: typeof s.body.input_fingerprint === 'string' ? s.body.input_fingerprint : null,
      log_ref: (f?.body.log_ref ?? s.body.log_ref ?? {}) as Record<string, unknown>,
      context_check: contextCheck,
    });
  }
  return views;
}
