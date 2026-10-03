/**
 * 规则匹配器（P1-7）—— `$hole` 元变量 + 复用 P0-4 模糊级联
 *
 * 设计（v1 收敛，对齐 GritQL 的能力子集）：
 *   - **`$name` 元变量**：占位一个"代码片段"（AST 子树或一段 token）。
 *     匹配时通配，改写时按名字回填同一实参 —— 这是 Grit 的核心机制。
 *   - **`...` 省略号**：占位任意行（多行通配）。复用 fuzzy_match 的 L4 语义。
 *   - **字面量**：其余文本按"空白归一"匹配（复用 P0-4 的 keyWhitespace 口径），
 *     因为 LLM 现场写的规则同样是"凭记忆默写"，逐字匹配会大量漏。
 *
 * 匹配分两层（先便宜后贵）：
 *   ① **块级粗筛**：把整份文件按"顶层块"切分（函数/类/语句），
 *      与 pattern 的**首行字面量**做快速包含判断 → 候选窗口。
 *      （避免对每个字符位置跑完整匹配）
 *   ② **窗口级精配**：在候选窗口上用"token 序列 + 元变量回溯"做匹配，
 *      取**最长**匹配、要求**全文件唯一**。
 *
 * 纪律（与 P0-4 同源，绝不放松）：
 *   - **唯一才动**：命中 >1 处 ⇒ 报歧义并列行号，不擅自挑一个；
 *   - **诚实回执**：告知用了哪一级（是否用了模糊/是否用了 $hole），
 *     并展示**实际命中的文件片段**而非模型写的 pattern。
 */

import { splitLines, leadingWs } from './rule_tokens.js';

/** 一个元变量绑定：名字 → 实际捕获的文本 */
export interface HoleBinding {
  name: string;
  text: string;
}

/** 一处命中 */
export interface RuleMatch {
  /** 命中区间 [start, end)（字符偏移；end 不含末行换行） */
  start: number;
  end: number;
  /** 1-based 起止行（含端点） */
  startLine: number;
  endLine: number;
  /** 实际命中的文件原文（回执/diff 必须用它，不用 pattern 原文） */
  matchedText: string;
  /** 命中首行的行首空白（替换时按它重排，保缩进） */
  indent: string;
  /**
   * 命中是否**起自本行行首空白区内外**的判据（缩进补不补的唯一依据）。
   *   - true  = 命中起点在行首缩进**之内**（即区间左侧没有原文缩进）
   *             ⇒ 替换文本**必须自己补** `indent`（否则整块左移）；
   *   - false = 区间左侧已有原文缩进（同行第二处命中、或行中片段）
   *             ⇒ **绝不能补** `indent`（补了就缩进翻倍）。
   * ★ 这两个字面相同的行（`  f();` 与 `x; f();`）就是这条判据存在的理由。
   */
  absorbsIndent: boolean;
  /** 元变量绑定（改写回填用） */
  holes: HoleBinding[];
}

export interface MatchOutcome {
  /** 全部命中（按文件顺序）；长度 1 = 唯一可动 */
  matches: RuleMatch[];
  /** 歧义 = 命中 >1 处（此时不该动任何一处） */
  ambiguous: boolean;
  /** pattern 里声明的元变量名（顺序） */
  holeNames: string[];
}

/* ─────────────────── pattern 解析 ─────────────────── */

/** 从 pattern 文本里抽出元变量名（`$name`，按出现顺序去重） */
export function holeNamesOf(pattern: string): string[] {
  const out: string[] = [];
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * 把 pattern 的一行切成 token；`$hole` 是特殊 token。
 * 例：`console.log($x);` → [lit:'console.log(', hole:'x', lit:');']
 *     `$fn($a, $b)`      → [hole:'fn', lit:'(', hole:'a', lit:',', hole:'b', lit:')']
 */
export type PatToken = { kind: 'lit'; text: string } | { kind: 'hole'; name: string } | { kind: 'star' };

/** 把 pattern 文本 token 化（逐行；`...` 单独成行 → star） */
export function tokenizePattern(pattern: string): PatToken[][] {
  const lines = splitLines(pattern);
  const out: PatToken[][] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' ) { out.push([]); continue; }
    if (/^\s*(\.\.\.|…)\s*$/.test(line)) { out.push([{ kind: 'star' }]); continue; }
    const toks: PatToken[] = [];
    let i = 0;
    let buf = '';
    while (i < line.length) {
      const c = line[i];
      // `...` 出现在行内也当 star（占位该行剩余部分）
      if (line.startsWith('...', i)) {
        if (buf.trim() !== '') { toks.push({ kind: 'lit', text: buf }); buf = ''; }
        toks.push({ kind: 'star' });
        i += 3;
        continue;
      }
      if (c === '$') {
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(i));
        if (m) {
          if (buf.trim() !== '') { toks.push({ kind: 'lit', text: buf }); buf = ''; }
          toks.push({ kind: 'hole', name: m[1] });
          i += m[0].length;
          continue;
        }
      }
      buf += c;
      i++;
    }
    if (buf.trim() !== '' || toks.length === 0) {
      if (buf.trim() !== '') toks.push({ kind: 'lit', text: buf });
    }
    out.push(toks);
  }
  return out;
}

