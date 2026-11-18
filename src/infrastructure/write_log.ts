/**
 * write_log —— **「无卡变更」的审计账**（`<proj>/.agent-io/tasks.db#write_log`）。
 *
 * ## 它回答的问题（`docs/todo.md` §一 0.8）
 * 「谁在什么时候改了哪个文件、那次改动挂在**哪张卡**上」。
 * 改前这个问题**没有账**：卡的判定在 `write_gate` 里逐文件算出来了，但只聚合进 `coveredCards`
 * （去重后的卡清单）⇒ `rel → card` 的对应关系被丢掉；而 `watch` 根本不知道"谁改的"
 * （`WatchBatchSummary` 里没有 actor）。⇒ 唯一能记账的地方是**唯一写原语** `source_writer`
 * （5 个写动词的落盘点 + 回滚通道）。
 *
 * ## ★ 为什么不住 `cache.db`
 * `cache.db` 是**可重建**的索引库（`import_project` 会 DROP/DELETE）⇒ 审计账放进去 = 跑一次导入就删光。
 * 判据与 `task_history` 同一条：**可重建的东西和不可重建的东西不许同库**。
 * ⇒ 表住 `tasks.db`（与活卡 / 历史 / 画布同库），**建表语句在 `task_history.ts#TASKS_SCHEMA_SQL`**
 *   （表结构的唯一住处，不在这里再写一份）。
 *
 * ## ★ 已声明边界（AGENTS-RULES 0.17 口径①：本账**不管**什么）
 * 本账只覆盖**过写原语的写**：`source_writer` 的 `commit` / `append` / `copy` / `move` / `remove`
 * 与回滚通道 `restoreSourceBytes`。**`Write` / `Edit` / shell 直写磁盘不在内**，
 * 且**不打算用周期性全量扫描去兜**（0.19：政策兜底不是机制）—— 要覆盖它需要常驻 daemon（OS 事件），
 * 那是另一件事。⇒ 读端（`scripts/write-log-audit.mjs`）必须把这句话一起打出来。
 *
 * ## 三个字段的口径（写的时候一次定死，读端不许再猜）
 * · `kind`  = 写动词：`commit` / `append` / `copy` / `move` / `remove` / `rollback`
 * · `source`= 写原语名：`source_writer`（5 个动词）/ `restoreSourceBytes`（回滚通道）/
 *   **`unmapped`**（这次写**取不到卡** —— 与"有卡"必须能区分，否则本账就把两件事抹成一件）
 * · `gate_branch` = 这次写是**哪一支放行的**（`write_gate#TaskGateBasis` 的逐文件版）
 */
import { DatabaseSync } from 'node:sqlite';
import { getTasksDbFile, openTasksDb, openTasksDbForRead, tasksDbLockFailure } from './task_history.js';

/** 写动词（与 `source_writer#SourceWriteTxn` 的 5 个落盘点 + 回滚通道一一对应） */
export type WriteLogKind = 'commit' | 'append' | 'copy' | 'move' | 'remove' | 'rollback';

/** 写原语名（`unmapped` = 这次写取不到卡，不是原语名 —— 它是"无卡"那一档的标记） */
export type WriteLogSource = 'source_writer' | 'restoreSourceBytes' | 'unmapped';

/** 一条写账（★ 与表列同形，不另造一层 DTO） */
export interface WriteLogRow {
  at: string;
  file: string;
  actor: string | null;
  card_id: string | null;
  card_feature: string | null;
  kind: WriteLogKind;
  source: WriteLogSource;
  gate_branch: string | null;
}

/**
 * 记账上下文 —— **全部来自闸的逐文件读数**，本模块不自己判第二遍。
 * ★ `card_of` / `branch_of` 的形状与 `write_gate#TaskGateOutcome` 同构（这里按结构声明，
 *   是为了不把 infrastructure 反向依赖到 application 的类型上）。
 */
export interface WriteLogCtx {
  actor: string | null;
  /** 记账时刻（省略 = now）；判据里必须给固定值，否则 `behavior-cases` 不可比 */
  at?: string;
  /** `write_gate#TaskGateOutcome.card_of`：有卡 ⇒ `{feature,nodeId}`，放行但无卡 ⇒ `null` */
  card_of?: Record<string, { feature: string; nodeId: string } | null>;
  /** `write_gate#TaskGateOutcome.branch_of`：逐文件的放行支名 */
  branch_of?: Record<string, string | null>;
}

/**
 * **一条写账的判定核**（纯函数，无 IO）。
 *
 * 不变量（三条，都能变红）：
 *   ① 有卡 ⇒ `card_id` / `card_feature` 取自 `card_of`，`source='source_writer'`；
 *   ② **取不到卡 ⇒ `card_id=null` 且 `source='unmapped'`** —— 否则"无卡写"与"有卡写"在账上不可区分；
 *   ③ 回滚通道（`kind='rollback'`）**本来就不过闸** ⇒ `card_id=null` 是对的，但 `source` 必须是
 *      `restoreSourceBytes`（它是回滚，不是"无卡写"；把两者混起来会把回滚算成欠账）。
 */
export function writeLogRowOf(rel: string, kind: WriteLogKind, ctx: WriteLogCtx): WriteLogRow {
  const card = ctx.card_of?.[rel] ?? null;
  const source: WriteLogSource = kind === 'rollback' ? 'restoreSourceBytes' : card ? 'source_writer' : 'unmapped';
  return {
    at: ctx.at ?? new Date().toISOString(),
    file: rel,
    actor: ctx.actor ?? null,
    card_id: card?.nodeId ?? null,
    card_feature: card?.feature ?? null,
    kind,
    source,
    gate_branch: ctx.branch_of?.[rel] ?? (kind === 'rollback' ? 'rollback' : null),
  };
}

