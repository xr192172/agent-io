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
import { GO_TS_LANG_TERMS } from './lang_terms.js';
import fs from 'node:fs';
import path from 'node:path';
import type { Expectation } from '../../../domain/expectation.js';
// 签名投影复用管线的同一把类型映射尺（fill.ts 生成骨架用的就是它）—— 不新造第二把
import { mapGoType } from './ts_codegen.js';
// 管线消费：投影事实注入 TransUnit（unit.ts 只放协议与纯常量，无环）
import type { TransUnit } from './unit.js';

// ── 类型 ────────────────────────────────────────────────────────────────

/** 目标侧 TS 名（渲染器视角；轴心不关心）。null = 尚未定出目标。 */
export function tsTargetName(s: { targets?: { ts?: { name?: string } } }): string | null {
  const t = s.targets?.ts;
  return t && t.name ? t.name : null;
}

/** 轴心的结构化类型事实（由 `book_ts.pivotOf` 写入，语言中立） */
export interface BookSymbol {
  from: string | null;
  /**
   * ★★★ 2026-10-29（T-#PIVOT-NEUTRAL）：**轴心中的中立身份**（**不含任何目标语言痕迹**）。
   * 形如 `skill_tree.go#SkillTree.Load` / `builder.go#NewBuilder` —— 文件 + Go 侧接收者 + 名字。
   * 为什么必须中立：旧字段 `to` 把三件事塞进一个字符串（目标文件、目标命名规则 `Type_Method`、
   * 目标扩展名 `.ts`）⇒ 第三种语言会**继承 TS 的命名习语**（用户说的"中转语言漂移"）。
   */
  id: string;
  /**
   * ★★★ 2026-10-29（T-#PIVOT-TYPEREF）：**轴心的结构化类型事实**（params/result/shape 都是 TypeRef 树）。
   * 落盘的理由：类型树原来只在内存活一次即丢 ⇒ 每次下游都重新推一遍（"同一份事实解释两次"）。
   * 有了它，`targets.*.signature` 只是**缓存**，可以由它重算。
   */
  pivot?: {
    kind: string;
    typeKind?: string;
    params?: Array<{ name: string; ref: unknown }>;
    result?: unknown;
    shape?: unknown;
    typeParams?: string[];
    value?: string;
  };
  /**
   * ★★★ 2026-10-29（T-#BUILD-VAR）：**Go build tag 变体**（同一符号在互斥文件里各定义一次）。
   * 例：`local_embedder.go`（默认构建）与 `local_embedder_nocgo.go`（`-tags nocgo`）
   * 各定义一次 `LocalEmbedder` —— **不是重名冲突**，是同一逻辑符号的两个编译变体。
   *
   * 为什么必须建模：
   *   ① 不建模 ⇒ 册子把它们判成"同名撞车"（blocked），实际无冲突；
   *   ② 不建模 ⇒ 两个变体被**同时渲染进同一份 TS** ⇒ `TS2300 Duplicate identifier`（实测 ×9）。
   */
  variant?: {
    /** 变体族名（去掉 tag 后缀的文件主干），如 `local_embedder` */
    group: string;
    /** 构建标签；`null` = 默认构建（**保留这个**） */
    tag: string | null;
  };
  /** 目标侧投影（按语言分槽）。**轴心本身不存这些** —— 它们属于渲染器。 */
  targets?: {
    ts?: {
      file: string;
      /** TS 侧符号名（如 `Builder_AddFix`），由 TS 渲染器决定，不是轴心事实 */
      name: string;
      /** 已翻好的 TS 签名（册子阶段翻一次，骨架直接用） */
      signature?: string;
      /** 签名里含 unsupported 度类型时的说明（不静默降级 any） */
      signatureNote?: string;
    };
  };
  kind: string;
  /**
   * 入账面两档：`exported` = Go 首字母大写（含导出类型的方法）；`internal` = 未导出，
   * 只在「它所在文件已经有进度」时才进账（判据见 {@link readSymbolRows}）。
   */
  scope: 'exported' | 'internal';
  origin: 'source' | 'added';
  state: string;
  /**
   * ★★★ 2026-10-28：**源侧事实的原文尾巴**（不参与状态机，纯投影）。
   *
   * 为什么加：设计侧曾栽在"漏字段漏边"上（实际侧加了字段，设计侧没跟上）。
   * 翻译侧现在要守同一条不变量：**没有人工内容时，册子 ≡ 实际侧**（一个字段、一条边都不许丢）。
   * ⇒ 签名原文（`sig`）、文档（`doc`）、片段边界（`end_line`）、以及**引用边**（`refs`）都必须在册里。
   */
  sig?: string | null;
  doc?: string | null;
  end_line?: number | null;
  /** 源侧发出的引用边（call / type_ref）：`to` = 目标节点 id（跨文件全限定），`line` = 源侧行号 */
  refs?: Array<{ to: string; kind: string; line: number | null }>;
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
  /**
   * ★★★ 2026-10-29（**删掉 any 垫片的前提**）：**机器可读的目标模块名**。
   * 只有 strategy（"怎么替"）不够 —— 生成 import 需要"替成什么"（`node:sqlite` / `onnxruntime-node` / 相对路径）。
   * · `same_slot` 且指向本仓子包 ⇒ 相对模块路径（如 `./logging/logging`）；
   * · 目标为**内建/无 import**（如 `String.normalize`）⇒ 空串（表示"不需要 import"，此时调用点需改写，缺改写就显式报错）；
   * · 空/缺省 ⇒ 尚未定 ⇒ **不生成任何垫片**（宁可红，不要 any 假绿）。
   */
  target?: string;
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

/**
 * ★★★ 2026-10-29（T-#TERM-DISPOSITION）：**每个名字都要有判定与依据** —— 包括"同形直译"。
 *
 * ## 用户的问题
 * > 「同形直译的不用标记吗？」
 *
 * **要标记。** 因为"不登记"意味着**沉默**，而沉默分不清两件事：
 *   · 机器判定过「这个名字在 TS 侧同形即可」；
 *   · 压根没人看过。
 * 今天我自己就栽在这：按"名字不在 types[] 里"算欠账，得"79 个未定"，
 * 实际真欠账只有 4 个 —— 其余全是**同形直译被当成了未定**。
 *
 * ## 四态（每一态都有判定依据，不再有"沉默"）
 * | kind | 含义 | 依据 |
 * |---|---|---|
 * | `lang` | 语言层已定（工具内置，实现驱动） | `lang_terms.ts` |
 * | `none` | 语言层判定"目标侧无对应" | `lang_terms.ts` 里 value=null |
 * | `project` | 项目层已定（人填） | 册子 `types[]` |
 * | `same-name` | **同形直译**：名字本身是合法 TS 标识符 ⇒ 保持同名 | 标识符形态（形状即答案） |
 * | `undecided` | **真欠账**（需人定） | 以上都不满足 |
 */
export type TermDispositionKind = 'lang' | 'none' | 'project' | 'same-name' | 'undecided';

export interface TermDisposition {
  /** 被引用的名字（类型名/概念名） */
  name: string;
  kind: TermDispositionKind;
  /** 目标侧名字（`none` 为 null；`undecided` 缺省） */
  to?: string | null;
  /** 判定依据（人可复核） */
  why: string;
  /** 被多少个符号引用 */
  used: number;
}

export interface BookGenOptions {
  /**
   * ★★★ 2026-10-29（T-#BOOK-ALLSYM）：**收全量符号**（含未导出、未变更文件）。
   * 缺省 false = 既有增量策略（只收「已动过文件」的内部符号）——不静默改老行为。
   * 翻译骨架需要全量：否则未变更文件里的内部符号没有 `sigTs`，骨架只能回落 AST 二次推导。
   */
  allSymbols?: boolean;
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
  /**
   * ★ 2026-10-29：重建后自动刷新的 `sigTs` 条数（-1 = 刷新失败，不假装成功）。
   * `sigTs` 来自 AST 语义（`fillBookTsSignatures`），本函数只投影 cache.db，算不出来。
   */
  sigTsRendered?: number;
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
  /** ★ 2026-10-28：跨包消歧用（同名的不同包符号靠它区分） */
  qualified_name: string | null;
  /** ★ 2026-10-28：语言列也读进来（册子要能自证"这条事实是 go 的"） */
  language: string | null;
  file_path: string;
  start_line: number;
  /** ★ 2026-10-28：片段边界（骨架落盘时算位置） */
  end_line: number | null;
  parent: string | null;
  /** ★★★ 2026-10-28（**权威在 signature**）：Go 签名原文。泛型实参 / 函数类型 / 多返回值
   *   在 `params`+`return_type` 三列里**表达不全**（实测失真：`Channel<struct{}>`、`(arg: pattern, …)`）
   *   ⇒ 册子必须带着原文，别只带拼出来的那半边。 */
  signature: string | null;
  /** ★ 2026-10-28：Go doc 注释 —— 目标侧 TS 注释的**唯一**来源 */
  docstring: string | null;
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
/**
 * ★★★ 2026-10-28（修**假 blocked**）：把 `func(...)` 段里的**形参名**剥掉，只留类型。
 *
 * 病（实测复现）：表达式 `func(pattern string, brain string) bool` 拍平后交给
 * {@link unmappedGoTypes} 的**标识符正则**扫 ⇒ `pattern` / `brain` 被当成"未覆盖术语"，
 * 符号被判 `blocked`。而这两个词**永远补不进术语表**（它们不是术语，是形参名）
 * ⇒ 制造一个**不可修的 blocked**（人无从下手，该修的是解析，不是术语表）。
 *
 * ★ 这正是"**第二处权威**"的实际伤害：`typeExpressions` 把结构化事实**拍平成字符串再正则二次解读**，
 *   与 `ts_codegen`（真 AST 解析）可能得出相反结论。这里先补最扎眼的一处；
 *   彻底解法见 todo：类型位置应由解析器给出，而不是正则扫。
 */
function stripFuncParamNames(expr: string): string {
  return expr.replace(/func\s*\(([^)]*)\)/g, (_m, inner: string) => {
    // 去掉 "名字 类型" 里的名字（保留类型）；逗号/空格分隔
    const kept = inner.replace(/([A-Za-z_]\w*)\s+(?=[*\[\]A-Za-z_])/g, '');
    return `func(${kept})`;
  });
}

export function typeExpressions(row: NodeRow): string[] {
  const out: string[] = [];
  if (row.return_type) out.push(stripFuncParamNames(row.return_type));
  for (const p of parseJson<Array<{ type?: string }>>(row.params, [])) if (p?.type) out.push(stripFuncParamNames(p.type));
  for (const m of parseJson<Array<{ type?: string }>>(row.members, [])) if (m?.type) out.push(stripFuncParamNames(m.type));
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
 * ★★★ 2026-10-28（T-#TERM-PARSE · **彻底解**）：按 **Go 类型文法**解析一段类型表达式，
 * 只收集**类型位置**的标识符 —— 形参名 / 字段名 / 方法名一律不收集。
 *
 * ## 为什么不能再用"正则扫标识符"
 * `unmappedGoTypes` 原来把类型表达式拍平后交给「标识符正则」扫。于是一段完全可翻的类型
 * `func(pattern string, brain string) bool` 会把 `pattern` / `brain` 判成"未覆盖术语"
 * ⇒ 符号被判 `blocked`，而这两个词**永远补不进术语表**（它们是形参名）⇒ **不可修的 blocked**。
 *
 * 本仓铁律是「判语法结构走 AST，正则只用于文本形状本身就是答案的场合」——这里显然不是那种场合，
 * 所以补一个**针对类型文法的小解析器**（不引 tree-sitter：输入已经是 Go 侧的**类型表达式片段**，
 * 不是完整源码；文法子集有限，逐条可测）。
 *
 * ## 认得的构造（Go 类型表达式子集）
 * `*T` · `[]T` / `[N]T` · `map[K]V` · `chan T` / `<-chan T` / `chan<- T` ·
 * `func(参数表) 返回值` · `struct{ 字段表 }` · `interface{ 方法表 }` · `Name[T1,T2]` · `(A, B)` 元组 · `...T`
 */
export function typeIdents(expr: string): string[] {
  const toks = tokenizeGoType(expr);
  const out = new Set<string>();
  let i = 0;
  const at = (): string | undefined => toks[i];
  const eat = (t: string): boolean => {
    if (toks[i] === t) {
      i++;
      return true;
    }
    return false;
  };
  const isIdent = (t: string | undefined): boolean => !!t && /^[A-Za-z_][\w]*$/.test(t);
  /** 这个 token 能否开始一个类型 */
  const canStartType = (t: string | undefined): boolean =>
    !!t && (/^[A-Za-z_]/.test(t) || ['*', '[', '(', '<-'].includes(t));

  /** 参数表：`(a int, b string)` / `(int, string)` / `(a, b int)` 三种写法都要认 */
  function parseParams(): void {
    if (!eat('(')) return;
    // 先按顶层逗号切段
    const segs: string[][] = [[]];
    let depth2 = 0;
    while (at() !== undefined && !(depth2 === 0 && at() === ')')) {
      const t = at() as string;
      if (t === '(' || t === '[' || t === '{') depth2++;
      if (t === ')' || t === ']' || t === '}') depth2--;
      if (depth2 === 0 && t === ',') {
        segs.push([]);
        i++;
        continue;
      }
      segs[segs.length - 1].push(t);
      i++;
    }
    eat(')');
    // 判定：段里出现「名字 类型」（≥2 token 且首 token 是标识符）⇒ 该段有名；否则是裸类型
    const named = segs.some((g) => g.length >= 2 && isIdent(g[0]) && canStartType(g[1]));
    for (const g of segs) {
      if (!g.length) continue;
      if (named && isIdent(g[0]) && g.length >= 2) {
        collectFromTokens(g.slice(1)); // 丢掉名字，解析类型
      } else if (named && g.length === 1 && isIdent(g[0])) {
        // `(a, b int)` 里的 `a`：名字，不是类型
      } else {
        collectFromTokens(g); // 裸类型段
      }
    }
  }

  /** 用一段独立 token 流走一遍类型解析（复用同一套规则，不递归主游标） */
  function collectFromTokens(tokens: string[]): void {
    const save = [toks.length, i];
    // 简易做法：把这几个 token 拼回字符串再走一次（段内一般很短）
    const sub = tokens.join(' ');
    for (const id of typeIdents(sub)) out.add(id);
    void save;
  }

  function parseResult(): void {
    if (at() === '(') {
      i++;
      while (at() !== undefined && at() !== ')') {
        parseType();
        if (!eat(',')) break;
      }
      eat(')');
      return;
    }
    parseType();
  }

  function parseStructBody(): void {
    if (!eat('{')) return;
    let depth2 = 0;
    while (at() !== undefined) {
      const t = at() as string;
      if (depth2 === 0 && t === '}') {
        i++;
        break;
      }
      if (t === '{' || t === '(' || t === '[') depth2++;
      if (t === '}' || t === ')' || t === ']') depth2--;
      // 顶层：`名字 类型` ⇒ 名字不收集，类型递归（其它 token 直接跳过）
      if (depth2 === 0 && isIdent(t)) {
        const nxt = toks[i + 1];
        if (isIdent(nxt)) {
          i++; // 跳过字段名
          parseType(); // 解析字段类型
        } else {
          i++; // 内嵌类型/空行
        }
        continue;
      }
      i++;
    }
  }

  function parseInterfaceBody(): void {
    if (!eat('{')) return;
    let depth2 = 0;
    while (at() !== undefined) {
      const t = at() as string;
      if (depth2 === 0 && t === '}') {
        i++;
        break;
      }
      if (depth2 === 0 && isIdent(t)) {
        i++; // 方法名（不收集）
        if (at() === '(') parseParams();
        if (at() !== undefined && at() !== '}' && at() !== ';') parseResult();
        continue;
      }
      if (t === '(' || t === '[' || t === '{') depth2++;
      if (t === ')' || t === ']' || t === '}') depth2--;
      i++;
    }
  }

  function parseType(): void {
    const t = at();
    if (t === undefined) return;
    if (t === '*') {
      i++;
      return parseType();
    }
    if (t === '...') {
      i++;
      return parseType();
    }
    if (t === '<-') {
      i++;
      if (at() === 'chan') i++;
      return parseType();
    }
    if (t === '[') {
      i++;
      if (at() !== ']') parseType(); // 数组长度表达式（常量）或切片无内容
      eat(']');
      return parseType();
    }
    if (t === 'map') {
      i++;
      if (eat('[')) {
        parseType();
        eat(']');
      }
      return parseType();
    }
    if (t === 'chan') {
      i++;
      eat('<-');
      return parseType();
    }
    if (t === 'func') {
      i++;
      parseParams();
      if (at() !== undefined && ![')', ',', ';', '}'].includes(at() as string)) parseResult();
      return;
    }
    if (t === 'struct') {
      i++;
      parseStructBody();
      return;
    }
    if (t === 'interface') {
      i++;
      parseInterfaceBody();
      return;
    }
    if (t === '(') {
      i++;
      while (at() !== undefined && at() !== ')') {
        parseType();
        if (!eat(',')) break;
      }
      eat(')');
      return;
    }
    if (isIdent(t)) {
      i++;
      out.add(t); // ★ 只有这里收集：类型位置上的名字
      if (at() === '[') {
        i++;
        while (at() !== undefined && at() !== ']') {
          parseType();
          if (!eat(',')) break;
        }
        eat(']');
      }
      return;
    }
    i++; // 其它（数字常量、'~'、'|' 等联合约束）跳过
  }

  while (i < toks.length) parseType();
  return [...out];
}

/** Go 类型表达式的最小分词器：标识符 / 数字 / 多字符符号 / 单字符符号 */
function tokenizeGoType(expr: string): string[] {
  const out: string[] = [];
  const s2 = expr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (let k = 0; k < s2.length; ) {
    const c = s2[k];
    if (/\s/.test(c)) {
      k++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = k + 1;
      while (j < s2.length && /[\w]/.test(s2[j])) j++;
      out.push(s2.slice(k, j));
      k = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = k + 1;
      while (j < s2.length && /[\w.]/.test(s2[j])) j++;
      out.push(s2.slice(k, j));
      k = j;
      continue;
    }
    if (s2.startsWith('...', k)) {
      out.push('...');
      k += 3;
      continue;
    }
    if (s2.startsWith('<-', k)) {
      out.push('<-');
      k += 2;
      continue;
    }
    out.push(c);
    k++;
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
  // ★ 2026-10-28（T-#TERM-PARSE）：**只取类型位置的标识符**（形参名/字段名/方法名不再混进来）。
  //   原来这里是"拍平字符串 + 正则扫" ⇒ 制造不可修的 blocked（形参名永远补不进术语表）。
  for (const expr of typeExpressions(row)) {
    for (const w of typeIdents(expr)) {
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
  // ★★★ 2026-10-29（T-#LANG-TERMS）：**语言层名词表先铺底**（随工具走，不随项目走）。
  //   用户的问题："名词层和语言有关还是项目有关？和项目有关那每个项目都要重填？"
  //   —— 当时的 `types[]` 混了三种东西；实测某项目 40 个"待定"里 11 个是语言层
  //   （`Context`/`http`/`Request`/`Cmd`…），它们出现在 blocked 里**是工具没接上**。
  //   铺底后：项目层只需补自己的领域词（`fix`/`principle`/`promoted` 这类）。
  for (const [k, v] of Object.entries(GO_TS_LANG_TERMS)) {
    if (v === null) nullTarget.set(k, { from: k, note: '语言层判定：目标侧无对应' });
    else {
      covered.add(k);
      coveredTo.set(k, v);
    }
  }
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
  allSymbols = false,
): { rows: NodeRow[]; internalRows: NodeRow[]; srcFiles: number; extFiles: Map<string, string[]> } {
  // ★ 2026-10-28（**空人工内容 ⇒ 册子 ≡ 实际侧**）：把生成器要用的列一次读全。
  //   原先只读 11/21 列，漏掉 signature / docstring / qualified_name / end_line / language
  //   ⇒ 漏字段是**静默**的（册子没有任何对账）。
  const cols = `id, kind, name, qualified_name, language, file_path, start_line, end_line, parent, signature, docstring, return_type, params, members, type_params, modifiers`;
  const base = `language='go' AND file_path LIKE '%.go' AND file_path NOT LIKE '%_test.go' AND file_path NOT LIKE '%/vendor/%' AND file_path NOT LIKE 'vendor/%'`;
  const kindIn = `kind IN ('function','method','const','var','type','interface','class','struct')`;
  // Go 导出 = 首字母大写：GLOB '[A-Z]*'
  const direct = db
    .prepare(`SELECT ${cols} FROM nodes WHERE ${base} AND ${kindIn} AND name GLOB '[A-Z]*' ORDER BY file_path, start_line`)
    .all() as unknown as NodeRow[];
  // 未导出：小写开头；只收「已动过文件」
  const files = [...activeFiles];
  // ★ 2026-10-29（T-#BOOK-ALLSYM）：`allSymbols` ⇒ **全量内部符号**（翻译骨架需要）；
  //   缺省仍按"已动过文件"（增量语义不变）。
  const internalRows = allSymbols
    ? (db
        .prepare(
          `SELECT ${cols} FROM nodes WHERE language='go'` + ` AND ${kindIn} AND name NOT GLOB '[A-Z]*' ORDER BY file_path, start_line`,
        )
        .all() as unknown as NodeRow[])
    : files.length
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
    const { rows, internalRows, srcFiles, extFiles } = readSymbolRows(db, activeFiles, opts.allSymbols);
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
    // ★ 2026-10-29：**人已定 strategy 的外部依赖表** —— blocked 判定要用它（否则决策落不了账）
    const depStrategy = new Map<string, string>();
    for (const d of book.external_deps ?? []) {
      if (d.from && d.strategy) depStrategy.set(d.from, d.strategy);
    }
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
      // ★ 中立 id（轴心身份）：文件 + 接收者 + Go 名字；TS 的名字/文件进 targets.ts
      const id = `${row.file_path}#${row.parent ? row.parent + '.' : ''}${row.name}`;
      const targets = { ts: { file: target, name: tsSymbolName(row) } };
      const bad = unmappedGoTypes(row, declared, terms.covered);
      // ★ 同一个 bad 里混着两种病：真正「没人定」vs「定完了、结论是翻不了（to:null）」⇒ 分开
      const uncovered = bad.filter((n) => !terms.nullTarget.has(n));
      const nullTerms = bad.filter((n) => terms.nullTarget.has(n));
      const exts = extFiles.get(row.file_path) ?? [];
      return { row, scope, id, targets, target, bad, uncovered, nullTerms, exts };
    });
    const byTarget = new Map<string, number>();
    // ★ T-#BUILD-VAR（**计数口径也要一致**）：`byTarget` 只统计**默认构建**的符号 ——
    //   否则带 tag 的变体仍会把默认那一侧"算成撞车"（第一版只让 tagged 侧不判撞车，
    //   默认侧却因为计数含 tagged 而继续报撞车，残留 6 组）。
    for (const m of mapped) {
      const n = tsTargetName(m);
      if (!n) continue;
      const base = String(m.row.file_path).split('/').pop() ?? '';
      const stem = base.replace(/\.go$/, '');
      if (/_(cgo|nocgo|onnx|windows|linux|darwin|arm64|amd64|386)$/.test(stem)) continue; // 变体不参与
      byTarget.set(n, (byTarget.get(n) ?? 0) + 1);
    }

    // ★ 上游轴心（若存在）：一份中立事实，供本目标语言册子**投影**
    const pivotUpstream: Record<string, unknown> = (() => {
      try {
        const p = opts.bookPath.replace(/\.translate\.json$/, '.pivot.json');
        if (!fs.existsSync(p)) return {};
        const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { symbols?: Record<string, Record<string, unknown>> };
        const out: Record<string, unknown> = {};
        for (const [id, v] of Object.entries(j.symbols ?? {})) {
          const { from: _f, kind: _k, ...rest } = v as Record<string, unknown>;
          out[id] = rest;
        }
        return out;
      } catch {
        return {};
      }
    })();

    const symbols: BookSymbol[] = [];
    let blockedByTerm = 0;
    let blockedByTermNull = 0;
    let blockedByCollision = 0;
    let blockedByExternalDep = 0;
    for (const { row, scope, id, targets, target, bad, uncovered, nullTerms, exts } of mapped) {
      const prev = before.get(row.id);
      // ★ T-#BUILD-VAR：**带 tag 的变体不参与撞车计数** —— 它们与默认构建互斥，
        //   判成撞车会让册子 blocked（实际无冲突），也会让两份同时渲染（TS2300）。
        const selfIsTagged = (() => {
          const b = String(row.file_path).split('/').pop() ?? '';
          const stem = b.replace(/\.go$/, '');
          return /_(cgo|nocgo|onnx|windows|linux|darwin|arm64|amd64|386)$/.test(stem);
        })();
        const collision = !selfIsTagged && (byTarget.get(tsTargetName({ targets }) ?? '') ?? 0) > 1;
      // ★★★ 2026-10-29（**第 1 层的决策必须影响账**）：原来只要文件 import 了非 stdlib 包就判 `external_dep`
      //   并 blocked，**完全不看 `external_deps[].strategy` 填没填** ⇒ 人把 8 条策略全填了，318 个符号照样 blocked
      //   ⇒ 第 2 层无从消费（又一处「决策不生效」）。现在：该文件的外部依赖**全部**定了 strategy
      //   ⇒ 不再 blocked（降为 pending：名词层已决定"用什么替身"，剩下是结构层的事）。
      const extUndecided = exts.filter((e) => !depStrategy.get(e));
      const kind: 'term' | 'term_null' | 'collision' | 'external_dep' | null = uncovered.length
        ? 'term'
        : nullTerms.length
          ? 'term_null'
          : collision
            ? 'collision'
            : extUndecided.length
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
            ? `${AUTO_TAG} 同名撞车：${byTarget.get(tsTargetName({ targets }) ?? '')} 个源符号都映射到 ${tsTargetName({ targets }) ?? ''} ⇒ 需人工改名。`
            : kind === 'external_dep'
              ? `${AUTO_TAG} 外部硬依赖：本文件 import "${exts[0]}"${exts.length > 1 ? ` 等 ${exts.length} 条` : ''} ⇒ TS 侧无对应物；先在 external_deps 给它定 strategy（npm_equiv / same_slot / http_bridge）再翻。`
              : autoNote(row, uncovered.length ? uncovered : bad, tsTargetName({ targets }) ?? '');

      // ★ 翻译 DSL 段：映射判据挂在**未 blocked** 的符号上（blocked 的先解决术语/依赖，判了也是假红噪音）
      const termHits = state === 'pending' ? coveredTermHits(row, declared, terms) : [];
      const judgments = state === 'pending' ? buildJudgments(row, target, tsSymbolName(row), termHits, terms) : undefined;

      symbols.push({
        from: row.id,
        // ★ 中立身份：文件 + 接收者 + 名字（不含目标语言痕迹）
        id: `${row.file_path}#${row.parent ? row.parent + '.' : ''}${row.name}`,
        // ★ T-#BUILD-VAR：按**文件名后缀**判构建标签（`_nocgo` / `_windows` …）
        ...(() => {
          const base = String(row.file_path).split('/').pop() ?? '';
          const stem = base.replace(/\.go$/, '');
          const m = /^(.*)_(cgo|nocgo|onnx|windows|linux|darwin|arm64|amd64|386)$/.exec(stem);
          return {
            variant: m
              ? { group: m[1], tag: m[2] }
              : { group: stem, tag: null },
          };
        })(),
        ...(targets ? { targets } : {}),
        kind: row.kind, // ★ 从 nodes.kind 现取，不手写
        scope,
        origin: 'source',
        state,
        // ★ note 优先级：人写的（有且非 [auto]）> 本次自动。有 note 但不 sticky 时也保留人的说明。
        note: prev?.note && !prev.note.startsWith(AUTO_TAG) ? prev.note : auto,
        // ★ 源侧事实原样投影（不判断、不改写）：漏了就是漏了，没有对账会静默
        sig: row.signature ?? null,
        // ★★★ 2026-10-29：**`sigTs` 也是派生事实，重算不该抹掉它**。
        //   它由 `fillBookTsSignatures` 从 AST 算出；本函数只从 cache.db 投影，算不出来。
        //   不回填的后果实测：册子 792 符号 `sigTs` 归零 ⇒ 骨架"册子出的签名" 92.5% → 0%
        //   （第 3 次「人的填写不倒退」失守：strategy 保住了、target 保住了、sigTs 又丢了）。
        ...(prev?.targets ? { targets: JSON.parse(JSON.stringify(prev.targets)) } : {}),
        // ★★★ 2026-10-29（**层次拨正**）：pivot 不再从"上一版册子"回填 —— 那是**下游保管上游事实**。
        //   现在从**上游产物** `<feature>.pivot.json` 读（一份轴心 → N 个语言册子）。
        ...(pivotUpstream[id] ? { pivot: pivotUpstream[id] as never } : {}),
        doc: row.docstring ?? null,
        end_line: row.end_line ?? null,
        ...(judgments && judgments.length ? { judgments } : {}),
      });
    }

    // ★★★ 2026-10-28（不变量：**空人工内容 ⇒ 册子 ≡ 实际侧**）：把源侧的**引用边**也投影进册。
    //   call / type_ref 是 blocked（外部硬依赖）、shapes 聚合、以及"谁在用它"的判据原料 ——
    //   原来册子**完全不碰 edges 表**，等于把实际侧 2/3 的边静默丢掉（无任何对账会报）。
    try {
      const edgeRows = db
        .prepare(
          `SELECT e.source AS src, e.target AS dst, e.kind AS kind, e.line AS line, e.provenance AS prov
             FROM edges e JOIN nodes n ON n.id = e.source
            WHERE n.language='go' AND e.kind IN ('call','type_ref')`,
        )
        .all() as Array<{ src: string; dst: string; kind: string; line: number | null; prov: string | null }>;
      const byId = new Map<string, Array<{ to: string; kind: string; line: number | null; provenance?: string | null }>>();
      for (const e of edgeRows) {
        const arr = byId.get(e.src) ?? [];
        arr.push({ to: e.dst, kind: e.kind, line: typeof e.line === 'number' ? e.line : null, provenance: e.prov ?? null });
        byId.set(e.src, arr);
      }
      for (const sym of symbols) {
        const r = sym.from ? byId.get(sym.from) : undefined;
        if (r && r.length) sym.refs = r;
      }
    } catch {
      // edges 表缺失（旧 schema）⇒ 不伪造 refs：**没读到 ≠ 没有边**
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
      const arr = collisionGroups.get(tsTargetName(s) as string) ?? [];
      arr.push(s.from as string);
      collisionGroups.set(tsTargetName(s) as string, arr);
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
            // ★★★ 2026-10-29：**`target` 也要「人的填写不倒退」** —— 上一版只回填 strategy，
            //   `target`（机器可读的目标模块名）每次重算都被丢掉 ⇒ 第 2 层拿不到 import 目标
            //   （实测 8 条 target 全丢，只能回落成「缺 target」报错）。
            ...(prev?.target !== undefined ? { target: prev.target } : {}),
            ...(prev?.note ? { note: prev.note } : {}),
            usedBy: [fp],
          });
        }
      }
    }
    // ★★★ 2026-10-29（T-#TERM-DISPOSITION）：给**每个被引用的名字**算一个显式判定（含同形直译）。
    //   动机（用户）："同形直译的不用标记吗？" —— 不标记 = 沉默 = 分不清"判定过"与"没人看"，
    //   我自己就因此把"同形直译"误算成"79 个欠账"（真欠账只有 4 个）。
    const termDispositions: TermDisposition[] = (() => {
      const used = new Map<string, number>();
      const bump = (n: string): void => {
        used.set(n, (used.get(n) ?? 0) + 1);
      };
      for (const sym of symbols) {
        const refs: unknown[] = [];
        for (const p of sym.pivot?.params ?? []) refs.push(p.ref);
        if (sym.pivot?.result) refs.push(sym.pivot.result);
        for (const r of refs) {
          const ref = r as { kind?: string; name?: string; pkg?: string };
          // ★ 限定类型（`context.Context` / `http.Request`）也是"名字"，必须纳入判定 ——
          //   否则语言层那 53 条永远统计不到（第一版只收 ident，四态里只有 same-name，典型的漏采）。
          if (ref?.kind === 'qualified' && ref.name) {
            if (ref.pkg) bump(ref.pkg);
            bump(ref.name);
            continue;
          }
          if (ref?.kind !== 'ident' || !ref.name) continue;
          bump(ref.name);
        }
      }
      const out: TermDisposition[] = [];
      for (const [name, count] of [...used.entries()].sort((a, b) => b[1] - a[1])) {
        if (name in GO_TS_LANG_TERMS) {
          const to = GO_TS_LANG_TERMS[name];
          out.push({
            name,
            kind: to === null ? 'none' : 'lang',
            to,
            why: to === null ? '语言层判定：目标侧无对应' : '语言层已定（工具内置，实现驱动）',
            used: count,
          });
          continue;
        }
        if (terms.covered.has(name)) {
          out.push({ name, kind: 'project', to: terms.coveredTo.get(name) ?? name, why: '项目层 types[] 已定', used: count });
          continue;
        }
        if (terms.nullTarget.has(name)) {
          out.push({ name, kind: 'none', to: null, why: '项目层判定：明确无对应', used: count });
          continue;
        }
        // ★ 同形直译：名字本身是**合法 TS 标识符**（形状本身即答案，不需要语义解析）
        if (/^[A-Za-z_$][\w$]*$/.test(name)) {
          out.push({
            name,
            kind: 'same-name',
            to: name,
            why: '同形直译：名字是合法 TS 标识符 ⇒ 保持同名（机器判定，非沉默）',
            used: count,
          });
          continue;
        }
        out.push({ name, kind: 'undecided', why: '既非语言层也非项目层，且不是合法标识符 ⇒ 需人定', used: count });
      }
      return out;
    })();

    const external_deps: BookExternalDep[] = [...depByPkg.values()].sort((a, b) => a.from.localeCompare(b.from));

    const out: TranslateBook = {
      ...book,
      symbols: [...symbols, ...kept].sort((a, b) => String(a.from ?? '').localeCompare(String(b.from ?? ''))),
      shapes,
      unknowns,
      external_deps,
      // ★ T-#TERM-DISPOSITION：**每个被引用的名字的显式判定**（含"同形直译"）。
      //   不标记 = 沉默 = 分不清"判定过"与"没人看"——我自己就因此把同形直译误算成"79 个欠账"。
      terms: { dispositions: termDispositions },
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
      facts.push(`${hit.from} → ${tsTargetName(hit) ?? '（blocked，无投影）'} · ${hit.state}${hit.note ? ` · ${hit.note}` : ''}`);
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
