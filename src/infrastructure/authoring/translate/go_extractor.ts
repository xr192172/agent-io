/**
 * go_extractor —— tree-sitter 萃取 Go 顶层函数 / 结构体，产出 trans_unit
 *
 * 定位：三段式落地的"① 语法萃取"（纯机械、可审、可回滚）。
 * 复用仓库共享解析根基 ts_kernel.parseAstRoot（tree-sitter-go，optionalDependency），
 * 不新造解析器。只做"抽取 → 归一化为 TransUnit"，不落盘、不生成目标语言。
 *
 * 切片范围（Go→TS 最小切片）：
 *   - 顶层 `func`（无 receiver，即非方法）
 *   - 顶层 `type X struct { ... }`（→ type 单元）
 *   - 方法（method_declaration）、接口、别名、并发/错误多返回值此处只透传原始
 *     result，由目标 codegen 判"不可机械翻译"并加约束，而非在此强行猜。
 */

import { parseAstRoot, type SyntaxNodeLike } from '../../parse/index.js';
import { DEFAULT_CONSTRAINTS, type TransUnit, type TranslateParam, type TranslateKind, type TypeRef, type TranslateMethod, type DecisionShape } from './unit.js';
import { evalConstExpr, constToTsLiteral, type ConstValue } from './const_eval.js';
import { lastLiftedIr, translateGoBodyMech } from './body_mech.js';
import { isValueStructType, noteShimInsert } from './body_pivot.js';
import fs from 'node:fs';

/** 从 Go AST 节点取字段子节点（tree-sitter 字段名访问，防御 null） */
function childField(node: SyntaxNodeLike, name: string): SyntaxNodeLike | null {
  try {
    return node.childForFieldName(name) ?? null;
  } catch {
    return null;
  }
}

/**
 * ★★★ 2026-10-28（T-#TYPE-AST）：**AST 节点 → 结构化类型树**（一次到底，不再拍平成字符串）。
 *
 * 这是"消灭下游 15 处正则"的关键一步：tree-sitter 已经告诉我们每个节点是什么类型
 * （`struct_type` / `function_type` / `map_type` / `slice_type` / `parameter_declaration` …），
 * 以前在 `typeNode.text` 把它拍成文本，下游再猜回来 —— 猜错的代价是 5/55 文件语法错。
 */
function typeRefFromNode(node: SyntaxNodeLike | null): TypeRef {
  if (!node) return { kind: 'unknown', text: '' };
  const kids: SyntaxNodeLike[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if ([',', '(', ')', '[', ']', '{', '}', ';', '.', '*', '<-', 'func', 'map', 'chan', 'struct', 'interface'].includes(c.type))
      continue;
    kids.push(c);
  }
  const last = (): TypeRef => typeRefFromNode(kids[kids.length - 1] ?? null);
  switch (node.type) {
    case 'type_identifier':
    case 'identifier':
      return { kind: 'ident', name: node.text };
    case 'qualified_type': {
      const names = kids.filter((k) => k.type === 'package_identifier' || k.type === 'type_identifier');
      return { kind: 'qualified', pkg: names[0]?.text ?? '', name: names[1]?.text ?? node.text };
    }
    case 'pointer_type':
      return { kind: 'pointer', elem: last() };
    case 'slice_type':
      return { kind: 'slice', elem: last() };
    case 'array_type': {
      const el = kids[kids.length - 1];
      const len = kids.length > 1 ? kids[0].text : null;
      return { kind: 'array', length: len, elem: typeRefFromNode(el ?? null) };
    }
    case 'map_type': {
      const [k, v] = kids;
      return { kind: 'map', key: typeRefFromNode(k ?? null), value: typeRefFromNode(v ?? null) };
    }
    case 'channel_type': {
      const txt = node.text;
      const dir: 'both' | 'send' | 'recv' = txt.startsWith('<-chan') ? 'recv' : /chan\s*<-/.test(txt) ? 'send' : 'both';
      return { kind: 'chan', dir, elem: last() };
    }
    case 'function_type': {
      const pl = kids.find((k) => k.type === 'parameter_list');
      const rest = kids.filter((k) => k !== pl);
      const params = pl ? paramRefsFromList(pl) : [];
      const results: TypeRef[] = [];
      for (const r of rest) {
        if (r.type === 'parameter_list') for (const p of paramRefsFromList(r)) results.push(p.type);
        else results.push(typeRefFromNode(r));
      }
      return { kind: 'func', params, results };
    }
    case 'struct_type': {
      const list = kids.find((k) => k.type === 'field_declaration_list');
      const fields: Array<{ name?: string; type: TypeRef; tag?: string }> = [];
      if (list) {
        for (let i = 0; i < list.childCount; i++) {
          const fd = list.child(i);
          if (!fd || fd.type !== 'field_declaration') continue;
          const names: string[] = [];
          let typeNode: SyntaxNodeLike | null = null;
          let tag: string | undefined;
          for (let j = 0; j < fd.childCount; j++) {
            const c = fd.child(j);
            if (!c) continue;
            if (c.type === 'field_identifier') names.push(c.text);
            else if (c.type === 'raw_string_literal') tag = c.text;
            else if (c.type !== ',' && c.type !== ';') typeNode = c;
          }
          const tr = typeRefFromNode(typeNode);
          if (!names.length) fields.push({ type: tr, tag }); // 嵌入字段
          else for (const nm of names) fields.push({ name: nm, type: tr, tag });
        }
      }
      return { kind: 'struct', fields };
    }
    case 'interface_type': {
      const methods: Array<{ name: string; params: Array<{ name?: string; type: TypeRef }>; results: TypeRef[] }> = [];
      const embeds: TypeRef[] = [];
      const collect = (node2: SyntaxNodeLike): void => {
        for (let i = 0; i < node2.childCount; i++) {
          const c = node2.child(i);
          if (!c) continue;
          if (c.type === 'method_elem') {
            let name = '';
            let pl: SyntaxNodeLike | null = null;
            const results: TypeRef[] = [];
            for (let j = 0; j < c.childCount; j++) {
              const k = c.child(j);
              if (!k) continue;
              if (k.type === 'field_identifier') name = k.text;
              else if (k.type === 'parameter_list') {
                if (!pl) pl = k;
                else for (const p of paramRefsFromList(k)) results.push(p.type);
              }
            }
            methods.push({ name, params: pl ? paramRefsFromList(pl) : [], results });
          } else if (c.type === 'type_elem' || c.type === 'type_identifier' || c.type === 'qualified_type') {
            embeds.push(typeRefFromNode(c));
          } else if (c.childCount > 0) collect(c);
        }
      };
      collect(node);
      return { kind: 'interface', methods, embeds };
    }
    case 'generic_type': {
      const base = kids.find((k) => k.type === 'type_identifier' || k.type === 'qualified_type') ?? kids[0];
      const argsNode = kids.find((k) => k.type === 'type_arguments');
      const args: TypeRef[] = [];
      if (argsNode) for (const k of argTypes(argsNode)) args.push(typeRefFromNode(k));
      return { kind: 'generic', base: typeRefFromNode(base ?? null), args };
    }
    case 'parenthesized_type': {
      const inner = kids.find((k) => k.type !== '(' && k.type !== ')');
      return typeRefFromNode(inner ?? null);
    }
    default:
      // 兜底：**如实记原文**，不猜（下游见到 unknown 就回退到字符串映射）
      return { kind: 'unknown', text: node.text };
  }
}

