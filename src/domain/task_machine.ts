/**
 * task_machine.ts —— 任务状态机：**状态迁移与可领性判定**。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的节点 `file_src_domain_task_machine_ts`
 * （`task_plan.state_machine` 的 `transitions` / `patrols` 是本文件的语义来源）。
 *
 * ## ★★ 前态判据（NEGATIVE_KINDS：`edge-absent` 一类）必须被**显式剔除**
 * 「前态判据」= 在**未施工**时**天然成立**的判据（`edge-absent`："不许依赖 X" —— 还没写当然不依赖）。
 * ⇒ 若拿它们一起判"是否已满足"，**每一张刚出生的卡都会「全过」** ⇒
 *   ★ **任务还没领就被误收口**。所以判定前必须先剔除（只此一处：{@link positiveExpectations}）。
 *
 * ## 判定器复用（★ 不新造第二把尺）
 * 判据的判定一律走既有 `judgeExpectations`（`application/design/intent/expectations.ts`）——
 * 它已经会区分 `pass / fail / unsupported`，且 `unsupported` **不算通过**。
 * 本文件**只**做三件事：① 剔前态判据 ② 编排判定 ③ 出迁移判据 / 租约回收。
 *
 * ## 迁移表（★ 逐条照设计 DSL；`candidate → done` **不实现**）
 * 见 {@link TRANSITIONS}。其中 `t_done_from_candidate` 带
 * `blocked_by_open_question: 'OQ1'` ⇒ **声明为存在但 `enabled:false`**：
 * ★ **没有任何代码路径**能执行它，等用户裁定（"『已满足』的卡：自动收口还是只提示"）。
 */
import { judgeExpectations, type ExpectationsReport } from '../application/design/intent/expectations.js';
import type { Expectation } from './expectation.js';
import { isTaskState, type TaskSpec, type TaskState } from './task_schema.js';

/**
 * ★★ **前态判据集合**（`edge-absent` 一类）—— 判定前必须剔除。
 *
 * | kind | 为什么算前态判据 |
 * |---|---|
 * | `edge-absent` | "**不许**依赖 X" 在**未施工**时天然成立（还没写当然不依赖）⇒ 拿它判"已满足"= 假绿 |
 *
 * ★ **为什么不把 `call-exists` 也算进来**（`docs/plan-task-system.md:11` 把它与 `edge-absent` 并列）：
 *   `call-exists` 要求的是"**必须**调用 X"——**没调用就是不满足**，它在未施工时**不成立**
 *   ⇒ 把它剔掉会让"该调的没调"**永远不判**（那是假绿的另一半）。
 *   ⇒ 本表只收**在未施工时天然为真**的那一类；`call-exists` 不在其中。★ 此分歧已列待裁（见报告 OQ8）。
 */
export const NEGATIVE_KINDS = ['edge-absent'] as const;

/** 前态判据的 kind 之一。 */
export type NegativeKind = (typeof NEGATIVE_KINDS)[number];

/** 这条判据是不是「前态判据」（未施工时天然成立）。 */
export function isNegativeExpectation(e: Expectation): boolean {
  return (NEGATIVE_KINDS as readonly string[]).includes(e.kind);
}

/**
 * **剔除前态判据**（唯一一处 —— 谁要判"是否已满足"都必须走这里，别各自过滤一遍）。
 * ★ 空集**不**是"全过"（真空真会误收口）—— 这里只负责剔，空集怎么办由调用方明写（见 {@link canClaim}）。
 */
export function positiveExpectations(expectations: readonly Expectation[]): Expectation[] {
  return expectations.filter((e) => !isNegativeExpectation(e));
}

/** `canClaim` 的结论（★ 带理由 + 原始报告 ⇒ 拒绝时能说清"卡在哪一条"）。 */
export interface CanClaimVerdict {
  ok: boolean;
  reason: string;
  /** ★ 真正参与判定的那批（= 剔前态判据后的剩余集合） */
  judged: readonly Expectation[];
  /** 判定器原样报告（★ 不落盘、不缓存 —— 读数永远现算） */
  report?: ExpectationsReport;
}

