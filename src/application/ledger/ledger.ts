/**
 * ledger.ts —— T-#LEDGER-ENGINE L1：台账引擎**写端 + 只读查询**（真相住 tasks.db 新表）。
 *                T-#LEDGER-ENGINE L2：**关系层**（subject 锚点 + 冲突点名）与**待人工薄队列**。
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
 * ## L2 增补的两条（同样打断即红）
 * ⑤ **同一 subject 不许两条活跃 engine 行并存**（用户哲学②：把矛盾从"人眼发现"变成"写入时打回"）：
 *    · DB 层 = `ledger_rows_active_subject` 部分唯一索引（`origin='engine'` ∧ `record_kind='task'`
 *      ∧ `state='active'` ∧ `subject_path IS NOT NULL` ∧ `superseded_by IS NULL`）；
 *    · 写端 = {@link hangRow} 在 INSERT 前**先点名**（唯一索引只说"不行"，报文要说"被谁占着、两条出路"）。
 *    ★ `origin='import'` 的存量行**豁免**：把历史整本灌进来不该被新约束当场判非法；
 *      它们的冲突由 {@link subjectConflicts} 现算点名（灯亮着、但不阻塞迁移）。
 * ⑥ **"机器判不了"是一个可消项的队列，不是一个 state**：needs_human 走 `ledger_review_queue`
 *    （`resolved_at/by` 可变），**不新增 `state='needs_human'`** —— state 回答"这行活没活"，
 *    needs_human 回答"机器能不能判"，两个正交维度塞一列会同时污染 `listActive` 与 ⑤ 的 WHERE。
 *
 * ## 层次与入口
 * application 层，函数式 API（无 class、无 DI）。CLI/MCP ToolDef 挂接仍是后续子卡的事
 * （L2 的入口是 module-only：`tsx` 直接跑 importer，见 `importer.ts` 头注）。
 * ★ 没有全局 closeAll：每个开库的 helper（withWriteTx / listActive / getRow）都在 finally 里 db.close()，
 *   句柄不跨调用存活（见 L1 自述 R2）。
 */
import { DatabaseSync } from 'node:sqlite';
import { getTasksDbFile, openTasksDb, openTasksDbForRead, tasksDbLockFailure } from '../../infrastructure/task_history.js';

export type LedgerState = 'active' | 'done' | 'void';
export type LedgerEventKind = 'hang' | 'annotate' | 'close' | 'reopen' | 'verdict' | 'supersede';

/**
 * 一行是**哪种实体**（一张表收五种，见 `task_history.ts#LEDGER_ADDED_COLUMNS` 的 `record_kind`）。
 * · `task` —— 挂账行（有业务 id：`T-#*` / `R##` / `T###` / `D-#*` / `GAP-*`），有 state 生命周期；
 * · `ruling` —— §F 裁决留档（一行一条裁定；无 state 生命周期，语义上永不销账）；
 * · `prose` / `discipline` / `meta` —— **视图素材**（散文 / §H 纪律段 / 标题与表头）：它们不是"账"，
 *   但没有它们 L3 就**无法逐字重建** docs/todo.md（"少了这一段"与"本来就没有"在库里长得一样）。
 */
export type LedgerRecordKind = 'task' | 'prose' | 'ruling' | 'discipline' | 'meta';

/** 这一行是**谁写的**：`engine` = 本引擎挂的账（受 subject 硬约束）；`import` = 从 MD 一次性迁入的存量（豁免但可查） */
export type LedgerOrigin = 'engine' | 'import';

/** 关系层锚点：仓库相对路径 + 可选符号名（`src/x.ts` / `src/x.ts#fn`）—— **行号永远不进键** */
export interface LedgerSubject {
  path: string;
  symbol?: string | null;
}

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
  record_kind: LedgerRecordKind;
  origin: LedgerOrigin;
  subject_path: string | null;
  subject_symbol: string | null;
  /** 源文件行号（**只做排序投影**，不进任何唯一键；engine 挂账行没有源行 ⇒ NULL） */
  ordinal: number | null;
}

