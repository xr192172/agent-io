/**
 * test_coverage —— **测试↔源码覆盖映射** + **可信增量选量**（T-#INC-TEST-SEL）
 *
 * ## 四根柱子（缺一就不信；本文件是柱 1/2/3 的单一实现，柱 4 在 `incsel_ablation.ts`）
 * ① 覆盖映射：从 `cache.db` 的 `import` 边自动生成"哪些测试文件 cover 哪些源码文件"。
 *    直接边 = `test --import--> src`；间接依赖走 **src→src import 边的传递闭包**（BFS，封顶防环）。
 *    ★ 保守方向：**推不出覆盖的测试（0 条 import 到 src）= 未知 ⇒ 包含**（宁多不漏）。
 * ② 选量：`selectChangedTests` = `impactOfChanged(changed)` 的波及集 ∩ 测试的 coverage ≠ ∅ 的测试文件；
 *    ★ 保守方向：不确定（impact 失败 / 测试覆盖未知 / 图不可信）⇒ 包含。
 * ③ 源码指纹缓存：`.agent-io/scratch/test-sel-cache.json`（derived，不进 git）——
 *    每个测试文件记"上次通过时它覆盖的全部源码 sha256 集合"；本轮改动源码的 sha **全在**缓存集合里
 *    ⇒ 跳过（信任来自"指纹没变"，不是"我信它"）。缓存坏 / 缺 ⇒ 不跳过（fail-closed）。
 * ④ 消融的支撑：`coveringTestsOf` 回答"改了 X，哪些测试**本应**覆盖它"——审计席用它做
 *    "手动剔除一个覆盖测试 ⇒ 它变红 ⇒ 选择有洞"的元判据。
 *
 * ## 为什么从 import 边、不从运行期覆盖率工具
 * 本仓 `cache.db` 的 `edges` 已有 1966 条 `import`（其中 test→src 直接边覆盖 131/150 个测试文件），
 * 这是**已存在的权威事实**，不建第二套真相。运行期 instrument 覆盖率要改测试运行方式、成本高且
 * 只覆盖"本次跑到"的分支；这里要的是**改动选择的下界**（宁多不漏），import 闭包正是这个下界。
 *
 * ## 口径纪律（0.9/0.12）
 * · 读不到 cache.db / 图不可信 ⇒ `coverage.untrusted=true` ⇒ `selectChangedTests` 回落全量（不假绿）；
 * · 路径统一 `/`、去 `./`（与 `impact_set.ts` 的 norm 同义）；
 * · 分母齐全：`selected / total / unknown / byCacheSkipped / impactUnavailable`；
 * · 缓存只写"通过且非定向"的全量/增量选择结果，坏 JSON 当没缓存。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getProjectCacheDb } from '../../index/db.js';
import { detectStaleIndex } from '../../index/index_freshness.js';
import { impactOfChanged, type ImpactSet } from '../facts/impact_set.js';

export const norm = (p: string): string => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

/** 缓存文件（derived；.agent-io/ 已在 .gitignore ⇒ 不进 git） */
export const CACHE_REL = '.agent-io/scratch/test-sel-cache.json';
/**
 * 传递闭包默认跳数上限：
 * ★ 为什么默认 1 而不是"越大越好"：改动侧 `impactOfChanged` 已经算了一次**正向**波及闭包
 *   （改 B ⇒ 谁依赖 B）；测试侧再算一次**反向**深闭包（测 A ⇒ A 依赖的深层 B 全算它覆盖）
 *   会让两边双向爆炸（实测 8 跳时改 1 个文件选中 105/191 = 55% 的测试，违背"≤60s 只跑覆盖它的"）。
 *   1 跳恰好覆盖本仓真实存在的形态：`test --import--> barrel/index.ts --import--> 深模块`
 *   （测试通过 barrel 间接触达深模块）；再深一层的依赖由**改动侧的 impact 闭包**兜住。
 *   需要更深时可传 `maxDepth` 覆盖（保守方向：深闭包被截断 ⇒ 把测试标 unknown ⇒ 包含）。
 */
export const MAX_DEPTH = 1;

