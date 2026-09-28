/**
 * tests/helpers/gate_probe.ts —— 「门的出生证」共享 helper（**唯一实现**）
 *
 * 由来（规划书 §4.11 / §9.1）：
 *   「门全绿」不等于「门有效」。P1c 新门 7 项全绿，逐个制造它能抓的错才发现
 *   **6 条里有 1 条是恒真的空门**。所以每扇新门都必须做出生证：
 *   注入一个"它本该抓到"的错 → 跑门 → 断言门**变红** → 还原。
 *
 *   原先的做法是**每扇门写一个一次性探针脚本**（`.inspect/probe_*.mjs`）——
 *   那就是"同一种活各写一遍"，正是本项目要消灭的东西。
 *   ⇒ 抽成这一步：各门只声明「注入什么、跑什么、怎么算红、怎么还原」。
 *
 * ★ 本 helper 的**唯一一条硬纪律**：**必定还原**。
 *   还原放在 `finally` 语义里执行 —— **注入失败、跑门抛错、断言失败**，
 *   三种情况都照还原。否则一次失败会**污染工作区**，让后续测试连环红，
 *   而"红的原因"与"真正的错"彻底脱钩（本仓有过这种连环红）。
 *   另加 `process.on('exit')` 兜底：万一中途进程被结束，退出时仍会尽力还原。
 *
 * ★ 两种用法（都覆盖"注入 → 跑门 → 断言 → **必定还原**"）：
 *   - `expectGateGoesRed({...})`：注入一个**门本该抓到**的错 ⇒ 断言门**变红**。
 *   - `expectGateStaysGreen({...})`：注入一个**门本不该抓到**的对照项 ⇒ 断言门**不变红**。
 *     （§4.11 要求探针必须带对照项，否则你不知道自己的断言到底在抓什么。）
 *
 * ★ 用法约定（别把它当哑工具用）：
 *   - `run` 只**执行门的判定并返回结果**，**不要**在里面断言 —— 断言交给 `isRed`。
 *     这样"门红了"与"门坏了（读数抛错）"能分开报，不会把异常误当成红。
 *   - `restore` 必须**幂等**（重复调用无害）—— exit 兜底会再调一次。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** ★ 注入物的统一命名前缀（约定）：helper 不认识各门注入什么，只按这个名字前缀**扫残留**。 */
export const PROBE_PREFIX = '__gate_probe';

/**
 * ★★ 残留自清 —— 比"退出钩子"更可靠的那道保险。
 *
 * 为什么必须有（2026-09-28 实测）：**`process.on('exit')` 在 vitest worker 被强杀时不一定触发**。
 * 跑完一轮全量后仓里留下了 4 个注入物：
 *   - `tests/__gate_probe_brand__.txt` ⇒ 让**品牌残留门**在**下一轮**全量里假红（红得莫名其妙）
 *   - `src/__gate_probe_copy__.ts` 等 ⇒ 还进了索引
 * ⇒ 每次 `runProbe` 开头先扫一遍并删掉"上一次留下的"，**不依赖退出钩子是否跑到**。
 *
 * ★ 副产品：它也是"跨门污染"的止血带 —— 注入物要放在**别的门没在扫**的位置，
 *   但万一放错了，至少下一轮会自清。
 */
export function sweepProbeResidues(): string[] {
  const removed: string[] = [];
  for (const dir of [path.join(REPO, 'src'), path.join(REPO, 'tests')]) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 目录不在就跳过（报目录不存在不是本 helper 的职责）
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.startsWith(PROBE_PREFIX)) continue;
      const abs = path.join(dir, e.name);
      try {
        fs.rmSync(abs, { force: true });
        removed.push(path.relative(REPO, abs).split(path.sep).join('/'));
      } catch {
        // 删不掉也继续扫别的（不能因为一个残留让整趟失败）
      }
    }
  }
  return removed;
}

/** 一扇门的出生证探针。`T` = 门判定逻辑的返回值（如"命中表""差异结构""bad 列表"）。 */
export interface GateProbe<T> {
  /** 门名（进失败信息，便于一眼知道是哪扇门的出生证坏了） */
  name: string;
  /** 注入：制造"这门本该抓到"（或对照项里"本该放过"）的情况。可写盘、可改内存。 */
  mutate: () => void;
  /** 跑门：执行门的**判定逻辑**并返回结果。★ 只读不写；**不要**在此断言。 */
  run: () => T;
  /** 判红：从 `run` 的结果判断"门是否变红"（= 抓到了注入的错）。 */
  isRed: (result: T) => boolean;
  /** 还原：撤销注入。★ 无论 mutate/run/断言成败，都会被执行；必须幂等。 */
  restore: () => void;
  /** 可选：把 `run` 的结果渲染成一行，附在失败信息里（便于定位"门看到了什么"）。 */
  render?: (result: T) => string;
}

interface ProbeOutcome<T> {
  result: T | undefined;
  mutateErr: unknown;
  runErr: unknown;
  restoreErr: unknown;
  /** mutate 是否真的被执行过（失败也算执行过——它可能已改了半个状态） */
  mutateRan: boolean;
}

/**
 * 待还原表 —— 供 `process.on('exit')` 兜底。
 * 正常路径下 `runProbe` 会在 finally 里还原并把它移出；表里有剩余 = 发生了硬中断。
 */
