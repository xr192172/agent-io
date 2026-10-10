/**
 * llm_agnes —— AGNES 的**环境变量解析器**（叶子模块，不依赖同层其他 LLM 模块）。
 *
 * ★★★ 2026-10-11（用户裁定）：**key 的家 = gateway（`llm_gateway.ts` 的 `gateway.json`），不是 env。**
 *   用户原话：「env 里面不放 key，Gateway 里面放 key 呗，只留那一处…… env 的管理不智能，我们的 Gateway
 *   可以去配池，可以配多条 Key，可以配多种供应商，但是 env 的话用起来比较呆板。」
 *   ⇒ 本模块的角色**降级为「env 导入源」**：它仍解析 AGNES 环境变量，但**只在"种入/导入"那一刻被读一次**
 *     （`llm_gateway.ensureSeededFromEnv`）—— 之后 key 一律从 `gateway.json` 读，env 不再是住处。
 *   ★ 故本文件中「AGNES 配置的唯一住处」那句话**只对"env 这一侧"成立**（变量名唯一），**不再指 key 的住处**。
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

/**
 * ★★★ **AGNES 环境变量名的唯一住处**（T108）。
 *
 * 为什么必须是**一个具名常量**、而不是散在 `process.env.XXX` 字面量里：
 *   「上游 / key 池 / 模型」此前分散在三处、名字不同，T108 把它们收拢进本文件；
 *   而**给 Agent 的"怎样配密钥"提示**若再手抄一份变量名清单，就会**立刻**重新分叉
 *   （正是 T108 刚清掉的病）。⇒ 解析器与提示**都从本常量取**，只此一处。
 */
export const AGNES_ENV = {
  /** 上游根（不含 /v1）；`AGNES_BASE_URL` 是它的等价旧写法（含 /v1） */
  upstreamBase: 'AGNES_UPSTREAM_BASE',
  /** 上游 base（含 /v1）—— 与 `upstreamBase` 同指一个上游（归一化时剥掉 `/v1`） */
  baseUrl: 'AGNES_BASE_URL',
  /** key 池（逗号分隔多把，优先） */
  keyPool: 'AGNES_KEY_POOL',
  /** 单把 key（池的回退） */
  apiKey: 'AGNES_API_KEY',
  /** 模型名 */
  model: 'AGNES_MODEL',
} as const;

/**
 * ★★ **"怎样配密钥"的人话提示**（用户 2026-08-xx 要求：用此功能 / 缺密钥时要提示 Agent 可以去配）。
 *
 * ★ **变量名从 {@link AGNES_ENV} 取**（唯一住处），**本函数不手抄任何变量名清单** ——
 *   否则 T108 刚收拢的"上游/key/模型唯一住处"会立刻在这里重新分叉。
 * ★ 纯字符串拼装、无副作用（可被任何提示 / 回执复用）。
 * ★★ 2026-10-11（用户裁定）：**key 的家 = 网关**（可配池 / 多 key / 多供应商）；env 只是**导入源**。
 *   ⇒ 提示**首选** gateway 工具（`gateway_provider`），env 作为"一次性迁入"的旧路径说明。
 */
export function describeAgnesConfigHint(): string {
  return (
    '怎样配 LLM 密钥（★ key 的家 = 网关 `gateway.json`，可配池 / 多 key / 多供应商）：\n' +
    '  · 首选：用 `gateway_provider` 工具注册供应商（action=upsert，传 base_url/model/keys；keys 支持多把构成池）。\n' +
    `  · 旧路径（env，作为**导入源**）：\`${AGNES_ENV.keyPool}\`（逗号分隔多把 key，优先）或 \`${AGNES_ENV.apiKey}\`（单把）；` +
    `上游用 \`${AGNES_ENV.upstreamBase}\`（不含 /v1）或 \`${AGNES_ENV.baseUrl}\`（含 /v1），模型用 \`${AGNES_ENV.model}\`。\n` +
    '    ⇒ 这些 env 会在**首次写类/出网访问**时被**一次性导入**网关，此后不再是 key 的住处。\n' +
    '  · 或写进配置文件 `<configHome>/.agent-io/config.json`：' +
    '{ "llm": { "apiKey": "...", "model": "...", "baseURL": "..." } }（也兼容 agent.mmd 段）。\n' +
    `★ 当前默认上游 = ${DEFAULT_AGNES_UPSTREAM}，默认模型 = ${DEFAULT_AGNES_MODEL}。`
  );
}


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
    process.env[AGNES_ENV.upstreamBase]?.trim() ||
    process.env[AGNES_ENV.baseUrl]?.trim();
  return raw ? toAgnesUpstreamRoot(raw) : DEFAULT_AGNES_UPSTREAM;
}

/** 解析 OpenAI base_url（含 `/v1`），供 callChat / gateway 用 */
export function resolveAgnesApiBaseUrl(): string {
  return agnesApiBaseUrl(resolveAgnesUpstreamBase());
}

/** 解析模型。优先级：`AGNES_MODEL` > 默认 `agnes-2.5-flash` */
export function resolveAgnesModel(): string {
  return process.env[AGNES_ENV.model]?.trim() || DEFAULT_AGNES_MODEL;
}

/**
 * 解析 key 池。优先级：`AGNES_KEY_POOL`（逗号分隔多把）→ `AGNES_API_KEY`（单把）。复用共享的 `loadKeys`。
 * ★★ 2026-10-11（用户裁定）：本函数是**env 侧的导入源读取器** —— 全仓**只有** `llm_gateway.ensureSeededFromEnv`
 *   在"种入那一刻"调用它。key 的家 = `gateway.json`；调用方（llm_focus 等）不再用本函数取 key。
 */
export function resolveAgnesKeys(): string[] {
  return loadKeys(AGNES_ENV.keyPool, [AGNES_ENV.apiKey]);
}
