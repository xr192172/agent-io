/**
 * cache.db 打开与初始化
 *
 * 选型：node:sqlite（Node 22 内置 DatabaseSync）
 *   - 零新增依赖：agent-io 作为 npm 分发的 MCP server，
 *     不引入 better-sqlite3 这类原生编译模块（Windows 用户无构建工具即安装失败）
 *   - 实测（scripts 探针，2026-07-29）：SQLite 3.50.2，FTS5 + trigram + 触发器 + WAL 全可用
 *   - 代价：启动时 stderr 有一条 ExperimentalWarning（不影响 stdio JSON-RPC，可接受）
 *
 * 存储位置：<dataHome>/.agent-io/cache.db（.agent-io/ 已在 .gitignore）
 */

import { DATA_DIR_NAME } from '../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getStorageRoot } from '../storage.js';
// ★★★ 2026-10-26（T-#4 / 用户选 A）：索引路径走 `roots.ts` 的唯一解析器
import { rootsOf } from '../roots.js';
import { SCHEMA_SQL } from './schema.js';

// ★ 2026-10-04：从 `createRequire` 绕路**改回静态 import**。
//   原来绕的原因**只有一个**：vitest 1.x 自带的 Vite 5 内建模块清单不认识 `node:sqlite`
//   （Node 22.5 才加入），会把 `node:` 前缀剥掉当文件路径解析 ⇒ 只能靠 createRequire
//   躲开静态分析。框架全删掉后 Vite 不复存在 ⇒ **这个绕路连同它的理由一起消失**。
//   （依赖 Node 22.5+，见 package.json 的 `engines`。）

/** 统一 re-export，调用方从本模块取类型 */
export type Database = DatabaseSync;

// ─────────────────────────────────────────────────────────────
// 批量事务（嵌套安全）
//
// 为什么需要：`syncFile` 内部自带 BEGIN/COMMIT（单文件原子），对"逐个文件增量"是对的；
// 但**冷启 bootstrap 要写几百个文件** ⇒ 几百次 COMMIT（每次都 fsync）——实测占冷启动 88% 的时间
// （解析只占 17.8ms/文件；296 文件冷启 44.9s，其中解析≈5.3s）。
// 这里给"批量写"提供一个外层事务：外层开了，内层的 BEGIN/COMMIT 自动降级为 no-op。
// 用 WeakMap 记深度，避免动 DatabaseSync 内部状态。
// ─────────────────────────────────────────────────────────────

const txDepth = new WeakMap<object, number>();

/** 当前是否已在批量事务里（供 syncFile 判断"要不要自己开事务"） */
export function inTransaction(db: Database): boolean {
  return (txDepth.get(db as unknown as object) ?? 0) > 0;
}

/**
 * 开一层批量事务（最外层真正 BEGIN，嵌套只加深度）
 *
 * ★★★ 2026-10-23：**必须 `BEGIN IMMEDIATE`，不许裸 `BEGIN`** —— 这治的是
 *   `busy_timeout = 5000` **治不了**的那一半。
 *
 * ## 病灶（实测 2026-10-23 21:30）
 * `syncProject` 在 `resolveCrossFileCalls` 处抛 `database is locked`（errcode=5），
 * **而 `openDb` 明明设了 `PRAGMA busy_timeout = 5000`**。为什么它没生效？
 *
 * ## 原因：SQLite 的 **deferred 事务「锁升级」不可重试**
 * 裸 `BEGIN` = DEFERRED：开始时**只拿读锁**，第一次写才尝试升级成写锁。
 * 若此刻另一个连接（本仓的 MCP server 常驻，PID 21040）已持有写锁 ⇒ SQLite **立即**返回
 * SQLITE_BUSY，**并且故意不按 busy_timeout 等待** —— 因为等待会让两个"持读锁、都想升级"的
 * 连接互相死锁。
 * ⇒ `busy_timeout` 只治"**一开始就拿锁**"的争用，**治不了"半路升级"**。
 *
 * ## 修法
 * `BEGIN IMMEDIATE` 在**事务开始**就取 RESERVED（写意图）锁：拿不到时**尚未持有任何锁**
 * ⇒ 此时按 `busy_timeout` 排队等待**是安全的**。争用于是从"立刻失败"变成"排队最多 5s"。
 *
 * ## 判据
 * `grep -rn "exec('BEGIN')" src` 必须为 **0**；只许 `exec('BEGIN IMMEDIATE')`。
 * ★ 全仓 7 处已改（`db.ts` ×2 / `symbols.ts` ×4 / `semantic_search.ts` ×1）；
 *   `task_history.ts:98` 早在 2026-10-22 就已是 IMMEDIATE —— 这条经验一直没推广到索引层。
 */
