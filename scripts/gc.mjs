#!/usr/bin/env node
/**
 * scripts/gc.mjs —— **数据根 GC**（使用账本压缩 + 三类空间回收）
 *
 * ## 它删什么、不删什么
 *
 * | 类 | 删 | 保留 |
 * |---|---|---|
 * | ① `scratch/` | 早于保留期（默认 7 天）**且**不在保护窗口（默认 24h）里的实验残留 | 最近产物 · 当前活跃卡的产物 · 名字命中的保护项 |
 * | ② `*.bak-*` | 同一目录同一族（`cache.db.bak-*`）里**除最近 1 份**以外的旧备份 | 每族最近 1 份 · 库/册/账本族的备份**一份都不动** |
 * | ③ `cache.db` | 不做删除：`WAL checkpoint(TRUNCATE)` + `VACUUM`（`auto_vacuum=incremental` 时用 `incremental_vacuum`） | 库本身 |
 * | ④ `usage.jsonl` | 早于保留期的**原始行**（折进 rollup，计数守恒） | 统计（`usage-rollup.json`）· 坏行 |
 *
 * ## 判据（写死，别绕）
 * ① **dry-run 是默认值**：不加 `--apply` 一个字节都不改（破坏性动作不许"默认且静默"，形态同 `registry_repair.mjs`）；
 * ② **删前列举**：每一类都把候选逐条列出来（按大小降序，超过 `--list` 条则明写"另有 N 个"——截断要说出来）；
 * ③ **保护边界是结构，不是文案**：`protectedReason()` 是唯一判据，`tasks.db` / 设计册 / 账本 / 基线 /
 *    活跃卡产物**在任何路径形态下都不许被这三类碰到**；`applyDataRootPlan()` 删每一个候选前**再问一次**
 *    （TOCTOU：判完到删之间树可能变了）；
 * ④ **不跟符号链接**：链接本身可以删（它是 scratch 里的残留），但它指向的东西一动不动；
 * ⑤ **落盘走临时文件 + rename**（账本那一段的既有纪律，不变）。
 *
 * ## 用法
 * ```
 * npm run gc                                   # dry-run：报三类明细 + 预计回收 + 目标达标与否
 * npm run gc -- --apply                        # 真删（+ checkpoint/VACUUM）
 * npm run gc -- --scratch-days=3 --protect-hours=6 --keep-backups=2
 * npm run gc -- --project=D:/some/project      # 换数据根（默认本仓）
 * npm run gc -- --no-cache --no-backups        # 只收某一类（消融 / 排障用）
 * ```
 * ★ 目标（写进输出）：全库 **< 300MB**。达不到时**明说**差多少，不粉饰。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ★ 路径身份（软链/大小写/斜杠归一）：唯一实现 —— 入口守卫必须用它（见 path_identity 头注的恢复事故）
import { samePath } from './lib/path_identity.mjs';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const PKG = path.resolve(HERE, '..');
const DATA_DIR_NAME = '.agent-io';

// ══════════════════════════════════════════════════════════════════════
// 保护边界 —— **唯一判据**（消融测试咬的就是这里）
// ══════════════════════════════════════════════════════════════════════

/**
 * 数据根下**永远不动**的顶层条目（名字 → 为什么）。
 * ★ 这几项不是"暂时跳过"，是**所有权**：任务库 / 设计册 / 账本 / 基线 / 活态册 / 探针事件
 *   都有各自的写端与读端，GC 没有资格判断它们该不该在。
 */
export const PROTECTED_TOP = new Map([
  ['tasks.db', '任务/账本库（append-only 台账的权威，含 -wal/-shm 边车）'],
  ['design', '设计册（.dsl.json + history/journal）'],
  ['baseline', '基线（行为基线的应然侧）'],
  ['live', '活态册'],
  ['observe', '探针事件流（L3 判据的唯一证据源）'],
  ['observe-backup', '探针事件备份'],
  ['tools', '工具登记'],
  ['dogfood', '使用账本（本脚本第一段自己在管它，不许这里再动）'],
  ['code-snapshots', '代码快照'],
  ['hook', '宿主编排钩子'],
  ['cache', '按路径寻址的缓存目录（不是本次三类回收的对象）'],
]);

/**
 * 这个相对路径**为什么不能删**（空串 = 可以删）。
 *
 * ★ 这是本文件唯一一处"保护边界"实现。`applyDataRootPlan()` 在每个 `rmSync` 之前都调它；
 *   把它摘掉（消融）⇒ `tasks.db.bak-*` 这种"看起来只是备份"的东西会被族规则收走 ——
 *   这就是 `tests/p1_gc_retention.test.ts` 里那条反向用例要钉的事实。
 */
