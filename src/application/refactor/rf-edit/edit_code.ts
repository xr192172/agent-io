/**
 * edit_code：符号级语义编辑（Agent 第一性编辑路径）
 *
 * 设计动机（2026-08-18 狗食结论）：AI 用 old_string 文本匹配改代码，
 * 行号漂移 / 同名函数 / 相似代码块都会改错位置。既然 ts_kernel 已能
 * 定位"哪个文件、哪个函数、第几行、什么签名"，编辑也应按符号定位：
 * AI 只给 文件 + 符号名 + 新代码，工具重新解析当前文件、按 AST 符号
 * 边界替换——不信 AI 的行号，不信 AI 的 old_string。
 *
 * 安全设计：
 * - 替换后 re-parse 整个文件，解析失败 → 报错不写盘（防缩进/括号破坏）
 * - replace 的新代码必须解析出同名符号（防粘贴错函数）
 * - 同名多候选 → 报错列出候选（签名+行号），AI 传 parent 消歧后重试
 * - 写盘后自动 syncFile 重建该文件索引（新鲜度闭环：编辑即索引更新）
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 落盘形态：**有意保留的第三份**（2026-09-29 判定 —— 勿再"顺手统一"）
 * ─────────────────────────────────────────────────────────────
 * 本文件的落盘是内联四件套 `snapshotBeforeWrite → writeFileSync → syncFile → reopenAndResolveAfterWrite`，
 * **没有**走 `tools/apply_writes.ts` 的 `applyWrites()`（= `write_gate.writeSourceFiles` 的适配层）。
 * 第一刀（`b6e5647`）把它登记为"下一笔候选，请人拍板"；本笔拍板 = **保留**，判据是**实测**出的
 * 四条政策差异（不是"懒得改"，也不是"看着统一"）：
 *
 * 1. **索引政策相反**：本文件 =「编辑即建索引」——`syncFile(getProjectCacheDb(...))` 在**没有索引**的
 *    项目里会就地建库并同步该文件（`edit_code.test.ts`「未预热…编辑后索引已建立」锁定此行为）。
 *    而 `applyWrites` 继承 `write_gate` 的纪律「**绝不因为一次编辑就凭空建索引**」（`write_gate.ts:42`：
 *    否则会造出"只有这几个文件"的半成品索引）。两条政策**相互否定** ⇒ 合并 = 单方面推翻一条，不是内化。
 * 2. **目录创建**：`op='insert'` 建新文件会 `mkdirSync(dirname, {recursive:true})`
 *    （`edit_code.test.ts`「insert 创建新文件」走的正是尚不存在的 `src/`）；`applyWrites` 不建目录（实测 `ENOENT`）。
 * 3. **根外文件**：本文件对 `project_dir` 之外的目标**照写**（实测写盘成功）；`applyWrites`
 *    **拒绝落盘**并进 `blocked`（`ok=false`）。
 * 4. **快照时机**：本文件在**编辑前**（校验之前）就快照 ⇒ 被拒绝的编辑也留一份撤回点（实测）；
 *    `applyWrites` 只在**真要写**的那一刻快照。
 *
 * ★ 而"**逐文件**快照"这条 —— 当初被当成理由的差异 —— **实测证不出必要性**（本笔的判断题）：
 *   · 判据场景「批量改 3 文件、第 2 个失败、第 1 个必须能单独撤回」：现状**能**（`snapshot(action="list")` 找到
 *     该文件的快照 id → `snapshot(action="rollback")`）；
 *   · 「**一次**快照含全部文件」**也能**做到同样的事（`rollbackFileSnapshot` 支持 `file` 过滤）；
 *   · 反向：逐文件粒度**做不到**"整批一次撤回"（`rollback latest` 只回到最后一个被写的文件）。
 *   ⇒ 快照粒度**不是**能力差异，也**不是**本文件不能并入 `applyWrites` 的原因；真正原因是上面那 4 条政策。
 *   （下一步若要动：先由人拍板"索引政策以哪条为准"，再谈合并。详见
 *    `docs/architecture-refactor-plan.md` §31）
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseFileFull, parseAstRoot, type ParsedSymbol } from '../../../infrastructure/parse/index.js';
import { syncFile } from '../../../infrastructure/index/symbols.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { splitKeepEnds, detectEol, isBlankLine } from '../../../infrastructure/text/line_utils.js';
import { snapshotBeforeWrite } from '../rf-snapshot/file_snapshot.js';
import { reopenAndResolveAfterWrite, reopenNote } from '../../observe/write_gate.js';
import { locateReplaceText, realignNewTextTo, FUZZY_LEVEL_LABEL } from '../../../infrastructure/parse/fuzzy_match.js';

export type EditCodeOp = 'replace' | 'insert' | 'delete' | 'range' | 'replace_text';

export interface EditCodeArgs {
  /** 项目根目录（索引归属，编辑后重建该文件的 cache.db 索引） */
  project_dir: string;
  /** 目标文件（相对 project_dir 或绝对路径） */
  file: string;
  op: EditCodeOp;
  /**
   * 目标符号。replace/delete：按 qualified_name 优先、短名兜底匹配；
   * insert：插入到该符号之后（缺省 = 文件末尾）。
   * Go 方法用短名 + parent（receiver 类型）消歧。
   */
  symbol?: string;
  /** 符号父级（类名 / Go receiver 类型名），同名消歧用 */
  parent?: string;
  /** replace/insert 的新代码（完整符号定义；delete 不需要；range=区间新内容，传空串删除区间） */
  code?: string;
  /** op='range' 专用：1-based 含端点的起始行（行号随时漂移前由调用方先读文件确认） */
  start?: number;
  /** op='range' 专用：1-based 含端点的结束行 */
  end?: number;
  /** 所有 op 支持：true=只出 diff 预览 + 语法门结果，不写盘、不改索引 */
  dry_run?: boolean;
  /** op='range' 专用：true=区间穿透只报符号计数、不展开明细列表（减少视觉噪声） */
  quiet?: boolean;
  /** op='replace_text' 专用：要替换的旧文本（在文件中须恰好出现 1 次，否则报歧义） */
  old_text?: string;
  /** op='replace_text' 专用：替换后的新文本 */
  new_text?: string;
  /** op='replace' 专用：sub='body' 时只替换函数/方法体（code 只给新 body 内容，免自包含/签名） */
  sub?: string;
  /**
   * ★ P-B（规划书 §16.2）批量模式：一次调用对**多个文件**做 replace_text（每项 = 文件内的一次唯一文本替换）。
   * 给了非空 `targets` ⇒ 走批量（此时忽略 file/op/symbol/code/old_text/new_text）。
   * 逐项**独立回报**（每项 ok/hit/error 各自独立），一项失败不影响其余（除非 atomic=true）。
   */
  targets?: Array<{ file: string; old_text: string; new_text: string }>;
  /**
   * ★ P-B 原子性（仅 `targets` 批量有效）：true ⇒ 任一项失败则**整批不落盘**（全成或全不成）；
   * 缺省/false ⇒ **逐项独立**（失败项红、其余照常落盘）。dry_run 天然不落盘，与 atomic 无关。
   */
  atomic?: boolean;
}