/* ─────────────────── 匹配 ─────────────────── */

/** token 比较键：去空白（与 P0-4 L2 同口径） */
const norm = (s: string): string => s.replace(/[ \t]+/g, '');

interface FileLine {
  /** 原行（不含换行） */
  text: string;
  /** 归一化后的"折叠串"（去首尾空白+去行内空白），用于字面量包含判断 */
  folded: string;
  /** 行首偏移 */
  start: number;
  /** 行尾偏移（不含换行） */
  end: number;
}

function indexFile(content: string): { lines: FileLine[]; starts: number[] } {
  const raw = splitLines(content);
  const lines: FileLine[] = [];
  const starts: number[] = [];
  let acc = 0;
  for (const r of raw) {
    const text = r.replace(/\r$/, '');
    starts.push(acc);
    lines.push({ text, folded: norm(text), start: acc, end: acc + text.length });
    acc += r.length + 1;
  }
  return { lines, starts };
}

/**
 * 在"一行文件"上匹配"一行 pattern token"。
 * 返回该行内所有匹配的 {start, end, holes}（**行内相对偏移**）；无匹配返回 []。
 *
 * ★ **必须报出同一行里的每一处**（多处 ⇒ 上层判歧义 ⇒ 转 todo）。
 *   只报最左一处会**静默改错**：`f(); f();` 报 1 处就会去改第一个，
 *   而纪律是"唯一才动、歧义即停"。故每个起点都试一次（起点推进 1 字符）。
 *
 * 做法：把文件行按"折叠"（去空白）后与 token 序列做回溯匹配，
 * 但保留原行索引以便返回**原文档中真实文本**（回填/回执要原文）。
 */
function matchLine(
  fileLine: FileLine,
  toks: PatToken[],
):
  { start: number; end: number; holes: HoleBinding[] }[] {
  if (toks.length === 0) return [];
  const src = fileLine.text;
  const results: { start: number; end: number; holes: HoleBinding[] }[] = [];

  // 递归匹配：si = 文件行字符位置，ti = token 下标
  const walk = (si: number, ti: number, holes: HoleBinding[], startSi: number): void => {
    if (ti === toks.length) {
      results.push({ start: startSi, end: si, holes: [...holes] });
      return;
    }
    const tok = toks[ti];

    if (tok.kind === 'star') {
      // 行内 star：吞到本 token 之后的字面量能匹配上的位置；无后续则吞到行尾
      const rest = toks.slice(ti + 1);
      if (rest.length === 0) {
        results.push({ start: startSi, end: src.length, holes: [...holes] });
        return;
      }
      for (let e = si; e <= src.length; e++) {
        walk(e, ti + 1, holes, startSi);
      }
      return;
    }

    if (tok.kind === 'hole') {
      // 元变量：最短优先（避免吃掉本该给后续 token 的内容），逐字符扩展
      // 若该 hole 已绑定，则必须是同一实参
      const bound = holes.find((h) => h.name === tok.name);
      if (bound) {
        const idx = src.indexOf(bound.text, si);
        if (idx >= 0) walk(idx + bound.text.length, ti + 1, holes, startSi);
        return;
      }
      // ★ 先跳过空白：pattern 里字面量之间的空白已折叠，hole 起点不该吃空白
      let s0 = si;
      while (s0 < src.length && /[ \t]/.test(src[s0])) s0++;
      for (let e = s0; e <= src.length; e++) {
        const cap = src.slice(s0, e);
        // ★ 元变量捕获不留首尾空白（否则 `function $name()` 会吃到前导空格）
        if (cap !== cap.trim()) continue;
        // 不允许捕获里含未平衡的括号（避免吃掉后续 token 的括号）
        if (!balanced(cap)) continue;
        walk(e, ti + 1, [...holes, { name: tok.name, text: cap }], startSi);
      }
      return;
    }

    // 字面量：在文件行里做"折叠匹配"（跳过空白差异）
    const lit = tok.text;
    const consumed = matchLiteral(src, si, lit);
    if (consumed < 0) return;
    walk(consumed, ti + 1, holes, startSi);
  };

  // 每个起点都试（起点 = 行内每个非空白字符位置）—— 见函数头 ★
  for (let start = 0; start < src.length; start++) {
    if (src[start] === ' ' || src[start] === '\t') continue;
    walk(start, 0, [], start);
  }

  // 去重（同 span 同 holes 只留一个）并按 (start, end) 升序
  const seen = new Set<string>();
  const uniq: { start: number; end: number; holes: HoleBinding[] }[] = [];
  for (const r of results) {
    if (r.end <= r.start) continue;
    const k = r.start + ':' + r.end + '|' + r.holes.map((h) => h.name + '=' + h.text).join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  uniq.sort((a, b) => a.start - b.start || a.end - b.end);
  return uniq;
}

/** 括号平衡（粗判：只数 (), [], {}） */
function balanced(s: string): boolean {
  let d = 0;
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    if (d < 0) return false;
  }
  return d === 0;
}

