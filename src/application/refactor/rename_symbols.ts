/**
 * rename_symbols —— 标识符改名的**单一入口 [B]**：内部按「**作用域 × 语言**」路由。
 *
 * ```
 * renameSymbols()                       ← 入口（[C] 只转发到这一个函数）
 *   ├─ scope='local'  → renameLocals()          （文件内局部绑定；作用域分析复用 ast_rename）
 *   └─ scope='module' → renameSymbolsModule()   （模块级符号；再按语言路由 ↓）
 *                         renameSymbol()
 *                           ├─ '.go'  → renameGoSymbol()
 *                           ├─ '.py'  → renamePythonSymbol()
 *                           ├─ '.cs'  → renameNamespaceSymbol(ext='.cs')
 *                           ├─ '.java'→ renameNamespaceSymbol(ext='.java')
 *                           ├─ '.c'/'.h' → renameCSymbol()
 *                           └─ 其余 TS 系 → 模块符号引用图（本文件下半部）
 * ```
 *
 * 这就是用户点名的 **SafeRename 形态**：**一个 [B] 内部按对象路由**（对象 = 要改名的那个标识符，
 * 它的**作用域**与**语言**决定了机制），各分支**共享同一套入参形态**（`renames:[{file,symbol,to,…}]`）
 * 与**同一套产物形态**（`RenameSymbolsResult`：`ok / scope / dryRun / previews / applied /
 * filesWritten / blocked / indexWriteThrough`）。
 *
 * ★ 为什么 `scope` 是**调用级**参数而不是逐条参数：作用域是"这一批在做什么粒度的事"，
 *   而不是某个条目的属性 —— 逐条混两种粒度会让"整批是否原子"变成一句没法回答的话
 *   （见下"写盘粒度"）。
 * ★ **写盘粒度（两种 scope 有意不同，[C] 的 description 里也明写了）**：
 *   - `scope='module'`：**全批原子** —— 任一条被阻断 ⇒ 整批不落盘（阻断常是跨条目性质）。
 *   - `scope='local'` ：**逐项独立** —— 某一项找不到绑定/名字歧义/撞名/非法名 ⇒ 只跳它，
 *     其余照改（局部改名的失败天然是逐项的）；跳过项逐条可见（`blocked[]` / 回执里列出）。
 *   两种情形都在 `previews[].ok` / `blocked[]` 上**同义**：`ok=false` ⇔ 该项不能落盘、理由在 `blocked`。
 *
 * 与 `rename_files` 的分工（**不同操作对象，不聚合**）：那个改的是**文件系统实体**（路径 + 全仓 import 改写）；
 * 本工具改的是**标识符**（符号绑定 + 引用点）。`suggest_renames` / `find_similar_names` 是只读分析层，
 * 与本工具是上下游（它们出建议，本工具落盘），同样不聚合。
 */

import { DATA_DIR_NAME } from '../../infrastructure/data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { renameSymbol, type RenameSymbolInput, type RenameSymbolResult } from './rename_symbol.js';
import { renameLocals, type LocalRenameOutcome } from './rename_local.js';
import { resolveProjectRoot } from '../cross/project_root.js';
import { createProtectGuard } from './protect.js';
import { writeSourceFiles, type WriteThroughOutcome } from '../observe/write_gate.js';
import type { ExternalRef } from '../cross/project_root.js';
import { skipDirSet } from '../../infrastructure/parse/source_exts.js';
import { withTouched, type Touched, type TouchedProduct } from '../../domain/b_terms.js';

/** 字面量命中的类别：contract=对外工具注册名(破坏契约需人审)；history=tool-convergence 历史记录(保留原貌)；docs=文档；test=测试断言；code=源码字符串 */
export type LiteralMatchKind = 'contract' | 'history' | 'docs' | 'test' | 'code';

/** 单条字面量的改名决策：apply=可自动替换；review=契约需人审；preserve=历史保留；frozen=冻结行跳过；generated=生成物不落盘 */
export type LiteralDecision = 'apply' | 'review' | 'preserve' | 'frozen' | 'generated';

