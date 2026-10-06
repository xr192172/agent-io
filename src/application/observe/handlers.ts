/**
 * observe 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import path from 'node:path';
import { wrap, wrapData } from '.././plumbing.js';
import { rebuildChains } from '../../infrastructure/analysis/observe/chain.js';
import { TSComparator, renderTSDiffReport } from '../../infrastructure/analysis/observe/contract.js';
import type { TSDLDecl, TSDiffReport } from '../../infrastructure/analysis/observe/contract.js';
import { judgeEvents, judgeEventsWithLLM, normalizeEvents, renderJudgeReport } from '../../infrastructure/analysis/observe/judge_service.js';
import type { ObserveRuleCtx } from '../../infrastructure/analysis/observe/judge.js';
import { knownSpreadIndex } from '../../infrastructure/analysis/observe/ledger_fold.js';
import {
  observeLangs,
  renderInstrumentReport,
  renderUninstrumentReport,
} from '../../infrastructure/analysis/observe/observe_langs.js';
// ★ 2026-10-06（T15）：探针台账的读取与摘要 —— 原先是 CLI-only 的 `instrument_cli --ledger`。
import { loadProbeLedger, ledgerSummary } from '../../infrastructure/analysis/observe/instrument.js';
import { DesignDSLStore, defaultDSLDir } from '../../infrastructure/analysis/observe/dsl_store.js';
import { queryObserveLog } from '../../infrastructure/analysis/observe/log_query.js';
import { getDSLByView, getLiveDir, requireProjectRoot } from '../../infrastructure/storage.js';
import { observeTrace } from '.././observe/capture/observe_trace.js';
import { reconcileChain } from '.././observe/reconcile/reconcile_chain.js';
import type { ReconcileChainInput } from '.././observe/reconcile/reconcile_chain.js';

/** observe_instrument：对目标项目全自动插桩 / 还原（复用 instrumentProject/restoreInstrumented）。
 * ★ wrapData：handler 回 `data`（results / ledger / 还原清单），wrap 会静默丢弃。 */
