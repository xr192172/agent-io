/**
 * symbol_move —— 跨文件模块级符号移动（语义重构第一棒）
 *
 * 从「单文件符号编辑」（edit_code / symbol_edit）升级到「依赖图感知的结构变换」：
 * 把一个模块级符号从文件 A 挪到文件 B，并自动把闭包内所有 import 它（仅引入它）的文件
 * 的 import【目标】从 A 改到 B。区别于 rename_symbol（改远程名）：move 不改符号名，
 * 只改 import 的 source 字符串，故本地名 / 使用点 / 别名一律不动。
 *
 * 模型：**多文件原子写**（源删 + 目标加 + 每个 importer 改 source），任一阻断 → 整体不落盘。
 * 与 edit_code 的单文件事务模型不同，故独立成文件，与 rename_symbol.ts（重构族）同族。
 *
 * 2026-09：复用 rename_symbol 的模块作用域分析 + project_root 的闭包边界（只扩工作区、
 * 外部 import 记为 externalRef 不追外）。
 *
 * ★ §21 形状裁定（2026-09-28）：本文件**收显式参数**（`MoveSymbolInput`，无 args 袋子、
 *   无 `Record<string, unknown>`）、产物是**结构化数据**（`MoveSymbolResult`，无 message 键）。
 *   文件内 5 处 `as unknown as { … }` **不是** "入参袋子漏进纯函数" 的证据：它们逐处都是把
 *   **解析内核返回的 AST 节点**收窄到本文件自己声明的最小节点面（`declName` 的入参 156/157、
 *   `findTopLevelDeclRange` 的 196/201、importer 重写的 367），落点没有一处是 args。
 *   ⇒ 按 §21 保留，不为"消强转"硬改（真要消，得内核先把公开类型面收好，另一件事）。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeModuleSource,
  resolveRel,
  buildNoExt,
} from '../rename_symbol/index.js';
import {
  resolveProjectRoot,
  expandClosureDetailed,
  loadAliasConfig,
  resolveAliasedImport,
  type AliasConfig,
  type ExternalRef,
} from '../../cross/project_root.js';
import { parseAstRoot, TS_JS_EXTS } from '../../../infrastructure/parse/index.js';
import { syncFile } from '../../../infrastructure/index/symbols.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { splitKeepEnds, detectEol, isBlankLine } from '../../../infrastructure/text/line_utils.js';
import { snapshotBeforeWrite } from '../rf-snapshot/file_snapshot.js';
import { reopenAndResolveAfterWrite } from '../../observe/runtime/write_gate.js';
import type { ScanBounds } from '../rf-edit/scan_bounds.js';

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export interface MoveSymbolInput {
  /** 目标项目根目录；缺省自动定位（git 根→manifest→文件目录） */
  project_dir?: string;
  /** 定义符号的文件（相对 project_dir 或绝对路径） */
  file: string;
  /** 要移动的模块级符号名 */
  symbol: string;
  /** 目标文件（相对 project_dir 或绝对路径；不存在则创建） */
  to_file: string;
  /** 可选：移动后改名。v1 只移动不改名——传入则置 toSymbolDeferred 提示走 rename_symbols */
  to_symbol?: string;
  /** true=只出结构化预览不落盘 */
  dry_run?: boolean;
}

export interface MoveRedirect {
  /** importer 文件相对路径 */
  file: string;
  /** 旧 import source（如 './a'） */
  oldSource: string;
  /** 新 import source（如 '../shared/c'） */
  newSource: string;
  /** 被定位/重定向的符号 */
  symbol: string;
}

export interface MoveSymbolResult {
  ok: boolean;
  symbol: string;
  to_file: string;
  filesWritten: number;
  dryRun?: boolean;
  /** 源文件删除信息 */
  source?: { file: string; removed: string[]; startLine: number; endLine: number };
  /** 目标文件插入信息 */
  target?: { file: string; created: boolean; symbol: string };
  /** 每个被重定向 importer 的旧→新 import source */
  redirects?: MoveRedirect[];
  /** 实际将落盘/已落盘文件（source + target + 每个 importer） */
  affectedFiles?: string[];
  blocked?: string[];
  externalRefs?: ExternalRef[];
  /**
   * ★ 扫描边界（统一形状，2026-09-29）：闭包扫描**跳过**的文件（读不了 / 解析不了）逐条带 why
   *   —— 收进 `bounds.skipped`（原字段名 `skipped`，本笔收成统一形状，内容一字未改）。
   *   跳过 = "可能漏掉一个引用本符号的 importer" ⇒ 移动后它的 import 可能仍指向旧文件。
   *   原来 `expandClosureDetailed` 已经报出这个数组，本文件却**直接丢弃** ⇒ 静默少改。
   * 形状与挂载层见 `src/application/refactor/rf-edit/scan_bounds.ts`。
   */
  bounds?: ScanBounds;
  /** 传了 to_symbol 但 v1 未启用改名 */
  toSymbolDeferred?: boolean;
}