/** 单个字面量命中的原始信息（扫描产出，不含决策） */
export interface RawLiteralMatch {
  file: string;
  line: number;
  /** needle 在该文件内的字节偏移（可精确定位替换） */
  pos: number;
  /** 命中字面量长度（即 needle 长度） */
  len: number;
  snippet: string;
  kind: LiteralMatchKind;
}

/** 单个字面量命中（含决策与替换名，可落盘/验证） */
export interface LiteralMatch extends RawLiteralMatch {
  decision: LiteralDecision;
  /** 命中的字面量（needle，旧蛇形名） */
  old: string;
  /** 替换后蛇形名（新名；仅 decision=apply 会被写盘） */
  new: string;
}

export interface RenameSymbolsItem {
  /** 定义/所在文件（绝对路径；或相对 cwd / project_dir 路径） */
  file: string;
  /**
   * 要改名的标识符**当前**的名字：
   *   - `scope='module'`：该文件的**模块级声明名**（或它 import 进来的远程名）
   *   - `scope='local'` ：该文件的**局部绑定名**（函数/块内 const·let·var、形参、catch 参数）
   */
  symbol: string;
  /** 新符号名（合法标识符） */
  to: string;
  /**
   * ★ `scope='local'` 专用：声明所在**行号**（1-based）——同名绑定多于一个（不同函数 / 块级遮蔽）时消歧。
   * 缺省时若该名在本文件唯一 ⇒ 直接用；不唯一 ⇒ 该条被拒并列出候选（不猜）。
   * 只为名字寻址才需要它：内部 `id` 是不可复算的遍历序号，源码一变就会静默指到别的绑定（改错变量）。
   */
  decl_line?: number;
  /** ★ 仅 `scope='module'`：true=符号是文件主导出（文件名=符号名）时联动改文件名（默认 false）。local 支收到 true 会拒该项 */
  rename_file_if_matching?: boolean;
}

export interface RenameSymbolsResult {
  ok: boolean;
  /** 本次走的**作用域分支**（回执永远自报家门，免得调用方靠猜） */
  scope: 'module' | 'local';
  /** true=本次为纯预览（dry_run=true 或任一条被阻断返回的整体不落盘预览） */
  dryRun?: boolean;
  /** 每个条目的 dry-run 结构化 diff（基于原始文件态；含 ok/blocked 信息） */
  previews: Array<{
    index: number;
    item: RenameSymbolsItem;
    ok: boolean;
    blocked?: string[];
    result?: RenameSymbolResult;
  }>;
  /** 真正落盘的条目（dry_run 时为 []; 部分成功后剩余被阻断时自此据实返回） */
  applied: Array<{ index: number; item: RenameSymbolsItem; result: RenameSymbolResult }>;
  /** 实际落盘文件总数 */
  filesWritten: number;
  /** 整体阻断理由（ok=false 时给出全部） */
  blocked?: string[];
  /** report_literals / apply_literals 时的字面量引用清单：每个旧符号的 snake 变体在项目文本里的命中（含决策与 new 替换名） */
  literals?: Array<{
    index: number;
    item: RenameSymbolsItem;
    needle: string;
    /** 新蛇形名（需要的话，字面量里它替换 needle） */
    toSnake: string;
    matches: LiteralMatch[];
  }>;
  /** apply_literals + 非 dry_run 时，字面量落盘的文件数 */
  literalFilesWritten?: number;
  /** 工作区外的 import 依赖边界（各条目 rename 反馈聚合）——只反馈不改 */
  externalRefs?: ExternalRef[];
  /**
   * ★ 索引写穿结果（2026-09-14）：改完源码后符号索引是否**已经跟着更新**。
   * 为什么必须返回：LLM 常常"改完立刻读"，若索引还是旧图，它会拿旧图做下一轮决策 ——
   * 这是"静默撒谎"，比报错危险得多。有了这个字段，调用方能明确知道"下一步读是可信的"。
   */
  indexWriteThrough?: WriteThroughOutcome;
}

