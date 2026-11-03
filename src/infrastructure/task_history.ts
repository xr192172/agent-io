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
// ★ slice 3：历史与活卡同库 ⇒ 按 feature 找项目根（注册表是唯一入口）
import { isReachableRoot, projectRootOf, readRegistryChecked } from './project_registry.js';

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

/**
 * `tasks.db` 的绝对路径：`<proj>/.agent-io/tasks.db`（★ 路径只问 `roots.ts#rootPath`）
 *
 * @authority 任务卡库（活卡 + 历史）住在哪个文件
 * @authority-note 一张卡、两张表同库：`live_cards` ∪ `task_history`；开库/建表只走本文件 `openTasksDb`
 */
export function getTasksDbFile(projectRoot: string): string {
  return rootPath('tasks', projectRoot);
}

/**
 * `plans` 上**后加的两列**（软消解标记）—— 声明只此一处。
 *
 * 不变量：`TASKS_SCHEMA_SQL`（新库建表）与 {@link migratePlansColumns}（老库 ALTER）**都**从这里取。
 * ★ 只加建表语句的后果是**静默失配**：`CREATE TABLE IF NOT EXISTS` 见表已存在就跳过，老库永远不长这两列，
 *   而建表语句读起来像"有" —— 加列时两边必须同时生效，所以列名只写一遍。
 * ★ 一律可空、无默认值：`ALTER TABLE … ADD COLUMN` 是纯元数据动作（不重写既有行），
 *   老行读出来是 `NULL` = **未消解**（正是要的默认语义，不需要 UPDATE 回填）。
 */
const PLANS_ADDED_COLUMNS = [
  ['dissolved_at', 'TEXT'],
  ['dissolve_reason', 'TEXT'],
] as const;

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
-- ★★★ 2026-11-02（subagent:canvas-db）：**重写计划（画布）** 与它服务的卡同库 ——
--   「同一份事实只许有一个住处」：盘上 .agent-io/plan/*.plan.json 与库两份必然打架。
--   ★ 主键必须**三键**：live_cards 是 (feature,id)，本仓实测两册有同名节点 ⇒ 只存 card_id 指不到卡。
--   ★ **不存 status**：卡的活/关由 live_cards 与 task_history 决定，这里再存一份就是第二处权威。
--   ★ card_id 是**软引用**（画布常先于 publish 存在 ⇒ 不建 FK，空串=未归属）。
CREATE TABLE IF NOT EXISTS plans (
  feature                TEXT NOT NULL,
  card_id                TEXT NOT NULL,
  file                   TEXT NOT NULL,
  entries_json           TEXT NOT NULL,
  untouched_json         TEXT,
  untouched_default_json TEXT,
  symbols_at_freeze_json TEXT,
  fps_json               TEXT,
  base_hash              TEXT,
  frozen_at              TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
${PLANS_ADDED_COLUMNS.map(([n, t]) => `  ${n.padEnd(22)} ${t},`).join('\n')}
  PRIMARY KEY (feature, card_id, file)
);
CREATE INDEX IF NOT EXISTS idx_plans_file ON plans(file);
`;

/**
 * ★★★ 2026-11-01（T-#REG ③）：**不可达的项目根不许建库** —— 建库前先过这一关。
 *
 * 不变量：`openTasksDb` 会 `mkdirSync(recursive)`；拿一个「登记了但盘上已经没有」的根喂它，
 * 它会在那个位置**重建整棵目录树**（实测：Temp 下的幽灵项目就是这样长出来的 ——
 * 注册表说 feature 在这，跑完一次总账那棵树就又出现了）。
 * ⇒ 根不可达时**抛**（响亮 > 静默造目录），并把「这不是没有库、是目录不在」与两条处置写清。
 */
export function assertProjectRootReachable(projectRoot: string): void {
  if (isReachableRoot(projectRoot)) return;
  throw new Error(
    `拒绝写入（建库 / 建目录树）：项目根不可达 —— ${projectRoot}\n` +
      '  ★ 这不是「这个项目还没有任务库」，而是「这个目录现在不在盘上」；在此处建库会在原地重建一棵幽灵目录树。\n' +
      '  ⇒ 处置（二选一）：\n' +
      '     ① 登记本身错了 ⇒ unregisterFeature(feature, reason)（带理由；落 projects.unregister.jsonl）\n' +
      '     ② 目录被挪走 / 盘没挂上 ⇒ 把目录找回来，或重新 import_project 登记正确的根',
  );
}

