/**
 * semantic_model/registry.ts —— **注册表的容器**（domain 层，**零 import**）。
 *
 * ## 它是什么
 * 一个「实体 id → 实体」「`name@version` → 算子」的**查找表**，外加**注册时的形状闸**：
 * 形状不对（`serialize.ts` 抛的那类）在**进来的那一刻**就拒，不留到后面某次查找才发现。
 *
 * ## ★ 刻意不做的事（每条都有理由，别"顺便"加回来）
 * · **不判语义**（唯一性 / 引用 / 版本链 / 判据非空）——那是 `validate.ts` 的 G 系列。
 *   理由：注册是**增量**动作，语义是**整份模型**的性质。混在一起时，"加一个实体"会顺手
 *   对全模型判一遍 ⇒ 一个半构造中的模型永远进不了注册表。
 * · **不做 IO、不读文件、不存盘** —— 落盘的唯一出口是 `serialize.ts`。
 * · **不含任何领域词**：本文件不知道"缸号"是什么，它只知道 `id / kind / name / version`。
 *
 * ## ★ 为什么"重名即抛"而不是"后到的覆盖"
 * 覆盖 = 静默丢失一个已经注册过的东西，而那正是本仓反复撞的坑
 * （`change_set.ts:30-31`：静默省略 ⇒ 读的人以为"这里有 0 条"，其实是"这里没看"）。
 * 要改一个实体，走"改完再注册"的显式路径（`replace`），不靠"盖一层"。
 */

import type { EntityDef, OperatorCall, OperatorDef, SemanticModel } from './types.js';
import { fromJSON, toJSON } from './serialize.js';

/** 注册被拒的原因（**机器可判**的闭集；报文另由 `message` 承担） */
export type RejectReason = 'shape' | 'duplicate' | 'unknown';

/** 一次注册结果：成功给登记后的对象；失败给原因 + 人读文本（**不许**只给 `false`） */
export type RegisterOutcome<T> = { ok: true; value: T } | { ok: false; reason: RejectReason; message: string };

/** 算子的全名（`name@version`）—— 版本链存在 ⇒ **只写名字读不出是哪一版** */
export function operatorKey(name: string, version: number): string {
  return `${name}@${String(version)}`;
}

/**
 * 语义模型注册表。
 *
 * ★ 它是**一份**模型的权威容器：`snapshot()` 吐出来的就是 `serialize.ts` 吃的那个 `SemanticModel`。
 *   两者之间不许有第二份形状（`toJSON(snapshot())` 跑通 ⇒ 注册表里没有序列化不了的角落）。
 */
export class SemanticRegistry {
  readonly profile: string;
  #entities = new Map<string, EntityDef>();
  #operators = new Map<string, OperatorDef>();
  #calls: OperatorCall[] = [];

  constructor(profile: string) {
    if (typeof profile !== 'string' || profile.length === 0) throw new Error('[semantic_registry] profile 必须是非空串（空串 = 这份模型属于谁读不出来）');
    this.profile = profile;
  }

