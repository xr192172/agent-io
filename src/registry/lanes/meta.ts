/**
 * meta 线（9 个工具）—— 由 `TOOL_DEFS` 按 `capability_map.LANE_OF` 切分而来。
 *
 * ★ P1b（2026-09-28）：条目**逐字搬移**，只加了 `export const META_TOOLS` 外壳。
 *   线归属此前是 `capability_map.ts` 里的一张表；切到本文件后，**归属由文件路径表达**，
 *   不再有第二份清单。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { wrap, wrapData } from '../plumbing.js';
import type { DiagnoseInput } from '../../diagnosis/contract.js';
import { formatDiagnoseText, runDiagnosis } from '../../diagnosis/diagnose.js';
import { getDSL, saveDSL } from '../../storage.js';
import { LANE_IDS, makeCapabilityMapHandler } from '../../tools/capability_map.js';
import type { LaneId } from '../../tools/capability_map.js';
import { markCanvasNotesStatus, renderCanvasNotesDigest, resolveCanvasNoteTargets } from '../../tools/derive_mind_map.js';
import { EXPLORE_ACTIONS } from '../../tools/explore_code.js';
import { deleteProvider, getStats, listProvidersMasked, resetStats, upsertProvider } from '../../tools/gateway.js';
import { indexIntegrity, renderIntegrity } from '../../tools/index_integrity.js';
import { decideCanvasNotes } from '../../tools/llm_decider.js';
import { buildDocsPromptBlock, listProjectDocs, matchDocsForTargets, readProjectDoc } from '../../tools/project_docs.js';
import type { DocTargetSet } from '../../tools/project_docs.js';
import { archiveNodeHandler, exploreCodeHandler, listArchiveHandler } from '../handlers.js';
import type { ToolDef } from '../types.js';


/**
 * capability_map 的目录必须来自**真实注册表**（不能自己再维护一份清单）——
 * 但它属于 meta 线，而 `TOOL_DEFS` 是由**各 lane 汇总**出来的 ⇒ 结构上成环。
 *
 * ★ 破环方式（P1b，2026-09-28）：这里只放一个**延迟引用**，由 server_registry 在汇总完
 *   TOOL_DEFS 之后注入（`bindToolDefs`）。刻意**不 import**（那会真成环）；
 *   也刻意**不给一份"看起来能用"的空表** —— 未注入时直接抛错，
 *   而不是静默列出 0 个工具（"不许静默降级"，见 docs/architecture-refactor-plan.md §2d）。
 */
let toolDefsRef: ToolDef[] | null = null;

/** 由 server_registry 在 TOOL_DEFS 汇总完成后调用（模块加载期，一次性） */
export function bindToolDefs(defs: ToolDef[]): void {
  toolDefsRef = defs;
}

function laneCatalog(): ToolDef[] {
  if (!toolDefsRef) {
    throw new Error('[capability_map] TOOL_DEFS 尚未注入 —— server_registry 应在汇总后调用 bindToolDefs()');
  }
  return toolDefsRef;
}

