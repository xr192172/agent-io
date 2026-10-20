/**
 * remove_dead_imports —— 移除死 import 执行器（积木瘦身的"剪刀"辅助）
 *
 * 与 dead_deps 配套：dead_deps 负责"只报告偏差、绝不自动改写"（Observe 宪法），
 * 产出 DeadDepCandidate[]（source + 导入它的文件）；本模块负责"人拍板后
 * 执行改写"，把闭包内指向死三方源（third_party 且被判定死候选）的
 * import/require/re-export 语句从文件里删掉。
 *
 * 分层：
 *   1. 纯函数 removeImportsFromSource(src, target, lang)：单文件、单源，返回新源码。
 *      → 便于单测覆盖 Go/TS 各 import 形态，且默认保守（识别不出 → 不动 = 安全）。
 *   2. 执行器 removeDeadImports：聚合 dead 清单 → 按文件分组 → 求删除区间（TS/JS 一次性切；
 *      Go 逐源串联）→ 原子落盘（预读全部源文件，任一失败即中止、一个都不写）。
 *
 * ★★ 2026-10-20：TS/JS 的删除位置改由 **cache.db 的 imports 整句 span**
 *   （`start_index/end_index`，UTF-16 码元）直接切，不再用 9 条正则去"猜"形态。
 *   - 准入**按文件**判（`n > 0 && COUNT(start_index) === n`）：库里观测到的污染是
 *     「每个文件要么全有 span、要么全无」（实测 475 个文件 mixed=0）。
 *   - 另外三道保险，任一不满足就**整文件退回正则**（正则兜底原样保留）：
 *       ① `files.content_hash` 必须与待删源码一致（库陈旧 ⇒ 偏移不可信）；
 *       ② 每个目标 source 在库里都必须有 ≥1 条 span（CJS require 根本不是 import 语句，
 *          解析器不记 ⇒ 缺一条就说明库看不见全部，退回正则才不会漏删）；
 *       ③ 切出来的文本必须真的含这条 source 的说明符（偏移若与源码不同源，宁可不动）。
 *   - Go 仍走正则：`import (...)` 块的 span 是**整块**（kernel 已注明），按 span 删单条会误删同块。
 *   - `end_index` **不含结尾换行** ⇒ 删整句时自己吃掉一个 `\r?\n`（否则留空行/残留 `\r`）。
 *
 * 保守规则（宁漏删不误删）：
 *   - 只删"整条 import/require/re-export 语句"，语句内的符号选择性删除不做
 *     （如 import { a } from 'x' 里 a 死、b 活 → 本工具整条留着，交给更细的剪枝）。
 *   - 语法形态识别失败 / 不认识的形态 → 该语句不动。
 *   - Go 块导入删成员后若块变空（无其余成员/注释）才删 `import (`...`)` 壳，
 *     否则保留壳（含注释）。
 *   - 动态 import('x') / 函数内 require 调用等"使用点"一律不碰。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DeadDepCandidate } from '../../../infrastructure/graph/dead_deps.js';
import { applyWithVerify, defaultVerifyCommands, runVerification, type VerifyCommand, type VerificationOutcome, type VerifyOutcomeKind } from '../../../infrastructure/verify_refactor.js';
import { snapshotAndRecordSelfWrite, syncSelfWritesSync, type WriteThroughOutcome } from '../../write_gate.js';
import { findCacheDb } from '../../../infrastructure/index/db.js';
import { contentHash, toIndexKey } from '../../../infrastructure/index/symbols.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

// ─────────────────────────────────────────────
// 纯函数：单文件删除指向 target 的 import 语句
// ─────────────────────────────────────────────
/**
 * ★ 回执（2026-10-20）：这是一把会**删代码**的剪刀 —— 每删一条都必须能说出
 * 「哪一行、哪个源、原句长什么样」，否则等于悄悄删东西。
 */
export interface RemovedStatement {
  line: number;
  source: string;
  /** 被删的原句（不含结尾换行；跨行语句保留内部换行） */
  text: string;
  /** 依据：span = cache.db 的整句偏移；regex = 正则兜底 */
  via: 'span' | 'regex';
}

