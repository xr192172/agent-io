/**
 * book —— 翻译 DB 的**生成器**（Go→TS 正向；从 cache.db 派生 symbols / shapes / external_deps，types / atoms 是人写的，不覆盖）
 *
 * ## 与设计侧同构（I3，2026-10-25）
 * 设计侧模式：设计 DSL（意图）→ 设计 DB（投影）→ 往下写实际代码。
 * 翻译侧复刻同一条：**翻译 DSL（映射判据 symbols[].judgments）→ 翻译 DB（对应物投影 symbols[].to）
 * → 往下写翻译代码**（`fill.ts` / `prompts.ts` 消费投影事实与术语表填孔）。
 * ★ 本文件改造前方向是反的（TS→Go），翻译管线（Go→TS）根本不消费它 ⇒ 现改为 Go→TS 正向，
 *   源侧 = `cache.db` 里 `language='go'` 的节点（内核支持 .go 索引），目标侧 = TS 对应物。
 *
 * ## 它解决什么（为什么不能手写）
 * 账要一一对应到源侧每个导出符号。手写几条就到极限 ⇒ 账必须从**事实库**派生，人只维护
 * 「术语映射」（`types`）与「原子规则」（`atoms`）那两小块。
 *
 * ## 复跑语义（改术语表 ⇒ 重跑 ⇒ 账跟着变）
 * 输入 = 现成册子的 `types` / `atoms` / `external_deps`（人填的 strategy）/ 人写的行；
 * 输出 = 重算后的 `symbols` / `shapes` / `external_deps`（from 集合）。
 * 合并规则（按 `from` = `nodes.id` 对齐）：
 *   · `state` 属于 {translated, verified, diff, stubbed} ⇒ **保留**（人的进度，不倒退）；
 *   · `state=blocked` 且 note **不以 `[auto]` 开头** ⇒ **保留**（人判的阻断）；
 *   · 其余 ⇒ 重算 `to` / `state` / 自动 note；**人写的 note 一律保留**（有就用有的）。
 *   · `origin=added`（源侧不存在的目标符号）⇒ **原样保留**，不过生成器管。
 *
 * ## 覆盖判据（「还差哪几条术语」的唯一来源）
 * 一个符号被判 `blocked` 当且仅当它的类型面里出现了**术语表覆盖不到的名字**：
 * 不是 Go 内建、不是泛型参数、不是仓内声明的类型（type/interface/struct）、
 * **也不是 `types` 里登记过且 `to` 有具体目标的源词**。`to:null` 的源词**不算覆盖**：
 * 那是「定完了、结论是翻不了」⇒ 仍 blocked，但计数单列 `blockedByTermNull`（两种病不混一个数）。
 *
 * ## blocked 四档（自动档；人工 blocked 不在档内，单列）
 *   ① `term`        —— 术语表未覆盖（补 types 后重跑即解锁）
 *   ② `term_null`   —— 术语已定但无 TS 目标（要改的是结构，不是名字）
 *   ③ `collision`   —— 同名撞车（多个源符号机械映射到同一 `to`，需人工改名）
 *   ④ `external_dep` —— 外部硬依赖：该文件的 import 里有非 stdlib 的 Go 包（首段含 '.'），
 *      TS 侧没有对应物 ⇒ 先在 `external_deps` 区块给该依赖定 strategy 再翻（见下）。
 *
 * ## 硬依赖清单区块 `external_deps`（回执同型，见 `receipt.ts` 的 ExternalDep）
 *   · `from` = Go import 路径；`strategy` ∈ {'' | 'npm_equiv' | 'same_slot' | 'http_bridge}，**初始空由模型/人填**；
 *   · 人的 strategy **不倒退**（按 `from` 合并保留）；`usedBy` = 引用它的源 .go 文件（每次重算）。
 *
 * ## 入账面的两档
 *   · `exported` —— Go 的导出规则是**首字母大写**（不靠 modifiers 列），全仓导出符号进账；
 *   · `internal` —— 小写开头的未导出符号，**只收「已经有进度」的文件**（该文件里至少一条导出符号 ∈
 *     {stubbed, translated, verified, diff}）。不做全仓私有符号普查（读数失真）。
 *   · `to` 是**机械可算的目标名**（路径换 .ts 后缀 + 符号名），与翻译管线同一条命名约定
 *     （`go_extractor.ts`：方法 → `${recvType}_${method}` 自由函数；顶层符号名原样保留）——
 *     这就是「按图索骥」的图：投影的 `to` 与 `fill.ts` 实际产出的骨架同名。
 *   · 结构型类型（匿名结构 / 真函数类型 / map / chan）没有身份 ⇒ 进 `shapes` 按类聚合，不逐条造 id。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Expectation } from '../../../domain/expectation.js';
// 签名投影复用管线的同一把类型映射尺（fill.ts 生成骨架用的就是它）—— 不新造第二把
import { mapGoType } from './ts_codegen.js';
// 管线消费：投影事实注入 TransUnit（unit.ts 只放协议与纯常量，无环）
import type { TransUnit } from './unit.js';

// ── 类型 ────────────────────────────────────────────────────────────────

export interface BookSymbol {
  from: string | null;
  to: string | null;
  kind: string;
  /**
   * 入账面两档：`exported` = Go 首字母大写（含导出类型的方法）；`internal` = 未导出，
   * 只在「它所在文件已经有进度」时才进账（判据见 {@link readSymbolRows}）。
   */
  scope: 'exported' | 'internal';
  origin: 'source' | 'added';
  state: string;
  note?: string;
  /**
   * ★ I3 翻译 DSL 段：**映射判据**（per-symbol）—— 复用 `domain/expectation.ts` 的既有 kinds，
   *   **不新造 kind**：① `symbol-exists`（对应物存在）② `signature-matches`（签名匹配，能机械渲染才挂）
   *   ③ `source-has`（术语命中：译出的 TS 文件必须使用术语表给定的对应物名）。
   *   判据红了 = 那个映射还没兑现；这就是「翻译 DSL（意图）→ 翻译 DB（投影）」里意图的那一半。
   */
  judgments?: Expectation[];
}

export interface BookShape {
  /** 稳定键（func / map / chan）—— unknowns 按它引用，不按数组下标 */
  id?: string;
  from: { shape: string };
  to: { shape: string } | null;
  origin: 'source' | 'added';
  count?: number;
  samples?: string[];
  note?: string;
}

