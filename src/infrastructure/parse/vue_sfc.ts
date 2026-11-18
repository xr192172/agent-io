/**
 * Vue SFC 组合式解析（执行席 B / feat-vue-sfc）。
 *
 * 为什么存在：注册表里 `.vue` 挂 `agent-io-grammar-vue`，该 grammar 只把 `export_statement`
 * 当符号节点 ⇒ `<script>` 里的 Options API / methods / import 全部被 traverse 跳过，
 * 且 `error` 为空 —— 静默失败（实测 fuintAdmin 154 个 .vue 四类读数全零）。
 *
 * 修法 = 组合式：正则切出全部 `<script>` 块，按 `lang` 分派给既有 JS/TS tree-sitter 解析
 * （虚拟路径仅用于选 parser），再把行号 / 字符偏移回填到整份 SFC 坐标系。
 *
 * ★ 零运行环：本文件对 kernel 只有 `import type`（编译期擦除）；子解析器由 kernel 注入。
 *   kernel 的 `parseFileFull` / `parseFileFullSync` 在最顶部把 `.vue` 转交这里，
 *   子路径以 `.js`/`.ts`/… 结尾，不会再次命中 `.vue` 分派。
 *
 * ★ parser='vue-sfc' 是诚实标注：读数来自真 JS 语法树（不是正则降级），
 *   所以 signature 不加 `[ts-fallback]` 之类前缀。
 */
import type {
  ParsedFile,
  ParsedSymbol,
  ParsedImport,
  ParsedCall,
  ParsedTypeRef,
  ParsedIdentifier,
} from './kernel.js';

/** 解析来源标记（判据串之一） */
export const VUE_SFC_PARSER = 'vue-sfc';

/**
 * 子解析器注入契约 —— kernel 绑自己的 `parseFileFull` / `parseFileFullSync`。
 * `virtualPath` 只决定选哪门子语言 parser；它不改写返回的 source / qualified_name。
 */
export interface VueSubParsers {
  parseAsync(virtualPath: string, scriptContent: string): Promise<ParsedFile>;
  parseSync(virtualPath: string, scriptContent: string): ParsedFile;
}

type ChildExt = '.ts' | '.tsx' | '.jsx' | '.js';

interface ScriptBlock {
  content: string;
  /** 内容首字符在整份 SFC 里的 0-based 字符偏移 */
  contentStart: number;
  /** 内容首字符之前的换行数 = 该字符的 0-based 行号 */
  baseRowZero: number;
  childExt: ChildExt;
}

/**
 * 切块正则（B 席在 3 个最复杂 .vue 上实测零干扰）：
 *   组 1 = 属性串，组 2 = 脚本正文；`[^>]*` 保证 open tag 的第一个 `>` 就是属性结束。
 * `i` 只为兼容 `<SCRIPT>`，不引入新的假阳性（小写 `<script>` 本来就命中）。
 */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** `<script src="…">`：外链脚本，正文不产符号 */
