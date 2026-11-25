/**
 * decision_history.ts —— `decision_history` 的**外置家**（`<feature>.history.jsonl`，append-only）。
 *
 * ★ 为什么住 `infrastructure/`（而不是 `application/design/`）：它是**一个存储**（文件 I/O + 路径 + 读端 union），
 *   并且 **`import_project`（infrastructure）在建册时也要建它** ⇒ 住 application 就成了
 *   "infrastructure → application"的**反向依赖**（分层违规）。同形先例：`src/infrastructure/task_history.ts`。
 *
 * ## 为什么它必须从设计册里搬出去（可判读数，不是"太大了"这种风格话）
 * `decision_history` 是**日志**，不是**意图**：每册 46.2% 的字节是它（实测 15.12 MB 里 6.99 MB；
 * `task-system-plan` 单册 53.4%），而它是**只增不改的栈** ⇒ 册里每加一条判据都要重写整册
 * ⇒ `git diff` 不可评审、冲突不可合并、LLM 读册必爆上下文（`docs/todo.md` R54）。
 *
 * ## 为什么是「与册同目录的 JSONL」而不是别的三个候选（逐个排除过，同 `todo_journal.ts` 口径）
 * | 候选 | 为什么不 |
 * |---|---|
 * | 册里的另一个字段（内联） | 就是**现状**：只增不改 ⇒ 每次 append 重写整册 |
 * | `cache.db` | 它是**可重建的事实索引**（不入库）⇒ 一次 `import_project` 就把历史冲掉；而历史是**事件** |
 * | `.agentio-data/` | `git` 不跟踪它（实测 `check-ignore` ⇒ ignored=True）⇒ 掉出 git 档案 |
 * | `overlay` | 2026-10-19 已裁「decision / decision_history 只住 design/」，overlay 只持运行时 |
 * ⇒ `.agent-io/design/<feature>.history.jsonl`：与册**同目录同归属**、**进 git 白名单**（`.gitignore` 的
 *   `!/.agent-io/design/**`）、且**不会被任何工具误认为册**（全仓 6 处设计目录枚举都 `endsWith('.dsl.json')`）。
 *   ★ 同目录**已有先例** `todo_journal.ts`（`<f>.journal.jsonl`）—— 本文件照抄它的形态，不新造机制。
 *
 * ## append-only 的三条不变量（违反任意一条就不是日志了）
 * 1. **只加不减**：一条 entry 写进去以后，任何代码都不许改它 / 删它。
 *    唯一的"减"是 `decision:null`（清整张卡）—— 它**不是删行**，而是**追加一条 `kind:'clear'` 标记**
 *    （读端见到它就把该节点此前条目作废）。★ 这条把"静默清空历史"变成"**有留痕的清空**"：
 *    旧实现 `node_ops.ts` 是 `delete node.decision_history`，清完**盘上一点痕迹都没有**。
 * 2. **不解释、不规范化**：`entry` **原样** `JSON.stringify`。★ 实测（2026-11-06）历史条目里带着
 *    当前 `NodeDecision` **没有**的字段（`provenance` 250 条 · `creator`/`source`/`handoff` 各 85 条）
 *    ⇒ 任何"过一遍类型 / 白名单 / 默认值"的实现都会**静默丢掉它们**（而字节守恒判据会抓到）。
 * 3. **坏行不静默吞**：截断 / 手改的行**计数**返回，读端必须报出来（照 `todo_journal#readTodoTombstones`）。
 *
 * ## 已知代价（如实声明，别当成没做）
 * 它**没有**册的 `_dsl_rev` 乐观锁 ⇒ 并发靠**单写者**（`edit_dsl` 的 `runDslWriteScope` / daemon 单写口串行）。
 * 代价是"两个进程同时 append 可能交错"；对策是**坏行计数**（交错行会读不出 ⇒ 门红），不是假设不会发生。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDesignSheetFile } from './storage.js';

/**
 * 行分隔符（JSONL 的**协议**部分，不跟随平台换行）。
 * ★ 与 `todo_journal.ts` 同一个理由：Windows 上换 EOL 会把回车混进 JSON 字段。
 */
const LF = String.fromCharCode(10);

/** 一条历史 entry 的**原文**（`unknown` 是刻意的：见不变量 2，这里**不许**过类型） */
export type RawHistoryEntry = Record<string, unknown>;

/** 正常行：某节点的第 `index` 条历史 */
interface HistoryLineItem {
  node_id: string;
  index: number;
  entry: RawHistoryEntry;
}