/**
 * 带上原文证据的一行（**只在需要逐字重建/取证时读**：`source_json` 是整行原文，
 * `listActive` 默认不带它 —— 一次 600 行的默认查询不该把原文全捞出来）。
 */
export interface LedgerRowWithSource extends LedgerRow {
  source_json: string | null;
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

export interface LedgerRowWithEvents extends LedgerRowWithSource {
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
  /** 关系层锚点（给了就受"同 subject 唯一活跃 engine 行"约束） */
  subject?: LedgerSubject | null;
  /**
   * 明确声明"我取代的是谁"——**唯一的合法冲突出路**（另一条是"另起 subject"）。
   * 给了它，同事务内把那条旧行的 `superseded_by` 指到本行 + 追加 supersede 事件（旧行仍 active，见不变量④）。
   */
  declareSupersedes?: string;
  /** 默认 `task`（其余 kind 由 importer 写；engine 写端挂的都是账） */
  recordKind?: LedgerRecordKind;
  /** 默认 `engine` */
  origin?: LedgerOrigin;
}

/** 一条冲突组的成员（`subjectConflicts()` 的读数单元格） */
export interface SubjectConflictMember {
  ref_id: string;
  origin: LedgerOrigin;
  state: LedgerState;
  superseded_by: string | null;
}

/** 一组同 subject 的活跃行 —— 关系层矛盾的第一份可读读数（现算，不落表） */
export interface SubjectConflict {
  subject_path: string;
  subject_symbol: string | null;
  members: SubjectConflictMember[];
}

/** 待人工的原因（闭集；与 `ledger_review_queue.reason` 的 CHECK 逐字一致） */
export type ReviewReason = 'half-escaped' | 'subject-conflict' | 'multi-anchor' | 'ragged' | 'drift';

export interface ReviewItemInput {
  refId?: string | null;
  subject?: LedgerSubject | null;
  reason: ReviewReason;
  /** 人读一句话：为什么机器判不了 / 该人做什么 */
  detail: string;
  candidates?: readonly string[];
  sourceJson?: string | null;
}

/** 队列里的一条（读出口） */
export interface ReviewItem {
  id: number;
  ref_id: string | null;
  subject_path: string | null;
  subject_symbol: string | null;
  reason: ReviewReason;
  detail: string;
  candidates_json: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const ROW_COLUMNS =
  'rowid AS row_id, ref_id, section, title, problem, proposal, state, superseded_by, opened_at, closed_at, closed_reason, closed_evidence, ' +
  'record_kind, origin, subject_path, subject_symbol, ordinal';

const ROW_COLUMNS_WITH_SOURCE = `${ROW_COLUMNS}, source_json`;

const EVENT_COLUMNS = 'id, row_id, seq, kind, at, "by" AS by, body, supersedes_event_id';

const REVIEW_COLUMNS =
  'id, ref_id, subject_path, subject_symbol, reason, detail, candidates_json, created_at, resolved_at, resolved_by';

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

/**
 * subject 归一化（写入前唯一一处）：`\\`→`/`、去首尾空白、去尾部 `()`；
 * **行号一律剥掉**（`src/x.ts:103-121` ⇒ `src/x.ts`）—— 坐标不是身份（改个行号不该变成另一条锚点）。
 * 路径必须是**仓库相对**（不许绝对路径 / `..` / 盘符）：锚点要跨机器可比。
 */
export function normalizeSubject(subject: LedgerSubject | null | undefined): { path: string; symbol: string | null } | null {
  if (!subject) return null;
  let p = String(subject.path ?? '').trim().replace(/\\/g, '/');
  if (!p) return null;
  p = p.replace(/:\d+(?:-\d+)?$/, ''); // 剥行号（可带范围）
  p = p.replace(/^\.\//, '').replace(/^\/+/, '');
  if (/^[A-Za-z]:\//.test(p) || p.startsWith('..') || p.includes('/../')) {
    throw new Error(`[ledger] subject.path 必须是仓库相对路径（收到 ${subject.path}）`);
  }
  let symbol = subject.symbol === undefined || subject.symbol === null ? '' : String(subject.symbol).trim();
  symbol = symbol.replace(/\(\)$/, ''); // `fn()` ⇒ `fn`（同一个符号）
  return { path: p, symbol: symbol || null };
}

/**
 * 一次操作 = 一个事务：行状态与事件要么全成，要么一个字节没动。
 *
 * ★★★ 2026-11-17（十维审计 P0-A1）：**串行语义不变**（仍是 `BEGIN IMMEDIATE`），补的是两件：
 *   ① **退避**：`openTasksDb` 现在设 `busy_timeout=5000`（对齐 `cache.db`）⇒ 撞锁时先排队，
 *      不再"2ms 就失败"（A1 前的实测：两进程各 60 次 `hangRow` ⇒ 39/120 直接 `database is locked`）；
 *   ② **可读失败**：排队也排不上时抛 `E-LEDGER-BUSY`（带修法），而不是裸 `database is locked`。
 *   ★ 为什么**不**改成乐观重试：M7 的口径更正写清了 —— 台账缺的是退避与可读失败，不是原子性；
 *     `BEGIN IMMEDIATE` 在事务开头就拿写意图锁，`MAX(seq)+1` 与"先点名再 INSERT"都因此成立。
 *   `where` 只用于失败报文（点名**是哪一次操作**撞的锁），不参与任何判断。
 */
function withWriteTx<T>(projectRoot: string, where: string, fn: (db: DatabaseSync) => T): T {
  const file = getTasksDbFile(projectRoot);
  const db = openTasksDb(projectRoot); // 写端唯一开库口径（reachable + mkdir + TASKS_SCHEMA_SQL）
  try {
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      // ★ 等锁的失败点就在这一句（busy_timeout 用完仍拿不到写意图锁）
      throw tasksDbLockFailure(e, where, file);
    }
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw tasksDbLockFailure(e, where, file);
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

/**
 * 追加一条事件（**唯一的 appendEvent 实现**）：seq = 该行当前 max(seq)+1（同事务内算，UNIQUE(row_id,seq) 兜底）。
 * ★ 导出成 `(db, …)` 形态是给 importer 用的：它自己开事务批量写行，**但事件写入必须还是这一处**。
 */
export function appendEventTo(
  db: DatabaseSync,
  rowId: number,
  kind: LedgerEventKind,
  by: string,
  body: string | null,
  supersedesEventId: number | null = null,
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

/** 同 subject 的活跃 engine task 行（不含本行；`refId` 为空时全量） */
function sameSubjectActiveEngineRows(
  db: DatabaseSync,
  subject: { path: string; symbol: string | null },
  excludeRefId: string | null,
): Array<{ ref_id: string; row_id: number }> {
  return db
    .prepare(
      `SELECT ref_id, rowid AS row_id FROM ledger_rows
        WHERE state = 'active' AND record_kind = 'task' AND origin = 'engine'
          AND subject_path = ? AND COALESCE(subject_symbol,'') = ?
          AND superseded_by IS NULL AND ref_id <> ?`,
    )
    .all(subject.path, subject.symbol ?? '', excludeRefId ?? '') as Array<{ ref_id: string; row_id: number }>;
}

/**
 * 挂账：同 ref_id 活跃期重复挂 ⇒ 部分唯一索引抛（语义错误转成可读报文）；
 * 给了 `subject` 时，同 subject 已有活跃 **engine** 行 ⇒ 先点名再拒（两条出路写进报文）。
 */
export function hangRow(projectRoot: string, input: HangRowInput): number {
  const refId = nonEmpty('refId', input.refId);
  const section = nonEmpty('section', input.section);
  const title = nonEmpty('title', input.title);
  const by = nonEmpty('by', input.by);
  const recordKind = input.recordKind ?? 'task';
  const origin = input.origin ?? 'engine';
  const subject = normalizeSubject(input.subject ?? null);
  const declareSupersedes = input.declareSupersedes ? nonEmpty('declareSupersedes', input.declareSupersedes) : null;
  if (declareSupersedes && !subject) {
    throw new Error('[ledger] declareSupersedes 必须与 subject 一起给（没有 subject 就没有"同一个观点"可取代）');
  }
  return withWriteTx(projectRoot, 'hangRow', (db) => {
    if (subject && recordKind === 'task' && origin === 'engine') {
      const occupy = sameSubjectActiveEngineRows(db, subject, refId);
      if (occupy.length) {
        if (!declareSupersedes) {
          throw new Error(
            `[ledger] subject "${subject.path}${subject.symbol ? '#' + subject.symbol : ''}" 已被 ` +
              `${occupy.map((r) => r.ref_id).join(' · ')} 占用（活跃 engine 行）。二选一：\n` +
              "  ① 给 declareSupersedes='<上面那个 ref_id>'（写 superseded_by + supersede 事件，旧行仍活跃）；\n" +
              '  ② 另起 subject（如果你说的是另一件事）。',
          );
        }
        if (!occupy.some((r) => r.ref_id === declareSupersedes)) {
          throw new Error(
            `[ledger] declareSupersedes="${declareSupersedes}" 不在占用该 subject 的行里（` +
              `实际占用：${occupy.map((r) => r.ref_id).join(' · ')}）—— 取代一个没占用它的人等于静默改账`,
          );
        }
      }
    }
    let rowId: number;
    // ★★★ 顺序不许反：**先让位、再进座**。唯一索引 `ledger_rows_active_subject` 在 INSERT 那一刻就生效，
    //   而"被取代"要等新行落库后才知道新 ref_id ⇒ 若先 INSERT 再给旧行打 superseded_by，
    //   INSERT 自己就撞上旧行占着的键（实测：`UNIQUE constraint failed: index 'ledger_rows_active_subject'`）。
    //   先给旧行打指针是**安全**的：同一事务里 INSERT 失败 ⇒ ROLLBACK 会把指针回滚。
    if (declareSupersedes) {
      const old = db
        .prepare(`SELECT rowid AS row_id, subject_path, subject_symbol FROM ledger_rows WHERE ref_id = ? AND state = 'active'`)
        .get(declareSupersedes) as { row_id: number; subject_path: string | null; subject_symbol: string | null } | undefined;
      if (!old) throw new Error(`[ledger] declareSupersedes="${declareSupersedes}" 没有活跃行，取代无从谈起`);
      db.prepare('UPDATE ledger_rows SET superseded_by = ? WHERE rowid = ?').run(refId, old.row_id);
    }
    try {
      rowId = insertLedgerRow(db, {
        refId,
        section,
        title,
        problem: opt(input.problem),
        proposal: opt(input.proposal),
        recordKind,
        origin,
        subject,
        ordinal: null,
        sourceJson: null,
      });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('ledger_rows_active_subject')) {
        throw new Error(
          `[ledger] subject "${subject?.path}${subject?.symbol ? '#' + subject.symbol : ''}" 已被另一条活跃 engine 行占用` +
            '（唯一索引拒绝第二条）⇒ 给 declareSupersedes=<占用者 ref_id>，或先销账/取代那一条',
        );
      }
      if (msg.includes('UNIQUE constraint failed')) {
        throw new Error(`[ledger] ref_id="${refId}" 已在活跃期挂账（部分唯一索引拒绝重复挂；先销账再重挂）`);
      }
      throw e;
    }
    appendEventTo(db, rowId, 'hang', by, `section=${section}\ntitle=${title}`, null);
    if (declareSupersedes) {
      const old = db
        .prepare(`SELECT rowid AS row_id FROM ledger_rows WHERE ref_id = ? AND state = 'active'`)
        .get(declareSupersedes) as { row_id: number } | undefined;
      if (!old) throw new Error(`[ledger] declareSupersedes="${declareSupersedes}" 没有活跃行，取代无从谈起`);
      const prev = db.prepare('SELECT MAX(id) AS id FROM ledger_events WHERE row_id = ?').get(old.row_id) as {
        id: number | null;
      };
      appendEventTo(db, old.row_id, 'supersede', by, `superseded_by=${refId}`, prev.id);
    }
    return rowId;
  });
}

/** 写一条 `ledger_rows` 的**唯一实现**（engine 写端与 importer 共用；只 INSERT，不改既有行） */
export interface LedgerRowWrite {
  refId: string;
  section: string;
  title: string;
  problem?: string | null;
  proposal?: string | null;
  recordKind: LedgerRecordKind;
  origin: LedgerOrigin;
  subject?: { path: string; symbol: string | null } | null;
  ordinal?: number | null;
  sourceJson?: string | null;
}

export function insertLedgerRow(db: DatabaseSync, row: LedgerRowWrite): number {
  return Number(
    db
      .prepare(
        `INSERT INTO ledger_rows
           (ref_id, section, title, problem, proposal, state, opened_at,
            record_kind, origin, subject_path, subject_symbol, ordinal, source_json)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.refId,
        row.section,
        row.title,
        row.problem ?? null,
        row.proposal ?? null,
        new Date().toISOString(),
        row.recordKind,
        row.origin,
        row.subject?.path ?? null,
        row.subject?.symbol ?? null,
        row.ordinal ?? null,
        row.sourceJson ?? null,
      ).lastInsertRowid,
  );
}

/** 批注：**只追加 event**，不碰行的任何列（尤其 problem/proposal 原样保留） */
export function annotateRow(projectRoot: string, refId: string, body: string, by: string): number {
  const text = bodyOf('body', body); // 判空用 trim，存值保留原文（内部换行/空白逐字）
  return withWriteTx(projectRoot, 'annotateRow', (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    return appendEventTo(db, row.row_id, 'annotate', by, text, null);
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
  return withWriteTx(projectRoot, 'closeRow', (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    const at = new Date().toISOString();
    db.prepare(
      `UPDATE ledger_rows
          SET state = ?, closed_at = ?, closed_reason = ?, closed_evidence = ?
        WHERE rowid = ? AND state = 'active'`,
    ).run(state, at, why, proof, row.row_id);
    return appendEventTo(db, row.row_id, 'close', by, `reason=${why}\nevidence=${proof}`, null);
  });
}

/** 重开：留痕（reopen 事件），状态回到 active；部分唯一索引保证不会与另一条活跃行撞 ref_id */
export function reopenRow(projectRoot: string, refId: string, by: string): number {
  return withWriteTx(projectRoot, 'reopenRow', (db) => {
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
    return appendEventTo(db, row.row_id, 'reopen', by, null, null);
  });
}

/** 被取代：只设 superseded_by 指针 + 追加 supersede 事件；state 保持 active（superseded 是关系不是结局） */
export function supersedeRow(projectRoot: string, refId: string, supersededBy: string, by: string): number {
  const ptr = nonEmpty('supersededBy', supersededBy);
  return withWriteTx(projectRoot, 'supersedeRow', (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    if (ptr === refId) throw new Error('[ledger] superseded_by 不能指向自己（自己取代自己没有信息）');
    db.prepare('UPDATE ledger_rows SET superseded_by = ? WHERE rowid = ?').run(ptr, row.row_id);
    const prev = db
      .prepare(`SELECT MAX(id) AS id FROM ledger_events WHERE row_id = ?`)
      .get(row.row_id) as { id: number | null };
    return appendEventTo(db, row.row_id, 'supersede', by, `superseded_by=${ptr}`, prev.id);
  });
}

/** 裁定：lead 综合后写 verdict —— 只追加 event，不覆盖此前任何一条 */
export function writeVerdict(projectRoot: string, refId: string, body: string, by: string): number {
  const text = bodyOf('body', body);
  return withWriteTx(projectRoot, 'writeVerdict', (db) => {
    const row = activeRowByRef(db, nonEmpty('refId', refId));
    return appendEventTo(db, row.row_id, 'verdict', by, text, null);
  });
}

/**
 * 只读查询：**活跃集的默认口径 = 活跃 task 行**（prose/ruling/meta 不进"活跃任务集"——它们不是待办）。
 * `includeClosed:true` 时含 done/void 并给 closed_count。
 * ★ 走 `openTasksDbForRead`：库/表不存在一律按 0 行计，**不建库、不产 0 字节文件**。
 *
 * @param opts.recordKind 默认 `'task'`；`'all'` = 不按 kind 过滤（L3 生成视图用 {@link listRows} 更合适）
 * @param opts.subject    关系层过滤（同 subject 的活跃行——"这件事有几条活账"）
 */
export function listActive(
  projectRoot: string,
  opts?: {
    section?: string;
    includeClosed?: boolean;
    recordKind?: LedgerRecordKind | 'all';
    subject?: LedgerSubject;
  },
): ListActiveResult {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows'); // 表名已加进 union（见补丁 B）
  if ('skip' in opened) return { rows: [], closed_count: 0 }; // no-db / no-table / unreachable：真的没有行
  const db = opened.db;
  try {
    const where = [`state = 'active'`];
    const args: Array<string | number> = [];
    if (opts?.recordKind !== 'all') {
      where.push('record_kind = ?');
      args.push(opts?.recordKind ?? 'task');
    }
    if (opts?.section) {
      where.push('section = ?');
      args.push(opts.section);
    }
    const subject = normalizeSubject(opts?.subject ?? null);
    if (subject) {
      where.push("subject_path = ? AND COALESCE(subject_symbol,'') = ?");
      args.push(subject.path, subject.symbol ?? '');
    }
    const active = db
      .prepare(`SELECT ${ROW_COLUMNS} FROM ledger_rows WHERE ${where.join(' AND ')} ORDER BY opened_at, rowid`)
      .all(...args) as unknown as LedgerRow[];
    if (!opts?.includeClosed) return { rows: active, closed_count: 0 };
    const closed = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM ledger_rows WHERE state IN ('done','void')`).get() as { n: number }).n,
    );
    return { rows: active, closed_count: closed };
  } finally {
    db.close();
  }
}

/**
 * 按源文件顺序取行（**L3 逐字重建视图的输入**；`withSource:true` 时带 `source_json` 原文证据）。
 * 排序 = `ordinal`（源行号）→ rowid：`ordinal` 是坐标，只用于**还原顺序**，不进任何唯一键。
 */
export function listRows(
  projectRoot: string,
  opts?: { section?: string; recordKinds?: readonly LedgerRecordKind[]; origin?: LedgerOrigin; withSource?: boolean },
): LedgerRowWithSource[] {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) return [];
  const db = opened.db;
  try {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (opts?.section) {
      where.push('section = ?');
      args.push(opts.section);
    }
    if (opts?.origin) {
      where.push('origin = ?');
      args.push(opts.origin);
    }
    if (opts?.recordKinds?.length) {
      where.push(`record_kind IN (${opts.recordKinds.map(() => '?').join(',')})`);
      args.push(...opts.recordKinds);
    }
    const cols = opts?.withSource ? ROW_COLUMNS_WITH_SOURCE : `${ROW_COLUMNS}, NULL AS source_json`;
    const sql =
      `SELECT ${cols} FROM ledger_rows` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY (ordinal IS NULL), ordinal, rowid';
    return db.prepare(sql).all(...args) as unknown as LedgerRowWithSource[];
  } finally {
    db.close();
  }
}

/**
 * 台账读端**能不能判**（闭集）。★ 2026-11-17（L3/E8）：patrol 的台账体检改读引擎后，
 * 它必须能**逐态**说出"为什么判不了"——"表还没建"和"0 条欠账"在读数上长得一样，那是本仓 0.12 的老病。
 *
 * @returns `ok` = 库在且 `ledger_rows` 表在；其余三态分别对应"根不可达 / 库没有 / 表没建"
 */
export function ledgerAvailability(projectRoot: string): 'ok' | 'unreachable' | 'no-db' | 'no-table' {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  return 'skip' in opened ? opened.skip : 'ok';
}

/** 按 ref_id 取一行 + 全部事件（同 ref_id 多行 = 有已销历史 ⇒ 优先活跃行，否则取最新；events 按 seq 升序逐字） */
export function getRow(projectRoot: string, refId: string): LedgerRowWithEvents | null {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) return null;
  const db = opened.db;
  try {
    const row = db
      .prepare(
        `SELECT ${ROW_COLUMNS_WITH_SOURCE} FROM ledger_rows WHERE ref_id = ?
         ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, rowid DESC
         LIMIT 1`,
      )
      .get(refId) as LedgerRowWithSource | undefined;
    if (!row) return null;
    const events = db
      .prepare(`SELECT ${EVENT_COLUMNS} FROM ledger_events WHERE row_id = ? ORDER BY seq, id`)
      .all(row.row_id) as unknown as LedgerEvent[];
    return { ...row, events };
  } finally {
    db.close();
  }
}

