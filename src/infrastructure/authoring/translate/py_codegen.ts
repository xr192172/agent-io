/**
 * py_codegen —— TransUnit → **Python 骨架**（go→py 语言的 codegen 挂件，第⑩项）。
 *
 * ## 定位（与 ts_codegen.ts 同族：只做"骨架 + 已知映射"，不猜）
 * · 函数：`def name(params) -> ret:` + docstring 孔（body 留 `...`，bodyHole=true）；
 * · struct → `@dataclass`；interface → `Protocol`；alias → `NewType`/直别名（基础形态）；
 * · **类型注解只映射基础集**（int/float/string/bool/bytes/None/list/dict），未知类型**落孔**
 *   （注解位写 `'Any  # TODO: 未知类型 <原文>'` 之外的诚实形态——见 `pyTypeOf`：未知类型不给假注解，
 *   直接**省略注解**并把原文写进 constraints——Python 允许无注解，这不是撒谎）。
 * · **验证闸降级**：TS 的 tsc 闸在 Python 侧没有等价物 ⇒ 语法闸 = `ast.parse`（诚实但更弱，调用方如实标注）。
 *
 * ## 不做的事（范围裁定，lead 2026-11-10）
 * LLM 填孔与行为对拍**不在本卡**（min 链 = 提取 → 骨架 → 语法闸）；goroutine/channel 等
 * 并发语义在 Python 侧无机械对应 ⇒ 走 constraints 提示（与 ts 侧同纪律：透传原始 result，不强猜）。
 */
import type { TransUnit } from './unit.js';

/** Go 基础类型 → Python 注解（**只映射有把握的基础集**；查不到返回 null ⇒ 省略注解 + 记约束） */
export function pyTypeOf(typeText: string): string | null {
  const t = typeText.trim();
  const table: Record<string, string> = {
    int: 'int',
    int8: 'int', int16: 'int', int32: 'int', int64: 'int',
    uint: 'int', uint8: 'int', uint16: 'int', uint32: 'int', uint64: 'int',
    float32: 'float', float64: 'float',
    string: 'str',
    bool: 'bool',
    byte: 'int', rune: 'int', // Go 的 byte/rune 都是整数语义
    error: 'Exception | None', // Go 的 error 返回位；Python 侧惯例是异常或 None
    '[]byte': 'bytes',
    any: 'object',
    'interface{}': 'object',
  };
  if (t in table) return table[t]!;
  // slice / map / pointer 的基础元素映射（一层）
  if (t.startsWith('[]')) {
    const el = pyTypeOf(t.slice(2));
    return el ? `list[${el}]` : `list  # TODO: 元素类型 ${t.slice(2)}`;
  }
  if (t.startsWith('map[')) {
    const m = /^\s*map\s*\[\s*([^\]]+)\]\s*(.+)$/.exec(t);
    if (m) {
      const k = pyTypeOf(m[1]!);
      const v = pyTypeOf(m[2]!);
      if (k && v) return `dict[${k}, ${v}]`;
    }
    return null;
  }
  if (t.startsWith('*')) {
    const el = pyTypeOf(t.slice(1));
    return el ? `${el} | None` : null; // 指针的可空语义用 Optional 近似
  }
  return null; // 未知（自定义类型/chan/func 等）⇒ 省略注解，不猜
}

/** 参数表 → Python 形参串（带注解；注解省略时记约束） */
function pyParams(u: TransUnit): { sig: string; notes: string[] } {
  const notes: string[] = [];
  const parts: string[] = [];
  for (const p of u.params ?? []) {
    const ann = pyTypeOf(p.typeRef ? typeRefText(p.typeRef) : p.type);
    if (ann === null && (p.typeRef ? typeRefText(p.typeRef) : p.type)) {
      notes.push(`参数 ${p.name} 的 Go 类型「${p.type}」无把握的 Python 注解 ⇒ 省略注解（不猜）`);
    }
    parts.push(ann ? `${p.name}: ${ann}` : p.name);
  }
  return { sig: parts.join(', '), notes };
}

/** TypeRef → 源文本（pyTypeOf 吃原文；TypeRef 树在这里只取投影） */
function typeRefText(r: { kind: string; name?: string; text?: string; elem?: unknown }): string {
  if (r.kind === 'ident' && r.name) return r.name;
  return String(r.text ?? '');
}

