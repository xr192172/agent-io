/**
 * meta 线（11 个工具）—— ★ **本文件即该线归属的唯一来源**。
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
import type { DiagnoseInput } from '../../infrastructure/analysis/diagnosis/contract.js';
import { formatDiagnoseText, runDiagnosis } from '../../infrastructure/analysis/diagnosis/diagnose.js';
import { getDSL, saveDSL } from '../../infrastructure/storage.js';
import { readStructureConfig } from '../../infrastructure/analysis/structure/structure_gap.js';
import { archiveNode, listArchive } from './archive/archive_node.js';
// ★ T15 切片（2026-10-06）：版本升级契约差（检测 + 局部重写闭环）—— 核心与两个 CLI 同源，
//   现归位到 `meta/upgrade/upgrade.ts`（见本文件头注）。
import { upgradeHandler } from './upgrade/upgrade.js';
import {
  bindDomains,
  LANE_IDS,
  listToolDefs,
  makeCapabilityMapHandler,
  catalogOf,
  resetDomainsForTest,
} from './registry/capability_map.js';
import type { DomainNavView, LaneId } from './registry/capability_map.js';
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
import { markCanvasNotesStatus, renderCanvasNotesDigest, resolveCanvasNoteTargets } from './view/derive_mind_map.js';
import { EXPLORE_ACTIONS } from './explore/explore_code.js';
import { deleteProvider, getStats, listProvidersMasked, resetStats, upsertProvider } from '../../infrastructure/llm_gateway.js';
import { indexIntegrity, renderIntegrity } from './integrity/index_integrity.js';
import { decideCanvasNotes } from './llm/llm_decider.js';
import { buildDocsPromptBlock, listProjectDocs, matchDocsForTargets, readProjectDoc } from './docs/project_docs.js';
import type { DocTargetSet } from './docs/project_docs.js';
import { exploreCodeHandler, syncContractsHandler } from './handlers.js';
import type { ToolDef } from '../types.js';
// ★ T54：接续段的三件套 —— **规则住在 domain，这里只渲染**（别在本文件重推一遍）
import { nextHopsOf, universalHopsOf, applyChainEdge, SCOPE_PATHS } from '../../domain/chain_wiring.js';


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
      '语义搜索/读取/影响分析/架构分层/导览/巨石分析/拆分/变形链/动画流/算法/注入回放/仿真/文件监听。' +
      'args 为各 action 的具体参数。' +
      '★ 按需选用与必填项（缺任一项即报错，别空调）：' +
      '巨石体检用 check_monolith（给 project_dir|feature|files 之一）；' +
      '看单函数内部流程用 derive_algorithm（给 feature+node_id+function）；' +
      '看函数间调用链用 derive_chain（给 feature+node_id）；' +
      '拆文件用 derive_split（给 project_dir+target_file+symbols；dry_run 默认 true 只出草稿、false 才落盘）；' +
      '读文件内容用 read（硬必填 file）；' +
      '盯文件变更用 watch（硬必填 project_dir）；' +
      '看模块导览用 guided_tour（硬必填 feature）；' +
      '生成模块思维导图用 derive_mind_map（硬必填 feature）；' +
      '跑事件仿真用 run_simulation（硬必填 feature）；' +
      '复位仿真用 reset_simulation（硬必填 feature）；' +
      '注入回放用 inject_replay（硬必填 feature+flow_id）；' +
      '看动画流用 derive_anim_flow（硬必填 feature+node_id）。' +
      'read 是 edit_code 的"先读后改"前置：按符号定位（symbol，+parent 消歧，+context 附带上下文）' +
      '或行区间（start/end，1-based 含端点）读文件，返回带真实行号的内容；' +
      '返回的 start/end/行号与 edit_code(op=range) 同基准（line_utils.splitKeepEnds 下标+1=行号），' +
      '可直接把 read 的行号喂给 edit_code，杜绝行号漂移改错行。' +
      'read 默认在 data.symbols 附整文件符号索引（name/kind/行号/签名，message 末尾附可读符号表，上限30截断），' +
      '一次 read 同时拿到正文+文件地图，symbols:false 可关。' +
      'search 三层路由：标识符查询（如 normalizeCode / Calc.reset）→ 精确符号索引（provider=exact，零向量开销）；' +
      '自然语言意图 → 语义向量相似度；无 embedding 配置/失败 → FTS trigram 降级。' +
      'search 必填 args.project_dir（目标项目根目录，缺省报错）+ args.query（空则返回『查询为空』提示），可选 top_k；' +
      'diff_impact 必填 project_dir + feature；arch_layer 必填 feature（不吃 project_dir）。' +
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
    name: 'diagnose',
    title: 'Diagnose a symptom to root cause + evidence chain + impact + fix suggestions',
    description:
      '症状诊断：输入"症状"（报错信息 / stack trace / 测试失败输出 / 行为异常描述），' +
      '输出"根因 + 证据链 + 影响面 + 修改建议 + 验证方式"。' +
      '六步流水线：症状解析（正则提取 错误类型/文件:行/符号）→ 候选定位（查 .agent-io/cache.db 符号缓存，' +
      'exact/file/FTS/anchor 四路）→ 调用链追溯（沿 call/type_ref/import 三类边双向 BFS）→ 影响面分析（复用 diff_impact）→ ' +
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
    name: 'canvas_notes',
    title: 'Manage canvas notes: read as work orders / update status / LLM decide',
    description:
      '画布批注统一入口（收敛 read/mark/decide_canvas_notes 三工具为 1 入口，action 分派）。' +
      'action=read 读某 feature 的画布批注，解析成 agent 工单（Markdown/JSON，按 open/done/rejected 分组）——定位待办；' +
      'action=mark 批量更新批注处理状态（updates=[{id,status}]，status ∈ open|done|rejected）——闭环"工单→处理→标记"；' +
      'action=decide 内置 LLM 决策器：读 open 批注逐单决策（change/done/reject），将"批注→改动提案"自动化（LLM 经网关 Key 池调度，未配置则停用）。',
    inputSchema: {
      action: z.enum(['read', 'mark', 'decide']).describe('read=读批注成工单 | mark=更新批注状态 | decide=LLM 决策批注并出提案'),
      feature: z.string().describe('feature 名（如 agent-io）'),
      format: z.enum(['markdown', 'json']).default('markdown').optional().describe('read 用：markdown=工单文档（默认）/ json=结构化 JSON'),
      updates: z
        .array(
          z.object({
            id: z.string().describe('批注图元 id 或批注套 groupId'),
            status: z.enum(['open', 'done', 'rejected']).describe('目标状态'),
          }),
        )
        .optional()
        .describe('mark 用：待更新状态列表'),
      project_dir: z.string().optional().describe('decide 用：项目根目录（缺省用 dsl.source_root；目标文件相对此解析）'),
      max_file_lines: z.number().optional().describe('decide 用：喂给 LLM 的目标文件最大行数（默认 300）'),
      dry_run: z.boolean().optional().describe('decide 用：true=只出决策与提案，不落批注状态'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'read' | 'mark' | 'decide';
      const feature = typeof a.feature === 'string' ? a.feature : '';
      if (!feature) return { message: '缺少 feature', isError: true };

      if (action === 'read') {
        const resolved = resolveCanvasNoteTargets(feature);
        const digest = renderCanvasNotesDigest(feature, resolved);
        const format = a.format === 'json' ? 'json' : 'markdown';
        return {
          message:
            format === 'json'
              ? digest.json
              : `${digest.markdown}\n\n（结构 JSON 见 data.notes / 传 format=json 直接取 JSON）`,
          data: {
            feature: digest.feature,
            generated_at: digest.generated_at,
            total: digest.total,
            open: digest.open,
            done: digest.done,
            rejected: digest.rejected,
            notes: JSON.parse(digest.json).items,
          },
        };
      }

      if (action === 'mark') {
        const updates = Array.isArray(a.updates) ? (a.updates as Array<{ id: string; status: 'open' | 'done' | 'rejected' }>) : [];
        if (updates.length === 0) return { message: '缺少 updates', isError: true };
        const dsl = getDSL(feature);
        if (!dsl) return { message: `feature "${feature}" 不存在`, isError: true };
        const before = (dsl.canvas_notes ?? []).length;
        dsl.canvas_notes = markCanvasNotesStatus(dsl, updates);
        saveDSL(dsl, 'status');
        return {
          message: `已更新 ${updates.length} 条批注状态（feature=${feature}，批注数 ${before}）`,
          data: { feature, updated: updates.length, notes: before },
        };
      }

      // decide
      const r = await decideCanvasNotes({
        feature,
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        max_file_lines: typeof a.max_file_lines === 'number' ? a.max_file_lines : undefined,
        dry_run: a.dry_run === true,
      });
      const summary =
        `open 工单 ${r.open} 条 → 决策完成：` +
        r.decisions.map((d) => `${d.note_id}=${d.action}${d.pending_change_id ? `(提案 ${d.pending_change_id})` : ''}`).join('、') +
        `；已提提案 ${r.proposed} 条，落状态 ${r.applied_statuses.length} 条。`;
      return {
        message: `${summary}\n（模式：${r.note}）`,
        data: r,
      };
    }),
  },

  {
    name: 'gateway_provider',
    title: 'Manage LLM gateway providers & usage (single entry)',
    description:
      '小网关供应商 + 用量统一入口（收敛原 gateway_* 4 工具为 1 入口，action 分派）：' +
      'action=list 列出已注册供应商（key 脱敏：露首 3 + 尾 4，长度 ≤8 全遮）+ 用量汇总；' +
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
      '带 targets 返回命中该目标集（功能/步骤/文件）的文档正文（与 canvas_notes action=decide 的按批关联注入同一套匹配）。' +
      '项目文档可丢进项目仓库 docs/ 作为 LLM 决策背景（需求/设计约定/约定规范），' +
      'canvas_notes action=decide 会自动按批把命中文档注入决策上下文（TOC 全量 + 命中正文封顶）。',
    inputSchema: {
      feature: z.string().describe('feature 名（如 agent-io）'),
      project_dir: z.string().optional().describe('项目根目录（缺省用 dsl.source_root）'),
      name: z.string().optional().describe('文档 id（相对 docs/ 的路径）；给则返回该篇全文'),
      targets: z
        .object({
          features: z.array(z.string()).optional().describe('功能名集合'),
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
      '③ **「每次调用前保鲜」只认 4 个项目根参数名**：`project_dir` / `project_root` / `root` / `dir`。' +
      '用别的名字（如 `cross_repo_symbol_index` 的 `project_dir_a` / `project_dir_b`）就**拿不到自动保鲜** ' +
      '⇒ 结果可能**悄悄是旧的**；此时请显式先调 `index_integrity({project_dir, refresh:true})`。',
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
          '★ **接续**（T54）：你**刚刚调完的那个工具名**。与 `touched_json` 必须**成对给** —— ' +
            '给了这一对，本工具会算出"**下一步能怎么调**、入参**已经取好**"（零手工拼字段名）。',
        ),
      touched_json: z
        .string()
        .optional()
        .describe(
          '★ **接续**：上一步 `---DATA---` 里的那个 `touched` 对象，**原样 JSON.stringify 后的字符串**。' +
            '（★ 用字符串而不是对象：对象在这里只能声明成"袋子"，而袋子正是本仓点名的坏味道 —— ' +
            '宁可让调用方多 stringify 一次，也不新增一个袋子。）',
        ),
    },
    handler: wrapData(async (a) => {
      // ★★★ 2026-10-09（T54）：**接续段** —— 把"上一步的产物"算成"下一步的入参"。
      //   为什么放在本工具：本工具**本来就画着接法表**（"链的接法"段），而它自称"新用户第一站"
      //   ⇒ "我手上这份 touched 下一步怎么用"放这儿最自然，且**不新增工具**（不增面、不增 8 处登记）。
      //   ★ 计算全部落在**已收口的那两个函数**（`nextHopsOf`/`applyChainEdge`）—— 本段不自己推任何规则。
      const handoff = renderHandoffSection(
        a.from_tool as string | undefined,
        a.touched_json as string | undefined,
        (tool) => catalogOf(listToolDefs()).find((c) => c.name === tool)?.requiredKeys ?? [],
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
        // ★ T54：接续段放**最前** —— 调用方给了 `from_tool`+`touched_json` 时，他要的就是这个
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
 * 3. ★ **成对参数**：给了 `from_tool` 就必须给 `touched_json`（反之亦然）—— 只有一半就**报错**，不猜。
 *    ★ 两个都没给 ⇒ 返回**空串**（与改造前**逐字等价**，导航不因此变胖）。
 *
 * ★ 只读：本段不改任何东西，也**不代表"这条链跑通过"**（那是 `CHAINS` 的 `[ran]` 标签说的 —— 标签 = 当年跑过、非实时验证）。
 *
 * ★★★ 2026-10-09（T54 收口）：**本函数导出、两个面共用** —— ① `capability_map` 工具；
 *   ② **回执通道**（`presentation/mcp/server_registry.ts` 的「下一棒」）——
 *   它手上正好有刚跑完那个工具的 `r.text`（`touched` 就在 `---DATA---` 里）
 *   ⇒ **能直接把具体值印出来**（`edit_code.file = src/a.ts`），调用方**不必自己 stringify 一遍**。
 *   ★ 为什么必须共用：这正是本仓头号病的高发处 —— 两个面各写一份"把 touched 变成下一棒"就**分叉**了。
 */
