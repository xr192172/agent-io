/**
 * 节点操作：add_node / update_node / delete_node
 */

import type { DesignDSL, Node, NodeStyle, NodeContent, DiagramStatus, NodeLayer, NodeShapes, NodeDecision, DecisionHistoryEntry, DecisionAuthor, AnimationValueSchema } from '../../../domain/types.js';
// ★★★ 2026-10-20（`docs/certs-4-ways.md` 裁决 ③）：写闸的豁免判据 = `Node.gate`。
//   取值域与缺省口径的**唯一住处**是 `domain/geometry.ts#NODE_GATES`；本文件只做**写端校验**
//   （写进来的值必须在那两个里 —— 与 `path` 的 `normalizeNodePath` 同一个道理：入口自己把关）。
import { NODE_GATES, type NodeGate } from '../../../domain/geometry.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { EditResult } from './edit_result.js';
// ★★ 2026-10-09（T74）：`expectations` 会被程序判 ⇒ 写进来时校验（坏形状响亮拒绝）
import { assertValidExpectations } from '../../../domain/expectation.js';
// ★★★ T329（2026-10-15）：决策卡的 `scope`（这条决策管哪一片）—— 文法与解析的**唯一落点**是 `domain/scope.ts`
//   ⇒ 写进来时**必须走它**校验（不在这里另写一把尺）。见 `applyDecisionWrite`。
import { parseScope, formatScope } from '../../../domain/scope.js';
// ★★★ T328（2026-10-15，进度轴收归）：进度的**唯一权威写入**是 `overlay` 锚点的 `progress`
//   （+ evidence 闸）。node 的 add/update 只是**入口** ⇒ 一律路由到 `updateStatus`，**不再裸写** base 的 `Node.status`。
import { updateStatus } from './status_tools.js';
// ★★★ 2026-10-20：卡上的判据 vs decision 的判据 —— **同一把尺**（`publish` 用的也是它，见 `task_ops.ts#sameCriteria`）。
import { sameCriteria } from './task_ops.js';
import { taskLevel, type TaskSpec } from '../../../domain/task_schema.js';

/** 形状卡轻校验：type 枚举 + properties/items 递归（防止渲染垃圾） */
function assertValidSchema(s: AnimationValueSchema, path: string): void {
  const validTypes = ['object', 'array', 'string', 'number', 'boolean', 'integer', 'null'];
  if (!s || typeof s !== 'object' || !validTypes.includes(s.type)) {
    throw new Error(`${path}.type 必须是 ${validTypes.join('/')} 之一`);
  }
  if (s.properties) {
    for (const [k, v] of Object.entries(s.properties)) {
      assertValidSchema(v, `${path}.properties.${k}`);
    }
  }
  if (s.items) assertValidSchema(s.items, `${path}.items`);
}

function assertValidShapes(shapes: NodeShapes): void {
  if (shapes.in) assertValidSchema(shapes.in, 'shapes.in');
  if (shapes.out) assertValidSchema(shapes.out, 'shapes.out');
}

// ─────────────────────────────────────────────────────────────
// ★★★ `path` 型节点（2026-10-17 · 闸原则 §三「每个环节独立的入口」= `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.independent_entries`）
// ─────────────────────────────────────────────────────────────

/**
 * ★ **`path` 型节点允许的 `type`（kind）—— 唯一值域**。
 *
 * 依据不是我的偏好，而是**锚点模型**（`domain/overlay.ts#AnchorCandidate.kind`：
 * `file | dir | brick | symbol | doc`）：只有这几类节点"指一个仓库路径"才**有意义**；
 * 其余类型（`service` / `database` / 人话概念节点）本来就不对应某个文件。
 * ★ 收窄的代价如实写：想让 `service` 节点也指路径 ⇒ 用 `file`/`module`，别开第二套 kind。
 */
export const PATH_NODE_KINDS = ['file', 'doc', 'module', 'symbol'] as const;
export type PathNodeKind = (typeof PATH_NODE_KINDS)[number];

/**
 * ★ **造节点入口自己的校验**（闸原则 §三：入口要有校验，不能乱造 —— 判据典 = `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.gate_principle.independent_entries`）。
 *
 * 三条，都是"会损坏数据/造成不一致"的那一类（⇒ 必须**阻断**，不是提醒）：
 *   ① `path` 非空 —— 空路径 = 一个指不到任何文件的"文件指针"（`byPath` 会拿空串认亲 ⇒ 串味）；
 *   ② 必须是**仓库相对路径** —— 绝对路径（`C:/…` / `/…`）越出 `source_root`，闸和设计单都按相对路径比；
 *      含 `..` 段 = 越界（同上）；
 *   ③ `type`（kind）必须在 {@link PATH_NODE_KINDS} 里 —— 否则"这个节点指哪个文件"在锚点模型里无解。
 *
 * ★ 分隔符统一成 `/`（Windows 上 `byPath` 两侧各自 `split(sep).join('/')`，这里先归一，少一处换算）。
 */
