/**
 * impact —— 影响面分析（改前风险闭包报告）
 *
 * 从变更点（文件 + 可选符号）出发，沿"依赖图"做反向可达闭包，
 * 输出受影响文件、距离、引用证据与风险排序——回答"我要改这里，会炸哪里"。
 *
 * 依赖图（consumer → provider 边）由三路证据构成：
 *   1. import 边：跨文件相对导入（AST 精确）
 *   2. 调用边：同文件 AST 精确；跨文件按"导出符号名全局唯一"匹配
 *   3. 类型引用边：同上（改类型定义 → 波及引用方，call 图对这类不可见）
 *
 * v1 边界（诚实标注）：
 *   - 包导入（npm/go/py 包路径）不解析 → 外部消费者不在闭包内
 *   - 跨文件符号按"导出名唯一"匹配；重名时不建边（避免误报）
 *   - 保守语义：指定符号但解析不到消费方时，降级为"改整个文件"的闭包
 *
 * 风险排序启发式：受影响文件自身的波及半径（多少文件直接依赖它）× 距离。
 *
 * 跨项目预留：输入是"一个项目根 + 变更点"；项目杂交时对两个根各跑一次即可，
 * 不引入跨仓状态。
 */

import path from 'node:path';
import { parseFileFull, listSupportedExtensions, resolveProjectImport, type ParsedSymbol } from '../../parse/index.js';
import { codeSourceExts, partitionByCodeLang, isTsJsExt } from '../../parse/source_exts.js';
import { boundsSkipFromExcluded, type ScanBounds } from '../../scan_bounds.js';
import { collectSourceFiles } from '../../authoring/version_upgrade/detect.js';

// ── 对外类型 ─────────────────────────────────────────────────

export interface ImpactSite {
  kind: 'import' | 'call' | 'type_ref';
  line: number;
  /** 证据原文：import './a' / process(1) / Shape */
  detail: string;
  /** 命中目标符号 qualified_name（call/type_ref 唯一解析时） */
  target_symbol?: string;
  /** 命中目标文件（相对 root） */
  target_file?: string;
}

export interface ImpactedFile {
  /** 相对 root */
  file: string;
  /** 距变更点最短闭包距离（1 = 直接引用变更） */
  depth: number;
  /** 直接引用证据（仅 depth=1 时非空） */
  sites: ImpactSite[];
  /** 该文件被多少文件直接依赖（自身波及半径 → 若它也要改，会再炸多少） */
  dep_count: number;
  risk: 'high' | 'medium' | 'low';
}

export interface ImpactChangePoint {
  /** 相对 root 的源码文件路径 */
  file: string;
  /** 可选：变更的符号名（导出名 / qualified_name） */
  symbol?: string;
}

export interface ImpactReport {
  root: string;
  changePoints: ImpactChangePoint[];
  /** 传入但未在项目中定位到的变更点（笔误/未索引文件） */
  missing: string[];
  files: ImpactedFile[];
  total: number;
  /** depth<=1：直接被变更波及 */
  direct: number;
  high_risk: number;
  /** 符号级消费方解析失败，发生保守整闭包降级 */
  fell_back: boolean;
  /**
   * ★ 扫描边界（统一形状，2026-09-29；原名 `excludedNonCode`）。
   * 「口径收紧的可见性」：可解析但**不算源码**、因而不在图里的扩展名 → 逐族计数，收进
   * `bounds.skipped`。原设计与理由见 `health/index.ts` 的 `HealthReport`（同一口径、同一理由）。
   * ★ 本工具属「扫仓库类」⇒ `bounds` **恒在**（口径收紧被排除了什么，必须说出来）。
   * 形状与挂载层见 `src/infrastructure/scan_bounds.ts`。
   */
  bounds: ScanBounds;
}

export interface HubFile {
  file: string;
  /** 多少文件直接依赖它（波及半径：改它的下游规模） */
  dependents: number;
  /** 它直接依赖多少文件（耦合度） */
  dependencies: number;
  risk: 'high' | 'medium' | 'low';
}

