/**
 * 类型声明的「成员提取」—— `interface` / `type` 别名 / `class` 的**字段与方法签名**。
 *
 * ## 为什么单独立它（唯一住处纪律）
 * 这段知识（"哪个节点是声明体 / 哪个节点是成员 / 名字与 `?` 怎么取"）**原先住在**
 * `application/meta/explore/contract_page.ts` 里。2026-10-11（**T157**）`consistency_check`
 * 也要用它 ⇒ **提上来**，**不为第二处调用再抄一份**（本仓头号病：同一判据住两处）。
 *
 * ## 它补的是什么（内核没给的那一块）
 * 内核 `ParsedSymbol.signature` 对 `interface`/`type`/`class` **退化成 `Name()`**
 * （**不是真签名**，只是内核的归一化 —— 实测 `Touched` ⇒ `"Touched()"`）
 * ⇒ **"这个类型有哪些字段、字段什么类型"，内核不给**。
 * 而 `Touched` 这类 7 字段接口正是本仓**最核心的契约面**（"统一 [B] 契约形状"）
 * ⇒ 不给就没法对拍。本模块补的就是这一块。
 *
 * ## 判据纪律（照本仓已立的先例）
 * 1. **一律走内核 AST**（`parseAstRoot`），**不用正则** —— 正则版会与 AST 版**分叉**（头号病）。
 * 2. **取不到就省略**（`type?`），**不猜**；**没有成员体**（联合类型 / 别名无体）⇒ 空数组。
 * 3. 可选标记取成员节点的**直接子 token `?`**，**不是**整段文本里的 `?:`：
 *    后者会把 `foo(a?: string): void` 的**形参**误判成"**该成员**可选"
 *    （实测：`method_signature` 的 `?` 在 `formal_parameters` 里，**不在**成员节点的直接子节点上）。
 * 4. 属性的类型取字段 `type`（`: string`），方法取字段 **`return_type`**（`: void`）——
 *    实测 `method_signature` 的 `type` 为 `null`（**两者的字段名不同**，取错就一律取不到）。
 *
 * ## ★ 已知边界（**说清楚，不许让调用方以为"全比了"**）
 * · **方法的形参不在这里**：本模块只给成员**名**与方法**返回类型**；
 *   形参列表/参数类型**未提取** ⇒ 方法成员的类型漂移**只看返回类型**。
 * · **继承/实现不展开**：只取**声明体直接子**里的成员；`extends` / `implements` 带进来的成员**不算**。
 * · **嵌套对象不递归**：`alternatives?: { option: string }[]` 的类型是一整段文本，**不下钻**去比内层字段。
 * · **只有本仓内核注册过成员节点类型的语言**能取到（见 `MEMBER_NODES`）；其余语言 ⇒ 空成员（不猜）。
 */
import { parseAstRoot } from './kernel.js';
import type { SyntaxNodeLike } from './kernel.js';

/** 类型声明节点（跨语言取本仓内核已注册的那些；取不到的形态直接跳过，宁可少收也不猜）。 */
export const TYPE_DECL_NODES: ReadonlySet<string> = new Set([
  'interface_declaration',
  'type_alias_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'struct_declaration',
]);

/** 声明体节点 */
export const BODY_NODES: ReadonlySet<string> = new Set([
  'interface_body',
  'object_type',
  'class_body',
  'declaration_list',
]);

/** 成员节点（属性 / 方法签名 / 字段） */
export const MEMBER_NODES: ReadonlySet<string> = new Set([
  'property_signature',
  'method_signature',
  'public_field_definition',
  'property_definition',
  'method_definition',
  'abstract_method_signature',
  'abstract_property_signature',
]);

/** 一个类型的**直接成员**。 */
export interface ParsedTypeMember {
  name: string;
  /**
   * 属性的类型注解 / 方法的**返回**类型。**含前导 `:`**，原样保留（归一化留给比对方）。
   * 取不到 ⇒ **省略**（不猜：类里没写返回注解的方法、无类型注解的字段都取不到）。
   */
  type?: string;
  /** `?` 可选标记（取自成员节点的**直接子 token**，见文件头纪律 3） */
  optional: boolean;
  member_kind: 'property' | 'method';
}

/** 一个**类型声明**：名字 + 成员。 */
export interface ParsedTypeDecl {
  name: string;
  /** 内核节点类型（`interface_declaration` / `type_alias_declaration` / …） */
  node_type: string;
  members: ParsedTypeMember[];
}

/** 成员节点里取名字：优先 `name` 字段，否则扫第一个标识符子节点（不同 grammar 字段名不同）。 */
function memberNameOf(m: SyntaxNodeLike): string | null {
  const nm = m.childForFieldName('name');
  if (nm && nm.text) return nm.text;
  for (let j = 0; j < m.childCount; j++) {
    const c = m.child(j);
    if (c && (c.type === 'property_identifier' || c.type === 'identifier' || c.type === 'type_identifier')) {
      return c.text;
    }
  }
  return null;
}

/** 该节点**直接子**里有没有 `type` 这个 token（**只查一层** —— 形参里的 `?` 不算，见文件头纪律 3）。 */
function hasDirectToken(node: SyntaxNodeLike, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return true;
  }
  return false;
}

/** 成员节点是不是「方法」形态（决定类型取 `return_type` 还是 `type`）。 */
const METHOD_NODES: ReadonlySet<string> = new Set([
  'method_signature',
  'method_definition',
  'abstract_method_signature',
]);

