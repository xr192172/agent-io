/**
 * ts_codegen —— Go→TS 机械骨架生成（三段式落地"② 骨架生成"）
 *
 * 职责：把一条 trans_unit（func/type）渲染成**确定性的** TS 骨架。
 *   - func：`export function Name(params): Ret { bodymarker }`（bodymarker=孔）——签名/导出被
 *     焊死，函数体留孔交给 LLM 填（bodyHole）。
 *   - type：`export interface Name { ... }` —— 完整生成，无需 LLM。
 *
 * 类型映射走一张薄表 GO_TO_TS + 语义包裹判断。可机械映射的直接换；
 * 语义不可机械翻译的（error 传播 / chan / func 参数 / 多返回值）如实标
 * `degree='unsupported'` 并进 constraints —— 符合仓库"不猜语义"契约，
 * 绝不硬译。
 */

import { withConstraints, type TransUnit, type TranslateParam } from './unit.js';

/** 标量/名称型 1:1 映射（Go → TS） */
const GO_TO_TS: Record<string, string> = {
  int: 'number',
  int8: 'number',
  int16: 'number',
  int32: 'number',
  int64: 'number',
  uint: 'number',
  uint8: 'number',
  uint16: 'number',
  uint32: 'number',
  uint64: 'number',
  uintptr: 'number',
  byte: 'number',
  rune: 'number',
  float32: 'number',
  float64: 'number',
  string: 'string',
  bool: 'boolean',
  any: 'unknown',
  'interface{}': 'unknown',
};

export interface MappedType {
  /** 机械可映射程度：'direct' 直接可用；'unsupported' 语义不可机械翻译 */
  degree: 'direct' | 'unsupported';
  /** 目标 TS 类型文本 */
  ts: string;
  /** 需并入 constraints 的语义 note；无则省略 */
  note?: string;
}

/**
 * 映射一个 Go 类型到 TS。返回机械可映射程度——让骨架生成与人工审都在
 * 同一本"能机械 / 需 LLM"的账上对齐。
 */
