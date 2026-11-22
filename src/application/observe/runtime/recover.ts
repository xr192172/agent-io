/**
 * recover.ts —— P2 统一**只读**恢复工具内核（`recover_run`）。
 *
 * ## 它回答什么（无聊天上下文的新会话也能接上）
 * 现场组合：Task（意图/责任/判据/候选/认领/完成/作废）· owner/lease_generation · Run/Attempt fold ·
 * 既有 evidence / 新鲜度 · 实时 HEAD/脏树 · 最近 runner 验证 · 进程探测 · 缺口与限制。
 *
 * ## 硬边界（与本批裁决逐条对应）
 * · **只读**：不 claim / 不 takeover / 不 renew / 不写盘；`grants` 恒为 `'none'`；建议不持久化。
 * · 活性不伪造：没有可靠进程探针 ⇒ 进程观察恒 `unknown`，不凭 pid / TTL 判 alive/dead。
 * · done/void 只展示历史，**绝不建议自动重启**；当前代际已有活跃 Attempt ⇒ 不重复派工。
 * · 旧代际只标 stale/superseded，恢复不重新附着；续作必须建议既有 claim/takeover。
 * · **活性不重附**：没有可靠实时 alive 证据（首切片恒 unknown）时，中断 Attempt 只给只读检查动作
 *   （`inspect_pending_attempt`）—— 不重附旧进程、不判死、不重复派工；只有未来拿到可靠 alive
 *   证据后才允许续接。stale / unmatched（上下文校验不通过或缺失）的 interrupted 不进任何续作档。
 * · 漂移不归因给某 actor：无法由最新引擎观察解释的改动标 `unreconciled_external_write`。
 * · 真相只来自任务、事件、既有证据与实时事实；不靠 Markdown / scratch / 遥测 events.jsonl。
 */
import path from 'node:path';
import { getDesignSheet } from '../../../infrastructure/storage.js';
import { listLiveCards } from '../../../infrastructure/task_history.js';
import { gitSnapshot, type GitSnapshot } from '../../../infrastructure/git.js';
import { resolveProjectRoot } from '../../../infrastructure/analysis/project_root/index.js';
import {
  foldCheckpoint,
  attemptsOf,
  runIdOf,
  type RunEventRecord,
  type AttemptView,
} from '../../../domain/run_events.js';
import { listRunEvents } from './run_events.js';
import { readWriteLog } from '../../../infrastructure/write_log.js';
import {
  isLeaseExpired,
  leaseIdleMinutes,
  leaseGenerationOf,
  isLeaseHolding,
  LEASE_TTL_MS,
} from '../../../domain/task_machine.js';
import {
  expectationsOf,
  taskOfNode,
  todosForNode,
  isClosedTaskState,
  type TaskSpec,
} from '../../../domain/task_schema.js';
import { sameActor } from '../../../domain/actor_spec.js';
import { planEvidenceRerun } from '../../design/dsl_ops/task_ops.js';

/** 入参：root 必填；task 标识可选（都不给 ⇒ 汇总项目内活跃领卡）。 */
export interface RecoveryInput {
  project_dir: string;
  feature?: string;
  node_id?: string;
  /** 提问方身份（仅读集分桶/审计；不据此授写权）。 */
  actor?: string;
}

export interface TaskReadView {
  feature: string;
  node_id: string;
  state: string;
  summary: string | null;
  owner: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
  lease_generation: number;
  claimed_session: string | null;
  lease: {
    holding: boolean;
    expired: boolean;
    idle_minutes: number | null;
    ttl_ms: number;
  };
  evidence_count: number;
  latest_evidence: Record<string, unknown> | null;
  evidence_bucket: 'skip' | 'rerun' | 'unknown' | 'none';
  reopened_at: string | null;
}

export interface RunView {
  run_id: string;
  task_feature: string | null;
  task_node_id: string | null;
  owner: string | null;
  lease_generation: number | null;
  current: boolean;
  stale: boolean;
  events_count: number;
  checkpoint: { run_id: string; last_event_seq: number | null; digest: string | null };
  attempts: AttemptView[];
  active_attempt: AttemptView | null;
  /** 上下文校验未通过 / 缺失的 Attempt（只留审计展示，不进当前活跃档）。 */
  unverified_attempts: AttemptView[];
}

export interface DriftView {
  status: 'clean' | 'unreconciled_external_write' | 'no-observed-baseline' | 'git-unreadable';
  live: GitSnapshot;
  last_observed: GitSnapshot | null;
  note: string;
}

