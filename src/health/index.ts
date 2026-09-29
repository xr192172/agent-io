/**
 * health —— 代码健康度（死代码 / 复杂度 / 分层违规）
 *
 * 守护"积木 / 契约 / 胶水"三分层哲学，是项目杂交"选材体检"的评分依据：
 *   1. 死代码   ：未使用导出（复用调用边/类型引用边反查）+ 未使用 import + 孤儿文件
 *   2. 复杂度   ：顶层函数/方法圈复杂度启发式（阈值默认 10）
 *   3. 分层违规 ：依赖方向向上（低层 import 高层）→ 破坏分层
 *
 * 分层语义（依赖应自上而下流动，违规 = 向上依赖）：
 *   胶水层(2) → 积木层(1) → 契约层(0)
 *     · 胶水 → 积木 / 胶水 → 契约 / 积木 → 契约   正常
 *     · 契约 → 积木 / 契约 → 胶水 / 积木 → 胶水   违规（低层反向依赖高层）
 *   分类启发式：路径命中契约/胶水特征即归类，其余默认积木。
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

import { parseFileFull, parseAstRoot, listSupportedExtensions, resolveImportPath, type ParsedSymbol, type SyntaxNodeLike } from '../tools/ts_kernel/index.js';
import { codeSourceExts, partitionByCodeLang } from '../tools/ts_kernel/source_exts.js';
import { collectSourceFiles } from '../version_upgrade/detect.js';

// ── 对外类型 ─────────────────────────────────────────────────

export type Layer = 'contract' | 'brick' | 'glue';

export type HealthKind =
  | 'unused_export'
  | 'unused_import'
  | 'orphan_file'
  | 'high_complexity'
  | 'layer_violation';

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
   * 分层统计。
   * `unclassified` = 未命中任何层特征、落到兜底 brick 的文件数（P0-⑤，2026-09-28）。
   *
   * ★ 为什么要单列它：brick 同时兼任「正面特征命中」与「什么都没命中」两个角色，
   *   实测本仓 279/303（92%）落在这里 ⇒ 这个分级几乎不携带信息，却看不出来。
   *   单列后「规则是否已退化」变成一个可读的数，而不是沉默的兜底。
   *   （同款设计见 `capability_map` 的「未归线」段：看得见，而非静默消失。）
   */
  layers: { contract: number; brick: number; glue: number; unclassified: number; violations: number };
  /** 0-100 健康分 + 等级；`N/A` = 没有可评的输入（0 个源文件），**不是满分** */
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'N/A';
  summary: string;
  /**
   * 「口径收紧的可见性」（2026-09-29）：**装了/可解析、但按「代码语言」不算源码**的扩展名 → 文件数
   * （如 `[{ ext: '.json', count: 1 }]`）。
   *
   * ★ 为什么要单列：源码集从"可解析"收到"代码语言"之后，`.json` 这类文件**不再进体检** ——
   *   如果连"有几个、是什么"都不说，那就是本仓头注批的「**缺失是沉默的**」。
   *   同款设计见 `layers.unclassified`（单列"什么都没命中"的文件数，而不是混进 brick）。
   * ★ **只在非空时出现**：没有可说的就不说 —— 这样"读数没变"与"口径变了但没东西被排除"
   *   在回执上可区分（也让逐工具行为快照 G8 只在真有变化时才动）。
   */
  excludedNonCode?: Array<{ ext: string; count: number }>;
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

const CONTRACT_HINTS: RegExp[] = [
  /\/contracts?\//,
  /\/types\//,
  /\/interfaces?\//,
  /\/dto\//,
  /(^|\/)types\.(ts|tsx|js|mjs)$/,
  /\.types\./,
  /_types\./,
  /\.d\.ts$/,
];

const GLUE_HINTS: RegExp[] = [
  /\/glue\//,
  /\/routes?\//,
  /\/middleware\//,
  /\/config\//,
  /\/entry\//,
  /(^|\/)main\.(ts|tsx|js|jsx|mjs)$/,
  /(^|\/)app\.(ts|tsx|js|jsx)$/,
  /(^|\/)server(\.|$)/,
  /_cli\.(ts|js|mjs)$/,
  /server_registry\./,
  /hub\.mjs$/,
];

