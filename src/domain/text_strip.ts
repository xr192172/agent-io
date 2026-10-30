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