export const observeInstrumentHandler = wrapData(async (a) => {
  const target = a.target as string | undefined;
  if (!target) {
    throw new Error('observe_instrument 需要 target 参数：传要插桩的项目目录。');
  }

  // ★★ 2026-10-06（T15）：`action=ledger` —— 查看探针台账（一次插桩的全部探针点 + 统计）。
  //   为什么补它：本仓盘点「真 CLI 共 11 个」时，`instrument_cli --ledger` 是那个 CLI **唯一**
  //   没有 MCP 对应的一项（action 枚举原先只有 `instrument|uninstrument|restore`）
  //   ⇒ 直接删那个 CLI 会**丢掉一个能力**（它不是"多余的投影"）。
  //   本处接的是**只读**分支，复用 CLI 的同一实现（`loadProbeLedger` / `ledgerSummary`），
  //   不碰任何写盘/备份路径。
  //   ★ 输出形状：`message` = 人读台账（与 CLI 逐行一致）；`data` = `{ root, ledger, summary }`。
  //     `ledger: null` = 未找到台账 ⇒ **不抛错**（"没插过桩 / 已全拔"是正常状态，不是失败）。
  if (a.action === 'ledger') {
    const ledgerRoot = path.resolve(target);
    const ledger = loadProbeLedger(ledgerRoot);
    if (!ledger) {
      return {
        message: `=== Observe 探针台账 [${ledgerRoot}] ===\n未找到台账（可能从未插桩，或已一键全拔清理）。`,
        data: { root: ledgerRoot, ledger: null, summary: null },
      };
    }
    const summary = ledgerSummary(ledger);
    const lines = [
      `=== Observe 探针台账 [${ledgerRoot}] ===`,
      `插桩时间：${ledger.instrumentedAt}`,
      `统计：${summary}`,
      '── 明细（探针点）──',
      ...ledger.sites.map(
        (s) => `  ${path.relative(ledgerRoot, s.file) || s.file} L${s.line} [${s.kind}/${s.level}] ${s.injected.trim().split('\n')[0]}`,
      ),
    ];
    return { message: lines.join('\n'), data: { root: ledgerRoot, ledger, summary } };
  }

  const unintrument = a.action === 'uninstrument' || a.action === 'restore';
  const dryRun = a.dry_run === true || a.dry_run === 'true' || a.dry_run === '1';
  const projectRoot = a.project_root as string | undefined;
  // 契约模式：contract_probes 非空数组时只注入声明的探针点；缺省/空数组 → 探索模式全量插桩
  const contractProbes = Array.isArray(a.contract_probes) && a.contract_probes.length > 0
    ? (a.contract_probes as string[])
    : undefined;

  // ★ 2026-10-05：语言分派从**硬编码的 `if (isGoProject(target))`** 改成**语言包注册表**
  //   （`infrastructure/analysis/observe/observe_langs.ts`），本 handler 退化成**薄壳**：挑包 → 调包 → 一份渲染。
  //   原先这里是两段 ~35 行、**结构逐字相同**的报告渲染（Go 分支 / TS 分支），加第三门语言就得再抄一遍。
  //   挑包判据照 `refactor_langs`：`manifest` 优先（`package.json` vs `go.mod`），判不出再退到「有该语言源文件」。
  const pack = observeLangs.pick(target);
  if (!pack) {
    const known = observeLangs.list().map((p) => `${p.lang}(${p.label})`).join('、');
    return {
      message:
        `未找到匹配 \`${target}\` 的观察语言包 —— 目标项目里既没有已登记的 manifest，也没有已知语言的源文件。\n` +
        `  已注册：${known}\n` +
        `  ⇒ 要支持新语言：在 \`infrastructure/analysis/observe/observe_langs.ts\` 注册一个 \`ObserveLangPack\`。`,
      data: [],
    };
  }

  try {
    if (unintrument) {
      const rep = await pack.uninstrument(target);
      return { message: renderUninstrumentReport(rep), data: rep };
    }
    const rep = await pack.instrument(target, {
      dryRun,
      projectRoot,
      contractProbes,
      scope: a.scope === true,
      deep: a.deep === true,
      effects: a.effects === true,
    });
    return {
      message: renderInstrumentReport(rep, { target, contractProbes }).join('\n'),
      data: { report: rep, ledger: rep.ledger?.raw },
    };
  } catch (e) {
    // ★ 包自己已经**响亮失败**过了（Go 缺工具链 / 目录不存在）⇒ 这里只补一句是哪个语言包，不吞、不改写。
    return { message: `Observe 插桩失败（语言包 ${pack.lang}）：${(e as Error).message}`, data: {} };
  }
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

  // ★ 2026-10-06（P5）：**decls 的计算从"判定之后"上移到"判定之前"**。
  //   原因：逐事件判定现在要扣掉"已被设计承认的耦合"（known-spread 声明，见 `judge.ObserveRuleCtx`），
  //   而那份"已承认耦合"表只能从 decls 折叠出来。原先顺序是"先判定、后算 decls"
  //   ⇒ 扣减**永远拿不到输入**（功能形同不存在）。顺序换过后，下面 `report` 一并带上 `judgeCtx`。

  // ★ 2026-10-05：设计对比的 decls **默认从项目自己的 dsl.json 读**，不必由调用方自带。
  //
  //   为什么加这个（这是"LLM 想知道哪里没纳入设计"这条路能通的前提）：
  //     此前只有 Go 的 `observe-dsl show` 能读 `dsl.json`，**TS 侧没有任何工具读它**
  //     （`DesignDSLStore` 只被 `run_loop` / `approve_gated` 用，没暴露给任何 handler）
  //     ⇒ 而 `decls` 是**入参** ⇒ LLM 要问"哪些探针还没被设计覆盖"必须**先知道 DSL 里有什么**，
  //       那时它无从得知 ⇒ 这条路是**断的**（P4 收尾时发现，此前误判为"搬过来就等价"）。
  //
  //   判据（照 `requireProjectRoot` 的既定纪律 `storage.ts:92-100`）：
  //     · **显式 `project_root`**，**故意不兜底到 cwd** —— cwd 是"另一个项目"，不是"更弱的答案"（原文）
  //     · 显式传 `decls` ⇒ 用它（要对着假设的声明集判，就显式传）
  //     · 两者都没给 ⇒ **保持逐事件判定**，但**如实说明**为什么没做设计对比 + 怎么开启
  const explicitDecls = Array.isArray(a.decls) && a.decls.length > 0 ? (a.decls as TSDLDecl[]) : undefined;
  let decls = explicitDecls;
  let declsNote = '';
  if (!decls) {
    const root = typeof a.project_root === 'string' && a.project_root.trim() ? a.project_root.trim() : '';
    if (!root) {
      declsNote =
        '\n⚠ 未做设计对比：没传 decls 也没有 project_root。要对比"哪些探针还没纳入设计"，' +
        '传 project_root（会自动读 <root>/.agent/observe/dsl.json）或直接传 decls。' +
        '（本轮只做了逐事件规则判定。）';
    } else {
      const loaded = new DesignDSLStore(defaultDSLDir(root)).load();
      if (loaded && loaded.decls.length > 0) {
        decls = loaded.decls;
        declsNote = `\ndecls 来源：<${root}>/.agent/observe/dsl.json（v${loaded.version}，${loaded.decls.length} 条声明）`;
      } else {
        declsNote =
          `\n⚠ 未做设计对比：<${root}>/.agent/observe/dsl.json ${loaded ? '是空的' : '不存在'}。` +
          '（本轮只做了逐事件规则判定。要建声明先跑一次 loop，它会播种 v1 种子。）';
      }
    }
  } else {
    declsNote = '\ndecls 来源：调用方显式传入';
  }

  // 声明侧上下文：`decls` 为 undefined（既没传 decls、也没给 project_root）⇒ **不给 ctx**
  // ⇒ 规则按原样判、并在文案里**明说"未扣已承认耦合"**（不静默当作"无已承认耦合"处理）。
  const judgeCtx: ObserveRuleCtx | undefined = decls
    ? { acknowledgedSpreads: knownSpreadIndex(decls) }
    : undefined;

  const report = useLlm ? await judgeEventsWithLLM(norm, true, judgeCtx) : judgeEvents(norm, judgeCtx);

  // P2 链路契约：decls 可得时重建实测链 + Comparator 全量对比（探针级 + 链路级）
  let diff: TSDiffReport | undefined;
  let chainsNote = '';
  if (decls && decls.length > 0) {
    const { chains, dropped } = rebuildChains(norm);
    const comp = new TSComparator();
    diff = comp.compare(
      { version: 1, updated_at: new Date().toISOString(), decls },
      TSComparator.aggregate(norm),
      chains,
    );
    chainsNote = `\n链路重建: ${chains.length} 条链${dropped > 0 ? `（超预算丢弃 ${dropped} 条）` : ''}`;
  }

  const merged = diff ? { ...report, diff, decls_source: declsNote.trim() } : { ...report, decls_source: declsNote.trim() };
  const text = a.text === true || a.text === '1'
    ? renderJudgeReport(report) + (diff ? `\n\n${renderTSDiffReport(diff)}${chainsNote}` : '') + declsNote
    : JSON.stringify(merged);
  return { message: text, data: merged };
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
    // ★ 2026-10-06（T41 ②）：**"文件不存在"与"存在但无匹配"必须分开说** ——
    //   原先两者都打「（无匹配事件）」⇒ 会把"传错路径"伪装成"跑过了、没内容"。
    ...(r.missing
      ? [`  ⚠ 事件文件不存在：${r.eventsPath}（★ 这不是"无匹配事件"—— 这个文件压根不在；请检查 events_file）`]
      : r.entries.length === 0
        ? ['  （无匹配事件）']
        : []),
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
