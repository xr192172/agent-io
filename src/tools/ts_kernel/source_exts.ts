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
 *   **不属于本模块**（问题不同，继续各留在调用点，但已在 `tests/single_source_registry.json` 登记）：
 *     · `rename_symbols` 的文本扫描清单（含 `.json/.md/.yml/.html/.css` —— 那些是**可读文本**，不是源码）
 *     · `import_resolve.IMPORT_EXTS`（**可被 import 指向**的东西，含 `.json` 场景是合法的）
 */

/** TS/JS 家族：同一套 tree-sitter AST、同一套 ESM/CJS 语义。顺序即解析优先级（`.ts` 优先于编译产物 `.js`）。 */
export const TS_JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

/** TS/JS 之外、内核可解析的源码扩展名（本项目按需启用；不含 `.json` 等数据文件）。 */
export const OTHER_LANG_EXTS = ['.go', '.py', '.java', '.cs', '.c', '.h', '.rs', '.php', '.vue'] as const;

/**
 * 项目内"可被扫描/分析"的源码扩展名（多语言并集）。
 *
 * ★ 这是**超集**：原先 6 份互不一致的清单全部是它的真子集 ⇒ 迁移到它**只增不减**，
 *   不存在"某个工具反而看不到原本能看到的文件"的情况（方向单调安全）。
 */
export const SOURCE_EXTS: readonly string[] = [...TS_JS_EXTS, ...OTHER_LANG_EXTS];

/**
 * 转译后能交给 `node` 子进程执行的扩展名（`behavior/` 的 harness 用）。
 *
 * ★ 从 `TS_JS_EXTS` **派生**而非另抄一份：`.mts`/`.cts` 在 node 子进程场景下未经验证，
 *   故显式排除 —— 但"排除哪两个"这件事写在这里，不散在调用点。
 */
export const NODE_RUNNABLE_EXTS: readonly string[] = TS_JS_EXTS.filter((e) => e !== '.mts' && e !== '.cts');

const TS_JS_SET = new Set<string>(TS_JS_EXTS);
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

/** 噪音/产物：编辑器临时件 + 压缩/生成/声明产物（`.min.js` `.d.ts` `*.gen.ts` …） */
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
