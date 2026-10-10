/**
 * llm_focus：LLM 关键节点选择（"用户不是直接看整条路线，而是聚焦某些关键节点"）
 *
 * 关键节点由 LLM 列出，但数据经过整条链路的真实流转（trace_exec）——LLM 只做"选点/解释"，
 * 不做"造假值"。职责分离：
 *   - trace_exec：数据真实流转（用户输入 → 每步真实 in/out）
 *   - llm_focus：从全链里挑出值得聚焦的关键节点（判定点/汇聚点/高风险函数），附理由
 *
 * 配置（用户偏好：配置文件管理 API keys/model 参数，未来前端 HUB 集成）：
 *   <home>/.agent-io/config.json        ← 默认（含密钥，放用户主目录，避免随项目打包/提交泄漏）
 *   <projectRoot>/.agent-io/config.json ← 旧默认位置，读取时回退兼容
 *   { "llm": { "apiKey": "sk-...", "model": "gpt-4o-mini", "baseURL": "https://api.openai.com/v1" } }
 *   环境变量覆盖：LLM_API_KEY / LLM_MODEL / LLM_BASE_URL
 */

import { DATA_DIR_NAME } from './data_dir.js';
import { KeyPool, loadKeys } from './llm_pool.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as storage from './storage.js';

// ─────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────

export interface LlmConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  /** key 池（多把轮转）；缺省只用 `apiKey`。`callChat` 据此支持池（会话线由此认池）。 */
  keys?: string[];
}

/** 配置主目录：AGENT_IO_HOME 显式覆盖（测试/部署用）优先，否则用户主目录 */
export function getConfigHome(): string {
  return process.env.AGENT_IO_HOME ?? os.homedir();
}

/** 写入/新位置：<configHome>/.agent-io/config.json（默认用户主目录） */
export function configFilePath(): string {
  return path.join(getConfigHome(), DATA_DIR_NAME, 'config.json');
}

/**
 * 实际读取路径：新位置（主目录）优先；不存在时回退旧默认位置
 * （<projectRoot>/.agent-io/config.json），兼容升级前已落盘的配置。
 */
export function configFileReadPath(): string {
  const home = configFilePath();
  if (fs.existsSync(home)) return home;
  const legacy = path.join(storage.getDataHome(), DATA_DIR_NAME, 'config.json');
  return legacy !== home && fs.existsSync(legacy) ? legacy : home;
}

// ─────────────────────────────────────────────────────────────
// ★★ 唯一住处：AGNES 上游 / key（池） / 模型（2026-10-10）
// ─────────────────────────────────────────────────────────────
//
// 为什么必须只有这一处：此前「上游在哪、key 从哪来、用哪个模型」分散在三处、名字不同、语义还不同 ——
//   · 会话线（本文件 loadAgentConfig）  ：AGNES_API_KEY / AGNES_BASE_URL（**含 /v1**） / AGNES_MODEL
//   · 翻译线（authoring/translate/llm） ：AGNES_KEY_POOL（池） / AGNES_UPSTREAM_BASE（**不含 /v1**） / AGNES_MODEL
//   · gateway（application/meta/llm）    ：又一份 AGNES_* + 又一份默认常量
// ⇒ **两个变量名干同一件事**（`AGNES_UPSTREAM_BASE` 不含 /v1 vs `AGNES_BASE_URL` 含 /v1），
//   照抄一个到另一个就拼错路径；且只有翻译线支持池 ⇒ 会话线真跑落到默认上游 + 单把 key ⇒ 429。
//
// ★ 归一化口径（canonical）：**无 `/v1` 的上游根**（例：`https://apihub.agnes-ai.com`）。
//   - 默认值两种写法（`.../v1` 与 `...`）本就指**同一个上游** ⇒ 统一剥掉尾部 `/v1` 即同一根。
//   - 需要 OpenAI `base_url` 的调用方（callChat / gateway）**一律**经 `agnesApiBaseUrl()` 追加**唯一一次** `/v1`。
//   - 需要「根 + `/v1/chat/completions`」的调用方（翻译线）直接用根，自拼一次 `/v1`。
//   ⇒ 于是「含不含 /v1」只在**归一化一处**被决定，三条线拿到的都是归一化后的值。

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

/** 上游是否由 `AGNES_UPSTREAM_BASE` 显式指向（翻译线「指向本地 key-pool-proxy ⇒ 客户端无需 key」判定沿用此口径） */
export function agnesUpstreamProxyConfigured(): boolean {
  return process.env.AGNES_UPSTREAM_BASE !== undefined;
}

/** 解析模型。优先级：`AGNES_MODEL` > 默认 `agnes-2.5-flash` */
export function resolveAgnesModel(): string {
  return process.env.AGNES_MODEL?.trim() || DEFAULT_AGNES_MODEL;
}

