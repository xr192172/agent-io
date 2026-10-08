/**
 * 「什么算源码文件」—— 【唯一权威】
 *
 * ★ 为什么要有这个文件（2026-09-28）：本仓同一件事曾有 **20 处静态清单**（实测 grep），
 *   而彼此的**口径互不一致**。同一个问题"扫哪些文件"，五个工具给出五个答案：
 *     contract_gate 12 个 / deprecate_offline 7 个 / package_migration 8 个 /
 *     refs_text 11 个 / rule_apply 14 个 / project_root 15 个 …
 *   于是"某个扩展名的文件要不要纳入分析"取决于**你碰巧调了哪个工具**。
 *
 * ★★ 根因（值得记住，不然还会再长出来）：
 *   1. **权威答非所问**：内核已有 `listSupportedExtensions()`，但它回答的是
 *      "**我装了哪些 tree-sitter 语言包 ⇒ 我能解析什么**"（动态、随 optionalDependencies 变），
 *      而各工具问的是 "**这个项目里什么算源码**"。两者不等价 ——
 *      实测内核那份是 `['.ts','.js','.mjs','.cjs','.go','.py','.java','.c','.h','.cs','.rs','.php']`
 *      （**连 `.tsx` 都没有**）。**权威没回答大家的问题 ⇒ 各自写一份。**
 *   2. **缺失是沉默的**：漏一个扩展名 = 少扫几个文件，**不报错、不告警**，
 *      没有任何反馈把作者推回权威。⇒ 这是本仓"兜底式代码"增殖的主因。
 *   3. **局部最优**：每次都是"我就加一个扩展名"，没人有动机去看别处已有 19 份。
 *
 * ★ 因此本模块的口径是**按维度分开**，而不是硬合成一个大列表 ——
 *   下面这几个问题**不是同一个问题**，强行合并会把不同语义搅在一起（见每项的说明）：
 *     · `TS_JS_EXTS`        —— 同一套 AST + 同一套模块语义的 JS 家族
 *     · `NODE_RUNNABLE_EXTS`—— 转译后能交给 node 子进程执行的（是上面那个的**真子集**）
 *     · `SOURCE_EXTS`       —— 项目内"可被扫描/分析"的源码（多语言并集）
 *     · ★ `CODE_LANG_EXTS`  —— "**什么算源码**"（按语言类别派生，见「代码语言」一节）
 *   **不属于本模块**（问题不同，继续各留在调用点，但**没有**登记表了 —— ★ 2026-10-07：原写「已在 `tests/single_source_registry.json` 登记」，该表已于 2026-10-03 有意删除）：
 *     · `rename_symbols` 的文本扫描清单（含 `.json/.md/.yml/.html/.css` —— 那些是**可读文本**，不是源码）
 *     · `import_resolve.IMPORT_EXTS`（**可被 import 指向**的东西，含 `.json` 场景是合法的）
 */

import path from 'node:path';
import { LANGUAGES, findLanguageByExt, languageModuleSpec } from './languages.js';

/** TS/JS 家族：同一套 tree-sitter AST、同一套 ESM/CJS 语义。顺序即解析优先级（`.ts` 优先于编译产物 `.js`）。 */
export const TS_JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

const TS_JS_SET = new Set<string>(TS_JS_EXTS);

