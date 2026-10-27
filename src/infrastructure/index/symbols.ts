/**
 * 符号索引写入路径：ts_kernel 解析结果 → cache.db（增量）
 *
 * 增量语义：
 *   - files.content_hash（sha1）未变 → 整个文件跳过（status='skipped'）
 *   - 解析失败不写 files 行 → 下次运行自动重试
 *   - 文件节点 UPSERT 不删除（保护指向它的 import 边），符号节点整批重插
 *
 * import 边：仅解析相对导入（'./foo' '../bar' → 项目内文件）；
 * 包导入（npm 包 / Go 包路径 / Python 包）v1 不建边。
 * 目标文件尚未同步时先建桩节点（INSERT OR IGNORE），其正式同步时
 * ON CONFLICT 更新回填——与同步顺序无关。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Database } from './db.js';
import { parseFileFull, parseFileFullSync, resolveImportPath, type ParsedFile, type ParsedSymbol } from '../parse/index.js';
// ★ 「什么算源码」走 L1 唯一**用法**（`source_exts.ts` 的 `codeSourceExtSet` = 可解析 ∩ 代码语言
//   + 小写归一 + 进程内缓存）——本文件不再用 `isSupported`（那是"能不能解析"，不是"算不算源码"），
//   也不再自拼 `new Set(...map(lower))` 那套用法。
import { codeSourceExtSet } from '../parse/source_exts.js';
// ★ T-#62：**多语言导入解析的适配器表** —— 本文件不再按语言写 if，而是问它
import { LANG_ADAPTERS, type ResolveImportCtx } from '../parse/kernel.js';
// ★ 写路径挂钩（§19）：ProjectView 的缓存在「磁盘被改过」时必须失效。
//   syncFile/syncFileSync 是**全部 15 个写工具**的公共落点 ⇒ 挂这一处即覆盖所有写入，
//   不必让每个写工具自己记得调 —— 「靠自觉的接线」正是本项目反复踩的坑。
import { invalidateProjectView } from '../project_view.js';
import { inTransaction } from './db.js';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export type SyncStatus = 'updated' | 'skipped' | 'ignored' | 'failed';

export interface SyncFileResult {
  path: string;
  status: SyncStatus;
  node_count: number;
  edge_count: number;
  call_count?: number;
  /** ★ 2026-10-22（DB 补全·调用边）：其中由**跨文件类型成员**证出来的边（`reg.register()` / `Ts.静态成员()`）—— 单列是为了让"补了多少"能在回执里读，而不是靠事后数库 */
  cross_type_edges?: number;
  /** 符号级 diff 计数（v3）：updated 且非首次导入时给出；undefined=无对比意义 */
  symbol_diff?: { added: number; removed: number; changed: number };
  error?: string;
}

export interface SyncProjectResult {
  total: number;
  updated: number;
  skipped: number;
  ignored: number;
  failed: number;
  ms: number;
  results: SyncFileResult[];
  /** 跨文件调用解析统计（收尾步骤，见 resolveCrossFileCalls） */
  cross?: CrossFileResolveStats;
  /**
   * ★ §7（2026-10-23）：这次扫描**逐文件改了什么**的计数。
   * 明细在 `scan_changes`（按 `scan_runs.id`），这里只给三个数当回执。
   * ★ 只给计数**不能**当成"改了什么"的答案 —— 要答那个问题必须查 `scan_changes`。
   */
  changes?: { added: number; changed: number; removed: number };
}

export interface SymbolHit {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  start_line: number;
}

export interface IndexStats {
  files: number;
  nodes: number;
  edges: number;
  last_indexed_at: number | null;
}

// 相对导入解析的候选扩展名 / index 文件名已上移到
// `tools/ts_kernel/import_resolve.ts`（唯一实现，2026-09-28）—— 此处不再重复定义。

// ─────────────────────────────────────────────────────────────
// 路径与 hash
// ─────────────────────────────────────────────────────────────

/**
 * ★★★ T245（2026-10-13）：**「路径 → 索引键」的唯一住处**（键 = 相对项目根的 posix 路径）。
 *
 * ## 为什么必须只有这一处
 * 此前**两份实现，而只有一份有护栏**：
 * · 下面那个 `toRelPath`：裸 `path.relative` ⇒ ★ **根外路径会造出 `../x.ts` 这样的键**（污染键空间）；
 * · `write_gate.toRelPosix`：根外 ⇒ `null`（注释写着"不参与索引，避免键污染"）。
 * ⇒ ★★ 而护栏那一半当时住在**上层**（`application/write_gate.ts`）——
 *   "路径 → 索引键"明明是**索引自己的事**，下层却没法复用它 ⇒ 只能各写一份。
 * ⇒ 现在护栏**沉到索引这一层**，上层**改用本函数**（`toRelPosix` 已删）。
 *
 * ## 越界的两种处置由调用方按语义选（★ 这是有意的，不是分叉）
 * · 想"**跳过不索引**" ⇒ 用本函数并判 `null`（`write_gate` / `scaffold` / `apply_writes` 那一族）；
 * · 想"**响亮**" ⇒ 用 {@link toRelPath}（根外它会**抛** —— 因为它造不出合法的索引键）。
 */
export function toIndexKey(projectRoot: string, p: string): string | null {
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * 绝对路径 → 相对 projectRoot 的 posix 路径（节点/文件表的统一键）。
 *
 * ★★ T245：**根外 ⇒ 抛** —— 不再静默造出 `../x.ts` 键（那是**索引污染**）。
 * 要"跳过不索引"的语义，请改用 {@link toIndexKey} 并判 `null`。
 */
export function toRelPath(projectRoot: string, absPath: string): string {
  const rel = toIndexKey(projectRoot, absPath);
  if (rel === null) {
    throw new Error(
      `路径不在项目根内 ⇒ 造不出合法的索引键：${absPath}（根 = ${path.resolve(projectRoot)}）。` +
        `★ 索引键是"相对根的 posix 路径"；根外路径会在键空间里造出 \`../…\` 这类**污染键**。` +
        `★ 若这里想要的是"**跳过不索引**"，请改用 \`toIndexKey()\` 并判 \`null\`。 `,
    );
  }
  return rel;
}

/**
 * 内容指纹（sha1）—— ★ **导出**（2026-10-09）：验收判据要问"索引与源码是否一致"，
 * 而**唯一准的判据就是这个哈希**（`files.content_hash` 存的就是它）。
 * ★ 别处不许再写一份 sha1 —— 那是判据分叉（`symbols.ts:5` 自陈"content_hash 未变 ⇒ 整文件跳过"）。
 */
export function contentHash(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
}

function countLinesOf(content: string): number {
  let n = 1;
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) n++;
  return content.endsWith('\n') ? n - 1 : n;
}

// ─────────────────────────────────────────────────────────────
// 符号级 hash 与 diff（v3：符号级影响分析数据源）
// ─────────────────────────────────────────────────────────────

/** 符号状态：added=新增 / removed=删除 / changed=span hash 变（实质变更） */
export type SymbolStatus = 'added' | 'removed' | 'changed';

/** 净差异合并（链式）：同一文件连续多次编辑未消费时，把 vA→vB 与 vB→vC 合成 vA→vC */
export function mergeSymbolStatus(
  a: SymbolStatus | undefined,
  b: SymbolStatus | undefined,
): SymbolStatus | undefined {
  if (!b) return a;
  if (!a) return b;
  if (a === 'added' && b === 'removed') return undefined; // 加了又删 → 净无
  if (a === 'added' && b === 'changed') return 'added'; // 相对 vA 仍是新增
  if (a === 'removed' && b === 'added') return 'changed'; // 删了又回 → 相对 vA 是变更
  return b; // 其余组合后状态即最新状态
}

/**
 * 符号 span 归一化 hash：取 [start_line, end_line] 文本，剔纯注释行后去除全部空白，sha1。
 * 注释 / 空行 / 缩进 / 单行↔多行重排均不改变 hash → 不计为"实质变更"，改注释或格式化
 * 不再虚报波及。v1 近似：整行块注释中间行（* 开头）剔除；py 仅剔 # 注释（docstring
 * 保守保留）；行内块注释（/* ... *\/ 同行夹代码）仍会计入变更。
 */
export function symbolSpanHash(lines: string[], startLine: number, endLine: number, lang: string): string {
  const isPy = lang === 'py' || lang === 'python';
  const commentRe = isPy ? /^\s*#/ : /^\s*(\/\/|\/\*|\*)/;
  const out: string[] = [];
  for (let i = Math.max(0, startLine - 1); i < Math.min(lines.length, endLine); i++) {
    const l = lines[i].trim();
    if (!l || commentRe.test(l)) continue;
    out.push(l);
  }
  return crypto.createHash('sha1').update(out.join('').replace(/\s+/g, ''), 'utf-8').digest('hex');
}

// ─────────────────────────────────────────────────────────────
// v15：读 `nodes.body_text`（函数体原文）—— **四道准入**（照 `imports.start_index` / `nodes.members` 的先例，
// 不盲信 DB）
// ─────────────────────────────────────────────────────────────
//
// ★ 为什么必须四道：body 是**重写代码的依据**，读错一格的代价 = "照旧代码写出新代码"。
//   而它是**副本**不是唯一一份（源文件才是权威）⇒ 读它之前必须证明"它还是这个文件的那一段"。
//
//   ① 库里有行：`nodes` 有 (file_path, qualified_name, start_line) 这一行（旧库没有 body_text 列 ⇒ 也算不过）；
//   ② 有体：`body_text IS NOT NULL`（NULL = 该节点没有体 / 该语言的体不是单一节点 —— 不是"空体"）；
//   ③ 库内自洽：`sha1(body_text) === body_hash`（本表写入路径没被绕过）；
//   ④ 库与源码同源：`contentHash(src) === files.content_hash` —— ★ **这一道是"索引过期"的唯一判据**；
//   ⑤ 取出的文本能对上：`body_text` 确实是该符号 span 里的一段（行号与体互相印证）。
//   任一道不过 ⇒ `ok:false` + **具名 reason**；调用方**必须如实透出**，不许把它当"没有体"悄悄跳过。

export type SymbolBodyReject =
  /** 库里有没这一行 / 旧库缺 body_text 列 */
  | 'no_row'
  /** body_text IS NULL：该节点没有体，或该语言的体不是单一 AST 节点 */
  | 'no_body'
  /** sha1(body_text) ≠ body_hash：库内不自洽（写入路径被绕过 / 行被手改） */
  | 'hash_mismatch'
  /** contentHash(src) ≠ files.content_hash：**索引过期**，库里的 body 可能是旧代码 */
  | 'index_stale'
  /** body_text 不在该符号 span 的源码里：行号或体对不上 */
  | 'text_mismatch';

export type SymbolBodyRead =
  | { ok: true; body: string; body_hash: string }
  | { ok: false; reason: SymbolBodyReject; detail: string };

/**
 * 读一个符号的函数体原文（`nodes.body_text`），**五道准入**见上方注释。
 *
 * 入参必须给 `src`（这份源码的**当前**内容）：没有它就证明不了"库与源码同源"，
 * 而"证明不了"在本仓不算"可以用"（§2d 不许猜）。手工/无源码场景请显式退到
 * `size + mtimeMs` 的 stat 级校验，并在回执里写明"只做了 stat 级"。
 *
 * `startLine` 用**库里的** start_line（不是源码/AST 的）——它是定位键的一部分。
 */
export function readSymbolBody(
  db: Database,
  opts: { file: string; qualifiedName: string; startLine: number; src: string },
): SymbolBodyRead {
  type Row = { body_text: string | null; body_hash: string | null; start_line: number; end_line: number };
  let row: Row | undefined;
  try {
    row = db
      .prepare(
        'SELECT body_text, body_hash, start_line, end_line FROM nodes WHERE file_path = $f AND qualified_name = $q AND start_line = $s',
      )
      .get({ f: opts.file, q: opts.qualifiedName, s: opts.startLine }) as Row | undefined;
  } catch (e) {
    // 旧库（v15 之前建的）没有这两列 ⇒ 说清是"库落后"，不是"没体"
    return { ok: false, reason: 'no_row', detail: `nodes 查询失败（旧库缺 body_text/body_hash 列？需重建索引）：${(e as Error).message}` };
  }
  if (!row) {
    return { ok: false, reason: 'no_row', detail: `nodes 里没有 ${opts.file}#${opts.qualifiedName}:L${opts.startLine} 这一行` };
  }
  if (row.body_text === null || row.body_text === '') {
    return { ok: false, reason: 'no_body', detail: 'body_text 为 NULL/空（该节点没有体，或该语言的体不是单一 AST 节点）' };
  }
  // ③ 库内自洽
  const h = contentHash(row.body_text);
  if (!row.body_hash || row.body_hash !== h) {
    return {
      ok: false,
      reason: 'hash_mismatch',
      detail: `sha1(body_text)=${h.slice(0, 12)}… ≠ body_hash=${(row.body_hash ?? 'NULL').slice(0, 12)}…`,
    };
  }
  // ④ 库与源码同源
  const fileRow = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: opts.file }) as
    | { content_hash: string }
    | undefined;
  if (!fileRow) return { ok: false, reason: 'index_stale', detail: `files 里没有 ${opts.file} 的 content_hash` };
  if (fileRow.content_hash !== contentHash(opts.src)) {
    return {
      ok: false,
      reason: 'index_stale',
      detail: 'contentHash(当前源码) ≠ files.content_hash ⇒ **索引过期**：库里的 body 可能是旧代码',
    };
  }
  // ⑤ 取出的文本能对上（CRLF 只在这里归一，**不改返回值**）
  const span = opts.src.split(/\r?\n/).slice(row.start_line - 1, row.end_line).join('\n');
  if (!span.includes(row.body_text.replace(/\r\n/g, '\n'))) {
    return {
      ok: false,
      reason: 'text_mismatch',
      detail: `body_text 不在 L${row.start_line}-L${row.end_line} 的源码里（行号或体对不上）`,
    };
  }
  return { ok: true, body: row.body_text, body_hash: row.body_hash };
}

/** qualified_name → hash 集合（文件内重名如 TS 重载合并比较） */
function hashSetsOf(rows: Array<{ qualified_name: string; sym_hash: string | null }>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = m.get(r.qualified_name);
    if (!set) {
      set = new Set();
      m.set(r.qualified_name, set);
    }
    set.add(r.sym_hash ?? ''); // NULL（理论上 v3 后不再出现）按空串参与比较 → 判 changed
  }
  return m;
}

/**
 * 解析相对导入到项目内文件（posix relPath）；解析不到返回 null。
 *
 * ★ 候选生成已上移到 `tools/ts_kernel/import_resolve.ts`（**唯一实现**，2026-09-28）。
 *   本份原先是最正确的一份（注释逐字写着"再 strip 扩展名重试"），但它只是三份复制中的一份，
 *   另两份（health / impact）漏了这步、且修正从未横向传播 ⇒ 详见该模块头部说明。
 *   与 health/impact 版的差别**只剩 `exists` 谓词**：这里查真实文件系统，它们查内存集合。
 *   ⚠️ 本层**不判相对性** —— 本函数还被 `tools/rename_file.ts` 当
 *   "路径字面量 → 项目内文件"的通用工具复用，在此加门会静默改变 rename_file 的行为。
 *
 * ★ 可选 `exts`（T13）：透传给 `resolveImportPath` 的候选扩展名表。**默认不传时走
 *   `IMPORT_EXTS`（行为与历史逐字一致）** —— 本函数的既有消费者（`applyParsedToIndex`
 *   的 import 边、`findCrossFileTarget` 的跨文件解析）都保持默认口径，不受本参数影响。
 *   传入方（`rename/rename_file.ts`）是为了让"TS/JS 家族"与内核注册表的扩展名口径对齐：
 *   `IMPORT_EXTS` 不含 `.mts/.cts`，而 `TS_JS_EXTS` 含 ⇒ 不传就会漏认这两种文件的引用。
 *   ★ 只传 `exts` 而非 `indexFiles`：index 回退（`./foo` → `./foo/index.ts`）语义未变。
 */
export function resolveImportTarget(
  projectRoot: string,
  fromRel: string,
  source: string,
  exts?: readonly string[],
): string | null {
  // ★ `exts ? { exts } : {}` 而非 `{ exts }`：`completionCandidates` 对 `exts: undefined`
  //   兜底到 `IMPORT_EXTS`，但对**空数组不兜底**（会只剩 index 候选）——见 import_resolve.ts
  //   resolveProjectImport 的同款注释。这里区分 undefined 与 []，调用方漏传时不会静默失能。
  return resolveImportPath(fromRel, source, (c) => fs.existsSync(path.join(projectRoot, c)), exts ? { exts } : {});
}

// ─────────────────────────────────────────────────────────────
// 单文件同步
// ─────────────────────────────────────────────────────────────

/** 前置产物：applyParsedToIndex 需要的读盘/判定上下文 */
interface SyncPrelude {
  rel: string;
  fail: (error: string) => SyncFileResult;
  content: string;
  stat: fs.Stats;
  hash: string;
  existing: { content_hash: string; norm_hash: string | null } | undefined;
  /** 语言字段用的小写扩展名（DB files.language / 节点 language） */
  ext: string;
}

type PreludeResult = { ok: true; pre: SyncPrelude } | { ok: false; early: SyncFileResult };

/**
 * 缓存行是否是**旧解析格式**留下的（⇒ 不能按「内容没变」短路，必须重解析）。
 *
 * 为什么需要（实测，2026-10-20）：`content_hash` 相同只能证明「源码没变」，
 * 证明不了「库里那几行是当前解析器产出的」。v12 给 `imports` 加 `start_index/end_index`
 * 之后，旧格式的行**永远是 NULL**，而这里按 hash 短路 ⇒ 这些行**没有任何机会被修好**：
 * 手工清表重建会被在跑的长进程（旧 dist 的 MCP / watch_project）再写回旧格式，
 * 于是 `.ts` 的 span 覆盖率长期停在 39%（实测 668/1739）。
 *
 * 判据只用「整条 import 全都没有 span」——观测到污染是**按文件全有/全无**
 * （474 个文件里 mixed=0），因此不会对正常文件误触发；也不会每轮空转重解析：
 * 当前 kernel 对 import 节点恒给 span（实测一次全量导入、零例外）。
 */
function hasLegacyImportRows(db: Database, rel: string): boolean {
  const row = db
    .prepare('SELECT COUNT(*) n, COUNT(start_index) si FROM v_imports WHERE file_path = $p')
    .get({ p: rel }) as { n: number; si: number };
  return row.n > 0 && row.si === 0;
}

/**
 * 前置（同步、无解析）：读盘 + 内容 hash 短路。
 * `early` = 短路结果（读盘失败 / 内容未变 skipped）。
 *
 * ⑤ 同步写穿（2026-09-15）：syncFile 链路里唯一的 await 是 parseFileFull → getParser
 * 的动态 import；把读盘前置与落库主体拆开后，async / sync 两条路径共用同一份
 * `applyParsedToIndex` 主体，不会漂移。预热（prewarmKernel）后 `syncFileSync` 全程无 await。
 */
function syncFilePrelude(db: Database, projectRoot: string, absPath: string): PreludeResult {
  const rel = toRelPath(projectRoot, absPath);
  const fail = (error: string): SyncFileResult => ({ path: rel, status: 'failed', node_count: 0, edge_count: 0, error });

  let content: string;
  let stat: fs.Stats;
  try {
    content = fs.readFileSync(absPath, 'utf-8');
    stat = fs.statSync(absPath);
  } catch (e) {
    return { ok: false, early: fail((e as Error).message) };
  }

  const hash = contentHash(content);
  const existing = db.prepare('SELECT content_hash, norm_hash FROM files WHERE path = $p').get({ p: rel }) as
    | { content_hash: string; norm_hash: string | null }
    | undefined;
  if (existing && existing.content_hash === hash) {
    // ★ 2026-10-07 修：**内容没变也要把 stat 回写**。
    //   缺陷（实测）：这里直接 return skipped，`files.modified_at` 仍停在旧值 ⇒
    //   纯 **mtime 变更**（touch / git checkout 还原 / 编辑器「保存但没改」）会让
    //   `detectStaleIndex`（判据 = size + mtimeMs）**永远**判它陈旧，**只增不减**；
    //   更糟的是它自己开的药方也治不好 —— 实测 `index_integrity({refresh:true})` 跑完，
    //   新鲜度仍报「不一致 N」，紧接着的读工具照样发 STALE_INDEX。
    //   正解：`size`/`modified_at` 是**文件的 stat 事实**，与「内容是否变」无关 ⇒
    //   内容没变也要把这行刷新，让保鲜探测能收敛。
    db.prepare('UPDATE files SET size = $s, modified_at = $m WHERE path = $p').run({
      s: stat.size,
      m: Math.round(stat.mtimeMs),
      p: rel,
    });
    // ★ 2026-10-20：短路还要求「库里那几行是当前解析格式」（见 hasLegacyImportRows）。
    //   旧格式的行不短路 ⇒ 下一次同步就地重解析并补上，不再永久停在 NULL。
    if (!hasLegacyImportRows(db, rel)) {
      return { ok: false, early: { path: rel, status: 'skipped', node_count: 0, edge_count: 0 } };
    }
  }

  return {
    ok: true,
    pre: { rel, fail, content, stat, hash, existing, ext: path.extname(rel).slice(1).toLowerCase() },
  };
}

// ─────────────────────────────────────────────────────────────
// 接收者类型守卫（2026-10-21）
// ─────────────────────────────────────────────────────────────

