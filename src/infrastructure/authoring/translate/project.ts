/**
 * project —— 项目级 Go→TS 翻译（`translateGoProject`）
 *
 * 把一个 Go 项目目录变成一棵 TS 模块树：枚举所有 .go，逐个译成 TS 模块，
 * 用"项目符号名 → 定义文件"映射为每个模块生成跨文件 import（类型引用落地，
 * 签名才不悬空）。复用单文件 translateGoToTs / 骨架 / 验证闸，零前置。

 * 诚实边界：只给类型引用做跨文件 import；函数体里的跨文件函数调用归 LLM；
 * Go stdlib / 外部类型不硬解、同名冲突不 import，均记 diagnostic。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { translateGoToTs } from './pairs.js';
import { channelShimSource } from './ts_codegen.js';
import { collectQualifiedPkgs, renderGoStdAdapter } from './go_std.js';
import { buildMethodIndex, rewriteMethodCalls } from './ref_rewrite.js';
import { CAPABILITIES, lossinessOfUnit } from './pivot.js';
// ★ T-#TSC-DRIVEN-FIX 步 2：管线内后处理（用 tsc 报错当接收者类型口径）
import { applyTscDrivenFixes } from './tsc_fix.js';
import { renderSlotShim } from './slots.js';
import { setValueStructTypes } from './body_pivot.js';
import { collectExternalTypeRefs } from './referenced.js';
import { spliceBody, normalizeLegacyOctal } from './fill.js';
import { fillUnitsWithRetry, fillUnitsBatched } from './fill.js';
import { createPooledBatchTranslator } from './llm.js';
import { applyDeterministicFixers } from './fixers.js';
// ★ I3：翻译 DB 投影 + 术语表进 prompt（按图索骥）
import { attachBookFacts, loadTranslateBooks, type TranslateBook } from './book.js';
import { findBookSymbol, skeletonFromSigTs } from './book_ts.js';
import type { SkippedDecl } from './go_extractor.js';
import { parseFileFull } from '../../parse/index.js';
import type { TransUnit } from './unit.js';
import type { VerifyIssue } from './verify.js';
// ★★★ 2026-10-29（T-#CACHE-GATE）：缓存体消费前必须过**当前**判据，否则新判据只管未来。
import { undeclaredNameIssues } from './verify.js';
import { skipDirSet } from '../../parse/source_exts.js';

/** 项目内跳过的噪声目录（不进 .go 扫描） */
const SKIP_DIRS = skipDirSet(['vendor', 'target']);

/** 递归收集 .go 源文件（跳过 _test.go 与噪声目录） */
export function walkGoFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [path.resolve(dir)];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(p);
      } else if (e.isFile() && e.name.endsWith('.go') && !e.name.endsWith('_test.go')) {
        out.push(p);
      }
    }
  }
  return out.sort();
}

export interface ProjectModule {
  /** 源 .go 绝对路径 */
  fileAbs: string;
  /** 相对 projectDir 的相对路径（正斜杠，.go） */
  rel: string;
  /** 输出相对路径（.ts） */
  tsRel: string;
  /** 组装后的模块内容（imports + 可能的 Channel 垫片 + 模块体） */
  ts: string;
  /** 生成的跨文件 import 语句 */
  imports: string[];
  /** 本文件内部的裸调用、未在同一文件解析、导出名的被调用函数名（跨文件函数调用候选） */
  callRefsRaw: string[];
  units: TransUnit[];
  issues: VerifyIssue[];
  /** 萃取期被跳过的项（A1 失败清单：空结构/空接口/不可求值 const） */
  skipped: SkippedDecl[];
  /** 该模块 LLM 填孔失败：unit.id → 原因（A1 失败清单：llm_retry_fail） */
  fillFailures: Map<string, string>;
}

/** A1 显式失败清单条目：每个单元/跳过项一条，定位到 Go 源行 */
export interface ReportEntry {
  file: string;
  id: string;
  kind: string;
  line: number;
  status: 'ok' | 'skeleton' | 'llm_retry_fail' | 'skipped';
  reason?: string;
}

/** B2 types-map 索引项：名字 → 源 Go 文件:行（知道名字就能定位定义） */
export interface TypesMapEntry {
  name: string;
  kind: string;
  /** 源 .go 相对路径 */
  file: string;
  /** 源 Go 起始行 */
  line: number;
}

/** B1 同类名冲突：同一名字在多处定义（跨文件同名，或 type vs func 混同——TS 同名不可共存） */
export interface ConflictEntry {
  name: string;
  sites: { kind: string; file: string; line: number }[];
  /** 'cross_file' = 跨文件同名；'mixed_kind' = type 与 func/const 混同 */
  reason: 'cross_file' | 'mixed_kind';
}

export interface ProjectResult {
  modules: ProjectModule[];
  /** 冲突 / stdlib 未定义等诊断（不阻断） */
  diagnostics: string[];
  /** A1 显式失败清单：逐单元状态，降级不再被静默吞掉 */
  report: ReportEntry[];
  /** B2 声明索引：全部导出符号名 → 源 Go 文件:行，替代 grep 定位 */
  typesMap: TypesMapEntry[];
  /** B1 同类名冲突预检：翻译时就列出，避免 fix 阶段才爆 */
  conflicts: ConflictEntry[];
  /** ★ 全工程 tsc 门禁读数（**编译 ≠ 行为**：只证明"能编译"，回执里不许被当成验证） */
  tsc?: { ran: boolean; passed: boolean; clusters: TscCluster[] };
  ok: boolean;
}

export interface ProjectOptions {
  /**
   * ★★★ 2026-10-29（**零 LLM 可复现读数**）：只回放「机械直翻 + 填孔缓存」，**不调用 LLM**。
   * 缺的孔保持 `throw TODO`。这样 tsc 读数**跨 run 可比** —— 否则每次都重写 body，
   * 指标会在 8.8%~15.1% 之间乱跳（实测过）。全仓典型耗时 < 20 秒。
   */
  replayOnly?: boolean;
  /** 落盘根（不传则不写盘） */
  outDir?: string;
  /** 用 AGNES key 池 LLM 填函数体 */
  fill?: boolean;
  maxRetries?: number;
  /** 全工程 tsc 门禁：对内存模块树跑 TS preEmit，错误并入 diagnostics（纯工程应 0 错；stdlib 未解析会如实列出） */
  verify?: boolean;
  /** 注入翻译器（默认 createPooledHoleTranslator）——测试桩/自建 provider 用，便于确定性实证 */
  translator?: import('./fill.js').HoleTranslator | null;
  /** 项目内一批函数一次 LLM 调用（内置 key 池走批量，注入 translator 时忽略）。默认 5 */
  batchSize?: number;
}

