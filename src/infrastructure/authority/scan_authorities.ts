/**
 * scan_authorities —— 「事实权威导航」的**唯一采集端**（`capability_map` 那一段由它现扫产出）
 *
 * ## 为什么要有它（这是 AGENTS.md 0.20 的根治，不是兜底）
 * 判一个**仓级 / 会话级事实**（卡活不活 · 哪些 import 死了 · 一行 scope 什么意思 · 哪些目录不算源）
 * 的**唯一权威全是内部函数**，它们**不在工具面上** ⇒ agent 结构性看不见 ⇒ 只能靠 `grep` 偶然发现
 * ⇒ 于是每次都在重造第二处权威（实测四次，0 次自省发现，全部由别人或实测纠正）。
 *
 * ## 不落第二份清单（本模块存在的关键约束）
 * 权威**自己在源码里带标记**（`@authority`），本模块**每次现扫**。
 * 标记跟着函数走：函数改名 / 删除 ⇒ 标记一起变 ⇒ 不可能出现「表里说用 X，而 X 已不存在」
 * （反例就在本仓：AGENTS.md 曾举例 `targetKeysOf`，而它全仓 0 命中）。
 *
 * ## 标记格式（写在权威函数的文档注释里）
 * ```
 * @authority <一句话：它回答什么问题>
 * @authority-via <工具名>[, <工具名>…]   // 可选；缺省 = internal（= 还没有工具面，属欠账）
 * @authority-note <口径 / 边界一句>       // 可选
 * ```
 * 关联规则：**标记之后的第一条声明**就是它描述的符号 —— 所以改名**不用改标记**。
 *
 * ★ **围栏里的不算**（这一条不是可选的）：注释里用 ``` 围起来的段落是**格式示例**，
 *   `parseAuthorityMarks` 会整段跳过 —— 否则"文档里演示怎么写标记"本身会变成一条假权威
 *   （实测：本文件头最初就这么写，于是 `AuthorityEntry` 被当成一条 via 指向不存在的工具的权威）。
 *   判据见 `tests/p0_authority_nav.test.ts` ⑧（围栏内不命中 / 围栏外命中，双向）。
 *
 * ## ★ 为什么这里可以用正则扫（0.18① 的**例外**，理由必须写明）
 * 要取的东西**就住在注释里**（`@authority` 之后那句话）：它**不是语法结构** ——
 * AST 里没有「这条注释想回答哪个问题」这种节点，所以这一格**只能**读文本。
 * 反过来，**目标符号名不靠猜**：由「标记之后第一条声明」现取，正则只认声明的**形状**、不认语义。
 * ⇒ 文本形状本身就是答案 ⇒ 正则合法；结构仍归 AST。
 *
 * ## 失败必须与「没有」可区分（0.12）
 * 源码根不可达 / 扫到 0 条 / 标记悬空（后面没有声明）⇒ **各自出诊断**，`entries` 带分母
 * （`files_scanned`），调用方**不许**把"扫不动"渲染成"没有权威"。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPackageRoot } from '../storage.js';
// ★ 复用既有的「哪些文件算源码」遍历（不新造第二套 walk）：
//   `scanProjectSourceFiles` 已经是 `refactor_pipeline` / `deprecate_offline` 的同一把尺。
import { scanProjectSourceFiles } from '../analysis/deadcode/detect_dead_imports.js';

/** 一条权威标记的读数（`capability_map` 的 authorities 段就是它的投影） */
export interface AuthorityEntry {
  /** 它回答什么问题（一句话；`@authority` 之后的原文） */
  question: string;
  /** 标记描述的符号名（**现取**：标记之后的第一条声明） */
  symbol: string;
  /** 仓库相对路径（正斜杠，锚 `getPackageRoot()`） */
  file: string;
  /** 标记所在行（1-based） */
  line: number;
  /** 声明所在行（1-based）—— 与标记可以隔若干行 */
  decl_line: number;
  /** 工具面（TOOL_DEFS 名，逗号分隔）；`internal` = 还没有工具面 */
  via: string;
  /** 口径 / 边界（可选一句） */
  note?: string;
}

