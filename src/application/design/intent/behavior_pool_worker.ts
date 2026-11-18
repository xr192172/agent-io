/**
 * touches: src/application/design/intent/behavior_pool.ts
 *
 * 行为判据执行池的 **worker 入口**（`behavior_pool.ts` 唯一派活给它的地方）。
 *
 * ## 它只做一件事
 * 在**自己的线程**里跑 `runHarness`（旧形态）或 `runCaseProgram`（steps/effects 形态），把结果回传。
 * ★ 它**不判定**：四态、detail 文案、throws 口径全在 `expectations.ts`（唯一判定处）——
 *   本文件只是"换个线程执行"，不是第二把尺。
 * ★ 为什么值得单开一个线程：一条 `behavior-cases` ≈ 921ms（实测 81 条 74.6–94.7s），
 *   其中绝大部分是**主线程**在转译整条 import 闭包 + 铺 tmp 盘。16 逻辑核的机器上，
 *   串行跑等于 15 个核在旁观。
 */
import { parentPort } from 'node:worker_threads';
import { runHarness } from '../../../infrastructure/authoring/behavior/index.js';
import { runCaseProgram } from './case_program.js';

type Job =
  | { id: number; kind: 'harness'; spec: unknown }
  | {
      id: number;
      kind: 'cases';
      input: { projectRoot: string; file: string; symbol: string; cases: unknown[] };
    };

parentPort?.on('message', (job: Job) => {
  const post = (payload: Record<string, unknown>): void => parentPort?.postMessage({ id: job.id, ...payload });
  void (async () => {
    try {
      if (job.kind === 'harness') {
        // ★ 旧形态：一条判据的 N 个 case **一次起进程**（与串行路径逐字相同）
        post({ ok: true, value: { kind: 'harness', run: runHarness(job.spec as never) } });
        return;
      }
      if (job.kind === 'cases') {
        const results: unknown[] = [];
        for (const c of job.input.cases) {
          results.push(
            await runCaseProgram({
              projectRoot: job.input.projectRoot,
              file: job.input.file,
              symbol: job.input.symbol,
              testCase: c as never,
            }),
          );
        }
        post({ ok: true, value: { kind: 'cases', results } });
        return;
      }
      post({ ok: false, error: `未知作业 kind=${String((job as { kind?: unknown }).kind)}` });
    } catch (e) {
      // ★ 抛错**不在这里解释成 verdict**：交回主线程（0.12：判不了 ≠ 违反，怎么记账由判定处说）
      post({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
});