// ─────────────────────────────────────────────
// 本地小工具（在 rename_symbol / edit_code 中为私有，此处按需复制/对齐）
// ─────────────────────────────────────────────

/** TS/JS 家族扩展名 —— 来自内核唯一权威（`ts_kernel/source_exts.ts`） */
const TS_EXTS = new Set<string>(TS_JS_EXTS);

interface Edit {
  pos: number;
  len: number;
  text: string;
}

function stripQuotes(s: string): string {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) return s.slice(1, -1);
  return s;
}

/** 逆序应用编辑（偏移互不影响） */
function applyEdits(src: string, edits: Edit[]): string {
  if (edits.length === 0) return src;
  const sorted = [...edits].sort((a, b) => b.pos - a.pos);
  let out = src;
  for (const e of sorted) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.len);
  return out;
}

/** 压缩连续 ≥2 空行为 1 空行（源删除后清理） */
function squeezeBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (isBlankLine(l) && out.length > 0 && isBlankLine(out[out.length - 1])) continue;
    out.push(l);
  }
  return out;
}

/** 计算 fromAbs → toAbs 的相对 import 路径（去扩展名；'./x' 形） */
function relImportPath(fromAbs: string, toAbs: string): string {
  const fromDir = path.posix.dirname(fromAbs.replace(/\\/g, '/'));
  let rel = path.posix.relative(fromDir, toAbs.replace(/\\/g, '/'));
  rel = rel.replace(/\.[^.]+$/, '');
  return rel.startsWith('.') ? rel : './' + rel;
}

const IDENT_LIKE = new Set(['identifier', 'type_identifier', 'property_identifier', 'shorthand_property_identifier']);

function isDeclNodeType(t: string): boolean {
  return (
    t === 'function_declaration' ||
    t === 'generator_function_declaration' ||
    t === 'class_declaration' ||
    t === 'abstract_class_declaration' ||
    t === 'interface_declaration' ||
    t === 'type_alias_declaration' ||
    t === 'enum_declaration' ||
    t === 'lexical_declaration' ||
    t === 'variable_declaration'
  );
}

/** 取声明节点的名字（lexical/variable_declaration 取单 declarator 的 name） */
function declName(node: { type: string; childForFieldName(f: string): unknown }): string | null {
  const n = node.childForFieldName('name');
  if (n && IDENT_LIKE.has((n as { type: string }).type)) return (n as { text: string }).text;
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    for (let i = 0; i < (node as unknown as { childCount: number }).childCount; i++) {
      const c = ((node as unknown as { child(i: number): unknown }).child(i)) as { type: string; childForFieldName(f: string): unknown } | null;
      if (c && c.type === 'variable_declarator') {
        const nm = c.childForFieldName('name');
        if (nm && IDENT_LIKE.has((nm as { type: string }).type)) return (nm as { text: string }).text;
      }
    }
  }
  return null;
}

