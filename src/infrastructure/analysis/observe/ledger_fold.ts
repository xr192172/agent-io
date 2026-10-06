/**
 * ledger_fold —— impact ledger 的**折叠分析**（2026-10-05，P4 步骤 2）
 *
 * 搬迁自 `observe-lang-go/probe/ledger_loader.go`（211 行），**只搬 TS 侧缺的增量**。
 * 侦察核实这是 P4 里**零风险的一块**：
 *   · `LedgerEntry` 不用重定义 —— `application/meta/impact/impact_ledger_store.ts:31` 已有**更全**的镜像
 *     （多一个 `resolution` 字段），本文件直接 import。
 *   · `LoadImpactLedger`（Go `:59`，吃 path）也不搬 —— TS 的 `loadLedger(projectRoot)`（`:90`）已覆盖，
 *     且**吃项目根**比吃路径更安全（调用方不必自己拼路径）。
 *   ⇒ 真正缺的只有 `AnalyzeLedger` 的折叠逻辑与 known-spread 声明生成，Go 侧唯一调用者是
 *     `loop.go:113/117`，而 `loop` 本身就要在 P4 步骤 6 搬走 ⇒ 本文件落地后 Go 那 211 行即可删。
 *
 * ★ 一处**故意的路径收拢**：Go 的 ledger 默认路径在 `dsl_cli.go:450` 拼成
 *   `filepath.Join(dataDir, "..", "..", ".agent-io", "impact", "ledger.json")` ——
 *   从 `.agent/observe` 上溯两级进 `.agent-io/impact/`，且是**裸字面量**（不在任何常量里）。
 *   本文件改走 `impactLedgerFile(projectRoot)`（`impact_ledger_store.ts:85`）⇒ **该字面量消失**。
 *
 * ★ 折叠语义**逐条照搬**，其中两条容易被"顺手优化"掉，特意标出：
 *   ① `consumed` 的判据是 **`consumed_at` 非空**，**不是** `status`（Go `:93`）。
 *      一个 `status:'ok'` 但已被消费过的条目算 consumed；一个 `consumed_at` 为空但 `status:'violated'`
 *      的条目**不算** consumed（会进 Violated 分子却不进分母 ⇒ 偏差率可能 > 1）。这不是 bug，是既有约定。
 *   ② `resolved` **算历史违反**（Go `:94`）—— 已解决的违规仍留在分子里，因为"发生过"本身就是设计信号。
 *   ③ 归因是**保守超集**（Go `:102-115`）：无法把扩散精确归到单个源文件（Go 注释 `:16-17` 明说），
 *      于是把每个 `declared_files` 各记一次违反，并把**完整的 `unexpected_files` 并集**塞给它。
 *      代价是单个源文件的扩散面会被高估 —— 宁可高估也不漏判，这是有意的取舍。
 */

import { loadLedger, type LedgerEntry } from '../../../application/meta/impact/impact_ledger_store.js';
import type { TSDLDecl } from './contract.js';

/** 一个"累犯模式"：同一源文件反复引发计划外扩散。 */
export interface SpreadPattern {
  /** 源文件（相对项目根 posix） */
  source: string;
  /** 计划外波及文件并集（**已排序**） */
  files: string[];
  /** 累犯次数 */
  violations: number;
}

export interface LedgerStats {
  total: number;
  consumed: number;
  violated: number;
  /** violated / consumed；consumed = 0 时保持 0 */
  deviationRate: number;
  repeatSpreads: SpreadPattern[];
}

/** 「已知波及耦合」声明的 rule id。 */
export const KNOWN_SPREAD_RULE = 'design:impact-known-spread';

/** 该声明的机器可读约束（`TSDLDecl.constraint` 的 JSON 形态）。 */
export interface KnownSpreadConstraint {
  source: string;
  spread: string[];
  violations: number;
}

/**
 * 折叠台账：算偏差率 + 挖出累犯模式。
 * @param projectRoot 项目根（经 `impactLedgerFile` 定位 ledger；**不**接受裸路径）
 * @param minRepeat 累犯门槛；< 1 时兜底为 2（Go `:80-82` 的约定）
 */
export function analyzeLedger(projectRoot: string, minRepeat = 2): LedgerStats {
  return foldEntries(loadLedger(projectRoot), minRepeat);
}

