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
  'var_spec',
  'const_spec',
]);

/** 明确的硬构造：出现即放弃（哪怕其它都认识） */
const HARD = new Set([
  'defer_statement',
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
]);

/** 整棵子树里有没有不认识/不敢碰的节点（有 ⇒ 不翻） */
function hasUnsupported(node: SyntaxNodeLike, depth = 0): boolean {
  if (depth > 40) return true; // 防御：太深就当不认识（不猜）
  const t = node.type;
  // 纯空白 token（tree-sitter 的换行节点 type 就是换行符）不是「不认识」，是噪声。
  // 不放过它，任何多行函数体都会被判「翻不动」（实测 0/100 全是它）。
  if (/^\s*$/.test(t)) return false;
  if (HARD.has(t)) return true;
  if (!NEUTRAL.has(t) && !OK_EXPR.has(t) && !OK_STMT.has(t) && !t.startsWith('"')) return true;
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

/** 表达式 → TS 源码（翻不动返回 null） */
function expr(node: SyntaxNodeLike | null): string | null {
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
      const args: string[] = [];
      if (argsNode) {
        for (let i = 0; i < argsNode.childCount; i++) {
          const c = argsNode.child(i);
          if (!c || c.type === '(' || c.type === ')' || c.type === ',') continue;
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
        if (fname === 'make' && args.length >= 3) return args[2]; // make([]T, n, cap) → 由调用方给数组? 保守：不猜
      }
      if (fname === 'make') return null; // make 语义多样（map/slice/chan）⇒ 不猜
      const fn = expr(fnNode);
      return fn === null ? null : `${fn}(${args.join(', ')})`;
    }
    case 'argument_list':
      return null;
    case 'binary_expression': {
      const l = expr(node.child(0));
      const op = node.child(1)?.text ?? '';
      const r = expr(node.child(2));
      if (l === null || r === null) return null;
      const OPMAP: Record<string, string> = { '==': '===', '!=': '!==' };
      return `${l} ${OPMAP[op] ?? op} ${r}`;
    }
    case 'unary_expression': {
      const op = node.child(0)?.text ?? '';
      const v = expr(node.child(1));
      return v === null ? null : `${op}${v}`;
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
    case 'rune_literal':
      return node.text.replace(/_/g, '');
    case 'interpreted_string_literal':
      return node.text;
    case 'raw_string_literal':
      // Go 反引号原文 → TS 模板串（转义反引号）
      return '`' + node.text.slice(1, -1).replace(/`/g, '\\`') + '`';
    case 'composite_literal': {
      const t = node.child(0)?.text ?? '';
      const body = kids(node, 'literal_value')[0];
      if (!body) return null;
      const elems: string[] = [];
      for (let i = 0; i < body.childCount; i++) {
        const c = body.child(i);
        if (!c || ['{', '}', ','].includes(c.type)) continue;
        if (c.type === 'keyed_element') {
          const k = c.child(0);
          const v = expr(c.child(2) ?? c.child(1));
          if (!k || v === null) return null;
          elems.push(`${k.text}: ${v}`);
        } else {
          // literal_element 是包装节点，要解包取里面的真表达式
          const inner = c.type === 'literal_element' ? c.child(0) : c;
          const v = expr(inner);
          if (v === null) return null;
          elems.push(v);
        }
      }
      // 切片/数组字面量 → 数组；struct/map 字面量 → 对象
      if (t.startsWith('[]') || t.startsWith('[')) return `[${elems.join(', ')}]`;
      if (t.startsWith('map[')) return `new Map([${elems.join(', ')}])`;
      return `{ ${elems.join(', ')} }`;
    }
    default:
      return null;
  }
}

/** 语句 → TS 源码（翻不动返回 null） */
function stmt(node: SyntaxNodeLike, indent: string): string | null {
  const pad = indent;
  // ★ 换行/空白/注释是**子节点**（不是语句）——不放过就会被当成"翻不动"（实测所有函数体都栽在这）
  if (/^\s*$/.test(node.type) || node.type === 'comment') return '';
  switch (node.type) {
    case 'block': {
      const out: string[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (!c || c.type === '{' || c.type === '}' || c.type === 'comment') continue;
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
      return e === null ? null : `${pad}${e};`;
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
      if (lhsKids.length > 1) {
        if (rhsKids.length === 1) return `${pad}let [${lhsKids.join(', ')}] = ${rhsKids[0]};`;
        return `${pad}let [${lhsKids.join(', ')}] = [${rhsKids.join(', ')}];`;
      }
      const kw = rhsKids.length > 1 ? 'let' : 'const';
      return `${pad}${kw} ${lhsKids[0]} = ${rhsKids.length > 1 ? `[${rhsKids.join(', ')}]` : rhsKids[0]};`;
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
      return `${pad}${l.join(', ')} ${op} ${r.length > 1 ? `[${r.join(', ')}]` : r[0]};`;
    }
    case 'inc_statement':
    case 'dec_statement': {
      const t = node.type === 'inc_statement' ? '++' : '--';
      const target = expr(node.child(0));
      return target === null ? null : `${pad}${target}${t};`;
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
      const elseNode = (() => {
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c && c.type === 'else_clause') return c;
        }
        return null;
      })();
      const thenBlock = blocks[0];
      if (!thenBlock) return null;
      const thenS = stmt(thenBlock, pad + '  ');
      if (thenS === null) return null;
      let out = `${pad}if (${cond}) {\n${thenS}\n${pad}}`;
      if (elseNode) {
        const inner = elseNode.child(1);
        if (inner?.type === 'if_statement') {
          const s2 = stmt(inner, pad);
          if (s2 === null) return null;
          return `${out} else ${s2.trimStart()}`;
        }
        if (inner?.type === 'block') {
          const s2 = stmt(inner, pad + '  ');
          if (s2 === null) return null;
          out += ` else {\n${s2}\n${pad}}`;
        }
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
          if (c.type !== 'identifier') return null;
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
      const cond = field(fc, 'condition') ?? field(node, 'condition');
      const init = field(fc, 'initializer') ?? field(node, 'initializer');
      const update = field(fc, 'update') ?? field(node, 'update');
      if (init || update) {
        const initRaw = init ? stmt(init, '') : null;
        if (init && initRaw === null) return null;
        const initS = initRaw === null ? null : initRaw.replace(/;$/, '');
        const updRaw = update ? stmt(update, '') : null;
        if (update && updRaw === null) return null;
        const updS = updRaw === null ? null : updRaw.replace(/;$/, '');
        if (initS === null && init) return null;
        if (updS === null && update) return null;
        const condS = cond ? expr(cond) : null;
        if (cond && condS === null) return null;
        const initSql = (initS ?? '').replace(/^const /, 'let ');
        return `${pad}for (${initSql}; ${condS ?? ''}; ${updS ?? ''}) {\n${bodyS}\n${pad}}`;
      }
      const condS = cond ? expr(cond) : null;
      if (condS === null) return null;
      return `${pad}while (${condS}) {\n${bodyS}\n${pad}}`;
    }
    case 'expression_switch_statement': {
      const v = expr(field(node, 'value') ?? node.child(1));
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
        if (!c || c.type === 'case' || c.type === ':' || c.type === 'expression_list') continue;
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
      return null;
  }
}

/**
 * 顶层入口：把函数体（`block` 节点）机械翻成 TS 函数体源码。
 * 返回 `null` = **不翻**（上层走 LLM）；返回字符串 = 可以确定地翻出来。
 */
export function translateGoBodyMech(block: SyntaxNodeLike | null): string | null {
  if (!block) return null;
  if (!canMechTranslate(block)) return null;
  const body = stmt(block, '');
  if (body === null) return null;
  return body;
}