/** 硬依赖清单条目（★ strategy 初始空，由模型/人填；人的填写不倒退） */
export type ExternalDepStrategy = '' | 'npm_equiv' | 'same_slot' | 'http_bridge';

export interface BookExternalDep {
  /** 非 stdlib 的 Go import 路径（首段含 '.'，如 github.com/x/y） */
  from: string;
  strategy: ExternalDepStrategy;
  note?: string;
  /** 引用该依赖的源 .go 文件（仓库相对路径；每次重算） */
  usedBy?: string[];
}

/** 册子的宽松形状：只强类型化本模块**读写**的块，其余原样透传。 */
export interface TranslateBook {
  id: string;
  kind: string;
  version: number;
  feature: string;
  meta: Record<string, unknown>;
  types: Array<Record<string, unknown>>;
  symbols: BookSymbol[];
  shapes: BookShape[];
  atoms: Array<Record<string, unknown>>;
  unknowns: Array<Record<string, unknown>>;
  /** ★ I3 硬依赖清单（升格自 diagnostic）：TS 侧无对应物的外部 Go 依赖，strategy 待填 */
  external_deps?: BookExternalDep[];
  [k: string]: unknown;
}

export interface BookGenOptions {
  /** 被分析项目根（cache.db 所在） */
  projectDir: string;
  /** 要读写的册子路径 */
  bookPath: string;
  /** 源侧前缀与目标侧前缀（缺省都为空：Go→TS 镜像相对路径，只换 .go → .ts 后缀） */
  srcPrefix?: string;
  targetPrefix?: string;
  /** 生成时刻（可注入，便于测试确定性） */
  now?: string;
  /** 只算不写（`rebuildBook` 的 dry_run）：返回的 size 是「若写回会是多大」 */
  dryRun?: boolean;
  /** 调用方声明的目标语言（如 `ts`）：与册子 `meta.target_language` 不符 ⇒ 抛（不就地改语义） */
  expectTargetLanguage?: string;
}

export interface BookGenStats {
  symbols: number;
  /** ★ 其中 scope='internal' 的条数（只统计「已动过文件」的未导出符号） */
  internalSymbols: number;
  pending: number;
  blocked: number;
  added: number;
  blockedByTerm: number;
  /** ★ 术语已定但 `to:null`（真没有对应）⇒ 仍 blocked，但**不是**「术语表欠一条」 */
  blockedByTermNull: number;
  blockedByCollision: number;
  /** ★ I3 第四档：外部硬依赖（import 非 stdlib Go 包，TS 侧无对应物） */
  blockedByExternalDep: number;
  shapes: number;
  scanRev: number | null;
  dbSchemaVersion: number | null;
  srcFiles: number;
}

/** 一行 nodes 事实（只取生成器要用的列）。 */
interface NodeRow {
  id: string;
  kind: string;
  name: string;
  file_path: string;
  start_line: number;
  parent: string | null;
  return_type: string | null;
  params: string | null;
  members: string | null;
  type_params: string | null;
  modifiers: string | null;
}

// ── 词表（唯一住处：本文件）─────────────────────────────────────────────

/** Go 内建 / 类型表达式里的结构词（不算「需要术语的类型名」）。 */
const GO_NOMINAL = new Set([
  'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
  'float32', 'float64', 'complex64', 'complex128', 'byte', 'rune', 'string', 'bool', 'any', 'error',
  'interface', 'struct', 'map', 'chan', 'func', 'nil', 'true', 'false', 'len', 'cap', 'make', 'new', 'append',
]);

/** 自动判定的 blocked 必须带这个前缀（与人工 blocked 区分；见文件头「复跑语义」）。 */
const AUTO_TAG = '[auto]';
/** 人不该被生成器覆盖的状态。 */
const STICKY_STATES = new Set(['translated', 'verified', 'diff', 'stubbed']);

// ── 名字映射（与翻译管线同一条约定）───────────────────────────────────

/**
 * 源路径 → TS 目标路径：镜像相对路径，只换 `.go` → `.ts` 后缀。
 * ★ 与 `project.ts` 的 `tsRel = rel.replace(/\.go$/, '.ts')` 同一条规则（管线落盘就落在这）。
 */
export function tsPath(filePath: string, srcPrefix = '', targetPrefix = ''): string {
  const rel = srcPrefix && filePath.startsWith(srcPrefix) ? filePath.slice(srcPrefix.length) : filePath;
  return targetPrefix + rel.replace(/\.go$/, '.ts');
}

/**
 * 目标符号名（**机械可算**，与 `go_extractor.ts` 的管线命名逐字同源）：
 * · 方法 → `${recvType}_${method}` 自由函数（go_extractor.ts:187 的防撞名约定）；
 * · 顶层符号 → Go 名原样保留（骨架 `export function ${u.name}` 用的就是原名）。
 */
export function tsSymbolName(row: NodeRow): string {
  if (row.kind === 'method' && row.parent) return `${row.parent}_${row.name}`;
  return row.name;
}

// ── 类型面分析 ──────────────────────────────────────────────────────────

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
const stripLiterals = (s: string): string => s.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ');

/** 一个节点的全部类型表达式（返回 / 形参 / 成员）。★ 先剥注释 —— 不剥会数出注释里的英文词。 */
export function typeExpressions(row: NodeRow): string[] {
  const out: string[] = [];
  if (row.return_type) out.push(row.return_type);
  for (const p of parseJson<Array<{ type?: string }>>(row.params, [])) if (p?.type) out.push(p.type);
  for (const m of parseJson<Array<{ type?: string }>>(row.members, [])) if (m?.type) out.push(m.type);
  return out;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // 坏 JSON 不猜（本仓铁律：没跑 ≠ 跑过）
  }
}

/** 该节点声明的泛型参数名（`[T any]` / `<T>` 两种写法都认）。 */
function genericNames(row: NodeRow): Set<string> {
  const out = new Set<string>();
  for (const t of parseJson<Array<string | { name?: string }>>(row.type_params, [])) {
    const n = typeof t === 'string' ? t.trim().split(/[\s:<>\s]/)[0] : t?.name;
    if (n) out.add(String(n));
  }
  return out;
}

