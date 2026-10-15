/**
 * 节点操作：add_node / update_node / delete_node
 */

import type { DesignDSL, Node, NodeStyle, NodeContent, DiagramStatus, NodeLayer, NodeShapes, NodeDecision, DecisionHistoryEntry, DecisionAuthor, AnimationValueSchema } from '../../../domain/types.js';
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
  const { feature, node_id, label, x, y, width, height, bg, color, border, borderRadius, shape, shadow, opacity, type, description, status, swimlane, content, sub_dsl, layer, host, shapes, attributes, decision, agent } = input;

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
    type,
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
  if (type) lines.push(`类型: ${type}`);
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
  opts?: { author?: DecisionAuthor; agent?: string; note?: string; now?: string },
): { decision: NodeDecision | undefined; decision_history: DecisionHistoryEntry[] | undefined } {
  // 未传 decision 字段：不改
  if (next === undefined) return { decision: prevDecision, decision_history: history };
  // null ⇒ 清除
  if (next === null) return { decision: undefined, decision_history: undefined };

  const now = opts?.now ?? new Date().toISOString();
  // ★★ 2026-10-09（T74）：`expectations` 是**会被程序判**的字段 ⇒ 写进来时必须**响亮拒绝**坏形状，
  //   不许"存进去了但判定器读不懂"（那会变成一条永远不判的假验收）。
  if (next.expectations !== undefined) assertValidExpectations(next.expectations);
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
  const { feature, node_id, label, x, y, width, height, bg, color, border, borderRadius, shape, shadow, opacity, type, description, status, swimlane, content, sub_dsl, layer, host, shapes, attributes, decision, decision_note, author, agent } = input;

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
