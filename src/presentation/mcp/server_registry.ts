/**
 * server_registry：MCP 工具注册表（路线图序号 2 收敛）
 *
 * 只注册主工具（2026-08-17 起旧工具名别名已全部移除，无兼容层）。
 *
 * 设计：
 * - 每个工具定义 = { name, title, description, inputSchema, handler }
 * - handler(args) 返回 MCP content 数组（text + isError）
 * - 主工具走强 schema；explore_code/manage_feature 用宽松 record，内部强校验
 *
 * 主工具 handler 复用现有纯函数（src/tools/*.ts），不重写业务逻辑，因此
 * 500+ 单测（针对纯函数）不受影响。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeCapabilityMapHandler, LANE_IDS, type LaneId } from '../../application/meta/capability_map.js';
import { indexIntegrity, renderIntegrity } from '../../application/meta/index_integrity.js';
import { ensureProjectIndex, detectStaleIndex } from '../../tools/index_freshness.js';
import { hasLiveIndex } from '../../tools/write_gate.js';
import { prewarmKernel } from '../../infrastructure/parse/index.js';
import { scheduleBackfill, backfillState, isIndexIncomplete } from '../../tools/index_backfill.js';
import { renderGranularityNote } from '../../application/refactor/parse_capability.js';
import { unknownArgHints, renderArgHints } from '../../tools/arg_suggest.js';
import { listFileSnapshots, rollbackFileSnapshot } from '../../application/refactor/file_snapshot.js';
import { recommendObservePoints } from '../../application/observe/observe_points.js';
import { collectPendingAlertText, dispatchDslEdit } from '../../infrastructure/daemon/dispatch.js';
import { exportSvg, exportMarkdown } from '../../tools/export.js';
import { deriveMindMap } from '../../application/meta/derive_mind_map.js';
import { queryFeature } from '../../tools/query_feature.js';
import { updateFeature } from '../../tools/update_feature.js';
import { scaffold } from '../../application/design/scaffold.js';

import { backfillScaffold } from '../../application/design/backfill.js';
import { checkConsistency } from '../../tools/consistency.js';
import { detectDrift } from '../../tools/detect_drift.js';
import { exploreCode, EXPLORE_ACTIONS } from '../../application/meta/explore_code.js';
import { editCode } from '../../application/refactor/edit_code.js';
import { importProject } from '../../infrastructure/graph/import_project.js';
import type { ImportProjectInput } from '../../infrastructure/graph/import_project.js';
import { manageFeature, MANAGE_ACTIONS } from '../../application/design/manage_feature.js';
import { diffViews } from '../../tools/diff_views.js';
import { archiveNode, listArchive } from '../../application/meta/archive_node.js';
import { setDesignIntent } from '../../application/design/set_design_intent.js';
import { harvestDecisions } from '../../tools/harvest_decisions.js';
import { syncContracts } from '../../tools/sync_contracts.js';
import { harvestClosure } from '../../application/harvest/harvest_closure.js';
import type { HarvestClosureInput } from '../../application/harvest/harvest_closure.js';
import { extractContracts } from '../../application/harvest/extract_contracts.js';
import type { ExtractContractsInput } from '../../application/harvest/extract_contracts.js';
import { reconcileEffects } from '../../application/observe/reconcile_effects.js';
import type { ReconcileEffectsInput } from '../../application/observe/reconcile_effects.js';
import { reconcileBrick } from '../../application/harvest/reconcile_brick.js';
import type { ReconcileBrickInput } from '../../application/harvest/reconcile_brick.js';
import { searchBricks } from '../../application/harvest/search_bricks.js';
import type { SearchBricksInput } from '../../application/harvest/search_bricks.js';
import { assembleBricks } from '../../application/harvest/assemble_bricks.js';
import { narrateStep } from '../../application/observe/narrate_step.js';
import type { NarrateStepInput } from '../../application/observe/narrate_step.js';
import type { AssembleBricksInput } from '../../application/harvest/assemble_bricks.js';
import { buildBrickifyPreview } from '../../application/design/render_brickwork.js';
import { harvestFromUrl } from '../../application/harvest/harvest_from_url.js';
import type { HarvestFromUrlInput } from '../../application/harvest/harvest_from_url.js';
import { slimBrick } from '../../application/harvest/slim_brick.js';
import type { SlimBrickInput } from '../../application/harvest/slim_brick.js';
import { renameMany, type RenameItem } from '../../tools/ast_rename.js';
import { renameSymbols } from '../../application/refactor/rename_symbols.js';
import { moveSymbol } from '../../application/refactor/symbol_move.js';
import { findReferences } from '../../application/refactor/find_references.js';
import { runTests } from '../../application/observe/run_tests.js';
// （`tools/stale_check` 的导入已随 P-F 删除：本文件不再直接消费它 —— 三个 stale 告警各自
//   探测，`stale_check.formatStaleText` 仍由 lanes/observe.ts 的 `run_tests` 前置提示使用。）
import { detectReachableRoots } from '../../application/cross/project_root.js';
import { analyzeImpact, analyzeHubs } from '../../infrastructure/analysis/impact/index.js';
import type { ImpactChangePoint } from '../../infrastructure/analysis/impact/index.js';
import { compareProjects } from '../../infrastructure/analysis/cross_repo/index.js';
import { precheckHybrid, VERDICT_LABEL } from '../../infrastructure/analysis/hybrid/index.js';
import { captureBaseline, verifyBaseline, baselinePathFor } from '../../infrastructure/analysis/behavior/index.js';
import { analyzeHealth } from '../../infrastructure/analysis/health/index.js';
import { renameFiles } from '../../application/refactor/rename_files.js';
import { removeDeadImports, removeDeadImportsWithVerify, type RemoveDeadImportsVerifyOptions } from '../../application/refactor/remove_dead_imports.js';
import { runRefactorPipeline } from '../../application/refactor/refactor_pipeline.js';
import { planFunctionAnnotation, scanFileAnnotations } from '../../application/refactor/function_annotation.js';
import { getFeatureLine } from '../../application/observe/feature_line.js';
import { proposeChange } from '../../application/design/code_workbench.js';
import { suggestRenames, type SuggestOptions } from '../../application/refactor/ast_suggest.js';
import { suggestDisambiguations, disambiguationItems } from '../../application/refactor/similar_names.js';
import { runRefactorJudge } from '../../application/refactor/refactor_judge.js';
import type { JudgeIssue, JudgeDecision } from '../../application/refactor/refactor_judge.js';
import { validateReason } from '../../tools/reason_validator.js';
import type { ReasonEvidenceRef } from '../../tools/reason_validator.js';
import { loadTraceRecords, buildTraceResolver } from '../../tools/trace_evidence.js';
import { runDiagnosis, formatDiagnoseText } from '../../infrastructure/analysis/diagnosis/diagnose.js';
import type { DiagnoseInput } from '../../infrastructure/analysis/diagnosis/contract.js';
import { getDSLByView, getLiveDir, getDSL, saveDSL } from '../../storage.js';
import { resolveCanvasNoteTargets, renderCanvasNotesDigest, markCanvasNotesStatus } from '../../application/meta/derive_mind_map.js';
import { decideCanvasNotes } from '../../application/meta/llm_decider.js';
import { listProjectDocs, readProjectDoc, matchDocsForTargets, buildDocsPromptBlock, type DocTargetSet } from '../../application/meta/project_docs.js';
import { listProvidersMasked, upsertProvider, deleteProvider, getStats, resetStats, testProvider } from '../../application/meta/gateway.js';
import { getProjectCacheDb } from '../../infrastructure/index/db.js';
import { recordDogfoodUsage } from '../../tools/dogfood_stats.js';
import { queryObserveLog } from '../../infrastructure/analysis/observe/log_query.js';
import { memoryObserveHandler, memoryTargetsHandler } from '../../application/observe/memory_observe.js';
import { translateGoTsHandler } from '../../infrastructure/analysis/translate/tool.js';
import { extractGo } from '../../infrastructure/analysis/translate/go_extractor.js';
import { extractRule } from '../../application/refactor/rule_extract.js';
import {
  loadRules,
  writeRule,
  isLegalRuleId,
  hasNegativeFixture,
  hasPositiveFixture,
  rulesDir,
  type Rule,
} from '../../application/refactor/rule_library.js';
import {
  collectRuleTargets,
  applyRulesToFiles,
  loadBaseline,
  writeBaseline,
  ratchetDelta,
  runFixtures,
  type ApplySummary,
} from '../../application/refactor/rule_apply.js';
import { observeTrace } from '../../tools/observe_trace.js';
import { normalizeEvents, judgeEvents, judgeEventsWithLLM, renderJudgeReport } from '../../infrastructure/analysis/observe/judge_service.js';
import { TSComparator, renderTSDiffReport, type TSDLDecl, type TSDiffReport } from '../../infrastructure/analysis/observe/contract.js';
import { rebuildChains } from '../../infrastructure/analysis/observe/chain.js';
import { reconcileChain } from '../../tools/reconcile_chain.js';
import type { ReconcileChainInput } from '../../tools/reconcile_chain.js';
import {
  instrumentProject,
  collectTsFiles,
  restoreInstrumented,
  buildProbeLedger,
  saveProbeLedger,
  clearProbeLedger,
  ledgerSummary,
} from '../../infrastructure/analysis/observe/instrument.js';
import {
  isGoProject,
  instrumentGoProject,
  restoreGoProject,
  goReportSummary,
  checkGoObserveDeps,
} from '../../infrastructure/analysis/observe/go_instrument.js';
import path from 'node:path';
import { statSync, readFileSync, writeFileSync, readdirSync, existsSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ─────────────────────────────────────────────────────────────
// 陈旧进程检测（版本握手）
// ─────────────────────────────────────────────────────────────

/**
 * 狗食缺陷修复：MCP 进程长驻，dist 重建后进程仍运行旧代码，AI 侧表现为
 * "工具缺失/参数报错却不知原因"（2026-08-18 decisions 查询缺失事件）。
 *
 * 机制：进程加载时记录本文件（dist/server_registry.js）的 mtime；
 * 每次工具调用轻量 stat 比对，dist 更新后在所有返回（含错误）尾部追加
 * 重启警告。警告由 registerAllTools 统一注入（唯一出口，覆盖全部工具；
 * wrap/wrapData 不再各自追加）。开销 = 每调用一次 stat，可忽略。
 *
 * ★ P-F（§16.6）：注入出去的**不是字符串**而是结构化告警（`ToolWarning`），
 *   由 `emitWarnings`（registry/tool_warnings.ts）负责①首次全文/后续一行摘要 ②追加
 *   `---WARNINGS---` 机器块。本文件的三个生产方只负责"判出来"。
 */