/** `rename_symbols` 的**调用级入参**（[C] 逐字转发；语义见 `renameSymbols` 的文档与 `scope` 注释） */
export interface RenameSymbolsInput {
  /** 可省（`scope='module'` 时各条自动定位项目根；`scope='local'` 缺省时按第一条 file 自动定位） */
  project_dir?: string;
  /** `'module'`（缺省）= 模块级符号、跨文件；`'local'` = 文件内局部绑定（作用域隔离）。缺省即老行为 ⇒ 老调用方零改动 */
  scope?: 'module' | 'local';
  renames: RenameSymbolsItem[];
  /** true=只算全部 dry-run diff 不落盘；默认优先整体校验，全通过才落盘 */
  dry_run?: boolean;
  /** 仅 `scope='module'`：true=额外扫描每个旧符号的 snake 变体在项目文本里的字面量引用（如工具名 render_dsl 在错误提示/README 里的串），返回清单（只扫描，不改动） */
  report_literals?: boolean;
  /** 仅 `scope='module'`：true=在符号改名成功后，自动替换 decision=apply 的字面量（code/docs/test）；contract→需人审、history→保留、冻结行→跳过，均不写盘。dry_run 下只预览不入盘。 */
  apply_literals?: boolean;
}

/** 入口：按「作用域」路由。这是 [C] 唯一要认识的 [B] 符号。 */
async function renameSymbolsCore(input: RenameSymbolsInput): Promise<RenameSymbolsResult> {
  const scope: 'module' | 'local' = input.scope === 'local' ? 'local' : 'module';
  if (scope === 'local') return renameSymbolsLocal(input);
  // module 支（内部再按**语言**路由：.go/.py/.cs/.java/.c/TS）
  return { scope, ...(await renameSymbolsModule(input)) };
}

/** ★ 唯一的 `touched` 构造点（④-b）：把"这次调用动了什么"集中算一次，所有出口都从这一处出去。 */
function touchedOf(input: RenameSymbolsInput, r: RenameSymbolsResult): Touched {
  const touched: Touched = {};

  // project_dir：**作用域类** ⇒ 随时可给。本文件**算过但没有回传**（module 支的 rootDir、local 支的 rootDir 都是局部量）
  // ⇒ 只有入参显式给了才拿得到；否则省略（不猜）。
  if (typeof input.project_dir === 'string' && input.project_dir) touched.project_dir = input.project_dir;

  // ★ 对象类字段（symbols / written_files）统一口径（team-lead 2026-10-01 裁定）：
  //   它们描述「**本次调用之后确立下来的对象**」⇒ 只有**真的落盘**了才给；dry_run / 被阻断 / ok:false ⇒ 整项省略。
  const landed = r.ok === true && r.dryRun !== true && r.applied.length > 0;

  // symbols：**落定后的符号标识 = 新名**（下游要拿新名接着走；给旧名会让链静默接错）。
  //   批量 ⇒ 取改名成功那些项的 `to`（module / local 支的 applied[].result 都带 `to`）。
  if (landed) {
    const symbols = r.applied
      .map((a) => a.result.to)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (symbols.length > 0) touched.symbols = [...new Set(symbols)];
  }

  // written_files：只在**确实落盘**且**能完整枚举**时给。
  //   - dry_run / ok:false（整体阻断，或落盘中途阻断导致 ok:false）⇒ 不给（见上 `landed`）；
  //   - apply_literals 额外写了字面量文件（literalFilesWritten>0）时，产物只回计数不回文件表 ⇒ 枚举不全 ⇒ 整项省略；
  //   - 仅 scope='module'：其 definition/importers/fileRenamed 是**仓库相对路径 + `/`**（rename_symbol.ts 用
  //     `path.relative(resolvedRoot, …)` + `\\`→`/`）；而 scope='local' 的 file 是**绝对路径**（rename_local.ts:120 `abs(...)`），
  //     本函数又拿不到解析出的 root ⇒ 无法安全转相对 ⇒ local 支省略。
  const literalWroteExtra = typeof r.literalFilesWritten === 'number' && r.literalFilesWritten > 0;
  if (landed && r.scope === 'module' && !literalWroteExtra) {
    const files = new Set<string>();
    for (const a of r.applied) {
      const res = a.result;
      if (res.definition?.file) files.add(res.definition.file);
      for (const im of res.importers ?? []) files.add(im.file);
      if (res.fileRenamed) files.add(res.fileRenamed);
    }
    if (files.size > 0) touched.written_files = [...files];
  }

  return touched;
}

