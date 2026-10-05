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
 *                           ├─ '.cs'  → renameCSharpSymbol()   ┐ 共用引擎
 *                           ├─ '.java'→ renameJavaSymbol()     ┘ (namespace_family)
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

import { DATA_DIR_NAME } from '../../../infrastructure/data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { renameSymbol, type RenameSymbolInput, type RenameSymbolResult } from '../../../infrastructure/analysis/rename_symbol/index.js';
import { renameLocals, type LocalRenameOutcome } from './rename_local.js';
import { renameFile } from './rename_file.js';
import { resolveProjectRoot } from '../../../infrastructure/analysis/project_root/index.js';
import { createProtectGuard } from '../../../infrastructure/analysis/refactor/protect.js';
import { writeSourceFiles, type WriteThroughOutcome } from '../../write_gate.js';
import type { ExternalRef } from '../../../infrastructure/analysis/project_root/index.js';
import { skipDirSet, TS_JS_EXTS } from '../../../infrastructure/parse/source_exts.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

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

/**
 * 模块支（`scope='module'`）单条的产物 = 引擎产物（`RenameSymbolResult`）+ **工具层补出的文件联动产物**。
 *
 * ★ T42 2b-C1（2026-10-05）：`fileRenamed` / `fileRenameBlocked` 原本是**引擎**字段
 *   （`rename_symbol/languages/typescript.ts` 内部直接调文件改名）。现联动**上收到工具**：
 *   「文件名 = 主导出符号名」是**项目约定**、改文件名是**文件系统操作** —— 两样都是编排层
 *   的知识；语言包（引擎）不该知道"文件可以被改名"。契约回到一句话：
 *   「给定 file+symbol+to，算出要改哪些文件、每处改什么」。
 *   ⇒ 字段名**沿用**（下游读数路径不变的），但落在**工具自己的产物**上
 *   （`previews[].result` / `applied[].result`）。
 *   ★ 语义**逐字保持**：dry-run 只给计划中的新相对路径（不动盘）；真落盘失败**不阻断**整体（ok 仍 true）。
 */
