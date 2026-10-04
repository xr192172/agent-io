/**
 * package_migration · 语言无关骨架
 *
 * 编排 `computeMigrationPlan`（纯计算，绝不落盘）：产出 RunningChangePlan
 * （absToNew/originals/moves），落盘+验证+回滚全由 refactor_pipeline 统一负责。
 *
 * 语言分支不再内联 if 链，改为委托给 `languages/registry.ts` 的 `findPmLangPackage(ext)`。
 * 语言无关的公共零件在 `./parts.ts`（断环：core → registry → 包 → core）。
 *
 * ★ 2026（拆分）：原单文件 `package_migration.ts`（639 行，3 个语言实现挤在一起）按语言拆成：
 *   - `parts.ts`：语言无关接线层（正则/收集/编辑应用 + 语言包契约）
 *   - `languages/{registry,go,ts,py}.ts`：注册表与各语言包
 *   本目录 `index.ts` 对外再导出**与拆分前逐字相同**的 API。
 *
 * 语义：
 *   - prefix/to 是"import 审计侧"的旧/新逻辑路径（可能带模块前缀 + 子路径子目录）。
 *     对全项目所有源文件，把 `moduleBase/<prefix>`(含其子前缀)重写为 `moduleBase/<to>`。
 *   - packageRename 作用于 packageRenameDir（缺省取 to 物理目录）的顶级源文件：
 *     `package <from>` → `package <to>`；`package <from>_test` → `package <to>_test`。
 *   - aliases 逐个清洗：把命中的 import 别名声明改名，并重写标识符用法 `<from>.` → `<to>.`。
 *   - 物理目录移动（可选，通用提级）：若 `project_dir/prefix` 目录真实存在，先整树移动到
 *     `project_dir/to`（跑在内容重写之前，moves 交给管线落盘）。若代码已物理到位
 *     （prefix 目录不存在，to 目录已含源码）则只做内容重写、不移动。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PackageMigrationSpec, RunningChangePlan } from '../../../infrastructure/analysis/refactor/refactor_langs.js';
import {
  DEFAULT_EXTS,
  DEFAULT_SKIP,
  applyAliasEdits,
  cleanAliasRegex,
  collectSourceFiles,
  isTopLevelOf,
  renamePackageDecl,
  rewriteImportPaths,
} from './parts.js';
import { findPmLangPackage } from './languages/registry.js';

/**
 * 清洗单条 import 别名：声明改名 + 标识符用法重写。
 * Go/TS 家族/Python 均走 AST 作用域守卫（先）精确替换；语言包缺失或解析失败回退正则。
 */
async function cleanAlias(src: string, exactPath: string, from: string, to: string, fileAbs: string): Promise<string> {
  const ext = '.' + (fileAbs.split('.').pop() || '');
  // ── 语言包统一调度：go / TS·JS 家族 / python（ext 互不相交，查表等价原 if 链）──
  const pkg = findPmLangPackage(ext);
  if (!pkg) return cleanAliasRegex(src, exactPath, from, to);
  const res = await pkg.collect({ src, exactPath, from, to, fileAbs });
  if (!res.ok) {
    // 语言包缺失 / 解析失败（退化环境）→ 回退正则，保证迁移功能不静默失效
    return cleanAliasRegex(src, exactPath, from, to);
  }
  // 守卫命中（空编辑→原样）或精确替换
  return applyAliasEdits(src, res.edits, from);
}

export interface MigrationPlanOptions {
  project_dir: string;
  migrate: PackageMigrationSpec;
}

/**
 * 纯计算：产出提级计划。不改盘。会做真实文件系统读取与存在性判断。
 * （Go 别名清洗走 AST 作用域守卫，为异步。）
 */
