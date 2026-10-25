/**
 * tool —— translate_go_ts 的 MCP handler（胶水层：把翻译链路暴露给 agent）
 *
 * 逻辑：读 Go 源 → 机械骨架 + 验证闸（默认）；fill=true 再用 AGNES key 池 LLM 逐孔填；
 * verify=true 再对已填的函数跑 Go↔TS **对照测试**（同一批输入逐条比，需 go 工具链）。
 *
 * ★ 回执（receipt）在这里是一等产物，不是附注：
 *   · `known`     = 从 AST / 常量求值 / import / 调用边 / 仓库测试里**读出来的事实**
 *   · `unknowns`  = 推测（惯用法怎么映）、缺失（缺库、未翻的孔）、假设（近似写法）
 *   · `verification` = 只认对照测试；只编译过 / 只跑自动冒烟样例 / 根本没跑 ⇒ `unverified`
 *   判据是**功能达成**（同一批输入新旧输出一致），不是"结构像不像"、更不是"能不能编译"。
 */

import fs from 'node:fs';
import path from 'node:path';
import { translateGoToTs } from './pairs.js';
// ★ 2026-09-30：原先从 `./pairs.js` 引 `translateGoProject`（那是 pairs 的**转发**）⇒ 制造了
//   `pairs ↔ project` 的环（`no-circular` 抓到）。转发已删，这里直连真正的出处。
import { translateGoProject, type ProjectResult } from './project.js';
import { createPooledHoleTranslator } from './llm.js';
import { fillUnitsWithRetry } from './fill.js';
import { findGoTestFiles, harvestForUnits } from './go_tests.js';
import { buildKnown, buildUnknowns, buildExternalDeps, methodInfo, unverifiedReceipt, verifyTranslation, type KnownFact, type Receipt, type VerificationReceipt } from './receipt.js';
import { attachBookFacts, findBookRootFor, loadTranslateBooks } from './book.js';
import type { SkippedDecl } from './go_extractor.js';
import type { BehaviorCase } from '../behavior/index.js';
import type { TransUnit } from './unit.js';

export interface TranslateGoTsArgs {
  file?: string;
  /** Go 项目目录：一次翻译整个项目（枚举 .go、跨文件 import、镜像落盘） */
  projectDir?: string;
  /** 项目模式下落盘根（镜像 source 结构） */
  outDir?: string;
  /** 用 AGNES key 池 LLM 逐孔填函数体 */
  fill?: boolean;
  /** 单文件模式：对已填函数跑 Go↔TS 对照测试（需 go 工具链）；项目模式：全工程 tsc 门禁（内存模块树跑 TS preEmit，错误入诊断）
   *  ★ 项目模式**只有这一个入口**（原隐藏的 `tscVerify` 已删：zod schema 里没有它 ⇒ MCP 面根本传不进来）。 */
  verify?: boolean;
  /** 项目内一批函数一次 LLM 调用（内置 key 池走批量）。默认 5 */
  batchSize?: number;
  /** LLM 纠错重试次数，默认 2 */
  maxRetries?: number;
  /** ★ 调用方显式给的对照用例（优先于仓库测试）：[{name?, args:[…]}] */
  testCases?: { name?: string; args: unknown[] }[];
}

