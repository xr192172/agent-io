/**
 * card-vue-sfc：`.vue` SFC 的组合式解析（切块 → 递归既有 JS/TS 语法树 → 回填偏移）。
 *
 * ── 病史（本文件存在的唯一理由）
 * 修前 `parseFileFull('.vue', …)` **静默产零**：`languages.ts:115` 把 `vue` 注册成「可用」
 * （`pkgSpec: agent-io-grammar-vue`），于是 `!lang` / `!parser` 两个兜底分支都不命中，文件一路
 * 走到 `traverseAndExtract` —— 而 vue grammar 的 `symbol_nodes` 只有 `export_statement`，
 * SFC 的 `<script>` 体在它眼里不是任何符号节点 ⇒ symbols/imports/calls/type_refs **全空且
 * error 为空**。实测 fuintAdmin 154 个 `.vue` 就是这副读数（静默失败，最难查的那种）。
 *
 * ── 修法（组合式，不复刻 vue grammar、不依赖 vue 包）
 * 正则切出全部 `<script>` 块 ⇒ 按 `lang` 分派给**既有的** typescript/javascript 语法树
 * （虚拟路径 `.vue.ts` / `.vue.js` …，纯内存、零盘 IO）⇒ 行号/字符偏移回填到 SFC 坐标系
 * ⇒ calls 三元组去重 ⇒ `parser='vue-sfc'` **诚实标注**。
 *
 * ── 与 kernel 的关系（★ 依赖注入，不 import kernel —— 避免循环依赖）
 * 子解析器由 kernel 注入（`VueSubParsers`），kernel 绑自己的 `parseFileFull` / `parseFileFullSync`。
 * 故本文件零 import kernel，`vue_sfc ↔ kernel` 无环。
 *
 * ── 已知限度（不假装精确）
 *   · 只解析 `<script>` 体；`<template>` / `<style>` 不产符号（那是 UI 骨架的事，不是符号表）。
 *   · 非 JS 的 `lang`（`wxs` / `renderjs` / `json` / …）**整块跳过**：它们不是 JS/TS 语法，
 *     硬塞给 JS 语法树会造出伪符号 ⇒ 宁可少报。
 *   · `<script src="…">` 是外部引用：内容在别处，本块**跳过**（依赖边由那个真实文件自己产生）。
 *   · 无 `<script>` 的文件 ⇒ 全零 **但 `parser='vue-sfc'`** —— 这正是与旧「静默空转」的区别标志：
 *     读者能凭 parser 字段区分「解析过、确实没有脚本」和「根本没解析」。
 */
import type {
  ParsedCall,
  ParsedFile,
  ParsedIdentifier,
  ParsedImport,
  ParsedSymbol,
  ParsedTypeRef,
} from './kernel.js';

/** `ParsedFile.parser` 的取值：`.vue` 组合式解析（区别于 `'ts-fallback'` 的正则降级） */
export const VUE_SFC_PARSER = 'vue-sfc';

/**
 * 子解析器注入契约（终审契约第 4 条 `{parseAsync, parseSync}`）。
 *
 * ★ 为什么注入而不是 import：`kernel.ts` 要 import 本文件来分派，若本文件再 import kernel 取
 *   `parseFileFull` 就是环。注入同时把「异步/同步」两种获取方式显式化 —— 同步侧**绝不**
 *   触发动态 import（kernel 的「绝不半同步」纪律）。
 * ★ `virtualPath` 只决定选哪门子语言 parser；它不改写返回的 source / qualified_name ——
 *   返回的 imports/symbols/calls 仍按**真实 `.vue` 文件**的语义登记（调用方只用 rel/语言，
 *   不看这个虚拟路径）。
 */
export interface VueSubParsers {
  parseAsync(virtualPath: string, scriptContent: string): Promise<ParsedFile>;
  parseSync(virtualPath: string, scriptContent: string): ParsedFile;
}

