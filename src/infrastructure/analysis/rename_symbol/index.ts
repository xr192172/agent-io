/**
 * rename_symbol —— 跨文件符号级改名（重构套件 · 全局符号改名）
 *
 * 把"改一个模块级导出符号"从单文件局部变量升级为跨文件安全改名：
 * 改定义文件里的声明名 + 同文件内对该符号的所有引用（含 export 列表），
 * 并把所有 import 该符号的文件里的 import 子句 + 使用点一并改掉。
 *
 * 范围（本版）：
 *   - TS 系模块级符号：function / const / let / var、class、interface、type alias、enum。
 *     go/.py/java 等跨文件改名留待后版（契约/包改名语义差异大，不混做）。
 *   - 只认直连相对 import（'./x' / '../x'）；经 `export * from` 星号转发的一律阻断
 *     （星号无法按名追改下游，宁漏不误）。
 *
 * 正确性机制（关键）：
 *   - 模块级作用域解析：遍历 AST 建「作用域栈」，根作用域 = 全部模块绑定（声明 + import 说明符），
 *     每个 identifier/type_identifier 沿栈解析到最近的同名绑定；命中根作用域 → 是“模块符号的引用”，
 *     命中非根作用域 → 被局部遮蔽 → 不改（列级安全，与 ast_rename 同哲学）。
 *   - 通过 import/export 说明符的「本地名」与「远程名」区分：无别名才改写使用点；有别名只改 import 子句
 *     里的远程名，使用点（本地别名）不动。
 *   - 值符号（function/const）只改 identifier；类型符号（interface/type）只改 type_identifier；
 *     class/enum 值类型双栖，identifier 与 type_identifier 都改。
 *   - 原子性：任一阻断（新名撞名、星号转发、目标不是模块级符号）→ 全部不落盘，返回理由。
 *
 * ★ 2026（拆分）：原单文件 1920 行按语言拆成：
 *   - `core.ts`：语言无关骨架（编排 + 编辑/解析/收集公共零件 + 共享类型）
 *   - `languages/{types,registry,typescript,go,python,csharp,java,c}.ts`：语言包与注册表
 *   本 `index.ts` 对外再导出**与拆分前逐字相同**的 API。
 */
export { renameSymbol, resolveRel, buildNoExt } from './core.js';
export type {
  RenameEditOp,
  RenameSymbolInput,
  RenameSymbolFileInfo,
  RenameSymbolResult,
} from './core.js';

// ★ 模块级作用域解析已下沉到 infrastructure（2026-10-04，T26）；对外契约不变，仍从这里取用。
export { analyzeModuleSource } from '../../../infrastructure/parse/module_analysis.js';
export type { ImportEdge, ModuleRef, ModuleAnalysis } from '../../../infrastructure/parse/module_analysis.js';

export { analyzeGoSource, renameGoSymbol } from './languages/go.js';
export type { GoModuleAnalysis } from './languages/go.js';

export { analyzePythonSource, renamePythonSymbol } from './languages/py.js';

export { analyzeCSharpSource } from './languages/cs.js';

export { analyzeJavaSource, renameNamespaceSymbol } from './languages/java.js';

export { analyzeCLanguage, renameCSymbol } from './languages/c.js';
