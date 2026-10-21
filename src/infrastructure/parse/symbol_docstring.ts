/**
 * symbol_docstring —— 「文档注释」的 AST 提取（`nodes.docstring`）
 *
 * ## 为什么要有它
 * `nodes.docstring` 这一列建库时就在，但**从来没写过**：kernel 的 `ParsedSymbol` 没有这个字段，
 * `symbols.ts` 的 INSERT 直接写死 `NULL` ⇒ 实测 0 / 8726（全空）。列在、注释写着「预留」、`facts`
 * 又能查它 ⇒ 读者会把它读成「这个符号确实没有文档」，而真相是「我们从来没取过」——
 * 这比没有这一列更坏。判据（用户）：**原 DB 要完整解析出来，AST 里能解析什么就写进来。**
 *
 * ## 判据纪律（与 `symbol_shape.ts` / `symbol_params.ts` 同一把尺）
 * 1. **只吃 AST**：哪一段算文档，由**规则表**（`DOCSTRING_SPECS`）里的节点类型 / 前缀决定；
 *    本文与 kernel 都**没有按语言的 if**。加语言 = 加一条数据；不登记 = 不取（落库 NULL）。
 * 2. **抽不到就省略**（落库 NULL），不猜。空串禁用（空串会被读成「文档确实是空的」）。
 * 3. **原文照录**：直接 `node.text`（多段逐行注释按序用换行拼），**不剥** `/**` `///` 引号 ——
 *    剥标记要按语言各定一套规则（javadoc 的行首星号、C# 的 XML 标签、Python 的三引号），
 *    那是**格式化意见**；而且剥过之后这段文本在源码里**搜不到**（消费方没法拿它回源核对）。
 *    ★ 多行注释**整段保留**，不截第一行 —— docstring 的价值就在完整。
 *
 * ## ★★「前驱注释算不算它的」—— 这条是**判据**，不是实现细节
 * 两条同时成立才算：
 *   ① **形状**：该节点必须是**本语言的文档格式**（表项 `mustStartWith`，如 `/**` 或 `///`）。
 *      ⇒ 普通行注释与普通块注释**一律不算**：TS 语言服务、javadoc、DocBlock、C# 编译器、
 *        rustdoc 都只认各自的文档格式 ⇒「紧邻的普通注释」不是文档，写 NULL 才对。
 *      ⇒ **Go 是唯一不写 `mustStartWith` 的语言**：godoc 的判据就是「紧邻的注释组即文档」，
 *        它没有第二种「文档语法」⇒ 这不是放宽，而是**照该语言的官方判据**。
 *   ② **紧邻**：注释的**最后一行**与声明的**第一行**之间**不超过 1 行**（中间有空行 ⇒ 不算）；
 *      多段逐行注释（Go / Rust / C#）要**逐段紧邻**，断开处以上为界。
 *      ★「最后一行」按**注释正文最后一个非空白字符**所在行算，**不用** `endPosition.row`：
 *        实测 tree-sitter-rust 的 `line_comment` 把**行尾换行**也包进节点（`endPosition` 落到下一行）
 *        ⇒ 用 endPosition 判紧邻会差一行，把「隔一个空行」误判成「紧邻」。
 *
 * ## 已知边界（说清楚，别让调用方以为「全提了」）
 * · **未登记的语言 ⇒ NULL =「没抽」，不是「没有」**（c / cpp / ruby / bash / scala / dart …）。
 *   C/C++ 的 doxygen 块注释是**可选惯例**，且本仓索引里 0 个 C/C++ 文件 ⇒ 先不登记（不硬凑）。
 * · **Python 是唯一「在体内取」的**：docstring = 体（`block`）的第一条语句、且**整条就是一个
 *   字符串字面量**；`#` 注释**永远不算**（PEP 257：docstring 是字符串字面量，不是注释）。
 * · **TS/JS 只认 JSDoc 形态（`/**` 开头）**，`//` 不算；**体内部的注释不取**（只有前驱有意义）。
 *   ★ 保守点：文件头 banner（`/** Copyright …`）若**紧贴**第一个声明且中间无空行，会被当成本文件
 *     第一个符号的文档 —— 这条误配在语法层面无法彻底排除（两道限制挡掉了绝大多数）。
 * · **文件节点（`kind='file'`）不写**：模块 docstring / 文件头 banner 不在本次范围（`symbols.ts` 里仍为 NULL）。
 */
import type { SyntaxNodeLike } from './kernel.js';

