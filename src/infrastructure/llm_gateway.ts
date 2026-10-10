/**
 * llm_gateway —— 小网关（薄层，可被上层网关再次接入并管理）
 *
 * 定位：不重造完整网关平台，只做四件事——
 *   1. 供应商注册（OpenAI 兼容：base_url + model，支持任意厂商/本地 Ollama）
 *   2. Key 池：同一供应商多个 API Key 一个池，轮询 + 失败转移
 *   3. 用量监视：调用数 / token / 费用 / 错误 / 延迟（持久化 gateway.stats.json）
 *   4. OpenAI 兼容端点 POST /v1/chat/completions —— 上层网关（如 AI base）可把我当 upstream
 *
 * 配置持久化：<dataHome>/.agent-io/gateway.json
 * 首次启动若检测到 AGNES 环境变量（key 池/单把，老配置），自动种入 agnes 供应商，
 * 从"直连 env"无缝过渡到"网关统一管理"。
 *
 * ★ 2026-10-10（T109 收拢）：
 *   · 本文件从 `application/meta/llm/gateway.ts` 搬到 `infrastructure/` —— 它管 key 池 / 用量 / 端点，
 *     **全是基础设施职责**；且会话线 `llm_focus.callChat`（infrastructure）要经它出网 ⇒ 不能反过来依赖 application。
 *   · 池内轮转**复用** `llm_pool.KeyPool`（不再自持 `keyCursor` 第二份状态机）：同一 KeyPool 对象**跨调用**保留
 *     ⇒ 第 1 把断了，下一次从第 2 把开始；转完一圈才回第 1 把（照用户口径）。
 *   · **对外只提供一个入口**：内部调用方只传 messages / temperature / jsonMode（不碰上游 / key / 池）；
 *     HTTP 端点仍是 `handleOpenAICompatRequest`。全仓**唯一**发 `/chat/completions` 的地方。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStorageRoot } from './storage.js';
import { resolveAgnesApiBaseUrl, resolveAgnesModel, resolveAgnesKeys } from './llm_agnes.js';
import { KeyPool } from './llm_pool.js';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface GatewayProvider {
  /** 唯一 id（slug，如 agnes / openai / my-ollama） */
  id: string;
  /** 展示名 */
  name: string;
  /** 协议类型，现仅 openai-compatible（Anthropic 等后续扩展） */
  type: 'openai-compatible';
  /** OpenAI 兼容 base url（不含 /chat/completions，如 https://api.openai.com/v1） */
  base_url: string;
  /** 默认模型 */
  model: string;
  /** Key 池：同一供应商多个 API Key 算入同一个池 */
  keys: string[];
  /** 轮询权重（默认 1） */
  weight: number;
  /** 每 1M 输入 token 价格（USD，用于用量费用估算；不填按 0） */
  price_prompt_per_1m: number;
  /** 每 1M 输出 token 价格（USD） */
  price_completion_per_1m: number;
  enabled: boolean;
  created_at: string;
}

export interface GatewayConfig {
  providers: GatewayProvider[];
  /** 池内 key 选择策略：round_robin 轮询（失败自动切下一个 key/供应商） */
  strategy: 'round_robin';
}

export interface UsageStat {
  provider_id: string;
  /** 暴露在配置里的 key 指纹（sha1 前 8），不存原文 */
  key_fp: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  errors: number;
  total_ms: number;
  last_at: string;
}

export interface ChatResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number };
  provider_id: string;
  key_fp: string;
  model: string;
}

// ─────────────────────────────────────────────────────────────
// 持久化
// ─────────────────────────────────────────────────────────────

function gatewayCfgPath(): string {
  return path.join(getStorageRoot(), 'gateway.json');
}
function gatewayStatsPath(): string {
  return path.join(getStorageRoot(), 'gateway.stats.json');
}

export function loadGatewayConfig(): GatewayConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(gatewayCfgPath(), 'utf-8'));
    if (raw && Array.isArray(raw.providers)) return { providers: raw.providers, strategy: 'round_robin' };
  } catch {
    // 不存在/损坏：按空配置处理
  }
  return { providers: [], strategy: 'round_robin' };
}

