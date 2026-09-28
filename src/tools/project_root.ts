/**
 * project_root —— 自动定位项目根 + 动态闭包边界（消除"必须显式传 project_dir"的使用摩擦）
 *
 * 背景（工具被主动使用的障碍 #1/#2，见 docs/tool-convergence.md 5.6 节）：
 *   rename_symbol 等工具要求调用方显式传 project_dir，LLM 得先自己知道项目根——
 *   这是"不会想起来用"的第一根因。本项目内自己就是嵌套 git 实例：
 *   agent-io-main（外壳非 git）内含 agent-io/、dsl-workbench/ 两个独立 git 仓库。
 *
 * 本模块提供两级能力：
 *   1. resolveProjectRoot(file)：从文件自动定位初始项目根
 *        a. 向上找 `.git`（目录或文件）→ 最近仓库根（**文件系统走查，微秒级**；见 gitRootOf 注释）
 *        b. 走查落空才 `git rev-parse --show-toplevel`（每目录记忆化）
 *        c. 否则向上找最近 manifest（package.json/go.mod/pyproject.toml）→ 其目录
 *        d. 都没有 → 文件所在目录
 *   2. expandClosure(seedFile, root)：沿 import 边做动态闭包边界
 *        - 初始 = 项目根内全部本地源文件（覆盖"谁引用 seed"的 importer 方向）
 *        - 对每个文件解析 import；相对导入（./ ../）若真实解析到边界外本地文件 → 扩入
 *          （覆盖"seed 依赖外层文件"的 importee 方向；解决跨 git 根引用漏改）
 *        - 排除 node_modules / dist / 隐目录 / 三方裸包（相对导入才解析到本地文件）
 *        - 结果 = 自包含的本地文件闭包
 *
 * 独立性：现场解析（不依赖 import_project 建的 cache.db），零前置状态。
 */

import { DATA_DIR_NAME } from '../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { analyzeModuleSource } from './rename_symbol.js';
import { parseFileFull, isSupported, isTsJsExt, resolveExistingPath, SOURCE_EXTS, TS_JS_EXTS, type ParsedImport } from './ts_kernel/index.js';
import { readGoModules, type GoModule } from './import_project.js';
import { gitAvailable } from './exec_guard.js';
import { getProjectCacheDb, closeProjectCacheDb, type Database } from '../db/db.js';
import { skipDirSet } from './ts_kernel/source_exts.js';
import {
  toRelPath,
  hasAnyIndexedFiles,
  isFileIndexed,
  getResolvedImportSources,
  getRawImportsOfFile,
  findFilesImportingAnySource,
} from '../db/symbols.js';

/** 本地源扩展名（闭包只收这些）—— ★ 来自内核唯一权威 `SOURCE_EXTS`（`ts_kernel/source_exts.ts`）。
 *  此前就地手写并与 rename_symbol/rename_file 的清单"对齐"——靠人记得对齐 ⇒ 已在 G4 登记表登记收敛。 */
const SRC_EXTS = new Set<string>(SOURCE_EXTS);

/** 跳过的目录名（闭包扫描绝不进入） */
// ★ 迁到内核同源跳过集（2026-09-28）：基础集由 `source_exts.SKIP_DIR_BASE` 唯一提供
//   ⇒ 本行的数组是**本调用方显式追加**的语言/用途专属项（有意变宽的部分已在提交里声明）
const SKIP_DIRS = skipDirSet(['vendor', 'target']);

/** 项目根标志文件（manifest，git 之外的项目边界判据） */
const MANIFESTS = ['package.json', 'go.mod', 'pyproject.toml', 'Cargo.toml', 'pom.xml', 'composer.json', 'pubspec.yaml', 'build.gradle'];

/** 邻域项目样兄弟数量上限：超过即判定为 temp/缓存容器（非工作区），短路不扫 */
const NEIGHBOR_LIMIT = 20;

/**
 * 邻域 importer 扫描时间预算（毫秒）：跨 git 根引用是极少数场景，而"每个兄弟仓库
 * 的每个源码文件做一次 AST 解析"在塞满众多仓库的工作区（如 D:\project_develop 下
 * 数十个仓库）里会随 safe_rename 每次调用被反复执行 → 卡死 + 内存持续增长（曾实测
 * 单进程升至 10GB）。给扫描设硬 deadline，超时即停止并返回已收集的引用者——
 * 宁可漏掉跨根引用，也绝不允许一次 rename 把整个工作区解析常驻内存。
 */
const EXTERNAL_IMPORTER_DEADLINE_MS = 2500;

function isSkippedDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

/** 闭包边界外的一次 import 依赖记录（"此文件引用了项目外的哪个目标"——只反馈，绝不追进去改） */
export interface ExternalRef {
  /** 引用方文件（绝对路径，位于 root 内） */
  fromAbs: string;
  /** import source 字符串（相对/别名/包路径）；无法取得时为空串 */
  source: string;
  /** 解析到 root 外的目标文件绝对路径 */
  resolved: string;
}

/** findExternalImporters 的返回：成功找到的引用文件 + 跳过项（可读的失败计数） */
export interface ExternalImporterResult {
  files: string[];
  skipped: Array<{ dir: string; why: string }>;
}

/** expandClosureDetailed 的返回：闭包文件 + 外部边界引用 + 解析失败的跳过项 */
export interface ExpansionResult {
  files: string[];
  externalRefs: ExternalRef[];
  skipped: Array<{ path: string; why: string }>;
}

/** detectReachableRoots 的返回：可达根 + 跳过的候选（相对路径计算失败时记录原因） */
export interface RootsResult {
  roots: string[];
  skipped: Array<{ path: string; why: string }>;
}

/** 判断绝对路径是否落在 root（或其子目录）内——闭包只扩根内，越界即视为外部边界 */
export function isInsideRoot(abs: string, root: string): boolean {
  const rp = path.relative(path.resolve(root), path.resolve(abs));
  return rp === '' || (!rp.startsWith('..') && !path.isAbsolute(rp));
}

/**
 * 从 file 向上找 git 根（嵌套 git 天然返回最近仓库根）。返回绝对路径或 null。
 *
 * ★ 性能修正（2026-09-15，实测根因）：
 *   原实现**每次都** `execSync('git rev-parse --show-toplevel')`。在 `git` 不在 PATH 的环境里
 *   （测试进程、精简容器、被清过 PATH 的 shell），这行会在 Windows 上白等 **约 5.1 秒**
 *   （cmd 启动 + "不是内部或外部命令" 的错误路径），而不是"快失败"。
 *   实测：`resolveProjectRoot(cwd)` = **5112ms**，而它下游的
 *   `find_references` / `move_symbol` / `harvest_decisions` 因此各花 ~5.2s ——
 *   `tests/server_registry.stale_build.test.ts` 的 5s 超时就是这么被吃掉的（不是断言错）。
 *
 *   修法（顺序有讲究）：
 *     ① **先向上找 `.git`**（目录或文件都算 —— 文件形态是 worktree/submodule）：
 *        O(深度) 次 `existsSync`，微秒级，覆盖绝大多数真实检出。语义与 git 一致：取**最近**那层。
 *     ② 找不到才 spawn `git`（例如 `GIT_DIR` 环境变量指定的非标准布局、bare 仓库），
 *        并且**按起点目录记忆化**（连"不是仓库"的结论也缓存）⇒ 每进程每个目录最多付一次。
 */
