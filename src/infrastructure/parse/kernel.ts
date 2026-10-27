/**
 * Tree-sitter Kernel
 *
 * 统一接口：parseFile(path, content) → ParsedSymbol[]
 *
 * 设计原则：
 *   1. 零硬编码 import（不再有 `import Go from 'tree-sitter-go'`）
 *   2. 自动探测本地已装的语言包（probe）
 *   3. 动态加载（loader）+ 缓存
 *   4. 失败优雅降级（返回空数组，不抛）
 *   5. 可被多个工具共享（consistency / health / 未来的 lint/format）
 *      ★ 原举例的 `backfill` 已随 T20 删除（2026-10-06 更正——举例也不能指着不存在的东西）
 *
 * 用法：
 *   import { parseFile, listSupportedLanguages } from './ts_kernel';
 *   const symbols = await parseFile('src/app.go', goSource);
 *
 * 共享给其他项目：
 *   - 抽出为 @agent-io/ts-kernel 包
 *   - 各项目 npm install 后都能用
 *   - 用户只需装一次 tree-sitter-* 包
 */

import path from 'node:path';
// ★ T-#87：import source 的**通用求值**兜底（`vm` 沙箱 —— Node 内置，零新依赖）
import vm from 'node:vm';
import { pathToFileURL as nodePathToFileURL, fileURLToPath as nodeFileURLToPath } from 'node:url';
import type Parser from 'tree-sitter';
import { findLanguageByExt, LANGUAGES, LanguageEntry } from './languages.js';
import { isLanguageInstalled, isExtSupported, listSupportedExts, probeInstalledLanguages } from './probe.js';
import { getParser, getParserSync, clearLoaderCache } from './loader.js';
import { missingLanguageHint } from './lang_hint.js';

import { typeMembersOf, TYPE_DECL_NODES, type ParsedTypeMember } from './type_members.js';
import { paramsOf, type ParsedParam } from './symbol_params.js';
import { shapeOf, type ParsedTypeParam } from './symbol_shape.js';
import { docstringOf } from './symbol_docstring.js';

export interface ParsedSymbol {
  name: string;
  kind: 'function' | 'method' | 'class' | 'interface' | 'type' | 'const';
  start_line: number;
  end_line: number;
  qualified_name: string;
  signature: string;
  parent?: string;
  /**
   * 局部闭包/辅助函数标记：不是设计契约面（不进 DSL 的 apis/symbols），
   * 但仍是合法符号（保留在 cache.db 供搜索/引用/重命名）。
   * 触发条件：
   *   - 函数体内嵌套的 function/method（enclosing 是函数作用域），或
   *   - 顶层 const/var 绑定裸闭包值（Go `var x = func(){}`、Python `x = lambda`）。
   */
  is_closure?: boolean;
  /**
   * ★ 2026-10-20：**类型成员**（`name` / `type` / `optional`），只对 `type` / `interface` / `class` 有。
   *
   * 为什么单独一个字段而不是塞进 `signature`：`signature` 对这三类是 `Name()`（成员全丢），
   * 而对 `function` 是完整的参数列表 —— **两者语义本来就不同**，强行统一会两头不讨好。
   */
  members?: ParsedTypeMember[];
  /**
   * ★ 2026-10-20（v13）：**形参表**（name / type / optional / variadic），只对 `function` / `method` 有。
   *
   * 为什么不在 `signature` 里拆：签名是**一根字符串**，两侧各拆一次就会各漂各的
   * （T154「两侧判据不对称」的根因）。形参是**结构化事实** ⇒ 内核给一次，消费方读同一份。
   * `consistency.ts` 的 `compareSignatures` 原先 `match(/\(([^)]*)\)/)` 拆串，现改读本字段。
   */
  params?: ParsedParam[];
  /**
   * ★ 2026-10-21（v14）：**返回类型原文**（`Promise<X>` / `(bool, int)` / `?array`）。
   *
   * 为什么单独一列：消费方（`consistency.ts` 的 `returnTypeOf` / `derive_mind_map` 的 outs）
   * 此前都从 `signature` 里**拆同一根串** —— 与 v13 的形参同一个病根。
   * 取不到（无返回类型注解 / 该语法无此字段）⇒ 省略（落库 NULL），不猜。
   */
  returnType?: string;
  /**
   * ★ 2026-10-21（v14）：**泛型参数表**（name / constraint / default），由 `symbol_shape.ts` 从 AST 抽。
   * ★ 三态（schema 注释里写死）：**省略** = 该语言没有泛型语法 / 没抽；
   *   `[]` = 抽到了、此处确实没有泛型；非空 = 真有。
   */
  typeParams?: ParsedTypeParam[];
  /**
   * ★ 2026-10-21（v14）：**修饰符 + 装饰器**（`export`/`async`/`static`/`readonly`/`abstract`/
   *   `public`… + `@dec` / `#[Attr]` / `[Obsolete]`）。
   * ★ 同样三态：省略 = 该语言不抽（Go 无修饰符关键字）；`[]` = 抽了、确实没有。
   */
  modifiers?: string[];
  /**
   * ★ 2026-10-21（v15）：**函数体原文**（`nodes.body_text`）—— 从 AST 的体节点取 `text`，原文照录。
   *
   * 为什么加：v14 之后 DB 知道"函数长什么样"（签名 / 形参 / 返回类型 / 修饰符），**不知道它做了什么**
   * ⇒ 重写一个函数仍必须打开源文件（用户判据：**不用打开源文件才算 DB 全**）。
   * ★ 取法规则表 = `LANG_ADAPTERS` 的 `bodyFields` / `bodyNodeTypes`（与 `bodyChildren` **同一份**，
   *   不另抄一份）⇒ 内核里没有"按语言的 if"。
   * ★ 省略 = 没有体（type / interface / class / 纯值 const）**或**该语言的体不是单一 AST 节点
   *   （`bodyIsSelf`：julia / fish / crystal）⇒ 落库 NULL；**空串禁用**
   *   （判据见 `schema.ts` 的列注释：NULL 的含义、是否含花括号、怎么用 `files.content_hash` 校验同源）。
   */
  bodyText?: string;
  /**
   * ★ 2026-10-21：**文档注释原文**（`nodes.docstring`；列早已存在，这一天起才真写值）—— 取法规则表见 `symbol_docstring.ts`。
   *
   * 为什么加：这一列建库时就在，但 kernel 从来没给过 ⇒ 实测 0 / 8726 全 NULL —— 读者会把它读成
   * 「这个符号确实没有文档」，而真相是「我们从来没取过」。判据（用户）：**AST 里能解析什么就写进来**。
   * ★ 规则表 = `DOCSTRING_SPECS`（含「前驱注释必须紧邻」这条判据，写在那个文件的头部）
   *   ⇒ 内核里没有"按语言的 if"。
   * ★ 省略 = 该语言没登记规则（c/cpp/ruby…）**或**确实没有文档（普通 `//`/`#` 注释不算文档）
   *   ⇒ 落库 NULL；**空串禁用**（空串会被下游读成"文档确实是空的"）。
   * ★ 原文照录：不剥 `/**` `///` 引号、不截第一行（剥了就在源码里搜不到，消费方没法回源核对）。
   */
  docstring?: string;
}

/** import 依赖（用于 import_project 的跨文件边推导） */
export interface ParsedImport {
  /** 原始 import 路径（如 './foo/bar'、'myproject/internal/x'、'os.path'；Python 相对导入保留前导点如 '..pkg'） */
  source: string;
  /**
   * ★ 2026-10-20：**整条 import 语句的字符 span**（`remove_dead_imports` 删整句要用）。
   *   ★ 已知限度：一个 node 内有多个 source（如 Go 的 `import (...)` 块）时，
   *     每个 source 记的都是**同一整块**的 span —— 消费者删之前要看 sources 有几条。
   *   ★ 解析器没给偏移时**省略**（不猜）。
   */
  start_index?: number;
  end_index?: number;
  /** relative = 相对路径（./ ../ 或 Python 前导点）；package = 包路径 */
  kind: 'relative' | 'package' | 'computed';
  line: number;
  /**
   * TS 系 `import type { X } from ...`——整条语句运行时擦除（零运行时依赖）。
   * 闭包/依赖方向/外部依赖三分类均不算边；shapes 消费（类型引用）另论。
   * `import { type X }`（混合语句单说明符）不算——语句仍保留，保守不标。
   */
  type_only?: boolean;
  /**
   * 该 import 绑定的「本地可用名字」（Go/Python 提取；TS 系走 ImportEdge.remoteName/localName 精确，不填）。
   * 用途：符号级跨语言引用判定——给定使用点 token（如 `pkg.Symbol` 的 `pkg`、`from x import n` 的 `n`，
   * 判定它源自哪个 import 边，从而验证是否连向 target 定义模块。
   */
  bindings?: string[];
  /**
   * ★ 2026-10-21：模块源 / 绑定名的**判据来源**（`ast` 语法树子节点 / `regex` 正则兜底）。
   *   只有做了区分的语言（go 别名 · python from · kotlin · php）才写；其余语言**不写这个字段**
   *   —— 缺省 ≠ ast，缺省 = 本语言没有这条判据。
   */
  source_via?: ImportExtractVia;
  bindings_via?: ImportExtractVia;
}

/** 函数级调用边（同文件内，AST 提取，路线图序号 3 的第一步） */
export interface ParsedCall {
  /** 调用者符号 qualified_name（同文件内） */
  caller: string;
  /** 被调用名（去点后的尾部标识符，如 'Process' from 'svc.Process' / 'this.method'） */
  callee: string;
  /** 完整被调用表达式（含前缀，如 'svc.Process'），未解析时写入 unresolved_refs */
  callee_expr: string;
  line: number;
  /** 同文件符号表命中（true）——false 表示外部/内置/跨文件候选 */
  resolved: boolean;
  /** resolved 时对应的同文件符号 qualified_name */
  callee_qn?: string;
  /**
   * ★★★ 2026-10-27（T-#55）：**这个名字是某个祖先作用域的“参数”**（不是符号）。
   *
   * 为什么要在这里标（而不是事后从 `nodes` 反推）：
   *   `new Promise((resolve, reject) => { … })` 里的 `resolve`/`reject` 是**匿名箭头**的参数
   *   —— 匿名箭头**没有名字** ⇒ 不进 `nodes` ⇒ **没有行范围可匹配**
   *   ⇒ 现有数据**永远判不了**它（实测 ~50 条落 failed）。
   * 而解析时**作用域就在手上** ⇒ 只有在这里标得准。
   */
  local?: boolean;
}

/** 类型引用边（同文件内）：函数/类签名或体内引用了 interface/type/class 符号。
 *  波及语义：改类型定义 → 所有引用者受影响（call 图对此不可见） */
export interface ParsedTypeRef {
  /** 引用者符号 qualified_name（归属包含它的最近符号） */
  referrer: string;
  /** 被引用类型名 */
  type_name: string;
  line: number;
  /** 同文件符号表命中（interface/type/class） */
  resolved: boolean;
  /** resolved 时对应的同文件类型符号 qualified_name */
  target_qn?: string;
}

// ─────────────────────────────────────────────────────────────
// 节点类型 → 通用 Symbol kind 映射
// ─────────────────────────────────────────────────────────────

function nodeTypeToKind(nodeType: string, parent?: string): ParsedSymbol['kind'] {
  if (nodeType.includes('class') || nodeType === 'object_declaration') return 'class'; // kotlin object（单例）也是类型
  if (nodeType.includes('interface')) return 'interface';
  // ★★★ 2026-10-27（T-#58）：**类型别名/类型定义永远是 `type`，不因嵌套而降级成 `method`**。
  //   实测：`type OverviewJudge = {…}` 声明在**函数体内**（`query_feature.ts:1808`）
  //   ⇒ 原先掉进下面 `includes('type')` 分支的 `if (parent) return 'method'`
  //   ⇒ 它变成 `kind='method'` ⇒ 被 `typeNamesByFile`（只收 interface/type/class）**排除**
  //   ⇒ **引用它的 type_ref 永远解析不到**（同型：`Span` / `Row` / `QueueItem` / `CallResult` …）。
  if (
    nodeType === 'type_alias_declaration' ||
    nodeType === 'type_definition' ||
    nodeType === 'type_spec' ||
    nodeType === 'type_declaration' ||
    nodeType === 'type_item'
  ) {
    return 'type';
  }
  // enum 是类型也是值：映射 'type' 才能被跨文件 type_ref 解析命中
  // （resolveCrossFileCalls 的 typeNamesByFile 只认 interface/type/class；
  // 落到末尾的 'function' 会漏——v7 清库重解析后生效）
  if (nodeType.includes('enum')) return 'type';
  if (nodeType.includes('method')) return 'method';
  if (nodeType.includes('struct') || nodeType.includes('trait') || nodeType.includes('impl')) return 'type';
  if (nodeType === 'function_definition' || nodeType === 'function_declaration' || nodeType === 'function_item' || nodeType === 'FnDecl' || nodeType === 'proc_def' || nodeType === 'method' || nodeType === 'sub' || nodeType === 'proc') {
    return parent ? 'method' : 'function';
  }
  if (nodeType.includes('type') || nodeType.includes('FnDecl') || nodeType === 'method_declaration') {
    if (parent) return 'method';
    if (nodeType.includes('declaration') || nodeType.includes('definition') || nodeType.includes('spec')) return 'type';
  }
  if (nodeType === 'method_declaration') return 'method';
  if (parent) return 'method';
  return 'function';
}

// ─────────────────────────────────────────────────────────────
// 通用遍历器
// ─────────────────────────────────────────────────────────────

interface SyntaxNodeLike {
  type: string;
  startPosition: { row: number };
  endPosition: { row: number };
  text: string;
  /** 字符级字节偏移（tree-sitter 节点原生支持，供文本注入/插桩使用） */
  startIndex?: number;
  endIndex?: number;
  /** 命名节点标记（匿名关键字/标点为 false——'else'/'if' 等关键字 type 也是纯字母，\w 正则无法区分） */
  isNamed?: boolean;
  /** 子树含 ERROR/MISSING 节点（tree-sitter 容错解析不抛错，靠此标记识别语法破坏） */
  hasError?: boolean;
  /** 父节点（★ v14：装饰器/注解可能挂在父节点或前驱兄弟上 —— python `decorated_definition`、
   *  ts `export_statement`、rust `attribute_item`；tree-sitter 节点原生提供，测试桩可不给） */
  parent?: SyntaxNodeLike | null;
  childForFieldName(name: string): SyntaxNodeLike | null;
  child(index: number): SyntaxNodeLike | null;
  childCount: number;
}

function fieldText(node: SyntaxNodeLike | null, fieldName: string): string {
  if (!node) return '';
  const child = node.childForFieldName(fieldName);
  return child ? child.text : '';
}

/** 标识符合法性：非空、长度 ≤ 64、只含字母数字下划线 $、不以数字开头 */
function isValidIdentifier(s: string): boolean {
  if (!s || s.length === 0 || s.length > 64) return false;
  if (/^\d/.test(s)) return false;
  return /^[A-Za-z_$][\w$]*$/.test(s);
}

/**
 * C/C++ declarator 包装节点：函数名可能被指针/引用/括号声明符包住。
 * ★ 2026-09-29 已下沉为**数据**（`LanguageEntry` 的 `nameNodeTypes`）：
 *   原先这里是一个硬编码的 `Set`，现在 C/C++ 表项自带同一份名单，
 *   内核不再认识"cpp 是什么"（见 `resolveName`）。
 */

/** 名字的**默认**候选节点类型（tree-sitter 各语法给"名字"命名的通用惯例）。
 *  ★ 这不是按语言分支，而是"未声明 nameNodeTypes 的语言"的兜底惯例；
 *    声明了 nameNodeTypes 的语言（C/C++、Julia）完全走自己的名单。
 *    保留它 = 不因本次收紧而让表里另外 50+ 门语言的既有行为集体退化。 */
const DEFAULT_NAME_NODE_TYPES = ['identifier', 'property_identifier', 'type_identifier', 'simple_identifier', 'name'];

/** 体的**默认**候选字段名（tree-sitter 两种通用命名：主流 'body' / Python 系 'suite'）。
 *  ★ 同理：不是按语言分支，是"未声明 bodyFields 的语言"的兜底；Haskell='match'、
 *    Elixir='do_block'、Kotlin（无字段）等各语言表项自带声明。 */
const DEFAULT_BODY_FIELDS = ['body', 'suite'];

/** 逐层取名字：先看本节点的 `name` 字段，再按类型名单下钻，最后取自身文本（叶子） */
function nameAtNode(node: SyntaxNodeLike, types: string[], nameField: string, depth: number): string {
  const byField = fieldText(node, nameField);
  if (byField && isValidIdentifier(byField)) return byField;
  const byTypes = nameViaTypes(node, types, nameField, depth + 1);
  if (byTypes) return byTypes;
  return isValidIdentifier(node.text) ? node.text : '';
}

/**
 * 按**类型名单**（列表序 = 优先级）递归下钻取名字。
 * 下钻规则：对名单里的每个类型，按文档序找**直接**子节点；命中就递归进去
 * （`depth` 封顶 8），递归结果为空则继续试下一个。
 * 为什么列表序即优先级：C/C++ 必须**先**走声明符包装链，否则
 * `Node* next(){…}` 会把**返回类型** Node 当符号名（实测，见 .inspect 侦察）。
 */
function nameViaTypes(node: SyntaxNodeLike, types: string[], nameField: string, depth = 0): string {
  if (depth > 8) return '';
  for (const t of types) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c || c.type !== t) continue;
      const got = nameAtNode(c, types, nameField, depth);
      if (got) return got;
      // 同一类型下可能有多个子节点（如双声明符）——继续试下一个
    }
  }
  return '';
}

/** 一步名字路径：字段优先（节点自带该字段），否则取该类型的第一个直接子节点 */
function nameStep(node: SyntaxNodeLike, step: string): SyntaxNodeLike | null {
  const byField = node.childForFieldName(step);
  if (byField) return byField;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === step && c.isNamed !== false) return c;
  }
  return null;
}

/** 子节点下标（tree-sitter 节点对象身份不稳定，按 (type,startIndex,endIndex) 对齐） */
function childIndexOf(node: SyntaxNodeLike, target: SyntaxNodeLike | null): number | null {
  if (!target) return null;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === target.type && c.startIndex === target.startIndex && c.endIndex === target.endIndex) return i;
  }
  return null;
}

/**
 * 取符号名 + **名字来自哪个直接子节点**（下标，供 `bodyIsSelf` 跳过它）。
 * 三级（全部数据驱动，内核不认识任何具体语言）：
 *   ① `field_map.name` 声明的字段（既有表项最常用的一条）；
 *   ② 适配器的 `namePaths`（定长路径，Elixir 的 `def`/`defmodule`）；
 *   ③ 适配器的 `nameNodeTypes` ?? 默认惯例名单（变长类型下钻，C/C++ 声明符链、Julia 的 signature）。
 */
function resolveName(node: SyntaxNodeLike, lang: LanguageEntry): { name: string; fromIndex: number | null } {
  const a = LANG_ADAPTERS[lang.name];
  const byField = node.childForFieldName(lang.field_map.name);
  if (byField && isValidIdentifier(byField.text)) {
    return { name: byField.text, fromIndex: childIndexOf(node, byField) };
  }
  for (const path of a?.namePaths ?? []) {
    let cur: SyntaxNodeLike | null = node;
    let firstIndex: number | null = null;
    for (let i = 0; i < path.length && cur; i++) {
      const next = nameStep(cur, path[i]);
      if (!next) {
        cur = null;
        break;
      }
      if (i === 0) firstIndex = childIndexOf(node, next);
      cur = next;
    }
    if (cur && isValidIdentifier(cur.text)) return { name: cur.text, fromIndex: firstIndex };
  }
  const declared = a?.nameNodeTypes;
  if (declared) {
    for (const t of declared) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.type !== t) continue;
        const got = nameAtNode(c, declared, lang.field_map.name, 0);
        if (got) return { name: got, fromIndex: i };
      }
    }
    return { name: '', fromIndex: null };
  }
  // 未声明 nameNodeTypes 的语言：沿用**既有惯例**（文档序、取第一个名字型子节点文本）。
  // ★ 为什么不一并改成"类型下钻"：表里另有 50+ 门语言没声明（也装不上包，无从实测），
  //   这一支保证它们的既有行为**逐字不变**（改动 = 只有实测过的语言才换语义）。
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && DEFAULT_NAME_NODE_TYPES.includes(c.type) && isValidIdentifier(c.text)) {
      return { name: c.text, fromIndex: i };
    }
  }
  return { name: '', fromIndex: null };
}

