/**
 * meta 线（12 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ 2026-10-11（BB 笔）：本线 11 → 12 —— `tool_usage`（工具使用 / 覆盖读数）接进 MCP 面。
 *   动因：「**"什么被保证 / 什么被用过"没有工具面**」——
 *   `usage.jsonl` 此前只有**不在注册表**的 `npm run dogfood` 能读，且它只答"共 N 次 + 成功率表"，
 *   答不了「**注册了但从未用过**」（死工具）与「**用过但已不在注册表**」（过期记录）。
 *   ★ 统计**不重造**：本工具复用 `dogfood_stats.ts`，只补**集合差**那一维（见 `infrastructure/dogfood_coverage.ts`）。
 *
 * ★ 2026-10-06（T15 切片）：本线 10 → 11 —— `upgrade`（版本升级契约差：检测 + 局部重写闭环）从
 *   **CLI-only**（`upgrade_cli` 五阶段检测 / `upgrade_rewrite_cli` git 验证回退闭环）接进 MCP 面。
 *   ★ 两个 CLI 收成**一个入口**的依据：它们审的是**同一操作对象**「项目的版本升级契约差」
 *     （后者把前者的检测**整段再跑一遍**，只多"计划 + 应用闭环"）⇒ 动作互补 = 读（`scan`）+ 写（`apply`），
 *     按 `docs/tool-convergence.md` §2.0「按操作对象聚合」合一。核心归位到 `meta/upgrade/upgrade.ts`，
 *     两个 CLI **退化成薄壳**（与 `deprecate_offline` 同笔法）。
 *
 * ★ 2026-10-05（T15 切片）：本线 9 → 10 —— `capability_audit`（语言×功能能力矩阵缺口自检）从
 *   **CLI-only**（`capability_cli`）接进 MCP 面。★ 顺带更正 T15 的一条误判：原先以为
 *   `capability_cli` 的等价物 `capability_map` 已存在、可删 CLI —— **错**：`capability_map` 是
 *   「6 条能力线 × 工具」的**工具导航**，本工具审的是**语言支持度**（功能×语言），两者只有名字像。
 *
 * ★ 2026-10-01（④-2 按能力改判整条线）：本线 8 → 9 —— `sync_contracts` 从 `harvest` 线**改判**进来
 *   （与 `capability_map` 同族：都以"工具注册表"为事实源）。实现文件 `meta/sync_contracts.ts`。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const META_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'meta'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 * ★ 2026-09-29（面收敛**第二批**）：本线 9 → 8 —— 「下线库」两品（归档 / 列条目）收编为单入口
 *   `archive`（action=node/list）。两者操作的是**同一个对象**「下线库」（同一 feature 的归档条目，
 *   住在 `<live_dir>/.agent-io/archive/<feature>/`），共用同一锚点 `feature`，动作互补 = 写 + 读
 *   ⇒ 按 `docs/tool-convergence.md` §2.0「按操作对象聚合」口径合一（与 `snapshot` 的 list/rollback 同型）。
 *   ★ 同笔**逐项判断后不动**的邻居（不是漏）：`explore_code`（已是 11-action 聚合体）、
 *   `canvas_notes`（read/mark/decide 已聚合）、`gateway_provider`（list/upsert/delete/stats 已聚合）
 *   —— 三者都已是 §2.0 的"已落地样板"；`diagnose`（症状→根因，独一对象）、`read_project_docs`（项目文档）、
 *   `capability_map`（导航）、`index_integrity`（索引自检）各自操作对象不同，**判不明/不该合 ⇒ 留着**
 *   （理由逐条见 commit message）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import path from 'node:path';
import { requireStr, wrapData } from '../plumbing.js';
// ★ T202：诊断闭环的 [B]（`optionalBool/Num` 与 `requireStr` 是**同一处**判据 —— `plumbing`）。
import { optionalBool, optionalNum } from '../plumbing.js';
import type { DiagnoseLoopInput } from './diagnosis/diagnose_loop.js';
import { diagnoseLoop } from './diagnosis/diagnose_loop.js';
import type { DiagnoseInput } from '../../infrastructure/analysis/diagnosis/contract.js';
import { formatDiagnoseText, runDiagnosis } from '../../infrastructure/analysis/diagnosis/diagnose.js';
import { getDSL, saveDSL, requireProjectRoot } from '../../infrastructure/storage.js';
// ★ 2026-10-23：画布三格已搬出设计 DSL ⇒ `canvas_notes` 的读写走 `canvas_store`。
import { readStructureConfig } from '../../infrastructure/analysis/structure/structure_gap.js';
import { archiveNode, listArchive } from './archive/archive_node.js';
// ★ T186（2026-10-12）：「待确认的 PR」的读与定 —— ★ **PR 的确认人是下一个接手的 Agent**，不是人
// ★ T186b（2026-10-12）：observe 侧那套提案（此前**只有 HTTP**）的 MCP 口。
//   ★ 四层门 (`approveGated`) **自己就是判据**；`ProposalStore` / `DesignDSLStore` / `defaultDSLDir`
//     都**复用**仓储层已有的那几处（★ 不在这里再推一遍"提案库在哪"）。
import { ProposalStore } from '../../infrastructure/analysis/observe/proposal_store.js';
import { approveGated } from '../../infrastructure/analysis/observe/approve_gated.js';
import { DesignDSLStore, defaultDSLDir } from '../../infrastructure/analysis/observe/dsl_store.js';
import { validateProjectRoot } from '../../infrastructure/dictionary.js';
// ★ T15 切片（2026-10-06）：版本升级契约差（检测 + 局部重写闭环）—— 核心与两个 CLI 同源，
//   现归位到 `meta/upgrade/upgrade.ts`（见本文件头注）。
import { upgradeHandler } from './upgrade/upgrade.js';
import {
  bindDomains,
  LANE_IDS,
  listToolDefs,
  makeCapabilityMapHandler,
  catalogOf,
  collectInputPaths,
  declaredRequiredMembersOf,
  resetDomainsForTest,
} from './registry/capability_map.js';
import type { DomainNavView, InputPath, LaneId } from './registry/capability_map.js';
// ★ T15 切片（2026-10-05）：`capability_audit` 的核心（与 `capability_cli` 同源）。
import { probeInstalledLanguages } from '../../infrastructure/parse/probe.js';
import {
  allCapabilities,
  aggregateGaps,
  diagnoseCapabilities,
  diagnoseCapabilitiesByEntries,
  languageCatalog,
  renderAuditText,
} from '../../infrastructure/analysis/capability/capability_matrix.js';
// ★ 触发默认登记（**side-effect import**，确保矩阵被填充）—— 与 `capability_cli` 同款；
//   漏了它会报"空矩阵"（`allCapabilities().length === 0`），那是**静默少报**而不是报错。
import '../../infrastructure/analysis/capability/register_capabilities.js';
import { EXPLORE_ACTIONS } from './explore/explore_code.js';
// ★ 契约页 / 类型页（2026-10-11）：给定符号名一次给全（定义/成员/产者/消费者/接法边/词表口径）——
//   聚合既有权威（内核 AST · find_references · CHAIN_EDGES · b_terms），**不新算**。
import { contractPage, renderContractPage } from './explore/contract_page.js';
// ★ 生成「下一棒入参」（2026-10-11）：把上一步的 `touched` **组装成**下一步**可跑的入参 JSON** ——
//   能填的替它填好、意图位（如新名 `to`）**显式留空并标注**。判据全部复用 `chain_wiring` 的
//   `nextHopsOf`/`applyChainEdge` 与 `capability_map` 的 `collectInputPaths`（**只端，不新做**）。
import { nextHopArgs, renderNextHopArgs } from './explore/next_hop_args.js';
// ★ 起手入参（2026-10-11）：把"知道用哪个工具 → 到把第一棒入参凑齐"那一步端上来 ——
//   `next_hop_args` 的**同族**（一个管"下一棒"、一个管"第一棒"）。判据全部复用 `CHAINS`/`hopsOf`
//   与 `collectInputPaths`/`declaredRequiredMembersOf`（**只端，不新做**）。
import { firstHopArgs, renderFirstHopArgs } from './explore/first_hop_args.js';
import { deleteProvider, getStats, listProvidersMasked, resetStats, upsertProvider } from '../../infrastructure/llm_gateway.js';
import { indexIntegrity, renderIntegrity } from './integrity/index_integrity.js';
// ★ BB 笔（2026-10-11）：把「什么被用过 / 覆盖缺口」接进**工具面** ——
//   `npm run dogfood`（`dogfood_stats.ts`）此前是**唯一**读得到那份日志的入口，而它**不在工具面**里
//   ⇒ agent 拿不到。本工具**复用**它的统计（一行都不重造），只补「注册表 − 用过的 / 用过的 − 注册表」两维。
import { computeDogfoodCoverage, renderDogfoodCoverage } from '../../infrastructure/dogfood_coverage.js';
import { decideCanvasNotes } from './llm/llm_decider.js';
import { buildDocsPromptBlock, listProjectDocs, matchDocsForTargets, readProjectDoc } from './docs/project_docs.js';
import type { DocTargetSet } from './docs/project_docs.js';
import { exploreCodeHandler, syncContractsHandler } from './handlers.js';
import type { ToolDef } from '../types.js';
// ★ T54：接续段的三件套 —— **规则住在 domain，这里只渲染**（别在本文件重推一遍）
import { nextHopsOf, universalHopsOf, applyChainEdge, SCOPE_PATHS } from '../../domain/chain_wiring.js';


/**
 * ★★★ 2026-10-11（T139-3）：`touched` 的**入参声明**（对象）—— `next_hop_args` 与 `capability_map` 的「接续段」**共用一份**。
 *
 * ## 为什么是**对象**而不是"原样 stringify 的字符串"
 * `Touched`（`src/domain/b_terms.ts`）是 **7 个明确字段**的基本类型结构（`feature` / `project_dir` /
 * `written_files` / `scope_files` / `symbols` / `nodes` / `file`），**不是** `Record<string, unknown>` 那种"袋子"
 * ⇒ 完全可以在 zod 里**逐字段声明**。上游 `---DATA---` 里的 `touched` 因此可以**原样嵌进入参**，**零手工 stringify**。
 *   ★（旧版声明成 `.string()` 并让调用方手工 `stringify`，理由是"对象在这里只能声明成袋子"—— ★ 该理由**不成立**：
 *     "袋子" = `Record<string, unknown>`，而 `Touched` 是**7 个明确字段** ⇒ 两回事。）
 * ★ 单一来源：**两个消费点共用本 shape**，避免"同一个 `touched` 两处各声明一份"（本仓头号病：判据分叉）。
 * ★ **不改** `Touched` 本身的类型（`b_terms.ts`）—— 本笔只改"入参怎么声明"。
 */
