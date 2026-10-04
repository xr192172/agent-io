/**
 * registry/handlers.ts —— server_registry 内联的共享 handler
 *
 * ★ P1a（2026-09-28）：从 `server_registry.ts`（3,586 行）抽出的**基础设施**。
 *   20 个跨 lane 复用的主工具 handler（每个 lane 文件都会用到其中若干）。
 *
 * 为什么必须先抽这一层（而不是直接按 lane 切 TOOL_DEFS）：
 *   lane 文件要用到这里的东西，而它们原先都定义在 `server_registry.ts` 内部 ⇒
 *   lane 一 import 就成环（server_registry → lanes → server_registry）。
 *   拆出本模块后，lane 文件可以单向依赖它。
 */
import path from 'node:path';
import { wrap, wrapData } from './plumbing.js';
import { dispatchDslEdit } from './dispatch.js';
import { rebuildChains } from '../infrastructure/analysis/observe/chain.js';
import { TSComparator, renderTSDiffReport } from '../infrastructure/analysis/observe/contract.js';
import type { TSDLDecl, TSDiffReport } from '../infrastructure/analysis/observe/contract.js';
import { checkGoObserveDeps, goReportSummary, instrumentGoProject, isGoProject, restoreGoProject } from '../infrastructure/analysis/observe/go_instrument.js';
import { buildProbeLedger, clearProbeLedger, collectTsFiles, instrumentProject, ledgerSummary, restoreInstrumented, saveProbeLedger } from '../infrastructure/analysis/observe/instrument.js';
import { judgeEvents, judgeEventsWithLLM, normalizeEvents, renderJudgeReport } from '../infrastructure/analysis/observe/judge_service.js';
import { queryObserveLog } from '../infrastructure/analysis/observe/log_query.js';
import { getDSLByView, getLiveDir, requireProjectRoot } from '../infrastructure/storage.js';
import { archiveNode, listArchive } from './meta/archive/archive_node.js';
import { checkConsistency } from './design/intent/consistency.js';
import { deriveMindMap } from './meta/view/derive_mind_map.js';
import { detectDrift } from './design/intent/detect_drift.js';
import { diffViews } from './refactor/rf-view/diff_views.js';
import { EXPLORE_ACTIONS, exploreCode } from './meta/explore/explore_code.js';
import { exportMarkdown, exportSvg } from '../infrastructure/render/export.js';
import { harvestDecisions } from './harvest/harvest_decisions.js';
import { manageFeature } from './design/lifecycle/manage_feature.js';
import { observeTrace } from './observe/capture/observe_trace.js';
import { queryFeature } from './meta/explore/query_feature.js';
import { validateReason } from './observe/reconcile/reason_validator.js';
import type { ReasonEvidenceRef } from './observe/reconcile/reason_validator.js';
import { reconcileChain } from './observe/reconcile/reconcile_chain.js';
import type { ReconcileChainInput } from './observe/reconcile/reconcile_chain.js';
import { scaffold } from './design/lifecycle/scaffold.js';
import { setDesignIntent } from './design/intent/set_design_intent.js';
import { syncContracts } from './meta/registry/sync_contracts.js';
import { buildTraceResolver, loadObservedTraceRecords } from './observe/capture/trace_evidence.js';
import { updateFeature } from './design/dsl_ops/update_feature.js';

// ─────────────────────────────────────────────────────────────
// 8 个主工具 handler
// ─────────────────────────────────────────────────────────────

/** get_dsl：只读查询（复用 queryFeature）。
 * ★ 用 wrapData：queryFeature 返回 `{ message, data? }` —— data 是查询的结构化产物
 *   （dsl / nodes / edges / files / functions …），wrap 会在通道层静默丢弃它。 */
export const getDslHandler = wrapData(async (a) => queryFeature(a as never));

/** edit_dsl：统一写操作（复用 updateFeature，Step A 扩展后覆盖更多写动作）
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核）：[B] 一路到 [C] 的结果类型 `EditResult`
 *   （`src/tools/edit_result.ts`）**结构上只有 `{ message, feature }`，没有 `data` 字段**——
 *   `dispatchDslEdit` 的两条路径（daemon / 本地 updateFeature）都只造这两个键
 *   ⇒ 这里没有任何结构化产物被通道丢掉，`wrap` 是**对的那一个**，不换。
 *   （若将 [B] 补出 `data`，本处再随之升级；那是动 [B] 的契约，不在本笔范围。） */