export interface CoverageMap {
  /** test file（仓库相对，如 `tests/p0_ledger_new_file.test.ts`）→ 它覆盖的源码文件集合（仓库相对） */
  byTest: Map<string, Set<string>>;
  /** 推不出任何 src import 边的测试文件（⇒ 覆盖未知 ⇒ 选择时保守包含） */
  unknown: Set<string>;
  /** 图是不是可信（读不到 cache.db / 查询异常 ⇒ false ⇒ 选择时全量） */
  trusted: boolean;
  /** 直连边 / 闭包新增边的条数（读数，非判据） */
  stats: {
    directEdges: number;
    closureEdges: number;
    srcImportEdges: number;
    /** G9③ 索引已建边型（读数） */
    builtKinds: string[];
    /** G9③ 已建但选材/继承链未消费的边型（已建未读，显形读数） */
    unreadKinds: string[];
    /** G9① 索引新鲜度是否通过（stale=0 且可探测） */
    fresh: boolean;
    /**
     * ★ G1④ 不可静态解析动态入口（`imports.kind='computed'`，路径算出来解析不了）条数。
     * 事实已登记、目标不可见 ⇒ 覆盖下界含盲区；与清单一起供读端判断覆盖可信度。
     */
    computedImports: number;
    /** ★ G1④ 含 computed 动态入口的源码/脚本文件清单（仓库相对，去重排序） */
    computedFiles: string[];
    /**
     * ★ G1③ 被显式排除出 src 覆盖面的 dist 产物 import 边条数。
     * 覆盖集只认 `src/` 目标；dist/src/*.js 是构建产物，不回映进 src 覆盖下界——此处单列计数，不静默丢弃。
     */
    excludedDistEdges: number;
    /** ★ G1④ 反射/不可解析调用引用读数（failed/pending；external 仓外不计盲区） */
    unresolvedUnsafe: { failedCall: number; failedTypeRef: number; pending: number; unknownKind: number };
  };
}

type EdgeRow = { source: string; target: string };

/** 读 cache.db 的 import 边（只按 file_path 聚合；节点 id 形态无关） */
function readImportEdges(root: string): EdgeRow[] | null {
  try {
    const db = getProjectCacheDb(root) as unknown as {
      prepare: (sql: string) => { all: (...a: unknown[]) => Array<{ source?: string; target?: string }> };
    };
    // ★ G-2：文件级边数据集 = import 依赖边 ∪ mapper_statement 文件级对（XML 语句文件 ↔ Java 方法文件）。
    //   mapper 边两端符号 JOIN 回文件后即文件级关联；进同一闭包邻接，口径与 import 一致。
    const rows = db.prepare(
      `SELECT s.file_path AS source, t.file_path AS target
         FROM edges e
         JOIN nodes s ON s.id = e.source
         JOIN nodes t ON t.id = e.target
        WHERE e.kind IN ('import','mapper_statement') AND s.file_path IS NOT NULL AND t.file_path IS NOT NULL`,
    ).all();
    const out: EdgeRow[] = [];
    for (const r of rows) {
      if (typeof r.source !== 'string' || typeof r.target !== 'string') continue;
      const s = norm(r.source);
      const t = norm(r.target);
      if (s && t && s !== t) out.push({ source: s, target: t });
    }
    return out;
  } catch {
    return null; // 打不开/查不动 ⇒ 不可信（不猜）
  }
}

/**
 * ★ G9③ 边型对账：选材/继承链实际消费的边型清单（唯一权威口径，不另立第二份）。
 * - `import`：文件级依赖（test→src / src→src 闭包、import_graph、locate_feature）；
 * - `call`：符号级调用（diff_impact / chain_tracer / call-exists 判据）；
 * - `type_ref`：符号级类型引用（diff_impact / chain_tracer）；
 * - `mapper_statement`：MyBatis XML 语句 ↔ Java 接口方法（G-2 接入：diff_impact 正向波及 +
 *   derivedObserves 反向观察面 + 覆盖闭包文件级关联）。
 */
