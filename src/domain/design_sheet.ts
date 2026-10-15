/**
 * ★★★ 「设计图（手写）」 vs 「实际（扫描）」的**只读对拍**（2026-10-15）。
 *
 * ## 用户逐字（这是本模块存在的全部理由）
 *   *"机器只能算出它的那些 DSL，我的意思是让你手写一份和机器算出来的东西**同一性质**的东西，
 *     只不过那个是机器算出来的，而你是对于项目的一个设计。"*
 *   ⇒ 两份**同性质**的 DSL（`design/<f>.dsl.json` 与 `live/<f>.dsl.json`）**直接对拍**。
 *
 * ## 配对规则（★ 用户已拍的身份规则，本模块**只照做**、不改）
 *   ★★ 用户逐字：*"那就是**实现了的，有 ID；没实现的没 ID**，不就好了"* ⇒ **id 空间只有一套（扫描给的）**。
 *   ⇒ 对拍时两边的**指代**分两半（口径只此两处：{@link designSheetRef} / {@link designSheetPendingRefs}）：
 *     · **已实现**的对象 ⇒ 用**扫描给的 `id`** 指代（设计侧写了 id 就是"我要这个已存在的东西"）；
 *     · ★ **未实现**的对象 ⇒ 用**「名字/路径」**指代（对齐 `expectations` 六种 kind 与
 *       `overlay.nodePath` 的既有做法：`file-exists {path}` / `files:<路径>` 都靠名字指代，
 *       **无一自造 id**）—— ★ 所以**不必**给"想要的东西"编一个 `node_pending_x`。
 *   ★★ 且未实现的条目**根本不进 `geometry.nodes[]`**（见 {@link designSheetPendingRefs} 上方）：
 *      `nodes[]` 是"**已实现的结构**"，而 `validateDSL` 要求 `Node.id`
 *      （`schema/design_dsl.schema.json` → `definitions.Node.required=["id"]`）—— 两条都指向同一件事。
 *   三类判定（**语义不变**，只换指代）：
 *     · 两指代相同 ⇒ **比属性**（差异块）—— 只列**有差**的（逐字段给两边原值）；
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
 * ★ `id` 本身是**配对键的一半**、不在清单里（★ 两边**指代相同**才进比属性这一步；指代口径见 {@link designSheetRef}）。
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
  /** 节点**指代**（配对键：实现的 = id；未实现的 = 名字/路径） */
  id: string;
  /** 属性名（∈ {@link DESIGN_SHEET_NODE_KEYS}） */
  key: string;
  /** 设计侧原值（缺失 = undefined） */
  design: unknown;
  /** live 侧原值（缺失 = undefined） */
  live: unknown;
}

/** 两指代相同的节点：两边都有，但**至少一个属性不同** */
export interface SameIdDiff {
  /** 节点**指代**（配对键） */
  id: string;
  attrs: NodeAttrDiff[];
}