const SELF_PATH = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null; // 异常环境（理论不可达）——禁用检测
  }
})();
const SELF_MTIME_MS: number | null = SELF_PATH ? safeMtimeMs(SELF_PATH) : null;

function safeMtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 陈旧构建判定（纯函数，可单测）：加载时的 mtime 早于当前 mtime → 进程仍跑旧代码。
 * 任何一侧未知（非编译产物环境）→ `null`，静默禁用。
 *
 * ★ P-F（§16.6）：产物是**结构化告警**（不是 message）—— 分级呈现（首次全文/后续摘要）与
 *   机器通道由 `emitWarnings` 统一负责，本函数只管"判出来"。
 */
export function staleBuildWarningFor(loadedMtimeMs: number | null, curMtimeMs: number | null): ToolWarning | null {
  if (loadedMtimeMs === null || curMtimeMs === null) return null;
  if (curMtimeMs <= loadedMtimeMs) return null;
  return {
    code: 'STALE_BUILD',
    summary: 'dist 已在本进程启动后重建 ⇒ 当前响应来自旧代码（新增工具/字段/参数可能缺失或报"未知"错误）',
    detail: '本进程加载的是重建**之前**的编译产物：进程启动时记录 dist/server_registry.js 的 mtime，之后每次调用比对发现它已被更新。',
    fix: '重启 agent-io MCP server 后再执行写操作',
  };
}