export const editDslHandler = wrap(async (a) => {
  // 视图写护栏：live 是代码快照，只能由 import/watch 重建，禁止手改
  if (a.view === 'live') {
    throw new Error(
      '实际视图（view=live）是代码快照，只读，请勿手改。要改请用 view=design（设计视图）；' +
        '要重建实际视图请用 import_project 工具（全量导入），增量监听用 explore_code action=watch。',
    );
  }
  // 活文档：变更原因校验（L1-L4）。weight=routine → 轻量写路径（level=3，仍有 L1/L2/L3，
  // 跳过 L4 证据回溯），给日常维护放行；默认 normal → 全链强闸。
  const reason = (a.reason as string | undefined) ?? '';
  const evidence = (a.evidence as ReasonEvidenceRef[] | undefined) ?? [];
  const level = a.weight === 'routine' ? 3 : 4;
  const dsl = getDSLByView(a.feature as string, 'design');
  const entityIds: string[] = [];
  if (dsl) {
    for (const n of dsl.geometry?.nodes ?? []) entityIds.push(n.id);
    for (const e of dsl.geometry?.edges ?? []) entityIds.push(e.id);
    for (const f of dsl.semantic?.files ?? []) {
      if (f.id) entityIds.push(f.id);
      if (f.path) entityIds.push(f.path);
    }
  }
  // L4 证据回溯：源 = **observe 线真实录制的事件**（JSONL，`observe_instrument` 的探针落盘，
  // 候选项与 `observe_trace` 同源）。★ 2026-10-01：原先读 `<live_dir>/<feature>.trace.json`，
  // 而那份文件全仓只有一个产者 —— 已被撤掉的 `tools/trace_reasoning.ts`（零接触自动插桩），
  // 且它写的 token 是"行数"这个合成代理值。改读事件后，验的是**真实测量**（dur_ms），代价是
  // 证据不再与 feature 绑定（事件是会话级的）。
  // 没有录制事件 → 无法回溯 → evidence 一律打回（宁缺毋滥，杜绝编造证据进库）。
  // routine 轻量路径跳过此步（level=3，不加载事件）。
  let traceResolver:
    | { exists?: (ev: ReasonEvidenceRef) => boolean; traceRefs?: string[] }
    | undefined;
  if (level >= 4) {
    const { records } = loadObservedTraceRecords();
    traceResolver = records.length > 0 ? buildTraceResolver(records) : undefined;
  }
  const v = validateReason({
    reason,
    evidence,
    level,
    resolver: {
      entityIds,
      exists: traceResolver?.exists,
      traceRefs: traceResolver?.traceRefs,
    },
  });
  if (!v.ok) {
    throw new Error(`变更原因校验未通过（L${v.layer}）：${v.error}`);
  }
  // 写收敛（方向 E）：daemon 可用则转发单写者队列执行（乐观锁 + 读改写互斥），
  // 否则本地 updateFeature（现状降级）。冲突时抛错，LLM 据此 rebase，绝不静默覆盖。
  const { result } = await dispatchDslEdit(a as unknown as Record<string, unknown>, (input) => updateFeature(input as never));
  return result;
});

/** manage_feature：生命周期。★ wrapData：manageFeature 返回 `{ message, data? }`（create/list 等的结构化产物） */
export const manageFeatureHandler = wrapData(async (a) => manageFeature(a as never));

/** render_design：渲染思维导图/HTML/SVG/Markdown（format 参数聚合导出；view 决定渲染设计或实际视图）
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核）：把四个分支的 [B] 结果逐字段拆开看过后，
 *   **换成 `wrapData` 的净收益为零，代价是回执被淹**：
 *     · 非重复字段 = 产物路径（`htmlFile` / `file` / `jsonFile`）+ `feature`
 *       —— 这些**已逐字出现在 message 里**（`已渲染：<path>` / `已导出 SVG：<path>` /
 *       `L3 结构骨架已生成：<jsonFile>`）⇒ 放进 `---DATA---` 只是第二遍；
 *     · [B] 的四个结果类型都**自带 `message` 字段**（与回执同一份文本）⇒ `data: r` 会逐字重复；
 *     · 唯一不冗余的字段是 `mind_map`（整棵树）—— 它是**超大对象**（节点数随项目规模线性增长），
 *       且 `deriveMindMap` 已经把它**落盘到 message 给出的 `jsonFile`**（agent 可按路径读）
 *       ⇒ 直接塞进回执是"淹掉回执"，正是 §2d 说的那种"为了好看而加的东西"。
 *   ⇒ 保留 `wrap`；**这不是漏迁，是逐字段算过后的判定**（不刷假账）。 */