/** `type_arguments` 里的实参节点（`[K, V]` → [K, V]） */
function argTypes(node: SyntaxNodeLike): SyntaxNodeLike[] {
  const out: SyntaxNodeLike[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (['[', ']', ','].includes(c.type)) continue;
    out.push(c);
  }
  return out;
}

/**
 * ★★★ 2026-10-29（T-#SHIM-VALUE）：从 Go 的 `import_declaration` 取**包名**（不是猜），
 * 再据此在函数体里精确收集 `pkg.Member`（值位置：调用、常量）。
 * 包名规则：有别名用别名；否则取 import 路径最后一段（`path/filepath` → `filepath`）。
 */
function collectImportedPkgs(root: SyntaxNodeLike): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < root.childCount; i++) {
    const decl = root.child(i);
    if (!decl || decl.type !== 'import_declaration') continue;
    const specs: SyntaxNodeLike[] = [];
    const dig = (n: SyntaxNodeLike): void => {
      for (let j = 0; j < n.childCount; j++) {
        const c = n.child(j);
        if (!c) continue;
        if (c.type === 'import_spec') specs.push(c);
        else if (c.childCount > 0) dig(c);
      }
    };
    dig(decl);
    for (const sp of specs) {
      let alias: string | null = null;
      let pathText = '';
      for (let k = 0; k < sp.childCount; k++) {
        const c = sp.child(k);
        if (!c) continue;
        if (c.type === 'package_identifier') alias = c.text;
        else if (c.type === 'interpreted_string_literal') pathText = c.text.slice(1, -1);
      }
      if (alias && alias !== '_' && alias !== '.') out.add(alias);
      else if (pathText) {
        const seg = pathText.split('/').pop() ?? '';
        if (seg) out.add(seg);
      }
    }
  }
  return out;
}

/** 全文件扫一遍：`pkg.Member` 且 pkg 在 import 表里 ⇒ 收进值位置清单 */
function collectValueQualified(root: SyntaxNodeLike, pkgs: Set<string>): string[] {
  const out = new Set<string>();
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'selector_expression') {
      const op = n.child(0);
      const fld = n.child(2) ?? n.child(1);
      if (op && op.type === 'identifier' && pkgs.has(op.text) && fld) out.add(op.text + '.' + fld.text);
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return [...out];
}

/**
 * 返回类型节点兜底（★ 2026-10-28 重写）。
 *
 * 上一版按"第二个 parameter_list 就是返回值"猜 ⇒ **方法**上全错：方法有**两个** parameter_list
 * （接收者 `(st *SkillTree)` + 形参 `(nodes ...*SkillNode)`），于是把形参表当成了返回类型，
 * 生成了 `: ...*SkillNode`（TS 语法错）。
 * ⇒ 现在以**函数名（identifier）的位置**为准：**名字之后**的第一个 parameter_list 是形参，
 *   其后的第二个 parameter_list 或类型类节点才是返回值。接收者在名字之前，自然被排除。
 */
function findResultNode(node: SyntaxNodeLike): SyntaxNodeLike | null {
  let nameIdx = -1;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === 'identifier') {
      nameIdx = i;
      break;
    }
  }
  if (nameIdx < 0) return null;
  let paramsSeen = false;
  for (let i = nameIdx + 1; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (c.type === 'parameter_list') {
      if (!paramsSeen) {
        paramsSeen = true;
        continue; // 名字后的第一组 = 形参
      }
      return c; // 第二组 = 返回值列表
    }
    if (!paramsSeen) continue;
    if (['block', 'comment', 'type_parameter_list', '{', '(', ')', '}', ',', ';'].includes(c.type)) continue;
    return c; // 单返回值（类型类节点）
  }
  return null;
}

/** 返回类型节点 → TypeRef（单个 = 原样；多个 = tuple；无 = undefined） */
function resultRefFromNode(node: SyntaxNodeLike | null): TypeRef | undefined {
  if (!node) return undefined;
  const pl =
    node.type === 'parameter_list' ? node : (() => {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type === 'parameter_list') return c;
      }
      return null;
    })();
  if (pl) {
    const items = paramRefsFromList(pl).map((p) => p.type);
    if (items.length === 0) return undefined;
    return items.length === 1 ? items[0] : { kind: 'tuple', items };
  }
  return typeRefFromNode(node);
}

