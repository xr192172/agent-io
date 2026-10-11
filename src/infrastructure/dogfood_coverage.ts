/**
 * dogfood_coverage —— 「工具面」的**覆盖 / 缺口**读数（2026-10-11，BB 笔）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么有它（用户原话，不是自选）
 * ─────────────────────────────────────────────────────────────
 *   > 「**"什么被保证 / 什么被用过"没有工具面**」
 *   —— 注册表无门/覆盖工具 · `usage.jsonl` **只有不在注册表的 `npm run dogfood` 能读**。
 *
 *   已有读数 `dogfood_stats.ts`（`npm run dogfood`）只答**半**个问题
 *   ——「**共 N 次调用 + 一张 工具/调用/成功/失败/成功率 表**」；
 *   它**答不了**只有它答得了的那两个：
 *     · **注册了但从未用过** → 死工具（数据源：**注册表 − usage 里出现过的 tool**）
 *     · **用过但已不在注册表** → 过期记录（数据源：**usage 里出现过的 tool − 注册表**）
 *
 * ─────────────────────────────────────────────────────────────
 * 与 `dogfood_stats.ts` 的**分工**（不重造统计：本模块**只调用**它）
 * ─────────────────────────────────────────────────────────────
 *   · `dogfood_stats.ts` = **统计**（读日志 → 每工具 calls/ok/failed/by_action/…）。
 *     本模块**一行统计都不重写**，直接 `snapshotDogfoodStats()` 复用（见 {@link computeDogfoodCoverage}）。
 *   · 本模块 = 在**它的产物**上做**集合差**（注册表 vs 用过的集合）+ 渲染。
 *
 * ★★ **注册表由调用方注入，不在这里 import**（分层铁律）：
 *   `dogfood_*` 住 `infrastructure/`，而注册表 `TOOL_DEFS` 住 `application/`
 *   ⇒ infrastructure **不能** import application（那是反向依赖）。
 *   ⇒ 与 `capability_map.bindToolDefs()` 同一模式：**谁在上层谁把它递进来**。
 *   ★ 本模块**不自己拼一份工具清单**（那就是第二份注册表，必然漂移）——
 *     `registry` 参数的**唯一合法来源**是 `application/tool_registry.ts` 的 `TOOL_DEFS`。
 *
 * ★ 只读：本模块**只** `readFileSync`（经 `snapshotDogfoodStats`）**不写任何东西**。
 *   ★ 那条日志（`<dataHome>/.agent-io/dogfood/usage.jsonl`）**只加不减**（它是原始日志）
 *     ⇒ 本模块**绝不**创建 / 追加 / 清空它。
 */
import { snapshotDogfoodStats, type DogfoodToolStat } from './dogfood_stats.js';

/** 一个工具的**使用读数**（覆盖 / 缺口用的最小集）。 */
export interface ToolUsageRow {
  tool: string;
  calls: number;
  ok: number;
  failed: number;
}

/**
 * 覆盖 / 缺口快照。
 *
 * ★ 每条读数都带**它怎么来的**（本仓刚立的判据：**读数要说清它做了什么**）：
 *   · {@link DogfoodCoverage.usage_file} = 用过的集合来自哪个文件（真实路径）；
 *   · {@link DogfoodCoverage.registry_source} = 注册表从哪来（调用方给的**人话标签**）。
 */
export interface DogfoodCoverage {
  /** usage 日志文件的**真实绝对路径**（「用过的集合」的数据源）。 */
  usage_file: string;
  /** 注册表的**来源标签**（「注册过的集合」的数据源；由调用方标注，如 `...tool_registry.ts 的 TOOL_DEFS`）。 */
  registry_source: string;
  /** 日志里的**总调用次数**（= `dogfood_stats` 的 `total`；非去重，逐条记录）。 */
  total_calls: number;
  /** 注册表里的工具**总数**（去重）。 */
  registry_count: number;
  /** usage 里出现过的工具名**去重数**。 */
  used_count: number;
  /** 既在注册表、又用过（`registry ∩ used`）的工具数。 */
  live_count: number;
  /** ★ **注册了但从未用过**（`registry − used`，按名排序）。= 死工具。 */
  dead: Array<{ tool: string }>;
  /** ★ **用过但已不在注册表**（`used − registry`，按名排序）。= 过期记录。 */
  stale: ToolUsageRow[];
  /** 用过的每个工具的完整统计（**原样复用** `dogfood_stats` 的产物，未改一行）。 */
  tools: DogfoodToolStat[];
}

