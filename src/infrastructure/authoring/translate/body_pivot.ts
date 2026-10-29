/**
 * ★★★ 2026-10-29（T-#PIVOT-LIFTPROJ）：**函数体也走轴心** —— `lift_go` + `project_ts` 的第一条竖切。
 *
 * ## 为什么（这是轴心的最后一块）
 * 现在 `body_mech` 是 **Go→TS 直连**：它一边读 Go AST，一边直接吐 TS 文本。
 * 加第三种语言就要再写一遍"Go→Rust" ⇒ 回到 N²。轴心要求：**中间必须有一个中立表示**。
 * ```
 * body_mech（今天）:  Go AST ──────────────→ TS 文本
 * 轴心（目标）    :  Go AST ──lift──→ 体 IR ──project──→ TS 文本（或 Rust 文本）
 * ```
 *
 * ## 本文件的边界（诚实，逐条可查）
 * · 只覆盖**第一批构造**：`block` / `return` / `expression_statement` /
 *   表达式 `ident` `int` `string` `selector` `call` `binary`；
 * · **遇到任何未覆盖的节点 ⇒ `lift` 返回 `null`**（上层回落 legacy 直连路径），
 *   **绝不半翻**——半翻出来的东西既不是 Go 也不是 TS；
 * · 输出必须与 legacy **逐 token 相同**（`t447` 判据），否则说明这次拆分改变了语义。
 *
 * ## IR 为什么长这样
 * IR 里**只有语义，没有语法**：没有分号、没有缩进、没有 `let/const` 的选择（那是 `project_ts` 的事），
 * 也没有 Go 的 `:=`（IR 只说"声明并赋值"）。这样 Rust 渲染器可以自己决定用 `let mut`。
 */
import type { SyntaxNodeLike } from '../../parse/index.js';

/** 体 IR：语句 */
export type IrStmt =
  | { k: 'return'; values: IrExpr[] }
  | { k: 'expr'; value: IrExpr }
  | { k: 'declare'; name: string; value: IrExpr | null; mutable: boolean }
  | { k: 'assign'; target: IrExpr; op: string; value: IrExpr };

/** 体 IR：表达式 */
export type IrExpr =
  | { k: 'ident'; name: string }
  | { k: 'int'; value: string }
  | { k: 'str'; raw: string }
  | { k: 'sel'; x: IrExpr; member: string }
  | { k: 'call'; fn: IrExpr; args: IrExpr[] }
  | { k: 'bin'; op: string; l: IrExpr; r: IrExpr }
  /**
   * ★★★ **内建槽**：`len` / `cap` / `append` 这类**语言无关语义**（"长度"/"追加"）。
   * 它们不是普通函数调用：每个目标语言都有自己的写法（TS 是 `.length` / 展开运算符，
   * Rust 是 `.len()` / `push`）⇒ 必须由轴心建模，**不能留在 Go 适配器里硬编码成 TS 语法**。
   * （这条是证 t447 逼出来的：第一版把它们当普通 call ⇒ 输出 `len(x)`，与 legacy 的 `x.length` 不一致。）
   */
  | { k: 'builtin'; name: string; args: IrExpr[] };

/** 列举本竖切支持的节点类型（未列出的一律 lift→null） */
const OK_STMT = new Set(['block', 'return_statement', 'expression_statement', 'short_var_declaration', 'assignment_statement']);
const OK_EXPR = new Set([
  'identifier',
  'int_literal',
  'interpreted_string_literal',
  'raw_string_literal',
  'selector_expression',
  'call_expression',
  'binary_expression',
  'expression_list',
  'argument_list',
]);

/** 匿名 token（`{` `}` `(` `)` `,` `;` 等）跳过用：命名节点为 false 或类型是纯符号 */
const ignorable = (n: SyntaxNodeLike): boolean => n.isNamed === false || !/\S/.test(n.type);

/**
 * **Go AST → 体 IR**。不支持就返回 `null`（调用方回落 legacy）。
 * `env` 只用于判断"能不能翻"，不参与 IR 结构。
 */
export function liftGoBody(block: SyntaxNodeLike): IrStmt[] | null {
  const stmts = kidsOf(block);
  const out: IrStmt[] = [];
  for (const s of stmts) {
    const lifted = liftStmt(s);
    if (!lifted) return null;
    out.push(lifted);
  }
  return out;
}