const handoffTouchedShape = {
  feature: z.string().optional().describe('作用到的 feature（DSL 活文档单元）'),
  project_dir: z.string().optional().describe('作用到的项目根（解析后的绝对路径）'),
  written_files: z.array(z.string()).optional().describe('被写入/改动的文件（仓库相对路径）'),
  scope_files: z.array(z.string()).optional().describe('被框定/被审阅的作用面（仓库相对路径；只读也成立）'),
  symbols: z.array(z.string()).optional().describe('涉及到的符号标识（模块级裸名 / `Class.method`）'),
  nodes: z.array(z.string()).optional().describe('涉及到的 DSL 节点 id'),
  file: z.string().optional().describe('本次操作的那个对象所在的文件（单数）'),
};

/**
 * `touched` 入参的**运行时守卫**（缺/非对象 ⇒ 当场报人话，不是 Node 原始异常）。
 *
 * ★ 为什么还要它（zod 已在 MCP 面校验过对象）：**CLI 面绕过 zod**（见 `plumbing.ts` 的 `requireStr` 头注）
 *   ⇒ 缺参数时若不守，`Object.keys(undefined)` 会抛 `Cannot read properties of undefined`，用户看不懂。
 * ★ 与 `requireStr` / `requireArr` 同一条纪律（"缺参数"报人话），只是这里守的是"是对象"。
 */
function touchedObjectOf(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('缺参数或不合法 "touched"（应为上一步 `---DATA---` 里的那个 `touched` 对象，原样传入）');
  }
  return v as Record<string, unknown>;
}


/**
 * capability_map 的目录必须来自**真实注册表**（不能自己再维护一份清单）——
 * 但它属于 meta 线，而目录是由**各 lane 汇总**出来的 ⇒ 结构上成环。
 *
 * ★ 破环方式（P1b，2026-09-28 起；2026-10-01 ④-2 把 ref 下移到叶子）：
 *   这里**不 import 聚合器**，目录由 `application/tool_registry.ts` 汇总完后
 *   经 `capability_map.bindToolDefs()` 注入，读取走 `capability_map.listToolDefs()`。
 *   ★ 注入点之所以放在 `capability_map.ts`（叶子）而不是本文件：本文件被聚合器 import
 *     ⇒ 任何"从本文件出发能走到聚合器"的模块都会成环（`sync_contracts` 即一例）。
 *   未注入时 `listToolDefs()` 直接**抛错**，不给"看起来能用"的空目录
 *   （"不许静默降级"，见 docs/architecture-refactor-plan.md §2d）。
 */
