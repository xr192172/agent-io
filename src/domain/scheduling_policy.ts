/**
 * 影子调度策略 —— **纯函数**：证据缺口 → 候选动作 → 硬过滤 → 确定排序 → 预算截断（无 IO）。
 *
 * ## DS-1R 修的是哪条语义（05-DS1-REVIEW R-01/R-02/R-03）
 * 1. **任何动作都不关闭当前缺口**。影子模式一条都没执行 ⇒ `open_gaps` 是"生成时仍开启的全部缺口"，
 *    动作只能声明 `would_close_gaps`（**假设未来成功执行**的预计收益）。被 `blocked_by` 的动作一律记空。
 * 2. **no_op 是六条件的合取**（见 `planStanding`）：无缺口、无不可判、无冲突、无当前失败、
 *    无 unsupported 未决、无动作/未选项。"没有建议但仍有不可判" = `unresolved`，不是"没活干"。
 * 3. **goal.scope 是候选生成时的硬约束**：范围外对象只进 `out_of_scope`（项目风险展示），
 *    不会被本目标选中；影响不可信而要扩大验证时走显式 `widen` 授权，不用 `all-eligible` 静默越界。
 *
 * 规则顺序（命中即不再往下猜）：
 * 1. 输入形状坏 / 身份歧义 / 冲突 / 能力不支持 / 作用域外 ⇒ `ask_human`（不猜）。
 * 2. 索引缺失 / 不可用 / 落后 / 缺证据 ⇒ 最小 `refresh_index` 或重验；其完成前不许建议继承。
 * 3. 已有当前失败证据 ⇒ 只建议与该失败主体直接相关的最小确认，保持非绿。
 * 4. 证据过期 / 缺证据 / 影响面不可信 ⇒ 目标测试或判据（不可信 ⇒ 显式 widen 请求）。
 * 5. 外部结果未到 ⇒ `wait`。
 * 6. 六条件全满足 ⇒ 唯一 `no_op`。
 * 7. 预算不足 ⇒ 低优先项进 `deferred`，缺口本来就在 `open_gaps` 里（不需要"保留"）。
 *
 * ## 排序是五段确定键，不是打分
 * `rule`(1..7) → 依赖深度 → 与目标相关度 → 已知成本（未知在后）→ action → target。
 * ★ 成本恒 `{known:false}`：不出现 confidence / 预计节省 / 毫秒估计。
 */
import {
  type EvidenceFrame,
  type EvidenceSignal,
  type FrameGap,
  frameShapeError,
  isJudgementRef,
  isTestObjectPath,
  relativeKey,
} from './scheduling_evidence.js';

export const SHADOW_ACTIONS = [
  'refresh_index',
  'read_facts',
  'run_test',
  'run_judgement',
  'observe',
  'ask_human',
  'wait',
  'no_op',
] as const;
export type ShadowActionKind = (typeof SHADOW_ACTIONS)[number];

export type ShadowRule = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CostFact = { known: false; why: string } | { known: true; ms: number };

export interface ShadowAction {
  action: ShadowActionKind;
  rule: ShadowRule;
  target: string;
  /** 它针对的缺口 id */
  gap: string;
  evidence: string[];
  why_before_others: string;
  depends_on: string[];
  blocked_by: string[];
  closes: string;
  cost: CostFact;
  if_skipped: string;
  /** ★ 机器字段：**假设未来成功执行**后预计关闭的缺口（不影响 `open_gaps`） */
  would_close_gaps: string[];
}