/**
 * 找出**术语表覆盖不到**的类型名（blocked 的唯一判据）。
 * ★ Go→TS 口径：类型表达式里的标识符（剥注释/字面量/限定前缀 `pkg.Type` 的 `pkg.`），
 *   排除 Go 内建（{@link GO_NOMINAL}）、仓内声明类型、泛型参数、术语表已覆盖的词。
 * ★ 不按大小写过滤：Go 未导出类型是小写开头，同样是「需要术语」的词（与 TS→Go 旧口径的差异，故改名 unmappedGoTypes）。
 */
export function unmappedGoTypes(
  row: NodeRow,
  declared: ReadonlySet<string>,
  covered?: ReadonlySet<string>,
): string[] {
  const generics = genericNames(row);
  const bad = new Set<string>();
  for (const expr of typeExpressions(row)) {
    const text = stripLiterals(stripComments(expr)).replace(/\b\w+\./g, ' ');
    for (const m of text.matchAll(/[A-Za-z_][\w]*/g)) {
      const w = m[0];
      if (GO_NOMINAL.has(w) || declared.has(w) || covered?.has(w) || generics.has(w)) continue;
      if (w.length < 2) continue; // 单字母 = 泛型实参或占位
      bad.add(w);
    }
  }
  return [...bad].sort();
}

/** 术语表 → 「哪些源词算覆盖」的读数（生成器**唯一**的术语消费点）。 */
export interface TermTable {
  /** `types[].to` 有具体目标 ⇒ 覆盖即解锁（该符号转 pending） */
  covered: Set<string>;
  /** ★ 源词 → 术语表给定的 TS 对应物名（judgments 的术语命中判据从这取 must） */
  coveredTo: Map<string, string>;
  /** `types[].to === null`（真没有对应）⇒ **仍 blocked**，但理由换成「已定但无目标」 */
  nullTarget: Map<string, { from: string; note: string }>;
}

/**
 * 把**人写的** `book.types` 折成覆盖读数。
 *
 * ★ 为什么两档（别合并成一个 Set）：`to:null` 是本册承认的**第三种答案**（「真没有对应」），
 *   它的语义是「待人工改结构」—— 与「术语表还欠一条」**不是**同一件事。
 *   合并了就会把「没人定」和「定完了、结论是翻不了」混成一个数。
 *
 * ★ 源词怎么拆：`types[].from` 是人写的一句话 ⇒ 取其中**非 Go 内建、长度 ≥ 2** 的标识符
 *   （剥限定前缀；与 {@link unmappedGoTypes} 同一把尺）。Go 未导出类型是小写开头 ⇒ 不按大小写过滤。
 */
export function termCoverage(types: ReadonlyArray<Record<string, unknown>>): TermTable {
  const covered = new Set<string>();
  const coveredTo = new Map<string, string>();
  const nullTarget = new Map<string, { from: string; note: string }>();
  for (const t of types) {
    const from = typeof t.from === 'string' ? t.from : '';
    const note = typeof t.note === 'string' ? t.note : '';
    const to = typeof t.to === 'string' && t.to.trim() !== '' ? t.to.trim() : null;
    for (const m of from.replace(/\b\w+\./g, ' ').matchAll(/[A-Za-z_][\w]*/g)) {
      const w = m[0];
      if (GO_NOMINAL.has(w) || w.length < 2) continue;
      if (to === null) nullTarget.set(w, { from, note });
      else {
        covered.add(w);
        coveredTo.set(w, to);
      }
    }
  }
  return { covered, coveredTo, nullTarget };
}

// ── shapes 分类 ─────────────────────────────────────────────────────────

interface ShapeCat {
  id: string;
  label: string;
  to: { shape: string } | null;
  match: (s: string) => boolean;
}

