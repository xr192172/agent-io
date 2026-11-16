/**
 * ledger.ts —— T-#LEDGER-ENGINE L1：台账引擎**写端 + 只读查询**（真相住 tasks.db 新表）。
 *
 * ## 为什么在这里
 * 台账是项目级审计数据（与 task_history 同一条判据：不可重建 ⇒ 住 tasks.db，不进 cache.db），
 * 但**不是任务卡**：它有自己的 id 空间（ref_id）、自己的三态与事件流。
 * ⇒ 存储复用 `src/infrastructure/task_history.ts` 的 `openTasksDb` / `openTasksDbForRead` 两个唯一开库口径，
 *   本模块只负责**语义**（谁能在什么时候写什么事件），不发明第三条开库路径。
 *
 * ## 核心不变量（四条，测试逐条打断即红）
 * ① 追加不改写：annotate / close / verdict / supersede 只 INSERT ledger_events；
 *    **从不 UPDATE ledger_events**（全表 BEFORE UPDATE / BEFORE DELETE 触发器 RAISE(ABORT) 把所有写者钉死，
 *    包括绕过本模块直接 SQL 的人）。body 列的逐字保留由"不写 body 列"保证。
 * ② 活跃 ref_id 唯一：部分唯一索引 `UNIQUE(ref_id) WHERE state='active'` —— 销账后同 ref_id 可重新挂账。
 * ③ 销账 = state 改 done/void + closed_* 列 + 一条 close 事件；**没有 DELETE ledger_rows 这个 API**。
 * ④ superseded 是**关系不是结局**：只走 `superseded_by` 指针 + supersede 事件，state 保持 active。
 *
 * ## 层次与入口
 * application 层，函数式 API（无 class、无 DI）。本期只交付 TS 函数；CLI/MCP ToolDef 挂接是后续子卡的事
 * （lead 裁定 L1 只做"写端 + 只读查询"，不在这里新造工具面）。
 * ★ 没有全局 closeAll：每个开库的 helper（withWriteTx / listActive / getRow）都在 finally 里 db.close()，
 *   句柄不跨调用存活（见自述 R2）。
 */
import { DatabaseSync } from 'node:sqlite';
import { openTasksDb, openTasksDbForRead } from '../../infrastructure/task_history.js';

export type LedgerState = 'active' | 'done' | 'void';
export type LedgerEventKind = 'hang' | 'annotate' | 'close' | 'reopen' | 'verdict' | 'supersede';

/** 一条台账行（读出口；列名逐字对应 ledger_rows 的列，不解释 body） */
export interface LedgerRow {
  row_id: number;
  ref_id: string;
  section: string;
  title: string;
  problem: string | null;
  proposal: string | null;
  state: LedgerState;
  superseded_by: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_reason: string | null;
  closed_evidence: string | null;
}

/** 一条事件（逐字取回；`supersedes_event_id` 是指向前一事件的软指针，可为 null） */
export interface LedgerEvent {
  id: number;
  row_id: number;
  seq: number;
  kind: LedgerEventKind;
  at: string;
  by: string;
  body: string | null;
  supersedes_event_id: number | null;
}

export interface LedgerRowWithEvents extends LedgerRow {
  events: LedgerEvent[];
}

export interface ListActiveResult {
  rows: LedgerRow[];
  /** includeClosed:true 时返回已销账（done/void）行数；默认 false ⇒ 恒 0（不扫） */
  closed_count: number;
}

export interface HangRowInput {
  refId: string;
  section: string;
  title: string;
  problem?: string;
  proposal?: string;
  by: string;
}

const ROW_COLUMNS =
  'rowid AS row_id, ref_id, section, title, problem, proposal, state, superseded_by, opened_at, closed_at, closed_reason, closed_evidence';

const EVENT_COLUMNS = 'id, row_id, seq, kind, at, "by" AS by, body, supersedes_event_id';

function nonEmpty(label: string, value: string | undefined | null): string {
  const v = String(value ?? '').trim();
  if (!v) throw new Error(`[ledger] ${label} 必填（不许空串）`);
  return v;
}

/** body 专用：判空用 trim，**存值保留原文**（逐字不变量——批注/裁定不许被剪掉首尾空白） */
function bodyOf(label: string, value: string | undefined | null): string {
  if (!String(value ?? '').trim()) throw new Error(`[ledger] ${label} 必填（不许空串）`);
  return String(value);
}

function opt(value: string | undefined | null): string | null {
  return value === undefined || value === null ? null : String(value); // ★ 不 trim：body 逐字
}