export function protectedReason(rel) {
  const segs = String(rel ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (!segs.length) return '数据根本身';
  const base = segs[segs.length - 1];
  const top = segs[0];
  if (segs.length === 1 && PROTECTED_TOP.has(top)) return `顶层保留项 ${top}（${PROTECTED_TOP.get(top)}）`;
  if (segs.length > 1 && PROTECTED_TOP.has(top) && top !== 'scratch') {
    return `在保留目录 ${top}/ 之下（${PROTECTED_TOP.get(top)}）`;
  }
  // ── 库文件：**任何位置**的 tasks.db 及其边车/备份族都算库本体 ──
  if (/^tasks\.db($|[.\-_])/i.test(base)) return '任务/账本库 tasks.db（边车与它的备份族一起保留）';
  if (/^tasks\.jsonl$/i.test(base)) return '任务账本 tasks.jsonl';
  if (/^task-history/i.test(base)) return '任务历史账本';
  if (/ledger/i.test(base)) return '账本类文件（ledger*）';
  if (/\.dsl\.json$/i.test(base) || /\.(history|journal)\.jsonl$/i.test(base)) return '设计册及其历史';
  if (segs.some((s) => s === 'design' || s === 'baseline' || s === 'live')) return '设计册/基线/活态册目录下的文件';
  if (base === 'verified-snapshot.json') return '契约证据快照';
  if (base === 'judge-cache.json') return '判据缓存（可重建，但重建要 100s ⇒ 不在本次三类之内）';
  if (/\.bak-.*-(wal|shm)$/i.test(base)) return '备份的边车（-wal/-shm 跟主文件同生共死，单独删只会留下坏备份）';
  if (base === 'heavy.lock') return '重活排他锁';
  return '';
}

// ══════════════════════════════════════════════════════════════════════
// 小工具
// ══════════════════════════════════════════════════════════════════════

const MB = 1024 * 1024;
export const mb = (bytes) => bytes / MB;
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

function argValue(argv, name, dflt) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return dflt;
  if (hit === `--${name}`) return true; // 无值旗标
  const v = hit.slice(`--${name}=`.length);
  return v;
}