export interface NextAction {
  action:
    | 'ask_human'
    | 'inspect_closed'
    | 'reconcile_stale'
    /** 只读检查挂起 Attempt：不重附旧进程、不判死、不重复派工；待可靠 alive 证据后才谈续接。 */
    | 'inspect_pending_attempt'
    | 'fix'
    | 'rerun_rejudge'
    | 'resume'
    | 'claim_takeover'
    | 'no_op'
    | 'wait';
  reason: string;
  suggestions: string[];
  grants: 'none';
}

/** 持久对账结果：事件缺失只能从既有持久账（write_log / 卡证据）反查；无独立回执的通道显式标限制。 */
export interface ReconciliationView {
  /** 当前 owner 可归因、但缺 source_written 事件的 write_log 行数 */
  writes_without_event: number;
  /** 署名 actor ≠ 当前 owner 的该卡写账行数（task 级历史缺口，不归到当前 owner 头上） */
  writes_other_actor: number;
  /** 无卡（direct/unmapped）写账行数：只由 write_log 对账，不在任务事件流内 */
  unmapped_writes: number;
  /** 卡上有证据但缺 evidence_added 事件的条数 */
  evidence_without_event: number;
  /** runner Attempt 是否有独立持久回执可供反查（首切片无 ⇒ false，事件缺失只能靠 Git 漂移侧证） */
  runner_receipt_durable: boolean;
  notes: string[];
}

export interface RecoveryReport {
  ok: boolean;
  gaps: string[];
  target: { feature: string | null; node_id: string | null; summary: string | null };
  task: TaskReadView | null;
  active_run: RunView | null;
  runs: RunView[];
  drift: DriftView;
  reconciliation: ReconciliationView;
  next_action: NextAction;
  grants: 'none';
}

/** 卡上证据的最新一条（压栈：newest last）。 */
function latestEvidence(card: TaskSpec): Record<string, unknown> | null {
  const ev = card.evidence ?? [];
  return ev.length ? ({ ...ev[ev.length - 1] } as Record<string, unknown>) : null;
}

/** 从 DSL 解析一张任务卡（节点任务优先 todos[]，回落 node.task；todo 卡在 todos[] 里）。 */
function resolveCard(dsl: ReturnType<typeof getDesignSheet>, nodeId: string): TaskSpec | undefined {
  if (!dsl) return undefined;
  const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === nodeId);
  const byTodo = todosForNode(nodeId, dsl.todos);
  if (byTodo.length) {
    const open = byTodo.filter((t) => t.state !== 'done' && t.state !== 'void');
    return open.length ? open[open.length - 1] : byTodo[byTodo.length - 1];
  }
  return taskOfNode(node, dsl.todos);
}

function asTaskSpec(c: Record<string, unknown> | null | undefined): TaskSpec | null {
  return (c ?? null) as unknown as TaskSpec | null;
}

interface Facts {
  card: TaskSpec | null;
  feature: string | null;
  nodeId: string | null;
  dsl: ReturnType<typeof getDesignSheet>;
  nowMs: number;
}

function readTaskView(f: Facts, root: string): TaskReadView | null {
  const card = f.card;
  if (!card || !f.feature || !f.nodeId) return null;
  const holding = isLeaseHolding(card.state as never);
  const expired = holding ? isLeaseExpired(card, f.nowMs, LEASE_TTL_MS) : false;
  const idle = leaseIdleMinutes(card, f.nowMs);
  // 证据新鲜度复用既有 planEvidenceRerun（唯一判据，不另算）。
  let bucket: TaskReadView['evidence_bucket'] = 'none';
  const evidence = card.evidence ?? [];
  if (evidence.length) {
    const expectations = f.dsl ? expectationsOf((f.dsl.geometry?.nodes ?? []).find((n) => n.id === f.nodeId)) : [];
    const plan = planEvidenceRerun(root, [
      { id: f.nodeId, feature: f.feature, node_id: f.nodeId, expectations, evidence },
    ]);
    const item = [...plan.skip, ...plan.rerun, ...plan.unknown][0];
    bucket = item ? item.bucket : 'unknown';
  }
  return {
    feature: f.feature,
    node_id: f.nodeId,
    state: card.state,
    summary: card.summary ?? null,
    owner: card.owner ?? null,
    claimed_at: card.claimed_at ?? null,
    last_heartbeat_at: (card as unknown as Record<string, unknown>).last_heartbeat_at as string | null,
    lease_generation: leaseGenerationOf(card),
    claimed_session: card.claimed_session ?? null,
    lease: { holding, expired, idle_minutes: idle, ttl_ms: LEASE_TTL_MS },
    evidence_count: evidence.length,
    latest_evidence: latestEvidence(card),
    evidence_bucket: bucket,
    reopened_at: card.reopened_at ?? null,
  };
}