export const META_TOOLS: ToolDef[] = [
  {
    name: 'explore_code',
    title: 'Explore, analyze and understand code',
    description:
      '代码理解统一入口：通过 action 参数化执行各类分析。' +
      `action: ${EXPLORE_ACTIONS.join(' / ')}。` +
      '语义搜索/读取/架构分层/导览/巨石分析/思维导图/仿真/文件监听。' +
      'args 为各 action 的具体参数。' +
      '★ 2026-10-21：diff_impact / inject_replay / derive_split / derive_chain / derive_anim_flow / ' +
      'derive_algorithm 已从本工具移除（实测调用 146-179 次、成功 0-3 次）—— ' +
      '影响面改用 impact_analysis；注入回放与回放观测改用 observe_instrument + observe_trace；' +
      '文件拆分/调用链改用 feature_line + structure_gap。' +
      '★ 按需选用与必填项（缺任一项即报错，别空调）：' +
      '巨石体检用 check_monolith（给 project_dir|feature|files 之一）；' +
      '读文件内容用 read（硬必填 file）；' +
      '★ 读源码用 read，读索引事实用 facts（硬必填 file；fields 选列，默认集不含 body_text）：' +
      'facts 读 cache.db 的 nodes（索引那一刻的签名/形参/返回类型/成员/函数体原文），' +
      '带同源校验（contentHash(当前源码) === files.content_hash）—— 与源码不同源就报错、绝不回旧快照；' +
      '盯文件变更用 watch（硬必填 project_dir）；' +
      '看模块导览用 guided_tour（硬必填 feature）；' +
      '生成模块思维导图用 derive_mind_map（硬必填 feature）；' +
      '跑事件仿真用 run_simulation（硬必填 feature）；' +
      '复位仿真用 reset_simulation（硬必填 feature）。' +
      'read 是 edit_code 的"先读后改"前置：按符号定位（symbol，+parent 消歧，+context 附带上下文）' +
      '或行区间（start/end，1-based 含端点）读文件，返回带真实行号的内容；' +
      '返回的 start/end/行号与 edit_code(op=range) 同基准（line_utils.splitKeepEnds 下标+1=行号），' +
      '可直接把 read 的行号喂给 edit_code，杜绝行号漂移改错行。' +
      'read 默认在 data.symbols 附整文件符号索引（name/kind/行号/签名，message 末尾附可读符号表，上限30截断），' +
      '一次 read 同时拿到正文+文件地图，symbols:false 可关。' +
      'search 三层路由：标识符查询（如 normalizeCode / Calc.reset）→ 精确符号索引（provider=exact，零向量开销）；' +
      '自然语言意图 → 语义向量相似度；无 embedding 配置/失败 → FTS trigram 降级。' +
      'search 必填 args.project_dir（目标项目根目录，缺省报错）+ args.query（空则返回『查询为空』提示），可选 top_k；' +
      'arch_layer 必填 feature（不吃 project_dir）；影响面分析请改用 impact_analysis（本工具 2026-10-21 起不再接 diff_impact）。' +
      'watch 支持 impact_on_change=true：文件变更后自动生成影响报告（一行摘要入 alerts，' +
      'action=status 查看未读提醒，action=impact + seq 取全文；报告持久落盘 .agent-io/impact/）。' +
      '改代码前建议 action=declare + files 登记预告（Impact Ledger）：改后自动对比实际波及，' +
      '计划外扩散即时报警。预告持久化 ledger.json（跨会话恢复，24h 未消费过期）；' +
      'action=ledger 查台账，violated 用 resolve_id + reason 过门处理（status 播报未处理数）。',
    inputSchema: {
      action: z.enum(EXPLORE_ACTIONS).describe('要执行的代码理解动作'),
      args: z.record(z.string(), z.unknown()).optional().describe('各 action 参数'),
    },
    handler: exploreCodeHandler,
  },

  {
    name: 'archive',
    title: 'Retired-node library: archive a node / list archived entries — single entry',
    description:
      '「下线库」统一入口（**2 个注册入口收敛为 1 个入口 + action 分派**；两者操作的是**同一个对象**' +
      '「某 feature 的下线库归档条目」（条目住在 `<live_dir>/.agent-io/archive/<feature>/`），' +
      '共用同一锚点参数 feature，动作互补 = 写 + 读）。' +
      'action=node（**写，且不可逆**）节点下线：把要下线的文件/节点孤立到下线库，存档完整 DSL 快照（含决策卡）' +
      '+ 为什么下线，作为历史研究材料，并从设计 DSL 移除（不再参与周边联系）。' +
      '"下线=两个文件合并"时传 merged_into 指向合并目标，目标文件 lifecycle.merged_from 记录来源，' +
      'diff 时 LLM 可据归档卡 + diff 增量做决策合并（不做自动合并，决策是语义的）。' +
      'action=list（**只读**）列出某 feature 的下线库归档条目：每个条目含被下线文件、下线原因、合并去向、归档时间。' +
      '★ 安全策略前移（**默认值与不可逆事实明写在这里**，不是隐藏知识）：action=node **立即落盘**' +
      '（归档条目写盘 + 从设计 DSL 移除并 saveDSL），**没有 dry_run 预览**；' +
      '同一文件**重复归档会被拒绝**（"已归档过，勿重复归档"）；设计 DSL 里不存在的文件也会被拒。' +
      '⇒ 调用前请确认该文件确实要下线；只在需要"以前为什么这么设计、为什么下线"的历史依据时用 action=list。' +
      '适用：删掉废弃模块、合并重复文件、结构重构后的清理（list 用于这类决策前的历史查证）。',
    inputSchema: {
      action: z.enum(['node', 'list']).describe('node=把文件下线归档（写，不可逆，立即落盘） | list=列出已归档条目（只读）'),
      feature: z.string().describe('feature 名（2 个 action 共用锚点）'),
      file_path: z.string().optional().describe('node 用：要下线的文件相对路径'),
      retire_reason: z.string().optional().describe('node 用：为什么下线（必填，作为历史研究材料）'),
      merged_into: z.string().optional().describe('node 用：若下线是合并（两文件合一），填合并目标文件路径'),
      live_dir: z.string().optional().describe('list 用：live/base 视图的 baseDir（可选，默认 dataHome）'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'node' | 'list' | undefined;
      // ★ 前置校验（安全策略前移）：入口先判，缺 action / 缺 feature 当场报错
      //   （旧入口由 [B] 兜：归档 [B] 抛的是"需要 file_path 与 retire_reason"，
      //    对缺 feature 的调用则一路走到 getDSL(undefined) 才失败 —— 不是给人看的一层）。
      if (action !== 'node' && action !== 'list') {
        throw new Error('缺参数或非法 "action"（可选值：node / list）');
      }
      const feature = requireStr(a, 'feature');

      if (action === 'list') {
        const r = listArchive({
          feature,
          ...(typeof a.live_dir === 'string' && a.live_dir ? { live_dir: a.live_dir } : {}),
        });
        // ★ 回执编排：message 已含"共 N 条归档"逐条清单（文件/原因/合并去向/时间），不再重复。
        return { message: r.message, data: r };
      }

      // node：不可逆写。两个必填项在 [C] 先判（[B] 的报错沿用，但直白的一层放这里）。
      const file_path = requireStr(a, 'file_path');
      const retire_reason = requireStr(a, 'retire_reason');
      const r = archiveNode({
        feature,
        file_path,
        retire_reason,
        ...(typeof a.merged_into === 'string' && a.merged_into ? { merged_into: a.merged_into } : {}),
      });
      // ★ 回执编排：把 [B] 的结构化产物点出来 —— 归档条目 id（data.archive_id）与
      //   "是否已从设计 DSL 移除"（data.removed_from_dsl）都是 agent 后续要引用的机器可读事实。
      return { message: `${r.message}\n  归档条目：${r.archive_id}（已从设计 DSL 移除：${r.removed_from_dsl}）`, data: r };
    }),
  },


  {
    name: 'observe_proposals',
    title: 'Observe proposals: list / show / approve (4-layer gate) / reject — the NEXT agent confirms',
    description:
      '「observe 提案」（代码→设计的**契约回流**）的确认入口：action = list / show / approve / reject。\n' +
      '★★★ **与 `review_changes` 同一条规矩**：**确认人是【下一个接手的 Agent】**（2026-10-12）——\n' +
      '  ★ 这一侧此前**只有 HTTP**（`/api/observe/proposals…`），而**手 agent 不用 HTTP** ⇒ 下一个 Agent\n' +
      '  **看不见、也批不了**（T186b：同一病灶的另一处实例）。\n' +
      '★★ **approve 走四层门**（`approveGated`）—— ★ **门自己才是判据，`agent` 只是审计身份**：\n' +
      '  · **L1 规则回归** → **L2 无谓词声明的 LLM 复核**（★ 需 `use_llm:true` 才开）→ **L3 覆盖校验** → **L4 定稿**；\n' +
      '  · ★★ **任一层不过 ⇒ 冻结（`frozen:true`）**：提案置 `rejected`、**权威 DSL 一个字不动**\n' +
      '    ⇒ ★ **失败方向恒为"拒"**（没有"半放行"）。⇒ **冻结不是出错，是"门判定不许落"**，\n' +
      '    回执与 `data.frozen` 都会明说 —— ★ **别把 `frozen` 读成通过**（那是本工具最容易读错的一处）。\n' +
      '  · ★ `use_llm` **默认 false**（与 HTTP 面同款、**不默认开**）⇒ 含**无确定性谓词**声明的提案**默认会被冻结**。\n' +
      '★★ **"不许自批"这条守在这里是【部分判得了】**（★ 如实说，不假装）：\n' +
      '  · 提案的**唯一在跑产者**是机器回路（`run_loop`），`source: "loop"` ⇒ ★ **可判"非自批"**（提出方根本不是 agent）；\n' +
      '  · 而 `source` 为 `manual` / `llm-revise` 时 ⇒ ★ **判不了** —— 因为 `Proposal` **没有 `submitter` 字段**\n' +
      '    ⇒ 回执里**明标"判不了"**（不静默、也不冒充判过）。\n' +
      '★ 身份必填（`approve`/`reject` 都要 `agent`）；★ 定位用 `project_dir`，或给 `feature` 按其 `source_root` 推。',
    inputSchema: {
      action: z
        .enum(['list', 'show', 'approve', 'reject'])
        .describe('list=列提案（默认）| show=看一条全文（含冻结/复核证据）| approve=走四层门定稿 | reject=驳回（权威 DSL 不动）'),
      project_dir: z.string().optional().describe('提案库所在项目根（与 `feature` 二选一）'),
      feature: z.string().optional().describe('用来推 project_dir（取其 source_root）'),
      id: z.string().optional().describe('show/approve/reject 用：提案 id（list 会给）'),
      agent: z
        .string()
        .optional()
        .describe('★ **你的身份**（会话 id / Agent 编号 / 系统名）—— approve/reject **必填**；写进提案的审批人，供审计'),
      note: z.string().optional().describe('reject 用：驳回理由'),
      use_llm: z
        .boolean()
        .optional()
        .describe('approve 用：**显式 opt-in**。缺省 false ⇒ 含无谓词声明的提案一律**冻结**（与 HTTP 面同款，不默认开）'),
    },
    handler: wrapData(async (a) => {
      const action = (a.action as 'list' | 'show' | 'approve' | 'reject' | undefined) ?? 'list';
      // ★ 定位：project_dir 优先，否则由 feature 的 source_root 推（与 `design_intent` 同口径）
      let projectRoot = typeof a.project_dir === 'string' && a.project_dir.trim() ? a.project_dir.trim() : '';
      if (!projectRoot) {
        const feature = typeof a.feature === 'string' && a.feature.trim() ? a.feature.trim() : '';
        if (!feature) throw new Error('缺少定位：给 `project_dir`，或给 `feature`（按它的 source_root 推）');
        projectRoot = requireProjectRoot({ 'dsl.source_root': getDSL(feature)?.source_root });
      }
      // ★ 复用仓储层的**同一个**判据与目录推导（★ 不在这里再写一遍 `defaultDSLDir` 的逻辑）
      const dir = defaultDSLDir(validateProjectRoot(projectRoot, 'observe_proposals project_dir'));
      const ps = new ProposalStore(dir);

      const needId = (): string => {
        const id = typeof a.id === 'string' && a.id.trim() ? a.id.trim() : '';
        if (!id) throw new Error(`action=${action} 需要 id（先 action=list 拿）`);
        return id;
      };
      const needAgent = (): string => {
        const g = typeof a.agent === 'string' && a.agent.trim() ? a.agent.trim() : '';
        if (!g) throw new Error(`action=${action} 需要 agent（你的身份：会话 id / Agent 编号 / 系统名）`);
        return g;
      };

      if (action === 'list') {
        const all = ps.list();
        const lines = [`observe 提案：${all.length} 条（★ 0 条 ≠ "都没问题"，只代表没人提过）`, `  库：${dir}`];
        for (const p of all) {
          lines.push(`  · [${p.id}] ${p.status} · source=${p.source} · ${p.decls?.length ?? 0} 条声明`);
          lines.push(`      ${p.reason}`);
          if (p.reviewer) lines.push(`      审批人：${p.reviewer}${p.verified_by ? ` · ${p.verified_by}` : ''}`);
        }
        if (all.length) lines.push('  ★ 下一步：`action=show`（id=…）看全文；确认/驳回**都要署名**（`agent`）。');
        return { message: lines.join('\n'), data: { action, dir, count: all.length, proposals: all } };
      }

      if (action === 'show') {
        const id = needId();
        const p = ps.get(id);
        if (!p) throw new Error(`提案不存在：${id}`);
        const lines = [
          `提案 ${id} · ${p.status} · source=${p.source}`,
          `  提出于：${p.created_at}`,
          `  理由：${p.reason}`,
          `  声明集（${p.decls?.length ?? 0} 条）：`,
          ...(p.decls ?? []).slice(0, 20).map((d) => `    - ${JSON.stringify(d).slice(0, 160)}`),
          ...(p.reviewed_at ? [`  审批于：${p.reviewed_at}（${p.reviewer ?? '未署名'}）`] : []),
          ...(p.verified_by ? [`  ★ 验证门证据：${p.verified_by}`] : []),
          ...(p.verification ? [`  详情：${p.verification}`] : []),
        ];
        return { message: lines.join('\n'), data: { action, dir, proposal: p } };
      }

      // approve / reject —— 都要署名
      const id = needId();
      const agent = needAgent();
      // ★★ 如实交代"不许自批"这条在这侧判得了多少（★ 别假装判过）
      const p0 = ps.get(id);
      if (!p0) throw new Error(`提案不存在：${id}`);
      const selfReviewNote =
        p0.source === 'loop'
          ? '★ "不许自批"**已判**：本提案的 `source="loop"`（机器回路提出）⇒ 确认人不是提出方 ✓'
          : `⚠ ★ "不许自批"**判不了**：本提案 \`source="${p0.source}"\`，而 \`Proposal\` **没有 \`submitter\` 字段** ` +
            '⇒ 无从知道提出人是不是你。★ 若这案是你提的，请换人/换会话确认。';

      if (action === 'reject') {
        const note = typeof a.note === 'string' ? a.note.trim() : '';
        ps.reject(id, agent); // ★ 权威 DSL 完全不动
        return {
          message: [
            `提案 ${id} 已驳回（确认人 ${agent}）—— ★ 权威 DSL **一字未动**`,
            selfReviewNote,
            ...(note ? [`  理由：${note}`] : []),
          ].join('\n'),
          data: { action, dir, id, agent, rejected: true, proposal: ps.get(id) },
        };
      }

      // approve：走四层门。★ `use_llm` 不默认开（与 HTTP 面同款）
      const useLlm = a.use_llm === true;
      let r: Awaited<ReturnType<typeof approveGated>>;
      try {
        r = await approveGated(ps, new DesignDSLStore(dir), id, agent, useLlm);
      } catch (e) {
        // ★★ 与 T186 同款：**失败必须抛**（否则机器通道 isError=false，人读文字说失败 ⇒ 判据分叉）
        throw new Error(`提案 ${id} approve **未成功**（确认人 ${agent}）：${(e as Error).message}\n  ★ 未改动任何东西。`);
      }
      // ★★★ **`frozen` 必须一眼看见**（它是"门判定不许落"，不是出错、更不是通过）
      const head = r.frozen
        ? `提案 ${id} **被门冻结**（frozen，★ 不是通过）：${r.reason ?? ''}`
        : `提案 ${id} **已定稿**（确认人 ${agent}，DSL version ${r.version}）`;
      const lines = [head, selfReviewNote];
      if (r.frozen) {
        lines.push(
          '  ★ 冻结 = 提案置 `rejected`、**权威 DSL 一个字不动**（四层门任一层不过都走这里）。',
          ...(useLlm ? [] : ['  ★ 本次 `use_llm` 未开（缺省 false）⇒ 含**无谓词声明**的提案会在此冻结；确需 LLM 复核请显式 `use_llm: true`。']),
        );
      }
      return { message: lines.join('\n'), data: { action, dir, id, agent, version: r.version, frozen: r.frozen, reason: r.reason, proposal: r.proposal } };
    }),
  },

  {
    name: 'diagnose',
    title: 'Diagnose a symptom to root cause + evidence chain + impact + fix suggestions',
    description:
      '症状诊断：输入"症状"（报错信息 / stack trace / 测试失败输出 / 行为异常描述），' +
      '输出"根因 + 证据链 + 影响面 + 修改建议 + 验证方式"。' +
      '六步流水线：症状解析（正则提取 错误类型/文件:行/符号）→ 候选定位（查 .agent-io/cache.db 符号缓存，' +
      'exact/file/FTS/anchor 四路）→ 调用链追溯（沿 call/type_ref/import 三类边双向 BFS）→ 影响面分析（复用 impact/diff_impact.ts 的三类边影响图）→ ' +
      '根因聚合（规则引擎先跑，LLM 可选把证据翻成人话根因，未配置自动降级）→ 验证建议（按项目类型给命令，只建议不执行）。' +
      '前置：无需任何准备——缓存为空时会自动冷启建索引；仅在目标目录没有可解析源码时退化为文件级线索。' +
      'anchor 可选：用户已知的线索（文件路径或函数名）帮助聚焦。',
    inputSchema: {
      project_dir: z.string().describe('被诊断项目根目录（其下 .agent-io/cache.db 是符号缓存，为空则自动冷启建索引）'),
      symptom: z.string().describe('症状：报错信息 / stack trace / 测试失败输出 / 行为异常描述'),
      symptom_type: z.enum(['error', 'test_failure', 'behavior']).optional().describe('症状类型，缺省 auto 自动识别'),
      anchor: z.string().optional().describe('可选线索：文件路径或函数名，帮助聚焦定位'),
      max_depth: z.number().optional().describe('调用链追溯深度（默认 3）'),
    },
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      const symptom = requireStr(a, 'symptom');
      const input = { ...(a as unknown as DiagnoseInput), project_dir, symptom };
      const out = await runDiagnosis(input);
      return { message: formatDiagnoseText(out), data: out };
    }),
  },

  {
    name: 'diagnose_loop',
    title: 'Closed loop: diagnose a symptom to a patch, apply it, verify it (and roll back on failure)',
    description:
      '★ 诊断**闭环**（T202 从 CLI 上到工具面）：**诊断 → 出补丁 → 应用 → 验证**，' +
      '验证不过**自动回退**。★ 与 `diagnose` 的分工：`diagnose` 只做**第 2 步**（诊断），' +
      '本工具做**闭环的其余部分**（出补丁 / 应用 / 验证）。\n' +
      '★ **安全设计（两条，都是有意为之，不是没做完）**：\n' +
      '  ① ★★ **默认 `apply=false`** ⇒ **只诊断 + 出补丁 + 给 diff，【不改动项目源码】** —— ' +
      '要真改必须**显式** `apply:true`。\n' +
      '     ★ 注：**符号缓存（`.agent-io/cache.db`）仍会建/更新** —— 那是本工具自己的索引，不是项目源码。' +
      '（★ 原先写「一个字节都不写盘」**不准确**，已改。）\n' +
      '  ② ★★ **不做 git 提交** —— 提交是**不可逆的对外动作** ⇒ 本工具到「**验证通过**」为止，' +
      '改动**留在工作区**，由你 review 后自己提交（回执的 `data.next` 会说明）。\n' +
      '★ 前置：无需准备 —— 本工具自己先建符号缓存（建不起来就降级、并在回执里**如实说**）。\n' +
      '★ 未配置 LLM 时：诊断可走规则引擎，但**出补丁会失败** ⇒ 本工具会在**写明原因**后止步（不静默）。',
    inputSchema: {
      project_dir: z.string().describe('被诊断项目根目录'),
      symptom: z.string().describe('症状：报错信息 / stack trace / 测试失败输出 / 行为异常描述'),
      apply: z.boolean().optional().describe('★ 默认 false = 只算不写（给 diff）。true = 真应用补丁，并自动跑验证'),
      verify: z.boolean().optional().describe('★ 默认 true（仅 apply=true 时有意义）：应用后跑项目自己的验证命令；不过则自动回退'),
      verify_timeout_sec: z.number().optional().describe('验证命令超时（秒），默认 300'),
    },
    handler: wrapData(async (a) => {
      const input: DiagnoseLoopInput = {
        project_dir: requireStr(a, 'project_dir'),
        symptom: requireStr(a, 'symptom'),
        apply: optionalBool(a, 'apply'),
        verify: optionalBool(a, 'verify'),
        verify_timeout_sec: optionalNum(a, 'verify_timeout_sec'),
        // ★★★ 2026-10-22（并发控制·账户）：补丁落盘要过写闸 ⇒ 逐调用自报身份（`actor` 是跨工具保留键）
        actor: typeof a.actor === 'string' && a.actor ? a.actor : undefined,
        authorize: typeof a.authorize === 'string' && a.authorize ? a.authorize : undefined,
      };
      const r = await diagnoseLoop(input);
      // ★★★ T202b：**把 `touched` 传出去** —— `wrapData` 读的就是 `r.touched`（见 `plumbing.ts`），
      //   没有它 Map（`chain_wiring`）就接不上本工具（★ 链的接法靠"上游的产物锚点 → 下游的入参位置"）。
      return { message: r.message, data: r.data, touched: r.touched };
    }),
  },

  // ★★★ 2026-10-23（批注层退场）：`canvas_notes` 工具（read/mark/decide 三 action）**已删除**。
  //   用户裁定：前端只是显示屏、人不直接插手 ⇒ 批注这条路整个退场。

  {
    name: 'gateway_provider',
    title: 'Manage LLM gateway providers & usage (single entry)',
    description:
      '小网关供应商 + 用量统一入口（收敛原 gateway_* 4 工具为 1 入口，action 分派）：' +
      '★ Key 的**家就在这里**（gateway.json）：可配**多供应商**、每个供应商一个 **Key 池**（多 key）。' +
      '★ 环境变量（AGNES_KEY_POOL/AGNES_API_KEY/AGNES_UPSTREAM_BASE/AGNES_BASE_URL/AGNES_MODEL）只是**导入源**——' +
      '旧配置会在**首次写类/出网访问**时被**一次性导入** gateway.json；此后 key 一律从 gateway 读，env 不再是住处。' +
      'action=list 列出已注册供应商（**只读，不改文件**；key 脱敏：露首 3 + 尾 4，长度 ≤8 全遮）+ 用量汇总；' +
      'action=upsert 注册/更新一个供应商到 Key 池（同供应商多 key 入一个池，调用时加权轮询 + 失败自动切下一个 key/供应商；' +
      'OpenAI 兼容协议 base_url 形如 https://api.openai.com/v1；已存在同 id 则按传入字段合并更新）；' +
      'action=delete 删除一个供应商及其 Key 池；' +
      'action=stats 用量监视（按 供应商+key 维度的调用数/token/费用(USD)/错误/延迟及汇总；reset=true 可清零统计）。',
    inputSchema: {
      action: z.enum(['list', 'upsert', 'delete', 'stats']).describe('list=列出供应商/用量 | upsert=注册或更新供应商 | delete=删除供应商 | stats=用量统计'),
      id: z.string().optional().describe('供应商唯一 id（upsert/delete 用：字母数字-_，如 agnes / openai / my-ollama）'),
      name: z.string().optional().describe('展示名（upsert）'),
      base_url: z.string().optional().describe('OpenAI 兼容 base url，不含 /chat/completions（upsert）'),
      model: z.string().optional().describe('默认模型（upsert）'),
      keys: z.array(z.string()).optional().describe('API Key 池，多个 key 一个池（upsert）'),
      weight: z.number().optional().describe('轮询权重，默认 1（upsert）'),
      price_prompt_per_1m: z.number().optional().describe('每 1M 输入 token 价格 USD（upsert）'),
      price_completion_per_1m: z.number().optional().describe('每 1M 输出 token 价格 USD（upsert）'),
      enabled: z.boolean().optional().describe('是否启用（upsert）'),
      reset: z.boolean().optional().describe('true=清零用量统计（stats）'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'list' | 'upsert' | 'delete' | 'stats';
      if (action === 'list') {
        return { message: '小网关供应商清单（key 已脱敏）', data: { providers: listProvidersMasked(), stats: getStats().totals } };
      }
      if (action === 'upsert') {
        const r = upsertProvider({
          id: String(a.id ?? ''),
          name: typeof a.name === 'string' ? a.name : undefined,
          base_url: typeof a.base_url === 'string' ? a.base_url : undefined,
          model: typeof a.model === 'string' ? a.model : undefined,
          keys: Array.isArray(a.keys) ? a.keys.map(String) : undefined,
          weight: typeof a.weight === 'number' ? a.weight : undefined,
          price_prompt_per_1m: typeof a.price_prompt_per_1m === 'number' ? a.price_prompt_per_1m : undefined,
          price_completion_per_1m: typeof a.price_completion_per_1m === 'number' ? a.price_completion_per_1m : undefined,
          enabled: typeof a.enabled === 'boolean' ? a.enabled : undefined,
        });
        if (!r.ok) return { message: `保存失败：${r.error}`, isError: true };
        return { message: `供应商 ${a.id} 已保存（Key 池 ${Array.isArray(a.keys) ? a.keys.length : 0} 个）`, data: { ok: true } };
      }
      if (action === 'delete') {
        const r = deleteProvider(String(a.id ?? ''));
        if (!r.ok) return { message: `删除失败：${r.error}`, isError: true };
        return { message: `供应商 ${a.id} 已删除`, data: { ok: true } };
      }
      // stats
      if (a?.reset === true) {
        resetStats();
        return { message: '用量统计已清零', data: { per_key: [], totals: getStats().totals } };
      }
      const s = getStats();
      return {
        message: `用量汇总：${s.totals.calls} 次调用 / ${s.totals.prompt_tokens + s.totals.completion_tokens} tokens / $${s.totals.cost_usd.toFixed(4)} / 错误 ${s.totals.errors}`,
        data: s,
      };
    }),
  },

  {
    name: 'read_project_docs',
    title: 'Read project docs (per-project docs/ folder)',
    description:
      '读取某 feature 的项目文档夹（<project_dir>/docs/，或受管目录 .agent-io/docs/<feature>/）。' +
      '三种用法：不带 name= 返回清单（含 frontmatter 关联标签与预览，供 agent 挑）；带 name= 返回单篇全文；' +
      '带 targets 返回命中该目标集（目录分组/步骤/文件）的文档正文（与 canvas_notes action=decide 的按批关联注入同一套匹配）。' +
      '项目文档可丢进项目仓库 docs/ 作为 LLM 决策背景（需求/设计约定/约定规范），' +
      'canvas_notes action=decide 会自动按批把命中文档注入决策上下文（TOC 全量 + 命中正文封顶）。',
    inputSchema: {
      feature: z.string().describe('feature 名（如 agent-io）'),
      project_dir: z.string().optional().describe('项目根目录（缺省用 dsl.source_root）'),
      name: z.string().optional().describe('文档 id（相对 docs/ 的路径）；给则返回该篇全文'),
      targets: z
        .object({
          features: z.array(z.string()).optional().describe('分组名集合（★ 键名是 `features`，指思维导图那层的**目录分组**；「功能」只留给**人写的标记**）'),
          steps: z.array(z.string()).optional().describe('步骤标题集合'),
          files: z.array(z.string()).optional().describe('文件路径集合'),
        })
        .optional()
        .describe('按批匹配目标集：返回命中文档正文'),
    },
    handler: wrapData(async (a) => {
      const feature = typeof a.feature === 'string' ? a.feature : '';
      if (!feature) return { message: '缺少 feature', isError: true };
      const dsl = getDSL(feature);
      const projectDir = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : dsl?.source_root ?? '';
      const man = listProjectDocs(projectDir, feature);
      const name = typeof a.name === 'string' && a.name ? a.name : '';
      if (name) {
        const content = readProjectDoc(projectDir, feature, name);
        if (content === null) return { message: `文档不存在：${name}`, isError: true };
        return { message: `文档 \`${name}\`（${content.split('\n').length} 行）`, data: { id: name, content } };
      }
      const targets = a.targets && typeof a.targets === 'object' ? (a.targets as DocTargetSet) : undefined;
      if (targets && ((targets.features ?? []).length > 0 || (targets.steps ?? []).length > 0 || (targets.files ?? []).length > 0)) {
        const matched = matchDocsForTargets(man, targets);
        const block = buildDocsPromptBlock(man, targets);
        return {
          message: `命中 ${matched.length}/${man.docs.length} 篇文档（frontmatter/文件名匹配）`,
          data: { dir: man.dir, total: man.docs.length, matched: matched.map((d) => d.id), block },
        };
      }
      return {
        message: `项目文档 ${man.docs.length} 篇（${man.dir ?? '未找到 docs/ 目录'}）`,
        data: {
          dir: man.dir,
          total: man.docs.length,
          docs: man.docs.map((d) => ({ id: d.id, title: d.title, lines: d.lines, tagged: d.tagged, tags: d.tags })),
        },
      };
    }),
  },

  {
    name: 'capability_map',
    title: '能力线导航：agent-io 工具分层地图',
    description:
      '统一能力线入口（只读导航，无副作用）。无参返回完整分层清单：6 条能力线（design 设计 / refactor 重构 / ' +
      'observe 观测 / harvest 契约采集 / cross 跨仓翻译健康 / meta 元信息）× 每条线内工具及其适用时机；' +
      '传 lane 只看某条线。agent 在不确定用哪个工具前，优先调它分层定位，再进入具体工具。' +
      '★ 2026-10-05 新增「实现地图」段：工具注册在哪个文件 ≠ **实现住在哪个目录** —— ' +
      '该段按线列出 `structure.domains.json` 里该线下的域（dir + role + note 首句），' +
      '用来回答「我要改 X 的实现，该进哪个目录」。传 project_dir 才读得到（读的是该项目的域表）。' +
      '高频工具（get_dsl / edit_dsl / explore_code / rename_symbols / rename_files / find_references）始终直接可用，无需先经本工具。' +
      '★ 通用前置（2026-10-06 新增 —— 这三条**不属于任何单个工具**，但用任何工具前都成立）：' +
      '① **DSL 数据锚定「包安装根」，不是你的项目目录**：不设 `AGENT_IO_HOME` 时，**任何 cwd** 都读写同一个数据目录 ' +
      '⇒ 多个项目会**互相看见**。要隔离，请在调用前设 `AGENT_IO_HOME=<某个目录>`。' +
      '② **符号索引会被「顺手」自动建**：第一次 `find_references` 之类就在**被分析项目里**生成 `.agent-io/cache.db`，' +
      '不必先 `import_project`（但你可以预期它会写盘）。' +
      // ★★★ T238（2026-10-13）：★ 这段**过期过**（T228 之前为真、之后为假）—— 记着它为什么必须改：
      //   它**面向的是 LLM 使用者**（工具描述 = LLM 读的），而 T228 之后"逐调用保鲜 / 陈旧告警 /
      //   可信度附注 / 首触建索引"这四处**已不靠参数名**（改走 `resolveRootFromArgs`：约定的参数名
      //   → 否则从**本次调用的参数值**里挑真实存在的路径、向上找 `.agent-io/cache.db`）。
      //   ★★ 若不改：它会让 LLM 用户**为了避免一个已经不存在的限制**去做多余动作（白调 `index_integrity`），
      //     而真正该知道的限制（"一个路径都解析不到 ⇒ 结果里会响亮标注 NO_PROJECT_ROOT"）反而没说 ✓
      '③ **「每次调用前保鲜 / 陈旧告警」怎么定位项目根**（T228 起**两级**）：先认约定参数名 ' +
      '`project_dir` / `project_root` / `root` / `dir`；★ **都不是**时，改从**本次调用的参数值**里' +
      '挑出**真实存在的**路径，从它所在目录**向上**找最近的 `.agent-io/cache.db` ⇒ 第一个命中的即项目根。' +
      '⇒ ★ 用别的名字（如 `cross_repo_symbol_index` 的 `project_dir_a` / `project_dir_b`）**通常也能**被认到；' +
      '★★ 但**一个路径都解析不到**时，结果里会**响亮标注**（`NO_PROJECT_ROOT`：未做索引保鲜 / 未做陈旧检查，' +
      '结果可能基于旧图）—— ★ **绝不静默**。要确定性保鲜，仍可显式先调 `index_integrity({project_dir, refresh:true})`。',
    inputSchema: {
      lane: z
        .enum([...LANE_IDS] as [LaneId, ...LaneId[]])
        .optional()
        .describe('只看指定能力线；省略返回全部 6 线'),
      project_dir: z
        .string()
        .optional()
        .describe('要读**哪个项目**的域表（structure.domains.json）；省略 = 不读，实现地图段会明说"该项目未声明结构意图"而不是给空表'),
      from_tool: z
        .string()
        .optional()
        .describe(
          '★ **接续**（T54）：你**刚刚调完的那个工具名**。与 `touched` 必须**成对给** —— ' +
            '给了这一对，本工具会算出"**下一步能怎么调**、入参**已经取好**"（零手工拼字段名）。',
        ),
      touched: z
        .object(handoffTouchedShape)
        .optional()
        .describe(
          '★ **接续**：上一步 `---DATA---` 里的那个 `touched` 对象，**原样给**（不必 stringify）。' +
            '★ 字段与 `Touched`（`domain/b_terms.ts`）逐字对应，全可选。',
        ),
    },
    handler: wrapData(async (a) => {
      // ★★★ 2026-10-09（T54）：**接续段** —— 把"上一步的产物"算成"下一步的入参"。
      //   为什么放在本工具：本工具**本来就画着接法表**（"链的接法"段），而它自称"新用户第一站"
      //   ⇒ "我手上这份 touched 下一步怎么用"放这儿最自然，且**不新增工具**（不增面、不增 8 处登记）。
      //   ★ 计算全部落在**已收口的那两个函数**（`nextHopsOf`/`applyChainEdge`）—— 本段不自己推任何规则。
      // ★★ 2026-10-11（T140 第二处）：注入的**不再是** `catalogOf(...).requiredKeys` ——
      //   那个只反映 **schema 层声明的必填**（`isOptional` 口径），照不出**模式相关必填**
      //   （`find_references.file`/`symbol` = `mode=symbol` 才要 ⇒ zod 只能写 `.optional()`），
      //   ⇒ 接续段会拿它报"必填已填满"（**假信心**，正是 T140 刚修掉的那个形态）。
      //   ★ 改注入 `collectInputPaths(d.inputSchema)`（**深层入参路径表**，与 `CHAIN_EDGES.toPath` 同形），
      //     必填判定在 `renderHandoffPanel` 里**复用** T140 立的 `declaredRequiredMembersOf`（import，不另抄）。
      const handoff = renderHandoffPanel(
        a.from_tool as string | undefined,
        a.touched as Record<string, unknown> | undefined,
        (tool) => {
          const d = listToolDefs().find((c) => c.name === tool);
          return d ? collectInputPaths(d.inputSchema) : [];
        },
      );
      // 域表**在调用期现取**（不注入、不缓存）：它是**按 project_dir 读的项目级声明**，
      // 而本仓自己那份结构意图与被分析项目无关 ⇒ 缓存它就是把两个项目混成一份（判据分叉）。
      // 与「ts_kernel 现取、不建镜像」同策。
      let domains: DomainNavView[] | null = null;
      let readNote = '';
      const pd = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined;
      if (pd) {
        try {
          const cfg = readStructureConfig(path.resolve(pd));
          domains = cfg ? [...cfg.domains, ...(cfg.flatDirs ?? [])] : null;
          if (!cfg) readNote = '（该项目根下没有 structure.domains.json）';
        } catch (e) {
          // 域表坏了**不许**让整个导航挂掉：导航的主体（哪条线/哪个工具）不依赖它
          readNote = `（域表读取失败，已跳过实现地图段：${(e as Error).message.slice(0, 120)}）`;
          domains = null;
        }
      } else {
        readNote = '（未传 project_dir ⇒ 不知道要读哪个项目的域表）';
      }
      bindDomains(domains);
      try {
        // ★★ 2026-10-06：注入目录时**顺带算好**每个工具的"声明入参名（**深层**收集）"——
        //   供 `capability_map` 的「链的完整判定」判"**下游要不要对象类入参**"。
        //   ★ 为什么必须在这层算：只有这里拿得到 `ToolDef`（含 zod schema）；
        //     `domain` 反向依赖 `application` 是分层违规 ⇒ 表侧判定只能做到一半。
        //   ★ 构造**单点化**成 `catalogOf`（`server_registry` 按面过滤时也要用同一份口径）。
        const r = await makeCapabilityMapHandler(() => catalogOf(listToolDefs()))(a, readNote);
        // ★ T54：接续段放**最前** —— 调用方给了 `from_tool`+`touched` 时，他要的就是这个
        const text = handoff ? `${handoff}\n${r.text}` : r.text;
        return {
          message: text,
          data: {
            lanes: LANE_IDS,
            domains: domains?.length ?? 0,
            read_note: readNote,
            ...(handoff ? { handoff: { from_tool: a.from_tool } } : {}),
          },
        };
      } finally {
        resetDomainsForTest();
      }
    }),
  },

  {
    // ★★ BB 笔（2026-10-11）：「**"什么被保证 / 什么被用过"没有工具面**」——
    //   ① `usage.jsonl` 只有**不在注册表**的 `npm run dogfood` 能读；
    //   ② 且它只答"共 N 次调用 + 一张成功率表"，答不了「**注册了但从未用过**」与「**用过但已不在注册表**」
    //      —— 而那正是"该收敛哪个工具 / 哪些记录已过期"的直接依据。
    //   ⇒ 本工具把这份读数**接进工具面**：复用 `dogfood_stats` 的统计（**不重造**），补上**集合差**那一维。
    //   ★ 它是只读的：**不写任何盘**（尤其**绝不碰**那份"只加不减"的原始日志）。
    name: 'tool_usage',
    title: 'Tool usage & coverage: what has been used, what is dead, what is stale',
    description:
      '**工具使用 / 覆盖读数**（只读，不写盘）：回答**"什么被用过"**这一半 —— 以及只有它答得了的两维：\n' +
      '① **用过哪些工具、各调了多少次 / 成功失败**（复用 `npm run dogfood` 的统计口径，`dogfood_stats.ts`，**一行统计都不重造**）；\n' +
      '② ★ **注册了但从未用过**（= **死工具**；数据源 = **注册表 − usage 里出现过的 tool**）；\n' +
      '③ ★ **用过但已不在注册表**（= **过期记录**；数据源 = **usage 里出现过的 tool − 注册表**）。\n' +
      '★ **两个集合的权威来源**都写在读数里（不自己拼一份）：用过的集合 = 日志文件真实路径；' +
      '注册过的集合 = 注册表 `TOOL_DEFS`（`application/tool_registry.ts` 的唯一汇总点）。\n' +
      '★ 与 `capability_map` 分工：那个是"**该用哪个**"（导航），本工具是"**实际用了什么 / 还差什么**"（覆盖）。\n' +
      '★ 日志 `usage.jsonl` 是**原始记录（只加不减）** ⇒ 本工具**只读它**，绝不删除/清空。',
    inputSchema: {},
    handler: wrapData(async () => {
      // ★ 注册表**注入式**取自唯一汇总点（`listToolDefs()` = 加载期 bindToolDefs(TOOL_DEFS) 的产物）
      //   —— 本工具**不自己拼一份工具清单**（那就是第二份注册表，必然漂移）。
      const registry = listToolDefs().map((d) => d.name);
      const c = computeDogfoodCoverage(registry, 'src/application/tool_registry.ts 的 TOOL_DEFS（工具注册唯一汇总点）');
      return { message: renderDogfoodCoverage(c), data: c };
    }),
  },

  {
    // ★ T15 切片（2026-10-05）：原先只存在于 `capability_cli`（CLI-only）⇒ 能力被藏在 MCP 面之外。    //   ★ 顺带更正一条误判：T15 原写"`capability_cli` 的 MCP 等价物已存在（`capability_map`）⇒ 只需删 CLI"。
    //     **错** —— 两者只有名字像：`capability_map` 是「6 条能力线 × 工具」的**工具导航**（零语言），
    //     本工具审的是「功能 × 语言」的**支持度矩阵**（`diagnoseCapabilities`）。删 CLI 会丢一个能力。
    name: 'capability_audit',
    title: '能力矩阵自检：语言 × 功能的 AST 覆盖缺口',
    description:
      '**能力矩阵自检**（缺口清单；只读、纯计算、不改任何代码）：对语言名单（或只对**已安装**的 tree-sitter ' +
      '语言包）逐功能审计 AST 覆盖度，汇总「功能 × 语言」缺口 ⇒ 可直接给 LLM 做"补哪个功能、补哪门语言"的决策输入。' +
      '★ 与 `capability_map` **不是一回事**：那个是「6 条能力线 × 工具」的**工具导航**，本工具审的是**语言支持度**。' +
      '★ `installed_only=true` 更贴近"眼下真能跑的语言"；省略则为语言名单全量（含未装包的语言）。',
    inputSchema: {
      installed_only: z.boolean().optional().describe('true = 只审已安装的 tree-sitter 语言包；省略 = 语言名单全量'),
      gaps_only: z.boolean().optional().describe('true = 只回缺口汇总（不返回全量矩阵文本，省上下文）'),
    },
    handler: wrapData(async (a) => {
      const useInstalled = a.installed_only === true;
      const langNames = useInstalled
        ? diagnoseCapabilitiesByEntries(probeInstalledLanguages())
        : diagnoseCapabilities(languageCatalog().map((l) => l.name));
      const gaps = aggregateGaps(langNames);
      const totalNeed = Object.values(gaps).reduce((x, y) => x + y.length, 0);
      const capabilities = allCapabilities().map((c) => ({
        id: c.id,
        label: c.label,
        default: c.default,
        overrides: c.overrides,
      }));
      const scope = useInstalled
        ? `已安装语言（${probeInstalledLanguages().length} 门）`
        : `语言名单全量（${languageCatalog().length} 门）`;
      return {
        message:
          `能力矩阵审计（${scope}）：` +
          (totalNeed === 0
            ? '✅ 无缺口：所有功能对该语言名单均为 AST 全量'
            : `🔧 缺口总计 ${totalNeed} 个「功能×语言」对`) +
          `\n已登记功能 ${capabilities.length} 项。`,
        data:
          a.gaps_only === true
            ? { scope, totalNeed, gaps }
            : { scope, totalNeed, gaps, matrix_text: renderAuditText(langNames), capabilities },
      };
    }),
  },

  {
    // ★ 2026-10-01（④-2 按能力改判整条线）：本工具从 `harvest` 线**改判**到 `meta` 线。
    //   判据：它的能力是「以注册表为事实源回填工具契约」= **元数据 / 注册**能力（不是"收割"），
    //   与同样以工具目录为目录的 `capability_map` 同族。实现随之搬到 `./sync_contracts.js`。
    //   ★ 搬动同时消灭 5 条已知 `no-circular`（见 tool_registry.ts 的文件头说明）。
    name: 'sync_contracts',
    title: 'Sync tool contracts from registry schema into DSL expected_apis',
    description:
      '契约回填（修复契约漂移）：以注册表的 zod schema 为唯一事实源，把每个已注册工具的输入契约生成签名回填到 DSL semantic.files 的 expected_apis。' +
      '改了工具 schema 后跑一次，DSL 契约自动跟上。' +
      '默认只更新 DSL 中已存在的工具实现文件（按 basename 在 src/ 下解析真实路径）；include_all=true 时为缺失的工具文件补全契约节点。' +
      '只回填签名（notes 带机器生成标记），设计侧意图由 LLM 维护。' +
      '解析不到同名实现文件的工具（在 lane 内联实现）会在结果 unresolved 里如实列出，不静默跳过。',
    inputSchema: {
      feature: z.string().describe('feature 名（已存在的 DSL feature）'),
      include_all: z.boolean().optional().describe('为 DSL 中缺失的工具文件补全契约节点（默认 false）'),
    },
    handler: syncContractsHandler,
  },

  {
    name: 'index_integrity',
    title: '索引可信度自检：现在的索引能不能当真',
    description:
      '只读自检：回答"我眼下读到的索引能不能当真"。给出规模（索引文件/磁盘源码/未索引/幽灵行/节点/边）、' +
      '引用状态（resolved/pending/external/failed）、**陈旧断言数**（声称 resolved 但目标符号已不在索引 ' +
      '⇒ find_references / impact_analysis 会静默漏报）、未保鲜文件数、待消费的自写登记、后台续建进度，' +
      '并给出一条总结论与可执行修复建议。发现"不可信"时可传 refresh:true 顺手保鲜后重报。' +
      '在"准备基于索引做改动"或"怀疑漏报/读到旧数据"之前调它。',
    inputSchema: {
      project_dir: z.string().optional().describe('项目根目录；省略则用当前工作目录'),
      refresh: z.boolean().optional().describe('true = 先跑一次保鲜（重同步变更文件 + 重开引用）再报告；默认 false = 纯只读'),
      sample: z.number().int().min(0).max(200).optional().describe('未保鲜样例的条数上限（默认 20）'),
    },
    // ★ P-E 本笔：裸 arrow ⇒ wrapData。原先 `return { text: renderIntegrity(r) }` 把
    //   IndexIntegrityResult（trustworthy / counts / refs.stale_resolved / issues …
    //   索引可信度是**结构化产物**）在通道层丢掉，agent 只能读散文。
    handler: wrapData(async (a) => {
      // ★ T47（2026-10-06）：本工具的入参 `project_dir` 是**可选**的，省略即用 cwd「自定位」读索引
      //   （**既有行为**，描述里明说）—— 但必须把"是否显式"如实传给 Core：否则那个 cwd 会被填进
      //   `touched.project_dir`，**冒充**成"调用方声明的项目根"（全族其余 13 处都守着
      //   「不兜底 cwd」，见 `index_integrity.touchedOf` 的长注释）。
      const explicit = typeof a.project_dir === 'string' && a.project_dir !== '';
      const dir = explicit ? (a.project_dir as string) : process.cwd();
      const r = await indexIntegrity({
        project_dir: dir,
        project_dir_explicit: explicit,
        ...(a.refresh === true ? { refresh: true } : {}),
        ...(typeof a.sample === 'number' ? { sample: a.sample } : {}),
      });
      return { message: renderIntegrity(r), data: r };
    }),
    // refresh:false 必须是**纯只读**（否则它报告的是"修完之后"，不是"LLM 马上要读到的"）
    noAutoFresh: true,
  },

  {
    // ★ T15 切片（2026-10-06）：本能力原先**只活在两个 CLI 里**（`upgrade_cli` 五阶段检测 /
    //   `upgrade_rewrite_cli` 的 git 验证回退闭环）⇒ 能力被藏在 MCP 面之外。
    //   ★ 收成**一个入口**的依据见 `meta/upgrade/upgrade.ts` 头注（同一操作对象 + 动作互补）。
    name: 'upgrade',
    title: '版本升级契约差：工具链/语言特性/废弃 API 检测 + 局部重写闭环（git 验证回退）',
    description:
      '**版本升级契约差**（一个入口两个动作）。`action=scan`（缺省，**只读**）：' +
      '① 工具链版本盘点（`pom.xml` / `build.gradle` / `.nvmrc` / `.tool-versions` / `go.mod` / `engines` 的声明版本 vs 本机探测）' +
      '② 语言特性契约差（以声明版本为边界，报"用了超过声明版本的特性" = 编译会失败的那部分，附行号 + 重写建议）' +
      '③ 废弃/移除 API（如 JDK 11 起移除的 JAXB/JAX-WS/JAF，附替代方案）' +
      '④ 未覆盖扩展名（★ 扫到却没有适配器 ⇒ **这些文件没被检查，不等于没问题** —— 少做事必须可见）。' +
      '可选两道闸（都缺省关）：`gate=true` 静态闸（编译级：Python `ast.parse feature_version` / Java `javac --release`）；' +
      '`dynamic=true` 动态闸（运行级：★ **会真跑被测源码**）。' +
      '`action=apply`（**写**，闭环）：按 `edits` 精确串替换（★ 歧义/未命中 ⇒ **整批拒绝、一个文件都不改**）' +
      '→ 改前基线提交 → 验证（按项目形态探测 build/test）→ 通过则精确提交；**失败则 git 回退**到改写前。' +
      '★ `apply` 两处如实说：① 前置 `project_dir` 必须是 **git 仓库**（回退靠 git）；' +
      '② 它**会提交该仓库** —— 基线步骤把工作区**原有改动一并提交**（既有行为），验证通过后再精确提交本次改动文件。' +
      '★ 与 `deprecate_offline`（死代码下线）/ `contract_gate`（积木契约）**不是一回事**：本工具管的是**版本边界**。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（绝对或相对 cwd）'),
      action: z
        .enum(['scan', 'apply'])
        .optional()
        .describe('scan=只报告（缺省）；apply=局部重写闭环（需 edits，且 project_dir 须是 git 仓库）'),
      gate: z.boolean().optional().describe('scan 用：附加静态闸（编译级契约差；Python / Java 单文件可查）'),
      dynamic: z.boolean().optional().describe('scan 用：附加动态闸（★ 真跑被测源码；Python / Java）'),
      edits: z
        .array(z.object({ file: z.string(), from: z.string(), to: z.string() }))
        .optional()
        .describe('apply 用：编辑清单（精确串替换；歧义/未命中整批拒绝）。建议先跑 action=scan、照它的 data.plan 取建议'),
      skip_verify: z.boolean().optional().describe('apply 用：跳过验证（★ 未验证的改动不自动提交）'),
    },
    handler: upgradeHandler,
  },

  {
    // ★ 2026-10-11：契约页 / 类型页 —— 用户问「`Touched` 是什么、谁产生、谁消费、改它会砸谁」时，
    //   原先要四步（explore_code search → find_references(symbol) → find_references(field) → 手工 Read）
    //   才拼得出答案。本工具**一次给全**，把散在四处的信息**端上来**（不新算 —— 见模块头注的数据源表）。
    name: 'contract_page',
    title: 'Contract page: everything about one symbol in one call (definition / members / producers / consumers / chain edges / glossary)',
    description:
      '**契约页 / 类型页**（只读）：给一个**符号名或类型名**，**一次给全**六块 —— 调用方**不用再调别的工具**：' +
      '① 定义在哪（文件:行 + 签名，来自内核 AST）；' +
      '② 字段/成员清单（interface / type / class，内核 AST 走出来的成员）；' +
      '③ 谁产生它（产者 = find_references mode=field 的「构造点」）；' +
      '④ 谁消费它（消费者 = find_references mode=symbol 的 importers + mode=field 的「读/解构」点）；' +
      '⑤ 相关接法边（CHAIN_EDGES 里与它相关的边，含 `[ran]` 标签）；' +
      '⑥ 词表口径（若它在 b_terms 里，原样带出）。' +
      '★ **每一块都取自已有的权威**（内核 AST / find_references / CHAIN_EDGES / b_terms）—— 本工具**只端、不新算**。' +
      '★ **查不到是一个明确的态**（`resolution`: ok / ambiguous / not-found / index-unavailable），**不是空数组**；' +
      '多个同名定义 ⇒ 报 ambiguous 并**全列候选**（不替你选，可用 `file=` 消歧）。' +
      '★ 想改一个符号前先用它，比"先猜定义在哪、再分头查引用"少三步。',
    inputSchema: {
      symbol: z.string().describe('要查的符号名 / 类型名（模块级声明名，如 Touched / withTouched / written_files）'),
      project_dir: z.string().optional().describe('目标项目根目录（缺省 = 当前工作目录）'),
      file: z.string().optional().describe('可选：定义文件（多候选消歧用；给了就以它为定义锚点）'),
      feature: z.string().optional().describe('可选：feature（仅作上下文回显）'),
    },
    handler: wrapData(async (a) => {
      const r = await contractPage({
        symbol: requireStr(a, 'symbol'),
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        file: typeof a.file === 'string' && a.file ? a.file : undefined,
        feature: typeof a.feature === 'string' && a.feature ? a.feature : undefined,
      });
      return { message: renderContractPage(r), data: r };
    }),
  },

  {
    // ★ 2026-10-11：**生成"下一棒入参"** —— D/E/G 组共同指出的缺口：
    //   "CLI 无管道 ⇒ 「链」是【文档约定】不是可执行的 pipe，每一步都得人肉抄字段"
    //   （G 组原话：`find_references.touched={file,symbols[]}` → `rename_symbols` 要
    //    `renames:[{file,symbol,to}]` ⇒ 得自己把两字段拼成对象 + 另给新名 `to`）。
    //   ⇒ 本工具把"人肉抄字段"那一步变成**有名字的一步**：能填的**替它填好**，
    //     只把**真正只能由人给的"意图位"**（如新名 `to`）**显式留空并标注**。
    name: 'next_hop_args',
    title: 'Prepare the next hop args: upstream touched -> runnable JSON for the next tool (filled where possible, intent slots left blank & marked)',
    description:
      '**生成"下一棒入参"**（只读）：给**上一步的工具名** `from_tool` + 它的 `touched`（对象，**原样给**），' +
      '本工具按接法表把它**组装成下一步【可跑的入参 JSON】** —— 调用方**只需补"意图位"就能直接跑**，不必再人肉抄字段。' +
      '可选 `to_tool`：只算通到那一个下游；不给 = **列出所有可接的**下一棒。' +
      '★ **能填的必须填**：按 `CHAIN_EDGES` 的 `fromKey` 从 `touched` 取值、按 `toPath` 落位（`cardinality` 定要不要下标）。' +
      '★ **意图位显式留空并标注**：下游**必填**里**没有任何出边覆盖**的那一格（如 `rename_symbols` 的 `renames[].to`）' +
      ' ⇒ 产出里是一个**显眼的占位串**（`<你给：renames[].to（新符号名）>`）—— **绝不编造、绝不用空串冒充、绝不静默省略**。' +
      '★ **不猜前提**：上游这次没产出的键 ⇒ 该格是**明确态**（`<拿不到：…>` + 理由），**不假设它总有**。' +
      '★ 判据全部**复用已有权威**（`nextHopsOf` / `applyChainEdge` / `CHAIN_EDGES` / `evidenceLabel` / `collectInputPaths`）—— 本工具**只端，不新做**。' +
      '★ 典型用法：`find_references` 之后拿它的 `touched` 调本工具（`to_tool="rename_symbols"`）' +
      ' ⇒ 直接得到 `{project_dir, renames:[{file, symbol, to:"<你给：…>"}]}`，补个新名即可跑。',
    inputSchema: {
      from_tool: z
        .string()
        .optional()
        .describe(
          '★ 上一步的工具名（= 接法表里那条边的 `from`）。**接法表以 `from` 为键** ⇒ 给了它才得到"只属于它"的权威出边；' +
            '不给则按**接力键**（`fromKey ∈ touched`）匹配候选（可能列出别的上游同样会产的边）。',
        ),
      touched: z
        .object(handoffTouchedShape)
        .describe(
          '★ 上一步 `---DATA---` 里的那个 `touched` 对象（必填），**原样给**（不必 stringify）。' +
            '★ 字段与 `Touched`（`domain/b_terms.ts`）逐字对应，全可选。',
        ),
      to_tool: z
        .string()
        .optional()
        .describe('可选：只算通到这一个下游的接续；不给 = 列出**所有可接的**对象类下一棒。'),
    },
    handler: wrapData(async (a) => {
      // ★ 入参就是**那个 `touched` 对象**（不再有"手工 stringify → 这里 JSON.parse"那一步）。
      //   CLI 面绕过 zod ⇒ 仍需运行时守卫（`touchedObjectOf`），缺/非对象报人话、不是 Node 原始异常。
      const touchedObj = touchedObjectOf(a.touched);
      // ★ 目录**现取**（同 capability_map）：只有这层拿得到 `ToolDef`（含 zod schema）。
      const r = nextHopArgs(touchedObj, {
        from_tool: typeof a.from_tool === 'string' && a.from_tool ? a.from_tool : undefined,
        to_tool: typeof a.to_tool === 'string' && a.to_tool ? a.to_tool : undefined,
        defs: listToolDefs(),
      });
      return { message: renderNextHopArgs(r), data: r };
    }),
  },

  {
    // ★ 2026-10-11：**起手入参** —— 一次真实走查（"同型任务第二次"）实测出的**头号缺口**：
    //   原话：*"地图只给工具名、【不产入参】"* + *"地图也没提要先 import_project 建档"*。
    //   ⇒ 本工具把这两件事**一次给全**：① 第一棒的可跑入参 JSON（能填的填好、意图位显式留空并标注）；
    //     ② "起手之前还有一步"（要不要先 `import_project` 建档）。
    //   ★ 与 `next_hop_args` **同族**（一个管"第一棒"、一个管"下一棒"）：占位串/槽位/落位**复用同一批函数**。
    name: 'first_hop_args',
    title:
      'Prepare the FIRST hop args: chain/tool -> runnable JSON for the first step (filled where possible, intent slots blank & marked) + chain overview + "build the index first?" hint',
    description:
      '**生成"起手入参"**（只读）：给它一条**链名** `chain`（如 `refactor`）**或**一个**起点工具名** `tool`，' +
      '本工具把**第一棒**的入参**组装成【可跑的 JSON】** —— 调用方**只需补"意图位"就能直接跑**，不必再手工拆字段。' +
      '★ 不给 `chain`/`tool` ⇒ **列出所有链 + 各自的起手**（链的第一段工具 + 它有哪些必填意图位 + 要不要先建档）。' +
      '★ **能填的必须填**：如你给的 `project_dir` 会填进第一棒的 `project_dir`（仅当第一棒声明里收它）。' +
      '★ **意图位显式留空并标注**：第一棒**必填**（= schema 必填 ∪ 下游 `.describe` 里写「必填」）里**没有任何上游可喂**的每一格' +
      ' ⇒ 产出里是一个**显眼的占位串**（如 `<你给：file（mode=symbol 必填）>`）—— **绝不编造、绝不用空串冒充、绝不静默省略**；' +
      '提示语**逐字取自下游自己的 `.describe`**。' +
      '★ **链的全貌**（`CHAINS[].steps`）+ **每段交接强度**（强/弱两档，复用 `hopsOf` 的现成读数）。' +
      '★ **"起手之前还有一步"**：若该链/工具要用 `feature`、而第一棒不是建档步 ⇒ 明说**先跑 `import_project` 建档**' +
      '（否则你会踩到"缺少必需参数 feature"才发现）。' +
      '★ 判据全部**复用已有权威**（`CHAINS` / `hopsOf` / `collectInputPaths` / `declaredRequiredMembersOf`）—— 本工具**只端，不新做**。' +
      '★ 与 `next_hop_args` **同族**：一个管"第一棒"，一个管"下一棒"。',
    inputSchema: {
      chain: z
        .string()
        .optional()
        .describe(
          '链名（`CHAINS[].name`，如 `refactor`）。与 `tool` 二选一；★ 都不给 = 列出**所有链 + 各自的起手**。',
        ),
      tool: z.string().optional().describe('起点工具名（不在任何链里也行）。与 `chain` 二选一。'),
      project_dir: z
        .string()
        .optional()
        .describe('起手根 —— ★ **能自动填的就填好**（填进第一棒的 `project_dir`）'),
    },
    handler: wrapData(async (a) => {
      // ★ 目录**现取**（同 capability_map / next_hop_args）：只有这层拿得到 `ToolDef`（含 zod schema）。
      const r = firstHopArgs({
        chain: typeof a.chain === 'string' && a.chain ? a.chain : undefined,
        tool: typeof a.tool === 'string' && a.tool ? a.tool : undefined,
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        defs: listToolDefs(),
      });
      return { message: renderFirstHopArgs(r), data: r };
    }),
  },
];


