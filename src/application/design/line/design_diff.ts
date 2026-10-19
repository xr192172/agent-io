/**
 * design_diff —— 设计侧 × 实际侧的 **diff**（工具 `design_line` 的 `action=diff`）
 *
 * ## 语义（用户 2026-10-18 明确，逐字）
 * > "所谓的对拍其实就像 Git 的 diff 啊，你把两份文件进行一个 diff，看看 diff 出来的问题在哪里。"
 *
 * ★ 所以：
 * - **设计侧 = fork(实际侧)** ⇒ 两边本来就该一样；
 * - **"没动过"不是 diff** —— 两边一样，`git diff` 不会显示它；
 * - **diff 只显示三类**：
 *     `+` 只在设计侧（设计了但还没有）
 *         ├─ 扫描遗漏：live 未收录、但源码里确实有 ⇒ **不是要建**
 *         └─ 真要建：源码里也查不到         ⇒ 这才是"要建"
 *     `-` 只在实际侧（实际有但设计没收录 ⇒ 要补设计）
 *     `~` 两边都有但【内容不同】（人改过的地方 = 决策卡 + label + 边）
 *
 * ## 为什么这比"缺陷检测"健康
 * 它不判"你错没错"，只告诉你**"这份图纸和现状差在哪"** —— 差在哪儿，下一步就改哪儿。
 *
 * ## 搬家说明（2026-10-19，从 scripts/design-diff.mjs）
 * **逻辑照搬，一个判据都没"顺手改"**。特别是 `checkEdgeInSource` 里的**浅正则**
 * —— 它自己也写着"不做完整 AST"。搬进 src 时按纪律本该换 AST，但那会**改行为**，
 * 不是搬家。⇒ 原样保留，并在函数注释里标明"这是浅判，已知不准"。
 *
 * ## 边界
 * - **不含符号级**：符号级 diff 归 `./rewrite/symbol_diff.ts`（`action=rewrite` 零写入模式）
 * - **不写 `--write-plan`**：那条旧路径产出的清单，现在由 `buildRefactorPlan` 现算（带语法门 + plan_id）
 */
import fs from 'node:fs';
import path from 'node:path';

type AnyNode = Record<string, unknown> & { id?: string };
type AnyEdge = { from?: string; to?: string; label?: string };

export interface DesignDiffResult {
  designNodes: number;
  liveNodes: number;
  designEdges: number;
  liveEdges: number;
  /** `+` 只在设计侧（设计了、实际还没有） */
  onlyDesign: string[];
  /** `-` 只在实际侧（实际有、设计没收录） */
  onlyLive: string[];
  /** `~` 两边都有但内容不同（人改过） */
  changed: Array<{ id: string; fields: string[] }>;
  /** 只在设计侧的边：其中**源码里确有引用**的 ⇒ 扫描遗漏（live 漏抓） */
  missedEdges: Array<{ from: string; to: string; verdict: string; evidence: string }>;
  /** 只在设计侧的边：源码里完全找不到 ⇒ **真要建** */
  realMissingEdges: Array<{ from: string; to: string }>;
  /** 只在实际侧的边（设计没收录） */
  onlyLiveEdges: Array<{ from: string; to: string }>;
}

/** 内容比较：只比"有意义的字段"（跳过坐标/尺寸/颜色这些渲染噪声） */
const MEANINGFUL = ['decision', 'task', 'label', 'type', 'arch_layer', 'description'];

const stripExt = (p: string): string => String(p).replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '');
const normPath = (p: string): string => stripExt(path.resolve(p)).replace(/[\\/]index$/, '').toLowerCase();

/** 节点 id → 源码相对路径（优先用 description，那里存的是真路径） */
function nodePath(node: AnyNode | undefined): string | null {
  const d = node?.description;
  if (typeof d === 'string' && d.includes('/') && !/\s/.test(d)) return d;
  return null;
}

