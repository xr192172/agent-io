/**
 * behavior_compare —— `behavior-cases` 判据的**比对核**（零依赖纯函数）。
 *
 * ## 为什么住 domain
 * `src/application/design/intent/expectations.ts` 里它是 `judgeExpectations` 内的一个闭包 `same`，
 * 那个文件有 9 个值 import ⇒ harness 单独转译 load 不了 ⇒ 这条决策**只能**写成
 * `source-has must:["typeof v === 'object') return false"]`（存在类：删了这个分支它绿，改了语义它也绿）。
 * 抽到零依赖文件后，任何"容器被 String() 兜底"的退化都会当场翻红。
 *
 * ## 口径（与抽取前逐字一致）
 * `ret` 是 harness 的**规范化 repr**（字符串带引号 / 对象是 JSON / 标量是裸串）：
 *   ① repr 精确相等 ⇒ 一致（`expect` 本就写成 repr 形态时走这条）；
 *   ② repr 不是 JSON ⇒ 只能靠 ①（返回 false，不猜）；
 *   ③ ★ **容器（对象 / 数组）只许精确 repr 相等**：repr 已经对不上了，容器再走 `String()` 会退化成
 *      `[object Object]` / `1,2` ⇒ `expect:"[object Object]"` 对**任意**对象数组输出都 PASS
 *      （2026-10-30 D4 实测假绿）。**只有标量**（数字 / 布尔 / null / 字符串）才走裸串口径。
 */
export function sameBehaviorRet(ret: string, expect: string): boolean {
  if (ret === expect) return true; // expect 本就写成 repr 形态（如 "5" / "true" / "{\"a\":1}"）
  let v: unknown;
  try {
    v = JSON.parse(ret);
  } catch {
    return false; // ret 不是 JSON ⇒ 只能靠上面那条精确相等
  }
  if (v !== null && typeof v === 'object') return false;
  return String(v) === expect;
}
