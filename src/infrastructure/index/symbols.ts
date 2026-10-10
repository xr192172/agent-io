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
import { parseFileFull, parseFileFullSync, listSupportedExtensions, resolveImportPath, type ParsedFile } from '../parse/index.js';
// ★ 「什么算源码」走 L1 唯一权威（`source_exts.ts` 的 `codeSourceExts` = 可解析 ∩ 代码语言）——
//   本文件不再用 `isSupported`（那是"能不能解析"，不是"算不算源码"）回答"哪些缓存行算源码"。
import { codeSourceExts } from '../parse/source_exts.js';
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

/** 绝对路径 → 相对 projectRoot 的 posix 路径（节点/文件表的统一键） */
export function toRelPath(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
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
    return { ok: false, early: { path: rel, status: 'skipped', node_count: 0, edge_count: 0 } };
  }

  return {
    ok: true,
    pre: { rel, fail, content, stat, hash, existing, ext: path.extname(rel).slice(1).toLowerCase() },
  };
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
      .prepare('SELECT from_hash, to_hash, added, removed, changed, norm_from, norm_to FROM symbol_diffs WHERE file_path = $p')
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
  if (ownTx) db.exec('BEGIN');
  try {
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
    const insNode = db.prepare(
      `INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, signature, docstring, sym_hash, is_closure, updated_at)
       VALUES ($id, $k, $nm, $qn, $fp, $lang, $sl, $el, $par, $sig, NULL, $h, $isClos, $ts)`,
    );
    const seenIds = new Set<string>();
    parsed.symbols.forEach((s, i) => {
      let id = `${rel}#${s.qualified_name}`;
      if (seenIds.has(id)) id = `${id}:L${s.start_line}`; // 文件内重名（如 TS 重载）
      seenIds.add(id);
      insNode.run({
        id: id, k: s.kind, nm: s.name, qn: s.qualified_name, fp: rel, lang: ext,
        sl: s.start_line, el: s.end_line, par: s.parent ?? null, sig: s.signature ?? null,
        h: symHashList[i], isClos: s.is_closure ? 1 : 0, ts: now,
      });
    });

    // 2.1 符号级 diff 落库（v3）：diffImpact 的波及源数据。首次导入 symbolDiff=undefined 不写
    if (symbolDiff) {
      db.prepare(
        `INSERT OR REPLACE INTO symbol_diffs(file_path, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at)
         VALUES ($fp, $from, $to, $added, $removed, $changed, $nf, $nt, $ts)`,
      ).run({
        fp: rel, from: symbolDiff.from, to: hash,
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
      `INSERT OR IGNORE INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, file_path, language, status, name_tail)
       VALUES ($from, $rn, 'call', $ln, 0, $fp, $lang, 'pending', $nt)`,
    );
    let callCount = 0;
    for (const c of parsed.calls) {
      const srcId = idOf(c.caller);
      if (!nodeIdSet.has(srcId)) continue; // qn 漂移坏边：跳过不炸事务
      if (c.resolved && c.callee_qn && nodeIdSet.has(idOf(c.callee_qn))) {
        insCall.run({ src: srcId, tgt: idOf(c.callee_qn), ln: c.line });
        callCount++;
      } else {
        insUnresolved.run({ from: srcId, rn: c.callee_expr, ln: c.line, fp: rel, lang: ext, nt: c.callee });
      }
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
      `INSERT OR IGNORE INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, file_path, language, status, name_tail)
       VALUES ($from, $rn, 'type_ref', $ln, 0, $fp, $lang, 'pending', $nt)`,
    );
    for (const t of parsed.type_refs) {
      const srcId = idOf(t.referrer);
      if (!nodeIdSet.has(srcId)) continue; // 同上：qn 漂移坏边防御
      if (t.resolved && t.target_qn && nodeIdSet.has(idOf(t.target_qn))) {
        insTypeRef.run({ src: srcId, tgt: idOf(t.target_qn), ln: t.line });
      } else {
        insUnresolvedType.run({ from: srcId, rn: t.type_name, ln: t.line, fp: rel, lang: ext, nt: t.type_name });
      }
    }

    // 4. 原始 import 记录（全量种类：relative + package）
    //    import_project 缓存路径靠它重建依赖边——edges 表只有已解析的相对导入，
    //    Go 包路径 / Python 点分模块的原始 source 串只存在这里
    db.prepare('DELETE FROM imports WHERE file_path = $p').run({ p: rel });
    const insImport = db.prepare('INSERT INTO imports(file_path, line, source, kind, type_only) VALUES ($fp, $ln, $src, $kind, $typeOnly)');
    for (const imp of parsed.imports) {
      insImport.run({ fp: rel, ln: imp.line, src: imp.source, kind: imp.kind, typeOnly: imp.type_only ? 1 : 0 });
    }

    // 5. files 行
    db.prepare(
      `INSERT OR REPLACE INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash)
       VALUES ($path, $hash, $lang, $size, $mtime, $ts, $nc, NULL, $nh)`,
    ).run({ path: rel, hash, lang: ext, size: stat.size, mtime: Math.round(stat.mtimeMs), ts: now, nc: parsed.symbols.length, nh: normHash });

    if (ownTx) db.exec('COMMIT');
    return {
      path: rel, status: 'updated', node_count: parsed.symbols.length, edge_count: edgeCount, call_count: callCount,
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
  if (ownTx) db.exec('BEGIN');
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
    const row = db.prepare('SELECT added, removed, changed FROM symbol_diffs WHERE file_path = $p').get({ p: rel }) as
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
export async function syncProject(
  db: Database,
  projectRoot: string,
  absPaths: string[],
): Promise<SyncProjectResult> {
  const t0 = Date.now();
  const results: SyncFileResult[] = [];
  for (const p of absPaths) {
    results.push(await syncFile(db, projectRoot, p));
  }
  const by = (s: SyncStatus) => results.filter((r) => r.status === s).length;
  // 收尾：跨文件调用解析（同文件未命中的调用沿 imports 解析到目标文件符号；幂等，只处理 pending）
  const cross = resolveCrossFileCalls(db, projectRoot);
  return {
    total: results.length,
    updated: by('updated'),
    skipped: by('skipped'),
    ignored: by('ignored'),
    failed: by('failed'),
    ms: Date.now() - t0,
    results,
    cross: {
      total: cross.total,
      resolved: cross.resolved,
      external: cross.external,
      failed: cross.failed,
    },
  };
}

/** 按相对路径删除一个文件的全部缓存行（nodes 级联清边与 FTS） */
function removeFileRel(db: Database, rel: string): void {
  db.prepare('DELETE FROM nodes WHERE file_path = $p').run({ p: rel });
  db.prepare('DELETE FROM files WHERE path = $p').run({ p: rel });
  db.prepare('DELETE FROM imports WHERE file_path = $p').run({ p: rel });
}

/** 文件从项目删除时调用：清节点（级联清边与 FTS）+ files 行 + 原始 import 记录 */
export function removeFile(db: Database, projectRoot: string, absPath: string): void {
  removeFileRel(db, toRelPath(projectRoot, absPath));
}

// ─────────────────────────────────────────────────────────────
// 跨文件调用解析（路线图序号 3 第二步）
// ─────────────────────────────────────────────────────────────

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
]);

export interface CrossFileResolveStats {
  total: number;
  /** import 限定解析成功，已写 edges(kind=call, cross) */
  resolved: number;
  /** 内置 / 外部 / 局部变量调用，标 status='external' */
  external: number;
  /** 未匹配到目标符号，标 status='failed'（不再重试） */
  failed: number;
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
            `SELECT id, from_node_id, reference_name, reference_kind, line FROM unresolved_refs
             WHERE status='pending' AND reference_kind IN ('call','type_ref')
               AND (${scope.map((_, i) => `from_node_id LIKE $s${i}`).join(' OR ')})`,
          )
          .all(Object.fromEntries(scope.map((f, i) => [`s${i}`, `${f}#%`])))
      : db
          .prepare(
            "SELECT id, from_node_id, reference_name, reference_kind, line FROM unresolved_refs WHERE status='pending' AND reference_kind IN ('call','type_ref')",
          )
          .all()
  ) as Array<{ id: number; from_node_id: string; reference_name: string; reference_kind: string; line: number }>;
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
  // 预加载：文件 → relative imports
  const relImportsByFile = new Map<string, Array<{ source: string; line: number }>>();
  for (const i of db.prepare("SELECT file_path, source, line FROM imports WHERE kind='relative'").all() as Array<{ file_path: string; source: string; line: number }>) {
    let arr = relImportsByFile.get(i.file_path);
    if (!arr) {
      arr = [];
      relImportsByFile.set(i.file_path, arr);
    }
    arr.push(i);
  }

  const updResolved = db.prepare("UPDATE unresolved_refs SET status='resolved' WHERE id = $i");
  const updExternal = db.prepare("UPDATE unresolved_refs SET status='external' WHERE id = $i");
  const updFailed = db.prepare("UPDATE unresolved_refs SET status='failed' WHERE id = $i");
  const insEdge = db.prepare(
    'INSERT OR IGNORE INTO edges(source, target, kind, line, col, metadata) VALUES ($src, $tgt, $k, $ln, NULL, $md)',
  );
  const CROSS_META = JSON.stringify({ cross: true });

  const stats: CrossFileResolveStats = { total: rows.length, resolved: 0, external: 0, failed: 0 };
  // ★ 索引**不完整**阶段（后台续建途中）不要急着判 failed：目标符号可能只是还没索引到。
  //   一旦标 failed 就永不重试 ⇒ 最终索引会永久缺跨文件边。此时留 pending，等补完再一次性定论。
  const keepPending = opts.keepUnresolvedPending === true;
  const markUnresolved = (id: number): void => {
    if (keepPending) return;
    updFailed.run({ i: id });
    stats.failed++;
  };
  // ★★ 事务包裹（2026-09-14 实测的关键修正）：本函数要写大量 edges / unresolved_refs 行。
  //   不包事务 = 每条语句各自 autocommit ⇒ **每条一次 fsync** ⇒ 实测 20 文件规模的一批要 1.7s
  //   （后台补齐 42s 里 27s 全在这里）。外层已有事务（如冷启 bootstrap）时自动降级为 no-op。
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN');
  try {
  for (const r of rows) {
    const rel = r.from_node_id.split('#')[0];
    const expr = r.reference_name;
    const kind = r.reference_kind as 'call' | 'type_ref';

    if (kind === 'type_ref') {
      if (BUILTIN_TYPES.has(expr)) {
        updExternal.run({ i: r.id });
        stats.external++;
        continue;
      }
      const t = findCrossFileTarget(db, relImportsByFile, projectRoot, rel, expr, typeNamesByFile);
      if (t) {
        insEdge.run({ src: r.from_node_id, tgt: `${t.file}#${t.qn}`, k: 'type_ref', ln: r.line, md: CROSS_META });
        updResolved.run({ i: r.id });
        stats.resolved++;
      } else {
        markUnresolved(r.id);
      }
      continue;
    }

    if (expr.includes('.')) {
      // 有点调用：内置前缀 external；其余（局部变量/Go 包调用）保守 external
      updExternal.run({ i: r.id });
      stats.external++;
      continue;
    }

    if (BUILTIN_CALLEES.has(expr)) {
      updExternal.run({ i: r.id });
      stats.external++;
      continue;
    }

    // 无点调用：沿 relative imports 定位目标文件，符号表命中即解析
    const target = findCrossFileTarget(db, relImportsByFile, projectRoot, rel, expr, symbolsByFile);
    if (target) {
      insEdge.run({ src: r.from_node_id, tgt: `${target.file}#${target.qn}`, k: 'call', ln: r.line, md: CROSS_META });
      updResolved.run({ i: r.id });
      stats.resolved++;
    } else {
      markUnresolved(r.id);
    }
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
]);

/** 沿源文件的 relative imports 找符号对应的目标符号（首个命中）；找不到返回 null。
 *  namesByFile：候选符号名集合（call=全符号表，type_ref=仅 interface/type/class） */
function findCrossFileTarget(
  db: Database,
  relImportsByFile: Map<string, Array<{ source: string; line: number }>>,
  projectRoot: string,
  fromRel: string,
  name: string,
  namesByFile: Map<string, Set<string>>,
): { file: string; qn: string } | null {
  const imports = relImportsByFile.get(fromRel);
  if (!imports) return null;
  const seen = new Set<string>();
  for (const imp of imports) {
    const target = resolveImportTarget(projectRoot, fromRel, imp.source);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    const syms = namesByFile.get(target);
    if (syms && syms.has(name)) {
      // 目标文件确有该符号 → 取 qualified_name（重名取首个，v1 近似）
      const q = db
        .prepare('SELECT qualified_name FROM nodes WHERE file_path = $tp AND name = $n LIMIT 1')
        .get({ tp: target, n: name }) as { qualified_name: string } | undefined;
      if (q) return { file: target, qn: q.qualified_name };
    }
  }
  return null;
}

/**
 * 删除侦测（轻量形态）：比对 files 表与本次全量扫描列表，
 * 清掉磁盘上已不存在的文件的缓存行。在每次 sync 时顺带做，
 * 不做 fs 监听（监听属序号 11，届时换 removeFile 实时触发）。
 *
 * absPaths 必须是【完整】扫描列表（max_files 截断之前），否则误删。
 * ★ 「本文件管哪些行」走**源码尺**（`codeSourceExts` = 可解析 ∩ 代码语言，`source_exts.ts` 的唯一合成点）——
 *   与 `import_project.walkFiles` / `watch_project.shouldSyncRel` **同一把尺**（"建"与"裁"两端同源）。
 *   ⇒ 其它工具写入的**非源码** files 行（`.md`/`.json`/`.html`…）不归本次 prune 管，
 *   不受 import_project 扫描列表影响，避免多工具共享缓存时互踩。
 * ★ 为什么不用 `isSupported`（改前）：那只答"能不能解析"，`.json` 恰在差集里 ⇒ 会把别的工具/旧库的
 *   `.json` 行也当成"已删的源码"清掉 —— 两会话前 `walkFiles`（D6）犯的是同一个错（用错尺回答"什么算源码"）。
 * 返回被清理的相对路径列表。
 */
export function pruneDeletedFiles(db: Database, projectRoot: string, absPaths: string[]): string[] {
  const alive = new Set(absPaths.map((p) => toRelPath(projectRoot, p)));
  // ★ 与 walkFiles/watch 同一合成点（源码尺）——一次建集，逐行 `has` 查
  const codeExts = new Set(codeSourceExts(listSupportedExtensions()).map((e) => e.toLowerCase()));
  const rows = db.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const dead = rows
    .map((r) => r.path)
    .filter((rel) => codeExts.has(path.posix.extname(rel).toLowerCase()) && !alive.has(rel));
  if (dead.length === 0) return [];
  const ownTx = !inTransaction(db);
  if (ownTx) db.exec('BEGIN');
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
    .prepare('SELECT line, source, kind FROM imports WHERE file_path = $p ORDER BY line, source')
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
    .prepare('SELECT source, kind, type_only, line FROM imports WHERE file_path = $p ORDER BY line')
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
  const stmt = db.prepare(`SELECT DISTINCT file_path FROM imports WHERE source IN (${placeholders})`);
  const bind = Object.fromEntries(sources.map((s, i) => [String(i), s]));
  const rows = stmt.all(bind);
  return (rows as Array<{ file_path: string }>).map((r) => r.file_path);
}