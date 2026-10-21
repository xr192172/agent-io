/**
 * observe 提案·列表 的 use case —— **HTTP 面（`GET /api/observe/proposals`）与 MCP 面
 * （`observe_proposals action=list`）的同一段编排**。
 *
 * 原先两处各写一遍「`validateProjectRoot` → `defaultDSLDir` → `ProposalStore` → `list()`」
 * ⇒ 目录推导与校验口径各住一处。现在只剩一份：本文件。
 *
 * ★ 只做「定位提案库 + 列」，不渲染：HTTP 面出 JSON、MCP 面出人话，那是序列化，属于各自的面。
 */

import { defaultDSLDir } from '../../../infrastructure/analysis/observe/dsl_store.js';
import { ProposalStore, type Proposal } from '../../../infrastructure/analysis/observe/proposal_store.js';
import { validateProjectRoot } from '../../../infrastructure/dictionary.js';

export type ListObserveProposalsResult =
  | { ok: false; code: 'bad_request'; message: string }
  | {
      ok: true;
      /** 校验后的项目根（绝对路径） */
      project_root: string;
      /** 提案库目录（`<root>/.agent/observe`，与 approve/reject 同一个推导） */
      dir: string;
      proposals: Proposal[];
    };

/**
 * 列出某项目的 observe 提案（含审批证据 `verified_by` / `verification`）。
 * ★ `project_dir` 非法即抛（调用方据此回 400）；**不兜底到 cwd** —— cwd 是「另一个项目」。
 */
/**
 * 列出某项目的 observe 提案（含审批证据 `verified_by` / `verification`）。
 * ★ `project_dir` 缺/非法 ⇒ 回 `bad_request`（HTTP 400），**不兜底到 cwd** —— cwd 是「另一个项目」。
 */
export function listObserveProposals(projectDir: string, context: string): ListObserveProposalsResult {
  const raw = String(projectDir || '');
  if (!raw) return { ok: false, code: 'bad_request', message: '缺少 project_dir' };
  let projectRoot: string;
  try {
    projectRoot = validateProjectRoot(raw, context);
  } catch (e) {
    return { ok: false, code: 'bad_request', message: (e as Error).message };
  }
  const dir = defaultDSLDir(projectRoot);
  return { ok: true, project_root: projectRoot, dir, proposals: new ProposalStore(dir).list() };
}
