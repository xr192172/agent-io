/**
 * run_events.ts —— P2 执行事件流的**追加 / 读取**应用层（事件语义与 fold 住 `domain/run_events.ts`）。
 *
 * ## 边界
 * · 表住既有 `tasks.db`（`run_events`，append-only，结构见 `infrastructure/task_history.ts`）；**不新建第二个 DB**。
 * · 追加是**审计旁路**（同 `write_log#recordWriteLog`）：写事件失败不许把主写/执行拖下水，
 *   但也**不许静默**（0.12）⇒ 回 `{ ok:false, error }`，调用方把缺口推进回执 warnings（**非持久**）。
 * · 与文件 / JSON 副作用**无法同事务**时（写已落盘、事件没落上）⇒ 不假定事件成功；持久缺口由既有账反查
 *   （写 → `write_log`、证据 → 卡上证据），runner 通道无独立持久回执只能显式标限制。读端把「最后一条
 *   边界观察之后的漂移」标 `unreconciled_external_write`，不归因给某 actor。
 * · 本模块不判存活、不授写权、不持久化当前态；actor/via/session 仅审计列。
 */
import { DatabaseSync } from 'node:sqlite';
import {
  openTasksDb,
  openTasksDbForRead,
  tasksDbLockFailure,
} from '../../../infrastructure/task_history.js';
import {
  RUN_EVENT_KINDS,
  runIdOf,
  type RunContextKey,
  type RunEventKind,
  type RunEventRecord,
} from '../../../domain/run_events.js';

/** 一次追加的输入（任务软引用 / 上下文 / 审计列 / 完整事件体）。 */
export interface RunEventInput {
  task?: { feature: string; node_id: string } | null;
  owner?: string | null;
  leaseGeneration?: number | null;
  actor?: string | null;
  via?: string | null;
  session?: string | null;
  kind: RunEventKind;
  body: Record<string, unknown>;
  /** 幂等键：同 run + 同键已存在 ⇒ 不重复写；缺省按 `kind` 去重（`run_started` 必须幂等）。 */
  dedupeKey?: string;
}

export interface AppendEventResult {
  ok: boolean;
  run_id: string;
  seq: number | null;
  /** 非空 = 追加失败（不得假定已记；警告不持久，缺口靠持久账反查） */
  error?: string;
}

/** 读取结果（`skip` 非空 = **读不到**，与「一条都没有」是两件事）。 */
export interface RunEventsRead {
  events: RunEventRecord[];
  skip: string | null;
  total: number;
}

function ctxOf(input: RunEventInput): RunContextKey {
  return {
    feature: input.task?.feature ?? null,
    node_id: input.task?.node_id ?? null,
    owner: input.owner ?? null,
    lease_generation: input.leaseGeneration ?? null,
  };
}

