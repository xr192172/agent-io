/**
 * design_line —— 设计链【六步读数】（工具面入口，从 `scripts/design-line.mjs` 收进来）
 *
 * ## 它回答一个问题
 * "这条业务线现在到哪一步了、每步的产物是什么、有多少"
 *
 * ## 业务链（用户 2026-10-19 定义）
 * ```
 * 源码 → 实际 DB → 实际 DSL → 设计 DSL → 设计 DB → 源码（重写）
 *  ①       ②          ③           ④          ⑤         ⑥
 * ```
 *
 * ## ★ ⑥ 为什么不再写"未实现"
 * 旧脚本对 ⑥ 只能打印 `未实现 —— 这是 VISION.md §6 的"接入重构线"`。
 * 那是一句**装饰**：读的人得不到任何读数，也看不出还差多少。
 * 现在它给一条**真读数**：设计 DB 覆盖了多少源码文件、还有多少没覆盖。
 * ★ 这只是**计数级**（不是符号级）：符号级差分归 `rewrite` / `design-diff`。
 *
 * ## 纪律
 * - **只读**：不碰任何文件、不写 DSL、不改源码。
 * - `lineReport` 是纯函数（给 root + feature，返回结构化读数），`designLineHandler` 只做入参适配
 *   ⇒ 判据能单测，不用起 MCP。
 */
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { analyzeImpact } from '../../../infrastructure/analysis/impact/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { designDbDir } from '../db/gen_design_db.js';

/** 单步读数 */
export interface LineStep {
  /** ①..⑥ */
  id: string;
  /** 这一步叫什么 */
  name: string;
  /** 谁干这活（工具名 / 人） */
  by: string;
  /** ok=有产物 · missing=产物不存在 · pending=还没实现 */
  status: 'ok' | 'missing' | 'pending';
  /** 一句话读数（带数字） */
  reading: string;
}

export interface LineReport {
  feature: string;
  steps: LineStep[];
  /** 六步里 ok / missing / pending 各几个 —— 便于一眼看"断在哪" */
  tally: { ok: number; missing: number; pending: number };
}

const n = (x: number): string => x.toLocaleString('en-US');