export function beginBatch(db: Database): void {
  const key = db as unknown as object;
  const d = txDepth.get(key) ?? 0;
  if (d === 0) db.exec('BEGIN IMMEDIATE');
  txDepth.set(key, d + 1);
}

/** 收一层批量事务；`rollback=true` 时最外层整批回滚 */
export function endBatch(db: Database, rollback = false): void {
  const key = db as unknown as object;
  const d = txDepth.get(key) ?? 0;
  if (d <= 1) {
    if (d === 1) db.exec(rollback ? 'ROLLBACK' : 'COMMIT');
    txDepth.set(key, 0);
    return;
  }
  txDepth.set(key, d - 1);
}

export const SCHEMA_VERSION = 17; // v17：unresolved_refs.resolved_node_id（解析到的节点 id；ALTER 补列 + 已解析引用重开为 pending 重解析） // v16：file_path → files.id 外键（identifiers/imports/unresolved_refs/symbol_diffs；nodes 保留 file_path）—— 保留式迁移，行数即证据（见 migrateV15ToV16） // v15：nodes.body_text / body_hash（函数体原文 + sha1） // v14：nodes.return_type / type_params / modifiers（返回类型 / 泛型 / 修饰符）—— 旧库无此列，清库重解析 // v13：nodes.params（函数/方法形参 JSON）—— 旧库无此列，清库重解析 // v12：imports.start_index/end_index（整句 span）—— 旧库无此列，清库重解析 // v11：identifiers 表（标识符位置）—— 旧库无此表，清库重解析 // ★ v10：nodes.members（类型成员）—— 旧库无此列语义，清库重解析

/** 默认 db 文件路径：<dataHome>/.agent-io/cache.db */
export function getDbFile(): string {
  return path.join(getStorageRoot(), 'cache.db');
}

// ─────────────────────────────────────────────────────────────
// cache.db 的**定位** —— ★ 唯一权威：别处不许再自己拼这个路径
//
// 2026-10-01（T19 收口）。起因是「**同一个抽象被两处各用一份**」这个缺陷：
// 以后要改抽象时会不会有维护性问题（一个用老头像、一个用新头像）？
// —— 实测答案：这里**已经发生了**。收口前"怎么找到 cache.db"在 src/ 里散成
// **20 处 / 4 种语义**，而且：
//   · `projectCacheDbPath(root)` 这个名字**长了两遍**（本文件内联一份 + `write_gate` 一份）；
//   · 「候选优先级搜索」**三份**（`function_outline` / `overview` / `derive_mind_map`），
//     其中一份的注释自己写着"与 overview/feature_tree 同一套候选逻辑"——作者知道重复，
//     但没单点化 ⇒ 下次改候选顺序要记住改三处，漏一处就是**口径分叉**；
//   · 「向上逐级找」**两份**（`derive_anim_flow` / `derive_chain`，逐字相同）。
//
// ★ 为什么维护性会坏：**改抽象的代价 = 副本数 × 每次还要现判"它算哪个变体"**。
//   副本越多，"这次改动到底要不要动它"就越是每次都要重新拍一次脑袋 —— 这就是"老头像/新头像"。
// ★ 解法**不是**把变体合并成一个"什么都能干"的大函数（那是取并集，会悄悄**扩大**某些调用方的
//   搜索面，见重构纪律 §2b），而是**把变体登记成具名函数**：**名字即语义** ⇒
//   日后改抽象只需看这 4 个名字，不必再逐个调用点去判断归属。
//   差异是**有意保留**的，但从此**可见**（各自注释写明"为什么它与另一个不同"）。
//
//   ① projectCacheDbPath(root)              已知根 ⇒ 算路径（不问存在）
//   ② findCacheDb({ sourceRoot })           候选：挑第一个**存在**的（只剩项目索引）
//   ③ nearestCacheDb(dir)                   向上逐级：找最近的**存在**的
//
// ★ 2026-10-26（T-#8）：原来还有一个“按 feature 的跨项目索引”（候选②），已删 ——
//   实测三工作区全盘扫 0 产物，且 HTTP 面是可视化预留、没人用。
//   ⇒ 现在只剩**一种作用域**：项目索引。
//
// ★ ① 是**纯字符串**（不查盘），好让调用方能在**真正开库之前**先 `existsSync` 预检 ——
//   否则 `getProjectCacheDb` 会在无索引的项目里造出一个空 cache.db（Windows 上还持有 EBUSY 锁，
//   让临时目录测试的 rmSync 失败；`infrastructure/analysis/project_root/index.ts` 里记着这笔账）。
// ─────────────────────────────────────────────────────────────