const gitRootCache = new Map<string, string | null>();

/** 向上找 .git（目录或文件）。返回含 .git 的目录绝对路径，或 null。 */
function gitRootByFsWalk(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function gitRootOf(file: string): string | null {
  let dir = path.resolve(file);
  if (!fs.existsSync(dir)) dir = path.dirname(dir);
  else if (fs.statSync(dir).isFile()) dir = path.dirname(dir);

  const cached = gitRootCache.get(dir);
  if (cached !== undefined) return cached;

  // ① 文件系统走查（快路径）
  const byWalk = gitRootByFsWalk(dir);
  if (byWalk) {
    gitRootCache.set(dir, byWalk);
    return byWalk;
  }

  // ② 走查没命中才 spawn git（慢路径；失败也缓存，绝不每调用一次付一次代价）
  //    ★ 先过 exec_guard：环境里没有 git 时，spawn 要白等约 5.1 秒（见 exec_guard 注释）
  let out: string | null = null;
  if (!gitAvailable()) {
    out = null;
  } else {
    try {
      const raw = execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 });
      const root = raw.trim();
      out = root ? path.resolve(root) : null;
    } catch {
      out = null; // 非 git 仓库
    }
  }
  gitRootCache.set(dir, out);
  return out;
}

/** 测试隔离用：清掉 git 根解析缓存 */
export function clearGitRootCache(): void {
  gitRootCache.clear();
}

/**
 * 从 file 向上找最近的 manifest 目录（非 git 项目的边界判据）。
 * 返回 manifest 所在目录的绝对路径，或 null。
 */
export function manifestRootOf(file: string): string | null {
  let dir = path.resolve(file);
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  for (;;) {
    for (const m of MANIFESTS) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 自动定位项目根：git 根优先（嵌套安全），否则最近 manifest，否则文件所在目录。
 */
export function resolveProjectRoot(file: string): string {
  const git = gitRootOf(file);
  if (git) return git;
  const manifest = manifestRootOf(file);
  if (manifest) return manifest;
  const p = path.resolve(file);
  return fs.existsSync(p) && !fs.statSync(p).isFile() ? p : path.dirname(p);
}

/** 递归收集目录内全部本地源文件（跳过噪音目录） */
export function walkProjectFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (isSkippedDir(e.name)) continue;
      walkProjectFiles(p, out);
    } else if (e.isFile() && SRC_EXTS.has(path.extname(e.name))) {
      out.push(p);
    }
  }
}

/**
 * 多语言"补全候选"的政策参数（**政策留在这里，候选生成与剥扩展名重试走内核唯一实现**）。
 * `resolveToFile` 的旧实现自带的候选循环**漏了"剥扩展名重试"** —— 见该函数注释。
 */
const MULTILANG_EXTS = SOURCE_EXTS;
const MULTILANG_INDEX = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'mod.ts', 'mod.go', '__init__.py'] as const;

/** 绝对路径上的"是普通文件"谓词（不抛） */
function absIsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * 把绝对路径 base 补成真实文件：直接命中 / 补扩展名 / 剥扩展名重试 / 目录索引（多语言一并）。
 *
 * ★ 2026-09-28：候选生成改走内核唯一实现 `resolveExistingPath`（`ts_kernel/import_resolve.ts`）。
 *   本函数原先自带一份候选循环，**漏了"剥扩展名重试"**那一步（旧守卫 `if (!path.extname(p))`
 *   使 `./x.js` 直接跳过补全）⇒ 在本仓（961/971 条相对 import 带 `.js`）**基本解析不动**。
 *   它不是死代码：`realResolveImport` 是 `resolveLangImport` 对**所有相对 import** 的统一出口，
 *   也是 `expandClosure` 无索引回退路径的底座 ⇒ 盲区会让闭包漏文件
 *   （`rename_symbol` / `find_references` / `symbol_move` 在无索引或跨根场景下可能漏改）。
 *   ★ 与内核那三处（db/health/impact）是**同一族**：都在回答"specifier → 项目内哪个文件"。
 *   同族副本的登记与棘轮见 `tests/single_source.test.ts`。
 */
export function resolveToFile(p: string): string | null {
  // 用 posix 形态做候选计算（统一分隔符），命中后再换回本机分隔符 —— 调用方按原样字符串比较路径
  const forward = p.replace(/\\/g, '/');
  const hit = resolveExistingPath(forward, (c) => absIsFile(c.split('/').join(path.sep)), {
    exts: MULTILANG_EXTS,
    indexFiles: MULTILANG_INDEX,
    bareBaseFirst: true, // 已拼好的路径：原样命中必须排第一
  });
  return hit ? hit.split('/').join(path.sep) : null;
}

/**
 * 真实解析相对 import 到磁盘文件（不依赖任何预建索引表）。
 * 处理：扩展名补全（./x → x.ts/tsx/js/...）、**剥扩展名重试**（./x.js → x.ts，NodeNext ESM）、
 *       目录索引（./dir → dir/index.ts）。
 * 只解析相对导入（./ ../）；裸包名 / 绝对路径 / 外部 → 返回 null（不属本地闭包）。
 *
 * ★ 2026-09-28 修复：此前"剥扩展名重试"这一步**没有**（旧守卫 `if (!path.extname(p))` 使
 *   `./x.js` 直接跳过补全）⇒ 本仓 961/971 条相对 import 带 `.js` 时它基本解析不动。
 *   调用面：`resolveLangImport`（所有语言的相对导入统一走这条）与 `expandClosure` 的无索引回退。
 */
export function realResolveImport(importerAbs: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  return resolveToFile(path.resolve(path.dirname(importerAbs), source));
}

// ─────────────────────────────────────────────
// 可达性根（P0-②）：被外界按路径调起的入口文件
// ─────────────────────────────────────────────

