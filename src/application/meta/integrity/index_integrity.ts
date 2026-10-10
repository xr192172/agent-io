/**
 * index_integrity —— **索引可信度自检**（只读）
 *
 * 为什么需要（用户 2026-09-14：「目标是为了让 LLM 使用良好。你觉得怎样做能做到极致？」）：
 *   索引层的唯一目标是"让 LLM **敢用**"。而"敢用"的前提是：**它不撒谎**。
 *   可 LLM 无法自己判断"我这次读到的图是不是旧的" —— 除非有人能**把可信度当结果返回**。
 *   本工具就是那个入口：一句话回答「你的索引现在可信吗，哪里不可信，怎么修」。
 *
 * 一句话不变量（整个索引层只服务它）：
 *   **任何时刻，LLM 通过工具读到的索引内容，要么与磁盘一致，要么明确标注它可能旧/不全。**
 *
 * 报告的核心指标是 **`stale_resolved`（陈旧断言）**：
 *   `unresolved_refs` 里 `status='resolved'`（声称"连上了某个符号"），
 *   但那个 `reference_name` **已经不在索引里**的行数。
 *   这类行对应 `find_references` / `impact_analysis` 上的**静默漏报** ——
 *   是最危险的一种错：不是"查不到"，而是"查到了但少了几条"，LLM 不会察觉。
 *
 * 为什么它**默认不改状态**（只读）：一个"自检"如果顺手改了状态，那它报告的就是"改完之后"的，
 * 而不是"LLM 马上要读到"的现状 —— 那就成了另一种撒谎。
 * 需要顺手修复时显式传 `refresh: true`（走 `ensureProjectIndex` 的保鲜路径）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { reopenRefsTo, resolveCrossFileCalls } from '../../../infrastructure/index/symbols.js';
import { getProjectView } from '../../../infrastructure/project_view.js';
import { INDEX_SKIP_DIR_EXTRA, isNoiseFileName, isTestFileName, isUnderSkippedDir } from '../../../infrastructure/parse/source_exts.js';
import { hasLiveIndex } from '../../write_gate.js';
import { pendingSelfWrites } from '../../../infrastructure/index/self_writes.js';
import { backfillState, backfillSummary, isIndexIncomplete } from '../../../infrastructure/index/index_backfill.js';
import { ensureProjectIndex, type IndexState, type FreshnessReport } from '../../../infrastructure/index/index_freshness.js';
import { walkFiles } from '../../../infrastructure/graph/import_project.js';
import { summarizeLanguagesByTier, type LanguageTierSummary } from '../../refactor/parse_capability/parse_capability.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** 源码文件按类拆分（本体 / 测试 / 噪音）。★ 见 ④ 处的长注释：两把尺差的就是这两个类 */
export interface FileKindCounts {
  /** 本体（真正的源码）—— **本应全覆盖**，缺一个就是缺陷 */
  main: number;
  /** 测试文件 —— 索引器 `include_tests=false` 时**有意排除** */
  test: number;
  /** 噪音/产物（`.min.js` `.d.ts` `*.gen.ts` `.swp` …）—— 不该算进任何一个数 */
  noise: number;
  /** ★ 目录维度：位于**索引器本就不收**的目录下（`output/` `third_party/<pkg>/bin/` …）—— 可解释，不是缺陷 */
  excluded: number;
}

export interface IntegrityIssue {
  /** 机器可读的问题码 */
  code: string;
  /** 严重度：blocker=LLM 读到的东西可能是错的 / warn=可能不全 / info=仅提示 */
  severity: 'blocker' | 'warn' | 'info';
  /** 人读一句 */
  message: string;
  /** 修复建议（可执行的下一步） */
  fix?: string;
}

export interface IndexIntegrityResult {
  project_root: string;
  /** 索引状态：ready / partial（被上限截断）/ empty（还没有可用索引） */
  state: IndexState;
  /** 是否顺手做了保鲜（refresh:true） */
  refreshed: boolean;
  /** refresh:true 时顺手做的修复说明（陈旧引用重开等）；没做则 undefined */
  repair?: string;