/**
 * 一条写账的**可比字符串**（判据专用：`card_id|card_feature|source|gate_branch`）。
 * ★ 为什么单独给一个函数：`behavior-cases` 比的是裸串，给整行对象要比对 JSON repr（键序敏感）。
 */
export function writeLogRowKey(rel: string, kind: WriteLogKind, ctx: WriteLogCtx): string {
  const r = writeLogRowOf(rel, kind, ctx);
  return [r.card_id ?? '', r.card_feature ?? '', r.source, r.gate_branch ?? ''].join('|');
}

/**
 * 逐条写进 `tasks.db#write_log`（一个事务：要么全进，要么一条都不进）。
 *
 * ★ **不抛**：审计是**旁路** —— 记账失败不许把用户的写拖下水（那会让"改不了源码"比"没记账"更贵）。
 *   但也不许静默（0.12）：失败回 `error`，调用方把它推进回执的 `warnings`。
 * @returns `written` = 实际写入行数；`error` = 记账失败的原因（有它时 `written` 必为 0）
 */
export function recordWriteLog(projectRoot: string, rows: readonly WriteLogRow[]): { written: number; error?: string } {
  if (!rows.length) return { written: 0 };
  let db: DatabaseSync | null = null;
  try {
    db = openTasksDb(projectRoot);
    const dbFile = getTasksDbFile(projectRoot);
    const stmt = db.prepare(
      'INSERT INTO write_log (at, file, actor, card_id, card_feature, kind, source, gate_branch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      // ★ P0-A1：等锁失败在这一句 ⇒ 翻成带修法的报文（它的 message 会原样进回执的 warnings）
      throw tasksDbLockFailure(e, 'recordWriteLog', dbFile);
    }
    try {
      for (const r of rows) {
        stmt.run(r.at, r.file, r.actor, r.card_id, r.card_feature, r.kind, r.source, r.gate_branch);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw tasksDbLockFailure(e, 'recordWriteLog（写账）', dbFile);
    }
    return { written: rows.length };
  } catch (e) {
    return { written: 0, error: (e as Error).message };
  } finally {
    // ★ 关库失败**不影响已提交的行**，且此时已没有"再记一条诊断"的去处（库都关不掉）⇒ 只做清理，不再报
    try {
      db?.close();
    } catch {
      /* 清理路径：已提交的数据不受影响，故意不再抛 */
    }
  }
}

/** 读端结果（★ `skip` 非空 = **读不到**，与"一条都没有"是两件事，0.12） */
export interface WriteLogRead {
  rows: WriteLogRow[];
  /** `null` = 读到了（哪怕 0 行）；非空 = 读不到的一句话诊断 */
  skip: string | null;
  /** 库里的总行数（`skip` 时也是 0 —— 它同时是"读到多少"的分母） */
  total: number;
}

const SKIP_TEXT: Record<string, string> = {
  'no-db': '`tasks.db` 还没有（本项目的写账还没开张）',
  'no-table': '`tasks.db` 里还没有 `write_log` 表（本次改动之前的写都不在账上）',
  unreachable: '项目根不可达（目录现在不在盘上）',
};

/**
 * 读某项目的写账（**纯读**：不建库、不建表、不建目录 —— 走 `openTasksDbForRead` 那一把尺）。
 * @param opts.file 只看这个文件（项目相对 posix）；省略 = 全部
 * @param opts.limit 最多返回几行（默认 50，上限 5000）；`total` 始终是**全量**行数
 */
export function readWriteLog(projectRoot: string, opts?: { file?: string; limit?: number }): WriteLogRead {
  const opened = openTasksDbForRead(projectRoot, 'write_log');
  if ('skip' in opened) {
    return { rows: [], skip: SKIP_TEXT[opened.skip] ?? `读不到：${opened.skip}（${opened.file}）`, total: 0 };
  }
  const db = opened.db;
  try {
    const where = opts?.file ? ' WHERE file = ?' : '';
    const args: string[] = opts?.file ? [opts.file] : [];
    const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM write_log${where}`).get(...args) as { n?: number })?.n ?? 0);
    const limit = Math.max(1, Math.min(5000, Math.floor(opts?.limit ?? 50)));
    const raw = db
      .prepare(
        `SELECT at, file, actor, card_id, card_feature, kind, source, gate_branch FROM write_log${where} ORDER BY id DESC LIMIT ?`,
      )
      .all(...args, limit) as Array<Record<string, unknown>>;
    const rows: WriteLogRow[] = raw.map((r) => ({
      at: String(r.at ?? ''),
      file: String(r.file ?? ''),
      actor: r.actor == null ? null : String(r.actor),
      card_id: r.card_id == null ? null : String(r.card_id),
      card_feature: r.card_feature == null ? null : String(r.card_feature),
      kind: String(r.kind ?? '') as WriteLogKind,
      source: String(r.source ?? '') as WriteLogSource,
      gate_branch: r.gate_branch == null ? null : String(r.gate_branch),
    }));
    return { rows, skip: null, total };
  } catch (e) {
    // ★ 读失败 ≠ 没有行（0.12）：回诊断，不回落空集冒充"零无卡写"
    return { rows: [], skip: `读 write_log 失败：${(e as Error).message}`, total: 0 };
  } finally {
    db.close();
  }
}
