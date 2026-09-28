/**
 * harvest 线（9 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const HARVEST_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'harvest'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { wrap, wrapData } from '../plumbing.js';
import path from 'node:path';
import { assembleBricks } from '../../tools/assemble_bricks.js';
import type { AssembleBricksInput } from '../../tools/assemble_bricks.js';
import { extractContracts } from '../../tools/extract_contracts.js';
import type { ExtractContractsInput } from '../../tools/extract_contracts.js';
import { harvestClosure } from '../../tools/harvest_closure.js';
import type { HarvestClosureInput } from '../../tools/harvest_closure.js';
import { harvestFromUrl } from '../../tools/harvest_from_url.js';
import type { HarvestFromUrlInput } from '../../tools/harvest_from_url.js';
import { ensureProjectIndex } from '../../tools/index_freshness.js';
import { reconcileBrick } from '../../tools/reconcile_brick.js';
import type { ReconcileBrickInput } from '../../tools/reconcile_brick.js';
import { searchBricks } from '../../tools/search_bricks.js';
import type { SearchBricksInput } from '../../tools/search_bricks.js';
import { slimBrick } from '../../tools/slim_brick.js';
import type { SlimBrickInput } from '../../tools/slim_brick.js';
import { harvestDecisionsHandler, syncContractsHandler } from '../handlers.js';
import type { ToolDef } from '../types.js';

export const HARVEST_TOOLS: ToolDef[] = [
  {
    name: 'harvest_decisions',
    title: 'Harvest decision-card candidates from docs / git log / comments',
    description:
      '决策卡补录：从项目文档（docs/*.md）、git 日志、源码注释粗提取设计意图线索，生成 draft 决策卡候选（含出处 ref + 原文 evidence + 一句话总结）。' +
      '不直接写 DSL——LLM review 核对出处后，定稿（status: active）再通过决策卡工具写入 DSL，防编造。' +
      '候选带 lifecycle_hint（下线/合并/取代/拆分），供 diff 与下线库（archive_node）参考。' +
      '适用：为没有决策卡历史的现有项目/外来代码补录活文档。',
    inputSchema: {
      feature: z.string().describe('feature 名（候选挂载目标）'),
      doc_dir: z.string().optional().describe('文档目录（扫描 *.md），默认 <cwd>/docs'),
      git_root: z.string().optional().describe('git 仓库根（读 git log），默认 <cwd>'),
      limit: z.number().optional().describe('git 日志条数上限，默认 30'),
      comment_files: z.array(z.string()).optional().describe('要提取注释的源码文件（绝对路径）'),
    },
    handler: harvestDecisionsHandler,
  },

  {
    name: 'sync_contracts',
    title: 'Sync tool contracts from registry schema into DSL expected_apis',
    description:
      '契约回填（修复契约漂移）：以 server_registry 的 zod schema 为唯一事实源，把每个已注册工具的输入契约生成签名回填到 DSL semantic.files 的 expected_apis。' +
      '改了工具 schema 后跑一次，DSL 契约自动跟上。' +
      '默认只更新 DSL 中已存在且 path=src/tools/{name}.ts 的文件；include_all=true 时为缺失的工具文件补全契约节点。' +
      '只回填签名（notes 带机器生成标记），设计侧意图由 LLM 维护。',
    inputSchema: {
      feature: z.string().describe('feature 名（已存在的 DSL feature）'),
      include_all: z.boolean().optional().describe('为 DSL 中缺失的工具文件补全契约节点（默认 false）'),
    },
    handler: syncContractsHandler,
  },

  {
    name: 'harvest_closure',
    title: 'Harvest a brick with its transitive import closure',
    description:
      '积木拎取闭包（Brick Harvest Phase 1）：给定种子文件，沿 import 边算出"拎走这块积木必须连根带走的全部东西"。' +
      '输出：项目内传递闭包（带深度/带入者/import 语句证据）+ 外部依赖三分类（标准库/三方/未归类）。' +
      '与 diff_impact 正交：diff_impact 答"改这里波及谁"（importer 方向），本工具答"拎走它需要什么"（importee 方向）。' +
      'include_callers=true 时连调用方一起端走（拎服务层带生态）。前置：项目需先跑 import_project 建符号缓存。' +
      '规划见 docs/plans/2026-08-19-cross-project-brick-harvest.md。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（其下 .agent-io/cache.db 是符号缓存，为空则自动冷启建索引）'),
      files: z.array(z.string()).describe('种子文件（相对项目根或绝对路径，可多个）'),
      feature: z.string().optional().describe('可选 feature 名：提供时为闭包文件附加 DSL 文件节点 id'),
      include_callers: z
        .boolean()
        .optional()
        .describe('true=importer 方向也纳入闭包（连功能带调用方生态一起端走），默认 false=纯根须'),
      max_depth: z.number().optional().describe('BFS 深度上限（默认 30，传递闭包天然有界）'),
    },
    handler: wrapData(async (a) => {
      const input = a as unknown as HarvestClosureInput;
      // ★ 零前置：闭包沿 import 边算，空缓存先就地冷启
      await ensureProjectIndex(path.resolve(input.project_dir));
      const r = harvestClosure(input);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'extract_contracts',
    title: 'Extract brick contracts (role/shapes/effects) for project files',
    description:
      '积木契约提取（Brick Harvest Phase 2）：给项目文件生成 BrickContract——' +
      'role（业务/功能二分：依赖方向图算法，零 token，"功能不依赖业务，业务组装功能"）、' +
      'shapes（struct/interface/class 数据形状+字段，结构化类型匹配的判定单元）、' +
      'effects（reads_config=env/flag 读取点；writes/holds/emits=静态候选 origin:ast——' +
      '模块级变量写/listen/句柄/chan send/emit 调用，待 observe 观测转正 origin:runtime）。' +
      '提供 feature 时写回 DSL 的 SemanticFile.contract（write_dsl=false 可只读预演）。' +
      'LLM 不产生事实：结构化字段只接受 AST/observe 源。' +
      '规划见 docs/plans/2026-08-19-cross-project-brick-harvest.md Phase 2.5/2.7。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（缓存为空时会自动冷启建索引，无需先 import_project）'),
      feature: z.string().optional().describe('提供时把 contract 写回该 feature 的 DSL（SemanticFile.contract）'),
      files: z
        .array(z.string())
        .optional()
        .describe('限定提取范围的文件（相对项目根）；缺省 = 全部已索引文件'),
      write_dsl: z.boolean().optional().describe('false=只读预演不写回，默认 true'),
    },
    handler: wrapData(async (a) => {
      const input = a as unknown as ExtractContractsInput;
      // ★ 零前置：空缓存就地冷启（契约提取建立在符号/AST 索引之上）
      await ensureProjectIndex(path.resolve(input.project_dir));
      const r = extractContracts(input);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'harvest_from_url',
    title: 'Harvest bricks from a git URL or local project into the brick box',
    description:
      '积木抽取编排（Brick Harvest Phase 3）：一句"这个项目好，抽它"的完整链——' +
      '浅克隆（或本地目录原地）→ import_project 索引 → extract_contracts 契约 → ' +
      '选积木（显式 seeds 或 auto：functional+fan_in≥2+confidence≥0.7 按 fan_in 降序）→ ' +
      'harvest_closure 闭包 → 入盒三件套（files/ 快照 + contracts.json + manifest.json 聚合清单），' +
      '默认盒 <dataHome>/.agent-io/bricks/。原项目只留 provenance 冷记录（URL+commit），不保留工作副本；' +
      '上游更新凭记录重抽即覆盖。单积木闭包>50 文件自动跳过（防整项目端走）。',
    inputSchema: {
      source: z.string().describe('git URL（浅克隆）或本地目录绝对路径（原地分析不写源项目）'),
      bricks: z
        .array(
          z.object({
            name: z.string().optional().describe('积木名（缺省 <repo>__<种子文件名>）'),
            seeds: z.array(z.string()).describe('种子文件（相对项目根）'),
          }),
        )
        .optional()
        .describe('显式积木规格（一组种子一个积木）；缺省走 auto 模式'),
      auto: z
        .object({
          max_bricks: z.number().optional().describe('最多抽几块（默认 5）'),
          min_fan_in: z.number().optional().describe('种子最低 fan_in（默认 2）'),
        })
        .optional()
        .describe('auto 模式参数（bricks 未提供时生效）'),
      max_closure: z.number().optional().describe('单积木闭包文件数上限（默认 50）'),
      box_dir: z.string().optional().describe('积木盒根目录（默认 <dataHome>/.agent-io/bricks）'),
      write: z.boolean().optional().describe('false=dry-run 只预演不入盒，默认 true'),
    },
    handler: wrapData(async (a) => {
      const r = await harvestFromUrl(a as unknown as HarvestFromUrlInput);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'reconcile_brick',
    title: 'Reconcile brick-box contracts with observe runtime observation',
    description:
      '积木盒动静对账（Brick Harvest Phase 3R-C 工具化）：读 observe effect 事件，与积木盒 contracts.json 对账——' +
      '候选命中观测 → origin ast→runtime 转正；候选外新观测 → 补进契约 + incomplete 告警（静态漏了）；' +
      '未触发候选保持 ast（不证伪），gap_notes 登记人工归因（not_triggered/probe_gap/static_only）。' +
      '证据档案写 manifest.effect_verification（重抽保留字段——快照可重抽，运行证据只有一份）。' +
      '与 reconcile_effects（DSL 契约版）判定规则同源，对账对象是积木盒。' +
      '前置链：harvest_from_url 入盒 → instrument --effects 插桩积木快照 → 驱动运行 → 本工具。',
    inputSchema: {
      brick_dir: z.string().optional().describe('积木目录（含 contracts.json；与 brick_name 二选一）'),
      brick_name: z.string().optional().describe('积木名（搭配 box_dir：<box_dir>/<brick_name>）'),
      box_dir: z.string().optional().describe('积木盒根目录（默认 <cwd>/.agent-io/bricks）'),
      events_files: z.array(z.string()).optional().describe('显式事件文件列表（缺省自动发现）'),
      verify_dir: z.string().optional().describe('验证项目根目录（自动发现其 .agent/observe/events-*.jsonl）'),
      gap_notes: z
        .record(z.string(), z.string())
        .optional()
        .describe('未观测候选归因（键=<文件名>|<target>，值=归因说明：not_triggered/probe_gap/static_only）'),
      known_blind_spots: z.array(z.string()).optional().describe('已知盲区（写入证据档案）'),
      method: z.string().optional().describe('对账方法描述（写入证据档案，如"instrument --effects + golog-verify 驱动"）'),
      write: z.boolean().optional().describe('false=只对账预演不写回，默认 true'),
    },
    handler: wrapData(async (a) => {
      const r = await reconcileBrick(a as unknown as ReconcileBrickInput);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'search_bricks',
    title: 'Search and browse the brick shelf (cross-project reuse catalog)',
    description:
      '积木货架（Brick Harvest Phase 4：跨项目统一检索层）——浏览/检索积木盒 .agent-io/bricks/ 的全部积木，' +
      '"拎之前先看它要什么、给什么"。三种模式：①浏览（无参数：全部积木概况——语言/来源/规模/exposes/验证状态）；' +
      '②检索（query 关键词打分：积木名 > 形状名 > 字段名 > 人话介绍，matched 明细可追溯）；' +
      '③详情（name 精确：完整契约——形状 fields、effects 全清单、不变量断言、闭包、observe 验证档案）。' +
      '过滤：language / verified（有运行证据）/ has_invariants / zero_third_party（拎走即跑）。' +
      '数据源是盒内 manifest.json 自包含档案（跨项目资产的统一命名空间就是盒本身，不碰项目 cache.db）。' +
      '这是"我要 X 功能 → 找到积木 → 拎取拼装"价值链的检索环节。',
    inputSchema: {
      query: z.string().optional().describe('关键词检索（多词独立打分求和：命中积木名/形状名/字段名/description）'),
      language: z.enum(['go', 'typescript', 'python', 'javascript']).optional().describe('语言过滤（闭包文件扩展名推断）'),
      verified: z.boolean().optional().describe('只看有 observe 运行验证的（effect_verification 档案）'),
      has_invariants: z.boolean().optional().describe('只看有数学不变量的（acceptance.invariants）'),
      zero_third_party: z.boolean().optional().describe('只看零三方依赖的（拎走即跑）'),
      name: z.string().optional().describe('精确积木名 → 详情模式（完整契约输出）'),
      box_dir: z.string().optional().describe('积木盒根目录（默认 <cwd>/.agent-io/bricks）'),
    },
    handler: wrapData(async (a) => {
      const r = await searchBricks(a as unknown as SearchBricksInput);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'assemble_bricks',
    title: 'Assemble a new project from boxed bricks (assembly zone)',
    description:
      '拼装区（Brick Harvest Phase 5：实码搬运与重组）——把积木盒里的已验证积木搬进一个**全新的拼装区目录**，' +
      '拼出新项目骨架。核心纪律：每次拼装一个新目录，绝不在原项目上抽取和拼装（原项目永远只读）。' +
      '布局 <target>/<积木名>/<原闭包相对路径>（积木名做顶层命名空间，永不撞路径）。' +
      'import 重接：TS/JS 零改动（闭包内相对位置不变）；Go 按闭包目录最长后缀匹配识别内部 import，' +
      '重写为 <module>/<积木名>/<后缀>，并生成 go.mod（含 require 块：版本从各积木 go_mod_requires 存档' +
      '原样取用——源项目 go.mod 原文，不猜不升版；多积木同库不同版本 MVS 取高并留 version_conflicts 警告）。' +
      '诚实边界：存档缺项/TS 依赖汇总 pending 清单由人/LLM 补；go.sum 不生成（跑 go mod tidy 补）；' +
      '跨积木闭包重叠只警告不合并；' +
      'glue 粘合代码不生成（LLM 的活）。写完 glue 编译通过 = 拼装区成为可运行新项目（可 import_project 解析、可再入盒）。',
    inputSchema: {
      bricks: z.array(z.string()).describe('要拼装的积木名列表（须已在盒中；search_bricks 可查）'),
      target_dir: z
        .string()
        .describe('拼装区目录（必须不存在或为空目录——拼装区一次性，拒绝覆盖已有内容）'),
      module: z
        .string()
        .optional()
        .describe('新项目 Go module 名（闭包含 .go 文件时必填，如 example.com/assembly-001）'),
      go_version: z.string().optional().describe('go.mod 的 go 版本声明（默认 1.25.5）'),
      box_dir: z.string().optional().describe('积木盒根目录（默认 <cwd>/.agent-io/bricks）'),
      write: z.boolean().optional().describe('false 只预演：输出搬运计划与 import 重写预览，不落盘（默认 true）'),
    },
    handler: wrapData(async (a) => {
      const r = await assembleBricks(a as unknown as AssembleBricksInput);
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'slim_brick',
    title: 'Slim a Go brick into a derived -slim brick (compiler-style dead-code pruning)',
    description:
      '积木瘦身（Brick Harvest Phase 6：效仿 Go 编译器的死代码消除）——按入盒时存档的 live 集' +
      '（slim_candidates.live_symbols_by_file，种子可达性 BFS 的事实档案）调用 go-slim 剪刀' +
      '（go/ast 声明过滤 + 包内不动点 + import 剪枝），把盒内 Go 积木剪成 <brick>-slim 衍生积木回盒。' +
      '纪律：原积木永不覆盖（衍生积木是机器产物，删除后重跑本工具可再生成）；非 Go 文件原样搬运' +
      '（embed 资产等）；无可剪内容不生成空壳。可选 verify_build：临时目录 go build ./... 当场编译验证' +
      '（需 Go 工具链+网络），结果写 slim_verification.build。四层验证剩余三层（源测试/observe/效果验收）' +
      '由人后续补——剔除生效前请人工补验。',
    inputSchema: {
      brick_name: z.string().describe('原积木名（盒内 <box_dir>/<brick_name>；须为 Go 积木且带 slim_candidates live 档案）'),
      box_dir: z.string().optional().describe('积木盒根目录（默认 <dataHome>/.agent-io/bricks）'),
      name: z.string().optional().describe('衍生积木名（默认 <brick_name>-slim）'),
      verify_build: z
        .boolean()
        .optional()
        .describe('true：临时目录 go build ./... 编译验证（需 Go 工具链与网络拉依赖），结果写 slim_verification.build（默认 false）'),
      write: z.boolean().optional().describe('false 只预演不落盘（剪刀跑进临时目录，产出仅进报告；默认 true）'),
    },
    handler: wrapData(async (a) => {
      const r = await slimBrick(a as unknown as SlimBrickInput);
      return { message: r.message, data: r };
    }),
  },
];
