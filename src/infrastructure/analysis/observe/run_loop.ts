/**
 * run_loop —— 观测闭环编排（2026-10-05，P4 步骤 6）
 *
 * 搬迁自 `observe-lang-go/probe/loop.go`（254 行）。这是 observe 合一化的**最后一块**：
 * 搬完它，TS 侧就能独立完成"事件 → 偏差 → 提案"闭环，
 * Go 的 9 条 DSL 子命令（show/history/rollback/seed/propose/proposals/approve/reject/loop）全部可删。
 *
 * ## 它做什么（照搬 Go `:78-242` 的七步）
 *   1. 读观测事件         2. 聚合为事实画像        3. 加载权威设计 DSL（不存在则播种 v1）
 *   4. 对比出偏差         4.2 台账折叠（方向 D）   4.5 可选 LLM 行为级复核
 *   5. 触发判定（三维度任一显著即触发）
 *   6. 累犯波及模式 → `design:impact-known-spread` 提案（方向 D 核心回流）
 *
 * ★ 2026-10-05：**6a「未声明探针自动补契约」已删**（连同只服务它的 `buildProbeFacts` /
 *   `expectFromObs` / `sanitizeRuleSuffix`）。三条理由：
 *   ① **它起草的东西按我们自己的门就该被拒**：6a 生成的 expect 形如
 *      「被观测到 N 次（…观测事实…），需以契约锁定其行为」—— 只描述**过去**、不含任何**可违反的条件**；
 *      而 L2 复核门（判据①声明自洽性）第 1 条问的正是"expect 是否给出了可判定的条件"
 *      ⇒ 6a 批量生产的正是门要拒的东西，**修活它等于造一批注定被冻结的提案**。
 *   ② **它把观测抄成契约，是复读不是设计**。真正的起草路径是 `ApproveGated`
 *      （LLM 复核 → 人工 approve），那条路已经在。
 *   ③ 它在真实运行下**从未工作过**（种子的全局声明让 `undesigned` 恒为 0），
 *      且 Go 的测试为了测它必须**绕开真实种子**（`loop_test.go:20` / `p2_test.go:123` 注释自陈）。
 *   ⇒ 「哪些探针缺声明」这个**发现**能力没丢：由 `compare()` 的 `undesigned` 清单承担，且已修好
 *     （见 `contract.ts` pass 2）。LLM 通过 `observe_judge` 读它 → 自己起草 → 走审批门。
 *
 * ## 与 Go 的三处**有意分歧**（均已核实）
 *
 * ① **`SeedDefault()` 的副作用：保留，且已定论**（2026-10-06 结掉此前挂着的"未决"）
 *    Go `:99` 在读 DSL 前调 `SeedDefault()`，而 `dsl.json` 不存在时它会**新建文件 + 写一条 history**。
 *    ⚠ 这与 `loop.go:8` 自己的头注「**绝不触碰权威 dsl.json**」**看着打架，但两句可以同时为真** ——
 *      歧义出在措辞：`seedDefault()` 的实现是 `if (existsSync(path)) return false`（`dsl_store.ts`）
 *      ⇒ 它**只写"尚未存在的起点"，绝不改已存在的权威**。所以那句应读作
 *      「**不改已存在的**权威」；播种管的是"你还没建，我先给你一个起点"。
 *
 *    ★★ **为什么不摘掉它**（这是本项定论的关键）：`dsl.json` 的**唯一 bootstrap 路径就是这一处**
 *      ——`seedDefault()` 全仓唯一调用者即本行；而 `approve` 需要先有提案、提案又由 loop 产
 *      ⇒ 摘掉 = **全新项目的 observe 闭环永远起不来**（死锁：loop 需要 `dsl.json`，
 *        而它只能由 loop 创建）。那不是"净化"，是**砍掉初始化**。
 *
 *    ★ 真正该修的是**副作用没有出口**：`seedDefault()` 有 `boolean` 返回值，而先前这里**丢弃了它**
 *      ⇒ "我替你建了 v1 种子"这件事**没有任何出口**（静默）。现已接住并记进 `LoopResult.seeded`，
 *      由 daemon 打一行日志（`daemon.scheduleLoopTrigger`）。
 *
 * ② **LLM 复核默认走"诚实降级"，且不再依赖外部 HTTP 服务**
 *    Go `:126-131`：`NewJudgeClient("")` ⇒ 未设 `OBSERVE_JUDGE_URL` 时 `IsRemote()` 为 false
 *    ⇒ `LLMDegraded = true`（**这正是本仓反复出现的假绿灯**）。配置了则 POST 到
 *    `serve.ts:2744` 的判定服务，由**服务侧**调 LLM。
 *    ⇒ TS 侧 `useLlm` 时**直接在本地**调 LLM（`judge_service.judgeEventsWithLLM`），
 *    **不再绕一圈 HTTP 回到自己** ⇒ 少一跳、少一个 env 依赖、也不会"配了服务却静默降级"。
 *    失败仍**诚实标 `llmDegraded`**，不阻断（照搬 Go 的降级语义）。
 *
 * ③ **台账路径吃项目根，不吃裸路径**
 *    Go 的 `--ledger` 默认值在 `dsl_cli.go:450` 拼成 `filepath.Join(dataDir,"..","..",".agent-io","impact","ledger.json")`
 *    —— 从 `.agent/observe` 上溯两级、且是**裸字面量**。本实现改由
 *    `analyzeLedger(projectRoot)` 内部走 `impactLedgerFile()`（P4 步骤 2 已收拢）⇒ **该字面量消失**。
 *
 */

