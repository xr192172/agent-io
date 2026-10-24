/**
 * judge_cache.ts —— 判据求值的**一阶文件哈希缓存**（2026-10-24，v3 §4.9 第一阶）。
 *
 * ## 目标（用户原话）
 * 「**没变的文件不再测**」—— `judgeExpectations` 每次全量现算 670+ 条，其中贵的判定
 * （symbol-exists / signature-matches / source-has）每次都重新读取并解析目标文件。
 *
 * ## 判据（三档设计的第一阶）
 * key = hash(自身判据内容 ‖ 传递依赖 content_hash)。本阶只做**一阶**：
 *   上述三类判定只依赖**目标文件本体** ⇒ 一阶即覆盖全部贵判定；新鲜度判据 = `files.content_hash`
 *   （索引那一刻的内容指纹）：文件变了 ⇒ 哈希变 ⇒ key 变 ⇒ 自然 miss。
 *   ★ 跨文件判定（edge-* 依赖边表）**不缓存**：边表新鲜度由 `ensureProjectIndex` 保证，且判定便宜。
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
 * 缓存 key = sha256(判据内容 ‖ 目标文件 content_hash)。
 * ★ 判据内容按字段白名单序列化（kind/path/symbol/signature/must/pattern）—— 不 stringify 整个
 *   expectation：`why` 是给人读的，改措辞不该把缓存打翻。
 */
export function judgeCacheKey(e: Expectation, fileHash: string): string {
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
      }) + '|' + fileHash,
    )
    .digest('hex');
}
