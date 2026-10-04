/**
 * rename_symbol · Python 语言包
 *
 * Python 模块级符号改名支持（方向二 · Python）
 * Python 语义（与 Go 同为"模块=命名空间"，但跨模块 import 形态更丰富）：
 *   - 模块级 function/class/const 在同模块直接可见（无 import 远程名概念）
 *   - 跨模块引用：`from X import sym`（import 绑定 sym，使用点裸 sym）或 `import X` + `X.sym`
 *   本分析复用它 Go 的同一输出结构（GoModuleAnalysis）：
 *     rootOffsets/refs/defined → 定义与同模块裸引用
 *     imports → from-import/import 绑定（本地名→路径）
 *     selections → `X.sym` attribute 引用（跨模块改名用）
 */
import { readFileSync, writeFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { getParser } from '../../../../infrastructure/parse/loader.js';
import { findLanguageByExt } from '../../../../infrastructure/parse/languages.js';
import { parseContent } from '../../../../infrastructure/parse/kernel.js';
import { createProtectGuard } from '../../../../infrastructure/analysis/refactor/protect.js';
import {
  applyEdits,
  toOps,
  type N,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from '../parts.js';
import type { GoModuleAnalysis } from '../parts.js';

export async function analyzePythonSource(src: string): Promise<GoModuleAnalysis | null> {
  const parser = await getParser('.py', findLanguageByExt('.py')!);
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

  // import / from-import 绑定（本地名 → 路径）
  const collectImports = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    const t = node.type;
    if (t === 'import_from_statement') {
      // 从文本解析 from X import Y, Z as W
      const m = node.text.match(/^\s*from\s+(\.+)?([\w.]+)\s+import\s+(.+)$/);
      if (m) {
        const dots = m[1] || '';
        const pth = dots + m[2];
        const names = m[3].split(',').map((s) => s.trim());
        for (const raw of names) {
          const asm = raw.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)/);
          if (asm) imports.push({ alias: asm[2], path: pth });
          else imports.push({ alias: raw.replace(/[()]/g, ''), path: pth });
        }
      }
      return;
    }
    if (t === 'import_statement') {
      // import X / import a.b.c / import X, Y / import X as Y / import a.b as c
      const tail = node.text.replace(/^\s*import\s+/, '');
      const parts = tail.split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        const asm = p.match(/^([\w.]+)\s+as\s+([A-Za-z_]\w*)/);
        if (asm) imports.push({ alias: asm[2], path: asm[1] });
        else imports.push({ alias: p.split('.').filter(Boolean).pop() ?? p, path: p });
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectImports(c, depth + 1);
    }
  };

  // 收集模块级定义（function/class 的 name；只记 module 直接子节点 = 顶层）
  const collectDefs = (node: N, depth = 0, isTopContainer = true): void => {
    if (depth > 1000) return;
    // 顶层容器（module）的直接 function/class_definition 子节点 → 模块级定义
    if ((node.type === 'function_definition' || node.type === 'class_definition') && isTopContainer) {
      const nameNode = node.childForFieldName('name');
      if (nameNode && nameNode.type === 'identifier' && !rootOffsets.has(nameNode.text)) {
        rootOffsets.set(nameNode.text, nameNode.startIndex);
        rootKinds.set(nameNode.text, node.type === 'function_definition' ? 'function' : 'class');
        defined.add(nameNode.text);
      }
      // 顶层定义内部（函数体/类体）不递归（不是模块级定义）
      return;
    }
    if (node.type === 'expression_statement' || node.type === 'import_statement' || node.type === 'import_from_statement') return;
    // module 节点的直接子节点仍是顶层；其它容器（block/class_body 等）内不是
    const childrenTop = node.type === 'module';
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectDefs(c, depth + 1, childrenTop);
    }
  };

  // 收集裸引用（同模块直接可见）+ `X.sym` attribute 选择器引用
  const collectRefsAndSelections = (node: N, depth = 0): void => {
    if (depth > 1000) return;
    const t = node.type;
    // 定义节点 name 处不算引用
    if (t === 'function_definition' || t === 'class_definition') {
      const nameStart = node.childForFieldName('name')?.startIndex ?? -1;
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.startIndex !== nameStart) collectRefsAndSelections(c, depth + 1);
      }
      return;
    }
    if (t === 'attribute') {
      // `X.sym` 选择器：子节点为 [identifier(obj), ., identifier(field)]。
      // operand = 第 0 个 identifier，field = 最后一个 identifier（跳过中间的 . 与可能的更多链式）
      const ids: N[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && (c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'attribute')) ids.push(c);
      }
      // 仅取简单 `pkg.sym`（operand 是裸 identifier，field 是裸 identifier）；链式/`X().sym` 不算
      if (ids.length >= 2 && ids[0].type === 'identifier' && ids[ids.length - 1].type === 'identifier') {
        const operand = ids[0];
        const field = ids[ids.length - 1];
        let a = selections.get(operand.text);
        if (!a) {
          a = [];
          selections.set(operand.text, a);
        }
        a.push({ field: field.text, fieldOffset: field.startIndex });
      }
    }
    if (t === 'identifier') {
      const name = node.text;
      add(refs, name, node.startIndex);
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) collectRefsAndSelections(c, depth + 1);
    }
  };

  collectDefs(root, 0);
  collectRefsAndSelections(root, 0);
  collectImports(root, 0);
  return { rootOffsets, rootKinds, refs, defined, imports, selections };
}