/** 被调起的「产物路径」→ 候选源码相对路径（剥 dist/ 前缀、JS 家族后缀互换） */
function sourceCandidatesOfReferencedPath(p: string): string[] {
  const norm = p.replace(/\\/g, '/').replace(/^\.?\//, '');
  const bases = [norm];
  // 本仓约定：`tsconfig` 是 rootDir='.' + outDir='./dist' + include=['src/**/*']，
  // 故产物是 `dist/src/...` 而源码是 `src/...` ⇒ 正确映射是**剥掉 `dist/` 前缀**，
  // 不是把 `dist` 换成 `src`（那会得到 `src/src/...`）。实测踩过这个坑。
  if (norm.startsWith('dist/')) bases.push(norm.slice('dist/'.length));
  const out: string[] = [];
  for (const b of bases) {
    out.push(b);
    const ext = path.posix.extname(b);
    if (['.js', '.mjs', '.cjs', '.jsx'].includes(ext)) {
      const bare = b.slice(0, -ext.length);
      for (const e of ['.ts', '.tsx']) out.push(bare + e);
    }
  }
  return out;
}

/**
 * 探测「可达性根」——被外界按路径调起的入口文件（P0-②，2026-09-28）
 *
 * **为什么需要它**：入口文件**天然没有项目内消费者**（它就是被 package.json / bin / 外界调起的）。
 * 量具不知道这件事，就会把入口当普通模块，报出两类假阳：
 *   · `orphan_file` —— "整文件无项目内消费者（可能是待清理的 dead code）"
 *   · `layer_violation` —— 入口 import 自己的 server 模块，被判成"积木依赖胶水"
 * 实测本仓 2 条：`daemon/daemon.ts`（`npm run daemon`）、`tools/serve.ts`（`npm run serve`）。
 *
 * **判据只认可信的声明，不做启发式猜测**（宁可少报，不可把"什么都算根"）：
 *   1. `package.json` 的 `bin` 全部取值（字符串或对象）
 *   2. `package.json` 的 `main`（若声明）
 *   3. `package.json` 的 `scripts.*` 里 **`node <路径>`** 形式调起的脚本。
 *      只认这一种写法：`tsc` / `vite` / 自定义 bin 调的不是"项目内入口文件"，
 *      据此声明可达根会把根集合污染成"什么都算根"，量具就再也抓不到孤儿了。
 *
 * **路径映射**：scripts 写的是产物路径（`dist/src/daemon/daemon.js`），源码在 `src/`。
 *   故对每个候选尝试 `dist/ → src/` 替换 + JS 家族后缀换 `.ts/.tsx`，
 *   并以 `fs.existsSync` **落盘确认** —— 只把真实存在的文件当根，猜错不报。
 *
 * **返回值相对谁**：相对**调用方传入的 root**。manifest 允许在 root 的祖先目录
 *   （典型：分析 `src/`，而 `package.json` 在项目根），此时会向上找到 manifest 再 rebase 回来；
 *   落在 root 之外的入口（如 `scripts/*.mjs`）会被丢弃 —— 它们不在本次分析范围内。
 *
 * @returns 项目内相对路径（posix）去重排序；无 manifest / 无入口 → 空数组
 */
export function detectReachableRoots(root: string): RootsResult {
  const absRoot = path.resolve(root);
  let dir = absRoot;
  let pkgAbs: string | null = null;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'package.json');
    if (fs.existsSync(cand)) {
      pkgAbs = cand;
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!pkgAbs) return { roots: [], skipped: [] };
  const pkgDir = path.dirname(pkgAbs);

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgAbs, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    // §2d：malformed package.json 是配置硬错误，不再静默返回空数组
    throw new Error(`failed to parse ${pkgAbs}: ${String(err)}`);
  }

  const referenced: string[] = [];
  const bin = pkg.bin;
  if (typeof bin === 'string') referenced.push(bin);
  else if (bin && typeof bin === 'object') {
    for (const v of Object.values(bin as Record<string, unknown>)) if (typeof v === 'string') referenced.push(v);
  }
  if (typeof pkg.main === 'string') referenced.push(pkg.main);
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === 'object') {
    // `node --experimental-foo dist/x.js` 里的开关不能被当成路径，故用 `(?!-)` 排除
    const nodeScriptRe = /(?:^|[&|;]\s*)node\s+(?!-)(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/g;
    for (const v of Object.values(scripts as Record<string, unknown>)) {
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(nodeScriptRe)) {
        const p = m[1] ?? m[2] ?? m[3];
        if (p) referenced.push(p);
      }
    }
  }

  const roots = new Set<string>();
  const skipped: RootsResult['skipped'] = [];
  for (const ref of referenced) {
    for (const cand of sourceCandidatesOfReferencedPath(ref)) {
      const abs = path.join(pkgDir, cand);
      let rel: string;
      try {
        rel = path.relative(absRoot, abs).replace(/\\/g, '/');
      } catch (err) {
        // §2d：path.relative 失败记 skipped 并带 why（原来静默 continue）
        skipped.push({ path: cand, why: String(err) });
        continue;
      }
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // 分析范围之外
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) roots.add(rel);
    }
  }
  return { roots: [...roots].sort(), skipped };
}

// ─────────────────────────────────────────────
// 跨语言 import 边（Go / Python）：让闭包沿非 TS 文件的 import 边扩展
// ─────────────────────────────────────────────

/**
 * 多语言 resolution 上下文（各语言 resolver 内部可能需要）
 */
export interface LangResolveCtx {
  /** 工程根（定位 Go 包目录 / Python 同包用） */
  root: string;
  /** Go module 列表（只 Go 用；已按 module 长度降序） */
  goModules: GoModule[];
  /** seed 所在项目名（裸包 workspace 互引用；可为 undefined） */
  seedPkgName?: string;
}

/**
 * 跨语言 import → 本地文件。
 *
 * 扩展点：本函数按文件扩展名分派到 `LANG_RESOLVERS[lang]`；未注册的语言走
 * `resolveGenericLangImport` 通用兜底（把 import 字符串按分隔符转路径，从 importer
 * 目录/工程根逐级落盘）。AST import 提取由 ts_kernel.parseFileFull 通用完成——
 * LANGUAGES 注册表已覆盖 150+ 语言，故【加一个新语言 = 给 LANG_RESOLVERS 加一条
 * 扩展名→resolver 映射】，AST 层零改动。
 */
export function resolveLangImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const ext = path.extname(absFile);
  const resolver = LANG_RESOLVERS[ext];
  if (resolver) return resolver(absFile, imp, ctx);
  return resolveGenericLangImport(absFile, imp);
}

/** 相对（./ ../ 或 Python 前导点）→ realResolveImport——所有语言统一 */
function resolveRelative(absFile: string, imp: ParsedImport): string | null {
  if (imp.kind === 'relative') return realResolveImport(absFile, imp.source);
  return null;
}

/** Go：Go 包路径按 go.mod module 前缀剥离 → 落到 go.mod 所在目录 */
function resolveGoImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  for (const gm of ctx.goModules) {
    if (imp.source === gm.module || imp.source.startsWith(gm.module + '/')) {
      const rest = imp.source.slice(gm.module.length).replace(/^\//, '');
      return resolveToFile(path.resolve(ctx.root, gm.dir || '.', rest)) ?? null;
    }
  }
  return null;
}

/** Python：点分模块/单段包 → importer 目录 → 工程根逐级试 */
function resolvePythonImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  const asPath = imp.source.split('.').join('/');
  for (const base of [path.dirname(absFile), ctx.root]) {
    const hit = resolveToFile(path.resolve(base, asPath));
    if (hit) return hit;
  }
  return null;
}

