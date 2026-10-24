/**
 * agent-io serve：轻量 HTTP 服务器
 *
 * 提供：
 *   1. 静态文件服务（HTML 页面）
 *   2. /api/save —— 保存 DSL（浏览器端自动回写）
 *   3. /api/load —— 读取 DSL（页面启动时同步）
 *   4. /api/events —— SSE 实时推送（LLM 改 DSL 时画布自动刷新）
 *
 * 启动方式：
 *   node dist/src/presentation/http/serve.js [port]
 *   或 npm run serve
 */

import { DATA_DIR_NAME } from '../../infrastructure/data_dir.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { getDSL, getDesignSheetFile, getLiveFeature, onDslChange, getStorageRoot, listDesignSheets } from '../../infrastructure/storage.js';
// ★★★ 2026-10-23：画布（annotations / user_nodes / canvas_notes）搬出设计 DSL 后的唯一读写口。
//   serve 的 4 个画布端点只碰它，**不再** import `saveDSL` —— 这是「和前端切割」的接线点。
import { enableObserveFromEnv } from '../../infrastructure/analysis/observe/run_sentinel.js';
import { judgeEvent } from '../../infrastructure/analysis/observe/judge.js';
import { judgeGuardLog } from '../../infrastructure/analysis/observe/judge_guard.js';
// ★ 2026-10-22：observe 的查询 / 判定 / 提案审批已搬出本文件 ——
//   HTTP 面与 MCP 面现在调**同一份** use case（`application/observe/{runtime,reconcile}/…`）。
import { queryObserveLogUseCase } from '../../application/observe/runtime/observe_log_query.js';
import { judgeObserveEvents } from '../../application/observe/runtime/judge_observe_events.js';
import { listObserveProposals } from '../../application/observe/reconcile/proposal_list.js';
import { approveObserveProposal } from '../../application/observe/reconcile/proposal_approve.js';
import { rejectObserveProposal } from '../../application/observe/reconcile/proposal_reject.js';
import { importProject } from '../../infrastructure/graph/import_project.js';
import { getProjectCacheDb, openDb, featureCacheDbPath } from '../../infrastructure/index/db.js';
import { dagLayout, forceLayout, gridAlign } from '../../application/design/workbench/dag_layout.js';
import { checkConsistencyReport } from '../../application/design/intent/consistency.js';
import { diffImpact } from '../../infrastructure/analysis/impact/diff_impact.js';
import { diffViews } from '../../application/refactor/diff_views/diff_views.js';
import { watchProject } from '../../infrastructure/index/watch_project.js';
import { createRebuildThrottler } from '../../application/observe/runtime/watch_project_tool.js';
// ★★★ 2026-10-22：**HTTP 面接进 `invokeTool`** —— 与 MCP / CLI 同一个入口。
//
//   为什么现在才接：CLI 面早就是「`TOOL_DEFS` 的再投影」（`cli.ts` 头注自述），
//   而 HTTP 面是**第三个独立实现**（65 条各自写 handler、各自调 application）——
//   同一个能力在两个面各写一遍 = 判据住两处。
//
//   接上之后的形状：**一份能力清单（`TOOL_DEFS`）+ 三个薄适配器**。
//   适配器只做「入参怎么来、产物怎么出」，**不重做保鲜 / 身份 / 校验 / 告警**（那些在 `invokeTool` 里）。
import { TOOL_DEFS } from '../../application/tool_registry.js';
import { invokeTool } from '../mcp/server_registry.js';
import { DATA_MARKER, parseDataBlock } from '../../application/plumbing.js';
import type { ToolDef } from '../../application/types.js';
import { archLayer } from '../../infrastructure/analysis/structure/arch_layer.js';
import { guidedTour } from '../../infrastructure/index/guided_tour.js';
import { semanticSearch } from '../../application/meta/llm/semantic_search.js';
import { languageConcepts } from '../../infrastructure/analysis/capability/language_concepts.js';
import { buildDictionaryView, getGlobalDictFile, getProjectDictFile, loadGlobalDict, loadProjectDict, saveGlobalEntry, saveProjectEntry, splitHighlights, validateProjectRoot, type DictEntry } from '../../infrastructure/dictionary.js';
import { ingestTerm, generateDictEntry } from './dict_gen.js';
import { readRegistry, updateArtifact } from '../../infrastructure/index/registry.js';
import { checkMonolith } from '../../infrastructure/analysis/structure/monolith.js';
import type { FileMonolithReport } from '../../infrastructure/analysis/structure/monolith.js';
import { buildFunctionOutline, listFunctionDirs } from '../../infrastructure/index/function_outline.js';
import { getFeatureLine } from '../../application/observe/capture/feature_line.js';
import { exampleInputFor } from '../../infrastructure/analysis/observe/trace_exec.js';
import { parseFileFull } from '../../infrastructure/parse/index.js';
import { deriveMindMap, buildFileIndex } from '../../application/meta/view/derive_mind_map.js';
import { placeProposals } from '../../application/meta/view/derive_mind_map.js';
import { getOverview } from '../../application/meta/view/overview.js';
import { getMindMapFile } from '../../application/meta/view/derive_mind_map.js';
import type { MindMap } from '../../domain/mindmap.js';
import { oplAdd, oplLocate, oplDeclare, oplImplement, oplCheck, oplIntegrate, oplList, oplGet, oplAuto } from '../../application/design/derive/opl.js';
import { traceExecChain, type TraceStepSpec } from '../../infrastructure/analysis/observe/trace_exec.js';
import { schemas, RESPONSE_SCHEMA_AT, API_VERSION, type ResponseSchemaKey } from './contract.js';
import { deriveDetailChain } from '../../application/design/derive/derive_chain.js';
import { reconcileChain } from '../../application/observe/reconcile/reconcile_chain.js';
import { loadLlmConfig, pickKeyNodes, type ChainNodeInfo } from '../../infrastructure/llm_focus.js';
import {
  generateModuleNarrations,
  loadGeneratedNarrations,
  saveGeneratedNarrations,
  getExplainGenFile,
} from '../../application/meta/view/explain_gen.js';
import {
  listProvidersMasked,
  upsertProvider,
  deleteProvider,
  getStats,
  resetStats,
  testProvider,
  hasEnabledProvider,
  ensureSeededFromEnv,
  handleOpenAICompatRequest,
  type OpenAICompatRequest,
} from '../../infrastructure/llm_gateway.js';

const PORT = parseInt(process.argv[2]) || 3000;
const PUBLIC_DIR = path.join(process.cwd(), 'output');
/**
 * ★★★ 2026-10-18：界面层的"活态 DSL"改为读【设计侧】。
 *
 * ## 为什么改
 * 原来：`getLiveDslFile()` = `agent-io.json`（**全局单文件**，装"最后一次 saveDSL 的那个 feature"）。
 * ⇒ 而 2026-10-18 起 **`saveDSL` 已停写它**（它是"第三份"）⇒ **HTTP 界面读到的是冻结的旧数据**，
 *   而且"单文件只装一个 feature"这个设计本身也已退场（现在一 feature 一文件）。
 *
 * ## 现在的口径
 * 读 `.agent-io/design/<f>.dsl.json`（**唯一权威**）。feature 取 `AGENT_IO_FEATURE`，缺省 `task-system-plan`。
 *
 * ## ★ 这是**临时**的（记债 `D-http-multi-feature`）
 * 正确的做法是让界面按 `?feature=` 选，而不是靠 env 定一个 ——
 * 但 `handleApiLoad(_req, res)` 现在**连 req 都没用**（`_req`），改签名会牵动前端路由。
 * ⇒ 先让界面"看到正确的数据"，多 feature 支持另开一笔。
 */
const LIVE_FILE = getDesignSheetFile(process.env.AGENT_IO_FEATURE ?? 'task-system-plan');

// 项目根：默认 process.cwd()，可用 AGENT_IO_PROJECT_DIR 覆盖（如聚焦 src/ 做设计图闭环演示）
function getServeProjectRoot(): string {
  const override = process.env.AGENT_IO_PROJECT_DIR;
  return override ? path.resolve(process.cwd(), override) : process.cwd();
}

// SSE 客户端连接池
const sseClients: Set<http.ServerResponse> = new Set();