/** 局部名 → 声明类型（`base` = 剥掉泛型/数组/命名空间后的类型名） */
export interface ReceiverType {
  base: string;
  array: boolean;
}

/** 内置/容器类型名：接收者声明成这些，成员一定是原型方法（不在仓内） */
const CALL_GUARD_BUILTIN_TYPES = new Set([
  'Set', 'Map', 'WeakMap', 'WeakSet', 'ReadonlySet', 'ReadonlyMap', 'Array', 'ReadonlyArray',
  'string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'Function', 'Promise', 'Date',
  'RegExp', 'Buffer', 'URL', 'URLSearchParams', 'Error', 'Uint8Array', 'ArrayBuffer',
  'Database', 'DatabaseSync', 'StatementSync',
]);

/**
 * 本文件的「局部名 → 声明类型」表：**一次扫描**，供 callReceiverGuard 逐调用查。
 *
 * 只认四种**声明**形态（都是可机器判定的事实，不是推测）：
 *   `const|let|var x: T` / `const|let|var x = new T(` / 形参或字段 `x: T` /
 *   Go `x := &T{}` / `x := T{` / Python `x = T(`
 * ★ 同名有多处声明且类型不一致 ⇒ 记 null（歧义）。**歧义不收紧** —— 宁可漏拦，不可错拦。
 */