function stripParens(s: string): string {
  s = s.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

/**
 * 签名文本（`name(params) + 返回类型`）。
 * ★ 2026-09-29 扩契约：原先按 `lang.name === 'go' | 'python' | 'rust' | 'java'…` 的
 *   **四条按语言分支**，全部收敛成适配器数据（`returnSep` / `signatureHasReceiver` /
 *   `stripSelfParam`）。缺省即 TS/JS/Java/C#/Kotlin/Swift 形态（': ' 连接返回类型）。
 */
function buildSignature(node: SyntaxNodeLike, fieldMap: LanguageEntry['field_map'], lang: LanguageEntry): string {
  const name = resolveName(node, lang).name;
  const rawParams = fieldText(node, fieldMap.parameters || '');
  let params = stripParens(rawParams);
  // 一些 tree-sitter 语法（如 typescript 的 type_annotation）返回类型文本含前导 ':'，
  // 而这里各语言分支都会自己拼 ': ' / ' -> '。统一剥掉前导冒号，避免 '): : number' 双冒号。
  const retType = (fieldName: string): string =>
    fieldText(node, fieldName).replace(/^\s*:\s*/, '');

  const a = LANG_ADAPTERS[lang.name];
  const ret = retType(fieldMap.return_type || '');
  const sep = a?.returnSep ?? ': ';

  if (a?.stripSelfParam) {
    params = params.replace(/^self\s*,?\s*/, '').trim();
  }

  let prefix = '';
  if (a?.signatureHasReceiver) {
    // receiver text 如 "(u *UserService)" 或 "u *UserService"
    const receiverClean = stripParens(fieldText(node, fieldMap.receiver || ''));
    const receiverMatch = receiverClean.match(/(?:\*\s*)?(\w+)$/);
    if (receiverMatch) prefix = `${receiverMatch[1]}.`;
  }

  return `${prefix}${name}(${params})${ret ? sep + ret : ''}`;
}

// ─────────────────────────────────────────────────────────────
// 通用遍历提取符号
// ─────────────────────────────────────────────────────────────

function traverseAndExtract(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  symbols: ParsedSymbol[],
  parent: string | undefined,
  depth: number = 0,
  enclosingIsFunction: boolean = false,
): void {
  if (depth > 100) return; // 防止无限递归

  // 顶层 const/let/var（TS/JS）：具名值绑定也算符号——handler 形态
  // （const xxxHandler = wrap(...)）是 server_registry 等文件的主体结构。
  // 只索引顶层（parent===undefined）：局部 const 同名多、噪音大且定位价值低；
  // 解构（object_pattern）与多声明器跳过（符号名无法稳定表达）。不进 body 递归
  // ——初始化器内的局部 function 不提升为顶层符号（闭包私有，本就不该独立可见）。
  // ★★★ 2026-10-27（T-#45）：**函数体内也索引“值是函数”的单声明器**（标 `is_closure`）。
  //
  // ## 为什么改（实测病史）
  // 原设计（见上面注释）：“只索引顶层：局部 const 同名多、噪音大且定位价值低”。
  // 但那个取舍算错了：**定义确实噪音大，可引用它们的调用需要目标才能建边** ——
  // 实测 `const walk = (dir) => {…}` 定义在函数体内时**不被收集** ⇒ 调用它的引用全 `failed`
  // （`walk` 147 条 · `need` 21 · `make` 19 · `declare` 19 …）⇒ **call 边只覆盖 24%**（5964/24625）。
  //
  // ## 新判据（只放“值是函数”的那一类，不让 `const x = 1` 爆炸）
  //   · 函数体内 ∧ 单声明器 ∧ 具名 identifier ∧ **值是函数**（箭头/函数表达式/生成器）
  //   ⇒ 索引，且 **`is_closure: true`**（不进契约面 —— 那正是这个字段的用途）
  //   ⇒ `qualified_name = <parent>.<name>` ⇒ **同名不冲突**（`main.walk` vs `other.walk`）
  //   ★ `parent` 也填上（供社区/聚合按所属函数归组）
  //   ★ 顶层行为**一字不变**（`parent === undefined` 分支照旧）。
  const isDeclNode = node.type === 'lexical_declaration' || node.type === 'variable_declaration';
  const nestedFnDecl =
    isDeclNode && parent !== undefined && enclosingIsFunction
      ? (() => {
          const ds: SyntaxNodeLike[] = [];
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c && c.type === 'variable_declarator') ds.push(c);
          }
          if (ds.length !== 1) return false;
          const nn = ds[0].childForFieldName('name');
          if (!nn || nn.type !== 'identifier' || !isValidIdentifier(nn.text)) return false;
          const vn = ds[0].childForFieldName('value');
          return !!vn && ['arrow_function', 'function_expression', 'function', 'generator_function'].includes(vn.type);
        })()
      : false;
  if (isDeclNode && (parent === undefined || nestedFnDecl)) {
    const declarators: SyntaxNodeLike[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === 'variable_declarator') declarators.push(c);
    }
    if (declarators.length === 1) {
      const nameNode = declarators[0].childForFieldName('name');
      if (nameNode && nameNode.type === 'identifier' && isValidIdentifier(nameNode.text)) {
        const valueNode = declarators[0].childForFieldName('value');
        // 值摘要（≤60 字符，单行化）：wrap(async (a) => {...}) → “wrap(async (a) => {…”
        const rawValue = (valueNode?.text ?? '').replace(/\s+/g, ' ');
        const valueBrief = rawValue.length > 60 ? rawValue.slice(0, 57) + '…' : rawValue;
        // 局部闭包检测：Go 顶层 `var x = func(){}` / Python 顶层 `x = lambda` 是内部辅助，
        // 不是设计契约（TS/JS 顶层 handler const 不标——它们是主体结构，须保留在契约面）。
        // ★ 2026-09-29 扩契约：原先这里按 `lang.name === 'go'|'python'` 判断，现走数据
        //   （适配器 closureLiteralNodeTypes）。
        const vt = valueNode?.type;
        const isClosureLit = !!vt && (LANG_ADAPTERS[lang.name]?.closureLiteralNodeTypes ?? []).includes(vt);
        // ★ 2026-10-21（v14）：顶层 const 绑定的**函数值**（`const h = async (): Promise<X> => …`）
        //   也抽返回类型/泛型/修饰符 —— 这类 handler 是本仓的主体结构（server_registry 等）。
        //   ★ 导出关键字在**声明节点**的父级（export_statement），不在值节点上 ⇒ 单独补第一项。
        const valueShape = valueNode ? shapeOf(valueNode, lang.name) : {};
        // ★ v15：const 绑的是**函数值**（箭头 / 函数表达式 / Go func_literal）⇒ 体也落库；
        //   绑定的是普通值（`const X = 1`、`const h = wrap(...)` 的调用结果）⇒ 取不到体 ⇒ NULL。
        //   ★ 这不是按语言分支：字段名/节点类型的差异全在 LANG_ADAPTERS 的规则表里。
        const valueBody = valueNode ? bodyTextOf(valueNode, lang) : undefined;
        // ★ 2026-10-21：const 绑定上的文档注释（实测 ts：JSDoc 挂在 `export_statement` 上，
        //   由 DOCSTRING_SPECS 的 `climbParents` 上穿后再找前驱兄弟）。
        const valueDoc = docstringOf(node, lang.name);
        const constMods =
          node.parent?.type === 'export_statement'
            ? ['export', ...(valueShape.modifiers ?? [])]
            : valueShape.modifiers;
        symbols.push({
          name: nameNode.text,
          kind: 'const',
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          qualified_name: parent ? `${parent}.${nameNode.text}` : nameNode.text, // ★ T-#45：嵌套时带父名，同名不冲突
          ...valueShape,
          ...(constMods ? { modifiers: [...new Set(constMods)] } : {}),
          ...(valueBody ? { bodyText: valueBody } : {}),
          ...(valueDoc ? { docstring: valueDoc } : {}),
          signature: `const ${nameNode.text} = ${valueBrief}`,
          parent,
          is_closure: isClosureLit || nestedFnDecl ? true : undefined, // ★ T-#45：嵌套函数体里的标闭包
        });
        // ★★★ 2026-10-27（T-#52）：**值是函数 ⇒ 继续往下走**（进它的 body，作用域标「函数内」）。
        //
        // ## 原先这里一路 `return` 的代价（实测）
        // 这个分支末尾是 `return;` ⇒ **初始化器整棵子树被跳过** ⇒
        // **嵌在 `const X = () => {}` 里的箭头函数永远看不见**。
        // 证据（同一文件里两种形态的对比）：
        //   `live_render.ts`：`DirNode@194(closure)` `ensureDir@203` `layoutDir@229` **都在**
        //                     —— 它们嵌在 `function` 里；而 `ownerOf@249`（嵌在 const 箭头里）**不在**
        //   `module_analysis.ts`：`handleImport@189(closure)` 在，`pushEdge@194`（在它里面）**不在**
        // ⇒ 这就是"同一把尺量出两种结果"的根源。
        //
        // ## 修法
        // 只对**值是函数**的声明往下走（`const x = 1` / `const h = wrap(...)` 不碰，避免噪音），
        // 且把子级作用域标成「函数内」⇒ 里面的具名箭头会被 T-#45 的判据收进来并标 `is_closure`。
        if (
          valueNode &&
          ['arrow_function', 'function_expression', 'function', 'generator_function'].includes(valueNode.type)
        ) {
          const childParent = parent === undefined ? nameNode.text : `${parent}.${nameNode.text}`;
          for (let ci = 0; ci < valueNode.childCount; ci++) {
            const cc = valueNode.child(ci);
            if (cc) traverseAndExtract(cc, lang, symbols, childParent, depth + 1, true);
          }
        }
      }
    }
    return;
  }

  if (isSymbolNode(node, lang)) {
    const { name, fromIndex } = resolveName(node, lang);
    if (name) {
      const kind = symbolKind(node, lang, parent);
      const signature = buildSignature(node, lang.field_map, lang);
      // Go 方法：receiver 类型即“所属类型”。只填 parent（供社区按类型聚合），
      // 不改 qualified_name（保留 "Method" 短名，避免破坏既有调用边解析契约）。
      // ★ 2026-09-29：`lang.name === 'go'` → 数据字段 parentFromReceiver。
      let symbolParent = parent;
      if (LANG_ADAPTERS[lang.name]?.parentFromReceiver && !symbolParent) {
        const receiver = fieldText(node, lang.field_map.receiver || '');
        const receiverMatch = stripParens(receiver).match(/(?:\*\s*)?(\w+)$/);
        if (receiverMatch) symbolParent = receiverMatch[1];
      }
      const qn = parent ? `${parent}.${name}` : name;
      // ★ v15：函数/方法从 **AST 的体节点**取原文（规则表 = LANG_ADAPTERS 的 bodyFields / bodyNodeTypes）。
      //   取不到（type/class 走不到这里；解析器没给体）⇒ undefined ⇒ 落库 NULL（不是空串）。
      const bodyOfSymbol = kind === 'function' || kind === 'method' ? bodyTextOf(node, lang) : undefined;
      // ★ 2026-10-21：文档注释（`symbol_docstring.ts` 唯一出处）——对 function / method / class /
      //   interface / type 一视同仁；取不到 ⇒ undefined ⇒ 落库 NULL（不是空串）。
      const docOfSymbol = docstringOf(node, lang.name);
      // 局部闭包标记：当前 node 位于「函数作用域」内（上层是 function/method）→ 内部辅助函数，
      // 非设计契约。类型作用域（顶层/类内）不标——方法与顶层函数仍是契约。
      const isClosureSymbol = enclosingIsFunction;
      symbols.push({
        name,
        kind,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        qualified_name: qn,
        // ★ 2026-10-20：类型声明把成员抽出来（`typeMembersOf` 早就有，只是没接上）
        ...(TYPE_DECL_NODES.has(node.type) ? { members: typeMembersOf(node) } : {}),
        // ★ 2026-10-20（v13）：函数/方法把**形参表**抽出来（`symbol_params.ts` 早就有，只是没接上）
        ...(kind === 'function' || kind === 'method'
          ? {
              params: paramsOf(node, lang.field_map.parameters || 'parameters', lang.name),
              // ★ v15：体原文（见 bodyTextOf 的注释：原文照录，含/不含外层花括号由语法树决定）
              ...(bodyOfSymbol ? { bodyText: bodyOfSymbol } : {}),
            }
          : {}),
        // ★ 2026-10-21（v14）：**返回类型 / 泛型参数 / 修饰符**（`symbol_shape.ts` 唯一出处）。
        //   三样都是「抽不到就省略」⇒ 落库 NULL；抽得到但为空 ⇒ `[]`（见 schema 注释）。
        ...shapeOf(node, lang.name),
        // ★ 2026-10-21：文档注释原文（规则表 / 紧邻判据见 symbol_docstring.ts）
        ...(docOfSymbol ? { docstring: docOfSymbol } : {}),
        signature,
        parent: symbolParent,
        is_closure: isClosureSymbol ? true : undefined,
      });

      // body 子级的作用域类型：
      //   - function/method 的 body → 进入函数作用域（内嵌辅助函数标闭包）
      //   - class/interface/type/struct 的 body → 类型作用域（方法仍是契约）
      const bodyIsFunction = kind === 'function' || kind === 'method';
      const bodyIsType = kind === 'class' || kind === 'interface' || kind === 'type';
      const childScope: boolean = bodyIsFunction ? true : bodyIsType ? false : enclosingIsFunction;
      const recBody = (child: SyntaxNodeLike | null) => {
        if (child) traverseAndExtract(child, lang, symbols, qn, depth + 1, childScope);
      };
      // 进入 body 继续提取（找方法/嵌套类）
      const body = bodyChildren(node, lang, fromIndex);
      if (body) {
        for (const c of body) recBody(c);
        return;
      }
      // 兜底：直接遍历子节点（如 Python class 的 body 可能不是标准 body 字段）
      // ★ 这是**跨语言**的节点名兜底（不是按语言分支）；新语言优先用数据声明
      //   （bodyFields / bodyNodeTypes / bodyIsSelf），别往这里加名字。
      if (node.type === 'class_definition' || node.type === 'class_declaration') {
        for (let i = 0; i < node.childCount; i++) recBody(node.child(i));
        return;
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverseAndExtract(child, lang, symbols, parent, depth + 1, enclosingIsFunction);
  }
}

// ─────────────────────────────────────────────────────────────
// 调用边提取（函数级，AST 级，路线图序号 3）
// ─────────────────────────────────────────────────────────────

/**
 * 语言适配器注册表：**一门语言的"深适配契约" = 一条数据记录**。
 *
 * ★ 2026-09-29 扩契约（用户方针「不许再加一门语言加一个 if」）：
 *   原先散在 kernel 里的按语言判断
 *     · `extractName` 的 `CPP_DECLARATOR_WRAPPERS` Set + 硬编码节点名兜底串
 *     · `findBodyNode` 的 `'body' | 'suite'` 两个字面量
 *     · `extractCallee` 的 `'function' | 'name' | 'method'` 三个字段名 + `langName === 'java'`
 *     · `buildSignature` 的四条语言分支、receiver/闭包字面量/TS 系 import 源/type-only
 *   全部收敛成**下表字段**。kernel 只消费数据，不写按语言分支（判据见
 *   `tests/tools/kernel_no_lang_branch.test.ts`）。加语言 = 加一行数据。
 */
/**
 * ★★★ 2026-10-27（T-#62）：**导入解析的上下文**。
 * 把“解析 import source 需要知道什么”显式化，而不是让每个语言实现去猜。
 */
export interface ResolveImportCtx {
  projectRoot: string;
  /** 项目内已有的文件（仓库相对路径，posix 分隔） */
  files: ReadonlySet<string>;
  /** 该项目的 Go module 表（`module → 目录`）；非 Go 语言可忽略 */
  goModules: ReadonlyArray<{ module: string; dir: string }>;
}

interface LangImportAdapter {
  /**
   * ★★★ 2026-10-27（T-#62）：**把 import source 解析成项目内的候选文件**。
   *
   * ## 为什么必须进适配器（这是“有什么语言就自动解锁什么语言”的关键）
   * 病史：解析器是多语言的（本表），但**导入解析是硬编码的** ——
   *   `resolveImportTarget` 只走 TS 的相对路径 + IMPORT_EXTS；
   *   `findGoSamePackageTarget` 是 Go 特例且**只认同目录**。
   * ⇒ **加一门语言，它的跨文件/跨包解析不会自动具备**。
   *
   * ## 语义
   * · `undefined`（未声明）⇒ 调用方按**默认 TS 逻辑**处理（相对路径 + 扩展名）
   * · `null` ⇒ 本语言不管这条 source（调用方继续试别的路子）
   * · `[]` ⇒ **明确解析不到**（标准库 / 第三方 ⇒ 外部，不该算漏连）
   * · `string[]` ⇒ 项目内候选文件（调用方在这些文件里找符号）
   */
  resolveImport?: (source: string, fromRel: string, ctx: ResolveImportCtx) => string[] | null;

  /**
   * ★★★ 2026-10-27（T-#83）：**局部绑定声明的节点类型**（数据，不是代码分支）。
   *
   * ## 为什么需要
   * `localBindingsOfDecl` 原先按 `node.type` 硬编码 TS/Go 两种形态 ⇒ **加语言要改代码**。
   * 而且它有个**隐蔽 bug**：`var_declaration` 在 TS 分支和 Go 分支**都出现**，
   * TS 分支先 `return` ⇒ **Go 的 `var x T = …` 永远收不到**。
   * ⇒ 改成**按语言门控**：本字段声明“本语言哪些节点是局部绑定声明”，
   *   `localBindingsOfDecl(node, langName)` 先看本字段，命中才往下抽。
   *   ★ 门控后两个分支可以**安全地重叠**（`var_declaration` 两边都要）。
   *
   * ## 加语言时怎么填
   * 看该语言“在函数体内给名字赋值”的 AST 节点类型：
   *   TS/JS ⇒ `lexical_declaration`（const/let）· `variable_declaration`（var）
   *   Go    ⇒ `short_var_declaration`（`:=`）· `var_declaration`（`var`）
   *   Python⇒ `assignment`（★ 尚未实现抽取分支，见 `docs/GUIDE-LANGUAGE.md`）
   *   Rust  ⇒ `let_declaration`（★ 同上）
   * ★ **没填 = 本语言没有局部绑定概念**（调用方按“没有”处理，不会误判）。
   */
  localBindingNodes?: string[];

  /** 调用节点类型（数组 = 该语言有多种调用形态，如 PHP 三种 / Groovy 两种） */
  callNode?: string | string[];
  /**
   * 顶层调用也提取（**模块顶层代码是会执行的**语言：Python · TS 系）。
   * ★ T136（2026-10-15）：语义是"**模块顶层（无包裹函数）的调用归属 `<module>`**"，且**走子树**——
   *   `const VALUE = usedTwo();` 这类**表达式位置的顶层调用**同样要建边（原先只看直接子节点 ⇒ 漏）。
   *   ★ 不开此开关的语言（Java/C# 等：顶层没有可执行语句）行为不变。
   */
  topLevelCall?: boolean;
  /**
   * 被调名候选【字段名】，按序试、命中即取。
   * **替代**内核原先硬编码的 `'function' | 'name' | 'method'` 串
   * （C/C++/Rust/TS 系/Go/Haskell/Scala='function'、Java/Groovy/PHP='name'、
   * Ruby='method'、Elixir='target'）。
   */
  calleeFields?: string[];
  /**
   * 被调名的"对象/限定"字段（Java/Groovy 的 `method_invocation.object`）：
   * 有它就把 `对象.方法` 拼回 `callee_expr`。
   * **替代**内核原先的 `langName === 'java' ? … : null`（按语言 if，屎山本体）。
   */
  calleeObjectField?: string;
  /**
   * 调用表达式无字段的语法（实测 kotlin/julia：`call_expression` 的 `"fields": {}`，
   * 被调表达式就是**第一个命名子节点**）。
   * ★ 若被调表达式是**匿名/内联节点**（`isNamed=false`），这条会取不到 —— 用 `calleeChildIndex`。
   */
  calleeIsFirstChild?: boolean;
  /**
   * ★ 被调表达式在**第 N 个子节点**上（不管命名与否）。
   *
   * 由来（2026-10-08 实测，crystal）：`obj.bar` 的 `method_call` 第一个子节点是
   * `alias($.property, '')` 的**内联节点**（`isNamed=false`、`type=''`、`text='obj.bar'`）
   * ⇒ `calleeIsFirstChild`（走 `firstNamedChild`）会跳过它 ⇒ 取不到被调名。
   * 与 `calleeIsFirstChild` 的区别只在"算不算匿名节点"；两者都取到后走同一条
   * "尾部标识符"收尾（`obj.bar` → `bar`）。
   */
  calleeChildIndex?: number;
  /**
   * 体的候选【字段名】；未声明则用 DEFAULT_BODY_FIELDS（'body'/'suite' 两个通用命名）。
   * 实测：Haskell 体在 `match`（局部绑定在 `binds`）、Elixir 体在 `do_block`。
   */
  bodyFields?: string[];
  /**
   * 无体字段的语法 ⇒ 体的**节点类型**（实测 kotlin：`function_declaration`/`class_declaration`
   * 的 `"fields": {}`，体是 `function_body`/`class_body` 子节点）。
   */
  bodyNodeTypes?: string[];
  /**
   * ★ 体字段的值**本身就是一条语句**（不是一个语句块）—— 返回 `[体节点]` 而不是"体的子节点"。
   *
   * 由来（2026-10-08 实测，ocaml）：`let foo () = bar ()` 的 `let_binding`，其 `body` 字段
   * **就是那次调用**（`application_expression`），没有块的包裹。而默认取法（`bodyFields`）
   * 返回的是"体节点的**子节点**"⇒ 把 `application_expression` 本身丢掉了 ⇒ **调用边全丢**。
   * 与 `bodyIsSelf` 的区别：`bodyIsSelf` 是"符号节点自己就是体"（julia），
   * 本条是"**体字段指向的节点自己**就是一条语句"。
   */
  bodyIsExpression?: boolean;
  /**
   * 体就是**本节点自身**（实测 julia：定义节点的子节点按序即体语句，没有包裹节点）。
   * `resolveName` 命中的那个直接子节点（如 `signature`）会被跳过——否则签名里的
   * `call_expression` 会被误当成一次真实调用（实测：会多出 `-> greet` 自调用边）。
   */
  bodyIsSelf?: boolean;
  /**
   * 名字候选【节点类型】：字段取不到时按类型递归下钻（实测两条用途）
   *   · C/C++ 的声明符包装链 `function_declarator → pointer_declarator → identifier`
   *     （必须先于通用兜底，否则 `Node* next(){…}` 会把**返回类型** Node 当符号名）
   *   · Julia 的 `signature → call_expression → identifier`
   * 未声明则用 DEFAULT_NAME_NODE_TYPES（跨语言命名惯例兜底）。
   */
  nameNodeTypes?: string[];
  /**
   * 名字的**定长路径**（按序试、命中即止）：每步先按字段名找（节点自带该字段），
   * 否则按节点类型找第一个直接子节点；走完路径取该节点文本（须是合法标识符）。
   * 为什么需要它：少数语法把"声明"写成普通调用（Elixir 的 `def`/`defmodule`
   * **自身就是 `call`**），真名既不在本节点字段里、也不在同型子节点链上，
   * 而在 `arguments → 内层 call → target` 这条定长路径上。
   */
  namePaths?: string[][];
  /**
   * 节点类型 → 符号 kind 的**覆盖**（修正启发式 `nodeTypeToKind` 的误判）。
   * 为什么要紧：kind 错了不只是标签难看——`class`/`type` 作用域内的符号才留在
   * 设计契约面，被误判成 `function` 会把模块内的函数全标成 `is_closure`（实测：
   * Julia `module`、Scala `object`、Haskell `data_type`）。
   */
  nodeKindOverride?: Record<string, ParsedSymbol['kind']>;
  /**
   * 「宏即声明」语法（实测 Elixir）：符号节点就是普通 `call`，靠某字段的**文本值**
   * 分派 kind —— 命中即符号节点、未命中即不是（该表**兼作**符号节点判据）。
   * 例：`{ field: 'target', kinds: { def: 'function', defmodule: 'class', … } }`
   */
  symbolDispatch?: { field: string; kinds: Record<string, ParsedSymbol['kind']> };
  /**
   * 符号节点的**结构前提**：必须至少存在其中之一字段（实测 Haskell：
   * `function` 这个节点名**同时**表示「函数绑定」和「函数类型」——只有绑定带
   * `match`/`binds`；不设前提就会把类型签名里的 `Int -> Int` 当函数提取，实测多出
   * `Int` 符号）。
   * 与 symbolDispatch 的分工：本字段管「是不是符号节点」，symbolDispatch 管「按值分派 kind」。
   */
  symbolRequireFields?: string[];
  /**
   * import 语句里"模块源"所在字段名（TS 系 = `source`）。
   * **替代**内核原先的 `langName === 'typescript' || 'tsx' || 'javascript' || 'jsx'`。
   */
  importSourceField?: string;
  /**
   * 该语言的模块语句是否可能「运行时整体擦除」（TS 系 `import type` / `export type`）。
   * **替代**内核原先的 `TS_FAMILY_LANGS = new Set([...])`。
   */
  erasedModuleStatements?: boolean;
  /** 签名里返回类型的连接符（缺省 `': '`；实测 Python/Rust = `' -> '`、Go = `' '`） */
  returnSep?: string;
  /** 签名里带 receiver 前缀（实测 Go：`(u *User) Greet()` 签名为 `User.Greet()`） */
  signatureHasReceiver?: boolean;
  /** 签名参数里剥掉首参 `self`（实测 Python） */
  stripSelfParam?: boolean;
  /** 用 receiver 文本里的类型名当 `parent`（Go 方法归属类型）——替代 `lang.name === 'go'` */
  parentFromReceiver?: boolean;
  /** 顶层 const/var 绑定**裸闭包**的值节点类型（Go `func_literal` / Python `lambda`）
   *  ⇒ 该符号标 `is_closure`（内部辅助，不是设计契约面） */
  closureLiteralNodeTypes?: string[];
  /** 该语言专属的 import 源提取（形态复杂时用；简单字段走 importSourceField） */
  extractImportSources?: (node: SyntaxNodeLike) => string[];
  extractImportBindings?: (node: SyntaxNodeLike, paths: string[]) => string[];
  /**
   * ★ 2026-10-21：**带 `via` 的详细版** —— 判据来源必须说得清是「语法树子节点」还是「正则兜底」。
   *   · 只有**这一层**会把 `via` 写进 `ParsedImport.source_via` / `bindings_via`；
   *   · 没有这两个字段的语言（绝大多数）**不报 via** —— 而不是把「用正则读 `node.text`」的
   *     老适配器谎称 `'ast'`（那会把"有没有真读语法树"这个事实又抹平）。
   *   · `values` 为空也算取到了（via=ast）；只有**结构不认识**才退 regex。
   */
  extractImportSourcesEx?: (node: SyntaxNodeLike) => ImportExtract;
  extractImportBindingsEx?: (node: SyntaxNodeLike, paths: string[]) => ImportExtract;
}

/** import 源/绑定的判据来源：`ast` = 语法树子节点；`regex` = 子节点缺失后的正则兜底 */
export type ImportExtractVia = 'ast' | 'regex';

/** 一次 import 提取的产物：值 + **它是怎么取到的**（可缺省 = 该语言未做区分） */
interface ImportExtract {
  values: string[];
  via?: ImportExtractVia;
}

/** `#include "x.h"` / `#include <vector>` → 头文件路径（C 与 C++ 同型，共用一份正则，别抄第二份） */
function includePath(node: SyntaxNodeLike): string[] {
  const m = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(node.text);
  return m ? [m[1]] : [];
}

/** 点分模块路径的末段（`a.b.C` → `C`）——多门语言的"本地可用名"都是它，共用一份，别各写各的。 */
function lastDotSegment(p: string): string {
  const segs = p.split('.');
  return (segs[segs.length - 1] ?? '').trim();
}

/**
 * 按**括号深度 0** 处的分隔符切分（`import a.{B, C}, d.e` → `['a.{B, C}', 'd.e']`）。
 * 为什么要它：Scala/Julia 的 import 语法是 `sep1(',', …)`，花括号里的逗号**不是**条目分隔符
 * （`{Try, Success}` 是选择器列表）⇒ 裸 `split(',')` 会把一个 import 拆成两条假源。
 * 与 `lastDotSegment` 同属"跨语言共用的字符串工具"，不是按语言分支。
 */
function splitTopLevel(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 第 n 个**命名**子节点（无则 null）。用于"字段为空的语法"按结构取位（Julia 的模块/别名）。 */
function nthNamedChild(node: SyntaxNodeLike, n: number): SyntaxNodeLike | null {
  let seen = 0;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c || c.isNamed === false) continue;
    if (seen === n) return c;
    seen += 1;
  }
  return null;
}

