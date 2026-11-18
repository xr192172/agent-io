/**
 * criteria_worker_supervisor.ts —— B1 受管子进程入口。
 *
 * 由 `criteria_worker_pool.ts` 以 `NODE_OPTIONS += --disallow-code-generation-from-strings` 启动。
 * 本进程的**所有 realm**（含 worker_threads 里 new 出来的 fs / path / facts / input 的 constructor）
 * 都禁"从字符串造函数" ⇒ E1/E2/E4 三条宿主对象逃逸当场 `EvalError`。
 *
 * 从 stdin 读一批 `{jobs, concurrency}`，用 worker_threads 池（并发 = concurrency）并发跑，
 * 结果按 id 排序后写 stdout（与 behavior_pool 同形态：调用方按原下标取结果）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

interface Job {
  code: string;
  ctx: { root: string; input: unknown };
  timeoutMs: number;
}

function workerEntry(): { file: string; execArgv: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(here, 'criteria_worker.js');
  if (fs.existsSync(js)) return { file: js, execArgv: [] };
  // ★ src 直跑（tsx）时同目录没有 .js，但 dist/ 里有编译产物 —— tsx 的 .js→.ts 映射
  //   在 worker 线程里不可靠（实测 ERR_MODULE_NOT_FOUND），所以**一律用 dist 的 .js**。
  //   dist 缺失 ⇒ 让调用方走降级（显式标记），不静默换路。
  const dist = path.resolve(here, '../../../../dist/src/application/design/intent/criteria_worker.js');
  if (fs.existsSync(dist)) return { file: dist, execArgv: [] };
  throw new Error(`找不到 criteria_worker 编译产物（既没有 ${js}，也没有 ${dist}）；请先 npm run build`);
}

type Slot = {
  worker: Worker;
  current: { id: number; resolve: (r: unknown) => void; timer: NodeJS.Timeout } | null;
};

async function runPool(jobs: readonly Job[], concurrency: number): Promise<unknown[]> {
  const { file, execArgv } = workerEntry();
  const results: unknown[] = Array.from({ length: jobs.length }, () => undefined);
  let next = 0;
  let activeCount = 0;
  const slots: Slot[] = [];

  const spawn = (): Slot => {
    const worker = new Worker(file, { ...(execArgv.length ? { execArgv } : {}) });
    const slot: Slot = { worker, current: null };
    worker.on('message', (msg: { id?: number; ok?: boolean; value?: unknown; error?: unknown }) => {
      const cur = slot.current;
      if (!cur || msg?.id !== cur.id) return;
      clearTimeout(cur.timer);
      slot.current = null;
      results[cur.id] = msg.ok ? { ok: true, value: msg.value } : { ok: false, error: msg.error };
      pump();
    });
    worker.on('error', (e) => {
      const cur = slot.current;
      if (cur) {
        clearTimeout(cur.timer);
        results[cur.id] = { ok: false, error: { name: 'Error', message: `worker 报错：${e.message}` } };
        slot.current = null;
      }
    });
    slots.push(slot);
    return slot;
  };

  const pump = (): void => {
    while (next < jobs.length) {
      const slot = slots.find((s) => s.current === null) ?? (activeCount < concurrency ? spawn() : undefined);
      if (!slot) return;
      if (activeCount < slots.length) activeCount++;
      const id = next++;
      const job = jobs[id];
      // ★ 外层兜底超时（worker 内 vm 已有 timeout；这里挡 worker 自身卡死 / 起不来）
      const timer = setTimeout(() => {
        if (slot.current?.id === id) {
          results[id] = { ok: false, error: { name: 'Error', message: `worker 求值超时（${job.timeoutMs}ms）` } };
          slot.current = null;
          void slot.worker.terminate();
          pump();
        }
      }, job.timeoutMs + 2000);
      slot.current = { id, resolve: () => undefined, timer };
      slot.worker.postMessage({ id, code: job.code, ctx: job.ctx, timeoutMs: job.timeoutMs });
    }
    if (next >= jobs.length && slots.every((s) => s.current === null)) {
      for (const s of slots) void s.worker.terminate();
    }
  };

  pump();
  // 等所有结果（worker 消息驱动，无 busy-wait）
  while (results.some((r) => r === undefined)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  for (const s of slots) void s.worker.terminate();
  return results;
}

async function main(): Promise<void> {
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  try {
    const { jobs, concurrency } = JSON.parse(raw) as { jobs: Job[]; concurrency: number };
    const results = await runPool(jobs, Math.max(1, Math.min(concurrency, jobs.length || 1)));
    process.stdout.write(JSON.stringify({ results }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}

void main();
