/**
 * find_references —— 查找符号的所有引用（引用/调用方查询）
 *
 * 解决日常缺口：改/删一个符号前想"谁引用了它"。此前只能 grep 调用方（肌肉记忆
 * 陷阱同 rename）。本工具复用 rename_symbol 的引用图内核（expandClosure 闭包 +
 * analyzeModuleSource + resolveRel/resolveAliasedImport 边解析），只读报告，不改任何文件。
 *
 * 与 rename_symbol 的 dry_run 的关系：dry_run 是"改名视角"（old→new 编辑）；本品是
 * "引用视角"（只报文件 + import 子句/使用点行号），零编辑意图。
 *
 * 扩展 mode=field（2026-09，dogfood 驱动的结构引用缺口）：
 *   默认 mode=symbol 只报"谁 import 这个符号名"——对"加字段/改签名"这类改动不够，
 *   会漏掉同名文件内的对象字面量**构造点**与字段**读取点**。mode=field 补上：
 *     - 读取点：`obj.<field>`
 *     - 构造点：`<field>:`（对象字面量键）
 *   并**包含定义文件内部**（构造点常就在定义文件里）。这样改接口前能一次看清
 *   "谁构造、谁读取字段 F"，不再退回 grep。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot, loadAliasConfig, resolveAliasedImport, resolveLangImport } from '../../cross/project_root.js';
import { analyzeModuleSource, resolveRel, buildNoExt } from '../rename_symbol/index.js';
import { camelToSnake, scanLiteralOccurrences, type RawLiteralMatch } from '../rf-rename/rename_symbols.js';
import { collectFieldRefs, collectTypeConstructCandidates, type FieldRefFile, type TypeConstructCandidate } from './field_refs.js';
import { parseFileFull } from '../../../infrastructure/parse/index.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { ensureProjectIndex } from '../../../infrastructure/index/index_freshness.js';
import { buildImportGraph } from '../../../infrastructure/graph/import_graph.js';
import { scanTextMentions } from '../../../infrastructure/text/refs_text.js';
import { getProjectView } from '../../../infrastructure/project_view.js'; // ★ §19②
import type { ScanBounds } from '../../../infrastructure/scan_bounds.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** 每个文件最多取多少条文本提及（避免单文件刷屏） */
const TEXT_MENTION_PER_FILE = 3;
/**
 * 文本提及补召回时最多扫多少文件。超过则**有界扫描**并把 `textBounded` 如实上报 ——
 * 绝不假装"候选集是完整的"（"不撒谎"是索引层的唯一不变量）。
 */
const TEXT_SCAN_MAX_FILES = 3000;

/** 候选集来源的**内部**账目（供 `[C]` 收成统一 `ScanBounds` 后再对外披露） */
interface CandidateScan {
  /** import 反向闭包里的文件数 */
  closureFiles: number;
  /** 文本层额外补进来的候选文件数（跨语言 / 无 import 边的引用只能靠它） */
  textAdded: number;
  /** 文本层实际扫过的文件数 */
  textScanned: number;
  /** 文本层是否因上限被截断（true ⇒ 候选集可能不全，必须向调用方标注） */
  textBounded: boolean;
}

/** ★ 候选账目 → 统一「扫描边界」（唯一落点：`src/infrastructure/scan_bounds.ts` 的契约）。 */
function boundsOf(scan: CandidateScan): ScanBounds {
  return {
    scope: 'import 反向闭包（cache.db 的 importer 图）∪ 全仓文本提及补召回（跨语言 / 无 import 边的引用只能靠它）',
    // 实际逐个读取解析的候选文件数 = 闭包文件 + 文本层补进来的
    scanned: { files: scan.closureFiles + scan.textAdded },
    truncated: scan.textBounded,
    // 核心三槽装不下的分解读数（该工具独有）→ 逃生舱
    detail: { closureFiles: scan.closureFiles, textAdded: scan.textAdded, textScanned: scan.textScanned },
  };
}

interface CandidateSet {
  files: string[];
  scan: CandidateScan;
}

