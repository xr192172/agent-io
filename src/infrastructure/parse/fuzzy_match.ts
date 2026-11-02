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
 *   L2 空白归一      逐行键 = 保留行首缩进 + **token 流**等价（forgiven：
 *                   CRLF/LF、行尾空格、行内空格宽窄；缩进本身仍须一致）
 *   L3 缩进弹性      逐行键 = 去掉行首缩进 + **token 流**等价，空行全部忽略
 *                   （forgiven：整块缩进层级不同；命中后 new_text 按
 *                   实际命中首行的缩进**重排**再替换）
 *   L4 省略号占位    old_text 里允许出现 '...' / '…' 行 = 省略任意行，
 *                   其余段按 L3 键顺序锚定（forgiven：模型只默写头尾；
 *                   整个头..尾区间被 new_text 整体替换）
 *
 * ── 等价判据（P0-2，2026-11-01）：**token 流相同**，不是字符级去空白 ──
 *   不变量（违反即静默改错代码）：字符级去空白会把"内容不同"当成"排版不同"——
 *   `'helloworld'` ↔ `'hello world'`、`a - -b` ↔ `a--b`、`const foo Bar = 1;` ↔
 *   `const fooBar = 1;` 全部会被判成"等价"，于是把**另一段文本**悄悄替上去，不抛错、
 *   不告警、回执照旧说成功。
 *   判据：两个变体等价 ⟺ 各自 tokenize 后 token 序列逐项相同。
 *   为什么不做"危险字符对黑名单"：黑名单有洞 ⇒ 未知算子被当"安全" ⇒ 静默改错（不可见）；
 *   token 流判法的洞只会是**漏命中** ⇒ 工具报"找不到"（可见、可重试）。⇒ 宁可漏，不可错。
 *   已知洞（显式记录；**不在黑名单里补**，因为补法本身是启发式解析 —— 要判"这一行是否位于未闭合
 *   引号内部"就必须先能识别注释里的撇号（`// don't`），正则硬上会把整段代码误标成字符串 ⇒ 大面积漏命中）：
 *   ① 正则字面量（`/a b/`）里的空白不受引号保护 ⇒ 那里的空白仍会被折叠；
 *   ② **多行字面量的中间行**（JS 模板串 / Python 三引号 / Go 裸串）：行内没有引号字符，
 *      tokenizer 无从知道"这一行在字符串里" ⇒ 那里的空白也会被折叠（**错**的方向，罕见形态）。
 *      ★ 将来收口的口径（现在不做）：跨行扫描未闭合引号，把"起始于字面量内部"的行标成 raw 键
 *        （整行一个 token、不折空白），而不是在这行上折空白。
 *      ★ 现状由 tests/p0_fuzzy_token_key.test.ts 的「[已知洞]」那条断言**钉住**：修掉它时那条用例会变红，
 *        必须连带把这里改成"已收口"。
 *
 * 纪律：
 *   - **歧义即停**：某级命中 >1 处 ⇒ 直接报歧义并列出行号，绝不"降级到更模糊
 *     的级别硬找唯一"——那会把真歧义换成错误命中。
 *   - **唯一才动**：任何级别都必须全文件恰好 1 处命中。
 *   - **一把键**：L2/L3/L4 都调 `fuzzyLineKey`（差异只在参数：缩进保留 / 空行折叠 / 键算法）。
 *     改容错逻辑前先数这把键有几处 —— 只改一级等于没改（另一级会用同一把键照旧接住）。
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

// ════════════════════════════════════════════════════════════════════════════
// 容错键 —— L2 / L3 / L4 共用**同一份**实现（参数化差异见 FuzzyKeyOpts）
// ════════════════════════════════════════════════════════════════════════════

/** 键算法（开关 `AGENT_IO_FUZZY_KEY`） */
export type FuzzyKeyMode = 'tolerant' | 'strict' | 'old';

/** 合法值（错误文案与测试共用；不再在别处写第二份字面量清单） */
export const FUZZY_KEY_MODES: readonly FuzzyKeyMode[] = ['tolerant', 'strict', 'old'];

/** 开关名（只读它一处） */
export const FUZZY_KEY_ENV = 'AGENT_IO_FUZZY_KEY';