/** 一次操作 = 一个事务：行状态与事件要么全成，要么一个字节没动。 */
function withWriteTx<T>(projectRoot: string, fn: (db: DatabaseSync) => T): T {
  const db = openTasksDb(projectRoot); // 写端唯一开库口径（reachable + mkdir + TASKS_SCHEMA_SQL）
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.close();
  }
}

/** 按 ref_id 找**当前挂账**（state='active'）的行；找不到 ⇒ 抛（不静默挂到已销账的行上） */
function activeRowByRef(db: DatabaseSync, refId: string): { row_id: number; state: LedgerState; superseded_by: string | null } {
  const row = db
    .prepare(`SELECT rowid AS row_id, state, superseded_by FROM ledger_rows WHERE ref_id = ? AND state = 'active'`)
    .get(refId) as { row_id: number; state: LedgerState; superseded_by: string | null } | undefined;
  if (!row) {
    throw new Error(
      `[ledger] ref_id="${refId}" 没有活跃挂账行（没挂过 / 已销账）。` +
        '★ 销账后要再挂 ⇒ 先 hangRow（同 ref_id 可重用，部分唯一索引只管活跃行）。',
    );
  }
  return row;
}

/** 追加一条事件：seq = 该行当前 max(seq)+1（同事务内算，UNIQUE(row_id,seq) 兜底并发/重复） */
function appendEvent(
  db: DatabaseSync,
  rowId: number,
  kind: LedgerEventKind,
  by: string,
  body: string | null,
  supersedesEventId: number | null,
): number {
  const seq = Number(
    (db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM ledger_events WHERE row_id = ?').get(rowId) as {
      next: number;
    }).next,
  );
  db.prepare(
    `INSERT INTO ledger_events (row_id, seq, kind, at, "by", body, supersedes_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(rowId, seq, kind, new Date().toISOString(), nonEmpty('by', by), body, supersedesEventId);
  return seq;
}

/** 挂账：同 ref_id 活跃期重复挂 ⇒ 部分唯一索引抛（语义错误转成可读报文） */
export function hangRow(projectRoot: string, input: HangRowInput): number {
  const refId = nonEmpty('refId', input.refId);
  const section = nonEmpty('section', input.section);
  const title = nonEmpty('title', input.title);
  const by = nonEmpty('by', input.by);
  const now = new Date().toISOString();
  return withWriteTx(projectRoot, (db) => {
    let rowId: number;
    try {
      rowId = Number(
        db
          .prepare(
            `INSERT INTO ledger_rows (ref_id, section, title, problem, proposal, state, opened_at)
             VALUES (?, ?, ?, ?, ?, 'active', ?)`,
          )
          .run(refId, section, title, opt(input.problem), opt(input.proposal), now).lastInsertRowid,
      );
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed')) {
        throw new Error(`[ledger] ref_id="${refId}" 已在活跃期挂账（部分唯一索引拒绝重复挂；先销账再重挂）`);
      }
      throw e;
    }
    appendEvent(db, rowId, 'hang', by, `section=${section}\ntitle=${title}`, null);
    return rowId;
  });
}

/** 批注：**只追加 event**，不碰行的任何列（尤其 problem/proposal 原样保留） */
export function annotateRow(projectRoot: string, refId: string, body: string, by: string): number {
  const text = bodyOf('body', body); // 判空用 trim，存值保留原文（内部换行/空白逐字）
  return withWriteTx(projectRoot, (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    return appendEvent(db, row.row_id, 'annotate', by, text, null);
  });
}

/** 销账：done/void 二选一；重复销账（已不活跃）被拒；reason/evidence 写进行 + close 事件 body */
export function closeRow(
  projectRoot: string,
  refId: string,
  state: 'done' | 'void',
  reason: string,
  evidence: string,
  by: string,
): number {
  if (state !== 'done' && state !== 'void') throw new Error(`[ledger] close state 只能是 done/void（收到 ${state}）`);
  const why = nonEmpty('reason', reason);
  const proof = nonEmpty('evidence', evidence);
  return withWriteTx(projectRoot, (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    const at = new Date().toISOString();
    db.prepare(
      `UPDATE ledger_rows
          SET state = ?, closed_at = ?, closed_reason = ?, closed_evidence = ?
        WHERE rowid = ? AND state = 'active'`,
    ).run(state, at, why, proof, row.row_id);
    return appendEvent(db, row.row_id, 'close', by, `reason=${why}\nevidence=${proof}`, null);
  });
}

/** 重开：留痕（reopen 事件），状态回到 active；部分唯一索引保证不会与另一条活跃行撞 ref_id */
export function reopenRow(projectRoot: string, refId: string, by: string): number {
  return withWriteTx(projectRoot, (db) => {
    const row = db
      .prepare('SELECT rowid AS row_id, state, closed_at, closed_reason, closed_evidence FROM ledger_rows WHERE ref_id = ?')
      .get(nonEmpty('refId', refId)) as
      | {
          row_id: number;
          state: LedgerState;
          closed_at: string | null;
          closed_reason: string | null;
          closed_evidence: string | null;
        }
      | undefined;
    if (!row) throw new Error(`[ledger] ref_id="${refId}" 没有行，重开无从谈起`);
    if (row.state === 'active') throw new Error(`[ledger] ref_id="${refId}" 已经活跃，无需重开`);
    db.prepare(`UPDATE ledger_rows SET state = 'active', closed_at = NULL, closed_reason = NULL, closed_evidence = NULL WHERE rowid = ?`).run(
      row.row_id,
    );
    // ★ 清掉 closed_* 会丢"上次销账证据"吗？不会：close 事件的 body 已逐字存了 reason/evidence。
    void row.closed_at;
    void row.closed_reason;
    void row.closed_evidence;
    return appendEvent(db, row.row_id, 'reopen', by, null, null);
  });
}

/** 被取代：只设 superseded_by 指针 + 追加 supersede 事件；state 保持 active（superseded 是关系不是结局） */
export function supersedeRow(projectRoot: string, refId: string, supersededBy: string, by: string): number {
  const ptr = nonEmpty('supersededBy', supersededBy);
  return withWriteTx(projectRoot, (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    if (ptr === refId) throw new Error('[ledger] superseded_by 不能指向自己（自己取代自己没有信息）');
    db.prepare('UPDATE ledger_rows SET superseded_by = ? WHERE rowid = ?').run(ptr, row.row_id);
    const prev = db
      .prepare(`SELECT MAX(id) AS id FROM ledger_events WHERE row_id = ?`)
      .get(row.row_id) as { id: number | null };
    return appendEvent(db, row.row_id, 'supersede', by, `superseded_by=${ptr}`, prev.id);
  });
}

/** 裁定：lead 综合后写 verdict —— 只追加 event，不覆盖此前任何一条 */
export function writeVerdict(projectRoot: string, refId: string, body: string, by: string): number {
  const text = bodyOf('body', body);
  return withWriteTx(projectRoot, (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    return appendEvent(db, row.row_id, 'verdict', by, text, null);
  });
}

/**
 * 只读查询：活跃集默认（state='active'）；`includeClosed:true` 时含 done/void 并给 closed_count。
 * ★ 走 `openTasksDbForRead`：库/表不存在一律按 0 行计，**不建库、不产 0 字节文件**。
 */
export function listActive(
  projectRoot: string,
  opts?: { section?: string; includeClosed?: boolean },
): ListActiveResult {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows'); // 表名已加进 union（见补丁 B）
  if ('skip' in opened) return { rows: [], closed_count: 0 }; // no-db / no-table / unreachable：真的没有行
  const db = opened.db;
  try {
    const active = opts?.section
      ? (db
          .prepare(`SELECT ${ROW_COLUMNS} FROM ledger_rows WHERE state = 'active' AND section = ? ORDER BY opened_at, rowid`)
          .all(opts.section) as unknown as LedgerRow[])
      : (db
          .prepare(`SELECT ${ROW_COLUMNS} FROM ledger_rows WHERE state = 'active' ORDER BY opened_at, rowid`)
          .all() as unknown as LedgerRow[]);
    if (!opts?.includeClosed) return { rows: active, closed_count: 0 };
    const closed = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM ledger_rows WHERE state IN ('done','void')`).get() as { n: number }).n,
    );
    return { rows: active, closed_count: closed };
  } finally {
    db.close();
  }
}

/** 按 ref_id 取一行 + 全部事件（同 ref_id 多行 = 有已销历史 ⇒ 优先活跃行，否则取最新；events 按 seq 升序逐字） */
export function getRow(projectRoot: string, refId: string): LedgerRowWithEvents | null {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) return null;
  const db = opened.db;
  try {
    const row = db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM ledger_rows WHERE ref_id = ?
         ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, rowid DESC
         LIMIT 1`,
      )
      .get(refId) as LedgerRow | undefined;
    if (!row) return null;
    const events = db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM ledger_events WHERE row_id = ? ORDER BY seq, id`)
      .all(row.row_id) as unknown as LedgerEvent[];
    return { ...row, events };
  } finally {
    db.close();
  }
}
