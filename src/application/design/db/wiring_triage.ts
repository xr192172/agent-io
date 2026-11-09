/**
 * 接线账 → **可执行整理计划**（ChangeSet 提案）
 *
 * 一句话：把 `WiringEntry`（`code_health` 的 wiring 账条目）**机械地**翻成
 * ①一种处置 ②一份最小 ChangeSet。**不新建第二份能力清单** —— 输入就是台账，
 * 输出就是既有 `ChangeSetInput`（`src/domain/change_set.ts`）。
 *
 * ## 为什么必须有这一层（2026-11-09）
 * 台账（`assessWiring`）只说"断在哪一格"；要动手还得有人把"断在哪"翻成"改哪个文件、
 * 用什么独立验收、怎么回滚"。**这一步反复由人来做 = 每轮手工再抄一份清单**，
 * 抄的时候就会漂（抄漏 = 漏改，抄错 = 改错对象）。⇒ 翻成纯函数，抄写这件事就没有了。
 *
 * ## 六类处置（与台账状态一一对应，不新增分类）
 * | 台账 status | 处置 | 允许自动做吗 |
 * |---|---|---|
 * | `connected` | `keep`（保留） | 不需要动 |
 * | `static-only` | `add-scenario`（补真实场景，**不许判死**） | 不许删 |
 * | `missing-input` / `missing-handoff` | `wire-one-cell`（**只接缺失那一格**） | 只改那一格 |
 * | `missing-consumer` | `find-consumer-or-retire`（找真实消费者，或显式标实验/待退役） | 不许静默删 |
 * | `reserved-experiment` | `off-mainline`（不进入主链） | 不动 |
 * | `unverifiable` | `unverifiable`（**不自动处置**） | 只报 |
 *
 * ★ 本层**不判断"要不要删"**：退役是人的决定，它只负责把"证据 + 最小动作 + 验收 + 回滚"写齐。
 */
import type { ChangeSetEntryInput, ChangeSetInput } from '../../../domain/change_set.js';
import type { WiringEntry, WiringStatus } from '../../../infrastructure/analysis/health/wiring_ledger.js';

/** 六类处置（与台账状态一一对应） */
export type WiringDisposition =
  | 'keep'
  | 'add-scenario'
  | 'wire-one-cell'
  | 'find-consumer-or-retire'
  | 'off-mainline'
  | 'unverifiable';

export type WiringTriage = {
  subject: string;
  status: WiringStatus;
  disposition: WiringDisposition;
  /** 这一处置的目标（一句话，可直接进 ChangeSet 的 detail） */
  intent: string;
  /** 允许自动执行吗（`false` ⇒ 必须人来定，不许脚本顺手做） */
  auto: boolean;
};

const MAP: Record<WiringStatus, { disposition: WiringDisposition; intent: string; auto: boolean }> = {
  connected: { disposition: 'keep', intent: '保留：六格全通，不需要动', auto: false },
  'static-only': {
    disposition: 'add-scenario',
    intent: '补一次真实运行场景（让它出现在运行读数里）；★ 静态有消费者 ≠ 没价值，**不许判死**',
    auto: false,
  },
  'missing-input': { disposition: 'wire-one-cell', intent: '先造出它要的输入（只接这一格，不动模块）', auto: true },
  'missing-handoff': { disposition: 'wire-one-cell', intent: '把上游产物接到它的入参上（只接这一格）', auto: true },
  'missing-consumer': {
    disposition: 'find-consumer-or-retire',
    intent: '找一个真实任务来消费它；找不到就**显式**标实验/待退役（不许静默删）',
    auto: false,
  },
  'reserved-experiment': { disposition: 'off-mainline', intent: '留作预留/实验，不进主链', auto: false },
  unverifiable: { disposition: 'unverifiable', intent: '证据不足 ⇒ 不自动处置（先补事实）', auto: false },
};

/** 台账条目 → 处置（纯映射；不读盘、不猜） */
export function triageOf(entry: WiringEntry): WiringTriage {
  const m = MAP[entry.status];
  return { subject: entry.subject, status: entry.status, disposition: m.disposition, intent: m.intent, auto: m.auto };
}

export type WiringPlanContext = {
  /** 这条账要落到哪张卡上（任务卡 id） */
  card: string;
  /** 受影响文件的**仓库相对路径**（人工给或从 subject 推；推不出就别编） */
  files: string[];
  /** 独立行为验收：怎么证明"改完确实接上了"（必须能失败） */
  acceptance: string;
  /** 回滚方式 */
  rollback: string;
};

export type WiringPlan = {
  triage: WiringTriage;
  /** 不能出计划时说明原因（`null` = 可以出） */
  blocked: string | null;
  /** 最小 ChangeSet（1 行）；`blocked` 时是 `null` */
  changeSet: ChangeSetInput | null;
};

/**
 * 一条台账 → 一份**最小** ChangeSet（1 entry）。
 *
 * 只有 `wire-one-cell`（缺输入/缺交接）能自动出计划 —— 它的动作是"接一格"，
 * 对象、验收、回滚都能被事实钉住。其余四类要么人不许自动做（删/退役/标实验），
 * 要么根本没有落点（unverifiable）⇒ 返回 `blocked` 并说明，**不编一份假计划出来**。
 */
export function planFromWiring(entry: WiringEntry, ctx: WiringPlanContext): WiringPlan {
  const triage = triageOf(entry);
  if (!triage.auto) {
    return {
      triage,
      blocked: `${entry.status} 的处置是「${triage.disposition}」，**不是接一格** ⇒ 不自动出改写计划（${triage.intent}）`,
      changeSet: null,
    };
  }
  if (ctx.files.length === 0) {
    return { triage, blocked: '给不出受影响文件（不编路径）', changeSet: null };
  }
  if (!entry.next_action || !entry.broken_at) {
    return { triage, blocked: '台账没给 next_action / broken_at ⇒ 不知道接哪一格', changeSet: null };
  }
  const rows: ChangeSetEntryInput[] = ctx.files.map((f) => ({
    file: f,
    kind: 'rewrite',
    detail: `[接线] ${entry.subject}：${entry.next_action}（断在 ${entry.broken_at}）`,
    judgement_ref: `card:${ctx.card}`,
    status: 'open',
    // ★ 台账原始事实挂在 note 上（ChangeSet 没有"note 表"这种东西；一行画布就是最贴的落点）
    note: entry.evidence.slice(0, 4).join(' ｜ '),
  }));
  const changeSet: ChangeSetInput = {
    // 卡的三态（kind/feature/state/owner）**在出计划这一步还不知道** ⇒ 如实留 null，
    // 不编一个"看起来像卡片"的假壳（读端会按 unknown 处理并自己现取）。
    card: { id: ctx.card, kind: 'unknown', feature: null, node_id: null, state: null, owner: null, claimed_at: null, life: null },
    decision: {
      summary: triage.intent,
      rationale: `接线账 ${entry.status} · 断在 ${entry.broken_at} · 主体 ${entry.subject}`,
      acceptance: ctx.acceptance,
      expectations: [],
    },
    plans: ctx.files.map((f) => ({ file: f, entries: rows.filter((r) => r.file === f) })),
    evidence: [{ kind: 'wiring-ledger', at: new Date().toISOString() }],
  };
  return { triage, blocked: null, changeSet };
}