/** 清卡标记：该节点此前条目作废（`decision:null` 的唯一形态，append-only 下唯一合法的"减"） */
interface HistoryLineClear {
  node_id: string;
  kind: 'clear';
  at: string;
}

export type HistoryLine = HistoryLineItem | HistoryLineClear;

/** 侧车读端读数（★ 每个数都有分母语义，别只取 `byNode`） */
export interface HistoryIndex {
  /** 节点 id → 当前有效条目（已按 `clear` 标记作废过） */
  byNode: Map<string, RawHistoryEntry[]>;
  /** **读不出的行数**（截断 / 手改 / 并发交错）—— 不许静默吞 */
  bad_lines: number;
  /** 侧车文件不存在（★ 与"存在但空"是两件事，见 `resolveHistory` 的 `unreadable`） */
  missing: boolean;
  /** 有效条目总数（= 各节点拼接后的长度和） */
  lines: number;
  /** `clear` 标记条数（有留痕的清空次数） */
  clears: number;
}

/**
 * 侧车路径：**与设计册同目录** `<baseDir>/.agent-io/design/<feature>.history.jsonl`。
 * ★ 从 `getDesignSheetFile(feature, baseDir)` 取目录（不在这里再拼一次 `.agent-io/design`）——
 *   设计册搬过一次家（`features/` → `design/`），**路径只有一个出处**才不会重演（同 `todoJournalFile`）。
 *
 * ★ `baseDir`（项目根）口径：与册的 `booksForAudit` cwd 直读**同目录解析**——门脚本从
 *   `process.cwd()/.agent-io/design/*.dsl.json` 直读册，侧车必须落在同一目录，不许重走注册表
 *   （`projects.json` 不入库；CI clean-clone 注册表空 ⇒ 旧口径落点分叉、侧车读不到）。
 *   缺省 `undefined` ⇒ 维持既有注册表 → 锚点 → 数据家解析（其他运行时读端不传，口径不变）。
 */
export function historyLogFile(feature: string, baseDir?: string): string {
  return path.join(path.dirname(getDesignSheetFile(feature, baseDir)), `${feature}.history.jsonl`);
}

/**
 * 追加历史条目（★ 唯一写端；幂等**不由本函数保证**，由调用方按 `(node_id, index)` 决定起点）。
 *
 * @param startIndex 该节点**当前有效条目数**（调用方从 `resolveHistory` 取，别再数一遍）
 * @returns 落盘文件路径 + 实际追加条数
 */
