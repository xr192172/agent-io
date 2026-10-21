/**
 * scan_rev —— **DB 扫描代**（`_sync` 新鲜度自证用的版本号，`dsl-keep-list §六`）。
 *
 * ## 为什么需要它（★ 一个实测出来的洞）
 * `_sync` 原先只有 `saved_at` ⇒ ★ **用 DSL 时无法自证新旧**：`saved_at` 只说"这份
 * 快照是什么时候【写】的"，不说"它反映的是【哪一代扫描】"。
 * 实测（2026-10-15）：`live` 落后 14.25h —— 靠人工对比两份文件才发现，工具自己说不出来。
 * ⇒ 补 `scanRev`：**底层事实库（cache.db）的扫描代** = `max(files.indexed_at)`。
 * ★ 判据：`live._sync.scanRev` 与**当下** `max(files.indexed_at)` 一致 ⇒ 是当前代；
 *   不一致 ⇒ 这份快照落在一代之前的扫描上（**别拿它下结论**）。
 *
 * ## 纪律
 * · ★ 库的定位**复用唯一权威** `db.ts#findCacheDb`（两级：`import_cache_<f>.db` >
 *   `<source_root>/.agent-io/cache.db`）⇒ **不新造查找顺序**（同 `file_facts.ts`）。
 * · ★ **只读打开**（`readOnly: true`）：本模块**绝不**改真仓的 `cache.db`
 *   （读一次扫描代不该产生副作用；WAL 下只读也需要 -shm，但那不是"改数据"）。
 * · ★ **缺库 / 缺表 ⇒ `null`（不是 0）**：`null` = "本轮没有可自证的扫描代"，
 *   与"扫描代 = 0"是两件事（本仓铁律：**"没跑"与"跑过"必须分开**）。
 */
import { DatabaseSync } from 'node:sqlite';
import { findCacheDb } from './db.js';

export interface ScanRev {
  /** `max(files.indexed_at)`（毫秒 epoch）；`null` = 无库 / 无 files 行（**不是** 0） */
  rev: number | null;
  /** 实际命中的 cache.db 绝对路径；`null` = 一个候选都不存在 */
  db: string | null;
  /**
   * ★ 2026-10-21：cache.db 的 **schema 版本** = `max(schema_versions.version)`；`null` = 无库 / 无该表。
   *
   * ★ 为什么必须有它（与 `rev` 合起来才叫"**复制自哪一刻的 DB**"）：
   *   `rev`（indexed_at）只说"事实扫描到哪一刻"，不说"这些事实是**哪种形状**"——而 v14/v15/v16
   *   三次迁移都在往 `nodes` 加列（return_type / body_hash / file_path→files.id）。
   *   ⇒ 一份 DSL 若记着 `{rev, schemaVersion}`，读端才能判「它是旧形状的库复制来的」，
   *     而不是拿新代码的字段去读旧快照后**静默得出空值**（"没这个字段"≠"这个字段是空"）。
   * ★ 它只用于**判断**（设计比实际新 / 实际比设计新）；**绝不**据此自动改写任何 DSL。
   */
  schemaVersion: number | null;
}

/** 空态（无库可读）—— 与"读到了但为 0"区分开。 */
const NONE: ScanRev = { rev: null, db: null, schemaVersion: null };

/**
 * 取某 feature / 项目根的**当前扫描代**。
 * @param opts.feature    feature 名（候选链第一级 `import_cache_<f>.db`）
 * @param opts.sourceRoot 被分析项目根（候选链第二级 `<root>/.agent-io/cache.db`）
 */
export function scanRevOf(opts: { feature?: string; sourceRoot?: string } = {}): ScanRev {
  const dbFile = findCacheDb(opts);
  if (!dbFile) return NONE;
  try {
    // ★ 只读：本函数是**量具**，不改真仓数据。
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const row = db.prepare('SELECT max(indexed_at) AS m FROM files').get() as { m: number | null } | undefined;
      const m = row?.m ?? null;
      // ★ 2026-10-21：同一个连接里顺带取 schema 版本（与 rev 同源同时刻 ⇒ "哪一刻的库"才有意义）。
      //   缺表（老库）⇒ null（不是 0）：0 会被读成"版本 0"，那是编出来的事实。
      let schemaVersion: number | null = null;
      try {
        const v = db.prepare('SELECT max(version) AS v FROM schema_versions').get() as { v: number | null } | undefined;
        schemaVersion = typeof v?.v === 'number' ? v.v : null;
      } catch {
        schemaVersion = null;
      }
      return { rev: typeof m === 'number' ? m : null, db: dbFile, schemaVersion };
    } finally {
      db.close();
    }
  } catch {
    // 库存在但打不开 / 无 files 表 ⇒ 视为"无扫描代可读"（**不降级成 0**）。
    return { rev: null, db: dbFile, schemaVersion: null };
  }
}