/**
 * 一门语言的文档注释规则（**纯数据**；`docstringOf` 只消费它，不写按语言分支）。
 * 某字段不写 = 本语言没有这条取法（⇒ 落到下一条 / 最终 NULL）。
 */
interface DocSpec {
  /**
   * ★ 体内取法（实测只有 python）：体节点的候选字段名 / 节点类型 → 体**首语句**；
   * 该语句**整条就是一个字符串字面量**时，它的原文就是 docstring。
   */
  bodyDoc?: {
    /** 体所在字段名（python `body`） */
    bodyFields: string[];
    /** 无字段语法的体节点类型（老版 python 是 `suite`） */
    bodyNodeTypes?: string[];
    /** 包在字符串外层的语句节点（python `expression_statement`） */
    wrapperNodes?: string[];
    /** 字符串字面量节点类型（python `string`） */
    stringNodes: string[];
  };
  /**
   * 前驱注释：`nodeTypes` 里的哪些节点算候选；
   * `mustStartWith` = 文本必须以其中之一开头才算文档（**省略 = 本语言不区分文档格式**，如 go）。
   */
  leadingComment?: { nodeTypes: string[]; mustStartWith?: string[] };
  /**
   * 前驱「属性形态」的文档（实测 rust `#[doc = "…"]`）：节点类型 + 文本判据。
   * ★ 命中才算文档；**同类型但不命中**（`#[inline]` / `#[cfg]`）按「跳过、不终止」处理 ——
   *   因为 rustdoc 允许 `/// 文档` 与 `#[inline]` 交错，二者都紧贴在声明上方。
   */
  docAttribute?: { nodeTypes: string[]; pattern: RegExp };
  /**
   * 先向上穿过这些父节点再找前驱兄弟。
   * ★ 实测（tree-sitter-typescript）：`export function f` 的树是
   *   `program → export_statement → function_declaration`，JSDoc 是 **`export_statement` 的前驱兄弟**，
   *   不是 `function_declaration` 的前驱兄弟 ⇒ 不上穿就一条也取不到。
   */
  climbParents?: string[];
}

