/**
 * run_loop —— 观测闭环编排（2026-10-05，P4 步骤 6）
 *
 * 搬迁自 `go-observe/probe/loop.go`（254 行）。这是 observe 合一化的**最后一块**：
 * 搬完它，TS 侧就能独立完成"事件 → 偏差 → 提案"闭环，
 * Go 的 9 条 DSL 子命令（show/history/rollback/seed/propose/proposals/approve/reject/loop）全部可删。
 *
 * ## 它做什么（照搬 Go `:78-242` 的七步）
 *   1. 读观测事件         2. 聚合为事实画像        3. 加载权威设计 DSL（不存在则播种 v1）
 *   4. 对比出偏差         4.2 台账折叠（方向 D）   4.5 可选 LLM 行为级复核
 *   5. 触发判定（三维度任一显著即触发）             6a. 未声明探针 → 补契约提案
 *   6b. 累犯波及模式 → `design:impact-known-spread` 提案（方向 D 核心回流）
 *
 * ## 与 Go 的三处**有意分歧**（均已核实）
 *
 * ① **`SeedDefault()` 的副作用被保留，但如实标注**
 *    Go `:99` 在读 DSL 前调 `SeedDefault()`，而 `dsl.json` 不存在时它会**新建文件 + 写一条 history**。
 *    ⚠ 这与 `loop.go:8` 自己的头注「**绝不触碰权威 dsl.json**」**自相矛盾**。
 *    本实现**照搬这个播种**（它是 load-bearing：不播种则 `load()` 失败、整个 loop 报错），
 *    但把副作用写明在此，**不静默**。是否该把播种从 loop 里摘出去，属独立议题（未决）。
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
 * ## 照搬的三个辅助函数
 *   · `buildProbeFacts`（Go `aggregator.go:91-105`）—— ★ TS 的 `TSProbeObs` **没有 `facts` 字段**
 *     （P4 步骤 2 侦察已指出），而 `expectFromObs` 依赖它 ⇒ 本文件补上，否则生成的 expect 会少信息
 *   · `expectFromObs`（Go `:254-260`）—— facts 用 `；` 连接
 *   · `sanitizeRuleSuffix`（Go `:263-276`）—— 逐 rune：`.` `/` `\` 空格 → `-`，
 *     非 `[a-zA-Z0-9-]` → `-`
 */

import fs from 'node:fs';
import { TSComparator, type TSDLDecl, type TSDesignDSLDoc, type TSProbeObs, type TSDiffReport } from './contract.js';
import { loadTSEvents } from './probe.js';
import { DesignDSLStore } from './dsl_store.js';
import { ProposalStore, PROPOSAL_PENDING, type Proposal } from './proposal_store.js';
import { analyzeLedger, knownSpreadDecl, parseKnownSpread, sameSpreadSet, type LedgerStats } from './ledger_fold.js';
import { judgeEventsWithLLM, type JudgeEntryWithLLM } from './judge_service.js';
import { OBSERVE_RULE_IDS } from './judge.js';

export interface LoopOptions {
  /** 事件偏差率阈值（violated / eventCount），缺省 0.1 */
  minDeviationRate?: number;
  /** 未声明探针数阈值，缺省 1 */
  minUndesigned?: number;
  /** 台账累犯门槛，缺省 2 */
  minRepeatSpreads?: number;
  /** 是否做 LLM 行为级复核（默认 false） */
  useLlm?: boolean;
}

export interface LoopResult {
  report: TSDiffReport;
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
// 照搬的三个辅助函数
// ─────────────────────────────────────────────────────────────

/** 人类可读事实摘要（照搬 Go `aggregator.go:91-105`）。★ TS 的 `TSProbeObs` 无 `facts` 字段，此处补上。 */
export function buildProbeFacts(obs: TSProbeObs): string[] {
  const f: string[] = [];
  if (obs.errs === 0) f.push('所有事件 err 均为 nil');
  else f.push(`${obs.errs}/${obs.count} 事件捕获到非空 err`);
  if (obs.benigns > 0) f.push(`${obs.benigns} 个错误标记为良性`);
  if (obs.ops.length > 0) f.push(`覆盖 op: ${obs.ops.join(', ')}`);
  return f;
}

/** 从观测画像生成契约的期望描述（照搬 Go `:254-260`，facts 用 `；` 连接）。 */
export function expectFromObs(obs: TSProbeObs | undefined): string {
  if (!obs || obs.count === 0) return '该探针被观测到，需申明其行为契约';
  return `被观测到 ${obs.count} 次（${buildProbeFacts(obs).join('；')}），需以契约锁定其行为`;
}

/** 探针名 → 可作 rule 后缀的合法串（照搬 Go `:263-276`，逐 rune 判定）。 */
export function sanitizeRuleSuffix(s: string): string {
  let b = '';
  for (const r of s) {
    if (r === '.' || r === '/' || r === '\\' || r === ' ') b += '-';
    else if (/[a-zA-Z0-9-]/.test(r)) b += r;
    else b += '-';
  }
  return b;
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

  // ── 3. 加载权威设计 DSL（① 不存在则播种 v1，副作用已标注）──
  const store = new DesignDSLStore(dataDir);
  store.seedDefault();
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
      const r = await judgeEventsWithLLM(events, true);
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

  // ── 6a. 未声明探针 → 补契约提案 ──
  // ⚠⚠ **实测发现：这一分支在种子存在时永远不会产出提案**（2026-10-05，P4 步骤 6）
  //   根因链：种子 `silentErrorDiscardDSL()` 的 `probe` 是 **''（全局声明）**
  //   ⇒ `contract.ts:146-147` / Go `comparator.go:104` 的"全局声明匹配所有探针"语义
  //   ⇒ **任何探针都被算作"已覆盖"** ⇒ `undesigned` 恒为 0 ⇒ 本分支恒空转。
  //   实证：同一条事件流，种子 `probe=''` ⇒ undesigned=0；改成 `probe='fs.writeFile'`
  //   ⇒ undesigned=2（明细 another.one / brand.new）。
  //   ★ Go 侧**同样**如此 ⇒ 这不是移植引入的，是**该能力从 seed 定义那天起就没工作过**。
  //   ★ 种子的空 probe **语义上是对的**（"在本来会静默丢弃错误的位置"本就是全局陈述），
  //     真问题在比较器：**一条全局声明会抑制掉全部 undesigned 发现**。
  //   ⇒ 正确语义应是"没有**显式指名**该探针的声明 ⇒ undesigned"，与全局声明无关。
  //     **本笔不改**：那会动到判定层（已验证路径），属独立决策。已登记在 docs/todo.md。
  const obsByProbe = new Map<string, TSProbeObs>(actual.map((p) => [p.probe, p]));
  for (const dev of res.report.deviations) {
    if (dev.kind !== 'undesigned') continue; // 只对未声明探针补契约；违反/未观测交人工复核
    // ★ Go 侧 `Deviation.Probe` 是裸 `string`，为空时会生成 `design:observe-` 这种**畸形 rule id**
    //   （TS 侧 `TSDeviation.probe` 是可选的，类型系统会拦住，但 Go 拦不住）⇒ 这里显式跳过。
    if (!dev.probe) continue;
    const decl: TSDLDecl = {
      rule: `design:observe-${sanitizeRuleSuffix(dev.probe)}`,
      probe: dev.probe,
      expect: expectFromObs(obsByProbe.get(dev.probe)),
      origin: 'runtime-observe',
      status: 'proposed',
    };
    res.proposals.push(ps.create([decl], `loop: 补全未声明探针 ${dev.probe}`, 'loop'));
  }

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
