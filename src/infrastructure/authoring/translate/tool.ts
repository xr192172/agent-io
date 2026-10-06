/**
 * tool —— translate_go_ts 的 MCP handler（胶水层：把翻译链路暴露给 agent）
 *
 * 逻辑：读 Go 源 → 机械骨架 + 验证闸（默认）；fill=true 再用 AGNES key 池 LLM 逐孔填；
 * verify=true 再对已填的纯函数跑 Go↔TS 行为对拍（需 go 工具链）。纯编排，业务全在
 * pairs/llm/fill/verify_behavior。
 */

import fs from 'node:fs';
import path from 'node:path';
import { translateGoToTs } from './pairs.js';
// ★ 2026-09-30：原先从 `./pairs.js` 引 `translateGoProject`（那是 pairs 的**转发**）⇒ 制造了
//   `pairs ↔ project` 的环（`no-circular` 抓到）。转发已删，这里直连真正的出处。
import { translateGoProject } from './project.js';
import { createPooledHoleTranslator } from './llm.js';
import { fillUnitsWithRetry } from './fill.js';
import { checkTranslationParity, generateCasesFor } from './verify_behavior.js';

export interface TranslateGoTsArgs {
  file?: string;
  /** Go 项目目录：一次翻译整个项目（枚举 .go、跨文件 import、镜像落盘） */
  projectDir?: string;
  /** 项目模式下落盘根（镜像 source 结构） */
  outDir?: string;
  /** 用 AGNES key 池 LLM 逐孔填函数体 */
  fill?: boolean;
  /** 对已填的纯函数跑行为对拍（需 go 工具链） */
  verify?: boolean;
  /** 项目模式全工程 tsc 门禁：对内存模块树跑 TS preEmit，错误入诊断（纯项目应 0 错） */
  tscVerify?: boolean;
  /** 项目内一批函数一次 LLM 调用（内置 key 池走批量）。默认 5 */
  batchSize?: number;
  /** LLM 纠错重试次数，默认 2 */
  maxRetries?: number;
}

export async function translateGoTsHandler(args: Record<string, unknown>): Promise<{ message: string; data?: unknown }> {
  const fill = args.fill === true;
  const verify = args.verify === true;
  const tscVerify = args.tscVerify === true;
  const maxRetries = typeof args.maxRetries === 'number' ? args.maxRetries : 2;
  const batchSize = typeof args.batchSize === 'number' ? args.batchSize : undefined;
  // ★ 2026-10-06（T15 第 4 项）：这两个原先**只在 `translate_cli` 的 argv 里**
  //   ⇒ 「能力被藏在了 MCP 面之外」（CLI 的 flag 有、zod schema 没有 ⇒ agent 无从调用）。
  const holes = args.holes === true;
  const out = typeof args.out === 'string' && args.out ? args.out : undefined;

  // 项目级：一次翻译整个 Go 项目
  const projectDir = String(args.projectDir ?? '');
  if (projectDir) {
    const root = path.resolve(projectDir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { message: `Go 项目目录不存在：${root}` };
    const outDir = args.outDir ? path.resolve(String(args.outDir)) : undefined;
    const r = await translateGoProject(root, { outDir, fill, maxRetries, verify: tscVerify, batchSize });
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
    if (outDir) lines.push(`已落盘到 ${outDir}`);
    return { message: lines.join('\n'), data: { modules: r.modules.map((m) => ({ rel: m.tsRel, imports: m.imports, units: m.units.length })), diagnostics: r.diagnostics, report: r.report, typesMap: r.typesMap, conflicts: r.conflicts } };
  }

  const file = String(args.file ?? '');
  if (!file) return { message: '需要 file=<Go 源文件路径> 或 projectDir=<Go 项目目录>' };
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) return { message: `Go 源文件不存在：${abs}` };
  const source = fs.readFileSync(abs, 'utf-8');

  const r = await translateGoToTs(abs, source);
  if (r.error) return { message: `翻译失败：${r.error}` };

  let units = r.units;
  let output = r.output;
  const notes: string[] = [];
  if (r.issues.length) {
    notes.push(`机械骨架验证闸（未过，这部分单元不可落盘）：${r.issues.map((i) => `${i.id}[${i.gate}]`).join(', ')}`);
  }

  if (fill) {
    const translate = createPooledHoleTranslator();
    const filled = await fillUnitsWithRetry(units, translate, maxRetries);
    const byId = new Map(filled.map((f) => [f.unit.id, f]));
    output = units
      .map((u) => {
        const f = byId.get(u.id);
        return (f?.ok ? f.filledSource : u.skeleton) ?? u.skeleton;
      })
      .join('\n\n');
    notes.push(`LLM 填孔：${filled.filter((f) => f.ok).length}/${filled.length} 过验证；` + filled.filter((f) => !f.ok).map((f) => `${f.unit.id}(失败)`).join(', ') || '全过');
  }

  if (verify) {
    const parity = runParityOnFilled(units);
    notes.push(`行为对拍（Go↔TS，需 go 工具链）：${parity.message}`);
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
      fs.writeFileSync(outAbs, output, 'utf-8');
      outPath = outAbs;
      notes.push(`已写入 ${outAbs}`);
    }
  }

  const header = `Go→TS 萃取 ${units.length} 个单元${fill ? '（已按 LLM 填充）' : ''}`;
  return {
    message: [header, ...notes, '', r.output ? output : '（无单元）'].join('\n'),
    data: {
      unit_ids: units.map((u) => u.id),
      output,
      ...(holePrompts.length > 0 ? { hole_prompts: holePrompts } : {}),
      ...(outPath ? { out_path: outPath } : {}),
    },
  };
}

/** 对已填充的纯函数跑对拍；返回可读汇总（含失败原因） */
function runParityOnFilled(units: Awaited<ReturnType<typeof translateGoToTs>>['units']): { message: string } {
  const funcs = units.filter((u) => u.kind === 'func' && !(u.typeParams?.length) && u.skeleton && !u.bodyHole);
  if (funcs.length === 0) return { message: '无可对拍的已填纯函数（跳过）' };
  const lines: string[] = [];
  for (const u of funcs.slice(0, 5)) {
    // 需 Go 源码上下文：用 unit.srcSnippet（单函数文本）作为 Go 侧
    try {
      const res = checkTranslationParity({
        goSource: u.srcSnippet,
        funcName: u.name,
        tsOutput: u.skeleton,
        params: u.params,
      });
      const verdict = res.verdict.verdict === 'same' ? '一致' : res.verdict.verdict === 'diff' ? '有差异' : '对拍失败';
      lines.push(`  ${u.name}: ${verdict}${res.verdict.verdict !== 'same' ? ` — ${res.verdict.message}` : ''}`);
    } catch (e) {
      lines.push(`  ${u.name}: 对拍异常：${(e as Error).message}`);
    }
  }
  return { message: lines.join('\n') };
}