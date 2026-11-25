/**
 * protected_rules.ts —— H3 裁判独立：受保护规则版本钉验（2026-11-26）。
 *
 * ## 为什么有这一层
 * 判据尺（裁判核 + 判据清单 + 设计册）是「什么算过 / 算红」的标准。尺子被改而无独立批准 ⇒
 * 可以把红判据悄悄改绿（自批自尺）。本层把当前加载的规则版本指纹与仓内审批 ledger 比对，
 * 不一致 ⇒ **fail-closed 拒判**（不拿未审批的尺子下结论，比照 V3 untrusted 不得 exit0）。
 *
 * ## 两条载体（Main 裁 A）
 * · **裁判核 / 清单 / 端口（TS，含 render 闭包、静态 import）**：无法 `git show` 装载，
 *   取工作树源码文件 sha256、按 rel 排序拼接成 `rules_sha`，钉 ledger 哈希比对。
 * · **设计册 JSON（无函数）**：受保护 ref 快照 tag `rules-protected`，`git rev-parse
 *   rules-protected:<rel>` 取受保护 blob SHA，与 ledger 记录比对；工作树册 blob 同时比对。
 *
 * ## 审批 ledger（append-only）
 * `.agent-io/protected-approvals.jsonl`，每行一条 entry；**只追加、不改写历史**。改尺子必须
 * 先有一条独立批准 entry（`scripts/approve-rules.mjs` 算新哈希 → 写 entry → 前移 tag）。
 * 无 entry / 指纹不符 ⇒ fail-closed。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gitAvailable } from '../exec_guard.js';

/** 受保护规则源码集合（相对仓根；裁判核 + 清单 + 端口契约）。本清单本身变更也要走审批 entry。 */
export const RULE_SOURCE_FILES = [
  'src/application/design/intent/expectations.ts',
  'src/application/design/index.ts',
  'src/domain/expectation_kinds.ts',
  'src/domain/expectation.ts',
  'src/domain/judge_port.ts',
] as const;

export const PROTECTED_TAG = 'rules-protected';
export const APPROVAL_LEDGER_REL = '.agent-io/protected-approvals.jsonl';

const sha256 = (buf: Buffer | string): string => crypto.createHash('sha256').update(buf).digest('hex');
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** 一条审批 entry（append-only jsonl 一行）。 */
export interface ApprovalEntry {
  schema: 1;
  approved_at: string;
  approver: string;
  note: string;
  rules_sha: string;
  books: Record<string, string>;
  book_ref: string;
  tested_commit: string;
}

export interface ProtectedVerification {
  ok: boolean;
  reasons: string[];
  /** 不阻断判定的提示（如 HEAD 领先审批基线一个纯台账 commit）；不并入 fail-closed reasons。 */
  warnings: string[];
  /** 是否处在受保护基线管理下（有审批 entry 或受保护 tag）。false = 隔离夹具 / 未纳入基线，不强制 fail-closed。 */
  protected: boolean;
  rulesSha: string;
  testedCommit: string | null;
  books: Record<string, string>;
  entry: ApprovalEntry | null;
}

function git(root: string, args: string[]): { ok: boolean; out: string; err: string } {
  // ★ 命令注入纪律：argv 逐项传递，不拼命令行（与 verify_project#changedFromGit 同一口径）。
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').split('\n')[0] };
}

/** 册文件 rel 清单（`.agent-io/design/*.dsl.json`，与 judge-all 同一目录口径）。 */
export function listBookFiles(root: string): string[] {
  const dir = path.join(root, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => norm(path.join('.agent-io', 'design', f)))
    .sort();
}

/** 工作树某文件的 git blob SHA（`git hash-object`）；读不出返回 null。 */
export function worktreeBlobSha(root: string, rel: string): string | null {
  const r = git(root, ['hash-object', rel]);
  return r.ok ? r.out : null;
}

/** 受保护 tag 内某路径的 blob SHA；tag / 路径不存在返回 null。 */
export function tagBlobSha(root: string, rel: string): string | null {
  const r = git(root, ['rev-parse', `${PROTECTED_TAG}:${rel}`]);
  return r.ok ? r.out : null;
}

/** 当前 HEAD commit SHA；读不出返回 null。 */
export function headCommit(root: string): string | null {
  const r = git(root, ['rev-parse', 'HEAD']);
  return r.ok ? r.out : null;
}

/**
 * 规则源码指纹：各文件 sha256，按 rel 排序拼接后整体哈希（范式 verified_snapshot#contentVersion）。
 * 缺文件 ⇒ 该文件摘要记空串并列入 `missing`，由校验侧 fail-closed 点名。
 */
export function rulesSourceFingerprint(root: string): { sha: string; files: Record<string, string>; missing: string[] } {
  const files: Record<string, string> = {};
  const missing: string[] = [];
  for (const rel of RULE_SOURCE_FILES) {
    const abs = path.join(root, rel);
    let digest = '';
    try {
      digest = sha256(fs.readFileSync(abs));
    } catch {
      missing.push(rel);
    }
    files[rel] = digest;
  }
  const sha = sha256(
    Object.keys(files)
      .sort()
      .map((k) => `${k}:${files[k]}`)
      .join('\n'),
  );
  return { sha, files, missing };
}