/** 扫描期的问题（**不是**空数组：每条都能指出文件行号） */
export interface ScanProblem {
  file: string;
  line: number;
  reason: string;
}

export interface AuthorityScan {
  entries: AuthorityEntry[];
  /** 扫过的源文件数 —— 统计型输出必须带分母（0.12） */
  files_scanned: number;
  /** 扫描锚点（绝对路径；回执里印出来，让"扫的是哪儿"可复核） */
  root: string;
  problems: ScanProblem[];
  /** 非空 ⇒ `entries` **不可信**（调用方必须显式报，不许当"没有权威"） */
  error?: string;
}

/** `via` 里 `internal` 这个保留词（= 该权威还没有工具面，属 0.20 的欠账） */
export const INTERNAL_VIA = 'internal';

/** 把 `via` 拆成工具名（逗号 / 斜杠 / 竖线 / 空白都算分隔） */
export function viaTokens(via: string | undefined): string[] {
  return String(via ?? '')
    .split(/[,\uFF0C/|、\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 该条权威是否**还没有工具面**（全部 token 都是 internal） */
export function isInternalVia(via: string | undefined): boolean {
  const toks = viaTokens(via);
  return toks.length === 0 || toks.every((t) => t === INTERNAL_VIA);
}

/** 注释块里的 ``` 围栏行（围栏内的内容是格式示例，跳过） */
const FENCE_LINE_RE = /^\s*(?:\/\/|\/\*|\*)\s*```/;

/** 只认注释行：`//…` / `/*…` / `* …`（行首可有空白） */
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*)/;

/** 声明的形状（只认名字，不认语义） */
const DECL_RE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;

/** 标记行：authority 标签后跟一句话（-via / -note 由下面两条单独认；★ 这里不写 @ + 标签全名，否则本行自己会被当成一条标记 —— 实测过） */
const MARK_RE = /@authority[ \t]+(.+?)\s*(?:\*\/)?\s*$/;
const MARK_VIA_RE = /@authority-via[ \t]+(.+?)\s*(?:\*\/)?\s*$/;
const MARK_NOTE_RE = /@authority-note[ \t]+(.+?)\s*(?:\*\/)?\s*$/;

/** `@authority-via` / `@authority-note` 只在前一条标记之后这么远内有效（避免跨函数串味） */
const TAIL_WINDOW = 8;
/** 标记之后找声明的最大距离（超出 ⇒ 判悬空，不猜） */
const DECL_WINDOW = 150;

/**
 * 从**一份源码文本**解析出 `@authority` 标记（纯函数，无 IO ⇒ 可单测）。
 *
 * @param source 源码原文
 * @param relFile 仓库相对路径（回执里用；测试可传任意标签）
 */
export function parseAuthorityMarks(
  source: string,
  relFile = '',
): { entries: AuthorityEntry[]; problems: ScanProblem[] } {
  const lines = source.split(/\r?\n/);
  const entries: AuthorityEntry[] = [];
  const problems: ScanProblem[] = [];

  let inFence = false; // ``` 围栏内的注释是**格式示例**，不是标记（见文件头解释）
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!COMMENT_LINE_RE.test(line)) {
      inFence = false; // 注释块结束 ⇒ 围栏状态不跨块
      continue;
    }
    if (FENCE_LINE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = MARK_RE.exec(line);
    if (!m) continue;

    const question = m[1].trim();
    let via = INTERNAL_VIA;
    let note: string | undefined;

    // 同一注释块里紧跟的 `-via` / `-note`（限窗口，避免跨到下一条标记）
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + TAIL_WINDOW); j += 1) {
      const l = lines[j];
      if (!COMMENT_LINE_RE.test(l)) break;
      if (MARK_RE.test(l) && !MARK_VIA_RE.test(l) && !MARK_NOTE_RE.test(l)) break; // 下一条权威开始了
      const mv = MARK_VIA_RE.exec(l);
      if (mv) {
        via = mv[1].trim();
        continue;
      }
      const mn = MARK_NOTE_RE.exec(l);
      if (mn) note = mn[1].trim();
    }

    // 声明：标记之后的第一条（遇到下一条标记即停 ⇒ 悬空，不猜是哪一个函数）
    let symbol = '';
    let declLine = 0;
    for (let k = i + 1; k < Math.min(lines.length, i + 1 + DECL_WINDOW); k += 1) {
      const l = lines[k];
      if (COMMENT_LINE_RE.test(l) && MARK_RE.test(l) && !MARK_VIA_RE.test(l) && !MARK_NOTE_RE.test(l)) break;
      if (COMMENT_LINE_RE.test(l)) continue;
      const d = DECL_RE.exec(l);
      if (d) {
        symbol = d[1];
        declLine = k + 1;
        break;
      }
    }

    if (!symbol) {
      // ★ 不静默：悬空的标记会让"权威清单"看起来比实际少一条，必须单独报出来
      problems.push({
        file: relFile,
        line: i + 1,
        reason: `标记之后 ${DECL_WINDOW} 行内没有声明（悬空 ⇒ 它不对应任何符号）`,
      });
      continue;
    }

    entries.push({
      question,
      symbol,
      file: relFile,
      line: i + 1,
      decl_line: declLine,
      via,
      ...(note ? { note } : {}),
    });
  }

  return { entries, problems };
}

