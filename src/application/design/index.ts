/**
 * design 线（12 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ 2026-10-05（T15 切片）：本线 10 → 12 —— 把「混合文件解耦」这对能力从 **CLI-only** 接进 MCP 面：
 *   `signal_review`（LLM 复核 = 拆分链第一棒）+ `split_stage`（按簇拆分执行 = 最后一棒）。
 *   判据：它们原先只存在于 `signal_review_cli` / `split_stage_cli`（argv 薄壳），而**核心函数本来就在**
 *   `./bricks/signal_review` 与 `./lifecycle/split_stage` ⇒ 属"**能力被藏在 MCP 面之外**"，注册即归零
 *   ★（2026-10-06 更正）当时写的"两个 CLI 保留为投影面，不删 —— 删了会丢 argv 便利"**理由不成立**：
 *     CLI 面本来就由 `cli.js <工具名>` **投影**提供（`package.json` 的 script 也早已改指投影），
 *     手写 `*_cli.ts` 只是**同一入口的第二份副本** ⇒ 那两个 CLI 随后**已删**。
 *     ★ 判据是「**唯一真相源 = `ToolDef`，MCP 与 CLI 都是它的投影**」，不是"留一份方便"。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const DESIGN_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'design'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 *
 * ★ 面收敛第三批（2026-09-29）：本线 12 → 10 个注册入口。两族收成单入口
 *   （判据 = `docs/tool-convergence.md` §2.0「按**操作对象**聚合，不按实现机制」）：
 *   · 脚手架族 2 → 1：`scaffold`（action=generate / backfill）—— 同一操作对象「脚手架输出目录」，
 *     两个 [B] 的默认目录**逐字相同** = `<cwd>/scaffold/<feature>/`；共用锚点 feature；动作互补 = 生成 + 回填。
 *   · 设计意图族 2 → 1：`design_intent`（action=set / propose）—— 同一操作对象「设计意图 overlay」
 *     （<feature>.overlay.json 的 goals + edge_intents）；共用锚点 feature；propose 是 set 的
 *     "先请人批再落"前置闸（两者 description 本相互指名、propose 复用 set 的写端）。
 *   ★ 本线其余**不动**：`get_dsl` / `edit_dsl` / `manage_feature`（已是聚合体）/ `render_design`
 *     / `render_brickwork` / `consistency_check` / `detect_drift` / `import_project` 各是独立操作对象。
 *   ★ 反面结论（与 `camera_*` 教训同型，见提交信息）：「一致性检查 + 漂移检测」**不该合** ——
 *     `detect_drift` 是**编排**（内部调 `checkConsistencyReport`），`consistency_check` 是**基础动作/引擎**，
 *     二者**不同抽象层**，且不共用输入契约（前者要 code_dir；后者要 scope/since_ref/mode/changed_files）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { requireStr, wrapData } from '../plumbing.js';
// ★ T170：`operations[]` 各 type 的 data 契约表（**唯一判据**）—— edit_dsl 描述里那段就是它的渲染。
import { renderOpSpecs } from './dsl_ops/op_data_spec.js';
// ★ T198：审批**状态值表** —— ★ 描述里**从它渲染**合法值（不手抄 ⇒ 不会与实现漂）。
import { APPROVAL_STATUSES } from '../../domain/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb } from '../../infrastructure/index/db.js';
import { getDSL, requireProjectRoot } from '../../infrastructure/storage.js';
import { proposeChange } from './workbench/code_workbench.js';
import { importProject } from '../../infrastructure/graph/import_project.js';
import type { ImportProjectInput } from '../../infrastructure/graph/import_project.js';
// ★ T15 切片（2026-10-05）：把「混合文件解耦」这对能力从 CLI 面接进 MCP 面 ——
//   两者共用同一批 application 层核心（与 `brickify_cli` 同源；`split_stage_cli` 已于 2026-10-06 删除），CLI 只是 argv 薄壳。
import { setDesignIntent } from './intent/set_design_intent.js';
import { consistencyHandler, detectDriftHandler, editDslHandler, getDslHandler, renderDesignHandler } from './handlers.js';
import { designLineHandler } from './line/design_line.js';
import { genDesignDb } from './db/gen_design_db.js';
import { rewriteSymbols } from './rewrite/rewrite.js';
import type { ToolDef } from '../types.js';

export const DESIGN_TOOLS: ToolDef[] = [
  {
    name: 'get_dsl',
    title: 'Query feature data',
    description:
      '统一只读入口：通过 query 参数查询 DSL 数据。' +
      'query: dsl（完整 DSL JSON）/ features（所有 feature 列表）/ ' +
      'nodes（节点摘要列表，支持 layer/type 过滤）/ edges（边摘要列表，支持 layer 过滤）/ ' +
      'node（单个节点详情，需 node_id，含决策卡与版本史）/ ' +
      'decisions（决策卡目录，按功能线 thread 分组，支持 thread/decision_status/scope 过滤）/ ' +
      'files（语义文件摘要列表，支持 file_layer/file_status 过滤；★ 每项出 `file`（仓库相对路径）与 `symbols`' +
      '（**实际符号的 qualified_name**，取 cache.db 事实、不再是计数）—— 这两个词就是 find_references 的入参词，' +
      '可直接接力）/ ' +
      'file（单个文件详情，需 file_id，含 expected_apis / expected_deps；★ 已实现 API 不在此——它是**代码的事实**，现取解析数据 cache.db）/ ' +
      'digest（每文件一行的紧凑认知索引：F:职责 | R:关系 | A:契约 | S:高熵决策，需 feature；' +
      '★ 只读**派生视图**——从已有 DSL 字段现渲染、不落盘、不新增真相源，上下文紧张时一遍读完）/ ' +
      'calls（文件调用关系，需 file_id+project_dir，查 cache.db 入/出调用）/ ' +
      'functions（函数级大纲，需 feature，查缓存 db 的目录→文件→函数 + 调用/被调用/回环）/ ' +
      'annotations（标注）/ approvals（审批）/ approval_history（审批历史，需 annotation_id）/ ' +
      'snapshots（快照）/ templates（模板）/ simulation_state（仿真状态）/ diff（对比，需 feature_a+feature_b）/ ' +
      'goals（结构化目标，meta.goals）/ edge_intents（边级意图，edge.intent）/ ' +
      'tag（**功能标记**：人给文件节点打的"隶属某功能"标签 —— 传 tag 列出其成员与**失联成员**、省略则列全部标签）/ ' +
      'pending（**欠账视图**：★ 只读**直读 overlay 权威**（`<feature>.overlay.json` 锚点的 `progress`），' +
      '列出所有**未完成**锚点（`progress !== \'done\'`；★ **未登记 progress 的锚点不算欠账**）；' +
      '每项出 `id/path/progress/progress_evidence`，决策卡带 `scope`（T329）时一并出 `decision_scope`；' +
      '★ 口径「欠账=progress!=done」· 来源=overlay 权威（**不是** base 的投影 `status`）· 每次现算**不落盘**）。' +
      'view: design（默认，活态设计）/ live（实际代码快照，仅 query=dsl/nodes/edges/node/files/file 生效，用于对比设计 vs 代码现状）。',
    inputSchema: {
      query: z
        .enum(['dsl', 'features', 'nodes', 'edges', 'node', 'decisions', 'files', 'file', 'digest', 'scope', 'calls', 'functions', 'annotations', 'approvals', 'approval_history', 'snapshots', 'templates', 'simulation_state', 'diff', 'goals', 'edge_intents', 'tag', 'pool', 'pending'])
        .describe('查询类型：dsl=完整DSL, features=feature列表, nodes=节点摘要, edges=边摘要, node=节点详情, decisions=决策目录(按功能线分组), files=文件摘要, file=文件详情, digest=每文件一行紧凑认知索引(F职责/R关系/A契约/S高熵决策,只读派生), scope=**圈定范围**(按 layer/swimlane/arch_layer/subtree/files 解析成确定的文件集合,只读派生), calls=调用关系, functions=函数级大纲(目录→文件→函数+调用/被调用/回环), annotations=标注, approvals=**按审批状态看【全部】批注**（★ 默认含未提交的 `draft`；只要待审批的用 `status="pending_review"`）, approval_history=审批历史, snapshots=快照, templates=模板, simulation_state=仿真状态, diff=对比, goals=结构化目标(meta.goals), edge_intents=边级意图(edge.intent), tag=功能标记(人给文件节点打的"隶属某功能"标签:给 tag=成员+失联,省略=列全部标签), pool=**任务池**(把各节点上的 task 卡按状态归拢成池:candidate/claimed/done/void 各几张,只读派生;★ feature 不存在会抛,不返回空池), pending=**欠账视图**(只读直读 overlay 权威:列未完成锚点 progress!=done,含 progress_evidence 与决策卡 scope;★ 未登记 progress 的锚点不算欠账,不落盘)'),
      scope: z
        .string()
        .optional()
        .describe(
          'query=scope 时：**圈定范围**的一行表达式（文法唯一落点在 src/domain/scope.ts）：' +
            'all=整份(顶层) | layer:main|error|detail | swimlane:<泳道id> | arch_layer:<架构层id> | ' +
            'subtree:<node_id>  (±尾缀 ! 表示下钻进子图) | nodes:<id>,<id> | files:<相对路径>,<目录/>。缺省=all。' +
            '★ 解析是**纯函数**（同一输入两次结果逐字相同）⇒ 可作下游"分区域重写/对账"的稳定命名。' +
            '★ query=decisions 时本参数改为**按范围过滤决策卡**（列出"管这一片"的决策）。',
        ),
      view: z.enum(['design', 'live']).default('design').describe('视图层级：design=设计视图（默认），live=实际代码快照'),
      feature: z.string().optional().describe('feature 名（nodes/edges/node/decisions/files/file/digest/annotations/approvals 等需要）'),
      node_id: z.string().optional().describe('query=node 时：节点 ID'),
      tag: z.string().optional().describe('query=tag 时：功能标记名（给=列出该标签的成员与失联成员；省略=列出全部标签）。★ 与决策卡上的 decision.tags 不是一件事'),
      thread: z.string().optional().describe('query=decisions 时：按功能线过滤（不传=全部，按 thread 分组输出）'),
      decision_status: z.enum(['active', 'draft']).optional().describe('query=decisions 时：按决策状态过滤（active=生效中/draft=草案）。★ 原 superseded 已退场'),
      file_id: z.string().optional().describe('query=file/calls 时：文件 ID（对应 SemanticFile.id = geometry Node.id）'),
      project_dir: z.string().optional().describe('query=calls/functions 时：项目根目录（用于定位 cache.db / import_cache_*.db 查询函数级数据）'),
      layer: z.enum(['main', 'error', 'detail']).optional().describe('query=nodes/edges 时：按职责分层过滤'),
      type: z.string().optional().describe('query=nodes 时：按节点类型过滤（如 service/module/database/api/queue/ui）'),
      file_layer: z.string().optional().describe('query=files 时：按架构层过滤（如 api/service/data/ui）'),
      file_status: z.enum(['draft', 'in_progress', 'done']).optional().describe('query=files 时：按实现状态过滤'),
      annotation_node_id: z.string().optional().describe('query=annotations 时：按节点过滤'),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      unresolved_only: z.boolean().optional(),
      // ★★★ T198：原先 `status` 只说"按状态过滤"（**一个合法值都不给**）、`assignee` **完全没有描述**
      //   ⇒ ★ 读者只能试错（★ 有个子代理真的被"审批列表里出现 draft"骗过一次）。
      //   ★ 值域从 `APPROVAL_STATUSES` **渲染**（★ 不手抄 ⇒ 不会漂）。
      status: z
        .string()
        .optional()
        .describe(
          `query=approvals 时：按审批状态过滤。合法值：${APPROVAL_STATUSES.join(' / ')}。` +
            '★ 注：`draft` = 尚未提交审批（★ **默认不过滤时也会列出来**）；`pending_review` = 待审批。',
        ),
      assignee: z.string().optional().describe('query=approvals 时：按指派人（assignee）过滤'),
      annotation_id: z.string().optional().describe('query=approval_history 时：标注 ID'),
      feature_a: z.string().optional().describe('query=diff 时：源 feature'),
      feature_b: z.string().optional().describe('query=diff 时：目标 feature'),
      view_b: z.enum(['design', 'live']).optional().describe('query=diff 时：feature_b 视图层级，默认跟随 view（design）；对比"设计 vs 代码现状"时传 live'),
    },
    handler: getDslHandler,
  },

  {
    name: 'edit_dsl',
    title: 'Update feature with batch operations',
    description:
      '统一写入口：通过 operations 列表批量执行节点/边/文件/API 的增删改、节点平移、语义绑定、状态更新，' +
      '以及标注/审批/快照/自动布局/仿真重置。按顺序执行，任一失败自动回滚（原子性）。' +
      'op: add/update/delete/move（通用），resolve（关闭标注），submit/review（审批），save/rollback/delete（快照），apply（布局），reset（仿真）；' +
      'type: node/edge/file/api/binding/status/annotation/approval/snapshot/layout/simulation/tag/decision。' +
      '标注/审批/快照/布局/仿真/标记 用 data 传参（annotation.add data.text；annotation.resolve data.annotation_id；' +
      'approval.submit/review data.annotation_id；snapshot.save data.label；snapshot.rollback/delete data.snapshot_id；' +
      'layout.apply data.algo=dag|force|grid；simulation.reset 无参；' +
      '★ tag：功能标记 —— op=add/delete，data.tag=标记名（必填），data.files=成员文件（仓库相对路径或文件 id；省略=只动这个标签自身）。' +
      '给文件节点打"隶属某功能"标签，成员被改名/删除后可用 get_dsl query=tag 查出**失联成员**；标记住设计意图 overlay，活过 import_project 重建）。' +
      // ★★ 2026-10-11（T175）：本段原先**把 `decision` 的 data 字段清单又列了一遍** ——
      //   而 T170 新加的「data 契约」表**也在列**它 ⇒ ★ **同一件事两处，且已经不一致**
      //   （本段的 `dissent` 形状比表里细 ⇒ 表是错的；而表的位置在描述更后面 ⇒ 读者先看到的是旧段）。
      //   ⇒ 按本仓纪律「**同一件事只说一处**」：**字段清单归表**，本段只留**表里没有的语义**（"谁"的两个轴 / 历史 / overlay）。
      '★ decision：**决策卡写入口** —— op=update。★ **它的 `data` 字段清单与形状见下面的「data 契约」表**（此处不再重复）。' +
      '★ **两个正交的"谁"**（都要能同时出现）：data.author = **类别**（可信度轴，只认 \'human\' | \'llm\'）；' +
      '**顶层入参 `agent`** = **身份**（可追溯轴，发起本次调用的 Agent 编号/名字，工具不生成、由调用方给；' +
      '没传 ⇒ 落库但读端标「未署名」）。' +
      '覆盖时旧版自动压入 decision_history（**有历史、默认只显示最新**）。决策住设计意图 overlay，活过 import_project 重建。' +
      'view: design（默认，改设计视图）/ live（拒绝写入，实际代码快照只能由 import/watch 重建）。' +
      'weight: normal（默认）/ routine。routine=轻量写路径：跳过 L4 证据回溯（仍留 L1-L3 防空话/套话/泛谈），' +
      '适合日常维护（补节点/改职责描述/加标注/改属性），不必先跑代码留 trace 证据；改架构/契约等重改请用 normal 全链强闸。' +
      '★ 但**改 `semantic.files` 的 op（`type=file` / `type=api`）两档都要先"现取该文件的事实"**：' +
      'DSL 已不存事实镜像（actual_apis/actual_deps 已移除）⇒ 事实只能现取，须把该文件路径作为 evidence 的 ref 传进来。' +
      '\n★★★ **`reason` / `evidence` 三层各要什么**（★ T171，2026-10-11：此前**报错文案把 A 层的要求说成了 B 层的形状**，' +
      '**实测误导**了一个没有源码可读的 agent —— 它连试三次都在改 `evidence`，而病其实在 `reason` 没写具体）：\n' +
      '  · **L3「实体绑定」看的是 `reason` 的【文本】** —— 那句话里必须**出现具体实体名**' +
      '（节点 id / 文件路径 / 文件名 / 数字指标）；★ **与 `evidence` 无关** —— 放进 evidence 也不管用。\n' +
      '  · **facts 层（改 `semantic.files` 时）** —— `evidence` 里要有一条 `ref` = 该文件的**仓库相对路径**；' +
      '★ **一条就够**（实测：给「路径 + 节点 id」两条，多出来的那条是**多余的**）。\n' +
      '  · **L4「证据可回溯」**（`weight=normal` 才有）—— `evidence` 里**每条**都要对得上：' +
      '节点 id ∨ 观察事件(trace) ∨ 文件路径。\n' +
      '  ⇒ ★ 一句话：**`reason` 里要「提到实体」，`evidence` 里要「挂上实体」** —— 两者不是一回事。' +
      '★★ **`type=api` 改契约：走【整块重写】**（T160）—— `op=update` + `data.expected_apis=[{signature,notes?},…]` ' +
      '把该文件的契约列表**整块换掉**。' +
      '★★★ **口径先读清（2026-10-11 用户更正，我上一版把它写反了）**：**不是"不许看旧串"** —— ' +
      '**旧串是你改写的素材**（先 `get_dsl` 把旧块拿来，**在它上面改**），★ **只是别拿它当【定位键】**：' +
      '旧机制 `data.signature` 靠**逐字相等**找目标，一字之差就报「不存在」（**脆**）。' +
      '⇒ 一句话：**定位不绑旧串；内容依据旧串** —— 这才是 `edit_code op=replace` 那句' +
      '"**不信 AI 的行号，不信 AI 的 old_string**"的本意：它防的是"**拿旧文本当定位**"，' +
      '**不是**"不许看旧文本"（★ 我此前把它读成了后者）。' +
      '回执给结构化增删（`data.added/removed/kept`）。' +
      '★ 旧的单条路（`data.signature`=**原签名串逐字** + `data.new_signature`）仍在，但**新写走整块重写**。' +
      '\n★★★ **`operations[]` 各 type 的 `data` 契约**（★ T170：**唯一判据表**在 `dsl_ops/op_data_spec.ts`，' +
      '这里只是**它的渲染**，不新增规则）—— ★ **照这张表填就不会被校验打回**：\n' +
      renderOpSpecs() +
      '\n★ 上面标 "id" 的 type ⇒ `operations[].id` 必填；未标 ⇒ 用 `data` 传参、`id` 可省。' +
      '\n★★ **`data` 是【自由袋子】，但不再沉默**（T174 形状 / **T170c 键名**）——' +
      '**不在上表里的键名会被【拒绝】，并列出该 type 的已知键**（★ 2026-10-11 起；**此前是静默忽略**）；' +
      '形状写错也**会报错**。⇒ ★ **只用上表列出的字段名，并按它的形状填**。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      agent: z
        .string()
        .optional()
        .describe(
          '**身份**（可追溯轴）：发起本次调用的 Agent 的编号/名字 —— 谁在写。' +
            '写进决策卡的 `agent`（与修订历史）。★ 工具**不生成**它，由**调用方**传入（一次调用一个身份）。' +
            '★ 与 `data.author`（**类别** human/llm）是**两个维度**，可同时存在（例：author:\'llm\' + agent:\'agent-07\'）。' +
            '★ 没传 ⇒ 决策照旧落库、但不署名 —— 读端与写回执都会**明标「未署名」**（不静默）。',
        ),
      view: z.enum(['design', 'live']).default('design').describe('视图层级：design=设计视图（默认）；live=实际代码快照，只读，拒绝写入'),
      weight: z
        .enum(['normal', 'routine'])
        .optional()
        .describe('校验强度：normal=全链 L1-L4（默认，防编造证据）；routine=轻量（跳过 L4 证据回溯，日常维护用）'),
      reason: z
        .string()
        .describe(
          '变更原因（活文档必填，经四层校验：非空/非套话/绑定具体实体/证据可回溯）。' +
            '请用一句话说明这次变更为什么发生，并引用具体实体（节点/文件 id、路径、数字指标）。',
        ),
      operations: z
        .array(
          z.object({
            op: z
              .enum([
                'add',
                'update',
                'delete',
                'move',
                'resolve',
                'submit',
                'review',
                'save',
                'rollback',
                'apply',
                'reset',
                'publish',
                'claim',
                'release',
                'complete',
              ])
              .describe(
                '操作：add/update/delete/move 通用；resolve=关闭标注；submit/review=审批；save/rollback/delete=快照；apply=布局；reset=仿真；publish/claim/release/complete=任务格（type=task；★ publish=立卡，内容来自该节点的 decision，**不收** data）',
              ),
            type: z
              .enum([
                'node',
                'edge',
                'file',
                'api',
                'binding',
                'status',
                'annotation',
                'approval',
                'snapshot',
                'layout',
                'simulation',
                'tag',
                'decision',
                'task',
              ])
              .describe(
                '目标类型：node/edge/file/api/binding/status 几何与语义；annotation/approval/snapshot/layout/simulation 协作与整理；tag=功能标记；decision=决策卡写入口（★ **字段清单与形状见描述里的「data 契约」段**；★ 未决分歧进 data.dissent，**不是** data.alternatives）；task=任务格（★ 唯一写端：publish/claim/release/complete；★ publish 把节点的 decision 翻成任务卡）',
              ),
            id: z.string().optional().describe('目标 ID（annotation/approval/snapshot/layout/simulation 可省略，用 data 传参）'),
            data: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .describe('操作列表，按顺序执行，任一失败全部回滚'),
      evidence: z
        .array(
          z.object({
            type: z
              .enum(['trace', 'diff', 'node', 'edge', 'metric'])
              .describe(
                // ★★ 2026-10-11（T176）：**黑盒两轮都卡在这**（T171 第三轮 / T176 第五轮），原话：
                //   *"说明说「ref 要放文件路径」，可选值里却**没有一个叫 `file`**"*
                //   ⇒ ★ 从实现读出真相：`existsFn` = `nodeIds.has(ref)` ∨ `traceResolver.exists(ev)` ∨ `factsOf(ref)`，
                //     而 `traceResolver.exists` **只认 `type==='trace'`** ⇒ ★ **五个值里只有 `node` 与 `trace` 参与判定**；
                //     `diff`/`edge`/`metric` **判定时不加区分** —— 它们是**"文件证据"的共用槽位**。
                "证据类型（★ **取值里【没有】`file`，别去找**）：" +
                  "① `'trace'` = 真实执行记录，`ref` 是**探针名**；" +
                  "② **文件证据** = `ref` 是**仓库相对路径**（程序按 `fileFacts` **现取**事实验证）——" +
                  "★ **填 `diff` 最贴切**（`diff` / `edge` / `metric` 三者判定时**不加区分**，都是「文件证据」的共用槽位）；" +
                  "③ `node` ⇒ `ref` 必须是**节点 id**（几何节点 / `semantic.files` 的文件节点 / 文档节点都算）。" +
                  "★ **改 `semantic.files` 时必须给一条**（走文件证据那类）。",
              ),
            ref: z
              .string()
              .describe(
                "ref：① trace 证据 = 探针名（全名或末段短名），或 '<探针名>@dur>N'（声明该函数实际耗时超 N ms，程序按真实录制事件复算）；" +
                  "② 文件证据 = 该文件的**仓库相对路径**（程序用 fileFacts 现取验证；改 semantic.files 时必填）",
              ),
          }),
        )
        .optional()
        .describe('证据链（L4 回溯）：可选。传入后程序会到 observe 线真实录制的事件（events JSONL）复算验证，查不到或不符则打回'),
    },
    handler: editDslHandler,
  },


  {
    name: 'render_design',
    title: 'Render design DSL to mindmap/SVG/Markdown',
    description:
      '渲染设计 DSL：format=mindmap（默认，现行思维导图架构：root → 目录分组 → 文件；' +
      '目录分组优先读设计视图语义分组容器，其次 feature_tree 功能树）/' +
      'svg（矢量图）/ markdown（可读设计文档）。均用 feature 从存储读取。' +
      '★ 2026-09-30：原 `format=html`（自包含单文件设计画布·星图）**已删除** —— ' +
      '它是 lane 自己标注的"仅调试用"旧路径、渲染效果差，且前端（dsl-workbench）自取数据自行渲染；' +
      'DSL 相关能力不受影响。',
    inputSchema: {
      feature: z.string().describe('feature 名（mindmap/svg/markdown 均从存储读取）'),
      format: z.enum(['mindmap', 'svg', 'markdown']).optional().describe('输出格式，默认 mindmap（现行思维导图架构）'),
      output_path: z.string().optional().describe('输出路径（svg / markdown 用）'),
    },
    handler: renderDesignHandler,
  },





  {
    name: 'consistency_check',
    title: 'Check design-code consistency',
    description:
      '对比 DSL 定义的 expected_apis 与实际代码实现，生成一致性报告（已实现/缺失/签名不匹配/代码新增），' +
      '并验证跨文件不变式。只读检查。' +
      '★ 传 `scope` ⇒ 只在**框定范围内**对账，并把差异折成「**差异块**」' +
      '（块名稳定，由 `formatScope` 生成）—— 这就是"对比现状与设计 ⇒ 分区域重写"里**拿到区别的那一步**。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      code_dir: z.string().optional(),
      scope: z
        .string()
        .optional()
        .describe(
          '可选：**圈定范围**（文法唯一落点在 src/domain/scope.ts）：all | layer:main|error|detail | ' +
            'swimlane:<id> | arch_layer:<id> | subtree:<node_id>[!] | nodes:a,b | files:p1,p2（尾 / 按前缀）。' +
            '★ 不给 = 与原来完全一致（全量报告）；给了 ⇒ 只报该范围内的差异，**且按区域聚成块**。' +
            '★ 块名稳定（同一片区域任何时候同一个名字）⇒ 可当"这块我改过了/还在欠账"的钥匙。',
        ),
      fail_on_violation: z
        .boolean()
        .optional()
        .describe(
          '★ 验收阻断开关（T74）。默认 false = **只报告、退出码恒 0**。' +
            'true ⇒ 若决策卡上的 `expectations` 有**判定为不满足**的，**抛错并让调用方退出非 0**（唯一的失败通路）。' +
            '★ 只对"不满足"阻断；"**判不了（unsupported）**"不计入（否则 Go/Python 上没法用）——' +
            '但判不了的条数会同时出现在报告与抛出的错误里，**不许它悄悄溜过**。',
        ),
    },
    handler: consistencyHandler,
  },

  {
    name: 'detect_drift',
    title: 'Detect live-doc drift against code',
    description:
      '活文档↔代码漂移检测：对比 design DSL 的 expected_apis 与当前代码，判定「设计是否过时 / 是否欠实现」，' +
      '并持久化漂移台账。scope=changed（默认）只看 git 变更文件（相对 since_ref，默认 HEAD=未提交改动），' +
      '圈出「这次改代码引发了哪些漂移」；scope=all 全量对标。mode=check 重新计算（默认），' +
      'mode=status 只读最近一次台账。只读，不改 DSL；要同步设计请用 edit_dsl / import_project。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      code_dir: z.string().optional().describe('代码根目录（默认 feature 的 source_root，手工 DSL 回退 <cwd>/scaffold/<feature>）'),
      scope: z.enum(['changed', 'all']).optional().describe('检查范围：changed=仅 git 变更文件（默认）；all=全量对标'),
      since_ref: z.string().optional().describe('changed 模式 git 参照版本，默认 HEAD（只看未提交改动）'),
      mode: z.enum(['check', 'status']).optional().describe('check=重新计算并写台账（默认）；status=只读最近一次台账'),
    },
    handler: detectDriftHandler,
  },

  {
    name: 'design_line',
    title: 'Design line: six-step reading',
    description:
      '设计链【六步读数】：源码 →① 实际 DB →② 实际 DSL →③ 设计 DSL →④ 人写意图 →⑤ 设计 DB →⑥ 重写回源码。' +
      '每步给 status（ok/missing/pending）+ 该步的执行者 + 一条带数字的读数。★ 只读：不改 DSL、不改源码。' +
      '★ ⑥ 给的是**覆盖差**（设计 DB 份数 / 源码文件数 = 覆盖率，并列出未覆盖数），不再是一句"未实现"；' +
      '要动某一步请用它自己的工具：① import_project · ③ fork-design · ④ edit_dsl / design_intent · ⑤ gen-design-db · ⑥ rewrite。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（含 .agent-io/）'),
      feature: z.string().optional().describe('feature 名（action=report 必填；action=gen-db 省略 = design/ 下全部）'),
      action: z
        .enum(['report', 'gen-db', 'rewrite'])
        .optional()
        .describe(
          'report=六步读数（默认，只读）· gen-db=设计 DSL → 设计 DB（写 certs/design-db/）· ' +
            'rewrite=⑥ 设计 DB → 源码（默认零写入，apply=true 才落盘）',
        ),
      check: z.boolean().optional().describe('★ 仅 action=gen-db：true 只比对不写盘、也不清理陈旧副本'),
      apply: z.boolean().optional().describe('★ 仅 action=rewrite：true 才真落盘（默认零写入；落盘后会自动重算复核）'),
      file: z.string().optional().describe('★ 仅 action=rewrite：只算一个文件（仓库相对路径）'),
      prefix: z.string().optional().describe('★ 仅 action=rewrite：只算某个前缀（如 src/domain/）'),
    },
    handler: wrapData(async (a) => {
      const action = (a.action as string | undefined) ?? 'report';
      if (action === 'gen-db') {
        const r = genDesignDb(String(a.project_dir), {
          feature: a.feature ? String(a.feature) : undefined,
          check: a.check === true,
        });
        const head =
          `设计 DB ${r.check ? '检查' : '生成'} · ${r.features} 个 feature · ${r.files} 个文件节点
` +
          `  ${r.check ? '不一致' : '生成'} ${r.check ? r.problems.length : r.written} · 未变 ${r.unchanged} · 清理陈旧 ${r.pruned}` +
          (r.check ? '' : `\n★ 写盘：certs/design-db/（${r.written} 份有变化）`);
        const tail = r.problems.length
          ? `\n\n★ ${r.problems.length} 个问题：\n` + r.problems.slice(0, 12).map((p) => '    ' + p).join('\n')
          : '';
        return { message: head + tail, data: r };
      }
      if (action === 'rewrite') {
        const r = await rewriteSymbols({
          projectDir: String(a.project_dir),
          feature: a.feature ? String(a.feature) : undefined,
          onlyFile: a.file ? String(a.file) : undefined,
          prefix: a.prefix ? String(a.prefix) : undefined,
          apply: a.apply === true,
        });
        const L: string[] = [
          `════ REWRITE · ${r.feature || '(未指定 feature)'} · ${r.scanned} 份设计 DB ════`,
          '',
          `  ✅ 签名相同          ${r.same}`,
          `  ★★ 签名不同（可重写） ${r.differ.length}`,
          `  ⚠️  不可比（不算一致）  ${r.uncompared}`,
        ];
        for (const [k, n] of Object.entries(r.uncomparedByKind)) L.push(`       · ${k.padEnd(12)} ${n} 条`);
        L.push(`  ✗ 设计有·源码没有    ${r.designOnly}   ← 不可生成（DSL 没有实现，人写）`);
        L.push(`  ✗ 源码有·设计没有    ${r.sourceOnly}   ← 设计漏了（③ sync 的职责）`);
        if (r.differ.length) {
          L.push('', '  ── 待重写（前 12）──');
          for (const t of r.differ.slice(0, 12)) {
            L.push(`
  ${t.file}  ${t.name}（${t.kind}）`);
            L.push(`    - ${t.old_text.slice(0, 110)}`);
            L.push(`    + ${t.new_text.slice(0, 110)}`);
          }
        }
        if (r.applied) {
          L.push('', '  ── 落盘 ──');
          L.push(`  plan_id ${r.applied.plan.plan_id} · ${r.applied.plan.summary.items} 项 / ${r.applied.plan.summary.files} 文件`);
          L.push(
            `  applied ${r.applied.res.applied} · already_applied ${r.applied.res.already_applied} · ` +
              `failed ${r.applied.res.failed} · written=${r.applied.res.written} · ok=${r.applied.ok}`,
          );
          for (const it of r.applied.res.items.filter((x) => x.status !== 'applied')) L.push(`    · ${it.status}  ${it.file}  ${it.error ?? ''}`);
          L.push(`  ★ 复核（落盘后重算）：签名不同 ${r.applied.afterDiffer}  ← 落盘前 ${r.differ.length}`);
        } else if (r.differ.length === 0) {
          L.push('', '  ✓ 没有可重写的签名差异（⑥ 的输入为空）。');
        } else {
          L.push('', '  ★ 零写入。传 apply=true 真落盘（走 buildRefactorPlan 的语法门 + 幂等 apply）。');
        }
        const ok = r.applied ? r.applied.ok : true;
        return { message: L.join('\n'), data: { ...r, ok } };
      }
      const feature = a.feature ? String(a.feature) : '';
      if (!feature) throw new Error('design_line action=report 需要 feature（六步读数是按 feature 读的）');
      return designLineHandler({ project_dir: String(a.project_dir), feature });
    }),
  },

  {
    name: 'import_project',
    title: 'Import a code project as DSL',
    noAutoFresh: true, // 自己做全量导入，前置保鲜纯属浪费
    description:
      '扫描代码项目（.go/.ts/.py/.js 等）生成 DSL：文件节点 + 调用边 + 符号/API 语义层，写入 agent-io 存储。' +
      '★ **默认永不破坏**：· 设计**不存在** ⇒ 建一份（从实际 fork）；· 设计**已存在** ⇒ **只刷新"实际"，完全不碰设计**' +
      '（这就是"有设计就不用动、只对比"）。要重写设计请显式 `rebuild_design=true`（会抹掉人手加的节点 ⇒ 受 `allow_design_drop` 把关）。' +
      '导入后可用 render_design 渲染可视化，或 diff_views / consistency_check 对比设计 vs 实际。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（绝对路径或相对 cwd）'),
      feature: z.string().describe('新 feature 名（^[a-zA-Z0-9_-]+$）'),
      title: z.string().optional().describe('显示标题（默认等于 feature）'),
      max_files: z.number().optional().describe('最多解析文件数（默认 200）'),
      include_tests: z.boolean().optional().describe('是否包含测试文件（默认 false）'),
      include_docs: z
        .boolean()
        .optional()
        .describe(
          '★ **是否把 `docs/**/*.md` 也收成 DSL 节点**（`type: "doc"`，默认 false）—— T88。' +
            '★ 文档是**可读文本、不是源码**（L1 判据）⇒ 它**另立 `doc` 类**，不混进源码文件节点。' +
            '★ 打开它的理由：`harvest_decisions` 采到的决策线索**出处就是 `docs/xxx.md:行号`**，' +
            '而在此之前 **DSL 里 `docs/` 节点 = 0** ⇒ 线索**无处可挂**（"采完就断"）。' +
            '★ 默认 false ⇒ **不改变现有行为**（一个节点都不多）。',
        ),
      include_archive: z.boolean().optional().describe('是否索引归档目录 _archive/archive/_old 等（默认 false）'),
      live_only: z
        .boolean()
        .optional()
        .describe(
          '★ **缺省已变（T77）**：不再给"只生成实际"，而是按"设计有没有"自动定 —— 见 `rebuild_design`。' +
            '显式给 true=**只要"实际"、不碰设计**；显式给 false=写设计（**保留旧语义**，不静默改你的意思）。' +
            '★ 与 `rebuild_design=true` **不能同时给**（矛盾 ⇒ 直接报错）。',
        ),
      rebuild_design: z
        .boolean()
        .optional()
        .describe(
          '★ 显式要求**重建设计 DSL**（T77）。默认 false ⇒ **默认永不破坏**：设计不存在就从实际 fork 一份；' +
            '设计已存在就**只刷新"实际"、完全不碰设计**。' +
            '★ 重建会抹掉"扫描产不出"的节点（人手加的那些）⇒ 受 `allow_design_drop` 把关（默认拒绝并列出）。',
        ),
      allow_design_drop: z
        .boolean()
        .optional()
        .describe(
          '★ 只在重建设计时生效（T77）。默认 false ⇒ 若本次重建会**抹掉"扫描产不出"的节点**（人手加的那些），' +
            '**直接拒绝并列出它们**。true ⇒ 允许丢，但**丢掉了什么会在输出里报出来**。' +
            '★ 为什么默认拒绝：破坏性操作不该是"默认且静默"的（本仓先例：`archive` 拒重复归档、`split_stage` 默认 dry-run）。',
        ),
      live_dir: z.string().optional().describe('live_only 时实际 DSL 归属的项目根（默认 dataHome）'),
      gen_roles: z
        .boolean()
        .optional()
        .describe('true=用 LLM 为文件节点生成中文职责标题（默认 false，未配置 LLM 时静默跳过）'),
    },
    // ★ 回执通道（2026-09-29）：`wrap` → `wrapData`。[B] `importProject` 的
    //   `ImportProjectResult` 带**机器可读的导入读数**（feature / files_parsed / symbols_found /
    //   dep_edges / dirs_created / skipped / cache / bricks_folded）——原 `return { message: r.message }`
    //   把它们在通道层丢掉，agent 只能从散文里正则抠数字（正是 P-A 门记的那类翻车）。
    //   `message` 字段刻意**不放进 data**：[B] 的结果里嵌的就是同一份回执文本，
    //   再塞进 `---DATA---` 只是逐字重复（体积翻倍、零信息增量）。
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      const feature = requireStr(a, 'feature');
      // MCP 路径默认连项目级符号缓存（<project_dir>/.agent-io/cache.db）：
      // 不连则 importProject 走无缓存路径，符号缓存永远不更新（增量 re-parse 失效）。
      // 开库失败（只读目录等）降级为无缓存导入，不阻断导入本身。
      let cacheDb;
      try {
        cacheDb = getProjectCacheDb(path.resolve(project_dir));
      } catch {
        cacheDb = undefined;
      }
      const r = await importProject({ ...(a as unknown as ImportProjectInput), project_dir, feature, cache_db: cacheDb });
      const { message, ...data } = r;
      // ★★★ 2026-10-09（T81 续）：**它是链的起点，必须有自己的产物端口径**。
      //   实测缺口：端到端真跑时 `import_project` 的 `touched` **完全为空** ——
      //   于是"建档 → 写设计 → 对拍"这条链的**第一段根本没有交接物**（只能靠调用方自己记住 feature）。
      //   ★ 只给**与它实际产物相符**的键：
      //     · `feature` = 本次建的那个活文档（就是"我产出了什么"）
      //     · `project_dir` = 本次分析的那个项目根（通用边）
      //   ★ **刻意不给 `written_files`**：它写的是 `<dataHome>` 下的 DSL/存档/索引 ——
      //     按 `Touched.written_files` 的口径「排除工具自有的状态/账本/索引目录」+「写在 dataHome 下的
      //     本就不是仓库相对 ⇒ 从来不给」⇒ **给了就是谎报"我改了源码"**。
      //   ★★★ 2026-10-09 续（**对象类锚点**，T82 的硬前提）：上两个键**都是作用域键**
      //     （`project_dir` / `feature` 在 `CHAIN_EDGES` 里是 `ANY_TOOL → ANY_TOOL`）
      //     ⇒ **不计入对象边** ⇒ `deriveObjectChains()` 里**永远没有 `import_project`**
      //     ⇒ 它是**唯一上不了链的入口**。
      //     实测（`docs/todo.md` T82）：手写 `direct` 里 9 个工具，去掉没上链的 6 个之后
      //     会**削掉 `import_project`（建档=第一步）/ `edit_dsl`（写设计=第二步）/ `capability_map`（导航它自己）**
      //     ⇒ "新人第一站"没了。⇒ 补法 = 让它交出一个**对象类**锚点。
      //   ★ 为什么是 `scope_files` 而不是新造一个键：它**已经存在**，词表已把它的语义定死
      //     （=「**我圈定了 / 要我关注的文件**」，仓库相对）—— 本工具交的是**导入面**。
      //   ★★ **来源枚举与口径的唯一住处 = `domain/b_terms.ts` 的 `scope_files.meaning`** ⇒ 本处**不复述**。
      //     ★ 我第一版在这里又列了一遍"作用面 / 差异面"，并写它是"**同一个语义**" —— 两句都错：
      //       ① 复述 = 同一判断住两处（本仓头号病，我当场复发了一次）；
      //       ② "同一个语义"**有一半是假的**（反伪评审实测）：聚合模式（`functional_mode` / `design_mode`，
      //          ★ 2026-10-09 移除：0 使用 + 有害 T101）下 `get_dsl query=scope` 给的是**逗号串**
      //          （`"src/core/math.ts, src/util/calc.ts"`）/ **目录**（`"src/"`）⇒ 下游硬失败。
      //          详见 `chain_wiring.ts` 这条边的「基准警告」。
      //       本工具交的**能无条件宣称**的只有：**仓库相对的单个文件路径**列表。
      //   ★ 字段名**零翻译**：`[B]` 的 `ImportProjectResult.scope_files` 就叫这个名字 ⇒ 这里直接搬。
      return {
        message,
        data: {
          ...data,
          touched: {
            feature,
            project_dir,
            // ★ 与另外三个产者同形（`handlers.ts:115`/`:219`、`query_feature.ts:778`）：
            //   **没圈到就省略整个键，不给空数组**（空数组会被读成"真的没有文件"）。
            ...(data.scope_files.length ? { scope_files: data.scope_files } : {}),
          },
        },
      };
    }),
  },

  {
    name: 'design_intent',
    title: 'Design intent (why): set directly / propose for human approval — single entry',
    description:
      '「设计意图（why）」统一入口（**2 个注册入口收敛为 1 个入口 + action 分派**；两者操作的是' +
      '**同一个对象**「设计意图 overlay」——`<feature>.overlay.json` 的 goals + edge_intents，' +
      '共用同一锚点参数 feature；action=propose 是 action=set 的"先请人批再落"前置闸）。' +
      'action=set（默认）：直接写 goals（结构化目标/方向，全量替换）与 edge_intents（"A 为何依赖 B" 与边界归属，' +
      '按 base 边 id 或 from+to 匹配挂载）到 overlay，随即 apply 回 base 并保存，让 get_dsl/serve 当下即可读到' +
      '（meta.goals 与 edge.intent），不依赖下一次代码扫描再生。' +
      'action=propose：由 LLM 代拟意图改写提案（把当前意图 vs 将改意图算成 before/after 预览）进入人工审批闸门，' +
      '**不写盘不碰 DSL**；人在工作台「代码审批」页签 approve 后才真正写入 overlay + base。' +
      '★ 何时用哪个：确定要改、无需人拍板 → action=set 直接落；"改 why / 方向"这类应由人决策的变更 → action=propose。' +
      '★ 安全策略前移（与"人只做决策审批、LLM 只做提案转述"的分层一致）：propose **永不直接落盘**；' +
      'project_dir 是审批台账的隔离桶名，应与人当前查看的项目一致，提案才会出现在他的审批列表里。',
    inputSchema: {
      action: z
        .enum(['set', 'propose'])
        .default('set')
        .describe('set=直接写盘落 DSL（默认，get_dsl 当下可读到） | propose=只算 before/after 提案等人工审批，不写盘'),
      feature: z.string().describe('feature 名（2 个 action 共用锚点）'),
      goals: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string().describe('目标一句话'),
            description: z.string().optional(),
            status: z.enum(['active', 'done', 'parked', 'dropped']).optional().describe('active=推进中/done=完成/parked=暂缓/dropped=放弃'),
          }),
        )
        .optional()
        .describe('结构化目标/方向（全量替换；空数组=清空）—— 2 个 action 共用'),
      edge_intents: z
        .array(
          z.object({
            id: z.string().optional().describe('目标 base 边 id（优先于 from+to）'),
            from: z.string().optional().describe('源节点 id（无 id 时用 from+to 定位边）'),
            to: z.string().optional().describe('目标节点 id'),
            reason: z.string().optional().describe('A 为何依赖 B'),
            boundary: z.string().optional().describe('边界归属说明'),
            requires: z
              .array(z.string())
              .optional()
              .describe(
                '任务前置（显式声明）：引节点 id，须先 progress=done 才准改本边**源节点(from)**的源码（write_gate 拦）。' +
                  '★ 不传=不拦（edge 的 import 依赖 ≠ 任务前置）；[]=解除',
              ),
            status: z.enum(['open', 'resolved']).optional(),
          }),
        )
        .optional()
        .describe('边级意图：按 base 边 id 或 from+to 匹配挂载 reason/boundary —— 2 个 action 共用'),
      project_dir: z.string().optional().describe('propose 用：审批台账的隔离桶名（查看 PR 的项目目录）；缺省取 feature 的 source_root'),
      agent: z
        .string()
        .optional()
        .describe(
          'propose 用：**提议者身份**（会话 id / Agent 编号 / 系统名）—— ★ 会被记进 PR 的 `submitter`，' +
            '供接手方判"**是不是自己在批自己**"（T186 起"不许自批"是硬守卫）。不传 ⇒ 落库但**未署名**（读端会明标）。',
        ),
    },
    handler: wrapData(async (a) => {
      const action = (a.action as 'set' | 'propose' | undefined) ?? 'set';
      const feature = requireStr(a, 'feature');
      const goals = Array.isArray(a.goals) ? (a.goals as unknown[]) : undefined;
      const edgeIntents = Array.isArray(a.edge_intents) ? (a.edge_intents as unknown[]) : undefined;

      if (action === 'set') {
        // set：直接落盘。[B] 自己处理"两类都没传 = 无改动"（与旧 set 入口逐字同义）。
        const r = setDesignIntent({ feature, goals: goals as never, edge_intents: edgeIntents as never });
        return { message: r.message, data: r };
      }

      if (action === 'propose') {
        // propose：只算提案、永不落盘（[B] proposeChange 落 pending 审批卡）。
        // 旧 propose 入口的 [C] 编排原样搬到这里（同一份逻辑，不再有第二处）。
        if (!goals && !edgeIntents) throw new Error('至少传 goals 或 edge_intents 之一');
        let project_dir = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : '';
        if (!project_dir) {
          const dsl = getDSL(feature);
          project_dir = requireProjectRoot({ 'dsl.source_root': dsl?.source_root });
        }
        const r = await proposeChange({
          kind: 'dsl_intent',
          project_dir,
          op: { feature, goals: goals as never, edge_intents: edgeIntents as never },
          // ★★★ T186：**记下"谁提的"** —— 此前这里写死 `'llm'`（**类别**，不是身份）
          //   ⇒ 接手方**无法回答"这条是不是我自己提的"** ⇒ "不许自批"那条守卫形同虚设。
          //   ★ 现在：调用方给了 `agent`（身份）就用它；**没给就如实留空**（不编一个假身份 —— 读端会明标"未署名"）。
          ...(typeof a.agent === 'string' && a.agent.trim() ? { submitter: a.agent.trim() } : {}),
        });
        if (!r.ok) throw new Error(r.error ?? '提案失败');
        const c = r.change;
        const message = [
          `已提出设计意图改写审批卡（pending，未写盘）：`,
          `  提案：${c.label}`,
          ...(c.summary ?? []).map((s) => `  · ${s}`),
          `  预览：`,
          ...(c.preview ?? '').split('\n').map((l) => `    ${l}`),
          ``,
          ``,
          // ★★★ T186（2026-10-12 用户裁定）：**确认人不是人，是下一个接手的 Agent**。
          //   ★ 这句话以前写的是"**人**将在工作台「代码审批」页签看到"⇒ 与新方向**相反**，必须改
          //     —— 否则接手方读到它，会以为"这不该我管，等人去点"。
          `★ 这条 PR **等【下一个接手的 Agent】确认**（不是等人去点工作台）：` +
            `接手方先 \`review_changes action=list\` 看见它，再 \`action=show\` 看全文与意见栈；` +
            `拿不准就**开会**（别的会话 \`action=comment\` 各留意见），最后由某个会话 \`approve\` / \`reject\`。`,
          `★ \`approve\` 后 goals/边意图才真正写入 DSL；\`reject\` 则丢弃。` +
            `★ **必须署名，且不许自批**（提议人 ≠ 确认人）—— 见 \`review_changes\`。`,
        ].join('\n');
        return {
          message,
          data: { action, ok: true, project_dir, proposal: { id: c.id, kind: c.kind, label: c.label, summary: c.summary, diffs: c.diffs, preview: c.preview, status: c.status } },
        };
      }

      throw new Error(`design_intent: 未知 action "${String(action)}"（可选值：set / propose）`);
    }),
  },
];
