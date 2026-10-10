/**
 * harvest 线（3 个工具）—— ★ **本文件即该线归属的唯一来源**。
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
 * ★ 2026-10-05（用户裁定「积木盒/拼装/杂交族作为万能框架实现不了，删掉，改留设计文档」）：
 *   本线 5 → 3 —— 删除 `bricks`（积木盒统一入口 search/assemble/slim/reconcile）与
 *   `harvest_from_url`（从 URL/本地工程抽取积木入盒）。依据：跨语言桥接实现量为 0
 *   （只有 TS/JS 零改动 + Go import 重写/go.mod），且从未端到端跑通过。
 *   同笔删除 cross 线的 `hybrid_precheck`、`go-slim/` 剪刀及其派生死代码（hybrid/、packages/go_mod·npm_mod）。
 *   本线保留 `harvest_decisions` / `harvest_closure` / `extract_contracts`（三者各有独立承重）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { requireStr, requireArr, wrapData } from '../plumbing.js';
import path from 'node:path';
import { extractContracts } from './extract_contracts.js';
import type { ExtractContractsInput } from './extract_contracts.js';
import { harvestClosure } from './harvest_closure.js';
import type { HarvestClosureInput } from './harvest_closure.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import { harvestDecisionsHandler } from './handlers.js';
import type { ToolDef } from '../types.js';

export const HARVEST_TOOLS: ToolDef[] = [
  {
    name: 'harvest_decisions',
    title: 'Harvest why-a-file-exists decision leads from three evidences (code / history / docs)',
    description:
      '决策卡补录：**逐个文件**问 LLM「这个文件为什么存在」（= 该文件存在的**理由**，不是"做什么"），产出**决策线索**。' +
      '★ **三份证据各抽一次**（三个 loop，各自取、各自判）：① code = 该文件的符号/导出/依赖/被谁引用（读 cache.db）；' +
      '② history = 该文件的 git 提交（何时出现、改过几次、每次提交的理由）—— 逐文件读 `git log -- <file>`；' +
      '③ docs = docs/ 里提到它的地方 + 它自己的文件头注释/正文。' +
      '★ **产出契约（三要素缺一不可）**：结论（为什么存在）· 出处（`文件:行` 或 `git:<hash>`）· 作用对象（该文件）—— 填不出就**产不出**（不是"收下再过滤"）。' +
      '★★ `votes` = **支持同一说法的证据源个数**（1..3，多源印证 = 置信，非"抽三次的稳定性"）；' +
      '不收敛时最高票仍只出一条（**一个文件最多一条**），其余结论进 `alternatives`（各带票数 + `evidence_source`，不丢）。' +
      '★★ **「判」可开可关**（`judge`）：判开（有密钥 / judge:true）⇒ 产候选；**判关**（judge:false，或没配密钥的自动档）' +
      '⇒ ★ **降级为"只给三份证据"**（`evidence_by_file`，未经 LLM 判断，调用方自己判），**回执必明说"本次没判"**（不静默降级）。' +
      '只产 `status:draft` 线索、**不写 DSL**——写回文件节点用 `edit_dsl`（type=decision；★ 未决分歧进 data.dissent，不是 data.alternatives）。' +
      '适用：为没有决策卡历史的现有项目/外来代码补录活文档。',
    inputSchema: {
      feature: z.string().describe('feature 名（候选挂载目标）'),
      doc_dir: z.string().optional().describe('文档目录（扫描 *.md），默认 <cwd>/docs'),
      git_root: z.string().optional().describe('git 仓库根（读 git log），默认 <cwd>'),
      limit: z
        .number()
        .optional()
        .describe(
          '产出条数上限（**可选**）：判开（candidates）与判关（evidence_by_file）两档都生效，超出即截断' +
            '（回执明写"共 N 条、只显示前 M 条"，不静默）。★ **不传 = 不设上限**（返回全部，行为与改造前一致）。' +
            '★ 每文件 git 历史条数由独立常量 GIT_LOG_LIMIT=30 控制，不受本参数影响。',
        ),
      comment_files: z
        .array(z.string())
        .optional()
        .describe('要提取注释的源码文件；缺省 = 扫描项目已索引的全部源码文件'),
      judge: z
        .boolean()
        .optional()
        .describe('「判」开关：true=强制判（无 LLM 密钥则报错）；false=不判、降级为"只给三份证据"；省略=自动（有密钥就判）'),
    },
    // ★ CLI 面绕过 zod 必填校验：缺 feature 时 [B] 会把 undefined 拼进扫描路径/git 命令（泄漏 git 原始报错）。
    //   本层只加守卫；随后**原样**委托已包装的 harvestDecisionsHandler（其 isError 语义保持不变）。
    handler: wrapData(async (a) => {
      const feature = requireStr(a, 'feature');
      const r = await harvestDecisionsHandler({ ...a, feature });
      if (r.isError) throw new Error(r.text);
      return { message: r.text };
    }),
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
      // ★ CLI 面绕过 zod 必填校验：缺 project_dir/files 时会把 undefined 交给 path.resolve / files.map（Node 原始异常）。
      const project_dir = requireStr(a, 'project_dir');
      const files = requireArr(a, 'files', "['src/a.ts']");
      const input = { ...(a as unknown as HarvestClosureInput), project_dir, files: files as string[] };
      // ★ 零前置：闭包沿 import 边算，空缓存先就地冷启
      await ensureProjectIndex(path.resolve(project_dir));
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
      // ★ CLI 面绕过 zod 必填校验：缺 project_dir 时 path.resolve(undefined) 抛 Node 原始异常。
      const project_dir = requireStr(a, 'project_dir');
      const input = { ...(a as unknown as ExtractContractsInput), project_dir };
      // ★ 零前置：空缓存就地冷启（契约提取建立在符号/AST 索引之上）
      await ensureProjectIndex(path.resolve(project_dir));
      const r = extractContracts(input);
      return { message: r.message, data: r };
    }),
  },
];