const SHAPE_CATS: ShapeCat[] = [
  {
    id: 'func',
    label: 'func(...) ...（函数类型）',
    to: { shape: '(p: T) => U' },
    match: (s) => /func\s*\(/.test(s),
  },
  {
    id: 'map',
    label: 'map[K]V（Go 内建映射）',
    to: { shape: 'Record<K, V>' },
    match: (s) => /(^|[^\\w])map\s*\[/.test(s),
  },
  {
    id: 'chan',
    label: 'chan T（通道）',
    to: { shape: 'Channel<T>（垫片，语义近似）' },
    match: (s) => /\bchan\b/.test(s),
  },
];

function classifyShape(expr: string): ShapeCat | null {
  const text = stripLiterals(stripComments(expr)).trim();
  if (!text) return null;
  for (const cat of SHAPE_CATS) if (cat.match(text)) return cat;
  return null;
}

// ── 读库 ────────────────────────────────────────────────────────────────

function openBookDb(projectDir: string): DatabaseSync {
  const dbFile = path.join(projectDir, '.agent-io', 'cache.db');
  if (!fs.existsSync(dbFile)) {
    throw new Error(
      `翻译册生成失败：找不到事实库 ${dbFile}。\n` +
        `★ 账必须从事实派生（不手写）；先对 ${projectDir} 跑一次索引（import_project / explore_code）再来。`,
    );
  }
  return new DatabaseSync(dbFile, { readOnly: true }); // ★ 只读：生成器不改事实
}

/**
 * 取「该进账的符号」：导出（首字母大写）节点 + **小写开头的未导出节点（仅 activeFiles）**。
 * ★ Go 的导出规则 = **首字母大写**（大小写即导出，不靠 modifiers 列）。
 * ★ 方法按 `(file_path, parent=receiver 类型名)` 关联；方法自己的导出性由**方法名**大小写决定。
 *
 * ★★ 同时返回 `extFiles`：import 了**非 stdlib Go 包**（首段含 '.'，与 `tool.ts#externalImportsOf` 同一判据）
 *   的源文件 → 依赖路径清单（blocked 第四档 `external_dep` 的判据 + `external_deps` 区块的数据源）。
 *   包导入记录在 `imports` 表（kind='package'，v16 起挂 files.id 外键）。
 */
function readSymbolRows(
  db: DatabaseSync,
  activeFiles: ReadonlySet<string>,
): { rows: NodeRow[]; internalRows: NodeRow[]; srcFiles: number; extFiles: Map<string, string[]> } {
  const cols = `id, kind, name, file_path, start_line, parent, return_type, params, members, type_params, modifiers`;
  const base = `language='go' AND file_path LIKE '%.go' AND file_path NOT LIKE '%_test.go' AND file_path NOT LIKE '%/vendor/%' AND file_path NOT LIKE 'vendor/%'`;
  const kindIn = `kind IN ('function','method','const','var','type','interface','class','struct')`;
  // Go 导出 = 首字母大写：GLOB '[A-Z]*'
  const direct = db
    .prepare(`SELECT ${cols} FROM nodes WHERE ${base} AND ${kindIn} AND name GLOB '[A-Z]*' ORDER BY file_path, start_line`)
    .all() as unknown as NodeRow[];
  // 未导出：小写开头；只收「已动过文件」
  const files = [...activeFiles];
  const internalRows = files.length
    ? (db
        .prepare(
          `SELECT ${cols} FROM nodes WHERE language='go' AND file_path IN (${files.map(() => '?').join(',')})` +
            ` AND ${kindIn} AND name NOT GLOB '[A-Z]*' ORDER BY file_path, start_line`,
        )
        .all(...files) as unknown as NodeRow[])
    : [];
  const srcFiles = (
    db.prepare(`SELECT count(*) AS c FROM files WHERE language='go' AND path LIKE '%.go' AND path NOT LIKE '%_test.go'`).get() as { c: number }
  ).c;
  // 外部硬依赖：imports(kind='package') 且首段含 '.'（Go stdlib 首段无域名点）
  const extFiles = new Map<string, string[]>();
  try {
    const rows = db
      .prepare(
        `SELECT f.path AS fp, i.source AS src FROM imports i JOIN files f ON f.id = i.file_id ` +
          `WHERE f.language='go' AND i.kind='package'`,
      )
      .all() as Array<{ fp: string; src: string }>;
    for (const r of rows) {
      if (!r.src || !r.src.split('/')[0].includes('.')) continue; // stdlib 不算外部硬依赖
      const arr = extFiles.get(r.fp) ?? [];
      if (!arr.includes(r.src)) arr.push(r.src);
      extFiles.set(r.fp, arr);
    }
  } catch {
    // imports 表缺失（旧 schema）⇒ 外部依赖判不了：不出 blockedByExternalDep，也不伪造
  }
  const byPos = (a: NodeRow, b: NodeRow): number =>
    a.file_path === b.file_path ? a.start_line - b.start_line : a.file_path < b.file_path ? -1 : 1;
  // ★ rows = 导出面（含大写方法，方法靠 parent 关联 receiver 类型）；internalRows = 小写节点（仅 activeFiles）
  return { rows: direct.sort(byPos), internalRows: internalRows.sort(byPos), srcFiles, extFiles };
}

// ── 生成 ────────────────────────────────────────────────────────────────

/** 把一段人写的 note 压成「首句（+ 截断标记）」—— ★ 截断必须标注：没标注的截断会被读成「全文就这么长」。 */
function briefNote(note: string | undefined, max = 240): string {
  if (!note) return '（types 里没写 note —— 这是缺的，补上）';
  const first = note.split('\n')[0];
  return first.length > max ? `${first.slice(0, max)}…（★ 已截断，全文见 types 里该条）` : first;
}

function autoNote(row: NodeRow, bad: string[], target: string): string {
  if (bad.length) return `${AUTO_TAG} 术语表未覆盖：${bad.join(', ')} ⇒ 先补 types（或判它 \`added\`），再翻 ${target}。`;
  return ''; // ★ pending 不写逐行样板话（「pending 是什么」住 meta.state_machine）
}

/**
 * 映射判据的**签名渲染**：用管线同一把尺（mapGoType）把 Go 形参/返回类型映成 TS。
 * 任一段 `unsupported` ⇒ 返回 null（**不装**：渲染不出的签名不挂 signature-matches 判据）。
 * ★ 只对 `kind='function'` 挂：方法（method）的投影名是 `${recvType}_${method}` 自由函数，
 *   但 cache.db 的 method 行不带 receiver 形参 ⇒ 渲出的签名会**漏首参**（假红），故跳过。
 */
function renderTsSignature(row: NodeRow, toName: string): string | null {
  if (row.kind !== 'function') return null;
  const parts: string[] = [];
  for (const p of parseJson<Array<{ name?: string; type?: string }>>(row.params, [])) {
    if (!p.type) return null;
    const m = mapGoType(p.type);
    if (m.degree === 'unsupported') return null;
    parts.push(`${p.name ?? 'arg'}: ${m.ts}`);
  }
  let ret = '';
  if (row.return_type) {
    const m = mapGoType(row.return_type);
    if (m.degree === 'unsupported') return null;
    ret = `: ${m.ts}`;
  }
  return `export function ${toName}(${parts.join(', ')})${ret}`;
}

/**
 * 该符号类型面里**术语表已覆盖**的词（judgments 术语命中判据的数据源）。
 * ★ 不能从 `unmappedGoTypes` 的结果过滤 —— 那里 covered 词已被剔除（覆盖即不算 unmapped）⇒ 会恒空。
 */
function coveredTermHits(row: NodeRow, declared: ReadonlySet<string>, terms: TermTable): string[] {
  const generics = genericNames(row);
  const hits = new Set<string>();
  for (const expr of typeExpressions(row)) {
    const text = stripLiterals(stripComments(expr)).replace(/\b\w+\./g, ' ');
    for (const m of text.matchAll(/[A-Za-z_][\w]*/g)) {
      const w = m[0];
      if (GO_NOMINAL.has(w) || declared.has(w) || generics.has(w) || w.length < 2) continue;
      if (terms.covered.has(w)) hits.add(w);
    }
  }
  return [...hits].sort();
}

/** 该符号的**映射判据**（翻译 DSL 段；复用 expectations kinds，不新造 kind —— 见 BookSymbol.judgments）。 */
function buildJudgments(row: NodeRow, targetPath: string, toName: string, termHits: string[], terms: TermTable): Expectation[] {
  const out: Expectation[] = [];
  out.push({
    kind: 'symbol-exists',
    path: targetPath,
    symbol: toName,
    why: `翻译 DB 投影：Go 符号 ${row.id} 的 TS 对应物应存在（按图索骥）`,
  });
  const sig = renderTsSignature(row, toName);
  if (sig) {
    out.push({
      kind: 'signature-matches',
      path: targetPath,
      symbol: toName,
      signature: sig,
      why: `签名匹配：投影用管线同一把尺（mapGoType）从 Go 签名机械渲染`,
    });
  }
  if (termHits.length) {
    out.push({
      kind: 'source-has',
      path: targetPath,
      must: termHits.map((w) => terms.coveredTo.get(w) ?? w),
      why: `术语命中：译出的 TS 文件必须使用术语表给定的对应物名（${termHits.join(', ')}）`,
    });
  }
  return out;
}

/**
 * 从事实库重建册子（**纯函数式**：不写盘；写盘交给 {@link writeBook}）。
 * ★ 保留 `types` / `atoms` / `unknowns` / `external_deps`（人写的），只重算 `symbols` / `shapes` / `external_deps` 的 from 面。
 */
export function generateBook(book: TranslateBook, opts: BookGenOptions): { book: TranslateBook; stats: BookGenStats } {
  const srcPrefix = opts.srcPrefix ?? '';
  const targetPrefix = opts.targetPrefix ?? '';
  const db = openBookDb(opts.projectDir);
  try {
    // ★ 已动过的文件 = 册上至少一条导出符号处于「人的进度」态（判据只用册上已有 state，不新造第二事实）
    const activeFiles = new Set(
      book.symbols.filter((s) => s.from && STICKY_STATES.has(s.state)).map((s) => String(s.from).split('#')[0]),
    );
    const { rows, internalRows, srcFiles, extFiles } = readSymbolRows(db, activeFiles);
    const declared = new Set(
      (
        db.prepare(`SELECT DISTINCT name FROM nodes WHERE language='go' AND kind IN ('type','interface','class','struct')`).all() as Array<{ name: string }>
      ).map((r) => r.name),
    );
    const scanRev = (db.prepare('SELECT max(indexed_at) AS m FROM files').get() as { m: number | null }).m;
    let schemaVersion: number | null = null;
    try {
      schemaVersion = (db.prepare('SELECT max(version) AS v FROM schema_versions').get() as { v: number | null }).v;
    } catch {
      schemaVersion = null;
    }

    const before = new Map(book.symbols.filter((s) => s.from).map((s) => [s.from as string, s]));
    // origin=added 的原样保留；只补一个缺省 scope（老册子没有这个键）。★ 内容不重算。
    const kept: BookSymbol[] = book.symbols.filter((s) => !s.from).map((s) => ({ ...s, scope: s.scope ?? ('exported' as const) }));
    // ★ 人写的术语表**参与**覆盖判定（否则「补 types 后重跑即解锁」是空话）
    const terms = termCoverage(book.types);

    // 先算 to（撞车要按 target 分组，得先全算完）
    // ★ 两档走**同一段**逻辑：scope 只决定「进不进账」，状态机/术语覆盖/撞车判据一个字都不分叉。
    const mapped = [
      ...rows.map((row) => ({ row, scope: 'exported' as const })),
      ...internalRows.map((row) => ({ row, scope: 'internal' as const })),
    ].map(({ row, scope }) => {
      const target = tsPath(row.file_path, srcPrefix, targetPrefix);
      const to = `${target}#${tsSymbolName(row)}`;
      const bad = unmappedGoTypes(row, declared, terms.covered);
      // ★ 同一个 bad 里混着两种病：真正「没人定」vs「定完了、结论是翻不了（to:null）」⇒ 分开
      const uncovered = bad.filter((n) => !terms.nullTarget.has(n));
      const nullTerms = bad.filter((n) => terms.nullTarget.has(n));
      const exts = extFiles.get(row.file_path) ?? [];
      return { row, scope, to, target, bad, uncovered, nullTerms, exts };
    });
    const byTarget = new Map<string, number>();
    for (const m of mapped) if (m.to) byTarget.set(m.to, (byTarget.get(m.to) ?? 0) + 1);

    const symbols: BookSymbol[] = [];
    let blockedByTerm = 0;
    let blockedByTermNull = 0;
    let blockedByCollision = 0;
    let blockedByExternalDep = 0;
    for (const { row, scope, to, target, bad, uncovered, nullTerms, exts } of mapped) {
      const prev = before.get(row.id);
      const collision = (byTarget.get(to) ?? 0) > 1;
      const kind: 'term' | 'term_null' | 'collision' | 'external_dep' | null = uncovered.length
        ? 'term'
        : nullTerms.length
          ? 'term_null'
          : collision
            ? 'collision'
            : exts.length
              ? 'external_dep'
              : null;
      let state = kind ? 'blocked' : 'pending';
      if (kind === 'term') blockedByTerm++;
      if (kind === 'term_null') blockedByTermNull++;
      if (kind === 'collision') blockedByCollision++;
      if (kind === 'external_dep') blockedByExternalDep++;

      const sticky =
        prev &&
        (STICKY_STATES.has(prev.state) || (prev.state === 'blocked' && !(prev.note ?? '').startsWith(AUTO_TAG)));
      if (sticky) state = prev.state;

      const auto =
        kind === 'term_null'
          ? `${AUTO_TAG} 术语已定但无 TS 目标：${nullTerms.join(', ')} ⇒ 要改的是**结构**（字段/参数由什么承载），不是换个类型名；见 unknowns。`
          : kind === 'collision'
            ? `${AUTO_TAG} 同名撞车：${byTarget.get(to)} 个源符号都映射到 ${to} ⇒ 需人工改名。`
            : kind === 'external_dep'
              ? `${AUTO_TAG} 外部硬依赖：本文件 import "${exts[0]}"${exts.length > 1 ? ` 等 ${exts.length} 条` : ''} ⇒ TS 侧无对应物；先在 external_deps 给它定 strategy（npm_equiv / same_slot / http_bridge）再翻。`
              : autoNote(row, uncovered.length ? uncovered : bad, to);

      // ★ 翻译 DSL 段：映射判据挂在**未 blocked** 的符号上（blocked 的先解决术语/依赖，判了也是假红噪音）
      const termHits = state === 'pending' ? coveredTermHits(row, declared, terms) : [];
      const judgments = state === 'pending' ? buildJudgments(row, target, tsSymbolName(row), termHits, terms) : undefined;

      symbols.push({
        from: row.id,
        to,
        kind: row.kind, // ★ 从 nodes.kind 现取，不手写
        scope,
        origin: 'source',
        state,
        // ★ note 优先级：人写的（有且非 [auto]）> 本次自动。有 note 但不 sticky 时也保留人的说明。
        note: prev?.note && !prev.note.startsWith(AUTO_TAG) ? prev.note : auto,
        ...(judgments && judgments.length ? { judgments } : {}),
      });
    }

    // shapes：按类聚合（结构没有身份 ⇒ 不逐条造 id）
    const stats = shapeStats(rows);
    const shapes: BookShape[] = SHAPE_CATS.map((cat) => {
      const s = stats.get(cat.id);
      const prev = book.shapes.find((sh) => sh.from?.shape === cat.label);
      return {
        id: cat.id, // ★ 稳定键：unknowns 按它引用（按数组下标引用会在重排后指错）
        from: { shape: cat.label },
        to: cat.to,
        origin: 'source' as const,
        count: s?.count ?? 0,
        samples: s?.samples ?? [],
        note:
          prev?.note ??
          `${AUTO_TAG} 由生成器从类型表达式分类得到：${s?.distinct.size ?? 0} 种不同写法、${s?.count ?? 0} 处出现。`,
      };
    });

    // unknowns：生成的（`[auto]` 前缀）每次重算；人写的原样保留 —— 「还差哪几条术语」就从这里读
    const termHit = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('术语表未覆盖')) continue;
      const m = String(s.note).match(/术语表未覆盖：([^⇒]+)⇒/);
      for (const t of (m?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const arr = termHit.get(t) ?? [];
        arr.push(s.from as string);
        termHit.set(t, arr);
      }
    }
    const nullTermHit = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('术语已定但无 TS 目标')) continue;
      const m = String(s.note).match(/术语已定但无 TS 目标：([^⇒]+)⇒/);
      for (const t of (m?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const arr = nullTermHit.get(t) ?? [];
        arr.push(s.from as string);
        nullTermHit.set(t, arr);
      }
    }
    const collisionGroups = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('同名撞车')) continue;
      const arr = collisionGroups.get(s.to as string) ?? [];
      arr.push(s.from as string);
      collisionGroups.set(s.to as string, arr);
    }
    // 外部硬依赖：按包分组（与 external_deps 区块同一份数据）
    const extByPkg = new Map<string, string[]>();
    for (const s of symbols) {
      if (s.state !== 'blocked' || !String(s.note).includes('外部硬依赖')) continue;
      const m = String(s.note).match(/import "([^"]+)"/);
      const pkg = m?.[1];
      if (!pkg) continue;
      const arr = extByPkg.get(pkg) ?? [];
      arr.push(s.from as string);
      extByPkg.set(pkg, arr);
    }
    const autoUnknowns: Array<Record<string, unknown>> = [
      ...[...termHit.entries()].map(([t, hits]) => ({
        where: `[auto] 术语表未覆盖 · ${t}`,
        what: `${t} 没有对应术语 ⇒ 引用它的 ${hits.length} 个符号全部 blocked`,
        why:
          `补一条 types（源词 → TS 类型）后重跑生成器即可自动解锁；或判它 \`origin=added\`（目标侧新建）。` +
          `\n  涉及：${hits.slice(0, 5).join(' · ')}${hits.length > 5 ? ` …共 ${hits.length} 个` : ''}`,
      })),
      ...[...nullTermHit.entries()].map(([t, hits]) => ({
        where: `[auto] 术语已定但无 TS 目标 · ${t}`,
        what:
          `types 条目「${terms.nullTarget.get(t)?.from ?? t}」标了 \`to:null\`（真没有对应）` +
          `⇒ 引用它的 ${hits.length} 个符号**仍 blocked**（这不是「术语表欠一条」）`,
        why:
          `先定「这一层由什么承载」（结构问题），再谈这个符号的名字。` +
          `已给定的判据（types 原文首句）：${briefNote(terms.nullTarget.get(t)?.note)}` +
          `\n  涉及：${hits.slice(0, 5).join(' · ')}${hits.length > 5 ? ` …共 ${hits.length} 个` : ''}`,
      })),
      ...(extByPkg.size
        ? [
            {
              where: `[auto] 外部硬依赖 · ${extByPkg.size} 个包 / ${[...extByPkg.values()].reduce((a, v) => a + v.length, 0)} 个符号`,
              what: 'TS 侧没有对应物（非 stdlib Go 包）⇒ 相关符号全部 blocked',
              why:
                `在 external_deps 给每个包定 strategy（npm_equiv=找等价 npm 库 / same_slot=同槽位替身 / http_bridge=HTTP 桥接），strategy 非空后重跑。` +
                `\n  涉及：${[...extByPkg.entries()].slice(0, 6).map(([p, hits]) => `${p} ← ${hits.length} 个`).join(' · ')}`,
            },
          ]
        : []),
      ...(collisionGroups.size
        ? [
            {
              where: `[auto] 同名撞车 · ${collisionGroups.size} 组 / ${[...collisionGroups.values()].reduce((a, v) => a + v.length, 0)} 个符号`,
              what: '多个源符号机械映射到同一目标名 ⇒ 需人工改名（改名哪侧是决定，不是机械替换）',
              why:
                `逐组人工改名。前 6 组：\n  ` +
                [...collisionGroups.entries()]
                  .slice(0, 6)
                  .map(([to, hits]) => `${to} ← ${hits.map((h) => h.split('#')[1]).join(' | ')}`)
                  .join('\n  '),
            },
          ]
        : []),
    ];
    const unknowns = [
      ...book.unknowns.filter((u) => !String(u.where ?? '').startsWith(AUTO_TAG)),
      ...autoUnknowns,
    ];

    // 硬依赖清单区块：strategy 人的填写不倒退（按 from 合并）；usedBy 每次重算
    const prevDeps = new Map((book.external_deps ?? []).map((d) => [d.from, d]));
    const depByPkg = new Map<string, BookExternalDep>();
    for (const [fp, pkgs] of extFiles) {
      for (const p of pkgs) {
        const hit = depByPkg.get(p);
        if (hit) {
          if (!hit.usedBy!.includes(fp)) hit.usedBy!.push(fp);
        } else {
          const prev = prevDeps.get(p);
          depByPkg.set(p, {
            from: p,
            strategy: prev?.strategy ?? '',
            ...(prev?.note ? { note: prev.note } : {}),
            usedBy: [fp],
          });
        }
      }
    }
    const external_deps: BookExternalDep[] = [...depByPkg.values()].sort((a, b) => a.from.localeCompare(b.from));

    const out: TranslateBook = {
      ...book,
      symbols: [...symbols, ...kept].sort((a, b) => String(a.from ?? '').localeCompare(String(b.from ?? ''))),
      shapes,
      unknowns,
      external_deps,
      meta: {
        ...book.meta,
        // ★ 基线跟着每次生成走：「这份账反映哪一代事实」只有一处（别留两个 baseline 互相打架）
        baseline: {
          ...(book.meta.baseline as Record<string, unknown> | undefined),
          db: '.agent-io/cache.db',
          scanRev,
          scanRevIso: scanRev ? new Date(scanRev).toISOString() : null,
          dbSchemaVersion: schemaVersion,
          srcFiles,
          note:
            '★ 由生成器每轮重算（scanRev = max(files.indexed_at)，schema = max(schema_versions.version)）：' +
            '这是「这份账反映哪一代事实」的唯一读数。types/atoms/external_deps.strategy 的决定时间不在这里（它们是人写的）。',
        },
        book_gen: {
          generator: 'src/infrastructure/authoring/translate/book.ts#generateBook',
          direction: 'go→ts',
          run_at: opts.now ?? new Date().toISOString(),
          rules: [
            '方向 = Go→TS 正向（与翻译管线 fill.ts/prompts.ts 同向）；源侧 = cache.db 里 language=\'go\' 的节点',
            '入账面 = Go 导出规则（首字母大写，GLOB \'[A-Z]*\'）；internal = 小写开头节点，只收「已有进度（stubbed/translated/verified/diff）」的文件',
            'to = tsPath（.go→.ts 镜像相对路径）+ tsSymbolName（方法 = ${recvType}_${method}，顶层符号名原样 —— 与 go_extractor.ts 管线命名逐字同源）',
            'kind 从 nodes.kind 现取；state 由「术语覆盖 + 同名撞车 + 外部硬依赖」决定，人的进度不被倒退',
            'blocked 四档：term（术语未覆盖）/ term_null（已定无目标）/ collision（同名撞车）/ external_dep（外部硬依赖）；人工 blocked 保留',
            'judgments（翻译 DSL 段）挂在 pending 符号上：symbol-exists + signature-matches（mapGoType 可渲染才挂）+ source-has（术语命中）—— 复用 expectations kinds，不新造 kind',
            'external_deps = imports 表 kind=\'package\' 且首段含 \'.\' 的依赖；strategy 人的填写不倒退，usedBy 每次重算',
            'shapes 按类型表达式分类聚合（func / map / chan；结构无身份，不逐条造 id）',
            'unknowns 里 [auto] 开头的每次重算，其余（人写的）原样保留',
          ],
          stats: { symbols: symbols.length + kept.length, internalSymbols: internalRows.length, blockedByTerm, blockedByTermNull, blockedByCollision, blockedByExternalDep, added: kept.length },
        },
      },
    };
    const stat: BookGenStats = {
      symbols: symbols.length + kept.length,
      internalSymbols: internalRows.length,
      pending: symbols.filter((s) => s.state === 'pending').length,
      blocked: symbols.filter((s) => s.state === 'blocked').length,
      added: kept.length,
      blockedByTerm,
      blockedByTermNull,
      blockedByCollision,
      blockedByExternalDep,
      shapes: shapes.reduce((a, s) => a + (s.count ?? 0), 0),
      scanRev,
      dbSchemaVersion: schemaVersion,
      srcFiles,
    };
    return { book: out, stats: stat };
  } finally {
    db.close();
  }
}

