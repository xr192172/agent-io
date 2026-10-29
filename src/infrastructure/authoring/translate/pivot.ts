/**
 * ★★★ 2026-10-29（T-#PIVOT-SLOTS）：**特性槽 + 失真账** —— 让"翻译对不对"变成可计算的读数。
 *
 * ## 为什么（用户的愿景）
 * > 「未来什么语言都可以」⇒ 轴心必须能**装载**每种语言的特征，而不是假装它们相同。
 * 所以轴心不是"一门语法"，是「**核心语义 + 特性槽 + 失真账**」。
 *
 * ## 核心设计：失真**不是人写的，是算出来的**
 * ```
 * 源槽位(从 pivot 的类型树里走出来的) × 目标语言能力声明  ⇒  失真标签
 * ```
 * 好处（这是轴心的经济性来源）：
 *   · 只需维护 **N 份能力声明**（每语言一份）+ 一套规则；
 *   · 任意语言对的失真 = 两条已知失真的**复合**（`composeLoss`），可机器算，不用两两实测；
 *   · 加第 N 种语言 ⇒ 只交一份 `capability` 文件，规则不动。
 *
 * ## 七条硬轴（每条都是今天真实踩过的）
 * | 轴 | 轴心要定义 | Go | TS | 失真 |
 * |---|---|---|---|---|
 * | `int`  | 位宽 + 溢出 | i64 / wrap | f64 / 无环绕（位运算 32 位） | `int-overflow` |
 * | `str`  | 编码 + 下标单位 | utf8 / byte | utf16 / code unit | `str-index` |
 * | `null` | 显式可空 | nil 仅引用 | 到处 undefined | `null-implicit` |
 * | `mut`  | 值语义 vs 引用 | struct **按值复制** | 全引用（别名共享） | `mut-value-copy` |
 * | `err`  | 错误模型 | `(T, error)` | 元组可保（本项目约定） | 通常等价 |
 * | `conc` | 并发原语 | CSP chan / goroutine | event loop + Channel 垫片 | `conc-approximate` |
 * | `own`  | 内存归属 | GC | GC | 等价 |
 *
 * ★ 注意 `mut-value-copy`：Go 的 struct 赋值**复制**，TS 是**引用别名** ⇒ 这是我们**一直没记账**的真失真。
 */
import type { TypeRef } from './unit.js';

/** 轴名（固定七条；新轴要同时改所有语言的 capability，这是刻意的摩擦） */
export const AXES = ['int', 'str', 'null', 'mut', 'err', 'conc', 'own'] as const;
export type Axis = (typeof AXES)[number];

/** 一条槽：轴名 + 该轴上的具体形态（规范语义由本文件的规则定义） */
export interface Slot {
  axis: Axis;
  /** 例：`int{width:64,signed:true}` / `str{encoding:utf8,index:byte}` */
  form: string;
}

/** 失真标签：`exact` = 精确等价；其余为已知偏离 */
export type Loss =
  | 'exact'
  | 'int-overflow'
  | 'str-index'
  | 'null-implicit'
  | 'mut-value-copy'
  | 'conc-approximate'
  | 'err-model'
  | 'unsupported';

export interface LossEntry {
  axis: Axis;
  loss: Loss;
  /** 给人看的因果（进失真账的 `why`） */
  why: string;
}