export interface RemoveImportsResult {
  /** 删除的 import 语句/成员条数 */
  removed: number;
  /** 源码是否发生变化 */
  changed: boolean;
  /** 删除后的新源码（未变时与入参相同） */
  output: string;
  /** 被删语句回执（按出现位置升序） */
  removed_statements: RemovedStatement[];
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 删除区间：`[start, end)`，end 不含结尾换行 */
interface Cut {
  start: number;
  end: number;
  source: string;
  via: 'span' | 'regex';
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * 按区间切源码 —— **唯一的删除落点**（正则路径与 span 路径共用，免得两套"吃换行"规则）。
 *
 * ★ 只合并**真重叠**（同一句被多条正则命中），不合并"相邻"：
 *   相邻两句之间只隔一个 `\n`，各自吃掉自己的换行，字节结果与"合并后整段删"完全一致，
 *   但回执能一条一条数（旧的 `s <= last[1] + 1` 合并会把两条并成一条，回执就少一条）。
 * ★ `end_index` **不含结尾换行** ⇒ 这里自己吃掉一个 `\r?\n`。
 */
function applyCuts(src: string, cuts: Cut[]): RemoveImportsResult {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const merged: Cut[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start < last.end) {
      if (c.end > last.end) last.end = c.end;
    } else {
      merged.push({ ...c });
    }
  }

  let out = '';
  let last = 0;
  const statements: RemovedStatement[] = [];
  for (const c of merged) {
    out += src.slice(last, c.start);
    statements.push({ line: lineAt(src, c.start), source: c.source, text: src.slice(c.start, c.end), via: c.via });
    last = c.end;
    if (src.startsWith('\r\n', last)) last += 2;
    else if (src[last] === '\n') last += 1;
  }
  out += src.slice(last);
  return { removed: merged.length, changed: out !== src, output: out, removed_statements: statements };
}

/** Go import 形态：
 *   单声明 import "p" / import alias "p"（整行删）；
 *   块 import ( ... \t"p" \talias "p" ... )（删成员行；空块删壳）。 */
function removeGoImports(src: string, target: string): RemoveImportsResult {
  const body = src.replace(/\r\n/g, '\n');
  const lines = body.split('\n');
  const esc = escRe(target);
  // 单声明或块成员行：头部可带 import 前缀 / alias（含 `.` 点导入、`_` 空导入）；
  // 路径字符串后允许行尾注释
  const re = new RegExp(`^[\\t ]*(?:import\\s+)?(?:(?:\\w+|\\.)\\s+)?["']${esc}["']\\s*(?://.*)?$`);

  const stack: number[] = [];
  const blockStart = new Array<number>(lines.length).fill(-1);
  const remove = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (stack.length) blockStart[i] = stack[stack.length - 1];
    const t = lines[i].trim().replace(/\/\/.*$/, '');
    if (/^import\s*\(/.test(t)) {
      stack.push(i);
      continue;
    }
    if (/^\)/.test(t)) {
      stack.pop();
      continue;
    }
    // 注释行 / 空行跳过（块内注释需保留壳，稍后判定）
    if (!t || /^\*/.test(t)) continue;
    if (re.test(lines[i])) remove.add(i);
  }

