/**
 * semantic_model/serialize.ts —— **JSON 往返无损** + **形状校验**（domain 层，**零 import**）。
 *
 * ## 两条不变量（本文件的全部）
 * ① **往返无损**：`fromJSON(toJSON(m))` 与 `m` **逐字段相等**（`assert.equal` 深度比较）；
 *    ⇒ 本文件**不许**在序列化路径上补默认值、丢未知键、把 `undefined` 变成 `null`。
 * ② **非法形状拒绝，不静默**：`fromJSON` 拿到不是本模型的东西 ⇒ 抛 `SemanticShapeError`，
 *    **绝不**"尽力修一下"。修一下 = 把「读到了坏数据」变成「读到了我猜的数据」
 *    （`change_set.ts:30-31`：静默省略是本仓反复撞的坑 —— 读的人以为"这里有 0 条"，其实是"这里没看"）。
 *
 * ## 为什么 `undefined` 要显式处理
 * `JSON.stringify({a: undefined})` 会**把键删掉** ⇒ 往返之后 `'a' in obj` 从 true 变 false。
 * 那是一次**静默的形状变化**。⇒ 本文件选择：`undefined` 值的键在 `toJSON` 里**抛错**
 * （写端要么给 null，要么别写这个键），而不是悄悄丢掉它。
 */

import type { EntityDef, OperatorCall, OperatorDef, SemanticModel } from './types.js';

/** 非法形状的**唯一**错误类型（调用方按类型捕获；报文里带 `at` 路径，能定位到哪一个字段） */
export class SemanticShapeError extends Error {
  /** 出错的 JSON 路径（如 `entities[2].fields[0].type`） */
  readonly at: string;
  constructor(at: string, reason: string) {
    super(`[semantic_shape] ${at}: ${reason}`);
    this.name = 'SemanticShapeError';
    this.at = at;
  }
}

/** 是不是本文件抛的那种错（跨 realm / 跨包时 `instanceof` 会失手，故给一个按名判的入口） */
export function isSemanticShapeError(e: unknown): e is SemanticShapeError {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'SemanticShapeError';
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * **把任意值逐层搬成可 JSON 化、且往返无损的值**（`toJSON` 的核）。
 *
 * 规矩（三条，各有理由）：
 * · `undefined` ⇒ **抛**（见文件头：JSON 会静默删键）；
 * · `NaN` / `±Infinity` ⇒ **抛**（`JSON.stringify` 把它变成 `null` —— 一个数变成"没有"，读端无从察觉）；
 * · 函数 / symbol / bigint ⇒ **抛**（它们根本进不了 JSON，留着就是等着被静默丢掉）。
 * ★ 其余（string / number / boolean / null / 数组 / 纯对象）原样深搬；**不排序** —— 键序不是契约，
 *   但"往返后逐字段相等"是，故按原序搬即可。
 */
function plain(v: unknown, at: string): unknown {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') {
    if (!Number.isFinite(v as number)) throw new SemanticShapeError(at, `非有限数（${String(v)}）进不了 JSON：stringify 会把它变成 null`);
    return v;
  }
  if (t === 'undefined') throw new SemanticShapeError(at, 'undefined 值 —— JSON.stringify 会**静默删掉这个键**；要么给 null，要么别写这个键');
  if (t === 'function' || t === 'symbol' || t === 'bigint') throw new SemanticShapeError(at, `${t} 不是 JSON 值（留着只会被静默丢掉）`);
  if (Array.isArray(v)) return v.map((x, i) => plain(x, `${at}[${i}]`));
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = plain(val, `${at}.${k}`);
    return out;
  }
  throw new SemanticShapeError(at, `不认识的类型：${t}`);
}

/**
 * 模型 ⇒ **可 JSON 的普通对象**（往返无损的唯一出口）。
 * 用法：`JSON.stringify(toJSON(model))`。
 */
export function toJSON(model: SemanticModel): Record<string, unknown> {
  if (!isObj(model)) throw new SemanticShapeError('(root)', '模型必须是一个对象');
  return plain(model, '(root)') as Record<string, unknown>;
}

