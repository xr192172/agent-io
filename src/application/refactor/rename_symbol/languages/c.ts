/**
 * rename_symbol · C/C++ 语言包
 *
 * C/C++ 符号改名（方向二 · C）
 * C 无命名空间，靠头文件 + 文本链接：函数/宏可被任何 `#include` 该头文件的文件引用。
 * 本分析复用 GoModuleAnalysis：
 *   rootOffsets/refs/defined → 函数/结构体/枚举定义 + 原型声明 + 同文件引用
 *   imports      → `#include`（alias=去扩展头文件名，供"包含该头"判定）
 * 执行器：def 文件 + 所有"已定义该符号"文件（原型/定义）+ 所有 `#include` def 头文件的文件 → 裸引用联动。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getParser } from '../../../../infrastructure/parse/loader.js';
import { findLanguageByExt } from '../../../../infrastructure/parse/languages.js';
import { parseContent } from '../../../../infrastructure/parse/kernel.js';
import { createProtectGuard } from '../../../../infrastructure/analysis/refactor/protect.js';
import {
  collectFilesByExt,
  applyEdits,
  toOps,
  type N,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from '../parts.js';
import type { GoModuleAnalysis } from './go.js';

export async function analyzeCLanguage(src: string): Promise<GoModuleAnalysis | null> {
  const parser = await getParser('.c', findLanguageByExt('.c')!);
  if (!parser) return null;
  // §21 规矩③：解析失败不兜底（同 analyzeModuleSource）
  const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;
  const rootOffsets = new Map<string, number>();
  const rootKinds = new Map<string, string>();
  const refs = new Map<string, number[]>();
  const defined = new Set<string>();
  const imports: Array<{ alias: string; path: string }> = [];
  const selections = new Map<string, Array<{ field: string; fieldOffset: number }>>();
  const add = (m: Map<string, number[]>, name: string, offset: number): void => {
    let a = m.get(name);
    if (!a) {
      a = [];
      m.set(name, a);
    }
    a.push(offset);
  };
  // 找 function_declarator 的 declarator 标识符 = 函数名
  const fnNameOf = (fnode: N): { text: string; offset: number } | null => {
    const st: N[] = [fnode];
    while (st.length) {
      const n = st.pop()!;
      if (n.type === 'function_declarator') {
        const nm = n.childForFieldName('declarator');
        if (nm && nm.type === 'identifier') return { text: nm.text, offset: nm.startIndex };
        continue;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) st.push(c);
      }
    }
    return null;
  };
  const defOffsetByIdent = new Map<number, string>();
  const collectDefs = (n: N, depth = 0): void => {
    if (depth > 2000) return;
    const t = n.type;
    if (t === 'function_definition' || t === 'declaration') {
      const nm = fnNameOf(n);
      if (nm && !rootOffsets.has(nm.text)) {
        rootOffsets.set(nm.text, nm.offset);
        rootKinds.set(nm.text, t === 'function_definition' ? 'function' : 'decl');
        defined.add(nm.text);
        defOffsetByIdent.set(nm.offset, nm.text);
        return; // 函数体内部引用交给独立 refs 遍历；此处不深入（避免 def 名被当引用）
      }
      // declaration 可能含多 declarator；若有函数名已记，仍遍历其它声明子节点
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) collectDefs(c, depth + 1);
    }
  };
  const collectRefs = (n: N, depth = 0): void => {
    if (depth > 2000) return;
    if (n.type === 'identifier') {
      const off = n.startIndex;
      if (!defOffsetByIdent.has(off)) add(refs, n.text, off);
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) collectRefs(c, depth + 1);
    }
  };
  const collectIncludes = (n: N, depth = 0): void => {
    if (depth > 500) return;
    const m = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(n.text);
    if (m) {
      const p = m[1];
      imports.push({ alias: path.posix.basename(p).replace(/\.[^.]+$/, ''), path: p });
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) collectIncludes(c, depth + 1);
    }
  };
  collectDefs(root, 0);
  collectRefs(root, 0);
  collectIncludes(root, 0);
  return { rootOffsets, rootKinds, refs, defined, imports, selections };
}

export async function renameCSymbol(args: {
  file: string;
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
}): Promise<RenameSymbolResult> {
  const { file, symbol, to, dryRun, resolvedRoot } = args;
  const blocked = args.blocked.slice();
  if (!/^[A-Za-z_]\w*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const defSrc = readFileSync(file, 'utf-8');
  const def = await analyzeCLanguage(defSrc);
  const defKind = def?.rootKinds.get(symbol);
  if (!def || !defKind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该 C/C++ 文件的函数/类型定义`] };
  if (def.rootOffsets.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名符号 "${to}"`] };

  // def 头标识：def 文件去扩展名 → 其它文件 `#include` 该基础名即联动
  const defBase = path.posix.basename(file.replace(/\\/g, '/')).replace(/\.\w+$/, '');

  // def 文件：定义处（可能 = 原型，去重）+ 同文件引用
  const defEdits: Array<{ pos: number; len: number; text: string }> = [{ pos: def.rootOffsets.get(symbol)!, len: symbol.length, text: to }];
  for (const off of def.refs.get(symbol) ?? []) defEdits.push({ pos: off, len: symbol.length, text: to });

  const editsByFile = new Map<string, { src: string; edits: Array<{ pos: number; len: number; text: string }> }>();
  editsByFile.set(file, { src: defSrc, edits: defEdits });

  const scanC = collectFilesByExt(resolvedRoot, '.c');
  const scanH = collectFilesByExt(resolvedRoot, '.h');
  const skipped: Array<{ path: string; why: string }> = [...scanC.skipped, ...scanH.skipped];
  for (const abs of new Set([...scanC.files, ...scanH.files])) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch (err) {
      // §2d：读不了的候选文件不再静默 continue
      skipped.push({ path: abs, why: String(err) });
      continue;
    }
    const m = await analyzeCLanguage(src);
    if (!m) continue;
    const fileEdits: Array<{ pos: number; len: number; text: string }> = [];
    if (m.defined.has(symbol)) {
      // 原型/定义文件（如头文件的函数声明）→ 定义名 + 同文件裸引用联动
      const defOff = m.rootOffsets.get(symbol);
      if (defOff !== undefined) fileEdits.push({ pos: defOff, len: symbol.length, text: to });
      for (const off of m.refs.get(symbol) ?? []) fileEdits.push({ pos: off, len: symbol.length, text: to });
    } else if (m.imports.some((i) => i.alias === defBase)) {
      // `#include` def 头文件 → 裸引用联动（调用点）
      for (const off of m.refs.get(symbol) ?? []) fileEdits.push({ pos: off, len: symbol.length, text: to });
    }
    if (fileEdits.length) editsByFile.set(abs, { src, edits: fileEdits });
  }

  // 冻结行保护（原子）+ 原子落盘
  const guard = createProtectGuard(resolvedRoot);
  for (const [abs, entry] of editsByFile) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    const g = guard.scan(abs, entry.src, entry.edits);
    if (g.blocked) blocked.push(`${path.relative(resolvedRoot, abs).replace(/\\/g, '/')} 的引用命中保护标记行，需解除保护或人工处理后再改名：${g.protectedLines.join(' | ')}`);
  }
  if (blocked.length > 0) return { ok: false, symbol, to, filesWritten: 0, blocked };

  let filesWritten = 0;
  const ordered: RenameSymbolFileInfo[] = [];
  for (const [abs, { src, edits }] of editsByFile) {
    const out = applyEdits(src, edits);
    if (out !== src && !dryRun) {
      writeFileSync(abs, out, 'utf-8');
      filesWritten++;
    }
    const isDef = path.resolve(abs) === path.resolve(file);
    ordered.push({
      file: (path.relative(resolvedRoot, abs) || abs).replace(/\\/g, '/'),
      edits: edits.length,
      note: isDef ? '定义+同文件引用（C/C++）' : mDefNote(abs, defBase, edits.length) || '引用（C/C++）',
      ops: toOps(src, edits),
    });
  }
  function mDefNote(abs: string, base: string, n: number): string | undefined {
    return n > 0 ? (path.posix.basename(abs).endsWith('.h') ? '头文件声明（C/C++）' : '调用点引用（C/C++）') : undefined;
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