/**
 * 候选引用文件：优先走已建 cache.db 的 import 图（反向闭包 = 谁（直接/间接）import 定义模块）。
 * 索引缺失/失败返回 null，由调用方回退到"零前置冷启后再取一次"。
 *
 * ★★ 2026-09-15 补召回（修静默漏报）：import 反向闭包**看不见"没有 import 边的引用"**，
 *   最典型的就是**跨语言**——Go/Python 文件直接调一个 TS 导出的函数名，磁盘上不存在任何 TS import 边，
 *   于是它永远进不了候选集。实测后果：零前置冷启让索引从"空"变"非空"之后，这条快路径接管、
 *   原先的"全闭包回退"被绕过 ⇒ `find_references` 对跨语言引用**静默漏报**
 *   （`tests/tools/find_references.test.ts` 的 3 个跨语言用例正是这么红的，而代码注释还写着
 *   "绝不再回退全闭包逐文件即时解析" —— 那是性能取舍，不该以静默漏报为代价）。
 *   修法：用**粗层（文本提及）**把候选补成**超集**，是否真引用仍由细层（AST / 文本探针）判定；
 *   代价与召回边界都如实上报（见 `CandidateScan`）。
 */
async function indexCandidateFiles(
  resolvedRoot: string,
  defAbs: string,
  symbolName?: string,
): Promise<CandidateSet | null> {
  try {
    const db = getProjectCacheDb(resolvedRoot);
    const cnt = (db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c?: number } | undefined)?.c ?? 0;
    if (cnt === 0) return null;
    const g = buildImportGraph(db, resolvedRoot);
    const defRel = path.relative(resolvedRoot, defAbs).split(path.sep).join('/');
    const seen = new Set<string>([defRel]);
    const queue = [defRel];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      const imp = g.importerOf.get(cur);
      if (imp) for (const e of imp) if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
    const closureFiles = seen.size;

    // ── 粗层补召回：谁在文本里提到了这个符号名 ──
    let textAdded = 0;
    let textScanned = 0;
    let textBounded = false;
    if (symbolName && symbolName.length >= 3) {
      const all = getProjectView(resolvedRoot).sourceFiles; // ★ §19②：走 ProjectView（一处算、多处取）
      const bounded = all.length > TEXT_SCAN_MAX_FILES;
      const slice = bounded ? all.slice(0, TEXT_SCAN_MAX_FILES) : all;
      textBounded = bounded;
      textScanned = slice.length;
      const hits = scanTextMentions(resolvedRoot, symbolName, slice, { limitPerFile: TEXT_MENTION_PER_FILE });
      for (const h of hits) {
        if (seen.has(h.file) || h.file === defRel) continue;
        seen.add(h.file);
        textAdded++;
      }
    }

    return {
      files: [...seen].map((r) => path.join(resolvedRoot, r)),
      scan: { closureFiles, textAdded, textScanned, textBounded },
    };
  } catch {
    return null;
  }
}
export interface ReferenceSite {
  /** export/import/使用点所在的字节偏移 */
  offset: number;
  /** 1-based 行号 */
  line: number;
  /** 该处文本（旧名） */
  text: string;
  /** 语义：'definition' | 'import' | 'usage' | 'export_list' | 'reexport' */
  kind: string;
}

export interface ReferenceFile {
  /** 相对项目根的路径（POSIX 分隔符） */
  file: string;
  /** 引用点 */
  refs: ReferenceSite[];
  /** 导入子句摘要（source 字面量，便于 LLM 看懂怎么引的） */
  importSources: string[];
}