export function declaredReceiverTypes(content: string): Map<string, ReceiverType | null> {
  const acc = new Map<string, Map<string, ReceiverType>>();
  const add = (name: string, raw: string): void => {
    const text = String(raw || '').trim();
    if (!name || !text) return;
    const array = /\[\s*\]/.test(text) || /^(Array|ReadonlyArray|Set|ReadonlySet|Map|ReadonlyMap|Iterable)\s*</.test(text);
    const base = text
      .replace(/[?*&!]/g, '')
      .split(/[<\[|{(]/)[0]
      .trim()
      .split('.')
      .pop();
    if (!base || !/^[A-Za-z_$][\w$]*$/.test(base)) return;
    // ★ 按**类型名**归并（不按「带不带泛型」）：`new Map(...)` 与 `x: Map<string, Y>` 是同一种类型，
    //   否则同名的两处声明会被当成「类型不一致」⇒ 歧义 ⇒ 漏拦（实测：dataflow_core 的 8 条 Map 边）。
    const bucket = acc.get(name) ?? new Map<string, ReceiverType>();
    bucket.set(base, { base, array: (bucket.get(base)?.array ?? false) || array });
    acc.set(name, bucket);
  };
  const id = '([A-Za-z_$][\\w$]*)';
  const TYPE = '([A-Za-z_$][\\w$.<>\\[\\]|,\\s]{0,60}?)';
  for (const m of content.matchAll(new RegExp(`(?:const|let|var)\\s+${id}\\s*:\\s*${TYPE}\\s*[=;,)]`, 'g'))) add(m[1], m[2]);
  for (const m of content.matchAll(new RegExp(`(?:const|let|var)\\s+${id}\\s*=\\s*new\\s+([A-Za-z_$][\\w$.]*)`, 'g'))) add(m[1], m[2]);
  for (const m of content.matchAll(new RegExp(`[(,]\\s*${id}\\s*\\??\\s*:\\s*([A-Za-z_$][\\w$.]*(?:<[^;\\n)]{0,60}>)?(?:\\[\\])?)`, 'g'))) add(m[1], m[2]);
  for (const m of content.matchAll(new RegExp(`\\b${id}\\s*:=\\s*&?([A-Za-z_][\\w.]*)\\s*\\{`, 'g'))) add(m[1], m[2]);
  for (const m of content.matchAll(new RegExp(`\\b${id}\\s*=\\s*([A-Za-z_][\\w]*)\\s*\\(`, 'g'))) add(m[1], m[2]);
  // ★ Go 方法接收者 `func (t *Tiered) Emit()`：t 的类型就是 Tiered。
  //   为什么必须有：Go 里绝大多数 `x.Foo()` 的 x 就是接收者，漏了这条会把整片方法调用降级成 suspect。
  for (const m of content.matchAll(/func\s*\(\s*([A-Za-z_]\w*)\s+\*?([A-Za-z_][\w.]*)\s*\)/g)) add(m[1], m[2]);
  // ★ Java 形参 / 字段 / 局部变量 `Sink s` / `Tiered t = ...`（Java 没有 `:`，用「大写类型 + 空格 + 小写名」）
  for (const m of content.matchAll(/[(,]\s*([A-Z]\w*(?:<[^;)]{0,40}>)?)\s+([a-z_]\w*)\s*[,)]/g)) add(m[2], m[1]);
  for (const m of content.matchAll(/\b([A-Z]\w*)\s+([a-z_]\w*)\s*=/g)) add(m[2], m[1]);
  const out = new Map<string, ReceiverType | null>();
  for (const [name, m] of acc) out.set(name, m.size === 1 ? [...m.values()][0] : null);
  return out;
}

/**
 * 一次调用的建边判定。
 *
 * ★★ 总判据（用户 2026-10-21 定）：**错连比漏连坏** —— 错连会污染下游（影响面/读集/翻译册），
 *   漏连只是缺一条边、且能在 unresolved_refs 里查到原因。所以同文件 call 边的建边条件
 *   从「名字匹配」改成「**必须能证明**」；证不出来的一律不建边，落 unresolved_refs 并带标签。
 *
 * ★ 错在哪一层（先说清，别再往 AST 上想）：tree-sitter 产出的 AST 几乎不会错；错在**名字解析**——
 *   `TS_EXT_SET.has()` 与 `SkipDirSetImpl.has()` 名字对上了，接收者类型毫无关系。
 *   实测 2026-10-21：7,740 条 call 边里 33 条错连全属这一层。
 */
export type CallVerdict =
  /** 四类可证的调用之一，带 `proof` 说明凭什么 */
  | { kind: 'certain'; targetQn: string; proof: string }
  /** 需要类型信息才能判（不建边，标 suspect） */
  | { kind: 'suspect'; why: string }
  /** 动态派发（不建边，标 unknown） */
  | { kind: 'unknown'; why: string }
  /** 接收者类型明确是仓外类型（原型方法等）：**没有仓内目标**，不是漏连 */
  | { kind: 'external'; why: string }
  /** 本文件根本没有这个符号 ⇒ 不归本文件管（交给跨文件解析） */
  | { kind: 'none' };

/**
 * 裸名调用的可见性：只有**作用域链上**的符号才可能被裸名调到。
 *
 * 判据（可证）：
 *   · 顶层符号（qn 不含 `.`）→ 全文件可见；
 *   · 嵌套函数 `outer.inner` → 只有 `outer` 本身或其后代作用域里的调用能看见它；
 *   · 同类/外层类的成员（`Class.method` 从 `Class.other` 调）→ 隐式 this（Java 内部类/静态嵌套类同理）。
 *   ★ 反例（实测踩过）：`resolveRequestTarget` 里的裸名 `lookup()` 被连到 `requestPinned.lookup`，
 *     两者不在同一作用域链上 —— 旧逻辑只看名字，连错了。
 */
function visibleToCaller(callerQn: string, sym: ParsedSymbol): boolean {
  const qn = sym.qualified_name;
  if (!qn.includes('.')) return true;
  const parentQn = qn.slice(0, qn.lastIndexOf('.'));
  return callerQn === parentQn || callerQn.startsWith(`${parentQn}.`);
}

/**
 * 符号的所属类型是不是 `typeName`。
 * ★ parent 可能是**限定名**（Java 嵌套类 `Camprobe.Sink`、TS 的 `Outer.Inner`）⇒ 比尾段。
 *   踩过：只比 `parent === typeName` 会漏掉嵌套类型的所有成员。
 */
function ownerIs(sym: ParsedSymbol, typeName: string): boolean {
  const p = sym.parent;
  if (!p) return false;
  return p === typeName || p.split('.').pop() === typeName;
}

/** 调用者最近的类祖先（`Class.method` / `Class.method.inner` → Class） */
function enclosingClassOf(callerQn: string, symbols: readonly ParsedSymbol[]): ParsedSymbol | null {
  const parts = callerQn.split('.');
  for (let i = parts.length - 1; i >= 1; i--) {
    const qn = parts.slice(0, i).join('.');
    const hit = symbols.find((s) => s.qualified_name === qn && (s.kind === 'class' || s.kind === 'type'));
    if (hit) return hit;
  }
  return null;
}

/** 同文件基类链（只看 `class A extends B` 的 B，最多 6 跳）；跨文件父类看不见 ⇒ 返回空 */
function baseChainOf(content: string, symbols: readonly ParsedSymbol[], cls: ParsedSymbol): string[] {
  const lines = content.split('\n');
  const chain: string[] = [];
  let cur: string | null = cls.name;
  for (let hop = 0; hop < 6 && cur; hop++) {
    const node = symbols.find((s) => s.name === cur && (s.kind === 'class' || s.kind === 'type'));
    if (!node) break;
    const decl = lines.slice(Math.max(0, node.start_line - 1), node.start_line + 1).join('\n');
    const m = decl.match(/\bextends\s+([A-Za-z_$][\w$.]*)/);
    if (!m) break;
    const base = m[1].split('.').pop() as string;
    if (chain.includes(base)) break;
    chain.push(base);
    cur = base;
  }
  return chain;
}

/**
 * 三档判定（+ external / none）。
 *
 * 【确定】四类，每类都给出**可证依据**（proof 字符串会写进回执与测试）：
 *   1. `bare-visible` 裸名 foo()：本文件顶层，或调用者作用域链上的嵌套函数，且**恰好 1 个**候选。
 *      可证：JS/TS 的裸名解析就是沿作用域链查词法绑定，作用域链在 AST 上是确定的。
 *   2. `this-member`   this.foo()：foo 是**当前类**的成员（同文件 method 节点）。
 *      可证：`this` 的静态类型就是当前类，成员表是声明出来的事实。
 *   3. `this-base-member` this.foo()：foo 在当前类的**同文件基类**链上。
 *      可证：同链 2，只是多走一跳 `extends`；跨文件父类看不见 ⇒ 不证（落 suspect）。
 *   4. `typed-member`  x.foo()：x 的声明行能直接读出类型 T（注解 / new T / 形参标注 / Go `:=T{}`），
 *      且 T 是**本文件**的 class/interface/type，foo 是 T 的成员。
 *      可证：声明行是源码里的字面事实，T 的成员表是节点事实，两者都有据可查。
 *
 * 【疑似】suspect（不建边）：接收者类型读不出 / 链式 `a.b.c()` / 返回值上的属性 / 同名多候选 /
 *   裸名候选不在作用域链上 / `this` 成员不在本类与同文件基类里。
 * 【未知】unknown（不建边）：`obj[expr]()` 等动态派发。
 * 【仓外】external（不建边）：接收者类型明确是内置/容器/仓外类型（`Set`/`Map`/`T[]`/`Database`…），
 *   或有同名符号但**不属于该类型** —— 这时仓内根本没有目标，不是漏连。
 */
export function classifyCall(args: {
  content: string;
  symbols: readonly ParsedSymbol[];
  /** declaredReceiverTypes() 的结果（每个文件建一次） */
  receiverTypes: ReadonlyMap<string, ReceiverType | null>;
  /** 本文件的 import 列表（判「接收者是不是导入名」——那种 `X.foo()` 归跨文件解析） */
  imports: ReadonlyArray<{ bindings?: string[] }>;
  callerQn: string;
  callee: string;
  calleeExpr: string;
}): CallVerdict {
  const named = args.symbols.filter((s) => s.name === args.callee);
  const dot = lastReceiverDot(args.calleeExpr);

  // ── 裸名 ──
  if (dot < 0) {
    if (named.length === 0) return { kind: 'none' }; // 本文件没有 ⇒ 交给跨文件
    const visible = named.filter((s) => visibleToCaller(args.callerQn, s));
    if (visible.length === 1) return { kind: 'certain', targetQn: visible[0].qualified_name, proof: 'bare-visible' };
    if (visible.length === 0) return { kind: 'suspect', why: 'bare-not-in-scope' };
    return { kind: 'suspect', why: 'bare-ambiguous' };
  }

  const receiver = args.calleeExpr.slice(0, dot).trim();

  // ── this / self ──
  if (receiver === 'this' || receiver === 'self') {
    const cls = enclosingClassOf(args.callerQn, args.symbols);
    if (!cls) return { kind: 'unknown', why: 'this-without-class' };
    const own = named.filter((s) => ownerIs(s, cls.name));
    if (own.length === 1) return { kind: 'certain', targetQn: own[0].qualified_name, proof: 'this-member' };
    if (own.length > 1) return { kind: 'suspect', why: 'this-member-ambiguous' };
    for (const base of baseChainOf(args.content, args.symbols, cls)) {
      const hit = named.filter((s) => ownerIs(s, base));
      if (hit.length === 1) return { kind: 'certain', targetQn: hit[0].qualified_name, proof: 'this-base-member' };
    }
    return { kind: 'suspect', why: 'this-member-not-in-class-chain' };
  }

  // ── 简单标识符接收者 ──
  if (/^[A-Za-z_$][\w$]*$/.test(receiver)) {
    // 导入名（`import * as X` / 具名导入）上的成员 ⇒ 属于跨文件，本文件不建边
    const imported = args.imports.some((im) => (im.bindings ?? []).includes(receiver));
    if (imported) return { kind: 'none' };
    const asType = args.symbols.find(
      (s) => s.name === receiver && (s.kind === 'class' || s.kind === 'interface' || s.kind === 'type'),
    );
    const declared = args.receiverTypes.get(receiver) ?? null;
    if (declared === null && !asType) return { kind: 'suspect', why: 'receiver-type-unknown' };
    const typeName = (declared?.base ?? asType?.name) as string;
    if (declared?.array === true) return { kind: 'external', why: `container-receiver:${typeName}[]` };
    const isRepoType = args.symbols.some(
      (s) => s.name === typeName && (s.kind === 'class' || s.kind === 'interface' || s.kind === 'type'),
    );
    if (!isRepoType) return { kind: 'external', why: `receiver-type-external:${typeName}` };
    const members = named.filter((s) => ownerIs(s, typeName));
    if (members.length === 1) return { kind: 'certain', targetQn: members[0].qualified_name, proof: 'typed-member' };
    if (members.length > 1) return { kind: 'suspect', why: `typed-member-ambiguous:${typeName}` };
    return { kind: 'external', why: `member-not-of:${typeName}` };
  }

  // ── 其它接收者形态 ──
  if (receiver.includes('[')) return { kind: 'unknown', why: 'dynamic-index' };
  if (receiver.includes('(') || receiver.includes(')')) return { kind: 'suspect', why: 'call-result-receiver' };
  if (/^[0-9]|^['"`]|^\//.test(receiver)) return { kind: 'external', why: 'literal-receiver' };
  if (receiver.includes('.')) return { kind: 'suspect', why: 'chain-receiver' };
  return { kind: 'unknown', why: 'unclassified-receiver' };
}

/** 最后一个「顶层」点号（跳过括号/引号内部；没有返回 -1） */
function lastReceiverDot(expr: string): number {
  let depth = 0;
  let quote = '';
  let last = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === '.' && depth === 0) last = i;
  }
  return last;
}

/** 解析结果落库（体即原 syncFile 主体，逐行未动）；async / sync 两条路径共用 ⇒ 不会漂移 */
function applyParsedToIndex(db: Database, projectRoot: string, pre: SyncPrelude, parsed: ParsedFile): SyncFileResult {
  const { rel, fail, content, stat, hash, existing, ext } = pre;

  const now = Date.now();
  const lineCount = countLinesOf(content);
  const fileNodeId = rel;
  const lines = content.split('\n');

  // ── 符号级 diff（v3，事务外 CPU 计算）──
  // 删旧符号前读出旧 sym_hash 对比；与未消费的历史 diff 行链式合并（同一文件
  // 一个节流窗口内多次编辑 → 净差异 vA→vNow）。首次导入（无 files 行）不产出。
  const symHashList = parsed.symbols.map((s) => symbolSpanHash(lines, s.start_line, s.end_line, ext));
  // v4：全文归一化 hash——符号提取不含顶层 const/赋值表达式，常量值变更（FLAG=true→false）
  // 符号级零差异。norm 对比兜第二道判定：符号无差异且 norm 无差异才是纯注释/格式。
  const normHash = symbolSpanHash(lines, 1, lines.length, ext);
  const symbolDiff = (() => {
    if (!existing) return undefined;
    const oldSets = hashSetsOf(
      db
        .prepare("SELECT qualified_name, sym_hash FROM nodes WHERE file_path = $p AND kind != 'file'")
        .all({ p: rel }) as Array<{ qualified_name: string; sym_hash: string | null }>,
    );
    const newSets = new Map<string, Set<string>>();
    parsed.symbols.forEach((s, i) => {
      let set = newSets.get(s.qualified_name);
      if (!set) {
        set = new Set();
        newSets.set(s.qualified_name, set);
      }
      set.add(symHashList[i]);
    });
    const cur = new Map<string, SymbolStatus>();
    for (const [qn, hs] of newSets) {
      const old = oldSets.get(qn);
      if (!old) {
        cur.set(qn, 'added');
      } else if (old.size !== hs.size || [...hs].some((h) => !old.has(h))) {
        cur.set(qn, 'changed');
      }
    }
    for (const qn of oldSets.keys()) {
      if (!newSets.has(qn)) cur.set(qn, 'removed');
    }
    // 链式合并：上一份 diff 的 to_hash == 本次旧 content_hash → 无消费直连，合成净差异
    let from = existing.content_hash;
    let normFrom = existing.norm_hash ?? ''; // null（v4 前的旧行）= 未知 → 保守视为已变
    const stored = db
      .prepare('SELECT from_hash, to_hash, added, removed, changed, norm_from, norm_to FROM v_symbol_diffs WHERE file_path = $p')
      .get({ p: rel }) as
      | { from_hash: string; to_hash: string; added: string; removed: string; changed: string; norm_from: string; norm_to: string }
      | undefined;
    let net = cur;
    if (stored && stored.to_hash === existing.content_hash) {
      from = stored.from_hash;
      // norm 链式：起点链到最初版本的 norm_from（终点恒为新算的 normHash）
      if (stored.norm_from) normFrom = stored.norm_from;
      const prev = new Map<string, SymbolStatus>();
      for (const qn of JSON.parse(stored.added) as string[]) prev.set(qn, 'added');
      for (const qn of JSON.parse(stored.removed) as string[]) prev.set(qn, 'removed');
      for (const qn of JSON.parse(stored.changed) as string[]) prev.set(qn, 'changed');
      net = new Map<string, SymbolStatus>();
      for (const qn of new Set([...prev.keys(), ...cur.keys()])) {
        const m = mergeSymbolStatus(prev.get(qn), cur.get(qn));
        if (m) net.set(qn, m);
      }
    }
    const by = (st: SymbolStatus) => [...net.entries()].filter(([, s]) => s === st).map(([qn]) => qn).sort();
    return { from, added: by('added'), removed: by('removed'), changed: by('changed'), normFrom, normTo: normHash };
  })();

  // 批量事务（冷启 bootstrap 会开外层事务）时不再自己 BEGIN/COMMIT —— 见 db.ts beginBatch 注释
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN IMMEDIATE');
  try {
    // 0. files 行**最先写**（v16）：identifiers / imports / unresolved_refs / symbol_diffs 都要 file_id，
    //    而**首次索引**时 files 行还不存在 ⇒ 必须先 UPSERT 拿到 id，再往下写。
    //    ★ 原来这一步在第 5 步、且用 INSERT OR REPLACE（= DELETE+INSERT）——
    //      有了 ON DELETE CASCADE，那一下会把刚写进去的 identifiers / imports 一起带走。
    //    ★ ON CONFLICT DO UPDATE 而不是 REPLACE：同一个 path 的行**原地更新**，id 不变。
    const fileId = (
      db
        .prepare(
          `INSERT INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash)
           VALUES ($path, $hash, $lang, $size, $mtime, $ts, $nc, NULL, $nh)
           ON CONFLICT(path) DO UPDATE SET
             content_hash = excluded.content_hash, language = excluded.language,
             size = excluded.size, modified_at = excluded.modified_at,
             indexed_at = excluded.indexed_at, node_count = excluded.node_count,
             errors = NULL, norm_hash = excluded.norm_hash
           RETURNING id`,
        )
        .get({
          path: rel, hash, lang: ext, size: stat.size, mtime: Math.round(stat.mtimeMs),
          ts: now, nc: parsed.symbols.length, nh: normHash,
        }) as { id: number }
    ).id;

    // 1. 文件节点：UPSERT 不删除（保护指向它的 import 边不被级联带走）
    db.prepare(
      `INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, signature, docstring, updated_at)
       VALUES ($id, 'file', $nm, $qn, $fp, $lang, 1, $endLine, NULL, NULL, NULL, $ts)
       ON CONFLICT(id) DO UPDATE SET
         kind = 'file', name = excluded.name, language = excluded.language,
         start_line = 1, end_line = excluded.end_line, updated_at = excluded.updated_at`,
    ).run({ id: fileNodeId, nm: path.posix.basename(rel), qn: rel, fp: rel, lang: ext, endLine: lineCount, ts: now });

    // 2. 符号节点：整批删除重插。
    //    删除会经 edges.target 的 FK ON DELETE CASCADE 清掉【指向本文件符号的入边】
    //    （其他文件调用本文件，source 在外部文件）——这些边无法由本文件重解析恢复
    //    （对端的 unresolved_refs 已是 resolved，不会重试）。先备份，重插后还原。
    const backupInEdges = db
      .prepare(
        "SELECT source, target, kind, line, col, metadata FROM edges WHERE kind IN ('call','type_ref') AND target LIKE $tp AND source NOT LIKE $sp",
      )
      .all({ tp: `${rel}#%`, sp: `${rel}#%` }) as Array<{ source: string; target: string; kind: string; line: number; col: number | null; metadata: string | null }>;
    db.prepare("DELETE FROM nodes WHERE file_path = $p AND kind != 'file'").run({ p: rel });
    // ★ 2026-10-20：标识符位置表（全删全插；它跟着文件内容走）
    db.prepare('DELETE FROM identifiers WHERE file_id = $fid').run({ fid: fileId });
    const insIdent = db.prepare(
      'INSERT OR REPLACE INTO identifiers(file_id, name, kind, line, col, start_index, end_index) VALUES ($fid, $nm, $k, $ln, $col, $si, $ei)',
    );
    for (const idn of parsed.identifiers ?? []) {
      insIdent.run({ fid: fileId, nm: idn.name, k: idn.kind, ln: idn.line, col: idn.col, si: idn.start_index, ei: idn.end_index });
    }
    const insNode = db.prepare(
      `INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, signature, docstring, sym_hash, is_closure, members, params, return_type, type_params, modifiers, body_text, body_hash, updated_at)
       VALUES ($id, $k, $nm, $qn, $fp, $lang, $sl, $el, $par, $sig, $doc, $h, $isClos, $mem, $prms, $ret, $tps, $mods, $bdy, $bdyh, $ts)`,
    );
    const seenIds = new Set<string>();
    parsed.symbols.forEach((s, i) => {
      let id = `${rel}#${s.qualified_name}`;
      if (seenIds.has(id)) id = `${id}:L${s.start_line}`; // 文件内重名（如 TS 重载）
      seenIds.add(id);
      insNode.run({
        id: id, k: s.kind, nm: s.name, qn: s.qualified_name, fp: rel, lang: ext,
        sl: s.start_line, el: s.end_line, par: s.parent ?? null, sig: s.signature ?? null,
        // ★ 2026-10-21：docstring 首次落值 —— 文档注释原文（`kernel` 的 `docstringOf` 取，规则表在 `parse/symbol_docstring.ts`）。
        //   取不到 ⇒ null（**不是空串**）：该语言没登记规则 / 该符号确实没有文档，两种都写 NULL。
        doc: s.docstring ?? null,
        h: symHashList[i], isClos: s.is_closure ? 1 : 0, ts: now,
        // ★ 2026-10-20：类型成员（JSON）—— 没有就存 NULL（function 永远没有）
        mem: s.members && s.members.length ? JSON.stringify(s.members) : null,
        // ★ v13：函数/方法形参（JSON）—— **零参函数存 `[]`**（与“不是函数”的 NULL 区分开）；
        //   type/class 没有 `params` 字段 ⇒ NULL。
        prms: s.params ? JSON.stringify(s.params) : null,
        // ★ v14：返回类型 / 泛型参数 / 修饰符（`symbol_shape.ts` 唯一出处）——
        //   ★ 三态同 params：`[]` = 抽到了确实没有；NULL = 没抽到（不猜）。
        ret: s.returnType ?? null,
        tps: s.typeParams ? JSON.stringify(s.typeParams) : null,
        mods: s.modifiers ? JSON.stringify(s.modifiers) : null,
        // ★ v15：函数体原文 + 它的 sha1。
        //   ★ **原文照录**（见 kernel.ts 的 bodyTextOf）：不重排缩进、不去注释、不归一化空白 ——
        //     消费方要拿它当源码字节用；归一化会把"改了注释/格式"伪装成"没变"。
        //   ★ 取不到 ⇒ NULL（该节点没有体 / 该语言的体不是单一 AST 节点）；
        //     **绝不写空串** —— 空串会被读成"体确实是空的"，而那是我们不知道的事。
        bdy: s.bodyText ?? null,
        bdyh: s.bodyText ? contentHash(s.bodyText) : null,
      });
    });

    // 2.1 符号级 diff 落库（v3）：diffImpact 的波及源数据。首次导入 symbolDiff=undefined 不写
    if (symbolDiff) {
      db.prepare(
        `INSERT INTO symbol_diffs(file_id, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at)
         VALUES ($fid, $from, $to, $added, $removed, $changed, $nf, $nt, $ts)
         ON CONFLICT(file_id) DO UPDATE SET
           from_hash = excluded.from_hash, to_hash = excluded.to_hash,
           added = excluded.added, removed = excluded.removed, changed = excluded.changed,
           norm_from = excluded.norm_from, norm_to = excluded.norm_to, updated_at = excluded.updated_at`,
      ).run({
        fid: fileId, from: symbolDiff.from, to: hash,
        added: JSON.stringify(symbolDiff.added), removed: JSON.stringify(symbolDiff.removed), changed: JSON.stringify(symbolDiff.changed),
        nf: symbolDiff.normFrom, nt: symbolDiff.normTo,
        ts: now,
      });
    }

    // 2.5 还原入边：只还原 target 仍存在的（符号被删/改名的边任其正确消失）。
    //     FK 开启下 INSERT 会校验 target 存在性，必须先过滤否则整事务回滚。
    if (backupInEdges.length > 0) {
      const currentIds = new Set(
        (db.prepare("SELECT id FROM nodes WHERE file_path = $p AND kind != 'file'").all({ p: rel }) as Array<{ id: string }>).map((r) => r.id),
      );
      const insIn = db.prepare(
        'INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, $k, $ln, $col, $md)',
      );
      for (const e of backupInEdges) {
        if (currentIds.has(e.target)) insIn.run({ src: e.source, tgt: e.target, k: e.kind, ln: e.line, col: e.col, md: e.metadata });
      }
    }

    // 3. import 边：按 source 整批重插；目标未同步时建桩节点
    db.prepare("DELETE FROM edges WHERE source = $p AND kind = 'import'").run({ p: fileNodeId });
    const ensureStub = db.prepare(
      `INSERT OR IGNORE INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at)
       VALUES ($id, 'file', $nm, $qn, $fp, '', 0, 0, $ts)`,
    );
    const insEdge = db.prepare(
      'INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, $k, $ln, NULL, NULL)',
    );
    let edgeCount = 0;
    for (const imp of parsed.imports) {
      if (imp.kind !== 'relative') continue;
      // TS `import type` 运行时擦除——不建 import 边（依赖图/闭包不算依赖）
      if (imp.type_only) continue;
      const target = resolveImportTarget(projectRoot, rel, imp.source);
      if (!target) continue;
      ensureStub.run({ id: target, nm: path.posix.basename(target), qn: target, fp: target, ts: now });
      insEdge.run({ src: fileNodeId, tgt: target, k: 'import', ln: imp.line });
      edgeCount++;
    }

    // 3.5 调用边（同文件函数级，kind='call'；未解析的跨文件/外部调用进 unresolved_refs）
    db.prepare("DELETE FROM edges WHERE source LIKE $p AND kind = 'call'").run({ p: `${rel}#%` });
    db.prepare("DELETE FROM unresolved_refs WHERE from_node_id LIKE $p").run({ p: `${rel}#%` });
    const idOf = (qn: string) => `${rel}#${qn}`;
    // FK 防御：插边前校验两端 id 已在 nodes——符号提取器与调用边提取器的 qn
    // 算法曾不一致（FOREIGN KEY 炸整文件事务、符号零写入，2026-08-20
    // NodeSqliteAdapter.prepare.run 实证）。kernel v7 已对齐 qn，此处防御性
    // 兜底：坏边跳过，不再牵连整文件事务
    const nodeIdSet = new Set(
      (db.prepare('SELECT id FROM nodes WHERE file_path = $p').all({ p: rel }) as Array<{ id: string }>).map((r) => r.id),
    );
    const insCall = db.prepare(
      'INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, \'call\', $ln, NULL, NULL)',
    );
    const insUnresolved = db.prepare(
      `INSERT OR IGNORE INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail)
       VALUES ($from, $rn, 'call', $ln, 0, $fid, $lang, 'pending', $nt)`,
    );
    // ★ 2026-10-21 三档判定（判据见 classifyCall）：**建边必须能证明**；证不出的一律不建边，
    //   落 unresolved_refs 并把原因写进 candidates 列（`{verdict,why}`）——漏连不许静默消失。
    //   status：external = 目标在仓外（原型方法等，不是漏连）· failed = suspect/unknown（不重试）。
    const insUnresolvedTagged = db.prepare(
      `INSERT OR IGNORE INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail, candidates)
       VALUES ($from, $rn, 'call', $ln, 0, $fid, $lang, $st, $nt, $cd)`,
    );
    // 本文件的「局部名 → 声明类型」表：一次扫描，供判定逐调用查
    const receiverTypes = declaredReceiverTypes(content);
    // ★ 2026-10-22（DB 补全·调用边）：跨文件类型成员的两件工具 —— 判据见 makeImportedTypeMemberLookup。
    //   `relBound` = 本文件**相对导入**的绑定名（判「接收者本身就是导入的类名」）；
    //   `typeMemberOf` = 一跳相对导入 → 类型 → 成员（一次文件同步里共享 prepared statement 与类型名缓存）。
    const relBound = new Set<string>();
    for (const imp of parsed.imports) {
      if (imp.kind !== 'relative') continue;
      for (const b of imp.bindings ?? []) relBound.add(b);
    }
    const typeMemberOf = makeImportedTypeMemberLookup(
      db,
      projectRoot,
      rel,
      parsed.imports.filter((imp) => imp.kind === 'relative').map((imp) => imp.source),
    );
    const insCallCross = db.prepare(
      "INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, 'call', $ln, NULL, '{\"cross\":true}')",
    );
    /** FK 防御：目标符号此刻必须在 nodes 里（目标文件可能还没被索引到 ⇒ 不建边，留给跨文件那轮） */
    const targetNodeExists = db.prepare('SELECT 1 x FROM nodes WHERE id = $id');
    let crossTypeCount = 0;
    let callCount = 0;
    for (const c of parsed.calls) {
      const srcId = idOf(c.caller);
      if (!nodeIdSet.has(srcId)) continue; // qn 漂移坏边：跳过不炸事务
      // ★★★ 2026-10-27（T-#55）：**局部绑定（参数）** —— 解析期已判准（kernel 带作用域栈），
      //   这里直接落 `external` **说真话**：它不是符号、不建边，但**不是漏连**。
      //   ★ 为什么必须在解析期判：`new Promise((resolve, reject) => …)` 的箭头**没有名字**
      //     ⇒ 不进 `nodes` ⇒ 事后从库里反推**永远判不了**（实测 ~50 条卡在这）。
      if (c.local) {
        insUnresolvedTagged.run({
          from: srcId,
          rn: c.callee_expr,
          ln: c.line,
          fid: fileId,
          lang: ext,
          nt: c.callee,
          st: 'external',
          cd: JSON.stringify({ verdict: 'external', why: `local-binding:${c.caller}`, source: 'ast' }),
        });
        continue;
      }
      const verdict = classifyCall({
        content,
        symbols: parsed.symbols,
        receiverTypes,
        imports: parsed.imports,
        callerQn: c.caller,
        callee: c.callee,
        calleeExpr: c.callee_expr,
      });
      if (verdict.kind === 'certain') {
        if (nodeIdSet.has(idOf(verdict.targetQn))) {
          insCall.run({ src: srcId, tgt: idOf(verdict.targetQn), ln: c.line });
          callCount++;
        } else {
          // 证明成立但目标节点不在本次写入集（qn 漂移）⇒ 留 pending，让跨文件那轮再试
          insUnresolved.run({ from: srcId, rn: c.callee_expr, ln: c.line, fid: fileId, lang: ext, nt: c.callee });
        }
        continue;
      }
      // ★ 2026-10-22（DB 补全·调用边）：**仓内跨文件类型成员** —— 同文件那把尺只能说「这个类型不在本文件」，
      //   不等于「这个类型不在仓内」。两种形态同属一类（判据见 makeImportedTypeMemberLookup）：
      //     ① `reg.register()`：`reg` 的声明类型 T 声明在另一个文件 ⇒ classifyCall 报 receiver-type-external:T；
      //     ② `TSProbeCapture.pathFor()`：接收者本身就是**相对导入的类名** ⇒ classifyCall 报 none（交给跨文件）。
      //   本趟只做**快路径**（目标符号此刻已在库里就顺手建边）；其余一律落 pending + 类型提示，
      //   由收尾 `resolveCrossFileCalls` 定论（见 makeImportedTypeMemberLookup 的「两趟」段）。
      let crossType: string | null = null;
      if (verdict.kind === 'external' && verdict.why.startsWith('receiver-type-external:')) {
        crossType = verdict.why.slice('receiver-type-external:'.length);
      } else if (verdict.kind === 'none' && c.callee_expr.includes('.')) {
        const recv = c.callee_expr.slice(0, c.callee_expr.lastIndexOf('.')).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(recv) && relBound.has(recv)) crossType = recv;
      }
      if (crossType) {
        const look = typeMemberOf(crossType, c.callee);
        if (look.kind === 'hit' && targetNodeExists.get({ id: `${look.file}#${look.qn}` })) {
          insCallCross.run({ src: srcId, tgt: `${look.file}#${look.qn}`, ln: c.line });
          crossTypeCount++;
          continue;
        }
        // ★★ 证不出 / 目标文件此刻还没索引到 / 这个类型根本不在相对导入里 —— **三种情形都不在这趟定论**。
        //   为什么连 `no-type` 也要落 pending：冷重建是按路径顺序解析的，`watch_project_tool.ts` 常常
        //   先于它导入的 `probe.ts` 被解析 ⇒ 此刻「相对导入里没有这个类型」是**时限造成的**，不是事实。
        //   （实测代价：只给 hit 以外的情形落 pending 时，全量重建后 8 条边只建成 4 条，其余被永久盖成
        //    `dotted-unprovable`，与真相不符。）⇒ 一律 pending + 「接收者的声明类型」提示，交第二趟终审。
        insUnresolvedTagged.run({
          from: srcId,
          rn: c.callee_expr,
          ln: c.line,
          fid: fileId,
          lang: ext,
          nt: c.callee,
          st: 'pending',
          cd: JSON.stringify({
            verdict: 'external',
            why: `receiver-type-external:${crossType}`,
            receiver_type: crossType,
          }),
        });
        continue;
      }
      if (verdict.kind === 'none') {
        // 本文件没这个符号 ⇒ 交给跨文件解析（pending 是它的入口）
        insUnresolved.run({ from: srcId, rn: c.callee_expr, ln: c.line, fid: fileId, lang: ext, nt: c.callee });
        continue;
      }
      insUnresolvedTagged.run({
        from: srcId,
        rn: c.callee_expr,
        ln: c.line,
        fid: fileId,
        lang: ext,
        nt: c.callee,
        // ★★★ 2026-10-27（T-#68）：**`suspect` 不该落 `failed`，该落 `pending`**。
        //
        // ## 数据（T-#67 的两层对账，实测）
        //   suspect→external 331 · unknown→external 40 · suspect→resolved 40 · suspect→failed 24
        //   ⇒ **`suspect` 379 条里 355 条（94%）被跨文件层推翻** —— AST 的"我判不准"几乎没用。
        //
        // ## 为什么这是结构问题而不是调参
        // `suspect` 的语义是**"这一层判不准"** ⇒ 它**没有资格**把引用钉成 `failed`（那是"结论"）。
        // 原先落 `failed` ⇒ ① `failed` 里混进 94% 的假债（读数失真）；
        //              ② 靠 `retry_failed` 事后补救（补丁式）。
        // ⇒ 现在落 `pending`：**`failed` 只剩"跨文件层也救不回"** —— 一个**真正**的债指标。
        st: verdict.kind === 'external' ? 'external' : 'pending',
        // ★★ T-#66 **纠错**：这里**不能**标 `source: 'ast'`。
        //   我第一版给所有 `classifyCall` 判定都标了"AST 不可推翻" ⇒ 实测灾难：
        //   `JSON.stringify` / `lines.push` 这类被 `classifyCall` 判成 `suspect`（**它判不准**），
        //   而 `resolveCrossFileCalls` 本来能纠正成 `external: builtin-*`
        //   ⇒ 被我一锁 ⇒ **failed 暴涨到 11322**。
        //   ★ 正确边界：**只有「AST 独有的事实」才不可推翻**（如 `local-binding` —— DB 层永远判不出
        //     「这个名字是某函数的参数」）。而 `suspect` 是**「我判不准」**，必须允许被更好的判定纠正。
        cd: JSON.stringify({ verdict: verdict.kind, why: verdict.why }),
      });
    }

    // 3.6 类型引用边（kind='type_ref'：引用者函数/类 → 被引用 interface/type/class 符号）。
    //     波及语义：改类型定义 → 引用者受影响。跨文件引用进 unresolved_refs，
    //     收尾 resolveCrossFileCalls 沿 imports 解析（目标限定 interface/type/class）。
    db.prepare("DELETE FROM edges WHERE source LIKE $p AND kind = 'type_ref'").run({ p: `${rel}#%` });
    db.prepare(
      "DELETE FROM unresolved_refs WHERE from_node_id LIKE $p AND reference_kind = 'type_ref'",
    ).run({ p: `${rel}#%` });
    const insTypeRef = db.prepare(
      "INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, 'type_ref', $ln, NULL, NULL)",
    );
    const insUnresolvedType = db.prepare(
      `INSERT OR IGNORE INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail)
       VALUES ($from, $rn, 'type_ref', $ln, 0, $fid, $lang, 'pending', $nt)`,
    );
    for (const t of parsed.type_refs) {
      const srcId = idOf(t.referrer);
      if (!nodeIdSet.has(srcId)) continue; // 同上：qn 漂移坏边防御
      if (t.resolved && t.target_qn && nodeIdSet.has(idOf(t.target_qn))) {
        insTypeRef.run({ src: srcId, tgt: idOf(t.target_qn), ln: t.line });
      } else {
        insUnresolvedType.run({ from: srcId, rn: t.type_name, ln: t.line, fid: fileId, lang: ext, nt: t.type_name });
      }
    }

    // 4. 原始 import 记录（全量种类：relative + package）
    //    import_project 缓存路径靠它重建依赖边——edges 表只有已解析的相对导入，
    //    Go 包路径 / Python 点分模块的原始 source 串只存在这里
    db.prepare('DELETE FROM imports WHERE file_id = $fid').run({ fid: fileId });
    const insImport = db.prepare('INSERT INTO imports(file_id, line, source, kind, type_only, bindings, start_index, end_index) VALUES ($fid, $ln, $src, $kind, $typeOnly, $bindings, $si, $ei)');
    for (const imp of parsed.imports) {
      insImport.run({
        fid: fileId,
        ln: imp.line,
        src: imp.source,
        kind: imp.kind,
        typeOnly: imp.type_only ? 1 : 0,
        // ★ v9：本地绑定名（JSON 数组）；无绑定存 NULL（不是 '[]'——"没有"与"空数组"在语义上要能区分）
        bindings: imp.bindings && imp.bindings.length > 0 ? JSON.stringify(imp.bindings) : null,
        // ★ 2026-10-20：整句 span（解析器没给就读 NULL —— 不猜）
        si: imp.start_index ?? null,
        ei: imp.end_index ?? null,
      });
    }

    // 5. files 行：**已经移到第 0 步**（必须先拿到 fileId）—— 原来这里那条 INSERT OR REPLACE
    //    会在事务末尾把 files 行删了重插，v16 起会经 ON DELETE CASCADE 清掉本文件所有子行。

    if (ownTx) db.exec('COMMIT');
    return {
      path: rel, status: 'updated', node_count: parsed.symbols.length, edge_count: edgeCount, call_count: callCount,
      cross_type_edges: crossTypeCount,
      symbol_diff: symbolDiff
        ? { added: symbolDiff.added.length, removed: symbolDiff.removed.length, changed: symbolDiff.changed.length }
        : undefined,
    };
  } catch (e) {
    if (ownTx) db.exec('ROLLBACK');
    return fail((e as Error).message);
  }
}

/** 单文件同步（async，经典路径）：parseFileFull 懒加载解析器（首次该语言有一次 import 成本） */
export async function syncFile(db: Database, projectRoot: string, absPath: string): Promise<SyncFileResult> {
  invalidateProjectView(projectRoot); // ★ 写路径挂钩：磁盘要变了 ⇒ ProjectView 缓存失效
  const p = syncFilePrelude(db, projectRoot, absPath);
  if (!p.ok) return p.early;
  const parsed = await parseFileFull(absPath, p.pre.content);
  if (parsed.error) {
    // 不写 files 行：下次运行 hash 比对不到记录，自动重试
    return p.pre.fail(parsed.error);
  }
  return applyParsedToIndex(db, projectRoot, p.pre, parsed);
}

/**
 * 单文件同步（sync，⑤ 同步写穿 2026-09-15）：预热后全程无 await。
 * 解析器未预热 ⇒ 返回 failed（error 注明"解析器未预热"）——调用方
 * （write_gate 的预热闸）应在调用前用 `canParseFileSync` 拦下，这里只是兜底。
 */
export function syncFileSync(db: Database, projectRoot: string, absPath: string): SyncFileResult {
  invalidateProjectView(projectRoot); // ★ 同上（同步版）
  const p = syncFilePrelude(db, projectRoot, absPath);
  if (!p.ok) return p.early;
  const parsed = parseFileFullSync(absPath, p.pre.content);
  if (parsed.error) return p.pre.fail(parsed.error);
  return applyParsedToIndex(db, projectRoot, p.pre, parsed);
}

// ─────────────────────────────────────────────────────────────
// 引用方重解析（2026-09-14 实测修正）
// ─────────────────────────────────────────────────────────────

/**
 * 把"指向某些符号名"的已解析引用**重新打开**（`resolved` → `pending`），交给
 * `resolveCrossFileCalls` 重新解析一遍。
 *
 * 为什么需要（修正后的准确描述）：
 *   有人**在编辑器里**（不经 `rename_symbols`）把 B 的符号改名/删掉时：
 *   - B 的旧符号节点被删 ⇒ `edges` 的 `FOREIGN KEY … ON DELETE CASCADE` **自动删掉**
 *     引用方 A 指向它的边 ⇒ **不会出现"悬空边"**（早先的判断有误，实测证伪）；
 *   - 但 A 没变、不会被重解析 ⇒ **它的边被删掉后不会重建** ⇒ `find_references`/`impact`
 *     在 A 这个方向上**漏报**（静默少一条引用）。
 *   ⇒ 正解不是"清悬空边"，而是**把 A 的这条引用重新打开、让它重解析**：
 *     要么连到新符号（同名仍在），要么明确标 `failed`（A 的文本确实失效了）。
 *
 * 只动 `unresolved_refs` 的 status（纯 SQL，不解析任何文件）。
 */
export interface ReopenRefsResult {
  /** 被重新打开的引用行数 */
  reopened: number;
  /**
   * ★ 这些引用**所在的文件**（相对路径，去重）。
   * 为什么必须返回：调用方（watch / 保鲜）接下来要跑 `resolveCrossFileCalls`，而它按 `scopeFiles`
   * 收窄范围 —— 被重开的引用行属于**引用方文件**（它自己没变、本轮没同步），若不放宽 scope，
   * 这些行就只会一直停在 pending，等于"打开了却不解析"，白改一场。
   */
  files: string[];
}

export function reopenRefsTo(db: Database, names: readonly string[]): ReopenRefsResult {
  const wanted = [...new Set(names.filter(Boolean))];
  if (!wanted.length) return { reopened: 0, files: [] };
  // 该名字现在**在索引里还存在**吗？（决定要不要把 failed 的也一并重试 ——
  // 符号改名后又改回来 / 搬到别的文件时，之前标 failed 的引用应该有机会重连；
  // 名字彻底消失了就别每轮空转，尊重"failed 不再重试"的原设计。）
  const exists = db.prepare('SELECT 1 x FROM nodes WHERE name = ? LIMIT 1');
  const pick = db.prepare(
    `SELECT from_node_id FROM unresolved_refs
     WHERE reference_name = $nm
       AND (status = 'resolved' OR (status = 'failed' AND $retryFailed))`,
  );
  const upd = db.prepare(
    `UPDATE unresolved_refs SET status = 'pending'
     WHERE reference_name = $nm
       AND (status = 'resolved' OR (status = 'failed' AND $retryFailed))`,
  );
  const files = new Set<string>();
  let n = 0;
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN IMMEDIATE');
  try {
    for (const nm of wanted) {
      const back = !!exists.get(nm);
      // ⚠️ node:sqlite 的命名参数键不能是纯数字（曾用 `{1: nm}` → Unknown named parameter '1'，
      //    而外层 try/catch 把它吞成了 refsReopened=0 ⇒ 静默失效。教训：被吞的异常要能看见。）
      const args = { nm, retryFailed: back ? 1 : 0 };
      for (const r of pick.all(args) as Array<{ from_node_id: string }>) {
        files.add(r.from_node_id.split('#')[0]);
      }
      n += Number(upd.run(args).changes ?? 0);
    }
    if (ownTx) db.exec('COMMIT');
  } catch (e) {
    if (ownTx) db.exec('ROLLBACK');
    throw e;
  }
  return { reopened: n, files: [...files] };
}

/**
 * 读取某文件最近一次同步记录里"存在性有变动"的符号名：
 * `added`（新出现/搬进来）+ `removed`（消失）+ `changed`（改了）。
 * 三个都收：`added` 用来让"符号改名又改回来 / 搬到别的文件"的**失败引用有机会重连**
 * （`reopenRefsTo` 里用"名字现在是否还在索引里"决定要不要重试 failed）—— 见该函数注释。
 */
export function changedSymbolNames(db: Database, rel: string): string[] {
  try {
    const row = db.prepare('SELECT added, removed, changed FROM v_symbol_diffs WHERE file_path = $p').get({ p: rel }) as
      | { added: string; removed: string; changed: string }
      | undefined;
    if (!row) return [];
    const out: string[] = [];
    for (const col of [row.added, row.removed, row.changed]) {
      try {
        for (const nm of JSON.parse(col) as string[]) out.push(nm.split('.').pop() ?? nm); // qualified_name → 短名
      } catch {
        /* 单列坏数据不影响整体 */
      }
    }
    return [...new Set(out)];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 项目级批量同步 / 移除
// ─────────────────────────────────────────────────────────────

/** 顺序同步一组文件（解析是 CPU 活，v1 串行即可；规模大了再加并发池） */
/** 文件指纹快照：path → content_hash（逐文件，用于算"这次扫描改了什么"）*/
function snapshotHashes(db: Database): Map<string, string> {
  const m = new Map<string, string>();
  const rows = db.prepare('SELECT path, content_hash FROM files').all() as Array<{
    path: string;
    content_hash: string | null;
  }>;
  for (const r of rows) m.set(r.path, r.content_hash ?? '');
  return m;
}

/**
 * ★★ 2026-10-23（§7「两个时间参照」）：写一条扫描台账 + **逐文件**变更。
 *
 * ## 为什么不需要"上次快照表"
 * `files` 表只有**现在**。但一次 `syncProject` 的**内部**天然有"前"和"后"两个时刻：
 * 进来时读一次、出去时再读一次，两者之差就是"这次改了什么"。
 * ⇒ 存这个差，就不必存每次的完整快照（540 行 × N 次会膨胀），而信息量等价。
 *
 * ## 为什么 `scan_changes.path` 不是外键
 * `removed` 的文件**已经不在 files 表里**，没有 id 可挂。这是本表与其它表的关键区别。
 */
function recordScanRun(
  db: Database,
  before: Map<string, string>,
): { added: number; changed: number; removed: number } {
  const after = snapshotHashes(db);
  const rows: Array<{ path: string; kind: string; b: string | null; a: string | null }> = [];
  for (const [p, h] of after) {
    const b = before.get(p);
    if (b === undefined) rows.push({ path: p, kind: 'added', b: null, a: h });
    else if (b !== h) rows.push({ path: p, kind: 'changed', b, a: h });
  }
  for (const [p, h] of before) if (!after.has(p)) rows.push({ path: p, kind: 'removed', b: h, a: null });

  const added = rows.filter((r) => r.kind === 'added').length;
  const changed = rows.filter((r) => r.kind === 'changed').length;
  const removed = rows.filter((r) => r.kind === 'removed').length;

  const info = db
    .prepare(
      'INSERT INTO scan_runs(at, files_before, files_after, added, changed, removed) VALUES(?,?,?,?,?,?)',
    )
    .run(new Date().toISOString(), before.size, after.size, added, changed, removed);
  const scanId = Number(info.lastInsertRowid);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO scan_changes(scan_id, path, kind, before_hash, after_hash) VALUES(?,?,?,?,?)',
  );
  for (const r of rows) ins.run(scanId, r.path, r.kind, r.b, r.a);
  return { added, changed, removed };
}

export async function syncProject(
  db: Database,
  projectRoot: string,
  absPaths: string[],
): Promise<SyncProjectResult> {
  const t0 = Date.now();
  // ★ §7：进来先拍一张"前"的快照（只读 files 表，很便宜）
  const before = snapshotHashes(db);
  const results: SyncFileResult[] = [];
  for (const p of absPaths) {
    results.push(await syncFile(db, projectRoot, p));
  }
  const by = (s: SyncStatus) => results.filter((r) => r.status === s).length;
  // 收尾：跨文件调用解析（同文件未命中的调用沿 imports 解析到目标文件符号；幂等，只处理 pending）
  const cross = resolveCrossFileCalls(db, projectRoot);
  // ★ §7：出去再拍一张，差写进 scan_runs / scan_changes（逐文件）
  const changes = recordScanRun(db, before);
  return {
    total: results.length,
    updated: by('updated'),
    skipped: by('skipped'),
    ignored: by('ignored'),
    failed: by('failed'),
    ms: Date.now() - t0,
    results,
    changes,
    cross: {
      total: cross.total,
      resolved: cross.resolved,
      external: cross.external,
      failed: cross.failed,
      // ★ 2026-10-22：跳过多少必须跟连上多少一起报（这张就是 sync 回执）—— 不许只报 resolved
      reexportSkipped: cross.reexportSkipped,
    },
  };
}

/** 按相对路径删除一个文件的全部缓存行（nodes 级联清边与 FTS） */
function removeFileRel(db: Database, rel: string): void {
  db.prepare('DELETE FROM nodes WHERE file_path = $p').run({ p: rel });
  // ★ v16：identifiers / imports / unresolved_refs / symbol_diffs 都挂在 files(id) 的 ON DELETE CASCADE 上
  //   ⇒ 删 files 行这一条就够，**不能再按 file_path 删**（那几列已经不存在）。
  //   ★ 旧代码在这里**漏了 identifiers**（当时它没有外键，删了 files 行也带不走）—— 实测在本库留下
  //     201 条残行：scripts/check_lang_pkgs.mjs 157 行、src/infrastructure/analysis/diagnosis/test_contract.ts 44 行，
  //     正是 v16 迁移必须丢掉的那批。这段注释就是防止有人把 CASCADE 换回手写 DELETE 时再漏表。
  db.prepare('DELETE FROM files WHERE path = $p').run({ p: rel });
}

/** 文件从项目删除时调用：清节点（级联清边与 FTS）+ files 行 + 原始 import 记录 */
export function removeFile(db: Database, projectRoot: string, absPath: string): void {
  removeFileRel(db, toRelPath(projectRoot, absPath));
}

// ─────────────────────────────────────────────────────────────
// 跨文件调用解析（路线图序号 3 第二步）
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Go 同包 · barrel re-export（2026-10-21）
// ─────────────────────────────────────────────────────────────

/**
 * Go 文件的 package 子句（「同一个包」的判据 = **同目录 + package 子句同名**）。
 *
 * 为什么两半都要：Go 规定一个目录只能有一个包，但外部测试包 `foo_test` 会打破这个假设 ——
 * 只看目录会把 `_test` 里的裸名连到主包的私有函数上（那是**误连**，比缺边更坏）。
 * 按 mtime 缓存：每批解析都要判，31 个 Go 文件不值得每次全读。
 */
const goPackageCache = new Map<string, { mtimeMs: number; pkg: string | null }>();
function goPackageName(projectRoot: string, rel: string): string | null {
  const key = `${projectRoot}|${rel}`;
  const abs = path.join(projectRoot, rel);
  const st = fs.statSync(abs);
  const hit = goPackageCache.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.pkg;
  const m = fs.readFileSync(abs, 'utf8').match(/^\s*package\s+([A-Za-z_]\w*)/m);
  const pkg = m ? m[1] : null;
  goPackageCache.set(key, { mtimeMs: st.mtimeMs, pkg });
  return pkg;
}

/**
 * Go 同包互调：裸名调用 → **同目录且 package 子句同名**的其它文件里的同名符号。
 *
 * ★ 成因（实测 2026-10-21）：`relImportsByFile` 只装 kind='relative'，而 Go 是 package 导入
 *   ⇒ 同包其它文件的函数**结构上永远进不了** import 表 ⇒ 83 条同包互调全丢。
 * ★ 命中数必须**恰好 1**：0 条 = 没有；>1 条 = 同包重名（Go 不允许，真出现就**不猜**）。
 */
function findGoSamePackageTarget(
  db: Database,
  fromRel: string,
  name: string,
  kinds: readonly string[],
  goFilesByDir: ReadonlyMap<string, ReadonlyArray<{ file: string; pkg: string }>>,
): { file: string; qn: string } | null {
  if (!fromRel.endsWith('.go')) return null;
  const group = goFilesByDir.get(path.posix.dirname(fromRel));
  if (!group) return null;
  const fromPkg = group.find((e) => e.file === fromRel)?.pkg ?? null;
  if (!fromPkg) return null;
  const hits: Array<{ file: string; qn: string }> = [];
  for (const e of group) {
    if (e.file === fromRel || e.pkg !== fromPkg) continue;
    const row = db
      .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $f AND name = $n LIMIT 1')
      .get({ f: e.file, n: name }) as { kind: string; qualified_name: string } | undefined;
    if (row && kinds.includes(row.kind)) hits.push({ file: e.file, qn: row.qualified_name });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * barrel 的一条转发：来源模块 + **来源模块里的真名**。
 *
 * ★ 为什么必须记真名（2026-10-22）：`import { escapeHtml as esc } from './x'; export { esc }`
 *   导出的名字（esc）在 `./x` 里**不是节点** —— 只有 `escapeHtml` 是。旧表只记「导出名 → 模块」，
 *   解析时拿 esc 去 `./x` 查 ⇒ 永远查不到（别名再导出整族都落在这）。
 */
interface ReexportSource {
  /** import/export 的 source 字面量（未解析） */
  source: string;
  /** 源模块里那个符号的真名（`A as B` ⇒ A；无别名 ⇒ 导出名本身） */
  imported: string;
  /** from = `export … from './x'`；alias = 本地 import 别名后再 `export { 本地名 }` */
  form: 'from' | 'alias';
}

/** re-export 没建边的原因（★ 出口而不是丢弃：跳过多少必须能和连上多少一起报） */
interface ReexportMiss {
  why: string;
  detail?: string;
}

/** barrel 的转发表：导出名 → 来源；`export * from` 单独记 */
interface ReexportIndex {
  named: Map<string, ReexportSource[]>;
  stars: string[];
  /** 认得但**不能连**的导出名 → 原因（resolve 时原样回传成 failed 的 why，不静默） */
  skipped: Map<string, string>;
}
const reexportCache = new Map<string, { mtimeMs: number; idx: ReexportIndex }>();

/**
 * 抽 import/export 前先**去掉注释**。
 *
 * ★ 2026-10-22 实测踩到：本文件的文档注释里写了 `import { A as B } ... export { B }`
 *   三种形态作示例 ⇒ 按原文正则会把**注释**当成真转发（symbols.ts 里凭空多出
 *   esc / B / C 三条来源 `./x` 的转发，且 B/C 这种单字母名会把全仓同名调用误连过去）。
 * ★ 只处理 `//` 与块注释；字符串里的 `//`（`http://`）用 `(?<!:)` 放过 —— 误伤只会「少识别」，
 *   不会凭空造出一条转发（方向与「宁漏不错」一致）。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<!:)\/\/[^\n]*/g, '');
}

function reexportsOf(projectRoot: string, rel: string): ReexportIndex {
  const key = `${projectRoot}|${rel}`;
  const abs = path.join(projectRoot, rel);
  const st = fs.statSync(abs);
  const hit = reexportCache.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.idx;
  const text = stripComments(fs.readFileSync(abs, 'utf8'));
  const named = new Map<string, ReexportSource[]>();
  const stars: string[] = [];
  const skipped = new Map<string, string>();
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const push = (exported: string, src: ReexportSource): void => {
    const arr = named.get(exported) ?? [];
    arr.push(src);
    named.set(exported, arr);
  };
  /** `A as B` ⇒ [A, B]；无别名 ⇒ [x, x] */
  const splitAlias = (item: string): [string, string] => {
    const parts = item.split(/\s+as\s+/);
    return parts.length === 2 ? [parts[0].trim(), parts[1].trim()] : [item, item];
  };

  // ① `export { A as B } from './x'` / `export { A } from './x'`
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const [imported, exported] = splitAlias(item);
      if (!IDENT.test(exported) || !IDENT.test(imported)) continue;
      // ★ `default` 不是 nodes 里的名字（匿名 default 根本没有节点）⇒ 不猜，标 skip
      if (imported === 'default') {
        skipped.set(exported, 'default-export');
        continue;
      }
      push(exported, { source: m[2], imported, form: 'from' });
    }
  }

  // 本地绑定：`import { A as B } from './x'` / `import * as ns from './x'`
  const localImports = new Map<string, { source: string; imported: string }>();
  const nsImports = new Map<string, string>();
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const [imported, local] = splitAlias(item);
      if (IDENT.test(local) && IDENT.test(imported)) localImports.set(local, { source: m[2], imported });
    }
  }
  for (const m of text.matchAll(/import\s+(?:type\s+)?\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g)) {
    nsImports.set(m[1], m[2]);
  }

  // ② ★★ 别名再导出（本轮新增）：`export { B }` / `export { B as C }`（**没有 from**）
  //   判据 = 「B 在本文件是 import 绑定」—— 查 `localImports` 这张表，不是猜同名。
  //   `import { A as B } from './x'; export { B }` ⇒ B（或 C）在仓外的真名是 **A**。
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from\b)/g)) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim().replace(/^type\s+/, '');
      if (!item) continue;
      const [local, exported] = splitAlias(item);
      if (!IDENT.test(exported)) continue;
      const bound = localImports.get(local);
      if (bound) {
        push(exported, { source: bound.source, imported: bound.imported, form: 'alias' });
        continue;
      }
      if (nsImports.has(local)) {
        // `import * as ns; export { ns }` = 导出**模块对象**，`ns` 不是符号 ⇒ 接不上单个节点
        skipped.set(exported, 'namespace-object');
      }
      // 本地声明再导出（`const X` / `function X`）不是「再导出」：X 在本文件有节点，
      // consumer 侧由「目标文件直接命中」那条路解决 —— 不记 named，也不标 skip。
    }
  }

  // ★ `export * as ns from './x'`：只暴露 `ns.foo`，不导出单个名字（跟着连会连错）
  for (const m of text.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g)) {
    skipped.set(m[1], 'namespace-object');
  }
  // ★ 只认 `export * from`
  for (const m of text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) stars.push(m[1]);

  const idx: ReexportIndex = { named, stars, skipped };
  reexportCache.set(key, { mtimeMs: st.mtimeMs, idx });
  return idx;
}