/**
 * 读开关。**非法值直接抛**，不静默回落到默认值：
 * 静默回落会让"我设了开关"与"开关生效了"在读数上同形（0.12 失败必须与"没有"可区分）。
 */
export function fuzzyKeyMode(): FuzzyKeyMode {
  const raw = process.env[FUZZY_KEY_ENV];
  if (raw === undefined || raw === '') return 'tolerant';
  if ((FUZZY_KEY_MODES as readonly string[]).includes(raw)) return raw as FuzzyKeyMode;
  throw new Error(
    `${FUZZY_KEY_ENV}=${JSON.stringify(raw)} 不是合法值（合法：${FUZZY_KEY_MODES.join(' / ')}）。` +
      '不静默回落到默认值——那样"开关设错了"会与"开关没设"在读数上同形。',
  );
}

/**
 * 多字符算子表（**唯一住处**）。
 *
 * 判据（tests/p0_fuzzy_token_key.test.ts「表自身」那一组，缺它这张表就是无人看守的字面量）：
 *   ① 表里**每一项**都必须被 tokenizer 切成**恰好一个** token；
 *   ② 表外的相邻非词字符**不许**被合并（两个 token）；
 *   ③ tokenizer 必须**最长优先**（否则 `--` 会被切成两个 `-`，`a--b` 又会与 `a - -b` 等价）。
 * 这张表的存在理由：`a--b` 与 `a - -b` 只有"`--` 是一个 token"时才是两回事。
 */
export const MULTI_CHAR_OPERATORS: readonly string[] = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
  '::',
  '->',
  '<-',
];

/** 最长优先（从表推导，不手维护第二份顺序） */
const MULTI_OPS_LONGEST_FIRST: readonly string[] = [...MULTI_CHAR_OPERATORS].sort((a, b) => b.length - a.length);

/** strict 模式的"邻空白显著"标记（键是 JSON 数组串，控制字符不会出现在正常 token 里） */
const STRICT_GAP = '\u0002';

/** 一个 token：文本 + 是否算子（strict 只对算子看邻空白）+ 左右是否紧邻空白 */
interface Token {
  text: string;
  op: boolean;
  spaceBefore: boolean;
  spaceAfter: boolean;
}

const isWordStart = (c: string): boolean => /[\p{L}_$]/u.test(c);
const isWordCont = (c: string): boolean => /[\p{L}\p{N}_$]/u.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isBlankChar = (c: string): boolean => c === ' ' || c === '\t';

/** 引号段：**整体一个 token**（含引号），内部空白**一字不动**；`\` 转义下一个字符 */
function readQuoted(text: string, i: number): number {
  const q = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    j++;
  }
  return text.length; // 未闭合字符串：到行尾为止（不猜闭合位置）
}

/** 数字：`1` / `1.5` / `0xFF` / `1_000`；**紧跟词字符时吞进同一 token**（`1abc` 是一个 token） */
function readNumber(text: string, i: number): number {
  let j = i;
  if (text[j] === '0' && (text[j + 1] === 'x' || text[j + 1] === 'X')) {
    j += 2;
    while (j < text.length && /[0-9a-fA-F_]/.test(text[j])) j++;
  } else {
    while (j < text.length && (isDigit(text[j]) || text[j] === '_')) j++;
    if (j < text.length && text[j] === '.' && isDigit(text[j + 1] ?? '')) {
      j++;
      while (j < text.length && (isDigit(text[j]) || text[j] === '_')) j++;
    }
  }
  // ★ 不吞的话 `1abc` 与 `1 abc` 会折成同一串 token —— 那是"错"（静默替换），不是"漏"
  while (j < text.length && isWordCont(text[j])) j++;
  return j;
}

/**
 * tokenize 一行。规则（顺序即优先级）：
 *   ① 空白：**只在 token 之间折叠**（token 内部一律不折叠）；
 *   ② 引号段（`'` `"` 与反引号，含 `\` 转义）⇒ 整体一个 token；
 *   ③ 标识符 / 数字；
 *   ④ 多字符算子（**最长优先**，表外 ⇒ 单字符）；
 *   ⑤ 其余单字符。
 * ★ **不剥注释**：`//` 在 Python 是整除、`#` 才是注释 ⇒ 剥注释在多语言下不安全。
 */