/**
 * 从 src 的位置 si 起匹配字面量 lit（允许空白差异）。
 * 成功返回匹配结束位置（> si），失败返回 -1。
 */
function matchLiteral(src: string, si: number, lit: string): number {
  const l = norm(lit);
  if (l === '') return si;
  let i = si;
  let j = 0;
  while (j < l.length) {
    // 跳过 src 里的空白
    while (i < src.length && /[ \t]/.test(src[i])) i++;
    if (i >= src.length) return -1;
    if (src[i] !== l[j]) return -1;
    i++;
    j++;
  }
  return i;
}

/**
 * 在整份文件里匹配一个 pattern，返回全部命中。
 * 支持多行 pattern（含 `...` 成行 = 跨行通配）。
 */
export function matchRule(content: string, pattern: string): MatchOutcome {
  const holeNames = holeNamesOf(pattern);
  const patLines = tokenizePattern(pattern);
  const { lines } = indexFile(content);
  const matches: RuleMatch[] = [];

  // 非空 pattern 行（记录其在 pattern 中的下标，供后续取 raw）
  const patRows = patLines
    .map((toks, i) => ({ toks, i }))
    .filter((r) => r.toks.length > 0);
  if (patRows.length === 0) return { matches: [], ambiguous: false, holeNames };

  // 单行 pattern：逐行扫描
  if (patRows.length === 1) {
    const toks = patRows[0].toks;
    for (let li = 0; li < lines.length; li++) {
      const fl = lines[li];
      if (fl.text.trim() === '') continue;
      for (const m of matchLine(fl, toks)) {
        // ★ matchLine 返回的是**行内相对偏移**（相对 fl.text 起点），须换算成绝对偏移
        if (m.end <= m.start) continue;
        const indent = leadingWs(fl.text);
        // ★ 归一化区间：若命中是"本行首个非空白内容"，则把行首缩进**并入区间**
        //   （left === '' ⇒ 行首到命中起点全是空白）。这样"缩进恰好补一次"的
        //   不变量只有一个来源：区间要么含缩进（补），要么不含（绝不补）。
        //   不做这步就会出现同一处命中被报两次（含缩进/不含缩进两种 span）⇒ 假歧义。
        const left = fl.text.slice(0, m.start);
        const insideIndent = left.trim() === '';
        const startRel = insideIndent ? 0 : m.start;
        matches.push({
          start: fl.start + startRel,
          end: fl.start + m.end,
          startLine: li + 1,
          endLine: li + 1,
          matchedText: fl.text.slice(startRel, m.end),
          indent,
          absorbsIndent: insideIndent,
          holes: m.holes,
        });
      }
    }
    return finalize(matches, holeNames);
  }

  // 多行 pattern：用首行 token 找起点，再逐行推进（支持 `...` 跨行）
  const firstToks = patRows[0].toks;
  const isStar = (toks: PatToken[]): boolean => toks.length === 1 && toks[0].kind === 'star';

  for (let li = 0; li < lines.length; li++) {
    const fl = lines[li];
    if (fl.text.trim() === '') continue;
    const firsts = matchLine(fl, firstToks);
    for (const f of firsts) {
      // 从 (li, f.end) 起推进剩余 pattern 行
      // ★ 全程用**绝对偏移**（f.start/f.end、m.end 都是行内相对，须加该行 start）
      //   与单行路径同口径：命中若是首行首个非空白内容，行首缩进并入区间。
      const firstIndent = leadingWs(fl.text);
      const firstInsideIndent = fl.text.slice(0, f.start).trim() === '';
      const fStart = firstInsideIndent ? 0 : f.start;
      const startOff = fl.start + fStart;
      const startLi = li;
      const bindings = [...f.holes];
      let ci = li + 1;
      let ok = true;
      let endOff = fl.start + f.end;
      let endLi = li;
      let pi = 1;
      while (pi < patRows.length) {
        const toks = patRows[pi].toks;
        if (isStar(toks)) {
          // 跨行通配：跳到"下一个非 star pattern 行能匹配上的行"
          let nextPi = pi + 1;
          while (nextPi < patRows.length && isStar(patRows[nextPi].toks)) nextPi++;
          if (nextPi >= patRows.length) {
            // 尾部 star：吞到文件末
            endLi = lines.length - 1;
            endOff = lines[endLi].end;
            ci = lines.length;
            pi = nextPi;
            break;
          }
          const nextToks = patRows[nextPi].toks;
          let found = -1;
          for (let k = ci; k < lines.length; k++) {
            if (lines[k].text.trim() === '') continue;
            if (matchLine(lines[k], nextToks).length > 0) { found = k; break; }
          }
          if (found < 0) { ok = false; break; }
          ci = found;
          pi = nextPi;
          continue;
        }
        // 普通行：必须在 ci 行匹配
        if (ci >= lines.length) { ok = false; break; }
        const ms = matchLine(lines[ci], toks);
        if (ms.length === 0) { ok = false; break; }
        const m = ms[0];
        // 元变量跨行绑定需一致校验
        for (const h of m.holes) {
          const prev = bindings.find((b) => b.name === h.name);
          if (prev && prev.text !== h.text) { ok = false; break; }
          if (!prev) bindings.push(h);
        }
        if (!ok) break;
        endOff = lines[ci].start + m.end;
        endLi = ci;
        ci++;
        pi++;
      }
      if (!ok) continue;
      const matchedText = content.slice(startOff, endOff);
      matches.push({
        start: startOff,
        end: endOff,
        startLine: startLi + 1,
        endLine: endLi + 1,
        matchedText,
        indent: firstIndent,
        absorbsIndent: firstInsideIndent,
        holes: bindings,
      });
    }
  }
  return finalize(matches, holeNames);
}

