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

import fs from 'node:fs';
import { getDSL, saveDSL, getDesignSheetFile } from '../../../infrastructure/storage.js';
// ★★★ 2026-10-19（设计只住一处）：**syncDecisionsToOverlay 已退役** ——
//   T75 当年加它是因为「base 重建会把 decision 冲掉」；而 design/ 现在是独立手写文件，
//   重建不碰它 ⇒ 那个前提已不存在。decision 只住 design/，不再同步进 overlay。
import { syncTagsToOverlay, syncLifecycleToOverlay } from '../../../infrastructure/storage_overlay.js';
import type { EditResult } from './edit_result.js';
import { addNode, updateNode, deleteNode } from './node_ops.js';
import type { AddNodeInput, UpdateNodeInput } from './node_ops.js';
import { applyDecisionWrite } from './node_ops.js';
// ★ T256：`expectations` 的形状校验器 —— ★ 与 `node_ops.ts:9` 同一处实现（不另写一把尺）
import { assertValidExpectations } from '../../../domain/expectation.js';
import { addEdge, deleteEdge } from './edge_ops.js';
import type { AddEdgeInput } from './edge_ops.js';
import { addFile, updateFile, deleteFile } from './file_ops.js';
import type { AddFileInput, UpdateFileInput } from './file_ops.js';
// ★ T170： 各 type/op 的 **data 契约表**（唯一判据）—— 校验与描述都从它派生。
import { checkOpSpec, OP_SPECS, type CheckedOperation } from './op_data_spec.js';
import { addExpectedApi, updateExpectedApi, deleteExpectedApi, setExpectedApis, setNodeSemantic } from './api_ops.js';
import { updateStatus } from './status_tools.js';
// ★★★ 2026-10-17（task_home）：任务格的**唯一写端**（claim / release / complete）。
//   ★ 本文件只做**路由**；任务态的迁移与判定住 `task_ops.ts`（不在别处直接改 state）。
import { applyTodoOp, applyTaskOp } from './task_ops.js';
// ★★★ T340：**自洽性闸** —— 改设计即校验自洽。判据是现成的 `validateDSL`（`domain/validator.ts:159`，
//   查 dangling_edge / duplicate_id / anchor_broken / reasoning 引用），**本处只调不改**（判定与 schema 都不动）。
import { validateDSL } from '../../../domain/validator.js';
// ★ T334：`status` op 的 `data.evidence` 形状 —— ★ **类型引用**（不新增判据；判据在 `domain/overlay.ts`）。
import type { ProgressEvidence } from '../../../domain/overlay.js';
import { addAnnotationByTool, resolveAnnotation } from './annotation_tools.js';
import { submitApproval, reviewAnnotation, type ApprovalDecision } from '../../observe/reconcile/approval.js';
import { saveSnapshot, rollbackSnapshot, deleteSnapshot, saveAutoSnapshot, pruneSnapshots } from '../lifecycle/snapshot.js';
import { dagLayout, forceLayout, gridAlign } from '../workbench/dag_layout.js';
import { resetSimulation } from '../lifecycle/simulation.js';
import type { DiagramStatus, DesignDSL, NodeDecision, DecisionDissent, DecisionAuthor } from '../../../domain/types.js';
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
   * - decision：**决策卡写入口**（update=把决策候选写到**文件/文档节点**的 `decision`；
   *   id = 文件节点 id 或仓库相对路径；data.summary 必填，可带 rationale/alternatives/consequences/
   *   acceptance/dissent/votes/evidence_source/author/note。★ 未决分歧进 `dissent`，**不是** `alternatives`；
   *   ★ `data.author` 是**类别**（只认 'human' | 'llm'，说可信度）；**身份**（谁）走**顶层入参 `agent`**）
   * - task：**任务格**（publish=立卡（★ 把该节点的**决策卡**翻成任务卡，不收手写内容）/ claim=领 /
   *   release=放回候选 / complete=收口；id = 节点 id。
   *   ★ 任务态**只**从这里改 —— 唯一写端见 `task_ops.ts`；★ `node.status` 对它只是派生值）
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
    | 'reset'
    | 'publish'
    | 'claim'
    | 'expectation.add'
    | 'expectation.remove'
    | 'release'
    | 'complete';
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
   * - task：任务格（op=publish/claim/release/complete，id 为 node_id；★ 任务态**唯一写端**；
   *   ★ publish 的内容来自该节点的 `decision`，**不收** data 里的手写描述）
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
    | 'tag'
    | 'decision'
    | 'task'
    | 'todo';
  /** 目标 ID：node_id / edge_id / file_id（api 类型为所属 file_id）；annotation/approval/snapshot/layout/simulation 用 data 传参，本字段可空 */
  id?: string;
  /** 操作数据（add/update/move 时按目标类型提供对应字段） */
  data?: Record<string, unknown>;
}

export interface UpdateFeatureInput {
  feature: string;
  operations: FeatureOperation[];
  /**
   * ★★★ **本次调用的身份来源**（2026-10-10）—— 发起 `edit_dsl` 的那个 Agent / 人的编号或名字
   * （谁在写）。写进决策卡的 `NodeDecision.agent` + 修订历史的 `DecisionHistoryEntry.agent`。
   *
   * ★★ **工具不生成它**：一次工具调用本身没有稳定身份（每次都是新的）⇒ 身份只能由**调用方**给。
   *   工具绝不自己造一个 id（那是伪造）。
   * ★ 它是**整次调用**的属性（一次 `edit_dsl` 里所有决策同属一个发起者）⇒ 放**顶层**、不放每个 op 的 `data`。
   * ★ 与 `data.author`（**类别** `'human' | 'llm'`）是**两个维度**，可并存。
   * ★ **没传 ⇒ 落库但不伪造**，读端明标「未署名」（不是抛错；理由见 `b_terms` 的 `agent` 词条）。
   */
  agent?: string;
  /**
   * ★★★ **本次变更的原因** —— 就是 `edit_dsl` 的**顶层必填入参 `reason`**（`dispatchDslEdit`
   * 把原始入参原样传进来，所以它天然在这里）。
   *
   * ## T255（2026-10-14）起：它**绑进决策卡的历史**
   * 规则：**决策和修改同步或半同步** —— 直接修改并填写原因，或先记录决策、后续补修改。
   * ⇒ **同步**：一次 `edit_dsl` 里"改 DSL + 填原因" ⇒ 那条原因**自动落进**该决策的
   *   `decision_history[].note`（调用方**没显式给 `data.note`** 时）⇒ ★ **"为什么做这次决策"随卡可查**。
   * ⇒ **半同步**：先落 `status:'draft'` 的决策，后续补改时原因同样进历史。
   *
   * ★ 为什么必须绑：实测（T255 取证）`reason` 此前**只喂 L1-L4 校验、完全不落库** ——
   *   于是"为什么改"与"决策卡"**脱钩**：卡里只有 `rationale`（这个设计为什么这么定），
   *   而"**这一次为什么动它**"没有任何住处。
   * ★ 优先序：**显式 `data.note` > 顶层 `reason`**（前者是更贴切的逐条说明，后者是整次调用的原因）。
   */
  reason?: string;
}