function normalizeNodePath(raw: unknown, kind: unknown): string {
  if (typeof raw !== 'string') {
    throw new Error(`path 必须是字符串（仓库相对路径），收到 ${JSON.stringify(raw)}。`);
  }
  const p = raw.trim();
  if (!p) {
    throw new Error(
      'path 不能为空 —— `path` 是**显式文件指针**（仓库相对路径）；空串会让"这个节点指哪个文件"变成一句空话。' +
        '★ 若这个节点本来就不指文件（概念/聚合节点）⇒ 别给 `path`。',
    );
  }
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\')) {
    throw new Error(
      `path 必须是**仓库相对路径**（如 "src/domain/overlay.ts"），收到绝对路径 ${JSON.stringify(p)} —— ` +
        '绝对路径越出 `source_root`，写闸与设计单都按相对路径认亲，会静默对不上。',
    );
  }
  if (p.split(/[\\/]+/).some((seg) => seg === '..')) {
    throw new Error(`path 不许含 ".."（越出仓库根）：${JSON.stringify(p)}。`);
  }
  const kindStr = kind === undefined || kind === null ? 'file' : String(kind);
  if (!(PATH_NODE_KINDS as readonly string[]).includes(kindStr)) {
    throw new Error(
      `path 型节点的 kind 非法：type=${JSON.stringify(kind)} ⇒ 只能取 ${PATH_NODE_KINDS.join(' / ')} ` +
        '（依据 = 锚点模型的 kind：file | dir | brick | symbol | doc；其余类型不对应具体文件）。' +
        '★ 不给 type 时按 file 处理。',
    );
  }
  return p.split(/[\\/]+/).join('/');
}

/**
 * ★★★ **写端校验**（2026-10-20 · `docs/certs-4-ways.md` 裁决 ③）：`gate` 只认两个值。
 *
 * ★ 为什么在入口就把错值抛掉（而不是存进去让闸去容错）：闸读不懂的值只能按 `gated` 处理，
 *   于是“我写了 `exempt `（带空格）/`Exempt`”与“我什么都没写”在闸眼里长得一模一样——
 *   那就是「同一事实两个意思」，而且错的那一边（以为豁免了）**永不报错**。
 * ★ 不给值（`undefined`）**不是错**：缺省 = 不写这个键 = 按 `gated` 处理（`Node.gate` 注释）。
 */
function normalizeGate(raw: unknown): NodeGate {
  const s = String(raw);
  if (!(NODE_GATES as readonly string[]).includes(s)) {
    throw new Error(
      `gate 非法：${JSON.stringify(raw)} ⇒ 只能取 ${NODE_GATES.join(' / ')}。` +
        '（★ 不写这个键 = 按 gated 处理（受闸）；★ 要豁免必须**显式**写 `exempt`。）',
    );
  }
  return s as NodeGate;
}


// ─────────────────────────────────────────────────────────────
// add_node：添加节点
// ─────────────────────────────────────────────────────────────

export interface AddNodeInput {
  feature: string;
  node_id: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bg?: string;
  color?: string;
  border?: string;
  borderRadius?: number;
  shape?: 'rect' | 'rounded' | 'circle' | 'diamond' | 'freeform';
  shadow?: string;
  opacity?: number;
  type?: string;
  /** ★ 显式文件指针（仓库相对路径）—— 见 `Node.path`；给了就按 `PATH_NODE_KINDS` 校验 kind */
  path?: string;
  /** ★ 写闸豁免声明（`'gated' | 'exempt'`；**缺省 = gated**）—— 见 `Node.gate` / `NODE_GATES` */
  gate?: NodeGate;
  description?: string;
  status?: DiagramStatus;
  swimlane?: string;
  content?: NodeContent;
  sub_dsl?: DesignDSL;
  layer?: NodeLayer;
  host?: string;
  shapes?: NodeShapes;
  /** 决策卡·参数表：类型化 key-value（如 budget_mb: 64） */
  attributes?: Record<string, string | number | boolean>;
  /** 决策卡·决策记录：结论/理由/替代方案/后果/验收 */
  decision?: NodeDecision;
  /**
   * ★ 决策**发起人身份**（可追溯轴，同 {@link UpdateNodeInput.agent}）：随 `decision` 一起**注入**决策卡
   *   （`NodeDecision.agent`）并打 `updated_at`。由调用方给（`edit_dsl` 顶层入参 `agent`），工具不生成；
   *   缺省 ⇒ 落库标「未署名」。★ 与 `node.update` 的 decision 路径**同款**：同一个 `decision` 字段，
   *   add / update 两条路对身份的处理必须一致（否则顶层身份在 add 路被静默丢弃）。
   */
  agent?: string;
}