function tokenizeDetailed(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let pendingSpace = false;
  while (i < text.length) {
    const c = text[i];
    if (isBlankChar(c)) {
      pendingSpace = true;
      i++;
      continue;
    }
    let end: number;
    let op = false;
    if (c === "'" || c === '"' || c === '`') {
      end = readQuoted(text, i);
    } else if (isDigit(c)) {
      end = readNumber(text, i);
    } else if (isWordStart(c)) {
      end = i + 1;
      while (end < text.length && isWordCont(text[end])) end++;
    } else {
      const multi = MULTI_OPS_LONGEST_FIRST.find((o) => text.startsWith(o, i));
      end = multi ? i + multi.length : i + 1;
      op = true;
    }
    out.push({ text: text.slice(i, end), op, spaceBefore: pendingSpace, spaceAfter: false });
    pendingSpace = false;
    i = end;
  }
  // spaceAfter 由**下一个 token 的 spaceBefore** 推导；行尾空白不参与（它是纯排版）
  for (let k = 0; k + 1 < out.length; k++) out[k].spaceAfter = out[k + 1].spaceBefore;
  return out;
}

/** token 流（对外可判形态：测试与消融都直接调它 —— 判据必须能碰得到被断言的东西） */
export function fuzzyTokens(text: string): string[] {
  return tokenizeDetailed(text.replace(/\r$/, '')).map((t) => t.text);
}

/** 行键参数：L2 / L3 / L4 的差异**只有这三格**（键本身只有一份实现） */
export interface FuzzyKeyOpts {
  /** 保留行首缩进（L2）还是去掉（L3/L4） */
  keepIndent: boolean;
  /** 空行：'keep' ⇒ 占位键（L2 逐行窗口要对齐）；'drop' ⇒ null（L3/L4 整行忽略） */
  blankLine: 'keep' | 'drop';
  /** 键算法（缺省 = 现读环境开关） */
  mode?: FuzzyKeyMode;
}

/**
 * 归一化行键（L2/L3/L4 唯一的键实现）。
 *
 * 返回**可比较的字符串**：`JSON.stringify(tokens)`（空行 = `'[]'`）——
 * 选 JSON 而不是控制字符拼接，是为了让键在判据/报错里**可读可断言**；
 * 而 token 内部可能含空格（引号段），所以不能用空格当分隔符。
 *
 * ★ `mode='old'` 是**回滚通道**（旧字符级去空白），保留条件与删除条件见文件末尾注释；
 *   它与 tolerant 的差别只剩"错得更多" —— 所以两条删除判据都成立后就该删掉它。
 */
export function fuzzyLineKey(line: string, opts: FuzzyKeyOpts): string | null {
  const mode = opts.mode ?? fuzzyKeyMode();
  const text = line.replace(/\r$/, '');
  if (text.trim() === '') return opts.blankLine === 'drop' ? null : '[]';
  const lead = leadingWs(text);
  const body = text.slice(lead.length);
  if (mode === 'old') {
    // 旧行为：字符级去空白（`helloworld` ↔ `hello world` 会命中 —— 这就是要退役的那条腿）
    const folded = body.replace(/[ \t]+/g, '');
    return opts.keepIndent ? lead + folded : folded;
  }
  const parts = tokenizeDetailed(body).map((t) =>
    mode === 'strict' && t.op
      ? `${t.spaceBefore ? STRICT_GAP : ''}${t.text}${t.spaceAfter ? STRICT_GAP : ''}`
      : t.text,
  );
  return JSON.stringify(opts.keepIndent ? [lead, ...parts] : parts);
}

/** 空行键（由键实现自己算出来；别在调用点写死 `''` / `'[]'` 这类字面量） */
export function fuzzyBlankKey(opts: FuzzyKeyOpts): string {
  return fuzzyLineKey('', { ...opts, blankLine: 'keep' }) as string;
}

// ════════════════════════════════════════════════════════════════════════════

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

