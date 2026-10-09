/**
 * import_project 工具：扫描现有项目 → 自动生成 agent-io DSL
 *
 * 降低工具门槛：新用户无需手写 DSL，指向项目目录即可得到初始设计图，
 * 随后在画布上迭代（人改几何层 / LLM 改语义层）。
 *
 * 产出：
 *   - geometry.nodes：目录容器节点（type=module）+ 文件节点（type=file，status=done）
 *   - geometry.edges：contains（目录父子/文件归属）+ imports（跨文件依赖）
 *
 * 布局：递归分组布局——目录容器紧凑包裹子节点，组内按依赖拓扑分列，
 * 避免自由依赖布局导致容器互相遮罩。
 *
 * 依赖解析：
 *   - 相对导入（./ ../，Python 前导点）→ 按文件系统解析
 *   - Go 包路径 → 读 go.mod module 前缀，映射到包目录下全部 .go 文件
 *   - Python 点分模块 → 点转路径，先试项目根再试导入者目录
 *   - 其他包导入（npm 包、标准库）→ 外部依赖，跳过
 */

import { INDEX_SKIP_DIR_EXTRA, isIndexSkippedFileName, shouldSkipDir } from '../parse/source_exts.js';
import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';
import type { DesignDSL, Node, Edge, SemanticFile, ExpectedApi, Symbol } from '../../domain/types.js';
import { saveDSL, saveLiveFeature, ensureBaseline, getDSL, saveBaselineFactsIfAbsent } from '../storage.js';
// ★ T85/D2：基线事实**独立取**（索引器的事实）—— **绝不从 DSL 取**（那是「自己测自己」）
import { fileFacts } from '../index/file_facts.js';
import { mergeDesignLayer } from '../storage_overlay.js';
import { detectArchLayers } from '../analysis/structure/layer_detect.js';
import { parseFileFull, isSupported, resolveProjectImport } from '../parse/index.js';
import type { ParsedImport } from '../parse/index.js';
import { countLines, assessLines } from '../analysis/structure/monolith.js';
import type { Database } from '../index/db.js';
import { syncProject, getFileParse, pruneDeletedFiles } from '../index/symbols.js';
import { generateFileRoleTitles } from '../analysis/structure/role_title.js';

export interface ImportProjectInput {
  /** 目标项目根目录（绝对路径或相对 cwd） */
  project_dir: string;
  /** 新 feature 名（^[a-zA-Z0-9_-]+$） */
  feature: string;
  /** 显示标题（默认等于 feature） */
  title?: string;
  /** 最多解析文件数（默认 200，防止大项目失控） */
  max_files?: number;
  /** 是否包含测试文件（默认 false，测试文件通常是架构噪声） */
  include_tests?: boolean;
  /**
   * ★★★ **是否把「文档」也收成 DSL 节点**（`type: 'doc'`，默认 false）—— 2026-10-09（T88）。
   *
   * ## 为什么需要（用户点破）
   * 现实链条是「**把项目文档翻译成设计 DSL，然后才能对拍**」——
   * 而在此之前 **DSL 里 `docs/` 节点 = 0**（实测）⇒ `harvest_decisions` 采到的候选**无处可挂**
   * （它的出处就是 `docs/xxx.md:行号`）⇒ **采完就断**。
   *
   * ## 为什么是**另一类节点**，而不是"源码文件节点"
   * `source_exts.ts:27` 明写：`.md` 那类是「**可读文本，不是源码**」（L1 判据，G4 登记过）
   * ⇒ 塞进 `type: 'file'` 会**违反 L1**；⇒ 另立 `type: 'doc'`（语义清楚：**这是文档，不是源码**）。
   *
   * ★ 默认 **false**（与 `include_tests` 同款）⇒ **不改变现有行为**；
   *   要"文档成为设计的一等公民"就**显式打开**（`harvest_decisions` 的使用者会打开）。
   * ★ **只进 `geometry.nodes`，不进 `semantic.files`** —— 后者是要接一堆源码判据的语义层。
   */
  include_docs?: boolean;
  /**
   * 是否索引归档/历史目录（_archive/archive/_old/…，默认 false）。
   * 遗留项目归档代码不是主体，默认跳过以防稀释活跃社区；true 时索引且截断排序靠后。
   */
  include_archive?: boolean;
  /**
   * 可选：符号缓存（openDb 的返回值）。提供时走增量路径——
   * content_hash 未变的文件直接读 cache.db，跳过重解析；
   * 变更文件由 syncFile 解析并写回缓存，下次运行受益。
   */
  cache_db?: Database;
  /**
   * 可选：仅生成"实际 DSL"（代码实时快照，写 live/ 目录，不覆盖设计 DSL）。
   * 供 watch_project 变更回调 / serve 重建实际视图用。默认 false=写设计 DSL。
   */
  live_only?: boolean;
  /**
   * ★★★ 可选（T77，2026-10-09 用户裁定"翻"）：**显式要求重建设计 DSL**。
   *
   * ## 默认规则（只有一条，用户原话：*"有的话就不用动了，就只需要对比就可以。"*）
   *   · **设计不存在** ⇒ 默认**建**（从实际 fork 一份；没东西可丢，不算破坏）；
   *   · **设计已存在** ⇒ 默认**只刷新"实际"，完全不碰设计**。
   *   ⇒ **默认永不破坏**，用户不必记任何开关；要重写设计时才显式 `rebuild_design=true`。
   *
   * ★ `live_only` 保留原有两个取值的语义（true=只实际 / false=写设计），**只有缺省变了**；
   *   两个都显式给且矛盾（`live_only=true` + `rebuild_design=true`）⇒ **直接报错**（不替调用方选）。
   * ★ 重建仍受 `allow_design_drop` 把关（会丢"扫描产不出"的节点时默认拒绝）。
   */
  rebuild_design?: boolean;
  /**
   * ★ 可选（T77）：**只在重建设计时生效**。
   * 默认 false ⇒ 若本次重建会**抹掉"扫描产不出"的节点**（人手加的那些，判据见实现处），
   * **直接拒绝并列出它们**；true ⇒ 允许丢，但丢掉了什么会在输出里报出来。
   * ★ 为什么默认拒绝：破坏性操作不该是"默认且静默"的。
   */
  allow_design_drop?: boolean;
  /**
   * 可选：live_only 时实际 DSL 归属的项目根（默认 dataHome）。
   * watch_project 监听任意项目时传 project_dir，使实际 DSL 与该项目 cache.db 同目录归位。
   */
  live_dir?: string;
  /**
   * 可选：是否用 LLM 为每个文件节点生成中文职责主标题（node.title）。
   * 默认 false（不引入 LLM 依赖与延迟）；自分析/讲解场景开启。未配置 LLM 时静默跳过。
   */
  gen_roles?: boolean;
  /**
   * 可选：导入源码的持久根目录（绝对路径）。提供时写入 DSL.source_root，
   * 供巨石体检/影响面/一致性等需读源文件的功能定位源码。
   * 浏览器上传导入时由 serve 指定为 .agent-io/projects/<feature>/。
   */
  source_root?: string;
  /**
   * 可选：设计模式 — 聚合文件到目录层级，只输出高层模块节点，不输出每个文件。
   * 用于从现有代码快速生成设计意图 DSL（草图供人后续调整）。默认 false=保留每个文件。
   * true 时：同一目录下的所有文件聚合为一个模块容器节点，符号和 API 汇总到语义层。
   */
  design_mode?: boolean;
  /**
   * 可选：功能模式 — 按调用图做【功能性】聚合，而非按目录聚合。
   * 理想聚合是"业务功能"而非"文件夹"：用文件级 import 边做标签传播，把互相依赖的
   * 文件聚成功能社区，每个社区 = 一个功能模块节点（可跨目录）。自包含，不依赖 cache.db。
   * 优先级高于 design_mode（functional_mode 即为一种设计级聚合）。
   */
  functional_mode?: boolean;
}

export interface ImportProjectResult {
  message: string;
  feature: string;
  files_parsed: number;
  /**
   * ★★★ **本次扫进来、归本 feature 管**的源码文件（仓库相对、`/` 分隔）。
   *
   * ★ **与 `touched.scope_files` 同名同义**（零字段名翻译）：`import_project` 是链的**入口**，
   *   它在链上要交出的"对象"就是**这条链接下来该关注的文件面**。
   * ★ 为什么不复用 `files_parsed`：那个是**数**（`number`），这个是**集合**（`string[]`）——
   *   按 §2.2「名字像 ≠ 同义」，**不改既有字段名，只新增**。
   * ★ 为什么 `import_project` 需要一个对象类锚点（2026-10-09 实测）：它的 `touched` 此前只有
   *   `feature` / `project_dir`，**两者都是作用域键**（`ANY_TOOL → ANY_TOOL`）⇒ **不计入对象边**
   *   ⇒ `deriveObjectChains()` 里**永远没有它**（建档=第一步 却是唯一上不了链的入口）。
   * ★ 恒非空：`absFiles.length === 0` 在下面直接 `throw`（第 1112 行）⇒ 不是兜底，是**不变量**。
   */
  scope_files: string[];
  symbols_found: number;
  dep_edges: number;
  dirs_created: number;
  skipped: string[];
  /** 缓存增量统计（仅 cache_db 提供时存在）：hits=未变命中 reparsed=重解析 failed=失败 */
  cache?: { hits: number; reparsed: number; failed: number };
}

// ─────────────────────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────────────────────

/** 遍历跳过的目录名 */
// ★ 索引器的目录跳过集：**基础集（内核唯一落点）+ 本工具显式追加**。
//   逐字保留原 28 项语义（追加项 = vendor/target/bin/obj/.idea/.vscode/.backup/scaffold/egg-info）
//   —— 迁移只做"同源"，**不顺手改行为**（§2c：不许悄悄扩大跳过面）。
const SKIP_DIR_EXTRA = INDEX_SKIP_DIR_EXTRA;
const SKIP_DIRS = {
  has: (n: string) => shouldSkipDir(n, SKIP_DIR_EXTRA),
} as unknown as Set<string>;

/**
 * 归档/历史目录名单：遗留项目里"已弃用但保留"的代码堆（如 _archive/）。
 * 默认【不索引】——它们不是项目主体，混进 cache.db 会稀释/淹没真正活跃的社区
 * （analyze_monolith / derive_chain 等基于调用边的工具全部失真）。
 * include_archive=true 时才索引，且这些文件在 max_files 截断时排序靠后（优先保活跃主体）。
 */
const ARCHIVE_DIRS = new Set([
  '_archive', 'archive', 'archived', '_old', 'old', '_backup', '_deprecated',
  '_sandbox', '_wip', '_draft', '_legacy', '_stale', '_dead', '_scratch',
]);

/** 跳过的文件模式（测试/生成物 / 编辑器临时存取，非架构） */

/** 测试文件判定（仅测试类，不含 .min/.d.ts 等其它 SKIP 项）——live 快照刷新跟随设计 DSL 时用 */
const TEST_FILE_RE = /(_test\.go$|\.test\.[tj]sx?$|\.spec\.[tj]sx?$|test_.*\.py$|.*_test\.py$)/;

/** 布局常量（与渲染器父节点约定一致：padding 20 + title 30） */
const FILE_W = 240;
const FILE_H = 64;
const COL_GAP = 110;
const ROW_GAP = 40; // 给边绕障留出穿行通道（障碍检测 margin=10×2 + 线宽）
const PAD = 20;
const TITLE_H = 30;
const MARGIN = 60;

/** 布局常量导出（relayout_nested 恢复脚本复用，保证容器尺寸约定一致） */
export const IMPORT_LAYOUT = { FILE_W, FILE_H, COL_GAP, ROW_GAP, PAD, TITLE_H, MARGIN };

