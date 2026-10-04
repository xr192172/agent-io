/**
 * rename_symbol · Java
 *
 * Java 是「命名空间一族」的成员（另一成员是 C#）。本文件**只放 Java 特有的东西**：
 *   · `JAVA_RULES` —— **Java 的全部语法事实**（顶层类型节点 / 模块声明 / import 声明 / 限定引用 /
 *     模块作用域 / `moduleOf`）。★ 引擎`namespace_family.ts`**不认识这些**，它们只在这里。
 *   · `analyzeJavaSource` —— 由规则造出的顶层类型分析器
 *   · `renameJavaSymbol` / `javaPackage`
 * ★ 与 C# **共用的算法**（分析器工厂 + 跨文件改名引擎）住在 `../namespace_family.ts`
 *   —— 那里的头注解释了为什么它必须在 `languages/` **外面**。本文件与 `cs.ts` **零 import**。
 *
 * 语义（改名引擎侧，逐字取自原头注）：
 *   - def 文件：定义处 + 同文件裸引用
 *   - 同模块文件（package 路径相等）→ 裸引用
 *   - 跨模块文件 → `X.sym` 限定引用（qualifier 末段 == def 模块末段）
 *   - 冻结行保护 + 原子性（任一阻断 → 整体不落盘）
 */
import { makeNamespaceAnalyzer, renameNamespaceSymbol, type NamespaceLangRules, type NamespaceLangSpec } from '../namespace_family.js';
import type { LangPackage, LangRenameArgs, RenameSymbolResult } from '../parts.js';

/** Java 的语法规则（**本语言的全部语法事实**，引擎对此零知识）。 */
const JAVA_RULES: NamespaceLangRules = {
  ext: '.java',
  label: 'Java',
  typeNodes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'annotation_type_declaration'],
  idTypes: ['identifier', 'type_identifier'],
  // ★ 子节点实测：`package_declaration` = `package`(关键字, 匿名) / `scoped_identifier` / `;`
  //   ⇒ 必须按类型挑（盲取第一个会拿到 "package" 这个关键字本身）。
  moduleDecl: { nodeType: 'package_declaration', childTypes: ['scoped_identifier', 'identifier'] },
  // ★ 同上：`import_declaration` = `import`(关键字) / `scoped_identifier` / `;`
  importDecl: { nodeType: 'import_declaration', childTypes: ['scoped_identifier', 'identifier'] },
  qualifiedRefNodes: ['scoped_type_identifier', 'scoped_identifier'],
  moduleScope: {
    parentTypes: ['compilation_unit', 'program'],
    listTypes: ['declaration_list'],
    grandparentTypes: ['namespace_declaration', 'compilation_unit', 'program'],
  },
  /** Java 的模块声明取法：`package a.b.c` */
  moduleOf: (src) => {
    const m = src.match(/^\s*package\s+([\w.]+)/m);
    return m ? m[1] : '';
  },
};

export const analyzeJavaSource = makeNamespaceAnalyzer(JAVA_RULES);

/** 引擎要的完整描述 = 语法规则 + 分析器（分析器由规则造出，故在此拼上） */
const JAVA: NamespaceLangSpec = { ...JAVA_RULES, analyze: analyzeJavaSource };

/** Java 的跨文件符号改名（= 共用引擎 + Java 的完整描述） */
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
