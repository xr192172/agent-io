/**
 * proposal_store —— 修订提案的**持久化仓库**（2026-10-05，P4 步骤 4）
 *
 * 搬迁自 `observe-lang-go/probe/proposal.go` 的 **CRUD 部分**（`:23-157` + `:301-341`）。
 * ⚠ **不搬 `ApproveGated`/`freeze`/两个验证门**（`:161-298`）—— 那是 P4 步骤 5，
 *   且是全 P4 唯一有真风险的一块（需新写 decl 级 LLM 复核通道），本笔刻意不碰。
 *
 * ## 原则（照搬 Go 头注 `:3-8`，这是本模块存在的理由）
 *   **提案权与写盘权分离**：修订提案驻留 `{dir}/proposals/`，只描述"想把设计 DSL 改成什么"，
 *   **绝不触碰权威 `dsl.json`**。只有经过验证门审批（approve）后，才借 `DesignDSLStore.save`
 *   定稿为新版本并入审计链。**LLM 无直接写盘通道** —— 它只能产提案。
 *
 * 目录：{dir}/proposals/<id>.json（照搬 Go `:47`）
 *
 * ★ 两处**有意分歧**，均已核实：
 *
 * ① **ID 精度：Go 用纳秒，JS 只有毫秒**（照搬会退化）
 *    Go `nextProposalID`(`:64-67`) = `proposal-<UnixNano>-<%04d seq>`，靠 `atomic.Int64` 进程内序列
 *    保证"同纳秒创建时 ID 递增"⇒ `List` 排序确定。
 *    JS `Date.now()` 是**毫秒** ⇒ 同一毫秒内创建的提案会拿到**相同时间戳**，只靠 seq 决胜。
 *    本实现保留 `proposal-<ms>-<%04d seq>` 形状并**继续用进程内序列**兜底：
 *    形状与 Go 一致（便于人工比对与 Go 侧读取），且 `%04d` 补零保证**字典序 == 数值序**。
 *    ★ 已知局限（照搬 Go 的同一局限，非本笔引入）：序列是**进程内**的，
 *      跨进程/重启后 seq 会重归 1 ⇒ 同一毫秒内的 ID 唯一性不保证。
 *      Go 侧靠纳秒精度天然规避，TS 侧需靠 seq。**不修**：修它要引入持久序列或 UUID，超出"照搬"范围，
 *      且 `List` 的二级排序键（`id` 字典序）已保证**排序确定**（只是 ID 不唯一）。
 *
 * ② **`write` 改为原子写**（Go `:315-324` 是裸 `os.WriteFile`）
 *    Go 自己的 `dsl_store.go:201-214` 用 tmp+rename，而 `proposal.go` 这里没有 ⇒ **Go 侧自身不一致**。
 *    本实现复用 `dsl_store` 的原子写纪律（跨语言 JSON 格式不变）。
 *    ⚠ 这是**有意修正 Go 侧的不一致**，已在清单登记；若要严格对齐可退回裸写。
 */

import fs from 'node:fs';
import path from 'node:path';
import { defaultDSLDir } from './dsl_store.js';
import type { TSDLDecl } from './contract.js';

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export const PROPOSAL_PENDING: ProposalStatus = 'pending';
export const PROPOSAL_APPROVED: ProposalStatus = 'approved';
export const PROPOSAL_REJECTED: ProposalStatus = 'rejected';

/** 一条待审批的 DSL 修订提案（写盘权分离的载体）。字段名与 Go `Proposal`(`:32-43`) 逐字一致。 */
export interface Proposal {
  id: string;
  created_at: string;
  /** llm-revise / manual / loop */
  source: string;
  /** 修订原因（审计依据） */
  reason: string;
  /** 提案的完整新声明集 */
  decls: TSDLDecl[];
  status: ProposalStatus;
  reviewed_at?: string;
  reviewer?: string;
  /** 验证门证据摘要（approve 时产出） */
  verified_by?: string;
  /** 验证详情（哪些规则可判定/需复核） */
  verification?: string;
}

/** 进程内提案创建序列（对照 Go `:60` 的 `proposalSeq atomic.Int64`）。 */
let proposalSeq = 0;