function saveGatewayConfig(cfg: GatewayConfig): void {
  fs.mkdirSync(path.dirname(gatewayCfgPath()), { recursive: true });
  fs.writeFileSync(gatewayCfgPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

/** 首次启动引导：无任何供应商时，把环境变量里的 AGNES 配置种成默认供应商（老配置无缝过渡） */
export function ensureSeededFromEnv(): boolean {
  const cfg = loadGatewayConfig();
  if (cfg.providers.length > 0) return false;
  // ★ 上游/模型/key 池统一由 llm_agnes 解析（唯一住处）；池可多把，直接种入网关 key 池
  const keys = resolveAgnesKeys();
  if (keys.length === 0) return false;
  cfg.providers.push({
    id: 'agnes',
    name: 'AGNES（自动发现）',
    type: 'openai-compatible',
    base_url: resolveAgnesApiBaseUrl(),
    model: resolveAgnesModel(),
    keys,
    weight: 1,
    price_prompt_per_1m: 0,
    price_completion_per_1m: 0,
    enabled: true,
    created_at: new Date().toISOString(),
  });
  saveGatewayConfig(cfg);
  return true;
}

// ─────────────────────────────────────────────────────────────
// 供应商 CRUD（对外展示一律脱敏 key）
// ─────────────────────────────────────────────────────────────

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export interface ProviderView {
  id: string;
  name: string;
  type: string;
  base_url: string;
  model: string;
  keys: string[]; // 脱敏
  key_count: number;
  weight: number;
  price_prompt_per_1m: number;
  price_completion_per_1m: number;
  enabled: boolean;
  created_at: string;
}

export function listProvidersMasked(): ProviderView[] {
  ensureSeededFromEnv();
  return loadGatewayConfig().providers.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    base_url: p.base_url,
    model: p.model,
    keys: p.keys.map(maskKey),
    key_count: p.keys.length,
    weight: p.weight,
    price_prompt_per_1m: p.price_prompt_per_1m,
    price_completion_per_1m: p.price_completion_per_1m,
    enabled: p.enabled,
    created_at: p.created_at,
  }));
}

export interface UpsertProviderInput {
  id: string;
  name?: string;
  type?: 'openai-compatible';
  base_url?: string;
  model?: string;
  keys?: string[];
  weight?: number;
  price_prompt_per_1m?: number;
  price_completion_per_1m?: number;
  enabled?: boolean;
}

export function upsertProvider(input: UpsertProviderInput): { ok: boolean; error?: string } {
  const id = (input.id || '').trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return { ok: false, error: '供应商 id 不能为空（仅字母数字-_）' };
  const keys = (input.keys ?? []).map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return { ok: false, error: '至少需要一个 API Key（构成 Key 池）' };
  const base_url = (input.base_url || '').trim().replace(/\/+$/, '');
  if (!base_url) return { ok: false, error: 'base_url 不能为空' };

  const cfg = loadGatewayConfig();
  const exist = cfg.providers.find((p) => p.id === id);
  if (exist) {
    exist.name = input.name?.trim() || exist.name;
    if (input.type) exist.type = input.type;
    if (input.base_url) exist.base_url = base_url;
    if (input.model) exist.model = input.model.trim();
    if (input.keys) exist.keys = keys;
    if (typeof input.weight === 'number') exist.weight = input.weight;
    if (typeof input.price_prompt_per_1m === 'number') exist.price_prompt_per_1m = input.price_prompt_per_1m;
    if (typeof input.price_completion_per_1m === 'number') exist.price_completion_per_1m = input.price_completion_per_1m;
    if (typeof input.enabled === 'boolean') exist.enabled = input.enabled;
  } else {
    cfg.providers.push({
      id,
      name: input.name?.trim() || id,
      type: input.type ?? 'openai-compatible',
      base_url,
      model: (input.model || '').trim() || 'gpt-4o-mini',
      keys,
      weight: input.weight ?? 1,
      price_prompt_per_1m: input.price_prompt_per_1m ?? 0,
      price_completion_per_1m: input.price_completion_per_1m ?? 0,
      enabled: input.enabled ?? true,
      created_at: new Date().toISOString(),
    });
  }
  saveGatewayConfig(cfg);
  return { ok: true };
}

