/**
 * rename_symbol · Go 语言包
 *
 * Go 包级符号改名支持（方向二 · 先做 Go，最小可用）
 * Go 语义（与 TS 差异大，独立分支，不混入 analyzeModuleSource）：
 *   - 包级符号（function / type / const / var）在**同包内直接可见**，无 import 远程名概念
 *   - 改名需覆盖：定义处 + 同包所有裸标识符引用（不含局部遮蔽——Go 无模块局部遮蔽陷阱概化，
 *     body 内同名局部变量不处理，宁漏不误）
 *   - 跨目录同包罕见，本版只覆盖**同目录 .go 文件**（Go 惯例 package=目录）
 * 本解析只取「定义偏移 + 裸引用标识符偏移」，不建 import 图（跨包 pkg.Sym 引用需 Go 包路径
 * import 图，工作量大，留后；本版先交付同包改名这一 90% 场景）。
 */
import { readFileSync, writeFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { getParser } from '../../../../infrastructure/parse/loader.js';
import { findLanguageByExt } from '../../../../infrastructure/parse/languages.js';
import { parseContent } from '../../../../infrastructure/parse/kernel.js';
import { createProtectGuard } from '../../snapshot/protect.js';
import {
  applyEdits,
  toOps,
  stripQuotes,
  type N,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from '../parts.js';

export interface GoModuleAnalysis {
  /** 包级定义名 → 声明 identifier/type_identifier 字节偏移 */
  rootOffsets: Map<string, number>;
  /** 包级定义名 → kind */
  rootKinds: Map<string, string>;
  /** 引用到该包级符号的裸标识符偏移（不含定义处本身） */
  refs: Map<string, number[]>;
  /** 定义的符号集合（去重，供改名时确定当前文件是否定义） */
  defined: Set<string>;
  /** import：本地名（别名或路径末段）→ 包路径（引包方跨包引用判定用） */
  imports: Array<{ alias: string; path: string }>;
  /** 选择器引用：`pkg.Symbol` 的 operand → field 引用偏移列表（跨包 pkg.Sym 改名用） */
  selections: Map<string, Array<{ field: string; fieldOffset: number }>>;
}

const GO_DEF_NODE_TYPES = new Set(['function_declaration', 'type_spec', 'const_spec', 'var_spec']);

export async function analyzeGoSource(src: string): Promise<GoModuleAnalysis | null> {
  const parser = await getParser('.go', findLanguageByExt('.go')!);
  if (!parser) return null;
  // §21 规矩③：解析失败不兜底（同 analyzeModuleSource）
  const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;
  const rootOffsets = new Map<string, number>();
  const rootKinds = new Map<string, string>();
  const refs = new Map<string, number[]>();
  const defined = new Set<string>();
  const imports: Array<{ alias: string; path: string }> = [];
  const selections = new Map<string, Array<{ field: string; fieldOffset: number }>>();

  const add = (map: Map<string, number[]>, name: string, offset: number): void => {
    let a = map.get(name);
    if (!a) {
      a = [];
      map.set(name, a);
    }
    a.push(offset);
  };

  // 收集 import（import_declaration → import_spec）：本地名 + 路径
  const collectImports = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    if (node.type === 'import_spec') {
      const pathNode = node.childForFieldName('path');
      const pth = pathNode ? stripQuotes(pathNode.text) : '';
      if (!pth) return;
      // 别名：import_spec 的 name 字段（`alias "path"`）；无别名 → 默认 = 路径末段 package 名
      const aliasNode = node.childForFieldName('name');
      const alias = aliasNode ? aliasNode.text : pth.split('/').filter(Boolean).pop() ?? pth;
      imports.push({ alias, path: pth });
      return; // import_spec 内无嵌套 import
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectImports(c, depth + 1);
    }
  };

  // 收集跨包选择器引用：`pkg.Symbol`（operand 是包 import 本地名 → 记录 field）
  const collectSelections = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    const t = node.type;
    if (t === 'selector_expression') {
      const operand = node.childForFieldName('operand');
      const field = node.childForFieldName('field');
      if (operand && field && (operand.type === 'identifier' || operand.type === 'type_identifier')) {
        let a = selections.get(operand.text);
        if (!a) {
          a = [];
          selections.set(operand.text, a);
        }
        a.push({ field: field.text, fieldOffset: field.startIndex });
      }
      // 不再深入——selector 内部无嵌套 selector（field 是叶子）
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectSelections(c, depth + 1);
    }
  };

  // 第一阶段：收集包级定义（可能出现在引用之后，需先扫完整棵）
  const collectDefs = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    // 方法（method_declaration 的接收者）整体跳过——字段/方法改名是另一语义
    if (node.type === 'method_declaration') return;
    if (GO_DEF_NODE_TYPES.has(node.type)) {
      const dir = node.childForFieldName('name');
      if (dir && (dir.type === 'identifier' || dir.type === 'type_identifier')) {
        const name = dir.text;
        if (!rootOffsets.has(name)) {
          rootOffsets.set(name, dir.startIndex);
          rootKinds.set(name, node.type === 'function_declaration' ? 'function' : node.type === 'type_spec' ? 'type' : 'const');
          defined.add(name);
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectDefs(c, depth + 1);
    }
  };

  // 第二阶段：收集裸标识符引用（仅对已定义过的符号；跳过定义处 name 节点）
  const collectRefs = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    const t = node.type;
    // 定义节点：跳过其 name 字段节点（定义处不是引用），其余子树继续
    if (GO_DEF_NODE_TYPES.has(t)) {
      const nameNode = node.childForFieldName('name');
      const nameStart = nameNode ? nameNode.startIndex : -1;
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.startIndex !== nameStart) collectRefs(c, depth + 1);
      }
      return;
    }
    if (t === 'identifier' || t === 'type_identifier') {
      const name = node.text;
      add(refs, name, node.startIndex);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectRefs(c, depth + 1);
    }
  };

  collectDefs(root, 0);
  collectRefs(root, 0);
  collectImports(root, 0);
  collectSelections(root, 0);
  return { rootOffsets, rootKinds, refs, defined, imports, selections };
}

