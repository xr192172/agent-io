/**
 * approve_gated —— 提案审批的**编排**（2026-10-05，P4 步骤 5）
 *
 * 搬迁自 `go-observe/probe/proposal.go:161-226`（`ApproveGated`）+ `:257-267`（`freeze`）。
 * 四层全部就位后，本文件只做串接与**冻结处置**。
 *
 * ## 流程（照搬 Go 的编排，处置按 2026-10-05 用户裁定的 B 方案改严）
 *   1. 取提案 → 状态机守卫（仅 pending 可审批）
 *   2. 校验声明集（`validateDecls`）
 *   3. **L1 规则回归门** ⇒ 有无谓词声明？
 *   4. 无谓词 ⇒ **L2 decl 级 LLM 复核**（不可用/失败/覆盖不全 ⇒ **冻结**）
 *   5. **L3 覆盖校验**（每条无谓词声明都要有结论）
 *   6. **L4 定稿**（复核非 ok ⇒ **抛错 ⇒ 冻结**；这是 B 方案的关键改动）
 *   7. loop 增量提案按键合并（其余来源整集替换）
 *   8. `DesignDSLStore.save` 定稿 v+1，`verified_by` 证据写进审计历史
 *   9. **定稿成功后才**把验证证据落回提案
 *
 * ## 冻结的语义（照搬 Go `:257-267`）
 *   提案置 `rejected` + `verified_by = "frozen: <原因>"`，
 *   **权威 `dsl.json` 完全不动** ⇒ 判定继续用旧版。
 *   这是本仓少见的**正确**失败模式：不静默、不假装通过、明确说清"退回去了"。
 *   ★ 与"拒绝提案"（`ProposalStore.reject`）的差别：freeze 带**机器可读的冻结原因**。
 */

import { DesignDSLStore } from './dsl_store.js';
import { ProposalStore, PROPOSAL_APPROVED, PROPOSAL_PENDING, PROPOSAL_REJECTED, validateDecls, type Proposal } from './proposal_store.js';
import {
  finalizeDecls,
  mergeLoopDecls,
  droppedDeclCount,
  regressionDescribe,
  regressionEvidence,
  verifyLLMCoverage,
  verifyRuleRegression,
  type DeclVerdict,
} from './verify_gate.js';
import { reviewDeclsWithLLM } from './decl_review.js';

export interface ApproveResult {
  /** 定稿后的 DSL 版本号；被冻结时为 0 */
  version: number;
  frozen: boolean;
  /** 冻结原因（frozen 为 true 时有值） */
  reason?: string;
  proposal: Proposal;
}

/** 冻结：提案置 rejected + 记机器可读的冻结原因；**权威 dsl.json 完全不动**（照搬 Go `:257-267`）。 */
function freeze(ps: ProposalStore, p: Proposal, reason: string, evidence: string, detail: string): ApproveResult {
  p.status = PROPOSAL_REJECTED;
  p.reviewed_at = new Date().toISOString();
  p.verified_by = `frozen: ${reason}`;
  p.verification = detail;
  ps.write(p);
  return { version: 0, frozen: true, reason: `${reason}；${evidence}`, proposal: p };
}

/**
 * 审批并定稿。
 * @param useLlm 缺省 false ⇒ 不调用 LLM（无谓词声明一律冻结）。**显式 opt-in**，不默认开。
 */
export async function approveGated(
  ps: ProposalStore,
  dsl: DesignDSLStore,
  id: string,
  reviewer: string,
  useLlm = false,
): Promise<ApproveResult> {
  const p = ps.get(id);
  if (p.status !== PROPOSAL_PENDING) {
    throw new Error(`approve: 提案 ${id} 状态为 ${p.status}，仅 pending 可审批`);
  }
  validateDecls(p.decls);

  // ── L1 规则回归门 ──
  const reg = verifyRuleRegression(p.decls);
  const evidence0 = regressionEvidence(reg, 0);

  // ── L2 decl 级 LLM 复核（仅无谓词声明需要）──
  let llmVerdicts: DeclVerdict[] = [];
  if (reg.uncovered.length > 0) {
    if (!useLlm) {
      return freeze(ps, p, 'LLM 复核不可用（未 opt-in），存在无确定性谓词的声明，定稿冻结', evidence0, regressionDescribe(reg));
    }
    const r = await reviewDeclsWithLLM(p.decls, reg.uncovered);
    llmVerdicts = r.verdicts;
    if (!r.ok) {
      return freeze(ps, p, r.error ?? 'LLM 复核失败', evidence0, regressionDescribe(reg));
    }
    // ── L3 覆盖校验 ──
    try {
      verifyLLMCoverage(reg.uncovered, llmVerdicts);
    } catch (e) {
      return freeze(ps, p, `LLM 复核未覆盖全部无谓词声明: ${(e as Error).message}`, evidence0, regressionDescribe(reg));
    }
  }

  // ── L4 定稿（★ B 方案：复核非 ok ⇒ 抛错 ⇒ 冻结，绝不半放行）──
  let final: ReturnType<typeof finalizeDecls>;
  const evidence = regressionEvidence(reg, llmVerdicts.length);
  try {
    final = finalizeDecls(p.decls, reg, llmVerdicts);
  } catch (e) {
    return freeze(ps, p, (e as Error).message, evidence, regressionDescribe(reg));
  }

  // ── 定稿声明集：loop 增量提案按键合并，其余来源整集替换 ──
  const cur = dsl.load(); // 文件不存在 ⇒ null（照搬 Go 的 os.IsNotExist 分支）
  let saveDecls = final;
  if (p.source === 'loop' && cur) saveDecls = mergeLoopDecls(cur.decls, final);

  // ★ 整集替换的丢失数写进审计证据（manual/llm-revise 提案不带全集时会静默 wipe 掉其余契约）
  const dropped = p.source === 'loop' ? 0 : droppedDeclCount(cur?.decls ?? null, saveDecls);
  const audit = dropped > 0 ? `${evidence}；⚠ 整集替换丢失 ${dropped} 条既有声明` : evidence;

  const ver = dsl.save(saveDecls, p.reason, p.source, { action: 'approve', verification: audit });

  // ── 定稿成功后才把验证证据落回提案 ──
  p.decls = final;
  p.status = PROPOSAL_APPROVED;
  p.reviewed_at = new Date().toISOString();
  p.reviewer = reviewer;
  p.verified_by = audit;
  p.verification = regressionDescribe(reg);
  ps.write(p);
  return { version: ver, frozen: false, proposal: p };
}