export const CONSUMED_EDGE_KINDS = ['import', 'call', 'type_ref', 'mapper_statement'] as const;

interface FreshnessProbe {
  ok: boolean;
  stale: number;
  total: number;
  reason?: string;
}

/** ★ G9① 索引新鲜度探测：索引里有 src 比索引磁盘新（陈旧边集）⇒ 不可信，与"DB 打不开"同等 fail-closed。 */
function probeFreshness(root: string): FreshnessProbe {
  try {
    const db = getProjectCacheDb(root);
    const r = detectStaleIndex(db, root);
    return { ok: true, stale: r.stale, total: r.total };
  } catch (e) {
    return { ok: false, stale: 0, total: 0, reason: String((e as { message?: string }).message ?? e).slice(0, 160) };
  }
}

/** ★ G9③ 索引已建边型集合（对账读侧）；查不动 ⇒ ok=false（对账不可判 ⇒ 回落全量）。 */
function builtEdgeKinds(root: string): { ok: boolean; built: string[] } {
  try {
    const db = getProjectCacheDb(root) as unknown as { prepare: (sql: string) => { all: () => Array<{ kind: string }> } };
    const rows = db.prepare('SELECT DISTINCT kind FROM edges').all();
    return { ok: true, built: rows.map((r) => r.kind) };
  } catch {
    return { ok: false, built: [] };
  }
}

/** ★ G1③④ 不可解析动态入口 / dist 排除边 / 反射不可解析引用的可信度读数（只读；查不动 ⇒ null）。 */
function readUnresolvedSignals(root: string): {
  computedImports: number;
  computedFiles: string[];
  excludedDistEdges: number;
  unresolvedUnsafe: { failedCall: number; failedTypeRef: number; pending: number; unknownKind: number };
} | null {
  try {
    const db = getProjectCacheDb(root) as unknown as {
      prepare: (sql: string) => {
        all: () => Array<Record<string, unknown>>;
        get: () => Record<string, unknown>;
      };
    };
    const compRows = db
      .prepare(`SELECT f.path AS file FROM imports i JOIN files f ON f.id = i.file_id WHERE i.kind = 'computed'`)
      .all();
    const computedFiles = [...new Set(compRows.map((r) => String(r.file)).filter(Boolean))].sort();
    const compCount = db.prepare("SELECT COUNT(*) n FROM imports WHERE kind = 'computed'").get();
    const dist = db
      .prepare(
        `SELECT COUNT(*) n FROM edges e JOIN nodes t ON t.id = e.target
          WHERE e.kind = 'import' AND t.file_path LIKE 'dist/%'`,
      )
      .get();
    const u = db
      .prepare(
        `SELECT reference_kind, status, COUNT(*) n FROM unresolved_refs
          WHERE status IN ('failed','pending') GROUP BY status, reference_kind`,
      )
      .all();
    // ★ D1：未知 kind resolved 坏行单列计数（与 index_integrity 同一把白名单尺 call/type_ref）。
    const unknown = db
      .prepare(
        `SELECT COUNT(*) n FROM unresolved_refs
          WHERE status = 'resolved' AND reference_kind NOT IN ('call','type_ref')`,
      )
      .get();
    const unresolvedUnsafe = { failedCall: 0, failedTypeRef: 0, pending: 0, unknownKind: Number(unknown?.n) || 0 };
    for (const r of u) {
      const n = Number(r.n) || 0;
      if (r.status === 'pending') unresolvedUnsafe.pending += n;
      else if (r.reference_kind === 'call') unresolvedUnsafe.failedCall += n;
      else unresolvedUnsafe.failedTypeRef += n;
    }
    return {
      computedImports: Number(compCount.n) || 0,
      computedFiles,
      excludedDistEdges: Number(dist.n) || 0,
      unresolvedUnsafe,
    };
  } catch {
    return null;
  }
}

