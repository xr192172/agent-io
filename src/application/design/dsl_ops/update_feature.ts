/**
 * update_feature：统一写操作入口
 *
 * 将原 16 个写操作工具（add/update/delete node/edge/file/api、
 * set_node_semantic、batch_move/update_style/delete、update_status）
 * 整合为单个工具，通过 operations 列表批量提交。
 *
 * 特性：
 * - 批量操作按顺序执行，任一失败自动回滚到操作前状态（原子性）
 * - 每个操作路由到现有原子操作实现，行为与单独调用完全一致
 * - node 额外支持 move（相对平移 dx/dy），替代 batch_move_nodes
 * - edge 支持 update（删除后按合并数据重建，原子 ops 无独立 updateEdge）
 */

import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
// ★★ T75：决策卡必须活过 base 重建 ⇒ 每次 edit_dsl 收口时同步进 overlay
import { syncDecisionsToOverlay, syncTagsToOverlay } from '../../../infrastructure/storage_overlay.js';
import type { EditResult } from './edit_result.js';
import { addNode, updateNode, deleteNode } from './node_ops.js';
import type { AddNodeInput, UpdateNodeInput } from './node_ops.js';
import { addEdge, deleteEdge } from './edge_ops.js';
import type { AddEdgeInput } from './edge_ops.js';
import { addFile, updateFile, deleteFile } from './file_ops.js';
import type { AddFileInput, UpdateFileInput } from './file_ops.js';
import { addExpectedApi, updateExpectedApi, deleteExpectedApi, setNodeSemantic } from './api_ops.js';
import { updateStatus } from './status_tools.js';
import { addAnnotationByTool, resolveAnnotation } from './annotation_tools.js';
import { submitApproval, reviewAnnotation } from '../../observe/reconcile/approval.js';
import { saveSnapshot, rollbackSnapshot, deleteSnapshot, saveAutoSnapshot, pruneSnapshots } from '../lifecycle/snapshot.js';
import { dagLayout, forceLayout, gridAlign } from '../workbench/dag_layout.js';
import { resetSimulation } from '../lifecycle/simulation.js';
import type { DiagramStatus, DesignDSL } from '../../../domain/types.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

// ─────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────

export interface FeatureOperation {
  /**
   * 操作类型：
   * - 通用：add / update / delete / move（move 仅 node，相对平移）
   * - annotation：resolve（关闭标注）
   * - approval：submit（提交审批） / review（审批决策）
   * - snapshot：save（保存快照） / rollback（回滚） / delete（删除快照）
   * - layout：apply（自动布局，data.algo=dag|force|grid）
   * - simulation：reset（重置仿真状态）
   * - tag：**功能标记**（add=给 files 打 tag / delete=从 tag 移除 files 或删整个 tag；data.tag 必填）
   */
  op:
    | 'add'
    | 'update'
    | 'delete'
    | 'move'
    | 'resolve'
    | 'submit'
    | 'review'
    | 'save'
    | 'rollback'
    | 'apply'
    | 'reset';
  /**
   * 目标类型：
   * - node / edge / file：几何层节点、边、语义层文件
   * - api：语义文件的预期 API（id 为所属 file_id，data.signature 定位）
   * - binding：节点与文件绑定（仅 update，id 为 node_id，data.file_id 必填）
   * - status：节点状态更新（仅 update，id 为 node_id，data.status 必填；同步 file 状态并重算 feature 状态）
   * - annotation：标注（op=add 加标注 data.text/severity/type/author/node_id；op=resolve 关闭 data.annotation_id/resolution_note）
   * - approval：审批（op=submit data.annotation_id/assignee/submitter/comment；op=review data.annotation_id/decision/reviewer/comment）
   * - snapshot：版本快照（op=save data.label/description；op=rollback/delete data.snapshot_id）
   * - layout：自动布局（op=apply data.algo=dag|force|grid + 各算法参数）
   * - simulation：仿真（op=reset 重置到初始状态）
   * - tag：功能标记（op=add/delete，data.tag 必填；data.files = 成员文件（仓库相对路径或文件 id），省略 = 只动这个 tag 自身）
   */
  type:
    | 'node'
    | 'edge'
    | 'file'
    | 'api'
    | 'binding'
    | 'status'
    | 'annotation'
    | 'approval'
    | 'snapshot'
    | 'layout'
    | 'simulation'
    | 'tag';
  /** 目标 ID：node_id / edge_id / file_id（api 类型为所属 file_id）；annotation/approval/snapshot/layout/simulation 用 data 传参，本字段可空 */
  id?: string;
  /** 操作数据（add/update/move 时按目标类型提供对应字段） */
  data?: Record<string, unknown>;
}