/**
 * ★ 2026-10-21：按**节点类型**取第一个命名子节点。
 *
 * 为什么需要它：kotlin / php 的 import 语法**没有字段名**（grammar 里 "fields": {}），
 * 只能按子节点类型取（`identifier` / `import_alias` / `namespace_use_clause`）。
 * ★ 只认**命名**节点（`isNamed === false` 的关键字/标点不算）——与 `nthNamedChild` 同一把尺。
 */
function firstNamedChildOfType(node: SyntaxNodeLike, type: string): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.isNamed !== false && c.type === type) return c;
  }
  return null;
}

/** 同上，取**全部**该类型的命名子节点（php 的 `use A, B;` 是多 clause） */
function namedChildrenOfType(node: SyntaxNodeLike, type: string): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.isNamed !== false && c.type === type) out.push(c);
  }
  return out;
}

/**
 * ★★★ 2026-10-19（结构性修复）：TS 系（typescript / tsx / javascript / jsx）的
 * **import 绑定提取** —— 四个语言语法同源，共享同一份实现（不复制 4 份）。
 *
 * 提取的 AST 形状：
 * ```
 * import_declaration
 *   ├─ import_clause
 *   │    ├─ identifier                     ← default（`import x from`）
 *   │    ├─ namespace_import ─ identifier  ← `import * as ns from`
 *   │    └─ named_imports
 *   │         └─ import_specifier ─ name · alias?
 *   └─ string（source）
 * ```
 * 只取【本地可用名】：default / ns / specifier 的 alias（有则 alias，无则 name）。
 *
 * ## 为什么必须有它
 * `imports.bindings` 是"这个裸名来自哪个模块"的唯一事实来源。
 * 没有它时 `resolveCrossFileCalls` 拿 `readdirSync` 这样的裸名只能沿 **relative** imports 找，
 * 找不到就判 `failed` —— 实测有 2,728 条 `failed`，绝大多数是 `node:fs` / `node:path` 解构出来的名字。
 * 有了它，这些能判成 `external`（正确语义），`failed` 才会只剩"真·设计/实现不一致"。
 */
const TS_LIKE_IMPORT_BINDINGS = (node: SyntaxNodeLike): string[] => {
  const out: string[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    const t = n.type;
    if (t === 'import_specifier') {
      const alias = n.childForFieldName('alias');
      const name = n.childForFieldName('name');
      // ★★★ 2026-10-27（T-#85）：**别名导入要保留【远端名】**（`import { remote as local }`）。
      //
      // ## 病史（读数据定位的类级 bug）
      // 原先只记 `local`（`(alias ?? name).text`）⇒ **远端名丢了**。
      // 后果：`findCrossFileTarget` 拿**本地名**去目标文件找 ⇒ 目标里只有**远端名**
      //   ⇒ 永远找不到 ⇒ 永远 failed。实测 6/14 条剩余 failed 全是这个：
      //   `import { designDbDir as designDbDirOf }` · `import { … listDesignSheets as listStoredFeatures }`
      //   · `Insertion as SkeletonInsertion` · `editCode as ec`
      // ⇒ 真实项目里 `as` 极常见 ⇒ **类级盲区**，不是个案。
      //
      // ## 格式（**不改 schema**，只改 `bindings` 字符串的形态）
      //   有别名 ⇒ `"remote as local"`；无别名 ⇒ 原名
      //   读取端：`localOf()` 取本地名（`boundByName` / `pkgSrc` 用）
      //            `remoteOf()` 取远端名（**去目标文件里搜符号时用**）
      if (alias && name) {
        out.push(`${name.text} as ${alias.text}`);
      } else {
        const local = (alias ?? name)?.text;
        if (local) out.push(local);
      }
      return;
    }
    if (t === 'namespace_import') {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c?.type === 'identifier' && c.text) out.push(c.text);
      }
      return;
    }
    if (t === 'import_clause') {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c?.type === 'identifier' && c.text) out.push(c.text);
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return [...new Set(out)];
};

/**
 * ★★★ 2026-10-27：**加新语言时的验货清单**（本轮实测结论，不是推测）
 *
 * ## 为什么写在这里
 * 本表是「新增一门语言」的唯一落点（`scripts/new-observe-lang.mjs` 生成骨架，规则都填进这里）。
 * 本轮量出**四个跨语言通用的坑**，每一个都会让「引用解析率」看起来很差、而其实是判定错。
 * ⇒ 加语言前先读这一节，加完按 §5 逐条验。
 *
 * ## §1 三种「解析失败」必须分开，否则会误判成「能力不够」
 * `unresolved_refs.status` 四值语义：
 *   · `resolved` = 建了边（本仓内找到目标）
 *   · `external` = 外部包 / 语言内置 / 内置类型 ⇒ **正常，本来就不该建仓内边**
 *   · `failed`   = 本仓内找不到目标 ⇒ **这才是债**
 *   · `pending`  = 索引未完整，留待再判
 * ⇒ ★ **别把 `external` 混进「解析率」分母**：实测「解析率 13.6%」里 `external` 占 41%
 *   （12271/29658）⇒ **真实本仓解析率 >94%**。指标口径错会直接导致「以为要上 LSP」。
 *
 * ## §2 存量 `failed` 会**永久钉住**，必须显式重算
 * `reopenRefsTo()` 只在「该名字现在还在 `nodes` 里」时才把 `failed` 重开为 `pending`。
 * ⇒ **内置名（`JSON.stringify` / `Math.max`）永远不在 nodes ⇒ 永不重试 ⇒ 永久 failed。**
 * 实测：把 13341 条 `failed` 一次性改回 `pending` 再跑 `resolveCrossFileCalls`：
 *   **0.8s ⇒ 11199 条归位 `external`（84%）**，`failed` 13341 → 2143，**edges 一条没变**（正确）。
 * ⇒ **加了新语言 / 改了判定之后，必须跑一次「重试存量 failed」**，否则旧账永远看不到改善。
 *
 * ## §3 嵌套函数是**最大的真洞**（跨语言）
 * 实测：`const walk = (dir) => {…}` **定义在函数体内**（缩进>0）时**不被收集**，
 * 而调用它的引用全部 `failed`（`walk` 147 · `need` 21 · `make` 19 · `declare` 19 · `run` 17…）。
 * 同文件**顶层**同名 `const` **会被收集** ⇒ **不一致，是 bug 不是设计**。
 * 源码统计：`const X = (...) =>` 全仓 211 处，其中**嵌套 110 处**；
 * 而 `nodes.is_closure=1` 只有 **48**（且全是 `method`/`interface`，**没有一个 `const`**）。
 * ⇒ ★ **加语言时必验**：该语言「函数体内的具名函数/箭头」能不能进 `nodes` 且标 `is_closure: true`。
 * ⇒ ★ `is_closure` 的**用途**：标了它 = **不算设计契约面** ⇒ 索引它们**不污染契约**，
 *   却**能让调用边建起来**。这是「既全又干净」的唯一办法。
 *
 * ## §4 每门语言都要有**自己的内置表**，否则内置符号会落进 `failed`
 * 现状只有 TS 的 `BUILTIN_TYPES` / `BUILTIN_CALLEES`。实测 Go 的 `bool`/`int`/`int64`
 * 与 `@types/node` 的全局类型（`ServerResponse`/`IncomingMessage`/`RegExpExecArray`/`Dirent`）
 * 都落进了 `failed`。
 * ⇒ 加语言时同时补三样：**内置类型表** + **内置可调用表** + **该语言的「全局声明」来源**
 *   （TS = `lib.*.d.ts` + `@types/*`；Go = `builtin` 包；Python = `builtins`；Java = `java.lang`）。
 *
 * ## §5 加完一门语言的验收（逐条可跑）
 *   ① `nodes` 里该语言的文件有节点，且**函数有 signature / params / return_type**
 *      （实测基线：全仓 signature 93.9%；functions+methods 的 params **100%**、return_type 94%）
 *   ② 该语言的 `failed` 占比 —— **先把内置表（§4）补齐再看这个数**
 *   ③ 嵌套函数是否进了 `nodes`（§3）—— 抽样看该语言文件的 `is_closure` 计数
 *   ④ `edges.call` / `unresolved_refs.call` —— 实测全仓只有 **24%**（5964/24625），
 *      主因就是 §3 ⇒ **新语言若低于这个数，先怀疑嵌套函数，别急着上类型推断**
 *   ⑤ **跑一次「重试存量 failed」**（§2），确认旧账归位
 *
 * ## §7 加语言的**必填项**：`resolveImport`（2026-10-27 补）
 *
 * ### 现状（实测，别当成"已经支持"）
 * 本表有 **26 个语言**，但**只有 2 个**声明了 `resolveImport`（`go` · `java`），
 * 加上 TS 走默认路径（`resolveImportTarget` 的相对路径逻辑）⇒ **实际只有 3/26 能解析导入**。
 * ⇒ 其余 23 个（rust · c_sharp · c · cpp · ruby · kotlin · php · scala · groovy · julia ·
 *   haskell · elixir · bash · fish · ocaml · solidity · crystal · swift …）
 *   **跨文件引用一条都解析不到**。
 * ★ 本仓每种只有 0-4 个文件 ⇒ **完全不可测量**；换个项目就是**大面积漏**。
 *   ⇒ 这是"看条数看不见、看种类一眼就有"的典型。
 *
 * ### 加语言时必须同时回答
 * 1. **import 语句长什么样**（`import_nodes` 已覆盖）
 * 2. **怎么把 import 的 source 映射到项目内文件** ⇒ 填 `resolveImport`
 *    · `[]` = 明确外部（标准库/第三方）· `string[]` = 候选文件 · `null` = 本语言不管
 * 3. **`*_BUILTIN_*` 表是不是在掩盖"没有 resolveImport"**
 *    ★ 已应验三次：`BUILTIN_TYPES` 的 tail 名（掩盖 `type_ref` 丢 receiver）·
 *      `GO_BUILTIN_TYPES` 的 stdlib 名（同上）· `JAVA_BUILTIN_TYPES`（掩盖 Java 无 resolveImport）
 *    ⇒ **每张 `*_BUILTIN_*` 表都要问这一句**。
 *
 * ### 已实现的三种约定（可照抄）
 * · **Go**：本仓 module 前缀 → 目录 → 该目录所有 `.go`（`readGoModules` 提供 module→dir）
 * · **Java**：`a.b.C` → 路径以 `a/b/C.java` 结尾（目录=包，语言强制）
 * · **Python**：`a.b` → `a/b.py` / `a/b/__init__.py`；`.` 前缀按点数上溯
 *
 * ## §6 一句话
 * > **「解析率低」先怀疑判定（§1/§4），再怀疑收集（§3），最后才怀疑「需要类型推断」。**
 * > 实测本仓 **82%** 的 `failed` 是内置/外部符号被错标 —— **一张内置表的事，不是 LSP 的事。**
 */
