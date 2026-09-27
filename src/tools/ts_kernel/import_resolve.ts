/**
 * 项目内 import 路径解析 —— 【唯一实现】
 *
 * ★ 为什么有这个文件（2026-09-28）：这段逻辑曾被复制成 3 份
 *   （`db/symbols.ts`、`health/index.ts`、`impact/index.ts`），其中只有一份处理了
 *   "NodeNext ESM 用 `.js` 引 `.ts`"，另两份漏了 ⇒ 相对 import 解析恒返回 null
 *   ⇒ import 边整条丢失。后果分两层：
 *     ① 量具双向失真：orphan_file 284（92% 假阳）+ layer_violation 0（空转）
 *     ② 产品漏报：impact_analysis（改代码前必查的影响面）少算引用方
 *
 * ★ 设计边界（重要，别把策略塞进来）：
 *   本模块是**纯函数**，只做两件事：
 *     · 生成「项目内路径候选」的有序表（含 `.js`→`.ts` 重试、目录 index 回退、逃逸根剔除）
 *     · 按调用方给的 `exists` 谓词取第一个命中
 *   **不判断**"该不该解析"（相对 import？包导入？）—— 那是调用方的**策略**：
 *     · `db`     ：调用点已用 `imp.kind !== 'relative'` 过滤，且 `import type` 不建边
 *     · `impact` ：额外有包路径回退 `resolvePackageImportDir`
 *     · `health` ：额外有 `!source.startsWith('.')` 早退
 *   ⇒ 策略留在原地，才能保证 `db.resolveImportTarget` 被
 *     `tools/rename_file.ts` 当"路径字面量 → 项目内文件"通用工具复用时行为不变。
 */
import path from 'node:path';

/** 可被 import 直接指向的源码扩展名（按优先级）。 */
export const IMPORT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** 目录级 import（`./foo` → `./foo/index.ts`）的候选文件名。 */
export const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'] as const;

const IMPORT_EXT_SET = new Set<string>(IMPORT_EXTS);

export interface ResolvePathOptions {
  /** 覆盖候选源码扩展名（默认 `IMPORT_EXTS`）。health/impact 传内核的 `listSupportedExtensions()`。 */
  exts?: readonly string[];
  /** 覆盖目录 index 候选（默认 `INDEX_FILES`）。 */
  indexFiles?: readonly string[];
  /**
   * 候选表里**先放 `base` 自身**。
   *
   * 默认：`base` 带 import 级扩展名时为 `true`，否则 `false` —— 与原三份实现一致
   * （它们对无扩展名的 `base` 只试补全，不试原样；`base` 无扩展名时"原样"本来也不可能是源码文件）。
   *
   * 传 `true` 的场合：调用方面对的是**已经拼好的路径**（绝对路径 / 路径字面量），
   * "原样命中"必须排第一 —— 见 `project_root.resolveToFile`。
   */
  bareBaseFirst?: boolean;
}

/**
 * 给定**已拼好**的路径 `base`，生成补全候选（纯函数，只看字符串，不碰文件系统）。
 *
 * ★ 公开它是为了让**另一族**（绝对路径 + 多语言扩展名，见 `project_root.resolveToFile`）
 *   不必再手写一遍候选生成 —— 那一族的旧实现漏了"剥扩展名重试"，在本仓（961/971 条相对
 *   import 带 `.js`）等于**基本解析不动**，而它正是 `expandClosure` 无索引回退路径的底座。
 *
 * 顺序即优先级：
 *   `base` 带 import 级扩展名（`.ts/.tsx/.js/.jsx/.mjs/.cjs`）：
 *     `base` 原样 → `bare + exts…`（**剥扩展名重试**：NodeNext ESM 源码写 `.js` 指向产物）→ `bare/index…`
 *   否则（无扩展名 / 非 import 级扩展名）：
 *     `exts…` 补全 → `base/index…`
 *   `bareBaseFirst: true` 时在最前面额外插入 `base` 原样（上面第一种情形本就含它，不会重复插入）。
 *
 * 逃逸项目根（结果以 `..` 开头）的候选一律剔除，调用方无需再判。
 *
 * ⚠️ 兼容性怪癖（**故意保留，勿"顺手修正"**）：`join(dirname(fromRel), source)` 之后会先
 *   经 `path.posix.normalize`，所以 `'../../z'`（fromRel 在 `src/a/`）会被**折叠回根**成为 `'z'`，
 *   而不是残留 `..` ⇒ 此时剔除逻辑**不触发**，照样按项目根解析 `z.ts`。
 *   旧的三份实现都是这个行为（守卫条件同为 `startsWith('..')`）。改成"拒绝"会让
 *   `resolveImportTarget` 的既有调用方（含 `tools/rename_file.ts`）行为漂移。
 *   该怪癖已由 `tests/tools/import_resolve.test.ts` 钉住。
 */
export function completionCandidates(base: string, options: ResolvePathOptions = {}): string[] {
  const exts = options.exts ?? IMPORT_EXTS;
  const indexFiles = options.indexFiles ?? INDEX_FILES;
  const baseExt = path.posix.extname(base);
  const isImportExt = IMPORT_EXT_SET.has(baseExt);
  const out: string[] = [];
  if (isImportExt) {
    out.push(base);
    const bare = base.slice(0, -baseExt.length);
    for (const e of exts) out.push(bare + e);
    for (const f of indexFiles) out.push(`${bare}/${f}`);
  } else {
    if (options.bareBaseFirst) out.push(base);
    // ★ 非 import 级扩展名（如显式 `.go`/`.rs`）**不剥** —— 与旧三份实现逐字一致；
    //   需要"剥任意扩展名重试"是另一个策略，别顺手加进来（会让 health/impact 行为漂移）。
    for (const e of exts) out.push(base + e);
    for (const f of indexFiles) out.push(`${base}/${f}`);
  }
  return out.filter((c) => !c.startsWith('..'));
}

/**
 * 生成「项目内相对路径候选」有序表 —— `completionCandidates` 的 import 视角包装。
 * 见 `completionCandidates` 的说明与兼容性怪癖。
 */
export function importPathCandidates(
  fromRel: string,
  source: string,
  options: ResolvePathOptions = {},
): string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), source));
  return completionCandidates(base, options);
}

/** 按 `exists` 谓词取第一个命中的候选；全不命中返回 null。 */
export function resolveImportPath(
  fromRel: string,
  source: string,
  exists: (relPath: string) => boolean,
  options: ResolvePathOptions = {},
): string | null {
  for (const c of importPathCandidates(fromRel, source, options)) {
    if (exists(c)) return c;
  }
  return null;
}

/**
 * 按 `exists` 谓词取第一个命中的候选；全不命中返回 null。
 * 与 `resolveImportPath` 的差别只在**入参形态**：本函数收已经拼好的 `base`
 * （绝对路径 / 路径字面量均可），不自己做 dirname+join —— 供 `project_root.resolveToFile` 等复用。
 */
export function resolveExistingPath(
  base: string,
  exists: (candidate: string) => boolean,
  options: ResolvePathOptions = {},
): string | null {
  for (const c of completionCandidates(base, options)) {
    if (exists(c)) return c;
  }
  return null;
}
