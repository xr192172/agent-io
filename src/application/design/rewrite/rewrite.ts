/**
 * rewrite —— ⑥「设计 DB → 源码」的**执行器**（工具 `design_line` 的 `action=rewrite`）
 *
 * ## 它做什么
 * ```
 * 设计 DB（certs/design-db/*.calls.json 的 symbols[].signature）
 *       ↕  diff（判据住在 ./symbol_diff.ts，全仓唯一一份）
 * 源码（现场 parseFileFull）
 * ⇒ 同一份 diff 出【三种】结论，各有各的处置：
 *    ① 签名不同        ⇒ ★ 可重写（⑥ 的职责）→ buildRefactorPlan → applyRefactorPlan
 *    ② 设计有·源码没有  ⇒ ✗ 不可生成（DSL 只有结构+意图，没有实现 ⇒ 人写）
 *    ③ 源码有·设计没有  ⇒ ✗ 设计漏了（③ sync 的职责，不是 ⑥）
 * ```
 *
 * ## ★ 落盘后必须重算（2026-10-19 上午踩出来的）
 * 屏幕报「0 条签名差异」而源码其实被改了 —— 因为报告拿的是 apply **之前**的读数。
 * ⇒ 这里的纪律：**报告的每个数字都取自动作【之后】的重新测量**。
 *   落盘后 `diffSymbols` 再跑一次；复核不为 0 ⇒ `ok=false`，不能算成功。
 *
 * ## 默认零写入
 * `apply` 不传/为 false 时：不写源码、不写清单、不改任何文件。
 * ★ 这条是刻意的：一个会把源码改掉的动作，默认必须是"只看"。
 */
import { diffSymbols, uncomparedTotal, type SymbolDiffResult } from './symbol_diff.js';
import {
  buildRefactorPlan,
  applyRefactorPlan,
  type RefactorPlan,
  type RefactorTarget,
} from '../../refactor/pipeline/refactor_plan.js';

export interface RewriteArgs {
  /** 仓库根（绝对路径） */
  projectDir: string;
  /** 只用于报告头部（判定本身不看 feature） */
  feature?: string;
  /** 只算一个文件（仓库相对路径） */
  onlyFile?: string;
  /** 只算某个前缀 */
  prefix?: string;
  /** ★ true 才真落盘；默认 false = 零写入 */
  apply?: boolean;
}

export interface RewriteResult {
  feature: string;
  scanned: number;
  /** 签名相同的条数 */
  same: number;
  /** 可重写的签名差异（⑥ 的输入） */
  differ: SymbolDiffResult['differ'];
  /** 不可比的条数（★ 不算一致） */
  uncompared: number;
  uncomparedByKind: Record<string, number>;
  unpaired: number;
  /** 设计有·源码没有（不可生成，人写） */
  designOnly: number;
  /** 源码有·设计没有（③ sync 的职责） */
  sourceOnly: number;
  applied: {
    plan: RefactorPlan;
    res: { applied: number; already_applied: number; failed: number; written: boolean; ok: boolean; items: Array<{ status: string; file: string; error?: string }> };
    /** ★ 落盘后重算得到的 differ 数（不是 apply 前的） */
    afterDiffer: number;
    /** ★ 综合结论：apply 成功 且 复核为 0 */
    ok: boolean;
  } | null;
}

/**
 * 跑 ⑥。**默认零写入**；`apply=true` 才走 buildRefactorPlan → applyRefactorPlan。
 */
export async function rewriteSymbols(args: RewriteArgs): Promise<RewriteResult> {
  const r = await diffSymbols({ projectDir: args.projectDir, onlyFile: args.onlyFile, prefix: args.prefix });
  const uncompared = uncomparedTotal(r.uncompared);

  const out: RewriteResult = {
    feature: args.feature ?? '',
    scanned: r.scanned,
    same: r.same.length,
    differ: r.differ,
    uncompared,
    uncomparedByKind: Object.fromEntries([...r.uncompared.entries()].sort((a, b) => b[1] - a[1])),
    unpaired: r.unpaired.length,
    designOnly: r.designOnly.length,
    sourceOnly: r.sourceOnly.length,
    applied: null,
  };

  if (!args.apply) return out;

  const targets: RefactorTarget[] = r.differ.map((t) => ({ file: t.file, old_text: t.old_text, new_text: t.new_text }));
  // ★ 空清单是**结论**，不是"跳过"——不编造一次空 apply 去骗过调用方
  if (targets.length === 0) return out;

  const plan = await buildRefactorPlan({ project_dir: args.projectDir, targets });
  const res = await applyRefactorPlan({ project_dir: args.projectDir, plan, atomic: true });
  // ★★★ 落盘后【重算】一次：报告反映"现在"，不拿 apply 前的读数冒充结果
  const after = await diffSymbols({ projectDir: args.projectDir, onlyFile: args.onlyFile, prefix: args.prefix });

  out.applied = {
    plan,
    res: {
      applied: res.applied,
      already_applied: res.already_applied,
      failed: res.failed,
      written: res.written,
      ok: res.ok,
      items: res.items.map((it) => ({ status: it.status, file: it.file, ...(it.error ? { error: it.error } : {}) })),
    },
    afterDiffer: after.differ.length,
    ok: res.ok && after.differ.length === 0,
  };
  return out;
}