/**
 * 给**已有的** `plans` 表补齐 {@link PLANS_ADDED_COLUMNS}（幂等：每次按 `PRAGMA table_info` 现查缺哪列）。
 *
 * 不变量：
 * ① **幂等**：列已在 ⇒ 一句 SQL 都不发（同一份库跑 N 次，第二次 `added=[]`，行数与内容不变）；
 * ② **不碰既有行**：只 `ALTER TABLE … ADD COLUMN`（SQLite 的纯元数据动作，不重写行）——
 *    既有行一个字节不动、读出来是 `NULL`；
 * ③ 只在**写端**（`openTasksDb`）跑：读端是只读连接，改不动 schema。
 *
 * @returns 本次真正补上的列名（空数组 = 已经是最新形状）—— 调用方/回执可以据此说"发生了迁移"
 */
export function migratePlansColumns(db: DatabaseSync): string[] {
  const have = new Set(
    (db.prepare('PRAGMA table_info(plans)').all() as Array<{ name: string }>).map((c) => String(c.name)),
  );
  const added: string[] = [];
  for (const [name, type] of PLANS_ADDED_COLUMNS) {
    if (have.has(name)) continue;
    db.exec(`ALTER TABLE plans ADD COLUMN ${name} ${type}`);
    added.push(name);
  }
  return added;
}

