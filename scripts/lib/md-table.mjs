/**
 * md-table —— **markdown 表格的唯一解析实现**（AGENTS.md **0.18④**：结构载体不许文本切分）
 *
 * ## 为什么必须是"一个专用模块"，而不是就地 `split('|')`
 * 表格是**结构**（行列 + 转义），不是文本。就地切分会犯三种错，**每一种都是静默的**：
 *   ① 转义竖线 `\|` 被当成分隔符 ⇒ 列数虚高。实测（2026-11-05）：`docs/RETIRED.md` 台账某行
 *      的单元格里**逐字引用**了判据串 `'| 开发动作'` ⇒ 那行只有 6 列，临时切分却数成 7 列；
 *   ② 行尾省略闭合 `|` 的行（GFM 允许）被多算一列；
 *   ③ 单元格里换行（多行内容）被当成两行 ⇒ 后面每一行的列数都错位。
 * ⇒ 本模块是仓里**唯一**一处做这件事的地方。复核口径（2026-11-05）：
 *   `scripts/` / `src/` / `tests/` 里**没有**第二份 markdown 表格解析 —— `split('|')` 的 4 处命中
 *   （`reconcile_effects.ts` / `analyze_monolith.ts` / `monolith.ts` / `behavior/index.ts`）都是
 *   **管道分隔协议**（键与采样行），不是 md 表格。新需求改这里，**别在旁边再写一个**。
 *
 * ## 边界（拒什么；不假装支持什么）
 * · 只认**首字符是 `|`** 的行（本仓 md 全用带首竖线的形态）；不带首竖线的行**不当表格行**，
 *   由调用方按"普通行"处理（不猜"这一行是不是表格"）；
 * · **逐行处理，绝不跨行拼接** ⇒ 一格里有换行时，那一行会被算成"列数不足"而**红**
 *   —— 这正是 0.18④ 要的"拒多行内容"，不是"支持多行"；
 * · 转义判定按**反斜杠个数奇偶**：`\|` 是字面竖线；`\\|` 里的竖线**算**分隔符（转义已被吃掉）。
 *   只写 `(?<!\\)` 会把 `\\|` 也排除掉（差一个反斜杠就漏）；
 * · **不做语义校验**（"对齐行必须是 `---`"、"表头文字对不对"）—— 那是调用方的判据，
 *   本模块只回答"这一行有几格、格里的原文是什么"。
 */

/**
 * 一行里**未转义**的竖线下标。
 * @param {string} s
 * @returns {number[]}
 */
function unescapedPipeIndexes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '|') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) out.push(i); // 偶数个反斜杠 ⇒ 这个竖线没被转义
  }
  return out;
}

/**
 * 切一行表格 ⇒ 单元格原文数组（trim 过，反斜杠转义**原样保留**）；
 * **不是表格行**（首字符不是 `|`，空行亦然）⇒ `null`。
 * @param {string} line
 * @returns {string[] | null}
 */
export function splitRow(line) {
  const trimmedRight = String(line ?? '').replace(/\s+$/, '');
  const s = trimmedRight.replace(/^\s+/, '');
  if (!s.startsWith('|')) return null;
  const body = s.slice(1);
  const parts = [];
  let last = 0;
  for (const i of unescapedPipeIndexes(body)) {
    parts.push(body.slice(last, i));
    last = i + 1;
  }
  parts.push(body.slice(last));
  // 闭合竖线：切完最后一段是空白 ⇒ 那一段来自收尾的 `|`，不是一列
  if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map((p) => p.trim());
}

/** 「对齐行」：每格都是 `:?-+:?`（GFM 的 `|---|:--:|`） */
const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));

/**
 * 从整篇 markdown 里切出**所有**表格。
 * 表格 = 连续的、每行都 `splitRow() !== null` 的行块（中间出现普通行 / 空行即断开）。
 * @param {string} text
 * @returns {{ startLine: number, rows: {line: number, raw: string, cells: string[]}[], header: string[], separator: string[] | null, body: {line: number, raw: string, cells: string[]}[] }[]}
 */
export function parseMarkdownTables(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  /** @type {ReturnType<typeof parseMarkdownTables>} */
  const tables = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitRow(raw);
    if (!cells) {
      if (cur) { tables.push(finish(cur)); cur = null; }
      continue;
    }
    if (!cur) cur = { startLine: i + 1, rows: [] };
    cur.rows.push({ line: i + 1, raw, cells });
  }
  if (cur) tables.push(finish(cur));
  return tables;

  function finish(t) {
    const header = t.rows[0]?.cells ?? [];
    const separator = t.rows[1] && isSeparatorRow(t.rows[1].cells) ? t.rows[1].cells : null;
    const bodyStart = separator ? 2 : 1;
    return { startLine: t.startLine, rows: t.rows, header, separator, body: t.rows.slice(bodyStart) };
  }
}

/**
 * 找出**表头以 `headerStartsWith` 开头**的那张表（多于一张 ⇒ 抛错，不替你挑）。
 * ★ 不静默取第一张：同一份文件里两张同前缀表 = 结构本身有歧义，必须让人来分。
 * @param {string} text
 * @param {string} headerStartsWith 与表头**首个非空段**比对的原文前缀（如 `'| 日期 |'`）
 * @returns {ReturnType<typeof parseMarkdownTables>[number] | null}
 */
export function findTableByHeader(text, headerStartsWith) {
  const hits = parseMarkdownTables(text).filter((t) =>
    t.rows.length > 0 && t.rows[0].raw.trim().startsWith(headerStartsWith),
  );
  if (hits.length > 1) {
    const at = hits.map((t) => `第 ${t.startLine} 行`).join(' / ');
    throw new Error(`表头以 ${JSON.stringify(headerStartsWith)} 开头的表格有 ${hits.length} 张（${at}）⇒ 歧义，拒绝猜`);
  }
  return hits[0] ?? null;
}
