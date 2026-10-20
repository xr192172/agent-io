/* eslint-disable */
/**
 * symbol_params —— 函数 / 方法**形参表**的提取（内核 AST 事实的唯一住处）
 *
 * ## 为什么要有它（补的是内核真缺的那一块）
 * `ParsedSymbol.signature` 是**一根字符串**（`name(a: string, b?: number)`）。
 * 消费方要判「形参个数 / 名字 / 类型 / 可选性」时，只能对这根串再拆一次
 * （`consistency.ts` 原先就是 `match(/\(([^)]*)\)/)` + `splitTopLevelArgs`）。
 * 这正是本仓头号病：**同一个事实算两遍** ⇒ 两侧各拆一次，规则一漂移就出假差异
 * （T154 的「两侧判据不对称」根因）。
 *
 * 这里把形参抽成**结构化记录**，并由 kernel 一次写进 `nodes.params`；
 * 调用方（`consistency.ts` / 校验 / 将来的签名 diff）读同一个字段，不再拆串。
 *
 * ## 判据纪律（照 `type_members.ts` 已立的先例）
 * 1. **只吃 AST**：传入的是函数/方法声明的 `parameters` 字段节点，
 *    不是全文正则；切分只在**这个节点自己的文本**上做（括号深度 + 引号状态），
 *    用来兼容各 grammar 把「一个形参」拆成多颗子节点的差异。
 * 2. **取不到就省略**（`type?`），**不猜**；名字取不到时保留空名（仍计入个数）。
 * 3. **`optional` / `variadic` 是三个来源的并集**：节点类型（`optional_parameter`）、
 *    直接子 token（`?`）、文本前缀/默认值（`...` / `*` / `**` / `=`）。
 * 4. **与 `signature` 同口径**：Python 的 `self` / `cls` 与 `buildSignature` 一样跳过；
 *    否则同一份代码在「签名」与「形参表」里会数出不同的个数。
 *
 * ## 已知边界（说清楚，不许让调用方以为「全提了」）
 * · **只有 `parameters` 字段的语言**（本仓注册表 50+ 门里绝大多数）能取到；
 *   没有该字段的语言 ⇒ 空数组（不猜）。
 * · **泛型 / 联合 / 对象类型只保留原文**，不下钻（`Map<string, number>` 是一整段文本）。
 * · **Go 的「多名共用一型」**（`(a, b int)`）在这里补齐：从右往左把类型传给同组前面的裸名。
 * · **TS 解构形参**（`{ a, b }: T`）的名字保留**模式原文**（`{ a, b }`），不做字段展开。
 */
import type { SyntaxNodeLike } from './kernel.js';

/** 一个形参：名字 / 类型注解 / 可选 / 可变。 */
export interface ParsedParam {
  /** 形参名；解构形参保留模式原文（`{ a, b }`）；无名形参为空串（仍计入个数） */
  name: string;
  /** 类型注解原文（不含前导 `:`）；取不到 ⇒ 省略（不猜） */
  type?: string;
  /** `?` / 默认值 / Python 默认值 ⇒ true */
  optional: boolean;
  /** `...rest` / `*args` / `**kw` / Go `...T` ⇒ true */
  variadic: boolean;
}

const OPEN = '([{<';
const CLOSE = ')]}>';

/** 括号深度为 0 的第一个 `ch`（跳过引号内、括号内）；找不到 ⇒ -1。 */
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
    // ★ `=>` 的 `>` 不是泛型闭合（`Record<string, () => void>` 里它会把深度提前减掉，
    //   导致后面的顶层逗号被吞 —— 实测把 2 个形参并成 1 个）
    const arrowGt = c === '>' && text[i - 1] === '=';
    if (!arrowGt && OPEN.includes(c)) depth++;
    else if (!arrowGt && CLOSE.includes(c)) depth--;
    else if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** 顶层逗号切分（跳过 () [] {} <> 与引号内）；空段丢弃。 */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') {
        const n = text[i + 1];
        if (n !== undefined) cur += n;
        i++;
      } else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    // ★ 同 `topLevelIndex`：`=>` 的 `>` 不算泛型闭合（否则 `Record<string, () => void>` 的逗号会被吞）
    const arrowGt = c === '>' && text[i - 1] === '=';
    if (!arrowGt && OPEN.includes(c)) depth++;
    else if (!arrowGt && CLOSE.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      if (cur.trim()) out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 去掉形参块里的注释（`/* … *\/` 与行尾 `//`）——只用于**这一个形参文本**，不扫全文。 */
function stripParamComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** 类型原文归一：去前导冒号 / 折叠空白。 */
function normalizeType(t: string | undefined): string | undefined {
  if (t === undefined) return undefined;
  const n = t.replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim();
  return n.length > 0 ? n : undefined;
}

/** 名字原文归一：折叠空白（保留解构模式的花括号）。 */
function normalizeName(n: string): string {
  return n.replace(/\s+/g, ' ').trim();
}

/** 直接子 token 里有没有某类型（只查一层）。 */
function hasDirectToken(node: SyntaxNodeLike, type: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) return true;
  }
  return false;
}

