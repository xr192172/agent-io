/**
 * contract_gate · 语言无关骨架（编排层）
 *
 * 扫描被改动文件，判定每个 `X.` 形式的"包/接收者引用"的裸标识符是否有定义来源
 * （本文件声明 ∪ import 别名 ∪ 本文件局部变量 ∪ 全局白名单），产出契约失配清单；
 * 快照 / 前后 diff / 单点便利封装都在本文件。
 *
 * ★ 语言分支不再内联 if 链：`collectSymbols` / `collectReferences` / 保留字集 / 全局白名单
 *   全部下沉到 `languages/<lang>.ts` 语言包，本文件只经 `languages/registry.ts` 的
 *   `cgPackageForLang(lang)` / `langOfFile(rel)` **查表**，零语言知识。
 * ★ 与语言包共享的零件（类型 / `scanDotRefs` / `CgLangPackage` 契约）住在 `parts.ts`
 *   （断环：`core → registry → 语言包 → core`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_EXTS } from '../../parse/index.js';
import { skipDirSet } from '../../parse/source_exts.js';
import { missingLanguageHint } from '../../parse/lang_hint.js';
import type { Lang } from './parts.js';
import { cgPackageForLang, langOfFile } from './languages/registry.js';

export interface UndefinedRef {
  /** 相对 cwd 的路径（POSIX 分隔符） */
  file: string;
  line: number;
  ident: string;
  /** 直观拼写：file:line ident */
  hint: string;
}

export interface FileScan {
  file: string;
  lang: Lang;
  undefinedRefs: UndefinedRef[];
}

/**
 * 被**跳过**（未对账）的文件 —— §2d「少做事必须可见」。
 *
 * 为什么需要（P11，2026-09-29）：`scanContracts` 原先 `if (!l) continue;` ——
 * 「本工具没有这门语言的适配器」这件事**没被报告**，于是 `.rs`/`.php`/`.vue` 这类
 * 已进入扫描列表（`SOURCE_EXTS`）的文件，在报告里与"查过且干净"**无法区分**。
 * ⇒ 现在显式记一笔，并给可执行提示；「未对账 ≠ 没问题」。
 */
export interface SkippedFile {
  file: string;
  /** 归一化扩展名（小写，含点） */
  ext: string;
  reason: string;
}

export interface ContractSnapshot {
  at: string;
  files: FileScan[];
  /** 聚合去重后全部失配（便于一眼看） */
  undefinedRefs: UndefinedRef[];
  /** 未对账的文件（无适配器/无法判定语言）——**漏检必须可见**，不是"零失配" */
  skipped: SkippedFile[];
}

export interface ContractDiff {
  before: ContractSnapshot;
  after: ContractSnapshot;
  /** 重构吸后**新增**的失配（before 没有的）——正是重构 break 出来的 */
  newIssues: UndefinedRef[];
}

export interface ScanContractsOptions {
  /** 项目根；返回的相对路径以它为基准 */
  cwd: string;
  /** 显式文件列表（优先于 dirs/自动扫描） */
  files?: string[];
  /** 递归扫描的目录（默认 cwd 本身）；会排除 node_modules/.git/vendor/dist/web/dist 等 */
  dirs?: string[];
  /** 强制语言；缺省按扩展名自动判定 */
  lang?: Lang | 'auto';
}

// ── 常量 ─────────────────────────────────────────────

/**
 * 扫描纳入的源码扩展名 —— ★ 来自内核唯一权威 `SOURCE_EXTS`（`ts_kernel/source_exts.ts`）。
 *
 * 此前此处手写 12 个，而同一问题在仓内还有 5 份不同答案（deprecate_offline 7 / package_migration 8 /
 * refs_text 11 / rule_apply 14 / project_root 15）⇒ "某个扩展名的文件要不要分析"取决于
 * **你碰巧调了哪个工具**。统一到权威的并集后**只增不减**（原 12 个是并集的真子集）。
 * 同族副本的登记与棘轮见 `tests/single_source.test.ts`。
 */
const SRC_EXT = SOURCE_EXTS;

