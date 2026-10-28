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

export function probeRunEnv(root?: string): NodeJS.ProcessEnv | undefined {
  // ★ 总开关：观测是增强能力，必须能一键关掉
  if (process.env.AGENT_IO_PROBE_OFF === '1') return undefined;
  try {
    const loader = probeLoaderPath();
    if (!fs.existsSync(loader)) return undefined;
    const projectRoot = root ?? process.cwd();
    const dir = path.join(projectRoot, '.agent', 'observe');
    fs.mkdirSync(dir, { recursive: true });
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