// ─────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────

/**
 * ★★ 2026-10-17（task_home）：本函数与下面的 `applyOperation` **改成 async** ——
 * 因为 `task` 的 `claim`/`complete` 必须在写前跑 `cardStanding` / `isSatisfied`（要 `judgeExpectations`，异步）。
 * ★ 这条 async 是**结构性的**，不是风格：若把"先判可领性"留给调用方"记得调"，那就是补丁
 * （别处要配合）⇒ 判定必须住在写端里面。⇒ 写链三处随之上浮：本函数 / `updateFeature` /
 * `dispatchDslEdit` 的 localRun / daemon 的 `dslWriteHandler`（都**顺序 await**，不并发）。
 */
async function updateFeatureCore(input: UpdateFeatureInput): Promise<EditResult> {
  const { feature, operations, agent } = input;

  if (!operations || operations.length === 0) {
    throw new Error('operations 不能为空');
  }

  const original = getDSL(feature);
  if (!original) {
    // ★ T192：同 `node_ops.ts` —— 原指 `create_feature`（**不存在**）；现在指真入口。
    throw new Error(
      // ★★ 形状：`action` 在**顶层**（★ 不是 `{args:{action}}` —— 那是少数派写法）。
      `feature "${feature}" 不存在 —— 先建一个：\`manage_feature\`（**顶层** \`action:"create"\` + \`feature:"${feature}"\`）。` +
        '★ 注意：**没有** `create_feature` 这个工具。',
    );
  }
  // 深拷贝备份，供失败回滚（剔除活态文件可能带入的 _sync 元数据）
  const backup = JSON.parse(JSON.stringify(original)) as Record<string, unknown>;
  delete backup._sync;

  // ★★★ 2026-10-18（Q2）：**原始文件字节**备份 —— 回滚用它，不用 `saveDSL(backup)`。
  //   病：`saveDSL(backup)` 会重新 `syncMeta` + `_dsl_rev +1` ⇒ **内容回滚了、元数据前进了**
  //       ⇒ 乐观锁误判"有人改过"（其实是我失败的那次）。
  //   药：回滚 = 把调用前的**字节**写回 ⇒ `_sync` / `_dsl_rev` 原样不动。
  const designFile = getDesignSheetFile(feature);
  const rawBackup = fs.existsSync(designFile) ? fs.readFileSync(designFile, 'utf8') : null;
  const restoreRaw = (): void => {
    if (rawBackup !== null) fs.writeFileSync(designFile, rawBackup, 'utf-8');
  };

  // ★★★ T340（2026-10-16）：**自洽性闸的基线读数** —— 本次调用**前**的 `validateDSL` 错误集。
  //   ★ 为什么要基线（而不是"见错就拒"）：★ **实测现状并非全过** —— 真仓 feature `observe-skeleton`
  //     就有 5 条 `anchor_broken`，且**既有证** `t329` / `t330` 的夹具 DSL 本身就缺 `id`（edges）/
  //     `responsibility`（files）⇒ 若"拦全部"，会把**与本次改动无关的既有错**也算到本次头上
  //     ⇒ **拦住一切写入**（含 t329/t330 这两张既有证，违反"既有十三证不许红"）。
  //   ⇒ 判据取 `after − baseline`：**只拦"本次新引入的"**（`checkOpSpec` 那种"只看本次"的口径）。
  //   ★★★ T341（2026-10-16）：**比较的是"错误键"而非"错误文本"**（唯一改动）。
  //     · 病（T340 自己报的）：原先取 `validateDSL(...).errors` 的**字符串差集** ⇒ 只要某次编辑让
  //       **既有错的文本**变了（典型：**重命名**"被指向的名字" ⇒ `[dangling_edge] edge "e".to "旧名"`
  //       变成 `"新名"`）⇒ 旧文本消失/新文本出现 ⇒ **被当成"本次新增"** ⇒ **误拦合法编辑**。
  //     · 药（照本仓既有"认亲"口径 —— `overlay.ts` 的 `byPath` / `_migratedFrom` 是按**名字/路径**
  //       对账，不是按整段文本）：`validator.ts` 的每条错**另产出稳定"键"**
  //       （`errors[i] ↔ keys[i]`，键 = `code` + **出错位置/主体**如 edge.id / 端点 from|to / file.id），
  //       ★ **键不含"被指向的对方名字"** ⇒ 重命名被指向的名字**不改键** ⇒ 仍被认作**同一条错**。
  //     · ★ 判定本身**未动**：`validateDSL` 判什么/判几条/文本一字未改，只是**附加**了键字段。
  const baselineKeys = new Set(validateDSL(original).keys);

  const results: string[] = [];
  // ★ T160（2026-10-11）：收集每个 op 的**结构化产物**（`EditResult.data`）。
  //   ★★ 为什么必须收：本循环下面**只取 `message` 首行**做摘要 ⇒ op 自己算出来的结构化结果
  //     （如"整块重写契约"的 added/removed/kept）**若不走这里就会蒸发**，agent 只能读散文。
  //   ★ 口径：**只收"有 data"的那些 op**；每条 data **自带定位字段**（如 `file_id` / `mode`）
  //     ⇒ 不需要额外包 `op_index`（那也是本仓"产物要能自己说清我是谁"的口径）。
  //   ★ 长度 1 ⇒ 直接给元素本身（常见情形少一层解包）；>1 ⇒ 给数组。**这条口径写在这里，读端别猜**。
  const opData: unknown[] = [];
  // ★★★ T255：本次变更原因（顶层 `reason`）—— 传给 decision 写路，绑进决策卡历史（见 `UpdateFeatureInput.reason`）。
  const changeReason = typeof input.reason === 'string' ? input.reason.trim() : '';
  try {
    for (const [i, op] of operations.entries()) {
      const result = await applyOperation(feature, op, agent, changeReason);
      // ★★ 摘要 = **首行**。⇒ 〔继承下笔人的判据〕**op 的首行必须自足**：
      //   它是**唯一保证被看见**的那一行（明细与结构化产物都可能在传输/汇总时丢掉）。
      //   例：破坏性操作（删条目）必须把"删了几条"写进首行，并带 ⚠。
      const summary = result.message.split('\n')[0];
      results.push(`  [${i + 1}/${operations.length}] ${summary}`);
      if (result.data !== undefined) opData.push(result.data);
    }
  } catch (e) {
    // 回滚到操作前状态
    restoreRaw();
    throw new Error(
      `操作 ${results.length + 1}/${operations.length} 失败，已回滚全部 ${results.length} 个已应用变更\n` +
        `失败原因: ${(e as Error).message}`,
    );
  }

  // ★★★ T340（2026-10-16）：**自洽性闸** —— 改设计即校验自洽。
  //   ## 位置（为什么在这一处）
  //   `edit_dsl` 的各 op **逐条 `saveDSL`**（`node_ops` / `edge_ops` / `file_ops` … 各自落盘）
  //   ⇒ 本路径**没有单一"落盘前"点**。本闸就是这一道**提交前**闸：全量 op 应用完 ⇒ **回读落定后的 DSL**
  //   跑 `validateDSL`；**有本次新引入的错误** ⇒ **恢复 backup**（★ 照本文件 182-189 那条**既有回滚惯例**）+ 抛。
  //   ⇒ 净效果 = 「本次改动若让设计变得不自洽 ⇒ 拒，且一个坏字节都不留在盘上」（与 `write_gate` 同款口径）。
  //   ## 为什么验**落定后的最终态**（而非"仅本次引入的 op"）
  //   `validateDSL` 查的是**跨引用完整性**（edge→node / semantic.files→node / reasoning→node）——
  //   这类事实**只有把全部 op 应用完才成立**，逐 op 判会误伤（例：先 add node 再 add edge 指向它）。
  //   ## 为什么"只拦本次新引入"（见上方 `baselineErrors` 的判据说明）—— 现状并非全过，见那里
  //   ## 边界（★ 如实标注）
  //   本闸**不改 `validateDSL` 判定、不改 schema、不碰 overlay 既有行为**（只读 DSL、只调现成校验器）。
  const draft = getDSL(feature);
  if (!draft) {
    // 极端情形（写完回读不到）：fail-closed —— 不许降级放行
    restoreRaw();
    throw new Error(
      `拒绝提交（自洽性闸）：edit_dsl 写完后**回读不到** feature "${feature}" 的 DSL ⇒ 无法判定自洽性。` +
        `本次改动已回滚到调用前状态。`,
    );
  }
  const verdict = validateDSL(draft);
  // ★★ T341：只拦**本次新引入的**错误 —— 按 **错误键**（不是文本）与基线对账：
  //   `newErrors = { after 的每条错 | 其**键**不在 baseline 且本次未见过 }`。
  //   ★ 键稳定（= 出错位置/主体，不含被指向的名字）⇒ "既有错只是文本变了"**不算新增** ⇒ 不误拦。
  //   ★ 键与 errors **同长同序**（`validator.ts` 的 `toResult` 一处产出），故这里按同一 index 取原文。
  const newErrors: string[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < verdict.errors.length; i++) {
    const key = verdict.keys[i];
    if (baselineKeys.has(key) || seenKeys.has(key)) continue; // 既有同键错 / 本次起重复 ⇒ 不算新增
    seenKeys.add(key);
    newErrors.push(verdict.errors[i]);
  }
  if (newErrors.length > 0) {
    const prefixFix: Record<string, string> = {
      dangling_edge: 'edge.from / edge.to 指向了不存在的节点 ⇒ 先 `node/add` 那个节点，或把该 edge 改指已存在的 id',
      duplicate_id: '同一个 node.id 出现两次 ⇒ 改成唯一 id',
      anchor_broken: 'semantic.files.id 没有对应 geometry 节点 ⇒ 为它 `node/add` 一个同 id 节点，或删掉该 semantic.files 条目',
      reasoning: 'reasoning 引用的 node / step 不存在 ⇒ 一并修正 reasoning 的 entry / steps / folds',
    };
    // ★ 按**错误前缀**给出对症的"怎么改"（`[dangling_edge]` ⇒ 命中 `dangling_edge`；`[reasoning_*]` ⇒ 命中 `reasoning`）
    const hitKeys = new Set<string>();
    for (const e of newErrors) {
      const kw = e.match(/^\[([a-z_]+)\]/)?.[1] ?? '';
      for (const key of Object.keys(prefixFix)) if (kw.startsWith(key)) hitKeys.add(key);
    }
    const howTo = [...hitKeys].map((k) => `  · [${k}*] ${prefixFix[k]}`);
    restoreRaw();
    throw new Error(
      `拒绝提交（自洽性闸 validateDSL）：本次 edit_dsl 让 feature "${feature}" 的 DSL **变得不自洽**（新增 ${newErrors.length} 条）—— ` +
        `本仓纪律：设计 DSL 天然应当逻辑自洽（dangling_edge / duplicate_id / anchor_broken / reasoning 引用都算）。\n` +
        `★ 本次新引入的错误原文（唯一判据 = \`domain/validator.ts:159\`，本次未改它）：\n` +
        newErrors.map((e) => `  · ${e}`).join('\n') +
        (howTo.length ? `\n★ 怎么改：\n${howTo.join('\n')}` : '') +
        `\n★ 本次改动已**回滚到调用前状态**（backup 已恢复，未把不自洽的 DSL 留在盘上）。` +
        `\n★ 判据范围（只此一条）：**只拦"本次新引入的"错误**（按**错误键**与调用前对账，\`after.keys − 调用前 keys\`）；` +
        `调用前就有的错**不计入本次**（本次未把它改坏 ⇒ 放行；★ 既有错**只是文本变了**（如重命名）也**不算新增**）。`,
    );
  }

  return {
    message: [
      `已对 feature "${feature}" 应用 ${operations.length} 个操作（全部成功）:`,
      ...results,
    ].join('\n'),
    feature,
    ...(opData.length ? { data: opData.length === 1 ? opData[0] : opData } : {}),
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
 *   · `node`     —— 通用增/删/改/移，`id` = `node_id`（见 `applyNodeOp`：`addNode({node_id: id, …})`）；
 *   · `binding`  —— `setNodeSemantic({node_id: op.id, …})`；
 *   · `status`   —— `updateStatus({node_id: op.id, …})`；
 *   · `task`     —— 任务格（2026-10-17）：`id` = **任务格所在的 node_id**（与节点同居，
 *     `.agent-io/design/task-system-plan.dsl.json#task_home`）⇒ 它确实是节点 id；
 *   · `decision` —— 决策写入口，`id` = **文件/文档节点 id 或仓库相对路径**（2026-10-10 T106 加）；
 *     ★★ 2026-10-10（T-e2e Bug2 修）：**路径必须先解析成真节点 id**（`findDecisionTargetNode`）再收 ——
 *     此前把 `op.id`（可能是路径）原样丢进 `alive.has(id)` ⇒ 路径永远匹配不上 ⇒ `nodes` 整项省略。
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
  // ① `id` **本身就是节点 id** 的那几类（node/binding/status/**task**）—— 直接取。
  //   ★ 2026-10-17（task_home）：`task` 的 `id` = 任务格所在的 node_id（与节点同居）⇒ 它**确实是**节点 id。
  const directIds = input.operations
    .filter((op) => op.type === 'node' || op.type === 'binding' || op.type === 'status' || op.type === 'task')
    .map((op) => op.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  // ② `decision` 的 `id` 可能是**节点 id**、也可能是**仓库相对路径**（见 resolveDecisionTarget）
  //    ⇒ 必须**解析成真节点 id** 再交出去。★ 这一步此前缺席：filter 收了 decision，却把 `op.id`（可能是路径）
  //    原样丢进 `alive.has(id)` ⇒ 路径匹配不到任何节点 id ⇒ `named` 为空 ⇒ `nodes` 整项省略（T-e2e Bug2 实测）。
  const decisionIds = input.operations
    .filter((op) => op.type === 'decision')
    .map((op) => op.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (directIds.length === 0 && decisionIds.length === 0) return [];
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
  // ② 的解析：路径/id → 真节点 id；解析不到（不该发生：applyDecisionOp 已校验）⇒ 交给下面的 alive 过滤，
  //     **不**在这里抛（这里只负责"能交出去的交出去"，不是第二处写前校验）。
  const resolvedDecisionIds = decisionIds
    .map((id) => findDecisionTargetNode(dslNow, id)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set([...directIds, ...resolvedDecisionIds])].filter((id) => alive.has(id));
}

export async function updateFeature(input: UpdateFeatureInput): Promise<TouchedProduct<EditResult>> {
  const r = await updateFeatureCore(input);
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
  const syncTags = syncTagsToOverlay(input.feature, dslNow);
  // ★★★ T182（2026-10-11）：**文件生命周期**（`deprecated` 待删标记）也走**同一个收口**。
  //   ★ 同款理由：它也是"**人写的意图**"，而 `import_project` 的显式重建会**整个替换 base**
  //     ⇒ 只写 base 的标记**一重建就静默丢**（T100 立过的规矩："标记必须住 overlay"）。
  //   ★ 放在**同一处**（而不是塞进 `updateFile`）是有意的 —— 收口在 `updateFeature`，
  //     **一处覆盖全部出口**（node/file/edge/status/annotation… 都从这出去），不会漏。
  const syncLifecycle = syncLifecycleToOverlay(input.feature, dslNow);

  // ★★★ T182b（2026-10-11）：**同步是破坏性的，不许无声无息**。
  //   `mergeXxxIntoOverlay` 有一条"清除也要同步"的纪律（base 上没了 ⇒ overlay 里一起清，
  //   防僵尸标记）—— ★ 但"清掉了"这件事此前**只进 `notes`，而返回值被整个丢掉**
  //   ⇒ ★ 于是"**清掉了 N 个待删标记**"**没有任何人看得到**（§2.3「不报错的错」的教科书形态）。
  //   ★ 修法：**把清除数报进回执**（只在真有清除时说话，免得日常噪声淹没它）。
  const clearedLines: string[] = [];
  if (syncTags.cleared) clearedLines.push('功能标记 1 组');
  if (syncLifecycle.cleared > 0) clearedLines.push(`★ 文件生命周期标记 ${syncLifecycle.cleared} 个（待删标记）`);
  const r2: EditResult =
    clearedLines.length === 0
      ? r
      : {
          ...r,
          message:
            r.message +
            `\n⚠ **同步 overlay 时清除了**：${clearedLines.join(' · ')}` +
            `\n   （含义：这些意图在 base 上已经没有了 ⇒ 按"不留僵尸"的纪律从 overlay 一并清掉。` +
            `★ 若你【没打算】清它们，现在就该回头看 —— 否则它们会安静地消失。）`,
        };

  return withTouched(r2, touchedOf(input));
}

// ─────────────────────────────────────────────────────────────
// 操作路由
// ─────────────────────────────────────────────────────────────

async function applyOperation(
  feature: string,
  rawOp: FeatureOperation,
  agent?: string,
  changeReason?: string,
): Promise<EditResult> {
  // ★★ T170（2026-10-11）：**形状校验的唯一入口**（type 合法性 / op 合法性 / id / data 必需键 / 二选一）。
  //   原先这些判据**散在下面各 case 里**（19 处 `if (!op.data?.X) throw`，还有几处 `if (op.op !== 'x') throw`）
  //   ⇒ ★ **LLM 看不见**，只能"故意发一个残缺请求、读报错"来发现字段（黑盒实验实测：**24 次调用里 8 次是试形状**）。
  //   现全部收进 `OP_SPECS`（唯一判据），同一张表**也渲染进 `edit_dsl` 的描述** ⇒ 提前看得见 ✓
  //   ★ 用 `const op = checkOpSpec(rawOp)` 的形态：**校验一次，此后 `op.data` 必有** ——
  //     那些被删掉的 `throw` 原先**兼具 TS 类型收窄**的作用，这里一次性补回来（不必在 15 处各写 `as`）。
  // ★ `op.id` 的存在**由 `OP_SPECS` 保证**（`idRequired:true` 的 type）⇒ 下面子函数里对
  //   `id` 的 `as string` 是"把已为真的事实告诉 TS"，**不是新判据**。
  //   ★ 若哪天把某 type 的 `idRequired` 改成 false，那些 `as` 就会撒谎 ⇒ **改表时要一起看**。
  const op = checkOpSpec(rawOp);
  switch (op.type) {
    case 'node':
      return applyNodeOp(feature, op, agent);
    case 'edge':
      return applyEdgeOp(feature, op);
    case 'file':
      return applyFileOp(feature, op);
    case 'api':
      return applyApiOp(feature, op);
    case 'binding': {
      // ★ T170：`op`/`id`/`data.file_id` 三者已由 `checkOpSpec` 判（见 `OP_SPECS`）—— 此处不再重复。
      return setNodeSemantic({
        feature,
        node_id: op.id as string,
        file_id: op.data!.file_id as string,
        sync_status: op.data!.sync_status as boolean | undefined,
      });
    }
    case 'status': {
      // ★ T170：三条已由 `checkOpSpec` 判（见 `OP_SPECS`）—— 此处不再重复。
      // ★★★ T334（2026-10-15）：`data.evidence`（`ProgressEvidence` 三档之一）**必须传下去** ——
      //   写端 `updateStatus` 置 `done` 时有闸（`validateProgressEvidence`）⇒ 不传 ⇒ 必然抛
      //   ⇒ 整套"完成必须带证据"的闸**在真实路径上是装饰**（t334 证书钉的就是这条真实路径）。
      //   ★ 形状不必在此再校验：闸（`validateProgressEvidence`）是**唯一一把尺**，形状错它会点名拒。
      return updateStatus({
        feature,
        node_id: op.id as string,
        status: op.data!.status as DiagramStatus,
        evidence: op.data!.evidence as ProgressEvidence | undefined,
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
    case 'decision':
      return applyDecisionOp(feature, op, agent, changeReason);
    case 'todo':
      return applyTodoOp(feature, op, agent);
    case 'task':
      // ★★★ 2026-10-17（task_home）：任务格的**唯一写端** —— 四个 action 都进 `task_ops`，
      //   不在本文件里直接改 `node.task.state`（那是"第二个写端"）。
      return applyTaskOp(feature, op, agent);
    default:
      throw new Error(`未知操作类型: ${op.type satisfies never}`);
  }
}

// ─────────────────────────────────────────────────────────────
// annotation：op=add 加标注 / op=resolve 关闭标注
// ─────────────────────────────────────────────────────────────

function applyAnnotationOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'add': {
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

function applyApprovalOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'submit': {
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
      const r = reviewAnnotation({
        feature,
        annotation_id: data.annotation_id as string,
        // ★ T198：值域**不在这里手写** —— 用 `approval.ts` 的 `ApprovalDecision`（唯一住处）。
        decision: data.decision as ApprovalDecision,
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

function applySnapshotOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const data = op.data ?? {};
  switch (op.op) {
    case 'save': {
      const r = saveSnapshot({
        feature,
        label: data.label as string,
        description: data.description as string | undefined,
      });
      return { message: r.message, feature };
    }
    case 'rollback': {
      const r = rollbackSnapshot({ feature, snapshot_id: data.snapshot_id as string });
      return { message: r.message, feature };
    }
    case 'delete': {
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

function applyLayoutOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
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

function applySimulationOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复（op 合法性）
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

function applyTagOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  if (op.op !== 'add' && op.op !== 'delete') {
    // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复（tag 的 op 只支持 add/delete）
  }
  const data = op.data ?? {};
  const tag = typeof data.tag === 'string' ? data.tag.trim() : '';

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
// decision：决策卡写入口（把候选落到**文件/文档节点**的 `decision`）
//   ★★ 语义分叉（本 op 的头号纪律）：**未决分歧**住 `data.dissent`，
//      **不是** `data.alternatives`（后者 = 已排除的方案 + 否决原因）。见 `domain/b_terms.ts` 的 `dissent`。
//   ★ 住 overlay：本 op **只改 base**；收口处 `updateFeature` 调 `syncDecisionsToOverlay`
//      把它搬进 overlay，`import_project` 重建时由 `applyOverlay` 投影回来（与 tag / 决策卡既有同步同款）。
// ─────────────────────────────────────────────────────────────

/**
 * 把入参字符串归一成仓库相对路径（`/` 分隔、去 `./`）—— 与 `resolveMemberFiles` 同款口径。
 * ★★ 2026-10-10 导出：`harvest_decisions` 的「统一处理范围入参」`files` 要按**同一个**路径口径
 *   过滤目标（见 {@link findDecisionTargetNode} 用的就是它）—— 采集侧另写一份归一 = 立刻分叉。
 */
export function normRel(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 决策写入口的目标节点：`id` 可为 **节点 id** 或 **仓库相对路径**（文件/文档节点） */
interface DecisionTarget {
  node: { id: string; type?: string; description?: string; decision?: NodeDecision; decision_history?: import('../../../domain/types.js').DecisionHistoryEntry[]; task?: import('../../../domain/task_schema.js').TaskSpec };
  /** 目标的仓库相对路径（人读回执用；取不到给节点 id） */
  path: string;
}

/**
 * ★★ 2026-10-10（T-e2e Bug2）：**决策写入口的目标节点查找（唯一落点，不抛）**。
 *
 * 为什么单拎出来：`decision` op 的 `id` 可以是**节点 id** 也可以是**仓库相对路径**（见 {@link resolveDecisionTarget}）。
 * 而 `touched.nodes` 需要的是**真节点 id** —— 若照抄 `op.id`（可能是路径），下面 `alive.has(id)` 会把路径过滤掉
 * ⇒ `named` 为空 ⇒ `nodes` 整项省略 ⇒ `edit_dsl → get_dsl` 接不上（实测回执："接不上：上游 touched 里没有 nodes"）。
 * ★ 所以**这一处查找就是唯一答案**：`resolveDecisionTarget`（写路径，带校验、会抛）与 `touchedNodeIds`
 *   （锚点路径，不抛）**共用它** —— 两处各写一份解析 = 本仓最反对的"判据分叉"。
 *
 * ★★ 2026-10-10（落点可行性）：**导出** —— `harvest_decisions` 采集时要标注「这条决策的落点能不能写进去」，
 *   判据必须与写入口**同一份**（否则又分叉）。采集侧据此判定 `landing` 字段，**不自己拼路径**。
 */
export function findDecisionTargetNode(dsl: DesignDSL, raw: string): DecisionTarget['node'] | undefined {
  const nodes = dsl.geometry?.nodes ?? [];
  const byId = nodes.find((n) => n.id === raw);
  const byPath = nodes.find(
    (n) => (n.type === 'file' || n.type === 'doc') && n.description && (n.description === raw || normRel(n.description) === normRel(raw)),
  );
  if (byId ?? byPath) return byId ?? byPath;
  // 语义文件表兜底：把 path / file_id 解析到它的节点 id，再取节点
  const sf = (dsl.semantic?.files ?? []).find((f) => f.id === raw || f.path === raw || normRel(f.path) === normRel(raw));
  return sf ? nodes.find((n) => n.id === sf.id) : undefined;
}

/**
 * 解析目标节点。★ **只接受文件/文档节点** —— 决策卡的定义就是"**每个文件为什么存在**"
 * （`harvest_decisions` 文件头）；挂到聚合/模块节点上是**语义错**，这里**响亮拒绝**而不是默默挂上去。
 * ★ 解析不到 ⇒ **抛**（列出试过的方式），绝不静默创建一个新节点。
 */
function resolveDecisionTarget(dsl: DesignDSL, id: string | undefined, data: Record<string, unknown>): DecisionTarget {
  const raw = (typeof id === 'string' && id.trim() ? id.trim() : '') ||
    (typeof data.path === 'string' && data.path.trim() ? data.path.trim() : '');
  const node = findDecisionTargetNode(dsl, raw);
  if (!node) {
    throw new Error(
      `decision.update 的目标 "${raw}" 不是本 feature 的节点：既非节点 id，也非任何文件/文档节点的路径，` +
        `也不在 semantic.files 里。请用 get_dsl query=files 核对**仓库相对路径**或节点 id。`,
    );
  }
  if (node.type !== 'file' && node.type !== 'doc') {
    throw new Error(
      `decision.update 的目标节点 "${node.id}"（type=${node.type ?? '?'}）不是文件/文档节点 ⇒ 拒绝。` +
        `决策卡语义是"**每个文件为什么存在**"（harvest_decisions），只能挂 type=file / type=doc 的节点。`,
    );
  }
  return { node, path: node.description ?? node.id };
}

/** 逐条校验 `alternatives`（已排除的方案 + **否决原因**）。★ 缺 `rejected_because` ⇒ 抛，并指向 `dissent`。 */
function parseAlternatives(v: unknown): { option: string; rejected_because: string }[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('decision.update 的 data.alternatives 必须是数组');
  return v.map((it, i) => {
    const o = it as { option?: unknown; rejected_because?: unknown };
    const option = typeof o?.option === 'string' ? o.option.trim() : '';
    const rejected_because = typeof o?.rejected_because === 'string' ? o.rejected_because.trim() : '';
    if (!option) throw new Error(`decision.update alternatives[${i}] 缺 option`);
    if (!rejected_because) {
      throw new Error(
        `decision.update alternatives[${i}] 缺 rejected_because —— **「alternatives」的语义是"被否掉的方案 + 否决原因"**。` +
          `若这条其实是"**还没裁定的分歧**"，请放「data.dissent」（未决分歧），不要塞进 alternatives。`,
      );
    }
    return { option, rejected_because };
  });
}

/** 逐条校验 `dissent`（未决分歧）。★ 与 alternatives 分开：这里**没有** rejected_because（还没判）。 */
function parseDissent(v: unknown): DecisionDissent[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error('decision.update 的 data.dissent 必须是数组');
  return v.map((it, i) => {
    const o = it as { option?: unknown; votes?: unknown; evidence_source?: unknown };
    const option = typeof o?.option === 'string' ? o.option.trim() : '';
    if (!option) throw new Error(`decision.update dissent[${i}] 缺 option`);
    const d: DecisionDissent = { option };
    if (o.votes !== undefined) {
      if (typeof o.votes !== 'number' || !Number.isFinite(o.votes)) throw new Error(`decision.update dissent[${i}].votes 必须是数字`);
      d.votes = o.votes;
    }
    if (o.evidence_source !== undefined) {
      if (!Array.isArray(o.evidence_source) || o.evidence_source.some((x) => typeof x !== 'string')) {
        throw new Error(`decision.update dissent[${i}].evidence_source 必须是字符串数组`);
      }
      d.evidence_source = o.evidence_source as string[];
    }
    return d;
  });
}

function applyDecisionOp(feature: string, op: CheckedOperation<FeatureOperation>, agent?: string, changeReason?: string): EditResult {
  const ELEMENT_OPS = ['expectation.add', 'expectation.remove'];
  if (op.op !== 'update' && !ELEMENT_OPS.includes(op.op)) {
    throw new Error(`decision 仅支持 update / expectation.add / expectation.remove（收到 ${op.op}）`);
  }
  const data = op.data ?? {};
  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';

  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在`);
  const target = resolveDecisionTarget(dsl, op.id, data);

  // ★★★ 2026-10-18（Q1）：**元素级 op 不许清空 summary** ——
  //   合并语义下，`{ summary: '' }` 会把原 summary 覆盖成空 ⇒ 必须带【原值】。
  const decision: NodeDecision = {
    summary: op.op === 'update' ? summary : (target.node.decision?.summary ?? ''),
  };
  // ★★★ T256（2026-10-14）：`expectations`（**可判定的验收**）—— 决策卡里**唯一会被程序判**的字段
  //   （`collectExpectations` → `consistency_check` 的 `judgeExpectations`）。
  //   ★ 此前它**不在 `decision` op 的已知键表**（`op_data_spec.ts` 的 `TYPE_KNOWN_KEYS`）
  //     ⇒ 从本入口写不进去（实测报「data 里有不被认的键：expectations」）⇒ 已补进那张表。
  //   ★ 形状校验**复用既有唯一实现** `assertValidExpectations`（`applyDecisionWrite` 里用的是同一个）
  //     —— ★ 不给这里另写第二把尺。
  // ★★★ 2026-10-18（Q1）：**元素级 op** —— 不改整个数组，只加/删一条（省掉"读全量→改→写回"三步）。
  if (op.op === 'expectation.add') {
    const cur = target.node.decision?.expectations ?? [];
    const e = data.expectation;
    if (e === undefined) throw new Error('expectation.add 必须给 data.expectation（单条期望）');
    assertValidExpectations([e] as never);
    decision.expectations = [...cur, e as NonNullable<NodeDecision['expectations']>[number]];
  } else if (op.op === 'expectation.remove') {
    const cur = target.node.decision?.expectations ?? [];
    let idx = -1;
    if (typeof data.index === 'number') {
      idx = data.index;
    } else if (typeof data.symbol === 'string') {
      const hits = cur.map((e, i) => ({ e, i })).filter(({ e }) => ('symbol' in e ? e.symbol === data.symbol : false));
      if (hits.length !== 1) {
        throw new Error(
          `expectation.remove 按 symbol "${data.symbol}" 匹配到 ${hits.length} 条 ⇒ 拒绝（用 data.index 精确删）`,
        );
      }
      idx = hits[0].i;
    } else {
      throw new Error('expectation.remove 需要 data.index（数字）或 data.symbol（字符串）');
    }
    if (idx < 0 || idx >= cur.length) throw new Error(`expectation.remove 的 index 越界：${idx}（共 ${cur.length} 条）`);
    decision.expectations = cur.filter((_, i) => i !== idx);
  } else if (data.expectations !== undefined) {
    assertValidExpectations(data.expectations);
    decision.expectations = data.expectations as NodeDecision['expectations'];
  }
  // ★★★ 2026-10-11（T174）：下面这 4 个字段**原先都是"形状不对就静默丢弃"** ——
  //   形如 `if (typeof data.X === 'string' && data.X.trim()) decision.X = …`
  //   ⇒ ★ **给了、但形状不对 ⇒ 条件不成立 ⇒ 一声不响地丢掉**（本仓最反对的形态）。
  //   ★★ 实测代价（黑盒第四轮）：代理按"链注说的验收"传了 `acceptance: ["…"]`（**数组**），
  //     **连试三种形态全部被静默丢弃**，它只能靠 `grep` **回读落盘文件**才发现没进去，
  //     并一度以为"契约没写进去"⇒ 最后**绕道**用 `expected_apis` 才闭环 ✗
  //   ⇒ 现在与**同袋子里另外几个字段（`votes` / `evidence_source` / `status` / `author`）对齐**：
  //     **给了就校验，形状不对就抛**。★ 判据：**同一处不许两种纪律**。
  if (data.rationale !== undefined) {
    if (typeof data.rationale !== 'string' || !data.rationale.trim()) {
      throw new Error('decision.update 的 data.rationale 必须是**非空字符串**（说清"为什么这么定"）');
    }
    decision.rationale = data.rationale.trim();
  }
  const alternatives = parseAlternatives(data.alternatives);
  if (alternatives.length) decision.alternatives = alternatives;
  if (data.consequences !== undefined) {
    if (typeof data.consequences !== 'string' || !data.consequences.trim()) {
      throw new Error('decision.update 的 data.consequences 必须是**非空字符串**');
    }
    decision.consequences = data.consequences.trim();
  }
  if (data.acceptance !== undefined) {
    if (typeof data.acceptance !== 'string' || !data.acceptance.trim()) {
      throw new Error(
        'decision.update 的 data.acceptance 必须是**非空字符串**（★ **不是数组** —— ' +
          '写清"这条决策怎么算验收通过"，一句话）',
      );
    }
    decision.acceptance = data.acceptance.trim();
  }
  // ★★ 未决分歧独立成字段（**不进 alternatives**）
  const dissent = parseDissent(data.dissent);
  if (dissent.length) decision.dissent = dissent;
  // 置信（多源印证）：votes = 支持 summary 的证据源个数；evidence_source = 哪几份证据
  if (data.votes !== undefined) {
    if (typeof data.votes !== 'number' || !Number.isFinite(data.votes)) throw new Error('decision.update 的 data.votes 必须是数字');
    decision.votes = data.votes;
  }
  if (data.evidence_source !== undefined) {
    if (!Array.isArray(data.evidence_source) || data.evidence_source.some((x) => typeof x !== 'string')) {
      throw new Error('decision.update 的 data.evidence_source 必须是字符串数组');
    }
    decision.evidence_source = data.evidence_source as string[];
  }
  if (typeof data.status === 'string') {
    // ★ 'superseded' 已退场（2026-10-15）：**显式拒绝并说明理由**，不静默并入通用"非法"（否则调用方会以为是自己拼错）。
    //   退场理由：'被取代'由 decision_history 的**自动压栈**表达（update 时旧版自动入栈），该 status 值是重复表达。
    if (data.status === 'superseded') {
      throw new Error(
        "decision.update 的 data.status='superseded' 已退场、不再合法：" +
          "'被取代'由 decision_history 的自动压栈表达（update 时旧版本自动入栈），不需要单独的 status 值。" +
          "请改用 'active'|'draft'。",
      );
    }
    if (!['active', 'draft'].includes(data.status)) throw new Error(`decision.update 的 data.status 非法：${data.status}`);
    decision.status = data.status as NodeDecision['status'];
  }
  if (data.thread !== undefined) {
    // ★ T174：同族 —— 原先 `typeof === 'string'` 不成立就**静默丢**；现改为"给了就校验"。
    if (typeof data.thread !== 'string' || !data.thread.trim()) {
      throw new Error('decision.update 的 data.thread 必须是**非空字符串**（这条决策挂在哪个线索/文档上）');
    }
    decision.thread = data.thread.trim();
  }
  if (data.tags !== undefined) {
    // ★ T174：原先 `Array.isArray` + `filter` ⇒ **非字符串项被悄悄滤掉**（半静默）；现改为**报**。
    if (!Array.isArray(data.tags) || data.tags.some((x) => typeof x !== 'string')) {
      throw new Error('decision.update 的 data.tags 必须是**字符串数组**（不要混进对象/数字）');
    }
    decision.tags = data.tags as string[];
  }
  // ★★★ T329（2026-10-15）：`scope`（这条决策管哪一片）—— 一行表达式，如 `subtree:mod!` / `files:src/a.ts`。
  //   ★ **不在此校验/规范化**：原样交给下方 `applyDecisionWrite`——它是**唯一**决策写入口，
  //     用 `domain/scope.ts` 的 `parseScope` 校验（同一把尺；别处再写一份 = 判据分叉）。
  //   ★ 这里只做**形状**（非字符串 ⇒ 报），与同袋子里 `rationale` / `thread` 等字段**同款纪律**。
  if (data.scope !== undefined) {
    if (typeof data.scope !== 'string') {
      throw new Error(`decision.update 的 data.scope 必须是字符串（一行 scope 表达式），收到 ${JSON.stringify(data.scope)}。`);
    }
    decision.scope = data.scope;
  }
  // ★★ 作者**类别**（可信度轴）：只认 'human' | 'llm' —— 收口（从前是自由文本，把类别/身份挤在一格）。
  //   ★ 身份（谁：Agent 编号/名字）是**另一个维度**，走**顶层入参 `agent`**，不许再塞进 author。
  let author: DecisionAuthor | undefined;
  if (data.author !== undefined) {
    const a = typeof data.author === 'string' ? data.author.trim() : '';
    if (a !== 'human' && a !== 'llm') {
      throw new Error(
        `decision.update 的 data.author 是**类别**（可信度轴），只认 'human' | 'llm'（收到 ${JSON.stringify(data.author)}）。` +
          `★ 「谁在写」（Agent 的编号/名字）是**另一个维度**，请用 edit_dsl 的**顶层入参 agent** 传，不要塞进 author。`,
      );
    }
    author = a;
  }
  // ★★ 身份（谁）**不走 data.agent** —— 走**顶层入参 `agent`**（一次调用一个身份）。
  //   ★ 若写进 `data.agent` ⇒ **响亮拒绝**（与上一条 `data.author` **同款**口径）：这是同一处"写错了地方"的病，
  //     两处必须一样响 —— 不许静默忽略（静默忽略正是本仓明令禁止的）。
  if (data.agent !== undefined) {
    throw new Error(
      `decision.update 的 data.agent 位置不对：**身份**（可追溯轴）不住 decision 的 data（收到 ${JSON.stringify(data.agent)}）。` +
        `★ 「谁在写」（Agent 的编号/名字）请用 edit_dsl 的**顶层入参 agent** 传（一次调用一个身份），不要塞进 decision 的 data。`,
    );
  }

  // ★★★ T255：**原因绑进历史**（规则：决策和修改同步或半同步，直接修改并填写原因）。
  //   ★ 优先序：**显式 `data.note` > 顶层 `reason`** —— 前者是逐条说明（更贴切），后者是整次调用的原因。
  //   ★ 为什么落进 `note` 而不是别处：`note` 会进 `DecisionHistoryEntry.note`（`applyDecisionWrite`）
  //     ⇒ 于是"**这一次为什么动它**"与那版决策**同处存档** ⇒ **考古时不用两处拼**。
  const note =
    typeof data.note === 'string' && data.note.trim()
      ? data.note
      : (changeReason && changeReason.trim() ? changeReason : undefined);
  const prev = target.node.decision;
  // ★ 身份来自顶层 `agent`（整次调用的发起者）；类别来自 data.author。二者落库可并存。
  const { decision: nd, decision_history: nh } = applyDecisionWrite(target.node.decision, target.node.decision_history, decision, {
    author,
    agent,
    note,
  });
  if (nd === undefined) throw new Error('decision.update 内部错误：写入结果为 undefined（summary 已非空，不应发生）');
  target.node.decision = nd;
  if (nh?.length) target.node.decision_history = nh;
  saveDSL(dsl);

  // ★★ 署名必须**在读得见的地方显形**。写回执经 `updateFeatureCore` 只透出**首行**（其余行丢弃）
  //   ⇒ 「署名 / 未署名」放进**首行**，否则"没传身份"在写回执里**看不见**（就静默了）。
  const authorTag = nd.author ? `作者类别 ${nd.author}` : '作者类别未标';
  const signTag = nd.agent ? `署名 ${nd.agent}` : '★ 未署名（本次调用未传 agent 身份 ⇒ 无发起者编号）';
  const lines = [
    `[decision] 已写入节点 "${target.node.id}"（${target.path}） · ${authorTag} · ${signTag}`,
    `  结论: ${nd.summary}`,
  ];
  if (nd.rationale) lines.push(`  理由: ${nd.rationale}`);
  if (nd.alternatives?.length) lines.push(`  已排除方案 ${nd.alternatives.length} 个（alternatives：option + rejected_because）`);
  if (nd.dissent?.length) lines.push(`  ★ 未决分歧 ${nd.dissent.length} 个（dissent：**待对拍**，非已排除）`);
  // ★ T329：范围（若有）显形（存的是**规范化后**的字符串；文法唯一落点 = src/domain/scope.ts）。
  if (nd.scope) lines.push(`  范围: ${nd.scope}`);
  if (nd.votes !== undefined) lines.push(`  证据支持: ${nd.votes} 份${nd.evidence_source?.length ? `（${nd.evidence_source.join('+')}）` : ''}`);
  lines.push(
    prev
      ? `  ★ 旧版已压入 decision_history（当前历史 ${nh?.length ?? 0} 条）；当前生效版 = 本次写入`
      : `  首版（无旧版可压栈）`,
  );
  return { message: lines.join('\n'), feature };
}

// ─────────────────────────────────────────────────────────────
// node：add / update / delete / move
// ─────────────────────────────────────────────────────────────

function applyNodeOp(feature: string, op: CheckedOperation<FeatureOperation>, agent?: string): EditResult {
  const { id, data } = op;
  switch (op.op) {
    case 'add':
      // ★ 身份（agent）来自 edit_dsl 顶层入参（整次调用的发起者），随**内联决策卡**一起落库。
      //   与 node.update 的 decision 路径**同款** —— 同一个 decision 字段，add/update 两条路不许行为分叉。
      return addNode({ feature, node_id: id, ...data, agent } as AddNodeInput);
    case 'update':
      // ★ 身份（agent）来自 edit_dsl 顶层入参（整次调用的发起者），随 node.update 一起落到决策卡上。
      return updateNode({ feature, node_id: id, ...data, agent } as UpdateNodeInput);
    case 'delete':
      return deleteNode({ feature, node_id: id as string });
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

function applyEdgeOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const { id, data } = op;
  switch (op.op) {
    case 'add':
      // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复
      return addEdge({ feature, edge_id: id, ...data } as unknown as AddEdgeInput);
    case 'delete':
      return deleteEdge({ feature, edge_id: id as string });
    case 'update': {
      const dsl = getDSL(feature);
      if (!dsl) throw new Error(`feature "${feature}" 不存在`);
      const existing = (dsl.geometry.edges ?? []).find(e => e.id === id);
      if (!existing) throw new Error(`边 "${id}" 不存在`);
      const merged = { ...existing, ...(data ?? {}) };
      deleteEdge({ feature, edge_id: id as string });
      return addEdge({
        feature,
        edge_id: id as string,
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

function applyFileOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const { id, data } = op;
  switch (op.op) {
    case 'add':
      // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复
      return addFile({ feature, file_id: id, ...data } as unknown as AddFileInput);
    case 'update':
      return updateFile({ feature, file_id: id, ...data } as UpdateFileInput);
    case 'delete':
      return deleteFile({ feature, file_id: id as string });
    default:
      throw new Error(`file 不支持操作: ${op.op}`);
  }
}

// ─────────────────────────────────────────────────────────────
// api：add / update / delete（id = 所属 file_id）
// ★ T160（2026-10-11）：**update 有两条路**（同一个操作对象"该文件的契约列表"，两种粒度）：
//   · **整块重写**（推荐）：给 `data.expected_apis`（数组）⇒ **不看旧串**、整块替换
//     —— 与代码侧 `edit_code op=replace`（"不信 AI 的 old_string"）**同一把尺**；
//   · **单条改**（旧式）：给 `data.signature`（**原签名串，逐字匹配**）+ `data.new_signature`。
//   ★ 后者留着只为向后兼容；★ **新写的东西一律走整块重写**（旧式那把尺正是代码侧已抛弃的）。
// ─────────────────────────────────────────────────────────────

function applyApiOp(feature: string, op: CheckedOperation<FeatureOperation>): EditResult {
  const { id, data } = op;
  switch (op.op) {
    case 'add':
      // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复
      return addExpectedApi({
        feature,
        file_id: id as string,
        signature: data.signature as string,
        notes: data.notes as string | undefined,
      });
    case 'update':
      // ★ T160：**整块重写优先** —— 给了 expected_apis 就整块替换，**不下看旧串**
      //   （判据：`Array.isArray` —— 明确的一刀，不做"像数组就当数组"的猜测）
      if (Array.isArray(data?.expected_apis)) {
        return setExpectedApis({
          feature,
          file_id: id as string,
          expected_apis: data!.expected_apis as Array<{ signature: string; notes?: string }>,
          note: data!.note as string | undefined,
        });
      }
      // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复（api.update 的**二选一**也已在表里：`anyOf`）
      return updateExpectedApi({
        feature,
        file_id: id as string,
        signature: data.signature as string,
        new_signature: data.new_signature as string | undefined,
        notes: data.notes as string | undefined,
      });
    case 'delete':
      // ★ T170：必需键已由 checkOpSpec 判（唯一判据见 op_data_spec.ts 的 OP_SPECS）—— 此处不再重复
      return deleteExpectedApi({
        feature,
        file_id: id as string,
        signature: data.signature as string,
      });
    default:
      throw new Error(`api 不支持操作: ${op.op}`);
  }
}