/** 六步读数（纯函数：只读磁盘与 cache.db） */
export function lineReport(root: string, feature: string): LineReport {
  const p = {
    db: path.join(root, '.agent-io', 'cache.db'),
    live: path.join(root, '.agent-io', 'live', `${feature}.dsl.json`),
    design: path.join(root, '.agent-io', 'design', `${feature}.dsl.json`),
    designDb: designDbDir(root),
  };

  // ── ① 源码 → 实际 DB ──
  let dbFiles = 0;
  let dbSymbols = 0;
  let dbCalls = 0;
  const sourceFiles: string[] = [];
  if (fs.existsSync(p.db)) {
    const db = new DatabaseSync(p.db, { readOnly: true });
    try {
      // ★ 与旧脚本同口径：排除 scripts/ 与 dogfood/（它们不是产品面）
      const rows = db
        .prepare("SELECT path FROM files WHERE path NOT LIKE 'scripts/%' AND path NOT LIKE 'dogfood/%'")
        .all() as Array<{ path: string }>;
      for (const r of rows) sourceFiles.push(r.path);
      dbFiles = sourceFiles.length;
      dbSymbols = (db.prepare('SELECT COUNT(*) c FROM nodes WHERE parent IS NULL').get() as { c: number }).c;
      dbCalls = (db.prepare("SELECT COUNT(*) c FROM edges WHERE kind = 'call'").get() as { c: number }).c;
    } finally {
      db.close();
    }
  }

  // ── ② 实际 DB → 实际 DSL ──
  let liveNodes = 0;
  let liveEdges = 0;
  if (fs.existsSync(p.live)) {
    const j = JSON.parse(fs.readFileSync(p.live, 'utf8'));
    liveNodes = j.geometry?.nodes?.length ?? 0;
    liveEdges = j.geometry?.edges?.length ?? 0;
  }

  // ── ③ / ④ 设计 DSL（人写意图）= ③ 的产物 ──
  /** 设计册 `excluded`（排除清单，2026-10-24 裁 A）：显式排除的路径不是沉默缺口，是管辖范围声明 */
  let excludedList: Array<{ path: string; reason: string }> = [];
  let dNodes = 0;
  let dDecisions = 0;
  let dReqs = 0;
  let dTodos = 0;
  if (fs.existsSync(p.design)) {
    const j = JSON.parse(fs.readFileSync(p.design, 'utf8'));
    dNodes = j.geometry?.nodes?.length ?? 0;
    dDecisions = (j.geometry?.nodes ?? []).filter((x: { decision?: unknown }) => x.decision).length;
    dReqs = (j.geometry?.nodes ?? []).reduce(
      (s: number, x: { decision?: { expectations?: unknown[] } }) => s + (x.decision?.expectations?.length ?? 0),
      0,
    );
    dTodos = (j.todos ?? []).length;
    excludedList = (j.excluded ?? []) as Array<{ path: string; reason: string }>;
  }

  // ── ⑤ 设计 DSL → 设计 DB ──
  let dbCount = 0;
  let dbSyms = 0;
  let dbCalls2 = 0;
  let dbReqs = 0;
  /** 设计 DB 覆盖了哪些源码文件（用副本里记的 path，不靠文件名猜） */
  const covered = new Set<string>();
  if (fs.existsSync(p.designDb)) {
    for (const f of fs.readdirSync(p.designDb)) {
      if (!f.endsWith('.calls.json')) continue;
      dbCount += 1;
      const j = JSON.parse(fs.readFileSync(path.join(p.designDb, f), 'utf8'));
      dbSyms += j.symbols?.length ?? 0;
      dbCalls2 += j.calls?.length ?? 0;
      dbReqs += j.requirements_calls?.length ?? 0;
      // ★ 2026-10-19：**优先读 `path` 字段**（副本自报路径，gen-design-db 已输出）。
      //   只有在读旧产物（没有该字段）时才退回解析首行 `//` 注释 —— 那是给人看的，格式一变就断，
      //   不再作为主路径。
      if (typeof j.path === 'string') covered.add(j.path.replace(/\\/g, '/'));
      else {
        const m = String(j['//'] ?? '').match(/——\s*([^\s（(]+)/u);
        if (m) covered.add(m[1].replace(/\\/g, '/'));
      }
    }
  }

  // ── ⑥ 设计 DB → 源码：★ 真读数（覆盖差），不是"未实现" ──
  // ★ 2026-10-24：显式排除（设计册 excluded，path 支持目录前缀）——排除的不是缺口，是管辖范围声明
  const isExcludedPath = (p: string) => excludedList.some((x) => p === x.path || p.startsWith(x.path));
  const uncovered = sourceFiles.filter((s) => !covered.has(s) && !isExcludedPath(s));
  const coverRate = sourceFiles.length > 0 ? ((covered.size / sourceFiles.length) * 100).toFixed(1) : '0.0';

  const steps: LineStep[] = [
    {
      id: '①',
      name: '源码 → 实际 DB',
      by: 'import_project（扫描 + 符号 + 调用边）',
      status: dbFiles ? 'ok' : 'missing',
      reading: dbFiles
        ? `cache.db：${n(dbFiles)} 文件 · ${n(dbSymbols)} 符号 · ${n(dbCalls)} 调用边`
        : 'cache.db 不存在',
    },
    {
      id: '②',
      name: '实际 DB → 实际 DSL',
      by: 'renderLiveFromDb（投影）',
      status: liveNodes ? 'ok' : 'missing',
      reading: liveNodes ? `live/：${n(liveNodes)} 节点 · ${n(liveEdges)} 边` : 'live/ 不存在（跑 import_project）',
    },
    {
      id: '③',
      name: '实际 DSL → 设计 DSL',
      by: 'fork（一次性，之后由人写）',
      status: dNodes ? 'ok' : 'missing',
      reading: dNodes
        ? `design/：${n(dNodes)} 节点 · ★ ${dDecisions} 个 decision · ${n(dReqs)} 条 expectations · ${dTodos} 张卡`
        : 'design/ 不存在',
    },
    {
      id: '④',
      name: '在设计 DSL 上写意图',
      by: 'edit_dsl / design_intent（人写）',
      status: dDecisions ? 'ok' : 'pending',
      reading: dDecisions ? `已写：${dDecisions} 个 decision（其中 ${n(dReqs)} 条判据）` : '还没写 decision',
    },
    {
      id: '⑤',
      name: '设计 DSL → 设计 DB',
      by: 'gen-design-db（全量，与实际 DB 同构）',
      status: dbCount ? 'ok' : 'missing',
      reading: dbCount
        ? `design-db/：${dbCount} 份 · ${n(dbSyms)} 符号 · ${n(dbCalls2)} 调用 · ★ ${dbReqs} 条设计要求`
        : '设计 DB 未生成',
    },
    {
      id: '⑥',
      name: '设计 DB → 源码（重写）',
      by: 'rewrite（结构重写：只改签名，实现永远人写）',
      status: dbCount && sourceFiles.length ? 'ok' : 'missing',
      reading:
        dbCount && sourceFiles.length
          ? `覆盖：设计 DB ${dbCount} 份 / 源码 ${n(sourceFiles.length)} 文件 = ${coverRate}%；` +
            `★ 沉默缺口（盘上有 ∧ 册上无 ∧ 无 excluded_reason ∧ 不在排除清单）${n(uncovered.length)} 个（显式排除 ${excludedList.length} 条）` +
            (uncovered.length
              ? `：${uncovered.slice(0, 10).join(' ; ')}${uncovered.length > 10 ? ' …' : ''}` +
                ` —— 逐个裁「纳入/显式排除」（意图推不出来，不自动建节点；纳入后走 L1 建构卡）`
              : '')
          : '设计 DB 或源码缺失，无法算覆盖',
    },
  ];

  const tally = { ok: 0, missing: 0, pending: 0 };
  for (const s of steps) tally[s.status] += 1;
  return { feature, steps, tally };
}

/** MCP handler（只做入参适配 + 渲染文本） */
export function designLineHandler(input: { project_dir: string; feature: string }): {
  message: string;
  data: LineReport;
} {
  const report = lineReport(input.project_dir, input.feature);
  const icon = (s: LineStep['status']): string => (s === 'ok' ? '✓' : s === 'missing' ? '✗' : '·');
  const lines = [
    `设计链 · ${report.feature}（ok ${report.tally.ok} / missing ${report.tally.missing} / pending ${report.tally.pending}）`,
  ];
  for (const s of report.steps) {
    lines.push(`${s.id} ${s.name}  ${icon(s.status)}`);
    lines.push(`    ${s.by}`);
    lines.push(`    ${s.reading}`);
  }
  lines.push('★ 只读：不改 DSL、不改源码。');
  return { message: lines.join('\n'), data: report };
}


// ───────────────────────────────────────────────────────────────────────────
// ★「只在设计侧」⇒ `must_have`（该文件/目录**必含哪些符号**）
// ───────────────────────────────────────────────────────────────────────────
//
// ## 为什么需要它
// `action=diff` 原来只报到**节点级**（"这个文件设计了、还没有"），LLM 要写实现
// （`edit_code op=symbol`）时仍得自己从 `scope` / 边去猜"里面该有哪些函数" —— 猜错就白写一轮。
// `must_have` 把这件事直接摆在 diff 结果里。
//
// ## 符号只能从设计侧**已有的记录**里取（不编造）
// 三个来源，按可信度排序：
// 1. `decision.expectations[kind=symbol-exists]` —— 决策卡**明说**"这个文件里必须有这个符号"
//    （带 `why`）。这是唯一"人以判据形式写过"的来源，优先级最高。
// 2. `semantic.files[path].symbols` —— 设计 DSL 自带的符号事实（fork 时从源码带来）。
//    它是**记录**，不是设计意图；所以 `from` 标 `semantic.files`，LLM 自己能分辨。
// 3. 目录节点：先**下钻到文件级**（子文件节点 ∪ `semantic.files` 条目），再取这些文件的符号。
//    目录名本身说不出里面有什么 —— 不下钻就等于没答。
//
// ## 信息不够时必须明说
// 一个节点真的没有符号可列（目录下没有文件、文件没有符号记录、也没有决策卡判据）⇒
// `must_have: []` + `why_empty: '<具体查了什么、缺什么>'`，**不许静默空**。
// ★ 铁律：宁可空着报 why_empty，也不许把"推测"写成 `must_have`。

/** 设计侧说"这个文件里该有的一个符号" */
export interface MustHaveSymbol {
  name: string;
  /** 种类：`symbol-exists`（决策卡明说）/ `type` / `class` / `interface` …（semantic.files 记录） */
  kind: string;
  /** 1-based 行号（**设计侧记录的原行号**，仅供参考，别拿去对源码） */
  line?: number;
  /** 声明首行签名（截断后的原文，来自 semantic.files） */
  signature?: string;
  /** 目录级下钻时：这个符号属于哪个文件 */
  file?: string;
  /** 这条符号从设计侧的哪条事实来（可追溯 ⇒ 不编造） */
  from: 'decision.expectation' | 'semantic.files';
  /** `decision.expectation` 带的 `why` */
  why?: string;
}

/** 一条「只在设计侧」节点的必含符号清单 */
export interface MustHaveReport {
  id: string;
  /** file=文件节点 / dir=目录节点（已下钻到文件级）/ other=两者都不是 */
  kind: 'file' | 'dir' | 'other';
  /** 仓库相对路径（目录节点按 `dir_<rel>` 的既有约定反推，见 import_project.ts:983） */
  path?: string;
  /** 必含符号；**空 ⇒ 必须读 why_empty**（不许静默空） */
  must_have: MustHaveSymbol[];
  /** 为什么列不出来（信息不够时**明说**） */
  why_empty?: string;
  /** 目录节点下钻到的文件（目录级 must_have = 这些文件符号的并集） */
  drilled?: string[];
}

type AnyDesignNode = Record<string, unknown>;

/** 路径归一（只用于对齐，不用于展示）：反斜杠→斜杠、去 `./`、小写 */
const mhNorm = (p: string): string => String(p).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/** 节点的仓库相对路径：优先 `description`（真路径），其次 `path`；目录节点按 id 约定反推 */
function mhPathOf(node: AnyDesignNode): string | null {
  for (const k of ['description', 'path'] as const) {
    const v = node[k];
    if (typeof v === 'string' && v.includes('/') && !/\s/.test(v)) return v.replace(/\\/g, '/');
  }
  const id = typeof node.id === 'string' ? node.id : '';
  // ★ 既有约定（import_project.ts:983 就是这么反推 dir 的）：`dir_a_b_c` ⇒ `a/b/c`
  if (id.startsWith('dir_')) return id.replace(/^dir_/, '').replace(/_/g, '/');
  return null;
}

/**
 * 「只在设计侧」的节点 ⇒ 每条**必含符号**（纯函数：只读传进来的设计 DSL 对象）。
 *
 * @param design 设计 DSL（`geometry.nodes` + `semantic.files`）
 * @param onlyDesignIds `designDiff` 算出的"只在设计侧"节点 id
 */
export function mustHaveFor(design: unknown, onlyDesignIds: string[]): MustHaveReport[] {
  const dsl = (design ?? {}) as {
    geometry?: { nodes?: AnyDesignNode[] };
    semantic?: { files?: Array<{ path?: string; symbols?: Array<{ name?: string; kind?: string; line?: number; signature?: string }> }> };
  };
  const nodes = dsl.geometry?.nodes ?? [];
  const byId = new Map<string, AnyDesignNode>();
  for (const n of nodes) if (typeof n.id === 'string') byId.set(n.id, n);

  /** 来源 ②：设计 DSL 自带的文件符号事实 */
  const fileSyms = new Map<string, Array<{ name?: string; kind?: string; line?: number; signature?: string }>>();
  for (const f of dsl.semantic?.files ?? []) {
    if (typeof f.path === 'string') fileSyms.set(mhNorm(f.path), f.symbols ?? []);
  }

  /** 来源 ①：决策卡的 `symbol-exists` 判据（按 path 索引；卡片可以挂在任何节点上） */
  const expected = new Map<string, MustHaveSymbol[]>();
  for (const n of nodes) {
    const dec = n.decision as { expectations?: unknown } | undefined;
    if (!dec || !Array.isArray(dec.expectations)) continue;
    for (const raw of dec.expectations) {
      const e = raw as { kind?: string; path?: string; symbol?: string; why?: string };
      if (e.kind !== 'symbol-exists' || typeof e.path !== 'string' || typeof e.symbol !== 'string') continue;
      const key = mhNorm(e.path);
      const list = expected.get(key) ?? [];
      if (!list.some((s) => s.name === e.symbol)) {
        list.push({ name: e.symbol, kind: 'symbol-exists', from: 'decision.expectation', ...(e.why ? { why: e.why } : {}) });
      }
      expected.set(key, list);
    }
  }

  /** 一个文件的必含符号：判据优先，再补 `semantic.files` 的符号记录（同名不重复） */
  const symbolsOfFile = (file: string): MustHaveSymbol[] => {
    const key = mhNorm(file);
    const out: MustHaveSymbol[] = (expected.get(key) ?? []).map((s) => ({ ...s }));
    for (const s of fileSyms.get(key) ?? []) {
      if (!s.name || out.some((x) => x.name === s.name)) continue;
      out.push({
        name: s.name,
        kind: s.kind || 'unknown',
        ...(typeof s.line === 'number' ? { line: s.line } : {}),
        ...(s.signature ? { signature: s.signature } : {}),
        from: 'semantic.files',
      });
    }
    return out;
  };

  const out: MustHaveReport[] = [];
  for (const id of onlyDesignIds) {
    const node = byId.get(id) ?? { id };
    const type = typeof node.type === 'string' ? node.type : '';
    const path = mhPathOf(node);
    const kind: MustHaveReport['kind'] =
      type === 'file' ? 'file' : id.startsWith('dir_') || type === 'module' ? 'dir' : 'other';

    if (kind === 'file') {
      const file = path ?? id;
      const must = symbolsOfFile(file);
      out.push({
        id,
        kind,
        ...(path ? { path } : {}),
        must_have: must,
        ...(must.length
          ? {}
          : {
              why_empty:
                `${file}：设计侧没有 semantic.files 符号记录，也没有任何决策卡写过 symbol-exists 判据 ⇒ ` +
                `设计侧说不出它该含什么（不是"没要求"，是"没写"）。`,
            }),
      });
      continue;
    }

    if (kind === 'dir') {
      const dir = (path ?? '').replace(/\/+$/, '');
      const prefix = dir ? `${mhNorm(dir)}/` : '';
      /** ★ 目录必须**下钻到文件级**：子文件节点 ∪ semantic.files 条目（两份都是设计侧说过的话） */
      const drilled: string[] = [];
      const add = (p: string): void => {
        if (!drilled.some((x) => mhNorm(x) === mhNorm(p))) drilled.push(p.replace(/\\/g, '/'));
      };
      if (prefix) {
        for (const n of nodes) {
          if (n.id === id || n.type !== 'file') continue;
          const p = mhPathOf(n);
          if (p && mhNorm(p).startsWith(prefix)) add(p);
        }
        for (const f of dsl.semantic?.files ?? []) {
          if (typeof f.path === 'string' && mhNorm(f.path).startsWith(prefix)) add(f.path);
        }
      }
      /** 目录级 must_have = 下钻文件符号的并集（每个符号带 `file`，LLM 才知道往哪写） */
      const must: MustHaveSymbol[] = [];
      for (const f of drilled) {
        for (const s of symbolsOfFile(f)) {
          if (must.some((x) => x.name === s.name && x.file === f)) continue;
          must.push({ ...s, file: f });
        }
      }
      out.push({
        id,
        kind,
        ...(path ? { path } : {}),
        must_have: must,
        drilled,
        ...(must.length
          ? {}
          : {
              why_empty:
                `目录 ${dir || id}：设计侧没有它的子文件节点、没有 semantic.files 条目、也没有决策卡（含 scope）指向它 ⇒ ` +
                `设计侧只说"要这个目录"，说不出里面该有什么（信息不够，不编）。`,
            }),
      });
      continue;
    }

    out.push({
      id,
      kind,
      ...(path ? { path } : {}),
      must_have: [],
      why_empty: `节点类型 ${type || '(无)'} 既不是文件也不是目录 ⇒ 设计侧没有"该含哪些符号"的语义。`,
    });
  }
  return out;
}


// ───────────────────────────────────────────────────────────────────────────
// ★★★ action=brief（2026-10-23）：**开工简报** —— 把「设计要什么 / 现在是什么 / 差在哪」拼成一份
// ───────────────────────────────────────────────────────────────────────────
//
// ## 它解决什么（用户原话，2026-10-23）
// 「模型上下文里面应该要同时存在设计 DB 和实际源码应该怎么改」
// ⇒ 现在 Agent 想知道"这个文件该实现什么"要调三次（get_dsl / explore_code / design_line report），
//   而且三次的输出**互相对不上**：设计侧 10KB、实际侧一份符号表、report 只给 76.2% 这种和本文件无关的总数。
//   ★ `must_have` 的注释早就点破过同一个病灶：「LLM 要写实现时仍得自己从 scope / 边去猜
//     里面该有哪些函数 —— **猜错就白写一轮**」。
//
// ## 它不拥有任何判据（★ 这是分界线）
// · 设计侧"该有什么" = `mustHaveFor`（本文件已有，读 decision.expectations + semantic.files）
// · 实际侧"有什么"   = `fileFacts`（infrastructure/index/file_facts.ts，读 cache.db）
// · 差               = 两者相减
// ⇒ 本函数**只做投影与拼接**，一个判据都不新造。要改判据去改那两个源头。
//
// ## 输出形状（给 LLM 读的，不是给人看的报表）
//   design.summary / acceptance / must_have / expectations（**设计要求原文**；★ 本函数不判满没满）
//   live.symbols（只给签名，不贴全文 —— 全文用 explore_code / Read）
//   gap.missing_symbols / gap.unsatisfied_count
export interface BriefSymbol {
  name: string;
  kind?: string;
  line?: number;
  signature?: string;
}

export interface BriefReport {
  target: { node_id?: string; path?: string };
  design: {
    summary?: string;
    acceptance?: string;
    must_have: MustHaveSymbol[];
    /** ★ 设计要求**原文**（decision.expectations）。★ 不是「未满足」—— 本函数不判满没满，别拿它当验收结论 */
    expectations: Array<{ kind: string; [k: string]: unknown }>;
    why_empty?: string;
  };
  /** ★ 设计侧 DB（`design-db/<rel>.calls.json`）—— 与 `live` 同构，可直接对拍 */
  design_db?: { available: boolean; symbols: BriefSymbol[]; imports: number; calls: number };
  live: { symbols: BriefSymbol[]; indexed: boolean };
  /** ★ 第 4 条：改这个文件会波及谁（`analyzeImpact` 的读数，不新造判据） */
  impact?: { total: number; direct: number; high_risk: number; top: string[] };
  gap: { missing_symbols: MustHaveSymbol[]; expectation_count: number };
}

/** 纯组装：入参是已经算好的两侧事实，本函数不做 I/O、不判判据 */
export function briefFrom(dsl: unknown, target: { node_id?: string; path?: string }): BriefReport['design'] & { nodePath?: string } {
  const d = (dsl ?? {}) as {
    geometry?: { nodes?: Array<{ id?: string; path?: string; decision?: unknown }> };
    semantic?: { files?: Array<{ path?: string }> };
  };
  const nodes = d.geometry?.nodes ?? [];
  const node = target.node_id ? nodes.find((n) => n.id === target.node_id) : undefined;
  // ★★★ 2026-10-27（T-#37）：**只认 `path`** —— `Node.description` 已删（T-#35），
  //   下面那条 2026-10-23 的注释（“文件节点的路径住在 description”）**已过期**：
  //   T-#23 起 `import_project` 给每个 file 节点写 `path`，全册 description 也已清零。
  const filePath = target.path ?? (typeof node?.path === 'string' ? node.path : undefined);
  const dec = (node?.decision ?? undefined) as { summary?: string; acceptance?: string; expectations?: unknown } | undefined;
  const exps = Array.isArray(dec?.expectations) ? (dec!.expectations as Array<{ kind?: string }>) : [];
  return {
    ...(dec?.summary ? { summary: dec.summary } : {}),
    ...(dec?.acceptance ? { acceptance: dec.acceptance } : {}),
    must_have: [],
    expectations: exps.map((e) => ({ ...e, kind: String(e.kind ?? '?') })),
    ...(node ? {} : { why_empty: '找不到该节点（node_id 不对？）⇒ 只给路径级信息' }),
    nodePath: filePath,
  };
}


/**
 * `action=brief` 的 I/O 侧：**取两侧事实 → 交给纯组装 → 算差**。
 *
 * ★ 它读三样、一样都不判：
 *   ① `readDesignDsl`（设计侧 decision）
 *   ② `mustHaveFor`（设计侧"该有什么"—— 判据在它那里）
 *   ③ `fileFacts`（实际侧"有什么"—— 事实在 cache.db）
 */
export async function briefReport(
  root: string,
  feature: string,
  target: { node_id?: string; path?: string },
  /**
   * `skip_impact`：不算影响面。
   * ★ 2026-10-23 实测必要性：`analyzeImpact` 每次都会 `buildImpactGraph`（全仓依赖图）。
   *   批量扫 84 张卡时 4 分 56 秒还没跑完 ⇒ 逐卡算影响面是 O(cards × 全仓图)。
   *   只要符号差时应该能跳过它（符号差查 cache.db，毫秒级）。
   */
  opts: { skip_impact?: boolean } = {},
): Promise<BriefReport> {
  // ★ 与 lineReport 同口径：直接读 `.agent-io/design/<f>.dsl.json`（不引入第二套读法）
  const designFile = path.join(root, '.agent-io', 'design', `${feature}.dsl.json`);
  const dsl = (fs.existsSync(designFile) ? JSON.parse(fs.readFileSync(designFile, 'utf-8')) : null) as unknown;
  const base = briefFrom(dsl, target);
  const nodeId = target.node_id;
  const filePath: string | undefined = base.nodePath;

  // 设计侧：必含符号（判据住在 mustHaveFor，不在这里重算）
  let must: MustHaveSymbol[] = [];
  let whyEmpty: string | undefined = base.why_empty;
  if (nodeId || filePath) {
    const rep = mustHaveFor(dsl, nodeId ? [nodeId] : []);
    const hit = rep.find((r) => (nodeId ? r.id === nodeId : filePath && r.path === filePath));
    if (hit) {
      must = hit.must_have;
      whyEmpty = hit.why_empty;
    } else if (!nodeId && filePath) {
      // 路径级：把按 path 索引的判据捞出来（mustHaveFor 只按节点 id 收）
      const all = mustHaveFor(dsl, []);
      must = all.flatMap((r) => (r.path === filePath ? r.must_have : []));
    }
  }

  // 实际侧：该文件现有符号
  // ★★★ 2026-10-23（误报修正第二处）：**不能只用 `fileFacts.apis`** —— 它只收"可调用的顶层 API"
  //   （声明见 file_facts.ts:38 的原话），**没有 type / interface / const**。
  //   实测后果：`TaskState`（type）/ `TASK_STATES`（const）明明在文件里，却被报成"缺"
  //   ⇒ 8 条误报（比不报更坏：Agent 会去"补"一个已经存在的符号）。
  //   ⇒ 用 cache.db 的 `nodes` 表（`kind != 'file'` 的行 = 该文件所有顶层符号）判"在不在"；
  //     `fileFacts` 仍用来补**签名**（它那份情报更细，但覆盖面窄）。
  let live: BriefSymbol[] = [];
  let indexed = false;
  if (filePath) {
    const facts = fileFacts(root, filePath as string, feature);
    const sigByName = new Map<string, string | null>();
    if (facts && facts.apis) for (const a of facts.apis) sigByName.set(a.name, a.signature ?? null);
    const dbFile = path.join(root, '.agent-io', 'cache.db');
    if (fs.existsSync(dbFile)) {
      const db = new DatabaseSync(dbFile);
      try {
        const rows = db
          .prepare(`SELECT name, kind, start_line FROM nodes WHERE file_path = ? AND kind <> 'file'`)
          .all(filePath as string) as Array<{ name: string; kind: string; start_line: number | null }>;
        indexed = rows.length > 0;
        live = rows.map((r) => ({
          name: r.name,
          kind: r.kind,
          ...(typeof r.start_line === 'number' ? { line: r.start_line } : {}),
          ...(sigByName.get(r.name) ? { signature: sigByName.get(r.name) as string } : {}),
        }));
      } finally {
        db.close();
      }
    }
  }

  // 差：必含 - 实有（按名字比；★ 同名不同 kind 也算有 —— 那属于"签名不对"，归 expectations）
  const liveNames = new Set(live.map((l) => l.name));
  const missing = must.filter((m) => !liveNames.has(m.name));

  // 设计侧 DB：`design-db/<rel>.calls.json`（gen-design-db 的产物，与实际 DB 同构）
  // ★ 文件名规则：路径去 `src/` 前缀、`/` 换 `-`，后缀 `.calls.json`（实测 359 份都是这个名字）
  // ★ 读不到就说 available:false，**不伪造空符号表**（空表会被误读成"设计侧什么都没有"）
  let designDb: BriefReport['design_db'];
  if (filePath) {
    // ★ 实测文件名：`src/domain/task_schema.ts` → `design-db/domain-task_schema.calls.json`
    //   （去 `src/` 前缀、**去扩展名**、`/` 换 `-`、后缀 `.calls.json`）
    const rel = String(filePath)
      .replace(/^src\//, '')
      .replace(/\.[A-Za-z0-9]+$/, '')
      .replace(/\//g, '-');
    const f = path.join(root, 'design-db', `${rel}.calls.json`);
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf-8')) as {
        symbols?: Array<{ name?: string; kind?: string; line?: number; signature?: string }>;
        imports?: unknown[];
        calls?: unknown[];
      };
      designDb = {
        available: true,
        symbols: (j.symbols ?? []).map((x) => ({
          name: String(x.name ?? '?'),
          ...(x.kind ? { kind: x.kind } : {}),
          ...(typeof x.line === 'number' ? { line: x.line } : {}),
          ...(x.signature ? { signature: x.signature } : {}),
        })),
        imports: (j.imports ?? []).length,
        calls: (j.calls ?? []).length,
      };
    } else {
      designDb = { available: false, symbols: [], imports: 0, calls: 0 };
    }
  }

  // 影响面：只给"改这个文件会炸谁"的规模 + 前 5 个（★ 不贴整份报告 —— 那是 impact_analysis 的活）
  let impact: BriefReport['impact'];
  if (filePath && opts.skip_impact !== true) {
    try {
      const r = await analyzeImpact(root, [{ file: filePath as string }]);
      impact = { total: r.total, direct: r.direct, high_risk: r.high_risk, top: r.files.slice(0, 5).map((f) => f.file) };
    } catch {
      // ★ 影响面算不出来**不阻断简报**（它只是第 4 条信息）；但也不静默 —— 留 undefined，渲染层明说"未算"
      impact = undefined;
    }
  }

  return {
    target: { ...(nodeId ? { node_id: nodeId } : {}), ...(filePath ? { path: filePath as string } : {}) },
    design: {
      ...(base.summary ? { summary: base.summary } : {}),
      ...(base.acceptance ? { acceptance: base.acceptance } : {}),
      must_have: must,
      expectations: base.expectations,
      ...(whyEmpty ? { why_empty: whyEmpty } : {}),
    },
    ...(designDb ? { design_db: designDb } : {}),
    live: { symbols: live, indexed },
    ...(impact ? { impact } : {}),
    gap: { missing_symbols: missing, expectation_count: base.expectations.length },
  };
}

/** MCP handler：只做渲染（首行自足 —— 本仓硬纪律） */
export async function briefHandler(input: { project_dir: string; feature: string; node_id?: string; path?: string }): Promise<{
  message: string;
  data: BriefReport;
}> {
  const r = await briefReport(input.project_dir, input.feature, {
    ...(input.node_id ? { node_id: input.node_id } : {}),
    ...(input.path ? { path: input.path } : {}),
  });
  const where = r.target.path ?? r.target.node_id ?? '（未指定目标）';
  // ★★★ 2026-10-23（用户反馈）：「决策有 · 必含 13 符号 · 缺 1 · 判据 13 条 · 实际 35 符号」这是干什么的？
  //   那是一串**只可计数、不可理解**的密码：说"缺 1"不如说"缺哪个"；说"判据 13 条"也没说满没满（本函数根本没判）。
  //   ⇒ 改成一句能直接读的话，最要紧的（缺什么、叫什么名）放最前。
  const head = (() => {
    if (!r.target.path) return `brief · ${where}（找不到文件路径 ⇒ 只能给节点级信息）`;
    const n = r.gap.missing_symbols.length;
    const names = r.gap.missing_symbols.slice(0, 3).map((m) => m.name).join();
    const more = n === 1 ? '' : n > 3 ? ` 等 ${n} 个` : ` 这 ${n} 个`;
    if (n > 0) return `${where}：设计要 ${r.design.must_have.length} 个符号，源码里缺 ${names}${more}`;
    if (r.design.must_have.length > 0) return `${where}：设计要的 ${r.design.must_have.length} 个符号，源码里都有`;
    return `${where}：设计没给这个文件列必含符号（decision 里没有 symbol-exists 判据）`;
  })();
  const lines = [head];
  if (r.design.summary) lines.push(`  要什么：${r.design.summary}`);
  if (r.design.acceptance) lines.push(`  验收：${r.design.acceptance}`);
  if (r.design.why_empty) lines.push(`  ⚠ ${r.design.why_empty}`);
  if (r.gap.missing_symbols.length > 0) {
    lines.push(`  缺（设计说必须有、源码里没有）：`);
    for (const m of r.gap.missing_symbols.slice(0, 12)) lines.push(`    - ${m.name}${m.why ? `  ← ${m.why}` : ''}`);
    if (r.gap.missing_symbols.length > 12) lines.push(`    … 另 ${r.gap.missing_symbols.length - 12} 个`);
  } else if (r.design.must_have.length > 0) {
    lines.push(`  必含 ${r.design.must_have.length} 个符号【全都在】`);
  }
  if (r.design_db) {
    const d = r.design_db;
    lines.push(
      d.available
        ? `  设计 DB（gen-design-db 的投影）：${d.symbols.length} 符号 · ${d.imports} import · ${d.calls} 调用`
        : `  设计 DB：**没有这份文件的副本**（design-db/ 里找不到）—— 设计侧还没声明它`,
    );
  }
  if (r.impact) {
    const { total, direct, high_risk, top } = r.impact;
    lines.push(`  改它会波及 ${total} 个文件（直接 ${direct} · 高风险 ${high_risk}）${top.length ? `：${top.slice(0, 5).join('、')}${total > 5 ? ' …' : ''}` : ''}`);
  } else if (r.target.path) {
    lines.push(`  ⚠ 影响面未算（analyzeImpact 失败或未建索引）—— 要精确读数用 impact_analysis`);
  }
  lines.push(`  ★ 判据原文在 decision.expectations（本简报不复制语义）；源码全文用 explore_code / Read。`);
  return { message: lines.join(String.fromCharCode(10)), data: r };
}