export const LANG_ADAPTERS: Record<string, LangImportAdapter> = {
  go: {
    callNode: 'call_expression',
    // ★ T-#83：Go 的局部绑定声明（`x := …` / `var x = …`）—— 数据，不是代码分支。
    localBindingNodes: ['short_var_declaration', 'var_declaration', 'range_clause'],
    // ★★★ 2026-10-27（T-#62）：**Go 的导入解析** —— 本仓 module 下的包路径 → 目录 → 该目录下的 .go 文件。
    //
    // ## 病史
    // 原先只有 `findGoSamePackageTarget`（**只认同目录**）⇒ 跨包引用（`instrument.ContractProbe`、
    // `probe.Tiered`）永远解析不到 ⇒ 落 failed。而数据其实全都有：
    //   · `readGoModules()` 已产出 `module → dir`
    //   · `imports.source` 已记完整包路径（`github.com/x/agent-io/observe-lang-go/internal/instrument`）
    // ⇒ **只是没接线**。
    //
    // ## 判据
    // · source 是本仓 module 的前缀（或相等）⇒ 取剩余路径拼到 module 目录下，返回该目录所有 `.go`
    // · 否则（标准库 `fmt` / 第三方）⇒ 返回 `[]`（**明确外部**，不该算漏连）
    resolveImport: (source: string, _fromRel: string, ctx) => {
      for (const m of ctx.goModules) {
        if (source !== m.module && !source.startsWith(`${m.module}/`)) continue;
        const rest = source.slice(m.module.length).replace(/^\//, '');
        const dir = [m.dir, rest].filter(Boolean).join('/');
        const out: string[] = [];
        for (const f of ctx.files) {
          if (!f.endsWith('.go')) continue;
          if (dir === '' ? !f.includes('/') : f.startsWith(`${dir}/`)) out.push(f);
        }
        return out;
      }
      return [];
    },
    // ★ 数据（原先散在 kernel 里的按语言 if）：
    //   calleeFields —— `fmt.Println(x)` → (call_expression function: (selector_expression) …)
    //   returnSep=' ' / signatureHasReceiver / parentFromReceiver —— Go 特有的
    //     `func (u *UserService) Greet()` 形态（签名带 receiver 前缀、parent 取 receiver 类型）
    //   closureLiteralNodeTypes —— 顶层 `var x = func(){}` 是本文件的内部辅助，非设计契约
    calleeFields: ['function'],
    returnSep: ' ',
    signatureHasReceiver: true,
    parentFromReceiver: true,
    closureLiteralNodeTypes: ['func_literal'],
    extractImportSources(node) {
      const p = fieldText(node, 'path');
      return p ? [stripQuotes(p)] : [];
    },
    extractImportBindingsEx(node, paths) {
      // ★ AST：import_spec 的 `name` 字段就是别名（`alias "p"` / `_ "p"` / `. "p"`），
      //   `path` 字段是模块路径（带引号 ⇒ stripQuotes）。
      const alias = node.childForFieldName('name')?.text.trim() ?? '';
      // ★ 取值域与旧正则**逐字等价**：标识符形态才算别名（`.` 点导入不算 ⇒ 回落末段名）。
      if (/^[A-Za-z_][\w.]*$/.test(alias)) return { values: [alias], via: 'ast' };
      const base = stripQuotes(fieldText(node, 'path')).split('/').pop();
      if (base) return { values: [base], via: 'ast' };
      // 兜底：AST 字段缺失（语法被破坏）⇒ 旧正则
      const m = node.text.match(/^\s*([A-Za-z_][\w.]*)\s*(?:"[^"]*"|`[^`]*`)/);
      if (m) return { values: [m[1]], via: 'regex' };
      const fallback = paths[0]?.split('/').pop();
      return { values: fallback ? [fallback] : [], via: 'regex' };
    },
  },
  python: {
    // ★★★ 2026-10-27（T-#81）：**Python 的导入解析**（原先**没有** ⇒ 类级盲区）。
    //
    // ## 判据（Python 的模块 = 文件/包 约定）
    // `import a.b` / `from a.b import C` ⇒ 候选 `a/b.py` 与 `a/b/__init__.py`
    // 相对导入 `from . import x` / `from ..a import x` ⇒ 按**点数上溯**当前文件所在目录
    // ★ 不认识的（标准库 / 第三方）⇒ `[]`（明确外部）；调用方还会试 `pkgSrc`，不会误判。
    resolveImport: (source: string, fromRel: string, ctx) => {
      const s = source.trim();
      if (!s) return [];
      const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
      const out: string[] = [];
      const addModule = (base: string): void => {
        const p = base.replace(/\./g, '/');
        if (!p) return;
        for (const f of ctx.files) {
          if (f === `${p}.py` || f === `${p}/__init__.py`) out.push(f);
        }
      };
      if (s.startsWith('.')) {
        // 相对导入：`from .a import x`（1 个点 = 当前包）· `from ..a import x`（2 个点 = 上一级）
        const dots = /^\.+/.exec(s)![0].length;
        const rest = s.slice(dots).replace(/^\./, '');
        const parts = dir.split('/').filter(Boolean);
        const up = parts.slice(0, Math.max(0, parts.length - (dots - 1)));
        addModule([...up, rest.replace(/\./g, '/')].filter(Boolean).join('/'));
      } else {
        addModule(s);
        // ★ 也试"相对于当前文件目录"（`sys.path` 把脚本目录加进去的常见情形）
        addModule([dir, s.replace(/\./g, '/')].filter(Boolean).join('/'));
      }
      return out;
    },
    callNode: 'call',
    topLevelCall: true,
    // ★ 数据：`f(x)` → (call function: (identifier))；签名 `def f(self)` 剥 self、返回 ' -> '
    calleeFields: ['function'],
    returnSep: ' -> ',
    stripSelfParam: true,
    closureLiteralNodeTypes: ['lambda'],
    extractImportSourcesEx(node) {
      if (node.type === 'import_statement') {
        // `import a.b` / `import a.b as c`：本来就是按 dotted_name 节点取的
        const out: string[] = [];
        const collect = (n: SyntaxNodeLike): void => {
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i);
            if (!c) continue;
            if (c.type === 'dotted_name') out.push(c.text);
            else if (c.type === 'aliased_import') collect(c);
          }
        };
        collect(node);
        return { values: out, via: 'ast' };
      }
      if (node.type === 'import_from_statement') {
        // ★ AST：`from X import …` 的模块名就在 `module_name` 字段；相对导入是 relative_import，
        //   文本已自带前导点（`..pkg` / `.`）—— 不必再对着整句用 `^\s*from\s+(\.*)…` 拆。
        const modNode = node.childForFieldName('module_name');
        if (modNode) {
          const srcText = modNode.text.trim();
          return { values: srcText ? [srcText] : [], via: 'ast' };
        }
        // 兜底：字段缺失（语法被破坏）⇒ 旧正则
        const m = node.text.match(/^\s*from\s+(\.*)([\w.]*)\s+import/);
        if (!m) return { values: [], via: 'regex' };
        const srcText = (m[1] || '') + (m[2] || '');
        return { values: srcText ? [srcText] : [], via: 'regex' };
      }
      return { values: [], via: 'ast' };
    },
    extractImportBindings(node) {
      if (node.type === 'import_from_statement') {
        const m = node.text.match(/^from\s+[\w.]*\s+import\s+(.+)$/);
        if (!m) return [];
        return m[1].split(',').map((s) => s.trim()).map((s) => (s.match(/as\s+([A-Za-z_]\w*)/i) || [])[1] || s.replace(/[()]/g, '')).filter((s) => s && !s.startsWith('('));
      }
      if (node.type === 'import_statement') {
        const out: string[] = [];
        const walk = (n: SyntaxNodeLike): void => {
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i);
            if (!c) continue;
            if (c.type === 'dotted_name') out.push(c.text.split('.').pop() || c.text);
            else if (c.type === 'aliased_import') {
              const as = c.text.match(/as\s+([A-Za-z_]\w*)/i);
              out.push(as ? as[1] : (c.text.split('.').pop() || c.text));
            } else walk(c);
          }
        };
        walk(node);
        return out;
      }
      return [];
    },
  },
  java: {
    callNode: 'method_invocation',
    // ★★★ 2026-10-27（T-#80）：**Java 的导入解析**（原先**完全没有** ⇒ 类级盲区）。
    //
    // ## 病史
    // `LANG_ADAPTERS` 里**只有 Go 有 `resolveImport`** ⇒ Java 的跨文件/跨包引用
    // **一条都解析不到**。本仓只有 1 个 Java 文件所以看不出问题
    // （82 条引用全是 `external`，靠 `JAVA_BUILTIN_TYPES` 表把标准库名字盖住）
    // ⇒ **换个 Java 项目就全漏**。
    //
    // ## 判据（Java 的「目录 = 包」约定）
    // `import a.b.C;` ⇒ 找路径**以 `a/b/C.java` 结尾**的文件；
    // `import a.b.*;` ⇒ 找 `a/b/` 目录下的所有 `.java`。
    // ★ `java.*` / `javax.*` / `jdk.*` / `sun.*` ⇒ **标准库 ⇒ `[]`（明确外部）**。
    // ★ 不需要额外配置：Java 的包名与目录结构的对应关系是**语言强制**的。
    resolveImport: (source: string, _fromRel: string, ctx) => {
      const s = source.trim();
      if (!s) return [];
      if (/^(java|javax|jdk|sun|com\.sun)\./.test(s)) return []; // 标准库 ⇒ 明确外部
      const files = [...ctx.files].filter((f) => f.endsWith('.java'));
      if (s.endsWith('.*')) {
        const pkgDir = s.slice(0, -2).replace(/\./g, '/');
        return files.filter((f) => f.includes(`/${pkgDir}/`));
      }
      const asPath = `${s.replace(/\./g, '/')}.java`;
      return files.filter((f) => f.endsWith(asPath));
    },
    // ★ 数据：Java 把对象与方法名分在两个字段（object='Bar'、name='run'）——
    //   原先这里是 kernel 里的一条**按语言分支**（只对 Java 取 object 字段拼 callee_expr），
    //   现为表项数据 calleeObjectField，内核不认识"java"。Groovy 用同一个字段。
    calleeFields: ['name'],
    calleeObjectField: 'object',
    extractImportSources(node) {
      const m = node.text.replace(/^\s*import\s+static\s+/, 'import ').match(/^\s*import\s+([\w.]+)(?:\.\*)?\s*;/);
      return m ? [m[1]] : [];
    },
    extractImportBindings(node) {
      const m = node.text.replace(/^\s*import\s+static\s+/, 'import ').match(/^\s*import\s+([\w.]+)(?:\.\*)?\s*;/);
      if (!m) return [];
      const segs = m[1].split('.');
      return segs.length > 0 ? [segs[segs.length - 1]] : [];
    },
  },
  rust: {
    callNode: 'call_expression',
    // ★ 数据：`f(x)` → (call_expression function: …)；签名 `fn f() -> T`
    calleeFields: ['function'],
    returnSep: ' -> ',
    extractImportSources(node) {
      const t = node.text.replace(/^\s*use\s+/, '').replace(/;?\s*$/, '').trim();
      const brace = t.indexOf('{');
      const head = (brace >= 0 ? t.slice(0, brace) : t).trim().replace(/::$/, '');
      const src = head.replace(/^crate::/, '').replace(/^::/, '').replace(/^super::/, '');
      return src ? [src] : [];
    },
    extractImportBindings(node) {
      const t = node.text.replace(/^\s*use\s+/, '').replace(/;?\s*$/, '').trim();
      const brace = t.indexOf('{');
      if (brace >= 0) {
        const inner = t.slice(brace + 1, t.lastIndexOf('}'));
        return inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.match(/as\s+([A-Za-z_]\w*)/) || [])[1] || s.split('::').pop() || s);
      }
      const asM = t.match(/as\s+([A-Za-z_]\w*)/);
      if (asM) return [asM[1]];
      const last = t.split('::').pop();
      return last && !last.includes('{') ? [last.trim()] : [];
    },
  },
  c_sharp: {
    callNode: 'invocation_expression',
    // ★ 数据：`F(x)` → (invocation_expression function: …)
    calleeFields: ['function'],
    // `using System;` / `using static System.Math;` / `using Alias = System.Console;`
    // source = 命名空间全名（别名形式取 RHS，静态 using 去 static）
    extractImportSources(node) {
      let t = node.text.replace(/^\s*using\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^static\s+/, '');
      const eq = t.indexOf('=');
      if (eq >= 0) t = t.slice(eq + 1).trim(); // using Alias = X; → X
      return t ? [t] : [];
    },
    // binding = 命名空间末段（当前命名空间内可直接引用该段而非全限定名）
    extractImportBindings(node) {
      let t = node.text.replace(/^\s*using\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^static\s+/, '');
      const eq = t.indexOf('=');
      if (eq >= 0) t = t.slice(eq + 1).trim(); // using Alias = X; → 绑定 Alias
      else t = t.split('.').pop() || t; // using System.X → X
      return t ? [t.replace(/[\s]/g, '')] : [];
    },
  },
  c: {
    callNode: 'call_expression',
    // ★ 数据：C 的函数名也在声明符链里（`static char* format(...)` = pointer_declarator →
    //   function_declarator → identifier）——原先靠 kernel 里硬编码的 CPP_DECLARATOR_WRAPPERS SET，
    //   现与 C++ 各自表项自带同一份名单（同一意图两处声明：这里是数据，不是代码分支）。
    nameNodeTypes: ['function_declarator', 'pointer_declarator', 'reference_declarator', 'parenthesized_declarator', 'array_declarator', 'identifier', 'field_identifier', 'qualified_identifier'],
    calleeFields: ['function'],
    // `#include "math.h"` / `#include <stdio.h>` → 头文件路径（与 C++ 共用 includePath）
    extractImportSources: includePath,
  },
  cpp: {
    callNode: 'call_expression',
    // ★ 值来自 tree-sitter-cpp 的 node-types.json（named）+ 真实语法树实测：
    //   `helper(n)` → (call_expression function: (identifier) arguments: …)
    //   `g.greet(3)` → (call_expression function: (field_expression …) arguments: …)
    //   import：`#include "util.h"` → (preproc_include path: (string_literal …))（与 C 同型）
    //   ★ 名字在声明符链里（详见 nameNodeTypes 的接口注释：顺序即优先级，
    //     声明符包装必须排在叶子标识符前，否则 `Node* next(){…}` 会取到返回类型 Node）
    nameNodeTypes: ['function_declarator', 'pointer_declarator', 'reference_declarator', 'parenthesized_declarator', 'array_declarator', 'identifier', 'field_identifier', 'qualified_identifier'],
    calleeFields: ['function'],
    extractImportSources: includePath,
  },
  ruby: {
    // ★ 值来自 tree-sitter-ruby 的 node-types.json（named 里有 `call`，**没有** `method_call`）
    //   + 真实语法树：`helper(n)` → (call method: (identifier) arguments: …)
    //   被调名在 **`method` 字段**（不是 function/name），故 extractCallee 认这个字段。
    callNode: 'call',
    calleeFields: ['method'],
    // ★ 本语言**不接 import 边、不声明 import_nodes**（实测结论，非遗漏）：
    //   tree-sitter-ruby 没有"import 声明"节点 —— `require 'x'` / `require_relative 'x'`
    //   就是普通 `call`（method=identifier 'require'），与每一次方法调用**同型**。
    //   把 `call` 声明成 import_nodes 会让"每一次调用"都变成依赖边候选（类别错误）。
  },
  kotlin: {
    // ★ 值来自 tree-sitter-kotlin 的 node-types.json（named）+ 真实语法树实测：
    //   `fun main() { helper() }` → (function_declaration (simple_identifier) (function_value_parameters) (function_body …))
    //   `helper()` → (call_expression (simple_identifier) (call_suffix (value_arguments …)))
    //   ★ 该 grammar 的声明/调用节点 **"fields": {}**（无 name/body/function 字段）⇒
    //     名字靠 simple_identifier 子节点（nameNodeTypes）、体靠 function_body/class_body、被调靠第一个子节点。
    callNode: 'call_expression',
    // 名字靠子节点类型：`fun twice()` 是 simple_identifier；`class Greeter`/`object Util`
    // 的名字是 **type_identifier**（实测 kotlin 0.3.8 的 class_declaration/object_declaration）
    nameNodeTypes: ['simple_identifier', 'type_identifier'],
    bodyNodeTypes: ['function_body', 'class_body'],
    calleeIsFirstChild: true,
    // `import a.b.C` / `import a.b.*` / `import a.b.C as D` → 模块路径
    // ★ AST（实测 kotlin 0.3.8）：import_header 的第一个 `identifier` 子节点就是点分模块名；
    //   通配 `.*` 是独立节点 `wildcard_import`、别名是 `import_alias` —— 都不在那段文本里 ⇒ 无需再剥。
    extractImportSourcesEx(node) {
      const modNode = firstNamedChildOfType(node, 'identifier');
      if (modNode) {
        const t = modNode.text.trim();
        return { values: t ? [t] : [], via: 'ast' };
      }
      // 兜底：AST 认不出（语法被破坏）⇒ 旧正则
      let t = node.text.replace(/^\s*import\s+/, '').replace(/[\s;]+$/, '').trim();
      t = t.replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
      t = t.replace(/\.\*$/, '');
      return { values: t ? [t] : [], via: 'regex' };
    },
    // `import a.b.C as D` → D；否则末段 C
    extractImportBindingsEx(node) {
      const aliasNode = firstNamedChildOfType(node, 'import_alias');
      const aliasId = aliasNode ? firstNamedChildOfType(aliasNode, 'type_identifier') : null;
      if (aliasId) return { values: [aliasId.text], via: 'ast' };
      const modNode = firstNamedChildOfType(node, 'identifier');
      if (modNode) {
        const last = lastDotSegment(modNode.text);
        return { values: last ? [last] : [], via: 'ast' };
      }
      const asM = node.text.match(/\s+as\s+([A-Za-z_]\w*)\s*;?\s*$/);
      if (asM) return { values: [asM[1]], via: 'regex' };
      const t = node.text.replace(/^\s*import\s+/, '').replace(/[\s;]+$/, '').trim().replace(/\.\*$/, '');
      const last = t.split('.').pop();
      return { values: last ? [last] : [], via: 'regex' };
    },
  },
  php: {
    // PHP 调用形式多样：自由函数 foo()=function_call_expression；静态 Class::m()=scoped_call_expression；实例 $o->m()=member_call_expression
    callNode: ['function_call_expression', 'scoped_call_expression', 'member_call_expression'],
    // ★ 数据：自由函数被调名在 `function` 字段；静态/实例调用在 `name` 字段
    //   （与改动前的 `'function'|'name'|'method'` 串在 PHP 上等价 —— 有意不改 callee_expr 形态）
    calleeFields: ['function', 'name'],
    // `use Foo\Bar;` / `use Foo\Bar as Baz;` / `use Foo\{Bar, Baz};` / `use function Foo\bar;`
    // ★ AST：每个 `namespace_use_clause` 是一条；分组 `use Foo\{Bar, Baz}` 则是
    //   namespace_name（头） + namespace_use_group（成员）。
    extractImportSourcesEx(node) {
      const headNode = firstNamedChildOfType(node, 'namespace_name') ?? firstNamedChildOfType(node, 'qualified_name');
      const group = firstNamedChildOfType(node, 'namespace_use_group');
      if (group) {
        const head = headNode?.text.trim().replace(/\\$/, '') ?? '';
        return { values: head ? [head] : [], via: 'ast' }; // 分组形式：主命名空间作为 source
      }
      const clauses = namedChildrenOfType(node, 'namespace_use_clause');
      const values = clauses
        .map((cl) =>
          (firstNamedChildOfType(cl, 'qualified_name') ??
            firstNamedChildOfType(cl, 'namespace_name') ??
            firstNamedChildOfType(cl, 'name'))?.text.trim() ?? '',
        )
        .filter(Boolean);
      if (values.length) return { values, via: 'ast' };
      // 兜底：AST 认不出（语法被破坏）⇒ 旧正则
      let t = node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^function\s+/, '').replace(/^const\s+/, '');
      const brace = t.indexOf('{');
      if (brace >= 0) {
        const head = t.slice(0, brace).trim().replace(/\\$/, '');
        return { values: head ? [head] : [], via: 'regex' };
      }
      const base = t.split(/\s+as\s+|\s+/, 1)[0] || t;
      return { values: base ? [base] : [], via: 'regex' };
    },
    // binding：`use Foo\Bar as Baz` → Baz；否则末段 `Bar`；分组形式取每个成员末段
    extractImportBindingsEx(node) {
      const group = firstNamedChildOfType(node, 'namespace_use_group');
      const clauses = namedChildrenOfType(group ?? node, 'namespace_use_clause');
      if (clauses.length) {
        const out = clauses
          .map((cl) => {
            const alias = cl.childForFieldName('alias');
            if (alias?.text.trim()) return alias.text.trim();
            const q =
              firstNamedChildOfType(cl, 'qualified_name') ??
              firstNamedChildOfType(cl, 'namespace_name') ??
              firstNamedChildOfType(cl, 'name');
            return q?.text.trim().split('\\').pop()?.trim() ?? '';
          })
          .filter(Boolean);
        return { values: out, via: 'ast' };
      }
      // 兜底：AST 认不出 ⇒ 旧正则
      let t = node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^function\s+/, '').replace(/^const\s+/, '');
      const brace = t.indexOf('{');
      if (brace >= 0) {
        const inner = t.slice(brace + 1, t.lastIndexOf('}'));
        return {
          values: inner
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const asM = s.match(/as\s+([A-Za-z_\x80-\xff]\w*)/);
              if (asM) return asM[1];
              return s.trim().split('\\').pop()?.trim() || '';
            })
            .filter(Boolean),
          via: 'regex',
        };
      }
      const asM = t.match(/\s+as\s+([A-Za-z_\x80-\xff]\w*)\s*$/);
      if (asM) return { values: [asM[1]], via: 'regex' };
      const last = t.split('\\').pop()?.trim();
      return { values: last ? [last] : [], via: 'regex' };
    },
  },
  // ── TS 系四门：同一份契约（callNode + 被调字段 + import 源字段 + type-only 擦除）──
  //   ★ 原先这四门在 kernel 里被两处**按语言 if** 特判（import 源提取、TS_FAMILY_LANGS 的
  //     type-only 判定），现各自表项声明；四门形同一份数据，故意不合并成别名——
  //     每门都是独立 npm 包 + 独立扩展名，表项自足才符合"加语言 = 加一行"。
  typescript: {
    callNode: 'call_expression',
    // ★ T-#83：TS 的局部绑定声明（`const/let` = lexical_declaration · `var` = variable_declaration）
    localBindingNodes: ['lexical_declaration', 'variable_declaration', 'for_in_statement'],
    calleeFields: ['function'],
    importSourceField: 'source',
    erasedModuleStatements: true,
    topLevelCall: true,
    /**
     * ★★★ 2026-10-19：**TS 系的 import 绑定提取**（原先没实现 ⇒ `bindings` 恒为 `[]`
     *   ⇒ `resolveCrossFileCalls` 拿不到"这个裸名来自哪个包"⇒ 外部引用被误判 `failed`）。
     *
     * TS 的 `import` AST 形状（tree-sitter-typescript）：
     * ```
     * import_declaration
     *   ├─ import_clause
     *   │    ├─ identifier                    ← default import（`import x from`）
     *   │    ├─ namespace_import  ─ identifier ← `import * as ns from`
     *   │    └─ named_imports
     *   │         └─ import_specifier ─ name: identifier · alias?: identifier
     *   └─ string (source)
     * ```
     * ⇒ 只取【本地可用名】：default 名 / 命名空间的 ns / specifier 的 alias（有则 alias，无则 name）。
     * ★ `import type` 也照收（"名字来自哪个模块"是事实；type_only 由调用方另标）。
     * ★★ 实现抽成 `TS_LIKE_IMPORT_BINDINGS` 常量，供 `typescript` / `tsx` / `javascript` / `jsx`
     *    【共享】—— 它们语法同源，各写一份就是四个会各自漂移的副本。
     */
    extractImportBindings: TS_LIKE_IMPORT_BINDINGS,
  },
  tsx: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true, topLevelCall: true, extractImportBindings: TS_LIKE_IMPORT_BINDINGS, localBindingNodes: ['lexical_declaration', 'variable_declaration', 'for_in_statement'] },
  javascript: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true, topLevelCall: true, extractImportBindings: TS_LIKE_IMPORT_BINDINGS, localBindingNodes: ['lexical_declaration', 'variable_declaration', 'for_in_statement'] },
  jsx: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true, topLevelCall: true, extractImportBindings: TS_LIKE_IMPORT_BINDINGS, localBindingNodes: ['lexical_declaration', 'variable_declaration', 'for_in_statement'] },

  // ═══════════════════════════════════════════════════════════════════
  // 2026-09-29 新增 5 门（scala / groovy / julia / haskell / elixir）
  //   全部值来自 `node_modules/tree-sitter-<lang>/**/node-types.json` + 真实语法树实测
  //   （探针：`scripts/ts_kernel_probe.mjs`；读数见提交信息）
  // ═══════════════════════════════════════════════════════════════════
  scala: {
    // 实测（tree-sitter-scala 0.24.0）：
    //   `def greet(n: Int): String = { … }` → (function_definition name: (identifier) … body: (indented_block …))
    //   `Helper.twice(n)` → (call_expression function: (field_expression …) arguments: …)
    //   ★ 该 grammar 里**没有** `def_definition` 节点（旧表项写错了）——真名是 function_definition
    //   ★ body 字段存在（='body'）⇒ 不必声明 bodyFields；被调在 `function` 字段
    callNode: 'call_expression',
    calleeFields: ['function'],
    // object（单例）在 Scala 里是类型/模块作用域 ⇒ kind='class'，否则其成员函数会被标成闭包
    nodeKindOverride: { object_definition: 'class' },
    // ★ 2026-09-29 本笔补 import 边。实测（0.24.0，`.inspect/ast-import-probe.mjs` dump 真树）：
    //   `import scala.collection.mutable` → (import_declaration path:identifier path:. path:identifier …)
    //   `import scala.util.{Try, Success}` → 末段是**兄弟** `namespace_selectors`（{ Try , Success }）
    //   `import allinone.*`               → 末段是**兄弟** `namespace_wildcard`
    //   ⇒ **path 字段是扁平的**（只标单个 identifier），点号/选择器都挂在同一层 ⇒ 按**文本**提取，
    //     并按"括号深度 0 的逗号"切分多条（`import a.b, c.d` 是**一条** import_declaration 两个源）。
    extractImportSources(node) {
      return splitTopLevel(node.text.replace(/^\s*(?:import|export)\s+/, ''))
        .map((p) => p.replace(/\s+as\s+[\w$]+\s*$/, '')) // Scala 3 `import a.b as c`
        .map((p) => {
          // `a.b.{C, D}` / `a.b.{C => D}` → a.b。★ 必须**先从 `{` 切**再剥尾点：
          //   早期写成正则 `/\.[^{}]*\{/`，`[^{}]*` 会跨过中间的点（`scala.util.{` 被从
          //   **第一个**点起匹配）⇒ 现场真跑读出 source='scala'（丢了 util）。实测踩过。
          const brace = p.indexOf('{');
          return brace >= 0 ? p.slice(0, brace).replace(/\.$/, '') : p;
        })
        .map((p) => p.replace(/\.(?:\*|_|given)$/, '').trim()) // `a.b.*` / `a.b._` / `a.b.given`
        .filter((p) => p.length > 0);
    },
    extractImportBindings(node) {
      const out: string[] = [];
      for (const p of splitTopLevel(node.text.replace(/^\s*(?:import|export)\s+/, ''))) {
        const brace = p.indexOf('{');
        if (brace >= 0) {
          // 选择器列表：`{C, D}` 本地名 = C/D；`{C => D}`/`{C as D}` 本地名 = D；`*`/`_`/`given` 无名
          for (const sel of splitTopLevel(p.slice(brace + 1, p.lastIndexOf('}')))) {
            if (/^(?:\*|_|given)$/.test(sel)) continue;
            const renamed = sel.match(/(?:=>|\bas)\s*([\w$]+)\s*$/);
            const plain = sel.replace(/\s*(?:=>|\bas)\s*[\w$]+\s*$/, '').trim();
            const name = renamed ? renamed[1] : lastDotSegment(plain);
            if (name && !name.includes('*')) out.push(name);
          }
          continue;
        }
        const asM = p.match(/\s+as\s+([\w$]+)\s*$/);
        if (asM) {
          out.push(asM[1]);
          continue;
        }
        const base = p.replace(/\.(?:\*|_|given)$/, '').trim();
        if (!base || /[{}]/.test(base)) continue;
        out.push(lastDotSegment(base));
      }
      return out.filter((s) => s.length > 0);
    },
  },
  groovy: {
    // 实测（tree-sitter-groovy 0.1.2）：
    //   `String greet(String n) { … }` → (method_declaration name: (identifier) parameters: … body: (block …))
    //   `def format(String s) { … }`   → (function_definition name: … body: (closure …))
    //   `format(x)` → (method_invocation name: (identifier) arguments: …)
    //   `println x` → (juxt_function_call name: (identifier) args: …)（命令式调用，另一种调用节点）
    //   ★ 旧表项写的 `class_definition` 在该 grammar 里不存在 —— 真名是 class_declaration
    callNode: ['method_invocation', 'juxt_function_call'],
    // method_invocation / juxt_function_call 的被调名都在 `name` 字段；
    // `g.greet(…)` 的接收者在 `object` 字段 ⇒ 拼回 callee_expr='g.greet'
    calleeFields: ['name'],
    calleeObjectField: 'object',
    // ★ 2026-09-29 本笔补 import 边。实测（0.1.2）import_declaration 的**逐字 text**：
    //   "import helper.Helper\n" / "import static helper.Helper.twice\n" / "import java.util.List as L\n"
    //   / "import allin.*\n\n" —— ★ 尾部带 **DELIMITER**（grammar.js L48：';' 或换行）
    //   ⇒ 正则必须先剥尾部空白/分号，否则 `as` 匹配不到句尾（先踩过）。
    extractImportSources(node) {
      const t = node.text
        .replace(/^\s*import\s+/, '')
        .replace(/^static\s+/, '')
        .replace(/[\s;]+$/, '')
        .replace(/\s+as\s+[\w$]+$/, '')
        .replace(/\.\*$/, '')
        .trim();
      return t ? [t] : [];
    },
    // 本地名 = `as` 别名；否则路径末段（`import static helper.Helper.twice` ⇒ `twice` 可直接裸调）
    extractImportBindings(node) {
      const body = node.text.replace(/^\s*import\s+/, '').replace(/^static\s+/, '').replace(/[\s;]+$/, '');
      const asM = body.match(/\s+as\s+([\w$]+)$/);
      if (asM) return [asM[1]];
      const last = lastDotSegment(body.replace(/\.\*$/, ''));
      return last ? [last] : [];
    },
  },
  julia: {
    // 实测（tree-sitter-julia 0.23.1）：
    //   `function greet(n) … end` → (function_definition (signature (call_expression (identifier) (argument_list))))
    //     ★ function_definition 的 node-types.json 里 **"fields": {}** ⇒ 名字/体都得靠结构走
    //   `helper(n) + 1` → (call_expression (identifier "helper") (argument_list …))（被调 = 第一个命名子节点）
    //   `struct Greeter … end` → (struct_definition (type_head (identifier)))；`module App … end`
    //     → (module_definition name: (identifier))（模块有 name 字段，但没有 body 字段）
    callNode: 'call_expression',
    // 名字：function_definition→signature→call_expression→identifier（定长链由类型下钻走通）；
    //   struct/abstract/primitive 走 type_head。顺序即优先级（signature/type_head 先于通用 identifier）
    nameNodeTypes: ['signature', 'type_head', 'call_expression', 'identifier'],
    // 体就是本节点自身（子节点按序即体语句；resolveName 命中的 signature 会被跳过）
    bodyIsSelf: true,
    calleeIsFirstChild: true,
    // module/struct/abstract/primitive 是**类型/模块作用域**（默认启发式会给 'function'，
    // 那会把模块内的函数误标成 is_closure —— 实测后果，见 nodeKindOverride 注释）
    nodeKindOverride: {
      module_definition: 'class',
      struct_definition: 'type',
      abstract_definition: 'type',
      primitive_definition: 'type',
    },
    // ★ 未接：`helper(n) = n * 2` 短形式（LHS 是 call_expression 的 assignment）——
    //   那需要"符号节点的结构谓词"，本笔未做（见提交信息「没验什么」）。
    // ★ 2026-09-29 本笔补 import 边。实测（0.23.1，node-types.json + dump 真树）：
    //   `using Helper` → (using_statement (identifier))
    //   `using A, B`   → (using_statement (identifier) "," (identifier))  ⇒ 逗号列表**拍平**在同层
    //   `import Helper: twice`   → (import_statement (selected_import (identifier) ":" (identifier)))
    //   `import Other.Helper as H` → (import_statement (import_alias (scoped_identifier) "as" (identifier)))
    //   ⇒ 三者都**无字段**，靠"命名子节点"取位：模块 = 首个命名子节点（selected_import/import_alias
    //     下钻一层），本地名 = 其余命名子节点。★ 该 grammar 里 import/using 是**两个**专用节点，
    //     故不需要任何按语言 if（本文件里也没有）。
    extractImportSources(node) {
      const out: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.isNamed === false) continue;
        const wraps = c.type === 'selected_import' || c.type === 'import_alias';
        const head = wraps ? nthNamedChild(c, 0) : c;
        const t = head ? head.text.trim() : '';
        if (t) out.push(t);
      }
      return out;
    },
    extractImportBindings(node) {
      const out: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.isNamed === false) continue;
        if (c.type === 'selected_import' || c.type === 'import_alias') {
          // 选项 2..n 是本地名：`import Helper: twice` 的 twice；`… as H` 的 H
          let named = 0;
          for (let j = 0; j < c.childCount; j++) {
            const g = c.child(j);
            if (!g || g.isNamed === false) continue;
            named += 1;
            if (named === 1) continue; // 首个命名子节点是模块本身，不是本地名
            const t = lastDotSegment(g.text);
            if (t) out.push(t);
          }
          continue;
        }
        const t = lastDotSegment(c.text);
        if (t) out.push(t);
      }
      return out;
    },
  },
  haskell: {
    // 实测（tree-sitter-haskell 0.23.1）：
    //   `greet n = helper n + 1` → (function name: (variable) patterns: … match: (match expression: (infix left_operand: (apply function: (variable "helper")))))
    //   `main = greet 3`        → (bind name: (variable) match: (match expression: (apply …)))
    //   `class Greeter a where prefix :: a -> String` → (class name: (name) declarations: (class_declarations …))
    //   ★ 体在 **match**（局部绑定在 binds），旧内核只认 'body'/'suite' ⇒ 下不了体 ⇒ 调用边恒空（实测）
    callNode: 'apply',
    // `helper n` → (apply function: (variable "helper") argument: …)
    calleeFields: ['function'],
    // 函数体 = match；where/let 里的局部绑定 = binds；class 的方法表 = declarations
    bodyFields: ['match', 'binds', 'declarations'],
    // ★ `function` 这个节点名在该 grammar 里**一物两用**：既是「函数绑定」
    //   （`greet n = …`，带 match/binds），又是「函数类型」（`Int -> Int`，带 result）。
    //   不设结构前提就会把类型签名里的 Int 当函数（实测：多出 `Int` 符号）。带 match/binds
    //   的才是绑定；data_type/newtype 看 constructors/constructor，class 看 declarations。
    symbolRequireFields: ['match', 'binds', 'declarations', 'constructors', 'constructor'],
    // `data_type`/`newtype` 的默认启发式给 'function'（会把构造器标成闭包）⇒ 覆盖为 'type'
    nodeKindOverride: { data_type: 'type', newtype: 'type' },
    // ★ 未接：`signature`（类型签名 `greet :: Int -> Int`）**故意不进 symbol_nodes** ——
    //   它不是函数声明，且它的 name 字段会让类型名混进符号表（旧表项误报 'Int' 的来源）。
    // ★ 2026-09-29 本笔补 import 边（**前一版的"未接 import"注释已作废**）。实测（0.23.1，
    //   node-types.json + dump 真树）：import 是**专用节点**且**带字段** ——
    //   `import Lib (twice)`               → (import module: (module) names: (import_list (import_name …)))
    //   `import qualified Data.List as L`  → (import module: (module) alias: (module))
    //   `import Data.Map (Map, empty)`     → module=Data.Map，names 里两条 import_name
    //   ⇒ 模块源走 module 字段、别名走 alias 字段、可见名走 names 字段，**全字段**、无文本正则。
    extractImportSources(node) {
      const m = fieldText(node, 'module');
      return m ? [m] : [];
    },
    // 本地可用名：有 `as` 别名 ⇒ 别名（`L.sort` 的 L）；否则**只有 names 列表里的名字**才进入
    // 无限定作用域（裸 `import Data.List` 不提供裸名，故不给绑定 —— 保守方向）。
    extractImportBindings(node) {
      const alias = fieldText(node, 'alias');
      if (alias) return [alias];
      const names = node.childForFieldName('names');
      if (!names) return [];
      const out: string[] = [];
      for (let i = 0; i < names.childCount; i++) {
        const c = names.child(i);
        if (!c || c.isNamed === false) continue;
        const t = lastDotSegment(c.text);
        if (t) out.push(t);
      }
      return out;
    },
  },
  elixir: {
    // 实测（tree-sitter-elixir 0.3.5）：
    //   `defmodule App do … end` → (call target: (identifier "defmodule") arguments: (alias "App") do_block: …)
    //   `def greet(n) do … end`  → (call target: (identifier "def") arguments: (call target: (identifier "greet") …) do_block: …)
    //   `helper(n)`              → (call target: (identifier "helper") arguments: …)
    //   `App.greet(3)`           → (call target: (dot left: (alias "App") right: (identifier "greet")) …)
    //   ★ 该语法里 **`def`/`defmodule` 自己就是 call** ⇒ 旧表项（symbol_nodes=['call','do_block']）
    //     会把 defmodule/def/内层名全当符号（实测 8 条里 6 条是垃圾），且 calls 恒为 0
    callNode: 'call',
    // 被调名在 `target` 字段（`App.greet` 的 target 是 dot 节点，取文本尾部标识符 → greet）
    calleeFields: ['target'],
    // ★ 体是 **do_block 子节点**（node-types.json 里 `call` 只有 target 一个字段，
    //   arguments/do_block 都是**无字段的命名子节点**）⇒ 走 bodyNodeTypes 而不是 bodyFields
    //   （`,` 一行式 `def helper(n), do: n*2` 的体在 arguments 的 keywords 里，本笔未接）
    bodyNodeTypes: ['do_block'],
    // 宏即声明：只有 target ∈ 下表值才算符号定义节点（其余 call 是普通调用）
    symbolDispatch: {
      field: 'target',
      kinds: {
        def: 'function',
        defp: 'function',
        defmacro: 'function',
        defmacrop: 'function',
        defmodule: 'class',
        defprotocol: 'interface',
        defimpl: 'class',
        defstruct: 'type',
      },
    },
    // 真名不在本节点字段里（那是 `def` 关键字），在 arguments → 内层 call → target 这条**定长路径**上
    namePaths: [
      ['arguments', 'call', 'target'], // def greet(n) / defp foo(x) / def helper(n), do: …
      ['arguments', 'identifier'], // def run
      ['arguments', 'alias'], // defmodule App
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════════
  // ★ 2026-10-08：补 5 门"符号早就提得出来、却一条调用边都没有"的语言。
  //   做法：6 个并行子代理**逐门实测语法树**（原始 walk + node-types.json）产出事实，
  //   本笔按事实串行落到这张表（同一文件不能并行改 —— 会静默丢改动）。
  //   ★ 只声明调用相关字段：`resolveName` 先用注册表的 `field_map.name`，
  //     所以**不会**改变这些语言已有的符号行为（逐条核对过 `a?.` 都是可选使用）。
  // ══════════════════════════════════════════════════════════════════════════════
  bash: {
    // 实测：`bar` 就是 `command` 节点，被调名在 **`name` 字段**（→ command_name → word）。
    //   `bar arg1` 只多出 `argument` 字段，`name` 不变 ⇒ 取法不受参数影响。
    //   ★ 必须用字段：若取整节点文本会得 `bar arg1`，尾部标识符正则反取成 `arg1`。
    //   node-types.json: node_modules/tree-sitter-bash/src/node-types.json L794(command) / L827(name 字段)
    callNode: 'command',
    calleeFields: ['name'],
    // ★ 不接 import：`source ./a.sh` / `. ./a.sh` 与普通命令**同型**（同一 `command`，name=source/`.`），
    //   没有专用导入节点 ⇒ 把 `command` 塞进 import_nodes 会让**每条命令**都成依赖候选（类别错误）。
  },
  fish: {
    // 实测：`bar` 是 `command`，被调名在 **`name` 字段**（→ word）。带 `$x` 只多 `argument` 字段。
    //   node-types.json: .inspect/grammar-src/fish/tree-sitter-fish/src/node-types.json L240 / L297(name 字段)
    callNode: 'command',
    calleeFields: ['name'],
    // ★ 必须声明：`function_definition` **没有 body 字段** —— 它的命名子节点直接就是
    //   `word`(函数名) + `command`(体语句)。实测 `body` 字段为 null ⇒ 默认取法拿不到体 ⇒ calls=0。
    bodyIsSelf: true,
    // 不接 import：`source ./a.fish` 与普通命令同型（node-types 里**零** import/source 类节点）。
  },
  ocaml: {
    // ★ 实测：OCaml 的调用是**函数应用**（`bar ()`）⇒ 节点是 `application_expression`，**不是** call_expression。
    //   被调函数在 **`function` 字段**；参数在 multiple 的 `argument` 字段。
    //   ★ 必须用字段：`bar a b` 是**单个** application_expression ⇒ 若取整节点文本，
    //     尾部标识符会误取最后一个**参数**。
    //   「应用」与「纯引用」的区分：应用有 `application_expression` 包裹；裸引用只是 value_path/value_name。
    //   node-types.json: 语法仓 src/node-types.json L1082(application_expression) / L1100(function 字段)
    callNode: 'application_expression',
    calleeFields: ['function'],
    // ★ 必须声明：`let_binding` 的 `body` 字段**就是那条表达式**（`bar ()`），没有块包裹。
    //   默认取法返回"体的子节点"⇒ 会把 application_expression 本身丢掉 ⇒ 调用边全丢（实测 calls=0）。
    bodyIsExpression: true,
    // ★ import 边（子代理实测）：`open Foo` 是**专用节点** `open_module`，模块名在 **`module`** 字段
    //   （→ `module_path`：`open Foo`→`Foo`、`open Foo.Bar`→`Foo.Bar`）。
    //   ★ 它**不是文件路径而是模块名** ⇒ 落成 `kind='package'`；"模块名 → 哪个文件"的解析属**另一层**
    //   （`resolveProjectImport` / LANG_RESOLVERS），本笔不碰。
    //   node-types.json: 语法仓 src/node-types.json L4281 / L4284(module 字段)
    importSourceField: 'module',
  },
  solidity: {
    // 实测：`bar()` → `call_expression`，被调名在 **`function` 字段**
    //   （该字段是个 `expression` 包裹节点，其 `.text` 即 `bar` / `a.b`）⇒ 内核取 .text + 尾标识符即可。
    //   实测 `name`/`callee`/`method`/`target`/`receiver`/`arguments` 字段**全为 null**。
    //   node-types.json: node_modules/tree-sitter-solidity/src/node-types.json L369 / L372(function 字段)
    callNode: 'call_expression',
    calleeFields: ['function'],
    // ★ import 边（子代理实测）：有**专用**节点 `import_directive`（与 ruby 那种"require 即普通 call"不同），
    //   模块路径在 **`source`** 字段（`string` 节点、text 含引号 ⇒ `stripQuotes` 去掉）。
    //   三种形态 `import "./a.sol"` / `import {A,B as C} from "./b.sol"` / `import * as D from "./c.sol"`
    //   **都**落在同一个字段。
    //   node-types.json: node_modules/tree-sitter-solidity/src/node-types.json L1171 / L1194(source 字段)
    importSourceField: 'source',
  },
  crystal: {
    // ★ 实测（子代理逐字段探测 + 本笔复验）：被调名在 `method_call` 的**第 0 个子节点**上，
    //   而那是个 `alias($.property, '')` 的**内联节点**（`isNamed=false`、`type=''`、`text='obj.bar'`）
    //   ⇒ `calleeIsFirstChild`（走 firstNamedChild）**取不到** ⇒ 必须用 `calleeChildIndex: 0`。
    //   `method_call` 唯一的具名字段是 `arg`（参数），`name`/`object`/`receiver`/`method` 实测全 null。
    // ★★ 这个语法有个**上游固有限制**（实测，非本仓问题）：`method_call` 规则里
    //   `alias($.property,'')` 是**必需项** ⇒ **裸调用**不提调用节点：
    //   `bar` → `local_variable`、`bar()` → `ERROR`；只有带 receiver 的 `self.bar` / `obj.bar` 才成 `method_call`。
    //   证据：grammar.js L474-487；上游副本逐字节一致。
    callNode: 'method_call',
    calleeChildIndex: 0,
    // ★ import 边（子代理实测）：`require "a"` 是**专用语句节点** `require_statement`
    //   （**不是**普通方法调用 ⇒ 与 ruby 的 `require` 不同、**可做**），路径在 **`path`** 字段（text 含引号）。
    //   实测仅支持裸写法；`require("x")` 会变 `ERROR`（上游限制）。
    //   grammar.js:311-314 = seq('require', field('path', $.string))
    importSourceField: 'path',
    // ★ 实测：`method_definition` 也**没有 body 字段**（body/suite 皆 null），命名子节点就是
    //   `identifier`(方法名) + `method_call`(体语句) ⇒ 与 fish 同形，用 `bodyIsSelf`
    //   （名字那个直接子节点由 `nameIndex` 跳过）。
    bodyIsSelf: true,
  },
  swift: {
    // ★ 实测：`call_expression` 的 `"fields": {}`（**零字段**）⇒ 被调表达式是**第一个命名子节点**
    //   （`bar()` → simple_identifier "bar"）。11 个候选字段实测全 null。
    //   ★ 已知边界（子代理实测，未处理）：泛型调用 `generic<Int>(3)` 落成 `constructor_expression`
    //     而非 call_expression ⇒ **即使加了本条也提不出边**；`arr[0]()` 的尾标识符会失真成 `arr`。
    callNode: 'call_expression',
    calleeIsFirstChild: true,
  },
};

/** 取某语言 import 的 source 列表（深适配查注册表；简单字段走 importSourceField） */
function extractImportSources(node: SyntaxNodeLike, langName: string): ImportExtract {
  const a = LANG_ADAPTERS[langName];
  // ★ Ex 优先：只有它知道自己是「AST 取到的」还是「正则兜的」
  if (a?.extractImportSourcesEx) return a.extractImportSourcesEx(node);
  if (a?.extractImportSources) return { values: a.extractImportSources(node) };
  // ★ 典型形态：语句上有 `source` 字段（TS 系 `import x from 'y'`）。
  //   原先这里是 `langName === 'typescript' || 'tsx' || 'javascript' || 'jsx'` 的按语言 if，
  //   现改为表项数据 importSourceField。
  if (a?.importSourceField) {
    const s = fieldText(node, a.importSourceField);
    return { values: s ? [stripQuotes(s)] : [] };
  }
  return { values: [] };
}

/** 取某语言 import 的本地绑定名（深适配查注册表；无则空） */
function extractImportBindings(node: SyntaxNodeLike, langName: string, paths: string[]): ImportExtract {
  const a = LANG_ADAPTERS[langName];
  if (a?.extractImportBindingsEx) return a.extractImportBindingsEx(node, paths);
  return { values: a?.extractImportBindings ? a.extractImportBindings(node, paths) : [] };
}

function isCallNode(node: SyntaxNodeLike, lang: LanguageEntry): boolean {
  return LANG_ADAPTERS[lang.name]?.callNode === node.type || (Array.isArray(LANG_ADAPTERS[lang.name]?.callNode) && (LANG_ADAPTERS[lang.name]!.callNode as string[]).includes(node.type));
}

/**
 * 是不是「符号定义节点」——**唯一判据**（三个遍历器共用，别各写一份）。
 *
 * ★ 2026-09-29 扩契约：原先三处都是 `lang.symbol_nodes.includes(node.type)`，
 *   对「宏即声明」语法（Elixir）不够用 —— `def` 与普通函数调用**同型**（都是 `call`），
 *   只看节点类型会把每次调用都当声明。现由适配器 `symbolDispatch` 声明
 *   「哪个字段的文本命中哪些值才算声明」，命中即符号节点（该表兼作 kind 表）。
 */
function isSymbolNode(node: SyntaxNodeLike, lang: LanguageEntry): boolean {
  if (!lang.symbol_nodes.includes(node.type)) return false;
  const a = LANG_ADAPTERS[lang.name];
  if (a?.symbolRequireFields && !a.symbolRequireFields.some((f) => node.childForFieldName(f) !== null)) return false;
  const d = a?.symbolDispatch;
  if (!d) return true;
  return Object.prototype.hasOwnProperty.call(d.kinds, fieldText(node, d.field));
}

/** 符号节点的 kind：symbolDispatch（宏即声明）＞ nodeKindOverride（覆盖表）＞ 通用启发式 */
function symbolKind(node: SyntaxNodeLike, lang: LanguageEntry, parent?: string): ParsedSymbol['kind'] {
  const a = LANG_ADAPTERS[lang.name];
  const d = a?.symbolDispatch;
  if (d) {
    const k = d.kinds[fieldText(node, d.field)];
    if (k) return k;
  }
  const ov = a?.nodeKindOverride?.[node.type];
  if (ov) return ov;
  return nodeTypeToKind(node.type, parent);
}

/**
 * 符号定义节点的「体」= **体的子节点列表**（不是单个节点：见 bodyIsSelf）。
 * 取法（三级，全数据驱动）：
 *   ① 适配器 `bodyFields` ?? DEFAULT_BODY_FIELDS 里的字段（实测 Haskell='match'、Elixir='do_block'）
 *   ② 适配器 `bodyNodeTypes` 声明的体节点类型（实测 kotlin：'function_body'/'class_body'）
 *   ③ 适配器 `bodyIsSelf` ⇒ 本节点的子节点按序即体（实测 julia），
 *      **跳过 resolveName 命中的那个子节点**（`nameIndex`）——否则签名里的 call_expression
 *      会被当成一次真实调用（实测会多出 `-> greet` 自调用边）
 * 返回 null = 没找到体（调用方按"该符号无体"处理）。
 */
function bodyChildren(node: SyntaxNodeLike, lang: LanguageEntry, nameIndex: number | null): SyntaxNodeLike[] | null {
  const a = LANG_ADAPTERS[lang.name];
  // ★ 先判"体字段的值**自身**就是一条语句"（ocaml 的 `let foo () = bar ()`）——
  //   必须排在下面按 bodyFields 取"体的子节点"之前，否则那条调用节点会被丢掉。
  if (a?.bodyIsExpression) {
    for (const f of a?.bodyFields ?? DEFAULT_BODY_FIELDS) {
      const c = node.childForFieldName(f);
      if (c) return [c];
    }
  }
  for (const f of a?.bodyFields ?? DEFAULT_BODY_FIELDS) {
    const c = node.childForFieldName(f);
    if (c) {
      const out: SyntaxNodeLike[] = [];
      for (let i = 0; i < c.childCount; i++) {
        const k = c.child(i);
        if (k) out.push(k);
      }
      return out;
    }
  }
  const types = a?.bodyNodeTypes;
  if (types) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && types.includes(c.type)) {
        const out: SyntaxNodeLike[] = [];
        for (let k = 0; k < c.childCount; k++) {
          const kk = c.child(k);
          if (kk) out.push(kk);
        }
        return out;
      }
    }
  }
  if (a?.bodyIsSelf) {
    const out: SyntaxNodeLike[] = [];
    for (let i = 0; i < node.childCount; i++) {
      if (i === nameIndex) continue;
      const c = node.child(i);
      if (c) out.push(c);
    }
    return out;
  }
  return null;
}

