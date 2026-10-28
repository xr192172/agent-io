/**
 * ★★★ 2026-10-28（T-#KIND-2）：**"我们起的子进程"统一 env 提供者**（从 `authoring/behavior/index.ts` 搬来）。
 *
 * ## 为什么搬
 * 它不是 harness 的私有逻辑，而是**跨切面能力**：任何由我们 spawn 的进程
 * （L2 判据 harness、`run_tests`、将来的 `run` 入口）都该用同一份规则。
 * 放在 harness 文件里 ⇒ 第二个使用者要么 import 一个"别人的文件"，要么**抄一份**（本仓头号病）。
 *
 * ## 行为
 * · 注入 `--import <probe_loader.js>`（**内存插桩**，源码零改动）；
 * · 事件落 `<root>/.agent/observe/events-<ts>.jsonl`（`runtime` 判据零配置自动发现的目录）；
 * · 排除框架自身 dist（否则会插桩探针本体 —— 自伤）；
 * · ★ **任何一步拿不到 ⇒ 返回 `undefined`**，调用方按原样 spawn（观测是增强，不许让判据跑不起来）；
 * · ★ 总开关 `AGENT_IO_PROBE_OFF=1` ⇒ 直接返回 `undefined`（排查"观测是否把判据弄挂了"的对照组）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本模块所在目录（`dist/src/infrastructure/analysis/observe`）—— 不用 `../..` 手算式推断 */
export const OBSERVE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** loader 位置（命名常量：别在调用点拼路径） */
export function probeLoaderPath(): string {
  return path.join(OBSERVE_DIR, 'probe_loader.js');
}

/** 框架自身的 dist 根（要在插桩里排除，否则会自伤） */
export function frameworkDistRoot(): string {
  // dist/src/infrastructure/analysis/observe → dist
  return path.resolve(OBSERVE_DIR, '..', '..', '..', '..');
}

/**
 * ★★★ 2026-10-28（T-#OBSERVE-7 · 用户："测试数据要不要也随项目走"）：**事件文件保留策略**。
 *
 * 归属：运行时事件是**项目的事实** ⇒ 落在 `<project>/.agent/observe/`（随项目走，判据零配置从这读）；
 * 但它**每跑一次一套、带时间戳** ⇒ 会无限增长。本仓 `.gitignore` 早已把 `.agent/` 排除（运行时数据不入库），
 * 所以脏不到 git，但**磁盘会脏**。
 *
 * 策略：只留**最近 N 份** `events-*.jsonl`（默认 20，`AGENT_IO_EVENTS_KEEP` 可调）；
 * ★ **只碰这个命名模式**（不删 `dsl.json` / 别人放进去的任何东西）；
 * ★ 清理失败**不影响**本次观测（best-effort，绝不因为它让 spawn 失败）。
 */
export function pruneEvents(dir: string, keepRaw?: string): void {
  try {
    const keep = Math.max(1, Number(keepRaw ?? process.env.AGENT_IO_EVENTS_KEEP ?? 20) || 20);
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^events-.*\.jsonl$/.test(f))
      .map((f) => {
        const p = path.join(dir, f);
        return { p, m: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.m - a.m);
    for (const stale of files.slice(keep)) {
      try {
        fs.rmSync(stale.p, { force: true });
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* best-effort：清理失败不影响观测 */
  }
}

export function probeRunEnv(root?: string): NodeJS.ProcessEnv | undefined {
  // ★ 总开关：观测是增强能力，必须能一键关掉
  if (process.env.AGENT_IO_PROBE_OFF === '1') return undefined;
  try {
    const loader = probeLoaderPath();
    if (!fs.existsSync(loader)) return undefined;
    const projectRoot = root ?? process.cwd();
    const dir = path.join(projectRoot, '.agent', 'observe');
    fs.mkdirSync(dir, { recursive: true });
    // ★ 先按保留策略清理旧的（只碰 events-*.jsonl），再落新文件
    pruneEvents(dir);
    const events = path.join(dir, `events-${Date.now()}.jsonl`);
    const prev = process.env.NODE_OPTIONS ?? '';
    return {
      ...process.env,
      // ★ Windows：`--import` 只认 file:// URL
      NODE_OPTIONS: `${prev} --import ${new URL(`file://${loader.replace(/\\/g, '/')}`).href}`.trim(),
      OBSERVE_EVENTS_FILE: events,
      AGENT_IO_PROBE_ROOT: projectRoot,
      AGENT_IO_PROBE_EXCLUDE: [process.env.AGENT_IO_PROBE_EXCLUDE, frameworkDistRoot()].filter(Boolean).join(path.delimiter),
    };
  } catch {
    return undefined;
  }
}
