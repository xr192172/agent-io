/**
 * 模糊编辑级联（P0-4，2026-09-15）—— replace_text 的 4 级降级文本定位
 *
 * 出处：Serena fuzzy editing（exact → 空白归一 → 缩进弹性 → 省略号占位）。
 * 为什么关键：LLM 生成的 old_text 天然不精确（凭记忆默写、从别处粘贴），
 * 只有 exact 匹配就会大量"改不了、请重试"。级联让"差一点"的 old_text 也能
 * 一次命中，同时在返回里**明示用了哪一级**（诚实——模糊命中必须让模型知道
 * 匹配不是逐字的，并展示**实际被替换的文件片段**而不是模型写的 old_text）。
 *
 * 4 级定义（逐级更宽，高级别包含低级别做不到的宽容）：
 *   L1 exact        字节级唯一命中（既有行为，最快路径，不做任何归一）
 *   L2 空白归一      逐行键 = 保留行首缩进 + 去掉行内全部空白（ forgiven：
 *                   CRLF/LF、行尾空格、行内空格差异；缩进本身仍须一致）
 *   L3 缩进弹性      逐行键 = 去掉行首缩进 + 去掉行内空白，空行全部忽略
 *                   （ forgiven：整块缩进层级不同；命中后 new_text 按
 *                   实际命中首行的缩进**重排**再替换）
 *   L4 省略号占位    old_text 里允许出现 '...' / '…' 行 = 省略任意行，
 *                   其余段按 L3 键顺序锚定（ forgiven：模型只默写头尾；
 *                   整个头..尾区间被 new_text 整体替换）
 *
 * 纪律：
 *   - **歧义即停**：某级命中 >1 处 ⇒ 直接报歧义并列出行号，绝不"降级到更模糊
 *     的级别硬找唯一"——那会把真歧义换成错误命中。
 *   - **唯一才动**：任何级别都必须全文件恰好 1 处命中。
 *   - 语法门/快照/dry_run/索引重建等安全网不因模糊而放松（edit_code 主流程管）。
 */

/** 匹配级别（1-4；0 = 全部级别未命中） */
export type FuzzyLevel = 0 | 1 | 2 | 3 | 4;

/** 人读级别名（结果回执用，别改文案口径：L1 exact / L2 空白归一 / L3 缩进弹性 / L4 省略号占位） */
export const FUZZY_LEVEL_LABEL: Record<Exclude<FuzzyLevel, 0>, string> = {
  1: 'exact',
  2: '空白归一',
  3: '缩进弹性',
  4: '省略号占位',
};

export interface FuzzyMatch {
  /** 原文中的字符区间 [start, end)（end 恰在命中末行行尾，不含换行符） */
  start: number;
  end: number;
  /** 1-based 起止行（含端点） */
  startLine: number;
  endLine: number;
  level: Exclude<FuzzyLevel, 0>;
  /** 实际被替换的文件片段（模糊级 ≠ old_text；diff 预览必须用它，不用模型写的 old_text） */
  matchedText: string;
  /** 命中首行的行首空白（L3/L4 用于把 new_text 重排到目标缩进；L1/L2 = ''） */
  targetIndent: string;
}

export interface LocateResult {
  /** 唯一命中时给出；未命中或歧义时为 null */
  match: FuzzyMatch | null;
  /** 最高有效级别上的全部候选（1 个 = match；>1 = 歧义，报错列出 startLine） */
  candidates: FuzzyMatch[];
  /** 候选所在级别；0 = 四级全未命中 */
  level: FuzzyLevel;
}

/** 行首空白（tab/空格原样保留） */
function leadingWs(line: string): string {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0] : '';
}

/** L2 键：保留行首缩进，去掉行内+行尾全部空白；纯空白行 → '' */
function keyWhitespace(line: string): string {
  const t = line.replace(/\r$/, '');
  if (t.trim() === '') return '';
  const lead = leadingWs(t);
  return lead + t.slice(lead.length).replace(/[ \t]+/g, '');
}

/** L3/L4 键：去行首缩进 + 去行内空白；空行返回 null（级联里被整体忽略） */
function keyIndentFree(line: string): string | null {
  const t = line.replace(/\r$/, '');
  if (t.trim() === '') return null;
  return t.trim().replace(/[ \t]+/g, '');
}