function toPosix(abs: string): string {
  return abs.split(path.sep).join('/');
}

function relImportPath(fromGoRel: string, toGoRel: string): string {
  const fromDir = path.posix.dirname(fromGoRel);
  const toNoExt = toGoRel.replace(/\.go$/, '');
  const r = path.posix.relative(fromDir || '.', toNoExt);
  return r.startsWith('.') ? r : './' + r;
}

/**
 * 跨文件"自由函数调用"候选名收集：用 parseFileFull 的调用边（Go call_expression），
 * 只取 `resolved=false`（未在本文件符号表解析）的调用：
 *   - 裸调用 `Foo(...)` → Foo 为候选（同包跨文件 / dot-import / 内置）；
 *   - 包限定 `pkg.Foo(...)` → 仅当 `pkg` 是本文件某个 Go import 的绑定别名时候选
 *     （排除方法调用 `u.GetName()` 这类 receiver 前缀——其前缀不是 import 别名）。
 * 候选名最终只补「项目内定义为 free func 的」，内置 / stdlib 天然被过滤。
 */
async function collectCallRefs(fileAbs: string, src: string): Promise<string[]> {
  const parsed = await parseFileFull(fileAbs, src);
  if (parsed.error || !parsed.calls) return [];
  const pkgAliases = new Set<string>();
  for (const imp of parsed.imports) {
    for (const b of imp.bindings ?? []) {
      if (b && b !== '_' && b !== '.') pkgAliases.add(b);
    }
  }
  const names = new Set<string>();
  for (const c of parsed.calls) {
    if (c.resolved) continue; // 同文件已解析
    const prefix = c.callee_expr.match(/^([A-Za-z_$][\w$]*)\./)?.[1];
    if (prefix && !pkgAliases.has(prefix)) continue; // 方法/未知前缀调用不盲补
    names.add(c.callee);
  }
  return [...names].sort();
}

/** 符号→定义位置（跨文件 import 判定用）。file='__multi__' 表示同名多文件冲突。 */
export interface SymbolDef {
  file: string;
  isFunc: boolean;
}

/**
 * ★★★ 2026-10-28（T-#FILL-CACHE）：**填孔结果缓存** —— 跨轮次"别把成功的再次送进去"。
 *
 * 为什么需要：`fillUnitsBatched` 在**一轮之内**已经只重试失败子集（不重发成功），
 * 但**重跑整个项目**（改了一个文件想再试一次）会把所有孔重新送 LLM ⇒ 白花钱、还受抖动影响。
 * ⇒ 成功的函数体按 `<rel>#<unitId>@<源片段指纹>` 落盘；下次同源同单元直接命中缓存，**不调 LLM**。
 * ★ 指纹含源片段：**源变了就自动失效**，不会把旧实现贴到新签名上。
 */
function sha1(x: string): string {
  return crypto.createHash('sha1').update(x).digest('hex').slice(0, 16);
}

/** 从「完整函数源码」里取出 `{ … }` 之间的函数体（写缓存用；与 `spliceBody` 互逆） */
function spliceBodyOuter(filledSource: string): string {
  const a = filledSource.indexOf('{');
  const b = filledSource.lastIndexOf('}');
  return a >= 0 && b > a ? filledSource.slice(a + 1, b) : '';
}

// ★ 2026-10-29（**缓存投毒事故的修复**）：缓存键原来只有 `<rel>#<id>@<源哈希>`，**不含装配版本** ——
//   装配层修好之后，旧缓存里那些"按坏骨架拼出来的 body"仍会命中并原样回放（实测残留类型片段在 body 里 ⇒ TS1005）。
//   ⇒ 键加 `v2|` 前缀：装配/签名规则变更后升版本，旧条目自然失效（不删文件，只是不再命中）。
const FILL_CACHE_VERSION = 'v2';

function fillCachePath(outDir: string): string {
  return path.join(outDir, '.fill-cache.json');
}

function loadFillCache(outDir: string): Record<string, { body: string; at: string }> {
  try {
    const raw = fs.readFileSync(fillCachePath(outDir), 'utf8');
    const j = JSON.parse(raw) as Record<string, { body: string; at: string }>;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {}; // 没有缓存是常态
  }
}

function saveFillCache(outDir: string, cache: Record<string, { body: string; at: string }>): void {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(fillCachePath(outDir), JSON.stringify(cache, null, 2), 'utf-8');
  } catch {
    // 缓存写失败不影响主流程（它只是省钱手段，不是判据）
  }
}

/**
 * ★ 册子的 `external_deps` → **包名 → 目标模块** 的表（第 2 层消费第 1 层的决策）。
 * 包名取 import 路径末段（`.../logging` → `logging`），与 Go 的引用写法一致。
 */
function buildDepTable(books: TranslateBook[]): Map<string, { target?: string; strategy?: string }> {
  const t = new Map<string, { target?: string; strategy?: string }>();
  for (const b of books) {
    for (const d of b.external_deps ?? []) {
      const pkg = (d.from ?? '').split('/').pop() ?? '';
      if (pkg) t.set(pkg, { target: d.target, strategy: d.strategy });
    }
  }
  return t;
}

/**
 * 组装模块内容：import 头 + Channel 垫片（如需） + **册子决定的外部依赖 import** + 各单元骨架；
 * 随后跑 C1 确定性 fixer 去未用 import/合 import。
 *
 * ★★★ 2026-10-29（**删掉 any 垫片**）：原来这里生成 `declare namespace pkg { const X: any; type X = any }`
 * —— 那是"因为第 1 层缺位而长出来的替代品"：把**未知**伪装成**已知 any**，正是我们一直在打的假绿。
 * 现在册子有了 `external_deps[].target`（机器可读的目标模块名），就按它发**真 import**；
 * **没有 target 就一个垫片都不发**（宁可红，让缺口显形），并把缺口写进 diagnostics。
 */
