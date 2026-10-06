/**
 * Observe 即时判定器（TS 侧轻量版）
 *
 * 用于「开发时即时观测提示」：serve 每次探针 emit 后立即调用，判定该事件是否
 * 违反契约，命中就 SSE 推送。与 Go 装配层（observe-dsl loop）的权威判定共用
 * 同一契约语义（单一事实来源：Go 谓词判确定性，这里做等价的轻量即时判断）。
 *
 * 定位：实时提示（秒级反馈），不做全量聚合/未观测判定——那部分仍由
 * `observe-dsl loop` 事后权威执行。这里只回答「这条事件当下有没有问题」。
 */

import type { TSEvent } from './probe.js';

/** 即时判定结果。 */
export interface JudgeVerdict {
  probe: string;
  rule: string;
  result: 'ok' | 'deviation';
  reason: string;
  fields: Record<string, unknown>;
}

/**
 * 判定上下文（可选）：让谓词能看到**声明侧**信息（2026-10-06，P5 立）。
 *
 * ★ 为什么需要它 —— 起因是 `design:impact-known-spread` 声明"没有判定消费者"：
 *   声明说的是「a.ts 波及 x.ts 这个耦合**已被设计承认**」，而 `impact.spread` 事件上的
 *   `design:impact-unplanned-spread` 判的正是「有没有计划外越界」。
 *   ⇒ 两者是**同一个判定的一体两面**，不是两条并列规则：前者是后者的**减项**。
 *   ⇒ 若把 known-spread 也塞进 `OBSERVE_RULE_TABLE` 当第 4 条谓词，同一条事件会被两条规则
 *     各判一次、**结论相反**（unplanned 报违反 / known 报 ok）⇒ 又一次判据分叉。
 *   ⇒ 故此处给谓词一个**可选上下文**，由 `unplanned-spread` 自己扣减，**不新增规则**。
 *
 * ★ 形状约定：上下文里放的是**领域数据**（"哪些越界已被承认"），**不是 `TSDLDecl[]`** ——
 *   judge 层不认识 DSL 类型：① 避免与 `contract.ts` 成环 import（`contract → judge` 是值依赖）；
 *   ② 避免同一份类型定义出现第二份。从声明到本表的适配由 `ledger_fold.knownSpreadIndex` 承担。
 */
