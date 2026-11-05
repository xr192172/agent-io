/**
 * ★★★ 2026-10-28（"能发现逻辑 bug"的**最后一里**）：**跑**画布条目的判据。
 *
 * ## 为什么必须有这一层
 * 前面几轮把"判据**强不强**"判清楚了（`planJudgementGaps`：语义类 vs 存在性类），
 * 但**判据本身从来没被执行过** —— 出口闭环只会吐一句"判据需另跑：cert:t388#①"。
 * 声明得再强，不跑就等于"验过了"的幻觉 —— 那比没有判据更危险。
 *
 * ## 判据（怎么跑）
 * - 只跑 `judgement_ref = decision:<node_id>#<index>` 形态（判据**住在册里**，这才是唯一住处）；
 * - 执行核**复用** `judgeExpectations`（8 种 kind 全覆盖，`behavior-cases` 走 `runHarness`）——
 *   本模块**不新造执行器**，只做"画布条目 → `JudgeItem`"的适配；
 * - `cert:` 形态 ⇒ 如实报 `unresolved`（证里的检查号没有执行核，**不假装跑过**）。
 *
 * ## 读数四态（沿用 `Verdict`，不另造词汇）
 * `pass` / `fail` / `unsupported`（判不了）/ `pending`（还没到判的时候），外加本层独有：
 * `unresolved`（这条引用**根本没有执行核** —— 与"判不了"是两件事，别混）。
 */
import { judgeExpectations } from '../intent/expectations.js';
// ★ 册的唯一读端 + 判定引用解析的唯一实现（与 gen-db-check 的归属门同一本账）
import { loadDesignSheetsForGate, resolveDecisionExpectation, type DesignSheetLike } from './gen_design_db.js';
import { parseJudgementRef, type RewritePlan } from './rewrite_plan.js';
import type { JudgeItem } from '../../../domain/judge_port.js';
import type { Expectation } from '../../../domain/expectation.js';

export interface PlanJudgementVerdict {
  symbol: string;
  judgement_ref: string;
  verdict: 'pass' | 'fail' | 'unsupported' | 'pending' | 'unresolved';
  detail: string;
}

/**
 * 跑画布上所有 `decision:` 形态的判据。
 *
 * @returns 每条 entry 一条读数（顺序与 `plan.entries` 一致）；没有可跑的 ⇒ 空数组（**如实空**）
 */
export async function runPlanJudgements(
  projectRoot: string,
  plan: RewritePlan | null,
): Promise<PlanJudgementVerdict[]> {
  if (!plan) return [];
  // ★ 册只读一次（一次 plan 有 N 条 entry）。★ 读册失败 ⇒ **直接抛**：改前这里的 `catch { return null }`
  //   会把「册坏了」渲染成「册里找不到节点 X 的第 i 条判据」—— 两种病同一个报文（0.12）。
  const sheets: DesignSheetLike[] = loadDesignSheetsForGate(projectRoot).sheets;
  const items: JudgeItem[] = [];
  const index: Array<{ symbol: string; ref: string; slot: number | null; why?: string }> = [];

  for (const e of plan.entries) {
    const ref = e.judgement_ref ?? '';
    const symbol = e.anchor?.symbol ?? '(缺 anchor)';
    const parsed = parseJudgementRef(ref);
    if (!parsed) {
      index.push({ symbol, ref, slot: null, why: '`judgement_ref` 不是规范引用 ⇒ **没有执行核**（不等于通过）' });
      continue;
    }
    if (parsed.kind === 'cert') {
      index.push({
        symbol,
        ref,
        slot: null,
        why: '`cert:` 形态**没有执行核**（证的检查号不是可执行的判据）⇒ 请改成 `decision:<node_id>#<index>`',
      });
      continue;
    }
    // ★ R72：3 段写法（`decision:<feature>:<node>#<i>`）带的**显式册名**必须传下去 ——
    //   丢在这里就是"解析到了却静默忽略"，与本条要治的"册名被吞进 nodeId"同病，只是更隐蔽。
    const sheetName = 'feature' in parsed ? parsed.feature : undefined;
    const found = resolveDecisionExpectation(parsed.nodeId, parsed.index, sheets, sheetName);
    if (!found.ok) {
      index.push({ symbol, ref, slot: null, why: found.why_not });
      continue;
    }
    index.push({ symbol, ref, slot: items.length });
    items.push({
      node_id: String((found.node as { id?: string }).id ?? parsed.nodeId),
      node_label: String((found.node as { label?: string }).label ?? parsed.nodeId),
      expectation: found.exp as Expectation,
    });
  }

  if (!items.length) {
    return index.map((x) => ({ symbol: x.symbol, judgement_ref: x.ref, verdict: 'unresolved' as const, detail: x.why ?? '' }));
  }

  const report = await judgeExpectations(projectRoot, items);
  const bySlot = new Map<number, { verdict: 'pass' | 'fail' | 'unsupported' | 'pending'; detail: string }>();
  // ★ `judgeExpectations` 保证 `items` 顺序（逐条 push）⇒ 用出现次序对齐；对不上就退回"判不了"
  report.items.forEach((it, i) => bySlot.set(i, { verdict: it.verdict, detail: it.detail }));

  return index.map((x) => {
    if (x.slot === null) {
      return { symbol: x.symbol, judgement_ref: x.ref, verdict: 'unresolved' as const, detail: x.why ?? '' };
    }
    const got = bySlot.get(x.slot);
    return {
      symbol: x.symbol,
      judgement_ref: x.ref,
      verdict: got?.verdict ?? 'unsupported',
      detail: got?.detail ?? '执行核没有返回这一条的读数（**判不了 ≠ 通过**）',
    };
  });
}

/** 人读一行（红/判不了才出声；全绿闭嘴 —— 与其它回执同一口径） */
export function renderJudgementLine(vs: readonly PlanJudgementVerdict[]): string | null {
  if (!vs.length) return null;
  const bad = vs.filter((v) => v.verdict !== 'pass');
  if (!bad.length) return null;
  const icon = (v: string): string => (v === 'fail' ? '✗' : v === 'unresolved' ? '?' : '·');
  return (
    `★ 判据执行 ${bad.length}/${vs.length} 条未通过：\n` +
    bad
      .slice(0, 6)
      .map((v) => `   ${icon(v.verdict)} ${v.symbol} [${v.verdict}] ${v.judgement_ref} —— ${v.detail.replace(/\n/g, ' ').slice(0, 160)}`)
      .join('\n') +
    (bad.length > 6 ? `\n   …另有 ${bad.length - 6} 条` : '')
  );
}