/**
 * 字节级（L1）出现位置 —— **唯一实现**：`locateReplaceText` 的 L1 与
 * `classifyReplaceTextMiss` 的 new_text 计数都走它（两处各写一遍扫描就会漂移：
 * 一处认 1 次、另一处认 2 次，回执就会同时说"未找到"和"已经应用过"）。
 */
function findExactOccurrences(content: string, idx: LineIndex, text: string, level: 1 | 2 = 1): FuzzyMatch[] {
  const hits: FuzzyMatch[] = [];
  let pos = content.indexOf(text);
  while (pos !== -1) {
    const startLine = idx.lineOf(pos) + 1;
    const endOffset = pos + text.length;
    const endLine = endOffset === pos ? startLine : idx.lineOf(endOffset - 1) + 1;
    hits.push({ start: pos, end: endOffset, startLine, endLine, level, matchedText: text, targetIndent: '' });
    pos = content.indexOf(text, pos + 1);
  }
  return hits;
}

export function locateReplaceText(content: string, oldText: string): LocateResult {
  const idx = buildLineIndex(content);
  const fileLines = idx.lines;
  const oldLines = oldText.replace(/\r\n/g, '\n').split('\n');

  // 键算法只读一次（四个级共用同一个 mode；也免得"半路换档"）
  const mode = fuzzyKeyMode();
  const optsL2: FuzzyKeyOpts = { mode, keepIndent: true, blankLine: 'keep' };
  const optsL3: FuzzyKeyOpts = { mode, keepIndent: false, blankLine: 'drop' };

  // ── L1 exact：字节级唯一命中（保持既有行为，含行内/跨行/带尾换行） ──
  const exact = findExactOccurrences(content, idx, oldText);
  if (exact.length > 0) {
    return { match: exact.length === 1 ? exact[0] : null, candidates: exact, level: 1 };
  }

  // ── 含省略号 ⇒ L1 失败后直接 L4（L2/L3 的逐行键对不上带 '...' 的段） ──
  const withEllipsis = oldLines.some(isEllipsisLine);

  // ── L2 空白归一：整行锚定窗口（行首缩进保留、token 流等价、边缘空行忽略） ──
  if (!withEllipsis) {
    const blank2 = fuzzyBlankKey(optsL2);
    const oldKeys = oldLines.map((l) => fuzzyLineKey(l, optsL2) as string);
    while (oldKeys.length > 0 && oldKeys[0] === blank2) oldKeys.shift();
    while (oldKeys.length > 0 && oldKeys[oldKeys.length - 1] === blank2) oldKeys.pop();
    if (oldKeys.length > 0 && oldKeys.length <= fileLines.length) {
      const fileKeys = fileLines.map((l) => fuzzyLineKey(l, optsL2) as string);
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
    const oldKey3 = oldLines.map((l) => fuzzyLineKey(l, optsL3)).filter((k): k is string => k !== null);
    if (oldKey3.length > 0) {
      const filtered: Array<{ line: number; key: string }> = [];
      for (let i = 0; i < fileLines.length; i++) {
        const k = fuzzyLineKey(fileLines[i], optsL3);
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

  // ── L4 省略号占位：'...' 行 = 省略任意行，其余段按 L3 键顺序锚定（与 L3 同一把键） ──
  if (withEllipsis) {
    // 切段：省略号行分段；每段内部丢空行、取 L3 键
    const segs: string[][] = [];
    let cur: string[] = [];
    for (const l of oldLines) {
      if (isEllipsisLine(l)) {
        segs.push(cur.filter((k): k is string => k !== null));
        cur = [];
      } else {
        const k = fuzzyLineKey(l, optsL3);
        if (k !== null) cur.push(k);
      }
    }
    segs.push(cur.filter((k): k is string => k !== null));
    const hasAnchor = segs.some((s) => s.length > 0);
    if (hasAnchor) {
      const filtered: Array<{ line: number; key: string }> = [];
      for (let i = 0; i < fileLines.length; i++) {
        const k = fuzzyLineKey(fileLines[i], optsL3);
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

/**
 * ★★★ 2026-10-28（T287）：`old_text` 找不到时，**必须能区分三件事** ——
 * 「**已经应用过**」（old 不在、new 在**恰好一处**）、「**new_text 有歧义**」（new 在**多处**）、
 * 「**从没命中**」（两个都不在）。
 *
 * ## 为什么这是判据而不是文案
 * 之前 `planReplaceText` 一律抛「未找到 old_text」⇒ 同一次编辑**应用第二次**时，
 * 回执说"未找到"而盘上其实**早已是 new_text**。读回执的人会以为没生效，于是再改一次
 * ——或者反过来以为改了、其实没改。**同一判据在 `refactor_plan` 里另有一份**（`locOld`/`locNew` 各 locate 一次），
 * 两处口径不同 ⇒ 正是本仓头号病"同一判据住两处"。
 *
 * ## 判据（一条判据，两处共用）—— **只认 L1（字节级出现次数）**
 * · `n = 1` ⇒ `already_applied`（附行号）；
 * · `n > 1` ⇒ `ambiguous`（说不出"已经应用过"的是**哪一处**；此前拿四级级联判 `new_text`，
 *   于是 `new_text` 出现两次反而报 `not_found`，两个方向都错）；
 * · `n = 0` ⇒ `not_found`（**不许**把"空 new_text"当成"已应用"：删除操作的新文本本来就是空）。
 * ★ 这一侧**不许**用模糊级：模糊级问的是"这段文本还在不在（排版宽容）"，这里问的是
 * "它到底出现了几次（计数）"—— 两件事，用同一个级联判就是把计数问题当成了定位问题。
 */
export type ReplaceTextMiss =
  | { kind: 'already_applied'; line: number }
  | { kind: 'ambiguous'; count: number; lines: number[] }
  | { kind: 'not_found' };

export function classifyReplaceTextMiss(content: string, oldText: string, newText: string): ReplaceTextMiss {
  // 空 old 不该走到这里（调用方已拒），但防御性返回 not_found —— "什么都没有"不是"已应用"
  if (!oldText || !newText || !newText.trim()) return { kind: 'not_found' };
  // 若 old 其实还在（比如调用方拿错了变量），这里不表态：那是"定位成功"的世界，不是"未命中"
  if (locateReplaceText(content, oldText).match) return { kind: 'not_found' };
  const idx = buildLineIndex(content);
  const hits = findExactOccurrences(content, idx, newText, 2);
  if (hits.length > 1) return { kind: 'ambiguous', count: hits.length, lines: hits.map((h) => h.startLine) };
  if (hits.length === 1) return { kind: 'already_applied', line: hits[0].startLine };
  return { kind: 'not_found' };
}

/** 判成「已应用」的**依据**（进回执，供人核）—— 两档都是「上一次应用留下的痕迹」，但证据不同。 */
export type ReplaceTextAppliedHow =
  /** `old_text` 已不在，而 `new_text` 在文件里**恰好一处**（`classifyReplaceTextMiss` 那一档） */
  | 'new-text-present'
  /** `old_text` 唯一命中，但该命中区间被一处 `new_text` **严格覆盖**（插入式替换，如 `A` → `A\nB`） */
  | 'inside-new-text';

/** `classifyReplaceTextApply` 的两态：`already_applied` = 这次**不必写盘**；`pending` = 交给定位那一步（≠「肯定没应用过」） */
export type ReplaceTextApplyState =
  | { kind: 'already_applied'; line: number; how: ReplaceTextAppliedHow }
  | { kind: 'pending' };

/**
 * ★★★ 2026-11-02：**「这条 `replace_text` 现在该不该写盘」**的判据（唯一出处）。
 *
 * ## 它补的那条腿（不变量：同一条替换重复应用 ⇒ 文件字节必须不变）
 * `classifyReplaceTextMiss` 只在 **`old_text` 找不到**时被问（`planReplaceText` 的 `!loc.match` 分支），
 * 于是**插入式替换**（`new_text` 严格包含 `old_text`，如 `A` → `A\nB`）重复应用时判不出来：
 * old 仍在（它正是上一次插进去那段的前缀）⇒ 定位成功 ⇒ 照常再插一遍 ⇒ 同一段代码出现两次，
 * 之后对它的任何 `replace_text` 都变成「不唯一」。批量 `targets[]` 被重试就踩这个。
 *
 * ## 两条腿（都问「上一次应用留下的痕迹在不在」）
 * ① old 已不在、new 恰一处 ⇒ 委托 `classifyReplaceTextMiss`（**不在本函数重算**）；
 * ② old 唯一命中，且该命中区间被一处 `new_text` **严格覆盖**（相等不算 —— 那是空操作，由 `noop` 报）。
 *    ★ 同义必命中：上一次可能经 L3 按命中缩进重排过 ⇒ 同时拿
 *      `realignNewTextTo(newText, 命中行实际缩进, eol)` 再判一次。
 *    ★ 异义必不命中：只认 L1 字节级出现（`findExactOccurrences`），不认模糊级 —— 这里问的是
 *      「这段文本在不在」，不是「排版像不像」。
 *
 * ## 不表态的两档（`pending`，交回 `planReplaceText` 原样报错，**不在这里造第二套文案**）
 * · `old_text` 命中**多处** ⇒ 真歧义（说不出改哪一处，**不许猜**）；
 * · 其余（old 不在且 new 不在 / new 多处）⇒ `planReplaceText` 各有原话。
 */
export function classifyReplaceTextApply(
  content: string,
  oldText: string,
  newText: string,
  eol: string,
): ReplaceTextApplyState {
  if (!oldText || typeof newText !== 'string') return { kind: 'pending' };
  const loc = locateReplaceText(content, oldText);
  // 命中多处 ⇒ 真歧义：说不出改哪一处，交回 planReplaceText 报错（不在这里判「已应用」）
  if (loc.candidates.length > 1) return { kind: 'pending' };
  if (loc.match) {
    const m = loc.match;
    const idx = buildLineIndex(content);
    const variants = [newText, realignNewTextTo(newText, leadingWs(idx.lines[idx.lineOf(m.start)]), eol)];
    for (const v of variants) {
      if (!v.trim()) continue;
      for (const h of findExactOccurrences(content, idx, v)) {
        // **严格**覆盖：相等不算（相等是「空操作」，由 planReplaceText 的 noop 报）
        if (h.start <= m.start && m.end <= h.end && (h.start < m.start || m.end < h.end)) {
          return { kind: 'already_applied', line: m.startLine, how: 'inside-new-text' };
        }
      }
    }
    return { kind: 'pending' };
  }
  const miss = classifyReplaceTextMiss(content, oldText, newText);
  return miss.kind === 'already_applied'
    ? { kind: 'already_applied', line: miss.line, how: 'new-text-present' }
    : { kind: 'pending' };
}

/**
 * ═══ `AGENT_IO_FUZZY_KEY` 的三档与 `old` 的**删除条件**（可判，两条都成立即可删） ═══
 *
 * · `tolerant`（默认）＝ token 流判等：内容不同 ⇒ 不命中；真排版（缩进 / 行尾空白 / CRLF /
 *   空行 / 行内空格宽窄 / 运算符紧凑）⇒ 仍命中（后者要求同 token 流，如 `a - b` ↔ `a-b`）。
 * · `strict` ＝ 在 tolerant 之上再要求**算子两侧空白一致**（更紧；默认不开）。
 * · `old` ＝ 旧行为（字符级去空白；`helloworld` ↔ `hello world` 会命中）—— **回滚通道**。
 *
 * ★ 删 `old` 的判据（两条都成立才删；删完这档就从 `FUZZY_KEY_MODES` 里消失）：
 *   ① 真实回执里「`level >= 2` 且 `fuzzyTokens(matchedText) !== fuzzyTokens(oldText)`」的次数 = 0
 *      —— 口径落地为 tests/p0_fuzzy_token_key.test.ts 的「等价类一致性」组（它拿同一批语料
 *      同时问 tolerant 与 old，只要有一例 old 命中而 tolerant 不命中，就说明边界还没定对）；
 *   ② 合成语料（30 段 × 9 变形）**加一个外部项目**上，「内容不同」类变形的误命中 = 0。
 *   两条都成立 ⇒ `old` 与 tolerant 的差别只剩"错得更多"，它就该消失（0.9 一处权威 / 0.3 不许补丁）。
 */
