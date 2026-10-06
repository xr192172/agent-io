/**
 * 工具「面」—— ★★ **同一个注册表的多个「视图」**，不是多个要分别维护的东西。
 *
 * ★ 立论（2026-10-06，用户裁定，推翻本文档初稿的"两个端点"提案）：
 *   用户原话要点：「**原工具面改了，链条面本身也会改** —— 它和链条面有什么区别呢？
 *   **区别只在于我们是否将它暴露给 LLM 而已**。」
 *   ⇒ 既然链是**原子面之上的投影**，那"两面"就不是两个实体 ⇒ 我原先提的"两个 MCP 端点"是**过度设计**。
 *   正解 = **一个注册表 + N 个视图开关**，而这**正是本仓已有的形状**（一个 `ToolDef` ⇒ MCP / CLI / 导航 三投影）。
 *
 * ★★★ **实现方式（2026-10-06 实测更正 —— 本模块初稿写的"只裁 listTools、不裁 callTool"是错的）**：
 *   **那做不到**：MCP SDK 的 `ListTools` handler 与 `CallTool` handler 读的是**同一张** `_registeredTools`
 *   （`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` `:67-68` / `:100-102` / `:649`）
 *   ⇒ **要么都暴露、要么都不能调**。
 *   ⇒ **真做法 = 「不注册」那些工具 + 留一个原子入口**（`atomic_call`，见
 *     `presentation/mcp/server_registry.ts`）：原子能力**仍然可达**（经入口的 list / describe / call），
 *     只是**不再逐个占 MCP 面**。★ 我们**测过**：`face=all` 61 工具 / 87,379 字符；
 *     `face=composed` 9 工具 / 19,681 字符 ⇒ **载荷 -77.5%**。
 *
 * ★★ **编排面的两半，依据根本不同**（读数里分开印）：
 *   · **派生链那一半** —— `deriveObjectChains()` 算的，**验出一条新边它就自己长**；
 *   · **`direct` 白名单那一半** —— ★ **2026-08 手写的策展表，无用量依据**（待用数据替换）。
 *   ⇒ 所以"**零手写**"**只对派生那一半成立**（初稿把两半混成一句，也是不准确的）。
 *
 * ★★ **零手写**：编排面的名单**由数据算出**（导航 direct 白名单 ∪ 派生链涉及的原子工具），
 *   不许再手写一份清单（那就是判据分叉的入口）。
 *   ★ 这也是那条判据的落地：「**链面必须能从原子面再生成**」。
 *
 * ★ 本模块是**纯数据 + 纯函数**（目录与 direct 名单都从入参来，无 IO）⇒ 可测。
 *   ★ 依赖方向：只 `import type` `ToolCatalogEntry`（**类型导入被擦除 ⇒ 无运行时环**），
 *     且**不** import `capability_map` 的运行时值 —— 依赖是单向的（它调我，我不调它）。
 */
import { deriveObjectChains } from '../../../domain/chain_wiring.js';
import type { ToolCatalogEntry } from './capability_map.js';

/** 面的 id（★ 加面要在这里登记，且必须能说清"它比原子面少列了什么、为什么"） */
export type FaceId = 'atomic' | 'composed';

/** 一个「面」= 注册表的一个视图，**只决定"列出来什么"**。 */
export interface ToolFaceView {
  id: FaceId;
  /** 人读名 */
  label: string;
  /** 一句话说明（含"它为什么存在"） */
  desc: string;
  /** 这个面**列**出来的工具名（★ 可能含**不存在的名字** —— 见 `unknown`，那是漂移信号） */
  names: readonly string[];
  /** ★ 列了、但注册表里**找不到**的名字 ⇒ **跨层漂移**（`CHAIN_EDGES` / `LANE_META` 是手写的，会漂） */
  unknown: readonly string[];
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)].sort();

/**
 * 算出所有面（★ **零手写**：编排面的名单全部由 `directNames` 与 `deriveObjectChains()` 得出）。
 *
 * @param catalog      真实注册目录（`ToolCatalogEntry[]`）
 * @param directNames  各能力线的 `direct` 白名单（由调用方从 `LANE_META` 取，**避免反向 import 成环**）
 */
export function facesOf(catalog: readonly ToolCatalogEntry[], directNames: readonly string[]): ToolFaceView[] {
  const all = uniq(catalog.map((c) => c.name));
  const registered = new Set(all);

  // ★ 编排面 = 导航 direct 白名单 ∪ **派生链涉及的原子工具**（后者是**机器算的**，不是手写的）
  const chainTools = uniq(deriveObjectChains().flat());
  const composed = uniq([...directNames, ...chainTools]);

  const mk = (id: FaceId, label: string, desc: string, names: readonly string[]): ToolFaceView => ({
    id,
    label,
    desc,
    names,
    unknown: names.filter((n) => !registered.has(n)),
  });

  return [
    mk(
      'atomic',
      '原子面',
      '**全部工具**（权威面）。★ 暴露它的理由：第三方要**拿原子能力自己组合** —— 看不到就组合不了。',
      all,
    ),
    mk(
      'composed',
      '编排面',
      '两半拼的：① 派生链涉及的原子工具（**机器算的**）② `direct` 白名单（★ **2026-08 手写策展，无用量依据**）。',
      composed,
    ),
  ];
}

/** 渲染面（给 `capability_map` 的读者面用）。 */
export function renderFaces(catalog: readonly ToolCatalogEntry[], directNames: readonly string[]): string {
  const faces = facesOf(catalog, directNames);
  const lines = faces.map((f) => {
    const drift = f.unknown.length ? `　⚠ 未注册：${f.unknown.join(', ')}` : '';
    return `    ${f.label}（${f.id}）列出 ${String(f.names.length).padStart(2)} 个　${f.desc}${drift}`;
  });
  const drift = faces.filter((f) => f.unknown.length);

  // ★★ 2026-10-06：把编排面的**两半分开报**（依据不同）—— 原先写「零手写」是**不准确的**。
  const chainTools = uniq(deriveObjectChains().flat());
  const directOnly = uniq(directNames).filter((n) => !chainTools.includes(n));

  return (
    '\n\n── 工具「面」（★ 同一个注册表的**视图**）──\n' +
    lines.join('\n') +
    '\n  ★★ **实现方式（2026-10-06 实测更正）**：**不是**"裁 `listTools`" —— 那**做不到**：' +
    '\n     MCP SDK 的 `ListTools` 与 `CallTool` handler 读的是**同一张** `_registeredTools`。' +
    '\n     真做法 = **不注册**那些工具 + **留一个原子入口**（`atomic_call`）—— 即用户方案。' +
    '\n  ★★ **编排面 = 两半拼的，依据根本不同**：' +
    `\n     · 派生链那一半（${chainTools.length} 个：${chainTools.join(', ')}）—— **机器算的**，验出一条新边它就自己长；` +
    `\n     · 「direct」白名单那一半（${directOnly.length} 个：${directOnly.join(', ')}）—— ★ **2026-08 手写的策展表，无用量依据**。` +
    '\n     ⇒ ★ 所以「**零手写**」**只对派生那一半成立**；`direct` 那半是**待用数据替换的手写副本**。' +
    (drift.length
      ? '\n  ⚠ **跨层漂移**：上面标了"未注册"的名字，是 `CHAIN_EDGES` / `LANE_META` 里手写的，与注册表脱节了。'
      : '\n  ✓ 无跨层漂移（两个面列出的名字全在注册表里）。')
  );
}