/** 子语言扩展名（SFC 的 `<script lang>` 只可能落到这四种） */
type ChildExt = '.ts' | '.tsx' | '.jsx' | '.js';

/**
 * `<script>` 块匹配。`[^>]*` 吃属性（`lang="ts"` / `setup` / `src="…"`）。
 * ★ 实测口径：`href="javascript:;"` 这类属性值**不影响** `<script\b`（`\b` 挡掉 `javascript`），
 *   3 个最复杂的真实文件零误伤。
 * ★ 非贪婪 `</script>`：脚本体内不会出现字面 `</script>`（出现了浏览器自己也会提前截断）。
 * ★ `i` 只为兼容 `<SCRIPT>`，不引入新假阳性（小写本来也命中）。
 */
const SCRIPT_BLOCK_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** `<script src="…">`：外链脚本，正文不在本文件 ⇒ 不产符号 */
const HAS_SRC_RE = /\bsrc\s*=/i;
/** `lang="…"` / `lang='…'` / `lang=ts` */
const LANG_RE = /\blang\s*=\s*["']?([^"'\s>]+)/i;

/**
 * `lang` → 子解析扩展名；`null` = 不是 JS/TS，**整块跳过**。
 *
 * ★ 用**枚举**而不是「含 ts 就算 ts」：后者会把 `tsx` 吞成 `.ts`（丢 JSX 语法）、
 *   也会把未知 lang（`coffee` 含 `e`… 或将来某个含 `ts` 的名字）误判成 TS。
 *   枚举 + `default: null` 是「少报不误报」的那一侧。
 */
function childExtOf(langAttr: string | undefined): ChildExt | null {
  if (langAttr === undefined) return '.js'; // 裸 <script> ⇒ JavaScript（fuintAdmin 154/154）
  switch (langAttr.trim().toLowerCase()) {
    case '':
    case 'js':
    case 'javascript':
    case 'mjs':
    case 'cjs':
      return '.js';
    case 'jsx':
      return '.jsx';
    case 'ts':
    case 'typescript':
    case 'mts':
    case 'cts':
      return '.ts';
    case 'tsx':
      return '.tsx';
    default:
      return null; // wxs / renderjs / json / …：不是 JS/TS 语法，跳过
  }
}

/** 切出的一段可解析脚本 */
interface ScriptChunk {
  /** 脚本体原文（块内，不含标签） */
  content: string;
  /** 内容首字符在 SFC 全文里的 0-based 字符偏移（★ 回填 indexBase 用） */
  indexBase: number;
  /** 内容首字符在 SFC 全文里的 0-based 行号（★ 回填 lineBase 用） */
  lineBase: number;
  /** 子解析虚拟路径的扩展名 */
  ext: ChildExt;
}

/**
 * 把 SFC 切成脚本块（顺序即出现顺序）。
 *
 * ★ 偏移不靠 `SyntaxNodeLike.startIndex`（可选、且我们压根不建 vue 树）—— 直接由正则命中位置算：
 *   内容首字符 = `开标签结束的 '>' 之后一位`（`[^>]*` 保证它是 `m[0]` 里的第一个 `>`）。
 *   行号 = **数到内容首字符为止的换行数**。
 *
 * ★★ 这里有个只差一行的坑（M2 mutation 就抓它）：`lineBase` 必须数到**内容首字符**，
 *   不能拿「开标签所在行」充数 —— 当 `<script>\n` 把内容推到下一行时两者差 1，
 *   整个块的符号行号会整体上移一行（写进 nodes 的 start_line 就指向模板区）。
 */
function collectScriptChunks(source: string): ScriptChunk[] {
  const out: ScriptChunk[] = [];
  SCRIPT_BLOCK_RE.lastIndex = 0; // 全局正则在共享对象上，显式归零
  let m: RegExpExecArray | null;
  while ((m = SCRIPT_BLOCK_RE.exec(source)) !== null) {
    const attrs = m[1] ?? '';
    if (HAS_SRC_RE.test(attrs)) continue; // 外链：内容在别处
    const ext = childExtOf(LANG_RE.exec(attrs)?.[1]);
    if (ext === null) continue; // 非 JS/TS：跳过
    const content = m[2] ?? '';
    const indexBase = m.index + m[0].indexOf('>') + 1;
    let lineBase = 0;
    for (let i = 0; i < indexBase; i++) if (source.charCodeAt(i) === 10) lineBase++;
    out.push({ content, indexBase, lineBase, ext });
  }
  return out;
}

// ── 12 字段回填（纯函数；不原地改子解析结果，免污染 kernel 侧缓存） ──

/**
 * 行号回填：可空字段（`symbols.start_line/end_line`、`imports.line`、`calls.line`、
 * `type_refs.line`、`identifiers.line`）原样保留 `undefined` —— **不伪造 0/1**：
 * 伪造出来的行号会指向模板区，比缺失更糟（同 `traverseAndExtractIdentifiers`
 * 「没有字符偏移的节点不记」的纪律）。
 */
function shiftLine(n: number | undefined, lineBase: number): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? n + lineBase : n;
}