/** ① 已知项目根 ⇒ 该项目的符号缓存文件路径。**不查存在**。★ 路径由 `roots.ts` 唯一解析（T-#4）。 */
export function projectCacheDbPath(root: string): string {
  // ★★★ 2026-10-26（T-#4 / 用户选 A：索引归**项目本地**）：路径由 `roots.ts#rootsOf(root).cache.path` 算。
  //   此前这里自己拼 `path.join(root, DATA_DIR_NAME, 'cache.db')`，与
  //   `featureCacheDbPath`（dataHome/import_cache_<feature>.db）、`getDbFile`（dataHome/cache.db）
  //   构成**三套索引寻址** ⇒ 实测同一台机器上出现 4 个互不知道的索引根。
  //   ★ 本轮**只换寻址、不改实际路径**（仍是 `<root>/.agent-io/cache.db`）⇒ 零行为变更。
  return rootsOf(root).cache.path;
}

// ★ 2026-10-26（T-#8）：**`featureCacheDbPath` 已删**。
//   它是“按 feature 寻址的跨项目索引”（`<dataHome>/.agent-io/import_cache_<feature>.db`）。
//   删的依据是**取证而不是口味**：三个工作区全盘扫 `import_cache_*.db` ⇒ **0 个**（从未产生过任何产物）；
//   且寄风确认 HTTP 面（它唯一的消费者）是**可视化预留、没人用**。
//   ⇒ 乙方案下每个项目有自己的索引，不存在“跨项目的按 feature 索引”这个角色。
//   ★ 若将来要恢复“上传模式跨次复用”，正确做法是给项目注册表加 feature→cache 映射，
//     而不是在数据仓里再长一个平行索引（那正是“同一事实两处”的病）。

/**
 * ③ 候选优先级：`import_cache_<feature>.db`(dataHome) > `<sourceRoot>/.agent-io/cache.db`，
 * 取**第一个存在的**；一个都不存在 ⇒ `null`。
 *
 * ★ 为什么这个顺序必须单点：两级候选是**两个不同的锚**——dataHome = 本进程的导入缓存、
 *   sourceRoot = 被分析的项目。顺序一改，**所有读入口**的命中目标一起变。
 * ★ 一个候选都没有 ⇒ 返回 null，**不降级**成"用最后一个"（调用方自己决定怎么办）。
 *
 * ★★ 2026-10-01 **删掉了原来的第三级候选 `<cwd>/.agent-io/cache.db`**（用户一句「越兜越多」逼出来的）。
 *   为什么删：`cwd` 与被分析项目**没有任何关系** —— 它不是"更弱的答案"，是**另一个项目的答案**。
 *   把它当兜底 ⇒ 一个没有自己索引的项目会**静默读到 cwd 那个项目的数据**。
 *   ★ 而且兜底会**自我繁殖**：因为"反正总有一个能用"，就没人去保证**正确的那个**存在。
 *   ⇒ 现在**两级就是两级**，都没有就响亮地返回 null（"响亮是接上溯源的前提"，
 *     见 `storage.ts#requireProjectRoot` 的注释）。
 */