/** 某语言在某轴上的能力声明（**每语言一份**，加语言只加这个） */
export interface Capability {
  lang: string;
  int: { widths: number[]; overflow: 'wrap' | 'none' | 'error'; exactMax: number };
  str: { encoding: 'utf8' | 'utf16' | 'utf32'; index: 'byte' | 'code-unit' | 'codepoint' };
  null: 'explicit' | 'implicit';
  mut: 'value-copy' | 'reference';
  err: 'return-tuple' | 'throw' | 'result-type';
  conc: 'csp' | 'eventloop' | 'threads' | 'async';
  own: 'gc' | 'manual' | 'borrow';
  /**
   * ★★★ 2026-10-29（T-#SLOT-SHIM）：**"拿自己写的原生组件去顶"的登记处**。
   *
   * ## 为什么这是轴心的关键一环
   * 有些槽目标语言**原生没有**，但可以**写一个原生实现去顶**（用户的原话：
   * 「用他们原生的东西写一个对方有的对应生态位的东西，然后每次翻译就把这个拿去顶」）。
   *
   * ## 通用性的关键：shim 绑**槽**，不绑**语言对**
   * 写 `ChannelSlot.ts`（语义 = 带缓冲/可关闭/可 select 的通道）之后，
   * **任何源语言**的通道都能顶进去（Go `chan`、Rust `mpsc`、Erlang mailbox）⇒ 成本是 **N×S**，不是 N²。
   *
   * ## 判据（防假绿，今天反复栽过）
   * · `certified`：**必须**有一张一致性证（含反向控制），证明这个 shim 真的实现了该槽语义；
   * · `applied`：**渲染器必须真的在正确位置插入了它**。
   *   两者缺一 ⇒ 失真账**保持原样**（shim 存在 ≠ 语义已经被顶掉）。
   */
  shims?: Record<
    string,
    {
      /** 槽标识，如 `mut.value` / `conc.csp` */
      slot: string;
      /** 生成到产物里的模块路径（相对项目 src） */
      module: string;
      /** 是否通过一致性证（证号写进 note，便于对账） */
      certified: boolean;
      /** 渲染器是否已在该插的位置插入（false ⇒ 账不变绿） */
      applied: boolean;
      why?: string;
    }
  >;
}

/** 声明式能力表（**唯一的语言知识入口**；目前只有两端） */
export const CAPABILITIES: Record<string, Capability> = {
  go: {
    lang: 'go',
    int: { widths: [8, 16, 32, 64], overflow: 'wrap', exactMax: Number.MAX_SAFE_INTEGER },
    str: { encoding: 'utf8', index: 'byte' },
    null: 'explicit',
    mut: 'value-copy',
    err: 'return-tuple',
    conc: 'csp',
    own: 'gc',
  },
  ts: {
    lang: 'ts',
    // TS 只有 f64：安全整数 2^53；位运算被截成 32 位 ⇒ 位宽“有”但不保真
    int: { widths: [], overflow: 'none', exactMax: Number.MAX_SAFE_INTEGER },
    str: { encoding: 'utf16', index: 'code-unit' },
    null: 'implicit',
    mut: 'reference',
    err: 'return-tuple', // ★ 本项目的约定：适配器返回 [T, Error|null]
    conc: 'eventloop',
    own: 'gc',
    shims: {
      // ★ 值语义：Go 的 struct 赋值是**复制**，TS 是引用别名 ⇒ 用 copy() 顶。
      //   certified=true 由证 t448 背书（真值语义：改副本不影响原件，含反向控制）；
      //   applied=false ⇒ **失真账暂不变绿**（渲染器还没在正确位置插入）——这是刻意的诚实。
      'mut.value': { slot: 'mut.value', module: '_slots/value', certified: true, applied: false, why: 'structuredClone' },
      // ★ CSP 通道：已有 _go_std 适配，但"调度公平性"无证 ⇒ certified=false
      'conc.csp': { slot: 'conc.csp', module: '_go_std/http', certified: false, applied: false, why: '调度公平性无证' },
    },
  },
};

const INT_RE = /^(u?int(8|16|32|64)?|uintptr|byte|rune)$/;
const FLOAT_RE = /^float(32|64)$/;