/**
 * 沿 barrel 的 re-export 找符号（最多两跳：`index.ts → sub/index.ts → kernel.ts`）。
 *
 * ★ 别名形态（2026-10-22）：`import { A as B } from './x'; export { B }` —— 导出名 B 在 `./x`
 *   里**没有节点**，真名是 A。判据落在 `ReexportSource.imported` 上：去来源文件查的是 **A**；
 *   查不到就标 skip（**绝不拿 B 去猜**）。`export { B as C }` 同理：C 对外叫 C，仓内真名仍是 A。
 * ★ 歧义判据（**不猜**）：候选（`file#qn`）去重后必须**恰好 1 个**；0 个 = 没找到，>1 个 = barrel 里
 *   同名冲突（`export { x } from './a'` + `export { x } from './b'`）⇒ 返回 null，调用方保持 failed。
 * ★ `miss` 是**出口**：每条没建边的原因（歧义 / 目标不在仓内 / 目标未索引 / 符号不存在 / skip 标签）
 *   都往里投 —— 「跳过多少」必须能和「连上多少」一起报，不许静默。
 */
function resolveReexportTarget(
  db: Database,
  projectRoot: string,
  barrelRel: string,
  name: string,
  namesByFile: Map<string, Set<string>>,
  kinds?: readonly string[],
  depth: number = 0,
  seen: Set<string> = new Set(),
  miss?: ReexportMiss[],
  indexedFiles?: ReadonlySet<string>,
): { file: string; qn: string } | null {
  if (depth > 2 || seen.has(barrelRel)) return null;
  seen.add(barrelRel);
  const idx = reexportsOf(projectRoot, barrelRel);
  const sources: ReexportSource[] = [
    ...(idx.named.get(name) ?? []),
    ...idx.stars.map((s) => ({ source: s, imported: name, form: 'from' as const })),
  ];
  if (sources.length === 0) {
    const why = idx.skipped.get(name);
    if (why) miss?.push({ why: `reexport-${why}`, detail: barrelRel });
    return null;
  }
  const found = new Map<string, { file: string; qn: string }>();
  for (const src of sources) {
    // 包名 / 根外路径：目标在仓外 —— 这是 external 的语义，不是漏连
    if (!src.source.startsWith('.')) {
      miss?.push({ why: 'reexport-target-outside-repo', detail: `${barrelRel} → ${src.source}` });
      continue;
    }
    const target = resolveImportTarget(projectRoot, barrelRel, src.source);
    if (!target || target === barrelRel) {
      miss?.push({ why: 'reexport-target-not-found', detail: `${barrelRel} → ${src.source}` });
      continue;
    }
    // ★ 盘上有、索引里没有（`../dist/...` 这类）：与「符号不存在」分开报
    if (indexedFiles && !indexedFiles.has(target)) {
      miss?.push({ why: 'reexport-target-not-indexed', detail: `${barrelRel} → ${target}` });
      continue;
    }
    if (namesByFile.get(target)?.has(src.imported)) {
      const q = db
        .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $tp AND name = $n LIMIT 1')
        .get({ tp: target, n: src.imported }) as { kind: string; qualified_name: string } | undefined;
      if (!q) {
        miss?.push({ why: 'reexport-source-lookup-missed', detail: `${target}#${src.imported}` });
      } else if (kinds && !kinds.includes(q.kind)) {
        miss?.push({ why: 'reexport-kind-mismatch', detail: `${target}#${src.imported}(${q.kind})` });
      } else {
        found.set(`${target}#${q.qualified_name}`, { file: target, qn: q.qualified_name });
      }
      continue;
    }
    const before = miss?.length ?? 0;
    const nested = resolveReexportTarget(
      db, projectRoot, target, src.imported, namesByFile, kinds, depth + 1, seen, miss, indexedFiles,
    );
    if (nested) {
      found.set(`${nested.file}#${nested.qn}`, nested);
    } else if (miss && miss.length === before) {
      // 下一层没给原因（超深 / 成环）—— 本层补上，不漏账
      miss.push({ why: 'reexport-chain-unresolved', detail: `${target}#${src.imported}` });
    }
  }
  if (found.size === 0) return null;
  if (found.size > 1) {
    miss?.push({
      why: 'reexport-ambiguous',
      detail: [...found.values()].map((v) => `${v.file}#${v.qn}`).join(' | '),
    });
    return null;
  }
  return [...found.values()][0];
}