// ─────────────────────────────────────────────────────────────
// ★★ 「代码语言」—— 「什么算源码」的唯一权威（2026-09-29）
//
// 为什么单列（本笔的病根，读过再动）：`health/index.ts` 与 `impact/index.ts` 此前拿
//   `listSupportedExtensions()`（内核的「**可解析**」能力）当「**什么算源码**」用。
//   两个问题**不等价**，而 `.json` 恰好落在差集里：tree-sitter-json 真能载入 ⇒ 「真筛子」拦不住
//   ⇒ 夹具里的 `package.json` 进了源码集，被报成「**孤立模块 / 待清理 dead code**」，
//   已知好的夹具从 100/A 掉到 80/B（G5 的题眼）。
//
// ★★ 三个概念，各回答各的问题（**别互相替换，更别取并集**）：
//   | 概念       | 回答什么问题                                          | 权威                                | 例               |
//   |------------|-------------------------------------------------------|-------------------------------------|------------------|
//   | 可解析     | 我**能**解析哪些扩展名（随 optionalDependencies 变）   | `probe.listSupportedExts()`         | `.json` ✅        |
//   | ★ 代码语言 | **什么算「源码」**（该进符号索引/该算孤立模块/该体检） | **本节的 `isCodeLangExt`**          | `.json` ❌        |
//   | 可跑 node  | 哪些能被 node 子进程执行                               | `NODE_RUNNABLE_EXTS`（本文件已有）  | `.ts` ✅ `.vue` ❌ |
//   调用方要「源码集」时的正确写法是**前两者的交集**：`codeSourceExts(listSupportedExtensions())`。
//   ⇒ 取交集而不是换成某一份静态清单，是**刻意的**（两个反例都实测过）：
//     改用 `SOURCE_EXTS` 会**静默丢掉** kotlin/cpp/ruby/scala（已装、刚做通，却不在那份清单里），
//     并**带进 `.vue`**（在清单里、本机却根本载不入）—— 那是"少做事而不说话"，正是头注批的那条。
//
// ★ 判据**不在本文件复述**：类别数据 = `languages.ts` 的 `LanguageEntry.kind`（55 条表项）。
//   这里只做**派生**（`kind === 'code'` 的扩展名并集）⇒ 加新语言 = 只加数据，不散落 if。
// ─────────────────────────────────────────────────────────────

/** 注册表里 `kind === 'code'` 的扩展名并集 —— "什么算源码"的权威数据（**派生**自注册表，不手抄） */
export const CODE_LANG_EXTS: readonly string[] = LANGUAGES.filter((l) => l.kind === 'code').flatMap((l) => l.exts);

/**
 * TS/JS 之外、注册表 `kind==='code'` 的所有扩展名（**派生**自 `CODE_LANG_EXTS`，不手抄）。
 * ★ 与旧手抄版（`.go .py .java .cs .c .h .rs .php .vue`）相比，本份**自动包含** kotlin/cpp/ruby/scala/elixir/julia/haskell/go 等
 *   已在 `languages.ts` 登记但本仓未装包的语言 —— 它们进 `SOURCE_EXTS` 但不进 `codeSourceExts()` 的交集，
 *   不会污染实际扫描，但口径声明不再漏报（消除"静默收窄"病根）。
 * ★ 注册表 `typescript` 条目只写 `['.ts']`，缺 `.mts/.cts`；这两项由 `TS_JS_EXTS` 保底，**不会丢**。
 */
export const OTHER_LANG_EXTS: readonly string[] = CODE_LANG_EXTS.filter((e) => !TS_JS_SET.has(e));

/**
 * 项目内"可被扫描/分析"的源码扩展名（多语言并集）。
 *
 * ★ 这是**超集**：原先 6 份互不一致的清单全部是它的真子集 ⇒ 迁移到它**只增不减**，
 *   不存在"某个工具反而看不到原本能看到的文件"的情况（方向单调安全）。
 * ★ `OTHER_LANG_EXTS` 已由 `CODE_LANG_EXTS` 派生，含 kotlin/cpp/ruby/scala 等
 *   注册表已声明但本仓暂未装包的扩展名 —— 它们进 `SOURCE_EXTS` 但不进 `codeSourceExts()` 的交集，
 *   不会污染实际扫描，但口径声明不再漏报（消除"静默收窄"病根）。
 */
export const SOURCE_EXTS: readonly string[] = [...TS_JS_EXTS, ...OTHER_LANG_EXTS];

/**
 * 转译后能交给 `node` 子进程执行的扩展名（`behavior/` 的 harness 用）。
 *
 * ★ 从 `TS_JS_EXTS` **派生**而非另抄一份：`.mts`/`.cts` 在 node 子进程场景下未经验证，
 *   故显式排除 —— 但"排除哪两个"这件事写在这里，不散在调用点。
 */