/** 声明体的**直接子**里的成员 → 结构化清单。找不到体 ⇒ 空数组（不猜）。 */
export function typeMembersOf(decl: SyntaxNodeLike): ParsedTypeMember[] {
  let body: SyntaxNodeLike | null = null;
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i);
    if (c && BODY_NODES.has(c.type)) {
      body = c;
      break;
    }
  }
  if (!body) return [];

  const out: ParsedTypeMember[] = [];
  for (let i = 0; i < body.childCount; i++) {
    const m = body.child(i);
    if (!m || !MEMBER_NODES.has(m.type)) continue;
    const name = memberNameOf(m);
    if (!name) continue;
    // ★ 属性用 `type`、方法用 `return_type`（实测 method_signature 的 `type` 恒为 null）
    const typeNode = METHOD_NODES.has(m.type)
      ? m.childForFieldName('return_type') ?? m.childForFieldName('type')
      : m.childForFieldName('type') ?? m.childForFieldName('return_type');
    out.push({
      name,
      ...(typeNode && typeNode.text ? { type: typeNode.text } : {}),
      optional: hasDirectToken(m, '?'),
      member_kind: METHOD_NODES.has(m.type) ? 'method' : 'property',
    });
  }
  return out;
}

/** 仅成员名（去重）—— 给"字段清单"这类只关心名字的调用方。 */
export function memberNamesOf(decl: SyntaxNodeLike): string[] {
  return [...new Set(typeMembersOf(decl).map((m) => m.name))];
}

/** 深度优先：找到名为 `name` 的类型声明节点（内核 AST 节点）。 */
export function findTypeDeclByName(root: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  let hit: SyntaxNodeLike | null = null;
  const walk = (n: SyntaxNodeLike): void => {
    if (hit) return;
    if (TYPE_DECL_NODES.has(n.type)) {
      const nm = n.childForFieldName('name');
      if (nm && nm.text === name) {
        hit = n;
        return;
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return hit;
}

/** 深度优先：第一棵类型声明子树（用于"这串签名**是不是**一个类型声明"）。 */
function firstTypeDecl(root: SyntaxNodeLike): SyntaxNodeLike | null {
  let hit: SyntaxNodeLike | null = null;
  const walk = (n: SyntaxNodeLike): void => {
    if (hit) return;
    if (TYPE_DECL_NODES.has(n.type)) {
      hit = n;
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return hit;
}

/** 取声明的名字：优先 `name` 字段，否则扫类型/普通标识符子节点。 */
function declNameOf(decl: SyntaxNodeLike): string | null {
  const nm = decl.childForFieldName('name');
  if (nm && nm.text) return nm.text;
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i);
    if (c && (c.type === 'type_identifier' || c.type === 'identifier')) return c.text;
  }
  return null;
}

/**
 * 从**设计态签名串**解析出一个类型声明。
 *
 * ## 为什么输入是**串**而不是符号
 * `expected_apis[].signature` 是**人写的契约**（设计态），**代码 AST 里没有同一份**
 * ⇒ 只能把串**当成一小段源码**重新解析（`parseAstRoot`）——
 * ★ 关键：**解析器与"实际侧"是同一个** ⇒ **两侧同一把尺**（这正是本函数存在的理由；
 *   若改用正则，就又造了一把尺 = 头号病）。
 *
 * ## 三态（**不许把"判不了"塌进"不是类型"**）
 * | 态 | 含义 | 调用方该做什么 |
 * |---|---|---|
 * | `type-decl` | 解析出了类型声明（含成员） | 走**成员比对** |
 * | `not-type-decl` | 解析成功，但树里没有类型声明（函数/常量/散文…） | 走**原来的函数路径** |
 * | `unparsable` | **解析器给不了**（扩展名不支持 / 语法包没装） | ★ **不许**退成函数路径碰运气 ⇒ 如实报"判不了" |
 *
 * @param signature 设计态签名串（如 `export interface Touched { feature?: string }`）
 * @param filePath 该契约所属的**真实文件路径** —— **用它的扩展名选语言**（不许假定 TS）
 */
export type SignatureDeclResult =
  | { kind: 'type-decl'; decl: ParsedTypeDecl }
  | { kind: 'not-type-decl' }
  | { kind: 'unparsable'; reason: string };

export async function typeDeclFromSignature(
  signature: string,
  filePath: string,
): Promise<SignatureDeclResult> {
  const ast = await parseAstRoot(filePath, signature);
  if (!ast) {
    return {
      kind: 'unparsable',
      reason: `内核解析器给不了 \`${filePath}\` 这种扩展名的 AST（语言包没装 / 不支持该形态）`,
    };
  }
  const decl = firstTypeDecl(ast.root);
  if (!decl) return { kind: 'not-type-decl' };
  const name = declNameOf(decl);
  if (!name) return { kind: 'not-type-decl' };
  return { kind: 'type-decl', decl: { name, node_type: decl.type, members: typeMembersOf(decl) } };
}

/** 类型文本归一化：折叠空白、小写（`": string[]"` 与 `":  string[]  "` 应视为同一）。 */
export function normalizeMemberType(t: string | undefined): string | undefined {
  return t === undefined ? undefined : t.replace(/\s+/g, ' ').trim().toLowerCase();
}