export interface ImpactOptions {
  /** 报告最大闭包距离（缺省不限） */
  maxDepth?: number;
}

// ── 依赖图构建 ────────────────────────────────────────────────

/** 三路证据边：consumer → provider → 站点列表 */
type EdgeMap = Map<string, Map<string, ImpactSite[]>>;

interface GraphResult {
  rels: Set<string>;
  edges: EdgeMap;
  /** provider → consumers（反向，闭包传播用） */
  reverse: Map<string, Set<string>>;
  /** 顶层导出符号名 → (文件, 符号) */
  nameIndex: Map<string, Array<{ rel: string; sym: ParsedSymbol }>>;
  /**
   * 「口径收紧的可见性」（2026-09-29）：可解析但**不算源码**的扩展名 → 文件数（空 = 无）。
   * 见 `health/index.ts` 的 `HealthReport.bounds`（同一口径、同一理由）——本字段是**内部**形状，
   * 对外统一由 `ImpactReport.bounds.skipped` 承载（`src/infrastructure/scan_bounds.ts`）。
   */
  excludedNonCode: Array<{ ext: string; count: number }>;
}

const TYPE_KINDS = new Set<ParsedSymbol['kind']>(['interface', 'type', 'class']);

/**
 * 解析 import source 到项目内文件 —— 【唯一实现入口】。
 *
 * ★ 候选生成与分层口径已上移到 `tools/ts_kernel/import_resolve.ts` 的 `resolveProjectImport`（2026-09-30）：
 *   覆盖 relative / python-dot / dotted / bare-name / package-dir **五层**
 *   （★ 2026-10-04：原第 5 层 `go-module` 已删 —— 无调用方、语义与 Go 多文件包不符，见 import_resolve.ts 注释），
 *   消解了 impact 原来持私有 `resolveImportFile` + `resolvePackageImportDir` 的口径分叉（分叉 C）。
 *   此处只做薄包装：调内核 + 取 `.rel`，不引入新策略。
 */
function resolveImportTarget(fromRel: string, source: string, rels: Set<string>, exts: string[]): string | null {
  return resolveProjectImport(fromRel, source, rels, { exts }).rel;
}

