/**
 * 规则匹配器的行/token 小工具（P1-7）
 *
 * 单独成模块的理由：rule_match.ts 体量已经不小，且这些函数在
 * rule_apply / rule_extract / 测试里都要用 —— 避免各处重写导致口径漂移
 * （与 P0-4 的教训一致：口径必须单源）。
 */

/** 按 \n 切行（保留每行的 \r 以便调用方自行处理行尾） */
export function splitLines(s: string): string[] {
  return s.split('\n');
}

/** 归一化：去掉全部行内空白与首尾空白（与 fuzzy_match 的 L2/L3 口径同源） */
export function fold(s: string): string {
  return s.replace(/[ \t]+/g, '').trim();
}

/** 行首空白 */
export function leadingWs(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/**
 * 把文本折叠成"行键"序列（去首尾空白 + 去行内空白 + 丢空行）。
 * P0-4 的 L3 口径；规则匹配与萃取都按它做粗筛。
 */
export function keyedLines(text: string): string[] {
  return splitLines(text)
    .map((l) => fold(l.replace(/\r$/, '')))
    .filter((l) => l.length > 0);
}

/** 文本的行数（含空行） */
export function countLines(text: string): number {
  if (text === '') return 0;
  return splitLines(text).length;
}