const HAS_SRC_RE = /\bsrc\s*=/i;
/** `lang="…"` / `lang='…'` / `lang=ts` */
const LANG_RE = /\blang\s*=\s*["']?([^"'\s>]+)/i;

/** lang → 子语言扩展名；非 JS 族（wxs / renderjs / coffee / pug …）返回 null = 跳过 */
function childExtOf(langAttr: string | undefined): ChildExt | null {
  if (!langAttr) return '.js';
  switch (langAttr.trim().toLowerCase()) {
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
      return null; // 非 JS 语言：不产符号（不静默——这里是明确的"跳过"）
  }
}

/** 从整份 SFC 切出所有可解析的 `<script>` 块；顺序即出现顺序 */
function collectScriptBlocks(sfc: string): ScriptBlock[] {
  const out: ScriptBlock[] = [];
  SCRIPT_RE.lastIndex = 0; // 全局正则在共享对象上，显式归零
  let m: RegExpExecArray | null;
  while ((m = SCRIPT_RE.exec(sfc)) !== null) {
    const attrs = m[1] ?? '';
    if (HAS_SRC_RE.test(attrs)) continue;
    const langMatch = LANG_RE.exec(attrs);
    const childExt = childExtOf(langMatch?.[1]);
    if (childExt === null) continue;
    // open tag 的 `>` 紧跟属性串；`[^>]*` 保证它就是 m[0] 里的第一个 `>`
    const gt = m[0].indexOf('>');
    const contentStart = m.index + gt + 1;
    const content = m[2] ?? '';
    // baseRow = 内容首字符之前的换行数（0-based 行号）；公式见施工卡第 5 条
    let baseRowZero = 0;
    for (let i = 0; i < contentStart; i++) if (sfc.charCodeAt(i) === 10) baseRowZero++;
    out.push({ content, contentStart, baseRowZero, childExt });
  }
  return out;
}

// ── 12 字段回填（纯函数；不原地改子解析结果，免污染 kernel 侧缓存） ──

function shiftLine(n: number, baseRowZero: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n + baseRowZero : n;
}

function shiftSymbol(s: ParsedSymbol, baseRowZero: number): ParsedSymbol {
  return { ...s, start_line: shiftLine(s.start_line, baseRowZero), end_line: shiftLine(s.end_line, baseRowZero) };
}

function shiftImport(im: ParsedImport, baseRowZero: number, contentStart: number): ParsedImport {
  return {
    ...im,
    line: shiftLine(im.line, baseRowZero),
    ...(typeof im.start_index === 'number' ? { start_index: im.start_index + contentStart } : {}),
    ...(typeof im.end_index === 'number' ? { end_index: im.end_index + contentStart } : {}),
  };
}

function shiftCall(c: ParsedCall, baseRowZero: number): ParsedCall {
  return { ...c, line: shiftLine(c.line, baseRowZero) };
}

function shiftTypeRef(t: ParsedTypeRef, baseRowZero: number): ParsedTypeRef {
  return { ...t, line: shiftLine(t.line, baseRowZero) };
}

function shiftIdentifier(id: ParsedIdentifier, baseRowZero: number, contentStart: number): ParsedIdentifier {
  return {
    ...id,
    line: shiftLine(id.line, baseRowZero),
    start_index: id.start_index + contentStart,
    end_index: id.end_index + contentStart,
  };
}

/** calls 去重键：\u0000 分隔，避免字段里含逗号误撞（实测同三元组最高 ×23） */
function callKey(c: ParsedCall): string {
  return `${c.caller}\u0000${c.callee}\u0000${c.line}`;
}

interface Merged {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  type_refs: ParsedTypeRef[];
  identifiers: ParsedIdentifier[];
  errors: string[];
}

function emptyMerged(): Merged {
  return { symbols: [], imports: [], calls: [], type_refs: [], identifiers: [], errors: [] };
}

/** 把一块子解析结果合并进汇总（两种入口共用，唯一一份回填逻辑） */
function mergeBlock(acc: Merged, parsed: ParsedFile, block: ScriptBlock): void {
  const { baseRowZero, contentStart } = block;
  for (const s of parsed.symbols ?? []) acc.symbols.push(shiftSymbol(s, baseRowZero));
  for (const im of parsed.imports ?? []) acc.imports.push(shiftImport(im, baseRowZero, contentStart));
  for (const c of parsed.calls ?? []) acc.calls.push(shiftCall(c, baseRowZero));
  for (const t of parsed.type_refs ?? []) acc.type_refs.push(shiftTypeRef(t, baseRowZero));
  for (const id of parsed.identifiers ?? []) acc.identifiers.push(shiftIdentifier(id, baseRowZero, contentStart));
  if (parsed.error) acc.errors.push(parsed.error);
}

function finish(acc: Merged): ParsedFile {
  // calls 三元组去重（跨 script 块一并去重）：\u0000 分隔
  const seen = new Set<string>();
  const calls: ParsedCall[] = [];
  for (const c of acc.calls) {
    const k = callKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    calls.push(c);
  }
  return {
    symbols: acc.symbols,
    imports: acc.imports,
    calls,
    type_refs: acc.type_refs,
    ...(acc.identifiers.length ? { identifiers: acc.identifiers } : {}),
    parser: VUE_SFC_PARSER, // 无 script 也标 —— 这是区别"旧空转"的标志
    ...(acc.errors.length ? { error: acc.errors.join('; ') } : {}),
  };
}

/** 空结果（无 script / 全被跳过），仍诚实标 parser='vue-sfc' */
function emptyResult(): ParsedFile {
  return { symbols: [], imports: [], calls: [], type_refs: [], parser: VUE_SFC_PARSER };
}

/** 异步入口：kernel 在最顶部把 `.vue` 转交过来 */
export async function parseVueSfc(
  filePath: string,
  content: string,
  sub: VueSubParsers,
): Promise<ParsedFile> {
  const blocks = collectScriptBlocks(content);
  if (blocks.length === 0) return emptyResult();
  const acc = emptyMerged();
  for (const block of blocks) {
    // 虚拟路径只用于选 parser：`foo.vue` + `.js` => `foo.vue.js`，递归不再自咬 `.vue`。
    const virtualPath = `${filePath}${block.childExt}`;
    try {
      const parsed = await sub.parseAsync(virtualPath, block.content);
      mergeBlock(acc, parsed, block);
    } catch (e) {
      acc.errors.push(`[vue-sfc] ${virtualPath}: ${(e as Error).message}`);
    }
  }
  return finish(acc);
}

/** 同步孪生：与 async 同构，仅子解析器不同（syncFileSync 的真写穿路径） */
export function parseVueSfcSync(
  filePath: string,
  content: string,
  sub: VueSubParsers,
): ParsedFile {
  const blocks = collectScriptBlocks(content);
  if (blocks.length === 0) return emptyResult();
  const acc = emptyMerged();
  for (const block of blocks) {
    const virtualPath = `${filePath}${block.childExt}`;
    try {
      const parsed = sub.parseSync(virtualPath, block.content);
      mergeBlock(acc, parsed, block);
    } catch (e) {
      acc.errors.push(`[vue-sfc] ${virtualPath}: ${(e as Error).message}`);
    }
  }
  return finish(acc);
}
