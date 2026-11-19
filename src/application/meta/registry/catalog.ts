/**
 * 工具**目录派生**三件：`ToolCatalogEntry` / `LANE_META`（线元信息）/ `catalogOf`（含 `collect*Keys`）
 * —— 零实现依赖的叶子模块（只有纯数据 + 纯函数）。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：原先全住 `capability_map.ts`。
 *   `server_registry`（MCP 面注册 + 接续段）与 `meta/index.ts`（capability_map 工具的 schema/回执）
 *   只需要这几样**元数据**，却因为静态 import 把 `capability_map → scan_authorities → storage`
 *   那条 ≈400 ms 的实现图拉进了每一次工具调用（失败调用路径上最大的单项）。
 *   搬到叶子后：`capability_map` re-export（公开 API 不动），它的实现图只在真跑导航时加载。
 */
import type { ToolDef } from '../../types.js';
import type { LaneId } from './lane_ids.js';

export interface ToolCatalogEntry {
  name: string;
  title?: string;
  description?: string;
  /**
   * ★★ 该工具**声明入参**里的**全部属性名**（**深层**收集，含数组元素对象里的键）—— 2026-10-06 加。
   * ★ 为什么必须"深层"：`rename_symbols` 的对象入参**不在顶层** —— 它是
   *   `renames: z.array(z.object({ file, symbol, to }))` ⇒ 只看顶层键会得到 `renames`（一个 `context` 词）
   *   ⇒ **判成"下游不要对象"（假阴性）**。★ 与记过的 `touched` 盲区**同一个病：量具只量到顶层**。
   * ★ 由 `application/meta/index.ts` 在注入目录时用 {@link collectInputKeys} 算好（那层拿得到 zod）。
   */
  inputKeys?: readonly string[];
  /**
   * ★★★ 该工具**顶层必填**入参名（2026-10-09，T81 配套；口径见 {@link collectRequiredKeys}）。
   * ★ 它是「接续」段能说清"**还差哪些必填**"的依据 —— 否则"直接可用（零手工）"会误导。
   */
  requiredKeys?: readonly string[];
}

export function collectRequiredKeys(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    const probe = (v as { isOptional?: () => boolean } | null)?.isOptional;
    const optional = typeof probe === 'function' ? (v as { isOptional: () => boolean }).isOptional() : true;
    if (!optional) out.push(k);
  }
  return out;
}

export function collectInputKeys(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const top = schema as Record<string, unknown>;
  const out = new Set<string>(Object.keys(top));
  const walk = (t: unknown, d: number): void => {
    if (!t || d > 8) return;
    const shape = (t as { shape?: unknown }).shape as Record<string, unknown> | undefined;
    if (shape && typeof shape === 'object' && !Array.isArray(shape)) {
      for (const [k, v] of Object.entries(shape)) {
        out.add(k);
        walk(v, d + 1);
      }
      return;
    }
    const def = (t as { _def?: Record<string, unknown> })._def;
    if (!def) return;
    // ★ 逐一走**已知承载子类型**的字段（v3 与 v4 取并集）——
    //   `type`（v3 的 array/innerType 位置；v4 退化成字符串 ⇒ 无害 no-op）
    //   `element`（v4 的 ZodArray）、`innerType`（optional/nullable/default/effects）、
    //   `valueType`（record）、`options` / `items`（union / tuple）
    walk(def.type, d + 1);
    walk(def.element, d + 1);
    walk(def.innerType, d + 1);
    walk(def.valueType, d + 1);
    for (const key of ['options', 'items'] as const) {
      const arr = def[key];
      if (Array.isArray(arr)) for (const o of arr) walk(o, d + 1);
    }
  };
  for (const v of Object.values(top)) walk(v, 0);
  return [...out].sort();
}

export function catalogOf(defs: readonly ToolDef[]): ToolCatalogEntry[] {
  return defs.map((d) => ({
    name: d.name,
    title: d.title,
    description: d.description,
    inputKeys: collectInputKeys(d.inputSchema),
    requiredKeys: collectRequiredKeys(d.inputSchema),
  }));
}
