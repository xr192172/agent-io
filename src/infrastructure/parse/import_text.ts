/**
 * ts_kernel/import_text.ts —— TS import 语句的**文本级**解析（正则，不建 AST）
 *
 * ★ 为什么单独成模块（B1，2026-09-28）：下面这段逻辑曾在两个文件里**逐字相同**地存在两份 ——
 *   `tools/cli_extract.ts:39 extractImportMap` 与 `tools/registry_extract.ts:49 extractImportMap`
 *   （正则、`split/as` 过滤、`.replace(/^\.\//,'').replace(/\.js$/,'')` 全部一字不差）。
 *   两边的注释还都写着"相对具名 import：symbol → 模块" —— 即**同一条知识，两处落点**。
 *
 * ★ 与 `kernel.ts` 的关系（为什么不并进 kernel，也不并成一个"通用解析器"）：
 *   · `kernel.ts` 是**真 AST**（tree-sitter）——建符号表、算 import 边、判 type-only；
 *   · 本模块是**轻量文本快照**——只为"从源码文本里认出 `import { a, b } from './x'`"这一件事，
 *     用于 CLI/注册表这类**不需要语义**的抽取场景（零解析器依赖、可离线、极快）。
 *   两者服务不同场景，**并列而不合并**；但同一份知识只允许有一处落点 ⇒ 收在这里。
 *
 * ★ 适用边界：只认**相对**具名 import（`from './x'`）。裸包名、默认导入、命名空间导入、
 *   `export … from` 都不在范围内 —— 需要那些请走 `kernel.ts` 的 AST 路径，别在本模块上加补丁。
 */

/** `import [type] { a, b as c } from './x'` —— 只匹配相对路径 */
const RELATIVE_NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'(\.[^']+)'/g;

/** 单个说明符：`name` 或 `name as alias` */
const SPEC_ALIAS_RE = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/;
const SPEC_PLAIN_RE = /^[A-Za-z_$][\w$]*$/;

/**
 * 抽取「相对具名 import 的 符号 → 模块」映射（多行 import 亦可）。
 *
 * 模块串会去掉前导 `./` 与 `.js` 后缀 ⇒ `'./tools/brickify_cli.js'` → `'tools/brickify_cli'`。
 *
 * ★ 别名（`a as c`）**两个名字都收**（都指向同一模块）。
 *   为什么：本函数的两个消费者要的都是"**使用处写的那个名字**"——
 *     · `registry_extract`：把 TOOL_DEFS 里的 `handler: xxx` 反查回模块（写的是**本地名**）；
 *     · `cli_extract`：把 CLI 文件里引用的 handler 反查回模块（同样是**本地名**）。
 *   而本函数原先（两份逐字相同的旧实现）只收 `as` **前面**的远名 ⇒ 一旦有人写成
 *   `import { applyMatch as applyOneMatch } from './rule_match.js'`，查 `applyOneMatch` 就会落空。
 *   实测本仓已有 4 处带别名的相对具名 import（如 `src/application/refactor/rf-rules/rule_apply.ts:26`），
 *   只是都不在"被反查"的位置上 —— 属**潜伏**缺陷。
 *   两名字都收是**严格增量**：旧行为（远名可用）保留，新行为（本地名也可用）补上，不丢任何能力。
 *   （与本模块"轻量文本快照、宁可多收"的定位一致；真要区分远名/本地名请走 AST。）
 */
export function parseRelativeNamedImportMap(src: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of src.matchAll(RELATIVE_NAMED_IMPORT_RE)) {
    const mod = m[2].replace(/^\.\//, '').replace(/\.js$/, '');
    for (const raw of m[1].split(',')) {
      const s = raw.trim();
      const alias = s.match(SPEC_ALIAS_RE);
      if (alias) {
        map.set(alias[1], mod); // 远名（保留旧行为）
        map.set(alias[2], mod); // ★ 本地名（补上潜伏缺口）
        continue;
      }
      if (SPEC_PLAIN_RE.test(s)) map.set(s, mod);
    }
  }
  return map;
}