/** 参数列表 → [{name?, type: TypeRef}]（认分组写法 `a, b int`） */
function paramRefsFromList(pl: SyntaxNodeLike): Array<{ name?: string; type: TypeRef }> {
    const out: Array<{ name?: string; type: TypeRef }> = [];
    // ★★★ T-#EXTRACTOR-NAMEDRESULT（同一根因）：Go 的分组声明 `(a, b T)` 中类型只写在最后一个名字上。
    //   tree-sitter 会把 `a` 与 `b T` 拆成两个 parameter_declaration ⇒ 第一项没有 typeNode。
    //   旧实现遇到没有类型的第一项会原样 push（类型被推成名字）⇒ 形参与命名返回值都会错。
    //   正确做法：先攒「只有名字」的声明，遇到带类型的声明时**统一赋值**（这就是 Go 规范）。
    let pending: string[] = [];
    for (let i = 0; i < pl.childCount; i++) {
      const d = pl.child(i);
      if (!d) continue;
      if (d.type !== 'parameter_declaration' && d.type !== 'variadic_parameter_declaration') continue;
      const names: string[] = [];
      let typeNode: SyntaxNodeLike | null = null;
      for (let j = 0; j < d.childCount; j++) {
        const c = d.child(j);
        if (!c) continue;
        if (c.type === 'identifier') names.push(c.text);
        else if (c.type !== ',' && c.type !== '(' && c.type !== ')') typeNode = c;
      }
      if (!typeNode) {
        for (let k = 0; k < names.length; k++) pending.push(names[k]);
        continue;
      }
      const tr = typeRefFromNode(typeNode);
      const final = d.type === 'variadic_parameter_declaration' ? ({ kind: 'variadic', elem: tr } as TypeRef) : tr;
      if (pending.length) {
        for (let k = 0; k < pending.length; k++) out.push({ name: pending[k], type: final });
        pending = [];
      }
      if (!names.length) out.push({ type: final });
      else for (let k = 0; k < names.length; k++) out.push({ name: names[k], type: final });
    }
    return out;
  }

/** 收集参数列表块里的每个 parameter_declaration（展开 `a, b int` 为两条） */
function extractParamList(block: SyntaxNodeLike): TranslateParam[] {
  const out: TranslateParam[] = [];
  let idx = 0;
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    // ★★★ 2026-10-29（**TS2304 的一大根因**）：原来只收 `parameter_declaration`，
    //   **`variadic_parameter_declaration` 被整条跳过** ⇒ 签名里少了变参
    //   （`NewBuilder(heatStore, c, retrievers ...Retriever)` 只剩前两个参数）。
    //   LLM 照着 Go 原文写 `retrievers`，TS 里却没这个参数 ⇒ `Cannot find name 'retrievers'`。
    //   ⇒ 变参必须进签名（渲染成 `...name: T[]`）。
    if (!child || (child.type !== 'parameter_declaration' && child.type !== 'variadic_parameter_declaration')) continue;
    const typeNode = childField(child, 'type');
    // ★ 变参：类型文本带 `...` 前缀 ⇒ 下游（pivotOf）据此产出 rest 参数 `...name: T[]`
    const rawType = typeNode ? typeNode.text : 'unknown';
    const type =
      child.type === 'variadic_parameter_declaration' ? '...' + rawType : rawType;
    const names: string[] = [];
    for (let j = 0; j < child.childCount; j++) {
      const c = child.child(j);
      if (c && c.type === 'identifier') names.push(c.text);
    }
    const tr = typeRefFromNode(typeNode);
    if (names.length === 0) names.push(`arg${idx}`);
    for (const n of names) out.push({ name: n, type, typeRef: tr });
    idx++;
  }
  return out;
}

/** 解析 receiver 文本 → 参名 + 基类型名 + 泛型实参 + 可渲染全类型
 *  `(u *User)` → base User；`(p *Pair[T])` → base Pair, typeArgs ['T'], fullType 'Pair<T>' */
function parseReceiver(recvText: string): { name: string; base: string; typeArgs: string[]; fullType: string } | null {
  const m = recvText.match(/\(?\s*([A-Za-z_]\w*)\s+(?:\*\s*)?([\w.]+)(?:\[([^\]]*)\])?/);
  if (!m) return null;
  const base = m[2].replace(/\./g, '_');
  const typeArgs = (m[3] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z_]\w*$/.test(s));
  return { name: m[1], base, typeArgs, fullType: typeArgs.length ? `${base}<${typeArgs.join(', ')}>` : base };
}

/** 类型参数名（泛型）：`[T any]` / `[T comparable]` → ['T'] */
function extractTypeParams(node: SyntaxNodeLike): string[] {
  const list = childField(node, 'type_parameters') || findChildOfType(node, 'type_parameter_list');
  if (!list) return [];
  const names: string[] = [];
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i);
    if (!c || c.type !== 'type_parameter_declaration') continue;
    for (let j = 0; j < c.childCount; j++) {
      const id = c.child(j);
      if (id && id.type === 'identifier') {
        names.push(id.text);
        break;
      }
    }
  }
  return names;
}

/** 各类型参数 → 约束原文（`T comparable` → {T:'comparable'}；`T any` → {T:'any'}） */
function extractTypeConstraints(node: SyntaxNodeLike): Record<string, string> {
  const list = childField(node, 'type_parameters') || findChildOfType(node, 'type_parameter_list');
  if (!list) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i);
    if (!c || c.type !== 'type_parameter_declaration') continue;
    let name: string | undefined;
    let constraint = '';
    for (let j = 0; j < c.childCount; j++) {
      const k = c.child(j);
      if (!k) continue;
      if (!name && k.type === 'identifier') name = k.text;
      else if (name && (k.type === 'type_constraint' || k.type === 'type_identifier')) constraint = k.text;
    }
    if (name && constraint) out[name] = constraint;
  }
  return out;
}

/** 单个底层约束项 → 可表达的 TS 标量 bound；`~` 剥去（int/uint/float/string/bool/[]byte 等），不可表达返回 null */
function scalarConstBound(typeText: string): string | null {
  const t = typeText.replace(/^~/, '').trim();
  if (/^(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|byte|rune)$/.test(t)) return 'number';
  if (t === 'string') return 'string';
  if (t === 'bool') return 'boolean';
  if (t === '[]byte') return 'Uint8Array';
  return null;
}

