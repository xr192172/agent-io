/**
 * llm —— 接入设计内置 AGNES key 池的 HoleTranslator。
 *
 * ★ 2026-10-10（T109 收拢）：本文件**不再自己出网**。此前它内联了 key-pool-proxy 的轮换语义
 *   （自持 KeyPool + 自拼 `/v1/chat/completions` + 自读 env）；现统一交给**小网关** `llm_gateway`
 *   —— 上游 / key 池 / 池内轮转 / 失败转移全在网关内（复用共享的 `llm_pool.KeyPool`）。
 *   本文件只保留：把 prompt 交给网关、取回 content、剥 markdown 围栏。
 *   ★ 上游/key/池不再由本文件决定 ⇒ 「显式 config.baseURL 指向本地代理」那套客户端占位 key 的口径也随之移除
 *     （要指向本地代理，改配网关的 provider 即可）。
 */
import type { FillContext, HoleTranslator, BatchHoleTranslator } from './fill.js';
import { buildBatchFillPrompt, type BatchUnitView } from './prompts.js';
import { chatViaGateway } from '../../llm_gateway.js';

export interface PooledTranslatorConfig {
  temperature?: number;
  maxTokens?: number;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 剥掉模型常见的 markdown 代码围栏（```lang ... ```），只取内层函数体 */
export function normalizeBody(c: string): string {
  const s = c.trim();
  const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```\s*$/.exec(s);
  return (m ? m[1].trim() : s).trim();
}

/**
 * 共享的池化 chat：**由网关出网**（上游 / key 池 / 池内轮转 / 失败转移都在 `llm_gateway` 内），
 * 返回原始 content 文本（含 markdown 围栏，由各翻译器自行剥）。空内容由 fill 侧闸把关。
 */
function buildChat(config: PooledTranslatorConfig): (messages: ChatMessage[]) => Promise<string> {
  const temperature = config.temperature ?? 0.2;
  const maxTokens = config.maxTokens ?? 2048;
  return async (messages: ChatMessage[]): Promise<string> =>
    (await chatViaGateway(messages, { temperature, maxTokens })).content;
}

const SYSTEM_FILL = '你是源码翻译器。严格遵守 user 的约束：只输出目标函数体，不得生成 export function 外壳、不得改动签名。';
const SYSTEM_BATCH =
  '你是源码翻译器。必须为每个函数各输出一个 `<unit id="...">函数体</unit>` 标记块，块数=题目函数数，ID 逐一对应，块间无其它文字、不改签名。';

/**
 * 基于 AGNES key 池的 HoleTranslator（单孔）工厂。
 * 返回的翻译器：把 FillContext.prompt 发给 LLM，只取函数体文本返回。空 key 池/无 fetch 时抛错。
 */
export function createPooledHoleTranslator(config: PooledTranslatorConfig = {}): HoleTranslator {
  const chat = buildChat(config);
  return async (ctx: FillContext): Promise<string> => {
    return normalizeBody(await chat([{ role: 'system', content: SYSTEM_FILL }, { role: 'user', content: ctx.prompt }]));
  };
}

/**
 * 基于 AGNES key 池的 BatchHoleTranslator（多孔一次性）工厂。
 * 一次调用把一批 FillContext 拼成一个批量 prompt（共享 system/项目调用约定），返回
 * `<unit id>body</unit>` 标记块的原始文本；切分/逐单元验证见 fill.fillUnitsBatched。
 */
export function createPooledBatchTranslator(config: PooledTranslatorConfig = {}): BatchHoleTranslator {
  const chat = buildChat(config);
  const view = (c: FillContext): BatchUnitView => ({ unit: c.unit, skeleton: c.skeleton, srcSnippet: c.srcSnippet, constraints: c.constraints });
  return async (ctxs: FillContext[]): Promise<string> => {
    const prompt = buildBatchFillPrompt(ctxs.map(view), ctxs[0]?.projectNote);
    return normalizeBody(await chat([{ role: 'system', content: SYSTEM_BATCH }, { role: 'user', content: prompt }]));
  };
}