function shapeStats(rows: readonly NodeRow[]): Map<string, { count: number; samples: string[]; distinct: Set<string> }> {
  const out = new Map<string, { count: number; samples: string[]; distinct: Set<string> }>();
  for (const r of rows) {
    for (const expr of typeExpressions(r)) {
      const cat = classifyShape(expr);
      if (!cat) continue;
      const e = out.get(cat.id) ?? { count: 0, samples: [], distinct: new Set<string>() };
      e.count++;
      const norm = stripLiterals(stripComments(expr)).replace(/\s+/g, ' ').trim().slice(0, 120);
      e.distinct.add(norm);
      if (e.samples.length < 5 && !e.samples.some((s) => s.endsWith(norm))) {
        e.samples.push(`${r.file_path}:${r.start_line} ${r.name} ⇒ ${norm}`);
      }
      out.set(cat.id, e);
    }
  }
  return out;
}

/** 册子的**唯一序列化**（缩进 2 便于人读 — 设计侧是可读可改的）。
 *  ★ `rebuildBook` 报的 size 也走这里 ⇒ 「写出去多大」与「报多大」不可能分叉。 */
export function serializeBook(book: TranslateBook): string {
  return JSON.stringify(book, null, 2) + '\n';
}

/** 写册子（唯一落盘点）。 */
export function writeBook(bookPath: string, book: TranslateBook): void {
  fs.mkdirSync(path.dirname(bookPath), { recursive: true });
  // ★ 裸调留在此处（**不搬**，2026-10-22 分类收口）：`bookPath` 是**翻译册**（调用方指定的产物文件，
  //   不是用户源码）⇒ 归主体 = 工具生成物 ⇒ 不过闸。
  fs.writeFileSync(bookPath, serializeBook(book), 'utf8');
}