function assembleModule(
  m: ProjectModule,
  depTable: Map<string, { target?: string; strategy?: string }>,
  adaptersToWrite: Map<string, string>,
  methodIndex: Map<string, Set<string>>,
  returnTypes: Map<string, string>,
  refStats: { rewrites: number; unknown: number; samples: string[] },
  diag: string[],
): void {
  // ★★★ 2026-10-29（T-#REF-REWRITE）：**逐单元**做方法调用改写 ——
  //   必须逐单元（不是拼完整个模块再改），否则同名形参在不同函数里会互相污染类型表。
  const body = m.units
    .map((u) => {
      if (!methodIndex.size) return u.skeleton;
      const r = rewriteMethodCalls(u.skeleton, methodIndex, returnTypes);
      refStats.rewrites += r.rewrites;
      refStats.unknown += r.unknownReceiver;
      for (const smp of r.samples) if (refStats.samples.length < 12) refStats.samples.push(`${m.rel}: ${smp}`);
      return r.code;
    })
    .join('\n\n') + (m.units.length ? '\n' : '');
  const shim = body.includes('Channel<') ? channelShimSource() : '';

  // 本模块用到的**外部包名**：值位置（usedQualified）+ 类型位置（TypeRef 里的 qualified）
  const usedPkgs = new Set<string>();
  for (const u of m.units) {
    for (const q of u.usedQualified ?? []) {
      const i = q.indexOf('.');
      if (i > 0) usedPkgs.add(q.slice(0, i));
    }
    for (const p of u.params ?? []) collectQualifiedPkgs(p.typeRef, usedPkgs);
    collectQualifiedPkgs(u.resultRef, usedPkgs);
    collectQualifiedPkgs(u.aliasTypeRef, usedPkgs);
    for (const f of u.fields ?? []) collectQualifiedPkgs(f.typeRef, usedPkgs);
    for (const mm of u.methods ?? []) {
      for (const p of mm.params) collectQualifiedPkgs(p.typeRef, usedPkgs);
      collectQualifiedPkgs(mm.resultRef, usedPkgs);
    }
  }

  const depImports: string[] = [];
  const missing: string[] = [];
  for (const pkg of [...usedPkgs].sort()) {
    const dep = depTable.get(pkg);
    if (dep) {
      if (dep.target === '') continue; // 同包 / 内建：不需要 import
      if (!dep.target) {
        missing.push(`${pkg}（strategy=${dep.strategy ?? '未定'}，缺 target）`);
        continue;
      }
      depImports.push(`import * as ${pkg} from '${dep.target}';`);
      continue;
    }
    // ★ T-#STD-ADAPTER：Go std ⇒ **生成真适配模块**（不是 any 垫片）
    const adapter = renderGoStdAdapter(pkg);
    if (adapter !== null) {
      adaptersToWrite.set(pkg, adapter);
      depImports.push(`import * as ${pkg} from './_go_std/${pkg}';`);
      continue;
    }
    missing.push(pkg);
  }
  if (missing.length) {
    diag.push(`${m.rel}: 外部包未定目标模块且无适配器（**不生成 any 垫片**）：${[...new Set(missing)].join(', ')}`);
  }

  // ★ T-#SHIM-APPLY：体里出现 copy( ⇒ 补槽垫片 import（这是**生成符号存在性检查**，
  //   不是语义解析：copy 只可能由我们的渲染器产出）
  // ★ 2026-10-29（**结构化替换正则**）：读单元上的 `usesSlot` 事实，不回头看自己生成的文本。
  const slotImports: string[] = [];
  const usedSlots = new Set<string>();
  for (const u of m.units) for (const sl of u.usesSlot ?? []) usedSlots.add(sl);
  if (usedSlots.has('value')) slotImports.push("import { copy } from './_slots/value';");

  // ★★ 2026-10-29 **[未修] 全局遮蔽**：本地模块导出名与 JS 内置全局同名时会遮蔽全局
  //   （实测 `import { Error } from './logging/logging'` ⇒ `TS2555 ×122`：`new Error('…')` 被要求 2 个参数）。
  //   **试过的错解**：把所有自由 `Error` 改名 ⇒ 会连我们生成的 `throw new Error(TODO)` 一起改，
  //   因为**同一个名字有两个意思**（导入的 `logging.Error` vs JS 全局 `Error`），全局改名必然错。
  //   正确方向（`T-#SHADOW`）：冲突模块改 **namespace import**（`import * as logging`），
  //   Go 侧限定引用 `logging.Error(...)` 天然映射过去，且不动全局。
  m.ts = applyDeterministicFixers(
    [m.imports.join('\n'), shim, depImports.join('\n'), slotImports.join('\n'), body].filter((s) => s !== '').join('\n'),
  );
}

/**
 * A1 显式失败清单：把每模块的单元 + 萃取跳过项 → 扁平报告。
 * 状态判定：
 *   - id 在 fillFailures → 'llm_retry_fail'（LLM 填孔重试耗尽）
 *   - bodyHole 且未填过（fill 未 request）→ 'skeleton'（留孔）
 *   - 其它（type/const 或已填 ok 的 func）→ 'ok'
 *   - 萃取期跳过项 → 'skipped'
 * 每条带 Go 源行，供"一键定位到源码"。
 */
function buildReport(modules: ProjectModule[], fillRequested: boolean): ReportEntry[] {
  const out: ReportEntry[] = [];
  for (const m of modules) {
    for (const u of m.units) {
      const failReason = m.fillFailures.get(u.id);
      let status: ReportEntry['status'];
      let reason: string | undefined;
      if (failReason) {
        status = 'llm_retry_fail';
        reason = failReason;
      } else if (u.bodyHole && !fillRequested) {
        status = 'skeleton';
        reason = '函数体留孔（未请求 LLM 填充）';
      } else {
        status = 'ok';
      }
      out.push({ file: m.rel, id: u.id, kind: u.kind, line: u.srcLine ?? 0, status, reason });
    }
    for (const s of m.skipped) {
      out.push({ file: m.rel, id: s.name, kind: s.kind, line: s.line, status: 'skipped', reason: s.reason });
    }
  }
  return out;
}

