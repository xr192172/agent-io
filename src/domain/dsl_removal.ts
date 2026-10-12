/**
 * ★★★ **从一个设计 DSL 里"彻底"移除一个文件节点** —— **唯一判据**（T185，2026-10-12）。
 *
 * ## 为什么必须有它（本仓头号病的又一次现场）
 * "删掉一个文件"在 DSL 里其实是**三件事**：语义侧的 `semantic.files` · 几何侧的 `geometry.nodes` ·
 * 以及挂在那个节点上的 `geometry.edges`。
 * ★ 而此前这条判据**住两处、且两边不一样**：
 *   · `archive_node.ts`（归档工具）**三清**（它自己的注释就写着"三清"）—— 做全了；
 *   · `deleteFile`（`edit_dsl type=file op=delete`）★ **只 splice `semantic.files`**
 *     ⇒ 留下一个**幽灵几何节点**（连同它的决策卡/标注还挂在上面）。
 * ⇒ ★★ 后果不是"风格不一致"，而是**静默地半删**：`get_dsl` 仍能查到那个节点、
 *   按下标遍历几何层的东西（布局 / 导出 / 架构图）**看不出它已被删**（§2.3「不报错的错」）。
 *
 * ## 纪律
 * 1. ★ **纯函数**：不改传入的 `dsl`，返回新的（与 `overlay.ts` 的 `applyOverlay` 同族，可测、无 IO）。
 * 2. ★ **判据只许住这里** —— `archive_node` 与 `deleteFile` 都调它；
 *    将来任何"移除文件节点"的路径也一样（别再各写一份 filter）。
 * 3. ★ **如实报出动了什么**（返回 {@link FileRemoval}）—— 调用方据此报账，不许猜。
 */
import type { DesignDSL } from './types.js';
import type { SemanticFile } from './semantic.js';

/** 一次移除**实际动了什么**（★ 调用方报账用；一个字段都不许猜） */
export interface FileRemoval {
  /** 被移除的语义文件（**在语义层找不到时为 `undefined`** —— 调用方自己决定那算不算错） */
  file?: SemanticFile;
  /** 是否真的移除了一个同名几何节点 */
  node_removed: boolean;
  /** 连带移除的边数（`from`/`to` 指向该节点的） */
  edges_removed: number;
}

/**
 * 把 `fileId` 对应的文件从**三个地方**都摘掉：`semantic.files` · `geometry.nodes` · `geometry.edges`。
 * ★ 找不到也不算错（返回的 {@link FileRemoval} 会说清"什么都没动"）——
 *   **是否该报错是调用方的判断**（例：`archive` 要求文件必须在；`deleteFile` 也一样，
 *   但它俩的**错误文案**不同，所以判不判、怎么报留给调用方）。
 */
export function removeFileFromDsl(dsl: DesignDSL, fileId: string): { dsl: DesignDSL; removal: FileRemoval } {
  const file = dsl.semantic?.files.find((f) => f.id === fileId);

  // ① 语义侧
  const nextSemantic = dsl.semantic
    ? { ...dsl.semantic, files: dsl.semantic.files.filter((f) => f.id !== fileId) }
    : dsl.semantic;

  // ② 几何侧：节点 + 边
  const prevNodes = dsl.geometry?.nodes ?? [];
  const prevEdges = dsl.geometry?.edges ?? [];
  const nextNodes = prevNodes.filter((n) => n.id !== fileId);
  const nextEdges = prevEdges.filter((e) => e.from !== fileId && e.to !== fileId);
  const nodeRemoved = nextNodes.length < prevNodes.length;
  const edgesRemoved = prevEdges.length - nextEdges.length;

  const next: DesignDSL = {
    ...dsl,
    semantic: nextSemantic,
    geometry: dsl.geometry ? { ...dsl.geometry, nodes: nextNodes, edges: nextEdges } : dsl.geometry,
  };

  return {
    dsl: next,
    removal: {
      ...(file ? { file } : {}),
      node_removed: nodeRemoved,
      edges_removed: edgesRemoved,
    },
  };
}
