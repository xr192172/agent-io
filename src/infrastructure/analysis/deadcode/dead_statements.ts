/**
 * dead_statements —— 语句级死代码检测 + 保守删除（积木瘦身"剪刀"的第二层）
 *
 * 层级：dead_deps 是符号级（哪些 import/符号活）；本模块是语句级——判定块内
 * 紧跟在终止语句之后的兄弟语句不可达，并保守地删除。
 *
 * 只做"可证明"的一种：
 *   - category 'unreachable'：某块（函数体/if/循环/switch/select/try 块）内出现
 *     终止语句（return/throw/break/continue；Go 另含 goto 与 panic(...) 调用），
 *     其后到块的剩余兄弟语句在该块内控制流永远无法到达。
 *     这是行为不变的（无论副作用/数据流如何，这些语句根本不会执行）。
 *
 * 保守护栏（宁漏不误删）：
 *   - Go  无块级提升：终止后兄弟语句均可删，唯一禁删的是"被可达代码 goto 指向"的
 *     带标签语句（labeled_statement，goto 可前跳到此处），遇到即停。
 *   - TS  有提升（function/class/let/const/var 提升到函数/模块作用域）：若不可达
 *     语句子树含声明，需做"名字引用"校验——仅当这些声明名在整个文件去除本句后
 *     的区间里都不再出现（不会被可达代码读到）才删；否则停（保持整句不动）。
 *   - 遇到 export/labeled 一律停；解析失败的文件整文件跳过、一个都不改。
 *
 * ★ 本模块**只提供"纯计算"**两件：检测（`flagDeadStatements`）+ 按行区间裁剪
 *   （`applyReachabilityRuns`）。**执行与验证闭环**（apply → 改后重验 → 回归回滚）
 *   **由 `refactor_pipeline` 管线承担** —— 那是管线头注的明令（"各执行器只提供纯计算，
 *   由管线统一闭环"），否则会**双重验证**、白跑两遍全量 build。
 *
 *   ★ 2026-10-06（T46）：正因如此，原先自带的 `removeDeadStatements`（含 `applyWithVerify`
 *   的一体式执行器）已**随零消费者删除** —— 它是"管线化之前"的遗留：管线走
 *   `flagDeadStatements` + 自己 apply，**从不调用它**（全仓零引用）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAstRoot, type SyntaxNodeLike } from '../../parse/kernel.js';

// ─────────────────────────────────────────────
// 检测：不可达语句 run（纯函数，按源码+扩展名）
// ─────────────────────────────────────────────

export interface DeadStatementRun {
  category: 'unreachable';
  /** 首条不可达语句的语法节点类型（便于人审计） */
  stmt_type: string;
  /** 1-based 起始行（含） */
  start: number;
  /** 1-based 结束行（含） */
  end: number;
  /** 首条语句首行原文摘要 */
  snippet: string;
}

export interface DeadStatementReport {
  file: string;
  lang: 'go' | 'ts';
  runs: DeadStatementRun[];
}

/** TS/JS 终止语句类型 */
const TS_TERMINAL = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement']);
/** Go 终止语句类型（panic 单独按表达式判定，见 isTerminal） */
const GO_TERMINAL = new Set(['return_statement', 'break_statement', 'continue_statement', 'goto_statement']);
/** 块节点类型（Go block / TS statement_block） */
const BLOCK_TYPES = new Set(['block', 'statement_block']);

function isTerminal(node: SyntaxNodeLike, lang: string): boolean {
  if (lang === 'go') {
    if (GO_TERMINAL.has(node.type)) return true;
    // Go 无 throw 语句：expression_statement 直接调用 panic( 视为抛出
    return node.type === 'expression_statement' && /^\s*panic\s*\(/.test(node.text);
  }
  return TS_TERMINAL.has(node.type);
}

/** 子树中任一节点的类型 ∈ set 则命中（DFS） */
function subtreeHas(node: SyntaxNodeLike, types: Set<string>): boolean {
  if (types.has(node.type)) return true;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && subtreeHas(c, types)) return true;
  }
  return false;
}

/** 收集声明名（TS 提升校验用）：variable_declarator 的 name 字段、
 *  function/class/type/interface/enum/namespace 声明的 name 字段。 */