/**
 * 文件内「命名空间导入」：本地名 → 来源模块（只认 `import * as X from './y'`）。
 * ★ 为什么它可证：`X.foo()` 里 X 的静态类型就是模块对象，成员表就是该模块的导出表 ——
 *   两样都是声明出来的事实。`export * as ns from` 不算（那是再导出，不是本地绑定）。
 */
const nsImportCache = new Map<string, { mtimeMs: number; map: Map<string, string[]> }>();
function namespaceImportsOf(projectRoot: string, rel: string): Map<string, string[]> {
  const key = `${projectRoot}|${rel}`;
  const abs = path.join(projectRoot, rel);
  const st = fs.statSync(abs);
  const hit = nsImportCache.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.map;
  const text = fs.readFileSync(abs, 'utf8');
  const map = new Map<string, string[]>();
  for (const m of text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g)) {
    const arr = map.get(m[1]) ?? [];
    arr.push(m[2]);
    map.set(m[1], arr);
  }
  nsImportCache.set(key, { mtimeMs: st.mtimeMs, map });
  return map;
}

/**
 * 文件内「动态 import 解构」：本地名 → 来源（`const { a, b } = await import('./x')`）。
 * ★ 为什么需要：这类名字不在静态 import 表里，但**来源是写死在源码里的** ⇒ 照样可证。
 */
const dynImportCache = new Map<string, { mtimeMs: number; map: Map<string, string[]> }>();
function dynamicImportsOf(projectRoot: string, rel: string): Map<string, string[]> {
  const key = `${projectRoot}|${rel}`;
  const abs = path.join(projectRoot, rel);
  const st = fs.statSync(abs);
  const hit = dynImportCache.get(key);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.map;
  const text = fs.readFileSync(abs, 'utf8');
  const map = new Map<string, string[]>();
  for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]/g)) {
    for (const raw of m[1].split(',')) {
      const nm = raw.split(':').pop()?.trim();
      if (!nm || !/^[A-Za-z_$][\w$]*$/.test(nm)) continue;
      const arr = map.get(nm) ?? [];
      arr.push(m[2]);
      map.set(nm, arr);
    }
  }
  dynImportCache.set(key, { mtimeMs: st.mtimeMs, map });
  return map;
}

/**
 * ★★★ 2026-10-27（T-#64）：**`dynamicImportsOf()` 已删除**。
 *
 * 它原先用一条文本正则去扫 `const { a } = await import('x')`：
 *   `/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]/g`
 * ⇒ 脆（换行/别名/字串都会漏），且**与索引是两套尺**。
 * 现在动态 import 在**解析期**就被记成 `imports` 行（`module_analysis.handleDynamicImport`），
 * 走的是与静态 import **完全同一张**绑定表（`relImportsByFile` / `relBindingsByFile`）。
 * ★ 保留这个空壳只为让历史读者知道“它去哪了”—— 删掉的是**两套尺**，不是能力。
 */

/**
 * `X.foo()` 且 X 是 `import * as X` ⇒ 目标模块里的**可调用**符号（唯一才建边）。
 * ★ 限度：若同名符号有多个、或模块里没有 ⇒ 不建边（留 external，宁漏不错）。
 */
function findNamespaceMemberTarget(
  db: Database,
  projectRoot: string,
  fromRel: string,
  expr: string,
): { file: string; qn: string } | null {
  const dot = lastReceiverDot(expr);
  if (dot < 0) return null;
  const head = expr.slice(0, dot).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(head)) return null;
  const sources = namespaceImportsOf(projectRoot, fromRel).get(head);
  if (!sources) return null;
  const member = expr.slice(dot + 1).replace(/\(.*$/, '');
  const hits: Array<{ file: string; qn: string }> = [];
  for (const s of sources) {
    const target = resolveImportTarget(projectRoot, fromRel, s);
    if (!target) continue;
    const row = db
      .prepare("SELECT qualified_name FROM nodes WHERE file_path = $f AND name = $n AND kind IN ('function','const') LIMIT 1")
      .get({ f: target, n: member }) as { qualified_name: string } | undefined;
    if (row) hits.push({ file: target, qn: row.qualified_name });
  }
  return hits.length === 1 ? hits[0] : null;
}

/** 有点调用前缀：内置对象 / 内置模块 / 全局对象（外部，非项目符号） */
const BUILTIN_PREFIXES = new Set([
  'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise', 'console', 'Date',
  'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Symbol', 'BigInt', 'globalThis', 'window',
  'document', 'navigator', 'URL', 'TextEncoder', 'TextDecoder', 'Buffer', 'process', 'require',
  'module', 'exports', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'Intl', 'performance', 'structuredClone',
  'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'undefined',
  'NaN', 'Infinity', 'os', 'path', 'fs', 'http', 'https', 'net', 'zlib', 'util', 'assert',
  'stream', 'events', 'crypto', 'child_process', 'url', 'querystring', 'dns', 'tls', 'buffer',
  'node', 'String', 'Number', 'Math',
  // Python 常用
  'os', 'sys', 're', 'json', 'datetime', 'pathlib', 'collections', 'typing', 'functools',
  'itertools', 'logging', 'random', 'time', 'socket', 'subprocess', 'threading', 'asyncio',
]);

/** 无点内置函数 / 构造器（外部，非项目符号） */
const BUILTIN_CALLEES = new Set([
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'Set', 'Map', 'Date', 'Math',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'RegExp', 'Symbol',
  'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'typeof', 'instanceof',
  // Python 内置
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool',
  'type', 'isinstance', 'sum', 'min', 'max', 'sorted', 'enumerate', 'zip', 'map', 'filter',
  'open', 'repr', 'abs', 'round', 'any', 'all', 'next', 'iter', 'hasattr', 'getattr',
  'ValueError', 'KeyError', 'Exception',
  // ★★★ 2026-10-27（T-#44）：**Node / 浏览器全局函数**（不需 import 就能用）。
  //   实测 `setTimeout`(17) 落进了 failed —— 它是 `@types/node` 的全局函数，
  //   源码里不 import ⇒ `packageBindingsByFile` 看不到 ⇒ 只能靠这张表。
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'fetch', 'atob', 'btoa', 'require',
  // ★ T-#50：**`import` 是关键字不是函数** —— 动态 `await import(spec)` 被抽成 call 引用，
  //   它永远不可能对应仓内符号（实测 25 条落 failed）。
  'import',
  // ★ T-#58：**`super` 是关键字**（`super(message)` / `super()` 构造函数调用）—— 实测 2 条。
  'super',
  // ★ T-#58：Python 内置异常（`raise SystemExit(...)` 被抽成 call）
  'SystemExit', 'BaseException', 'StopIteration', 'AssertionError', 'NotImplementedError',
  'RuntimeError', 'TypeError', 'ImportError', 'OSError', 'IOError', 'AttributeError',
  // ★ T-#60：**JS 全局函数**（不需 import 就能用）—— 实测 decodeURIComponent 落 failed
  'decodeURIComponent', 'encodeURIComponent', 'decodeURI', 'encodeURI', 'escape', 'unescape',
]);

export interface CrossFileResolveStats {
  total: number;
  /** import 限定解析成功，已写 edges(kind=call, cross) */
  resolved: number;
  /** 内置 / 外部 / 局部变量调用，标 status='external' */
  external: number;
  /** 未匹配到目标符号，标 status='failed'（不再重试） */
  failed: number;
  /**
   * ★★★ 2026-10-27（T-#67）：**度量「哪一层判得准」** —— `上一次判定 → 本次判定` 的计数。
   *
   * ## 为什么要它
   * 仓里有两层判定：`syncFile`（有 AST）与 `resolveCrossFileCalls`（只有 DB 行）。
   * 两层**谁更准**一直是靠我推理 —— 而 T-#66 那次我推理错了（把 `suspect` 锁死，`failed` 暴涨到 11322）。
   * ⇒ 改成**看数据**：每行处理前记下它的 `candidates.verdict`（上一次的结论），
   *   处理后再看 `status` ⇒ 得到 `suspect→external` / `suspect→failed` / `external→external` … 的分布。
   *
   * ## 怎么读
   * · `suspect→external` 多 ⇒ 跨文件层**救回了 AST 判不准的**（它的价值）
   * · `suspect→failed` 多 ⇒ 跨文件层也救不回（这些是真债或更深的能力缺口）
   * · `external→*` 非恒等 ⇒ **两层不一致**（该查）
   */
  overrides?: Record<string, number>;
  /**
   * ★ 2026-10-22：re-export 没建边的**原因分布**（why → 条数）。
   * 为什么开这一栏：任务卡判据要求「连上多少 / 跳过多少」必须一起报 ——
   * 只回一个 resolved，跳过的那批就是**静默少报**。
   */
  reexportSkipped?: Record<string, number>;
  /**
   * 2026-10-22（DB 补全·调用边）：其中由**仓内跨文件类型成员**证出来的边条数
   * （`resolved` 的子集：`reg.register()` / `X.staticMember()` 这一类）。
   * 单列的理由：`resolved` 混着「裸名沿 import 命中」和「类型成员命中」两种来源，
   * 读的人分不出**这一轮补的是哪一种** ⇒ 没法判这条判据到底有没有生效。
   */
  cross_type?: number;
}

/**
 * 跨文件引用解析（call + type_ref）：把 unresolved_refs 里同文件未命中的引用解析到目标文件符号。
 * type_ref：type_name 沿 relative imports 定位目标文件的 interface/type/class 符号；
 * 内置类型（string/Record 等）→ external。其余策略同 call。
 *
 * 策略（v1，保守防误连）：
 *   - 无点调用：内置黑名单 → external；否则沿本文件 relative imports 定位目标文件，
 *     目标文件符号表含 callee → 写 edges(kind='call', metadata.cross=true)
 *   - 有点调用：前缀黑名单（内置对象/模块）→ external；其余前缀（局部变量/Go 包调用）
 *     保守标 external——v1 不做别名/包路径映射，避免误连
 *   - 找不到目标的真项目调用 → failed（不再每轮重试）
 *
 * 幂等：只处理 status='pending' 的行；syncProject 全量同步后调用（跨文件匹配需要全库符号表）。
 */
/**
 * ★ T-#62：**轻量 go.mod 扫描**（只取 `module → 目录`）。
 * ★ 为什么不直接调 `import_project.readGoModules`：那个文件 import 本文件 ⇒ **循环依赖**。
 *   这里只做一件事、十几行，宁可小幅重复也不制造环。
 */
function readGoModulesLite(root: string): Array<{ module: string; dir: string }> {
  const out: Array<{ module: string; dir: string }> = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') stack.push(full);
      } else if (e.name === 'go.mod') {
        try {
          const m = fs.readFileSync(full, 'utf8').match(/^\s*module\s+(\S+)/m);
          if (m) {
            const rel = path.relative(root, dir).replace(/\\/g, '/');
            out.push({ module: m[1], dir: rel === '.' ? '' : rel });
          }
        } catch {
          /* 读不到就算了 */
        }
      }
    }
  }
  return out;
}