/** 导出的 [B] 入口：薄壳，唯一职责是把 `touched` 挂到产物上（实现见 `renameSymbolsCore`）。 */
export async function renameSymbols(input: RenameSymbolsInput): Promise<TouchedProduct<RenameSymbolsResult>> {
  const r = await renameSymbolsCore(input);
  return withTouched(r, touchedOf(input, r));
}

/** module 支的实体（调用级入参去掉 `scope` —— 路由已经选定它了） */
async function renameSymbolsModule(input: Omit<RenameSymbolsInput, 'scope'>): Promise<Omit<RenameSymbolsResult, 'scope'>> {
  const { renames, dry_run } = input;
  const projectDir = typeof input.project_dir === 'string' && input.project_dir ? input.project_dir : undefined;
  const blocked: string[] = [];

  if (!renames || renames.length === 0) return { ok: false, dryRun: true, previews: [], applied: [], filesWritten: 0, blocked: ['批量列表为空'] };

  // 跨条目基础校验：同 file+symbol 重复
  const seenKeys = new Set<string>();
  for (const it of renames) {
    const key = `${it.file}\u0000${it.symbol}`;
    if (seenKeys.has(key)) blocked.push(`重复条目：${it.file} 的 ${it.symbol}`);
    seenKeys.add(key);
  }
  if (blocked.length > 0) return { ok: false, dryRun: true, previews: [], applied: [], filesWritten: 0, blocked };

  // report_literals：扫描每个旧符号 snake 变体的字面量命中（只报告不改动）
  const rootDir = (() => {
    if (projectDir) return projectDir;
    if (renames[0]?.file) {
      try {
        return resolveProjectRoot(renames[0].file);
      } catch {
        return undefined;
      }
    }
    return undefined;
  })();
  let literals: RenameSymbolsResult['literals'];
  let literalFilesWritten = 0;
  const wantLiteral = input.report_literals === true || input.apply_literals === true;
  if (wantLiteral && rootDir) {
    const guard = createProtectGuard(rootDir);
    // 预览计划（对当前盘态命中做决策，供 dry_run/阻断预览/最终报告）
    literals = buildLiteralPlan(rootDir, renames, guard);
  }

  // 阶段 1：全部 dry_run 预览（基于原始文件态，不落盘）
  const previews: RenameSymbolsResult['previews'] = [];
  let allOk = true;
  for (let i = 0; i < renames.length; i++) {
    const item = renames[i];
    const result = await renameSymbol({ project_dir: projectDir, file: item.file, symbol: item.symbol, to: item.to, rename_file_if_matching: item.rename_file_if_matching === true, dry_run: true });
    previews.push({ index: i, item: item, ok: result.ok, blocked: result.ok ? undefined : result.blocked, result: result });
    if (!result.ok) allOk = false;
  }

  // 跨条目聚合：工作区外的 import 依赖边界（只反馈不改）
  const externalRefs = previews.flatMap((p) => p.result?.externalRefs ?? []);

  // 任一阻断 → 整体不落盘，给预览报告
  if (!allOk) return { ok: false, dryRun: true, previews, applied: [], filesWritten: 0, blocked: ['至少一个条目被阻断→整体未落盘'], literals, ...(externalRefs.length ? { externalRefs } : {}) };

  // dry_run 显式要求 → 只预览
  if (dry_run === true) return { ok: true, dryRun: true, previews, applied: [], filesWritten: 0, literals, ...(externalRefs.length ? { externalRefs } : {}) };

  // 阶段 2：全部通过 → 逐条真落盘（串行；前面改动导致后续阻断则中止并据实报告）
  //
  // ★ 走**统一写入闸**（2026-09-14）：
  //   旧的实现直接 `renameSymbol(..., dry_run:false)` 落盘，**既不快照、也不通知索引** ——
  //   于是"改完符号名，紧接着 find_references / impact_analysis"读到的还是**旧图**，
  //   而且引用方的边被 FK 级联删掉后不会重建（真 bug：静默漏报）。
  //   现在：写前快照（可撤回）+ 写后把**实际写到的文件**同步进索引并把引用方重开重算。
  //   受影响文件列表先按 dry-run 的预览算出来（快照要用），落盘时再把实际写到的 push 进去。
  const touched: string[] = [];
  for (const p of previews) {
    const r = p.result;
    if (!r) continue;
    if (r.definition?.file) touched.push(r.definition.file);
    for (const im of r.importers ?? []) touched.push(im.file);
    if (r.fileRenamed) touched.push(r.fileRenamed);
  }
  if (input.apply_literals === true) {
    for (const item of literals ?? []) {
      for (const m of item.matches) if (m.decision === 'apply') touched.push(m.file);
    }
  }

  const doWrite = async (): Promise<Omit<RenameSymbolsResult, 'scope'>> => {
    const applied: RenameSymbolsResult['applied'] = [];
    let filesWritten = 0;
    for (let i = 0; i < renames.length; i++) {
      const item = renames[i];
      const result = await renameSymbol({ project_dir: projectDir, file: item.file, symbol: item.symbol, to: item.to, rename_file_if_matching: item.rename_file_if_matching === true, dry_run: false });
      if (!result.ok) {
        return {
          ok: false,
          previews,
          applied,
          filesWritten,
          blocked: [`条目 ${i}（${item.file} 的 ${item.symbol}→${item.to}）实际落盘时被阻断：${(result.blocked || []).join('；')}。已应用 ${applied.length} 条，之后条目未执行`],
          literals,
          literalFilesWritten,
        };
      }
      filesWritten += result.filesWritten;
      if (result.definition?.file) touched.push(result.definition.file);
      for (const im of result.importers ?? []) touched.push(im.file);
      applied.push({ index: i, item: item, result: result });
    }

    // apply_literals：符号已全落盘 → 重新扫盘态（偏移对符号改动后的真值），只替换 decision=apply 的字面量。
    // contract→需人审、history→保留、冻结行→跳过，均不写盘；decision 明细随 literals 返回供复核。
    if (input.apply_literals === true && rootDir) {
      const guard = createProtectGuard(rootDir);
      const fresh = buildLiteralPlan(rootDir, renames, guard);
      const lit = applyLiteralPlan(fresh);
      literalFilesWritten = lit.filesWritten;
      for (const f of lit.files) touched.push(f);
      literals = fresh;
    }

    return { ok: true, previews, applied, filesWritten, ...(literalFilesWritten ? { literalFilesWritten } : {}), literals, ...(externalRefs.length ? { externalRefs } : {}) };
  };

  // 项目根算不出来（既没显式给 project_dir、也定位不到）→ 退化为直写：
  // 没有根就无从算相对路径，快照与写穿都会变成空操作，不如如实跳过（并如实标注）。
  const gateRoot = rootDir ?? projectDir;
  if (!gateRoot) {
    const value = await doWrite();
    return { ...value, indexWriteThrough: { ok: false, mode: 'skipped', note: '未定位到项目根 ⇒ 跳过快照与索引写穿' } };
  }

  const gated = await writeSourceFiles(gateRoot, touched, doWrite, { label: `rename_symbols: ${renames.length} 条` });
  return { ...gated.value, indexWriteThrough: gated.report.index ?? { ok: false, mode: 'skipped', note: '未写穿' } };
}