/** 约束节点 → TS `extends` bound；含不可表达项（comparable/自定义）返回 ''（不设 bound） */
function boundFromConstraint(node: SyntaxNodeLike | null): string {
  if (!node) return '';
  const terms: string[] = [];
  const push = (text: string): boolean => {
    const b = scalarConstBound(text);
    if (!b) return false;
    if (!terms.includes(b)) terms.push(b);
    return true;
  };
  if (node.type === 'type_constraint') {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (!c) continue;
      if (c.type === 'negated_type' || c.type === 'type_identifier') {
        if (!push(c.text)) return '';
      }
    }
  } else if (node.type === 'type_identifier') {
    if (!push(node.text)) return '';
  } else {
    return '';
  }
  return terms.join(' | ');
}

/** 各类型参数的 TS `extends` bound（与 typeParams 同序；常约束给空串） */
function extractTypeParamBounds(node: SyntaxNodeLike): string[] {
  const list = childField(node, 'type_parameters') || findChildOfType(node, 'type_parameter_list');
  if (!list) return [];
  const bounds: string[] = [];
  for (let i = 0; i < list.childCount; i++) {
    const c = list.child(i);
    if (!c || c.type !== 'type_parameter_declaration') continue;
    let constraintNode: SyntaxNodeLike | null = null;
    for (let j = 0; j < c.childCount; j++) {
      const k = c.child(j);
      if (k && (k.type === 'type_constraint' || k.type === 'type_identifier')) {
        constraintNode = k;
        break;
      }
    }
    bounds.push(boundFromConstraint(constraintNode));
  }
  return bounds;
}

/** 函数体里的并发/资源语义 → 给 LLM 的提示（不硬猜，只指导映射方向） */
function appendBodyHints(snippet: string, constraints: string[]): void {
  if (/\bdefer\b/.test(snippet)) constraints.push('函数体含 defer：建议映射为 try/finally（或显式 close/finally），勿丢清理语义');
  if (/\bgo\s+\w/.test(snippet)) constraints.push('函数体含 go 语句：建议映射为异步 fire-and-forget（Promise），注意并发时序差异');
  if (/\bselect\b/.test(snippet)) constraints.push('函数体含 select：Go select 的 first-ready 竞态语义 TS 无等价物，需人工或 Promise.race 近似');
  if (/<-/.test(snippet)) constraints.push('函数体含 <- 通道收发：Channel<T> 垫片为近似，阻塞/竞态语义需人工核');
}

/** 归一化返回类型：去命名返回的名字，`(x int, err error)` → `(int, error)`；`(x int)` → `int` */
function normResult(s: string): string {
    const t = s.trim();
    if (!(t.startsWith('(') && t.endsWith(')'))) return t;
    const parts = t.slice(1, -1).split(',').map((p) => p.trim()).filter(Boolean);
    // ★★★ T-#EXTRACTOR-NAMEDRESULT：Go 的**分组声明**把类型只写在最后一个名字上 ——
    //   `(principle, fix string)` 里 principle 与 fix **都是 string**。
    //   旧实现逐项剥名 ⇒ 第一项没类型就原样留下 ⇒ 产出 `(principle, string)`（把**结果名当类型**）。
    //   判据：只要有任意一项是「名字 类型」形态，就是分组命名；裸标识符 = 待定名字，由后面第一个带类型的项统一赋值。
    //   若**全部**是裸标识符，则是无名类型列表 `(int, string)`，原样返回。
    const named = parts.some((p) => /^[A-Za-z_]\w*\s+\S/.test(p));
    if (!named) return parts.length === 1 ? parts[0] : '(' + parts.join(', ') + ')';
    const res: string[] = [];
    let pending: string[] = [];
    for (const p of parts) {
      const m = /^([A-Za-z_]\w*)\s+([\s\S]+)$/.exec(p);
      if (m) {
        for (let i = 0; i < pending.length; i++) res.push(m[2].trim());
        pending = [];
        res.push(m[2].trim());
      } else {
        pending.push(p);
      }
    }
    // 兜底：尾部仍有"只有名字没有类型"= 源不合法；原样保留，不猜
    for (let i = 0; i < pending.length; i++) res.push(pending[i]);
    return res.length === 1 ? res[0] : '(' + res.join(', ') + ')';
  }

/** func/方法 单元：`func Add(...)` 或 `func (u *User) Greet(...)` → TransUnit(kind='func')
 *  方法映射为 TS 自由函数：receiver 作首参，名取 `${recvType}_${method}`（防同文件多类型方法撞名）。 */
/**
 * ★★★ T-#NAMED-RESULTS：Go 类型文本 → **零值**字面量（TS 侧写法）。
 *
 * 命名返回值在 Go 里是**函数入口就存在的零值变量**；TS 没有这个概念，
 * 必须在体首显式落 `let x = <零值>`，否则 `dead = append(dead, id)` 直接 TS2304。
 * ★ 抽成纯函数是为了能被 `behavior-cases` 判（存在性判据发现不了这里的行为错）。
 */
export function zeroValueOf(typeText: string): string {
  const t = String(typeText ?? '').trim();
  if (t.startsWith('[]')) return '[]';
  if (t.startsWith('map[')) return 'new Map()';
  if (t === 'string') return "''";
  if (t === 'bool') return 'false';
  if (/^(u?int(8|16|32|64)?|uintptr|byte|rune|float(32|64))$/.test(t)) return '0';
  // 指针 / 接口 / error / 具名结构 / 未知：Go 的零值是 nil ⇒ TS 侧 null（宁缺不假）
  return 'null';
}

/**
 * ★★★ T-#NAMED-RESULTS：从 Go 的 result `parameter_list` 取**命名返回值**
 * （名字 + 类型文本 + **声明顺序**）。`_` 跳过。无命名（只有类型）⇒ 空数组。
 */