/** 对拍结果（三类差异 + 计数） */
export interface DesignSheetDiff {
  /** ① 指代相同但属性有差：两边都有、且至少一个属性不同（★ 只含有差的） */
  same_id: SameIdDiff[];
  /**
   * ② ★ 只在设计里 ⇒ 「要实现」。
   * ★ 列的是**设计侧的指代**：`nodes[]` 里已实现的对象 = `id`（见 {@link designSheetRef}）；
   *   **未实现的条目 = 名字/路径**（见 {@link designSheetPendingRefs}，★ 它**不住 `nodes[]`**，
   *   住 `meta.goals`）—— ★ 不给"想要的东西"自造 id。
   */
  design_only: string[];
  /** ③ 只在 live 里 ⇒ 「未纳入设计」（live 全是已实现的 ⇒ 列 `id`） */
  live_only: string[];
  counts: {
    /** 设计图节点数 */
    design: number;
    /** live 节点数 */
    live: number;
    /** 指代相同且**逐字段一致**的节点数 */
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
 * ★★ 一个节点的**指代**（"这份图里怎么称呼它"）—— ★ **口径只此一处**，别处不许再推一遍。
 *
 * ## 规则（用户已拍的身份规则，逐字见文件头）
 *   · **有 `id`** ⇒ 这是「**已实现**的对象」⇒ 指代 = `id`（★ **只有一套 id 空间**：扫描给的）；
 *   · ★ **没有 `id`** ⇒ 这是「**未实现**的对象」⇒ 指代 = **名字/路径**（**不自造 id**）：
 *       - `file` 节点：**路径**住 `description`（★ 与 `overlay.nodePath` **同口径**：`if (n.type === 'file') return n.description ?? n.id`）；
 *       - 其余节点：**名字**取 `label`（缺则 `description`）。
 *
 * ## 对齐哪条既有解法（不是新造）
 *   `expectations` 六种 kind 全用「路径/符号名」指代、无一用 id（`domain/expectation.ts:35`），
 *   且 `file-exists {path}` 能指向**还不存在的文件**、**重建后活着**；
 *   `scope` 的 `files:<路径>`（`domain/scope.ts:31`）与 `overlay` 的对账（按 `path` 认亲，`domain/overlay.ts:406`）同款。
 */
export function designSheetRef(n: Node): string {
  const id = typeof n.id === 'string' ? n.id.trim() : '';
  if (id) return id; // ★ 已实现：唯一 id 空间（扫描给的）
  const desc = (n.description ?? '').trim();
  const name = (n.label ?? '').trim();
  // ★ 未实现：名字/路径指代（file 用路径，其余用名字；都缺时给一个响亮可见的兜底，不静默）
  return (n.type === 'file' ? desc || name : name || desc) || `<无名占位:${n.type ?? 'node'}>`;
}

/**
 * ★★ 「**要实现**」的条目（**未实现**）住在哪 + 怎么指代 —— ★ **口径只此一处**。
 *
 * ## 为什么**不在 `nodes[]` 里**（这是裁定，不是偏好）
 *   `geometry.nodes[]` 是「**已实现的结构**」：`validateDSL` **要求 `Node.id`**
 *   （`schema/design_dsl.schema.json` → `definitions.Node.required=["id"]`），而用户已拍的身份规则是
 *   **"实现了的有 ID、没实现的没 ID"** ⇒ 把无 id 的"想要的东西"塞进 `nodes[]`，
 *   **这两条会互相拧**（实测：`valid=false`，`[required] /geometry/nodes/1: must have required property 'id'`）。
 *   ★ 依据（先找既有解法）：本仓**无 id 的指代本来都不在 `nodes[]` 里** ——
 *     `expectations` 挂在决策卡上（`domain/expectation.ts:35-40`，`file-exists {path}` 可指**还不存在的文件**）、
 *     `scope` 是字符串（`domain/scope.ts:31` `files:<仓库相对路径>`）。
 *
 * ## 住哪：**复用既有的 `meta.goals`**（★ 零新增区块）
 *   `meta` 是本仓**已声明**的"**无类型袋子**"、`goals` **已住此处**
 *   （`application/design/dsl_ops/update_feature.ts:554` 逐字；
 *    `overlay.global.goals` 由 `applyOverlay` 投影进 `base.meta.goals` —— `domain/overlay.ts:550-559`；
 *    读回见 `:638-640`）。★ 而 `goals` 每一格正是"**待建条目**"的形状（`title` 名字 / `description` 细节 /
 *   `status`），**且工具层允许它没有 `id`**（`application/design/index.ts:736` `id: z.string().optional()`，
 *   `title` 才是必填）⇒ 与"**未实现的不自造 id、用名字/路径指代**"**同一条规则**。
 *   ★ `validateDSL` 实测**接受**这份形状（`meta` 不在 schema 的 `properties` 里、而 schema 未设
 *   `additionalProperties:false` ⇒ 不拦）—— 读数见 `certs/t339-*.mjs` 判据 ①。
 *
 * ## 指代口径（与 {@link designSheetRef} 同款：**路径优先、名字兜底**）
 *   · `description`（细节位；本仓把**仓库相对路径**放这儿的既有做法：`overlay.nodePath` —— `domain/overlay.ts:331-333`
 *     `if (n.type === 'file') return n.description ?? n.id`）⇒ 取它作为**路径指代**；
 *   · 缺则 `title`（名字）；
 *   · 都缺 ⇒ **响亮可见**的兜底，不静默。
 *
 * ## ★ 有 `id` 的 goal **不是**"要实现"条目
 *   与 `designSheetRef` 同一条规则：**有 id ⇒ 指的是"已实现的对象"** ⇒ 它不是待建占位，
 *   于是**不进** `只在设计里(要实现)`（既有带 id 的目标**不被误伤**，读数见 `certs/t339-*.mjs` 判据 ④）。
 */
export function designSheetPendingRefs(dsl: DesignDSL | null | undefined): string[] {
  const meta = (dsl as unknown as { meta?: { goals?: unknown } } | null | undefined)?.meta;
  const goals = meta?.goals;
  if (!Array.isArray(goals)) return [];
  const out: string[] = [];
  for (const g of goals) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (id) continue; // ★ 已实现：由 `designSheetRef`/扫描给的 id 指代，不算"要实现"
    const desc = typeof o.description === 'string' ? o.description.trim() : '';
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    out.push(desc || title || '<无名占位:goal>');
  }
  return out;
}

/**
 * 对拍两份同性质 DSL（**按 {@link designSheetRef} 的指代配对**）—— 纯函数，同一输入两次结果逐字相同。
 *
 * ★ 设计侧键 = `designSheetRef`（`nodes[]` 里：有 id ⇒ id；无 id ⇒ 名字/路径）**∪** {@link designSheetPendingRefs}
 *   （★ 未实现条目，住 `meta.goals`，用名字/路径）；live 侧键 = `id`（扫描给的唯一 id 空间）。
 *
 * @param design 手写设计图（`design/<f>.dsl.json`）
 * @param live   扫描产物（`live/<f>.dsl.json`）
 */
export function diffDesignSheet(design: DesignDSL, live: DesignDSL): DesignSheetDiff {
  const dNodes = nodesOf(design);
  const lNodes = nodesOf(live);
  // ★ 设计侧用**指代**（未实现的没有 id ⇒ 用名字/路径）；live 侧一律用扫描给的 id
  const dByRef = new Map<string, Node>(dNodes.map((n) => [designSheetRef(n), n]));
  const lById = new Map(lNodes.map((n) => [n.id, n]));

  const same_id: SameIdDiff[] = [];
  let sameIdentical = 0;
  for (const [ref, dn] of dByRef) {
    const ln = lById.get(ref);
    if (!ln) continue;
    const attrs: NodeAttrDiff[] = [];
    for (const key of DESIGN_SHEET_NODE_KEYS) {
      const dv = (dn as unknown as Record<string, unknown>)[key];
      const lv = (ln as unknown as Record<string, unknown>)[key];
      if (!sameValue(dv, lv)) attrs.push({ id: ref, key, design: dv, live: lv });
    }
    if (attrs.length === 0) sameIdentical++;
    else same_id.push({ id: ref, attrs });
  }

  // ★ 只排序输出（便于人读与逐字比对），**不改变**配对语义
  same_id.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // ★ 「只在设计里」列的是**设计侧的指代**：`nodes[]` 里已实现的对象 = id；
  //   **未实现的条目 = 名字/路径**（★ 它**不住 `nodes[]`**，住 `meta.goals` —— 见 {@link designSheetPendingRefs}）
  const designRefs = new Set<string>([...dByRef.keys(), ...designSheetPendingRefs(design)]);
  const design_only = [...designRefs].filter((ref) => !lById.has(ref)).sort();
  const live_only = [...lById.keys()].filter((id) => !designRefs.has(id)).sort();

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
