#!/usr/bin/env node
/**
 * concurrency_policy.mjs —— S-6 自适应并发档位策略（§13.6 S-6 / §13.12 10.1）。
 *
 * ## 职责
 * 三输入（RSS 内存 / 打开句柄 / 温度电源）联合定档；分层预算（轻量 / 重量）；子进程退出分类
 * （OOM / kill 信号 / 断言失败 / crash 分流，互不混淆）；退避环防止档位抖动。
 *
 * ## 边界（起步值，阈值待探针标定后 Main 另冻结；本批不自行冻结阈值）
 * · `MAX_JOBS` 起步 4（§13.12 10.1：jobs≤4 起步）；`MIN_JOBS=1` 下限保护（永不降到 0 / 永不并发 0）。
 * · 占用比阈值是**起步占位**：RSS/句柄越线即降档；真实拐点待各门类资源基线探针标定。
 * · 温度输入在 Windows 本机读不到时按「未知 ⇒ 保守不加分」处理，不报错、不放纵。
 * · 本模块是纯函数策略；实际子进程池在 run-tests / exec_slots，本模块不 spawn。
 */

import { POOL } from './gate_caps.mjs';

/** 起步并发上限（待探针标定，不冻结）。 */
export const MAX_JOBS = 4;
/** 并发下限保护：永不低于 1。 */
export const MIN_JOBS = 1;

/** 起步占用比阈值（占位，待探针标定）。 */
const RSS_HIGH_RATIO = 0.85; // RSS / 内存上限 ≥ 此值 ⇒ 内存紧张
const HANDLES_HIGH_RATIO = 0.85; // 句柄 / 句柄上限 ≥ 此值 ⇒ 句柄紧张

/**
 * 环境读数（调用方注入；读不到给 null，策略按未知保守处置）。
 * @typedef {Object} EnvReading
 * @property {number} [rssMb] 当前进程 RSS（MB）
 * @property {number} [rssLimitMb] RSS 上限（MB）；缺省不判内存
 * @property {number} [openHandles] 当前打开句柄数
 * @property {number} [handleLimit] 句柄上限；缺省不判句柄
 * @property {number} [tempC] 温度（℃）；缺省 = 未知
 */

/**
 * 定档：返回建议并发数 + 降级原因。
 * @param {{kind?: string, pool?: string, requested?: number, env?: EnvReading}} input
 * @returns {{jobs:number, degraded:boolean, reasons:string[]}}
 */
export function planJobs(input = {}) {
  const { kind = '', pool = '', requested, env = {} } = input;
  const reasons = [];

  // 重量门类起步单并发（重活排他，对齐 gate_caps HEAVY）。
  if (pool === POOL.HEAVY || kind === 'heavy') {
    return { jobs: 1, degraded: true, reasons: ['重量门类起步单并发（HEAVY 排他）'] };
  }

  let jobs = Math.max(MIN_JOBS, Math.min(MAX_JOBS, Math.floor(Number(requested) || MAX_JOBS)));

  // RSS 联合判档。
  if (env.rssMb != null && env.rssLimitMb != null && env.rssLimitMb > 0) {
    const ratio = env.rssMb / env.rssLimitMb;
    if (ratio >= RSS_HIGH_RATIO) {
      jobs = Math.min(jobs, 1);
      reasons.push(`RSS 占用 ${(ratio * 100).toFixed(0)}% ≥ ${RSS_HIGH_RATIO * 100}% ⇒ 降到下限`);
    } else if (ratio >= RSS_HIGH_RATIO - 0.15) {
      jobs = Math.min(jobs, 2);
      reasons.push(`RSS 占用偏高 ${(ratio * 100).toFixed(0)}% ⇒ 降到 2`);
    }
  }

  // 句柄联合判档。
  if (env.openHandles != null && env.handleLimit != null && env.handleLimit > 0) {
    const ratio = env.openHandles / env.handleLimit;
    if (ratio >= HANDLES_HIGH_RATIO) {
      jobs = Math.min(jobs, 1);
      reasons.push(`句柄占用 ${(ratio * 100).toFixed(0)}% ≥ ${HANDLES_HIGH_RATIO * 100}% ⇒ 降到下限`);
    }
  }

  // 温度未知不加分也不降级；读得到且过热由调用方另按探针口径处理（起步占位）。

  jobs = Math.max(MIN_JOBS, Math.min(MAX_JOBS, jobs));
  const degraded = reasons.length > 0 || jobs < MAX_JOBS;
  return { jobs, degraded, reasons };
}

/**
 * 子进程退出分类（fail-closed，信号 / OOM 与断言失败分流，互不混淆）。
 * @param {{status:number|null, signal?:string|null, killed?:boolean, errorMessage?:string}} exit
 * @returns {'assert-fail'|'oom-kill'|'signal-kill'|'crash'|'ok'}
 */
export function classifyExit(exit = {}) {
  const { status, signal, killed, errorMessage = '' } = exit;

  // 被信号杀死：SIGKILL / killed=true / OOM 特征（先于 crash 判，避免被 null status 吞掉）。
  if (killed || signal === 'SIGKILL' || signal === 'SIGTERM' || signal === 'SIGABRT') {
    if (/oom|out of memory|heap|killed process|内存/i.test(errorMessage)) return 'oom-kill';
    return 'signal-kill';
  }
  if (/oom|out of memory|javascript heap/i.test(errorMessage)) return 'oom-kill';

  // 没跑起来（spawn 失败 / status=null）⇒ crash，不算断言失败。
  if (status === null || status === undefined) return 'crash';

  if (status === 0) return 'ok';
  // 非零退出且有信号未归类 ⇒ 断言失败由调用方按 TAP 判；这里 status 非 0 默认 assert-fail。
  return 'assert-fail';
}

/**
 * 退避环：档位不随单次读数抖动。连续 `downRuns` 次紧张才降；恢复需 `upRuns` 次空闲才升。
 * 一期保守实现：返回下一档建议是否允许上调。
 * @param {{consecutiveTight:number, consecutiveRelaxed:number}} history
 * @param {number} downRuns 连续紧张降档阈值（起步 1 = 见紧即降，保守）
 * @param {number} upRuns 连续空闲回升阈值（起步 2 = 回升需两次空闲，防抖）
 */
export function allowUpscale(history = {}, upRuns = 2) {
  return Number(history.consecutiveRelaxed ?? 0) >= Math.max(1, upRuns);
}