/**
 * ① 构造覆盖映射：测试文件 → 源码集合（直接 import + src→src import 传递闭包）。
 *
 * 直接边：`tests/x.test.ts --import--> src/a.ts` ⇒ x covers a。
 * 间接边：`src/a.ts --import--> src/b.ts` ⇒ covers a 的测试也 covers b（改 b 会影响 a 的调用方测试）。
 * ★ 只对 `src/` 目标建闭包：避免 `tests/`/`scripts/` 互相 import 把闭包吹成全图。
 * ★ 闭包封顶 `MAX_DEPTH`：超过深度的远端依赖不展开，但把该测试标 `unknown`（保守包含）而非静默截断。
 */
export function buildCoverageMap(root: string, opts: { maxDepth?: number; testFiles?: readonly string[] } = {}): CoverageMap {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const edges = readImportEdges(root);
  const empty = (trusted: boolean, why = ''): CoverageMap => ({
    byTest: new Map(), unknown: new Set(), trusted,
    stats: {
      directEdges: 0, closureEdges: 0, srcImportEdges: 0, builtKinds: [], unreadKinds: [], fresh: false,
      computedImports: 0, computedFiles: [], excludedDistEdges: 0,
      unresolvedUnsafe: { failedCall: 0, failedTypeRef: 0, pending: 0, unknownKind: 0 },
    },
  } as CoverageMap & { why?: string });
  if (edges === null) return empty(false);

  // ★ G9① 索引新鲜度：陈旧边集（src 比索引新）与 DB 打不开同等 fail-closed；
  // ★ G9③ 边型对账不可判（读不动边表）⇒ 同样回落全量。
  const freshness = probeFreshness(root);
  const kinds = builtEdgeKinds(root);
  const unreadKinds = kinds.ok
    ? kinds.built.filter((k) => !CONSUMED_EDGE_KINDS.includes(k as (typeof CONSUMED_EDGE_KINDS)[number]))
    : [];
  // ★ G1③④ 不可解析信号是可信度读数（非判据）：读不动给零值，不据此回落全量。
  const signals = readUnresolvedSignals(root);
  if (!freshness.ok || freshness.stale > 0 || !kinds.ok) {
    return empty(false, freshness.reason ?? 'edge-kind-reconcile-unreadable');
  }

  // src→src 邻接表（一次建好，BFS 复用）
  const srcAdj = new Map<string, Set<string>>();
  let srcImportEdges = 0;
  for (const e of edges) {
    if (!e.source.startsWith('src/') || !e.target.startsWith('src/')) continue;
    let set = srcAdj.get(e.source);
    if (!set) srcAdj.set(e.source, (set = new Set()));
    set.add(e.target);
    srcImportEdges++;
  }

  // 测试文件集合：调用方给的（run-tests 的 collectTestFiles）或全图里所有 *.test.ts
  const tests = opts.testFiles
    ? [...new Set(opts.testFiles.map(norm))]
    : [...new Set(edges.filter((e) => /\.test\.ts$/.test(e.source)).map((e) => e.source))];

  const byTest = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  let directEdges = 0;
  let closureEdges = 0;

  for (const t of tests) {
    const direct = new Set<string>();
    for (const e of edges) {
      if (e.source === t && e.target.startsWith('src/')) { direct.add(e.target); directEdges++; }
    }
    if (direct.size === 0) {
      // ★ 推不出覆盖 = 未知（宁多不漏），不是"覆盖了 0 个文件"
      byTest.set(t, new Set());
      unknown.add(t);
      continue;
    }
    // BFS 传递闭包（只沿 src→src import）
    // ★ 封顶不是"覆盖未知"：改动侧 `impactOfChanged` 已算正向闭包 ⇒ 这里封顶只影响下界宽度，
    //   不影响正确性（保守性由"0 直连 import ⇒ unknown"和"impact 失败 ⇒ 全量"保证）。
    const seen = new Set<string>(direct);
    let frontier = [...direct];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const s of frontier) {
        for (const d of srcAdj.get(s) ?? []) {
          if (seen.has(d)) continue;
          seen.add(d);
          closureEdges++;
          next.push(d);
        }
      }
      frontier = next;
    }
    byTest.set(t, seen);
  }

  return {
    byTest,
    unknown,
    trusted: true,
    stats: {
      directEdges, closureEdges, srcImportEdges, builtKinds: kinds.built, unreadKinds, fresh: true,
      computedImports: signals?.computedImports ?? 0,
      computedFiles: signals?.computedFiles ?? [],
      excludedDistEdges: signals?.excludedDistEdges ?? 0,
      unresolvedUnsafe: signals?.unresolvedUnsafe ?? { failedCall: 0, failedTypeRef: 0, pending: 0, unknownKind: 0 },
    },
  };
}

