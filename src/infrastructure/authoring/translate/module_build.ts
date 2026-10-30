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

/** 名字 → 定义它的文件（与 `project.ts` 的 `SymbolDef` 结构兼容；`file='__multi__'` = 同名多处定义） */
export interface OwnerEntry {
  file: string;
  isFunc?: boolean;
}

function lookup(
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
  name: string,
): OwnerEntry | undefined {
  return table instanceof Map ? table.get(name) : (table as Record<string, OwnerEntry>)[name];
}

/**
 * 「这个名字由哪个文件提供」——**一处权威**。
 *
 * 返回 null 的两种情形都必须保守：**没有定义**、**同名多处定义（`__multi__`）**。
 * ★ 旧实现是 `modules.find(mm => mm.units.some(u => u.name === name))`：对它而言
 *   49 个跨文件同名 / 5 个跨 kind（如 `GraphCache` = method@builder.go + type@graph_cache.go）
 *   会按 walk 序**挑第一个** ⇒ 可能 import 一个并不导出它的模块（静默错，tsc 报 TS2307/TS2724）。
 */
export function ownerFileOf(
  name: string,
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
): string | null {
  const e = lookup(table, name);
  if (!e || !e.file) return null;
  if (e.file === '__multi__') return null;
  return e.file;
}

/** 语法位置上的字面量/关键字，不算"引用" */
const NOT_REFS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'super', 'new', 'typeof', 'instanceof',
  'in', 'of', 'delete', 'void', 'await', 'yield',
]);

/**
 * 从**最终正文**反查"必须补 import 的名字"。
 *
 * 规则（简单到能一眼判）：
 *   1. 扫正文里的标识符引用（属性名、对象键名不算引用；类型注解里的名字**算**）；
 *   2. 减掉正文里自己声明的名字（形参 / 变量 / 函数 / catch 绑定）；
 *   3. 只留 `defined` 里有、且**不是本文件**、且不是 `__multi__` 的。
 *
 * ★ 为什么第 2 步不能省：缓存体里常有 `const t = new T(...)`，`T` 已在同文件定义，
 *   若把本文件名字也补 import 会造出自环导入。
 */
export function importNamesFromBody(
  body: string,
  table: ReadonlyMap<string, OwnerEntry> | Record<string, OwnerEntry>,
  selfRel: string,
): string[] {
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
  const out: string[] = [];
  for (const name of refs) {
    if (declared.has(name)) continue;
    const owner = ownerFileOf(name, table);
    if (!owner || owner === selfRel) continue;
    out.push(name);
  }
  return out.sort();
}