export const NODE_RUNNABLE_EXTS: readonly string[] = TS_JS_EXTS.filter((e) => e !== '.mts' && e !== '.cts');

const SOURCE_EXT_SET = new Set<string>(SOURCE_EXTS);

/** 是否属于 TS/JS 家族（同 AST / 同模块语义） */
export function isTsJsExt(ext: string): boolean {
  return TS_JS_SET.has(ext.toLowerCase());
}

/** 是否算"项目内可分析的源码"（多语言并集） */
export function isSourceExt(ext: string): boolean {
  return SOURCE_EXT_SET.has(ext.toLowerCase());
}

/** 是否是可交给 node 子进程执行的源码 */
export function isNodeRunnableExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return e !== '.mts' && e !== '.cts' && TS_JS_SET.has(e);
}

const CODE_LANG_EXT_SET = new Set<string>(CODE_LANG_EXTS.map((e) => e.toLowerCase()));

/** 这个扩展名算「源码」吗（= 该语言的类别是 `code`；与"我装没装语言包"无关） */
export function isCodeLangExt(ext: string): boolean {
  return CODE_LANG_EXT_SET.has(ext.toLowerCase());
}

/**
 * 「可解析」∩「代码语言」= 调用方要的**源码集**（唯一合成点 —— 别在调用点各写一遍）。
 * `parseableExts` = `listSupportedExtensions()` 之类"我能解析什么"的答案。
 */
export function codeSourceExts(parseableExts: readonly string[]): string[] {
  return parseableExts.filter(isCodeLangExt);
}

/**
 * 「可解析」里有、但**不算源码**的扩展名 —— 口径收紧的**可见性载体**。
 *
 * ★ 为什么要它：口径一收紧，被排除的扩展名就从源码集里"消失"了；若连**说出来**都没有，
 *   就是本文件头注批的「**缺失是沉默的**」。调用方应把它（或其计数）放进回执 / 统计。
 */
export function excludedNonCodeExts(parseableExts: readonly string[]): string[] {
  return parseableExts.filter((e) => !isCodeLangExt(e));
}

/**
 * 把一次走查的结果按「代码语言」分拣成 源码 / 非代码（非代码给**逐扩展名计数**）。
 * 用途：调用方**一次走查**就能既拿到源码、又拿到"有哪些东西被口径排除"（可见性），
 *   不必为了统计再走一遍目录（也避免第二份目录走查实现）。
 */
/**
 * 「扫到、但**没被本次走查收下**」的扩展名 → **可执行的事实**：注册表里有这门口语吗？缺哪个包？
 *
 * ★ 为什么要有它：走查（`collectSourceFiles`）只能报「`{ext}× N` 没被收下」这个**事实**，
 *   而**原因**分两种，处置完全不同 ——
 *     · 注册表里有这门口语，只是**语言包没装/载不入** ⇒ 补 `npm i <pkg>` 就能读（**可执行**）；
 *     · 注册表里根本没这门口语 ⇒ 不是「装个包」能解决的（要么补进 `languages.ts`，要么它本就不是源码）。
 *   二者混成一句「未读 N 个文件」= 让调用方**无从下手**（本仓的「缺失必须是可行动的」那条）。
 *
 * ★ 判据**派生自注册表**（`findLanguageByExt` + `languageModuleSpec`），**不手抄任何包名**：
 *   加一门语言 = 只加数据，这里的回答自动跟上。
 */
export interface UnmatchedExtFact {
  ext: string;
  /** 注册表里的语言名（没登记这门口语 ⇒ `null`） */
  lang: string | null;
  /** 该语言包应装的模块说明符（没登记 ⇒ `null`）—— 可执行提示 = `npm i <pkg>` */
  pkg: string | null;
}

/** 把一个「没被收下的扩展名」翻译成可行动的事实（纯函数；见 `UnmatchedExtFact` 的立论） */
export function describeUnmatchedExt(ext: string): UnmatchedExtFact {
  const l = findLanguageByExt(ext);
  if (!l) return { ext, lang: null, pkg: null };
  return { ext, lang: l.name, pkg: languageModuleSpec(l.pkg, l.pkgSpec) };
}

