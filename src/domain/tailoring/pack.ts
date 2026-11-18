/**
 * tailoring/pack.ts —— 制衣领域包**对核的唯一入口**（核只见到这个）。
 *
 * ## 它是什么
 * 把 `entities.ts` / `operators.ts` / `validate.ts` 三份内容打成一个 `SemanticModel`，
 * 并提供一个"装进注册表"的函数。核**不需要知道** tailoring 存在 —— 判据
 * `tests/p0_semantic_model.test.ts` ① 用正则扫核目录，核里出现 `tailoring` 就红。
 *
 * ## ★ 这里**只做装配**，不加语义
 * · 不补默认值（`serialize.ts` 的往返无损会被破坏）；
 * · 不吞注册失败（装不进去就**抛**，并点名是哪一条）—— 静默丢一条实体的包，
 *   看起来"装上了"，实际少了一个种类。
 */

import type { EntityDef, SemanticModel } from '../semantic_model/types.js';
import { SemanticRegistry } from '../semantic_model/registry.js';
import { validateModel } from '../semantic_model/validate.js';
import { tailoringEntities, TAILORING_ENTITY_FIELDS } from './entities.js';
import { tailoringOperators } from './operators.js';
import { validateTailoring, type TailoringGap } from './validate.js';

/** 本包在 `SemanticModel.profile` 里的名字 */
export const TAILORING_PROFILE = 'tailoring';

/**
 * 制衣包的 `SemanticModel`（实体 + 算子 + 空调用流水）。
 * ★ **每次调用都新建**（不从模块级常量共享）：调用方改动返回的对象时，
 *   不许把下一个人看到的"包"也改掉。
 */
export function tailoringModel(): SemanticModel {
  return { profile: TAILORING_PROFILE, entities: tailoringEntities(), operators: tailoringOperators(), calls: [] };
}

/** 装配失败（点名是哪一条，别只说"装不上"） */
export class TailoringPackError extends Error {
  constructor(reason: string) {
    super(`[tailoring_pack] ${reason}`);
    this.name = 'TailoringPackError';
  }
}

/**
 * 把制衣包装进一个**新建**的注册表，并做一次全量体检。
 *
 * 判据（两条，缺一不算）：
 * ① 装进去的条数 = 包里声明的条数（少一条 ⇒ 抛，点名）；
 * ② 体检 gap 为空（有 gap ⇒ 抛，逐条带 `rule` 与 `key`）。
 *
 * ★ 为什么不返回 `{ok:false}` 而是抛：包是**构建期常量**，它不自洽是**代码错**，不是数据错。
 *   数据错走 `validateTailoring(entities)`（那边返回 gap 列表，调用方自己决定怎么处理）。
 */
export function loadTailoringPack(): SemanticRegistry {
  const model = tailoringModel();
  const reg = new SemanticRegistry(model.profile);
  for (const e of model.entities) {
    const r = reg.registerEntity(e);
    if (!r.ok) throw new TailoringPackError(`实体 "${e.id}"：${r.message}`);
  }
  for (const o of model.operators) {
    const r = reg.registerOperator(o);
    if (!r.ok) throw new TailoringPackError(`算子 "${o.name}@${String(o.version)}"：${r.message}`);
  }
  const coreGaps = validateModel(reg.snapshot());
  if (coreGaps.length > 0) {
    throw new TailoringPackError(`核体检不合格（${String(coreGaps.length)} 条）：${coreGaps.map((g) => `${g.rule} ${g.key} ${g.message}`).join('；')}`);
  }
  return reg;
}

/**
 * 对一组实体做**制衣域**体检（fuint 侧落库后把实体喂进来的入口）。
 * ★ 与 `loadTailoringPack()` 的分工：那个查"包本身"（构建期常量），这个查"业务数据"。
 */
export function auditTailoringEntities(entities: readonly EntityDef[]): TailoringGap[] {
  return validateTailoring(entities);
}

/** 本包对外导出的**种类 → 字段域**（fuint 侧建表/建 DTO 时的权威来源） */
export { TAILORING_ENTITY_FIELDS };