function normalizeActor(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

/**
 * 追加一条执行事件（单事务：同 run 的顺序号在 `BEGIN IMMEDIATE` 内现算 max+1）。
 *
 * 幂等：`dedupeKey`（缺省 = kind）在同 run 内已存在 ⇒ 直接返回既有 seq，不重复插。
 * `body` 原样 JSON 落盘（未知键保留）；不在这里裁字段。
 */
export function appendRunEvent(projectRoot: string, input: RunEventInput): AppendEventResult {
  const runId = runIdOf(ctxOf(input));
  if (!(RUN_EVENT_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, run_id: runId, seq: null, error: `未知事件种类: ${String(input.kind)}` };
  }
  let db: DatabaseSync | null = null;
  try {
    db = openTasksDb(projectRoot);
    const dedupe = input.dedupeKey ?? input.kind;
    const at = new Date().toISOString();
    const body: Record<string, unknown> = { ...input.body, dedupe_key: dedupe };
    const bodyText = JSON.stringify(body);
    // ★ F6：去重检查与插入必须在**同一** `BEGIN IMMEDIATE` 事务内 —— 事务外先查后插，
    //   两个并发追加会都看到「不存在」而双插。去重口径用 JSON1 `json_extract` **精确等值**：
    //   旧实现 `body LIKE %"dedupe_key":...%` 未转义 `%` / `_`，键值含通配符会误匹配到别的事件。
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      throw tasksDbLockFailure(e, 'appendRunEvent（开事务）');
    }
    try {
      const existing = db
        .prepare('SELECT seq FROM run_events WHERE run_id = ? AND json_extract(body, \'$.dedupe_key\') = ? LIMIT 1')
        .get(runId, dedupe) as { seq?: number } | undefined;
      if (existing?.seq != null) {
        db.exec('COMMIT');
        return { ok: true, run_id: runId, seq: Number(existing.seq) };
      }
      const maxRow = db
        .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM run_events WHERE run_id = ?')
        .get(runId) as { n?: number };
      const seq = Number(maxRow?.n ?? 0) + 1;
      db
        .prepare(
          `INSERT INTO run_events
             (run_id, task_feature, task_node_id, seq, kind, at, actor, via, session, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          input.task?.feature ?? null,
          input.task?.node_id ?? null,
          seq,
          input.kind,
          at,
          normalizeActor(input.actor),
          normalizeActor(input.via),
          normalizeActor(input.session),
          bodyText,
        );
      db.exec('COMMIT');
      return { ok: true, run_id: runId, seq };
    } catch (e) {
      db.exec('ROLLBACK');
      throw tasksDbLockFailure(e, 'appendRunEvent（写事件）');
    }
  } catch (e) {
    return { ok: false, run_id: runId, seq: null, error: (e as Error).message };
  } finally {
    try {
      db?.close();
    } catch {
      /* 清理路径：已提交的数据不受影响 */
    }
  }
}

/**
 * `run_started` 幂等确保：首个有真实 task/lease 上下文的被执行动作处创建一次；
 * 同 run 已存在 `run_started` ⇒ 不重复插。无 task 上下文的通用执行也可建 `run:anon/*`。
 */
export function ensureRunStarted(
  projectRoot: string,
  input: Omit<RunEventInput, 'kind' | 'body'> & { body?: Record<string, unknown> },
): AppendEventResult {
  return appendRunEvent(projectRoot, {
    ...input,
    kind: 'run_started',
    body: {
      context: 'first-observed-action',
      task: input.task ?? null,
      owner: input.owner ?? null,
      lease_generation: input.leaseGeneration ?? null,
      ...(input.body ?? {}),
    },
    dedupeKey: 'run_started',
  });
}

/** 读某项目的执行事件（只读：不建库、不建表）。filter 可按 task / run_id 收窄。 */
export function listRunEvents(
  projectRoot: string,
  filter?: { feature?: string; node_id?: string; runId?: string },
): RunEventsRead {
  const opened = openTasksDbForRead(projectRoot, 'run_events');
  if ('skip' in opened) {
    return { events: [], skip: `读不到 run_events：${opened.skip}（${opened.file}）`, total: 0 };
  }
  const db = opened.db;
  try {
    const where: string[] = [];
    const args: Array<string> = [];
    if (filter?.feature) {
      where.push('task_feature = ?');
      args.push(filter.feature);
    }
    if (filter?.node_id) {
      where.push('task_node_id = ?');
      args.push(filter.node_id);
    }
    if (filter?.runId) {
      where.push('run_id = ?');
      args.push(filter.runId);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM run_events${whereSql}`).get(...args) as { n?: number })?.n ?? 0,
    );
    const raw = db
      .prepare(
        `SELECT id, run_id, task_feature, task_node_id, seq, kind, at, actor, via, session, body
           FROM run_events${whereSql} ORDER BY run_id, seq`,
      )
      .all(...args) as Array<Record<string, unknown>>;
    const events: RunEventRecord[] = raw.map((r) => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(String(r.body ?? '{}')) as Record<string, unknown>;
      } catch (e) {
        // ★ 坏行不静默丢：保留行，body 标注解析失败（读端据此报缺口，不冒充空事件）。
        body = { _parse_error: (e as Error).message, _raw: String(r.body ?? '') };
      }
      return {
        id: Number(r.id),
        run_id: String(r.run_id ?? ''),
        task_feature: r.task_feature == null ? null : String(r.task_feature),
        task_node_id: r.task_node_id == null ? null : String(r.task_node_id),
        seq: Number(r.seq),
        kind: String(r.kind ?? '') as RunEventKind,
        at: String(r.at ?? ''),
        actor: r.actor == null ? null : String(r.actor),
        via: r.via == null ? null : String(r.via),
        session: r.session == null ? null : String(r.session),
        body,
      };
    });
    return { events, skip: null, total };
  } catch (e) {
    return { events: [], skip: `读 run_events 失败：${(e as Error).message}`, total: 0 };
  } finally {
    db.close();
  }
}

/** 按任务软引用读全部相关事件（含旧代际 run；读端自己分桶判 stale）。 */
export function eventsForTask(projectRoot: string, feature: string, nodeId: string): RunEventsRead {
  return listRunEvents(projectRoot, { feature, node_id: nodeId });
}