export function renderHandoffSection(
  fromTool: string | undefined,
  touchedJson: string | undefined,
  /** 下游工具的**顶层必填入参**名（由 `catalogOf(...).requiredKeys` 提供） */
  requiredOf: (tool: string) => readonly string[],
): string {
  if (fromTool === undefined && touchedJson === undefined) return '';
  if (fromTool === undefined || touchedJson === undefined) {
    throw new Error(
      '`from_tool` 与 `touched_json` **必须成对给**：只给一半就判断不了"从哪接、拿什么接"。★ 刻意不替你猜。',
    );
  }
  let touched: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(touchedJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是一个对象');
    touched = parsed as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `touched_json 不是合法的 JSON 对象（${(e as Error).message}）。` +
        '它应当是上一步 `---DATA---` 里的**那个 `touched`**，原样 stringify（别自己重排字段）。',
    );
  }

  const cur = touched;
  const L: string[] = [`── 接续（你手上有 \`${fromTool}\` 的 touched ⇒ 下一步怎么调）──`];
  const used = new Set<string>();
  const ready: string[] = [];
  const needPick: string[] = [];
  const blocked: string[] = [];

  /**
   * ★★★ 这条边**只填了哪一个顶层入参**，以及**还差哪些必填**。
   *
   * ## 为什么必须写出来（实测动机）
   * 我验过的那条 `get_dsl.scope_files → edit_code.file`，下游 `edit_code` **还要 `op`**
   * ⇒ 光说"**直接可用（零手工）**"会**误导**（让人以为传一个字段就能调）。
   * ## 而它顺带立起一条更准的定位
   * 把所有边算一遍：**没有一条能填满下游必填**（`edit_code` 缺 `op`；`move_symbol` 缺 `symbol`/`to_file`；
   * `rename_symbols` 缺 `renames` 里每条的 `symbol`/`to`）—— ★★★ **这不是缺陷，是分工**：
   * **接续负责"位置与对象"，不负责"意图"**（要做什么操作 / 改成什么名 / 移到哪 = 语义判断）。
   * ★ 与 `applyChainEdge` 在 `pick` 上**不替人选中**下标，是同一条立论。
   */
  const missingOf = (to: string, toPath: string): string => {
    const filledTop = toPath.replace(/\[\].*$/, '').replace(/\..*$/, '');
    const miss = requiredOf(to).filter((k) => k !== filledTop && !SCOPE_PATHS.has(k));
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