const LAYER_ORDER: Record<Layer, number> = { contract: 0, brick: 1, glue: 2 };

/**
 * ★ P2 之后改这一张表（P0-⑤，2026-09-28）。
 *
 * 目标形态（见 `docs/architecture-refactor-plan.md` §4）是
 * `surfaces / features / kernel / dsl` 四层。**故意不在 P0 就换** —— 因为 P2 会分批搬迁
 * 71k 行，中间态下新规则会把「还没搬完」全部判成违规，直接毁掉 P0 的验收口径
 * 「层违规非空且**每条可解释**」。所以 P0 只做两件事（见下），换表留给 P2 落地那一刻。
 */

/** 是否命中某一层的**正面**特征（未命中 = 落兜底 brick，见 `unclassified`） */
export function layerMatched(rel: string): boolean {
  const p = normalizeForMatch(rel);
  return CONTRACT_HINTS.some((re) => re.test(p)) || GLUE_HINTS.some((re) => re.test(p));
}

/**
 * ★ 规范化：补一个前导 `/`，使**根级文件与深层文件同判**（P0-⑤，2026-09-28）。
 *
 * 修的是实测到的一个缺陷：旧实现把正则直接打在 `rel` 上，而 `GLUE_HINTS` 里
 * `/\/server(\.|$)/`、`/\/routes?\//`、`/\/config\//` 这些都**要求前导斜杠** ⇒
 * `classifyLayer('src/server.ts')` 判 glue，`classifyLayer('server.ts')` 判 brick。
 * 即：**同一个文件，因为调用方传的 root 不同而分层不同**：
 *   `analyzeHealth('src')`（rel 无 `src/` 前缀）与 `analyzeHealth('.')`（rel 有）读数不一致。
 * 量具的读数不该取决于你从哪一级目录调用它。补前导 `/` 后两条路径同判。
 *
 * 注：`CONTRACT_HINTS` 里 `/(^|\/)types\.…$/` 这类本来就两种写法都覆盖，补 `/` 不改变其行为。
 */
function normalizeForMatch(rel: string): string {
  return rel.startsWith('/') ? rel : `/${rel}`;
}