export function partitionByCodeLang<T extends { rel: string }>(
  files: readonly T[],
): { code: T[]; nonCodeExts: Array<{ ext: string; count: number }> } {
  const code: T[] = [];
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    if (isCodeLangExt(ext)) code.push(f);
    else counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return {
    code,
    nonCodeExts: [...counts].map(([ext, count]) => ({ ext, count })).sort((a, b) => (a.ext < b.ext ? -1 : 1)),
  };
}

// ─────────────────────────────────────────────────────────────
// "这个文件该不该进符号索引" —— 唯一落点（2026-09-28）
//
// ★ 为什么把它放这里：`import_project`（索引器）原本**自己**持有一条
//   `SKIP_FILE_RE`，而 `index_integrity`（量具）数"磁盘源码"用的 `walkSourceFiles`
//   **只跳目录、不跳这类文件** ⇒ **两个"什么算源码"的口径不一致**，
//   于是量具**必然永远**报"未索引 240"（实测：其中 219 是 `tests/**/*.test.ts`）。
//   这正是本文件头注里说的老病根（"什么算源码"曾散成 20 份清单）**长在量具自己身上**。
//   ⇒ 收成一份、两边共用，删掉索引器里那份私有实现。
//
// ★★ 刻意拆成**两个谓词**（别合成一条正则，那是两个不同维度 —— 见规划书 §2c）：
//   · `isTestFileName`  —— **测试文件**。它们**应当**能进图（改名/找引用时必须看到测试），
//     只是索引器默认 `include_tests=false` 把它排除了；量具要**单独把它标出来**，
//     而不是混进"未索引"当缺陷报。
//   · `isNoiseFileName` —— **噪音/产物**（编辑器临时文件、压缩/生成/声明文件）。
//     它们**不该**被算进"源码"的任何一个数里。
// ─────────────────────────────────────────────────────────────

/** 测试文件：跨语言的"这条是测试吗"（Go `_test.go` / TS `.test.`·`.spec.` / Python `test_*`·`*_test`） */
const TEST_FILE_RE = /(_test\.go$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|test_.*\.py$|.*_test\.py$)/;

/**
 * 噪音/产物：编辑器临时件 + 压缩/生成/声明产物（`.min.js` `.d.ts` `*.gen.ts` …）
 *
 * ★ 2026-10-04：原来还并进了「构建工具转译 config 的临时产物」
 *   （形状 `*.timestamp-<数字>-<字母数字>.mjs`）—— 那一条是**为 vitest 加的**：
 *   本仓曾被它积压 147 个（未跟踪 + 早已 ignore ⇒ 一直没人看见）。
 *   框架整体移除后，这条规则**连同它的唯一实证来源一起消失**，故删。
 *   ★ 若将来在**别的项目**上真遇到这种产物，**那一次再加**（有实据再加，不预留）。
 */
const NOISE_FILE_RE = /(\.min\.js$|\.d\.ts$|\.gen\.[tj]sx?$|\.tmp$|\.temp$|\.crswap$|\.crdownload$|\.swp$|\.swo$|\.swx$|\.bak$|\.orig$|\.rej$|~$)/;

/** 这条文件名是测试吗（★ 与索引器的 `include_tests` 判据同源） */
export function isTestFileName(name: string): boolean {
  return TEST_FILE_RE.test(name);
}

/** 这条文件名是噪音/产物吗（不该算进"源码"任何一个数） */
export function isNoiseFileName(name: string): boolean {
  return NOISE_FILE_RE.test(name);
}

/** 索引器默认跳过（= 测试 ∪ 噪音）。`include_tests=true` 时只跳过噪音。 */
export function isIndexSkippedFileName(name: string, includeTests = false): boolean {
  if (isNoiseFileName(name)) return true;
  return includeTests ? false : isTestFileName(name);
}

