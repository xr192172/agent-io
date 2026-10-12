/**
 * comments.ts —— ★ **按 AST 取"注释"的区间**（T212）。
 *
 * ## 为什么需要它（★ 用户的问题逼出来的）
 * 用户问：*"这些的话都要依靠夹具吗？不能靠解析来完成问题解解决问题吗？**就是说 AST 的极限已经达到了是吧？**"*
 * ⇒ ★ 实测给出的答案是：★ **不是 AST 的极限，是"用正则冒充 AST"的极限** ✓
 *
 * ### 实测（探针 `.inspect/t212-ast-vs-regex.mjs`、夹具 `.inspect/t205-fixture`）
 * `derive_split.ts` 的 `referNames(text, names)` 用正则 `\b<name>\b` 判"某符号有没有被引用" ⇒
 * ★ 而原文里 `formatMoney` 出现 4 处，其中 **2 处在注释里**：
 * ```
 * // ── 旧世代（★ 与 formatMoney 并存 …）            ← ★ 注释里的【提及】✗
 * /** @deprecated … 新代码请用 formatMoney。 *​/    ← ★ 注释里的【提及】✗
 * ```
 * ⇒ ★★ 正则**分不开"注释里的提及"与"真的引用"** ⇒ 于是给原文件加了一条**死 import** ✓
 *
 * ## ★★★ 状态：**零件已写好、但【还没接通、也还没验通】**（2026-10-13）
 * · ★ **编译过** ✓ · ★ **没有任何调用方** ✓（⇒ 留着**无害**，不会改变任何现有行为 ✓）
 * · ★★ **但没跑通**：探针里 `commentRangesSync` **回的是 `null`（"没查成"）**，★ 即使 `await prewarmKernel()` 之后也是 ✓
 *   ⇒ ★ **卡点**：`loader.ts` 的 `parserCache` 只在**异步** `getParser` 里写（`loader.ts:115`）⇒
 *     ★ **`prewarmKernel()` 到底有没有把每种扩展名走到那一步，我没验** ✓
 *   ★★ **如实记**：我在这一步**停手了** —— ★ 因为**接进 `referNames` 之前必须先把它跑通**，
 *     否则就是"**看起来对、但没验过**"的改动 ✗（★ 本仓最反对的那类 ✓）
 * ⇒ ★ **下一步（谁接都能做）**：★ 先查 `prewarmKernel()` 是否真填了 `parserCache`（★ 一个探针即可）；
 *   ★ 填了 ⇒ 我这层有 bug；★ 没填 ⇒ 在**预热**那层补 ✓
 *
 * ## 本文件给的是什么（★ 只给一件事）
 * ★ **`commentRangesSync(filePath, content)`** ⇒ ★ **注释在正文里的区间**（`start`/`end` 偏移）✓
 * ★★ 它的来源是 **AST 的注释节点**（不是"找 `//` 到行尾"那种正则猜法 ⇒ ★ 字符串里的 `//` 不会误伤 ✓）
 *
 * ## 边界（★ 如实写清）
 * · 拿不到解析器（未预热 / 该扩展名不支持）⇒ ★ **返回 `null`**（★ **不是空数组** ——
 *   ★ 空数组的意思是"这份正文里一条注释都没有"，★ 与"没查成"是**两件事** ✓ 同本仓一贯口径 ✓）
 * · 只覆盖 **TS/JS/Go/Python** 等走 kernel 的语言（★ 别的扩展名 ⇒ `null` ✓）
 */
import { parseContent } from './kernel.js';
// ★ 注意这两个**不在 kernel 里**（★ 我第一次就写错了模块）：`getParserSync` 在 `loader.ts`、
//   `isExtSupported` 在 `probe.ts` ✓ —— ★ 记一笔：**别凭印象写 import 路径** ✓
import { getParserSync } from './loader.js';
import { isExtSupported } from './probe.js';

export interface Range {
  start: number;
  end: number;
}

/**
 * ★ 取该文件的**注释区间**。
 * @returns ★ 区间数组（**可能为空** = 真的一条注释都没有）；★ **`null` = 没查成**（解析器没就绪 / 语言不支持）
 */
export function commentRangesSync(filePath: string, content: string): Range[] | null {
  const ext = '.' + (filePath.split('.').pop() || '');
  if (!isExtSupported(ext)) return null;
  const parser = getParserSync(ext);
  if (!parser) return null;

  let tree: { rootNode?: unknown };
  try {
    tree = parseContent(parser, content) as { rootNode?: unknown };
  } catch {
    // ★ 解析失败 ⇒ **说"没查成"**（`null`），★ 不假装"没有注释" ✓
    return null;
  }
  const root = (tree as { rootNode?: unknown }).rootNode;
  if (!root) return null;

  const out: Range[] = [];
  const walk = (n: { type?: string; startIndex?: number; endIndex?: number; namedChildren?: unknown[]; children?: unknown[] }): void => {
    const t = String(n.type ?? '');
    if (/comment/i.test(t)) {
      out.push({ start: n.startIndex ?? 0, end: n.endIndex ?? 0 });
      // ★ 注释节点不再往里走（★ 里面不会有"引用" ✓）
      return;
    }
    const kids = (n.namedChildren ?? n.children ?? []) as Array<typeof n>;
    for (const c of kids) walk(c);
  };
  walk(root as Parameters<typeof walk>[0]);
  return out;
}

/**
 * ★ 把注释**从正文里剔掉**（★ 用 AST 区间，★ 不用正则找 `//`）—— ★ 保留偏移位置（用空格填补 ✓）
 * ⇒ ★ 于是"这段正文里还有没有 `<name>` 这个标识符"就是一个**可信**的问题 ✓
 *
 * @returns ★ 剔掉注释后的正文；★ 或 **`null`（没查成）** ⇒ ★ 调用方**必须**据此**决定降级还是停手**，
 *   ★★ 不许"拿没剔的正文当剔过的用"（★ 那是"没报错的错" ✓）
 */
export function stripCommentsSync(filePath: string, content: string): string | null {
  const ranges = commentRangesSync(filePath, content);
  if (ranges === null) return null;
  if (ranges.length === 0) return content;
  // ★ 从后往前替换（★ 否则前面的替换会让后面的偏移失效 —— 经典坑 ✓）
  let out = content;
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    // ★ 用等长空白替换 ⇒ **偏移与行号不变**（★ 下游若要行号仍对得上 ✓）
    out = out.slice(0, r.start) + out.slice(r.start, r.end).replace(/[^\n]/g, ' ') + out.slice(r.end);
  }
  return out;
}