/** 打开某项目的 `tasks.db`（不存在就建；用完关 —— 小库，不设连接池） */
export function openTasksDb(projectRoot: string): DatabaseSync {
  assertProjectRootReachable(projectRoot);
  const file = getTasksDbFile(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(TASKS_SCHEMA_SQL);
  // ★ 建表语句对**老库**是 no-op（`IF NOT EXISTS`）⇒ 后加列必须在此显式补（列名只声明一遍，见 PLANS_ADDED_COLUMNS）
  migratePlansColumns(db);
  return db;
}

/** 读端「为什么没有行」的三种情形（闭集） */
type HistoryReadSkip = 'no-registry' | 'unreachable' | 'no-db';

/** tasks.db 读端开不了库的三种原因（闭集；`no-table` 与 `no-db` 同义：库在但表还没建 = 真的没有行） */
type TasksReadSkip = 'unreachable' | 'no-db' | 'no-table';

/**
 * ★★★ 2026-11-02（第三轮外检 B）：**tasks.db 读端的开库入口 —— 唯一住处**。
 *
 * 不变量（两条，都能变红）：
 * ① **读端不建库、不建目录、不建表**：`openTasksDb`（写端）会 `mkdirSync(recursive)` + 跑
 *    `TASKS_SCHEMA_SQL`（CREATE TABLE / CREATE INDEX）⇒ 拿它当读端，**0 字节的 tasks.db 读一次就变成
 *    40960 字节**（实测）；根不可达时还会在原地重建一棵幽灵目录树。
 * ② **读不到 ≠ 没有行**：三种 skip 各给一句诊断（{@link tasksReadSkipLine}），调用方按 0 行计但**不静默**（0.12）。
 *
 * @param table 必需的表（`live_cards` / `task_history` / `plans`）—— 表名当参数，是为了让三张表共用**一套**
 *   开库口径，而不是每张表各写一遍 existsSync + readOnly + sqlite_master（那正是本函数收编的重复）。
 */
export function openTasksDbForRead(
  projectRoot: string,
  table: 'live_cards' | 'task_history' | 'plans',
): { db: DatabaseSync } | { skip: TasksReadSkip; file: string } {
  const file = getTasksDbFile(projectRoot);
  if (!isReachableRoot(projectRoot)) return { skip: 'unreachable', file };
  // ★ 只读：库文件不在 ⇒ 一行都没有（**不建空库** —— 建库是写端的动作）
  if (!fs.existsSync(file)) return { skip: 'no-db', file };
  const db = new DatabaseSync(file, { readOnly: true });
  const hit = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  if (!hit?.name) {
    db.close();
    return { skip: 'no-table', file };
  }
  return { db };
}

/** 读端「按 0 行计」的**唯一诊断口径**：`no-db` / `no-table` 不出声（那是真的没有行，不是读不到） */
function tasksReadSkipLine(scope: string, skip: TasksReadSkip | 'no-registry', where: string): void {
  if (skip === 'no-db' || skip === 'no-table') return;
  const why =
    skip === 'no-registry'
      ? '注册表里没有它的项目根（先 import_project 登记它）'
      : `登记的项目根不可达 —— ${where}（目录现在不在盘上）`;
  process.stderr.write(`[tasks] ${scope}：${why} ⇒ 按 0 行计（★ 这是「读不到」，不是「一行都没有」）\n`);
}

/**
 * ★★★ 2026-11-01（T-#REG ③）/ 2026-11-02（B）：**历史读端** —— 只多一步 `feature → 项目根`，
 * 开库判据全部委托 {@link openTasksDbForRead}（不再自己 existsSync + readOnly + sqlite_master；那是第二把尺）。
 *
 * 三种情形都不抛、不建库：
 * · `no-registry` —— 注册表里没有这个 feature 的项目根（先 import_project 登记它）；
 * · `unreachable` —— 登记了，但那个目录现在不在盘上；
 * · `no-db` —— 根可达，但 `<root>/.agent-io/tasks.db`（或 `task_history` 表）还没有 ⇒ 真的没有历史行。
 *
 * ★ 为什么读端与写端分开：写端（recordTaskHistory / dropTaskHistoryBatch）**不许静默丢历史**
 *   ⇒ 仍走严格抛的 `openTaskHistoryFor`；而读端是总账/查询，一个坏登记不该让整屏炸掉，
 *   但也**不许**把「读不到」混成「0 条」（0.12）⇒ 每支各给一句诊断（`tasksReadSkipLine`）。
 */
function openHistoryDbForRead(feature: string): { db: DatabaseSync } | { skip: HistoryReadSkip; root: string } {
  const root = projectRootOf(feature);
  if (!root) return { skip: 'no-registry', root: '' };
  const opened = openTasksDbForRead(root, 'task_history');
  if ('skip' in opened) return { skip: opened.skip === 'unreachable' ? 'unreachable' : 'no-db', root };
  return { db: opened.db };
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
  // ★ slice 2c：主库写完就刷文本载体（同一份事实的两个投影，同一次写入产生 —— 同 task-history.jsonl 的判据）
  exportTasksJsonl(projectRoot);
  return rep;
}

/**
 * ★★★ 2026-10-27（slice 2c）：**文本移交载体** `<proj>/.agent-io/tasks.jsonl`。
 *
 * 为什么要有它：`tasks.db` 是二进制（不可 diff / 不可 review），而卡是 `derivable:false` 的**意图数据**
 * ⇒ 按 T-#14 的判据：**工作库用 `.db`（不进 git），移交载体用 `.jsonl`（进 git）**。
 * 本文件是**投影**，不是第二份权威：`tasks.db` 才是权威。
 *
 * ★★★ 不变量（改前这里声称「删掉库下次同步就会重建」—— **那是错的**，与 `roots.ts:97` 的 `derivable: false` 相反）：
 * `tasks.db` 是 **derivable: false** —— slice 2c 之后册**不再写 `todos`**（`storage.ts` 的 `withoutTodos`），
 * 卡的唯一家就是库 ⇒ **删库 = 卡永久丢**（没有任何「下次同步」能把它重建回来）。
 * ⇒ 什么条件会坏：删 / 覆盖 `<proj>/.agent-io/tasks.db`（或把它当可重建缓存清理掉）⇒ 该 feature 的活卡与已了结卡
 *   一起消失；`.jsonl` 只是那一刻的投影、不会被自动回收。
 */
export function getTasksJsonlFile(projectRoot: string): string {
  return path.join(path.dirname(getTasksDbFile(projectRoot)), 'tasks.jsonl');
}

/** 把某项目的活卡导出成 JSONL（一行一张，按 feature+id 排序 ⇒ 可 diff）。失败只告警，不影响主写。 */
export function exportTasksJsonl(projectRoot: string): { written: number; file: string } | null {
  try {
    const file = getTasksJsonlFile(projectRoot);
    const lines = listLiveCards(projectRoot).map((r) =>
      JSON.stringify({ kind: 'live', feature: r.feature, id: r.id, state: r.state, card: r.card ?? null, updated_at: r.updated_at }),
    );
    // ★ slice 3：**历史也进同一条载体**（活卡 + 历史 = 同一个 tasks.db 的两张表）
    //   ★ 读端唯一入口（openTasksDbForRead，不建库）：库还没建 ⇒ **不写空镜像** —— 空 tasks.jsonl 与
    //     「本来就没卡」写出来一模一样，读端会把「读不到」当成「没有卡」（0.12）。
    {
      const opened = openTasksDbForRead(projectRoot, 'task_history');
      if ('skip' in opened) {
        tasksReadSkipLine('tasks.jsonl 镜像导出（历史）', opened.skip, opened.file);
        return null;
      }
      const db = opened.db;
      try {
        const hist = db
          .prepare('SELECT feature, id, node_id, state, summary, moved_at, reason FROM task_history ORDER BY feature, moved_at, id')
          .all() as Array<Record<string, unknown>>;
        for (const h of hist) lines.push(JSON.stringify({ kind: 'history', ...h }));
      } finally {
        db.close();
      }
    }
    fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
    return { written: lines.length, file };
  } catch (e) {
    process.stderr.write(`[tasks] JSONL 镜像导出失败（主库才是权威）：${String(e).slice(0, 160)}\n`);
    return null;
  }
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
  // ★ 读端唯一入口：0 字节库读一次**仍是 0 字节**（改前走 openTasksDb ⇒ CREATE TABLE/INDEX ⇒ 40960 字节）
  const opened = openTasksDbForRead(projectRoot, 'live_cards');
  if ('skip' in opened) {
    tasksReadSkipLine(`tasks.db（活卡${feature ? ` · ${feature}` : ''}）`, opened.skip, opened.file);
    return [];
  }
  const db = opened.db;
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
        // ★ 坏行不静默：卡体读不出来时给一行诊断（`card:null` 本身保留，调用方仍需能说"这一行读不出"）
        process.stderr.write(`[tasks] live_cards 行 "${r.id}" 的 card_json 解析失败 ⇒ card=null（不是「这张卡没内容」）\n`);
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
  const dslState = new Map<string, string>();
  for (const t of dsl.todos ?? []) {
    if (typeof t?.id === 'string' && t.id) dslState.set(t.id, typeof t.state === 'string' ? t.state : 'unknown');
  }
  // ★ 对拍是**读**，不是写 ⇒ 走读端唯一入口（未建库时不许在这里顺手把库建出来）
  const opened = openTasksDbForRead(projectRoot, 'live_cards');
  if ('skip' in opened) {
    tasksReadSkipLine(`tasks.db（对拍 · ${feature}）`, opened.skip, opened.file);
    return { dsl_cards: dslState.size, db_live: 0, db_history: 0, diff: [...dslState.keys()].map((id) => `${id}:册有库无`) };
  }
  const db = opened.db;
  try {
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
export function exportTaskHistoryJsonl(feature: string): { written: number; file: string } | null {
  try {
    const db = openTaskHistoryFor(feature);
    const rows = db.prepare('SELECT id, feature, node_id, state, summary, card_json, moved_at, reason FROM task_history WHERE feature = ? ORDER BY moved_at, id').all(feature);
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

/**
 * ★★★ 2026-10-27（乙方案 slice 3）：**历史与活卡同库** —— 打开 `feature` 所属项目的 `tasks.db`。
 *
 * 病史：历史原先住 `<数据仓>/task-history.db`（跨项目一个大库）。而乙方案是"每项目一库"，
 * 卡与它的历史天然属于同一个项目 ⇒ 拆成两处就会出现"这个 feature 的历史在哪个库"这种问题。
 * ⇒ 现在只有一条：`<proj>/.agent-io/tasks.db` 的 `task_history` 表（表结构在 `TASKS_SCHEMA_SQL` 里，
 *   与旧表**同列**，所以旧数据可以直接搬）。
 *
 * ★ 拿不到项目根（注册表没登记）⇒ **抛**，不猜、不落数据仓（"响亮是接上溯源的前提"）。
 */
function openTaskHistoryFor(feature: string): DatabaseSync {
  const root = projectRootOf(feature);
  if (!root) {
    throw new Error(
      `feature "${feature}" 没有项目根登记 ⇒ 历史无处安放（先 import_project 登记它，别落到数据仓）`,
    );
  }
  return openTasksDb(root);
}

/**
 * 历史库路径（回执/读数用）：`<proj>/.agent-io/tasks.db` —— 与活卡同库
 *
 * @authority 某 feature 的历史表落在哪个库
 * @authority-via get_dsl
 * @authority-note = `<proj>/.agent-io/tasks.db` 的 `task_history` 表；★ 别再说 `.agent-io/task-history.db`（旧路径，早已并进同一库、该文件不存在）
 */
export function taskHistoryDbPath(feature: string): string {
  const root = projectRootOf(feature);
  if (!root) return `（feature "${feature}" 没有项目根登记）`;
  return getTasksDbFile(root);
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
  // ★ slice 3：按 feature 分组写进**各项目自己的** tasks.db（一个 feature 一次事务）
  const byFeature = new Map<string, TaskHistoryRow[]>();
  for (const r of rows) {
    const arr = byFeature.get(r.feature) ?? [];
    arr.push(r);
    byFeature.set(r.feature, arr);
  }
  for (const [feature, group] of byFeature) {
    const db = openTaskHistoryFor(feature);
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        const stmt = db.prepare(
          `INSERT INTO task_history (id, feature, node_id, state, summary, card_json, moved_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of group) {
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
  }
  // ★ T-#14：主库写完立刻刷文本镜像（同一份事实的两个投影，同一次写入产生）
  // ★ slice 3：镜像统一成 `tasks.jsonl`（活卡 + 历史同一条载体），逐 feature 刷
  for (const feature of byFeature.keys()) {
    const root = projectRootOf(feature);
    if (root) exportTasksJsonl(root);
  }
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
  const db = openTaskHistoryFor(feature);
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

/** 历史库的读端（★ 纯读：不建表、不建库，也不把「读不到」混成 0 条） */
export function queryTaskHistory(q: TaskHistoryQuery): { total: number; rows: TaskHistoryHit[] } {
    const opened = openHistoryDbForRead(q.feature);
    if ('skip' in opened) {
      tasksReadSkipLine(`feature "${q.feature}" 的历史`, opened.skip, opened.root);
      return { total: 0, rows: [] };
    }
  const db = opened.db;
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

/**
 * 表里的行数。
 * @param feature 给了 ⇒ 只数这个 feature（在它**自己项目**的 tasks.db 里数）；
 *                不给 ⇒ 数**注册表里所有项目**的合计（★ 不再有"一个大库"可数）
 */
export function countTaskHistory(feature?: string): number {
  const countIn = (feat: string): number => {
    const opened = openHistoryDbForRead(feat);
    if ('skip' in opened) {
      tasksReadSkipLine(`feature "${feat}" 的历史计数`, opened.skip, opened.root);
      return 0;
    }
    const db = opened.db;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM task_history WHERE feature = ?').get(feat) as
        | { n?: number }
        | undefined;
      return Number(row?.n ?? 0);
    } finally {
      db.close();
    }
  };
  if (feature) return countIn(feature);
  // ★★★ 2026-11-01（T-#REG ③）：总账**先显式判可达，再决定建不建库** ——
  //   改前能不出事全靠 `readRegistry` 把不可达条目**剪掉**（读路径写盘）⇒ 现在只报不删，
  //   这里就必须自己判：suspect（不可达）的 feature 一条都不碰（诊断由 readRegistryChecked 那一行负责）。
  const { reg, suspects } = readRegistryChecked();
  const dead = new Set(suspects.map((s) => s.feature));
  let total = 0;
  for (const feat of Object.keys(reg.features)) {
    if (dead.has(feat)) continue;
    total += countIn(feat);
  }
  return total;
}