/** dist 已更新（进程仍在跑旧代码）⇒ 告警；否则 null。 */
function staleBuildWarning(): ToolWarning | null {
  return staleBuildWarningFor(SELF_MTIME_MS, SELF_PATH ? safeMtimeMs(SELF_PATH) : null);
}

// ───── STALE SOURCE：改了 src 却忘了 build 的检测 ─────
// 补齐 staleBuildWarning 覆盖不到的缺口——它只在 dist 被重建后(un进程仍旧)提示，
// 若用户改了 src 但没 build，dist mtime 不变则完全无感。此处检测「src 比 dist 新」。
const PACKAGE_ROOT = SELF_PATH ? path.resolve(path.dirname(SELF_PATH), '..', '..') : null;
const SRC_DIR = PACKAGE_ROOT ? path.join(PACKAGE_ROOT, 'src') : null;
const DIST_DIR = PACKAGE_ROOT ? path.join(PACKAGE_ROOT, 'dist') : null;

/** 递归取目录内最新文件 mtime（跳过 node_modules；skipGen 时忽略 *.gen.ts 生成物，避免 build 自己造成误判） */
export function newestMtime(dir: string | null, skipGen: boolean): number | null {
  if (!dir) return null;
  let max: number | null = null;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let ents: Dirent[];
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      continue; // 目录不存在/无权限 → 视为可跳过
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') stack.push(p);
      } else if (e.isFile()) {
        if (skipGen && e.name.endsWith('.gen.ts')) continue;
        const m = safeMtimeMs(p);
        if (m !== null && (max === null || m > max)) max = m;
      }
    }
  }
  return max;
}

let _srcMaxCache: { at: number; v: number | null } | null = null;
/** src 树最新 mtime，5s 缓存避免每次工具调用递归扫全树。 */
function cachedSrcMtime(): number | null {
  const now = Date.now();
  if (_srcMaxCache && now - _srcMaxCache.at < 5000) return _srcMaxCache.v;
  const v = newestMtime(SRC_DIR, true);
  _srcMaxCache = { at: now, v };
  return v;
}

