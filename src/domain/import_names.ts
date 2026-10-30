/**
 * import_names —— 「该补哪些 import」的**决策逻辑**（★ T-#IMPORT-NAMES，2026-10-31）
 *
 * ## 为什么它必须住在 domain/ 且**零 import**
 * 这段判断原本埋在 `src/infrastructure/authoring/translate/module_build.ts` 的
 * `importNamesFromBody` 里，与 `import ts from 'typescript'` 同处一个文件 ⇒
 * `behavior-cases` 的 harness 把目标文件**单独转译再 import** 时 load 不了
 * （`目标文件加载失败: Cannot find module 'typescript'`）⇒ 那条护栏只能退化成
 * `source-has`（存在类判据，永远发现不了逻辑错）。
 * ⇒ 把**决策**搬到这里（零依赖、纯函数），让 `__multi__` 不猜 / 不 import 自己 /
 * 已声明的不重复补 这三条能**给输入比输出**；`ts` 的语法扫描留在 `module_build.ts`（薄适配器）。
 *
 * ## 边界（诚实，与搬迁前的实现逐条对齐）
 * · `ownerFileOf` 返回 null 的两种情形都必须保守：**没有定义**、**同名多处定义（`__multi__`）**。
 *   ★ 旧实现是 `modules.find(mm => mm.units.some(u => u.name === name))`：对它而言
 *     49 个跨文件同名 / 5 个跨 kind（如 `GraphCache` = method@builder.go + type@graph_cache.go）
 *     会按 walk 序**挑第一个** ⇒ 可能 import 一个并不导出它的模块（静默错，tsc 报 TS2307/TS2724）。
 * · 这里只**收集名字**，不判断该不该 import（那是 `table` 的事）：
 *   未定义 ⇒ 不管（可能是全局/内置/stdlib）；`__multi__` ⇒ 一律拒（同名冲突不猜）。
 */

/** 名字 → 定义它的文件（`file='__multi__'` = 同名多处定义；也接受裸字符串形态） */
export interface OwnerEntry {
  file: string;
}

/**
 * 「这个名字由哪个文件提供」——**一处权威**。
 *
 * 返回 null 的三种情形都必须保守：**查不到条目**、**条目没有 file**、**同名多处定义（`__multi__`）**。
 * ★ 调用方不许在 null 时"按出现的先后挑一个"——那正是被本函数取代的旧缺陷。
 */
export function ownerFileOf(
  name: string,
  table: Record<string, OwnerEntry | string>,
): string | null {
  const e = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined;
  if (!e) return null;
  const file = typeof e === 'string' ? e : e.file;
  if (!file) return null;
  if (file === '__multi__') return null;
  return file;
}

/**
 * 从「正文里出现的名字」里挑出**必须补 import 的名字**。
 *
 * 规则（简单到能一眼判，逐条对应搬迁前的实现）：
 *   1. 跳过 `declared` 里已有的（形参 / 变量 / 函数 / catch 绑定 —— 再 import 一次会造重复绑定）；
 *   2. `ownerFileOf` 查不到 ⇒ 不补（未定义：可能是全局/内置/stdlib）；
 *   3. `__multi__`（同名多文件、无法判定）⇒ `ownerFileOf` 返回 null ⇒ **不补**（不许按 walk 序瞎挑）；
 *   4. 提供者 === `selfRel` ⇒ 不补（自己提供的名字 import 自己会造自环导入）。
 * 输出顺序 = `refs` 的出现顺序（去重，首次出现位即结果位）。
 * ★ 排序不在这里做：`module_build.ts` 的适配器保留了旧实现的 `sort()`（产物字节必须逐字不变）。
 */
export function pickImportNames(
  refs: readonly string[],
  declared: readonly string[],
  table: Record<string, OwnerEntry | string>,
  selfRel: string,
): string[] {
  const decl = new Set<string>(declared);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of refs) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (decl.has(name)) continue;
    const owner = ownerFileOf(name, table);
    if (!owner || owner === selfRel) continue;
    out.push(name);
  }
  return out;
}
