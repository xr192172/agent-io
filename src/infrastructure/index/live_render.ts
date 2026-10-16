/**
 * live_render —— ★ **从 DB 现渲染 live 视图**（`docs/dsl-keep-list-2026-10-16.md` §三' 的 **(b) 笔**）。
 *
 * ## 它补的是什么洞（实测）
 * live 视图此前是**纯文件驱动**：`<dataHome>/.agent-io/live/<f>.dsl.json` 在 ⇒ 读它；
 * 删掉它 ⇒ `getDSLByView(f,'live')` = **`null`**（2026-10-16 实测）。
 * ⇒ 而"实际图"的本体其实是 **DB（cache.db：符号/行数/边，且逐文件保鲜）**，
 *   冻结的 `live/*.dsl.json` 只是它的一次投影。本模块让"文件不在"时**从 DB 现渲染**。
 *
 * ## ★★ 接法（开发者已拍，别自己改）
 * · **文件存在 ⇒ 仍读文件**（`storage.ts#getLiveFeatureResolved` 的既有路径**一字不动**）；
 * · **文件不存在 ⇒ 才走本模块**。⇒ 零行为改变（在位时）+ 正好满足"删文件仍给实际图" + 可回滚。
 *
 * ## ★ 怎么做到"与现有 live 文件结构可比"（不是"DB 里全部"）
 * 三处口径**刻意对齐** `import_project` 的写端（★ **只读**、**不改它**）：
 * 1. **文件集合**：复用它的唯一走查器 `walkFiles(root,false,false,collectGitignore(root))`
 *    —— 同"什么算源码"的 L1 尺、同 gitignore、同 max_files=200 截断；
 * 2. **事实**：`getFileParse(db,rel)`（= `import_project` **缓存路径**读回符号/行数/原始 import 的同一条路）
 *    —— ★ 特别是 **imports 走它的原始记录（不额外按 `type_only` 过滤）**，因为 live 文件正是这条缓存路径产出的
 *      （实测：换用"过滤 type_only"的 `getRawImportsOfFile` ⇒ dep 边 48/45 变 32/43，与 live 对不上）；
 * 3. **装配/布局**：镜像 `import_project` 的节点 id（`file_<sanitize(rel)>` / `dir_<sanitize(rel)>`）、
 *    contains（由路径重导）、imports 聚合（`ownerAtLca` 分组）、`layoutGroup` 递归分组、
 *    `detectArchLayers` 分层。
 *
 * ## ★ 实测（真仓同一批 200 文件）
 * 节点 id 集合 **239=239（差 0）** · 边 id 集合 **325=325（差 0）** · semantic.files **200=200**；
 * 仅 **symbols 2293 vs 2289（+4）**、**lines 4 个文件更新**（DB 比 14h 前的快照新）—— 见流水账 §66。
 *
 * ## 纪律（同 `scan_rev.ts`）
 * · **只读打开** `cache.db`（`readOnly:true`）—— 绝不改真仓数据（WAL 下只读也需 -shm，那不是"改数据"）；
 * · 库的定位**复用唯一权威** `db.ts#findCacheDb`（不新造查找顺序）；
 * · **降级顺序照既有口径**：先"存在性检查"，再读；缺库 / 缺 feature / 根不存在 ⇒ **返回 `null`（不抛、不造空图）**
 *   —— 与 `readViewAtCandidates`（取第一个"文件存在"的）、`getDSL`（逐级降级）、`findCacheDb`（取第一个存在的）同一形状。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { DesignDSL, Node, Edge, SemanticFile, Symbol } from '../../domain/types.js';
import { getDSL } from '../storage.js';
import { detectArchLayers } from '../analysis/structure/layer_detect.js';
import {
  buildIndex,
  collectGitignore,
  readGoModules,
  resolveImport,
  walkFiles,
  layoutGroup,
  IMPORT_LAYOUT,
} from '../graph/import_project.js';
import type { FileEntry, GoModule, LayoutItem } from '../graph/import_project.js';
import { findCacheDb } from './db.js';
import { getFileParse } from './symbols.js';
import { scanRevOf } from './scan_rev.js';

/** 与 `import_project` 的默认 `max_files` 一致（"现有 live 文件里那批"的同一截断口径）。 */
const MAX_FILES = 200;

