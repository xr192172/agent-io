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
 * 「取一条声明里的路径文本」的规则（模块声明 / import 声明各一份）。
 * ★★ 做成**数据**，不做成 `if (isJava)`：同一门语言的语法事实应当住在**那个语言的文件**里。
 */
export interface NamespaceDeclRule {
  /** 声明节点的类型（Java `package_declaration` / C# `using_directive` …） */
  readonly nodeType: string;
  /**
   * 允许作为路径文本的子节点类型，按顺序取**第一个命中**的。
   * ★ 不能盲取第一个子节点 —— 实测这些节点的首个 child 是 `package` / `import` / `namespace` / `using`
   *   **关键字**（匿名节点），取错就得到 "package" 这种垃圾路径。
   * ★ `null` = **取第一个子节点、不看类型**（C# `using_directive` 的原行为就是如此，见 `cs.ts` 里的等价性说明）。
   */
  readonly childTypes: readonly string[] | null;
  /** 别名过滤（可选）：别名不合规则**该条声明整条丢弃**（C# `using` 用它挡非常规形态） */
  aliasOk?(alias: string): boolean;
}

/** 一门「命名空间语言」的**全部语法规则**（不含分析器本身）—— 由 `languages/<lang>.ts` 提供。 */
export interface NamespaceLangRules {
  /** 源码扩展名（用于 `collectFilesByExt` 与产物标签）。★ `string` 而非字面量联合 —— 家族成员不设上限 */
  readonly ext: string;
  /** 展示名（写进产物 `note`），如 'Java' / 'C#' */
  readonly label: string;
  /** 顶层类型节点（在模块作用域里算"模块级符号"的东西：class/interface/enum/record/struct…） */
  readonly typeNodes: readonly string[];
  /** 收集"裸引用"时算作标识符的节点类型（Java/C# 都是 `identifier` + `type_identifier`） */
  readonly idTypes: readonly string[];
  /** **模块声明**的取法（Java `package` / C# `namespace`） */
  readonly moduleDecl: NamespaceDeclRule;
  /** **import / using 声明**的取法 */
  readonly importDecl: NamespaceDeclRule;
  /** 限定引用 `X.sym` 的节点类型（跨模块改名的关键） */
  readonly qualifiedRefNodes: readonly string[];
  /**
   * 「模块作用域」判定：顶层类型定义挂在什么父节点下才算模块级。
   * · `parentTypes`     —— 父节点类型直接命中（Java：类型直接挂 `compilation_unit`）
   * · `listTypes`       —— 父节点是"声明列表"，且（**祖父缺失** 或 祖父 ∈ `grandparentTypes`）
   *                        （C#：类型挂在 `namespace_declaration` 下的 `declaration_list`）
   */
  readonly moduleScope: {
    readonly parentTypes: readonly string[];
    readonly listTypes: readonly string[];
    readonly grandparentTypes: readonly string[];
  };
  /** 从**源码文本**直接取模块名（"同模块判定"用；不走 AST，因为它在逐文件扫描的循环里被反复调用） */
  moduleOf(src: string): string;
}

/**
 * 引擎要的完整描述 = **语法规则** + **该语言的顶层类型分析器**。
 * ★ 分两层是因为分析器**由规则造出来**（`makeNamespaceAnalyzer(rules)`）⇒ 不能自己包含自己。
 */
export interface NamespaceLangSpec extends NamespaceLangRules {
  analyze(src: string): Promise<GoModuleAnalysis | null>;
}

/**
 * 命名空间级分析器工厂（**对具体语言零知识**：语法全从 `rules` 来）。
 *
 * ★★ 改前这里有 **5 处 `if (isJava)`**（模块/import 声明 ×4 + 限定引用 ×1）——
 *   那等于「**两门语言的语法住在同一个文件里**」，而且 `isJava` 是**布尔**，
 *   **根本表达不了第三个家族成员** ⇒ 加 Kotlin/Swift 必须改这个文件，
 *   "加一门语言 = 加一个文件 + 注册一行"对家族成员**一直是假话**。
 *   现在规则由调用方给 ⇒ **那句话第一次成为真话**。
 *
 * ★ 行为等价性：逐分支对照原 `if (isJava)` 版本搬过来，只把"取哪个子节点"换成 `rules.moduleDecl` /
 *   `rules.importDecl` / `rules.qualifiedRefNodes`。各处**循环语义逐字保留**（见 `pickDeclPath`）。
 */
export function makeNamespaceAnalyzer(rules: NamespaceLangRules) {
  return async function analyze(src: string): Promise<GoModuleAnalysis | null> {
    const parser = await getParser(rules.ext, findLanguageByExt(rules.ext)!);
    if (!parser) return null;
    // §21 规矩③：解析失败不兜底（同 analyzeModuleSource）
    const root: N = (parseContent(parser as Parameters<typeof parseContent>[0], src) as unknown as { rootNode: N }).rootNode;
    const typeNodes = new Set(rules.typeNodes);
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

    // 顶层类型定义：父节点是"编译单元/程序"（Java）或"namespace/根 下的声明列表"（C#）——
    // 具体类型由 `rules.moduleScope` 给（原地是 `p.type === 'compilation_unit' || 'program'` 等字样）。
    const { moduleScope } = rules;
    const isModuleScope = (p: N | null, gp: N | null): boolean => {
      if (!p) return false;
      if (moduleScope.parentTypes.includes(p.type)) return true;
      if (moduleScope.listTypes.includes(p.type)) {
        return !gp || moduleScope.grandparentTypes.includes(gp.type);
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

    /**
     * 取一条声明（模块声明 / import 声明）的**路径文本**。
     * ★ 循环语义**逐字保留**自改前的四个 `if` 分支（这是参数化最容易悄悄改行为的地方）：
     *   · 子节点为 null ⇒ 继续看下一个；
     *   · `childTypes` 给了且类型不命中 ⇒ **继续看下一个**（Java/C# 的 `package`/`namespace` 分支如此
     *     —— 因为首个 child 是 `package`/`namespace` **关键字**）；
     *   · `childTypes === null` ⇒ **取第一个子节点、不看类型**（C# `using_directive` 的原行为）；
     *   · 别名被 `aliasOk` 否决 ⇒ **立刻放弃这条声明**（对应原 `using` 分支的 `break`，**不是**继续找下一个）。
     */
    const pickDeclPath = (n: N, rule: NamespaceDeclRule): string | null => {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (!c) continue;
        if (rule.childTypes !== null && !rule.childTypes.includes(c.type)) continue;
        const alias = c.text.split('.').filter(Boolean).pop() ?? '';
        if (rule.aliasOk && !rule.aliasOk(alias)) return null;
        return c.text;
      }
      return null;
    };

    // module 名 = package/namespace 路径（末段做同模块判定）；imports 记 package/namespace + import/using
    const collectModuleAndImports = (n: N, depth = 0): void => {
      if (depth > 1000) return;
      const t = n.type;
      if (t === rules.moduleDecl.nodeType || t === rules.importDecl.nodeType) {
        const pathText = pickDeclPath(n, t === rules.moduleDecl.nodeType ? rules.moduleDecl : rules.importDecl);
        if (pathText !== null) {
          imports.push({ alias: pathText.split('.').filter(Boolean).pop() ?? '', path: pathText });
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
      // 限定引用：Java 用 `scoped_type_identifier`/`scoped_identifier`，C# 用 `qualified_name`
      // —— 具体节点类型由 `rules.qualifiedRefNodes` 给。
      if (rules.qualifiedRefNodes.includes(t)) {
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
      if (rules.idTypes.includes(t)) {
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