/** `rebuildBook` 的回执（结构化读数，不是一句话）。 */
export interface BookRebuildResult {
  stats: BookGenStats;
  /** 本册 unknowns 条数（人写的 + `[auto]` 的合计） */
  unknowns: number;
  /** 硬依赖清单条数（strategy 为空 = 还没定策略） */
  externalDeps: number;
  /** 册子字节数（`dryRun` 时 = **若写回**会是多大） */
  size: number;
  /** false = dryRun（没写盘） */
  wrote: boolean;
  bookPath: string;
  /** 册子声明的目标语言（`meta.target_language`；没有就是 null —— 不猜） */
  targetLanguage: string | null;
}

/**
 * 便捷入口：读册子 → 重建 → 写回（`dryRun` 只算不写）。
 *
 * ★ **失败一律抛**（本仓纪律：不许 `catch{return []}`）—— 三种失败各有自己的话：
 *   ① 册子不存在 ⇒ 说明「底册是人写的 types/atoms，没有它就没有可重建的账」；
 *   ② 事实库不存在 ⇒ `generateBook` 已抛（口径在 `openBookDb`）；
 *   ③ 声明了 `expectTargetLanguage` 但与册子不符 ⇒ 拒绝就地改语义（换语言 = 另起一份册子）。
 */
