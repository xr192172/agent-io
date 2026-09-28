/**
 * design 线（12 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const DESIGN_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'design'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { wrap, wrapData } from '../plumbing.js';
import path from 'node:path';
import { getProjectCacheDb } from '../../db/db.js';
import { getDSL } from '../../storage.js';
import { proposeChange } from '../../tools/code_workbench.js';
import { importProject } from '../../tools/import_project.js';
import type { ImportProjectInput } from '../../tools/import_project.js';
import { MANAGE_ACTIONS } from '../../tools/manage_feature.js';
import { buildBrickifyPreview } from '../../tools/render_brickwork.js';
import { scaffold } from '../../tools/scaffold.js';
import { backfillHandler, consistencyHandler, detectDriftHandler, editDslHandler, getDslHandler, manageFeatureHandler, renderDesignHandler, scaffoldHandler, setDesignIntentHandler } from '../handlers.js';
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
      'files（语义文件摘要列表，支持 file_layer/file_status 过滤）/ ' +
      'file（单个文件详情，需 file_id，含 expected_apis/actual_apis/deps）/ ' +
      'calls（文件调用关系，需 file_id+project_dir，查 cache.db 入/出调用）/ ' +
      'functions（函数级大纲，需 feature，查缓存 db 的目录→文件→函数 + 调用/被调用/回环）/ ' +
      'annotations（标注）/ approvals（审批）/ approval_history（审批历史，需 annotation_id）/ ' +
      'snapshots（快照）/ templates（模板）/ simulation_state（仿真状态）/ diff（对比，需 feature_a+feature_b）/ ' +
      'goals（结构化目标，meta.goals）/ edge_intents（边级意图，edge.intent）。' +
      'view: design（默认，活态设计）/ live（实际代码快照，仅 query=dsl/nodes/edges/node/files/file 生效，用于对比设计 vs 代码现状）。',
    inputSchema: {
      query: z
        .enum(['dsl', 'features', 'nodes', 'edges', 'node', 'decisions', 'files', 'file', 'calls', 'functions', 'annotations', 'approvals', 'approval_history', 'snapshots', 'templates', 'simulation_state', 'diff', 'goals', 'edge_intents'])
        .describe('查询类型：dsl=完整DSL, features=feature列表, nodes=节点摘要, edges=边摘要, node=节点详情, decisions=决策目录(按功能线分组), files=文件摘要, file=文件详情, calls=调用关系, functions=函数级大纲(目录→文件→函数+调用/被调用/回环), annotations=标注, approvals=审批, approval_history=审批历史, snapshots=快照, templates=模板, simulation_state=仿真状态, diff=对比, goals=结构化目标(meta.goals), edge_intents=边级意图(edge.intent)'),
      view: z.enum(['design', 'live']).default('design').describe('视图层级：design=设计视图（默认），live=实际代码快照'),
      feature: z.string().optional().describe('feature 名（nodes/edges/node/decisions/files/file/annotations/approvals 等需要）'),
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
      '适合日常维护（补节点/改职责描述/加标注/改属性），不必先跑代码留 trace 证据；改架构/契约等重改请用 normal 全链强闸。',
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
              .describe("证据类型，当前 L4 支持 'trace'（真实执行记录）"),
            ref: z
              .string()
              .describe("trace 证据的 ref：函数名，或 '<函数名>@token>N'（声明该函数实际 token 超 N，程序复算验证）"),
          }),
        )
        .optional()
        .describe('证据链（L4 回溯）：可选。传入后程序会到真实 trace 库（<feature>.trace.json）复算验证，查不到或不符则打回'),
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
    title: 'Render design DSL to mindmap/HTML/SVG/Markdown',
    description:
      '渲染设计 DSL：format=mindmap（默认，现行思维导图架构：root → 功能分组 → 文件，自包含查看器 HTML；' +
      '功能分组优先读设计视图语义分组容器，其次 feature_tree 功能树）/' +
      'html（旧设计画布·星图，仅调试用，自包含单 HTML）/ svg（矢量图）/ markdown（可读设计文档）。' +
      'mindmap/svg/markdown 用 feature 从存储读取；html 模式可直接传 dsl_json 渲染，或用 feature+view 读取。',
    inputSchema: {
      feature: z.string().optional().describe('feature 名（mindmap/svg/markdown 必填；html 用 feature+view 读取）'),
      view: z.enum(['design', 'live']).default('design').describe('视图层级：design=设计视图（默认），live=实际代码快照（仅 html 用）'),
      format: z.enum(['mindmap', 'html', 'svg', 'markdown']).optional().describe('输出格式，默认 mindmap（现行思维导图架构）'),
      dsl_json: z.string().optional().describe('html 模式：完整 DSL JSON 字符串'),
      output_path: z.string().optional().describe('输出路径'),
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
      output_path: z.string().optional().describe('输出 HTML 路径（默认 <design-canvas>/docs/brickify_preview.html）'),
    },
    handler: wrapData(async (a) => {
      const out = await buildBrickifyPreview({
        project_dir: a.project_dir as string,
        source_root: a.source_root as string | undefined,
        out_file: a.output_path as string | undefined,
      });
      const fileUrl = `file:///${out.replace(/\\/g, '/')}`;
      return { message: `已生成依赖驱动功能社区工作台：${out}\n（浏览器打开 ${fileUrl} 查看积木社区/混合文件诊断）` };
    }),
  },

  {
    name: 'scaffold',
    title: 'Generate code skeleton from DSL',
    description:
      '从 DSL semantic 层生成代码骨架。支持语言：.go/.ts/.py/.js/.vue/.tsx。' +
      '额外生成 INVARIANTS.md 记录跨文件不变式。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      output_dir: z.string().optional(),
      overwrite: z.boolean().optional(),
      ui_framework: z.enum(['vue', 'react', 'html']).optional(),
    },
    handler: scaffoldHandler,
  },

  {
    name: 'backfill_scaffold',
    title: 'Backfill scaffold from implementation code',
    description:
      'LLM 写完代码后，解析实现文件中的 API 签名，回填到 DSL semantic.files[].actual_apis，' +
      '对比 expected_apis 输出差异报告。支持 .go/.ts/.py/.js。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      scaffold_dir: z.string().optional(),
    },
    handler: backfillHandler,
  },

  {
    name: 'consistency_check',
    title: 'Check design-code consistency',
    description:
      '对比 DSL 定义的 expected_apis 与实际代码实现，生成一致性报告（已实现/缺失/签名不匹配/代码新增），' +
      '并验证跨文件不变式。只读检查。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      code_dir: z.string().optional(),
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
      '扫描代码项目（.go/.ts/.py/.js 等）生成 DSL：文件节点 + 调用边 + 符号/API 语义层，写入 design-canvas 存储。' +
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
    handler: wrap(async (a) => {
      // MCP 路径默认连项目级符号缓存（<project_dir>/.design-canvas/cache.db）：
      // 不连则 importProject 走无缓存路径，符号缓存永远不更新（增量 re-parse 失效）。
      // 开库失败（只读目录等）降级为无缓存导入，不阻断导入本身。
      let cacheDb;
      try {
        cacheDb = getProjectCacheDb(path.resolve(a.project_dir as string));
      } catch {
        cacheDb = undefined;
      }
      const r = await importProject({ ...(a as unknown as ImportProjectInput), cache_db: cacheDb });
      return { message: r.message };
    }),
  },

  {
    name: 'set_design_intent',
    title: 'Write design intent',
    description:
      '写设计意图到意图 overlay（缺口①③④ 的写入口，LLM 开发时即消费方）：' +
      'goals（结构化目标/方向，全量替换）与 edge_intents（"A 为何依赖 B" 与边界归属，' +
      '按 base 边 id 或 from+to 匹配挂载）两者均可选、至少传一类。' +
      '写进 <feature>.overlay.json（意图权威库），随即 apply 回 base 并保存，get_dsl/serve 当下即可读到 ' +
      '（meta.goals 与 edge.intent），不依赖下一次代码扫描再生。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
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
        .describe('结构化目标/方向（全量替换；空数组=清空）'),
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
        .describe('边级意图：按 base 边 id 或 from+to 匹配挂载 reason/boundary'),
    },
    handler: setDesignIntentHandler,
  },

  {
    name: 'propose_design_intent',
    title: '提出设计意图改写审批卡（by LLM，approve 才落 DSL）',
    description:
      '由 LLM 代拟「设计意图（why）」的改写提案并进入人工审批闸门：把 goals / edge_intents 的意图变更' +
      '算成一份 before/after（当前意图 vs 将改意图）预览，落为 pending 提案，**不写盘不碰 DSL**——' +
      '需要人在工作台「代码审批」页签 approve 后，才真正写入 overlay + base（复用 set_design_intent 的写端）。' +
      '这与直接 set_design_intent 的区别：本工具是"先请人批再落"，符合"人只做决策审批、LLM 只做提案转述"的分层。' +
      'project_dir 是审批台账的隔离桶名（缺省取 feature 的 source_root），应与人当前查看的项目一致，提案才会出现在他的审批列表里。',
    inputSchema: {
      feature: z.string().describe('feature 名（要改哪个设计意图）'),
      project_dir: z.string().optional().describe('审批台账桶名（人查看的项目目录）；缺省取 feature 的 source_root'),
      goals: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string().describe('目标一句话'),
            description: z.string().optional(),
            status: z.enum(['active', 'done', 'parked', 'dropped']).optional(),
          }),
        )
        .optional()
        .describe('结构化目标/方向（全量替换）'),
      edge_intents: z
        .array(
          z.object({
            id: z.string().optional().describe('目标 base 边 id（优先于 from+to）'),
            from: z.string().optional(),
            to: z.string().optional(),
            reason: z.string().optional().describe('A 为何依赖 B'),
            boundary: z.string().optional().describe('边界归属说明'),
            status: z.enum(['open', 'resolved']).optional(),
          }),
        )
        .optional()
        .describe('边级意图：按 base 边 id 或 from+to 匹配挂载'),
    },
    handler: wrap(async (a) => {
      const feature = String(a.feature ?? '');
      if (!feature) throw new Error('缺参数 feature');
      let project_dir = a.project_dir ? String(a.project_dir) : '';
      if (!project_dir) {
        const dsl = getDSL(feature);
        project_dir = dsl?.source_root ?? process.cwd();
      }
      const goals = Array.isArray(a.goals) ? (a.goals as unknown[]) : undefined;
      const edgeIntents = Array.isArray(a.edge_intents) ? (a.edge_intents as unknown[]) : undefined;
      if (!goals && !edgeIntents) throw new Error('至少传 goals 或 edge_intents 之一');
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
        data: { ok: true, project_dir, proposal: { id: c.id, kind: c.kind, label: c.label, summary: c.summary, diffs: c.diffs, preview: c.preview, status: c.status } },
      };
    }),
  },
];