/** 解析并建立全项目依赖图（供影响面 / 风险热区复用） */
export async function buildImpactGraph(root: string): Promise<GraphResult> {
  // ★ 2026-09-29 同 `health`：源码集 = 「**可解析 ∩ 代码语言**」，而不是 `listSupportedExtensions()`
  //   （那是"我装了哪些语言包"）。差集里有 `.json` —— 它真能被 tree-sitter-json 载入，
  //   于是 `package.json` 曾被当源码收进依赖图（夹具 fileCount 4 ≠ 3 的来源）。
  //   权威 = 内核 `source_exts.ts` 的「代码语言」一节；一次走查再分拣，非代码只进可见性统计。
  const parseable = listSupportedExtensions();
  const exts = codeSourceExts(parseable);
  const { code: files, nonCodeExts } = partitionByCodeLang(collectSourceFiles(root, parseable));
  const rels = new Set(files.map((f) => f.rel));

  const parses = await Promise.all(
    files.map(async (f) => ({ rel: f.rel, parsed: await parseFileFull(f.rel, f.content) })),
  );

  const nameIndex = new Map<string, Array<{ rel: string; sym: ParsedSymbol }>>();
  for (const p of parses) {
    for (const s of p.parsed.symbols) {
      if (s.parent) continue; // 只索引顶层导出，方法/嵌套符号不进跨文件匹配
      const arr = nameIndex.get(s.name) ?? [];
      arr.push({ rel: p.rel, sym: s });
      nameIndex.set(s.name, arr);
    }
  }

  // —— 文件绑定索引：每文件「本地可用名 → 目标文件」——
  // 由 imports[].bindings 构建（Go/Python 提取本地名；TS 系 fill 时给 remoteName）。
  // 用途：跨文件 `svc.Process` 的 `svc` 前缀 connect 到哪个文件 → 精确锁定调用边，避免全局重名漏连。
  const fileBindings = new Map<string, Map<string, Set<string>>>();
  for (const p of parses) {
    let bm = fileBindings.get(p.rel);
    if (!bm) {
      bm = new Map();
      fileBindings.set(p.rel, bm);
    }
    for (const imp of p.parsed.imports) {
      if (!imp.bindings || imp.bindings.length === 0) continue;
      // ★ 同上一处：type-only 在运行时**没有绑定**（擦除）⇒ 不该拿它去连调用边的前缀。
      if (imp.type_only) continue;
      const target = resolveImportTarget(p.rel, imp.source, rels, exts);
      if (!target) continue;
      for (const b of imp.bindings) {
        let s = bm.get(b);
        if (!s) {
          s = new Set();
          bm.set(b, s);
        }
        s.add(target);
      }
    }
  }

  // 辅助：对 consumer 文件内未解析调用，按「前缀→目标文件」或「全局唯一」找出唯一候选 provider 文件。
  // 返回 provider 相对路径（命中）或 null。
  const resolveCallTarget = (
    consumer: string,
    expr: string,
    callee: string,
    providerOfSymbol: Array<{ rel: string; sym: ParsedSymbol }> | undefined,
  ): string | null => {
    const dot = expr.indexOf('.');
    // 带前缀引用 `svc.Process` → 前缀必须连到某个项目内文件才信任
    if (dot >= 0) {
      const prefix = expr.slice(0, dot);
      const cands = fileBindings.get(consumer)?.get(prefix);
      if (cands && cands.size === 1) {
        const prov = [...cands][0];
        // 目标文件确实导出该 callee → 精确建边
        if (nameIndex.get(callee)?.some((c) => c.rel === prov)) return prov;
      }
      // 前缀解析不到唯一目标 → 不建边（无法确证，宁不漏错）
      return null;
    }
    // 裸标识符 `computeSum`：保底走"全局唯一"（多候选时不建边，防误报）
    // ★★ 2026-10-08 修：**再加一道「同语言族」闸**。
    //   实测假边（靠"现扫 vs 索引库"两条独立路径对照逮到）：
    //   `observe-lang-go/probe/tiered.go` 把**局部变量** `opt` 当函数调，而全仓恰好只有
    //   `src/presentation/cli/cli.ts` 导出名为 `opt` 的顶层符号 ⇒ 连出一条 **Go → TS** 的边。
    //   本文件头注写着这条兜底的用意是「重名时不建边（**避免误报**）」⇒ 跨语言误连正违背该意图。
    //   判据：**TS/JS 家族内部互通**（`.ts`↔`.mjs` 等本来就是一套工具链）；其余语言**要求扩展名相同**。
    if (providerOfSymbol && providerOfSymbol.length === 1 && providerOfSymbol[0].rel !== consumer) {
      const ea = path.extname(consumer);
      const eb = path.extname(providerOfSymbol[0].rel);
      const sameFamily = isTsJsExt(ea) && isTsJsExt(eb) ? true : ea === eb;
      if (sameFamily) return providerOfSymbol[0].rel;
    }
    return null;
  };

  const edges: EdgeMap = new Map();
  const addEdge = (consumer: string, provider: string, site: ImpactSite): void => {
    let m = edges.get(consumer);
    if (!m) {
      m = new Map();
      edges.set(consumer, m);
    }
    const arr = m.get(provider) ?? [];
    arr.push(site);
    m.set(provider, arr);
  };

  for (const p of parses) {
    // import 边（相对优先；包路径回退——多语言 import 连到项目内文件）
    for (const imp of p.parsed.imports) {
      // ★★ 2026-10-08 修：**type-only 不算依赖边** ——
      //   口径在本仓是**四处一致**的意图：`project_root/index.ts:1102`（`if (imp.type_only) continue; // TS import type：运行时擦除、不算边`）、
      //   `harvest_closure.ts:362`、`dead_deps.ts:419`、`health/index.ts:841` 都读了；
      //   **只有本文件没读** ⇒ 同一个意图两处实现、口径分叉（本仓头号病）。
      //   ★ 怎么发现的：拿"现扫的图"对"索引库的边"（两条独立路径）——
      //     实测 `src/infrastructure/parse/languages.ts` 的依赖者 **现扫 17 / 索引 16**，
      //     差的那一个正是 `parse/index.ts` 的 `export type { LanguageEntry } from './languages.js'`
      //     （索引库里它的 `type_only=1`，故不进 edges）。
      if (imp.type_only) continue;
      const target = resolveImportTarget(p.rel, imp.source, rels, exts);
      if (!target) continue;
      addEdge(p.rel, target, { kind: 'import', line: imp.line, detail: `import '${imp.source}'`, target_file: target });
    }
    // 跨文件调用边（符号级：前缀→bindings 精确；裸名→全局唯一保底）
    for (const c of p.parsed.calls) {
      if (c.resolved) continue; // 同文件内，不构成"外部受影响"
      const cands = nameIndex.get(c.callee) ?? [];
      const target = resolveCallTarget(p.rel, c.callee_expr, c.callee, cands);
      if (!target) continue;
      const sym = cands.find((x) => x.rel === target)?.sym;
      addEdge(p.rel, target, {
        kind: 'call',
        line: c.line,
        detail: c.callee_expr,
        target_symbol: sym ? sym.qualified_name : c.callee,
        target_file: target,
      });
    }
    // 跨文件类型引用边（同样：带包前缀类型与裸类型都按唯一候选建边）
    for (const t of p.parsed.type_refs) {
      if (t.resolved) continue;
      const cands = nameIndex.get(t.type_name)?.filter((x) => x.rel !== p.rel && TYPE_KINDS.has(x.sym.kind)) ?? [];
      if (cands.length !== 1) continue;
      addEdge(p.rel, cands[0].rel, {
        kind: 'type_ref',
        line: t.line,
        detail: t.type_name,
        target_symbol: cands[0].sym.qualified_name,
        target_file: cands[0].rel,
      });
    }
  }

  // 反向图：provider → consumers
  const reverse = new Map<string, Set<string>>();
  for (const [consumer, m] of edges) {
    for (const provider of m.keys()) {
      let s = reverse.get(provider);
      if (!s) {
        s = new Set();
        reverse.set(provider, s);
      }
      s.add(consumer);
    }
  }

  return { rels, edges, reverse, nameIndex, excludedNonCode: nonCodeExts };
}

