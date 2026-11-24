/**
 * touches: src/application/design/intent/expectations.ts, src/application/design/intent/behavior_pool_worker.ts
 *
 * 行为判据执行池 —— **唯一实现**（2026-11-17，P0「judge-all 全量 <30s」）。
 *
 * ## 为什么需要它（实测，不是设想）
 * `judge-all` 全量 822 条判据实测 **104.0s**，其中 `behavior-cases` 一档就吃掉 **74.6–94.7s**
 * （81 条 × 每条约 921ms；单条最慢 11.3s）。剩下的 10 种 kind 合计不到 4s，三册 → 三次 CLI 启动
 * 合计约 4s。⇒ **「每册一个 spawnSync」不是全量慢的根因**（可核：`AGENTS §三` 挂的读数、
 * 以及本文件写出时的实测分解）。真正贵的是每条 `behavior-cases` 现建一次夹具：
 * 读目标文件 → 转译整条 import 闭包 → `mkdtemp` 铺盘 → 起子进程 → 收 JSON。
 *
 * ## 口径（三条，写死在这里）
 * ① **不另造执行核**：池里跑的仍是 `runHarness` / `runCaseProgram`（同一份实现、同一套 budget），
 *    池只决定**在哪个线程跑**，不决定"怎么判"。
 * ② **并行的单位是「一条判据的夹具建盘 + 起进程」**，不是"判定规则" ⇒ 判据之间的因果关系不变，
 *    verdict 必须**逐条不变**（顺序、四态、detail 全都不许因并行而变 —— 调用方按原下标取结果）。
 * ③ **降级必须响亮**：worker 起不来 / 崩了 ⇒ 退回同线程串行跑同一条判据（**结论不受影响**，
 *    只是慢），并把降级原因记在 `poolDegradedReason()`，由调用方打到 stderr（0.12：读不到 ≠ 没有）。
 *
 * ## 并发度
 * 缺省 `min(8, cpus-1)`（本机 16 逻辑核 ⇒ 8）；`AGENT_IO_JUDGE_CONCURRENCY=1` / `0` ⇒ **完全串行**
 * （消融与排障用：语义应与并行**逐条相同**，只是慢 —— 这条差被 `tests/p1_judge_parallel.test.ts` 钉住）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

/** 池子接受的两类作业：与 `expectations.ts` 的两条 behavior-cases 执行路一一对应（不新增第三种） */
export type PoolJob =
  | { kind: 'harness'; spec: unknown }
  | { kind: 'cases'; input: { projectRoot: string; file: string; symbol: string; cases: unknown[] } };

export type PoolResult = { ok: true; value: unknown } | { ok: false; error: string };

/** 并发度（0/1 ⇒ 串行，不建 worker） */
export function judgeConcurrency(): number {
  const raw = process.env.AGENT_IO_JUDGE_CONCURRENCY;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  // ★ 留一个核给主线程（它自己也在转译/写盘，不是纯等待）
  const cpus = Math.max(1, os.cpus()?.length ?? 1);
  return Math.max(1, Math.min(8, cpus - 1));
}

/** 池子降级的原因（空串 = 没降级）；调用方负责把它打出来（不许静默变慢） */
let degraded = '';
export function poolDegradedReason(): string {
  return degraded;
}

type Slot = {
  worker: Worker;
  /** 该 worker 正在跑的那条作业（null = 空闲） */
  current: { id: number; resolve: (r: PoolResult) => void } | null;
};

let slots: Slot[] = [];
let waiting: Array<{ id: number; job: PoolJob; resolve: (r: PoolResult) => void }> = [];
let seq = 0;
let closed = false;

/**
 * worker 入口的路径：**先找编译产物，再找源码**。
 * ★ 为什么不写死 `.js`：本仓的测试用 tsx 直接跑 `src/*.ts`（不经过 build），那时
 *   同目录下只有 `.ts`；而在 `dist/` 里只有 `.js`。两条路都必须能起来 ——
 *   写死任何一条都会让另一半场景静默降级（"跑得慢"是最难发现的那种坏）。
 */
function workerEntry(): { file: string; execArgv: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const js = path.join(here, 'behavior_pool_worker.js');
  if (fs.existsSync(js)) return { file: js, execArgv: [] };
  const ts = path.join(here, 'behavior_pool_worker.ts');
  if (fs.existsSync(ts)) return { file: ts, execArgv: ['--import', 'tsx'] };
  throw new Error(`找不到 behavior_pool_worker（既没有 ${js}，也没有 ${ts}）`);
}