/** ★ P-B：批量模式**逐项**回报（`targets[]` 专用；一项一条） */
export interface EditBatchItem {
  /** 目标文件（相对 project_dir 的路径，展示口径） */
  file: string;
  /** 该项是否成功（干跑成功也算 true —— 看 written 区分是否落盘） */
  ok: boolean;
  /** 该项是否**真的落盘**（dry_run=true / 原子性回退 ⇒ false） */
  written: boolean;
  /** replace_text 命中位置与级别 */
  hit?: { level: number; label: string; start_line: number; old_lines: number; new_lines: number };
  /** 该文件本次落盘的符号 diff（同一文件多项时按文件级归属） */
  symbol_diff?: { added: number; removed: number; changed: number };
  /** 该文件本次落盘后索引同步状态 */
  index_synced?: string;
  /** 失败原因（ok=false 时必有） */
  error?: string;
}

interface LineOp {
  startIdx: number; // 0-based 半开区间起点
  count: number; // 删除行数
  insert: string[]; // 插入行（含终止符）
}

/** 新代码规范化为文件行尾风格，每行带终止符 */
/** 新代码规范化为文件行尾风格，每行带终止符（末尾空元素先丢弃——由调用方决定是否补空行） */
function normalizeCode(code: string, eol: string): string[] {
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((l) => l + eol);
}

/**
 * 语法错误门：tree-sitter 是容错解析器，语法破坏不抛错、只置 rootNode.hasError。
 * 编辑后 hasError 由 false→true（新引入语法错误）→ 拒绝；
 * 原本就有错的文件（true→true）放行但提示，给 AI 顺手修复的机会（true→false 正常放行）。
 */
async function hasSyntaxError(filePath: string, content: string): Promise<boolean> {
  const ast = await parseAstRoot(filePath, content);
  return ast?.root.hasError === true;
}

/** 符号匹配：qualified_name 精确 > name 精确；parent 提供时必须相等（explore_code read 共用，保证同名/消歧口径一致） */
export function matchSymbols(symbols: ParsedSymbol[], symbol: string, parent?: string): {
  qnHits: ParsedSymbol[];
  nameHits: ParsedSymbol[];
} {
  const qnHits = symbols.filter(
    (s) => s.qualified_name === symbol && (!parent || s.parent === parent),
  );
  const nameHits = symbols.filter(
    (s) => s.name === symbol && (!parent || s.parent === parent),
  );
  return { qnHits, nameHits };
}

export function describeSymbol(s: ParsedSymbol): string {
  return `${s.qualified_name} (${s.kind}, ${s.signature || s.name}, L${s.start_line}-${s.end_line}${s.parent ? `, parent=${s.parent}` : ''})`;
}

/** 压缩连续 ≥2 空行为 1 空行（delete 后清理） */
function squeezeBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (isBlankLine(l) && out.length > 0 && isBlankLine(out[out.length - 1])) continue;
    out.push(l);
  }
  return out;
}

/** 生成 range 编辑的 diff 预览（− 移除 / + 新增 / 区间穿透符号提示），预览行数设上限防爆 */
function buildRangePreview(
  start: number,
  end: number,
  total: number,
  removed: string[],
  added: string[],
  overlapped: ParsedSymbol[],
  quiet?: boolean,
): string {
  const cap = 400;
  const trunc = removed.length > cap || added.length > cap;
  const body = [
    ...removed.slice(0, cap).map((l) => '- ' + l.replace(/\r?\n$/, '')),
    ...added.slice(0, cap).map((l) => '+ ' + l.replace(/\r?\n$/, '')),
  ].join('\n');
  const symNote =
  overlapped.length > 0
    ? quiet
      ? `\n⚠ 区间穿透 ${overlapped.length} 个符号（quiet，明细略）`
      : `\n⚠ 区间穿透 ${overlapped.length} 个符号: ` +
        overlapped.map((s) => describeSymbol(s)).join('；') +
        '（显式行区间，默认信任 caller，请复核）'
    : '';
  return (
    `diff L${start}-L${end}/${total}（${removed.length} 行 → ${added.length} 行）` +
    (trunc ? '，预览已截断' : '') +
    symNote +
    '\n```diff\n' +
    body +
    '\n```'
  );
}

/** 生成通用 diff 预览（− 移除 / + 新增），行数设上限防爆 */
function buildGenericDiff(header: string, removed: string[], added: string[]): string {
  const cap = 400;
  const trunc = removed.length > cap || added.length > cap;
  const body = [
    ...removed.slice(0, cap).map((l) => '- ' + l),
    ...added.slice(0, cap).map((l) => '+ ' + l),
  ].join('\n');
  return (
    `diff ${header}${trunc ? '，预览已截断' : ''}\n` +
    '```diff\n' +
    body +
    '\n```'
  );
}

/** 定位符号的函数/方法体行区间（AST 精确：body/suite 字段节点）。失败返回 null。 */
async function findBodyRange(
  absPath: string,
  content: string,
  symbol: string,
  parent?: string,
): Promise<{ startIndex: number; endIndex: number; startLine: number; endLine: number } | null> {
  const ast = await parseAstRoot(absPath, content);
  if (!ast?.root) return null;
  const TYPE_NODES = new Set([
    'class_declaration', 'abstract_class_declaration', 'interface_declaration',
    'class_definition', 'type_alias_declaration', 'enum_declaration', 'struct_specifier',
  ]);
  let out: { startIndex: number; endIndex: number; startLine: number; endLine: number } | null = null;
  const walk = (node: any, parentName: string | undefined): void => {
    if (out) return;
    const nameNode = node?.childForFieldName?.('name');
    if (nameNode) {
      const name = nameNode.text ?? '';
      const qn = parentName ? `${parentName}.${name}` : name;
      if ((qn === symbol || name === symbol) && (!parent || parentName === parent)) {
        const body = node.childForFieldName('body') ?? node.childForFieldName('suite');
        if (body) {
          out = {
            startIndex: body.startIndex ?? 0,
            endIndex: body.endIndex ?? 0,
            startLine: body.startPosition.row + 1,
            endLine: body.endPosition.row + 1,
          };
          return;
        }
      }
    }
    const childParent = nameNode && TYPE_NODES.has(node.type) ? (nameNode.text ?? '') : parentName;
    for (let i = 0; i < (node?.childCount ?? 0); i++) {
      const child = node.child(i);
      if (child) walk(child, childParent);
    }
  };
  walk(ast.root as any, undefined);
  return out;
}