function kidsOf(n: SyntaxNodeLike): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i);
    if (c && !ignorable(c)) out.push(c);
  }
  return out;
}

function liftStmt(n: SyntaxNodeLike): IrStmt | null {
  if (!OK_STMT.has(n.type)) return null;
  switch (n.type) {
    case 'block': {
      // 语句块在本竖切里不当独立语句用（避免嵌套块歧义）
      return null;
    }
    case 'return_statement': {
      const list = kidsOf(n).find((c) => c.type === 'expression_list');
      if (!list) return { k: 'return', values: [] };
      const values = kidsOf(list).map(liftExpr);
      if (values.some((v) => !v)) return null;
      return { k: 'return', values: values as IrExpr[] };
    }
    case 'expression_statement': {
      const e = kidsOf(n)[0];
      if (!e) return null;
      const value = liftExpr(e);
      return value ? { k: 'expr', value } : null;
    }
    case 'short_var_declaration': {
      const lists = kidsOf(n).filter((c) => c.type === 'expression_list');
      if (lists.length !== 2) return null;
      const lhs = kidsOf(lists[0]);
      const rhs = kidsOf(lists[1]);
      if (lhs.length !== 1 || rhs.length !== 1) return null;
      if (lhs[0].type !== 'identifier') return null;
      const value = liftExpr(rhs[0]);
      return value ? { k: 'declare', name: lhs[0].text, value, mutable: true } : null;
    }
    case 'assignment_statement': {
      const lists = kidsOf(n).filter((c) => c.type === 'expression_list');
      if (lists.length !== 2) return null;
      const lhs = kidsOf(lists[0]);
      const rhs = kidsOf(lists[1]);
      if (lhs.length !== 1 || rhs.length !== 1) return null;
      const target = liftExpr(lhs[0]);
      const value = liftExpr(rhs[0]);
      if (!target || !value) return null;
      // 赋值运算符在匿名 token 里
      let op = '=';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && !c.isNamed && /^(\+|-|\*|\/|%|&|\||\^|<<|>>)?=$/.test(c.type)) op = c.type;
      }
      return { k: 'assign', target, op, value };
    }
    default:
      return null;
  }
}

function liftExpr(n: SyntaxNodeLike): IrExpr | null {
  if (!OK_EXPR.has(n.type)) return null;
  switch (n.type) {
    case 'identifier':
      return { k: 'ident', name: n.text };
    case 'int_literal':
      return { k: 'int', value: normalizeInt(n.text) };
    case 'interpreted_string_literal':
    case 'raw_string_literal':
      return { k: 'str', raw: n.text };
    case 'selector_expression': {
      const parts = kidsOf(n);
      if (parts.length !== 2) return null;
      const x = liftExpr(parts[0]);
      if (!x) return null;
      return { k: 'sel', x, member: parts[1].text };
    }
    case 'call_expression': {
      const parts = kidsOf(n);
      const fnNode = parts.find((c) => c.type === 'identifier' || c.type === 'selector_expression');
      // ★ 内建槽：`len(x)` / `cap(x)` / `append(s, x…)` ⇒ 不走普通 call
      const CONV_RE = /^(u?int(8|16|32|64)?|uintptr|byte|rune|float(32|64)|string|bool)$/;
      const isBuiltin = fnNode && fnNode.type === 'identifier' && ['len', 'cap', 'append'].includes(fnNode.text);
      // ★ **类型转换也是内建槽**：`float64(x)`/`int(x)` 是"转成实数/整数"的语义，
      //   不是普通函数调用。目标语言各有写法（TS: 直接 number / Math.trunc / String）⇒ 归渲染器。
      //   （这条是证 t441「float64(x) 与 len(s)」对拍失败逼出来的：我第一版把转换当普通 call，
      //    直接吐出 `float64(x)` —— Go 的语法漏进了 TS 产物。）
      const isConv = fnNode && fnNode.type === 'identifier' && CONV_RE.test(fnNode.text);
      if (isBuiltin || isConv) {
        const argList = parts.find((c) => c.type === 'argument_list');
        const args: IrExpr[] = [];
        if (argList) {
          for (const a of kidsOf(argList)) {
            const e = liftExpr(a);
            if (!e) return null;
            args.push(e);
          }
        }
        return { k: 'builtin', name: fnNode.text, args };
      }
      if (!fnNode) return null;
      const fn = liftExpr(fnNode);
      if (!fn) return null;
      const argList = parts.find((c) => c.type === 'argument_list');
      const args: IrExpr[] = [];
      if (argList) {
        for (const a of kidsOf(argList)) {
          const e = liftExpr(a);
          if (!e) return null;
          args.push(e);
        }
      }
      return { k: 'call', fn, args };
    }
    case 'binary_expression': {
      const parts = kidsOf(n);
      if (parts.length !== 2) return null;
      const l = liftExpr(parts[0]);
      const r = liftExpr(parts[1]);
      if (!l || !r) return null;
      // 运算符是匿名 token，位于两操作数之间
      let op = '';
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && !c.isNamed) {
          op = c.type;
          break;
        }
      }
      if (!op) return null;
      return { k: 'bin', op, l, r };
    }
    default:
      return null;
  }
}