export const renderDesignHandler = wrap(async (a) => {
  // 默认 mindmap：现行思维导图架构（root → 功能分组 → 文件）。
  // ★ 2026-09-30：原 `format=html`（自包含单文件设计画布·星图）**已删除** ——
  //   它是 lane 自己标注"仅调试用"的旧路径、渲染效果差；前端（dsl-workbench）自取数据渲染。
  //   详见 `lanes/design.ts` 的 tool description 与台账 §44.9。
  const format = typeof a.format === 'string' ? a.format : 'mindmap';
  const feature = a.feature as string;
  const output_path = typeof a.output_path === 'string' ? a.output_path : undefined;
  if (format === 'mindmap') {
    if (!feature) throw new Error('render_design mindmap 模式需要 feature（从存储读取设计 DSL 派生）');
    const r = await deriveMindMap({ feature, gen_descriptions: false });
    // 空导图：DSL 无 semantic.files 时导图就是空的。
    // ★ 原先这里会「降级渲染设计画布」把产物凑出来；那条路径已随自包含 HTML 一起删除
    //   ⇒ 改为**如实报告为空 + 给补数据的方向**。§2d：失败就说失败，不假装有产物。
    if ((r.mind_map.root.children ?? []).length === 0) {
      return {
        message:
          `⚠ 思维导图为空：DSL 的 semantic.files 还没有内容。\n${r.message}\n` +
          `提示：先 import_project 或 edit_dsl 补充 semantic.files 后再派生思维导图。`,
      };
    }
    return {
      message:
        r.message +
        `\n交互版（人机共笔：⊕ 新增分支 / 双击批注 / 保存回写 DSL）：http://localhost:3000/mindmap/${feature}`,
    };
  }
  if (format === 'svg') {
    const r = exportSvg({ feature, output_path });
    return { message: r.message };
  }
  if (format === 'markdown') {
    const r = exportMarkdown({ feature, output_path });
    return { message: r.message };
  }
  // ★ 到不了这里：`format` 已被 lane 的 zod 枚举约束在 mindmap|svg|markdown 内。
  //   仍**显式抛错**而不是静默返回 —— 不写兜底（§3），真越界要响。
  throw new Error(`render_design 不支持的 format：${String(format)}（只支持 mindmap / svg / markdown）`);
});

/** 生成骨架（原独立入口，★ 面收敛第三批已并入 lane `scaffold` 的单入口 action=generate）。
 *  ★ wrapData（2026-09-29）：[B] `scaffold` 回 `ScaffoldResult`
 *   = `{ message, written_files: string[], dir }` —— `written_files`（生成的文件路径表）与 `dir` 原被 `wrap` 丢掉，
 *   agent 只能从"1. 2. 3. …"编号散文里正则抠路径。`message` 不放进 data（同一份回执文本，重复无益）。
 *  ★ 2026-10-05 随 [B] 还债：旧 `files` 一名 6 义 ⇒ 路径表统一 `written_files`。
 *  ★ 本壳不再被任何 lane 引用（编排内联进 `lanes/design.ts` 的 `scaffold` entry）——
 *   保留只为不牵动 `server_registry.ts` 的具名导入清单（该文件另有一批同类死导入，属独立卫生笔）。 */
export const scaffoldHandler = wrapData(async (a) => {
  const r = scaffold({
    feature: a.feature as string,
    project_dir: a.project_dir as string | undefined,
    output_dir: a.output_dir as string | undefined,
    overwrite: a.overwrite as boolean | undefined,
    ui_framework: a.ui_framework as 'vue' | 'react' | 'html' | undefined,
  });
  return { message: r.message, data: { written_files: r.written_files, dir: r.dir } };
});


/** consistency_check：一致性。★ wrapData（2026-09-29）：[B] 回 `ConsistencyResult`
 *   = `{ message, fileResults[], invariantResults[], summary{totals…} }` ——
 *   逐文件 API 匹配明细 + 不变式结果 + **计数摘要**原被 `wrap` 丢掉（agent 无从机器判定"过没过"）。 */
