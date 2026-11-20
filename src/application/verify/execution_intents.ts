import { judgeExecutionEligibility, type ExecutionClaim, type ExecutionEligibilityStatus } from '../../domain/execution_eligibility.js';
import { assertLifecycle, type FileLifecycle } from '../../domain/semantic.js';
import { readDesignSheetsForGate } from '../../infrastructure/storage.js';

export interface ExecutionObjectVerdict {
  id: string;
  status: ExecutionEligibilityStatus;
  reason: string;
}

export interface TestObjectEligibility {
  eligible: string[];
  excluded: ExecutionObjectVerdict[];
  unjudgeable: ExecutionObjectVerdict[];
}

type SheetLike = {
  feature: string;
  semantic?: { files?: unknown };
  geometry?: { nodes?: unknown };
};

/** 设计册是当前生命周期事实的唯一读口；本适配器不保存第二份状态。 */
export function adjudicateTestObjects(root: string, candidates: readonly string[]): TestObjectEligibility {
  const ids = [...new Set(candidates.map((id) => id.replace(/\\/g, '/')).filter(Boolean))].sort();
  try {
    // ★ 唯一读端返回 { features, sheets, missingDir } —— 这里只要 sheets，不能把整个结果当数组。
    const { sheets } = readDesignSheetsForGate(root);
    const claimsById = new Map<string, ExecutionClaim[]>(ids.map((id) => [id, []]));
    /** 原始册证据过不了唯一校验器（assertLifecycle）的候选 ⇒ 直接 unjudgeable，不落 claim。 */
    const invalidById = new Map<string, string>();
    for (const sheet of sheets as SheetLike[]) {
      const files = sheet.semantic?.files ?? [];
      const nodes = sheet.geometry?.nodes ?? [];
      if (!Array.isArray(files) || !Array.isArray(nodes)) throw new Error(`${sheet.feature}: semantic.files/geometry.nodes 形状错误`);
      for (const file of files as Array<Record<string, unknown>>) {
        if (!file || typeof file.path !== 'string') throw new Error(`${sheet.feature}: semantic file 缺 path`);
        const id = file.path.replace(/\\/g, '/');
        const claims = claimsById.get(id);
        if (!claims) continue;
        const lifecycle = file.lifecycle;
        // ★ 未声明 ≠ 显式 active：不推 claim，交给纯裁判的 default-active；
        //   否则同册 node.intent=retired 会被误判成 active∧retired 冲突。
        if (lifecycle == null) continue;
        // ★ 原始册证据必须过唯一校验器 assertLifecycle：retired 缺理由 / merged 缺对手 /
        //   archived 缺理由 / 形状错 ⇒ 该候选 unjudgeable，不能靠默认 active 混过去。
        try {
          assertLifecycle(lifecycle as FileLifecycle);
        } catch (error) {
          invalidById.set(id, `invalid-lifecycle:${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        claims.push({
          source: `${sheet.feature}:semantic`,
          lifecycle: (lifecycle as FileLifecycle).status,
        });
      }
      for (const node of nodes as Array<Record<string, unknown>>) {
        // ★ 三种形状严格分开：
        //   ① 非对象/null ⇒ 整册形状错，所有候选 unjudgeable（不能猜它指谁）；
        //   ② path 缺失（undefined）⇒ 合法的聚合节点，不可寻址、跳过；
        //   ③ path 存在但不是 string（如 path:123）⇒ 坏册，所有候选 unjudgeable，绝不 default-active。
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
          throw new Error(`${sheet.feature}: geometry node 形状错误`);
        }
        const nodePath = (node as { path?: unknown }).path;
        if (nodePath === undefined) continue;
        if (typeof nodePath !== 'string') throw new Error(`${sheet.feature}: geometry node path 非字符串`);
        const id = nodePath.replace(/\\/g, '/');
        const claims = claimsById.get(id);
        if (!claims || node.intent === undefined) continue;
        claims.push({ source: `${sheet.feature}:geometry`, nodeIntent: String(node.intent) });
      }
    }
    const eligible: string[] = [];
    const excluded: ExecutionObjectVerdict[] = [];
    const unjudgeable: ExecutionObjectVerdict[] = [];
    for (const id of ids) {
      const invalid = invalidById.get(id);
      if (invalid) {
        unjudgeable.push({ id, status: 'unjudgeable', reason: invalid });
        continue;
      }
      const claims = claimsById.get(id) ?? [];
      const verdict = judgeExecutionEligibility(claims);
      const item = { id, status: verdict.status, reason: verdict.reason };
      if (verdict.status === 'eligible') eligible.push(id);
      else if (verdict.status === 'excluded') excluded.push(item);
      else unjudgeable.push(item);
    }
    return { eligible, excluded, unjudgeable };
  } catch (error) {
    const reason = `design-unreadable:${error instanceof Error ? error.message : String(error)}`;
    return {
      eligible: [],
      excluded: [],
      unjudgeable: ids.map((id) => ({ id, status: 'unjudgeable', reason })),
    };
  }
}
