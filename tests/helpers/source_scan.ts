/**
 * tests/helpers/source_scan.ts —— 「在源码里数某个模式」的**共享判定**（唯一实现）
 *
 * 由来：G4（`tests/single_source.test.ts`）先有了这套判定（跳过注释行后按字面模式计数）。
 * 新的 lane 无 IO 门（`tests/registry/lane_no_io.test.ts`）需要**同一个**判定，
 * 按本仓纪律"同一份知识只有一处落点"抽到这里 —— 两份各一套必然分叉
 * （而"门与门之间判据分叉"正是这个项目反复吃到的病）。
 *
 * ★ 为什么必须跳过注释行：第一版按全文件裸扫，G4 立刻在**自己的注释里**命中
 *   （`rename_symbol.ts:179` 逐字引用了被修掉的那条旧正则）。注释里引用旧代码/旧 API 是**好实践**
 *   （它记录了"这里曾经错过"），门不该惩罚它。
 * ★ 已知限度（如实记下）：只做**按行的注释判定**，不做完整词法分析 ⇒
 *   行尾注释（`code(); // readFileSync`）与字符串字面量里的命中**仍会被计数**。
 *   宁严勿松；真被误伤时把该文件加进对应门的 `frozen`/`allow` 并写明理由。
 */

/** 注释行判定：`// …` / `* …`（JSDoc 中行）/ `/* …` —— 跳过 */
export function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * 把源码里的注释行**置空**（不是删行 —— 保留换行，使跨行的模式/正则仍能匹配），
 * 再统计模式出现次数。纯函数，可单测。
 */
export function countOccurrences(src: string, pattern: string): number {
  if (!pattern) return 0;
  const blanked = src
    .split('\n')
    .map((l) => (isCommentLine(l) ? '' : l))
    .join('\n');
  let n = 0;
  let i = 0;
  while ((i = blanked.indexOf(pattern, i)) >= 0) {
    n += 1;
    i += pattern.length;
  }
  return n;
}

/**
 * 跳过注释行后，按**正则**找出全部命中（返回 1-based 行号 + 行文本）。
 * 供"要报出在哪一行红了"的门用（只给计数的话，红的时候还得自己再找一遍）。
 */
export function findCodeMatches(src: string, re: RegExp): Array<{ line: number; text: string }> {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  const out: Array<{ line: number; text: string }> = [];
  src.split('\n').forEach((l, i) => {
    if (isCommentLine(l)) return;
    rx.lastIndex = 0;
    if (rx.test(l)) out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}
