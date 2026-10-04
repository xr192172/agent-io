/**
 * rename_symbol · C#
 *
 * C# 是「命名空间一族」的成员（另一成员是 Java）。本文件**只放 C# 特有的东西**：
 *   · `CSHARP_RULES` —— **C# 的全部语法事实**（顶层类型节点 / 模块声明 / using 声明 / 限定引用 /
 *     模块作用域 / `moduleOf`）。★ 引擎`namespace_family.ts`**不认识这些**，它们只在这里。
 *   · `analyzeCSharpSource` —— 由规则造出的顶层类型分析器
 *   · `renameCSharpSymbol` / `csPackage`
 * ★ 与 Java **共用的算法**（分析器工厂 + 跨文件改名引擎）住在 `../namespace_family.ts`
 *   —— 那里的头注解释了为什么它必须在 `languages/` **外面**。本文件与 `java.ts` **零 import**。
 *
 * C# 语义（与 Python 的"模块=命名空间"同构，但跨文件限定引用形态不同）：
 *   - 顶层类型（class/interface/struct/enum/record）是"模块级符号"，同命名空间内直接可见
 *   - 跨文件引用：同命名空间 → 裸名；跨命名空间 → `Qualified.Name`（qualified_name）
 * 分析结果复用 `GoModuleAnalysis` 结构：
 *   rootOffsets/rootKinds/refs → 顶层类型 + 同文件裸引用
 *   imports      → namespace 声明 + using（末段做同模块判定）
 *   selections   → `X.sym` 限定引用（key=限定符末段，field=符号名）
 *
 * ★ 命名注意：本文件的导出是 `renameCSharpSymbol`（C#）。
 *   别与 `languages/c.ts` 的 `renameCSymbol`（**C 语言**）混淆 —— 一个词之差，两门语言。
 */
import { makeNamespaceAnalyzer, renameNamespaceSymbol, type NamespaceLangRules, type NamespaceLangSpec } from '../namespace_family.js';
import type { LangPackage, LangRenameArgs, RenameSymbolResult } from '../parts.js';

/** C# 的语法规则（**本语言的全部语法事实**，引擎对此零知识）。 */
const CSHARP_RULES: NamespaceLangRules = {
  ext: '.cs',
  label: 'C#',
  typeNodes: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration'],
  idTypes: ['identifier', 'type_identifier'],
  moduleDecl: { nodeType: 'namespace_declaration', childTypes: ['qualified_name', 'identifier'] },
  importDecl: {
    nodeType: 'using_directive',
    // ★★ 2026-10-05（T53）**修正**：这里原先写 `childTypes: null`（= 取第一个子节点、不看类型），
    //   忠实照搬了改前的 `n.child(0)` 行为 —— 而实测 `using_directive` 的子节点是
    //   `using`(**关键字**,匿名) / `identifier|qualified_name` / `;`
    //   ⇒ 取到的是**关键字本身**，`alias='using'` 恰好通过下面的 `aliasOk`
    //   ⇒ **每写一条 `using` 就多一条垃圾** `{alias:'using', path:'using'}`。
    //   ★ 当时不改是因为那一笔的判据是"行为**逐字**不变"（已用三案例字节级对照证明）；
    //     本笔单独修，判据换成"`imports` 里不再出现 `alias === 'using'`"，且
    //     **改名的产物必须仍与改前逐字相同**（因为 `renameNamespaceSymbol` **不读 `imports`**）。
    //   ★ 子结构实测与 Java 侧同形（那边一直是按类型挑）⇒ 两门语言的规则现在写法一致。
    childTypes: ['qualified_name', 'identifier'],
    aliasOk: (alias) => /^[A-Za-z_][\w$]*$/.test(alias),
  },
  qualifiedRefNodes: ['qualified_name'],
  moduleScope: {
    parentTypes: ['compilation_unit', 'program'],
    listTypes: ['declaration_list'],
    grandparentTypes: ['namespace_declaration', 'compilation_unit', 'program'],
  },
  /** C# 的模块声明取法：`namespace A.B` */
  moduleOf: (src) => {
    const m = src.match(/\bnamespace\s+([\w.]+)/);
    return m ? m[1] : '';
  },
};

export const analyzeCSharpSource = makeNamespaceAnalyzer(CSHARP_RULES);

/** 引擎要的完整描述 = 语法规则 + 分析器（分析器由规则造出，故在此拼上） */
const CSHARP: NamespaceLangSpec = { ...CSHARP_RULES, analyze: analyzeCSharpSource };

/** C# 的跨文件符号改名（= 共用引擎 + C# 的完整描述） */
export const renameCSharpSymbol = (args: LangRenameArgs): Promise<RenameSymbolResult> =>
  renameNamespaceSymbol(CSHARP, args);

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 * ⇒ 好处：**"让这个文件去服务别的扩展名"在结构上不可能**（这正是改前 `cs.ts`/`java.ts` 交叉污染的根因）。
 */
export const csPackage: LangPackage = {
  exts: ['.cs'],
  rename: (a) => renameCSharpSymbol(a),
};
