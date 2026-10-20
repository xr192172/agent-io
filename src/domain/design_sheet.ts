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
 *   四类判定（前三类**语义不变**，只换指代；第四类是 2026-10-16 补的收口）：
 *     · 两指代相同 ⇒ **比属性**（差异块）—— 只列**有差**的（逐字段给两边原值）；
 *     · ★ **只在设计里** ⇒ 判为「**要实现**」（这正是"挪建筑"出来的任务）；
 *     · **只在 live 里** ⇒ 判为「**未纳入设计**」（提示，未必是错 —— 扫描看清了、设计还没写进去）；
 *     · ★★ **设计侧"无 id"的条目，其实在 live 里已经存在**（靠"名字/路径"认出来）⇒ 判为
 *       「**已认亲**」（{@link ResolvedDiff}，**带上它认到的 live 节点 id**），**不再计入 `design_only`**。
 *
 * ## ★★ 第四类的病（用户逐字，本类存在的全部理由）
 *   *"对拍的话，不应该是发现有一模一样的节点，然后一边是已实现一边是未实现，就是说一边有 ID 一边没 ID，
 *     就自动把这个一模一样的节点赋予实际的 ID 吗？… 只有这几个点的 ID 没定好，但它们的形状是一模一样的，
 *     能不能拍出来？然后赋予同一个 ID"*
 *   ⇒ 旧口径**只看 id**：无 id 条目（住 `meta.goals`）的指代是"名字/路径"，**永远 ≠ live 的 id**
 *     ⇒ 那条**永远被判成"要实现"**（东西做好了它还挂着 —— **"要实现"永远不会自己收口**）。
 *   ⇒ 本类**照 `overlay` 对账的既有口径办**（认亲用什么键、认不到怎么办，见 {@link diffDesignSheet} 内注释）。
 *
 * ## 本模块是**纯函数**（无 IO、不落盘、不新增存储）
 *   三份的"读"在 `application/design/handlers.ts` 的 `diffDesignSheetHandler`（infrastructure 侧存储见
 *   `storage.ts` 的 `getDesignSheet` / `getLiveFeatureResolved` / `getDSL`）—— 与 `domain/overlay.ts`
 *   的"纯搬运在 domain、IO 在 infrastructure"同一分层。
 */
import type { Node } from './geometry.js';
import type { DesignDSL } from './types.js';
import { nodePath } from './overlay.js';

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

/**
 * ★★ 第四类：**设计侧"无 id"的条目，在 live 里其实已经存在**（靠"名字/路径"认出来）⇒ 「**已认亲**」。
 *
 * ★ 与 `overlay.reconcileOverlay` 的"认亲"同族（`domain/overlay.ts:439` 按 `path` 认亲、
 *   `:442-444` 路径漂移时按签名认亲、`:447-451` 认不到 ⇒ 标 `orphaned` 不静默丢）——
 *   本类**照同一口径办**，只换键（这里是 `path`/`name`）。★ 规则：**认到就赋予同一个 ID** ⇒ 输出带 `id`（= live 节点 id）。
 */
export interface ResolvedDiff {
  /** 设计侧**无 id** 条目的**指代**（名字/路径；与 {@link designSheetRef} 同口径） */
  ref: string;
  /** ★ 认到的 **live 节点 id**（这就是"赋予同一个 ID"的那个 id） */
  id: string;
  /** 认亲所用键：`path`（路径优先）| `name`（名字兜底）—— 对齐 `overlay` 的"路径优先、认不到再换键" */
  matched_by: 'path' | 'name';
}

