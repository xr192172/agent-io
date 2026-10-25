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
// ★★★ 2026-10-22：OPL（Optimization Pipeline Loop）此前**只有 HTTP 入口**（`POST /api/opl`）——
//   它是「你提一条愿望，产线自驱推进到收敛」的 **LLM 驱动产线**，却让模型调不到自己该用的东西。
//   ⇒ 补成工具：注册一次，MCP / CLI / HTTP(`/api/tool/opl`) 三面同时获得。
import {
  oplAdd,
  oplAuto,
  oplLocate,
  oplDeclare,
  oplImplement,
  oplCheck,
  oplIntegrate,
  oplList,
  type OplState,
} from './derive/opl.js';
// ★ T170：`operations[]` 各 type 的 data 契约表（**唯一判据**）—— edit_dsl 描述里那段就是它的渲染。
import { renderOpSpecs } from './dsl_ops/op_data_spec.js';
// ★★★ 2026-10-23（批注层退场）：`APPROVAL_STATUSES` / 审批能力一并删除。
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb } from '../../infrastructure/index/db.js';
import { getDSL, requireProjectRoot } from '../../infrastructure/storage.js';

import { importProject } from '../../infrastructure/graph/import_project.js';
import type { ImportProjectInput } from '../../infrastructure/graph/import_project.js';
// ★ T15 切片（2026-10-05）：把「混合文件解耦」这对能力从 CLI 面接进 MCP 面 ——
//   两者共用同一批 application 层核心（与 `brickify_cli` 同源；`split_stage_cli` 已于 2026-10-06 删除），CLI 只是 argv 薄壳。
import { setDesignIntent } from './intent/set_design_intent.js';
import { consistencyHandler, detectDriftHandler, editDslHandler, getDslHandler, renderDesignHandler } from './handlers.js';
import { designLineHandler, briefHandler } from './line/design_line.js';
import { genDesignDb } from './db/gen_design_db.js';
import { rewriteSymbols } from './rewrite/rewrite.js';
import { gateHumanLines } from '../refactor/gate_note.js';
import { designDiff } from './line/design_diff.js';

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
      'history（**历史**：已经结束的卡（done / void）由 `todo.move_to_history` **移出 `todos[]`**，住**项目级独立库** ' +
      '`.agent-io/task-history.db` 的 `task_history` 表（★ 不参与 `cache.db` 的索引重建 ⇒ 重建不会让它少一行）；' +
      '每行含**整张卡原样** `card_json`（evidence / retire_reason 都在）与入史理由；可按 state / card_id / search / limit 过滤；' +
      '★ 2026-10-24 起**概览/详情两级**：缺省 data.items 只给概览行（id/state/moved_at/summary 首行），整卡仅 detail=true 或 card_id 精查时随 data 返回）/ ' +
      'overview（**跨库总账**：一眼全貌 —— 每个 feature 一行 活卡/done/void/归档/history/欠账 计数，只读派生不落盘）/ ' +
      'pending（**欠账视图**：★ 只读**直读 overlay 权威**（`<feature>.overlay.json` 锚点的 `progress`），' +
      '列出所有**未完成**锚点（`progress !== \'done\'`；★ **未登记 progress 的锚点不算欠账**）；' +
      '每项出 `id/path/progress/progress_evidence`，决策卡带 `scope`（T329）时一并出 `decision_scope`；' +
      '★ 口径「欠账=progress!=done」· 来源=overlay 权威（**不是** base 的投影 `status`）· 每次现算**不落盘**）。' +
      'view: design（默认，活态设计）/ live（实际代码快照，仅 query=dsl/nodes/edges/node/files/file 生效，用于对比设计 vs 代码现状）。',
    inputSchema: {
      query: z
        .enum(['dsl', 'features', 'nodes', 'edges', 'node', 'decisions', 'files', 'file', 'digest', 'scope', 'calls', 'functions', 'annotations', 'approvals', 'approval_history', 'snapshots', 'templates', 'simulation_state', 'diff', 'goals', 'edge_intents', 'tag', 'pool', 'todo', 'history', 'pending', 'overview'])
        .describe('查询类型：dsl=完整DSL, features=feature列表, nodes=节点摘要, edges=边摘要, node=节点详情, decisions=决策目录(按功能线分组), files=文件摘要, file=文件详情, digest=每文件一行紧凑认知索引(F职责/R关系/A契约/S高熵决策,只读派生), scope=**圈定范围**(按 layer/swimlane/arch_layer/subtree/files 解析成确定的文件集合,只读派生), calls=调用关系, functions=函数级大纲(目录→文件→函数+调用/被调用/回环), annotations=标注, approvals=**按审批状态看【全部】批注**（★ 默认含未提交的 `draft`；只要待审批的用 `status="pending_review"`）, approval_history=审批历史, snapshots=快照, templates=模板, simulation_state=仿真状态, diff=对比, goals=结构化目标(meta.goals), edge_intents=边级意图(edge.intent), tag=功能标记(人给文件节点打的"隶属某功能"标签:给 tag=成员+失联,省略=列全部标签), pool=**任务池**(把各节点上的 task 卡按状态归拢成池:candidate/claimed/done/void 各几张,只读派生;★ feature 不存在会抛,不返回空池), todo=**todo 待办列表**(顶层 `todos[]` —— ★ 默认只列**活卡** candidate+claimed：已完成 done 与**已作废 void**（`todo.retire` 落的）**不在待办里**；要看它们传 `state=done|void|all`；每项出 id/summary/state/owner/node_id/follows/retire_reason/history **与链位置**（环 n/m · 上一环 = follows），并附**墓碑**（物理删过的卡）；传 `chain=true` ⇒ 按继任链分组展示，history=**历史**(已了结 done/void 的卡由 todo.move_to_history 移出 todos[]，住**项目级独立库** `.agent-io/task-history.db` 的 task_history 表 —— ★ 不参与 cache.db 重建；可按 state/card_id/search/limit 查，每项含**整张卡原样** card_json 与入史理由), pending=**欠账视图**(只读直读 overlay 权威:列未完成锚点 progress!=done,含 progress_evidence 与决策卡 scope;★ 未登记 progress 的锚点不算欠账,不落盘), overview=**跨库总账**(一眼全貌:每个 feature 一行 活卡/done/void/归档/history/欠账 计数,只读派生不落盘;欠账口径与 pending 同一函数)' +
        // ★★★ I1（2026-10-25）：**expectation kinds 字段表进 schema**（此前只住在 domain/expectation.ts 的
        //   类型注释里，agent 在 MCP 面看不见 ⇒ 写判据只能试错）。★ 这里是**渲染**：判据唯一落点仍是
        //   `domain/expectation.ts` 的 `Expectation` 联合 + `assertValidExpectations`，不新增规则。
        '\n\n★ **判据 kinds 字段表**（decision.expectations / expectation.add 用；`why` **必填**——说不出理由的验收没人敢删）：\n' +
        '  · file-exists={path, why}　· symbol-exists={path, symbol, why}　· signature-matches={path, symbol, signature, why}\n' +
        '  · edge-exists / edge-absent={from, to, why}　· call-exists={path, symbol, target, why}\n' +
        '  · source-has={path, must?/mustNot?, why} —— **纯子串**匹配（注释里出现也算，写 must 时避开）\n' +
        '  · run={input?, expect, why} —— **不执行命令，只求值表达式**（求值域只有 input/root/validateDSL/fs/path 池子，判定器见 judgeExpectations）\n' +
        '  · behavior-cases={path, symbol, cases:[{given, expect}], why}'),
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
      // ★★ 2026-10-21：`query=todo` 的**按 state 过滤**（规则：**retire 之后必须不在待办里** + **要能按 state 过滤**）。
      //   ★ 缺省 = 待办（只列活卡）—— 判据在 `query_feature.ts` 的 `case 'todo'`（读 `isClosedTaskState`），这里只声明值域。
      state: z
        .enum(['candidate', 'preparing', 'claimed', 'done', 'void', 'all'])
        .optional()
        .describe(
          'query=todo 时：按状态过滤。缺省 = **待办**（只列活卡 candidate/preparing/claimed；' +
            'done 与已作废的 void **不在待办里**）。all = 全部（含已了结）。' +
            '★ preparing = 领了但**还不能干**（两段式第一段：判据没补全）。' +
            '★ 想看「谁被作废了、为什么」⇒ state=void（每项带 retire_reason / retired_at）。',
        ),
      // ★★★ 2026-10-21：`query=todo` 的**按继任链分组**（跑环：一环 → 二环 → 三环）。
      //   ★ 为什么是参数而不是新 query 值：`todos[]` 只有这一个读端，多一个 query 值 = 同一份数据两条路
      //     （迟早有一条忘了改）；这里只是**同一个列表的另一种排法**。
      chain: z
        .boolean()
        .optional()
        .describe(
          'query=todo 时：true = **按继任链分组**展示（每条链一块：主链逐环一行 ✔ 1/3 done / ▶ 2/3 claimed，' +
            '支环缩进在它分出来的那一环下面，未接链的卡最后单列）。缺省 = 平铺列表 + 每张卡的「环 n/m · 上一环 x」徽标。' +
            '★ 链由 todo 的 follows（上一环的 todo id）串起来；★ 上一环作废只**标注**、不级联作废。',
        ),
      // ★★★ 2026-10-23（history 表）：历史读端的三个过滤键（`state` 复用上面那个）。
      card_id: z.string().optional().describe('query=history 时：按**卡 id 精确**查（模糊查用 search）'),
      search: z
        .string()
        .optional()
        .describe('query=history 时：在 summary / card_json 里做**子串**匹配（「要查就搜索 history」）'),
      limit: z.number().optional().describe('query=history 时：最多返回几条（默认 20，上限 500）'),
      // ★★★ 2026-10-24（概览/详情两级）：history 缺省只给概览行；整卡原样按需取。
      detail: z.boolean().optional().describe('概览/详情两级开关：query=history 缺省概览行（card_id 精查总给整卡）；query=todo / query=decisions 缺省概览行，true = 附整卡全字段（修订史/读集/rationale 等）'),
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
        .describe('★ 2026-10-23（批注层退场）：query=approvals 已删除，本字段不再有用。'),
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
            /**
             * ★★★ 2026-10-19：**这里原先是硬编码的 `z.enum([...])`** —— 而合法 op 的真判据只有一处：
             *   `op_data_spec.ts` 的 `OP_SPECS`（`checkOpSpec` 按 type 查表，报错会列出全部合法值）。
             *
             * 两份枚举**已经漂了**：schema 里缺 `void`（OP_SPECS 有）⇒ `void` 根本调不通，
             * 而报错只说"类型/取值不符：operations"，**不说是哪个 op**。
             * ⇒ 收敛成 `z.string()`：判据回到一处，报错由 `checkOpSpec` 给（它列合法值 + 指路）。
             *   ★ 代价：MCP 面的"可选项自动补全"没有了 —— 但那份可选项本来就是**第二份判据**。
             */
            op: z
              .string()
              .describe(
                '操作名（★ 合法值**按 type 不同**，唯一判据 = op_data_spec.ts 的 OP_SPECS；' +
                  '填错会由 checkOpSpec 报出该 type 的全部合法值）。' +
                  '例：node/edge/file/api 用 add/update/delete/move；task 用 publish/claim/release/complete/void/reopen/relaunch',
              ),
            /**
             * ★★★ 2026-10-20：**与 `op` 同病** —— 这里原是硬编码 `z.enum([...])`，
             *   而合法 type 的真判据只有 `OP_SPECS`（`checkOpSpec` 按 op 查表）。
             *   漂的证据：**`todo` 在 OP_SPECS 里有、这个枚举里没有** ⇒ 加 todo 的入口根本调不通。
             *   ⇒ 收敛成 `z.string()`，报错交给 `checkOpSpec`（它列合法值 + 指路）。
             *   ★ 这是同一天内第二处「硬编码枚举 vs OP_SPECS 各持一份」—— 上一处是 `op`。
             */
            type: z
              .string()
              .describe(
                '目标类型（★ 合法值**按 op 不同**，唯一判据 = op_data_spec.ts 的 OP_SPECS；' +
                  '填错会由 checkOpSpec 报出该 op 的全部合法 type）。' +
                  '例：op=add 时 type 可为 node/edge/file/api/tag/decision/task/todo',
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
      '并持久化漂移台账。scope=changed（默认）只对 git 变更命中的在册文件下判定（相对 since_ref，默认 HEAD=未提交改动），' +
      '★ 其余在册文件**未判存量漂移** —— 回执会显式声明缺口数（机读字段 `unchecked_ledger_files`），存量请 scope=all 全量对标。' +
      'mode=check 重新计算（默认），mode=status 只读最近一次台账。只读，不改 DSL；要同步设计请用 edit_dsl / import_project。',
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
      '设计链【六步读数】：源码 →① 实际 DB →② 实际 DSL →③ 设计 DSL →④ 人写意图 →⑤ 设计 DB →⑥ 设计签名 → 源码。' +
      '每步给 status（ok/missing/pending）+ 该步的执行者 + 一条带数字的读数。★ 只读：不改 DSL、不改源码。' +
      '★ ⑥ 给的是**覆盖差**（设计 DB 份数 / 源码文件数 = 覆盖率，并列出未覆盖数），不再是一句"未实现"；' +
      '要动某一步请用它自己的工具：① import_project · ③ fork-design · ④ edit_dsl / design_intent · ⑤ gen-design-db · ⑥ sync-signatures。' +
      '★ ⑥（`sync-signatures`，旧名 `rewrite`）**只把函数签名同步回源码**：不生成实现体、不新增/删除符号、不新建文件。' +
      '它的结论是机器可判的 —— `did_work`（本次是否真有差异被 apply）+ `reason`（没做事时是哪种：path_not_found / no_design_copy / uncomparable_kind / no_diff / …）。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（含 .agent-io/）'),
      feature: z.string().optional().describe('feature 名（action=report 必填；action=gen-db 省略 = design/ 下全部）'),
      action: z
        .enum(['report', 'brief', 'gen-db', 'sync-signatures', 'rewrite', 'diff'])
        .optional()
        .describe(
          'report=六步读数（默认，只读）· brief=开工简报（一个节点/文件：设计要什么 + 实际有什么 + 差在哪；只读）· ' +
            'gen-db=设计 DSL → 设计 DB（写 design-db/）· ' +
            'sync-signatures=⑥ 设计 DB → 源码，**只同步函数签名、不生成实现**（默认零写入，apply=true 才落盘）· ' +
            'rewrite=同一动作的旧名（保留兼容；输出里的 did_work/reason 一致）',
        ),
      check: z
        .boolean()
        .optional()
        .describe(
          '★ 仅 action=gen-db：true 只比对不写盘、也不清理陈旧副本。★ 回执把两种红分开：' +
            '`真冲突`（两个 feature 对同一文件要求互斥 ⇒ 该改设计，重跑修不好）vs `投影陈旧`（该重跑）。' +
            '★ 它比的是整份字节（含 cache.db 的事实）⇒ 它是**诊断**；可复现的那一半另有一道门：`node scripts/gen-db-check.mjs`。',
        ),
      apply: z.boolean().optional().describe('★ 仅 action=sync-signatures/rewrite：true 才真落盘（默认零写入；落盘后会自动重算复核）'),
      file: z.string().optional().describe('★ 仅 action=sync-signatures/rewrite：只算一个文件（仓库相对路径）'),
      prefix: z.string().optional().describe('★ 仅 action=sync-signatures/rewrite：只算某个前缀（如 src/domain/）'),
      node_id: z.string().optional().describe('★ 仅 action=brief：要看哪个节点（几何节点 id）；给了就用它定位文件与决策卡'),
      path: z.string().optional().describe('★ 仅 action=brief：也可以直接给仓库相对路径（node_id 与 path 二选一）'),
    },
    handler: wrapData(async (a) => {
      const action = (a.action as string | undefined) ?? 'report';
      if (action === 'gen-db') {
        const r = genDesignDb(String(a.project_dir), {
          feature: a.feature ? String(a.feature) : undefined,
          check: a.check === true,
        });
        const head =
          `设计 DB ${r.check ? '检查' : '生成'} · ${r.features} 个 feature · ${r.paths} 份投影（${r.files} 个文件节点）
` +
          `  ${r.check ? '不一致' : '生成'} ${r.check ? r.drift.length : r.written} · 真冲突 ${r.conflicts.length} · 未变 ${r.unchanged} · 清理陈旧 ${r.pruned}` +
          (r.check ? '' : `\n★ 写盘：design-db/（${r.written} 份有变化）`);
        // ★ 2026-10-20：**两类红分开报** —— 真冲突重跑修不好（该改设计），陈旧投影重跑就绿。
        //   此前两者挤在 `problems` 里一句「与当前设计不一致」，于是"23 条红"里到底是什么，没人能说。
        const tail = [
          r.conflicts.length
            ? `\n\n★ ${r.conflicts.length} 条真冲突（该改设计 —— 重跑生成器修不好）：\n` +
              r.conflicts.slice(0, 12).map((p) => '    ' + p).join('\n')
            : '',
          r.drift.length
            ? `\n\n⚠ ${r.drift.length} 条投影与设计/事实不一致（该重跑生成器）：\n` +
              r.drift.slice(0, 12).map((p) => '    ' + p).join('\n')
            : '',
          r.problems.length ? `\n\n★ ${r.problems.length} 个问题：\n` + r.problems.slice(0, 12).map((p) => '    ' + p).join('\n') : '',
          r.check && !r.conflicts.length && !r.drift.length && !r.problems.length
            ? '\n\n★ 一致：设计侧的每一条判据都已进 design-db，且没有两个 feature 对同一文件提出互相矛盾的要求。'
            : '',
        ]
          .filter(Boolean)
          .join('');
        return { message: head + tail, data: r };
      }
      if (action === 'sync-signatures' || action === 'rewrite') {
        const r = await rewriteSymbols({
          projectDir: String(a.project_dir),
          feature: a.feature ? String(a.feature) : undefined,
          onlyFile: a.file ? String(a.file) : undefined,
          prefix: a.prefix ? String(a.prefix) : undefined,
          apply: a.apply === true,
          // ★★★ 2026-10-22（写闸覆盖面 · 第 3 条入口）：身份与授权一路传到底。
          //   此前这里**没有这两行** ⇒ `rewriteSymbols → applyRefactorPlan → editCode` 那条链
          //   在最后一跳丢了身份，闸只能看 env（生产面 stdio 没有 env ⇒ 恒不设防）。
          //   ★ 与其它写工具同一写法：只**交上去**，解释它们的是写闸。
          actor: typeof a.actor === 'string' && a.actor ? a.actor : undefined,
          authorize: typeof a.authorize === 'string' && a.authorize ? a.authorize : undefined,
        });

        const L: string[] = [
          `════ SYNC-SIGNATURES（原 REWRITE · 只同步签名，不生成实现）· ${r.feature || '(未指定 feature)'} · ${r.scanned} 份设计 DB ════`,
          '',
          `  ★ did_work=${r.did_work} · reason=${r.reason ?? '(null：本次有差异被 apply)'}`,
        ];
        if (r.gate) L.push(`  ★ 被拦截于 ${r.gate.stage}：一个字节都没落盘`);
        L.push(
          '',
          `  ✅ 签名相同          ${r.same}`,
          `  ★★ 签名不同（可重写） ${r.differ.length}`,
          `  ⚠️  不可比（不算一致）  ${r.uncompared}`,
        );
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
        if (r.gate) {
          // ★ 标准信封：表头已给、data 随 ---DATA--- 出去、退出码非零（见本段 return）
          L.push('', `  ✗ 拦截原因（${r.gate.stage}）：`);
          for (const ln of r.gate.error.split('\n').slice(0, 16)) L.push(`    ${ln}`);
          if (r.gate.error.split('\n').length > 16) L.push('    …（完整原文见 data.gate.error）');
        } else if (r.applied) {
          L.push('', '  ── 落盘 ──');
          L.push(`  plan_id ${r.applied.plan.plan_id} · ${r.applied.plan.summary.items} 项 / ${r.applied.plan.summary.files} 文件`);
          L.push(
            `  applied ${r.applied.res.applied} · already_applied ${r.applied.res.already_applied} · ` +
              `failed ${r.applied.res.failed} · written=${r.applied.res.written} · ok=${r.applied.ok}`,
          );
          for (const it of r.applied.res.items.filter((x) => x.status !== 'applied')) L.push(`    · ${it.status}  ${it.file}  ${it.error ?? ''}`);
          L.push(`  ★ 复核（落盘后重算）：签名不同 ${r.applied.afterDiffer}  ← 落盘前 ${r.differ.length}`);
          if (r.reason) L.push(`  ★ 一条也没落盘：reason=${r.reason}（判据见 rewrite.ts 的 RewriteReason）`);
        } else if (r.reason === 'path_not_found') {
          L.push('', `  ✗ 路径不存在：${String(a.file ?? '(未给 file)')}`);
          L.push('     ⇒ 这不是「没差异」：根本没有可比的源码文件。');
        } else if (r.reason === 'no_design_copy') {
          L.push('', '  ✗ 设计 DB 没有这份文件的副本（design-db/ 里没有它）⇒ 无可比对。');
          L.push('     ⇒ 不是「没差异」；先用 ③ sync 设计 / ⑤ gen-design-db 补副本。');
        } else if (r.reason === 'uncomparable_kind') {
          const kinds = Object.keys(r.uncomparedByKind).join(' / ') || 'const / interface / type / class';
          L.push('', `  − 符号全是**不可比**类型（${kinds}）⇒ 这个文件的签名差异**永远发现不了**。`);
          L.push('     ⇒ 不是「没差异」；判据见 symbol_diff 的 COMPARABLE（只有 function 比 signature）。');
        } else if (r.reason === 'not_applied') {
          L.push('', `  ★ ${r.differ.length} 条签名差异，但零写入（apply=false）。传 apply=true 真落盘。`);
        } else if (r.reason === 'no_diff') {
          L.push('', '  ✓ 比过了：没有签名差异。');
        }
        // ★★★ 2026-10-22（写闸覆盖面 · 回执线）：闸的读数进**人读消息** ——
        //   与其它四条写路（edit_code / rename_file / rename_files / symbol_move / apply_refactor_plan）
        //   同一句话：`gateHumanLines`（不在这里另写渲染）。机器侧字段是 `data.task_gate`（随 `...r` 出去）。
        const gateLine = gateHumanLines(r.task_gate);
        if (gateLine) L.push(gateLine);

        // ★ `ok` = 「这次调用/这次 apply 有没有失败」。`path_not_found` 是调用方写错了路径 ⇒ 明确 false
        //   （「设计 DB 没副本」「真的没差异」仍是 true：那不是失败，是**世界就是这样**）。
        const ok = r.gate ? false : r.applied ? r.applied.ok : r.reason !== 'path_not_found';
        // ★ 被闸拦截 ⇒ 仍走标准信封，但**退出码非零**（经 wrapData 透传 isError）——
        //   脚本据此区分「没写成」与「做成了」，不必人读中文。
        return { message: L.join('\n'), data: { ...r, ok }, ...(r.gate ? { isError: true } : {}) };
      }
      if (action === 'diff') {
        const f = a.feature ? String(a.feature) : '';
        if (!f) throw new Error('design_line action=diff 需要 feature（diff 是按 feature 读两份 DSL 的）');
        const d = designDiff(String(a.project_dir), f);
        const L: string[] = [
          `════ 设计侧 × 实际侧 diff · ${f} ════`,
          `设计 ${d.designNodes} 节点 · ${d.designEdges} 边    实际 ${d.liveNodes} 节点 · ${d.liveEdges} 边`,
          '',
          `+ 只在设计侧（设计了、实际还没有）：${d.onlyDesign.length} 个`,
          ...d.onlyDesign.slice(0, 20).flatMap((id) => {
            // ★ 每条「只在设计侧」都带 `must_have`（该文件/目录**必含的符号**）：
            //   LLM 写实现（`edit_code op=symbol`）不必再从 scope / 边里猜"该建哪些函数"。
            //   列不出时**明说** `must_have: []` + `why_empty` —— 不许静默空。
            const mh = d.mustHave.find((m) => m.id === id);
            if (!mh) return [`    + ${id}`];
            const head = `    + ${id}${mh.kind === 'dir' && mh.drilled?.length ? `（下钻 ${mh.drilled.length} 个文件）` : ''}`;
            if (!mh.must_have.length) {
              return [head, '        must_have: []', `        why_empty: '${String(mh.why_empty ?? '(未说明)')}'`];
            }
            const shown = mh.must_have.slice(0, 24).map((s) => {
              const tag = s.kind && s.kind !== 'type' && s.kind !== 'symbol-exists' ? `(${s.kind})` : '';
              return s.name + tag + (mh.kind === 'dir' && s.file ? ` ← ${s.file}` : '');
            });
            const more = mh.must_have.length > 24 ? [`        …共 ${mh.must_have.length} 个（完整清单见 data.mustHave）`] : [];
            return [head, `        must_have: ${shown.join(', ')}`, ...more];
          }),
          `- 只在实际侧（实际有、设计没收录）：${d.onlyLive.length} 个`,
          ...d.onlyLive.slice(0, 20).map((id) => `    - ${id}`),
          `~ 两边都有但内容不同：${d.changed.length} 个`,
          ...d.changed.slice(0, 20).map((c) => `    ~ ${c.id}  [${c.fields.join(',')}]`),
          '',
          `边：扫描遗漏 ${d.missedEdges.length} · 真要建 ${d.realMissingEdges.length} · 只在实际侧 ${d.onlyLiveEdges.length}`,
        ];
        return { message: L.join('\n'), data: d };
      }
      if (action === 'brief') {
        const feature = a.feature ? String(a.feature) : '';
        if (!feature) throw new Error('design_line action=brief 需要 feature');
        if (!a.node_id && !a.path) throw new Error('design_line action=brief 需要 node_id 或 path（要看哪个节点/文件）');
        return await briefHandler({
          project_dir: String(a.project_dir),
          feature,
          ...(a.node_id ? { node_id: String(a.node_id) } : {}),
          ...(a.path ? { path: String(a.path) } : {}),
        });
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
      const action = (a.action as 'set' | undefined) ?? 'set';
      const feature = requireStr(a, 'feature');
      const goals = Array.isArray(a.goals) ? (a.goals as unknown[]) : undefined;
      const edgeIntents = Array.isArray(a.edge_intents) ? (a.edge_intents as unknown[]) : undefined;

      // ★ 2026-10-22 PR 式退役：本工具只剩 set（propose 分支已删，走 publish 立卡）
      const r = setDesignIntent({ feature, goals: goals as never, edge_intents: edgeIntents as never });
      return { message: r.message, data: r };


    }),
  },
  {
    name: 'opl',
    title: 'OPL 自驱产线：一条愿望推进到收敛（add → locate → declare → implement → check → integrate）',
    description:
      'OPL = Optimization Pipeline Loop。你只提一条愿望（`action=add` 给 `idea`），产线自驱推进：' +
      '定位真实文件（locate）→ 出契约并写进设计 DSL（declare）→ 按契约写实现（implement）→ ' +
      '真 DSL 比较（check：accepted / drift / missing，★ **结构判定零 LLM**，解析真实源码签名）→ 归并（integrate）。' +
      '`action=auto` 是一键闭环（无 id 时给 idea 会自动 add）；其余 action 用于**单步推进与回滚**（每一步都可单独触发）。' +
      '`action=list` 列出该 feature 的所有 OPL 条目（只读）。' +
      '★ 为什么它是工具而不只是前端的一个按钮：它是**给 agent 用的产线** —— 决定"做什么、怎么收敛"的是模型自己，' +
      '前端只是它的投屏。此前它只有 HTTP 入口，模型根本调不到（2026-10-22 补成工具）。' +
      '★ 未配 LLM 时降级为规则路径（`mode=rule`），仍能推进，但契约以代码事实为准。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      action: z
        .enum(['add', 'auto', 'locate', 'declare', 'implement', 'check', 'integrate', 'list'])
        .describe('产线阶段。auto = 一键闭环；list 只读'),
      id: z.string().optional().describe('OPL 条目 id（除 add / list 之外的 action 都需要）'),
      idea: z.string().optional().describe('愿望原文（action=add 必填；action=auto 无 id 时也用它自动建条）'),
    },
    handler: wrapData(async (a) => {
      const feature = requireStr(a, 'feature');
      const action = requireStr(a, 'action');
      const id = a.id ? String(a.id) : '';
      const idea = a.idea ? String(a.idea) : '';
      // ★ 不暴露 `files`：`OplDeclFile` 要 {path, lang, apis[]}，让模型自己填 `apis` 就是
      //   让它替 declare 干它该干的事（而且会填出空契约 = 假绿）。目标文件由 `locate` 推导。
      //   （顺带：HTTP 那条 `/api/opl` 一直把 `params.files` 原样传进来 —— 类型上根本对不上，
      //    这正是「HTTP 面没有 schema 校验」的实证。）

      /** 回执首行必须自足（本仓纪律）：一眼看出是哪一条、到哪一步、集成了没 */
      const summarize = (st: OplState): string =>
        `OPL ${st.id}「${st.title}」：状态=${st.status} · 模式=${st.mode} · ` +
        `声明 ${st.decl.length} 文件 · 实测 ${st.live.length} · ${st.integrated ? '已集成' : '未集成'}`;

      /** oplog 只报最后 5 步（它是"人观察每一步做了什么"的痕迹，全量会淹掉回执） */
      const withLog = (st: OplState): { message: string; data: OplState } => {
        const tail = (st.oplog ?? []).slice(-5);
        return {
          message: [summarize(st), ...(tail.length ? ['  最近步骤：', ...tail.map((l) => `    · ${l}`)] : [])].join('\n'),
          data: st,
        };
      };

      switch (action) {
        case 'add': {
          if (!idea.trim()) throw new Error('action=add 需要 `idea`（愿望原文）—— 产线从一条愿望开始');
          return withLog(oplAdd(feature, idea));
        }
        case 'auto':
          return withLog(await oplAuto(feature, id || undefined, idea || undefined));
        case 'locate':
          return withLog(await oplLocate(feature, id));
        case 'declare':
          return withLog(oplDeclare(feature, id, {}));
        case 'implement':
          return withLog(oplImplement(feature, id));
        case 'check':
          return withLog(oplCheck(feature, id));
        case 'integrate':
          return withLog(await oplIntegrate(feature, id));
        case 'list': {
          const rows = oplList(feature);
          const lines = rows.length
            ? rows.map(
                (r) =>
                  `  ${r.id}「${r.title}」：${r.status}${r.integrated ? ' · 已集成' : ''}` +
                  `${r.parentFeat ? ` · 父功能 ${r.parentFeat}` : ''} · 更新 ${r.updated}`,
              )
            : ['  （还没有 OPL 条目 —— 用 action=add 提一条愿望）'];
          return {
            message: [`OPL 条目 ${rows.length} 条（feature=${feature}）：`, ...lines].join('\n'),
            data: { ok: true, feature, items: rows },
          };
        }
        default:
          throw new Error(`opl: 未知 action "${action}"（可选：add / auto / locate / declare / implement / check / integrate / list）`);
      }
    }),
  },
];
