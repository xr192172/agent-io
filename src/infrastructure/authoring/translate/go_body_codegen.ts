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
      // ★ 2026-10-29（体回译的真根因）：Go 里 **`var x` 非法**（必须带类型或值）。
      //   原来无值时渲染 `var x` ⇒ 不是合法 Go ⇒ tree-sitter 出 ERROR 节点
      //   ⇒ 回环 lift 失败、或被容错解析粘成别的结构（43 个不等构里绝大多数是这个）。
      //   ⇒ 无值时补 `any`（再 lift 时类型被忽略，结构仍一致）。
      return s.value ? `var ${s.name} = ${goExpr(s.value)}` : `var ${s.name} any`;
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
      // ★★★ 2026-10-29（体回译抓到的真 bug）：Go 的 `for i, v := range` 是**位置绑定** ——
      //   只写一个名字绑的是**下标**，不是值！原来 `[s.index, s.value].filter(Boolean)` 把
      //   `for _, it := range items`（index=null, value='it'）渲染成 `for it := range items`，
      //   再 lift 回来就成了 index='it' ⇒ 结构不等构（实测占剩余 35 个里的大多数）。
      //   ⇒ 有 value 时必须显式保留 `_` 占位。
      let head: string;
      if (s.index && s.value) head = `${s.index}, ${s.value} := range ${goExpr(s.target)}`;
      else if (s.index) head = `${s.index} := range ${goExpr(s.target)}`;
      else if (s.value) head = `_, ${s.value} := range ${goExpr(s.target)}`;
      else head = `range ${goExpr(s.target)}`;
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
      // ★ 2026-10-29（T-#RT-COMPOSITE）：优先用**真类型**复原，占位只作兜底
      const t =
        e.typeText ?? (e.kind === 'map' ? 'map[string]int' : e.kind === 'slice' ? '[]int' : 'struct{ x int }');
      return `${t}{${items}}`;
    }
    case 'builtin':
      return `${e.name}(${e.args.map(goExpr).join(', ')})`;
    default:
      throw new Error('renderGoBody: 未支持的 IR 表达式 ' + (e as { k: string }).k);
  }
}
