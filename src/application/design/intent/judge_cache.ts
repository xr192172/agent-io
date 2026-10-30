/**
 * judge_cache.ts —— 判据求值的**一阶文件哈希缓存**（2026-10-24，v3 §4.9 第一阶）。
 *
 * ## 目标（用户原话）
 * 「**没变的文件不再测**」—— `judgeExpectations` 每次全量现算 670+ 条，其中贵的判定
 * （symbol-exists / signature-matches / source-has）每次都重新读取并解析目标文件。
 *
 * ## 判据（三档设计的第一阶）
 * key = hash(自身判据内容 ‖ **判定时现算的磁盘内容哈希**)。本阶只做**一阶**：
 *   上述三类判定只依赖**目标文件本体** ⇒ 一阶即覆盖全部贵判定。
 *   ★ 跨文件判定（edge-* / call-exists / domain-independent 依赖边表）**不缓存**（见下）。
 *
 * ## ★★★ 2026-10-31（**假绿事故的修法**：新鲜度不许依赖索引）
 * 原实现的新鲜度判据是 `cache.db` 的 `files.content_hash`（「索引那一刻的内容指纹」），
 * 并附带一句**错的推理**：「文件变了 ⇒ 哈希变 ⇒ key 变」。那推理只在**索引跟着变**时成立，
 * 而索引**可以落后于磁盘**：
 *
 * · 实测链条（当天当场撞到）：`docs/GUIDE-GATE.md` 的 `**码数合计 70**` 已改成 71，节点上
 *   `source-has must:["**码数合计 70**"]` **本该红**，而 `design_line action=judge` 报
 *   **pass（缓存命中）** ⇒ **失效的判据被缓存洗成了绿的**（判定体系的地基漏洞）。
 * · 为什么索引没被保鲜救回来：`ensureFreshIndex` 走的是 `walkFiles`，而 `.md` 属
 *   **doc 类**（`source_exts.ts` 的 L1 尺里不是 code）⇒ **docs/ 下的文件永远不在走查集合里**
 *   ⇒ 它们的 `files.content_hash` **永久停在 import 那一刻**（实测：docs 3 个 md 的
 *   `idx_h` 全部 ≠ `disk_h`）⇒ 无论判多少轮，key 都不变。
 * · 更一般的病：**任何**「索引落后于磁盘」的时刻（外部改文件 / 别的 agent 在写 / git checkout /
 *   索引被 max_files 截断）都会让这一类判据给出**旧结论**，而它们读的本来就是**磁盘上的文本**。
 *
 * ⇒ **修法（本文件的唯一新鲜度来源）**：`fileHash` 一律由调用方用 {@link diskFileHash}
 *   **判定时现读磁盘现算**（`sha1(readFileSync(path))`，**复用** `index/symbols.ts#contentHash`
 *   那一份，不另写一套哈希）。`cache.db` 从此**只用于符号解析**（symbol-exists / call-exists 的
 *   AST 事实），**不再参与"缓存是否新鲜"的判断** —— 两件事分开，索引旧了最多让"符号事实"退化成
 *   `unsupported`（诚实），不会把"文本判据"变成假的 pass。
 *
 * ## 各 kind 的缓存策略（**只有这三类进缓存，其余一律不缓存**）
 * | kind | 缓存 | key 的依赖 | 为什么 |
 * |---|---|---|---|
 * | `source-has` | ✅ | 判据字段 ‖ **磁盘**内容哈希 | 只读目标文件文本；判据只依赖文件本体 |
 * | `symbol-exists` / `signature-matches` | ✅ | 同上 | 判定核是**现读现解析**（`judgeSymbolOrSignature`），与索引无关 |
 * | `file-exists` | ❌ | — | `existsSync` 本来就便宜，缓存只会多一层失效面 |
 * | `run` / `behavior-cases` / `cert` / `runtime` | ❌ | — | 必须现跑（跑进程 / 读事件），结论不是文件内容的函数 |
 * | `edge-exists` / `edge-absent` / `call-exists` / `domain-independent` | ❌ | — | ★ 事实源是**边表**（`cache.db` 的 `edges`），而边表的"新鲜"是**整个索引**的函数，不是某一个文件的哈希能表达的 —— 拿单文件哈希当 key 正是本次假绿的同一种错。它们各自已有 `indexStaleFor` / `depFactsIncomplete` ⇒ 陈旧时判 **`unsupported`**（诚实），不假装 pass |
 *
 * ## 失效（什么时候必须 miss）
 * · 文件内容变了 ⇒ 磁盘哈希变 ⇒ key 变 ⇒ miss（**不再看索引脸色**）；
 * · 文件**不存在 / 读不出来** ⇒ `diskFileHash` 返回 `null` ⇒ 该条**不进缓存**、直接按四态现判
 *   （不许拿"没有哈希"冒充"没变"）；
 * · 判据内容变了（must/mustNot/signature/…）⇒ key 变 ⇒ miss。
 *
 * ## 性能（不许把缓存废掉）
 * 内容没变时，磁盘哈希 == 索引哈希 ⇒ key 与旧实现**逐字相同** ⇒ 历史缓存条目**继续命中**；
 * `judgeExpectations` 回执里的 `cache:{hits,misses}` 就是这条纪律的读数。
 *
 * ## 落点
 * `<root>/.agent-io/judge-cache.json` —— **运行时缓存（可重建）**：损坏 ⇒ 当空缓存用并**留痕**
 * （不许静默吞）；不进 git、不改 .gitignore。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Expectation } from '../../../domain/expectation.js';
import type { Verdict } from '../../../domain/judge_port.js';
// ★ 2026-10-31：内容哈希**只借这一份**（`index/symbols.ts#contentHash`，sha1-of-utf8）——
//   与 `files.content_hash` 同源 ⇒ 既能当缓存 key 的新鲜度来源，也能直接与索引行比对（判"索引是否落后"）。
//   ★ 不在这里另写一套哈希：那会让"磁盘哈希"与"索引哈希"变成两把尺，比不出东西。
import { contentHash } from '../../../infrastructure/index/symbols.js';

/** 一条缓存判定（与 `ExpectationItem` 的 verdict/detail 同形，但不带 node 归属 —— key 已含判据内容） */
export interface JudgeCacheEntry {
  verdict: Verdict;
  detail: string;
}

