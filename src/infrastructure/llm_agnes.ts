/**
 * llm_agnes —— AGNES「上游 / key（池） / 模型」的**唯一住处**（叶子模块，不依赖同层其他 LLM 模块）。
 *
 * ★ 为什么独立成文件（2026-10-10）：此前这段解析住在 `llm_focus.ts`。当网关（`llm_gateway`）也要读
 *   AGNES 配置、而会话线 `callChat` 又要经网关出网时，`llm_focus ↔ llm_gateway` 会形成**循环依赖**。
 *   把与「读 env」有关、不做任何网络/持久化的这部分抽成**叶子**（只依赖 `llm_pool.loadKeys`），
 *   两条线都 import 它、彼此不再互指 —— 依赖方向是一条 DAG，而非环。
 *
 * 为什么必须只有这一处：此前「上游在哪、key 从哪来、用哪个模型」分散在三处、名字不同、语义还不同 ——
 *   · 会话线（llm_focus.loadAgentConfig）：AGNES_API_KEY / AGNES_BASE_URL（**含 /v1**） / AGNES_MODEL
 *   · 翻译线（authoring/translate/llm）  ：AGNES_KEY_POOL（池） / AGNES_UPSTREAM_BASE（**不含 /v1**） / AGNES_MODEL
 *   · gateway（llm_gateway）              ：又一份 AGNES_* + 又一份默认常量
 * ⇒ **两个变量名干同一件事**（`AGNES_UPSTREAM_BASE` 不含 /v1 vs `AGNES_BASE_URL` 含 /v1），
 *   照抄一个到另一个就拼错路径；且只有翻译线支持池 ⇒ 会话线真跑落到默认上游 + 单把 key ⇒ 429。
 *
 * ★ 归一化口径（canonical）：**无 `/v1` 的上游根**（例：`https://apihub.agnes-ai.com`）。
 *   - 默认值两种写法（`.../v1` 与 `...`）本就指**同一个上游** ⇒ 统一剥掉尾部 `/v1` 即同一根。
 *   - 需要 OpenAI `base_url` 的调用方（callChat / gateway）**一律**经 `agnesApiBaseUrl()` 追加**唯一一次** `/v1`。
 *   - 需要「根 + `/v1/chat/completions`」的调用方（翻译线）直接用根，自拼一次 `/v1`。
 *   ⇒ 于是「含不含 /v1」只在**归一化一处**被决定，各条线拿到的都是归一化后的值。
 */

import { loadKeys } from './llm_pool.js';

/** 默认上游根（**不含 /v1**；等价的传统写法是 `https://apihub.agnes-ai.com/v1`） */
export const DEFAULT_AGNES_UPSTREAM = 'https://apihub.agnes-ai.com';
/** 默认模型（统一口径，替换旧的写死 `agnes-2.0-flash`；现役为 `agnes-2.5-flash`） */
export const DEFAULT_AGNES_MODEL = 'agnes-2.5-flash';

/** 归一化：去尾部斜杠、再去尾部一次 `/v1` ⇒ 上游根 */
function toAgnesUpstreamRoot(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/** 上游根 → OpenAI base_url（含 `/v1`）—— `/v1` 只在此处追加一次 */
export function agnesApiBaseUrl(root: string): string {
  return toAgnesUpstreamRoot(root) + '/v1';
}

/**
 * 解析上游根（**不含 /v1**）。优先级：显式传入 > `AGNES_UPSTREAM_BASE` > `AGNES_BASE_URL` > 默认。
 * 无论来自哪个变量、写成含不含 /v1，出口一律是归一化后的根。
 */
export function resolveAgnesUpstreamBase(explicit?: string): string {
  const raw =
    explicit?.trim() ||
    process.env.AGNES_UPSTREAM_BASE?.trim() ||
    process.env.AGNES_BASE_URL?.trim();
  return raw ? toAgnesUpstreamRoot(raw) : DEFAULT_AGNES_UPSTREAM;
}

/** 解析 OpenAI base_url（含 `/v1`），供 callChat / gateway 用 */
export function resolveAgnesApiBaseUrl(): string {
  return agnesApiBaseUrl(resolveAgnesUpstreamBase());
}

/** 解析模型。优先级：`AGNES_MODEL` > 默认 `agnes-2.5-flash` */
export function resolveAgnesModel(): string {
  return process.env.AGNES_MODEL?.trim() || DEFAULT_AGNES_MODEL;
}

/** 解析 key 池。优先级：`AGNES_KEY_POOL`（逗号分隔多把）→ `AGNES_API_KEY`（单把）。复用共享的 `loadKeys`。 */
export function resolveAgnesKeys(): string[] {
  return loadKeys('AGNES_KEY_POOL', ['AGNES_API_KEY']);
}
