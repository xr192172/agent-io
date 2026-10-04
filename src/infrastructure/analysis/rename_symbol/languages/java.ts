/**
 * rename_symbol · Java（+ C#/Java 共享的命名空间改名执行器）
 *
 * `analyzeJavaSource` 由 `csharp.ts` 的 `makeNamespaceAnalyzer` 工厂产出；
 * `renameNamespaceSymbol` 是 C#/Java 共用的跨文件改名执行器（复用 Python 的原子扫描骨架）：
 *   - def 文件：定义处 + 同文件裸引用
 *   - 同模块文件（package/namespace 路径相等）→ 裸引用
 *   - 跨模块文件 → `X.sym` 限定引用（qualifier 末段 == def 模块末段）
 *   - 冻结行保护 + 原子性（任一阻断 → 整体不落盘）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createProtectGuard } from '../../../../infrastructure/analysis/refactor/protect.js';
import {
  collectFilesByExt,
  applyEdits,
  toOps,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from '../parts.js';
import { makeNamespaceAnalyzer, analyzeCSharpSource } from './csharp.js';

export const analyzeJavaSource = makeNamespaceAnalyzer({
  ext: '.java',
  typeNodes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration'],
  idType: 'identifier',
});

export async function renameNamespaceSymbol(args: {
  file: string;
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
  ext: '.java' | '.cs';
}): Promise<RenameSymbolResult> {
  const { file, symbol, to, dryRun, resolvedRoot } = args;
  const blocked = args.blocked.slice();
  const isJava = args.ext === '.java';
  const analyze = isJava ? analyzeJavaSource : analyzeCSharpSource;

  if (!/^[A-Za-z_][\w$]*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const defSrc = readFileSync(file, 'utf-8');
  const def = await analyze(defSrc);
  const defKind = def?.rootKinds.get(symbol);
  if (!def || !defKind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该文件的命名空间级类型定义`] };
  if (def.rootOffsets.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名类型 "${to}"`] };

  // def 模块 = package/namespace 路径（正则在源码直取，跨模块限定引用匹配用）
  const moduleOf = (src: string): string => {
    if (isJava) {
      const m = src.match(/^\s*package\s+([\w.]+)/m);
      return m ? m[1] : '';
    }
    const m = src.match(/\bnamespace\s+([\w.]+)/);
    return m ? m[1] : '';
  };
  const defMod = moduleOf(defSrc);

  // def 文件：定义处 + 同文件裸引用
  const defEdits: Array<{ pos: number; len: number; text: string }> = [{ pos: def.rootOffsets.get(symbol)!, len: symbol.length, text: to }];
  for (const off of def.refs.get(symbol) ?? []) defEdits.push({ pos: off, len: symbol.length, text: to });

  const editsByFile = new Map<string, { src: string; edits: Array<{ pos: number; len: number; text: string }> }>();
  editsByFile.set(file, { src: defSrc, edits: defEdits });

  const scan = collectFilesByExt(resolvedRoot, args.ext);
  const skipped: Array<{ path: string; why: string }> = [...scan.skipped];
  for (const abs of scan.files) {
    if (path.resolve(abs) === path.resolve(file)) continue;
    let src: string;
    try {
      src = readFileSync(abs, 'utf-8');
    } catch (err) {
      // §2d：读不了的候选文件不再静默 continue（"少看了它 ⇒ 可能漏改引用"必须可读）
      skipped.push({ path: abs, why: String(err) });
      continue;
    }
    const m = await analyze(src);
    if (!m) continue;
    const fileEdits: Array<{ pos: number; len: number; text: string }> = [];
    const fileMod = moduleOf(src);
    if (fileMod && defMod && fileMod === defMod) {
      // 同模块：裸引用
      for (const off of m.refs.get(symbol) ?? []) fileEdits.push({ pos: off, len: symbol.length, text: to });
    } else if (defMod) {
      // 跨模块：限定引用（qualifier 末段 == def 模块末段）
      const defLast = defMod.split('.').filter(Boolean).pop() ?? defMod;
      for (const [opKey, selRefs] of m.selections) {
        if (opKey !== defLast) continue;
        for (const s of selRefs) if (s.field === symbol) fileEdits.push({ pos: s.fieldOffset, len: symbol.length, text: to });
      }
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
      note: isDef ? `定义+同文件引用（${args.ext === '.java' ? 'Java' : 'C#'}）` : path.dirname(abs) === path.dirname(file) ? '同包引用' : '跨包限定引用',
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
