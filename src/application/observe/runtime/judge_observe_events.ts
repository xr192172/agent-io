/**
 * observe_judge 的 use case —— **HTTP 面（`POST /api/observe/judge`）与 MCP 面（`observe_judge`）的唯一实现**。
 *
 * 为什么要有它：两个面原先各写一遍同一串归一（`normalizeEvents`）、同一串开关（`use_llm` 认
 * true/'true'/'1'）、同一次判定调用（`judgeEvents` / `judgeEventsWithLLM`）与同一份文本渲染
 * （`renderJudgeReport`）⇒ 判据住两处。
 *
 * ★ 这里只做「入参归一 + 判定 + 可选文本」，**不碰**设计对比（decls / 链路重建）：
 *   HTTP 面从来没有这一层，MCP 面在用例之外自己补 —— 搬进来的只是两面**共有**的那一段。
 */

import {
  judgeEvents,
  judgeEventsWithLLM,
  normalizeEvents,
  renderJudgeReport,
  type JudgeResult,
} from '../../../infrastructure/analysis/observe/judge_service.js';
import type { ObserveRuleCtx } from '../../../infrastructure/analysis/observe/judge.js';
import type { TSEvent } from '../../../infrastructure/analysis/observe/probe.js';

export interface JudgeObserveEventsInput {
  /** 待判定事件（形状校验在 normalizeEvents，非法项被剔除） */
  events: unknown;
  /** LLM 复核开关（true / 'true' / '1' 均为真；缺省纯规则秒判） */
  use_llm?: unknown;
  /** 是否顺带产出人类可读报告（true / '1'；缺省不出） */
  text?: unknown;
  /** 声明侧上下文（已承认耦合等）；只有调用方拿得到时才有 */
  ctx?: ObserveRuleCtx;
}

export type JudgeObserveEventsResult =
  | { ok: false; error: string }
  | { ok: true; events: TSEvent[]; report: JudgeResult; text?: string };

/** 判一批 Observe 事件。`ok:false` = 入参形状不对（调用方据此回 400，不静默判 0 条）。 */
export async function judgeObserveEvents(input: JudgeObserveEventsInput): Promise<JudgeObserveEventsResult> {
  const norm = normalizeEvents(input.events);
  if (norm.error) return { ok: false, error: norm.error };
  const useLlm = input.use_llm === true || input.use_llm === 'true' || input.use_llm === '1';
  const report = useLlm ? await judgeEventsWithLLM(norm.events, true, input.ctx) : judgeEvents(norm.events, input.ctx);
  const wantText = input.text === true || input.text === '1';
  return wantText
    ? { ok: true, events: norm.events, report, text: renderJudgeReport(report) }
    : { ok: true, events: norm.events, report };
}