export function mapGoType(goType: string): MappedType {
  // ★★★ 2026-10-28（T-#TRANS-GEN ④）：**先剥 Go struct tag**（反引号里的 `json:"x"`）。
  //   不剥会被当类型文本透传 ⇒ 生成 `Content: string \`json:"content"\``（TS 语法错）。
  const t = (goType || '').replace(/`[^`]*`/g, '').trim();
  if (t === '') return { degree: 'direct', ts: 'void' };

  // 特殊字节/字符切片 → 惯用 JS 类型
  if (t === '[]byte') return { degree: 'direct', ts: 'Uint8Array' };
  if (t === '[]rune') return { degree: 'direct', ts: 'number[]' };

  // 定长数组 `[N]T` → T[]（按值语义近似）
  const farr = /^\[(\d+)\](.+)$/.exec(t);
  if (farr) {
    const inner = mapGoType(farr[2]);
    return { degree: inner.degree, ts: `${inner.ts}[]`, note: inner.note };
  }

  // 切片 `[]T`
  if (t.startsWith('[]')) {
    const inner = mapGoType(t.slice(2));
    return { degree: inner.degree, ts: `${inner.ts}[]`, note: inner.note };
  }
  // 指针 `*T`（Go 指针在切片内按值语义近似）
  if (t.startsWith('*')) {
    const inner = mapGoType(t.slice(1));
    return { degree: inner.degree, ts: inner.ts, note: inner.note };
  }
  // map[K]V（key 只吃首个顶层 ]，值可含嵌套 []，如 `map[string][]int`)
  const mM = /^map\[([^\]]+)\](.+)$/.exec(t);
  if (mM) {
    const k = mapGoType(mM[1]).ts;
    const v = mapGoType(mM[2]).ts;
    return { degree: 'direct', ts: `Map<${k}, ${v}>` };
  }
  // 多返回值 `(T1, T2[, ...])` → TS 元组 `[T1, T2, ...]`（分量各自 mapGoType）
  if (t.startsWith('(') && t.endsWith(')') && /,\s*\S/.test(t)) {
    const parts = splitTopLevel(t.slice(1, -1));
    if (parts.length >= 2) {
      const mapped = parts.map((p) => mapGoType(p.trim()));
      const hasUnsup = mapped.some((m) => m.degree === 'unsupported');
      const pieces = mapped.map((m, i) => (m.note ? `分量${i + 1}: ${m.note}` : null)).filter(Boolean);
      return {
        degree: hasUnsup ? 'unsupported' : 'direct',
        ts: '[' + mapped.map((m) => m.ts).join(', ') + ']',
        note: hasUnsup ? '多返回值含不可机械翻译分量：' + pieces.join('；') : undefined,
      };
    }
  }

  // —— 语义包裹 / 不可机械翻译 ——
  if (t === 'error' || /^error$/.test(t)) {
    return { degree: 'unsupported', ts: 'Error | null', note: 'Go error 值为显式返回语义；TS 无内建对应，需 LLM/人审（映射为 Error | null 或抛异常）' };
  }
  // chan T / <-chan T / chan<- T → Channel<T>（近似垫片，见 channelShimSource）
  const chanM = /^(?:<-)?chan(?:<-)?\s+(.+)$/.exec(t);
  if (chanM) {
    const elem = mapGoType(chanM[1]);
    return {
      degree: 'direct',
      ts: `Channel<${elem.ts}>`,
      note: elem.degree === 'unsupported' ? `chan 元素: ${elem.note}` : 'chan → Channel<T> 垫片（近似；select/阻塞/竞态语义需人工核）',
    };
  }
  // 函数类型 `func(a int) error` → `(a: number) => Error | null`（逐参/返回映射；可省略参数名）
  if (t.startsWith('func')) {
    const fm = /^func\s*(?:\(([^)]*)\))?\s*(?:\s+(.+))?$/.exec(t);
    if (fm) {
      // ★★★ 2026-10-28（T-#TRANS-GEN ①）：**按 Go 的分组形参解析**。
      //   原来 `fm[1].split(',')` 逐段当"名字 类型"匹配 ⇒ `func(pattern, brain string)` 被读成
      //   `(arg: pattern, brain: string)`（把形参名 `pattern` 当成了类型）。实测打穿 8/44 处。
      const params = fm[1] !== undefined ? parseGoParamList(fm[1]) : [];
      const pOut: string[] = [];
      let anyUnsup = false;
      for (const p of params) {
        const mt = mapGoType(p.type);
        if (mt.degree === 'unsupported') anyUnsup = true;
        pOut.push(`${p.name ?? 'arg'}: ${mt.ts}`);
      }
      let ret = 'void';
      if (fm[2] && fm[2].trim()) {
        const r = mapGoType(fm[2].trim());
        if (r.degree === 'unsupported') anyUnsup = true;
        ret = r.ts;
      }
      return { degree: anyUnsup ? 'unsupported' : 'direct', ts: `(${pOut.join(', ')}) => ${ret}` };
    }
    return { degree: 'unsupported', ts: '(...args: unknown[]) => unknown', note: '函数类型无法归类，需 LLM 换算签名' };
  }
  // ★★★ 2026-10-28（T-#TRANS-GEN ②）：**匿名 struct 字面量** —— 原来落到"未识别 ⇒ 透传"，
  //   于是 `chan struct{}` 生成了 `Channel<struct{}>`（`struct{}` 不是 TS 类型）。实测打穿 5/55 文件。
  const stM = /^struct\s*\{([\s\S]*)\}$/.exec(t);
  if (stM) {
    const body = stM[1].trim();
    if (!body) return { degree: 'direct', ts: 'Record<string, never>' }; // 空结构体 = 无字段
    const fields = splitTopLevelFields(body);
    const parts: string[] = [];
    let anyUnsup = false;
    for (const f of fields) {
      // ★ 2026-10-28：**必须用 [\s\S]** —— 嵌套 struct 的类型文本含换行，`.` 不匹配换行
      //   ⇒ 原来直接落到"嵌入字段"兜底，生成 `Message_struct______Content_string_____: Message struct {`（TS 语法错）。
      const nm = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+([\s\S]+)$/.exec(f);
      if (!nm) {
        // 内嵌字段：类型名直接当字段名（Go 的嵌入语义在 TS 无对应 ⇒ 如实标注）
        const emb = mapGoType(f);
        if (emb.degree === 'unsupported') anyUnsup = true;
        parts.push(`${f.replace(/[^\w]/g, '_')}: ${emb.ts}`);
        continue;
      }
      const names = nm[1].split(',').map((x) => x.trim());
      const mt = mapGoType(nm[2].trim());
      if (mt.degree === 'unsupported') anyUnsup = true;
      for (const name of names) parts.push(`${name}: ${mt.ts}`);
    }
    return {
      degree: anyUnsup ? 'unsupported' : 'direct',
      ts: `{ ${parts.join('; ')} }`,
      ...(anyUnsup ? { note: '匿名 struct 含不可机械翻译字段' } : {}),
    };
  }
  // ★ 2026-10-28：**匿名 interface 字面量** `interface{ Do(a int) error }` → 对象类型（方法签名）
  const ifM = /^interface\s*\{([\s\S]*)\}$/.exec(t);
  if (ifM) {
    const body = ifM[1].trim();
    if (!body) return { degree: 'direct', ts: 'Record<string, never>' };
    const methods = splitTopLevelFields(body);
    const parts: string[] = [];
    let anyUnsup = false;
    for (const m2 of methods) {
      const mm = /^([A-Za-z_]\w*)\s*(\([\s\S]*)$/.exec(m2);
      if (!mm) {
        parts.push(`[key: string]: unknown /* ${m2.slice(0, 40)} */`);
        continue;
      }
      const sig = mapGoType(`func${mm[2]}`);
      if (sig.degree === 'unsupported') anyUnsup = true;
      parts.push(`${mm[1]}: ${sig.ts}`);
    }
    return {
      degree: anyUnsup ? 'unsupported' : 'direct',
      ts: `{ ${parts.join('; ')} }`,
      ...(anyUnsup ? { note: '匿名 interface 含不可机械翻译方法' } : {}),
    };
  }
  // 泛型类型实参（Go 用方括号）：`Name[K, V]` / `List[int]` → 逐实参映射成 TS `Name<K, V>`
  const genSB = /^([A-Za-z_][\w.]*)\[([^\]]+)\]$/.exec(t);
  if (genSB) {
    const base = genSB[1].replace(/\./g, '_');
    const args = splitTopLevel(genSB[2]).map((a) => mapGoType(a.trim()));
    const hasUnsup = args.some((a) => a.degree === 'unsupported');
    return { degree: hasUnsup ? 'unsupported' : 'direct', ts: `${base}<${args.map((a) => a.ts).join(', ')}>` };
  }
  // 泛型类型实参 `<A, B>` → 逐实参映射直通
  const genM = /^([A-Za-z_][\w.]*)<(.+)>$/.exec(t);
  if (genM) {
    const base = genM[1].replace(/\./g, '_');
    const args = splitTopLevel(genM[2]).map((a) => mapGoType(a.trim()));
    const hasUnsup = args.some((a) => a.degree === 'unsupported');
    return { degree: hasUnsup ? 'unsupported' : 'direct', ts: `${base}<${args.map((a) => a.ts).join(', ')}>` };
  }
  // 其它复合/含逗号结果（非元组、无法归类）→ 如实标注
  if (t.includes(',') || /^\(/.test(t)) {
    return { degree: 'unsupported', ts: 'unknown', note: '复合结果无法 1:1 映射，需 LLM 设计结果形态' };
  }

  const direct = GO_TO_TS[t];
  if (direct) return { degree: 'direct', ts: direct };
  if (t === 'complex64' || t === 'complex128') {
    return { degree: 'unsupported', ts: '[number, number]', note: '复数无 TS 内建，按 [实, 虚] 元组映射，运算需人工核对' };
  }
  // 未识别 → 假定是用户类型/结构体名，透传（type 单元已机械生成 interface）
  return { degree: 'direct', ts: t };
}

/**
 * ★★★ 2026-10-28（T-#TRANS-GEN ①）：解析 Go 形参表，**认分组写法**。
 *
 * Go 允许 `(a, b int, c string)`：同类型的多个名字共享一个类型。原来按逗号逐段当"名字 类型"匹配
 * ⇒ `pattern` 被当类型、`a`/`b` 只认到一个 ⇒ 生成 `(arg: pattern, brain: string)` 这种假签名。
 *
 * 规则：先按顶层逗号切段；若**任一段**呈"名字 类型"（≥2 token 且首 token 是标识符）⇒ 整表是"有名字"风格，
 * 此时单 token 段是**待接的下一个类型的名字组**（累积到遇到带类型的段为止）；否则整表是裸类型。
 */
function parseGoParamList(s: string): Array<{ name?: string; type: string }> {
  const segs = splitTopLevel(s)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!segs.length) return [];
  const named = segs.some((g) => /^[A-Za-z_]\w*\s+\S/.test(g));
  const out: Array<{ name?: string; type: string }> = [];
  if (!named) return segs.map((type) => ({ type }));
  let pending: string[] = [];
  for (const seg of segs) {
    const m = /^([A-Za-z_]\w*)\s+([\s\S]+)$/.exec(seg);
    if (m) {
      const names = [...pending, m[1]];
      pending = [];
      for (const nm of names) out.push({ name: nm, type: m[2].trim() });
    } else if (/^[A-Za-z_]\w*$/.test(seg)) {
      pending.push(seg); // `a, b int` 里的 `a`
    } else {
      for (const nm of pending.splice(0)) out.push({ name: nm, type: 'unknown' });
      out.push({ type: seg }); // 裸类型混入（保底，不猜）
    }
  }
  for (const nm of pending) out.push({ name: nm, type: 'unknown' });
  return out;
}

/**
 * ★★★ 2026-10-28（T-#TRANS-GEN ⑤）：按**括号深度**切字段/方法（`;` 或换行，且只在深度 0）。
 *
 * 原来直接 `.split(/[;\n]/)` ⇒ 内层匿名 struct 会被切碎：
 * `{ Message: struct{ Content string } }` 变成 `Message: struct {` + `Content: string` + `}`
 * ⇒ 生成 `{ Message: struct {; Content: string; _: }`（TS 语法错，实测 4 个 error 全出自此）。
 */
function splitTopLevelFields(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    const isCut = depth === 0 && (ch === ';' || ch === '\n');
    if (isCut) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 在括号深度 0 处按逗号切分（`a, (b, c), d` → [a, (b, c), d]） */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function mapParam({ name, type }: TranslateParam, notes: string[]): string {
  const m = mapGoType(type);
  if (m.note) notes.push(`${name}: ${m.note}`);
  return `${name}: ${m.ts}`;
}

/** 类型参数渲染：`['T','U']` + bounds → `<T extends number, U>`（空则空串） */
function typeParamString(u: TransUnit): string {
  const tps = u.typeParams ?? [];
  if (!tps.length) return '';
  const inner = tps.map((name, i) => {
    const b = (u.typeParamBounds ?? [])[i];
    return b ? `${name} extends ${b}` : name;
  });
  return `<${inner.join(', ')}>`;
}

/** Go→TS 翻译附带一次性的通道垫片（只要任一片段用到 Channel 就前置这段）。 */
export function channelShimSource(): string {
  return [
    '/**',
    ' * agent-io Go→TS 翻译自动附加的通道垫片。',
    ' * 近似实现：用 JS 队列模拟。非 Go 的阻塞/select/缓冲区满语义，并发与竞态需人工核对。',
    ' */',
    'export class Channel<T> {',
    '  private q: T[] = [];',
    '  private waiters: Array<(v: T) => void> = [];',
    '',
    '  send(v: T): Promise<void> {',
    '    this.q.push(v);',
    '    const w = this.waiters.shift();',
    '    if (w && this.q.length) w(this.q.shift() as T);',
    '    return Promise.resolve();',
    '  }',
    '',
    '  receive(): Promise<T> {',
    '    const head = this.q.shift();',
    '    if (head !== undefined) return Promise.resolve(head);',
    '    return new Promise<T>((res) => this.waiters.push(res));',
    '  }',
    '}',
    '',
  ].join('\n');
}

/** 渲染函数单元骨架（签名锁定，body 留孔） */
function renderFuncSkeleton(u: TransUnit): { code: string; notes: string[] } {
  const notes: string[] = [];
  const params = (u.params ?? []).map((p) => mapParam(p, notes)).join(', ');
  let ret = '';
  if (u.result) {
    const m = mapGoType(u.result);
    if (m.note) notes.push(`return: ${m.note}`);
    ret = `: ${m.ts}`;
  }
  // A3 决策表：锁定 switch 判别式 + case/default 分支（机械 1:1），仅分支动作留空待 LLM
  // ★★★ 2026-10-28（T-#TRANS-GEN ③）：孔体**要炸**，不要静默返回。
  //   原来只有一行注释 ⇒ 空函数体在 TS 里**编译得过**，运行时返回 undefined（声明 `: boolean` 却返回 undefined）
  //   ⇒ 那是**假绿**：看起来骨架齐了，其实一行都没译。现在没译就立刻抛。
  const hole = u.decision
    ? '\n' + renderDecisionBody(u)
    : u.bodyHole
      ? "\n  throw new Error('TODO(translate): 待 LLM 翻译 Go 函数体');"
      : '';
  return { code: `export function ${u.name}${typeParamString(u)}(${params})${ret} {${hole}\n}`, notes };
}

/** Go case 标签 → TS case 标签（字符串/反引号字面量转单引号；数字/布尔/标识符合原） */
function tsCaseLabel(l: string): string {
  const s = l.trim();
  if (/^(["'`])([\s\S]*?)\1$/.test(s)) return `'${s.slice(1, -1)}'`;
  return s;
}