/**
 * 在 `dogfood_stats` 的产物上做集合差 —— **不重造统计**（直接复用 {@link snapshotDogfoodStats}）。
 *
 * @param registry       注册表工具名（唯一合法来源：`application/tool_registry.ts` 的 `TOOL_DEFS`）
 * @param registrySource 注册表的来源标签（写进读数，供人核）
 */
export function computeDogfoodCoverage(
  registry: readonly string[],
  registrySource: string,
): DogfoodCoverage {
  const snap = snapshotDogfoodStats(); // ★ 复用：统计逻辑一行都不重写
  const usedRows = new Map(snap.tools.map((t) => [t.tool, t]));
  const regSet = new Set(registry);

  const dead = [...regSet]
    .filter((n) => !usedRows.has(n))
    .sort()
    .map((tool) => ({ tool }));
  const stale = snap.tools
    .filter((t) => !regSet.has(t.tool))
    .map((t) => ({ tool: t.tool, calls: t.calls, ok: t.ok, failed: t.failed }))
    .sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));

  return {
    usage_file: snap.file,
    registry_source: registrySource,
    total_calls: snap.total,
    registry_count: registry.length,
    used_count: usedRows.size,
    live_count: snap.tools.length - stale.length,
    dead,
    stale,
    tools: snap.tools,
  };
}

/** 计数的小结行（人话，被 {@link renderDogfoodCoverage} 复用）。 */
export function summarizeCoverage(c: DogfoodCoverage): string {
  return (
    `注册表 ${c.registry_count} 个工具 ｜ usage 里出现过 ${c.used_count} 个 ｜ ` +
    `两者都有（用过且仍注册）${c.live_count} 个 ｜ ` +
    `★ 死工具（注册了但从未用过）${c.dead.length} 个 ｜ ` +
    `★ 过期记录（用过但已不在注册表）${c.stale.length} 个`
  );
}

/** 人话渲染（工具面的默认出口）。 */
export function renderDogfoodCoverage(c: DogfoodCoverage): string {
  const L: string[] = [];
  L.push(`工具使用 / 覆盖读数 · 共 ${c.total_calls} 次调用`);
  L.push(`  用过的集合（数据源）: ${c.usage_file}`);
  L.push(`  注册过的集合（数据源）: ${c.registry_source}`);
  L.push('');
  L.push(`★ 口径（读数说清它做了什么）：`);
  L.push(`  · 用过的集合 = 该日志里出现过的 tool 名去重（每条记录逐行读，坏行跳过）`);
  L.push(`  · 注册过的集合 = 上面那个注册表的工具名去重（**没有自己再拼一份**）`);
  L.push(`  · 死工具 = 注册过的 − 用过的 ｜ 过期记录 = 用过的 − 注册过的（**集合差**，两侧都按名排序）`);
  L.push('');
  L.push(summarizeCoverage(c));
  L.push('');

  L.push(`── ★ 死工具（注册了但从未用过）：${c.dead.length} 个 ──`);
  if (c.dead.length === 0) L.push(`  （无）`);
  else for (const d of c.dead) L.push(`  ${d.tool}`);
  L.push('');

  L.push(`── ★ 过期记录（用过但已不在注册表）：${c.stale.length} 个 ──`);
  L.push(`  ★ 这些是**历史上真被调过**的名字，如今注册表里已没有它 ⇒ 读日志时别把它们当成"现存工具"。`);
  if (c.stale.length === 0) L.push(`  （无）`);
  else
    for (const s of c.stale)
      L.push(`  ${s.tool.padEnd(26)} 调用 ${String(s.calls).padStart(4)}（成功 ${s.ok} / 失败 ${s.failed}）`);
  L.push('');

  L.push(`── 用过且仍在注册表：${c.live_count} 个 ──`);
  const live = c.tools
    .filter((t) => !c.stale.some((s) => s.tool === t.tool))
    .sort((a, b) => b.calls - a.calls || (a.tool < b.tool ? -1 : 1));
  L.push(`| 工具 | 调用 | 成功 | 失败 | 成功率 |`);
  L.push(`|---|---|---|---|---|`);
  for (const t of live) {
    const rate = t.calls > 0 ? `${Math.round((t.ok / t.calls) * 100)}%` : '—';
    L.push(`| ${t.tool} | ${t.calls} | ${t.ok} | ${t.failed} | ${rate} |`);
  }
  return L.join('\n');
}