/** 各语言文件节点配色（★ 复制自 `import_project.ts`：那两个表**未导出**，为不改写端只能本地持一份）。 */
const LANG_COLORS: Record<string, { bg: string; color: string }> = {
  go: { bg: '#1a4a7a', color: '#ffffff' },
  ts: { bg: '#1565c0', color: '#ffffff' },
  tsx: { bg: '#1565c0', color: '#ffffff' },
  js: { bg: '#6d5c10', color: '#fff9c4' },
  jsx: { bg: '#6d5c10', color: '#fff9c4' },
  py: { bg: '#1a5f3a', color: '#ffffff' },
};
const DEFAULT_FILE_COLOR = { bg: '#37474f', color: '#eceff1' };
const DIR_STYLE = { bg: '#152141', color: '#90caf9' };

const toPosix = (p: string): string => p.split(path.sep).join('/');
const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
const fileNodeId = (rel: string): string => `file_${sanitize(rel)}`;
const dirNodeId = (rel: string): string => `dir_${sanitize(rel)}`;

/** 与内核 `parsedKindToSymbolKind` 同口径（非 class/interface/type 一律记 `type`）。 */
function kindOf(kind: string): Symbol['kind'] {
  switch (kind) {
    case 'class':
      return 'class';
    case 'interface':
      return 'interface';
    case 'type':
      return 'type';
    default:
      return 'type';
  }
}

interface ParsedFact {
  /** 函数/方法数（只用于文件节点 label 的 `N APIs` 与职责句 —— 与写端同口径）。 */
  funcCount: number;
  symbols: Symbol[];
  imports: Array<{ line: number; source: string; kind: 'relative' | 'package' }>;
}

/**
 * ★★★ 从 DB 现渲染某 feature 的 `live` 视图。**读不到就返回 `null`（绝不抛、绝不造空图）**。
 *
 * 返回 `null` 的全部情形（都= "本笔不做"）：无 design/source_root · 根不在盘上 · 找不到 cache.db ·
 * 走查不到任何源文件 · 该 feature 在库中一行都读不出。调用方（`getLiveFeatureResolved`）据此保持"读不到"的原语义。
 */