export interface ShadowPlan {
  project: string;
  goal: { text: string; judgement_refs: string[]; scope: string[] };
  content_version: string | null;
  actions: ShadowAction[];
  deferred: ShadowAction[];
  /** ★ 生成时仍开启的**全部**缺口（含 signal 派生）；建议不会让它变短 */
  open_gaps: string[];
  /** ★ 范围外对象：作为项目风险展示，但不被本目标选中 */
  out_of_scope: Array<{ id: string; reason: string }>;
  /** ★ 显式扩大授权需求（影响不可信 / 需要超过 goal scope 时） */
  widen: { reason: string; gaps: string[] } | null;
  /** ★ 依赖键缺失/成环的诊断（不静默按深度 0 处理） */
  dependency_problems: Array<{ action: string; target: string; kind: 'missing-dep' | 'cycle'; detail: string }>;
  excluded: Array<{ id: string; reason: string }>;
  undetermined: Array<{ id: string; reason: string }>;
  no_op: boolean;
  limitations: string[];
  generated_at?: string;
}

export interface PolicyOptions {
  /** 最多选几条建议。缺省 1；**0 = 明确"本轮不选任何动作（只诊断）"**；非法值抛 RangeError。 */
  budget?: number;
}

const actionKey = (a: Pick<ShadowAction, 'action' | 'target'>): string => `${a.action}::${a.target}`;

/** 成本排序键：已知成本在前（按毫秒），未知在后。★ 未知**不许**当 0。 */
export function costRank(cost: CostFact): [number, number] {
  return cost.known ? [0, cost.ms] : [1, 0];
}

/** 声明范围判定：`in` 范围内 / `out` 范围外 / `undeclared` 目标没声明范围。 */
export function scopeDecision(frame: EvidenceFrame, target: string): 'in' | 'out' | 'undeclared' {
  const scope = (frame.goal.scope ?? []).map(relativeKey).filter(Boolean);
  if (scope.length === 0) return 'undeclared';
  const t = relativeKey(target);
  // ★ T-02：判据/设计侧对象走**同一处身份判定**（design: / decision: / cert: 都算），
  //   否则每加一类 ref 就多一条越界旁路。
  if (isJudgementRef(target)) return 'in';
  if (t === 'all-eligible') return 'out'; // ★ 不许无条件当成范围内
  return scope.some((p) => t === p || t.startsWith(`${p}/`)) ? 'in' : 'out';
}

function goalRelevance(frame: EvidenceFrame, target: string): number {
  const d = scopeDecision(frame, target);
  return d === 'in' ? 0 : d === 'undeclared' ? 1 : 2;
}

const MISSING_DEP_DEPTH = 900;
const CYCLE_DEPTH = 999;

/** 依赖深度 + 诊断：缺失/成环**不按 0** 处理（排到最后并进 `dependency_problems`）。 */
function analyzeDeps(actions: readonly ShadowAction[]): {
  depth: Map<string, number>;
  problems: ShadowPlan['dependency_problems'];
} {
  const byKey = new Map(actions.map((a) => [actionKey(a), a]));
  const depth = new Map<string, number>();
  const problems: ShadowPlan['dependency_problems'] = [];
  const resolving = new Set<string>();

  const walk = (a: ShadowAction): number => {
    const key = actionKey(a);
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    if (a.depends_on.length === 0) {
      depth.set(key, 0);
      return 0;
    }
    if (resolving.has(key)) {
      depth.set(key, CYCLE_DEPTH);
      problems.push({ action: a.action, target: a.target, kind: 'cycle', detail: `依赖成环：${a.depends_on.join(' → ')}` });
      return CYCLE_DEPTH;
    }
    resolving.add(key);
    let max = 0;
    for (const dep of a.depends_on) {
      const next = byKey.get(dep);
      if (!next) {
        max = Math.max(max, MISSING_DEP_DEPTH);
        problems.push({ action: a.action, target: a.target, kind: 'missing-dep', detail: `前置 ${dep} 不在本计划内` });
        continue;
      }
      max = Math.max(max, 1 + walk(next));
    }
    resolving.delete(key);
    depth.set(key, max);
    return max;
  };
  for (const a of actions) walk(a);
  return { depth, problems };
}

const ev = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