/** 去重（同区间只留一条）、按位置排序、判定歧义 */
function finalize(matches: RuleMatch[], holeNames: string[]): MatchOutcome {
  const seen = new Set<string>();
  const uniq: RuleMatch[] = [];
  for (const m of matches) {
    const k = m.start + ':' + m.end;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(m);
  }
  uniq.sort((a, b) => a.start - b.start);
  return { matches: uniq, ambiguous: uniq.length > 1, holeNames };
}

/* ─────────────────── 改写：$hole 回填 ─────────────────── */

/**
 * 用命中结果把 replace 模板实例化：
 *   - `$name` → 该次命中的实参文本；
 *   - `...`   → 若模板行是纯 `...`，展开为"被通配吞掉的那段原文"（v1：保留为空）；
 *   - 缩进：**只在 `match.absorbsIndent` 为真时补首行缩进**（命中区间没有吃掉行首空白）；
 *     多行模板的后续行一律按 `match.indent` 对齐。
 *
 * ★ 这里踩过坑：命中区间与实际补缩进必须**恰好互补**一次 ——
 *   补重了 ⇒ 缩进翻倍（2 空格变 4 空格）；补漏了 ⇒ 整块左移。
 *   判据由 `absorbsIndent` 给（见其定义），不要在这里再猜。
 */
export function instantiateReplace(replace: string, match: RuleMatch): string {
  const lines = splitLines(replace).map((l) => l.replace(/\r$/, ''));
  const out: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // 纯 `...` 模板行 → 展开被 star 吞掉的原文区间（此处无法精确定位，v1 直接略去）
    if (/^\s*(\.\.\.|…)\s*$/.test(line)) continue;
    const s = line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (full, name: string) => {
      const b = match.holes.find((h) => h.name === name);
      return b ? b.text : full;
    });
    const body = s.replace(/^[ \t]+/, '');
    if (li === 0) out.push(match.absorbsIndent ? match.indent + body : body);
    else out.push(match.indent + body);
  }
  return out.join('\n');
}

/** 便捷：把某处命中替换为实例化后的文本，返回新全文 */
export function applyMatch(content: string, match: RuleMatch, replace: string): string {
  const text = instantiateReplace(replace, match);
  return content.slice(0, match.start) + text + content.slice(match.end);
}

/** 导出内部 token 工具（测试用） */
export const __internals = { norm, matchLiteral, balanced };