export const META_TOOLS: ToolDef[] = [
  {
    name: 'explore_code',
    title: 'Explore, analyze and understand code',
    description:
      '代码理解统一入口：通过 action 参数化执行各类分析。' +
      `action: ${EXPLORE_ACTIONS.join(' / ')}。` +
      '语义搜索/读取/影响分析/架构分层/导览/巨石分析/拆分/变形链/动画流/算法/注入回放/仿真/文件监听。' +
      'args 为各 action 的具体参数。' +
      'read 是 edit_code 的"先读后改"前置：按符号定位（symbol，+parent 消歧，+context 附带上下文）' +
      '或行区间（start/end，1-based 含端点）读文件，返回带真实行号的内容；' +
      '返回的 start/end/行号与 edit_code(op=range) 同基准（line_utils.splitKeepEnds 下标+1=行号），' +
      '可直接把 read 的行号喂给 edit_code，杜绝行号漂移改错行。' +
      'read 默认在 data.symbols 附整文件符号索引（name/kind/行号/签名，message 末尾附可读符号表，上限30截断），' +
      '一次 read 同时拿到正文+文件地图，symbols:false 可关。' +
      'search 三层路由：标识符查询（如 normalizeCode / Calc.reset）→ 精确符号索引（provider=exact，零向量开销）；' +
      '自然语言意图 → 语义向量相似度；无 embedding 配置/失败 → FTS trigram 降级。' +
      'search 必填 args.project_dir（目标项目根目录，缺省报错）+ args.query，可选 top_k；' +
      'arch_layer/diff_impact 等同样需要 project_dir。' +
      'watch 支持 impact_on_change=true：文件变更后自动生成影响报告（一行摘要入 alerts，' +
      'action=status 查看未读提醒，action=impact + seq 取全文；报告持久落盘 .design-canvas/impact/）。' +
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
    name: 'archive_node',
    title: 'Archive a retiring node to the offline library',
    description:
      '节点下线：把要下线的文件/节点孤立到下线库（archive），存档完整 DSL 快照（含决策卡）+ 为什么下线，' +
      '作为历史研究材料，并从设计 DSL 移除（不再参与周边联系）。' +
      '"下线=两个文件合并"时传 merged_into 指向合并目标，目标文件 lifecycle.merged_from 记录来源，' +
      'diff 时 LLM 可据归档卡 + diff 增量做决策合并（不做自动合并，决策是语义的）。' +
      '适用：删掉废弃模块、合并重复文件、结构重构后的清理。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      file_path: z.string().describe('要下线的文件相对路径'),
      retire_reason: z.string().describe('为什么下线（必填，作为历史研究材料）'),
      merged_into: z.string().optional().describe('若下线是合并（两文件合一），填合并目标文件路径'),
    },
    handler: archiveNodeHandler,
  },

  {
    name: 'list_archive',
    title: 'List archived (retired) nodes',
    description:
      '列出某 feature 的下线库归档条目（历史研究材料）：每个条目含被下线文件、下线原因、合并去向、归档时间。' +
      'LLM 在做结构重构/删除决策前，可先查历史归档了解"以前为什么这么设计、为什么下线"。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      live_dir: z.string().optional().describe('live/base 视图的 baseDir（可选，默认 dataHome）'),
    },
    handler: listArchiveHandler,
  },

  {
    name: 'diagnose',
    title: 'Diagnose a symptom to root cause + evidence chain + impact + fix suggestions',
    description:
      '症状诊断：输入"症状"（报错信息 / stack trace / 测试失败输出 / 行为异常描述），' +
      '输出"根因 + 证据链 + 影响面 + 修改建议 + 验证方式"。' +
      '六步流水线：症状解析（正则提取 错误类型/文件:行/符号）→ 候选定位（查 .design-canvas/cache.db 符号缓存，' +
      'exact/file/FTS/anchor 四路）→ 调用链追溯（沿 call/type_ref/import 三类边双向 BFS）→ 影响面分析（复用 diff_impact）→ ' +
      '根因聚合（规则引擎先跑，LLM 可选把证据翻成人话根因，未配置自动降级）→ 验证建议（按项目类型给命令，只建议不执行）。' +
      '前置：无需任何准备——缓存为空时会自动冷启建索引；仅在目标目录没有可解析源码时退化为文件级线索。' +
      'anchor 可选：用户已知的线索（文件路径或函数名）帮助聚焦。',
    inputSchema: {
      project_dir: z.string().describe('被诊断项目根目录（其下 .design-canvas/cache.db 是符号缓存，为空则自动冷启建索引）'),
      symptom: z.string().describe('症状：报错信息 / stack trace / 测试失败输出 / 行为异常描述'),
      symptom_type: z.enum(['error', 'test_failure', 'behavior']).optional().describe('症状类型，缺省 auto 自动识别'),
      anchor: z.string().optional().describe('可选线索：文件路径或函数名，帮助聚焦定位'),
      max_depth: z.number().optional().describe('调用链追溯深度（默认 3）'),
    },
    handler: wrapData(async (a) => {
      const input = a as unknown as DiagnoseInput;
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
      feature: z.string().describe('feature 名（如 design-canvas）'),
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
      '读取某 feature 的项目文档夹（<project_dir>/docs/，或受管目录 .design-canvas/docs/<feature>/）。' +
      '三种用法：不带 name= 返回清单（含 frontmatter 关联标签与预览，供 agent 挑）；带 name= 返回单篇全文；' +
      '带 targets 返回命中该目标集（功能/步骤/文件）的文档正文（与 canvas_notes action=decide 的按批关联注入同一套匹配）。' +
      '项目文档可丢进项目仓库 docs/ 作为 LLM 决策背景（需求/设计约定/约定规范），' +
      'canvas_notes action=decide 会自动按批把命中文档注入决策上下文（TOC 全量 + 命中正文封顶）。',
    inputSchema: {
      feature: z.string().describe('feature 名（如 design-canvas）'),
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
    title: '能力线导航：design-canvas 工具分层地图',
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
    handler: makeCapabilityMapHandler(() => laneCatalog()),
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
    handler: async (a) => {
      const dir = typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : process.cwd();
      const r = await indexIntegrity({
        project_dir: dir,
        ...(a.refresh === true ? { refresh: true } : {}),
        ...(typeof a.sample === 'number' ? { sample: a.sample } : {}),
      });
      return { text: renderIntegrity(r) };
    },
    // refresh:false 必须是**纯只读**（否则它报告的是"修完之后"，不是"LLM 马上要读到的"）
    noAutoFresh: true,
  },
];