function namedResultsOf(resultNode: SyntaxNodeLike | null): Array<{ name: string; typeText: string }> {
  if (!resultNode || resultNode.type !== 'parameter_list') return [];
  const out: Array<{ name: string; typeText: string }> = [];
  for (let i = 0; i < resultNode.childCount; i++) {
    const d = resultNode.child(i);
    if (!d || d.type !== 'parameter_declaration') continue;
    const names: string[] = [];
    let typeText = '';
    for (let j = 0; j < d.childCount; j++) {
      const c = d.child(j);
      if (!c) continue;
      if (c.type === 'identifier') names.push(c.text);
      else if (c.isNamed !== false) typeText = c.text;
    }
    for (const nm of names) if (nm !== '_') out.push({ name: nm, typeText });
  }
  return out;
}

function unitFromFunc(node: SyntaxNodeLike): TransUnit | null {
  const nameNode = childField(node, 'name');
  if (!nameNode) return null;
  const method = nameNode.text;
  const paramsNode = childField(node, 'parameters');
  const params = paramsNode ? extractParamList(paramsNode) : [];
  // ★★ 2026-10-28（补漏）：`childField(node,'result')` 在**单返回值/方法**上常取不到
  //   ⇒ 那 4 个残留 TS2503（`time.Time` / `json.RawMessage` / `mem.Embedder`）都是"有返回类型文本、
  //   但没有 resultRef"造成的。这里补一个**结构兜底**：参数表之后的第二个 parameter_list 或最后一个类型节点。
  const resultNode = childField(node, 'result') ?? findResultNode(node);
  // ★ 2026-10-28（variadicResultGuard）：**返回类型不可能以 `...` 开头**（那是形参的可变标记）。
  //   不加这条守卫时，`func (st *SkillTree) upsertSkillNodesLocked(nodes ...*SkillNode)`（无返回值）
  //   会把 `...*SkillNode` 当成返回类型 ⇒ 生成 `: ...*SkillNode`（TS 语法错）。
  const variadicResultGuard = !!resultNode && resultNode.text.trim().startsWith('...');
  const result = resultNode && !variadicResultGuard ? normResult(resultNode.text.trim()) : null;
  // ★ 2026-10-28（T-#TYPE-AST）：返回类型的结构化树（多返回值 → tuple；无返回 → undefined）
  const resultRef = variadicResultGuard ? undefined : resultRefFromNode(resultNode);
  // ★ T-#NAMED-RESULTS：命名返回值（名字/类型/声明顺序）—— 之前完全没取 ⇒ 体里 dead/alive 无声明
  const namedResults = namedResultsOf(resultNode);
  const snippet = node.text.trim();
  const constraints = [...DEFAULT_CONSTRAINTS];
  appendBodyHints(snippet, constraints);
  // A3：函数体为 switch-on-expression → 锁定决策表结构（分支机械映射，LLM 只填动作）
  const decision = detectDecision(node);
  if (decision) constraints.push('决策表：switch 判别式与 case/default 分支已锁定，按给出分支一一翻译动作，不得增删 case、不得改判别式');

  const recvNode = childField(node, 'receiver');
  const recv = recvNode ? parseReceiver(recvNode.text) : null;
  const ownTypeParams = extractTypeParams(node);
  const typeParamConstraints = extractTypeConstraints(node);
  const typeParamBounds = extractTypeParamBounds(node);
  // ★★★ 2026-10-29（T-#MECH-BODY）：**先试机械翻**（AST 同构改写，零 LLM）。
  //   翻不动（defer/select/通道/类型断言/闭包…）就留 undefined，交给 LLM。
  //   ★ 这里只是"能不能确定翻出来"，不做"看起来差不多"的近似 —— 见 body_mech 的铁律注释。
  let bodyBlock: SyntaxNodeLike | null = null;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === 'block') {
      bodyBlock = c;
      break;
    }
  }
  // ★ 2026-10-29（T-#MECH-TYPES）：把**签名里的参数类型**当类型环境传进去
  //   ⇒ 翻译器能判 `n / 2` 是整除（Math.trunc）还是浮点除；判不出才交 LLM。
  const mechEnv = new Map<string, string>();
  for (const p of params) mechEnv.set(p.name, p.type);
  // ★★★ T-#SHIM-SITES（**最高频的复制位置：函数入口**）：Go 的值类型 struct 参数是**复制**传入的，
  //   TS 收到引用 ⇒ 入口显式 copy 一次才顶住值语义。
  //   放在**调用方**（不是 pivot 分支里）：这样 **pivot 与 legacy 两条路径都覆盖**
  //   （第一版放在 pivot 分支 ⇒ 只覆盖 38% 的体）。
  const valueParamsForMech = params.filter((p) => p.typeRef && p.typeRef.kind === 'ident').map((p) => p.name);
  const rawMech = translateGoBodyMech(bodyBlock, mechEnv);
  const entryCopies = valueParamsForMech.filter((nm) => isValueStructType(mechEnv.get(nm) ?? null));
  if (rawMech && entryCopies.length) noteShimInsert(entryCopies.length);
  const entryCopy = entryCopies.length ? entryCopies.map((nm) => `  ${nm} = copy(${nm});`).join('\n') + '\n' : '';
  // ★★★ T-#NAMED-RESULTS：命名返回值 = **入口零值变量** + **裸 return 返回它们**。
  //   ① 前置 `let x = <零值>`（Go 里它们一直存在；不落就是 TS2304）
  //   ② 裸 `return;` → `return [按声明序]`（Go 的裸 return 就是这个语义；顺序按**声明**不是字母序）
  const namedPrelude = namedResults.length
    ? namedResults.map((r) => `  let ${r.name} = ${zeroValueOf(r.typeText)};\n`).join('')
    : '';
  const rawMechNamed =
    rawMech && namedResults.length
      ? rawMech.replace(/^(\s*)return;\s*$/gm, `$1return [${namedResults.map((r) => r.name).join(', ')}];`)
      : rawMech;
  const mechBody = rawMechNamed ? entryCopy + namedPrelude + rawMechNamed : undefined;
  const usesSlot = entryCopies.length ? ['value'] : undefined;
  const bodyIr = lastLiftedIr() ?? undefined;
  const srcLine = node.startPosition.row + 1;
  if (recv) {
    // 方法：receiver 作首参（泛型 receiver 用全类型如 Pair<T>）；命名带类型基名前缀防撞名
    params.unshift({ name: recv.name, type: recv.fullType });
    const qn = `${recv.base}_${method}`;
    // 方法自身无类型参数时，继承 receiver 的泛型实参作为自由函数的 <T...>
    const typeParams = ownTypeParams.length ? ownTypeParams : recv.typeArgs;
    return { id: qn, kind: 'func', dstLang: 'ts', name: qn, params, result, resultRef, ...(mechBody ? { mechBody } : {}), ...(usesSlot ? { usesSlot } : {}), ...(bodyIr ? { ir: bodyIr } : {}), typeParams, typeParamConstraints, typeParamBounds, srcSnippet: snippet, srcLine, skeleton: '', bodyHole: true, constraints, decision };
  }
  return { id: method, kind: 'func', dstLang: 'ts', name: method, params, result, resultRef, ...(mechBody ? { mechBody } : {}), ...(usesSlot ? { usesSlot } : {}), ...(bodyIr ? { ir: bodyIr } : {}), typeParams: ownTypeParams, typeParamConstraints, typeParamBounds, srcSnippet: snippet, srcLine, skeleton: '', bodyHole: true, constraints, decision };
}