/** 解析 key 池。优先级：`AGNES_KEY_POOL`（逗号分隔多把）→ `AGNES_API_KEY`（单把）。复用共享的 `loadKeys`。 */
export function resolveAgnesKeys(): string[] {
  return loadKeys('AGNES_KEY_POOL', ['AGNES_API_KEY']);
}

// ─────────────────────────────────────────────────────────────
// Agent 配置（L3 思维导图 Agent / 管理 Agent 默认后端 = AGNES）
// ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  /** key 池（多把轮转）。会话线据此支持 key 池；`apiKey` = `keys[0]`（兼容只读单把的旧调用方） */
  keys?: string[];
}

/**
 * 读取管理 Agent 的 LLM 配置。优先级：
 *   1) AGNES 环境（`AGNES_KEY_POOL` / `AGNES_API_KEY` + `AGNES_UPSTREAM_BASE` / `AGNES_BASE_URL` + `AGNES_MODEL`）
 *      —— 上游/key池/模型统一由上面的 `resolveAgnes*` 解析；有多把 key 时返回 `keys` 池。
 *   2) config.json 的 agent.mmd 段（{ "agent": { "mmd": {...} } }）
 * 无 key 返回 null（此时管理 Agent 走规则降级）。
 * 说明：Agent 默认后端固定为 AGNES，与科普讲解（DeepSeek）解耦。
 */
export function loadAgentConfig(): AgentConfig | null {
  const keys = resolveAgnesKeys();
  if (keys.length > 0) {
    return {
      apiKey: keys[0],
      keys,
      model: resolveAgnesModel(),
      baseURL: resolveAgnesApiBaseUrl(),
    };
  }

  const cfgPath = configFileReadPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const mmd = raw?.agent?.mmd;
      if (mmd && mmd.apiKey) {
        return {
          apiKey: mmd.apiKey,
          model: mmd.model || DEFAULT_AGNES_MODEL,
          baseURL: agnesApiBaseUrl(mmd.baseURL || DEFAULT_AGNES_UPSTREAM),
        };
      }
    } catch {
      // config 损坏：忽略，无配置走规则回答
    }
  }
  return null;
}

