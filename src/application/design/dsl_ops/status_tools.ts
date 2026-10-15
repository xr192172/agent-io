/**
 * status_tools 工具实现
 *
 * 提供状态回填功能：
 * - update_status：手动更新节点/文件状态（★ T98：`check_status` 已**移除**，见文件末注）
 *
 * 工作流：
 *   LLM 手动标记 —— ★ T196：**真入口是 `edit_dsl`（`operations:[{type:"status", …}]`）**；
 *     原写「LLM 调用 `update_status`」—— ★ **那个工具不存在**（是收进 `edit_dsl` 之前的旧世界）。
 *   → render_design 重新渲染，节点颜色随状态变化
 *
 * ★★★ **T328（2026-10-15）进度轴收归：本文件从"写旧轴"改成"改调权威"**
 * ## 它原来错在哪
 * 它逐字写 **`node.status` / `file.status` / `dsl.status`** —— 即**旧轴（base）**。
 * 而 base 是**扫描可再生成**的：`import_project` 的 `rebuild_design=true` **一重建就把人写的进度冲掉**
 * （这正是 `progress`@overlay 被立起来的原因，见 `domain/overlay.ts` 的 `OverlayAnchor.progress` 注释）。
 * ## 现在的形状（人/工具显式设的 ⇒ 改调权威）
 * 1. **节点/文件进度** ⇒ 写 **`<feature>.overlay.json` 锚点的 `progress`**（唯一权威），
 *    再用 `applyOverlay` 把它**投影回** base（base 上那份是**应用结果**，不是独立副本）；
 * 2. **`dsl.status`（feature 整体状态）** ⇒ ★ **不再落库**。它是**从各节点状态算出来的派生值**
 *    （原先 `recomputeFeatureStatus` 把它写进 base）⇒ 按本仓分类法属"**可再生的派生字段**"，
 *    读侧统一走 `domain/geometry.ts#resolveDiagramStatus`（读侧默认）。
 * 3. **置 `'done'` 必须带 `evidence`** ⇒ 见 `validateProgressEvidence`（"不许默默勾上"的机制化）。
 */
import type { DiagramStatus } from '../../../domain/types.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { loadOverlay, saveOverlay } from '../../../infrastructure/storage_overlay.js';
import {
  applyOverlay,
  buildCandidates,
  seedOverlayFromDsl,
  validateProgressEvidence,
  type DesignOverlay,
  type OverlayAnchor,
  type ProgressEvidence,
} from '../../../domain/overlay.js';

// ─────────────────────────────────────────────────────────────
// update_status：手动更新节点/文件状态
// ─────────────────────────────────────────────────────────────

export interface UpdateStatusInput {
  /** feature 名 */
  feature: string;
  /** 节点 ID（对应 geometry.nodes.id 和 semantic.files.id） */
  node_id: string;
  /** 新状态 */
  status: DiagramStatus;
  /**
   * ★ T328：`status === 'done'` 时**必须**给（三档之一，见 `ProgressEvidence`）；
   * 不给 ⇒ 抛错并说清理由（**不静默、不自动补**）。
   */
  evidence?: ProgressEvidence;
}

export interface StatusResult {
  message: string;
  feature: string;
}

