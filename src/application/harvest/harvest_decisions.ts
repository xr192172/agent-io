/**
 * harvest_decisions —— 把源码注释 / 文档 / 提交信息提取成「**这个文件为什么存在**」的决策。
 *
 * ★★★ 决策卡定义（用户 2026-10-10 原话，本工具的最高依据）：
 *   「每一个文件**为什么要存在**这样一个决策，就等于你 git 推送的时候推送的那个**理由**……
 *    这个决策就是给 LLM 读**为什么会出现这个**的原因，也可以给人读。
 *    因为你在 DSL 里面，你不可能去读源文件的注释……等于是**把注释从文件中提取出来变成决策**。
 *    而且是有**历史决策**，历史决策需要主动去翻，我们**只显示最后一次**的决策。」
 *   ⇒ **单位 = 文件**（不是 md 的一节、不是一行）；决策挂在**文件节点**的 `decision` 字段
 *     （reader：`src/application/meta/explore/query_feature.ts` 的 `decisions_own` / `:360`）；
 *     有历史（节点 `decision_history`），默认只显示最新一条；用途 = **省**（读 DSL 就不必翻源码）。
 *
 * ★ 本文件为什么被**重写**（不是打补丁）：旧版**没有任何 LLM 通路**，靠一张设计意图关键词表
 *   + 一套"按行形状"正则（表格行/引用/标题/围栏/纯列表/半句话逐个判）判断"这是不是一条决策"，
 *   自述"宁多勿漏"⇒ 判不准 ⇒ 多收噪声 ⇒ 靠"draft 复核"兜底 ⇒ 而复核**不存在**（`docs/todo.md` T106 D1）
 *   ⇒ 人加形状护栏 ⇒ 越厚越列不全。用户裁定：
 *   「护栏越打越多，只能说明这个规则本身不完善；**只有你不断去重写它才是更合适的**。」
 *   ⇒ 本版换掉**判据本身**：判断交给 LLM；"形状问题"从"过滤"变成**"产不出"**（见 `DecisionElements`）。
 *
 * 三条产出策略：
 *   - `comment`：逐个**源码文件**问 LLM「这个文件为什么存在」（读它的**注释块**）—— 主路径
 *   - `doc`    ：逐个**文档文件**问同一个问题（读它的正文）
 *   - `gitlog` ：逐条**提交信息**判 LLM「这是不是一条决策记录」（提交信息本身就是决策记录）
 *
 * ★★ 没有 LLM ⇒ **抛**（不回落关键词）—— 本仓铁律"不许兜底，失败就是失败"。
 * ★ 抽奖：每个文件/提交 **R=3** 次采样 → 按结论归一化去重 → 记 `votes`（置信 = votes / R）。
 *   LLM 的随机性**不当缺陷治，当机制用**：多次都抽到的 = 高置信。
 * ★ 本工具**只产决策线索**（`decision.status = 'draft'`），**不写 DSL** —— 定稿写入口是**下一步**（D1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gitAvailable } from '../../infrastructure/exec_guard.js';
import { ensureProjectIndex } from '../../infrastructure/index/index_freshness.js';
import type { Database } from '../../infrastructure/index/db.js';
import { loadLlmConfig, callChat, configFilePath, loadExplainConfig } from '../../infrastructure/llm_focus.js';
import { withTouched, type Touched, type TouchedProduct } from '../../domain/b_terms.js';
import type { NodeDecision, DecisionHistoryEntry } from '../../domain/geometry.js';

export type HarvestSource = 'comment' | 'doc' | 'gitlog';

export interface LifecycleHint {
  type: 'retired' | 'merged' | 'superseded' | 'split';
  detail: string;
}

/**
 * ★★★ **产出契约**（这条是本次重写的核心）—— 一条决策线索必须**同时**具备三要素：
 *   ① 结论 `why`    ：这个文件为什么存在（一句话**理由**，不是"做什么"）
 *   ② 出处 `origin` ：注释位置 `文件:行`（复核依据）
 *   ③ 作用对象 `subject`：该文件（仓库相对路径 / feature 名）
 *
 * ★ 它不是**过滤器**（过滤器先收下再按规则丢弃，规则只会越打越厚）；它是**接口的形状**：
 *   三要素任一为空 ⇒ 这条决策**根本构造不出来**（见 {@link buildLead} 返回 `null`）。
 *   ⇒ 于是"表格行 / 引用块 / 半句话 / 围栏内"这类**形状问题自动消失** —— 不是被规则挡住的，
 *     是模型填不出三要素时**产不出**。这正是"补丁尽量少、原生源码尽量多"。
 */