export function loadLlmConfig(): LlmConfig | null {
  const fromEnv: Partial<LlmConfig> = {};
  if (process.env.LLM_API_KEY) fromEnv.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_MODEL) fromEnv.model = process.env.LLM_MODEL;
  if (process.env.LLM_BASE_URL) fromEnv.baseURL = process.env.LLM_BASE_URL;

  let fileCfg: Partial<LlmConfig> = {};
  const cfgPath = configFileReadPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (raw && raw.llm) {
        fileCfg = {
          apiKey: raw.llm.apiKey,
          model: raw.llm.model,
          baseURL: raw.llm.baseURL,
        };
      }
    } catch {
      // config 损坏：忽略，走环境变量/无配置
    }
  }
  let cfg: LlmConfig = {
    apiKey: fromEnv.apiKey ?? fileCfg.apiKey ?? '',
    model: fromEnv.model ?? fileCfg.model ?? 'gpt-4o-mini',
    baseURL: (fromEnv.baseURL ?? fileCfg.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
  // 兜底：未配置专用 llm 段时复用 agent.mmd（AGNES，OpenAI 兼容），
  // 使 overview / feature_tree / mind_map 等通用提炼功能开箱即用。
  // ★ 继承 agent 的 key 池（keys）：会话线（harvest_decisions / role_title 等）由此也能轮转多把 key。
  if (!cfg.apiKey) {
    const agent = loadAgentConfig();
    if (agent) cfg = { apiKey: agent.apiKey, model: agent.model, baseURL: agent.baseURL, keys: agent.keys };
  }
  return cfg.apiKey ? cfg : null;
}

// ─────────────────────────────────────────────────────────────
// 科普讲解配置（explain_gen 的三档文案后端：DeepSeek / Agnes）
// ─────────────────────────────────────────────────────────────

export interface ExplainConfig {
  apiKey: string;
  model: string;
  baseURL: string;
}

const DEFAULT_DS_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_DS_MODEL = 'deepseek-v4-flash';

/** 读取讲解文案生成配置。优先级：DeepSeek 环境变量 > config.json explain 段 > Agnes 环境（池/单把）。无 key 返回 null。 */
export function loadExplainConfig(): ExplainConfig | null {
  // DeepSeek（首选后端）
  const dsEnv: Partial<ExplainConfig> = {};
  if (process.env.DEEPSEEK_API_KEY) dsEnv.apiKey = process.env.DEEPSEEK_API_KEY;
  if (process.env.DEEPSEEK_BASE_URL) dsEnv.baseURL = process.env.DEEPSEEK_BASE_URL;
  if (process.env.DEEPSEEK_MODEL) dsEnv.model = process.env.DEEPSEEK_MODEL;

  // Agnes（兼容后端）—— 上游/模型/key 池统一由 resolveAgnes* 解析；单 key 形状取池第一把
  const agnesKeys = resolveAgnesKeys();

  let fileCfg: Partial<ExplainConfig> = {};
  const cfgPath = configFileReadPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (raw && raw.explain) {
        fileCfg = {
          apiKey: raw.explain.apiKey,
          model: raw.explain.model,
          baseURL: raw.explain.baseURL,
        };
      }
    } catch {
      // config 损坏：忽略，走环境变量/无配置
    }
  }

  // 1) DeepSeek 环境变量
  if (dsEnv.apiKey) {
    return {
      apiKey: dsEnv.apiKey,
      model: dsEnv.model ?? DEFAULT_DS_MODEL,
      baseURL: (dsEnv.baseURL ?? DEFAULT_DS_BASE_URL).replace(/\/+$/, ''),
    };
  }
  // 2) config.json explain 段（默认落到 DeepSeek）
  if (fileCfg.apiKey) {
    return {
      apiKey: fileCfg.apiKey,
      model: fileCfg.model ?? DEFAULT_DS_MODEL,
      baseURL: (fileCfg.baseURL ?? DEFAULT_DS_BASE_URL).replace(/\/+$/, ''),
    };
  }
  // 3) Agnes 环境（兼容；池/单把皆可）
  if (agnesKeys.length > 0) {
    return {
      apiKey: agnesKeys[0],
      model: resolveAgnesModel(),
      baseURL: resolveAgnesApiBaseUrl(),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// OpenAI 兼容 chat 调用
// ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 会话线**共享**的 key 池：按 key 集合缓存一个 `KeyPool`，使**跨调用**也 round-robin 并共享冷却窗口。
 * 为什么必须共享（而不是每次调用 `new KeyPool`）：per-call 池每次都从 `key[0]` 起 —— 正常（无 429）时
 * 永远只用第一把，池等于没在用。共享池 = 与翻译线「一个 translator 一个池」同形，池才真的分摊负载。
 */
const sharedKeysPools = new Map<string, KeyPool>();
function sharedPoolFor(keys: string[]): KeyPool {
  const id = keys.join('\n');
  let pool = sharedKeysPools.get(id);
  if (!pool) {
    pool = new KeyPool(keys);
    sharedKeysPools.set(id, pool);
  }
  return pool;
}

export async function callChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  temperature = 0.2,
  /** 请求超时（默认 90s；慢端点上大 prompt 曾出现 5 分钟悬挂，必须有保护） */
  timeoutMs = 90_000,
): Promise<string> {
  // ★ key 池（会话线由此支持池）：有 keys 则多把轮转，遇 429/5xx（或被上游关闭 socket 的网络错）
  //   换 key / 新连接重试（复用共享 KeyPool）；单把时不重试 —— 与旧版行为完全一致。
  const keys = (cfg.keys && cfg.keys.length > 0 ? cfg.keys : [cfg.apiKey]).filter(Boolean);
  if (keys.length === 0) throw new Error('[llm_focus] 无可用 LLM key（apiKey / keys 均为空）。');
  const pool = sharedPoolFor(keys);
  const retrySet = new Set([429, 500, 502, 503, 504]);
  const cooldownMs = 15_000;
  // 尝试预算：单把 = 1（与旧版完全一致）；有池 = 池大小 + 3 次额外机会，
  // 让「换 key / 换新连接」也能吸收偶发的网络层抖动（实测上游会关闭池化连接 → UND_ERR_SOCKET）。
  const maxAttempts = keys.length > 1 ? keys.length + 3 : 1;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idx = pool.pick(Date.now());
    if (idx < 0) break; // 池内全部处于冷却
    let res: Response;
    try {
      res = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keys[idx]}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature,
          response_format: { type: 'json_object' }, // 兼容 OpenAI/DeepSeek 等
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (netErr) {
      // 网络层失败（如 UND_ERR_SOCKET：上游关闭了池化连接）—— 有池就换 key/新连接再试，单把照旧立即抛。
      lastErr = netErr instanceof Error ? netErr : new Error(String(netErr));
      if (keys.length > 1) continue;
      throw lastErr;
    }
    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return (data.choices?.[0]?.message?.content ?? '').trim();
    }
    const err = new Error(`LLM 调用失败 ${res.status}：${(await res.text()).slice(0, 200)}`);
    if (retrySet.has(res.status)) {
      pool.cooldown(idx, Date.now(), cooldownMs);
      lastErr = err;
      continue;
    }
    throw err;
  }
  throw lastErr ?? new Error('[llm_focus] key 池已全部冷却或重试耗尽');
}

