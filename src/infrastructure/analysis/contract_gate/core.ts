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
// ★ 2026-11-06（R6 · subagent:r6-strip）：**去注释没有第二份** —— 本文件手里有 abs 路径（scanOne(cwd, abs, lang)）
//   ⇒ 按 0.9.1④ 走**整文件权威**（AST 注释区间）；stripComments 只在解析器未预热 / 扩展名不支持（返回 null）时回落。
import { stripCommentsSync } from '../../parse/comments.js';
import { stripComments } from '../../../domain/text_strip.js';
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
  /**
   * ★★★ AGENTS-RULES 0.12（失败必须与「没有」可区分）：跳过**为什么**要分档 ——
   * · `no-adapter`：本闸没有这门语言的适配器（"没查"，环境/能力边界）；
   * · `read-failed`：**想查但读不到源**（"查失败"）；
   * · `walk-failed`：**目录枚举失败**（`readdirSync` 抛）—— 该目录下的文件**一个都没扫**，
   *   所以这一档的 `file` 记的是**目录**路径。改前是 `catch { continue }`：不计数、不告警
   *   ⇒ 报告说"扫了 N 个"，而 N 里少了一整棵子树（覆盖率虚高 = 0.12 的"失败看起来像空"）。
   * 三者都不进 `ContractSnapshot.files`（不虚报覆盖率），但 `read-failed` / `walk-failed` 会让
   * `contractGate` 的 `ok` 不为 true —— `no-adapter` 是"本闸不管这门语言"，另两个是"想查查不动"。
   * 改前 `scanOne` 的 `catch { return { undefinedRefs: [] } }` 把读失败当成"零未定义引用"**并仍 push
   * 进已扫集** ⇒ `ok:true` + 覆盖率虚高（假绿）。
   */
  kind: 'no-adapter' | 'read-failed' | 'walk-failed';
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
 * 同族副本**没有登记表也没有棘轮**了 —— ★ 2026-10-07：原指向 `tests/single_source.test.ts`，
 * 该文件（连同登记表）已于 2026-10-03 有意删除（**不要免疫系统**）。**别去找它，也别重建。**
 */
const SRC_EXT = SOURCE_EXTS;

// ★ 迁到内核同源跳过集（2026-09-28）：基础集由 `source_exts.SKIP_DIR_BASE` 唯一提供
//   ⇒ 本行的数组是**本调用方显式追加**的语言/用途专属项（有意变宽的部分已在提交里声明）
const EXCLUDE_DIRS = skipDirSet(['vendor']);

// ── 文件枚举 ─────────────────────────────────────────