/** 读一个必填字符串（缺 / 空串 / 非字符串 ⇒ 抛） */
function reqStr(o: Record<string, unknown>, k: string, at: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) throw new SemanticShapeError(`${at}.${k}`, `必须是**非空字符串**，实测 ${JSON.stringify(v) ?? '缺失'}`);
  return v;
}

/** 读一个数组（缺 ⇒ 抛；`what` 用来写人读原因） */
function reqArr(o: Record<string, unknown>, k: string, at: string): unknown[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new SemanticShapeError(`${at}.${k}`, `必须是数组，实测 ${v === undefined ? '缺失' : typeof v}`);
  return v;
}

/** 读一个正整数（`version` 用；`0` / 小数 / 负数 / 字符串都拒） */
function reqPosInt(o: Record<string, unknown>, k: string, at: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new SemanticShapeError(`${at}.${k}`, `必须是**正整数**（1,2,3…），实测 ${JSON.stringify(v) ?? '缺失'}`);
  return v;
}

function shapeEntity(raw: unknown, at: string): EntityDef {
  if (!isObj(raw)) throw new SemanticShapeError(at, '实体必须是对象');
  // ★ 必填三格先读（出错时报的是**最小**原因，不是"顺便发现的一堆"）
  reqStr(raw, 'id', at);
  reqStr(raw, 'semanticName', at);
  reqStr(raw, 'kind', at);
  if (raw.fields !== undefined) {
    reqArr(raw, 'fields', at).forEach((f, i) => {
      if (!isObj(f)) throw new SemanticShapeError(`${at}.fields[${i}]`, '字段声明必须是对象');
      reqStr(f, 'name', `${at}.fields[${i}]`);
      reqStr(f, 'type', `${at}.fields[${i}]`);
    });
  }
  if (raw.attrs !== undefined && !isObj(raw.attrs)) throw new SemanticShapeError(`${at}.attrs`, 'attrs 必须是对象');
  /**
   * ★ **原样搬回**（不重建对象）：重建会丢未知键 ⇒ 往返就不无损了（`attrs` 里的自由键首当其冲）。
   *   形状已逐格判过 ⇒ 搬回的是**判过的那一份**，不是"猜的一个"。
   */
  return raw as unknown as EntityDef;
}

function shapeOperator(raw: unknown, at: string): OperatorDef {
  if (!isObj(raw)) throw new SemanticShapeError(at, '算子必须是对象');
  reqStr(raw, 'name', at);
  reqPosInt(raw, 'version', at);
  reqStr(raw, 'intent', at);
  reqArr(raw, 'inputs', at).forEach((x, i) => {
    if (!isObj(x)) throw new SemanticShapeError(`${at}.inputs[${i}]`, '输入位必须是对象');
    reqStr(x, 'ref', `${at}.inputs[${i}]`);
    reqStr(x, 'entityKind', `${at}.inputs[${i}]`);
  });
  reqArr(raw, 'outputs', at).forEach((x, i) => {
    if (!isObj(x)) throw new SemanticShapeError(`${at}.outputs[${i}]`, '输出位必须是对象');
    const m = reqStr(x, 'mutates', `${at}.outputs[${i}]`);
    // ★ 闭集在这里就拒（不是留给 validate）：一个拼错的 mutates 值会被下游**默默**当成 derive
    if (m !== 'declare' && m !== 'derive') throw new SemanticShapeError(`${at}.outputs[${i}].mutates`, `只认 'declare' | 'derive'，实测 ${JSON.stringify(m)}`);
    reqStr(x, 'produces', `${at}.outputs[${i}]`);
  });
  reqArr(raw, 'criteria', at).forEach((x, i) => {
    if (!isObj(x)) throw new SemanticShapeError(`${at}.criteria[${i}]`, '判据必须是对象');
    reqStr(x, 'id', `${at}.criteria[${i}]`);
    const tier = reqStr(x, 'tier', `${at}.criteria[${i}]`);
    if (tier !== 'declarative' && tier !== 'geometry') throw new SemanticShapeError(`${at}.criteria[${i}].tier`, `只认 'declarative' | 'geometry'，实测 ${JSON.stringify(tier)}`);
    reqStr(x, 'why', `${at}.criteria[${i}]`);
    if (x.blocked_by !== undefined) reqStr(x, 'blocked_by', `${at}.criteria[${i}]`);
    if (x.check !== undefined) reqStr(x, 'check', `${at}.criteria[${i}]`);
  });
  if (raw.supersedes !== undefined) {
    if (!isObj(raw.supersedes)) throw new SemanticShapeError(`${at}.supersedes`, 'supersedes 必须是 {name, version}');
    reqStr(raw.supersedes, 'name', `${at}.supersedes`);
    reqPosInt(raw.supersedes, 'version', `${at}.supersedes`);
  }
  if (raw.geometryImplRef !== undefined) reqStr(raw, 'geometryImplRef', at);
  if (raw.annotations !== undefined && !isObj(raw.annotations)) throw new SemanticShapeError(`${at}.annotations`, 'annotations 必须是对象');
  // ★ 原样搬回（同 `shapeEntity`：重建会丢未知键 ⇒ 往返不无损）
  return raw as unknown as OperatorDef;
}