export function rebuildBook(opts: BookGenOptions): BookRebuildResult {
  if (!fs.existsSync(opts.bookPath)) {
    throw new Error(
      `翻译册不存在：${opts.bookPath}\n` +
        `★ 册子 = **人写的** types / atoms / unknowns + **生成器重算的** symbols / shapes / external_deps ⇒ 没有底册就没有可重建的账。\n` +
        `★ 先放一份底册（至少要有 \`types\` 与 \`unknowns\` 两个块），再来重建；本工具**不替你凭空造一份**。`,
    );
  }
  const book = JSON.parse(fs.readFileSync(opts.bookPath, 'utf8')) as TranslateBook;
  const want = opts.expectTargetLanguage;
  const has = typeof book.meta?.target_language === 'string' ? book.meta.target_language : null;
  if (want && want !== has) {
    throw new Error(
      `目标语言不符：调用方声明 \`${want}\`，而 ${opts.bookPath} 的 meta.target_language = \`${has ?? '（未写）'}\`。\n` +
        `★ 拒绝就地改语义：一份册子的 \`to\` / \`types\` 都是按某个目标语言定的，换语言必须**另起一份册子**（不是改一个字段）。`,
    );
  }
  const { book: next, stats } = generateBook(book, opts);
  const body = serializeBook(next);
  if (!opts.dryRun) writeBook(opts.bookPath, next);
  return {
    stats,
    unknowns: next.unknowns.length,
    externalDeps: (next.external_deps ?? []).length,
    size: Buffer.byteLength(body, 'utf8'),
    wrote: !opts.dryRun,
    bookPath: opts.bookPath,
    targetLanguage: has,
  };
}