export function addNode(input: AddNodeInput): EditResult {
  const { feature, node_id, label, x, y, width, height, bg, color, border, borderRadius, shape, shadow, opacity, type, path: nodePathInput, gate: gateInput, description, status, swimlane, content, sub_dsl, layer, host, shapes, attributes, decision, agent } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    // ★★★ T192（2026-10-12）：**原先这里写的是 `create_feature` —— 而那个工具不存在**
    //   （68 个工具里没有；`create_feature` 只是内部函数名）⇒ ★ **新建项目的第一笔就撞墙**：
    //   读者照着去调，拿到的是"工具不存在"，**看不出是文案写错了**（T188/L5 那一族的整面）。
    //   ⇒ 现在指向**真入口**，并**说明那个旧名不是工具**（免得下一个人又去找它）。
    throw new Error(
      // ★★ 形状务必对：`manage_feature` 是 **12/14 那一派** —— `action` 在**顶层**，
      //   ★ 不是 `{args:{action}}` 那种嵌套（只有 `manage_feature` 自己与 `explore_code` 是嵌套，★ 少数派）。
      `feature "${feature}" 不存在 —— 先建一个：\`manage_feature\`（**顶层** \`action:"create"\` + \`feature:"${feature}"\`）。` +
        '★ 注意：**没有** `create_feature` 这个工具（它只是内部函数名）。',
    );
  }

  if (dsl.geometry.nodes.find(n => n.id === node_id)) {
    throw new Error(
      `节点 "${node_id}" 已存在 —— 要改它请用 \`edit_dsl\`：` +
        `\`operations:[{type:"node", op:"update", node_id:"${node_id}", …}]\`。` +
        '★ 注意：**没有** `update_node` 这个工具。',
    );
  }
  if (host && !dsl.geometry.nodes.find(n => n.id === host)) {
    throw new Error(`host 节点 "${host}" 不存在`);
  }
  // ★★★ `path` 型节点（2026-10-17）：**造节点这个入口自己校验**（id 唯一已由上面那条判过）。
  //   · path 非空 / 仓库相对 / 无 `..`（`normalizeNodePath`）；
  //   · kind（`type`）必须在 `PATH_NODE_KINDS` 里；不给 type ⇒ 按 `file`（文件指针的默认 kind）。
  const nodePathValue = nodePathInput === undefined ? undefined : normalizeNodePath(nodePathInput, type);
  // ★★ 豁免声明：与 `path` 同一把尺（入口校验）；缺省不写这个键 ⇒ 闸按 `gated` 处理。
  const gateValue = gateInput === undefined ? undefined : normalizeGate(gateInput);
  const nodeType = type ?? (nodePathValue ? 'file' : undefined);
  if (shapes) assertValidShapes(shapes);
  // ★★ 2026-10-09（T74）：与 update 路径同一个校验（`expectations` 是会被程序判的字段）
  if (decision?.expectations !== undefined) assertValidExpectations(decision.expectations);
  // ★★ 决策身份注入（与 `node.update` 同款，走同一个纯函数）：顶层 `agent` 落进决策卡（+ `updated_at`），
  //   不再静默丢弃。（首版无旧版可压栈 ⇒ 不产生 history，与 update 的版本演进一致。）
  const nodeDecision = decision === undefined ? undefined : applyDecisionWrite(undefined, undefined, decision, { agent }).decision;

  const style: NodeStyle = {};
  if (bg) style.bg = bg;
  if (color) style.color = color;
  if (border) style.border = border;
  if (borderRadius !== undefined) style.borderRadius = borderRadius;
  if (shape) style.shape = shape;
  if (shadow) style.shadow = shadow;
  if (opacity !== undefined) style.opacity = opacity;

  const node: Node = {
    id: node_id,
    label: label || node_id,
    x,
    y,
    width,
    height,
    style: Object.keys(style).length > 0 ? style : undefined,
    type: nodeType,
    path: nodePathValue,
    gate: gateValue,
    description,
    // ★★★ T328：**不再把 `status` 落进 base**（旧轴直写）。进度改走权威（下面的 `updateStatus`）——
    //   它同时也是 evidence 闸的入口：不带证据置 `done` ⇒ 当场拒（"不许默默勾上"）。
    swimlane,
    content,
    sub_dsl,
    layer,
    host,
    shapes,
    attributes,
    decision: nodeDecision,
  };

  dsl.geometry.nodes.push(node);
  saveDSL(dsl);

  // ★★★ T328：进度走权威（`overlay.progress` + 闸 + 投影回 base）；节点已落盘 ⇒ `updateStatus` 能查到它。
  if (status !== undefined) updateStatus({ feature, node_id, status });

  const lines = [
    // ★ 首行是 `updateFeatureCore` **唯一透出**的那行 ⇒ 内联决策卡的「署名/未署名」必须进首行，否则静默。
    nodeDecision
      ? `已添加节点: ${node_id} · 决策卡 ${nodeDecision.summary}` +
        // ★ T329：范围（若有）显形 —— 它是**规范化后**存的，读端要知道这条管哪一片。
        (nodeDecision.scope ? ` · 范围 ${nodeDecision.scope}` : '') +
        ` · ${nodeDecision.agent ? `署名 ${nodeDecision.agent}` : '★ 未署名（本次调用未传 agent 身份 ⇒ 无发起者编号）'}`
      : `已添加节点: ${node_id}`,
    `标签: ${node.label}`,
    `位置: (${node.x ?? 'auto'}, ${node.y ?? 'auto'})`,
    `尺寸: ${node.width ?? 'auto'} × ${node.height ?? 'auto'}`,
  ];
  if (nodeType) lines.push(`类型: ${nodeType}`);
  // ★ 造了一个 `path` 型节点 ⇒ 回执里**显形**（这是它能被写闸 / 任务机认亲的依据）
  if (nodePathValue) lines.push(`路径: ${nodePathValue}（显式文件指针，写闸与任务机按它认亲）`);
  if (status) lines.push(`状态: ${status}`);
  if (shape) lines.push(`形状: ${shape}`);
  if (swimlane) lines.push(`泳道: ${swimlane}`);
  if (layer && layer !== 'main') lines.push(`分层: ${layer}${host ? ` (宿主: ${host})` : ''}`);
  lines.push(`当前节点数: ${dsl.geometry.nodes.length}`);

  return { message: lines.join('\n'), feature };
}