function numArg(argv, name, dflt) {
  const v = argValue(argv, name, undefined);
  if (v === undefined || v === true) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name}=${v} 不是非负数`);
  return n;
}

/** 参数（导出：测试用同一套解析，不另写一份） */
export function parseGcArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    project: String(argValue(argv, 'project', PKG)),
    days: numArg(argv, 'days', 30),
    scratchDays: numArg(argv, 'scratch-days', 7),
    // ★ 大件（≥2000 文件 或 ≥200MB）的保留期：**比普通草稿短**（默认 1 天）。
    //   理由：一条 2.6GB / 18,468 文件的目录**按定义**不是"还在改的草稿"——它是某次基准实验的完整依赖树
    //   （实测 `scratch/t32`）。审计要求"这类 18k 文件夹直接点名"，点名就该有牙：它不靠 7 天保留期裁决，
    //   而是"只要过了保护窗口（默认 24h）就收"，且在报告里逐条点名说清为什么。
    bigDays: numArg(argv, 'big-days', 1),
    protectHours: numArg(argv, 'protect-hours', 24),
    keepBackups: numArg(argv, 'keep-backups', 1),
    listLimit: numArg(argv, 'list', 30),
    targetMb: numArg(argv, 'target-mb', 300),
    // 三类各有一个开关：缺省全开（`--no-*` 只用于消融与排障）
    scratch: !argv.includes('--no-scratch'),
    backups: !argv.includes('--no-backups'),
    cache: !argv.includes('--no-cache'),
    usage: !argv.includes('--no-usage'),
  };
}

/** 统计一棵子树：文件数 / 字节 / 最新 mtime（"最后一次被动过"的唯一口径） */
export function treeStats(abs) {
  const st = fs.lstatSync(abs);
  if (!st.isDirectory()) return { files: 1, bytes: st.size, newestMs: st.mtimeMs };
  let files = 0;
  let bytes = 0;
  let newestMs = st.mtimeMs;
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // 读不到目录 ⇒ 按"不知道"处理：算 0 文件，但 mtime 仍取目录自身（不会因此变成"很旧"）
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      let s;
      try {
        s = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) stack.push(p);
      else {
        files += 1;
        bytes += s.size;
        if (s.mtimeMs > newestMs) newestMs = s.mtimeMs;
      }
    }
  }
  return { files, bytes, newestMs };
}

/** 数据根当前体积（GC 前后各量一次 —— 读数自带分母，0.12 第 3 条） */
export function rootStats(dataRoot) {
  if (!fs.existsSync(dataRoot)) return { files: 0, bytes: 0 };
  const { files, bytes } = treeStats(dataRoot);
  return { files, bytes };
}

/** `*.bak-*` / `*.bak` 的族名：`.bak` 之前那段（`cache.db.bak-before-t45` ⇒ `cache.db`） */
export function backupFamily(base) {
  const i = base.indexOf('.bak');
  if (i <= 0) return '';
  return base.slice(0, i);
}

const isBackupName = (base) => /\.bak(-|$)/i.test(base);

/**
 * 活跃卡 id（`tasks.db.live_cards` 里 `claimed` / `in_progress`）—— 决定"当前会话产物"。
 * ★ 读不到（库被占用 / 坏了 / 没这张表）⇒ 返回 `why`，调用方**整类跳过**（判不了 ≠ 没有候选）。
 */
export async function activeCardIds(tasksDbPath) {
  const out = new Set();
  if (!fs.existsSync(tasksDbPath)) return { ids: out, why: '没有 tasks.db' };
  let db = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(tasksDbPath, { readOnly: true });
    const rows = db.prepare("SELECT id FROM live_cards WHERE state IN ('claimed','in_progress')").all();
    for (const r of rows) out.add(String(r.id));
    return { ids: out, why: '' };
  } catch (e) {
    return { ids: out, why: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db?.close();
    } catch {
      /* 关不掉不改结论 */
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// ① scratch 保留策略
// ══════════════════════════════════════════════════════════════════════

/** 点数阈值：达到就"点名"（t32 那种 18k 文件的一次性基准树，别让它混在"其它"里） */
export const NAMED_MIN_FILES = 2000;
export const NAMED_MIN_MB = 200;

/**
 * 扫描 `scratch/` 的**顶层条目**，按 mtime 保留策略分类。
 * @returns {{dir: string, cutoffMs: number, protectMs: number, active: string[], candidates: Array, kept: Array, named: Array, note: string}}
 */
export async function planScratch(dataRoot, opts, nowMs = Date.now()) {
  const dir = path.join(dataRoot, 'scratch');
  const cutoffMs = nowMs - opts.scratchDays * 24 * 3600 * 1000;
  const protectMs = nowMs - opts.protectHours * 3600 * 1000;
  const activeRes = await activeCardIds(path.join(dataRoot, 'tasks.db'));
  const active = [...activeRes.ids];
  const out = { dir, cutoffMs, protectMs, active, candidates: [], kept: [], named: [], note: '' };
  if (!fs.existsSync(dir)) {
    out.note = '没有 scratch/';
    return out;
  }
  if (activeRes.why) {
    // ★ 0.12：判不了 ≠ 没有候选。活跃卡读不出来 ⇒ 整类跳过（宁可少收，不许误删"正在用的")
    out.note = `tasks.db 读不到活跃卡（${activeRes.why}）⇒ 本类**整类跳过**（判不了 ≠ 没有候选）`;
    return out;
  }
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = path.posix.join('scratch', name);
    const why0 = protectedReason(rel);
    if (why0) {
      out.kept.push({ rel, bytes: 0, files: 0, why: why0 });
      continue;
    }
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    const stats = st.isDirectory() ? treeStats(abs) : { files: 1, bytes: st.size, newestMs: st.mtimeMs };
    const entry = { rel, abs, isDir: st.isDirectory(), bytes: stats.bytes, files: stats.files, newestMs: stats.newestMs };
    const hitCard = active.find((id) => name === id || name.startsWith(`${id}-`) || id.startsWith(`${name}-`));
    if (stats.newestMs >= protectMs) {
      out.kept.push({ ...entry, why: `保护窗口内（最近 ${opts.protectHours}h 动过：${new Date(stats.newestMs).toISOString()}）` });
      continue;
    }
    if (hitCard) {
      out.kept.push({ ...entry, why: `当前活跃卡的产物（card=${hitCard}）` });
      continue;
    }
    // ★ 大件走**更短的保留期**（见 parseGcArgs 的 bigDays 注释）：过了保护窗口就收，并在报告里点名
    const big = stats.files >= NAMED_MIN_FILES || mb(stats.bytes) >= NAMED_MIN_MB;
    const cutoff = big ? nowMs - opts.bigDays * 24 * 3600 * 1000 : cutoffMs;
    if (stats.newestMs >= cutoff) {
      out.kept.push({
        ...entry,
        why:
          `未过保留期（最新 ${new Date(stats.newestMs).toISOString()} ≥ 分界 ${new Date(cutoff).toISOString()}；` +
          `保留期 ${big ? `${opts.bigDays} 天（大件）` : `${opts.scratchDays} 天`}）`,
      });
      continue;
    }
    const why =
      `超过保留期 ${big ? `${opts.bigDays} 天（大件 ≥${NAMED_MIN_FILES} 文件 或 ≥${NAMED_MIN_MB}MB）` : `${opts.scratchDays} 天`}` +
      `（最新 ${new Date(stats.newestMs).toISOString()} < 分界 ${new Date(cutoff).toISOString()}）`;
    out.candidates.push({ ...entry, why });
    // ★ 点名：大件单独一行（t32 = 18,468 文件 / 2.6GB 的一次性基准依赖树）
    if (big) out.named.push({ ...entry, why });
  }
  out.candidates.sort((a, b) => b.bytes - a.bytes);
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// ② 备份保留策略（每族最近 1 份）
// ══════════════════════════════════════════════════════════════════════

/** 在数据根顶层 + `scratch/`（≤4 层）里找 `*.bak-*`，按 (目录, 族) 归组 */
export function planBackups(dataRoot, opts, nowMs = Date.now()) {
  const protectMs = nowMs - opts.protectHours * 3600 * 1000;
  const found = [];
  const scan = (dir, depth) => {
    if (depth > 4 || !fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(dataRoot, abs).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (rel === 'scratch' || rel.startsWith('scratch/')) scan(abs, depth + 1);
        continue;
      }
      if (!isBackupName(e.name)) continue;
      let st;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      found.push({
        rel,
        abs,
        // ★ 族按**文件名**归组（不按目录）：同一个数据根里 `cache.db.bak-*` 即使散在根与 scratch/ 下，
        //   仍然是**同一族的备份**（审计记的那 107MB「r11 散落备份」就是这么漏掉的）⇒ 留最近 1 份要跨目录判。
        family: backupFamily(e.name),
        bytes: st.size,
        newestMs: st.mtimeMs,
        protect: protectedReason(rel),
      });
    }
  };
  scan(dataRoot, 0);
  const families = new Map();
  for (const f of found) {
    const k = f.family;
    if (!families.has(k)) families.set(k, []);
    families.get(k).push(f);
  }
  const candidates = [];
  const kept = [];
  const familiesOut = [];
  for (const [family, list] of [...families].sort((a, b) => a[0].localeCompare(b[0]))) {
    // ★★ 排序口径（比"按 mtime 取最新"更贴事实）：**先看它是不是"库旁边的正牌备份"**。
    //   1) 正牌 = 与库本体同目录（数据根顶层）的那一份 —— 这才可能是"最近一次真备份"；
    //   2) 散落在子目录（scratch/ 之类）的同族备份是**走失的副本**（审计记的 107MB r11）；
    //   3) 恢复/批量拷贝会**重置 mtime**（实测本机全被重置成同一分钟）⇒ 光按 mtime 排名会把走失副本
    //      当成"最新的那份"留下来，而把正牌备份删掉 —— 那是拿 mtime 冒充"新旧"。
    const depth = (f) => f.rel.split('/').length;
    // ★ 受保护的那些（备份的 -wal/-shm 边车等）**不参与排名**：它们既不该占"保留 1 份"的名额，
    //   也不该因为排名被挤到候选里（实测教训：按"最新"排时 0 字节边车会把正牌备份挤掉）。
    const rankable = list.filter((f) => !f.protect);
    const protectedOnes = list.filter((f) => f.protect);
    rankable.sort((a, b) => depth(a) - depth(b) || b.newestMs - a.newestMs);
    const keep = Math.max(1, opts.keepBackups);
    let candInFamily = 0;
    rankable.forEach((f, i) => {
      const stray = depth(f) > 1;
      if (i < keep) {
        kept.push({
          ...f,
          why: stray
            ? `族内最近第 ${i + 1} 份（保留 ${keep} 份；全族只有走失副本时它就是唯一的那份）`
            : `族内最近第 ${i + 1} 份（保留 ${keep} 份，正牌备份）`,
        });
      } else if (f.newestMs >= protectMs) kept.push({ ...f, why: `保护窗口内（最近 ${opts.protectHours}h 动过）` });
      else {
        candidates.push({
          ...f,
          why: stray
            ? `族 "${family}" 里散落在 ${f.rel.split('/').slice(0, -1).join('/')}/ 的走失副本（正牌备份在数据根里）⇒ 多出来的旧备份`
            : `族 "${family}" 里第 ${i + 1} 新的一份（只保留 ${keep} 份）⇒ 多出来的旧备份`,
        });
        candInFamily += 1;
      }
    });
    for (const f of protectedOnes) kept.push({ ...f, why: f.protect });
    familiesOut.push({ family, total: list.length, kept: list.length - candInFamily });
  }
  candidates.sort((a, b) => b.bytes - a.bytes);
  return { families: familiesOut, candidates, kept };
}

// ══════════════════════════════════════════════════════════════════════
// ③ cache.db：WAL checkpoint + VACUUM（只读探测 / 写侧一次）
// ══════════════════════════════════════════════════════════════════════

/** 只读探测：页大小 / 空闲页 / auto_vacuum / WAL 体积 ⇒ 可回收字节（不写一个字节） */
export async function inspectCacheDb(dbPath) {
  const out = {
    path: dbPath,
    exists: fs.existsSync(dbPath),
    bytes: 0,
    walBytes: 0,
    shmBytes: 0,
    pageSize: 0,
    pageCount: 0,
    freelist: 0,
    autoVacuum: -1,
    journalMode: '',
    reclaimable: 0,
    error: '',
  };
  if (!out.exists) {
    out.error = '没有 cache.db';
    return out;
  }
  const st = fs.statSync(dbPath);
  out.bytes = st.size;
  for (const [k, suffix] of [
    ['walBytes', '-wal'],
    ['shmBytes', '-shm'],
  ]) {
    try {
      out[k] = fs.statSync(dbPath + suffix).size;
    } catch {
      out[k] = 0;
    }
  }
  const { DatabaseSync } = await import('node:sqlite');
  let db = null;
  try {
    // ★ 只读打开：探测阶段**一个字节都不写**（dry-run 的承诺）
    db = new DatabaseSync(dbPath, { readOnly: true });
    out.pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size ?? 0);
    out.pageCount = Number(db.prepare('PRAGMA page_count').get()?.page_count ?? 0);
    out.freelist = Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count ?? 0);
    out.autoVacuum = Number(db.prepare('PRAGMA auto_vacuum').get()?.auto_vacuum ?? -1);
    out.journalMode = String(db.prepare('PRAGMA journal_mode').get()?.journal_mode ?? '');
    out.reclaimable = out.pageSize * out.freelist;
  } catch (e) {
    // ★ 读不到（被占用 / WAL 需要恢复 / 损坏）⇒ 明说，别当成"没有可回收"
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      db?.close();
    } catch {
      /* 关不掉不改结论 */
    }
  }
  return out;
}

/**
 * 真做一次回收：`wal_checkpoint(TRUNCATE)` + (`incremental_vacuum` | `VACUUM`)。
 * ★ 只有 `--apply` 才调它；调用方负责持有重活锁（本函数只动 cache.db）。
 */
export async function vacuumCacheDb(dbPath, opts) {
  const before = await inspectCacheDb(dbPath);
  if (!before.exists) return { before, after: before, applied: false, error: '没有 cache.db' };
  const { DatabaseSync } = await import('node:sqlite');
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 5000');
    const wal1 = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    // ★ 增量模式（auto_vacuum=2）用 incremental_vacuum（按页预算、可中断）；
    //   否则只能整库 VACUUM —— **不偷偷改 auto_vacuum**（那需要一次 VACUUM + 永久改变库的形态，
    //   是设计决定不是 GC 的副产物）。
    if (before.autoVacuum === 2) db.exec('PRAGMA incremental_vacuum');
    else if (before.freelist > 0) db.exec('VACUUM');
    db.exec('PRAGMA optimize');
    // ★★ 收尾**再 checkpoint 一次**：VACUUM 在 WAL 模式下会把整库改页推进 `-wal`（实测 4.4MB → 68.5MB，
    //   不截断的话"回收完的库"反而多占 60+MB）。这一步是这段代码存在的理由之一，别省。
    const wal2 = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const after = await inspectCacheDb(dbPath);
    return { before, after, applied: true, wal: wal1, walAfter: wal2, mode: before.autoVacuum === 2 ? 'incremental_vacuum' : 'VACUUM', error: '' };
  } catch (e) {
    return { before, after: before, applied: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      db?.close();
    } catch {
      /* 关不掉不改结论 */
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// 计划 / 执行
// ══════════════════════════════════════════════════════════════════════

/** 只读地算一份完整计划（dry-run = 打印它；`--apply` = 先算它再照它删） */
export async function planDataRootGc(dataRoot, opts, nowMs = Date.now()) {
  const before = rootStats(dataRoot);
  const scratch = opts.scratch
    ? await planScratch(dataRoot, opts, nowMs)
    : { skipped: true, note: '--no-scratch', candidates: [], kept: [], named: [], active: [] };
  const backups = opts.backups
    ? planBackups(dataRoot, opts, nowMs)
    : { skipped: true, note: '--no-backups', candidates: [], kept: [], families: [] };
  const cache = opts.cache
    ? await inspectCacheDb(path.join(dataRoot, 'cache.db'))
    : { skipped: true, path: path.join(dataRoot, 'cache.db'), error: '--no-cache', bytes: 0, walBytes: 0, reclaimable: 0, freelist: 0 };
  const scratchBytes = (scratch.candidates ?? []).reduce((n, c) => n + c.bytes, 0);
  const backupBytes = (backups.candidates ?? []).reduce((n, c) => n + c.bytes, 0);
  // ★ cache.db 的回收量按**可观察到的两笔**算：空闲页（VACUUM 能吐出来）+ WAL（TRUNCATE 能截掉）。
  //   不按"库能缩到多少"猜 —— 那种数只能事后量，不能事前承诺。
  const cacheReclaim = Math.max(0, cache.reclaimable ?? 0) + (cache.walBytes ?? 0);
  const predictedAfter = Math.max(
    0,
    before.bytes - scratchBytes - backupBytes - (opts.cache && !cache.skipped && !cache.error ? cacheReclaim : 0),
  );
  return {
    dataRoot,
    nowMs,
    opts,
    before,
    scratch,
    backups,
    cache,
    projected: { scratchBytes, backupBytes, cacheReclaim, reclaimed: scratchBytes + backupBytes + cacheReclaim, predictedAfter },
  };
}

/**
 * 执行计划。★ 删**每一个**候选前都重问一次 `protectedReason()` 与保护窗口（TOCTOU），
 * 任何一个不过就跳过并记名 —— 宁可少删，不许删错。
 */
export function applyDataRootPlan(plan) {
  const dataRoot = plan.dataRoot;
  const opts = plan.opts;
  const removed = [];
  const failed = [];
  const skipped = [];
  const nowMs = Date.now();
  const targets = [
    ...(plan.scratch.candidates ?? []).map((c) => ({ ...c, cls: 'scratch' })),
    ...(plan.backups.candidates ?? []).map((c) => ({ ...c, cls: 'bak' })),
  ];
  for (const t of targets) {
    const abs = path.resolve(t.abs);
    const rel = path.relative(dataRoot, abs).split(path.sep).join('/');
    // ① 必须在数据根之下（防越界）
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      skipped.push({ rel, why: '不在数据根之下' });
      continue;
    }
    // ② 保护边界（结构判据 —— 消融它就会删到 tasks.db 族）
    const why0 = protectedReason(rel);
    if (why0) {
      skipped.push({ rel, why: why0 });
      continue;
    }
    // ③ 保护窗口（删前再量一次：判完到现在可能刚被写过）
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      skipped.push({ rel, why: '已经不在了' });
      continue;
    }
    const stats = st.isDirectory() ? treeStats(abs) : { bytes: st.size, newestMs: st.mtimeMs };
    if (stats.newestMs >= nowMs - opts.protectHours * 3600 * 1000) {
      skipped.push({ rel, why: `保护窗口内（删前复量：最新 ${new Date(stats.newestMs).toISOString()}）` });
      continue;
    }
    try {
      fs.rmSync(abs, { recursive: st.isDirectory(), force: false, maxRetries: 3, retryDelay: 100 });
      removed.push({ rel, cls: t.cls, bytes: stats.bytes });
    } catch (e) {
      failed.push({ rel, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { removed, failed, skipped };
}

// ══════════════════════════════════════════════════════════════════════
// 渲染 + 主流程
// ══════════════════════════════════════════════════════════════════════

function renderList(rows, limit, label) {
  const shown = rows.slice(0, limit);
  for (const r of shown) {
    console.log(`    · ${f1(mb(r.bytes)).padStart(9)} MB  ${r.rel}${r.files ? `（${r.files} 文件）` : ''}\n        ${r.why}`);
  }
  if (rows.length > shown.length) {
    const rest = rows.slice(shown.length);
    const restMb = rest.reduce((n, r) => n + r.bytes, 0);
    // ★ 截断要说出来（0.12：读端必须知道"还有没列的"）
    console.log(`    … 另有 ${rest.length} 个${label}未逐条列出（合计 ${f1(mb(restMb))} MB）；要全看：--list=${rows.length}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let opts;
  try {
    opts = parseGcArgs(argv);
  } catch (e) {
    console.error(`✗ 参数不对：${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const dataRoot = path.join(path.resolve(opts.project), DATA_DIR_NAME);
  if (!fs.existsSync(dataRoot)) {
    console.error(`✗ 找不到数据根 ${dataRoot}（读不到 ≠ 没有；--project=<项目根> 可换）`);
    process.exit(2);
  }

  // ── 第一部分：使用账本压缩（既有行为，一个字不改；dist 不在就跑不了，如实说） ──
  let usage = null;
  if (opts.usage) {
    try {
      const mod = await import(pathToFileURL(path.join(PKG, 'dist/src/infrastructure/dogfood_stats.js')).href);
      const before = mod.snapshotDogfoodStats({ includeSweeps: true });
      const rep = mod.compactUsageLog({ keepDays: opts.days, apply: opts.apply });
      usage = { before, rep, mod };
      const fmt = (n) => String(n).padStart(6);
      console.log('══ ① 工具使用账本 GC ══');
      console.log(`  账本      ${rep.file}`);
      console.log(`  聚合桶    ${rep.rollup_file}`);
      console.log(`  保留期    ${rep.keep_days} 天（分界 ${rep.cutoff}）`);
      console.log(`  行数      ${fmt(rep.lines_before)} 可解析 · 保留 ${rep.lines_keep} · 归档 ${rep.lines_archive} · 坏行 ${rep.lines_broken}（原样留着）`);
      console.log(`  桶        ${rep.buckets} 个 · 计数合计 ${rep.bucket_calls}`);
      console.log(`  模式      ${opts.apply ? (rep.applied ? '★ 已落盘（--apply）' : '未落盘（没有可归档的行）') : 'dry-run（默认，一个字节没改）'}`);
      if (opts.apply && rep.applied) {
        const after = mod.snapshotDogfoodStats({ includeSweeps: true });
        const t = (s) => s.tools.reduce((n, x) => n + x.calls, 0);
        const same = t(before) === t(after) && before.tools.length === after.tools.length;
        console.log(`  读数守恒  GC 前 ${t(before)} 次 / ${before.tools.length} 个工具 ⇒ GC 后 ${t(after)} 次 / ${after.tools.length} 个工具 ⇒ ${same ? '✓ 一致' : '✗ 不一致'}`);
        if (!same) {
          console.error('✗ 读数不守恒 —— 请立刻用账本备份回滚，并把这个读数贴出来');
          process.exitCode = 1;
        }
      }
    } catch (e) {
      console.log('══ ① 工具使用账本 GC ══');
      console.error(`  ✗ 跑不了（先 npm run build）：${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 2;
    }
  }

  // ── 第二部分：数据根三类回收 ──
  const plan = await planDataRootGc(dataRoot, opts);
  const targetBytes = opts.targetMb * MB;
  console.log('');
  console.log('══ ② 数据根三类回收 ══');
  console.log(`  数据根    ${dataRoot}`);
  console.log(`  现状      ${f1(mb(plan.before.bytes))} MB / ${plan.before.files} 文件 · 目标 < ${opts.targetMb} MB`);
  console.log(`  保护边界  ${[...PROTECTED_TOP.keys()].join(' · ')}（tasks.db / 设计册 / 账本 / 基线 / 活态册一律不碰）`);

  // ① scratch
  const sc = plan.scratch;
  console.log('');
  console.log(`  ── ① scratch/ ${sc.skipped ? `（跳过：${sc.note}）` : `保留期 ${opts.scratchDays} 天 · 保护最近 ${opts.protectHours}h`}`);
  if (!sc.skipped) {
    if (sc.note) console.log(`     ★ ${sc.note}`);
    if (sc.active.length) console.log(`     活跃卡：${sc.active.join(', ')}（它们的产物一律保留）`);
    const candBytes = sc.candidates.reduce((n, c) => n + c.bytes, 0);
    // ★ 点名先打（大件不许混在"其它"里）
    for (const n of sc.named) {
      console.log(`     ★ 点名 ${n.rel}：${f1(mb(n.bytes))} MB / ${n.files} 文件 —— ${n.why}`);
      console.log('        （一次性实验的完整依赖树，不是缓存：删了要重跑基准才能再生成）');
    }
    renderList(sc.candidates, opts.listLimit, ' scratch 候选');
    console.log(`     候选 ${sc.candidates.length} 个 / ${f1(mb(candBytes))} MB · 保留 ${sc.kept.length} 个`);
  }

  // ② back-ups
  const bk = plan.backups;
  console.log('');
  console.log(`  ── ② *.bak-* ${bk.skipped ? `（跳过：${bk.note}）` : `每族保留最近 ${Math.max(1, opts.keepBackups)} 份`}`);
  if (!bk.skipped) {
    for (const f of bk.families ?? []) console.log(`     族 ${f.family}：${f.total} 份 ⇒ 保留 ${f.kept}`);
    const bakBytes = bk.candidates.reduce((n, c) => n + c.bytes, 0);
    renderList(bk.candidates, opts.listLimit, ' 备份候选');
    console.log(`     候选 ${bk.candidates.length} 个 / ${f1(mb(bakBytes))} MB · 保留 ${bk.kept.length} 个`);
  }

  // ③ cache.db
  const ca = plan.cache;
  console.log('');
  console.log('  ── ③ cache.db：WAL checkpoint + VACUUM');
  if (ca.skipped) console.log(`     跳过：${ca.error}`);
  else if (ca.error) console.log(`     ✗ 探不到（${ca.error}）⇒ 本类**跳过**（判不了 ≠ 已收）`);
  else {
    console.log(
      `     库 ${f1(mb(ca.bytes))} MB · WAL ${f1(mb(ca.walBytes))} MB · 页 ${ca.pageSize}B × 空闲 ${ca.freelist} 页` +
        ` ⇒ 可回收 ${f1(mb(ca.reclaimable))} MB · auto_vacuum=${ca.autoVacuum}（${ca.autoVacuum === 2 ? 'incremental' : 'none'}）· journal=${ca.journalMode}`,
    );
  }

  // 总账
  const reclaimed = plan.projected.reclaimed;
  const predictedAfter = plan.projected.predictedAfter;
  console.log('');
  console.log('  ── 总账 ──');
  console.log(
    `     scratch 候选 ${f1(mb(plan.projected.scratchBytes))} MB + 备份候选 ${f1(mb(plan.projected.backupBytes))} MB + cache 可回收 ${f1(mb(plan.projected.cacheReclaim))} MB`,
  );
  console.log(`     预计回收 ${f1(mb(reclaimed))} MB ⇒ 预计 ${f1(mb(predictedAfter))} MB（目标 < ${opts.targetMb} MB ⇒ ${predictedAfter <= targetBytes ? '✓ 达标' : `✗ 还差 ${f1(mb(predictedAfter - targetBytes))} MB`}）`);

  if (!opts.apply) {
    console.log('');
    console.log('  ⇒ dry-run 结束：一个字节都没写（要真删：npm run gc -- --apply）');
    return;
  }

  // ── 真删 ──
  console.log('');
  // ★ 重活锁：VACUUM 与删盘都不许和 verify / judge-all / mutate 同时跑（共享 cache.db / dist）
  let release = null;
  try {
    const { acquireHeavyLock } = await import(pathToFileURL(path.join(HERE, 'lib/heavy_lock.mjs')).href);
    release = acquireHeavyLock(path.resolve(opts.project), { name: 'gc' });
  } catch (e) {
    console.error(`  ✗ 拿不到重活锁 ⇒ 不删（判不了 ≠ 已收）：${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  try {
    const res = applyDataRootPlan(plan);
    const freed = res.removed.reduce((n, r) => n + r.bytes, 0);
    console.log(`  ★ 已删 ${res.removed.length} 个 / ${f1(mb(freed))} MB · 跳过 ${res.skipped.length} 个 · 失败 ${res.failed.length} 个`);
    for (const s of res.skipped.slice(0, opts.listLimit)) console.log(`     · 跳过 ${s.rel}：${s.why}`);
    for (const x of res.failed.slice(0, opts.listLimit)) console.log(`     ✗ 失败 ${x.rel}：${x.why}`);

    if (!ca.skipped && !ca.error) {
      const vac = await vacuumCacheDb(path.join(dataRoot, 'cache.db'), opts);
      if (vac.error) console.log(`     ✗ cache.db 回收失败：${vac.error}`);
      else
        console.log(
          `     ✓ cache.db：${vac.mode} + checkpoint ⇒ ${f1(mb(vac.before.bytes))} MB → ${f1(mb(vac.after.bytes))} MB` +
            `（WAL ${f1(mb(vac.before.walBytes))} → ${f1(mb(vac.after.walBytes))} MB）`,
        );
    }
    const after = rootStats(dataRoot);
    console.log('');
    console.log(`  ★ 实测：${f1(mb(plan.before.bytes))} MB / ${plan.before.files} 文件 → ${f1(mb(after.bytes))} MB / ${after.files} 文件`);
    console.log(`     目标 < ${opts.targetMb} MB ⇒ ${after.bytes <= targetBytes ? '✓ 达标' : `✗ 还差 ${f1(mb(after.bytes - targetBytes))} MB（下一轮把 --scratch-days 收紧）`}`);
    if (res.failed.length) process.exitCode = 1;
  } finally {
    try {
      release?.();
    } catch {
      /* 释放失败不改结论 */
    }
  }
}

// ★ 入口守卫用**物理路径**比（软链形态 vs realpath 形态是两条合法字符串）——
//   手写字符串比较 ⇒ 软链下 main() 静默不跑 ⇒ 假绿（`path_identity.mjs` 头注记的恢复事故）。
if (process.argv[1] && samePath(process.argv[1], SELF)) {
  await main();
}
