/**
 * meta 线（12 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ 2026-11-06（T-t27）：本线 13 → 12 —— `archive` 的**注册项摘除**（写端/读端早于 2026-11-02 已并入
 *   `edit_dsl` 的 `lifecycle.status='archived'` 与 `get_dsl query=archive`；旧名调用经墓碑表
 *   `registry/capability_map.ts#RETIRED_TOOLS` 响亮报错并指路）。判据=能力 100% 被覆盖且无独立失败条件。
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
import { CALL_FIELDS_SPEC, requireStr, wrapData } from '../plumbing.js';
// ★ T202：诊断闭环的 [B]（`optionalBool/Num` 与 `requireStr` 是**同一处**判据 —— `plumbing`）。
import { optionalBool, optionalNum } from '../plumbing.js';
import type { DiagnoseLoopInput } from './diagnosis/diagnose_loop.js';
import { diagnoseLoop } from './diagnosis/diagnose_loop.js';
import type { DiagnoseInput } from '../../infrastructure/analysis/diagnosis/contract.js';
import { formatDiagnoseText, runDiagnosis } from '../../infrastructure/analysis/diagnosis/diagnose.js';
import { getDSL, saveDSL, requireProjectRoot } from '../../infrastructure/storage.js';
// ★ 事实权威导航：采集端（读盘的只有它这一侧；capability_map 侧保持零 IO）
import { scanAuthorities } from '../../infrastructure/authority/scan_authorities.js';
// ★ 2026-10-23 画布三格（annotations / user_nodes / canvas_notes）与批注层**整体退场**：前端只是显示屏、人不直接插手（用户裁定）。DSL 字段已删、HTTP 端点已删、**没有替代住家** —— 详见 docs/ROOTS.md §8。
import { readStructureConfig } from '../../infrastructure/analysis/structure/structure_gap.js';
// ★★★ 2026-11-02（收逻辑写口 ②）：`archive` 的**写端已并入 `edit_dsl`** ⇒ 本工具降为**别名**，
//   转发到同一个写端（`updateFeature` 的 `file/lifecycle.status='archived'`）。别名因此拿到
//   `checkOpSpec`（形状闸）+ 写授权闸 + `validateDSL` 自洽闸 + 乐观锁；★ 唯独 L1–L4 变更原因闸**仍不执行**
//   （它住在 `design/handlers.ts#editDslHandler`，而本别名没有 reason / evidence 入参 ⇒ 结构上无法执行）。
//   ★ 归档的执行核仍是 `meta/archive/archive_node.ts#archiveNode`（由 `file_ops.ts#updateFile` 调），**没搬家**。
import { updateFeature } from '../design/dsl_ops/update_feature.js';
import { queryFeature } from './explore/query_feature.js';
// ★ 只在"路径翻不到 id"那一支用：把权威拒绝（已归档过 / 不存在）交回执行核，别在别名里重写文案。
import { archiveNode } from './archive/archive_node.js';
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
  bindAuthorities,
  listAuthorities,
  countStaleAuthorities,
  resetAuthoritiesForTest,
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
// ★★★ P0-1（2026-11-17 · 审计 `ea-func-ds-1` §1.1）：**能力矩阵必须由 probe 实测派生**。
//   原实现两条分支都只问"声明"（`default: full_ast`）⇒ 对全部 55 门打 🟢，而实测只有 33 门可解析。
//   实测口只有一处：`parse/parser_presence.ts`（判据 = `probe.isLanguageInstalled` ∩ 注册表 `pkgSpec`）。
import { formatParserRatio, measureParserPresence, parserSupportProbe } from '../../infrastructure/parse/parser_presence.js';
import {
  allCapabilities,
  aggregateGaps,
  diagnoseCapabilities,
  diagnoseCapabilitiesByEntries,
  languageCatalog,
  renderAuditText,
} from '../../infrastructure/analysis/capability/capability_matrix.js';
// ★ T-#96：「全局声明来源」覆盖率读数（哪些语言适配器还没声明 `globals`）
import { LANG_ADAPTERS } from '../../infrastructure/parse/kernel.js';
import { languagesWithoutGlobals } from '../../infrastructure/parse/globals.js';
// ★ 触发默认登记（**side-effect import**，确保矩阵被填充）—— 与 `capability_cli` 同款；
//   漏了它会报"空矩阵"（`allCapabilities().length === 0`），那是**静默少报**而不是报错。
import '../../infrastructure/analysis/capability/register_capabilities.js';
import { EXPLORE_ACTIONS } from './explore/explore_code.js';
// ★★★ 2026-11-18（台账写面 · R53 族实证）：**台账引擎的唯一工具面**（单工具 + action 枚举）。
//   `closeRow` / `reopenRow` 从 L1 就在，而此前**全仓零工具面** ⇒ 销账只能"在批注里说已落地"
//   （实测：台账 task 行 315 条全 active，含已完成的 —— `T-#LEDGER-STATE-HYGIENE`）。
//   ★ 面字节 +2-4KB 属**有意识变更**（`T-#FACE-STABILITY` §I / `¶§I#581`）：基线随
//     `node scripts/mcp/mcp_scan.mjs --update` 显式上调，diff 在评审里现形。
import { LEDGER_INPUT_SCHEMA, LEDGER_TOOL_DESCRIPTION, ledgerHandler } from './ledger/tool.js';
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
// ★ 第⑬项第三刀：gateway_provider 退役出 MCP 面 ⇒ 本文件的 5 个 gateway import 不再使用（执行核在 llm_gateway.js，CLI 仍可直达）。
import { indexIntegrity, renderIntegrity } from './integrity/index_integrity.js';
// ★ BB 笔（2026-10-11）：把「什么被用过 / 覆盖缺口」接进**工具面** ——
//   `npm run dogfood`（`dogfood_stats.ts`）此前是**唯一**读得到那份日志的入口，而它**不在工具面**里
//   ⇒ agent 拿不到。本工具**复用**它的统计（一行都不重造），只补「注册表 − 用过的 / 用过的 − 注册表」两维。
import { computeDogfoodCoverage, renderDogfoodCoverage } from '../../infrastructure/dogfood_coverage.js';
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
/**
 * ★★★ 2026-11-09（**工具面收敛试点**：diagnose + diagnose_loop ⇒ 一个入口）
 *
 * 调用方只需要表达"诊断这个问题"或"诊断并修复"；**选哪条路是引擎的事**，不该由调用方记。
 *
 * ## 一条实现，两个名字（不新增第二实现）
 * · `diagnose`         —— 统一入口（新口径）
 * · `diagnose_loop`    —— **版本兼容别名**：同一个 handler，行为逐字相同
 *
 * ## 三档语义（`apply` 决定，其余参数原样透传）
 * | 入参 | 走哪条核 | 写盘 | 返回 |
 * |---|---|---|---|
 * | `apply:true`  | `diagnoseLoop({apply:true})` | 补丁**落盘**（验证不过自动回滚） | 闭环回执 + `touched` |
 * | `apply:false` | `runDiagnosis`（只读诊断） | **不写盘** | 与 `diagnose` 逐字一致 |
 * | 缺省          | `runDiagnosis`（只读诊断） | **不写盘** | 与 `diagnose` 逐字一致 |
 *
 * ★ **边界未变**：默认不提交、默认不写**项目源码**（`apply:true` 才写）；符号缓存 `.agent-io/cache.db`
 *   仍会建/更新（那是本工具自己的索引，不是源码）。
 * ★ **失败/不可判不报成功**：闭环的 `verified` 只在真跑过验证且通过时出现；否则 `stopped_at` 点名停在哪一步。
 * ★ **迁移边界（如实记，不藏）**：旧 `diagnose_loop(apply:false)` 会**顺带出一份补丁 + diff**（不落盘）；
 *   收敛后 `apply:false` = **只诊断**（与 `diagnose` 同一结果），**补丁预演这条能力被并入"只读诊断"之外** ——
 *   要看补丁就得走 `apply:true`（落盘 + 验证 + 不过自动回滚）。这是这次收敛**唯一**的减法，写在这里备查。
 */