// ─────────────────────────────────────────────────────────────
// update_node：更新节点
// ─────────────────────────────────────────────────────────────

export interface UpdateNodeInput {
  feature: string;
  node_id: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bg?: string;
  color?: string;
  border?: string;
  borderRadius?: number;
  shape?: 'rect' | 'rounded' | 'circle' | 'diamond' | 'freeform';
  shadow?: string;
  opacity?: number;
  type?: string;
  /** ★ 显式文件指针；`null` = 清除该字段（该节点不再指向具体文件） */
  path?: string | null;
  /** ★ 写闸豁免声明；`null` = 清除（回到缺省 = 受闸）。见 `Node.gate` / `NODE_GATES` */
  gate?: NodeGate | null;
  description?: string;
  status?: DiagramStatus;
  swimlane?: string;
  content?: NodeContent;
  sub_dsl?: DesignDSL;
  layer?: NodeLayer | null;
  host?: string | null;
  shapes?: NodeShapes | null;
  /** 决策卡·参数表：类型化 key-value；null 清除 */
  attributes?: Record<string, string | number | boolean> | null;
  /** 决策卡·决策记录；null 清除。update 时旧版自动压入 decision_history */
  decision?: NodeDecision | null;
  /** 决策修订说明：随本次 decision 更新记入版本栈（翻案理由/变更点） */
  decision_note?: string;
  /** 决策**作者类别**（可信度轴）：`'human' | 'llm'`。缺省不伪造、不主动写。★ 身份（谁）请用 `agent` */
  author?: DecisionAuthor;
  /** 决策**发起人身份**（可追溯轴）：Agent 的编号/名字。由调用方给，工具不生成；缺省 ⇒ 落库标「未署名」 */
  agent?: string;
}

