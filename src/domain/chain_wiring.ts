/**
 * 链的**接法表** —— 「上一步的产物，怎么喂给下一步的入参」。
 *
 * ★★ 为什么需要它（2026-10-05 实测）：
 *   `Touched`（产物端的锚点契约）**统一过、也是活的** —— 六键都有人产
 *   （`feature 21/31 · project_dir 22/31 · written_files 19/31 · read_files 10/31 · symbols 8/31 · nodes 10/31`），
 *   而且**链在数据上已经通了**：实测 `find_references.touched` 能**零字段名翻译**地
 *   构造出 `rename_symbols` 的入参，并跑通。
 *   ★ **但那个接法只活在"那一次对话"里** —— 没有任何东西**承载**它 ⇒
 *   每一次都得由调用方（人或 LLM）**自己回忆字段名、自己挑元素** ⇒ **这正是会出错的地方**。
 *   ⇒ 本表把它变成**数据**：`上游 → touched 的哪个键 → 下游入参的哪个位置`。
 *
 * ★★ 谁读它：`capability_map`（新用户第一站）。LLM 一眼看到"上一步给什么、下一步要什么"，
 *   **不必猜、不必回忆、不必数下标** —— 这就是「把列表给出来、从上一步的列表里挑」。
 *
 * ★★ 表里只放**有证据**的边：`verified` = 已**真跑**过；`pending` = 文档写了但**没验**。
 *   ★ **不许把 pending 写成 verified**（本仓纪律：不许把预测写成实测）。
 *
 * ★ 与 `docs/tool-chain-contract.md` §5 的关系：§5 是**散文里的目标链**
 *   （`find_references → rename_symbols → edit_code → run_tests`），本文件是它的**可消费形态**。
 */
import type { Touched } from './b_terms.js';

/** `touched` 的六个键 —— ★ **从 `Touched` 类型派生，不手抄**（改契约时本表自动跟上） */
export type AnchorKey = keyof Touched;

/** 通配：作用域类字段（`feature` / `project_dir`）两端逐字同名 ⇒ 任何 [B] 之间都直通 */
export const ANY_TOOL = '*';

export interface ChainEdge {
  /** 上游工具（= `[B]` 名）；`ANY_TOOL` 表示"任何 [B]" */
  readonly from: string;
  /** 上游 `touched` 里的哪个键 */
  readonly fromKey: AnchorKey;
  /** 下游工具；`ANY_TOOL` 表示"任何 [B]" */
  readonly to: string;
  /** 下游入参的哪个位置（点路径；`[]` 表示数组元素内） */
  readonly toPath: string;
  /**
   * 上游那个键是**集合**；这条边怎么把集合变成下游要的单个：
   * · `single` —— 集合**只有一个元素**时**确定** ⇒ 直接取，**无需选择**
   * · `pick`   —— 集合可能有多个 ⇒ **由调用方挑一个**（= 「从上一步的列表里选」）
   */
  readonly cardinality: 'single' | 'pick';
  readonly evidence: 'verified' | 'pending';
  /** 证据一句话（`verified` 必填，写清"怎么验的"） */
  readonly note: string;
}

/**
 * ★★★ 链边表。
 *
 * **唯一一条 `verified` 的来源**（2026-10-05 真跑）：
 * ```
 * find_references.touched = {project_dir, symbols:["Kk"], read_files:["com/a/Kk.java"]}
 *   → 零字段名翻译地构造 rename_symbols 入参：
 *     {project_dir: t.project_dir, renames:[{file: t.read_files[0], symbol: t.symbols[0], to:"Renamed"}]}
 *   → 跑通 ✓（定义 + 2 个 importer 全部改名）
 * ```
 */
