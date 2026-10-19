/**
 * mutants —— 从 parse 的**树**里抽【可变异点】（运算符级）
 *
 * ## 为什么要它
 * 实现层变异（`===` → `!==`）需要一个「源码里哪个位置可以改」的清单。
 * 此前只能用正则找 `===` —— 而**注释和字符串里的 `===` 也会命中**，改了就炸。
 *
 * ## ★ 关键事实（2026-10-20 实测）
 * 树**本来就是现成的**：`parseFileFull` 每次解析都拿到 `tree`，只是抽完 4 类
 * （symbols / imports / calls / type_refs）就把树丢了 —— `binary_expression` 在 `kernel.ts` 里**出现 0 次**。
 * ⇒ 这里**不重新 parse**：走 `parseTreeForFile`（同一个 parser、同一棵树）。
 *
 * ## 边界（如实写，不假装全语言）
 * - 节点名 `binary_expression` 是 **tree-sitter-javascript / typescript 的叫法**。
 *   Go 是 `binary_expression`（同）、Python 是 `comparison_operator` —— **要给各自一张表**。
 *   ⇒ 本文件**只做 TS**；其他语言要新增一条映射，不是"自动支持"。
 * - 只抽**比较运算符**（`===` / `!==` / `==` / `!=`）。逻辑运算符（`&&` / `||`）、
 *   常量（`0` / `''`）、返回值，都是后续的变异算子，本版不做。
 * - ★ 不动 `ParsedFile` 的契约（那面有 550 个消费者）—— 这是一个**独立函数**。
 */
import { parseTreeForFile } from './kernel.js';

/** 一个可变异点 */
export interface Mutant {
  /** 变异算子名（目前只有这一种） */
  op: 'swap-comparison';
  /** 1-based 行号 */
  line: number;
  /** 原文（运算符本身） */
  from: string;
  /** 变异后 */
  to: string;
  /** 字符偏移：`content.slice(startIndex, endIndex)` **正好是 `from`** */
  startIndex: number;
  endIndex: number;
}

/**
 * 比较运算符的互换表。
 * ★ 只有 `=== ↔ !==` / `== ↔ !=` 是**语义翻转**；`>` / `<` 之类要换方向，本版不做。
 */
const COMPARISON_SWAPS: Record<string, string> = {
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
};

/** tree-sitter 节点的最小面（避免依赖具体版本的类型） */
interface NodeLike {
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: { row: number };
  children?: NodeLike[];
}

/**
 * 抽可变异点（**只读**，不改任何文件）。
 *
 * ★ 返回的顺序按**源码出现顺序**（前序遍历天然如此），便于"第 N 个变异体"可复现。
 */
export async function extractMutants(filePath: string, content: string): Promise<Mutant[]> {
  const parsed = await parseTreeForFile(filePath, content);
  if (!parsed) return [];

  const out: Mutant[] = [];
  const walk = (n: NodeLike | undefined): void => {
    if (!n) return;
    // ★ 只有二元表达式的**直接子节点**才可能是运算符 —— 不在全树里盲搜 `===`
    if (n.type === 'binary_expression') {
      for (const c of n.children ?? []) {
        const swap = COMPARISON_SWAPS[c.type];
        if (!swap) continue;
        out.push({
          op: 'swap-comparison',
          line: c.startPosition.row + 1,
          from: c.type,
          to: swap,
          startIndex: c.startIndex,
          endIndex: c.endIndex,
        });
      }
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(parsed.root as unknown as NodeLike);
  return out;
}

/**
 * 把某个变异点应用到内容上（纯函数，**不写盘**）。
 * ★ 用 `slice` 按偏移替换，不用 `String.replace`（后者会命中**所有**出现处）。
 */
export function applyMutant(content: string, m: Mutant): string {
  return content.slice(0, m.startIndex) + m.to + content.slice(m.endIndex);
}