/** Go 老式八进制 `0644` → TS `0o644`（与 legacy 的 `normalizeLegacyOctal` 同规则） */
function normalizeInt(text: string): string {
  if (/^0[0-7]+$/.test(text)) return '0o' + text.slice(1);
  return text;
}

/** **体 IR → TS 文本**（只此一处决定 TS 语法；Rust 渲染器会是另一个函数） */
export function projectTsBody(stmts: IrStmt[], indent = 1): string {
  return stmts.map((s) => indentStr(indent) + projectTsStmt(s, indent)).join('\n');
}

function indentStr(n: number): string {
  return '  '.repeat(n);
}

function projectTsStmt(s: IrStmt, indent: number): string {
  switch (s.k) {
    case 'return':
      return `return${s.values.length ? ' ' + s.values.map(projectTsExpr).join(', ') : ''};`;
    case 'expr':
      return `${projectTsExpr(s.value)};`;
    case 'declare':
      // ★ Go 的 `:=` 一律落 `let`（不能用 const：Go 里后续可以再赋值，实测过 const 会炸）
      return `${s.mutable ? 'let' : 'const'} ${s.name}${s.value ? ' = ' + projectTsExpr(s.value) : ''};`;
    case 'assign':
      return `${projectTsExpr(s.target)} ${s.op} ${projectTsExpr(s.value)};`;
    default:
      throw new Error('projectTsStmt: 未知 IR 语句');
  }
}

function projectTsExpr(e: IrExpr): string {
  switch (e.k) {
    case 'ident':
      return e.name;
    case 'int':
      return e.value;
    case 'str':
      return e.raw;
    case 'sel':
      return `${projectTsExpr(e.x)}.${e.member}`;
    case 'call':
      return `${projectTsExpr(e.fn)}(${e.args.map(projectTsExpr).join(', ')})`;
    case 'bin': {
      // ★ TS 渲染器的决定：Go 的 `==` / `!=` 落成严格相等 `===` / `!==`。
      //   轴心只说"这是相等比较"，具体写法归渲染器（Rust 渲染器会是 `==`）。
      const op = e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op;
      return `${projectTsExpr(e.l)} ${op} ${projectTsExpr(e.r)}`;
    }
    case 'builtin': {
      // TS 渲染器的决定：长度 → `.length`；追加 → 展开运算符
      if (e.name === 'len' || e.name === 'cap') return `${projectTsExpr(e.args[0])}.length`;
      if (e.name === 'append') {
        const [head, ...rest] = e.args;
        return `[...${projectTsExpr(head)}, ${rest.map(projectTsExpr).join(', ')}]`;
      }
      // 数值/字符串转换（TS 渲染器的决定；与 legacy 的 GO_CONV 等价）
      const a = e.args.map(projectTsExpr).join(', ');
      if (/^(u?int(8|16|32|64)?|uintptr|byte|rune)$/.test(e.name)) return `Math.trunc(${a})`;
      if (/^float(32|64)$/.test(e.name)) return a; // TS 的 number 就是 f64 ⇒ 无需转换
      if (e.name === 'string') return `String(${a})`;
      if (e.name === 'bool') return `Boolean(${a})`;
      throw new Error('未支持的内建：' + e.name);
    }
    default:
      throw new Error('projectTsExpr: 未知 IR 表达式');
  }
}
