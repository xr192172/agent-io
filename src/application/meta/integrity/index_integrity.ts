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
import { getProjectView } from '../../../infrastructure/parse/project_view.js';
import { INDEX_SKIP_DIR_EXTRA, isNoiseFileName, isTestFileName, isUnderSkippedDir } from '../../../infrastructure/parse/source_exts.js';
import { hasLiveIndex, pendingSelfWrites } from '../../observe/write_gate.js';
import { backfillState, backfillSummary, isIndexIncomplete } from '../../../infrastructure/index/index_backfill.js';
import { ensureProjectIndex, type IndexState } from '../../../infrastructure/index/index_freshness.js';
import { summarizeLanguagesByTier, type LanguageTierSummary } from '../../refactor/parse_capability.js';

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
    /** 索引有、磁盘没有（= 需要清理的幽灵行） */
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
    /** 待消费的自写登记文件数（同步写工具登记过、还没被读路径消费） */
    self_writes_pending: number;
  };

  backfill: string;
  /** P10 能力自述：已索引文件按语言的解析层级汇总（文件数降序；渲染时截前 8 行） */
  languages: LanguageTierSummary[];
  issues: IntegrityIssue[];
  /** 综合判定：`true` = 眼下读到的东西可以当真 */
  trustworthy: boolean;
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
 * 索引可信度自检。
 * @param opts.refresh true = 先跑一次保鲜（`ensureProjectIndex`）再报告；默认 false（纯只读）
 * @param opts.sample  抽样条数上限（默认 20）
 */
export async function indexIntegrity(opts: {
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
  if (opts.refresh === true) {
    const idx = await ensureProjectIndex(root);
    db = idx.db;
    state = idx.state;
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
      freshness: { not_fresh: 0, not_fresh_sample: [], self_writes_pending: pendingSelfWrites(root).length },
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
      trustworthy: false,
      summary: '索引不可用：还没有建索引。此时任何"基于索引"的查询都应当先建索引。',
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
  const ghosts = [...indexedSet].filter((p) => !diskSet.has(p)).length;

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
  const notFresh: string[] = [];
  let notFreshCount = 0;
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
      notFreshCount++;
      if (notFresh.length < sampleN) notFresh.push(rel);
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
    issues.push({
      code: 'files_not_fresh',
      severity: 'blocker',
      message: `${notFreshCount} 个已索引文件与磁盘不一致（自上次索引后被改过）`,
      fix: '传 refresh:true 重同步；或直接调读工具（保鲜路径会自动同步）',
    });
  }
  if (ghosts > 0) {
    issues.push({
      code: 'ghost_files',
      severity: 'warn',
      message: `索引里有 ${ghosts} 个文件在磁盘上已不存在（幽灵行）`,
      fix: '传 refresh:true 清理',
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

  const trustworthy = state !== 'empty' && stale_resolved === 0 && notFreshCount === 0;
  const summary = trustworthy
    ? `索引可信：${indexed_files} 文件 / ${nodes} 节点 / ${edges} 边 ｜ 陈旧断言 0 ｜ 未保鲜文件 0` +
      (not_indexed > 0 ? `（另有 ${not_indexed} 个文件未索引，属拼图按需状态）` : '')
    : `索引**不可全信**：` +
      [
        stale_resolved ? `陈旧断言 ${stale_resolved} 条（会静默漏报引用）` : '',
        notFreshCount ? `${notFreshCount} 个文件自上次索引后被改过` : '',
        state === 'empty' ? '还没有可用索引' : '',
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
      self_writes_pending: selfWrites.length,
    },
    backfill: backfillSummary(bf),
    languages: summarizeLanguagesByTier([...indexedSet]),
    issues,
    trustworthy,
    summary,
  };
}

/** 人读多行（供工具结果直接呈现） */
export function renderIntegrity(r: IndexIntegrityResult): string {
  const lines = [
    `索引可信度自检 —— ${r.project_root}`,
    `  判定：${r.trustworthy ? '✅ 可信' : '⚠️ 不可全信'}${r.refreshed ? '（本次已顺手保鲜）' : ''}`,
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