// ── 管线消费（fill.ts / prompts.ts 的「按图索骥」入口）───────────────────
//
// 寄风洞察：翻译侧与设计侧同构 —— 翻译 DSL（映射判据）→ 翻译 DB（投影）→ 往下写翻译代码。
// 「往下写」的一步 = buildHolePrompt 给 LLM 的单孔 prompt 里注入：① 术语表命中项 ② 该符号的投影事实。
// 没有这一步，册子只是账房里的死账（2026-10-25 前的现状：翻译管线不消费它，术语表不进 prompt）。

/**
 * 读 `<projectDir>/.agent-io/design/*.translate.json`（目录不存在 ⇒ `[]`，不抛 —— 没册子是常态）。
 * 坏 JSON 的册子**跳过不猜**（生成器那边 rebuildBook 会响亮报错，这里只是只读消费方）。
 */
export function loadTranslateBooks(projectDir: string): TranslateBook[] {
  const dir = path.join(projectDir, '.agent-io', 'design');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.translate.json'));
  } catch {
    return [];
  }
  const out: TranslateBook[] = [];
  for (const n of names) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as TranslateBook);
    } catch {
      // 坏册子跳过：消费端不静默伪造事实，也不阻塞翻译主流程
    }
  }
  return out;
}

/** 从 file 所在位置向上找最近的含 `.agent-io/design` 的项目根（找不到 ⇒ null，不猜）。 */
export function findBookRootFor(file: string): string | null {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.agent-io', 'design'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 把册子的**投影事实 + 术语命中**注入 units（写进 `unit.bookFacts`，由 `buildHolePrompt` 渲染进 prompt）。
 *
 * · 符号对齐：优先精确 `${relFile}#${unit.name}`；否则**唯一**的 `#${unit.name}` 后缀命中
 *   （多命中 = 同名符号跨册/跨文件，不猜，不注入）。
 * · 术语命中：该单元类型面（形参/返回/字段/别名）里出现的词，逐词给术语表的对
 *   应物（`coveredTo`）或「已定无对应」（`nullTarget`）。
 * · 单元 facts 上限 12 行（prompt 是要省着用的；超限截断并标注）。
 *
 * @returns 注入的单元数（0 = 册子没覆盖到任何单元）
 */
export function attachBookFacts(units: TransUnit[], books: TranslateBook[], relFile: string): number {
  if (!books.length) return 0;
  const termTables = books.map((b) => termCoverage(b.types));
  let attached = 0;
  for (const u of units) {
    const facts: string[] = [];
    books.forEach((b, bi) => {
      if (facts.length >= 12) return;
      const exact = b.symbols.find((s) => s.from === `${relFile}#${u.name}`);
      if (!exact) {
        const c = b.symbols.filter((s) => s.from?.endsWith(`#${u.name}`));
        if (c.length !== 1) return; // 无命中或多命中 ⇒ 不注入（不猜）
      }
      const hit = exact ?? b.symbols.filter((s) => s.from?.endsWith(`#${u.name}`))[0];
      facts.push(`${hit.from} → ${hit.to ?? '（blocked，无投影）'} · ${hit.state}${hit.note ? ` · ${hit.note}` : ''}`);
      // 术语命中：只挑该单元类型面里出现的词
      const typeText = [
        ...(u.params ?? []).map((p) => p.type),
        u.result ?? '',
        ...(u.fields ?? []).map((f) => f.type),
        u.aliasType ?? '',
      ].join(' ');
      const tt = termTables[bi];
      for (const w of [...tt.covered, ...tt.nullTarget.keys()]) {
        if (facts.length >= 12) break;
        if (!typeText.includes(w)) continue;
        const to = tt.coveredTo.get(w);
        if (to) facts.push(`术语 ${w} → ${to}`);
        else {
          const nt = tt.nullTarget.get(w);
          facts.push(`术语 ${w} → 已定无对应（${nt?.from ?? w}${nt?.note ? '：' + nt.note : ''}）`);
        }
      }
    });
    if (facts.length > 0) {
      u.bookFacts = facts.length >= 12 ? [...facts.slice(0, 12), '（★ 已截断到 12 行）'] : facts;
      attached++;
    }
  }
  return attached;
}
