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
import { z } from 'zod';
// ★ T179：**仓根**用仓里已有的『向上找』（git 根 → 最近 manifest）—— 别手算 '..' 级数。
import { resolveProjectRoot } from '../../infrastructure/analysis/project_root/index.js';
import { wrap, wrapData, requireStr } from '../plumbing.js';
import path from 'node:path';
import { rebuildChains } from '../../infrastructure/analysis/observe/chain.js';
import { getFeatureLine } from './capture/feature_line.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import { memoryObserveHandler, memoryTargetsHandler } from './capture/memory_observe.js';
import type { MemoryObserveInput } from './capture/memory_observe.js';
import { recommendObservePoints } from './capture/observe_points.js';
import { reconcileEffects } from './reconcile/reconcile_effects.js';
import type { ReconcileEffectsInput } from './reconcile/reconcile_effects.js';
import { runTests } from './runtime/run_tests.js';
import { checkStaleBuild, formatStaleText } from './runtime/stale_check.js';
import { observeInstrumentHandler, observeJudgeHandler, observeLogHandler, observeTraceHandler, reconcileChainHandler } from './handlers.js';
// ★ 2026-10-28：observe_proposals 的执行核（从 meta/index.ts 抽出一份实现，注册已并进本入口）
import { observeProposalsHandler } from '../meta/proposals/handler.js';
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
      const project_dir = requireStr(a, 'project_dir');
      const feature = requireStr(a, 'feature');
      const r = await reconcileEffects({ ...(a as unknown as ReconcileEffectsInput), project_dir, feature });
      return { message: r.message, data: r };
    }),
  },

  {
    name: 'observe',
    title: 'Observe 单入口（action=log | trace | judge）',
    description:
      '★ 观察线**只读三合一**的单入口（2026-10-28 合并试点）：' +
      '\n· `action=log`（默认）查运行时事件 events.jsonl，可按文件过滤或全量；' +
      '\n· `action=trace` 重建完整调用树并采样，返回结构化调用链（给 `trace_id` 展开某一针）；' +
      '\n· `action=judge` 对一批事件做偏差判定（可带 `decls` 做链路契约判定）。' +
      '\n\n★ **为什么能合**：三者**输入事实相同**（events.jsonl / 事件数组）、**判断性质相同**（只读、不写盘）、' +
      '**前置条件相同**（都不需要设计册）。' +
      '\n★ **为什么不并另两个**：`observe_instrument`（插桩/还原）与 `observe_proposals`（提案四层门）各有自己的 ' +
      '`action` 命名空间与写盘副作用 —— 合并会撞命名空间，也会把写能力混进只读入口。' +
      '\n\n参数按 action 取用（其余字段忽略）：log → `events_file` / `files` / `all`；' +
      'trace → `events_path` / `events_text` / `keep` / `trace_id` / `limit`；' +
      'judge → `events` / `decls` / `text` / `use_llm` / `project_root`。',
    inputSchema: {
      action: z
        .enum(['log', 'trace', 'judge', 'instrument', 'uninstrument', 'restore', 'ledger', 'proposals'])
        .describe(
          'log=查事件（默认）| trace=重建调用链 | judge=逐事件偏差判定 | instrument=插桩 | uninstrument/restore=一键全拔 | ledger=只看探针台账 | proposals=observe 提案（配 op=list/show/approve/reject）',
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
      // ── proposals（与 review_changes 同一套规矩：确认人是下一个接手的 Agent）──
      id: z.string().optional().describe('[proposals] show/approve/reject 用：提案 id'),
      note: z.string().optional().describe('[proposals] reject 用：驳回理由'),
      // ── judge ──
      events: z.array(z.record(z.string(), z.unknown())).optional().describe('[judge] 要判定的事件数组（TSEvent 形状）'),
      decls: z.array(z.record(z.string(), z.unknown())).optional().describe('[judge] 设计声明数组（可做链路契约判定）'),
      text: z.boolean().optional().describe('[judge] true=人类可读报告；false=JSON（默认）'),
      use_llm: z.boolean().optional().describe('[judge] true=对可疑事件做 LLM 复核（默认 false）'),
      project_root: z.string().optional().describe('[judge] 被分析项目根（不传则不做设计对比）'),
    },
    // ★ 拆注册不拆执行核：三个 handler 原样保留，只由一个入口按 action 分派
    handler: ((a: unknown) => {
      const args = a as Record<string, unknown>;
      const action = String(args.action ?? 'log');
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