/**
 * ★ F3：只有 `context_check.matched === true` 才算当前代际可接续的 Attempt。
 *   缺校验（null）与 unmatched（owner/代际/持租不符或册读不到）一律不算有效 ——
 *   不可验证 ≠ 有效；它们只留审计展示，不进当前活跃档。
 */
function contextVerified(a: AttemptView): boolean {
  return a.context_check?.matched === true;
}

/** 把同一 run 的事件折叠成 RunView。 */
function viewRun(events: RunEventRecord[], card: TaskSpec | null, nowMs: number): RunView {
  const runId = events[0]?.run_id ?? '';
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const first = ordered[0];
  const attempts = attemptsOf(ordered);
  const verified = attempts.filter(contextVerified);
  const unverified = attempts.filter((a) => !contextVerified(a));
  const active = verified.find((a) => a.outcome === 'interrupted') ?? null;
  const owner = first?.actor ?? null;
  // 代际从 run_id 尾段解析；取不到 ⇒ null（旧代际判据仍可读 body.lease_generation）。
  const genBody = ordered.find((e) => e.body.lease_generation !== undefined)?.body.lease_generation;
  const generation = typeof genBody === 'number' ? genBody : null;
  const current =
    !!card &&
    !!first &&
    first.task_feature != null &&
    first.task_node_id != null &&
    runId ===
      runIdOf({
        feature: first.task_feature,
        node_id: first.task_node_id,
        owner: card.owner ?? null,
        lease_generation: leaseGenerationOf(card),
      });
  return {
    run_id: runId,
    task_feature: first?.task_feature ?? null,
    task_node_id: first?.task_node_id ?? null,
    owner,
    lease_generation: generation,
    current,
    stale: !current,
    events_count: ordered.length,
    checkpoint: foldCheckpoint(runId, ordered),
    attempts,
    active_attempt: active,
    unverified_attempts: unverified,
  };
}

/** 文件名清单规范化：先排序再比较（遍历顺序不得影响判据）；非数组回落空集。 */
function normList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).sort() : [];
}

/**
 * 实时 git 与**当前 Run** 最近一条 git_observed 对比（不归因 actor）。
 * ★ F8：基线只在当前 Run 内取；当前代际无 Run ⇒ no-observed-baseline，不借别 Run / 别代际的观察。
 * 内容级限制：只比 HEAD 与文件名清单（modified/untracked），不逐文件比内容指纹。
 */
function assessDrift(
  events: RunEventRecord[],
  root: string,
  opts: { noCurrentRun: boolean },
): DriftView {
  const live = gitSnapshot(root);
  if (!live.git_ok) {
    return { status: 'git-unreadable', live, last_observed: null, note: 'Git 不可读：HEAD/脏树判不了，不把空集当干净。' };
  }
  if (opts.noCurrentRun) {
    return {
      status: 'no-observed-baseline',
      live,
      last_observed: null,
      note: '当前代际没有 Run：漂移基线不借别 Run / 别代际的 git_observed；当前 Run 无基线 ⇒ 判不了漂移（不是「工作区干净」）。',
    };
  }
  const observed = [...events].reverse().find((e) => e.kind === 'git_observed');
  const snap = observed?.body?.snapshot as GitSnapshot | undefined;
  if (!snap || snap.git_ok === false) {
    return {
      status: 'no-observed-baseline',
      live,
      last_observed: snap ?? null,
      note: '当前 Run 没有引擎在边界观察到的 Git 基线 ⇒ 无法判断漂移来源（不是「工作区干净」）。',
    };
  }
  const modifiedChanged =
    live.head !== snap.head ||
    normList(live.modified).join('\n') !== normList(snap.modified).join('\n') ||
    normList(live.untracked).join('\n') !== normList(snap.untracked).join('\n');
  if (!modifiedChanged) {
    return {
      status: 'clean',
      live,
      last_observed: snap,
      note: '实时 HEAD/文件名清单与当前 Run 最近一次引擎观察一致（未逐文件比内容指纹）。',
    };
  }
  return {
    status: 'unreconciled_external_write',
    live,
    last_observed: snap,
    note: '相对当前 Run 最近一次引擎观察存在无法由该观察解释的漂移；不 attribution 给某 actor（可能是引擎外直写）。',
  };
}