/** 纯函数形态（便于单测与复算）。 */
export function foldEntries(entries: LedgerEntry[], minRepeat = 2): LedgerStats {
  const repeat = minRepeat < 1 ? 2 : minRepeat;
  const st: LedgerStats = { total: entries.length, consumed: 0, violated: 0, deviationRate: 0, repeatSpreads: [] };

  // 源文件 → 计划外文件并集 + 累犯次数
  const accBySrc = new Map<string, { files: Set<string>; n: number }>();
  for (const e of entries) {
    const consumed = Boolean(e.consumed_at); // ① 判据是 consumed_at 非空，不是 status
    const violated = e.status === 'violated' || e.status === 'resolved'; // ② resolved 算历史违反
    if (consumed) st.consumed++;
    if (!violated) continue;
    st.violated++;
    const unexpected = e.unexpected_files ?? [];
    const declared = e.declared_files ?? [];
    if (unexpected.length === 0 || declared.length === 0) continue;
    // ③ 保守超集归因（照搬 Go `:105-115`）
    for (const src of declared) {
      let a = accBySrc.get(src);
      if (!a) {
        a = { files: new Set<string>(), n: 0 };
        accBySrc.set(src, a);
      }
      a.n++;
      for (const f of unexpected) a.files.add(f);
    }
  }
  if (st.consumed > 0) st.deviationRate = st.violated / st.consumed;

  for (const [src, a] of accBySrc) {
    if (a.n < repeat) continue; // 单次违反不成模式（可能是失误而非结构耦合）
    st.repeatSpreads.push({ source: src, files: [...a.files].sort(), violations: a.n });
  }
  // 确定性排序：累犯次数降序 → 源文件字典序（Go `:133-138`）
  st.repeatSpreads.sort((x, y) => (y.violations - x.violations) || (x.source < y.source ? -1 : x.source > y.source ? 1 : 0));
  return st;
}

// ─────────────────────────────────────────────────────────────
// known-spread 声明生成
// ─────────────────────────────────────────────────────────────

/** 解析声明/提案的 constraint；不是 known-spread 或解析失败 ⇒ 返 null（Go `:151-160` 的零值语义）。 */
export function parseKnownSpread(d: TSDLDecl): KnownSpreadConstraint | null {
  if (d.rule !== KNOWN_SPREAD_RULE || !d.constraint) return null;
  let c: unknown;
  try {
    c = JSON.parse(d.constraint);
  } catch {
    return null;
  }
  if (typeof c !== 'object' || c === null) return null;
  const o = c as Record<string, unknown>;
  if (typeof o.source !== 'string' || o.source === '') return null;
  return {
    source: o.source,
    spread: Array.isArray(o.spread) ? (o.spread as string[]) : [],
    violations: typeof o.violations === 'number' ? o.violations : 0,
  };
}

/**
 * 把声明集里的 known-spread 声明折叠成**已承认耦合查询表**：`source → 已承认的越界文件集合`。
 *
 * ★ 这是 P5 的**适配层**，职责单一：把"声明"翻译成"judge 层吃得下的领域数据"
 *   （`ObserveRuleCtx.acknowledgedSpreads`）。judge 层因此**不必认识 `TSDLDecl`**
 *   —— 否则会与 `contract.ts` 成环、或让同一份类型出现第二份定义。
 *
 * ★ 为什么不看 `status`：权威 `dsl.json` 里只装**已批准**的声明（提案经 `approveGated` 才写入）
 *   ⇒ 读到即"已承认"。若再按 `status` 过滤，就是**为同一个判据造第二条口径**（本仓头号病根）。
 *
 * ★ 同 source 多条声明 ⇒ 取**并集**（多条都是"已承认"，合起来才是该源的全部已承认耦合）。
 */
export function knownSpreadIndex(decls: readonly TSDLDecl[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const d of decls) {
    const c = parseKnownSpread(d);
    if (!c) continue;
    let set = idx.get(c.source);
    if (!set) {
      set = new Set<string>();
      idx.set(c.source, set);
    }
    for (const f of c.spread) set.add(f);
  }
  return idx;
}

function joinComma(parts: string[]): string {
  return parts.join('、');
}

/**
 * 把文件清单拼成 `"a"、"b"`，超过 max 截断（人类可读用，照搬 Go `:185-199`）。
 * ★ 一处**已知的不逐字对齐**（有意记录）：Go 用 `%q`，控制字符转义为 `\x..`；
 *   TS 的 `JSON.stringify` 转义为 `\u00xx`。文件路径里出现控制字符属极端情况，
 *   故按 `JSON.stringify` 取（与本仓其余 JSON 文案一致），**不**为逐字对齐去手写 Go 的转义器。
 */
export function joinQuoted(files: string[], max: number): string {
  const quoted = files.map((f) => JSON.stringify(f));
  return quoted.length > max ? `${joinComma(quoted.slice(0, max))} …等 ${quoted.length} 个` : joinComma(quoted);
}

/** 累犯模式 → DSL 声明（提案的最小单元）。照搬 Go `:167-182`，逐字段一致。 */
export function knownSpreadDecl(p: SpreadPattern): TSDLDecl {
  const cj = JSON.stringify({ source: p.source, spread: p.files, violations: p.violations } satisfies KnownSpreadConstraint);
  return {
    rule: KNOWN_SPREAD_RULE,
    probe: 'impact.spread',
    expect: `改动 ${p.source} 的已知波及面（历史 ${p.violations} 次计划外扩散）：${joinQuoted(p.files, 8)}——这些文件属设计已承认的耦合`,
    constraint: cj,
    origin: 'runtime-observe',
    status: 'proposed',
  };
}

/** 已批准声明与新模式是否覆盖同一波及面（提案去重：集合相同 ⇒ 无需再提；增长 ⇒ 提更新）。照搬 Go `:214-228`。 */
export function sameSpreadSet(c: KnownSpreadConstraint, p: SpreadPattern): boolean {
  if (c.spread.length !== p.files.length) return false;
  const set = new Set(c.spread);
  return p.files.every((f) => set.has(f));
}