export const CHAIN_EDGES: readonly ChainEdge[] = [
  // ── 作用域类：两端逐字同名，任何 [B] 之间直通（已验：17/17 按 feature 工作的 [B] 都接受 feature）──
  {
    from: ANY_TOOL,
    fromKey: 'project_dir',
    to: ANY_TOOL,
    toPath: 'project_dir',
    cardinality: 'single',
    evidence: 'verified',
    note: '两端逐字同名；`Touched` 侧 22/31 产、入参侧 17/37 收（按 feature 工作的 17 个 [B] 全收）',
  },
  {
    from: ANY_TOOL,
    fromKey: 'feature',
    to: ANY_TOOL,
    toPath: 'feature',
    cardinality: 'single',
    evidence: 'verified',
    note: '两端逐字同名；★ 但只有**按 feature 工作**的 [B] 该收它（全项目工具不需要，别硬塞）',
  },

  // ── 链 §5 的第一环：find_references → rename_symbols（已真跑）──
  {
    from: 'find_references',
    fromKey: 'read_files',
    to: 'rename_symbols',
    toPath: 'renames[].file',
    cardinality: 'single',
    evidence: 'verified',
    note: '实测夹具里 read_files 只有一个元素（= 符号定义处）⇒ 取 [0] 即**确定**，无需选择',
  },
  {
    from: 'find_references',
    fromKey: 'symbols',
    to: 'rename_symbols',
    toPath: 'renames[].symbol',
    cardinality: 'single',
    evidence: 'verified',
    note: '同上：symbols 单元素 ⇒ 取 [0] 确定；★ 多元素时必须由调用方挑（`pick`）',
  },
];

/**
 * ★ **待验**的边：`docs/tool-chain-contract.md` §5 写了链，但**一条都没真跑过**。
 * ★ 单独一张表 —— 让"没验"这件事**在读数里看得见**，而不是混进 `CHAIN_EDGES` 冒充已验证。
 */
export const CHAIN_EDGES_PENDING: readonly ChainEdge[] = [
  {
    from: 'rename_symbols',
    fromKey: 'written_files',
    to: 'edit_code',
    toPath: 'file',
    cardinality: 'pick',
    evidence: 'pending',
    note: '§5 写的第二环；`written_files` 在改多文件时会多元素 ⇒ 必须挑',
  },
  {
    from: 'rename_symbols',
    fromKey: 'symbols',
    to: 'edit_code',
    toPath: 'symbol',
    cardinality: 'pick',
    evidence: 'pending',
    note: '§5 写的第二环',
  },
  {
    from: 'edit_code',
    fromKey: 'written_files',
    to: 'run_tests',
    toPath: 'project_dir',
    cardinality: 'single',
    evidence: 'pending',
    note: '§5 的最后一环；`run_tests` 收的是项目根而非文件 —— **很可能这条边不成立**，待验',
  },
];

/** 渲染成人读列表（给 `capability_map` 用）—— ★ 只给"谁读得到"，不给"怎么用"。 */
export function renderChainWiring(max = 20): string {
  const line = (e: ChainEdge): string => {
    const arrow = `touched.${e.fromKey}`;
    const card = e.cardinality === 'single' ? '单元素·直接取' : '多元素·调用方挑一个';
    return `    ${e.from.padEnd(17)} ──${arrow.padEnd(22)}──▶ ${e.to} · ${e.toPath.padEnd(22)} （${card}）`;
  };
  const verified = CHAIN_EDGES.slice(0, max).map(line).join('\n');
  const pending = CHAIN_EDGES_PENDING.slice(0, max).map(line).join('\n');
  return (
    '\n\n── 链的接法（上一步的产物 → 下一步的入参）──\n' +
    '  ★ 已实测（可直接用；touched 是**产物端**统一过的那张契约）：\n' + verified + '\n' +
    '  ⏳ 待验（文档写了链，但**一条都没真跑过** —— 用之前先自己核）：\n' + pending + '\n' +
    '  ★ 用法：上一步的 touched.<键> 里挑一项，放进下一步入参的对应位置；\n' +
    '    标"单元素"的**直接取**即确定；标"多元素"的**必须由你挑一个**（这就是"从列表里选"）。'
  );
}