  counts: {
    /** 索引里收录的文件数 */
    indexed_files: number;
    /** 磁盘上走查到的源码文件数（口径 = refs_text.walkSourceFiles） */
    disk_files: number;
    /** 磁盘有、索引没有（= 未索引区，拼图模式下正常） */
    not_indexed: number;
    /** ★ 磁盘源码按类拆分（本体/测试/噪音）—— 别只报一个"未索引"，那是两把尺的差 */
    disk_files_by_kind: FileKindCounts;
    /** 已索引按类拆分 */
    indexed_files_by_kind: FileKindCounts;
    /** 未索引按类拆分。★ `main > 0` 才是**真缺陷**；`test` 是 `include_tests=false` 的**有意结果** */
    not_indexed_by_kind: FileKindCounts;
    /**
     * 索引有、**磁盘上没有**（= 需要清理的幽灵行）。
     * ★ 判据 = 该路径 `fs.existsSync` 为 false —— **不是**"不在源码走查集里"。
     *   为什么必须用 fs 存在性（2026-10-11 修）：原实现是 `!diskSet.has(p)`，而 `diskSet` 是
     *   **源码走查**（`walkSourceFiles`，只收代码类扩展名）⇒ 任何被索引、却**不是代码类**的文件
     *   （典型：`include_docs`/编辑路径落进索引的 `.md` 文档）都被误判成"幽灵"。实测本仓：
     *   索引里 6 个 `.md` **都在磁盘上**，却被报成 6 条幽灵，且它给的 fix（`refresh:true 清理`）
     *   是**空操作**（保鲜的删除侦测按 `fs.existsSync` 判定，磁盘在 ⇒ 不删）——"说了做了、但没做"。
     */
    ghosts: number;
    nodes: number;
    edges: number;
  };

  refs: {
    /** 未决（还没解析，可能是拼图没长到） */
    pending: number;
    /** 已解析（连上了符号） */
    resolved: number;
    /** 外部/内置（不建边，正常） */
    external: number;
    /** 明确连不上 */
    failed: number;
    /**
     * ★★ **陈旧断言**：说自己 resolved，但 `reference_name` 已不在索引里。
     * 这些行对应的边早已被 FK 级联删掉且不会重建 ⇒ find_references / impact **静默漏报**。
     * 可信度报告里这是**唯一一个 blocker 级**的指标。
     */
    stale_resolved: number;
  };

  freshness: {
    /** 已索引文件里 stat 与库记录不一致的个数（需要保鲜） */
    not_fresh: number;
    /** 抽样列出的文件名（最多 20 条，供定位） */
    not_fresh_sample: string[];
    /**
     * ★★ **refresh 覆盖不到**的那部分未保鲜文件（2026-10-11 加）。
     * 判据 = 该相对路径**不在保鲜重同步范围内**（范围 = 索引器的 `walkFiles(root,false,false)`：
     * 只走查**代码类**源码、且 `include_tests=false`）。典型：索引里的 `.md` 文档 ——
     * 它们能进索引（`include_docs`/编辑路径），却**永不被保鲜重解析**。
     * 为什么单列：`refresh:true` 之后若仍有 blocker，工具**必须**说清"哪些是 refresh 覆盖不到的"，
     * 否则就会一边标"已保鲜"、一边留着没消的 blocker（**它自己给的 fix 对自己无效**）。
     * ★ 仅当 `refresh:true` 时非空（只在保鲜范围内才有资格谈"覆盖"）。
     */
    not_fresh_out_of_scope: string[];
    /** 待消费的自写登记文件数（同步写工具登记过、还没被读路径消费） */
    self_writes_pending: number;
  };

  backfill: string;
  /** P10 能力自述：已索引文件按语言的解析层级汇总（文件数降序；渲染时截前 8 行） */
  languages: LanguageTierSummary[];
  issues: IntegrityIssue[];
  /**
   * ★★★ **综合判定（三态，机读）** —— 唯一判据见 {@link integrityVerdict}。
   * 与 `consistency_check` 的 `comparisonState` **同款纪律**（本仓先例，见 `intent/consistency.ts`）：
   *   · `trusted`   = **查了、没发现**（有可用索引，且无 blocker、无幽灵行）
   *   · `untrusted` = **查了、发现了**（有 blocker，或存在幽灵行 —— ★ 幽灵**属于**这里）
   *   · `unknown`   = **查不了 / 没得查**（还没有可用索引 ⇒ **给不出结论**，不是"可信"也不是"不可信"）
   * ★ 为什么必须三态（2026-10-11 修）：原先只有一个布尔 `trustworthy`，规则是
   *   `state!=='empty' && stale_resolved===0 && notFreshCount===0` —— **幽灵行压根没进判据**
   *   ⇒ 造出幽灵文件时 headline 照旧说"✅ 可信"（**算了判据，却不拿它定 headline**）。
   *   而"查不了"（无索引）也被塌进 `false`，与"不可信"混为一谈。
   */
  verdict: 'trusted' | 'untrusted' | 'unknown';
  /**
   * 布尔口径（**保留**，= `verdict === 'trusted'`）：`true` = 眼下读到的东西可以当真。
   * ★ 只回答"可信吗"；"为什么不可信 / 是不是查不了"看 {@link verdict} 与 {@link summary}。
   */
  trustworthy: boolean;
  /**
   * refresh:true 时的**保鲜回执**（原样记录保鲜实际做了什么）—— 没传 refresh 则 undefined。
   * ★ 为什么要有它：headline 不许在没做事时宣称做了事。有了逐项计数，
   *   "本次已跑保鲜"才能落在**具体做了多少**上，而不是一句空口承诺。
   */
  refresh_receipt?: {
    checked: number;
    resynced: number;
    added: number;
    removed: number;
    failed: number;
    skipped_adds: number;
    bootstrapped: number;
    state: IndexState;
  };
  /** 人读一句总结（供 LLM 直接引用） */
  summary: string;
}

