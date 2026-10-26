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

/** history 库文件：`<dataHome>/.agent-io/task-history.db`（★ 与 `cache.db` 同一层，但**另一个文件**） */
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
