/**
 * rename_symbol · Java
 *
 * Java 是「命名空间一族」的成员（另一成员是 C#）。本文件**只放 Java 特有的东西**：
 *   · `analyzeJavaSource` —— 顶层类型分析器（节点类型表是 Java 的）
 *   · `moduleOf`          —— Java 的模块声明取法（`package a.b.c`）
 *   · `renameJavaSymbol`  —— 把上面两样 + `label` 注入共用引擎
 * ★ 与 C# **共用的算法**（分析器工厂 + 跨文件改名引擎）住在 `../namespace_family.ts`
 *   —— 那里的头注解释了为什么它必须在 `languages/` **外面**（两个语言文件曾经互相
 *   import、各自装着对方的零件）。本文件与 `cs.ts` **零 import**。
 *
 * 语义（改名引擎侧，逐字取自原头注）：
 *   - def 文件：定义处 + 同文件裸引用
 *   - 同模块文件（package 路径相等）→ 裸引用
 *   - 跨模块文件 → `X.sym` 限定引用（qualifier 末段 == def 模块末段）
 *   - 冻结行保护 + 原子性（任一阻断 → 整体不落盘）
 */
import { makeNamespaceAnalyzer, renameNamespaceSymbol, type NamespaceLangSpec } from '../namespace_family.js';
import type { LangPackage, LangRenameArgs, RenameSymbolResult } from '../parts.js';

export const analyzeJavaSource = makeNamespaceAnalyzer({
  ext: '.java',
  typeNodes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration'],
  idType: 'identifier',
});

/** Java 的模块声明取法：`package a.b.c` */
const moduleOf = (src: string): string => {
  const m = src.match(/^\s*package\s+([\w.]+)/m);
  return m ? m[1] : '';
};

const JAVA: NamespaceLangSpec = { ext: '.java', label: 'Java', moduleOf, analyze: analyzeJavaSource };

/** Java 的跨文件符号改名（= 共用引擎 + Java 的 ext/label/moduleOf/analyze） */
export const renameJavaSymbol = (args: LangRenameArgs): Promise<RenameSymbolResult> =>
  renameNamespaceSymbol(JAVA, args);

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 * ⇒ 好处：**"让这个文件去服务别的扩展名"在结构上不可能**（这正是改前 `cs.ts`/`java.ts` 交叉污染的根因）。
 */
export const javaPackage: LangPackage = {
  exts: ['.java'],
  rename: (a) => renameJavaSymbol(a),
};