function collectDeclaredNames(node: SyntaxNodeLike, out: Set<string>): void {
  if (node.type === 'variable_declarator') {
    const nm = node.childForFieldName('name');
    if (nm && /^[A-Za-z_$][\w$]*$/.test(nm.text)) out.add(nm.text);
  } else if (
    node.type === 'function_declaration' || node.type === 'class_declaration' ||
    node.type === 'type_alias_declaration' || node.type === 'interface_declaration' ||
    node.type === 'enum_declaration' || node.type === 'namespace_declaration'
  ) {
    const nm = node.childForFieldName('name');
    if (nm && /^[A-Za-z_$][\w$]*$/.test(nm.text)) out.add(nm.text);
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectDeclaredNames(c, out);
  }
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 声明名集合在整个文件"去掉本句区间后"是否零出现（避免删掉被可达代码读到的提升名） */
function namesUnreferencedOutside(names: Set<string>, src: string, startIdx: number, endIdx: number): boolean {
  const outside = src.slice(0, startIdx) + src.slice(endIdx);
  for (const n of names) {
    const re = new RegExp(`(?<![\\w$])${escRe(n)}(?![\\w$])`);
    if (re.test(outside)) return false;
  }
  return true;
}

/** 判定某条（终止后的）兄弟语句是否安全可删。lang='go' 走 Go 规则，否则走 TS 规则。 */
function isDeletable(stmt: SyntaxNodeLike, src: string, lang: string): boolean {
  // 带标签（goto/label 前跳目标）或 export：一律禁删
  if (subtreeHas(stmt, new Set(['labeled_statement', 'export_statement']))) return false;
  if (lang === 'go') {
    // Go 无块级提升，终止后兄弟语句均可删（label/export 已在上方挡掉）
    return true;
  }
  // TS：若有声明，必须这些名字在整个文件去掉本句后不再出现
  const names = new Set<string>();
  collectDeclaredNames(stmt, names);
  if (names.size > 0) {
    const s = stmt.startIndex ?? 0;
    const e = stmt.endIndex ?? src.length;
    return namesUnreferencedOutside(names, src, s, e);
  }
  return true;
}

/** 单个块内的不可达 run 判定：遇到终止语句后，收集其后的连续可删兄弟语句。 */
function detectInBlock(block: SyntaxNodeLike, src: string, lang: string): DeadStatementRun[] {
  const stmts: SyntaxNodeLike[] = [];
  for (let i = 0; i < block.childCount; i++) {
    const c = block.child(i);
    if (c && (c.isNamed ?? true)) stmts.push(c);
  }
  const out: DeadStatementRun[] = [];
  for (let i = 0; i < stmts.length; i++) {
    if (!isTerminal(stmts[i], lang)) continue;
    // 从 i+1 起收集连续可删兄弟语句
    let j = i + 1;
    while (j < stmts.length && isDeletable(stmts[j], src, lang)) j++;
    if (j > i + 1) {
      const first = stmts[i + 1];
      const last = stmts[j - 1];
      out.push({
        category: 'unreachable',
        stmt_type: first.type,
        start: first.startPosition.row + 1,
        end: last.endPosition.row + 1,
        snippet: first.text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 60),
      });
    }
    break; // 仅首个终止语句生效；其后语句本就在 run 内或已到达边界
  }
  return out;
}

/** 单文件检测（纯，按源码 + 扩展名）。失败返回空数组（解析失败 = 保守不改）。 */
export async function detectUnreachableRunsInSource(src: string, ext: string): Promise<DeadStatementRun[]> {
  const ast = await parseAstRoot(`__virtual__.${ext}`, src);
  if (!ast) return [];
  const lang = ast.langName === 'go' ? 'go' : 'ts';
  const out: DeadStatementRun[] = [];
  const walk = (node: SyntaxNodeLike): void => {
    if (BLOCK_TYPES.has(node.type)) out.push(...detectInBlock(node, src, lang));
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) walk(c);
    }
  };
  walk(ast.root);
  // 合并重叠/相邻 run（同一区域内多个终止语句产生的边界收敛）
  out.sort((a, b) => a.start - b.start);
  const merged: DeadStatementRun[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function langOfExt(ext: string): 'go' | 'ts' | null {
  if (ext === '.go') return 'go';
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) return 'ts';
  return null;
}

const SRC_RE = /\.(go|ts|tsx|js|jsx|mjs|cjs)$/;

/** 扫描目录（或显式文件清单）→ 每文件不可达 run 报告。 */
export async function flagDeadStatements(opts: {
  project_dir: string;
  /** 显式文件清单（相对 project_dir 或绝对路径）；缺省递归扫全部 TS/Go 源 */
  files?: string[];
}): Promise<DeadStatementReport[]> {
  const proj = path.resolve(opts.project_dir);
  const toAbs = (f: string): string => (path.isAbsolute(f) ? path.resolve(f) : path.resolve(proj, f));
  const targets: string[] = [];
  if (opts.files && opts.files.length > 0) {
    for (const f of opts.files) targets.push(toAbs(f));
  } else {
    const walkDir = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkDir(p);
        else if (SRC_RE.test(ent.name)) targets.push(p);
      }
    };
    walkDir(proj);
  }

  const reports: DeadStatementReport[] = [];
  for (const abs of targets) {
    let src: string;
    try {
      src = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const lang = langOfExt(path.extname(abs));
    if (!lang) continue;
    const runs = await detectUnreachableRunsInSource(src, path.extname(abs));
    reports.push({ file: path.relative(proj, abs) || abs, lang, runs });
  }
  return reports;
}

// ─────────────────────────────────────────────
// 删除：按 run 行区间裁剪（纯函数）+ 执行器 + verify 闭环
// ─────────────────────────────────────────────

export function applyReachabilityRuns(src: string, runs: DeadStatementRun[]): { removed: number; changed: boolean; output: string } {
  if (!runs || runs.length === 0) return { removed: 0, changed: false, output: src };
  const lines = src.split('\n');
  const kill = new Set<number>();
  for (const r of runs) {
    for (let i = r.start - 1; i <= r.end - 1; i++) kill.add(i);
  }
  const out = lines.filter((_, i) => !kill.has(i)).join('\n');
  return { removed: new Set([...kill].filter((i) => i >= 0 && i < lines.length)).size, changed: out !== src, output: out };
}

