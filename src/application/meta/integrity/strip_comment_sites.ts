/**
 * strip_comment_sites —— 全仓「剥注释实现点」的**唯一读数**（R6 · 0.9.1② 的「按能力数」）。
 *
 * ## 它回答什么
 * 「**全仓有几个地方在剥注释**」—— 这个数**必须现数**：R6 之前按**名字** grep 只数到 3 处，
 * 按**能力**实测是 **11 处**（2 权威 + 9 私有），其中 6 处无名内联实现**按名字永远数不到**。
 *
 * ## 口径（机械、可判，别在这里再发明一套）
 * 一个**实现点** = 一处自己把注释从代码文本里去掉、并把结果交给下游的代码单元。
 * 同一文件里**相邻（≤4 行）**的命中合并成 1 点（那是同一条 `.replace` 链）。
 *
 * 三条腿**同时**用（0.19④ / 0.9.1②）：
 * - **形态腿①（块注释）**：`.replace(` 且源码里出现 `\/` + `\*`（= 正则 `/\*` 的字面形态）；
 * - **形态腿②（行注释）**：`.replace(` 且源码里出现 `\/` + `\/`（= 正则 `//` 的字面形态）；
 * - ★★ **形态腿③（手写跨行块状态机）**：窗口内同时出现块注释的开/闭标记字面量 ∧ **同一个标识符被分别赋 true / false**
 *   （= 跨行块状态位）。**2026-11-06 加**：只有前两条腿时本模块报「实现点 3 / 未声明 0」，而真值是 8 ——
 *   `infrastructure/analysis/contract_gate/core.ts#cleanSource/cleanLine` 是手写状态机，前两条腿**结构上看不见它**；
 *   更坏的是 `tests/p0_strip_comment_authority.test.ts` 当时钉着 `total===3`，把那个假绿焊死了。
 *   判定核在 `crossLineBlockStateMachine`（边界写在那里）。
 * - ★ **名字腿单用是噪音，IO 腿单用更是噪音**（R6 实测：单用「吃串吐串」得 83/487 全噪音；
 *   单用 `//` 形态会把 `replace(/\/+$/, '')` 这种**路径归一化**全数进来 25 行）⇒ 这里只认
 *   **转义后的 `\/`**（路径正则写的是单个 `\/`，注释正则写的是成对 `\/\/`），噪声才归零。
 * - **注释行一律跳过**：本仓文档注释里大量出现这些正则字面量，不跳会数出 3630 行假命中。
 *
 * ## 三张声明表（为什么必须有表 —— 0.25②③）
 * 扫描器只负责**找候选**；「这条算不算实现点」是**分类**，必须逐条写明理由：
 * - `AUTHORITIES`：**该有的那两份**（按 0.9.1④ 分工：有 filePath ⇒ 整文件；无 ⇒ 片段）。它们用 AST /
 *   状态机，**没有 `.replace(` 形态** ⇒ 扫描器永远找不到 ⇒ 只能声明 + **逐一验证符号还在**（不是写死数字）。
 * - `DECLARED`：**语言特定、如实声明保留**的那一处（乙类）。
 * - `EXCLUDED`：**被形态腿误检、但不是剥注释**的那些（例如 `^file:\/\/` 是 URL 不是注释）。
 * ⇒ 扫描到的候选**不在任何表里** ⇒ `undeclared` 非空 ⇒ **红**。新写第二份剥注释实现，这一条会亮。
 *
 * ## 边界（它证不出什么）
 * - 它证不出「某个实现点**剥得对**」—— 那由行为判据管（`text_strip#stripComments` 的 behavior-cases）。
 * - 它只扫 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs`；`.go` / `.py` 里的实现**扫不到**（本仓没有）。
 * - 它按**文本形态**找，不解析 AST：把注释剥离写成状态机（不是正则）的**新实现**它扫不到 ——
 *   那类只能靠 `DECLARED` 手工登记（这也是 `AUTHORITIES` 只能声明的原因）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 一个实现点的分类 */
export interface StripSite {
  /** 仓库相对路径（正斜杠） */
  file: string;
  /** 1-based 行号 */
  line: number;
  kind: 'authority-file' | 'authority-fragment' | 'declared-language-specific' | 'not-a-comment-stripper';
  /** 这条为什么算（或为什么不算）—— 必填，不许空着 */
  why: string;
}

