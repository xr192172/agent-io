/**
 * module_build —— 一个模块的「事实 → 文本」出口（★ T-#PIPELINE-ONE-PLACE，2026-10-30）
 *
 * ## 它补的是什么洞
 * `project.ts` 里"算导入 / 生成正文 / 拼 m.ts / 改写后补 import"四件事原本分散在三个作用域，
 * 而且**文件行号顺序与执行顺序相反**（算导入 ~L751 → 装配 ~L1089 → 拼 ts ~L450 → 事后补刀 ~L1095）。
 * 实测后果：事后补刀那段晚于 `m.ts` 的唯一赋值点 ⇒ 对产物**完全无效**；
 * `INTRODUCED_BY_MODULE` 在 ~L797 读、在 ~L348 写，而 ~L348 执行得更晚 ⇒ 永远读到空集；
 * 册子字段名那段写进 `m.imports`，被 `m.imports = imports` 整体覆盖。
 * ⇒ 产物里 `NremReplay_SetDreamSender(...)` 只有 `import { NremReplay }`：实测 **101 条 TS2304 / 60 个名字**。
 *
 * ## 为什么"晚到名字"必须从正文反查（上一轮三次尝试失败的真根因）
 * 回放缓存里的函数体**已经是改写过的**（`b.AddFix(x)` 在上一次填孔时就变成了 `Builder_AddFix(b, x)`）。
 * ⇒ 本次 `rewriteMethodCalls` 看不到方法调用 ⇒ 它回报的 `introduced` **恒为空**。
 * 所以"还要补哪些 import"只能从**最终正文**里读：正文标识符 ∩ `defined`（排除本文件）。
 *
 * ## 边界（诚实）
 * · 这里只**收集名字**，不判断该不该 import（那是 `defined` 的事）：
 *   未定义 ⇒ 不管（可能是全局/内置/stdlib）；`__multi__` ⇒ 一律拒（同名冲突不猜）。
 * · 只做**语法级**扫描（TS 解析器），不做类型推断 ⇒ 宁多勿漏，多出来的由 `defined` 过滤。
 */
import ts from 'typescript';
import { ownerFileOf as ownerFileOfInTable, pickImportNames } from '../../../domain/import_names.js';

/** 名字 → 定义它的文件（与 `project.ts` 的 `SymbolDef` 结构兼容；`file='__multi__'` = 同名多处定义） */
export interface OwnerEntry {
  file: string;
  isFunc?: boolean;
}

/**
 * 把 `Map` / `Record` 两种入参统一成「名字 → 文件路径」的 `Record`。
 * ★ 形态转换**留在这个适配器里**：域函数（`src/domain/import_names.ts`）只吃 `Record` ——
 *   它必须零依赖才能被 `behavior-cases` 的 harness 直接跑（`import ts` 会让它 load 不了）。
 * ★ 这是纯形态转换，**不参与判断**：查不到 / `__multi__` / 自供 的裁决全在域函数里。
 */
function ownerRecordOf(
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (table instanceof Map) {
    for (const [name, e] of table) out[name] = e.file;
  } else {
    const rec = table as Record<string, OwnerEntry>;
    for (const name of Object.keys(rec)) out[name] = rec[name].file;
  }
  return out;
}

/**
 * 「这个名字由哪个文件提供」—— **薄适配器**：判断全在
 * `src/domain/import_names.ts#ownerFileOf`（未定义 / 空 file / `__multi__` ⇒ null，不许按出现顺序瞎挑）。
 * ★ 导出签名与搬迁前逐字相同（`ReadonlyMap | Record` 入参）⇒ `project.ts` 的调用点不动。
 */
export function ownerFileOf(
  name: string,
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
): string | null {
  return ownerFileOfInTable(name, ownerRecordOf(table));
}

/** 语法位置上的字面量/关键字，不算"引用" */
const NOT_REFS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'super', 'new', 'typeof', 'instanceof',
  'in', 'of', 'delete', 'void', 'await', 'yield',
]);

/**
 * 语法扫描（这一半**必须**留在基础设施侧：它要 `ts`）。只收集两个名单，**不做任何判断**：
 *   · `refs` —— 正文里出现的标识符引用（属性名、对象键名不算引用；类型注解里的名字**算**）；
 *   · `declared` —— 正文里自己声明的名字（形参 / 变量 / 函数 / catch 绑定）。
 * ★ 为什么 `declared` 不能省：缓存体里常有 `const t = new T(...)`，`T` 已在同文件定义，
 *   若把本文件名字也补 import 会造出自环导入。
 */
function scanBody(body: string): { refs: string[]; declared: string[] } {
  const sf = ts.createSourceFile('__body.ts', body, ts.ScriptTarget.ES2022, true);
  const declared = new Set<string>();
  const refs = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text);
    if (ts.isCatchClause(node) && node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)) {
      declared.add(node.variableDeclaration.name.text);
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression); // 属性名不是引用（`b.retrievers` 里的 retrievers 不查）
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer); // 对象字面量的键不是引用
      return;
    }
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      const isDeclName =
        (ts.isVariableDeclaration(p) && p.name === node) ||
        (ts.isParameter(p) && p.name === node) ||
        (ts.isFunctionDeclaration(p) && p.name === node);
      if (!isDeclName && !NOT_REFS.has(node.text)) refs.add(node.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { refs: [...refs], declared: [...declared] };
}

/**
 * 从**最终正文**反查"必须补 import 的名字"—— **薄适配器**。
 *
 * 决策（跳过已声明 / 提供者是本文件 / `__multi__` 不猜）全在
 * `src/domain/import_names.ts#pickImportNames`（零依赖 ⇒ 那 3 条语义由 7 条 `behavior-cases` 现跑判）。
 * ★ `.sort()` 留在这一层：搬迁前的实现输出是**排序后**的数组，而下游 `assembleModule` 按
 *   owner 首次出现的顺序拼 import 行 ⇒ 顺序一变产物字节就变（本次是纯重构，产物必须逐字不变）。
 * ★ 导出签名与搬迁前逐字相同 ⇒ `project.ts:363` 的 `importNamesFromBody(body, defined, m.rel)` 不动。
 */
export function importNamesFromBody(
  body: string,
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
  selfRel: string,
): string[] {
  const { refs, declared } = scanBody(body);
  return pickImportNames(refs, declared, ownerRecordOf(table), selfRel).sort();
}