/** C/C++：`#include "sub/foo.h"` / `#include <core/foo.h>` → 剥尖括号/引号，importer 目录 → 工程根逐级试 */
function resolveClangImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  const raw = imp.source.trim().replace(/^[<"]/, '').replace(/[>"]$/, '');
  if (!raw) return null;
  for (const base of [path.dirname(absFile), ctx.root]) {
    const hit = resolveToFile(path.resolve(base, raw));
    if (hit) return hit;
  }
  return null;
}

/** 通用兜底：把 import 字符串按 `::`/`.`/`/` 分隔符归一化为路径，从 importer 目录/工程根逐级落盘 */
function resolveGenericLangImport(absFile: string, imp: ParsedImport): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  const asPath = imp.source.replace(/::/g, '/').replace(/\./g, '/');
  for (const base of [path.dirname(absFile), path.resolve(absFile, '../..')]) {
    const hit = resolveToFile(path.resolve(base, asPath));
    if (hit) return hit;
  }
  // 末段可能是符号名（如 Java 'com.x.Bar' 的 Bar 是类名，文件在 com/x/）→ 退目录一级
  const dirAsPath = asPath.replace(/\/[^/]+$/, '');
  for (const base of [path.dirname(absFile), path.resolve(absFile, '../..')]) {
    const hit = resolveToFile(path.resolve(base, dirAsPath));
    if (hit) return hit;
  }
  return null;
}

/** 各语言 resolver 注册表：加语言 = 加一条 [ext] → resolver */
const LANG_RESOLVERS: Record<string, (absFile: string, imp: ParsedImport, ctx: LangResolveCtx) => string | null> = {
  '.go': resolveGoImport,
  '.py': resolvePythonImport,
  '.java': resolveJavaImport,
  '.rs': resolveRustImport,
  '.cs': resolveCsImport,
  '.php': resolvePhpImport,
  '.c': resolveClangImport,
  '.h': resolveClangImport,
  // 其它语言不注册 → 走 resolveGenericLangImport 通用兜底
};

/** Rust：use 路径 → src 下 .rs / mod.rs（crate:: 相对 project root src） */
function resolveRustImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  if (!imp.source) return null;
  const src = imp.source.split('::')[0];
  // 外部标准库/第三方 crate（非本地模块）→ 不解析到本地
  if (['std', 'core', 'alloc', 'allocator'].includes(src)) return null;
  const p = imp.source.replace(/::/g, '/');
  for (const base of [path.join(ctx.root, 'src'), path.dirname(absFile), ctx.root]) {
    const hit = resolveToFile(path.join(base, p)) || resolveToFile(path.join(base, p, 'mod.rs')) || resolveToFile(path.join(base, p + '.rs'));
    if (hit) return hit;
  }
  return null;
}

/** Java：全限定包路径 → 常见 src 根下 .java（标准 Maven/Gradle 布局 + root 兜底） */
function resolveJavaImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  if (!imp.source) return null;
  const relPath = imp.source.replace(/\./g, '/'); // com.foo.Bar → com/foo/Bar
  for (const base of [
    path.join(ctx.root, 'src/main/java'),
    path.join(ctx.root, 'src/main'),
    path.join(ctx.root, 'src'),
    path.join(ctx.root, 'java'),
    ctx.root,
  ]) {
    // 末段可能是类名（import com.foo.Bar → 文件 com/foo/Bar.java）；也可能含类名需退一级不适用（包导入）
    const hit = resolveToFile(path.join(base, relPath + '.java')) || resolveToFile(path.resolve(base, relPath));
    if (hit) return hit;
  }
  return null;
}

/** C#：点分命名空间 → 常见 src 根下 .cs（标准 .NET 布局 + root 兜底） */
function resolveCsImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  if (!imp.source) return null;
  // 跳过 BCL/框架命名空间（System.*）：纯框架类型不落到本地项目文件
  if (/^System(\.|$)/.test(imp.source)) return null;
  const relPath = imp.source.replace(/\./g, '/'); // MyApp.Utils.Helper → MyApp/Utils/Helper
  for (const base of [
    path.join(ctx.root, 'src'),
    path.join(ctx.root, 'csharp'),
    ctx.root,
  ]) {
    const hit = resolveToFile(path.join(base, relPath + '.cs')) || resolveToFile(path.resolve(base, relPath));
    if (hit) return hit;
  }
  return null;
}

/** PHP：反斜杠命名空间 → src 根下 .php（PSR-4 composer src + root 兜底） */
function resolvePhpImport(absFile: string, imp: ParsedImport, ctx: LangResolveCtx): string | null {
  const rel = resolveRelative(absFile, imp);
  if (rel) return rel;
  if (!imp.source) return null;
  const relPath = imp.source.replace(/\\/g, '/').replace(/^\/+/, ''); // Foo\Bar → Foo/Bar
  for (const base of [
    path.join(ctx.root, 'src'),
    path.join(ctx.root, 'app'),
    ctx.root,
  ]) {
    const hit = resolveToFile(path.join(base, relPath + '.php')) || resolveToFile(path.resolve(base, relPath));
    if (hit) return hit;
  }
  return null;
}

// ─────────────────────────────────────────────
// tsconfig 路径别名（@/ 等）：真实项目几乎必用，别名导入若解析不到 → 漏改
// ─────────────────────────────────────────────

/** 解析后的别名配置：baseUrl（绝对）+ paths 前缀映射（最长前缀优先） */
export interface AliasConfig {
  /** baseUrl 绝对路径（无显式时=tsconfig 所在目录） */
  baseUrl: string;
  /** paths 展开：prefix（如 '@/'）→ 目标模板数组（相对 baseUrl；含 '*' 通配） */
  paths: Array<{ prefix: string; targets: string[] }>;
}

/**
 * 从 root 向上找最近的 tsconfig.json / jsconfig.json（jsconfig 兜底）。
 * 向上搜索覆盖 monorepo：paths 常定义在仓库根 tsconfig，包内文件在子目录。
 */
function findConfigFile(root: string): string | null {
  let dir = path.resolve(root);
  for (;;) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * 读取并合并 tsconfig compilerOptions（支持一级 extends；子配置覆盖父）。
 * 无 tsconfig / 无 baseUrl+paths → 返回 null。
 */
export function loadAliasConfig(root: string): AliasConfig | null {
  const cfgFile = findConfigFile(root);
  if (!cfgFile) return null;
  const cfgDir = path.dirname(cfgFile);
  let cfg: any = null;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
  } catch {
    return null;
  }
  // 一级 extends：父配置提供默认，子配置覆盖
  if (cfg && typeof cfg.extends === 'string') {
    try {
      const parent = JSON.parse(fs.readFileSync(path.resolve(cfgDir, cfg.extends), 'utf-8'));
      cfg = { ...parent, ...cfg, compilerOptions: { ...parent?.compilerOptions, ...cfg?.compilerOptions } };
    } catch {
      /* extends 解析失败不影响自身配置 */
    }
  }
  const opts = cfg?.compilerOptions;
  if (!opts) return null;
  const baseUrl = opts.baseUrl ? path.resolve(cfgDir, opts.baseUrl) : cfgDir;
  const paths = opts.paths && typeof opts.paths === 'object' ? opts.paths : {};
  const list: AliasConfig['paths'] = Object.entries(paths)
    .map(([prefix, targets]) => ({ prefix, targets: Array.isArray(targets) ? targets.map(String) : [] }))
    .filter((p) => p.targets.length > 0)
    .sort((a, b) => b.prefix.length - a.prefix.length); // 最长前缀优先（TS 语义）
  const hasPaths = list.length > 0;
  const hasBaseUrl = typeof opts.baseUrl === 'string';
  if (!hasPaths && !hasBaseUrl) return null;
  return { baseUrl, paths: list };
}