/**
 * ★★★ 决策卡**子字段形状**的唯一判据（2026-10-18）——
 * `summary` / `acceptance` = **字符串**，`expectations` = **数组**；形状不对 ⇒ **抛**。
 *
 * ## 为什么判在这里
 * `applyDecisionWrite` 是决策的**唯一写入口**（`node.add` / `node.update` / `edit_dsl {type:'decision'}`
 * 三条路都从它出去）⇒ 判一处，三条路一起挡。
 * ★ 实测（补之前）：`data.decision.summary = 123`、`acceptance = ["x"]` **都被静默落库** ——
 *   存进去的是"类型不对的决策卡"，读端（渲染 / 对拍 / 任务机）拿到数字或数组，
 *   全程**没有任何一处报错**（§2.3「不报错的错」）。`expectations` 早有 `assertValidExpectations` 守，
 *   另两个**一直没有守**。
 */
function assertDecisionFieldShapes(next: NodeDecision): void {
  const raw: unknown = next;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `决策卡必须是**对象**（{summary, acceptance?, expectations?…}），收到 ${Array.isArray(raw) ? '数组' : typeof raw}。`,
    );
  }
  for (const k of ['summary', 'acceptance'] as const) {
    const v: unknown = next[k];
    if (v !== undefined && typeof v !== 'string') {
      throw new Error(
        `决策卡 \`${k}\` 必须是**字符串**，收到 ${Array.isArray(v) ? '数组' : typeof v}：${JSON.stringify(v)}。` +
          `★ 要清空它 ⇒ 给空串 ""（合并语义：不给=保留，给空=清空）。`,
      );
    }
  }
  // ★★ 2026-10-09（T74）：`expectations` 是**会被程序判**的字段 ⇒ 写进来时必须**响亮拒绝**坏形状，
  //   不许"存进去了但判定器读不懂"（那会变成一条永远不判的假验收）。唯一尺 = `assertValidExpectations`。
  if (next.expectations !== undefined) assertValidExpectations(next.expectations);
}

/**
 * ★★★ 2026-10-20：**卡上的判据不许被 decision 静默换掉**（「做的是 A、验收的是 B」）。
 *
 * ## 病（实测）
 * `complete` 的验收判据是**卡上那份**（`task_ops.ts#completeTask` 读 `card.expectations`），
 * 而 decision 是**另一份**（只有 `publish` 才会搬上卡）⇒ 卡已 claimed/done 时直接改 decision：
 * 卡上挂旧判据、decision 已是新的，**全程无报错**（§2.3「不报错的错」）。
 *
 * ## 判据（复用 `task_ops.ts#sameCriteria`，与 `publish` 同一把尺）
 * · 相同 ⇒ **放行**（改 `rationale` / `consequences` / `status` 这些**不进验收**的字段是合法的）；
 * · 不同 ⇒ **拒**，并点名正路：`reopen` → 改 decision → `publish{reason}`。
 *
 * ## ★ 为什么只判 **L2 卡**
 * L1 建构卡的验收判据**就是当下的 decision**（`completeTask` 的 L1 尺走 `constructionVerdict`，读 decision 而非卡）
 * ⇒ 它没有「两份判据」可漂移；拦它反而会堵死 L1 唯一的收口路
 * （claimed 时补 `decision.summary` + 一条 phase=post 判据 —— 这正是 `claimTask` / `completeTask` 回执点名的下一步）。
 *
 * ## ★ 为什么 `reopened_at` 非空时放行
 * `reopen` 的语义就是「这张卡要**换判据**重做」—— 它只把 done ⇒ claimed，**不动判据**，
 * 判据的落点被指定为随后的 `publish{reason}`（唯一原子换判据处，见 `task_ops.ts#publishTask`）。
 * ⇒ 账本开着时改 decision 是**正路的第 2 步**；拦它等于把 `reopen → 改 decision → publish` 这条路堵死。
 * ★ 这段窗口并不「静默」：账本没结清时 `complete` 由 `reopenGate` 挡（判据没换 ⇒ 只算把旧判据再跑一遍）。
 */