export interface DecisionElements {
  /** ① 结论：这个文件为什么存在（一句话理由） */
  why: string;
  /** ② 出处：注释位置 `文件:行`（comment/doc）/ `git:<hash>`（gitlog） */
  origin: string;
  /** ③ 作用对象：该文件（仓库相对路径）/ feature 名（gitlog 提交是 feature 级决策记录） */
  subject: string;
}

/** 一条「文件为什么存在」的决策（三要素齐备才产得出；`decision` 可**直接落到文件节点的 `decision` 字段**） */
export interface HarvestCandidate {
  /** 作用对象：comment/doc = 该文件（仓库相对路径）；gitlog = feature 名 */
  file_path: string;
  source: HarvestSource;
  /** 出处：comment/doc = `文件:行`（注释/正文位置）；gitlog = `git:<hash>` */
  ref: string;
  /** 决策本体：可直接落到文件节点的 `decision` 字段（`status` 为 `draft` —— 写回是下一步 D1） */
  decision: NodeDecision;
  /**
   * 历史决策（旧版，默认不显示）。★ 本工具只产**最新一条** ⇒ 此处**恒不填**；
   * 旧版压栈由 D1 写入口在"用新版取代旧版"时完成 —— 本字段仅声明产物**可承载历史**
   * （用户裁定：有历史、默认只显示最后一次）。
   */
  decision_history?: DecisionHistoryEntry[];
  /** 抽奖票数：R 次采样中该结论被抽到几次 */
  votes: number;
  /** 采样轮数 R（置信 = votes / samples） */
  samples: number;
  /** 原始证据（注释原文 / 文档正文片段），供逐条复核 */
  evidence: string;
  /** 生命周期提示（下线/合并/取代/拆分），供 diff 与归档参考 */
  lifecycle_hint?: LifecycleHint;
}

export interface HarvestResult {
  message: string;
  feature: string;
  candidates: HarvestCandidate[];
}

export interface HarvestInput {
  /** feature 名（候选挂载目标） */
  feature: string;
  /** 文档目录（扫描 *.md），默认 <cwd>/docs */
  doc_dir?: string;
  /** git 仓库根（读 git log），默认 <cwd> */
  git_root?: string;
  /** git 日志条数上限，默认 30 */
  limit?: number;
  /** 显式指定要提取注释的源码文件（绝对路径）；**缺省 = 扫描项目已索引的全部源码文件** */
  comment_files?: string[];
}

// ──────── 常量（复用 role_title.ts 的批量/并发形状） ────────

/**
 * 抽奖轮数 **R = 3**。为什么是 3：
 *   ① 要能区分"稳定 vs 不稳定"，至少需要**一轮平局之外的多数** —— 2 轮只能 1:1 平局，判不出；
 *   ② 3 是最小的**奇数**（多数票不会平局），且"3 次里 2~3 次都抽到"已足够把随机噪声压下去；
 *   ③ 再多轮边际收益迅速变小而成本线性上升（用户指定 R=3）。
 */
const R = 3;
/** 每批最多文件数，默认 20（与 role_title 一致，控制单次 payload 长度） */
const BATCH_SIZE = 20;
/** 并发批数上限，默认 3（与 role_title 一致） */
const CONCURRENCY = 3;
/** 每个文件喂给 LLM 的线索行上限（控制 payload；文档正文尤其需要截断） */
const MAX_SIGNAL_LINES = 40;
/** 证据字段截断长度 */
const EVIDENCE_MAX = 240;
/** 源码扩展名（"已索引的源码文件"取这些；md 走 doc 策略，其它忽略） */
const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|py)$/i;

const LIFECYCLE_RULES: Array<{ kw: string[]; type: LifecycleHint['type'] }> = [
  { kw: ['弃用', '下线', '废弃', '删除'], type: 'retired' },
  { kw: ['合并', '并入'], type: 'merged' },
  { kw: ['取代', '替代', '替换'], type: 'superseded' },
  { kw: ['拆分', '拆开'], type: 'split' },
];