/** 对拍结果（四类差异 + 计数） */
export interface DesignSheetDiff {
  /** ① 指代相同但属性有差：两边都有、且至少一个属性不同（★ 只含有差的） */
  same_id: SameIdDiff[];
  /**
   * ② ★ 只在设计里 ⇒ 「要实现」。
   * ★ 列的是**设计侧的指代**：`nodes[]` 里已实现的对象 = `id`（见 {@link designSheetRef}）；
   *   **未实现的条目 = 名字/路径**（见 {@link designSheetPendingRefs}，★ 它**不住 `nodes[]`**，
   *   住 `meta.goals`）—— ★ 不给"想要的东西"自造 id。
   * ★★ 第四类（{@link ResolvedDiff}）的条目**已从此列移出**（它们不再"只在设计里"）。
   */
  design_only: string[];
  /** ③ 只在 live 里 ⇒ 「未纳入设计」（live 全是已实现的 ⇒ 列 `id`） */
  live_only: string[];
  /**
   * ④ ★★ **已认亲**：设计侧**无 id** 的条目按"名字/路径"在 live 里认到了**已存在**的节点
   * （★ 带上它认到的 live 节点 `id`）—— 这正是"要实现"**自己收口**的那一类。
   * ★ 判据：**认不到就仍留在 `design_only`**（**不**把认不出的一律当已实现）。
   */
  resolved: ResolvedDiff[];
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
  // ★ 口径 = {@link goalPendingEntries}（住 `meta.goals` 的那组）—— 与本函数原语义逐字相同
  return goalPendingEntries(dsl).map((e) => e.ref);
}

/**
 * 设计侧**无 id** 条目的**结构化**形状 —— ★ **认亲（第四类）与"要实现"（第二类）共用的唯一口径**。
 *   · {@link PendingEntry.ref} = 指代（{@link designSheetRef} 同款：路径优先、名字兜底）；
 *   · {@link PendingEntry.path} / {@link PendingEntry.name} = **认亲的两个键**（见 {@link diffDesignSheet}）。
 */
interface PendingEntry {
  /** 指代（列进 `design_only` 的那个字符串） */
  ref: string;
  /** 路径位：`description`（本仓把仓库相对路径放此处：`overlay.nodePath` —— `domain/overlay.ts:365-370`） */
  path: string;
  /** 名字位：goal 的 `title` / node 的 `label`（缺则 `title`）—— 对齐"名字兜底" */
  name: string;
}

const trimStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 取 `meta.goals`（本仓**已声明**的无类型袋子里的既有住处；非数组 ⇒ 空） */
function goalsOf(dsl: DesignDSL | null | undefined): Array<Record<string, unknown>> {
  const goals = (dsl as unknown as { meta?: { goals?: unknown } } | null | undefined)?.meta?.goals;
  if (!Array.isArray(goals)) return [];
  return goals.filter((g): g is Record<string, unknown> => !!g && typeof g === 'object');
}

/** 设计侧**无 id** 的条目：住 `meta.goals` 的那一组（`title` 名字 / `description` 细节） */
function goalPendingEntries(dsl: DesignDSL | null | undefined): PendingEntry[] {
  const out: PendingEntry[] = [];
  for (const o of goalsOf(dsl)) {
    if (trimStr(o.id)) continue; // ★ 有 id ⇒ 指的是"已实现的对象"，不是"要实现"
    const desc = trimStr(o.description);
    const title = trimStr(o.title);
    out.push({ ref: desc || title || '<无名占位:goal>', path: desc, name: title });
  }
  return out;
}

/** 设计侧**无 id** 的条目：住在 `nodes[]` 里但**没有 id** 的节点（正常过不了 `validateDSL`；纯函数仍自洽） */
function nodePendingEntries(dsl: DesignDSL | null | undefined): PendingEntry[] {
  const out: PendingEntry[] = [];
  for (const n of nodesOf(dsl)) {
    if (trimStr(n.id)) continue;
    out.push({ ref: designSheetRef(n), path: trimStr(n.description), name: trimStr(n.label) || trimStr(n.title) });
  }
  return out;
}