export function deleteProvider(id: string): { ok: boolean; error?: string } {
  const cfg = loadGatewayConfig();
  const before = cfg.providers.length;
  cfg.providers = cfg.providers.filter((p) => p.id !== id);
  if (cfg.providers.length === before) return { ok: false, error: `供应商不存在：${id}` };
  saveGatewayConfig(cfg);
  return { ok: true };
}

export function hasEnabledProvider(): boolean {
  ensureSeededFromEnv();
  return loadGatewayConfig().providers.some((p) => p.enabled && p.keys.length > 0);
}

// ─────────────────────────────────────────────────────────────
// 用量统计
// ─────────────────────────────────────────────────────────────

function keyFingerprint(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
}

function loadStats(): UsageStat[] {
  try {
    const raw = JSON.parse(fs.readFileSync(gatewayStatsPath(), 'utf-8'));
    if (Array.isArray(raw)) return raw;
  } catch {
    // 忽略
  }
  return [];
}

function saveStats(stats: UsageStat[]): void {
  fs.mkdirSync(path.dirname(gatewayStatsPath()), { recursive: true });
  fs.writeFileSync(gatewayStatsPath(), JSON.stringify(stats, null, 2), 'utf-8');
}

function recordUsage(providerId: string, key: string, u: { prompt: number; completion: number; cost: number; ok: boolean; ms: number }): void {
  const stats = loadStats();
  const fp = keyFingerprint(key);
  const entry = stats.find((s) => s.provider_id === providerId && s.key_fp === fp);
  if (!entry) {
    stats.push({
      provider_id: providerId,
      key_fp: fp,
      calls: u.ok ? 1 : 0,
      prompt_tokens: u.prompt,
      completion_tokens: u.completion,
      cost_usd: u.cost,
      errors: u.ok ? 0 : 1,
      total_ms: u.ms,
      last_at: new Date().toISOString(),
    });
  } else {
    entry.calls += u.ok ? 1 : 0;
    entry.prompt_tokens += u.prompt;
    entry.completion_tokens += u.completion;
    entry.cost_usd += u.cost;
    entry.errors += u.ok ? 0 : 1;
    entry.total_ms += u.ms;
    entry.last_at = new Date().toISOString();
  }
  saveStats(stats);
}

export interface StatsView {
  per_key: UsageStat[];
  totals: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd: number;
    errors: number;
  };
}

export function getStats(): StatsView {
  const stats = loadStats();
  const totals = stats.reduce(
    (a, s) => ({
      calls: a.calls + s.calls,
      prompt_tokens: a.prompt_tokens + s.prompt_tokens,
      completion_tokens: a.completion_tokens + s.completion_tokens,
      cost_usd: a.cost_usd + s.cost_usd,
      errors: a.errors + s.errors,
    }),
    { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, errors: 0 },
  );
  return { per_key: stats, totals };
}

export function resetStats(): void {
  saveStats([]);
}

// ─────────────────────────────────────────────────────────────
// 池调度（轮询 + 失败转移）与调用
// ─────────────────────────────────────────────────────────────

/**
 * 每个供应商一个 `KeyPool`（**复用共享的 `llm_pool.KeyPool`**，不新写第二份状态机）：按 key 集合缓存，
 * 于是「轮转位置 + 冷却窗口」**跨调用**保持 —— 第 1 把断了，下一次从第 2 把开始；转完一圈才回第 1 把。
 */
const keyPools = new Map<string, { pool: KeyPool; keyId: string }>();
function poolForProvider(provider: GatewayProvider): KeyPool {
  const keyId = provider.keys.join('\n');
  let e = keyPools.get(provider.id);
  if (!e || e.keyId !== keyId) {
    e = { pool: new KeyPool(provider.keys), keyId };
    keyPools.set(provider.id, e);
  }
  return e.pool;
}

/** 供应商层游标（加权轮询；进程内存态，重启归零可接受） */
let providerCursor = 0;

/** 测试用：重置池调度游标（生产无调用；让用例可确定性验证轮询/故障转移） */
export function _resetGatewayCursors(): void {
  keyPools.clear();
  providerCursor = 0;
}