/** 从一架类型树里走出**槽位集合**（纯函数、可重复） */
export function slotsOf(ref: TypeRef | undefined, out: Slot[] = []): Slot[] {
  if (!ref) return out;
  switch (ref.kind) {
    case 'ident': {
      const n = ref.name;
      if (INT_RE.test(n)) {
        const bits = /64/.test(n) ? 64 : /32/.test(n) ? 32 : /16/.test(n) ? 16 : /8/.test(n) ? 8 : 64;
        out.push({ axis: 'int', form: `int{width:${bits},signed:${!n.startsWith('u')}}` });
      } else if (FLOAT_RE.test(n)) {
        out.push({ axis: 'int', form: `float{width:${/32/.test(n) ? 32 : 64}}` });
      } else if (n === 'string') {
        out.push({ axis: 'str', form: 'str{encoding:utf8,index:byte}' });
      }
      return out;
    }
    case 'pointer':
      out.push({ axis: 'null', form: 'ref{nullable:true}' });
      return slotsOf(ref.elem, out);
    case 'slice':
    case 'map':
    case 'chan': {
      if (ref.kind === 'chan') out.push({ axis: 'conc', form: 'csp-channel' });
      else out.push({ axis: 'null', form: `${ref.kind}{nullable:true}` });
      if (ref.kind === 'map') {
        slotsOf(ref.key, out);
        return slotsOf(ref.value, out);
      }
      return slotsOf(ref.elem, out);
    }
    case 'array':
      return slotsOf(ref.elem, out);
    case 'variadic':
      out.push({ axis: 'null', form: 'slice{nullable:true}' });
      return slotsOf(ref.elem, out);
    case 'tuple':
      for (const i of ref.items) slotsOf(i, out);
      return out;
    case 'func':
      for (const p of ref.params) slotsOf(p.type, out);
      for (const r of ref.results) slotsOf(r, out);
      return out;
    case 'struct':
      for (const f of ref.fields) slotsOf(f.type, out);
      return out;
    case 'interface':
      for (const m of ref.methods) {
        for (const p of m.params) slotsOf(p.type, out);
        for (const r of m.results) slotsOf(r, out);
      }
      for (const e of ref.embeds) slotsOf(e, out);
      return out;
    case 'generic':
      slotsOf(ref.base, out);
      for (const a of ref.args) slotsOf(a, out);
      return out;
    case 'qualified':
      // 限定类型（`time.Time` 等）：不知道内部形态 ⇒ 不猜槽位（记账在外部依赖策略里）
      return out;
    default:
      return out;
  }
}

/** 单个槽 → 单个目标能力下的失真（**规则只有这一处**） */
export function lossOfSlot(slot: Slot, dst: Capability): LossEntry {
  switch (slot.axis) {
    case 'int': {
      const m = /width:(\d+)/.exec(slot.form);
      const w = m ? Number(m[1]) : 64;
      if (slot.form.startsWith('float') && w === 64 && dst.int.exactMax >= Number.MAX_SAFE_INTEGER) {
        return { axis: 'int', loss: 'exact', why: 'f64 全覆盖双精度' };
      }
      if (dst.int.overflow === 'wrap' && dst.int.widths.includes(w)) {
        return { axis: 'int', loss: 'exact', why: `目标语言原生 ${w} 位环绕整数` };
      }
      if (w === 64 && dst.int.overflow !== 'wrap') {
        return {
          axis: 'int',
          loss: 'int-overflow',
          why: `源 i64 环绕 vs 目标无环绕整数（安全整数 ±2^53，位运算被截 32 位）`,
        };
      }
      return {
        axis: 'int',
        loss: 'int-overflow',
        why: `源 ${w} 位整数 vs 目标无该位宽原生整数`,
      };
    }
    case 'str': {
      const enc = /encoding:(\w+)/.exec(slot.form)?.[1] ?? 'utf8';
      const idx = /index:([\w-]+)/.exec(slot.form)?.[1] ?? 'byte';
      if (enc === dst.str.encoding && idx === dst.str.index) {
        return { axis: 'str', loss: 'exact', why: '同编码同下标单位' };
      }
      return {
        axis: 'str',
        loss: 'str-index',
        why: `源 ${enc}/${idx} vs 目标 ${dst.str.encoding}/${dst.str.index}（下标与长度语义不同）`,
      };
    }
    case 'null':
      if (dst.null === 'explicit') return { axis: 'null', loss: 'exact', why: '双方都显式可空' };
      return {
        axis: 'null',
        loss: 'null-implicit',
        why: '源侧 nil 只对引用成立；目标侧任何值都可能 undefined/null',
      };
    case 'mut':
      if (dst.mut === 'reference') {
        // ★ 有 shim 且**既认证又被渲染器插入** ⇒ 值语义被顶住 ⇒ exact。
        //   只认证但没插入（applied=false）⇒ 仍然记失真（shim 存在 ≠ 语义已顶）。
        const shim = dst.shims?.['mut.value'];
        if (shim && shim.certified && shim.applied) {
          return { axis: 'mut', loss: 'exact', why: `经 ${shim.module} 的 copy() 顶替值语义（已认证+已插入）` };
        }
        if (shim && shim.certified && !shim.applied) {
          return {
            axis: 'mut',
            loss: 'mut-value-copy',
            why: `copyshim 已认证（${shim.module}）但渲染器尚未插入 ⇒ 失真仍在`,
          };
        }
        return {
          axis: 'mut',
          loss: 'mut-value-copy',
          why: 'Go struct 赋值是**复制**，目标是**引用别名** ⇒ 传递后修改会互相可见（一直未记账的真失真）',
        };
      }
      return { axis: 'mut', loss: 'exact', why: '同为值语义' };
    case 'err':
      if (dst.err === 'return-tuple') return { axis: 'err', loss: 'exact', why: '沿用 (T, error) 元组约定' };
      return { axis: 'err', loss: 'err-model', why: `目标用 ${dst.err} 表达错误` };
    case 'conc':
      if (dst.conc === 'csp') return { axis: 'conc', loss: 'exact', why: '同为 CSP' };
      return {
        axis: 'conc',
        loss: 'conc-approximate',
        why: `源 CSP（chan/goroutine）vs 目标 ${dst.conc}（垫片近似：无真调度公平性/无阻塞语义）`,
      };
    case 'own':
      return { axis: 'own', loss: dst.own === 'gc' ? 'exact' : 'unsupported', why: `内存归属：源 gc vs 目标 ${dst.own}` };
    default:
      return { axis: 'own', loss: 'exact', why: '' };
  }
}