/** 取函数体顶层第一个 expression_switch_statement → 判别式 + 分支标签（A3）。无则 undefined */
function detectDecision(node: SyntaxNodeLike): DecisionShape | undefined {
  const body = childField(node, 'body');
  if (!body) return undefined;
  let sw: SyntaxNodeLike | null = null;
  for (let i = 0; i < body.childCount; i++) {
    const c = body.child(i);
    if (c && c.type === 'expression_switch_statement') {
      sw = c;
      break;
    }
  }
  if (!sw) return undefined;
  // 判别式：`switch <expr> {` → <expr>；`switch {` → 'true'
  const txt = sw.text;
  const lbrace = txt.indexOf('{');
  let disc = lbrace > 0 ? txt.slice('switch'.length, lbrace).trim() : '';
  if (!disc) disc = 'true';
  const cases: { labels: string[]; branchId: string }[] = [];
  let hasDefault = false;
  let idx = 0;
  for (let i = 0; i < sw.childCount; i++) {
    const c = sw.child(i);
    if (!c) continue;
    if (c.type === 'expression_case') {
      const labelNode = childField(c, 'value') || findChildOfType(c, 'expression_list');
      const labels = (labelNode?.text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      cases.push({ labels, branchId: `case${idx}` });
      idx++;
    } else if (c.type === 'default_case') {
      hasDefault = true;
    }
  }
  return { discriminant: disc, cases, hasDefault };
}

/** 直接子节点里找某类型（字段名兜底；tree-sitter-go 的 struct body 字段名是 body） */
function findChildOfType(node: SyntaxNodeLike, childType: string): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === childType) return c;
  }
  return null;
}

/** 单个 method_elem：`Greet(n string) string` → { name, params, result } */
function methodFromElem(elem: SyntaxNodeLike): TranslateMethod | null {
  let name = '';
  let params: TranslateParam[] = [];
  let result: string | null | undefined;
  let paramSeen = false;
  for (let i = 0; i < elem.childCount; i++) {
    const c = elem.child(i);
    if (!c) continue;
    if (c.type === 'field_identifier' && !name) name = c.text;
    else if (c.type === 'parameter_list') {
      if (paramSeen) result = normResult(c.text); // 第二个参数表 = 多返回值结果
      else {
        params = extractParamList(c);
        paramSeen = true;
      }
    } else if (c.type === 'type_identifier' && result === undefined) {
      result = normResult(c.text); // 单返回值
    }
  }
  if (!name) return null;
  return { name, params, ...(result !== undefined ? { result } : {}) };
}

/** interface_type 里的方法：方法体是 method_elem 节点（与 interface/花括号平级于 interface_type 下） */
function extractInterfaceMethods(iface: SyntaxNodeLike): TranslateMethod[] {
  const methods: TranslateMethod[] = [];
  for (let i = 0; i < iface.childCount; i++) {
    const c = iface.child(i);
    if (c && c.type === 'method_elem') {
      const m = methodFromElem(c);
      if (m) methods.push(m);
    }
  }
  return methods;
}

/**
 * ★★★ T-#EMBEDDED-FIELD：Go 嵌入字段的**隐式字段名**。
 * `graphNode` → `graphNode`；`*SkillNode` → `SkillNode`；`pkg.Base` → `Base`；`pkg.Base[T]` → `Base`。
 * 抽成纯函数是为了能被判据直接验（`call-exists` / `behavior-cases`），而不是靠读代码印象。
 */
export function embeddedFieldName(typeText: string): string {
  let t = String(typeText ?? '').trim();
  if (t.startsWith('*')) t = t.slice(1).trim();
  const noGeneric = t.replace(/\[[^\]]*\]$/, '');
  const seg = noGeneric.split('.').pop() ?? noGeneric;
  return seg.trim();
}