// ──────────────── scope='local' 支：文件内局部绑定（产物适配成上面同一封回执） ────────────────

/** 局部支逐项 → 与 module 支**同型**的单项结果（`definition.file` = 该文件，`definition.edits` = 替换点数） */
function localItemResult(it: LocalRenameOutcome, dryRun: boolean): RenameSymbolResult {
  const where = it.declLine === undefined ? '' : `声明第 ${it.declLine} 行${it.parentFunction ? `（函数 ${it.parentFunction}）` : ''}`;
  return {
    ok: it.ok,
    symbol: it.symbol,
    to: it.to,
    ...(it.changed > 0
      ? {
          definition: {
            file: it.file,
            edits: it.changed,
            note: `文件内局部绑定（作用域隔离）：${where}；替换 ${it.changed} 处（声明+赋值+引用）`,
          },
        }
      : {}),
    filesWritten: it.ok && !dryRun ? 1 : 0,
    dryRun,
    // 跳过项走**同一封信**：`{path, why}` 就是"这个文件上我没做的那件事 + 为什么"（§2d）
    ...(it.blocked?.length ? { skipped: it.blocked.map((why) => ({ path: it.file, why })) } : {}),
  };
}

/**
 * `scope='local'` 支：作用域分析复用 `ast_rename`，落盘复用 `applyWrites` —— 本函数只做
 * **定位项目根 + 把逐项产物适配成共享回执**这两件"胶水"，不讲第二套改名/落盘实现。
 */