/** 命中即停的确定性裁决（相同注入事实 ⇒ 相同建议与 digest）。 */
function decideNextAction(
  task: TaskReadView | null,
  activeRun: RunView | null,
  runs: RunView[],
  drift: DriftView,
  gaps: string[],
): NextAction {
  const grants = 'none' as const;
  // ① 输入/权威源缺口
  if (!task) {
    return {
      action: 'ask_human',
      reason: gaps.length ? gaps.join('；') : '任务权威源取不到（册里没有这张卡或读不了）。',
      suggestions: ['先确认 feature / node_id 指向正确，或由人补齐任务上下文。'],
      grants,
    };
  }
  // ② done/void：只展示历史，不建议重启
  if (isClosedTaskState(task.state as never)) {
    return {
      action: 'inspect_closed',
      reason: `任务已 ${task.state}；历史证据/事件仅供查看，不自动重启。`,
      suggestions: ['若要新做一件事：新开任务卡（publish/claim），不要在已关闭卡上续作。'],
      grants,
    };
  }
  // ③ 旧代际：只标 stale/superseded，不重新附着
  const currentRun = runs.find((r) => r.current) ?? null;
  if (!currentRun && runs.some((r) => r.stale)) {
    return {
      action: 'reconcile_stale',
      reason: '事件只属于旧代际/旧 owner 的 Run；当前卡没有同代际活跃 Run。',
      suggestions: ['续作必须走既有 claim / takeover 取得当前代际写权；不要把旧 Run 重新附着到当前卡。'],
      grants,
    };
  }
  // ④ 当前代际已有活跃 Attempt：只读检查，不重附、不判死、不重复派工
  if (currentRun?.active_attempt) {
    return {
      action: 'inspect_pending_attempt',
      reason:
        '当前代际存在已开工、未收尾的 Attempt；首切片没有可靠实时 alive 证据（进程观察 unknown）：' +
        '不重附旧进程、不判死、不重复派工。',
      suggestions: [
        '只读查看该 Attempt 的输入指纹 / 日志引用 / 边界快照，先核实它是否还在运行；',
        '只有拿到可靠 alive 证据后才允许续接；若确认已停，再由人或既有 claim/takeover 流程处理。',
      ],
      grants,
    };
  }
  // ⑤ 最近一次验证新鲜失败
  const lastAttempt = currentRun?.attempts[currentRun.attempts.length - 1];
  if (lastAttempt?.outcome === 'failed') {
    return {
      action: 'fix',
      reason: `最近一次 runner Attempt 失败（exit_code=${lastAttempt.exit_code ?? 'null'}${lastAttempt.signal ? ` signal=${lastAttempt.signal}` : ''}）。`,
      suggestions: ['按日志/回执定位失败点，修相关代码后定向重跑该验证。'],
      grants,
    };
  }
  // ⑥ 证据陈旧/缺失
  if (task.evidence_bucket === 'rerun' || task.evidence_bucket === 'unknown') {
    return {
      action: 'rerun_rejudge',
      reason: task.evidence_count === 0 ? '卡上没有证据。' : '证据指纹已陈旧或不可复算（unverifiable）。',
      suggestions: ['重跑相关验证并补新证据；再走 complete/expectations 判定。'],
      grants,
    };
  }
  // ⑦ 领卡态：租约有效 → resume；过期 → claim/takeover
  if (task.lease.holding) {
    if (task.lease.expired) {
      return {
        action: 'claim_takeover',
        reason: `租约已僵（空闲 ${task.lease.idle_minutes ?? '?'} 分钟 > TTL）。`,
        suggestions: ['走既有 claim / takeover 流程取得当前代际写权；不要凭旧 generation 写盘。'],
        grants,
      };
    }
    return {
      action: 'resume',
      reason: `任务 ${task.state}，当前 owner=${task.owner ?? '?'}，租约有效。`,
      suggestions: ['从最近一次事件/证据现场继续；写权以既有租约/写闸判定为准。'],
      grants,
    };
  }
  // 候选态：可领
  if (task.state === 'candidate' || task.state === 'preparing') {
    return {
      action: 'claim_takeover',
      reason: `任务 ${task.state}，尚未持有有效租约。`,
      suggestions: ['先 claim 领卡（带 actor 与 scope），取得当前代际写权后再动手。'],
      grants,
    };
  }
  // ⑧ 全满足无缺口
  if (task.evidence_bucket === 'skip' && drift.status === 'clean') {
    return { action: 'no_op', reason: '证据仍有效且工作区与最近观察一致；无未决动作。', suggestions: [], grants };
  }
  // ⑨ 未决但当前不可执行
  return {
    action: 'wait',
    reason: '状态/证据/漂移之间存在未决项，当前不建议自动动作。',
    suggestions: gaps.length ? gaps : ['等前置条件齐备（证据/验证/写权）后再继续；必要时 ask_human。'],
    grants,
  };
}

