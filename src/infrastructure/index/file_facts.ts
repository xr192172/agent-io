/**
 * file_facts —— **某文件的事实**（唯一来源 = 解析数据 `cache.db`）。
 *
 * ★★ 为什么需要它（2026-10-01，用户裁定）：
 *   DSL 的 `semantic.files[].actual_apis` / `actual_deps` 是**代码的事实**，
 *   却被 `scaffold action=backfill`（`backfill.ts:287`）与 `import_project`（`import_project.ts:1856`）
 *   **镜像进意图册**。用户原话：「**意图册有三项东西，但是有一项东西其实本身就是代码的权威吧**」。
 *   ⇒ **事实的权威只在解析数据里**；DSL 只放**意图**（`expected_apis`）。
 *   ⇒ 原先读那份镜像的 5 个读者，改读**这里**。
 *
 * ★ 判据（不只是"从哪读"，还有"读的是不是同一份"）：
 *   - 文件节点 id 约定 = **裸仓库相对路径**（`index/symbols.ts:218 fileNodeId = rel`）；
 *     import 边的 `source`/`target` 都是文件节点 id。
 *   - 符号只取**非局部闭包**的 `function`/`method`（`COALESCE(is_closure,0)=0`）——
 *     与 `function_outline.ts` 同一口径（局部闭包不是契约面）。
 *
 * ★★ 两处**单点解决**（不让每个读者各写一遍 —— 那是判据分叉）：
 *   1. **路径前缀不一致**：DSL 的 `semantic.files[].path` 与 cache.db 的 `file_path` 可能前缀不同
 *      （既有代码里 `overview.ts` 就靠"精确 → 后缀匹配"兜）。⇒ 本模块**先精确、再后缀**，
 *      读者只管传 DSL 的 path。
 *   2. **连接复用**：读者多在**逐文件循环**里调用 ⇒ 若每次 `openDb` 会开 N 个连接且不关闭
 *      ⇒ 本模块按 dbPath **缓存连接**（与 `db.ts` 的 `projectCachePool` 同一条纪律：**不 close**）。
 *
 * ★ 库的定位：复用**唯一权威** `db.ts#findCacheDb`（`import_cache_<f>.db`(dataHome) >
 *   `<source_root>/.agent-io/cache.db` > `<cwd>/.agent-io/cache.db`），**不新造查找顺序**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb, openDb, findCacheDb, projectCacheDbPath, type Database } from './db.js';

/** 一个文件的**事实**（从解析数据现取；不是 DSL 里的镜像） */
export interface FileFacts {
  /** 顶层 API（非局部闭包）—— 按源码行序 */
  apis: Array<{
    name: string;
    qualified_name: string;
    signature: string | null;
    /** ★ 行区间（1-based）：原来 DSL 镜像的 `notes` 里带"L12-34"这类注记，读者需要它来复原 */
    start_line: number;
    end_line: number;
  }>;
  /** 该项目内被本文件 import 的文件（仓库相对路径） */
  deps: string[];
  /** 实际使用的 cache.db 路径；`null` = 一个候选都不存在（本轮无索引可读） */
  source: string | null;
  /** ★ 实际命中的 `file_path`（可能与入参 `fileRel` 不同：靠后缀匹配兜到） */
  matched_path: string | null;
}

const EMPTY: FileFacts = { apis: [], deps: [], source: null, matched_path: null };

/**
 * ★★ 复用**既有**的连接池，**不另造一个**（2026-10-01 当场改）：
 *   第一版我在这里自建了 `Map<dbPath, Database>` 且"刻意不 close" —— 结果：
 *   Windows 上删项目目录 **EBUSY**（`db.ts` 的 `closeProjectCacheDb` 存在的**唯一理由**就是这个，
 *   见它的注释："harvest_from_url 收尾删临时目录前释放…"。自造第二个池 = 把那个坑重挖一遍。
 *   ⇒ 走 `projectCachePool`：它的 close 机制现成，测试侧 `closeAllProjectCacheDbs()` 一并管住。
 *   ⇒ 非项目库（`import_cache_<f>.db`）**每次 open**，与既有 `function_outline.ts:212` 同一行为（不缓存）。
 */
function pickDb(root: string, dbPath: string): Database {
  return dbPath === projectCacheDbPath(root) ? getProjectCacheDb(root) : openDb(dbPath);
}