interface Endpoint {
  provider: GatewayProvider;
  key: string;
  pool: KeyPool;
  idx: number;
}

/** 选择下一个可用供应商 + 池内 key（供应商加权轮询 + 池内 round-robin）；全冷却时抛错。 */
function pickEndpoint(now: number): Endpoint {
  const cfg = loadGatewayConfig();
  const enabled = cfg.providers.filter((p) => p.enabled && p.keys.length > 0);
  if (enabled.length === 0) throw new Error('网关无可用供应商（未配置或全部停用）');
  const totalWeight = enabled.reduce((a, p) => a + Math.max(1, p.weight), 0);
  const start = providerCursor % totalWeight;
  for (let hop = 0; hop < totalWeight; hop++) {
    let slot = (start + hop) % totalWeight;
    let provider = enabled[enabled.length - 1];
    for (const p of enabled) {
      slot -= Math.max(1, p.weight);
      if (slot < 0) {
        provider = p;
        break;
      }
    }
    const pool = poolForProvider(provider);
    const idx = pool.pick(now);
    if (idx >= 0) {
      providerCursor = (start + hop + 1) % totalWeight;
      return { provider, key: provider.keys[idx], pool, idx };
    }
  }
  throw new Error('网关所有 key 均在冷却窗口内（无可用端点）');
}

export interface GatewayChatOptions {
  temperature?: number;
  timeoutMs?: number;
  /** 池内最多尝试次数（默认 3：换 key/供应商） */
  maxAttempts?: number;
  /** 是否强制 JSON 输出（内部决策契约用）；通用 /v1 端点默认 false，保持 OpenAI 标准行为 */
  jsonMode?: boolean;
  /** 输出上限（透传 max_tokens；不填则不传，沿用上游默认） */
  maxTokens?: number;
}

/** 上游 HTTP 错误（带状态码，供失败转移判定是否可重试） */
class GatewayHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GatewayHttpError';
  }
}

async function callProvider(
  provider: GatewayProvider,
  key: string,
  messages: Array<{ role: string; content: string }>,
  opts: { temperature: number; timeoutMs: number; model?: string; jsonMode?: boolean; maxTokens?: number },
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const payload: Record<string, unknown> = {
    model: opts.model || provider.model,
    messages,
    temperature: opts.temperature,
  };
  if (typeof opts.maxTokens === 'number') payload.max_tokens = opts.maxTokens;
  if (opts.jsonMode) payload.response_format = { type: 'json_object' };
  const res = await fetch(`${provider.base_url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) {
    throw new GatewayHttpError(`HTTP ${res.status}：${(await res.text()).slice(0, 160)}`, res.status);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: (data.choices?.[0]?.message?.content ?? '').trim(),
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * 走网关调用 LLM（**全仓唯一出网点**）：加权轮询选供应商 → 池内 round-robin 选 key →
 * 失败自动切下一个 key/供应商。每次调用都记录用量（token/费用/延迟/错误）到 gateway.stats.json。
 *
 * 轮转口径（用户裁定）：池是**跨调用**前进的 —— 第 1 把断了，**下一次从第 2 把开始**；
 * 第 2 把断了从第 3 把开始；**转完一圈才回第 1 把**。调用方**只传 messages**，不碰上游 / key / 池。
 */
export async function chatViaGateway(
  messages: Array<{ role: string; content: string }>,
  opts: GatewayChatOptions = {},
): Promise<ChatResult> {
  const temperature = opts.temperature ?? 0.2;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const jsonMode = opts.jsonMode === true;
  const maxTokens = opts.maxTokens;
  const cooldownMs = 15_000;
  const retryStatuses = new Set([429, 500, 502, 503, 504]);

  let lastErr: unknown = null;
  for (let i = 0; i < maxAttempts; i++) {
    const { provider, key, pool, idx } = pickEndpoint(Date.now());
    const start = Date.now();
    try {
      const r = await callProvider(provider, key, messages, { temperature, timeoutMs, jsonMode, maxTokens });
      const cost =
        (provider.price_prompt_per_1m * r.usage.prompt_tokens) / 1_000_000 +
        (provider.price_completion_per_1m * r.usage.completion_tokens) / 1_000_000;
      recordUsage(provider.id, key, { prompt: r.usage.prompt_tokens, completion: r.usage.completion_tokens, cost, ok: true, ms: Date.now() - start });
      return { content: r.content, usage: r.usage, provider_id: provider.id, key_fp: keyFingerprint(key), model: provider.model };
    } catch (e) {
      lastErr = e;
      recordUsage(provider.id, key, { prompt: 0, completion: 0, cost: 0, ok: false, ms: Date.now() - start });
      // 失败转移：可重试状态（429/5xx）冷却该 key，下一轮 pick 直接跳过它；
      // 网络层错误（UND_ERR_SOCKET/超时）不冷却，但池游标已前进 ⇒ 下一轮换 key/新连接。
      if (e instanceof GatewayHttpError && retryStatuses.has(e.status)) {
        pool.cooldown(idx, Date.now(), cooldownMs);
      }
    }
  }
  // 保留最后一次错误为 cause（调用方据此判定超时/网络类可重试；不吞原始错误）。
  // ★★ 2026-10-10（T-e2e 顺带）：**不改语义**，只补一句**可操作线索**，让"本机到不了它"与"它坏了"能分开。
  //   实测教训：`fetch failed` 极易被误读成"上游不稳定"，而真相可能是**本机到不了境外** ——
  //   两者给出的是**同一句**网络层错误，光看这句**无从区分**。一个对照探针就能定性。
  throw new Error(
    `网关所有可用端点均失败：${(lastErr as Error)?.message ?? lastErr}\n` +
      `★ 线索（不改上句判定，只帮你定性「本机到不了它」还是「它坏了」）：像 \`fetch failed\` 这类网络层错误，` +
      `本机出网问题与境外上游故障**给出同一句**。先跑一个**非境外**站点做对照探针 —— 通了 ⇒ 本机能出网、` +
      `更可能是境外上游/中转；不通 ⇒ 先查本机网络/代理。例：` +
      `\`curl -sS -o /dev/null -w '%{http_code}\\n' https://www.baidu.com\`。`,
    { cause: lastErr },
  );
}