/**
 * ★★★「**接续**」段（2026-10-09，`docs/todo.md` T54）—— 把"上一步的产物"算成"下一步的入参"。
 *
 * ## 为什么需要它
 * 本仓的产物端（`Touched`）与接法表（`CHAIN_EDGES`）**早就做完了**，
 * 但"取出来、放到下游入参位置"**一直由调用方手工做** —— 而手工正是会出错的地方（回忆字段名、自己数下标）。
 * ⇒ 本段把上一步的 `touched` 直接算成"**下一步能怎么调、值是多少**"。
 *
 * ## 三条纪律
 * 1. ★★★ **规则不在这里推**：下游是谁用 `nextHopsOf`，取值用 `applyChainEdge`，全称规则用 `universalHopsOf` ——
 *    本段只做**渲染**。★ 这是本仓头号病的反面：**别在展示层再实现一遍规则**。
 * 2. ★★ **不替调用方选**：`pick` 类边**列出候选并明说"要你选"**，绝不给一个默认值。
 * 3. ★ **成对参数**：给了 `from_tool` 就必须给 `touched`（反之亦然）—— 只有一半就**报错**，不猜。
 *    ★ 两个都没给 ⇒ 返回**空串**（与改造前**逐字等价**，导航不因此变胖）。
 *
 * ★ 只读：本段不改任何东西，也**不代表"这条链跑通过"**（那是 `CHAINS` 的 `[ran]` 标签说的 —— 标签 = 当年跑过、非实时验证）。
 *
 * ★★★ 2026-10-09（T54 收口）：**本函数导出、两个面共用** —— ① `capability_map` 工具；
 *   ② **回执通道**（`presentation/mcp/server_registry.ts` 的「下一棒」）——
 *   它手上正好有刚跑完那个工具的 `r.text`（`touched` 就在 `---DATA---` 里）
 *   ⇒ **能直接把具体值印出来**（`edit_code.file = src/a.ts`）。
 *   ★ 为什么必须共用：这正是本仓头号病的高发处 —— 两个面各写一份"把 touched 变成下一棒"就**分叉**了。
 * ★★★ 2026-10-11（T139-3）：入参 `touched` 改成**对象**（不再收"手工 stringify 的字符串"）——
 *   `Touched` 是 7 个明确字段、不是袋子 ⇒ 上游 `---DATA---` 里的 `touched` 可**原样**喂进来，**零手工 stringify**。
 */