/**
 * 非相对导入 → 本地文件：paths 前缀（key 中 '*' 是通配，拆出头部做前缀匹配）→ baseUrl 直连。
 * 解析不到本地文件（如裸包 node_modules）→ null（不属本地闭包）。
 */
export function resolveAliasedImport(source: string, alias: AliasConfig): string | null {
  // 1) paths 前缀
  for (const { prefix, targets } of alias.paths) {
    const starIdx = prefix.indexOf('*');
    let rest: string | null = null;
    if (starIdx === -1) {
      // 精确 key：必须全等
      if (source === prefix) rest = '';
    } else {
      // 通配 key：'@/*' → 头 '@/'；source 以头开头、以尾结尾（尾通常为空）
      const head = prefix.slice(0, starIdx);
      const tail = prefix.slice(starIdx + 1);
      if (source.startsWith(head) && source.endsWith(tail) && source.length >= head.length + tail.length) {
        rest = source.slice(head.length, source.length - tail.length);
      }
    }
    if (rest === null) continue;
    for (const t of targets) {
      const mapped = t.includes('*') ? t.replace('*', rest) : t;
      const hit = resolveToFile(path.resolve(alias.baseUrl, mapped));
      if (hit) return hit;
    }
  }
  // 2) baseUrl 直连（如 'shared/util' 未配 paths，但 baseUrl 下恰好有该文件）
  return resolveToFile(path.resolve(alias.baseUrl, source));
}

/** 判断绝对路径是否属于本地源码（非 node_modules/隐目录/三方），供闭包纳入判定 */
export function isLocalSource(abs: string): boolean {
  const parts = abs.split(/[\\/]/);
  return !parts.some((s) => isSkippedDir(s));
}

// ─────────────────────────────────────────────
// importer 邻域扫描：根外文件引用 seed（Git 嵌套 / 兄弟仓库互引）
// ─────────────────────────────────────────────

/** 目录是否"项目样"（有 .git 或 manifest）——邻域扫描只进入这类兄弟目录，保证有界 */
export function isProjectDir(d: string): boolean {
  return fs.existsSync(path.join(d, '.git')) || MANIFESTS.some((m) => fs.existsSync(path.join(d, m)));
}

/**
 * 文件是否通过 import 真实引用 targetAbs（TS 系才解析）。
 *  - 相对导入（./ ../）→ realResolveImport
 *  - 别名导入（@/ 等）→ resolveAliasedImport（用本文件所属项目的 tsconfig，aliasCfg 传近）
 *  - 裸包导入（非相对、非别名）→ 若匹配 seed 所在项目包名（workspace 互引）则命中
 */
async function importsTargetFile(fileAbs: string, targetAbs: string, aliasCfg?: AliasConfig | null, seedPkgName?: string): Promise<boolean> {
  const ext = path.extname(fileAbs);
  if (!isTsJsExt(ext)) return false;
  let mod: Awaited<ReturnType<typeof analyzeModuleSource>> | null = null;
  try {
    mod = await analyzeModuleSource(fs.readFileSync(fileAbs, 'utf-8'), fileAbs);
  } catch {
    return false;
  }
  if (!mod) return false;
  for (const e of mod.imports) {
    if (!e.source) continue;
    let real: string | null = null;
    if (e.source.startsWith('.')) {
      real = realResolveImport(fileAbs, e.source);
    } else if (aliasCfg) {
      real = resolveAliasedImport(e.source, aliasCfg);
    } else if (seedPkgName && e.source === seedPkgName) {
      // 裸包 workspace 互引：import 了 seed 所在包（如 monorepo 内 B 引 A 包名）→ 命中
      return true;
    }
    if (real && path.resolve(real) === targetAbs) return true;
  }
  return false;
}

/**
 * 读项目根 package.json 的 name（裸包 workspace 互引匹配用）；无则 undefined。
 * ★ 2026-09-29：去掉静默兜底——malformed package.json 不再是"无 name"，而是明确报错（§2d）。
 *   原先 catch { return undefined } 把"读不了"与"没有 name"混成同一态，现在分开：
 *   文件不存在 / name 未声明 → undefined（正常）；文件存在但 JSON 坏 → throw（硬失败）。
 */
export function readPackageName(root: string): string | undefined {
  const p = path.join(root, 'package.json');
  if (!fs.existsSync(p)) return undefined;
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return typeof j.name === 'string' && j.name ? j.name : undefined;
}

/**
 * importer 邻域有界扫描：找到「根外、但引用了 seedFile」的本地文件。
 *
 * 只扫 **seed 根的直属兄弟目录**（root 的父目录里的项目样邻居 + 该层松散源文件），
 * 不向更上层上爬 —— 避免从 Temp/build 等深层路径一路扫进整个文件树里的项目。
 * 邻域语义 = "同 monorepo 根 / 同工作区下的平铺兄弟仓库"，本就是 root 直属层。
 *
 * 每进入一个项目样兄弟目录，按其自身 tsconfig 解析该目录内文件的别名导入
 * （@shared/ 等映射到 seed 项目的别名也能命中）；松散文件用 seed 根的别名兜底。
 * 裸包导入（npm 包 #/ workspace）不在本版，见 docs 边界。
 *
 * 防御：先数项目样兄弟数量，若远超工作区规模（> NEIGHBOR_LIMIT）→ 判定为 temp/缓存
 * 容器（历史测试残留），直接短路返回 —— 防止对上千个噪声目录逐个全量扫描。
 *
 *  - 只处理根的直接父目录一层：进入其中"项目样"兄弟（.git/manifest）+ 该层松散源文件
 *  - 排除 root 自身子树 / 噪音目录 / 用户主目录 / 驱动器根
 *  - 匹配：相对 import 或别名 import 真实解析到 seedFile
 * 返回被引用 seedFile 的文件绝对路径列表。
 */
