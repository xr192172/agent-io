/**
 * ★★★ 2026-10-28（T-#MECH-BODY）：**函数体的机械翻译器** —— 在 AST 上判"能不能翻"，能就翻，翻不动就交 LLM。
 *
 * ## 为什么要它（用户提的）
 * > 「函数内部为啥不能翻译 for 对 for、类型推断对 int var 之类，函数集对拍，边界情况再请 LLM 填空」
 *
 * 量过：真仓（agent-memory）**624 个有体函数，其中 453 个（72.6%）不含任何"硬构造"**
 * （硬构造 = `defer` / `select` / 通道收发 / `type switch` / `goto` / `go`，TS 无一一对应，要语义决策）。
 * ⇒ 这七成根本不该花钱让 LLM 猜：`for range` 对 `for…of`、`:=` 对 `const/let`、`if/else` 对 `if/else`
 *   —— 都是**同构**的，机械翻就是**确定**的；只有剩下三成 + 边界情况才需要 LLM。
 *
 * ## 铁律：**翻不动就"不知道"，不猜**
 * 本模块**绝不**做"看起来差不多"的改写：任何一个节点不在支持集里 ⇒ 返回 `null` ⇒ 上层走 LLM。
 * 宁可少翻一个，也不产出一个"编译得过、语义错了"的函数体（那是比空壳更坏的假绿）。
 *
 * ## 判据边界（诚实清单 · [未核]）
 * · 支持：块 / 赋值 / `:=` / 表达式语句 / `if`·`else` / `for`（三式 + `range`）/ 表达式 `switch` /
 *   `return` / `break`·`continue` / `++`·`--` / 二元·一元·调用·选择子·下标·切片·复合字面量 / 字面量；
 * · **不支持**（⇒ null ⇒ LLM）：`defer` / `go` / `select` / 通道收发 / `type switch` / 类型断言 /
 *   标签 `goto` / 闭包捕获外部变量 / 内嵌复合字面量的字段提升 / 方法值；
 * · **[未核]** 整型溢出与 `int` vs `number` 的语义差（Go `int` 是 64 位截断，TS `number` 是 f64）、
 *   字符串按字节索引 vs UTF-16、`nil` 切片 vs `[]`。这些机械翻**翻不出对齐**，属于"翻完必须对拍"的部分。
 */

import type { SyntaxNodeLike } from '../../parse/index.js';
import { isValueStructType, liftGoBody, projectTsBody, setTypeResolver, noteShimInsert } from './body_pivot.js';

/** 支持的表达式节点类型（不含任一 ⇒ 不翻） */
const OK_EXPR = new Set([
  'identifier',
  'field_identifier',
  'selector_expression',
  'index_expression',
  'slice_expression',
  'call_expression',
  'argument_list',
  'binary_expression',
  'unary_expression',
  'parenthesized_expression',
  'int_literal',
  'float_literal',
  'rune_literal',
  'interpreted_string_literal',
  'raw_string_literal',
  'true',
  'false',
  'nil',
  'composite_literal',
  'literal_value',
  'literal_element',
  'type_conversion_expression',
  'keyed_element',
  'type_identifier',
  'pointer_type',
  'slice_type',
  'array_type',
  'map_type',
  'qualified_type',
  'generic_type',
  'variadic_argument',
  'type_arguments',
  'expression_list',
  'field_declaration',
  'field_declaration_list',
  'package_identifier',
  'type_instantiation_expression',
]);

/** 支持的语句节点类型 */
const OK_STMT = new Set([
  'block',
  'expression_statement',
  'assignment_statement',
  'short_var_declaration',
  'inc_statement',
  'dec_statement',
  'return_statement',
  'if_statement',
  'for_statement',
  'range_clause',
  'for_clause',
  'expression_switch_statement',
  'expression_case',
  'default_case',
  'break_statement',
  'continue_statement',
  'empty_statement',
  'var_declaration',
  'const_declaration',
  'defer_statement',
  'var_spec',
  'const_spec',
]);

/** 明确的硬构造：出现即放弃（哪怕其它都认识） */
const HARD = new Set([
  // ★ defer 已从 HARD 移出：`defer f()` 在**函数体直接子层**时能机械翻成 `try/finally`（见 translateGoBodyMech）。
  //   **嵌套**（循环/if 里的 defer）仍然不翻 —— 那会改变执行时机，属语义决策。
  'go_statement',
  'select_statement',
  'communication_case',
  'send_statement',
  'receive_statement',
  'type_switch_statement',
  'type_case',
  'type_assertion_expression',
  'goto_statement',
  'labeled_statement',
  'func_literal',
]);

/** 纯标点/关键字节点（不作为"不认识"处理） */
const NEUTRAL = new Set([
  'comment',
  '{', '}', '(', ')', '[', ']', ',', ';', '.', ':',
  '=', ':=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=',
  '+', '-', '*', '/', '%', '&&', '||', '!', '<', '>', '<=', '>=', '==', '!=', '&', '|', '^', '<<', '>>', '~',
  '++', '--', '<-', '...',
  'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue',
  'var', 'const', 'func', 'type', 'package', 'import', 'chan', 'map', 'struct', 'interface', 'go', 'defer', 'select',
  '_', 'string', 'int',
  // ★ 2026-10-29：字符串字面量里的转义（`\n` 等）是 token，不是语义节点 —— 出现在 NEUTRAL 之外
  //   曾把 26 个纯字符串函数判成「翻不动」。字面量整段按 `node.text` 输出，转义原样保留。
  'escape_sequence',
]);