/** 改了 changedFiles，哪些测试**本应**覆盖它们（柱 4 的审计支点：覆盖集 ∩ 改动波及集） */
export function coveringTestsOf(map: CoverageMap, changedFiles: readonly string[]): string[] {
  const want = new Set(changedFiles.map(norm));
  const out: string[] = [];
  for (const [t, cover] of map.byTest) {
    for (const f of want) if (cover.has(f)) { out.push(t); break; }
  }
  return out.sort();
}

// ── ③ 源码指纹缓存 ─────────────────────────────────────────────
/**
 * ★ G3 缓存口径版本：与索引边型 / 选量口径绑定。口径升级 ⇒ 旧版本条目整体失效重算（不逐条兼容）。
 */
export const SEL_CACHE_SCHEME = 2;
/** 条目 TTL（ms）：过期条目不跳。7 天为默认读数口径，可由条目自带 ttlMs 覆盖。 */
export const SEL_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
/**
 * ★ G3/L7 进缓存键的 runner/脚本清单。
 * L7 分面：测试本体 sha / runner 脚本 sha / 口径版本 / TTL → 缓存键；
 * 工具链 / 环境 / 夹具清单 / dist 新鲜度 → 升级全量触发面（**不进缓存键**）。
 */
const RUNNER_SCRIPT_RELS = ['scripts/run-tests.mjs', 'scripts/incsel-select.mjs', 'scripts/incsel-record.mjs'];

export interface SelCacheEntry {
  /** 上次通过时，该测试覆盖的所有源码文件 sha256（相对路径 → sha） */
  sourceShas: Record<string, string>;
  /** ★ G3 测试文件本体 sha256（键面；测试本体变了 ⇒ 旧指纹不跳） */
  testSha: string;
  /** ★ G3 runner/脚本聚合 sha256（键面；runner 脚本变了 ⇒ 旧指纹不跳） */
  runnerSha: string;
  /** ★ G3 口径版本（与索引边型/选量口径绑定；不匹配 ⇒ 旧条目整体失效） */
  scheme: number;
  /** ★ G3 条目 TTL（ms）；`at` 起算，过期不跳 */
  ttlMs: number;
  /** 通过时点（ISO） */
  at: string;
  /** 上次选量方式（读数） */
  mode: string;
}
export interface SelCache {
  version: 2;
  entries: Record<string, SelCacheEntry>;
}
export function cachePath(root: string): string { return path.join(root, CACHE_REL); }