export const consistencyHandler = wrapData(async (a) => {
  const r = await checkConsistency({
    feature: a.feature as string,
    code_dir: a.code_dir as string | undefined,
  });
  return {
    message: r.message,
    data: { fileResults: r.fileResults, invariantResults: r.invariantResults, summary: r.summary },
  };
});

/** detect_drift：活文档↔代码漂移检测（代码变更 → 提示 DSL 过时/欠实现），持久化台账 */
export const detectDriftHandler = wrapData(async (a) => {
  return detectDrift({
    feature: a.feature as string,
    code_dir: a.code_dir as string | undefined,
    scope: a.scope as 'changed' | 'all' | undefined,
    since_ref: a.since_ref as string | undefined,
    mode: a.mode as 'check' | 'status' | undefined,
  });
});

/** explore_code：参数化代码理解（用 wrapData：data 不丢弃，杜绝「有结果却静默空输出」）
 * 兼容两种入参形态：`{ action, args:{...} }`（嵌套，规范）或平铺 `{ action, query, ... }`——
 * 缺 action 时从平铺参数反推（query→search / file→read），消除"习惯平铺传参 → -32602 invalid action"的摩擦。 */
function resolveExploreAction(a: Record<string, unknown>, args: Record<string, unknown>): string {
  if (typeof a['action'] === 'string') return a['action'] as string;
  if ('query' in args) return 'search';
  if ('file' in args) return 'read';
  const msg = `explore_code 缺顶层 action。可用: ${EXPLORE_ACTIONS.join(' / ')}。search 传 {query, project_dir}，read 传 {file, project_dir}；其余路径请显式给 action[+args]。`;
  throw new Error(msg);
}
export const exploreCodeHandler = wrapData(async (a) => {
  const hasNested = typeof a.args === 'object' && a.args !== null && !Array.isArray(a.args);
  const args = (hasNested ? a.args : a) as Record<string, unknown>;
  const action = resolveExploreAction(a as Record<string, unknown>, args) as never;
  const result = await exploreCode({ action, args });
  return { message: result.message, data: result.data };
});

/** diff_views：设计视图 vs 实际代码快照双栏对比。★ wrapData：handler 本就回 `data: r.data`（结构化对比表） */
export const diffViewsHandler = wrapData(async (a) => {
  const r = diffViews({
    feature: a.feature as string,
    live_dir: a.live_dir as string | undefined,
  });
  return { message: r.message, data: r.data };
});

/** 下线归档的单动作壳（原两入口之一）。
 * ★ 2026-09-29 面收敛第二批：注册入口已收编为 `archive`（action=node/list），编排内联进
 *   `lanes/meta.ts` 的 `archive` entry ⇒ 本壳不再被任何 lane 引用。保留只为不牵动
 *   `server_registry.ts` 的具名导入清单（该文件另有一批同类死导入来自第一批，属独立卫生笔）。 */
export const archiveNodeHandler = wrapData(async (a) => {
  const r = archiveNode({
    feature: a.feature as string,
    file_path: a.file_path as string,
    retire_reason: a.retire_reason as string,
    merged_into: a.merged_into as string | undefined,
  });
  return { message: r.message, data: r };
});

/** sync_contracts：以 server_registry zod schema 为唯一源，回填 DSL expected_apis。★ wrapData：回 `data: r` */
export const syncContractsHandler = wrapData((a) => {
  const r = syncContracts({ feature: a.feature as string, include_all: a.include_all as boolean | undefined });
  return { message: r.message, data: r };
});

/** 写设计意图到 overlay（原独立入口，★ 面收敛第三批已并入 lane `design_intent` 的单入口 action=set）。
 *  ★ 本壳不再被任何 lane 引用 —— 保留只为不牵动 `server_registry.ts` 的具名导入清单。 */
export const setDesignIntentHandler = wrapData((a) => {
  const r = setDesignIntent({
    feature: a.feature as string,
    goals: a.goals as never,
    edge_intents: a.edge_intents as never,
  });
  return { message: r.message, data: r };
});

/** 列下线库归档条目的单动作壳（原两入口之二）。★ 上游入口已并入 `archive`（action=node/list）。 */
export const listArchiveHandler = wrapData(async (a) => {
  const r = listArchive({ feature: a.feature as string, live_dir: a.live_dir as string | undefined });
  return { message: r.message, data: r };
});

