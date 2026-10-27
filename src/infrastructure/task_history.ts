/**
 * task_history.ts —— **已了结任务卡的归档库**（`<dataHome>/.agent-io/task-history.db`）。
 *
 * ## 它回答的问题（用户 2026-10-23 原话）
 * 「void 卡本身不是也应该被归档进历史里吗？为什么还放在 To Do 里？……完全可以把它归档进
 *   我们已有的数据库里面，给它单独建一张 history 的表……要查的话你就搜索 history」
 * 「这个 history 也应该来一个在此项目下的单独的表，你为什么其他的重建会影响到这张表呢？」
 *
 * ## ★★★ 为什么是**独立文件**，不是 `cache.db` 里的一张表
 * `cache.db` 是**可重建的索引库**：`infrastructure/index/db.ts:293` 的 `V16_TABLES` 迁移会
 * `DROP TABLE`，`symbols.ts` 会 `DELETE FROM nodes WHERE file_path=?`。
 * ⇒ 把 history 放进去 = **跑一次 `import_project` 就把审计数据删光**。
 * 而 history 是**审计数据**（谁什么时候被作废、理由、证据），它是**不可重建**的。
 * ⇒ 判据：**可重建的东西和不可重建的东西不许住同一个库**。
 *
 * ## ★ 为什么是项目级（`.agent-io/` 下）而不是全局
 * `.agent-io/` 本来就是**每个项目一份**（`getStorageRoot()` = `<dataHome>/.agent-io`），
 * 与 `cache.db` / `design/` 同根 ⇒ 「多项目混在一张表」从构造上就不可能发生。
 *
 * ## 表只有一张（够查就行，不过度设计）
 * ```
 * task_history(id, feature, node_id, state, summary, card_json, moved_at, reason)
 *   PRIMARY KEY (feature, id, moved_at)
 * ```
 * · `card_json` = **整张卡原样**（JSON 字符串）—— evidence / decision 引用 / retire_reason /
 *   readonly 历史一个字节都不改。★ **审计数据不许"摘要化"**：摘要化 = 以后答不上来"当时证据是什么"。
 * · `moved_at` 进主键 ⇒ 同一张 id **可能有多条**（作废 → relaunch → 再作废），历史是 append-only。
 * · `node_id` / `state` / `summary` 是**从 card_json 里冗余出来的查询列**（人要看列表时不必解析 JSON）；
 *   冗余的判据只有一条：**它们是 card_json 的投影，写的时候同一处产生**（见 {@link recordTaskHistory}）。
 *
 * ## 边界（★ 如实写明）
 * · 本文件**只**管这张表（建表 / 写 / 查 / 计数）；**不**读设计 DSL、**不**判状态机。
 *   「什么样的卡能进历史」= `todo.move_to_history` 的判据（`task_ops.ts`），不在这里。
 * · 它**不参与**索引重建、**不被** `import_project` 触碰 —— 没有任何代码路径会删它的行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getStorageRoot } from './storage.js';
import { rootPath } from './roots.js';

// ─────────────────────────────────────────────────────────────
// ★★★ 2026-10-27（ROOTS 步 6 / 乙方案，用户确认）：任务卡搬出 DSL ⇒ `<proj>/.agent-io/tasks.db`
//
// ## 为什么搬（病史）
// 任务卡当前住在**设计册**里（`dsl.todos[]`）。后果是两头不对：
//   · 卡是**跨次会话的过程数据**，册是**意图的权威** —— 两者混在一份文件里，
//     任何"册重建"都要小心别把卡抹掉（`import_project` 的 `allow_design_drop` 拦的就是这个）；
//   · 册按 feature 分、卡按**项目**算 ⇒ 乙方案下"每个项目一个 tasks.db"才是自然归属。
//
// ## 本模块的两个阶段（★ 别把"计划"读成"现状"）
//   · **slice 1（现在）**：`tasks.db` 建库 + `syncTasksFromDsl` **影子同步** + `parityTasks` 对拍。
//     读写**仍然**走 `dsl.todos`（`task_ops` 一个字节没改）⇒ **零行为变更**，可以放心先落库。
//   · **slice 2（下一步）**：`task_ops` 的读写改走本库，`todos[]` 只剩"迁移输入"。
//   · **slice 3**：旧 `history` 角色（`<dataHome>/.agent-io/task-history.db`）退场，历史也进本库。
//
// ## 一个库、两张表（活卡与已了结卡**同库**，这是乙方案的原话）
//   `live_cards(feature,id)`  —— 册上**现在**有的卡（= `dsl.todos[]` 的投影）
//   `task_history(feature,id,moved_at)` —— 已了结的卡（原 `history` 角色的表，原样搬进来）
//   ★ 同一张卡**不许同时在两边**：`syncTasksFromDsl` 见到某 id 已在 history 里就**不复活**它
//     （"移入历史"是单向门；复活只能人显式做）。
// ─────────────────────────────────────────────────────────────

/** `tasks.db` 的绝对路径：`<proj>/.agent-io/tasks.db`（★ 路径只问 `roots.ts#rootPath`） */
export function getTasksDbFile(projectRoot: string): string {
  return rootPath('tasks', projectRoot);
}

