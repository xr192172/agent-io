/**
 * health —— 代码健康度（死代码 / 复杂度 / 分层违规 / 循环依赖）
 *
 *   1. 死代码   ：未使用导出（复用调用边/类型引用边反查）+ 未使用 import + 孤儿文件
 *   2. 复杂度   ：顶层函数/方法圈复杂度启发式（阈值默认 10）
 *   3. 分层违规 ：依赖方向向上（低层 import 高层）→ 破坏分层
 *   4. 循环依赖 ：Tarjan SCC 找强连通分量（只算真实值依赖，排除 `import type`）
 *
 * ★ 现行分层口径（2026-10-03 重写）：**按目录判四层** ——
 *   `domain(0) → infrastructure(1) → application(2) → presentation(3)`，
 *   只许「依赖 ≤ 自身」（向下或同层）；向上 = 违规。
 *
 * ★★ 旧口径已废弃（下面多处以"旧实现如何"叙述差异，那是**历史对照**，不是现行口径）：
 *   三分类**路径启发式** `contract` / `brick` / `glue`（靠路径特征猜），
 *   它 95% 的文件都落进 `brick` 兜底 ⇒ 分级**不携带信息**。
 *   ★ 2026-10-04 教训：本文件的**头注**当时没跟着实现一起改，仍以旧口径开篇 ⇒
 *     一次**独立结构评审**读到这段头注，据此判定"本仓用三层判违规、四层只是目录命名"。
 *     **它没读错，是这段注释在撒谎。** 改实现时必须同步改"开篇那段声明"。
 *
 * 复用：collectSourceFiles + ts_kernel parseFileFull（与 impact 同一解析路径）；
 * 跨文件符号引用按"导出名唯一"匹配（沿用 impact 保守语义：重名不建边，避免误报）。
 *
 * v1 边界（诚实标注）：
 *   - 未使用导出/孤儿文件：项目内不可见引用即报，但"外部消费者"（包边界公共 API）
 *     看不见 → 一律标 potential（info），不自动删。
 *   - 未使用 import：tree-sitter AST 提取本地绑定名（TS/JS 家族 + Python），与全文件
 *     标识符/类型标识符使用集比对；Go 不提取（Go 未用 import 本就是编译错）。
 *   - 复杂度：tree-sitter AST 树遍历按分支节点计数（if/elif/for/while/switch-case/
 *     catch/except/三元/&&/||），注释/字符串天然不进 AST 不再污染计数（原正则启发式已废弃）。
 *   - 未使用导出只查函数/类/接口/类型等可调用符号；顶层 const 跳过（模块级常量被函数/
 *     模块读取是常态，且解析器不提取"变量读"边，反查永远查不到 → 直接不报，避免噪音）。
 *   - 解析器只建"函数体内"的调用边，模块级引用（入口文件底部 `main();` / 模块级 IIFE）不建边；
 *     unused_export 用"同文件文本存在性"兜底：符号名出现在定义行之外即视为被引用（保守方向，
 *     宁漏不误报；跨文件的模块级调用仍会漏——报 info 级仅提示，不自动删）。
 */

import { parseFileFull, parseAstRoot, listSupportedExtensions, resolveProjectImport, type ParsedSymbol, type SyntaxNodeLike } from '../../parse/index.js';
import { codeSourceExts, partitionByCodeLang } from '../../parse/source_exts.js';
import { boundsSkipFromExcluded, type ScanBounds } from '../../scan_bounds.js';
import { collectSourceFiles } from '../version_upgrade/detect.js';

// ── 对外类型 ─────────────────────────────────────────────────

/**
 * ★★ 2026-10-03 **重写**：层定义从三分类路径启发式（`contract`/`brick`/`glue`）换成
 * **真实四层目录**（`presentation` / `application` / `infrastructure` / `domain`）。
 *
 * 为什么必须换（漏洞实证）：
 *   · 旧表靠 `CONTRACT_HINTS` / `GLUE_HINTS` 两条正则**猜**，注释自己就写着
 *     「实测 279/303（92%）落在这里 ⇒ 这个分级**几乎不携带信息**」—— 当时只把它单列出来"可见"，没修；
 *   · 2026-10-03 实测：**813/859 = 95%** 落兜底，13 条 `layer_violation` 里 **10 条在 `tests/`／夹具**
 *     （旧实现把测试也按路径拉进来判层）；
 *   · 而本仓**早就是四层**，当时的 `dependency-cruiser` 规则用的也是四层 ⇒ ★ **同一件事两套口径**，
 *     正是本仓头号病根「判据分叉」的又一实例。（那套规则已于 2026-10-04 随框架整体移除
 *     ⇒ 分层的**判据现在只有本文件这一份**，分叉面消失。）
 */
export type Layer = 'domain' | 'infrastructure' | 'application' | 'presentation';

export type HealthKind =
  | 'unused_export'
  | 'unused_import'
  | 'orphan_file'
  | 'high_complexity'
  | 'layer_violation'
  /** ★ 2026-10-03 新增：**循环依赖**（A→B→A）。见 `findCycles` 的说明 —— 这是本工具原先**完全缺失**的一维。 */
  | 'circular_dependency';

export type HealthSeverity = 'error' | 'warn' | 'info';

export interface HealthIssue {
  kind: HealthKind;
  severity: HealthSeverity;
  /** 相对 root */
  file: string;
  line?: number;
  symbol?: string;
  message: string;
  /** 额外证据（如复杂度分数 / 被 import 的高层文件 / 未用 import 的模块） */
  evidence?: string;
}

export interface ComplexityEntry {
  file: string;
  symbol: string;
  line: number;
  complexity: number;
}

