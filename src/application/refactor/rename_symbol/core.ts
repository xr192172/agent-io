/**
 * rename_symbol · 语言无关骨架
 *
 * 提供跨文件改名的公共零件：编辑应用（applyEdits/toOps）、相对 import 解析（resolveRel）、
 * 无扩展名索引（buildNoExt）、符号种类→节点类型（kindNodeTypes）、按扩展名收集文件
 * （collectFilesByExt）、共享 AST 节点面（N）/引用区分（NodeType）/编辑（Edit）等共享类型，
 * 以及编排入口 renameSymbolCore / renameSymbol。
 *
 * 语言分支不再内联 if 链，改为委托给 `languages/registry.ts` 的 `findLangPackage(defExt)`。
 */
import path from 'node:path';
import { resolveProjectRoot, loadAliasConfig, type ExternalRef } from '../../../infrastructure/analysis/project_root/index.js';
import { missingLanguageHint } from '../../../infrastructure/parse/lang_hint.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';
import { findLangPackage } from './languages/registry.js';

// ─────────────────────────────────────────────
// 公共零件已抽到 ./parts.ts（断环：core → registry → 包 → core）
// 下面**再导出**，保证对外 API 与拆分前逐字相同。
// ─────────────────────────────────────────────
import { NodeType, TS_EXTS, type RenameSymbolResult } from './parts.js';
export { TS_EXTS, stripQuotes, nameInfo, collectFilesByExt, applyEdits, toOps, kindNodeTypes, resolveRel, buildNoExt } from './parts.js';
export type {
  N,
  NodeType,
  Edit,
  RenameEditOp,
  RenameSymbolFileInfo,
  RenameSymbolResult,
} from './parts.js';














// ─────────────────────────────────────────────
// 跨文件符号改名执行器
// ─────────────────────────────────────────────
export interface RenameSymbolInput {
  /** 目标项目根目录（解析 file 为绝对路径）；缺省时自动定位（git 根→manifest→file 目录） */
  project_dir?: string;
  /** 定义符号的文件（相对 project_dir 或绝对路径） */
  file: string;
  /** 旧符号名（模块级声明名/被 import 的远程名） */
  symbol: string;
  /** 新符号名（必须为合法标识符） */
  to: string;
  /** true=当符号是文件主导出（文件名=符号名）时，联动把文件也改名为 to（增量，默认 false 不改） */
  rename_file_if_matching?: boolean;
  /** true=只算结构化 diff 不落盘（dry-run 预览）；默认 false 直接改写文件 */
  dry_run?: boolean;
}



async function renameSymbolCore(input: RenameSymbolInput): Promise<RenameSymbolResult> {
  const { file, symbol, to } = input;
  const renameFileIfMatching = !!input.rename_file_if_matching;
  const dryRun = input.dry_run === true;
  const blocked: string[] = [];
  /** §2d：本次"少做了什么"（被跳过的 importer + 闭包扩展自己报的 skipped），非空才随结果返回 */
  const skipped: Array<{ path: string; why: string }> = [];

  // 基础校验
  if (!/^[A-Za-z_$][\w$]*$/.test(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名非法：' + to] };
  if (symbol === to) return { ok: false, symbol, to, filesWritten: 0, blocked: ['新名与旧名相同：' + symbol] };

  const effectiveRoot = input.project_dir ? path.resolve(String(input.project_dir)) : undefined;
  // file 解析：绝对路径直接用；相对路径优先相对项目根（若显式给），否则相对 cwd
  const fileAbs = path.isAbsolute(file)
    ? path.resolve(file)
    : effectiveRoot
      ? path.resolve(effectiveRoot, String(file))
      : path.resolve(process.cwd(), String(file));
  const defAbs = fileAbs;
  // 项目根：显式传则用；否则自动定位（git 根→manifest→file 目录），消除"必须先知 project_dir"的摩擦
  const resolvedRoot = effectiveRoot ?? resolveProjectRoot(fileAbs);
  // tsconfig 路径别名（@/ 等）：闭包扩展与 importer 匹配共用同一份，保证"拉进闭包"与"命中改名"一致
  const aliasCfg = loadAliasConfig(resolvedRoot);

  const defExt = path.extname(defAbs);

  // ── 语言包统一调度：go / python / C# / Java / C·C++ / TS·JS 家族（ext 互不相交，查表等价原 if 链）──
  const pkg = findLangPackage(defExt);
  if (pkg) {
    const r = await pkg.rename({ file: defAbs, symbol, to, dryRun, resolvedRoot, blocked, renameFileIfMatching, skipped, aliasCfg });
    // ★ T18：回传 Core 内部已定位的根（此前只在手里、没进产物）—— 不改语言包产物，只在本层补 project_dir。
    return { ...r, project_dir: resolvedRoot };
  }

  // ★ P11：以前只写"暂只支持 TS/JS"——不可执行。补上"装什么包 / 照哪份清单 / 现缺口多少"。
  //   （TS 系已在上面的语言包被截获；此处只剩"任何语言包都不认"的扩展名。）
  return {
    ok: false,
    symbol,
    to,
    filesWritten: 0,
    project_dir: resolvedRoot,
    blocked: [`文件非 TS 系（${defExt}），跨文件改名暂只支持 TS/JS 模块级符号。${missingLanguageHint(defExt, 'rename_symbol')}`],
  };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: RenameSymbolInput, r: RenameSymbolResult): Touched {
  const touched: Touched = {};
  // project_dir（作用域类 ⇒ 随时可给）：**优先取入参**（调用方声明的根）；
  //   入参没给则取**产物里的 project_dir**（Core 内部已定位到的根，见 r.project_dir）；两者都取不到才省略（不猜、不兜底 cwd）。
  if (input.project_dir) {
    touched.project_dir = path.resolve(String(input.project_dir));
  } else if (r.project_dir) {
    touched.project_dir = r.project_dir;
  }
  // ★ 只有"真的落定"才给 symbols / written_files（dry_run / 被阻断 / ok:false 一律省略）：
  //   Touched 描述"调用之后下游能从哪儿接着走" ⇒ 未落定时没有可接的锚点。
  //   symbols 给"落定后的符号标识"= 新名 input.to（下游拿新名继续操作；给旧名会让链静默接错）。
  if (r.ok && r.dryRun !== true) {
    touched.symbols = [input.to];
    // 落盘路径下写过的文件 = 定义文件（fileRenamed 时其现址是新路径）+ 每个被改写的 importer。
    const files: string[] = [];
    if (r.fileRenamed !== undefined) files.push(r.fileRenamed);
    else if (r.definition) files.push(r.definition.file);
    for (const im of r.importers ?? []) files.push(im.file);
    const uniq = [...new Set(files)];
    if (uniq.length > 0) touched.written_files = uniq;
  }
  return touched;
}

export async function renameSymbol(input: RenameSymbolInput): Promise<TouchedProduct<RenameSymbolResult>> {
  const r = await renameSymbolCore(input);
  return withTouched(r, touchedOf(input, r));
}
