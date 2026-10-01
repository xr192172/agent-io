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
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { getStorageRoot } from '../storage.js';
import { SCHEMA_SQL } from './schema.js';

// node:sqlite 用 createRequire 运行时加载而非静态 import：
// vitest 1.x 自带的 Vite 5 内建模块清单不认识 node:sqlite（Node 22.5 才加入），
// 静态 import 会被它剥掉 node: 前缀当文件路径解析而报错；
// createRequire 绕过静态分析，tsc 构建产物与运行时行为完全一致。
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (dbFile: string) => DatabaseSyncType;
};

/** 统一 re-export，调用方从本模块取类型，绕不开 Vite 的静态 import 问题 */
export type Database = DatabaseSyncType;

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

/** 开一层批量事务（最外层真正 BEGIN，嵌套只加深度） */
export function beginBatch(db: Database): void {
  const key = db as unknown as object;
  const d = txDepth.get(key) ?? 0;
  if (d === 0) db.exec('BEGIN');
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

export const SCHEMA_VERSION = 8;

/** 默认 db 文件路径：<dataHome>/.agent-io/cache.db */
export function getDbFile(): string {
  return path.join(getStorageRoot(), 'cache.db');
}

// ─────────────────────────────────────────────────────────────
// cache.db 的**定位** —— ★ 唯一权威：别处不许再自己拼这个路径
//
// 2026-10-01（T19 收口）。起因是用户问："**同一个抽象被两处各用一份**，
// 以后要改抽象时会不会有维护性问题（一个用老头像、一个用新头像）？"
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
//   ② featureCacheDbPath(feature)           导入缓存路径（不问存在）
//   ③ findCacheDb({ feature, sourceRoot })  候选优先级：挑第一个**存在**的
//   ④ nearestCacheDb(dir)                   向上逐级：找最近的**存在**的
//
// ★ ①② 是**纯字符串**（不查盘），好让调用方能在**真正开库之前**先 `existsSync` 预检 ——
//   否则 `getProjectCacheDb` 会在无索引的项目里造出一个空 cache.db（Windows 上还持有 EBUSY 锁，
//   让临时目录测试的 rmSync 失败；`application/cross/project_root.ts` 里记着这笔账）。
// ─────────────────────────────────────────────────────────────

/** ① 已知项目根 ⇒ 该项目的符号缓存文件路径（`<root>/.agent-io/cache.db`）。**不查存在**。 */
export function projectCacheDbPath(root: string): string {
  return path.join(path.resolve(root), DATA_DIR_NAME, 'cache.db');
}

/** ② feature 的导入缓存路径（`<dataHome>/import_cache_<feature>.db`）。**不查存在**。 */
export function featureCacheDbPath(feature: string): string {
  return path.join(getStorageRoot(), `import_cache_${feature}.db`);
}

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
  const { feature, sourceRoot } = opts;
  const candidates = [
    feature ? featureCacheDbPath(feature) : '',
    sourceRoot ? projectCacheDbPath(sourceRoot) : '',
  ];
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

/**
 * 打开（必要时创建）cache.db 并应用 schema。
 * schema 全部 IF NOT EXISTS，重复打开幂等。
 *
 * 迁移策略：缓存是派生物，不做保留式迁移——版本落后即清空业务表，
 * 下次 sync 全量重建。（v1→v2 新增 imports 表：旧 files 行没有原始
 * import 数据，留着会让 import_project 缓存路径静默丢包导入依赖边，
 * 必须失效重建。）
 */
export function openDb(dbFile: string = getDbFile()): Database {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
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
  ]) {
    try {
      db.exec(ddl);
    } catch {
      /* 列已存在 */
    }
  }
  const v = db.prepare('SELECT MAX(version) v FROM schema_versions').get() as { v: number | null };
  if (v.v !== null && v.v < SCHEMA_VERSION) {
    // imports 一并清（v5 前的旧行没有 type_only 语义，且此前清库遗漏 imports 表——
    // 删除的文件会在 imports 留残行；缓存是派生物，全清重建）
    db.exec('DELETE FROM files; DELETE FROM nodes; DELETE FROM edges; DELETE FROM unresolved_refs; DELETE FROM symbol_diffs; DELETE FROM imports;');
  }
  db.prepare(
    'INSERT OR IGNORE INTO schema_versions(version, applied_at, description) VALUES (?, ?, ?)',
  ).run(SCHEMA_VERSION, Date.now(), 'v8: 局部闭包/辅助函数标记 is_closure——不进 DSL 契约面（消除 diff 冲突假阳性），仍保留供搜索/引用；旧库无该列语义，清库重解析');
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

/** 关闭单个项目的池化缓存连接（harvest_from_url 收尾删临时目录前释放文件句柄，Windows EBUSY） */
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