// ─────────────────────────────────────────────
// Python 跨文件改名执行器（复用 Go 的扫描骨架）
// ─────────────────────────────────────────────
export async function renamePythonSymbol(args: {
  file: string;
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
}): Promise<RenameSymbolResult> {
  const { file, symbol, to, dryRun, resolvedRoot } = args;
  const skipped: Array<{ path: string; why: string }> = [];

  // 基础校验（与 TS 分支一致）
  if (!/^[A-Za-z_]\w*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const defSrc = readFileSync(file, 'utf-8');
  const def = await analyzePythonSource(defSrc);
  const defKind = def?.rootKinds.get(symbol);
  if (!def || !defKind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该 Python 文件的模块级定义`] };
  if (def.rootOffsets.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名模块级符号 "${to}"`] };

  // 定义文件：定义处 + 同文件裸引用
  const defEdits: Array<{ pos: number; len: number; text: string }> = [{ pos: def.rootOffsets.get(symbol)!, len: symbol.length, text: to }];
  for (const off of def.refs.get(symbol) ?? []) defEdits.push({ pos: off, len: symbol.length, text: to });

  const editsByFile = new Map<string, { src: string; edits: Array<{ pos: number; len: number; text: string }> }>();
  editsByFile.set(file, { src: defSrc, edits: defEdits });

  // 项目根下递归收集所有 .py（跨模块 `X.sym` 引用）
  const pyFiles = new Set<string>();
  const walkDir = (d: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      // §2d：根/子目录扫不了不再只留一句注释（原来直接退化成"只用定义文件"而调用方无感）
      skipped.push({ path: d, why: String(err) });
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__') walkDir(full);
      else if (e.isFile() && e.name.endsWith('.py')) pyFiles.add(full);
    }
  };
  walkDir(resolvedRoot);

  for (const abs of pyFiles) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch (err) {
      skipped.push({ path: abs, why: String(err) });
      continue;
    }
    const m = await analyzePythonSource(src);
    if (!m) continue;

    const fileEdits: Array<{ pos: number; len: number; text: string }> = [];
    // 跨模块 `X.oldName`：operand 是某 import 的本地名（相对或绝对路径末段 == 定义模块名 或 path 一致）
    for (const [operand, selRefs] of m.selections) {
      const operandIsImport = m.imports.some((imp) => {
        if (imp.alias !== operand) return false;
        const p = imp.path.replace(/^\.+/, '');
        const last = p.split('.').filter(Boolean).pop() ?? p;
        return last === path.basename(file, '.py');
      });
      if (!operandIsImport) continue;
      for (const s of selRefs) if (s.field === symbol) fileEdits.push({ pos: s.fieldOffset, len: symbol.length, text: to });
    }
    if (fileEdits.length > 0) editsByFile.set(abs, { src, edits: fileEdits });
  }

  // 冻结行保护（原子）：importer 的引用改写若会落在保护文件的标记行 → 阻断；定义文件不套。
  const guard = createProtectGuard(resolvedRoot);
  const protectedBlocks: string[] = [];
  for (const [abs, entry] of editsByFile) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    const g = guard.scan(abs, entry.src, entry.edits);
    if (g.blocked) protectedBlocks.push(`${path.relative(resolvedRoot, abs).replace(/\\/g, '/')} 的引用命中保护标记行，需解除保护或人工处理后再改名：${g.protectedLines.join(' | ')}`);
  }
  if (protectedBlocks.length > 0) return { ok: false, symbol, to, filesWritten: 0, blocked: protectedBlocks };

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
    const note = isDef ? '定义+同模块引用（Python）' : '跨模块引用（Python）';
    ordered.push({
      file: (path.relative(resolvedRoot, abs) || abs).replace(/\\/g, '/'),
      edits: edits.length,
      note,
      ops: toOps(src, edits),
    });
  }

  const definition = ordered[0];
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