// ★ 迁到内核同源跳过集（2026-09-28）：基础集由 `source_exts.SKIP_DIR_BASE` 唯一提供
//   ⇒ 本行的数组是**本调用方显式追加**的语言/用途专属项（有意变宽的部分已在提交里声明）
const EXCLUDE_DIRS = skipDirSet(['vendor']);

// ── 文件枚举 ─────────────────────────────────────────

function walkFiles(root: string, dirs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const dirQueue = [...dirs];
  while (dirQueue.length) {
    const dir = dirQueue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const en of entries) {
      const abs = path.join(dir, en.name);
      if (en.isDirectory()) {
        if (EXCLUDE_DIRS.has(en.name)) continue;
        dirQueue.push(abs);
      } else if (en.isFile() && SRC_EXT.some((e) => en.name.endsWith(e))) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        if (!seen.has(rel)) {
          seen.add(rel);
          out.push(abs);
        }
      }
    }
  }
  return out;
}

// ── 源码正文清洗（去注释/字符串，降低误报） ─────────────

type Cleaned = { text: string; lineOf: number[] };

/**
 * 去注释 + 去字符串，返回清洗后文本和"物理行号 → 清洗后行号"映射。
 * 规则：// 到行尾、/* *\/ 块注释（跨行折叠成空格）、"…"、'…'、`…`（Go raw / JS template）。
 */
function cleanSource(src: string, lang: Lang): Cleaned {
  const lines = src.split('\n');
  const out: string[] = [];
  const lineOf: number[] = [];
  const inBlock = { v: false };
  for (let i = 0; i < lines.length; i++) {
    const cleaned = cleanLine(lines[i], lang, inBlock);
    out.push(cleaned);
    lineOf.push(i + 1); // 物理行号
  }
  return { text: out.join('\n'), lineOf };
}

function cleanLine(raw: string, lang: Lang, inBlock: { v: boolean }): string {
  let s = raw;
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (!inBlock.v) {
      const bc = s.indexOf('/*', i);
      const lc = s.indexOf('//', i);
      let stop = s.length;
      if (bc !== -1) stop = Math.min(stop, bc);
      if (lc !== -1) stop = Math.min(stop, lc);
      parts.push(stripStrings(s.slice(i, stop), lang));
      if (lc !== -1 && lc <= (bc === -1 ? Infinity : bc)) {
        break; // 行注释：丢弃到行尾
      }
      if (bc !== -1) {
        inBlock.v = true;
        i = bc + 2;
        continue;
      }
      i = stop;
    } else {
      const end = s.indexOf('*/', i);
      if (end === -1) {
        i = s.length; // 块注释延续到本行结束
      } else {
        inBlock.v = false;
        i = end + 2;
      }
    }
  }
  return parts.join('');
}

function stripStrings(s: string, lang: Lang): string {
  // 去单双引号与（TS）模板串；Go 另有反引号 raw string
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < n && s[j] !== q) {
        if (s[j] === '\\') j++;
        j++;
      }
      i = Math.min(j + 1, n);
      out.push(' ');
    } else if (c === '`') {
      let j = i + 1;
      while (j < n && s[j] !== '`') j++;
      i = Math.min(j + 1, n);
      out.push(' ');
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join('');
}

// ── 单一文件符号分析 ─────────────────────────────

function scanOne(cwd: string, abs: string, lang: Lang): FileScan {
  const file = path.relative(cwd, abs).split(path.sep).join('/') || abs;
  const pkg = cgPackageForLang(lang)!;
  let src = '';
  try {
    src = fs.readFileSync(abs, 'utf-8');
  } catch {
    return { file, lang, undefinedRefs: [] };
  }
  const cleaned = cleanSource(src, lang);
  const { declared, aliases, locals } = pkg.collectSymbols(cleaned.text);
  const combined = new Set<string>([...declared, ...aliases, ...locals]);
  if (pkg.globals) for (const g of pkg.globals) combined.add(g);

  const refs = pkg.collectReferences(cleaned.text);
  const undefinedRefs: UndefinedRef[] = [];
  for (const r of refs) {
    if (!combined.has(r.ident)) {
      const line = cleaned.lineOf[Math.min(r.line - 1, cleaned.lineOf.length - 1)];
      undefinedRefs.push({ file, line, ident: r.ident, hint: `${file}:${line} ${r.ident}.` });
    }
  }
  return { file, lang, undefinedRefs };
}

