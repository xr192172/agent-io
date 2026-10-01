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

import { DATA_DIR_NAME } from '../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface FingerprintFile {
  /** 绝对路径 */
  abs: string;
  /** 相对路径（参与指纹编码，用于区分不同文件） */
  rel: string;
}

function cacheDir(root: string): string {
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
    const p = path.join(cacheDir(root), `${key}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** 写缓存；失败静默（下次重新体检即可） */
export function writeHealthCache(key: string, data: unknown, root: string): void {
  try {
    const dir = cacheDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(data));
  } catch {
    // 缓存写失败不致命
  }
}

/** 构造缓存 key：prefix + 若干片段（feature/参数/指纹），统一清洗成安全文件名 */
export function healthKey(prefix: string, parts: Array<string | number | boolean>): string {
  const safe = (s: string | number | boolean) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  return [prefix, ...parts.map(safe)].join('_');
}
