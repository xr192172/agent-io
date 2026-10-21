/**
 * observe 提案·驳回 的 use case —— **HTTP 面（`POST /api/observe/proposals/reject`）与 MCP 面
 * （`observe_proposals action=reject`）的同一段编排**。
 *
 * 原先两处各写一遍「校验 project_dir → 定位提案库 → `ps.reject` → 回读提案」。
 *
 * ★ 与 `approveObserveProposal` 的区别（判据照旧，不合并）：驳回**只动提案状态**，
 *   权威 `dsl.json` 一个字不碰；而 approve 的 `frozen:true` 是**门**拒绝了提案。
 * ★ 仅 pending 可驳回 ⇒ 状态机拒绝回 `conflict`（HTTP 409）。
 */

import { defaultDSLDir } from '../../../infrastructure/analysis/observe/dsl_store.js';
import { ProposalStore, type Proposal } from '../../../infrastructure/analysis/observe/proposal_store.js';
import { validateProjectRoot } from '../../../infrastructure/dictionary.js';

export interface RejectObserveProposalInput {
  /** 提案库所在项目根（必填，**不兜底 cwd**） */
  project_dir: string;
  /** 提案 id（`list` 会给） */
  id: string;
  /** 驳回者身份（必填：驳回同样要记「谁驳的」） */
  reviewer: string;
  /** 校验报错里点名用的上下文（HTTP 面传接口路径） */
  context: string;
}

export type RejectObserveProposalResult =
  | { ok: false; code: 'bad_request' | 'conflict'; message: string }
  | { ok: true; proposal: Proposal };

/** 驳回一条 pending 提案（权威 DSL 不动）。 */
export function rejectObserveProposal(input: RejectObserveProposalInput): RejectObserveProposalResult {
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
  if (!reviewer) {
    return {
      ok: false,
      code: 'bad_request',
      message: '缺少 reviewer：驳回同样要记"谁驳的"（第三方会话 / 系统名 / 用户名）。',
    };
  }
  const ps = new ProposalStore(defaultDSLDir(projectRoot));
  try {
    ps.reject(id, reviewer);
  } catch (e) {
    return { ok: false, code: 'conflict', message: `驳回未通过：${(e as Error).message}` };
  }
  return { ok: true, proposal: ps.get(id) };
}
