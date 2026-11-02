/**
 * 语法门 —— `edit_code` 的**唯一**判据与唯一文案产地。
 *
 * ## 为什么这条规则住这里（而不是 edit_code 的五个分支各写一份）
 * 改前每个落盘分支各自写「基线干净 → 编辑后脏才拦」，于是另外两态**一句都没有**：
 * · `.txt` / `.md` 这类**没有解析器**的文件（`parseAstRoot` 回 null ⇒ `hasError` 恒 false）⇒ 永远「✓ 落盘」，
 *   回执里连「没验语法」都不提（读端分不出「验过且干净」与「根本没验」）；
 * · 基线本就脏的文件 ⇒ 改完静默放行，不点名「原本已有 N 处」。
 * 三份实现 = 三处会分叉的真相 ⇒ 本文件是这一条判据的**唯一住处**，`edit_code` 只负责取 AST 读数。
 *
 * ## 三条（不许加第四条）
 * ① 基线干净（`errorCount === 0`）⇒ **阻塞**当且仅当编辑后出现语法错（原阻塞判据一字不改）；
 * ② 基线脏 ⇒ **不拦**，但回执必须点名「原本已有 N 处」（tree-sitter 的错误恢复布局不稳定 ⇒ 不做逐处比对）；
 * ③ `noParser`（ast == null）⇒ **不拦**，但必须说「本次没有验语法」。
 *
 * ★ 纯函数、零 import ⇒ 可被 `behavior-cases` 直喂（`edit_code.ts` 不自包含，金丝雀 harness 跑不起来它）。
 * ★ `SyntaxProbe` 由调用方现取（本文件不碰 fs / AST）：`ast == null ⇒ noParser`；否则数 ERROR / MISSING 节点。
 */

/** AST 侧读数（由调用方现取）。`noParser` 与「干净」是两件事：前者是没跑，后者是跑过且干净。 */
export interface SyntaxProbe {
  /** 该扩展名**没有解析器**（`parseAstRoot` 回 null） */
  noParser: boolean;
  /** tree-sitter 错误恢复节点数（`ERROR` / `MISSING`）：0 = 干净。`noParser` 时恒 0 */
  errorCount: number;
}

/** 门结论 —— 三态都在里面（只回 `blocked` 就把「没验」与「干净」又混成一个假绿）。 */
export interface SyntaxGateVerdict {
  /** 非 null ⇒ 阻塞（**唯一**阻塞条件：基线干净 + 编辑后脏）。内容即抛给人看的整句 */
  blocked: string | null;
  /** 必须进 `data.warnings` + 人读回执的读数（基线脏 / 无解析器）；干净基线为空 */
  warnings: string[];
  /** 基线脏 → 编辑后干净（顺手修好了） */
  repaired: boolean;
}

/** 阻塞句的公共头：各 op 只在尾部补自己的 `blockHint`（同一句话不许有五个版本） */
export const SYNTAX_BLOCK_HEAD = '编辑引入了语法错误（hasError false→true），已放弃（未写盘）。';

/** ③ 无解析器：**没验**必须说出来 —— 否则 `.txt` / `.md` / 未知扩展的合法编辑会被这条门当成「验过」 */
export function syntaxNoParserNote(ext: string): string {
  return `语法门未执行（${ext} 无解析器），本次没有验语法`;
}

/** ② 基线脏：点名条数 + 说清本门不做逐处比对（否则读端以为逐处核对过） */
export function syntaxDirtyNote(errorCount: number): string {
  return (
    `语法门：该文件原本已有 ${errorCount} 处语法错；本次改动未修复也未新增` +
    '（基线脏时 tree-sitter 的错误恢复布局不稳定，本门不做逐处比对）'
  );
}

/**
 * 语法门：给三个读数，回三态结论。**所有通路共用这一份**。
 * @param ext 文件扩展名（人读用，如 `.txt`；无扩展名时调用方传「（无扩展名）」）
 * @param blockHint 阻塞句的尾部（各 op 自己的「请检查 new_text / code …」）
 * @param blockHead 阻塞句的头（新建文件那条措辞不同 ⇒ 留参数；缺省 = {@link SYNTAX_BLOCK_HEAD}）
 */
export function judgeSyntaxGate(
  ext: string,
  before: SyntaxProbe,
  after: SyntaxProbe,
  blockHint: string,
  blockHead: string = SYNTAX_BLOCK_HEAD,
): SyntaxGateVerdict {
  // ③ ast==null：根本没跑 ⇒ 不拦 + 必须说（放最前：它比「跑了有错」更该先说）
  if (before.noParser || after.noParser) {
    return { blocked: null, warnings: [syntaxNoParserNote(ext)], repaired: false };
  }
  // ① 基线干净：保留原阻塞判据，一字不改
  if (before.errorCount === 0) {
    return after.errorCount > 0
      ? { blocked: `${blockHead}${blockHint}`, warnings: [], repaired: false }
      : { blocked: null, warnings: [], repaired: false };
  }
  // ② 基线脏：不拦，但必须点名 —— 修好了就说修好了（仍写「未修复」是假读数）
  return after.errorCount === 0
    ? {
        blocked: null,
        warnings: [`语法门：该文件原本已有 ${before.errorCount} 处语法错，本次改动已修复（编辑后 hasError=false）`],
        repaired: true,
      }
    : { blocked: null, warnings: [syntaxDirtyNote(before.errorCount)], repaired: false };
}