/** 已索引文件与磁盘 stat 不一致的抽样上限（报告别被长列表淹没） */
const NOT_FRESH_SAMPLE = 20;

/**
 * ★ **修复陈旧引用**：把"声称 resolved、但目标名已不在索引"的引用重新打开并重解析。
 *
 * 为什么这件事只有这里能做：保鲜路径（`ensureFreshIndex`）靠**文件内容变了**来触发重开
 * （`symbol_diffs` 是它的输入）。而"陈旧断言"的成因是**索引自身**与磁盘脱节
 * （索引被手改、写入异常、跨进程竞争……），文件内容没变 ⇒ 保鲜路径看不见它。
 * 唯一可靠的线索就是这批**行本身**：它们的 `reference_name` 就是需要重开的符号名。
 *
 * 成本：一次 `reopenRefsTo`（纯 SQL）+ 一次按引用方文件收窄的 resolve。
 */
export function repairStaleResolvedRefs(
  db: ReturnType<typeof getProjectCacheDb>,
  root: string,
): { names: number; reopened: number; cross: { total: number; resolved: number; external: number; failed: number } } {
  const rows = db
    .prepare(
      `SELECT DISTINCT u.reference_name AS nm
       FROM unresolved_refs u
       WHERE u.status = 'resolved'
         AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
    )
    .all() as Array<{ nm: string }>;
  const names = rows.map((r) => r.nm).filter(Boolean);
  if (!names.length) return { names: 0, reopened: 0, cross: { total: 0, resolved: 0, external: 0, failed: 0 } };
  const r = reopenRefsTo(db, names);
  const cross =
    r.files.length > 0
      ? resolveCrossFileCalls(db, root, { scopeFiles: r.files, keepUnresolvedPending: isIndexIncomplete(root) })
      : { total: 0, resolved: 0, external: 0, failed: 0 };
  return { names: names.length, reopened: r.reopened, cross };
}

/**
 * ★★★ **三态判定的唯一定义** —— 与 `consistency_check` 的 `comparisonState` 同款纪律
 * （本仓先例：`intent/consistency.ts` 的 `comparisonState`，同样只吃两个数、**同一处判**）。
 *
 * | 态 | 含义 | 判据 |
 * |---|---|---|
 * | `unknown`   | **查不了 / 没得查**（还没有可用索引） | `!hasIndex` |
 * | `untrusted` | **查了、发现了**（有 blocker，或存在幽灵行） | `hasIndex && (hasBlocker || hasGhost)` |
 * | `trusted`   | **查了、没发现** | `hasIndex && !hasBlocker && !hasGhost` |
 *
 * ★ 关键边界①：**幽灵行（ghost）属于 `untrusted`，不是"看不见"** —— 索引里有一行、磁盘上没有，
 *   任何"基于索引"的读数都可能指向一个不存在的东西 ⇒ headline 不许说"可信"（2026-10-11 修）。
 * ★ 关键边界②：**"查不了" ≠ "不可信"**。无索引时给不出结论，必须**主动说清**，
 *   不能塌进 `trustworthy:false`（那会被读成"查过了、有问题"）。
 */
export function integrityVerdict(args: {
  /** 有没有可用索引（`false` ⇒ 查不了） */
  hasIndex: boolean;
  /** 有没有 blocker 级问题（陈旧断言 / 未保鲜文件 …） */
  hasBlocker: boolean;
  /** 有没有幽灵行（索引有、磁盘无） */
  hasGhost: boolean;
}): 'trusted' | 'untrusted' | 'unknown' {
  if (!args.hasIndex) return 'unknown';
  return args.hasBlocker || args.hasGhost ? 'untrusted' : 'trusted';
}

/** 保鲜回执：把 `FreshnessReport` 收成结果里那几项（**原样**搬运，不加工、不隐瞒） */
function receiptOf(
  r: FreshnessReport,
  state: IndexState,
): NonNullable<IndexIntegrityResult['refresh_receipt']> {
  return {
    checked: r.checked,
    resynced: r.resynced,
    added: r.added,
    removed: r.removed,
    failed: r.failed,
    skipped_adds: r.skipped_adds,
    bootstrapped: r.bootstrapped,
    state,
  };
}

/**
 * 索引可信度自检。
 * @param opts.refresh true = 先跑一次保鲜（`ensureProjectIndex`）再报告；默认 false（纯只读）
 * @param opts.sample  抽样条数上限（默认 20）
 */
async function indexIntegrityCore(opts: {
  project_dir: string;
  refresh?: boolean;
  sample?: number;
}): Promise<IndexIntegrityResult> {
  const root = path.resolve(opts.project_dir);
  const sampleN = Math.max(0, opts.sample ?? NOT_FRESH_SAMPLE);
  const issues: IntegrityIssue[] = [];
  let refreshed = false;
  let state: IndexState = 'empty';

  let db: ReturnType<typeof getProjectCacheDb> | null = null;
  /** refresh:true 时的保鲜回执（原样记录保鲜实际做了什么；未 refresh 则 null） */
  let refreshReport: FreshnessReport | null = null;
  if (opts.refresh === true) {
    const idx = await ensureProjectIndex(root);
    db = idx.db;
    state = idx.state;
    refreshReport = idx.report;
    refreshed = true;
  } else if (hasLiveIndex(root)) {
    try {
      db = getProjectCacheDb(root);
      state = 'ready';
    } catch {
      db = null;
    }
  }

  // ── 还没有可用索引 ──
  if (!db) {
    return {
      project_root: root,
      state: 'empty',
      refreshed,
      counts: {
        indexed_files: 0,
        disk_files: 0,
        not_indexed: 0,
        ghosts: 0,
        nodes: 0,
        edges: 0,
        disk_files_by_kind: { main: 0, test: 0, noise: 0, excluded: 0 },
        indexed_files_by_kind: { main: 0, test: 0, noise: 0, excluded: 0 },
        not_indexed_by_kind: { main: 0, test: 0, noise: 0, excluded: 0 },
      },
      refs: { pending: 0, resolved: 0, external: 0, failed: 0, stale_resolved: 0 },
      freshness: {
        not_fresh: 0,
        not_fresh_sample: [],
        not_fresh_out_of_scope: [],
        self_writes_pending: pendingSelfWrites(root).length,
      },
      backfill: backfillSummary(backfillState(root)),
      languages: [],
      issues: [
        {
          code: 'no_index',
          severity: 'warn',
          message: '该项目还没有可用索引（cache.db 不存在或为空）',
          fix: '传 refresh:true 就地建立，或直接用任意读工具（零前置冷启会自动建）',
        },
      ],
      // ★ 三态：无索引 = **查不了**（给不出结论），不是"不可信"，也不是"可信"。
      verdict: integrityVerdict({ hasIndex: false, hasBlocker: false, hasGhost: false }),
      trustworthy: false,
      ...(refreshReport !== null ? { refresh_receipt: receiptOf(refreshReport, state) } : {}),
      summary:
        '索引**不可用（查不了）**：还没有建索引 ⇒ **给不出可信与否的结论**。' +
        '此时任何"基于索引"的查询都应先建索引（传 refresh:true，或用任意读工具触发零前置冷启）。',
    };
  }

  const one = (sql: string): number => {
    try {
      return (db!.prepare(sql).get() as { c: number } | undefined)?.c ?? 0;
    } catch {
      return 0;
    }
  };

  // ── 计数 ──
  const indexed_files = one('SELECT COUNT(*) c FROM files');
  const nodes = one('SELECT COUNT(*) c FROM nodes');
  const edges = one('SELECT COUNT(*) c FROM edges');
  const diskList = (() => {
    try {
      // ★ 走 ProjectView（§19 第 ① 步）：同一轮工作里多处取用只 walk 一次
      return getProjectView(root).sourceFiles;
    } catch {
      return [];
    }
  })();
  const indexedSet = new Set(
    (db.prepare('SELECT path FROM files').all() as Array<{ path: string }>).map((r) => r.path),
  );
  const diskSet = new Set(diskList);
  // ★★ 三分类（本体 / 测试 / 噪音）—— 2026-09-28
  // 为什么必须分类，而不是只报一个"未索引 N"：**索引器与量具对"什么算源码"的口径本就不同** ——
  //   索引器默认 `include_tests=false` 跳过测试文件，而量具（`walkSourceFiles`）把测试算进"磁盘源码"
  //   ⇒ 只报一个数时，量具**必然永远**报"未索引 240"（实测其中 219 是 `tests/**/*.test.ts`），
  //   看起来像缺陷、实际是**有意排除**。分类后：`main` 缺口才是真信号，`test` 缺口是**可解释**的。
  const kindOf = (p: string): keyof FileKindCounts => {
    const n = path.basename(p);
    if (isNoiseFileName(n)) return 'noise';
    if (isTestFileName(n)) return 'test';
    // ★ 目录维度：索引器按自己的政策**本来就不会收**的文件 —— 归"可解释"，不归"本体缺口"。
    //   实测来源：`refs_text` 跳 out 却不跳 output/bin ⇒ 把 output/*.mjs 与 third_party/<pkg>/bin/*.mjs
    //   数成"本体未索引（真缺陷）"，追查后才发现是**跳过表分叉**（见 source_exts.ts 的长注释）。
    if (isUnderSkippedDir(p, INDEX_SKIP_DIR_EXTRA)) return 'excluded';
    return 'main';
  };
  const tally = (set: Iterable<string>): FileKindCounts => {
    const r: FileKindCounts = { main: 0, test: 0, noise: 0, excluded: 0 };
    for (const p of set) r[kindOf(p)] += 1;
    return r;
  };
  const disk_files_by_kind = tally(diskSet);
  const indexed_files_by_kind = tally(indexedSet);
  const notIndexedSet = [...diskSet].filter((p) => !indexedSet.has(p));
  const not_indexed_by_kind = tally(notIndexedSet);
  const not_indexed = notIndexedSet.length;
  // ★★ 幽灵行 = **索引里有、磁盘上却没有**（判据 = `fs.existsSync` 为 false）。
  //   2026-10-11 修：原实现是 `!diskSet.has(p)`，而 `diskSet` 是**源码走查**（只收代码类扩展名）
  //   ⇒ 任何"被索引、但不是代码类"的文件（本仓实测：6 个 `.md` 文档，全在磁盘上）被误报成幽灵，
  //   且它给的 fix（`refresh:true 清理`）是空操作（保鲜删除侦测按 `fs.existsSync` 判定，磁盘在 ⇒ 不删）。
  //   ⇒ 改成 fs 存在性：与字段自身定义（"磁盘上没有"）一致，也让 fix 真的可执行。
  const ghosts = [...indexedSet].filter((p) => !fs.existsSync(path.join(root, p))).length;

  // ── 引用状态 ──
  const byStatus = (s: string): number =>
    one(`SELECT COUNT(*) c FROM unresolved_refs WHERE status = '${s}'`);
  const staleCount = (): number =>
    one(
      `SELECT COUNT(*) c FROM unresolved_refs u
       WHERE u.status = 'resolved'
         AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
    );
  let stale_resolved = staleCount();

  // refresh:true ⇒ 顺手**修复陈旧引用**（保鲜路径看不见它们：那些文件内容根本没变，
  // `symbol_diffs` 是空的，所以只有靠"这些行本身"当线索）。报告的是修完之后的现状。
  let repair: string | undefined;
  if (refreshed && stale_resolved > 0) {
    try {
      const rep = repairStaleResolvedRefs(db, root);
      repair = `已重开 ${rep.reopened} 条陈旧引用（涉及 ${rep.names} 个符号名），重解析 ${rep.cross.total} 条`;
      stale_resolved = staleCount();
    } catch (e) {
      repair = `陈旧引用修复失败：${(e as Error).message}`;
    }
  }

  // ── 新鲜度（stat 比对；只 stat 不解析，O(已索引文件数)）──
  const notFresh: string[] = []; // 抽样展示（≤ sampleN）
  const notFreshAll: string[] = []; // 全量（供与"保鲜范围"求差）
  for (const rel of indexedSet) {
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(root, rel));
    } catch {
      continue; // 磁盘上没有 → 归到 ghosts 那类，不在这里报
    }
    const row = db.prepare('SELECT size, modified_at FROM files WHERE path = $p').get({ p: rel }) as
      | { size: number; modified_at: number }
      | undefined;
    if (!row) continue;
    if (row.size !== st.size || row.modified_at !== Math.round(st.mtimeMs)) {
      notFreshAll.push(rel);
      if (notFresh.length < sampleN) notFresh.push(rel);
    }
  }
  const notFreshCount = notFreshAll.length;

  // ★★ 保鲜**覆盖范围**（2026-10-11 加）：`ensureFreshIndex` 只重同步 `walkFiles(root,false,false)`
  //   —— 即**代码类源码、且 include_tests=false**。索引里若有该范围之外的文件（典型：`.md` 文档），
  //   它们**永远**落在"未保鲜"里 ⇒ `refresh:true` 之后 blocker 不消。
  //   这里把这批文件单独分出来 ⇒ headline 才能**如实说清"refresh 覆盖不到它们"**，
  //   而不是一边标"已保鲜"、一边留着未消的 blocker。
  //   仅在 `refresh:true` 时计算（只有真跑过保鲜，"覆盖不到"这句话才成立）。
  let notFreshOutOfScope: string[] = [];
  if (refreshed) {
    try {
      const scope = new Set(
        walkFiles(root, false, false).map((abs) => path.relative(root, abs).split(path.sep).join('/')),
      );
      notFreshOutOfScope = notFreshAll.filter((rel) => !scope.has(rel));
    } catch {
      /* 走查失败：不臆测，留空（headline 会退回"仍有 N 项不一致"的一般说法） */
    }
  }

  const selfWrites = pendingSelfWrites(root);

  // ── 问题清单（按能否"读到错东西"排序）──
  if (stale_resolved > 0) {
    issues.push({
      code: 'stale_resolved_refs',
      severity: 'blocker',
      message:
        `${stale_resolved} 条引用声称"已解析"但目标符号已不在索引里 —— ` +
        '这些边已被 FK 级联删掉且不会重建，find_references / impact 会**静默漏报**',
      fix: '传 refresh:true（会把它们重新打开并重解析：连得上重连、连不上明确标 failed）',
    });
  } else if (repair) {
    issues.push({ code: 'stale_refs_repaired', severity: 'info', message: repair });
  }
  if (notFreshCount > 0) {
    const outScopeN = notFreshOutOfScope.length;
    // ★ 保鲜之后仍有"未保鲜"时，**必须说清哪些是 refresh 覆盖不到的**（否则 headline 会
    //   "说了做了、但没做"——把没消的 blocker 藏在一句"已保鲜"后面）。
    const scopeNote = !refreshed
      ? ''
      : outScopeN > 0
        ? ` ★ 本次已跑 refresh，但其中 ${outScopeN} 个**不在保鲜重解析范围内**` +
          '（保鲜只走查**代码类**源码、`include_tests=false`）⇒ refresh **覆盖不到**它们：' +
          `${notFreshOutOfScope.slice(0, 5).join(', ')}${outScopeN > 5 ? ' …' : ''}`
        : ' （本次 refresh 已覆盖此范围 ⇒ 仍在列说明保鲜未收敛，见下方保鲜回执）';
    issues.push({
      code: 'files_not_fresh',
      severity: 'blocker',
      message: `${notFreshCount} 个已索引文件与磁盘不一致（自上次索引后被改过）${scopeNote}`,
      fix:
        outScopeN > 0
          ? 'refresh:true 只重同步**代码类**文件；★ 上面列出的非代码类（如 `.md`）不在其列 —— 需 `import_project({include_docs:true})` 重导入或从索引移除'
          : '传 refresh:true 重同步；或直接调读工具（保鲜路径会自动同步）',
    });
  }
  if (ghosts > 0) {
    issues.push({
      code: 'ghost_files',
      severity: 'warn',
      message: `索引里有 ${ghosts} 个文件在磁盘上已不存在（幽灵行）`,
      fix: '传 refresh:true 清理（保鲜的删除侦测按磁盘存在性判定，磁盘上已无的会被移除）',
    });
  }
  if (selfWrites.length > 0) {
    issues.push({
      code: 'self_writes_pending',
      severity: 'info',
      message: `有 ${selfWrites.length} 个文件由同步写工具登记过、尚未被读路径消费`,
      fix: '调用任意读工具或 refresh:true 即会优先同步它们',
    });
  }
  if (not_indexed_by_kind.main > 0) {
    issues.push({
      code: 'partial_coverage',
      severity: 'warn',
      message:
        `**本体**源码有 ${not_indexed_by_kind.main} 个尚未索引（本体 ${indexed_files_by_kind.main}/${disk_files_by_kind.main}）` +
        '—— 这个数非 0 就是**真缺陷**（本体本应全覆盖）',
      fix: '以某个文件为种子读它（会连带建块）；或让后台续建跑完',
    });
  }
  if (not_indexed_by_kind.test > 0) {
    issues.push({
      code: 'test_not_indexed',
      severity: 'info',
      message:
        `**测试**文件 ${not_indexed_by_kind.test} 个未入索引（测试 ${indexed_files_by_kind.test}/${disk_files_by_kind.test}）` +
        '—— 这是索引器 `include_tests=false` 的**有意结果**，不是缺陷。' +
        '★ 但**改名 / find_references 会看不到测试里的引用** ⇒ 需要时传 `include_tests=true` 重建。',
      fix: 'import_project({ include_tests: true }) —— 做引用/改名类判断时建议开',
    });
  }
  const bf = backfillState(root);
  if (bf?.running) {
    issues.push({
      code: 'backfill_running',
      severity: 'info',
      message: `后台续建进行中：${bf.done}/${bf.total}`,
    });
  }
  if (state === 'partial') {
    issues.push({
      code: 'truncated',
      severity: 'warn',
      message: '索引建立时被文件数上限截断（只索引了一部分）',
      fix: '提高上限或分批导入',
    });
  }

  // ★★ 综合判定：**由上面这批 issue（已算出的判据）导出**，不再另立一套数。
  //   2026-10-11 修：原先 `trustworthy = state!=='empty' && stale_resolved===0 && notFreshCount===0`
  //     —— 幽灵行**压根没进这条式子**（算了 `ghosts`、却没拿它定 headline）。
  //   现在：凡 blocker 级 issue，或有幽灵行 ⇒ `untrusted`；无索引 ⇒ `unknown`；其余 ⇒ `trusted`。
  //   `ghosts > 0` 单列（它是 warn，但按判据"索引指向不存在的东西"必须进 headline）。
  const hasBlocker = issues.some((i) => i.severity === 'blocker');
  const verdict = integrityVerdict({ hasIndex: state !== 'empty', hasBlocker, hasGhost: ghosts > 0 });
  const trustworthy = verdict === 'trusted';
  const summary =
    verdict === 'trusted'
      ? `索引可信：${indexed_files} 文件 / ${nodes} 节点 / ${edges} 边 ｜ 陈旧断言 0 ｜ 未保鲜文件 0 ｜ 幽灵行 0` +
        (not_indexed > 0 ? `（另有 ${not_indexed} 个文件未索引，属拼图按需状态）` : '')
      : verdict === 'unknown'
        ? '索引**不可用（查不了）**：还没有可用索引 ⇒ **给不出可信与否的结论**。'
        : `索引**不可信**：` +
          [
            stale_resolved ? `陈旧断言 ${stale_resolved} 条（会静默漏报引用）` : '',
            notFreshCount
              ? `${notFreshCount} 个文件自上次索引后被改过` +
                (refreshed && notFreshOutOfScope.length > 0
                  ? `（其中 ${notFreshOutOfScope.length} 个不在保鲜重解析范围内，refresh 覆盖不到）`
                  : '')
              : '',
            ghosts ? `${ghosts} 个幽灵行（索引有、磁盘无）` : '',
          ]
            .filter(Boolean)
            .join('；');

  return {
    project_root: root,
    state,
    refreshed,
    ...(repair ? { repair } : {}),
    counts: {
      indexed_files,
      disk_files: diskSet.size,
      not_indexed,
      ghosts,
      nodes,
      edges,
      disk_files_by_kind,
      indexed_files_by_kind,
      not_indexed_by_kind,
    },
    refs: {
      pending: byStatus('pending'),
      resolved: byStatus('resolved'),
      external: byStatus('external'),
      failed: byStatus('failed'),
      stale_resolved,
    },
    freshness: {
      not_fresh: notFreshCount,
      not_fresh_sample: notFresh,
      not_fresh_out_of_scope: notFreshOutOfScope,
      self_writes_pending: selfWrites.length,
    },
    backfill: backfillSummary(bf),
    languages: summarizeLanguagesByTier([...indexedSet]),
    issues,
    verdict,
    trustworthy,
    ...(refreshReport !== null ? { refresh_receipt: receiptOf(refreshReport, state) } : {}),
    summary,
  };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 口径（`Touched` 两类字段，见 domain/b_terms.ts）：
 *   - 作用域类（`project_dir`）：**只在调用方显式给了根时才给**（见下）；
 *   - 对象类（`written_files` / `symbols` / `nodes`）：只有**真发生**才给，否则整项省略。
 */
