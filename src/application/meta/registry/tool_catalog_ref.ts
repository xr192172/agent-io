/**
 * 工具目录 / 归属表的**注入槽**（零依赖叶子）。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：槽原先住 `capability_map.ts` 内部
 *   （`bindToolDefs` / `bindLaneOf` 写那里的模块级变量）。于是 `application/tool_registry.ts`
 *   —— 汇总 lane 的唯一地方，只是把目录**递过去** —— 被迫静态 import `capability_map`，
 *   而它的运行时闭包实测 **≈400 ms / 96 个 dist 模块**（`scan_authorities → storage → …`）
 *   ⇒ 每一次 `cli --help`、每一次"找一下这个工具名"都要为「写两个变量」付掉整张实现图。
 *
 * ## 为什么是叶子（零 import，只有类型）
 *   写端（`tool_registry`）只 import 本文件 ⇒ 注册表闭包不再含 `capability_map`；
 *   读端（`capability_map`）照旧在**自己被加载时**从这里取 —— 目录语义没变：
 *   注入一次、全体读取、**未注入就抛错**（不返回空目录：那会把"接线漏了"伪装成
 *   "注册表里真没有工具"，正是本仓反复禁的假绿）。
 */
import type { ToolDef } from '../../types.js';
import type { LaneId } from './lane_ids.js';

/**
 * 工具 → 线归属。**由 lane 文件派生后注入**（`bindLaneOf`），不是任何模块自带的数据。
 * when 省略 = 走 `WHEN_OVERRIDES`；再省略 = 由注册描述自动摘要。
 */
export interface LaneAssign {
  lane: LaneId;
  /** 需要人工语义时才写（导航价值高于注册描述时）；一般不必——策展文本请写进 WHEN_OVERRIDES */
  when?: string;
}

let _toolDefs: ToolDef[] | null = null;
let _laneOf: Readonly<Record<string, LaneAssign>> | null = null;

/** 注入工具目录（`tool_registry` 在汇总完 lane 数组后调用一次）。 */
export function setToolDefs(defs: ToolDef[]): void {
  _toolDefs = defs;
}

/** 读已注入的目录；**未注入返回 null**（判定与报错口径留在 `capability_map`，那里才是有语义的一侧）。 */
export function getToolDefs(): ToolDef[] | null {
  return _toolDefs;
}

/** 注入「工具 → 线」归属表。 */
export function setLaneOf(table: Readonly<Record<string, LaneAssign>>): void {
  _laneOf = table;
}

/** 读已注入的归属表；未注入返回 null。 */
export function getLaneOf(): Readonly<Record<string, LaneAssign>> | null {
  return _laneOf;
}

/** 测试隔离用：清掉注入的归属表（回到"未注入"状态） */
export function clearLaneOf(): void {
  _laneOf = null;
}
