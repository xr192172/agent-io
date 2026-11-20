/** 当前执行资格只消费已有生命周期事实，不创建第二套维护元数据。 */
export type ExecutionEligibilityStatus = 'eligible' | 'excluded' | 'unjudgeable';

export interface ExecutionClaim {
  source: string;
  lifecycle?: string;
  nodeIntent?: string;
}

export interface ExecutionEligibility {
  status: ExecutionEligibilityStatus;
  reason: string;
}

const verdict = (status: ExecutionEligibilityStatus, reason: string): ExecutionEligibility => ({ status, reason });

/**
 * deprecated 与 to_delete 是意图/来源信号，不是当前执行排除证明。
 * 只有 retired 能排除；任何未知或冲突证据都保持 unjudgeable。
 */
export function judgeExecutionEligibility(claims: readonly ExecutionClaim[]): ExecutionEligibility {
  if (!Array.isArray(claims)) return verdict('unjudgeable', 'malformed-claims');
  let active = false;
  let retired = false;
  let lifecycleRetired = false;
  let deprecated = false;
  let toDelete = false;
  for (const claim of claims) {
    if (!claim || typeof claim !== 'object') return verdict('unjudgeable', 'malformed-claim');
    if (claim.lifecycle != null) {
      const known = ['active', 'deprecated', 'retired', 'merged', 'archived'];
      if (!known.includes(claim.lifecycle)) return verdict('unjudgeable', 'unknown-lifecycle');
      if (claim.lifecycle === 'archived') return verdict('unjudgeable', 'archived-is-write-command');
      // ★ merged 不是退休证明，也不说明当前所有者：没有显式 current owner ⇒ 判不了。
      if (claim.lifecycle === 'merged') return verdict('unjudgeable', 'merged-owner-unresolved');
      if (claim.lifecycle === 'retired') {
        retired = true;
        lifecycleRetired = true;
      } else {
        active = true;
        if (claim.lifecycle === 'deprecated') deprecated = true;
      }
    }
    if (claim.nodeIntent != null) {
      const known = ['planned', 'live', 'to_delete', 'retired'];
      if (!known.includes(claim.nodeIntent)) return verdict('unjudgeable', 'unknown-node-intent');
      if (claim.nodeIntent === 'retired') retired = true;
      else {
        active = true;
        if (claim.nodeIntent === 'to_delete') toDelete = true;
      }
    }
  }
  if (active && retired) return verdict('unjudgeable', 'conflicting-lifecycle');
  if (retired) return verdict('excluded', lifecycleRetired ? 'retired' : 'node-retired');
  if (deprecated) return verdict('eligible', 'deprecated-still-executable');
  if (toDelete) return verdict('eligible', 'node-to-delete-still-present');
  return verdict('eligible', claims.length === 0 ? 'default-active' : 'active');
}
