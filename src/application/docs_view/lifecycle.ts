/**
 * 九态生命周期状态机（企划 §2.2 冻结 · Main 终局语义一次冻结）。
 *
 * 状态集：`ingested / parsed / translated / blocked / adjudicated / committed / projected / stale / archived`。
 *
 * ## 两层状态模型（勿混）
 * · **生命周期态（本文件）**：一条权威事实/候选从外部吸收到投影的流水线位置（A→E）。
 * · **投影对账态**：块核 check 对「权威→可再生视图」的三向对账结果（current/stale/hand-edited/…），
 *   见 `check_doc_blocks.ts`；那是视图新鲜度，不是流水线位置。
 *
 * ## 终局倒推约束（本批即按完整形状建模，不留过渡期临时内核）
 * · `blocked` / `unknown` / 未验证 **不得** 迁到 `committed`；不可判不得到权威。
 * · 语义翻译/提取路缺模型 ⇒ `blocked/unsupported`，不 Noop 成功、不原文兜底（§2.3）。
 * · 本批只施工 C 内部投影（机械、可确定性重建）；`parsed/translated/blocked/adjudicated` 是为后续 A 段
 *   model-in-the-loop 预留的契约位，本批不施工语义翻译，也不硬造伪判据。
 */

export const LIFECYCLE_STATES = [
  'ingested',
  'parsed',
  'translated',
  'blocked',
  'adjudicated',
  'committed',
  'projected',
  'stale',
  'archived',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function isLifecycleState(s: string): s is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(s);
}

/**
 * 允许的迁移边（按 §2.2 表 + §2.3 不可判边界）。
 * · `ingested → parsed`：结构校验入口。
 * · `parsed → translated | blocked`：脏行/缺模型落 blocked。
 * · `translated → adjudicated | blocked`：候选过门才进裁决；冲突/缺模型落 blocked。
 * · `blocked → adjudicated | translated`：人/主控裁决后回候选或落裁决。
 * · `adjudicated → committed`：单写者落内部权威的唯一入口。
 * · `committed → projected`：权威 → 可再生视图。
 * · `projected → stale`：权威前进未重生成；`stale → projected`：重生成回收。
 * · 任意非 archived → archived；`archived → ingested`：可重新导入但不等于重新采纳。
 */
export const FORWARD_TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  ingested: ['parsed', 'archived'],
  parsed: ['translated', 'blocked', 'archived'],
  translated: ['adjudicated', 'blocked', 'archived'],
  blocked: ['adjudicated', 'translated', 'archived'],
  adjudicated: ['committed', 'archived'],
  committed: ['projected', 'archived'],
  projected: ['stale', 'archived'],
  stale: ['projected', 'archived'],
  archived: ['ingested'],
};

/** 能落到 `committed` 的前置态（不可判/未验证不在其列） */
const COMMITTABLE_FROM: ReadonlySet<LifecycleState> = new Set(['adjudicated']);

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return FORWARD_TRANSITIONS[from].includes(to);
}

/** 迁 `committed` 的闸：只有 `adjudicated` 可落权威；blocked/unknown/未验证一律拒绝（§2.2/§7.6） */
export function assertCommittable(state: LifecycleState): { ok: boolean; reason: string } {
  if (COMMITTABLE_FROM.has(state)) return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `状态 \`${state}\` 不可落 committed（不可判/未验证/候选不得进权威；committed 前置态 = adjudicated）`,
  };
}

/** 语义路（模型不可或缺）状态：缺模型/调用失败/解析失败停留于此，不伪装通过（§2.3） */
export const SEMANTIC_BLOCKED_STATES: ReadonlySet<LifecycleState> = new Set(['blocked']);

/** 终态/归档态：历史 append-only 证据，不挂 fresh 门 */
export const ARCHIVED_STATE: LifecycleState = 'archived';