/** 设计侧**全部**"无 id"条目（两组之并）—— 第四类**认亲**的输入 */
function pendingEntries(dsl: DesignDSL | null | undefined): PendingEntry[] {
  return [...goalPendingEntries(dsl), ...nodePendingEntries(dsl)];
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

  // ═══ ④ 认亲（第四类）：设计侧**无 id** 的条目，靠「名字/路径」在 live 里认出**同一个东西** ═══
  //
  // ## ★ 照 `overlay.reconcileOverlay` 的既有口径办（不是新造）
  //   · **键**：路径优先、认不到再换键 —— `overlay.ts:439` 先按 `path` 认亲（`byPath.get(a.path)`）、
  //     `:442-444` 路径漂移时再按 `signature` 认亲（`bySig.get(a.signature)?.[0]`）；
  //   · **认不到怎么办**：不冒充命中 —— `overlay.ts:447-451` 认不到 ⇒ 标 `orphaned`（**不静默丢**）。
  //     本类**同款**：认不到 ⇒ **仍留在 `design_only`（要实现）**，**绝不**把认不出的一律当已实现。
  //   · live 侧的"路径"用**同一把** `nodePath`（`overlay.ts:365-370`）算，保证两边同口径。
  //
  // ## 键（开发者已拍，不许自行改）
  //   · **路径**：设计侧条目的 `description` ↔ live 节点的 `nodePath(n)`（file ⇒ `description`=rel path）；
  //   · **名字兜底**：设计侧条目的 `title`/`label` ↔ live 节点的 `label` / `title`。
  const entries = pendingEntries(design);
  const lByPath = new Map<string, Node>();
  const lByName = new Map<string, Node>();
  for (const n of lNodes) {
    const p = nodePath(n).trim();
    if (p && !lByPath.has(p)) lByPath.set(p, n);
    for (const raw of [n.label, n.title]) {
      const t = trimStr(raw);
      if (t && !lByName.has(t)) lByName.set(t, n);
    }
  }
  const resolved: ResolvedDiff[] = [];
  const resolvedRefs = new Set<string>();
  for (const e of entries) {
    if (resolvedRefs.has(e.ref)) continue; // 同名指代只认一次（首个命中为准）
    if (lById.has(e.ref)) continue; // 指代本身就是 live 的 id ⇒ 归 `same_id`，不重复认亲
    let hit = e.path ? lByPath.get(e.path) : undefined;
    let matched_by: ResolvedDiff['matched_by'] = 'path';
    if (!hit && e.name) {
      hit = lByName.get(e.name); // ★ 名字兜底（对齐 overlay 的"路径认不到再换键"）
      matched_by = 'name';
    }
    if (hit) {
      resolved.push({ ref: e.ref, id: hit.id, matched_by }); // ★ 「赋予同一个 ID」
      resolvedRefs.add(e.ref);
    }
  }
  resolved.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  // ★ 「只在设计里」列的是**设计侧的指代**：`nodes[]` 里已实现的对象 = id；
  //   **未实现的条目 = 名字/路径**（★ 它**不住 `nodes[]`**，住 `meta.goals` —— 见 {@link designSheetPendingRefs}）
  //   ★★ 第四类（`resolvedRefs`）**已认亲 ⇒ 不再计入**（这就是"要实现"自己收口：做好了它就不再挂着）
  const designRefs = new Set<string>([...dByRef.keys(), ...entries.map((e) => e.ref)]);
  const design_only = [...designRefs].filter((ref) => !lById.has(ref) && !resolvedRefs.has(ref)).sort();
  const live_only = [...lById.keys()].filter((id) => !designRefs.has(id)).sort();

  return {
    same_id,
    design_only,
    live_only,
    resolved,
    counts: { design: dNodes.length, live: lNodes.length, same_identical: sameIdentical },
  };
}

/** 四类差异的**一行摘要**（渲染用；判据不在此处） */
export function diffDesignSheetLine(d: DesignSheetDiff): string {
  const attrs = d.same_id.reduce((n, s) => n + s.attrs.length, 0);
  return (
    `设计图 ${d.counts.design} 节点 · live ${d.counts.live} 节点 ⇒ ` +
    `同名属性差 ${d.same_id.length} 个节点/${attrs} 个属性 · ` +
    `只在设计里（要实现）${d.design_only.length} · 只在 live 里（未纳入设计）${d.live_only.length} · ` +
    `已认亲（赋予同一个 ID）${d.resolved.length}`
  );
}