// ─────────────────────────────────────────────────────────────
// "哪些目录不算项目源码" —— 唯一落点（2026-09-28，与上面的**文件级**判据同族）
//
// ★ 实测：这个判据在 src/ 下被**各写了 9 份**，大小从 5 项到 28 项、互有出入：
//   import_project(28) / monolith(14) / project_root(15) / java_refactor(12) / feature_map(12) /
//   contract_gate(8) / refs_text(7) / rename_symbols(5) / python_refactor(6)。
//   **它已经产生了可观测的假信号**：`refs_text` 跳 `out` 却**不跳 `output`**、
//   也不跳 `bin`，而索引器两样都跳 ⇒ 量具把 `output/diag-*.mjs` 与
//   `third_party/archify/bin/*.mjs` 数成「**本体**未索引（真缺陷）」—— 其实是"根本不该算源码"。
//
// ★★ 纪律（别取并集！）：**基础集 = 无争议项**；**语言/用途专属项必须由调用方显式追加**。
//   直接取并集会**悄悄扩大**某些工具的跳过面（例如给一个项目的 `bin/` 里放真源码的仓
//   跳掉 CLI 入口），那是"顺手修正语义"，违反 §2c。
// ─────────────────────────────────────────────────────────────

/** 无争议的目录跳过集：依赖目录 / VCS / 构建产物 / 缓存 / 本工具自己的数据目录 */
export const SKIP_DIR_BASE: ReadonlySet<string> = new Set<string>([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'output', 'coverage',
  '.next', '.nuxt', '.cache', '.output',
  '__pycache__', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.tox',
]);

/** 这条目录名该跳过吗？`extra` = 调用方**显式**追加的（语言/用途专属，如 Java 的 `target`、C# 的 `bin`/`obj`） */
export function shouldSkipDir(name: string, extra?: ReadonlySet<string> | readonly string[]): boolean {
  if (name.startsWith('.')) return true; // 隐藏目录（含 `.git` / 本工具数据目录）
  if (SKIP_DIR_BASE.has(name)) return true;
  if (!extra) return false;
  return extra instanceof Set ? extra.has(name) : (extra as readonly string[]).includes(name);
}

/** 相对路径里**任意一段**目录该跳过吗（用于把"索引器本来就不会收的文件"从缺陷里分出来） */
export function isUnderSkippedDir(relPath: string, extra?: ReadonlySet<string> | readonly string[]): boolean {
  const segs = relPath.split('/');
  for (let i = 0; i < segs.length - 1; i += 1) if (shouldSkipDir(segs[i], extra)) return true;
  return false;
}

/**
 * **索引器**（`import_project`）显式追加的跳过目录 —— 放在内核是为了让**量具**
 * （`index_integrity`）能按**同一政策**分类"哪些文件本来就不会被收"，
 * 从而把「本体缺口（真缺陷）」与「根本不该算源码（可解释）」分开。
 * ★ 它是**索引器的政策**、不是通用基础集（别拿去给别的消费者用）。
 */
export const INDEX_SKIP_DIR_EXTRA: ReadonlySet<string> = new Set([
  'vendor', 'target', 'bin', 'obj', '.idea', '.vscode', '.backup', 'scaffold', 'egg-info',
]);

/**
 * 造一个"同源跳过集"：**真 `Set` 子类**，但 `has()` 走 `shouldSkipDir`。
 * 为什么是子类而不是普通对象：调用方常把它当 `Set` 传递/迭代（如 `collectJavaFiles(proj, skipDirs)`），
 *   普通 `{has(){}}` 会在 `instanceof Set` / 迭代处炸；子类两样都保住。
 * ⇒ 迁移后各站点的"追加项"变成**显式参数**，基础集由内核唯一提供（本文件头注解释的那条纪律）。
 */
class SkipDirSetImpl extends Set<string> {
  private readonly extra?: readonly string[];
  constructor(extra?: readonly string[]) { super(); this.extra = extra; }
  override has(name: string): boolean { return shouldSkipDir(name, this.extra); }
}

/** 造一个同源跳过集；`extra` = 本调用方**显式**追加的语言/用途专属目录名 */
export function skipDirSet(extra?: readonly string[]): Set<string> {
  return new SkipDirSetImpl(extra);
}
