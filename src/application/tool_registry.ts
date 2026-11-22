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
// ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：**注入槽**搬到零依赖叶子 `tool_catalog_ref.ts`。
//   本文件只是把「目录 / 归属」**递过去**（写两个变量），原先却要为它静态 import `capability_map`，
//   而后者运行时闭包实测 ≈400 ms / 96 个 dist 模块（`scan_authorities → storage → …`）
//   ⇒ 每一次 `cli --help`、每一次"找一下工具名"都在为这两个变量付整张实现图。
//   ★ 判定（未注入 ⇒ 抛错）仍在 `capability_map`：叶子只存值，不给"看起来能用"的空壳。
import { setLaneOf, setToolDefs, type LaneAssign } from './meta/registry/tool_catalog_ref.js';
import type { LaneId } from './meta/registry/lane_ids.js';
import { bindToolDefsForWiring } from '../infrastructure/analysis/health/wiring_claims.js';
import { TOOL_ANNOTATIONS } from './tool_annotations.js';
import { bindWritesOf } from '../infrastructure/dsl_write_scope.js';
import type { ToolDef } from './types.js';
import { bindActionEffects, type ActionToolDef } from './action_effect.js';

/**
 * ★ 能力线来源（P1c）：**归属由文件所在表达** —— 本数组是"lane 文件 → 线 id"的**唯一**映射。
 *
 * 为什么还留这 6 行映射：文件名 `design.ts` 与导出名 `DESIGN_TOOLS` 之间没有机器可读的联系，
 * 总得有一处把两者接到线 id（`'design'`）上。把它压到**唯一一处**即可；
 * 再在 `capability_map.ts` 里存第二份，就是漂移源（P1c 之前的 `LANE_OF` 正是那份）。
 *
 * 顺序**不是**对外契约（MCP 工具按名寻址）—— ★ 原先这里引用 `tests/server_registry.tool_snapshot.test.ts`
 * 与 `tests/registry/lane_sources.test.ts`，而 **`tests/` 已在测试框架移除时一起删掉**（2026-10-19 核实）⇒
 * 那两条约束现在**没有执行者**（★ 这是"文档承诺了机器不查的东西"的一个样本，别再引用它们）。
 */
export const LANE_SOURCES: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = [
  ['observe', OBSERVE_TOOLS],
  ['cross', CROSS_TOOLS],
  ['design', DESIGN_TOOLS],
  ['meta', META_TOOLS],
  ['refactor', REFACTOR_TOOLS],
];

export const TOOL_DEFS: ToolDef[] = (() => {
  const defs = LANE_SOURCES.flatMap(([, defs]) => [...defs]);
  // ★★ 第⑥项（2026-11-10）：**注解绑定 + 缺键即报**——TOOL_ANNOTATIONS 清单必须覆盖全部工具
  //   （漏一个 = 那个工具在 MCP 面上无声明 ⇒ 客户端按保守处理（规范语义），消歧义失败即漂）。
  const missing = defs.filter((d) => !TOOL_ANNOTATIONS[d.name]);
  if (missing.length) {
    throw new Error(
      `TOOL_ANNOTATIONS 缺少 ${missing.length} 个工具的注解：${missing.map((d) => d.name).join(', ')}。` +
        `★ 注解是 MCP 面的对外声明（2025-06-18 规范 ToolAnnotations），缺键即报（防漂移，与 FILE_DATA_KEYS 同纪律）。`,
    );
  }
  const out = defs.map((d) => ({ ...d, annotations: TOOL_ANNOTATIONS[d.name] }));
  // P1-ACTION-EFFECT-BOUNDARY-01：效果事实随 ToolDef 同处登记，这里派生注入纯裁决表。
  bindActionEffects(out as unknown as readonly ActionToolDef[]);
  return out;
})();

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
setToolDefs(TOOL_DEFS);
// ★ 2026-11-08（接线账 P2）：把**同一份** TOOL_DEFS 递给 code_health 的"能力接线账"。
//   为什么走注入而不是让 infrastructure 直接 import：infrastructure 不能 import application（分层方向），
//   与本文件已有的 bindLaneOf / bindWritesOf 同一模式；★ 不另存一份工具清单（那就是第二份权威）。
bindToolDefsForWiring(TOOL_DEFS);
// ★ P1c 归属注入：capability_map 不再持有归属清单，改由本文件的 lane 来源派生后送进去。
setLaneOf(laneOfFromSources());
// ★ 写册白名单注入（2026-11-03，卡 1.1）：infrastructure 层的 saveDSL 闸需要知道
//   「哪个工具真的落盘设计册」⇒ 由 TOOL_DEFS 派生（`writes` 字段是唯一事实源），
//   加载期 bind 一次。infrastructure 不能 import application，故走注入（dsl_write_scope.ts）。
bindWritesOf(Object.fromEntries(TOOL_DEFS.map((d) => [d.name, d.writes])));
