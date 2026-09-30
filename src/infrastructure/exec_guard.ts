/**
 * exec_guard —— **外部命令可用性守卫**（每进程只判一次，且尽量不 spawn）
 *
 * 为什么需要（2026-09-15 实测根因，一次排查牵出三个"神秘 5 秒"）：
 *   在 Windows 上，spawn 一个**不在 PATH 上**的命令，耗时**约 5.1 秒**
 *   （cmd.exe 启动 + "不是内部或外部命令" 的错误路径），而**不是"立刻失败"**。
 *   于是任何 `execSync('git ...')` 都会在"环境里没有 git"时白等 5 秒：
 *     - `project_root.gitRootOf`  → `resolveProjectRoot` 实测 **5112ms**
 *       ⇒ 下游 `find_references` / `move_symbol` / `harvest_decisions` 各 ~5.2s
 *     - `harvest_decisions.gitLogEntries` → 实测 **5169ms**
 *     - `harvest_from_url` → 实测 **5183ms**
 *   三者叠加把 `tests/server_registry.stale_build.test.ts` 的 5s 超时打爆 ——
 *   测试红，但**根因不是断言，是环境缺 git × spawn 慢失败**。
 *
 * 做法：
 *   ① **先查 PATH 上有没有这个可执行文件**（纯 `fs.existsSync`，微秒级，**完全不 spawn**）；
 *   ② 只有确认存在才 spawn 一次 `--version` 复核（防"装了但坏了"），结果**每进程记忆化**。
 *   ⇒ 命令不存在时，代价从 5.1s 降到 ~0ms，且**只付一次**。
 *
 * 纪律：新增任何 `execSync` 之前先过这个闸；调用方拿到 false 时应当**优雅降级**
 * （返回空结果 + 明确标注），而不是抛错或静默假装成功。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/** 命令名 → 是否可用（含"不存在"的否定结论，避免重复付代价） */
const availability = new Map<string, boolean>();

/** Windows 上依次尝试的可执行扩展名（PATHEXT 优先）。★ 不能含空串：
 *  否则 `path.join(dir, '')` === dir 本身，`findOnPath('')` 会把**目录**误判成"命令存在"。 */
function exeExts(): string[] {
  if (process.platform !== 'win32') return [''];
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return raw.split(';').filter(Boolean);
}

/** 纯文件系统查 PATH（不 spawn；这是本模块"快"的关键） */
export function findOnPath(cmd: string): string | null {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const ext of exeExts()) {
      const p = path.join(d, cmd + ext);
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        /* 权限/坏目录：跳过 */
      }
    }
  }
  return null;
}

/**
 * 命令是否可用。**不存在的结论会被永久缓存**（这是它存在的意义）。
 * @param probeArgs 复核参数（默认 `--version`）；传 `null` 表示"只查 PATH，不复核"
 */
export function commandAvailable(
  cmd: string,
  opts: { probeArgs?: string[] | null; timeoutMs?: number } = {},
): boolean {
  const cached = availability.get(cmd);
  if (cached !== undefined) return cached;

  // ① PATH 快查：不存在 ⇒ 直接否，**一次 spawn 都不发生**
  const found = findOnPath(cmd);
  if (!found) {
    availability.set(cmd, false);
    return false;
  }
  // ② 存在则 spawn 一次复核（装了但坏掉的情况）；只付一次
  const args = opts.probeArgs === undefined ? ['--version'] : opts.probeArgs;
  if (args === null) {
    availability.set(cmd, true);
    return true;
  }
  let ok = false;
  try {
    execSync(`${JSON.stringify(found)} ${args.join(' ')}`, {
      stdio: 'ignore',
      timeout: opts.timeoutMs ?? 3000,
    });
    ok = true;
  } catch {
    ok = false;
  }
  availability.set(cmd, ok);
  return ok;
}

/** git 是否可用（本模块最常见的用途） */
export function gitAvailable(): boolean {
  return commandAvailable('git');
}

/** 测试隔离用：清掉可用性缓存 */
export function clearCommandAvailabilityCache(): void {
  availability.clear();
}