/** ★ 每门语言的文档注释规则（**唯一住处**）。注释里写明「这个语言为什么这么取」。 */
const DOCSTRING_SPECS: Record<string, DocSpec> = {
  // ── Python ──────────────────────────────────────────────────────────────
  // 实测：docstring 是**体内第一条语句**（`function_definition → block → expression_statement → string`），
  //   原文自带三引号；函数前的 `#` 注释 tree-sitter 也给 `comment` 节点，但 Python **没有**
  //   「注释即文档」这回事（PEP 257 要求 docstring 是字符串字面量）⇒ 不取前驱，只取体内。
  python: {
    bodyDoc: { bodyFields: ['body'], bodyNodeTypes: ['block'], wrapperNodes: ['expression_statement'], stringNodes: ['string'] },
  },
  // ── TS / TSX ────────────────────────────────────────────────────────────
  // 实测：JSDoc 与 `export_statement` 同级（program 的子节点），class_body 里的方法则是
  //   `method_definition` 的前驱兄弟；只认 `/**`（TS 语言服务只把 JSDoc 当符号文档，`//` 不算）。
  typescript: {
    leadingComment: { nodeTypes: ['comment'], mustStartWith: ['/**'] },
    climbParents: ['export_statement'],
  },
  // ── JS / JSX：与 TS 同形（同两套语法，`tree-sitter-javascript`）────────────
  javascript: {
    leadingComment: { nodeTypes: ['comment'], mustStartWith: ['/**'] },
    climbParents: ['export_statement'],
  },
  // ── Go ──────────────────────────────────────────────────────────────────
  // 实测：注释是 `comment` 节点、与声明**同级**（source_file / block 的子节点），多行 = **多条 comment**。
  //   ★ 不写 mustStartWith：godoc 的判据就是「紧邻的注释组即文档」（Go 没有另一种文档语法）。
  //   ★ 隔空行 ⇒ 不算（实测：空行后的注释属于下一段，godoc 同此）。
  //   ★ climbParents：Go 的**类型**符号节点是 `type_spec`（`type_declaration` 的孩子），
  //     而注释是 `type_declaration` 的前驱兄弟 ⇒ 不上穿一层就取不到（实测：`type Cfg struct` 恒 NULL）。
  //     函数/方法节点的父级是 source_file / block，不在名单里 ⇒ 不受影响。
  go: {
    leadingComment: { nodeTypes: ['comment'] },
    climbParents: ['type_declaration'],
  },
  // ── Java ────────────────────────────────────────────────────────────────
  // 实测：javadoc 是 `block_comment`（`/**` 开头），与 `method_declaration` 同级、紧邻上一行；
  //   普通 `//` 是 `line_comment` ⇒ 不算（javadoc 工具只读 `/**` 块）。
  java: {
    leadingComment: { nodeTypes: ['block_comment'], mustStartWith: ['/**'] },
  },
  // ── Kotlin ──────────────────────────────────────────────────────────────
  // 实测：KDoc 是 `multiline_comment`（`/**` 开头）；`//` 是 `line_comment` ⇒ 不算。
  kotlin: {
    leadingComment: { nodeTypes: ['multiline_comment'], mustStartWith: ['/**'] },
  },
  // ── Rust ────────────────────────────────────────────────────────────────
  // 实测：`///` 是 `line_comment`（★ 节点文本**含行尾换行**，见文件头紧邻判据的说明），
  //   多行 = 多条 line_comment；`#[doc = "…"]` 是 `attribute_item`（同类型的 `#[inline]` 跳过不终止）。
  //   `//` 普通注释不算；`//!` 是**内层**文档（属于外层 item，不是下面这个符号的）⇒ 前缀不符即排除。
  rust: {
    leadingComment: { nodeTypes: ['line_comment'], mustStartWith: ['///'] },
    docAttribute: { nodeTypes: ['attribute_item'], pattern: /^#\[\s*doc\s*=/ },
  },
  // ── C# ──────────────────────────────────────────────────────────────────
  // 实测：XML 文档注释是**逐行的 `comment` 节点**（每行一个 `/// <summary>` …），紧邻上一行；
  //   普通 `//` 也是 `comment`（**同类型**）⇒ 只能靠前缀 `///` 区分（编译器只把 `///` 收进 XML doc）。
  c_sharp: {
    leadingComment: { nodeTypes: ['comment'], mustStartWith: ['///'] },
  },
  // ── PHP ─────────────────────────────────────────────────────────────────
  // 实测：DocBlock 是 `comment`（`/**` 开头）；`//` / `#` 同类型 ⇒ 靠前缀区分。
  php: {
    leadingComment: { nodeTypes: ['comment'], mustStartWith: ['/**'] },
  },
};

// tsx / jsx 与 ts / js **同一套语法**（`tree-sitter-typescript` / `tree-sitter-javascript`
// 的两个语言对象），规则直接复用；单独登记是因为内核按 `lang.name` 取规则。
DOCSTRING_SPECS.tsx = DOCSTRING_SPECS.typescript;
DOCSTRING_SPECS.jsx = DOCSTRING_SPECS.javascript;

/** 折叠首尾空白；空串 ⇒ undefined（「取不到」只有一个表示）。 */
function trimOrUndef(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * 注释正文**最后一个非空白字符**所在行（0-based）。
 * ★ 为什么不用 `endPosition.row`：实测 tree-sitter-rust 的 `line_comment` 把行尾换行也算进节点
 *   ⇒ `endPosition.row` 指向下一行，紧邻判据会差一行（把「隔一个空行」当成「紧邻」）。
 */
function lastContentRow(n: SyntaxNodeLike): number {
  const trimmed = n.text.replace(/\s+$/, '');
  if (!trimmed) return n.endPosition.row;
  let nl = 0;
  for (let i = 0; i < trimmed.length; i++) if (trimmed.charCodeAt(i) === 10) nl++;
  return n.startPosition.row + nl;
}

/** 节点在父节点里的下标（按 `startIndex` 比对：tree-sitter 的 `child()` 每次是新包装对象）。 */
function indexInParent(node: SyntaxNodeLike): number {
  const p = node.parent;
  if (!p) return -1;
  for (let i = 0; i < p.childCount; i++) {
    const c = p.child(i);
    if (!c) continue;
    if (c === node) return i;
    if (c.startIndex !== undefined && c.startIndex === node.startIndex && c.type === node.type) return i;
  }
  return -1;
}

/** 第一个命名子节点（跳过匿名关键字/标点；`isNamed` 缺省视为命名节点）。 */
function firstNamedChild(node: SyntaxNodeLike): SyntaxNodeLike | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.isNamed !== false) return c;
  }
  return null;
}

