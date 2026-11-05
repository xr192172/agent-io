/**
 * exec_guard —— **外部命令可用性守卫**（每进程只判一次，且尽量不 spawn）
 *
 * 为什么需要（2026-09-15 实测根因，一次排查牵出三个"神秘 5 秒"）：
 *   在 Windows 上，spawn 一个**不在 PATH 上**的命令，耗时**约 5.1 秒**
 *   （cmd.exe 启动 + "不是内部或外部命令" 的错误路径），而**不是"立刻失败"**。
 *   于是任何**经 shell 的** git 调用都会在"环境里没有 git"时白等 5 秒：
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
 * 纪律：新增任何**外部命令调用**之前先过这个闸；调用方拿到 false 时应当**优雅降级**
 * （返回空结果 + 明确标注），而不是抛错或静默假装成功。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

/** npm / npx 的 JS 入口相对它 PATH 位置的偏移（Windows 上它们是 `.cmd` shim） */
const SHIM_JS_CLI: Record<string, string[]> = {
  npm: ['node_modules', 'npm', 'bin', 'npm-cli.js'],
  npx: ['node_modules', 'npm', 'bin', 'npx-cli.js'],
};

/**
 * 把命令名解成「**不经 shell 也能起**」的 `{ file, prefixArgs }`（`spawnSync(file, [...prefixArgs, ...args])`）。
 *
 * 为什么需要它（2026-11-05 实测，P0 命令注入修法的必经一步）：
 *   Windows 上 `npm` / `npx` 只是 `npm.cmd` / `npx.cmd` shim，不是可执行映像
 *   ⇒ `spawnSync('npm', [...], { shell: false })` 直接报 **EINVAL**（Node 对 .bat/.cmd 的硬护栏）。
 *   ⇒ “要么开 shell、要么起不了进程”看起来是死结，而**开 shell 正是命令注入的来源**。
 *   出路：读 shim **旁边**的真 JS 入口，用 `process.execPath` 跑它（实测 `node npm-cli.js --version` ⇒ 0）。
 *   ⇒ argv 逐项传递、shell 全程不参与。
 *
 * @returns `null` = PATH 上找不到这个命令；否则给可直接 execve 的形态。
 */
export function resolveNoShell(cmd: string): { file: string; prefixArgs: string[] } | null {
  const found = findOnPath(cmd);
  if (!found) return null;
  const cliRel = SHIM_JS_CLI[cmd];
  if (cliRel) {
    const cli = path.join(path.dirname(found), ...cliRel);
    if (fs.existsSync(cli)) return { file: process.execPath, prefixArgs: [cli] };
  }
  return { file: found, prefixArgs: [] };
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
    // ★★ 不变量（P0 命令注入）：复核探针也是 **argv 逐项传递**，不拼命令行。
    //   这里曾拼过 `` `${JSON.stringify(found)} ${args.join(' ')}` `` —— `JSON.stringify` 只是加一对引号，
    //   POSIX 双引号内 `$(...)` / 反引号照旧命令替换。
    execFileSync(found, args, {
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