/**
 * 持久对账：事件是审计旁路，追加失败只进回执 warnings（**非持久**）。这里从既有持久账反查
 * 「执行发生但事件缺失」：写 → write_log；证据 → 卡上证据。runner 无独立持久回执 ⇒ 显式标限制，
 *  不把回执警告当成已对账。
 */
function reconcileDurable(
  root: string,
  opts: { feature: string | null; nodeId: string | null; card: TaskSpec | null; events: RunEventRecord[] },
): ReconciliationView {
  const notes: string[] = [];
  let writesWithoutEvent = 0;
  let writesOtherActor = 0;
  let unmappedWrites = 0;
  let evidenceWithoutEvent = 0;

  if (opts.feature && opts.nodeId) {
    const log = readWriteLog(root, { limit: 5000 });
    if (log.skip) {
      notes.push(`write_log 读不到（${log.skip}）：写侧事件缺口无法反查。`);
    } else {
      const mine = log.rows.filter(
        (r) => r.card_feature === opts.feature && r.card_id === opts.nodeId,
      );
      const owner = opts.card?.owner ?? null;
      // ★ F9：按 actor 分桶 —— 与当前 owner 等价的行才归当前 owner；其余归 task 级历史缺口，
      //   不归到当前 owner 头上。write_log 无代际列 ⇒ 无法按 generation 分桶，限制在 notes 里说明。
      const mineOwned = mine.filter((r) => owner == null || sameActor(r.actor, owner));
      const mineOther = mine.filter((r) => !(owner == null || sameActor(r.actor, owner)));
      unmappedWrites = log.rows.filter((r) => r.card_id == null || r.source === 'unmapped').length;
      const hasSourceEvent = opts.events.some((e) => e.kind === 'source_written');
      if (mineOwned.length && !hasSourceEvent) {
        writesWithoutEvent = mineOwned.length;
        notes.push(
          `write_log 有 ${mineOwned.length} 条当前 owner（${owner ?? '?'}）名下该卡写账，但 run_events 无对应 source_written 事件：执行发生但事件缺失（持久对账以 write_log 为准）。`,
        );
      }
      if (mineOther.length) {
        writesOtherActor = mineOther.length;
        notes.push(
          `write_log 有 ${mineOther.length} 条该卡写账署名 actor≠当前 owner（${owner ?? '?'}）：归为 task 级历史缺口，不计到当前 owner 头上；write_log 无代际列，无法按 lease_generation 分桶。`,
        );
      }
      if (unmappedWrites) {
        notes.push(
          `write_log 有 ${unmappedWrites} 条无卡（direct/unmapped）写账：这些写只由 write_log 对账，不在任务事件流内（run_events 不冒记任务上下文）。`,
        );
      }
    }
  }

  if (opts.card) {
    const evCount = opts.card.evidence?.length ?? 0;
    const hasEvidenceEvent = opts.events.some((e) => e.kind === 'evidence_added');
    if (evCount && !hasEvidenceEvent) {
      evidenceWithoutEvent = evCount;
      notes.push(
        `卡上有 ${evCount} 条证据但无 evidence_added 事件：证据本体与结论以卡上证据为准，事件侧缺口。`,
      );
    }
  }

  notes.push(
    'runner Attempt 无独立持久回执：attempt 事件缺失无法从 write_log/卡证据反查，只能靠现场 Git 漂移侧证；调用回执里的警告不是已持久对账。',
  );
  notes.push(
    '漂移对账只覆盖 HEAD 与文件名清单（modified/untracked），不逐文件比内容指纹；清单不变而文件内容被改的情形本口径发现不了。',
  );

  return {
    writes_without_event: writesWithoutEvent,
    writes_other_actor: writesOtherActor,
    unmapped_writes: unmappedWrites,
    evidence_without_event: evidenceWithoutEvent,
    runner_receipt_durable: false,
    notes,
  };
}