const mk = (
  partial: Omit<ShadowAction, 'evidence' | 'depends_on' | 'blocked_by' | 'would_close_gaps'> & {
    evidence: readonly string[];
    depends_on?: readonly string[];
    blocked_by?: readonly string[];
    would_close_gaps?: readonly string[];
  },
): ShadowAction => ({
  ...partial,
  evidence: ev(partial.evidence),
  depends_on: [...(partial.depends_on ?? [])],
  blocked_by: [...(partial.blocked_by ?? [])],
  // ★ 被硬阻断的动作**不许**声称能关闭任何缺口（计划内部不许自相矛盾）
  would_close_gaps: (partial.blocked_by ?? []).length > 0 ? [] : [...new Set(partial.would_close_gaps ?? [])].sort(),
});

const UNKNOWN_TEST_COST: CostFact = { known: false, why: '未实测测试耗时' };

/** 由 signal 派生的当前缺口（它们同样在分母里，不许因为"没被建议"而消失）。 */
function derivedGapsOf(frame: EvidenceFrame): string[] {
  const out: string[] = [];
  for (const s of frame.signals ?? []) {
    if (s.kind !== 'test') continue;
    if (s.verdict === 'fail' && s.freshness === 'fresh') out.push(`fail:${s.id}`);
    if (s.freshness === 'stale') out.push(`stale:${s.id}`);
    if (s.verdict === 'unsupported' && s.reason !== 'retired') out.push(`unsupported:${s.id}`);
  }
  return out;
}

/**
 * 计划的"当前站位"（纯判据，`no_op` 的唯一出处）。
 * ★ 六条件全满足才是 `no_op`；只要有未决/冲突/失败/未关闭缺口就是 `unresolved`。
 */
export function planStanding(s: {
  open_gaps: readonly string[];
  undetermined: number;
  conflicts: number;
  fresh_fail: number;
  unsupported: number;
  actions: number;
  deferred: number;
}): 'no_op' | 'work' | 'unresolved' {
  if (s.actions > 0 || s.deferred > 0) return 'work';
  if (s.open_gaps.length > 0 || s.undetermined > 0 || s.conflicts > 0 || s.fresh_fail > 0 || s.unsupported > 0) {
    return 'unresolved';
  }
  return 'no_op';
}

function validateBudget(budget: number | undefined): number {
  if (budget === undefined) return 1;
  if (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 0) {
    throw new RangeError(`planShadow: budget 必须是 ≥0 的整数（0 = 只诊断不选动作），实得 ${String(budget)}`);
  }
  return budget;
}

