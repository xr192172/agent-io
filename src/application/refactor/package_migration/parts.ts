/**
 * package_migration · 公共零件（语言无关的接线层）
 *
 * ★★ 为什么单独一个文件（与 `rename_symbol/parts.ts` 同因）：
 *   这些零件**语言包和 core 都要用**。若它们住在 `core.ts` 里，就形成
 *     `core → languages/registry → languages/<lang> → core` 的**环**。
 *   抽出来之后：`core → parts`、`languages/<lang> → parts` —— **回边消失**。
 *   ⇒ **"大家都要用的东西"放错位置就会造出环**（本仓第 1 例实测被 arch 报 9 条）。
 *
 * 这里还落**注册表契约**（`AliasEdit` / `PmCollectArgs` / `PmCollectResult` / `PmLangPackage`）：
 *   契约只被 `import type` 引用 ⇒ dep-cruiser 判它孤儿；并入「语言无关接线层」既保住单一落点，
 *   又不多一个文件、不动架构基线（同 `rename_symbol/parts.ts` 的处理）。
 */
import { DATA_DIR_NAME } from '../../../infrastructure/data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_EXTS } from '../../../infrastructure/parse/index.js';

export const DEFAULT_SKIP = new Set([
  '.git', 'node_modules', DATA_DIR_NAME, 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', '.next', 'out',
]);

/** 默认可迁移的源码扩展名 —— 来自内核唯一权威（`ts_kernel/source_exts.ts`） */
export const DEFAULT_EXTS = new Set<string>(SOURCE_EXTS);

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 递归收集项目内命中扩展名的源文件（相对 project_dir 的正斜杠路径）。 */
export function collectSourceFiles(
  proj: string,
  exts: Set<string>,
  skipDirs: Set<string>,
): string[] {
  const out: string[] = [];
  const stack = [proj];
  const seen = new Set<string>();
  while (stack.length) {
    const dir = stack.pop()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) stack.push(p);
        continue;
      }
      if (exts.has(path.extname(ent.name))) out.push(path.relative(proj, p).split(path.sep).join('/'));
    }
  }
  return out;
}

/** 把旧 import 全路径(含子前缀)重写为新路径。 */
export function rewriteImportPaths(src: string, oldAbs: string, newAbs: string): string {
  if (!oldAbs) return src;
  let s = src;
  // 顺序：先子前缀再精确（replaceAll 无歧义，直接都替换）
  s = s.replaceAll(oldAbs + '/', newAbs + '/');
  s = s.replaceAll(oldAbs, newAbs);
  return s;
}

/** 一条基于 AST 字节偏移的编辑点。start/end 为 JS 字符串索引（与当前封装对齐）。 */
export interface AliasEdit {
  start: number;
  end: number;
  replacement: string;
}

/** 去掉字符串字面量的引号（如 `"path"` → `path`）。 */
export function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const c0 = s[0];
    if ((c0 === '"' || c0 === "'") && s[s.length - 1] === c0) return s.slice(1, -1);
  }
  return s;
}

/** 按 offset 降序应用编辑点；每个替换点先做一致性校验（防/兜多字节偏移错位）。 */
export function applyAliasEdits(src: string, edits: AliasEdit[], from: string): string {
  if (edits.length === 0) return src;
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let s = src;
  for (const e of sorted) {
    if (e.start < 0 || e.end > s.length || e.start > e.end) continue;
    if (e.replacement === '') {
      // 删除别名段（to 空）——边界来自 import_spec/path 内部，直接删除
      s = s.slice(0, e.start) + s.slice(e.end);
    } else {
      if (s.slice(e.start, e.end) !== from) continue; // 一致性校验：替换点必须恰好是 from token
      s = s.slice(0, e.start) + e.replacement + s.slice(e.end);
    }
  }
  return s;
}

/** 非 Go（TS/Python…）沿用原正则清洗。 */
export function cleanAliasRegex(src: string, exactPath: string, from: string, to: string): string {
  let s = src;
  const quoted = escapeRe(exactPath);
  // 1) 别名声明：`alias "path"` → `to "path"`；to 为空则去掉别名（仅留 `"path"`）
  if (!to) {
    const decl = new RegExp(`\\b${escapeRe(from)}\\s+("${quoted}")`, 'g');
    s = s.replace(decl, '$1');
  } else if (to !== from) {
    const decl = new RegExp(`\\b${escapeRe(from)}\\s+("${quoted}")`, 'g');
    s = s.replace(decl, `${to} $1`);
  }
  // 2) 标识符用法：`from.` → `to.`（包别名调用点）
  if (to !== from) {
    s = s.replace(new RegExp(`\\b${escapeRe(from)}\\.`, 'g'), `${to}.`);
  }
  return s;
}

/** 顶层 package 声明改名（from_test → to_test 优先）。 */
export function renamePackageDecl(src: string, from: string, to: string): string {
  let s = src;
  if (!from || !to || from === to) return s;
  s = s.replace(
    new RegExp(`^(\\s*)package\\s+${escapeRe(from)}_test\\b`, 'm'),
    `$1package ${to}_test`,
  );
  s = s.replace(
    new RegExp(`^(\\s*)package\\s+${escapeRe(from)}\\b`, 'm'),
    `$1package ${to}`,
  );
  return s;
}

/** 判定文件是否直接位于某个物理目录（top-level），否则在子目录内。 */
export function isTopLevelOf(fileAbs: string, dirAbs: string): boolean {
  const rel = path.relative(dirAbs, fileAbs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return !rel.includes(path.sep);
}

// ─────────────────────────────────────────────
// 语言包契约（原内联在 package_migration.ts 的分派处）
// ★ 为什么不单开 `languages/types.ts`：它只会被 `import type` 引用 ⇒ dep-cruiser 判它**孤儿**
//   （类型导入不算依赖）。并入「语言无关接线层」既保住契约的单一落点，又**不多一个文件**。
// ─────────────────────────────────────────────

/** 语言包「别名改写候选」采集入参（原 `cleanAlias` 的五个局部参数原样透传）。 */
export interface PmCollectArgs {
  src: string;
  exactPath: string;
  from: string;
  to: string;
  fileAbs: string;
}

/**
 * 采集结果：
 *   - `ok`：语言包是否可用（false = 解析失败 / 语言包缺失的退化环境，调用方回退正则）；
 *   - `edits`：该语言的别名改写编辑点（守卫命中时为空数组）。
 */
export interface PmCollectResult {
  ok: boolean;
  edits: AliasEdit[];
}

export interface PmLangPackage {
  /** 这个包负责哪些扩展名（含点，如 '.go'） */
  readonly exts: readonly string[];
  /** 该语言的「别名改写候选」采集入口 */
  collect(args: PmCollectArgs): Promise<PmCollectResult>;
}