/** harvest_decisions：从文档/git日志/注释提取决策卡候选（draft，供 review 补录）。★ wrapData：回 `data: r` */
export const harvestDecisionsHandler = wrapData(async (a) => {
  const r = harvestDecisions({
    feature: a.feature as string,
    doc_dir: a.doc_dir as string | undefined,
    git_root: a.git_root as string | undefined,
    limit: a.limit as number | undefined,
    comment_files: a.comment_files as string[] | undefined,
  });
  return { message: r.message, data: r };
});

// ─────────────────────────────────────────────────────────────
// Observe 观测工具 handler（设计→开发→测试闭环的「测试」端）
// 与 design 主工具并列同一套 MCP。底层复用 observe/* 纯函数，不重写逻辑。
// ─────────────────────────────────────────────────────────────

/** observe_log：按文件/全量查询 Observe 运行日志（复用 queryObserveLog）。
 * ★ wrapData：结构化 entries 由**通道**附带 `---DATA---`（原先手写在 message 里，现交给包装器，输出字节等价）。 */
export const observeLogHandler = wrapData(async (a) => {
  const eventsFile = a.events_file as string | undefined;
  if (!eventsFile) {
    throw new Error('observe_log 需要 events_file 参数：传 Observe 事件文件路径（events.jsonl）。');
  }
  const files = Array.isArray(a.files) ? (a.files as string[]).filter(Boolean) : [];
  const all = a.all === true || a.all === 'true' || a.all === '1';
  const r = queryObserveLog(eventsFile, { files, all });
  const lines = [
    `Observe 日志 [${r.eventsPath}]`,
    `  事件 ${r.total} · 偏差 ${r.anomalyCount} · 跳过 ${r.skipped} · 返回 ${r.entries.length} 条`,
    ...(r.entries.length === 0 ? ['  （无匹配事件）'] : []),
  ];
  for (const e of r.entries) {
    const mark = e.result === 'deviation' ? '✗' : '✓';
    lines.push(`  ${mark} [${e.result}] ${e.probe}${e.file ? ` (${e.file})` : ''} rule=${e.rule}`);
    lines.push(`      ${e.reason}`);
  }
  // 附完整结构化数据供 LLM 继续分析（由 wrapData 通道追加，不再手写；见上注释）
  return { message: lines.join('\n'), data: r.entries };
});

/** observe_trace：读录制调用链 → 采样 → 返回结构化调用树（面向 LLM 的纯后端回放）。
 * 不给 trace_id 时返回链路清单（供 LLM 挑）；给 trace_id 展开该针完整调用树文本+数据。 */
export const observeTraceHandler = wrapData(async (a) => {
  const cfg = {
    events_path: typeof a.events_path === 'string' && a.events_path ? a.events_path : undefined,
    events_text: typeof a.events_text === 'string' && a.events_text ? a.events_text : undefined,
    keep: (a.keep === 'all' ? 'all' : 'default') as 'all' | 'default',
    trace_id: typeof a.trace_id === 'string' && a.trace_id ? a.trace_id : undefined,
    limit: typeof a.limit === 'number' ? a.limit : undefined,
  };
  const r = observeTrace(cfg);
  return { message: r.message, data: r.data };
});

/** observe_judge：对一批事件执行偏差判定。decls（可选）提供时额外执行 P2 链路契约判定——
 * 重建实测调用链（trace 三元组）+ Comparator 全量对比（探针级 + 链路级），
 * 链路断裂（chain-broken）带 trace_id 与实测窗口。不传 decls 保持逐事件判定。
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核，**这条最容易被误迁**）：
 *   本 handler 的 message 在**缺省模式下就是判定结果的 JSON 全文**（`JSON.stringify(merged)`，
 *   见下方 `text` 的三元式）⇒ `data: merged` 与 message **逐字重复**，
 *   迁 `wrapData` 只会把同一份 JSON 打两遍（回执体积翻倍、零信息增量）——
 *   正是「data 会重复 message」应当保留 `wrap` 的那一类。
 *   ★ 如实记下残余缺口：`text=true` 时 message 是**人读散文**（renderJudgeReport / renderTSDiffReport），
 *     此时结构化的 `merged` 只有散文可达。要补它需要一个"**按参数条件输出 data**"的通道
 *     （缺省模式不输出 data）——那会让静态门（G11）记一笔"已迁 wrapData"而缺省模式实际仍无 `---DATA---`，
 *     属**刷假账**，故不做；此缺口在此登记，留给"回执通道按需选档"那一笔统一处理。 */
