/**
 * ★★★ 2026-10-28（T150）：**`symbol_diff` 的作用域是文件，不是条目** —— 归位它在回执上的位置。
 *
 * ## 复现出来的账实不符（重复记账）
 * 同一文件 2 项 `replace_text` ⇒ 逐项都报 `{added:1,removed:0,changed:1}`，加起来 `added 2 / changed 2`，
 * 而实况是 `added 1 / changed 1`。**不是算了两遍，是文件级读数被挂到了每一条目上**。
 *
 * ## 判据（本文件就是判据，且是**叶子模块**：零依赖 ⇒ 判据执行核能直接加载它）
 * · `files`：**每个文件一条**（按文件名排序）—— 文件的 diff，唯一出处；
 * · `perItem[i]`：**只有该文件在整批里只出现一次时**才带 diff；否则 `null`（不重复记账）。
 *
 * ★ 为什么随机条目不是"一律不给"：单文件单项是最常见形态，那时条目带 diff 是**准确**的、也更方便；
 *   抽掉的只是**会造成重复计数**的那种（同文件多项）。
 * ★ 为什么住 `domain/`：它是纯函数（入参出参全是 JSON 形状，零 import）——
 *   判据（`behavior-cases`）要靠执行核 `runHarness` 加载目标文件，深依赖的文件加载不了（实测）。
 */

export interface SymbolDiff {
  added: number;
  removed: number;
  changed: number;
}

export interface BatchDiffReport {
  files: Array<{ file: string; symbol_diff: SymbolDiff }>;
  perItem: Array<SymbolDiff | null>;
}

/**
 * @param diffByFile 文件 → 该文件的符号 diff（来自各自的 `syncFile`，**文件级事实**）
 * @param itemFiles  逐项所属文件（与回执里的 `items[]` 一一对应）
 */
export function planBatchDiffReport(diffByFile: Record<string, SymbolDiff>, itemFiles: readonly string[]): BatchDiffReport {
  // ★ 输出**规范化**：键序固定为 added/removed/changed（否则 repr 跟着入参键序变 ⇒
  //   同一条读数在判据里时对时错 —— 实测被 `behavior-cases` 抓到）
  const norm = (d: SymbolDiff): SymbolDiff => ({ added: d.added, removed: d.removed, changed: d.changed });
  const files = Object.keys(diffByFile)
    .sort()
    .map((file) => ({ file, symbol_diff: norm(diffByFile[file]) }));
  const occurrences = new Map<string, number>();
  for (const f of itemFiles) occurrences.set(f, (occurrences.get(f) ?? 0) + 1);
  const perItem = itemFiles.map((f) => {
    const d = diffByFile[f];
    if (!d) return null;
    // 只有"该文件在整批里唯一出现"时，条目级读数才不构成重复记账
    return (occurrences.get(f) ?? 0) === 1 ? norm(d) : null;
  });
  return { files, perItem };
}