function lifecycleHint(text: string): LifecycleHint | undefined {
  for (const rule of LIFECYCLE_RULES) {
    for (const kw of rule.kw) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        return { type: rule.type, detail: text.slice(Math.max(0, idx - 20), idx + 30).replace(/\s+/g, ' ').trim() };
      }
    }
  }
  return undefined;
}

// ──────── LLM 配置（★ 没有就抛，绝不回落关键词） ────────

type LlmCfg = NonNullable<ReturnType<typeof loadLlmConfig>>;

/** 把讲解后端配置（ExplainConfig）转成通用 LLM 配置（LlmConfig）—— 与 role_title.ts 的 `toLlmCfg` 同形。 */
function toLlmCfg(c: ReturnType<typeof loadExplainConfig>): LlmCfg | null {
  return c ? { apiKey: c.apiKey, model: c.model, baseURL: c.baseURL } : null;
}

/**
 * ★★ 取得 LLM 配置；**取不到就抛**。
 *
 * role_title.ts 在此处是 `if (!cfg) return {}`（静默降级为"只显示文件名"）—— 本工具**不继承**这条：
 * 判断"这是不是一条决策"本就属"判断"，没有 LLM 就**没有判据** ⇒ 只能失败。
 * 错误消息说清"需要什么"以及"去哪配"（本仓铁律：不许兜底，失败就是失败）。
 */
function requireLlmConfig(): LlmCfg {
  const cfg = loadLlmConfig() ?? toLlmCfg(loadExplainConfig());
  if (cfg) return cfg;
  throw new Error(
    'harvest_decisions 需要 LLM 配置：判断「这个文件为什么存在」必须用 LLM，没有 LLM 就没有判据。\n' +
      `请在 ${configFilePath()} 写入 { "llm": { "apiKey": "...", "model": "...", "baseURL": "..." } }，` +
      '或设置环境变量 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL（亦兼容 DEEPSEEK_API_KEY / AGNES_API_KEY）。\n' +
      '本工具不回落关键词（本仓铁律：不许兜底，失败就是失败）。',
  );
}

// ──────── 产出契约的落点（唯一构造点） ────────

/**
 * ★★★ **产出契约**：三要素齐备才构造得出，缺一即"**产不出**"（返回 `null`）。
 *
 * ★ 与"过滤器"的区别就写在这里：过滤器是"先把行收成候选，再按形状规则**丢弃**不合格的"——
 *   于是规则越加越多。这里没有"收下"这一步：{@link DecisionElements} 三要素任一为空
 *   ⇒ 这条决策**根本不存在**。解析口（`askFileBatch` / `askCommitBatch`）**只**把三要素齐备的条目交到这里。
 */
function buildLead(
  el: DecisionElements,
  rest: { source: HarvestSource; votes: number; samples: number; evidence: string; lifecycle_hint?: LifecycleHint },
): HarvestCandidate | null {
  if (!el.subject.trim()) return null; // ③ 作用对象缺 ⇒ 产不出
  if (!el.origin.trim()) return null; // ② 出处缺 ⇒ 产不出
  if (!el.why.trim()) return null; // ① 结论缺 ⇒ 产不出
  const decision: NodeDecision = { summary: el.why.trim(), status: 'draft', author: 'llm' };
  const lead: HarvestCandidate = {
    file_path: el.subject.trim(),
    source: rest.source,
    ref: el.origin.trim(),
    decision,
    votes: rest.votes,
    samples: rest.samples,
    evidence: rest.evidence,
  };
  if (rest.lifecycle_hint) lead.lifecycle_hint = rest.lifecycle_hint;
  return lead;
}

// ──────── git 日志提取 ────────

function gitLogEntries(gitRoot: string, limit: number): Array<{ hash: string; subject: string }> {
  // ★ 先过 exec_guard：环境里没有 git 时 spawn 会白等约 5.1 秒（实测本工具 5169ms → ~0ms）
  if (!gitAvailable()) return [];
  try {
    const out = execSync(`git log -n ${limit} --pretty=format:%H%x09%s`, {
      cwd: gitRoot,
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        return tab > 0 ? { hash: line.slice(0, tab).slice(0, 8), subject: line.slice(tab + 1) } : null;
      })
      .filter((x): x is { hash: string; subject: string } => x !== null);
  } catch {
    return []; // 非 git 仓库或无 git：静默跳过（git 不可用 ≠ 判据缺失，与"无 LLM"是两回事）
  }
}

// ──────── 源码注释 / 文档正文 → 带行号的线索 ────────