/** 按路径启发式给文件分层（未命中任何层特征 → 默认积木层） */
export function classifyLayer(rel: string): Layer {
  const p = normalizeForMatch(rel);
  if (CONTRACT_HINTS.some((re) => re.test(p))) return 'contract';
  if (GLUE_HINTS.some((re) => re.test(p))) return 'glue';
  return 'brick';
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
 * 解析相对 import 到项目内文件（包导入/逃出项目根返回 null）。
 *
 * ★ 候选生成已上移到 `tools/ts_kernel/import_resolve.ts`（**唯一实现**，2026-09-28）：
 *   这段逻辑曾被复制成 3 份且只有 1 份正确 ⇒ 本仓 961/971 条相对 import（带 `.js` 后缀）
 *   在本份上解析恒 null ⇒ orphan_file 284 假阳 + 分层违规空转。
 *   此处只保留 health 自己的策略：**包导入不建边**。
 */
function resolveImportFile(fromRel: string, source: string, rels: Set<string>, exts: string[]): string | null {
  if (!source.startsWith('.')) return null;
  return resolveImportPath(fromRel, source, (c) => rels.has(c), { exts });
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
      const cands = (symIndex.get(c.callee) ?? []).filter((x) => x.rel !== p.rel);
      if (cands.length !== 1) continue;
      let s = crossRefs.get(cands[0].rel);
      if (!s) {
        s = new Set();
        crossRefs.set(cands[0].rel, s);
      }
      s.add(cands[0].sym.qualified_name);
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
    }
  }

  // 内容快照（复杂度/未用 import 需要源码）
  const contentByRel = new Map(files.map((f) => [f.rel, f.content]));

  const issues: HealthIssue[] = [];
  const complexityEntries: ComplexityEntry[] = [];
  const layers: { contract: number; brick: number; glue: number; unclassified: number; violations: number } = {
    contract: 0, brick: 0, glue: 0, unclassified: 0, violations: 0,
  };
  /** 可达根（P0-②）：调用方喂入的项目内相对路径，规范成无前导 `./` 的形态再比 */
  const roots = new Set((options.reachableRoots ?? []).map((r) => r.replace(/^\.\//, '')));

  for (const p of parses) {
    // P0-②：入口文件按胶水层算。它不是「积木」——它被外界（package.json / bin）调起，
    //   天然没有项目内消费者；旧逻辑当 brick ⇒ 既报 orphan 又可能报 layer_violation（实测 2 条假阳）。
    const isRoot = roots.has(p.rel);
    const layer: Layer = isRoot ? 'glue' : classifyLayer(p.rel);
    layers[layer] += 1;
    // P0-⑤：单列「未命中任何层特征」的兜底文件数，让规则退化可见（见 HealthReport.layers 注释）
    if (layer === 'brick' && !layerMatched(p.rel)) layers.unclassified += 1;
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

    // ── 维度1c：孤儿文件（无任何项目内消费者 + 非胶水层）──
    // ★ 可达根（P0-②）已在上面被归入 glue 层，故天然不会落到这里 —— 无需再判 isRoot。
    //   实测本仓修掉 2 条假阳：daemon/daemon.ts（npm run daemon）、tools/serve.ts（npm run serve）。
    if (consumers.size === 0 && layer !== 'glue') {
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
      //   实测效果：本仓 9 条假阳消失（dsl/types.ts 8 条统一再导出 + adapters/types.ts 1 条），
      //   它们**全部**是 `import type`；剩下的违规因此每一条都是真依赖，可逐条解释。
      if (impInfo.typeOnly) continue;
      // 可达根作目标时同按胶水层算（P0-②）：入口是顶层，被入口 import 不是"向上依赖"
      const targetLayer: Layer = roots.has(targetRel) ? 'glue' : classifyLayer(targetRel);
      if (LAYER_ORDER[targetLayer] > LAYER_ORDER[layer]) {
        layers.violations += 1;
        issues.push({
          kind: 'layer_violation',
          severity: 'error',
          file: p.rel,
          line: impInfo.line,
          message: `分层违规：${layer} 层依赖高层 ${targetLayer} 层（${targetRel}）`,
          evidence: targetRel,
        });
      }
    }
  }

  complexityEntries.sort((a, b) => b.complexity - a.complexity);
  const counts: Record<HealthKind, number> = {
    unused_export: 0, unused_import: 0, orphan_file: 0, high_complexity: 0, layer_violation: 0,
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
      : `健康度 ${score.value} 分（${grade}）：${counts.layer_violation} 分层违规 / ` +
        `${counts.high_complexity} 高复杂度 / ${counts.unused_export} 未使用导出 / ` +
        `${counts.unused_import} 未使用 import / ${counts.orphan_file} 孤儿文件` +
        `　[密度 违规 ${density(counts.layer_violation)} · 复杂度 ${density(counts.high_complexity)} · ` +
        `孤儿 ${density(counts.orphan_file)} · 未用导出 ${density(counts.unused_export)} · ` +
        `未用 import ${density(counts.unused_import)}]` +
        `　[分层 契约 ${layers.contract} / 积木 ${layers.brick}（其中未分类 ${layers.unclassified}）/ 胶水 ${layers.glue}]` +
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
    // ★ 只在非空时出现（理由见 HealthReport.excludedNonCode 的注释）
    ...(nonCodeExts.length > 0 ? { excludedNonCode: nonCodeExts } : {}),
  };
}

/**
 * 每维度评分口径（P0-④）。
 * `w` = 该维度**最多**扣多少分（各维之和 = 100 ⇒ 单维不可压穿总分）；
 * `fullAt` = 密度（条/百文件）达到该值即扣满。
 */
const SCORE_SPEC: Record<HealthKind, { w: number; fullAt: number }> = {
  layer_violation: { w: 30, fullAt: 15 },
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
