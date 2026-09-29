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
 *   5. 可被多个工具共享（consistency / backfill / 未来的 lint/format）
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
import type Parser from 'tree-sitter';
import { findLanguageByExt, LanguageEntry } from './languages.js';
import { isLanguageInstalled, isExtSupported, listSupportedExts, probeInstalledLanguages } from './probe.js';
import { getParser, getParserSync, clearLoaderCache } from './loader.js';
import { missingLanguageHint } from '../lang_hint.js';

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
}

/** import 依赖（用于 import_project 的跨文件边推导） */
export interface ParsedImport {
  /** 原始 import 路径（如 './foo/bar'、'myproject/internal/x'、'os.path'；Python 相对导入保留前导点如 '..pkg'） */
  source: string;
  /** relative = 相对路径（./ ../ 或 Python 前导点）；package = 包路径 */
  kind: 'relative' | 'package';
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
  if (
    parent === undefined &&
    (node.type === 'lexical_declaration' || node.type === 'variable_declaration')
  ) {
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
        symbols.push({
          name: nameNode.text,
          kind: 'const',
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          qualified_name: nameNode.text,
          signature: `const ${nameNode.text} = ${valueBrief}`,
          parent: undefined,
          is_closure: isClosureLit ? true : undefined,
        });
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
      // 局部闭包标记：当前 node 位于「函数作用域」内（上层是 function/method）→ 内部辅助函数，
      // 非设计契约。类型作用域（顶层/类内）不标——方法与顶层函数仍是契约。
      const isClosureSymbol = enclosingIsFunction;
      symbols.push({
        name,
        kind,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        qualified_name: qn,
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
interface LangImportAdapter {
  /** 调用节点类型（数组 = 该语言有多种调用形态，如 PHP 三种 / Groovy 两种） */
  callNode?: string | string[];
  /** 顶层调用也提取（无包裹函数的脚本语言，如 Python） */
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
   */
  calleeIsFirstChild?: boolean;
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
}

/** `#include "x.h"` / `#include <vector>` → 头文件路径（C 与 C++ 同型，共用一份正则，别抄第二份） */
function includePath(node: SyntaxNodeLike): string[] {
  const m = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(node.text);
  return m ? [m[1]] : [];
}

export const LANG_ADAPTERS: Record<string, LangImportAdapter> = {
  go: {
    callNode: 'call_expression',
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
    extractImportBindings(node, paths) {
      const m = node.text.match(/^\s*([A-Za-z_][\w.]*)\s*(?:"[^"]*"|`[^`]*`)/);
      if (m) return [m[1]];
      const base = paths[0]?.split('/').pop();
      return base ? [base] : [];
    },
  },
  python: {
    callNode: 'call',
    topLevelCall: true,
    // ★ 数据：`f(x)` → (call function: (identifier))；签名 `def f(self)` 剥 self、返回 ' -> '
    calleeFields: ['function'],
    returnSep: ' -> ',
    stripSelfParam: true,
    closureLiteralNodeTypes: ['lambda'],
    extractImportSources(node) {
      if (node.type === 'import_statement') {
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
        return out;
      }
      if (node.type === 'import_from_statement') {
        const m = node.text.match(/^\s*from\s+(\.*)([\w.]*)\s+import/);
        if (!m) return [];
        const dots = m[1] || '';
        const mod = m[2] || '';
        if (dots) return [dots + mod];
        return mod ? [mod] : [];
      }
      return [];
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
    // `import a.b.C` / `import a.b.*` / `import a.b.C as D` → 模块路径（去通配/去别名）
    extractImportSources(node) {
      let t = node.text.replace(/^\s*import\s+/, '').replace(/[\s;]+$/, '').trim();
      t = t.replace(/\s+as\s+[A-Za-z_]\w*$/, '').trim();
      t = t.replace(/\.\*$/, '');
      return t ? [t] : [];
    },
    // `import a.b.C as D` → D；否则末段 C
    extractImportBindings(node) {
      const asM = node.text.match(/\s+as\s+([A-Za-z_]\w*)\s*;?\s*$/);
      if (asM) return [asM[1]];
      const t = node.text.replace(/^\s*import\s+/, '').replace(/[\s;]+$/, '').trim().replace(/\.\*$/, '');
      const last = t.split('.').pop();
      return last ? [last] : [];
    },
  },
  php: {
    // PHP 调用形式多样：自由函数 foo()=function_call_expression；静态 Class::m()=scoped_call_expression；实例 $o->m()=member_call_expression
    callNode: ['function_call_expression', 'scoped_call_expression', 'member_call_expression'],
    // ★ 数据：自由函数被调名在 `function` 字段；静态/实例调用在 `name` 字段
    //   （与改动前的 `'function'|'name'|'method'` 串在 PHP 上等价 —— 有意不改 callee_expr 形态）
    calleeFields: ['function', 'name'],
    // `use Foo\Bar<;>` / `use Foo\Bar as Baz;` / `use Foo\{Bar, Baz};` / `use function Foo\bar;`
    extractImportSources(node) {
      let t = node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^function\s+/, '').replace(/^const\s+/, '');
      const brace = t.indexOf('{');
      if (brace >= 0) {
        const head = t.slice(0, brace).trim().replace(/\\$/, '');
        return head ? [head] : []; // 分组形式：主命名空间作为 source（成员 binding 已各自提取）
      }
      // 单条：Foo\Bar [/as Baz]
      const base = t.split(/\s+as\s+|\s+/, 1)[0] || t;
      return base ? [base] : [];
    },
    // binding：`use Foo\Bar as Baz → Baz`；否则末段 `Bar`；分组形式取每个成员末段
    extractImportBindings(node) {
      let t = node.text.replace(/^\s*use\s+/, '').replace(/;\s*$/, '').trim();
      t = t.replace(/^function\s+/, '').replace(/^const\s+/, '');
      const brace = t.indexOf('{');
      if (brace >= 0) {
        const inner = t.slice(brace + 1, t.lastIndexOf('}'));
        return inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
          const asM = s.match(/as\s+([A-Za-z_\x80-\xff]\w*)/);
          if (asM) return [asM[1]];
          const seg = s.trim().split('\\').pop()?.trim() || '';
          return seg ? [seg] : [];
        }).flat();
      }
      const asM = t.match(/\s+as\s+([A-Za-z_\x80-\xff]\w*)\s*$/);
      if (asM) return [asM[1]];
      const last = t.split('\\').pop()?.trim();
      return last ? [last] : [];
    },
  },
  // ── TS 系四门：同一份契约（callNode + 被调字段 + import 源字段 + type-only 擦除）──
  //   ★ 原先这四门在 kernel 里被两处**按语言 if** 特判（import 源提取、TS_FAMILY_LANGS 的
  //     type-only 判定），现各自表项声明；四门形同一份数据，故意不合并成别名——
  //     每门都是独立 npm 包 + 独立扩展名，表项自足才符合"加语言 = 加一行"。
  typescript: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true },
  tsx: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true },
  javascript: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true },
  jsx: { callNode: 'call_expression', calleeFields: ['function'], importSourceField: 'source', erasedModuleStatements: true },

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
    // ★ 未接 import：`import Data.List (sort)` 的 (import module: …) 需要专属提取器，本笔未做。
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
};

