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
 */

import type { DesignDSL, DiagramStatus } from '../../../domain/types.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';

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
}

export interface StatusResult {
  message: string;
  feature: string;
}

export function updateStatus(input: UpdateStatusInput): StatusResult {
  const { feature, node_id, status } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  let updated = false;

  // 更新节点状态
  const node = dsl.geometry.nodes.find(n => n.id === node_id);
  if (node) {
    node.status = status;
    updated = true;
  }

  // 同步更新 semantic file 状态
  const file = dsl.semantic?.files.find(f => f.id === node_id);
  if (file) {
    file.status = status;
    updated = true;
  }

  if (!updated) {
    throw new Error(`节点 "${node_id}" 在 geometry 和 semantic 中均未找到`);
  }

  // 重新计算整体状态
  recomputeFeatureStatus(dsl);
  saveDSL(dsl);

  const statusLabel = { draft: '待实现', in_progress: '实现中', done: '已完成' }[status];
  return {
    message: [
      `已更新节点状态: ${node_id} → ${statusLabel}`,
      `feature 整体状态: ${dsl.status}`,
    ].join('\n'),
    feature,
  };
}


// ─────────────────────────────────────────────────────────────
// 辅助：根据各节点状态重新计算 feature 整体状态
// ─────────────────────────────────────────────────────────────

function recomputeFeatureStatus(dsl: DesignDSL): void {
  const nodes = dsl.geometry.nodes;
  if (nodes.length === 0) {
    dsl.status = 'draft';
    return;
  }

  const statuses = nodes.map(n => n.status || 'draft');
  const doneCount = statuses.filter(s => s === 'done').length;
  const inProgressCount = statuses.filter(s => s === 'in_progress').length;

  if (doneCount === nodes.length) {
    dsl.status = 'done';
  } else if (doneCount > 0 || inProgressCount > 0) {
    dsl.status = 'in_progress';
  } else {
    dsl.status = 'draft';
  }
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