async function renameSymbolsLocal(input: RenameSymbolsInput): Promise<RenameSymbolsResult> {
  const empty = { scope: 'local' as const, dryRun: true, previews: [], applied: [], filesWritten: 0 };
  const renames = input.renames;
  if (!renames || renames.length === 0) return { ...empty, ok: false, blocked: ['批量列表为空'] };
  if (input.report_literals === true || input.apply_literals === true) {
    return {
      ...empty,
      ok: false,
      blocked: [
        'scope=local 不支持字面量引用扫描（report_literals / apply_literals）：那扫的是**模块级符号名**在项目文本里的 snake 字面量（对外契约名/文档串），局部变量不进对外契约' +
          ' ⇒ 如需请用 scope=module',
      ],
    };
  }

  // 项目根：显式给了就用；缺省按第一条 file 自动定位（与 module 支的兜底同源，都用 resolveProjectRoot）
  const first = String(renames[0].file);
  const rootDir =
    typeof input.project_dir === 'string' && input.project_dir
      ? input.project_dir
      : resolveProjectRoot(path.isAbsolute(first) ? first : path.resolve(process.cwd(), first));

  const r = await renameLocals({
    root: rootDir,
    renames: renames.map((x) => ({
      file: String(x.file),
      symbol: String(x.symbol),
      to: String(x.to),
      ...(typeof x.decl_line === 'number' ? { decl_line: x.decl_line } : {}),
      rename_file_if_matching: x.rename_file_if_matching === true,
    })),
    dry_run: input.dry_run === true,
  });

  const previews: RenameSymbolsResult['previews'] = r.items.map((it) => ({
    index: it.index,
    item: renames[it.index],
    ok: it.ok,
    ...(it.blocked?.length ? { blocked: it.blocked } : {}),
    result: localItemResult(it, r.dryRun),
  }));
  const applied: RenameSymbolsResult['applied'] = r.dryRun || !r.ok
    ? []
    : previews.filter((p) => p.ok).map((p) => ({ index: p.index, item: p.item, result: p.result! }));

  return {
    ok: r.ok,
    scope: 'local',
    dryRun: r.dryRun,
    previews,
    applied,
    filesWritten: r.filesWritten,
    ...(r.blocked?.length ? { blocked: r.blocked } : {}),
    indexWriteThrough:
      r.index ?? {
        ok: false,
        mode: 'skipped',
        note: r.dryRun ? 'dry_run：未落盘 ⇒ 未做索引写穿' : '无改动 ⇒ 未落盘、未做索引写穿',
      },
  };
}

// ──────────────── 字面量引用扫描（只报告，不改动） ────────────────

/** camelCase/PascalCase → snake_case。如 'renderDesign' → 'render_design'。 */
export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').replace(/^_/, '').toLowerCase();
}

