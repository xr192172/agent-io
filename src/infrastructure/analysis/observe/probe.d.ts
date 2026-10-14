/**
 * `probe.ts` 的【对外契约声明】（T267，2026-10-14）—— 只声明**外部被测项目**真正需要的成员。
 *
 * ## 为什么需要它（实测：TS7016 会把外部项目挡死）
 * `observe_instrument` 会把
 *   `import { captureProbe, … } from '<agent-io>/dist/src/infrastructure/analysis/observe/probe.js'`
 * 注进**被测项目**；而 `dist/` 里没有 `.d.ts` ⇒ 开 `strict` 的外部项目必然报
 *   `TS7016: Could not find a declaration file for module '…/probe.js' … implicitly has an 'any' type`
 * ⇒ 默认 `noEmitOnError:false` 时还能 emit、真跑；但 CI 一开严就直接搭不起来。
 *
 * ## ★ 为什么是"手写契约"，不是"从实现生成"
 * 本文件是**契约**（对外承诺的形状），不是 `probe.ts` 的镜像：
 * · 只声明**外部真会用的**那几个成员（`captureProbe` / `setGlobalProbeSink` /
 *   `hasGlobalProbeSink` / `TSProbeCapture`）；
 * · `probe.ts` 的**内部细节不进这里** —— 那才会漂移成"同一份知识两处落点"（本仓头号病）。
 * ★ 改动 `probe.ts` 的**导出签名**时，这里必须同步（否则跨仓项目拿到错类型）。
 * ★ 它由 `scripts/clean_dist.mjs` 拷到 `dist/`（`tsc` 不会为单文件开 declaration）。
 */

/** 探针事件的一条（写入 `events.jsonl` 的那一行）。 */
export interface TSEvent {
  probe: string;
  /** UTC RFC3339 */
  time: string;
  /** static-rule / llm-design / runtime-invariant / v2-scope */
  source?: string;
  fields: Record<string, unknown>;
  /** 整条调用链共享的 trace id（v1 事件省略）。 */
  trace_id?: string;
  /** 本帧唯一 id（省略 = 0）。 */
  frame_id?: number;
  /** 父调用帧 id（0/省略 = 根）。 */
  parent_id?: number;
}

/** 一个调用帧（scope 模式用它重建带帧调用树）。 */
export interface ProbeFrame {
  trace_id: string;
  frame_id: number;
  parent_id: number;
}

/** 探针 sink：把事件追加到 `events.jsonl`。 */
export declare class TSProbeCapture {
  constructor(eventsPath: string, onEvent?: (ev: TSEvent) => void);
  /** 默认事件文件路径：`<observeDir>/events.jsonl`。 */
  static pathFor(observeDir: string): string;
  emit(
    probe: string,
    fields: Record<string, unknown>,
    source?: string,
    frame?: ProbeFrame,
  ): TSEvent;
}

/** 打一条探针事件。**无 sink 时是 no-op**（`hasGlobalProbeSink()` 为 false 就直接返回）。 */
export declare function captureProbe(
  probe: string,
  fields: Record<string, unknown>,
  source?: string,
): void;

/**
 * 进入一个调用帧（scope 模式用：录带帧调用树）。
 * ★ **必须声明**：插桩无条件注入 `import { captureProbe, enterScope, exitScope }` ——
 *   漏声明 ⇒ 外部项目编译报 `TS2305: has no exported member 'enterScope'`
 *   （T267 实测踩到：我先只声明 captureProbe，结果正是这个错）。
 */
export declare function enterScope(probe: string, fields: Record<string, unknown>): void;

/** 退出当前调用帧（与 {@link enterScope} 配对）。 */
export declare function exitScope(probe: string, fields?: Record<string, unknown>): void;

/**
 * ★ T271：在**当前帧**上发一条 catch 事件（**不改帧栈**）—— 供 **scope 模式**的 catch 探针用。
 * ★ 必须声明：scope 模式**不注入 import** ⇒ catch 只能走 `globalThis.__probeScope.catch`；
 *   宿主照回执挂 `{ enter, exit, catch: catchScope }` 时要用到这个名字。
 */
export declare function catchScope(probe: string, fields?: Record<string, unknown>): void;

/** 装/卸全局 sink。返回被换掉的那个（便于临时探针还原）。 */
export declare function setGlobalProbeSink(sink: TSProbeCapture | null): TSProbeCapture | null;

/** 当前有没有装 sink —— `false` 时 `captureProbe` 什么都不做。 */
export declare function hasGlobalProbeSink(): boolean;
