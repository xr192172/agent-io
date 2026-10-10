/**
 * llm —— 接入设计内置 AGNES key 池的 HoleTranslator（fork 自 dsh-brain/packages/key-pool-proxy）
 *
 * key-pool-proxy 本身是一个本地 OpenAI 兼容反向代理：读逗号分隔多 key，round-robin 分摊 +
 * 遇 429/5xx 冷却换 key 重试，上游 apihub.agnes-ai.com。本文件不在跑代理，而是把那套轮换语义
 * 内联成纯客户端函数，让 translate 的 HoleTranslator 自包含即可翻译 —— 不必依赖 dsh-brain 代理。
 *
 * ★ 2026-10-10：上游 / key 池 / 模型**不再在本文件解析**（此前本文件、`llm_focus`、`gateway` 各解析一份，
 *   且 `AGNES_UPSTREAM_BASE`（不含 /v1）与 `AGNES_BASE_URL`（含 /v1）语义不一致 ⇒ 照抄即拼错路径）。
 *   现统一走 `llm_focus` 的 `resolveAgnes*`（唯一住处）；池的**状态机**（选 key / 冷却 blockedUntil /
 *   换 key 重试）抽到共享模块 `llm_pool`，与会话线 `callChat` 共用同一份。
 *   本文件保留「显式配置优先」（`config.baseURL` / `config.model` / `config.keys` / `config.poolEnv`），
 *   供本地代理与测试注入。
 */
import type { FillContext, HoleTranslator, BatchHoleTranslator } from './fill.js';
import { buildBatchFillPrompt, type BatchUnitView } from './prompts.js';
import { KeyPool, loadKeys } from '../../llm_pool.js';
import { resolveAgnesUpstreamBase, resolveAgnesModel, resolveAgnesKeys, agnesUpstreamProxyConfigured } from '../../llm_focus.js';

/** 极简 fetch 形态（Node 18+ 全局 fetch 不依赖 DOM lib，这里显式声明） */
export type MinimalFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface PooledTranslatorConfig {
  /** 上游 OpenAI 兼容根（不含 /v1）。缺省走 llm_focus.resolveAgnesUpstreamBase()（AGNES_* / 默认 agnes） */
  baseURL?: string;
  /** 模型。缺省走 llm_focus.resolveAgnesModel()（AGNES_MODEL / 默认 agnes-2.5-flash） */
  model?: string;
  /** 主 key 池 env 名（逗号分隔多 key）。给了则从该 env 读；缺省走 llm_focus.resolveAgnesKeys() */
  poolEnv?: string;
  /** 回退 env（逗号分隔合并） */
  fallbackEnvs?: string[];
  /** 显式 key 列表（测试注入；缺省从 env 读取） */
  keys?: string[];
  cooldownMs?: number;
  maxRetries?: number;
  retryStatuses?: number[];
  temperature?: number;
  maxTokens?: number;
  /** 自定义 fetch（测试桩 / 代理） */
  fetchImpl?: MinimalFetch;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 单次 chat 请求：返回 { status, content }；解析失败/无内容时 content 为空串 */
async function chatOnce(fetchImpl: MinimalFetch, baseURL: string, key: string, body: unknown): Promise<{ status: number; content: string }> {
  const res = await fetchImpl(baseURL.replace(/\/+$/, '') + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  let content = '';
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = data.choices?.[0]?.message?.content?.trim?.() ?? '';
  } catch {
    /* 非 JSON 响应 → 当作空内容 */
  }
  return { status: res.status, content };
}

/** 剥掉模型常见的 markdown 代码围栏（```lang ... ```），只取内层函数体 */
export function normalizeBody(c: string): string {
  const s = c.trim();
  const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```\s*$/.exec(s);
  return (m ? m[1].trim() : s).trim();
}

/** 共享的池化 chat：遇冷却/空内容自动换 key 重试，返回原始 content 文本（含 markdown 围栏，由各翻译器自行剥） */
function buildChat(config: PooledTranslatorConfig): (messages: ChatMessage[]) => Promise<string> {
  // 上游根（不含 /v1）：显式 config.baseURL 优先；否则统一解析（AGNES_UPSTREAM_BASE → AGNES_BASE_URL → 默认 agnes）
  const baseURL = resolveAgnesUpstreamBase(config.baseURL);
  // 显式配 baseURL（典型指向本地 key-pool-proxy）→ 客户端无需 key，Bearer 占位，轮换发生在上游代理自己的池。
  let keys =
    config.keys ?? (config.poolEnv !== undefined ? loadKeys(config.poolEnv, config.fallbackEnvs ?? []) : resolveAgnesKeys());
  const explicitBase = config.baseURL !== undefined || agnesUpstreamProxyConfigured();
  if (keys.length === 0 && explicitBase) keys = ['proxy-caller'];
  if (keys.length === 0) {
    throw new Error(
      `[translate/llm] 空 key 池：可设 AGNES_* key 池（逗号分隔多 key，见 llm_focus.resolveAgnesKeys），` +
        `或让上游指向本地 key-pool-proxy、或传入 keys 显式提供。`,
    );
  }
  const pool = new KeyPool(keys);
  const fetchImpl =
    config.fetchImpl ?? (((globalThis as { fetch?: MinimalFetch }).fetch as MinimalFetch | undefined)?.bind(globalThis) as MinimalFetch);
  if (!fetchImpl) throw new Error('[translate/llm] 环境无 fetch（Node >= 18）。');
  const model = config.model ?? resolveAgnesModel();
  const cooldownMs = config.cooldownMs ?? 15000;
  const maxRetries = config.maxRetries ?? 3;
  const retrySet = new Set<number>(config.retryStatuses ?? [429, 500, 502, 503, 504]);
  const temperature = config.temperature ?? 0.2;
  const maxTokens = config.maxTokens ?? 2048;

  return async (messages: ChatMessage[]): Promise<string> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const now = Date.now();
      if (!pool.hasAvailable(now)) break;
      const idx = pool.pick(now);
      if (idx < 0) break;
      const { status, content } = await chatOnce(fetchImpl, baseURL, pool.keys[idx], {
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      });
      if (content) return content; // 有内容即成功（是否合法由 fill 侧闸把关）
      if (retrySet.has(status) && attempt < maxRetries) {
        pool.cooldown(idx, Date.now(), cooldownMs);
        continue;
      }
      throw new Error(`LLM 返回 ${status}（key 池第 ${idx + 1} 把）：${content || '空内容/非 JSON'}`);
    }
    throw new Error('[translate/llm] key 池已全部冷却或重试耗尽');
  };
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