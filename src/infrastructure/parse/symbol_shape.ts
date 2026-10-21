/**
 * symbol_shape —— 「返回类型 / 泛型参数 / 修饰符」的 AST 提取（schema v14）
 *
 * ## 为什么要有它
 * v13 之前 `nodes` 只有 `signature` **一根字符串**：要判返回值、泛型、`export`/`async`/`static`
 * 只能各拆一次（`consistency.ts` 的 `returnTypeOf` 就是其中之一）⇒ 同一事实多个出处，
 * 规则一漂移就出假差异（与 `symbol_params.ts` 补形参是同一条病根）。
 * 这里把三样抽成**结构化事实**，由 kernel 一次写进
 * `nodes.return_type / type_params / modifiers`。
 *
 * ## 判据纪律（与 `symbol_params.ts` / `type_members.ts` 同一把尺）
 * 1. **只吃 AST**：能用字段就用字段（`childForFieldName`）；少数**没有字段**的语法
 *    （实测：kotlin `function_declaration` 的 `"fields": {}`）只在**这个节点自己的子节点**上
 *    按类型/位置取，不扫全文、不用正则扫源码。
 * 2. **抽不到就省略**（落库 NULL），不猜：
 *    · `returnType` 省略 = 该符号没有返回类型注解，或该语法根本没有这个字段；
 *    · `typeParams` 省略 = **该语言没有泛型语法**（php / javascript）；
 *      抽得到但为空 ⇒ `[]`（真没有泛型）；
 *    · `modifiers` 省略 = **该语言不抽修饰符**（go：export 由首字母大写编码，不造一个假 `export`）；
 *      抽得到但为空 ⇒ `[]`。
 *    ★ `[]` / `NULL` 的区分与 `params`（v13）同一把尺，schema 注释里写死。
 * 3. **原文照录**：`Promise<User<T>>` / `(bool, int)`（Go 多返回值）/ `?array`（PHP）
 *    保持语法树上的原文，只折叠空白、剥掉前导的 `:` / `->` / `=` 分隔符。
 *
 * ## 已知边界（说清楚，别让调用方以为「全提了」）
 * · **Rust 生命周期**（`<'a>`）**不算类型参数**（它不是类型），不写进 `type_params`；
 * · **C# 的约束**在独立的 `type_parameter_constraints_clause`（`where T : class`），
 *   已按参数名回填到 `constraint`；Kotlin/Python 用 `:` 文本规则拆 name/constraint；
 * · **Go 没有修饰符语法**（无 public/private/static 关键字）⇒ `modifiers` 恒为 NULL；
 * · **装饰器/注解原文照录**：`@m()`（TS/Python/Kotlin）、`#[Attr(1)]`（PHP）、
 *   `[Obsolete]`（C#）、`#[inline]`（Rust）——不做跨语言归一。
 */
import type { SyntaxNodeLike } from './kernel.js';

/** 一个泛型参数：名字 / 约束 / 默认值。缺省 = 该参数没写。 */
export interface ParsedTypeParam {
  /** 参数名原文（Python 的 `*Ts` / `**P` 保留星号前缀，不丢可变性） */
  name: string;
  /** 约束原文（TS `extends X` / Rust `: Clone` / Java `extends Number` 的**值**，已剥前导关键字） */
  constraint?: string;
  /** 默认值原文（`= {}` 的**值**，已剥前导 `=`） */
  default?: string;
}

/** 一次形状提取的产物。三样都是「取不到 ⇒ 省略」，不是空串/空数组。 */
export interface SymbolShape {
  returnType?: string;
  typeParams?: ParsedTypeParam[];
  modifiers?: string[];
}

/**
 * 一门语言的形状提取规则（**纯数据**；`shapeOf` 只消费它，不写按语言分支）。
 * 加语言 = 加一条；某字段不写 = 本语言没有这条判据（⇒ 对应键不落库 = NULL）。
 */