/** 按文件名/行内容判定字面量命中的类别（契约名 / 历史记录 / 文档 / 测试 / 源码） */
function classifyLiteral(file: string, lineText: string, needle: string): LiteralMatchKind {
  const rel = file.split(path.sep).join('/');
  // 对外工具注册名：server_registry 里 `name: 'needle'`（改名会破坏 MCP 调用契约 → 需人审）
  if (/server_registry/i.test(rel) && new RegExp(`name:\\s*['"\`]${needle}['"\`]`).test(lineText)) return 'contract';
  // 历史决策记录：tool-convergence 等，改名应保留原貌
  if (/tool-convergence|docs\/plans/i.test(rel)) return 'history';
  // 文档类：README / AGENTS / CONTRIBUTING / skill / issue 模板
  if (/README|AGENTS|CONTRIBUTING|ISSUE_TEMPLATE|SKILL\.md|docs\//i.test(rel)) return 'docs';
  // 测试断言
  if (/tests\/|\.test\.|\.spec\./i.test(rel)) return 'test';
  return 'code';
}

/** 解析根 .gitignore 中形如 `/<name>/`、`<name>/`、`/<name>`、`<name>` 的顶层目录忽略项。 */
function gitIgnoredTopDirs(root: string): Set<string> {
  const out = new Set<string>();
  try {
    const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('!') || t.includes('*') || t.includes('**')) continue;
      const m = t.match(/^\/?([^/#?\\][^/]*?)\/?$/);
      if (!m) continue;
      const name = m[1];
      if (name && name !== '.git' && !name.includes('.')) out.add(name);
    }
  } catch { /* 无 .gitignore 则视为无忽略项 */ }
  return out;
}

/** 在 projectDir 下扫描所有常见文本文件，返回 needle 列表的命中（含字节偏移，非二进制/非编译产物） */
export function scanLiteralOccurrences(
  projectDir: string,
  needles: string[],
): Array<{ needle: string; matches: RawLiteralMatch[] }> {
  const result: Array<{ needle: string; matches: RawLiteralMatch[] }> = [];
  if (needles.length === 0) return result;

  // 只扫描常见可读扩展名（排除二进制/编译产物）
  const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.json', '.md', '.yml', '.yaml', '.html', '.css', '.vue', '.py', '.go', '.java', '.sh', '.mjs']);
  // ★ `.agent-io` 必须跳过（2026-09-14 发现的真 bug）：
  //   里面是我们自己的派生物 —— 缓存库、`code-snapshots/` 影子副本、`live/` DSL。
  //   尤其**影子副本就是被扫描文件的旧文本副本**：扫到它们既会虚增命中数，
  //   又会把"可撤回的快照"本身改写掉（等于毁掉回滚能力）。
  // ★ 迁到内核同源跳过集（2026-09-28）：基础集由 `source_exts.SKIP_DIR_BASE` 唯一提供
//   ⇒ 本行的数组是**本调用方显式追加**的语言/用途专属项（有意变宽的部分已在提交里声明）
const SKIP_DIRS = skipDirSet(['.github']);
  // 根 .gitignore 标记为忽略的顶层目录：git-ignore 了 = 非一手源码（依赖/派生物），不扫。
  const gitIgnored = gitIgnoredTopDirs(projectDir);

  const files: string[] = [];
  function walk(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !gitIgnored.has(entry.name)) walk(path.join(dir, entry.name));
        } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch { /* 权限/临时目录跳过 */ }
  }
  walk(projectDir);

  // 对每个 needle 逐文件扫描全部出现点（含字节偏移）
  for (const needle of needles) {
    if (!needle) continue;
    const matches: RawLiteralMatch[] = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(f, 'utf-8');
        const lineStart: number[] = [0];
        for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) lineStart.push(i + 1);
        const lines = content.split('\n');
        for (let li = 0; li < lines.length; li++) {
          const text = lines[li];
          let idx = text.indexOf(needle);
          while (idx >= 0) {
            const pos = lineStart[li] + idx;
            matches.push({
              file: f,
              line: li + 1,
              pos,
              len: needle.length,
              snippet: text.trim().substring(0, 120),
              kind: classifyLiteral(f, text, needle),
            });
            idx = text.indexOf(needle, idx + needle.length);
          }
        }
      } catch { /* 跳过无法读的文件 */ }
    }
    result.push({ needle, matches });
  }

  return result;
}