const pendingRestores = new Set<() => void>();
let exitBackstopInstalled = false;

function installExitBackstop(): void {
  if (exitBackstopInstalled) return;
  exitBackstopInstalled = true;
  const flush = (): void => {
    for (const restore of pendingRestores) {
      try {
        restore();
      } catch {
        // 进程即将结束，已尽力；此处不能再抛（会给"退出"再加噪声）
      }
    }
    pendingRestores.clear();
    // ★ 最后再扫一遍硬残留 —— 各门的 restore 未必都覆盖到自己的注入物
    sweepProbeResidues();
  };
  // ★★ 多挂几个钩子：只挂 'exit' 在 vitest worker 被强杀时不保险（见 sweepProbeResidues 的注释）
  process.on('exit', flush);
  process.on('SIGINT', flush);
  process.on('SIGTERM', flush);
  process.on('beforeExit', flush);
}

function errText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/**
 * 执行一次探针：注入 → 跑门 → **必定还原**。
 * 不在这里抛错（除还原本身失败外）——由两个导出的断言函数负责解读。
 */
function runProbe<T>(probe: GateProbe<T>): ProbeOutcome<T> {
  installExitBackstop();
  // ★★ 先扫掉"上一次留下的"残留 —— 不依赖退出钩子是否触发（见 sweepProbeResidues 的注释）
  sweepProbeResidues();
  pendingRestores.add(probe.restore);

  let mutateErr: unknown = null;
  let mutateRan = false;
  try {
    probe.mutate();
    mutateRan = true;
  } catch (e) {
    mutateErr = e;
  }

  let result: T | undefined;
  let runErr: unknown = null;
  if (mutateErr === null) {
    try {
      result = probe.run();
    } catch (e) {
      runErr = e;
    }
  }

  // ★ 无论如何都还原：注入失败 / 跑门抛错 / 跑门成功，全走这一条路。
  pendingRestores.delete(probe.restore);
  let restoreErr: unknown = null;
  try {
    probe.restore();
  } catch (e) {
    restoreErr = e;
  }

  return { result, mutateErr, runErr, restoreErr, mutateRan };
}

/** 还原失败 = 最严重（工作区被污染）⇒ 优先报，且报得最响。 */
function guardRestore<T>(probe: GateProbe<T>, o: ProbeOutcome<T>): void {
  if (o.restoreErr === null) return;
  throw new Error(
    `[出生证] ${probe.name}：**还原失败** ⇒ 工作区可能已被污染（后续测试可能连环红）。\n` +
      `请手工检查并清理注入物。还原错误：${errText(o.restoreErr)}`,
  );
}

function guardInjected<T>(probe: GateProbe<T>, o: ProbeOutcome<T>): void {
  if (o.mutateErr === null) return;
  throw new Error(
    `[出生证] ${probe.name}：**注入失败** ⇒ 无法证明门会红（出生证无效）。\n` + `注入错误：${errText(o.mutateErr)}`,
  );
}

function guardRan<T>(probe: GateProbe<T>, o: ProbeOutcome<T>): void {
  if (o.runErr === null) return;
  throw new Error(
    `[出生证] ${probe.name}：**跑门本身抛异常** ⇒ 无法判定"是门红了还是门坏了"。\n` +
      `run() 只应执行判定并返回结果，断言请交给 isRed。异常：${errText(o.runErr)}`,
  );
}

function renderTail<T>(probe: GateProbe<T>, o: ProbeOutcome<T>): string {
  if (!probe.render) return '';
  try {
    return `\n门看到的结果：${probe.render(o.result as T)}`;
  } catch {
    return '';
  }
}

/**
 * 出生证（正面）：注入一个门**本该抓到**的错 ⇒ 断言门**变红**。
 *
 * 门**没有**变红时**抛错** —— 这正是本 helper 的用处：它会当场戳穿"恒真的空门"。
 * （若本 helper 自己永远通过，那它就是新的空门；它的自身出生证见 gate_probe.test.ts。）
 */
export function expectGateGoesRed<T>(probe: GateProbe<T>): void {
  const o = runProbe(probe);
  guardRestore(probe, o);
  guardInjected(probe, o);
  guardRan(probe, o);
  if (!probe.isRed(o.result as T)) {
    throw new Error(
      `[出生证] ${probe.name}：注入后门**没有变红** —— 门是哑的/恒真（出生证失败）。` +
        `注入的是一个"门本该抓到"的错，门却放过了它。${renderTail(probe, o)}`,
    );
  }
}

/**
 * 出生证（对照项）：注入一个门**本不该抓到**的情况 ⇒ 断言门**不变红**（仍绿）。
 *
 * 没有对照项，就不知道正面断言到底在抓什么（§4.11）。门**误伤**（判据过宽）时这里会红。
 */
export function expectGateStaysGreen<T>(probe: GateProbe<T>): void {
  const o = runProbe(probe);
  guardRestore(probe, o);
  guardInjected(probe, o);
  guardRan(probe, o);
  if (probe.isRed(o.result as T)) {
    throw new Error(
      `[出生证] ${probe.name}：注入的是一个"门**本不该**抓到"的对照项，门却红了 —— 判据过宽/误伤。${renderTail(
        probe,
        o,
      )}`,
    );
  }
}