export interface UpdateFeatureInput {
  feature: string;
  operations: FeatureOperation[];
}

// ─────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────

function updateFeatureCore(input: UpdateFeatureInput): EditResult {
  const { feature, operations } = input;

  if (!operations || operations.length === 0) {
    throw new Error('operations 不能为空');
  }

  const original = getDSL(feature);
  if (!original) {
    throw new Error(`feature "${feature}" 不存在，请先使用 create_feature 创建`);
  }
  // 深拷贝备份，供失败回滚（剔除活态文件可能带入的 _sync 元数据）
  const backup = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  delete backup._sync;

  const results: string[] = [];
  try {
    for (const [i, op] of operations.entries()) {
      const result = applyOperation(feature, op);
      // 取原子操作返回消息首行作为摘要
      const summary = result.message.split('\n')[0];
      results.push(`  [${i + 1}/${operations.length}] ${summary}`);
    }
  } catch (e) {
    // 回滚到操作前状态
    saveDSL(backup as never);
    throw new Error(
      `操作 ${results.length + 1}/${operations.length} 失败，已回滚全部 ${results.length} 个已应用变更\n` +
      `失败原因: ${(e as Error).message}`,
    );
  }

  return {
    message: [
      `已对 feature "${feature}" 应用 ${operations.length} 个操作（全部成功）:`,
      ...results,
    ].join('\n'),
    feature,
  };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: UpdateFeatureInput): Touched {
  // 只给作用域类 feature：本工具改的是 **DSL（活文档）不是文件** ⇒ **不给 written_files**
  //   （在 DSL 内存模型上落 saveDSL，不对应"仓库相对路径的源文件"；硬填会把"改了设计"谎报成"改了源码文件"）。
  const nodes = touchedNodeIds(input);
  return nodes.length ? { feature: input.feature, nodes } : { feature: input.feature };
}

/**
 * ★★★ 2026-10-09（T82 的硬前提）：**对象类锚点 = 本次操作点名的那些节点**。
 *
 * ## 为什么要补（实测，不是洁癖）
 * `touchedOf` 原先**只给 `feature`** —— 那是个**作用域键**（`CHAIN_EDGES` 里是 `ANY_TOOL → ANY_TOOL`）
 * ⇒ **一个对象都不承载** ⇒ `deriveObjectChains()` 里**永远没有 `edit_dsl`**
 * ⇒ 手写 `direct` 名单里它删不得（T82 实测：删了会**削掉"写设计"这一步**）。
 * ★ 而它**明明有对象可交**：它改的就是 DSL 的**节点**，而 `Touched.nodes` **这个键早就存在**。
 *
 * ## 口径（哪些算、哪些不算）
 * 只收 **`id` 就是节点 id** 的那几种 op：
 *   · `node`    —— 通用增/删/改/移，`id` = `node_id`（见 `applyNodeOp`：`addNode({node_id: id, …})`）；
 *   · `binding` —— `setNodeSemantic({node_id: op.id, …})`；
 *   · `status`  —— `updateStatus({node_id: op.id, …})`。
 * ★ **其余 type 的 `id` 不是节点**，一个都不收：`edge` 是**边**、`file`/`api` 是**语义实体**、
 *   `annotation`/`approval`/`snapshot`/`layout`/`simulation` 是**协作对象**
 *   ⇒ 塞进来就是 §2.2 那条「**名字像 ≠ 同义**」（都叫 `id`，指的不是一类东西）。
 *
 * ## ★★ 只给「**落定后**仍存在」的 id（这条是硬要求，不是优化）
 * `op=delete` 执行完那个节点**已经不在 DSL 里**了 —— 再把它的 id 交出去，下游（如 `get_dsl query=node`）
 * 会去查一个**不存在的节点**。
 * ★ 这是本仓已经栽过的那一课的**同款**：`find_references` 的 `file` **只在真有定义时才给**
 *   （`mode=field` 下整项省略）—— 判据是**"无条件能宣称的东西"**，不是"夹具里恰好成立"。
 * ★ 所以这里**回读一次** `getDSL`（此时 `updateFeatureCore` 已 save，读到的是**落定后**的状态）
 *   与 `rename_symbols.symbols` 给**新名**同口径。
 */