function touchedOf(opts: { project_dir: string; project_dir_explicit?: boolean }): Touched {
  // ★★ 2026-10-06（T47）：`project_dir` **只在调用方显式给了才填**。原先这里无条件填
  //   `path.resolve(opts.project_dir)`，而本工具的入参 `project_dir` 是**可选**的
  //   （省略 ⇒ handler 兜底 `process.cwd()`，那是**有意的「自定位」**，描述里也这么写）
  //   ⇒ 那个 cwd 被当成"调用方声明的项目根"填进 `touched`，**冒充了一个本次调用并未声明的对象**。
  //
  //   ★ 全族同口径：本仓 **14 个** `touched.project_dir` 构造点里，其余 13 个都守着
  //     「不猜、不兜底 cwd」—— `rename_files.ts:136-140` 的裁定逐字写着
  //     「**`cwd` 兜底尤其不能要** —— 那会把它变成'**进程当前目录**'，不是本次调用**确立的对象**」；
  //     `derive_anim_flow` / `derive_algorithm` / `scaffold` 三处也各写了同款理由。
  //     ⇒ 本处是**唯一漏跟**的那个（判据分叉），本笔收口。
  //
  //   ★ 信息**不会丢**：本产物顶层另有 `project_root`（= Core 里 `path.resolve(...)` 的结果）
  //     **照给**自定位后的真实根；此处省略只是**不让它冒充**"调用方声明的对象"。
  //   ★ 对象类一律省略：本 [B] 读写的是 `cache.db`（dataHome 下），**不是仓库文件** ⇒
  //     `written_files` 给不出；它也不确立任何符号/DSL 节点对象 ⇒ `symbols` / `nodes` 不给。
  if (opts.project_dir_explicit === false) return {};
  return { project_dir: path.resolve(opts.project_dir) };
}