/** 提案 ID：毫秒时间戳 + 递增序列（照搬 Go `:64-67` 形状，见文件头分歧 ①）。 */
export function nextProposalID(): string {
  proposalSeq += 1;
  return `proposal-${Date.now()}-${String(proposalSeq).padStart(4, '0')}`;
}

/** 校验一个声明集能否作为权威契约写入（照搬 Go `:328-341`）。 */
export function validateDecls(decls: TSDLDecl[]): void {
  if (!decls || decls.length === 0) throw new Error('声明集为空，至少需要 1 条声明');
  for (let i = 0; i < decls.length; i++) {
    const d = decls[i];
    if (!d || !d.rule || d.rule.trim() === '') throw new Error(`第 ${i + 1} 条声明缺少 rule`);
    if (!d.expect || d.expect.trim() === '') throw new Error(`第 ${i + 1} 条声明缺少 expect`);
  }
}

// ─────────────────────────────────────────────────────────────
// store
// ─────────────────────────────────────────────────────────────

/**
 * 原子写（tmp + rename）。★ 与 Go `proposal.go:315-324` 的**有意分歧**：Go 这里是裸
 * `os.WriteFile`，而它自己的 `dsl_store.go:201-214` 用 tmp+rename ⇒ **Go 侧自身不一致**。
 * 本实现复用 `dsl_store` 的纪律。跨语言 JSON 格式不变。
 */
function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}

export class ProposalStore {
  private readonly dir: string;

  /** `dir` 缺省取与 `DesignDSLStore` **同一个**目录（`.agent/observe`），提案落在其 `proposals/` 子目录。 */
  constructor(dir?: string) {
    this.dir = path.join(dir ?? defaultDSLDir(), 'proposals');
  }

  dirPath(): string {
    return this.dir;
  }

  private filePath(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  /** 创建一条待审批提案。**不触碰 `dsl.json`**（写盘权分离）。 */
  create(decls: TSDLDecl[], reason: string, source: string): Proposal {
    validateDecls(decls);
    const p: Proposal = {
      id: nextProposalID(),
      created_at: new Date().toISOString(),
      source,
      reason,
      decls,
      status: PROPOSAL_PENDING,
    };
    this.write(p);
    return p;
  }

  /**
   * 全部提案，按创建时间升序；**同刻以 id 字典序决胜**（照搬 Go `:112-117`，保证排序确定）。
   * 坏文件**跳过**（照搬 Go `:103-109`）：一个坏 JSON 不该让整份列表读不出来。
   * 目录不存在返回 `[]`（Go `:92-95`）。
   */
  list(): Proposal[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: Proposal[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (name.endsWith('.tmp')) continue; // 崩溃残留的临时文件不是提案
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')) as Proposal);
      } catch {
        // 坏文件跳过（照搬 Go 的 continue）
      }
    }
    return out.sort((a, b) => {
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /** 读指定提案；不存在抛（带 id，便于定位）。 */
  get(id: string): Proposal {
    const p = this.filePath(id);
    if (!fs.existsSync(p)) throw new Error(`提案不存在：${id}`);
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Proposal;
  }

  /**
   * 拒绝提案。**仅 `pending` 可拒绝**（照搬 Go `:306-308` 的状态机守卫）。
   * ⚠ 错误文案用模板串而非 `fmt.Errorf` 的 `%s` ⇒ 与 Go 逐字一致。
   */
  reject(id: string, reviewer: string): void {
    const p = this.get(id);
    if (p.status !== PROPOSAL_PENDING) {
      throw new Error(`reject: 提案 ${id} 状态为 ${p.status}，仅 pending 可拒绝`);
    }
    p.status = PROPOSAL_REJECTED;
    p.reviewed_at = new Date().toISOString();
    p.reviewer = reviewer;
    this.write(p);
  }

  /** 供 P4 步骤 5 的 `ApproveGated` 复用（那时才允许改 status/verified_by）。 */
  write(p: Proposal): void {
    // Go 用 MarshalIndent(p, "", "  ") ⇒ 两空格缩进，保持一致
    writeAtomic(this.filePath(p.id), `${JSON.stringify(p, null, 2)}\n`);
  }

  /** 供 P4 步骤 5：把已批准/已驳回的提案**冻结**为终态（Go `freeze` 的载体）。 */
  writeRaw(p: Proposal): void {
    this.write(p);
  }
}