/** 行首空白字符数 */
function leadingSpaces(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m ? m[0].length : 0;
}

/** 取第 line 行（1-based）的前导空白 */
function leadingWhitespaceOfLine(content: string, line: number): string {
  const l = content.split('\n')[line - 1];
  const m = l ? /^[ \t]*/.exec(l) : null;
  return m ? m[0] : '';
}

/**
 * 把新代码按目标缩进重排（以周围上下文为准）：
 * 去最小公共缩进（相对化）后整体补上 refIndent，保留内部相对嵌套。
 * 空行保持原样。用于 range 编辑让粘贴代码贴合周围缩进层级，
 * 而非把 AI 给的可能来自别处的缩进原样塞进去。
 * 幂等：调用方已按 refIndent 对齐时，minIndent==refIndent → 结果不变。
 */
function realignCode(lines: string[], refIndent: string): string[] {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;
  const minIndent = Math.min(...nonEmpty.map((l) => leadingSpaces(l)));
  return lines.map((l) => (l.trim().length === 0 ? l : refIndent + l.slice(minIndent)));
}

/** 声明样首行关键字（用于判断新 code 是否像完整定义而非裸函数体片段） */
const DECL_PREFIXES = [
  'function ', 'class ', 'interface ', 'enum ', 'type ', 'abstract class ', 'export ',
  'import ', 'const ', 'let ', 'var ', 'func ', 'def ', 'public ', 'private ', 'protected ', 'static ',
];