function shiftSymbol(s: ParsedSymbol, lineBase: number): ParsedSymbol {
  return { ...s, start_line: shiftLine(s.start_line, lineBase)!, end_line: shiftLine(s.end_line, lineBase)! };
}

function shiftImport(im: ParsedImport, lineBase: number, indexBase: number): ParsedImport {
  return {
    ...im,
    line: shiftLine(im.line, lineBase)!,
    ...(typeof im.start_index === 'number' ? { start_index: im.start_index + indexBase } : {}),
    ...(typeof im.end_index === 'number' ? { end_index: im.end_index + indexBase } : {}),
  };
}

function shiftCall(c: ParsedCall, lineBase: number): ParsedCall {
  return { ...c, line: shiftLine(c.line, lineBase)! };
}

function shiftTypeRef(t: ParsedTypeRef, lineBase: number): ParsedTypeRef {
  return { ...t, line: shiftLine(t.line, lineBase)! };
}

/**
 * 标识符回填：`start_index` / `end_index` 在 `ParsedIdentifier` 上是**必填 `number`**
 * （`kernel.ts` 的类型定义），所以这里直接相加，不做 undefined 分支。
 */
function shiftIdentifier(id: ParsedIdentifier, lineBase: number, indexBase: number): ParsedIdentifier {
  return {
    ...id,
    line: shiftLine(id.line, lineBase)!,
    start_index: id.start_index + indexBase,
    end_index: id.end_index + indexBase,
  };
}

/**
 * calls 去重键（★ 口径权威在本层，C 席裁定）。
 *
 * 为什么重复是真的：同一行的两个 `this.b()` 是两个不同的 AST 调用节点，kernel 各记一条；
 * 同一方法体跨多个 `<script>` 块时还会再多一份。对「谁调用了谁」这个消费者口径，
 * `(caller, callee, line)` 完全相同就是同一条边（行级粒度是契约）。
 *
 * ★ 分隔用 `\u0000` 而不是 `,` / `|`：标识符里不会出现 NUL，拼起来零碰撞。
 */
function callKey(c: ParsedCall): string {
  return `${c.caller}\u0000${c.callee}\u0000${c.line}`;
}

interface Accum {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  type_refs: ParsedTypeRef[];
  identifiers: ParsedIdentifier[];
  errors: string[];
}

function emptyAccum(): Accum {
  return { symbols: [], imports: [], calls: [], type_refs: [], identifiers: [], errors: [] };
}