export interface HealthReport {
  root: string;
  fileCount: number;
  issues: HealthIssue[];
  counts: Record<HealthKind, number>;
  /** 超阈值函数（按复杂度降序，最多 top 个） */
  complexity: ComplexityEntry[];
  /**
   * 分层统计 —— ★ 2026-10-03 **重写为真实四层**（`presentation/application/infrastructure/domain`）。
   *
   * ★★ 旧实现是**三分类路径启发式**（`contract` / `brick` / `glue`，靠 `CONTRACT_HINTS`/`GLUE_HINTS`
   *   正则猜），注释里**自己就承认过它退化了**（原文：「实测本仓 279/303（92%）落在这里 ⇒
   *   这个分级**几乎不携带信息**，却看不出来」）—— 当时的处置只是**单列 `unclassified` 让它可见**，
   *   没有修。实测代价（2026-10-03）：`813/859 = 95%` 落兜底，13 条 `layer_violation` 里
   *   **10 条在 `tests/` 与 `tests/fixtures/`**（旧实现把测试也拉进来按路径猜层）。
   *
   * ★ 现在**按目录判层**；这是本仓分层判据的**唯一实现**（曾与 `dependency-cruiser` 的规则两套
   *   并存，那套已于 2026-10-04 移除 ⇒ 不再有分叉面）。
   *   `outside` = **不在四层里**的文件数（`tests/` / `scripts/` / `go-observe/` / 仓库根散文件…）
   *   —— 它们**不参与**分层违规判定，但**如实计数**（保留"口径收紧不许静默"的设计）。
   */
  layers: {
    domain: number;
    infrastructure: number;
    application: number;
    presentation: number;
    /** 不在 `src/<四层>/` 里的文件（测试/脚本/其它语言子项目/go 侧…）—— 不判层，但如实计数 */
    outside: number;
    violations: number;
  };
  /** 0-100 健康分 + 等级；`N/A` = 没有可评的输入（0 个源文件），**不是满分** */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'N/A';
  summary: string;
  /**
   * ★ 扫描边界（统一形状，2026-09-29；原名 `excludedNonCode`）。
   *
   * 「口径收紧的可见性」：装了 / 可解析、但按「代码语言」不算源码的扩展名 → 逐族计数，
   * 收进 `bounds.skipped`（`count` 保留、`ext` 落在 `path` 模式上 ⇒ 无损）。
   * ★ 为什么要单列：源码集从"可解析"收到"代码语言"之后，`.json` 这类文件**不再进体检** ——
   *   如果连"有几个、是什么"都不说，那就是本仓头注批的「**缺失是沉默的**」。
   *   同款设计见 `layers.unclassified`（单列"什么都没命中"的文件数，而不是混进 brick）。
   * ★ 本工具属「扫仓库类」⇒ `bounds` **恒在**（哪怕扫了 0 个文件也要说出来 —— 那正是边界）。
   * 形状与挂载层见 `src/infrastructure/scan_bounds.ts`。
   */
  bounds: ScanBounds;
}

export interface HealthOptions {
  /** 复杂度阈值（默认 10） */
  complexityThreshold?: number;
  /** 复杂度清单最多列多少个（默认 10） */
  top?: number;
  /**
   * 可达性根（项目内相对路径）。P0-②，2026-09-28。
   *
   * 由调用方从 `package.json`（`bin` + `scripts.*` 里按路径调起的 `node dist/...`）探测后**显式喂入**，
   * 而不是由本模块自己去读 package.json —— 分析器保持纯函数，探测在 `tools/project_root.ts`。
   *
   * 为什么必要：入口文件**天然没有项目内消费者**（它就是被外界调起的），
   * 旧逻辑把它当 brick ⇒ 既报 orphan_file 又可能报 layer_violation。
   * 实测本仓 2 条假阳：`daemon/daemon.ts`（`npm run daemon`）、`tools/serve.ts`（`npm run serve`）。
   */
  reachableRoots?: string[];
}

// ── 分层分类 ─────────────────────────────────────────────────

/**
 * ★★ 2026-10-03 **整块替换**：旧的两条"路径启发式"正则（`CONTRACT_HINTS` / `GLUE_HINTS`）
 * 连同它们的兜底逻辑一起删除 —— 见 `classifyLayer` 的注释（为什么要换、代价是多少）。
 *
 * 现在**只认一个事实**：这个文件在不在 `src/<四层>/` 下。
 * 正则从**路径段**取层名（不是"猜"）：`src/application/meta/index.ts` ⇒ `application`。
 * ★ 用 `(?:^|\/)src\/` 锚定，避免把 `tests/fixtures/foo/src/domain/x.ts` 这类**夹具里的 src** 误判成真源码 ——
 *   夹具**不该**参与本仓的分层判定（旧实现正是把 `tests/fixtures/**` 一起判了）。
 *   ⇒ 所以要求"`src/` 之前没有别的路径段"：见 `classifyLayer` 里的 `^src/` 判定。
 */
const LAYER_SEGMENT_RE = /^src\/(domain|infrastructure|application|presentation)\//;

/**
 * 层序：**数字越大越靠上**。只许「依赖 ≤ 自身」（向下或同层）。
 * ★ 认层口径见本文件 `classifyLayer`：**本仓唯一一份**（原 `dependency-cruiser` 的
 *   `layer-downward-only` 与之同口径，已于 2026-10-04 随框架整体移除）。
 */
const LAYER_ORDER: Record<Layer, number> = { domain: 0, infrastructure: 1, application: 2, presentation: 3 };

/**
 * 按**目录**判层 —— 只认 `src/<层>/…`，返回四层之一。
 *
 * @returns `Layer`；**`null` = 不在四层里**（`tests/`、`scripts/`、`go-observe/`、仓库根散文件、
 *          以及 `tests/fixtures/**\/src/...` 这类**夹具里的 src**）⇒ **不参与分层违规判定**。
 *
 * ★ 为什么返回 `null` 而不是"兜底也算一层"（旧实现在这里吃了大亏）：
 *   旧实现没命中正则就**默认 `brick`** ⇒ 813/859（95%）落兜底 ⇒ 分级不携带信息；
 *   而且它把所有 `tests/` 也拉进来判 ⇒ 13 条违规里 **10 条在测试/夹具**。
 *   "**不在四层里**"是一个**如实的事实**，不是"默认归到某一层"——两者必须分开（同 `layers.outside`）。
 *
 * ★ 为什么按目录而不是路径启发式：本仓**早就是四层**，目录本身就是这个事实的载体。
 *   靠 `/server\./`、`/types\./` 这类正则**猜**层，是**另一套口径** ⇒ 判据分叉（本仓头号病根）。
 */
export function classifyLayer(rel: string): Layer | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const m = LAYER_SEGMENT_RE.exec(p);
  return (m?.[1] as Layer) ?? null;
}

/**
 * Tarjan 强连通分量（**迭代版**，不递归 —— 本仓有 300+ 节点的图，递归版会爆栈）。
 *
 * @returns 每个"成环的"分量（size ≥ 2，或 size 1 且自环）的成员数组。
 *
 * ★ 2026-10-03 新增：这是本工具原先**完全缺失**的一维（`HealthKind` 里没有 cycle）。
 *   为什么必须有：环是"改不动、初始化顺序玄学"的结构性病灶，而它**在搬迁期间会静默产生**
 *   （跨层互引一次就成环）。实测本仓有 **2 条真环**一直存在，却因为
 *   ① 本工具不报环、② dep-cruiser 的豁免清单把它盖住 ⇒ **没人知道**，直到豁免清单被删。
 */
function findCycles(nodes: readonly string[], edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ node: string; iter: Iterator<string> }> = [];
    const push = (n: string): void => {
      index.set(n, counter);
      low.set(n, counter);
      counter += 1;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, iter: (edges.get(n) ?? new Set<string>()).values() });
    };
    push(root);
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      const next = top.iter.next();
      if (!next.done) {
        const w = next.value;
        if (!index.has(w)) push(w);
        else if (onStack.has(w)) low.set(top.node, Math.min(low.get(top.node)!, index.get(w)!));
        continue;
      }
      work.pop();
      const v = top.node;
      if (work.length > 0) {
        const parent = work[work.length - 1]!.node;
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) === index.get(v)) {
        const comp: string[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === v) break;
        }
        if (comp.length > 1 || (edges.get(v)?.has(v) ?? false)) out.push(comp.reverse());
      }
    }
  }
  return out;
}

