/**
 * harvest 线（5 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ 2026-10-01（④-2 按能力改判整条线）：本线 6 → 5 —— `sync_contracts` **改判到 `meta` 线**。
 *   判据（用户裁定「根据他的能力重新重构整个能力线」）：它的能力是
 *   「**以注册表为事实源**，把工具契约回填进 DSL」，这是**元数据 / 注册**的能力，**不是"收割"**；
 *   且它与同样以工具目录为输入的 `capability_map`（在 `meta` 线）**同族**。
 *   ⇒ 一并搬到 `application/meta/registry/sync_contracts.ts`（实现）+ `meta/index.ts`（工具定义）。
 *   ★ 这同时**消灭了 5 条已知 `no-circular`**（`handlers → sync_contracts → 聚合器 → <线>/index.ts`）：
 *     它的目录改由 `meta/capability_map` 叶子注入（`listToolDefs()`），**不再静态 import 聚合器**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const HARVEST_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'harvest'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 * ★ 2026-09-29（面收敛**第二批**）：本线 9 → 6 —— 「积木盒」四品（检索 / 拼装 / 瘦身 / 对账）
 *   收编为单入口 `bricks`（action=search/assemble/slim/reconcile）。它们操作的是**同一个对象**
 *   「积木盒 `<box_dir>/.agent-io/bricks/`」，共用同一锚点参数 `box_dir`，动作互补成一条价值链
 *   **找 → 拼 → 剪 → 验**（原积木**检索**那个入口的 description 就写着"我要 X 功能 → 找到积木 →
 *   拎取拼装"这条链）⇒ 按 `docs/tool-convergence.md` §2.0「按操作对象聚合」口径合一。
 *   ★ **同笔判为「不该合」并停手的一族**：`harvest_decisions` / `harvest_closure` / `harvest_from_url`
 *   —— 三者**不共用**任何锚点（`feature` vs `project_dir`+`files` vs `source`）、**不共用**操作对象
 *   （决策卡候选 vs import 闭包 vs 积木盒），且 `harvest_closure` 是 `harvest_from_url` 的**一步**、
 *   同时被 `dead_deps` / `detect_dead_imports` 当库调用 ⇒ 那是「按功能/前缀」聚类（§2.0 反面教训
 *   `camera_*` 的形态：看似同对象、实为不同抽象层/不同对象），**不合**。判据与证据见 commit message。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { requireStr, wrapData } from '../plumbing.js';
import path from 'node:path';
import { assembleBricks } from './assemble_bricks.js';
import type { AssembleBricksInput } from './assemble_bricks.js';
import { extractContracts } from './extract_contracts.js';
import type { ExtractContractsInput } from './extract_contracts.js';
import { harvestClosure } from './harvest_closure.js';
import type { HarvestClosureInput } from './harvest_closure.js';
import { harvestFromUrl } from './harvest_from_url.js';
import type { HarvestFromUrlInput } from './harvest_from_url.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import { reconcileBrick } from './reconcile_brick.js';
import type { ReconcileBrickInput } from './reconcile_brick.js';
import { searchBricks } from './search_bricks.js';
import type { SearchBricksInput } from './search_bricks.js';
import { slimBrick } from './slim_brick.js';
import type { SlimBrickInput } from './slim_brick.js';
import { harvestDecisionsHandler } from '../handlers.js';
import type { ToolDef } from '../types.js';

export const HARVEST_TOOLS: ToolDef[] = [
  {
    name: 'harvest_decisions',
    title: 'Harvest decision-card candidates from docs / git log / comments',
    description:
      '决策卡补录：从项目文档（docs/*.md）、git 日志、源码注释粗提取设计意图线索，生成 draft 决策卡候选（含出处 ref + 原文 evidence + 一句话总结）。' +
      '不直接写 DSL——LLM review 核对出处后，定稿（status: active）再通过决策卡工具写入 DSL，防编造。' +
      '候选带 lifecycle_hint（下线/合并/取代/拆分），供 diff 与下线库（`archive` action=node/list）参考。' +
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
    name: 'bricks',
    title: 'Brick box: search the shelf / assemble a project / slim a brick / reconcile with observations — single entry',
    description:
      '积木盒统一入口（**4 个注册入口收敛为 1 个入口 + action 分派**；四者操作的是**同一个对象**「积木盒」，' +
      '共用同一锚点参数 box_dir，动作互补成一条价值链 **找 → 拼 → 剪 → 验**）。' +
      '积木盒 = <box_dir>/，每块积木一个自包含目录（闭合文件快照 files/ + contracts.json 契约 + manifest.json 聚合清单）。' +
      'action=search（**只读**，货架检索）：浏览/检索盒内积木——"拎之前先看它要什么、给什么"。三种模式：' +
      '①浏览（无参数：全部积木概况——语言/来源/规模/exposes/验证状态）；' +
      '②检索（query 关键词打分：积木名 > 形状名 > 字段名 > 人话介绍，matched 明细可追溯）；' +
      '③详情（name 精确：完整契约——形状 fields、effects 全清单、不变量断言、闭包、observe 验证档案）。' +
      '过滤：language / verified（有运行证据）/ has_invariants / zero_third_party（拎走即跑）。' +
      '数据源是盒内 manifest.json 自包含档案（跨项目资产的统一命名空间就是盒本身，不碰项目 cache.db）。' +
      'action=assemble（**写**，拼装区）：把盒内已验证积木搬进一个**全新的拼装区目录**，拼出新项目骨架。' +
      '纪律：每次拼装一个新目录，绝不在原项目上抽取和拼装（原项目永远只读）。布局 <target>/<积木名>/<原闭包相对路径>。' +
      'import 重接：TS/JS 零改动（闭包内相对位置不变）；Go 按闭包目录最长后缀匹配识别内部 import 并重写为 ' +
      '<module>/<积木名>/<后缀>，并生成 go.mod（require 版本从各积木 go_mod_requires 存档原样取用——不猜不升版；' +
      '多积木同库不同版本 MVS 取高并留 version_conflicts）。' +
      'action=slim（**写**，衍生积木）：效仿 Go 编译器的死代码消除——按入盒时存档的 live 集' +
      '（slim_candidates.live_symbols_by_file，种子可达性 BFS 的事实档案）调用 go-slim 剪刀' +
      '（go/ast 声明过滤 + 包内不动点 + import 剪枝；TS 走 tree-sitter 剪刀），把盒内积木剪成 <brick>-slim 衍生积木回盒。' +
      '纪律：原积木永不覆盖（衍生积木是机器产物，删除后重跑可再生成）；无可剪内容不生成空壳。' +
      'action=reconcile（**写**，动静对账）：读 observe effect 事件与盒内 contracts.json 对账——' +
      '候选命中观测 ⇒ origin ast→runtime **转正**；候选外新观测 ⇒ 补进契约 + incomplete 告警（静态漏了）；' +
      '未触发候选保持 ast（不证伪），gap_notes 登记人工归因。证据档案写 manifest.effect_verification' +
      '（重抽保留字段——快照可重抽，运行证据只有一份）。' +
      '★ 安全策略前移（**默认值明写在这里**，不是隐藏知识）：assemble / slim / reconcile 的 write **缺省 true ⇒ 默认会落盘**' +
      '（与收敛前逐字同语义，本入口**没有**偷偷改成 dry-run）；要只预演（搬运计划 / 剪枝报告 / 对账结果不落盘）必须**显式** write=false。' +
      'assemble 的 target_dir 必须**不存在或为空目录**（拒绝覆盖）；slim 的原始积木**永不覆盖**。' +
      '★ 与 harvest_from_url 的分工：harvest_from_url 是"从 URL/本地工程**抽积木入盒**"（产出入盒）；本入口管**盒内已有**的积木。' +
      '★ 与 reconcile_effects 的分工：本入口对账对象是**积木盒内**的契约（跨项目复用资产）；' +
      'reconcile_effects 对账的是**某个项目 DSL** 里的契约。',
    inputSchema: {
      action: z
        .enum(['search', 'assemble', 'slim', 'reconcile'])
        .describe('search=检索/浏览积木盒（只读） | assemble=把盒内积木拼装进新目录（写） | slim=把积木剪成衍生积木回盒（写） | reconcile=用 observe 事件对账盒内契约（写）'),
      // ── 共用锚点（4 个 action 都认）──
      box_dir: z
        .string()
        .optional()
        .describe('积木盒根目录（4 个 action 共用锚点；缺省 = getStorageRoot()/bricks 即 <dataHome>/.agent-io/bricks，与 harvest_from_url 同源）'),
      // ── search ──
      query: z.string().optional().describe('search 用：关键词检索（多词独立打分求和：命中积木名/形状名/字段名/description）'),
      language: z.enum(['go', 'typescript', 'python', 'javascript']).optional().describe('search 用：语言过滤（闭包文件扩展名推断）'),
      verified: z.boolean().optional().describe('search 用：只看有 observe 运行验证的（effect_verification 档案）'),
      has_invariants: z.boolean().optional().describe('search 用：只看有数学不变量的（acceptance.invariants 存在且非空）'),
      zero_third_party: z.boolean().optional().describe('search 用：只看零三方依赖的（拎走即跑）'),
      // ── search / slim 同名不同义（★ 按 action 读）──
      name: z
        .string()
        .optional()
        .describe('★ search 用 = 精确积木名 ⇒ 详情模式（完整契约输出）；slim 用 = 衍生积木名（缺省 <brick_name>-slim）。两个 action 的 name 含义不同，按 action 读'),
      // ── assemble ──
      bricks: z.array(z.string()).optional().describe('assemble 用：要拼装的积木名列表（非空；须已在盒中，action=search 可查）'),
      target_dir: z
        .string()
        .optional()
        .describe('assemble 用：拼装区目录（必须不存在或为空目录——拼装区一次性，拒绝覆盖已有内容）'),
      module: z.string().optional().describe('assemble 用：新项目 Go module 名（闭包含 .go 文件时必填，如 example.com/assembly-001）'),
      go_version: z.string().optional().describe('assemble 用：go.mod 的 go 版本声明（默认 1.25.5）'),
      // ── slim / reconcile ──
      brick_name: z
        .string()
        .optional()
        .describe('slim 用：原积木名（盒内 <box_dir>/<brick_name>，须带 slim_candidates live 档案）；reconcile 用：积木名（搭配 box_dir 定位 <box_dir>/<brick_name>）'),
      verify_build: z
        .boolean()
        .optional()
        .describe('slim 用：true = 临时目录 go build ./... 编译验证（需 Go 工具链与网络拉依赖），结果写 slim_verification.build（默认 false）'),
      // ── reconcile ──
      brick_dir: z.string().optional().describe('reconcile 用：积木目录（含 contracts.json；与 brick_name 二选一）'),
      events_files: z.array(z.string()).optional().describe('reconcile 用：显式事件文件列表（缺省自动发现）'),
      verify_dir: z.string().optional().describe('reconcile 用：验证项目根目录（自动发现其 .agent/observe/events-*.jsonl）'),
      gap_notes: z
        .record(z.string(), z.string())
        .optional()
        .describe('reconcile 用：未观测候选归因（键=<文件名>|<target>，值=归因说明：not_triggered/probe_gap/static_only）'),
      known_blind_spots: z.array(z.string()).optional().describe('reconcile 用：已知盲区（写入证据档案）'),
      method: z.string().optional().describe('reconcile 用：对账方法描述（写入证据档案，如"instrument --effects + golog-verify 驱动"）'),
      // ── 写策略（assemble / slim / reconcile 共用）──
      write: z
        .boolean()
        .optional()
        .describe('assemble/slim/reconcile 用：★ 缺省 **true = 会落盘**（与收敛前逐字同语义）；要只预演必须显式传 false；search 是只读 action，本参数对它无效'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'search' | 'assemble' | 'slim' | 'reconcile' | undefined;
      // ★ 前置校验（安全策略前移第一半）：入口先判，缺参/非法值**当场报错**
      //   （旧入口没有这一层：四个 action 各自的必填项都由 [B] 兜，错误文案不如这里直白）。
      if (action !== 'search' && action !== 'assemble' && action !== 'slim' && action !== 'reconcile') {
        throw new Error(`缺参数或非法 "action"（可选值：search / assemble / slim / reconcile）`);
      }

      if (action === 'search') {
        const r = await searchBricks(a as unknown as SearchBricksInput);
        // ★ 回执编排：把 [B] 已解析好的**盒根**点出来（它的 message 不含盒路径，盒路径只在 data.box_dir；
        //   而缺省盒是 <dataHome> 下的，agent 不点名就不知道刚才查的是哪个盒）。
        return { message: `${r.message}\n  盒：${r.box_dir}`, data: r };
      }

      if (action === 'assemble') {
        // ★ 前置校验：两个必填项在 [C] 先判（[B] 对 target_dir 缺参会抛 path.resolve(undefined) 的
        //   底层 TypeError —— 不是给人看的错误）。
        if (!Array.isArray(a.bricks) || a.bricks.length === 0) {
          throw new Error('缺参数 "bricks"（要拼装的积木名列表，非空；action=search 可查盒内清单）');
        }
        const target_dir = requireStr(a, 'target_dir');
        const r = await assembleBricks({ ...(a as unknown as AssembleBricksInput), target_dir });
        // ★ 回执编排：message 已含"拼装完成/预演 + 积木数 + 落位目录"，不再重复。
        return { message: r.message, data: r };
      }

      if (action === 'slim') {
        const brick_name = requireStr(a, 'brick_name');
        const r = await slimBrick({ ...(a as unknown as SlimBrickInput), brick_name });
        // ★ 回执编排：点出衍生积木的**落盘目录**（[B] 的 message 只给名字，目录在 data.slim_dir）。
        return { message: `${r.message}\n  衍生积木目录：${r.slim_dir}`, data: r };
      }

      // reconcile
      const r = await reconcileBrick(a as unknown as ReconcileBrickInput);
      // ★ 回执编排：点出**实际对账的积木目录**（[B] 的 message 只给 basename，全路径在 data.brick_dir）。
      return { message: `${r.message}\n  积木目录：${r.brick_dir}`, data: r };
    }),
  },
];