export function renderHandoffPanel(
  fromTool: string | undefined,
  touched: Record<string, unknown> | undefined,
  /**
   * 下游工具的**入参路径表**（由 `collectInputPaths(d.inputSchema)` 提供；★ 与 `CHAIN_EDGES.toPath` 同形）。
   * ★★★ 为什么不是 `readonly string[]`（=`catalogOf(...).requiredKeys`）：那只给**顶层 + schema 必填**
   *   ⇒ 照不出**模式相关必填**（见 `missingOf` 与 `declaredRequiredMembersOf` 的头注，T140）。
   */
  pathsOf: (tool: string) => readonly InputPath[],
): string {
  if (fromTool === undefined && touched === undefined) return '';
  if (fromTool === undefined || touched === undefined) {
    throw new Error(
      '`from_tool` 与 `touched` **必须成对给**：只给一半就判断不了"从哪接、拿什么接"。★ 刻意不替你猜。',
    );
  }
  // ★ 已不再 `JSON.parse`（入参本来就是对象）；仍做**运行时**对象校验 —— CLI 面绕过 zod（见 `touchedObjectOf`）。
  const cur = touchedObjectOf(touched);
  const L: string[] = [`── 接续（你手上有 \`${fromTool}\` 的 touched ⇒ 下一步怎么调）──`];
  const used = new Set<string>();
  const ready: string[] = [];
  const needPick: string[] = [];
  const blocked: string[] = [];

  /**
   * ★★★ 这条边**只填了哪一格入参**，以及**还差哪些必填**。
   *
   * ## 为什么必须写出来（实测动机）
   * 我验过的那条 `get_dsl.scope_files → edit_code.file`，下游 `edit_code` **还要 `op`**
   * ⇒ 光说"**直接可用（零手工）**"会**误导**（让人以为传一个字段就能调）。
   * ## 而它顺带立起一条更准的定位
   * 把所有边算一遍：**没有一条能填满下游必填**（`edit_code` 缺 `op`/`symbol`；`move_symbol` 缺 `symbol`/`to_file`；
   * `rename_symbols` 缺 `renames[]` 里每条的 `symbol`/`to`）—— ★★★ **这不是缺陷，是分工**：
   * **接续负责"位置与对象"，不负责"意图"**（要做什么操作 / 改成什么名 / 移到哪 = 语义判断）。
   * ★ 与 `applyChainEdge` 在 `pick` 上**不替人选中**下标，是同一条立论。
   *
   * ## ★★★ 必填口径（2026-10-11，T140 第二处）
   * 必填**不在这里判** —— 复用 T140 立在 `collectInputPaths` 旁边的 `declaredRequiredMembersOf`（**import**）：
   * 它取「**schema 必填** ∪ **下游 `.describe` 里写「必填」**」两路的并 ⇒ 覆盖 zod 表达不了的
   * **模式相关必填**（`find_references.file`/`symbol`/`field`）。★ 上一版只按 `requiredKeys`（**顶层 + schema 必填**）
   * 判 ⇒ `find_references` 一个必填都收不到 ⇒ 对本边报"**已填满**"（**假信心**，即 T140 修的形态）。
   * ★ 本段**不是链的完整判定**（那是 `makeCapabilityMapHandler` 的段），只借同一张路径表。
   */
  const missingOf = (to: string, toPath: string): string => {
    // 「本边填的是哪一格」= `toPath` 在**下游入参路径空间**里的全路径（`InputPath.path` 与 `CHAIN_EDGES.toPath`
    // **刻意同形** ⇒ 逐字比对）。★ `filledTop` 是**旧口径**（`requiredOf` 只给顶层键 ⇒ 需先把 `toPath` 归一化成
    // 顶层键才比得上）；保留它作**兜底**（对"只填顶层那一格"的旧形态仍成立），精确排除由 `toPath` 那一比负责。
    const filledTop = toPath.replace(/\[\].*$/, '').replace(/\..*$/, '');
    const miss = declaredRequiredMembersOf(pathsOf(to))
      .map((p) => p.path)
      .filter((k) => k !== toPath && k !== filledTop && !SCOPE_PATHS.has(k));
    return miss.length ? `\n        ★ 下游**还要给**：${miss.join(', ')}` : '\n        ★ 下游必填**已填满**';
  };

  for (const e of nextHopsOf(fromTool)) {
    used.add(e.fromKey);
    const r = applyChainEdge(cur, e);
    const head = `${e.to}.${e.toPath}`;
    if (r.ok) ready.push(`    ${head}  ←  ${r.expr}  =  ${r.value}${missingOf(e.to, e.toPath)}`);
    else if (r.candidates.length) {
      needPick.push(
        `    ${head}  ←  ${r.expr}  · **要你选**：${r.candidates.map((c, i) => `[${i}] ${c}`).join('   ')}${missingOf(e.to, e.toPath)}`,
      );
    } else blocked.push(`    ${head}  ←  ${r.expr}  · 接不上：${r.reason}`);
  }
  const uni: string[] = [];
  for (const e of universalHopsOf()) {
    used.add(e.fromKey);
    const r = applyChainEdge(cur, e);
    uni.push(`    ${e.fromKey.padEnd(12)} → 任何 [B].${e.toPath}${r.ok ? `  =  ${r.value}` : '（这次没产出它）'}`);
  }

  if (ready.length) L.push('', `  ★ **直接可用**（值已取好，零手工拼字段名）：${ready.length} 条`, ...ready);
  if (needPick.length) L.push('', `  ★ **要你选一个**：${needPick.length} 条（选是语义判断 —— 本工具**不替你选**）`, ...needPick);
  if (blocked.length) L.push('', `  ★ 接不上（上游这次没产出该键）：${blocked.length} 条`, ...blocked);
  if (ready.length || needPick.length) {
    // ★★ 读起来会卡的地方（实测）：**同一对工具之间常有多条边**（如 `rename_symbols → edit_code` 有
    //   `written_files→file` 与 `symbols→symbol` 两条），于是每条边上那句"还要给"**要合起来看**才算全
    //   （单看 `symbol` 那条会说"还要给 file"，而 `file` 其实由**另一条边**给了）。
    L.push('', '  ★ 注意：**同一对工具之间常有多条边** ⇒ 上面每条的"还要给"要**合起来看**（例：`file` 由另一条边已给）。');
  }
  if (uni.length) L.push('', '  ★ 全称规则（对**任何**工具都成立，只提一次、不展开）：', ...uni);
  const unused = Object.keys(cur).filter((k) => !used.has(k));
  if (unused.length) L.push('', `  ★ touched 里**没被任何边用到**的键：${unused.join(', ')}（不是错误，只是本表没接它）`);
  if (!ready.length && !needPick.length && !blocked.length) {
    L.push('', '  （该工具在接法表里**没有对象类出边** ⇒ 它通常是"链的终点"；作用域键见下面的全称规则）');
  }
  L.push('', '  ★★ **接续的分工**：它只负责**位置与对象**；"**要做什么操作 / 改成什么名 / 移到哪**"是**意图**，'
    + '由你给 —— ★ **没有一条边能替你填满下游必填**，这是分工，不是缺陷。'
    + '（同一条道理：本段在多个候选时也**不替你选下标**。）');
  L.push('', '  ★ 本段**只读**：不改任何东西，也**不代表"这条链跑通过"**（那是 `CHAINS` 的 `[ran]` 标签说的 —— ★ 标签 = 当年跑过、**非实时验证**）。');
  return L.join('\n');
}
