#!/usr/bin/env node
/**
 * ★★★ 2026-10-28（T-#OBSERVE-8）：**观测入口** —— 采一轮运行时事件，让 L3 判据在新环境也能变绿。
 *
 * ## 为什么需要它
 * `runtime` 判据（L3）判的是**事件流**，而事件是**派生物**（`<root>/.agent/observe/` 不入 git）。
 * ⇒ 新 clone / CI 上，`runtime` 判据只能是 `unsupported`（"判不了"）。
 * `unsupported` **不是通过**（这点必须保持），但它也不该是个死局 ——
 * 这个入口就是"**先采一轮**"的那一步。
 *
 * ## 用法
 * ```
 * npm run observe:collect -- node --test --import tsx tests/p0_discussion_micro.test.ts
 * npm run observe:collect -- node scripts/run-tests.mjs
 * ```
 * 行为：
 * · 用 `probeRunEnv(root)` 起子进程（**我们起的进程** ⇒ 才谈得上零污染插桩）；
 * · 事件落到 `<root>/.agent/observe/events-<ts>.jsonl`（`runtime` 判据零配置自动发现的就是它）；
 * · **子进程退出码原样透传**（它是"跑测试"的入口，不能把失败吞成成功）；
 * · 拿不到 loader / 注入失败 ⇒ 退化成"直接跑那条命令"（观测是增强，不许阻断）。
 *
 * ## 边界（诚实清单）
 * · 只覆盖 Node 进程（`.js/.mjs/.cjs`）—— 其它语言要各自的机制（Go `-overlay` 等，未做）；
 * · 只观测 `dist` 之外的代码（探针层自身的依赖闭包还没排除，见 `run_env.probeLayerRoot`）；
 * · **[未核]** 不敢承诺"事件一定够判"：跑的命令若没触到目标函数，`runtime` 判据仍会 `unsupported`。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.AGENT_IO_PROBE_ROOT || process.cwd();
const argv = process.argv.slice(2).filter((a) => a !== '--');
if (!argv.length) {
  console.error('用法：npm run observe:collect -- <cmd> [args...]');
  process.exit(2);
}

const runEnvMod = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist/src/infrastructure/analysis/observe/run_env.js');
let env;
try {
  const m = await import(new URL(`file://${runEnvMod.replace(/\\/g, '/')}`).href);
  env = m.probeRunEnv(ROOT);
} catch (e) {
  console.error(`[observe:collect] 拿不到 run_env（${(e && e.message) || e}）⇒ 退化为直接运行（观测是增强）`);
}
if (!env) console.error('[observe:collect] 未注入插桩（拿不到 loader / 已关）⇒ 直接运行，不会有事件');

const [cmd, ...args] = argv;
const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: env ?? process.env, windowsHide: true });

const events = env?.OBSERVE_EVENTS_FILE;
if (events && fs.existsSync(events)) {
  const n = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).length;
  console.error(`[observe:collect] 事件 ${n} 条 → ${path.relative(ROOT, events)}`);
} else if (events) {
  console.error('[observe:collect] 没有产生事件（命令可能没触到被插桩代码）');
}

process.exit(r.status ?? 1);