export function findCacheDb(opts: { feature?: string; sourceRoot?: string } = {}): string | null {
  const { sourceRoot } = opts;
  // ★★ 2026-10-26（T-#8）：候选从**两级降为一级** —— 只剩项目索引。
  //   原先候选①是 `import_cache_<feature>.db`（dataHome），实测**从未产生过任何产物**（三工作区全盘扫 = 0 个），已删。
  //   `feature` 入参保留只为不改调用方签名 —— **它不再参与寻址**（“按册找索引”在乙方案下不存在）。
  const candidates = [sourceRoot ? projectCacheDbPath(sourceRoot) : ''];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

/**
 * ④ 从 `dir` 起**向上逐级**找最近的 `<dir>/.agent-io/cache.db`；到盘根仍没有 ⇒ `null`。
 *
 * ★ 与 ③ 语义**不同，有意不合并**：③ 手里有 feature/source_root 这类**已知锚**；
 *   ④ 只有一个**子目录**（源文件所在目录常是项目根的子目录，如 `src/`），只能向上找。
 *   若把 ④ 折进 ③，就得让 ③ 接受"任意目录"当锚 —— 那会**扩大** ③ 的搜索面（取并集的典型坏处）。
 */
export function nearestCacheDb(dir: string): string | null {
  for (let d = path.resolve(dir); d && d !== path.dirname(d); d = path.dirname(d)) {
    const cand = path.join(d, DATA_DIR_NAME, 'cache.db');
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}


// ─────────────────────────────────────────────────────────────
// v16 迁移（file_path → files.id 外键）
//
// ★ 为什么**不**逐表写死一份 DDL：迁移只做「形状换轨」，表结构仍由 SCHEMA_SQL 一处定义。
//   做法 = 旧表改名腾出名字 → 跑 SCHEMA_SQL 建出 v16 新表/新索引/视图 → INSERT ... SELECT 回填 → 丢旧表。
//   这样 SCHEMA_SQL 改一列，迁移自动跟上，不会出现「迁移里那份 DDL 与 schema.ts 漂移」。
//   ★ 唯一的耦合点：旧索引名必须显式 DROP —— 索引跟着表改名走，名字还占着时
//     SCHEMA_SQL 的 CREATE INDEX IF NOT EXISTS 会跳过，新表就没有索引了。
// ─────────────────────────────────────────────────────────────

function tableExists(db: Database, name: string): boolean {
  return db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = $n").get({ n: name }) !== undefined;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/** 已应用的最高 schema 版本；null = 没有 schema_versions 表（更旧的库 / 全新库）。 */
function readSchemaVersion(db: Database): number | null {
  if (!tableExists(db, 'schema_versions')) return null;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_versions').get() as { v: number | null } | undefined;
  return row?.v ?? null;
}

/** v16 迁移会动的 5 张表（顺序 = 改名/删除顺序：先子后父） */
const V16_TABLES = ['identifiers', 'imports', 'unresolved_refs', 'symbol_diffs', 'files'] as const;

/** 这 5 张表上 v15 的索引名（索引跟随表改名 ⇒ 必须显式删，否则新表建不出同名索引） */
const V16_INDEXES = [
  'idx_identifiers_name',
  'idx_imports_file',
  'idx_unresolved_from_node',
  'idx_unresolved_name',
  'idx_unresolved_status',
  'idx_unresolved_failed_tail',
  'idx_files_language',
  'idx_files_modified_at',
] as const;

/**
 * v15 → v16 的**保留式**迁移：files 加整数主键，identifiers/imports/unresolved_refs/symbol_diffs
 * 的 file_path 换成 file_id。返回一句话回执（写进 schema_versions.description 当证据）。
 *
 * ★ 行数就是正确性证据：回填走 `JOIN files ON f.path = i.file_path`，
 *   **对不上 files 的行会被丢掉**——这是有意的：那些行的「文件」在 files 里根本不存在，
 *   挂外键只能二选一（丢行 / 伪造 files 行），而伪造会让 files 不再等于「被索引过的文件」。
 *   实测本库丢了 201 条 identifiers：scripts/check_lang_pkgs.mjs 157 行、
 *   src/infrastructure/analysis/diagnosis/test_contract.ts 44 行 —— 根因是旧 removeFileRel
 *   没删 identifiers（它当时没有 FK，删了 files 行也带不走），v16 起由 ON DELETE CASCADE 兜住。
 */
function migrateV15ToV16(db: Database): string {
  const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  const before = {
    identifiers: count('identifiers'),
    imports: count('imports'),
    unresolved_refs: count('unresolved_refs'),
    symbol_diffs: count('symbol_diffs'),
  };
  // 先记下「哪些文件不在 files 里」（回填会丢它们）—— 回执里唯一需要点名的那种行
  const orphans = db
    .prepare(
      // ★ 用 NOT EXISTS 而不是 LEFT JOIN ... f.id IS NULL：**此刻 files 还没有 id 列**
      //   （重建 files 是下一步的事）—— 这条查询跑在 BEGIN 之前，跟的是 v15 的形状。
      `SELECT i.file_path AS p, COUNT(*) AS c FROM identifiers i
       WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.path = i.file_path)
       GROUP BY i.file_path ORDER BY c DESC`,
    )
    .all() as unknown as Array<{ p: string; c: number }>;
  const orphanRows = orphans.reduce((n, o) => n + o.c, 0);

  db.exec('BEGIN IMMEDIATE');
  try {
    // ① 腾名字（先子后父：files 是父）
    for (const t of V16_TABLES) db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v15`);
    // ② 旧索引跟着表走了、名字还占着 ⇒ 显式删（见文件头注释的最后一句）
    for (const ix of V16_INDEXES) db.exec(`DROP INDEX IF EXISTS ${ix}`);
    // ③ 建 v16 形状（表 + 索引 + 视图都由 SCHEMA_SQL 一处定义）
    db.exec(SCHEMA_SQL);
    // ④ 回填
    db.exec(`INSERT INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash)
             SELECT path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash
             FROM files_v15 ORDER BY path`);
    db.exec(`INSERT INTO identifiers(file_id, name, kind, line, col, start_index, end_index)
             SELECT f.id, i.name, i.kind, i.line, i.col, i.start_index, i.end_index
             FROM identifiers_v15 i JOIN files f ON f.path = i.file_path`);
    db.exec(`INSERT INTO imports(file_id, line, source, kind, type_only, bindings, start_index, end_index)
             SELECT f.id, i.line, i.source, i.kind, i.type_only, i.bindings, i.start_index, i.end_index
             FROM imports_v15 i JOIN files f ON f.path = i.file_path`);
    db.exec(`INSERT INTO unresolved_refs(id, from_node_id, reference_name, reference_kind, line, col, candidates, file_id, language, status, name_tail)
             SELECT u.id, u.from_node_id, u.reference_name, u.reference_kind, u.line, u.col, u.candidates, f.id, u.language, u.status, u.name_tail
             FROM unresolved_refs_v15 u JOIN files f ON f.path = u.file_path`);
    db.exec(`INSERT INTO symbol_diffs(file_id, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at)
             SELECT f.id, s.from_hash, s.to_hash, s.added, s.removed, s.changed, s.norm_from, s.norm_to, s.updated_at
             FROM symbol_diffs_v15 s JOIN files f ON f.path = s.file_path`);
    // ⑤ 丢旧表（子先父后）
    for (const t of V16_TABLES) db.exec(`DROP TABLE ${t}_v15`);
    // ⑥ 外键校验：有任何孤儿 ⇒ 整笔回滚，绝不落半套
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length > 0) throw new Error(`v16 迁移后 foreign_key_check 有 ${bad.length} 行孤儿，已回滚`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const after = {
    identifiers: count('identifiers'),
    imports: count('imports'),
    unresolved_refs: count('unresolved_refs'),
    symbol_diffs: count('symbol_diffs'),
  };
  const named = orphans
    .slice(0, 3)
    .map((o) => `${o.p} ${o.c} 行`)
    .join(' / ');
  return (
    `；迁移行数 identifiers ${before.identifiers}→${after.identifiers}` +
    (orphanRows > 0 ? `（丢弃 ${orphanRows} 条孤儿行：${named}；根因旧 removeFileRel 未删 identifiers）` : '') +
    `，imports ${before.imports}→${after.imports}，unresolved_refs ${before.unresolved_refs}→${after.unresolved_refs}，` +
    `symbol_diffs ${before.symbol_diffs}→${after.symbol_diffs}；foreign_key_check 0 行`
  );
}

/**
 * 打开库时的形状对齐。返回写进 schema_versions.description 的回执（空串 = 没迁移）。
 *
 * ★ 判据是**形状**（files 有没有 id），不是版本号：上次迁移若在 COMMIT 前崩了，
 *   事务已回滚 ⇒ 形状仍是 v15、版本仍是 15，下次打开会重跑（幂等）。
 * ★ 全新库（连 files 表都没有）⇒ 什么都不做，SCHEMA_SQL 直接建 v16。
 */
function migrateCacheIfNeeded(db: Database): string {
  if (!tableExists(db, 'files')) return '';
  // ★★★ v16 → v17（2026-10-26）：**只补一列**，不清库。
  //   为什么要补：解析成功时把"解析到哪个节点"丢了（symbols.ts 只写 status='resolved'）⇒
  //   陈旧断言判据只能靠名字反推 ⇒ 成员调用（`ps.reject`）100% 假阳性。
  //   ★ 补列后旧行的 `resolved_node_id` 是 NULL，而 NULL 本身不是"陈旧"的证据 ⇒
  //     必须把已解析的引用**重开为 pending**，让下一次解析把 id 真正落进去（否则这一列永远空着，
  //     判据退化成"所有 resolved 都陈旧"）。
  let v17 = '';
  if (hasColumn(db, 'files', 'id') && !hasColumn(db, 'unresolved_refs', 'resolved_node_id')) {
    db.exec('ALTER TABLE unresolved_refs ADD COLUMN resolved_node_id TEXT');
    db.exec("UPDATE unresolved_refs SET status = 'pending', resolved_node_id = NULL WHERE status = 'resolved'");
    v17 = '；v16→v17 补 unresolved_refs.resolved_node_id（已解析引用重开为 pending，待重解析落 id）';
  }
  if (hasColumn(db, 'files', 'id')) return v17;
  const prev = readSchemaVersion(db);
  if (prev !== null && prev >= 15) return v17 + migrateV15ToV16(db);
  // v15 之前的库：**不搬迁**（沿用「缓存是派生物」的老策略），只把形状换成 v16。
  // 顺序：先子后父；nodes_fts 是 external-content 虚表，跟着 nodes 一起拆（否则重建后索引残留）。
  for (const t of ['edges', 'unresolved_refs', 'identifiers', 'imports', 'symbol_diffs', 'nodes_fts', 'nodes', 'files']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  return `；v${prev ?? '?'}→v16 旧库不搬迁（缓存是派生物），已清空重建`;
}

/**
 * 打开（必要时创建）cache.db 并应用 schema。
 * schema 全部 IF NOT EXISTS，重复打开幂等。
 *
 * 迁移策略（v16 起分两档，**判据是库的实际形状，不是版本号**）：
 *   - **v15 → v16：保留式迁移**（旧表改名 → SCHEMA_SQL 建新表 → 回填 → 丢旧表），
 *     因为这一版只是把 file_path 换成 file_id，**事实一条没变**，丢掉重解析纯属浪费。
 *     正确性证据 = 行数：identifiers 316,446 → 316,245（差的 201 条是 files 里根本没有的路径，
 *     见 migrateV15ToV16 的说明），imports / unresolved_refs / symbol_diffs 逐表相等；
 *     收尾必跑 PRAGMA foreign_key_check（有孤儿就整笔回滚，不写半套）。
 *   - **更旧的库：仍清空重建**（缓存是派生物）。v1→v2 加 imports 表时留下的教训：
 *     旧 files 行没有原始 import 数据，留着会让 import_project 缓存路径静默丢包导入依赖边。
 */
/**
 * ★ 2026-10-26（T-#4b）：**无主键兜底已退场**。
 * 原先 `openDb(dbFile: string = getDbFile())` 的默认值 = `<dataHome>/.agent-io/cache.db`
 * —— 那是"没有项目根也没有 feature 时随便找一个库"，正是用户那句「**越兜越多**」的活标本
 * （兜底会自我繁殖：因为"反正总有一个能用"，就没人去保证**正确的那个**存在）。
 * ⇒ 现在默认值是一个**必抛**：宁可响亮失败，不要静默读错库。
 */
function requireDbFile(): never {
  throw new Error(
    'openDb 必须显式给 dbFile（无主键兜底已退场）：\n' +
      '  · 项目索引 ⇒ rootsOf(projectRoot).cache.path\n' +
      '  · （没有第二种索引作用域：按 feature 的跨项目索引已于 2026-10-26 删除）',
  );
}

export function openDb(dbFile: string = requireDbFile()): Database {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  /**
   * ★★★ 2026-10-22：**等锁，别立刻抛** —— `database is locked` 的实测病灶
   *
   * 现场：本仓的 MCP server（`dist/src/presentation/mcp/server.js`）常驻，一直持有 `cache.db`；
   * 而 `npm run verify` 的「实现夹具」也要开库 ⇒ 两个写者撞上 ⇒ `ERR_SQLITE_ERROR errcode=5`。
   * ★ 后果不是"某次失败"，是**门会随机红** ⇒ 人会学会"重跑一次看" ⇒ 再往后 **FAIL 变成噪音**，
   *   真 FAIL 也被忽略（这比假绿更坏：假绿能被"注入⇒必须红"抓出来，噪音不能）。
   *
   * 判据：`busy_timeout` 是 SQLite 原生的"等锁"机制 —— 把"瞬时争用"变成"排队"。
   * ★ 它**只治瞬时争用**：如果锁被长事务占住，5 秒后照样抛（那时才是真问题，该找长事务）。
   * ★ 为什么 5000ms：verify 里最长的一道门约 200ms（实测），5s 是 25 倍余量，不会掩盖真卡死。
   */
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  // ★ v16：**先对齐形状再跑 SCHEMA_SQL** —— 旧库的 identifiers 还没有 file_id 列，
  //   而 SCHEMA_SQL 里有 CREATE INDEX ... ON identifiers(name, file_id) ⇒ 会直接 no such column。
  const migrationNote = migrateCacheIfNeeded(db);
  db.exec(SCHEMA_SQL);
  // v3 增列：旧库的 nodes 表已存在，CREATE TABLE IF NOT EXISTS 不会补 sym_hash 列，
  // 显式 ALTER（新库建表已含该列，重复加列报错吞掉）
  try {
    db.exec('ALTER TABLE nodes ADD COLUMN sym_hash TEXT');
  } catch {
    /* 列已存在 */
  }
  // v4 增列：files.norm_hash + symbol_diffs.norm_from/norm_to（文件级归一化全文 hash，
  // 捕捉符号提取覆盖不到的变更——常量值/字符串/顶层表达式）
  // v5 增列：imports.type_only（TS `import type` 运行时擦除——依赖图/闭包不算边）
  // v8 增列：nodes.is_closure（局部闭包/辅助函数标记——不进 DSL 契约面；旧库此列缺失，
  //   注释符号误进契约面导致 diff 冲突假阳性）
  for (const ddl of [
    'ALTER TABLE files ADD COLUMN norm_hash TEXT',
    "ALTER TABLE symbol_diffs ADD COLUMN norm_from TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE symbol_diffs ADD COLUMN norm_to TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE imports ADD COLUMN type_only INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE nodes ADD COLUMN is_closure INTEGER NOT NULL DEFAULT 0',
    // ★ v10：nodes.members（类型成员 JSON）—— type/interface 的 signature 只有 `Name()`，
    //   定义本身此前无处可落（gen_design_db 拷过去也是 `Name()`）
    'ALTER TABLE nodes ADD COLUMN members TEXT',
    // ★ v9：imports.bindings（该 import 绑定的本地名）—— 让跨文件引用能判 external
    'ALTER TABLE imports ADD COLUMN bindings TEXT',
    // ★ v12：imports 整句 span（删整句用）
    'ALTER TABLE imports ADD COLUMN start_index INTEGER',
    'ALTER TABLE imports ADD COLUMN end_index INTEGER',
    // ★ v13：nodes.params（函数/方法形参 JSON）—— signature 只有一根字符串，
    //   消费方各拆一次 ⇒ 假差异（T154）；结构化事实落库后只除一处。
    'ALTER TABLE nodes ADD COLUMN params TEXT',
    // ★ v14：nodes.return_type / type_params / modifiers（返回类型 / 泛型 / 修饰符）——
    //   与 params 同一条病根（signature 一根串），旧库此三列缺失，清库重解析。
    //   ★ '[]' = 抽到了确实没有；NULL = 没抽到（判据见 schema.ts 的列注释）。
    'ALTER TABLE nodes ADD COLUMN return_type TEXT',
    'ALTER TABLE nodes ADD COLUMN type_params TEXT',
    'ALTER TABLE nodes ADD COLUMN modifiers TEXT',
    // ★ v15：nodes.body_text / body_hash（函数体原文 + 它的 sha1）——
    //   v14 之后 DB 知道「函数长什么样」但不知道「它做了什么」⇒ 重写必须开源文件。
    //   ★ NULL = 该节点没有体（或该语言的体不是单一节点）；**空串是禁用的**（见 schema.ts 列注释）。
    //   ★ 两列与 files.content_hash 同一代快照，读 body 前必须过"库内自洽 + 库与源码同源"两道。
    'ALTER TABLE nodes ADD COLUMN body_text TEXT',
    'ALTER TABLE nodes ADD COLUMN body_hash TEXT',
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* 列已存在 */
    }
  }
  db.prepare(
    'INSERT OR IGNORE INTO schema_versions(version, applied_at, description) VALUES (?, ?, ?)',
  ).run(
    SCHEMA_VERSION,
    Date.now(),
    // ★ 这一行就是**迁移证据**：哪几张表、每张表前后多少行、丢了几条孤儿行（并点名到文件）。
    //   查法：SELECT description FROM schema_versions WHERE version = 16;
    `v16: file_path → files.id 外键（identifiers/imports/unresolved_refs/symbol_diffs；nodes 保留 file_path）${migrationNote}`,
  );
  // ★ v16：迁移把 31.6 万行的长路径换成整数，**腾出的页只进 freelist、不还给磁盘**
  //   ⇒ 实测 80.56 MB 的库迁移后仍是 80.56 MB，直到 VACUUM 才变成 53.13 MB。
  //   条件：只在真迁移过、且空闲页够多（>1000 页 ≈ 4 MB）时做一次；VACUUM 失败不影响正确性
  //   （磁盘不够 / 有并发读者），下一轮打开会重试。
  if (migrationNote) {
    try {
      const free = (db.prepare('PRAGMA freelist_count').get() as { freelist_count: number }).freelist_count;
      if (free > 1000) db.exec('VACUUM');
    } catch {
      /* 腾不出空间不算错：库本身已经是一致的 */
    }
  }
  return db;
}

// ─────────────────────────────────────────────────────────────
// 项目级缓存连接池（MCP 长进程内跨工具调用复用）
// ─────────────────────────────────────────────────────────────

const projectCachePool = new Map<string, Database>();

/**
 * 打开（并复用）目标项目的符号缓存：<projectRoot>/.agent-io/cache.db
 * 缓存跟着被分析的项目走（内容是该项目源文件的派生物，相对路径键才不撞车），
 * 与 getDbFile() 的数据主目录缓存是两个独立用途。
 * 失败（只读目录 / 无写权限）会抛错——调用方应 catch 后按无缓存退化。
 * 进程退出无需显式 close：WAL 模式崩溃安全。
 */
export function getProjectCacheDb(projectRoot: string): Database {
  const key = path.resolve(projectRoot);
  let db = projectCachePool.get(key);
  if (!db) {
    db = openDb(projectCacheDbPath(key));
    projectCachePool.set(key, db);
  }
  return db;
}

/** 关闭全部项目缓存连接（测试隔离用；生产进程退出时 OS 回收即可） */
export function closeAllProjectCacheDbs(): void {
  for (const db of projectCachePool.values()) {
    try {
      db.close();
    } catch {
      /* 已关闭 */
    }
  }
  projectCachePool.clear();
}

/** 关闭单个项目的池化缓存连接（收尾删项目/临时目录前释放文件句柄，Windows EBUSY） */
export function closeProjectCacheDb(projectRoot: string): void {
  const key = path.resolve(projectRoot);
  const db = projectCachePool.get(key);
  if (db) {
    try {
      db.close();
    } catch {
      /* 已关闭 */
    }
    projectCachePool.delete(key);
  }
}