function riskLevel(depth: number, depCount: number): ImpactedFile['risk'] {
  if (depCount >= 8 || (depth <= 2 && depCount >= 3)) return 'high';
  if (depth <= 3) return 'medium';
  return 'low';
}

function hubRisk(depCount: number): HubFile['risk'] {
  if (depCount >= 8) return 'high';
  if (depCount >= 3) return 'medium';
  return 'low';
}

// ── 影响面分析 ────────────────────────────────────────────────

export async function analyzeImpact(
  root: string,
  changePoints: ImpactChangePoint[],
  options: ImpactOptions = {},
): Promise<ImpactReport> {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const graph = await buildImpactGraph(root);
  return computeImpact(graph, root, changePoints, maxDepth);
}

/** 对已构建图计算影响面（供分析 + 测试复用，避免重复解析） */
export function computeImpact(
  graph: GraphResult,
  root: string,
  changePoints: ImpactChangePoint[],
  maxDepth: number = Number.POSITIVE_INFINITY,
): ImpactReport {
  const { edges, reverse } = graph;
  const missing: string[] = [];
  const affected = new Map<string, ImpactedFile>();
  let fell_back = false;

  for (const cp of changePoints) {
    const a = cp.file;
    if (!graph.rels.has(a)) {
      missing.push(a);
      continue;
    }
    // 种子：符号级直接消费方；否则 = 变更文件的一级依赖方
    let seeds = new Set<string>();
    if (cp.symbol) {
      for (const [consumer, m] of edges) {
        for (const [provider, sites] of m) {
          if (provider === a && sites.some((s) => s.target_symbol === cp.symbol)) seeds.add(consumer);
        }
      }
      if (seeds.size === 0) {
        fell_back = true; // 解析不到消费方 → 保守整闭包
        seeds = reverse.get(a) ?? new Set();
      }
    } else {
      seeds = reverse.get(a) ?? new Set();
    }

    // BFS 闭包（记录最短距离）
    const queue: Array<{ rel: string; depth: number }> = [];
    const visited = new Set<string>();
    for (const s of seeds) {
      visited.add(s);
      queue.push({ rel: s, depth: 1 });
    }
    while (queue.length > 0) {
      const { rel, depth } = queue.shift()!;
      if (depth > maxDepth) continue;
      const sites: ImpactSite[] = depth === 1 ? edges.get(rel)?.get(a) ?? [] : [];
      const depCount = reverse.get(rel)?.size ?? 0;
      const risk = riskLevel(depth, depCount);
      const prev = affected.get(rel);
      if (!prev || depth < prev.depth) {
        affected.set(rel, { file: rel, depth, sites, dep_count: depCount, risk });
      }
      const next = reverse.get(rel);
      if (!next) continue;
      for (const n of next) {
        if (visited.has(n)) continue;
        visited.add(n);
        queue.push({ rel: n, depth: depth + 1 });
      }
    }
  }

  const files = [...affected.values()];
  const order: Record<ImpactedFile['risk'], number> = { high: 0, medium: 1, low: 2 };
  files.sort((x, y) => order[x.risk] - order[y.risk] || x.depth - y.depth || y.dep_count - x.dep_count);

  return {
    root,
    changePoints,
    missing,
    files,
    total: files.length,
    direct: files.filter((f) => f.depth <= 1).length,
    high_risk: files.filter((f) => f.risk === 'high').length,
    fell_back,
    // ★ 扫描边界恒在（扫仓库类工具的自证字段；口径收紧被排除的文件走 skipped，不静默消失）
    bounds: {
      scope: '全项目源码文件依赖图（import + 调用 + 类型引用三路证据边；源码集 = 可解析 ∩ 代码语言）',
      scanned: { files: graph.rels.size },
      ...(graph.excludedNonCode.length > 0 ? { skipped: boundsSkipFromExcluded(graph.excludedNonCode) } : {}),
    },
  };
}