export function scanContracts(opts: ScanContractsOptions): ContractSnapshot {
  const cwd = path.resolve(opts.cwd);
  const files: string[] = opts.files && opts.files.length > 0
    ? opts.files.map((f) => (path.isAbsolute(f) ? f : path.resolve(cwd, f)))
    : walkFiles(cwd, opts.dirs && opts.dirs.length > 0 ? opts.dirs.map((d) => path.resolve(cwd, d)) : [cwd]);

  const dirList: FileScan[] = [];
  const skipped: SkippedFile[] = [];
  const seen = new Set<string>();
  for (const abs of files) {
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    if (seen.has(rel)) continue;
    seen.add(rel);
    const l = opts.lang === 'auto' || !opts.lang ? langOfFile(rel) : opts.lang;
    if (!l) {
      // ★ P11（§2d 少做事必须可见）：原来这里 `continue` —— 静默跳过 = 报告里看不见
      // "这个文件压根没查"。现在显式登记，由 renderContractSkips 汇总成一句话。
      const ext = path.extname(rel).toLowerCase();
      skipped.push({ file: rel, ext, reason: `无 ${ext} 的语言分支（本闸只对 go/ts 家族/py/java/cs/c 对账）` });
      continue;
    }
    dirList.push(scanOne(cwd, abs, l));
  }

  // 聚合去重失配
  const undefMap = new Map<string, UndefinedRef>();
  for (const f of dirList) {
    for (const r of f.undefinedRefs) {
      const key = `${r.file}:${r.line}:${r.ident}`;
      if (!undefMap.has(key)) undefMap.set(key, r);
    }
  }

  return { at: new Date().toISOString(), files: dirList, undefinedRefs: [...undefMap.values()], skipped };
}

/**
 * 未对账文件的**可见**报告（§2d：少做事必须可见；且**别把同一警告重复 N 遍**）。
 * 按扩展名去重成一行/种 ⇒ 一个仓库里 200 个 `.rs` 只喊一次。
 */
export function renderContractSkips(skipped: readonly SkippedFile[]): string {
  if (skipped.length === 0) return '';
  const byExt = new Map<string, number>();
  for (const s of skipped) byExt.set(s.ext, (byExt.get(s.ext) ?? 0) + 1);
  const lines = [...byExt.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ext, n]) => `${ext} ×${n} → ${missingLanguageHint(ext, 'contract_gate')}`);
  return (
    `\n⚠️ 契约闸门**未对账** ${skipped.length} 个文件（没查过 ≠ 没问题，这些文件的失配不在下面清单里）：\n  ` +
    lines.join('\n  ')
  );
}

// ── 前后 diff ─────────────────────────────────────────

function refKey(r: UndefinedRef): string {
  return `${r.file}:${r.line}:${r.ident}`;
}

export function diffContracts(before: ContractSnapshot, after: ContractSnapshot): ContractDiff {
  const beforeKeys = new Set(before.undefinedRefs.map(refKey));
  const newIssues = after.undefinedRefs.filter((r) => !beforeKeys.has(refKey(r)));
  return { before, after, newIssues };
}

// ── 便利封装（单点场景） ─────────────────────────────

export interface ContractGateResult {
  scan: ContractSnapshot;
  ok: boolean;
  detail?: string;
}

/** 单点扫描：直接对给定 cwd/files 扫一遍并报告失配（不上 diff）。
 *  ★ P11：没查过的文件（无语言分支）也进 detail —— 「零失配」不该掩盖「少查了」。 */
export function contractGate(opts: ScanContractsOptions): ContractGateResult {
  const scan = scanContracts(opts);
  const skipNote = renderContractSkips(scan.skipped);
  if (scan.undefinedRefs.length === 0) {
    return skipNote ? { scan, ok: true, detail: skipNote.trim() } : { scan, ok: true };
  }
  return {
    scan,
    ok: false,
    detail: scan.undefinedRefs.map((r) => r.hint).join('\n') + skipNote,
  };
}
