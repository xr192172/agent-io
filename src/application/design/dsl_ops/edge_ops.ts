/**
 * 边操作：add_edge / delete_edge
 */

import type { Edge, NodeLayer } from '../../../domain/types.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { EditResult } from './edit_result.js';

// ─────────────────────────────────────────────────────────────
// add_edge：添加边
// ─────────────────────────────────────────────────────────────

export interface AddEdgeInput {
  feature: string;
  edge_id: string;
  from: string;
  to: string;
  label?: string;
  edge_type?: 'straight' | 'curve' | 'dashed';
  // ★★★ 第⑥项验收红修（2026-11-10）：**edge_type 的运行时值域校验** —— 类型注解只在 TS 编译期约束，
  //   而调用方是 `...data` 从 JSON 透传（编译期形同虚设）⇒ 非法值（如 `'data'`——语义分类被塞进渲染字段）
  //   照样落盘 ⇒ validateDSL 的 Edge.type anyOf 拒整册（实测 14/14 全红：红 2 的根）。
  //   ★ 判据：**不在值域闭集 ⇒ 抛**（不静默剔除——静默 = 写入方的意图被无声改变，0.12 禁止）。
  arrow?: 'forward' | 'reverse' | 'both' | 'none';
  layer?: NodeLayer;
}

export function addEdge(input: AddEdgeInput): EditResult {
  const { feature, edge_id, from, to, label, edge_type, arrow, layer } = input;
  // ★ 第⑥项：运行时值域校验（写入口当场拒，防非法 type 落盘后再让整册 validateDSL 红）
  if (edge_type !== undefined && !['straight', 'curve', 'dashed'].includes(edge_type)) {
    throw new Error(
      `拒绝写入（edge type 值域）：edge_type "${edge_type}" 不在合法值域 straight|curve|dashed 内。` +
        `\n★ Edge.type 是**渲染形态**（直线/贝塞尔曲线/虚线），不是语义分类——语义归属请写 \`layer\` 或 \`intent\`，` +
        `别塞进渲染字段（实测：'data' 落盘后整册 validateDSL 拒，14/14 验收红）。`,
    );
  }

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  if (!dsl.geometry.nodes.find(n => n.id === from)) {
    throw new Error(`源节点 "${from}" 不存在`);
  }
  if (!dsl.geometry.nodes.find(n => n.id === to)) {
    throw new Error(`目标节点 "${to}" 不存在`);
  }

  if ((dsl.geometry.edges ?? []).find(e => e.id === edge_id)) {
    throw new Error(`边 "${edge_id}" 已存在`);
  }

  const edge: Edge = {
    id: edge_id,
    from,
    to,
    label,
    ...(edge_type ? { type: edge_type } : {}),
    ...(arrow ? { arrow } : {}),
    ...(layer ? { layer } : {}),
  };

  if (!dsl.geometry.edges) dsl.geometry.edges = [];
  dsl.geometry.edges.push(edge);
  saveDSL(dsl, 'mcp', dsl._dsl_rev); // ★ 第⑫项：乐观锁接回（下同）

  return {
    message: [
      `已添加边: ${edge_id}`,
      `方向: ${from} → ${to}`,
      `标签: ${label ?? '(无)'})`,
      `当前边数: ${dsl.geometry.edges.length}`,
    ].join('\n'),
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// delete_edge：删除边
// ─────────────────────────────────────────────────────────────

export interface DeleteEdgeInput {
  feature: string;
  edge_id: string;
}

export function deleteEdge(input: DeleteEdgeInput): EditResult {
  const { feature, edge_id } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  if (!dsl.geometry.edges) {
    throw new Error(`边 "${edge_id}" 不存在`);
  }

  const edgeIdx = dsl.geometry.edges.findIndex(e => e.id === edge_id);
  if (edgeIdx === -1) {
    throw new Error(`边 "${edge_id}" 不存在`);
  }

  const removedEdge = dsl.geometry.edges[edgeIdx];
  dsl.geometry.edges.splice(edgeIdx, 1);

  saveDSL(dsl, 'mcp', dsl._dsl_rev); // ★ 第⑫项

  return {
    message: [
      `已删除边: ${edge_id}`,
      `方向: ${removedEdge.from} → ${removedEdge.to}`,
      `当前边数: ${dsl.geometry.edges.length}`,
    ].join('\n'),
    feature,
  };
}