export interface FindReferencesResult {
  ok: boolean;
  /** mode=symbol 时为符号名；mode=field 时为字段名；mode=type 时为类型名 */
  symbol: string;
  mode: 'symbol' | 'field' | 'type';
  definition?: { file: string; kind: string; refs: ReferenceSite[] };
  importers?: ReferenceFile[];
  importerCount: number;
  /** mode=field 时：该字段的读取/构造/解构/声明点（含定义文件内部），按文件分组，含行内上下文 */
  fieldRefs?: FieldRefFile[];
  /** mode=type 时：类型声明的成员字段集 */
  typeMembers?: string[];
  /** mode=type 时：与类型成员交叠 ≥ min_hit 的对象字面量候选构造点 */
  typeCandidates?: TypeConstructCandidate[];
  /** report_literals=true 时：符号 snake 变体在项目文本里的字面量命中（如工具注册名/README/测试里的串），只扫描不改 */
  literals?: Array<{ needle: string; matches: RawLiteralMatch[] }>;
  /**
   * ★ 扫描边界（统一形状，2026-09-29）：import 反向闭包多少、文本层补了多少、是否被上限截断。
   * 为什么要给 LLM 看：**召回边界必须可见**。"跨语言引用只能靠文本层补"，若文本层被截断，
   * 本次结果就可能不全 —— 这属于"要么一致、要么明确标注"里的**标注**。
   * 形状与挂载层见 `src/infrastructure/scan_bounds.ts`（本字段原名 `candidateScan`，本笔收成统一形状）。
   */
  bounds?: ScanBounds;
  /** 阻断/非模块级符号等理由 */
  blocked?: string[];
  /**
   * ★ 本次**解析出的项目根**（symbol 模式：`symRoot ?? resolveProjectRoot(fileAbs)` 的实况）——
   *   Core 内部早就定位了它（此前只在手里、没进产物）；T18：回传给构造点与下游反查。
   *   作用域类字段（= `Touched.project_dir` 的产物来源）：随时可给，不依赖成败。
   *   ★ field / type 模式不解析根（直接吃调用方给的 project_dir）⇒ 那两种模式本字段省略。
   *   ★ 字段名 = 受控词表的 `project_dir`（原 `root` 不在词表里 ⇒ 同一事实两个名字，2026-10-05 收口）。
   */
  project_dir?: string;
}

function lineOf(src: string, offset: number): number {
  return src.slice(0, offset).split('\n').length;
}

/** report_literals=true 时：扫描符号名 snake 变体（及原串兜底）在项目文本里的字面量命中，只报告不改动 */
async function scanLiterals(projectDir: string, symbol: string): Promise<Array<{ needle: string; matches: RawLiteralMatch[] }> | undefined> {
  const needle = camelToSnake(symbol);
  if (!needle) return undefined;
  // 原串与 snake 变体都扫：符号本身就可能以 kebab/snake 出现在文档（如 findSymbol→find_symbol；纯小写则只用原串）
  const needles = needle === symbol ? [needle] : [needle, symbol];
  return scanLiteralOccurrences(projectDir, [...new Set(needles)]);
}

const FIELD_KIND_LABEL: Record<string, string> = {
  'field-read': '读',
  'field-key': '构',
  'field-destructure': '解',
  'field-decl': '声明',
};

