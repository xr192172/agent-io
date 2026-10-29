/**
 * ★★★ 2026-10-29（T-#PIVOT-BODY-ROUNDTRIP）：**第三个渲染器** —— `体 IR → Go`。
 *
 * ## 为什么需要它
 * 类型层已由 `t446` 证明"穿过轴心无损"；**体层此前没有对手方**（体 IR 不落盘、也没有 Go 渲染器）
 * ⇒ 无法回答"函数体在轴心里有没有走丢"。
 * 有了它就能做最强的那条判据：**IR → Go → IR 等构**（比结构，不比文本格式）。
 *
 * ## 边界
 * · 只渲染本竖切覆盖的 IR 构造；遇到未覆盖的 IR 节点**直接抛错**（不静默产出半截 Go）；
 * · Go 侧是**规范形**（`:=` 一律展开成 `var x = …`）⇒ 文本必与原文不同，这正是要比较**结构**的原因；
 * · `composite` 的类型名是占位（`map[string]int` 等），只保证"能重新解析"，
 *   不是原文类型（原文类型在 `pivot.shape`/`params` 里，这里只渲染体）。
 */
import type { IrExpr, IrStmt } from './body_pivot.js';

export function renderGoBody(stmts: IrStmt[], indent = 1): string {
  const pad = '\t'.repeat(indent);
  return stmts.map((s) => pad + goStmt(s, indent)).join('\n');
}

function goStmt(s: IrStmt, indent: number): string {
  const pad = '\t'.repeat(indent);
  switch (s.k) {
    case 'return':
      return 'return' + (s.values.length ? ' ' + s.values.map(goExpr).join(', ') : '');
    case 'expr':
      return goExpr(s.value);
    case 'declare':
      return s.value ? `var ${s.name} = ${goExpr(s.value)}` : `var ${s.name}`;
    case 'assign':
      return `${goExpr(s.target)} ${s.op} ${goExpr(s.value)}`;
    case 'incdec':
      return `${goExpr(s.target)}${s.op}`;
    case 'jump':
      return s.op;
    case 'block':
      return `{\n${renderGoBody(s.body, indent + 1)}\n${pad}}`;
    case 'if': {
      const then = renderGoBody(s.then, indent + 1);
      let out = `if ${goExpr(s.cond)} {\n${then}\n${pad}}`;
      if (s.else) {
        out += Array.isArray(s.else)
          ? ` else {\n${renderGoBody(s.else, indent + 1)}\n${pad}}`
          : ` else ${goStmt(s.else, indent)}`;
      }
      return out;
    }
    case 'while':
      return `for ${goExpr(s.cond)} {\n${renderGoBody(s.body, indent + 1)}\n${pad}}`;
    case 'for': {
      if (!s.init && !s.cond && !s.post) return `for {\n${renderGoBody(s.body, indent + 1)}\n${pad}}`;
      const init = s.init ? goStmt(s.init, 0) : '';
      const post = s.post ? goStmt(s.post, 0) : '';
      const cond = s.cond ? goExpr(s.cond) : '';
      return `for ${init}; ${cond}; ${post} {\n${renderGoBody(s.body, indent + 1)}\n${pad}}`;
    }
    case 'range': {
      const names = [s.index, s.value].filter(Boolean).join(', ');
      const head = names ? `${names} := range ${goExpr(s.target)}` : `range ${goExpr(s.target)}`;
      return `for ${head} {\n${renderGoBody(s.body, indent + 1)}\n${pad}}`;
    }
    case 'defer':
      return `defer ${goExpr(s.call)}`;
    case 'switch': {
      const lines: string[] = [];
      for (const c of s.cases) {
        lines.push(pad + '\t' + (c.labels ? `case ${c.labels.map(goExpr).join(', ')}:` : 'default:'));
        if (c.body.length) lines.push(renderGoBody(c.body, indent + 2));
      }
      return `switch ${goExpr(s.disc)} {\n${lines.join('\n')}\n${pad}}`;
    }
    default:
      throw new Error('renderGoBody: 未支持的 IR 语句 ' + (s as { k: string }).k);
  }
}

export function goExpr(e: IrExpr): string {
  switch (e.k) {
    case 'ident':
      return e.name;
    case 'int':
      return e.value;
    case 'str':
      return e.raw;
    case 'bool':
      return e.value ? 'true' : 'false';
    case 'nil':
      return 'nil';
    case 'sel':
      return `${goExpr(e.x)}.${e.member}`;
    case 'call':
      return `${goExpr(e.fn)}(${e.args.map(goExpr).join(', ')})`;
    case 'bin':
      return `${goExpr(e.l)} ${e.op} ${goExpr(e.r)}`;
    case 'unary':
      return `${e.op}${goExpr(e.x)}`;
    case 'paren':
      return `(${goExpr(e.x)})`;
    case 'index':
      return `${goExpr(e.x)}[${goExpr(e.idx)}]`;
    case 'slice':
      return `${goExpr(e.x)}[${e.lo ? goExpr(e.lo) : ''}:${e.hi ? goExpr(e.hi) : ''}]`;
    case 'composite': {
      const items = e.elems
        .map((x) => (x.key ? `${goExpr(x.key)}: ${goExpr(x.value)}` : goExpr(x.value)))
        .join(', ');
      const t = e.kind === 'map' ? 'map[string]int' : e.kind === 'slice' ? '[]int' : 'struct{ x int }';
      return `${t}{${items}}`;
    }
    case 'builtin':
      return `${e.name}(${e.args.map(goExpr).join(', ')})`;
    default:
      throw new Error('renderGoBody: 未支持的 IR 表达式 ' + (e as { k: string }).k);
  }
}