interface ShapeSpec {
  /** 返回类型所在字段名（ts `return_type` / go `result` / java `type` / c# `returns`…） */
  returnTypeField?: string;
  /** 无返回类型字段的语法：**形参节点之后**的第一个命名子节点（实测 kotlin） */
  returnTypeAfterNode?: string;
  /** 配合 `returnTypeAfterNode` 的排除名单（如 `function_body` / `type_constraints`） */
  returnTypeDenyNodes?: string[];
  /** 泛型参数所在字段名 */
  typeParamsField?: string;
  /** 泛型参数**无字段**时的子节点类型（实测 kotlin：`type_parameters` 是普通子节点） */
  typeParamsChild?: string;
  /** 「一个类型参数」的节点类型（python 特殊：列表里每一项是 `type`） */
  typeParamItemNodes?: string[];
  typeParamNameFields?: string[];
  typeParamConstraintFields?: string[];
  /** 约束在**子节点**里（java `type_bound` / rust `bounds` 已在字段里，不在此列） */
  typeParamConstraintNodes?: string[];
  typeParamDefaultFields?: string[];
  /** 约束写在独立子句里（c# `where T : class`） */
  typeParamConstraintClause?: string;
  /** 无字段可用的语法：在**这一项自己的文本**上按 `:` / `=` 拆（实测 python / kotlin） */
  typeParamTextRule?: boolean;
  /** 修饰符**集合节点**（java/kotlin 的 `modifiers`、rust 的 `function_modifiers`）：逐个孩子取文本 */
  modifierContainer?: string[];
  /** 直接子节点即修饰符（php `visibility_modifier` / c# `modifier` / rust `visibility_modifier`） */
  modifierNodeTypes?: string[];
  /** 匿名 token 即修饰符（ts 的 `async` / `static` / `readonly`，python 的 `async`） */
  modifierTokens?: string[];
  /** 由**节点类型**隐含的修饰符（ts `abstract_class_declaration` ⇒ `abstract`） */
  abstractNodeTypes?: string[];
  /** 父节点是这些类型 ⇒ 追加 `export`（ts 的 `export_statement`） */
  exportFromParents?: string[];
  /** 装饰器/注解节点类型（直接子节点，或 `modifierContainer` 的孩子） */
  decoratorNodeTypes?: string[];
  /** 装饰器挂在**父节点**下（python `decorated_definition`、ts 顶层 `export_statement`） */
  decoratorFromParents?: string[];
  /** 装饰器是**前驱兄弟**（rust `attribute_item`、ts class_body 里的 `decorator`） */
  decoratorFromSiblings?: boolean;
  /** 前驱兄弟里**哪些类型算装饰器**（与 `decoratorFromSiblings` 配合） */
  decoratorSiblingTypes?: string[];
}