/**
 * **关系层矛盾的唯一读数**：同 `(subject_path, subject_symbol)` 的活跃 task 行 ≥ 2 组（任意 origin）。
 *
 * ★ 为什么现算不落表：冲突是**从行重算得出来的**，落表 = 第二份真相（必然漂）。
 * ★ 为什么 import 行也算：它们**豁免唯一索引**（不阻塞迁移），但**矛盾仍然存在** ⇒ 灯必须亮。
 *   ⇒ importer 每发现一组就给 `ledger_review_queue` 插一条（可消项）；本函数只负责点名。
 */
export function subjectConflicts(projectRoot: string): SubjectConflict[] {
  const opened = openTasksDbForRead(projectRoot, 'ledger_rows');
  if ('skip' in opened) {
    if (opened.skip === 'unreachable') {
      process.stderr.write(
        `[ledger] subjectConflicts：项目根不可达 —— ${opened.file} ⇒ 按"没有冲突"计（★ 这是「读不到」，不是「没有冲突」）\n`,
      );
    }
    return [];
  }
  const db = opened.db;
  try {
    const groups = db
      .prepare(
        `SELECT subject_path AS path, subject_symbol AS sym, COUNT(*) AS n
           FROM ledger_rows
          WHERE state = 'active' AND record_kind = 'task' AND subject_path IS NOT NULL
          GROUP BY subject_path, COALESCE(subject_symbol,'')
         HAVING COUNT(*) > 1
          ORDER BY subject_path, COALESCE(subject_symbol,'')`,
      )
      .all() as Array<{ path: string; sym: string | null; n: number }>;
    const out: SubjectConflict[] = [];
    for (const g of groups) {
      const members = db
        .prepare(
          `SELECT ref_id, origin, state, superseded_by FROM ledger_rows
            WHERE state = 'active' AND record_kind = 'task' AND subject_path = ?
              AND COALESCE(subject_symbol,'') = ?
            ORDER BY rowid`,
        )
        .all(g.path, g.sym ?? '') as unknown as SubjectConflictMember[];
      out.push({ subject_path: g.path, subject_symbol: g.sym, members });
    }
    return out;
  } finally {
    db.close();
  }
}

