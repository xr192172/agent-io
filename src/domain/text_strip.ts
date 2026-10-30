/**
 * ★★★ 2026-10-30（subagent:rule-strip · 判据 `source-has` 匹配前剥注释）：**只剥注释的最小扫描器 —— 零 import**。
 *
 * ## 为什么单独占一个 domain 文件（不复用 `infrastructure/parse/comments.ts#stripCommentsSync`）
 * ① **domain 不许依赖 infrastructure**（本仓有 `domain-independent` 判据）⇒ 判据执行核要调它，只能住在 domain；
 * ② **零 import 是硬要求**：`behavior-cases` 的 harness 会把目标文件**单独转译再 import**
 *    ⇒ 有 import 就报 `目标文件加载失败: Cannot find module …`（手册 §3.4）。
 *
 * ## 它解决什么（实测代价）
 * `source-has` 原是**纯子串**匹配 ⇒ 注释里出现也算命中。C1/C3 两张卡为了把
 * `mustNot:["INTRODUCED_BY_MODULE"]` / `["PKG_DIRS"]` 变绿，**只能把注释里的旧名字删掉** ——
 * 判据在惩罚"记录病史"，而本仓文化是病史留痕 ⇒ 匹配前先剥注释。
 *
 * ## 边界（如实写，别在别处包装）
 * · 只认两种注释：行注释（两个斜杠到行尾）与块注释（斜杠星 … 星斜杠；剥掉但**保留换行**，行号仍对得上）；
 * · **字符串字面量原样保留**：单引号 / 双引号 / 模板里的东西一律不动（否则 `"http://x"` 会被吃掉半行）；
 * · 转义反斜杠认识（`'it\'s // x'` 不会被误判成注释开头）；
 * · **正则字面量不建模**：字符类里出现注释开头会被当成真注释 ⇒ 容错方向选"**宁可少剥、也不吃掉代码**"
 *   （用它的地方只有判据文本匹配，多留一段注释最多是假绿，吃掉代码就是假红）。
 */

/** 代码文本的扩展名白名单（小写比较）—— `stripCommentsFor` 的唯一判据 */
const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * 这个路径是不是**代码文本**（⇒ 才剥注释）。
 *
 * ★ 为什么必须按扩展名区分（不是"顺手统一剥"）：**markdown 的 `//source`、JSON 里的 `//` 都不是注释** ——
 *   用同一条规则剥，会把文档 / 数据判据的字面量当注释吃掉（本仓 design-db 的 `//source` 行就是活例子）。
 *   ⇒ `source-has` 只对代码扩展名剥注释，其余**按原文**匹配。
 */
export function isCodeText(path: string): boolean {
  const p = String(path ?? '').toLowerCase();
  const dot = p.lastIndexOf('.');
  if (dot < 0) return false;
  return (CODE_EXTS as readonly string[]).includes(p.slice(dot));
}

/**
 * 剥注释：行注释（两个斜杠到行尾）与块注释（斜杠星 … 星斜杠）。
 * 字符串字面量（单 / 双 / 模板）**内容原样保留**；块注释里的换行**保留**（剥完行号仍对得上）。
 */