/** 新 code 是否像「函数/方法体片段」而非「完整自包含定义」（缺签名声明行） */
function looksLikeBareBody(code: string): boolean {
  const first = (code.trim().split('\n')[0] ?? '').trim();
  if (!first) return false;
  if (/^[{[\]:;]/u.test(first)) return true; // 直接以花括号/返回语句开头 → 体片段
  return !DECL_PREFIXES.some((k) => first.startsWith(k));
}

/** 目标符号是函数/方法时，附加「改用 sub=body」的引导文案 */
function subBodyHint(targetKind: string | undefined): string {
  if (targetKind !== 'function' && targetKind !== 'method') return '';
  return (
    '\n提示：目标符号是函数/方法。若你只想改函数体而非整套重写定义，' +
    "请改用 op='replace' + sub='body'——把 code 只设为新的函数体内容即可，工具会自动保留签名与大括号。"
  );
}

/** 符号 disambiguate 的上下文摘要（签名行 + 其后两行正文，让 AI 凭内容而不是行号区分同名） */
function describeSymbolCtx(s: ParsedSymbol, lines: string[]): string {
  const snippet = lines
    .slice(s.start_line - 1, Math.min(s.end_line, s.start_line + 2))
    .map((l) => l.replace(/^\s+/, '').trimEnd())
    .filter((l) => l.length > 0)
    .join(' → ');
  return `  ${describeSymbol(s)}\n      ctx: ${snippet || '（无上下文）'}`;
}

/** 同名多候选歧义错误：N 候选 + 每个的上下文摘要 + 引导 parent 消歧 */
function buildAmbiguityError(hits: ParsedSymbol[], symbol: string, lines: string[]): string {
  return (
    `符号不唯一（${hits.length} 候选，symbol=${symbol}）。传 parent 消歧` +
    '（方法 → 所在类名；Go 方法 → receiver 类型名），候选如下:\n' +
    hits.map((s) => describeSymbolCtx(s, lines)).join('\n')
  );
}

/**
 * ★ P-A（规划书 §16.1）：写工具回执的**机器可读字段**。
 *
 * 为什么需要：回执此前是**纯散文**，agent 判成败只能**正则解析文本** ——
 * 实测我因此踩了两次（干跑回执以 `[干跑]` 开头 ⇒ `startsWith('✓')` 把成功判成失败 ⇒ **静默跳过落盘**；
 * 正则漏 `from ` ⇒ 6 个文件全判错）。这与本仓 §2d「不许靠猜」**自相矛盾**。
 *
 * ★ 字段**从入参派生**，不从 message 反推（反推 = 把上面的错再写一遍）。
 */
export interface EditReceipt {
  /** 调用是否成功（**干跑成功也是 true** —— 看 `written` 区分是否真落盘） */
  ok: boolean;
  op: string;
  file: string;
  /** 是否干跑（未写盘） */
  dry_run: boolean;
  /** 是否**真的落盘**（干跑 = false）—— ★ agent 判"做没做"只看这个字段 */
  written: boolean;
  /** `replace_text` 专有：命中位置与级别 */
  hit?: { level: number; label: string; start_line: number; old_lines: number; new_lines: number };
  /** 落盘后索引同步状态 */
  index_synced?: string;
  /** 符号 diff（落盘后才有） */
  symbol_diff?: { added: number; removed: number; changed: number };
  /** ★ P-B 批量专有：逐项独立回报（每项一条，含失败项的 error） */
  items?: EditBatchItem[];
  /** ★ P-B 批量专有：目标项总数 */
  total?: number;
  /** ★ P-B 批量专有：成功项数 */
  succeeded?: number;
  /** ★ P-B 批量专有：失败项数 */
  failed?: number;
  /** ★ P-B 批量专有：是否启用原子性（任一项失败则整批不落盘） */
  atomic?: boolean;
}

/** ★ P-B：`replace_text` 的**纯规划结果**（不写盘、不碰索引）—— 单文件路径与 targets[] 批量共用同一份实现。
 *  ★ P-C：`planReplaceText` 同时被 `refactor_plan.ts` 复用（算清单/判"已应用"）—— 导出以免再写第二份定位+语法门。 */
export interface ReplaceTextPlan {
  /** 编辑后的完整文件内容（已过语法门） */
  newContent: string;
  hit: NonNullable<EditReceipt['hit']>;
  /** diff 预览（"-" 侧为**实际命中的文件片段**，模糊级 ≠ 传入 old_text） */
  preview: string;
  /** 模糊命中时的提示文案（L1 为空串） */
  levelNote: string;
  /** 实际命中片段的行数（= hit.old_lines，供消息复用） */
  matchedLineCount: number;
}

/**
 * ★ P-B：`replace_text` 的**规划**（纯函数语义：读 content → 返回新内容或抛错，不写盘、不碰索引）。
 * 单文件 `op='replace_text'` 与 `targets[]` 批量**共用这一份**（同一件事不许两份实现）。
 * 纪律不变：歧义即停（不猜）、语法门兜底（新引入语法错误 → 抛错）、模糊命中回执明示级别。
 * ★ 导出（P-C）：`refactor_plan.ts` 的算清单/判"已应用"必须用**这一份**（同一定位+语法门），不许另写。
 */
export async function planReplaceText(
  absPath: string,
  content: string,
  eol: string,
  oldText: string,
  newText: string,
): Promise<ReplaceTextPlan> {
  const loc = locateReplaceText(content, oldText);
  if (loc.candidates.length > 1) {
    throw new Error(
      `replace_text 不唯一（L${loc.candidates[0].level}·${FUZZY_LEVEL_LABEL[loc.candidates[0].level]} ` +
        `匹配到 ${loc.candidates.length} 处：行号 ${loc.candidates.map((c) => c.startLine).join(', ')}）。` +
        '请用更长/更独特的 old_text（含上下文）唯一化。',
    );
  }
  if (!loc.match) {
    throw new Error(
      `replace_text 未找到 old_text（L1 逐字 / L2 空白归一 / L3 缩进弹性 / L4 省略号占位 四级均未命中；` +
        `${JSON.stringify(oldText.slice(0, 40))}）。请确认内容存在，或改用 range 编辑。`,
    );
  }
  const m = loc.match;
  // L3/L4：new_text 按实际命中首行缩进重排（模型写去缩进形态也能落对位置；eol 用外层 detectEol 结果）
  const effectiveNew = m.level >= 3 ? realignNewTextTo(newText, m.targetIndent, eol) : newText;
  const newContent = content.slice(0, m.start) + effectiveNew + content.slice(m.end);
  const reparsed = await parseFileFull(absPath, newContent);
  if (reparsed.error) {
    throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
  }
  const baselineHasError = await hasSyntaxError(absPath, content);
  const afterHasError = await hasSyntaxError(absPath, newContent);
  if (!baselineHasError && afterHasError) {
    throw new Error('编辑引入了语法错误（hasError false→true），已放弃（未写盘）。请检查 new_text。');
  }
  // diff 的 "-" 侧用实际文件片段（L≥2 时 ≠ 模型写的 old_text，诚实展示被改内容）
  const matchedLines = m.matchedText.split(/\r?\n/);
  const newLines = effectiveNew.split(/\r?\n/);
  const levelNote =
    m.level >= 2
      ? `（⚠ L${m.level}·${FUZZY_LEVEL_LABEL[m.level]} 模糊命中：old_text 非逐字一致` +
        `${m.level >= 3 ? '，new_text 已按命中缩进重排' : ''}）`
      : '';
  const preview = buildGenericDiff(
    `L${m.startLine}（${matchedLines.length} 行 → ${newLines.length} 行）`,
    matchedLines,
    newLines,
  );
  return {
    newContent,
    hit: {
      level: m.level,
      label: FUZZY_LEVEL_LABEL[m.level],
      start_line: m.startLine,
      old_lines: matchedLines.length,
      new_lines: newLines.length,
    },
    preview,
    levelNote,
    matchedLineCount: matchedLines.length,
  };
}

async function editCodeInner(args: EditCodeArgs): Promise<{ message: string; data?: unknown }> {
  const { op } = args;
  const projectRoot = path.resolve(args.project_dir);
  const absPath = path.isAbsolute(args.file) ? args.file : path.resolve(projectRoot, args.file);
  const relPath = path.relative(projectRoot, absPath).split(path.sep).join('/');

  if ((op === 'replace' || op === 'delete') && !args.symbol) {
    throw new Error(`${op} 需要 symbol（目标符号名或 qualified_name）`);
  }
  if (op === 'replace' || op === 'insert') {
    if (!args.code || !args.code.trim()) throw new Error(`${op} 需要 code（新代码）`);
  }
  if (op === 'replace_text') {
    if (!args.old_text || !args.old_text.trim()) throw new Error('replace_text 需要 old_text（要替换的唯一旧文本）');
    if (args.new_text == null) throw new Error('replace_text 需要 new_text（新文本，传空串表示删除该文本）');
  }
  if (op === 'replace' && args.sub !== undefined && args.sub !== 'body') {
    throw new Error(`replace 的 sub 仅支持 'body'，收到 ${args.sub}`);
  }

  const fileExists = fs.existsSync(absPath);
  if (!fileExists && op !== 'insert') {
    throw new Error(`文件不存在: ${absPath}（insert 可创建新文件，replace/delete 不行）`);
  }

  // ★ 可撤回：任何会落盘的编辑，先把目标文件原样存一份（dry_run 不快照）。
  // 之后可用 snapshot(action="rollback") 一键回到这一刻（含"本次新建的文件"会被删掉）。
  // 逐文件（本工具一次只改一个文件）+ 编辑前（校验之前）就快照 —— 两条都是**有意**的形态，
  // 且是"不并入 applyWrites"的两条原因之一，理由与实测证据见文件头「落盘形态」块。
  if (args.dry_run !== true) {
    snapshotBeforeWrite(projectRoot, `edit_code:${op}:${relPath}`, [relPath]);
  }

  // ── insert 新文件：直接写入 + 索引 ──
  if (!fileExists && op === 'insert') {
    const eol = '\n';
    const lines = normalizeCode(args.code!, eol);
    const content = lines.join('');
    const reparsed = await parseFileFull(absPath, content);
    if (reparsed.error) throw new Error(`新文件内容解析失败（不写盘）: ${reparsed.error}`);
    if (await hasSyntaxError(absPath, content)) {
      throw new Error('新文件内容含语法错误（hasError=true，不写盘）。请检查 code 的括号/缩进/引号。');
    }
    if (args.dry_run) {
      return {
        message:
          `[干跑] 将创建 ${relPath}（${reparsed.symbols.length} 符号），语法门通过，未写盘:\n\`\`\`\n` + content + '\n\`\`\`',
      };
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    return {
      message:
        `✓ 已创建 ${relPath}（${reparsed.symbols.length} 符号）并重建索引（${sync.status}${reopenNote(_rw)}）\n` +
        reparsed.symbols.map((s) => `  + ${describeSymbol(s)}`).join('\n'),
    };
  }

  const original = fs.readFileSync(absPath, 'utf8');
  const eol = detectEol(original);
  const lines = splitKeepEnds(original);
  const parsed = await parseFileFull(absPath, original);
  if (parsed.error) throw new Error(`目标文件当前就解析失败（先修文件再编辑）: ${parsed.error}`);
  const baselineHasError = await hasSyntaxError(absPath, original);

  // ── op='replace' + sub='body'：只替换函数/方法体（文本级，保留签名与大括号；code 只给 body、免自包含）──
  if (op === 'replace' && args.sub === 'body') {
    const body = await findBodyRange(absPath, original, args.symbol!, args.parent);
    if (!body) throw new Error(`sub=body 未定位到 ${args.symbol} 的函数体（确认 qualified_name 或传 parent）`);
    if (args.code == null) throw new Error('sub=body 需要 code（新函数体内容，含大括号；传空串=清空函数体）');
    // ── 智能缩进对齐：保留大括号原位置，body 内容按父级缩进重排 ──
    const braceIndent = leadingWhitespaceOfLine(original, body.startLine);
    // 从原 body 内部推导 indent unit（内部最小缩进 − 大括号缩进）；单行/空 body 回退 2 空格
    const innerLines = original.slice(body.startIndex + 1, body.endIndex - 1).split('\n').filter((l) => l.trim().length > 0);
    let indentUnit = '  ';
    if (innerLines.length > 0) {
      const minInner = Math.min(...innerLines.map((l) => leadingSpaces(l)));
      indentUnit = ' '.repeat(Math.max(2, minInner - braceIndent.length));
    }
    const innerIndent = braceIndent + indentUnit;
    // code 剥可选大括号 → 相对化（去最小公共缩进）→ 加 innerIndent（保持内部相对嵌套）
    let codeLines = args.code.replace(/\r\n/g, '\n').split('\n');
    if ((codeLines[0] ?? '').trim() === '{') codeLines = codeLines.slice(1);
    if ((codeLines[codeLines.length - 1] ?? '').trim() === '}') codeLines = codeLines.slice(0, -1);
    while (codeLines.length > 0 && codeLines[0].trim() === '') codeLines.shift();
    while (codeLines.length > 0 && codeLines[codeLines.length - 1].trim() === '') codeLines.pop();
    const nonEmpty = codeLines.filter((l) => l.trim().length > 0);
    const minCodeIndent = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((l) => leadingSpaces(l))) : 0;
    const realigned = codeLines.map((l) => (l.trim().length === 0 ? '' : innerIndent + l.slice(minCodeIndent))).join('\n');
    const newBodyText = '{\n' + (realigned.length > 0 ? realigned + '\n' : '') + braceIndent + '}';
    const newContent = original.slice(0, body.startIndex) + newBodyText + original.slice(body.endIndex);

    // 语法门（同 replace_text：解析失败 / 新引入语法错误 → 拒绝不写盘）
    const reparsed = await parseFileFull(absPath, newContent);
    if (reparsed.error) {
      throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
    }
    const afterHasError = await hasSyntaxError(absPath, newContent);
    if (!baselineHasError && afterHasError) {
      throw new Error('编辑引入了语法错误（hasError false→true），已放弃（未写盘）。请检查 code。');
    }
    const oldBody = original.slice(body.startIndex, body.endIndex);
    const preview = buildGenericDiff(
      `L${body.startLine}-${body.endLine}（body）`,
      oldBody.split(/\r?\n/),
      newBodyText.split(/\r?\n/),
    );
    if (args.dry_run) {
      return {
        message:
          `[干跑] replace ${relPath} 的 ${args.symbol} body（L${body.startLine}-${body.endLine}），语法门通过，未写盘:\n${preview}`,
      };
    }
    fs.writeFileSync(absPath, newContent, 'utf8');
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    return {
      message:
        `✓ 已替换 ${relPath} 的 ${args.symbol} body（L${body.startLine}-${body.endLine}），` +
        `签名与大括号保留，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}\n${preview}`,
    };
  }

  // ── op='range'：显式行区间编辑（符号为主路径的可选偏好；行号由调用方先读文件确认）──
  if (op === 'range') {
    if (args.start == null || args.end == null) {
      throw new Error('range 需要 start/end（1-based 含端点行号）');
    }
    if (args.code == null) throw new Error('range 需要 code（新内容；传空串表示删除该区间）');
    const start = args.start;
    const end = args.end;
    const total = lines.length;
    if (start < 1) throw new Error(`start 必须 ≥1，收到 ${start}`);
    if (end < start) throw new Error(`end(${end}) < start(${start})`);
    if (end > total) throw new Error(`end(${end}) 超出文件总行数(${total})`);

    const startIdx = start - 1;
    const count = end - start + 1;
    const codeLines = normalizeCode(args.code!, eol);
    // ── 缩进规范化（以周围上下文为准）：新代码按 start 行的所在缩进层级重排，
    //    而非把 AI 给的（可能来自别处的）缩进原样塞进去。
    const aligned = realignCode(codeLines, leadingWhitespaceOfLine(original, start));
    const newLines = [...lines];
    newLines.splice(startIdx, count, ...aligned);
    const newContent = newLines.join('');

    // 语法门（同 replace：解析失败 / 新引入语法错误 → 拒绝不写盘）
    const reparsed = await parseFileFull(absPath, newContent);
    if (reparsed.error) {
      throw new Error(`编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}`);
    }
    const afterHasError = await hasSyntaxError(absPath, newContent);
    const syntaxRepaired = baselineHasError && !afterHasError;
    if (!baselineHasError && afterHasError) {
      throw new Error('编辑引入了语法错误（hasError false→true），已放弃（未写盘）。请检查 code 的括号/引号/缩进。');
    }

    // 区间穿透的符号（提示影响面，不禁止——行区间是显式请求，默认信任 caller）
    const overlapped = parsed.symbols.filter((s) => s.start_line <= end && s.end_line >= start);
    const preview = buildRangePreview(start, end, total, lines.slice(startIdx, startIdx + count), aligned, overlapped, args.quiet);

    if (args.dry_run) {
      return {
        message:
          `[干跑] range ${relPath} L${start}-L${end}（${count} 行 → ${aligned.length} 行）` +
          (syntaxRepaired ? '（此编辑会顺手修复原文件语法错误）' : '') +
          `，${afterHasError ? '⚠ 文件原有语法错误仍在（未恶化也未修复）' : '语法门通过'}，未写盘:\n${preview}`,
      };
    }

    fs.writeFileSync(absPath, newContent, 'utf8');
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    const repairNote = syntaxRepaired ? '（顺手修复了原文件的语法错误 ✓）' : '';
    return {
      message:
        `✓ range 编辑 ${relPath} L${start}-L${end}（${count} 行 → ${aligned.length} 行），` +
        `索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n${preview}`,
    };
  }

  // ── op='replace_text'：文本唯一替换（edit 工具的 AST 安全版）──
  // ★ 模糊编辑级联（P0-4，2026-09-15）：L1 逐字 → L2 空白归一 → L3 缩进弹性 → L4 省略号占位。
  //   纪律：歧义即停（某级命中 >1 处直接报错并列行号，绝不降级硬找唯一）+ 唯一才动；
  //   L≥2 在回执里明示命中级别与实际被替换片段（诚实——不让模型误以为逐字一致）。
  // ★ P-B（2026-09-28）：定位/语法门抽成 `planReplaceText`（与 `targets[]` 批量共用同一份实现）。
  if (op === 'replace_text') {
    const plan = await planReplaceText(absPath, original, eol, args.old_text!, args.new_text ?? '');
    if (args.dry_run) {
      return {
        message:
          `[干跑] replace_text ${relPath} L${plan.hit.start_line}（唯一命中 · L${plan.hit.level}·${plan.hit.label}），` +
          `语法门通过，未写盘:\n${plan.preview}`,
        data: { hit: plan.hit },
      };
    }
    fs.writeFileSync(absPath, plan.newContent, 'utf8');
    const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
    const diffNote = sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
    return {
      message:
        `✓ replace_text ${relPath} L${plan.hit.start_line}（${plan.matchedLineCount} 行 → ${plan.hit.new_lines} 行，` +
        `匹配 L${plan.hit.level}·${plan.hit.label}）${plan.levelNote}，` +
        `索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}\n${plan.preview}`,
      data: { hit: plan.hit, index_synced: sync.status, ...(sync.symbol_diff ? { symbol_diff: sync.symbol_diff } : {}) },
    };
  }

  let lineOp: LineOp;
  /** 本次替换/删除/插入命中的目标符号 kind（供 sub=body 引导文案用；replace/delete 时才有值） */
  let targetKind: ParsedSymbol['kind'] | undefined;

  if (op === 'insert') {
    const codeLines = normalizeCode(args.code!, eol);
    let at: number; // 插入点（行索引，该行之前插）
    if (args.symbol) {
      const { qnHits, nameHits } = matchSymbols(parsed.symbols, args.symbol, args.parent);
      const hits = qnHits.length > 0 ? qnHits : nameHits;
      if (hits.length === 0) {
        throw new Error(
          `插入锚点符号未找到: ${args.symbol}。文件符号:\n` +
            parsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n'),
        );
      }
      if (hits.length > 1) {
        throw new Error(buildAmbiguityError(hits, args.symbol, lines));
      }
      at = hits[0].end_line; // 符号最后一行的下一行
    } else {
      at = lines.length; // 文件末尾
    }
    // 插入块前后保证空行分隔（Go/TS 函数间无空行会破坏可读性甚至编译）
    const block: string[] = [];
    if (at > 0 && !isBlankLine(lines[at - 1] ?? '')) block.push(eol);
    block.push(...codeLines);
    if (!isBlankLine(lines[at] ?? '')) block.push(eol);
    lineOp = { startIdx: at, count: 0, insert: block };
  } else {
    // replace / delete：定位目标符号
    const { qnHits, nameHits } = matchSymbols(parsed.symbols, args.symbol!, args.parent);
    let hits = qnHits.length > 0 ? qnHits : nameHits;
    if (hits.length === 0 && args.parent) {
      // parent 消歧失败时提示无 parent 的命中
      const { qnHits: q2, nameHits: n2 } = matchSymbols(parsed.symbols, args.symbol!);
      const alt = [...qnHits, ...nameHits, ...q2, ...n2];
      if (alt.length > 0) {
        throw new Error(
          `symbol=${args.symbol} + parent=${args.parent} 无命中（parent 可能写错），但去掉 parent 有 ${alt.length} 候选:\n` +
            alt.map((s) => `  ${describeSymbol(s)}`).join('\n') +
            '\n请按上面候选的 parent（类名 / receiver 类型名）修正 parent 重试。',
        );
      }
    }
    if (hits.length === 0) {
      targetKind = parsed.symbols.find((s) => s.name === args.symbol!)?.kind;
      const hint = subBodyHint(targetKind);
      // 若缺命中且新 code 像裸函数体 → 多一个提示给用户引导，大概率是想改函数体却传成了 full replace
      const bodyHint = (args.code && looksLikeBareBody(args.code)) ? hint : '';
      throw new Error(
        `符号未找到: ${args.symbol}。文件符号:\n` +
          parsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n') +
          bodyHint,
      );
    }
    if (hits.length > 1) {
      throw new Error(buildAmbiguityError(hits, args.symbol!, lines));
    }
    const target = hits[0];
    targetKind = target.kind;
    const startIdx = target.start_line - 1;
    const count = target.end_line - target.start_line + 1;
    lineOp = {
      startIdx,
      count,
      insert: op === 'delete' ? [] : normalizeCode(args.code!, eol),
    };
  }

  // ── 应用行操作 ──
  const newLines = [...lines];
  newLines.splice(lineOp.startIdx, lineOp.count, ...lineOp.insert);
  let newContent = newLines.join('');
  if (op === 'delete') {
    newContent = squeezeBlankRuns(splitKeepEnds(newContent)).join('');
    if (newContent && !newContent.endsWith(eol)) newContent += eol;
  }

  // ── 安全校验：re-parse，失败不写盘 ──
  const bodyHint = op === 'replace' && !args.sub && args.code && looksLikeBareBody(args.code) ? subBodyHint(targetKind) : '';
  const reparsed = await parseFileFull(absPath, newContent);
  if (reparsed.error) {
    throw new Error(
      `编辑后文件解析失败，已放弃（未写盘）: ${reparsed.error}\n` +
        '常见原因：新代码缩进/括号不完整、class 方法缩进层级错。请检查 code 后重试。' +
        bodyHint,
    );
  }
  const afterHasError = await hasSyntaxError(absPath, newContent);
  const syntaxRepaired = baselineHasError && !afterHasError;
  if (!baselineHasError && afterHasError) {
    throw new Error(
      '编辑引入了语法错误（hasError false→true），已放弃（未写盘）。\n' +
        '常见原因：新代码括号/引号不闭合、缩进层级错、Go 少了 return。请检查 code 后重试。' +
        bodyHint,
    );
  }
  if (op === 'replace') {
    const newName = reparsed.symbols.some(
      (s) => s.qualified_name === args.symbol || s.name === args.symbol ||
        (args.parent && s.name === args.symbol && s.parent === args.parent),
    );
    if (!newName) {
      throw new Error(
        `替换后未找到同名符号 ${args.symbol}（疑似粘贴了别的函数），已放弃（未写盘）。\n` +
          '新代码解析出的符号:\n' +
          reparsed.symbols.map((s) => `  ${describeSymbol(s)}`).join('\n') +
          bodyHint,
      );
    }
    // 重复顶层符号防御（狗食缺陷：replace 大符号时新 code 带入了旧定义的副本，
    // 新旧并存导致编译错 + 手工清理）。TS/JS 顶层同名声明本就是编译错误，直接拦。
    const dupByQn = new Map<string, number>();
    for (const s of reparsed.symbols) {
      if (s.parent === undefined) dupByQn.set(s.qualified_name, (dupByQn.get(s.qualified_name) ?? 0) + 1);
    }
    const dups = [...dupByQn.entries()].filter(([, n]) => n > 1);
    if (dups.length > 0) {
      throw new Error(
        `编辑后出现重复的顶层符号（疑似新 code 带入了既有定义的副本），已放弃（未写盘）:\n` +
          dups.map(([qn, n]) => `  ${qn} × ${n}`).join('\n') +
          '\n请从 code 中移除重复定义后重试。',
      );
    }
  }

  // ── dry_run（replace/delete/insert 已有文件）：语法门已过，只出 diff 预览，不写盘 ──
  if (args.dry_run) {
    const removed = lines.slice(lineOp.startIdx, lineOp.startIdx + lineOp.count).map((l) => l.replace(/\r?\n$/, ''));
    const added = lineOp.insert.map((l) => l.replace(/\r?\n$/, ''));
    const preview = buildGenericDiff(
      `L${lineOp.startIdx + 1}-${lineOp.startIdx + lineOp.count}（${removed.length} 行 → ${added.length} 行）`,
      removed,
      added,
    );
    return {
      message:
        `[干跑] ${op} ${relPath}（${args.symbol ?? '文件末尾'}）语法门通过，未写盘:\n${preview}`,
    };
  }

  // ── 写盘 + 索引重建（新鲜度闭环） ──
  fs.writeFileSync(absPath, newContent, 'utf8');
  const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
  const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);

  const before = parsed.symbols.length;
  const after = reparsed.symbols.length;
  const diffNote =
    sync.symbol_diff
      ? `（符号 diff: +${sync.symbol_diff.added} -${sync.symbol_diff.removed} ~${sync.symbol_diff.changed}）`
      : '';
  const repairNote = syntaxRepaired ? '（顺手修复了原文件的语法错误 ✓）' : '';

  if (op === 'delete') {
    const delSym = args.symbol!;
    return {
      message:
        `✓ 已删除 ${relPath} 的 ${delSym}（L${lineOp.startIdx + 1} 起 ${lineOp.count} 行），` +
        `符号 ${before} → ${after}，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}`,
    };
  }
  if (op === 'insert') {
    const anchor = args.symbol ? `（锚点 ${args.symbol} 之后）` : '（文件末尾）';
    return {
      message:
        `✓ 已插入 ${relPath}${anchor}，符号 ${before} → ${after}，索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n` +
        `新符号:\n` + reparsed.symbols
          .filter((s) => !parsed.symbols.some((o) => o.qualified_name === s.qualified_name && o.start_line === s.start_line))
          .map((s) => `  + ${describeSymbol(s)}`)
          .join('\n'),
    };
  }
  return {
    message:
      `✓ 已替换 ${relPath} 的 ${args.symbol}（原 L${lineOp.startIdx + 1}-${lineOp.startIdx + lineOp.count}，` +
      `${lineOp.count} 行 → ${lineOp.insert.length} 行），索引已重建（${sync.status}${reopenNote(_rw)}）${diffNote}${repairNote}\n` +
      `文件符号: ${before} → ${after}`,
  };
}