/**
 * 一个节点是否「可以不管」——判据分三层，**全部走 AST，不靠类型名文本猜**：
 * 1. **匿名 token**（`isNamed === false`）：关键字 / 标点 / 运算符 / 换行 —— tree-sitter 已经把
 *    "它是不是语法骨架"这件事告诉我们了，不需要维护一张标点清单，也不需要 `startsWith('"')` 这种猜法；
 * 2. **纯空白 token**（`text` 全空白）：换行节点的 `type` 就是换行符本身；
 * 3. 命名节点（`isNamed !== false`）：必须在 `OK_EXPR` / `OK_STMT` 里，否则算不认识。
 *
 * ★ 2026-10-29 修正：原来用 `t.startsWith('"')` 判"这是个匿名 token" —— 那是在**猜节点类型的字符串形状**
 *   （正是本仓反对的那种用法）。`isNamed` 是 tree-sitter 直接给的结构信息，改用它。
 */
/**
 * ★★★ 2026-10-29（**对拍抓到的第二个语义缺口**）：Go 的 `/` `%` 在整型与浮点上语义不同
 * （`7/2 = 3` vs TS `3.5`），而**函数体翻译器手里没有类型环境**（不知道操作数是 int 还是 float）
 * ⇒ 不猜：见到 `/`、`%` 一律判"翻不动"，交 LLM。
 * **[未核]** 若把签名里的参数/返回类型作为类型环境传进来，这一类（以及 `int(x)` 的精确性）就能解；
 *   那是下一步（`T-#MECH-TYPES`），不是现在假装能翻。
 */
function isTypeSensitiveBinary(node: SyntaxNodeLike): boolean {
  if (node.type !== 'binary_expression') return false;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && (c.type === '/' || c.type === '%')) return true;
  }
  return false;
}

function isIgnorable(node: SyntaxNodeLike): boolean {
  if (node.isNamed === false) return true;
  if (!/\S/.test(node.type)) return true;
  return false;
}

/** 整棵子树里有没有不认识/不敢碰的节点（有 ⇒ 不翻） */
function hasUnsupported(node: SyntaxNodeLike, depth = 0): boolean {
  if (depth > 40) return true; // 防御：太深就当不认识（不猜）
  const t = node.type;
  if (HARD.has(t)) return true;
  if (!isIgnorable(node) && !NEUTRAL.has(t) && !OK_EXPR.has(t) && !OK_STMT.has(t)) return true;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && hasUnsupported(c, depth + 1)) return true;
  }
  return false;
}

/** 函数体是否可机械翻译（**先判后翻**，判不过就不翻） */
export function canMechTranslate(block: SyntaxNodeLike): boolean {
  return !hasUnsupported(block);
}

/**
 * ★ 2026-10-29：**诊断用** —— 返回第一个卡住的节点（`{type, text}`），没有则 `null`。
 *
 * 为什么要有它：覆盖率的提升必须**按真实频次**补形态，不能拍脑袋加白名单。
 * 这个函数让"翻不动的函数"自己说出卡在哪个节点，统计出来再决定下一步补什么。
 */

/**
 * ★★★ 2026-10-29（T-#MECH-TYPES）：**极小的类型环境** —— 只为了回答一个决定性问题：
 * "这个 `/` `%` 的操作数是整型还是浮点？"
 *
 * 为什么必须知道：Go 的 `7/2 == 3`（整型截断），TS 的 `7/2 == 3.5`。
 * 上一版因为没有类型环境，见到 `/` `%` 一律判"翻不动"（覆盖率因此从 81.9% 掉到 80.1%）。
 * 现在把**函数签名里的参数类型**传进来，再用最小推断认局部变量：
 *   字面量 → int / float64；`len(x)` → int；整型运算 → int；其它 → 不知道（不知道就不翻）。
 *
 * ★ 边界：这不是类型检查器，只是"够用来判整除"的一点点信息。不知道就返回 null ⇒ 交 LLM，绝不猜。
 */
export type MechTypeEnv = Map<string, string>;

const INT_RE = /^(u?int(8|16|32|64)?|byte|rune|uintptr)$/;
const FLOAT_RE = /^float(32|64)$/;
const isIntT = (t: string | null | undefined): boolean => !!t && INT_RE.test(t);
const isFloatT = (t: string | null | undefined): boolean => !!t && FLOAT_RE.test(t);

/** 最小类型推断：只认得出决定"整除与否"的几种形态；认不出返回 null */

/**
 * 预扫描：按**书写顺序**把 `x := <expr>` 推断出的局部类型记进环境（Go 要求先声明后用，所以单趟够用）。
 * 推断不出的不记（⇒ 用到时 typeOfExpr 返回 null ⇒ 不翻）。
 */

/** Go 内建转换 → TS 惯用式（只收**等价**的；`int(x)` 用 Math.trunc 而不是取整语义近似） */
const GO_CONV: Record<string, (a: string) => string> = {
  int: (a) => `Math.trunc(${a})`,
  int32: (a) => `Math.trunc(${a})`,
  int64: (a) => `Math.trunc(${a})`,
  uint: (a) => `Math.trunc(${a})`,
  float64: (a) => a, // number 即 f64
  float32: (a) => a,
  string: (a) => `String(${a})`,
  bool: (a) => `Boolean(${a})`,
  rune: (a) => `Math.trunc(${a})`,
  byte: (a) => `Math.trunc(${a})`,
};

/** 收集某类直接子节点 */
function kids(node: SyntaxNodeLike, type: string): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === type) out.push(c);
  }
  return out;
}

function field(node: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  try {
    return node.childForFieldName(name) ?? null;
  } catch {
    return null;
  }
}

type StmtOpts = {
  /** 行内模式：**不输出结尾分号**（for 的 init/post 位置用），避免"先生成带分号再 replace 掉" */
  inline?: boolean;
  /** 声明关键字覆盖：for 的 init 必须是 `let`（在 TS 里 const 不能做循环变量） */
  declKw?: 'let' | 'const';
};


