/**
 * observe 线（12 个工具）—— ★ **本文件即该线归属的唯一来源**。
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
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { wrap, wrapData, requireStr } from '../plumbing.js';
import path from 'node:path';
import { baselinePathFor, captureBaseline, verifyBaseline } from '../../infrastructure/authoring/behavior/index.js';
import { rebuildChains } from '../../infrastructure/analysis/observe/chain.js';
import { getFeatureLine } from './capture/feature_line.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import { memoryObserveHandler, memoryTargetsHandler } from './capture/memory_observe.js';
import type { MemoryObserveInput } from './capture/memory_observe.js';
import { narrateStep } from './capture/narrate_step.js';
import type { NarrateStepInput } from './capture/narrate_step.js';
import { recommendObservePoints } from './capture/observe_points.js';
import { reconcileEffects } from './reconcile/reconcile_effects.js';
import type { ReconcileEffectsInput } from './reconcile/reconcile_effects.js';
import { runTests } from './runtime/run_tests.js';
import { checkStaleBuild, formatStaleText } from './runtime/stale_check.js';
import { observeInstrumentHandler, observeJudgeHandler, observeLogHandler, observeTraceHandler, reconcileChainHandler } from './handlers.js';
import { fileURLToPath } from 'node:url';
import type { ToolDef } from '../types.js';

export const OBSERVE_TOOLS: ToolDef[] = [
  {
    name: 'memory_observe',
    title: 'External process memory observer (CDP)',
    description:
      '外部进程内存观测：开发期对 DSH gen / 任意 node 进程做内存诊断。通过 CDP 从外部连到目标进程的 --inspect 端口（observer≠subject，不需往目标进程塞插件）。' +
      'action：targets=（**无需 target**）列出本机所有带 --inspect=<port> 的 node 进程（pid + inspect 端口），用来决定后面 target 传什么；' +
      'status=一次性内存构成（默认）/ baseline=记基线 / track=对比基线报增量+增长率+泄漏方向(JS堆 vs native) / gc=目标进程强制 global.gc() 判断瞬时或泄漏(需目标带 --expose-gc) / snapshot=HeapProfiler 写 heap snapshot 落盘。' +
      '除 action=targets 外，target（目标进程 --inspect 端口，纯数字）**必填**；不知道填什么时先 action=targets。' +
      '★ 常用链：action=targets 拿端口 → target=<端口> status 看现状 → action=baseline 记起点 → 跑活 → action=track 看增量。',
    inputSchema: {
      action: z
        .enum(['targets', 'status', 'baseline', 'track', 'gc', 'snapshot'])
        .default('status')
        .optional()
        .describe('targets=列出本机 --inspect 进程（无需 target）/ status=一次性统计（默认）/ baseline=记基线 / track=对比基线 / gc=强制GC判定瞬时或泄漏 / snapshot=写heap snapshot'),
      target: z.number().int().positive().optional().describe('目标进程的 --inspect 端口（纯数字）；除 action=targets 外必填，可用 action=targets 自动列出'),
      project_dir: z.string().optional().describe('snapshot 用：heapsnapshot 落盘归属项目根（缺省 process.cwd）'),
    },
    handler: wrapData(async (a) => {
      // ★ 面收敛第三批：把"列出本机 --inspect 进程"这一动作并进来（同一操作对象「目标 node 进程」）。
      //   action=targets 分派到 targets 的 [B]，其余 action 仍走内存观测的 [B]（[B] 一行未改）。
      if (String(a.action ?? 'status') === 'targets') return memoryTargetsHandler();
      return memoryObserveHandler(a as unknown as MemoryObserveInput);
    }),
  },

  {
    name: 'reconcile_effects',
    title: 'Reconcile effect candidates with observe runtime observation',
    description:
      '积木契约动静对账（Brick Harvest Phase 2c 合龙）：读 <project>/.agent/observe/events-*.jsonl 中' +
      '的 effect 事件（go-observe instrument --effects 插桩产生），与 DSL 契约候选对账——' +
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
      const project_dir = requireStr(a, 'project_dir');
      const feature = requireStr(a, 'feature');
      const r = await reconcileEffects({ ...(a as unknown as ReconcileEffectsInput), project_dir, feature });
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'narrate_step',
    title: 'Narrate a production-line step as a governed narrative brick',
    description:
      '叙事砖（设计观察：吸收 manim 的"声明式分镜"——一个工序只讲一件事、靠连续进/出过渡连起来）。' +
      '给定一个产线工序文件，生成"进料口→工序→出料口"分镜序列：数据形态（input/output 针脚）由契约投影' +
      '（actual_apis[0] 签名）产生，是代码事实、非 LLM 编造；分镜 facts 逐条引用真实针脚。' +
      'write=true 时用自有 MCP 抽成砖接入体系：DSL semantic 落 brick_narr_* 条目' +
      '（思维导图「🧱 已验证积木」区出卡）。防编造纪律同契约提取：' +
      'LLM 结论只进 role.reasons/notes，不产生数据事实。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      file: z.string().describe('工序涉及文件（相对路径，语义层锚点）；从 actual_apis[0] 契约投影取输入/输出针脚'),
      title: z.string().optional().describe('工序名（缺省取该文件 responsibility）'),
      detail: z.string().optional().describe('工序人话（缺省取该文件 responsibility）'),
      write: z.boolean().optional().describe('false 只预演不落盘（不写砖不登记，默认 true）'),
    },
    handler: wrapData(async (a) => {
      const feature = requireStr(a, 'feature');
      const file = requireStr(a, 'file');
      const r = narrateStep({ ...(a as unknown as NarrateStepInput), feature, file });
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'observe_log',
    title: 'Query Observe runtime logs by file',
    description:
      '查询 Observe 运行时日志（events.jsonl）。可传 files 按文件路径过滤（精确/后缀/包含匹配），' +
      '只返回命中路径的事件；不传 files 时默认只返回偏差，all=true 才全量。' +
      '适用于：LLM 按需拉取某文件/某条链路的数据流与异常，而非全量丢出。',
    inputSchema: {
      events_file: z
        .string()
        .describe('Observe 事件文件路径（events.jsonl）。由插桩/哨兵运行时产生，如 <dataHome>/.agent-io/observe/events.jsonl'),
      files: z
        .array(z.string())
        .optional()
        .describe('按文件路径过滤（可多个）。传相对路径/文件名片段均可，精确或后缀/包含匹配'),
      all: z
        .boolean()
        .optional()
        .describe('不传 files 时：true=列出全部事件；false=只列偏差（默认）'),
    },
    handler: observeLogHandler,
  },

  {
    name: 'observe_trace',
    title: 'Read recorded call-chain traces (LLM-facing replay)',
    description:
      '读探针录制的事件（events.jsonl）→ 重建完整调用树 → 采样保留，返回结构化的调用链给 LLM 分析/总结/找根因。' +
      '一针 = 一次采样的完整链路（前因后果在，每环节 probe / 入参 / 出参 / 耗时 / 缺帧），不裁剪不伪造。' +
      '不给 trace_id：返回链路清单（trace_id、帧数、根函数、信号），供挑哪针展开。' +
      '给 trace_id：展开该针完整调用树（文本树 + 结构化 JSON）。' +
      'keep=all 返回全部链路不过滤（弥合默认 judge 丢纯对话长针的偏差）。' +
      'events_path 缺省自动找探针 sink：DS_OBSERVE_EVENTS > 系统临时目录 dsh_events.jsonl > cwd/runs.jsonl。',
    inputSchema: {
      events_path: z.string().optional().describe('录制事件 JSONL 路径；缺省自动找探针 sink（dsh_events.jsonl / runs.jsonl）'),
      events_text: z.string().optional().describe('内联事件文本，优先于 events_path（调试用）'),
      keep: z.enum(['all', 'default']).optional().describe("'all'=返回全部链路；'default'=采样只留代表针（默认）"),
      trace_id: z.string().optional().describe('指定展开某条链路（trace_id）；不给则返回链路清单'),
      limit: z.number().optional().describe('最多返回几针（防上下文撑爆；给 trace_id 时忽略）'),
    },
    handler: observeTraceHandler,
  },

  {
    name: 'observe_judge',
    title: 'Judge a batch of Observe events',
    description:
      '对一批 Observe 事件执行偏差判定（语言无关）。传 events 数组（符合 TSEvent 形状：probe/fields[err/op/benign]，可含 trace_id/frame_id）。' +
      '返回逐条判定 + 汇总（total/ok/deviation）。text=true 返回人类可读报告，否则返回 JSON。' +
      '传 decls（设计声明数组）时额外执行链路契约判定（P2）：从事件 trace 三元组重建实测调用链，' +
      '声明的调用序（decl.chain）必须是某条实测链的子序列，断裂报 chain-broken（含 trace_id 与实测窗口）。' +
      '适用于：探针语言任意，统一收敛到这一处判定，不随语言复刻规则。',
    inputSchema: {
      events: z
        .array(z.record(z.string(), z.unknown()))
        .describe('要判定的事件数组（TSEvent 形状：probe 必填，fields 含 err/op/benign；链路判定需 trace_id/frame_id）'),
      decls: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe('设计声明数组（dsl.json 的 decls 形状：rule/probe/expect/constraint/chain/origin/verified_by/status）。chain=["a","b","c"] 声明调用序，触发链路判定。**不传则自动从 <project_root>/.agent/observe/dsl.json 读当前权威声明**（要对着假设的声明集判才显式传）'),
      text: z.boolean().optional().describe('true=返回人类可读报告；false=返回 JSON（默认 JSON）'),
      use_llm: z.boolean().optional().describe('true=对可疑事件做 LLM 行为级复核（默认 false 纯规则秒判）'),
      project_root: z
        .string()
        .optional()
        .describe('被分析项目的根目录。**不传则不做设计对比**（只做逐事件规则判定）—— 故意不兜底 cwd（cwd 是另一个项目）。传了就会自动读 <root>/.agent/observe/dsl.json 并给出 undesigned（哪些探针还没纳入设计）清单'),
    },
    handler: observeJudgeHandler,
  },

  {
    name: 'reconcile_chain',
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
    handler: reconcileChainHandler,
  },

  {
    name: 'observe_instrument',
    title: 'Auto-instrument or restore a TS/Go project',
    description:
      '对目标项目全自动插桩，按语言分派：Go 工程走 go-observe（go/ast 注入 camprobe.Capture，函数出/入/return/catch/IO）；' +
      'TS 工程走 TS AST（captureProbe）。均幂等（已含探针文件跳过）。' +
      'action=uninstrument|restore 一键全拔（从自动备份拷回原文件、删备份目录）。' +
      'dry_run=true 只预览不写盘。写盘前自动备份，git 可兜底。' +
      'TS 写盘后自动生成探针台账（.agent-io/observe-ledger.json）；Go 写盘后可用 --restore 还原。' +
      '契约模式：contract_probes 传探针 id 数组则只注入这些探针点；缺省=探索模式全量插桩。' +
      'Go 运行前提：被测工程须能 import `go-observe/probe`（其 go.mod 需 replace/require 指向本仓 go-observe）。',
    inputSchema: {
      action: z
        .enum(['instrument', 'uninstrument', 'restore'])
        .optional()
        .describe('instrument=插桩（默认）；uninstrument/restore=一键全拔（还原+清备份）'),
      target: z.string().describe('要插桩/还原的目标项目目录'),
      dry_run: z.boolean().optional().describe('true=只预览探针点不写盘（默认 false）'),
      contract_probes: z
        .array(z.string())
        .optional()
        .describe('契约模式探针 id 数组（如 ["store.save.writefile"]），只注入这些探针点；缺省=探索模式全量插桩'),
      project_root: z.string().optional().describe('agent-io 根（TS 探针实现所在仓库根），用于计算相对 import 路径，默认自动推断'),
      deep: z.boolean().optional().describe('仅 Go：开启 deep 级插桩（函数内变量赋值捕获），默认 false'),
      effects: z.boolean().optional().describe('仅 Go：开启 effect 级插桩（包级变量写/chan send/资源获取观测），默认 false'),
      scope: z.boolean().optional().describe('仅 TS：开启 scope 模式（try/finally 包裹函数体注入 enterScope/exitScope，录带帧调用树），默认 false（captureProbe 点探针）'),
    },
    handler: observeInstrumentHandler,
  },

  {
    name: 'recommend_observe_points',
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
      '预算按分数裁剪（max_points），被截断的如实列出——不搞环形缓冲那套事后策略。',
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

  {
    name: 'behavior_baseline',
    title: 'Behavior baseline - canary test capture/verify diff',
    description:
      '行为基线（金丝雀测试对比）：对目标 Python 函数用样例输入跑一次记录行为快照（capture），' +
      '改代码后再跑一次对比（verify）——回答"跑得对不对"（动态闸只答"跑得动不炸"，补不了行为级变化）。' +
      'action=capture：生成 harness（顶层 exec 目标文件 + 规范化 repr 返回值 + stdout 痕迹 + 函数源码快照），' +
      '存基线到 <project_dir>/.agent-io/behavior/<file>__<func>.json（baseline 参数可覆盖路径）。' +
      'action=verify：读基线 + 对当前磁盘再跑同一份 harness，逐 case 对齐对比 → verdict same/diff（进程级失败 → error）。' +
      'v1 边界：仅 Python；目标函数须自包含（顶层 exec 整文件，模块级常量/其它函数可用；跨文件 import 与 import 副作用不支持）；' +
      '返回值对比 = 规范化 repr（set 排序化）；样例输入由 cases 显式提供（capture 必需），不自动生成。',
    inputSchema: {
      action: z.enum(['capture', 'verify']).describe('capture=记录行为基线；verify=对比当前行为与基线'),
      project_dir: z.string().describe('目标项目根目录（绝对路径）'),
      file: z.string().describe('相对 project_dir 的目标文件（.py / .ts / .tsx / .js / .jsx / .mjs / .cjs）'),
      function: z.string().describe('目标顶层函数名'),
      cases: z
        .array(z.object({ name: z.string(), args: z.array(z.unknown()).optional(), kwargs: z.record(z.string(), z.unknown()).optional() }))
        .optional()
        .describe('capture 必需：金丝雀样例输入（verify 忽略，复用基线里的 cases）'),
      baseline: z.string().optional().describe('基线 JSON 路径覆盖（缺省 <project_dir>/.agent-io/behavior/<file>__<func>.json）'),
    },
    handler: wrapData(async (a) => {
      const spec = {
        project_dir: String(a.project_dir),
        file: String(a.file),
        function: String(a.function),
        cases: Array.isArray(a.cases)
          ? (a.cases as Array<Record<string, unknown>>).map((c) => ({
              name: String(c.name),
              args: Array.isArray(c.args) ? (c.args as unknown[]) : [],
              kwargs: c.kwargs as Record<string, unknown> | undefined,
            }))
          : [],
      };
      const bp = a.baseline ? String(a.baseline) : baselinePathFor(String(a.project_dir), String(a.file), String(a.function));

      if (a.action === 'capture') {
        const b = captureBaseline(spec, bp);
        const lines = [
          `行为基线已记录 · ${b.spec.function} @ ${b.spec.file}`,
          `基线：${b.baseline_path}（文件哈希 ${b.file_hash}）`,
          `${b.results.length} 个 case：`,
          ...b.results.map((r) => `  ${r.case} = ${r.ok ? r.ret : `✗ ${r.error}`}`),
          '',
          '函数源码快照：',
          ...(b.source || '(unavailable)').split('\n').map((l) => `  ${l}`),
        ];
        return { message: lines.join('\n'), data: b };
      }

      const v = verifyBaseline(spec, bp);
      const lines = [
        `行为基线对比 · ${v.diff.verdict === 'same' ? '✔ 一致' : v.diff.verdict === 'diff' ? '✗ 有差异' : '⚠ 无法对比'}`,
        v.diff.message,
        `基线文件哈希 ${v.baseline.file_hash} → 当前 ${v.run.file_hash}`,
        '',
      ];
      for (const d of v.diff.details) {
        if (d.status === 'same') {
          lines.push(`  = ${d.case}  same`);
          continue;
        }
        lines.push(`  ! ${d.case}`);
        if (d.case === '(stdout)') {
          lines.push(`    改前 stdout: ${JSON.stringify(d.before)}`);
          lines.push(`    改后 stdout: ${JSON.stringify(d.after)}`);
        } else {
          if (d.before !== undefined) lines.push(`    改前 ret: ${d.before}`);
          if (d.after !== undefined) lines.push(`    改后 ret: ${d.after}`);
          if (d.before_error !== undefined) lines.push(`    改前 error: ${d.before_error}`);
          if (d.after_error !== undefined) lines.push(`    改后 error: ${d.after_error}`);
        }
      }
      return { message: lines.join('\n'), data: v };
    }),
  },

  {
    name: 'run_tests',
    title: 'Run tests and return exit code plus output tail',
    description:
      '跑目标项目的测试（走 package.json 的 scripts.test，以退出码判成败，退出码 0 ⇒ 成功）。' +
      'filter 传单个测试文件/名称 → `npm test -- <filter>` 定向回归；省略跑全量（耗时，适合提交前检查）。' +
      '失败时返回 exitCode + stdout/stderr 的尾部（截断，仅尾部），不解析任何框架私有格式，通用适配 vitest/jest/node:test 等。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（默认 cwd）'),
      filter: z.string().optional().describe('测试文件/名称过滤（如 tests/tools/find_references.test.ts），经 npm test -- 透传'),
      timeout_ms: z.number().optional().describe('超时毫秒（默认 120000）'),
    },
    handler: wrapData(async (a) => {
      // 跑测试前置：检本服务自身 dist 是否 stale（改 src 忘 build → 提示先重建，防测旧产物）
      const staleHint = (() => {
        try {
          // dist/src/server_registry.js → 向上 3 级 = 项目根
          const stale = checkStaleBuild(path.resolve(fileURLToPath(import.meta.url), '..', '..', '..'));
          return stale.stale ? formatStaleText(stale) : null;
        } catch {
          return null; // 非本项目根（如外部项目）→ 静默跳过
        }
      })();
      const r = runTests({
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        filter: typeof a.filter === 'string' && a.filter ? a.filter : undefined,
        timeoutMs: typeof a.timeout_ms === 'number' ? a.timeout_ms : undefined,
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
    name: 'feature_line',
    title: '功能线：每个功能搭一条主链（功能 → 入口函数 → 依次调用节点），供沿线单步运行/投屏',
    description:
      '把"这个功能是怎么一步步走的"搭成一条可读主链：对每个功能（DSL feature）挑一个入口函数' +
      '（功能内不被本功能函数调用的根，否则按名启发 main/run/handle 等），再沿功能内调用边贪心走成有序链。' +
      'target 留空 → 返回该项目所有功能的 入口+链长 总览；给 target=功能名 → 返回该功能 entry + chain（每个节点含 函数名/签名/文件/行/所属功能/语义注释 doc）。' +
      '纯推导、不执行：要沿线跑入/出参请用 trace-exec；要投大屏点位由前端消费本条 line。只读，不改任何存储。',
    inputSchema: {
      feature: z.string().describe('feature 名（定位该项目的 cache.db + DSL feature_tree，给函数打功能标记）'),
      project_dir: z.string().optional().describe('项目根目录（定位 cache.db；缺省按 feature 的导入缓存）'),
      target: z.string().optional().describe('指定功能名；缺省返回所有功能 入口+链长 总览'),
      max_steps: z.number().optional().describe('主链最大步数（默认 24）'),
    },
    handler: wrapData(async (a) => {
      const feature = requireStr(a, 'feature');
      const sourceRoot = a.project_dir ? String(a.project_dir) : undefined;
      const opts = { target: a.target ? String(a.target) : undefined, maxSteps: typeof a.max_steps === 'number' ? a.max_steps : undefined };
      const r = getFeatureLine(feature, sourceRoot, opts);
      if (!r.ok) return { message: `功能线不可用：${r.note ?? '未知'}`, data: r };
      if (r.features) {
        const parts = [`功能线总览（${r.features.length} 个功能）：`, ...r.features.map((f) => `  - ${f.feature}：入口 ${f.entry}，主链 ${f.steps} 步`)];
        if (r.note) parts.push(`  备注：${r.note}`);
        return { message: parts.join('\n'), data: { ok: true, features: r.features } };
      }
      const line = r.line!;
      const parts = [
        `功能线「${line.feature}」：入口=${line.entry?.name ?? '—'}，主链 ${line.chain.length} 步：`,
        ...line.chain.map((n, i) => `  ${i + 1}. ${n.name}（${n.file}:${n.line}）${n.doc ? ' — ' + n.doc : ''}`),
      ];
      if (r.note) parts.push(`  备注：${r.note}`);
      return { message: parts.join('\n'), data: { ok: true, feature: line.feature, line } };
    }),
  },
];