function markDegraded(why: string): void {
  if (!degraded) degraded = why;
}

function spawnSlot(): Slot | null {
  const { file, execArgv } = workerEntry();
  const worker = new Worker(file, { ...(execArgv.length ? { execArgv } : {}) });
  const slot: Slot = { worker, current: null };
  worker.on('message', (msg: { id?: number; ok?: boolean; value?: unknown; error?: string }) => {
    const job = slot.current;
    if (!job || msg?.id !== job.id) return;
    slot.current = null;
    job.resolve(msg.ok ? { ok: true, value: msg.value } : { ok: false, error: String(msg.error ?? '') });
    pump();
  });
  const die = (why: string): void => {
    markDegraded(why);
    const job = slot.current;
    slot.current = null;
    slots = slots.filter((s) => s !== slot);
    // ★ 崩溃的那一条**不在这里重跑**：交回调用方（它知道该怎么串行兜底），
    //   本模块只负责"说清楚为什么"，不偷偷替它做决定。
    job?.resolve({ ok: false, error: `${why}（这条作业没能跑完）` });
    pump();
  };
  // ★ 只认**当前在册**的 worker：closePool/resetPoolForTest terminate 的旧 worker，其 exit/error
  //   事件可能延迟到池子复位（closed 翻回 false）后才到达 —— 旧 slot 已被 filter 出 slots，
  //   再记账就会把"旧线程退出"误判成"新 worker 崩溃"⇒ 假降级（结论靠兜底串行没变，却白报降级）。
  const alive = (): boolean => slots.includes(slot);
  worker.on('error', (e) => { if (alive()) die(`worker 报错：${e instanceof Error ? e.message : String(e)}`); });
  worker.on('exit', (code) => {
    if (!closed && code !== 0 && alive()) die(`worker 退出码 ${code}`);
  });
  return slot;
}

function pump(): void {
  while (waiting.length) {
    let slot: Slot | undefined = slots.find((s) => s.current === null);
    if (!slot) {
      if (slots.length >= judgeConcurrency()) return;
      let created: Slot | null = null;
      try {
        created = spawnSlot();
      } catch (e) {
        // 起不来 ⇒ 全体降级：把排队的作业原样交回调用方（它会串行跑）
        const why = `worker 起不来 ⇒ 本次全部串行：${e instanceof Error ? e.message : String(e)}`;
        markDegraded(why);
        const pending = waiting;
        waiting = [];
        for (const w of pending) w.resolve({ ok: false, error: why });
        return;
      }
      if (!created) return;
      slot = created;
      slots.push(created);
    }
    const job = waiting.shift();
    if (!job) return;
    slot.current = { id: job.id, resolve: job.resolve };
    // ★ 有活时**必须 ref**：主线程在 await 这条结果，若不 ref，事件循环可能因为
    //   "只剩一个 unref 的 worker"而提前退出（那就成了静默少判）。
    slot.worker.ref();
    slot.worker.postMessage({ id: job.id, ...job.job });
  }
  // 全部空闲 ⇒ unref：让进程能正常退出（judge-all 多处 process.exit，不许被池子挂住）
  for (const s of slots) if (!s.current) s.worker.unref();
}

/** 提交一条作业（不抛：失败也落在 `{ok:false}` 里，由调用方决定兜底） */
export function submit(job: PoolJob): Promise<PoolResult> {
  const n = judgeConcurrency();
  if (n <= 1 || closed) {
    return Promise.resolve({ ok: false, error: '并发度 ≤ 1 ⇒ 由调用方串行执行' });
  }
  return new Promise<PoolResult>((resolve) => {
    waiting.push({ id: ++seq, job, resolve });
    pump();
  });
}

/** 关池（测试与退出钩子用）：终止所有 worker；之后 `submit` 一律返回"串行"+降级原因 */
export function closePool(): void {
  closed = true;
  for (const s of slots) {
    try {
      s.worker.terminate();
    } catch {
      /* 关不掉不改结论 */
    }
  }
  slots = [];
  const pending = waiting;
  waiting = [];
  for (const w of pending) w.resolve({ ok: false, error: '池已关闭 ⇒ 由调用方串行执行' });
}

/** 仅供测试：把池子恢复到"从未创建"的状态（含清空降级原因） */
export function resetPoolForTest(): void {
  closePool();
  closed = false;
  degraded = '';
}
