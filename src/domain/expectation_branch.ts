/**
 * expectation_branch —— 判据注册表 → JSON Schema 片段的**渲染核**（零依赖纯函数）。
 *
 * ## 为什么住 domain
 * 这段决策原先住在 `scripts/gen-expectation-schema.mjs#typeMap`，只能靠
 * `source-has must:["case 'json[]':"]` 守"分支还在"（文本代理：分支改成 `{type:'object'}` 它照样绿）。
 * 抽成零依赖纯函数后 7 个 type 分支都能给输入比输出。
 *
 * ★ **零值 import 是硬要求**（`E-CRIT-006`：behavior-cases 的目标文件有值 import ⇒ 写判据那一刻就拒）。
 *   字段形状在本文件用结构类型描述，不从 `expectation_kinds.ts` 取 —— 那边是注册表，本文件只认形状。
 */

/** 需要渲染成 JSON Schema 的字段形状（与 `expectation_kinds.ts#FieldSpec` 结构兼容） */
export interface SchemaField {
  readonly name: string;
  /** 字段类型（闭集见 `FieldType`；未知值落到 default ⇒ `{}`，由行为判据钉住） */
  readonly type: string;
  /** 允许值（给了就是闭集） */
  readonly values?: readonly string[];
  /** 数组最小长度 */
  readonly minItems?: number;
  /** 数组元素的子字段（`object[]` 用；`json[]` **故意不读它**） */
  readonly items?: readonly SchemaField[];
  readonly required?: boolean;
}

/**
 * 字段 → JSON Schema 片段。
 *
 * ★★ `json[]` 必须**显式**成 `{type:'array'}` 且**不写 items**（= 任意元素）：漏了会落到 default ⇒ `{}`，
 *    那样 `given:"5"`（非数组）也 PASS ⇒ 静默放宽过头（2026-10-30 D4 实测）。
 * ★ `minItems` 沿用原口径：**0 / undefined 都不写**（原实现是 `f.minItems ? … : {}`）。
 */
export function jsonSchemaTypeOf(f: SchemaField): Record<string, unknown> {
  switch (f.type) {
    case 'string':
      return f.values ? { type: 'string', enum: [...f.values] } : { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'object':
      return { type: 'object' };
    case 'string[]':
      return { type: 'array', items: { type: 'string' }, ...(f.minItems ? { minItems: f.minItems } : {}) };
    case 'json[]':
      return { type: 'array', ...(f.minItems ? { minItems: f.minItems } : {}) };
    case 'object[]':
      return {
        type: 'array',
        items: f.items
          ? {
              type: 'object',
              properties: Object.fromEntries(f.items.map((sub) => [sub.name, jsonSchemaTypeOf(sub)])),
              required: f.items.filter((x) => x.required).map((x) => x.name),
            }
          : { type: 'object' },
        ...(f.minItems ? { minItems: f.minItems } : {}),
      };
    default:
      return {};
  }
}