function touchedNodeIds(input: UpdateFeatureInput): string[] {
  const named = input.operations
    .filter((op) => op.type === 'node' || op.type === 'binding' || op.type === 'status')
    .map((op) => op.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (named.length === 0) return [];
  // ★★★ 读不到 DSL 就**抛**，**绝不 `?? []`**（2026-10-09 评审查出，我第一版写成 `getDSL(...)?.… ?? []`）。
  //   那是本仓判据里的「**该报错却默认**」：DSL 读不回来时，`?? []` 会把"**锚点丢了**"
  //   **静默降级成"这批节点都不在了"** ⇒ `nodes` 整项省略 ⇒ 下游拿不到锚点，而回执里**看不出任何异常**。
  //   ★ 这**不是**不可能状态（我原先以为"刚 save 过所以读得到"）：`updateFeatureCore` 只保证**写之前**
  //     feature 存在；写入之后读不回来仍然是缺陷，必须让调用方知道。
  //   ★ 同族留档：`find_references` 的 `file`「只在真有定义时才给」—— 那里的"省略"是**语义**（本来就没有），
  //     这里的"省略"会是**故障伪装成语义**，两者必须分开。
  const dslNow = getDSL(input.feature);
  if (!dslNow) {
    throw new Error(
      `edit_dsl 已写入，但**回读不到** feature "${input.feature}" 的 DSL ⇒ 无法判定 touched.nodes。` +
        `（不静默降级成"没有节点"：那会让下游拿不到锚点却看不出原因）`,
    );
  }
  const alive = new Set(dslNow.geometry.nodes.map((n) => n.id));
  return [...new Set(named)].filter((id) => alive.has(id));
}

export function updateFeature(input: UpdateFeatureInput): TouchedProduct<EditResult> {
  const r = updateFeatureCore(input);
  // ★★★ 2026-10-09（T75）：一次 `edit_dsl` 调用结束后，**把 base 上的决策卡同步进 overlay**。
  //   为什么放在这一处（而不是每个 op 里各写一遍）：**这里是所有写操作的唯一收口**
  //   （node / file / edge / status / annotation … 都从这里出去），一处覆盖全部，不会漏。
  //   ★ 没有它：`import_project` 重建 base 时 **人写的决策（含验收标准）一重建就丢** ——
  //     而"base 可再生成、overlay 独立保留"正是 overlay 存在的全部理由。
  //   ★ 失败不许吞：同步失败就让整个 `edit_dsl` 失败（否则会安静地回到"决策会丢"的老状态）。
  // ★★★ 2026-10-09（功能标记 MVP）：**同一收口**把 base 上的**功能标记**（`meta.function_tags`）
  //   也同步进 `overlay.global.function_tags` —— 同款理由（标记也必须活过 base 重建）。
  //   ★★ **读不到 DSL 就抛，绝不 `?? 空 DSL`**：空 DSL 的 `meta.function_tags` 缺失会被
  //     `mergeTagsIntoOverlay` 读成"标记已清空"⇒ **把 overlay 里的标记静默抹掉**（破坏性静默降级）。
  const dslNow = getDSL(input.feature);
  if (!dslNow) {
    throw new Error(
      `edit_dsl 已写入，但**回读不到** feature "${input.feature}" 的 DSL ⇒ 无法把决策/功能标记同步进 overlay。` +
        `（★ 不静默降级成空 DSL：那会把 overlay 里的标记**当成"已被清空"而抹掉**）`,
    );
  }
  syncDecisionsToOverlay(input.feature, dslNow);
  syncTagsToOverlay(input.feature, dslNow);
  return withTouched(r, touchedOf(input));
}

// ─────────────────────────────────────────────────────────────
// 操作路由
// ─────────────────────────────────────────────────────────────

function applyOperation(feature: string, op: FeatureOperation): EditResult {
  switch (op.type) {
    case 'node':
      return applyNodeOp(feature, op);
    case 'edge':
      return applyEdgeOp(feature, op);
    case 'file':
      return applyFileOp(feature, op);
    case 'api':
      return applyApiOp(feature, op);
    case 'binding': {
      if (op.op !== 'update') throw new Error('binding 仅支持 update 操作');
      if (!op.id) throw new Error('binding.update 需要 id（node_id）');
      if (!op.data?.file_id) throw new Error('binding.update 需要 data.file_id');
      return setNodeSemantic({
        feature,
        node_id: op.id,
        file_id: op.data.file_id as string,
        sync_status: op.data.sync_status as boolean | undefined,
      });
    }
    case 'status': {
      if (op.op !== 'update') throw new Error('status 仅支持 update 操作');
      if (!op.id) throw new Error('status.update 需要 id（node_id）');
      if (!op.data?.status) throw new Error('status.update 需要 data.status');
      return updateStatus({
        feature,
        node_id: op.id,
        status: op.data.status as DiagramStatus,
      });
    }
    case 'annotation':
      return applyAnnotationOp(feature, op);
    case 'approval':
      return applyApprovalOp(feature, op);
    case 'snapshot':
      return applySnapshotOp(feature, op);
    case 'layout':
      return applyLayoutOp(feature, op);
    case 'simulation':
      return applySimulationOp(feature, op);
    case 'tag':
      return applyTagOp(feature, op);
    default:
      throw new Error(`未知操作类型: ${op.type satisfies never}`);
  }
}

// ─────────────────────────────────────────────────────────────
// annotation：op=add 加标注 / op=resolve 关闭标注
// ─────────────────────────────────────────────────────────────

function applyAnnotationOp(feature: string, op: FeatureOperation): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'add': {
      if (!data.text) throw new Error('annotation.add 需要 data.text');
      const r = addAnnotationByTool({
        feature,
        text: data.text as string,
        node_id: data.node_id as string | undefined,
        type: data.type as 'comment' | 'question' | 'issue' | 'suggestion' | 'approval' | undefined,
        severity: data.severity as 'info' | 'warning' | 'critical' | undefined,
        author: data.author as string | undefined,
      });
      return { message: r.message, feature };
    }
    case 'resolve': {
      if (!data.annotation_id) throw new Error('annotation.resolve 需要 data.annotation_id');
      const r = resolveAnnotation({
        feature,
        annotation_id: data.annotation_id as string,
        resolution_note: data.resolution_note as string | undefined,
      });
      return { message: r.message, feature };
    }
    default:
      throw new Error(`annotation 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// approval：op=submit 提交审批 / op=review 审批决策
// ─────────────────────────────────────────────────────────────

function applyApprovalOp(feature: string, op: FeatureOperation): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'submit': {
      if (!data.annotation_id) throw new Error('approval.submit 需要 data.annotation_id');
      const r = submitApproval({
        feature,
        annotation_id: data.annotation_id as string,
        assignee: data.assignee as string | undefined,
        submitter: data.submitter as string | undefined,
        comment: data.comment as string | undefined,
      });
      return { message: r.message, feature };
    }
    case 'review': {
      if (!data.annotation_id) throw new Error('approval.review 需要 data.annotation_id');
      if (!data.decision) throw new Error('approval.review 需要 data.decision');
      if (!data.reviewer) throw new Error('approval.review 需要 data.reviewer');
      const r = reviewAnnotation({
        feature,
        annotation_id: data.annotation_id as string,
        decision: data.decision as 'approve' | 'reject' | 'request_revision',
        reviewer: data.reviewer as string,
        comment: data.comment as string | undefined,
      });
      return { message: r.message, feature };
    }
    default:
      throw new Error(`approval 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// snapshot：op=save 保存 / op=rollback 回滚 / op=delete 删除
// ─────────────────────────────────────────────────────────────

function applySnapshotOp(feature: string, op: FeatureOperation): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'save': {
      if (!data.label) throw new Error('snapshot.save 需要 data.label');
      const r = saveSnapshot({
        feature,
        label: data.label as string,
        description: data.description as string | undefined,
      });
      return { message: r.message, feature };
    }
    case 'rollback': {
      if (!data.snapshot_id) throw new Error('snapshot.rollback 需要 data.snapshot_id');
      const r = rollbackSnapshot({ feature, snapshot_id: data.snapshot_id as string });
      return { message: r.message, feature };
    }
    case 'delete': {
      if (!data.snapshot_id) throw new Error('snapshot.delete 需要 data.snapshot_id');
      const r = deleteSnapshot({ feature, snapshot_id: data.snapshot_id as string });
      return { message: r.message, feature };
    }
    default:
      throw new Error(`snapshot 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// layout：op=apply 自动布局（data.algo=dag|force|grid + 各算法参数）
// ─────────────────────────────────────────────────────────────

function applyLayoutOp(feature: string, op: FeatureOperation): EditResult {
  const data = op.data ?? {};
  const algo = data.algo ?? 'dag';
  let msg: string;
  switch (algo) {
    case 'dag': {
      const r = dagLayout({
        feature,
        direction: data.direction as 'horizontal' | 'vertical' | undefined,
        h_gap: data.h_gap as number | undefined,
        v_gap: data.v_gap as number | undefined,
        width: data.width as number | undefined,
        respect_swimlanes: data.respect_swimlanes as boolean | undefined,
      });
      msg = r.message;
      break;
    }
    case 'force': {
      const r = forceLayout({
        feature,
        repulsion: data.repulsion as number | undefined,
        stiffness: data.stiffness as number | undefined,
        damping: data.damping as number | undefined,
        iterations: data.iterations as number | undefined,
        node_radius: data.node_radius as number | undefined,
        width: data.width as number | undefined,
        height: data.height as number | undefined,
      });
      msg = r.message;
      break;
    }
    case 'grid': {
      const r = gridAlign({ feature, grid_size: data.grid_size as number | undefined });
      msg = r.message;
      break;
    }
    default:
      throw new Error(`layout 未知算法: ${algo as string}`);
  }
  // 布局里程碑：自动布局改写坐标后注册带坐标的服务端版本（坐标未变则去重跳过）
  try {
    const snap = saveAutoSnapshot(feature, `布局_${algo as string}`);
    const pruned = pruneSnapshots(feature);
    if (snap) msg = `${msg}\n已自动纳管布局版本: ${snap.snapshot_id}${pruned ? `（裁剪旧快照 ${pruned} 个）` : ''}`;
  } catch {
    // 快照失败不阻断布局，仅忽略
  }
  return { message: msg, feature };
}

// ─────────────────────────────────────────────────────────────
// simulation：op=reset 重置仿真状态
// ─────────────────────────────────────────────────────────────

function applySimulationOp(feature: string, op: FeatureOperation): EditResult {
  if (op.op !== 'reset') throw new Error(`simulation 不支持操作: ${op.op}`);
  const r = resetSimulation({ feature });
  return { message: r.message, feature };
}

// ─────────────────────────────────────────────────────────────
// tag：功能标记（人给文件节点打的"隶属某功能"标签）
//   ★ 形态的唯一住处是 `domain/overlay.ts` 的 `OverlayGlobal.function_tags`（tag → 成员 rel 单向）。
//   ★ 本 op **只改 base**（meta.function_tags）；收口处 `updateFeature` 再同步进 overlay。
// ─────────────────────────────────────────────────────────────

/** DSL 的 `meta` 是**无类型袋子**（goals/storyboard 已住此处）；这里只对 function_tags 做最小收窄 */
interface DslWithMeta {
  meta?: { function_tags?: Record<string, string[]> } & Record<string, unknown>;
}

/**
 * 把入参里的文件标识（**仓库相对路径** / 文件节点 id / 语义文件 id）归一成**仓库相对路径**。
 * ★ 匹配不到的不**静默丢弃** —— 由调用方逐条列出并抛错。
 */
function resolveMemberFiles(dsl: DesignDSL, inputs: string[]): { resolved: string[]; unresolved: string[] } {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '');
  const byKey = new Map<string, string>();
  for (const f of dsl.semantic?.files ?? []) {
    if (f.path) byKey.set(norm(f.path), f.path);
    if (f.id && f.path) byKey.set(f.id, f.path);
  }
  for (const n of dsl.geometry?.nodes ?? []) {
    if (n.type !== 'file') continue;
    const rel = n.description ?? n.id;
    byKey.set(n.id, rel);
    if (n.description) byKey.set(norm(n.description), rel);
  }
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const raw of inputs) {
    const hit = byKey.get(raw) ?? byKey.get(norm(raw));
    if (hit === undefined) unresolved.push(raw);
    else if (!resolved.includes(hit)) resolved.push(hit);
  }
  return { resolved, unresolved };
}

function applyTagOp(feature: string, op: FeatureOperation): EditResult {
  if (op.op !== 'add' && op.op !== 'delete') {
    throw new Error(`tag 不支持操作: ${op.op}（只支持 add / delete）`);
  }
  const data = op.data ?? {};
  const tag = typeof data.tag === 'string' ? data.tag.trim() : '';
  if (!tag) throw new Error('tag 操作需要 data.tag（功能标记名，非空字符串）');

  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);
  const rec = dsl as unknown as DslWithMeta;
  const tags: Record<string, string[]> = { ...(rec.meta?.function_tags ?? {}) };
  const rawFiles = Array.isArray(data.files)
    ? data.files.map((x) => String(x)).filter((s) => s.length > 0)
    : [];

  let msg: string;
  if (op.op === 'add') {
    if (rawFiles.length === 0) {
      if (tag in tags) {
        msg = `标签「${tag}」已存在（现 ${tags[tag].length} 个成员）；本次未给 data.files ⇒ 只确认标签存在，成员不变`;
      } else {
        tags[tag] = [];
        msg = `已登记空标签「${tag}」（未给 data.files ⇒ 成员待补）`;
      }
    } else {
      const { resolved, unresolved } = resolveMemberFiles(dsl, rawFiles);
      if (unresolved.length) {
        throw new Error(
          `tag.add 有 ${unresolved.length} 个文件匹配不到任何文件节点：${unresolved.join(' / ')}` +
            ` ⇒ 拒绝打标（不静默略过）。请核对**仓库相对路径**或文件节点 id（见 get_dsl query=files）。`,
        );
      }
      const cur = tags[tag] ?? [];
      const merged = [...cur];
      const added: string[] = [];
      for (const r of resolved) {
        if (!merged.includes(r)) {
          merged.push(r);
          added.push(r);
        }
      }
      tags[tag] = merged;
      msg =
        `标签「${tag}」加入 ${added.length} 个成员（现共 ${merged.length} 个）` +
        (added.length ? `：${added.join(', ')}` : '（均已在标签内，无变化）');
    }
  } else {
    if (!(tag in tags)) throw new Error(`tag.delete 的标签「${tag}」不存在`);
    if (rawFiles.length === 0) {
      const n = tags[tag].length;
      delete tags[tag];
      msg = `已删除整个标签「${tag}」（连带 ${n} 个成员）`;
    } else {
      const cur = tags[tag];
      const curSet = new Set(cur);
      const norm = (s: string) => s.replace(/\\/g, '/').replace(/^\.\//, '');
      const toRemove = new Set<string>();
      const notMember: string[] = [];
      for (const raw of rawFiles) {
        // 当前文件节点解析到的 rel（可能 undefined —— 例如该成员文件已改名/删除）
        const viaFile = resolveMemberFiles(dsl, [raw]).resolved[0];
        // ★ 先认**存储里的成员串本身**（失联成员也要能被清掉），再认"当前文件解析出的 rel"
        const hit = [raw, norm(raw), ...(viaFile ? [viaFile] : [])].find((c) => curSet.has(c));
        if (hit === undefined) notMember.push(raw);
        else toRemove.add(hit);
      }
      if (notMember.length) {
        throw new Error(
          `tag.delete 有 ${notMember.length} 个文件不是标签「${tag}」的成员：${notMember.join(' / ')}` +
            ` ⇒ 拒绝删除（不静默略过）。当前成员：${cur.join(', ') || '(空)'}`,
        );
      }
      const remaining = cur.filter((r) => !toRemove.has(r));
      if (remaining.length) {
        tags[tag] = remaining;
        msg = `标签「${tag}」移除 ${toRemove.size} 个成员（剩 ${remaining.length} 个）`;
      } else {
        delete tags[tag];
        msg = `标签「${tag}」移除 ${toRemove.size} 个成员后已空 ⇒ 一并删除该标签`;
      }
    }
  }

  // 写回 base 的 meta.function_tags（保留 meta 其它键；空则清掉，不留空壳）
  const meta: Record<string, unknown> = { ...(rec.meta ?? {}) };
  if (Object.keys(tags).length > 0) meta.function_tags = tags;
  else delete meta.function_tags;
  if (Object.keys(meta).length > 0) rec.meta = meta;
  else delete rec.meta;
  saveDSL(dsl);
  return { message: `[tag] ${msg}`, feature };
}

// ─────────────────────────────────────────────────────────────
// node：add / update / delete / move
// ─────────────────────────────────────────────────────────────

function applyNodeOp(feature: string, op: FeatureOperation): EditResult {
  const { id, data } = op;
  if (!id) throw new Error('node 操作需要 id');
  switch (op.op) {
    case 'add':
      return addNode({ feature, node_id: id, ...data } as AddNodeInput);
    case 'update':
      return updateNode({ feature, node_id: id, ...data } as UpdateNodeInput);
    case 'delete':
      return deleteNode({ feature, node_id: id });
    case 'move': {
      // 相对平移（替代 batch_move_nodes，逐个 node 一条 move 操作）
      const dx = (data?.dx as number) ?? 0;
      const dy = (data?.dy as number) ?? 0;
      const dsl = getDSL(feature);
      if (!dsl) throw new Error(`feature "${feature}" 不存在`);
      const node = dsl.geometry.nodes.find(n => n.id === id);
      if (!node) throw new Error(`节点 "${id}" 不存在`);
      node.x = (node.x ?? 0) + dx;
      node.y = (node.y ?? 0) + dy;
      saveDSL(dsl);
      return { message: `已移动节点: ${id} (dx=${dx}, dy=${dy})`, feature };
    }
    default:
      throw new Error(`node 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// edge：add / update / delete（update = 合并数据后删除重建）
// ─────────────────────────────────────────────────────────────

function applyEdgeOp(feature: string, op: FeatureOperation): EditResult {
  const { id, data } = op;
  if (!id) throw new Error('edge 操作需要 id');
  switch (op.op) {
    case 'add':
      if (!data?.from || !data?.to) throw new Error('edge.add 需要 data.from 和 data.to');
      return addEdge({ feature, edge_id: id, ...data } as unknown as AddEdgeInput);
    case 'delete':
      return deleteEdge({ feature, edge_id: id });
    case 'update': {
      const dsl = getDSL(feature);
      if (!dsl) throw new Error(`feature "${feature}" 不存在`);
      const existing = (dsl.geometry.edges ?? []).find(e => e.id === id);
      if (!existing) throw new Error(`边 "${id}" 不存在`);
      const merged = { ...existing, ...(data ?? {}) };
      deleteEdge({ feature, edge_id: id });
      return addEdge({
        feature,
        edge_id: id,
        from: merged.from,
        to: merged.to,
        label: merged.label,
        edge_type: merged.type,
        arrow: merged.arrow,
        layer: merged.layer,
      });
    }
    default:
      throw new Error(`edge 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// file：add / update / delete
// ─────────────────────────────────────────────────────────────

function applyFileOp(feature: string, op: FeatureOperation): EditResult {
  const { id, data } = op;
  if (!id) throw new Error('file 操作需要 id');
  switch (op.op) {
    case 'add':
      if (!data?.path || !data?.responsibility) {
        throw new Error('file.add 需要 data.path 和 data.responsibility');
      }
      return addFile({ feature, file_id: id, ...data } as unknown as AddFileInput);
    case 'update':
      return updateFile({ feature, file_id: id, ...data } as UpdateFileInput);
    case 'delete':
      return deleteFile({ feature, file_id: id });
    default:
      throw new Error(`file 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// api：add / update / delete（id = 所属 file_id，data.signature 定位）
// ─────────────────────────────────────────────────────────────

function applyApiOp(feature: string, op: FeatureOperation): EditResult {
  const { id, data } = op;
  if (!id) throw new Error('api 操作需要 id（所属 file_id）');
  switch (op.op) {
    case 'add':
      if (!data?.signature) throw new Error('api.add 需要 data.signature');
      return addExpectedApi({
        feature,
        file_id: id,
        signature: data.signature as string,
        notes: data.notes as string | undefined,
      });
    case 'update':
      if (!data?.signature) throw new Error('api.update 需要 data.signature（原签名）');
      return updateExpectedApi({
        feature,
        file_id: id,
        signature: data.signature as string,
        new_signature: data.new_signature as string | undefined,
        notes: data.notes as string | undefined,
      });
    case 'delete':
      if (!data?.signature) throw new Error('api.delete 需要 data.signature');
      return deleteExpectedApi({
        feature,
        file_id: id,
        signature: data.signature as string,
      });
    default:
      throw new Error(`api 不支持操作: ${op.op}`);
  }
}
