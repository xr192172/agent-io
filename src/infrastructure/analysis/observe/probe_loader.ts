/**
 * ★★★ 2026-10-28（T-#OBSERVE-6）：**内存插桩 loader 入口** ——
 * ```
 * node --import dist/src/infrastructure/analysis/observe/probe_loader.js <用户程序>
 * ```
 *
 * 两件事：
 * 1. `register()` 挂上 `probe_hooks`（模块加载时把源码**在内存里**插桩，盘上零改动）；
 * 2. `enableObserveFromEnv()` 按 `OBSERVE_EVENTS_FILE` 激活全局 sink（**不设就是 no-op**，天然安全）。
 *
 * ## 为什么是"框架内部"的（对照 T-#OBSERVE-6 的裁定）
 * 它只对**由我们启动的进程**生效（`behavior` 判据 harness / `run_tests`）。受管项目的运行本来经框架
 * ⇒ 用户不必知道它存在；**不做对外启动器**（那是 A，暂不需要）。
 *
 * ## 覆盖范围
 * v1 只插 `.js/.mjs/.cjs`（`.ts` 需宿主 transpiler 配合，另一步）。
 */
import { register } from 'node:module';

import { enableObserveFromEnv } from './run_sentinel.js';

// ① 挂 hooks（把源码在内存里插桩）
//   ★ 直接给 URL 字符串（`register` 认它）—— 别再 `pathToFileURL(url.pathname)`，
//     那会把 `D:/…` 拼成 `D:\D:/…`（实测踩过：ERR_MODULE_NOT_FOUND）。
register(new URL('./probe_hooks.js', import.meta.url).href);

// ② 按 env 激活 sink（没设 OBSERVE_EVENTS_FILE ⇒ 返回 false ⇒ captureProbe 保持 no-op）
enableObserveFromEnv();
