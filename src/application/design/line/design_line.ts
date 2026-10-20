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
  const uncovered = sourceFiles.filter((s) => !covered.has(s));
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
            `★ 未覆盖 ${n(uncovered.length)} 个（设计侧还没有副本；符号级差分归 rewrite / design-diff）`
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