/** 测试单供应商连通性（发一条 ping，不影响用量统计） */
export async function testProvider(id: string): Promise<{ ok: boolean; ms: number; model: string; error?: string }> {
  const cfg = loadGatewayConfig();
  const provider = cfg.providers.find((p) => p.id === id);
  if (!provider) return { ok: false, ms: 0, model: '', error: `供应商不存在：${id}` };
  const start = Date.now();
  try {
    await callProvider(provider, provider.keys[0], [{ role: 'user', content: 'ping' }], { temperature: 0, timeoutMs: 20_000 });
    return { ok: true, ms: Date.now() - start, model: provider.model };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, model: provider.model, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────
// OpenAI 兼容端点（上层网关可把我当 upstream）
// ─────────────────────────────────────────────────────────────

export interface OpenAICompatRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export async function handleOpenAICompatRequest(body: OpenAICompatRequest): Promise<{
  status: number;
  body: unknown;
}> {
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return { status: 400, body: { error: { message: 'messages 必填', type: 'invalid_request_error' } } };
  }
  if (!hasEnabledProvider()) {
    return {
      status: 503,
      body: { error: { message: '网关未配置任何可用 LLM 供应商（前往设置页添加）', type: 'gateway_not_configured' } },
    };
  }
  try {
    const r = await chatViaGateway(body.messages, {
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.2,
      maxAttempts: 3,
    });
    const created = Math.floor(Date.now() / 1000);
    return {
      status: 200,
      body: {
        id: `chatcmpl-${crypto.randomBytes(8).toString('hex')}`,
        object: 'chat.completion',
        created,
        model: r.model,
        provider_id: r.provider_id,
        choices: [{ index: 0, message: { role: 'assistant', content: r.content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: r.usage.prompt_tokens, completion_tokens: r.usage.completion_tokens, total_tokens: r.usage.prompt_tokens + r.usage.completion_tokens },
      },
    };
  } catch (e) {
    return { status: 502, body: { error: { message: (e as Error).message, type: 'upstream_error' } } };
  }
}