/** ★ 每门语言的形状规则（**唯一住处**）。注释里写明「这个语言为什么这么抽」。 */
const SHAPE_SPECS: Record<string, ShapeSpec> = {
  // ── TS / TSX ────────────────────────────────────────────────────────────
  // 实测（tree-sitter-typescript）：`return_type` 是**字段**，值是 `type_annotation`
  //   节点，文本带前导 `: `（`func.f() {…}` 无注解 ⇒ 字段不存在 ⇒ NULL）；
  //   `type_parameters` 是字段，子节点 `type_parameter` 带 name/constraint/value 三个字段；
  //   修饰符里 `async`/`static`/`readonly`/`abstract` 是**匿名 token**，
  //   `public/private/protected` 是 `accessibility_modifier` 命名节点；
  //   `export` 在**父节点** export_statement 上；装饰器是 class_body 的**前驱兄弟**
  //   （实测：`@m() static async run()` 的 decorator 是 method_definition 的 prevSibling）。
  typescript: {
    returnTypeField: 'return_type',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['type_parameter'],
    typeParamNameFields: ['name'],
    typeParamConstraintFields: ['constraint'],
    typeParamDefaultFields: ['value'],
    modifierTokens: ['async', 'static', 'readonly', 'abstract'],
    modifierNodeTypes: ['accessibility_modifier'],
    abstractNodeTypes: ['abstract_class_declaration'],
    exportFromParents: ['export_statement'],
    decoratorNodeTypes: ['decorator'],
    decoratorFromParents: ['export_statement'],
    decoratorFromSiblings: true,
    decoratorSiblingTypes: ['decorator'],
  },
  // ── JS / JSX：无类型系统 ⇒ return/type_params 恒 NULL；修饰符与 TS 同形 ──
  javascript: {
    modifierTokens: ['async', 'static'],
    modifierNodeTypes: ['accessibility_modifier'],
    exportFromParents: ['export_statement'],
    decoratorNodeTypes: ['decorator'],
    decoratorFromParents: ['export_statement'],
    decoratorFromSiblings: true,
    decoratorSiblingTypes: ['decorator'],
  },
  // ── Go ──────────────────────────────────────────────────────────────────
  // 实测：返回值在 `result` 字段；多返回值时字段值是 **parameter_list**，
  //   文本原样是 `(bool, int)` —— 按用户要求**保留原文**（不拆成数组）。
  //   泛型在 `type_parameters`（`type_parameter_declaration`，约束在 `type` 字段）。
  //   ★ 修饰符**故意不写**：Go 没有修饰符关键字，export 由首字母大小写编码 ——
  //     写 `[]` 会被读成「抽了、确实没有」，写 `export` 则是发明语法 ⇒ 恒 NULL。
  go: {
    returnTypeField: 'result',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['type_parameter_declaration'],
    typeParamNameFields: ['name'],
    typeParamConstraintFields: ['type'],
  },
  // ── Python ──────────────────────────────────────────────────────────────
  // 实测：`return_type` 是字段（`->` 是匿名 token，文本不带箭头）；
  //   3.12 泛型的字段名也是 `type_parameters`，但节点是**单数** `type_parameter`，
  //   值是一整段 `[T: int, *Ts, **P]`，列表项是 `type` ⇒ 只能在**项自己的文本**上拆；
  //   `async` 是匿名 token；装饰器在**父节点** `decorated_definition` 下。
  python: {
    returnTypeField: 'return_type',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['type'],
    typeParamTextRule: true,
    modifierTokens: ['async'],
    decoratorNodeTypes: ['decorator'],
    decoratorFromParents: ['decorated_definition'],
  },
  // ── Java ────────────────────────────────────────────────────────────────
  // 实测：返回类型在 `type` 字段；泛型在 `type_parameters`（约束是**子节点**
  //   `type_bound`，文本 `extends Number`）；修饰符/注解**全在**子节点 `modifiers` 里
  //   （命名孩子 annotation / 匿名 token public·static·final·synchronized）。
  java: {
    returnTypeField: 'type',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['type_parameter'],
    typeParamNameFields: ['name'],
    typeParamConstraintNodes: ['type_bound'],
    modifierContainer: ['modifiers'],
    decoratorNodeTypes: ['annotation', 'marker_annotation'],
  },
  // ── Kotlin ──────────────────────────────────────────────────────────────
  // 实测：**没有字段**（`"fields": {}`）⇒ 返回类型取「形参节点之后的第一个命名子节点」
  //   （`function_value_parameters` 后是 `:` 匿名 token + `nullable_type`；
  //   如果后面直接是 `function_body`/`type_constraints` ⇒ 没写返回类型）；
  //   泛型是普通子节点 `type_parameters`，参数文本 `T : Any` 用 `:` 拆；
  //   修饰符/注解同 java：子节点 `modifiers` 里逐个取。
  kotlin: {
    returnTypeAfterNode: 'function_value_parameters',
    returnTypeDenyNodes: ['function_body', 'type_constraints'],
    typeParamsChild: 'type_parameters',
    typeParamItemNodes: ['type_parameter'],
    typeParamTextRule: true,
    modifierContainer: ['modifiers'],
    decoratorNodeTypes: ['annotation'],
  },
  // ── PHP ─────────────────────────────────────────────────────────────────
  // 实测：返回类型**有字段** `return_type`（值 `optional_type` 文本 `?array`）——
  //   注册表的 `field_map` 里没写它（签名因此一直缺返回段），本模块直接按字段取，
  //   不动签名口径。泛型：**PHP 没有泛型语法** ⇒ type_params 恒 NULL。
  //   修饰符是独立命名子节点；属性在 `attributes` 字段（`attribute_list`，文本 `#[Attr(1)]`）。
  php: {
    returnTypeField: 'return_type',
    modifierNodeTypes: ['visibility_modifier', 'static_modifier', 'abstract_modifier', 'final_modifier', 'readonly_modifier'],
    decoratorNodeTypes: ['attribute_list'],
  },
  // ── C# ──────────────────────────────────────────────────────────────────
  // 实测：返回类型字段叫 **`returns`**（不是 return_type）；泛型 `type_parameters`
  //   （`type_parameter_list` → `type_parameter` 带 name 字段）；约束在**独立子句**
  //   `type_parameter_constraints_clause`（文本 `where T : class`）⇒ 按名字回填；
  //   修饰符是重复的 `modifier` 命名节点；特性是 `attribute_list`（文本 `[Obsolete]`）。
  c_sharp: {
    returnTypeField: 'returns',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['type_parameter'],
    typeParamNameFields: ['name'],
    typeParamConstraintClause: 'type_parameter_constraints_clause',
    modifierNodeTypes: ['modifier'],
    decoratorNodeTypes: ['attribute_list'],
  },
  // ── Rust ────────────────────────────────────────────────────────────────
  // 实测：返回类型 `return_type` 字段（`->` 是匿名 token）；泛型 `type_parameters`
  //   （`constrained_type_parameter` 的 name 在 **`left`** 字段、约束在 `bounds`，
  //    `lifetime` **跳过**——生命周期不是类型参数）；
  //   修饰符 = `visibility_modifier`（文本 `pub(crate)`）+ `function_modifiers` 容器
  //   （`async`/`unsafe` 匿名 token、`extern_modifier` 命名节点）；
  //   属性是**前驱兄弟** `attribute_item`（文本 `#[inline]`），不在函数节点内部。
  rust: {
    returnTypeField: 'return_type',
    typeParamsField: 'type_parameters',
    typeParamItemNodes: ['constrained_type_parameter', 'optional_type_parameter', 'type_parameter'],
    typeParamNameFields: ['name', 'left'],
    typeParamConstraintFields: ['bounds'],
    typeParamDefaultFields: ['default'],
    modifierNodeTypes: ['visibility_modifier'],
    modifierContainer: ['function_modifiers'],
    decoratorFromSiblings: true,
    decoratorSiblingTypes: ['attribute_item'],
  },
};