/** 顶层 type 单元：struct → interface；interface → interface(方法)；其余 → type 别名 */
function unitFromTypeSpec(spec: SyntaxNodeLike): TransUnit | null {
  const nameNode = childField(spec, 'name');
  const typeNode = childField(spec, 'type');
  if (!nameNode || !typeNode) return null;
  const name = nameNode.text;
  const srcLine = spec.startPosition.row + 1;
  const base = { id: name, kind: 'type' as TranslateKind, dstLang: 'ts', name, typeParams: extractTypeParams(spec), typeParamConstraints: extractTypeConstraints(spec), typeParamBounds: extractTypeParamBounds(spec), srcSnippet: spec.text.trim(), srcLine, skeleton: '', bodyHole: false, constraints: [...DEFAULT_CONSTRAINTS] };

  // struct → TS interface（数据字段）
  if (typeNode.type === 'struct_type') {
    const fields: { name: string; type: string; typeRef?: TypeRef }[] = [];
    const embedded: string[] = [];
    const list = childField(typeNode, 'field_declaration_list') || childField(typeNode, 'body') || findChildOfType(typeNode, 'field_declaration_list');
    if (list) {
      for (let i = 0; i < list.childCount; i++) {
        const fd = list.child(i);
        if (!fd || fd.type !== 'field_declaration') continue;
        const typeNode2 = childField(fd, 'type');
        if (!typeNode2) continue;
        const type = typeNode2.text;
        let named = false;
        for (let j = 0; j < fd.childCount; j++) {
          const c = fd.child(j);
          if (c && c.type === 'field_identifier') {
            fields.push({ name: c.text, type, typeRef: typeRefFromNode(typeNode2) });
            named = true;
          }
        }
        // ★★★ T-#EMBEDDED-FIELD：**嵌入字段（anonymous field）必须落成成员**，不能再整行丢掉。
        //   Go：`type CachedNode struct { graphNode; Dirty bool }` —— `graphNode` 有个**隐式字段名**
        //   （类型名去掉包名/指针）。丢掉它 ⇒ 产物 interface 里既没有 `graphNode`，
        //   `node.graphNode` 直接 TS2339；而它的**提升字段**（`node.Type`）也全无处可寻。
        //   TS 等价形态 = **组合**（显式成员）；提升字段的镜像另记约束（跨类型展开不在这一步做，宁缺不假）。
        if (!named) {
          embedded.push(type);
          fields.push({ name: embeddedFieldName(type), type, typeRef: typeRefFromNode(typeNode2) });
        }
      }
    }
    const constraints = [...base.constraints];
    for (const e of embedded) constraints.push(`struct 含嵌入字段「${e}」：字段提升语义需 LLM/人工决定（未机械展开）`);
    if (fields.length === 0) return null; // 空结构体无翻译价值，跳过
    return { ...base, typeKind: 'struct', fields, constraints };
  }

  // interface → TS interface（方法签名契约）
  if (typeNode.type === 'interface_type') {
    const methods = extractInterfaceMethods(typeNode);
    if (methods.length === 0) return null; // 空接口跳过
    return { ...base, typeKind: 'interface', methods };
  }

  // 其它（type_identifier / array_type / map_type / pointer_type / func_type…）→ type 别名
  return { ...base, typeKind: 'alias', aliasType: typeNode.text, aliasTypeRef: typeRefFromNode(typeNode) };
}

/** 包级 const/var 描述符（name + 是否 var + 表达式节点），供 fixpoint 求值 */
interface ConstDecl {
  name: string;
  isVar: boolean;
  /** ★ T-#IOTA：iota 序列里**省略值**的成员没有值节点 ⇒ 类型上必须允许 null */
  expr: SyntaxNodeLike | null;
  src: string;
  line: number;
}

/** 萃取期被跳过的项（空结构体/空接口/无法求值的 const 等）——A1 显式失败清单用 */
export interface SkippedDecl {
  name: string;
  kind: string;
  line: number;
  reason: string;
}

/** 在节点里取首个"表达式"子节点（找不到 value 字段时兜底） */
function firstExprChild(node: SyntaxNodeLike): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && ['int_literal', 'float_literal', 'true', 'false', 'interpreted_string_literal', 'raw_string_literal', 'character_literal', 'identifier', 'binary_expression', 'unary_expression', 'parenthesized_expression', 'expression_list'].includes(c.type)) return c;
  }
  return null;
}

/** 收集一条 const/var spec → 描述符（无名字/无值则 null） */
function constDeclFromSpec(spec: SyntaxNodeLike, isVar: boolean): ConstDecl | null {
  const nameNode = childField(spec, 'name');
  const valNode = childField(spec, 'value') || firstExprChild(spec);
  const name = nameNode?.text;
  // ★ T-#IOTA：省略值的成员（Go 的 iota 序列）也要能建单元 —— 原来直接 return null ⇒ 静默丢弃
  if (!name) return null;
  return { name, isVar, expr: valNode, src: valNode?.text.trim() ?? '', line: spec.startPosition.row + 1 };
}

/** 深度遍历 AST，收集目标单元。const/var 仅收包级（顶层），把表达式攒进 consts 待求值。 */
function collect(node: SyntaxNodeLike, units: TransUnit[], consts: ConstDecl[], skipped: SkippedDecl[], topLevel: boolean): void {
  const isFunc = node.type === 'function_declaration' || node.type === 'method_declaration';
  const isTypeDecl = node.type === 'type_declaration';
  if (isFunc) {
    const u = unitFromFunc(node);
    if (u) units.push(u);
    else {
      const nameN = childField(node, 'name');
      skipped.push({ name: nameN?.text ?? '<anon>', kind: 'func', line: node.startPosition.row + 1, reason: '无法萃取的函数（缺名字/形状异常）' });
    }
    return; // 不进函数体（切片只收顶层，避免捕获嵌套 func/func_literal）
  }
  // type_declaration 下逐个子 type_spec
  if (isTypeDecl) {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === 'type_spec') {
        const u = unitFromTypeSpec(c);
        if (u) units.push(u);
        else {
          const nameN = childField(c, 'name');
          skipped.push({ name: nameN?.text ?? '<anon>', kind: 'type', line: c.startPosition.row + 1, reason: '空结构体/空接口或无可机译价值' });
        }
      }
    }
    return; // type_spec 内部不再需要一般遍历
  }
  // 包级 const/var（仅顶层；多 spec 的 declaration 逐条收）
  if (topLevel && (node.type === 'const_declaration' || node.type === 'var_declaration')) {
    const specType = node.type === 'const_declaration' ? 'const_spec' : 'var_spec';
    let iotaIdx = -1;
    let prevSrc: string | null = null;
    const isVar = node.type === 'var_declaration';
    for (let i = 0; i < node.childCount; i++) {
      const spec = node.child(i);
      if (!spec || spec.type !== specType) continue;
      iotaIdx += 1;
      const d = constDeclFromSpec(spec, isVar);
      if (!d) continue;
      // ★ T-#IOTA：**带值但含 iota 的成员**（如首个 `AbsorbSucceeded = iota`）也要落值 ——
      //   否则首个成员永远求不出（`iota` 不是编译期字面量）⇒ 后面成员全部跟着没有声明。
      if (d.expr && /\biota\b/.test(d.src)) {
        const t = d.src.replace(/\biota\b/g, String(iotaIdx)).trim();
        let nv: number | null = /^-?\d+$/.test(t) ? Number(t) : null;
        const m2 = /^(-?\d+)\s*([+\-*\/])\s*(-?\d+)$/.exec(t);
        if (nv === null && m2) {
          const a = Number(m2[1]);
          const b = Number(m2[3]);
          nv = m2[2] === '+' ? a + b : m2[2] === '-' ? a - b : m2[2] === '*' ? a * b : a / b;
        }
        if (nv !== null) {
          prevSrc = String(nv);
          const f2 = { type: 'int_literal', text: String(nv), isNamed: true, childCount: 0 } as unknown as SyntaxNodeLike;
          consts.push({ ...d, expr: f2, src: String(nv) });
          continue;
        }
      }
      if (d.expr) {
        prevSrc = d.src;
        consts.push(d);
        continue;
      }
      // ★ T-#IOTA：省略值 = 重复上一表达式，把 iota 换成本组下标；只支持纯整数与一步算术（不猜）
      if (!prevSrc) continue;
      const exprTxt = prevSrc.replace(/\biota\b/g, String(iotaIdx)).trim();
      let iv: number | null = null;
      if (/^-?\d+$/.test(exprTxt)) iv = Number(exprTxt);
      else {
        const mm = /^(-?\d+)\s*([+\-*\/])\s*(-?\d+)$/.exec(exprTxt);
        if (mm) {
          const a = Number(mm[1]);
          const b = Number(mm[3]);
          iv = mm[2] === '+' ? a + b : mm[2] === '-' ? a - b : mm[2] === '*' ? a * b : a / b;
        }
      }
      if (iv === null) continue;
      const fake = { type: 'int_literal', text: String(iv), isNamed: true, childCount: 0 } as unknown as SyntaxNodeLike;
      consts.push({ ...d, expr: fake, src: String(iv) });
    }
    return;
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collect(c, units, consts, skipped, false);
  }
}

