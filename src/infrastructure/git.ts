/**
 * git —— 闭环 git 封装（基线快照 / 精确提交 / 回退）
 *
 * 一键诊断闭环的持久化边界：只用四个只读/精确操作，不在闭环外做
 * 任何破坏性 git 动作。
 *   - 基线快照：改前把当前工作区改动提交为 baseline（改前自动提交）
 *   - 精确提交：只 add 补丁实际改动的文件（不用 git add -A，防误入敏感文件）
 *   - 回退：验收失败时 git checkout 还原补丁改动的文件
 *
 * ★★ 不变量（P0 命令注入，2026-11-05）：**一切 git 调用走 argv 数组，永不经 shell。**
 *   为什么不是"给路径加引号"：`files` 来自被分析的仓库（恶意文件名可以是 `$(id)` / 反引号 / `a&calc`），
 *   `message` 来自调用方 —— 它们一旦拼进命令行，就会被 sh / cmd.exe 当成**第二条命令**执行。
 *   双引号挡不住 POSIX 的 `$()` 与反引号；`JSON.stringify` 也不挡（它只是"加一对引号"）。
 *   ⇒ 唯一站得住的修法是**不让任何解释器看到这些字符**：`execFileSync(cmd, argv)`（shell 默认 false）。
 *   判据：tests/p0_shell_injection.test.ts
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 跑一条 git 子命令。参数逐项传递（见文件头「不变量」）。 */
function run(dir: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe', timeout: 120_000 });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: (e as Error).message };
  }
}

/**
 * ★★★ card-git-guard（2026-11-18）：**仓根守卫** —— 写类操作（commit/checkout）前，
 *   `dir` 必须本身就是仓库根（`rev-parse --show-toplevel` 归一后 === dir）。
 *
 * 病（三次实测污染真仓 HEAD）：git 的 cwd **向上走查** —— dir 不是仓库根时，
 *   `git add -A` / `git commit -m <msg>` 会落进**祖先仓**（`add -A` 无 pathspec 时暂存全仓）。
 *   实测事故：测试把 tmpDir 建在真仓树内（`.agent-io/scratch/tmp/agentio-p0-inj-gitmsg-*`）
 *   ⇒ 注入 payload 作为提交信息被真分支收下三次（lQ6UHW / JcUYZ4 / S8ZiVe）。
 *
 * ★ 口径**不许**降级成 `--is-inside-work-tree`：那只回答"在不在仓里"，恰好挡不住祖先仓污染。
 * 归一用 `fs.realpathSync.native`（解 8.3 短名如 `ADMINI~1`）+ 小写 + 正斜杠 + 去尾分隔符。
 * ★ 失败形态 = **软失败**（返回拒绝原因，调用方既有 `committed:false` 分支原样消化）——
 *   生产调用方（diagnose_loop / upgrade）不接 throw，拒绝原因照样进回执不静默。
 */
function requireSelfRepo(dir: string, op: string): string | null {
  const abs = path.resolve(dir);
  const t = run(abs, ['rev-parse', '--show-toplevel']);
  if (!t.ok) {
    return `[git-guard] ${op} 拒绝：dir 不是 git 仓库（${dir}）——git 会向上走查把操作落进祖先仓；先在 dir 上 git init`;
  }
  const norm = (p: string): string => {
    let r = p;
    try { r = fs.realpathSync.native(r); } catch { /* 解不了就按原文比 */ }
    return r.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  };
  if (norm(abs) !== norm(t.out)) {
    return `[git-guard] ${op} 拒绝：dir 不是仓库根（dir=${dir} · toplevel=${t.out}）——在仓库内子目录/临时目录上提交会把 add -A 打到祖先仓（实测三次污染真仓 HEAD）；dir 应为仓库根本身，临时目录请先 git init`;
  }
  return null;
}

export function isGitRepo(dir: string): boolean {
  return run(dir, ['rev-parse', '--is-inside-work-tree']).ok;
}

export interface GitStatus {
  modified: string[];
  untracked: string[];
}

export function gitStatus(dir: string): GitStatus {
  const mod = run(dir, ['diff', '--name-only']);
  const unt = run(dir, ['ls-files', '--others', '--exclude-standard']);
  return {
    modified: mod.ok ? mod.out.split(/\r?\n/).filter(Boolean) : [],
    untracked: unt.ok ? unt.out.split(/\r?\n/).filter(Boolean) : [],
  };
}

export function gitDirty(dir: string): boolean {
  const s = gitStatus(dir);
  return s.modified.length > 0 || s.untracked.length > 0;
}

/**
 * ★ P2 只读快照：恢复 / `git_observed` 边界观察复用的唯一读数处。
 *
 * 三态诚实：git 不可读（不是仓 / 命令失败 / 无基线）⇒ `git_ok=false`、`head=null`、`reason` 写明，
 * **不把空集当干净**（约束 9）。`dirty` 由既有 {@link gitStatus} 口径派生（未暂存 modified + 未跟踪）。
 */
export interface GitSnapshot {
  git_ok: boolean;
  head: string | null;
  dirty: boolean;
  modified: string[];
  untracked: string[];
  reason: string | null;
}

export function gitSnapshot(dir: string): GitSnapshot {
  const head = run(dir, ['rev-parse', 'HEAD']);
  if (!head.ok) {
    return { git_ok: false, head: null, dirty: false, modified: [], untracked: [], reason: head.out };
  }
  const status = gitStatus(dir);
  return {
    git_ok: true,
    head: head.out,
    dirty: status.modified.length > 0 || status.untracked.length > 0,
    modified: status.modified,
    untracked: status.untracked,
    reason: null,
  };
}

/** 精确提交指定文件（只用被补丁改过的文件，不用 -A） */
export function gitCommitFiles(dir: string, files: string[], message: string): { committed: boolean; out: string } {
  if (files.length === 0) return { committed: false, out: '无文件可提交' };
  const guardF = requireSelfRepo(dir, 'gitCommitFiles');
  if (guardF) return { committed: false, out: guardF };
  const add = run(dir, ['add', '--', ...files]);
  if (!add.ok) return { committed: false, out: add.out };
  const commit = run(dir, ['commit', '-m', message]);
  return commit.ok ? { committed: true, out: commit.out } : { committed: false, out: commit.out };
}

/** 基线快照：git add -A 全量暂存后提交（改前自动提交） */
export function gitCommitAll(dir: string, message: string): { committed: boolean; out: string } {
  const guardA = requireSelfRepo(dir, 'gitCommitAll');
  if (guardA) return { committed: false, out: guardA };
  const add = run(dir, ['add', '-A']);
  if (!add.ok) return { committed: false, out: add.out };
  const commit = run(dir, ['commit', '-m', message]);
  return commit.ok ? { committed: true, out: commit.out } : { committed: false, out: commit.out };
}

/** 回退：git checkout 还原指定文件（验收失败时用） */
export function gitRestoreFiles(dir: string, files: string[]): { ok: boolean; out: string } {
  if (files.length === 0) return { ok: true, out: '无需回退' };
  const guardR = requireSelfRepo(dir, 'gitRestoreFiles');
  if (guardR) return { ok: false, out: guardR };
  return run(dir, ['checkout', '--', ...files]);
}