/**
 * 符号的**函数体原文**（schema v15 的 `nodes.body_text`）。
 *
 * 取法 = `bodyChildren` 的**单节点版**，消费**同一份规则表**（`LANG_ADAPTERS` 的
 * `bodyFields` / `bodyNodeTypes`）—— 不给 body_text 另抄一份逐语言清单，否则两份会各自漂移。
 * 三级（全数据驱动，内核不认识任何具体语言）：
 *   ① 适配器 `bodyFields` ?? DEFAULT_BODY_FIELDS 的字段值（ts/js `body`、python `suite`/`body`、
 *      go/java/c#/rust `body`、php `body`…）⇒ **返回该节点本身**（不是它的孩子）；
 *   ② 适配器 `bodyNodeTypes` 声明的体节点类型（实测 kotlin：`function_body` / `class_body`）；
 *   ③ 都没有 ⇒ undefined。★ `bodyIsSelf`（julia / fish / crystal / solidity）**故意不造**：
 *      那几门的体是"本节点的子节点序列"，没有单一节点 ⇒ 拼出来的是我们**发明**的一段文本，
 *      而不是语法树上的一颗节点的原文 ⇒ 落 NULL（宁缺勿造）。
 *
 * ★ 原文照录：`node.text` 直接返回 —— 不重排缩进、不去注释、不归一化空白。
 * ★ **外层花括号照语法树原样**（消费方要靠这条决定怎么拼回去）：
 *   ts/js（statement_block）/ go（block）/ java（block）/ kotlin（function_body）/ php
 *   （compound_statement）/ c#（block）/ rust（block）⇒ **含** `{ }`；
 *   python 的 `block` = 缩进语句块 ⇒ **不含** `def` 行、没有花括号；
 *   ts/js 箭头简写（`x => x+1`）的 body 字段是表达式 ⇒ 不含花括号。
 * ★ 空串 ⇒ undefined（"有一个零宽度的体"不是事实；空串会污染 `body_hash` 的语义）。
 */
function bodyTextOf(node: SyntaxNodeLike, lang: LanguageEntry): string | undefined {
  const a = LANG_ADAPTERS[lang.name];
  for (const f of a?.bodyFields ?? DEFAULT_BODY_FIELDS) {
    const c = node.childForFieldName(f);
    if (c) return c.text || undefined;
  }
  const types = a?.bodyNodeTypes;
  if (types) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && types.includes(c.type)) return c.text || undefined;
    }
  }
  return undefined;
}

/** 第一个命名子节点（跳过匿名关键字/标点；isNamed 缺省视为命名节点） */
function firstNamedChild(node: SyntaxNodeLike): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.isNamed !== false) return c;
  }
  return null;
}

/**
 * 从 call 节点提取被调用名：按适配器 `calleeFields` 的字段顺序取被调表达式，
 * 再取**尾部标识符**（去点、去泛型参数）。
 *
 * ★ 2026-09-29 扩契约：原先这里硬编码 `'function' || 'name' || 'method'` 三个字段名，
 *   并对 Java 单开一条 `langName === 'java' ? childForFieldName('object') : null`（按语言 if）。
 *   现两者都是表项数据（calleeFields / calleeObjectField），内核不认识任何具体语言。
 */
function extractCallee(callNode: SyntaxNodeLike, langName: string): { name: string; expr: string } | null {
  const a = LANG_ADAPTERS[langName];
  let fn: SyntaxNodeLike | null = null;
  for (const f of a?.calleeFields ?? []) {
    const c = callNode.childForFieldName(f);
    if (c) {
      fn = c;
      break;
    }
  }
  if (!fn && a?.calleeIsFirstChild) fn = firstNamedChild(callNode);
  // ★ 匿名/内联的被调表达式（crystal 的 `alias($.property,'')`）：按**子节点序号**取，不管命名与否。
  if (!fn && typeof a?.calleeChildIndex === 'number') fn = callNode.child(a.calleeChildIndex);
  if (!fn) return null;
  // 对象与方法名分离的语法（Java/Groovy 的 method_invocation.object）→ 拼回 qualified 前缀供 is-target 用
  const obj = a?.calleeObjectField ? callNode.childForFieldName(a.calleeObjectField) : null;
  const expr = obj && obj.text ? `${obj.text}.${fn.text}` : fn.text;
  // 泛型调用 fn<T>(...)：取 < 前的基底再取尾部标识符（`svc.Process` → Process / `a.b.c` → c）
  const base = expr.split('<')[0].trim();
  const m = base.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!m) return null;
  const name = m[1];
  if (!isValidIdentifier(name)) return null;
  return { name, expr };
}

/**
 * 遍历函数体提取调用边（跳过嵌套函数声明子树——其调用归属嵌套函数自身，
 * 由 traverseAndExtractCalls 递归处理）。
 */
/**
 * ★★★ 2026-10-27（T-#59 修 2）：**预扫一个函数体，把所有局部绑定名收上来**。
 *
 * ## 为什么必须“预扫”而不能靠递归时的 childScope
 * `extractCallsFromBody` 是**逐个 body 子句**调用的
 * ⇒ `const onChange = opts.onChange;`（第 1 个子句）与 `onChange(summary)`（第 5 个子句）
 *   是**兄弟关系** ⇒ 在子句内部扩展的 `childScope` **传不到兄弟**（实测 local 0 的真因）。
 * ⇒ 只能在**函数层**把整段 body 扫一遍，把名字“提升”进初始作用域。
 *
 * ## 收什么 / 不收什么
 * · 收：`const x = <非函数值>`（`opts.onChange` / `new Function(...)` / 三元 / `??`）
 * · 收：解构 `const { a, b } = …` 里的 `a`/`b`
 * · **不收**：`const x = () => {}`（它是**符号**，在 `nodes` 里 ⇒ 收进来会抢在 classifyCall 前面丢边）
 * · **不收**：嵌套函数体内的东西（那是它自己的作用域）
 */
function collectLocalBindings(nodes: readonly SyntaxNodeLike[], langName?: string): string[] {
  const out: string[] = [];
  const collectIds = (n: SyntaxNodeLike): void => {
    if (n.type.includes('identifier') || n.type === 'shorthand_property_identifier_pattern') {
      if (isValidIdentifier(n.text)) out.push(n.text);
      return;
    }
    for (let k = 0; k < n.childCount; k++) {
      const c = n.child(k);
      if (c) collectIds(c);
    }
  };
  const walk = (n: SyntaxNodeLike, depth: number): void => {
    if (depth > 40) return;
    // 嵌套函数 = 新作用域 ⇒ 不往里扫
    if (
      n.type === 'arrow_function' ||
      n.type === 'function_expression' ||
      n.type === 'function' ||
      n.type === 'function_declaration' ||
      n.type === 'generator_function'
    ) {
      return;
    }
    // ★★★ 2026-10-27（T-#61）：**形态收敛到 `localBindingsOfDecl`**（TS + Go 两种已在里面）。
    //   以后加语言只需在那一处加一支 —— 不再在这里散落 if。
    const binds = localBindingsOfDecl(n, langName);
    if (binds) {
      // ★ T-#60 护栏（AST 版）：**从 import 解构出来的名字不收** ——
      //   `const { saveDSL } = await import('…')` ⇒ `saveDSL` 是**导入绑定**，不是局部变量
      //   （当成局部变量会丢真边，实测 edges -5）。判据看语法结构，不看文本。
      let hasImport = false;
      for (let i = 0; i < n.childCount && !hasImport; i++) {
        const c = n.child(i);
        if (!c) continue;
        const v = c.type === 'variable_declarator' ? c.childForFieldName('value') : c;
        if (isImportCallNode(v)) hasImport = true;
      }
      if (!hasImport) {
        // 函数值不收（那是符号，收进来会抢在 classifyCall 前面丢边）；其余都算局部绑定
        for (const b of binds) if (!b.isFnValue) out.push(b.name);
      }
    }
    for (let k = 0; k < n.childCount; k++) {
      const c = n.child(k);
      if (c) walk(c, depth + 1);
    }
  };
  for (const n of nodes) walk(n, 0);
  return out;
}

/**
 * ★★★ 2026-10-27（T-#60）：**这个值节点是不是一次 import 调用**（AST 判定，不用文本正则）。
 *
 * 为什么需要它：`const { saveDSL } = await import('../../storage.js')` 里的 `saveDSL`
 * 是**导入绑定**，不是局部变量 —— 当成局部变量会**丢真边**（实测 edges -5）。
 *
 * 为什么不用正则：上一版用 `/(^|\s)(await\s+)?import\s*\(/` 去匹 `valueNode.text`
 * —— 字串里恰好带 `import(` 就会误跳（比如报错文案），且不同语法的节点形态不一样。
 * ⇒ 改为**看语法结构**：`import` 是一个**节点类型**（不是标识符）。
 */
function isImportCallNode(n: SyntaxNodeLike | null | undefined): boolean {
  if (!n) return false;
  // 有的语法把 `import(...)` 直接做成 import 节点
  if (n.type === 'import' || n.type === 'import_expression' || n.type === 'dynamic_import') return true;
  // `await import(...)` / `(await import(...))` ⇒ 往里走一层
  if (n.type === 'await_expression' || n.type === 'parenthesized_expression') {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c && isImportCallNode(c)) return true;
    }
    return false;
  }
  // 普通调用：看被调方是不是 `import`
  if (n.type === 'call_expression') {
    const fn = n.childForFieldName('function');
    if (fn && (fn.type === 'import' || fn.text === 'import')) return true;
  }
  return false;
}

/**
 * ★★★ 2026-10-27（T-#61）：**把"局部函数绑定"的语法形态收敛到一处**（TS / Go 两种已实现）。
 *
 * ## 为什么需要（这正是"多语言 AST 却不能自动解锁"的活例）
 * T-#45 / T-#59 只认 TS 的 `lexical_declaration` ⇒ 而 **Go 的局部闭包是另一种形态**：
 *   `probeName := func(kind string) string { … }`
 *   ⇒ `short_var_declaration` + `left: expression_list` + `right: expression_list` + `func_literal`
 *   ⇒ **没被认出来** ⇒ `probeName` / `offsetOf` / `mk` / `add` / `opt` 全落 `failed`（实测 13 条）。
 * ⇒ 修法不是"再写一个 if"，而是**把形态收敛成一个函数**：以后加语言只在这里加一支。
 *
 * ## 返回
 * `[{ name, isFnValue }]` —— `isFnValue` 区分"绑定的是函数"（是符号）还是"普通值"（局部变量）。
 */
