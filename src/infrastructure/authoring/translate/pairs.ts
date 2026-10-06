/**
 * pairs —— TRANSLATE_PAIRS 注册表 + 端到端管道
 *
 * 全语言泛化的"壳"：共享 trans_unit 协议与验证闸一次建成，新 (src,dst) 语义
 * 映射只在这里挂一张表（extractor + codegen），核心零改动 —— 与仓库
 * refactor_langs / LANG_RESOLVERS 的"新语言 = 新映射"哲学一致。
 *
 * 管道 `translateGoToTs`：萃取 → 骨架生成 → 验证，产出可落盘的目标源码与
 * 一页"待 LLM 填的孔"清单（由 prompts 消费）。
 */

import { extractGo, type SkippedDecl } from './go_extractor.js';
import { renderTsSkeleton, channelShimSource } from './ts_codegen.js';
import { verifySkeletons, type VerifyIssue } from './verify.js';
// ★★ 2026-09-30（修循环依赖，T-cycle）：这里原有一行
//   `export { translateGoProject, walkGoFiles, type ProjectModule, type ProjectResult } from './project.js';`
//   —— 注释写着「re-export 便于统一入口」。它**本身不复用任何东西**，只是转发；
//   而 `project.ts` 反过来 import 本文件的 `translateGoToTs` ⇒ **两文件成环**
//   （dependency-cruiser 的 `no-circular` 抓到的 8 个之一）。
//   ★ 这类"**桶文件造成的环**"是最常见的一种：**转发不是依赖**，删掉转发、让消费者直连即可。
//   ⇒ 已删；`tool.ts` 改为直接从 `./project.js` 引 `translateGoProject`（当时还有 `translate_cli.ts`，
//     该 CLI 已于 2026-10-06 删除 —— 能力与 argv 面都归位到「MCP 注册 + `cli.js` 投影」）。
import { buildHolePrompts } from './prompts.js';
import type { TransUnit } from './unit.js';

export interface TranslatePair {
  srcLang: string;
  srcExt: string;
  dstLang: string;
}

/** (src,dst) 语义对注册表。加对 = 加一条；extractor/codegen 挂在具体实现里。
 *  切片先落 go→ts，其余对为占位（未接实现前视为未注册）。 */
export const TRANSLATE_PAIRS: Record<string, TranslatePair> = {
  'go-ts': { srcLang: 'go', srcExt: '.go', dstLang: 'ts' },
};

export function translatePair(srcLang: string, dstLang: string): TranslatePair | undefined {
  return TRANSLATE_PAIRS[`${srcLang}-${dstLang}`];
}

export interface TranslateResult {
  /** 目标语言源码产物（骨架全在此；bodyHole=true 的单元函数体待 LLM 填） */
  output: string;
  /** 全部待 LLM 填的孔（prompts） */
  holePrompts: string[];
  /** 机械骨架验证（语法闸 + 结构闸）；空 = 骨架全可解析、形状一致 */
  issues: VerifyIssue[];
  /** 顶层单元明细 */
  units: TransUnit[];
  /** 萃取期被跳过的项（空结构/空接口/无法求值 const）——A1 显式失败清单 */
  skipped?: SkippedDecl[];
  ok: boolean;
  error?: string;
}

/** Go → TS 端到端管道：萃取 → 机械骨架 → 静态验证 */
export async function translateGoToTs(filePath: string, source: string): Promise<TranslateResult> {
  const src = await extractGo(filePath, source);
  if (src.error) return { output: '', holePrompts: [], issues: [], units: [], ok: false, error: src.error };

  for (const u of src.units) {
    u.skeleton = renderTsSkeleton(u);
  }
  const issues = await verifySkeletons(src.units);
  const body = src.units.map((u) => u.skeleton).join('\n\n') + (src.units.length ? '\n' : '');
  // 任一片段用到 Channel 就前置一次通道垫片，保证输出自包含可编译
  const shim = body.includes('Channel<') ? channelShimSource() : '';
  const output = shim + body;
  const holePrompts = buildHolePrompts(src.units);
  return {
    output,
    holePrompts,
    issues,
    units: src.units,
    skipped: src.skipped,
    ok: (issues.length === 0 && src.units.length > 0),
  };
}