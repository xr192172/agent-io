/**
 * observe 提案·审批 的 use case —— **HTTP 面（`POST /api/observe/proposals/approve`）与 MCP 面
 * （`observe_proposals action=approve`）的同一段编排**。
 *
 * 原先两处各写一遍「校验 project_dir → 定位提案库 → `approveGated` 四层门」，
 * 而四层门（L1 规则回归 / L2 LLM 复核 / L3 覆盖 / L4 定稿）本身住在 `approve_gated.ts`。
 * 本文件只承担**门外的编排**：入参判据 + 两个 store 的接线 + 失败分类。
 *
 * ★ 失败**不打异常**，而是回 `code`：`bad_request` = 客户端参数错（HTTP 400）、
 *   `conflict` = 状态机/门拒绝（HTTP 409）。★ 失败方向恒为「拒」—— 没有「半放行」。
 */

import { approveGated, type ApproveResult } from '../../../infrastructure/analysis/observe/approve_gated.js';
import { defaultDSLDir, DesignDSLStore } from '../../../infrastructure/analysis/observe/dsl_store.js';
import { ProposalStore } from '../../../infrastructure/analysis/observe/proposal_store.js';
import { validateProjectRoot } from '../../../infrastructure/dictionary.js';

export interface ApproveObserveProposalInput {
  /** 提案库所在项目根（必填，**不兜底 cwd**） */
  project_dir: string;
  /** 提案 id（`list` 会给） */
  id: string;
  /** 审批者身份（必填：审计链不能有空） */
  reviewer: string;
  /** L2 无谓词声明的 LLM 复核开关；缺省 false ⇒ 含无谓词声明的提案默认冻结 */
  use_llm?: boolean;
  /** 校验报错里点名用的上下文（HTTP 面传接口路径） */
  context: string;
}

export type ApproveObserveProposalResult =
  | { ok: false; code: 'bad_request' | 'conflict'; message: string }
  | { ok: true; result: ApproveResult };

/** 走 `approveGated` 四层门定稿一条提案。成功后 `frozen:true` 表示**门判定不许落**（权威 DSL 一个字不动）。 */
export async function approveObserveProposal(input: ApproveObserveProposalInput): Promise<ApproveObserveProposalResult> {
  const raw = String(input.project_dir || '');
  if (!raw) return { ok: false, code: 'bad_request', message: '缺少 project_dir' };
  let projectRoot: string;
  try {
    projectRoot = validateProjectRoot(raw, input.context);
  } catch (e) {
    return { ok: false, code: 'bad_request', message: (e as Error).message };
  }
  const id = String(input.id || '');
  const reviewer = String(input.reviewer || '').trim();
  if (!id) return { ok: false, code: 'bad_request', message: '缺少 id' };
  // ★ reviewer 必填：审批必须自报身份（第三方会话 / 系统名 / 用户名）—— 审计链不能有空。
  if (!reviewer) {
    return {
      ok: false,
      code: 'bad_request',
      message:
        '缺少 reviewer：审批必须声明审批者身份（会话 id / 系统名 / 用户名）。' +
        '★ 这是为"第三方会话审批"留的位 —— 换会话调用时只改这个值，接口形状不变。',
    };
  }
  const dataDir = defaultDSLDir(projectRoot);
  try {
    const result = await approveGated(
      new ProposalStore(dataDir),
      new DesignDSLStore(dataDir),
      id,
      reviewer,
      input.use_llm === true,
    );
    return { ok: true, result };
  } catch (e) {
    // 状态机守卫（仅 pending 可审批）/ 提案不存在 ⇒ 业务冲突，不是 500
    return { ok: false, code: 'conflict', message: `审批未通过：${(e as Error).message}` };
  }
}