/** 把一块子解析结果回填并合并进汇总（异步/同步两个入口共用，唯一一份回填逻辑） */
function absorb(acc: Accum, parsed: ParsedFile, chunk: ScriptChunk): void {
  const { lineBase, indexBase } = chunk;
  for (const s of parsed.symbols ?? []) acc.symbols.push(shiftSymbol(s, lineBase));
  for (const im of parsed.imports ?? []) acc.imports.push(shiftImport(im, lineBase, indexBase));
  for (const c of parsed.calls ?? []) acc.calls.push(shiftCall(c, lineBase));
  for (const t of parsed.type_refs ?? []) acc.type_refs.push(shiftTypeRef(t, lineBase));
  for (const id of parsed.identifiers ?? []) acc.identifiers.push(shiftIdentifier(id, lineBase, indexBase));
  // 子解析失败必须看得见（否则又回到「全零且 error 为空」）
  if (parsed.error) acc.errors.push(parsed.error);
}

function finish(acc: Accum): ParsedFile {
  // calls 三元组去重（跨 script 块一并去重；保留首次出现的那条）
  const seen = new Set<string>();
  const calls: ParsedCall[] = [];
  for (const c of acc.calls) {
    const k = callKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(c);
  }
  const out: ParsedFile = {
    symbols: acc.symbols,
    imports: acc.imports,
    calls,
    type_refs: acc.type_refs,
    parser: VUE_SFC_PARSER, // 无 script 也标 —— 这是区别「旧空转」的标志
  };
  // identifiers 是可选字段：一块都没有就不产出该字段（与 kernel 的既有形态一致）
  if (acc.identifiers.length) out.identifiers = acc.identifiers;
  if (acc.errors.length) out.error = acc.errors.join('; ');
  return out;
}

/** 空结果（无 script / 全被跳过）：全零，但仍诚实标 `parser='vue-sfc'` */
function emptyResult(): ParsedFile {
  return { symbols: [], imports: [], calls: [], type_refs: [], parser: VUE_SFC_PARSER };
}

/**
 * 解析 `.vue`（异步入口）—— kernel 在 `parseFileFull` 最顶部把 `.vue` 转交过来。
 *
 * @param filePath 真实 `.vue` 路径（只用于拼虚拟路径与错误信息）
 * @param content  SFC 全文
 * @param sub      子解析器（kernel 注入 `parseFileFull`）
 *
 * ★ 单块失败**不牵连**其它块：`try/catch` 就地收集错误（一块里语法崩了，另一块照样出符号）。
 */
export async function parseVueSfc(
  filePath: string,
  content: string,
  sub: VueSubParsers,
): Promise<ParsedFile> {
  const chunks = collectScriptChunks(content);
  if (chunks.length === 0) return emptyResult();
  const acc = emptyAccum();
  for (const chunk of chunks) {
    // 虚拟路径：仅供选 parser（ext 非 .vue ⇒ 永不再入本分支，不自咬）；纯内存、零盘 IO
    const virtualPath = `${filePath}${chunk.ext}`;
    try {
      absorb(acc, await sub.parseAsync(virtualPath, chunk.content), chunk);
    } catch (e) {
      acc.errors.push(`[vue-sfc] ${virtualPath}: ${(e as Error).message}`);
    }
  }
  return finish(acc);
}

/**
 * 解析 `.vue`（同步入口，⑤ 同步写穿）—— 与异步入口逐行同构，仅子解析器不同。
 *
 * ★ `syncFileSync` 是真写穿路径：漏改同步分派 = 只修异步、写穿仍全零（M4 mutation 抓它）。
 * ★ 本函数**绝不**触发动态 import：`parseSync` 走 `getParserSync`，未预热 ⇒ 子结果自带
 *   `解析器未预热: …` 的 error，本层原样透出（不静默）。
 */
export function parseVueSfcSync(
  filePath: string,
  content: string,
  sub: VueSubParsers,
): ParsedFile {
  const chunks = collectScriptChunks(content);
  if (chunks.length === 0) return emptyResult();
  const acc = emptyAccum();
  for (const chunk of chunks) {
    const virtualPath = `${filePath}${chunk.ext}`;
    try {
      absorb(acc, sub.parseSync(virtualPath, chunk.content), chunk);
    } catch (e) {
      acc.errors.push(`[vue-sfc] ${virtualPath}: ${(e as Error).message}`);
    }
  }
  return finish(acc);
}