// ── 复杂度（tree-sitter AST 遍历计数）────────────────────────

/** TS/JS 家族语言名（共享同一套 AST 节点结构） */
const TS_FAMILY = new Set(['typescript', 'tsx', 'javascript', 'jsx']);

/**
 * 各语言"分支/决策"节点类型（每个 +1）——节点名实测（_dbg_ast*.mjs）：
 *   · TS/JS：if/for/for-in/while/do/switch(+case)/catch/三元
 *   · Go：if/for/switch(+case)/select（default 不计——圈复杂度按 case 分支数）
 *   · Python：if/for/while/match(+case)/except/三元（conditional_expression）
 * else if / elif 在 AST 里是嵌套 if_statement（或 elif_clause 挂在 if 下），
 * 计数与原正则"每个 if 关键字 +1"语义一致；注释/字符串天然不进 AST 不再污染。
 */
const COMPLEXITY_BRANCH_NODES: Record<string, string[]> = {
  typescript: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'switch_case', 'catch_clause', 'ternary_expression'],
  tsx: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'switch_case', 'catch_clause', 'ternary_expression'],
  javascript: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'switch_case', 'catch_clause', 'ternary_expression'],
  jsx: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'switch_case', 'catch_clause', 'ternary_expression'],
  go: ['if_statement', 'for_statement', 'expression_switch_statement', 'type_switch_statement', 'select_statement', 'expression_case', 'type_case'],
  python: ['if_statement', 'for_statement', 'while_statement', 'match_statement', 'case_clause', 'except_clause', 'conditional_expression'],
};

/** 各语言"逻辑短路"运算符节点（operator 为 &&/|| 或 and/or 时 +1） */
const COMPLEXITY_LOGIC_NODES: Record<string, string[]> = {
  typescript: ['binary_expression'],
  tsx: ['binary_expression'],
  javascript: ['binary_expression'],
  jsx: ['binary_expression'],
  go: ['binary_expression'],
  python: ['boolean_operator'],
};

/**
 * 圈复杂度：tree-sitter AST 树遍历按分支节点计数（见 COMPLEXITY_BRANCH_NODES），
 * 运算符只认 &&/||（and/or）——注释/字符串不进 AST 不再污染计数。
 * 语言无解析器（未装包/不支持）时回退正则启发式（estimateComplexityRegex）。
 */
export async function estimateComplexity(filePath: string, body: string): Promise<number> {
  const ast = await parseAstRoot(filePath, body);
  if (!ast) return estimateComplexityRegex(body);
  const branch = new Set(COMPLEXITY_BRANCH_NODES[ast.langName] ?? []);
  const logic = new Set(COMPLEXITY_LOGIC_NODES[ast.langName] ?? []);
  if (branch.size === 0 && logic.size === 0) return estimateComplexityRegex(body);
  let c = 1;
  const walk = (n: SyntaxNodeLike): void => {
    if (branch.has(n.type)) c += 1;
    if (logic.has(n.type)) {
      const op = n.childForFieldName('operator');
      const t = op ? op.text : '';
      if (t === '&&' || t === '||' || t === 'and' || t === 'or') c += 1;
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walk(child);
    }
  };
  walk(ast.root);
  return c;
}

/** 正则回退：剥注释（行/块 + python #）后再数分支关键词 → 圈复杂度估计 */
export function estimateComplexityRegex(body: string): number {
  const src = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\n)[ \t]*\/\/[^\n]*/g, '\n')
    .replace(/(^|\n)[ \t]*#[^\n]*/g, '\n');
  let c = 1;
  for (const re of [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /\bexcept\b/g]) {
    c += (src.match(re) ?? []).length;
  }
  c += (src.match(/&&/g) ?? []).length;
  c += (src.match(/\|\|/g) ?? []).length;
  c += (src.match(/\b(and|or)\b/g) ?? []).length;
  c += (src.match(/\s\?\s/g) ?? []).length; // 三元（带空格，避开可选链/类型 ?）
  return c;
}

// ── 未使用 import 提取（tree-sitter AST）────────────────────

export interface NamedImportRef {
  line: number;
  module: string;
  name: string;
}

/** AST 提取的绑定（额外带声明 identifier 的 **code unit** 偏移，供"排除绑定自身"使用） */
interface AstImportBind extends NamedImportRef {
  /** 绑定 identifier 的 startIndex（tree-sitter 的 **UTF-16 code unit** 偏移，★ 不是字节偏移 —— 2026-09-29 更正） */
  startIndex: number;
}

function stripQuotes(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.slice(1, -1);
  }
  return s;
}

function isValidBindName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

/**
 * 从 AST 提取命名 import 绑定（TS/JS 家族 named+default+namespace+CJS require；Python from/import）。
 * Go 不提取（Go 未用 import 是编译错，编译器兜底）；其余语言返回空 → 走正则回退。
 * 结构实测（_dbg_ast*.mjs）：
 *   · TS：import_statement → import_clause → identifier(default) / named_imports → import_specifier(name/alias) / namespace_import → identifier
 *   · CJS：variable_declarator 且 value 为 require(...) 调用 → 绑定名 = 声明 identifier
 *   · Python：import_from_statement 的 module_name 字段 + 其后的 dotted_name / aliased_import(name/alias)；
 *     import_statement 的每个 dotted_name（import os.path → 绑定名 os）
 */