import fs from 'node:fs';
import { TSComparator, type TSDLDecl, type TSDesignDSLDoc, type TSProbeObs, type TSDiffReport } from './contract.js';
import { loadTSEvents } from './probe.js';
import { DesignDSLStore } from './dsl_store.js';
import { ProposalStore, PROPOSAL_PENDING, type Proposal } from './proposal_store.js';
import { analyzeLedger, knownSpreadDecl, knownSpreadIndex, parseKnownSpread, sameSpreadSet, type LedgerStats } from './ledger_fold.js';
import { judgeEventsWithLLM, type JudgeEntryWithLLM } from './judge_service.js';
import { OBSERVE_RULE_IDS } from './judge.js';

export interface LoopOptions {
  /** 事件偏差率阈值（violated / eventCount），缺省 0.1 */
  minDeviationRate?: number;
  /**
   * 未声明探针数阈值，缺省 1。
   * ★ 它现在**只参与触发判定，不产出提案**（6a 已删）⇒ 触发了也可能这轮 0 提案（走 loop-done）。
   *   保留它的理由："设计不完整"本身是值得让人看一眼的信号，不该因为不再自动补契约就一并忽略。
   */
  minUndesigned?: number;
  /** 台账累犯门槛，缺省 2 */
  minRepeatSpreads?: number;
  /** 是否做 LLM 行为级复核（默认 false） */
  useLlm?: boolean;
}

export interface LoopResult {
  report: TSDiffReport;
  /**
   * 本轮**真的播种了** v1 种子（`dsl.json` 此前不存在）。
   *
   * ★ 为什么要有这个字段：`seedDefault()` 的返回值先前被**丢弃** ⇒ 「我替这个项目建了设计契约的
   *   起点」这件事完全不可见（静默）—— 而它是一次性的、影响后续所有判定的动作。
   *   `undefined` / `false` = 没有播种（文件已存在，`seedDefault()` 幂等跳过）。
   * 消费者：`daemon.scheduleLoopTrigger`（打一行日志，让人/agent 看得见）。
   */
  seeded?: boolean;
  ledger?: LedgerStats;
  triggered: boolean;
  skipReason?: string;
  proposals: Proposal[];
  llmRun: boolean;
  llmDegraded: boolean;
  llmVerdicts: { result: 'ok' | 'deviation'; rule: string; reason: string }[];
}