/** 记一条"待人工"（幂等：同 ref_id/subject/reason 的**未消项**只有一条 ⇒ 重复 import 不刷屏） */
export function queueReview(projectRoot: string, input: ReviewItemInput): number {
  const subject = normalizeSubject(input.subject ?? null);
  const reason = nonEmpty('reason', input.reason) as ReviewReason;
  const detail = nonEmpty('detail', input.detail);
  return withWriteTx(projectRoot, 'queueReview', (db) => {
    const hit = db
      .prepare(
        `SELECT id FROM ledger_review_queue
          WHERE resolved_at IS NULL AND reason = ?
            AND COALESCE(ref_id,'') = COALESCE(?, '')
            AND COALESCE(subject_path,'') = COALESCE(?, '')
            AND COALESCE(subject_symbol,'') = COALESCE(?, '')`,
      )
      .get(reason, input.refId ?? null, subject?.path ?? null, subject?.symbol ?? null) as { id: number } | undefined;
    if (hit) return Number(hit.id);
    return Number(
      db
        .prepare(
          `INSERT INTO ledger_review_queue
             (ref_id, subject_path, subject_symbol, reason, detail, candidates_json, source_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.refId ?? null,
          subject?.path ?? null,
          subject?.symbol ?? null,
          reason,
          detail,
          input.candidates ? JSON.stringify(input.candidates) : null,
          input.sourceJson ?? null,
          new Date().toISOString(),
        ).lastInsertRowid,
    );
  });
}

/** 队列读数的**五态**（★ `ok` 以外都不是"0 条未消项"；与 `domain/review_gate.ts#ReviewGateReading` 同一闭集） */
export type ReviewQueueAvailability = 'ok' | 'unreachable' | 'no-db' | 'no-table' | 'error';

/** 队列**读数**：条目 + 「为什么没有/读不到」（★ 两者必须一起给，否则"读不到"会变成"0 条"） */
export interface ReviewQueueReading {
  availability: ReviewQueueAvailability;
  items: ReviewItem[];
  /** 队列库文件绝对路径（读不到时人要知道看的是哪个文件） */
  file: string;
  /** `availability === 'error'` 时的原话（库打不开 / 查询失败）—— ★ 不许吞成一个 `[]` */
  error?: string | null;
}

/**
 * ★★★ 2026-11-18（市场吸收 P1 · 未消项闸接线）：**队列的唯一读实现**，且**区分「没有」与「读不到」**。
 *
 * ## 为什么不能只用 {@link listReviewQueue}
 * 它读不到时返回 `[]` —— 而 `[]` 同时表示"0 条未消项"（可以放行）与"库不在场/根不可达"（**判不了**）。
 * 这个混同在**事后清理面**上只是难看；在**闸**上就是本仓 0.12 的老病（把「读不到」读成「通过」）。
 * ⇒ 闸要的是 `{ availability, items }`；`listReviewQueue` 保留为它的**投影**（同一实现，不是第二把尺）。
 *
 * ## 为什么 `error` 不向外抛
 * 读端抛异常 = 每个调用方各写一遍 try/catch，且**总有人**会写成"catch 住、当 0 条"。
 * ⇒ 把"打不开"做成一**态**（带原话），判不判由调用方按语义决定（闸那边是**拒**，见 `review_gate` I2）。
 *
 * @param projectRoot 被查的项目根（★ 与 `task_ops#completeTask` 内其它取数**同一个根**：`dsl.source_root`）
 */
export function readReviewQueue(
  projectRoot: string,
  opts?: { reason?: ReviewReason; openOnly?: boolean },
): ReviewQueueReading {
  const file = getTasksDbFile(projectRoot);
  try {
    const opened = openTasksDbForRead(projectRoot, 'ledger_review_queue');
    if ('skip' in opened) return { availability: opened.skip, items: [], file: opened.file };
    const db = opened.db;
    try {
      const where: string[] = [];
      const args: string[] = [];
      if (opts?.openOnly !== false) where.push('resolved_at IS NULL');
      if (opts?.reason) {
        where.push('reason = ?');
        args.push(opts.reason);
      }
      const sql =
        `SELECT ${REVIEW_COLUMNS} FROM ledger_review_queue` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY id';
      const items = db.prepare(sql).all(...args) as unknown as ReviewItem[];
      return { availability: 'ok', items, file };
    } finally {
      db.close();
    }
  } catch (e) {
    // ★ 库在、但打不开 / 查询失败（损坏 · 被锁 · 权限）⇒ **判不了**，原话保留（不吞、不降级成"0 条"）。
    return { availability: 'error', items: [], file, error: (e as Error).message };
  }
}

/**
 * 读队列（默认只读**未消项**——那才是"灯"；`openOnly:false` 连历史一起给）。
 * ★ 返回 `[]` 有**两种**含义（真的 0 条 / 读不到）⇒ **要判"有没有"就必须用 {@link readReviewQueue}**。
 */
export function listReviewQueue(
  projectRoot: string,
  opts?: { reason?: ReviewReason; openOnly?: boolean },
): ReviewItem[] {
  return readReviewQueue(projectRoot, opts).items;
}

/** 消项（`resolved_at/by` 可变 —— 这正是"队列"相对 append-only 事件流的**唯一**理由） */
export function resolveReview(projectRoot: string, id: number, by: string): void {
  const who = nonEmpty('by', by);
  withWriteTx(projectRoot, 'resolveReview', (db) => {
    const r = db
      .prepare('UPDATE ledger_review_queue SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL')
      .run(new Date().toISOString(), who, id);
    if (Number(r.changes ?? 0) === 0) {
      throw new Error(`[ledger] 队列项 #${id} 不存在或已消项（不静默重复消项）`);
    }
  });
}