// ─────────────────────────────────────────────
// Go 跨文件改名执行器回调
// ─────────────────────────────────────────────
export async function renameGoSymbol(args: {
  file: string; // 定义文件绝对路径
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
}): Promise<RenameSymbolResult> {
  const { file, symbol, to, dryRun, resolvedRoot } = args;
  const blocked = args.blocked.slice();
  const skipped: Array<{ path: string; why: string }> = [];

  // 基础校验（与 TS 分支一致）
  if (!/^[A-Za-z_][\w$]*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const defSrc = readFileSync(file, 'utf-8');
  const def = await analyzeGoSource(defSrc);
  const defKind = def?.rootKinds.get(symbol);
  if (!def || !defKind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该 Go 文件的包级定义`] };
  if (def.rootOffsets.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名包级符号 "${to}"`] };

  // 定义包名 = 定义文件所在目录名（Go 惯例 package=目录）
  const defDirName = path.posix.basename(path.posix.dirname(file.replace(/\\/g, '/')));

  // 全部候选 .go 文件：定义目录（同包）+ 项目根下任一目录（可能的引包方）
  const candidateGoFiles = new Set<string>();
  const dir = path.dirname(file);
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.go'))) candidateGoFiles.add(path.join(dir, f));
  } catch (err) {
    // §2d：同包目录读不了 ⇒ 记 skipped（原来只留一句注释，"同包文件一个都没扫"调用方不可见）
    skipped.push({ path: dir, why: String(err) });
  }
  // 项目根下递归收集所有 .go（引包方可在任意目录）
  const walkDir = (d: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      // §2d：根/子目录扫不了 ⇒ 记 skipped（原来只留一句注释）
      skipped.push({ path: d, why: String(err) });
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walkDir(full);
      else if (e.isFile() && e.name.endsWith('.go')) candidateGoFiles.add(full);
    }
  };
  walkDir(resolvedRoot);

  // 汇总各文件的编辑（偏移逆序应用）
  const editsByFile = new Map<string, { src: string; edits: Array<{ pos: number; len: number; text: string }> }>();

  // 定义文件：定义处 + 同文件引用
  const defEdits: Array<{ pos: number; len: number; text: string }> = [{ pos: def.rootOffsets.get(symbol)!, len: symbol.length, text: to }];
  for (const off of def.refs.get(symbol) ?? []) defEdits.push({ pos: off, len: symbol.length, text: to });
  editsByFile.set(file, { src: defSrc, edits: defEdits });

  // 遍历候选：同包文件改裸引用；引包方改跨包 `pkg.Old` 引用
  for (const abs of candidateGoFiles) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch (err) {
      // §2d：读不了的候选文件不再静默 continue
      skipped.push({ path: abs, why: String(err) });
      continue;
    }
    const m = await analyzeGoSource(src);
    if (!m) continue;

    const isSameDir = path.dirname(abs) === dir;
    // 撞名：同包其它文件已定义 to（无论是否引用旧名，都构成同包符号冲突）
    if (isSameDir && m.defined.has(to)) {
      blocked.push(`${path.basename(abs)} 已定义同名 "${to}"`);
      continue;
    }

    const fileEdits: Array<{ pos: number; len: number; text: string }> = [];

    if (isSameDir) {
      // 同包：裸引用直接改
      for (const off of m.refs.get(symbol) ?? []) fileEdits.push({ pos: off, len: symbol.length, text: to });
    } else {
      // 引包方：判断其 import 是否连到定义包，改 `pkg.Old` 选择器的 field
      const importsDefPkg = m.imports.some(
        (imp) => path.posix.basename(imp.path.replace(/\\/g, '/')) === defDirName || imp.path === defDirName,
      );
      if (importsDefPkg) {
        for (const [operand, selRefs] of m.selections) {
          // operand 必须是对应 import 的本地名
          const operandIsImport = m.imports.some((imp) => imp.alias === operand && path.posix.basename(imp.path.replace(/\\/g, '/')) === defDirName);
          if (!operandIsImport) continue;
          for (const s of selRefs) {
            if (s.field === symbol) fileEdits.push({ pos: s.fieldOffset, len: symbol.length, text: to });
          }
        }
      }
      // 引包方不会撞定义包符号（跨包），无需撞名检查
    }

    if (fileEdits.length > 0) editsByFile.set(abs, { src, edits: fileEdits });
  }

  // 冻结行保护（原子）：importer 的引用改写若会落在保护文件的标记行 → 阻断；定义文件不套。
  const guard = createProtectGuard(resolvedRoot);
  for (const [abs, entry] of editsByFile) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    const g = guard.scan(abs, entry.src, entry.edits);
    if (g.blocked) blocked.push(`${path.relative(resolvedRoot, abs).replace(/\\/g, '/')} 的引用命中保护标记行，需解除保护或人工处理后再改名：${g.protectedLines.join(' | ')}`);
  }

  // 原子性：任一撞名/保护 → 全部不落盘
  if (blocked.length > 0) return { ok: false, symbol, to, filesWritten: 0, blocked };

  // 落盘
  let filesWritten = 0;
  const ordered: RenameSymbolFileInfo[] = [];
  for (const [abs, { src, edits }] of editsByFile) {
    const out = applyEdits(src, edits);
    if (out !== src && !dryRun) {
      writeFileSync(abs, out, 'utf-8');
      filesWritten++;
    }
    const isDef = path.resolve(abs) === path.resolve(file);
    const note = isDef ? '定义+同文件引用（Go）' : path.dirname(abs) === dir ? '同包引用（Go）' : '跨包引用（Go）';
    ordered.push({
      file: (path.relative(resolvedRoot, abs) || abs).replace(/\\/g, '/'),
      edits: edits.length,
      note,
      ops: toOps(src, edits),
    });
  }

  const definition = ordered.find((o) => path.resolve(path.join(resolvedRoot, o.file)) === path.resolve(file)) ?? ordered[0];
  return {
    ok: true,
    symbol,
    to,
    dryRun: dryRun || undefined,
    definition,
    importers: ordered.filter((o) => o !== definition),
    filesWritten,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}
