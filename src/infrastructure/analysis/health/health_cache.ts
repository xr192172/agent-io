/**
 * health_cache —— 体检缓存（巨石体检 / 架构分层）
 *
 * 核心思路：参与体检的源文件没变动 → 体检报告不变 → 命中缓存，跳过重扫。
 *
 * 指纹：对每个参与文件做 (rel, size, mtimeMs) 快照 → sha1。
 *   - 文件未变动（mtime/size 不变）→ 指纹不变 → 缓存命中。
 *   - 阈值参数（warn/crit/flag_cohesive/max_files）也纳入缓存 key，
 *     阈值变了即使文件没变也要重算（报告本就会变）。
 * 缓存根：**`<root>/.agent-io/cache/health/<key>.json`** —— ★ 2026-10-01（T19）：`root` **由调用方显式传入**。
 *   ★★ 此前这里写死 `process.cwd()` —— 那违反"**每项目一份数据**"：cwd 相同就**跨项目串**，
 *     且与 `cache.db`（用 projectRoot）**根不一致**。现在调用方各自传自己的项目根（`dsl.source_root` /
 *     `input.project_dir`），**"用哪个根"在调用点一眼可见**，不再藏在本模块里。
 * 失败不致命：任何读写异常静默降级为"重新体检"，绝不影响主流程。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface FingerprintFile {
  /** 绝对路径 */
  abs: string;
  /** 相对路径（参与指纹编码，用于区分不同文件） */
  rel: string;
}

/**
 * 本缓存的根目录：`<root>/.agent-io/cache/health`。
 *
 * ★ 2026-10-01（T19）：**导出**它，好让「这份数据归哪个根」成为一处**可见**的声明 ——
 *   登记表 `tests/fixtures/stage_registry.json` 把 `health_cache.owner` 钉在这个函数上，
 *   门拿两个不同的根调它、结果必须不同（这正是此前 bug 的判据：旧实现不收 root、偷用 `cwd`）。
 */
export function healthCacheDir(root: string): string {
  return path.join(root, DATA_DIR_NAME, 'cache', 'health');
}

/** 对一组文件做 (rel,size,mtimeMs) 快照指纹；读不到的文件记 missing（视为已变动） */
export function fileFingerprint(files: FingerprintFile[]): string {
  const h = crypto.createHash('sha1');
  for (const f of files) {
    try {
      const st = fs.statSync(f.abs);
      h.update(`${f.rel}:${st.size}:${Math.round(st.mtimeMs)};`);
    } catch {
      h.update(`${f.rel}:missing;`);
    }
  }
  return h.digest('hex').slice(0, 20);
}

/** 对单个文件做 (size,mtimeMs) 快照指纹（如 DSL 文件）；不存在返回 missing */
export function singleFileFingerprint(abs: string): string {
  try {
    const st = fs.statSync(abs);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return 'missing';
  }
}

/** 读缓存；无缓存 / 读失败一律返回 null（降级为重新体检） */
export function readHealthCache<T>(key: string, root: string): T | null {
  try {
    const p = path.join(healthCacheDir(root), `${key}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 写缓存；失败静默（下次重新体检即可）。写完顺手裁剪（见 {@link pruneHealthCache}）。 */
export function writeHealthCache(key: string, data: unknown, root: string): void {
  try {
    const dir = healthCacheDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(data));
  } catch {
    // 缓存写失败不致命
  }
  // ★ 裁剪与写**分离**：写失败不该连带裁剪失败，反之亦然（同仓 pruneFileSnapshots 的写法）
  try {
    pruneHealthCache(root);
  } catch {
    /* 裁剪失败不影响主流程 */
  }
}

/** 构造缓存 key：prefix + 若干片段（feature/参数/指纹），统一清洗成安全文件名 */
export function healthKey(prefix: string, parts: Array<string | number | boolean>): string {
  const safe = (s: string | number | boolean) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  return [prefix, ...parts.map(safe)].join('_');
}

/**
 * 缓存目录里最多留几份报告（按 mtime 倒序保留最新的）。
 *
 * ★ 为什么要上限（本函数 2026-10-05 加，之前**完全没有**）：
 *   缓存 key 里含 `fileFingerprint` —— 而它把 `Math.round(mtimeMs)` 编进指纹
 *   ⇒ **任何一次保存 / 切分支 / `git checkout` 都会产生一个新 key**。
 *   命中逻辑本身没问题（实测连跑 4 次文件数不变、确实命中），问题是**旧 key 的文件永不删除**：
 *   实测本仓 `.agent-io/cache/health/` 堆到 **2014 个** `.json`，占 `.agent-io/` 全部 2933 个文件的 69%。
 *   ⇒ 缓存变成了"只增不减的历史堆积"，而它本该是"最近一次体检结果"。
 *
 * ★ 为什么不写进 `readHealthCache`：淘汰是**写侧**的职责（读的时候顺手删会让人 surprising）。
 *   同仓已有同形状的先例可抄：`refactor/snapshot/file_snapshot.ts` 的 `pruneFileSnapshots`
 *   （`MAX_FILE_SNAPSHOTS = 20`）+ `design/lifecycle/snapshot.ts` 的 `pruneSnapshots`
 *   ⇒ 「写完就裁剪」是本仓既有纪律，此处只是补齐，不是新造机制。
 */
export const MAX_HEALTH_CACHE_FILES = 20;

/**
 * 裁剪超出保留份数的旧缓存（按 mtime 倒序保留最新 `max` 份；返回删除个数）。
 *
 * ★ 判据用 **mtime** 而不是 key 名：key 是指纹，指纹不可排序（只能"等于/不等"），
 *   而"哪份更新"只能问文件系统。删不掉的文件**静默跳过**（与 `pruneFileSnapshots` 同策：
 *   缓存清理永远不该阻断体检主流程）。
 */
export function pruneHealthCache(root: string, max = MAX_HEALTH_CACHE_FILES): number {
  const dir = healthCacheDir(root);
  if (!fs.existsSync(dir)) return 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return 0;
  }
  const ranked = names
    .map((name) => {
      try {
        return { name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs };
      } catch {
        return { name, mtimeMs: 0 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let n = 0;
  for (const old of ranked.slice(max)) {
    try {
      fs.rmSync(path.join(dir, old.name), { force: true });
      n++;
    } catch {
      /* 删不掉不影响主流程 */
    }
  }
  return n;
}