// tsx / jsx 与 ts / js **同一套语法**（`tree-sitter-typescript` / `tree-sitter-javascript`
// 的两个语言对象），规则直接复用；单独登记是因为内核按 `lang.name` 取规则。
SHAPE_SPECS.tsx = SHAPE_SPECS.typescript;
SHAPE_SPECS.jsx = SHAPE_SPECS.javascript;

/** 折叠空白；空串 ⇒ undefined（「取不到」只有一个表示）。 */
function norm(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 0 ? t : undefined;
}

/** 直接子节点里第一个 `type === t` 的。 */
function firstChildOfType(node: SyntaxNodeLike, t: string): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === t) return c;
  }
  return null;
}

/** 顶层（跳过括号/引号内）第一个 `ch` 的下标；找不到 ⇒ -1。 */
function topLevelIndex(text: string, ch: string): number {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    // ★ `=>` 的 `>` 不是泛型闭合（`T: (a: string) => void` 会把深度提前减掉）——
    //   与 `symbol_params.ts` 的同一处修正同一把尺。
    else if ((c === ')' || c === ']' || c === '}' || c === '>') && !(c === '>' && text[i - 1] === '=')) depth--;
    // ★ `=>` 的 `=` 不是默认值分隔符
    else if (c === ch && depth === 0 && !(ch === '=' && text[i + 1] === '>')) return i;
  }
  return -1;
}

/**
 * 在一项类型参数的**自己的文本**上拆 name/constraint/default（无字段语法的唯一入口）。
 * 例：`T : Any` → { name:'T', constraint:'Any' }；`T: int = 0` → 三段；`*Ts` → { name:'*Ts' }。
 */
export function parseTypeParamText(raw: string): ParsedTypeParam | undefined {
  let t = norm(raw)?.replace(/^\[|\]$/g, '').trim();
  if (!t) return undefined;
  let def: string | undefined;
  const eq = topLevelIndex(t, '=');
  if (eq >= 0) {
    def = norm(t.slice(eq + 1)) ?? '';
    t = t.slice(0, eq).trim();
  }
  let constraint: string | undefined;
  const colon = topLevelIndex(t, ':');
  if (colon >= 0) {
    constraint = norm(t.slice(colon + 1));
    t = t.slice(0, colon).trim();
  }
  const name = norm(t);
  if (!name) return undefined;
  return {
    name,
    ...(constraint ? { constraint } : {}),
    ...(def ? { default: def } : {}),
  };
}

