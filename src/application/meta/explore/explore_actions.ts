/**
 * `explore_code` 的**动作闭集**（分发器与 `inputSchema` 的 `z.enum` 共用这一份）—— 零依赖叶子。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：原先住 `explore_code.ts`。`meta/index.ts` 的 schema
 *   在**模块求值期**就要它，而 `explore_code.ts` 的实现闭包实测 201 个 dist 模块 ⇒ 一个枚举把整条
 *   explore 实现图拖进了 `--help`。搬到叶子后 `explore_code.ts` re-export ⇒ 公开 API 与面一字不变。
 */
export const EXPLORE_ACTIONS = [
  'search',
  'read',
  // ★ facts：**选择性读 DB**（索引事实），与 read（读源码）是两条互不替代的读法。
  'facts',
  'arch_layer',
  'guided_tour',
  'check_monolith',
  'derive_mind_map',
  'run_simulation',
  'reset_simulation',
  'watch',
  // ★ 2026-10-28（吸收 impact_analysis）：改前看波及 —— 反向可达闭包 + 风险排序
  'impact',
  // ★ 2026-10-28（吸收 read_project_docs）：读项目文档（清单 / 单篇 / 按目标集命中）
  'docs',
] as const;

export type ExploreAction = (typeof EXPLORE_ACTIONS)[number];