/**
 * 顶层入口：把函数体（`block` 节点）机械翻成 TS 函数体源码。
 * 返回 `null` = **不翻**（上层走 LLM）；返回字符串 = 可以确定地翻出来。
 *
 * ## `defer` 的处置（★ 2026-10-29，覆盖 +144 个函数的那个形态）
 * Go `defer f()` = **函数返回时**执行，且**后进先出**。TS 对应物就是 `try/finally`：
 * ```
 * defer a(); defer b();  剩余语句  →   try { 剩余语句 } finally { b(); a(); }
 * ```
 * ★ 只处理**函数体直接子层**的 defer；出现在循环/if 里的 defer **执行时机不同**（每次迭代一次 vs 函数退出），
 *   那不翻 —— 判据里用"直接子层 defer 数 == 全树 defer 数"来保证，多一个就 `null`。
 */
/**
 * Go 零值（只认能确定的三种）：make([]T, n) 要按元素类型填零值，认不出就不翻。
 */
function zeroValueOf(typeNode: SyntaxNodeLike | null): string | null {
  if (!typeNode) return null;
  const t = typeNode.text.trim();
  if (/^(u?int(8|16|32|64)?|float(32|64)|byte|rune|uintptr)$/.test(t)) return '0';
  if (t === 'string') return '""';
  if (t === 'bool') return 'false';
  return null;
}

/** 结构化类型渲染（只服务 make / convert 位置，按 node.type 分派，不用文本猜） */
function tsTypeFromNode(typeNode: SyntaxNodeLike | null): string | null {
  if (!typeNode) return null;
  switch (typeNode.type) {
    case 'map_type': {
      const kids2 = [];
      for (let i = 0; i < typeNode.childCount; i++) {
        const c = typeNode.child(i);
        if (c && !['map', '[', ']', ','].includes(c.type)) kids2.push(c);
      }
      const k = tsTypeFromNode(kids2[0] ?? null);
      const v = tsTypeFromNode(kids2[1] ?? null);
      return k && v ? `Map<${k}, ${v}>` : null;
    }
    case 'slice_type':
    case 'array_type': {
      const el = tsTypeFromNode(typeNode.child(typeNode.childCount - 1));
      return el ? `${el}[]` : null;
    }
    case 'pointer_type':
      return tsTypeFromNode(typeNode.child(typeNode.childCount - 1));
    case 'channel_type': {
      const el = tsTypeFromNode(typeNode.child(typeNode.childCount - 1));
      return el ? `Channel<${el}>` : null;
    }
    case 'type_identifier': {
      const t = typeNode.text;
      if (t === 'byte' || t === 'rune') return 'number';
      if (/^(u?int|float|uintptr)/.test(t)) return 'number';
      if (t === 'string') return 'string';
      if (t === 'bool') return 'boolean';
      return t;
    }
    case 'qualified_type':
      return typeNode.text.split('.').join('_');
    default:
      return null;
  }
}

/** call 实参表的第一个非标点子节点下标（跳过 '('） */
function firstNonPunct(argsNode: SyntaxNodeLike): number {
  for (let i = 0; i < argsNode.childCount; i++) {
    const c = argsNode.child(i);
    if (!c) continue;
    if (['(', ')', ','].includes(c.type)) continue;
    return i;
  }
  return -1;
}

// ══════════════════════════════════════════════════════════════════════════
// ★★★ 2026-10-29（**把补丁改掉**）：`env` 与"翻译失败现场"曾经是两个**模块级可变变量**
// （`ME` / `LAST_FAIL`）—— 那是补丁：并行/嵌套调用会互相串味，"谁设置的"也看不出来，
// 只能靠一个 `IN_TRANSLATE` 守卫把限制喊出来。现在它们是**每次翻译新建的实例状态**：
// 一次翻译 = 一个 `createTranslator()`，函数体通过闭包共享这份状态，**模块级零可变状态**。
// ══════════════════════════════════════════════════════════════════════════
export interface MechState {
  env: MechTypeEnv;
  fail: { type: string; text: string } | null;
}