/** 体内取法（python）：体首语句**整条就是一个字符串字面量**时返回它的原文。 */
function bodyDocOf(node: SyntaxNodeLike, spec: NonNullable<DocSpec['bodyDoc']>): string | undefined {
  let body: SyntaxNodeLike | null = null;
  for (const f of spec.bodyFields) {
    const c = node.childForFieldName(f);
    if (c) {
      body = c;
      break;
    }
  }
  if (!body) {
    for (const t of spec.bodyNodeTypes ?? []) {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type === t) {
          body = c;
          break;
        }
      }
      if (body) break;
    }
  }
  if (!body) return undefined;

  const first = firstNamedChild(body);
  if (!first) return undefined;
  // ① 体首节点本身就是字符串字面量（部分语法不留语句包装）
  if (spec.stringNodes.includes(first.type)) return trimOrUndef(first.text);
  // ② 包在语句节点里：**整条语句只有那个字符串**才算。
  //    ★ `x = """…"""`（赋值）与 `"""…""".strip()`（多了调用）都不算 —— 用「语句原文 == 字符串原文」判，
  //      不写正则、也不猜「第一个子节点是字符串就当 docstring」。
  if (spec.wrapperNodes?.includes(first.type)) {
    const inner = firstNamedChild(first);
    if (!inner || !spec.stringNodes.includes(inner.type)) return undefined;
    if (first.text.trim() !== inner.text.trim()) return undefined;
    return trimOrUndef(inner.text);
  }
  return undefined;
}

/**
 * 前驱取法：从（上穿容器后的）声明节点往前扫兄弟节点，按**形状 + 紧邻**两条判据收注释。
 * 见文件头「前驱注释算不算它的」—— 那里是判据，这里是它的实现。
 */
function leadingDocOf(node: SyntaxNodeLike, spec: DocSpec): string | undefined {
  let target = node;
  for (const p of spec.climbParents ?? []) {
    if (target.parent && target.parent.type === p) target = target.parent;
    else break;
  }
  const parent = target.parent;
  if (!parent) return undefined;
  const idx = indexInParent(target);
  if (idx < 0) return undefined;

  const parts: string[] = [];
  /** 下沿：下一个被扫到的节点必须**紧邻**它（首轮 = 声明首行） */
  let cursor = target.startPosition.row;
  for (let i = idx - 1; i >= 0; i--) {
    const c = parent.child(i);
    if (!c) continue;
    if (c.isNamed === false) continue; // 匿名标点/关键字不是注释（不动 cursor）
    // ★ 判据②：隔了空行 ⇒ 断开（这条上面那段不是**这个**符号的注释）
    if (cursor - lastContentRow(c) > 1) break;

    let text: string | undefined;
    if (spec.leadingComment?.nodeTypes.includes(c.type)) {
      const prefixes = spec.leadingComment.mustStartWith;
      if (!prefixes || prefixes.some((p) => c.text.trimStart().startsWith(p))) text = c.text;
    }
    if (!text && spec.docAttribute?.nodeTypes.includes(c.type)) {
      if (spec.docAttribute.pattern.test(c.text.trim())) text = c.text;
      else {
        // 同类型的普通属性（rust `#[inline]`）⇒ 跳过、不终止：文档可以写在它上面
        cursor = c.startPosition.row;
        continue;
      }
    }
    // ★ 判据①：不是本语言的文档形态（普通注释 / 别的声明）⇒ 停。
    //   为什么停而不是跳过：`// x` 夹在 `/** doc */` 与声明之间时，doc **不**紧邻声明 ⇒ 不属于它。
    if (!text) break;

    const t = trimOrUndef(text);
    if (t) parts.unshift(t);
    cursor = c.startPosition.row;
  }
  return parts.length ? parts.join('\n') : undefined;
}

/**
 * 从一个符号声明节点抽**文档注释原文**。
 * ★ 未登记的语言 ⇒ `undefined`（落库 NULL =「没抽」）；登记了但确实没有文档 ⇒ 同样 `undefined`。
 *   ★ 两种 NULL 的区分只在「该语言是否登记过」——这在 `DOCSTRING_SPECS` 里，是数据，不是猜。
 */
export function docstringOf(node: SyntaxNodeLike, langName: string): string | undefined {
  const spec = DOCSTRING_SPECS[langName];
  if (!spec) return undefined;
  if (spec.bodyDoc) {
    const fromBody = bodyDocOf(node, spec.bodyDoc);
    if (fromBody) return fromBody;
  }
  if (spec.leadingComment || spec.docAttribute) return leadingDocOf(node, spec);
  return undefined;
}