function localBindingsOfDecl(
  node: SyntaxNodeLike,
  langName?: string,
): Array<{ name: string; isFnValue: boolean }> | null {
  // ★★★ T-#83：**按语言门控** —— 本语言没声明 `localBindingNodes` ⇒ 直接“不是局部绑定声明”。
  //   ★ 这同时修掉一个隐蔽 bug：`var_declaration` 在 TS 分支和 Go 分支**都出现**，
  //     TS 分支先 `return` ⇒ **Go 的 `var x T = …` 永远收不到**。
  //     门控后只有本语言自己的分支会被走到 ⇒ 两边可以安全重叠。
  if (langName) {
    const allowed = LANG_ADAPTERS[langName]?.localBindingNodes;
    if (!allowed || !allowed.includes(node.type)) return null;
  }
  const FN_TYPES = ['arrow_function', 'function_expression', 'function', 'generator_function', 'func_literal', 'lambda'];
  const isFn = (v: SyntaxNodeLike | null): boolean => !!v && FN_TYPES.includes(v.type);
  const out: Array<{ name: string; isFnValue: boolean }> = [];
  // ── 形态 ① TS/JS：lexical_declaration / variable_declaration → variable_declarator(name,value)
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const dec = node.child(i);
      if (!dec || dec.type !== 'variable_declarator') continue;
      const nameNode = dec.childForFieldName('name');
      const valueNode = dec.childForFieldName('value');
      if (!nameNode) continue;
      if (nameNode.type === 'identifier') {
        if (isValidIdentifier(nameNode.text)) out.push({ name: nameNode.text, isFnValue: isFn(valueNode) });
      } else {
        // 解构：把里面的标识符逐个收（`const { a, b } = x`）
        const ids: string[] = [];
        const walkIds = (n: SyntaxNodeLike): void => {
          if (n.type.includes('identifier') || n.type === 'shorthand_property_identifier_pattern') {
            if (isValidIdentifier(n.text)) ids.push(n.text);
            return;
          }
          for (let k = 0; k < n.childCount; k++) {
            const c = n.child(k);
            if (c) walkIds(c);
          }
        };
        walkIds(nameNode);
        for (const id of ids) out.push({ name: id, isFnValue: false });
      }
    }
    return out;
  }
  // ── 形态 ③ **循环解构**：TS `for (const {a,b} of xs)` · Go `for _, v := range xs`
  //
  // ## 病史（实测 AST 才看出来的）
  // 两条 remaining failed 全是这个形态：
  //   TS `for (const { re, make } of GO_HOLD_RES) … make(m)` —— `make` 是解构出的函数值
  //   Go `for _, opt := range opts { opt(t) }` —— `opt` 是 range 变量
  //
  // ## ★ 为什么形态① 抓不到（关键）
  // TS 的 `for_in_statement` 里**没有 `lexical_declaration`**！
  // 实测 AST：`for_in_statement` → `for` · `(` · **`const`（裸 token）** ·
  //   **`object_pattern`（直接子节点）** · `of` · `identifier` · `)` · `statement_block`
  // ⇒ `const` 只是个 token，**没有声明节点包着它** ⇒ 形态①（`lexical_declaration`）**永不命中**。
  // Go 同理：`for _, v := range xs` 是 `range_clause`，**不是** `short_var_declaration`。
  if (node.type === 'for_in_statement' || node.type === 'range_clause') {
    const ids: string[] = [];
    const collectIds = (x: SyntaxNodeLike): void => {
      if (x.type === 'pair_pattern') {
        const v = x.childForFieldName('value');
        if (v) collectIds(v);
        return;
      }
      if (x.type.includes('identifier') || x.type === 'shorthand_property_identifier_pattern') {
        // Go 的 `_` 是空标识符 ⇒ 不是绑定
        if (isValidIdentifier(x.text) && x.text !== '_') ids.push(x.text);
        return;
      }
      for (let k = 0; k < x.childCount; k++) {
        const c = x.child(k);
        if (c) collectIds(c);
      }
    };
    if (node.type === 'range_clause') {
      // Go：`range_clause` 的 left 是 expression_list（`_, v`）
      const left = node.childForFieldName('left') ?? node.childForFieldName('name');
      if (left) collectIds(left);
    } else {
      // TS：直接子节点里的 pattern（`object_pattern` / `array_pattern` / `identifier`）
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'object_pattern' || c.type === 'array_pattern' || c.type === 'identifier') {
          collectIds(c);
        }
      }
    }
    for (const nm of ids) out.push({ name: nm, isFnValue: false });
    return out;
  }
  // ── 形态 ② Go：short_var_declaration → left(expression_list) = right(expression_list)
  //    `probeName := func(…) string { … }` / `a, b := 1, f()` 都走这一支
  if (node.type === 'short_var_declaration' || node.type === 'var_declaration') {
    const left = node.childForFieldName('left') ?? node.childForFieldName('name');
    const right = node.childForFieldName('right') ?? node.childForFieldName('value');
    const lefts: SyntaxNodeLike[] = [];
    const rights: SyntaxNodeLike[] = [];
    const flatten = (n: SyntaxNodeLike | null, into: SyntaxNodeLike[]): void => {
      if (!n) return;
      if (n.type === 'expression_list' || n.type === 'var_spec') {
        for (let k = 0; k < n.childCount; k++) {
          const c = n.child(k);
          if (c) flatten(c, into);
        }
        return;
      }
      into.push(n);
    };
    flatten(left, lefts);
    flatten(right, rights);
    for (let i = 0; i < lefts.length; i++) {
      const ln = lefts[i];
      if (ln.type !== 'identifier' || !isValidIdentifier(ln.text)) continue;
      // ★★★ 2026-10-27（T-#74）：**Go 的局部 func_literal 一律当「局部绑定」，不当符号**。
      //
      // ## 病史（读数据定位）
      // `processFunction`（L568-657）里：`probeName := func(…)`（L592）声明、
      // `probeName("enter")`（L600/603/623/630/644/653）**同一函数内**调用。
      // 原先 `isFnValue` 判为 true ⇒ 被 `collectLocalBindings` 里
      // `if (!b.isFnValue) out.push(…)` **跳过** —— 那条规则的假设是
      // 「函数值 ⇒ 它已经是 nodes 里的符号」（对 TS 的 `const X = () => {}` 成立，
      // 由 T-#45/T-#52 收进 nodes）；**但 Go 的 `:= func` 从不进 nodes**
      // ⇒ **两条路都漏** ⇒ 永远 `failed`（实测 13 条）。
      // ⇒ 修法：Go 分支**永远 `isFnValue: false`**（它的 func_literal 不是符号）。
      out.push({ name: ln.text, isFnValue: false });
    }
    return out;
  }
  return null;
}

function extractCallsFromBody(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  callerQn: string,
  calls: ParsedCall[],
  symbols: ParsedSymbol[],
  depth: number = 0,
  /** ★ T-#55：**当前可见的局部绑定名**（祖先函数的参数 + 逐层匿名箭头/函数表达式的参数） */
  scope: Set<string> = new Set()
): void {
  if (depth > 200) return;
  // ★★★ 2026-10-27（T-#59 修）：**declaration 不早退**。
  //   病史：这里原本是无条件 `if (isSymbolNode(node, lang)) return;`
  //   而 TS 的 `lexical_declaration` **本身是符号节点**（顶层 const 就是靠它成为符号的）
  //   ⇒ **函数体内的 `const fn = new Function(...)` / `const { onChange } = opts` 整支被跳过**
  //   ⇒ 下面的作用域收集**永远跑不到**（实测 `local 0` 的真因）。
  //   ⇒ 只对 declaration 放行；function/class 仍然早退（它们的体由 `traverseAndExtractCalls` 负责，
  //     放行会造成重复提取）。
  const isDeclNodeHere = node.type === 'lexical_declaration' || node.type === 'variable_declaration';
  if (isSymbolNode(node, lang) && !isDeclNodeHere) return;
  if (isCallNode(node, lang)) {
    const c = extractCallee(node, lang.name);
    if (c) {
      const sym = symbols.find((s) => s.name === c.name);
      // ★ T-#55：名字命中作用域参数 ⇒ 它是**局部绑定**，不可能对应仓内符号
      const isLocal = scope.has(c.name);
      calls.push({
        caller: callerQn,
        callee: c.name,
        callee_expr: c.expr,
        line: node.startPosition.row + 1,
        resolved: !isLocal && !!sym,
        callee_qn: !isLocal && sym ? sym.qualified_name : undefined,
        ...(isLocal ? { local: true } : {}),
      });
    }
    // 继续递归子节点：参数/回调中可能嵌套调用（如 fmt.Println(hello(x)) / arr.map(fn)）
    // callee 表达式（identifier/selector）不是 call 节点，不会被误提取
  }
  // ★ T-#55：**匿名函数自己引入作用域** —— 它的参数只存在于 AST，不进 nodes ⇒ 只能在这里记
  let childScope = scope;
  if (
    node.type === 'arrow_function' ||
    node.type === 'function_expression' ||
    node.type === 'function' ||
    node.type === 'generator_function'
  ) {
    const names = paramsOf(node, 'parameters', lang.name)
      .map((p) => p.name)
      .filter((n): n is string => !!n);
    if (names.length > 0) childScope = new Set([...scope, ...names]);
  }
  // ★★★ 2026-10-27（T-#59）：**函数体内的局部 const 绑定进作用域**（解构 + 非函数值）。
  //
  // ## 为什么
  // 实测剩 89 条里有一大类是**局部绑定**却被当成"漏连"：
  //   `const { onChange, onError } = opts`  ⇒ 解构出来的名字不在 `nodes`（`paramsOf` 只给 `opts`）
  //   `const fn = cond ? a : b`            ⇒ 绑定值**不是函数** ⇒ 不进 nodes（T-#45 只收函数值）
  //   `const run = opts.run ?? defaultRun` ⇒ 同上
  // ⇒ 它们**不是符号**，引用它们**合法** ⇒ 该判 `local-binding`，不该 `failed`。
  //
  // ## 为什么不收"函数值"的 const
  // `const walk = () => {}` **是符号**（在 `nodes` 里，T-#45/T-#52 已收）⇒ 若也塞进作用域，
  // 下面的 `local: true` 会**抢在** `classifyCall` 前面把它判成 external ⇒ **丢掉真边**。
  // ⇒ 只收**绑定值不是函数**的那些。
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < node.childCount; i++) {
      const dec = node.child(i);
      if (!dec || dec.type !== 'variable_declarator') continue;
      const nameNode = dec.childForFieldName('name');
      const valueNode = dec.childForFieldName('value');
      if (!nameNode) continue;
      const isFnValue =
        !!valueNode &&
        ['arrow_function', 'function_expression', 'function', 'generator_function'].includes(valueNode.type);
      if (isFnValue) continue; // 函数值 = 符号，交给 nodes/classifyCall
      const bound: string[] = [];
      const collectIds = (n: SyntaxNodeLike): void => {
        if (n.type.includes('identifier') || n.type === 'shorthand_property_identifier_pattern') {
          if (isValidIdentifier(n.text)) bound.push(n.text);
          return;
        }
        for (let k = 0; k < n.childCount; k++) {
          const c = n.child(k);
          if (c) collectIds(c);
        }
      };
      collectIds(nameNode);
      if (bound.length > 0) childScope = new Set([...childScope, ...bound]);
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) extractCallsFromBody(child, lang, callerQn, calls, symbols, depth + 1, childScope);
  }
}

/**
 * 遍历 AST 提取调用边：调用归属 = 包含它的最近函数/方法符号（class 压栈仅为限定名，
 * 不提取调用）。与符号提取独立遍历（先符号后调用），保证 nameToQn 完整。
 */
function traverseAndExtractCalls(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  symbols: ParsedSymbol[],
  calls: ParsedCall[],
  funcStack: string[] = [],
  depth: number = 0,
  /** ★ T-#61：**外层作用域的局部绑定** —— 嵌套具名函数要**继承**它（否则内层引外层参数就判不了） */
  outerScope: Set<string> = new Set(),
): void {
  if (depth > 200) return;
  if (isSymbolNode(node, lang)) {
    const { name, fromIndex } = resolveName(node, lang);
    if (name) {
      const qn = funcStack.length > 0 ? `${funcStack[funcStack.length - 1]}.${name}` : name;
      const kind = symbolKind(node, lang, funcStack.length > 0 ? funcStack[funcStack.length - 1] : undefined);
      const body = bodyChildren(node, lang, fromIndex);
      if (body) {
        funcStack.push(qn);
        // ★ T-#55：**本函数的参数进作用域** —— 引用参数不是符号（实测 resolve/reject/fn …）
        // ★ T-#59：**加上预扫的局部绑定**（`const fn = …` / 解构 / Go 的 `x := func(){}`）
        // ★ T-#61：**再加上外层作用域** —— 嵌套具名函数的体走的是本函数的递归，
        //   不继承外层的话，内层引用外层的 `probeName` 就判不了（实测 Go 剩下的 11 条）。
        const ownParams = new Set<string>([
          ...outerScope,
          ...paramsOf(node, lang.field_map.parameters || 'parameters', lang.name)
            .map((p) => p.name)
            .filter((n): n is string => !!n),
          ...collectLocalBindings(body, lang.name),
        ]);
        if (kind === 'function' || kind === 'method') {
          // 本函数体调用（跳过嵌套函数子树）
          for (const child of body) extractCallsFromBody(child, lang, qn, calls, symbols, depth + 1, ownParams);
        }
        // 继续递归找方法/嵌套函数（★ T-#61：把本层作用域传下去，嵌套函数要继承）
        for (const child of body) traverseAndExtractCalls(child, lang, symbols, calls, funcStack, depth + 1, ownParams);
        funcStack.pop();
      }
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    // 模块顶层调用（无包裹函数的脚本语言）：调用归属 `<module>`；只在不进函数体内时提取（函数内由 extractCallsFromBody 处理）
    // ★★★ T136（2026-10-15 修）：**不能只看"直接子节点是不是 call"** —— `const VALUE = usedTwo();`
    //   的直接子节点是**声明语句**，调用在它的**初始化器**里 ⇒ 那样写会漏掉**一切"表达式位置的顶层调用"**
    //   ⇒ `unused_export` 把 `usedTwo` 误报成"项目内无引用"（实测假阳：夹具 `C:/tmp/t136/ch_fix`
    //   `provider.ts:1 usedTwo`；唯一变量对照 `ch_ctl`——只把调用挪进函数体——就不报 ⇒ 归因确定）。
    //   ⇒ 改成走**子树**，复用 `extractCallsFromBody`：它开头就 `if (isSymbolNode(node, lang)) return;`
    //     ⇒ **嵌套函数/类子树里的调用仍归其自身**（由下面的符号支处理），不会被记成 `<module>` ⇒
    //     两支的分工不变、**不重复收集**；差别只在"同一个顶层语句里的调用能全被抓到"。
    //   ★ 数据驱动不变：仍是 `topLevelCall` 这个**开关**决定谁走这条支（不新造按语言 if）。
    if (LANG_ADAPTERS[lang.name]?.topLevelCall && funcStack.length === 0) {
      extractCallsFromBody(child, lang, '<module>', calls, symbols, depth + 1);
    }
    if (child) traverseAndExtractCalls(child, lang, symbols, calls, funcStack, depth + 1);
  }
}

// ─────────────────────────────────────────────────────────────
// 类型引用提取（TS 系 v1：type_identifier 节点 = 类型位置标识符）
// ─────────────────────────────────────────────────────────────

const TYPE_KINDS = new Set(['interface', 'type', 'class']);

/**
 * 遍历 AST 提取类型引用：TS 语法里类型位置的标识符是 type_identifier 节点
 * （参数注解 `: Foo`、泛型 `Array<Foo>`、`implements Bar`、`extends Baz`）。
 * 归属 = 包含它的最近符号（函数/方法/类）；定义处自身名字跳过（同行同名判定，
 * tree-sitter 绑定的节点对象身份不稳定，不能靠引用相等）。
 * Go/Python 的类型引用 AST 结构不同（qualified_type/identifier 混用），v1 不提取（返回空）。
 */
function traverseAndExtractTypeRefs(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  symbols: ParsedSymbol[],
  typeRefs: ParsedTypeRef[],
  stack: Array<{ qn: string; defName: string; defRow: number }> = [],
  depth: number = 0,
): void {
  if (depth > 200) return;
  if (isSymbolNode(node, lang)) {
    const name = resolveName(node, lang).name;
    if (name) {
      const parent = stack.length > 0 ? stack[stack.length - 1].qn : undefined;
      const qn = parent ? `${parent}.${name}` : name;
      stack.push({ qn, defName: name, defRow: node.startPosition.row });
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverseAndExtractTypeRefs(child, lang, symbols, typeRefs, stack, depth + 1);
      }
      stack.pop();
      return;
    }
  }
  // ★★★ 2026-10-27（T-#77）：**带点的类型引用要保留 receiver**（`http.ServerResponse` / `fs.Dirent`）。
  //
  // ## 病史（和 T-#75 的"事实丢失"同一种病）
  // 本函数原先只认 `type_identifier`（**裸名**）。而 `http.ServerResponse` 的 AST 是
  // `nested_type_identifier`（TS）/ `qualified_type`（Go）⇒ 遍历只看到**内层** `ServerResponse`
  // ⇒ **receiver `http` 丢了**。
  // 后果：解析器无法判"这是**外部包**的成员" ⇒ 只能靠 `BUILTIN_TYPES` 里硬堆
  //   `ServerResponse` / `IncomingMessage` / `Dirent` … 来猜（**那是补丁，不是结构**）。
  // ⇒ **能知道的 receiver 不该丢**。
  //
  // ## 修法
  // 命中带点的类型节点 ⇒ 记**全名**（`http.ServerResponse`），`resolved: false`（裸名查不到它）；
  // 交给 `resolveCrossFileCalls` 的**带点分支**（T-#50）判 —— 那里会看 receiver 是不是 package 命名空间
  // ⇒ 判出 `namespace-member-of-package:http` ⇒ **external（有据）**，不再靠表猜。
  // ★ 子节点不再处理（否则内层 `type_identifier` 会**重复记一条裸名**）。
  if (
    (node.type === 'nested_type_identifier' ||
      node.type === 'qualified_type' ||
      node.type === 'scoped_type_identifier') &&
    stack.length > 0
  ) {
    const top = stack[stack.length - 1];
    const text = node.text.replace(/\s+/g, '');
    const row = node.startPosition.row;
    if (text.includes('.') && text.length <= 120) {
      typeRefs.push({ referrer: top.qn, type_name: text, line: row + 1, resolved: false });
    }
    return; // 带点类型节点已消费，内层不再单独记
  }
  if (node.type === 'type_identifier' && stack.length > 0) {
    const top = stack[stack.length - 1];
    const text = node.text;
    const row = node.startPosition.row;
    // 跳过定义处：栈顶符号定义行上的同名标识符（如 `interface Foo {` 的 Foo）
    const isDefName = text === top.defName && row === top.defRow;
    if (!isDefName && isValidIdentifier(text)) {
      const sym = symbols.find((s) => s.name === text && TYPE_KINDS.has(s.kind));
      typeRefs.push({
        referrer: top.qn,
        type_name: text,
        line: row + 1,
        resolved: !!sym,
        target_qn: sym ? sym.qualified_name : undefined,
      });
    }
    return; // type_identifier 是叶子
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverseAndExtractTypeRefs(child, lang, symbols, typeRefs, stack, depth + 1);
  }
}

// ─────────────────────────────────────────────────────────────
// import 提取（逐语言）
// ─────────────────────────────────────────────────────────────

function stripQuotes(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.slice(1, -1);
  }
  return s;
}

/** TS/JS 家族语言名（判定 type-only 语法时用）→ ★ 2026-09-29 已下沉为表项数据
 *  （适配器 `erasedModuleStatements`），保留下面的注释只为解释这段知识的来历。 */

/**
 * 该模块语句（`import` / `export … from`）是否**运行时被整体擦除**（TS 系）——
 * 即"依赖图/闭包要不要算这条边"的唯一判据。【唯一实现】
 *
 * ★ 为什么这份判定必须收敛成一份（2026-09-28）：
 *   这条知识原先有**两份**逐字相同的实现 —— `kernel.ts`（喂 db / health / impact /
 *   import_project / dead_deps / harvest_closure / import_graph / project_root 的 `type_only`）
 *   与 `rename_symbol.ts`（自己的 import 边）。两份都只写了一条正则
 *   `/^\s*import\s+type\b/`，于是**同一个盲区在两处各存活一次**：
 *   `export type { A } from './x'` 同样被运行时擦除，却谁都不认 ——
 *   直到 health 报出 `dsl/types.ts:47 → dsl/contract.ts` 这条假违规才暴露。
 *   这正是本仓的病根形态（同一意图多份实现、修正不横向传播）⇒ 收敛到这里，两边共用。
 *
 * 覆盖 TS 全部「整条语句被擦除」的写法：
 *   · `import type { A } from 'x'` / `import type A from 'x'` / `import type * as ns from 'x'`
 *   · `export type { A } from 'x'` / `export type * from 'x'` / `export type * as ns from 'x'`
 *   · `import { type A, type B } from 'x'` —— 内联 type 且**全部**说明符都是 type
 *   · `export { type A as B } from 'x'`
 *
 * 反面（**不能**判 true —— 这些语句仍会产出运行时 import）：
 *   · `import { type A, B } from 'x'` —— 混有值绑定，模块会被真正加载
 *   · `import './x'`（副作用导入）、`import x from 'x'`、`export * from 'x'`
 *   · `import typeX from 'x'`（`\b` 保证 `typeX` 不被误判成 `type`）
 *
 * **适用边界**：只对**带模块源的语句**（`from '…'` 或 `import '…'`）有定义。
 *   没有源的语句不构成依赖边，判定其 true/false 对调用方都无意义 ⇒ 一律返回 false。
 *   例：`export type A = string;`（类型别名声明）虽然也在运行时被擦除，但它不 import 任何模块
 *   ⇒ 返回 false。这不是漏判，而是**把"擦除"与"依赖边擦除"两件事分开**——
 *   本函数的唯一用途是回答"这条边要不要算进依赖图"。
 *
 * 注：只吃**语句文本**，不依赖 AST 结构 —— 因为两份原实现都只有 node.text 可用，
 *     保持一致使本函数可脱离解析器单测（`tests/tools/type_only_statement.test.ts`）。
 */