/** 主入口（纯读；不写盘、不 claim）。 */
export function recoverRun(input: RecoveryInput): RecoveryReport {
  const root = path.resolve(input.project_dir ? resolveProjectRoot(input.project_dir) : process.cwd());
  const gaps: string[] = [];
  const feature = typeof input.feature === 'string' && input.feature.trim() ? input.feature.trim() : null;
  const nodeId = typeof input.node_id === 'string' && input.node_id.trim() ? input.node_id.trim() : null;
  const nowMs = Date.now();

  let dsl: ReturnType<typeof getDesignSheet> = null;
  let card: TaskSpec | null = null;
  if (feature) {
    try {
      dsl = getDesignSheet(feature);
      if (!dsl) gaps.push(`册里没有 feature="${feature}"（missing）。`);
    } catch (e) {
      gaps.push(`读设计册失败（corrupt/unreachable）：${(e as Error).message}`);
    }
    if (dsl && nodeId) card = resolveCard(dsl, nodeId) ?? null;
  }
  if (feature && !nodeId) {
    // 只给 feature：取册内最后一张未了结卡作为恢复目标（其余在 runs/活卡里可见）。
    const todos = (dsl?.todos ?? []).filter((t) => t.state !== 'done' && t.state !== 'void');
    card = (todos[todos.length - 1] ?? null) as TaskSpec | null;
  }

  // 事件：按任务软引用收窄；取不到 task 标识 ⇒ 项目内全部事件。
  const eventsRead = feature && nodeId ? listRunEvents(root, { feature, node_id: nodeId }) : listRunEvents(root);
  if (eventsRead.skip) gaps.push(eventsRead.skip);
  const events = eventsRead.events;

  const byRun = new Map<string, RunEventRecord[]>();
  for (const ev of events) {
    const list = byRun.get(ev.run_id) ?? [];
    list.push(ev);
    byRun.set(ev.run_id, list);
  }
  const facts: Facts = { card, feature, nodeId: nodeId ?? card?.node_id ?? card?.id ?? null, dsl, nowMs };
  const task = readTaskView(facts, root);
  const runs = [...byRun.values()].map((list) => viewRun(list, card, nowMs));
  const currentRun = runs.find((r) => r.current) ?? null;
  const currentRunEvents = currentRun ? byRun.get(currentRun.run_id) ?? [] : [];
  const activeRun =
    runs.find((r) => r.current && r.active_attempt) ?? runs.find((r) => r.current) ?? null;
  // ★ F8：漂移基线只从当前 Run 的 git_observed 取；当前 Run 无基线 ⇒ unknown/gap，不借别 Run。
  const drift = assessDrift(currentRunEvents, root, { noCurrentRun: !currentRun });

  // ★ F3：上下文校验未通过 / 缺失的中断 Attempt 不进续作档，缺口显式带出。
  for (const r of runs) {
    for (const a of r.unverified_attempts) {
      if (a.outcome !== 'interrupted') continue;
      gaps.push(
        `Attempt ${a.attempt_ref} 上下文校验未通过或缺失（reason=${a.context_check?.reason ?? 'missing-context-check'}）：不挂当前代际活跃档，不可据此续接。`,
      );
    }
  }

  if (!feature || !nodeId) {
    gaps.push('未给 task 标识：以下为项目内汇总，单任务结论需补 feature/node_id。');
  }
  if (drift.status === 'git-unreadable') gaps.push(drift.note);
  if (drift.status === 'no-observed-baseline') gaps.push(drift.note);

  const reconciliation = reconcileDurable(root, { feature, nodeId, card, events });
  gaps.push(...reconciliation.notes);

  const nextAction = decideNextAction(task, activeRun, runs, drift, gaps);

  return {
    ok: true,
    gaps,
    target: { feature: facts.feature, node_id: facts.nodeId, summary: task?.summary ?? null },
    task,
    active_run: activeRun,
    runs,
    drift,
    reconciliation,
    next_action: nextAction,
    grants: 'none',
  };
}

/** 兼容只读调用：列出项目内活卡（汇总档用）。 */
export function listActiveCards(root: string): Array<{ id: string; feature: string; state: string; summary: string | null }> {
  return listLiveCards(root).map((h) => ({
    id: h.id,
    feature: h.feature,
    state: h.state,
    summary: (h.card?.summary as string | null) ?? null,
  }));
}