// ★ 本函数 2 处裸调留在此处（**不搬**，2026-10-22 分类收口）：落点 = `opts.outDir`（调用方**显式指定**的
//   生成物目录，本函数只在 `if (opts.outDir)` 里被调）⇒ 归主体 = 产物，不是用户源码 ⇒ 不过闸。
/** 落 A1 报告：translation-report.jsonl（逐行 JSON）+ translation-report.md（分组汇总） */
function writeReport(outDir: string, report: ReportEntry[]): void {
  const jsonl = report.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const byStatus = new Map<string, number>();
  for (const r of report) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const lines: string[] = [
    '# Go→TS 翻译报告',
    '',
    `共 ${report.length} 条`,
    '',
    ...['ok', 'skeleton', 'llm_retry_fail', 'skipped'].map((s) => `- ${s}: ${byStatus.get(s) ?? 0}`),
    '',
    '## 明细',
    '',
  ];
  for (const r of report) {
    lines.push(`- [${r.status}] ${r.file}:${r.line} ${r.id}${r.reason ? ` — ${r.reason}` : ''}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'translation-report.jsonl'), jsonl, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'translation-report.md'), lines.join('\n'), 'utf-8');
}

/** B2 声明索引：全部顶层导出符号（type/const + 可译 func）→ 源 Go 文件:行 */
function buildTypesMap(modules: ProjectModule[]): TypesMapEntry[] {
  const out: TypesMapEntry[] = [];
  for (const m of modules) {
    for (const u of m.units) out.push({ name: u.name, kind: u.kind, file: m.rel, line: u.srcLine ?? 0 });
    for (const s of m.skipped) out.push({ name: s.name, kind: s.kind, file: m.rel, line: s.line });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}

/** B1 同类名冲突预检：同名多处定义 → 跨文件同名 / type↔func 混同（TS 同名不可共存） */
function detectConflicts(modules: ProjectModule[]): ConflictEntry[] {
  const byName = new Map<string, ConflictEntry['sites']>();
  for (const m of modules) {
    for (const u of m.units) {
      const arr = byName.get(u.name) ?? [];
      arr.push({ kind: u.kind, file: m.rel, line: u.srcLine ?? 0 });
      byName.set(u.name, arr);
    }
  }
  const out: ConflictEntry[] = [];
  for (const [name, sites] of byName) {
    if (sites.length < 2) continue;
    const kinds = new Set(sites.map((s) => s.kind));
    const files = new Set(sites.map((s) => s.file));
    out.push({ name, sites, reason: files.size > 1 && kinds.size > 1 ? 'mixed_kind' : 'cross_file' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ★ 本函数 2 处裸调留在此处（**不搬**，2026-10-22 分类收口）：同上，落点是调用方指定的 `opts.outDir`
//   ⇒ 归主体 = 产物（types-map.json / .md）⇒ 不过闸。
/** 落 B2 types-map：types-map.json（机器读）+ types-map.md（按文件分组，人读/跳转） */
function writeTypesMap(outDir: string, map: TypesMapEntry[]): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'types-map.json'), JSON.stringify(map, null, 2), 'utf-8');
  const byFile = new Map<string, TypesMapEntry[]>();
  for (const e of map) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)!).push(e);
  const lines: string[] = ['# Go→TS types-map（声明名 → 源 Go 文件:行）', '', `共 ${map.length} 条`, ''];
  for (const [file, entries] of [...byFile.entries()].sort()) {
    lines.push(`## ${file}`);
    for (const e of entries.sort((a, b) => a.line - b.line)) {
      lines.push(`- ${e.name} (${e.kind}) @ ${file}:${e.line}`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(outDir, 'types-map.md'), lines.join('\n'), 'utf-8');
}

/**
 * 项目级调用约定 note，注入该模块每个孔（函数体）的 LLM prompt：
 *   - 本模块可直接调用的自由函数（本地定义 + 已 import 的跨文件 free func）；
 *   - receiver 方法须译成 `T_method(recv, ...)` 自由函数调用（勿写 recv.method()）。
 * 让 LLM 填出的函数体引用对名，从而配合 #1 import 使门禁在填后也能过。
 * A2 增强：ctx 提供全局函数签名 + 类型字段表，把"跨文件语义上下文"（兄弟函数签名、
 * 被引类型的字段词表，如 Address.broadcast）注入单孔 prompt，让 LLM 保留语义（单播/广播）而非脑补。
 */
export interface ProjectCallContext {
  /** 全局函数名 → 首行签名（含符号语义）；跨文件兄弟函数给 LLM 看形状 */
  funcSkel: Map<string, string>;
  /** 全局类型名 → interface 字段表（给 LLM 看字段语义，如 broadcast/excludeRoles） */
  typeSkel: Map<string, string>;
}
export function buildProjectCallNote(m: ProjectModule, defined: Map<string, SymbolDef>, ctx?: ProjectCallContext): string {
  const local = m.units.filter((u) => u.kind === 'func').map((u) => u.name);
  const imported: string[] = [];
  for (const name of m.callRefsRaw) {
    const def = defined.get(name);
    if (def && def.isFunc && def.file !== '__multi__' && def.file !== m.rel && !local.includes(name)) imported.push(name);
  }
  const funcs = [...new Set([...local, ...imported])].sort();
  const lines: string[] = ['【项目级调用约定】'];
  if (funcs.length) lines.push(...funcs.map((n) => `- 可直接调用函数：${n}`));
  if (lines.length === 1) lines.push('- （无）');
  // A2：兄弟/跨文件函数签名（形状语义）
  if (ctx && funcs.length) {
    const sigLines = [];
    for (const n of funcs) {
      const sig = ctx.funcSkel.get(n);
      if (sig) sigLines.push(`- ${n} ${sig}`);
    }
    if (sigLines.length) lines.push('【可直接调用函数的签名（调用约定看形状）】', ...sigLines);
  }
  // A2：本模块引用的类型及其字段（字段语义，如 Address.broadcast 决定单播/广播）
  if (ctx) {
    const refTypes = new Set<string>();
    for (const u of m.units) for (const ref of collectExternalTypeRefs(u)) refTypes.add(ref);
    const fieldLines: string[] = [];
    for (const name of [...refTypes].sort()) {
      const sk = ctx.typeSkel.get(name);
      if (sk) fieldLines.push(`- ${name} ${sk}`);
    }
    if (fieldLines.length) lines.push('【本模块引用到的类型字段（保留其语义，勿丢）】', ...fieldLines);
  }
  if (local.some((n) => /_\w/.test(n))) {
    lines.push('- receiver 方法调用请译成自由函数，形如 user_GetName(recv, ...)，不要写成 recv.GetName(...)');
  }
  return lines.join('\n');
}

/** C2 tsc 错误根因聚类：一个簇 = 同一 code + 归一化消息（标识符/数字泛化） */
export interface TscCluster {
  label: string;
  count: number;
  sample: string;
}

/** TS diagnostics code → 可读类别名（未收录用 TS<code>） */
const TS_CODE_LABEL: Record<number, string> = {
  2304: '未定义的名字/类型', 2307: '找不到模块', 2503: '找不到命名空间', 2339: '对象上不存在属性',
  2322: '赋值类型不兼容', 2345: '实参类型不兼容', 2554: '实参数目不匹配', 7006: '隐式 any 参数',
  2709: '隐式 any 返回', 2540: '对只读属性赋值', 7030: '非全部代码路径返回', 6133: '声明未使用',
};

/** 根因键：code + 消息里把具体标识符/数字泛化的归一形式（同类不同名归并） */
function clusterKeyFor(code: number, msg: string): string {
  const norm = msg.replace(/[A-Za-z_$][\w$]*/g, '<id>').replace(/\b\d+(\.\d+)?\b/g, '<num>');
  return code + '::' + norm;
}

/**
 * 全工程 tsc 门禁：用 TS compiler API 对「内存模块树」跑 preEmit。
 * 非 strict + 跳 .d.ts，只为抓真实的类型/引用/import 解析错误。
 * 特例：TS 2355（显式非空返回类型却缺 return）是骨架"函数体留孔"固有的，
 * 每颗孔都有——不属于翻译错误，跳过。
 * 纯工程应 0 错；错误按**根因聚类**返回（看类数下降，而非逐条条数）。
 */
function verifyProjectTree(modules: ProjectModule[]): TscCluster[] {
  // TS 2355 = 显式非空返回类型缺 return（骨架留孔固有，非翻译错误）
  const SKIP_CODES = new Set([2355]);
  const source = new Map<string, string>();
  for (const m of modules) source.set('/p/' + m.tsRel, m.ts);
  const rootNames = [...source.keys()];
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const origFileExists = host.fileExists.bind(host);
  const origReadFile = host.readFile.bind(host);
  const origDirectoryExists = host.directoryExists?.bind(host);
  host.fileExists = (f) => source.has(f) || origFileExists(f);
  host.readFile = (f) => source.get(f) ?? origReadFile(f);
  host.directoryExists = (d) => (d.startsWith('/p/') || d === '/p') || (origDirectoryExists ? origDirectoryExists(d) : false);

  const program = ts.createProgram({ rootNames, options, host });
  const clusters = new Map<string, TscCluster>();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (!d.file) continue;
    if (SKIP_CODES.has(d.code)) continue;
    const f = d.file.fileName.replace(/^\/p\//, '');
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ').replace(/\s+/g, ' ').trim();
    let loc = f;
    if (d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      loc = `${f}:${line + 1}:${character + 1}`;
    }
    const key = clusterKeyFor(d.code, msg);
    const hit = clusters.get(key);
    if (hit) hit.count++;
    else clusters.set(key, { label: TS_CODE_LABEL[d.code] ?? `TS${d.code}`, count: 1, sample: `${loc} ${msg}` });
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * 项目级翻译：枚举 .go → 逐个翻译为 TS 模块 → 跨文件 import 落定 → 组装（可选落盘 / LLM 填）。
 */
export async function translateGoProject(projectDir: string, opts: ProjectOptions = {}): Promise<ProjectResult> {
  const root = path.resolve(projectDir);
  const allFiles = walkGoFiles(root);
  // ★★★ 2026-10-29（T-#BUILD-VAR，**输出侧**）：Go 的 build tag 变体文件（`*_nocgo.go` / `*_windows.go` …）
  //   与默认构建**互斥**。册子已经不把它们算撞车；但**渲染侧**如果不跳过，
  //   两份同名的 `LocalEmbedder` 会被同时写进同一份 TS ⇒ `TS2300 Duplicate identifier`（实测 ×9）。
  //   TS 没有 build tag ⇒ 只能**保留默认构建**，变体文件明确跳过（记进诊断，不静默）。
  const VARIANT_RE = /_(cgo|nocgo|onnx|windows|linux|darwin|arm64|amd64|386)\.go$/;
  const skippedVariants = allFiles.filter((f) => VARIANT_RE.test(f));
  const files = allFiles.filter((f) => !VARIANT_RE.test(f));

  // ★★★ 2026-10-29（T-#SHIM-ORDER，**顺序也是正确性**）：`mechBody` 在 **extract 阶段**就已经算好了，
  //   所以"值类型 struct 名集合"必须在 **extract 之前**注入 —— 否则渲染器不知道哪些赋值该插 `copy()`，
  //   插入数会静默为 0（这正是我第一版犯的错：注入点写在了 assembly 阶段，晚了一步）。
  {
    const early = loadTranslateBooks(root);
    const structs = new Set<string>();
    for (const b of early) {
      for (const sym of b.symbols ?? []) {
        if (sym.pivot?.typeKind !== 'struct' || !sym.id) continue;
        const short = sym.id.includes('#') ? sym.id.slice(sym.id.indexOf('#') + 1) : sym.id;
        structs.add(short.split('.').pop() ?? short);
      }
    }
    setValueStructTypes(structs);
  }
  // 内置 key 池 → 批量填（省共享 prompt 常量）；显式注入 translator → 单孔路径（测试桩 / 自建 provider）
  const singleTranslator = opts.fill && opts.translator ? opts.translator : null;
  const useBatch = opts.fill && !opts.translator;
  const diagnostics: string[] = [];
  if (skippedVariants.length) {
    diagnostics.push(
      `build tag 变体文件 ${skippedVariants.length} 个已跳过（与默认构建互斥，同时渲染会 TS2300）：` +
        skippedVariants.map((f) => f.split(/[\\/]/).pop()).slice(0, 6).join(', '),
    );
  }
  /** ★ tsc 门禁读数（**编译 ≠ 行为**；只有真跑了才有值） */
  let tsc: ProjectResult['tsc'];

  // 第一遍：翻译每个文件，收集"名字 → 定义位置"（含类型/函数区分）与调用候选
  const modules: ProjectModule[] = [];
  const defined = new Map<string, SymbolDef>(); // name → { file, isFunc }（同名跨文件 → file='__multi__'）
  for (const fileAbs of files) {
    const rel = toPosix(path.relative(root, fileAbs));
    const src = fs.readFileSync(fileAbs, 'utf-8');
    const r = await translateGoToTs(fileAbs, src);
    if (r.error) {
      diagnostics.push(`${rel}: 翻译失败 ${r.error}`);
      continue;
    }
    if (r.units.length === 0) continue; // 无顶层可译单元则跳过
    const callRefsRaw = await collectCallRefs(fileAbs, src);
    // 同名冲突标记（保留 isFunc，跨文件同名 func 不盲补）
    for (const u of r.units) {
      const ex = defined.get(u.name);
      if (!ex) defined.set(u.name, { file: rel, isFunc: u.kind === 'func' });
      else if (ex.file !== rel) defined.set(u.name, { file: '__multi__', isFunc: ex.isFunc || u.kind === 'func' });
    }
    modules.push({ fileAbs, rel, tsRel: rel.replace(/\.go$/, '.ts'), ts: '', imports: [], callRefsRaw, units: r.units, issues: r.issues, skipped: r.skipped ?? [], fillFailures: new Map() });
  }

  // 第二遍：为每个模块算跨文件 import（类型引用 + 自由函数调用）。
  const stdlibUndefined = new Set<string>();
  const conflicted = new Set<string>();
  for (const m of modules) {
    const byPath = new Map<string, Set<string>>();
    const addToPath = (name: string, targetRel: string): void => {
      const s = byPath.get(targetRel) ?? new Set<string>();
      s.add(name);
      byPath.set(targetRel, s);
    };
    const markConflict = (name: string): void => {
      if (!conflicted.has(name)) conflicted.add(name);
    };
    // 类型引用落地（沿用：导出名未定义 → stdlib/外部诊断；同名冲突 → 不 import）
    for (const name of new Set(m.units.flatMap((u) => collectExternalTypeRefs(u)))) {
      const def = defined.get(name);
      if (!def) {
        if (/^[A-Z]/.test(name)) stdlibUndefined.add(name);
        continue;
      }
      if (def.file === '__multi__') {
        markConflict(name);
        continue;
      }
      if (def.file === m.rel) continue; // 同文件自解
      addToPath(name, def.file);
    }
    // 自由函数调用落地：只在项目内定义为 free func 且在不同文件时补 import
    for (const name of m.callRefsRaw) {
      const def = defined.get(name);
      if (!def || !def.isFunc) continue; // 项目内未定义（内置/stdlib）或非函数 → 不补
      if (def.file === '__multi__') {
        markConflict(name);
        continue;
      }
      if (def.file === m.rel) continue; // 同文件
      addToPath(name, def.file);
    }
    const imports = [...byPath.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([rel, names]) => `import { ${[...names].sort().join(', ')} } from '${relImportPath(m.rel, rel)}';`);
    m.imports = imports;
  }
  if (stdlibUndefined.size) diagnostics.push(`项目内未定义的导出类型（Go stdlib/外部，需 LLM/人工）：${[...stdlibUndefined].sort().join(', ')}`);
  if (conflicted.size) diagnostics.push(`同名顶层符号多文件冲突（未 import，需人工消歧）：${[...conflicted].sort().join(', ')}`);

  // ★★★ 2026-10-29（T-#SKELETON-FROM-BOOK）：**骨架由册子出，不由 AST 再推一次**。
  //   用户指出的病：第 2 层用 `TypeRef(AST 直出)` 渲染类型 ⇒ **把册子绕过了**（同一份事实解释两次，
  //   而且册子里的名词决策——术语、依赖、`to` 名——根本没参与）。
  //   正确流向：`AST → 册子(sigTs) → 骨架(只排版)`。
  //   这里：册子有 `sigTs` 就用它当签名头（`export function <sigTs> { 体 }` / `export interface …`），
  //   没有才回落到 ts_codegen 的 AST 推导，并**记账**（缺口要显形，不静默）。
  let fromBook = 0;
  let bookMiss = 0;
  {
    const booksForSig = loadTranslateBooks(root);
    for (const mm of modules) {
      for (const u of mm.units) {
        const sym = findBookSymbol(booksForSig, mm.rel, u);
        const symSig = sym?.targets?.ts?.signature;
        if (symSig) {
          u.skeleton = skeletonFromSigTs(symSig, u);
          fromBook++;
        } else {
          bookMiss++;
        }
      }
    }
    if (fromBook || bookMiss) {
      diagnostics.push(`骨架签名来源：册子 sigTs ${fromBook} 个 · 回落 AST 推导 ${bookMiss} 个`);
      // ★★★ 2026-10-29（T-#PIVOT-SLOTS）：**失真账进回执** —— 从册子的 pivot 类型树算出
      //   「源槽位 × 目标能力」的已知语义偏离（算出来的，不落第二份）。
      const lossByTag = new Map<string, number>();
      let lossyUnits = 0;
      let lossyTotal = 0;
      for (const mm of modules) {
        for (const u of mm.units) {
          const refs = [...(u.params ?? []).map((p) => p.typeRef), u.resultRef].filter(Boolean) as never[];
          let entries;
          try {
            entries = lossinessOfUnit(refs, 'go', 'ts');
          } catch {
            continue;
          }
          lossyTotal++;
          const real = entries.filter((e) => e.loss !== 'exact');
          if (real.length) lossyUnits++;
          for (const e of real) lossByTag.set(e.loss, (lossByTag.get(e.loss) ?? 0) + 1);
        }
      }
      if (lossyTotal) {
        const top = [...lossByTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        diagnostics.push(
          `失真账：${lossyUnits}/${lossyTotal} 个单元含已知语义偏离（${((lossyUnits / lossyTotal) * 100).toFixed(1)}%）· ` +
            top.map(([k, v]) => `${k}×${v}`).join(" · ") +
            `（**编译通过 ≠ 行为等价**，逐条见 t445 读数）`,
        );
      }
    }
  }

  // A2 语义上下文：全局函数签名 + 类型字段表，注入 fill 让 LLM 保留跨文件语义
  const pctx: ProjectCallContext = { funcSkel: new Map(), typeSkel: new Map() };
  for (const mm of modules) {
    for (const u of mm.units) {
      if (u.kind === 'func' && u.skeleton && !pctx.funcSkel.has(u.name)) {
        pctx.funcSkel.set(u.name, u.skeleton.split('\n')[0].replace(/\{\s*$/, '').trim());
      } else if (u.kind === 'type' && u.skeleton && !pctx.typeSkel.has(u.name)) {
        pctx.typeSkel.set(u.name, u.skeleton.replace(/\s+/g, ' ').trim());
      }
    }
  }

  // 第三遍（fill）：在 import 已算定的前提下逐模块注入「项目级调用约定」再填孔，
  // 让函数体引用对名；填完重建每个模块的 m.ts（门禁在填后输出上跑 = 填后 release gate）。
  // ★ 2026-10-28（T-#FILL-CACHE）：填孔缓存**在函数作用域**声明（回写发生在报告之后，不能只活在 fill 块里）
  const fillCache = opts.outDir ? loadFillCache(String(opts.outDir)) : {};
  let cacheHits = 0;
  /** ★ T-#CACHE-GATE：缓存体被当前判据判坏、作废重填的个数 */
  let staleCache = 0;
  let mechCount = 0;
  if (opts.fill) {
    // ★ I3（2026-10-25）：翻译 DB 投影 + 术语表进 prompt（按图索骥的"图"）——
    //   根目录 `.agent-io/design/*.translate.json` 存在时按 `<rel>#<符号名>` 对齐注入。
    //   没册子是常态（loadTranslateBooks ⇒ []，0 注入不打扰）。
    const books = loadTranslateBooks(root);
    for (const m of modules) attachBookFacts(m.units, books, m.rel);
    for (const m of modules) {
      const note = buildProjectCallNote(m, defined, pctx) || undefined;
      // ★★★ 2026-10-28（T-#FILL-CACHE）：**先吃缓存** —— 同源同单元的孔直接贴回，不再送 LLM。
      //   ★ 指纹含源片段 ⇒ 源变了自动失效，不会把旧实现贴到新签名上。
      const cache = fillCache;
      const hits: Array<{ u: (typeof m.units)[number]; body: string }> = [];
      let mechInModule = 0;
      const missUnits: typeof m.units = [];
      for (const u of m.units) {
        if (!u.bodyHole) continue;
        // ★★★ 2026-10-29（T-#MECH-BODY）：**机械能翻的直接翻**（零 LLM、确定性），
        //   翻不动的才进 missUnits 交给 LLM。这是"七成不该花钱"的落点。
        if (u.mechBody) {
          hits.push({ u, body: u.mechBody });
          mechCount++;
          mechInModule++;
          continue;
        }
        // ★★★ 2026-10-29（T-#CACHE-GATE）：键里带**判据版本** `v3`。
        //   缓存体是否合格，取决于"生成它时的判据"与"现在消费它时的判据"是否一致。
        //   不带版本 ⇒ 新加的判据只约束未来，旧体照样被放回（实测 66 个 `err` 就是这么来的）。
        const key = `v3|${m.rel}#${u.id}@${sha1(u.srcSnippet)}`;
        const hit = cache[key];
        // ★ 缓存回放也要过契约检查（两关）：
        //   ① 不许带 `export function` 外壳（嵌进外层 ⇒ 语法错，t442 的教训）；
        //   ② **作用域判据**（t452）：引用的名字必须已声明/已导入/是全局 —— 判坏即当 miss 重填。
        let cacheOk = !!hit?.body && !/^[ \t]*(export\s+)?(async\s+)?function\b/m.test(hit.body.trim());
        if (cacheOk && hit?.body) {
          const probe = {
            ...u,
            skeleton: spliceBody(u.skeleton, normalizeLegacyOctal(hit.body)),
          } as (typeof m.units)[number];
          const scopeIssues = undeclaredNameIssues(probe);
          if (scopeIssues.length) {
            cacheOk = false;
            staleCache += 1;
            if (diagnostics.length < 40) {
              diagnostics.push(`缓存体不合规作废（${m.rel} ${u.name}）：${scopeIssues[0].detail}`);
            }
          }
        }
        if (cacheOk) hits.push({ u, body: hit.body });
        else missUnits.push(u);
      }
      // ★ 2026-10-29：**缓存/机械回放也要走八进制归一** —— 上一遍残留的 TS1121 就是这条路径漏了归一化。
      for (const h of hits) h.u.skeleton = spliceBody(h.u.skeleton, normalizeLegacyOctal(h.body));
      // ★ 机械体不算「缓存命中」（两种零 LLM 的正交来源，混在一起两个读数都失真）
      if (hits.length > mechInModule) cacheHits += hits.length - mechInModule;
      const unitsToFill = missUnits;
      let filled: Awaited<ReturnType<typeof fillUnitsWithRetry>> = [];
      // ★ 也支持环境变量（避免为了一个开关去改工具契约）：AGENT_IO_REPLAY_ONLY=1
      const replayOnly = opts.replayOnly ?? process.env.AGENT_IO_REPLAY_ONLY === '1';
      if (replayOnly && unitsToFill.length) {
        // ★ 回放模式（零 LLM）：缺的孔**留空**（保持 TODO 孔），如实计数，绝不调模型。
        //   这样 tsc 读数只随"确定性层"变化 ⇒ 跨 run 可比。
        diagnostics.push(`回放模式：${unitsToFill.length} 个孔无缓存（保持 TODO 孔），未调用 LLM`);
        unitsToFill.length = 0;
      }
      if (!unitsToFill.length) {
        // 全命中 ⇒ 一次 LLM 都不调
        filled = [];
      } else if (useBatch) {
        filled = await fillUnitsBatched(unitsToFill, createPooledBatchTranslator(), {
          batchSize: opts.batchSize ?? 5,
          maxRetries: opts.maxRetries ?? 2,
          projectNote: note,
        });
      } else if (singleTranslator) {
        filled = await fillUnitsWithRetry(unitsToFill, singleTranslator, opts.maxRetries ?? 2, note);
      } else {
        continue;
      }
      const byId = new Map(filled.map((f) => [f.unit.id, f]));
      for (const u of m.units) {
        const f = byId.get(u.id);
        if (f?.ok) {
          u.skeleton = f.filledSource;
          // ★ 成功的写进缓存：跨轮次**不再重发**（只重试失败的）
          const bodyOnly = spliceBodyOuter(f.filledSource);
          if (bodyOnly) cache[`v3|${m.rel}#${u.id}@${sha1(u.srcSnippet)}`] = { body: bodyOnly, at: new Date().toISOString() };
        }
      }
      // ★ 2026-10-28：**进度日志**（长跑必须可观测）。没有它，卡在某一批时外面看到的是"什么都没有"。
      if (staleCache) process.stderr.write(`[cache-gate] ${m.rel}: ${staleCache} 个缓存体被当前判据判坏、作废重填\n`);
  process.stderr.write(`[translate] fill ${m.rel}: 命中${hits.length} 提交${unitsToFill.length} ok${filled.filter((f)=>f.ok).length} fail${filled.filter((f)=>!f.ok).length}\n`);
      const failed = filled.filter((f) => !f.ok);
      for (const f of failed) {
        m.fillFailures.set(f.unit.id, f.error ?? f.issues.map((i) => i.detail).join('；'));
      }
      if (failed.length) {
        const firstErr = failed[0].error ?? failed[0].issues.map((i) => i.detail).join('；');
        diagnostics.push(`${m.rel}: LLM 填孔失败 ${failed.length}/${filled.length}：${firstErr}`);
      }
    }
  }
  const booksForAssembly = loadTranslateBooks(root);

  // ★ T-#SHIM-APPLY：把**值类型 struct** 的名字交给体渲染器（决定哪些赋值要插 copy()）。
  //   来源是册子的 pivot.typeKind（结构化事实），不是猜类型名文本。
  {
    const bookStructs = new Set<string>();
    for (const b of booksForAssembly) {
      for (const sym of b.symbols ?? []) {
        const pk = sym.pivot?.typeKind;
        if (pk === 'struct' && sym.id) {
          const short = sym.id.includes('#') ? sym.id.slice(sym.id.indexOf('#') + 1) : sym.id;
          bookStructs.add(short.split('.').pop() ?? short);
        }
      }
    }
    setValueStructTypes(bookStructs);
    if (bookStructs.size) diagnostics.push(`值类型 struct ${bookStructs.size} 个（用于 copy() 插入判定）`);
  }
  const depTable = buildDepTable(booksForAssembly);
  // ★ T-#REF-REWRITE：方法表（册子 `symbols` 里 kind=method 的 → `类型名 → Set<方法名>`）
  const allSymbols = booksForAssembly.flatMap((b) => b.symbols ?? []);
  const methodIndex = buildMethodIndex(allSymbols);
  // ★ T-#REF-TYPES：**函数名 → 返回类型名**（来自册子 `pivot.result`）——
  //   让 `b := NewBuilder(...)` 这类"类型由返回值决定"的局部变量也能定型，
  //   从而它的字段/方法调用可以被改写（此前覆盖率只有 15.1%，根因就是这类变量类型未知）。
  const returnTypes = new Map<string, string>();
  for (const sym of allSymbols) {
    const r = (sym.pivot as { result?: { kind?: string; name?: string } } | undefined)?.result;
    if (!r || r.kind !== 'ident' || !r.name) continue;
    const short = String(sym.id ?? '').split('#').pop()?.split('.').pop();
    if (short) returnTypes.set(short, r.name);
    const tsName = sym.targets?.ts?.name;
    if (tsName) returnTypes.set(tsName, r.name);
  }
  const refStats = { rewrites: 0, unknown: 0, samples: [] as string[] };
  // ★ T-#STD-ADAPTER：本次用到的 Go std 适配模块（pkg → 源码），随后落盘到 <outDir>/_go_std/
  const adaptersToWrite = new Map<string, string>();
  for (const m of modules) assembleModule(m, depTable, adaptersToWrite, methodIndex, returnTypes, refStats, diagnostics);
  if (methodIndex.size) {
    diagnostics.push(`引用改写：${refStats.rewrites} 处（类型未知未改写 ${refStats.unknown} 处）`);
    for (const smp of refStats.samples.slice(0, 4)) diagnostics.push(`  · ${smp}`);
  }
  if (opts.outDir && adaptersToWrite.size) {
    const dir = path.join(String(opts.outDir), '_go_std');
    fs.mkdirSync(dir, { recursive: true });
    for (const [pkg, src] of adaptersToWrite) fs.writeFileSync(path.join(dir, pkg + '.ts'), src, 'utf8');
    diagnostics.push(`生成 Go std 适配模块 ${adaptersToWrite.size} 个：${[...adaptersToWrite.keys()].sort().join(', ')}`);

  // ★★★ 2026-10-29（T-#SLOT-SHIM）：**槽垫片落盘**（"拿原生组件去顶"的产物）。
  //   注意：落盘 ≠ 已被渲染器插入；失真账只在 `applied=true` 时才变绿（证 t448 ③ 守着这条）。
  if (opts.outDir) {
    const slotShims = Object.values(CAPABILITIES['ts'].shims ?? {}).filter((x) => x.certified);
    const written: string[] = [];
    for (const sh of slotShims) {
      const src = renderSlotShim(sh.slot);
      if (!src) continue;
      const rel = sh.module + '.ts';
      const abs = path.join(String(opts.outDir), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, src, 'utf8');
      written.push(`${rel}${sh.applied ? '（已插入）' : '（**未插入**，仅落盘）'}`);
    }
    if (written.length) diagnostics.push(`生成槽垫片 ${written.length} 个：${written.join(', ')}`);
  }
  }

  // A1 显式失败清单：降级不再静默吞掉
  const report = buildReport(modules, opts.fill === true);
  // B2 types-map 声明索引：知道名字就能定位源 Go 定义
  const typesMap = buildTypesMap(modules);
  // B1 同类名冲突预检：混同形态（type↔func，TS 同名不可共存）额外点名，跨文件同名沿用上方冲突诊断
  const conflicts = detectConflicts(modules);
  for (const c of conflicts) {
    if (c.reason === 'mixed_kind') {
      const sites = c.sites.map((s) => `${s.file}:${s.line}(${s.kind})`).join(', ');
      diagnostics.push(`同类名混同冲突「${c.name}」（TS 同名不可共存）：${sites}，需消歧`);
    }
  }
  if (opts.outDir) {
    const outRoot = path.resolve(opts.outDir);
    writeReport(outRoot, report);
    writeTypesMap(outRoot, typesMap);
    // ★ 2026-10-28（T-#FILL-CACHE）：回写填孔缓存 —— 跨轮次**只重试失败的**，成功的不再送 LLM。
    //   位置放在报告之后：缓存是"省钱手段"，不是判据；写失败也不影响产物。
    if (opts.fill) {
      saveFillCache(outRoot, fillCache);
      if (cacheHits) diagnostics.push(`填孔缓存命中 ${cacheHits} 个（★ 未调用 LLM）`);
    }
    if (mechCount) {
      diagnostics.push(`机械直翻 ${mechCount} 个函数体（★ 未调用 LLM：AST 同构改写）`);
    }
  }

  // 全工程 tsc 门禁：对内存模块树跑 TS preEmit，错误按根因聚类并入诊断（不阻断）
  if (opts.verify && modules.length) {
    const clusters = verifyProjectTree(modules);
    tsc = { ran: true, passed: clusters.length === 0, clusters };
    if (clusters.length) {
      const total = clusters.reduce((s, c) => s + c.count, 0);
      diagnostics.push(
        `全工程 tsc 检查未通过：${clusters.length} 类 / ${total} 条\n${clusters.map((c) => `  • [${c.label}] ×${c.count}  例: ${c.sample}`).join('\n')}`,
      );
    }
  }

  // 落盘：镜像相对结构
  if (opts.outDir) {
    for (const m of modules) {
      const outAbs = path.join(path.resolve(opts.outDir), m.tsRel);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      // ★ 裸调留在此处（**不搬**，2026-10-22 分类收口）：`outAbs` = `opts.outDir/<tsRel>`（调用方指定的生成物目录）
      //   ⇒ 归主体 = 产物（翻译出的 TS），不是用户源码 ⇒ 不过闸。
      fs.writeFileSync(outAbs, m.ts, 'utf-8');
    }

    // ★★★ 2026-10-29（T-#TSC-DRIVEN-FIX 步 2）：**管线内**后处理 —— 必须在这里，
    //   否则补丁打在输出目录、回放会覆盖 ⇒ 数字不可复现（上一版就是这个毛病，626 进不了基线）。
    //   开关：AGENT_IO_TSC_FIX=1。失败即 no-op（绝不改坏产物）。
    if (process.env.AGENT_IO_TSC_FIX === '1') {
      try {
        const r = applyTscDrivenFixes(path.resolve(opts.outDir), diagnostics);
        if (r && r.changed && r.after >= r.before - r.changed + 1) {
          diagnostics.push(
            `[tsc-fix] 验收未过：总数只降 ${r.before - r.after}，改写 ${r.changed}（此消彼长）`,
          );
        }
      } catch (e) {
        diagnostics.push('[tsc-fix] 后处理异常（已忽略）：' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  return { modules, diagnostics, report, typesMap, conflicts, ...(tsc ? { tsc } : {}), ok: modules.every((m) => m.issues.length === 0) };
}