export function updateStatus(input: UpdateStatusInput): StatusResult {
  const { feature, node_id, status, evidence } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  // ★★★ T328：**先过闸再落盘** —— 置 `'done'` 而没证据 ⇒ 当场拒（理由见 `validateProgressEvidence`）。
  const gate = validateProgressEvidence(status, evidence);
  if (!gate.ok) throw new Error(gate.reason);

  // 锚点身份（path/kind）**从 base 现取**（与 `seedOverlayFromDsl` 同一把尺：`buildCandidates`）
  const cand = buildCandidates(dsl).find((c) => c.id === node_id);
  const semFile = dsl.semantic?.files.find((f) => f.id === node_id);
  if (!cand && !semFile) {
    throw new Error(`节点 "${node_id}" 在 geometry 和 semantic 中均未找到`);
  }

  // ① 权威写：overlay 锚点的 `progress`（+ evidence）——「人写的意图不许被重建冲掉」
  const ov: DesignOverlay = loadOverlay(feature) ?? seedOverlayFromDsl(dsl);
  const prev = ov.anchors[node_id];
  const anchor: OverlayAnchor = {
    ...(prev ?? { path: cand?.path ?? semFile!.path, kind: cand?.kind ?? 'file' }),
  };
  anchor.progress = status;
  if (evidence) anchor.progress_evidence = evidence;
  else delete anchor.progress_evidence;
  const next: DesignOverlay = { ...ov, anchors: { ...ov.anchors, [node_id]: anchor } };
  saveOverlay(next);

  // ② 投影：overlay（权威）→ base（应用结果），让 `get_dsl` 当下即可读到
  const applied = applyOverlay(dsl, next);
  saveDSL(applied);

  const statusLabel = { draft: '待实现', in_progress: '实现中', done: '已完成' }[status];
  return {
    message: [
      `已更新节点状态: ${node_id} → ${statusLabel}`,
      // ★ T328：`dsl.status` 不再落库（派生值）⇒ 这里**现算**一个给回执，不写盘。
      `feature 整体状态: ${computeFeatureStatus(applied.geometry.nodes)}`,
      `★ 权威已写进 overlay 的锚点 progress（base 上的是投影）` +
        (status === 'done' ? `；证据 kind=${evidence!.kind}` : ''),
    ].join('\n'),
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// 辅助：根据各节点状态算出 feature 整体状态
// ─────────────────────────────────────────────────────────────

/**
 * ★★★ T328：它原先叫 `recomputeFeatureStatus(dsl)`，**副作用是 `dsl.status = …`（落库）**。
 * 现改成**纯函数**（只算、不写）：doc 级状态是**派生值**，读侧走 `resolveDiagramStatus`。
 * ★ 口径**逐字未变**（`done×全部⇒done` / `有 done 或 in_progress⇒in_progress` / `否则 draft`；
 *   空节点表 ⇒ `draft`）—— 变的只是"不再把它写回 base"。
 */
export function computeFeatureStatus(nodes: Array<{ status?: DiagramStatus }>): DiagramStatus {
  if (nodes.length === 0) return 'draft';
  const statuses = nodes.map((n) => n.status || 'draft');
  const doneCount = statuses.filter((s) => s === 'done').length;
  const inProgressCount = statuses.filter((s) => s === 'in_progress').length;
  if (doneCount === nodes.length) return 'done';
  if (doneCount > 0 || inProgressCount > 0) return 'in_progress';
  return 'draft';
}

// ─────────────────────────────────────────────────────────────
// ★★ T98（2026-10-13）：**`check_status` 已移除** —— 留证，别再把它加回来
// ─────────────────────────────────────────────────────────────
// 它曾是：`checkStatus(feature, scaffold_dir?)` —— 扫 scaffold 产出的文件，
//   按 **`TODO` / `Not implemented` 文本计数**推断每个文件的完成度
//   （`totalMarkers === 0 ⇒ done` / `<= 2 ⇒ in_progress` / 更多 ⇒ `draft`）。
//
// 移除理由（★ 不是"说不出它解决什么" —— 它说得出来）：
//   ① ★ **它的判据是文字游戏**："代码里没有 TODO 字样 = **已完成**" ——
//      一个没写完但没留 TODO 的文件会被自动标成 `done`。
//   ② ★★ 而它正是本仓**明令禁**的那一类「**普查式判据**」（`todo.md` T195：
//      本仓自己编的"命名/词表"普查 ⇒ 撤 —— 因为**普查式门能静默死去仍显 ✅**）。
//   ③ ★ 它**没有任何入口**（全仓 `grep -rn "checkStatus" src` ⇒ 只剩定义 / 注释 ⇒ 0 引用）。
//   ⇒ 实现可从 git 取回；要恢复的是"**完成度怎么判**"这个**口径**，不是这段代码。