function walkFiles(root: string, dirs: string[]): { files: string[]; walkFailed: SkippedFile[] } {
  const out: string[] = [];
  const seen = new Set<string>();
  const walkFailed: SkippedFile[] = [];
  const dirQueue = [...dirs];
  while (dirQueue.length) {
    const dir = dirQueue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // ★ 0.12：读不到的目录**不许** `continue` —— 它下面可能有源码，一个都没扫却不留痕，
      //   "扫了 N 个"就会虚高，而缺的那些文件的失配永远不会出现在结果里（失败看起来像空）。
      walkFailed.push({
        file: path.relative(root, dir).split(path.sep).join('/') || '.',
        ext: '',
        reason: `读目录失败：${(e as Error).message}`,
        kind: 'walk-failed',
      });
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
  return { files: out, walkFailed };
}

// ── 源码正文清洗（去注释/字符串，降低误报） ─────────────

type Cleaned = { text: string; lineOf: number[] };

/**
 * 去注释 + 去字符串，返回清洗后文本和"物理行号 → 清洗后行号"映射。
 * 规则：// 到行尾、/* *\/ 块注释（跨行折叠成空格）、"…"、'…'、`…`（Go raw / JS template）。
 */
/**
 * 去注释 + 去字符串，返回清洗后文本和"物理行号 → 清洗后行号"映射。
 *
 * ## ★ 2026-11-06（R6）：**去注释不再自己写**（0.9.1④）
 * 本函数手里有 `filePath`（`scanOne(cwd, abs, lang)`）⇒ 走**整文件权威**
 * `infrastructure/parse/comments.ts#stripCommentsSync`（按 **AST 注释区间**，字符串里、Go raw string 里的
 * `//` 天生不会被吃）。解析器未预热 / 扩展名不支持时它返回 `null`（= 没查成，**不是**"没有注释"）
 * ⇒ 回落**片段权威** `domain/text_strip.ts#stripComments`（与 `detect_dead_imports#stripTsComments` /
 * `symbols.ts#reexportsOf` 同一形态）—— 两条权威都不成功才轮到"不剥"，而那条路径不存在。
 *
 * ★ 为什么删掉原来的手写 `cleanLine`：它是一条**字符扫描器**，不建模模板串里的 `${…}` 嵌套
 * ⇒ 内层反引号会提前闭合外层 ⇒ 之后整段被当字符串/或被当注释吃掉。同一份病在
 * `src/domain/text_strip.ts#stripComments` 上实测 **10 文件 / 585 行**（真文件 `scripts/measure_b_contract.mjs:683`
 * 漏剥、`src/infrastructure/analysis/observe/run_env.ts:96` 少 48 字符）⇒ 那是"同一件事的第二份实现"，
 * 不是"一个刚好够用的小工具"（0.9.1 方向 A）。
 *
 * ★ 仍保留的 `stripStrings`：那是**掩字符串字面量**（不剥注释），是另一种能力，不在 R6 作用面内。
 * ★ `lineOf` 仍是**恒等映射**（`cleanLine` 从不删行 ⇒ 第 i 行永远是第 i+1 行）；保持原样不改，
 *   已作为残留报给主控（去掉它要连带改 `collectReferences` 的行号口径，不属本卡）。
 */
function cleanSource(src: string, lang: Lang, filePath?: string): Cleaned {
  const commentFree = (filePath ? stripCommentsSync(filePath, src) : null) ?? stripComments(src);
  const lines = commentFree.split('\n');
  const out: string[] = [];
  const lineOf: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(stripStrings(lines[i], lang));
    lineOf.push(i + 1); // 物理行号
  }
  return { text: out.join('\n'), lineOf };
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

/**
 * 单文件扫描的**结果**（★ 0.12：读失败必须与"零未定义引用"可区分）。
 *
 * `ok:false` ⇒ 该文件**没查过**（源读不到）⇒ 调用方必须把它记进 `skipped`（`kind:'read-failed'`），
 * **不许**当成"扫过且干净"塞进 `files` —— 否则覆盖率虚高，而"零失配"里混着"没看"。
 */
type ScanOneOutcome = { ok: true; scan: FileScan } | { ok: false; ext: string; reason: string };

function scanOne(cwd: string, abs: string, lang: Lang): ScanOneOutcome {
  const file = path.relative(cwd, abs).split(path.sep).join('/') || abs;
  const pkg = cgPackageForLang(lang)!;
  let src = '';
  try {
    src = fs.readFileSync(abs, 'utf-8');
  } catch (e) {
    // ★ 0.12：不许空手返回 —— 带出**为什么**读不到（EISDIR / EACCES / ENOENT 都是不同的病）
    return { ok: false, ext: path.extname(file).toLowerCase(), reason: `读源失败：${(e as Error).message}` };
  }
  const cleaned = cleanSource(src, lang, abs);
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
  return { ok: true, scan: { file, lang, undefinedRefs } };
}

export function scanContracts(opts: ScanContractsOptions): ContractSnapshot {
  const cwd = path.resolve(opts.cwd);
  // ★ 0.12：目录枚举的失败**也进 `skipped`**（`walk-failed`）—— 见 `walkFiles` 的返回值形状。
  //   显式文件列表那一支没有"目录枚举"这一步，故此处 walkFailed 恒空。
  const walked: { files: string[]; walkFailed: SkippedFile[] } =
    opts.files && opts.files.length > 0
      ? { files: opts.files.map((f) => (path.isAbsolute(f) ? f : path.resolve(cwd, f))), walkFailed: [] }
      : walkFiles(cwd, opts.dirs && opts.dirs.length > 0 ? opts.dirs.map((d) => path.resolve(cwd, d)) : [cwd]);
  const files: string[] = walked.files;

  const dirList: FileScan[] = [];
  const skipped: SkippedFile[] = [...walked.walkFailed];
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
      skipped.push({ file: rel, ext, reason: `无 ${ext} 的语言分支（本闸只对 go/ts 家族/py/java/cs/c 对账）`, kind: 'no-adapter' });
      continue;
    }
    // ★★★ 0.12：读失败**进 skipped**（`read-failed`），**不进** `dirList` ——
    //   改前它被当成"零未定义引用"并计入已扫 ⇒ 覆盖率虚高 + `ok:true`。
    const r = scanOne(cwd, abs, l);
    if (!r.ok) {
      skipped.push({ file: rel, ext: r.ext, reason: r.reason, kind: 'read-failed' });
      continue;
    }
    dirList.push(r.scan);
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
 *
 * ★ 0.12：**读失败与"没适配器"分开报** —— 前者是"想查、查不动"（逐个点名，因为修法不同：
 *   权限/锁/路径），后者是"本闸不管这门语言"（按扩展名归并）。
 */
export function renderContractSkips(skipped: readonly SkippedFile[]): string {
  if (skipped.length === 0) return '';
  const readFailed = skipped.filter((s) => s.kind === 'read-failed');
  // ★ 目录级失败**不许**混进"没有语言适配器"那一支（`kind !== 'read-failed'` 会把目录也吞进去）：
  //   两者修法不同 —— 一个修环境/路径，一个扩语言分支。
  const walkFailed = skipped.filter((s) => s.kind === 'walk-failed');
  const noAdapter = skipped.filter((s) => s.kind === 'no-adapter');
  const blocks: string[] = [];
  if (readFailed.length > 0) {
    blocks.push(
      `★ 读不到源（**读失败 ≠ 零失配**） ${readFailed.length} 个 —— 这些文件的失配不在下面清单里：\n  ` +
        readFailed
          .slice(0, 10)
          .map((s) => `${s.file} → ${s.reason}`)
          .join('\n  ') +
        (readFailed.length > 10 ? `\n  … 等 ${readFailed.length} 个` : ''),
    );
  }
  if (walkFailed.length > 0) {
    blocks.push(
      `★ 读不到目录（**这些目录下的文件一个都没扫**） ${walkFailed.length} 个：\n  ` +
        walkFailed
          .slice(0, 10)
          .map((s) => `${s.file} → ${s.reason}`)
          .join('\n  ') +
        (walkFailed.length > 10 ? `\n  … 等 ${walkFailed.length} 个` : ''),
    );
  }
  if (noAdapter.length > 0) {
    const byExt = new Map<string, number>();
    for (const s of noAdapter) byExt.set(s.ext, (byExt.get(s.ext) ?? 0) + 1);
    const lines = [...byExt.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ext, n]) => `${ext} ×${n} → ${missingLanguageHint(ext, 'contract_gate')}`);
    blocks.push(
      `⚠️ 契约闸门**未对账** ${noAdapter.length} 个文件（没查过 ≠ 没问题，这些文件的失配不在下面清单里）：\n  ` +
        lines.join('\n  '),
    );
  }
  return `\n${blocks.join('\n')}`;
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
 *  ★ P11：没查过的文件（无语言分支）也进 detail —— 「零失配」不该掩盖「少查了」。
 *  ★★ 0.12：**读失败 ⇒ `ok:false`**（改前读不动的源被当成"零未定义引用" ⇒ 假绿）；
 *     且 detail 一律带分母（扫了 N / 跳过 M）。 */