export async function findExternalImporters(seedFile: string, root: string): Promise<ExternalImporterResult> {
  const seedAbs = path.resolve(seedFile);
  const rootAbs = path.resolve(root);
  const home = path.resolve(homedir());
  const siblingDir = path.dirname(rootAbs);
  if (siblingDir === path.dirname(siblingDir)) return { files: [], skipped: [] }; // root 已在驱动器（盘）根 → 无兄弟层
  let entries: fs.Dirent[];
  const skipped: ExternalImporterResult['skipped'] = [];
  try {
    entries = fs.readdirSync(siblingDir, { withFileTypes: true });
  } catch (err) {
    // readdirSync 失败：邻域目录权限不足/不存在等，记 skipped 并带 why，不抛（§2d：不是硬失败场景）
    skipped.push({ dir: siblingDir, why: String(err) });
    return { files: [], skipped };
  }
  // 防御：项目样兄弟数量异常 → 这是 temp/缓存容器，不是工作区，短路（不逐个 walk）
  let projectLike = 0;
  for (const e of entries) {
    if (!e || !e.isDirectory() || isSkippedDir(e.name)) continue;
    const p = path.join(siblingDir, e.name);
    if (p === rootAbs || rootAbs.startsWith(p + path.sep)) continue;
    if (isProjectDir(p)) projectLike++;
    if (projectLike > NEIGHBOR_LIMIT) return { files: [], skipped };
  }
  const files: string[] = [];
  // 松散文件（非项目样兄弟）用 seed 根的别名兜底
  const rootAlias = loadAliasConfig(rootAbs);
  // 裸包 workspace 互引：seed 所在项目包名（B `import {..} from 'a'`，a=A 包名 → 命中）
  const rootPkgName = readPackageName(rootAbs);
  // 时间预算：跨根扫描常超时，超 deadline 即停止（宁可漏跨根，不可卡死/爆内存）
  const deadline = Date.now() + EXTERNAL_IMPORTER_DEADLINE_MS;
  for (const e of entries) {
    if (Date.now() > deadline) break; // 预算耗尽 → 停止扫描剩余兄弟
    if (!e) continue;
    if (isSkippedDir(e.name)) continue;
    const p = path.join(siblingDir, e.name);
    if (p === rootAbs || rootAbs.startsWith(p + path.sep)) continue; // 排除 root 自身子树与其祖先
    if (e.isDirectory()) {
      if (!isProjectDir(p) || path.resolve(p) === home) continue;
      // 每个兄弟项目按其自身 tsconfig 解析（该目录内文件可能用 @xxx/* 别名引用 seed）
      const projAlias = loadAliasConfig(p);
      const projFiles: string[] = [];
      walkProjectFiles(p, projFiles);
      for (const f of projFiles) {
        if (Date.now() > deadline) break; // 单个仓库内也受同一预算约束
        const abs = path.resolve(f);
        if (abs === seedAbs || !isLocalSource(abs)) continue;
        if (await importsTargetFile(abs, seedAbs, projAlias, rootPkgName)) files.push(abs);
      }
    } else if (e.isFile() && SRC_EXTS.has(path.extname(e.name))) {
      if (Date.now() > deadline) break;
      const abs = path.resolve(p);
      if (abs === seedAbs || !isLocalSource(abs)) continue;
      if (await importsTargetFile(abs, seedAbs, rootAlias, rootPkgName)) files.push(abs);
    }
  }
  return { files, skipped };
}

// ─────────────────────────────────────────────────────────────
// expandClosure 索引快速路径（② cache.db 反查子图 + ④ 无索引回退全扫）
// ─────────────────────────────────────────────────────────────

/** TS/JS 本地源扩展名（快路径 BFS 的 import dispatch 用）—— ★ 来自内核唯一权威 */
const CLOSURE_TS_EXTS = new Set<string>(TS_JS_EXTS);

/**
 * 取同目录的兄弟索引文件 relPath（包共享可见性：Go/Python/Java 同目录文件无需
 * import 即可互相引用；TS/JS 也常用同目录相对 import，保守兜底 alias 反向查询）。
 * 返回值包含 seedRel 自身。
 */
function sameDirIndexedFiles(db: Database, seedRel: string): string[] {
  const dir = path.posix.dirname(seedRel);
  const likePrefix = dir === '.' ? '' : dir + '/';
  // 同目录：path = seedRel（自身），或 path LIKE <dir>/% 且下一段不含 '/'
  //（即一层子节点 = 同目录的其他文件）。用 posix dirname 过滤实现精确匹配。
  const rows = db
    .prepare(likePrefix ? "SELECT path FROM files WHERE path LIKE ?" : "SELECT path FROM files WHERE path NOT LIKE '%/%'")
    .all(...(likePrefix ? [likePrefix + '%'] : [])) as Array<{ path: string }>;
  const out: string[] = [];
  for (const r of rows) {
    if (path.posix.dirname(r.path) === dir) out.push(r.path);
  }
  return out;
}

/**
 * 计算「哪些 import.source 字符串会让引用者解析到本文件」。
 * 用于跨语言（Go/Python/Java）的包导入反向查询：把本文件翻译成它对外的
 * 包导入串，再用 imports 表 IN 查询反抓所有引用它的文件。
 *
 * TS 别名反向太复杂（alias paths 是多对多映射，精确反解成本高），
 * TS 反向主要靠 edges(kind='import') 入边 + 同目录兄弟兜底——本条
 * 仅覆盖 package 导入型语言。
 */
function candidatePkgImportSources(
  fAbs: string,
  relPath: string,
  ext: string,
  root: string,
  goModules: GoModule[],
): string[] {
  const dirRel = path.posix.dirname(relPath);
  switch (ext) {
    case '.go': {
      // Go：每个 go.mod {module=github.com/x/y, dir=root} → 包导入 = module + '/' + dirRel
      const out: string[] = [];
      for (const gm of goModules) {
        const base = gm.module;
        if (dirRel === '.') out.push(base);
        else out.push(base + '/' + dirRel);
        // gm.dir 非空时补带 gm.dir 前缀版本
        if (gm.dir && gm.dir !== '.') {
          if (dirRel === '.') out.push(base); // module 本身就是顶层包
          else out.push(base + '/' + dirRel);
        }
      }
      return [...new Set(out)];
    }
    case '.py': {
      // Python：点分模块路径（pkg.sub.mod）+ 同目录相对变体（.mod + 上一级..pkg.mod）
      const dottedBase = relPath.slice(0, -ext.length).split('/').join('.');
      const dottedDir = dirRel === '.' ? '' : dirRel.split('/').join('.');
      const fileStem = path.posix.basename(relPath, ext);
      const cand = new Set<string>();
      cand.add(dottedBase);                         // pkg.sub.mod
      if (fileStem !== '__init__') {
        if (dottedDir) cand.add(dottedDir);          // pkg.sub（包级 import → 目录下 __init__ 导入本模块内容）
        cand.add('.' + fileStem);                    // .mod（同目录相对）
        if (dottedDir) cand.add('..' + dottedDir.split('.').slice(-1)[0] + '.' + fileStem); // 近似上一级相对
      } else {
        cand.add(dottedDir || '.');                  // __init__ 的引用 = import 包自身
      }
      return [...cand];
    }
    case '.java': {
      // Java：全限定包路径（com.foo.Bar 类 → 文件 com/foo/Bar.java 对应 import com.foo.* / com.foo.Bar）
      const dotted = dirRel === '.' ? '' : dirRel.split('/').join('.');
      const fileStem = path.posix.basename(relPath, ext);
      if (!dotted) return [fileStem];
      return [dotted + '.' + fileStem, dotted + '.*'];
    }
    default:
      return [];
  }
}