/**
 * ★★ **可领性判定**（设计 DSL：`task_machine` 节点的 `canClaim`）。
 *
 * ## 判据（逐条对应 `task_plan.state_machine.transitions[t_claim].guard.clauses`）
 * 1. 剔前态判据（{@link NEGATIVE_KINDS}）—— ★ 不剔 ⇒ 未施工的卡天然"全过" ⇒ 误收口；
 * 2. 剩余条数 **> 0**（空集不按"全过"算 —— 真空真会误收口，见 OQ5）；
 * 3. 剩余判据 `judgeExpectations` 判定：`unsupported === 0`（★ **判不了 ≠ 通过**）；
 * 4. 且 `failed === 0`（剔前态后**全过**）。
 *
 * ## ★ 已知语义张力（已列待裁，不在此静默改）
 * 本判据与 `t_done_from_claimed` 的判据**同形**，而 `docs/plan-task-system.md` 的表格写的是
 * "剔除前态判据后期望**未**全过"。两种写法**相反**，不能同时成立（详见报告 OQ8 / 补丁清单）。
 * 本实现**照设计 DSL 的 `task_plan` 逐字**（用户裁定"语义必须照设计 DSL"），故取"**全过**"。
 *
 * @param card  任务格（`state` 必须是 `candidate` 才谈得上"领"；本函数**只判判据**，不判状态）
 * @param opts.root 被分析项目的根（`judgeExpectations` 要拿它去读代码 / 索引）
 */
export async function canClaim(card: TaskSpec, opts: { root: string }): Promise<CanClaimVerdict> {
  const judged = positiveExpectations(card.expectations);

  // ★ 空集不按"全过"算（OQ5：真空真 ⇒ 未领卡会被自动收口）
  if (judged.length === 0) {
    return {
      ok: false,
      reason: '剔前态判据后一条不剩（空集不按「全过」算）⇒ 判不了，不许据此收口',
      judged,
    };
  }

  const report = await judgeExpectations(
    opts.root,
    judged.map((expectation) => ({ node_id: card.id, node_label: card.summary, expectation })),
  );

  if (report.unsupported > 0) {
    return {
      ok: false,
      reason: `剔前态判据后仍有 ${report.unsupported} 条**判不了**（unsupported 既不算过也不算不过）`,
      judged,
      report,
    };
  }
  if (report.failed > 0) {
    return { ok: false, reason: `剔前态判据后仍有 ${report.failed} 条**未满足**`, judged, report };
  }
  return {
    ok: true,
    reason: `剔前态判据后 ${report.passed} 条**全过**（前态判据 ${card.expectations.length - judged.length} 条已剔除）`,
    judged,
    report,
  };
}

// ─────────────────────────────────────────────────────────────
// 租约回收（TTL）
// ─────────────────────────────────────────────────────────────

/** 一次**租约过期**（`claimed_at` 太久没人续）—— ★ 它是一个**事件**，不是一个状态改动。 */
export interface LeaseReleaseEvent {
  id: string;
  reason: 'lease_ttl';
  /** 判定时刻（ISO 8601） */
  at: string;
  /** 领取时刻（原样带出，便于对账） */
  claimed_at: string;
  age_ms: number;
  ttl_ms: number;
}

/**
 * ★★ **TTL 超时回收**（设计 DSL：`task_machine` 节点的 `releaseIfExpired`）。
 *
 * ## 为什么非有它不可
 * `claimed_at` **不配超时就是死锁字段**：领了卡不走（人跑了 / 进程死了）⇒ 卡永远停在 `claimed`，
 * 谁也领不走。`patrols.lease_ttl` 的红判据就是它（`count(...) > 0` ⇒ 红）。
 *
 * ## 形态（★ 两条都是**有意**的）
 * 1. **纯函数**：只**产出事件**，**不改任何 state** ——
 *    设计 DSL 的 `t_release` guard 逐字写着"由 `releaseIfExpired` 产出 release 事件后再回 candidate，
 *    ★ **不得静默改 state**"（静默改 = 第二处权威）。
 * 2. **判不了就不判**：`state !== 'claimed'` / 缺 `claimed_at` / `claimed_at` 不是合法时间
 *    ⇒ **跳过**（不把"取不到"读成"没超时"，也不读成"超时了"）。
 *
 * @param cards 全部任务格
 * @param nowMs 判定时刻（epoch ms；★ 显式传入而**不在函数里取 now** ⇒ 可复现）
 * @param ttlMs 租约时长（★ 取值待裁，见 OQ2/OQ6 —— 本函数**不写死**任何默认值）
 */