/** 判定缓存：key（`judgeCacheKey`）→ 判定 */
export type JudgeCache = Map<string, JudgeCacheEntry>;

const CACHE_VERSION = 1;
const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'unsupported', 'pending'];

function cacheFile(root: string): string {
  return path.join(root, '.agent-io', 'judge-cache.json');
}

/**
 * 读缓存：不存在给空 Map；**损坏给空 Map 并留痕**（stderr 警告）—— 求值不许因缓存崩，
 * 但"读不出来"这件事必须让人看见（本仓禁令：不许静默吞）。
 */
export function loadJudgeCache(root: string): JudgeCache {
  const file = cacheFile(root);
  if (!fs.existsSync(file)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      version?: number;
      entries?: Record<string, { verdict?: string; detail?: string }>;
    };
    if (raw.version !== CACHE_VERSION || !raw.entries || typeof raw.entries !== 'object') {
      process.stderr.write(
        `⚠ judge-cache.json 形状不认识（version=${JSON.stringify(raw.version ?? null)}，期望 ${CACHE_VERSION}）` +
          `⇒ 当空缓存用，本轮全现算（留痕，不静默）\n`,
      );
      return new Map();
    }
    const out: JudgeCache = new Map();
    for (const [k, v] of Object.entries(raw.entries)) {
      if (
        v &&
        typeof v.verdict === 'string' &&
        (VERDICTS as readonly string[]).includes(v.verdict) &&
        typeof v.detail === 'string'
      ) {
        out.set(k, { verdict: v.verdict as Verdict, detail: v.detail });
      }
    }
    return out;
  } catch (e) {
    process.stderr.write(
      `⚠ judge-cache.json 损坏（${(e as Error).message}）⇒ 当空缓存用，本轮全现算（留痕，不静默）\n`,
    );
    return new Map();
  }
}

/**
 * 写缓存：**原子写**（临时文件 + rename，与 `infrastructure/storage.ts#saveDSL` 的 writeAtomic 同一招
 * —— 防并发读撞上写入读到半截）。调用方（judgeExpectations）已 try/catch：落盘失败警告不致命。
 */
export function saveJudgeCache(root: string, cache: JudgeCache): void {
  const file = cacheFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries: Record<string, JudgeCacheEntry> = {};
  for (const [k, v] of cache) entries[k] = { verdict: v.verdict, detail: v.detail };
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, saved_at: new Date().toISOString(), entries }, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * ★★★ **判定缓存的新鲜度来源**（2026-10-31，假绿事故的修法；判据见文件头「新鲜度不许依赖索引」）。
 *
 * 「此刻磁盘上这个文件的内容哈希」—— **现读现算**，不看 `cache.db`。
 * · 文件不存在 / 读失败 ⇒ 返回 `null`（调用方据此**不缓存**、直接按四态现判）；
 *   ★ 返回 `null` **不是**返回空串/假哈希：那会让"读不到"与"没变"长得一样。
 * · 复用 `index/symbols.ts#contentHash`：与 `files.content_hash` **同一把尺** ⇒
 *   ① 内容没变时与旧实现的 key **逐字相同** ⇒ 历史缓存继续命中（缓存没废）；
 *   ② 能直接与索引行比对，据此判"索引落后于磁盘"（`expectations.ts` 的兜底告警）。
 */
export function diskFileHash(abs: string): string | null {
  try {
    if (!fs.existsSync(abs)) return null;
    return contentHash(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 缓存 key = sha256(判据内容 ‖ **磁盘**内容哈希)。
 * ★ 判据内容按字段白名单序列化（kind/path/symbol/signature/must/pattern）—— 不 stringify 整个
 *   expectation：`why` 是给人读的，改措辞不该把缓存打翻。
 * ★ `diskHash` 必须来自 {@link diskFileHash}（现读磁盘）：传索引里的 `content_hash` 会退回
 *   "索引落后 ⇒ 假绿"的老病（2026-10-31 实测：docs/GUIDE-GATE.md 的 `**码数合计 70**` 该红却绿）。
 */
export function judgeCacheKey(e: Expectation, diskHash: string): string {
  // ★ 2026-10-24 修订：mustNot 必须入 key——source-has 的 mustNot 是断言的一部分，只改 mustNot 不动文件时缓存会给过期 verdict（子代理上报、主控裁收）
  const o = e as { kind: string; path?: string; symbol?: string; signature?: string; must?: string[]; mustNot?: string[]; pattern?: string };
  return createHash('sha256')
    .update(
      JSON.stringify({
        kind: o.kind,
        path: o.path ?? null,
        symbol: o.symbol ?? null,
        signature: o.signature ?? null,
        must: o.must ?? null,
        mustNot: o.mustNot ?? null,
        pattern: o.pattern ?? null,
      }) + '|' + diskHash,
    )
    .digest('hex');
}
