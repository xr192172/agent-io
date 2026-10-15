/**
 * ★★★ 「设计图（手写）」 vs 「实际（扫描）」的**只读对拍**（2026-10-15）。
 *
 * ## 用户逐字（这是本模块存在的全部理由）
 *   *"机器只能算出它的那些 DSL，我的意思是让你手写一份和机器算出来的东西**同一性质**的东西，
 *     只不过那个是机器算出来的，而你是对于项目的一个设计。"*
 *   ⇒ 两份**同性质**的 DSL（`design/<f>.dsl.json` 与 `live/<f>.dsl.json`）**直接对拍**。
 *
 * ## 配对规则（★ 开发者已拍的身份规则，本模块**只照做**、不改）
 *   两份图**各用各的 `id`**，对拍时**按 id 同名配对**：
 *     · 两边都有 ⇒ **比属性**（差异块）—— 只列**有差**的（逐字段给两边原值）；
 *     · ★ **只在设计里** ⇒ 判为「**要实现**」（这正是"挪建筑"出来的任务）；
 *     · **只在 live 里** ⇒ 判为「**未纳入设计**」（提示，未必是错 —— 扫描看清了、设计还没写进去）。
 *
 * ## 本模块是**纯函数**（无 IO、不落盘、不新增存储）
 *   三份的"读"在 `application/design/handlers.ts` 的 `diffDesignSheetHandler`（infrastructure 侧存储见
 *   `storage.ts` 的 `getDesignSheet` / `getLiveFeatureResolved` / `getDSL`）—— 与 `domain/overlay.ts`
 *   的"纯搬运在 domain、IO 在 infrastructure"同一分层。
 */
import type { Node } from './geometry.js';
import type { DesignDSL } from './types.js';

/**
 * 参与对拍的节点属性 —— ★ **显式清单**（只比"设计上说得清"的那几个字段）。
 *
 * ★ 为什么是清单而不是"比整份 JSON"：`geometry.nodes[]` 里混着渲染/派生字段（`x`/`y`/`style`/
 *   `swimlane` 等），全比 ⇒ 一行坐标差就把对拍淹了，真正的结构差异反而看不见。清单**只列意图字段**。
 * ★ `id` 本身是**配对键**、不在清单里（同 id 才进比属性这一步）。
 * ★ `attributes` 是决策卡的**类型化参数表**（本仓既有定义：`Node.attributes`，机器可对拍的那一档）。
 */
export const DESIGN_SHEET_NODE_KEYS = [
  'label',
  'type',
  'title',
  'description',
  'status',
  'layer',
  'arch_layer',
  'attributes',
] as const;

/** 某个属性在一侧的取值 */
export interface NodeAttrDiff {
  /** 节点 id（配对键） */
  id: string;
  /** 属性名（∈ {@link DESIGN_SHEET_NODE_KEYS}） */
  key: string;
  /** 设计侧原值（缺失 = undefined） */
  design: unknown;
  /** live 侧原值（缺失 = undefined） */
  live: unknown;
}

/** 同名节点：两边都有，但**至少一个属性不同** */
export interface SameIdDiff {
  id: string;
  attrs: NodeAttrDiff[];
}

/** 对拍结果（三类差异 + 计数） */
export interface DesignSheetDiff {
  /** ① 同名属性差：两边都有、且至少一个属性不同（★ 只含有差的） */
  same_id: SameIdDiff[];
  /** ② ★ 只在设计里 ⇒ 「要实现」 */
  design_only: string[];
  /** ③ 只在 live 里 ⇒ 「未纳入设计」 */
  live_only: string[];
  counts: {
    /** 设计图节点数 */
    design: number;
    /** live 节点数 */
    live: number;
    /** 同名且**逐字段一致**的节点数 */
    same_identical: number;
  };
}

/** 取几何层节点（`geometry.nodes` 是本仓节点表；缺省 = 空） */
function nodesOf(dsl: DesignDSL | null | undefined): ReadonlyArray<Node> {
  return dsl?.geometry?.nodes ?? [];
}

/** 深比较两个属性值（顺序无关的 JSON 等价；`undefined` 与"键缺失"同义） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 对拍两份同性质 DSL（**按 id 同名配对**）—— 纯函数，同一输入两次结果逐字相同。
 *
 * @param design 手写设计图（`design/<f>.dsl.json`）
 * @param live   扫描产物（`live/<f>.dsl.json`）
 */
export function diffDesignSheet(design: DesignDSL, live: DesignDSL): DesignSheetDiff {
  const dNodes = nodesOf(design);
  const lNodes = nodesOf(live);
  const dById = new Map(dNodes.map((n) => [n.id, n]));
  const lById = new Map(lNodes.map((n) => [n.id, n]));

  const same_id: SameIdDiff[] = [];
  let sameIdentical = 0;
  for (const [id, dn] of dById) {
    const ln = lById.get(id);
    if (!ln) continue;
    const attrs: NodeAttrDiff[] = [];
    for (const key of DESIGN_SHEET_NODE_KEYS) {
      const dv = (dn as unknown as Record<string, unknown>)[key];
      const lv = (ln as unknown as Record<string, unknown>)[key];
      if (!sameValue(dv, lv)) attrs.push({ id, key, design: dv, live: lv });
    }
    if (attrs.length === 0) sameIdentical++;
    else same_id.push({ id, attrs });
  }

  // ★ 只排序输出（便于人读与逐字比对），**不改变**配对语义
  same_id.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const design_only = [...dById.keys()].filter((id) => !lById.has(id)).sort();
  const live_only = [...lById.keys()].filter((id) => !dById.has(id)).sort();

  return { same_id, design_only, live_only, counts: { design: dNodes.length, live: lNodes.length, same_identical: sameIdentical } };
}

/** 三类差异的**一行摘要**（渲染用；判据不在此处） */
export function diffDesignSheetLine(d: DesignSheetDiff): string {
  const attrs = d.same_id.reduce((n, s) => n + s.attrs.length, 0);
  return (
    `设计图 ${d.counts.design} 节点 · live ${d.counts.live} 节点 ⇒ ` +
    `同名属性差 ${d.same_id.length} 个节点/${attrs} 个属性 · ` +
    `只在设计里（要实现）${d.design_only.length} · 只在 live 里（未纳入设计）${d.live_only.length}`
  );
}