export function releaseIfExpired(
  cards: readonly TaskSpec[],
  nowMs: number,
  ttlMs: number,
): LeaseReleaseEvent[] {
  const out: LeaseReleaseEvent[] = [];
  for (const card of cards) {
    // ★ 运行期守卫：状态从 JSON 读回时静态类型不再有保证
    if (!isTaskState(card.state) || card.state !== 'claimed') continue;
    if (!card.claimed_at) continue; // 没有 claimed_at ⇒ 判不了，不当过期（不静默改 state）
    const claimedMs = Date.parse(card.claimed_at);
    if (!Number.isFinite(claimedMs)) continue; // 时间不合法 ⇒ 同上
    const ageMs = nowMs - claimedMs;
    if (ageMs > ttlMs) {
      out.push({
        id: card.id,
        reason: 'lease_ttl',
        at: new Date(nowMs).toISOString(),
        claimed_at: card.claimed_at,
        age_ms: ageMs,
        ttl_ms: ttlMs,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 迁移表（★ 逐条照设计 DSL 的 task_plan.state_machine.transitions）
// ─────────────────────────────────────────────────────────────

/** 一条迁移（`guard.clauses` 是**人读判据**；机器可判的那部分由本模块的函数实现）。 */
export interface TaskTransition {
  id: string;
  from: TaskState;
  to: TaskState;
  /**
   * ★ `false` ⇒ **本笔没有实现它**，`applicableTransitions` 不会返回它。
   *   用到它的唯一情形是被未决项挡住（见 `blocked_by_open_question`）。
   */
  enabled: boolean;
  guard: {
    clauses: readonly string[];
    /** ★ 该迁移被哪条未决项挡住（未结题 ⇒ 不许启用） */
    blocked_by_open_question?: string;
  };
}

/**
 * ★★ **迁移表**（唯一住处；读处见 {@link applicableTransitions}）。
 *
 * ★ `t_done_from_candidate`（`candidate → done`）带 `blocked_by_open_question: 'OQ1'`
 *   ⇒ **`enabled: false`**：设计 DSL 明写"仅当 OQ1 裁定为『自动收口』才允许存在；否则此迁移必须不存在"，
 *   而 OQ1 **用户尚未拍** ⇒ ★ **本笔不实现它**（没有任何代码路径会执行它）。
 *   ★ 它留在表里 = 让"被未决项挡住的迁移"**可见**（否则"少了一条迁移"与"没想到"分不清）。
 */
export const TRANSITIONS: readonly TaskTransition[] = [
  {
    id: 't_claim',
    from: 'candidate',
    to: 'claimed',
    enabled: true,
    guard: {
      clauses: [
        'canClaim(card) === true',
        '★ 剔前态判据（NEGATIVE_KINDS）后剩余 expectations 全过（条数必须 > 0）',
        'target 在 DB 存在（不存在则走 t_void）',
        'CAS：state=candidate ∧ owner IS NULL 时才写 owner（changes === 1）',
      ],
    },
  },
  {
    id: 't_void',
    from: 'candidate',
    to: 'void',
    enabled: true,
    guard: {
      clauses: ['target 在 DB 查不到（files / edges 任一查无此 target）'],
    },
  },
  {
    id: 't_release',
    from: 'claimed',
    to: 'candidate',
    enabled: true,
    guard: {
      clauses: [
        '显式 release 事件（带 by + reason），或',
        'now - claimed_at > TTL：由 releaseIfExpired 产出 release 事件后再回 candidate，★ 不得静默改 state',
      ],
    },
  },
  {
    id: 't_done_from_claimed',
    from: 'claimed',
    to: 'done',
    enabled: true,
    guard: {
      clauses: [
        'owner !== null（★ 必须已领）',
        'judgeExpectations 的 failed === 0 且剔前态后剩余条数 > 0',
        'validateProgressEvidence 过（★ 复用既有证据闸，不新造第二把尺）',
      ],
    },
  },
  {
    id: 't_done_from_candidate',
    from: 'candidate',
    to: 'done',
    // ★★ OQ1 未拍 ⇒ 不实现（设计 DSL 逐字："否则此迁移必须不存在"）
    enabled: false,
    guard: {
      blocked_by_open_question: 'OQ1',
      clauses: [
        '仅当 OQ1 裁定为「自动收口」才允许存在；否则此迁移必须不存在',
        '即便允许，也只能由 patrol drift 的 missed_close **提示**，不得由 patrol 直接置 done',
      ],
    },
  },
  {
    id: 't_supersede',
    from: 'candidate',
    to: 'superseded',
    enabled: true,
    guard: {
      clauses: ['新卡带 replaces: <old_id>，且 old_id 在卡集里存在'],
    },
  },
];

/**
 * 某个状态**此刻可走**的迁移（★ 读处：`enabled:false` 的与终态出发的一律不返回）。
 *
 * ★ 为什么要有它，而不是让调用方自己 `TRANSITIONS.filter(...)`：
 *   漏掉 `enabled` 这一条判断 ⇒ **被 OQ1 挡住的 `candidate → done` 会被当成可走**
 *   ⇒ 那正是设计 DSL 要防的"未领就被收口"。判据只住一处。
 */
export function applicableTransitions(from: TaskState): TaskTransition[] {
  return TRANSITIONS.filter((t) => t.enabled && t.from === from);
}