function createTranslator(env?: MechTypeEnv) {
  const state: MechState = { env: new Map(env ?? []), fail: null };

const fail = (node: SyntaxNodeLike | null, why = ''): null => {
  if (!state.fail && node) state.fail = { type: node.type + (why ? ':' + why : ''), text: node.text.slice(0, 50) };
  return null;
};

const typeOfExpr = (node: SyntaxNodeLike | null, env: MechTypeEnv): string | null  => {
  if (!node) return null;
  switch (node.type) {
    case 'identifier':
      return env.get(node.text) ?? null;
    case 'int_literal':
      return 'int';
    case 'float_literal':
      return 'float64';
    case 'parenthesized_expression':
      return typeOfExpr(node.child(1), env);
    case 'call_expression': {
      const fn = node.child(0)?.text ?? '';
      if (fn === 'len' || fn === 'cap') return 'int';
      if (INT_RE.test(fn) || FLOAT_RE.test(fn)) return fn; // 内建转换：int(x) / float64(x)
      return null;
    }
    case 'unary_expression': {
      const op = node.child(0)?.text ?? '';
      const t = typeOfExpr(node.child(1), env);
      if (op === '&' || op === '*') return t;
      return t;
    }
    case 'binary_expression': {
      const l = typeOfExpr(node.child(0), env);
      const r = typeOfExpr(node.child(2), env);
      if (isFloatT(l) || isFloatT(r)) return 'float64';
      if (isIntT(l) && isIntT(r)) return 'int';
      return null;
    }
    default:
      return null;
  }
}

const inferLocals = (block: SyntaxNodeLike, env: MechTypeEnv): void  => {
  const visit = (node: SyntaxNodeLike): void => {
    if (node.type === 'short_var_declaration' || node.type === 'assignment_statement') {
      const lists = kids(node, 'expression_list');
      const lhs = lists[0];
      const rhs = lists[1];
      if (lhs && rhs && lhs.childCount === 1 && rhs.childCount === 1) {
        const nameNode = lhs.child(0);
        if (nameNode && nameNode.type === 'identifier' && nameNode.text !== '_') {
          const t = typeOfExpr(rhs.child(0), env);
          if (t) env.set(nameNode.text, t);
        }
      }
    }
    if (node.type === 'var_declaration') {
      // var x int = 3 / var x int
      for (let i = 0; i < node.childCount; i++) {
        const spec = node.child(i);
        if (!spec || spec.type !== 'var_spec') continue;
        let name: string | null = null;
        let ty: string | null = null;
        for (let j = 0; j < spec.childCount; j++) {
          const c = spec.child(j);
          if (!c) continue;
          if (c.type === 'identifier' && !name) name = c.text;
          else if (['type_identifier', 'qualified_type'].includes(c.type) && !ty) ty = c.text;
        }
        if (name && ty) env.set(name, ty);
        else if (name) {
          const lists = kids(node, 'expression_list');
          const t = lists.length ? typeOfExpr(lists[0], env) : null;
          if (t) env.set(name, t);
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) visit(c);
    }
  };
  visit(block);
}

const expr = (node: SyntaxNodeLike | null): string | null  => {
  if (!node) return null;
  switch (node.type) {
    case 'identifier':
    case 'field_identifier':
      return node.text === '_' ? null : node.text;
    case 'selector_expression': {
      const op = field(node, 'operand') ?? node.child(0);
      const fld = field(node, 'field') ?? node.child(2);
      const l = expr(op);
      if (l === null || !fld) return null;
      return `${l}.${fld.text}`;
    }
    case 'index_expression': {
      const o = field(node, 'operand') ?? node.child(0);
      const idx = field(node, 'index') ?? node.child(2);
      const l = expr(o);
      const r = expr(idx);
      return l === null || r === null ? null : `${l}[${r}]`;
    }
    case 'slice_expression': {
      const o = field(node, 'operand') ?? node.child(0);
      const lo = field(node, 'start');
      const hi = field(node, 'end');
      const l = expr(o);
      if (l === null) return null;
      const a = lo ? expr(lo) : '';
      const b = hi ? expr(hi) : '';
      if (a === null || b === null) return null;
      return `${l}.slice(${a || '0'}${b ? `, ${b}` : ''})`;
    }
    case 'call_expression': {
      const fnNode = field(node, 'function') ?? node.child(0);
      const argsNode = kids(node, 'argument_list')[0] ?? null;
      const fname = fnNode?.text ?? '';
      const conv = GO_CONV[fname];

      // ★★★ 2026-10-29：**make 必须最先处理** —— 它的第一个实参是**类型**（`make(map[string]bool)`），
      //   而下面那圈 `expr(c)` 会对类型节点返回 null ⇒ 整个调用翻不动。
      //   （第一版我把 make 分支放在参数渲染之后 ⇒ 永远到不了，覆盖率一点没动。又一个"顺序即正确性"的教训。）
      if (fnNode?.type === 'identifier' && fname === 'make') {
        const typeArgIdx = argsNode ? firstNonPunct(argsNode) : -1;
        const typeArg = typeArgIdx >= 0 && argsNode ? argsNode.child(typeArgIdx) : null;
        if (!typeArg) return fail(node, 'make-no-type');
        const extra: string[] = [];
        if (argsNode) {
          for (let i = typeArgIdx + 1; i < argsNode.childCount; i++) {
            const c = argsNode.child(i);
            if (!c || c.type === ',' || c.type === ')') continue;
            const v = expr(c);
            if (v === null) return fail(node, 'make-arg');
            extra.push(v);
          }
        }
        if (typeArg.type === 'map_type') return 'new Map()';
        if (typeArg.type === 'channel_type') {
          const el = tsTypeFromNode(typeArg.child(typeArg.childCount - 1));
          return el ? `new Channel<${el}>()` : fail(node, 'make-chan');
        }
        if (typeArg.type === 'slice_type') {
          const zero = zeroValueOf(typeArg.child(typeArg.childCount - 1));
          if (extra.length === 0) return '[]';
          if (zero === null) return fail(node, 'make-slice-zero');
          return `new Array(${extra[0]}).fill(${zero})`;
        }
        return fail(node, 'make-other');
      }

      const args: string[] = [];
      if (argsNode) {
        for (let i = 0; i < argsNode.childCount; i++) {
          const c = argsNode.child(i);
          if (!c || c.type === '(' || c.type === ')' || c.type === ',' || c.type === 'comment') continue;
          const a = expr(c);
          if (a === null) return null;
          args.push(a);
        }
      }
      // 内建转换：`int(x)` → `Math.trunc(x)`
      if (conv && fnNode?.type === 'identifier' && args.length === 1) return conv(args[0]);
      // 内建函数：len/cap → .length；append → spread
      if (fnNode?.type === 'identifier') {
        if (fname === 'len' && args.length === 1) return `${args[0]}.length`;
        if (fname === 'append' && args.length >= 2) return `[...${args[0]}, ${args.slice(1).join(', ')}]`;
      }
      const fn = expr(fnNode);
      return fn === null ? null : `${fn}(${args.join(', ')})`;
    }
    case 'argument_list':
      return null;
    // ★★★ 2026-10-29：**`make(T, …)` 的类型实参**会走到 expr（实测挡住 66 个函数：
    //   `make(map[string]bool)` ×29、`make([]T, n)` ×37）。make 的语义是"分配并置**零值**"，
    //   所以能不能翻取决于元素类型的零值是否可确定 —— 定不了就不翻（不猜）。
    case 'slice_type':
    case 'array_type':
    case 'map_type':
    case 'struct_type':
    case 'pointer_type':
    case 'type_identifier':
    case 'qualified_type':
    case 'generic_type':
      return fail(node, 'type-in-expr-position');
    // ★ 2026-10-29：**包装节点要解包**（它们是 AST 的语法糖层，不是表达式）
    //   `literal_element`（复合字面量元素）×80、`variadic_argument`（`args...`）×9 —— 不认它们，
    //   这两类函数全被判"翻不动"，实测占阻碍的第一名。
    case 'literal_element': {
      const inner = node.child(0);
      return inner ? expr(inner) : fail(node, 'empty-literal-element');
    }
    case 'variadic_argument': {
      // TS 的展开写法是 `...x`（Go 是 `x...`）
      const inner = node.child(0);
      const v = inner ? expr(inner) : null;
      return v === null ? fail(node, 'variadic-inner') : `...${v}`;
    }
    case 'binary_expression': {
      const l = expr(node.child(0));
      const op = node.child(1)?.text ?? '';
      const r = expr(node.child(2));
      if (l === null || r === null) return null;
      // ★ 2026-10-29（T-#MECH-TYPES）：按**类型环境**判整除
      if (op === '/' || op === '%') {
        const lt = typeOfExpr(node.child(0), state.env);
        const rt = typeOfExpr(node.child(2), state.env);
        if (isIntT(lt) && isIntT(rt)) return op === '/' ? `Math.trunc(${l} / ${r})` : `${l} % ${r}`;
        if (isFloatT(lt) || isFloatT(rt)) return `${l} ${op} ${r}`;
        return null; // 不知道类型 ⇒ 不猜，交 LLM
      }
      const OPMAP: Record<string, string> = { '==': '===', '!=': '!==' };
      return `${l} ${OPMAP[op] ?? op} ${r}`;
    }
    case 'unary_expression': {
      const op = node.child(0)?.text ?? '';
      const v = expr(node.child(1));
      if (v === null) return null;
      // ★ 2026-10-29：Go 的指针运算符在 TS **不存在**：
      //   `&x`（取址）与 `*x`（解引用）在 JS 引用语义下都是"这个值本身" ⇒ 直接去掉运算符。
      //   不处理就会生成 `const cp = *entry;` `return &cp;`（TS 语法错，实测 3 处）。
      if (op === '&' || op === '*') return v;
      if (op === '^') return `~${v}`; // Go 一元 ^ = 按位取反（TS 是 ~）
      return `${op}${v}`;
    }
    case 'parenthesized_expression': {
      const inner = node.child(1);
      const v = expr(inner);
      return v === null ? null : `(${v})`;
    }
    case 'true':
    case 'false':
      return node.type;
    case 'nil':
      return 'null';
    case 'int_literal':
    case 'float_literal':
    case 'rune_literal': {
      const raw = node.text.replace(/_/g, '');
      // ★★ 2026-10-29（对拍/tsc 抓到的）：Go 的**八进制字面量** `0644` 在 TS 里是**非法**（TS1121）
      //   ⇒ 必须改写 `0o644`。规则纯文本形状（前导 0 + 全是 0-7 的数字），不是猜结构。
      if (/^0[0-7]+$/.test(raw)) return '0o' + raw.slice(1);
      return raw;
    }
    case 'interpreted_string_literal':
      return node.text;
    case 'raw_string_literal':
      // Go 反引号原文 → TS 模板串（转义反引号）
      return '`' + node.text.slice(1, -1).replace(/`/g, '\\`') + '`';
    case 'composite_literal': {
      // ★ 2026-10-29 结构化修正：字面量种类看**类型节点的 `type`**（AST 直接给），
      //   不再用 `text.startsWith('[]')` / `startsWith('map[')` 去猜 Type 文本的形状
      //   —— 那正是「用字符串形状冒充结构」的旧毛病。
      const typeNode = node.child(0);
      const kindOf = (n: SyntaxNodeLike | null): 'slice' | 'map' | 'struct' | 'other' => {
        if (!n) return 'other';
        if (n.type === 'slice_type' || n.type === 'array_type') return 'slice';
        if (n.type === 'map_type') return 'map';
        if (n.type === 'struct_type' || n.type === 'type_identifier' || n.type === 'qualified_type' || n.type === 'generic_type')
          return 'struct';
        return 'other';
      };
      const litKind = kindOf(typeNode);
      const body = kids(node, 'literal_value')[0];
      if (!body) return null;
      const elems: string[] = [];
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i);
        if (!c || ['{', '}', ',', 'comment'].includes(c.type)) continue;
        if (c.type === 'keyed_element') {
          const k = c.child(0);
          const v = expr(c.child(2) ?? c.child(1));
          const kSrc = k ? expr(k) : null;
          if (!k || v === null || kSrc === null) return fail(node, 'map-key');
          // ★★★ 2026-10-29（tsc 抓到的）：**map 字面量的元素必须是 [k, v] 元组**！
          //   原来一律输出 `k: v` ⇒ 生成 `new Map(["id": n.ID, ...])`（TS1005 一片）。
          //   键也必须走 expr（`cfg.ModelPath` 这类选择子原样 text 会变成字符串键）。
          elems.push(litKind === 'map' ? `[${kSrc}, ${v}]` : `${kSrc}: ${v}`);
        } else {
          // literal_element 是包装节点，要解包取里面的真表达式
          const inner = c.type === 'literal_element' ? c.child(0) : c;
          const v = expr(inner);
          if (v === null) return null;
          elems.push(v);
        }
      }
      // 切片/数组字面量 → 数组；map 字面量 → Map；struct 字面量 → 对象
      if (litKind === 'slice') return `[${elems.join(', ')}]`;
      if (litKind === 'map') return `new Map([${elems.join(', ')}])`;
      return `{ ${elems.join(', ')} }`;
    }
    default:
      return fail(node, 'no-expr-handler');
  }
}

const stmt = (node: SyntaxNodeLike, indent: string, opts: StmtOpts = {}): string | null  => {
  const pad = indent;
  const semi = opts.inline ? '' : ';';
  // ★ 换行/空白/注释是**子节点**（不是语句）——不放过就会被当成"翻不动"（实测所有函数体都栽在这）
  if (/^\s*$/.test(node.type) || node.type === 'comment') return '';
  switch (node.type) {
    case 'block': {
      const out: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.type === '{' || c.type === '}' || c.type === 'comment' || c.type === 'defer_statement') continue;
        const s = stmt(c, pad + '  ');
        if (s === null) return null;
        if (s !== '') out.push(s);
      }
      return out.join('\n');
    }
    case 'empty_statement':
      return '';
    case 'expression_statement': {
      const e = expr(node.child(0));
      return e === null ? null : `${pad}${e}${semi}`;
    }
    case 'short_var_declaration': {
      // `a, b := f()` → `let [a, b] = f()`；`x := 1` → `const x = 1`
      const lhs = kids(node, 'expression_list')[0];
      const rhs = kids(node, 'expression_list')[1];
      if (!lhs || !rhs) return null;
      const lhsKids: string[] = [];
      for (let i = 0; i < lhs.childCount; i++) {
        const c = lhs.child(i);
        if (!c || c.type === ',') continue;
        if (c.type !== 'identifier' && c.text !== '_') return null; // 只支持简单名字（含 `_` 空标识符）
        lhsKids.push(c.text);
      }
      const rhsKids: string[] = [];
      for (let i = 0; i < rhs.childCount; i++) {
        const c = rhs.child(i);
        if (!c || c.type === ',') continue;
        const v = expr(c);
        if (v === null) return null;
        rhsKids.push(v);
      }
      if (!lhsKids.length || !rhsKids.length) return null;
      // 多值：Go 语义 = 解构（前提是右值是单次调用）
      // ★ 关键字也走**结构化覆盖**（for 的 init 用 let），不再事后 `replace(/^const /, 'let ')` 改文本
      // ★★★ 2026-10-29（**对拍抓到的真 bug**）：Go 的 `:=` 声明的变量**是可变的**，
      //   原来单值声明翻成 `const` ⇒ 后面 `t += x` 运行时抛 "Assignment to constant variable"
      //   （对拍 3/3 case diff 才发现；肉眼看代码"完全对"）。⇒ 一律 `let`，绝不 `const`。
      const kw = opts.declKw ?? 'let';
      if (lhsKids.length > 1) {
        if (rhsKids.length === 1) return `${pad}${kw} [${lhsKids.join(', ')}] = ${rhsKids[0]}${semi}`;
        return `${pad}${kw} [${lhsKids.join(', ')}] = [${rhsKids.join(', ')}]${semi}`;
      }
      return `${pad}${kw} ${lhsKids[0]} = ${rhsKids.length > 1 ? `[${rhsKids.join(', ')}]` : rhsKids[0]}${semi}`;
    }
    case 'assignment_statement': {
      const lists = kids(node, 'expression_list');
      const lhs = lists[0];
      const rhs = lists[1];
      if (!lhs || !rhs) return null;
      const ops: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(c.type)) ops.push(c.text);
      }
      const op = ops[0] ?? '=';
      const l: string[] = [];
      for (let i = 0; i < lhs.childCount; i++) {
        const c = lhs.child(i);
        if (!c || c.type === ',') continue;
        const v = expr(c);
        if (v === null) return null;
        l.push(v);
      }
      const r: string[] = [];
      for (let i = 0; i < rhs.childCount; i++) {
        const c = rhs.child(i);
        if (!c || c.type === ',') continue;
        const v = expr(c);
        if (v === null) return null;
        r.push(v);
      }
      if (!l.length || !r.length) return null;
      return `${pad}${l.join(', ')} ${op} ${r.length > 1 ? `[${r.join(', ')}]` : r[0]}${semi}`;
    }
    case 'inc_statement':
    case 'dec_statement': {
      const t = node.type === 'inc_statement' ? '++' : '--';
      const target = expr(node.child(0));
      return target === null ? null : `${pad}${target}${t}${semi}`;
    }
    case 'return_statement': {
      const lists = kids(node, 'expression_list');
      if (!lists.length) return `${pad}return;`;
      const vals: string[] = [];
      for (let i = 0; i < lists[0].childCount; i++) {
        const c = lists[0].child(i);
        if (!c || c.type === ',') continue;
        const v = expr(c);
        if (v === null) return null;
        vals.push(v);
      }
      if (!vals.length) return `${pad}return;`;
      return vals.length === 1 ? `${pad}return ${vals[0]};` : `${pad}return [${vals.join(', ')}];`;
    }
    case 'if_statement': {
      const cond = expr(field(node, 'condition') ?? node.child(1));
      if (cond === null) return null;
      const blocks = kids(node, 'block');
      const thenBlock = blocks[0];
      if (!thenBlock) return null;
      const thenS = stmt(thenBlock, pad + '  ');
      if (thenS === null) return null;
      let out = `${pad}if (${cond}) {\n${thenS}\n${pad}}`;

      // ★★★ 2026-10-29（**对拍抓到的静默丢分支**）：tree-sitter-go 的 `else` **不是** `else_clause` 包装，
      //   而是匿名关键字 token `else` + 紧跟的 `if_statement` 或 `block`。
      //   原来只找 `else_clause` ⇒ **`else if` / `else` 整段被丢掉**，而判据还报"翻得出"
      //   （生成 `if {...} return 0;`：少一条分支，语义变了却看不出来 —— 比翻不动更坏）。
      //   ⇒ 见到 `else` 就必须翻出分支；找不到分支就 `null`，**绝不静默丢 else**。
      let elseIdx = -1;
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && (c.type === 'else' || c.type === 'else_clause')) {
          elseIdx = i;
          break;
        }
      }
      if (elseIdx >= 0) {
        const wrapper = node.child(elseIdx);
        const inner = wrapper && wrapper.type === 'else_clause' ? (wrapper.child(1) ?? wrapper.child(0)) : node.child(elseIdx + 1);
        if (!inner) return null;
        if (inner.type === 'if_statement') {
          const s2 = stmt(inner, pad);
          if (s2 === null) return null;
          // ★ 2026-10-29：原来用 `s2.trimStart()` —— 靠「剪掉空白」猜缩进，是文本修剪式补丁。
          //   `pad` 是我们自己传进去的，长度已知 ⇒ 按长度切，确定性。
          return `${out} else ${s2.slice(pad.length)}`;
        }
        if (inner.type === 'block') {
          const s2 = stmt(inner, pad + '  ');
          if (s2 === null) return null;
          return `${out} else {\n${s2}\n${pad}}`;
        }
        return null; // else 后面既不是 block 也不是 if ⇒ 不猜
      }
      return out;
    }
    case 'for_statement': {
      const rng = kids(node, 'range_clause')[0];
      const bodyBlock = kids(node, 'block')[0];
      if (!bodyBlock) return null;
      const bodyS = stmt(bodyBlock, pad + '  ');
      if (bodyS === null) return null;
      if (rng) {
        const lhs = kids(rng, 'expression_list')[0];
        const target = expr(field(rng, 'right') ?? rng.child(rng.childCount - 1));
        if (target === null) return null;
        const names: string[] = [];
        if (lhs) for (let i = 0; i < lhs.childCount; i++) {
          const c = lhs.child(i);
          if (!c || c.type === ',') continue;
          if (c.type !== 'identifier' && c.text !== '_') return null;
          names.push(c.text);
        }
        const idx = names[0] === '_' ? null : names[0];
        const val = names[1];
        if (val && val !== '_') {
          return idx
            ? `${pad}for (let ${idx} = 0; ${idx} < ${target}.length; ${idx}++) {\n${pad}  const ${val} = ${target}[${idx}];\n${bodyS}\n${pad}}`
            : `${pad}for (const ${val} of ${target}) {\n${bodyS}\n${pad}}`;
        }
        if (idx) return `${pad}for (let ${idx} = 0; ${idx} < ${target}.length; ${idx}++) {\n${bodyS}\n${pad}}`;
        return `${pad}for (const _ of ${target}) {\n${bodyS}\n${pad}}`;
      }
      // 三式 for：翻成 for(init; cond; post)；条件式 for：while
      const fc = kids(node, 'for_clause')[0] ?? node;
      // ★ 2026-10-29：`for n > 1 {}` 的条件**没有 field**（tree-sitter-go 直接挂在 child(1)）⇒
      //   只找 field 会得到 null，整条 while 判成"翻不动"（实测 Halve/CountDown 夹具挂在这）。
      const cond =
        field(fc, 'condition') ??
        field(node, 'condition') ??
        (() => {
          for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (!c) continue;
            if (['for', 'for_clause', 'block'].includes(c.type)) continue;
            if (!/\S/.test(c.type)) continue;
            return c;
          }
          return null;
        })();
      const init = field(fc, 'initializer') ?? field(node, 'initializer');
      const update = field(fc, 'update') ?? field(node, 'update');
      if (init || update) {
        // ★ 行内模式 + 声明关键字覆盖（结构性产出，不做"生成后再改文本"）
        const initS = init ? stmt(init, '', { inline: true, declKw: 'let' }) : null;
        if (init && initS === null) return null;
        const updS = update ? stmt(update, '', { inline: true }) : null;
        if (update && updS === null) return null;
        if (initS === null && init) return null;
        if (updS === null && update) return null;
        const condS = cond ? expr(cond) : null;
        if (cond && condS === null) return null;
        return `${pad}for (${initS ?? ''}; ${condS ?? ''}; ${updS ?? ''}) {\n${bodyS}\n${pad}}`;
      }
      const condS = cond ? expr(cond) : null;
      if (condS === null) return null;
      return `${pad}while (${condS}) {\n${bodyS}\n${pad}}`;
    }
    case 'expression_switch_statement': {
      // ★ 2026-10-29：判别式可能是 `expression_list` 包一层 ⇒ 先剥再翻（否则 expr 直接 null，
      //   整条 switch 判成"翻不动"，实测 KindOf 夹具就这么挂的）。
      const discNode = field(node, 'value') ?? node.child(1);
      const discInner = discNode && discNode.type === 'expression_list' ? discNode.child(0) : discNode;
      const v = expr(discInner);
      if (v === null) return null;
      const parts: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c) continue;
        if (c.type === 'expression_case') {
          const vals = kids(c, 'expression_list')[0];
          const labels: string[] = [];
          if (vals) for (let j = 0; j < vals.childCount; j++) {
            const k = vals.child(j);
            if (!k || k.type === ',') continue;
            const kv = expr(k);
            if (kv === null) return null;
            labels.push(kv);
          }
          const bodyS = stmt(c, pad + '  ');
          if (bodyS === null) return null;
          parts.push(`${pad}  case ${labels.join(', ')}:${bodyS ? '\n' + bodyS : ''}\n${pad}    break;`);
        } else if (c.type === 'default_case') {
          const bodyS = stmt(c, pad + '  ');
          if (bodyS === null) return null;
          parts.push(`${pad}  default:${bodyS ? '\n' + bodyS : ''}\n${pad}    break;`);
        }
      }
      if (!parts.length) return null;
      return `${pad}switch (${v}) {\n${parts.join('\n')}\n${pad}}`;
    }
    case 'expression_case':
    case 'default_case': {
      // case 体：直接子语句逐个翻
      const out: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.type === 'case' || c.type === 'default' || c.type === ':' || c.type === 'expression_list') continue;
        const s = stmt(c, pad);
        if (s === null) return null;
        if (s !== '') out.push(s);
      }
      return out.join('\n');
    }
    case 'break_statement':
      return `${pad}break;`;
    case 'continue_statement':
      return `${pad}continue;`;
    case 'var_declaration':
    case 'const_declaration': {
      // `var x int = 0` → `let x: number = 0;`（类型留空由 tsc 推断更稳 ⇒ 只给值）
      const specs = kids(node, 'var_spec').concat(kids(node, 'const_spec'));
      const out: string[] = [];
      const kw = node.type === 'var_declaration' ? 'let' : 'const';
      for (const sp of specs) {
        const names: string[] = [];
        let valNode: SyntaxNodeLike | null = null;
        for (let i = 0; i < sp.childCount; i++) {
          const c = sp.child(i);
          if (!c) continue;
          if (c.type === 'identifier') names.push(c.text);
          else if (c.type === 'expression_list') valNode = c;
        }
        if (!names.length) return null;
        if (!valNode) {
          // 声明无初值 ⇒ 用 undefined 占位会改语义（Go 零值）⇒ 不猜
          return null;
        }
        const vals: string[] = [];
        for (let i = 0; i < valNode.childCount; i++) {
          const c = valNode.child(i);
          if (!c || c.type === ',') continue;
          const v = expr(c);
          if (v === null) return null;
          vals.push(v);
        }
        out.push(`${pad}${kw} ${names.join(', ')} = ${vals.length > 1 ? `[${vals.join(', ')}]` : vals[0]};`);
      }
      return out.join('\n');
    }
    default:
      return fail(node, 'no-stmt-handler');
  }
}

const translate = (blockArg: SyntaxNodeLike | null): string | null => {
  if (!blockArg) return null;
  const block: SyntaxNodeLike = blockArg;
  if (!canMechTranslate(block)) return null;
  // ★ 类型环境：入参由调用方给（签名里的参数类型），局部再由 inferLocals 补
  state.env = new Map(env ?? []);
  inferLocals(block, state.env);

  // ① 收集**直接子层**的 defer（按出现顺序），并从语句流里摘掉
  const defers: string[] = [];
  let totalDefer = 0;
  const countDefer = (n: SyntaxNodeLike): void => {
    if (n.type === 'defer_statement') totalDefer++;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) countDefer(c);
    }
  };
  countDefer(block);
  for (let i = 0; i < block.childCount; i++) {
    const c = block.child(i);
    if (!c || c.type !== 'defer_statement') continue;
    const call = c.child(1); // defer 后面那个调用表达式
    const src = call ? expr(call) : null;
    if (src === null) return null;
    defers.push(src);
  }
  // ② 嵌套 defer（不在直接子层）⇒ 执行时机不同 ⇒ 不翻
  if (totalDefer !== defers.length) return null;

  // ③ 剩余语句照常翻
  const rest = stmt(block, '');
  if (rest === null) return null;

  if (!defers.length) return rest;
  // ④ LIFO：finally 里**反序**调用
  const fin = defers
    .slice()
    .reverse()
    .map((d) => `    ${d};`)
    .join('\n');
  return `  try {\n${rest}\n  } finally {\n${fin}\n  }`;
}

const blocker = (block: SyntaxNodeLike | null): { type: string; text: string } | null => {
  if (!block) return null;
  // ★ 先看"判据 + 翻译"的合并结论：判据通过但翻译失败 ⇒ 报翻译现场（这才是天花板之下的真实阻碍）
  if (!hasUnsupported(block)) {
    state.fail = null;
    const body = translate(block);
    if (body !== null) return null;
    if (state.fail) return state.fail;
    return { type: 'UNKNOWN_TRANSLATE_NULL', text: '' };
  }
  const walk = (node: SyntaxNodeLike, depth: number): { type: string; text: string } | null => {
    if (depth > 40) return { type: 'DEPTH_LIMIT', text: node.text.slice(0, 40) };
    const t = node.type;
    if (HARD.has(t)) return { type: t, text: node.text.slice(0, 60) };
    if (isTypeSensitiveBinary(node)) return { type: 'DIV_OR_MOD(type-sensitive)', text: node.text.slice(0, 60) };
    if (!isIgnorable(node) && !NEUTRAL.has(t) && !OK_EXPR.has(t) && !OK_STMT.has(t)) {
      return { type: t, text: node.text.slice(0, 60) };
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) {
        const r = walk(c, depth + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(block, 0);
}

  return { translate, blocker };
}

/** 把一个 Go 函数体机械翻成 TS 函数体源码；翻不动返回 \`null\`（上层走 LLM）。 */
export function translateGoBodyMech(
  block: SyntaxNodeLike | null,
  env?: MechTypeEnv,
  /** 值类型 struct 参数名（调用方算好，用于函数入口插 copy()） */
  valueParams?: string[],
): string | null {

  // ★★★ 2026-10-29（T-#PIVOT-LIFTPROJ）：**优先走轴心** —— `lift_go → 体 IR → project_ts`。
  //   走不通（遇到未覆盖构造）就回落下面的 legacy 直连；**绝不半翻**。
  //   等价性由证 t447 兜（走轴心的 90 个体与 legacy 去空白逐字符相同）。
  if (block) {
    // ★ T-#SHIM-APPLY：把本函数的类型环境交给渲染器 —— 它据此决定哪些赋值要插 copy()
    setTypeResolver(env ? (name) => env.get(name) ?? null : null);
    const ir = liftGoBody(block);
    // ★ 入口 copy 不在这里做：它要**同时覆盖 pivot 与 legacy 两条路径** ⇒ 提到调用方（go_extractor）
    if (ir) return projectTsBody(ir);
  }
  if (!block) return null;
  return createTranslator(env).translate(block);
}

/** 诊断：返回第一个卡住的节点（判据 ∩ 翻译），没有则 \`null\`。 */
export function mechBlocker(block: SyntaxNodeLike | null, env?: MechTypeEnv): { type: string; text: string } | null {
  if (!block) return null;
  return createTranslator(env).blocker(block);
}