export interface ObserveRuleCtx {
  /**
   * 已承认耦合：`source 文件 → 该源已被设计承认的越界文件集合`（由权威 `dsl.json` 的
   * known-spread 声明折叠而来，见 `ledger_fold.knownSpreadIndex`）。
   *
   * ★ **`undefined` 与"空 Map"语义不同，不许混为一谈**：
   *   · `undefined` = **拿不到声明侧信息**（实时逐事件 / 日志查询等路径没有 dsl.json）
   *     ⇒ 规则按原样判，但**必须在文案里明说"未做已承认耦合扣减"**（不许静默）；
   *   · 空 Map = **已对账**，结论就是"没有任何已承认耦合" ⇒ 文案不提示未扣减。
   */
  acknowledgedSpreads?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * 静默错误丢弃契约（与 Go SilentErrorDiscard 语义对齐）：
 * 捕获到 err 的事件，若 err 非空且非良性，即为偏差。
 * 良性判定与操作相关：cleanup/remove 的 os.IsNotExist 良性；writefile/save/mkdirall 一律非良性。
 */
export function silentErrorDiscard(ev: TSEvent): JudgeVerdict {
  const errStr = typeof ev.fields['err'] === 'string' ? (ev.fields['err'] as string) : '';
  if (!errStr) {
    return { probe: ev.probe, rule: 'design:silent-error-discard', result: 'ok', reason: 'err is nil — nothing was discarded', fields: ev.fields };
  }
  const op = typeof ev.fields['op'] === 'string' ? (ev.fields['op'] as string) : '';
  switch (op) {
    case 'remove':
    case 'remove-tmp':
    case 'cleanup':
      if (ev.fields['benign'] === true) {
        return { probe: ev.probe, rule: 'design:silent-error-discard', result: 'ok', reason: 'benign: os.IsNotExist on cleanup — nothing to clean', fields: ev.fields };
      }
      return { probe: ev.probe, rule: 'design:silent-error-discard', result: 'deviation', reason: `cleanup error silently discarded: "${errStr}"`, fields: ev.fields };
    default:
      return { probe: ev.probe, rule: 'design:silent-error-discard', result: 'deviation', reason: `non-benign error silently discarded (op=${op}): "${errStr}"`, fields: ev.fields };
  }
}

/**
 * 变更影响爆炸半径契约（Step 3：watch 影响报告与 Observe 合流）。
 *
 * watch impact_on_change=true 生成的 `impact.report` 事件：波及文件总数
 * （direct+indirect）超阈值即偏差——提醒"这一改动的爆炸半径过大，考虑拆分"。
 * 只对 probe 以 `impact.` 开头的事件生效，其他事件一律 ok（不干扰既有规则）。
 * 生成失败（fields.err 非空）由 silentErrorDiscard 先命中，不在此重复。
 */
export const IMPACT_BLAST_RADIUS_LIMIT = 50;

export function impactBlastRadius(ev: TSEvent): JudgeVerdict {
  if (!ev.probe.startsWith('impact.')) {
    return { probe: ev.probe, rule: 'design:impact-blast-radius', result: 'ok', reason: 'not an impact event', fields: ev.fields };
  }
  const num = (k: string): number => (typeof ev.fields[k] === 'number' ? (ev.fields[k] as number) : 0);
  const direct = num('direct_files');
  const indirect = num('indirect_files');
  const threshold = num('threshold') || IMPACT_BLAST_RADIUS_LIMIT;
  const total = direct + indirect;
  if (total > threshold) {
    return {
      probe: ev.probe,
      rule: 'design:impact-blast-radius',
      result: 'deviation',
      reason: `blast radius ${total} files (direct ${direct} + indirect ${indirect}) exceeds threshold ${threshold} — consider splitting the change`,
      fields: ev.fields,
    };
  }
  return { probe: ev.probe, rule: 'design:impact-blast-radius', result: 'ok', reason: `blast radius ${total} files within threshold ${threshold}`, fields: ev.fields };
}

/** "未做已承认耦合扣减"的短后缀（供无声明集 / 无法定位 source 两条路径复用，避免文案两处漂）。 */
const NO_ACK_NOTE = '（⚠ 未扣已承认耦合：无声明集）';

/**
 * 计划外扩散契约（Impact Ledger：改前预告-改后验证闭环）。
 *
 * `impact.spread` 事件：改前 declare 登记的预告波及面 vs 改后实际波及面对比结果。
 * unexpected_files 非空 = 出现了预告之外的波及文件 → 偏差（改动走出了预告面，
 * 说明计划遗漏或改动越界）。只对 probe === 'impact.spread' 生效。
 *
 * ★ 2026-10-06（P5）：**先扣掉"已被设计承认的耦合"，再看净越界是否为空。**
 *
 *   为什么必须扣（而不是另立一条规则）：`design:impact-known-spread` 声明表达的是
 *   「a.ts 波及 x.ts 这个耦合**已被设计承认**」（loop 从台账累犯模式回流、经审批进权威
 *   `dsl.json`）。它与本规则是**同一个判定的一体两面**：本规则问"越界了吗"，那条声明答
 *   "这部分我认了"。⇒ 若把 known-spread 注册成第 4 条谓词，同一条事件会被两条规则各判一次、
 *   **结论相反** ⇒ 判据分叉。⇒ 正确落点是**改本规则的判定输入**：已承认的越界扣除。
 *
 *   定位方式**不是启发式**：`source` 的定义就是"某条 ledger 条目 `declared_files` 里的一个成员"
 *   （`ledger_fold.foldEntries` 逐字如此）；而事件自带 `declared_files`
 *   （`watch_project_tool.ts` 写入）⇒ `event.declared_files` × `ctx.acknowledgedSpreads` 是精确桥。
 *
 *   ★ `ctx` 的两种"没有"语义不同（见 {@link ObserveRuleCtx}）：`undefined` = 未对账
 *     （文案必须明说未扣减）；空 Map = 已对账且无已承认耦合（文案不提示）。
 */
export function impactUnplannedSpread(ev: TSEvent, ctx?: ObserveRuleCtx): JudgeVerdict {
  const RULE = 'design:impact-unplanned-spread';
  if (ev.probe !== 'impact.spread') {
    return { probe: ev.probe, rule: RULE, result: 'ok', reason: 'not a spread event', fields: ev.fields };
  }
  const unexpected = Array.isArray(ev.fields['unexpected_files']) ? (ev.fields['unexpected_files'] as string[]) : [];
  const expected = typeof ev.fields['expected_count'] === 'number' ? (ev.fields['expected_count'] as number) : 0;
  const actual = typeof ev.fields['actual_count'] === 'number' ? (ev.fields['actual_count'] as number) : 0;
  if (unexpected.length === 0) {
    return { probe: ev.probe, rule: RULE, result: 'ok', reason: `impact within declared preview (${actual}/${expected} files)`, fields: ev.fields };
  }

  const ack = ctx?.acknowledgedSpreads;
  if (!ack) {
    // 拿不到声明 ⇒ 按原样报，但**明说**没扣减（不许静默）
    return {
      probe: ev.probe,
      rule: RULE,
      result: 'deviation',
      reason: `unplanned spread: ${unexpected.length} file(s) impacted beyond the declared preview: ${unexpected.join(', ')} ${NO_ACK_NOTE}`,
      fields: ev.fields,
    };
  }

  // 已承认耦合：按事件的 declared_files 逐 source 取并集；事件未带则**不猜**（并明说原因）
  const declared = Array.isArray(ev.fields['declared_files']) ? (ev.fields['declared_files'] as string[]) : [];
  const known = new Set<string>();
  if (declared.length === 0) {
    if (ack.size > 0) {
      return {
        probe: ev.probe,
        rule: RULE,
        result: 'deviation',
        reason: `unplanned spread: ${unexpected.length} file(s) impacted beyond the declared preview: ${unexpected.join(', ')}（⚠ 事件未带 declared_files，定位不到 source，未扣减）`,
        fields: ev.fields,
      };
    }
  } else {
    for (const s of declared) for (const f of ack.get(s) ?? []) known.add(f);
  }

  const net = unexpected.filter((f) => !known.has(f));
  if (net.length === 0) {
    return {
      probe: ev.probe,
      rule: RULE,
      result: 'ok',
      reason: `unplanned spread fully acknowledged: all ${unexpected.length} file(s) beyond the preview are design-acknowledged couplings (${unexpected.join(', ')})`,
      fields: ev.fields,
    };
  }
  const acked = unexpected.length - net.length;
  return {
    probe: ev.probe,
    rule: RULE,
    result: 'deviation',
    reason:
      `unplanned spread: ${net.length} file(s) impacted beyond the declared preview: ${net.join(', ')}` +
      (acked > 0 ? `（另有 ${acked} 个已由设计契约承认，已扣除）` : ''),
    fields: ev.fields,
  };
}

// ─────────────────────────────────────────────────────────────
// 规则注册表（**本仓唯一的规则真相源**，2026-10-05 立）
// ─────────────────────────────────────────────────────────────
// ★ 为什么要它：此前规则散在**两处**——`judge.ts:110` 的 `rules` 默认参数（3 条）
//   与 `contract.ts:84` `TSComparator.registerDefaultPredicates` 的实例 map（1 条）。
//   两处各自维护、各自注册，同一条 `design:silent-error-discard` 还各有一份**字面量重复的谓词**。
//   ⇒ 本表是唯一的注册点；`TSComparator` 与 `judgeEvent` 都从这里取。
//
// ★ 收拢时**采纳 TS 侧的行为**（2026-10-05 用户裁定「留 TS」）：本次只把 TS 两份拷贝里
//   `benign` 严格性的漂移统一为 Go 的严格 `=== true`，**不动另外两处已裁定的语义分叉**
//   （TS 跳过链路声明 / 链路探针算已覆盖）—— 那是 P3 的范围。

/** 一条规则的注册项。`label` 供提案审批时生成人读证据用。 */
export interface ObserveRuleSpec {
  rule: string;
  label: string;
  /** 判定谓词。`ctx` 可选：只有需要**声明侧信息**的规则才会用它（见 {@link ObserveRuleCtx}）。 */
  pred: (ev: TSEvent, ctx?: ObserveRuleCtx) => JudgeVerdict;
}

/** 全部已注册规则（顺序即优先级）。 */
export const OBSERVE_RULE_TABLE: readonly ObserveRuleSpec[] = [
  { rule: 'design:silent-error-discard', label: '静默错误丢弃', pred: silentErrorDiscard },
  { rule: 'design:impact-unplanned-spread', label: '计划外扩散（impact ledger）', pred: impactUnplannedSpread },
  { rule: 'design:impact-blast-radius', label: '变更影响爆炸半径', pred: impactBlastRadius },
];

/** 按 rule id 取谓词；未注册返回 undefined（P4 的回归门靠这个区分"可规则秒判"与"需 LLM/人工复核"）。 */
export function observeRulePredicate(rule: string): ((ev: TSEvent, ctx?: ObserveRuleCtx) => JudgeVerdict) | undefined {
  return OBSERVE_RULE_TABLE.find((r) => r.rule === rule)?.pred;
}

/** 已注册的 rule id 清单。 */
export const OBSERVE_RULE_IDS: readonly string[] = OBSERVE_RULE_TABLE.map((r) => r.rule);

/**
 * 对单条事件执行全部已注册规则判定，返回首条命中偏差的判定（无偏差则 ok）。
 * 规则顺序即优先级（唯一来源 = `OBSERVE_RULE_TABLE`）。`ctx` 会原样传给每条谓词。
 *
 * ★ 2026-10-06：删掉了原先的 `rules` 形参（原本用于"自定义规则链"）。
 *   全仓**零调用方**——所有调用点都是 `judgeEvent(ev)`（`serve.ts` / `reconcile_chain.ts` /
 *   `log_query.ts` / `judge_service.ts` / `judge_guard.ts`）。
 *   留一个没人用的第二参会逼出 `judgeEvent(ev, undefined, ctx)` 这种占位调用（API 反而更难用），
 *   而「不为想象中的消费者写代码」是本仓既定纪律；同理删掉了随之零消费者的 `DEFAULT_OBSERVE_RULES`。
 */
export function judgeEvent(ev: TSEvent, ctx?: ObserveRuleCtx): JudgeVerdict {
  for (const r of OBSERVE_RULE_TABLE) {
    const v = r.pred(ev, ctx);
    if (v.result === 'deviation') return v;
  }
  // 全部规则都 ok → ok（取首条 ok 作为代表）
  const first = OBSERVE_RULE_TABLE[0];
  return first
    ? first.pred(ev, ctx)
    : { probe: ev.probe, rule: '', result: 'ok', reason: 'no contract violation', fields: ev.fields };
}