export async function indexIntegrity(opts: {
  project_dir: string;
  /** ★ 调用方是否**显式**给了 `project_dir`：`false` ⇒ `touched.project_dir` 整项省略（见 {@link touchedOf}）。
   *  缺省 `true`（保守：直接调本函数、未经"自定位兜底"的调用方，视为显式给了根）。 */
  project_dir_explicit?: boolean;
  refresh?: boolean;
  sample?: number;
}): Promise<TouchedProduct<IndexIntegrityResult>> {
  const r = await indexIntegrityCore(opts);
  return withTouched(r, touchedOf(opts));
}

/** 人读多行（供工具结果直接呈现） */
export function renderIntegrity(r: IndexIntegrityResult): string {
  const verdictLabel: Record<IndexIntegrityResult['verdict'], string> = {
    trusted: '✅ 可信',
    untrusted: '⚠️ 不可信',
    unknown: '❓ 查不了（还没有可用索引）',
  };
  const lines = [
    `索引可信度自检 —— ${r.project_root}`,
    // ★ 判定**只读三态 `verdict`**（唯一定义见 `integrityVerdict`）—— 不再用布尔自己拼词。
    //   ★ 也**不再**无条件追加"（本次已顺手保鲜）"：那句话曾是空头承诺（保鲜覆盖不到的 blocker 还在）。
    //     保鲜到底做了什么，看下面那行**逐项回执**；覆盖不到的，由问题区如实点名。
    `  判定：${verdictLabel[r.verdict]}`,
    `  ${r.summary}`,
    `  规模：索引 ${r.counts.indexed_files} 文件 / 磁盘源码 ${r.counts.disk_files} 文件（未索引 ${r.counts.not_indexed}）` +
    `
  　★ 按类拆（本体/测试/噪音）：本体 ${r.counts.indexed_files_by_kind.main}/${r.counts.disk_files_by_kind.main} 已索引 · ` +
    `测试 ${r.counts.indexed_files_by_kind.test}/${r.counts.disk_files_by_kind.test} · ` +
    `噪音 ${r.counts.indexed_files_by_kind.noise}/${r.counts.disk_files_by_kind.noise} · ` +
    `不该收的目录 ${r.counts.indexed_files_by_kind.excluded}/${r.counts.disk_files_by_kind.excluded}` +
      ` ｜ 节点 ${r.counts.nodes} ｜ 边 ${r.counts.edges}`,
    `  引用：resolved ${r.refs.resolved} ｜ pending ${r.refs.pending} ｜ external ${r.refs.external} ｜ failed ${r.refs.failed}`,
    `  ★ 陈旧断言（resolved 但目标名已不在索引）：${r.refs.stale_resolved}`,
    `  新鲜度：不一致 ${r.freshness.not_fresh} ｜ 待消费自写登记 ${r.freshness.self_writes_pending} ｜ ${r.backfill}`,
  ];
  if (r.refresh_receipt) {
    const c = r.refresh_receipt;
    lines.push(
      `  保鲜回执（本次 refresh 实际做的）：走查 ${c.checked} ｜ 重同步 ${c.resynced} ｜ 新增 ${c.added} ｜ 清理 ${c.removed} ｜ 失败 ${c.failed}` +
        (c.skipped_adds ? ` ｜ 超限跳过新增 ${c.skipped_adds}` : ''),
    );
    // ★ 保鲜之后若**仍有 blocker**，明说"哪些是它覆盖不到的"——不许用一句"已保鲜"盖过去。
    if (r.verdict !== 'trusted' && r.freshness.not_fresh_out_of_scope.length > 0) {
      lines.push(
        `  ★ 保鲜**未竟**：refresh 之后仍有 ${r.freshness.not_fresh} 项不一致，其中 ` +
          `${r.freshness.not_fresh_out_of_scope.length} 项**不在保鲜重解析范围内**（索引器只走查代码类源码，` +
          '`.md` 等文档类不在其列）⇒ **这份 refresh 覆盖不到它们**（详见下方问题）。',
      );
    }
  }
  if (r.languages.length) {
    const tierLabel: Record<string, string> = { call: '调用级', symbol: '符号级', none: '不解析' };
    // 只展示前 8 种（按文件数）；同层级合并显示避免长尾刷屏
    const top = r.languages.slice(0, 8);
    const rest = r.languages.length - top.length;
    lines.push(
      `  语言能力自述：${top.map((l) => `${l.lang}=${tierLabel[l.tier] ?? l.tier}(${l.files})`).join(' · ')}` +
        (rest > 0 ? ` · …等 ${r.languages.length} 种` : '') +
        '——非"调用级"语言的引用/影响结论会低估（"零引用/零波及"不可全信）',
    );
  }
  if (r.freshness.not_fresh_sample.length) {
    lines.push(`  未保鲜样例：${r.freshness.not_fresh_sample.join(', ')}`);
  }
  if (r.repair) lines.push(`  顺手修复：${r.repair}`);
  if (r.issues.length) {
    lines.push('  问题：');
    for (const i of r.issues) {
      lines.push(`    [${i.severity}] ${i.code}：${i.message}${i.fix ? ` → ${i.fix}` : ''}`);
    }
  }
  return lines.join('\n');
}
