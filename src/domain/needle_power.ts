/**
 * ★★★ 2026-11-05（R5 / subagent:r5-needle）：**针级鉴别力量具** ——
 * 「这条 `source-has` 的针，能不能被 import 行**单独**满足？」
 *
 * ## 它治的那档假绿（实测：113 条 source-has 里 14 条）
 * `source-has` 的 `must` 里有一类针（`typeMembersOf` / `rootsOf` / `projectRootOf` / `listDesignSheets` …）
 * **只住在 import 行也成立** ⇒ 把实体行里的接线删干净（`members: typeMembersOf(node)` 那一段），判据**仍然绿**：
 * 它守的是「这个文件**提过**这个名字」，不是「这个文件**用了**它」。
 *
 * ## 判据（本卡的定义，可证；主控实测得出 —— 不要自己另造）
 * 把 `must` 在目标文件里的命中行分成两类：**import 行** / **实体行**。
 * ```
 * 只要 import 行能单独满足它（import ≥ 1）⇒ 确定瞎（blind）
 *   A 档 = 实体 0   ：针只住在 import 行 —— 使用它的代码早就没了，判据还在绿
 *   B 档 = 实体 ≥ 1 ：删掉实体行里的接线，import 还在 ⇒ 仍绿
 * 反过来：命中的全是实体行（import = 0）⇒ 有鉴别力（别动它）
 * ```
 * ★★ **不许**用「出现次数 ≥ 2」当判据（主控试过，是错的）：`Camprobe` 在 `.java` 里出现 4 次，
 * 但删掉类声明 4 处同时消失 ⇒ 它会**正确变红**，不瞎。**只有「能否被 import 行单独满足」是对的。**
 *
 * ## 为什么「行分类」不用 AST（0.18① 要求的说明）
 * 要判的**不是**「这个节点是不是 import 声明」（那 AST 能给），而是
 * 「**这一行文本**能不能单独满足这根**任意文本针**」：
 * ① `source-has` 的 `path` 可以是 `.md` / `.json` / 无扩展名（`isCodeText` 只管剥不剥注释）⇒ 那些目标**没有 AST**；
 * ② 本文件住 domain，而 AST 注释区间（`infrastructure/parse/comments.ts`）与 `identifiers` 表（`cache.db`）
 *    都住 infrastructure —— domain 不许引（`domain-independent` 判据正看着这件事）；
 * ③ **针是任意片段文本，不是符号**：AST 没有「这根针」这个概念，符号表也答不出「这段散文落在哪一行」。
 * ★ 代价如实写：正则判「行形状」会被**字符串字面量**骗（`const s = "from 'x'"` 会被当成 import 行）。
 * 方向是**变宽**（更易判成 import ⇒ 更易报 blind ⇒ **假红**）；假红会被人看见，假绿不会 —— 故意的取舍。
 *
 * ## 与别处的分工（0.9.1：一件事一处）
 * · 「某段文本里这根针在不在」的权威 = `expectation_kinds.ts#needlePresent`（本文件**不重写**匹配腿，
 *   也不自己判适配哪条腿）—— 否则量具说 blind、判据说「根本不在」，各有一把尺；
 * · 「判据实际匹配的是哪份文本」（剥不剥注释）的权威 = `application/design/intent/expectations.ts#sourceHasTextOf`
 *   —— 也不在这里（那需要 fs + AST，domain 引不到）。
 * ⇒ 本文件只回答**第二个问题**：命中落在哪些行、够不够格被 import 行单独满足。
 *
 * ## 边界（0.17①：什么我管、什么我不管）
 * · **管**：给定「一根针 + 一份**判据实际匹配的**文本」⇒ 行分布 / blind / 档位；
 * · **不管**：怎么拿到那份文本（调用方给，见上）· 怎么挑「该看哪几条判据」（调用方从册里取）·
 *   同一文件内**多处调用点**的鉴别力（那要调用图，`source-has` 结构上表达不了 —— 挂账，不在这里硬凑）。
 */
import { needlePresent } from './expectation_kinds.js';

/** 一根针的分布与结论（字段顺序 = 契约：`behavior-cases` 的 `expect` 是它的 `JSON.stringify`） */
export interface NeedlePower {
  needle: string;
  /** 命中落在**import 行**上的行号（1-based，升序；这些命中能被 import 行**单独**满足） */
  importLines: number[];
  /** 命中落在**实体行**上的行号（1-based，升序） */
  bodyLines: number[];
  /** 能否被 import 行单独满足（= `importLines.length > 0`） */
  blind: boolean;
  /** `blind` 时的档位：A = 实体 0 / B = 实体 ≥ 1；不瞎 ⇒ `null` */
  tier: 'A' | 'B' | null;
}

/**
 * **import 行的形状**（判据是这三种形态，别处不许再分档）。
 *
 * ★ 为什么只有三条而「`= await import`」不单列：它是 `import(` 的**真子集**
 * （`= await import('x')` 必然命中 `/\bimport\s*\(/`）⇒ 单列一条就是同一个判据写两遍（0.9.1 方向 A）。
 * 反向可判：列出四条时，第二条与第四条对**任何**输入都同真同假。
 */