export const observeJudgeHandler = wrap(async (a) => {
  const events = a.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('observe_judge 需要 events 参数：传要判定的事件数组（符合 TSEvent 形状）。');
  }
  const { events: norm, error } = normalizeEvents(events);
  if (error) throw new Error(error);
  const useLlm = a.use_llm === true || a.use_llm === 'true' || a.use_llm === '1';
  const report = useLlm ? await judgeEventsWithLLM(norm, true) : judgeEvents(norm);

  // P2 链路契约：decls 提供时重建实测链 + Comparator 全量对比（探针级 + 链路级）
  let diff: TSDiffReport | undefined;
  let chainsNote = '';
  const decls = Array.isArray(a.decls) ? (a.decls as TSDLDecl[]) : undefined;
  if (decls && decls.length > 0) {
    const { chains, dropped } = rebuildChains(norm);
    const comp = new TSComparator().registerDefaultPredicates();
    diff = comp.compare(
      { version: 1, updated_at: new Date().toISOString(), decls },
      TSComparator.aggregate(norm),
      chains,
    );
    chainsNote = `\n链路重建: ${chains.length} 条链${dropped > 0 ? `（超预算丢弃 ${dropped} 条）` : ''}`;
  }

  const merged = diff ? { ...report, diff } : report;
  const text = a.text === true || a.text === '1'
    ? renderJudgeReport(report) + (diff ? `\n\n${renderTSDiffReport(diff)}${chainsNote}` : '')
    : JSON.stringify(merged);
  return { message: text, data: merged };
});

/**
 * reconcile_chain：中观档——按「文件/宿主节点」一条命令的真跑 + 查数据 + 对账。
 * 后工具自动前置：宿主下无 detail 链时自动调用 deriveDetailChain（缓存判断——已有链即跳过），
 * 再自动发现事件文件、按链文件过滤真跑事件、逐事件判定、重建实测链、链路契约匹配。
 */
export const reconcileChainHandler = wrapData(async (a) => {
  const input = a as unknown as ReconcileChainInput;
  if (!input.feature || !input.node_id) {
    throw new Error('reconcile_chain 需要 feature + node_id：指定宿主文件节点（detail 链挂在它下面）做中观档对账。');
  }
  const r = await reconcileChain({
    feature: String(input.feature),
    node_id: String(input.node_id),
    project_dir: requireProjectRoot({ project_dir: input.project_dir }),
    events_files: Array.isArray(input.events_files) ? (input.events_files as string[]) : undefined,
    force: input.force === true,
    max_steps: typeof input.max_steps === 'number' ? input.max_steps : undefined,
  });
  return { message: r.message, data: r };
});

/** observe_instrument：对目标项目全自动插桩 / 还原（复用 instrumentProject/restoreInstrumented）。
 * ★ wrapData：handler 回 `data`（results / ledger / 还原清单），wrap 会静默丢弃。 */
