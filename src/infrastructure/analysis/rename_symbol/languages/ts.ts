/**
 * rename_symbol · TS/JS 家族语言包
 *
 * 承载 TS/JS 跨文件改名执行器（`renameTsSymbol`）。
 *
 * ★ 2026-10-04（T26）：模块级作用域解析 `analyzeModuleSource`（及其 `ImportEdge` / `ModuleRef` /
 *   `ModuleAnalysis` 与私有助手）**已下沉到 `infrastructure/parse/module_analysis.ts`**。
 *   原因：`infrastructure/analysis/project_root/index.ts`（共享工具层）反向 import 本文件 ⇒ 层次倒挂，
 *   并与本文件对外层 `cross` 的 value import 构成**双向 value 环**。
 *   该解析只依赖基础设施（解析器/节点原语），与 `project_root` / `protect` 无关
 *   （那两样只在 `renameTsSymbol` 里用）⇒ 它本就应该在 infrastructure。
 *   ★ 2026-10-05（T42 2b-C1）：文件联动改名已从本文件**上收**到工具层
 *   （`rename/rename_symbols.ts`）—— 引擎不再知道"文件可以被改名"这件事。
 *   `rename_symbol/index.ts` 仍按原契约再导出 `analyzeModuleSource` 与三个类型。
 *
 * 正确性机制（关键）：
 *   - 模块级作用域解析：见 `infrastructure/parse/module_analysis.ts`。
 *   - 值符号（function/const）只改 identifier；类型符号（interface/type）只改 type_identifier；
 *     class/enum 值类型双栖，identifier 与 type_identifier 都改。
 *   - 原子性：任一阻断（新名撞名、星号转发、目标不是模块级符号）→ 全部不落盘，返回理由。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expandClosureDetailed, loadAliasConfig, resolveAliasedImport, type AliasConfig } from '../../../../infrastructure/analysis/project_root/index.js';
import { createProtectGuard } from '../../../../infrastructure/analysis/refactor/protect.js';
import { missingLanguageHint } from '../../../../infrastructure/parse/lang_hint.js';
import { analyzeModuleSource, type ModuleAnalysis } from '../../../../infrastructure/parse/module_analysis.js';
import { TS_JS_EXTS } from '../../../../infrastructure/parse/source_exts.js';
import {
  applyEdits,
  toOps,
  kindNodeTypes,
  buildNoExt,
  resolveRel,
  TS_EXTS,
  type Edit,
  type RenameSymbolFileInfo,
  type RenameSymbolResult,
} from '../parts.js';
import type { LangPackage, LangRenameArgs } from '../parts.js';

// ─────────────────────────────────────────────
// TS/JS 跨文件改名执行器（原 core 收尾那段，整体搬入）
// ─────────────────────────────────────────────
export async function renameTsSymbol(args: LangRenameArgs): Promise<RenameSymbolResult> {
  const { file: defAbs, symbol, to, dryRun, resolvedRoot, blocked, skipped, aliasCfg } = args;

  const defSrc = readFileSync(defAbs, 'utf-8');
  const def = await analyzeModuleSource(defSrc, defAbs);
  if (!def) return { ok: false, symbol, to, filesWritten: 0, blocked: ['定义文件解析失败'] };
  const kind = def.rootKinds.get(symbol);
  if (!kind) return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 不是该文件的模块级声明`] };
  if (kind === 'import' || kind === 'reexport' || kind === 'exported') {
    // 目标名是 import 绑定而非声明 → 说明该符号在本文件只是被引入/再导出，改名应从真正定义文件发起
    return { ok: false, symbol, to, filesWritten: 0, blocked: [`"${symbol}" 在 ${path.basename(defAbs)} 中是 import 绑定而非声明，请在它的定义文件上发起改名`] };
  }
  const declOffset = def.rootOffsets.get(symbol)!;
  if (def.rootKinds.has(to)) return { ok: false, symbol, to, filesWritten: 0, blocked: [`定义文件已存在同名模块级符号 "${to}"`] };

  // 定义文件编辑
  const defEditSet = new Set<number>([declOffset]);
  const defNodeTypes = kindNodeTypes(kind);
  for (const r of def.rootRefs) if (r.name === symbol && defNodeTypes.has(r.nodeType)) defEditSet.add(r.offset);
  for (const r of def.exportRefs) if (r.name === symbol) defEditSet.add(r.offset);
  const defEditList: Edit[] = [...defEditSet].map((pos) => ({ pos, len: symbol.length, text: to }));

  // 收集自包含闭包源文件（项目根内全部 + 沿 import 边/别名边扩展边界外本地文件），构建相对解析表
  const closure = await expandClosureDetailed(defAbs, resolvedRoot, aliasCfg);
  const files = closure.files;
  const byNoExt = buildNoExt(files);

  // 解析 importer 文件
  const importerEdits: Map<string, { edits: Edit[]; note: string; src: string }> = new Map();
  // 按 importer 文件所属项目取 alias（邻域 importer 在兄弟项目里可能用各自别名；
  // memo 缓存目录→alias，避免每个文件重复读 tsconfig）
  const aliasMemo = new Map<string, AliasConfig | null>();
  const aliasFor = (fAbs: string): AliasConfig | null => {
    const d = path.dirname(fAbs);
    if (!aliasMemo.has(d)) aliasMemo.set(d, loadAliasConfig(d));
    return aliasMemo.get(d) ?? null;
  };
  for (const f of files) {
    if (path.resolve(f) === defAbs) continue;
    const ext = path.extname(f);
    if (!TS_EXTS.has(ext)) continue;
    // 导入源 → 本地文件：相对走 byNoExt 表；别名走该 importer 所在项目的 tsconfig 解析
    const fAlias = aliasFor(f);
    const resolveEdge = (source: string): string | null =>
      source.startsWith('.') ? resolveRel(source, f, byNoExt) : fAlias ? resolveAliasedImport(source, fAlias) : null;
    let fmod: ModuleAnalysis | null;
    let src: string;
    try {
      src = readFileSync(f, 'utf-8');
      fmod = await analyzeModuleSource(src, f);
    } catch (err) {
      // §2d：读不了/解析不了这个 importer ⇒ 记 skipped 并带上原因（原来 fmod=null 后静默 continue）
      skipped.push({ path: f, why: String(err) });
      continue;
    }
    if (!fmod) {
      // 走到这里扩展名已确认是 TS 系（上面 !TS_EXTS.has(ext) 已 continue）⇒ null 只可能是
      // "该扩展名没有可用解析器"，不是"这个文件没问题" —— 也要可读
      // ★ P11：可读不够，还要**可执行**（包名/清单/缺口数），否则用户只能去猜。
      skipped.push({ path: f, why: `无可用 TS 解析器：该扩展名的语法未加载。${missingLanguageHint(ext, 'rename_symbol')}` });
      continue;
    }

    let fileEdits: Edit[] = [];
    let touched = false;
    let note = '';

    for (const e of fmod.imports) {
      if (e.star) {
        // 星号转发：若指向目标文件 → 阻断
        if (e.remoteName === null) {
          const resolved = resolveEdge(e.source);
          if (resolved && path.resolve(resolved) === defAbs) blocked.push(`${path.basename(f)} 用 export * 转发自定义文件，无法按名追改下游引用`);
        }
        continue;
      }
      if (e.remoteName !== symbol) continue;
      const resolved = resolveEdge(e.source);
      if (!resolved || path.resolve(resolved) !== defAbs) continue;

      // 命中 importer。先做撞名检查（原子性：任一 importer 撞名 → 全阻断）
      if (e.remoteOffset !== null) {
        const clash = fmod.imports.some((o) => o.remoteName === to || o.localName === to);
        if (clash) blocked.push(`${path.basename(f)} 已 import 名为 "${to}" 的符号`);
      }

      // import 子句远程名 → to
      if (e.remoteOffset !== null) {
        fileEdits.push({ pos: e.remoteOffset, len: symbol.length, text: to });
        touched = true;
      }

      // 无别名 import（localName===symbol）：使用点也改
      if (!e.isReexport && e.localName === symbol) {
        const iKind = e.typeOnly ? 'type' : kind;
        const iNodeTypes = kindNodeTypes(iKind);
        for (const r of fmod.rootRefs) if (r.name === symbol && iNodeTypes.has(r.nodeType)) fileEdits.push({ pos: r.offset, len: symbol.length, text: to });
        note = e.typeOnly ? 'import+类型引用' : 'import+引用';
      } else if (e.isReexport) {
        note = 're-export';
      } else {
        note = `import 子句（别名 ${e.localName}）`;
      }
    }

    if (touched) importerEdits.set(f, { edits: fileEdits, note: note || 'import', src });
  }

  // 冻结行保护（原子）：importer 的引用改写若会落在保护文件的标记行 → 阻断。
  // 定义文件是操作对象本身，不套；只挡"其它文件"——否则要么半改、要么跳过某 importer
  // 仍让它处动，都会破坏跨文件改名的原子性。
  const guard = createProtectGuard(resolvedRoot);
  for (const [f, entry] of importerEdits) {
    if (path.resolve(f) === defAbs) continue;
    const g = guard.scan(f, entry.src, entry.edits);
    if (g.blocked) blocked.push(`${path.relative(resolvedRoot, f).replace(/\\/g, '/')} 的引用命中保护标记行，需解除保护或人工处理后再改名：${g.protectedLines.join(' | ')}`);
  }

  // 原子性：任一阻断 → 全部不落盘
  if (blocked.length > 0) return { ok: false, symbol, to, filesWritten: 0, blocked };

  // 落盘（dry_run=true 时只算 diff 不写文件；filesWritten 始终=实际落盘数）
  let filesWritten = 0;
  const importers: RenameSymbolFileInfo[] = [];
  if (defEditList.length > 0) {
    const out = applyEdits(defSrc, defEditList);
    if (out !== defSrc && !dryRun) {
      writeFileSync(defAbs, out, 'utf-8');
      filesWritten++;
    }
  }
  for (const [f, { edits, note, src }] of importerEdits) {
    const out = applyEdits(src, edits);
    if (out !== src && !dryRun) {
      writeFileSync(f, out, 'utf-8');
      filesWritten++;
    }
    importers.push({ file: (path.relative(resolvedRoot, f) || f).replace(/\\/g, '/'), edits: edits.filter((e) => e.len > 0).length, note, ops: toOps(src, edits) });
  }

  // 联动改名文件：符号改名后是否把文件名也同步为 to，是**工具层**的关切（项目约定：
  // 文件名=主导出），引擎不再参与 —— 见 `rename/rename_symbols.ts`。

  return {
    ok: true,
    symbol,
    to,
    dryRun: dryRun || undefined,
    definition: { file: (path.relative(resolvedRoot, defAbs) || defAbs).replace(/\\/g, '/'), edits: defEditList.length, note: '定义+同文件引用', ops: toOps(defSrc, defEditList) },
    importers,
    filesWritten,
    ...(closure.externalRefs.length > 0 ? { externalRefs: closure.externalRefs } : {}),
    ...(skipped.length + closure.skipped.length > 0 ? { skipped: [...skipped, ...closure.skipped] } : {}),
  };
}

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 * ★ TS/JS 家族用内核权威 `TS_JS_EXTS`（**不要手抄**那 8 个扩展名）。
 */
export const tsPackage: LangPackage = {
  exts: TS_JS_EXTS,
  rename: (a) => renameTsSymbol(a),
};