function collectImportBinds(root: SyntaxNodeLike, lang: string): AstImportBind[] {
  const binds: AstImportBind[] = [];
  const push = (line: number, module: string, nameNode: SyntaxNodeLike): void => {
    const name = nameNode.text;
    if (isValidBindName(name)) binds.push({ line, module, name, startIndex: nameNode.startIndex ?? 0 });
  };

  if (TS_FAMILY.has(lang)) {
    const walk = (n: SyntaxNodeLike): void => {
      if (n.type === 'import_statement') {
        // import type {...} → 类型专用导入，不进未使用报告（见 TYPE_ONLY_IMPORT_RE）
        if (TYPE_ONLY_IMPORT_RE.test(n.text)) return;
        const srcNode = n.childForFieldName('source');
        const module = srcNode ? stripQuotes(srcNode.text) : '';
        const line = n.startPosition.row + 1;
        const sub = (m: SyntaxNodeLike): void => {
          for (let i = 0; i < m.childCount; i++) {
            const c = m.child(i);
            if (!c) continue;
            if (c.type === 'import_specifier') {
              const b = c.childForFieldName('alias') ?? c.childForFieldName('name');
              if (b) push(line, module, b);
            } else if (c.type === 'namespace_import') {
              for (let j = 0; j < c.childCount; j++) {
                const k = c.child(j);
                if (k && k.type === 'identifier') push(line, module, k);
              }
            } else if (c.type === 'identifier') {
              push(line, module, c);
            } else if (c.isNamed) {
              sub(c);
            }
          }
        };
        sub(n);
        return;
      }
      // CJS: const x = require('m')
      if (n.type === 'variable_declarator') {
        const nameNode = n.childForFieldName('name');
        const value = n.childForFieldName('value');
        if (nameNode && nameNode.type === 'identifier' && value && value.type === 'call_expression') {
          const fn = value.childForFieldName('function');
          if (fn && fn.text === 'require') {
            const m = value.text.match(/['"]([^'"]+)['"]/);
            push(n.startPosition.row + 1, m ? m[1] : '', nameNode);
          }
        }
        // 不 return——继续递归（声明内部无嵌套 import）
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) walk(c);
      }
    };
    walk(root);
  } else if (lang === 'python') {
    const walk = (n: SyntaxNodeLike): void => {
      if (n.type === 'import_from_statement') {
        const line = n.startPosition.row + 1;
        const modNode = n.childForFieldName('module_name');
        const module = modNode ? modNode.text : '';
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (!c || c === modNode) continue;
          if (c.type === 'aliased_import') {
            const b = c.childForFieldName('alias') ?? c.childForFieldName('name');
            if (b) push(line, module, b);
          } else if (c.type === 'dotted_name') {
            push(line, module, c);
          }
        }
        return;
      }
      if (n.type === 'import_statement') {
        const line = n.startPosition.row + 1;
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && c.type === 'dotted_name') {
            // import os.path → 绑定名 os（module 记录完整 dotted 名）
            const name = c.text.split('.')[0];
            if (isValidBindName(name)) binds.push({ line, module: c.text, name, startIndex: c.startIndex ?? 0 });
          }
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) walk(c);
      }
    };
    walk(root);
  } else if (lang === 'java') {
    // Java：import com.acme.Foo; / import static org.x.Bar;
    const walk = (n: SyntaxNodeLike): void => {
      if (n.type === 'import_declaration') {
        const line = n.startPosition.row + 1;
        const body = n.text.replace(/^\s*import\s+static\s+/, '');
        const m = body.match(/^\s*import\s+([\w.]+(?:\.[\w]+)*)\s*;/);
        if (m) {
          const segs = m[1].split('.');
          const bind = segs[segs.length - 1] || '';
          if (isValidBindName(bind)) binds.push({ line, module: m[1], name: bind, startIndex: nameNodeStart(n, bind) });
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) walk(c);
      }
    };
    walk(root);
  }
  return binds;
}

/** 在 import 节点文本中定位绑定标识符的字节偏移（import 声明在行首，字节≈文本 index） */
function nameNodeStart(node: SyntaxNodeLike, name: string): number {
  const i = node.text.indexOf(name);
  return i >= 0 ? (node.startIndex ?? 0) + i : node.startIndex ?? 0;
}

/** 提取"命名 import"（AST；语言无解析器时回退正则） */
export async function extractNamedImports(filePath: string, source: string): Promise<NamedImportRef[]> {
  const ast = await parseAstRoot(filePath, source);
  if (!ast) return extractNamedImportsRegex(source);
  return collectImportBinds(ast.root, ast.langName).map((b) => ({ line: b.line, module: b.module, name: b.name }));
}

/**
 * 文件里未被使用的命名 import。
 * AST 版：收集全文件 identifier/type_identifier 使用集（排除 import 绑定声明自身的字节偏移），
 * 绑定名不在使用集即未使用。比正则回退更准：字符串/注释里的同名文本不算引用；
 * re-export（export { X }）的 X 是 identifier 会进使用集 → 正确不报。
 */
export async function unusedImportsIn(filePath: string, source: string): Promise<NamedImportRef[]> {
  const ast = await parseAstRoot(filePath, source);
  if (!ast) return unusedImportsInRegex(source);
  const binds = collectImportBinds(ast.root, ast.langName);
  if (binds.length === 0) return [];
  const bindingRanges = new Set(binds.map((b) => b.startIndex));
  const used = new Set<string>();
  const walk = (n: SyntaxNodeLike): void => {
    // import/using 子树内部不是"使用点"（命名空间段如 System.IO 会误当成使用）——
    // 绑定名使用情况由"其它位置的引用"判定，绑定自身已按 startIndex 排除
    if (n.type === 'import_statement' || n.type === 'import_declaration' || n.type === 'import_from_statement' || n.type === 'using_directive') return;
    if (n.type === 'identifier' || n.type === 'type_identifier') {
      if (!bindingRanges.has(n.startIndex ?? -1)) used.add(n.text);
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(ast.root);
  return binds.filter((b) => !used.has(b.name)).map((b) => ({ line: b.line, module: b.module, name: b.name }));
}

/** 正则回退：逐行提取命名 import（TS/JS/Python/Java 各形态） */
export function extractNamedImportsRegex(source: string): NamedImportRef[] {
  const out: NamedImportRef[] = [];
  const push = (line: number, module: string, names: string[]): void => {
    for (const n of names) {
      const name = n.trim().replace(/\s+as\s+([A-Za-z_]\w*).*/, '$1').trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) out.push({ line, module, name });
    }
  };
  source.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    // TS/JS: import type {...} → 类型专用导入，不进未使用报告（与 AST 路径共用同一判据）
    if (TYPE_ONLY_IMPORT_RE.test(t)) return;
    let m: RegExpMatchArray | null;

    // import def, { a, b as c } from 'm'
    m = t.match(/^import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      push(line, m[3], [m[1], ...m[2].split(',')]);
      return;
    }
    // import { a, b } from 'm'
    m = t.match(/^import\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      push(line, m[2], m[1].split(','));
      return;
    }
    // import def from 'm'
    m = t.match(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      push(line, m[2], [m[1]]);
      return;
    }
    // const x = require('m')
    m = t.match(/^const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/);
    if (m) {
      push(line, m[2], [m[1]]);
      return;
    }
    // from m import a, b as c
    m = t.match(/^from\s+(\S+)\s+import\s+(.+)$/);
    if (m) {
      push(line, m[1], m[2].split(','));
      return;
    }
    // import os, sys / import os.path
    m = t.match(/^import\s+(\S+(?:\s*,\s*\S+)*)$/);
    if (m) {
      push(line, m[1], m[1].split(',').map((x) => x.trim().split('.')[0]));
      return;
    }
    // Java: import a.b.C; / import static a.b.C.method;
    m = t.match(/^import\s+(?:static\s+)?[\w.]+\.([A-Za-z_]\w*)\s*;/);
    if (m) {
      push(line, t, [m[1]]);
      return;
    }
  });
  return out;
}

/** 正则回退：删掉 import 行后搜不到标识符 → 未使用 */
function unusedImportsInRegex(source: string): NamedImportRef[] {
  const refs = extractNamedImportsRegex(source);
  if (refs.length === 0) return [];
  const importLines = new Set(refs.map((r) => r.line));
  const body = source
    .split('\n')
    .filter((_, i) => !importLines.has(i + 1))
    .join('\n');
  return refs.filter((r) => !new RegExp(`\\b${r.name}\\b`).test(body));
}

// ── 主分析 ───────────────────────────────────────────────────

const TYPE_KINDS = new Set<ParsedSymbol['kind']>(['interface', 'type', 'class']);

