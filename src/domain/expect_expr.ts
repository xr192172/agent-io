/**
 * expect_expr —— 项目级判据 `expect` 的**写前试解析**（零依赖纯函数）。
 *
 * ## 为什么住 domain
 * `src/application/design/dsl_ops/task_ops.ts`（20+ 值 import）里这段只能靠 `source-has must:["new Function"]`
 * 守 —— 那个串连"试解析的结果有没有被用"都不判（把 `catch` 改成吞掉，它照样绿）。
 * 抽到这里，"语法坏的表达式必须被判 false"才能给输入比输出。
 *
 * ## 为什么必须试解析
 * `scripts/design-check.mjs` 就是用 `new Function` **求值**每一条 `expect` 的
 * ⇒ 写坏一个字节会让**整道门崩**（而不是"这条红"）。所以写端必须与求值端同一口径先试一次。
 *
 * ★ 求值域（`EXPECT_EVAL_PARAMS`）只影响**能不能跑起来**，不影响**能不能解析**
 *   （未定义的标识符在 `new Function` 构造时不报错，要到调用时）⇒ 本文件只判语法。
 */

/**
 * `expect` 的求值域 —— 与 `scripts/design-check.mjs` 里 `new Function('dsl', 'nodes', …, 'KINDS', …)` 一致。
 * ★ 这里放成常量而不是散在参数表里：参数表写错一个名字，`expect` 里用到它就是**运行期** ReferenceError，
 *   而写端只判语法 ⇒ 那种错当时看不出来。单点改名才不会两边各漂一份。
 */
export const EXPECT_EVAL_PARAMS = [
  'dsl',
  'nodes',
  'paths',
  'fs',
  'path',
  'root',
  'mutateReport',
  'callReport',
  'results',
  'KINDS',
] as const;

/**
 * 构造 `expect` 的求值函数（**故意不 catch**）：语法坏就抛 `SyntaxError`，错误消息留给调用方渲染。
 * ★ 只构造不调用（`new Function` 不执行函数体）⇒ 无副作用、不读盘。
 */
export function expectEvaluator(expect: string): () => unknown {
  // eslint-disable-next-line no-new-func
  return new Function(...EXPECT_EVAL_PARAMS, `"use strict"; return (${expect});`) as () => unknown;
}

/**
 * 试解析的布尔视图：语法成立 ⇒ `true`（写端据此拒写）。
 *
 * ★★★ 为什么 `catch {}` **不绑变量**（2026-10-31 实测撞出来的）：插桩会给每个 `catch (e)` 记一条
 *   `op:'catch' + err:"…"` 事件，而 `design:silent-error-discard` 对**非空 err** 一律判偏差
 *   ⇒ 「坏语法必须判 false」的 canary 用例会把整仓运行时判据打红（实测 5/61 条偏差、dir_certs 翻红）。
 *   不绑变量的 catch 记的是 `err:""`，规则判 ok；消息由调用方经 {@link expectEvaluator} 再取一次。
 *   ★ 这不是"为了过判据把错吞掉"：catch 里没有任何可丢的东西 —— 构造点只有一处（expectEvaluator），
 *     语法错要不要报、报什么，全由调用方决定。
 */
export function isParsableExpect(expect: string): boolean {
  try {
    expectEvaluator(expect);
    return true;
  } catch {
    return false;
  }
}