/** 建表语句（幂等；★ 表结构只在这一处 —— 与旧 history 表**同列**，因为它们是同一份事实） */
const TASKS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS live_cards (
  id         TEXT NOT NULL,
  feature    TEXT NOT NULL,
  state      TEXT NOT NULL,
  card_json  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (feature, id)
);
CREATE INDEX IF NOT EXISTS idx_live_cards_feature_state ON live_cards(feature, state);
CREATE TABLE IF NOT EXISTS task_history (
  id        TEXT NOT NULL,
  feature   TEXT NOT NULL,
  node_id   TEXT,
  state     TEXT NOT NULL,
  summary   TEXT NOT NULL,
  card_json TEXT NOT NULL,
  moved_at  TEXT NOT NULL,
  reason    TEXT NOT NULL,
  PRIMARY KEY (feature, id, moved_at)
);
CREATE INDEX IF NOT EXISTS idx_task_history_feature_state ON task_history(feature, state);
`;

/** 打开某项目的 `tasks.db`（不存在就建；用完关 —— 小库，不设连接池） */
export function openTasksDb(projectRoot: string): DatabaseSync {
  const file = getTasksDbFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(TASKS_SCHEMA_SQL);
  return db;
}

/** 影子同步的读数（★ 每个数字都要能对账，别只回 "ok"） */
export interface TasksSyncReport {
  /** 册上（`dsl.todos`）一共几张卡 */
  dsl_cards: number;
  /** 新写进库的 */
  added: number;
  /** 库里有、内容变了（state 或卡体）⇒ 更新 */
  updated: number;
  /** 库里有、册上没了 ⇒ 删（= 被移入历史或被人删掉，两种都算"不该再活在活卡表"） */
  removed: number;
  /** 册上还在、但**已在历史里** ⇒ **不复活**（单向门） */
  skipped_archived: number;
  /** 库文件绝对路径 */
  file: string;
}

/**
 * **影子同步**：把册上的卡（`dsl.todos[]`）投影进 `tasks.db#live_cards`。
 *
 * 判据（★ 幂等是硬要求：同一份册跑两次，第二次必须 `added=0 updated=0 removed=0`）：
 *   · 缺失的卡 ⇒ INSERT；`state` 或卡体变了 ⇒ UPDATE；
 *   · 册上没了 ⇒ DELETE（活卡表**只反射册的现状**，不存历史）；
 *   · 该 id **已在 `task_history`** ⇒ 不写回活卡表，只计 `skipped_archived`（单向门）。
 * ★ 一次事务：要么全成，要么库里一个字节没动。
 */