/** 从「一项类型参数」节点取（字段优先，其次第一个类型标识符）。 */
function typeParamFromNode(item: SyntaxNodeLike, spec: ShapeSpec): ParsedTypeParam | undefined {
  let name: string | undefined;
  for (const f of spec.typeParamNameFields ?? ['name']) {
    name = norm(item.childForFieldName(f)?.text);
    if (name) break;
  }
  if (!name) {
    for (let i = 0; i < item.childCount; i++) {
      const c = item.child(i);
      if (c && /^(type_identifier|identifier|simple_identifier)$/.test(c.type)) {
        name = norm(c.text);
        break;
      }
    }
  }
  if (!name) return undefined;

  let constraint: string | undefined;
  for (const f of spec.typeParamConstraintFields ?? []) {
    const n = item.childForFieldName(f);
    const v = norm(n?.text)?.replace(/^(extends|:)\s*/, '').trim();
    if (v) {
      constraint = v;
      break;
    }
  }
  if (!constraint) {
    for (const t of spec.typeParamConstraintNodes ?? []) {
      const n = firstChildOfType(item, t);
      const v = norm(n?.text)?.replace(/^(extends|:)\s*/, '').trim();
      if (v) {
        constraint = v;
        break;
      }
    }
  }

  let def: string | undefined;
  for (const f of spec.typeParamDefaultFields ?? []) {
    const v = norm(item.childForFieldName(f)?.text)?.replace(/^=\s*/, '').trim();
    if (v) {
      def = v;
      break;
    }
  }
  return {
    name,
    ...(constraint ? { constraint } : {}),
    ...(def ? { default: def } : {}),
  };
}

/** 泛型参数表：**抽得到就返回数组**（可能是 `[]`）；本语言没有泛型语法时调用方根本不会进来。 */
function typeParamsOf(node: SyntaxNodeLike, spec: ShapeSpec): ParsedTypeParam[] {
  const holder =
    (spec.typeParamsField ? node.childForFieldName(spec.typeParamsField) : null) ??
    (spec.typeParamsChild ? firstChildOfType(node, spec.typeParamsChild) : null);
  const out: ParsedTypeParam[] = [];
  if (!holder) return out;

  for (let i = 0; i < holder.childCount; i++) {
    const c = holder.child(i);
    if (!c || !spec.typeParamItemNodes?.includes(c.type)) continue;
    const p = spec.typeParamTextRule ? parseTypeParamText(c.text) : typeParamFromNode(c, spec);
    if (p) out.push(p);
  }

  // C#：约束写在**独立子句**里（`where T : class`），按参数名回填
  if (spec.typeParamConstraintClause) {
    for (let i = 0; i < node.childCount; i++) {
      const clause = node.child(i);
      if (!clause || clause.type !== spec.typeParamConstraintClause) continue;
      const t = norm(clause.text)?.replace(/^where\s+/, '');
      if (!t) continue;
      const colon = topLevelIndex(t, ':');
      if (colon < 0) continue;
      const who = norm(t.slice(0, colon));
      const what = norm(t.slice(colon + 1));
      const hit = who ? out.find((p) => p.name === who) : undefined;
      if (hit && what && !hit.constraint) hit.constraint = what;
    }
  }
  return out;
}

/** 返回类型：字段优先；无字段的语法取「形参节点之后的第一个命名子节点」。 */
function returnTypeOfNode(node: SyntaxNodeLike, spec: ShapeSpec): string | undefined {
  if (spec.returnTypeField) {
    const n = node.childForFieldName(spec.returnTypeField);
    // 剥前导分隔符：TS 的 `: X`、Ruby/Scala 的 `:`、部分语法的 `-> X`
    return norm(n?.text)?.replace(/^(?::|->)\s*/, '').trim() || undefined;
  }
  if (spec.returnTypeAfterNode) {
    let idx = -1;
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === spec.returnTypeAfterNode) idx = i;
    }
    if (idx < 0) return undefined;
    for (let i = idx + 1; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c || c.isNamed === false) continue;
      if (spec.returnTypeDenyNodes?.includes(c.type)) return undefined;
      return norm(c.text);
    }
  }
  return undefined;
}