export function resolveCrossFileCalls(
  db: Database,
  projectRoot: string,
  opts: { scopeFiles?: readonly string[]; keepUnresolvedPending?: boolean } = {},
): CrossFileResolveStats {
  // ★ 增量口径（2026-09-14 实测加的）：只处理"来自指定文件"的未决引用。
  //   为什么必需：本函数要**预载全库符号表**再处理所有 pending —— 实测 120 文件规模下一次就要 **9s**，
  //   随索引增长而涨。若"每次建块/每批续建"都全量跑，成本会盖过解析本身（后台补齐 42s 的主因之一）。
  //   传 `scopeFiles` = 本轮刚同步的文件 ⇒ 只解析它们的引用，成本与本轮文件数成正比。
  const scope = (opts.scopeFiles ?? []).filter(Boolean);
  const rows = (
    scope.length
      ? db
          .prepare(
            `SELECT id, from_node_id, reference_name, reference_kind, line, candidates FROM unresolved_refs
             WHERE status='pending' AND reference_kind IN ('call','type_ref')
               AND (${scope.map((_, i) => `from_node_id LIKE $s${i}`).join(' OR ')})`,
          )
          .all(Object.fromEntries(scope.map((f, i) => [`s${i}`, `${f}#%`])))
      : db
          .prepare(
            "SELECT id, from_node_id, reference_name, reference_kind, line, candidates FROM unresolved_refs WHERE status='pending' AND reference_kind IN ('call','type_ref')",
          )
          .all()
  ) as Array<{ id: number; from_node_id: string; reference_name: string; reference_kind: string; line: number; candidates: string | null }>;
  if (rows.length === 0) return { total: 0, resolved: 0, external: 0, failed: 0 };

  // 预加载：文件名 → 符号名集合（import 限定匹配用）
  const symbolsByFile = new Map<string, Set<string>>();
  for (const s of db.prepare("SELECT name, file_path FROM nodes WHERE kind != 'file'").all() as Array<{ name: string; file_path: string }>) {
    let set = symbolsByFile.get(s.file_path);
    if (!set) {
      set = new Set();
      symbolsByFile.set(s.file_path, set);
    }
    set.add(s.name);
  }
  // ★★★ 2026-10-27（T-#62）：**多语言导入解析（适配器驱动）**。
  //
  // 这是“有什么语言就自动解锁什么语言”的落地：
  //   本文件不再按语言写 if，而是问 `LANG_ADAPTERS[lang].resolveImport`。
  //   未声明该字段的语言 ⇒ 返回 null ⇒ 调用方走默认（TS 相对路径）逻辑，**行为不变**。
  const langByFile = new Map<string, string>();
  for (const row of db.prepare('SELECT path, language FROM files').all() as Array<{ path: string; language: string }>) {
    langByFile.set(row.path, row.language);
  }
  const importCtx: ResolveImportCtx = {
    projectRoot,
    files: new Set<string>(langByFile.keys()),
    goModules: readGoModulesLite(projectRoot),
  };
  /** 走适配器的 `resolveImport`：命中返回目标，未声明/未命中返回 null（**不抢默认逻辑**） */
  const resolveViaAdapter = (
    rel: string,
    expr: string,
    kinds: readonly string[],
  ): { file: string; qn: string } | null => {
    const lang = langByFile.get(rel);
    if (!lang) return null;
    const a = LANG_ADAPTERS[lang];
    if (!a?.resolveImport) return null;
    for (const imp of allImportsByFile.get(rel) ?? []) {
      const cands = a.resolveImport(imp.source, rel, importCtx);
      if (!cands || cands.length === 0) continue;
      for (const f of cands) {
        if (f === rel) continue;
        const row = db
          .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $f AND name = $n LIMIT 1')
          .get({ f, n: expr }) as { kind: string; qualified_name: string } | undefined;
        if (row && kinds.includes(row.kind)) return { file: f, qn: row.qualified_name };
      }
    }
    return null;
  };

  // 预加载：文件 → 类型符号名集合（type_ref 目标限定 interface/type/class）
  const typeNamesByFile = new Map<string, Set<string>>();
  for (const s of db.prepare("SELECT name, file_path FROM nodes WHERE kind IN ('interface','type','class')").all() as Array<{ name: string; file_path: string }>) {
    let set = typeNamesByFile.get(s.file_path);
    if (!set) {
      set = new Set();
      typeNamesByFile.set(s.file_path, set);
    }
    set.add(s.name);
  }
  // 预加载：文件 → relative imports（★ T-#85 带 `bindings` —— 解析时要拿【远端名】去目标文件搜符号）
  const relImportsByFile = new Map<string, Array<{ source: string; line: number; bindings?: string | null }>>();
  for (const i of db.prepare("SELECT file_path, source, line, bindings FROM v_imports WHERE kind='relative'").all() as Array<{ file_path: string; source: string; line: number; bindings: string | null }>) {
    let arr = relImportsByFile.get(i.file_path);
    if (!arr) {
      arr = [];
      relImportsByFile.set(i.file_path, arr);
    }
    arr.push(i);
  }

  /** 文件 → 相对导入绑定的本地名（判「这个裸名到底是从哪个相对模块 import 进来的」） */
  // ★★★ 2026-10-27（T-#62）：**全部导入（不分 kind）** —— 适配器的 `resolveImport` 必须看到
  //   **package 导入**（Go 的 `github.com/x/…/internal/instrument` / Python 的点分模块）。
  //   病史：`relImportsByFile` 只装 `kind='relative'` ⇒ Go 跨包引用永远进不了适配器
  //   （实测改了适配器只 +2 条，就是因为这一层没接）。
  const allImportsByFile = new Map<string, Array<{ source: string; line: number }>>();
  for (const i of db.prepare('SELECT file_path, source, line FROM v_imports').all() as Array<{
    file_path: string;
    source: string;
    line: number;
  }>) {
    let arr = allImportsByFile.get(i.file_path);
    if (!arr) {
      arr = [];
      allImportsByFile.set(i.file_path, arr);
    }
    arr.push(i);
  }
  const relBindingsByFile = new Map<string, Set<string>>();
  for (const i of db.prepare("SELECT file_path, bindings FROM v_imports WHERE kind='relative' AND bindings IS NOT NULL").all() as Array<{ file_path: string; bindings: string }>) {
    let set = relBindingsByFile.get(i.file_path);
    if (!set) relBindingsByFile.set(i.file_path, (set = new Set()));
    try {
      for (const nm of JSON.parse(i.bindings) as string[]) set.add(localOf(nm));
    } catch {
      /* 坏 JSON 跳过（与 packageBindingsByFile 同口径；坏了也不能让整个解析挂掉） */
    }
  }

  /**
   * ★★★ 2026-10-19（v9 · 结构性修复）：**文件 → (本地绑定名 → 来源模块)**
   *
   * 为什么必须有它：此前 `readdirSync` 这样的裸名只能沿 **relative** imports 找目标，
   * 而它其实来自 `node:fs`（package）⇒ 找不到 ⇒ 判 `failed`。
   * 实测 `failed` 里 2,700+ 条绝大多数是这种"来自 package 的裸名"（`node:fs` / `node:path` 解构）。
   *
   * 有了它，判据从"猜"变成"查"：
   *   · 裸名在 `packageBindings` 里 ⇒ **external**（正确语义：外部依赖，不是未解析）
   *   · 不在 ⇒ 再沿 relative imports 找（原来的逻辑）
   */
  const packageBindingsByFile = new Map<string, Map<string, string>>();
  for (const row of db
    .prepare("SELECT file_path, source, bindings FROM v_imports WHERE kind='package' AND bindings IS NOT NULL")
    .all() as Array<{ file_path: string; source: string; bindings: string }>) {
    let m = packageBindingsByFile.get(row.file_path);
    if (!m) {
      m = new Map();
      packageBindingsByFile.set(row.file_path, m);
    }
    try {
      for (const name of JSON.parse(row.bindings) as string[]) {
        const loc = localOf(name);
        if (!m.has(loc)) m.set(loc, row.source);
      }
    } catch {
      /* 坏 JSON 跳过（不该发生；坏了也不能让整个解析挂掉） */
    }
  }

  // ★ 2026-10-21：Go 同包索引（目录 → [{file, pkg}]）。判据 = 同目录 **且** package 子句同名，
  //   见 findGoSamePackageTarget 的注释（`foo_test` 外部测试包会打破「一目录一包」）。
  const goFilesByDir = new Map<string, Array<{ file: string; pkg: string }>>();
  for (const row of db.prepare("SELECT path FROM files WHERE language = 'go'").all() as Array<{ path: string }>) {
    const pkg = goPackageName(projectRoot, row.path);
    if (!pkg) continue;
    const dir = path.posix.dirname(row.path);
    const arr = goFilesByDir.get(dir) ?? [];
    arr.push({ file: row.path, pkg });
    goFilesByDir.set(dir, arr);
  }

  // ★ 2026-10-22：已建索引的文件集 —— 用来把「目标文件不在索引里」与「目标文件里没这个符号」分开报。
  //   （`../dist/...` 这类：盘上有、索引里没有 ⇒ 不是漏连，是没扫到。）
  const indexedFiles = new Set(
    (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map((row) => row.path),
  );
  // ★ 2026-10-22（DB 补全·调用边）：文件 → 「跨文件类型成员」查找器（按文件缓存，判据见 makeImportedTypeMemberLookup）。
  //   只有走到带点调用才会建；同一文件的 `reg.xxx()` 一整片共用一份类型名缓存。
  const typeLookupByFile = new Map<string, ReturnType<typeof makeImportedTypeMemberLookup>>();
  const typeLookupFor = (file: string): ReturnType<typeof makeImportedTypeMemberLookup> => {
    let f = typeLookupByFile.get(file);
    if (!f) {
      f = makeImportedTypeMemberLookup(
        db,
        projectRoot,
        file,
        (relImportsByFile.get(file) ?? []).map((i) => i.source),
      );
      typeLookupByFile.set(file, f);
    }
    return f;
  };
  // ★★★ v17（2026-10-26）：解析成功时**把目标节点 id 一起落库**。
  //   原先只写 status='resolved'，把「解析到哪个节点」**当场丢了** ⇒ 陈旧断言判据只能靠
  //   reference_name 反推名字，而成员调用的 reference_name 是「接收者变量名.方法」
  //   （实测 ps.reject / reg.register / dsl.load / storage.getDataHome）⇒ 100% 假阳性。
  const updResolved = db.prepare(
    "UPDATE unresolved_refs SET status='resolved', resolved_node_id = $n WHERE id = $i",
  );
  // ★ 2026-10-21：状态与**原因标签**一起写（candidates 列）——「没建边」不许静默：
  //   external = 目标在仓外（不是漏连）· failed = 证不出来（suspect/unknown），要能查到为什么。
  const updExternal = db.prepare("UPDATE unresolved_refs SET status='external', candidates=$cd WHERE id = $i");
  const updFailed = db.prepare("UPDATE unresolved_refs SET status='failed', candidates=$cd WHERE id = $i");
  const insEdge = db.prepare(
    'INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, $k, $ln, NULL, $md)',
  );
  const CROSS_META = JSON.stringify({ cross: true });

  const stats: CrossFileResolveStats = { total: rows.length, resolved: 0, external: 0, failed: 0, reexportSkipped: {} };
  // ★ 索引**不完整**阶段（后台续建途中）不要急着判 failed：目标符号可能只是还没索引到。
  //   一旦标 failed 就永不重试 ⇒ 最终索引会永久缺跨文件边。此时留 pending，等补完再一次性定论。
  const keepPending = opts.keepUnresolvedPending === true;
  const markUnresolved = (id: number, why = 'cross-target-not-found', detail?: string): void => {
    if (keepPending) return;
    updFailed.run({
      i: id,
      cd: JSON.stringify(detail ? { verdict: 'suspect', why, detail } : { verdict: 'suspect', why }),
    });
    stats.failed++;
    // ★ 2026-10-22：re-export 类的跳过**进账**（回执要和 resolved 一起报，不许只报成功数）
    if (why.startsWith('reexport-')) stats.reexportSkipped![why] = (stats.reexportSkipped![why] ?? 0) + 1;
  };
  // ★★ 事务包裹（2026-09-14 实测的关键修正）：本函数要写大量 edges / unresolved_refs 行。
  //   不包事务 = 每条语句各自 autocommit ⇒ **每条一次 fsync** ⇒ 实测 20 文件规模的一批要 1.7s
  //   （后台补齐 42s 里 27s 全在这里）。外层已有事务（如冷启 bootstrap）时自动降级为 no-op。
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN IMMEDIATE');
  try {
  // ★★★ 2026-10-27（T-#50）：**本仓的泛型参数名，按文件收集** —— `T`/`U`/`K` 这类引用**不是符号**，
  //   它们只是类型参数的形参名 ⇒ 必须判 `external`，不能落 `failed`（实测 `T` 独占 79 条）。
  //   ★ 判据：`nodes.type_params`（T-#21 起就有，形状是 JSON 数组）—— **不猜，查索引**。
  const genericParamsByFile = new Map<string, Set<string>>();
  for (const gp of db
    .prepare("SELECT file_path, type_params FROM nodes WHERE type_params IS NOT NULL AND TRIM(type_params) <> ''")
    .all() as Array<{ file_path: string; type_params: string }>) {
    let arr: unknown;
    try {
      arr = JSON.parse(gp.type_params);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    let set = genericParamsByFile.get(gp.file_path);
    if (!set) {
      set = new Set();
      genericParamsByFile.set(gp.file_path, set);
    }
    for (const p of arr) {
      const nm = typeof p === 'string' ? p : (p as { name?: unknown })?.name;
      if (nm) set.add(String(nm));
    }
  }

  // ★★★ 2026-10-27（T-#51）：**局部绑定（函数参数）按文件收集**。
  //
  // ## 为什么需要
  // `new Promise((resolve, reject) => …)` 里的 `resolve`/`reject`、`fn(c)` 里的 `fn`
  // 都是**函数参数** —— 它们**不是符号**（不建边），但**引用它们是合法的**。
  // ⇒ 落 `failed` 就是**假债**（实测 63 条）。
  //
  // ## 判定用**已有数据**，不需要改解析器
  // `nodes.params`（T-#21 起就有）+ 函数行范围（`start_line`/`end_line`）
  // ⇒ 引用位置落在某函数的范围内、且名字在它的参数表里 ⇒ 它就是那个参数。
  //
  // ## 为什么不标 `resolved`
  // 参数**不是仓内符号**（没有节点可指）⇒ 不能冒充“解析成功”。
  // 标 `external` + `why: 'local-binding:<fn>'` —— **说真话**：它不在仓内符号表里，
  // 本来就不该建边，而 `why` 把“为什么”写清楚了。
  const localBindingsByFile = new Map<string, Array<{ nm: string; fn: string; from: number; to: number }>>();
  for (const row of db
    .prepare(
      "SELECT file_path, qualified_name, start_line, end_line, params FROM nodes WHERE params IS NOT NULL AND TRIM(params) <> ''",
    )
    .all() as Array<{ file_path: string; qualified_name: string; start_line: number; end_line: number; params: string }>) {
    let arr: unknown;
    try {
      arr = JSON.parse(row.params);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;
    let list = localBindingsByFile.get(row.file_path);
    if (!list) {
      list = [];
      localBindingsByFile.set(row.file_path, list);
    }
    for (const p of arr) {
      const nm = typeof p === 'string' ? p : (p as { name?: unknown })?.name;
      if (nm) list.push({ nm: String(nm), fn: row.qualified_name, from: row.start_line, to: row.end_line });
    }
  }
  /** 引用是不是某个函数的参数（局部绑定）⇒ 返回那个函数名，否则 null */
  const localBindingOf = (rel: string, nm: string, line: number): string | null => {
    for (const b of localBindingsByFile.get(rel) ?? []) {
      if (b.nm === nm && line >= b.from && line <= b.to) return b.fn;
    }
    return null;
  };

  // ★★★ 2026-10-27（T-#67）：**处理前记下每行的「上一次判定」** —— 用于事后算 `上一次 → 本次` 的分布。
  //   这就是「哪一层判得准」的度量。T-#66 我**推理错过一次**（把 `suspect` 锁死 ⇒ failed 11322），
  //   所以这件事**改成看数据**，不再靠推理。
  const priorVerdict = new Map<number, string>();
  for (const r0 of rows) {
    const c0 = (r0 as { candidates?: string | null }).candidates;
    if (typeof c0 !== 'string' || !c0) continue;
    try {
      const v0 = (JSON.parse(c0) as { verdict?: string })?.verdict;
      if (v0) priorVerdict.set(r0.id, v0);
    } catch {
      /* 坏 JSON 跳过 */
    }
  }

  for (const r of rows) {
    const rel = r.from_node_id.split('#')[0];
    const expr = r.reference_name;
    const kind = r.reference_kind as 'call' | 'type_ref';
    // ★★★ 2026-10-27（T-#65）：**重判必须尊重已有判定证据**。
    //
    // ## 病史（本轮实测抓到的真凶）
    // 为做 A/B，我把全部引用重置成 `pending` 再跑一遍 ⇒ **failed 24 → 100**。
    // 那 100 条是：`resolve` 16 · `reject` 13 · `fn` 8 · `run` 6 · `match` 4 · `onError` 3 · `wake` 2 …
    // —— **全是 `syncFile` 已经正确判成 `external: local-binding` 的局部绑定**。
    //
    // ## 根因：判定能力不对称
    // `syncFile`（`classifyCall` + T-#55/T-#59/T-#61 的作用域栈）**有 AST** ⇒ 判得出"这是参数/局部 const"；
    // `resolveCrossFileCalls` **只有 DB 行** ⇒ 判不出 ⇒ 一律落 `failed`。
    // ⇒ **两套判定不幂等** —— 同一批引用，走哪条路得到不同答案。
    //   ★ 这就是整个会话里数字一直漂（4049 → 4088 → 4094 → 3855 → 4103）的**根因**。
    //
    // ## 修法
    // `candidates` 是**上一次判定留下的证据**（`{"verdict":"external","why":"local-binding:<fn>"}`）。
    // 重判时**先读它**：已经有 `local-binding` 结论的 ⇒ **保持 external，不重判**
    // （这条结论只有 AST 能给，DB 层无法推翻）。
    // ★★★ 2026-10-27（T-#66）：**升成原则 —— AST 得出的判定，DB 层不得推翻**。
    //   `syncFile` 在解析期（**手里有 AST**）判过的行，`candidates` 里带 `"source":"ast"`。
    //   这些结论（`local-binding` / `bare-not-in-scope` / `literal-receiver` / `chain-receiver` …）
    //   **只有 AST 能给** —— DB 层只有行数据，重判必然得出**更差的答案**
    //   （实测：全量重判后 100 条假 failed，全是 `syncFile` 已正确判成 external 的局部绑定）。
    //   ★ 关键：**保留原判**，不是一律 external ——
    //     `verdict==='external'` ⇒ external；其余（`suspect`/`unknown`）⇒ 维持 failed。
    //   ★ 兼容老数据：无 `source` 标记但 `why` 含 `local-binding` 的，同样按 AST 结论处理。
    const candStr = typeof r.candidates === 'string' ? r.candidates : '';
    if (candStr.includes('"source":"ast"') || candStr.includes('local-binding')) {
      let astVerdict: string | undefined;
      try {
        astVerdict = (JSON.parse(candStr) as { verdict?: string })?.verdict;
      } catch {
        /* 坏 JSON ⇒ 按非 external 处理（安全方向） */
      }
      if (astVerdict === 'external') {
        updExternal.run({ i: r.id, cd: candStr });
        stats.external++;
      } else {
        updFailed.run({ i: r.id, cd: candStr });
        stats.failed++;
      }
      continue;
    }
    // ★ T-#51：**局部绑定先判** —— 参数不是符号，不建边，但也不该是 failed
    const bindFn = localBindingOf(rel, expr, r.line);
    if (bindFn) {
      updExternal.run({
        i: r.id,
        cd: JSON.stringify({ verdict: 'external', why: `local-binding:${bindFn}` }),
      });
      stats.external++;
      continue;
    }
    // ★ T-#44：Go 的内置表**只对 .go 文件**启用（避免 int/max/close 误伤本仓同名符号）
    const isGoFile = rel.endsWith('.go');
    // ★ T-#50：Java 内置类型同理，只对 .java 启用
    const isJavaFile = rel.endsWith('.java');
    // ★ T-#51：**Shell 脚本的外部命令**（`printf` / `node` / `grep` / `echo` …）
    const isShellFile = rel.endsWith('.sh') || rel.endsWith('.bash') || rel.endsWith('.zsh');
    // ★ 2026-10-22：本条引用的「没建边原因」暂存器（一行一个，不复用：上一条的原因不能写进下一条）
    const miss: ReexportMiss[] = [];

    if (kind === 'type_ref') {
      if (BUILTIN_TYPES.has(expr) || (isGoFile && GO_BUILTIN_TYPES.has(expr))) {
        updExternal.run({ i: r.id, cd: JSON.stringify({ verdict: 'external', why: 'builtin-type' }) });
        stats.external++;
        continue;
      }
      // ★ T-#50：**泛型参数**（`T`/`U`/`K`…）不是符号 ⇒ external
      if (genericParamsByFile.get(rel)?.has(expr)) {
        updExternal.run({ i: r.id, cd: JSON.stringify({ verdict: 'external', why: `generic-param:${expr}` }) });
        stats.external++;
        continue;
      }
      // ★ T-#50：**Java 内置类型**（String/Map/Object/Exception…）
      // ★ T-#84：**`java.lang` 的真全局**（不需要 import ⇒ `pkgSrc` 看不见 ⇒ 必须靠表）。
      //   ★ 我 T-#80 把整张表删了是错的：`java.io`/`java.nio`/`java.util` 那些走 `pkgSrc`（有据），
      //     但 `java.lang`（`String`/`Object`/`Exception`/`StringBuilder` …）**不走** ⇒ 删了就落 failed。
      //   实测：删表后全量重建 failed 14 → 43，新增 29 条全是 `.java` 里的 `java.lang` 名字。
      if (isJavaFile && JAVA_LANG_TYPES.has(expr)) {
        updExternal.run({ i: r.id, cd: JSON.stringify({ verdict: 'external', why: 'java-lang-global' }) });
        stats.external++;
        continue;
      }
      // ★★★ 2026-10-27（T-#50）：**带点的类型引用**（`http.ServerResponse` / `fs.Dirent`）——
      //   实测 **142 条**落 failed，而 `call` 分支（下面 `expr.includes('.')`）早就处理了带点形态，
      //   **`type_ref` 分支漏了** ⇒ 所有 `http.X` / `fs.X` 全落 failed。
      //   判据：receiver 是 **package 命名空间**（`import * as http` / `import fs from 'node:fs'`）
      //   ⇒ 它的成员是**外部包的类型** ⇒ external（不问能不能解析，它本来就不在仓内）。
      if (expr.includes('.')) {
        const dotAt = lastReceiverDot(expr);
        const recv = dotAt > 0 ? expr.slice(0, dotAt).trim() : '';
        const pkg = recv ? packageBindingsByFile.get(rel)?.get(recv) : undefined;
        updExternal.run({
          i: r.id,
          cd: JSON.stringify({
            verdict: 'external',
            why: pkg ? `namespace-member-of-package:${pkg}` : `dotted-type-unprovable:${recv || '?'}`,
          }),
        });
        stats.external++;
        continue;
      }
      // ★★★ 2026-10-27（T-#54）：**同文件内的类型引用** —— T-#53 只修了 `call` 路径，
      //   `type_ref` 有**同一个洞**（下面 `findCrossFileTarget` 同样只走 imports）。
      //   实测：`OverviewJudge` / `OverviewRow` / `CallResult` 都是**同文件里声明的 interface**
      //   （它们在 `nodes` 里，`is_closure=1`）却全落 failed。
      const sameFileType = typeNamesByFile.get(rel)?.has(expr)
        ? (db
            .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $f AND name = $n LIMIT 1')
            .get({ f: rel, n: expr }) as { kind: string; qualified_name: string } | undefined)
        : undefined;
      if (sameFileType) {
        insEdge.run({
          src: r.from_node_id,
          tgt: `${rel}#${sameFileType.qualified_name}`,
          k: 'type_ref',
          ln: r.line,
          md: null,
        });
        updResolved.run({ i: r.id, n: `${rel}#${sameFileType.qualified_name}` });
        stats.resolved++;
        continue;
      }
      // ★★★ 2026-10-27（T-#79）：**`type_ref` 也要查 package 绑定**。
      //
      // ## 病史（删掉补偿表才暴露出来的真洞）
      // T-#78 删掉 `BUILTIN_TYPES` 里那批补偿表项后，`failed` 14 → 30，
      // 新增的主要是 `DatabaseSync 8` · `Dirent 2`。查数据：
      //   `index_integrity.ts` 的 imports 里**明明有** `[package] node:sqlite ["DatabaseSync"]`
      //   而那条引用是 **`reference_kind = 'type_ref'`**。
      // ⇒ **`pkgSrc`（package 绑定）只在 `call` 路径检查，`type_ref` 路径从来没查**！
      //   `import { DatabaseSync } from 'node:sqlite'` 的**类型**引用永远判不到
      //   ⇒ 以前全靠 `BUILTIN_TYPES` 里硬堆名字**掩盖**（那正是"补丁的化石"的危害：
      //     它让真洞看不见，换个项目就漏）。
      //
      // ## 修法
      // `type_ref` 走和 `call` 一样的判据：名字是本文件的 **package 导入绑定** ⇒ external（有据）。
      const typePkgSrc = packageBindingsByFile.get(rel)?.get(expr);
      if (typePkgSrc) {
        updExternal.run({
          i: r.id,
          cd: JSON.stringify({ verdict: 'external', why: 'package-import', detail: typePkgSrc }),
        });
        stats.external++;
        continue;
      }
      const t =
        findCrossFileTarget(db, relImportsByFile, projectRoot, rel, expr, typeNamesByFile, ['interface', 'type', 'class'], miss, indexedFiles)
        ?? findGoSamePackageTarget(db, rel, expr, ['interface', 'type', 'class'], goFilesByDir)
        // ★ T-#62：**适配器驱动的跨包/跨文件解析**（Go 的 module 路径 → 目录就在这层生效）
        ?? resolveViaAdapter(rel, expr, ['interface', 'type', 'class']);
      if (t) {
        insEdge.run({ src: r.from_node_id, tgt: `${t.file}#${t.qn}`, k: 'type_ref', ln: r.line, md: CROSS_META });
        updResolved.run({ i: r.id, n: `${t.file}#${t.qn}` });
        stats.resolved++;
      } else {
        // ★ 2026-10-22：把 re-export 那条路「为什么没建边」写进 failed 的 why（不再是笼统的 not-found）
        // ★ T-#63：「目标存在但不在索引 / 在仓外」⇒ **明确外部**，不是漏连
        const missWhy = miss[0]?.why;
        if (missWhy === 'reexport-target-not-indexed' || missWhy === 'reexport-target-outside-repo') {
          updExternal.run({
            i: r.id,
            cd: JSON.stringify({
              verdict: 'external',
              why: missWhy,
              ...(miss[0]?.detail ? { detail: miss[0].detail } : {}),
            }),
          });
          stats.external++;
        } else {
          markUnresolved(r.id, missWhy ?? 'cross-target-not-found', miss[0]?.detail);
        }
      }
      continue;
    }

    if (expr.includes('.')) {
      // ★ 2026-10-21：带点调用里可证的第一类是 `import * as X` 的命名空间成员（X.foo 且 X 是命名空间导入）。
      // ★ 2026-10-22（DB 补全·调用边）：第二类是**仓内跨文件类型成员**，两种形态同一判据：
      //   ① 接收者的**声明类型** T 在仓内另一文件（第一趟把 T 写进 candidates.receiver_type 再落 pending）；
      //   ② 接收者本身就是**本文件相对导入的类名**（`import { X }` 后 `X.staticMember()`）。
      //   判据只在 makeImportedTypeMemberLookup 一份；这里只负责「全库符号表齐了」之后的**终审**。
      const dotAt = lastReceiverDot(expr);
      const recv = dotAt > 0 ? expr.slice(0, dotAt).trim() : '';
      const member = dotAt > 0 ? expr.slice(dotAt + 1).trim() : '';
      /** 第一趟留下的「接收者声明类型」提示（坏 JSON 不阻断：退化成没有提示） */
      let hint: string | null = null;
      try {
        const cd = r.candidates ? (JSON.parse(r.candidates) as { receiver_type?: string }) : null;
        if (typeof cd?.receiver_type === 'string' && cd.receiver_type) hint = cd.receiver_type;
      } catch {
        /* 坏 JSON ⇒ 当没有提示，下面照旧走命名空间/外部两条路 */
      }
      const simpleRecv = /^[A-Za-z_$][\w$]*$/.test(recv) ? recv : '';
      const recvType = simpleRecv
        ? (hint ?? ((relBindingsByFile.get(rel)?.has(simpleRecv) ?? false) ? simpleRecv : null))
        : null;
      if (recvType && member) {
        const look = typeLookupFor(rel)(recvType, member);
        if (look.kind === 'hit') {
          insEdge.run({ src: r.from_node_id, tgt: `${look.file}#${look.qn}`, k: 'call', ln: r.line, md: CROSS_META });
          updResolved.run({ i: r.id, n: `${look.file}#${look.qn}` });
          stats.resolved++;
          stats.cross_type = (stats.cross_type ?? 0) + 1;
          continue;
        }
        if (look.kind === 'type-in-repo-no-member') {
          // T **在仓内**、成员证不出（接口方法只记在 `nodes.members` JSON、没有节点 / 类型推断错）⇒
          // 标签必须说真话：不许继续沿用「T 是仓外类型」。
          updExternal.run({
            i: r.id,
            cd: JSON.stringify({ verdict: 'external', why: `type-member-unprovable:${recvType}` }),
          });
          stats.external++;
          continue;
        }
      }
      const nsTarget = findNamespaceMemberTarget(db, projectRoot, rel, expr);
      if (nsTarget) {
        insEdge.run({ src: r.from_node_id, tgt: `${nsTarget.file}#${nsTarget.qn}`, k: 'call', ln: r.line, md: CROSS_META });
        updResolved.run({ i: r.id, n: `${nsTarget.file}#${nsTarget.qn}` });
        stats.resolved++;
      } else {
        // ★ 有类型提示就把**原判定**写回去（`receiver-type-external:T` = 类型在仓外）；
        //   没有提示才是 `dotted-unprovable`（接收者形态证不出来）。两者混成一个词会误导读端。
        updExternal.run({
          i: r.id,
          cd: JSON.stringify({
            verdict: 'external',
            // ★★★ 2026-10-27（T-#56）：**把 `dotted-unprovable` 拆细**。
            //
            // 实测（T-#55 之后）：`dotted-unprovable` **13953 条（48%）** 是全仓最大的一个桶，
            // 而用 tsc checker 抽样量（`serve.ts` 405 条）：
            //   **94.6% 是外部/内置** · 1.2% 是本仓符号 · 4.2% 仍判不了。
            // ⇒ **它不是盲区，是标签太粗**。这里不靠 checker（太贵），只按**接收者名**分两档：
            //   · 接收者是已知全局命名空间（`Math` / `JSON` / `console` / `process` …）⇒ `builtin-namespace`
            //   · 其余（局部变量/参数，类型证不出）⇒ `local-receiver-untyped`
            // ★ 状态都是 `external`（本来就不是债）—— 改的只是 `why` 的可读性。
            // ★ T-#56 修 1：**取根标识符** —— 实测大量接收者是**调用/括号表达式**：
            //   `path.relative(a,b).split` ⇒ 根是 `path`（该算 builtin-namespace）
            //   `[...].map` ⇒ 根是空（该算 literal-receiver，287 条）
            //   `new Date().toISOString` ⇒ 根是空（105 条）
            //   `(dsl).filter` ⇒ 根是空（74 条）
            //   我原来拿整个 `recv` 去比，全部落进 `local-receiver-untyped` ⇒ 桶被灌水。
            why: hint
              ? `receiver-type-external:${hint}`
              : !/^[A-Za-z_$]/.test(recv)
                ? `literal-receiver:${recv.slice(0, 24)}`
                : BUILTIN_NAMESPACES.has(/^[A-Za-z_$][\w$]*/.exec(recv)?.[0] ?? '')
                  ? `builtin-namespace:${/^[A-Za-z_$][\w$]*/.exec(recv)?.[0]}`
                  : `local-receiver-untyped:${/^[A-Za-z_$][\w$]*/.exec(recv)?.[0] ?? '?'}`,
          }),
        });
        stats.external++;
      }
      continue;
    }

    // ★ T-#44 + ★ T-#50：**类型转换也是 call 形态**（`int64(x)` / `float64(x)`）
    //   ⇒ 只看 `GO_BUILTIN_CALLEES` 会漏掉它们（实测 int64 11 · float64 9 · Int64 7 落 failed）。
    if (
      BUILTIN_CALLEES.has(expr) ||
      (isGoFile && (GO_BUILTIN_CALLEES.has(expr) || GO_BUILTIN_TYPES.has(expr))) ||
      (isShellFile && SHELL_CALLEES.has(expr))
    ) {
      updExternal.run({ i: r.id, cd: JSON.stringify({ verdict: 'external', why: 'builtin-callee' }) });
      stats.external++;
      continue;
    }

    // ★★★ 2026-10-19（v9）：**先查"这个裸名是不是来自 package import"** —— 是则 external。
    //   这是"查绑定表"而不是"猜"：`import { readdirSync } from 'node:fs'` 让 readdirSync
    //   有了明确来源 ⇒ 它不可能是"项目内未解析的调用"，判 external 才诚实。
    //   ★ 放在 relative 查找【之前】：package 绑定是更强的证据（它是声明出来的）。
    // ★★★ 2026-10-27（T-#89）：**裸名是局部绑定 ⇒ external**（不是跨文件引用）。
    //
    // ## 病史（读数据定位，两条都是“循环解构出来的局部变量”）
    //   TS：`for (const { re, make } of …) holds.push(make(m))` —— `make` 是解构出的函数值
    //   Go：`for _, opt := range opts { opt(t) }` —— `opt` 是 range 变量
    //   ⇒ 两者都是**局部变量**，而裸名路径**从不查 `localBindingOf`**
    //     （它只在**带点接收者**那条路用过，判 `local-receiver-untyped`）
    //     ⇒ 白白落 `failed`。
    // ★ 放在 `pkgSrc` **之前**：局部绑定会 **shadow** 导入（JS/Go 都是）。
    const bareLocalFn = localBindingOf(rel, expr, r.line);
    if (bareLocalFn) {
      updExternal.run({
        i: r.id,
        cd: JSON.stringify({ verdict: 'external', why: 'local-binding', detail: bareLocalFn }),
      });
      stats.external++;
      continue;
    }
    const pkgSrc = packageBindingsByFile.get(rel)?.get(expr);
    if (pkgSrc) {
      updExternal.run({ i: r.id, cd: JSON.stringify({ verdict: 'external', why: 'package-import' }) });
      stats.external++;
      continue;
    }

    // ★★★ 2026-10-27（T-#53）：**同文件内的裸名调用** —— 原先**从来没查过**。
    //
    // ## 病史（实测）
    // 下面整段只做**跨文件**：`pkgSrc` → imports 绑定 → `findCrossFileTarget`（**只走 imports**）
    // → Go 同包 → 否则 failed。
    // ⇒ **同文件里定义的函数永远找不到** ⇒ `pushEdge` 4 · `ownerOf` 4 · `walk` 10 · `run` 6 全卡在这。
    // ⇒ 而且我上一轮把 `pushEdge`/`ownerOf` 索引进 `nodes` 之后**仍然 failed** ——
    //   证明问题不在"有没有节点"，在"**有没有人去查同文件**"。
    //
    // ## 为什么安全
    // 同文件的符号**不需要"证明来源"**（它就在这个文件里，作用域天然成立）——
    // 那条"必须由 import 绑定"的纪律是为**跨文件**防误连写的，不该套到同文件上。
    const sameFileSym = symbolsByFile.get(rel)?.has(expr)
      ? (db
          .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $f AND name = $n LIMIT 1')
          .get({ f: rel, n: expr }) as { kind: string; qualified_name: string } | undefined)
      : undefined;
    if (sameFileSym) {
      insEdge.run({
        src: r.from_node_id,
        tgt: `${rel}#${sameFileSym.qualified_name}`,
        k: 'call',
        ln: r.line,
        md: null,
      });
      updResolved.run({ i: r.id, n: `${rel}#${sameFileSym.qualified_name}` });
      stats.resolved++;
      continue;
    }

    // ★ 2026-10-21：跨文件建边也要**能证明来源** —— 这个裸名必须真的从某个相对导入绑定进来
    //   （静态 `import { x }` 或动态 `const { x } = await import()`）。只靠「目标文件里恰好有同名符号」
    //   会把本地闭包/形参连到别的文件（实测 3 条：sanitize / reject / langOfFile）。
    // ★★★ 2026-10-27（T-#64）：**动态 import 已进索引**（`module_analysis` 在解析期记 `imports` 行）
    //   ⇒ 不再需要 `dynamicImportsOf()` 那条**事后文本正则** ——
    //   **一张绑定表同时服务静态与动态导入**（这正是“两套尺”病根的修法）。
    const boundByName = relBindingsByFile.get(rel)?.has(expr) ?? false;
    // 无点调用：沿 relative imports 定位目标文件（目标必须是**可调用**符号）
    const target =
      (boundByName
        ? findCrossFileTarget(db, relImportsByFile, projectRoot, rel, expr, symbolsByFile, ['function', 'const'], miss, indexedFiles)
        : null)
      ?? findGoSamePackageTarget(db, rel, expr, ['function'], goFilesByDir)
      // ★ T-#62：**适配器驱动的跨包/跨文件解析**（Go 的 module 路径 → 目录就在这层生效）
      ?? resolveViaAdapter(rel, expr, ['function', 'const', 'method', 'type']);
    if (target) {
      insEdge.run({ src: r.from_node_id, tgt: `${target.file}#${target.qn}`, k: 'call', ln: r.line, md: CROSS_META });
      updResolved.run({ i: r.id, n: `${target.file}#${target.qn}` });
      stats.resolved++;
    } else {
      // ★ 2026-10-22：别名再导出没接上时，failed 的 why 要说清楚是哪一种（歧义/仓外/未索引/符号不在）
      // ★ T-#63：「目标存在但不在索引 / 在仓外」⇒ **明确外部**，不是漏连（实测 dist import 13 条）
      const missWhy2 = miss[0]?.why;
      if (missWhy2 === 'reexport-target-not-indexed' || missWhy2 === 'reexport-target-outside-repo') {
        updExternal.run({
          i: r.id,
          cd: JSON.stringify({
            verdict: 'external',
            why: missWhy2,
            ...(miss[0]?.detail ? { detail: miss[0].detail } : {}),
          }),
        });
        stats.external++;
      } else {
        markUnresolved(r.id, missWhy2 ?? 'cross-target-not-found', miss[0]?.detail);
      }
    }
  }
  // ★ T-#67：**算「上一次判定 → 本次判定」的分布**（一次性扫，不做 N 次点查）
  if (priorVerdict.size > 0) {
    const overrides: Record<string, number> = {};
    const nowRows = db
      .prepare("SELECT id, status FROM unresolved_refs WHERE status IN ('resolved','external','failed')")
      .all() as Array<{ id: number; status: string }>;
    for (const row of nowRows) {
      const pv = priorVerdict.get(row.id);
      if (!pv) continue;
      const key = `${pv}→${row.status}`;
      overrides[key] = (overrides[key] ?? 0) + 1;
    }
    stats.overrides = overrides;
  }
  if (ownTx) db.exec('COMMIT');
    } catch (e) {
      if (ownTx) db.exec('ROLLBACK');
      throw e;
    }
  return stats;
}

/** TS/JS 内置与全局常见类型（type_ref 解析黑名单，external 不建边） */
const BUILTIN_TYPES = new Set([
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
  'null', 'undefined', 'readonly', 'Array', 'Record', 'Partial', 'Required', 'Readonly', 'Pick',
  'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters', 'Awaited', 'Promise',
  'Function', 'Error', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Iterable',
  'IterableIterator', 'Generator', 'AsyncGenerator', 'HTMLElement', 'Event', 'Node',
  // ★★★ 2026-10-27（T-#44）：补 **TS lib 内置类型**（实测漏了它们 ⇒ 落进 failed）。
  //   `RegExpExecArray` 等在 `lib.es5.d.ts` 里是全局 interface，源码里**不需要 import**
  //   ⇒ `packageBindingsByFile` 看不到它 ⇒ 只能靠这张表。
  'RegExpExecArray', 'RegExpMatchArray', 'PropertyKey', 'ThisType', 'ThisParameterType',
  'OmitThisParameter', 'TemplateStringsArray', 'Uppercase', 'Lowercase', 'Capitalize',
  'Uncapitalize', 'InstanceType', 'ConstructorParameters', 'WeakRef', 'FinalizationRegistry',
  // ★ 实测漏的：ReadonlySet(23) 等同族容器类型（TS lib，不需 import）
  'ReadonlySet', 'ReadonlyMap', 'ReadonlyArray', 'ArrayLike', 'PromiseLike', 'AsyncIterable',
  'AsyncIterableIterator', 'Iterator', 'IteratorResult', 'Disposable', 'AsyncDisposable',
  // ★ @types/node 的全局（不需 import 就能用）
  'Buffer', 'NodeJS', 'NodeRequire', 'Timer', 'NodeJS.Timeout',
  // ★ T-#54：TypedArray / Promise 结果类型（**TS lib 全局**，不需 import）
  'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer',
  'DataView', 'PromiseRejectedResult', 'PromiseFulfilledResult', 'PromiseSettledResult',
  // ★★★ 2026-10-27（T-#78）：**删掉一整批"补偿性表项"** —— 它们是 T-#50/T-#58 为
  //   「`type_ref` 丢 receiver」这个 bug 打的补丁：因为 `http.ServerResponse` 在索引里只剩
  //   `ServerResponse`（receiver 丢了），判不出它是外部包成员 ⇒ 只能在这里硬堆名字。
  //   **T-#77 修好真因**（带点类型记全名 ⇒ 走 `namespace-member-of-package` 有据判定）后，
  //   这批表项**成了补丁的化石**：留着会掩盖真问题，而且**换个项目就漏**。
  //   ⇒ 已删：ServerResponse · IncomingMessage · ClientRequest · Server · Socket · AddressInfo ·
  //     Dirent · Stats · StatsFs · BigIntStats · EventEmitter · Readable · Writable · Duplex ·
  //     Transform · PassThrough · ChildProcess · Worker · MessagePort · AbortSignal ·
  //     DatabaseSync · StatementSync · FSWatcher · StatsWatcher · Ignore · CompilerOptions ·
  //     McpServer · ZodRawShape · ZodType · Parser · Ajv · ErrorObject · SpawnSyncReturns ·
  //     ChildProcessWithoutNullStreams
  //   ★ 保留 `Timeout` / `ErrnoException` —— 它们是 **`NodeJS.X` 的尾名**，
  //     源码里常以**裸名**出现（`import type { Timeout } from 'node:timers'` 之后），
  //     带点判定救不到，且它们是**真全局类型**。
  'Timeout', 'ErrnoException',
]);

/**
 * ★★★ 2026-10-27（T-#44）：**Go 的内置类型 / 内置函数单独一张表**。
 *
 * 为什么不并进 `BUILTIN_TYPES`：Go 的 `int` / `max` / `min` / `new` / `close` / `copy`
 * 在 TS 里**完全可能是本仓的真函数名**（实测本仓就有 `max`/`close`）
 * ⇒ 并成一张表会**把本仓真符号判成 external ⇒ 丢边**。
 * ⇒ 判据：**只对 `.go` 文件启用这两张表**（`rel.endsWith('.go')`，零查询）。
 * ★ 这就是「每门语言都要有自己的内置表」的落地形态（见 `parse/kernel.ts#LANG_ADAPTERS` 的 §4）。
 */
/**
 * ★ T-#56：**已知全局命名空间**（带点调用的接收者如果是它们，就不是“判不了”，而是“本来就外部”）。
 * 用途：把 `dotted-unprovable` 这个 13953 条的大桶拆成 `builtin-namespace` / `local-receiver-untyped`。
 * ★ 只用于**细分 `why`**，不参与建边决策 —— 所以宁可多列，不误伤（判错只影响标签可读性）。
 */
const BUILTIN_NAMESPACES = new Set([
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Promise',
  'Reflect', 'Symbol', 'Intl', 'Map', 'Set', 'WeakMap', 'WeakSet', 'ArrayBuffer', 'DataView',
  'console', 'process', 'global', 'globalThis', 'Buffer', 'structuredClone',
  'fs', 'path', 'os', 'url', 'util', 'crypto', 'http', 'https', 'net', 'tls', 'stream', 'events',
  'child_process', 'zlib', 'readline', 'assert', 'querystring', 'worker_threads', 'sqlite',
]);

const GO_BUILTIN_TYPES = new Set([
  'bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
  'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string',
  'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'any', 'comparable',
  // ★★★ 2026-10-27（T-#78）：**删掉 Go 标准库类型名的 tail** —— 与 TS 侧同一个理由。
  //   它们是 T-#50/T-#51/T-#54 为「`type_ref` 丢 receiver」打的补丁：
  //   `ast.Ident` 在索引里只剩 `Ident` ⇒ 判不出是外部包成员 ⇒ 只能硬堆名字。
  //   **T-#77 修好真因**（带点类型记全名 ⇒ `namespace-member-of-package` 有据判定）后，
  //   这批表项成了**补丁的化石**（而且换个项目就漏）。
  //   ⇒ 已删：Ident · Object · Scope · File · Package · SelectorExpr · CallExpr · FuncDecl ·
  //     Stmt · Expr · Decl · Spec · Node · Token · Position · Pos · Comment · Field · Time ·
  //     Duration · Location · Month · Weekday · Buffer · Reader · Writer · Context · IndexExpr ·
  //     BlockStmt · ReturnStmt · ParenExpr · UnaryExpr · BinaryExpr · BasicLit · TypeSwitchStmt ·
  //     SwitchStmt · IfStmt · ForStmt · RangeStmt · AssignStmt · ExprStmt · DeclStmt · LabeledStmt ·
  //     BranchStmt · DeferStmt · GoStmt · IncDecStmt · SendStmt · FileSet · Mutex · RWMutex ·
  //     WaitGroup · Once · Map · Pool · Cond · Int64 · Uint64 · Float64 · AtomicInt64 · FuncLit ·
  //     CompositeLit · KeyValueExpr · GenDecl · ValueSpec · TypeSpec · ImportSpec · SelectStmt ·
  //     CaseClause · CommClause · StarExpr · IndexListExpr · FieldList · ArrayType · MapType ·
  //     ChanType · InterfaceType · StructType · FuncType · Ellipsis · Builder · DirEntry · MemStats
  //   ★ 只保留**真正的 Go 内置原始类型**（它们在语法上就没有包前缀）。
]);
/**
 * ★ T-#51：**Shell 外部命令 / 内建** —— 只对 `.sh`/`.bash`/`.zsh` 启用。
 * 实测 `printf` 6 · `node` 5 · `grep` 2 · `echo` 2 · `tr` 1 · `cut` 1 落 failed。
 * ★ 为什么不分语言不行：`node` / `printf` / `echo` 在 TS 里可能是真函数名。
 */
const SHELL_CALLEES = new Set([
  'printf', 'echo', 'node', 'npx', 'npm', 'pnpm', 'yarn', 'grep', 'egrep', 'sed', 'awk', 'cut',
  'tr', 'sort', 'uniq', 'wc', 'head', 'tail', 'cat', 'tee', 'find', 'xargs', 'dirname', 'basename',
  'read', 'local', 'export', 'source', 'eval', 'exec', 'test', 'true', 'false', 'exit', 'cd',
  'pushd', 'popd', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'ln', 'chmod', 'chown', 'touch',
  'git', 'curl', 'wget', 'jq', 'sleep', 'kill', 'wait', 'shift', 'set', 'unset', 'trap', 'date',
  'python', 'python3', 'pip', 'go', 'cargo', 'make', 'cmake', 'docker', 'ssh', 'scp', 'rsync',
]);

const GO_BUILTIN_CALLEES = new Set([
  'len', 'cap', 'make', 'new', 'append', 'copy', 'delete', 'close',
  'panic', 'recover', 'print', 'println', 'complex', 'real', 'imag', 'min', 'max', 'clear',
]);

/**
 * ★★★ 2026-10-27（T-#84）：**`java.lang` 的真全局** —— 只对 `.java` 文件启用。
 *
 * ## 病史（我 T-#80 删错了一次，**全量重建**才抓出来）
 * T-#80 我把整张 `JAVA_BUILTIN_TYPES` 当"化石"删了，理由是
 * 「`import java.io.IOException;` 会进 `pkgSrc`，表是重复的」。**那只对了一半**：
 *   · `java.io` / `java.nio` / `java.util` 的类 **需要 import** ⇒ `pkgSrc` 能看见 ⇒ **确实是化石**
 *   · **`java.lang` 的类【不需要 import】**（`String` / `Object` / `Exception` / `StringBuilder` …）
 *     ⇒ `pkgSrc` **永远看不见** ⇒ **表是必要的**
 * 实测：删表后全量重建 `failed` 14 → **43**，新增 29 条全是
 *   `String 14 · Object 6 · StringBuilder 4 · Throwable 2 · Number · Exception · Boolean`
 *   —— **全在 `.java` 文件里**。
 *
 * ## 判据（这张表该放什么、不该放什么）
 * ✅ **放**：语法上**不需要 import** 就能用的名字（`java.lang`）
 * ❌ **不放**：需要 import 的包成员（`java.io.IOException` / `java.nio.file.Path` / `java.util.List` …）
 *   —— 那些走 `pkgSrc`（package 绑定），**有据**。
 * ★ 这是「每张 `*_BUILTIN_*` 表都要问一句：它是不是在掩盖缺失的解析能力」的**反面**：
 *   问完还要再问一句「**这些名字真的不需要 import 吗**」——
 *   **两个问题都答对了，表才是对的**。
 *
 * ★ 为什么不并进 `BUILTIN_TYPES`：`String` / `Object` / `Number` 在 TS 里也是常用名，
 *   并表会把本仓同名符号判成 external ⇒ 丢边（同 Go 的教训）。
 */
const JAVA_LANG_TYPES = new Set([
  // 基本类型的包装类 + 字符串
  'String', 'Object', 'Integer', 'Long', 'Short', 'Byte', 'Character', 'Boolean', 'Double', 'Float',
  'Number', 'Void', 'CharSequence', 'StringBuilder', 'StringBuffer',
  // 异常体系
  'Exception', 'RuntimeException', 'Error', 'Throwable', 'StackTraceElement',
  // 工具 / 系统
  'Math', 'StrictMath', 'System', 'Runtime', 'Process', 'Class', 'Package', 'Module',
  // 类型体系 / 常用接口
  'Enum', 'Record', 'Override', 'Runnable', 'Thread', 'ThreadLocal', 'Iterable', 'Iterator',
  'Comparable', 'Comparator', 'AutoCloseable', 'Cloneable', 'Appendable', 'Readable',
]);


/** 沿源文件的 relative imports 找符号对应的目标符号（首个命中）；找不到返回 null。
 *  namesByFile：候选符号名集合（call=全符号表，type_ref=仅 interface/type/class） */
/**
 * ★★★ 2026-10-27（T-#85）：**`bindings` 里的别名形态**（`"remote as local"`）。
 *
 * `localOf` 取**本地名**（`boundByName` / `pkgSrc` 用）
 * `remoteOf` 取**远端名**（★ **去目标文件里搜符号时必须用它**）
 * ★ 无别名的条目原样返回 ⇒ 对旧数据 / 绝大多数情况零影响。
 */
const localOf = (b: string): string => {
  const i = b.indexOf(' as ');
  return i >= 0 ? b.slice(i + 4) : b;
};
const remoteOf = (b: string): string => {
  const i = b.indexOf(' as ');
  return i >= 0 ? b.slice(0, i) : b;
};

function findCrossFileTarget(
  db: Database,
  relImportsByFile: Map<string, Array<{ source: string; line: number; bindings?: string | null }>>,
  projectRoot: string,
  fromRel: string,
  name: string,
  namesByFile: Map<string, Set<string>>,
  /** 目标必须是的符号 kind（call → function/const；type_ref → interface/type/class）；缺省不限 */
  kinds?: readonly string[],
  /** 没建边的原因出口（re-export 那一段会往里投「为什么跳过」） */
  miss?: ReexportMiss[],
  /** 已建索引的文件集：区分「目标不在索引里」与「目标里没这个符号」 */
  indexedFiles?: ReadonlySet<string>,
): { file: string; qn: string } | null {
  const imports = relImportsByFile.get(fromRel);
  if (!imports) return null;
  const seen = new Set<string>();
  for (const imp of imports) {
    const target = resolveImportTarget(projectRoot, fromRel, imp.source);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const syms = namesByFile.get(target);
    // ★★★ 2026-10-27（T-#85）：**别名导入要去目标文件找【远端名】**（`import { remote as local }`）。
    //   病史：原先拿本地名 `name` 去搜 ⇒ `import { designDbDir as designDbDirOf }` 永远找不到
    //   （目标文件里只有 `designDbDir`）⇒ 永远 failed。实测 6/14 条剩余 failed 全是这个。
    //   ★ 只对**本条 import** 生效：它的 `bindings` 里有 `"X as name"` ⇒ 用 `X`；否则用 `name`。
    let want = name;
    if (imp.bindings) {
      try {
        for (const b of JSON.parse(imp.bindings) as string[]) {
          if (b === name) break; // 无别名同名词条 ⇒ 用原名
          if (localOf(b) === name) {
            want = remoteOf(b);
            break;
          }
        }
      } catch {
        /* 坏 JSON ⇒ 用原名 */
      }
    }
    // ★★★ 2026-10-27（T-#63 修）：**目标文件解析到了、但它不在索引里** ⇒ 必须记进 `miss`。
    //   病史：`certs/*.mjs` / `scripts/*.mjs` 从 `dist/` import —— `dist` 磁盘上存在（`resolveImportTarget`
    //   的 `existsSync` 通过）但**不在索引里** ⇒ `namesByFile.get(target)` 是 `undefined`
    //   ⇒ 下面什么都不命中 ⇒ **`miss` 空** ⇒ 落到兜底 `cross-target-not-found` ⇒ 看起来像"漏连"。
    //   而语义上它**是明确的外部**（目标文件已知、只是没索引）。
    if (!syms) {
      // ★★ 2026-10-27 二次修正：**不能 `continue`** —— 第一版在这里 `continue`，
      //   结果**跳过了下面的 barrel 再导出那条路** ⇒ 实测 `resolved` 掉 **237 条**。
      //   ⇒ 只记 `miss`，**照旧往下走**（目标文件没索引 ≠ 它没有 barrel）。
      miss?.push({ why: 'reexport-target-not-indexed', detail: target });
    } else if (syms.has(want)) {
      // 目标文件确有该符号 → 取 qualified_name（重名取首个，v1 近似）
      const q = db
        .prepare('SELECT kind, qualified_name FROM nodes WHERE file_path = $tp AND name = $n LIMIT 1')
        .get({ tp: target, n: want }) as { kind: string; qualified_name: string } | undefined;
      if (q && (!kinds || kinds.includes(q.kind))) return { file: target, qn: q.qualified_name };
    }
    // ★ 2026-10-21：barrel re-export —— 目标文件只是 `export { x } from './kernel.js'`，符号在下一层。
    // ★ 2026-10-22：别名再导出同样走这里（`import { A as B }; export { B }`）——
    //   resolveReexportTarget 拿**来源真名 A** 去查，不是拿 B 猜。
    //   判据见 resolveReexportTarget：候选必须**唯一**，同 barrel 里同名冲突 ⇒ 不猜（保持 failed 并记 why）。
    const viaBarrel = resolveReexportTarget(db, projectRoot, target, name, namesByFile, kinds, 0, new Set(), miss, indexedFiles);
    if (viaBarrel) return viaBarrel;
  }
  return null;
}

/**
 * ★ 2026-10-22（DB 补全·调用边）：**仓内跨文件类型成员**的唯一判据。
 *
 * ## 补的是哪一种「没成边」
 *   `classifyCall` 手里只有**本文件**的符号表 ⇒ 遇到 `reg.register()`（`reg` 的声明类型 T 声明在另一个文件）
 *   它只能报 `external / receiver-type-external:T`。而那句标签的意思是「**T 是仓外类型**」——
 *   T 明明在仓内。**同文件尺的子集结论被当成了全局结论**：边没建，标签还在说假话。
 *
 * ## 判据（两条都要能证；证不出就不建边 —— 与「错连比漏连坏」同一条纪律）
 *   ① **类型唯一**：T 在本文件**相对导入**的目标文件里恰好声明 1 次（0 次 = 仓外 / >1 次 = 同名歧义 ⇒ 都不证）；
 *   ② **成员唯一**：那个文件里叫 `memberName` 的节点恰好 1 个，且属主就是 T（`parent` 允许是限定名，比尾段）。
 *   ⇒ 两个出处都是**库里的行**（`nodes`），不是把源码再正则猜一遍；与同文件 `typed-member` 是同一把尺，
 *     只是把「本文件」换成「本文件的一跳相对导入」。
 *
 * ## 三种结果（第三种是给标签纠谎用的，不是给建边用的）
 *   · `hit`                    ⇒ 可建边（跨文件 ⇒ `metadata={cross:true}`）
 *   · `type-in-repo-no-member` ⇒ T 在仓内，但成员证不出来（接口成员只记在 `nodes.members` JSON 里；
 *     或类型推断错）⇒ **调用方必须把原因写对**，不许继续说「T 是仓外类型」
 *   · `no-type`                ⇒ 相对导入里没有这个类型 ⇒ 原判定（external）成立，调用方保持不动
 *
 * ## 限度（明写，别让下游以为这是全解）
 *   · 只走**一跳**相对导入：barrel 再导出的类型不在这里展开（那是 `findCrossFileTarget` 的 re-export 路）；
 *   · 只认 `class|interface|type` 的声明节点。
 */
/**
 * ★ 2026-10-22（DB 补全·调用边）：**仓内跨文件类型成员**的唯一判据（两趟共用，判据只有这一份）。
 *
 * ## 补的是哪一种「没成边」
 *   `classifyCall` 手里只有**本文件**的符号表 ⇒ 遇到 `reg.register()`（`reg` 的声明类型 T 声明在另一个文件）
 *   它只能报 `external / receiver-type-external:T`。而那句标签的意思是「**T 是仓外类型**」——
 *   T 明明在仓内。**同文件尺的子集结论被当成了全局结论**：边没建，标签还在说假话。
 *
 * ## 判据（两条都要能证；证不出就不建边 —— 与「错连比漏连坏」同一条纪律）
 *   ① **类型唯一**：T 在本文件**相对导入**的目标文件里恰好声明 1 次（0 次 = 仓外 / >1 次 = 同名歧义 ⇒ 都不证）；
 *   ② **成员唯一**：那个文件里叫 `memberName` 的节点恰好 1 个，且属主就是 T（`parent` 允许是限定名，比尾段）。
 *   ⇒ 两个出处都是**库里的行**（`nodes`），不是把源码再正则猜一遍；与同文件 `typed-member` 是同一把尺，
 *     只是把「本文件」换成「本文件的一跳相对导入」。
 *
 * ## 三种结果（第三种是给标签纠谎用的，不是给建边用的）
 *   · `hit`                    ⇒ 可建边（跨文件 ⇒ `metadata={cross:true}`）
 *   · `type-in-repo-no-member` ⇒ T 在仓内，但成员证不出来（接口成员只记在 `nodes.members` JSON 里；
 *     或类型推断错）⇒ **调用方必须把原因写对**，不许继续说「T 是仓外类型」
 *   · `no-type`                ⇒ 相对导入里没有这个类型 ⇒ 原判定（external）成立，调用方保持不动
 *
 * ## 谁调它（两趟，但判据只有这一份）
 *   · 第一趟 `applyParsedToIndex`：**只做快路径**（目标符号此刻已在库里就顺手建边）；
 *   · 第二趟 `resolveCrossFileCalls`：**记账的终审**。为什么必须有第二趟：冷重建时按路径顺序解析，
 *     `a.ts` 先于 `b.ts` ⇒ 第一趟看不见 `b.ts` 的类，判据必然落空（实测：全量重建后 8 条边一条没建，
 *     单独重解析才建出来）。**顺序不该改变事实** ⇒ 定论放在全库符号表齐了之后。
 *
 * ## 限度（明写，别让下游以为这是全解）
 *   · 只走**一跳**相对导入：barrel 再导出的类型不在这里展开（那是 `findCrossFileTarget` 的 re-export 路）；
 *   · 只认 `class|interface|type` 的声明节点（接口方法不在 `nodes` 里 ⇒ 见 `type-in-repo-no-member`）。
 */
function makeImportedTypeMemberLookup(
  db: Database,
  projectRoot: string,
  fromRel: string,
  relImportSources: readonly string[],
): (
  typeName: string,
  memberName: string,
) => { kind: 'hit'; file: string; qn: string } | { kind: 'type-in-repo-no-member'; file: string } | { kind: 'no-type' } {
  // 本文件相对导入的目标文件集（与 import 边同口径：同一个 resolveImportTarget）
  const targets = new Set<string>();
  for (const source of relImportSources) {
    const t = resolveImportTarget(projectRoot, fromRel, source);
    if (t) targets.add(t);
  }
  const qDecl = db.prepare("SELECT file_path FROM nodes WHERE name = $n AND kind IN ('class','interface','type')");
  const qMember = db.prepare('SELECT qualified_name, parent FROM nodes WHERE file_path = $f AND name = $m');
  /** 类型名 → 声明文件（null = 证不出）。一张文件的同步里同一个 T 会被问很多次（`reg.xxx()` 一整片） */
  const declCache = new Map<string, string | null>();
  const declFileOf = (typeName: string): string | null => {
    if (declCache.has(typeName)) return declCache.get(typeName) ?? null;
    const files = new Set<string>();
    for (const r of qDecl.all({ n: typeName }) as Array<{ file_path: string }>) {
      if (targets.has(r.file_path)) files.add(r.file_path);
    }
    const file = files.size === 1 ? [...files][0] : null;
    declCache.set(typeName, file);
    return file;
  };
  return (typeName, memberName) => {
    const file = declFileOf(typeName);
    if (!file) return { kind: 'no-type' };
    const hits = (
      qMember.all({ f: file, m: memberName }) as Array<{ qualified_name: string; parent: string | null }>
    ).filter((r) => (r.parent ?? '') === typeName || (r.parent ?? '').split('.').pop() === typeName);
    if (hits.length === 1) return { kind: 'hit', file, qn: hits[0].qualified_name };
    return { kind: 'type-in-repo-no-member', file };
  };
}

/**
 * 删除侦测（轻量形态）：比对 files 表与本次全量扫描列表，
 * 清掉磁盘上真的不存在的文件的缓存行。在每次 sync 时顺带做，
 * 不做 fs 监听（监听属序号 11，届时换 removeFile 实时触发）。
 *
 * ★★ 函数名骗人：它判的是「**不在本次走查范围**」，不是「已删除」。
 *   走查规则会主动跳过一批**仍然存在**的文件（`.gitignore` 命中的 `scripts/check_*.mjs`、
 *   `test_*.ts`，以及 `ARCHIVE_DIRS` 下的归档文件）——它们不在 absPaths 里，但磁盘上好好的。
 *   若只看「不在走查列表」就清行 ⇒ 这些越界文件每轮被删、又被 watch 收回来，形成拉锯。
 *   ⇒ 判据必须是「不在走查列表 **且** `fs.existsSync` 为 false」。
 *   注意：本函数只做**止损**（不误删）；"走查规则本身不读 gitignore"是另一件事。
 *
 * absPaths 必须是【完整】扫描列表（max_files 截断之前），否则误删。
 * ★ 「本文件管哪些行」走**源码尺**（`codeSourceExtSet()` = 可解析 ∩ 代码语言 + 小写归一 + 缓存，
 *   `source_exts.ts` 的唯一用法）——与 `import_project.walkFiles` / `watch_project.shouldSyncRel`
 *   **同一把尺**（"建"与"裁"两端同源）。
 *   ⇒ 其它工具写入的**非源码** files 行（`.md`/`.json`/`.html`…）不归本次 prune 管，
 *   不受 import_project 扫描列表影响，避免多工具共享缓存时互踩。
 * ★ 为什么不用 `isSupported`（改前）：那只答"能不能解析"，`.json` 恰在差集里 ⇒ 会把别的工具/旧库的
 *   `.json` 行也当成"已删的源码"清掉 —— 两会话前 `walkFiles`（D6）犯的是同一个错（用错尺回答"什么算源码"）。
 *
 * @param retainedOut 可选收集器：不在走查列表、但磁盘上仍在的文件（= 被走查规则排除的"越界未索引"）。
 *                    供调用方在回执里与"真的删了"分开说 —— 两者以前被同一句话报成"已从磁盘删除"。
 * @returns 被清理（真删除）的相对路径列表。
 */
export function pruneDeletedFiles(
  db: Database,
  projectRoot: string,
  absPaths: string[],
  retainedOut?: string[],
): string[] {
  const alive = new Set(absPaths.map((p) => toRelPath(projectRoot, p)));
  // ★ 与 walkFiles/watch 共用 L1 的唯一用法（源码尺）——一次建集，逐行 `has` 查
  const codeExts = codeSourceExtSet();
  const rows = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const outOfWalk = rows
    .map((r) => r.path)
    .filter((rel) => codeExts.has(path.posix.extname(rel).toLowerCase()) && !alive.has(rel));
  // ★ 「不在走查列表」只是**嫌疑**：磁盘还在 ⇒ 是走查规则主动跳过的（gitignore / test_* / ARCHIVE_DIRS），
  //   行必须保留；磁盘真没了 ⇒ 才是删除。这一句是本函数唯一的真相来源。
  const dead: string[] = [];
  for (const rel of outOfWalk) {
    if (fs.existsSync(path.join(projectRoot, rel))) retainedOut?.push(rel);
    else dead.push(rel);
  }
  if (dead.length === 0) return [];
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN IMMEDIATE');
  try {
    for (const rel of dead) removeFileRel(db, rel);
    if (ownTx) db.exec('COMMIT');
  } catch (e) {
    if (ownTx) db.exec('ROLLBACK');
    throw e;
  }
  return dead;
}

// ─────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────

export interface CachedSymbol {
  kind: string;
  name: string;
  qualified_name: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  /** 0/1：局部闭包/辅助函数（不进 DSL 契约面，仍保留供搜索/引用） */
  is_closure?: number;
}

export interface CachedImport {
  line: number;
  source: string;
  kind: 'relative' | 'package';
}

export interface CachedFileParse {
  line_count: number;
  symbols: CachedSymbol[];
  imports: CachedImport[];
}

/**
 * 读取单文件的缓存解析结果（import_project 缓存路径用）。
 * 文件未索引（未同步过 / 上次解析失败）返回 null。
 * 符号按 start_line 排序，与 kernel 文档序一致，保证 50 上限截断行为与全量解析相同。
 */
export function getFileParse(db: Database, relPath: string): CachedFileParse | null {
  const indexed = db.prepare('SELECT 1 x FROM files WHERE path = $p').get({ p: relPath });
  if (!indexed) return null;
  const fileNode = db.prepare("SELECT end_line FROM nodes WHERE id = $p AND kind = 'file'").get({ p: relPath }) as
    | { end_line: number }
    | undefined;
  if (!fileNode) return null;
  const symbols = db
    .prepare(
      `SELECT kind, name, qualified_name, start_line, end_line, signature, is_closure
       FROM nodes WHERE file_path = $p AND kind != 'file'
       ORDER BY start_line, id`,
    )
    .all({ p: relPath }) as unknown as CachedSymbol[];
  const imports = db
    .prepare('SELECT line, source, kind FROM v_imports WHERE file_path = $p ORDER BY line, source')
    .all({ p: relPath }) as unknown as CachedImport[];
  return { line_count: fileNode.end_line, symbols, imports };
}


/** FTS5 全文检索符号（trigram：中文/标识符子串均可；<3 字符直接返回空） */
export function searchSymbols(db: Database, query: string, limit = 20): SymbolHit[] {
  const q = query.trim();
  if (q.length < 3) return [];
  const phrase = `"${q.replace(/"/g, '""')}"`;
  const rows = db
    .prepare(
      `SELECT n.id, n.kind, n.name, n.qualified_name, n.file_path, n.start_line
       FROM nodes_fts f JOIN nodes n ON n.rowid = f.rowid
       WHERE nodes_fts MATCH $q AND n.kind != 'file'
       ORDER BY rank LIMIT $lim`,
    )
    .all({ q: phrase, lim: limit }) as unknown as SymbolHit[];
  return rows;
}

/** 索引概况（状态报告 / Hub 展示用） */
export function getIndexStats(db: Database): IndexStats {
  const files = db.prepare('SELECT COUNT(*) c FROM files').get() as { c: number };
  const nodes = db.prepare('SELECT COUNT(*) c FROM nodes').get() as { c: number };
  const edges = db.prepare('SELECT COUNT(*) c FROM edges').get() as { c: number };
  const last = db.prepare('SELECT MAX(indexed_at) m FROM files').get() as { m: number | null };
  return { files: files.c, nodes: nodes.c, edges: edges.c, last_indexed_at: last.m };
}

// ─────────────────────────────────────────────────────────────
// expandClosure 索引快速路径：反查 API
// ─────────────────────────────────────────────────────────────

/** 索引是否有任何已索引文件（空库/未建索引 → 快路径不可用） */
export function hasAnyIndexedFiles(db: Database): boolean {
  const row = db.prepare('SELECT 1 x FROM files LIMIT 1').get() as { x: number } | undefined;
  return !!row;
}

/** 文件是否已在索引中（cache.db 快路径：未索引文件需回退解析） */
export function isFileIndexed(db: Database, relPath: string): boolean {
  const row = db.prepare('SELECT 1 x FROM files WHERE path = $p').get({ p: relPath }) as { x: number } | undefined;
  return !!row;
}

/**
 * TS/JS 相对导入出边：文件 f 直接 import 了哪些目标文件（已解析为项目内 relPath）。
 * 来源 edges(kind='import')——syncFile 时对 relative import 建的已解析边。
 * Go/Python 包导入不在本查询里（包路径未建边，走 getRawImportsOfFile + 现场 resolve）。
 */
export function getResolvedImportTargets(db: Database, relPath: string): string[] {
  const rows = db
    .prepare("SELECT target FROM edges WHERE source = $p AND kind = 'import'")
    .all({ p: relPath });
  return (rows as Array<{ target: string }>).map((r) => r.target);
}

/**
 * TS/JS 相对导入入边：哪些已索引文件直接 import 了文件 relPath。
 * 来源 edges(kind='import')——只覆盖 TS/JS 相对导入场景（Go/Python
 * 包导入走 findFilesImportingAnySource 按原始 source 串反查）。
 */
export function getResolvedImportSources(db: Database, relPath: string): string[] {
  const rows = db
    .prepare("SELECT source FROM edges WHERE target = $p AND kind = 'import'")
    .all({ p: relPath });
  return (rows as Array<{ source: string }>).map((r) => r.source);
}

/**
 * 读文件的原始 import 记录（imports 表；覆盖相对 + 包导入全部种类）。
 * 与 getFileParse().imports 等价，但不读符号表——快路径只做闭包不关心符号，
 * 走本条更轻量。TS `import type` (type_only=1) 运行时擦除，闭包不算边。
 */
export function getRawImportsOfFile(
  db: Database,
  relPath: string,
): Array<{ source: string; kind: 'relative' | 'package'; type_only: boolean; line: number }> {
  const rows = db
    .prepare('SELECT source, kind, type_only, line FROM v_imports WHERE file_path = $p ORDER BY line')
    .all({ p: relPath });
  return (rows as Array<{ source: string; kind: 'relative' | 'package'; type_only: number; line: number }>)
    .map((r) => ({ source: r.source, kind: r.kind, type_only: r.type_only === 1, line: r.line }));
}

/**
 * 按原始 import.source 串反查：哪些已索引文件 import 了任一给定 source。
 * 用于 Go 包路径 / Python 点分模块的「反向引用」查询（这些语言的包导入
 * 不在 edges(kind='import') 建边，但 source 字符串完整存在于 imports 表）。
 *
 * 例（Go）：seed 属包 `github.com/x/agent-shell/internal/context`，
 * 传 sources=[该包路径] → 返回所有 `import "github.com/x/agent-shell/internal/context"`
 * 的文件（即 seed 的跨文件调用方）。
 *
 * 支持精确匹配 IN (...)：Go/Python 包导入本身就是精确串，无需 LIKE。
 * TS `import type` 的行不影响闭包（闭包语义是「运行时/编译期都连」，
 * 但保守起见本查询仍返回，调用方可按 type_only 再过滤——闭包多收比漏收好）。
 */
export function findFilesImportingAnySource(db: Database, sources: string[]): string[] {
  if (sources.length === 0) return [];
  const placeholders = sources.map((_, i) => `$${i}`).join(',');
  const stmt = db.prepare(`SELECT DISTINCT file_path FROM v_imports WHERE source IN (${placeholders})`);
  const bind = Object.fromEntries(sources.map((s, i) => [String(i), s]));
  const rows = stmt.all(bind);
  return (rows as Array<{ file_path: string }>).map((r) => r.file_path);
}