/** 读 ledger 最后一条合法 entry；文件不存在 / 全坏 ⇒ null。 */
export function loadLatestApproval(root: string): ApprovalEntry | null {
  const abs = path.join(root, APPROVAL_LEDGER_REL);
  if (!fs.existsSync(abs)) return null;
  const lines = fs
    .readFileSync(abs, 'utf-8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as ApprovalEntry;
      if (parsed && parsed.schema === 1 && typeof parsed.rules_sha === 'string') return parsed;
    } catch {
      /* 坏行跳过，继续往上找最后一条合法 entry */
    }
  }
  return null;
}

/**
 * 校验当前规则版本与最新审批 entry 一致；不一致 fail-closed。
 * 比对项：`rules_sha`、各册工作树 blob == ledger、tag blob == ledger、tag 指向 commit == entry.tested_commit。
 *
 * ## 环境口径（两条，别混）
 * · **受保护环境**（git 仓且存在审批 entry 或受保护 tag）⇒ 强制比对，任一不符 fail-closed 拒判；
 * · **非受保护环境**（隔离临时夹具 / 尚未引导基线）⇒ 不强制：`protected=false`、`ok=true`，指纹照常记录。
 *   这不是放行未审批尺子：没有基线时无从比对；主仓引导 ledger+tag 后即进入强制态。ledger 入库 tracked，
 *   删基线本身是显式动作，CI 可见。
 */
export function verifyProtectedRules(root: string): ProtectedVerification {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const fp = rulesSourceFingerprint(root);
  const books: Record<string, string> = {};
  for (const rel of listBookFiles(root)) books[rel] = worktreeBlobSha(root, rel) ?? '';
  const testedCommit = headCommit(root);
  const entry = loadLatestApproval(root);

  const inside = git(root, ['rev-parse', '--is-inside-work-tree']).ok;
  const tagExists = git(root, ['rev-parse', PROTECTED_TAG]).ok;
  const managed = inside && (entry !== null || tagExists);

  const base = { rulesSha: fp.sha, testedCommit, books, entry };

  if (!gitAvailable()) {
    // 非 git 环境（隔离夹具常见）⇒ 未纳入基线，不强制。
    return { ok: true, reasons: [], warnings: [], protected: false, ...base };
  }
  if (fp.missing.length) reasons.push(`规则源码缺文件：${fp.missing.join(', ')}`);
  if (!managed) {
    // 非受保护环境：无基线可比，不 fail-closed；缺文件也只标注（夹具可能不全）。
    return { ok: true, reasons: [], warnings: [], protected: false, ...base };
  }
  if (!entry) {
    reasons.push(`受保护 tag ${PROTECTED_TAG} 存在但审批 ledger 无 entry ⇒ fail-closed 拒判`);
    return { ok: false, reasons, warnings: [], protected: true, ...base };
  }

  if (fp.sha !== entry.rules_sha) {
    reasons.push(
      `rules_sha 不符：当前 ${fp.sha.slice(0, 12)} ≠ 审批 ${entry.rules_sha.slice(0, 12)}（裁判核/清单有未审批改动）`,
    );
  }

  const entryBooks = entry.books ?? {};
  for (const rel of Object.keys(books).sort()) {
    const cur = books[rel];
    const approved = entryBooks[rel];
    if (!approved) {
      reasons.push(`册 ${rel} 不在审批 ledger 内 ⇒ 未审批册`);
      continue;
    }
    if (cur !== approved) reasons.push(`册 ${rel} 工作树 blob ≠ 审批记录（未审批改册）`);
    const tagSha = tagBlobSha(root, rel);
    if (tagSha === null) reasons.push(`受保护 tag ${PROTECTED_TAG} 内无 ${rel}（tag 不可达/未前移）`);
    else if (tagSha !== approved) reasons.push(`册 ${rel} tag blob ≠ 审批记录`);
  }
  for (const rel of Object.keys(entryBooks)) {
    if (!(rel in books)) reasons.push(`审批册 ${rel} 在工作树缺失`);
  }

  if (!tagExists) reasons.push(`受保护 tag ${PROTECTED_TAG} 不存在`);
  else if (entry.tested_commit && testedCommit && testedCommit !== entry.tested_commit) {
    // 提示性（不 fail-closed）：HEAD 领先审批基线 —— rules_sha / book_sha 是主防线；commit 不一致
    // 可能只是基线之后追加了纯台账 / 文档 commit（规则版本未变），单列 warning 供归因，不并入拒判。
    warnings.push(`被测 HEAD ${testedCommit.slice(0, 12)} ≠ 审批 tested_commit ${entry.tested_commit.slice(0, 12)}`);
  }

  return { ok: reasons.length === 0, reasons, warnings, protected: true, ...base };
}