export function renderLiveFromDb(feature: string): DesignDSL | null {
  // ── 0. 锚点：source_root 来自 design DSL（`getDSL` 逐级降级：活态文件 → features 存档；都不在 ⇒ null）──
  const design = getDSL(feature);
  const sourceRoot = design?.source_root;
  if (!sourceRoot) return null;
  const root = path.resolve(sourceRoot);
  try {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }

  // ── 1. 库：复用唯一权威 findCacheDb（两级候选，取第一个存在的）；一个都不存在 ⇒ null ──
  const dbFile = findCacheDb({ feature, sourceRoot: root });
  if (!dbFile) return null;

  // ── 2. 文件集合：复用写端唯一走查器（同 L1 源码尺 / gitignore / 测试口径），再按 max_files 截断 ──
  let files: FileEntry[];
  try {
    const gitignore = collectGitignore(root);
    files = walkFiles(root, false, false, gitignore)
      .slice(0, MAX_FILES)
      .map((abs): FileEntry => {
        const rel = toPosix(path.relative(root, abs));
        return { rel, abs, ext: path.extname(abs), dir: path.posix.dirname(rel) };
      });
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  // ── 3. 事实：从只读 cache.db 读回符号 / 行数 / 原始 import（= import_project 缓存路径那一份）──
  const parsed = new Map<string, ParsedFact>();
  const lineCounts = new Map<string, number>();
  let indexed = 0;
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      for (const f of files) {
        const cached = getFileParse(db, f.rel);
        if (!cached) {
          // 未索引 / 上次解析失败：与写端同款 —— 空 API 面、无依赖边（不静默丢别的文件）
          parsed.set(f.rel, { funcCount: 0, symbols: [], imports: [] });
          continue;
        }
        indexed++;
        lineCounts.set(f.rel, cached.line_count);
        const symbols: Symbol[] = [];
        let funcCount = 0;
        for (const s of cached.symbols) {
          if (s.is_closure) continue; // 局部闭包/辅助函数不进契约面（与写端 ingest 同款）
          if (s.kind === 'function' || s.kind === 'method') {
            funcCount++;
            continue;
          }
          symbols.push({
            name: s.name,
            kind: kindOf(s.kind),
            line: s.start_line,
            end_line: s.end_line,
            signature: s.signature ?? undefined,
          });
        }
        parsed.set(f.rel, { funcCount, symbols, imports: cached.imports });
      }
    } finally {
      db.close();
    }
  } catch {
    // 库存在但打不开 / schema 不对 ⇒ 视为"读不到"，不降级成空图。
    return null;
  }
  // ★ 一个文件都没在库里 ⇒ **本 feature 在库无行** ⇒ 不造空图，如实返回"读不到"（判据③）。
  if (indexed === 0) return null;

  // ── 4. 依赖边（文件级，去重、去自环、去越集）—— 镜像写端步骤 3 ──
  const index = buildIndex(files);
  const fileRelSet = new Set(files.map((f) => f.rel));
  const goModules: GoModule[] = readGoModules(root);
  const depEdgeSet = new Set<string>();
  const fileDeps: Array<[string, string]> = [];
  for (const f of files) {
    const p = parsed.get(f.rel)!;
    for (const imp of p.imports) {
      for (const t of resolveImport({ source: imp.source, kind: imp.kind, line: imp.line, type_only: false }, f, index, goModules)) {
        if (t.rel === f.rel || !fileRelSet.has(t.rel)) continue;
        const key = `${f.rel}|${t.rel}`;
        if (depEdgeSet.has(key)) continue;
        depEdgeSet.add(key);
        fileDeps.push([f.rel, t.rel]);
      }
    }
  }

  // ── 5. 目录树（写端结构；子树文件数用于容器排序）──
  interface DirNode {
    rel: string;
    name: string;
    subdirs: Map<string, DirNode>;
    files: FileEntry[];
    subtreeSize: number;
  }
  const rootDir: DirNode = { rel: '', name: path.basename(root), subdirs: new Map(), files: [], subtreeSize: 0 };
  const dirByRel = new Map<string, DirNode>([['', rootDir]]);
  const ensureDir = (rel: string): DirNode => {
    const existing = dirByRel.get(rel);
    if (existing) return existing;
    const parentRel = path.posix.dirname(rel);
    const parent = ensureDir(parentRel === '.' ? '' : parentRel);
    const d: DirNode = { rel, name: path.posix.basename(rel), subdirs: new Map(), files: [], subtreeSize: 0 };
    parent.subdirs.set(rel, d);
    dirByRel.set(rel, d);
    return d;
  };
  for (const f of files) ensureDir(f.dir === '.' ? '' : f.dir).files.push(f);
  const computeSubtree = (d: DirNode): number => {
    let n = d.files.length;
    for (const sub of d.subdirs.values()) n += computeSubtree(sub);
    d.subtreeSize = n;
    return n;
  };
  computeSubtree(rootDir);

  // ── 6. 装配（节点 / 边 / 语义层）—— 镜像写端步骤 6~8 ──
  const { FILE_W, FILE_H, PAD, TITLE_H, MARGIN } = IMPORT_LAYOUT;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const semanticFiles: SemanticFile[] = [];


  const layoutDir = (dir: DirNode): { w: number; h: number } => {
    const items: LayoutItem[] = [];
    const localDeps: Array<[string, string]> = [];
    const subdirOrder = (a: DirNode, b: DirNode): number => {
      const aIsEntry = a.files.some((f) => /main|index|server|app\./i.test(f.rel));
      const bIsEntry = b.files.some((f) => /main|index|server|app\./i.test(f.rel));
      if (aIsEntry !== bIsEntry) return aIsEntry ? -1 : 1;
      return b.subtreeSize - a.subtreeSize;
    };
    for (const sub of [...dir.subdirs.values()].sort(subdirOrder)) {
      const size = layoutDir(sub);
      items.push({ id: dirNodeId(sub.rel), w: size.w, h: size.h, x: 0, y: 0 });
    }
    const fileOrder = (a: FileEntry, b: FileEntry): number => {
      const aIsEntry = /main|index|server|app\./i.test(a.rel);
      const bIsEntry = /main|index|server|app\./i.test(b.rel);
      if (aIsEntry !== bIsEntry) return aIsEntry ? -1 : 1;
      return (lineCounts.get(b.rel) ?? 0) - (lineCounts.get(a.rel) ?? 0);
    };
    for (const f of [...dir.files].sort(fileOrder)) items.push(fileLayout.get(f.rel)!);
    const ownerOf = (rel: string): string => {
      if (dir.files.some((f) => f.rel === rel)) return fileNodeId(rel);
      for (const sub of dir.subdirs.keys()) {
        if (rel.startsWith(sub + '/')) return dirNodeId(sub);
      }
      return '';
    };
    for (const [fromRel, toRel] of plainDeps) {
      const a = ownerOf(fromRel);
      const b = ownerOf(toRel);
      if (a && b && a !== b) localDeps.push([a, b]);
    }
    const content = layoutGroup(items, localDeps);
    for (const item of items) {
      if (item.id.startsWith('file_')) {
        const rel = files.find((f) => fileNodeId(f.rel) === item.id)!.rel;
        fileLayout.get(rel)!.x = item.x;
        fileLayout.get(rel)!.y = item.y;
      } else {
        const subRel = [...dirByRel.values()].find((d) => d.rel !== '' && dirNodeId(d.rel) === item.id)!.rel;
        dirOffset.set(subRel, { x: item.x, y: item.y });
      }
    }
    const containerW = content.w + PAD * 2;
    const containerH = content.h + PAD * 2 + TITLE_H;
    if (dir.rel !== '') {
      nodes.push({
        id: dirNodeId(dir.rel),
        label: `📁 ${dir.name}`,
        x: 0,
        y: 0,
        width: containerW,
        height: containerH,
        type: 'module',
        style: { ...DIR_STYLE, borderRadius: 8 },
      });
    }
    dirContentOffset.set(dir.rel, { dx: PAD, dy: PAD + TITLE_H, w: containerW, h: containerH });
    return { w: containerW, h: containerH };
  };

  const plainDeps: Array<[string, string]> = [...fileDeps];
  const fileLayout = new Map<string, LayoutItem>();
  for (const f of files) fileLayout.set(f.rel, { id: fileNodeId(f.rel), w: FILE_W, h: FILE_H, x: 0, y: 0 });
  const dirContentOffset = new Map<string, { dx: number; dy: number; w: number; h: number }>();
  const dirOffset = new Map<string, { x: number; y: number }>();
  const rootSize = layoutDir(rootDir);

  const accumulate = (dirRel: string, baseX: number, baseY: number): void => {
    const d = dirByRel.get(dirRel)!;
    const selfOff = dirOffset.get(dirRel) || { x: 0, y: 0 };
    const content = dirContentOffset.get(dirRel)!;
    const containerX = baseX + selfOff.x;
    const containerY = baseY + selfOff.y;
    const contentX = dirRel === '' ? containerX : containerX + content.dx;
    const contentY = dirRel === '' ? containerY : containerY + content.dy;
    if (dirRel !== '') {
      const node = nodes.find((n) => n.id === dirNodeId(dirRel))!;
      node.x = containerX;
      node.y = containerY;
    }
    for (const f of d.files) {
      const item = fileLayout.get(f.rel)!;
      item.x += contentX;
      item.y += contentY;
    }
    for (const sub of d.subdirs.values()) accumulate(sub.rel, contentX, contentY);
  };
  accumulate('', MARGIN, MARGIN);

  for (const f of files) {
    const p = parsed.get(f.rel)!;
    const item = fileLayout.get(f.rel)!;
    const langKey = f.ext.slice(1);
    const colors = LANG_COLORS[langKey] || DEFAULT_FILE_COLOR;
    nodes.push({
      id: fileNodeId(f.rel),
      label: `${path.posix.basename(f.rel)} · ${p.funcCount} APIs`,
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: FILE_W,
      height: FILE_H,
      type: 'file',
      description: f.rel,
      style: { ...colors, borderRadius: 4 },
    });
    if (f.dir && f.dir !== '.') {
      edges.push({ id: `contains_${sanitize(f.dir)}_${sanitize(f.rel)}`, from: dirNodeId(f.dir), to: fileNodeId(f.rel), label: 'contains' });
    }
    semanticFiles.push({
      id: fileNodeId(f.rel),
      path: f.rel,
      responsibility: `${f.dir === '.' ? '根目录' : f.dir} — ${p.funcCount} 个 API（导入自 ${p.imports.length} 个模块）`,
      symbols: p.symbols.length > 0 ? p.symbols : undefined,
      lines: lineCounts.get(f.rel) ?? 0,
    });
  }

  for (const d of [...dirByRel.values()].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    if (d.rel === '') continue;
    const parentRel = path.posix.dirname(d.rel);
    const parentId = parentRel === '.' || parentRel === '' ? null : dirNodeId(parentRel);
    if (parentId) {
      edges.push({ id: `contains_${sanitize(parentRel)}_${sanitize(d.rel)}`, from: parentId, to: dirNodeId(d.rel), label: 'contains' });
    }
  }

  // 聚合依赖边（与写端同法：按 lca 层的 owner 分组）
  const normDir = (d: string): string => (d === '.' ? '' : d);
  const ancestorsOf = (dir: string): string[] => {
    const out: string[] = [];
    let d = normDir(dir);
    for (;;) {
      out.push(d);
      if (d === '') break;
      d = normDir(path.posix.dirname(d));
    }
    return out;
  };
  const ownerAtLca = (rel: string, lca: string): string => {
    const rest = lca === '' ? rel : rel.slice(lca.length + 1);
    const slash = rest.indexOf('/');
    if (slash === -1) return fileNodeId(rel);
    return dirNodeId(lca === '' ? rest.slice(0, slash) : `${lca}/${rest.slice(0, slash)}`);
  };
  const aggEdges = new Map<string, { from: string; to: string; n: number }>();
  const directEdges: Array<[string, string]> = [];
  for (const [fromRel, toRel] of plainDeps) {
    const fromAnc = ancestorsOf(path.posix.dirname(fromRel));
    const toAncSet = new Set(ancestorsOf(path.posix.dirname(toRel)));
    const lca = fromAnc.find((d) => toAncSet.has(d));
    if (lca === undefined) continue;
    const a = ownerAtLca(fromRel, lca);
    const b = ownerAtLca(toRel, lca);
    if (a === b) continue;
    if (a.startsWith('file_') && b.startsWith('file_')) directEdges.push([fromRel, toRel]);
    else {
      const key = `${a}|${b}`;
      const cur = aggEdges.get(key);
      if (cur) cur.n++;
      else aggEdges.set(key, { from: a, to: b, n: 1 });
    }
  }
  for (const [fromRel, toRel] of directEdges) {
    edges.push({ id: `dep_${sanitize(fromRel)}_${sanitize(toRel)}`, from: fileNodeId(fromRel), to: fileNodeId(toRel), label: 'imports', type: 'dashed' });
  }
  const aggSorted = [...aggEdges.values()].sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0) || (x.to < y.to ? -1 : x.to > y.to ? 1 : 0));
  for (const { from, to, n } of aggSorted) {
    edges.push({
      id: `dep_${sanitize(from)}_${sanitize(to)}`,
      from,
      to,
      label: n > 1 ? `imports ×${n}` : 'imports',
      type: 'dashed',
      style: n > 3 ? { strokeWidth: 2 } : undefined,
    });
  }

  const canvasW = Math.round(rootSize.w + MARGIN * 2);
  const canvasH = Math.round(rootSize.h + MARGIN * 2 + TITLE_H);
  const base: DesignDSL = {
    id: `imported_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature, // ★ 与写端 `input.title || feature` 对齐：live 文件的 title 就是 feature（实测），**不带设计侧的 title**
    source_root: sourceRoot,
    geometry: { layout: 'free', width: Math.max(canvasW, 800), height: Math.max(canvasH, 400), nodes, edges },
    semantic: { files: semanticFiles },
  } as DesignDSL;

  // 分层（与写端同一步；它会顺带把层名回填到 responsibility 前缀）
  const layered = detectArchLayers(base);

  // `_sync`：★ 与 `saveLiveFeature` 同形状，但 `source` 标成 `live_render`（**如实说明"这份是现渲染、不是冻结文件"**）。
  const now = Date.now();
  const { rev } = scanRevOf({ feature, sourceRoot: root });
  return {
    ...layered,
    _sync: {
      saved_at: new Date(now).toISOString(),
      source: 'live_render',
      feature,
      scanRev: rev,
      age: rev == null ? null : Math.max(0, now - rev),
    },
  } as DesignDSL;
}