function assertCardCriteriaUnchanged(card: TaskSpec | undefined, summary: string, expectations: readonly unknown[]): void {
  if (!card || (card.state !== 'claimed' && card.state !== 'done')) return;
  if (taskLevel(card) !== 'L2') return;
  // ★ 账本开着（reopen 之后）⇒ 改判据是**正路的第 2 步**，publish 才是那道原子换判据的闸。
  if (card.reopened_at) return;
  if (sameCriteria(card, summary, expectations)) return;
  throw new Error(
    `decision 被拒：该节点上的任务卡 state=${card.state}，而这次要写的 (summary, expectations) 与卡上的判据不同 —— ` +
      `complete 的验收判据是卡上那份（task_ops.ts#completeTask）⇒ 直接改 decision 只会让「做的是 A、验收的是 B」。\n` +
      `★ 卡上：summary=「${card.summary}」/ ${card.expectations?.length ?? 0} 条期望；` +
      `本次：summary=「${summary}」/ ${expectations.length} 条期望。\n` +
      `★ 正路（判据不能静默换）：reopen（done ⇒ claimed）→ 改 decision → publish（带 data.reason）` +
      `—— publish 会原子地把判据换上去并结清重开账。\n` +
      `★ 只改 rationale / consequences / status 等不进验收的字段 ⇒ 不受此闸（summary + expectations 没变，照常落盘）。`,
  );
}

/**
 * 决策写入纯函数（缺口①：作者/时间线）。
 * decision 更新=版本演进：旧版自动压入 decision_history（`at` 时间戳 + 修订 note + 发起人 author/agent），
 * 新版成为当前生效版，并打 `updated_at`（author/agent 若有则一并打上）。首版（无旧版）不压栈。
 * return 直接可写回 node.decision / node.decision_history。
 *
 * ★★ 2026-10-10 拆两个正交维度（见 `NodeDecision.author` / `.agent` 注释）：
 *   · `author` = **类别**（`'human' | 'llm'`，可信度）；· `agent` = **身份**（`string`，谁）。
 *   ★ 两者**可并存**；**缺省不伪造**（不传就不写）—— 写入口的"未署名"由调用方回执负责出声。
 */
export function applyDecisionWrite(
  prevDecision: NodeDecision | undefined,
  history: DecisionHistoryEntry[] | undefined,
  next: NodeDecision | null | undefined,
  opts?: { author?: DecisionAuthor; agent?: string; note?: string; now?: string; card?: TaskSpec },
): { decision: NodeDecision | undefined; decision_history: DecisionHistoryEntry[] | undefined } {
  // 未传 decision 字段：不改
  if (next === undefined) return { decision: prevDecision, decision_history: history };
  // null ⇒ 清除（★ 已领/已完成卡的判据**不许**这样被抹掉 —— 同下面那一道闸，见 `assertCardCriteriaUnchanged`）
  if (next === null) {
    assertCardCriteriaUnchanged(opts?.card, '', []);
    return { decision: undefined, decision_history: undefined };
  }

  const now = opts?.now ?? new Date().toISOString();
  // ★★★ 2026-10-18：决策卡**子字段形状**先判（唯一判据见 `assertDecisionFieldShapes`）——
  //   非法形状 ⇒ 抛；**不许**静默落一个"读端读不懂"的决策卡。
  assertDecisionFieldShapes(next);
  // 新决策：时间戳恒打；author（类别）/ agent（身份）**传入才打**（不伪造）
  //
  // ★★★ T255（2026-10-14）：**这里从【覆盖】改成【合并】。**
  //   · 旧写法 `{ ...next }` = **用你给的字段整体替换** ⇒ 只给 `summary` 会把
  //     `rationale` / `thread` / `evidence_source` / `author` **静默清空**（实测：
  //     `contract_arc_7` 从 8 个字段掉到 4 个，**无报错无告警**，旧版进了 history）。
  //   · 而契约只写「`decision: update`（需 id；`data.summary`）」⇒ 读的人自然以为
  //     "给什么改什么"（合并）⇒ **契约与实现落差 + 静默**（T174 同族，但更隐蔽：
  //     那一格是"形状错时静默丢"，**这一格是"形状合法也静默丢"**）。
  //   · 现改为 **`...prevDecision` 打底** ⇒ **未给的字段保留**。
  //     ★ 要**清空**某字段 ⇒ 显式给空串（合并语义下"不给"= 保留，"给空"= 清空）。
  //   · ★ `summary` 是 `NodeDecision` 里**唯一必填**（`geometry.ts:172`）⇒ 合并后仍为空则**响亮抛**，
  //     不再落一个没有结论的决策卡。
  const decision: NodeDecision = { ...prevDecision, ...next, updated_at: now };
  if (!decision.summary || !String(decision.summary).trim()) {
    throw new Error(
      '决策卡缺 `summary`（结论）—— 它是 NodeDecision 里**唯一必填**字段（geometry.ts:172）。' +
        '★ 只改别的字段时**不必重给** `summary`（合并语义会保留旧值）；★ 若是首版，`summary` 必须给。',
    );
  }
  // ★★★ 2026-10-20：**卡已 claimed/done（L2）⇒ 判据不许静默换**（唯一判据见 `assertCardCriteriaUnchanged`）。
  //   ★ 判的是**合并后**的 decision（`{...prevDecision, ...next}`）—— 只给 `rationale` 时 summary/expectations 仍取旧值，
  //     与卡上逐字相同 ⇒ 照常落盘；只有真换了判据才拒。
  assertCardCriteriaUnchanged(opts?.card, decision.summary, decision.expectations ?? []);
  // ★★★ T329（2026-10-15）：`scope`（这条决策管哪一片）—— 给了就**走唯一解析落点**校验。
  //   ★ 唯一落点 = `domain/scope.ts` 的 `parseScope`（文法与解析只有那一处；这里**不另写一把尺**）。
  //   ★ 非法 ⇒ **响亮抛**（`parseScope` 的报错已含"缺参数 / 未知种类"与文法指引），**不静默、不自动丢弃**。
  //   ★ 落库的是 `formatScope(parseScope(s))` —— **同一片写同一个规范名**（scope.ts 纪律 #1：路径归一、
  //     列表排序去重）⇒ 同一片不会因写法不同存成两个名字。★ **只存字符串**（绝不把节点集落库）。
  //   ★ 显式空串 / 全空白 = **清除该字段**（与 decision 其余字段的"给空=清空"合并语义同款）；
  //     要表达"整份 DSL"请显式写 `scope:"all"`（`parseScope('')` 本身也读作 all，此处按合并纪律处理）。
  if (next.scope !== undefined) {
    if (typeof next.scope !== 'string') {
      throw new Error(
        `决策卡 scope 必须是字符串（一行 scope 表达式），收到 ${JSON.stringify(next.scope)}。文法见 src/domain/scope.ts。`,
      );
    }
    if (next.scope.trim() === '') {
      delete decision.scope;
    } else {
      decision.scope = formatScope(parseScope(next.scope));
    }
  }
  if (opts?.author) decision.author = opts.author;
  if (opts?.agent) decision.agent = opts.agent;

  // 旧版存在 → 压栈（首版不压）
  let decision_history = history;
  if (prevDecision) {
    const entry: DecisionHistoryEntry = { at: now, decision: prevDecision, note: opts?.note };
    if (opts?.author) entry.author = opts.author;
    if (opts?.agent) entry.agent = opts.agent;
    decision_history = [...(history ?? []), entry];
  }
  return { decision, decision_history };
}

