/**
 * criteria_worker.ts —— `run` 判据求值的 **worker 线程入口**（B1）。
 *
 * ## 它做什么
 * 收到 `{id, code, ctx}`（ctx = 可结构化复制的最小上下文：`root` / `input`），在**本线程**里
 * 重建与 `case 'run'` 逐字相同的求值域（fs / path / validateDSL / facts 都在这里 new 出来，
 * 因此它们的 `.constructor` 就是**本线程 realm** 的 `Function`），然后用 `vm.runInNewContext`
 * + `contextCodeGeneration: { strings: false, wasm: false }` 求值。
 *
 * ## 为什么这里能挡住 E1/E2/E4（宿主 realm constructor 边界根治）
 * 本 worker 跑在**带 `--disallow-code-generation-from-strings` 的进程**里（`criteria_worker_pool.ts`
 * 以 `NODE_OPTIONS` 启动 supervisor 子进程 ⇒ 该进程的**所有 realm** 都禁"从字符串造函数"）。
 * 于是 `input.constructor.constructor("return this")` / `fs.readFileSync.constructor("return this")` /
 * `path.join.constructor("return this")` 这三条的 `F(...)` 会直接抛
 * `EvalError: Code generation from strings disallowed for this context` —— 不再是宿主 Function。
 * ★ 这不是"加词"，是**换 realm 边界**：any object created inside this worker is governed by the flag.
 *
 * ## 不做什么
 * 不判定四态（pass/fail/unsupported/pending 全在主线程 `expectations.ts`），本文件只回传
 * `{ok:true, value}` 或 `{ok:false, error}`（与 `behavior_pool_worker.ts` 协议一致）。
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';

import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { createJudgeFacts, READ_ONLY_FS, type JudgeFacts } from './judge_facts.js';
import { indexStaleFor } from './expectations.js';
// ★ validateDSL 不在 worker 里 import：它依赖 Ajv JIT（new Function），在 flag 进程里加载即抛。
//   含 validateDSL 的判据由主线程走 vm 回退（带降级标记），见 expectations.ts#evalRunExpect。

// ★ fs in sandbox must use worker-created bindings; READ_ONLY_FS imported above is created in worker realm.
//   重建 facts：worker 自己开 DB（node:sqlite 内置，支持多连接），口径与主线程 `prepareJudgeFactsForRun` 相同。
function makeFacts(root: string): JudgeFacts {
  const dbPath = path.join(root, '.agent-io', 'cache.db');
  if (!fs.existsSync(dbPath)) {
    return createJudgeFacts(root, {
      db: null,
      staleOf: () => '该项目还没有符号索引（`.agent-io/cache.db` 不存在）⇒ 判不了；修法：跑一次 `import_project`',
    });
  }
  return createJudgeFacts(root, {
    db: getProjectCacheDb(root),
    staleOf: (rel) => indexStaleFor(root, [rel]),
  });
}

type Job = { id: number; code: string; ctx: { root: string; input: unknown }; timeoutMs: number };

parentPort?.on('message', (job: Job) => {
  const post = (payload: Record<string, unknown>): void => parentPort?.postMessage({ id: job.id, ...payload });
  try {
    const { code, ctx } = job;
    const sandbox: Record<string, unknown> = Object.create(null);
    sandbox.input = ctx.input;
    sandbox.root = ctx.root;
    sandbox.validateDSL = () => {
      throw Object.assign(new Error('validateDSL 在隔离 worker 中不可用（Ajv JIT 被 flag 禁用）；应由主线程 vm 回退处理'), {
        name: 'CriteriaWorkerUnsupportedError',
      });
    };
    sandbox.fs = READ_ONLY_FS;
    sandbox.path = path;
    sandbox.facts = makeFacts(ctx.root);
    sandbox.Buffer = Buffer;
    const value = vm.runInNewContext(code, sandbox, {
      filename: 'run.expect',
      timeout: job.timeoutMs,
      contextCodeGeneration: { strings: false, wasm: false },
    });
    post({ ok: true, value });
  } catch (e) {
    // ★ 错误按主线程 `isCodeGenerationRefused` 认识的形状回传（name + message，跨线程构造器不同）
    const err = e as Error & { name?: string };
    post({ ok: false, error: { name: err?.name ?? 'Error', message: err?.message ?? String(e) } });
  }
});