/** 各语言文件节点配色（深色主题协调） */
const LANG_COLORS: Record<string, { bg: string; color: string }> = {
  go: { bg: '#1a4a7a', color: '#ffffff' },
  ts: { bg: '#1565c0', color: '#ffffff' },
  tsx: { bg: '#1565c0', color: '#ffffff' },
  js: { bg: '#6d5c10', color: '#fff9c4' },
  jsx: { bg: '#6d5c10', color: '#fff9c4' },
  py: { bg: '#1a5f3a', color: '#ffffff' },
};
const DEFAULT_FILE_COLOR = { bg: '#37474f', color: '#eceff1' };
const DIR_STYLE = { bg: '#152141', color: '#90caf9' };

// ─────────────────────────────────────────────────────────────
// 文件扫描
// ─────────────────────────────────────────────────────────────

/** gitignore 作用域：base = .gitignore 所在目录（绝对路径），ig = 该文件的规则匹配器 */
interface GiMatcher {
  base: string;
  ig: Ignore;
}

/**
 * 项目 .gitignore 匹配器集合：绝对目录 → 该目录下 .gitignore 的 ignore 实例。
 * 规则相对各自目录解释（与 git 语义一致：根 .gitignore 管整棵树，
 * 嵌套 .gitignore 只管其所在目录以下）。
 * 无任何 .gitignore 时返回 null（调用方沿用原有硬编码过滤）。
 */
export type GitignoreMatchers = Map<string, Ignore>;

/**
 * 收集项目根及全部嵌套 .gitignore（不进 SKIP_DIRS 跳过的目录——node_modules
 * 里的 .gitignore 不该管项目主体）。仅读取，不改动任何文件。
 */
export function collectGitignore(root: string): GitignoreMatchers | null {
  const matchers: GitignoreMatchers = new Map();
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && e.name === '.gitignore') {
        try {
          const ig = ignore();
          ig.add(fs.readFileSync(full, 'utf-8').split(/\r?\n/));
          matchers.set(dir, ig);
        } catch {
          /* 单个 .gitignore 读失败不影响整体 */
        }
      }
    }
  }
  return matchers.size > 0 ? matchers : null;
}

/** 命中任一作用域规则即视为被 gitignore（目录带尾斜杠才能匹配 build/ 这类目录规则） */
function isGitignored(chain: GiMatcher[], full: string, isDir: boolean): boolean {
  for (const { base, ig } of chain) {
    const rel = toPosix(path.relative(base, full));
    if (rel === '' || rel.startsWith('..')) continue;
    if (ig.ignores(isDir ? rel + '/' : rel)) return true;
  }
  return false;
}

export function walkFiles(
  root: string,
  includeTests: boolean,
  includeArchive = false,
  gitignore: GitignoreMatchers | null = null,
): string[] {
  const out: string[] = [];
  interface Frame {
    dir: string;
    /** 治理本目录内条目的 gitignore 链（含祖先 + 本目录自己的 .gitignore） */
    chain: GiMatcher[];
  }
  const rootChain: GiMatcher[] = gitignore?.get(root) ? [{ base: root, ig: gitignore.get(root)! }] : [];
  const stack: Frame[] = [{ dir: root, chain: rootChain }];
  while (stack.length > 0) {
    const { dir, chain } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    // 子目录继承的链 = 当前链 + 本目录自己的 .gitignore（它治理其下所有条目）
    const childChain: GiMatcher[] = gitignore?.get(dir) ? [...chain, { base: dir, ig: gitignore.get(dir)! }] : chain;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        // 归档目录默认跳过（不索引）；include_archive=true 才深入
        if (!includeArchive && ARCHIVE_DIRS.has(e.name)) continue;
        if (isGitignored(chain, full, true)) continue;
        stack.push({ dir: full, chain: childChain });
      } else if (e.isFile()) {
        if (isIndexSkippedFileName(e.name, includeTests)) continue;
        if (isGitignored(chain, full, false)) continue;
        if (isSupported(path.extname(e.name))) out.push(full);
      }
    }
  }
  // 确定性顺序；include_archive=true 时归档文件排后（max_files 截断优先保活跃主体）
  if (includeArchive) {
    return out.sort((a, b) => {
      const aArc = inArchiveDir(a) ? 1 : 0;
      const bArc = inArchiveDir(b) ? 1 : 0;
      if (aArc !== bArc) return aArc - bArc;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }
  return out.sort();
}

/** 路径是否落在某个归档目录下 */
function inArchiveDir(p: string): boolean {
  const parts = p.split(path.sep);
  return parts.some((seg) => ARCHIVE_DIRS.has(seg));
}

// ─────────────────────────────────────────────────────────────
// import 解析 → 内部文件
// ─────────────────────────────────────────────────────────────

export interface FileEntry {
  /** 相对项目根的 posix 路径（如 src/tools/a.ts） */
  rel: string;
  abs: string;
  ext: string;
  dir: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Go module 条目：module 路径 + go.mod 所在目录（相对项目根，'' 表示根） */
export interface GoModule {
  module: string;
  dir: string;
}

/**
 * 读取项目内全部 go.mod（支持多模块/monorepo）。
 * 按 module 路径长度降序，保证最长前缀优先匹配
 * （如 example.com/a/v2 优先于 example.com/a）。
 */
export function readGoModules(root: string): GoModule[] {
  const mods: GoModule[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full);
      } else if (e.isFile() && e.name === 'go.mod') {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const m = content.match(/^\s*module\s+(\S+)/m);
          if (m) {
            const rel = toPosix(path.relative(root, dir));
            mods.push({ module: m[1], dir: rel === '.' ? '' : rel });
          }
        } catch {
          /* 忽略读取失败的 go.mod */
        }
      }
    }
  }
  return mods.sort((a, b) => b.module.length - a.module.length);
}

/** 扩展名解析优先级（同名无扩展名路径碰撞时，排名靠前者胜出——.ts 优先于编译产物 .js） */
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'];

/** 构建查找索引：无扩展名路径 / 目录路径 → 文件 rel 列表 */
export function buildIndex(files: FileEntry[]): {
  byNoExt: Map<string, FileEntry>;
  byDir: Map<string, FileEntry[]>;
  /** ★ 精确路径 → 条目（`resolveProjectImport` 的 `rels` 视角；2026-09-30 T2） */
  byRel: Map<string, FileEntry>;
  /** ★ 精确路径全集（传给内核 `resolveProjectImport` 的唯一入参形态） */
  rels: Set<string>;
  /**
   * ★★ 补全候选用的扩展名 —— **必须是索引里真实存在的那些**，否则会静默丢解析（2026-09-30 T2）。
   *
   * 为什么（这条是踩出来的）：本索引的 `byNoExt` 是**扩展名无关**的（键 = 去掉扩展名的路径 ⇒
   * 任何扩展名都能命中）；而内核 `resolveProjectImport` 走的是 `completionCandidates`，
   * 它**逐个枚举** `base + ext`。若只传旧的窄表 `RESOLVE_EXTS`（`.ts/.tsx/.js/.jsx/.py/.go`），
   * 那么 `.hs` / `.scala` / `.jl` 之类的文件**永远补不出来** ⇒ 解析静默变空（实测：
   * `hroot/Use.hs` 的 `import Lib` 从「命中 `hroot/Lib.hs`」退化成「空」）。
   * ⇒ 顺序仍是 `RESOLVE_EXTS` **优先**（那是同名不同扩展名时的选择优先级，与 `extRank` 同源），
   *   其余扩展名按索引实际出现补在后面。
   */
  exts: string[];
  /** 同名不同扩展名的碰撞记录（被丢弃的一方），用于结果可见性 */
  collisions: string[];
} {
  const byNoExt = new Map<string, FileEntry>();
  const byDir = new Map<string, FileEntry[]>();
  const byRel = new Map<string, FileEntry>();
  const collisions: string[] = [];
  const extRank = (f: FileEntry): number => {
    const i = RESOLVE_EXTS.indexOf(f.ext);
    return i === -1 ? RESOLVE_EXTS.length : i;
  };
  const setNoExt = (key: string, f: FileEntry): void => {
    const prev = byNoExt.get(key);
    if (!prev) {
      byNoExt.set(key, f);
      return;
    }
    if (prev.rel === f.rel) return;
    // 碰撞：保留扩展名优先级高者，另一方记录（静默覆盖会错连依赖边）
    if (extRank(f) < extRank(prev)) {
      byNoExt.set(key, f);
      collisions.push(`${prev.rel}（与 ${f.rel} 同名，依赖解析采用后者）`);
    } else {
      collisions.push(`${f.rel}（与 ${prev.rel} 同名，依赖解析采用后者）`);
    }
  };
  for (const f of files) {
    const noExt = f.rel.slice(0, f.rel.length - f.ext.length);
    setNoExt(noExt, f);
    byRel.set(f.rel, f);
    const list = byDir.get(f.dir) || [];
    list.push(f);
    byDir.set(f.dir, list);
    // index 文件额外注册目录本身（import './dir' → ./dir/index.ts）
    const base = path.posix.basename(noExt);
    if (base === 'index' || base === '__init__' || base === 'mod') {
      setNoExt(f.dir, f);
    }
  }
  return {
    byNoExt,
    byDir,
    byRel,
    rels: new Set(byRel.keys()),
    // ★ RESOLVE_EXTS 优先（同名不同扩展名的选择优先级），其余按索引实际出现补在后面
    exts: [...RESOLVE_EXTS, ...new Set(files.map((f) => f.ext).filter((e) => !RESOLVE_EXTS.includes(e)))],
    collisions,
  };
}

/**
 * 把一条 import 解析为项目内部文件列表（0..n）。
 *
 * ★★ 2026-09-30（T2 内化）：**四层规则已交给内核唯一实现** `resolveProjectImport`
 *   （relative / python-dot / dotted / bare-name），本函数只剩两处**它专有**的东西：
 *    ① **Go 包 = 多目标**（该目录下**全部**文件）—— 内核**不再有** `go-module` 层
 *       （★ 2026-10-04 该层已删：无调用方、且"单目标代表"与 Go 多文件包语义不符 ⇒ 多文件展开
 *        本就该留在本地。见 import_resolve.ts 的 `ProjectImportOptions` 注释）；
 *    ② **目录形式兜底**：`import './dir'` → 该目录下 `index|__init__|mod` 的**正则**匹配
 *       （扩展名不限）；内核的 `INDEX_FILES` 是**固定清单**（`index.{ts,tsx,js,jsx}`），
 *       覆盖不到 `__init__.py` / `mod.go` ⇒ 这条**策略**留在本地。
 *
 * 改造前这里曾有 **~45 行**自己实现的分派（含 Python 前导点的正则与注释、点分→路径、
 * 单段同名），与 `health` / `impact` 各一份**互不一致**（同一夹具三个答案）——
 * 那正是本仓 §38 收口的三份之一。现在只剩"薄壳 + 两处专有策略"。
 *
 * ★ 已知的行为**放宽**（都是"更能解析"，不是丢解析；实测差集见提交信息）：
 *    · 点分模块（`app.Helper`）现在试**导入者上方每一层**作包根 ⇒ Maven 布局
 *      （`src/main/java/app/Use.java`）也能命中；旧实现只试「项目根 + 导入者同层」；
 *    · 单段裸名（`Helper`）现在多一个**项目根**兜底；
 *    · `kind==='relative'` 但 source 是点分形式（Python `from pkg.mod import`）以前**早退成空**，
 *      现在走 dotted 层能解析到。
 */