export function isTypeOnlyModuleStatement(text: string): boolean {
  const t = text.trim();
  // 前置：必须构成依赖边（有模块源），否则本判定无定义
  if (!/\bfrom\s*['"`]/.test(t) && !/^import\s*['"`]/.test(t)) return false;
  // ① 关键字在语句上：`import type …` / `export type …`
  if (/^(?:import|export)\s+type\b/.test(t)) return true;
  // ② 内联 type 说明符：形如 `{ type A, type B }` ⇒ 全部说明符都带 `type` 才算擦除
  const m = t.match(/^(?:import|export)\s*\{([\s\S]*?)\}/);
  if (m) {
    const specs = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (specs.length === 0) return false;
    return specs.every((s) => /^type\s+\S/.test(s));
  }
  return false;
}

/**
 * ★★★ 2026-10-27（T-#86）：**import source 的常量折叠**（bounded static evaluator）。
 *
 * ## 为什么需要（我上一轮判错了）
 * 我曾把 `import(pathToFileURL(X).href)` 判成「**结构不可解**」——**错了**。
 * 实测那 5 条全是这种形态，且**都可静态算出**：
 *   `const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`
 *   `const STORAGE_JS = path.join(ROOT, 'dist', 'src', 'infrastructure', 'storage.js')`
 *   `await import(pathToFileURL(STORAGE_JS).href)`
 * ⇒ 我们有**文件绝对路径**（⇒ `import.meta.url` / `import.meta.dirname` 可算），
 *   而 `path.join` / `path.resolve` / `pathToFileURL` 的语义**简单且固定** ⇒ **能算**。
 *
 * ## 为什么 LSP/tsc 帮不上
 * TS 的模块解析要求 specifier 是**字符串字面量**；`import(expr)` 是运行期值 ⇒ tsc **不解析**。
 * ⇒ 这件事只能我们自己做（而我们恰好有 tsc 没有的：**明确的文件路径 + 项目根**）。
 *
 * ## 边界（**算不出来就诚实返回 null**，不猜）
 * 支持：字符串/模板字面量 · 同文件 `const` 折叠 · `import.meta.url` / `.dirname` / `.filename`
 *      · `path.join` / `path.resolve` / `path.dirname` / `path.basename`
 *      · `fileURLToPath(x)` / `pathToFileURL(x)`（含 `.href`）· `new URL(x, base)`
 * 不支持（⇒ 保持 `computed`）：`process.env.*` · 函数调用结果 · 正则 replace · 动态拼接
 */

/**
 * ★★★ 2026-10-27（T-#87）：**通用求值兜底** —— `vm` 沙箱（不是手写规则）。
 *
 * ## 为什么需要（T-#86 的折叠器"不够通用"）
 * T-#86 手写了 `path.join` / `pathToFileURL` / `new URL` / 一个 replace idiom ——
 * **认一个 API 就得加一条 if**，遇到 `os.homedir()` / `[a,b].join('/')` / 任意 `.replace` 就漏。
 * 那是**打补丁的形状**，不是结构。
 *
 * ## 通用解：把表达式交给 `vm` 真求值
 * 我们有 `node.text`（**原文**）⇒ 直接 `vm.runInNewContext(expr)`。
 * 沙箱里放的是**真的 `node:path` / `node:url`** ⇒ **语义精确，不是近似**。
 * ★ 这是 Node 内置能力 ⇒ **零新依赖**（对比 Babel `path.evaluate()`：要引入**第二套 parser**，
 *   而我们已有 tree-sitter ⇒ 双解析的代价不值得）。
 *
 * ## 安全边界（必读 —— `vm` 官方说它**不是**安全沙箱）
 * 威胁模型：求值的是**被分析项目的源码**，可能不可信。因此：
 *   · 沙箱**只给白名单**：`path` / `url` / `URL` / `importMeta` + 已折叠的 const
 *     ⇒ **没有 `process` / `require` / `fs` / 网络**
 *   · `contextCodeGeneration: { strings: false, wasm: false }` ⇒ **禁掉 `new Function` / `eval`**
 *     ⇒ 挡住经典逃逸链 `this.constructor.constructor('return process')()`
 *   · `timeout: 50ms` ⇒ 挡住 `while(true)`
 *   · 只接受**字符串结果**（或带 `.href` 的对象）⇒ 不把任意对象带回
 * ★ 若将来要跑**完全不可信**的代码，应改用独立进程 + seccomp/容器 —— `vm` 不够。
 *   当前场景（分析本仓/用户自己的仓库）用 `vm` + 上述三道闸是合适的。
 */
/**
 * ★★★ 2026-10-27（T-#88）：**纯同步表达式判据 —— 用 AST 节点类型，不用正则**。
 *
 * ## 为什么换掉正则（上一版的副作用）
 * T-#87 用 `/await|yield|function|=>|;/` 过滤文本。**副作用**：
 *   `import(path.join(R, 'await/x.js'))` —— 字符串字面量里含 `await` ⇒ **被误杀**。
 *   同理目录名带 `function`、文件名带 `=>` 都会误杀。**文本判据不认结构**。
 *
 * ## 正解：AST 递归白名单
 * 我们**已经有 AST** ⇒ 判"是不是纯同步表达式"应该看**节点类型**：
 *   · 白名单：字面量 / 标识符 / 成员 / 调用 / new / 二元 / 三元 / 数组 / 下标 / 括号 / 模板
 *   · 黑名单（出现即拒）：`await_expression` · `yield_expression` ·
 *     `function*` / `arrow_function` / `function_expression` · `assignment_expression` ·
 *     `sequence_expression` · `statement_block`
 * ⇒ **字符串字面量里的 `await` 不会被误判**（它是 `string` 节点，白名单直接收）。
 *
 * ## 为什么这次"按类型判"是对的（与 T-#71/T-#86 的教训不矛盾）
 * 那两次错在**拿类型猜 grammar 的细节**（`import.meta` 是哪种节点、`function` 字段在不在）。
 * 这里判的是**语义类别**（"有没有 await/函数"），而 `await_expression` 这类节点
 * **在所有 tree-sitter JS/TS grammar 里都叫这个名字** ⇒ 稳定。
 * ★ 若将来某 grammar 用别的名字，**表现为"白名单外 ⇒ 拒绝"**（安全方向，不会误求值）。
 */
const PURE_EXPR_NODES = new Set([
  'string', 'template_string', 'number', 'true', 'false', 'null', 'undefined',
  'identifier', 'property_identifier', 'this',
  'member_expression', 'subscript_expression', 'call_expression', 'new_expression',
  'binary_expression', 'unary_expression', 'ternary_expression', 'parenthesized_expression',
  'array', 'object', 'template_substitution', 'regex',
  // ★ T-#88 修：**`arguments` 必须收** —— 否则 `PARTS.join('/')` 这种调用**整条被拒**
  //   （实测：漏了它 ⇒ vm 那一档完全不起作用，`computed` 一条都降不下来）。
  'arguments',
]);

/** ★ T-#88：**字面量节点** —— 按叶子处理（它们在 tree-sitter 里有 `*_fragment` 子节点，不能递归） */
const LITERAL_NODES = new Set(['string', 'template_string', 'number', 'true', 'false', 'null', 'undefined', 'regex']);

/** 纯同步表达式？（递归判子树；白名单外一律拒绝 —— 安全方向） */
function isPureSyncExpr(node: SyntaxNodeLike | null, depth = 0): boolean {
  if (!node) return false;
  if (depth > 40) return false; // 防御：异常深的表达式不求值
  if (!PURE_EXPR_NODES.has(node.type)) return false;
  // ★★★ T-#88 **实测踩到的坑**：字面量在 tree-sitter 里**不是叶子** ——
  //   `string` 有 `string_fragment` 子节点、`template_string` 有 `template_chars`…
  //   这些子节点不在白名单 ⇒ 递归时整条被拒 ⇒ **vm 那一档从没生效**。
  //   ⇒ 字面量按**叶子**处理，不递归。
  if (LITERAL_NODES.has(node.type)) return true;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    // 标点/token 子节点（`(` `)` `,` `.` 等）不是表达式 ⇒ 跳过
    if (!PURE_EXPR_NODES.has(c.type) && !/^[()\[\]{},.:?]$/.test(c.text)) return false;
    if (PURE_EXPR_NODES.has(c.type) && !isPureSyncExpr(c, depth + 1)) return false;
  }
  return true;
}

/**
 * ★★★ 2026-10-27（T-#87/T-#88）：**通用求值（可选档）** —— `vm` 沙箱。
 *
 * ## 默认**关闭**（寄风的判断，2026-10-27 —— 已用 A/B 实测确认）
 * 「vm 求值这部分有必要吗 —— 未来整个开发区会整沙箱，那时安全问题归外层」
 *
 * **A/B 实测（同一次全量重建，两档对照）**：
 *   · vm 关：**64.8s** · `computed` **54** · failed 5 · edges 13856
 *   · vm 开：**77.7s** · `computed` **52** · failed 5 · edges 13856
 *   ⇒ 边际收益 **2 条 / 14000 = 0.014%**，代价 **+12.9s（+20%）**
 * ⇒ **常开不值**。改成**可选档**：
 *   · 默认：只用内置折叠（快、零安全面）
 *   · `AGENT_IO_EVAL_VM=1` 时：额外启用本函数（**在已沙箱化的环境里**用，安全归外层）
 * ★ 这样"通用性"是可插拔的，而不是用**每个项目都付 20% 重建时间**换 0.014%。
 * ★ 若将来外层沙箱化后 vm 变成"免费"，把默认值翻过来即可（一处改）。
 *
 * ## 安全边界（仍保留，纵深防御）
 * 白名单沙箱（无 `process`/`require`/`fs`）· 禁代码生成（挡 `constructor.constructor` 逃逸）
 * · `timeout: 50ms`（挡死循环）· **`isPureSyncExpr` AST 判据**（挡 await/函数/赋值）。
 */
function vmEvalEnabled(): boolean {
  return process.env.AGENT_IO_EVAL_VM === '1';
}

function vmFoldExpr(node: SyntaxNodeLike, consts: Map<string, unknown>, filePath: string): unknown {
  if (!vmEvalEnabled()) return null;
  // ★ T-#88：**AST 判据替代正则** —— 只求值纯同步表达式（`await`/函数/赋值一律拒绝）。
  if (!isPureSyncExpr(node)) return null;
  const exprText = node.text;
  const abs = filePath.replace(/\\/g, '/');
  const dir = abs.slice(0, abs.lastIndexOf('/')) || '/';
  const sandbox: Record<string, unknown> = {
    path,
    url: { pathToFileURL: nodePathToFileURL, fileURLToPath: nodeFileURLToPath },
    URL,
    // ★★★ T-#88 **实测踩到的关键坑**：源码里是**裸名**（`import { fileURLToPath } from 'node:url'`），
    //   而我只把它们放在 `url.` 下面 ⇒ 沙箱里 `fileURLToPath(...)` 报
    //   `ReferenceError: fileURLToPath is not defined` ⇒ 被 catch 吞掉 ⇒ **vm 那一档从没真正生效过**
    //   （`computed` 一条都没降，而我误以为是"表达式太复杂"）。
    //   ⇒ 命名导入必须**同时**给顶层裸名。
    pathToFileURL: nodePathToFileURL,
    fileURLToPath: nodeFileURLToPath,
    // `import.meta` 不是合法标识符 ⇒ 源码里替换成 `importMeta` 再注入
    importMeta: { url: `file:///${abs}`, filename: abs, dirname: dir },
  };
  for (const [k, v] of consts) sandbox[k] = v;
  const code = `(() => { const import_meta = importMeta; return (${exprText.replace(/\bimport\.meta\b/g, 'import_meta')}); })()`;
  try {
    const out = vm.runInNewContext(code, sandbox, {
      timeout: 50,
      contextCodeGeneration: { strings: false, wasm: false },
    });
    if (typeof out === 'string') return out.replace(/\\/g, '/');
    const href = (out as { href?: unknown } | null)?.href;
    if (typeof href === 'string') return href.replace(/\\/g, '/');
    // ★ T-#87：**任意值都返回**（数组/对象也要）—— 常量表要能存 `['a','b']`，
    //   否则 `const P = PARTS.join('/')` 这类依赖数组的常量永远算不出。
    if (out === undefined || typeof out === 'function') return null;
    return out;
  } catch {
    return null; // 算不出（有副作用 / 用了白名单外的 API / 超时）⇒ 诚实返回 null
  }
}

/** 折叠结果：绝对路径（posix 分隔）或 null（算不出来） */
function foldToPath(node: SyntaxNodeLike | null, consts: Map<string, unknown>, filePath: string): string | null {
  if (!node) return null;
  const t = node.type;
  // ── 字面量
  if (t === 'string' || t === 'template_string') {
    const raw = node.text.replace(/^['"`]|['"`]$/g, '');
    return raw.includes('${') ? null : raw; // 有插值 ⇒ 不猜
  }
  // ── 标识符 ⇒ 查同文件 const 折叠表（★ 表里可能是数组/对象 ⇒ 只取字符串）
  if (t === 'identifier') {
    const v = consts.get(node.text);
    return typeof v === 'string' ? v : null;
  }
  // ── import.meta.url / .dirname / .filename
  if (t === 'member_expression') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('property');
    // ★ T-#86 修：`import.meta` 在 tree-sitter-javascript 里是 **`member_expression`**（不是 `meta_property`）
    //   实测 dump：`member_expression «import.meta.url»` → `member_expression «import.meta»`。
    //   ⇒ 判据**看文本不看类型**（跨 grammar 稳定，同 T-#71 的教训）。
    if (obj && obj.text.replace(/\s+/g, '') === 'import.meta' && prop) {
      const abs = filePath.replace(/\\/g, '/');
      if (prop.text === 'url') return `file:///${abs}`;
      if (prop.text === 'filename') return abs;
      if (prop.text === 'dirname') return abs.slice(0, abs.lastIndexOf('/')) || '/';
      return null;
    }
    // `pathToFileURL(X).href` ⇒ 语义 = `file://` + X
    if (prop?.text === 'href' && obj && obj.type === 'call_expression') {
      const inner = foldCall(obj, consts, filePath);
      if (inner && 'kind' in inner && inner.kind === 'fileurl') return `file://${inner.path}`;
      return null;
    }
    return null;
  }
  // ── ★★★ T-#91：**字符串拼接 `+`**（实测占 computed 的 23/54，最大的一类）
  //   形态：`'file://' + REPO.replace(/\\/g, '/') + '/dist/src/x.js'`
  //   原先 `foldToPath` 只认字面量/标识符/调用/成员 ⇒ `binary_expression` 直接落 null
  //   ⇒ 整条链断（连 `REPO` 已经折叠好了也没用）。这是**我们没做**，不是"算不出"。
  if (t === 'binary_expression') {
    const l = node.childForFieldName('left');
    const r = node.childForFieldName('right');
    // 只处理 `+`（`==`/`&&` 等不是路径拼接）
    if (l && r && node.text.includes('+')) {
      const lv = foldToPath(l, consts, filePath);
      const rv = foldToPath(r, consts, filePath);
      if (lv !== null && rv !== null) return lv + rv;
    }
    return null;
  }
  // ── 调用
  if (t === 'call_expression') {
    const r = foldCall(node, consts, filePath);
    return r ? r.path : null;
  }
  // ── new URL(x, base)
  if (t === 'new_expression') {
    const ctor = node.childForFieldName('constructor');
    const args = node.childForFieldName('arguments');
    if (ctor?.text === 'URL' && args) {
      const parts: Array<SyntaxNodeLike | null> = [];
      for (let i = 0; i < args.childCount; i++) {
        const c = args.child(i);
        if (c && c.type !== '(' && c.type !== ')' && c.type !== ',') parts.push(c);
      }
      const a = foldToPath(parts[0] ?? null, consts, filePath);
      if (a === null) return null;
      if (parts.length < 2) return a;
      const b = foldToPath(parts[1], consts, filePath);
      if (b === null) return null;
      // base 是 file://…/dir/ ⇒ 拼接
      const basePath = b.replace(/^file:\/\//, '');
      return basePath.endsWith('/') ? `${basePath}${a}` : `${basePath.slice(0, basePath.lastIndexOf('/') + 1)}${a}`;
    }
    return null;
  }
  return null;
}

/** 调用的折叠（返回 `{path}` 或 `{kind:'fileurl', path}`；算不出 ⇒ null） */
function foldCall(
  node: SyntaxNodeLike,
  consts: Map<string, unknown>,
  filePath: string,
): { path: string } | { kind: 'fileurl'; path: string } | null {
  const fn = node.childForFieldName('function');
  const args = node.childForFieldName('arguments');
  if (!fn || !args) return null;
  const argsList: SyntaxNodeLike[] = [];
  for (let i = 0; i < args.childCount; i++) {
    const c = args.child(i);
    if (c && c.type !== '(' && c.type !== ')' && c.type !== ',') argsList.push(c);
  }
  const foldAll = (): string[] | null => {
    const out: string[] = [];
    for (const a of argsList) {
      const v = foldToPath(a, consts, filePath);
      if (v === null) return null;
      out.push(v);
    }
    return out;
  };
  const joinPosix = (segs: string[]): string => {
    const parts: string[] = [];
    for (const s of segs) {
      for (const p of s.replace(/\\/g, '/').split('/')) {
        if (!p || p === '.') continue;
        if (p === '..') parts.pop();
        else parts.push(p);
      }
    }
    return '/' + parts.join('/');
  };
  // `path.join(...)` / `path.resolve(...)`
  if (fn.type === 'member_expression') {
    const obj = fn.childForFieldName('object');
    const prop = fn.childForFieldName('property');
    // ★ T-#86：**ESM 的"取父目录"idiom** —— `X.replace(/[\\/][^\\/]+$/, '')`。
    //   语义明确（去掉最后一段路径）⇒ 等价于 `dirname(X)`，**不是**盲求值。
    //   实测来源：`const REPO = import.meta.dirname.replace(/[\\/][^\\/]+$/, '')`（certs/t357）。
    if (prop?.text === 'replace' && obj && argsList.length >= 1) {
      const rx = argsList[0].text;
      const empty = argsList.length >= 2 && /^(['"])\1$/.test(argsList[1].text.trim());
      if (empty && /\[\\\\?\/\]\[\^\\\\?\/\]\+\$/.test(rx)) {
        const base = foldToPath(obj, consts, filePath);
        if (base) {
          const s = base.replace(/\/+$/, '');
          return { path: s.slice(0, s.lastIndexOf('/')) || '/' };
        }
      }
      // ★★★ T-#91：**通用「反斜杠归一」** —— `X.replace(/\\/g, '/')`（Windows 路径转 posix）。
      //   实测这是 `'file://' + REPO.replace(/\\/g, '/') + '…'` 那 23 条里的必经一环。
      //   语义明确（把 `\` 换成 `/`）⇒ 不是盲求值。
      const toSlash = argsList.length >= 2 && /^(['"])\/\1$/.test(argsList[1].text.trim());
      if (toSlash && /^\/\\\\\/g$|^\/\\\\\/$|^\/\\\\\/g[uimsy]*$/.test(rx.trim())) {
        const base = foldToPath(obj, consts, filePath);
        if (base) return { path: base.replace(/\\/g, '/') };
      }
      return null;
    }
    if (obj?.text === 'path' && prop) {
      const vals = foldAll();
      if (!vals) return null;
      if (prop.text === 'join' || prop.text === 'resolve') return { path: joinPosix(vals) };
      if (prop.text === 'dirname' && vals[0]) {
        const s = vals[0].replace(/\/+$/, '');
        return { path: s.slice(0, s.lastIndexOf('/')) || '/' };
      }
      if (prop.text === 'basename' && vals[0]) {
        const s = vals[0].replace(/\/+$/, '');
        return { path: s.slice(s.lastIndexOf('/') + 1) };
      }
      return null;
    }
    return null;
  }
  // `fileURLToPath(x)` ⇒ 去 `file://`
  if (fn.type === 'identifier' && fn.text === 'fileURLToPath') {
    const vals = foldAll();
    if (!vals || !vals[0]) return null;
    return { path: vals[0].replace(/^file:\/\//, '') };
  }
  // `pathToFileURL(x)` ⇒ 标成 fileurl（外层 `.href` 或直接当路径用）
  if (fn.type === 'identifier' && fn.text === 'pathToFileURL') {
    const vals = foldAll();
    if (!vals || !vals[0]) return null;
    return { kind: 'fileurl', path: vals[0] };
  }
  return null;
}

/** 预扫：同文件 `const X = <可折叠表达式>` ⇒ `X → 折叠值`（两趟，处理 const 之间的依赖） */
function buildConstStringMap(root: SyntaxNodeLike, filePath: string): Map<string, unknown> {
  const consts = new Map<string, unknown>();
  const decls: Array<{ name: string; value: SyntaxNodeLike }> = [];
  const walk = (n: SyntaxNodeLike, depth: number): void => {
    if (depth > 200) return;
    if (n.type === 'variable_declarator') {
      const nm = n.childForFieldName('name');
      const v = n.childForFieldName('value');
      if (nm?.type === 'identifier' && v) decls.push({ name: nm.text, value: v });
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  // 两趟：第一趟可能因依赖顺序折叠不出来，第二趟补上
  // ★ T-#87：**常量表本身也走策略链**（① 内置折叠 ⇒ ② `vm` 兜底）。
  //   否则 `const P = PARTS.join('/')` 这类内置算不出的常量会**留在表外**
  //   ⇒ 下游 `path.join(HERE, '..', P)` 在沙箱里拿不到 `P` ⇒ 整条链断。
  for (let pass = 0; pass < 2; pass++) {
    for (const d of decls) {
      if (consts.has(d.name)) continue;
      let v = foldToPath(d.value, consts, filePath);
      if (v === null) v = vmFoldExpr(d.value, consts, filePath) as string | null;
      if (v !== null) consts.set(d.name, v);
    }
  }
  return consts;
}

function traverseAndExtractImports(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  imports: ParsedImport[],
  depth: number = 0,
  /** ★ T-#86：常量折叠上下文（算得出就变成真 source，算不出保持 computed） */
  foldCtx?: { filePath: string; consts: Map<string, unknown> },
): void {
  if (depth > 100 || !lang.import_nodes || lang.import_nodes.length === 0) return;
  // ★★★ 2026-10-27（T-#64）：**动态 import 也是一等公民**（这是 `parseFileFull` 走的路径）。
  //
  // ## 病史（结构性）
  // `imports.kind` 只有 `relative` / `package` —— 这两者描述的是 **source 的形态**，
  // **不是"静态/动态"** ⇒ 动态 import **本该也能记进来**，却**从来没被抽过**
  // （`lang.import_nodes` 只含 `import_statement` 之类，`await import('x')` 是 `call_expression`）。
  // 后果：`const { saveDSL } = await import('../../dist/src/storage.js')` 的 `saveDSL`
  // 在索引里**没有绑定** ⇒ 裸名解析判 `boundByName=false` ⇒ **永远 failed**（实测 12 条）。
  //
  // ## 当时的绕法（本次删掉）
  // `symbols.dynamicImportsOf()` —— 一个**事后文本正则扫描**，脆且**与索引两套尺**。
  //
  // ## 现在
  // 在解析期就记一行 ⇒ **同一张绑定表**（`relImportsByFile` / `relBindingsByFile`）
  // 同时服务静态与动态导入。
  // ★★★ 2026-10-27（T-#75）：**`import(…)` 与 `require(…)` 是同一类**（模块引用，只是语法不同）。
  //
  // ## 为什么必须修（寄风的判据）
  // 「**收益不看条数，看问题种类数**」——
  // 本仓只有 ~3 条真 CJS `require`，但**真实 JS 项目里 CJS 是主流形态**
  // （Node 生态大量 `const x = require('y')`）⇒ 这是**类级盲区**，不是 3 条个案。
  // 按"当前项目条数"判会把它永远押后 ⇒ **换个项目就大面积漏**。
  //
  // ## 判据
  // 被调方是 `import` **或** `require` 的调用 ⇒ 都是模块引用：
  //   `import('x')` / `require('x')` / `const { a } = require('x')` / `const x = require('x')`
  // ⇒ 抽成一条 `ParsedImport`（kind 按 source 形态归），与 ES `import` **进同一张绑定表**。
  //
  // ## 与 T-#72 的关系
  // T-#72 修的是「`export_statement` 短路导致本块走不到」；本块本身负责"看见就记"。
  // 两者缺一不可：`export function f() { const x = require('y') }` 需要两个都修好。
  if (node.type === 'call_expression' || node.type === 'import_expression' || node.type === 'dynamic_import') {
    const fnNode = node.childForFieldName('function') ?? (node.childCount > 0 ? node.child(0) : null);
    const isModuleRef =
      node.type !== 'call_expression' ||
      (!!fnNode && (fnNode.type === 'import' || fnNode.type === 'require' || fnNode.text === 'import' || fnNode.text === 'require'));
    if (isModuleRef) {
      const args =
        node.childForFieldName('arguments') ??
        node.childForFieldName('argument') ??
        (node.childCount > 0 ? node.child(node.childCount - 1) : null);
      // ★ 取第一个**非括号**子节点 —— `arguments` 的 children 里含 `(` / `)` / `,` token
      //   （实测拿 `child(0)` 会得到 `(` ⇒ source 变成 `(`，绑定对但路径错）
      let srcNode: SyntaxNodeLike | null = null;
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const c = args.child(i);
          if (!c) continue;
          if (c.type === '(' || c.type === ')' || c.type === ',') continue;
          srcNode = c;
          break;
        }
      }
      // ★★★ 2026-10-27（T-#76）：**计算路径的 import 也要记 —— 记事实，标不可解析**。
      //
      // ## 病史（T-#75 的取舍失误）
      // 上一版对「source 不是字面量」的 import **整行丢掉** ⇒ 包括
      //   `const { saveDSL } = await import(pathToFileURL(STORAGE_JS).href)`
      // 这类**真实的依赖事实**。丢掉的后果：
      //   · `relBindingsByFile` 不知道 `saveDSL` 是导入绑定
      //   · `dep_edges` / `dead_deps` / `impact_analysis` **少一条依赖边**
      //   · 「谁动态加载了模块」这类查询**查不到它**
      // ⇒ **能知道的事实不该因为"source 解析不了"而丢**。
      //
      // ## 正确做法（两件事分开）
      //   · **source 解析不了** ⇒ `kind: 'computed'`（有依赖事实、路径是算出来的）
      //   · **绑定是真的** ⇒ 照常写 `bindings`
      //   ⇒ `relImportsByFile` 只收 `kind='relative'` ⇒ **computed 不进跨文件查找**
      //     （不制造假解析），但 **imports 表里有这一行**（依赖事实保留）。
      const isLiteralSrc =
        !!srcNode && (srcNode.type === 'string' || srcNode.type === 'template_string' || /string/.test(srcNode.type));
      const rawSrc = srcNode ? srcNode.text.replace(/^['"`]|['"`]$/g, '') : '';
      // ★★★ T-#86：**非字面量 ⇒ 试常量折叠**（`import(pathToFileURL(path.join(ROOT, 'dist/x.js')).href)`）。
      //   算得出 ⇒ 变成**真正的相对路径**（kind 按相对路径归）⇒ 后续正常解析；
      //   算不出 ⇒ 保持 `computed`（**诚实**：有依赖事实、但路径拿不到）。
      //   ★ 折叠出的是**绝对路径** ⇒ 转成相对本文件目录的形式（`./` / `../`）。
      let foldedRel: string | null = null;
      if (!isLiteralSrc && srcNode && foldCtx) {
        // ★ T-#86 修：`pathToFileURL(X).href` 折叠出的是 **`file:///abs`（URL）**，不是路径
        //   ⇒ 先剥 `file://` 再算相对（否则 `startsWith('/')` 判不过 ⇒ 又落回 computed）。
        // ★ T-#87：**策略链** —— ① 内置折叠（快、纯静态、零风险）⇒ ② `vm` 沙箱（通用）
        //   ⇒ 「认一个 API 加一条 if」不再是唯一出路；未知 API 交给通用求值。
        let rawFolded = foldToPath(srcNode, foldCtx.consts, foldCtx.filePath);
        if (rawFolded === null) {
          const vmOut = vmFoldExpr(srcNode, foldCtx.consts, foldCtx.filePath);
          if (typeof vmOut === 'string') rawFolded = vmOut;
          else if (typeof (vmOut as { href?: unknown } | null)?.href === 'string')
            rawFolded = (vmOut as { href: string }).href;
        }
        const abs = rawFolded ? rawFolded.replace(/^file:\/\//, '') : null;
        if (abs && abs.startsWith('/')) {
          const fromDir = foldCtx.filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
          const a = abs.split('/').filter(Boolean);
          const b = fromDir.split('/').filter(Boolean);
          let i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          const ups = b.length - i;
          const tail = a.slice(i).join('/');
          foldedRel = ups === 0 ? `./${tail}` : `${'../'.repeat(ups)}${tail}`;
        }
      }
      const src = foldedRel ?? (isLiteralSrc ? rawSrc : srcNode ? srcNode.text.replace(/\s+/g, ' ').slice(0, 200) : '');
      if (src) {
        // 绑定名：`const { a, b } = await import(…)` ⇒ 解构里的名字
        const bindings: string[] = [];
        let p = node.parent;
        if (p && p.type === 'await_expression') p = p.parent;
        if (p && p.type === 'variable_declarator') {
          const nm = p.childForFieldName('name');
          // ★★★ T-#89：**解构里的别名要记 `remote as local`**（同 T-#85 的静态 import）。
          //   病史：`const { editCode: ec } = await import('…'); await ec(…)`
          //   ⇒ 原先 `collect` 把 `editCode` 和 `ec` **两个都当独立绑定**
          //     ⇒ 去目标文件找 `ec` ⇒ 找不到 ⇒ 永远 failed（实测 2 条）。
          //   ⇒ `pair_pattern`（`editCode: ec`）要出 `editCode as ec`。
          const collect = (x: SyntaxNodeLike): void => {
            if (x.type === 'pair_pattern') {
              const k = x.childForFieldName('key');
              const v = x.childForFieldName('value');
              if (k?.type === 'property_identifier' && v?.type.includes('identifier') && isValidIdentifier(v.text)) {
                bindings.push(`${k.text} as ${v.text}`);
                return;
              }
            }
            if (x.type.includes('identifier') || x.type === 'shorthand_property_identifier_pattern') {
              if (isValidIdentifier(x.text)) bindings.push(x.text);
              return;
            }
            for (let k = 0; k < x.childCount; k++) {
              const c = x.child(k);
              if (c) collect(c);
            }
          };
          if (nm) collect(nm);
        }
        imports.push({
          source: src,
          // ★ 字面量或**折叠成功** ⇒ 按 source 形态归；**算出来 ⇒ 'computed'**（有事实，路径拿不到）
          kind: isLiteralSrc || foldedRel ? (src.startsWith('.') ? 'relative' : 'package') : 'computed',
          line: node.startPosition.row + 1,
          ...(bindings.length > 0 ? { bindings } : {}),
        });
      }
    }
    // ★ 不 return：参数里还可能有嵌套调用/引用
  }
  if (lang.import_nodes.includes(node.type)) {
    const sources = extractImportSources(node, lang.name);
    // TS 系 type-only 语句（`import type` / `export type` / 全 type 内联说明符）运行时擦除
    // ⇒ 标记 type_only，依赖图/闭包不算边。判定收敛在 isTypeOnlyModuleStatement（唯一实现）；
    // 「哪些语言有这套语法」由适配器 erasedModuleStatements 声明（替代原先的 TS_FAMILY_LANGS Set）。
    const typeOnly = LANG_ADAPTERS[lang.name]?.erasedModuleStatements === true && isTypeOnlyModuleStatement(node.text);
    const bindings = extractImportBindings(node, lang.name, sources.values);
    for (const src of sources.values) {
      imports.push({
        source: src,
        kind: src.startsWith('.') ? 'relative' : 'package',
        line: node.startPosition.row + 1,
        // ★ 2026-10-20：整句 span（见 ParsedImport.start_index 的说明）
        ...(node.startIndex !== undefined && node.endIndex !== undefined
          ? { start_index: node.startIndex, end_index: node.endIndex }
          : {}),
        ...(typeOnly ? { type_only: true } : {}),
        ...(bindings.values.length > 0 ? { bindings: bindings.values } : {}),
        // ★ 2026-10-21：判据来源（只有做了 AST/正则区分的语言才有）
        ...(sources.via ? { source_via: sources.via } : {}),
        ...(bindings.via ? { bindings_via: bindings.via } : {}),
      });
    }
    // ★★★ 2026-10-27（T-#72）：**`export_statement` 带 declaration 时必须继续递归**。
    //
    // ## 根因（T-#70/T-#71 都没查出来的那个）
    // `typescript.import_nodes = ['import_statement', 'export_statement']`
    // —— 收 `export_statement` 是为了 `export { x } from 'y'`（**有 source**）。
    // 但 **`export async function f() { … }` 也是 `export_statement`** ⇒ 原先无条件 `return`
    // ⇒ **整个函数体被跳过** ⇒ 函数体内的 `await import(…)` **永远看不到**。
    //
    // ## 为什么 `.mjs` 一直正常
    // `certs/*.mjs` 的动态 import 在**模块顶层**（`const { saveDSL } = await import(…)`），
    // 不在任何 `export_statement` 里 ⇒ 遍历走到它 ⇒ 能抽到。
    // ⇒ 这正好解释了「同一函数、同一次遍历，静态的抽到了、动态的连块都没进」的自相矛盾。
    //
    // ## 判据
    // 命中 `import_nodes` **但没有抽出任何 source**、且带 `declaration` 子节点
    // ⇒ 它是「导出声明」（不是导出语句）⇒ **必须继续递归**。
    const hasDecl = !!node.childForFieldName('declaration');
    if (sources.values.length === 0 && hasDecl) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) traverseAndExtractImports(child, lang, imports, depth + 1, foldCtx);
      }
    }
    return; // 真正的 import / 再导出语句内部不再递归
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverseAndExtractImports(child, lang, imports, depth + 1, foldCtx);
  }
}

// ─────────────────────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 大文件解析：node-tree-sitter 的 parse(string) 在内容 ≥ 32768 字符时
// 抛 "Invalid argument"（内部 UTF-16 缓冲限制）。规避方式：
// 改用 callback 输入（parse((byteOffset) => string)）。
//
// 编码语义（实测 + node_modules/tree-sitter/src/parser.cc）：
//   parser 以 UTF-16 编码读取，callback 收到的 offset 就是 UTF-16 码元索引，
//   可直接作为 JS 字符串索引（代理对占 2 码元，与 JS string 一致，天然对齐）。
// ─────────────────────────────────────────────────────────────

/** 字符串 parse 的字符数上限（node-tree-sitter 限制 2^15） */
const STRING_PARSE_LIMIT = 32768;
/** callback 每次返回的块大小（字符数，避免 O(n²) 全量返回） */
const CALLBACK_CHUNK = 8192;

interface TreeLike {
  rootNode: SyntaxNodeLike;
}
type ParserLike = { parse: (input: string | ((byteOffset: number) => string)) => TreeLike };

/** 用 callback 方式解析（规避 32KB 限制；offset 即 UTF-16 码元索引） */
function parseViaCallback(parser: ParserLike, content: string): TreeLike {
  const len = content.length;
  return parser.parse((offset: number): string => {
    const lo = Math.min(offset, len);
    if (lo >= len) return '';
    let end = Math.min(lo + CALLBACK_CHUNK, len);
    // 不在代理对中间截断（高代理结尾则少送一个字符）
    if (end < len) {
      const tail = content.charCodeAt(end - 1);
      if (tail >= 0xd800 && tail <= 0xdbff) end--;
    }
    return content.slice(lo, end);
  });
}

/** 统一 parse 入口：小文件走快速 string 路径，大文件走 callback 路径。
 *  导出供 ts_slim 等工具复用——剪刀直接 parser.parse(string) 会踩
 *  node-tree-sitter 的 2^15 字符上限（EINVAL，directory.ts 37K 实证）。 */
export function parseContent(parser: ParserLike, content: string): TreeLike {
  if (content.length < STRING_PARSE_LIMIT) {
    return parser.parse(content);
  }
  return parseViaCallback(parser, content);
}

/**
 * AST 级解析入口：供控制流（CFG）等结构化分析使用。
 * 与 parseFileFull 同一 parse 管线（含 32KB callback 规避），失败返回 null。
 */
/**
 * ★★ 2026-10-08 新增：`parseAstRoot` 的**同步孪生**。
 *
 * 为什么需要它（这是「删除侧从文本判据升到 AST」缺的那一块）：
 *   本仓有两条消费 AST 的路径 ——
 *     · **报告口径**（`health`）走 async，随便 await；
 *     · **删除决策**（`deadcode/detect_dead_imports`）处在 **sync** 上下文里
 *       （改 async 会往 `buildFeatureMap` 等同步调用方**蔓延**）。
 *   此前**只有 async 入口** ⇒ 删除侧只能退回**文本判据**（`qualifierLines`）。
 *
 * 前置：Parser 已预热。`prewarmKernel()` 自 2026-10-08 起已在**唯一调用入口**接上
 *   （此前那句「进程启动预热」只写在注释里、没人调 ⇒ 本函数会恒返回 null）。
 *
 * ★ 未预热 / 语言不认识 / 解析抛错 ⇒ **返回 null**。
 *   调用方**必须按「看不懂」保守处理**（当作「活」），**绝不当作「无引用」** —— 那是会删错的方向。
 */
export function parseAstRootSync(
  filePath: string,
  content: string,
): { root: SyntaxNodeLike; langName: string } | null {
  const ext = path.extname(filePath);
  const lang = findLanguageByExt(ext);
  if (!lang) return null;
  const parser = getParserSync(ext);
  if (!parser) return null;
  try {
    const tree = parseContent(parser as ParserLike, content);
    return { root: tree.rootNode, langName: lang.name };
  } catch {
    return null;
  }
}

export async function parseAstRoot(
  filePath: string,
  content: string,
): Promise<{ root: SyntaxNodeLike; langName: string } | null> {
  const ext = path.extname(filePath);
  const lang = findLanguageByExt(ext);
  if (!lang) return null;
  const parser = await getParser(ext, lang);
  if (!parser) return null;
  try {
    const tree = parseContent(parser as ParserLike, content);
    return { root: tree.rootNode, langName: lang.name };
  } catch {
    return null;
  }
}

export type { SyntaxNodeLike };

/** 单文件完整解析结果（一次 parse，符号 + import + 调用边 + 类型引用四产出） */
export interface ParsedFile {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  /** 函数级调用边（同文件解析；跨文件/外部为 resolved=false，见 ParsedCall） */
  calls: ParsedCall[];
  /** 类型引用边（同文件解析，TS 系 v1；跨文件引用 resolved=false） */
  type_refs: ParsedTypeRef[];
  /**
   * ★ 2026-10-20：**标识符出现位置**（不是声明，是每一次出现）。
   *   `identifier` / `property_identifier` / `type_identifier` / `shorthand_property_identifier`。
   */
  identifiers?: ParsedIdentifier[];
  /** 解析失败原因（语言包加载失败 / parse 抛错）；成功时缺省。
   *  调用方借此区分"文件本为空"与"解析静默失败"（后者会丢依赖边）。 */
  error?: string;
}

/**
 * 解析文件的符号与 import 依赖（单次 AST parse）。
 * 返回空数组字段表示：文件类型不支持 / 解析失败 / 无对应内容。
 *
 * ★ P11（2026-09-29）：`!lang`（扩展名不支持）**保持静默返回空** —— 这里**不是**缺语言，
 *   而是"这个文件类型本来就不入图"（.md/.json/图片…），补 error 会让 edit_code/derive_chain
 *   等把"编辑 .md"误判成"解析失败"（实测 20+ 调用点按 `parsed.error` 抛错/记 fail）。
 *   真正的**加载失败**（包在但 import 抛了，多为 ABI 不匹配）才给可执行提示。
 */
/**
 * ★ 2026-10-20：**把树交出去**（薄入口，5 行）。
 *
 * `parseFileFull` 抽完 4 类（symbols / imports / calls / type_refs）就把树丢了 ——
 * 而「可变异点」（运算符位置）**只在树里有**（`binary_expression` 在本文件里出现 0 次）。
 * ★ 这里只是把 `getParser` + `parseContent` 组合一次，**不改任何现有逻辑**。
 * ★ 语言通用：节点名因语言而异（TS 是 `binary_expression`）⇒ 由调用方判断，本函数只给树。
 */
export async function parseTreeForFile(
  filePath: string,
  content: string,
): Promise<{ root: SyntaxNodeLike; langName: string } | null> {
  const ext = '.' + (filePath.split('.').pop() || '');
  const lang = isExtSupported(ext);
  if (!lang) return null;
  const parser = await getParser(ext, lang);
  if (!parser) return null;
  const tree = parseContent(parser as ParserLike, content);
  return { root: tree.rootNode, langName: lang.name };
}

/** 一次标识符出现（AST 给的，不是正则扫的） */
export interface ParsedIdentifier {
  name: string;
  kind: 'identifier' | 'property' | 'type' | 'shorthand';
  /** 1-based 行 */
  line: number;
  /**
   * ★ 列号：**当前恒 0** —— `SyntaxNodeLike` 只暴露 `startPosition.row`（无 column）。
   *   精确定位靠 `start_index`；列号等解析层补上再说，**不猜**。
   */
  col: number;
  start_index: number;
  end_index: number;
}

/** 节点类型 → 标识符种类（★ 只这四类算"标识符出现"；声明节点的名字也在其中） */
const IDENT_KIND_OF: Record<string, ParsedIdentifier["kind"]> = {
  identifier: 'identifier',
  property_identifier: 'property',
  type_identifier: 'type',
  shorthand_property_identifier: 'shorthand',
  // ★ 2026-10-20（v13）：**解构简写**（`const { field } = obj` / `function f({ field })`）。
  //   原先漏这一类 ⇒ `field_refs` 改用 identifiers 后会把解构点整体丢掉（实测 TS 语法里
  //   它就是独立的 `shorthand_property_identifier_pattern`，与对象字面量的 `shorthand_property_identifier` 不同）。
  shorthand_property_identifier_pattern: 'shorthand',
};

/**
 * 遍历树抽标识符（**不重新 parse**，用的是同一次解析的树）。
 * ★ 不去重、不判语义：同一名字在不同作用域出现多次，这里就有多行 ——
 *   "哪个是真引用"是消费者的判断，不是解析层的。
 * ★ 没有字符偏移的节点**不记**（宁可少报：靠行号猜位置会指向错的地方）。
 */
function traverseAndExtractIdentifiers(root: SyntaxNodeLike, out: ParsedIdentifier[]): void {
  const walk = (n: SyntaxNodeLike): void => {
    const kind = IDENT_KIND_OF[n.type];
    const si = n.startIndex;
    const ei = n.endIndex;
    if (kind && si !== undefined && ei !== undefined) {
      out.push({ name: n.text, kind, line: n.startPosition.row + 1, col: 0, start_index: si, end_index: ei });
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
}

export async function parseFileFull(filePath: string, content: string): Promise<ParsedFile> {
  const empty: ParsedFile = { symbols: [], imports: [], calls: [], type_refs: [] };
  const ext = '.' + (filePath.split('.').pop() || '');
  const lang = isExtSupported(ext);
  if (!lang) return empty;

  const parser = await getParser(ext, lang);
  if (!parser) return { ...empty, error: `语言包加载失败: ${lang.name}；${missingLanguageHint(ext)}` };

  try {
    const tree = parseContent(parser as ParserLike, content);
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    const calls: ParsedCall[] = [];
    const typeRefs: ParsedTypeRef[] = [];
    traverseAndExtract(tree.rootNode, lang, symbols, undefined);
    traverseAndExtractImports(tree.rootNode, lang, imports, 0, { filePath, consts: buildConstStringMap(tree.rootNode, filePath) });
    traverseAndExtractCalls(tree.rootNode, lang, symbols, calls);
    traverseAndExtractTypeRefs(tree.rootNode, lang, symbols, typeRefs);
    const identifiers: ParsedIdentifier[] = [];
    traverseAndExtractIdentifiers(tree.rootNode, identifiers);
    return { symbols, imports, calls, type_refs: typeRefs, identifiers };
  } catch (e) {
    console.warn(`[ts_kernel] parse ${filePath} failed: ${(e as Error).message}`);
    return { ...empty, error: (e as Error).message };
  }
}

/**
 * 解析文件的符号。返回空数组表示：文件类型不支持 / 解析失败 / 文件为空。
 */
export async function parseFile(filePath: string, content: string): Promise<ParsedSymbol[]> {
  return (await parseFileFull(filePath, content)).symbols;
}

// ─────────────────────────────────────────────────────────────
// 同步解析路径（⑤ 同步工具直连 L1a，2026-09-15）
// ─────────────────────────────────────────────────────────────
//
// 为什么能同步：parseFileFull 链路里唯一的 await 是 getParser（动态 import 语言包）；
// 解析本体（parseContent + traverseAndExtract*）与后续 SQLite 写入全部同步。
// ⇒ 进程启动预热 Parser 缓存（prewarmKernel）后，同步签名的工具
//    （remove_dead_imports / scaffold 等）也能当场写穿索引，不再只能登记（L1b）。

/**
 * `parseFileFull` 的同步孪生（体逐行同构，仅 Parser 获取方式不同）。
 *
 * 纪律（绝不半同步）：
 *   - 本函数**绝不**触发动态 import；缓存未命中 ⇒ 返回 `error: '解析器未预热: …'`，
 *     调用方走 L1b 登记（write_gate 的预热闸在调用前就用 `canParseFileSync` 拦下了）。
 *   - 扩展名缓存键与 `parseFileFull` 完全一致（原样大小写、`'.' + 最后一段`），
 *     因此 `parserReadyForFile` / `canParseFileSync` 的判定不会与实际解析行为漂移。
 *
 * ★ P11（2026-09-29）：本函数的 `解析器未预热` **不加缺语言提示** —— 那是"进程还没预热"
 *   （调用方走 L1b 登记），包已装、语言也认得，加"装 tree-sitter-x"是**误导**（§2d 同理：
 *   别给不相干的告警）。缺语言的可执行提示落在 async 孪生的加载失败分支。
 */
export function parseFileFullSync(filePath: string, content: string): ParsedFile {
  const empty: ParsedFile = { symbols: [], imports: [], calls: [], type_refs: [] };
  const ext = '.' + (filePath.split('.').pop() || '');
  const lang = isExtSupported(ext);
  if (!lang) return empty;

  const parser = getParserSync(ext);
  if (!parser) return { ...empty, error: `解析器未预热: ${lang.name}（先调 prewarmKernel）` };

  try {
    const tree = parseContent(parser as ParserLike, content);
    const symbols: ParsedSymbol[] = [];
    const imports: ParsedImport[] = [];
    const calls: ParsedCall[] = [];
    const typeRefs: ParsedTypeRef[] = [];
    traverseAndExtract(tree.rootNode, lang, symbols, undefined);
    traverseAndExtractImports(tree.rootNode, lang, imports, 0, { filePath, consts: buildConstStringMap(tree.rootNode, filePath) });
    traverseAndExtractCalls(tree.rootNode, lang, symbols, calls);
    traverseAndExtractTypeRefs(tree.rootNode, lang, symbols, typeRefs);
    const identifiers: ParsedIdentifier[] = [];
    traverseAndExtractIdentifiers(tree.rootNode, identifiers);
    return { symbols, imports, calls, type_refs: typeRefs, identifiers };
  } catch (e) {
    console.warn(`[ts_kernel] parse(sync) ${filePath} failed: ${(e as Error).message}`);
    return { ...empty, error: (e as Error).message };
  }
}

/** 该文件的 Parser 是否已在缓存（与 parseFileFullSync 的缓存键完全一致） */
export function parserReadyForFile(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop() || '');
  return getParserSync(ext) !== null;
}

/**
 * 同步解析该文件**此刻**是否可行：扩展名受支持时要求 Parser 已预热；
 * 不支持的类型直接可行（parseFileFullSync 会返回空结果，无需解析器）。
 * 给 write_gate 的预热闸用 —— 闸的判定与实际解析行为共用同一套键计算，不漂移。
 */
export function canParseFileSync(filePath: string): boolean {
  const ext = '.' + (filePath.split('.').pop() || '');
  if (!isExtSupported(ext)) return true;
  return getParserSync(ext) !== null;
}

/**
 * 预热：把全部已安装语言包 × 全部扩展名的 Parser 建好（进程启动时调用一次）。
 * 完成后 `parseFileFullSync` / `syncFileSync` / `syncSelfWritesSync` 全程同步可用。
 * 单个语言包加载失败照常走 loader 降级（记录 warning，返回 null），预热本身不抛。
 */
export async function prewarmKernel(): Promise<{
  warmed: number;
  /** 装了但**加载失败**的扩展名（沿用原字段名 —— 原调用方文案写「语言包」是错的，它是 ext） */
  missing: string[];
  /**
   * ★★ 2026-10-08 新增：**注册了但包没装**的语言名。
   *
   * 为什么必须报出来：它们此前落在 `warmed` 与 `missing` 的**夹缝**里，**完全看不见** ——
   * 因为原实现只遍历 `probeInstalledLanguages()`（**已装的**）⇒ 未装的**连循环都进不去**。
   * ★ `tsx` / `jsx` 就是在这里藏了很久：`.tsx` 全体解析不出来，
   *   而预热报告显示的是「34 个解析器就绪，缺 0 个语言包」—— 听起来一切正常。
   */
  notInstalled: string[];
}> {
  const missing: string[] = [];
  const notInstalled: string[] = [];
  let warmed = 0;
  // ★ 遍历**全部注册语言**（不只是已装的）—— 未装的先分流出去，**不静默、不折叠**
  for (const lang of LANGUAGES) {
    if (!isLanguageInstalled(lang.pkg)) {
      notInstalled.push(lang.name);
      continue;
    }
    for (const ext of lang.exts) {
      const p = await getParser(ext, lang);
      if (p) warmed++;
      else missing.push(ext);
    }
  }
  return { warmed, missing, notInstalled };
}

/** 检查扩展名是否被支持（且已安装对应语言包） */
export function isSupported(ext: string): boolean {
  return isExtSupported(ext) !== null;
}

/** 列出所有已安装并启用的语言 */
export function listSupportedLanguages(): string[] {
  return probeInstalledLanguages().map((l) => l.name);
}

/** 列出所有支持的扩展名 */
export function listSupportedExtensions(): string[] {
  return listSupportedExts();
}

/** 重置内部缓存（测试用） */
export function _reset(): void {
  clearLoaderCache();
}

export { findLanguageByExt, isLanguageInstalled };
export type { LanguageEntry };