/** A3 决策表骨架体：`switch(disc){ case L:{ TODO; break; } default:{...} }`，分支结构焊死 */
function renderDecisionBody(u: TransUnit): string {
  const d = u.decision!;
  const lines: string[] = [`  switch (${d.discriminant}) {`];
  for (const c of d.cases) {
    const labels = c.labels.map(tsCaseLabel).join(', ');
    lines.push(`    case ${labels}: {`);
    lines.push(`      // TODO(translate) ${c.branchId}：翻译该分支动作`);
    lines.push(`      break;`);
    lines.push(`    }`);
  }
  if (d.hasDefault) {
    lines.push(`    default: {`);
    lines.push(`      // TODO(translate) default：翻译该分支动作`);
    lines.push(`      break;`);
    lines.push(`    }`);
  }
  lines.push(`  }`);
  return lines.join('\n');
}

/** 渲染 type 单元骨架（struct/interface → interface；alias → type 别名；均非孔） */
function renderTypeSkeleton(u: TransUnit): { code: string; notes: string[] } {
  const notes: string[] = [];

  // type 别名：`type MyInt int` → `export type MyInt = number;`
  if (u.typeKind === 'alias') {
    const m = mapGoType(u.aliasType ?? '');
    if (m.note) notes.push(`alias ${u.name}: ${m.note}`);
    return { code: `export type ${u.name}${typeParamString(u)} = ${m.ts};`, notes };
  }

  // interface：方法签名契约 `export interface Greeter {...}`
  if (u.typeKind === 'interface') {
    const lines = (u.methods ?? [])
      .map((mm) => {
        const params = mm.params.map((p) => mapParam(p, notes)).join(', ');
        let ret = 'void';
        if (mm.result) {
          const m = mapGoType(mm.result);
          if (m.note) notes.push(`${mm.name}: ${m.note}`);
          ret = m.ts;
        }
        return `  ${mm.name}(${params}): ${ret};`;
      })
      .join('\n');
    return { code: `export interface ${u.name}${typeParamString(u)} {\n${lines}\n}`, notes };
  }

  // struct → interface（数据字段）
  const fields = (u.fields ?? [])
    .map((f) => {
      const m = mapGoType(f.type);
      if (m.note) notes.push(`${f.name}: ${m.note}`);
      return `  ${f.name}: ${m.ts};`;
    })
    .join('\n');
  return { code: `export interface ${u.name}${typeParamString(u)} {\n${fields}\n}`, notes };
}