// ──────────────── 字面量改名决策 + 落盘（补全闭环） ────────────────

/** 单个字面量命中 → 改名决策：生成物不落盘；contract 契约需人审；history 历史保留；冻结行跳过；其余可自动替换 */
function decideLiteral(kind: LiteralMatchKind, frozen: boolean, isGenerated: boolean): LiteralDecision {
  if (isGenerated) return 'generated';
  if (kind === 'contract') return 'review';
  if (kind === 'history') return 'preserve';
  if (frozen) return 'frozen';
  return 'apply';
}

/**
 * 构建字面量改名计划：对每个 renames 条目，扫其蛇形旧名的全部命中，并为每处算决策与替换名。
 * @param guard 冻结行保护守卫（可空）；为空则无冻结/生成物判定。
 */
export function buildLiteralPlan(
  rootDir: string,
  renames: RenameSymbolsItem[],
  guard?: { isFrozen(absFile: string, src: string, pos: number): boolean; isGeneratedFile(absFile: string): boolean } | null,
): RenameSymbolsResult['literals'] {
  const needles = [...new Set(renames.map((i) => camelToSnake(i.symbol)).filter(Boolean))];
  const scanned = scanLiteralOccurrences(rootDir, needles);
  const contentCache = new Map<string, string>();
  const contentOf = (f: string): string => {
    let c = contentCache.get(f);
    if (c === undefined) {
      try {
        c = fs.readFileSync(f, 'utf-8');
      } catch {
        c = '';
      }
      contentCache.set(f, c);
    }
    return c;
  };
  return renames.map((item, index) => {
    const needle = camelToSnake(item.symbol);
    const toSnake = camelToSnake(item.to);
    const hit = scanned.find((s) => s.needle === needle);
    const matches = (hit ? hit.matches : []).map((m) => {
      const frozen = guard ? guard.isFrozen(m.file, contentOf(m.file), m.pos) : false;
      const isGen = guard ? guard.isGeneratedFile(m.file) : false;
      return { ...m, decision: decideLiteral(m.kind, frozen, isGen), old: needle, new: toSnake };
    });
    return { index, item, needle, toSnake, matches };
  });
}

/** 落盘字面量计划：只写 decision=apply 的命中（code/docs/test；契约/历史/冻结行跳过）。返回写入文件数与文件清单。 */
export function applyLiteralPlan(plan: RenameSymbolsResult['literals']): { filesWritten: number; files: string[] } {
  const byFile = new Map<string, Array<{ pos: number; len: number; text: string }>>();
  if (!plan) return { filesWritten: 0, files: [] };
  for (const item of plan) {
    for (const m of item.matches) {
      if (m.decision !== 'apply') continue;
      let a = byFile.get(m.file);
      if (!a) {
        a = [];
        byFile.set(m.file, a);
      }
      a.push({ pos: m.pos, len: m.len, text: m.new });
    }
  }
  let filesWritten = 0;
  // ★ 返回文件清单：调用方要靠它做索引写穿（文档/测试里的字面量也进了源码语义，
  //   只同步"符号定义所在文件"会漏掉这些）
  const files: string[] = [];
  for (const [file, edits] of byFile) {
    let src: string;
    try {
      src = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const sorted = [...edits].sort((a, b) => b.pos - a.pos);
    let out = src;
    for (const e of sorted) out = out.slice(0, e.pos) + e.text + out.slice(e.pos + e.len);
    if (out !== src) {
      fs.writeFileSync(file, out, 'utf-8');
      filesWritten++;
      files.push(file);
    }
  }
  return { filesWritten, files };
}