// ─────────────────────────────────────────────────────────────
// 关键节点选择
// ─────────────────────────────────────────────────────────────

export interface FocusNode {
  node_id: string;
  reason: string;
}

export interface ChainNodeInfo {
  node_id: string;
  label: string;
  func_name: string;
  description: string;
  /** 是否判定节点（CFG 分支/循环） */
  is_judgement: boolean;
  /** 是否跨文件追加 */
  is_cross: boolean;
}

export interface FocusResult {
  /** 是否真正用 LLM 选点（false = 未配置/降级为启发式） */
  llm: boolean;
  key_nodes: FocusNode[];
  /** 未配置或调用失败的原因（降级说明） */
  note?: string;
}

/**
 * 从全链选关键节点。
 * - 有 LLM 配置：交给 LLM（给节点清单 + 判定上下文，返回 JSON 选点+理由）
 * - 无配置/失败：启发式降级（判定节点优先，跨文件/汇聚节点次之），如实标注 llm=false
 * 注意：LLM 只选"哪些节点值得看"，不生成任何数据值——值全部来自 trace_exec 真实流转。
 */
export async function pickKeyNodes(
  cfg: LlmConfig | null,
  chain: ChainNodeInfo[],
  opts?: { max?: number; userFocus?: string },
): Promise<FocusResult> {
  const max = opts?.max ?? 5;
  if (chain.length === 0) return { llm: false, key_nodes: [], note: '链路为空' };

  if (!cfg) {
    return {
      llm: false,
      key_nodes: heuristicFocus(chain, max),
      note: '未配置 LLM（.agent-io/config.json 或环境变量），已用启发式选点',
    };
  }

  const chainText = chain
    .map((n, i) =>
      [
        `${i + 1}. node_id=${n.node_id}`,
        `   函数=${n.func_name}`,
        `   判定=${n.is_judgement ? '是' : '否'} 跨文件=${n.is_cross ? '是' : '否'}`,
        `   说明=${n.description || n.label}`,
      ].join('\n'),
    )
    .join('\n');

  const system =
    '你是数据流可读性助手。用户在图里追踪一条数据链路，不想看全部节点，只想聚焦少数关键节点。' +
    '请从给定的链路节点中挑选出最值得聚焦的关键节点（最多 ' + max + ' 个），并给出人话理由。' +
    '判定节点（if/循环/分支）通常优先，汇聚点（多入边）、跨文件调用、异常处理次之。' +
    '只输出 JSON：{"key_nodes":[{"node_id":"...","reason":"..."}]}，node_id 必须来自给定清单。';

  const user = (opts?.userFocus ? `用户关注的焦点：${opts.userFocus}\n\n` : '') + `数据链路节点：\n${chainText}`;

  try {
    const raw = await callChat(cfg, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const parsed = JSON.parse(raw) as { key_nodes?: Array<{ node_id?: string; reason?: string }> };
    const known = new Set(chain.map((n) => n.node_id));
    const keyNodes: FocusNode[] = (parsed.key_nodes ?? [])
      .filter((k) => k.node_id && known.has(k.node_id))
      .slice(0, max)
      .map((k) => ({ node_id: k.node_id as string, reason: k.reason || '聚焦点' }));
    if (keyNodes.length === 0) {
      return { llm: true, key_nodes: heuristicFocus(chain, max), note: 'LLM 未返回有效节点，已用启发式选点' };
    }
    return { llm: true, key_nodes: keyNodes };
  } catch (e) {
    return {
      llm: false,
      key_nodes: heuristicFocus(chain, max),
      note: `LLM 调用失败（${(e as Error).message}），已用启发式选点`,
    };
  }
}

/** 启发式降级：判定节点 → 跨文件 → 汇聚节点，再按出现顺序补足 */
function heuristicFocus(chain: ChainNodeInfo[], max: number): FocusNode[] {
  const out: FocusNode[] = [];
  const push = (n: ChainNodeInfo, reason: string) => {
    if (out.length >= max) return;
    if (!out.some((o) => o.node_id === n.node_id)) out.push({ node_id: n.node_id, reason });
  };
  for (const n of chain) if (n.is_judgement) push(n, '判定点：数据在此分流，值得聚焦');
  for (const n of chain) if (!n.is_judgement && n.is_cross) push(n, '跨文件调用：数据流出本文件');
  for (const n of chain) if (!n.is_judgement && !n.is_cross) push(n, '关键处理');
  return out;
}