/**
 * 现扫源码，收集全部 `@authority` 标记。
 *
 * @param root 扫描锚点（缺省 = `<包安装根>/src`）。只认 `scanProjectSourceFiles` 收的那批源文件。
 *
 * ★ 为什么不缓存：缓存 = 第二处真相（改了源码读不到最新 ⇒ 这段又开始撒谎）。
 *   `capability_map` 不是热路径，几百个文件读一遍是可以接受的代价。
 */
export function scanAuthorities(root?: string): AuthorityScan {
  const pkgRoot = getPackageRoot();
  const srcRoot = root ? path.resolve(root) : path.join(pkgRoot, 'src');
  if (!fs.existsSync(srcRoot)) {
    return {
      entries: [],
      files_scanned: 0,
      root: srcRoot,
      problems: [],
      error: `源码根不可达：${srcRoot}（⇒ 权威清单**没有**扫，不是"没有权威"）`,
    };
  }
  const files = scanProjectSourceFiles(srcRoot);
  const entries: AuthorityEntry[] = [];
  const problems: ScanProblem[] = [];
  for (const abs of files) {
    let src: string;
    try {
      src = fs.readFileSync(abs, 'utf-8');
    } catch (e) {
      // ★ 读不动必须留痕（0.12：不许静默当成"这个文件没有标记"）
      problems.push({ file: relOf(abs, pkgRoot, root), line: 0, reason: `读失败：${(e as Error).message.slice(0, 120)}` });
      continue;
    }
    const rel = relOf(abs, pkgRoot, root);
    const r = parseAuthorityMarks(src, rel);
    entries.push(...r.entries);
    problems.push(...r.problems);
  }
  // 稳定顺序：文件 → 行（同一份源码两次扫描必须逐字相同 ⇒ 可对拍）
  entries.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return { entries, files_scanned: files.length, root: srcRoot, problems };
}

/** 回执里的路径：锚 `包安装根`（有自定义 root 时锚它，测试夹具才不至于印成绝对路径） */
function relOf(abs: string, pkgRoot: string, root?: string): string {
  const anchor = root ? path.resolve(root) : pkgRoot;
  return path.relative(anchor, abs).replace(/\\/g, '/');
}