async function runDiagnoseEntry(a: Record<string, unknown>): Promise<{
  message: string;
  data: unknown;
  touched?: unknown;
}> {
  const project_dir = requireStr(a, 'project_dir');
  const symptom = requireStr(a, 'symptom');
  const apply = optionalBool(a, 'apply');

  if (apply === true) {
    // 闭环：诊断 → 出补丁 → 应用 → 验证（不过自动回退）；不提交
    const input: DiagnoseLoopInput = {
      project_dir,
      symptom,
      apply: true,
      verify: optionalBool(a, 'verify'),
      verify_timeout_sec: optionalNum(a, 'verify_timeout_sec'),
      actor: typeof a.actor === 'string' && a.actor ? a.actor : undefined,
      authorize: typeof a.authorize === 'string' && a.authorize ? a.authorize : undefined,
    };
    const r = await diagnoseLoop(input);
    // ★ T202b：`touched` 必须传出去（`wrapData` 读 `r.touched`；没有它链路接不上）
    return { message: r.message, data: r.data, touched: r.touched };
  }

  // 只读诊断（apply 缺省或显式 false）：与旧 `diagnose` **同一份核、同一份渲染**
  const input = { ...(a as unknown as DiagnoseInput), project_dir, symptom };
  const out = await runDiagnosis(input);
  return { message: formatDiagnoseText(out), data: out };
}