/** 取某语言 import 的 source 列表（深适配查注册表；简单字段走 importSourceField） */
function extractImportSources(node: SyntaxNodeLike, langName: string): string[] {
  const a = LANG_ADAPTERS[langName];
  if (a?.extractImportSources) return a.extractImportSources(node);
  // ★ 典型形态：语句上有 `source` 字段（TS 系 `import x from 'y'`）。
  //   原先这里是 `langName === 'typescript' || 'tsx' || 'javascript' || 'jsx'` 的按语言 if，
  //   现改为表项数据 importSourceField。
  if (a?.importSourceField) {
    const s = fieldText(node, a.importSourceField);
    return s ? [stripQuotes(s)] : [];
  }
  return [];
}

/** 取某语言 import 的本地绑定名（深适配查注册表；无则空） */
function extractImportBindings(node: SyntaxNodeLike, langName: string, paths: string[]): string[] {
  const a = LANG_ADAPTERS[langName];
  return a?.extractImportBindings ? a.extractImportBindings(node, paths) : [];
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
function extractCallsFromBody(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  callerQn: string,
  calls: ParsedCall[],
  symbols: ParsedSymbol[],
  depth: number = 0
): void {
  if (depth > 200) return;
  if (isSymbolNode(node, lang)) return;
  if (isCallNode(node, lang)) {
    const c = extractCallee(node, lang.name);
    if (c) {
      const sym = symbols.find((s) => s.name === c.name);
      calls.push({
        caller: callerQn,
        callee: c.name,
        callee_expr: c.expr,
        line: node.startPosition.row + 1,
        resolved: !!sym,
        callee_qn: sym ? sym.qualified_name : undefined,
      });
    }
    // 继续递归子节点：参数/回调中可能嵌套调用（如 fmt.Println(hello(x)) / arr.map(fn)）
    // callee 表达式（identifier/selector）不是 call 节点，不会被误提取
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) extractCallsFromBody(child, lang, callerQn, calls, symbols, depth + 1);
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
  depth: number = 0
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
        if (kind === 'function' || kind === 'method') {
          // 本函数体调用（跳过嵌套函数子树）
          for (const child of body) extractCallsFromBody(child, lang, qn, calls, symbols, depth + 1);
        }
        // 继续递归找方法/嵌套函数
        for (const child of body) traverseAndExtractCalls(child, lang, symbols, calls, funcStack, depth + 1);
        funcStack.pop();
      }
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    // 模块顶层调用（Python 等）：无包裹函数，调用归属 <module>；只在不进函数体内时提取（函数内由 extractCallsFromBody 处理）
    if (LANG_ADAPTERS[lang.name]?.topLevelCall && funcStack.length === 0 && isCallNode(child, lang)) {
      const c = extractCallee(child, lang.name);
      if (c) {
        const sym = symbols.find((s) => s.name === c.name);
        calls.push({ caller: '<module>', callee: c.name, callee_expr: c.expr, line: child.startPosition.row + 1, resolved: !!sym, callee_qn: sym ? sym.qualified_name : undefined });
      }
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

function traverseAndExtractImports(
  node: SyntaxNodeLike,
  lang: LanguageEntry,
  imports: ParsedImport[],
  depth: number = 0
): void {
  if (depth > 100 || !lang.import_nodes || lang.import_nodes.length === 0) return;
  if (lang.import_nodes.includes(node.type)) {
    const sources = extractImportSources(node, lang.name);
    // TS 系 type-only 语句（`import type` / `export type` / 全 type 内联说明符）运行时擦除
    // ⇒ 标记 type_only，依赖图/闭包不算边。判定收敛在 isTypeOnlyModuleStatement（唯一实现）；
    // 「哪些语言有这套语法」由适配器 erasedModuleStatements 声明（替代原先的 TS_FAMILY_LANGS Set）。
    const typeOnly = LANG_ADAPTERS[lang.name]?.erasedModuleStatements === true && isTypeOnlyModuleStatement(node.text);
    const bindings = extractImportBindings(node, lang.name, sources);
    for (const src of sources) {
      imports.push({
        source: src,
        kind: src.startsWith('.') ? 'relative' : 'package',
        line: node.startPosition.row + 1,
        ...(typeOnly ? { type_only: true } : {}),
        ...(bindings.length > 0 ? { bindings } : {}),
      });
    }
    return; // import 节点内部不再递归
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) traverseAndExtractImports(child, lang, imports, depth + 1);
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
    traverseAndExtractImports(tree.rootNode, lang, imports);
    traverseAndExtractCalls(tree.rootNode, lang, symbols, calls);
    traverseAndExtractTypeRefs(tree.rootNode, lang, symbols, typeRefs);
    return { symbols, imports, calls, type_refs: typeRefs };
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
    traverseAndExtractImports(tree.rootNode, lang, imports);
    traverseAndExtractCalls(tree.rootNode, lang, symbols, calls);
    traverseAndExtractTypeRefs(tree.rootNode, lang, symbols, typeRefs);
    return { symbols, imports, calls, type_refs: typeRefs };
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
export async function prewarmKernel(): Promise<{ warmed: number; missing: string[] }> {
  const missing: string[] = [];
  let warmed = 0;
  for (const lang of probeInstalledLanguages()) {
    for (const ext of lang.exts) {
      const p = await getParser(ext, lang);
      if (p) warmed++;
      else missing.push(ext);
    }
  }
  return { warmed, missing };
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
