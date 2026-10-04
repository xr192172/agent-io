/**
 * rename_symbol · 公共零件（语言无关的接线层）
 *
 * ★★ 为什么单独一个文件（2026-10-01，拆分后跑 `arch` 逼出来的）：
 *   这些零件**语言包和 core 都要用**。若它们住在 `core.ts` 里，就形成
 *     `core → languages/registry → languages/<lang> → core` 的**环**（实测 9 条 no-circular）。
 *   抽出来之后：`core → parts`、`languages/<lang> → parts` —— **回边消失**。
 *   ★ 这是本仓第 2 次栽在同一件事上：**"大家都要用的东西"放错位置就会造出环**。
 */
import { readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { TS_JS_EXTS } from '../../../infrastructure/parse/index.js';
import { TS_EXTS, type NodeType } from '../../../infrastructure/parse/ast_node.js';
import type { AliasConfig, ExternalRef } from '../../../infrastructure/analysis/project_root/index.js';

// ─────────────────────────────────────────────
// 最小 tree-sitter 节点面 + 小工具（`N` / `NodeType` / `TS_EXTS` / `stripQuotes` / `nameInfo`）
//
// ★ 下沉到 infrastructure/parse（2026-10-04，T26）：模块级作用域解析 `analyzeModuleSource`
//   移到 `infrastructure/parse/module_analysis.ts` 后，若它继续从这里取原语，就会新造
//   `infrastructure → application` 回边（用一条违规换一条环，方向反了）。
//   ⇒ 原语下沉到 `infrastructure/parse/ast_node.js`，本文件**向下复用并再导出** ——
//   单一落点、不复制两份；语言包与 core 的取用路径（`../parts.js`）保持不变。
// ─────────────────────────────────────────────
export { TS_EXTS, stripQuotes, nameInfo, type N, type NodeType } from '../../../infrastructure/parse/ast_node.js';

/**
 * 递归收集项目根下指定扩展名文件。
 * ★ §2d（2026-09-28 修剪）：读不了的目录**记 skipped（带 why）**，不再"catch 里只留一句注释"静默少扫 ——
 *   调用方（改名执行器）据此知道"哪些目录这次没看到 ⇒ 可能有未改写的引用"。
 * ★ 改为**逐目录 catch**：原来整趟 walk 一个 try，任何一层失败就丢掉整棵子树的静默结果（连坐兄弟目录）。
 */
export function collectFilesByExt(
  root: string,
  ext: string,
): { files: Set<string>; skipped: Array<{ path: string; why: string }> } {
  const files = new Set<string>();
  const skipped: Array<{ path: string; why: string }> = [];
  const walkDir = (d: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      skipped.push({ path: d, why: String(err) });
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walkDir(full);
      else if (e.isFile() && e.name.endsWith(ext)) files.add(full);
    }
  };
  walkDir(root);
  return { files, skipped };
}

// ─────────────────────────────────────────────
// 应用编辑（逆序，避免偏移互相影响）
// ─────────────────────────────────────────────
export interface Edit {
  pos: number;
  len: number;
  text: string;
}

export function applyEdits(src: string, edits: Edit[]): string {
  if (edits.length === 0) return src;
  const sorted = [...edits].sort((a, b) => b.pos - a.pos);
  let out = src;
  for (const e of sorted) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.len);
  return out;
}

/** 结构化编辑操作：一次"旧 → 新"替换（供 LLM 直接验证，不只给计数） */
export interface RenameEditOp {
  /**
   * UTF-16 code unit 偏移（★ 不是字节偏移 —— 2026-09-29 更正）。
   * 来源是 tree-sitter：`node.cc` 的 `ts_node_start_byte(node) / 2`（parser 以 `TSInputEncodingUTF16` 喂入）
   * ⇒ 这个单位**与 LSP 的 `positionEncoding` 默认值（utf-16）同轴**，将来接 LSP 时**不需要**做字节换算。
   * ★ 若按字面当成"字节"实现，带中文的源文件（本文件就有 315 行含非 ASCII）会被 `src.slice()` 切烂。
   */
  pos: number;
  /** 被替换的 **code unit** 数（同上，非字节数） */
  len: number;
  /** 被替换的旧文本 */
  old: string;
  /** 替换成的新文本 */
  new: string;
}

export function toOps(src: string, edits: Edit[]): RenameEditOp[] {
  return edits.map((e) => ({ pos: e.pos, len: e.len, old: src.slice(e.pos, e.pos + e.len), new: e.text }));
}

export interface RenameSymbolFileInfo {
  file: string;
  /** 实际替换的字节数 */
  edits: number;
  /** 结构化编辑操作（old→new，供 LLM 验证；dry_run 或成功后均返回） */
  ops?: RenameEditOp[];
  /** 说明（'定义+同文件引用' / 'import+引用' / 'import 子句（别名）' / 're-export'） */
  note: string;
}