export function contractGate(opts: ScanContractsOptions): ContractGateResult {
  const scan = scanContracts(opts);
  const skipNote = renderContractSkips(scan.skipped);
  const readFailed = scan.skipped.filter((s) => s.kind === 'read-failed');
  // ★ 0.12：目录读不到 ⇒ **整棵子树没进清单** ⇒ 它必须出现在分母里（且不能算成"扫过"）。
  const walkFailed = scan.skipped.filter((s) => s.kind === 'walk-failed');
  /** ★ 分母：只给分子（失配数）等于没验；目录级失败**单列**，不和文件跳过混成一个数 */
  const fileSkips = scan.skipped.length - walkFailed.length;
  const denom =
    `扫了 ${scan.files.length} 个 / 跳过 ${fileSkips} 个` +
    (walkFailed.length > 0 ? ` / 读不到目录 ${walkFailed.length} 个（这些目录下的文件**一个都没扫**）` : '');
  if (readFailed.length > 0 || walkFailed.length > 0) {
    const why = [
      readFailed.length > 0 ? `${readFailed.length} 个文件读不到源` : '',
      walkFailed.length > 0 ? `${walkFailed.length} 个目录读不到` : '',
    ]
      .filter(Boolean)
      .join(' + ');
    return {
      scan,
      // ★ 不是"有失配"，而是"**没验全**" —— 两者都不绿，但原因不同，detail 要说清是哪一种
      ok: false,
      detail:
        `★ 契约门**没验全**（${denom}）：${why} ⇒ 它们的失配不在清单里\n` +
        [...readFailed, ...walkFailed].map((s) => `  · ${s.file}：${s.reason}`).join('\n') +
        skipNote,
    };
  }
  if (scan.undefinedRefs.length === 0) {
    const head = `${denom}（失配 0）`;
    return skipNote ? { scan, ok: true, detail: `${head}${skipNote}` } : { scan, ok: true, detail: head };
  }
  return {
    scan,
    ok: false,
    detail: `${denom}（失配 ${scan.undefinedRefs.length}）\n` + scan.undefinedRefs.map((r) => r.hint).join('\n') + skipNote,
  };
}