interface SignalLine {
  line: number;
  text: string;
}

/** 逐文件喂给 LLM 的线索（源码 = 注释块；文档 = 正文前若干非空行）。 */
interface FileSignal {
  /** 仓库相对路径（`/` 分隔）—— 也是"作用对象" */
  rel: string;
  kind: 'code' | 'doc';
  /** 带**真实行号**的线索行（出处 `文件:行` 就从这里来） */
  lines: SignalLine[];
  /** 证据原文（截断） */
  evidence: string;
}

/**
 * 源码文件 → 注释块线索。只取**块注释**（含 JSDoc 文件头）并保留每条注释的真实行号。
 * ★ 打不出注释块 ⇒ 无"出处"可言 ⇒ 该文件**产不出**（本工具就是把注释提取成决策）。
 */
function codeSignal(rel: string, abs: string): FileSignal | null {
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf-8');
  } catch {
    return null; // 文件读不到（可能刚被删）：本文件无据可取
  }
  const lines: SignalLine[] = [];
  const re = /\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const startLine = content.slice(0, m.index).split('\n').length;
    const blockLines = m[0].split('\n');
    for (let i = 0; i < blockLines.length; i++) {
      const text = blockLines[i]
        .replace(/^\s*\/\*+\s?/, '')
        .replace(/^\s*\*+\s?/, '')
        .replace(/\*\/\s*$/, '')
        .trim();
      if (text) lines.push({ line: startLine + i, text });
    }
  }
  if (lines.length === 0) return null; // 无注释 ⇒ 无出处 ⇒ 产不出
  const sliced = lines.slice(0, MAX_SIGNAL_LINES);
  return {
    rel,
    kind: 'code',
    lines: sliced,
    evidence: sliced.map((l) => l.text).join(' ').slice(0, EVIDENCE_MAX),
  };
}

/** 文档文件 → 正文线索（前若干非空行，带行号）。 */
function docSignal(rel: string, abs: string): FileSignal | null {
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
  const lines: SignalLine[] = [];
  for (const [i, raw] of content.split('\n').entries()) {
    const text = raw.trim();
    if (text) lines.push({ line: i + 1, text });
    if (lines.length >= MAX_SIGNAL_LINES) break;
  }
  if (lines.length === 0) return null;
  return {
    rel,
    kind: 'doc',
    lines,
    evidence: lines.map((l) => l.text).join(' ').slice(0, EVIDENCE_MAX),
  };
}

// ──────── LLM 批量问「为什么存在」 ────────

/** 单个文件/提交的 LLM 原始命中（已过产出契约：三要素齐备才存在） */
interface RawHit {
  key: string;
  why: string;
  refLine: number;
}

/** 从 LLM 文本里抠出 JSON 对象；抠不出 ⇒ **抛**（失败就是失败，不静默当空）。 */
function extractJsonObject(raw: string): Record<string, unknown> {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fence ? fence[1] : raw;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`harvest_decisions：LLM 未返回 JSON（原文前 200 字：${raw.slice(0, 200)}）`);
  }
  return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
}

function toPositiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function normConclusion(s: string): string {
  return s.replace(/[\s，。、；：！？,.;:!?"'“”‘’（）()【】[\]]/g, '').toLowerCase();
}

const FILE_SYSTEM_PROMPT =
  '你是项目结构解读助手。给定若干文件及其「可读线索」（**源码=注释块**，**文档=正文**，均带行号 L<行号>），' +
  '请为每个文件回答**唯一**一个问题：**这个文件为什么存在**（它要解决什么问题、为什么需要它）。\n' +
  '要求：\n' +
  '1. 只写「**为什么**」（理由），**不要**写「做什么」（职责）—— 例："因为跨语言桥接从未跑通，故整条线被删" 而非 "翻译 Go 到 TS"。\n' +
  '2. 一句话，不超过 40 个汉字。\n' +
  '3. ★ 必须能指到给定线索的**某一行**：给出 `ref_line`（该文件里支撑这句话的那一行号）。\n' +
  '4. ★★ 线索里**看不出**该文件为什么存在 ⇒ **把该文件整个略去**（不要编造，不要给"未知"/"无"）。\n' +
  '只输出 JSON：{"files":[{"path":"...","reason":"...","ref_line":123}]}，path 必须来自给定清单。';

async function askFileBatch(cfg: LlmCfg, batch: FileSignal[]): Promise<RawHit[]> {
  const known = new Set(batch.map((f) => f.rel));
  const listText = batch
    .map((f, i) => `文件 ${i + 1}（${f.kind === 'code' ? '源码注释' : '文档正文'}）: ${f.rel}\n${f.lines.map((l) => `  L${l.line}: ${l.text}`).join('\n')}`)
    .join('\n\n');
  const raw = await callChat(cfg, [
    { role: 'system', content: FILE_SYSTEM_PROMPT },
    { role: 'user', content: `请判断以下 ${batch.length} 个文件各自的「为什么存在」：\n\n${listText}` },
  ]);
  const obj = extractJsonObject(raw);
  const files = Array.isArray(obj.files) ? (obj.files as Array<Record<string, unknown>>) : [];
  const hits: RawHit[] = [];
  for (const f of files) {
    const p = typeof f.path === 'string' ? f.path.trim() : '';
    const why = typeof f.reason === 'string' ? f.reason.trim() : '';
    const refLine = toPositiveInt(f.ref_line);
    // ★ 产出契约在解析口就生效：三要素（已知作用对象 + 结论 + 出处行号）缺一 ⇒ 这条**产不出**（丢弃，不是"收下再筛"）
    if (known.has(p) && why && refLine !== null) hits.push({ key: p, why, refLine });
  }
  return hits;
}

const COMMIT_SYSTEM_PROMPT =
  '你是项目历史解读助手。给定若干 git 提交信息（含短 hash），请判断每条**是不是一条设计决策记录** —— ' +
  '即"**为什么**做这个改动 / 为什么这么设计"（是**理由**，不是纯粹的功能罗列、typo、格式化、版本号）。\n' +
  '要求：\n' +
  '1. 是决策 ⇒ 用一句话（不超过 40 个汉字）写出它的**理由/结论**。\n' +
  '2. ★ 不是决策 ⇒ **把该条整个略去**（不要编造）。\n' +
  '只输出 JSON：{"decisions":[{"hash":"...","reason":"..."}]}，hash 必须来自给定清单。';

async function askCommitBatch(cfg: LlmCfg, batch: Array<{ hash: string; subject: string }>): Promise<RawHit[]> {
  const known = new Set(batch.map((c) => c.hash));
  const listText = batch.map((c, i) => `${i + 1}. ${c.hash}  ${c.subject}`).join('\n');
  const raw = await callChat(cfg, [
    { role: 'system', content: COMMIT_SYSTEM_PROMPT },
    { role: 'user', content: `请判断以下 ${batch.length} 条提交信息：\n\n${listText}` },
  ]);
  const obj = extractJsonObject(raw);
  const arr = Array.isArray(obj.decisions) ? (obj.decisions as Array<Record<string, unknown>>) : [];
  const hits: RawHit[] = [];
  for (const d of arr) {
    const h = typeof d.hash === 'string' ? d.hash.trim() : '';
    const why = typeof d.reason === 'string' ? d.reason.trim() : '';
    if (known.has(h) && why) hits.push({ key: h, why, refLine: 0 }); // 提交无行号；key=hash
  }
  return hits;
}

/** 并发跑一批批次的 worker 池（形状照搬 role_title.ts；★ 但**不吞异常**：单批失败即整体失败）。 */
async function runBatches<T>(
  batches: T[][],
  ask: (batch: T[]) => Promise<RawHit[]>,
): Promise<RawHit[]> {
  const out: RawHit[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= batches.length) return;
      const hits = await ask(batches[idx]);
      out.push(...hits);
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()),
  );
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failed) throw failed.reason; // ★ 不许静默降级：任一批次失败 ⇒ 整体失败
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 按 key 聚合 R 轮命中的票数：key → 归一化结论 → { why, refLine, votes } */
type VoteTable = Map<string, Map<string, { why: string; refLine: number; votes: number }>>;

function accumulate(table: VoteTable, hits: RawHit[]): void {
  for (const h of hits) {
    let byWhy = table.get(h.key);
    if (!byWhy) {
      byWhy = new Map();
      table.set(h.key, byWhy);
    }
    const norm = normConclusion(h.why);
    const cur = byWhy.get(norm);
    if (cur) cur.votes++;
    else byWhy.set(norm, { why: h.why, refLine: h.refLine, votes: 1 });
  }
}