export function stripComments(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = code[i];
    // ① 字符串字面量：整段复制（含引号），只认转义，不管里面的 // 与 斜杠星
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        const d = code[i];
        if (d === '\\') {
          out += d;
          i++;
          if (i < n) {
            out += code[i];
            i++;
          }
          continue;
        }
        out += d;
        i++;
        if (d === q) break;
      }
      continue;
    }
    // ② 行注释：剥到行尾（换行留着，下一圈会照常输出）
    if (c === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    // ③ 块注释：剥掉但保留其中的换行
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * `source-has` 用的唯一入口：**代码文本先剥注释，其它（.md / .json / 无扩展名）按原文返回**。
 * ★ 判据（扩展名白名单）住 `isCodeText`，这里只做分派 —— 不许在调用方再各写一套。
 */
export function stripCommentsFor(path: string, code: string): string {
  const text = String(code ?? '');
  return isCodeText(path) ? stripComments(text) : text;
}

// ─────────────────────────────────────────────────────────────
// ★★★ 2026-10-31（subagent:b1a-landing · 判据 `E-CRIT-006` 的唯一实现）：**这个文件靠不靠自己 load 得起来**。
// ─────────────────────────────────────────────────────────────

/**
 * ★★★ 2026-10-31：**值 import 扫描** —— 回答"这个文件能不能被单独转译再 import"。
 *
 * ## 它治的是哪条根因（用户原话）
 * 「量具不是我要的…这些量具都是你自己长出来的 —— 因为**没有行为落点**，只能写 `source-has` 那种文本代理。」
 * 链条是：文件里没有**零依赖纯函数** ⇒ `behavior-cases` 的 harness 单独转译它时 load 失败
 * （`目标文件加载失败: Cannot find module 'typescript'`）⇒ 只能退成 `source-has`（存在类，永远发现不了逻辑错）
 * ⇒ 必漂 ⇒ 被删 ⇒ 落点还是没有 ⇒ 再发明一个量具。
 * ⇒ 所以在**写判据那一刻**就问一句：目标文件有没有"值 import"？有就当场拒，并说清两条出路。
 *
 * ## 口径（判定就是这三条，别处不许多一套）
 * · **算值 import**：`import x from '…'` / `import {a, b} from '…'` / `import * as ns from '…'` /
 *   `import '…'`（副作用）/ `require('…')` / `export … from '…'`（再导出也会真的 load）；
 * · **不算**：`import type {…} from` / `import type X from` / 具名**全是** `type` 前缀的
 *   `import { type A, type B } from` / `export type {…} from`（类型全被擦除，不 load）；
 * · ★ **混合形态算**：`import { type A, B } from` —— B 是值。
 *
 * ## 边界（诚实，别在别处包装）
 * · **先剥注释再扫**（复用本文件的 `stripComments`）—— 注释里的 `import ts from 'x'` 不是 import；
 * · 再**掩掉字符串体内字符**（`const s = "import x from 'y'"` 同理）；两处都保住长度 ⇒ 下标与原文一一对应，
 *   样本可以回原文切（掩码后的模块名是空格，不能拿来当样本）；
 * · 语句边界：以 `;` 断句，无 `;` 时取到行尾（本仓代码都带分号；无分号写法只会**少判**，不会错判成别的语句）；
 * · **动态 `import('x')` 不建模**（它是表达式、不是语句；本仓没有这种用法）。
 */
export interface ValueImportScan {
  /** 值 import 的处数（`import type` / 全 type 具名 / `export type` 都不计） */
  count: number;
  /** 最多 3 条样本（形如 `import ts from 'typescript'`）—— 给人看"哪几处在 load" */
  samples: string[];
}

/**
 * 把**字符串字面量体内**的字符换成空格（引号 / 反引号本身保留，长度不变 ⇒ 与 `stripComments` 输出同下标）。
 * ★ 为什么必须有这一步：`stripComments` 是**保留**字符串的（`source-has` 要按原文匹配），
 *   而扫 import 时 `const s = "import x from 'y'"` 里的字样**不是** import。
 * ★ 模板串的 `${…}` 一并掩掉 —— import 语句不会住在模板插值里。
 */
function maskStringBodies(code: string): string {
  const chars = code.split('');
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c !== '"' && c !== "'" && c !== '`') {
      i++;
      continue;
    }
    const q = c;
    i++;
    while (i < n) {
      const d = code[i];
      if (d === '\\') {
        chars[i] = ' ';
        i++;
        if (i < n) {
          chars[i] = ' ';
          i++;
        }
        continue;
      }
      if (d === q) break;
      chars[i] = d === '\n' ? '\n' : ' ';
      i++;
    }
    i++;
  }
  return chars.join('');
}

/** 从 `from` 起到**这条语句结束**（`;` 或行尾；括号内不跨断句）—— 只用来切 import / export 语句 */
function statementAt(text: string, from: number): string {
  const n = text.length;
  let i = from;
  let depth = 0;
  while (i < n) {
    const c = text[i];
    if (c === '{' || c === '(') {
      depth++;
      i++;
      continue;
    }
    if (c === '}' || c === ')') {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && (c === ';' || c === '\n')) break;
    i++;
  }
  return text.slice(from, i);
}