  /** 注册一个实体（id 重名 ⇒ `duplicate`；形状错 ⇒ `shape`） */
  registerEntity(raw: unknown): RegisterOutcome<EntityDef> {
    const r = shapeOf<EntityDef>(raw, `entity ${String((raw as { id?: unknown } | null)?.id ?? '?')}`);
    if (!r.ok) return r;
    const e = r.value;
    if (this.#entities.has(e.id)) return { ok: false, reason: 'duplicate', message: `实体 id "${e.id}" 已注册过（要改走 replaceEntity，不靠覆盖）` };
    this.#entities.set(e.id, e);
    return { ok: true, value: e };
  }

  /**
   * 原地替换一个已注册实体（**显式**改形状的唯一路径）。
   * 未注册过的 id ⇒ `unknown`（"替换"不能顺手变成"新建"）。
   * ★ 该实体若被某条已注册的调用记录引用，**不允许**替换 —— 否则那条记录指向的就不是当初调用的那个实体了。
   */
  replaceEntity(raw: unknown): RegisterOutcome<EntityDef> {
    const r = shapeOf<EntityDef>(raw, 'entity');
    if (!r.ok) return r;
    const e = r.value;
    if (!this.#entities.has(e.id)) return { ok: false, reason: 'unknown', message: `实体 id "${e.id}" 没注册过 —— replace 不负责新建（新建走 registerEntity）` };
    const usedBy = this.#calls.filter((c) => c.args.includes(e.id));
    if (usedBy.length > 0) {
      return { ok: false, reason: 'duplicate', message: `实体 "${e.id}" 已被 ${usedBy.length} 条调用记录引用（如 ${usedBy[0].op}@${String(usedBy[0].version)}）—— 被引用过的实体不许原地改写` };
    }
    this.#entities.set(e.id, e);
    return { ok: true, value: e };
  }

  /** 注册一个算子（`name@version` 重名 ⇒ `duplicate`；形状错 ⇒ `shape`） */
  registerOperator(raw: unknown): RegisterOutcome<OperatorDef> {
    const r = shapeOf<OperatorDef>(raw, `operator ${String((raw as { name?: unknown } | null)?.name ?? '?')}`);
    if (!r.ok) return r;
    const o = r.value;
    const key = operatorKey(o.name, o.version);
    if (this.#operators.has(key)) return { ok: false, reason: 'duplicate', message: `算子 "${key}" 已注册过（版本链只增：新行为请登记新 version）` };
    this.#operators.set(key, o);
    return { ok: true, value: o };
  }

  /**
   * 记一条调用（**只记经历，不判对错**）。
   * 形状错 ⇒ `shape`；算子/实参实体不存在 ⇒ `unknown`（**当场点名**，不留到 `validate` 才说）。
   */
  recordCall(raw: unknown): RegisterOutcome<OperatorCall> {
    const r = shapeOfCall(raw);
    if (!r.ok) return r;
    const c = r.value;
    const op = this.#operators.get(operatorKey(c.op, c.version));
    if (!op) return { ok: false, reason: 'unknown', message: `调用记录指向的算子 "${operatorKey(c.op, c.version)}" 没注册过` };
    if (c.args.length !== op.inputs.length) {
      return { ok: false, reason: 'shape', message: `实参 ${c.args.length} 个，而算子 "${operatorKey(op.name, op.version)}" 声明了 ${op.inputs.length} 个输入位` };
    }
    const missing = c.args.filter((a) => !this.#entities.has(a));
    if (missing.length > 0) return { ok: false, reason: 'unknown', message: `实参里的实体 id 没注册过：${missing.join(' / ')}` };
    this.#calls.push(c);
    return { ok: true, value: c };
  }

  /** 按 id 取实体（未注册 ⇒ `undefined`；**不抛** —— 调用方要自己决定"没有"意味着什么） */
  entityOf(id: string): EntityDef | undefined {
    return this.#entities.get(id);
  }

  /** 按 `name@version` 取算子 */
  operatorOf(name: string, version: number): OperatorDef | undefined {
    return this.#operators.get(operatorKey(name, version));
  }

  /** 某实体种类的全部实体（**保注册序** —— 顺序会影响人读，故不按字母重排） */
  entitiesOfKind(kind: string): EntityDef[] {
    return [...this.#entities.values()].filter((e) => e.kind === kind);
  }

  /** 全部实体（保注册序） */
  allEntities(): EntityDef[] {
    return [...this.#entities.values()];
  }

  /** 全部算子（保注册序） */
  allOperators(): OperatorDef[] {
    return [...this.#operators.values()];
  }

  /** 全部调用记录（保记录序） */
  allCalls(): OperatorCall[] {
    return [...this.#calls];
  }

  /** 这份模型的**唯一**序列化视图（`serialize.ts` 吃的就是它） */
  snapshot(): SemanticModel {
    return {
      profile: this.profile,
      entities: this.allEntities(),
      operators: this.allOperators(),
      calls: this.allCalls(),
    };
  }

  /** 快照 ⇒ JSON 串（走 `serialize.ts` 的同一把尺，不另写一份 stringify） */
  toJSONString(): string {
    return JSON.stringify(toJSON(this.snapshot()));
  }

  /**
   * 用一份 JSON **重建**注册表（坏形状 ⇒ 抛 `SemanticShapeError`，不半途建出一个"差不多"的注册表）。
   * ★ 先整份 `fromJSON` 判完，再逐条注册 —— 顺序反了就会留下"建到一半"的实例。
   */
  static fromJSONString(json: string): SemanticRegistry {
    const model = fromJSON(JSON.parse(json));
    const reg = new SemanticRegistry(model.profile);
    for (const e of model.entities) {
      const r = reg.registerEntity(e);
      if (!r.ok) throw new DuplicateOnRebuild(`实体 "${e.id}"：${r.message}`);
    }
    for (const o of model.operators) {
      const r = reg.registerOperator(o);
      if (!r.ok) throw new DuplicateOnRebuild(`算子 "${operatorKey(o.name, o.version)}"：${r.message}`);
    }
    for (const c of model.calls ?? []) {
      const r = reg.recordCall(c);
      if (!r.ok) throw new DuplicateOnRebuild(`调用记录 "${operatorKey(c.op, c.version)}"：${r.message}`);
    }
    return reg;
  }
}

/** 重建时撞到重复（**不是**形状错：形状已经过了 `fromJSON`；这是"同一份 JSON 里有两条同 id" ） */
export class DuplicateOnRebuild extends Error {
  constructor(reason: string) {
    super(`[semantic_registry] 重建失败：${reason}`);
    this.name = 'DuplicateOnRebuild';
  }
}

/** 形状闸（实体/算子共用）：塞进最小模型过 `serialize.ts` 的**同一把尺** */
function shapeOf<T>(raw: unknown, what: string): RegisterOutcome<T> {
  try {
    return { ok: true, value: probeEntityOrOperator(raw, what) as T };
  } catch (e) {
    return { ok: false, reason: 'shape', message: (e as Error).message };
  }
}

/** 调用记录的形状闸（走 `serialize.ts#fromJSON` 的 `calls` 分支，仍是同一把尺） */
function shapeOfCall(raw: unknown): RegisterOutcome<OperatorCall> {
  try {
    const back = fromJSON({ profile: 'probe', entities: [], operators: [], calls: [raw] });
    const c = back.calls?.[0];
    if (!c) throw new Error('[semantic_shape] 调用记录的形状探测没有回来任何东西');
    return { ok: true, value: c };
  } catch (e) {
    return { ok: false, reason: 'shape', message: (e as Error).message };
  }
}

/**
 * 单条形状探测：把一条实体/算子塞进**最小模型**里过 `serialize.ts` 的同一把尺，
 * 成功则**原样**返回那一格（不重建对象 ⇒ 未知键不丢）。
 *
 * ★ 为什么要"塞进最小模型"而不是另写一个单条校验器：另写一个 = 两个形状口径，
 *   迟早一处改了另一处没改（本仓"第二份真相"的历史都是这么来的）。
 */
function probeEntityOrOperator(raw: unknown, what: string): unknown {
  const isOperator = !!raw && typeof raw === 'object' && 'criteria' in (raw as Record<string, unknown>);
  const shell = isOperator
    ? { profile: 'probe', entities: [], operators: [raw] }
    : { profile: 'probe', entities: [raw], operators: [] };
  const back = fromJSON(shell);
  const picked = isOperator ? back.operators[0] : back.entities[0];
  if (pickerMissing(picked)) throw new Error(`[semantic_shape] ${what}: 形状探测没有回来任何东西（这是探测器的问题，不是数据的问题）`);
  return picked;
}

function pickerMissing(v: unknown): boolean {
  return v === undefined || v === null;
}
