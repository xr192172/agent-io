/**
 * rename_symbol · 命名空间一族（C# / Java，以及将来的 Kotlin / Swift）
 *
 * ★★ 为什么本文件住在 `languages/` **外面**（2026-10-05，T28 续）：
 *   `languages/` 的目录规则是「**一个文件 = 一门语言**」。而本文件里两样东西
 *   **都不属于任何单门语言**，它们是 C#/Java 共用的：
 *     · `makeNamespaceAnalyzer(opts)` —— 按 `{ext, typeNodes, idType}` 参数化的分析器工厂；
 *     · `renameNamespaceSymbol(spec, args)` —— 跨文件改名引擎（复用 Python 的原子扫描骨架）。
 *
 *   ★ 改前是**交叉污染**：工厂住在 `languages/cs.ts`（Java 得 import 它），
 *     引擎住在 `languages/java.ts`（而 C# 的注册项指向它）
 *     ⇒ **两个文件各自装着对方语言的零件**，靠"`java.ts → cs.ts` 单向"躲开环。
 *     那是一条「**为了绕环而做的妥协**」，两边的头注都写明了这一点。
 *   ⇒ 现在两端都搬到这里：依赖变成 `languages/*.ts → namespace_family.ts` **单向**，
 *     **语言包之间零 import** —— 环从结构上消失，不再是"靠方向躲开"。
 *
 * ★ 本文件对**具体语言零知识**：语言特有的 `ext` / `label` / `moduleOf` / `analyze`
 *   全部由调用方经 `NamespaceLangSpec` 注入 ⇒ Java 的节点类型表留在 `java.ts`，
 *   C# 的留在 `cs.ts`。（唯一残留的语言判别是工厂内部的 `opts.ext === '.java'`，
 *   它读的是**调用方传进来的参数**，不是本文件写死的语言。）
 *
 * 语义（逐字取自原 `java.ts` 头注，未改）：
 *   - def 文件：定义处 + 同文件裸引用
 *   - 同模块文件（package/namespace 路径相等）→ 裸引用
 *   - 跨模块文件 → `X.sym` 限定引用（qualifier 末段 == def 模块末段）
 *   - 冻结行保护 + 原子性（任一阻断 → 整体不落盘）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createProtectGuard } from '../../../infrastructure/analysis/refactor/protect.js';
import { getParser } from '../../../infrastructure/parse/loader.js';
import { findLanguageByExt } from '../../../infrastructure/parse/languages.js';
import { parseContent } from '../../../infrastructure/parse/kernel.js';
import {
  collectFilesByExt,
  applyEdits,
  toOps,
  nameInfo,
  type N,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from './parts.js';
import type { GoModuleAnalysis } from './parts.js';

/**
 * 一门"命名空间语言"接入本族所需的三样语言特有信息。
 * ★ 全部由调用方（`languages/<lang>.ts`）提供 ⇒ 本文件不认识任何具体语言。
 */
export interface NamespaceLangSpec {
  /** 源码扩展名（用于 `collectFilesByExt` 与产物标签） */
  readonly ext: '.java' | '.cs';
  /** 展示名（写进产物 `note`），如 'Java' / 'C#' */
  readonly label: string;
  /** 该语言的「模块声明」取法（Java 取 `package`，C# 取 `namespace`） */
  moduleOf(src: string): string;
  /** 该语言的顶层类型分析器 */
  analyze(src: string): Promise<GoModuleAnalysis | null>;
}

/**
 * 命名空间级分析器工厂（C#/Java 共用；按 opts 参数化）。
 * ★ 逐字从原 `languages/cs.ts` 搬来，只把对 `GoModuleAnalysis` 的 import 改成新路径。
 */