function pickTop(byWhy: Map<string, { why: string; refLine: number; votes: number }>): { why: string; refLine: number; votes: number } {
  let top: { why: string; refLine: number; votes: number } | null = null;
  for (const v of byWhy.values()) if (!top || v.votes > top.votes) top = v;
  return top as { why: string; refLine: number; votes: number };
}

/**
 * 逐文件产出决策（comment / doc 共用）—— **R 轮抽奖**。
 * 返回的每条都已过 {@link buildLead} 的产出契约（三要素齐备）。
 */
async function extractFileLeads(cfg: LlmCfg, signals: FileSignal[], source: 'comment' | 'doc'): Promise<HarvestCandidate[]> {
  if (signals.length === 0) return [];
  const batches = chunk(signals, BATCH_SIZE);
  const table: VoteTable = new Map();
  for (let round = 0; round < R; round++) {
    accumulate(table, await runBatches(batches, (b) => askFileBatch(cfg, b)));
  }
  const leads: HarvestCandidate[] = [];
  for (const sig of signals) {
    const byWhy = table.get(sig.rel);
    if (!byWhy) continue; // 该文件 R 轮都没被抽中 ⇒ 产不出
    const top = pickTop(byWhy);
    const lead = buildLead(
      { why: top.why, origin: `${sig.rel}:${top.refLine}`, subject: sig.rel },
      {
        source,
        votes: top.votes,
        samples: R,
        evidence: sig.evidence,
        lifecycle_hint: lifecycleHint(sig.lines.map((l) => l.text).join(' ')),
      },
    );
    if (lead) leads.push(lead);
  }
  return leads;
}

/** gitlog：逐条提交判「是不是决策记录」—— 同样 R 轮抽奖。 */
async function extractCommitLeads(
  cfg: LlmCfg,
  feature: string,
  commits: Array<{ hash: string; subject: string }>,
): Promise<HarvestCandidate[]> {
  if (commits.length === 0) return [];
  const batches = chunk(commits, BATCH_SIZE);
  const table: VoteTable = new Map();
  for (let round = 0; round < R; round++) {
    accumulate(table, await runBatches(batches, (b) => askCommitBatch(cfg, b)));
  }
  const byHash = new Map(commits.map((c) => [c.hash, c.subject]));
  const leads: HarvestCandidate[] = [];
  for (const [hash, byWhy] of table) {
    const top = pickTop(byWhy);
    const subject = byHash.get(hash) ?? '';
    const lead = buildLead(
      { why: top.why, origin: `git:${hash}`, subject: feature },
      { source: 'gitlog', votes: top.votes, samples: R, evidence: subject, lifecycle_hint: lifecycleHint(subject) },
    );
    if (lead) leads.push(lead);
  }
  return leads;
}

// ──────── 收集目标文件 ────────

function collectMdFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function relOf(root: string, abs: string): string {
  return (path.relative(root, abs) || abs).split(path.sep).join('/');
}

/** 项目已索引的源码文件（读 cache.db 的 `files` 表；口径 = "该 feature 已索引的源码文件"）。 */
function indexedSourceFiles(db: Database, root: string): FileSignal[] {
  const rows = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const signals: FileSignal[] = [];
  for (const r of rows) {
    if (!SOURCE_EXT_RE.test(r.path)) continue;
    const sig = codeSignal(r.path, path.join(root, r.path));
    if (sig) signals.push(sig);
  }
  signals.sort((a, b) => a.rel.localeCompare(b.rel));
  return signals;
}

/** 显式指定的源码文件（绝对/相对皆可） */
function explicitCommentFiles(files: string[], root: string): FileSignal[] {
  const signals: FileSignal[] = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(root, f);
    if (!SOURCE_EXT_RE.test(abs)) continue;
    const sig = codeSignal(relOf(root, abs), abs);
    if (sig) signals.push(sig);
  }
  return signals;
}

function docSignals(docDir: string, root: string): FileSignal[] {
  const signals: FileSignal[] = [];
  for (const md of collectMdFiles(docDir)) {
    const sig = docSignal(relOf(root, md), md);
    if (sig) signals.push(sig);
  }
  signals.sort((a, b) => a.rel.localeCompare(b.rel));
  return signals;
}

// ──────── 主入口 ────────