/** 节点在父节点里的下标（按 `startIndex` 比对，tree-sitter 的 child() 每次是新包装对象）。 */
function indexInParent(node: SyntaxNodeLike): number {
  const p = node.parent;
  if (!p) return -1;
  for (let i = 0; i < p.childCount; i++) {
    const c = p.child(i);
    if (!c) continue;
    if (c === node) return i;
    if (c.startIndex !== undefined && c.startIndex === node.startIndex && c.type === node.type) return i;
  }
  return -1;
}

/** 修饰符 + 装饰器。**本语言不抽修饰符 ⇒ undefined**（落库 NULL），抽到但为空 ⇒ `[]`。 */
function modifiersOf(node: SyntaxNodeLike, spec: ShapeSpec): string[] | undefined {
  const capable =
    spec.modifierContainer ||
    spec.modifierNodeTypes ||
    spec.modifierTokens ||
    spec.abstractNodeTypes ||
    spec.exportFromParents ||
    spec.decoratorNodeTypes ||
    spec.decoratorFromParents ||
    spec.decoratorFromSiblings;
  if (!capable) return undefined;

  const mods: string[] = [];
  const decorators: string[] = [];

  // 1) export 在父节点上（TS 系 export_statement）
  if (spec.exportFromParents && node.parent && spec.exportFromParents.includes(node.parent.type)) {
    mods.push('export');
  }

  // 2) 修饰符**容器**（java/kotlin 的 modifiers、rust 的 function_modifiers）
  if (spec.modifierContainer) {
    for (let i = 0; i < node.childCount; i++) {
      const box = node.child(i);
      if (!box || !spec.modifierContainer.includes(box.type)) continue;
      for (let j = 0; j < box.childCount; j++) {
        const c = box.child(j);
        if (!c) continue;
        const v = norm(c.text);
        if (!v) continue;
        if (spec.decoratorNodeTypes?.includes(c.type)) decorators.push(v);
        else mods.push(v);
      }
    }
  }

  // 3) 直接子节点即修饰符 / 装饰器
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (spec.modifierNodeTypes?.includes(c.type)) {
      const v = norm(c.text);
      if (v) mods.push(v);
    }
    if (spec.decoratorNodeTypes?.includes(c.type)) {
      const v = norm(c.text);
      if (v) decorators.push(v);
    }
    // 4) 匿名 token（ts `async`/`static`、python `async`）
    if (spec.modifierTokens?.includes(c.type)) {
      const v = norm(c.text);
      if (v) mods.push(v);
    }
  }

  // 5) 节点类型隐含的修饰符（ts abstract class）
  if (spec.abstractNodeTypes?.includes(node.type)) mods.push('abstract');

  // 6) 装饰器挂在父节点下（python decorated_definition、ts 顶层 export_statement）
  if (spec.decoratorFromParents && node.parent && spec.decoratorFromParents.includes(node.parent.type)) {
    for (let i = 0; i < node.parent.childCount; i++) {
      const c = node.parent.child(i);
      if (c && spec.decoratorNodeTypes?.includes(c.type)) {
        const v = norm(c.text);
        if (v) decorators.push(v);
      }
    }
  }

  // 7) 装饰器是前驱兄弟（rust attribute_item、ts class_body 里的 decorator）
  if (spec.decoratorFromSiblings && node.parent) {
    const idx = indexInParent(node);
    for (let i = idx - 1; i >= 0; i--) {
      const c = node.parent.child(i);
      if (!c || !spec.decoratorSiblingTypes?.includes(c.type)) break;
      const v = norm(c.text);
      if (v) decorators.unshift(v);
    }
  }

  return [...new Set([...mods, ...decorators])];
}

/**
 * 从一个符号声明节点抽形状（`return_type` / `type_params` / `modifiers`）。
 * ★ 未登记的语言 ⇒ 全 `{}`（三列全 NULL）——「没抽」而不是「没有」。
 */
export function shapeOf(node: SyntaxNodeLike, langName: string): SymbolShape {
  const spec = SHAPE_SPECS[langName];
  if (!spec) return {};
  const out: SymbolShape = {};
  const ret = returnTypeOfNode(node, spec);
  if (ret) out.returnType = ret;
  if (spec.typeParamsField || spec.typeParamsChild) out.typeParams = typeParamsOf(node, spec);
  const mods = modifiersOf(node, spec);
  if (mods) out.modifiers = mods;
  return out;
}