/**
 * 对一个文件做 import 现场解析（仅当该文件不在 cache.db 索引中时触发；
 * 典型如 findExternalImporters 扫到的跨根兄弟项目文件，或 watch 新文件尚未索引）。
 * 与原 drain 的单文件解析一致，但抽成纯函数复用。
 */
async function expandOneFileOnTheFly(
  f: string,
  aliasCfg: AliasConfig | null,
  ctx: LangResolveCtx,
): Promise<string[]> {
  const ext = path.extname(f);
  const out: string[] = [];
  if (CLOSURE_TS_EXTS.has(ext)) {
    let mod: Awaited<ReturnType<typeof analyzeModuleSource>> | null = null;
    try {
      mod = await analyzeModuleSource(fs.readFileSync(f, 'utf-8'), f);
    } catch { /* ignore */ }
    if (!mod) return out;
    for (const e of mod.imports) {
      if (!e.source) continue;
      let real: string | null = null;
      if (e.source.startsWith('.')) real = realResolveImport(f, e.source);
      else if (aliasCfg) real = resolveAliasedImport(e.source, aliasCfg);
      if (real) out.push(real);
    }
  } else if (isSupported(ext)) {
    let content: string;
    try { content = fs.readFileSync(f, 'utf-8'); } catch { return out; }
    let parsed: Awaited<ReturnType<typeof parseFileFull>> | null = null;
    try { parsed = await parseFileFull(f, content); } catch { /* ignore */ }
    if (!parsed) return out;
    for (const e of parsed.imports) {
      const real = resolveLangImport(f, e, ctx);
      if (real) out.push(real);
    }
  }
  return out;
}

/**
 * 索引快速路径：从 seed 沿 cache.db 的 import 边双向 BFS，只取依赖子图。
 * 成功返回闭包文件列表；任何前置不满足（项目无 cache.db / seed 未索引 /
 * 打开 DB 异常）返回 null → expandClosure 回退原现场全扫逻辑。
 *
 * 快路径覆盖（与原全扫等价的来源）：
 *  1) 种子文件（必含）
 *  2) 同目录兄弟文件（包共享可见性；TS alias 反向保守兜底）
 *  3) 正向：索引里每个文件的 import 原始记录 → resolve 到本地文件（TS 相对+别名，
 *     Go/Python 包路径）——与原 drain 用完全相同的 resolve 分派，结果一致。
 *  4) 反向 TS/JS 相对导入：edges(kind='import') 按 target 反查 source。
 *  5) 反向 Go/Python/Java 包导入：candidatePkgImportSources → imports 表反查。
 *  6) findExternalImporters（跨 git 根兄弟项目引用）—— 不在单一项目 cache.db
 *     覆盖范围，仍沿用原函数做一次有界邻域扫描（兄弟数通常 ≤ NEIGHBOR_LIMIT）。
 */
async function tryIndexedExpandClosure(
  seedAbs: string,
  root: string,
  aliasCfg: AliasConfig | null,
): Promise<{ files: string[]; externalRefs: ExternalRef[] } | null> {
  // 存在性预检：避免 getProjectCacheDb() 在无索引的项目里把空 cache.db 创建出来（否则 Windows 上会持有 EBUSY 锁，
  // 导致 temp 目录测试的 rmSync 抛错，且无意义消耗一次池连接）。
  const dbFile = path.join(root, DATA_DIR_NAME, 'cache.db');
  if (!fs.existsSync(dbFile)) return null;

  let db: Database | null = null;
  try {
    db = getProjectCacheDb(root);
  } catch {
    return null; // DB 打不开（权限 / 不可写 / 未 import_project）→ 回退
  }
  if (!hasAnyIndexedFiles(db)) {
    closeProjectCacheDb(root); // 空索引，释放句柄；下次 import_project 后再池化
    return null;
  }

  const seedRel = toRelPath(root, seedAbs);
  if (!isFileIndexed(db, seedRel)) {
    closeProjectCacheDb(root); // seed 未入索引（增量更新间隙 / 只建了部分）→ 不锚定，回退并释放
    return null;
  }

  const goModules = readGoModules(root);
  const langCtx: LangResolveCtx = { root, goModules };
  const included = new Map<string, boolean>(); // abs → 是否已扩边（true=已处理）
  const queue: string[] = [];
  const externalRefs: ExternalRef[] = [];
  const addAbs = (a: string) => {
    if (!isLocalSource(a)) return;
    if (!included.has(a)) {
      included.set(a, false);
      queue.push(a);
    }
  };
  /** 正向 resolve 结果：根内 → 扩入闭包；根外 → 记为外部边界（不追外、不解析其 import） */
  const addResolved = (fromAbs: string, source: string, real: string | null): void => {
    if (!real) return;
    if (isInsideRoot(real, root)) addAbs(real);
    else externalRefs.push({ fromAbs, source, resolved: real });
  };

  // 1) seed 必含
  addAbs(seedAbs);

  // 2) 同目录兄弟（包共享可见性 + TS alias 反向保守兜底）
  for (const sibRel of sameDirIndexedFiles(db, seedRel)) {
    addAbs(path.resolve(root, sibRel));
  }

  // 3)+4)+5) 双向 BFS 扩边
  let head = 0;
  while (head < queue.length) {
    const f = queue[head++];
    if (included.get(f)) continue; // 已扩过
    included.set(f, true);
    const fRel = toRelPath(root, f);
    const ext = path.extname(f);
    const indexed = isFileIndexed(db, fRel);

    // ── 正向：f 引用了谁 → 扩入
    if (indexed) {
      // 缓存路径：读 imports 表 + 按语言分派 resolve（零文件读、零 AST）
      const cached = getRawImportsOfFile(db, fRel);
      for (const imp of cached) {
        if (imp.type_only) continue; // TS import type：运行时擦除、不算边
        let real: string | null = null;
        if (CLOSURE_TS_EXTS.has(ext)) {
          if (imp.source.startsWith('.')) {
            real = realResolveImport(f, imp.source);
          } else if (aliasCfg) {
            real = resolveAliasedImport(imp.source, aliasCfg);
          }
        } else {
          // 跨语言（Go/Python/Java/...）
          const pi: ParsedImport = {
            source: imp.source,
            kind: imp.kind,
            type_only: imp.type_only,
            line: imp.line,
          };
          real = resolveLangImport(f, pi, langCtx);
        }
        if (real) addResolved(f, imp.source, real);
      }
    } else {
      // 未索引文件（root 内尚未索引的增量文件，数量极少）→ 现场读+解析一次
      for (const real of await expandOneFileOnTheFly(f, aliasCfg, langCtx)) {
        addResolved(f, '', real);
      }
    }

    // ── 反向：谁引用了 f → 扩入
    if (indexed) {
      // 4) TS/JS 相对导入入边（edges 表，已解析）
      for (const srcRel of getResolvedImportSources(db, fRel)) {
        addAbs(path.resolve(root, srcRel));
      }
      // 5) Go/Python/Java 包导入反向：按候选包串查 imports 表
      const cands = candidatePkgImportSources(f, fRel, ext, root, goModules);
      if (cands.length > 0) {
        for (const impRel of findFilesImportingAnySource(db!, cands)) {
          addAbs(path.resolve(root, impRel));
        }
      }
    }
    // 未索引文件的反向：没法用索引反查，但这些是跨根兄弟项目文件，
    // findExternalImporters 本身就从兄弟项目方向找到了"它们引用了 seed"，
    // 再找"它们的反向引用"属于极端边角，本轮不扩（宁可少不可错）。
  }

  // 6) 邻域 importer（外部"谁 import 我"）—— 我们不改外部仓库，不做这方向扫描，
  //    故不再调用 findExternalImporters（那曾是每次 rename O(全兄弟仓库 AST) 卡死 + 爆内存的根源）。

  return { files: [...included.keys()], externalRefs };
}