/** 返回类型 → `-> ann` 片段（None/多值/未知各自诚实处理） */
function pyReturn(u: TransUnit): { ret: string; notes: string[] } {
  const notes: string[] = [];
  const raw = u.resultRef ? typeRefText(u.resultRef) : (u.result ?? '');
  if (!raw || raw === 'void') return { ret: '', notes };
  // 多返回值（Go 惯例 `(T, error)`）⇒ Python 用 tuple；识别不了就整体落孔
  if (raw.startsWith('(')) {
    const inner = raw.slice(1, -1).trim();
    const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 2 && parts[1] === 'error') {
      const ann = pyTypeOf(parts[0]!);
      // Go 的 `(T, error)` 惯例 → Python 的 `tuple[T] | None`？不行——丢错误信息。诚实：tuple[T, Exception|None]
      return ann ? { ret: ` -> tuple[${ann}, Exception | None]`, notes } : { ret: '', notes: [...notes, `返回 ${(inner)} 无把握注解 ⇒ 省略`] };
    }
    notes.push(`多返回值 ${raw} 机械翻成 tuple（语义对应需 LLM 复核）`);
    const anns = parts.map((p) => pyTypeOf(p) ?? 'object');
    return { ret: ` -> tuple[${anns.join(', ')}]`, notes };
  }
  const ann = pyTypeOf(raw);
  if (ann === null) {
    notes.push(`返回类型「${raw}」无把握的 Python 注解 ⇒ 省略注解（不猜）`);
    return { ret: '', notes };
  }
  return { ret: ` -> ${ann}`, notes };
}

/** 单元 → Python 骨架文本 */
export function renderPySkeleton(u: TransUnit): string {
  const { code, notes } =
    u.kind === 'const' ? renderPyConst(u) : u.kind === 'func' ? renderPyFunc(u) : renderPyType(u);
  if (notes.length > 0) {
    u.constraints = [...new Set([...u.constraints, ...notes])];
  }
  u.skeleton = code;
  return code;
}

function renderPyFunc(u: TransUnit): { code: string; notes: string[] } {
  const { sig, notes } = pyParams(u);
  const { ret, notes: rNotes } = pyReturn(u);
  notes.push(...rNotes);
  const doc = [`    """${u.name}（${u.dstLang} 骨架；函数体待填）。`];
  for (const c of u.constraints) doc.push(`     * ${c}`);
  doc.push('    """');
  const code = `def ${u.name}(${sig})${ret}:\n${doc.join('\n')}\n    ...  # TODO(body): 由 LLM 按 srcSnippet 填\n`;
  return { code, notes };
}

function renderPyConst(u: TransUnit): { code: string; notes: string[] } {
  // Go const 值在提取期已直译成字面量（u.value）；python 字面量语法对 int/str/bool 与 TS 同形
  const name = u.name.toUpperCase(); // python 常量惯例全大写
  return { code: `${name} = ${u.value ?? 'None  # TODO(const): 值未求出'}\n`, notes: [] };
}

function renderPyType(u: TransUnit): { code: string; notes: string[] } {
  const notes: string[] = [];
  const head = 'from dataclasses import dataclass\nfrom typing import Protocol\n\n';
  if (u.typeKind === 'struct') {
    const fields = (u.fields ?? [])
      .map((f) => {
        const ann = pyTypeOf(f.typeRef ? typeRefText(f.typeRef) : f.type);
        if (ann === null) notes.push(`字段 ${f.name} 类型「${f.type}」无把握注解 ⇒ 省略`);
        return `    ${f.name}: ${ann ?? 'object  # TODO: 未知类型'}`;
      })
      .join('\n');
    return { code: `${head}@dataclass\nclass ${u.name}:\n${fields || '    pass'}\n`, notes };
  }
  if (u.typeKind === 'interface') {
    const ms = (u.methods ?? [])
      .map((m) => {
        const ps = (m.params ?? []).map((p) => p.name).join(', ');
        return `    def ${m.name}(${ps}): ...`;
      })
      .join('\n');
    return { code: `${head}class ${u.name}(Protocol):\n${ms || '    pass'}\n`, notes };
  }
  // alias：python 用直接赋值近似（NewType 引入运行时开销，骨架阶段用直别名 + 注释）
  return { code: `${u.name} = object  # TODO(alias): Go 别名 ${u.aliasType ?? ''} 的 Python 对应待定\n`, notes };
}
