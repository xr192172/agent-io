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
 *     `detect_drift` 是**编排**（内部调 `checkConsistency`），`consistency_check` 是**基础动作/引擎**，
 *     二者**不同抽象层**，且不共用输入契约（前者要 code_dir；后者要 scope/since_ref/mode/changed_files）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { requireStr, wrapData } from '../plumbing.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb } from '../../infrastructure/index/db.js';
import { getDSL, requireProjectRoot } from '../../infrastructure/storage.js';
import { proposeChange } from './workbench/code_workbench.js';
import { importProject } from '../../infrastructure/graph/import_project.js';
import type { ImportProjectInput } from '../../infrastructure/graph/import_project.js';
import { MANAGE_ACTIONS } from './lifecycle/manage_feature.js';
import { buildBrickifyPreview } from './bricks/render_brickwork.js';
// ★ T15 切片（2026-10-05）：把「混合文件解耦」这对能力从 CLI 面接进 MCP 面 ——
//   两者共用同一批 application 层核心（与 `brickify_cli` 同源；`split_stage_cli` 已于 2026-10-06 删除），CLI 只是 argv 薄壳。
import { buildBrickify } from './bricks/brickify.js';
import { reviewSignals } from './bricks/signal_review.js';
import { runSplitStage } from './lifecycle/split_stage.js';
import { scaffold } from './lifecycle/scaffold.js';
import { setDesignIntent } from './intent/set_design_intent.js';
import { consistencyHandler, detectDriftHandler, editDslHandler, getDslHandler, manageFeatureHandler, renderDesignHandler } from './handlers.js';
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
      'decisions（决策卡目录，按功能线 thread 分组，支持 thread/decision_status 过滤）/ ' +
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
      'goals（结构化目标，meta.goals）/ edge_intents（边级意图，edge.intent）。' +
      'view: design（默认，活态设计）/ live（实际代码快照，仅 query=dsl/nodes/edges/node/files/file 生效，用于对比设计 vs 代码现状）。',
    inputSchema: {
      query: z
        .enum(['dsl', 'features', 'nodes', 'edges', 'node', 'decisions', 'files', 'file', 'digest', 'scope', 'calls', 'functions', 'annotations', 'approvals', 'approval_history', 'snapshots', 'templates', 'simulation_state', 'diff', 'goals', 'edge_intents'])
        .describe('查询类型：dsl=完整DSL, features=feature列表, nodes=节点摘要, edges=边摘要, node=节点详情, decisions=决策目录(按功能线分组), files=文件摘要, file=文件详情, digest=每文件一行紧凑认知索引(F职责/R关系/A契约/S高熵决策,只读派生), scope=**圈定范围**(按 layer/swimlane/arch_layer/subtree/files 解析成确定的文件集合,只读派生), calls=调用关系, functions=函数级大纲(目录→文件→函数+调用/被调用/回环), annotations=标注, approvals=审批, approval_history=审批历史, snapshots=快照, templates=模板, simulation_state=仿真状态, diff=对比, goals=结构化目标(meta.goals), edge_intents=边级意图(edge.intent)'),
      scope: z
        .string()
        .optional()
        .describe(
          'query=scope 时：**圈定范围**的一行表达式（文法唯一落点在 src/domain/scope.ts）：' +
            'all=整份(顶层) | layer:main|error|detail | swimlane:<泳道id> | arch_layer:<架构层id> | ' +
            'subtree:<node_id>  (±尾缀 ! 表示下钻进子图) | nodes:<id>,<id> | files:<相对路径>,<目录/>。缺省=all。' +
            '★ 解析是**纯函数**（同一输入两次结果逐字相同）⇒ 可作下游"分区域重写/对账"的稳定命名。',
        ),
      view: z.enum(['design', 'live']).default('design').describe('视图层级：design=设计视图（默认），live=实际代码快照'),
      feature: z.string().optional().describe('feature 名（nodes/edges/node/decisions/files/file/digest/annotations/approvals 等需要）'),
      node_id: z.string().optional().describe('query=node 时：节点 ID'),
      thread: z.string().optional().describe('query=decisions 时：按功能线过滤（不传=全部，按 thread 分组输出）'),
      decision_status: z.enum(['active', 'superseded', 'draft']).optional().describe('query=decisions 时：按决策状态过滤（active=生效中/superseded=已迭代/draft=草案）'),
      file_id: z.string().optional().describe('query=file/calls 时：文件 ID（对应 SemanticFile.id = geometry Node.id）'),
      project_dir: z.string().optional().describe('query=calls/functions 时：项目根目录（用于定位 cache.db / import_cache_*.db 查询函数级数据）'),
      layer: z.enum(['main', 'error', 'detail']).optional().describe('query=nodes/edges 时：按职责分层过滤'),
      type: z.string().optional().describe('query=nodes 时：按节点类型过滤（如 service/module/database/api/queue/ui）'),
      file_layer: z.string().optional().describe('query=files 时：按架构层过滤（如 api/service/data/ui）'),
      file_status: z.enum(['draft', 'in_progress', 'done']).optional().describe('query=files 时：按实现状态过滤'),
      annotation_node_id: z.string().optional().describe('query=annotations 时：按节点过滤'),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      unresolved_only: z.boolean().optional(),
      status: z.string().optional().describe('query=approvals 时：按状态过滤'),
      assignee: z.string().optional(),
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
      'type: node/edge/file/api/binding/status/annotation/approval/snapshot/layout/simulation。' +
      '标注/审批/快照/布局/仿真 用 data 传参（annotation.add data.text；annotation.resolve data.annotation_id；' +
      'approval.submit/review data.annotation_id；snapshot.save data.label；snapshot.rollback/delete data.snapshot_id；' +
      'layout.apply data.algo=dag|force|grid；simulation.reset 无参）。' +
      'view: design（默认，改设计视图）/ live（拒绝写入，实际代码快照只能由 import/watch 重建）。' +
      'weight: normal（默认）/ routine。routine=轻量写路径：跳过 L4 证据回溯（仍留 L1-L3 防空话/套话/泛谈），' +
      '适合日常维护（补节点/改职责描述/加标注/改属性），不必先跑代码留 trace 证据；改架构/契约等重改请用 normal 全链强闸。' +
      '★ 但**改 `semantic.files` 的 op（`type=file` / `type=api`）两档都要先"现取该文件的事实"**：' +
      'DSL 已不存事实镜像（actual_apis/actual_deps 已移除）⇒ 事实只能现取，须把该文件路径作为 evidence 的 ref 传进来。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
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
              .enum(['add', 'update', 'delete', 'move', 'resolve', 'submit', 'review', 'save', 'rollback', 'apply', 'reset'])
              .describe('操作：add/update/delete/move 通用；resolve=关闭标注；submit/review=审批；save/rollback/delete=快照；apply=布局；reset=仿真'),
            type: z
              .enum(['node', 'edge', 'file', 'api', 'binding', 'status', 'annotation', 'approval', 'snapshot', 'layout', 'simulation'])
              .describe('目标类型：node/edge/file/api/binding/status 几何与语义；annotation/approval/snapshot/layout/simulation 协作与整理'),
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
                "证据类型：L4 支持 ① 'trace'（真实执行记录）② **指向仓库文件的 ref**（程序按 fileFacts **现取**事实验证）—— 改 semantic.files 时必须给后者",
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
    name: 'manage_feature',
    title: 'Manage feature lifecycle',
    description:
      'feature 生命周期统一入口：create（创建）/ clone（克隆）/ template（从模板创建）/ list（列出）/ delete（删除）。' +
      'create 需 feature 名（^[a-zA-Z0-9_-]+$）；clone 需 source_feature+target_feature；template 需 template_id+feature；' +
      'delete 需 feature（同时清理设计存档 + 实际快照 + 活态视图）。',
    inputSchema: {
      action: z.enum(MANAGE_ACTIONS).describe('create/clone/template/list/delete'),
      args: z.record(z.string(), z.unknown()).optional().describe('各 action 参数（feature/title/source_feature/target_feature/template_id）'),
    },
    handler: manageFeatureHandler,
  },

  {
    name: 'render_design',
    title: 'Render design DSL to mindmap/SVG/Markdown',
    description:
      '渲染设计 DSL：format=mindmap（默认，现行思维导图架构：root → 功能分组 → 文件；' +
      '功能分组优先读设计视图语义分组容器，其次 feature_tree 功能树）/' +
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
    name: 'render_brickwork',
    title: 'Render the dependency-driven community workbench (brickify)',
    description:
      '可视化协作平台的**依赖驱动积木化工作台**渲染（后端数据线路的交付出口）：' +
      '扫描 project_dir → 文件级依赖图 → 目录种子积木 → 混合文件信号(AST 顶层概念簇) → ' +
      '功能社区(依赖边连通分量+内聚度) → 生成**自包含单 HTML 社区工作台**。' +
      '取代旧"按目录硬切+基名相似"启发式：每块积木=一个功能，社区=积木依赖簇，' +
      '混合文件=一文件多功能(解耦候选信号，需人/LLM 确认拆分)。' +
      '返回 HTML 文件路径，浏览器可直接打开验收。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（扫描依赖的源）'),
      source_root: z.string().optional().describe('源码根目录（默认 = project_dir）'),
      output_path: z.string().optional().describe('输出 HTML 路径（默认 <agent-io>/docs/brickify_preview.html）'),
    },
    handler: wrapData(async (a) => {
      // ★ 缺根时此前抛 `paths[0]` 原始异常 —— 先守根。
      const project_dir = requireStr(a, 'project_dir');
      const out = await buildBrickifyPreview({
        project_dir,
        source_root: a.source_root as string | undefined,
        out_file: a.output_path as string | undefined,
      });
      const fileUrl = `file:///${out.replace(/\\/g, '/')}`;
      return { message: `已生成依赖驱动功能社区工作台：${out}\n（浏览器打开 ${fileUrl} 查看积木社区/混合文件诊断）` };
    }),
  },

  {
    // ★ T15 切片（2026-10-05）：原先只存在于 `signal_review_cli`（CLI-only）⇒ 能力被藏在 MCP 面之外。
    name: 'signal_review',
    title: 'Review mixed-file decoupling signals (LLM)',
    description:
      '混合文件解耦信号的**LLM 复核**（"拆分链"第一棒）：先跑 brickify 取 `mixed_files` 信号' +
      '（一个文件里多功能 = 解耦候选），再逐信号喂 LLM（读文件全文 + 注释）⇒ 逐簇产出【采纳/驳回 + 功能名 + 理由】。' +
      '判据：独立使用者 / 独立演进 / 文档证据 ⇒ 工具函数簇**驳回**；新旧世代并存且注释明言 ⇒ **采纳**。' +
      '★ LLM 不可用（未配置 apiKey）时**诚实降级**：`llm_available=false`，原样返回信号、**不伪造复核结论**。' +
      '产物（`signals_scanned` + `review.reviews`）可直接喂 `split_stage`（给 `report_path` 落盘即可）。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录'),
      source_root: z.string().optional().describe('源码根目录（默认 = project_dir）'),
      only: z.array(z.string()).optional().describe('只复核这几个文件（仓库相对路径）；省略 = 全部混合文件信号'),
      timeout_ms: z.number().optional().describe('单次 LLM 调用超时（毫秒）'),
      max_source_chars: z.number().optional().describe('喂给 LLM 的单文件最大字符数（防大文件淹上下文）'),
      report_path: z
        .string()
        .optional()
        .describe('把报告落到该路径（JSON：`{signals_scanned, review}`，正是 split_stage 要吃的形态）'),
    },
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      const source_root = a.source_root as string | undefined;
      const brick = await buildBrickify({ project_dir, source_root });
      if (brick.mixed_files.length === 0) {
        return {
          message: `无混合文件解耦信号（扫了 ${brick.meta.scanned_files} 个文件）⇒ 无需复核。`,
          data: { signals_scanned: [], review: null, llm_available: true },
        };
      }
      const only = (a.only as string[] | undefined) ?? [];
      const result = await reviewSignals({
        project_dir,
        source_root,
        signals: brick.mixed_files,
        timeout_ms: a.timeout_ms as number | undefined,
        max_source_chars: a.max_source_chars as number | undefined,
        only: only.length ? only : undefined,
      });
      if (!result) {
        return {
          message:
            `LLM 不可用（未配置 apiKey）⇒ **未复核**：${brick.mixed_files.length} 个信号原样返回，` +
            '没有编造"采纳/驳回"结论（诚实降级）。',
          data: { signals_scanned: brick.mixed_files, review: null, llm_available: false },
        };
      }
      const report_path = a.report_path as string | undefined;
      let written: string | undefined;
      if (report_path) {
        written = path.resolve(report_path);
        fs.mkdirSync(path.dirname(written), { recursive: true });
        fs.writeFileSync(written, JSON.stringify({ signals_scanned: brick.mixed_files, review: result }, null, 2), 'utf-8');
      }
      return {
        message:
          `${result.meta.total_signals} 个信号 → ${result.meta.actionable} 个需拆(采纳) / ${result.meta.rejected} 个驳回。` +
          (written ? `\n报告已落盘：${written}（可直接喂 split_stage）` : ''),
        data: { signals_scanned: brick.mixed_files, review: result, llm_available: true, ...(written ? { report_path: written } : {}) },
      };
    }),
  },

  {
    // ★ T15 切片（2026-10-05）：原先只存在于 `split_stage_cli`（CLI-only）。
    name: 'split_stage',
    title: 'Split adopted concept clusters into separate files',
    description:
      '拆分执行器（"拆分链"最后一棒）：消费 `signal_review` 的报告，把复核判**采纳**的概念簇**按簇切出独立文件**。' +
      '★ **默认 dry_run 只出草稿**（`apply=true` 才真落盘）；落盘由 `derive_split` 内置的编译/测试级验收 + 失败回滚兜底。' +
      '报告形态：`{signals_scanned: [...], review: {reviews: [...]}}`（即 `signal_review` 的 `report_path` 产物）。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录'),
      report_path: z.string().describe('signal_review 的报告 JSON 路径'),
      source_root: z.string().optional().describe('源码根目录（默认 = project_dir）'),
      apply: z.boolean().optional().describe('true = 真落盘；省略/false = dry-run 只出草稿（**默认**）'),
      re_export_extracted: z.boolean().optional().describe('拆分后是否补 re-export（默认 true）'),
      max_symbols: z.number().optional().describe('单簇最大符号数（超过则不拆，防超大簇乱切）'),
    },
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      const reportPath = path.resolve(requireStr(a, 'report_path'));
      let report: { signals_scanned?: unknown; review?: { reviews?: unknown } };
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as typeof report;
      } catch (e) {
        throw new Error(`无法读取报告 ${reportPath}：${(e as Error).message}`);
      }
      const signals = (report.signals_scanned ?? []) as never[];
      const reviews = (report.review?.reviews ?? []) as never[];
      if (signals.length === 0 || reviews.length === 0) {
        return { message: '报告内无信号 / 无复核结论 ⇒ 无可拆。', data: { total_plans: 0, total_splits: 0, applied: 0, items: [] } };
      }
      // ★ 报告形状守卫（2026-10-05 真调踩到）：手写的报告若缺 `signals[].clusters`，核心会在
      //   `clusters.length` 处抛**裸 TypeError**（`Cannot read properties of undefined`）——
      //   属本仓 T41「报错说了等于没说」那一类。这里先响亮说清"哪一条、缺什么、该从哪来"。
      const badIdx = (signals as Array<{ file?: string; clusters?: unknown }>).findIndex((s) => !Array.isArray(s?.clusters));
      if (badIdx >= 0) {
        const at = (signals as Array<{ file?: string }>)[badIdx];
        throw new Error(
          `报告不合法：signals_scanned[${badIdx}]${at?.file ? `（${at.file}）` : ''} 缺 \`clusters\`。` +
            '请用 `signal_review` 产出的报告（传 `report_path` 即可）—— 那批信号来自 brickify 的 `mixed_files`，' +
            '`split_stage` 靠它的 `clusters` 才知道每个文件里哪些簇可拆；手写报告接不上。',
        );
      }
      const dry_run = a.apply !== true; // ★ 默认 dry-run（与 CLI 的 `--apply` 语义一致）
      const result = await runSplitStage({
        project_dir,
        source_root: a.source_root as string | undefined,
        signals,
        reviews,
        dry_run,
        re_export_extracted: a.re_export_extracted !== false,
        max_symbols: a.max_symbols as number | undefined,
      });
      const rolled = result.items?.some((i) => i.status === 'rolled_back');
      return {
        message:
          (result.message ? `${result.message}\n` : '') +
          `采纳 ${result.total_plans} 簇 → 拆出 ${result.total_splits} 簇，成功 ${result.applied}${rolled ? '，**有回滚**' : ''}；` +
          (dry_run ? 'dry-run：未写文件（确认草稿后传 apply=true）' : '已落盘'),
        data: result,
      };
    }),
  },

  {
    name: 'scaffold',
    title: 'Scaffold: generate a code skeleton from the DSL',
    description:
      '从 DSL semantic 层生成代码骨架（输出根缺省 `<cwd>/scaffold/<feature>`）。支持语言 .go/.ts/.py/.js/.vue/.tsx。' +
      '额外生成 INVARIANTS.md 记录跨文件不变式。已存在文件默认**不覆盖**（`overwrite=true` 才覆盖）。' +
      '★ 2026-10-01：原先的 `action=backfill`（把代码解析出的 API 签名**镜像回填进 DSL** 的 `actual_apis`）' +
      '**已整条剔除** —— 那是"把代码的事实抄进意图册"，是第二份可写副本。要读事实请用 `explore_code`/`query_feature`，' +
      '它们现取解析数据（唯一入口 `infrastructure/index/file_facts`）。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      output_dir: z.string().optional().describe('generate 用：输出根目录（默认 <cwd>/scaffold/<feature>）'),
      overwrite: z.boolean().optional().describe('generate 用：是否覆盖已存在文件（默认 false）'),
      ui_framework: z.enum(['vue', 'react', 'html']).optional().describe('generate 用：UI 骨架类型（覆盖 DSL 配置）'),
      project_dir: z.string().optional().describe('项目根（索引归属），提供时生成物登记为自写（读路径优先同步索引）'),
    },
    handler: wrapData(async (a) => {
      const action = 'generate';
      const feature = requireStr(a, 'feature');

      {
        const r = scaffold({
          feature,
          project_dir: a.project_dir as string | undefined,
          output_dir: a.output_dir as string | undefined,
          overwrite: a.overwrite as boolean | undefined,
          ui_framework: a.ui_framework as 'vue' | 'react' | 'html' | undefined,
        });
        // ★ 回执编排：written_files（生成的文件路径表）与 dir（输出根）是 agent 后续要引用的机器可读产物，
        //   旧入口用 wrapData 时已在回（★ 2026-10-05 随 [B] 还债把 `files` 拆成 `written_files`）。
        return { message: r.message, data: { action, written_files: r.written_files, dir: r.dir } };
      }

    }),
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
    name: 'import_project',
    title: 'Import a code project as DSL',
    noAutoFresh: true, // 自己做全量导入，前置保鲜纯属浪费
    description:
      '扫描代码项目（.go/.ts/.py/.js 等）生成 DSL：文件节点 + 调用边 + 符号/API 语义层，写入 agent-io 存储。' +
      '默认生成设计 DSL；live_only=true 只生成"实际视图"快照（live/ 目录，供 🎭设计/⚡实际 双视图对比）。' +
      'design_mode=true 按目录聚合成模块节点；functional_mode=true 按调用图做功能性聚合（优先级高于 design_mode）。' +
      '导入后可用 render_design 渲染可视化，或 diff_views 对比设计 vs 实际。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（绝对路径或相对 cwd）'),
      feature: z.string().describe('新 feature 名（^[a-zA-Z0-9_-]+$）'),
      title: z.string().optional().describe('显示标题（默认等于 feature）'),
      max_files: z.number().optional().describe('最多解析文件数（默认 200）'),
      include_tests: z.boolean().optional().describe('是否包含测试文件（默认 false）'),
      include_archive: z.boolean().optional().describe('是否索引归档目录 _archive/archive/_old 等（默认 false）'),
      live_only: z
        .boolean()
        .optional()
        .describe('true=仅生成实际视图快照（写 live/，不覆盖设计 DSL），默认 false=写设计 DSL'),
      live_dir: z.string().optional().describe('live_only 时实际 DSL 归属的项目根（默认 dataHome）'),
      gen_roles: z
        .boolean()
        .optional()
        .describe('true=用 LLM 为文件节点生成中文职责标题（默认 false，未配置 LLM 时静默跳过）'),
      design_mode: z.boolean().optional().describe('true=按目录聚合为模块节点（设计草图模式）'),
      functional_mode: z.boolean().optional().describe('true=按调用图做功能性聚合（跨目录功能社区，优先于 design_mode）'),
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
      return { message, data };
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
            status: z.enum(['open', 'resolved']).optional(),
          }),
        )
        .optional()
        .describe('边级意图：按 base 边 id 或 from+to 匹配挂载 reason/boundary —— 2 个 action 共用'),
      project_dir: z.string().optional().describe('propose 用：审批台账的隔离桶名（人查看的项目目录）；缺省取 feature 的 source_root'),
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
          submitter: 'llm',
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
          `人将在工作台「代码审批」页签看到这条提案，approve 后 goals/边意图才真正写入 DSL；reject 则丢弃。`,
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