export function appendHistoryEntries(
  feature: string,
  nodeId: string,
  startIndex: number,
  entries: readonly RawHistoryEntry[],
): { file: string; appended: number } {
  const file = historyLogFile(feature);
  if (!entries.length) return { file, appended: 0 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = entries
    .map((entry, i) => {
      const line: HistoryLineItem = { node_id: nodeId, index: startIndex + i, entry };
      // ★ 字符串里混进 LF 时 JSON.stringify 会转义成 `\n`（合法 JSON），但**手写**的行不会
      //   ⇒ 读端靠 `bad_lines` 抓；这里只保证自己写出去的**一行一条**。
      return JSON.stringify(line) + LF;
    })
    .join('');
  fs.appendFileSync(file, text, 'utf-8');
  return { file, appended: entries.length };
}

/** 追加一条「清卡」标记（`decision:null` 的唯一合法形态：留痕的作废，不是删行） */
export function appendHistoryClear(feature: string, nodeId: string, at: string): string {
  const file = historyLogFile(feature);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line: HistoryLineClear = { node_id: nodeId, kind: 'clear', at };
  fs.appendFileSync(file, JSON.stringify(line) + LF, 'utf-8');
  return file;
}

/**
 * 保证侧车**存在**（空文件也算）—— **建册时**调用一次（`import_project` 的 fork/重建落盘块）。
 *
 * ★ 为什么"空文件也要建"：`resolveHistory` 用**文件是否存在**区分两种"没有历史"：
 *   · 存在但空 ⇒ 合法的「这本册还没人改过决策」；
 *   · 不存在   ⇒ 「这本册是外置形态却没有家」= **读不到**（会响亮报错）。
 *   ⇒ 若不在建册时建，**每一个新建 feature 都会一直报"读不到"** —— 那就是 0.16 说的"永远会亮的灯"。
 */
export function ensureHistoryLog(feature: string): string {
  const file = historyLogFile(feature);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf-8');
  return file;
}

/**
 * 读回某 feature 的全部历史（按落盘顺序）。
 * ★ 文件不存在 ⇒ `missing: true`（**不是**"没有历史"—— 那要由 `resolveHistory` 结合内联一起判）。
 * @param baseDir 项目根；传给册同目录解析（门脚本传 cwd）。缺省维持注册表/数据家口径。
 */
export function readHistoryLog(feature: string, baseDir?: string): HistoryIndex {
  const file = historyLogFile(feature, baseDir);
  const byNode = new Map<string, RawHistoryEntry[]>();
  if (!fs.existsSync(file)) return { byNode, bad_lines: 0, missing: true, lines: 0, clears: 0 };
  let bad = 0;
  let clears = 0;
  for (const raw of fs.readFileSync(file, 'utf-8').split(LF)) {
    const s = raw.trim();
    if (!s) continue;
    let o: HistoryLine;
    try {
      o = JSON.parse(s) as HistoryLine;
    } catch {
      bad++;
      continue;
    }
    if (!o || typeof o !== 'object' || typeof (o as HistoryLineItem).node_id !== 'string') {
      bad++;
      continue;
    }
    const id = (o as HistoryLineItem).node_id;
    if ((o as HistoryLineClear).kind === 'clear') {
      clears++;
      byNode.set(id, []);
      continue;
    }
    const it = o as HistoryLineItem;
    if (!it.entry || typeof it.entry !== 'object') {
      bad++;
      continue;
    }
    const arr = byNode.get(id) ?? [];
    arr.push(it.entry);
    byNode.set(id, arr);
  }
  let lines = 0;
  for (const arr of byNode.values()) lines += arr.length;
  return { byNode, bad_lines: bad, missing: false, lines, clears };
}

/** 一批节点的历史索引（★ 批量读端**只读一次盘**，别在循环里 `readHistoryLog`） */
export function loadHistoryIndex(feature: string, baseDir?: string): HistoryIndex {
  return readHistoryLog(feature, baseDir);
}

/** 历史的来源（★ 四态是**判据**，不是风格：`both` 与 `unreadable` 都必须响亮） */
export type HistorySource =
  /** 册里内联（**旧 commit / 迁移期**形态，允许） */
  | 'inline'
  /** 侧车（迁移后的正常形态） */
  | 'sidecar'
  /** ★ 两处都在 ⇒ 迁移没做干净 / 有人把内联写回来了 ⇒ **必须报错**（0.9.1） */
  | 'both'
  /** 两侧都空，但**该册是外置形态却没有侧车** ⇒ **读不到**，不许说"没有修订"（0.9.4 第 1 行） */
  | 'unreadable'
  /** 真实的"没有修订过" */
  | 'none';

export interface ResolvedHistory {
  /** 该节点的历史条目（旧→新） */
  entries: RawHistoryEntry[];
  source: HistorySource;
  /** 内联条数（用于 `both` 的报文） */
  inline: number;
  /** 侧车条数（同上） */
  sidecar: number;
}

/**
 * 判某节点的历史从哪来 —— **读端唯一判据入口**（别在别处再写一份 union）。
 *
 * @param node 几何/语义节点（只读 `decision_history`）
 * @param index 已加载的 `HistoryIndex`（批量读端复用同一个，避免 N 次读盘）
 * @param bookHasInline 该册**别处还有内联历史**吗 —— 用来区分"旧册"与"侧车丢了"
 */
export function resolveHistory(
  node: { id: string; decision_history?: unknown },
  index: HistoryIndex,
  bookHasInline: boolean,
): ResolvedHistory {
  const inlineArr = Array.isArray(node.decision_history) ? (node.decision_history as RawHistoryEntry[]) : [];
  const sideArr = index.byNode.get(node.id) ?? [];
  if (inlineArr.length && sideArr.length) {
    return { entries: sideArr, source: 'both', inline: inlineArr.length, sidecar: sideArr.length };
  }
  if (inlineArr.length) return { entries: inlineArr, source: 'inline', inline: inlineArr.length, sidecar: 0 };
  if (sideArr.length) return { entries: sideArr, source: 'sidecar', inline: 0, sidecar: sideArr.length };
  // 两侧都空：册还是内联形态（别处有内联）⇒ 这个节点确实没修订过；
  // 册已是外置形态却没有侧车 ⇒ **读不到**（不许降级成"没有"）。
  if (index.missing && !bookHasInline) {
    return { entries: [], source: 'unreadable', inline: 0, sidecar: 0 };
  }
  return { entries: [], source: 'none', inline: 0, sidecar: 0 };
}

/** 「该册别处还有内联历史吗」—— 一遍扫描即可（批量读端算一次） */
export function bookHasInlineHistory(nodes: readonly { decision_history?: unknown }[]): boolean {
  return nodes.some((n) => Array.isArray(n.decision_history) && n.decision_history.length > 0);
}

/**
 * 把 `both` / `unreadable` 变成**一句响亮的人话**（`null` = 正常态）。
 * ★ 为什么单独一个函数：读端有 7 处，**判据只能有一处**（0.9.1）—— 各处只调用、不各自写判断。
 */
export function historyAnomaly(feature: string, nodeId: string, r: ResolvedHistory): string | null {
  if (r.source === 'both') {
    return (
      `节点 ${nodeId} 的 decision_history **两处都在**：册里内联 ${r.inline} 条 · 侧车 ${r.sidecar} 条` +
      `（${historyLogFile(feature)}）⇒ 迁移没做干净，或有人把内联写回来了。` +
      `修法：跑 \`node scripts/migrate-decision-history.mjs\`（它按 (node,index,sha256) 幂等补齐后删内联）。` +
      `★ 不许"取其中之一"——那正是 0.9.1 要禁的"同一事实两住处"。`
    );
  }
  if (r.source === 'unreadable') {
    return (
      `节点 ${nodeId} 的 decision_history **读不到**：册里没有内联、侧车文件也不存在` +
      `（${historyLogFile(feature)}）⇒ 这本册是外置形态却没有家。` +
      `**这不等于"没有修订过"**（0.9.4 第 1 行：读不到 ≠ 没有）。修法：同上那条迁移命令。`
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 门用审计（`设计 DB 结构` 的子项；逻辑住这里，脚本只印 + 计数）
// ─────────────────────────────────────────────────────────────

export interface HistoryAuditBook {
  feature: string;
  /** 册里还剩多少内联条目（**迁移后必须为 0**） */
  inline: number;
  /** 侧车里有多少有效条目 */
  sidecar: number;
  /** 侧车坏行 */
  bad_lines: number;
  /** 侧车文件缺失 */
  missing: boolean;
  /** 册有内联但侧车不存在 / 两侧都在的节点数（不该出现） */
  both: number;
  /** 结构：节点 id → 条数（棘轮按册比对） */
  perNode: Record<string, number>;
}

export interface HistoryAudit {
  books: HistoryAuditBook[];
  inlineTotal: number;
  sidecarTotal: number;
  badTotal: number;
  missingBooks: string[];
  bothTotal: number;
}

/**
 * 审计一批已经读进来的册（★ 由调用方给 `feature + dsl`，**不在这里枚举目录**：
 * 枚举口径归 `design_line` / 门脚本，本函数只管**判**）。
 * @param baseDir 项目根；侧车与册同目录解析（门脚本传 cwd，与 `booksForAudit` 直读同目录）。缺省维持注册表口径。
 */
export function auditHistory(
  books: readonly { feature: string; nodes: readonly { id: string; decision_history?: unknown }[] }[],
  baseDir?: string,
): HistoryAudit {
  const out: HistoryAuditBook[] = [];
  let inlineTotal = 0;
  let sidecarTotal = 0;
  let badTotal = 0;
  let bothTotal = 0;
  const missingBooks: string[] = [];
  for (const b of books) {
    const idx = readHistoryLog(b.feature, baseDir);
    let inline = 0;
    let both = 0;
    const perNode: Record<string, number> = {};
    for (const n of b.nodes) {
      const il = Array.isArray(n.decision_history) ? n.decision_history.length : 0;
      const sc = idx.byNode.get(n.id)?.length ?? 0;
      inline += il;
      if (il > 0 && sc > 0) both++;
      if (il + sc > 0) perNode[n.id] = il + sc;
    }
    out.push({
      feature: b.feature,
      inline,
      sidecar: idx.lines,
      bad_lines: idx.bad_lines,
      missing: idx.missing,
      both,
      perNode,
    });
    inlineTotal += inline;
    sidecarTotal += idx.lines;
    badTotal += idx.bad_lines;
    bothTotal += both;
    if (idx.missing) missingBooks.push(b.feature);
  }
  return { books: out, inlineTotal, sidecarTotal, badTotal, missingBooks, bothTotal };
}