export function resolveImport(
  imp: ParsedImport,
  importer: FileEntry,
  index: { byNoExt: Map<string, FileEntry>; byDir: Map<string, FileEntry[]>; byRel: Map<string, FileEntry>; rels: Set<string>; exts: string[] },
  goModules: GoModule[],
): FileEntry[] {
  const { byDir, byRel, rels, exts } = index;

  // ① Go 包：**多目标**（module 前缀剥离 → 包目录下全部文件）。最长前缀优先（goModules 已按长度降序）
  for (const gm of goModules) {
    if (imp.source === gm.module || imp.source.startsWith(gm.module + '/')) {
      const rest = imp.source.slice(gm.module.length).replace(/^\//, '');
      const dir = gm.dir ? (rest ? `${gm.dir}/${rest}` : gm.dir) : rest;
      const dirFiles = byDir.get(dir);
      if (dirFiles && dirFiles.length > 0) return [...dirFiles];
    }
  }

  // ② 四层解析规则：内核唯一实现（★ 2026-10-04：内核的 `go-module` 层已删，Go 多目标见 ①）
  const hit = resolveProjectImport(importer.rel, imp.source, rels, { exts });
  if (hit.rel) {
    const entry = byRel.get(hit.rel);
    if (entry) return [entry];
  }

  // ③ 目录形式兜底（本仓专有策略：`index|__init__|mod` **正则**，扩展名不限）
  if (imp.kind === 'relative' && !/^\.+$/.test(imp.source) && !/^\.+[^./]/.test(imp.source)) {
    const target = path.posix.normalize(path.posix.join(importer.dir, imp.source));
    const dirFiles = byDir.get(target);
    if (dirFiles && dirFiles.length > 0) {
      const init = dirFiles.find((f) => /(^|\/)(index|__init__|mod)\.[^.]+$/.test(f.rel));
      return [init || dirFiles[0]];
    }
  }
  return [];
}

// ─────────────────────────────────────────────────────────────
// 布局：递归分组（目录紧凑包裹，组内按依赖拓扑分列）
// ─────────────────────────────────────────────────────────────

export interface LayoutItem {
  id: string;
  w: number;
  h: number;
  x: number;
  y: number;
}

/** Kahn 拓扑分列；环上的节点追加到最后一列（按 id 排序保证确定性） */
export function rankItems(ids: string[], deps: Array<[string, string]>): Map<string, number> {
  const inDeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  ids.forEach((id) => { inDeg.set(id, 0); out.set(id, []); });
  for (const [f, t] of deps) {
    if (!inDeg.has(f) || !inDeg.has(t) || f === t) continue;
    inDeg.set(t, (inDeg.get(t) || 0) + 1);
    out.get(f)!.push(t);
  }
  const rank = new Map<string, number>();
  const queue = ids.filter((id) => (inDeg.get(id) || 0) === 0).sort();
  const tempIn = new Map(inDeg);
  queue.forEach((id) => rank.set(id, 0));
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curRank = rank.get(cur) || 0;
    for (const next of (out.get(cur) || []).sort()) {
      rank.set(next, Math.max(rank.get(next) || 0, curRank + 1));
      tempIn.set(next, (tempIn.get(next) || 0) - 1);
      if (tempIn.get(next) === 0) queue.push(next);
    }
  }
  const leftovers = ids.filter((id) => !rank.has(id)).sort();
  const maxRank = rank.size > 0 ? Math.max(...rank.values()) : -1;
  leftovers.forEach((id) => rank.set(id, maxRank + 1));
  return rank;
}

/** 组内布局：按 rank 分列，列内按 id 排序纵排，返回内容 bbox 尺寸 */
export function layoutGroup(items: LayoutItem[], deps: Array<[string, string]>): { w: number; h: number } {
  const ids = items.map((i) => i.id);
  const rank = rankItems(ids, deps);
  const byRank = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const r = rank.get(item.id) || 0;
    const list = byRank.get(r) || [];
    list.push(item);
    byRank.set(r, list);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  // 紧凑货架排布：依赖结构退化（≤2 列）且条目较多时，单列纵排会堆出数千 px 高塔
  // （如 cross-border-scout 100+ 文件单列 12834px），折叠视图无法适配屏幕。
  // 货架算法：按高度降序（同高按 id）逐行填充，行宽目标 = √（总面积×1.5)，
  // 天然支持异构尺寸（大容器与小文件混排），bbox 近 3:2，牺牲微弱拓扑序换可读性。
  // 阈值从 3 提到 12：3~11 文件走 barycenter 列布局，边更短直。
  if (ranks.length <= 2 && items.length >= 12) {
    const area = items.reduce((s, i) => s + (i.w + COL_GAP) * (i.h + ROW_GAP), 0);
    const maxItemW = Math.max(...items.map((i) => i.w));
    const targetW = Math.max(Math.sqrt(area * 1.5), maxItemW);
    const sorted = [...items].sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
    let x = 0;
    let y = 0;
    let shelfH = 0;
    let maxW = 0;
    for (const it of sorted) {
      if (x > 0 && x + it.w > targetW) {
        y += shelfH + ROW_GAP;
        x = 0;
        shelfH = 0;
      }
      it.x = x;
      it.y = y;
      x += it.w + COL_GAP;
      shelfH = Math.max(shelfH, it.h);
      maxW = Math.max(maxW, x - COL_GAP);
    }
    return { w: Math.max(maxW, FILE_W), h: Math.max(y + shelfH, FILE_H) };
  }

  // barycenter 列内排序：邻居在上层/下层的平均 y 作为排序键，迭代 3 轮收敛
  const inNeighbors = new Map<string, string[]>();
  const outNeighbors = new Map<string, string[]>();
  for (const [f, t] of deps) {
    if (inNeighbors.has(f)) inNeighbors.get(f)!.push(t);
    if (outNeighbors.has(t)) outNeighbors.get(t)!.push(f);
  }
  // 初始 y：按列内 rank 索引占位（供 barycenter 计算）
  for (const r of ranks) {
    const col = byRank.get(r)!;
    col.forEach((it, idx) => { it.y = idx * (it.h + ROW_GAP); });
  }
  for (let iter = 0; iter < 3; iter++) {
    const topDown = iter < 2;
    const order = topDown ? ranks : [...ranks].reverse();
    for (const r of order) {
      const col = byRank.get(r)!;
      const neighborCol = topDown ? byRank.get(r - 1) : byRank.get(r + 1);
      if (neighborCol && neighborCol.length > 0) {
        const ny = new Map(neighborCol.map((it) => [it.id, it.y]));
        col.sort((a, b) => {
          const ay = (inNeighbors.get(a.id) || [])
            .map((n) => ny.get(n))
            .filter((v) => v !== undefined) as number[];
          const by = (inNeighbors.get(b.id) || [])
            .map((n) => ny.get(n))
            .filter((v) => v !== undefined) as number[];
          const av = ay.length ? ay.reduce((s, v) => s + v, 0) / ay.length : Number.MAX_VALUE;
          const bv = by.length ? by.reduce((s, v) => s + v, 0) / by.length : Number.MAX_VALUE;
          return av - bv;
        });
        // 重新赋 y
        let yCursor = 0;
        for (const it of col) { it.y = yCursor; yCursor += it.h + ROW_GAP; }
      }
    }
  }

  let maxX = 0;
  let maxY = 0;
  let xCursor = 0;
  for (const r of ranks) {
    const col = byRank.get(r)!;
    let colW = 0;
    let yCursor = 0;
    for (const item of col) {
      item.x = xCursor;
      item.y = yCursor;
      yCursor += item.h + ROW_GAP;
      colW = Math.max(colW, item.w);
    }
    maxX = Math.max(maxX, xCursor + colW);
    maxY = Math.max(maxY, yCursor - ROW_GAP);
    xCursor += colW + COL_GAP;
  }
  return { w: Math.max(maxX, FILE_W), h: Math.max(maxY, FILE_H) };
}

// ─────────────────────────────────────────────────────────────
// 功能性聚合：按调用图社区划功能模块（functional_mode）
// ─────────────────────────────────────────────────────────────

/** 文件级标签传播：把互相依赖的文件聚成功能社区。返回 社区 id → 文件 rel 列表 */
function communityDetectFiles(files: FileEntry[], deps: Array<[string, string]>, maxIter = 20): Map<number, string[]> {
  const idx = new Map<string, number>();
  files.forEach((f, i) => idx.set(f.rel, i));
  const n = files.length;
  const adj: number[][] = files.map(() => []);
  for (const [a, b] of deps) {
    const ia = idx.get(a);
    const ib = idx.get(b);
    if (ia === undefined || ib === undefined || ia === ib) continue;
    adj[ia].push(ib);
    adj[ib].push(ia);
  }
  // 标签传播：初始每个文件自成一派，邻居多数派标签胜出
  const labels = files.map((_, i) => i);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const nbrs = adj[i];
      if (nbrs.length === 0) continue;
      const cnt = new Map<number, number>();
      for (const nb of nbrs) {
        const l = labels[nb];
        cnt.set(l, (cnt.get(l) ?? 0) + 1);
      }
      let best = labels[i];
      let bestN = -1;
      for (const [l, c] of cnt) {
        if (c > bestN || (c === bestN && l < best)) {
          bestN = c;
          best = l;
        }
      }
      if (best !== labels[i]) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 按 label 分组，稳定编号
  const byLabel = new Map<number, string[]>();
  files.forEach((f, i) => {
    const l = labels[i];
    const arr = byLabel.get(l) || [];
    arr.push(f.rel);
    byLabel.set(l, arr);
  });
  const out = new Map<number, string[]>();
  let cid = 0;
  for (const arr of byLabel.values()) out.set(cid++, arr);
  return out;
}

/** 社区默认名：取成员文件里出现最多的首段目录 */
function communityNameOf(files: string[]): string {
  const dirCount = new Map<string, number>();
  for (const f of files) {
    const d = f.includes('/') ? f.split('/')[0] : '(根)';
    dirCount.set(d, (dirCount.get(d) ?? 0) + 1);
  }
  let best = '(根)';
  let bestN = 0;
  for (const [d, n] of dirCount) if (n > bestN) { best = d; bestN = n; }
  return best;
}

/** 社区消歧符：取成员文件里出现最多的第二段路径（子目录/文件名），用于区分同顶层目录的多个社区 */
function communityQualifier(rels: string[]): string {
  const sub = new Map<string, number>();
  for (const f of rels) {
    const parts = f.split('/');
    const s = parts.length >= 2 ? parts[1] : f.split('.').slice(0, -1).join('.') || f;
    sub.set(s, (sub.get(s) ?? 0) + 1);
  }
  let best = rels[0]?.split('/').pop()?.replace(/\.[a-z]+$/i, '') ?? '?';
  let bestN = 0;
  for (const [s, n] of sub) if (n > bestN) { best = s; bestN = n; }
  return best;
}

/**
 * skill 级功能性聚合：基于 analyze_monolith 的锚点驱动社区（+ 可选 derive_feature_tree
 * LLM 归并成业务功能），产出功能模块节点 + 社区间依赖边。
 * 每个模块节点聚合其社区成员文件的 API/符号/行数，语义层写入职责描述。
 */
