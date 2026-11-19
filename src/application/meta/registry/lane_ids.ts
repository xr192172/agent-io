/**
 * 能力线 id 的**唯一清单**（叶子模块：零依赖）。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：本常量原先住 `capability_map.ts`。
 *   而 `capability_map.ts` 的运行时闭包会经 `scan_authorities → storage → …` 拉进约 400 ms 的实现图，
 *   `meta/index.ts` 只是拿它做 `z.enum` 的取值表（**元数据**）⇒ 一个常量把实现图拖进了模块求值期。
 *   搬到零依赖叶子后：面一字不变，`capability_map` 仍 re-export（公开 API 不动）。
 */
export const LANE_IDS = ['design', 'refactor', 'observe', 'cross', 'meta'] as const;
export type LaneId = (typeof LANE_IDS)[number];
