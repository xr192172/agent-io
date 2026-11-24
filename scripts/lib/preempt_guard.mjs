#!/usr/bin/env node
/**
 * preempt_guard.mjs —— S-13 插队 + 安全点抢占护栏 + 并行降级显形回退（§13.6 S-13 / §13.12 10.8）。
 *
 * ## 安全点（cancel point，契约随 S-5 冻结；本批先落护栏判据）
 * 抢占只准在临界区外的安全点发生。安全点三条件齐备才允许中断当前 part：
 *   ① 变异还原（临时改动已逐字节还原）；② 写锁已释放；③ 快照已落账。
 * 任一不满足 ⇒ 拒绝抢占，点名缺哪一项；不越临界区打断。
 *
 * ## 插队
 * 高优 part 可插队到队头；插队动作仍过安全点守卫——非安全点只入队，不抢占在跑 part。
 *
 * ## 并行降级显形回退（§13.6 S-13）
 * 并行护栏降级（判不了污染者 / 并发不可信等）⇒ 收口结论挂起，要求串行复跑点名；
 * 降级读数显形进门读数与台账；复跑结论与并行结论可对账；**执行层不自行放宽护栏**
 * （未附串行复跑对账 ⇒ 不得判收口通过）。
 *
 * ## 边界（一期）
 * 本模块是纯函数护栏；真实信号中断 / 隔离 worktree 替代复跑由后续批接 S-5 契约落地。
 */

/** 安全点三条件。 */
export const SAFE_POINT = Object.freeze({
  MUTATION_RESTORED: 'mutation-restored',
  WRITE_LOCK_RELEASED: 'write-lock-released',
  SNAPSHOT_BOOKED: 'snapshot-booked',
});

/**
 * 判断当前 part 是否处于可抢占安全点。
 * @param {{mutationRestored?:boolean, writeLockReleased?:boolean, snapshotBooked?:boolean}} point
 * @returns {{ok:boolean, missing:string[]}}
 */
export function canPreempt(point = {}) {
  const missing = [];
  if (!point.mutationRestored) missing.push(SAFE_POINT.MUTATION_RESTORED);
  if (!point.writeLockReleased) missing.push(SAFE_POINT.WRITE_LOCK_RELEASED);
  if (!point.snapshotBooked) missing.push(SAFE_POINT.SNAPSHOT_BOOKED);
  return { ok: missing.length === 0, missing };
}

/**
 * 插队入队。高优插到队头；非安全点只入队排队，不抢占在跑 part。
 * @param {Array<string>} queue 现有队列（part id 顺序）
 * @param {string} part 要插入的 part id
 * @param {{highPriority?:boolean, point?:object}} opts
 * @returns {{queue:string[], preempted:boolean, reason:string}}
 */
export function enqueuePrioritized(queue, part, opts = {}) {
  const next = [...queue];
  if (!next.includes(part)) next.push(part);
  const { highPriority = false, point = {} } = opts;
  if (!highPriority) return { queue: next, preempted: false, reason: '普通优先级：入队尾' };

  const safe = canPreempt(point);
  if (!safe.ok) {
    // 高优但非安全点：入队头等待，不抢占在跑 part。
    const idx = next.indexOf(part);
    next.splice(idx, 1);
    next.unshift(part);
    return { queue: next, preempted: false, reason: `非安全点（缺 ${safe.missing.join('、')}）：排队头等待，不抢占在跑 part` };
  }
  const idx = next.indexOf(part);
  next.splice(idx, 1);
  next.unshift(part);
  return { queue: next, preempted: true, reason: '安全点齐备：高优插队抢占' };
}

/**
 * 记录一次并行降级。收口结论挂起，要求串行复跑点名；执行层不自行放宽。
 * @param {{reason:string, parallelVerdict?:string}} input
 */
export function recordDegradation(input = {}) {
  return {
    degraded: true,
    reason: input.reason ?? '',
    parallelVerdict: input.parallelVerdict ?? null,
    serialRerunVerdict: null,
    serialRerunAttached: false,
  };
}

/**
 * 附串行复跑结论并对账。并行 / 串行 verdict 不一致 ⇒ mismatch 显形（不抹平）。
 * @param {ReturnType<typeof recordDegradation>} record
 * @param {string} serialVerdict
 */
export function attachSerialRerun(record, serialVerdict) {
  const next = { ...record, serialRerunVerdict: serialVerdict, serialRerunAttached: true };
  next.mismatch = record.parallelVerdict != null && record.parallelVerdict !== serialVerdict;
  return next;
}

/**
 * 降级记录是否可进入收口。未附串行复跑对账 ⇒ 不可收口（护栏未解除）；
 * 对账 mismatch ⇒ 不可收口，须先处置分歧。
 * @param {ReturnType<typeof recordDegradation>} record
 */
export function canCloseout(record) {
  if (!record?.degraded) return true;
  if (!record.serialRerunAttached) return false;
  if (record.mismatch) return false;
  return true;
}