export async function computeMigrationPlan(opts: MigrationPlanOptions): Promise<RunningChangePlan> {
  const proj = path.resolve(opts.project_dir);
  const spec = opts.migrate;
  const exts = new Set(spec.sourceExts ?? [...DEFAULT_EXTS]);
  const skipDirs = new Set(spec.skipDirs ?? [...DEFAULT_SKIP]);

  const moduleBaseRaw = (spec.moduleBase ?? '').trim();
  // 把连续的尾随斜杠全部剥掉（moduleBase 纯斜杠形式 '///' 是最容易触发"静默数据破坏"的配置，必须拦截）。
  const moduleBase = moduleBaseRaw.endsWith('/') ? moduleBaseRaw.replace(/\/+$/, '') : moduleBaseRaw;

  // prefix / to 必须是相对 project_dir 的路径；若用户误传绝对路径（如 '/tmp/hub'、'D:\\hub'），
  // path.join(proj, ...) 会退化成直接使用绝对路径，命中非预期目录甚至盘外，属于路径穿越类隐患。
  // 注意：必须在剥前导斜杠之前判定，否则 '/tmp/pkg' 会被误剥成 'tmp/pkg' 伪装成相对路径。
  const invalidSegment = (s: string): boolean =>
    s.length > 0 && (path.isAbsolute(s) || /^[a-zA-Z]:/.test(s) || s.startsWith('\\') || s.startsWith('/'));
  if (invalidSegment(spec.prefix) || invalidSegment(spec.to)) {
    throw new Error(
      `package_migration.prefix/to 必须是相对 project_dir 的正斜杠路径，prefix=${JSON.stringify(
        spec.prefix,
      )}、to=${JSON.stringify(spec.to)} 已在计划期拦截。`,
    );
  }

  const prefix = spec.prefix.replace(/^\/+|\/+$/g, '');
  const to = spec.to.replace(/^\/+|\/+$/g, '');

  // 输入护栏：moduleBase 是 import 前缀重写的锚。若被剥成空串，
  // rewriteImportPaths 会退化成"把所有 /prefix/ 替换成 /to/"——
  // 在任意文件里吞掉所有以 / 开头的路径片段，属于静默数据破坏，必须在计划期就拦截。
  if (!moduleBase) {
    throw new Error(
      `package_migration.moduleBase 解析为空（原始值 ${JSON.stringify(spec.moduleBase)}），` +
        '重写会退化成无锚点的全局替换，已在计划期拦截，请检查配置。',
    );
  }

  const importOldAbs = `${moduleBase}/${prefix}`;
  const importNewAbs = `${moduleBase}/${to}`;

  const pkgDirRel = spec.packageRenameDir ?? to;
  const pkgDirAbs = path.isAbsolute(pkgDirRel) ? path.resolve(pkgDirRel) : path.resolve(proj, pkgDirRel);
  const pkgRename = spec.packageRename;
  const topLevelOnly = spec.packageRenameTopLevelOnly ?? true;

  // 物理目录移动：仅当"旧逻辑目录真实存在且目标目录不同"时才搬（避免误判已到位）。
  // 移动跑在内容重写之前；moves 交给管线先落盘。
  const srcDirAbs = path.join(proj, ...prefix.split('/'));
  const dstDirAbs = path.join(proj, ...to.split('/'));
  const moves: NonNullable<RunningChangePlan['moves']> = [];
  const movedAbsToRel = new Map<string, string>(); // 原始绝对路径 → 移动后相对路径
  const doMove = prefix !== to && fs.existsSync(srcDirAbs) && srcDirAbs !== dstDirAbs;
  if (doMove) {
    // 递归收集源目录树内待移动文件 → moves
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (!skipDirs.has(ent.name)) walk(p);
        } else if (exts.has(path.extname(ent.name))) {
          const rel = path.relative(srcDirAbs, p).split(path.sep).join('/');
          const toAbs = path.join(dstDirAbs, rel);
          if (fs.existsSync(toAbs)) {
            throw new Error(
              `包/目录迁移撞名：目标已存在文件 ${path.relative(proj, toAbs)}（移动 ${path.relative(proj, p)}）`,
            );
          }
          moves.push({ from: p, to: toAbs });
          movedAbsToRel.set(p, path.relative(proj, toAbs).split(path.sep).join('/'));
        }
      }
    };
    if (fs.existsSync(srcDirAbs)) walk(srcDirAbs);
  }

  const files = collectSourceFiles(proj, exts, skipDirs);
  const absToNew = new Map<string, string>();
  const originals = new Map<string, string>();

  for (const rel of files) {
    const fileAbs = path.resolve(proj, rel);
    let src: string;
    try {
      src = fs.readFileSync(fileAbs, 'utf-8');
    } catch {
      continue;
    }
    let s = src;

    // (a) import 引用面重写（全量文件）
    s = rewriteImportPaths(s, importOldAbs, importNewAbs);

    // (b) 别名清洗（逐条；Go 走 AST 作用域守卫）
    for (const al of spec.aliases ?? []) {
      s = await cleanAlias(s, al.importPath, al.from, al.to, fileAbs);
    }

    // (c) package 文件改名：仅作用于 packageRenameDir 树内；topLevelOnly 时只改直接位
    const isUnderPkgDir =
      movedAbsToRel.get(fileAbs)?.startsWith(`${pkgDirRel}/`) || rel.startsWith(`${pkgDirRel}/`);
    if (pkgRename && isUnderPkgDir) {
      // 顶层判定用"移动后生效路径"：被移动文件以目标路径为准（否则一次"移动+改名"里
      // 源还在子目录会导致误判非顶层、跳过改名——dogfood 抓到的真实缺陷）。
      const effectiveAbs = movedAbsToRel.has(fileAbs)
        ? path.resolve(proj, movedAbsToRel.get(fileAbs)!)
        : fileAbs;
      if (topLevelOnly && !isTopLevelOf(effectiveAbs, pkgDirAbs)) {
        // 子目录源文件：不改 package，但 import 引用面/别名照旧重写完（上方已做）
      } else {
        s = renamePackageDecl(s, pkgRename.from, pkgRename.to);
      }
    }

    if (s !== src) {
      // 移动后的文件以移动后路径为 key；未移动以原路径为 key
      const key = movedAbsToRel.get(fileAbs) ?? fileAbs;
      absToNew.set(key, s);
      originals.set(fileAbs, src);
    } else if (movedAbsToRel.has(fileAbs)) {
      // 无内容改写但发生了移动：仍计入计划（absToNew 里放原样内容，便于管线计数/回滚）
      const key = movedAbsToRel.get(fileAbs)!;
      absToNew.set(key, src);
      originals.set(fileAbs, src);
    }
  }

  // 撞名守卫：内容落盘目标若已是盘上现存文件（且非本计划移动目标），视为撞名
  for (const key of absToNew.keys()) {
    if (fs.existsSync(key)) {
      const alreadyMovedTarget = movedAbsToRel.has(key); // 已是某移动的目标 → 正常覆盖
      if (!alreadyMovedTarget && !originals.has(key)) {
        throw new Error(`包/目录迁移撞名：内容写入目标已存在 ${path.relative(proj, key)}`);
      }
    }
  }

  return { absToNew, originals, moves, units: moves.length };
}