export interface ExtractGoResult {
  units: TransUnit[];
  /** 萃取期被跳过的项（空结构/空接口/无法求值 const 等）——A1 显式失败清单 */
  skipped: SkippedDecl[];
  /** 萃取失败原因（解析失败时返回空 units + error） */
  error?: string;
}

/**
 * `extractGoFromFile` 的产物：萃取结果 + "文件本身在不在"（与"解析失败"分开 —— 两种失败要给人不同的话）
 */
export interface ExtractGoFileResult extends ExtractGoResult {
  /** 磁盘上找不到该文件（此时 units/skipped 为空，`error` 不置位） */
  missing?: boolean;
}

/**
 * ★ [B] 按文件入口（**读盘 → 萃取**）。
 *
 * 为什么收在 [B]：`go_originals` 的 [C]（lane）原来自己 `existsSync` + `readFileSync`
 * 再把源码喂给 `extractGo(file, source)` —— "读文件"这件事于是散落在 [C] 里。
 * 收进 [B] 后 [C] 退化为纯路由器（只把 `missing`/`error` 翻成人话），lane 内不出现文件 IO。
 */
export async function extractGoFromFile(file: string): Promise<ExtractGoFileResult> {
  if (!fs.existsSync(file)) return { units: [], skipped: [], missing: true };
  return extractGo(file, fs.readFileSync(file, 'utf8'));
}

/**
 * 解析 Go 源码 → 萃取顶层 func / struct 为 trans_unit 列表。
 * 复用 ts_kernel.parseAstRoot（含 32KB callback 规避与容错解析），
 * 解析失败返回空列表 + error（不抛，与仓库优雅降级约定一致）。
 */
export async function extractGo(filePath: string, source: string): Promise<ExtractGoResult> {
  const parsed = await parseAstRoot(filePath, source);
  if (!parsed?.root) return { units: [], skipped: [], error: `Go 解析失败（可解析性未知）：${filePath}` };
  const units: TransUnit[] = [];
  const consts: ConstDecl[] = [];
  // ★ T-#SHIM-VALUE：本文件 import 的包名 → 函数体值位置的 pkg.Member
  const pkgs = collectImportedPkgs(parsed.root);
  const valueQualified = collectValueQualified(parsed.root, pkgs);
  const skipped: SkippedDecl[] = [];
  for (let i = 0; i < parsed.root.childCount; i++) {
    const c = parsed.root.child(i);
    if (c) collect(c, units, consts, skipped, true); // 顶层声明（包级 const/var 只在这里收）
  }
  // 常量表达式 fixpoint 求值（支持同包常量引用；求不出 = 非编译期常量 → 记 skipped 交 LLM/人工）
  const constVals = new Map<string, { v: ConstValue; isVar: boolean }>();
  let pending = consts.slice();
  let progressed = true;
  while (progressed && pending.length) {
    progressed = false;
    const still = [];
    for (const d of pending) {
      // ★ T-#IOTA：省略值且 iota 算不出来的成员（expr=null）不参与求值，直接落到 skipped
      if (!d.expr) {
        still.push(d);
        continue;
      }
      const v = evalConstExpr(d.expr, (n) => constVals.get(n)?.v ?? null);
      if (v) {
        constVals.set(d.name, { v, isVar: d.isVar });
        progressed = true;
      } else {
        still.push(d);
      }
    }
    pending = still;
  }
  for (const d of consts) {
    const got = constVals.get(d.name);
    if (!got) {
      skipped.push({ name: d.name, kind: 'const', line: d.line, reason: '非编译期常量表达式（含函数调用/不可求值），需 LLM/人工' });
      continue;
    }
    units.push({
      id: d.name,
      kind: 'const' as TranslateKind,
      dstLang: 'ts',
      name: d.name,
      value: constToTsLiteral(got.v),
      isVar: got.isVar,
      srcSnippet: d.src,
      srcLine: d.line,
      skeleton: '',
      bodyHole: false,
      constraints: [...DEFAULT_CONSTRAINTS],
    });
  }
  if (valueQualified.length) for (const u of units) u.usedQualified = valueQualified;
  return { units, skipped };
}