/**
 * health 的**报告策略**：类型专用导入（`import type …`）不进"未使用 import"噪音 —— v1 决定
 * （原注释逐字："类型专用导入，v1 跳过（常作 re-export，避免噪音）"）。
 *
 * ★ 为什么单列成常量：这条规则在本文件有**两条路径** —— AST 路径（`collectImportBinds`，tree-sitter 可用时）
 *   与正则降级路径（`unusedImportsInRegex`，非 TS 家族 / 解析器不可用时）。
 *   两条路径**必须给同一结论**，否则量具会在降级路径上换个答案；此前它们各写各的正则
 *   （`/^\s*import\s+type\b/` 与 `/^import\s+type\b/`），是同一意图的第二、第三份副本。
 *
 * ⚠️ 与内核 `isTypeOnlyModuleStatement()` 的**有意差别**（不是漏改）：
 *   内核那条回答"这条**依赖边**要不要算进依赖图"，覆盖 `export type … from` 与全 `type` 内联说明符；
 *   本条回答"这条 import 要不要参与**未使用报告**"，只认 `import type …` 语句形式。
 *   两个问题不同 ⇒ 判据不同。**别顺手把它们合并**，除非同时决定改报告策略。
 *   该差别已登记在 `tests/fixtures/single_source_registry.json`（G4 同族登记表）。
 */
const TYPE_ONLY_IMPORT_RE = /^\s*import\s+type\b/;

/**
 * 解析 import source 到项目内文件 —— 【唯一实现入口】。
 *
 * ★ 候选生成与分层口径已上移到 `tools/ts_kernel/import_resolve.ts` 的 `resolveProjectImport`（2026-09-30）：
 *   同一份逻辑覆盖 relative / python-dot / dotted / bare-name / package-dir **五层**
 *   （★ 2026-10-04：原第 5 层 `go-module` 已删 —— 无调用方、语义与 Go 多文件包不符，见 import_resolve.ts 注释），
 *   消解了 health/impact 各持私有实现的口径分叉（分叉 A/B/C）。
 *   此处只做薄包装：调内核 + 取 `.rel`，不引入新策略。
 */
function resolveImportFile(fromRel: string, source: string, rels: Set<string>, exts: string[]): string | null {
  return resolveProjectImport(fromRel, source, rels, { exts }).rel;
}

