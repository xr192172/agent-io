/**
 * file_facts —— **某文件的事实**（唯一来源 = 解析数据 `cache.db`）。
 *
 * ★★ 为什么需要它（2026-10-01，用户裁定）：
 *   DSL 的 `semantic.files[].actual_apis` / `actual_deps` 是**代码的事实**，
 *   却被 `scaffold action=backfill` ★（该 action 与它的实现 `backfill.ts` **均已随 T20 删除**，
 *   本注释仅记历史；去处见 `docs/todo.md` 的 T20）与 `import_project` **镜像进意图册**。
 *   用户原话：「**意图册有三项东西，但是有一项东西其实本身就是代码的权威吧**」。
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
 * ★ 库的定位：复用**唯一权威** `db.ts#findCacheDb`（**两级**：`import_cache_<f>.db`(dataHome) >
 *   `<source_root>/.agent-io/cache.db`），**不新造查找顺序**。
 *   ★ 2026-10-06 更正：本注释原写着**三级**（多一个 `<cwd>/.agent-io/cache.db`），与 `db.ts` 的
 *   现状**不符** —— 那个第三级已于 2026-10-01 删除（「越兜越多」的裁定，见 `db.ts#findCacheDb`）。
 *   这是**派生注释没跟上真源**的老毛病（把唯一权威的候选列表在别处抄了一遍）。
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
 *   见它的注释："收尾删项目/临时目录前释放文件句柄…"。自造第二个池 = 把那个坑重挖一遍。
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
/**
 * ★★★ **契约 + 事实「拼接」**（`[...契约, ...事实]`）—— ★ **它不是"合并两种东西"，是"抵消事实"**。
 *
 * ## 意图（2026-10-09，T85/D3 后继 —— 我读了调用方才看懂，所以必须写下来）
 * `diff_views` 用它做**两侧对比**：`diffApis(mergedApis(design…), mergedApis(live…))`。
 * ⇒ **两侧都把"当下的事实"加进去** ⇒ 只要两侧指向**同一个 `source_root`**，**事实部分完全相同** ⇒
 *   **在 `diffApis` 里相互抵消** ⇒ **剩下的差异纯是「契约」的差异** ✓ 这是**有意**的。
 *
 * ## ★★ 两个前提（**不满足就会静默出错**，所以写在这儿）
 * 1. **两侧的 root 必须相同**（同一份 `cache.db`）⇒ 否则**事实不抵消** ⇒ 差异里**混进了代码变更**
 *    （而这条线本该只报"设计差异"）。
 * 2. **两侧都必须拿得到 root** ⇒ 而本函数在 `!root || !fileRel` 时**只返回契约**（下面那行 `return exp`）
 *    ⇒ ★ 于是**一侧有事实、另一侧没有** ⇒ 事实**全变成"差异"** ——
 *    ★★ 这与 T85 那个 1281（"期望侧空了却没别的线"）**是同一种病**：**该说"判不了"却给了个默认值**。
 *    ⇒ ⚠ **已记待办**：`diff_views` 应在两侧 root 不一致/缺失时**明说**（加 `notes`），**不静默**。
 *
 * ★ 口径：值统一成 `{name?, signature}`（与 `ExpectedApi` **可赋值**）—— 这样它能直接喂 `diffApis`。
 */
/**
 * ★★★ **核对「事实抵消」的两个前提**（2026-10-09，T86）—— 返回**人话的告警**（空数组 = 前提成立）。
 *
 * ## 为什么抽成一个纯函数（而不是内联在 `diff_views` 里）
 * 这条检查是**防御性**的：要触发它，得让两侧 `source_root` 不一致或缺失 —— 而 `source_root` 是
 * **写在 DSL 里**（fork 时定）的、`getDSL` 还优先读"活态文件" ⇒ **夹具极难造**。
 * ⇒ 抽成纯函数后**直接喂输入**即可验全部四象限，**不必造出真实的坏状态**。
 * ★ 这是本仓的一条通则：**判据做成纯函数 ⇒ 验收不依赖"能否造出坏状态"**。
 *
 * ## 四象限
 * | dRoot | lRoot | 结论 |
 * |---|---|---|
 * | 都有且相同 | | **前提成立**（空数组）—— 事实在 `diffApis` 里相互抵消 |
 * | 都有但不同 | | ⚠ 事实**不抵消** ⇒ 差异里**混进了代码变更** |
 * | 任一缺失 | | ⚠ 该侧**只有契约、没有事实** ⇒ **事实会全被算成"差异"** |
 */
export function diagnoseFactsOffset(dRoot: string | undefined, lRoot: string | undefined): string[] {
  if (dRoot && lRoot && path.resolve(dRoot) !== path.resolve(lRoot)) {
    return [
      `⚠ **两侧 root 不同**（设计 = \`${dRoot}\`，实际 = \`${lRoot}\`）⇒ 两侧的"事实"**不抵消** ⇒ ` +
        '下面的 API 差异里**混进了代码变更**（本工具本该只报「**契约**差异」）。',
    ];
  }
  if (!dRoot || !lRoot) {
    const which = !dRoot ? '设计' : '实际';
    return [
      `⚠ **${which}视图拿不到 \`source_root\`** ⇒ 该侧**只有契约、没有事实** ⇒ ` +
        '**事实会全被算成"差异"**（★ 不是"真的差了这么多"）。',
    ];
  }
  return [];
}

export function mergedApis(
  root: string | undefined,
  fileRel: string | undefined,
  /** ★ 入参放宽到 `ExpectedApi` 形态（`name` 可选、`signature` 可能缺）—— 免得每个调用点都强转 */
  expected: ReadonlyArray<{ name?: string; signature?: string }> | undefined,
  feature?: string,
  /** ★ 产物与 DSL 的 `ExpectedApi` **可赋值**（`signature` 必填）—— 这样它能直接喂 `diffApis(ExpectedApi[], ExpectedApi[])` */
): Array<{ name?: string; signature: string }> {
  const contract = (expected ?? []).map((a) => ({ name: a.name, signature: a.signature ?? a.name ?? '' }));
  // ★ 拿不到 root/路径 ⇒ **只给契约**（= 事实侧缺席）。★ 这在两侧对比里**不是等价的**（见上面的前提 2）
  //   ⇒ 保留原行为（不改签名、不破坏 20+ 处调用），但**说明白**：它是"事实缺席"，不是"事实为空"。
  if (!root || !fileRel) return contract;
  const factsNow = fileFacts(root, fileRel, feature).apis.map((a) => ({ name: a.name, signature: a.signature ?? a.name }));
  // ★ 顺序**契约在前、事实在后**：`diffApis` 是对称比较（两侧同形），顺序不影响抵消。
  return [...contract, ...factsNow];
}
