/**
 * ★★★ 2026-10-29（T-#PIVOT-ROUNDTRIP）：**第二个渲染器** —— `pivot → Go`。
 *
 * ## 为什么需要它
 * 轴心要证明自己"能多目标"，光有 TS 渲染器是证明不了的（一条腿）。这里加 Go 渲染器，
 * 用途有两个，都真：
 *   1. **回译探针**：`Go → pivot → Go`，看类型信息在轴心里有没有走丢（丢了 ⇒ 轴心缺一维）；
 *   2. **未来的 Go 目标**：Go↔TS 双向、乃至第三种语言都走同一条路，这个渲染器不白写。
 *
 * ## 与 TS 渲染器的关系
 * 两者**都只读 `pivot`**（`PivotUnit`），互不知道对方存在 —— 这正是轴心该有的样子：
 * `pivot` 是唯一事实，渲染器是可替换的投影。
 *
 * ## 边界（诚实）
 * · 只渲染**签名/类型**，不渲染函数体（body 还是 `body_mech` 直连，属 `T-#PIVOT-LIFTPROJ`）；
 * · `unsupported` 度类型渲染成注释占位 `/*unsupported:…*\/`，**不静默降级**；
 * · 匿名 struct 用 Go 的内联写法；接口方法集按 Go 语法输出，实现程度见 `[未核]`。
 */
import type { TypeRef } from './unit.js';
import type { PivotUnit } from './book_ts.js';

export interface GoRenderResult {
  text: string;
  unsupported: boolean;
}

/** `TypeRef` → Go 类型文本（轴心 → Go 投影；零正则） */
export function renderGoType(ref: TypeRef | undefined): GoRenderResult {
  if (!ref) return { text: 'any', unsupported: true };
  switch (ref.kind) {
    case 'ident':
      return { text: ref.name, unsupported: false };
    case 'qualified':
      return { text: `${ref.pkg}.${ref.name}`, unsupported: false };
    case 'pointer':
      return { text: '*' + renderGoType(ref.elem).text, unsupported: false };
    case 'slice':
      return { text: '[]' + renderGoType(ref.elem).text, unsupported: false };
    case 'variadic':
      return { text: '...' + renderGoType(ref.elem).text, unsupported: false };
    case 'array':
      return { text: '[' + String(ref.length ?? '') + ']' + renderGoType(ref.elem).text, unsupported: false };
    case 'map':
      return { text: `map[${renderGoType(ref.key).text}]` + renderGoType(ref.value).text, unsupported: false };
    case 'chan': {
      const dir = ref.dir === 'send' ? 'chan<- ' : ref.dir === 'recv' ? '<-chan ' : 'chan ';
      return { text: dir + renderGoType(ref.elem).text, unsupported: false };
    }
    case 'func': {
      const ps = ref.params.map((p) => renderGoType(p.type).text).join(', ');
      const rs = ref.results.map((r) => renderGoType(r).text);
      const ret = rs.length === 0 ? '' : rs.length === 1 ? ' ' + rs[0] : ' (' + rs.join(', ') + ')';
      return { text: `func(${ps})${ret}`, unsupported: false };
    }
    case 'struct': {
      const fs = ref.fields
        .map((f) => {
          const tag = f.tag ? ` \`${f.tag}\`` : '';
          return `${f.name} ${renderGoType(f.type).text}${tag}`;
        })
        .join('; ');
      return { text: `struct{ ${fs} }`, unsupported: false };
    }
    case 'interface': {
      const ms = ref.methods.map((m) => {
        const ps = m.params.map((p) => renderGoType(p.type).text).join(', ');
        const rs = m.results.map((r) => renderGoType(r).text);
        const ret = rs.length ? ' (' + rs.join(', ') + ')' : '';
        return `${m.name}(${ps})${ret}`;
      });
      const es = ref.embeds.map((e) => renderGoType(e).text);
      const body = [...es, ...ms].join('; ');
      return { text: `interface{ ${body} }`, unsupported: false };
    }
    case 'generic': {
      const base = renderGoType(ref.base).text;
      const args = ref.args.map((a) => renderGoType(a).text).join(', ');
      return { text: `${base}[${args}]`, unsupported: false };
    }
    case 'tuple': {
      const items = ref.items.map((i) => renderGoType(i).text);
      return { text: '(' + items.join(', ') + ')', unsupported: false };
    }
    default:
      return { text: `/*unsupported:${(ref as { kind?: string }).kind ?? '?'}*/`, unsupported: true };
  }
}

/**
 * `PivotUnit` → Go 签名（**只读 pivot**，与 TS 渲染器互不知情）。
 * `name` 由调用方给（Go 渲染器自己决定命名；轴心不管命名）。
 */
export function goSignatureFromPivot(p: PivotUnit, name: string): GoRenderResult {
  let unsupported = false;
  const params = (p.params ?? [])
    .map((x) => {
      const r = renderGoType(x.ref);
      if (r.unsupported) unsupported = true;
      return `${x.name} ${r.text}`;
    })
    .join(', ');
  const ret = p.result ? renderGoType(p.result) : { text: '', unsupported: false };
  if (ret.unsupported) unsupported = true;
  const tp = p.typeParams?.length ? `[${p.typeParams.join(', ')}]` : '';
  const retText = ret.text ? ' ' + ret.text : '';
  return { text: `func ${name}${tp}(${params})${retText}`, unsupported };
}