// ── 风险热区盘点（无变更点时的扫描模式） ──────────────────────────

/** 全项目"改哪里风险最高"盘点：按波及半径（被直接依赖数）排序（★ 同样带统一扫描边界） */
export async function analyzeHubs(
  root: string,
  top = 10,
): Promise<{ root: string; files: HubFile[]; fileCount: number; edgeCount: number; bounds: ScanBounds }> {
  const graph = await buildImpactGraph(root);
  const out: HubFile[] = [];
  for (const rel of graph.rels) {
    const dependents = graph.reverse.get(rel)?.size ?? 0;
    const dependencies = graph.edges.get(rel)?.size ?? 0;
    out.push({ file: rel, dependents, dependencies, risk: hubRisk(dependents) });
  }
  out.sort((x, y) => y.dependents - x.dependents || y.dependencies - x.dependencies);
  let edges = 0;
  for (const m of graph.edges.values()) edges += m.size;
  return {
    root,
    files: out.slice(0, top),
    fileCount: graph.rels.size,
    edgeCount: edges,
    bounds: {
      scope: '全项目源码文件依赖图（import + 调用 + 类型引用三路证据边；源码集 = 可解析 ∩ 代码语言）',
      scanned: { files: graph.rels.size },
      ...(graph.excludedNonCode.length > 0 ? { skipped: boundsSkipFromExcluded(graph.excludedNonCode) } : {}),
    },
  };
}