/** 从一段形参文本解析（AST 节点给不出字段时的兜底；仍是「这一个形参」的文本，不是全文）。 */
function parseChunkText(raw: string, langName: string): ParsedParam | null {
  let t = stripParamComments(raw).trim();
  if (!t) return null;

  let variadic = false;
  if (t.startsWith('...')) {
    variadic = true;
    t = t.slice(3).trim();
  }
  // Python：*args / **kw
  if ((langName === 'python') && /^\*{1,2}/.test(t)) {
    variadic = true;
    t = t.replace(/^\*{1,2}/, '').trim();
  }

  let optional = false;
  const eq = topLevelIndex(t, '=');
  if (eq >= 0) {
    optional = true;
    t = t.slice(0, eq).trim();
  }

  const colon = topLevelIndex(t, ':');
  let namePart: string;
  let typePart: string | undefined;
  if (colon >= 0) {
    namePart = t.slice(0, colon).trim();
    typePart = t.slice(colon + 1).trim();
  } else {
    // Go / C 系：`name type`（类型是最后一个空白段；`a, b int` 的裸名先留空类型，稍后补齐）
    const m = t.match(/^(.*?)(?:\s+)([^\s]+)$/);
    if (m && m[1].trim()) {
      namePart = m[1].trim();
      typePart = m[2].trim();
    } else {
      namePart = t.trim();
    }
  }

  // Go 的 `...error` 在类型位上
  let type = normalizeType(typePart);
  if (type && type.startsWith('...')) {
    variadic = true;
    type = type.slice(3).trim();
  }
  // 名字位上的 `?`（TS 可选）
  let name = normalizeName(namePart);
  if (name.endsWith('?')) {
    optional = true;
    name = name.slice(0, -1).trim();
  }
  // C 系修饰符：`final String name` 已在 name 位；AST 字段能取到时由 paramFromNode 覆盖
  return {
    name,
    ...(type ? { type } : {}),
    optional,
    variadic,
  };
}

/** 用节点自己的字段（name/type）解析一个形参；字段取不到 ⇒ null（交给文本解析）。 */
function parseChunkNode(node: SyntaxNodeLike, langName: string): ParsedParam | null {
  const nameNode =
    node.childForFieldName('name') ??
    node.childForFieldName('pattern') ??
    node.childForFieldName('declarator');
  const typeNode = node.childForFieldName('type') ?? node.childForFieldName('return_type');
  if (!nameNode) return null;
  let name = normalizeName(nameNode.text);
  let type = normalizeType(typeNode?.text);
  // ★ `optional_parameter` 是**可选**，不是**可变**（两者别混：早先把它当 variadic 是错的那一版）
  let variadic = /rest_pattern|variadic_parameter|splat_pattern/.test(node.type) || node.text.trim().startsWith('...');
  if ((langName === 'python') && /^\*{1,2}/.test(node.text.trim())) variadic = true;
  let optional = node.type.includes('optional') || hasDirectToken(node, '?');
  if (topLevelIndex(stripParamComments(node.text), '=') >= 0) optional = true;
  // 名字位上的 `...rest` / `*args` / `**kw`：剥掉标记（name 只要本地名）
  if (name.startsWith('...')) {
    variadic = true;
    name = name.slice(3).trim();
  }
  if ((langName === 'python') && /^\*{1,2}/.test(name)) {
    variadic = true;
    name = name.replace(/^\*{1,2}/, '').trim();
  }
  if (name.endsWith('?')) {
    optional = true;
    name = name.slice(0, -1).trim();
  }
  if (type && type.startsWith('...')) {
    variadic = true;
    type = type.slice(3).trim();
  }
  return { name, ...(type ? { type } : {}), optional, variadic };
}

/**
 * 从一个**形参列表节点**（`formal_parameters` / `parameter_list` / `parameters` …）抽形参。
 *
 * 切分口径：先剥外层括号，再按**顶层逗号**切；每段优先用「文本完全相同的直接子节点」的字段，
 * 取不到再按该段文本解析。Go 的 `(a, b int)` 是**扁平子节点**（逗号把名字和类型分开），
 * 按“从右往左把类型传给裸名”补齐。
 */
export function paramsOfNode(paramsNode: SyntaxNodeLike, langName: string): ParsedParam[] {
  let text = paramsNode.text.trim();
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1);
  if (!text.trim()) return [];

  const chunks = splitTopLevel(text);
  const byText = new Map<string, SyntaxNodeLike>();
  for (let i = 0; i < paramsNode.childCount; i++) {
    const c = paramsNode.child(i);
    if (c && c.type !== '(' && c.type !== ')' && c.type !== ',') {
      const k = c.text.trim();
      if (k && !byText.has(k)) byText.set(k, c);
    }
  }

  const out: ParsedParam[] = [];
  for (const raw of chunks) {
    const key = raw.trim();
    const node = byText.get(key);
    const p = (node ? parseChunkNode(node, langName) : null) ?? parseChunkText(raw, langName);
    if (!p) continue;
    if (langName === 'python' && (p.name === 'self' || p.name === 'cls')) continue;
    out.push(p);
  }

  // Go：`(a, b int)` ⇒ 裸名 a 继承右侧最近的非空类型；`...T` 的可变标记同样右传。
  if (langName === 'go') {
    let carryType: string | undefined;
    let carryVariadic = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const p = out[i];
      if (p.type !== undefined) {
        carryType = p.type;
        carryVariadic = p.variadic;
      } else if (carryType !== undefined) {
        p.type = carryType;
        p.variadic = carryVariadic;
      }
    }
  }
  return out;
}

/** 从一个**函数/方法声明节点**抽形参（`parameters` 字段名由调用方按语言给）。 */
export function paramsOf(decl: SyntaxNodeLike, parametersField = 'parameters', langName = ''): ParsedParam[] {
  const p = decl.childForFieldName(parametersField);
  return p ? paramsOfNode(p, langName) : [];
}
