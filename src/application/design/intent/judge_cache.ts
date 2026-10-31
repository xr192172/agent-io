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
 * · 判据内容变了（must/mustNot/signature/…）⇒ key 变 ⇒ miss；
 * · **判定内核变了**（剥注释 / 符号解析 / kind 注册表改了一个字节）⇒ 内核指纹变 ⇒ key 变 ⇒ miss
 *   （{@link judgeKernelFingerprint}；★ 不许靠人记得 bump `CACHE_VERSION` —— 那种纪律必然被忘）。
 *
 * ## 性能（不许把缓存废掉）
 * **同一版判定内核**下：内容没变 ⇒ 磁盘哈希不变 ⇒ key 不变 ⇒ 历史缓存条目**继续命中**；
 * 内核源码变了一字节 ⇒ 指纹变 ⇒ 那一批**一次性**重算（这正是本机制的目的，不是回归）；
 * `judgeExpectations` 回执里的 `cache:{hits,misses}` 就是这条纪律的读数。
 *
 * ## 落点
 * `<root>/.agent-io/judge-cache.json` —— **运行时缓存（可重建）**：损坏 ⇒ 当空缓存用并**留痕**
 * （不许静默吞）；不进 git、不改 .gitignore。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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

/**
 * ★★★ 2026-10-31（**假绿的第二个入口**：key 里没有判定内核版本）。
 *
 * 病史：`CACHE_VERSION = 1` 且 key = 判据内容 ‖ diskHash ⇒ **改判定逻辑**（剥注释、符号解析、
 * 签名归一）之后，**目标文件内容没变**的那些判据仍命中旧 `pass` —— 判定内核换了、结论是旧的，
 * 而读端完全看不出来（今天已因此出过一次假绿）。
 *
 * ⇒ 把**判定内核源码的内容哈希**并入 key（自动，不靠人记得 bump）：
 * · 内核 = 本文件（key 的构造者）+ `expectations.ts`（判定执行核）+ `domain/expectation.ts` /
 *   `expectation_kinds.ts`（kind 注册表与 phase 分类 —— 它们改一个字节，判定语义就可能变）；
 * · **内容不变 ⇒ 指纹不变 ⇒ key 不变**（缓存不被废；同版本内核的历史条目继续命中）；
 * · 读不到内核源码 ⇒ **抛**（不回落空串/默认值：那会让「读不到」与「没变」长得一样，见 AGENTS 0.12）。
 *
 * ★ 与 `CACHE_VERSION` 的分工：那个是**手写形态版本**（缓存条目**形状**变了才 bump）；
 *   判定**逻辑**变了不用动它 —— 内核指纹自动跟上。
 */
const KERNEL_MODULES = [
  './expectations',
  './judge_cache',
  '../../../domain/expectation',
  '../../../domain/expectation_kinds',
] as const;

/** 同进程内只算一次（源码不会在进程生命周期里变）—— `null` = 还没算过 */
let kernelFingerprintCache: string | null = null;

/**
 * **判定内核指纹**（16 位 hex）。它是缓存 key 的第三个分量：内核变了 ⇒ 所有 key 变 ⇒ 全量重算。
 * ★ 两种后缀都认：`src/` 下是 `.ts`（tsx 直跑），`dist/` 下是 `.js`。
 */
export function judgeKernelFingerprint(): string {
  if (kernelFingerprintCache !== null) return kernelFingerprintCache;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const h = createHash('sha256');
  for (const mod of KERNEL_MODULES) {
    const stem = path.join(dir, mod);
    const hit = [`${stem}.ts`, `${stem}.js`].find((p) => fs.existsSync(p));
    if (!hit) {
      throw new Error(
        `判定内核指纹取不到：${mod}（找过 ${stem}.ts / ${stem}.js）⇒ 缓存不可信，拒绝静默降级`,
      );
    }
    h.update(mod).update('\u0000').update(fs.readFileSync(hit, 'utf-8')).update('\u0000');
  }
  kernelFingerprintCache = h.digest('hex').slice(0, 16);
  return kernelFingerprintCache;
}

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
      kernel?: string;
      entries?: Record<string, { verdict?: string; detail?: string }>;
    };
    if (raw.version !== CACHE_VERSION || !raw.entries || typeof raw.entries !== 'object') {
      process.stderr.write(
        `⚠ judge-cache.json 形状不认识（version=${JSON.stringify(raw.version ?? null)}，期望 ${CACHE_VERSION}）` +
          `⇒ 当空缓存用，本轮全现算（留痕，不静默）\n`,
      );
      return new Map();
    }
    // ★★★ 2026-10-31：**内核指纹比对** —— 内核变了 ⇒ 旧条目全部作废。
    //   key 里已经含指纹（`judgeCacheKey`）⇒ 旧条目本来就永不命中；这里再兜一层是为了
    //   ① 不把永不命中的条目一直留在文件里（否则文件只增不减）；② 让「为什么这轮全量重算」有留痕。
    const kernel = judgeKernelFingerprint();
    if (raw.kernel !== kernel) {
      process.stderr.write(
        `⚠ judge-cache.json 的判定内核指纹不符（文件 ${JSON.stringify(raw.kernel ?? null)}，当前 ${kernel}）` +
          `⇒ 当空缓存用，本轮全量重算（留痕，不静默）\n`,
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
  // ★ 落盘时写下**当前**内核指纹：读端据此判「这份缓存是不是同一版判定内核写的」。
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      { version: CACHE_VERSION, kernel: judgeKernelFingerprint(), saved_at: new Date().toISOString(), entries },
      null,
      2,
    ),
    'utf-8',
  );
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
export function judgeCacheKey(e: Expectation, diskHash: string, kernelFp?: string): string {
  // ★★★ 2026-10-31：**判定内核指纹进 key** —— 内核变了 ⇒ key 变 ⇒ 旧 pass 不可能再命中。
  const kernel = kernelFp ?? judgeKernelFingerprint();
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
      }) + '|' + diskHash + '|' + kernel,
    )
    .digest('hex');
}