/**
 * 动态闭包边界：给定种子文件 + 初始项目根，返回自包含的本地源文件集合。
 *  - 初始 = 项目根内全部本地源（importer 方向全覆盖：谁引用 seed 不漏）
 *  - BFS 沿 import 边扩展：相对导入（./ ../）或别名导入（@/ 等，需 alias）真实解析到
 *    边界外本地文件 → 扩入（importee 方向：seed 依赖不漏）
 *  - 邻域 importer 有界扫描：根外兄弟项目/松散文件引用 seed → 扩入（importer 方向，
 *    覆盖跨 git 根引用，如 dsl-workbench 引用 agent-io）
 *  - 跨 git 根引用也被纳入（不依赖单一 project_dir 的物理边界）
 *  - alias 可省略：缺省时按 root 的 tsconfig 自动加载；传 null 显式禁用别名解析
 *
 * 2026-09 新增：cache.db 索引快速路径（交接文档 ②+④）。
 *  - 有可用 cache.db（import_project / watcher 已建索引）→ 走反查子图 BFS：
 *    从 seed 沿 import 边只扩实际相连文件，从 O(root) 降到 O(relevant)。
 *  - 无索引/索引不可用/seed 未索引 → 兜底"现场全扫"（零前置免摩擦）。
 *
 * 外部边界语义（2026-09）：**只在本工作区内扩闭包**；任一 import 解析到 root 外
 * （外部仓库）→ 记录为 externalRef（不进入解析其 import 边、不落盘外部），并把该
 * 边界反馈给调用方。**不做 importer 方向**（外部"谁 import 我"与我们无关——我们是
 * 外部依赖的下游，没有资格也不应该去改上游仓库；那曾是每次 rename O(全兄弟仓库
 * AST) 卡死 + 爆内存的根源，已移除）。
 */
export async function expandClosureDetailed(
  seedFile: string,
  root: string,
  alias?: AliasConfig | null,
): Promise<ExpansionResult> {
  const aliasCfg = alias === undefined ? loadAliasConfig(root) : alias;
  const seedAbs = path.resolve(seedFile);

  // ② 索引反查快路径：有 cache.db 且 seed 已索引 → 子图 BFS
  const fast = await tryIndexedExpandClosure(seedAbs, root, aliasCfg);
  if (fast) return { files: fast.files, externalRefs: fast.externalRefs, skipped: [] };

  // ④ 兜底：无索引时走现场全扫（零前置、免摩擦）
  const included = new Map<string, boolean>(); // absPath → 是否已解析其 imports
  const queue: string[] = [];
  const externalRefs: ExternalRef[] = [];
  const skipped: ExpansionResult['skipped'] = [];

  // 初始：项目根内全部本地源 + 种子文件（种子可能不在根内，如跨根引用起点）
  const rootFiles: string[] = [];
  walkProjectFiles(root, rootFiles);
  for (const f of rootFiles) {
    if (!included.has(f)) {
      included.set(f, false);
      queue.push(f);
    }
  }
  if (!included.has(seedAbs) && isLocalSource(seedAbs)) {
    included.set(seedAbs, false);
    queue.push(seedAbs);
  }

  // BFS 扩展（阶段 1：根内 + importee 方向；阶段 3：邻域 importer 扩入后再扩其 import 边）
  let head = 0;
  const goModules = readGoModules(root); // 多语言 Go 包解析（一次）
  const drain = async (): Promise<void> => {
    while (head < queue.length) {
      const f = queue[head++];
      if (included.get(f)) continue; // 已解析过
      included.set(f, true);
      const ext = path.extname(f);
      let edges: Array<string | null> = [];
      if (CLOSURE_TS_EXTS.has(ext)) {
        // TS 系：analyzeModuleSource → import 边（相对/别名）
        let mod: Awaited<ReturnType<typeof analyzeModuleSource>> | null;
        try {
          mod = await analyzeModuleSource(fs.readFileSync(f, 'utf-8'), f);
        } catch (err) {
          // §2d：解析失败记 skipped 并带 why（原来静默 continue，调用方无感知）
          mod = null;
          skipped.push({ path: f, why: String(err) });
        }
        if (!mod) continue;
        for (const e of mod.imports) {
          if (!e.source) continue;
          if (e.source.startsWith('.')) edges.push(realResolveImport(f, e.source));
          else if (aliasCfg) edges.push(resolveAliasedImport(e.source, aliasCfg));
        }
      } else if (isSupported(ext)) {
        // 跨语言（Go/Python）：parseFileFull → import 边 → resolveLangImport
        let content: string;
        try {
          content = fs.readFileSync(f, 'utf-8');
        } catch (err) {
          // §2d：读盘失败记 skipped 并带 why（原来静默 continue，调用方无感知）
          skipped.push({ path: f, why: String(err) });
          continue;
        }
        let parsed: Awaited<ReturnType<typeof parseFileFull>> | null = null;
        try {
          parsed = await parseFileFull(f, content);
        } catch (err) {
          // §2d：AST 解析失败记 skipped 并带 why（原来静默 parsed=null → continue）
          skipped.push({ path: f, why: String(err) });
        }
        if (!parsed) continue;
        for (const e of parsed.imports) edges.push(resolveLangImport(f, e, { root, goModules }));
      } else {
        continue; // 不支持的扩展名（.vue/.java 等本版不解析 import）
      }
      for (const real of edges) {
        if (!real || !isLocalSource(real)) continue;
        if (isInsideRoot(real, root)) {
          if (!included.has(real)) {
            included.set(real, false);
            queue.push(real);
          }
        } else {
          externalRefs.push({ fromAbs: f, source: '', resolved: real });
        }
      }
    }
  };
  await drain();

  return { files: [...included.keys()], externalRefs, skipped };
}

/**
 * 便捷版：只返回闭包文件列表（供不关心外部边界的调用方/旧签名使用）。
 * 跨根等外部依赖可经 expandClosureDetailed 取得 externalRefs。
 */
export async function expandClosure(seedFile: string, root: string, alias?: AliasConfig | null): Promise<string[]> {
  return (await expandClosureDetailed(seedFile, root, alias)).files;
}