export interface StripSurvey {
  /** 该有的那份：整文件权威 + 片段权威（0.9.1④ 的分工） */
  authorities: StripSite[];
  /** 乙类：语言特定、如实声明保留 */
  declared: StripSite[];
  /** 被形态腿误检、但不是剥注释（逐条写清理由） */
  excluded: StripSite[];
  /** ★ 必须为空：扫到却没有任何声明的人 */
  undeclared: Array<{ file: string; line: number; text: string }>;
  /** 声明了却**磁盘上找不到该符号**的权威 —— 也必须为空 */
  missingAuthorities: string[];
  /** ★ 实现点分母 = authorities + declared（不写死数字，现算） */
  total: number;
  /** 分母：本次扫了多少个源文件（0.12③：只给分子等于没验） */
  scanned: number;
}

/** 该有的那两份（0.9.1④：输入里有 filePath ⇒ 整文件；没有 ⇒ 片段）。★ 它们的符号必须**逐次现验**。 */
const AUTHORITIES: ReadonlyArray<{ file: string; symbol: string; kind: StripSite['kind']; why: string }> = [
  {
    file: 'src/infrastructure/parse/comments.ts',
    symbol: 'stripCommentsSync',
    kind: 'authority-file',
    why: '整文件权威：吃 filePath + content，按 **AST 注释区间**剔（字符串与 Go raw string 里的 // 天生不会被吃）；null = 没查成',
  },
  {
    file: 'src/domain/text_strip.ts',
    symbol: 'stripComments',
    kind: 'authority-fragment',
    why: '片段权威：无 filePath 的代码文本（类型表达式 / 形参 / 单行 / 函数体片段），字符串字面量原样保留',
  },
];

/**
 * 乙类：**语言特定、如实声明保留**。
 * ★ 只有一处 —— 判据是「两个权威都不覆盖它的那部分」，不是「它用起来方便」。
 */
const DECLARED: ReadonlyArray<{ file: string; match: string; why: string }> = [
  {
    file: 'src/infrastructure/analysis/health/index.ts',
    match: 'estimateComplexityRegex',
    why:
      '① 它守的是**圈复杂度的正则回退路径**：数 if/elif/for/while/case/catch/except 之前必须同时去掉 `//`、`/*…*/` 与 **`#`**；' +
      '② 为什么权威不覆盖：`text_strip#stripComments` 不认 `#`（Python 注释），`comments.ts#stripCommentsSync` 要 filePath 而这里只有 `body: string`；' +
      '③ **它证不出什么**：Python 字符串里的 `#`（`s = "a # b"`）它不管 —— 那种输入下分支会被多算，方向是**多报复杂度**（不减分、不误删）。',
  },
];

/** 被形态腿误检、但**不是剥注释**（`match` 是该行的一段可辨识子串；对不上 ⇒ 该条自动失效，不静默） */
const EXCLUDED: ReadonlyArray<{ file: string; match: string; why: string }> = [
  {
    file: 'src/infrastructure/index/function_outline.ts',
    match: 'replace(/^\\/\\*\\*?/',
    why: '只剥 **docstring 的定界符**（`^/**` 与尾 `*/`），不剥注释正文；对象是已提取出来的 JSDoc 行文本，剥的是标记不是注释',
  },
  {
    file: 'src/infrastructure/parse/kernel.ts',
    match: '^file:\\/\\/',
    why: '`file://` 里的 `//` 是 **URL 的一部分**，不是注释起始',
  },
];

/** 一个源文件是不是要扫 */
const CODE_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** 该行本身是不是注释行（本仓文档注释里大量出现这些正则字面量，不跳会数出几千行假命中） */
function isCommentLine(text: string): boolean {
  const s = text.trim();
  return s.startsWith('*') || s.startsWith('//') || s.startsWith('/*');
}