/**
 * ★ P-B（规划书 §16.2）：`targets[]` 批量编辑的编排（**唯一实现**，`editCode` 在 `targets` 非空时分派到这里）。
 *
 * 语义（= 把 N 次单文件 `edit_code(replace_text)` 折叠成 **1 次调用**）：
 * - **逐项独立回报**：每项 `{file, ok, hit?, symbol_diff?, index_synced?, error?}`；默认一项失败不影响其余。
 * - **原子性可选**（`atomic:true`）：先对**全部**项做规划校验，任一项失败 ⇒ **整批不落盘**（全成或全不成）。
 * - **dry_run 仍可用**：批量 dry-run **一次性给出全部预览**，不写盘。
 *
 * 为什么这样能保证「等价 + 可真原子」：
 * - **虚拟文件集**（absPath → 累积内容）按序规划：同一文件多项按序叠加，外部可观察结果与
 *   「逐次调用、每次重读磁盘」一致；但**落盘时每文件只写一次**（写闸/索引各一次）。
 * - 原子性由「**先全部规划、后统一落盘**」保证：规划阶段不碰磁盘，落盘阶段写的就是规划结果本身，不再重算。
 */
async function editCodeBatch(args: EditCodeArgs): Promise<{ message: string; data: EditReceipt }> {
  const targets = args.targets!;
  const projectRoot = path.resolve(args.project_dir);
  const dry = args.dry_run === true;
  const atomic = args.atomic === true;

  // [B] 收显式参数 + 「失败就抛」：空数组是调用方错误，不静默当成功
  if (targets.length === 0) {
    throw new Error('targets 是空数组（批量编辑需要至少一项 {file, old_text, new_text}）。');
  }

  interface Planned {
    file: string;
    absPath: string;
    ok: boolean;
    hit?: NonNullable<EditReceipt['hit']>;
    preview?: string;
    error?: string;
  }

  // ── 阶段 1：逐项规划（不落盘）。虚拟文件集保证同文件多目标按序叠加 ──
  const virtual = new Map<string, string>();
  const plans: Planned[] = [];
  for (const [i, t] of targets.entries()) {
    let absPath = '';
    let relPath = '';
    try {
      if (!t || typeof t.file !== 'string' || !t.file.trim()) throw new Error(`targets[${i}] 缺 file`);
      absPath = path.isAbsolute(t.file) ? t.file : path.resolve(projectRoot, t.file);
      relPath = path.relative(projectRoot, absPath).split(path.sep).join('/');
      if (typeof t.old_text !== 'string' || t.old_text.trim().length === 0) {
        throw new Error(`targets[${i}]（${relPath}）缺 old_text（要替换的唯一旧文本）`);
      }
      if (typeof t.new_text !== 'string') {
        throw new Error(`targets[${i}]（${relPath}）缺 new_text（传空串=删除该文本）`);
      }
      if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);
      const cur = virtual.get(absPath) ?? fs.readFileSync(absPath, 'utf8');
      const eol = detectEol(cur);
      const plan = await planReplaceText(absPath, cur, eol, t.old_text, t.new_text);
      virtual.set(absPath, plan.newContent);
      plans.push({ file: relPath, absPath, ok: true, hit: plan.hit, preview: plan.preview });
    } catch (e) {
      plans.push({
        file: relPath || String(t?.file ?? `targets[${i}]`),
        absPath,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  const succeeded = plans.filter((p) => p.ok).length;
  const failed = plans.length - succeeded;
  const blockedByAtomic = !dry && atomic && failed > 0;

  // ── 阶段 2：落盘（每文件一次；原子性回退 / dry_run 时不落盘）──
  const symbolDiffByFile = new Map<string, EditReceipt['symbol_diff']>();
  const indexStatusByFile = new Map<string, string>();
  const writtenFiles = new Set<string>();
  if (!dry && !blockedByAtomic) {
    for (const absPath of [...new Set(plans.filter((p) => p.ok).map((p) => p.absPath))]) {
      const rel = path.relative(projectRoot, absPath).split(path.sep).join('/');
      // 逐文件一份快照（**不是**"一份含全部文件"）。粒度这条**证不出必要性**（见文件头「落盘形态」块），
      // 但本笔**不动它**：改粒度 = 改**可观察**行为（`snapshot(action="list")` 条目数、`rollback latest` 的语义），
      // 那是另一笔"行为变更"，与本笔的"同一件事有没有多份实现"无关。
      snapshotBeforeWrite(projectRoot, `edit_code:batch:${rel}`, [rel]);
      fs.writeFileSync(absPath, virtual.get(absPath)!, 'utf8');
      const sync = await syncFile(getProjectCacheDb(projectRoot), projectRoot, absPath);
      const _rw = await reopenAndResolveAfterWrite(projectRoot, [absPath]);
      void _rw;
      if (sync.symbol_diff) symbolDiffByFile.set(absPath, sync.symbol_diff);
      indexStatusByFile.set(absPath, sync.status);
      writtenFiles.add(absPath);
    }
  }

  const items: EditBatchItem[] = plans.map((p) => ({
    file: p.file,
    ok: p.ok,
    written: p.ok && writtenFiles.has(p.absPath),
    ...(p.hit ? { hit: p.hit } : {}),
    ...(p.ok && symbolDiffByFile.has(p.absPath) ? { symbol_diff: symbolDiffByFile.get(p.absPath)! } : {}),
    ...(p.ok && indexStatusByFile.has(p.absPath) ? { index_synced: indexStatusByFile.get(p.absPath)! } : {}),
    ...(p.error ? { error: p.error } : {}),
  }));

  // ── 消息（供人读）：逐项一行 + 全部预览（dry-run 亦一次性给全）──
  const mark = dry ? '[干跑] ' : blockedByAtomic ? '⛔ ' : failed === 0 ? '✓ ' : '⚠ ';
  const head =
    mark +
    `批量 replace_text：${plans.length} 项（成功 ${succeeded} / 失败 ${failed}）` +
    `${
      dry
        ? '，未写盘'
        : blockedByAtomic
          ? `，原子性开启且有 ${failed} 项失败 ⇒ 整批未落盘`
          : `，已写盘 ${writtenFiles.size} 个文件`
    }`;
  const lines: string[] = [head];
  for (const it of items) {
    if (it.ok && it.hit) {
      lines.push(
        `  ✓ ${it.file} L${it.hit.start_line}（L${it.hit.level}·${it.hit.label}）` +
          `${it.hit.old_lines} 行 → ${it.hit.new_lines} 行${it.written ? '' : '（未落盘）'}`,
      );
    } else {
      lines.push(`  ✗ ${it.file}：${it.error ?? '未知失败'}`);
    }
  }
  const previews = plans.filter((p) => p.preview).map((p) => `— ${p.file}\n${p.preview}`);
  if (previews.length > 0) lines.push('', ...previews);

  return {
    message: lines.join('\n'),
    data: {
      ok: failed === 0,
      op: 'batch',
      file: `${plans.length} files`,
      dry_run: dry,
      written: !dry && !blockedByAtomic && writtenFiles.size > 0,
      items,
      total: plans.length,
      succeeded,
      failed,
      atomic,
    },
  };
}

/**
 * ★ P-A 外层：给**所有**返回路径补一份稳定回执（`ok/op/file/dry_run/written` 从入参派生）。
 * 内层若给了更细的 `data`（如 `replace_text` 的 `hit`/`symbol_diff`）则合并保留。
 * ★ P-B：`targets` 非空 ⇒ 分派到批量编排（自带完整回执）。
 */
export async function editCode(args: EditCodeArgs): Promise<{ message: string; data: EditReceipt }> {
  if (Array.isArray(args.targets)) return editCodeBatch(args);
  const r = await editCodeInner(args);
  const base: EditReceipt = {
    ok: true,
    op: String(args.op),
    file: String(args.file),
    dry_run: args.dry_run === true,
    written: args.dry_run !== true,
  };
  return { message: r.message, data: { ...base, ...((r.data as Partial<EditReceipt>) ?? {}) } };
}
