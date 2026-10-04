/**
 * rename_symbol · C#
 *
 * C# 是「命名空间一族」的成员（另一成员是 Java）。本文件**只放 C# 特有的东西**：
 *   · `analyzeCSharpSource` —— 顶层类型分析器（节点类型表是 C# 的）
 *   · `moduleOf`            —— C# 的模块声明取法（`namespace A.B`）
 *   · `renameCSharpSymbol`  —— 把上面两样 + `label` 注入共用引擎
 * ★ 与 Java **共用的算法**（分析器工厂 + 跨文件改名引擎）住在 `../namespace_family.ts`
 *   —— 那里的头注解释了为什么它必须在 `languages/` **外面**（两个语言文件曾经互相
 *   import、各自装着对方的零件）。本文件与 `java.ts` **零 import**。
 *
 * C# 语义（与 Python 的"模块=命名空间"同构，但跨文件限定引用形态不同）：
 *   - 顶层类型（class/interface/struct/enum/record）是"模块级符号"，同命名空间内直接可见
 *   - 跨文件引用：同命名空间 → 裸名；跨命名空间 → `Qualified.Name`（qualified_name）
 * 分析结果复用 `GoModuleAnalysis` 结构：
 *   rootOffsets/refs/defined → 顶层类型 + 同文件裸引用
 *   imports      → namespace 声明 + using（末段做同模块判定）
 *   selections   → `X.sym` 限定引用（key=限定符末段，field=符号名）
 *
 * ★ 命名注意：本文件的导出是 `renameCSharpSymbol`（C#）。
 *   别与 `languages/c.ts` 的 `renameCSymbol`（**C 语言**）混淆 —— 一个词之差，两门语言。
 */
import { makeNamespaceAnalyzer, renameNamespaceSymbol, type NamespaceLangSpec } from '../namespace_family.js';
import type { LangRenameArgs, RenameSymbolResult } from '../parts.js';

export const analyzeCSharpSource = makeNamespaceAnalyzer({
  ext: '.cs',
  typeNodes: ['class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration', 'record_declaration'],
  idType: 'identifier',
});

/** C# 的模块声明取法：`namespace A.B` */
const moduleOf = (src: string): string => {
  const m = src.match(/\bnamespace\s+([\w.]+)/);
  return m ? m[1] : '';
};

const CSHARP: NamespaceLangSpec = { ext: '.cs', label: 'C#', moduleOf, analyze: analyzeCSharpSource };

/** C# 的跨文件符号改名（= 共用引擎 + C# 的 ext/label/moduleOf/analyze） */
export const renameCSharpSymbol = (args: LangRenameArgs): Promise<RenameSymbolResult> =>
  renameNamespaceSymbol(CSHARP, args);