/** 阈值缺省（照搬 Go `:41-52`：0.1 / 1 / 2）。 */
function withDefaults(o: LoopOptions): Required<Omit<LoopOptions, 'useLlm'>> & { useLlm: boolean } {
  return {
    minDeviationRate: o.minDeviationRate ?? 0.1,
    minUndesigned: o.minUndesigned ?? 1,
    minRepeatSpreads: o.minRepeatSpreads ?? 2,
    useLlm: o.useLlm ?? false,
  };
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

/**
 * 跑一轮观测闭环。
 *
 * @param eventsPath 观测事件 JSONL 路径
 * @param dataDir    设计 DSL 仓库目录（`.agent/observe`）
 * @param projectRoot 项目根（用于定位 impact ledger；**不传则跳过台账折叠**）
 */
export async function runLoop(
  eventsPath: string,
  dataDir: string,
  projectRoot?: string,
  opts: LoopOptions = {},
): Promise<LoopResult> {
  const opt = withDefaults(opts);
  const res: LoopResult = {
    report: { generated_at: '', event_count: 0, deviations: [], unobserved: 0, violated: 0, undesigned: 0, chain_broken: 0 },
    triggered: false,
    proposals: [],
    llmRun: false,
    llmDegraded: false,
    llmVerdicts: [],
  };

  // ── 1. 读观测事件 ──
  if (!fs.existsSync(eventsPath)) {
    // 照搬 Go `:112-118` 的"可选输入不阻断"精神：事件流不存在时不报错，只是不演进
    res.skipReason = `尚无观测事件流（${eventsPath} 不存在），本轮不演进`;
    return res;
  }
  const { events, skipped } = loadTSEvents(eventsPath);

  // ── 2. 聚合为事实画像 ──
  // ★ skipped = 坏行数（照搬：不因坏行阻断，但也不隐藏）—— 记进 skipReason 让人看得见
  const actual = TSComparator.aggregate(events);
  if (skipped > 0) res.skipReason = `⚠ 事件流有 ${skipped} 行无法解析，已跳过（不阻断本轮）`;

  // ── 3. 加载权威设计 DSL（不存在则播种 v1）──
  // ★ **接住返回值**：不再丢弃"这次真的播种了"这个事实（见头注 ① 与 `LoopResult.seeded`）。
  const store = new DesignDSLStore(dataDir);
  if (store.seedDefault()) res.seeded = true;
  const design: TSDesignDSLDoc = store.loadOrThrow();

  // ── 4. 对比出偏差 ──
  res.report = new TSComparator().compare(design, actual);

  // ── 4.2 台账折叠（方向 D）──
  if (projectRoot) {
    res.ledger = analyzeLedger(projectRoot, opt.minRepeatSpreads);
  }

  // ── 4.5 可选 LLM 行为级复核（② 本地直调，不再绕 HTTP 回自己）──
  if (opt.useLlm) {
    res.llmRun = true;
    try {
      // ★ 传声明侧上下文（P5）：loop 握有权威 DSL ⇒ 逐事件判定也能扣掉"已承认耦合"，
      //   否则 loop 会对着已承认的耦合反复报「计划外扩散」。
      const r = await judgeEventsWithLLM(events, true, { acknowledgedSpreads: knownSpreadIndex(design.decls) });
      // entries 的静态类型是 JudgeEntry（无 llm 字段），但开了 useLlm 时运行期是 WithLLM
      for (const e of r.entries as JudgeEntryWithLLM[]) {
        if (e.llm) res.llmVerdicts.push(e.llm);
      }
    } catch {
      res.llmDegraded = true; // 失败降级：保留规则判定，不阻断（照搬 Go `:132-134`）
    }
  }

  // ── 5. 触发判定（三维度任一显著即触发）──
  const rate = res.report.event_count > 0 ? res.report.violated / res.report.event_count : 0;
  let ledgerRate = 0;
  let ledgerSignificant = false;
  if (res.ledger && res.ledger.consumed > 0) {
    ledgerRate = res.ledger.deviationRate;
    ledgerSignificant = ledgerRate >= opt.minDeviationRate || res.ledger.repeatSpreads.length > 0;
  }
  if (res.report.undesigned < opt.minUndesigned && rate < opt.minDeviationRate && !ledgerSignificant) {
    res.triggered = false;
    let skip =
      `偏差低于触发阈值（violated 事件占比 ${(rate * 100).toFixed(1)}% < ${(opt.minDeviationRate * 100).toFixed(0)}%` +
      ` · 未声明探针 ${res.report.undesigned} < ${opt.minUndesigned}`;
    if (res.ledger) {
      skip +=
        ` · 台账偏差率 ${(ledgerRate * 100).toFixed(1)}%（${res.ledger.violated}/${res.ledger.consumed}）` +
        ` · 累犯模式 ${res.ledger.repeatSpreads.length}`;
    }
    res.skipReason = `${skip}），本轮不演进`;
    return res;
  }
  res.triggered = true;

  const ps = new ProposalStore(dataDir);

  // ── 6b. 累犯波及模式 → design:impact-known-spread 提案（方向 D 核心回流）──
  if (res.ledger && res.ledger.repeatSpreads.length > 0) {
    const approvedBySrc = new Map<string, NonNullable<ReturnType<typeof parseKnownSpread>>>();
    for (const d of design.decls) {
      const c = parseKnownSpread(d);
      if (c) approvedBySrc.set(c.source, c); // 同源多条时后者覆盖（照搬 Go）
    }
    const pendingSrc = new Set<string>();
    for (const p of ps.list()) {
      if (p.status !== PROPOSAL_PENDING) continue;
      for (const d of p.decls) {
        const c = parseKnownSpread(d);
        if (c) pendingSrc.add(c.source);
      }
    }
    for (const pat of res.ledger.repeatSpreads) {
      const existed = approvedBySrc.get(pat.source);
      if (existed && sameSpreadSet(existed, pat)) continue; // 设计已承认该耦合（同波及面）
      if (pendingSrc.has(pat.source)) continue; // 已有 pending 提案待审批，不堆叠
      res.proposals.push(
        ps.create(
          [knownSpreadDecl(pat)],
          `loop: 改动 ${pat.source} 连续 ${pat.violations} 次波及预告面外 ${pat.files.length} 个文件，把该耦合回流设计契约`,
          'loop',
        ),
      );
    }
  }
  return res;
}

/** 已注册的 rule id（供调用方核对，不重复定义）。 */
export { OBSERVE_RULE_IDS };