export type ModuleSymbolRenameResult = RenameSymbolResult & {
  /** 联动改名后的新路径（仓库相对 POSIX；dry-run 下为计划值）；未开启联动 / 未命中 / 未落定时缺省 */
  fileRenamed?: string;
  /** 文件联动失败理由（符号已改名成功、仅联动未执行时给出；★ 不阻断整体 ok） */
  fileRenameBlocked?: string[];
};

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
    result?: ModuleSymbolRenameResult;
  }>;
  /** 真正落盘的条目（dry_run 时为 []; 部分成功后剩余被阻断时自此据实返回） */
  applied: Array<{ index: number; item: RenameSymbolsItem; result: ModuleSymbolRenameResult }>;
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
  /**
   * ★ 本次**解析出的项目根**（module 支的 `rootDir` / local 支的 `rootDir`）——
   *   两支各自在内部定位过它（此前只在手里、没进产物）；T18：回传给构造点与下游反查。
   *   作用域类字段（= `Touched.project_dir` 的产物来源）：随时可给，不依赖成败。
   *   ★ 字段名 = 受控词表的 `project_dir`（原 `root` 不在词表里 ⇒ 同一事实两个名字，2026-10-05 收口）。
   */
  project_dir?: string;
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

  // project_dir（**作用域类** ⇒ 随时可给）：**优先取入参**（调用方声明的根）；
  //   入参没给则取**产物里的 project_dir**（module 支 / local 支内部已定位到的根，见 r.project_dir）；两者都取不到才省略（不猜、不兜底 cwd）。
  // ★ 2026-10-05 修正：入参**必须 `path.resolve`** —— 契约（`b_terms.ts` 的 `Touched.project_dir`）明文
  //   「填**解析后的绝对根**，不是入参原值」。此处原先是**原样透传**，于是同一个契约字段在
  //   `rename_symbol` / `find_references`（两者一直 `path.resolve`）与 `rename_symbols`（原样）之间**口径不一致**
  //   —— 实测：传 `project_dir:"."` 时前者给 `C:\tmp\pj51`、后者给 `"."`。属**既有的判据分叉**，本笔收口。
  if (typeof input.project_dir === 'string' && input.project_dir) {
    touched.project_dir = path.resolve(input.project_dir);
  } else if (r.project_dir) {
    touched.project_dir = r.project_dir;
  }

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

  // written_files：只在**确实落盘**时给，填**仓库相对路径 + `/`**。
  //   ★ T18(4)：产物里现在带 `project_dir`（module 支 / local 支各自定位的根）⇒ 三种来源都能归一成仓库相对：
  //     - module 支：各条目 result 的 definition/importers 由引擎给（rename_symbol.ts 用 path.relative(resolvedRoot,…)），
  //       `fileRenamed` 由**本工具层**的联动算出（同在仓库相对 POSIX 口径）——三者本就是仓库相对；
  //     - local 支：result.definition.file 是**绝对路径**（rename_local.ts:120 `abs(...)`）⇒ 用 r.project_dir 转相对；
  //     - apply_literals：额外落盘的字面量文件**已可由产物枚举**（literals[].matches[] 带 file + decision='apply'）
  //       —— 仅在**确实有字面量落盘**（literalFilesWritten>0）时纳入（report_literals 只扫不写，其 decision 也可能是 'apply'）。
  //   r.project_dir 取不到时保持原样（module 支本就相对）；无任何可枚举文件才整项省略。
  if (landed) {
    const toRepoRel = (f: string): string => {
      if (!r.project_dir || !f) return f;
      const abs = path.isAbsolute(f) ? f : path.resolve(r.project_dir, f);
      return path.relative(path.resolve(r.project_dir), abs).split(path.sep).join('/') || f;
    };
    const files = new Set<string>();
    for (const a of r.applied) {
      const res = a.result;
      // ★ 2026-10-05 修：定义文件若被「文件联动」改名（`fileRenamed` 有值），**盘上只剩新名**
      //   ⇒ **只列新名，不列已不存在的旧名**。依据三条：
      //   ① 口径「只列本次操作对**被操作对象**产生的**工作产物**」—— 旧名已被本操作删除；
      //   ② 同族 `rename_file` 的收据也是**只列新名 + importers，从不列 fromRel**（同一个惯例）；
      //   ③ ★ 修前这里与**引擎自己的 per-item 收据**打架：引擎是 `if fileRenamed … else if definition`
      //      （只列一个），本层却两个都列 ⇒ **同一次调用里两层口径不一致**（判据分叉）。
      if (!res.fileRenamed && res.definition?.file) files.add(toRepoRel(res.definition.file));
      for (const im of res.importers ?? []) files.add(toRepoRel(im.file));
      if (res.fileRenamed) files.add(toRepoRel(res.fileRenamed));
    }
    if (typeof r.literalFilesWritten === 'number' && r.literalFilesWritten > 0) {
      for (const item of r.literals ?? []) {
        for (const m of item.matches) if (m.decision === 'apply') files.add(toRepoRel(m.file));
      }
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

/**
 * ★ 文件联动（**工具层**关切，T42 2b-C1 从引擎上收）：算「符号=文件主导出 ⇒ 文件也该改名」的计划。
 *
 * 触发条件（与旧引擎实现**逐字一致**）：
 *   ① `item.rename_file_if_matching === true`；
 *   ② 定义文件去扩展名的 basename === `item.symbol`（文件名 = 旧符号名 = "文件主导出"约定）；
 *   ③ 定义文件属 **TS/JS 家族**（★ 旧实现里该联动**只**在 TS 语言包里实现 ⇒ 加此门才叫逐字一致，
 *      否则会给 Go/Python 等加上它们从来不做的文件改名，那是**扩了行为**而非搬位置）。
 * ★ **只算路径、不动盘** —— dry-run / 真落盘由调用方按同一份计划决定。
 * @param fallbackRoot 引擎逐条回传的 `res.project_dir` 取不到时的退路（调用级 rootDir / projectDir）。
 */
function planLinkedFileRename(
  item: RenameSymbolsItem,
  res: RenameSymbolResult,
  fallbackRoot: string | undefined,
): { root: string; fromAbs: string; toAbs: string; relNew: string } | null {
  if (item.rename_file_if_matching !== true || !res.ok || !res.definition?.file) return null;
  // 用引擎**逐条回传**的项目根（`res.project_dir`）—— 与旧引擎内部用的 `resolvedRoot` 同源，
  // 保证 relNew 的相对基准逐字一致；取不到才退到调用级 rootDir/projectDir。
  const root = res.project_dir ?? fallbackRoot;
  if (!root) return null;
  const defAbs = path.resolve(root, res.definition.file);
  const defExt = path.extname(defAbs);
  if (!(TS_JS_EXTS as readonly string[]).includes(defExt)) return null;
  if (path.basename(defAbs, defExt) !== item.symbol) return null;
  const toAbs = path.join(path.dirname(defAbs), item.to + defExt);
  const relNew = (path.relative(root, toAbs) || toAbs).split(path.sep).join('/');
  return { root, fromAbs: defAbs, toAbs, relNew };
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
    const result: ModuleSymbolRenameResult = await renameSymbol({ project_dir: projectDir, file: item.file, symbol: item.symbol, to: item.to, dry_run: true });
    // ★ 文件联动（dry-run）：只算**计划中的新文件名**、不动盘 —— 仍要出现在预览里（与旧引擎同语义）。
    const linkPlan = planLinkedFileRename(item, result, rootDir ?? projectDir);
    if (linkPlan) result.fileRenamed = linkPlan.relNew;
    previews.push({ index: i, item: item, ok: result.ok, blocked: result.ok ? undefined : result.blocked, result: result });
    if (!result.ok) allOk = false;
  }

  // 跨条目聚合：工作区外的 import 依赖边界（只反馈不改）
  const externalRefs = previews.flatMap((p) => p.result?.externalRefs ?? []);

  // 任一阻断 → 整体不落盘，给预览报告
  if (!allOk) return { ok: false, dryRun: true, previews, applied: [], filesWritten: 0, blocked: ['至少一个条目被阻断→整体未落盘'], literals, ...(rootDir ? { project_dir: rootDir } : {}), ...(externalRefs.length ? { externalRefs } : {}) };

  // dry_run 显式要求 → 只预览
  if (dry_run === true) return { ok: true, dryRun: true, previews, applied: [], filesWritten: 0, literals, ...(rootDir ? { project_dir: rootDir } : {}), ...(externalRefs.length ? { externalRefs } : {}) };

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
      const result: ModuleSymbolRenameResult = await renameSymbol({ project_dir: projectDir, file: item.file, symbol: item.symbol, to: item.to, dry_run: false });
      if (!result.ok) {
        return {
          ok: false,
          previews,
          applied,
          filesWritten,
          blocked: [`条目 ${i}（${item.file} 的 ${item.symbol}→${item.to}）实际落盘时被阻断：${(result.blocked || []).join('；')}。已应用 ${applied.length} 条，之后条目未执行`],
          literals,
          literalFilesWritten,
          ...(rootDir ? { project_dir: rootDir } : {}),
        };
      }
      filesWritten += result.filesWritten;
      // ★ 文件联动（真落盘）：**符号已改名成功之后**才做（顺序与旧引擎一致：先符号、后文件）。
      //   联动**非阻断** —— 失败只记理由，整体仍 ok:true（这条语义逐字保持）。
      const linkPlan = planLinkedFileRename(item, result, rootDir ?? projectDir);
      if (linkPlan) {
        const fr = await renameFile({ project_dir: linkPlan.root, from: linkPlan.fromAbs, to: linkPlan.toAbs, dry_run: false });
        if (fr.ok && fr.moved) result.fileRenamed = linkPlan.relNew;
        else result.fileRenameBlocked = fr.blocked?.length ? fr.blocked : ['文件联动未执行（rename_file 返回未移动）'];
      }
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

    return { ok: true, previews, applied, filesWritten, ...(literalFilesWritten ? { literalFilesWritten } : {}), literals, ...(rootDir ? { project_dir: rootDir } : {}), ...(externalRefs.length ? { externalRefs } : {}) };
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
    project_dir: rootDir,
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