export async function translateGoTsHandler(args: Record<string, unknown>): Promise<{ message: string; data?: unknown }> {
  const fill = args.fill === true;
  const verify = args.verify === true;
  const maxRetries = typeof args.maxRetries === 'number' ? args.maxRetries : 2;
  const batchSize = typeof args.batchSize === 'number' ? args.batchSize : undefined;
  // ★ 2026-10-06（T15 第 4 项）：这两个原先**只在 `translate_cli` 的 argv 里**
  //   ⇒ 「能力被藏在了 MCP 面之外」（CLI 的 flag 有、zod schema 没有 ⇒ agent 无从调用）。
  const holes = args.holes === true;
  const out = typeof args.out === 'string' && args.out ? args.out : undefined;
  const suppliedCases = parseSuppliedCases(args.testCases);

  // 项目级：一次翻译整个 Go 项目
  const projectDir = String(args.projectDir ?? '');
  if (projectDir) {
    const root = path.resolve(projectDir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { message: `Go 项目目录不存在：${root}` };
    const outDir = args.outDir ? path.resolve(String(args.outDir)) : undefined;
    // ★ 项目模式下 verify 的公开语义就是「全工程 tsc 门禁」（见 cross 的 zod 描述）。
    //   入口只有一个：verify。原先还有一条隐藏的 tscVerify ⇒ 文档说 verify、实现只认 tscVerify；
    //   那条已删（zod 里没有 tscVerify ⇒ MCP 面传不进来），回执里明写这次是谁触发的。
    const r = await translateGoProject(root, { outDir, fill, maxRetries, verify, batchSize });
    const receipt = projectReceipt(r, fill, verify);
    const lines = [`Go 项目翻译：${r.modules.length} 个模块`];
    for (const m of r.modules) {
      lines.push(`  ${m.tsRel}  (${m.units.length} 单元${m.imports.length ? `; import ${m.imports.length} 处` : ''})`);
    }
    if (r.diagnostics.length) {
      lines.push('── 诊断（不阻断）──');
      for (const d of r.diagnostics) lines.push(`  ${d}`);
    }
    const failCount = r.report.filter((e) => e.status === 'llm_retry_fail' || e.status === 'skipped').length;
    if (r.report.length) lines.push(`A1 失败清单（translation-report）：${r.report.length} 条，其中需处理 ${failCount} 条（llm_retry_fail/skipped）`);
    appendReceipt(lines, receipt);
    if (outDir) lines.push(`已落盘到 ${outDir}`);
    return {
      message: lines.join('\n'),
      data: {
        modules: r.modules.map((m) => ({ rel: m.tsRel, imports: m.imports, units: m.units.length })),
        diagnostics: r.diagnostics,
        report: r.report,
        typesMap: r.typesMap,
        conflicts: r.conflicts,
        // ★ tsc 读数单独给机器读（ran/passed/clusters 三档）—— verify=true 时必须真的有它。
        ...(r.tsc ? { tsc: r.tsc } : {}),
        receipt,
      },
    };
  }

  const file = String(args.file ?? '');
  if (!file) return { message: '需要 file=<Go 源文件路径> 或 projectDir=<Go 项目目录>' };
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return { message: `Go 源文件不存在：${abs}` };
  const source = fs.readFileSync(abs, 'utf-8');

  const r = await translateGoToTs(abs, source);
  if (r.error) return { message: `翻译失败：${r.error}` };

  const units = r.units;
  let output = r.output;
  const notes: string[] = [];
  /** 已填且过静态闸的单元 → 填后源码（★ 只有它才能进对拍；未填的孔没有可执行体） */
  const filledCode = new Map<string, string>();
  /** 填孔失败原因（unit id → 原因）：既要进 unknowns，也要在对拍里说清为什么没跑 */
  const fillFailures = new Map<string, string>();

  if (r.issues.length) {
    notes.push(`机械骨架验证闸（未过，这部分单元不可落盘）：${r.issues.map((i) => `${i.id}[${i.gate}]`).join(', ')}`);
  }

  // ★ I3（2026-10-25）：翻译 DB 投影 + 术语表进 prompt（按图索骥的"图"）——
  //   向上找含 .agent-io/design 的项目根，读全部 *.translate.json，按 `<rel>#<符号名>` 对齐注入。
  //   没册子是常态（0 注入，不打扰）；有册子 ⇒ 明说注入了几个。
  if (fill) {
    const bookRoot = findBookRootFor(abs);
    if (bookRoot) {
      const books = loadTranslateBooks(bookRoot);
      const rel = path.relative(bookRoot, abs).split(path.sep).join('/');
      const n = attachBookFacts(units, books, rel);
      if (n > 0) notes.push(`翻译册命中：${n} 个单元已注入翻译 DB 投影与术语表（buildHolePrompt 消费）`);
    }
  }

  if (fill) {
    const translate = createPooledHoleTranslator();
    const filled = await fillUnitsWithRetry(units, translate, maxRetries);
    for (const f of filled) {
      if (f.ok) filledCode.set(f.unit.id, f.filledSource);
      else fillFailures.set(f.unit.id, f.error ?? (f.issues.map((i) => i.detail).join('；') || '未通过静态闸'));
    }
    output = units.map((u) => filledCode.get(u.id) ?? u.skeleton).join('\n\n');
    notes.push(`LLM 填孔：${filled.filter((f) => f.ok).length}/${filled.length} 过验证` + (fillFailures.size ? `；未过：${[...fillFailures.keys()].join(', ')}` : ''));
  }

  // ── 已知 / 未知：★ 两栏分开，推测绝不混进 known ──
  const known: KnownFact[] = buildKnown(units, filledCode);
  const unknowns = buildUnknowns({
    units,
    filled: filledCode,
    fillFailures,
    skipped: r.skipped as SkippedDecl[] | undefined,
  });

  // ── 验证：只有"同一批输入新旧逐条比"才叫验证 ──
  const funcUnits = units.filter((u) => u.kind === 'func');
  let verification: VerificationReceipt;
  if (!verify) {
    verification = unverifiedReceipt(`未请求对照测试（verify=false）：${funcUnits.length} 个函数没有任何行为证据`, funcUnits.length, units.length - funcUnits.length);
  } else {
    const testFiles = findGoTestFiles(abs);
    const harvested = await harvestForUnits(
      testFiles,
      // 方法单元额外带上原始方法名：仓库测试调的是 `c.Double()`，按折名 `Counter_Double` 找不到。
      funcUnits.map((u) => {
        const mi = methodInfo(u);
        return { name: u.name, params: u.params, ...(mi ? { methodName: mi.method } : {}) };
      }),
    );
    verification = verifyTranslation(
      units.map((u) => ({ unit: u, tsCode: filledCode.get(u.id) })),
      { goSource: source, harvested, ...(suppliedCases.length ? { supplied: suppliedCases } : {}) },
    );
    if (testFiles.length === 0) notes.push(`同目录无 *_test.go ⇒ 没有仓库测试可跑（只可能跑自动冒烟样例，那不算验证）`);
  }

  // ★ `--holes`（CLI 的同一件事）：把每个待填孔给 LLM 的 prompt 一并返回。
  //   ★ 门与 CLI **逐字一致**（CLI：`wantHoles && !wantLlm`）：fill 时那些 prompt 已被消费。
  //     ⇒ **刻意不发明第二种口径**（同一个名字在不同面里必须是同一个意思）。
  const holePrompts = holes && !fill ? r.holePrompts : [];
  if (holePrompts.length > 0) notes.push(`待填孔 prompt：${holePrompts.length} 条（见 data.hole_prompts）`);

  // ★ `--out`（CLI 的同一件事）：单文件模式落盘。★★ 两条**照抄 CLI 的规则**（不然会静默丢东西）：
  //   ① 目标已存在且**未 fill** ⇒ **不覆盖**（CLI 原话："防止丢弃已填的函数体"）；
  //   ② 机械骨架验证闸未过（`r.issues`）⇒ **整份不落盘**（CLI 的"原子性，避免半成品"）。
  let outPath: string | undefined;
  if (out) {
    const outAbs = path.resolve(out);
    if (r.issues.length > 0) {
      notes.push(`未落盘：机械骨架验证闸未过（原子性，避免半成品）⇒ ${outAbs}`);
    } else if (fs.existsSync(outAbs) && !fill) {
      notes.push(`未落盘：目标已存在，不覆盖（防止丢弃已填的函数体）⇒ ${outAbs}`);
    } else {
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      // ★ 裸调留在此处（**不搬**，2026-10-22 分类收口）：`--out` = 调用方显式指定的**生成物落点**
      //   （且已在上面两道闸里拒了覆盖与半成品）⇒ 归主体 = 产物 ⇒ 不过闸。
      fs.writeFileSync(outAbs, output, 'utf-8');
      outPath = outAbs;
      notes.push(`已写入 ${outAbs}`);
    }
  }

  const header = `Go→TS 萃取 ${units.length} 个单元${fill ? '（已按 LLM 填充）' : ''}`;
  const lines = [header, ...notes];
  // ★ I3：外部 import 升格为独立硬依赖清单区块（不再混进 unknowns 的 missing_lib），回执与 data 同一份
  const receipt: Receipt = { known, unknowns, verification, external_deps: buildExternalDeps(externalImportsOf(source)) };
  appendReceipt(lines, receipt);
  lines.push('', r.output ? output : '（无单元）');

  return {
    message: lines.join('\n'),
    data: {
      unit_ids: units.map((u) => u.id),
      output,
      receipt,
      ...(holePrompts.length > 0 ? { hole_prompts: holePrompts } : {}),
      ...(outPath ? { out_path: outPath } : {}),
    },
  };
}

/**
 * 把回执压进消息（**有界**：每条最多列 5 行，全量留在 `data.receipt`）——
 * 回执要能读，不能变成一屏刷不完的日志。
 */
function appendReceipt(lines: string[], receipt: Receipt): void {
  const v = receipt.verification;
  lines.push('', `── 验证：${v.status} ──`, `  ${v.summary}`);
  if (v.units.length) {
    const n = (s: string): number => v.units.filter((u) => u.status === s).length;
    const measured = n('verified') + n('diff');
    lines.push(`  逐条结论：已测 ${measured}/${v.units.length} 个函数单元（verified ${n('verified')} · diff ${n('diff')}）· 未测 ${n('unverified')}（原因逐条见下）`);
  }
  for (const u of v.units.filter((x) => x.status === 'diff')) {
    lines.push(`  · ${u.unit} 有差异：${u.cases_matched}/${u.cases_total} 一致（${u.source}）`);
  }
  const unverified = v.units.filter((x) => x.status === 'unverified');
  for (const u of unverified.slice(0, 5)) lines.push(`  · ${u.unit} 未验证：${u.reason ?? '原因未记'}`);
  if (unverified.length > 5) lines.push(`  · …另有 ${unverified.length - 5} 个未验证（见 data.receipt.verification.units）`);
  if (v.repo_tests.length) {
    const shown = v.repo_tests.slice(0, 3).map((t) => `${t.func}(${t.cases} 条)`).join(', ');
    lines.push(`  仓库测试：${v.repo_tests.length} 个用例来源 — ${shown}${v.repo_tests.length > 3 ? ' …' : ''}`);
  }

  lines.push('', `【已知】${receipt.known.length} 条（AST/常量求值/import/调用边）`);
  lines.push(`【未知】${receipt.unknowns.length} 条（推测/缺失/假设 ⇒ data.receipt.unknowns）`);
  for (const u of receipt.unknowns.slice(0, 5)) lines.push(`  · [${u.kind}/${u.basis}] ${u.id}：${u.detail}`);
  if (receipt.unknowns.length > 5) lines.push(`  · …另有 ${receipt.unknowns.length - 5} 条`);

  // ★ I3：硬依赖清单（独立区块，不混进未知）—— strategy 初始空由模型/人填
  const deps = receipt.external_deps ?? [];
  lines.push(
    `【硬依赖清单】${deps.length} 条（非 stdlib Go 包，TS 侧无对应物；strategy 待填：npm_equiv=等价 npm 库 / same_slot=同槽位替身 / http_bridge=HTTP 桥接）`,
  );
  for (const d of deps.slice(0, 5)) lines.push(`  · import "${d.import}" · strategy=${d.strategy === '' ? '（空，待填）' : d.strategy}`);
  if (deps.length > 5) lines.push(`  · …另有 ${deps.length - 5} 条（全量见 data.receipt.external_deps）`);
}

/** 项目模式回执：编译门禁的读数如实记，但**不许**当成"功能达成" */
function projectReceipt(r: ProjectResult, fillRequested: boolean, verifyRequested: boolean): Receipt {
  const known: KnownFact[] = [];
  const filled = new Map<string, string>();
  const fillFailures = new Map<string, string>();
  const units: TransUnit[] = [];
  const skipped: SkippedDecl[] = [];
  for (const m of r.modules) {
    for (const u of m.units) units.push(u);
    for (const s of m.skipped) skipped.push(s);
    for (const imp of m.imports) known.push({ id: m.rel, kind: 'import', detail: imp });
    for (const c of m.callRefsRaw) known.push({ id: m.rel, kind: 'call_edge', detail: `${c}(…)` });
    for (const [id, why] of m.fillFailures) fillFailures.set(id, why);
    if (fillRequested) for (const u of m.units) if (u.kind === 'func' && !m.fillFailures.has(u.id)) filled.set(u.id, u.skeleton);
  }
  known.push(...buildKnown(units, filled));
  const unknowns = buildUnknowns({ units, filled, fillFailures, skipped, diagnostics: r.diagnostics });
  const funcCount = units.filter((u) => u.kind === 'func').length;
  const tsc = r.tsc;
  // ★ 读数要能追到「哪个入参让它跑」：verify=false 明写未请求；verify=true 明写由它触发。
  const tscNote = tsc?.ran
    ? `${tsc.passed ? 'tsc 通过' : `tsc 未通过（${tsc.clusters.length} 类错误）`}（由 verify=true 触发）`
    : verifyRequested
      ? 'tsc 未运行（verify=true，但工程里没有可编译的模块）'
      : 'tsc 未运行（verify=false，未请求）';
  const verification = unverifiedReceipt(
    `项目模式只做了编译/结构门禁（${tscNote}），没有逐函数对照测试 —— 编译通过 ≠ 功能达成`,
    funcCount,
    units.length - funcCount,
  );
  // ★ I3：项目模式暂不逐文件扫外部 import（m.imports 是生成出的 TS 相对 import，不是 Go 外部依赖）——
  //   硬依赖清单在单文件模式由 externalImportsOf 供给；项目模式如需，随模块萃取另案挂账。
  return { known, unknowns, verification, external_deps: [] };
}

/** 调用方显式给的用例（宽松收：只认 { args: [...] }，名字可省） */
function parseSuppliedCases(raw: unknown): BehaviorCase[] {
  if (!Array.isArray(raw)) return [];
  const out: BehaviorCase[] = [];
  raw.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const o = c as Record<string, unknown>;
    if (!Array.isArray(o.args)) return;
    out.push({ name: typeof o.name === 'string' ? o.name : `supplied#${i}`, args: o.args });
  });
  return out;
}

/** 非 stdlib 的 Go import（stdlib 首段没有域名点，如 `net/http` / `encoding/json`） */
function externalImportsOf(source: string): string[] {
  const out: string[] = [];
  const push = (p: string): void => {
    if (p.split('/')[0].includes('.')) out.push(p);
  };
  const block = /import\s*\(([\s\S]*?)\)/.exec(source);
  if (block) for (const m of block[1].matchAll(/"([^"]+)"/g)) push(m[1]);
  for (const m of source.matchAll(/^\s*import\s+(?:[A-Za-z_.]\w*\s+)?"([^"]+)"/gm)) push(m[1]);
  return [...new Set(out)];
}