/**
 * src 树最新 mtime 晚于 dist 树最新 mtime ⇒ 结构化告警；任一未知 / 不新 ⇒ `null`。
 * 纯函数（两个 mtime 进来），与 `staleBuildWarningFor` 对称 —— 导出**为了能被测试看见**。
 */
export function staleSourceWarningFor(srcMax: number | null, distMax: number | null): ToolWarning | null {
  if (srcMax === null || distMax === null) return null;
  if (srcMax <= distMax) return null;
  return {
    code: 'STALE_SOURCE',
    summary: '`src/` 比 `dist/` 新（疑似改了源码但未 `npm run build`）—— 当前工具跑的是旧编译产物',
    detail: 'dist 产物比源旧：工具的行为（新增字段/修好的 bug）不会体现在本进程里，直到重建。',
    fix: '`npm run build` 后重启 agent-io MCP server 生效',
  };
}

/**
 * src 比 dist 新（改了源码未 build）⇒ 结构化告警；否则 `null`。
 *
 * ★ P-F（§16.6）：原先的状态位 `_lastStaleState`（"转变时报一次、持续期静默"）**已删除** ——
 *   分级呈现（首次全文 / 后续一行摘要，且后续**不静默**）统一交给 `emitWarnings` 的进程内记账。
 *   删除的原因：那个状态位把"持续陈旧"变成**永久静默**（§2d：把"少做了什么"藏起来 ——
 *   后来加入的读者永远不知道图是旧的）。
 */
function staleSourceWarning(): ToolWarning | null {
  return staleSourceWarningFor(cachedSrcMtime(), newestMtime(DIST_DIR, false));
}

// ─────────────────────────────────────────────────────────────
// 通用索引陈旧告警（"不撒谎"不变量的**结构性兜底**）
//
// 为什么要有它：索引层的唯一不变量是「LLM 读到的内容要么与磁盘一致，要么**明确标注**可能旧」。
// 但"保鲜"此前靠**每个工具自己记得调** `ensureProjectIndex` —— 实测 60 个工具里有 **17 个**
// 直接开 cache.db 却没任何保鲜入口（`diff_impact`、`function_outline`、`overview`…），
// 其中 `diff_impact` 给的是**行动建议**，读旧图会直接导致改错。
//
// 与其逐个补（下次加工具还会漏），不如在**响应注入层**兜一次：跟 `staleSourceWarning` 同一套
// 做法（5s 探测缓存），一次覆盖全部工具。
// 它只 stat、不解析、不写库 —— 负责"标注"，不负责"修复"（修复让 LLM 去调 refresh:true）。
//
// ★ 诚实标注它的**边界**（别把它当成保证）：
//   ① 有 **5s 探测缓存**（与 `staleSourceWarning` 同一约定）⇒ 刚刚发生的改动最多 5s 内
//      可能还没被标注到；这是"标注"而非"闸门"，真正的保证在 L1a（写穿）与 L3（读前自证）。
//   ② 只比 `size` + `mtime`（毫秒取整）⇒ **等长改写落在同一毫秒**会漏判（见 detectStaleIndex 注释）。
//   ③ ★ P-F（§16.6）：不再"只在状态转变时报一次、持续期静默"（那会把"少做了什么"藏起来，§2d）
//      —— 改为**每轮都给**，但分级：首次全文 / 之后一行摘要。分级的状态位在
//      `registry/tool_warnings.ts` 的进程内记账里（键含本函数的 `scope` = 项目根）。
// ─────────────────────────────────────────────────────────────

const STALE_INDEX_TTL_MS = 5000;

let _staleIndexCache: { root: string; at: number; stale: number; total: number; sampled: boolean; selfWrites: number } | null = null;