export const META_TOOLS: ToolDef[] = [
  {
    name: 'explore_code',
    writes: false,
    title: 'Explore, analyze and understand code',
    description:
      '代码理解统一入口：通过 action 参数化执行各类分析（动作清单见 `action` 字段的 describe）。' +
      '入参是**平铺**的：`action` 选动作，其余键直接放顶层（例：`{action:"docs", feature, project_dir}`）。' +
      '★ `args:{…}` 信封只是**兼容别名**，且只有 `watch` 的子动作用得上（它自己的子动作也叫 `action`，平铺无法与顶层区分）。' +
      '★ 2026-10-21：diff_impact / inject_replay / derive_split / derive_chain / derive_anim_flow / ' +
      'derive_algorithm 已从本工具移除（实测调用 146-179 次、成功 0-3 次）—— ' +
      '影响面改用本工具的 action=impact；注入回放与回放观测改用 observe action=instrument / trace；' +
      '文件拆分/调用链改用 structure_gap。' +
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
      'search 必填 project_dir（目标项目根目录，缺省报错）+ query（空则返回『查询为空』提示），可选 top_k；' +
      'arch_layer 必填 feature（不吃 project_dir）；影响面分析用本工具的 action=impact（2026-10-21 起不再接 diff_impact）。' +
      'watch 支持 impact_on_change=true：文件变更后自动生成影响报告（一行摘要入 alerts，' +
      'action=status 查看未读提醒，action=impact + seq 取全文；报告持久落盘 .agent-io/impact/）。' +
      'action=declare + files 登记改前预告（Impact Ledger）：**登记了**才会在改后自动对比实际波及、把计划外扩散写进 alerts' +
      '（不登记 ⇒ 没有这份对比）；预告持久化 ledger.json（跨会话恢复，24h 未消费过期）；' +
      'action=ledger 查台账，violated 用 resolve_id + reason 过门处理（status 播报未处理数）。',
    inputSchema: {
      // ★ action 枚举**由 EXPLORE_ACTIONS 派生**（唯一权威 = 分发器里那份）—— 手抄一份就一定会漂
      action: z.enum(EXPLORE_ACTIONS).describe(`要执行的代码理解动作：${EXPLORE_ACTIONS.join(' / ')}`),
      // ★ 兼容别名（保留的理由：`watch` 的子动作也叫 `action`）；其余 action 把参数直接放顶层
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('★ 兼容别名（仅 watch 子动作需要，如 args:{action:"status"}）；平铺形态不必给'),
    },
    handler: exploreCodeHandler,
  },

  // ★★★ 2026-11-06（T-t27）：`archive` 工具**已退役**（注册项摘除；写端/读端早于 2026-11-02 就并入既有入口）
  //   写（下线一个节点，不可逆）：`edit_dsl {type:'file', op:'update', data:{lifecycle:{status:'archived', retire_reason, merged_into?}}}`
  //   读（列归档条目）：`get_dsl {query:'archive', feature}`
  //   旧名调用：CLI 与 `atomic_call` 会**响亮报错并指路**（墓碑表 = `registry/capability_map.ts#RETIRED_TOOLS`），不是静默 404。
  //   ★ 为什么删（判据不是"看起来像"）：它的描述逐字写着「「下线库」统一入口：**没有独立工具**」，
  //     而归档执行核 `meta/archive/archive_node.ts#archiveNode` 与 `edit_dsl` 的 `lifecycle.status='archived'` 是**同一个**
  //     ⇒ 留着 = 工具面上多一个"自称不存在"的工具（能力 100% 被覆盖，且无独立失败条件/副作用）。
  //   ★ 代价（如实）：`file_path → id` 需要先 `get_dsl query=files` 多一跳；且 `edit_dsl` 必带顶层 `reason`
  //     （过 L1–L4）—— 那是**收紧**，不是丢失。台账：`docs/RETIRED.md`（性质 = ①被取代）。


  
  {
    name: 'diagnose',
    writes: false,
    title: 'Diagnose a symptom (read-only), or diagnose-and-fix when apply:true',
    description:
      '★ **诊断统一入口**（2026-11-09 收敛试点）：`apply` 缺省/false ⇒ **只读诊断**（不写盘）：症状解析 → ' +
      '符号定位（cache.db）→ 调用链追溯 → 影响面 → 根因聚合 → 验证建议（只建议不执行）。' +
      '`apply:true` ⇒ **闭环**：出补丁 → 应用 → 验证（verify 默认 true，不过**自动回退**）。' +
      '★ **不提交**；★ 只有 apply:true 才写项目源码（符号缓存仍会建/更新）；未配置 LLM 时出补丁会失败并**写明原因**。' +
      'anchor 可选：已知文件/函数名，帮助聚焦。',
    inputSchema: {
      project_dir: z.string().describe('被诊断项目根目录（其下 .agent-io/cache.db 是符号缓存，为空则自动冷启建索引）'),
      symptom: z.string().describe('症状：报错信息 / stack trace / 测试失败输出 / 行为异常描述'),
      apply: z
        .boolean()
        .optional()
        .describe('★ 缺省/false = 只读诊断（绝不写盘）；true = 闭环：出补丁 → 应用 → 验证（不过自动回退）'),
      verify: z.boolean().optional().describe('★ 默认 true（仅 apply=true 时有意义）：应用后跑项目自己的验证命令；不过则自动回退'),
      verify_timeout_sec: z.number().optional().describe('验证命令超时（秒），默认 300'),
      symptom_type: z
        .enum(['error', 'test_failure', 'behavior'])
        .optional()
        .describe('症状类型（error=报错/堆栈 / test_failure=测试失败输出 / behavior=行为异常描述）；缺省 auto = 按内容自动识别'),
      anchor: z.string().optional().describe('可选线索：文件路径或函数名，帮助聚焦定位'),
      max_depth: z.number().optional().describe('调用链追溯深度（默认 3）'),
    },
    handler: wrapData(runDiagnoseEntry),
  },

  {
    name: 'diagnose_loop',
    writes: false,
    title: 'Alias of diagnose (version compatibility: same handler, same behaviour)',
    description:
      '★ **兼容别名**：与 `diagnose` **共用同一个 handler**，行为逐字相同 —— 只为不断旧调用方与旧链' +
      '（chain_wiring 的产物边）。新代码请用 `diagnose`。★ 迁移：旧 `apply:false` 会顺带出补丁+diff，' +
      '现在 `apply:false` = 只诊断；要看补丁走 `apply:true`。',
    inputSchema: {
      project_dir: z.string().describe('被诊断项目根目录'),
      symptom: z.string().describe('症状：报错信息 / stack trace / 测试失败输出 / 行为异常描述'),
      apply: z
        .boolean()
        .optional()
        .describe('★ 缺省/false = 只读诊断（不写盘）；true = 闭环：出补丁 → 应用 → 验证（不过自动回退）'),
      verify: z.boolean().optional().describe('★ 默认 true（仅 apply=true 时有意义）：应用后跑项目自己的验证命令；不过则自动回退'),
      verify_timeout_sec: z.number().optional().describe('验证命令超时（秒），默认 300'),
      symptom_type: z.enum(['error', 'test_failure', 'behavior']).optional().describe('症状类型（error=报错/堆栈 / test_failure=测试失败输出 / behavior=行为异常描述）；缺省 auto = 按内容自动识别'),
      anchor: z.string().optional().describe('可选线索：文件路径或函数名，帮助聚焦定位'),
      max_depth: z.number().optional().describe('调用链追溯深度（默认 3）'),
    },
    handler: wrapData(runDiagnoseEntry),
  },

  // ★★★ 2026-10-23（批注层退场）：`canvas_notes` 工具（read/mark/decide 三 action）**已删除**。
  //   用户裁定：前端只是显示屏、人不直接插手 ⇒ 批注这条路整个退场。

  // ★★ 第⑬项第三刀（2026-11-10）：gateway_provider **退役出 MCP 面** —— 基建运维（供应商 Key 池管理），
  //   模型面没有消费场景；CLI/内部保留（`infrastructure/llm_gateway.js` 执行核不动）。

  {
    name: 'capability_map',
    writes: false,
    title: '能力线导航：agent-io 工具分层地图',
    description:
      '统一能力线入口（只读导航，无副作用）。无参返回完整分层清单：6 条能力线（design 设计 / refactor 重构 / ' +
      'observe 观测 / harvest 契约采集 / cross 跨仓翻译健康 / meta 元信息）× 每条线内工具及其适用时机；' +
      '传 lane 只看某条线。agent 在不确定用哪个工具前，优先调它分层定位，再进入具体工具。' +
      '★ 2026-10-05 新增「实现地图」段：工具注册在哪个文件 ≠ **实现住在哪个目录** —— ' +
      '该段按线列出 `structure.domains.json` 里该线下的域（dir + role + note 首句），' +
      '用来回答「我要改 X 的实现，该进哪个目录」。传 project_dir 才读得到（读的是该项目的域表）。' +
      '★★ 2026-11-03 新增「**事实权威导航**」段：**要判一个仓级事实（卡活不活 / 哪些 import 死了 / 一行 scope 什么意思）' +
      '⇒ 该问哪个函数**，直接列在工具面上（权威自带 `@authority` 标记、每次现扫；点了已不存在的工具标「⚠ 陈旧」并计数）。' +
      '★ 判事实前先看它，别自己拼 SQL / 正则（AGENTS.md 0.20）。' +
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
      '结果可能基于旧图）—— ★ **绝不静默**。要确定性保鲜，仍可显式先调 `index_integrity({project_dir, refresh:true})`。' +
      CALL_FIELDS_SPEC,
    inputSchema: {
      lane: z
        .enum([...LANE_IDS] as [LaneId, ...LaneId[]])
        .optional()
        .describe(`只看指定能力线（${LANE_IDS.join(' / ')}）；省略返回全部 6 线`),
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
      // ★★ 事实权威导航（2026-11-03）：**调用期现扫**（不缓存 —— 缓存就是第二处真相）。
      //   扫的是**本包的 src**（getPackageRoot()/src），与 project_dir 无关：这些权威是"这个工具的"，
      //   不是"被分析项目的"。扫不动 ⇒ 带原因注入，渲染层会明说"没扫"而不是"没有"（0.12）。
      const authScan = scanAuthorities();
      bindAuthorities(authScan.entries, authScan.error ?? '');
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
            // ★ 只加字段（既有字段一字不动）：权威条数 / 陈旧数 / 扫不动的原因
            authorities: listAuthorities()?.length ?? 0,
            authorities_stale: countStaleAuthorities(listAuthorities(), catalogOf(listToolDefs())),
            authorities_error: authScan.error ?? '',
            read_note: readNote,
            ...(handoff ? { handoff: { from_tool: a.from_tool } } : {}),
          },
        };
      } finally {
        resetDomainsForTest();
        resetAuthoritiesForTest();
      }
    }),
  },

  {
    // ★ T15 切片（2026-10-05）：原先只存在于 `capability_cli`（CLI-only）⇒ 能力被藏在 MCP 面之外。    //   ★ 顺带更正一条误判：T15 原写"`capability_cli` 的 MCP 等价物已存在（`capability_map`）⇒ 只需删 CLI"。
    //     **错** —— 两者只有名字像：`capability_map` 是「6 条能力线 × 工具」的**工具导航**（零语言），
    //     本工具审的是「功能 × 语言」的**支持度矩阵**（`diagnoseCapabilities`）。删 CLI 会丢一个能力。
    name: 'capability_audit',
    writes: false,
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
      // ★★★ P0-1：**实测口**（唯一实现住 `parse/parser_presence.ts`）—— 两条分支都要带上它，
      //   否则 `parserBound` 的能力又退回"声明即实测"（全绿 55 门）。
      const presence = measureParserPresence();
      const probe = parserSupportProbe(presence);
      const langNames = useInstalled
        ? diagnoseCapabilitiesByEntries(probeInstalledLanguages(), probe)
        : diagnoseCapabilities(languageCatalog().map((l) => l.name), probe);
      const gaps = aggregateGaps(langNames);
      const totalNeed = Object.values(gaps).reduce((x, y) => x + y.length, 0);
      const capabilities = allCapabilities().map((c) => ({
        id: c.id,
        label: c.label,
        default: c.default,
        overrides: c.overrides,
        parser_bound: c.parserBound === true,
      }));
      const scope = useInstalled
        ? `已安装语言（${probeInstalledLanguages().length} 门）`
        : `语言名单全量（${languageCatalog().length} 门）`;
      // ★ P0-1 第 2 处：**单位归一**的解析器读数（`33/55`，与 README / `docs/FACTS.json` 同一把尺）。
      const parserRatio = formatParserRatio(presence);
      // 明细（逐门带原因）—— 读数之外要能追到"哪几门、为什么"；原因分档见 parser_presence.ts
      const parserReading = {
        loadable: presence.loadable.length,
        registered: presence.registered.length,
        without_parser: presence.withoutParser.map((w) => `${w.lang}:${w.reason}`),
        note: '`parserBound` 的能力（ast_parse_skeleton）档位 = 声明上限 ∩ 实测；实测判据 = probe.isLanguageInstalled ∩ languages.pkgSpec（唯一实现 parse/parser_presence.ts）',
      };
      // ★★★ 2026-10-27（T-#96）：**「全局声明来源」覆盖率读数** —— 每门语言的适配器有没有声明 `globals`
      //   （内置名 / 宿主全局名）。这不是门，只报读数：原先这些名字散在 9 张表 + 5 个 `isXxxFile` 判断里，
      //   没人能回答"哪门语言漏了"；现在一行就看得见。
      //   判据：清单里应当只剩**没有全局概念**的语言（纯标记语 / 骨架类）。
      const langsAudited = useInstalled ? probeInstalledLanguages() : languageCatalog();
      const globalsDeclared = langsAudited.filter((l) => LANG_ADAPTERS[l.name]?.globals).map((l) => l.name);
      const globalsMissing = languagesWithoutGlobals(LANG_ADAPTERS, langsAudited);
      const globalsReading = {
        declared: globalsDeclared,
        missing: globalsMissing,
        note: '`globals` = 本语言的内置名/宿主全局名（callees · hostCallees · types · namespaces），数据住 parse/globals.ts',
      };
      return {
        message:
          `能力矩阵审计（${scope}）：` +
          (totalNeed === 0
            ? '✅ 无缺口：所有功能对该语言名单均为 AST 全量'
            : `🔧 缺口总计 ${totalNeed} 个「功能×语言」对`) +
          `\n已登记功能 ${capabilities.length} 项。` +
          // ★ P0-1：矩阵里那一排 🟢 之前是**默认值**，现在与解析器实测取过交 ⇒ 这一行是它的分母
          `\n解析器实测：${parserRatio}` +
          `\n全局声明来源：已声明 ${globalsDeclared.length} 门 · 未声明 ${globalsMissing.length} 门` +
          (globalsMissing.length > 0
            ? `（${globalsMissing.slice(0, 12).join(' · ')}${globalsMissing.length > 12 ? ' …' : ''}）`
            : ''),
        data:
          a.gaps_only === true
            ? { scope, totalNeed, gaps, parsers: { ratio: parserRatio, ...parserReading }, globals: globalsReading }
            : {
                scope,
                totalNeed,
                gaps,
                matrix_text: renderAuditText(langNames),
                capabilities,
                parsers: { ratio: parserRatio, ...parserReading },
                globals: globalsReading,
              },
      };
    }),
  },

  {
    // ★ 2026-10-01（④-2 按能力改判整条线）：本工具从 `harvest` 线**改判**到 `meta` 线。
    //   判据：它的能力是「以注册表为事实源回填工具契约」= **元数据 / 注册**能力（不是"收割"），
    //   与同样以工具目录为目录的 `capability_map` 同族。实现随之搬到 `./sync_contracts.js`。
    //   ★ 搬动同时消灭 5 条已知 `no-circular`（见 tool_registry.ts 的文件头说明）。
    name: 'sync_contracts',
    writes: true,
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
    writes: false,
    title: '索引可信度自检：现在的索引能不能当真',
    description:
      '只读自检：回答"我眼下读到的索引能不能当真"。给出规模（索引文件/磁盘源码/未索引/幽灵行/节点/边）、' +
      '引用状态（resolved/pending/external/failed）、**陈旧断言数**（声称 resolved 但目标符号已不在索引 ' +
      '⇒ find_references / explore_code action=impact 会静默漏报）、未保鲜文件数、待消费的自写登记、后台续建进度，' +
      '并给出一条总结论与可执行修复建议。发现"不可信"时可传 refresh:true 顺手保鲜后重报。' +
      '在"准备基于索引做改动"或"怀疑漏报/读到旧数据"之前调它。',
    inputSchema: {
      project_dir: z.string().optional().describe('项目根目录；省略则用当前工作目录'),
      refresh: z.boolean().optional().describe('true = 先跑一次保鲜（重同步变更文件 + 重开引用）再报告；默认 false = 纯只读'),
      sample: z.number().int().min(0).max(200).optional().describe('未保鲜样例的条数上限（默认 20）'),
      retry_failed: z
        .boolean()
        .optional()
        .describe(
          '★ 2026-10-27（T-#43）：把存量 `failed` 引用**重开为 pending 再跑一次**跨文件解析。' +
            '为什么需要：`reopenRefsTo()` 只在“名字还在 nodes 里”时才重开 failed ⇒ 内置名' +
            '（`JSON.stringify` / `Math.max`）永不重试 ⇒ **永久 failed**。' +
            '实测：13341 条 → 2143（84% 归位 external），**0.8s**，edges 一条没变。' +
            '★ 改了解析器判定 / 加了新语言之后**必须跑一次**，否则旧账永远看不到改善。',
        ),
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
    writes: false,
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
    writes: false,
    title: 'Contract page: everything about one symbol in one call (definition / members / producers / consumers / chain edges / glossary)',
    description:
      '**契约页 / 类型页**（只读）：给一个**符号名或类型名**，**一次给全**六块 —— 调用方**不用再调别的工具**：' +
      '① 定义在哪（文件:行 + 签名，来自内核 AST）；' +
      '② 字段/成员清单（interface / type / class，内核 AST 走出来的成员）；' +
      '③ 谁产生它（产者 = find_references mode=field 的「构造点」）；' +
      '④ 谁消费它（消费者 = mode=symbol 的 definition.refs + importers，三档含定义点）；' +
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
    name: 'chain_hop_args',
    writes: false,
    title: "Prepare runnable args for a chain hop: direction='first' (chain/tool -> first-step JSON) | 'next' (upstream touched -> next-tool JSON)",
    description:
      '**生成链上某一跳的可跑入参**（只读）：按 `direction` 分两档——' +
      "\n· `direction='first'`（缺省）：给**链名** `chain` 或**起点工具名** `tool`，产出**第一棒**的可跑 JSON" +
      "（能填的填好、意图位显式留空并标注；不给 chain/tool ⇒ 列出所有链 + 各自的起手）。" +
      "\n· `direction='next'`：给**上一步的工具名** `from_tool` + 它的 `touched`（对象，**原样给**），产出**下一步**的可跑 JSON" +
      "（可选 `to_tool` 只算通到那一个下游；不给 = 列出所有可接的下一棒）。" +
      '\n★ 占位串/槽位/落位复用同一批函数（`first_hop_args` / `next_hop_args` 同族的实现原样复用，零改动）。' +
      '\n★ 旧工具名 `first_hop_args` / `next_hop_args` 保留为**兼容别名**（行为逐字相同）—— 新调用请用本入口。',
    inputSchema: {
      direction: z
        .enum(['first', 'next'])
        .optional()
        .describe(
          "跳的方向：'first'=起手入参（chain/tool → 第一棒 JSON，缺省值）| 'next'=下一棒入参（from_tool+touched → 下游 JSON）。不给 ⇒ 按 first 处理（'next' 的必填字段缺失会当场报，不会静默当 first）",
        ),
      // ── first 档字段 ──
      chain: z.string().optional().describe("[first] 链名（如 'refactor'）——与 tool 二选一；都不给 = 列出所有链 + 各自的起手"),
      tool: z.string().optional().describe('[first] 起点工具名（链/工具二选一）'),
      // ── next 档字段 ──
      from_tool: z.string().optional().describe("[next] 上一步的工具名（= 接法表里那条边的 `from`）；★ direction='next' 时必填"),
      touched: z
        .object(handoffTouchedShape)
        .optional()
        .describe("[next] 上一步 `---DATA---` 里的 `touched` 对象（原样给）；★ direction='next' 时必填"),
      to_tool: z.string().optional().describe('[next] 可选：只算通到这一个下游的接续；不给 = 列出所有可接的下一棒'),
      // ── 共用 ──
      project_dir: z.string().optional().describe('目标项目根目录（缺省 = 当前工作目录）'),
    },
    handler: wrapData(async (a) => {
      // ★ direction 判定：显式给 > 按字段推断（touched/from_tool 出现 ⇒ next；否则 first）。
      //   显式给 'next' 但缺必填 ⇒ 当场报（不静默回落 first——"没说清"不许被读成"起手"）。
      const dir = a.direction === 'next' ? 'next' : a.direction === 'first' ? 'first' : a.touched || a.from_tool ? 'next' : 'first';
      const projectDir = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined;
      if (dir === 'first') {
        const r = firstHopArgs({
          chain: typeof a.chain === 'string' && a.chain ? a.chain : undefined,
          tool: typeof a.tool === 'string' && a.tool ? a.tool : undefined,
          project_dir: projectDir,
          defs: listToolDefs(),
        });
        return { message: renderFirstHopArgs(r), data: { ...r, direction: 'first' } };
      }
      // next：touched 必填（显式 next 但缺 touched ⇒ 报人话；隐式 next（按字段推断）缺 touched 不可能——推断条件就是 touched 存在）
      const touchedObj = touchedObjectOf(a.touched);
      const r = nextHopArgs(touchedObj, {
        from_tool: typeof a.from_tool === 'string' && a.from_tool ? a.from_tool : undefined,
        to_tool: typeof a.to_tool === 'string' && a.to_tool ? a.to_tool : undefined,
        defs: listToolDefs(),
      });
      return { message: renderNextHopArgs(r), data: { ...r, direction: 'next' } };
    }),
  },

  // ★★ 第⑬项第三刀（2026-11-10）：first_hop_args / next_hop_args **退役出 MCP 面**（注册项摘除）——
  //   chain_hop_args 已接管（direction 参数分派），两个别名不再占公共工具位。
  //   「它去哪了」由 `capability_map.ts#RETIRED_TOOLS` 回答（唯一权威；这里不再写第二份）。
  //   执行核（firstHopArgs / nextHopArgs / render*）保留——chain_hop_args 在用，引擎内部导航不受影响。

  // ★★ 第⑬项第三刀（2026-11-10）：first_hop_args / next_hop_args **退役出 MCP 面**（注册项摘除）——
  //   chain_hop_args 已接管（direction 参数分派），两个别名不再占公共工具位。
  //   「它去哪了」由 `capability_map.ts#RETIRED_TOOLS` 回答（唯一权威；这里不再写第二份）。
  //   执行核（firstHopArgs / nextHopArgs / render*）保留——chain_hop_args 在用，引擎内部导航不受影响。
  //
  // ★★ 第⑬项第三刀（2026-11-10）：gateway_provider **退役出 MCP 面** —— 基建运维（供应商 Key 池管理），
  //   模型面没有消费场景；CLI/内部保留（`infrastructure/llm_gateway.js` 执行核不动）。

  {
    // ★★★ 2026-11-18（R53 族 · 台账写面）：台账引擎（`application/ledger/ledger.ts`）的**唯一工具面** ——
    //   单工具 + action 枚举，每个 action **直映一个引擎 API**（纯透传 + 参数校验；语义判定全在引擎）。
    //   ★ 为什么挂 meta 线：裁定原文 `¶§I#581`「写面新 `ledger` 工具（**meta lane**，+2-4KB 走有意识
    //     `mcp_scan --update`）」—— 台账是**项目级元数据账**（不是设计册、不是源码），
    //     与 `capability_map` / `index_integrity` 同族。
    //   ★ `writes:false` 的判据（口径 = 是否经 saveDSL 写设计册）：它写的是
    //     `tasks.db#ledger_rows / ledger_events / ledger_review_queue`，**一次 saveDSL 都不调**。
    //     ★ 反向有牙：拿 `ledger` 的名字经 `via:'tool'` 去写设计册会被**点名拒绝**
    //       （`tests/p1_ledger_tool.test.ts` ⑫ 钉住，并带消融：把声明改成 true ⇒ **同一次写**就放行）。
    //   ★ 为什么不能挂 `edit_dsl`：台账有**自己的 id 空间（ref_id）与自己的三态 + 事件流**，
    //     与设计册的 `todos[]` 是两件事（`ledger.ts` 头注①-⑥）。
    name: 'ledger',
    writes: false,
    title: 'Ledger: 台账唯一入口（挂账 / 批注 / 销账 / 重开 / 取代 / 裁定 / 列 / 取 / 待人工队列 / 消项）',
    description: LEDGER_TOOL_DESCRIPTION,
    inputSchema: LEDGER_INPUT_SCHEMA,
    handler: wrapData(ledgerHandler),
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
    // ★ 2026-10-27（T-#97b）：并进边自己那一行 —— 原先换行 ⇒ **每条边占两行**，5 条边就是 10 行版面税。
    return miss.length ? `　· 还要给：${miss.join(', ')}` : '　· **必填已填满**';
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

  // ★★★ 2026-10-27（T-#97b）：**默认只列前 3 条**，其余给指针。
  //   实测：一次 `find_references`（只有 3 行结果）里，接续段 16 行 / 2064B = **回执的 80%** ——
  //   它是个**固定版面税**，小结果时最刺眼。而"还有几条"用一次 `next_hop_args` 就能拿到，
  //   不必把整张表摊在每次调用里（★ 与"信息只留一处"同一条理）。
  // ★★ 2026-10-27（用户追问「给指针是什么意思」时抓到的真 bug）：**指针必须指得通**。
  //   第一版写成 `next_hop_args(tool='find_references')` —— 而该工具的必填是 **`touched`**，
  //   照着这行走会直接报"缺必填：touched"⇒ 指针形同虚设（比不给指针更糟：让人以为全貌拿不到）。
  //   ⇒ 现在指到**两次都跑得通**的调用：`next_hop_args(touched=…本回执 ---DATA--- 里的那个…)`
  //     （它会把每个下游的入参**逐格填好**、只留意图位），以及 `capability_map(from_tool, touched)`。
  // ★★★ 2026-10-27（用户追问「默认只列 3 条能看清全貌吗 / 我把这段当使用指南」）：
  //   ⇒ **首次给全貌，之后才收敛**（渐进披露）：
  //     · 本进程第一次在这个工具上出现接续段 ⇒ 全给（这时它是**指南**：教怎么接下一棒）；
  //     · 已经看过一次 ⇒ 只给前 3 条 + 一行「看全貌跑什么」（这时它是**提示**：别再摊一遍）。
  //   ★ 为什么用进程内 Set 而不落盘：这是**读的人**的状态，不是项目数据；长驻 MCP server 天然记住，
  //     `npm run tool` 每次新进程 ⇒ 每次都全给（人读 CLI 时正需要指南）。
  //   ★ 显式覆盖：`AGENT_IO_HANDOFF=full|brief`（不熟工具设 full，批量跑设 brief）。
  //    ★★ 2026-10-28 修正（用户追问「压缩上下文或交给子代理会不会影响」）：**会** ——
  //    原先是"本进程第一次给全貌"，但**读的人会换**：上下文被压缩后我不记得看过，子代理更是从没看过，
  //    而服务端仍记着"已给过" ⇒ 新读者永远只见 3 条、还以为是全貌。**隐藏状态与读者不匹配**，删掉。
  //    ⇒ 现在**无状态**：默认 3 条 + 一行**跑得通**的"看全貌"指针（全貌永远一次调用可达）；
  //      要整段摊开就 `AGENT_IO_HANDOFF=full`（人读 CLI / 第一次摸某个工具时用）。
  const handoffMode = (process.env.AGENT_IO_HANDOFF ?? '').toLowerCase();
  const showAll = handoffMode === 'full';
  const SHOW = showAll ? Number.POSITIVE_INFINITY : 3;
  const more = (n: number): string[] =>
    n > SHOW
      ? [
          `    …另有 ${n - SHOW} 条 —— 看全貌跑：\`next_hop_args(touched=<本回执 ---DATA--- 里的 touched>)\`（会把每个下游入参逐格填好）` +
            '；★ 第一次接这个工具就先跑它，那份回执就是指南',
        ]
      : [];
  if (ready.length) L.push('', `  ★ **直接可用**（值已取好 · 共 ${ready.length} 条）：`, ...ready.slice(0, SHOW), ...more(ready.length));
  if (needPick.length)
    L.push('', `  ★ **要你选一个**：${needPick.length} 条（**不替你选**）`, ...needPick.slice(0, SHOW), ...more(needPick.length));
  if (blocked.length) L.push('', `  ★ 接不上（上游没产出该键）：${blocked.length} 条`, ...blocked.slice(0, SHOW), ...more(blocked.length));

  if (uni.length) L.push('', '  ★ 全称：' + uni.map((u) => u.trim().replace(/\s+/g, ' ')).join('；'));
  const unused = Object.keys(cur).filter((k) => !used.has(k));
  if (unused.length) L.push('', `  ★ touched 里**没被任何边用到**的键：${unused.join(', ')}（不是错误，只是本表没接它）`);
  if (!ready.length && !needPick.length && !blocked.length) {
    L.push('', '  （该工具在接法表里**没有对象类出边** ⇒ 它通常是"链的终点"；作用域键见下面的全称规则）');
  }
  // ★★★ 2026-10-27（T-#97b）：**不变的长散文压成一行**（历史：这四段每段都印在每个工具的回执里，
  //   实测占输出一半以上，而内容对任何工具都一样）。完整规则仍住 `capability_map` 与 `docs/GUIDE-USAGE.md`。
  //   ★ 保留的两条是**读法陷阱**（多条边要合起来看、候选不替你选），其余（"只读""非接口""当年跑过"）是**契约级说明**，
  //     不该占每次调用的版面。
  L.push(
    '',
    '  ★ 接续只给**位置与对象**（意图你给 · 候选不替你选 · 多条边要合看）；本段只读、非"跑通过"证明。' +
      `规则与全表：\`capability_map(from_tool='${fromTool}', touched=<本回执里的 touched>)\``,
  );
  return L.join('\n');
}
