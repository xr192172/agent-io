/**
 * criteria_worker_pool.ts —— B1：`run` 判据求值的**隔离执行池**（宿主 realm constructor 边界根治）。
 *
 * ## 裁定落地形态
 * 常驻 worker（首次求值时懒启动、模块级单例）跑全部 `run` 判据求值；
 * 池子并发 = `max(1, floor(cpus/2))`（与 `behavior_pool.ts` 形态对齐）；
 * 消息协议 `{code, ctx} → {verdict, error}`；求值 3s 超时（与 `RUN_EXPECT_TIMEOUT_MS` 对齐）。
 *
 * ## ★ Node 22.18.0 的实现偏差（必须如实记）
 * 任务书原文写的是 `new Worker(entry, { execArgv: ['--disallow-code-generation-from-strings'] })`，
 * 但 **Node 22.18.0 把这条 flag 列为 process-level V8 flag，拒绝放进 Worker.execArgv**
 * （实测 `ERR_WORKER_INVALID_EXEC_ARGV`；`v8.setFlagsFromString` 在运行时也来不及）。
 * ⇒ 等价结构落地：先起一个**带该 flag 的受管子进程**（`fork` + `NODE_OPTIONS`），
 *   在它内部再开 `worker_threads` 池（子进程内所有 realm 都继承 flag，含 worker 自己 new 的宿主对象）。
 *   效果与裁定一致：E1/E2/E4 三条 `.constructor` 逃逸在该进程内全部抛 `EvalError`。
 *
 * ## 降级边界（响亮，不静默旁路）
 * 子进程 / worker 起不来（受限环境、flag 被拒）⇒ 落回 `vm.runInNewContext` 路径，
 * 并通过 `criteriaPoolDegradedReason()` 报出原因（调用方把它写进 `unsupported` 报文）——
 * **能力降级声明**，不是"判不了 = 通过"，也不是静默换路。
 *
 * ## 同步桥
 * `evalRunExpect` 是同步 API（测试与判定链直接调用），Node 没有 parent↔child 的同步 IPC。
 * 本池用 `spawnSync` 起受管子进程做**一次批量求值**：`judgeExpectations` 把一批 run 判据一次提交，
 * 子进程内部用 worker_threads 池并发跑，结果按 id 顺序回传（与 `behavior_pool` 同形态）。
 * 单条直接调用（`evalRunExpect`）走同一条桥的 size=1 形态。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RunEvalJob {
  code: string;
  ctx: { root: string; input: unknown };
  timeoutMs: number;
}

export type RunEvalResult = { ok: true; value: unknown } | { ok: false; error: { name: string; message: string } };

/** 并发度 = cpus 一半（与 behavior_pool 对齐，留一半核给主进程） */
export function criteriaConcurrency(): number {
  return Math.max(1, Math.floor(Math.max(1, os.cpus()?.length ?? 1) / 2));
}

/** 最近一次降级原因（空串 = 没降级）；调用方负责把它打进 unsupported 报文 */
let degraded = '';
export function criteriaPoolDegradedReason(): string {
  return degraded;
}
export function clearCriteriaPoolDegraded(): void {
  degraded = '';
}

/** supervisor 入口：优先 dist 的 .js，再退到 src 的 .ts（与 behavior_pool 的 workerEntry 同形） */
function supervisorEntry(): { file: string; pre: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(here, 'criteria_worker_supervisor.js');
  if (fs.existsSync(js)) return { file: js, pre: [] };
  const ts = path.join(here, 'criteria_worker_supervisor.ts');
  if (fs.existsSync(ts)) return { file: ts, pre: ['--import', 'tsx'] };
  throw new Error(`找不到 criteria_worker_supervisor（既没有 ${js}，也没有 ${ts}）`);
}

/**
 * 在**带 flag 的受管子进程**里跑一批求值（同步桥）。
 * ★ 不抛：起不来 / 崩了 ⇒ 返回 `{ degraded: why }`，由调用方决定要不要落回 vm。
 */
export function evaluateInIsolation(
  jobs: readonly RunEvalJob[],
): { results: RunEvalResult[]; degraded: string } | null {
  try {
    const { file, pre } = supervisorEntry();
    const env = { ...process.env };
    env.NODE_OPTIONS = ((env.NODE_OPTIONS ?? '') + ' --disallow-code-generation-from-strings').trim();
    const payload = JSON.stringify({ jobs, concurrency: criteriaConcurrency() });
    const r = spawnSync(process.execPath, [...pre, file], {
      input: payload,
      encoding: 'utf8',
      env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: Math.max(30_000, jobs.length * 5_000),
    });
    if (r.error) return { results: [], degraded: `worker 起不来：${r.error.message}` };
    if (r.status !== 0 || !r.stdout?.trim()) {
      return { results: [], degraded: `worker 进程退出码 ${r.status}：${String(r.stderr ?? '').slice(0, 300)}` };
    }
    const parsed = JSON.parse(r.stdout) as { results?: RunEvalResult[]; error?: string };
    if (parsed.error || !Array.isArray(parsed.results) || parsed.results.length !== jobs.length) {
      return { results: [], degraded: `worker 回执异常：${parsed.error ?? '条数不符'}` };
    }
    degraded = '';
    return { results: parsed.results, degraded: '' };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { results: [], degraded: `worker 桥失败：${why}` };
  }
}