export function updateNode(input: UpdateNodeInput): EditResult {
  const { feature, node_id, label, x, y, width, height, bg, color, border, borderRadius, shape, shadow, opacity, type, path: nodePathInput, gate: gateInput, description, status, swimlane, content, sub_dsl, layer, host, shapes, attributes, decision, decision_note, author, agent } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  const node = dsl.geometry.nodes.find(n => n.id === node_id);
  if (!node) {
    throw new Error(`节点 "${node_id}" 不存在`);
  }

  if (label !== undefined) node.label = label;
  if (x !== undefined) node.x = x;
  if (y !== undefined) node.y = y;
  if (width !== undefined) node.width = width;
  if (height !== undefined) node.height = height;
  if (type !== undefined) node.type = type;
  // ★ `path`：`null` = 清除；给了字符串 ⇒ 与造节点**同一把尺**（非空 / 相对 / kind 合法）。
  //   ★ kind 判定用"本次给的 type，否则节点现有的 type"—— 否则"先建 file 节点、再补 path"会被误判。
  if (nodePathInput === undefined) {
    // 不改
  } else if (nodePathInput === null) {
    delete node.path;
  } else {
    node.path = normalizeNodePath(nodePathInput, type ?? node.type);
  }
  // ★ `gate`（写闸豁免声明）：`null` = 清除（回到缺省 = 受闸）；给了值 ⇒ 与造节点**同一把尺**。
  if (gateInput === undefined) {
    // 不改
  } else if (gateInput === null) {
    delete node.gate;
  } else {
    node.gate = normalizeGate(gateInput);
  }
  if (description !== undefined) node.description = description;
  // ★★★ T328：进度**不在此裸写** `Node.status`（旧轴/base）—— 见下方 saveDSL 后的 `updateStatus`。
  if (swimlane !== undefined) node.swimlane = swimlane;
  if (content !== undefined) node.content = content;
  if (sub_dsl !== undefined) node.sub_dsl = sub_dsl;
  // layer/host：null 表示清除（回到 main 层）
  if (layer !== undefined) {
    if (layer === null) delete node.layer;
    else node.layer = layer;
  }
  if (host !== undefined) {
    if (host === null) delete node.host;
    else {
      if (!dsl.geometry.nodes.find(n => n.id === host)) {
        throw new Error(`host 节点 "${host}" 不存在`);
      }
      node.host = host;
    }
  }
  // shapes：null 表示清除形状卡
  if (shapes !== undefined) {
    if (shapes === null) delete node.shapes;
    else {
      assertValidShapes(shapes);
      node.shapes = shapes;
    }
  }
  // attributes/decision：null 表示清除（决策卡整体移除）；空对象/空 summary 允许渐进填写
  if (attributes !== undefined) {
    if (attributes === null) delete node.attributes;
    else node.attributes = attributes;
  }
  // decision 更新=版本演进：旧版压入 decision_history，新版成为当前生效版（author/agent/updated_at 由纯函数打）。
  if (decision !== undefined) {
    const { decision: nd, decision_history: nh } = applyDecisionWrite(node.decision, node.decision_history, decision, {
      author,
      agent,
      note: decision_note,
      // ★ 卡（`node.task`）一并传入：已 claimed/done 的卡上判据不许被 decision 静默换掉
      card: node.task,
    });
    if (nd === undefined) {
      delete node.decision;
      delete node.decision_history;
    } else {
      node.decision = nd;
      if (nh?.length) node.decision_history = nh;
    }
  }

  if (!node.style) node.style = {};
  if (bg !== undefined) node.style.bg = bg;
  if (color !== undefined) node.style.color = color;
  if (border !== undefined) node.style.border = border;
  if (borderRadius !== undefined) node.style.borderRadius = borderRadius;
  if (shape !== undefined) node.style.shape = shape;
  if (shadow !== undefined) node.style.shadow = shadow;
  if (opacity !== undefined) node.style.opacity = opacity;

  saveDSL(dsl);

  // ★★★ T328（进度轴收归）：**进度改走权威** —— 唯一权威住 `overlay` 锚点的 `progress`，
  //   base 上的 `Node.status` 只是 `applyOverlay` 的**投影**。裸写 base 会在 `rebuild_design=true`
  //   时被冲掉，且会经 `seedOverlayFromDsl` 灌进 `progress`、**绕过 evidence 闸**。
  //   ⇒ 路由到唯一写函数 `updateStatus`（它自带 evidence 闸与投影）。
  if (status !== undefined) updateStatus({ feature, node_id, status });

  const lines = [
    `已更新节点: ${node_id}`,
    `标签: ${node.label}`,
    `位置: (${node.x ?? 'auto'}, ${node.y ?? 'auto'})`,
    `尺寸: ${node.width ?? 'auto'} × ${node.height ?? 'auto'}`,
  ];
  if (status) lines.push(`状态: ${status}`);
  if (node.path) lines.push(`路径: ${node.path}（显式文件指针）`);
  // ★ T329：决策范围（若有）显形（写的是规范化后的字符串）。
  if (node.decision?.scope) lines.push(`决策范围: ${node.decision.scope}`);

  return { message: lines.join('\n'), feature };
}

// ─────────────────────────────────────────────────────────────
// delete_node：删除节点（连带相关边）
// ─────────────────────────────────────────────────────────────

export interface DeleteNodeInput {
  feature: string;
  node_id: string;
}

export function deleteNode(input: DeleteNodeInput): EditResult {
  const { feature, node_id } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  const nodeIdx = dsl.geometry.nodes.findIndex(n => n.id === node_id);
  if (nodeIdx === -1) {
    throw new Error(`节点 "${node_id}" 不存在`);
  }

  const removedNode = dsl.geometry.nodes[nodeIdx];
  dsl.geometry.nodes.splice(nodeIdx, 1);

  const removedEdges = (dsl.geometry.edges ?? []).filter(e => e.from === node_id || e.to === node_id);
  dsl.geometry.edges = (dsl.geometry.edges ?? []).filter(e => e.from !== node_id && e.to !== node_id);

  saveDSL(dsl);

  return {
    message: [
      `已删除节点: ${node_id} (${removedNode.label})`,
      `连带删除边: ${removedEdges.length} 条`,
      `当前节点数: ${dsl.geometry.nodes.length}`,
      `当前边数: ${dsl.geometry.edges.length}`,
    ].join('\n'),
    feature,
  };
}