/** 形态腿①：`.replace(` + 源码里的 `\/\*`（= 正则 `/\*` 的字面形态） */
function looksLikeBlockStrip(line: string): boolean {
  return /\.replace\(/.test(line) && /\\\/\\\*/.test(line);
}

/** 形态腿②：`.replace(` + 源码里的 `\/\/`（= 正则 `//` 的字面形态；路径归一化写的是单个 `\/`） */
function looksLikeLineStrip(line: string): boolean {
  return /\.replace\(/.test(line) && /\\\/\\\//.test(line);
}

/**
 * ★★ 形态腿③的窗口：跨行块状态位与它的注释开闭标记不会隔得太远（±25 行）。
 * ★ 为什么是窗口而不是"同一个函数"：本模块刻意不引 kernel（要能在任何进程里跑）⇒ 按行窗口是**可判**的近似；
 *   它只负责**找嫌疑人**，不定罪（定罪靠三张声明表逐条写明）。
 */
const STATE_WINDOW = 25;

/** 块注释「开」的**标记字面量**（源码里写成带引号的斜杠星）；本行刻意不写裸的星斜杠序列 */
const STR_BLOCK_OPEN = /['"]\/\*['"]/;

/** 块注释「闭」的**标记字面量**（源码里写成带引号的星斜杠）；同样不写裸序列 */
const STR_BLOCK_CLOSE = /['"]\*\/['"]/;

/** 布尔赋值：`inBlock = true` / `st.v = false` —— 用来找"跨行块状态位"（★ 数值位 0/1 不会被它命中，见下） */
const BOOL_ASSIGN = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*=\s*(true|false)\b/g;

/**
 * ★★★ 形态腿③：`at` 附近是不是一段**手写跨行块注释状态机**。
 *
 * ## 它治的是哪次假绿（2026-11-06 · R6 实测，先有事故后有这条腿）
 * 只有前两条形态腿（`.replace(` + 转义的斜杠序列）时，本模块在 `src/` 上报
 * `total=3`（权威 2 + 已声明 1）、`undeclared=0` —— 而真值是 **8**：
 * `src/infrastructure/analysis/contract_gate/core.ts#cleanSource/cleanLine` 是**手写字符状态机**
 * （跨行块标志位 + `indexOf` 找注释开闭），它既不以 `stripComments` 命名、也不含 `.replace(` 形态
 * ⇒ 前两条腿**结构上看不见它**。⇒ 那个"3"是**假绿**，还被 `tests/p0_strip_comment_authority.test.ts`
 * 的 `total===3` 断言焊死了（0.9.1② 的"按名字/按形态数会漏"在这里第二次兑现）。
 *
 * ## 判据（两条同时成立；两条都是**形态**，不看名字）
 * ① 窗口里出现**块注释的开与闭两个标记字面量**（带引号的斜杠星 / 星斜杠）；
 * ② **同一个标识符**被分别赋过 `true` 与 `false` —— 那就是"当前在不在块注释里"的跨行状态位。
 *
 * ## 边界（它证不出什么，如实写）
 * · **数值状态位**（`let inBlock = 0; inBlock = 1`）不被命中 —— 这是**故意的**：本模块自己就得用数值位，
 *   否则它会把自己数成嫌疑人（自指污染）。⇒ 这一档靠 `DECLARED` 手工登记，不假装自动覆盖。
 * · 只按**行窗口**看，不解析 AST ⇒ 相隔 25 行以上的"状态位与标记"会漏（方向是**少报**，不会误伤）。
 * · 它只产出**候选**；某条候选算不算实现点仍由 `AUTHORITIES` / `DECLARED` / `EXCLUDED` 三张表逐条写明。
 */
function crossLineBlockStateMachine(lines: readonly string[], at: number): boolean {
  const lo = Math.max(0, at - STATE_WINDOW);
  const hi = Math.min(lines.length - 1, at + STATE_WINDOW);
  let openSeen = 0;
  let closeSeen = 0;
  /** 标识符 → 被赋过的布尔值集合（同一标识符既 true 又 false 才是状态位） */
  const flags = new Map<string, Set<string>>();
  for (let k = lo; k <= hi; k++) {
    const l = lines[k];
    if (isCommentLine(l)) continue;
    if (STR_BLOCK_OPEN.test(l)) openSeen = 1;
    if (STR_BLOCK_CLOSE.test(l)) closeSeen = 1;
    BOOL_ASSIGN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BOOL_ASSIGN.exec(l)) !== null) {
      const id = m[1];
      let vals = flags.get(id);
      if (!vals) {
        vals = new Set<string>();
        flags.set(id, vals);
      }
      vals.add(m[2]);
    }
  }
  if (openSeen === 0 || closeSeen === 0) return false;
  for (const vals of flags.values()) if (vals.has('true') && vals.has('false')) return true;
  return false;
}

/** 递归列源文件（相对 `projectDir`，正斜杠） */
function listSourceFiles(projectDir: string, roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (abs: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // 目录读不到 ⇒ 这段没有（调用方有 scanned 分母，不会把它读成"全绿"）
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (CODE_RE.test(e.name)) out.push(path.relative(projectDir, p).replace(/\\/g, '/'));
    }
  };
  for (const r of roots) walk(path.join(projectDir, r));
  return out.sort();
}

/** 该文件里有没有这个符号名（声明表按符号而非行号锚定 —— 行号会漂，符号不会） */
function fileHasSymbol(projectDir: string, file: string, symbol: string): boolean {
  try {
    return fs.readFileSync(path.join(projectDir, file), 'utf8').includes(symbol);
  } catch {
    return false;
  }
}

/**
 * 现数全仓「剥注释实现点」。
 * @param projectDir 项目根
 * @param roots 扫哪些目录（默认 `['src']` —— 生产面；`tests/` 里的夹具本地实现是**另一档**，不计入）
 */
export function surveyStripCommentSites(projectDir: string, roots: readonly string[] = ['src']): StripSurvey {
  const files = listSourceFiles(projectDir, roots);
  const authorities: StripSite[] = [];
  const missingAuthorities: string[] = [];

  // ① 权威：扫描器找不到它们（AST / 状态机，没有 .replace 形态）⇒ 只能声明 + **现验符号还在**
  for (const a of AUTHORITIES) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(projectDir, a.file), 'utf8');
    } catch {
      missingAuthorities.push(`${a.file}#${a.symbol}（文件读不到）`);
      continue;
    }
    const decl = new RegExp(`export\\s+function\\s+${a.symbol}\\s*\\(`);
    if (!decl.test(text)) {
      missingAuthorities.push(`${a.file}#${a.symbol}（文件里找不到该导出符号）`);
      continue;
    }
    const idx = text.split('\n').findIndex((l) => decl.test(l));
    authorities.push({ file: a.file, line: idx + 1, kind: a.kind, why: a.why });
  }

  // ② 私有候选：形态腿扫出来的实现点（同一文件内相邻 ≤4 行合并成 1 点）
  const candidates: Array<{ file: string; line: number; text: string }> = [];
  const lineCache = new Map<string, string[]>();
  for (const rel of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(path.join(projectDir, rel), 'utf8').split('\n');
    } catch {
      continue;
    }
    lineCache.set(rel, lines);
    let prevLine = -99;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (isCommentLine(l)) continue;
      // ★ 三条形态腿：腿①②看 `.replace(` 形态，腿③看手写跨行块状态机。★ 缺腿③ 就漏一整个类（见头注）。
      if (!looksLikeBlockStrip(l) && !looksLikeLineStrip(l) && !crossLineBlockStateMachine(lines, i)) continue;
      if (i + 1 - prevLine <= 4) {
        prevLine = i + 1;
        continue; // 同一条 .replace 链的后续行
      }
      candidates.push({ file: rel, line: i + 1, text: l.trim() });
      prevLine = i + 1;
    }
  }

  // ③ 分类：每个候选必须在 DECLARED 或 EXCLUDED 里（否则 ⇒ undeclared ⇒ 红）
  const declared: StripSite[] = [];
  const excluded: StripSite[] = [];
  const undeclared: StripSurvey['undeclared'] = [];
  for (const c of candidates) {
    const lineText = lineCache.get(c.file)?.[c.line - 1] ?? '';
    const ex = EXCLUDED.find((x) => x.file === c.file && (lineText.includes(x.match) || fileHasSymbol(projectDir, c.file, x.match)));
    if (ex) {
      excluded.push({ file: c.file, line: c.line, kind: 'not-a-comment-stripper', why: ex.why });
      continue;
    }
    const de = DECLARED.find((x) => x.file === c.file && fileHasSymbol(projectDir, c.file, x.match));
    if (de) {
      if (!declared.some((x) => x.file === c.file)) {
        declared.push({ file: c.file, line: c.line, kind: 'declared-language-specific', why: de.why });
      }
      continue;
    }
    undeclared.push(c);
  }

  return {
    authorities,
    declared,
    excluded,
    undeclared,
    missingAuthorities,
    total: authorities.length + declared.length,
    scanned: files.length,
  };
}