export function syncTasksFromDsl(
  projectRoot: string,
  feature: string,
  dsl: { todos?: ReadonlyArray<Record<string, unknown>> },
): TasksSyncReport {
  const todos = (dsl.todos ?? []).filter((t) => typeof t?.id === 'string' && t.id);
  const now = new Date().toISOString();
  const db = openTasksDb(projectRoot);
  const file = getTasksDbFile(projectRoot);
  const rep: TasksSyncReport = {
    dsl_cards: todos.length,
    added: 0,
    updated: 0,
    removed: 0,
    skipped_archived: 0,
    file,
  };
  try {
    const archived = new Set(
      (db.prepare('SELECT id FROM task_history WHERE feature = ?').all(feature) as Array<{ id: string }>).map((r) => r.id),
    );
    const existing = new Map(
      (db.prepare('SELECT id, state, card_json FROM live_cards WHERE feature = ?').all(feature) as Array<{
        id: string;
        state: string;
        card_json: string;
      }>).map((r) => [r.id, r]),
    );
    const dslIds = new Set(todos.map((t) => String(t.id)));
    db.exec('BEGIN IMMEDIATE');
    try {
      const ins = db.prepare(
        'INSERT INTO live_cards (id, feature, state, card_json, updated_at) VALUES (?, ?, ?, ?, ?)',
      );
      const upd = db.prepare('UPDATE live_cards SET state = ?, card_json = ?, updated_at = ? WHERE feature = ? AND id = ?');
      const del = db.prepare('DELETE FROM live_cards WHERE feature = ? AND id = ?');
      for (const t of todos) {
        const id = String(t.id);
        if (archived.has(id)) {
          rep.skipped_archived++;
          continue;
        }
        const state = typeof t.state === 'string' ? t.state : 'unknown';
        const cardJson = JSON.stringify(t);
        const hit = existing.get(id);
        if (!hit) {
          ins.run(id, feature, state, cardJson, now);
          rep.added++;
        } else if (hit.state !== state || hit.card_json !== cardJson) {
          upd.run(state, cardJson, now, feature, id);
          rep.updated++;
        }
      }
      for (const id of existing.keys()) {
        if (dslIds.has(id)) continue;
        del.run(feature, id);
        rep.removed++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.close();
  }
  return rep;
}

/** 活卡表的一行（读出口：`card` 已解析回来；坏了就是 null，不猜） */
export interface LiveCardHit {
  id: string;
  feature: string;
  state: string;
  card: Record<string, unknown> | null;
  updated_at: string;
}

/** 读某项目的活卡（`feature` 省略 = 全部；★ 纯读） */
export function listLiveCards(projectRoot: string, feature?: string): LiveCardHit[] {
  const db = openTasksDb(projectRoot);
  try {
    const rows = (
      feature
        ? db.prepare('SELECT id, feature, state, card_json, updated_at FROM live_cards WHERE feature = ? ORDER BY id').all(feature)
        : db.prepare('SELECT id, feature, state, card_json, updated_at FROM live_cards ORDER BY feature, id').all()
    ) as Array<{ id: string; feature: string; state: string; card_json: string; updated_at: string }>;
    return rows.map((r) => {
      let card: Record<string, unknown> | null = null;
      try {
        card = JSON.parse(r.card_json) as Record<string, unknown>;
      } catch {
        card = null;
      }
      return { id: r.id, feature: r.feature, state: r.state, card, updated_at: r.updated_at };
    });
  } finally {
    db.close();
  }
}

/** 对拍读数：册 vs 库（★ 影子期的验收尺 —— 两边的 id 集合与 state 必须逐条相等） */
export interface TasksParity {
  dsl_cards: number;
  db_live: number;
  db_history: number;
  /** 只在一侧出现的 id（带侧别），空 = 一致 */
  diff: string[];
}

export function parityTasks(
  projectRoot: string,
  feature: string,
  dsl: { todos?: ReadonlyArray<Record<string, unknown>> },
): TasksParity {
  const db = openTasksDb(projectRoot);
  try {
    const dslState = new Map<string, string>();
    for (const t of dsl.todos ?? []) {
      if (typeof t?.id === 'string' && t.id) dslState.set(t.id, typeof t.state === 'string' ? t.state : 'unknown');
    }
    const dbRows = db.prepare('SELECT id, state FROM live_cards WHERE feature = ?').all(feature) as Array<{
      id: string;
      state: string;
    }>;
    const dbState = new Map(dbRows.map((r) => [r.id, r.state]));
    const historyCount = Number(
      (db.prepare('SELECT COUNT(*) AS n FROM task_history WHERE feature = ?').get(feature) as { n?: number })?.n ?? 0,
    );
    const diff: string[] = [];
    for (const [id, st] of dslState) {
      if (!dbState.has(id)) diff.push(`${id}:册有库无`);
      else if (dbState.get(id) !== st) diff.push(`${id}:state 不一致（册 ${st} / 库 ${dbState.get(id)}）`);
    }
    for (const id of dbState.keys()) if (!dslState.has(id)) diff.push(`${id}:库有册无`);
    return { dsl_cards: dslState.size, db_live: dbState.size, db_history: historyCount, diff };
  } finally {
    db.close();
  }
}

/** history 库文件：`<dataHome>/.agent-io/task-history.db`（★ 与 `cache.db` 同一层，但**另一个文件**）
 *  ★ 2026-10-27：**这是 slice 1 的过渡态** —— 历史迟早并进 `<proj>/.agent-io/tasks.db`
 *    （见本文件头注的 slice 3）。在那之前这条路径仍然有效，别以为它已经是"目标形态"。 */
export function getTaskHistoryFile(): string {
  return path.join(getStorageRoot(), 'task-history.db');
}

/**
 * ★★★ 2026-10-26（T-#14 / 寄风选的第三条路）：历史的**文本镜像** `task-history.jsonl`。
 *
 * 为什么需要两份投影：`.db` 是二进制 —— 进 git 会在仓库里堆版本，且**不可 diff / 不可 review**；
 * 而 history 是 `derivable: false`（不可重建、要随仓移交）⇒ **必须有文本载体**。
 * ⇒ 判据：**工作库用 .db**（快、有索引、有主键），**移交载体用 .jsonl**（文本、可 diff）。
 *   两者是同一份事实的两个投影，**同一次写入产生**（见 recordTaskHistory 尾部）。
 * ⇒ gitignore：`.db` 由通用 `**\u002f.agent-io/*.db*` 规则忽略，`.jsonl` 进 git。
 */
export function getTaskHistoryJsonlFile(): string {
  return path.join(getStorageRoot(), 'task-history.jsonl');
}

/**
 * 把历史导出成 JSONL（一行一条，按 moved_at 排序 —— 纯文本、可 diff）。
 * ★ 失败**不影响主写**（只告警）：导出是镜像，主库才是权威。
 */
export function exportTaskHistoryJsonl(): { written: number; file: string } | null {
  try {
    const db = openTaskHistory();
    const rows = db.prepare('SELECT id, feature, node_id, state, summary, card_json, moved_at, reason FROM task_history ORDER BY moved_at, feature, id').all();
    db.close();
    const lines: string[] = [];
    for (const r of rows as Array<Record<string, unknown>>) lines.push(JSON.stringify(r));
    const file = getTaskHistoryJsonlFile();
    fs.writeFileSync(file, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
    return { written: lines.length, file };
  } catch (e) {
    process.stderr.write('[task_history] JSONL mirror export failed: ' + String(e) + '\n');
    return null;
  }
}

/** 建表语句（幂等；★ 表结构只在这一处） */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS task_history (
  id        TEXT NOT NULL,
  feature   TEXT NOT NULL,
  node_id   TEXT,
  state     TEXT NOT NULL,
  summary   TEXT NOT NULL,
  card_json TEXT NOT NULL,
  moved_at  TEXT NOT NULL,
  reason    TEXT NOT NULL,
  PRIMARY KEY (feature, id, moved_at)
);
CREATE INDEX IF NOT EXISTS idx_task_history_feature_state ON task_history(feature, state);
`;

/** 打开 history 库（不存在就建；**每次都新开、用完关** —— 这库很小，没有连接池的必要） */
export function openTaskHistory(): DatabaseSync {
  const file = getTaskHistoryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_SQL);
  return db;
}

/** 一条历史记录（写入口的入参 —— ★ 与表列同形，不另造一层 DTO） */
export interface TaskHistoryRow {
  /** 卡 id（todo 卡 = `todo_x`；节点卡 = 节点 id） */
  id: string;
  feature: string;
  node_id?: string;
  state: string;
  summary: string;
  /** 整张卡的原样 JSON（★ 写入口负责 `JSON.stringify`，本模块不解释它） */
  card_json: string;
  moved_at: string;
  reason: string;
}

/**
 * 把一批卡**写进历史表**（一个事务：要么全进，要么一条都不进）。
 *
 * ★ 调用方的顺序契约（`task_ops#moveTodoCardsToHistory` 遵守）：
 *   **先调本函数成功，再改 `todos[]`** —— 反过来会出现「册上没了、历史里也没有」的丢卡。
 *   本函数失败 ⇒ **抛**，调用方就此停手（`todos[]` 一个字节都没动）。
 *
 * @returns 实际写入的行数（= `rows.length`）
 */
export function recordTaskHistory(rows: readonly TaskHistoryRow[]): number {
  if (!rows.length) return 0;
  const db = openTaskHistory();
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = db.prepare(
        `INSERT INTO task_history (id, feature, node_id, state, summary, card_json, moved_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of rows) {
        stmt.run(r.id, r.feature, r.node_id ?? null, r.state, r.summary, r.card_json, r.moved_at, r.reason);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.close();
  }
  // ★ T-#14：主库写完立刻刷文本镜像（同一份事实的两个投影，同一次写入产生）
  exportTaskHistoryJsonl();
  return rows.length;
}

/**
 * **补偿删除**：按 `(feature, moved_at)` 精确撤掉刚写的一批。
 *
 * 为什么需要它：`recordTaskHistory` 成功之后，紧接着的「从 `todos[]` 移除 + 落盘」仍可能失败
 * （磁盘满 / 写闸拒 / 自洽性闸拒）。那一步失败时本批的行**必须撤掉** —— 否则下次重跑会
 * 写出第二份同样的行，而调用方会以为「库里只有一份」。
 *
 * ★ 只删**这一批**（`moved_at` 是本批的时间戳）：同 id 的**旧**历史一条都不碰。
 * @returns 实际删掉的行数
 */
export function dropTaskHistoryBatch(feature: string, movedAt: string): number {
  const db = openTaskHistory();
  try {
    const stmt = db.prepare('DELETE FROM task_history WHERE feature = ? AND moved_at = ?');
    const r = stmt.run(feature, movedAt);
    return Number(r.changes ?? 0);
  } finally {
    db.close();
  }
}

/** 一条历史记录（读出口 —— `card` 已从 `card_json` 解析回来） */
export interface TaskHistoryHit extends TaskHistoryRow {
  /** 解析后的整张卡（★ `card_json` 坏了就是 `null`：读端要能说"这一行读不出"，不猜） */
  card: Record<string, unknown> | null;
}

/** 查询过滤（★ 全部可选；缺省 = 本 feature 最近 20 条） */
export interface TaskHistoryQuery {
  feature: string;
  /** 只列这一种结局（history 里正常只有 done / void） */
  state?: string;
  /** 按卡 id 精确查（★ 不是模糊 —— 要模糊请用 `search`） */
  card_id?: string;
  /** 在 `summary` / `card_json` 里做**子串**匹配（`LIKE %s%`）—— 「要查的话就搜索 history」 */
  search?: string;
  /** 最多返回几条（默认 20，上限 500） */
  limit?: number;
}

/** 历史库的读端（★ 纯读：不建表以外不写任何东西） */
export function queryTaskHistory(q: TaskHistoryQuery): { total: number; rows: TaskHistoryHit[] } {
  const db = openTaskHistory();
  try {
    const where = ['feature = ?'];
    const args: Array<string | number> = [q.feature];
    if (q.state) {
      where.push('state = ?');
      args.push(q.state);
    }
    if (q.card_id) {
      where.push('id = ?');
      args.push(q.card_id);
    }
    if (q.search) {
      where.push('(summary LIKE ? OR card_json LIKE ?)');
      args.push(`%${q.search}%`, `%${q.search}%`);
    }
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM task_history WHERE ${where.join(' AND ')}`).get(...args) as { n?: number })?.n ?? 0,
    );
    const limit = Math.max(1, Math.min(500, Math.floor(q.limit ?? 20)));
    const raw = db
      .prepare(
        `SELECT id, feature, node_id, state, summary, card_json, moved_at, reason
         FROM task_history WHERE ${where.join(' AND ')}
         ORDER BY moved_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...args, limit) as Array<Record<string, unknown>>;

    const rows: TaskHistoryHit[] = raw.map((r) => {
      const cardJson = String(r.card_json ?? '');
      let card: Record<string, unknown> | null = null;
      try {
        card = JSON.parse(cardJson) as Record<string, unknown>;
      } catch {
        card = null;
      }
      return {
        id: String(r.id ?? ''),
        feature: String(r.feature ?? ''),
        ...(r.node_id ? { node_id: String(r.node_id) } : {}),
        state: String(r.state ?? ''),
        summary: String(r.summary ?? ''),
        card_json: cardJson,
        moved_at: String(r.moved_at ?? ''),
        reason: String(r.reason ?? ''),
        card,
      };
    });
    return { total, rows };
  } finally {
    db.close();
  }
}

/** 表里的行数（★ 判据 A/C 的读数口：`feature` 省略 = 全库） */
export function countTaskHistory(feature?: string): number {
  const db = openTaskHistory();
  try {
    const sql = feature
      ? 'SELECT COUNT(*) AS n FROM task_history WHERE feature = ?'
      : 'SELECT COUNT(*) AS n FROM task_history';
    const stmt = db.prepare(sql);
    const row = (feature ? stmt.get(feature) : stmt.get()) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } finally {
    db.close();
  }
}
