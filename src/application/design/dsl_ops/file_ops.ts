/**
 * 语义文件操作：add_file / update_file / delete_file
 */

import type { DiagramStatus, SemanticFile, ExpectedApi } from '../../../domain/types.js';
// ★ T181：`lifecycle` 的**唯一校验器**与类型同处（`domain/semantic.ts`）—— **别在这里再写一份判据**。
import { assertLifecycle, type FileLifecycle } from '../../../domain/semantic.js';
// ★ T185：`removeFileFromDsl` = "移除文件节点"的**唯一判据**（`archive_node` 用的是同一个）
import { removeFileFromDsl } from '../../../domain/dsl_removal.js';
// ★ T185：摘掉文件的人负责清意图层的标记（与 `archive_node` 同一条纪律）
import { dropLifecycleFromOverlay } from '../../../infrastructure/storage_overlay.js';
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import type { EditResult } from './edit_result.js';
// ★★★ T328（2026-10-15，进度轴收归）：进度的**唯一权威写入**是 `overlay` 锚点的 `progress`
//   （+ evidence 闸）。file 的 add/update 只是**入口** ⇒ 一律路由到 `updateStatus`，**不再裸写** base 的 `SemanticFile.status`。
import { updateStatus } from './status_tools.js';

// ─────────────────────────────────────────────────────────────
// add_file：添加语义文件
// ─────────────────────────────────────────────────────────────

export interface AddFileInput {
  feature: string;
  file_id: string;
  path: string;
  responsibility: string;
  expected_apis?: ExpectedApi[];
  expected_deps?: string[];
  expected_behavior?: string;
  status?: DiagramStatus;
}

