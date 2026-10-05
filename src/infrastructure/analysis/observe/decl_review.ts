/**
 * decl_review —— **decl 级 LLM 复核**（2026-10-05，P4 步骤 5 的 L2）
 *
 * ★ 为什么这个文件是**新写**而不是搬运
 *   Go 侧的对应物是 `ApproveGated:183` 的 `gate.LLMReview(ctx, p.Decls)` —— 一个**能力注入点**。
 *   核实结论：**Go 生产代码零实现**，只有 `proposal_test.go:179/269/296` 的测试桩
 *   ⇒ 这个门在 Go 里恒定走"LLM 不可用 → freeze"分支，**语义从未被真正执行过**。
 *   ⇒ 没有可抄的实现，只有可抄的**数据形状**（`LLMVerdict{Result, Rule, Reason}`，
 *     与本文件的 `DeclVerdict` 逐字同构）。
 *
 * ## 判据：① 声明自洽性（2026-10-05 用户裁定）
 *   LLM 只判**这条声明本身写得对不对**，**不判代码**。
 *   理由：这个门的职责是"能不能把这条声明写进权威真相源"，不是"代码对不对"。
 *   代码对不对由 `judge`（事件判定）与 `reconcile`（链路对账）负责，职责不重叠。
 *   ⚠ 选①的后果要说清：**等于没人在审批时看代码**。若要"声明确实描述了当前代码"，
 *     那是另两个判据（② 声明 vs 观测 / ③ 声明 vs 代码）的活，属另一个门。
 *
 * ## 与 `judge_service.ts` 的关系（刻意不合并）
 *   `judgeEventsWithLLM`（`:79`）的语义是**逐事件**复核：入参是 `(event, rule)`，
 *   prompt 由 `buildLLMPrompt`（`:121`）组装，**只对 `verdict.result==='deviation'` 的事件**问 LLM。
 *   本文件是**逐声明**复核：入参是整条 `decl`（rule + expect + constraint + chain）。
 *   ⇒ 两者形状不同、判据不同、粒度不同，**强行合并会把"声明能不能进权威"降级成
 *   "这个事件判对没有"** ⇒ 刻意分开，`judge_service` 一行未改。
 */

import { callChat, loadLlmConfig } from '../../llm_focus.js';
import { OBSERVE_RULE_IDS } from './judge.js';
import type { TSDLDecl } from './contract.js';
import type { DeclVerdict } from './verify_gate.js';

export interface DeclReviewResult {
  ok: boolean;
  verdicts: DeclVerdict[];
  /** 不可用 / 失败时的原因（上层据此冻结） */
  error?: string;
}

/** 组装 prompt：只给声明自身，**不给代码、不给事件**（判据①的必然要求）。 */
export function buildDeclReviewPrompt(d: TSDLDecl): string {
  const lines: string[] = [
    '【待复核的设计声明】（这是唯一输入；下面没有代码、没有事件快照）',
    `rule: ${d.rule}`,
    `probe: ${d.probe ?? '(未指定 = 全局声明)'}`,
    `expect: ${d.expect ?? '(无)'}`,
  ];
  if (d.constraint) lines.push(`constraint: ${d.constraint}`);
  if (d.chain && d.chain.length > 0) lines.push(`chain: ${JSON.stringify(d.chain)}`);
  lines.push(
    '',
    '【你要判的只有一件事】这条**声明本身**是否可判定、是否写得成立。具体：',
    '  1. expect 是否给出了**可判定**的条件（读它的人能明确知道什么算违反）',
    '  2. rule 与 expect 是否匹配（rule 名说的和 expect 描述的是不是同一件事）',
    '  3. constraint 与 expect 是否自相矛盾',
    '  4. chain 里的探针序列是否构成一个合理的调用序',
    '',
    '【你不需要判的】代码是否遵守这条声明 —— 那由事件判定与链路对账负责，不在本门。',
    '【不要臆测】声明之外的任何背景；信息不足时判 deviation 并在 reason 里说明缺什么。',
    '',
    '【已注册的可规则秒判 rule】（这些不需要你来判，仅供你理解命名风格）',
    ...OBSERVE_RULE_IDS.map((r) => `  - ${r}`),
    '',
    '【输出】纯 JSON，不要 markdown：{"result":"ok"|"deviation","rule":"<原样回填 rule>","reason":"一句话说明"}',
  );
  return lines.join('\n');
}

/**
 * 对**无谓词**的声明逐条做 LLM 复核。
 *
 * 粒度照搬 Go `:183`（整批 decls 传进去），但**只有 `uncovered` 的会被判** ——
 * 有确定性谓词的声明不需要 LLM（那是 L1 门的职责）。
 *
 * @param uncovered 由 `verifyRuleRegression` 算出的无谓词 rule 清单
 * @returns `ok:false` 时**必须冻结**（照搬 Go `:179-182` 的失败语义：不静默、不假装通过）
 */
export async function reviewDeclsWithLLM(decls: TSDLDecl[], uncovered: string[]): Promise<DeclReviewResult> {
  if (uncovered.length === 0) return { ok: true, verdicts: [] };

  let cfg: ReturnType<typeof loadLlmConfig>;
  try {
    cfg = loadLlmConfig();
  } catch (e) {
    // 照搬 Go `:179-182`：LLM 不可用 ⇒ 冻结，但**明确说清是"不可用"而不是"未通过"**
    return { ok: false, verdicts: [], error: `LLM 复核不可用（${(e as Error).message}）` };
  }
  if (!cfg) return { ok: false, verdicts: [], error: 'LLM 复核不可用（未配置 LLM）' };

  const targets = decls.filter((d) => uncovered.includes(d.rule));
  const verdicts: DeclVerdict[] = [];
  for (const d of targets) {
    let raw: string;
    try {
      raw = await callChat(cfg, [
        {
          role: 'system',
          content:
            '你是设计契约审核器。只依据给出的这一条声明本身判断它是否可判定、是否成立。' +
            '**不判代码、不判事件**（那些由别的环节负责）。输出纯 JSON，不要 markdown。',
        },
        { role: 'user', content: buildDeclReviewPrompt(d) },
      ]);
    } catch (e) {
      // 照搬 Go `:184-186`：调用失败即冻结，不降级放行
      return { ok: false, verdicts, error: `LLM 复核失败: ${(e as Error).message}` };
    }
    let parsed: { result?: string; reason?: string };
    try {
      parsed = JSON.parse(raw) as { result?: string; reason?: string };
    } catch {
      return { ok: false, verdicts, error: `LLM 复核返回非 JSON（rule=${d.rule}）：${raw.slice(0, 120)}` };
    }
    if (parsed.result !== 'ok' && parsed.result !== 'deviation') {
      return { ok: false, verdicts, error: `LLM 复核结论非法（rule=${d.rule}）：result=${parsed.result ?? '(空)'}` };
    }
    verdicts.push({ result: parsed.result, rule: d.rule, reason: parsed.reason ?? '' });
  }
  return { ok: true, verdicts };
}