/** 一个单元的全部失真（去重 + 排序，便于比对与入库） */
export function lossinessOfUnit(
  refs: Array<TypeRef | undefined>,
  srcLang: string,
  dstLang: string,
): LossEntry[] {
  const src = CAPABILITIES[srcLang];
  const dst = CAPABILITIES[dstLang];
  if (!src || !dst) throw new Error(`未声明能力的语言：${!src ? srcLang : dstLang}`);
  const slots: Slot[] = [];
  for (const r of refs) slotsOf(r, slots);
  const seen = new Map<string, LossEntry>();
  for (const s of slots) {
    const key = `${s.axis}|${s.form}`;
    if (seen.has(key)) continue;
    seen.set(key, lossOfSlot(s, dst));
  }
  // ★★★ 有三条轴**不是从类型树走出来的**，而是**语言级差异**（永远适用）：
  //   `mut`（值语义 vs 引用语义）、`err`（错误模型）、`own`（内存归属）。
  //   只要有"值传递/错误返回/对象创建"，这三条就存在 ⇒ **无条件记一条**，否则会静默漏掉
  //   （实测：只按类型树走的话，`err`/`own` 一条都记不出来，账上等于假装它们不存在）。
  for (const a of ['mut', 'err', 'own'] as Axis[]) {
    const key = `${a}|*`;
    if (!seen.has(key)) seen.set(key, lossOfSlot({ axis: a, form: '*' }, dst));
  }
  return [...seen.values()];
}

/**
 * ★ 复合规则（轴心的经济性）：A→B 的失真 = A→pivot 复合 pivot→B。
 * 这里给出可用的近似：`exact` 与任何东西复合都取对方；两个非 exact 取"更重"的。
 * 权重只为排序，不代表严格语义（诚实标注）。
 */
const WEIGHT: Record<Loss, number> = {
  exact: 0,
  'null-implicit': 1,
  'str-index': 2,
  'int-overflow': 3,
  'mut-value-copy': 4,
  'err-model': 5,
  'conc-approximate': 6,
  unsupported: 9,
};

export function composeLoss(a: Loss, b: Loss): Loss {
  return WEIGHT[a] >= WEIGHT[b] ? a : b;
}
