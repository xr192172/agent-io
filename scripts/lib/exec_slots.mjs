#!/usr/bin/env node
/**
 * exec_slots.mjs —— S-EXEC 准入原语底座（§13.12 10.2 / 10.5 / 10.7 / 10.9）。
 *
 * ## 两层准入（对齐 Ninja/jobserver 槽位 + Go semaphore 语义；信任/判定层自研）
 * · **P-CPU 计数信号量**（`createCpuPool`）：只读门 / 隔离临时写 / build-part 入并发槽。
 *   满员 ⇒ 排队等待（CPU 池允许排队）；同时在跑不超过 limit。
 * · **P-DB-WRITE 单写者 mutex**（`createWriteMutex`）：共享可写资源（dist · design-db ·
 *   cache.db · judge-cache · judge-readings）同一时刻只准一个 part。
 *
 * ## 失败语义（10.5，fail-closed，不越预算排队）
 * 写面 acquire 失败 ⇒ **立即抛** `WriteLockBusyError`，点名持有者 part + 资源 + 想要的 part；
 * **不排队、不等待**。当前 part 的回滚由调用方在 catch 里做（变异还原 / 写锁释放 / 快照落账，
 * 见 S-13 cancel point）。进程内 mutex 之外的跨进程排他仍由 `heavy_lock.mjs` 负责（唯一实现）。
 *
 * ## 诊断读数（10.9）
 * 每个池记录 active / waiting / granted / released；门面聚合 `slotDiagnostics()` 进门读数与台账。
 * 计数只描述准入行为，不参与判定。
 *
 * ## 类型标记（10.7）
 * part 节点带 `kind`（build-part / smoke-part / verify-scoped / verify-full / commit /
 * background / mutation）；build-part 一期同 P-CPU 池。池类别由 `gate_caps` 能力表派生，
 * 本模块不自己从命令文本反推。
 *
 * ## 边界（起步值，阈值待探针标定后 Main 另冻结）
 * · CPU limit 起步值不在这里硬冻结；由 S-6 并发档位（10.1）传入。
 * · 本模块是进程内原语；跨进程单写者复用 heavy_lock，不在此重造第二把跨进程锁。
 */

import { POOL } from './gate_caps.mjs';

/** 写面 acquire 失败：立即 fail，点名持有者，不排队。 */
export class WriteLockBusyError extends Error {
  /** @param {{holder:string, holderResource:string, want:string, resource:string}} args */
  constructor(args) {
    super(
      `写面占用冲突：「${args.want}」要写 ${args.resource}，但持有者「${args.holder}」正占用 ${args.holderResource} ` +
        `⇒ 立即失败（不排队）；回滚当前 part 后重试。`,
    );
    this.name = 'WriteLockBusyError';
    this.holder = args.holder;
    this.holderResource = args.holderResource;
    this.want = args.want;
    this.resource = args.resource;
  }
}

/**
 * P-CPU 计数信号量（进程内）。
 * @param {number} limit 并发上限（起步值，S-6 传入）。
 */
export function createCpuPool(limit) {
  const max = Math.max(1, Math.floor(Number(limit) || 1));
  let active = 0;
  let waiting = 0;
  let granted = 0;
  let released = 0;
  /** @type {Array<() => void>} */
  const waiters = [];

  const stats = () => ({ pool: POOL.CPU, max, active, waiting, granted, released });

  /** 取一个 CPU 槽；满员排队等待。返回 release 函数（必须调用）。 */
  async function acquire() {
    if (active >= max) {
      waiting += 1;
      await new Promise((resolve) => waiters.push(resolve));
      waiting -= 1;
    }
    active += 1;
    granted += 1;
    let releasedOnce = false;
    return () => {
      if (releasedOnce) return; // 幂等：重复 release 不重复计数/唤醒
      releasedOnce = true;
      active -= 1;
      released += 1;
      const next = waiters.shift();
      if (next) next();
    };
  }

  return { acquire, stats };
}

/**
 * P-DB-WRITE 单写者 mutex（进程内）。同一时刻只准一个写 part。
 */
export function createWriteMutex() {
  /** @type {{part:string, resource:string} | null} */
  let holder = null;
  let granted = 0;
  let released = 0;

  const stats = () => ({
    pool: POOL.DB_WRITE,
    max: 1,
    active: holder ? 1 : 0,
    waiting: 0, // 写面不排队：失败即抛，没有等待队列
    granted,
    released,
    holder: holder?.part ?? null,
  });

  /**
   * 取写面锁；已被占 ⇒ 立即抛 WriteLockBusyError（不排队）。
   * @param {string} part 当前 part 名（点名用）
   * @param {string} resource 要写的资源类别
   */
  function acquire(part, resource) {
    if (holder) {
      throw new WriteLockBusyError({
        holder: holder.part,
        holderResource: holder.resource,
        want: part,
        resource,
      });
    }
    holder = { part: String(part ?? 'unknown'), resource: String(resource ?? 'db-write') };
    granted += 1;
    let releasedOnce = false;
    return () => {
      if (releasedOnce) return;
      releasedOnce = true;
      holder = null;
      released += 1;
    };
  }

  /** 当前持有者（诊断/点名用）；无则 null。 */
  function currentHolder() {
    return holder ? { ...holder } : null;
  }

  return { acquire, stats, currentHolder };
}

/** part 类型标记（10.7）。build-part 一期同 P-CPU 池。 */
export const PART_KIND = Object.freeze({
  BUILD_PART: 'build-part',
  SMOKE_PART: 'smoke-part',
  VERIFY_SCOPED: 'verify-scoped',
  VERIFY_FULL: 'verify-full',
  COMMIT: 'commit',
  BACKGROUND: 'background',
  MUTATION: 'mutation',
});

/**
 * 准入门面：按能力表的池类别分派到 CPU 池或写面 mutex。
 * @param {{pool:string, writes:string[]}} cap 门/任务能力（gate_caps.capOf）
 * @param {{part:string, kind:string}} ctx part 名与类型标记
 * @param {{cpuPool: ReturnType<typeof createCpuPool>, writeMutex: ReturnType<typeof createWriteMutex>}} slots
 * @returns {Promise<() => void>} release 函数
 */
export async function acquireSlot(cap, ctx, slots) {
  const resource = (cap.writes ?? []).join('+') || cap.pool;
  if (cap.pool === POOL.CPU) return slots.cpuPool.acquire();
  // db-write / heavy 都走单写者 mutex；跨进程排他另由 heavy_lock 兜底。
  return slots.writeMutex.acquire(ctx.part, resource);
}

/** 聚合两池诊断读数（进门读数 / 台账用）。 */
export function slotDiagnostics(slots) {
  return { cpu: slots.cpuPool.stats(), write: slots.writeMutex.stats() };
}