/** 具名列表里有没有"不是 `type` 修饰"的项 ⇒ 有就是值 import（`{ type A, B }` 算值，`{ type A, type B }` 不算） */
function namedListHasValue(binding: string): boolean {
  const open = binding.indexOf('{');
  const close = binding.lastIndexOf('}');
  const inner = close > open ? binding.slice(open + 1, close) : binding;
  return inner
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .some((it) => !/^type\s+\S/.test(it));
}

/** 这条语句会不会**真的 load** 别的模块（= 值 import） */
function isValueImportStatement(stmt: string): boolean {
  const s = stmt.trim();
  if (!s) return false;
  if (/^export\b/.test(s)) {
    if (!/\bfrom\s*['"]/.test(s)) return false; // 只是导出本文件的绑定 ⇒ 不 load 别的模块
    if (/^export\s+type\b/.test(s)) return false; // 类型再导出（擦除）
    const fromIdx = s.search(/\bfrom\s*['"]/);
    const binding = s.slice('export'.length, fromIdx).trim();
    return binding.startsWith('{') ? namedListHasValue(binding) : true; // export * from / export * as ns from
  }
  if (/^import\s*['"]/.test(s)) return true; // 副作用导入
  if (/^import\s+type\b/.test(s)) return false; // import type {…} / import type X
  const fromIdx = s.search(/\bfrom\s*['"]/);
  if (fromIdx >= 0) {
    const binding = s.slice('import'.length, fromIdx).trim();
    if (!binding) return false;
    return binding.startsWith('{') ? namedListHasValue(binding) : true;
  }
  return /\brequire\s*\(\s*['"]/.test(s); // import x = require('…')
}

const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** 样本单行长度上限（再长就截断 —— 样本是给人看的，不是给人 copy 的） */
const SAMPLE_MAX = 120;

/**
 * 扫一个源文件的**值 import**（口径与边界见 `ValueImportScan` 上方那段注释）。
 * ★ 纯函数、**零 import**：`behavior-cases` 的 harness 会把本文件单独转译再 import ⇒ 它自己也必须"零 import"。
 */
export function scanValueImports(src: string): ValueImportScan {
  const raw = stripComments(String(src ?? ''));
  const text = maskStringBodies(raw);
  const hits: Array<{ at: number; end: number; sample: string }> = [];
  // ① 语句级：全文找 `import` / `export` 关键字，再由 `statementAt` 切到语句边界。
  //   ★ 为什么**不锚行首**：锚行首会让"先剥注释"变成**死代码** —— 注释行本来就不以 import 开头。
  //     真正只有剥过注释才挡得住的是这两类：① 注释里被注掉的真 import（`// import ts from 'x'` 之外，
  //     还有 `const a = 1; /* import ts from 'x' */` 这种**同行块注释**）；② 语句前面挂一块注释。
  const stmtRe = /\b(import|export)\b/g;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(text)) !== null) {
    const at = m.index;
    const masked = statementAt(text, at);
    const end = at + masked.length;
    if (isValueImportStatement(masked)) {
      const one = collapseWs(raw.slice(at, end));
      hits.push({ at, end, sample: one.length > SAMPLE_MAX ? `${one.slice(0, SAMPLE_MAX - 3)}…` : one });
    }
    stmtRe.lastIndex = end > stmtRe.lastIndex ? end : stmtRe.lastIndex + 1;
  }
  // ② 表达式级：`require('…')`（不在已计语句里的才另算，避免 `import x = require('y')` 数两遍）
  const reqRe = /\brequire\s*\(\s*['"]/g;
  while ((m = reqRe.exec(text)) !== null) {
    const at = m.index;
    if (hits.some((h) => at >= h.at && at < h.end)) continue;
    const closeAt = raw.indexOf(')', at);
    const end = closeAt < 0 ? at + m[0].length : closeAt + 1;
    hits.push({ at, end, sample: collapseWs(raw.slice(at, end)) });
  }
  hits.sort((a, b) => a.at - b.at);
  return { count: hits.length, samples: hits.slice(0, 3).map((h) => h.sample) };
}