async function buildFromMonolith(
  mono: {
    communities: Array<{ id: number; name: string; files: string[]; est_lines: number; symbol_count: number }>;
    dependencies: Array<[number, number, number]>;
  },
  projectDir: string,
  parsed: Map<string, { symbols: ExpectedApi[]; nonFuncSymbols: Symbol[]; imports: ParsedImport[] }>,
  lineCounts: Map<string, number>,
  genNames: boolean,
  sanitize: (s: string) => string,
  moduleId: (cid: number) => string,
  cacheDb?: Database,
): Promise<{ nodes: Node[]; edges: Edge[]; semanticFiles: SemanticFile[]; size: { w: number; h: number } }> {
  // A. 模块分组：LLM 归并成业务功能（3-8 个中文名）；失败/未配置则用社区级
  let groups: Array<{ id: string; name: string; communities: Array<{ id: number; files: string[] }> }> | null = null;
  if (genNames) {
    try {
      const { deriveFeatureTree } = await import('../analysis/structure/derive_feature_tree.js');
      const ft = await deriveFeatureTree({ project_dir: projectDir, db: cacheDb, gen_names: true });
      if (ft.features.length > 0) {
        groups = ft.features.map((f, i) => ({
          id: moduleId(i),
          name: f.name,
          communities: f.communities.map((c) => ({ id: c.id, files: c.files })),
        }));
      }
    } catch {
      groups = null;
    }
  }

  // 模块 → 成员文件 与 主键
  const moduleRels = new Map<string, { name: string; rels: string[] }>();
  if (groups) {
    for (const g of groups) {
      const rels = [...new Set(g.communities.flatMap((c) => c.files))].sort();
      moduleRels.set(g.id, { name: g.name, rels });
    }
  } else {
    for (const c of mono.communities) {
      moduleRels.set(moduleId(c.id), { name: c.name, rels: c.files });
    }
  }

  // 社区 → 模块 id 映射（用于依赖边聚合）
  const commToModule = new Map<number, string>();
  if (groups) {
    for (const g of groups) for (const c of g.communities) commToModule.set(c.id, g.id);
  } else {
    for (const c of mono.communities) commToModule.set(c.id, moduleId(c.id));
  }

  // B. 聚合社区间依赖边 → 模块边
  const agg = new Map<string, { from: string; to: string; n: number }>();
  for (const [a, b, w] of mono.dependencies) {
    const from = commToModule.get(a);
    const to = commToModule.get(b);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    const cur = agg.get(key);
    if (cur) cur.n += w;
    else agg.set(key, { from, to, n: w });
  }
  const aggDeps: Array<[string, string]> = [...agg.values()].map(({ from, to }) => [from, to]);

  // C. 布局：带社区依赖边做拓扑分列
  const items: LayoutItem[] = [];
  for (const [id, m] of moduleRels) {
    items.push({ id, w: FILE_W * Math.min(Math.max(m.rels.length, 1), 3), h: FILE_H, x: 0, y: 0 });
  }
  const content = layoutGroup(items, aggDeps);
  const contentW = content.w + PAD * 2;
  const contentH = content.h + PAD * 2 + TITLE_H;

  // D. 生成模块节点 + 语义层
  const nodes: Node[] = [];
  const semanticFiles: SemanticFile[] = [];
  for (const item of items) {
    const m = moduleRels.get(item.id)!;
    const containerW = item.w + PAD * 2;
    const containerH = FILE_H + PAD * 2 + TITLE_H;
    const x = item.x + MARGIN - PAD;
    const y = item.y + MARGIN - PAD;
    const apis: ExpectedApi[] = [];
    const nonFuncSymbols: Symbol[] = [];
    for (const r of m.rels) {
      const p = parsed.get(r);
      if (p) {
        apis.push(...p.symbols.slice(0, 50 - apis.length));
        nonFuncSymbols.push(...p.nonFuncSymbols);
      }
    }
    nodes.push({
      id: item.id,
      label: `🧩 ${m.name}`,
      x: Math.round(x),
      y: Math.round(y),
      width: containerW,
      height: containerH,
      type: 'module',
      // ★★★ 2026-10-09（T93）：聚合体的摘要改挂**它自己的几何节点** ⇒ 写进 `title`
      //   （`geometry.ts:124`：「人话主标题：LLM 生成的职责摘要…渲染端优先展示，label 兜底」）。
      //   ★ 为什么**不再** `semanticFiles.push`：契约 `semantic.ts:67` 规定 `SemanticFile.path` 是
      //     **单个目标文件相对路径**（单数）；而这是**模块聚合节点**，只能填 `m.rels.join(', ')`
      //     （成员列表拼串）⇒ 违约。实害：下游把这逗号串**当路径读源码**（`derive_chain` /
      //     `consistency_check` 实测硬失败：「源文件不存在，无法读取: …math.ts, src/util/calc.ts」）。
      title: `${m.name} — 聚合 ${m.rels.length} 个文件 / ${apis.length + nonFuncSymbols.length} 个符号`,
      style: { ...DIR_STYLE, borderRadius: 8 },
    });
  }

  // E. 组装模块边
  const edges: Edge[] = [];
  const sorted = [...agg.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  for (const { from, to, n } of sorted) {
    edges.push({
      id: `dep_${sanitize(from)}_${sanitize(to)}`,
      from,
      to,
      label: n > 1 ? `imports ×${n}` : 'imports',
      type: 'dashed',
      style: n > 3 ? { strokeWidth: 2 } : undefined,
    });
  }

  return { nodes, edges, semanticFiles, size: { w: contentW, h: contentH } };
}

/**
 * 功能性聚合布局：每个功能社区 = 一个模块节点，社区间依赖边 = 模块边。
 * 孤立单文件（无依赖边）按顶层目录归并，避免一文件一模块的碎片爆炸。
 *
 * 优先走 skill 级管线：复用 analyze_monolith 锚点社区 + derive_feature_tree LLM 归并
 * （动态 import，隔离 node:sqlite 负载，不污染主链路）。无 cache.db / 无社区时
 * 回退到本文件自包含的朴素标签传播。
 *
 * useSkillPipeline=false：跳过 skill 管线强制走标签传播——积木折叠场景专用
 * （analyze_monolith 自行读盘/读库，会把积木内部文件吸进社区 → 黑盒泄漏；
 * 标签传播只吃传入的 files/fileDeps，外部文件集已在调用方过滤干净）。
 */
async function buildFunctionalLayout(
  files: FileEntry[],
  fileDeps: Array<[string, string]>,
  parsed: Map<string, { symbols: ExpectedApi[]; nonFuncSymbols: Symbol[]; imports: ParsedImport[] }>,
  lineCounts: Map<string, number>,
  projectDir: string,
  genNames: boolean,
  cacheDb?: Database,
  useSkillPipeline = true,
): Promise<{ nodes: Node[]; edges: Edge[]; semanticFiles: SemanticFile[]; size: { w: number; h: number } }> {
  const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  const moduleId = (cid: number): string => `func_${cid}`; // ★ 前缀登记在 SCANNED_ID_PREFIXES

  // 0. skill 级：复用 analyze_monolith（锚点驱动社区）+ derive_feature_tree（LLM 归并业务功能）
  if (useSkillPipeline) {
    try {
      const { analyzeMonolith } = await import('../analysis/structure/analyze_monolith.js');
      const mono = analyzeMonolith({ project_dir: projectDir, db: cacheDb });
      if (mono.communities.length > 0) {
        return await buildFromMonolith(mono, projectDir, parsed, lineCounts, genNames, sanitize, moduleId, cacheDb);
      }
    } catch {
      // 无 cache.db / node:sqlite 不可用 → 回退自包含标签传播
    }
  }

  // 1. 社区检测
  const rawCommunities = communityDetectFiles(files, fileDeps);

  // 2. 合并孤立单文件社区（按顶层目录归并）
  const edgeFiles = new Set<string>();
  for (const [a, b] of fileDeps) {
    edgeFiles.add(a);
    edgeFiles.add(b);
  }
  const merged = new Map<number, string[]>();
  const fileToMerged = new Map<string, number>();
  const dirToMerged = new Map<string, number>();
  let nextId = 0;
  for (const rels of rawCommunities.values()) {
    const isIsolated = rels.length === 1 && !edgeFiles.has(rels[0]);
    if (!isIsolated) {
      merged.set(nextId, rels);
      rels.forEach((r) => fileToMerged.set(r, nextId));
      nextId++;
      continue;
    }
    const r = rels[0];
    const top = r.includes('/') ? r.split('/')[0] : '(根)';
    let m = dirToMerged.get(top);
    if (m === undefined) {
      m = nextId++;
      merged.set(m, []);
      dirToMerged.set(top, m);
    }
    merged.get(m)!.push(r);
    fileToMerged.set(r, m);
  }
  // 清理空 bucket（兜底）
  for (const [id, rels] of [...merged]) if (rels.length === 0) merged.delete(id);

  // 3. 先聚合社区间依赖边（跨社区的文件依赖）——布局需要真实边才能分列排布
  const agg = new Map<string, { from: string; to: string; n: number }>();
  for (const [fromRel, toRel] of fileDeps) {
    const a = fileToMerged.get(fromRel);
    const b = fileToMerged.get(toRel);
    if (a === undefined || b === undefined || a === b) continue;
    const key = `${a}|${b}`;
    const cur = agg.get(key);
    if (cur) cur.n++;
    else agg.set(key, { from: moduleId(a), to: moduleId(b), n: 1 });
  }
  const aggDeps: Array<[string, string]> = [...agg.values()].map(({ from, to }) => [from, to]);

  // 4. 布局：每个功能模块一个 item，带社区依赖边做拓扑分列（避免单列纵排高塔）
  const items: LayoutItem[] = [];
  const moduleMeta = new Map<number, { rels: string[] }>();
  for (const [cid, rels] of merged) {
    items.push({ id: moduleId(cid), w: FILE_W * Math.min(rels.length, 3), h: FILE_H, x: 0, y: 0 });
    moduleMeta.set(cid, { rels });
  }
  const content = layoutGroup(items, aggDeps);
  const contentW = content.w + PAD * 2;
  const contentH = content.h + PAD * 2 + TITLE_H;

  // 5. 生成功能模块节点 + 语义层；同名社区（同顶层目录）用消歧符区分
  const baseNameCount = new Map<string, number>();
  for (const item of items) {
    const cid = Number(item.id.replace(/^func_/, ''));
    const b = communityNameOf(moduleMeta.get(cid)!.rels);
    baseNameCount.set(b, (baseNameCount.get(b) ?? 0) + 1);
  }
  const nodes: Node[] = [];
  const semanticFiles: SemanticFile[] = [];
  for (const item of items) {
    const cid = Number(item.id.replace(/^func_/, ''));
    const meta = moduleMeta.get(cid)!;
    const containerW = item.w + PAD * 2;
    const containerH = FILE_H + PAD * 2 + TITLE_H;
    const x = item.x + MARGIN - PAD;
    const y = item.y + MARGIN - PAD;
    const apis: ExpectedApi[] = [];
    const nonFuncSymbols: Symbol[] = [];
    for (const r of meta.rels) {
      const p = parsed.get(r);
      if (p) {
        apis.push(...p.symbols.slice(0, 50 - apis.length));
        nonFuncSymbols.push(...p.nonFuncSymbols);
      }
    }
    const base = communityNameOf(meta.rels);
    const label = baseNameCount.get(base)! > 1
      ? `🧩 ${base} · ${communityQualifier(meta.rels)}`
      : `🧩 ${base}`;
    nodes.push({
      id: moduleId(cid),
      label,
      x: Math.round(x),
      y: Math.round(y),
      width: containerW,
      height: containerH,
      type: 'module',
      // ★★★ 2026-10-09（T93）：聚合体的摘要改挂**它自己的几何节点** ⇒ 写进 `title`
      //   （`geometry.ts:124`：「人话主标题…渲染端优先展示，label 兜底」）。
      //   ★ 为什么**不再** `semanticFiles.push`：契约 `semantic.ts:67` 规定 `SemanticFile.path` 是
      //     **单个目标文件相对路径**（单数）；而这是**功能聚合（模块）节点**，只能填 `meta.rels.join(', ')`
      //     （成员列表拼串）⇒ 违约。实害：下游把这逗号串**当路径读源码**（`derive_chain` /
      //     `consistency_check` 实测硬失败）。
      title: `${base} — 聚合 ${meta.rels.length} 个文件 / ${apis.length + nonFuncSymbols.length} 个符号`,
      style: { ...DIR_STYLE, borderRadius: 8 },
    });
  }

  // 6. 组装社区间依赖边（按 id 排序保证确定性）
  const edges: Edge[] = [];
  const sorted = [...agg.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  for (const { from, to, n } of sorted) {
    edges.push({
      id: `dep_${sanitize(from)}_${sanitize(to)}`,
      from,
      to,
      label: n > 1 ? `imports ×${n}` : 'imports',
      type: 'dashed',
      style: n > 3 ? { strokeWidth: 2 } : undefined,
    });
  }

  return { nodes, edges, semanticFiles, size: { w: contentW, h: contentH } };
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

/** ParsedSymbol.kind 到 Symbol.kind 的映射（仅非函数类） */
function parsedKindToSymbolKind(kind: string): Symbol['kind'] {
  switch (kind) {
    case 'class': return 'class';
    case 'interface': return 'interface';
    case 'type': return 'type';
    default: return 'type';
  }
}

/** 汇总目录下所有符号和 API */
function aggregateDirSymbols(
  dir: string,
  files: FileEntry[],
  parsed: Map<string, { symbols: ExpectedApi[]; nonFuncSymbols: Symbol[]; imports: ParsedImport[] }>,
): { apis: ExpectedApi[]; nonFuncSymbols: Symbol[] } {
  const apis: ExpectedApi[] = [];
  const nonFuncSymbols: Symbol[] = [];
  for (const f of files) {
    const p = parsed.get(f.rel);
    if (p) {
      // 每个目录最多保留 50 API，避免过大
      apis.push(...p.symbols.slice(0, 50 - apis.length));
      nonFuncSymbols.push(...p.nonFuncSymbols);
    }
  }
  return { apis, nonFuncSymbols };
}

export async function importProject(input: ImportProjectInput): Promise<ImportProjectResult> {
  const { feature, max_files = 200, include_tests = false, include_docs = false } = input;
  // ★ T88：文档节点收了几篇（只在 include_docs 时非空；★ 必须声明在**函数体层**，
  //   因为"收集"与"拼 message"在**两个不同的块**里 —— 块内声明块外读不到，我第一版就栽在这)
  let docNote: string | null = null;
  const root = path.resolve(input.project_dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`project_dir 不存在或不是目录: ${root}`);
  }

  // 摩擦 H 修复：live 快照刷新跟随设计 DSL 的测试包含情况——live_only 且未显式
  // 指定 include_tests 时，若已有设计视图含测试文件，则默认也含测试，避免与设计
  // 视图 diff 时误报"测试文件被删除"（此前 live_only 默认 false 覆盖了含测试的 live）。
  // 注意：仅 input.include_tests === undefined 才跟随；显式传 true/false 都尊重显式设置。
  let effectiveIncludeTests = include_tests;
  if (input.live_only && input.include_tests === undefined) {
    const existing = getDSL(feature);
    if (existing?.semantic?.files?.some((f) => TEST_FILE_RE.test(f.path ?? ''))) {
      effectiveIncludeTests = true;
    }
  }

  // 1. 扫描文件（被 gitignore 的一律不扫——references/_archive/缓存等参考堆不进来）
  const gitignore = collectGitignore(root);
  let absFiles = walkFiles(root, effectiveIncludeTests, input.include_archive ?? false, gitignore);
  const skipped: string[] = [];
  // 截断前的完整列表——pruneDeletedFiles 的比对基准（拿截断后列表会误删）
  const walkedAll = absFiles;
  if (absFiles.length > max_files) {
    skipped.push(`超出 max_files=${max_files}，跳过 ${absFiles.length - max_files} 个文件`);
    absFiles = absFiles.slice(0, max_files);
  }
  if (absFiles.length === 0) {
    throw new Error(`未找到可解析的源文件（支持 .go/.ts/.js/.py 等，需已安装对应 tree-sitter 语言包）`);
  }

  const files: FileEntry[] = absFiles.map((abs) => {
    const rel = toPosix(path.relative(root, abs));
    return { rel, abs, ext: path.extname(abs), dir: path.posix.dirname(rel) };
  });
  const index = buildIndex(files);
  for (const c of index.collisions) skipped.push(`同名碰撞: ${c}`);
  const goModules = readGoModules(root);

  // 2. 解析符号 + import（顺带统计行数，零成本复用已读内容做单文件监控）
  const parsed = new Map<string, { symbols: ExpectedApi[]; nonFuncSymbols: Symbol[]; imports: ParsedImport[] }>();
  const lineCounts = new Map<string, number>();
  let symbolsFound = 0;
  let cacheStats: { hits: number; reparsed: number; failed: number } | undefined;

  /** 局部闭包/辅助函数判定：kernel 已打 is_closure 标记（CachedSymbol.is_closure 为 0/1，ParsedSymbol.is_closure 为 boolean）。 */
  function isClosureSymbol(s: { is_closure?: boolean | number | null }): boolean {
    return Boolean(s.is_closure);
  }

  /** 两条路径共用的收录逻辑：50 上限截断 + 分离非函数符号 + 计数 + 登记 */
  const ingest = (rel: string, syms: Array<{ kind: string; name: string; signature: string | null; start_line: number; end_line: number; is_closure?: boolean | number | null }>, imps: ParsedImport[]): void => {
    const funcApis: ExpectedApi[] = [];
    const nonFuncSymbols: Symbol[] = [];
    for (const s of syms) {
      // 局部闭包/辅助函数（is_closure）不进设计契约面：它们是函数体内的内部 helper /
      // 顶层绑闭包的辅助变量，不是对外 API。留着会让 diff 把"，局部符号漂移"误判成冲突。
      // 但 cache.db 里仍保留该符号（供搜索/引用）。
      if (isClosureSymbol(s)) continue;
      if (s.kind === 'function' || s.kind === 'method') {
        // 每文件 API 上限 50，超出记注（防止巨型生成文件撑爆 DSL）
        if (funcApis.length < 50) {
          funcApis.push({
            signature: s.signature ?? s.name,
            line: s.start_line,
            end_line: s.end_line,
            notes: `L${s.start_line}-${s.end_line}`,
          });
        }
      } else {
        // 非函数符号（class/interface/type）——无数量限制，数量通常远少于函数
        nonFuncSymbols.push({
          name: s.name,
          kind: parsedKindToSymbolKind(s.kind),
          line: s.start_line,
          end_line: s.end_line,
          signature: s.signature ?? undefined,
        });
      }
    }
    if (syms.length > 50) {
      skipped.push(`${rel}: 符号数 ${syms.length} 超上限，仅收录前 50 个 API`);
    }
    symbolsFound += funcApis.length;
    parsed.set(rel, { symbols: funcApis, nonFuncSymbols, imports: imps });
  };

  if (input.cache_db) {
    // 缓存路径：syncProject 内部按 content_hash 增量——未变更文件不重解析，
    // 随后从 cache.db 读回符号与原始 import（含 Go 包路径 / Python 点分模块）
    const db = input.cache_db;
    const sync = await syncProject(db, root, absFiles);
    cacheStats = { hits: 0, reparsed: 0, failed: 0 };
    // 删除侦测：清掉磁盘上已不存在的文件的缓存行（比对基准是截断前完整列表）
    const pruned = pruneDeletedFiles(db, root, walkedAll);
    if (pruned.length > 0) {
      skipped.push(
        `缓存清理: ${pruned.length} 个文件已从磁盘删除（${pruned.slice(0, 3).join(', ')}${pruned.length > 3 ? ' 等' : ''}）`,
      );
    }
    const byPath = new Map(sync.results.map((r) => [r.path, r]));
    for (const f of files) {
      const r = byPath.get(f.rel);
      const cached = r && r.status !== 'failed' ? getFileParse(db, f.rel) : null;
      if (!r || r.status === 'failed' || !cached) {
        // 解析失败 = 静默丢依赖边 + 空 API 面，必须在结果中可见（区别于"文件本为空"）
        // 缓存侧不写 files 行，下次运行自动重试
        cacheStats.failed++;
        skipped.push(`解析失败: ${f.rel}（${r?.error || '缓存读取异常'}），该文件的依赖边与 API 缺失`);
        parsed.set(f.rel, { symbols: [], nonFuncSymbols: [], imports: [] });
        continue;
      }
      if (r.status === 'skipped') cacheStats.hits++;
      else cacheStats.reparsed++;
      lineCounts.set(f.rel, cached.line_count);
      ingest(f.rel, cached.symbols, cached.imports);
    }
  } else {
    for (const f of files) {
      let content: string;
      try {
        content = fs.readFileSync(f.abs, 'utf-8');
      } catch {
        skipped.push(`读取失败: ${f.rel}`);
        continue;
      }
      lineCounts.set(f.rel, countLines(content));
      const full = await parseFileFull(f.abs, content);
      // 解析失败 = 静默丢依赖边 + 空 API 面，必须在结果中可见（区别于"文件本为空"）
      if (full.error) {
        skipped.push(`解析失败: ${f.rel}（${full.error}），该文件的依赖边与 API 缺失`);
      }
      ingest(f.rel, full.symbols, full.imports);
    }
  }

  // 3. 依赖边（文件级，去重，去自环）
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const fileRelSet = new Set(byRel.keys());
  const depEdgeSet = new Set<string>();
  const fileDeps: Array<[string, string]> = [];
  for (const f of files) {
    const p = parsed.get(f.rel);
    if (!p) continue;
    for (const imp of p.imports) {
      // TS `import type` 运行时擦除——不算依赖边（与 syncFile/import_graph 同一纪律）
      if (imp.type_only) continue;
      const targets = resolveImport(imp, f, index, goModules);
      for (const t of targets) {
        if (t.rel === f.rel) continue;
        // 防止悬空边：max_files 截断后目标文件不在当前文件集，跳过（无节点则无合法边）
        if (!fileRelSet.has(t.rel)) continue;
        const key = `${f.rel}|${t.rel}`;
        if (depEdgeSet.has(key)) continue;
        depEdgeSet.add(key);
        fileDeps.push([f.rel, t.rel]);
      }
    }
  }

  // 实测依赖索引：fromRel → [toRel]（回填到 semantic.files[].actual_deps，语义层持有真实 import 事实）
  const depsByFrom = new Map<string, string[]>();
  for (const [fr, to] of fileDeps) {
    if (!depsByFrom.has(fr)) depsByFrom.set(fr, []);
    depsByFrom.get(fr)!.push(to);
  }

  // ── 3.5 节点 ID（须在 functional_mode / 目录树 / 边聚合前）──
  const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileNodeId = (rel: string): string => `file_${sanitize(rel)}`; // ★ 前缀登记在下面 SCANNED_ID_PREFIXES
  const dirNodeId = (rel: string): string => `dir_${sanitize(rel)}`; // ★ 同上
  /** 设计模式下：返回文件所属的顶级目录节点 ID（root 的直接子目录） */
  const topDirNodeId = (rel: string): string => {
    const slash = rel.indexOf('/');
    if (slash === -1) return dirNodeId(''); // 根目录文件，聚合到根
    return dirNodeId(rel.slice(0, slash));
  };

  /**
   * ★★★ **本次扫描能产出哪些 id 前缀** —— ★ **唯一住处**。
   *
   * ## 为什么立它（2026-10-09 真跑复现的一个活缺陷）
   * "重建会抹掉哪些节点"那道闸（本文件下方 `nonScanned`）问的是**"这个 id 是不是本次扫描产得出的"**。
   * 它原先用 `/^(dir|file)_/` 回答 —— 那是**用"是不是目录/文件"去回答"是不是扫描产物"**，
   * 两者**根本不是一个问题**。而 id 前缀这件事原先住在**两处**（四个生成器 ←→ 那道正则），
   * T88 加了 `doc_`（文档节点）之后**没人去改正则** ⇒ **`doc_*` 被当成"人手加的节点"**，
   * 真跑复现：`拒绝重建设计 DSL：会抹掉 1 个"扫描产不出的"节点（多半是人手加的）：· doc_docs_todo_md`
   * —— 那句提示还建议"先手工把它们记进设计"，**对一个文档节点完全不知所云**。
   *
   * ## 不变式（★ 加新前缀必须同时做两件事）
   * ① 把前缀加进本集合；② 在生成它的那行加一句 `★ 前缀登记在 SCANNED_ID_PREFIXES` 注释。
   * ★ **判据（可机检）**：源码里所有 `` `<x>_${…}` `` 形式的 id 模板，其前缀 ⊆ 本集合。
   *   （当前实测：`file_`[本文件 :1251 与 `impact/diff_impact.ts:158`] · `dir_`[:1252] ·
   *     `func_`[:905] · `doc_`[:1803] —— 四种，全在下面。）
   */
  const SCANNED_ID_PREFIXES = ['file_', 'dir_', 'func_', 'doc_'] as const;
  const isScannedNodeId = (id: string): boolean => SCANNED_ID_PREFIXES.some((p) => id.startsWith(p));

  const plainDeps: Array<[string, string]> = [...fileDeps];

  // 6.0 布局/语义产出（目录路径用；functional_mode 提前产出并返回）
  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let semanticFiles: SemanticFile[] = [];
  let rootSize: { w: number; h: number } = { w: 0, h: 0 };
  let renderedDepEdges = 0;

  /** 共享收尾：组装 DSL → 分层 → 可选职责标题 → 落盘 → 报告 */
  const finalizeDsl = async (): Promise<ImportProjectResult> => {
    // ★★★ 2026-10-09（T93）：**"本 feature 有哪些文件"只此一份** —— 扫描出来的 `files`。
    //   · 此前有**两把尺**：`scope_files`（下面 return）用**扫描的 files**，而基线事实（T85/D2）
    //     却从 `semantic.files` 过滤取 ⇒ 聚合体一退出语义层（本文件 3 处 T93 改动），
    //     functional_mode / design_mode 的语义层为空 ⇒ 基线事实锚 **0 个文件** ⇒ **对拍没有基准**。
    //   · ⇒ 两处**共用这一份** `scopeRels`（单一事实源；判据不许分叉）。
    const scopeRels = files.map((f) => f.rel);
    const canvasW = Math.round(rootSize.w + MARGIN * 2);
    const canvasH = Math.round(rootSize.h + MARGIN * 2 + TITLE_H);
    const dsl: DesignDSL = {
      id: `imported_${feature}`,
      type: 'feature_diagram',
      feature,
      version: '1.0.0',
      title: input.title || feature,
      source_root: input.source_root ?? input.project_dir,
      status: 'done',
      geometry: {
        layout: 'free',
        width: Math.max(canvasW, 800),
        height: Math.max(canvasH, 400),
        nodes,
        edges,
      },
      semantic: { files: semanticFiles },
    } as DesignDSL;

    const layered = detectArchLayers(dsl);

    let roleNote: string | null = null;
    // ★ T85/D2：基线事实锚定的结果（**写了什么、有没有写失败，都要能报出来**）
    let baselineFactsNote: string | null = null;
    let overlayNote: string | null = null;
    // ★ T77：重建时"丢掉了哪些扫描产不出的节点"——**丢了就要说**，不许静默（空 = 没丢）
    let designDropNote: string | null = null;
    /** ★ T77：本次对"设计"做了什么 —— **必须写出来**，否则用户不知道设计有没有被动过 */
    let designAction = '';
    // ★★★ 2026-10-09（T75）：**合并与落盘挪到流程末尾**（见下面 `saveDSL(designDsl)` 那处）。
    //   原因：这里曾经"合并 + `saveDSL(designDsl)`"一次，**末尾又 `saveDSL(layered)` 一次**
    //   ⇒ 第二次用**未合并的 base 覆盖**了合并结果 ⇒ **overlay 里的决策/意图全被冲掉**。
    //   实测症状：`edit_dsl` 写了决策卡 ⇒ 跑一次 `import_project` ⇒ **决策卡不见**（overlay 还在，base 没了）。
    //   ★ 另外把合并放末尾还修掉一个隐患：`gen_roles` 会改 `layered`（给节点加职责标题），
    //     先合并会把标题丢掉（合并产物不含后续改动）。
    //   ⇒ 所以 base 的落盘统一到流程末尾一次（见下面）；★ 2026-10-09 顺手删掉了这里那个
    //     `if (live_only) saveLiveFeature … else saveLiveFeature …` 的块 ——
    //     **两个分支干的事一模一样**，纯冗余（也正是"两处落盘"这个病的残余）。

    if (input.gen_roles) {
      // ★★★ 2026-10-09（T93 round2）：**喂 LLM 的"条目键"与回填标题时的"查找键"必须是同一口径**（抽在此处一处）。
      //   · 文件节点：`description` 即文件相对路径（`import_project.ts` 写文件节点时落的）；
      //   · 目录聚合节点：id = `dir_<sanitized rel>` ⇒ 反推 rel；
      //   · 功能聚合节点：id = `func_<cid>`（聚合社区**无单一路径**）⇒ 取 id（不硬造路径）。
      const roleRelOf = (n: Node): string =>
        n.description || (n.id.startsWith('dir_') ? n.id.replace(/^dir_/, '').replace(/_/g, '/') : n.id);
      // ★★★ 2026-10-09（T93 round2）：聚合模式（design/functional）**渲染的就是模块节点** ⇒ 喂 LLM 的正是这些节点。
      //   ★ 出生证（实测）：这里**曾经**读 `semantic.files`（含聚合/目录条目，`sf.path!.endsWith('/')` 剥尾斜杠）；
      //     T93 后语义层**只放文件**（契约 `semantic.ts:67`）、design_mode / functional_mode 的语义层**为空**
      //     （实测 `semantic.files = 0 条`，见 J 报告）⇒ 原分支恒产出 `[]`、剥尾斜杠**永不执行** = **死分支** ⇒ 删。
      //   ★ 但聚合模式的职责标题**不能因此消失**：改从**几何模块节点**取（单一事实源：渲染什么、就从什么取），
      //     与下游 `for (const n of nodes)` 回填用**同一个 `roleRelOf`**（杜绝两把尺）。
      const roleFiles = input.design_mode || input.functional_mode
        ? nodes
            .filter((n) => n.type === 'module')
            .map((n) => {
              const rel = roleRelOf(n);
              return { path: rel, dir: rel || '根', apis: [] as string[] };
            })
        : files
            .map((f) => ({
              path: f.rel,
              dir: f.dir === '.' ? '根' : f.dir,
              apis: (parsed.get(f.rel)?.symbols ?? []).map((s) => s.signature),
            }));
      const titles = await generateFileRoleTitles(roleFiles);
      if (Object.keys(titles).length > 0) {
        for (const n of nodes) {
          if (n.type !== 'file' && n.type !== 'module') continue;
          // 与上面 `roleFiles[].path` **同一口径**（`roleRelOf`）
          const searchRel = roleRelOf(n);
          const t = titles[searchRel];
          if (t) {
            // ★★★ 2026-10-09（T93 round2）：LLM 职责标题的**唯一家 = `node.title`**（`geometry.ts:124`
            //   「人话主标题…渲染端优先展示，label 兜底」）。★ 为什么**不再**同时写进 `semantic.files[].responsibility`：
            //   `title` 已有自己的字段、读者也优先读它（`query_feature` / `export` / `scaffold` / `derive_mind_map` 等）——
            //   再把同一段标题塞进 `responsibility` = **同一内容两处**（本仓头号病，判据分叉的温床）。
            n.title = t;
          }
        }
        roleNote = `职责标题 ${Object.keys(titles).length} 个（LLM 生成）`;
      } else {
        roleNote = '职责标题未生成（未配置 LLM 或调用失败，仅显示文件名）';
      }
    }

    // ★★★ 2026-10-09（T77，用户裁定"翻"）：**默认永不破坏** ——
    //   规则只有一条，对应用户原话：*"有的话就不用动了，就只需要对比就可以。"*
    //     · **设计不存在** ⇒ 默认**建**（= 从实际 fork 一份；**没东西可丢**，所以不算破坏）；
    //     · **设计已存在** ⇒ 默认**只刷新"实际"，完全不碰设计**（要重建必须显式 `rebuild_design=true`）。
    //   ⇒ 于是**用户不必记任何开关**：默认永远安全；想重写设计时才显式一次。
    //   ★ `live_only` 保留它原有的两个取值语义（true=只实际 / false=写设计），只是**缺省**变了
    //     ⇒ 下游若显式传 `live_only:false`，行为与从前一致（不静默改人意思）。
    const designExists = !!getDSL(layered.feature);
    if (input.live_only === true && input.rebuild_design === true) {
      throw new Error(
        '参数矛盾：`live_only=true`（只要"实际"，不动设计）与 `rebuild_design=true`（要重建设计）**不能同时给**。' +
          '请只给一个 —— 刻意不替你在两者之间选。',
      );
    }
    let wantsDesign: boolean;
    if (input.live_only === true) wantsDesign = false; // 显式：只要实际
    else if (input.live_only === false) wantsDesign = true; // 显式：写设计（兼容旧语义）
    else if (input.rebuild_design === true) wantsDesign = true; // 显式：重建
    else wantsDesign = !designExists; // ★ 默认：没设计就 fork 一份；有设计就**不动**

    if (!wantsDesign) {
      // 只刷新"实际"：设计被完整保住
      designAction = '（★ 本次**只刷新了"实际"**：设计 DSL 未被触碰 —— 这就是"有设计就不动、只对比"）';
      saveLiveFeature(layered, input.live_dir);
    } else {
      // ★★★ 2026-10-09（T77 落地）：**重建设计会抹掉"扫描产不出"的节点** ⇒ 先算差集，非空就**拒绝**。
      //   为什么必须拦：实测（2026-10-09）手工 `edit_dsl` 加的节点 `node_manual_1` 一重建就**消失**，
      //   且 overlay 里**毫无痕迹** —— 因为 `user_nodes` 是"新功能构想"，**代码里没有"人手加的结构"的登记处**。
      //   ★ 判据：**"扫描产不出"= 旧 base 里有、而本次扫描结果里没有、且 id 不是扫描命名 `dir_`/`file_` 的节点**。
      //     ⇒ 「文件被删掉」这种**合法**消失不会被误拦（它的 id 是 `file_`）。
      //   ★ 破坏性操作**不该是默认且静默**的（本仓先例：`archive` 拒重复归档、`split_stage` 默认 dry-run）。
      //   ⇒ 要真重建，显式给 `allow_design_drop=true`，并且**丢掉了什么会被报出来**。
      const prevDesign = getDSL(layered.feature);
      if (prevDesign) {
        const nextIds = new Set((layered.geometry?.nodes ?? []).map((n) => n.id));
        const nonScanned = (prevDesign.geometry?.nodes ?? [])
          .map((n) => n.id)
          // ★★ 判据住一处：`isScannedNodeId`（前缀集合在 `SCANNED_ID_PREFIXES`）。
          //   此前这里是 `/^(dir|file)_/` —— 用"是不是目录/文件"回答"是不是扫描产物"，
          //   于是 T88 新加的 `doc_*` 被误判成"人手加的"（真跑复现见该常量注释）。
          .filter((id) => !isScannedNodeId(id));
        const willDrop = nonScanned.filter((id) => !nextIds.has(id)).sort();
        if (willDrop.length && input.allow_design_drop !== true) {
          throw new Error(
            `拒绝重建设计 DSL：本次重建会**抹掉 ${willDrop.length} 个"扫描产不出的"节点**（多半是人手加的）：\n` +
              willDrop.slice(0, 20).map((id) => `  · ${id}`).join('\n') +
              (willDrop.length > 20 ? `\n  …另有 ${willDrop.length - 20} 个` : '') +
              `\n⇒ 三选一：① 只想刷新"实际"、不动设计 ⇒ 传 \`live_only=true\`（**设计会被完整保住**）；` +
              `② 确定要放弃这些节点 ⇒ 传 \`allow_design_drop=true\`；` +
              `③ 想留住它们 ⇒ 先手工把它们记进设计（或等"人手结构的登记处"落地）。`,
          );
        }
        if (willDrop.length) {
          designDropNote = `★ 本次重建**丢掉了 ${willDrop.length} 个扫描产不出的节点**（已显式允许）：${willDrop.slice(0, 10).join(', ')}${willDrop.length > 10 ? ' …' : ''}`;
        }
      }
      // ★★★ 2026-10-09（T75）：**base 只在这里落一次盘，且必须落"合并后"的那份**。
      //   设计层 overlay 增量保留：真相刷新只替换 base，设计意图（决策/标注/user_node/分镜）
      //   按稳定锚点保留/迁移/孤儿/标过期（`mergeDesignLayer` 负责）。
      //   ★ 以前这里落的是**未合并的 `layered`**，把上面那次合并整个覆盖掉 ⇒ 决策卡一重建就丢。
      const { dsl: designDsl, message: ovMsg } = mergeDesignLayer(layered);
      overlayNote = ovMsg;
      designAction = designExists
        ? '（★ 本次**按你的显式要求重建了设计 DSL**：结构来自扫描 —— 人手加的节点会丢，故受 `allow_design_drop` 把关）'
        : '（★ 设计**原本不存在** ⇒ 本次从"实际"**fork 了一份设计 DSL**；此后默认不再自动重建）';
      saveDSL(designDsl);
      // 同时写入 live 代码快照：功能树聚类（derive_feature_tree）以 live 视图的
      // semantic.files 为语义基准做命中率闸门。手动导入的项目若只有设计 DSL 而无
      // live 快照，换项目后聚类会因语义基准为空被判"db 不相关"而拒生成 → 导图平铺。
      // 导入即落一份 live，保证换项目后功能树可稳定聚类。（live_dir 缺省 = 默认 dataHome，
      // 与 getLiveFeature 默认读取路径一致。）
      saveLiveFeature(layered, input.live_dir);
    }
    // fork 基线：首次导入（无论 live_only 与否）即锚定契约创立时刻的参考基准，
    // 之后 live 随代码演进更新、设计 DSL 随意图演进，二者都相对 baseline 各自前进，
    // diff_views 三方对比据此裁决冲突。ensureBaseline 只在基线缺失时写入，绝不漂移。
    ensureBaseline(layered, input.live_dir);
    // ★★★ 2026-10-09（T85/D2）：**同时锚定「基线事实」—— 对拍的第二份产物**。
    //   用户原话：*"这两个产物没有分开是吗？那要赶紧分开啊……怎么可能对拍还放在同一个里面？
    //   **那这算什么对拍？自己测自己吗？**"*
    //   ⇒ 在此之前只有**一份**（`<feature>.json` 的 `expected_apis`，fork 时从事实复制过去），
    //     而对账拿它当"期望侧" ⇒ **自己跟自己比**。
    //   ★ 本步落的这份**独立取**（`fileFacts` = 索引器的事实，**不读 DSL**），时刻 = fork 那一刻
    //     （刚 `syncProject` 写完索引 ⇒ 索引与源码同期）。
    //   ★ **纯新增**：不改任何现有字段/行为；对账侧（D3）以后再接。
    //   ★★★ 2026-10-09（T93）：此处曾有 `.filter((f) => !f.path.includes(', ') && !f.path.endsWith('/'))`
    //     —— 那是"语义层**混进了聚合/模块节点**"的**绕行判据**（模块的 `path` 是 ", " 拼的成员列表 / 目录名带尾斜杠）。
    //     ★ 出生证（实测）：聚合节点已不再进 `semantic.files`（见本文件 3 处 T93 改动）⇒ 该 filter
    //       **过滤掉 0 条**：默认模式（3 条真文件，全通过）与 functional_mode（0 条）**各一次读数均为 0**。
    //     ⇒ 它已不是判据、是死代码，删（本仓铁律：「没有坏状态就别占正常路径」）。
    //     ★ 现在 `semantic.files` **只放文件**（契约 `semantic.ts:67`）⇒ 其 `path` 恒为单个文件相对路径。
    //   ★★★ 2026-10-09（T93 round2）：**取数源不再是 `semantic.files`，而是与 `scope_files` 同一份
    //     `scopeRels`（= 扫描出的 `files`）**。★ 为什么必须换：语义层现在只放文件 ⇒ 聚合模式
    //     （functional/design）语义层为空 ⇒ 从它取会锚 **0 个文件**、对拍**没有基准**。
    //     `files` 才是"本 feature 有哪些文件"的权威（`scope_files` 同源，见 `finalizeDsl` 顶部）。
    try {
      const rels = scopeRels;
      const res = saveBaselineFactsIfAbsent(
        layered.feature,
        input.project_dir,
        rels,
        (rel) => {
          const facts = fileFacts(input.project_dir, rel);
          // ★ 只存**签名**（与 `expected_apis[].signature` **同形**）⇒ 对拍时**直接可比**，不需要再翻译。
          //   ★ 签名缺失时回退到 `name`（与 `ingest` 里 `s.signature ?? s.name` 同口径）。
          return {
            apis: (facts.apis ?? []).map((a) => a.signature ?? a.name),
            deps: facts.deps ?? [],
          };
        },
        input.live_dir,
      );
      if (res.written) baselineFactsNote = `基线事实已锚定：${res.files} 个文件 → ${path.basename(res.file)}`;
    } catch (e) {
      // ★ **不许静默**：基线事实写不上 ⇒ 对拍将**没有第二份产物** ⇒ 必须说出来（但不阻断导入本身）
      baselineFactsNote = `⚠ 基线事实**未能锚定**（${(e as Error).message.slice(0, 120)}）⇒ 本 feature 的对拍将缺"第二份产物"`;
    }

    const dirCount = nodes.filter((n) => n.type === 'module').length;
    const oversized = files
      .map((f) => ({ rel: f.rel, lines: lineCounts.get(f.rel) ?? 0 }))
      .filter((x) => assessLines(x.lines) !== 'ok')
      .sort((a, b) => b.lines - a.lines);
    const message = [
      `已导入项目 → feature "${feature}"${input.design_mode ? '（设计模式：聚合文件到目录层级）' : input.functional_mode ? '（功能模式：按调用图社区聚合）' : ''}`,
      `项目根: ${path.resolve(input.project_dir)}`,
      `文件: ${files.length} 个 → ${nodes.length} 节点（符号 ${symbolsFound} 个，依赖 ${fileDeps.length} 条→渲染 ${renderedDepEdges} 条，模块节点 ${dirCount} 个）`,
      cacheStats ? `缓存: 命中 ${cacheStats.hits} / 重解析 ${cacheStats.reparsed} / 失败 ${cacheStats.failed}` : null,
      goModules.length > 0 ? `Go modules: ${goModules.map((g) => g.module).join(', ')}` : null,
      oversized.length > 0
        ? `⚠ 单文件化预警 ${oversized.length} 个:\n  - ${oversized
            .map((x) => `${x.rel}（${x.lines} 行${x.lines >= 600 ? '，严重' : ''}）`)
            .join('\n  - ')}\n  → 运行 check_monolith 获取功能内聚拆分建议`
        : null,
      skipped.length > 0 ? `跳过/截断:\n  - ${skipped.join('\n  - ')}` : null,
      roleNote ? `职责标题: ${roleNote}` : null,
      baselineFactsNote,
      docNote,
      overlayNote ? `设计层 overlay: ${overlayNote}` : null,
      // ★ T77：重建丢掉了什么，**明确报出来**（不静默）
      designDropNote,
      designAction,
      '下一步: render_design 渲染预览，或 get_dsl 查看/修改；对比设计与实际用 consistency_check / diff_views。',
    ].filter(Boolean).join('\n');

    return {
      message,
      feature,
      files_parsed: files.length,
      // ★ 对象类锚点：与 `files_parsed` 同源、不同形（集合 vs 数）。见 `ImportProjectResult.scope_files`。
      //   ★★ 与**基线事实**（上面 T85/D2）**共用同一份 `scopeRels`** —— 单一事实源，杜绝两把尺。
      scope_files: scopeRels,
      symbols_found: symbolsFound,
      dep_edges: fileDeps.length,
      dirs_created: dirCount,
      skipped,
      cache: cacheStats,
    };
  };

  // 6.1 功能模式：按调用图社区做功能性聚合，产出功能模块节点并提前返回
  if (input.functional_mode) {
    const externalFiles = [...files];
    const res = await buildFunctionalLayout(
      externalFiles,
      plainDeps,
      parsed,
      lineCounts,
      input.project_dir,
      !!input.gen_roles,
      input.cache_db,
    );
    nodes = res.nodes;
    edges = res.edges;
    semanticFiles = res.semanticFiles;
    rootSize = res.size;
    renderedDepEdges = res.edges.length;
    return await finalizeDsl();
  }

  // 4. 目录树
  interface DirNode {
    rel: string; // '' 表示项目根
    name: string;
    subdirs: Map<string, DirNode>;
    files: FileEntry[];
    /** 子树文件数（含自身文件 + 所有后代目录文件） */
    subtreeSize: number;
  }
  const rootDir: DirNode = { rel: '', name: path.basename(root), subdirs: new Map(), files: [], subtreeSize: 0 };
  const dirByRel = new Map<string, DirNode>([['', rootDir]]);
  const ensureDir = (rel: string): DirNode => {
    const existing = dirByRel.get(rel);
    if (existing) return existing;
    const parentRel = path.posix.dirname(rel);
    const parent = ensureDir(parentRel === '.' ? '' : parentRel);
    const d: DirNode = { rel, name: path.posix.basename(rel), subdirs: new Map(), files: [], subtreeSize: 0 };
    parent.subdirs.set(rel, d);
    dirByRel.set(rel, d);
    return d;
  };
  for (const f of files) {
    ensureDir(f.dir === '.' ? '' : f.dir).files.push(f);
  }
  // 子树文件数自底向上统计（目录排序用）
  const computeSubtree = (d: DirNode): number => {
    let n = d.files.length;
    for (const sub of d.subdirs.values()) n += computeSubtree(sub);
    d.subtreeSize = n;
    return n;
  };
  computeSubtree(rootDir);

  // 5. 节点 ID 生成器已上移至 3.5（functional_mode 分支亦用）

  // 6. 布局（后序：先内层目录，尺寸向上传递）
  // 注：nodes/edges/semanticFiles 已在 6.0 声明为外层可变量，此处沿用

  /** 收集子树下所有文件（递归） */
  const collectSubtreeFiles = (d: DirNode): FileEntry[] => {
    const result = [...d.files];
    for (const sub of d.subdirs.values()) {
      result.push(...collectSubtreeFiles(sub));
    }
    return result;
  };

  /** 布局一个目录，返回其容器尺寸（根目录不生成容器节点） */
  const layoutDir = (dir: DirNode): { w: number; h: number } => {
    const items: LayoutItem[] = [];
    const localDeps: Array<[string, string]> = [];

    // 设计模式：聚合子文件到当前目录节点，不生成单个文件节点
    if (input.design_mode && dir.rel !== '') {
      // 在 design_mode 下，整个目录只生成一个模块节点，不需要展开子文件
      items.push({ id: dirNodeId(dir.rel), w: FILE_W * Math.min(dir.subtreeSize, 3), h: FILE_H, x: 0, y: 0 });
    } else {
      // 子目录先布局（递归），获得尺寸后作为 item
      const subdirOrder = (a: DirNode, b: DirNode): number => {
        const aIsEntry = a.files.some((f) => /main|index|server|app\./i.test(f.rel));
        const bIsEntry = b.files.some((f) => /main|index|server|app\./i.test(f.rel));
        if (aIsEntry !== bIsEntry) return aIsEntry ? -1 : 1;
        return b.subtreeSize - a.subtreeSize;
      };
      for (const sub of [...dir.subdirs.values()].sort(subdirOrder)) {
        const size = layoutDir(sub);
        items.push({ id: dirNodeId(sub.rel), w: size.w, h: size.h, x: 0, y: 0 });
      }
      // 文件节点（排序：入口文件优先，其余按行数降序）
      const fileOrder = (a: FileEntry, b: FileEntry): number => {
        const aIsEntry = /main|index|server|app\./i.test(a.rel);
        const bIsEntry = /main|index|server|app\./i.test(b.rel);
        if (aIsEntry !== bIsEntry) return aIsEntry ? -1 : 1;
        return (lineCounts.get(b.rel) ?? 0) - (lineCounts.get(a.rel) ?? 0);
      };
      if (!input.design_mode) {
        for (const f of [...dir.files].sort(fileOrder)) {
          items.push(fileLayout.get(f.rel)!);
        }
      }
      // 局部依赖：两端都在本目录直接子级
      const ownerOf = (rel: string): string => {
        if (dir.files.some((f) => f.rel === rel)) return fileNodeId(rel);
        for (const sub of dir.subdirs.keys()) {
          if (rel.startsWith(sub + '/')) return dirNodeId(sub);
        }
        return '';
      };
      for (const [fromRel, toRel] of plainDeps) {
        const a = ownerOf(fromRel);
        const b = ownerOf(toRel);
        if (a && b && a !== b) localDeps.push([a, b]);
      }
      const content = layoutGroup(items, localDeps);

      // 写回子项局部坐标
      for (const item of items) {
        if (item.id.startsWith('file_')) {
          const rel = files.find((f) => fileNodeId(f.rel) === item.id)!.rel;
          fileLayout.get(rel)!.x = item.x;
          fileLayout.get(rel)!.y = item.y;
        } else {
          const subRel = [...dirByRel.values()].find((d) => d.rel !== '' && dirNodeId(d.rel) === item.id)!.rel;
          dirOffset.set(subRel, { x: item.x, y: item.y });
        }
      }

      const containerW = content.w + PAD * 2;
      const containerH = content.h + PAD * 2 + TITLE_H;
      if (dir.rel !== '') {
        nodes.push({
          id: dirNodeId(dir.rel),
          label: `📁 ${dir.name}`,
          x: 0,
          y: 0,
          width: containerW,
          height: containerH,
          type: 'module',
          style: { ...DIR_STYLE, borderRadius: 8 },
        });
      }
      dirContentOffset.set(dir.rel, { dx: PAD, dy: PAD + TITLE_H, w: containerW, h: containerH });
      return { w: containerW, h: containerH };
    }

    // ── 设计模式非根目录：单个模块节点，聚合摘要挂到**节点 title**（T93：不再进语义层） ──
    const subtreeFiles = collectSubtreeFiles(dir);
    const { apis, nonFuncSymbols } = aggregateDirSymbols(dir.rel, subtreeFiles, parsed);
    const itemW = FILE_W * Math.min(dir.subtreeSize, 3);
    const containerW = itemW + PAD * 2;
    const containerH = FILE_H + PAD * 2 + TITLE_H;
    nodes.push({
      id: dirNodeId(dir.rel),
      label: `📁 ${dir.name}`,
      x: 0,
      y: 0,
      width: containerW,
      height: containerH,
      type: 'module',
      // ★★★ 2026-10-09（T93）：聚合体的摘要改挂**它自己的几何节点** ⇒ 写进 `title`
      //   （`geometry.ts:124`：「人话主标题…渲染端优先展示，label 兜底」）。
      //   ★ 为什么**不再** `semanticFiles.push`：契约 `semantic.ts:67` 规定 `SemanticFile.path` 是
      //     **单个目标文件相对路径**（单数）；而这是**目录聚合节点**，只能填 `dir.rel + '/'`
      //     ⇒ 违约。实害：下游把这目录串**当路径读源码**（`derive_chain` / `consistency_check`）。
      title: `${dir.rel} — 聚合 ${apis.length + nonFuncSymbols.length} 个符号`,
      style: { ...DIR_STYLE, borderRadius: 8 },
    });
    dirContentOffset.set(dir.rel, { dx: PAD, dy: PAD + TITLE_H, w: containerW, h: containerH });
    return { w: containerW, h: containerH };
  };

  const fileLayout = new Map<string, LayoutItem>();
  if (!input.design_mode) {
    for (const f of files) {
      fileLayout.set(f.rel, { id: fileNodeId(f.rel), w: FILE_W, h: FILE_H, x: 0, y: 0 });
    }
  }

  const dirContentOffset = new Map<string, { dx: number; dy: number; w: number; h: number }>();
  const dirOffset = new Map<string, { x: number; y: number }>();

  // 根级布局：把根目录当作一个组（不生成根容器）
  rootSize = layoutDir(rootDir);

  // 7. 汇总坐标：自根向下累加
  const accumulate = (dirRel: string, baseX: number, baseY: number): void => {
    const d = dirByRel.get(dirRel)!;
    const selfOff = dirOffset.get(dirRel) || { x: 0, y: 0 };
    const content = dirContentOffset.get(dirRel)!;
    const containerX = baseX + selfOff.x;
    const containerY = baseY + selfOff.y;
    const contentX = dirRel === '' ? containerX : containerX + content.dx;
    const contentY = dirRel === '' ? containerY : containerY + content.dy;
    if (dirRel !== '') {
      const node = nodes.find((n) => n.id === dirNodeId(dirRel))!;
      node.x = containerX;
      node.y = containerY;
    }

    if (input.design_mode && dirRel !== '') {
      // 设计模式非根目录：不处理子文件，也不递归子目录（已聚合到当前目录节点）
    } else {
      if (!input.design_mode) {
        for (const f of d.files) {
          const item = fileLayout.get(f.rel)!;
          item.x += contentX;
          item.y += contentY;
        }
      }
      for (const sub of d.subdirs.values()) {
        accumulate(sub.rel, contentX, contentY);
      }
    }
  };
  accumulate('', MARGIN, MARGIN);

  // 8. 文件节点 + 边 + 语义层（设计模式：每个目录聚合所有子文件符号）
  if (!input.design_mode) {
    for (const f of files) {
      const p = parsed.get(f.rel);
      const apis = p?.symbols || [];
      const syms = p?.nonFuncSymbols || [];
      const item = fileLayout.get(f.rel)!;
      const langKey = f.ext.slice(1);
      const colors = LANG_COLORS[langKey] || DEFAULT_FILE_COLOR;
      const apiCount = apis.length;
      nodes.push({
        id: fileNodeId(f.rel),
        label: `${path.posix.basename(f.rel)} · ${apiCount} APIs`,
        x: Math.round(item.x),
        y: Math.round(item.y),
        width: FILE_W,
        height: FILE_H,
        type: 'file',
        status: 'done',
        description: f.rel,
        style: { ...colors, borderRadius: 4 },
      });
      // 目录归属边
      if (f.dir && f.dir !== '.') {
        edges.push({ id: `contains_${sanitize(f.dir)}_${sanitize(f.rel)}`, from: dirNodeId(f.dir), to: fileNodeId(f.rel), label: 'contains' });
      }
      // 嵌套目录 contains 边
      semanticFiles.push({
        id: fileNodeId(f.rel),
        path: f.rel,
        responsibility: `${f.dir === '.' ? '根目录' : f.dir} — ${apiCount} 个 API（导入自 ${(p?.imports.length || 0)} 个模块）`,
        status: 'done',
        // ★★★ 2026-10-09（T85/D1）：**已摘掉 expected_apis: apis** —— 见上一条同款注释。
        symbols: syms.length > 0 ? syms : undefined,
        lines: lineCounts.get(f.rel) ?? 0,
        // ★ 2026-10-01（T20）：`actual_apis` / `actual_deps` **不再回填进 DSL** ——
        //   事实（真实 import / 真实签名）的唯一权威是解析数据 `cache.db`，
        //   要读请走 `infrastructure/index/file_facts`（DSL 只留 `source_root` 这个"出处"）。
      });
    }
  }

  // ★★★ 2026-10-09（T88）：**文档进 DSL（`type: 'doc'`）** —— 让"文档"成为设计的一等公民，
  //   从而 `harvest_decisions` 的候选（出处 = `docs/xxx.md:行号`）**有地方可挂**。
  //   ★ 只在显式 `include_docs` 时收（与 `include_tests` 同款 ⇒ 默认**一个节点都不多**）。
  //   ★ 布局：排在**所有已有节点的下方**（算一遍包围盒），x 依次排 —— 简单可预测，不和代码区重叠。
  if (include_docs) {
    const docsRoot = path.join(root, 'docs');
    const docRels: string[] = [];
    if (fs.existsSync(docsRoot)) {
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) {
            if (shouldSkipDir(e.name)) continue; // ★ 复用同一个跳目录判据（不另写一份）
            walk(path.join(dir, e.name));
          } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
            docRels.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
          }
        }
      };
      walk(docsRoot);
      docRels.sort();
    }
    const docBaseY = nodes.reduce((m, n) => Math.max(m, (n.y ?? 0) + (n.height ?? FILE_H)), 0) + 80;
    docRels.forEach((rel, i) => {
      nodes.push({
        id: `doc_${sanitize(rel)}`, // ★ 前缀登记在 SCANNED_ID_PREFIXES（T88 加它时漏改了那道闸的正则）
        label: `📄 ${path.posix.basename(rel)}`,
        x: MARGIN + (i % 6) * (FILE_W + 24),
        y: docBaseY + Math.floor(i / 6) * (FILE_H + 16),
        width: FILE_W,
        height: FILE_H,
        type: 'doc',
        status: 'done',
        // ★ 与 file 节点同款：**路径放 `description`** ⇒ `nodePath()` 的 else 分支能原样取到 ✓
        description: rel,
        style: { ...DEFAULT_FILE_COLOR, borderRadius: 4 },
      });
    });
    if (docRels.length) docNote = `文档 ${docRels.length} 篇（type=doc，可挂设计意图）`;
  }

  for (const d of [...dirByRel.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (input.design_mode) continue; // 设计模式只保留顶级目录节点，无父子 contains 边
    if (d.rel === '') continue;
    const parentRel = path.posix.dirname(d.rel);
    const parentId = parentRel === '.' || parentRel === '' ? null : dirNodeId(parentRel);
    if (parentId) {
      edges.push({ id: `contains_${sanitize(parentRel)}_${sanitize(d.rel)}`, from: parentId, to: dirNodeId(d.rel), label: 'contains' });
    }
  }

  // 聚合依赖边
  const normDir = (d: string): string => (d === '.' ? '' : d);
  const ancestorsOf = (dir: string): string[] => {
    const out: string[] = [];
    let d = normDir(dir);
    for (;;) {
      out.push(d);
      if (d === '') break;
      d = normDir(path.posix.dirname(d));
    }
    return out;
  };
  /** rel 在 lcaDir 层的直接子项节点 id（直接文件 → 文件节点；深入子目录 → 目录容器） */
  const ownerAtLca = (rel: string, lca: string): string => {
    const rest = lca === '' ? rel : rel.slice(lca.length + 1);
    const slash = rest.indexOf('/');
    if (slash === -1) return fileNodeId(rel);
    return dirNodeId(lca === '' ? rest.slice(0, slash) : `${lca}/${rest.slice(0, slash)}`);
  };

  const aggEdges = new Map<string, { from: string; to: string; n: number }>();
  const directEdges: Array<[string, string]> = [];
  for (const [fromRel, toRel] of plainDeps) {
    if (input.design_mode) {
      // 设计模式：只聚合到顶级目录（root 的直接子目录），忽略根目录散文件依赖（无 '/' 的 rel）
      if (!fromRel.includes('/') || !toRel.includes('/')) continue;
      const fromTop = topDirNodeId(fromRel);
      const toTop = topDirNodeId(toRel);
      if (fromTop === toTop) continue; // 同一目录内，跳过（内部依赖）
      const key = `${fromTop}|${toTop}`;
      const cur = aggEdges.get(key);
      if (cur) cur.n++;
      else aggEdges.set(key, { from: fromTop, to: toTop, n: 1 });
    } else {
      const fromAnc = ancestorsOf(path.posix.dirname(fromRel));
      const toAncSet = new Set(ancestorsOf(path.posix.dirname(toRel)));
      const lca = fromAnc.find((d) => toAncSet.has(d));
      if (lca === undefined) continue;
      const a = ownerAtLca(fromRel, lca);
      const b = ownerAtLca(toRel, lca);
      if (a === b) continue;
      if (a.startsWith('file_') && b.startsWith('file_')) {
        directEdges.push([fromRel, toRel]);
      } else {
        const key = `${a}|${b}`;
        const cur = aggEdges.get(key);
        if (cur) cur.n++;
        else aggEdges.set(key, { from: a, to: b, n: 1 });
      }
    }
  }

  if (!input.design_mode) {
    for (const [fromRel, toRel] of directEdges) {
      edges.push({
        id: `dep_${sanitize(fromRel)}_${sanitize(toRel)}`,
        from: fileNodeId(fromRel),
        to: fileNodeId(toRel),
        label: 'imports',
        type: 'dashed',
      });
    }
  }
  const aggSorted = [...aggEdges.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  for (const { from, to, n } of aggSorted) {
    edges.push({
      id: `dep_${sanitize(from)}_${sanitize(to)}`,
      from,
      to,
      label: n > 1 ? `imports ×${n}` : 'imports',
      type: 'dashed',
      style: n > 3 ? { strokeWidth: 2 } : undefined,
    });
  }

  renderedDepEdges = directEdges.length + aggSorted.length;

  // 9. 组装 DSL + 落盘 + 报告（目录路径收尾，功能模式已提前返回）
  return await finalizeDsl();
}

export { parsedKindToSymbolKind };