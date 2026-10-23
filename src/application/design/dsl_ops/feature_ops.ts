/**
 * feature 级操作：create_feature / clone_feature
 */

import type { DesignDSL } from '../../../domain/types.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { EditResult } from './edit_result.js';

// ─────────────────────────────────────────────────────────────
// create_feature：创建新 feature
// ─────────────────────────────────────────────────────────────

export interface CreateFeatureInput {
  feature: string;
  title?: string;
  description?: string;
}

export function createFeature(input: CreateFeatureInput): EditResult {
  const { feature, title, description } = input;

  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }

  const existing = getDSL(feature);
  if (existing) {
    // ★ T192：原指 `update_node` / `add_node` —— ★ **两个都不是工具**（是内部函数名）
    //   ⇒ 改成指向**真入口**（`edit_dsl` 的 node 操作），★ 并说明旧名不是工具。
    throw new Error(
      `feature "${feature}" 已存在 —— 要改它请用 \`edit_dsl\`：` +
        '\`operations:[{type:"node", op:"update"|"add"|"delete"|"move", …}]\`。' +
        '★ 注意：**没有** `update_node` / `add_node` 这两个工具。',
    );
  }

  const dsl: DesignDSL = {
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: title || feature,
    // ★★★ 2026-10-15（进度轴收归，T328）：**不再落 doc 级 `status: 'draft'`**。
    //   · 它原来的角色是"新建即未开工"—— 那是**创建时的默认**，不是一条**人判的进度**；
    //   · 读侧有唯一出处：`domain/geometry.ts#resolveDiagramStatus` 对非 `imported_` 的 id 读作
    //     `'draft'` ⇒ ★ **与本行原值逐字同值**（所以这不是"改语义"，是"把默认放回读侧"）；
    //   · 真进度由 `edit_dsl` 的 `type:"status"` op 写进 overlay 锚点的 `progress`（唯一权威）。
    geometry: {
      layout: 'vertical_flow',
      width: 800,
      height: 600,
      nodes: [],
      edges: [],
    },
    semantic: {
      files: [],
      multi_file_invariants: [],
    },
  };

  const file = saveDSL(dsl);

  return {
    message: [
      `已创建 feature: ${feature}`,
      `标题: ${dsl.title}`,
      `状态: draft`,
      `文件: ${file}`,
    ].join('\n'),
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// clone_feature：克隆一个 feature 为新的 feature
// ─────────────────────────────────────────────────────────────

export interface CloneFeatureInput {
  source_feature: string;
  target_feature: string;
  title?: string;
}

export interface CloneFeatureResult {
  message: string;
  source_feature: string;
  target_feature: string;
  nodes_copied: number;
  edges_copied: number;
}

export function cloneFeature(input: CloneFeatureInput): CloneFeatureResult {
  const { source_feature, target_feature, title } = input;

  if (!/^[a-zA-Z0-9_-]+$/.test(target_feature)) {
    throw new Error(`非法 target_feature 名: "${target_feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }

  const source = getDSL(source_feature);
  if (!source) throw new Error(`source_feature "${source_feature}" 不存在`);

  const existing = getDSL(target_feature);
  if (existing) throw new Error(`target_feature "${target_feature}" 已存在`);

  const cloned: DesignDSL = JSON.parse(JSON.stringify(source));
  cloned.feature = target_feature;
  cloned.id = 'feature_' + target_feature;
  if (title) cloned.title = title;
  else if (cloned.title) cloned.title = cloned.title + ' (副本)';

  const nodeCount = cloned.geometry.nodes.length;
  const edgeCount = (cloned.geometry.edges ?? []).length;

  saveDSL(cloned);

  return {
    message: [
      `已克隆 feature: ${source_feature} → ${target_feature}`,
      `节点: ${nodeCount} 个`,
      `边: ${edgeCount} 条`,
      `标题: ${cloned.title}`,
    ].join('\n'),
    source_feature,
    target_feature,
    nodes_copied: nodeCount,
    edges_copied: edgeCount,
  };
}