export function addFile(input: AddFileInput): EditResult {
  const { feature, file_id, path, responsibility, expected_apis, expected_deps, expected_behavior, status } = input;

  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);
  if (!dsl.semantic) dsl.semantic = { files: [] };

  if (dsl.semantic.files.find(f => f.id === file_id)) {
    // ★ T192：原指 `update_file` —— ★ **它不是工具**（内部函数名）⇒ 指向真入口。
    throw new Error(
      `文件 "${file_id}" 已存在 —— 要改它请用 \`edit_dsl\`：\`operations:[{type:"file", op:"update", …}]\`。` +
        '★ 注意：**没有** `update_file` 这个工具。',
    );
  }

  const file: SemanticFile = {
    id: file_id,
    path,
    responsibility,
    expected_apis,
    expected_deps,
    expected_behavior,
    // ★★★ T328：**不再把 `status` 落进 base**（旧轴直写）。进度改走权威（下面的 `updateStatus`）——
    //   它同时也是 evidence 闸的入口：不带证据置 `done` ⇒ 当场拒（"不许默默勾上"）。
  };

  dsl.semantic.files.push(file);
  saveDSL(dsl);

  // ★★★ T328：进度走权威（`overlay.progress` + 闸 + 投影回 base）；文件已落盘 ⇒ `updateStatus` 能查到它。
  if (status !== undefined) updateStatus({ feature, node_id: file_id, status });

  return {
    message: [
      `已添加文件: ${file_id}`,
      `路径: ${path}`,
      `职责: ${responsibility}`,
      `API 数: ${expected_apis?.length ?? 0}`,
      `当前文件数: ${dsl.semantic.files.length}`,
    ].join('\n'),
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// update_file：更新语义文件
// ─────────────────────────────────────────────────────────────

export interface UpdateFileInput {
  feature: string;
  file_id: string;
  path?: string;
  responsibility?: string;
  expected_deps?: string[];
  expected_behavior?: string;
  status?: DiagramStatus;
  /**
   * ★★★ **文件生命周期**（T181）—— **标记待删（`deprecated`）/ 已归档（`archived`）** 走这里。
   *
   * ★ 为什么要有它：用户裁定"**设计侧先标记待删 ⇒ 对拍确认实现里真没了 ⇒ 才扫进历史堆**"（三步流程）。
   *   ⇒ **第一步就需要一个"标记"入口**，而此前 `lifecycle` **只有 `archive_node` 会写** ⇒ **标记没有路** ✗
   * ★★ 三方独立评审一致：(a) "写 `SemanticFile.status='deprecated'`" **不成立** ——
   *   `DiagramStatus` 只有 `draft|in_progress|done`（`geometry.ts:10`），**不含 deprecated**；
   *   往里写会**污染「实现进度」轴**，且 `data` 不校验枚举 ⇒ **能写进去却不报**（静默）。
   *   ⇒ 必须用**同轴的** `FileLifecycle`（因为"下一步 `archived`"也只在这条轴里）。
   * ★ **写入是【合并】不是覆盖**（否则会把 `merged_from` 等历史抹掉 —— 评审指出）。
   */
  lifecycle?: FileLifecycle;
}

export function updateFile(input: UpdateFileInput): EditResult {
  const { feature, file_id, path, responsibility, expected_deps, expected_behavior, status, lifecycle } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  const file = dsl.semantic.files.find(f => f.id === file_id);
  if (!file) throw new Error(`文件 "${file_id}" 不存在`);

  if (path !== undefined) file.path = path;
  if (responsibility !== undefined) file.responsibility = responsibility;
  if (expected_deps !== undefined) file.expected_deps = expected_deps;
  if (expected_behavior !== undefined) file.expected_behavior = expected_behavior;
  // ★★★ T328：进度**不在此裸写** `SemanticFile.status`（旧轴/base）—— 见下方 saveDSL 后的 `updateStatus`。
  // ★★★ T181：生命周期标记（★ 校验与写入**都只有这一处**，`archive_node` 共用同一个 `assertLifecycle`）。
  //   ★★ **合并写、非覆盖** —— 覆盖会把 `merged_from`/`archive_id` 等历史抹掉（三方评审指出）。
  //   ★★ 写 `"archived"` 会被 `assertLifecycle` 拒（T183：那个值已从类型里删掉 ——
  //     归档 = 移出 DSL + 写归档库，**不是**这个字段能表达的状态）。
  if (lifecycle !== undefined) {
    const merged: FileLifecycle = { ...file.lifecycle, ...lifecycle };
    assertLifecycle(merged);
    file.lifecycle = merged;
  }

  saveDSL(dsl);

  // ★★★ T328（进度轴收归）：**进度改走权威** —— 唯一权威住 `overlay` 锚点的 `progress`，
  //   base 上的 `SemanticFile.status` 只是 `applyOverlay` 的**投影**。裸写 base 会在
  //   `rebuild_design=true` 时被冲掉，且会经 `seedOverlayFromDsl` 灌进 `progress`、**绕过 evidence 闸**。
  //   ⇒ 路由到唯一写函数 `updateStatus`（自带 evidence 闸与投影；它同时接受 semantic-only 的文件 id）。
  if (status !== undefined) updateStatus({ feature, node_id: file_id, status });

  return {
    message: `已更新文件: ${file_id}\n路径: ${file.path}\n职责: ${file.responsibility}`,
    feature,
  };
}

// ─────────────────────────────────────────────────────────────
// delete_file：删除语义文件
// ─────────────────────────────────────────────────────────────

export interface DeleteFileInput {
  feature: string;
  file_id: string;
}

/**
 * ★★★ **T185（2026-10-12）：这里原先【只删语义侧】**（`dsl.semantic.files.splice`）——
 *   于是留下一个**幽灵几何节点**（连同挂在它上面的决策卡/标注）：`get_dsl` 仍查得到、
 *   按几何层遍历的东西（布局/导出/架构图）**看不出它已被删** ⇒ ★ **静默地半删**（`docs/todo.md` T180）。
 *
 * ★ 现在**判据住一处**：调 `removeFileFromDsl`（domain）—— `archive_node` 用的是**同一个**
 *   ⇒ "三清"这件事**只有一份实现**，不会一边做全、一边做一半。
 *
 * ★★ 与 `archive` 的**唯一**区别（已在回执里逐字写明，不再让调用方猜）：
 *   本函数**不留历史**（不进归档库、不留归档快照、决策卡不保留）；
 *   ★ 要保留下线去向/理由/决策卡 ⇒ **用 `archive`**（三步流的③）。
 */
export function deleteFile(input: DeleteFileInput): EditResult {
  const { feature, file_id } = input;

  const dsl = getDSL(feature);
  if (!dsl || !dsl.semantic) throw new Error(`feature "${feature}" 不存在或没有 semantic 层`);

  if (!dsl.semantic.files.some(f => f.id === file_id)) throw new Error(`文件 "${file_id}" 不存在`);

  const { dsl: next, removal } = removeFileFromDsl(dsl, file_id);
  saveDSL(next);

  // ★★ 与 `archive` 同一条纪律：**谁摘掉的文件，谁负责清掉意图层那笔标记**。
  //   ★ 不靠 `updateFeature` 收口的 `syncLifecycleToOverlay` —— 它按 T182b 的规矩
  //     （"文件不在 base ⇒ 墓碑，不清"）**不会**清，因为它**分不出**"代码先删了等③"
  //     与"这里刚把文件摘掉了"这两种"文件不在 base"。★ 而**本函数分得出**（就是它摘的）。
  const dropped = dropLifecycleFromOverlay(feature, file_id);

  return {
    message: [
      // ★★★ **首行必须自足** —— `edit_dsl` 的汇总**只取首行**（见 `update_feature.ts:148-151`
      //   那条已有纪律：*"op 的首行必须自足：它是**唯一保证被看见**的那一行"*）。
      //   ⇒ ★ 三清的结果 + "不留历史"这个**破坏性警告**都必须挤进首行，
      //     否则它们在 `edit_dsl` 回执里**根本不出现**（我第一版就把它们放在了后几行 ⇒ 实测看不见）。
      `已删除文件: ${file_id}${removal.file ? ` (${removal.file.path})` : ''}` +
        ` · 三清: 语义文件 1 + 几何节点 ${removal.node_removed ? 1 : 0} + 边 ${removal.edges_removed}` +
        ` · 意图层标记${dropped.changed ? '已清' : '无'}` +
        ` · ⚠ **不留历史**（要保留去向/理由/决策卡请用 archive）`,
      `  剩余文件数: ${next.semantic?.files.length ?? 0}`,
      // 明细行保留（有的读端拿得到全文，如直调 [B] / CLI）—— ★ 但**不许只有它**
      `  ★ 与 ` + '`archive`' + ` 的**唯一**区别：本操作不进归档库、不留快照、决策卡一并丢；` +
        `\`archive(action=node, file_path, retire_reason)\` 才是三步流的③。`,
    ].join('\n'),
    feature,
  };
}