/** 渲染 const 单元骨架：`const Max = "hi"` → `export const Max = "hi";`（var → export let） */
function renderConstSkeleton(u: TransUnit): { code: string; notes: string[] } {
  const kw = u.isVar ? 'let' : 'const';
  return { code: `export ${kw} ${u.name} = ${u.value ?? 'undefined'};`, notes: [] };
}

/**
 * 确定性生成目标骨架，并把 typeMap 的语义 note 并入单元约束。
 * 幂等：重复调用结果一致；约束用 withConstraints 去重并入。
 */
export function renderTsSkeleton(u: TransUnit): string {
  const { code, notes } =
    u.kind === 'const' ? renderConstSkeleton(u) : u.kind === 'func' ? renderFuncSkeleton(u) : renderTypeSkeleton(u);
  // 类型约束传递：能表达成 TS bound（此处已渲染到 <T extends …>）的不用再提示；
  // 只有"TS 无等价约束"的（comparable/自定义/interface{}等已无 bound）才写进约束提醒
  const boundByName = new Map<string, string>();
  (u.typeParams ?? []).forEach((tp, i) => boundByName.set(tp, (u.typeParamBounds ?? [])[i] ?? ''));
  for (const [tp, c] of Object.entries(u.typeParamConstraints ?? {})) {
    const alreadyBound = (boundByName.get(tp) ?? '') !== '';
    if (alreadyBound) continue;
    if (c.trim() && !['any', 'interface{}'].includes(c.trim())) {
      notes.push(`类型参数 ${tp} 约束为「${c}」：TS 无等价约束，调用方须保证类型满足（或用 近似值域）`);
    }
  }
  if (notes.length > 0) u.constraints = withConstraints(u.constraints, notes);
  u.skeleton = code;
  return code;
}