/**
 * 把入参 path 解析成 cache.db 里**真实存在的** `file_path`：
 * ① **精确命中**（最常见）；
 * ② 否则按**后缀**匹配（`%/` + path）—— ★★ **必须唯一**：命中多条就**不猜**，返回 null。
 *
 * ★ 为什么"不唯一就不猜"（2026-10-01 当场改，由本模块自己的测试逼出来）：
 *   第一版取"最短的那条"，测试立刻抓到反例：查一个**不在**该项目里的 `a.ts`，
 *   后缀匹配竟命中了 `tests/fixtures/death-source-fixture-rollback/…/a.ts` ——
 *   **静默给出别处的事实**。这与本模块存在的理由（"事实的权威只有一个"）直接冲突。
 *   ⇒ 实践中 DSL 记的是 `src/foo/bar.ts` 这类**有目录的**路径，唯一性成立；
 *     真的撞名（多处同名）本该交给上层显式消歧，而不是在这里猜一条。
 * 找不到 / 有歧义 ⇒ null（调用方据此判"这个文件不在索引里"，而不是"它没有 API"）。
 */
function resolveFilePath(db: Database, fileRel: string): string | null {
  const exact = db.prepare('SELECT 1 FROM nodes WHERE file_path = ? AND kind = ? LIMIT 1').get(fileRel, 'file');
  if (exact) return fileRel;
  const rows = db
    .prepare('SELECT DISTINCT file_path FROM nodes WHERE file_path LIKE ? AND kind = ?')
    .all(`%/${fileRel}`, 'file') as Array<{ file_path: string }>;
  return rows.length === 1 ? rows[0].file_path : null;
}

/** 取某文件的事实。根 = 项目根（或 source_root） */
export function fileFacts(root: string, fileRel: string, feature?: string): FileFacts {
  const dbPath = findCacheDb({ feature, sourceRoot: root }) ?? projectCacheDbPath(root);
  // ★ 只有"一个候选库都不存在"才返回空事实 —— 那是**合法的"还没建索引"**（调用方据此显示"无"）。
  //   ★★ 其余错误（库损坏 / SQL 失败）**一律抛**：吞掉会变成"显示成没有 API"的**静默错误**，
  //      正是本仓 §2d/§3 明令禁止的失败模式（"少做一点事而不说话"）。
  if (!fs.existsSync(dbPath)) return EMPTY;

  const db = pickDb(root, dbPath);
  const matched = resolveFilePath(db, fileRel);
  if (matched === null) return { ...EMPTY, source: dbPath };

  const apis = db
    .prepare(
      `SELECT name, qualified_name, signature, start_line, end_line FROM nodes
       WHERE file_path = ? AND kind IN ('function','method') AND COALESCE(is_closure, 0) = 0
       ORDER BY start_line`,
    )
    .all(matched) as FileFacts['apis'];

  const deps = (
    db.prepare("SELECT DISTINCT target FROM edges WHERE kind = 'import' AND source = ?").all(matched) as Array<{
      target: string;
    }>
  ).map((r) => r.target);

  return { apis, deps, source: dbPath, matched_path: matched };
}

/** 便捷：只要签名串（多数展示场景用这个） */
export function apiSignaturesOf(root: string, fileRel: string, feature?: string): string[] {
  return fileFacts(root, fileRel, feature)
    .apis.map((a) => a.signature ?? a.name)
    .filter(Boolean);
}

/**
 * ★★ 读者最常用的合并形态：**「意图 ∪ 事实」的 API 表**。
 *
 * 为什么做成单点：移除 `actual_apis` 镜像后有 **6 个文件、20+ 处**都在写
 * `[...(x.expected_apis ?? []), ...(x.actual_apis ?? [])]` —— 让它们各自改成
 * "去 fileFacts 取事实" = 同一个判据抄 20 遍（正是本仓要消灭的东西）。
 *
 * 语义：**先意图、后事实**（与旧顺序一致）；`root`/`fileRel` 缺失或查不到事实 ⇒ 只有意图（不编造）。
 * ⇒ 与旧行为的关系：`import_project` 落库时 `actual_apis === expected_apis`（`diff_views.ts:793` 的注释
 *   早就写明了这一点），所以对这类 DSL **新旧等价**；对其它的，事实改为**现取**（这正是本改革的目的）。
 */
export function mergedApis(
  root: string | undefined,
  fileRel: string | undefined,
  /** ★ 入参放宽到 `ExpectedApi` 形态（`name` 可选、`signature` 可能缺）—— 免得每个调用点都强转 */
  expected: ReadonlyArray<{ name?: string; signature?: string }> | undefined,
  feature?: string,
  /** ★ 产物与 DSL 的 `ExpectedApi` **可赋值**（`signature` 必填）—— 这样它能直接喂 `diffApis(ExpectedApi[], ExpectedApi[])` */
): Array<{ name?: string; signature: string }> {
  const exp = (expected ?? []).map((a) => ({ name: a.name, signature: a.signature ?? a.name ?? '' }));
  if (!root || !fileRel) return exp;
  const facts = fileFacts(root, fileRel, feature).apis.map((a) => ({ name: a.name, signature: a.signature ?? a.name }));
  return [...exp, ...facts];
}