/** 从工具入参里取项目根（各工具参数名不统一，两个都认） */
function projectRootArg(args: Record<string, unknown>): string | null {
  for (const k of ['project_dir', 'project_root', 'root', 'dir']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * 测试隔离用：清掉陈旧告警的**探测缓存**（5s TTL），让下一次调用重新 stat。
 * ★ 与 `resetWarningDelivery()`（清"已投递全文"的记账）**分开**：前者=模拟"过了 5s"，
 *   后者=模拟"新进程"。搅在一起就会让"首次全文/后续摘要"这条性质无法被观测。
 */
export function resetStaleIndexWarningCache(): void {
  _staleIndexCache = null;
}

/**
 * 索引是否落后于磁盘 → 结构化告警；无索引 / 无根 / 出错 → `null`（静默，不干扰主流程）。
 *
 * `scope` = 项目根：换项目各自算"首次全文"（分级键 `STALE_INDEX@<root>`）。
 * 导出是为了**能被测试看见** —— 这类"注入型"逻辑最容易静默失效（永远返回 null 也没人发现）。
 */
export function staleIndexWarning(rawRoot: string | null): ToolWarning | null {
  if (!rawRoot) return null;
  let root: string;
  try {
    root = path.resolve(rawRoot);
  } catch {
    return null;
  }
  try {
    if (!hasLiveIndex(root)) return null;
    const now = Date.now();
    if (!_staleIndexCache || _staleIndexCache.root !== root || now - _staleIndexCache.at >= STALE_INDEX_TTL_MS) {
      const db = getProjectCacheDb(root);
      const p = detectStaleIndex(db, root);
      _staleIndexCache = { root, at: now, stale: p.stale, total: p.total, sampled: p.sampled, selfWrites: p.selfWritesPending };
    }
    const c = _staleIndexCache;
    if (c.stale <= 0 && c.selfWrites <= 0) return null;
    const scope = c.sampled ? `抽样 ${c.total} 个已索引文件中的一段` : `全部 ${c.total} 个已索引文件`;
    return {
      code: 'STALE_INDEX',
      scope: root,
      summary: `符号索引落后于磁盘（${scope}里有 ${c.stale} 个已被改动${c.selfWrites ? `，另有 ${c.selfWrites} 个自写登记待同步` : ''}）—— 本次结果可能基于旧图`,
      detail:
        '`find_references` / `impact_analysis` 之类可能少报、或指向已改名的符号。' +
        '（探测口径：只比 size + mtime，5s 缓存；这是"标注"而非"闸门"。）',
      fix: '先调 `index_integrity({project_dir, refresh:true})` 保鲜（或直接用任一读工具触发保鲜）',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 首次接触 ⇒ 后台建索引（2026-09-15，用户拍板："白跑一轮索引对 LLM 是免费的"）
//
// 此前索引只能从"第一次读"开始建（explore_code 拼图 + 后台续建）——"工作区创建"
// 没有钩子，没接线。任何带 project_root 的工具调用都是对项目的**首次接触**：
// 在唯一入口顺手起后台续建（分小批、可中断、unref 定时器，**不阻塞本次调用**），
// 把建索引的起点从"第一次读"提前到"第一次任何调用"。对 LLM 免费：后台跑，
// 本次调用的耗时不受影响；需要索引的工具自身的冷启/拼图照旧优先。
//
// 纪律：
//   - `noAutoFresh` 的工具不触发（`index_integrity` refresh:false 必须纯只读，连库都不该建；
//     `import_project` 自己做全量导入）。
//   - 根必须是真实存在的目录（不给幻觉路径凭空造 `.agent-io`）。
//   - `AGENT_IO_AUTO_BACKFILL=0` 一键关（对齐 `AGENT_IO_AUTO_WATCH` 的 env 约定）。
//   - 起了之后**诚实标注**：索引在建 ⇒ 本轮结果可能不全 —— 这是"不撒谎"不变量的
//     "明确标注"那半边。`staleIndexWarning` 只覆盖"有索引但落后于磁盘"，
//     覆盖不了"索引还没建完"这种**空缺型不全**（查不到 ≠ 不存在），由本标注兜。
// ─────────────────────────────────────────────────────────────

/** 后台续建进行中 → 诚实标注"结果可能不全"（没在跑 → 空串） */
function backfillProgressNote(absRoot: string): string {
  const s = backfillState(absRoot);
  if (!s?.running) return '';
  const prog = s.total > 0 ? `${s.done}/${s.total}` : '刚启动';
  return (
    `\n[索引] 该项目还没有完整索引 —— 后台建索引进行中（${prog}）。` +
    '**本轮结果可能不全**（还没索引到的文件查不到 ≠ 不存在）；建完后自动精确，`index_integrity({project_dir})` 可查进度。'
  );
}

/**
 * 首次接触 ⇒ 起后台建索引；返回要注入响应的诚实标注（已有索引且没在建 → 空串）。
 * 导出是为了**能被测试看见** —— "顺手起后台"这类逻辑最容易静默失效（永远不起也没人发现）。
 */
export function firstContactBackfill(rawRoot: string | null): string {
  if (!rawRoot || process.env.AGENT_IO_AUTO_BACKFILL === '0') return '';
  try {
    const abs = path.resolve(rawRoot);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return ''; // 幻觉路径不建库
    if (hasLiveIndex(abs)) return backfillProgressNote(abs); // 已有索引：只承担"在建中标注"
    scheduleBackfill(abs, { batch: 20, intervalMs: 200 }); // 幂等单飞；首个批次在 +200ms 后台起
    return backfillProgressNote(abs);
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// 行动工具的可信度自动附注（§5-②，2026-09-15）
//
// 分工（别跟 staleIndexWarning 重复）：
//   - `staleIndexWarning`（全部工具）：索引**落后于磁盘**（not_fresh / 待消费自写登记）
//     —— 靠 stat 就能发现的那类旧。
//   - 本附注（只给"准备基于索引做改动/下结论"的工具）：**陈旧断言**（resolved 但目标符号
//     已不在索引）—— 索引**自己内部**不一致，文件内容没变 ⇒ 保鲜路径（L3①）看不见它，
//     唯一线索是这批行本身。它造成的是**静默漏报**：find_references / impact_analysis
//     "查到了但少了"，LLM 无从察觉 —— 对行动建议类工具是最危险的一种错。
//
// 为什么**不设缓存**：一次纯 SQL 计数（resolved 行 × nodes.name 反查），毫秒级；
// 且 rename_symbols 这类工具**自己会修**陈旧引用（写穿重开）—— 带缓存的附注会在
// 修完之后还报旧的数，那是附注自己在撒谎。宁可每次都查，也不要"过期的诚实"。
// ─────────────────────────────────────────────────────────────

/**
 * 行动工具的可信度附注：陈旧断言 > 0 ⇒ 提示"本结论可能静默漏报"并给可执行修复。
 * 健康时返回空串（不刷屏）。无索引也返回空串（那种"不全"由 firstContactBackfill 标注）。
 * 导出是为了**能被测试看见** —— 注入型逻辑最容易静默失效。
 */
export function trustNoteFor(rawRoot: string | null): string {
  if (!rawRoot) return '';
  try {
    const root = path.resolve(rawRoot);
    if (!hasLiveIndex(root)) return '';
    const db = getProjectCacheDb(root);
    const stale =
      (db
        .prepare(
          `SELECT COUNT(*) c FROM unresolved_refs u
           WHERE u.status = 'resolved'
             AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
        )
        .get() as { c: number } | undefined)?.c ?? 0;
    if (stale <= 0) return '';
    return (
      `\n⚠️ TRUST：符号索引内有 ${stale} 条**陈旧断言**（声称"已解析"、但目标符号已不在索引）——` +
      '本工具的结论可能**静默漏报**（查到了但少了，且无从察觉）。' +
      '先 `index_integrity({project_dir, refresh:true})` 修复（重开重解析：连得上重连、连不上明确标 failed）再采信本结果。'
    );
  } catch {
    return '';
  }
}


// ─────────────────────────────────────────────────────────────
// 基础设施：已抽到 src/registry/（P1a，2026-09-28）
//   抽出的原因：TOOL_DEFS 要按 lane 切文件，而 lane 文件必须用到 ToolDef / 三个包装器 /
//   20 个共享 handler —— 它们原先都定义在本文件内部 ⇒ lane 一 import 就成环
//   （server_registry → lanes → server_registry）。先抽成独立模块，依赖就变成单向。
// ─────────────────────────────────────────────────────────────

import type { ToolDef } from '../../application/types.js';
import { looseInputSchema, textOut, wrap, wrapData } from '../../application/plumbing.js';
import { emitWarnings, type ToolWarning } from './tool_warnings.js';
import {
  getDslHandler,
  editDslHandler,
  manageFeatureHandler,
  renderDesignHandler,
  scaffoldHandler,
  backfillHandler,
  consistencyHandler,
  detectDriftHandler,
  exploreCodeHandler,
  diffViewsHandler,
  archiveNodeHandler,
  syncContractsHandler,
  setDesignIntentHandler,
  listArchiveHandler,
  harvestDecisionsHandler,
  observeLogHandler,
  observeTraceHandler,
  observeJudgeHandler,
  reconcileChainHandler,
  observeInstrumentHandler,
} from '../../application/handlers.js';

// 对外仍从本模块导出（原 `export interface ToolDef` 的公开 API 位置不变）
export type { ToolDef };

// ─────────────────────────────────────────────────────────────
// ToolDef 定义：9 主工具 + 别名
// ─────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────
// TOOL_DEFS：按能力线拆分（P1b，2026-09-28）
//   条目逐字搬移到 src/application/<线名>/index.ts；此处只做汇总。
//   ★ 数组顺序因此改变 —— 顺序**不是**对外契约（MCP 工具按名寻址），
//     该判断已写明在 tests/server_registry.tool_snapshot.test.ts 的文件头。
// ─────────────────────────────────────────────────────────────
import { OBSERVE_TOOLS } from '../../application/observe/index.js';
import { CROSS_TOOLS } from '../../application/cross/index.js';
import { DESIGN_TOOLS } from '../../application/design/index.js';
import { META_TOOLS, bindToolDefs } from '../../application/meta/index.js';
import { REFACTOR_TOOLS } from '../../application/refactor/index.js';
import { HARVEST_TOOLS } from '../../application/harvest/index.js';
import { bindLaneOf, type LaneAssign } from '../../application/meta/capability_map.js';

/**
 * ★ 能力线来源（P1c）：**归属由文件所在表达** —— 本数组是"lane 文件 → 线 id"的**唯一**映射。
 *
 * 为什么还留这 6 行映射：文件名 `design.ts` 与导出名 `DESIGN_TOOLS` 之间没有机器可读的联系，
 * 总得有一处把两者接到线 id（`'design'`）上。把它压到**唯一一处**即可；
 * 再在 `capability_map.ts` 里存第二份，就是漂移源（P1c 之前的 `LANE_OF` 正是那份）。
 *
 * 顺序**不是**对外契约（MCP 工具按名寻址，见 tests/server_registry.tool_snapshot.test.ts）。
 * 文件名 ↔ 线 id 是否配对、六份来源是否两两不交且并集 = TOOL_DEFS，由 tests/registry/lane_sources.test.ts 兜。
 */
export const LANE_SOURCES: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = [
  ['observe', OBSERVE_TOOLS],
  ['cross', CROSS_TOOLS],
  ['design', DESIGN_TOOLS],
  ['meta', META_TOOLS],
  ['refactor', REFACTOR_TOOLS],
  ['harvest', HARVEST_TOOLS],
];

const TOOL_DEFS: ToolDef[] = LANE_SOURCES.flatMap(([, defs]) => [...defs]);

/**
 * 由 lane 来源汇总出「工具 → 线」归属表。
 * P1c 之前这张表是**手抄**在 `capability_map.LANE_OF` 里的第二份清单；现在由来源派生。
 */
export function laneOfFromSources(
  sources: ReadonlyArray<readonly [LaneId, readonly ToolDef[]]> = LANE_SOURCES,
): Record<string, LaneAssign> {
  const table: Record<string, LaneAssign> = {};
  for (const [lane, defs] of sources) for (const d of defs) table[d.name] = { lane };
  return table;
}

// ★ 破环注入：meta 线的 capability_map 需要真实注册表作目录，而 TOOL_DEFS 是各 lane 汇总出来的。
//   用到时才解析（handler 调用期），故加载期注入一次即可（见 lanes/meta.ts 的说明）。
bindToolDefs(TOOL_DEFS);
// ★ P1c 归属注入：capability_map 不再持有归属清单，改由本文件的 lane 来源派生后送进去。
bindLaneOf(laneOfFromSources());

// ─────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────

/** 注册全部主工具到 McpServer（旧工具名别名已于 2026-08-17 全部移除） */

/**
 * ★★★ 工具的**唯一调用入口**（2026-09-30 抽出）—— MCP 面与 CLI 面调**同一个函数**。
 *
 * 它把「每次调用前保鲜 / 首次接触建索引 / 参数纠错 / 狗食统计 / 响应注入」这五件**外围事**
 * 从注册闭包里搬出来，于是**任何**入口都自动获得它们。
 *
 * ★ 为什么必须抽（**实测的真缺陷**，不是风格问题）：那些**手写的** CLI
 *   （`health_cli` / `impact_cli` / `behavior_cli` / `cross_repo_cli` / `hybrid_cli` …）
 *   **全都没有**保鲜、陈旧告警、狗食统计（实测各 0 命中）⇒ 它们跑的是**旧索引 + 无任何标注**，
 *   给出不可信的结果**还不说**。
 *   ⇒ 「CLI 从唯一真相源投影」的价值不只是消重，是**让 CLI 自动获得这些能力**（结构保证，不是自觉）。
 *
 * ★ 为什么放本文件而不是新开 `registry/invoke.ts`：它需要的 7 个外围函数
 *   （`projectRootArg` / `firstContactBackfill` / `staleIndexWarning` / `trustNoteFor` …）**都定义在本文件里**
 *   ⇒ 另开模块会成环（本仓 §P1a 已为同样的理由抽过一层基础设施）。
 *   等 `server_registry.ts` 按 §44 搬进 `presentation/mcp/` 时，本函数一并搬去 `registry/invoke.ts`。
 */
export async function invokeTool(
  def: ToolDef,
  args: Record<string, unknown> | undefined,
): Promise<{ text: string; isError?: boolean }> {
  const a = (args ?? {}) as Record<string, unknown>;
  // ★ 首次接触 ⇒ 后台建索引（2026-09-15）：带 project_root 的调用若该项目还没有索引，
  //   顺手起后台续建（不阻塞本次调用）——把建索引的起点从"第一次读"提前到"第一次任何调用"。
  //   起了就诚实标注"本轮结果可能不全"（空缺型不全，staleIndexWarning 覆盖不了）。
  const rootArg = projectRootArg(a);
  const firstContactNote = def.noAutoFresh ? '' : firstContactBackfill(rootArg);
  // ★ L3① 结构性精确化（2026-09-15）：有索引的项目，**每次调用前先保鲜**。
  //   为什么放这里：保鲜此前靠"每个工具自己记得调 ensureProjectIndex"，实测 60 个工具里有
  //   17 个直接开 cache.db 却没接 ⇒ 只能靠 staleIndexWarning 做**标注**。标注满足了不变量的
  //   "要么标注"那半边，但结果本身仍是旧的。这里在**唯一入口**做一次，全部工具的结果自动精确，
  //   以后新增工具也不用记得（结构保证，不是自觉）。
  //   成本：ready 态实测 ~35ms/次（390 文件）；有变更时付的是本来也要付的重同步钱。
  //   纪律：bootstrap:false —— 绝不因为一次调用就冷启建索引；失败静默（结果里仍有陈旧告警兜底）。
  //   ★ 后台续建在建时跳过（isIndexIncomplete）：后台循环本来就在持续同步，逐调用保鲜
  //     只会重复全盘走查 + 触发 MAX_ADDS_PER_REFRESH 噪音；"在建 ⇒ 可能不全"由 firstContactNote 标注。
  if (rootArg && !def.noAutoFresh) {
    try {
      if (hasLiveIndex(rootArg) && !isIndexIncomplete(rootArg)) await ensureProjectIndex(rootArg, { bootstrap: false });
    } catch {
      /* 保鲜失败不阻断主流程（staleIndexWarning 仍会兜底标注） */
    }
  }
  // ★ 参数纠错（Did you mean）：zod object 会**静默丢弃**未知键（错参数 = 结果莫名其妙），
  // 这里对"够像"的未知键给一条建议；只提示不阻断，不够像则静默（避免噪音）。
  const knownArgs = Object.keys(def.inputSchema ?? {});
  const argHints = renderArgHints(unknownArgHints(a, knownArgs), knownArgs);
  // 狗食正式统计：记录每次工具调用的成败与子动作（失败静默，不阻断主流程）
  const t0 = Date.now();
  const r = await def.handler(a);
  recordDogfoodUsage({
    ts: new Date().toISOString(),
    tool: def.name,
    action: def.name === 'explore_code'
      ? (typeof a.action === 'string' ? a.action : undefined)
      : def.name === 'edit_code'
        ? (typeof a.op === 'string' ? a.op : undefined)
        : undefined,
    ok: !r.isError,
    ms: Date.now() - t0,
    err: r.isError ? (r.text ?? '').slice(0, 200) : undefined,
  });
  // 响应注入（顺序即拼接顺序）：① 参数纠错（Did you mean）② 陈旧告警家族（BUILD/SOURCE/INDEX，
  //          **结构化** + 首次全文/后续一行摘要，见 registry/tool_warnings.ts）③ 索引在建标注（首触）
  //          ④ 行动工具的可信度附注（陈旧断言 → 静默漏报预警）：在 handler **之后**算 ——
  //          rename_symbols 等工具自己会修陈旧引用，附注必须反映"修完之后"的现状。
  //          ⑤ watch 产出的未读影响提醒借力本次响应自动送达；⑥ `---WARNINGS---` 机器块（最末）。
  //    ★ P-F（§16.6）：三个 stale 告警不再各自拼字符串，而是产出 `ToolWarning`，由 `emitWarnings`
  //      统一分级 + 生成机器块（**追加在文本最末**，好让 `split(marker)[1]` 直接 `JSON.parse`）。
  //      注入点在 handler 之后、`wrap`/`wrapData` **之外** ⇒ 不经过那两个包装器，
  //      所以本笔无需改动 plumbing.ts（`wrap` 丢 `data` 与这里的告警通道无关）。
  const trustNote = def.trustAnnotated ? trustNoteFor(rootArg) : '';
  const alertNote = await collectPendingAlertText(def.name);
  const emission = emitWarnings([staleBuildWarning(), staleSourceWarning(), staleIndexWarning(rootArg)]);
  // ★ 只回**合成好的文本**（含注入的告警块），**不在这里包 MCP 形状** ——
  //   「怎么呈现」是各面自己的事：MCP 面用 `textOut(...)` 包成 `{content:[...]}`，
  //   CLI 面直接打到 stdout。★ 这样两个面共用的就是**同一份合成逻辑**（唯一真相源）。
  return { text: r.text + argHints + emission.text + firstContactNote + trustNote + alertNote + emission.block, isError: r.isError };
}

export function registerAllTools(server: McpServer): void {
  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: looseInputSchema(def.inputSchema) as unknown as z.ZodRawShape },
      async (args) => {
        const r = await invokeTool(def, args as Record<string, unknown>);
        return textOut(r.text, r.isError);
      },
    );
  }
}

export { TOOL_DEFS };