function shapeCall(raw: unknown, at: string): OperatorCall {
  if (!isObj(raw)) throw new SemanticShapeError(at, '调用记录必须是对象');
  reqStr(raw, 'op', at);
  reqPosInt(raw, 'version', at);
  reqStr(raw, 'at', at);
  reqArr(raw, 'args', at).forEach((a, i) => {
    if (typeof a !== 'string' || a.length === 0) throw new SemanticShapeError(`${at}.args[${i}]`, `实参必须是**非空实体 id 串**，实测 ${JSON.stringify(a)}`);
  });
  return raw as unknown as OperatorCall;
}

/**
 * **JSON ⇒ 模型**，形状不对就抛（`SemanticShapeError`，带 `at` 路径）。
 *
 * 判的顺序就是**读的顺序**：`profile`（先确认这是"谁的"模型）→ `entities` → `operators` → `calls`。
 * ★ 这里**只判形状**（键在不在、类型对不对、值域合不合法），**不判语义**
 *   （唯一性 / 引用 / 版本链 / 判据非空 ⇒ 全在 `validate.ts` 的 G 系列）。
 *   两件事分开的理由：形状错 = 读不进来；语义错 = 读得进来但不自洽。混在一起时，
 *   "这份模型能不能读"和"这份模型对不对"就只剩一个出口，没法分开报。
 */
export function fromJSON(raw: unknown): SemanticModel {
  if (!isObj(raw)) throw new SemanticShapeError('(root)', '模型必须是对象');
  const profile = reqStr(raw, 'profile', '(root)');
  const ents = reqArr(raw, 'entities', '(root)').map((e, i) => shapeEntity(e, `entities[${i}]`));
  const ops = reqArr(raw, 'operators', '(root)').map((o, i) => shapeOperator(o, `operators[${i}]`));
  const calls = raw.calls === undefined ? undefined : reqArr(raw, 'calls', '(root)').map((c, i) => shapeCall(c, `calls[${i}]`));
  const m: SemanticModel = { profile, entities: ents, operators: ops };
  if (calls !== undefined) m.calls = calls;
  return m;
}

/**
 * **往返一遍**并把两端都还回来（测试与调用方各取所需）。
 * ★ 它是 `toJSON`/`fromJSON` 的**唯一**组合点：别处不许再拼一遍 `fromJSON(toJSON(x))`
 *   —— 拼两遍就有两个"往返"口径，迟早一处改了另一处没改。
 */
export function roundTrip(model: SemanticModel): { json: string; back: SemanticModel } {
  const json = JSON.stringify(toJSON(model));
  return { json, back: fromJSON(JSON.parse(json)) };
}