export const IMPORT_LINE_PATTERNS: readonly RegExp[] = [
  /\bfrom\s*['"]/, // import {x} from './y.js' / export {x} from './y.js'（再导出也算接线）
  /\bimport\s*\(/, // 动态 import()（含 `= await import(...)`）
  /\brequire\s*\(/, // CJS require()
];

/**
 * 这一行是不是 **import 行**（能凭自己满足一根针的那种行）。
 * ★ 注入点：`needlePower` 的 `opts.isImportLine` 只为**消融**存在（把它改成恒 false ⇒ A/B 两档必须变不瞎）。
 */
export function isImportLine(line: string): boolean {
  const l = String(line ?? '');
  return IMPORT_LINE_PATTERNS.some((re) => re.test(l));
}

/** 行号计算：这段文本里第 `at` 个字符落在第几行（1-based） */
function lineOfIndex(text: string, at: number): number {
  let line = 1;
  for (let i = 0; i < at && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * 这根针命中了哪几行（1-based，升序去重）。
 *
 * ★ 多行针（含换行）：逐行判必然全落空 —— 那不是「没有」，是「逐行判不适用」。
 *   退回整体定位并记**起始行**；调用方据此把整段计入实体行（一行 import **不可能**装下跨行匹配）。
 */
function hitLinesOf(text: string, needle: string): number[] {
  const n = String(needle ?? '');
  if (n === '') return [];
  if (n.includes('\n')) {
    const out: number[] = [];
    let i = text.indexOf(n);
    while (i >= 0) {
      out.push(lineOfIndex(text, i));
      i = text.indexOf(n, i + 1);
    }
    return [...new Set(out)].sort((a, b) => a - b);
  }
  const out: number[] = [];
  const lines = text.split('\n');
  lines.forEach((l, k) => {
    if (needlePresent(l, n)) out.push(k + 1);
  });
  return out;
}

export interface NeedlePowerOptions {
  /** 行分类替身（**只为消融**：恒 false ⇒ blind 必须全变 false，证明结论来自这里） */
  isImportLine?: (line: string) => boolean;
}

/**
 * 量具入口：一根针 + 判据实际匹配的文本 ⇒ 分布 / blind / 档位。
 * ★ `text` **必须**是判据实际匹配的那份（`sourceHasTextOf` 的产物）—— 拿原文量会把注释行数成实体行 ⇒ 假绿。
 */
export function needlePower(needle: string, text: string, opts: NeedlePowerOptions = {}): NeedlePower {
  const src = String(text ?? '');
  const n = String(needle ?? '');
  const classify = opts.isImportLine ?? isImportLine;
  const lines = src.split('\n');
  const spanning = n.includes('\n');
  const importLines: number[] = [];
  const bodyLines: number[] = [];
  for (const ln of hitLinesOf(src, n)) {
    // 跨行匹配不可能整段落在某一行 import 里 ⇒ 一律记实体行（否则会报一个假 blind）
    if (!spanning && classify(lines[ln - 1] ?? '')) importLines.push(ln);
    else bodyLines.push(ln);
  }
  const blind = importLines.length > 0;
  return { needle: n, importLines, bodyLines, blind, tier: blind ? (bodyLines.length === 0 ? 'A' : 'B') : null };
}

/** 一条 `source-has` 判据的**全部** `must` 逐根算（`mustNot` 不算：它禁止在场，import 行满足它反而更强） */
export function needlePowersOf(
  e: { must?: readonly string[] },
  text: string,
  opts: NeedlePowerOptions = {},
): NeedlePower[] {
  return (e.must ?? []).map((n) => needlePower(n, text, opts));
}

/** 只挑**确定瞎**的那些针（= 这条判据能被 import 行单独满足的证据集）；空数组 = 有鉴别力 */
export function blindNeedlePowersOf(
  e: { must?: readonly string[] },
  text: string,
  opts: NeedlePowerOptions = {},
): NeedlePower[] {
  return needlePowersOf(e, text, opts).filter((p) => p.blind);
}

/**
 * 「最弱的那一条 must」—— 报告用（`blindNeedlePowersOf` 才是判据用的全集）。
 * 排序：A 档（连实体都没有）< B 档 < 不瞎；同档按命中行数（少者更弱），再按针名（确定性）。
 */
export function weakestNeedlePower(
  e: { must?: readonly string[] },
  text: string,
  opts: NeedlePowerOptions = {},
): NeedlePower | null {
  const all = needlePowersOf(e, text, opts);
  if (all.length === 0) return null;
  const rank = (p: NeedlePower): number => (p.tier === 'A' ? 0 : p.tier === 'B' ? 1 : 2);
  const hits = (p: NeedlePower): number => p.importLines.length + p.bodyLines.length;
  const byName = (a: NeedlePower, b: NeedlePower): number => (a.needle < b.needle ? -1 : a.needle > b.needle ? 1 : 0);
  return [...all].sort((a, b) => rank(a) - rank(b) || hits(a) - hits(b) || byName(a, b))[0];
}