async function findReferencesCore(input: {
  /** mode=symbol 必填：定义符号的文件（绝对路径；或相对 project_dir/cwd）。mode=field/type 可选（用于定 scope） */
  file?: string;
  /** mode=symbol 必填：符号名。mode=field 忽略 */
  symbol?: string;
  /** mode=field 必填：要查的字段名 */
  field?: string;
  /** symbol（默认，找符号的 importers/使用点）| field（字段读取/构造/解构/声明点）| type（形如某类型的对象字面量构造候选） */
  mode?: 'symbol' | 'field' | 'type';
  /** field/type 模式：closure（默认，给 file 时按 import 闭包）| all（全项目扫） */
  scope?: 'closure' | 'all';
  /** type 模式：与类型成员交叠 ≥ 该值才判为候选构造点（默认 2） */
  min_hit?: number;
  /** true=额外扫描符号 snake 变体（如 renderDsl→render_dsl）在项目文本里的字面量命中（文档/测试/契约/工具注册名），返回清单待核验，不改动 */
  report_literals?: boolean;
  project_dir?: string;
}): Promise<FindReferencesResult> {
  const effectiveRoot = input.project_dir ? path.resolve(String(input.project_dir)) : undefined;
  const projectDir = effectiveRoot ?? path.resolve(process.cwd());

  // ── 入参前置校验（§16.4 P-D，2026-09-28）──
  // file / symbol / field 是「**模式相关必填**」——schema 里只能标 optional（symbol 模式要 file+symbol，
  // field 模式要 field，type 模式要 file+symbol）。上游一旦把 undefined 漏下来，
  // `path.resolve(root, undefined)` 会拼出 `...\undefined` 这种**最难反查**的 ENOENT；
  // 更隐蔽的是 `String(undefined) === 'undefined'`，它会变成一个合法的字符串参数、
  // 静默去查一个名叫 "undefined" 的符号。⇒ 三种模式在此**一次性判清**：
  // 缺参就 throw「缺什么 + 怎么给」（§21③ 失败就抛，不降级成"看起来正常"的返回）。
  const reqStr = (v: unknown, what: string, how: string): string => {
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`缺少必需参数 ${what}：${how}`);
    return v;
  };
  const EXAMPLE_FILE = `'src/application/refactor/rf-find/find_references.ts'`;
  if (input.mode === 'type') {
    reqStr(input.file, 'file', `mode=type 需要 file（类型定义文件）。例：{mode:'type', file:${EXAMPLE_FILE}, symbol:'FindReferencesResult'}`);
    reqStr(input.symbol, 'symbol', `mode=type 需要 symbol（类型名）。例：{mode:'type', file:${EXAMPLE_FILE}, symbol:'FindReferencesResult'}`);
  } else if (input.mode === 'field') {
    reqStr(input.field, 'field', `mode=field 需要 field（要查的字段名）。例：{mode:'field', field:'importerCount', project_dir:'.'}`);
  } else {
    reqStr(input.file, 'file', `mode=symbol（默认）需要 file（定义符号的文件）。例：{file:${EXAMPLE_FILE}, symbol:'findReferences'}`);
    reqStr(input.symbol, 'symbol', `mode=symbol（默认）需要 symbol（模块级声明名）。例：{file:${EXAMPLE_FILE}, symbol:'findReferences'}`);
  }

  // type 模式：形如某类型的对象字面量构造候选（启发式，找成员交叠 ≥ min_hit）
  if (input.mode === 'type') {
    const file = input.file as string; // 缺参已在上方前置校验 throw
    const symbol = input.symbol as string;
    const { members, candidates } = await collectTypeConstructCandidates({
      project_dir: projectDir,
      file,
      symbol,
      scope: input.scope === 'all' ? 'all' : 'closure',
      min_hit: input.min_hit,
    });
    return {
      ok: true,
      symbol,
      mode: 'type',
      importerCount: 0,
      typeMembers: members,
      typeCandidates: candidates,
      literals: input.report_literals ? await scanLiterals(projectDir, symbol) : undefined,
      blocked: members.length === 0 ? ['未从声明中解出成员字段（认 interface/type { ... }）'] : candidates.length === 0 ? ['未找到交叠 ≥ min_hit 的对象字面量候选'] : undefined,
    };
  }

  // field 模式：字段的结构引用点（AST 分类：读/构/解/声明，含定义文件内部）
  if (input.mode === 'field') {
    const field = input.field as string; // 缺参已在上方前置校验 throw
    const fieldRefs = await collectFieldRefs({
      project_dir: projectDir,
      field,
      file: input.file,
      scope: input.scope === 'all' ? 'all' : 'closure',
    });
    return {
      ok: true,
      symbol: field,
      mode: 'field',
      importerCount: 0,
      fieldRefs,
      literals: input.report_literals ? await scanLiterals(projectDir, field) : undefined,
      blocked: fieldRefs.length === 0 ? ['项目中未找到对该字段的引用'] : undefined,
    };
  }

  // symbol 模式：既有逻辑
  const mode = 'symbol' as const;
  const file = input.file as string; // 缺参已在上方前置校验 throw
  const symbol = input.symbol as string;
  const symRoot = input.project_dir ? path.resolve(String(input.project_dir)) : undefined;
  const fileAbs = path.isAbsolute(file) ? path.resolve(file) : symRoot ? path.resolve(symRoot, file) : path.resolve(process.cwd(), file);
  const resolvedRoot = symRoot ?? resolveProjectRoot(fileAbs);
  const rootAlias = loadAliasConfig(resolvedRoot);

  const defSrc = readFileSync(fileAbs, 'utf-8');
  const def = await analyzeModuleSource(defSrc, fileAbs);
  const isTsDef = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(fileAbs);
  if (!isTsDef) {
    // 非 TS target（跨语言，如 Java）：语言内核确认符号定义于此文件（类/方法/函数均可，不做"模块级声明"约束）
    const pf = await parseFileFull(path.basename(fileAbs), defSrc);
    if (!pf || !pf.symbols.some((s) => s.name === symbol!)) {
      return { ok: false, symbol: symbol!, mode, importerCount: 0, project_dir: resolvedRoot, blocked: [`"${symbol}" 未在 ${path.basename(fileAbs)} 中找到定义`] };
    }
  }
  const kind = def?.rootKinds.get(symbol!);
  if (isTsDef) {
    if (!def) return { ok: false, symbol: symbol!, mode, importerCount: 0, project_dir: resolvedRoot, blocked: ['定义文件解析失败'] };
    if (!kind) return { ok: false, symbol: symbol!, mode, importerCount: 0, project_dir: resolvedRoot, blocked: [`"${symbol}" 不是该文件的模块级声明`] };
    if (kind === 'import' || kind === 'reexport' || kind === 'exported') {
      return { ok: false, symbol: symbol!, mode, importerCount: 0, project_dir: resolvedRoot, blocked: [`"${symbol}" 在 ${path.basename(fileAbs)} 中是 import 绑定，请在定义文件上查询`] };
    }
  }
  const declOffset = (isTsDef && def ? def.rootOffsets.get(symbol!) ?? 0 : 0);

  // 闭包内引用点收集（import + usage + export_list）
  // 闭包内引用点收集（import + usage + export_list）。候选集只走持久索引的 import 反闭包；
  // 索引缺失时**先就地冷启建索引再重试一次**（零前置），仍为空才拒绝——
  // 绝不再回退"全闭包逐文件即时解析"（仓库大时打满 CPU/内存）。
  // 候选集：import 反向闭包（快路径）**∪ 文本提及补召回**（跨语言 / 无 import 边，见 indexCandidateFiles）。
  // 索引缺失时先就地冷启建索引再重试一次（零前置），仍为空才拒绝。
  let cand = await indexCandidateFiles(resolvedRoot, fileAbs, symbol);
  if (cand === null) {
    const { state } = await ensureProjectIndex(resolvedRoot);
    if (state !== 'empty') cand = await indexCandidateFiles(resolvedRoot, fileAbs, symbol);
  }
  if (cand === null) {
    return {
      ok: false,
      symbol: symbol!,
      mode,
      importerCount: 0,
      project_dir: resolvedRoot,
      blocked: [
        `索引建不出来：${resolvedRoot} 下没有可解析的源码（或解析器缺失），因此拿不到 import 反闭包。` +
          `为避免全仓逐文件即时解析导致的卡顿与内存暴涨，find_references / safe_rename 不回退到时即扫描——` +
          `请确认 project_dir 指向代码根目录。`,
      ],
    };
  }
  const bounds = boundsOf(cand.scan);
  const candidates = cand.files;
  if (candidates.length > 4000) {
    return {
      ok: false,
      symbol: symbol!,
      mode,
      importerCount: 0,
      project_dir: resolvedRoot,
      blocked: [`索引反闭包过大（${candidates.length} 个候选文件，上限 4000）。请收窄项目规模或核实索引是否越界（如误把依赖建进索引）。`],
    };
  }
  const files = candidates;
  const byNoExt = buildNoExt(files);

  const aliasMemo = new Map<string, ReturnType<typeof loadAliasConfig>>();
  const aliasFor = (f: string) => {
    const d = path.dirname(f);
    if (!aliasMemo.has(d)) aliasMemo.set(d, loadAliasConfig(d));
    return aliasMemo.get(d) ?? null;
  };
  const resolveEdge = (source: string, f: string): string | null => {
    if (source.startsWith('.')) return resolveRel(source, f, byNoExt);
    const a = aliasFor(f);
    return a ? resolveAliasedImport(source, a) : null;
  };

  const importers: ReferenceFile[] = [];
  const TS_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;
  for (const f of files) {
    if (path.resolve(f) === fileAbs) continue;
    const src = readFileSync(f, 'utf-8');
    if (!TS_FILE_RE.test(f)) {
      // 跨语言引用 + is-target：对「pkg.Symbol」限定引用做精准门槛——`pkg` 必须经某 import 连到 target
      // 定义模块才报高信任(cross-call)，前缀属于其它包则剔除（降误报）；裸引用无法确认也不可剔除 → 保留为
      // cross-usage 疑似（异构同名场景的真实召回手段，不因无法联证而误删）。
      const needle = symbol!;
      const lines = src.split('\n');
      let running = 0;
      const lineOffsets: number[] = [];
      for (const ln of lines) { lineOffsets.push(running); running += ln.length + 1; }
      const crossRefs: ReferenceSite[] = [];
      let anyAstHit = false; // 该 symbol 在本文件是否有 AST 踪迹（含被 is-target 剔除的）——有则不再文本兜底
      const reportAt = (line: number, kind: ReferenceSite['kind'], text = needle) =>
        crossRefs.push({ offset: lineOffsets[line - 1] ?? 0, line, text, kind });
      // targetBindings：连到 target 定义模块（同文件/同目录）的 import 所引入的本地名
      const targetBindings = new Set<string>();
      let parsed: Awaited<ReturnType<typeof parseFileFull>> | null = null;
      try {
        parsed = await parseFileFull(f, src);
        for (const imp of parsed.imports) {
          if (!imp.bindings) continue;
          let connects = false;
          try {
            const resolved = resolveLangImport(f, imp, { root: resolvedRoot, goModules: [] });
            const ra = resolved ? path.resolve(resolved) : null;
            if (ra && (ra === fileAbs || path.dirname(ra) === path.dirname(fileAbs))) connects = true;
          } catch { /* resolve 失败视为不连 */ }
          if (connects) for (const b of imp.bindings) targetBindings.add(b);
        }
        for (const c of parsed.calls) {
          if (c.callee !== needle) continue;
          anyAstHit = true;
          const expr = c.callee_expr || needle;
          const dot = expr.indexOf('.');
          if (dot >= 0) {
            // 限定引用 pkg.Symbol：只报「pkg 连到 target」；其它包前缀 → 剔除误报
            const pkg = expr.slice(0, dot);
            if (targetBindings.has(pkg)) reportAt(c.line, 'cross-call', expr);
          } else {
            reportAt(c.line, 'cross-usage'); // 裸引用：疑似保留
          }
        }
        for (const t of parsed.type_refs) {
          if (t.type_name !== needle) continue;
          anyAstHit = true;
          reportAt(t.line, 'cross-usage');
        }
      } catch { /* AST 解析失败则走兜底 */ }
      // 兜底词边界探针（仅当该 symbol 在 AST 完全无踪迹时跑，跳过注释/字符串样式行，保异构召回）。
      // is-target 也在此做文本级判定：限定式 `pkg.compute` 的前缀若非「连到 target 的 import binding」→ 剔除误报；
      // 裸 `compute`（无前缀）无法确认 → 保留为疑似。
      if (!anyAstHit) {
        const qualifiedRe = new RegExp(`([A-Za-z_][\\w.]*)\\.\\b${needle}\\b`);
        const bareRe = new RegExp(`\\b${needle}\\b`);
        for (let i = 0; i < lines.length; i++) {
          const raw = lines[i];
          const trim = raw.trim();
          if (!trim || trim.startsWith('//') || trim.startsWith('#') || trim.startsWith('/*') || trim.startsWith('*')) continue;
          const qm = raw.match(qualifiedRe);
          if (qm) {
            // 限定引用：仅当前缀是连到 target 的 import binding 才报，否则剔除
            if (targetBindings.has(qm[1])) {
              crossRefs.push({ offset: (lineOffsets[i] ?? 0) + raw.search(qualifiedRe), line: i + 1, text: needle, kind: 'cross-usage' });
            }
            continue;
          }
          const idx = raw.search(bareRe);
          if (idx >= 0) crossRefs.push({ offset: (lineOffsets[i] ?? 0) + idx, line: i + 1, text: needle, kind: 'cross-usage' });
        }
      }
      if (crossRefs.length > 0) {
        importers.push({ file: (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/'), refs: crossRefs, importSources: [] });
      }
      continue;
    }
    const mod = await analyzeModuleSource(src, f);
    if (!mod) continue;
    const refs: ReferenceSite[] = [];
    const importSources: string[] = [];
    for (const e of mod.imports) {
      if (!e.source) continue;
      // export * 转发不算"按名引用"
      if (e.star) continue;
      if (e.remoteName !== symbol) continue;
      const resolved = resolveEdge(e.source, f);
      if (!resolved || path.resolve(resolved) !== fileAbs) continue;
      importSources.push(e.source);
      if (e.remoteOffset !== null) refs.push({ offset: e.remoteOffset, line: lineOf(src, e.remoteOffset), text: symbol, kind: 'import' });
      // 无别名使用点（localName === symbol）
      if (e.localName === symbol) {
        for (const r of mod.rootRefs) if (r.name === symbol) refs.push({ offset: r.offset, line: lineOf(src, r.offset), text: symbol, kind: 'usage' });
      }
    }
    if (refs.length > 0 || importSources.length > 0) {
      importers.push({ file: (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/'), refs, importSources });
    }
  }

  // 定义文件自身的 export/使用点
  const defRefs: ReferenceSite[] = [{ offset: declOffset, line: lineOf(defSrc, declOffset), text: symbol!, kind: 'definition' }];
  for (const r of def?.rootRefs ?? []) if (r.name === symbol!) defRefs.push({ offset: r.offset, line: lineOf(defSrc, r.offset), text: symbol!, kind: 'usage' });
  for (const r of def?.exportRefs ?? []) if (r.name === symbol!) defRefs.push({ offset: r.offset, line: lineOf(defSrc, r.offset), text: symbol!, kind: 'export_list' });

  return {
    ok: true,
    symbol: symbol!,
    mode,
    definition: { file: (path.relative(resolvedRoot, fileAbs) || fileAbs).replace(/\\/g, '/'), kind: kind ?? 'module', refs: defRefs },
    importers,
    importerCount: importers.length,
    project_dir: resolvedRoot,
    bounds,
    literals: input.report_literals ? await scanLiterals(resolvedRoot, symbol!) : undefined,
  };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 本工具**只读不改**（引用/调用方查询）⇒ ★ **绝不填 `written_files`**（没有落盘动作）；
 * 只填"作用在哪个项目 / 涉及哪个符号 / 读取了哪些输入文件"。
 *
 * 入参类型说明：本文件原本把入参写成**匿名内联对象类型**（没有命名的 `FindReferencesInput`），
 * 为不新增对外名字、也不改 Core 的声明，这里用 `Parameters<typeof findReferencesCore>[0]`
 * 取同一类型（结构等价，调用方零感知）。
 */
function touchedOf(input: Parameters<typeof findReferencesCore>[0], r: FindReferencesResult): Touched {
  const touched: Touched = {};

  // project_dir：**优先取入参**（调用方声明的根，= 实现里的 effectiveRoot / symRoot，见 215 / 286 行）；
  //   入参没给则取**产物里的 project_dir**（Core 内部用 resolveProjectRoot() 推出来的根，见 r.project_dir，symbol 模式才有）；两者都取不到才省略（不猜）。
  if (input.project_dir) {
    touched.project_dir = path.resolve(String(input.project_dir));
  } else if (r.project_dir) {
    touched.project_dir = r.project_dir;
  }

  // symbols：对象类字段 = "本次调用**确立下来的**对象" ⇒ 必须 gate 在 r.ok：
  // 查不到符号（ok=false）时什么都没确立，整项省略（与写类"没落盘就不给"同一口径）。
  // 且**只在 mode=symbol 时填** —— 那时 r.symbol 是被查的**模块级符号名**，
  // 其 qualified_name 就是裸名（kernel.ts:366）；field/type 模式给的是**字段名/类型名**，
  // 它们**不是符号**，塞进 symbols 会污染口径 ⇒ 那两种模式省略。
  if (r.ok && r.mode === 'symbol' && r.symbol) touched.symbols = [r.symbol];

  // read_files：本次**真读过并作为结果给出**的仓库内文件。来源（均为仓库相对 POSIX 路径）：
  //   - definition.file：定义文件，291 行 readFileSync(fileAbs) 真读过；
  //   - importers[].file：被扫候选，365 行 readFileSync(f) 真读过；
  //   - fieldRefs[].file / typeCandidates[].file：field/type 模式的命中文件。
  // ★ 这是"报告出来的子集"，不是"扫过的全集"（未命中的候选不在产物里）；不假装完整。
  const read = new Set<string>();
  if (r.definition?.file) read.add(r.definition.file);
  for (const f of r.importers ?? []) read.add(f.file);
  for (const f of r.fieldRefs ?? []) read.add(f.file);
  for (const c of r.typeCandidates ?? []) read.add(c.file);
  if (read.size > 0) touched.read_files = [...read];

  return touched;
}

export async function findReferences(input: Parameters<typeof findReferencesCore>[0]): Promise<TouchedProduct<FindReferencesResult>> {
  const r = await findReferencesCore(input);
  return withTouched(r, touchedOf(input, r));
}