/** 向所有 SSE 客户端广播消息 */
export function broadcastSSE(event: string, data: unknown): void {
  const message = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

/** DSL 变更通知（供 MCP saveDSL 调用后触发） */
export function notifyDslChange(feature: string, source: string): void {
  broadcastSSE('dsl-changed', { feature, source, timestamp: new Date().toISOString() });
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** 契约护栏：给响应平铺 `_api` 版本字段，safeParse 一次；失败仅记日志，护栏不阻断渲染。
 *  guard 是「昭示」不是「改写」——payload 结构以 zod 单源为准，此处仅在顶层平铺加版本字段。 */
function guard(
  res: http.ServerResponse,
  path: string,
  schemaKey: ResponseSchemaKey,
  payload: unknown,
  status = 200,
): void {
  const tagged = { ...(payload as Record<string, unknown>), [RESPONSE_SCHEMA_AT]: API_VERSION };
  const schema = schemas[schemaKey];
  const r = schema.safeParse(tagged);
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ');
    console.error(`[contract] ${path} 响应不符契约: ${detail}`);
  }
  sendJson(res, status, tagged);
}

/**
 * POST /api/save —— **浏览器画布存盘**（serve 侧的写口）。
 *
 * ## ★★★ 2026-10-23：**已退役（410）** —— 不再是「进入名单」，是「已经关了」。
 * 依据：① 自己的 2026-10-06 决定早就把它列进退役名单（"确认新前端不再用它之后，本路径可整体删除"）；
 *      ② 它写的是**整册设计 DSL**，与「画布要和设计切割」直接冲突（用户 2026-10-23 裁定）；
 *      ③ 写闸（`assertDslWriteAllowed`）已不允许无授权整册写 ⇒ 留着它只会是一条 **500**（更坏的形状：
 *         "崩了"与"停了"在日志里长得一样）。⇒ 现在**明确回 410**，报文里指路正确入口。
 *
 * ## ★ 2026-10-06 决定：本路径**进入退役名单**
 * 依据：那份前端（`output/`）**也该退役了** —— 有更好的产品形式，后续会重新开发。
 * ⇒ 因此**不再为它做契约改造** —— 例如把 `_dsl_rev` 改成必填（那要前端配合，
 *   而前端已无心力维护）。**这个决定本身就是本笔要留的东西。**
 *
 * ## ⚠ 它的已知缺口（照实留在这里，本笔**不修**，理由见上）
 *   · **rev 乐观锁是可选**：浏览器不带 `_dsl_rev` ⇒ `baseRev=undefined` ⇒ `saveDSL` **跳过校验**
 *     （`storage.ts` 原文"省略则不做校验（保留旧直写语义，兼容既有 30 处调用）"）。
 *   · **它不走 daemon 的串行队列**（`edit_dsl` 走）⇒ 与 MCP 编辑**并发时可能静默覆盖**。
 *   · 它**没有** `edit_dsl` 的 T20「现取事实」闸与 `view=live` 护栏 —— ★ 那是**有意的**：
 *     人要向自己证明"我读过代码"没有意义；T20 防的是 **LLM 凭空断言代码事实**。
 *     （此前 todo 把这条判成"判据分叉"，**判断有误，已更正**。）
 *
 * ## ★★ 给"重新开发的新前端"的指引（本笔最要紧的一句）
 *   新前端**不要**再开一条直写 `saveDSL` 的路 —— 请复用 **daemon 的串行队列**
 *   （`POST /api/dsl` 的 `ops` 形态，见 `daemon/dslWriteHandler`：单写者 + 依赖区域分桶 +
 *    乐观锁，结构性消除"最后写者胜"）。否则会**再造一条弱闸通道**（本仓已因此踩过一次）。
 *   确认新前端不再用它之后，本路径（连同 `source='browser'` 语义）可**整体删除**。
 *
 * ## 存量语义（未被本笔改动）
 *   乐观锁（方向 F）：浏览器提交的 DSL 携带其基于的 `_dsl_rev`；磁盘当前 rev 若已被他人
 *   （MCP/其他会话）推进，则拒绝本次覆盖，返回 409 + `current_rev` 供浏览器 rebase。
 *   传 `'browser'` source：冲突分支在 `saveDSL` 抛错前不触发 SSE reload，且成功后以
 *   `'browser'` 回调，浏览器据此跳过自身刷新。
 */
async function handleApiSave(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // ★★★ 2026-10-23：**退役**（不是"暂时关掉"，也不是"崩掉"）。
  //   原来这里调 `saveDSL(result.dsl, 'browser', baseRev)` —— 写的是**整册设计 DSL**。
  //   现在写闸不允许无授权整册写 ⇒ 留着它只会是一条 500（"崩了"与"停了"在日志里长得一样）。
  //   ⇒ 明确回 410（Gone）：调得通、答得清楚、指路到现在的正确入口。
  sendJson(res, 410, {
    success: false,
    retired: true,
    error: 'POST /api/save 已退役（2026-10-23）：本路径写的是**整册设计 DSL**，已关闭。',
    why: [
      '它自己的注释 2026-10-06 就把它列进退役名单（"确认新前端不再用它之后，本路径可整体删除"）。',
      '它写整册 DSL，与「画布要和设计切割」直接冲突（用户 2026-10-23：「我们本身是要和那个做切割的呀」）。',
      '写闸 assertDslWriteAllowed 不允许无授权整册写 ⇒ 保留它只会返回 500。',
    ],
    replace_with: {
      design: [
        'POST /api/dsl（daemon 串行队列，ops 形态：单写者 + 依赖区域分桶 + 乐观锁）',
        'edit_dsl（MCP / CLI，自带键闸 + 结构闸 + 乐观锁）',
      ],
      canvas: [
        'POST /api/annotations（annotations）',
        'POST /api/user_nodes（user_nodes）',
        'POST /api/canvas-notes ｜ POST /api/canvas-notes/status（canvas_notes）',
        '★ 画布三格已搬离设计 DSL：落 .agent-io/canvas/<feature>.json（infrastructure/canvas_store.ts）',
      ],
    },
    saved_at: new Date().toISOString(),
  });
}

function handleApiLoad(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    if (!fs.existsSync(LIVE_FILE)) {
      sendError(res, 404, 'agent-io.json 不存在，请先使用 render_design 创建');
      return;
    }
    const content = fs.readFileSync(LIVE_FILE, 'utf-8');
    sendJson(res, 200, JSON.parse(content));
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

function handleApiFeatures(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    // ★ 2026-10-23：`features/` 目录已退役（overlay 并入设计册）⇒ 清单改读**设计侧唯一来源**
    //   `listDesignSheets()`（与 MCP resources、写闸同一条读端）。
    const dsls = listDesignSheets();
    const features = dsls.map((dsl) => {
      // 主导语言：semantic.files 里出现最多的扩展名
      const langCount = new Map<string, number>();
      for (const sf of dsl.semantic?.files ?? []) {
        const ext = path.extname(sf.path ?? '').slice(1).toLowerCase();
        if (ext) langCount.set(ext, (langCount.get(ext) ?? 0) + 1);
      }
      let language = '';
      let bestN = 0;
      for (const [l, n] of langCount) if (n > bestN) { bestN = n; language = l; }
      return {
        feature: dsl.feature,
        title: dsl.title || dsl.feature,
        files: dsl.semantic?.files?.length ?? 0,
        nodes: Array.isArray(dsl.geometry?.nodes) ? dsl.geometry.nodes.length : 0,
        language,
      };
    });
    guard(res, '/api/features', 'features', { features });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/observe/log?file=<path>&file=<path>&all=1：按文件路径查询 Observe 异常日志。
 * 事件文件取自 OBSERVE_EVENTS_FILE；未设置时返回 424（未启用）。可与
 * observe-dsl log --file <path> 等价使用，供 LLM/前端按文件主动拉取某条链路的日志。 */
function handleApiObserveLog(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const eventsPath = process.env.OBSERVE_EVENTS_FILE;
    if (!eventsPath) {
      sendError(res, 424, 'OBSERVE_EVENTS_FILE 未设置，Observe 日志未启用。请在启动 serve 前设置该环境变量。');
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const files = url.searchParams.getAll('file').filter((f) => f.trim() !== '');
    const all = url.searchParams.get('all') === '1' || url.searchParams.get('all') === 'true';
    const result = queryObserveLogUseCase({ events_path: eventsPath, files, all });
    sendJson(res, 200, result);
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** Observe 判定下沉服务（语言无关）：POST /api/observe/judge 判定一批事件。
 * body: { events: TSEvent[] } → 逐条判定 + 汇总。任何语言的探针都能 POST。
 * 可选 ?text=1 返回人类可读报告（等价 Go RenderReport）。 */
async function handleApiObserveJudge(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf-8') || '{}');
    } catch {
      sendError(res, 400, '请求体需为合法 JSON：{ "events": [...] }');
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const textMode = url.searchParams.get('text') === '1';
    const r = await judgeObserveEvents({
      events: (parsed as { events?: unknown }).events,
      use_llm: url.searchParams.get('use_llm'),
      text: textMode ? '1' : undefined,
    });
    if (!r.ok) {
      sendError(res, 400, r.error);
      return;
    }
    if (textMode) {
      sendJson(res, 200, { text: r.text, ...r.report });
      return;
    }
    sendJson(res, 200, r.report);
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/live?feature=：读取实际 DSL（代码实时快照，live/ 目录） */
function handleApiLive(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const dsl = getLiveFeature(feature);
    if (!dsl) {
      sendError(res, 404, '实际 DSL 未生成，请先 POST /api/live/rebuild 或等待自动同步');
      return;
    }
    sendJson(res, 200, dsl);
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/live/rebuild?feature=：从当前项目重建实际 DSL 到 live/（不覆盖设计 DSL） */
async function handleApiLiveRebuild(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const projectRoot = getServeProjectRoot();
    let cacheDb;
    try {
      cacheDb = getProjectCacheDb(projectRoot);
    } catch {
      cacheDb = undefined;
    }
    const result = await importProject({ project_dir: projectRoot, feature, cache_db: cacheDb, live_only: true });
    // 重建成功后推送 SSE：打开的画布自动刷新并重新跑 diff 高亮（source=watch，非 browser，避免循环）
    broadcastSSE('dsl-changed', { feature, source: 'watch', timestamp: new Date().toISOString() });
    // ★★ 2026-10-11（T161）：**原先这里是 `result.message.split('\n')[0]`** —— 只回首行 `已导入项目 → feature "x"`。
    //   ⇒ 把 `importProject` 回执里**其余全部**静默掉了，其中包含**它专门声明"不静默"的那几条**：
    //     · `⚠ 单文件化预警 N 个:`（**多行清单**）· `跳过/截断:`（**多行清单**）
    //     · `designDropNote`（源码逐字："★ T77：重建丢掉了什么，**明确报出来**（不静默）"）
    //     · 基线事实 / 文档 / overlay 提示
    //   ★★ 而**同一个回执在本文件里还有另一个出口**（下面的目录上传/本地路径导入端点，
    //      `message: imp.message` = **完整**）⇒ **同一件事两处两种口径**（本仓头号病根），
    //      且**截断的这处正是丢警告的**。
    //   ⇒ 修法：与那个出口**对齐成完整 message**（★ 不是加 `headline` 字段糊一层 ——
    //     那会留下"两处各持一份口径"）。判据：**上层不许把下层的"不许静默"静默掉**。
    sendJson(res, 200, {
      success: true,
      message: result.message,
      files: result.files_parsed,
      symbols: result.symbols_found,
      cache: result.cache ?? null,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/import：浏览器目录上传导入项目
 * body: { files: [{ path, content }], feature? } —— 前端用 webkitdirectory 选目录后
 * 逐文件读文本（已过滤 node_modules/二进制）。服务端把源码持久化到
 * .agent-io/projects/<feature>/ → importProject 解析（DSL 记 source_root）→
 * renderDesign 渲染项目地图并注册产物。 */
const IMPORT_BODY_LIMIT = 200 * 1024 * 1024; // 目录上传远超通用 5MB 上限
async function handleApiImport(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req, IMPORT_BODY_LIMIT);
    let parsed: { files?: { path: string; content: string }[]; feature?: string; source_dir?: string };
    try {
      parsed = JSON.parse(body.toString('utf-8') || '{}');
    } catch {
      sendError(res, 400, '请求体需为合法 JSON：{ "files": [...], "feature": "…" } 或 { "source_dir": "本地路径" }');
      return;
    }
    // feature 名：显式指定 > source_dir 目录名 > 首文件顶层目录名 > 首文件名
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'project';
    let feature = parsed.feature ? sanitize(parsed.feature) : '';

    // —— 模式 A：本地路径导入（大项目免上传，source_root=真实路径，文件定位直接开真实文件）——
    const sourceDir = typeof parsed.source_dir === 'string' ? parsed.source_dir.trim() : '';
    if (sourceDir) {
      const abs = path.resolve(sourceDir);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        sendError(res, 400, `本地路径不存在或不是目录：${abs}`);
        return;
      }
      if (!feature) feature = sanitize(path.basename(abs));
      const cacheDb = openDb(featureCacheDbPath(feature));
      let imp;
      try {
        imp = await importProject({
          project_dir: abs,
          feature,
          cache_db: cacheDb,
          gen_roles: true,
          source_root: abs,
        });
      } finally {
        cacheDb.close();
      }
      // ★ 2026-09-30：导入后**不再渲染"自包含 HTML"**（该能力已删，见台账 §44.9）。
      //   前端（dsl-workbench）从 /api/features 等端点自取数据渲染；本端点只回导入回执。
      //   ⚠ 对外契约变更：响应里**去掉了 `html` 字段**（前端实测未使用，只用 `feature`）。
      broadcastSSE('project-imported', { feature, at: new Date().toISOString() });
      sendJson(res, 200, { success: true, feature, message: imp.message, local: true });
      return;
    }

    // —— 模式 B：目录上传导入（浏览器 webkitdirectory 选文件夹）——
    const files = (parsed.files || []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
    if (!files.length) {
      sendError(res, 400, '没有可导入的文件');
      return;
    }
    if (!feature) {
      const segs = files[0].path.split('/').filter(Boolean);
      feature = sanitize(segs.length > 1 ? segs[0] : (segs[0] || 'project').replace(/\.[^.]+$/, ''));
    }

    // 源码持久化到 .agent-io/projects/<feature>/（重复导入整体替换旧快照）。
    // DSL.source_root 指向这里，巨石体检/影响面/一致性等读源功能据此定位文件。
    // 上传路径首段是用户所选文件夹名（webkitdirectory 特性），与 feature 命名重复，剥掉。
    const projDir = path.join(process.cwd(), DATA_DIR_NAME, 'projects', feature);
    if (fs.existsSync(projDir)) fs.rmSync(projDir, { recursive: true, force: true });
    for (const f of files) {
      const segs = f.path.split('/').filter(Boolean);
      const rel = segs.length > 1 ? segs.slice(1).join('/') : segs.join('/');
      if (!rel) continue;
      // 防路径穿越：规范化后必须落在项目目录内
      const dest = path.join(projDir, rel);
      if (path.relative(projDir, path.resolve(dest)).startsWith('..')) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content, 'utf-8');
    }

    // 缓存 db 固定位置（跨重复导入增量复用），与项目目录生命周期解耦
    const cacheDb = openDb(featureCacheDbPath(feature));
    let imp;
    try {
      imp = await importProject({
        project_dir: projDir,
        feature,
        cache_db: cacheDb,
        gen_roles: true,
        source_root: projDir,
      });
    } finally {
      cacheDb.close();
    }

    // ★ 2026-09-30：导入后不再渲染自包含 HTML（同上一处；见台账 §44.9）
    broadcastSSE('project-imported', { feature, at: new Date().toISOString() });
    sendJson(res, 200, { success: true, feature, message: imp.message });
  } catch (e) {
    sendError(res, 500, `导入失败：${(e as Error).message}`);
  }
}

/** 生成拆分任务单 Markdown（可直接喂给 LLM 执行拆分）；relPath 为相对 src/ 的展示路径 */
function buildSplitPlanMarkdown(r: FileMonolithReport, relPath: string, generatedAt: string): string {
  const statusLabel = r.status === 'critical' ? '严重' : '警告';
  const lines: string[] = [
    `# 拆分任务单：${relPath}`,
    '',
    `> 生成于 ${generatedAt} · agent-io checkMonolith（tree-sitter 静态解析）`,
    '> 用法：本单可直接喂给 LLM 执行拆分，或人工按表搬移声明。',
    '',
    '## 现状',
    '',
    `| 项 | 值 |`,
    `|---|---|`,
    `| 行数 | ${r.lines}（阈值 警告≥300 / 严重≥600，状态：${statusLabel}） |`,
    `| 顶层声明 | ${r.decl_count} |`,
    `| 可拆社区 | ${r.communities.length} |`,
    '',
    `分析建议：${r.suggestion}`,
    '',
  ];

  if (r.communities.length === 0) {
    lines.push(
      '## 拆分方案',
      '',
      '该文件顶层声明不足 2 个（巨型单函数/类），无法自动社区划分。建议人工按职责段拆分：',
      '',
      '1. 通读文件，用注释标记职责段（如 `// ==== 相机控制 ====`）',
      '2. 每段提取为独立函数或子模块，逐个搬迁',
      '3. 搬迁完成后重新运行 `npm run self-analyze` 验证',
      '',
    );
  } else {
    lines.push('## 拆分方案（建议新文件）', '');
    r.communities.forEach((c, i) => {
      lines.push(`### ${i + 1}. \`${c.suggested_name}\`（~${c.est_lines} 行 · 内聚引用 ${c.internal_refs}）`, '');
      lines.push(`包含声明（${c.decls.length}）：`, '');
      for (const sig of c.signatures) lines.push(`- \`${sig}\``);
      lines.push('');
    });
  }

  if (r.inter_edges.length > 0) {
    lines.push('## 跨社区引用（搬迁时需补 import）', '');
    for (const [a, b, w] of r.inter_edges) {
      const from = r.communities[a]?.suggested_name ?? `社区${a}`;
      const to = r.communities[b]?.suggested_name ?? `社区${b}`;
      lines.push(`- \`${from}\` → \`${to}\`（引用权重 ${w}）`);
    }
    lines.push('');
  }

  lines.push(
    '## 执行步骤（LLM 按序执行）',
    '',
    `1. 通读 \`src/${relPath}\`，理解各声明职责`,
    '2. 按上表创建新文件，逐个搬移声明（保留 export）',
    '3. 跨社区引用处补 import 语句',
    '4. 原文件改为纯 re-export 聚合层（或删除并全局更新引用）',
    '5. `npm run build && npm test` 验证编译与测试',
    '6. `npm run self-analyze` 重新生成报告，确认巨石消除',
    '',
  );
  return lines.join('\n');
}

/** POST /api/split_plan { path }：为单个巨石文件生成拆分任务单 */
async function handleApiSplitPlan(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { path: relPath } = JSON.parse(body.toString('utf-8'));
    if (!relPath || typeof relPath !== 'string' || relPath.includes('..') || path.isAbsolute(relPath)) {
      sendError(res, 400, '非法 path（应为相对 src/ 的路径，如 presentation/http/contract.ts）');
      return;
    }
    const absPath = path.join(process.cwd(), 'src', relPath);
    if (!fs.existsSync(absPath)) {
      sendError(res, 404, `文件不存在：src/${relPath}`);
      return;
    }
    const result = await checkMonolith({ files: [absPath], warn_lines: 500, crit_lines: 1000 });
    const report = result.reports[0];
    if (!report) {
      sendError(res, 500, 'checkMonolith 未返回该文件报告');
      return;
    }
    if (report.status === 'ok') {
      sendJson(res, 200, { ok: true, markdown: `# ${relPath}\n\n该文件 ${report.lines} 行，未超阈值（警告≥500 行），无需拆分。\n` });
      return;
    }
    if (report.status === 'cohesive') {
      sendJson(res, 200, {
        ok: true,
        markdown: `# ${relPath}\n\n该文件 ${report.lines} 行，超过体积阈值但引用高度内聚（仅 1 个社区），不构成拆分候选。\n`,
        filename: 'split_' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md',
        lines: report.lines,
        communities: report.communities.length,
      });
      return;
    }
    const markdown = buildSplitPlanMarkdown(report, relPath, new Date().toLocaleString('zh-CN'));
    sendJson(res, 200, {
      ok: true,
      markdown,
      filename: 'split_' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_') + '.md',
      lines: report.lines,
      communities: report.communities.length,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/monolith：全项目巨石体检（只读分析，不改任何文件）
 * body 三选一：{ feature } | { project_dir } | { files: [...] }，可选 warn_lines/crit_lines/max_files。
 * feature 模式：从该 DSL 的 semantic.files 取文件清单，base_dir 用 serve 项目根——
 * 项目页「深入分析 → 巨石体检」即用此模式，导入的任意项目都能体检。
 * 返回 { total_files, oversized, reports: [{ path, lines, status, decl_count, communities, suggestion }] }。 */
async function handleApiMonolith(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8') || '{}');
    const input: import('../../infrastructure/analysis/structure/monolith.js').CheckMonolithInput = {
      warn_lines: typeof params.warn_lines === 'number' ? params.warn_lines : undefined,
      crit_lines: typeof params.crit_lines === 'number' ? params.crit_lines : undefined,
      max_files: typeof params.max_files === 'number' ? params.max_files : undefined,
      flag_cohesive: typeof params.flag_cohesive === 'boolean' ? params.flag_cohesive : undefined,
      no_cache: params.no_cache === true,
    };
    if (params.feature) {
      const dsl = getDSL(String(params.feature));
      if (!dsl) {
        sendError(res, 404, `feature "${params.feature}" 不存在`);
        return;
      }
      input.feature = String(params.feature);
      // DSL 记录了 source_root（导入项目）→ checkMonolith 自动用它；
      // 否则（本仓库自身 feature）回退 serve 项目根
      if (!dsl.source_root) input.base_dir = getServeProjectRoot();
    } else if (params.project_dir) {
      input.project_dir = validateProjectRoot(String(params.project_dir), '/api/monolith project_dir');
    } else if (Array.isArray(params.files) && params.files.length > 0) {
      input.files = params.files.map(String);
    } else {
      sendError(res, 400, '缺少参数：feature / project_dir / files 三选一');
      return;
    }
    const result = await checkMonolith(input);
    sendJson(res, 200, {
      success: true,
      message: result.message,
      total_files: result.total_files,
      oversized: result.oversized,
      reports: result.reports,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/reveal-file：在系统文件管理器中定位目标文件（只读侧效果，不改任何内容）
 * body: { source_root, path } —— path 为相对 source_root 的路径（体检报告里的 rel path）
 * 跨平台：win32 → explorer /select,<abs>；darwin → open -R <abs>；linux → xdg-open 打开所在目录。
 */
async function handleApiRevealFile(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8') || '{}');
    const sourceRoot = validateProjectRoot(String(params.source_root || ''), '/api/reveal-file source_root');
    const rel = String(params.path || '');
    if (!rel) {
      sendError(res, 400, '缺少 path');
      return;
    }
    const abs = path.resolve(sourceRoot, rel);
    // 防目录穿越：解析后必须仍在 source_root 内
    const relCheck = path.relative(sourceRoot, abs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      sendError(res, 403, `path 越界：${rel} 不在 source_root 内`);
      return;
    }
    if (!fs.existsSync(abs)) {
      sendError(res, 404, `文件不存在: ${abs}`);
      return;
    }
    const platform = process.platform;
    if (platform === 'win32') {
      // 关键：explorer 对含空格路径的 /select 参数很挑剔。spawn 会为含空格参数整体加引号，
      // explorer 把引号当路径一部分 → 找不到文件 → 只打开「此电脑」。改走 exec 让 cmd 先剥引号，
      // explorer 收到干净的 `/select,C:\...\Microsoft Edge\file` 才能正确选中定位。
      await new Promise<void>((resolve) => {
        const child = exec(`explorer /select,"${abs}"`, { windowsHide: true }, () => resolve());
        child.unref?.();
      });
    } else if (platform === 'darwin') {
      const child = spawn('open', ['-R', abs], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [path.dirname(abs)], { detached: true, stdio: 'ignore' });
      child.unref();
    }
    sendJson(res, 200, { success: true, revealed: abs, platform });
  } catch (e) {
    console.error('[reveal-file] 失败:', (e as Error).message);
    sendError(res, 500, (e as Error).message);
  }
}

/**
 * 收集宿主节点下的 detail 链（含跨文件追加 __sx*，排除 CFG __alg_*）+ CFG 判定节点，
 * 供 trace-exec（真实执行）与 focus（LLM 选点）共用。
 */
function collectChainInfo(
  dsl: {
    geometry: { nodes: Array<{ id: string; x?: number; host?: string; layer?: string; label?: string; description?: string }> };
    semantic?: { files?: Array<{ id: string; path: string }> };
  },
  nodeId: string,
  projectRoot: string,
): { steps: TraceStepSpec[]; infos: ChainNodeInfo[] } {
  const rel = dsl.semantic?.files?.find((f) => f.id === nodeId)?.path;
  if (!rel) return { steps: [], infos: [] };
  // host 源文件定位：相对路径优先 projectRoot，取不到再回退 projectRoot/src（semantic.files 的 path 是相对 src/ 的）
  let hostFile = path.isAbsolute(rel) ? rel : path.join(projectRoot, rel);
  if (!path.isAbsolute(rel) && !fs.existsSync(hostFile)) {
    const underSrc = path.join(projectRoot, 'src', rel);
    if (fs.existsSync(underSrc)) hostFile = underSrc;
  }
  const nodes = dsl.geometry.nodes
    .filter((n) => n.host === nodeId && n.layer === 'detail' && !n.id.includes('__alg_'))
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0));

  const steps: TraceStepSpec[] = [];
  const infos: ChainNodeInfo[] = [];
  for (const n of nodes) {
    const funcName = (n.label || '').replace(/^[①-⑫]|^\d+\.\s*/, '').replace(/·.*$/, '').trim();
    if (!funcName) continue;
    const crossM = (n.description || '').match(/跨文件调用：(.+)$/m);
    let file = hostFile;
    if (crossM) {
      const t = crossM[1];
      if (path.isAbsolute(t)) {
        file = t;
      } else {
        // 跨文件目标相对 src/ 根（如 storage.ts），尝试 project_root 与 project_root/src 两候选
        const cands = [path.join(projectRoot, t), path.join(projectRoot, 'src', t)];
        file = cands.find((c) => fs.existsSync(c)) || cands[0];
      }
    }
    steps.push({ node_id: n.id, func_name: funcName, file_path: file });
    infos.push({
      node_id: n.id,
      label: n.label || n.id,
      func_name: funcName,
      description: (n.description || '').slice(0, 200),
      is_judgement: false,
      is_cross: n.id.includes('__sx'),
    });
  }
  // CFG 判定节点（跨文件 CFG 的 branch/loop，__alg_）
  const judgeNodes = (dsl.geometry.nodes as Array<{ id: string; label?: string; description?: string }>)
    .filter((n) => n.id.includes('__alg_') && /branch|loop/.test(n.description || ''));
  for (const j of judgeNodes) {
    infos.push({
      node_id: j.id,
      label: j.label || j.id,
      func_name: (j.label || '').replace(/^▶\s*/, ''),
      description: (j.description || '').slice(0, 200),
      is_judgement: true,
      is_cross: false,
    });
  }
  return { steps, infos };
}

/** 定位宿主源文件绝对路径（project_root 先，回退 project_root/src），与 collectChainInfo 对齐 */
function locateHostSource(
  dsl: { semantic?: { files?: Array<{ id: string; path: string }> } },
  nodeId: string,
  projectRoot: string,
): string | null {
  const rel = dsl.semantic?.files?.find((f) => f.id === nodeId)?.path;
  if (!rel) return null;
  if (path.isAbsolute(rel)) return fs.existsSync(rel) ? rel : null;
  const atRoot = path.join(projectRoot, rel);
  if (fs.existsSync(atRoot)) return atRoot;
  const underSrc = path.join(projectRoot, 'src', rel);
  return fs.existsSync(underSrc) ? underSrc : null;
}

/** POST /api/trace-exec：数据流真实执行——从宿主节点构造链路步骤，喂用户输入真实运行链上函数 */
async function handleApiTraceExec(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { feature, node_id, input_value } = JSON.parse(body.toString('utf-8'));
    const dsl0 = getDSL(feature);
    if (!dsl0) {
      sendError(res, 404, `feature "${feature}" 不存在`);
      return;
    }
    if (!dsl0.geometry.nodes.some((n) => n.id === node_id)) {
      sendError(res, 404, `节点 "${node_id}" 不存在于 feature "${feature}"`);
      return;
    }
    const projectRoot = getServeProjectRoot();

    // 宿主无 detail 链时按需自动派生（TreeSitter 从源文件推导变形链），再重试真实执行；
    // 派生失败仅记录，走下方诚实降级——绝不伪造轨迹。
    let dsl = dsl0;
    let { steps, infos } = collectChainInfo(dsl, node_id, projectRoot);
    if (infos.length === 0) {
      const hostFile = locateHostSource(dsl, node_id, projectRoot);
      if (hostFile) {
        try {
          await deriveDetailChain({ feature, node_id, project_root: projectRoot, source_path: hostFile });
          const reload = getDSL(feature);
          if (reload) {
            dsl = reload;
            ({ steps, infos } = collectChainInfo(dsl, node_id, projectRoot));
          }
        } catch (e) {
          console.warn(`[trace-exec] 按需派生 detail 链失败 ${node_id}: ${(e as Error).message}`);
        }
      }
      if (infos.length === 0) {
        sendError(res, 400, '宿主节点下无 detail 链节点可真实执行（自动派生后仍无可推导的函数调用链，或源文件不可解析）');
        return;
      }
    }

    const result = await traceExecChain({ steps, input_value });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/chain-recon：中观档对账——一条命令真跑 + 查数据 + 对账（后工具自动前置 + 缓存跳过） */
async function handleApiReconcileChain(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { feature, node_id, project_dir, events_files, force, max_steps } = JSON.parse(body.toString('utf-8'));
    if (!feature || !node_id) {
      sendError(res, 400, '缺少参数：feature / node_id（指定宿主文件节点做中观档对账）');
      return;
    }
    const r = await reconcileChain({
      feature: String(feature),
      node_id: String(node_id),
      project_dir: String(project_dir ?? getServeProjectRoot()),
      events_files: Array.isArray(events_files) ? events_files : undefined,
      force: force === true || force === 'true' || force === '1',
      max_steps: typeof max_steps === 'number' ? max_steps : undefined,
    });
    sendJson(res, 200, { success: true, ...r });
  } catch (e) {
    sendError(res, 400, (e as Error).message);
  }
}

// ★★★ 2026-10-23（前端切割）：`/api/archify-demo` 与其整条 archify 管线**已删除**。
//   它是「把前端编辑 IR 树渲染成 5 类 showcase HTML」—— 前端只做只读显示屏的裁定下，这条不需要。

/** GET /api/function-outline?feature=<feature>[&project_dir=<root>]：函数级大纲
 *  （目录 → 文件 → 函数 + 调用/被调用/回环），数据源 = import_cache_<feature>.db 或
 *  <source_root>/.agent-io/cache.db。派生只读，不写回任何存储。 */
function handleApiFunctionOutline(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    const sourceRoot = (url.searchParams.get('project_dir') || '').trim() || undefined;
    if (!feature) {
      sendError(res, 400, '缺参数 "feature"（用于定位函数级缓存的 feature 名）');
      return;
    }
    const dir = (url.searchParams.get('dir') || '').trim() || undefined;
    if (!dir) {
      // 无 dir → 目录清单（懒加载首屏，轻量）
      const r = listFunctionDirs(feature, sourceRoot);
      sendJson(res, r.ok ? 200 : 404, r.ok ? { feature, dirs: r.dirs } : { error: r.note ?? '无函数级数据', dirs: [] });
      return;
    }
    // 有 dir → 仅该目录函数（真按目录懒加载，SQL 层过滤）
    const { ok, outline, note } = buildFunctionOutline(feature, sourceRoot, { dir });
    sendJson(res, ok ? 200 : 404, ok ? outline : { error: note ?? '无函数级数据', functions: [] });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/function-run：按函数级 id（缓存格式 `相对路径/文件名#Fn`）真实执行单个函数，返回 入/出/状态。
 *  供功能线点位单步运行用（traceExecChain 走一个 step）。feature 定位 source_root，把相对文件路径拼成绝对路径。 */
async function handleApiFunctionRun(req: http.IncomingMessage, res: http.ServerResponse, sourceRoot?: string): Promise<void> {
  try {
    const body = await readBody(req);
    const { feature, node_id, input_value } = JSON.parse(body.toString('utf-8'));
    if (!feature || !node_id) {
      sendError(res, 400, '缺参数 "feature" 或 "node_id"');
      return;
    }
    const hash = String(node_id).lastIndexOf('#');
    const fileRel = hash === -1 ? String(node_id) : String(node_id).slice(0, hash);
    const func = hash === -1 ? '' : String(node_id).slice(hash + 1);
    if (!func) {
      sendError(res, 400, `node_id 需形如 "相对路径/文件#函数名"，收到 "${node_id}"`);
      return;
    }
    // ★★ 2026-10-01 删兜底：没有 source_root ⇒ **不知道去哪个项目找** ⇒ 明确 400。
    //   绝不拿 cwd 冒充 —— cwd 与被分析项目无关，那样会在**另一个项目**里找同名的文件并找错。
    if (!sourceRoot) {
      sendError(res, 400, '缺 source_root：不知道在哪个项目里找这个函数（这里**故意不兜底到 cwd**）');
      return;
    }
    const filePath = path.join(sourceRoot, fileRel.replace(/\//g, path.sep));
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, `函数对应源文件不存在：${filePath}`);
      return;
    }
    const r = await traceExecChain({ steps: [{ node_id, func_name: func, file_path: filePath }], input_value: input_value ?? undefined });
    sendJson(res, 200, { feature, node_id, entryParams: r.entryParams, steps: r.steps });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/chain-exec：功能线整条链一次性真实执行。
 *  body: { feature, steps: [{ id, func, file }], input_value?, project_dir? }
 *  各 step 的 id 为函数级 id（相对路径#函数名）；file 为相对 feature 源码根的路径。
 *  用 feature/project_dir 定位源码根拼绝对路径，构造 TraceStepSpec[] 交给 traceExecChain
 *  整链串联执行——上一步出参自动作为下一步入参（不再依赖 detail 节点 id，修复沿链演示口径错配）。
 */
async function handleApiChainExec(req: http.IncomingMessage, res: http.ServerResponse, sourceRoot?: string): Promise<void> {
  try {
    const body = await readBody(req);
    const { feature, steps, input_value } = JSON.parse(body.toString('utf-8') || '{}');
    if (!feature) { sendError(res, 400, '缺参数 "feature"'); return; }
    if (!Array.isArray(steps) || steps.length === 0) { sendError(res, 400, '缺参数 "steps"（整条链的步骤数组）'); return; }
    const root = sourceRoot ?? getServeProjectRoot();
    const specs = steps.map((s: any) => {
      const id = String(s?.id ?? '');
      const rawFunc = s?.func;
      const rawFile = s?.file;
      const hash = id.lastIndexOf('#');
      const file = rawFile || (hash !== -1 ? id.slice(0, hash) : '');
      const func = rawFunc || (hash !== -1 ? id.slice(hash + 1) : '');
      if (!file || !func) throw new Error(`每个 step 需含 file+func 或 id 形如 "相对路径/文件#函数名"，收到 "${id}"`);
      const filePath = path.join(root, file.replace(/\//g, path.sep));
      if (!fs.existsSync(filePath)) throw new Error(`步骤源文件不存在：${filePath}`);
      return { node_id: id, func_name: func, file_path: filePath };
    });
    const r = await traceExecChain({ steps: specs, input_value: input_value ?? undefined });
    sendJson(res, 200, { success: true, feature, entryParams: r.entryParams, steps: r.steps });
  } catch (e) {
    sendError(res, 400, (e as Error).message);
  }
}

/** GET /api/function-example?feature=<f>&node_id=<相对路径/文件#Fn>&project_dir=<root>
 *  按函数签名生成示例入参（不执行）：让功能线点位"不用手工拼 JSON"，基础示例自动预填。 */
async function handleApiFunctionExample(req: http.IncomingMessage, res: http.ServerResponse, sourceRoot?: string): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const nodeId = (url.searchParams.get('node_id') || '').trim();
    const feature = (url.searchParams.get('feature') || '').trim();
    if (!nodeId) {
      sendError(res, 400, '缺参数 node_id');
      return;
    }
    const hash = nodeId.lastIndexOf('#');
    const fileRel = hash === -1 ? nodeId : nodeId.slice(0, hash);
    const func = hash === -1 ? '' : nodeId.slice(hash + 1);
    if (!func) {
      sendError(res, 400, `node_id 需形如 "相对路径/文件#函数名"`);
      return;
    }
    // ★★ 2026-10-01 删兜底：没有 source_root ⇒ **不知道去哪个项目找** ⇒ 明确 400。
    //   绝不拿 cwd 冒充 —— cwd 与被分析项目无关，那样会在**另一个项目**里找同名的文件并找错。
    if (!sourceRoot) {
      sendError(res, 400, '缺 source_root：不知道在哪个项目里找这个函数（这里**故意不兜底到 cwd**）');
      return;
    }
    const filePath = path.join(sourceRoot, fileRel.replace(/\//g, path.sep));
    if (!fs.existsSync(filePath)) {
      sendError(res, 404, `函数对应源文件不存在：${filePath}`);
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = await parseFileFull(filePath, content);
    const sym = parsed.symbols.find((s) => s.name === func && (s.kind === 'function' || s.kind === 'method'));
    if (!sym) {
      sendError(res, 404, `函数 "${func}" 不存在于 ${fileRel}`);
      return;
    }
    const lang = /\.go$/.test(fileRel) ? 'go' : /\.py$/.test(fileRel) ? 'py' : 'ts';
    const { example, params, preview } = exampleInputFor(sym.signature, lang, sym.params);
    sendJson(res, 200, { feature, node_id: nodeId, func_name: func, signature: sym.signature, lang, example, params, preview });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/feature-line?feature=<feature>[&project_dir=<root>][&target=<功能名>][&max_steps=<n>]
 *  功能线：target 缺省 → 全功能 入口+链长 总览；给 target → 该功能入口+主链。只读，不执行。 */
function handleApiFeatureLine(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    const sourceRoot = (url.searchParams.get('project_dir') || '').trim() || undefined;
    if (!feature) {
      sendError(res, 400, '缺参数 "feature"（用于定位函数级缓存的 feature 名）');
      return;
    }
    const target = (url.searchParams.get('target') || '').trim() || undefined;
    const maxSteps = Number(url.searchParams.get('max_steps')) || undefined;
    const r = getFeatureLine(feature, sourceRoot, { target, maxSteps });
    sendJson(res, r.ok ? 200 : 404, r.ok ? r : { error: r.note ?? '功能线不可用' });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/focus：LLM 从全链选关键节点（只选点不造值，数据真实性仍由 trace-exec 保证） */
async function handleApiFocus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const { feature, node_id, user_focus } = JSON.parse(body.toString('utf-8'));
    const dsl = getDSL(feature);
    if (!dsl) {
      sendError(res, 404, `feature "${feature}" 不存在`);
      return;
    }
    if (!dsl.geometry.nodes.some((n) => n.id === node_id)) {
      sendError(res, 404, `节点 "${node_id}" 不存在于 feature "${feature}"`);
      return;
    }
    const { infos } = collectChainInfo(dsl, node_id, process.cwd());
    if (infos.length === 0) {
      sendError(res, 400, '宿主节点下无 detail 链节点（先 derive_detail_chain）');
      return;
    }
    const cfg = loadLlmConfig();
    const result = await pickKeyNodes(cfg, infos, { max: 5, userFocus: user_focus });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

async function handleApiLayout(req: http.IncomingMessage, res: http.ServerResponse, layoutType: 'dag' | 'force' | 'grid'): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const feature = params.feature || 'agent-io';

    let result: Record<string, unknown> = {};
    switch (layoutType) {
      case 'dag':
        result = dagLayout({
          feature,
          direction: params.direction,
          h_gap: params.h_gap,
          v_gap: params.v_gap,
          width: params.width,
          respect_swimlanes: params.respect_swimlanes,
        });
        break;
      case 'force':
        result = forceLayout({
          feature,
          repulsion: params.repulsion,
          stiffness: params.stiffness,
          damping: params.damping,
          iterations: params.iterations,
          node_radius: params.node_radius,
          width: params.width,
          height: params.height,
        });
        break;
      case 'grid':
        result = gridAlign({
          feature,
          grid_size: params.grid_size,
        });
        break;
    }

    sendJson(res, 200, {
      success: true,
      ...result,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}


async function handleApiConsistency(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const result = await checkConsistencyReport({
      feature: params.feature || 'agent-io',
      code_dir: params.code_dir,
    });
    sendJson(res, 200, {
      success: true,
      ...result,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

async function handleApiDiffImpact(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const safeDir = validateProjectRoot(params.project_dir || process.cwd(), '/api/diff-impact project_dir');
    const result = diffImpact({
      feature: params.feature || 'agent-io',
      project_dir: safeDir,
      changed: Array.isArray(params.changed) ? params.changed : [],
      direction: params.direction,
      max_depth: params.max_depth,
    });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    const code =
      (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') || (e as Error).message.includes('不能为空') ? 403 : 500;
    sendError(res, code, (e as Error).message);
  }
}

/** POST /api/mind-map：生成 L3 思维导图（feature → 功能 → 社区 → 文件），返回查看器 HTML
 * body 支持 { feature, view?: 'structure'|'teach', gen_descriptions?, max_files_per_community? }：
 *   structure = 结构树（功能→社区→文件，开发者下钻用）
 *   teach     = 科普教学（功能 + 实现原理分镜 steps，小白用，供四层下钻导航）
 */
async function handleApiMindMap(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const feature = (params.feature || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const view = params.view === 'teach' ? 'teach' : 'structure';
    const result = await deriveMindMap({
      feature,
      view,
      gen_descriptions: params.gen_descriptions === true,
      max_files_per_community: typeof params.max_files_per_community === 'number' ? params.max_files_per_community : 20,
    });
    guard(res, '/api/mind-map', 'mind-map', { success: true, ...result, mind_map: result.mind_map });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/mind-map-teach?feature=：读取已生成的科普教学导图（teach 版 .teach.json），
 * 供前端四层下钻导航（功能 → 实现路径 steps → 涉及文件）消费。未生成则提示先 POST /api/mind-map（view=teach）。 */
function handleApiMindMapTeachGet(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const file = getMindMapFile(feature, 'teach');
    if (!fs.existsSync(file)) {
      sendError(res, 404, 'teach 导图未生成，请先 POST /api/mind-map（view=teach）或调用 derive_mind_map');
      return;
    }
    const mindMap = JSON.parse(fs.readFileSync(file, 'utf-8'));
    guard(res, '/api/mind-map-teach', 'mind-map-teach', { success: true, mind_map: mindMap });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/mind-map?feature=：读取已生成的结构骨架 JSON（中间数据） */
function handleApiMindMapGet(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const feature = (url.searchParams.get('feature') || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const file = getMindMapFile(feature);
    if (!fs.existsSync(file)) {
      sendError(res, 404, '思维导图未生成，请先 POST /api/mind-map 或调用 derive_mind_map');
      return;
    }
    const mindMap = JSON.parse(fs.readFileSync(file, 'utf-8'));
    guard(res, '/api/mind-map', 'mind-map', { success: true, mind_map: mindMap });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET/POST /api/overview：小白视图数据（摘要 + 功能树 + 上手步骤）
 * GET ?feature=X —— 快速读：摘要走缓存（无则规则兜底），不调 LLM，页面秒开
 * POST { feature, refresh?, refresh_llm?, first_steps? } —— refresh_llm=true 时
 * 调 LLM 升级摘要与导图描述并落缓存（慢，首次访问/用户主动刷新用） */
async function handleApiOverview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
): Promise<void> {
  try {
    let feature = '';
    let refresh = false;
    let refreshLlm = false;
    let firstSteps = 3;
    if (method === 'GET') {
      const url = new URL(req.url || '/', 'http://localhost');
      feature = (url.searchParams.get('feature') || '').trim();
    } else {
      const body = await readBody(req);
      const params = JSON.parse(body.toString('utf-8') || '{}');
      feature = String(params.feature || '').trim();
      refresh = params.refresh === true;
      refreshLlm = params.refresh_llm === true;
      if (typeof params.first_steps === 'number') firstSteps = params.first_steps;
    }
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const result = await getOverview({ feature, refresh, refresh_llm: refreshLlm, first_steps: firstSteps });
    guard(res, '/api/overview', 'overview', { success: true, ...result });
  } catch (e) {
    // 支持带语义错误码的异常（如 feature 不存在 → 404），其余默认 500
    const status = (e as Error & { status?: number }).status;
    sendError(res, status && status >= 400 && status < 600 ? status : 500, (e as Error).message);
  }
}

/** GET/POST /api/annotations：思维导图人工批注
 *  GET ?feature=X —— 返回该 feature 全部 annotations（前端只渲染 human 便签）
 *  POST {feature, notes:[{id,target_id,text,pos}]} —— 全量替换 human 注解
 *  （llm/系统注解保留不动）。
 *  ★★★ 2026-10-23：落点从 `DSL.annotations` 改为 `canvas_store`（`.agent-io/canvas/<f>.json`）——
 *  画布与设计 DSL 已切割（用户裁定：「我们本身是要和那个做切割的呀」）。行为（形状/过滤/截断）不变。 */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

/** GET/POST /api/user_nodes：思维导图上用户手写的节点（人机共笔的结构性扩展）
 *  GET ?feature=X —— 返回该 feature 全部 user_nodes
 *  POST {feature, nodes:[{id,parent_id,parent_label,text}]} —— 全量替换。
 *  ★★★ 2026-10-23：落点从 `DSL.user_nodes` 改为 `canvas_store`（`.agent-io/canvas/<f>.json`）。 */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

/** POST /api/opl：待改进闭环流水线（人加待改进→下探→设计DSL→改真实文件→真DSL比较→接入导图）
 *  op: add | locate | declare | implement | check | integrate | list | get */
async function handleApiOpl(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8') || '{}');
    const feature = String(params.feature || '').trim();
    const op = String(params.op || '').trim();
    const id = String(params.id || '').trim();
    if (!feature || !op) {
      sendError(res, 400, '缺少 feature 或 op 参数');
      return;
    }
    let result;
    switch (op) {
      case 'add':
        if (!String(params.idea || '').trim()) {
          sendError(res, 400, '缺少 idea 参数');
          return;
        }
        result = oplAdd(feature, String(params.idea || ''));
        break;
      case 'auto':
        // 一键自驱闭环：无 id 传 idea 自动 add，有 id 从现有状态续推
        result = await oplAuto(feature, id || undefined, String(params.idea || ''));
        break;
      case 'locate':
        result = await oplLocate(feature, id);
        break;
      case 'declare':
        result = oplDeclare(feature, id, { files: params.files });
        break;
      case 'implement':
        result = oplImplement(feature, id);
        break;
      case 'check':
        result = oplCheck(feature, id);
        break;
      case 'integrate':
        result = await oplIntegrate(feature, id);
        break;
      case 'list':
        result = oplList(feature);
        break;
      case 'get':
        result = oplGet(feature, id);
        break;
      default:
        sendError(res, 400, `不支持的操作：${op}`);
        return;
    }
    sendJson(res, 200, { success: true, result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/diff-views：设计视图 vs 实际代码快照 图级对比（最后一英里） */
async function handleApiDiffViews(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const feature = (params.feature || '').trim();
    if (!feature) {
      sendError(res, 400, '缺少 feature 参数');
      return;
    }
    const result = diffViews({ feature, live_dir: params.live_dir });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/feature-meta：单出口工作台所需的 feature 元数据（source_root → 代码审批定位；workbench 产物 → iframe 画布） */
async function handleApiFeatureMeta(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url!, 'http://localhost');
    const feature = url.searchParams.get('feature') || '';
    if (!feature) {
      sendError(res, 400, '缺少 feature');
      return;
    }
    const dsl = getDSL(feature);
    if (!dsl) {
      sendError(res, 404, `feature "${feature}" 不存在`);
      return;
    }
    let workbenchArtifact = '';
    try {
      const artifacts = readRegistry();
      const hit = artifacts
        .filter((a) => a.feature === feature && String(a.type ?? '').includes('feature') && a.path.endsWith('.html'))
        .sort((x, y) => String(y.updated_at ?? '').localeCompare(String(x.updated_at ?? '')))[0];
      if (hit) workbenchArtifact = '/' + hit.path.replace(/^\/+/, '');
    } catch {
      /* registry 不可读时忽略，画布降级为空 */
    }
    sendJson(res, 200, {
      success: true,
      feature,
      title: dsl.title || feature,
      source_root: dsl.source_root || '',
      workbench_artifact: workbenchArtifact,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/feature-dsl?feature=<name>：返回某 feature 的完整 DSL（前端 normalize → IR 的实时数据源） */
function handleApiFeatureDsl(req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const url = new URL(req.url!, 'http://localhost');
    const feature = url.searchParams.get('feature') || '';
    if (!feature) {
      sendError(res, 400, '缺少 feature');
      return;
    }
    const dsl = getDSL(feature);
    if (!dsl) {
      sendError(res, 404, `feature "${feature}" 不存在`);
      return;
    }
    sendJson(res, 200, dsl);
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/canvas-notes?feature=<name>：返回某 feature 的批注层数据
 *  ★ 2026-10-23：读 `canvas_store`（`.agent-io/canvas/<f>.json`），缺失返回空数组。 */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

/** POST /api/canvas-notes：写回某 feature 的批注层数据（只动 canvas_notes 字段，不动语义模型） */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

/** GET /api/canvas-notes/digest?feature=<name>：批注语义文档（Markdown 工单 + JSON），外部 agent 消费 */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

/** POST /api/canvas-notes/status：批量更新批注状态（body: { feature, updates:[{id,status}] }） */
// ★★★ 2026-10-23（和前端切割·第二步）：画布端点（annotations / user_nodes / canvas-notes）**已删除**。
//   用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。
//   ⇒ 这些是【人往回写】的入口，人不直接插手了，它们就没有存在的理由（不是改成只读，是退场）。

//   本仓既有先例正是 `code_workbench` 的 `/api/code/approve|reject`（LLM 起草 → **人**批准），
//   而 observe 的提案三态（propose / approve / reject）与它一一对应。
//   做成 MCP 工具会退化成"**agent 批准自己的提案**"，语义弱。
//   实测背景：`approveGated` 此前**全仓零调用方** ⇒ 提案永远停在 pending、声明进不了权威 DSL。
//
// ★★ 为「**第三方会话审批**」留位（用户 2026-10-06 指明方向：目标是 AI 自动化，
//   未来会增补第三方会话审批）：`reviewer` 是**自由文本且必填** —— 它记的就是
//   "哪个会话 / 哪个系统批的"（会话 id / 系统名 / 用户名皆可）。
//   `approveGated(…, reviewer)` 与 `Proposal.reviewer` 字段本就为此存在（Go 时代就有）。
//   ⇒ 将来接第三方（别的会话、IM、CI）只需按**同一 body** 调这两个 POST，**本层不必改**。
//
// ★ 状态码口径（与 `/api/code/*` 的"catch 全 500"**有意不同**，故在此写明）：
//   参数缺失 / 路径越界 ⇒ **400**（客户端参数错）；状态机冲突（提案非 pending / 不存在）⇒ **409**；
//   其余意外 ⇒ **500**。

/** GET /api/observe/proposals?project_dir=…：列出提案（含审批证据 `verified_by` / `verification`）。
 *  ★ 这个出口是**补回来的**：Go 时代由 `dsl_cli list/show` 打印这些证据（`已验证: …` /
 *    `验证门证据: …`），CLI 在 `e9a31a7` 删除后该出口断了 —— 而 daemon 的提示还指着一个
 *    从未注册过的 `reconcile_proposals`。 */
async function handleApiObserveProposals(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url!, 'http://localhost');
    const r = listObserveProposals(
      url.searchParams.get('project_dir') || '',
      '/api/observe/proposals project_dir',
    );
    if (!r.ok) {
      sendError(res, 400, r.message);
      return;
    }
    sendJson(res, 200, { success: true, project_dir: r.project_root, proposals: r.proposals });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/observe/proposals/approve {project_dir, id, reviewer, use_llm?}
 *  ⇒ 走 `approveGated` 四层门（L1 规则回归 / L2 decl 级 LLM 复核 / L3 覆盖校验 / L4 定稿）。
 *    ★ `use_llm` 缺省 false ⇒ 存在无谓词声明时**冻结**（不静默放行）—— 那是刻意的默认。 */
async function handleApiObserveApprove(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const r = await approveObserveProposal({
      project_dir: String(params.project_dir || ''),
      id: String(params.id || ''),
      reviewer: String(params.reviewer || '').trim(),
      use_llm: params.use_llm === true,
      context: '/api/observe/proposals/approve project_dir',
    });
    if (!r.ok) {
      sendError(res, r.code === 'bad_request' ? 400 : 409, r.message);
      return;
    }
    const { frozen, version, reason, proposal } = r.result;
    sendJson(res, 200, { success: !frozen, frozen, version, reason, proposal });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/observe/proposals/reject {project_dir, id, reviewer}
 *  ⇒ 仅 pending 可驳回；**权威 dsl.json 完全不动**。
 *  （与 `approveGated` 的"冻结"不同：冻结是**门**拒绝了提案，并留下机器可读的冻结原因。） */
async function handleApiObserveReject(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const r = rejectObserveProposal({
      project_dir: String(params.project_dir || ''),
      id: String(params.id || ''),
      reviewer: String(params.reviewer || '').trim(),
      context: '/api/observe/proposals/reject project_dir',
    });
    if (!r.ok) {
      sendError(res, r.code === 'bad_request' ? 400 : 409, r.message);
      return;
    }
    sendJson(res, 200, { success: true, proposal: r.proposal });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/semantic-search：全项目符号语义搜索（序号8） */
async function handleApiSemanticSearch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const safeDir = validateProjectRoot(params.project_dir || process.cwd(), '/api/semantic-search project_dir');
    const result = await semanticSearch({
      project_dir: safeDir,
      query: params.query || '',
      limit: params.limit,
      min_score: params.min_score,
    });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') ? 403 : 500, (e as Error).message);
  }
}

/** POST /api/arch-layer：架构分层分析（序号5+7） */
async function handleApiArchLayer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const result = await archLayer({
      feature: params.feature || 'agent-io',
      persist: params.persist,
      layers: params.layers,
      check_violations: params.check_violations,
      no_cache: params.no_cache === true,
    });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** POST /api/language-concepts：语言级编程模式识别（序号10） */
async function handleApiLanguageConcepts(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const safeDir = validateProjectRoot(params.project_dir || process.cwd(), '/api/language-concepts project_dir');
    const result = languageConcepts({
      project_dir: safeDir,
      concepts: params.concepts,
      files: params.files,
      limit: params.limit ?? 200,
    });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') ? 403 : 500, (e as Error).message);
  }
}

/** POST /api/guided-tour：Guided Tours 学习路径生成（序号6） */
async function handleApiGuidedTour(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const result = guidedTour({
      feature: params.feature || 'agent-io',
      include_deep: params.include_deep,
      include_containers: params.include_containers,
      max_steps: params.max_steps,
    });
    sendJson(res, 200, { success: true, ...result });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────
// 词典 API（路线图序号12：伪维基）
// ─────────────────────────────────────────────────────────────

/** POST /api/dict/query：查词典（含全局+项目合并、互链、高亮拆分） */
async function handleApiDictQuery(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const safeRoot = validateProjectRoot(params.project_dir || process.cwd(), '/api/dict/query project_dir');
    const view = buildDictionaryView(safeRoot);
    const term = params.term;
    let entry: DictEntry | null = null;
    if (term) entry = view.entries.find((e) => e.term === term) ?? null;
    sendJson(res, 200, {
      success: true,
      entries: view.entries,
      links: view.links,
      aliasesIndex: view.aliasesIndex,
      entry,
      global_file: getGlobalDictFile(),
      project_file: getProjectDictFile(safeRoot),
    });
  } catch (e) {
    const code =
      (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') || (e as Error).message.includes('不能为空') ? 403 : 500;
    sendError(res, code, (e as Error).message);
  }
}

/** POST /api/dict/highlight：对给定文本做高亮拆分（返回命中词条片段） */
async function handleApiDictHighlight(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const safeRoot = validateProjectRoot(params.project_dir || process.cwd(), '/api/dict/highlight project_dir');
    const view = buildDictionaryView(safeRoot);
    const text = params.text ?? '';
    const pieces = splitHighlights(text, view);
    sendJson(res, 200, { success: true, pieces });
  } catch (e) {
    const code =
      (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') || (e as Error).message.includes('不能为空') ? 403 : 500;
    sendError(res, code, (e as Error).message);
  }
}

/** POST /api/dict/ingest：LLM 分类 + 生成三档 + 注入词典（伪维基动态学习）
 *  传 dry_run=true 时仅预览（分类+生成，不落库），供前端审批弹窗预览后再确认收录。 */
async function handleApiDictIngest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const source = (params.term ?? '').trim();
    if (!source) {
      sendJson(res, 400, { success: false, message: '缺少 term 参数' });
      return;
    }
    const safeRoot = validateProjectRoot(params.project_dir || process.cwd(), '/api/dict/ingest project_dir');
    const projectHint = params.project_hint ?? '';
    const dryRun = params.dry_run === true;
    const result = await ingestTerm(source, safeRoot, projectHint, { save: !dryRun });
    sendJson(res, 200, { success: true, ...result, dry_run: dryRun });
  } catch (e) {
    const code =
      (e as Error).message.includes('超出允许范围') || (e as Error).message.includes('路径穿越') || (e as Error).message.includes('不能为空') ? 403 : 500;
    sendError(res, code, (e as Error).message);
  }
}

/** POST /api/dict/generate：仅生成不落库（预览用，前端可选） */
async function handleApiDictGenerate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8'));
    const term = (params.term ?? '').trim();
    if (!term) {
      sendJson(res, 400, { success: false, message: '缺少 term 参数' });
      return;
    }
    // ★ 出网入口：首次真正要用 key 时把 env 里的配置一次性导入网关（key 的家 = gateway；env 只是导入源）。
    ensureSeededFromEnv();
    if (!hasEnabledProvider()) {
      sendJson(res, 200, { success: false, message: '未配置 LLM（网关无可用供应商），无法生成' });
      return;
    }
    const gen = await generateDictEntry(term);    sendJson(res, 200, { success: true, ...gen });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/git-diff：取当前仓库未提交/未跟踪的改动文件清单（相对 process.cwd() 的 posix 路径） */
async function handleApiGitDiff(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { execFile } = await import('node:child_process');
  const cwd = process.cwd();
  // 跑 git 命令；失败（非仓库/无 git）→ 返回该组空清单
  const run = (args: string[]): Promise<{ ok: boolean; lines: string[] }> =>
    new Promise((resolve) => {
      execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve({ ok: false, lines: [] });
        resolve({ ok: true, lines: stdout.split('\n').map((s) => s.trim()).filter(Boolean) });
      });
    });
  try {
    const [unstaged, staged, untracked] = await Promise.all([
      run(['diff', '--name-only']),
      run(['diff', '--cached', '--name-only']),
      run(['ls-files', '--others', '--exclude-standard']),
    ]);
    const gitOk = unstaged.ok || staged.ok;
    const changed = [...new Set([...unstaged.lines, ...staged.lines, ...untracked.lines])].filter((f) => !f.endsWith('/'));
    sendJson(res, 200, {
      success: true,
      changed,
      base: cwd,
      git_ok: gitOk,
      message: gitOk
        ? `git 检出 ${changed.length} 个改动文件`
        : '当前目录不是 git 仓库或 git 不可用（改为手动填文件清单）',
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/** GET /api/registry：产物总览；POST /api/registry：人工打标记/编辑单条产物 */
async function handleApiRegistry(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method === 'GET') {
    sendJson(res, 200, { success: true, artifacts: readRegistry() });
    return;
  }
  try {
    const body = await readBody(req);
    const params = JSON.parse(body.toString('utf-8') || '{}');
    const relPath = String(params.path ?? '');
    const patch = (params.patch ?? {}) as Record<string, unknown>;
    if (!relPath) {
      sendError(res, 400, '缺少 path');
      return;
    }
    const clean: Record<string, unknown> = { ...patch };
    delete clean.path;
    const updated = updateArtifact(relPath, clean);
    if (!updated) {
      sendError(res, 404, `产物不在注册表: ${relPath}`);
      return;
    }
    sendJson(res, 200, { success: true, artifact: updated });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/**
 * 科普式讲解导览脚本（核心主链路）：按"双层DSL → 渲染器 → 自我分析星图 → 代码理解 →
 * 缓存 → 实时同步 → 语义搜索 → 导览"的顺序，逐模块讲解 agent-io 自身的工作机制。
 * 播放器（/explain.html）每步显示字幕条，并通过 postMessage 让星图定位高亮对应节点。
 */
/**
 * 角色：新人 / PM / 资深开发。同一模块三档讲解，详细度递增。
 *   - newbie：口语、少术语，讲"这是什么、用来干嘛"
 *   - pm：偏业务，讲"解决什么问题、价值在哪"
 *   - senior：偏技术，讲"内部怎么实现、关键 API / 机制"
 */
type Narrations = { newbie: string; pm: string; senior: string };

const EXPLAIN_SCRIPT: Array<{ title: string; n: Narrations; nodeId: string }> = [
  {
    title: '入口：MCP 服务',
    n: {
      newbie: 'agent-io 的"大门"是一个叫 MCP 服务的东西。它把画布的各种能力包装成一个个小工具，让 AI 助手（比如 Claude、Cursor）能直接调用。简单说：AI 想用画布，都得先通过这个入口。',
      pm: 'MCP 是当前 AI 编程工具的标准接口。我们把它做成标准 MCP 服务，意味着 Claude Code、Cursor、VS Code 等任何客户端都能无缝接入，不用为每个工具单独适配——这是"一次开发、处处可用"的关键投资。',
      senior: 'server.ts 实现标准 MCP stdio 传输，注册 40+ 工具（render_design / import_project / guided_tour 等），JSON-RPC 协议。工具集是画布能力的程序化暴露层，也是后续 MCP 收敛（路线图序号2）的改造主体。',
    },
    nodeId: 'file_server_ts',
  },
  {
    title: '协议核心：双层 DSL',
    n: {
      newbie: '所有设计都存在一个叫"双层 DSL"的结构里。它分两层：一层记录图形怎么摆（位置、大小、颜色），一层记录代码信息（哪些文件、哪些函数）。人和 AI 各改各的层，互不打扰。',
      pm: '双层 DSL 是"人机协作"的协议层：几何层给人看（拖拽改位置），语义层给 AI 读（代码分析自动填充）。两层通过 id 锚定对齐，避免人和 AI 同时改一个文件造成冲突。这是产品差异化的核心。',
      senior: 'DesignDSL 分 geometry（nodes/edges 位置样式）与 semantic（files/apis/dependencies），以 id 锚定。几何层由人编辑，语义层由 import_project 等自动填充。类型定义见 dsl/types.ts，校验由 dsl/validator.ts 保证锚定完整性。',
    },
    nodeId: 'file_dsl_types_ts',
  },
  {
    title: '几何层：人画的位置',
    n: {
      newbie: '你在图上看到的框、线、颜色，位置都记在这一层。你可以直接拖拽改位置，改完就存回这一层。',
      pm: '几何层保管"呈现"数据——每个节点拖到哪、多大、什么颜色。它让设计图可以被人肉眼直接操作，是"活图纸"体验的基础。修改自动回写持久化。',
      senior: 'geometry.nodes 记录 x/y/width/height/style，支持 layout 自动布局（dag/force/grid）与画布拖拽回写。渲染器据此定位节点，是本层唯一的"画布坐标真相源"。',
    },
    nodeId: 'file_dsl_geometry_ts',
  },
  {
    title: '语义层：LLM 理解的代码',
    n: {
      newbie: '这一层记的是代码信息：每个文件有哪些函数、依赖哪些文件、做完了没有。它是代码分析自动填的，你不用手动维护。',
      pm: '语义层把"代码讲了什么"结构化——文件、API、依赖、实现状态。它由分析工具自动生成，让 AI 能读懂设计图对应的真实代码，是"设计对得上实现"的保证。',
      senior: 'semantic.files 记录每个文件的 apis（ExpectedApi，含签名）、dependencies、status —— ★ 这些是**设计意图**，由 import_project（或人工 / LLM 编辑）填充；★ 实际签名等**事实不再镜像进 DSL**（原先的 scaffold(action=backfill) 能力已于 2026-10-01 随 T20 删除）：要事实请走 consistency_check（设计↔代码校验）或现取 fileFacts。status 驱动节点着色（待实现/实现中/已完成）。',
    },
    nodeId: 'file_dsl_semantic_ts',
  },
  {
    title: '校验器：守住 DSL 边界',
    n: {
      newbie: 'DSL 不是想怎么写就怎么写的。这个校验器会检查语法对不对、引用的编号对不对得上，防止错误数据混进来。',
      pm: '校验器相当于"质检关卡"——保证几何层和语义层引用的 id 都对得上、schema 合法。它把脏数据挡在门外，避免后续渲染和 AI 分析读到坏数据。',
      senior: 'validator.ts 校验 ①schema 字段合法性 ②锚定完整性（几何节点 id 与语义引用是否一一对应）。非法 DSL 在进入渲染/AI 分析前即被拦截，返回结构化错误。',
    },
    nodeId: 'file_dsl_validator_ts',
  },
  {
    title: '自我分析：把 src 变成星图',
    n: {
      newbie: '我们用这个工具分析它自己——把我们自己的代码文件夹扫描一遍，生成一张像星空一样的图，每个点代表一个文件。你现在看的就是这张图。',
      pm: '这是"吃自己的狗粮"：用工具分析自身代码库，把 68 个文件、660 个符号、100 条依赖关系可视化。既验证工具能力，又让新人一眼看懂项目结构——这是最好的产品演示。',
      senior: 'importProject 用 TreeSitterKernel 解析 src/ 全量文件，产出符号 + 依赖边 + 目录容器节点，渲染成项目地图。支持 max_files 截断（默认200）、缓存增量（content_hash）、删除侦测。',
    },
    nodeId: 'file_tools_import_project_ts',
  },
  {
    title: 'AST 内核：理解每种语言',
    n: {
      newbie: '要让 AI 读懂代码，得先有个工具能"看懂"代码的结构。这个内核就是干这个的：它把代码拆成一层层结构，找出函数、调用、依赖。',
      pm: 'AST 内核是"代码理解"的地基——它决定了工具能读懂哪些语言、读懂多深。基于 tree-sitter，动态加载语言包，是导入分析、一致性检查等能力的共同底座。',
      senior: 'ts_kernel 基于 tree-sitter，动态检测 node_modules/tree-sitter-* 语言包，无硬编码 import，支持 go/ts/py/js。提供符号、调用边、CFG 提取；优雅降级（缺语言包时解析失败不崩溃）。被 import_project/consistency/derive_* 共享。',
    },
    nodeId: 'file_tools_ts_kernel_kernel_ts',
  },
  {
    title: 'SQLite 缓存：只重算变更',
    n: {
      newbie: '代码改来改去，每次都重新分析全部太慢。这个缓存会记住分析过的结果，只有改过的文件才重新分析，快很多。',
      pm: '缓存是"效率"的关键——用 SQLite 存符号与调用边，配合文件 hash 增量，只重算变更文件。二次运行 68 个文件几乎全命中，分析从"分钟级"降到"秒级"，这是规模化使用的根基。',
      senior: 'db/ 用 node:sqlite（零原生依赖），schema v2：nodes/edges/files/imports + FTS5 trigram 索引。syncFile 按 content_hash 增量，未变更 skipped；pruneDeletedFiles 侦测删除。跨 feature 复用同一 AST 内核避免冗余。',
    },
    nodeId: 'file_db_db_ts',
  },
  {
    title: '实时同步：文件一改就更新',
    n: {
      newbie: '代码一保存，星图就能跟着变，不用手动重新生成。这个功能就是干这个的：一直盯着文件，变了就更新。',
      pm: '"永不 stale"是核心卖点：文件监听自动把代码变更同步进缓存，还能按 feature 重建"实际 DSL"。代码改了，设计图跟着走，人永远看到最新状态。',
      senior: 'watch_project 用 fs.watch 递归监听 + debounce 批量 flushBatch；SKIP_FILE_RE 过滤临时文件防反馈循环；reconcileProject 定期全量扫描兜底（目录级删除/事件丢失）；重建实际 DSL 到 live/（saveLiveFeature）。rebuild_window_ms 节流。',
    },
    nodeId: 'file_tools_watch_project_ts',
  },
  {
    title: '语义搜索：问自然语言',
    n: {
      newbie: '你可以直接打一句话问它，比如"哪个部分处理登录"，它就能在代码里找到相关的地方回答你。',
      pm: '语义搜索让"找代码"从翻目录变成提问——用 embedding 把符号向量化，支持自然语言查询。降低代码检索门槛，是产品易用性的重要一环。',
      senior: 'semantic_search 复用 cache.db 符号表，硅基流动 BAAI/bge-m3（1024维，OpenAI 兼容）向量化符号，query 余弦相似度 top-k；进程内向量缓存（model:sha256）实现向量化一次复用；未配置自动降级 FTS trigram。',
    },
    nodeId: 'file_tools_semantic_search_ts',
  },
  {
    title: '产物注册表',
    n: {
      newbie: '每次生成的网页（星图、报告、示例）都会被记到一个清单里，主页会根据这个清单展示所有成果。',
      pm: '注册表是"成果目录"——统一登记每次生成的产物，让主页动态展示、可人工打标。它让项目成果可检索、可组织，也是跨产物导览的数据基础。',
      senior: 'registry 把产物登记到 <dataHome>/output/.registry.json，render_design 自动注册 + 人工编辑（tags/note/title/status）。GET/POST /api/registry 暴露，Hub 首页据此动态渲染产物卡片。',
    },
    nodeId: 'file_tools_registry_ts',
  },
  {
    title: '导览：你正在用的功能',
    n: {
      newbie: '你现在看的这个"讲解"功能，就是它在起作用。它能把散落的模块按顺序连成一条学习路线，一步步带你熟悉。',
      pm: '导览把"理解项目"变成可消费的体验——按依赖顺序生成学习路径，逐个高亮。你正在用的科普式导览，就是它和注册表、播放器一起实现的。',
      senior: 'guided_tour 用 Kahn 拓扑排序（跳过 contains 边）生成学习路径；/api/explain 提供本讲解脚本，/explain.html 播放器 postMessage 驱动星图 flyToNode。G0/G1/G2 三档（单feature/串联/科普）已全落地。',
    },
    nodeId: 'file_tools_guided_tour_ts',
  },
];

/**
 * GET /api/explain?role=senior：返回科普式讲解导览脚本（核心主链路）。
 * `role` ∈ newbie | pm | senior，默认 newbie。每步返回 { title, narration, nodeId }，
 * 其中 narration 为对应角色讲解文案；同时返回本文档含全部角色（供播放器本地切换）。
 */
function handleApiExplain(req: http.IncomingMessage, res: http.ServerResponse): void {
  const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const role = (q.get('role') ?? 'newbie') as keyof Narrations;
  const validRole = role === 'senior' || role === 'pm' ? role : 'newbie';
  // 已持久化的 LLM 文案优先，覆盖手写文案；无则用内置 EXPLAIN_SCRIPT
  const persisted = loadGeneratedNarrations();
  const steps = EXPLAIN_SCRIPT.map((s) => {
    const n = persisted[s.title] ?? s.n;
    return {
      title: s.title,
      nodeId: s.nodeId,
      narration: n[validRole],
      // 附全部角色文案，播放器切换角色无需重新请求
      narrations: n,
    };
  });
  sendJson(res, 200, { success: true, role: validRole, steps, persisted: Object.keys(persisted).length });
}

/**
 * POST /api/explain/generate：用 Agnes LLM 为讲解模块生成三档角色文案。
 * body（可选）{ steps: [{ title, background }] }，缺省用内置 EXPLAIN_SCRIPT
 * （以现有 senior 文案作为权威背景）。逐模块调用 Agnes，返回可整体替换的
 * steps（含 narrations 三档），播放器据此刷新本地文案。
 * 未配置 / 调用失败：返回 { success:false, note }，播放器应回退手写文案。
 */
async function handleApiExplainGenerate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    // ★ 出网入口：首次真正要用 key 时把 env 里的配置一次性导入网关（key 的家 = gateway；env 只是导入源）。
    ensureSeededFromEnv();
    if (!hasEnabledProvider()) {
      sendJson(res, 200, {
        success: false,
        note: '未配置 LLM（网关无可用供应商），已保留手写文案',
      });
      return;
    }
    // 出网经网关：从网关供应商回读 model / 上游（供回执展示），本端不再自持配置
    const primary = listProvidersMasked()[0];

    let body: { steps?: Array<{ title?: string; background?: string }> } = {};
    const raw = await readBody(req);
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf-8'));
      } catch {
        body = {};
      }
    }
    const requested = Array.isArray(body.steps) ? body.steps : [];
    const modules = requested.length > 0
      ? requested.map((s) => ({ title: s.title || '', background: s.background || '' }))
      : EXPLAIN_SCRIPT.map((s) => ({ title: s.title, background: s.n.senior }));

    const generated: Array<{ title: string; nodeId: string; narrations: { newbie: string; pm: string; senior: string } }> = [];
    const failures: Array<{ title: string; error: string }> = [];
    for (const m of modules) {
      try {
        const narrations = await generateModuleNarrations(m.title, m.background);
        const src = requested.length > 0 ? EXPLAIN_SCRIPT.find((s) => s.title === m.title) : undefined;
        generated.push({
          title: m.title,
          nodeId: src?.nodeId ?? '',
          narrations,
        });
      } catch (e) {
        failures.push({ title: m.title, error: (e as Error).message });
      }
    }

    // 持久化：把本次成功生成的文案落盘，播放器下次打开自动加载，无需重新调用 LLM
    let persistedFile = '';
    if (generated.length > 0) {
      persistedFile = saveGeneratedNarrations(generated.map((g) => ({ title: g.title, narrations: g.narrations })));
    }

    sendJson(res, 200, {
      success: true,
      model: primary?.model ?? '',
      baseURL: primary?.base_url ?? '',
      generated,
      failures,
      persisted_file: persistedFile,
      note: failures.length > 0
        ? `${failures.length} 个模块生成失败（${failures[0]?.title}：${failures[0]?.error}），可重试或保留手写文案`
        : `已用网关供应商 ${primary?.id ?? ''} 生成 ${generated.length} 个模块的三档文案并持久化`,
    });
  } catch (e) {
    sendError(res, 500, (e as Error).message);
  }
}

/**
 * GET /api/tour?feature=X 或 ?features=A,B,C：返回产物导览序列。
 *   - feature=X：单 feature 的全部注册产物（按注册顺序）
 *   - features=A,B,C：跨 feature 串联——按给定顺序拼接各 feature 的产物（G1）
 *   - 可选 &tags=foo,bar：仅保留命中任一标签的产物
 * 返回 steps 数组，每步含 { path, title, type, feature, tags }。
 */
function handleApiTour(req: http.IncomingMessage, res: http.ServerResponse): void {
  const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const feature = q.get('feature') ?? '';
  const features = (q.get('features') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = (q.get('tags') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const all = readRegistry();
  const match = (e: { feature?: string; tags?: string[] }): boolean => {
    if (tags.length > 0 && !(e.tags ?? []).some((t) => tags.includes(t.toLowerCase()))) return false;
    return true;
  };

  // 跨 feature 串联：按 given 顺序逐 feature 拼接
  if (features.length > 0) {
    const steps: Array<{ path: string; title: string; type: string; feature: string; tags: string[] }> = [];
    for (const f of features) {
      for (const e of all) {
        if (e.feature !== f || !match(e)) continue;
        steps.push({ path: e.path, title: e.title || e.path, type: e.type || '', feature: e.feature || '', tags: e.tags ?? [] });
      }
    }
    sendJson(res, 200, { success: true, features, steps });
    return;
  }

  // 单 feature（兼容旧用法）
  const steps = all
    .filter((e) => e.feature === feature && match(e))
    .map((e) => ({ path: e.path, title: e.title || e.path, type: e.type || '', feature: e.feature || '', tags: e.tags ?? [] }));
  sendJson(res, 200, { success: true, feature, steps });
}

/** GET /tour.html：跨产物导览播放器（进度点 + iframe 嵌入当前产物 + 上一步/下一步） */
function handleTourPage(res: http.ServerResponse): void {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>导览播放器</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #02040d; color: #dbe7ff; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-bottom: 1px solid rgba(125,211,252,.15); background: rgba(6,11,31,.85); backdrop-filter: blur(8px); }
  .head a { color: #7dd3fc; text-decoration: none; font-size: 13px; padding: 5px 12px; border: 1px solid rgba(125,211,252,.2); border-radius: 8px; }
  .head a:hover { background: rgba(125,211,252,.1); }
  .head .ftitle { font-size: 15px; font-weight: 600; }
  .head .prog { margin-left: auto; font-size: 12px; opacity: .6; }
  .head .fchip { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: rgba(125,211,252,.12); border: 1px solid rgba(125,211,252,.2); color: #7dd3fc; }
  .stage { flex: 1; position: relative; }
  .stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  .nav { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 10px 18px; border-top: 1px solid rgba(125,211,252,.15); background: rgba(6,11,31,.85); }
  .nav-btn { background: rgba(125,211,252,.12); border: 1px solid rgba(125,211,252,.25); color: #7dd3fc; border-radius: 9px; padding: 8px 18px; font-size: 13px; cursor: pointer; }
  .nav-btn:hover:not(:disabled) { background: rgba(125,211,252,.2); }
  .nav-btn:disabled { opacity: .3; cursor: default; }
  .dots { display: flex; gap: 8px; align-items: center; }
  .dot { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(125,211,252,.4); background: transparent; cursor: pointer; padding: 0; }
  .dot.cur { background: #7dd3fc; box-shadow: 0 0 10px rgba(125,211,252,.8); }
  .loading { text-align: center; opacity: .6; padding-top: 40px; }
</style>
</head>
<body>
  <div class="head">
    <a href="/">← 主页</a>
    <span class="ftitle" id="ftitle"></span>
    <span class="fchip" id="fchip"></span>
    <span class="prog" id="prog"></span>
  </div>
  <div class="stage">
    <div class="loading" id="loading">加载产物序列…</div>
    <iframe id="frame" title="导览内容"></iframe>
  </div>
  <div class="nav">
    <button class="nav-btn" id="prev">◀ 上一步</button>
    <div class="dots" id="dots"></div>
    <button class="nav-btn" id="next">下一步 ▶</button>
  </div>
<script>
(function(){
  var qs = new URLSearchParams(location.search);
  var feature = qs.get('feature') || '';
  var featuresParam = qs.get('features') || '';
  var url = featuresParam
    ? '/api/tour?features=' + encodeURIComponent(featuresParam)
    : '/api/tour?feature=' + encodeURIComponent(feature);
  var steps = [], i = 0;
  var frame = document.getElementById('frame');
  var loading = document.getElementById('loading');
  var fchip = document.getElementById('fchip');
  function go(k){
    if(!steps.length) return;
    i = Math.max(0, Math.min(steps.length-1, k));
    loading.style.display = 'block';
    frame.style.opacity = '0.3';
    frame.src = steps[i].path;
    if(fchip) fchip.textContent = steps[i].feature ? 'feature: ' + steps[i].feature : '';
  }
  function update(){
    document.querySelectorAll('#dots .dot').forEach(function(b, k){ b.classList.toggle('cur', k === i); b.title = steps[k].title; });
    document.getElementById('prog').textContent = (steps.length ? (i+1) + ' / ' + steps.length : '0 / 0');
    document.getElementById('prev').disabled = i === 0;
    document.getElementById('next').disabled = i === steps.length-1;
  }
  fetch(url)
    .then(function(r){ return r.json(); })
    .then(function(j){
      steps = j.steps || [];
      document.getElementById('ftitle').textContent = featuresParam ? featuresParam.split(',').join(' → ') : (j.feature || '');
      var dots = document.getElementById('dots');
      dots.innerHTML = '';
      steps.forEach(function(_, k){
        var b = document.createElement('button');
        b.className = 'dot';
        b.onclick = function(){ go(k); };
        dots.appendChild(b);
      });
      if(!steps.length){ loading.textContent = '该产物序列暂无注册产物'; return; }
      go(0);
    })
    .catch(function(){ loading.textContent = '需要 npm run serve 启动服务'; });
  frame.addEventListener('load', function(){ loading.style.display = 'none'; frame.style.opacity = '1'; });
  document.getElementById('prev').addEventListener('click', function(){ go(i-1); });
  document.getElementById('next').addEventListener('click', function(){ go(i+1); });
  var t = setInterval(update, 150);
  window.addEventListener('beforeunload', function(){ clearInterval(t); });
})();
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * GET /explain.html：科普式讲解导览播放器。
 * 左侧嵌入项目地图（URL ?map= 指定，默认注册表最新地图），右侧字幕条逐模块讲解。
 * 每步通过 postMessage({ source:'dc-tour', action:'fly', nodeId }) 让星图定位高亮。
 */
function handleExplainPage(res: http.ServerResponse): void {
  // 嵌入哪张地图：URL ?map=xxx.html 优先，否则注册表里最新的 feature_diagram 产物
  const latestMap = readRegistry()
    .filter((a) => a.type === 'feature_diagram' && a.path.endsWith('.html'))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>科普式讲解导览 · agent-io</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #02040d; color: #dbe7ff; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 14px; padding: 10px 18px; border-bottom: 1px solid rgba(125,211,252,.15); background: rgba(6,11,31,.85); backdrop-filter: blur(8px); }
  .head a { color: #7dd3fc; text-decoration: none; font-size: 13px; padding: 5px 12px; border: 1px solid rgba(125,211,252,.2); border-radius: 8px; }
  .head a:hover { background: rgba(125,211,252,.1); }
  .head .ftitle { font-size: 15px; font-weight: 600; }
  .head .prog { margin-left: auto; font-size: 12px; opacity: .6; }
  .body { flex: 1; display: flex; min-height: 0; }
  .stage { flex: 1; position: relative; min-width: 0; }
  .stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  .side { width: 340px; min-width: 340px; border-left: 1px solid rgba(125,211,252,.15); background: rgba(6,11,31,.92); display: flex; flex-direction: column; }
  .caption { flex: 1; overflow-y: auto; padding: 18px; }
  .caption .c-title { font-size: 17px; font-weight: 700; color: #7dd3fc; margin-bottom: 10px; }
  .caption .c-body { font-size: 14px; line-height: 1.75; color: #dbe7ff; }
  .nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-top: 1px solid rgba(125,211,252,.15); }
  .nav-btn { background: rgba(125,211,252,.12); border: 1px solid rgba(125,211,252,.25); color: #7dd3fc; border-radius: 9px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
  .nav-btn:hover:not(:disabled) { background: rgba(125,211,252,.2); }
  .nav-btn:disabled { opacity: .3; cursor: default; }
  .dots { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(125,211,252,.4); background: transparent; cursor: pointer; padding: 0; }
  .dot.cur { background: #7dd3fc; box-shadow: 0 0 8px rgba(125,211,252,.8); }
  .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: #04060f; color: #7dd3fc; font-size: 14px; z-index: 5; }
  .hint { font-size: 11px; opacity: .5; padding: 0 16px 10px; }
  .persona { display: flex; gap: 6px; padding: 10px 16px; border-top: 1px solid rgba(125,211,252,.12); }
  .p-btn { flex: 1; background: rgba(125,211,252,.08); border: 1px solid rgba(125,211,252,.18); color: #a8c4e8; border-radius: 8px; padding: 6px 6px; font-size: 12px; cursor: pointer; text-align: center; }
  .p-btn:hover { background: rgba(125,211,252,.16); }
  .p-btn.cur { background: rgba(125,211,252,.22); color: #7dd3fc; border-color: rgba(125,211,252,.5); font-weight: 600; }
  .gen-row { padding: 0 16px; }
  .gen-btn { width: 100%; background: rgba(34,197,94,.1); border: 1px solid rgba(34,197,94,.25); color: #4ade80; border-radius: 8px; padding: 7px; font-size: 12px; cursor: pointer; }
  .gen-btn:hover:not(:disabled) { background: rgba(34,197,94,.18); }
  .gen-btn:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body data-map="${latestMap ? latestMap.path.replace(/"/g, '') : ''}">
  <div class="head">
    <a href="/">← 主页</a>
    <span class="ftitle">科普式讲解导览 · agent-io 主链路</span>
    <span class="prog" id="prog"></span>
  </div>
  <div class="body">
    <div class="stage">
      <div class="loading" id="loading">加载星图…</div>
      <iframe id="frame" title="星图"></iframe>
    </div>
    <div class="side">
      <div class="caption">
        <div class="c-title" id="c-title"></div>
        <div class="c-body" id="c-body"></div>
      </div>
      <div class="persona" id="persona">
        <button class="p-btn cur" data-role="newbie" title="口语讲解，适合第一次接触">👤 新人</button>
        <button class="p-btn" data-role="pm" title="偏业务价值，适合产品/管理">📊 PM</button>
        <button class="p-btn" data-role="senior" title="技术实现细节，适合资深开发">🔧 资深</button>
      </div>
      <div class="gen-row">
        <button class="gen-btn" id="genBtn" title="调用 LLM（DeepSeek/Agnes）为全部模块生成三档角色文案">✨ LLM 生成文案</button>
      </div>
      <div class="hint">字幕讲解 · 右侧星图自动定位高亮对应模块</div>
      <div class="nav">
        <button class="nav-btn" id="prev">◀ 上一步</button>
        <div class="dots" id="dots"></div>
        <button class="nav-btn" id="next">下一步 ▶</button>
      </div>
    </div>
  </div>
<script>
(function(){
  var steps = [], i = 0, role = 'newbie';
  var frame = document.getElementById('frame');
  var loading = document.getElementById('loading');
  var cTitle = document.getElementById('c-title');
  var cBody = document.getElementById('c-body');
  var STAR = new URLSearchParams(location.search).get('map') || document.body.getAttribute('data-map') || 'agent-io.html';
  function go(k){
    if(!steps.length) return;
    i = Math.max(0, Math.min(steps.length-1, k));
    render();
  }
  function render(){
    var s = steps[i];
    if(!s) return;
    cTitle.textContent = (i+1) + '. ' + s.title;
    // Persona-Adaptive：按当前角色取文案（narrations 各档齐全，本地切换零请求）
    cBody.textContent = (s.narrations && s.narrations[role]) || s.narration || '';
    // 星图已加载后，通过 postMessage 定位高亮对应模块
    if(frameReady && frame.contentWindow){
      frame.contentWindow.postMessage({ source:'dc-tour', action:'fly', nodeId:s.nodeId }, '*');
    }
    update();
  }
  function update(){
    document.querySelectorAll('#dots .dot').forEach(function(b, k){ b.classList.toggle('cur', k === i); });
    document.getElementById('prog').textContent = (steps.length ? (i+1) + ' / ' + steps.length : '0 / 0');
    document.getElementById('prev').disabled = i === 0;
    document.getElementById('next').disabled = i === steps.length-1;
  }
  // Persona 角色切换：更新高亮 + 重渲染当前步文案
  document.querySelectorAll('#persona .p-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      role = btn.getAttribute('data-role');
      document.querySelectorAll('#persona .p-btn').forEach(function(b){ b.classList.toggle('cur', b === btn); });
      if(steps.length) render();
    });
  });
  var frameReady = false;
  frame.addEventListener('load', function(){
    loading.style.display = 'none';
    frameReady = true;
    // 载入后定位当前步
    if(steps.length) render();
  });

  // ✨ LLM 生成文案：调用 /api/explain/generate，成功后整体替换本地 narrations
  var genBtn = document.getElementById('genBtn');
  genBtn.addEventListener('click', function(){
    genBtn.disabled = true;
    genBtn.textContent = '⏳ 生成中…（逐模块调用 LLM）';
    fetch('/api/explain/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(!j.success || !j.generated || !j.generated.length){
          genBtn.textContent = '⚠ ' + (j.note || '生成失败');
          return;
        }
        // 按 title 匹配，替换对应步骤的 narrations
        j.generated.forEach(function(g){
          for(var k=0; k<steps.length; k++){
            if(steps[k].title === g.title){
              steps[k].narrations = g.narrations;
              break;
            }
          }
        });
        genBtn.textContent = '✅ 已用 ' + j.model + ' 生成并持久化 ' + j.generated.length + ' 个模块';
        render();
      })
      .catch(function(e){
        genBtn.textContent = '⚠ 生成失败：' + (e && e.message ? e.message : '网络错误');
      })
      .finally(function(){ setTimeout(function(){ genBtn.disabled = false; }, 800); });
  });
  fetch('/api/explain')
    .then(function(r){ return r.json(); })
    .then(function(j){
      steps = j.steps || [];
      var dots = document.getElementById('dots');
      dots.innerHTML = '';
      steps.forEach(function(_, k){
        var b = document.createElement('button');
        b.className = 'dot';
        b.title = (k+1) + '. ' + steps[k].title;
        b.onclick = function(){ go(k); };
        dots.appendChild(b);
      });
      if(!steps.length){ loading.textContent = '暂无讲解脚本'; return; }
      // 已持久化的 LLM 文案：加载时提示，避免重复生成
      if(j.persisted > 0){
        genBtn.textContent = '📦 已加载 ' + j.persisted + ' 个模块的持久化文案';
      }
      // 先载入星图
      frame.src = STAR;
      render();
    })
    .catch(function(){ loading.textContent = '需要 npm run serve 启动服务'; });
  document.getElementById('prev').addEventListener('click', function(){ go(i-1); });
  document.getElementById('next').addEventListener('click', function(){ go(i+1); });
})();
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleStaticFile(req: http.IncomingMessage, res: http.ServerResponse): void {
  let filePath = req.url || '/';
  // 去除查询参数（如 ?t=v3）
  const qIdx = filePath.indexOf('?');
  if (qIdx !== -1) filePath = filePath.substring(0, qIdx);
  if (filePath === '/') {
    // 兜底：/ 路由已在主路由渲染 Hub 主页；走到这里说明非 GET，回退示例画布
    filePath = '/agent-io.html';
  }

  // 活态 DSL 别名：浏览器设计视图 fetch 相对路径 agent-io.json，
  // 静态目录（output/）不含它 → 映射到数据根目录的活态 DSL 文件，避免 404。
  if (filePath === '/agent-io.json') {
    if (fs.existsSync(LIVE_FILE)) {
      const content = fs.readFileSync(LIVE_FILE);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(content);
      return;
    }
    sendError(res, 404, 'agent-io.json 不存在，请先使用 render_design 或 import_project 创建');
    return;
  }

  const fullPath = path.join(PUBLIC_DIR, filePath);

  const relPath = path.relative(PUBLIC_DIR, fullPath);
  if (relPath.startsWith('..')) {
    sendError(res, 403, '路径不允许');
    return;
  }

  if (!fs.existsSync(fullPath)) {
    sendError(res, 404, `文件不存在: ${filePath}`);
    return;
  }

  if (fs.statSync(fullPath).isDirectory()) {
    sendError(res, 404, `目录不允许访问: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(fullPath);
  const mimeType = getMimeType(fullPath);
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(content);
}

const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB

function readBody(req: http.IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        reject(new Error(`请求体过大（${totalSize} 字节），最大允许 ${maxSize} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────
// 小网关 HTTP 接口（/api/gateway/* 设置页 + /v1/chat/completions 上层纳管）
// ─────────────────────────────────────────────────────────────

async function handleApiGateway(req: http.IncomingMessage, res: http.ServerResponse, method: string, url: string): Promise<void> {
  // GET /api/gateway/status —— 网关状态（前端悬浮窗首屏：是否有可用 LLM）
  if (url === '/api/gateway/status' || url.startsWith('/api/gateway/status?')) {
    if (method !== 'GET') { sendError(res, 405, '仅支持 GET'); return; }
    const providers = listProvidersMasked();
    sendJson(res, 200, { configured: providers.some((p) => p.enabled && p.key_count > 0), provider_count: providers.length, providers });
    return;
  }

  // GET /api/gateway/providers —— 供应商列表（key 脱敏）
  if (url === '/api/gateway/providers' || url.startsWith('/api/gateway/providers?')) {
    if (method === 'GET') {
      sendJson(res, 200, { providers: listProvidersMasked() });
      return;
    }
    if (method === 'DELETE') {
      const q = new URL(url, 'http://localhost');
      const id = q.searchParams.get('id') ?? '';
      const r = deleteProvider(id);
      if (!r.ok) { sendError(res, 400, r.error ?? '删除失败'); return; }
      sendJson(res, 200, { success: true, deleted: id, providers: listProvidersMasked() });
      return;
    }
    // POST 落到下方 upsert 分支
    if (method !== 'POST') { sendError(res, 405, '仅支持 GET/POST/DELETE'); return; }
  }

  // POST /api/gateway/providers —— upsert 供应商（注册/更新，keys 数组即 Key 池）
  if (url === '/api/gateway/providers' && method === 'POST') {
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8') || '{}');
    } catch {
      sendError(res, 400, 'JSON 解析失败');
      return;
    }
    const b = body as Record<string, unknown>;
    const r = upsertProvider({
      id: String(b.id ?? ''),
      name: typeof b.name === 'string' ? b.name : undefined,
      base_url: typeof b.base_url === 'string' ? b.base_url : undefined,
      model: typeof b.model === 'string' ? b.model : undefined,
      keys: Array.isArray(b.keys) ? b.keys.map(String) : undefined,
      weight: typeof b.weight === 'number' ? b.weight : undefined,
      price_prompt_per_1m: typeof b.price_prompt_per_1m === 'number' ? b.price_prompt_per_1m : undefined,
      price_completion_per_1m: typeof b.price_completion_per_1m === 'number' ? b.price_completion_per_1m : undefined,
      enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined,
    });
    if (!r.ok) { sendError(res, 400, r.error ?? '保存失败'); return; }
    sendJson(res, 200, { success: true, id: String(b.id), providers: listProvidersMasked() });
    return;
  }

  // POST /api/gateway/providers/test —— 连通性测试（ping 一条消息，不计入用量）
  if (url === '/api/gateway/providers/test' && method === 'POST') {
    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8') || '{}');
    } catch {
      sendError(res, 400, 'JSON 解析失败');
      return;
    }
    const id = String((body as Record<string, unknown>).id ?? '');
    if (!id) { sendError(res, 400, '缺少 id'); return; }
    const r = await testProvider(id);
    if (!r.ok) { sendJson(res, 200, r); return; }
    sendJson(res, 200, r);
    return;
  }

  // GET /api/gateway/stats —— 用量统计；POST /api/gateway/stats/reset —— 重置
  if (url.startsWith('/api/gateway/stats')) {
    if (url.includes('/reset')) {
      if (method !== 'POST') { sendError(res, 405, '仅支持 POST'); return; }
      resetStats();
      sendJson(res, 200, { success: true, stats: getStats() });
      return;
    }
    if (method !== 'GET') { sendError(res, 405, '仅支持 GET'); return; }
    sendJson(res, 200, { stats: getStats(), providers: listProvidersMasked() });
    return;
  }

  sendError(res, 404, `未知网关接口：${url}`);
}

/** POST /v1/chat/completions —— OpenAI 兼容端点，上层网关（如 AI base）可把我当 upstream 接入 */
async function handleOpenAICompat(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: OpenAICompatRequest;
  try {
    body = JSON.parse((await readBody(req)).toString('utf-8') || '{}') as OpenAICompatRequest;
  } catch {
    sendJson(res, 400, { error: { message: 'JSON 解析失败', type: 'invalid_request_error' } });
    return;
  }
  const r = await handleOpenAICompatRequest(body);
  sendJson(res, r.status, r.body);
}

// CORS：仅允许 localhost 系列源（含 IPv4/IPv6/hostname），阻止第三方网页通过浏览器跨域调用写入 API
// ★ 2026-10-22 从 `startServer` 内提到模块级：它是**无状态纯判据**，而路由表里的 SSE handler 也要用它
//   ⇒ 判据不该只在"某个函数的调用栈里"可见。
const safeOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/;
function isSafeOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // 非浏览器直接请求（curl/self）放行
  return safeOriginPattern.test(origin);
}

/**
 * ★★★ 2026-10-22：路由从 **65 条 `if (url.startsWith(...))` 链**改成**数据表**。
 *
 * ## 为什么改（不是"为了整齐"）
 * 改之前，路由的**存在性只写在控制流里** ⇒ 没有任何地方能回答"这个 server 有哪几条 API"：
 *   想知道就得读 379 行 if；想查"有没有重复注册同一个 path"只能靠人眼；
 *   想给前端一份路由清单更是没有出处。
 * ⇒ 现在路由是**数据**：能列出、能查重、能被下面 `assertRouteTable` 机器验。
 *
 * ## ★★ 改它的人必须知道的一条
 * `path` 是**前缀匹配**（`startsWith`），所以**表顺序就是语义**：
 * 若 A 是 B 的前缀且方法有交集，**A 在前就会吃掉 B**。
 * 实测（2026-10-22 全表扫描）：当前 65 条里**没有**这种抢匹配；仅 2 对互为前缀
 *   （`/api/mind-map` ⊂ `/api/mind-map-teach` · `/api/explain` ⊂ `/api/explain/generate`），
 *   两对都靠 `methods` 区分 ⇒ 安全。`assertRouteTable()` 会持续盯着这件事。
 */
interface RouteCtx {
  method: string;
  url: string;
  origin?: string;
}

interface HttpRoute {
  /** 前缀匹配（默认匹配方式） */
  path?: string;
  /** 给了它就用它、忽略 path —— 只有根路由需要（`u === '/' || u.startsWith('/?')` 不是纯前缀，写 `'/'` 会吃掉所有路径） */
  match?: (url: string) => boolean;
  /** 允许的方法；**空数组 = 不限** */
  methods: readonly string[];
  handler: (req: http.IncomingMessage, res: http.ServerResponse, ctx: RouteCtx) => void;
}

/**
 * ★ 表自检：重复注册 / 前缀抢匹配。**在 startServer 里真调一次**（不是只存在）。
 * 判据两条：
 *   ① 同一个 (path, method) 不许注册两次（后者永远不可达）；
 *   ② 若 A.path 是 B.path 的真前缀，且 A 与 B 的方法有交集（或任一方不限方法）⇒ A 会吃掉 B。
 */
function assertRouteTable(routes: readonly HttpRoute[]): void {
  const errors: string[] = [];
  for (let i = 0; i < routes.length; i++) {
    const A = routes[i];
    if (!A.path) continue; // match 型不参与前缀判断
    for (let j = i + 1; j < routes.length; j++) {
      const B = routes[j];
      if (!B.path) continue;
      const share = A.methods.length === 0 || B.methods.length === 0 || A.methods.some((m) => B.methods.includes(m));
      if (!share) continue;
      if (A.path === B.path) errors.push(`重复注册 ${A.path}（第 ${i + 1} 与第 ${j + 1} 条，后者不可达）`);
      else if (B.path.startsWith(A.path)) errors.push(`第 ${i + 1} 条 ${A.path} 是第 ${j + 1} 条 ${B.path} 的前缀 ⇒ 后者不可达`);
    }
  }
  if (errors.length) throw new Error('路由表自检失败：\n  ' + errors.join('\n  '));
}

/**
 * 把 `query` 里的**字符串**按 schema 还原成它期望的类型（boolean / number / 数组 / 对象）。
 *
 * ## 为什么必须有这一步
 * URL query 里一切都是字符串（`refresh=true` / `depth=3`），而 `TOOL_DEFS` 的 schema 期望
 * `boolean` / `number`。不还原的话，**每个工具都要在 HTTP 侧写一遍类型转换** = 又一处判据分叉。
 *
 * ## ★ 判据只有一处：zod（这里只做"能过就过"的尝试，不做判定）
 * `safeParse` 只用来**挑一个能过的候选**；转不动的原样交出去，让 `invokeTool` 里的
 * `validateToolArgs` 报错 —— 它的报文（"缺参数 x / 类型不对"）比这里权威，且 MCP/CLI 面读到的
 * 是同一句话。**本函数不产生任何"拒绝"**，只产生"候选值"。
 */
function coerceArgsFor(schema: ToolDef['inputSchema'], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const s = schema[k];
    if (!s || typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    if (s.safeParse(v).success) {
      out[k] = v;
      continue;
    }
    const candidates: unknown[] = [];
    if (v === 'true') candidates.push(true);
    if (v === 'false') candidates.push(false);
    if (v !== '' && !Number.isNaN(Number(v))) candidates.push(Number(v));
    const looksJson = (v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'));
    if (looksJson) {
      try {
        candidates.push(JSON.parse(v));
      } catch {
        // 不是合法 JSON ⇒ 不加入候选（不是错误：这个键本来就可能期望字符串）
      }
    }
    const hit = candidates.find((c) => s.safeParse(c).success);
    out[k] = hit === undefined ? v : hit;
  }
  return out;
}

/** 从 `invokeTool` 的 text 里取"人话"部分（`---DATA---` 之前），供 HTTP 回执的 `message` 用 */
function messageOf(text: string): string {
  const i = text.indexOf(DATA_MARKER);
  return (i < 0 ? text : text.slice(0, i)).trim();
}

/**
 * ★★★ `GET|POST /api/tool/<name>` —— **从 `TOOL_DEFS` 派生的通用出口**。
 *
 * ## 它解决的是什么（用户 2026-10-22 的原话）
 * 「HTTP 和 MCP 不可以直接是对 CLI 的调用吗？它们三处不是其实就是同一处吗？
 *   做一个注册器，你只要把 CLI 注册进去，自动衍生 MCP 和 HTTP」
 *
 * 实测的三处现状（2026-10-22）：
 *   · **MCP**：`registerAllTools` → `invokeTool`
 *   · **CLI**：`cli.ts` 头注自述"只是再投影一个面"→ 也走 `invokeTool`
 *   · **HTTP**：**65 条各自写 handler**，一处都没走 `invokeTool` ⇒ 只有它是第三个实现
 * ⇒ 本条路由把那半个洞补上：**能力注册一次，三个面各自只做适配**。
 *
 * ## 边界（它不做什么 —— 别把它当成"能替代 65 条"）
 * · 它只覆盖**工具面**（`TOOL_DEFS` 里的 66 个能力）。UI 专用出口（`/api/load` 整份 DSL、
 *   `/api/save`、静态文件、SSE、HTML 页面、`/api/layout/*` 这类画布几何）**本来就不是工具**，
 *   它们不在派生范围里，也不该为了"统一"硬塞进 `TOOL_DEFS`。
 * · 它**不**做参数白名单：schema 之外的键会被 `invokeTool` 的校验按它自己的口径处理
 *   （本函数不另立一套"多余参数"判据）。
 */
async function handleApiTool(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const rawUrl = req.url || '/';
  const name = decodeURIComponent(rawUrl.replace(/^\/api\/tool\//, '').split('?')[0] ?? '');
  const def = TOOL_DEFS.find((d) => d.name === name);
  if (!def) {
    sendError(
      res,
      404,
      `没有这个工具：${JSON.stringify(name)}。\n` +
        `★ 工具清单的唯一来源是 \`TOOL_DEFS\`（\`GET /api/tools\` 可列出，CLI \`--list\` 同一份）。`,
    );
    return;
  }

  const q = new URL(rawUrl, 'http://localhost');
  const args: Record<string, unknown> = {};
  for (const [k, v] of q.searchParams) args[k] = v;
  if (req.method === 'POST') {
    const text = (await readBody(req)).toString('utf-8').trim();
    if (text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        sendError(res, 400, '请求体不是合法 JSON');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendError(res, 400, '请求体需为 JSON 对象（工具入参是一张键值表）');
        return;
      }
      Object.assign(args, parsed);
    }
  }

  const r = await invokeTool(def, coerceArgsFor(def.inputSchema, args), 'http');
  sendJson(res, r.isError ? 400 : 200, { ok: !r.isError, tool: def.name, message: messageOf(r.text), data: parseDataBlock(r.text) });
}

/**
 * `GET /api/tools` —— **注册器的自我描述**：这一刻能调哪些能力、各自要什么参数。
 * ★ 与 `CLI --list`、MCP `tools/list` 同源（都是 `TOOL_DEFS`），所以三者永远不会漂。
 */
function handleApiTools(res: http.ServerResponse): void {
  sendJson(res, 200, {
    success: true,
    count: TOOL_DEFS.length,
    tools: TOOL_DEFS.map((d) => ({
      name: d.name,
      title: d.title,
      description: d.description,
      args: Object.keys(d.inputSchema),
      call: { get: `/api/tool/${d.name}`, post: `/api/tool/${d.name}` },
    })),
  });
}

/** 65 条路由。★ **顺序即语义**（见上面 HttpRoute 头注）—— 增删请按原 if 链位置插入，别排序。 */
const ROUTES: readonly HttpRoute[] = [
  // ★★ 派生路由（2026-10-22）：**能力注册一次，HTTP 自动获得** —— 与 MCP(`registerAllTools`) / CLI(`cli.ts`)
  //    同一个入口 `invokeTool`。放在表首：它们的前缀（`/api/tool/`、`/api/tools`）不与任何既有路由重叠，
  //    且 `assertRouteTable` 会持续盯着这一点。
  { path: '/api/tools', methods: ['GET'], handler: (req, res) => handleApiTools(res) },
  { path: '/api/tool/', methods: ['GET', 'POST'], handler: (req, res) => void handleApiTool(req, res) },
  // L2856  ★ INLINE
  { path: '/api/events', methods: ['GET'], handler: (req, res, ctx) => {
      // SSE 端点：保持连接，推送 DSL 变更事件
      const sseOrigin = isSafeOrigin(ctx.origin) ? (ctx.origin ?? '*') : 'null';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': sseOrigin,
      });
      res.write('event: connected\ndata: {"message":"SSE connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => { sseClients.delete(res); });
      return;
    } },
  // L2871
  { path: '/api/save', methods: ['POST'], handler: handleApiSave },
  // L2876
  { path: '/api/load', methods: ['GET'], handler: handleApiLoad },
  // L2881
  { path: '/api/features', methods: ['GET'], handler: handleApiFeatures },
  // L2906
  { path: '/api/live', methods: ['GET'], handler: handleApiLive },
  // L2911
  { path: '/api/split_plan', methods: ['POST'], handler: handleApiSplitPlan },
  // L2921
  { path: '/api/reveal-file', methods: ['POST'], handler: handleApiRevealFile },
  // L2926
  { path: '/api/layout/dag', methods: ['POST'], handler: (req, res) => handleApiLayout(req, res, 'dag') },
  // L2931
  { path: '/api/layout/force', methods: ['POST'], handler: (req, res) => handleApiLayout(req, res, 'force') },
  // L2936
  { path: '/api/layout/grid', methods: ['POST'], handler: (req, res) => handleApiLayout(req, res, 'grid') },
  // L2961  ★ INLINE
  { path: '/api/proposals', methods: ['POST'], handler: (req, res, ctx) => {
      void (async () => {
        try {
          const body = await readBody(req);
          const params = JSON.parse(body.toString('utf-8') || '{}');
          const feature = String(params.feature || '').trim();
          if (!feature) {
            sendError(res, 400, '缺少 feature 参数');
            return;
          }
          const result = await placeProposals(feature);
          sendJson(res, 200, { success: true, ...result });
        } catch (e) {
          sendError(res, 500, (e as Error).message);
        }
      })();
      return;
    } },
  // L2981  ★ INLINE
  { path: '/api/pipeline-like', methods: ['POST'], handler: (req, res, ctx) => {
      void (async () => {
        try {
          const body = await readBody(req);
          const params = JSON.parse(body.toString('utf-8') || '{}');
          const feature = String(params.feature || '').trim();
          const label = String(params.label || '').trim();
          if (!feature || !label) {
            sendError(res, 400, '缺少 feature 或 label 参数');
            return;
          }
          if (typeof params.like !== 'boolean') {
            sendError(res, 400, 'like 必须是布尔量（是/否产线视图）');
            return;
          }
          const file = getMindMapFile(feature, 'teach');
          if (!fs.existsSync(file)) {
            sendError(res, 404, 'teach 导图未生成，请先调用 derive_mind_map 生成科普分镜');
            return;
          }
          const mindMap = JSON.parse(fs.readFileSync(file, 'utf-8')) as MindMap;
          mindMap.pipeline_like = mindMap.pipeline_like ?? {};
          mindMap.pipeline_like[label] = params.like;
          fs.writeFileSync(file, JSON.stringify(mindMap, null, 2), 'utf-8');
          sendJson(res, 200, { success: true, like: params.like, pipeline_like: mindMap.pipeline_like });
        } catch (e) {
          sendError(res, 500, (e as Error).message);
        }
      })();
      return;
    } },
  // L3013
  { path: '/api/overview', methods: ['GET', 'POST'], handler: (req, res, ctx) => handleApiOverview(req, res, ctx.method) },
  // L3018
  // L3022
  // L3026
  { path: '/api/opl', methods: ['POST'], handler: handleApiOpl },
  // L3031
  { path: '/api/mind-map-teach', methods: ['GET'], handler: handleApiMindMapTeachGet },
  // L3051
  { path: '/api/semantic-search', methods: ['POST'], handler: handleApiSemanticSearch },
  // L3056
  { path: '/api/language-concepts', methods: ['POST'], handler: handleApiLanguageConcepts },
  // L3061
  { path: '/api/git-diff', methods: ['GET'], handler: handleApiGitDiff },
  // L3066
  { path: '/api/dict/query', methods: ['POST'], handler: handleApiDictQuery },
  // L3070
  { path: '/api/dict/highlight', methods: ['POST'], handler: handleApiDictHighlight },
  // L3074
  { path: '/api/dict/ingest', methods: ['POST'], handler: handleApiDictIngest },
  // L3078
  { path: '/api/dict/generate', methods: ['POST'], handler: handleApiDictGenerate },
  // L3083
  { path: '/api/registry', methods: [], handler: handleApiRegistry },
  // L3088
  { path: '/api/tour', methods: ['GET'], handler: handleApiTour },
  // L3093
  { path: '/api/explain', methods: ['GET'], handler: handleApiExplain },
  // L3098
  { path: '/api/explain/generate', methods: ['POST'], handler: handleApiExplainGenerate },
  // L3103
  { path: '/api/feature-dsl', methods: ['GET'], handler: handleApiFeatureDsl },
  // L3128
  { path: '/api/feature-meta', methods: ['GET'], handler: handleApiFeatureMeta },
  // L3171
  { path: '/api/gateway', methods: [], handler: (req, res, ctx) => handleApiGateway(req, res, ctx.method, ctx.url) },
  // L3177
  { path: '/v1/chat/completions', methods: ['POST'], handler: handleOpenAICompat },
  // L3184  ★ INLINE
  { match: (u: string) => u === '/' || u.startsWith('/?'), methods: [], handler: (req, res, ctx) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, frontend: 'dsl-workbench', note: '本 serve 仅提供数据/API；旧自包含前端已移除' }));
      return;
    } },
  // L3190
  { path: '/api/trace-exec', methods: ['POST'], handler: handleApiTraceExec },
  // L3200
  { path: '/api/focus', methods: ['POST'], handler: handleApiFocus },
  // L3205
  // L3210
  { path: '/api/function-outline', methods: ['GET'], handler: handleApiFunctionOutline },
  // L3218  ★ INLINE
  { path: '/api/function-run', methods: ['POST'], handler: (req, res, ctx) => {
      const q = new URL(req.url || '/', 'http://localhost');
      const proot = (q.searchParams.get('project_dir') || '').trim() || undefined;
      void handleApiFunctionRun(req, res, proot);
      return;
    } },
  // L3224  ★ INLINE
  { path: '/api/chain-exec', methods: ['POST'], handler: (req, res, ctx) => {
      const q = new URL(req.url || '/', 'http://localhost');
      const proot = (q.searchParams.get('project_dir') || '').trim() || undefined;
      void handleApiChainExec(req, res, proot);
      return;
    } },
  // L3230  ★ INLINE
  { path: '/api/function-example', methods: ['GET'], handler: (req, res, ctx) => {
      const q = new URL(req.url || '/', 'http://localhost');
      const proot = (q.searchParams.get('project_dir') || '').trim() || undefined;
      void handleApiFunctionExample(req, res, proot);
      return;
    } },
];

export async function startServer(port?: number): Promise<void> {
  // ★ 路由表自检必须在**起服务之前**跑（不是"存在即可"）：
  //   重复注册 / 前缀抢匹配都是"某条路由永远不可达"，而那在运行期表现为**静默 404**
  //   —— 不报错的错。放在这里 = 表一错就起不来。
  assertRouteTable(ROUTES);
  const listenPort = port || PORT;

  // Observe 运行哨兵：设置 OBSERVE_EVENTS_FILE 时激活全局探针 sink，
  // 运行中自动采集数据流事件（saveDSL 写盘等）。每条事件落盘后立即用轻量
  // 判定器判断，命中契约偏差就 SSE 推送给画布（开发时即时观测提示）。
  // 未设置时 no-op，不改变 serve 行为。
  enableObserveFromEnv((ev) => {
    // 长时压测守门：OBSERVE_GUARD=1 时把偏差实时打印到控制台（仅打印，不中断）
    judgeGuardLog(ev);
    const v = judgeEvent(ev);
    if (v.result === 'deviation') {
      broadcastSSE('observe-alert', {
        probe: v.probe,
        rule: v.rule,
        reason: v.reason,
        fields: v.fields,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 注册 DSL 变更回调：MCP saveDSL → SSE 广播
  onDslChange((feature, source) => {
    notifyDslChange(feature, source);
  });

  // ★★★ 2026-10-23：画布变更回调 —— 画布不再走 saveDSL，所以上面那条广播**接不到它**。
  //   不接这一条 ⇒ 浏览器改完批注后其他窗口不会刷新（静默的“看着没坏”）。
  //   事件名单独一个：前端据此只重取画布三格，不用重拉整册 DSL。

  // 安全：默认仅绑定本机回环，避免局域网/公网暴露；如需跨机访问，显式设 AGENT_IO_BIND=0.0.0.0
  const bindHost = process.env.AGENT_IO_BIND || '127.0.0.1';
  // ★ 2026-10-22：CORS 判据（`safeOriginPattern` / `isSafeOrigin`）已提到模块级 ——
  //   它是**无状态纯判据**，而路由表（`ROUTES`）里的 SSE handler 也要用它 ⇒ 不能只在 startServer 里可见。

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';
    const origin = req.headers.origin as string | undefined;

    if (isSafeOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (method === 'OPTIONS') {
      res.writeHead(isSafeOrigin(origin) ? 200 : 403);
      res.end();
      return;
    }
    // 写入类 API 严格校验 Origin，防止 CSRF/CORS 组合攻击
    const isWriteApi =
      method === 'POST' &&
      (url.startsWith('/api/save') || url.startsWith('/api/dict/ingest') ||
        url.startsWith('/api/registry') || url.startsWith('/api/import') ||
        url.startsWith('/api/layout') || url.startsWith('/api/scaffold') ||
        url.startsWith('/api/mind-map') || url.startsWith('/api/canvas-notes') ||
        url.startsWith('/api/gateway') ||
        // ★ observe 提案审批/驳回会**写权威 dsl.json**（或改提案状态）⇒ 必须同受 Origin 校验（T62）
        url.startsWith('/api/observe/proposals/approve') || url.startsWith('/api/observe/proposals/reject') ||
        url.startsWith('/api/reveal-file'));
    if (isWriteApi && !isSafeOrigin(origin)) {
      sendError(res, 403, '跨域写入被拒绝：仅允许本机 localhost 来源调用写入 API');
      return;
    }

    // ── 分发：表顺序即优先级，首个命中即用（原 65 条 if 链已表化，见 ROUTES）────────
    const hit = ROUTES.find(
      (r) =>
        (r.match ? r.match(url) : url.startsWith(r.path as string)) &&
        (r.methods.length === 0 || r.methods.includes(method)),
    );
    if (hit) {
      void hit.handler(req, res, { method, url, origin });
      return;
    }

    handleStaticFile(req, res);
  });

  return new Promise((resolve) => {
    server.listen(listenPort, bindHost, () => {
      const bound = bindHost === '0.0.0.0' ? `（已绑定 0.0.0.0，局域网可访问）` : `（仅本机 ${bindHost}）`;
      console.log(`agent-io serve running at http://localhost:${listenPort} ${bound}`);
      console.log(`  - 静态文件: ${PUBLIC_DIR}`);
      console.log(`  - API: POST /api/save, GET /api/load, GET /api/features`);
      console.log(`  - 布局 API: POST /api/layout/dag, POST /api/layout/force, POST /api/layout/grid`);
      console.log(`  - 代码生成 API: POST /api/scaffold`);
      console.log(`  - 一致性检查 API: POST /api/consistency`);
      console.log(`  - 数据/API 引擎（前端统一为 dsl-workbench，不再渲染自包含 HTML）`);
      console.log(
        `    - Observe 提案 API: 列出 GET /api/observe/proposals?project_dir=… ｜ 通过 POST /api/observe/proposals/approve ｜ 驳回 POST /api/observe/proposals/reject` +
          `（body 需 project_dir / id / reviewer —— reviewer 是审批者身份，为第三方会话审批留位）`,
      );
      console.log(`    - feature 元数据 API: GET /api/feature-meta`);
      console.log(`  - 变更影响分析 API: POST /api/diff-impact`);
      console.log(`  - 巨石体检/拆分任务单 API: POST /api/monolith, POST /api/split_plan`);
      console.log(`  - 架构分层分析 API: POST /api/arch-layer`);
      console.log(`  - 导览路径 API: POST /api/guided-tour`);
      console.log(`  - 语言概念 API: POST /api/language-concepts`);
      console.log(`  - git 改动清单 API: GET /api/git-diff`);
      console.log(`  - 产物注册表 API: GET/POST /api/registry`);
      console.log(`  - 项目导入 API: POST /api/import（浏览器目录上传）`);
      console.log(`  - SSE 实时推送: GET /api/events`);
      console.log(`  - 前端出口：**本 serve 无页面**（旧自包含前端 /workbench 已撤）—— 前端在独立仓库 dsl-workbench，` +
        `指向本 serve 的 http://localhost:${listenPort} 取数`);

      // 常驻 watch（最后一英里实时推送）：AGENT_IO_AUTO_WATCH=1 + AGENT_IO_WATCH_FEATURE=X 时，
      // 监听 cwd 代码变更 → 重建实际 DSL（live/）→ SSE 推送 dsl-changed(source=watch)，
      // 打开的画布自动刷新并重新跑 /api/diff-views 图级高亮（含边级结构塌方）。
      if (process.env.AGENT_IO_AUTO_WATCH === '1' && process.env.AGENT_IO_WATCH_FEATURE) {
        const autoFeature = process.env.AGENT_IO_WATCH_FEATURE.trim();
        try {
          const projectRoot = getServeProjectRoot();
          const db = getProjectCacheDb(projectRoot);
          let throttle: ReturnType<typeof createRebuildThrottler>;
          throttle = createRebuildThrottler({
            windowMs: 2000,
            run: async () => {
              await importProject({ project_dir: projectRoot, feature: autoFeature, cache_db: db, live_only: true });
              broadcastSSE('dsl-changed', { feature: autoFeature, source: 'watch', timestamp: new Date().toISOString() });
            },
          });
          watchProject({
            project_root: projectRoot,
            db,
            debounce_ms: 150,
            onChange: () => throttle.trigger(),
            onError: (err) => console.warn('[watch]', err.message),
          });
          console.log(`  - 常驻 watch 已启动: 代码变更 → 重建 ${autoFeature} → SSE 推送 diff 高亮`);
        } catch (e) {
          console.warn('[watch] 启动失败:', (e as Error).message);
        }
      }

      resolve();
    });
  });
}

import { pathToFileURL } from 'node:url';

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  startServer().catch((e) => {
    console.error('Server error:', e);
    process.exit(1);
  });
}
