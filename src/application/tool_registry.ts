/**
 * ★★★ 工具表（能力线 → 工具定义）的**唯一汇总点** —— application 层的一等数据。
 *
 * 为什么在这里（2026-10-01，④-2）：
 *   这份数据原先住在 `presentation/mcp/server_registry.ts` 里。但它**不是表现层的东西**：
 *   `TOOL_DEFS` 只是 **6 条能力线各自导出的 `*_TOOLS` 数组的汇总**，
 *   而那 6 个数组**全都住在 `application/<线>/index.ts`**。
 *   ⇒ 它是**application 层内部的事实**，只是恰好被写在了 presentation 的文件里。
 *
 * 为什么必须搬（这不是"挪个位置"）：
 *   `sync_contracts`（"以注册表为事实源回填工具契约"）也要读这份表 ——
 *   它若从 presentation 读，就是 **application → presentation 的下层依赖上层**，
 *   而且它俩还构成一条已知 `no-circular`（`handlers → sync_contracts → server_registry → lanes → handlers`）。
 *   ⇒ 把汇总**放回 application**，两边**同层**引用 ⇒ **隐患结构性消失**（而不是"这个特例被容忍"）。
 *
 * `presentation/mcp/server_registry.ts` 现在只剩它该干的：**把这张表注册到 MCP server**。
 */
// ─────────────────────────────────────────────────────────────
// TOOL_DEFS：按能力线拆分（P1b，2026-09-28）
//   条目逐字搬移到 src/application/<线名>/index.ts；此处只做汇总。
//   ★ 数组顺序因此改变 —— 顺序**不是**对外契约（MCP 工具按名寻址），
//     该判断已写明在 tests/server_registry.tool_snapshot.test.ts 的文件头。
// ─────────────────────────────────────────────────────────────
import { OBSERVE_TOOLS } from './observe/index.js';
import { CROSS_TOOLS } from './cross/index.js';
import { DESIGN_TOOLS } from './design/index.js';
import { META_TOOLS } from './meta/index.js';
import { REFACTOR_TOOLS } from './refactor/index.js';
import { HARVEST_TOOLS } from './harvest/index.js';
import { bindLaneOf, bindToolDefs, type LaneAssign, type LaneId } from './meta/capability_map.js';
import type { ToolDef } from './types.js';

/**
 * ★ 能力线来源（P1c）：**归属由文件所在表达** —— 本数组是"lane 文件 → 线 id"的**唯一**映射。
 *
 * 为什么还留这 6 行映射：文件名 `design.ts` 与导出名 `DESIGN_TOOLS` 之间没有机器可读的联系，
 * 总得有一处把两者接到线 id（`'design'`）上。把它压到**唯一一处**即可；
 * 再在 `capability_map.ts` 里存第二份，就是漂移源（P1c 之前的 `LANE_OF` 正是那份）。
 *
 * 顺序**不是**对外契约（MCP 工具按名寻址，见 tests/server_registry.tool_snapshot.test.ts）。
 * 文件名 ↔ 线 id 是否配对、六份来源是否两两不交且并集 = TOOL_DEFS，由 tests/registry/lane_sources.test.ts 兜。
 */
export const LANE_SOURCES: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = [
  ['observe', OBSERVE_TOOLS],
  ['cross', CROSS_TOOLS],
  ['design', DESIGN_TOOLS],
  ['meta', META_TOOLS],
  ['refactor', REFACTOR_TOOLS],
  ['harvest', HARVEST_TOOLS],
];

export const TOOL_DEFS: ToolDef[] = LANE_SOURCES.flatMap(([, defs]) => [...defs]);

/**
 * 由 lane 来源汇总出「工具 → 线」归属表。
 * P1c 之前这张表是**手抄**在 `capability_map.LANE_OF` 里的第二份清单；现在由来源派生。
 */
export function laneOfFromSources(
  sources: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = LANE_SOURCES,
): Record<string, LaneAssign> {
  const table: Record<string, LaneAssign> = {};
  for (const [lane, defs] of sources) for (const d of defs) table[d.name] = { lane };
  return table;
}

// ★ 破环注入：meta 线的 capability_map 需要真实注册表作目录，而 TOOL_DEFS 是各 lane 汇总出来的。
//   用到时才解析（handler 调用期），故加载期注入一次即可（见 lanes/meta.ts 的说明）。
bindToolDefs(TOOL_DEFS);
// ★ P1c 归属注入：capability_map 不再持有归属清单，改由本文件的 lane 来源派生后送进去。
bindLaneOf(laneOfFromSources());
