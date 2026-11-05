/**
 * comments.ts —— ★ **按 AST 取"注释"的区间**（T212）。
 *
 * ## 为什么需要它（★ 一个真缺陷逼出来的）
 * ★ 边界问题：这些都要依靠夹具吗？不能靠解析来解决吗？AST 的极限已经到了吧？
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
 * ## ★★★ 状态：**已跑通、已接通**（2026-10-13 当轮修好）
 * · ★★ **曾经的卡点是我自己的错**：探针把快照名叫 **`mixed.ts.orig`** ⇒ `split('.').pop()` = `orig`
 *   ⇒ ★ 判不出语言 ⇒ ★ **零件如实回 `null`（"没查成"）** ✓ —— ★ 而**它本来就该这么办**（★ 假装"没有注释"才是错的 ✓）
 * · ★ 真 `.ts` 结尾下实测：★ **注释区间 8 个** · ★ **剔注释后只剩声明处第 26 行**、
 *   ★ 42/43 行那两处**注释里的提及被剔掉** ✓✓ ⇒ ★ **AST 分得开、正则分不开** ✓
 * · ★★ **教训**：★ "零件回 null"**不等于**"零件坏了" —— ★ 它可能是**调用方给错了输入** ✓
 *   （★ 而**两种"没结果"长得一样** ⇒ ★ 所以口径必须区分：`null` = 没查成 · `[]` = 真的一条都没有 ✓）
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
// ★★★ 2026-11-04（subagent:text-has-fix）：注释定型的**第二条判据**住 domain
//   （`infrastructure → domain` 是允许的方向；反过来会让 domain 依赖 tree-sitter）。
//   为什么需要它：`type === 'comment'` **不够** —— 本仓 tree-sitter 会把 interface / type 体内的注释
//   **错定型成父节点类型**（零子节点、文本就是那段注释），实测 geometry.ts 的 121 个注释只采到 24 个。
import { looksLikeCommentSpan } from '../../domain/text_strip.js';

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
  /** 这个节点**是不是一段注释**（两条判据，缺一条就漏 80%） */
  const isCommentNode = (n: { type?: string; startIndex?: number; namedChildren?: unknown[]; children?: unknown[] }, kids: readonly unknown[]): boolean => {
    // ① 类型名像 comment —— 绝大多数位置走这条（top-level / 类体 / 函数体 / 行尾）
    if (/comment/i.test(String(n.type ?? ''))) return true;
    // ② 叶子 + 文本头两字符是 `//` 或 `/*` —— 兜住"错定型"那一档：
    //    本仓 tree-sitter 把 `interface` / `type` 体内的注释切成**零子节点的父类型节点**
    //    （实测 `src/domain/geometry.ts`：121 个 `/**` 只采到 24 个）。判据住 domain 的
    //    `looksLikeCommentSpan`（零依赖、双向用例在 `tests/p0_text_assertions.test.ts`）。
    if (kids.length > 0) return false;
    const head = content.slice(n.startIndex ?? 0, (n.startIndex ?? 0) + 2);
    return looksLikeCommentSpan(head);
  };
  const walk = (n: { type?: string; startIndex?: number; endIndex?: number; namedChildren?: unknown[]; children?: unknown[] }): void => {
    const kids = (n.namedChildren ?? n.children ?? []) as Array<typeof n>;
    if (isCommentNode(n, kids)) {
      out.push({ start: n.startIndex ?? 0, end: n.endIndex ?? 0 });
      // ★ 注释节点不再往里走（★ 里面不会有"引用" ✓）
      return;
    }
    for (const c of kids) walk(c);
  };
  walk(root as Parameters<typeof walk>[0]);
  return out;
}

/**
 * ★★ **我是哪一种权威**（2026-11-05 · R6 · 0.9.1④ 的分工声明，后来者照这一句选）：
 *   本函数是**整文件权威** —— 它吃 `filePath` + `content`，按 **AST 注释区间**剔注释
 *   （字符串字面量、Go raw string 里的 `//` 天生不会被吃；块注释里的换行保留 ⇒ 行号仍对得上）。
 *   输入**没有 filePath** 的那种情况（类型表达式 / 形参 / 单行 / 函数体片段）**不走它**，走
 *   **片段权威** `src/domain/text_strip.ts#stripComments`。
 *   ⇒ 两条按「输入里有没有 filePath」分工，**不许写第三份**（全仓曾有 9 处私有剥离实现，R6 已收归）。
 *
 *   ★ 它覆盖哪些语言：走 kernel 的都覆盖（实测 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs/.go/.py/.java`
 *     都给出区间且等长；`.md` / 无扩展名 ⇒ `null`）。**Go 是覆盖的** —— 这是 R6 把
 *     `dead_deps.ts#stripGoCommentishLines` 也收归过来的依据（旧 Go 专版实测漏剥真块注释）。
 *
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