export function makeNamespaceAnalyzer(opts: {
  ext: '.java' | '.cs';
  typeNodes: string[];
  idType: string;
}) {
  return async function analyze(src: string): Promise<GoModuleAnalysis | null> {
    const parser = await getParser(opts.ext, findLanguageByExt(opts.ext)!);
    if (!parser) return null;
    // §21 规矩③：解析失败不兜底（同 analyzeModuleSource）
    const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;
    const isJava = opts.ext === '.java';
    const typeNodes = new Set(opts.typeNodes);
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

    // 顶层类型定义：parent 为 compilation_unit（Java）或 declaration_list@namespace/root（C#）
    const isModuleScope = (p: N | null, gp: N | null): boolean => {
      if (!p) return false;
      if (p.type === 'compilation_unit' || p.type === 'program') return true;
      if (p.type === 'declaration_list') {
        return !gp || gp.type === 'namespace_declaration' || gp.type === 'compilation_unit' || gp.type === 'program';
      }
      return false;
    };
    const collectDefs = (n: N, parent: N | null, gp: N | null, depth = 0): void => {
      if (depth > 1000) return;
      if (typeNodes.has(n.type) && isModuleScope(parent, gp)) {
        const ni = nameInfo(n);
        if (ni && n.type !== 'method_declaration' && n.type !== 'property_declaration' && !rootOffsets.has(ni.text)) {
          rootOffsets.set(ni.text, ni.offset);
          rootKinds.set(ni.text, n.type);
          defined.add(ni.text);
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectDefs(c, n, parent, depth + 1);
      }
    };

    // module 名 = package/namespace 路径（末段做同模块判定）；imports 记 package/namespace + import/using
    const collectModuleAndImports = (n: N, depth = 0): void => {
      if (depth > 1000) return;
      const t = n.type;
      if (isJava && t === 'package_declaration') {
        // 取 package 后的 scoped_identifier 全文本
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            return;
          }
        }
        return;
      }
      if (isJava && t === 'import_declaration') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'scoped_identifier' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            return;
          }
        }
        return;
      }
      if (!isJava && t === 'namespace_declaration') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c && (c.type === 'qualified_name' || c.type === 'identifier')) {
            imports.push({ alias: c.text.split('.').filter(Boolean).pop() ?? '', path: c.text });
            break;
          }
        }
        return;
      }
      if (!isJava && t === 'using_directive') {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c) {
            const seg = c.text.split('.').filter(Boolean).pop() ?? '';
            if (seg && /^[A-Za-z_][\w$]*$/.test(seg)) imports.push({ alias: seg, path: c.text });
            break;
          }
        }
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectModuleAndImports(c, depth + 1);
      }
    };

    // 裸引用（同文件/同模块的裸名引用）+ 限定引用 `X.sym`（key=限定符末段）
    const collectRefs = (n: N, depth = 0): void => {
      if (depth > 1000) return;
      const t = n.type;
      // 限定引用：Java scoped_type_identifier/scoped_identifier 末段带 name 字段；C# qualified_name
      if ((!isJava && t === 'qualified_name') || (isJava && (t === 'scoped_type_identifier' || t === 'scoped_identifier'))) {
        let nameField = n.childForFieldName('name');
        // scoped_type_identifier 无 name 字段 → 回退取最后一个 identifier/type_identifier 子节点
        if (!nameField) {
          for (let i = n.childCount - 1; i >= 0; i--) {
            const c = n.child(i);
            if (c && (c.type === 'identifier' || c.type === 'type_identifier')) {
              nameField = c;
              break;
            }
          }
        }
        if (nameField && (nameField.type === 'identifier' || nameField.type === 'type_identifier')) {
          // 限定符 = 除末段外的文本（去末段名字）
          let scopeText = '';
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i);
            if (c && c !== nameField) scopeText += c.text;
          }
          if (scopeText.includes('.') || (scopeText && /^[A-Za-z_][\w$]*\./.test(n.text))) {
            const last = scopeText.split('.').filter(Boolean).pop()?.replace(/[^\w$]/g, '') ?? '';
            if (last) {
              let a = selections.get(last);
              if (!a) {
                a = [];
                selections.set(last, a);
              }
              a.push({ field: nameField.text, fieldOffset: nameField.startIndex });
            }
          }
        }
        return; // 不深入（限定符是链式，叶子在下一层 qualified_name 已覆盖）
      }
      if (t === opts.idType || t === 'type_identifier') {
        add(refs, n.text, n.startIndex);
        return;
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectRefs(c, depth + 1);
      }
    };

    collectDefs(root, null, null, 0);
    collectModuleAndImports(root, 0);
    collectRefs(root, 0);

    // 去掉定义处名字节点在 refs 里的记录（定义不是引用）
    for (const off of [...refs.values()].flat()) {
      for (const [, o] of rootOffsets) {
        if (o === undefined) continue;
      }
    }
    // refs 去重
    for (const [name, arr] of refs) refs.set(name, [...new Set(arr)]);
    return { rootOffsets, rootKinds, refs, defined, imports, selections };
  };
}

/** 本族改名引擎的入参（`LangRenameArgs` 的子集 —— `skipped` / `aliasCfg` 是 TS/JS 家族专用） */
export interface NamespaceRenameArgs {
  file: string;
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
}

/**
 * 命名空间级跨文件改名引擎（C#/Java 共用）。
 * ★ 逐字从原 `languages/java.ts` 搬来，只把 `args.ext` / `isJava` 换成 `spec` 的字段
 *   —— 行为零改动（同一个分析器、同一条模块判定、同一个 label 文本）。
 */
export async function renameNamespaceSymbol(spec: NamespaceLangSpec, args: NamespaceRenameArgs): Promise<RenameSymbolResult> {
  const { file, symbol, to, dryRun, resolvedRoot } = args;
  const blocked = args.blocked.slice();
  const analyze = spec.analyze;

  if (!/^[A-Za-z_][\w$]*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const defSrc = readFileSync(file, 'utf-8');
  const def = await analyze(defSrc);
  const defKind = def?.rootKinds.get(symbol);
  if (!def || !defKind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该文件的命名空间级类型定义`] };
  if (def.rootOffsets.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名类型 "${to}"`] };

  // def 模块 = package/namespace 路径（由 spec.moduleOf 在源码直取，跨模块限定引用匹配用）
  const defMod = spec.moduleOf(defSrc);

  // def 文件：定义处 + 同文件裸引用
  const defEdits: Array<{ pos: number; len: number; text: string }> = [{ pos: def.rootOffsets.get(symbol)!, len: symbol.length, text: to }];
  for (const off of def.refs.get(symbol) ?? []) defEdits.push({ pos: off, len: symbol.length, text: to });

  const editsByFile = new Map<string, { src: string; edits: Array<{ pos: number; len: number; text: string }> }>();
  editsByFile.set(file, { src: defSrc, edits: defEdits });

  const scan = collectFilesByExt(resolvedRoot, spec.ext);
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
    const fileMod = spec.moduleOf(src);
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
      note: isDef ? `定义+同文件引用（${spec.label}）` : path.dirname(abs) === path.dirname(file) ? '同包引用' : '跨包限定引用',
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