  // 块壳折叠：删除运作了的块，若余下无非注释非空成员 → 连 `import (`、`)` 一起删
  if (remove.size) {
    const byBlock = new Map<number, number[]>();
    for (const i of remove) {
      const b = blockStart[i];
      if (b < 0) continue;
      if (!byBlock.has(b)) byBlock.set(b, []);
      byBlock.get(b)!.push(i);
    }
    for (const [b] of byBlock) {
      let depth = 0;
      let close = -1;
      for (let i = b; i < lines.length; i++) {
        const t = lines[i].trim().replace(/\/\/.*$/, '');
        if (/^import\s*\(/.test(t)) depth++;
        else if (/^\)/.test(t)) {
          depth--;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close < 0) continue;
      let empty = true;
      for (let i = b + 1; i < close; i++) {
        if (remove.has(i)) continue;
        const t = lines[i].trim().replace(/\/\/.*$/, '');
        if (t && !/^\*/.test(t)) {
          empty = false;
          break;
        }
      }
      if (empty) {
        remove.add(b);
        remove.add(close);
      }
    }
  }

  const out = lines.filter((_, i) => !remove.has(i));
  const changed = out.length !== lines.length;
  // 回执按行给（含被折叠掉的 `import (` / `)` 壳 —— 它们也是真的被删掉的文本）
  const removed_statements: RemovedStatement[] = [...remove]
    .sort((a, b) => a - b)
    .map((i) => ({ line: i + 1, source: target, text: lines[i], via: 'regex' as const }));
  return { removed: remove.size, changed, output: out.join('\n'), removed_statements };
}

/** TS/JS import 形态（语句级，s 标志支持跨行）：
 *   具名/混合/命名空间/默认 import、type import、副作用 import、
 *   re-export（export * / export {...} from）、CommonJS require。
 *   ★ 只给**区间**（对入参 src 直接求，不落盘也不拼接）——应用交 {@link applyCuts}，
 *     好让"删哪几句 / 吃哪个换行"只有一份实现。 */
function tsImportRanges(src: string, target: string): Array<[number, number]> {
  const esc = escRe(target);
  const T = `["']${esc}["']`;
  const forms: RegExp[] = [
    // import def, { a, b } / import { a } / import * as ns  from 'T'
    new RegExp(`import\\s+(?:(?:type\\s+)?[\\w$]+(?:\\s*,\\s*)?)?(?:\\{[^}]*\\}|\\*\\s+as\\s+[\\w$]+)(?:\\s*,\\s*\\{[^}]*\\})?\\s*from\\s*${T}\\s*;?`, 'gs'),
    // import type { T } from 'x'
    new RegExp(`import\\s+type\\s*\\{[^}]*\\}\\s*from\\s*${T}\\s*;?`, 'gs'),
    // import type X from 'x'
    new RegExp(`import\\s+type\\s+[\\w$]+\\s+from\\s*${T}\\s*;?`, 'gs'),
    // import X from 'x'（纯默认）
    new RegExp(`import\\s+[\\w$]+\\s+from\\s*${T}\\s*;?`, 'gs'),
    // import 'x' / import type 'x'（副作用）
    new RegExp(`import(?:\\s+type)?\\s+${T}\\s*;?`, 'gs'),
    // export * from 'x'
    new RegExp(`export\\s+\\*\\s+from\\s*${T}\\s*;?`, 'gs'),
    // export { … } from 'x'
    new RegExp(`export\\s*\\{[^}]*\\}\\s*from\\s*${T}\\s*;?`, 'gs'),
    // const x = require('x') / const { a } = require('x')
    new RegExp(`(?:const|let|var)\\s+(?:\\{[^}]*\\}|[\\w$]+)\\s*=\\s*require\\s*\\(\\s*${T}\\s*\\)[^;]*;?`, 'gs'),
  ];

  const ranges: Array<[number, number]> = [];
  for (const re of forms) {
    re.lastIndex = 0;
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

function removeTsImports(src: string, target: string): RemoveImportsResult {
  const ranges = tsImportRanges(src, target);
  if (ranges.length === 0) return { removed: 0, changed: false, output: src, removed_statements: [] };
  return applyCuts(
    src,
    ranges.map(([start, end]) => ({ start, end, source: target, via: 'regex' as const })),
  );
}

/** 单文件、单目标源的 import 删除。lang 由文件扩展名决定（executor 传入）。 */
export function removeImportsFromSource(src: string, target: string, lang: 'go' | 'ts'): RemoveImportsResult {
  return lang === 'go' ? removeGoImports(src, target) : removeTsImports(src, target);
}

// ─────────────────────────────────────────────
// span 路径：cache.db 的 imports.start_index / end_index（整句偏移）
// ─────────────────────────────────────────────
/** 库里一条 import 的整句 span（UTF-16 码元索引，`[start, end)`，end 不含结尾换行） */
interface ImportSpan {
  line: number;
  source: string;
  start: number;
  end: number;
}

/** 打开项目 cache.db 用于**只读**取 span。库不存在 / 读不动 / 旧库还没这两列 ⇒ null（退回正则）。 */
function openIndexDb(projectDir: string): DatabaseSync | null {
  const dbFile = findCacheDb({ sourceRoot: projectDir });
  if (!dbFile) return null;
  try {
    return new DatabaseSync(dbFile);
  } catch {
    return null;
  }
}

/** 该文件是否真的用 CJS `require('target')` 引了目标源（解析器不把 require 记成 import ⇒ span 看不见它） */
function hasRequireOf(src: string, source: string): boolean {
  return new RegExp(`require\\s*\\(\\s*(["'])${escRe(source)}\\1\\s*\\)`).test(src);
}

/**
 * 取「这个文件里、这些目标源」的整句 span；**任一准入条件不满足就返回 null**（= 整文件退回正则）。
 *
 * 准入（★ 按**文件**判，不按行混用 —— 实测污染是「每文件全有/全无」，475 文件 mixed=0）：
 *   ① `n > 0 && COUNT(start_index) === n`：这个文件的每条 import 都有 span；
 *   ② `files.content_hash` 与待改源码一致：库里的偏移与手上这份源码同源（否则偏移不可信）；
 *   ③ 每个目标 source 都至少有一条 span：缺一条就说明库看不见全部（如 CJS require）；
 *   ④ 该文件没有用 `require('source')` 引目标源（同样是 span 的盲区）。
 */
function spansForFile(
  db: DatabaseSync,
  projectDir: string,
  absPath: string,
  src: string,
  sources: string[],
): ImportSpan[] | null {
  const rel = toIndexKey(projectDir, absPath);
  if (!rel) return null;

  const cov = db
    .prepare('SELECT COUNT(*) n, COUNT(start_index) si FROM imports WHERE file_path = $p')
    .get({ p: rel }) as { n: number; si: number } | undefined;
  // ① 无行 / 混合（部分行没 span）⇒ 不按 span 切（口径按文件，不按行）
  if (!cov || !(cov.n > 0 && cov.si === cov.n)) return null;

  const fileRow = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: rel }) as
    | { content_hash: string }
    | undefined;
  // ② 库与源码不同源 ⇒ 偏移可能指向别处，绝不用
  if (!fileRow || fileRow.content_hash !== contentHash(src)) return null;

  const wanted = new Set(sources);
  for (const s of wanted) if (hasRequireOf(src, s)) return null; // ④

  const rows = db
    .prepare('SELECT line, source, start_index si, end_index ei FROM imports WHERE file_path = $p ORDER BY start_index')
    .all({ p: rel }) as Array<{ line: number; source: string; si: number | null; ei: number | null }>;

  const spans: ImportSpan[] = [];
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const r of rows) {
    if (!wanted.has(r.source)) continue;
    if (r.si === null || r.ei === null) return null;
    found.add(r.source);
    const key = `${r.si}:${r.ei}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spans.push({ line: r.line, source: r.source, start: r.si, end: r.ei });
  }
  // ③ 目标源缺 span ⇒ 库看不见它，退回正则（正面删才不漏）
  for (const s of wanted) if (!found.has(s)) return null;
  return spans;
}

/** 按 span 切；切出来的文本必须真的含该 source 的说明符，否则视为「偏移与源码不同源」⇒ null */
function removeImportsBySpans(src: string, spans: ImportSpan[]): RemoveImportsResult | null {
  const cuts: Cut[] = [];
  for (const sp of spans) {
    if (!Number.isInteger(sp.start) || !Number.isInteger(sp.end)) return null;
    if (sp.start < 0 || sp.end > src.length || sp.start >= sp.end) return null;
    const text = src.slice(sp.start, sp.end);
    if (!text.trim()) return null;
    if (!text.includes(`'${sp.source}'`) && !text.includes(`"${sp.source}"`)) return null;
    cuts.push({ start: sp.start, end: sp.end, source: sp.source, via: 'span' });
  }
  if (cuts.length === 0) return null;
  return applyCuts(src, cuts);
}

// ─────────────────────────────────────────────
// 执行器：聚合 dead 清单 → 按文件分组 → 原子落盘
// ─────────────────────────────────────────────
export interface DeadImportRemoval {
  source: string;
  removed: number;
  changed: boolean;
}

export interface FileRemoval {
  file: string;
  lang: 'go' | 'ts';
  /** 本文件这批删除走的是哪条路（span = cache.db 整句偏移；regex = 正则兜底） */
  via: 'span' | 'regex';
  removals: DeadImportRemoval[];
  changed: boolean;
}

/** ★ 删除回执（file 相对 project_dir；text = 被删的原句） */
export interface RemovedStatementReceipt extends RemovedStatement {
  file: string;
}

export interface RemoveDeadImportResult {
  /** 逐文件移除报告（★ 新名：旧 `files` 一名 6 义；报告数组统一 `<领域>_reports`） */
  removal_reports: FileRemoval[];
  files_changed: number;
  statements_removed: number;
  /** ★ 每删一条一行 —— 没有回执的"改动"等于悄悄删东西 */
  removed_statements: RemovedStatementReceipt[];
  /**
   * ★ 索引写穿结果（2026-09-14）：改完源码后符号索引是否**已经跟着更新**。
   * 不返回这个，LLM 就无从知道"我下一步查引用会不会读到旧图"。
   */
  indexWriteThrough?: WriteThroughOutcome;
}

function langOfFile(rel: string): 'go' | 'ts' | null {
  if (rel.endsWith('.go')) return 'go';
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) return 'ts';
  return null;
}

/** 回执 → 逐 source 条数（两条删除路径共用，免得各数一遍口径分叉） */
function countBySource(statements: RemovedStatement[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const st of statements) m.set(st.source, (m.get(st.source) ?? 0) + 1);
  return m;
}

/** 聚合 + 计算（不落盘）：返回写盘前后内容映射、统计与逐文件报告。
 *  两处共用（纯执行器与验证闭环），保证同一条改写规则。 */
function computeChanges(opts: {
  project_dir: string;
  dead: DeadDepCandidate[];
}): {
  absToNew: Map<string, string>;
  originals: Map<string, string>;
  result: RemoveDeadImportResult;
} {
  const proj = path.resolve(opts.project_dir);
  const toAbs = (f: string): string => (path.isAbsolute(f) ? path.resolve(f) : path.resolve(proj, f));

  // fileAbs → { lang, sources }
  const fileEntry = new Map<string, { lang: 'go' | 'ts'; sources: string[] }>();
  for (const d of opts.dead ?? []) {
    for (const f of d.files ?? []) {
      const lang = langOfFile(f);
      if (!lang) continue;
      const abs = toAbs(f);
      let en = fileEntry.get(abs);
      if (!en) {
        en = { lang, sources: [] };
        fileEntry.set(abs, en);
      }
      if (!en.sources.includes(d.source)) en.sources.push(d.source);
    }
  }

  // 原子性：预读全部源文件，任一读取失败 → 中止、一个都不写
  const sources = new Map<string, string>();
  for (const abs of fileEntry.keys()) {
    try {
      sources.set(abs, fs.readFileSync(abs, 'utf-8'));
    } catch (e) {
      throw new Error(`读取文件失败（原子性：未写任何文件）：${abs} — ${(e as Error).message}`);
    }
  }

  const originals = new Map(sources);
  const absToNew = new Map<string, string>();
  const filesOut: FileRemoval[] = [];
  let statementsRemoved = 0;
  const receipts: RemovedStatementReceipt[] = [];

  const spanDb = openIndexDb(proj);
  try {
    for (const [abs, en] of fileEntry) {
      const original = sources.get(abs)!;
      const file = path.relative(proj, abs) || abs;
      let src = original;
      let via: 'span' | 'regex' = 'regex';
      const statements: RemovedStatement[] = [];
      const results: DeadImportRemoval[] = [];

      // ① span 路径（只 TS/JS）：库里整句偏移直接切
      const spans = en.lang === 'ts' && spanDb ? spansForFile(spanDb, proj, abs, original, en.sources) : null;
      const bySpan = spans ? removeImportsBySpans(original, spans) : null;

      if (bySpan) {
        via = 'span';
        src = bySpan.output;
        statements.push(...bySpan.removed_statements);
        const counts = countBySource(statements);
        for (const source of en.sources) {
          const n = counts.get(source) ?? 0;
          results.push({ source, removed: n, changed: n > 0 });
        }
      } else if (en.lang === 'go') {
        // Go 仍走正则（块导入的 span 是整块，按 span 删单条会误伤同块其他源）
        for (const source of en.sources) {
          const res = removeGoImports(src, source);
          results.push({ source, removed: res.removed, changed: res.changed });
          statements.push(...res.removed_statements);
          src = res.output;
        }
      } else {
        // TS/JS 正则兜底：**所有源都先对原始源码求区间**，再一次性切。
        // 旧实现是"逐源串行"——删完第一源后文本变短，第二源的偏移全部漂移，
        // 回执里的 line 会指向错行（实测：多源文件的行号不可信）。
        const cuts: Cut[] = [];
        for (const source of en.sources) {
          for (const [start, end] of tsImportRanges(original, source)) {
            cuts.push({ start, end, source, via: 'regex' });
          }
        }
        if (cuts.length > 0) {
          const res = applyCuts(original, cuts);
          src = res.output;
          statements.push(...res.removed_statements);
        }
        const counts = countBySource(statements);
        for (const source of en.sources) {
          const n = counts.get(source) ?? 0;
          results.push({ source, removed: n, changed: n > 0 });
        }
      }

      const changed = results.some((r) => r.changed);
      if (changed) absToNew.set(abs, src);
      for (const r of results) statementsRemoved += r.removed;
      for (const st of statements) receipts.push({ file, ...st });
      filesOut.push({ file, lang: en.lang, via, removals: results, changed });
    }
  } finally {
    try {
      spanDb?.close();
    } catch {
      /* 已关闭 */
    }
  }

  return {
    absToNew,
    originals,
    result: {
      removal_reports: filesOut,
      files_changed: absToNew.size,
      statements_removed: statementsRemoved,
      removed_statements: receipts,
    },
  };
}

function removeDeadImportsCore(opts: {
  project_dir: string;
  dead: DeadDepCandidate[];
  /**
   * ★★★ 2026-10-20（A7 闭合）：**本次写入者身份** —— 一路交到 `snapshotAndRecordSelfWrite`。
   * ★ 不传 ⇒ 闸只能读 env，而生产面（stdio MCP）env 是空的 ⇒ 闸永远"提醒 + 放行"。
   */
  actor?: string;
  /** ★★★ T356：按 run 授权（一个 scope 一次授权一批文件）—— 逐字交给写闸，本层不解释它 */
  authorize?: string;
}): RemoveDeadImportResult {
  const { absToNew, result } = computeChanges(opts);
  if (absToNew.size === 0) return result;
  const files = [...absToNew.keys()];
  // ★ 统一写入闸（2026-09-14）：旧实现只 `writeFileSync`，**不快照、不登记** ——
  //   改完 import 之后紧接着 find_references / 影响面分析读到的还是旧图（静默撒谎）。
  //   本工具是**同步签名** ⇒ 写前快照 + 自写登记（L1b）先落兜底；
  //   ⑤ 同步写穿（2026-09-15）：写完再尝试 `syncSelfWritesSync` —— 解析器已预热
  //   （进程启动 prewarmKernel）则**当场直连 L1a**，优先取同步结果；未预热则预热闸
  //   整批落回 L1b（idxPre 已登记，登记项按内容 hash 幂等，重复消费无害）。
  const idxPre = snapshotAndRecordSelfWrite(opts.project_dir, files, {
    label: `remove_dead_imports: ${absToNew.size} 文件`,
    // ★★★ 2026-10-20（A7 闭合）：身份往下传 —— 本函数是同步签名，闸就在上面那个函数里。
    actor: opts.actor,
    // ★★★ T356：授权也逐字往下传（**与 actor 同一行写法** —— 两个都只是"交上去"，不在这里解释）
    authorize: opts.authorize,
  });
  for (const [abs, newSrc] of absToNew) fs.writeFileSync(abs, newSrc, 'utf-8');
  const idxSync = syncSelfWritesSync(opts.project_dir, files);
  return { ...result, indexWriteThrough: idxSync ?? idxPre };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * - 作用域类 `project_dir`：入参必填 ⇒ 随时可给（`path.resolve` 成绝对根）。
 * - 对象类 `written_files`：**只有真落盘才给**。判据 = `changed` 的那批文件：
 *   Core 只有在 `absToNew.size > 0` 时才走到 `writeFileSync`（:296 早退 ⇒ 没改动、没落盘）；
 *   而 `absToNew` 恰是"内容真的变了"的文件集，与 `removal_reports[].changed === true` 同一批。
 *   `changed` 为空 ⇒ 整项省略（省略 ≠ 空数组）。
 * - 值口径 = **仓库相对 POSIX**：`removal_reports[].file` 是 `path.relative(proj, abs)`（Windows 下带 `\`），
 *   故一律经闸的 `toIndexKey(project_dir, file)` 归一（★ 根外文件返回 null ⇒ 不塞，见 scaffold 同款判据）。
 *
 * ★ 旁路提示：`removeDeadImportsWithVerify` 在**未启用验证 / 探测不出命令**两条路径上
 *   `{ ...removeDeadImports(opts), ... }` —— 那两条路径**确实落了盘**（无回滚），故随之携带的
 *   `touched` 是**准确**的；其主路径用 `c.result`（不带 touched）。本笔按范围**不改**该函数。
 */
function touchedOf(opts: { project_dir: string }, r: RemoveDeadImportResult): Touched {
  const touched: Touched = { project_dir: path.resolve(opts.project_dir) };
  const written = writtenFilesOf(opts.project_dir, r);
  if (written.length > 0) touched.written_files = written;
  return touched;
}

/**
 * ★★ 「**这次真的改了哪些文件**」的唯一判据（2026-10-06 从上面的 `touchedOf` 里**抽出来并导出**）。
 *
 * 判据 = `removal_reports[].changed === true` 的那批 —— Core 只在 `absToNew.size > 0` 时才走到
 * `writeFileSync`，而 `absToNew` 恰是"内容真的变了"的文件集，与 `changed` **同一批**。
 * 值口径 = **仓库相对 POSIX**（`toIndexKey` 归一；根外文件返回 null ⇒ 不塞）。
 *
 * ★ 为什么必须**唯一**：`deprecate_offline` 复用的正是 `removeDeadImportsWithVerify`，
 *   而那条主路径**不自带 `touched`**（它用 `c.result`，见上面 `touchedOf` 的旁路提示）
 *   ⇒ 它要算"改了哪些文件"时**必须用同一把尺**，否则同一件事会长出第二份判据（本仓头号病根）。
 */
export function writtenFilesOf(projectDir: string, r: RemoveDeadImportResult): string[] {
  if (r.files_changed <= 0) return [];
  const written = new Set<string>();
  for (const rep of r.removal_reports) {
    if (!rep.changed) continue;
    const rel = toIndexKey(projectDir, rep.file);
    if (rel) written.add(rel);
  }
  return [...written];
}

export function removeDeadImports(opts: {
  project_dir: string;
  dead: DeadDepCandidate[];
  /** ★ 2026-10-20（A7）：本次写入者身份（与 claim 时 `data.owner` 同一个值），直通 `removeDeadImportsCore` */
  actor?: string;
  /** ★★★ T356：按 run 授权 —— 直通 `removeDeadImportsCore`（判据仍只住写闸） */
  authorize?: string;
}): TouchedProduct<RemoveDeadImportResult> {
  const r = removeDeadImportsCore(opts);
  return withTouched(r, touchedOf(opts, r));
}

// ─────────────────────────────────────────────
// 改前/改后验证闭环
// ─────────────────────────────────────────────
export interface RemoveDeadImportsVerifyResult extends RemoveDeadImportResult {
  verification: {
    enabled: boolean;
    outcome: VerifyOutcomeKind;
    baseline: VerificationOutcome | null;
    after: VerificationOutcome | null;
    rolled_back?: boolean;
    /** baseline_fail / regression_rolled_back 时的失败详情 */
    detail?: string;
  };
}

export interface RemoveDeadImportsVerifyOptions {
  project_dir: string;
  dead: DeadDepCandidate[];
  /**
   * ★★★ 2026-10-20（A7 闭合）：本次写入者身份 —— 本函数的落盘同样走
   * `snapshotAndRecordSelfWrite`（验证闭环那条也在内），不传就是“闸只看得见 env”。
   */
  actor?: string;
  /** ★★★ T356：按 run 授权（验证闭环那条也是真落盘 ⇒ 同一把尺） */
  authorize?: string;
  /** false/缺省 = 只执行不验证；true = 自动探测命令；{commands} = 自定义验证命令组 */
  verify?: boolean | { commands?: VerifyCommand[] };
  /** 单测注入的验证执行器（默认跑真命令） */
  verifyImpl?: (o: { cwd: string; commands: VerifyCommand[] }) => VerificationOutcome;
}

export function removeDeadImportsWithVerify(opts: RemoveDeadImportsVerifyOptions): RemoveDeadImportsVerifyResult {
  const cwd = path.resolve(opts.project_dir);
  const enabled = opts.verify === true || (typeof opts.verify === 'object' && opts.verify !== null);
  if (!enabled) {
    return { ...removeDeadImports(opts), verification: { enabled: false, outcome: 'not_verifiable', baseline: null, after: null } };
  }

  const commands: VerifyCommand[] =
    (typeof opts.verify === 'object' && opts.verify.commands) ||
    defaultVerifyCommands(cwd);
  if (commands.length === 0) {
    // 探测不出项目形态 → 不可自动验证：仍执行改写，但如实标注不可验证
    return {
      ...removeDeadImports(opts),
      verification: { enabled: true, outcome: 'not_verifiable', baseline: null, after: null },
    };
  }

  const run = opts.verifyImpl ?? runVerification;
  const c = computeChanges(opts);
  const files = [...c.absToNew.keys()];

  // ★★★ 2026-10-20（P0）：**闸 / 快照 / 登记必须在任何 `writeFileSync` 之前**。
  //   改前实测（labs 夹具）：`applyWithVerify` 先落盘、`snapshotAndRecordSelfWrite` 后置 ⇒
  //   闸抛「拒绝落盘（A7「谁在写」）」时**磁盘已改、快照 0 份、自写 0 条**（拒了但写了）。
  //   ⇒ 顺序改成：`闸+快照+登记` → `写 / 验 / 回滚` → `写穿`。判据仍只住
  //     `snapshotAndRecordSelfWrite` 内部那一处 `assertSourceWriteRegistered`（本层不自判第二次）。
  //   ★ 与「写后再验」不冲突：闸是**权限**判定（与盘态无关），验证闭环仍是「写了再验、回归即回滚」。
  //   ★ 顺带修好快照时点：旧顺序拍的是**写后**（或回滚后）的盘态，现在才是真的「写前」。
  const idxPre = snapshotAndRecordSelfWrite(cwd, files, {
    label: 'remove_dead_imports: 验证闭环',
    // ★★★ 2026-10-20（A7 闭合）：验证闭环这条同样要报身份（它也是真落盘）。
    actor: opts.actor,
    // ★★★ T356：授权同上（同一行写法）
    authorize: opts.authorize,
  });

  const ver = applyWithVerify({
    cwd,
    commands,
    verify: run,
    apply: () => {
      if (c.absToNew.size === 0) return false;
      for (const [abs, newSrc] of c.absToNew) fs.writeFileSync(abs, newSrc, 'utf-8');
      return true;
    },
    rollback: () => {
      for (const [abs, orig] of c.originals) fs.writeFileSync(abs, orig, 'utf-8');
    },
  });

  // ⑤ 同步写穿（2026-09-15）：写完再试 `syncSelfWritesSync` —— 解析器已预热则当场直连 L1a，
  //   优先取同步结果（`syncFile` 按内容 hash 判定，"写完又回滚回原样"自然落成 skipped，不会假报改动）。
  const idxSync = syncSelfWritesSync(cwd, files);
  const idx = idxSync ?? idxPre;

  if (ver.outcome === 'baseline_fail') {
    // 地基黄：一个都不写
    return {
      removal_reports: [], files_changed: 0, statements_removed: 0, removed_statements: [],
      verification: { enabled: true, outcome: 'baseline_fail', baseline: ver.baseline, after: null, detail: ver.baseline?.detail },
      indexWriteThrough: idx,
    };
  }
  if (ver.outcome === 'no_change') {
    return { ...c.result, verification: { enabled: true, outcome: 'no_change', baseline: ver.baseline, after: ver.after }, indexWriteThrough: idx };
  }
  if (ver.outcome === 'regression_rolled_back') {
    return {
      ...c.result,
      verification: { enabled: true, outcome: 'regression_rolled_back', baseline: ver.baseline, after: ver.after, rolled_back: true, detail: ver.after?.detail },
      indexWriteThrough: idx,
    };
  }
  return { ...c.result, verification: { enabled: true, outcome: 'applied_verified', baseline: ver.baseline, after: ver.after }, indexWriteThrough: idx };
}