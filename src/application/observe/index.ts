/**
 * observe 线（11 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const OBSERVE_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'observe'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 *
 * ★ 面收敛第三批（2026-09-29）：本线 13 → 12 个注册入口。内存观测族 2 → 1：
 *   把"列出本机 --inspect 进程"并进 `memory_observe`（新增 action=targets）。
 *   判据（`docs/tool-convergence.md` §2.0「按操作对象聚合」）：两者操作的是**同一个对象**
 *   「目标 node 进程（--inspect）」—— 一个是"选 target 的那一端"（列出进程/端口），
 *   一个是"用 target 诊断"（status/baseline/track/gc/snapshot）；共用锚点 target（targets 自身产出它），
 *   且旧的两份 description **互相指名**（列进程的说"供 memory_observe 的 target 使用"）。
 *   ★ 反面结论（本笔最重要，见提交信息）：`observe_*` 四件套（log/trace/judge/instrument）+
 *     `reconcile_chain` / `reconcile_effects` **不该合** —— 它们是**不同抽象层**
 *     （查询 / 判定 / 动作 / 中观编排），锚点各异（events_file / events_path / events[] / node_id+feature / target），
 *     与 `camera_*` 教训同型。**按前缀聚类是 §2.0 明确禁止的口径**，故一行未动。
 *
 * ★ 面收敛（2026-10-25，I2b）：behavior_baseline 工具面**并入 behavior-cases 判据生态**（本线 12 → 11 个）。
 *   判据：同一生态位出现更高级工具 → 吸收旧的，全方面只留一个，最终吸收进设计侧 ——
 *   行为基线的执行核 `runHarness`（`infrastructure/authoring/behavior`）早已被
 *   `design/intent/expectations.ts` 的 `behavior-cases` 判据共用（capture/verify 与判据走同一条执行路径）
 *   ⇒ 工具注册拆掉，行为基线场景**用 behavior-cases 判据表达**（期望输出写在判据里，不依赖基线文件）。
 *   ★ 只拆工具注册，**不动执行核**（capture/verify 基线函数与六个语言包原样保留）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from "zod";
// ★ T179：**仓根**用仓里已有的『向上找』（git 根 → 最近 manifest）—— 别手算 '..' 级数。
import { wrapData } from "../plumbing.js";
import path from "node:path";
// ★ 第⑬项第三刀：memory_observe 退役出 MCP 面 ⇒ 本文件的 2 个 memory import 不再使用（执行核在 capture/memory_observe.js，CLI 仍可直达）。
import type { ReconcileEffectsInput } from './reconcile/reconcile_effects.js';
// ★ 2026-10-28：observe_proposals 的执行核（从 meta/index.ts 抽出一份实现，注册已并进本入口）
import { fileURLToPath } from "node:url";
import type { ToolDef } from '../types.js';
import { declareActionEffects, declareEffect, type ActionToolDef } from '../action_effect.js';

export const OBSERVE_TOOLS: ActionToolDef[] = [
  // ★★ 第⑬项第三刀（2026-11-10）：memory_observe **退役出 MCP 面** —— 基建运维（开发期内存诊断），
  //   模型面没有消费场景；CLI/内部保留（`infrastructure/analysis/observe/memory_observe.js` 执行核不动）。

  {
    name: 'reconcile_effects',
    writes: true,
    effect: declareEffect('may-write', ['design'], {
      conditionalWrite: true,
      note: '候选转正/补新观察写 .agent/observe 运行状态与 DSL 契约；judge 可选 LLM 未证明。',
    }),
    title: 'Reconcile effect candidates with observe runtime observation',
    description:
      '积木契约动静对账（Brick Harvest Phase 2c 合龙）：读 <project>/.agent/observe/events-*.jsonl 中' +
      '的 effect 事件（Go 语言包（observe-lang-go）instrument --effects 插桩产生），与 DSL 契约候选对账——' +
      '命中转正（origin ast→runtime）、候选外新观测补进契约并记 incomplete 告警（静态漏了）、' +
      '未触发候选保持 ast（不证伪），并填充 contract.runtime（call_count/top_callers/observed_targets/last_seen）。' +
      '前置链：import_project → extract_contracts → instrument --effects → 运行项目 → 本工具。' +
      'LLM 不产生事实：只搬运 observe 观测，判定规则全部机械。',
    inputSchema: {
      project_dir: z.string().describe('被观测项目根目录（其下 .agent/observe/events-*.jsonl 是事件源）'),
      feature: z.string().describe('DSL feature 名（契约在其 SemanticFile.contract）'),
      events_files: z.array(z.string()).optional().describe('显式事件文件列表（缺省自动发现）'),
      write_dsl: z.boolean().optional().describe('false=只对账预演不写回，默认 true'),
    },
    handler: wrapData(async (a) => {
      const { requireStr } = await import('../plumbing.js');
      const { reconcileEffects } = await import('./reconcile/reconcile_effects.js');
      const project_dir = requireStr(a, 'project_dir');
      const feature = requireStr(a, 'feature');
      const r = await reconcileEffects({ ...(a as unknown as ReconcileEffectsInput), project_dir, feature });
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'observe',
    writes: false,
    effect: declareEffect('may-write', ['source', 'design', 'derived-state'], {
      note: '动作级拆分见 actions（§2.6.1）；instrument 插桩改源；缓存/运行状态写派生态；proposals#approve 落 DSL 契约。',
      actions: declareActionEffects({
        log: declareEffect('safe-read', ['derived-state']),
        trace: declareEffect('safe-read', ['derived-state']),
        judge: declareEffect('may-write', ['external', 'derived-state'], { conditionalWrite: true, note: 'use_llm=true 走 callChat；缺省 false 纯规则；判定缓存落派生态。' }),
        line: declareEffect('safe-read', ['source', 'design', 'derived-state']),
        ledger: declareEffect('safe-read', ['derived-state']),
        instrument: declareEffect('may-write', ['source', 'derived-state'], { conditionalWrite: true, note: 'dry_run=false 落盘插桩；dry_run=true 不开闸。' }),
        uninstrument: declareEffect('may-write', ['source', 'derived-state'], { note: '恒执行还原源码 + 台账删除。' }),
        restore: declareEffect('may-write', ['source', 'derived-state'], { note: '同 uninstrument 通道，恒执行还原。' }),
        'proposals#list': declareEffect('safe-read', ['derived-state']),
        'proposals#show': declareEffect('safe-read', ['derived-state']),
        'proposals#reject': declareEffect('may-write', ['derived-state']),
        'proposals#approve': declareEffect('may-write', ['design', 'derived-state', 'external'], { conditionalWrite: true, note: 'use_llm 可选 LLM 复核；frozen 拒写；dsl.save 落册。' }),
      }),
    }),
    title: 'Observe 单入口（action=log | trace | judge）',
    description:
      '★ 观察线只读三合一入口：**没有独立工具**（`observe_log` / `observe_trace` / `observe_judge` 都不存在）——' +
      '三个只读动作都在本入口的 action 里；插桩 / 还原 / 台账 / 提案门也在这一个入口（它们各有自己的写盘副作用与独立的 ' +
      'action 命名空间，**不**混进只读那几个 action 的判定口径）。' +
      '\n· `action=log`（默认）查运行时事件 events.jsonl，可按文件过滤或全量；' +
      '\n· `action=trace` 重建完整调用树并采样，返回结构化调用链（给 `trace_id` 展开某一针）；' +
      '\n· `action=judge` 对一批事件做偏差判定（可带 `decls` 做链路契约判定）。' +
      '\n\n参数按 action 取用（其余字段忽略）：log → `events_file` / `files` / `all`；' +
      'trace → `events_path` / `events_text` / `keep` / `trace_id` / `limit`；' +
      'judge → `events` / `decls` / `text` / `use_llm` / `project_root`；' +
      'line → `feature` / `project_dir` / `target` / `max_steps`。',
    inputSchema: {
      // ★★ 2026-10-31（0.12 同族的“声明三处只对两处”）：`ACTION_SPEC` 里认的 action / 字段，**必须**在
      //   这里能传进来 —— 改前 `max_steps` 与 `action='line'` 两头都缺：按文档传会被 zod 直接拒（契约层就没了），
      //   而 handler 里那段 `args.max_steps` 永远拿不到值 = 幽灵参数。判据：证 `t422` 的 ②（反向：fields ⊆ schema）。
      action: z
        .enum(['log', 'trace', 'judge', 'instrument', 'uninstrument', 'restore', 'ledger', 'proposals', 'line'])
        .describe(
          'log=查事件（默认）| trace=重建调用链 | judge=逐事件偏差判定 | instrument=插桩 | uninstrument/restore=一键全拔 | ledger=只看探针台账 | proposals=observe 提案（配 op=list/show/approve/reject）| line=功能主链（每功能入口沿调用边走成主链；★ 与 trace 同族但看的是**结构**不是事件）',
        ),
      op: z
        .enum(['list', 'show', 'approve', 'reject'])
        .optional()
        .describe('[proposals] 子动作：list=列（默认）| show=看一条 | approve=走四层门 | reject=驳回'),
      // ── log ──
      events_file: z.string().optional().describe('[log] Observe 事件文件路径（events.jsonl）'),
      files: z.array(z.string()).optional().describe('[log] 按文件路径过滤（精确 / 后缀 / 包含匹配）'),
      all: z.boolean().optional().describe('[log] true=列出全部事件；false=只列偏差（默认）'),
      // ── trace ──
      events_path: z.string().optional().describe('[trace] 录制事件 JSONL 路径；缺省自动找探针 sink'),
      events_text: z.string().optional().describe('[trace] 内联事件文本，优先于 events_path（调试用）'),
      keep: z.enum(['all', 'default']).optional().describe("[trace] 'all'=返回全部链路；'default'=采样只留代表针"),
      trace_id: z.string().optional().describe('[trace] 展开某条链路；不给则返回链路清单'),
      limit: z.number().optional().describe('[trace] 最多返回几针（防上下文撑爆；给 trace_id 时忽略）'),
      // ── instrument / uninstrument / restore / ledger ──
      target: z.string().optional().describe('[instrument/ledger] 要插桩 / 还原 / 查台账的目标项目目录'),
      dry_run: z.boolean().optional().describe('[instrument] true=只预览探针点不写盘'),
      // ★ 2026-10-28（T-#OBSERVE-4 ③）：推荐器 → 插桩器的桥
      contract_probes: z
        .array(z.string())
        .optional()
        .describe('[instrument] 契约模式：**只插这些探针点**（精确匹配 `<mod>.<fn>.<suffix>`）；不传=全量无脑插桩'),
      contract_from_points: z
        .boolean()
        .optional()
        .describe(
          '[instrument] true=直接读 `<target>/.agent-io/observe-points.json` 的 `points[].key` 当契约清单（推荐器写的，与插桩器同源同命名）。★ 文件缺失/清单空 ⇒ 报错不插，绝不静默退回全量',
        ),
      // ★★ 第⑪项（2026-11-10）：判据→探针清单（"册里声明了 runtime 判据 ⇒ 自动推导要插哪些探针"）
      from_expectations: z
        .string()
        .optional()
        .describe(
          '[instrument] feature 名：读该册 runtime 判据的 probe 选择器，与 observe-points.json 匹配 ⇒ 得 contract_probes。★ 与另两来源互斥；零交集/文件缺失 ⇒ 报错不插',
        ),
      // ★ 2026-10-28：`agent` 在 handler 的 SPEC 与 COMMON_FIELDS 里都认，但 **schema 里没声明**
      //   ⇒ 严格校验下**根本传不进来**（"声明三处、只对两处"的典型）。补上。
      agent: z.string().optional().describe('[全部] 谁在调用（审计/台账用；任何 action 都接受）'),
      // ── proposals（与 review_changes 同一套规矩：确认人是下一个接手的 Agent）──
      // ★ 2026-10-28（结构检查抓到的真 bug）：`ACTION_SPEC.proposals` 认 `project_dir` / `feature`，
      //   但 **schema 里从未声明**（全文那两处声明属于别的工具）⇒ 实际调用时**传不进来**
      //   ⇒ `observe action=proposals` 等于残缺。补上。
      project_dir: z.string().optional().describe('[proposals] 提案库所在项目根（缺省当前目录）'),
      feature: z.string().optional().describe('[proposals] 只看某个 feature 的提案'),
      id: z.string().optional().describe('[proposals] show/approve/reject 用：提案 id'),
      note: z.string().optional().describe('[proposals] reject 用：驳回理由'),
      // ── judge ──
      events: z.array(z.record(z.string(), z.unknown())).optional().describe('[judge] 要判定的事件数组（TSEvent 形状）'),
      decls: z.array(z.record(z.string(), z.unknown())).optional().describe('[judge] 设计声明数组（可做链路契约判定）'),
      text: z.boolean().optional().describe('[judge] true=人类可读报告；false=JSON（默认）'),
      use_llm: z.boolean().optional().describe('[judge] true=对可疑事件做 LLM 复核（默认 false）'),
      project_root: z.string().optional().describe('[judge] 被分析项目根（不传则不做设计对比）'),
      // ── line（2026-10-28 合并 feature_line）──
      // ★ 缺省值住在被调处（`buildMainChain(entry, allFns, maxSteps = 24)`）—— 这里不另存一份默认值。
      max_steps: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('[line] 功能主链的步数上限（不传 = 取被调处默认 24；超过的节点会被截断，回执里注明 ``截断`` 不静默）'),
    },
    // ★ 拆注册不拆执行核：五个 handler 原样保留，只由一个入口按 action 分派。
    // ★★ 2026-10-28（可用性实测修）：单入口最大的坑是"**参数传错却静默生效**"——
    //   实测 `action=log` 加上 `events_path`（那是 trace 的参数）时，只报"需要 events_file"，
    //   用户会以为自己给对了路径。⇒ 入口先做**按 action 的参数守卫**：
    //   ① 缺必填 ⇒ 列出该 action 需要的字段；② 给了别的 action 的专属字段 ⇒ **点名**是谁的。
    handler: (async (a: unknown) => {
      const { getFeatureLine } = await import('./capture/feature_line.js');
      const { observeInstrumentHandler, observeJudgeHandler, observeLogHandler, observeTraceHandler } = await import('./handlers.js');
      const { observeProposalsHandler } = await import('../meta/proposals/handler.js');
      const args = a as Record<string, unknown>;
      const action = String(args.action ?? 'log');
      // 每个 action 认哪些字段（白名单：只列该动作真正会读的）
      // ★★★ 2026-10-28（用户："有没有需要结构化重写的点"）：**原来这里是两张手写表 + 一条"永远放行"名单**，
      //   而 zod schema 是**第三处**声明同一个事实 ⇒ 加参数必忘一处。实测代价（今天两次）：
      //   · `contract_probes` 加进了 schema 与 handler，却**没进 SPEC** ⇒ 被当"陌生人点名"拒；
      //   · `dry_run / use_llm / project_dir / feature / agent` 靠一条**魔法白名单**才可用 ⇒ 新人看不出为什么。
      //   ⇒ 现在只有**一张** `ACTION_SPEC`：`fields`（认哪些）+ `need`（必填哪些）；
      //     SPEC/NEED 都由它派生；魔法白名单**删掉**（那些字段在各 action 的 fields 里显式列出）。
      const ACTION_SPEC: Record<string, { fields: string[]; need: string[] }> = {
        log: { fields: ['events_file', 'files', 'all'], need: ['events_file'] },
        trace: { fields: ['events_path', 'events_text', 'keep', 'trace_id', 'limit'], need: [] },
        judge: { fields: ['events', 'decls', 'text', 'use_llm', 'project_root'], need: ['events'] },
        instrument: {
          fields: ['target', 'dry_run', 'contract_probes', 'contract_from_points', 'from_expectations'],
          need: ['target'],
        },
        uninstrument: { fields: ['target'], need: ['target'] },
        restore: { fields: ['target'], need: ['target'] },
        ledger: { fields: ['target'], need: ['target'] },
        proposals: { fields: ['project_dir', 'feature', 'id', 'note', 'agent', 'use_llm', 'op'], need: [] },
        // ★ 2026-10-28（合并 feature_line）：功能主链是**观测侧读数**，与 trace/trace 同族 ⇒ 进单入口
        line: { fields: ['feature', 'project_dir', 'target', 'max_steps'], need: ['feature'] },
      };
      const SPEC: Record<string, string[]> = Object.fromEntries(
        Object.entries(ACTION_SPEC).map(([k, v]) => [k, v.fields]),
      );
      const NEED: Record<string, string[]> = Object.fromEntries(
        Object.entries(ACTION_SPEC).map(([k, v]) => [k, v.need]),
      );
      const mine = SPEC[action];
      if (!mine) {
        throw new Error(
          `observe: 不认识 action="${action}" ⇒ 只能是 ${Object.keys(SPEC).join(' / ')}` +
            `（proposals 的子动作用 op=list/show/approve/reject）`,
        );
      }
      // ★ 只留一个**显式声明**的公共字段。原来那条魔法清单把 5 个字段对所有 action 放行，
      //   等于"没有守卫"（`contract_probes` 就是被它挡住的）。`agent` = 谁在提问，对任何动作都有意义；
      //   其余一律按 action 精确匹配。
      const COMMON_FIELDS = ['agent'];
      const strangers = Object.keys(args).filter((k) => {
        if (k === 'action') return false;
        if (mine.includes(k)) return false;
        if (COMMON_FIELDS.includes(k)) return false;
        return Object.values(SPEC).some((v) => v.includes(k));
      });
      if (strangers.length) {
        const owner = strangers
          .map((k) => `${k}（属于 ${Object.entries(SPEC).find(([, v]) => v.includes(k))?.[0] ?? '?'}）`)
          .join('、');
        throw new Error(`observe action=${action}: 收到不属于本动作的参数 —— ${owner}。本动作只认：${mine.join(' / ')}`);
      }
      // ★ 顺序很重要：先报"你传错了参数"（信息量最大），再报"你缺什么" —— 实测反了会误导。
      const missing = (NEED[action] ?? []).filter((k) => args[k] === undefined || args[k] === '');
      if (missing.length) {
        throw new Error(`observe action=${action}: 缺必填 ${missing.join(' / ')} ⇒ 该动作要这些字段：${mine.join(' / ')}`);
      }
      // ★ 2026-10-28（合并 feature_line）：功能主链 —— 就地实现（原来是一个独立工具）
      if (action === 'line') {
        const feature = String(args.feature ?? '');
        if (!feature) throw new Error('observe action=line: 缺必填 feature');
        const sourceRoot = args.project_dir ? String(args.project_dir) : undefined;
        const opts = {
          target: args.target ? String(args.target) : undefined,
          maxSteps: typeof args.max_steps === 'number' ? args.max_steps : undefined,
        };
        const r = getFeatureLine(feature, sourceRoot, opts as never);
        // ★ 2026-10-28：本工具的 handler **不走 wrap**（各分支自己产 text）⇒ 这里必须自己拼 text + DATA 段，
        //   否则返回 {message} 会被上层当"没有 text"丢掉（实测：输出空白）。
        if (!r.ok) return { text: `功能线不可用：${r.note ?? '未知'}` };
        if (r.features) {
          const parts = [`功能线总览（${r.features.length} 个功能）：`, ...r.features.map((f) => `  - ${f.feature}：入口 ${f.entry}（链 ${f.steps ?? '?'} 步）`)];
          if (r.note) parts.push(`  备注：${r.note}`);
          return { text: `${parts.join('\n')}\n---DATA---\n${JSON.stringify({ ok: true, features: r.features })}` };
        }
        const line = r.line!;
        const parts = [
          `功能线「${line.feature}」：入口=${line.entry?.name ?? '—'}，主链 ${line.chain.length} 步：`,
          ...line.chain.map((nd, i) => `  ${i + 1}. ${nd.name}（${nd.file}:${nd.line}）${nd.doc ? ' — ' + nd.doc : ''}`),
        ];
        if (r.note) parts.push(`  备注：${r.note}`);
        return { text: `${parts.join('\n')}\n---DATA---\n${JSON.stringify({ ok: true, feature: line.feature, line })}` };
      }
      if (action === 'trace') return observeTraceHandler(a as never);
      if (action === 'judge') return observeJudgeHandler(a as never);
      if (action === 'instrument' || action === 'uninstrument' || action === 'restore' || action === 'ledger') {
        // ★ 形状可重写：把"动作在 action 里"翻译成 instrument handler 期望的形态
        return observeInstrumentHandler({ ...args, action: action === 'instrument' ? 'instrument' : action } as never);
      }
      if (action === 'proposals') {
        return observeProposalsHandler({ ...args, action: String(args.op ?? 'list') } as never);
      }
      return observeLogHandler(a as never);
    }) as ToolDef['handler'],
  },

  {
    name: 'reconcile_chain',
    writes: false,
    effect: declareEffect('may-write', ['design'], { conditionalWrite: true, note: '仅确认/补链时写 DSL 链。' }),
    title: 'Reconcile a host chain with its real-run observe events (meso tier)',
    description:
      '中观档对账（工具可用性复盘缺口 C）：按「文件/宿主节点」一条命令的真跑 + 查数据 + 对账，' +
      '填补宏观（整项目对账）与微观（trace-exec 纯函数子集）之间的空档。' +
      '后工具自动前置 + 缓存跳过：宿主下无 detail 链时自动调用 deriveDetailChain 建链' +
      '（已有链则命中缓存跳过派生），自动发现被观测项目事件文件（.agent/observe + .agent-io/observe），' +
      '按链涉及文件过滤出这条链的真跑事件 → judgeEvent 逐事件判定偏差 → rebuildChains 重建实测调用链' +
      '→ 链路契约匹配（声明链须是某条实测链的子序列，mode=bare-name 近似）。' +
      '该链无任何事件时 not_run=true 并明示「先跑一遍再对账」，绝不伪造事件降级冒充成品。' +
      '用途：重构前基线 + 重构后验收对照。',
    inputSchema: {
      feature: z.string().describe('DSL feature 名'),
      node_id: z.string().describe('宿主文件节点 id（detail 链挂在它下面，作为对账的链根）'),
      project_dir: z.string().describe('被观测项目根目录（其下 .agent/observe/events-*.jsonl 是事件源）'),
      events_files: z.array(z.string()).optional().describe('显式事件文件列表（缺省自动发现）'),
      force: z.boolean().optional().describe('true=忽略缓存强制重新派生链（默认 false，已有链则跳过派生）'),
      max_steps: z.number().optional().describe('派生入链函数上限（默认 12，仅需派生时生效）'),
    },
    handler: (a) => import('./handlers.js').then((m) => m.reconcileChainHandler(a)),
  },

  
  {
    name: 'recommend_observe_points',
    writes: false,
    effect: declareEffect('may-write', ['derived-state'], { conditionalWrite: true, note: '仅写 observe 提案/运行派生态。' }),
    title: 'Recommend where to instrument (observe points)',
    description:
      '★ 观测点推荐器：**不做全量插桩**，而是先用索引/图 + AST 语义算出「该在哪打日志」，只在推荐点上插。' +
      '信号：高被引用（call 入度）/ 最近真改过的符号（symbol_diffs）/ 副作用边界（span 内 IO 调用，启发式）/' +
      '静默吞错（catch 块内无 throw/日志，启发式）/ 复杂度高地（行数）/ 文件热点（24h 内改动）。' +
      '每个点给出 score 与 reasons（为什么推荐它——这份「理由」本身就是整理日志的骨架）。' +
      'key 取自**插桩器自身的 dry-run 站点清单**（`<mod>.<fn>.enter/.exit/.catch/.io.<op>`），' +
      '与 contractProbes 精确匹配 ⇒ 推荐出来的点一定插得出来，不会漂移。' +
      '输出清单落 `<project_dir>/.agent-io/observe-points.json`（可人工增删/改 level），' +
      '再把 contractProbes 交给 observe_instrument 即可只插这些点。' +
      '预算按分数裁剪（max_points），被截断的如实列出——不搞环形缓冲那套事后策略。' +
      '（低频候选，待真实使用评估）',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（空库会自动冷启建索引，无需先 import_project）'),
      focus: z
        .string()
        .optional()
        .describe('★ 任务定向：只关心某个子系统/主题时传它（正则，如 `conveyor|spill|cache`）—— 命中的符号优先扫描并加分。不传 = 按全局信号排序'),
      focus_paths: z.array(z.string()).optional().describe('路径前缀白名单（posix 分隔，如 packages/conveyor-context）'),
      max_points: z.number().int().min(1).optional().describe('最多保留多少个观测点（默认 40，超出按分数截断）'),
      max_files: z.number().int().min(1).optional().describe('最多对多少个候选文件跑 dry-run 插桩（默认 20，控制耗时）'),
      write: z.boolean().optional().describe('false=只返回不落盘（默认 true，写 observe-points.json）'),
    },
    handler: wrapData(async (a) => {
      const { requireStr } = await import('../plumbing.js');
      const { ensureProjectIndex } = await import('../../infrastructure/index/index_freshness.js');
      const { recommendObservePoints } = await import('./capture/observe_points.js');
      const project_dir = requireStr(a, 'project_dir');
      const input = a as unknown as {
        project_dir: string;
        focus?: string;
        focus_paths?: string[];
        max_points?: number;
        max_files?: number;
        write?: boolean;
      };
      const root = path.resolve(project_dir);
      // ★ 零前置：索引为空就地冷启（推荐器建立在索引之上）
      const { db } = await ensureProjectIndex(root);
      const r = await recommendObservePoints(db, root, {
        maxPoints: input.max_points,
        maxFiles: input.max_files,
        write: input.write,
        focus: input.focus,
        focusPaths: input.focus_paths,
      });
      return { message: r.summary, data: r };
    }),
  },

  // ★ I2b（2026-10-25）：behavior_baseline 工具注册已拆（并入 behavior-cases 判据生态，见文件头）。
  //   行为基线场景 → 用 `edit_dsl` 在决策卡写 `behavior-cases` 判据（期望输出写在判据里，
  //   判定器经 `runHarness` 走同一条执行路径）；capture/verify 快照式基线的执行核
  //   （`infrastructure/authoring/behavior`）原样保留，供判据判定器与未来消费方共用。

  {
    name: 'run_tests',
    writes: false,
    effect: declareEffect('may-write', ['external'], { note: '外部测试进程；运行报告落派生缓存。' }),
    title: 'Run tests and return exit code plus output tail',
    description:
      '跑目标项目的测试（走 package.json 的 scripts.test，以退出码判成败，退出码 0 ⇒ 成功）。' +
      'filter 传单个测试文件/名称 → `npm test -- <filter>` 定向回归；省略跑全量（耗时，适合提交前检查）。' +
      '失败时返回 exitCode + stdout/stderr 的尾部（截断，仅尾部），不解析任何框架私有格式，通用适配 vitest/jest/node:test 等。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（默认 cwd）'),
      filter: z.string().optional().describe('测试文件/名称过滤（如 tests/tools/find_references.test.ts），经 npm test -- 透传'),
      timeout_ms: z.number().optional().describe('超时毫秒（默认 120000）'),
      // ★ P2 执行上下文（可选；只做审计分桶与事件挂接，授权仍由既有写闸/租约判）。
      feature: z.string().optional().describe('[P2] 本次验证挂的任务 feature（给了才记 Attempt 事件；缺省 = 通用 runner）'),
      node_id: z.string().optional().describe('[P2] 本次验证挂的任务节点 id（与 feature 成对）'),
      lease_generation: z.number().int().optional().describe('[P2] 调用方持有的租约代际（审计分桶；不据此授写权）'),
    },
    handler: wrapData(async (a) => {
      const { resolveProjectRoot } = await import('../../infrastructure/analysis/project_root/index.js');
      const { runTests } = await import('./runtime/run_tests.js');
      const { checkStaleBuild, formatStaleText } = await import('./runtime/stale_check.js');
      // 跑测试前置：检本服务自身 dist 是否 stale（改 src 忘 build → 提示先重建，防测旧产物）
      const staleHint = (() => {
        try {
          // ★★★ 2026-10-11（T179）：**原先这里手算 `'..','..','..'`**，注释还写「dist/src/server_registry.js → 向上 3 级」
          //   —— ★ 而本模块在 `<root>/dist/src/application/observe/index.js`，**比它深 2 层** ⇒ 算到 `<root>/dist/src` ✗
          //   ⇒ ★ `checkStaleBuild` 去看 `<root>/dist/src/src`（不存在）⇒ 静默 return ⇒
          //     ★ **`run_tests` 的「测试前置 STALE BUILD 提示」永久哑火**（同型于 server_registry 那处 HIGH）✓
          //   ⇒ 改用仓里的 `resolveProjectRoot()`（向上找 `.git` → 最近 manifest）—— **别手算级数**。
          const stale = checkStaleBuild(resolveProjectRoot(fileURLToPath(import.meta.url)));
          return stale.stale ? formatStaleText(stale) : null;
        } catch {
          return null; // 非本项目根（如外部项目）→ 静默跳过
        }
      })();
      const r = runTests({
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        filter: typeof a.filter === 'string' && a.filter ? a.filter : undefined,
        timeoutMs: typeof a.timeout_ms === 'number' ? a.timeout_ms : undefined,
        execution:
          typeof a.feature === 'string' && a.feature && typeof a.node_id === 'string' && a.node_id
            ? {
                feature: a.feature,
                node_id: a.node_id,
                actor: typeof a.actor === 'string' && a.actor ? a.actor : undefined,
                lease_generation: typeof a.lease_generation === 'number' ? a.lease_generation : undefined,
                via: 'run_tests',
              }
            : undefined,
      });
      if (!r.ok) {
        return { message: `无法运行测试：${r.error || '未知错误'}`, data: r };
      }
      const parts = [
        ...(staleHint ? [staleHint, ''] : []),
        `${r.filter ? '[定向]' : '[全量]'} ${r.command}`,
        r.timedOut ? '结果：超时（进程已终止）' : r.success ? '退出码 0 → 测试通过' : `退出码 ${r.exitCode} → 测试失败`,
      ];
      if (r.filterNote) parts.push(`filter：${r.filterNote}`);
      if (r.stdoutTail.trim()) parts.push('—— stdout（仅尾部）——', r.stdoutTail.trimEnd());
      if (r.stderrTail.trim()) parts.push('—— stderr（仅尾部）——', r.stderrTail.trimEnd());
      if (r.outputTruncated) parts.push('（输出过长，已截断，仅保留尾部）');
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'recover_run',
    writes: false,
    effect: declareEffect('safe-read', ['source', 'design', 'derived-state'], {
      note: 'P2 只读恢复：组合 Task/Run/Attempt 事件流、既有证据新鲜度与实时 Git 快照；不 claim/takeover/renew，grants=none，建议不持久化。',
    }),
    title: 'Recover task run state from events, evidence and live git facts (read-only)',
    description:
      '★ P2 引擎原生可恢复执行的**只读**恢复入口：不依赖聊天上下文，现场组合任务（目标/owner/代际/租约）、' +
      'Run/Attempt 事件流 fold 出的 checkpoint、既有证据与新鲜度、实时 HEAD/脏树、最近 runner 验证与缺口。' +
      '输出当前目标、活动任务/Run、写盘 actor 与租约、实时 HEAD/脏树、最近验证、已中断 Attempt/未对账外部写、' +
      '可重建 checkpoint 与唯一下一步（next_action，grants=none，不自动写权）。' +
      '· 进程无可靠探针或 pid 不可证明 ⇒ 活性=unknown，不凭 pid/TTL 伪造 alive/dead；' +
      '· done/void 只展示历史，不建议自动重启；当前代际已有活跃 Attempt 不重复派工；旧代际标 stale 不重新附着；' +
      '· 引擎外写标 unreconciled_external_write，不归因 actor；Git 不可读/无基线显式 unknown/gap，不把空集当干净。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（解析到唯一项目根）'),
      feature: z.string().optional().describe('DSL feature 名（可选；给了 node_id 才精确定位一张卡）'),
      node_id: z.string().optional().describe('任务节点 id（可选；与 feature 成对）'),
    },
    handler: wrapData(async (a) => {
      const { requireStr } = await import('../plumbing.js');
      const { recoverRun } = await import('./runtime/recover.js');
      const project_dir = requireStr(a, 'project_dir');
      const r = recoverRun({
        project_dir,
        feature: typeof a.feature === 'string' && a.feature ? a.feature : undefined,
        node_id: typeof a.node_id === 'string' && a.node_id ? a.node_id : undefined,
        actor: typeof a.actor === 'string' && a.actor ? a.actor : undefined,
      });
      const lines = [
        `目标：${r.target.feature ?? '（未指定）'}${r.target.node_id ? ` / ${r.target.node_id}` : ''}${r.target.summary ? ` — ${r.target.summary}` : ''}`,
        r.task
          ? `任务：state=${r.task.state} owner=${r.task.owner ?? '—'} 代际=${r.task.lease_generation} 证据=${r.task.evidence_count}（${r.task.evidence_bucket}）`
          : '任务：权威源取不到（见 gaps）',
        `下一步：${r.next_action.action} — ${r.next_action.reason}`,
        `漂移：${r.drift.status}（HEAD=${r.drift.live.head ?? 'unknown'}，dirty=${r.drift.live.dirty}）`,
      ];
      if (r.gaps.length) lines.push('缺口/限制：' + r.gaps.join('；'));
      if (r.next_action.suggestions.length) lines.push('建议：' + r.next_action.suggestions.join('；'));
      return { message: lines.join('\n'), data: r };
    }),
  },

];