/** 在 export_statement 内递归找匹配 symbol 的声明节点 */
function findNamedDeclInExport(stmt: { type: string; childCount: number; child(i: number): unknown }, symbol: string): unknown | null {
  const stack: Array<unknown> = [stmt];
  while (stack.length) {
    const n = stack.pop() as { type: string; childForFieldName(f: string): unknown; childCount: number; child(i: number): unknown };
    if (n !== stmt && isDeclNodeType(n.type)) {
      if (declName(n) === symbol) return n;
      continue; // 发深处的非匹配声明不再下钻
    }
    if (n.type === 'export_specifier' || n.type === 'export_clause') continue;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
  return null;
}

/**
 * 取 module 顶层定义块的完整字节区间（含 export 前缀与体；不含上方 /** 注释）。
 * 遍历 program 直接子节点（顶层 statement）；命中即返回 startIndex..endIndex。
 */
async function findTopLevelDeclRange(
  src: string,
  filePath: string,
  symbol: string,
): Promise<{ startIndex: number; endIndex: number } | null> {
  const ast = await parseAstRoot(filePath, src);
  if (!ast?.root) return null;
  const root = ast.root as unknown as {
    childCount: number;
    child(i: number): unknown;
  };
  for (let i = 0; i < root.childCount; i++) {
    const n = root.child(i) as unknown as {
      type: string;
      startIndex: number;
      endIndex: number;
      childCount: number;
      child(i: number): unknown;
      childForFieldName(f: string): unknown;
    };
    if (!n) continue;
    if (n.type === 'export_statement') {
      if (findNamedDeclInExport(n, symbol)) return { startIndex: n.startIndex, endIndex: n.endIndex };
      continue;
    }
    if (isDeclNodeType(n.type) && declName(n) === symbol) {
      return { startIndex: n.startIndex, endIndex: n.endIndex };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────

export async function moveSymbol(input: MoveSymbolInput): Promise<MoveSymbolResult> {
  const blocked: string[] = [];
  const dryRun = input.dry_run === true;

  // 0. 路径/根/alias 解析
  const effectiveRoot = input.project_dir ? path.resolve(String(input.project_dir)) : undefined;
  const sourceAbs = path.isAbsolute(input.file)
    ? path.resolve(input.file)
    : effectiveRoot
      ? path.resolve(effectiveRoot, input.file)
      : path.resolve(process.cwd(), input.file);
  const resolvedRoot = effectiveRoot ?? resolveProjectRoot(sourceAbs);
  // ★ 耦合裁定（2026-09-28，§27.14）：loadAliasConfig 现在在主配置**真的坏了**时**抛**
  //   （合法 JSONC 已能正常解析）。本文件两处调用（此处 + 下面 aliasFor 的逐目录）**都发生在
  //   只读的规划阶段** —— 落盘在第 7 步之后 ⇒ 异常跑出 moveSymbol 时**一个字节都还没写**，
  //   天然就是 §21 规矩③要的原子硬失败。
  //   ⇒ 上游**不需要** catch：加 catch 等于把"配置坏了"重新降级成"没有别名"（§2d 要根除的病，
  //     那会让 @/ 类 import 被静默漏改）。
  const aliasCfg = loadAliasConfig(resolvedRoot);
  const toAbs = path.isAbsolute(input.to_file)
    ? path.resolve(input.to_file)
    : effectiveRoot
      ? path.resolve(effectiveRoot, input.to_file)
      : path.resolve(process.cwd(), input.to_file);

  // 1. 基础校验
  const defExt = path.extname(sourceAbs);
  if (!TS_EXTS.has(defExt)) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`move 暂只支持 TS/JS 模块级符号（${defExt}）`] };
  if (!fs.existsSync(sourceAbs)) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`源文件不存在: ${sourceAbs}`] };
  if (path.resolve(toAbs) === path.resolve(sourceAbs)) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: ['目标文件与源文件相同，无需移动'] };

  const src = fs.readFileSync(sourceAbs, 'utf-8');
  const def = await analyzeModuleSource(src, sourceAbs);
  if (!def) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: ['源文件解析失败'] };
  const kind = def.rootKinds.get(input.symbol);
  if (!kind) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`"${input.symbol}" 不是 ${path.basename(sourceAbs)} 的模块级声明`] };
  if (kind === 'import' || kind === 'reexport' || kind === 'exported') {
    return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`"${input.symbol}" 在 ${path.basename(sourceAbs)} 中是 import/再导出绑定而非声明，请在其定义文件上发起 move`] };
  }

  const toSymbolDeferred = input.to_symbol !== undefined && input.to_symbol !== input.symbol;

  // 2. 定义块区间 → 删除文本
  const range = await findTopLevelDeclRange(src, sourceAbs, input.symbol);
  if (!range) return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`未定位到 "${input.symbol}" 的模块级定义块`] };
  const eol = detectEol(src);
  const definition = src.slice(range.startIndex, range.endIndex);
  const startLine = src.slice(0, range.startIndex).split('\n').length;
  const endLine = src.slice(0, range.endIndex).split('\n').length;
  const removedLines = src.slice(range.startIndex, range.endIndex).split(/\r?\n/);
  const newSourceText = squeezeBlankRuns(splitKeepEnds(src.slice(0, range.startIndex) + src.slice(range.endIndex))).join('');
  const finalSource = newSourceText && !newSourceText.endsWith(eol) ? newSourceText + eol : newSourceText;

  // 3. 目标文件防护 + 准备目标文本
  const targetExists = fs.existsSync(toAbs);
  let targetText: string;
  let created = false;
  if (targetExists) {
    const toSrc = fs.readFileSync(toAbs, 'utf-8');
    const tmod = await analyzeModuleSource(toSrc, toAbs);
    if (tmod?.rootKinds.has(input.symbol)) {
      return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked: [`目标文件已存在同名模块级符号 "${input.symbol}"`] };
    }
    // 追加到顶层末：前面补空行分隔
    const sep = !toSrc.endsWith('\n') ? '\n' : '';
    const lastLine = (toSrc.split('\n').pop() ?? '');
    const blank = lastLine.trim() !== '' ? '\n' : '';
    targetText = toSrc + sep + blank + definition;
  } else {
    created = true;
    targetText = definition.endsWith('\n') ? definition : definition + '\n';
  }

  // 4. 闭包（只扩工作区，外部仅反馈）
  const closure = await expandClosureDetailed(sourceAbs, resolvedRoot, aliasCfg);
  const files = closure.files;
  const externalRefs = closure.externalRefs;
  // ★ §2d（2026-09-28 修剪）：闭包扫描**跳过的文件**（读不了 / 解析不了）此前在本行被**直接丢弃**。
  //   跳过 = "可能漏掉一个引用本符号的 importer" ⇒ 丢掉它就是"少做一点事而不说话"（与 rename_symbol
  //   同族，那边的对应修复是 A14 透传 closure.skipped）。这里逐条带 why 透传进结果。
  const closureSkipped = closure.skipped;
  // ★ 统一「扫描边界」：闭包口径 + 实扫文件数 + 跳过的文件（`closureSkipped` 为空时只报口径与规模）
  const bounds: ScanBounds = {
    scope: '工作区内 import 反向闭包（expandClosureDetailed 展开的引用方；工作区外只记 externalRefs 不追外）',
    scanned: { files: closure.files.length },
    ...(closureSkipped.length > 0 ? { skipped: closureSkipped } : {}),
  };
  const byNoExt = buildNoExt(files);

  const aliasMemo = new Map<string, AliasConfig | null>();
  const aliasFor = (fAbs: string): AliasConfig | null => {
    const d = path.dirname(fAbs);
    // ★ 同样不 catch（见上面 aliasCfg 那处的裁定）：某个 importer 目录的 tsconfig 真坏了 ⇒ 抛。
    if (!aliasMemo.has(d)) aliasMemo.set(d, loadAliasConfig(d));
    return aliasMemo.get(d) ?? null;
  };
  const resolveEdge = (fAbs: string, source: string): string | null => {
    if (source.startsWith('.')) return resolveRel(source, fAbs, byNoExt);
    const a = aliasFor(fAbs);
    return a ? resolveAliasedImport(source, a) : null;
  };

  // 5. 收集 importer 重定向（只改 source 字符串）
  const redirects: MoveRedirect[] = [];
  const importerEdits: Map<string, { edits: Edit[]; src: string }> = new Map();
  for (const fAbs of files) {
    if (path.resolve(fAbs) === sourceAbs) continue;
    const ext = path.extname(fAbs);
    if (!TS_EXTS.has(ext)) continue;
    // ★ §2d / §21 规矩③（2026-09-28 修剪）：这里原是一处 `try { read; analyze } catch { continue }`，
    //   把两种失败**一起吸收成静默 `continue`**：① `readFileSync` 的 I/O 失败；② `analyzeModuleSource`
    //   的解析失败（该函数本轮已改成"解析失败即抛"，这个 catch 正好会**把新抛吞掉**）。
    //   被跳过的是一个**可能 import 了本符号**的文件 ⇒ 移动后它的 import 仍指向旧文件（静默改坏仓库）
    //   —— 正是 §2d 点名的"少做一点事而不说话"。
    //   ⇒ 删掉 catch：两类失败都向上抛（[C] 的 `wrap` 会把它标成 isError，硬失败可见）。
    const fsrc = fs.readFileSync(fAbs, 'utf-8');
    const fmod = await analyzeModuleSource(fsrc, fAbs);
    if (!fmod) {
      // null 的契约已收敛为"该文件不适用模块级分析（扩展名 / 语言 / 解析器缺一）"。走到这里扩展名
      // 已确认是 TS 系（上面的 TS_EXTS 闸）⇒ null 只可能是"该扩展名没有可用解析器"= 数据源不可用。
      // 静默跳过会让"少分析了这个文件"不可见 ⇒ 硬失败（§21 规矩③）。
      throw new Error(`无法对本文件做模块级分析（该扩展名无可用解析器），移动无法保证引用完整: ${fAbs}`);
    }

    // 5a. 用 analyze 判定：指向源文件的 import 边，按其 source 字符串聚合，是否只引入 symbol
    //     （namespace / 星号 / 混入其它符号 → 阻断）
    const bySrc = new Map<string, Array<(typeof fmod.imports)[number]>>();
    for (const e of fmod.imports) {
      if (!e.source) continue;
      const resolved = resolveEdge(fAbs, e.source);
      if (!resolved || path.resolve(resolved) !== sourceAbs) continue;
      let arr = bySrc.get(e.source);
      if (!arr) {
        arr = [];
        bySrc.set(e.source, arr);
      }
      arr.push(e);
    }
    const sourcesToRedirect: string[] = [];
    for (const [s, edges] of bySrc) {
      // 星号转发（export * from '../source'）
      if (edges.some((e) => e.star)) {
        blocked.push(`${path.basename(fAbs)} 用 export * 从源文件转发，无法按名重定向 import 目标`);
        continue;
      }
      // namespace / default import（import * as ns / import ns from）：无具名远程名，
      // 会把源文件全部导出/默认值拉走，无法按名重定向 import 目标
      if (edges.some((e) => e.remoteName === null && !e.isReexport && !e.star)) {
        blocked.push(`${path.basename(fAbs)} 用 namespace/default import 引入源文件，符号移出后语义断裂；请改为具名 import 后重试`);
        continue;
      }
      // 该 source 引入的所有远程名必须恰好是符号名
      const names = new Set(edges.map((e) => e.remoteName ?? '').filter(Boolean));
      if (names.size !== 1 || !names.has(input.symbol)) {
        blocked.push(`${path.basename(fAbs)} 的一条 import 语句从源文件同时引入其它符号（${[...names].join(', ')}），无法整条重定向 import 目标；请手动拆分后重试`);
        continue;
      }
      sourcesToRedirect.push(s);
    }
    if (sourcesToRedirect.length === 0) continue;

    // 5b. 用 parseAstRoot 应用字节重定向（source 节点 → 新相对路径）
    const ast = await parseAstRoot(fAbs, fsrc);
    if (!ast?.root) {
      // ★ §2d：走到这里**已确认**该文件有一条要重定向的 import；拿不到 AST 就没法改写它
      //   ⇒ 原来静默 `continue` 会让这条 import 仍指向旧文件（**必然改坏**）。硬失败（§21 规矩③）。
      throw new Error(`无法解析该 importer 的 AST，无法重定向其 import: ${fAbs}`);
    }
    const root = ast.root as unknown as { childCount: number; child(i: number): unknown };
    const edits: Edit[] = [];
    const walkTop = (n: unknown): void => {
      const node = n as { type: string; childCount: number; child(i: number): unknown; childForFieldName(f: string): unknown };
      if (node.type === 'import_statement' || node.type === 'export_statement') {
        const sourceNode = node.childForFieldName('source') as { text: string; startIndex: number; endIndex: number } | null;
        if (sourceNode) {
          const s = stripQuotes(sourceNode.text);
          if (sourcesToRedirect.includes(s)) {
            const newSource = relImportPath(fAbs, toAbs);
            const q = sourceNode.text[0];
            const openLen = q === '"' || q === "'" || q === '`' ? 1 : 0;
            edits.push({ pos: sourceNode.startIndex + openLen, len: s.length, text: newSource });
            redirects.push({ file: (path.relative(resolvedRoot, fAbs) || fAbs).replace(/\\/g, '/'), oldSource: s, newSource, symbol: input.symbol });
          }
        }
        return; // 不深入 import/export 内部其它 source
      }
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c) walkTop(c);
      }
    };
    walkTop(root);
    if (edits.length > 0) importerEdits.set(fAbs, { edits, src: fsrc });
  }

  // 6. 原子门
  if (blocked.length > 0) {
    return { ok: false, symbol: input.symbol, to_file: input.to_file, filesWritten: 0, blocked };
  }

  const affectedFiles = [sourceAbs, toAbs, ...importerEdits.keys()];

  // ★ 可撤回：落盘前把受影响文件（源+目标+各 importer）各存一份。
  // affectedFiles 正是本次会改到的完整集合（dry_run 时也算了，但只在真落盘前快照）。
  if (!dryRun) {
    snapshotBeforeWrite(
      resolvedRoot,
      `move_symbol:${input.symbol}→${path.basename(toAbs)}`,
      affectedFiles.map((f) => (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/')),
    );
  }

  // 7. dry_run / 落盘
  if (dryRun) {
    return {
      ok: true,
      symbol: input.symbol,
      to_file: (path.relative(resolvedRoot, toAbs) || toAbs).replace(/\\/g, '/'),
      dryRun: true,
      filesWritten: 0,
      source: { file: (path.relative(resolvedRoot, sourceAbs) || sourceAbs).replace(/\\/g, '/'), removed: removedLines, startLine, endLine },
      target: { file: (path.relative(resolvedRoot, toAbs) || toAbs).replace(/\\/g, '/'), created, symbol: input.symbol },
      redirects,
      affectedFiles: affectedFiles.map((f) => (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/')),
      externalRefs,
      bounds,
      ...(toSymbolDeferred ? { toSymbolDeferred: true } : {}),
    };
  }

  // 落盘：源删除 → 目标插入 → importer source 重定向
  fs.writeFileSync(sourceAbs, finalSource, 'utf-8');
  if (created) fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.writeFileSync(toAbs, targetText, 'utf-8');
  for (const [fAbs, entry] of importerEdits) {
    const out = applyEdits(entry.src, entry.edits);
    if (out !== entry.src) fs.writeFileSync(fAbs, out, 'utf-8');
  }

  // 索引重建（新鲜度闭环）
  // ★ §2d（2026-09-28 修剪）：原来这里是 `try { syncFile } catch { /* 索引非致命 */ }` ——
  //   §21.1 的"**彻底静默**"形态（块内只有一句注释）。
  //   ★ 先问"它捕获的是哪一类失败"：`syncFile` 的正常失败模式是**返回** `status:'failed'`（不是抛），
  //     所以这个 catch 只承接**意料之外的异常**（DB 被关 / 锁死 / 句柄失效）—— 那类失败被吞掉后
  //     调用方与 agent **完全看不到**，与紧随其后的写闸收尾所声明的"失败不吞"自相矛盾。
  //   ⇒ 删掉 catch，让它向上抛（[C] 的 `wrap` 会标 isError）。
  //   ★ 残留（未改，见提交信息的"已知未做"）：`syncFile` 的 `status:'failed'` 返回值与下面
  //     `reopenAndResolveAfterWrite` 的 `error` 字段仍被忽略 —— 它们**不是 catch 形态**，
  //     且 [C] 用 `wrap` 丢弃 data ⇒ 要可见必须同时改 refactor.ts（本轮被锁）。
  const db = getProjectCacheDb(resolvedRoot);
  for (const f of [sourceAbs, toAbs, ...importerEdits.keys()]) {
    await syncFile(db, resolvedRoot, f);
  }
  // ★ 写闸收尾（2026-09-15）：移动会让源文件里该符号"消失"，引用方边被 FK 级联删掉且
  //   不会自己重建 ⇒ 必须重开再解析（否则 find_references / impact 静默漏报）。
  // ★ 诚实修正（2026-09-28）：上面原写"失败不吞"，但本文件**把返回值丢掉了** ——
  //   `reopenAndResolveAfterWrite` 按契约**不抛**（失败写在自己的 `error` 字段里，其文档明写
  //   "调用方必须把它带进结果"）。本文件没带 ⇒ 这条失败目前**不可见**。
  //   ★ 本轮未修：修它必须让 [C] 能渲染（`wrap` 丢 data ⇒ 要改 `application/refactor/index.ts`），
  //     而该文件本轮被另一执行者锁定（详见提交信息"已知未做"）。
  const _rw = await reopenAndResolveAfterWrite(resolvedRoot, [sourceAbs, toAbs, ...importerEdits.keys()]);

  return {
    ok: true,
    symbol: input.symbol,
    to_file: (path.relative(resolvedRoot, toAbs) || toAbs).replace(/\\/g, '/'),
    filesWritten: affectedFiles.length,
    source: { file: (path.relative(resolvedRoot, sourceAbs) || sourceAbs).replace(/\\/g, '/'), removed: removedLines, startLine, endLine },
    target: { file: (path.relative(resolvedRoot, toAbs) || toAbs).replace(/\\/g, '/'), created, symbol: input.symbol },
    redirects,
    affectedFiles: affectedFiles.map((f) => (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/')),
    externalRefs,
    bounds,
    ...(toSymbolDeferred ? { toSymbolDeferred: true } : {}),
  };
}