export interface RenameSymbolResult {
  ok: boolean;
  symbol: string;
  to: string;
  definition?: RenameSymbolFileInfo;
  importers?: RenameSymbolFileInfo[];
  filesWritten: number;
  /** 是否 dry-run（true=未落盘，只出 diff 预览） */
  dryRun?: boolean;
  /** 工作区外的 import 依赖边界（本文件的 import 解析到 root 外部仓库）——只反馈不改，LLM 可据此判断是否另处理 */
  externalRefs?: ExternalRef[];
  /**
   * ★ §2d/§21（2026-09-28 修剪）：本次改名**少做了什么**——扫描/读取/解析阶段被跳过的目录或文件及原因。
   * 这些文件**没有被分析**，可能含本次未改写的引用；只在非空时返回（空 = 一处没少做）。
   * 不做静默跳过：以前这些位置是"catch 里只留一句注释"/"catch 后直接 continue"（调用方无感）。
   */
  skipped?: Array<{ path: string; why: string }>;
  /** 联动文件名（rename_file_if_matching 且文件名=符号名时，被同步改名的新路径） */
  fileRenamed?: string;
  /** 文件联动阻断理由（符号已改名成功，仅文件联动失败时给出） */
  fileRenameBlocked?: string[];
  /** 阻断理由（ok=false 时给出全部） */
  blocked?: string[];
  /**
   * ★ 本次**解析出的项目根**（实况 = `effectiveRoot ?? resolveProjectRoot(fileAbs)`）——
   *   Core 内部早就定位了它（此前只在手里、没进产物）；T18：把它回传给构造点与下游反查。
   *   作用域类字段（= `Touched.project_dir` 的产物来源）：随时可给，不依赖成败。
   *   ★ 字段名 = 受控词表的 `project_dir`（原 `root` 不在词表里 ⇒ 同一事实两个名字，2026-10-05 收口）。
   */
  project_dir?: string;
}

// ─────────────────────────────────────────────
// 符号种类 → 需改写的引用节点类型
// ─────────────────────────────────────────────
export function kindNodeTypes(kind: string): Set<NodeType> {
  switch (kind) {
    case 'class':
    case 'enum':
      return new Set(['value', 'type']);
    case 'interface':
    case 'type':
      return new Set(['type']);
    case 'function':
    case 'const':
    default:
      return new Set(['value']);
  }
}

// ─────────────────────────────────────────────
// 相对 import 解析（项目内文件集合来自 project_root.expandClosure）
// ─────────────────────────────────────────────
export function resolveRel(source: string, importerAbs: string, byNoExt: Map<string, string>): string | null {
  if (!source.startsWith('.')) return null; // 包导入 / 外部 → 不是项目内相对引用
  const impRelDir = path.posix.dirname(importerAbs.replace(/\\/g, '/')).replace(/\/$/, '');
  const target = path.posix.join(impRelDir, source);
  const hit = byNoExt.get(target);
  if (hit) return hit;
  for (const ext of TS_JS_EXTS) {
    const key = target.endsWith(ext) ? target.slice(0, -ext.length) : target;
    const h = byNoExt.get(key);
    // import './x.js' 在 TS 中可指向 x.ts（allowJs/emit 产物）；命中任一 TS 系源码即接受，
    // 否则带扩展名 import（续改写产物）会漏掉 .ts/.tsx 源码目标
    if (h && (h.endsWith(ext) || TS_EXTS.has(path.extname(h)))) return h;
  }
  // 目录形式（./dir → ./dir/index.ts）
  const dirKey = target.replace(/\/+$/, '');
  for (const f of byNoExt.values()) {
    if (f.startsWith(dirKey + '/') && /(^|\/)index\.[^.]+$/.test(f)) return f;
  }
  return null;
}

export function buildNoExt(files: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    // 去掉扩展名（含 /index）
    const noExt = rel.replace(/\.[^.]+$/, '');
    m.set(noExt, f);
    // 目录索引：./dir → ./dir/index.ts
    const base = path.posix.basename(noExt);
    if (base === 'index' || base === 'mod') m.set(path.posix.dirname(noExt), f);
  }
  return m;
}

// ─────────────────────────────────────────────
// 语言包契约（原 `languages/types.ts` 并入此处）
// ★ 为什么不单开一个 `languages/types.ts`：它只会被 `import type` 引用 ⇒ dep-cruiser 判它**孤儿**
//   （类型导入不算依赖，既有 `version_upgrade/adapters/types.ts` 就是这么进已知清单的）。
//   并入「语言无关接线层」既保住契约的单一落点，又**不多一个文件、不动架构基线**。
// ─────────────────────────────────────────────
export interface LangRenameArgs {
  file: string;
  symbol: string;
  to: string;
  dryRun: boolean;
  resolvedRoot: string;
  blocked: string[];
  /** TS/JS 家族专用：符号=文件主导出时是否联动把文件改名为 to */
  renameFileIfMatching: boolean;
  /** TS/JS 家族专用：本次"少做了什么"（就地追加，最终随结果返回） */
  skipped: Array<{ path: string; why: string }>;
  /** TS/JS 家族专用：tsconfig 路径别名配置（无 tsconfig 时为 null） */
  aliasCfg: AliasConfig | null;
}

export interface LangPackage {
  /** 这个包负责哪些扩展名（小写，含点，如 '.go'） */
  readonly exts: readonly string[];
  /** 跨文件改名的**唯一入口** */
  rename(args: LangRenameArgs): Promise<RenameSymbolResult>;
}