const isEllipsisLine = (line: string): boolean => {
  const t = line.trim();
  return t === '...' || t === '…';
};

/** 预计算：行数组 + 每行起始偏移（供窗口 → 字符区间映射） */
interface LineIndex {
  lines: string[];
  starts: number[];
  /** 字符偏移 → 0-based 行号 */
  lineOf(offset: number): number;
}

function buildLineIndex(content: string): LineIndex {
  const lines = content.split('\n');
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const lineOf = (offset: number): number => {
    // 二分：最大 i 使 starts[i] <= offset
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return { lines, starts, lineOf };
}

/** 窗口（0-based 行区间含端点）→ FuzzyMatch */
function windowToMatch(
  idx: LineIndex,
  i: number,
  j: number,
  level: Exclude<FuzzyLevel, 0>,
  needIndent: boolean,
): FuzzyMatch {
  const start = idx.starts[i];
  const end = idx.starts[j] + idx.lines[j].length;
  return {
    start,
    end,
    startLine: i + 1,
    endLine: j + 1,
    level,
    matchedText: idx.lines.slice(i, j + 1).join('\n'),
    targetIndent: needIndent ? leadingWs(idx.lines[i]) : '',
  };
}

export function hasEllipsisLine(oldText: string): boolean {
  return oldText.split('\n').some(isEllipsisLine);
}

export function locateReplaceText(content: string, oldText: string): LocateResult {
  const idx = buildLineIndex(content);
  const fileLines = idx.lines;
  const oldLines = oldText.replace(/\r\n/g, '\n').split('\n');

  // ── L1 exact：字节级唯一命中（保持既有行为，含行内/跨行/带尾换行） ──
  const exact: FuzzyMatch[] = [];
  let pos = content.indexOf(oldText);
  while (pos !== -1) {
    const startLine = idx.lineOf(pos) + 1;
    const endOffset = pos + oldText.length;
    const endLine = endOffset === pos ? startLine : idx.lineOf(endOffset - 1) + 1;
    exact.push({
      start: pos,
      end: endOffset,
      startLine,
      endLine,
      level: 1,
      matchedText: oldText,
      targetIndent: '',
    });
    pos = content.indexOf(oldText, pos + 1);
  }
  if (exact.length > 0) {
    return { match: exact.length === 1 ? exact[0] : null, candidates: exact, level: 1 };
  }

  // ── 含省略号 ⇒ L1 失败后直接 L4（L2/L3 的逐行键对不上带 '...' 的段） ──
  const withEllipsis = oldLines.some(isEllipsisLine);

  // ── L2 空白归一：整行锚定窗口（行首缩进保留、行内空白忽略、边缘空行忽略） ──
  if (!withEllipsis) {
    const oldKeys = oldLines.map(keyWhitespace);
    while (oldKeys.length > 0 && oldKeys[0] === '') oldKeys.shift();
    while (oldKeys.length > 0 && oldKeys[oldKeys.length - 1] === '') oldKeys.pop();
    if (oldKeys.length > 0 && oldKeys.length <= fileLines.length) {
      const fileKeys = fileLines.map(keyWhitespace);
      const hits: FuzzyMatch[] = [];
      for (let i = 0; i + oldKeys.length <= fileKeys.length; i++) {
        let ok = true;
        for (let k = 0; k < oldKeys.length; k++) {
          if (fileKeys[i + k] !== oldKeys[k]) {
            ok = false;
            break;
          }
        }
        if (ok) hits.push(windowToMatch(idx, i, i + oldKeys.length - 1, 2, false));
      }
      if (hits.length > 0) {
        return { match: hits.length === 1 ? hits[0] : null, candidates: hits, level: 2 };
      }
    }

    // ── L3 缩进弹性：去缩进键 + 忽略空行；new_text 按命中首行缩进重排 ──
    const oldKey3 = oldLines.map(keyIndentFree).filter((k): k is string => k !== null);
    if (oldKey3.length > 0) {
      const filtered: Array<{ line: number; key: string }> = [];
      for (let i = 0; i < fileLines.length; i++) {
        const k = keyIndentFree(fileLines[i]);
        if (k !== null) filtered.push({ line: i, key: k });
      }
      const hits: FuzzyMatch[] = [];
      for (let p = 0; p + oldKey3.length <= filtered.length; p++) {
        let ok = true;
        for (let k = 0; k < oldKey3.length; k++) {
          if (filtered[p + k].key !== oldKey3[k]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const a = filtered[p].line;
          const b = filtered[p + oldKey3.length - 1].line;
          hits.push(windowToMatch(idx, a, b, 3, true));
        }
      }
      if (hits.length > 0) {
        return { match: hits.length === 1 ? hits[0] : null, candidates: hits, level: 3 };
      }
    }
  }

  // ── L4 省略号占位：'...' 行 = 省略任意行，其余段按 L3 键顺序锚定 ──
  if (withEllipsis) {
    // 切段：省略号行分段；每段内部丢空行、取 L3 键
    const segs: string[][] = [];
    let cur: string[] = [];
    for (const l of oldLines) {
      if (isEllipsisLine(l)) {
        segs.push(cur.filter((k): k is string => k !== null));
        cur = [];
      } else {
        const k = keyIndentFree(l);
        if (k !== null) cur.push(k);
      }
    }
    segs.push(cur.filter((k): k is string => k !== null));
    const hasAnchor = segs.some((s) => s.length > 0);
    if (hasAnchor) {
      const filtered: Array<{ line: number; key: string }> = [];
      for (let i = 0; i < fileLines.length; i++) {
        const k = keyIndentFree(fileLines[i]);
        if (k !== null) filtered.push({ line: i, key: k });
      }
      const windows = new Set<string>();
      const hits: FuzzyMatch[] = [];
      const MAX_COMBOS = 64; // 组合数防爆（正常 old_text 组合数远小于此）
      const walk = (segIdx: number, fromPos: number, winA: number | null, winB: number | null): void => {
        if (hits.length >= MAX_COMBOS) return;
        const seg = segs[segIdx];
        if (seg.length === 0) {
          // 空段（首/尾就是省略号，或连续省略号）：不锚定，直接前进
          if (segIdx === segs.length - 1) {
            if (winA !== null && winB !== null) {
              const key = `${winA}:${winB}`;
              if (!windows.has(key)) {
                windows.add(key);
                hits.push(windowToMatch(idx, winA, winB, 4, true));
              }
            }
            return;
          }
          walk(segIdx + 1, fromPos, winA, winB);
          return;
        }
        for (let p = fromPos; p + seg.length <= filtered.length; p++) {
          let ok = true;
          for (let k = 0; k < seg.length; k++) {
            if (filtered[p + k].key !== seg[k]) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const na = winA === null ? filtered[p].line : winA;
          const nb = filtered[p + seg.length - 1].line;
          if (segIdx === segs.length - 1) {
            const key = `${na}:${nb}`;
            if (!windows.has(key)) {
              windows.add(key);
              hits.push(windowToMatch(idx, na, nb, 4, true));
            }
          } else {
            walk(segIdx + 1, p + seg.length, na, nb);
          }
          if (hits.length >= MAX_COMBOS) return;
        }
      };
      walk(0, 0, null, null);
      if (hits.length > 0) {
        return { match: hits.length === 1 ? hits[0] : null, candidates: hits, level: 4 };
      }
    }
  }

  return { match: null, candidates: [], level: 0 };
}

/**
 * L3/L4 命中后的 new_text 重排：相对化（去最小公共缩进）后整体补上目标缩进，
 * 保留内部相对嵌套；空行保持为空。行尾风格按 eol 统一（文件多为 CRLF 时避免混排）。
 * （与 edit_code.range 的 realignCode 同思路，这里是 文本进/文本出 形态。）
 */
export function realignNewTextTo(newText: string, targetIndent: string, eol: string): string {
  const ls = newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (ls.length > 0 && ls[ls.length - 1].trim() === '') ls.pop();
  const nonEmpty = ls.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return '';
  const minIndent = Math.min(...nonEmpty.map((l) => (/^[ \t]*/.exec(l)?.[0].length ?? 0)));
  const out = ls.map((l) => (l.trim().length === 0 ? '' : targetIndent + l.slice(minIndent)));
  return out.join(eol);
}
