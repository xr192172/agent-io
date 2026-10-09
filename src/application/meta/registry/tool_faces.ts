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
 * ★★ **编排面的两份依据，性质不同**（读数里分开印；★ 2026-10-09 更正：它们**可以重叠**，
 *   原来的说法"两半"容易被读成互斥的两半）：
 *   · **派生链** —— `deriveObjectChains()` 算的，**验出一条新边它就自己长**；
 *   · **`direct` 门名单** —— **人写的**，依据是**结构性的**「**每条线要有门**」（面无门 ⇒ 该线不可达）。
 * ★★ **2026-10-09 更正一处旧说法**：这里原先写 `direct` 是「**2026-08 手写的策展表，无用量依据**
 *   （待用数据替换）」——**"待用数据替换"是错的方向**，两条实测理由：
 *   ① `direct` **不只喂本模块**：`capability_map` 的**线视图**那行"直接可用（无需导航）"读的就是它
 *      ⇒ 删掉已被派生链覆盖的名字，**线视图会丢掉该线入口**；
 *   ② 它的依据不是用量统计而是**结构判断** ⇒ **换用量数据换不掉它**。
 *   ⇒ 正解 = **把语义写清**（`Lane.direct` 的注释已改：「高频工具」→「**这条线的门名单**」），
 *     **不是**去删那一半。
 *
 * ★★ **零手写**：编排面的名单**由数据算出**（`direct` 门名单 ∪ 派生链涉及的原子工具），
 *   不许再手写一份清单（那就是判据分叉的入口）。
 *   ★ 这也是那条判据的落地：「**链面必须能从原子面再生成**」。
 *   ★★ 但**"零手写"要判就判 `direct` 本身，别判 `composed`** —— 并集会把两侧变化各自吸收掉
 *     （实测：把 `import_project` 从 `direct` 拿掉 ⇒ `composed` 一个名字都不变）。见 `renderFaces`。
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
      '两份依据拼的（**可重叠**）：① 派生链涉及的原子工具（**机器算的**，验出一条新边它就自己长）② ' +
        '`direct` **门名单**（**人写的**，依据是"每条线要有门"，**不是**用量统计）。',
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
  // ★★ 2026-10-09（评审后重写）：把编排面的**两份依据**如实分开报 —— 原文写"两半拼的"，容易被读成
  //   "互斥的两半"（`directOnly` 才是互斥的），而真相是**两份依据可以重叠**。
  //   ★★ 更要紧的一条（实测得出）：**要看"手写那半有没有变"，必须看 `direct` 本身** ——
  //      `composed`（并集）会把手写侧的变化**吸收掉**：把 `import_project` 从 `direct` 拿掉，
  //      `composed` **一个名字都不变**（它已由派生链供给）⇒ 拿 `composed` 当判据 = 常量判据。
  const chainTools = uniq(deriveObjectChains().flat());
  const directOnly = uniq(directNames).filter((n) => !chainTools.includes(n));
  const dualEvidence = uniq(directNames).filter((n) => chainTools.includes(n));

  return (
    '\n\n── 工具「面」（★ 同一个注册表的**视图**）──\n' +
    lines.join('\n') +
    '\n  ★★ **实现方式（2026-10-06 实测更正）**：**不是**"裁 `listTools`" —— 那**做不到**：' +
    '\n     MCP SDK 的 `ListTools` 与 `CallTool` handler 读的是**同一张** `_registeredTools`。' +
    '\n     真做法 = **不注册**那些工具 + **留一个原子入口**（`atomic_call`）—— 即用户方案。' +
    '\n  ★★ **编排面 = 两份依据拼的（可以重叠，不是互斥的两半）**：' +
    `\n     · **派生链**（${chainTools.length} 个：${chainTools.join(', ')}）—— **机器算的**，验出一条新边它就自己长；` +
    `\n     · **「direct」门名单**（${directNames.length} 个，其中 **${directOnly.length} 个派生链没覆盖**、` +
    `**${dualEvidence.length} 个有两份依据**${dualEvidence.length ? `：${dualEvidence.join(', ')}` : ''}）` +
    '\n       —— **人写的**，依据是"**每条线要有门**"（面无门 ⇒ 该线在编排面上不可达），不是"用量统计"。' +
    '\n     ⇒ ★ **重叠不是错**：`direct` **同时被本模块与 `capability_map` 的线视图读**' +
    '\n       （线视图那行"直接可用（无需导航）"读的就是它）⇒ **不许**因为"派生链已覆盖"就从 `direct` 里删掉一个名字 —— ' +
    '\n       删了，**线视图会丢掉那条线的入口**（`composed` 因为并集反而看不出来）。' +
    '\n     ⇒ ★★ **判"手写那半变没变"请看 `direct` 本身，别用 `composed`**：' +
    '\n       实测把 `import_project` 从 `direct` 拿掉 ⇒ `composed` 仍是 13、名字一个不少（已被派生链供给）；' +
    '\n       逐条删 14 条对象边 ⇒ 只有 1 条能让 `composed` 变。' +
    '\n       ⇒ 并集把**两侧的变化各自吸收掉** ⇒ 拿它当判据 = 本仓 T68 那句"两种状态读数相同 ⇒ 那是常量"。' +
    (drift.length
      ? '\n  ⚠ **跨层漂移**：上面标了"未注册"的名字，是 `CHAIN_EDGES` / `LANE_META` 里手写的，与注册表脱节了。'
      : '\n  ✓ 无跨层漂移（两个面列出的名字全在注册表里）。')
  );
}