/** 抓文件里出现过的模块说明符（★ 浅正则，不建 AST —— 见头注） */
function importSpecs(text: string): string[] {
  const specs: string[] = [];
  const re = /(?:\bfrom|\brequire|\bimport|\bexport)\s*\(?\s*(['"])([^'"\n]+)\1/g;
  for (const m of text.matchAll(re)) specs.push(m[2]);
  return specs;
}

/** 设计侧 × 实际侧的 diff（只读） */
export function designDiff(projectDir: string, feature: string): DesignDiffResult {
  const designPath = path.join(projectDir, '.agent-io', 'design', `${feature}.dsl.json`);
  const livePath = path.join(projectDir, '.agent-io', 'live', `${feature}.dsl.json`);
  const design = JSON.parse(fs.readFileSync(designPath, 'utf8')) as { geometry?: { nodes?: AnyNode[]; edges?: AnyEdge[] } };
  const live = JSON.parse(fs.readFileSync(livePath, 'utf8')) as { geometry?: { nodes?: AnyNode[]; edges?: AnyEdge[] } };

  const dNodes = new Map<string, AnyNode>();
  for (const n of design.geometry?.nodes ?? []) if (n.id) dNodes.set(n.id, n);
  const lNodes = new Map<string, AnyNode>();
  for (const n of live.geometry?.nodes ?? []) if (n.id) lNodes.set(n.id, n);

  const onlyDesign = [...dNodes.keys()].filter((id) => !lNodes.has(id));
  const onlyLive = [...lNodes.keys()].filter((id) => !dNodes.has(id));

  const changed: DesignDiffResult['changed'] = [];
  for (const [id, d] of dNodes) {
    const l = lNodes.get(id);
    if (!l) continue;
    const fields = MEANINGFUL.filter((k) => JSON.stringify(d[k] ?? null) !== JSON.stringify(l[k] ?? null));
    if (fields.length) changed.push({ id, fields });
  }

  // 边：按 (from,to) 比
  const ekey = (e: AnyEdge): string => `${e.from}|${e.to}`;
  const dEdges = new Map<string, AnyEdge>();
  for (const e of design.geometry?.edges ?? []) dEdges.set(ekey(e), e);
  const lEdges = new Map<string, AnyEdge>();
  for (const e of live.geometry?.edges ?? []) lEdges.set(ekey(e), e);
  const eOnlyDesign = [...dEdges.keys()].filter((k) => !lEdges.has(k));
  const eOnlyLive = [...lEdges.keys()].filter((k) => !dEdges.has(k));

  const fileCache = new Map<string, string | null>();
  const readSrc = (rel: string): string | null => {
    if (fileCache.has(rel)) return fileCache.get(rel) ?? null;
    let text: string | null = null;
    try {
      text = fs.readFileSync(path.join(projectDir, rel), 'utf8');
    } catch {
      text = null;
    }
    fileCache.set(rel, text);
    return text;
  };

  /**
   * 判定一条"只在设计侧"的边：源码里 from 是否真的 import 了 to。
   *
   * ★ 这是**浅判**（正则读文本，不建 AST）—— 原样从 `scripts/design-diff.mjs` 搬来，
   *   **没有在搬家时改进它**（改判据 = 改行为，不是搬家）。
   * ★ 铁律（原注释）：**宁可少报，不许把"可能要建"说成"必须建"** ⇒
   *   `unknown` / `weak` 一律归"扫描遗漏"，只有 `none` 才算"真要建"。
   */
  function checkEdgeInSource(edge: AnyEdge): { verdict: string; evidence: string } {
    const label = String(edge.label || '');
    if (!label.startsWith('imports')) return { verdict: 'unknown', evidence: `非 imports 边（${label}）` };

    const fromRel = nodePath(dNodes.get(String(edge.from)));
    const toRel = nodePath(dNodes.get(String(edge.to)));
    if (!fromRel || !toRel) return { verdict: 'unknown', evidence: '节点无路径' };

    const text = readSrc(fromRel);
    if (text == null) return { verdict: 'unknown', evidence: '读不到源文件' };

    const toAbs = normPath(toRel);
    const toBase = path.basename(stripExt(toRel));
    const dir = path.dirname(path.resolve(projectDir, fromRel));

    for (const spec of importSpecs(text)) {
      if (spec.startsWith('.')) {
        if (normPath(path.resolve(dir, spec)) === toAbs) return { verdict: 'verified', evidence: `'${spec}'` };
      } else {
        const tail = stripExt(spec).split('/').slice(0, 2).join('/');
        if (spec === toBase || tail.endsWith(toBase)) return { verdict: 'verified', evidence: `'${spec}'` };
      }
    }
    if (new RegExp(`\\b${toBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      return { verdict: 'weak', evidence: `裸词 ${toBase}` };
    }
    return { verdict: 'none', evidence: '' };
  }

  const edgeRows = eOnlyDesign.map((k) => {
    const e = dEdges.get(k) as AnyEdge;
    const { verdict, evidence } = checkEdgeInSource(e);
    return { from: String(e.from), to: String(e.to), verdict, evidence };
  });

  return {
    designNodes: dNodes.size,
    liveNodes: lNodes.size,
    designEdges: dEdges.size,
    liveEdges: lEdges.size,
    onlyDesign,
    onlyLive,
    changed,
    missedEdges: edgeRows.filter((r) => r.verdict !== 'none'),
    realMissingEdges: edgeRows.filter((r) => r.verdict === 'none').map((r) => ({ from: r.from, to: r.to })),
    onlyLiveEdges: eOnlyLive.map((k) => {
      const e = lEdges.get(k) as AnyEdge;
      return { from: String(e.from), to: String(e.to) };
    }),
  };
}