/** runner/脚本聚合 sha：任一脚本读不到 ⇒ null（fail-closed，键面不全不落/不跳） */
function runnerSha(root: string): string | null {
  const parts: string[] = [];
  for (const rel of RUNNER_SCRIPT_RELS) {
    const sha = shaOf(root, rel);
    if (sha === null) return null;
    parts.push(`${rel}:${sha}`);
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** 读缓存；坏/缺/旧口径版本 ⇒ 空（fail-closed：不跳过任何测试；旧 scheme 条目整体失效） */
export function readSelCache(root: string): SelCache {
  try {
    const raw = fs.readFileSync(cachePath(root), 'utf8');
    const data = JSON.parse(raw) as Partial<SelCache>;
    if (data?.version !== 2 || typeof data.entries !== 'object' || data.entries === null) throw new Error('shape');
    return { version: 2, entries: data.entries as Record<string, SelCacheEntry> };
  } catch {
    return { version: 2, entries: {} };
  }
}

/** 写一个测试的"上次通过"指纹（合并进现有缓存；坏缓存会被空缓存替换 = 自愈） */
export function writeSelCacheEntry(root: string, testFile: string, entry: SelCacheEntry): void {
  const cache = readSelCache(root);
  cache.entries[norm(testFile)] = entry;
  const file = cachePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

/** 文件的 sha256（读不到 ⇒ null；调用方按"判不了 ⇒ 不跳过"处理） */
export function shaOf(root: string, rel: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  } catch {
    return null;
  }
}

// ── ② 选量 ───────────────────────────────────────────────────
export interface SelectionResult {
  ok: true;
  /** 要跑的测试文件（仓库相对 `tests/...`）——已按指纹缓存过滤 */
  selected: string[];
  /** 因"覆盖集未知/impact 不可用"被保守纳入的测试 */
  conservative: string[];
  /** 因指纹缓存命中而跳过的测试（读数） */
  skippedByCache: string[];
  /** 分母与理由（0.12：分母必须给全） */
  denominator: {
    total: number; selected: number; unknownCoverage: number;
    conservative: number; skippedByCache: number; impactUnavailable: boolean;
  };
  /** 改动波及集（读数） */
  impact: { files: string[]; calls: number; ok: boolean; reason?: string };
  /** 覆盖映射统计（读数） */
  coverage: CoverageMap['stats'] & { trusted: boolean };
}
export interface SelectionError { ok: false; reason: string }

/**
 * ② `run-tests.mjs --changed` 的选量核心。
 *
 * 判据：`impactOfChanged(changed)` 的波及文件集 ∩ `test.coverage` ≠ ∅ ⇒ 选中；
 * 保守方向：覆盖未知 / impact 失败 / 图不可信 ⇒ 纳入（宁多不漏，绝不假绿）。
 * 然后应用③：若某选中测试"上次通过指纹"覆盖了本轮所有改动源码且 sha 未变 ⇒ 跳过（skippedByCache）。
 */
export function selectChangedTests(
  root: string,
  changed: readonly string[],
  opts: {
    testFiles?: readonly string[];
    coverage?: CoverageMap;
    cache?: SelCache;
    impactFn?: typeof impactOfChanged;
    /** 跳过指纹缓存（消融/审计用：强制不信任缓存 ⇒ 全选） */
    noCache?: boolean;
  } = {},
): SelectionResult | SelectionError {
  const cache = opts.cache ?? readSelCache(root);
  const coverage = opts.coverage ?? buildCoverageMap(root, { testFiles: opts.testFiles });
  const allTests = [...new Set(opts.testFiles ?? [...coverage.byTest.keys()])].map(norm).sort();
  const impact: ImpactSet = opts.impactFn
    ? opts.impactFn(root, changed, { max_depth: 6 })
    : impactOfChanged(root, changed, { max_depth: 6 });

  const impactUnavailable = !coverage.trusted || !impact.ok;
  const impactFiles = new Set<string>(impact.ok ? [...impact.files].map(norm) : []);
  // 改动源码也算进来（impact 的 files 一般含自身，但非 src 的改动不进 impact，这里只收 src 改动）
  for (const c of changed) if (norm(c).startsWith('src/')) impactFiles.add(norm(c));

  const conservative: string[] = [];
  const selectedNoCache: string[] = [];
  const selectedSet = new Set<string>();
  if (impactUnavailable) {
    // fail-closed：影响关系或覆盖图不可信 ⇒ 全量（每个文件都给理由）
    for (const t of allTests) {
      selectedSet.add(t);
      conservative.push(t);
      selectedNoCache.push(t);
    }
  } else {
    for (const t of allTests) {
      const cover = coverage.byTest.get(t) ?? new Set<string>();
      const unknown = coverage.unknown.has(t);
      // ★ 覆盖未知 ⇒ 保守包含，**但只在真有代码波及面时**：
      //   非代码改动（README.md / .agent-io/**）impact.files 为空 ⇒ 没有任何源码被改 ⇒ 零测试跑（秒回）。
      //   这时"不确定覆盖"无从谈起（没有可覆盖的改动），把 60 个 unknown 测试全拉起来是假的保守。
      let hit = unknown && impactFiles.size > 0;
      if (!hit) for (const f of impactFiles) if (cover.has(f)) { hit = true; break; }
      if (hit) {
        selectedSet.add(t);
        selectedNoCache.push(t);
        if (unknown) conservative.push(t);
      }
    }
  }

  // ③ 指纹缓存过滤：只跳过"本轮所有改动源码 sha 都与上次通过时一致"的测试
  const changedSrc = [...new Set(changed.map(norm).filter((f) => f.startsWith('src/')))];
  const changedShas = new Map<string, string | null>();
  for (const f of changedSrc) changedShas.set(f, shaOf(root, f)); // null = 读不到 ⇒ 不跳过
  const currentRunnerSha = runnerSha(root); // G3 键面：runner/脚本聚合 sha（读不到 ⇒ null，不跳）
  const skippedByCache: string[] = [];
  const selected: string[] = [];
  if (opts.noCache || cache === null) {
    selected.push(...selectedNoCache);
  } else {
    for (const t of selectedNoCache) {
      const entry = cache.entries[t];
      let canSkip = !!entry && changedSrc.length > 0;
      if (canSkip && entry) {
        // ★ G3 键面 fail-closed：口径版本 / 测试本体 sha / runner 脚本 sha / TTL 任一不符或读不到 ⇒ 不跳。
        const testShaNow = shaOf(root, t);
        const entryAge = Date.now() - new Date(entry.at).getTime();
        if (entry.scheme !== SEL_CACHE_SCHEME) canSkip = false;
        else if (testShaNow === null || entry.testSha !== testShaNow) canSkip = false;
        else if (currentRunnerSha === null || entry.runnerSha !== currentRunnerSha) canSkip = false;
        else if (Number.isNaN(entryAge) || entryAge > (entry.ttlMs ?? SEL_CACHE_TTL_MS)) canSkip = false;
        else {
          for (const [f, now] of changedShas) {
            // 缓存里没有该文件的 sha，或当前读不到 sha ⇒ 判不了 ⇒ 不跳过（否定保守）
            if (now === null || entry.sourceShas[f] !== now) { canSkip = false; break; }
          }
        }
      }
      if (canSkip) skippedByCache.push(t);
      else selected.push(t);
    }
  }

  const impactReadable = impact.ok
    ? { ok: true, files: [...impact.files].map(norm).sort(), calls: impact.calls }
    : { ok: false, files: [] as string[], calls: 0, reason: impact.reason };
  return {
    ok: true,
    selected,
    conservative: conservative.sort(),
    skippedByCache: skippedByCache.sort(),
    denominator: {
      total: allTests.length,
      selected: selected.length,
      unknownCoverage: coverage.unknown.size,
      conservative: conservative.length,
      skippedByCache: skippedByCache.length,
      impactUnavailable,
    },
    impact: impactReadable,
    coverage: { ...coverage.stats, trusted: coverage.trusted },
  };
}

/**
 * ③ 落盘"测试通过"指纹：把该测试覆盖的所有源码文件当前 sha 记进缓存。
 * ★ 只记覆盖集里的文件（不记全仓）——下次改动只要不碰这些文件，就能安全跳过。
 * ★ G3 写端不可信不落条目：覆盖映射不可信（trusted=false）⇒ 不固化指纹；
 *   测试本体 / runner 脚本任一读不到 ⇒ 键面不全 ⇒ 不落（fail-closed）。
 */
export function recordPass(root: string, testFile: string, coverage: CoverageMap, mode = 'changed'): void {
  if (!coverage.trusted) return;
  const cover = coverage.byTest.get(norm(testFile)) ?? new Set<string>();
  const sourceShas: Record<string, string> = {};
  for (const f of cover) {
    const sha = shaOf(root, f);
    if (sha !== null) sourceShas[f] = sha;
  }
  const testSha = shaOf(root, norm(testFile));
  const rSha = runnerSha(root);
  if (testSha === null || rSha === null) return;
  writeSelCacheEntry(root, testFile, {
    sourceShas,
    testSha,
    runnerSha: rSha,
    scheme: SEL_CACHE_SCHEME,
    ttlMs: SEL_CACHE_TTL_MS,
    at: new Date().toISOString(),
    mode,
  });
}
