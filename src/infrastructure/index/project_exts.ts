/**
 * `projectParserExts` —— 「**这个项目实际用到哪些源码后缀**」的**唯一取数点**（按需预热的取数口）。
 *
 * ## 为什么要有它（QW-2 · 延迟普查 `latency-ds-1` §6 QW-2）
 * `prewarmKernel()` 原来无条件遍历 55 门注册语言（51 个 Parser，裸测 248 ms / 端到端 384 ms），
 * 而 `invokeTool` **每次调用**都 `await` 它 —— 真实一次调用只要 0–2 门。
 * 要"按需"，先得回答"需"是什么：**这个项目的源文件是什么语言**。
 * 这个事实**索引里已经有了**：`files.path` 是仓库相对路径，逐行取后缀即可 ——
 * 不必再走一遍盘（那是 `code_health` 的活），也不必猜（猜错 = 同步路径静默不可用）。
 *
 * ## 语义（三条边界，都是为了"不许把不知道说成 0"）
 * · **没有索引 / 读不出来** ⇒ `null` = 拿不到项目事实 ⇒ 调用方退回全量预热（不许静默按 0 门跑）。
 * · **有索引但 `files` 为空** ⇒ 同样 `null`（空索引 ≠ 项目没有源码）。
 * · 只报**本机支持**的后缀（与 `probe.isExtSupported` 同一把尺）；装不上的语言不进预热集合。
 *
 * ## 缓存
 * 进程内按 root 缓存一次（MCP 长驻进程会反复问同一个项目）。
 * 过期只可能"少一门**新**后缀"，而新后缀由 `invokeTool` 从**入参文件路径**补
 * （见 `presentation/mcp/server_registry.ts` 的 `argSourceExts`）⇒ 这里不需要每次重扫。
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectCacheDbPath, getProjectCacheDb } from './db.js';
import { isExtSupported } from '../parse/probe.js';

const cache = new Map<string, string[] | null>();

/** 该文件的后缀（小写；与 kernel 的缓存键同一条推导：`'.' + 最后一段`，只多一步小写归一） */
function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * 该项目**值得预热**的源码后缀（去重、排序）；拿不到项目事实 ⇒ `null`。
 *
 * @param projectRoot 项目根（`null`/空 ⇒ `null`：没有上下文就不要假装知道）
 */
export function projectParserExts(projectRoot: string | null | undefined): string[] | null {
  if (!projectRoot) return null;
  const key = path.resolve(projectRoot);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const exts = readExts(key);
  cache.set(key, exts);
  return exts;
}

function readExts(root: string): string[] | null {
  // ★ 纯字符串预检（`projectCacheDbPath` 不查盘）—— 否则 `getProjectCacheDb` 会在没有索引的项目里
  //   造出一个空 cache.db（Windows 上还持有 EBUSY 锁，见 `db.ts` 的 ① 号注释）。
  if (!fs.existsSync(projectCacheDbPath(root))) return null;
  let paths: string[];
  try {
    const rows = getProjectCacheDb(root).prepare('SELECT path FROM files').all() as unknown as Array<{ path: unknown }>;
    paths = rows.map((r) => r.path).filter((p): p is string => typeof p === 'string');
  } catch {
    return null; // 库坏 / 版本不认 / 无读权限 ⇒ 拿不到事实（退回全量，不静默降成 0）
  }
  const exts = new Set<string>();
  for (const p of paths) {
    const ext = extOf(p);
    if (ext && isExtSupported(ext)) exts.add(ext);
  }
  return exts.size > 0 ? [...exts].sort() : null;
}

/** 测试/诊断用：清掉进程内缓存（不碰索引、不碰 Parser 缓存） */
export function clearProjectParserExtsCache(): void {
  cache.clear();
}