async function harvestDecisionsCore(input: HarvestInput): Promise<HarvestResult> {
  const { feature } = input;
  const cfg = requireLlmConfig(); // ★ 没有 LLM ⇒ 当场抛（早于任何扫描）
  const limit = input.limit ?? 30;
  // ★ 注释扫描锚定 **进程当前目录**（= 被分析的项目；与 `doc_dir` 默认根 `<cwd>/docs` 同一口径）。
  //   不锚 `git_root` —— 那是"git 仓库根"，只管 git log；两者含义不同，不该混用一个根。
  const projectRoot = path.resolve(process.cwd());
  const gitRoot = path.resolve(input.git_root ?? process.cwd());
  const docDir = input.doc_dir ?? path.join(process.cwd(), 'docs');

  // git 日志：提交 subject 即"为什么改"的一手线索 —— 仍走**同一条 LLM 判定**（不是关键词）
  const commits = gitLogEntries(gitRoot, limit);
  const commitLeads = await extractCommitLeads(cfg, feature, commits);

  // 注释：默认扫**项目已索引的源码文件**（不必调用方列文件）；显式传 comment_files 时只扫这些
  let commentSignals: FileSignal[];
  let scannedComment: number;
  if (input.comment_files?.length) {
    commentSignals = explicitCommentFiles(input.comment_files, projectRoot);
    scannedComment = input.comment_files.length;
  } else {
    const { db } = await ensureProjectIndex(projectRoot);
    commentSignals = indexedSourceFiles(db, projectRoot);
    scannedComment = commentSignals.length;
  }
  const commentLeads = await extractFileLeads(cfg, commentSignals, 'comment');

  // 文档：逐个 md 文件问同一个问题
  const docs = docSignals(docDir, projectRoot);
  const docLeads = await extractFileLeads(cfg, docs, 'doc');

  const candidates = [...commentLeads, ...docLeads, ...commitLeads];
  const nOf = (s: HarvestSource) => candidates.filter((c) => c.source === s).length;

  const lines = [
    `harvest_decisions [${feature}] 产出 ${candidates.length} 条决策（三要素齐备：结论 / 出处 / 作用对象）`,
    `  来源: comment ${nOf('comment')} · doc ${nOf('doc')} · gitlog ${nOf('gitlog')} · 抽奖 R=${R}（置信 = votes/${R}）`,
    `  扫描: 源码 ${scannedComment} 个（有注释块）/ 提交 ${commits.length} 条 / 文档 ${docs.length} 个`,
    '',
    ...candidates.map((c, i) => {
      const lh = c.lifecycle_hint ? `  ⚠ lifecycle:${c.lifecycle_hint.type}` : '';
      return (
        `  ${i + 1}. [${c.source}] ${c.decision.summary}  置信 ${c.votes}/${c.samples}${lh}\n` +
        `      ↳ 作用对象: ${c.file_path}\n` +
        `      ↳ 出处: ${c.ref}\n` +
        `      ↳ 证据: ${c.evidence}`
      );
    }),
    '',
    '用法: 逐条核对出处/原文；把决策写回文件节点 `decision` 是**下一步**（D1，当前不存在），本工具不写 DSL。',
  ];
  return { message: lines.join('\n'), feature, candidates };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 口径（`Touched` 两类字段，见 domain/b_terms.ts:42-89）：
 *   - 作用域类（`project_dir` / `feature`）：随时可给，不依赖成败；
 *   - 对象类（`written_files` / `symbols` / `nodes`）：只有**真发生**才给，否则整项省略。
 */
function touchedOf(input: HarvestInput): Touched {
  const touched: Touched = {};

  // feature：作用域类，随时可给（入参必填）。★ 产物顶层**也有** `feature`，属"同一事实两个名字"。
  touched.feature = input.feature;

  // ★ 不给 project_dir：入参里**没有** project_dir（只有 `doc_dir` 与 `git_root`）。二者都不是
  //   "被分析项目的根"，且缺省回落 `process.cwd()`（那是"进程当前目录"，不是本次调用**确立的对象**）。
  //   按"不猜"口径 ⇒ **整项省略**。

  // ★ 不给 written_files：本 [B] 只产出 draft 决策、**不写任何文件/DSL**（写回是下一步 D1）。
  // ★ 不给 symbols / nodes：决策线索里没有符号 / DSL 节点标识可取。

  return touched;
}

export async function harvestDecisions(input: HarvestInput): Promise<TouchedProduct<HarvestResult>> {
  const r = await harvestDecisionsCore(input);
  return withTouched(r, touchedOf(input));
}