export async function analyzeHealth(root: string, options: HealthOptions = {}): Promise<HealthReport> {
  const threshold = options.complexityThreshold ?? 10;
  const top = options.top ?? 10;
  const parseable = listSupportedExtensions();
  const exts = codeSourceExts(parseable);
  // ★ 2026-09-29「什么算源码」口径修正：`listSupportedExtensions()` 回答的是"**我装了哪些语言包**"，
  //   不是"**什么算源码**" —— 两者不等价，且差集里恰好有 `.json`（tree-sitter-json 真能载入，
  //   「真筛子」拦不住）⇒ 夹具里的 `package.json` 曾进源码集、被报成「孤立模块 / 待清理 dead code」，
  //   已知好的夹具从 100/A 掉到 80/B。合成点 = 内核唯一权威 `codeSourceExts`（可解析 ∩ 代码语言）。
  //   走查仍按"可解析"全集**一次走完**，再分拣：源码进分析，非代码只进下面的"看得见的统计"
  //   （口径收紧不许静默 —— 同 `layers.unclassified` 的设计）。
  const { code: files, nonCodeExts } = partitionByCodeLang(collectSourceFiles(root, parseable));
  const rels = new Set(files.map((f) => f.rel));
  const parses = await Promise.all(
    files.map(async (f) => ({ rel: f.rel, parsed: await parseFileFull(f.rel, f.content) })),
  );

  // 顶层符号索引（name → [文件,符号]）+ 每文件"内部引用"集合（同文件 call/type_ref 命中）
  const symIndex = new Map<string, Array<{ rel: string; sym: ParsedSymbol }>>();
  const internalRefs = new Map<string, Set<string>>();
  for (const p of parses) {
    const refs = new Set<string>();
    for (const c of p.parsed.calls) if (c.callee_qn) refs.add(c.callee_qn);
    for (const t of p.parsed.type_refs) if (t.target_qn) refs.add(t.target_qn);
    internalRefs.set(p.rel, refs);
    for (const s of p.parsed.symbols) {
      if (s.parent) continue;
      const arr = symIndex.get(s.name) ?? [];
      arr.push({ rel: p.rel, sym: s });
      symIndex.set(s.name, arr);
    }
  }

  // 跨文件引用（导出名唯一匹配 → 目标符号 qualified_name 入 provider 的 crossRefs）
  const crossRefs = new Map<string, Set<string>>();
  /** file → importedRel → { 首个引用行, 是否 type-only }（P0-③：type_only 供违规判定用） */
  const layerImports = new Map<string, Map<string, { line: number; typeOnly: boolean }>>();
  const reverseConsumers = new Map<string, Set<string>>(); // provider → consumers（import 级）
  for (const p of parses) {
    for (const imp of p.parsed.imports) {
      const target = resolveImportFile(p.rel, imp.source, rels, exts);
      if (!target) continue;
      let m = layerImports.get(p.rel);
      if (!m) {
        m = new Map();
        layerImports.set(p.rel, m);
      }
      if (!m.has(target)) m.set(target, { line: imp.line, typeOnly: imp.type_only === true });
      let s = reverseConsumers.get(target);
      if (!s) {
        s = new Set();
        reverseConsumers.set(target, s);
      }
      s.add(p.rel);
    }
    for (const c of p.parsed.calls) {
      if (c.resolved) continue;
      // ★★ 2026-10-04（T4）：调用边的 callee 是**裸名** —— `Helper.twice(3)` 的内核产出是
      //   `{ callee: 'twice', callee_expr: 'Helper.twice' }`（实测，见 T4 取证），而 `twice`
      //   带 parent **不进 `symIndex`**（本 map 只收顶层符号）⇒ 裸名 `twice` 查空 ⇒ **这条调用边
      //   整个丢掉** ⇒ 外层顶层 `Helper` 既不在 internalRefs 也不在 crossRefs ⇒ 被误报
      //   `unused_export`（实测夹具 `C:/tmp/t4fix` 复现：`helper.ts:1 Helper` 假阳）。
      //   ⇒ 兜底：裸名不唯一时，取 `callee_expr` 的**第一段**（receiver 根，`Helper.twice`→`Helper`）
      //     再查一次顶层符号。取法与 `translate/project.ts` 的前缀提取**同式**
      //     （`/^([A-Za-z_$][\w$]*)\./`）。
      //   ★★ **唯一命中是硬约束**（`cands.length === 1`）：放宽它会把"局部变量名恰好等于别处
      //     顶层导出"当成真引用 ⇒ **掩盖真 dead code**，而**掩盖（漏报）比假阳更坏**。
      //   ★★ 且**只认本文件真正 import 过的 provider 文件**（`layerImports.get(p.rel)`）——
      //     这条是实测逼出来的（2026-10-04）：只按"receiver 根全局唯一"兜底时，本仓
      //     `scripts/**.mjs` / `dogfood/*.mjs` / `third_party/archify/**` / `go-*/main.go` 共 **24 个
      //     独立脚本被误连**（它们的导出名恰好与别处某局部变量的接收者同名）⇒ `orphan_file` 51→27，
      //     全是**掩盖**。加上"消费者 import 过该 provider 文件"这道闸后，这些独立脚本无人 import
      //     ⇒ 兜底不触发 ⇒ 读数不再漂移。语义与 `impact.resolveCallTarget` 的"前缀必须连到某个
      //     项目内文件才信任"一致（那里用 fileBindings，TS 系 `bindings` 为空故此处用 import 边等价代偿）。
      const bare = (symIndex.get(c.callee) ?? []).filter((x) => x.rel !== p.rel);
      const lm = layerImports.get(p.rel);
      const root = c.callee_expr.match(/^([A-Za-z_$][\w$]*)\./)?.[1];
      const receiver = root && root !== c.callee
        ? (symIndex.get(root) ?? []).filter((x) => x.rel !== p.rel && lm?.has(x.rel))
        : [];
      const cands = bare.length === 1 ? bare : receiver;
      if (cands.length !== 1) continue;
      let s = crossRefs.get(cands[0].rel);
      if (!s) {
        s = new Set();
        crossRefs.set(cands[0].rel, s);
      }
      s.add(cands[0].sym.qualified_name);
      // ★★ 2026-09-30（T3 / 分叉 D）：跨文件的**调用**也是"这个文件被人用了"的证据 ⇒ 记进消费者。
      //   为什么必须有（实测假阳）：`orphan_file` 原先**只**看 import 边，而**同包/同模块互相引用
      //  根本不需要 import** —— Go 同包文件之间、Julia `using` 后的裸名调用都属此类。
      //   实测（`.inspect/gopkg`，2 文件、无 import）：`main.go` 调 `helper.go` 的 `Helper`，
      //   impact 建出了边 `main.go→helper.go`，而 health 报 **`orphan_file: helper.go`** ⇒ 假阳。
      //   ★ 判据与 `impact.resolveCallTarget` 的"裸名全局唯一保底"**同源**（唯一候选才认），
      //     区别只在它作用在 health 自己的 `symIndex`/`crossRefs` 上，不新起一份实现。
      s = reverseConsumers.get(cands[0].rel);
      if (!s) {
        s = new Set();
        reverseConsumers.set(cands[0].rel, s);
      }
      s.add(p.rel);
    }
    for (const t of p.parsed.type_refs) {
      if (t.resolved) continue;
      const cands = (symIndex.get(t.type_name) ?? []).filter((x) => x.rel !== p.rel && TYPE_KINDS.has(x.sym.kind));
      if (cands.length !== 1) continue;
      let s = crossRefs.get(cands[0].rel);
      if (!s) {
        s = new Set();
        crossRefs.set(cands[0].rel, s);
      }
      s.add(cands[0].sym.qualified_name);
      // 同上：跨文件的**类型引用**也是消费者（与 import 边同义 —— 有人引用这个文件里的东西）
      s = reverseConsumers.get(cands[0].rel);
      if (!s) {
        s = new Set();
        reverseConsumers.set(cands[0].rel, s);
      }
      s.add(p.rel);
    }
  }

  // 内容快照（复杂度/未用 import 需要源码）
  const contentByRel = new Map(files.map((f) => [f.rel, f.content]));

  const issues: HealthIssue[] = [];
  const complexityEntries: ComplexityEntry[] = [];
  const layers: HealthReport['layers'] = {
    domain: 0, infrastructure: 0, application: 0, presentation: 0, outside: 0, violations: 0,
  };
  /** 可达根（P0-②）：调用方喂入的项目内相对路径，规范成无前导 `./` 的形态再比 */
  const roots = new Set((options.reachableRoots ?? []).map((r) => r.replace(/^\.\//, '')));

  for (const p of parses) {
    // P0-②：入口文件按胶水层算。它不是「积木」——它被外界（package.json / bin）调起，
    //   天然没有项目内消费者；旧逻辑当 brick ⇒ 既报 orphan 又可能报 layer_violation（实测 2 条假阳）。
    const isRoot = roots.has(p.rel);
    // ★ 2026-10-03 重写：层按**目录**判（`src/<层>/…`），**`null` = 不在四层里** ⇒ 不计数（记 `outside`）、不判违规。
    //   旧实现是 `isRoot ? 'glue' : classifyLayer(p.rel)` —— 入口特判成"胶水层"。
    //   现在**不需要这个特判**：入口天然就在 `src/presentation/`（四层之一），`classifyLayer` 会如实判它。
    //   （`isRoot` 仍用于 orphan 判定：入口天然没有项目内消费者。）
    const layer = classifyLayer(p.rel);
    if (layer) layers[layer] += 1;
    else layers.outside += 1;
    const content = contentByRel.get(p.rel) ?? '';
    const contentLines = content.split('\n');
    const internal = internalRefs.get(p.rel) ?? new Set();
    const external = crossRefs.get(p.rel) ?? new Set();
    const consumers = reverseConsumers.get(p.rel) ?? new Set();

    // ── 维度1a：未使用导出（项目内无任何引用 → potential dead；外部消费者不可见）──
    for (const s of p.parsed.symbols) {
      if (s.parent) continue;
      // 顶层 const：被函数/模块读取是常态，解析器不提取变量读边 → 反查不到，跳过避免噪音
      if (s.kind === 'const') continue;
      let used = internal.has(s.qualified_name) || external.has(s.qualified_name);
      // 兜底：同文件文本存在性——解析器只建函数体内调用边，模块级引用（入口底部 `main();`）
      // 会漏；符号名出现在定义行之外即视为被引用（保守方向，宁漏不误报）
      if (!used) {
        const rest = [
          ...contentLines.slice(0, s.start_line - 1),
          ...contentLines.slice(s.end_line),
        ].join('\n');
        used = new RegExp(`\\b${s.name}\\b`).test(rest);
      }
      if (!used) {
        issues.push({
          kind: 'unused_export',
          severity: 'info',
          file: p.rel,
          line: s.start_line,
          symbol: s.name,
          message: `顶层符号 ${s.name} 项目内无引用（外部消费者不可见，删除前请确认非公共 API）`,
        });
      }
    }

    // ── 维度1b：未使用 import（AST 提取 + 使用集比对）──
    const unusedImports = await unusedImportsIn(p.rel, content);
    for (const u of unusedImports) {
      issues.push({
        kind: 'unused_import',
        severity: 'warn',
        file: p.rel,
        line: u.line,
        symbol: u.name,
        message: `import 了 ${u.module} 的 ${u.name} 但文件内未使用`,
        evidence: u.module,
      });
    }

    // ── 维度1c：孤儿文件（无任何项目内消费者 + **不是可达根**）──
    // ★ 2026-10-03：判据从「非 `glue` 层」改为「**不是可达根**」。旧实现把两件事混在了一起 ——
    //   它先把入口特判成 `glue` 层，再用 `layer !== 'glue'` 把入口排除在孤儿之外。
    //   现在：**层 = 文件在哪**（事实，按目录判）；**是不是入口 = 可达根**（由调用方从 package.json 喂入）。
    //   两个判据分开，各用各的 —— 而且"presentation 层的文件都不算孤儿"本来就是错的（那一层也有内部模块）。
    if (consumers.size === 0 && !isRoot) {
      issues.push({
        kind: 'orphan_file',
        severity: 'info',
        file: p.rel,
        message: `整文件无项目内消费者（孤立模块，可能是待清理的 dead code）`,
      });
    }

    // ── 维度2：复杂度（AST 分支节点计数）──
    for (const s of p.parsed.symbols) {
      if (s.parent) continue;
      const slice = content.split('\n').slice(s.start_line - 1, s.end_line).join('\n');
      const c = await estimateComplexity(p.rel, slice);
      complexityEntries.push({ file: p.rel, symbol: s.name, line: s.start_line, complexity: c });
      if (c > threshold) {
        issues.push({
          kind: 'high_complexity',
          severity: 'warn',
          file: p.rel,
          line: s.start_line,
          symbol: s.name,
          message: `${s.name} 圈复杂度 ${c} 超过阈值 ${threshold}，建议拆分`,
          evidence: String(c),
        });
      }
    }

    // ── 维度3：分层违规（import 的目标层 > 自身层 = 向上依赖）──
    for (const [targetRel, impInfo] of layerImports.get(p.rel) ?? []) {
      // ★ P0-③（2026-09-28）：`import type` **不计**分层违规 —— 对齐 db/symbols.ts 的既有知识
      //   （逐字："TS `import type` 运行时擦除——不建 import 边（依赖图/闭包不算依赖）"）。
      //   这是同一条知识在本仓的第三处落点，前两处只躺在原地、没有横向传播。
      //
      //   为什么只跳过「违规判定」、**不**跳过 `reverseConsumers`：
      //     · 架构违规问的是**运行时**依赖方向 —— type-only 依赖运行时并不存在，故不构成违规；
      //     · 但 type-only 仍是真实的**编译期消费者**，若把它算成"无人消费"，
      //       orphan_file / unused_export 立刻产生假阳。两个问题问的不是一回事。
      //   实测效果：本仓 9 条假阳消失（domain/types.ts 8 条统一再导出 + adapters/types.ts 1 条），
      //   它们**全部**是 `import type`；剩下的违规因此每一条都是真依赖，可逐条解释。
      if (impInfo.typeOnly) continue;
      // ★ 2026-10-03：两端都按**目录**判层；**任一端不在四层里 ⇒ 不判**（`tests/`、`scripts/`、
      //   `go-observe/`、以及 `tests/fixtures/**/src/...` 这类夹具里的 src）。
      //   旧实现对"可达根作目标"特判成 `glue` 层（理由：入口在顶层，被入口 import 不算向上依赖）。
      //   现在**不需要**这个特例：入口天然落在 `presentation`（四层里最高的一层），
      //   任何指向它的依赖本来就该被看见 —— 旧特判是旧层表的补丁。
      const targetLayer = classifyLayer(targetRel);
      if (!layer || !targetLayer) continue;
      if (LAYER_ORDER[targetLayer] > LAYER_ORDER[layer]) {
        layers.violations += 1;
        issues.push({
          kind: 'layer_violation',
          severity: 'error',
          file: p.rel,
          line: impInfo.line,
          message: `分层违规：${layer} 依赖更高层 ${targetLayer}（${targetRel}）`,
          evidence: targetRel,
        });
      }
    }
  }

  // ── 维度4：循环依赖（★ 2026-10-03 新增，本工具原先完全没有这一维）──────────────
  //
  // ★ 数据来源：**直接复用上面已算好的 `layerImports`**（文件 → 项目内 import 目标），
  //   不另建图、不读 cache.db —— 走查过的信息不重来（本工具既有约定）。
  // ★ 范围：只取**四层内**的节点（`classifyLayer` 非 null）⇒ `tests/` / `scripts/` / 夹具不参与，
  //   与分层违规同一口径（那条也曾因把 tests 拉进来判而信噪比极差）。
  // ★ 为什么用 SCC 而不是"找一条路径"：Tarjan 给出**成环的强连通分量**，
  //   一个分量报**一条**，不会把同一个环按不同起点重复计数。
  const cycleNodes = new Set(files.map((f) => f.rel).filter((rel) => classifyLayer(rel) !== null));
  const graph = new Map<string, Set<string>>();
  for (const rel of cycleNodes) {
    const outs = new Set<string>();
    for (const [target, info] of layerImports.get(rel) ?? []) {
      // ★★ 与**分层违规同一口径**：`import type` 不算依赖（TS 运行时擦除 —— 见 profile 里那条注释）。
      //
      //   实测教训（2026-10-03，本维刚写出来时）：不排除 type-only 会多报 **2 条假环** ——
      //   `src/domain/types ↔ geometry/animation/semantic/simulation` 与 `mindmap ↔ narration`
      //   全是 `import type` 互引。后果是**同一份依赖数据在两个工具里读出不同的环**
      //   （本工具 4 条 vs dep-cruiser 2 条）⇒ 那正是本仓头号病根「判据分叉」的又一次现形。
      //   排除后两边**逐条对齐**（`write_gate ↔ index_backfill ↔ index_freshness`、
      //   `project_root ↔ rename_symbol/languages/typescript`）。
      //   ★ 2026-10-04（T26）后：上列第二条 `project_root ↔ rename_symbol/languages/typescript`
      //     已消失 —— `analyzeModuleSource` 下沉到 `infrastructure/parse/module_analysis.ts`，
      //     `project_root` 不再反向依赖特性内的语言包。原观测保留于此（改文档 ≠ 改写历史）。
      if (info.typeOnly) continue;
      if (cycleNodes.has(target)) outs.add(target);
    }
    graph.set(rel, outs);
  }
  for (const comp of findCycles([...cycleNodes], graph)) {
    issues.push({
      kind: 'circular_dependency',
      severity: 'error',
      file: comp[0]!,
      message: `循环依赖（${comp.length} 个文件成环）：${[...comp, comp[0]!].join(' → ')}`,
      evidence: comp.join(' → '),
    });
  }

  complexityEntries.sort((a, b) => b.complexity - a.complexity);
  const counts: Record<HealthKind, number> = {
    unused_export: 0, unused_import: 0, orphan_file: 0, high_complexity: 0, layer_violation: 0, circular_dependency: 0,
  };
  for (const i of issues) counts[i.kind] += 1;

  // ── 健康评分（P0-④，2026-09-28 重做：去饱和）────────────────
  //
  // 旧实现：`score = 100 - Σ(count × 常数)` 再 clamp [0,100]。实测的失败模式是**两端都饱和**：
  //   · 本仓真读数 −2400 被压成 **0 (D)**；443 高复杂度 / 156 未用导出 / 12 分层违规
  //     这些截然不同的状态会读出**同一个数** ⇒ 没有动态范围，改好了也不动 ⇒ 不能承载判断。
  //   · 更糟的反向饱和：一个**不存在的路径**（0 个文件）读到 **100 (A)** —— "没输入"被当成"满分健康"。
  //   （计划书 §5 的 G5 就是这条教训：一个在两种状态下读数相同的指标，不是判据，是常量。）
  //
  // 新实现：**密度归一 + 单维封顶的连续映射**。
  //   · 先把绝对条数换成「密度」= 条数 / 文件数 × 100（条/百文件）—— 使读数不随代码规模
  //     单调变化（给同一份代码加文件不会自己变健康），也让"大仓天然违规多"不再自动压穿。
  //   · 再对每维按 `w × min(1, 密度 / fullAt)` 扣分：**单维扣分上限 = w（各维之和 = 100）**
  //     ⇒ 任何单一维度爆表都压不穿总分；**且封顶之前逐条都有分辨率**（这点很关键：
  //     纯"分档"实现里 1 条违规与 2 条违规会落同一档、读同一个数，等于把饱和搬到档内）。
  //   · 0 个源文件 ⇒ `grade = 'N/A'`、`score = 0`，summary 首句明说"无输入"。
  //     空输入不是"健康"、也不是"极坏"，它是**第三种状态**，必须能与这两者区分开。
  //
  // ⚠️ `fullAt` 是**标定值**，不是自然常数：它表示"该维密度到此即扣满"。选它的依据是
  //    让本仓当前读数落在有区分度的区间内（实测 43 分 / D），不是让本仓好看。
  //    改 fullAt = 改判据口径 ⇒ 必须同步 G5 门（tests/health/health-validity.test.ts）与 docs 台账。
  const score = computeScore(counts, files.length);
  const grade = score.grade;

  const density = (n: number): string =>
    files.length === 0 ? '—' : `${((n / files.length) * 100).toFixed(1)}/百文件`;

  const summary =
    files.length === 0
      ? `无输入（0 个源文件）—— 本次读数不代表健康，grade=N/A。请检查 root 是否存在、扩展名是否被内核支持。`
      : `健康度 ${score.value} 分（${grade}）：${counts.circular_dependency} 循环依赖 / ` +
        `${counts.layer_violation} 分层违规 / ` +
        `${counts.high_complexity} 高复杂度 / ${counts.unused_export} 未使用导出 / ` +
        `${counts.unused_import} 未使用 import / ${counts.orphan_file} 孤儿文件` +
        `　[密度 环 ${density(counts.circular_dependency)} · 违规 ${density(counts.layer_violation)} · 复杂度 ${density(counts.high_complexity)} · ` +
        `孤儿 ${density(counts.orphan_file)} · 未用导出 ${density(counts.unused_export)} · ` +
        `未用 import ${density(counts.unused_import)}]` +
        // ★ 2026-10-03：分层改为**真实四层**（按目录）。`outside` = 不在 `src/<四层>/` 下的文件，
        //   **如实计数但不判违规**（旧实现在这里用三分类启发式兜底 ⇒ 95% 落 brick、还把 tests 拉进来判）。
        `　[分层 domain ${layers.domain} / infrastructure ${layers.infrastructure} / application ${layers.application} / presentation ${layers.presentation}` +
        `　｜四层外(不判层) ${layers.outside}｜违规 ${layers.violations}]` +
        // ★ 口径可见性（非空才出现）：被"代码语言"口径排除的文件说清楚，别静默消失。
        (nonCodeExts.length > 0
          ? `　[口径 非代码语言未计入源码：${nonCodeExts.map((e) => `${e.ext}×${e.count}`).join(' ')}]`
          : '');

  return {
    root,
    fileCount: files.length,
    issues,
    counts,
    complexity: complexityEntries.slice(0, top),
    layers,
    score: score.value,
    grade,
    summary,
    // ★ 扫描边界恒在（扫仓库类工具的自证字段；口径收紧被排除的文件走 skipped，不静默消失）
    bounds: {
      scope: '全项目源码文件（AST 解析 + 调用/类型/import 边；源码集 = 可解析 ∩ 代码语言）',
      scanned: { files: files.length },
      ...(nonCodeExts.length > 0 ? { skipped: boundsSkipFromExcluded(nonCodeExts) } : {}),
    },
  };
}

/**
 * 每维度评分口径（P0-④）。
 * `w` = 该维度**最多**扣多少分（各维之和 = 100 ⇒ 单维不可压穿总分）；
 * `fullAt` = 密度（条/百文件）达到该值即扣满。
 */
const SCORE_SPEC: Record<HealthKind, { w: number; fullAt: number }> = {
  layer_violation: { w: 30, fullAt: 15 },
  // ★ 2026-10-03 新增：**循环依赖**。权重给到与分层违规同级 —— 环是"改不动、初始化顺序玄学"的
  //   结构性病灶（本仓搬迁期间实测会**静默产生**新环：跨层互引一次就成环）。
  //   `fullAt: 10` = 有 10 条环就扣满这一维（本仓当前实测 2 条 ⇒ 扣 5 分）。
  circular_dependency: { w: 30, fullAt: 10 },
  high_complexity: { w: 25, fullAt: 30 },
  orphan_file: { w: 20, fullAt: 10 },
  unused_export: { w: 15, fullAt: 50 },
  unused_import: { w: 10, fullAt: 25 },
};

const SCORE_KEYS = Object.keys(SCORE_SPEC) as HealthKind[];

/**
 * 由各维度计数算健康分（纯函数，可单测 —— G5 的"分辨率"断言直接打在这里）。
 *
 * `contribution` 返回每维实际扣了多少分，用于解释读数（"这 43 分是被什么扣掉的"），
 * 也用于 G5 断言"某一维变差 ⇒ 总分必须跟着变"（单调性）。
 *
 * 0 个文件 ⇒ `{ value: 0, grade: 'N/A' }`（**不是** 100 —— 见调用点上方注释的反向饱和）。
 */
export function computeScore(
  counts: Record<HealthKind, number>,
  fileCount: number,
): { value: number; grade: HealthReport['grade']; contribution: Record<HealthKind, number> } {
  const contribution = {} as Record<HealthKind, number>;
  if (fileCount === 0) {
    for (const k of SCORE_KEYS) contribution[k] = 0;
    return { value: 0, grade: 'N/A', contribution };
  }
  let deducted = 0;
  for (const k of SCORE_KEYS) {
    const spec = SCORE_SPEC[k];
    const per100 = (counts[k] / fileCount) * 100;
    const c = spec.w * Math.min(1, per100 / spec.fullAt); // 连续 + 单维封顶
    contribution[k] = c;
    deducted += c;
  }
  const value = Math.max(0, Math.min(100, Math.round(100 - deducted)));
  const grade: HealthReport['grade'] = value >= 90 ? 'A' : value >= 75 ? 'B' : value >= 60 ? 'C' : 'D';
  return { value, grade, contribution };
}
