/**
 * meta 线（9 个工具）—— ★ **本文件即该线归属的唯一来源**。
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
import { requireStr, wrapData } from '../plumbing.js';
import type { DiagnoseInput } from '../../infrastructure/analysis/diagnosis/contract.js';
import { formatDiagnoseText, runDiagnosis } from '../../infrastructure/analysis/diagnosis/diagnose.js';
import { getDSL, saveDSL } from '../../infrastructure/storage.js';
import { archiveNode, listArchive } from './archive/archive_node.js';
import { LANE_IDS, listToolDefs, makeCapabilityMapHandler } from './registry/capability_map.js';
import type { LaneId } from './registry/capability_map.js';
import { markCanvasNotesStatus, renderCanvasNotesDigest, resolveCanvasNoteTargets } from './view/derive_mind_map.js';
import { EXPLORE_ACTIONS } from './explore/explore_code.js';
import { deleteProvider, getStats, listProvidersMasked, resetStats, upsertProvider } from './llm/gateway.js';
import { indexIntegrity, renderIntegrity } from './integrity/index_integrity.js';
import { decideCanvasNotes } from './llm/llm_decider.js';
import { buildDocsPromptBlock, listProjectDocs, matchDocsForTargets, readProjectDoc } from './docs/project_docs.js';
import type { DocTargetSet } from './docs/project_docs.js';
import { exploreCodeHandler, syncContractsHandler } from '../handlers.js';
import type { ToolDef } from '../types.js';


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
      'action=list 列出已注册供应商（key 脱敏只露尾 4 位）+ 用量汇总；' +
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
      'observe 观测 / harvest 契约采集 / cross 跨仓杂交健康 / meta 元信息）× 每条线内工具及其适用时机；' +
      '传 lane 只看某条线。agent 在不确定用哪个工具前，优先调它分层定位，再进入具体工具。' +
      '高频工具（get_dsl / edit_dsl / explore_code / rename_symbols / rename_files / find_references）始终直接可用，无需先经本工具。',
    inputSchema: {
      lane: z
        .enum([...LANE_IDS] as [LaneId, ...LaneId[]])
        .optional()
        .describe('只看指定能力线；省略返回全部 6 线'),
    },
    handler: makeCapabilityMapHandler(() => listToolDefs()),
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
      const dir = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : process.cwd();
      const r = await indexIntegrity({
        project_dir: dir,
        ...(a.refresh === true ? { refresh: true } : {}),
        ...(typeof a.sample === 'number' ? { sample: a.sample } : {}),
      });
      return { message: renderIntegrity(r), data: r };
    }),
    // refresh:false 必须是**纯只读**（否则它报告的是"修完之后"，不是"LLM 马上要读到的"）
    noAutoFresh: true,
  },
];