export const observeInstrumentHandler = wrapData(async (a) => {
  const target = a.target as string | undefined;
  if (!target) {
    throw new Error('observe_instrument 需要 target 参数：传要插桩的项目目录。');
  }
  const unintrument = a.action === 'uninstrument' || a.action === 'restore';
  const dryRun = a.dry_run === true || a.dry_run === 'true' || a.dry_run === '1';
  const projectRoot = a.project_root as string | undefined;
  // 契约模式：contract_probes 非空数组时只注入声明的探针点；缺省/空数组 → 探索模式全量插桩
  const contractProbes = Array.isArray(a.contract_probes) && a.contract_probes.length > 0
    ? (a.contract_probes as string[])
    : undefined;

  // Go 工程 → 桥接 go-observe（自动注入 camprobe.Capture）：插桩/还原统一出口。
  if (isGoProject(target)) {
    const lines = [`Observe Go 插桩（go-observe） ${dryRun ? 'DRY-RUN' : 'WRITE'} → ${target}`];
    const data: Record<string, unknown> = {};
    try {
      if (unintrument) {
        const restored = await restoreGoProject(target);
        if (restored === 0) {
          return { message: 'Observe Go 一键全拔：未找到备份（可能从未插桩，或备份已删除）。', data: [] };
        }
        return {
          message: `Observe Go 一键全拔：已还原 ${restored} 个文件并删除备份目录。\n` +
            `  目标：${target}\n  提示：被插桩工程内对 go-observe 的 reduce/require 需自行清理（本操作不触碰 go.mod）。`,
          data: { restored },
        };
      }
      const rep = await instrumentGoProject(target, { dryRun, deep: a.deep === true, effects: a.effects === true, contractProbes });
      const mode = contractProbes ? `契约模式（${contractProbes.length} 个探针）` : '探索模式（全量插桩）';
      lines.push(`  [${mode}] ${rep.files.length} 个 .go 文件参与扫描`);
      for (const f of rep.files) {
        if (f.error) lines.push(`  ✗ ${f.file}  ${f.error}`);
        else if (f.sites.length > 0) lines.push(`  + ${f.file}  ${dryRun ? '将注入' : '注入'} ${f.sites.length} 探针点`);
      }
      const s = goReportSummary(rep);
      lines.push(`  完成：${s.instrumented} 新插桩 / ${s.skipped} 已含探针跳过 / ${s.errors} 失败，共 ${s.totalSites} 探针点`);
      data.report = rep;
      if (dryRun) lines.push('  DRY-RUN 未写盘。传 dry_run=false 实际改写源码（备份在 .agent-io/observe-backup，随时可还原）。');
      // 运行前提预检：工程能否 import go-observe（否则插桩后编译报错）
      const deps = checkGoObserveDeps(target);
      lines.push(deps.needs_replace || deps.needs_require
        ? `  运行前提：工程尚未接 go-observe。可在 go.mod 补：
       ${deps.require_line}
       ${deps.replace_line}`
        : `  运行前提：${deps.note}`);
      return { message: lines.join('\n'), data };
    } catch (e) {
      return {
        message: `Observe Go 插桩失败：${(e as Error).message}`,
        data,
        isError: true,
      };
    }
  }

  if (unintrument) {
    const restored = restoreInstrumented(target);
    const cleared = clearProbeLedger(target);
    if (restored.length === 0 && !cleared) {
      return { message: 'Observe 一键全拔：未找到备份与台账，无需还原（可能从未插桩，或备份已删）。', data: [] };
    }
    return {
      message:
        `Observe 一键全拔：已还原 ${restored.length} 个文件并删除备份目录${cleared ? '，已清理探针台账' : ''}。\n` +
        restored.map((f) => `  ↺ ${f}`).join('\n'),
      data: { restored, ledger_cleared: cleared },
    };
  }

  const files = collectTsFiles(target);
  const results = await instrumentProject(target, { projectRoot, write: !dryRun, contractProbes, scope: a.scope === true });
  let totalSites = 0;
  let instrumented = 0;
  let skipped = 0;
  let errors = 0;
  const mode = contractProbes ? `契约模式（${contractProbes.length} 个探针）` : '探索模式（全量插桩）';
  const lines = [`Observe 插桩 [${mode}] ${dryRun ? 'DRY-RUN' : 'WRITE'} → ${target}`, `  扫描 ${files.length} 个 .ts 文件`];
  for (const r of results) {
    if (r.error) {
      errors++;
      lines.push(`  ✗ ${r.file}  ${r.error}`);
    } else if (r.sites.length > 0) {
      instrumented++;
      totalSites += r.sites.length;
      lines.push(`  + ${r.file}  ${dryRun ? '将注入' : '注入'} ${r.sites.length} 探针点`);
    } else {
      skipped++;
    }
  }
  lines.push(`  完成：${instrumented} 新插桩 / ${skipped} 已含探针跳过 / ${errors} 失败，共 ${totalSites} 探针点`);
  if (dryRun) lines.push('  DRY-RUN 未写盘。传 dry_run=false 实际改写源码（git 可兜底，幂等）。');

  // 写盘插桩成功后记账：生成探针台账 + 统计，随 data 返回供上层查看/一键全拔联动
  const data: Record<string, unknown> = { results };
  if (!dryRun && totalSites > 0) {
    const ledger = buildProbeLedger(results, target);
    const ledgerFile = saveProbeLedger(target, ledger);
    data.ledger = ledger;
    data.ledger_file = ledgerFile;
    lines.push(`  探针台账已记账 → ${ledgerFile}`);
    lines.push(`  统计：${ledgerSummary(ledger)}`);
  }
  return { message: lines.join('\n'), data };
});