/** 主入口：证据帧 → 影子计划（**只建议，不执行；任何动作都不关闭当前缺口**）。 */
export function planShadow(frame: EvidenceFrame, opts: PolicyOptions = {}): ShadowPlan {
  const budget = validateBudget(opts.budget);
  const base: ShadowPlan = {
    project: frame.project?.root ?? '',
    goal: {
      text: frame.goal?.text ?? '',
      judgement_refs: [...(frame.goal?.judgement_refs ?? [])].sort(),
      scope: [...(frame.goal?.scope ?? [])].sort(),
    },
    content_version: frame.content?.version ?? null,
    actions: [],
    deferred: [],
    open_gaps: [],
    out_of_scope: [],
    widen: null,
    dependency_problems: [],
    excluded: [...(frame.excluded ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    undetermined: [...(frame.undetermined ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    no_op: false,
    limitations: [...(frame.limitations ?? [])],
  };

  const shapeErr = frameShapeError(frame);
  if (shapeErr) {
    return {
      ...base,
      // ★ S-04：帧形状坏也要遵守 budget=0（只诊断：如实报缺口，不选动作）
      actions:
        budget > 0
          ? [
              mk({
                action: 'ask_human',
                rule: 1,
                target: 'evidence-frame',
                gap: 'frame-shape',
                evidence: [],
                why_before_others: `证据帧本身不可读（${shapeErr}）⇒ 任何后续建议都可能建立在错输入上`,
                closes: `证据帧形状：${shapeErr}`,
                cost: { known: false, why: '形状错误时不做成本估计' },
                if_skipped: '保持"输入不可读"，不产生任何执行建议',
              }),
            ]
          : [],
      open_gaps: ['frame-shape'],
      limitations: [...base.limitations, `证据帧形状错误：${shapeErr}`],
    };
  }

  const gaps = [...(frame.gaps ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const excludedIds = new Set((frame.excluded ?? []).map((e) => relativeKey(e.id)));
  const candidates: ShadowAction[] = [];
  const outOfScope: Array<{ id: string; reason: string }> = [];
  let widen: ShadowPlan['widen'] = null;
  const widenGapIds: string[] = [];
  let widenReason = '';

  const indexGap = gaps.find((g) => g.id.startsWith('index:')) ?? null;
  const indexDepKey = indexGap ? `refresh_index::${frame.project.identity}` : '';
  const indexBlocked = indexGap ? [`index-unusable:${indexGap.id}`] : [];
  const depsOf = indexGap ? [indexDepKey] : [];
  const blockedOf = indexBlocked;

  /** 范围内才生成可执行建议；范围外只登记成项目风险。 */
  const pushScoped = (target: string, make: () => ShadowAction): void => {
    const d = scopeDecision(frame, target);
    if (d === 'out') {
      outOfScope.push({ id: target, reason: '不在 goal.scope 内 ⇒ 本目标不选它执行（可作为项目风险单独处理）' });
      return;
    }
    candidates.push(make());
  };

  /**
   * ★ S-01：**所有**"全量/扩大验证"入口都走这一处 —— scope 裁决只此一份，不许 snapshot 有自己的旁路。
   * `out` ⇒ 只产出 widen 授权需求 + 安全裁决动作；`undeclared` ⇒ 允许全量但必须标明"未授权"。
   */
  const fullUnscopedGaps: string[] = [];
  const pushFullVerification = (
    gap: FrameGap,
    whyBefore: string,
    closes: string,
    ifSkipped: string,
  ): void => {
    const d = scopeDecision(frame, 'all-eligible');
    if (d === 'out') {
      widenGapIds.push(gap.id);
      if (!widenReason) widenReason = gap.reason;
      candidates.push(
        mk({
          action: 'ask_human',
          rule: 1,
          target: 'widen-verification',
          gap: gap.id,
          evidence: gap.signals,
          why_before_others: `${whyBefore}；但扩大到全量会越出 goal.scope（${(frame.goal.scope ?? []).join(', ')}）⇒ 必须先取得授权`,
          closes: '扩大验证的范围授权',
          cost: { known: false, why: '授权前不做成本估计' },
          if_skipped: '保持"不可判"，验证范围不变',
        }),
      );
      return;
    }
    if (d === 'undeclared') fullUnscopedGaps.push(gap.id);
    candidates.push(
      mk({
        action: 'run_test',
        rule: 4,
        target: 'all-eligible',
        gap: gap.id,
        evidence: gap.signals,
        why_before_others: whyBefore,
        depends_on: depsOf,
        blocked_by: blockedOf,
        closes,
        cost: UNKNOWN_TEST_COST,
        if_skipped: ifSkipped,
        would_close_gaps: [gap.id],
      }),
    );
  };

  for (const g of gaps) {
    // ★ S-02：已解析 ref 只证明"目标存在"，当前 verdict 未读 ⇒ 必须未决 + 建议 run_judgement
    if (g.id.startsWith('ref-verdict-pending:')) {
      const ref = g.subject || g.id.slice('ref-verdict-pending:'.length);
      pushScoped(ref, () =>
        mk({
          action: 'run_judgement',
          rule: 4,
          target: ref,
          gap: g.id,
          evidence: g.signals,
          why_before_others: `${ref} 的当前 verdict 还没读 ⇒ 引用存在不等于判据成立`,
          closes: `${ref} 的当前 verdict`,
          cost: { known: false, why: '未实测判据耗时' },
          if_skipped: '保持"引用已解析但 verdict 未读"（不是通过）',
          would_close_gaps: [g.id],
        }),
      );
      continue;
    }
    switch (g.kind) {
      case 'missing':
      case 'stale':
      case 'unavailable': {
        if (g.id.startsWith('index:')) {
          candidates.push(
            mk({
              action: 'refresh_index',
              rule: 2,
              target: frame.project.identity,
              gap: g.id,
              evidence: g.signals,
              why_before_others: `索引这一关没过（${g.reason}）⇒ 依赖索引事实的继承/影响面判断都还没有合法输入`,
              closes: `索引可判性：${g.reason}`,
              cost: { known: false, why: '未实测刷新耗时' },
              if_skipped: '保持"索引不可判"：本期不给任何基于索引结论的继承建议',
              would_close_gaps: [g.id],
            }),
          );
          break;
        }
        // ★ T-01：snapshot 的**全部**"需要扩大验证"状态（missing / no-evidence / empty-observes）
        //   都走同一个全量裁决入口；只有"读不到/损坏"才走不可读处置。
        if (g.id === 'snapshot:unreadable') {
          candidates.push(
            mk({
              action: 'ask_human',
              rule: 1,
              target: 'snapshot',
              gap: g.id,
              evidence: g.signals,
              why_before_others: `基线**读不到**（${g.reason}）⇒ 既不能继承，也不能当作"没有基线 ⇒ 全跑"`,
              closes: `基线可读性：${g.reason}`,
              cost: { known: false, why: '读失败时不做成本估计' },
              if_skipped: '保持"基线不可用"（不继承、不冒充首次运行）',
            }),
          );
          break;
        }
        if (g.id.startsWith('snapshot:')) {
          pushFullVerification(
            g,
            `基线状态 ${g.id.slice('snapshot:'.length)}（${g.reason}）⇒ 无证据可继承，只能扩大验证来建立当前事实`,
            '当前结论（无可继承证据 ⇒ 需要全量/扩大验证）',
            '保持"没有当前证据"（不是通过）',
          );
          break;
        }
        candidates.push(
          mk({
            action: 'ask_human',
            rule: 1,
            target: g.subject || g.id,
            gap: g.id,
            evidence: g.signals,
            why_before_others: `读不到（${g.reason}）⇒ 不猜`,
            closes: `可读性：${g.reason}`,
            cost: { known: false, why: '读失败时不做成本估计' },
            if_skipped: '保持"读不到"（读不到 ≠ 没有，也 ≠ 通过）',
          }),
        );
        break;
      }
      case 'missing-evidence': {
        const target = g.subject;
        if (!target) break;
        // ★ T-01：subject 不是"单个测试对象"（例如目录名 `tests`、或集合语义的空 subject）⇒
        //   不许把它当 target 去跑；改用集合语义的全量裁决。
        if (!isTestObjectPath(target)) {
          pushFullVerification(
            g,
            `缺证据的对象不是单个测试对象（${target}）⇒ 只能按集合语义扩大验证`,
            '集合层面的当前结论',
            '保持"该集合没有当前证据"（不是通过）',
          );
          break;
        }
        if (!excludedIds.has(relativeKey(target))) {
          pushScoped(target, () =>
            mk({
              action: 'run_test',
              rule: 4,
              target,
              gap: g.id,
              evidence: g.signals,
              why_before_others: `${target} 存在但一条自己的当前证据都没有 ⇒ 其余动作都没有落脚点`,
              depends_on: depsOf,
              blocked_by: blockedOf,
              closes: `${target} 的当前结论`,
              cost: UNKNOWN_TEST_COST,
              if_skipped: `${target} 保持"没有当前证据"（不许读成通过）`,
              would_close_gaps: [g.id],
            }),
          );
        }
        break;
      }
      case 'impact-untrusted': {
        // ★ S-01：与 snapshot:missing 共用同一个 widen 裁决（同一套 scope 算法）
        pushFullVerification(
          g,
          `影响关系不可信（${g.reason}）⇒ 交集为空不许当安全，只能扩大验证`,
          '受影响集合（影响面不可信）',
          '保持"影响面不可判"（不许当"没影响到"）',
        );
        break;
      }
      case 'pending': {
        candidates.push(
          mk({
            action: 'wait',
            rule: 5,
            target: g.subject || g.id,
            gap: g.id,
            evidence: g.signals,
            why_before_others: `外部结果还没到（${g.reason}）⇒ 现在做任何事都是重复投递`,
            closes: `等待中的不确定性：${g.reason}`,
            cost: { known: false, why: '等待无实测成本' },
            if_skipped: '保持 pending（不是通过）',
          }),
        );
        break;
      }
      default: {
        // conflicting / ambiguous / unsupported / retired / out-of-scope / ref 问题：一律交人判
        candidates.push(
          mk({
            action: 'ask_human',
            rule: 1,
            target: g.subject || g.id,
            gap: g.id,
            evidence: g.signals,
            why_before_others: `${g.kind}：${g.reason} ⇒ 机器不替这个决定`,
            closes: `${g.kind}：${g.reason}`,
            cost: { known: false, why: '需人判时不做成本估计' },
            if_skipped: `保持 ${g.kind} 未决（不覆盖任何一方）`,
          }),
        );
        break;
      }
    }
  }

  // ── 规则 3/4：以"当前失败的证据"为主体生成最小确认；失败不许被 pass 数量压过。
  for (const s of frame.signals) {
    if (s.kind !== 'test') continue;
    const target = relativeKey(s.subject?.path ?? '');
    if (!target || excludedIds.has(target)) continue;
    if (s.freshness === 'conflicting') continue; // 冲突已由 gap ask_human 处理
    if (s.verdict === 'fail' && s.freshness === 'fresh') {
      pushScoped(target, () =>
        mk({
          action: 'run_test',
          rule: 3,
          target,
          gap: `fail:${s.id}`,
          evidence: [s.id],
          why_before_others: `${target} 有**当前**失败证据 ⇒ 先确认它，再谈别的动作`,
          depends_on: depsOf,
          blocked_by: blockedOf,
          closes: `${target} 的当前失败是否仍在`,
          cost: UNKNOWN_TEST_COST,
          if_skipped: `${target} 保持非绿（失败不许被其他 pass 数量压过）`,
          would_close_gaps: [`fail:${s.id}`],
        }),
      );
    }
    if (s.freshness === 'stale') {
      pushScoped(target, () =>
        mk({
          action: 'run_test',
          rule: 4,
          target,
          gap: `stale:${s.id}`,
          evidence: [s.id],
          why_before_others: `${target} 的证据与当前内容对不上（${s.reason ?? '旧版本'}）⇒ 它不是当前证据`,
          depends_on: depsOf,
          blocked_by: blockedOf,
          closes: `${target} 的旧证据可否更新为当前结论`,
          cost: UNKNOWN_TEST_COST,
          if_skipped: `${target} 保持"证据过期"（不许当通过）`,
          would_close_gaps: [`stale:${s.id}`],
        }),
      );
    }
    if (s.verdict === 'unsupported' && s.freshness !== 'stale' && s.reason !== 'retired') {
      pushScoped(target, () =>
        mk({
          action: 'ask_human',
          rule: 1,
          target,
          gap: `unsupported:${s.id}`,
          evidence: [s.id],
          why_before_others: `${target} 的当前结论是 unsupported（${s.reason ?? '未说明'}）⇒ 不是通过，也不是可自动补的事`,
          closes: `${target} 的可执行性`,
          cost: { known: false, why: '能力不支持时不做成本估计' },
          if_skipped: `${target} 保持 unsupported（不许读成通过）`,
        }),
      );
    }
  }

  // ── 硬过滤：认不出 runner ⇒ run_test 一律降级（**包括**同时被索引阻断的那些）。
  const runner = frame.capability?.runner ?? null;
  const kept: ShadowAction[] = [];
  for (const a of candidates) {
    if (a.action !== 'run_test' || runner !== null) {
      kept.push(a);
      continue;
    }
    kept.push(
      mk({
        action: 'ask_human',
        rule: 1,
        target: a.target,
        gap: a.gap,
        evidence: a.evidence,
        why_before_others: `能力不支持：认不出可过滤的测试运行器（${frame.capability?.reason ?? '未探测'}）⇒ 不能建议 run_test`,
        closes: `可执行性：${a.target}`,
        cost: { known: false, why: '能力不支持时不做成本估计' },
        if_skipped: `${a.target} 保持未验证（不是通过）`,
      }),
    );
  }

  const openSet = new Set<string>([...gaps.map((g) => g.id), ...derivedGapsOf(frame), ...widenGapIds]);
  if (widenGapIds.length > 0) widen = { reason: widenReason, gaps: [...widenGapIds].sort() };

  if (kept.length === 0) {
    const openList = [...openSet].sort();
    const standing = planStanding({
      open_gaps: openList,
      undetermined: base.undetermined.length,
      conflicts: (frame.conflicts ?? []).length,
      fresh_fail: (frame.signals ?? []).filter((s) => s.kind === 'test' && s.verdict === 'fail' && s.freshness === 'fresh').length,
      unsupported: (frame.signals ?? []).filter((s) => s.verdict === 'unsupported' && s.reason !== 'retired').length,
      actions: 0,
      deferred: 0,
    });
    // ★ S-04：budget=0 是"只诊断" ⇒ 未决读数保留，但**不许**用安全动作旁路选一条
    const safe: ShadowAction[] =
      standing === 'unresolved' && budget > 0
        ? [
            mk({
              action: 'ask_human',
              rule: 1,
              target: 'unresolved-items',
              gap: openList[0] ?? 'unresolved',
              evidence: [],
              why_before_others: '存在未决项（缺口/不可判/冲突/失败），但没有可自动推进的建议 ⇒ 交人判',
              closes: '未决项的处置方向',
              cost: { known: false, why: '未决时不做成本估计' },
              if_skipped: '保持未决（不是通过，也不是没活干）',
            }),
          ]
        : [];
    return {
      ...base,
      actions: safe,
      deferred: [],
      open_gaps: openList,
      out_of_scope: outOfScope.sort((a, b) => (a.id < b.id ? -1 : 1)),
      widen,
      no_op: standing === 'no_op',
    };
  }

  // ── 确定排序：规则号 → 依赖深度（缺失/成环排最后）→ 相关度 → 成本 → action → target。
  const { depth, problems } = analyzeDeps(kept);
  const ranked = [...kept].sort((x, y) => {
    if (x.rule !== y.rule) return x.rule - y.rule;
    const dx = depth.get(actionKey(x)) ?? 0;
    const dy = depth.get(actionKey(y)) ?? 0;
    if (dx !== dy) return dx - dy;
    const rx = goalRelevance(frame, x.target);
    const ry = goalRelevance(frame, y.target);
    if (rx !== ry) return rx - ry;
    const [kx, mx] = costRank(x.cost);
    const [ky, my] = costRank(y.cost);
    if (kx !== ky) return kx - ky;
    if (mx !== my) return mx - my;
    if (x.action !== y.action) return x.action < y.action ? -1 : 1;
    return x.target < y.target ? -1 : x.target > y.target ? 1 : 0;
  });

  const seen = new Set<string>();
  const unique: ShadowAction[] = [];
  for (const a of ranked) {
    const key = `${actionKey(a)}#${a.gap}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }

  const actions = unique.slice(0, budget);
  const deferred = unique.slice(budget);
  const freshFail = (frame.signals ?? []).filter((s) => s.kind === 'test' && s.verdict === 'fail' && s.freshness === 'fresh').length;
  const unsupportedOpen = (frame.signals ?? []).filter(
    (s) => s.verdict === 'unsupported' && s.reason !== 'retired',
  ).length;

  return {
    ...base,
    actions,
    deferred,
    open_gaps: [...openSet].sort(),
    out_of_scope: outOfScope.sort((a, b) => (a.id < b.id ? -1 : 1)),
    widen,
    dependency_problems: problems,
    no_op:
      planStanding({
        open_gaps: [...openSet],
        undetermined: base.undetermined.length,
        conflicts: (frame.conflicts ?? []).length,
        fresh_fail: freshFail,
        unsupported: unsupportedOpen,
        actions: actions.length,
        deferred: deferred.length,
      }) === 'no_op',
    limitations: [
      ...base.limitations,
      '影子模式**未执行**任何建议：`open_gaps` 是当前缺口，`would_close_gaps` 才是预计收益',
      // ★ S-01：未声明范围时允许全量，但必须显式说"这不算已授权全仓"
      ...(fullUnscopedGaps.length > 0
        ? [`goal.scope 未声明 ⇒ 全量验证建议（${[...new Set(fullUnscopedGaps)].sort().join(', ')}）不代表目标已授权全仓`]
        : []),
      ...(deferred.length > 0 ? [`预算 ${budget} 只够给 ${actions.length} 条建议：未选 ${deferred.length} 条仍开启`] : []),
      ...(problems.length > 0 ? [`依赖诊断 ${problems.length} 条（缺失/成环），相关动作排到最后`] : []),
    ],
  };
}

/** 只读断言：任何写/完成/提交/回滚动作混进计划都必须当场炸（测试与脚本共用同一把尺）。 */
const FORBIDDEN_ACTION_RE = /^(write|complete|commit|rollback|edit|apply|publish|merge)\b/i;

export function assertReadOnlyPlan(plan: ShadowPlan): void {
  const all = [...plan.actions, ...plan.deferred];
  for (const a of all) {
    if (!(SHADOW_ACTIONS as readonly string[]).includes(a.action)) {
      throw new Error(`影子计划里出现词表外动作：${String(a.action)}（只读计划不许有写/完成/提交/回滚）`);
    }
    if (FORBIDDEN_ACTION_RE.test(a.action)) throw new Error(`影子计划里出现写类动作：${a.action}`);
  }
}

/** 结构性摘要（用于"同输入两次运行逐字相同"的比较）；★ 不含 `generated_at`。 */
export function planDigest(plan: ShadowPlan): string {
  const strip = (a: ShadowAction): unknown => ({
    action: a.action,
    rule: a.rule,
    target: a.target,
    gap: a.gap,
    evidence: a.evidence,
    why_before_others: a.why_before_others,
    depends_on: a.depends_on,
    blocked_by: a.blocked_by,
    closes: a.closes,
    cost: a.cost,
    if_skipped: a.if_skipped,
    would_close_gaps: a.would_close_gaps,
  });
  return JSON.stringify({
    project: plan.project,
    goal: plan.goal,
    content_version: plan.content_version,
    actions: plan.actions.map(strip),
    deferred: plan.deferred.map(strip),
    open_gaps: plan.open_gaps,
    out_of_scope: plan.out_of_scope,
    widen: plan.widen,
    dependency_problems: plan.dependency_problems,
    excluded: plan.excluded,
    undetermined: plan.undetermined,
    no_op: plan.no_op,
    limitations: plan.limitations,
  });
}

export type { EvidenceSignal, FrameGap };
