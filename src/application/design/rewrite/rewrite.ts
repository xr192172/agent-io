/**
 * rewrite —— ⑥「设计 DB → 源码」的**执行器**（工具 `design_line` 的 `action=rewrite`）
 *
 * ## 它做什么
 * ```
 * 设计 DB（design-db/*.calls.json 的 symbols[].signature）
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
 * ## ★ 边界（2026-10-20 明写）：**只同步签名，不生成实现**
 * 它**不**做这些：不写函数体、不新增/删除符号、不新建文件、不改设计侧。
 * 可比的只有 `function`（见 `./symbol_diff.ts` 的 `COMPARABLE`）⇒ `const`/`interface`/`type`/`class`
 * 的改动**永远发现不了**（这就是 `reason:'uncomparable_kind'` 那格）。
 * ⇒ 对外名字从 `rewrite` 改成 `sync-signatures`（旧名保留为别名）—— 「rewrite」听起来像能造实现。
 *
 * ## ★ 结论必须可判定（2026-10-20）
 * 历史缺陷（实测 33 次调用体检）：`路径不存在` / `设计 DB 没副本` / `真的没差异` 三种输入
 * **输出逐字相同**（都是 `✓ 没有可重写的签名差异` + `ok:true`）⇒ 自动化只能靠人读中文判成败。
 * ⇒ 现在有 `did_work`（本次是否真有差异被 apply）+ `reason`（没做事时属于哪种）。
 * ★ `ok` 只表示"这次调用没失败"，**不表示做了事** —— 判成败请读 `did_work` + `reason`。
 *
 * ## 默认零写入
 * `apply` 不传/为 false 时：不写源码、不写清单、不改任何文件。
 * ★ 这条是刻意的：一个会把源码改掉的动作，默认必须是"只看"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { diffSymbols, uncomparedTotal, type SymbolDiffResult } from './symbol_diff.js';
import {
  buildRefactorPlan,
  applyRefactorPlan,
  type RefactorPlan,
  type RefactorTarget,
} from '../../refactor/pipeline/refactor_plan.js';
import { attachGateNote } from '../../refactor/gate_note.js';

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
  /**
   * ★★★ 2026-10-22（写闸覆盖面 · 第 3 条入口）：**本次写入者身份**。
   * 本函数**不自己过闸** —— 落盘交给 `applyRefactorPlan → editCode`（唯一实现）；
   * 但闸既然在那一层，身份就必须**在这里往下传**，否则 `design_line action=sync-signatures`
   * 这条入口就只能看见 env（生产面 stdio 没有 env ⇒ 闸对"谁在写"恒不设防）。
   */
  actor?: string;
  /** ★★★ T356：按 run 授权 —— 同上，一路传到 `editCode` 的写闸（判据仍只住 `write_gate`） */
  authorize?: string;
}

/**
 * ★ `did_work:false` 时**必须**说明属于哪种（`did_work:true` ⇒ null）。
 *
 * 每一格都是**实测过的不同处境**，不是枚举洁癖：
 * - `path_not_found`    给的 `file=` 根本不存在 ⇒ 没有可比对的源码（路径写错 / 打错一个字母）
 * - `no_design_copy`    源码在，但 `design-db/` 没有它的副本（③ / ⑤ 没覆盖）
 * - `uncomparable_kind` 有副本、也比了，可这个文件的符号**全是**不可比类型（只有 const/interface…）
 * - `no_diff`           有副本、有可比符号、比过了 —— 真的没差异
 * - `not_applied`       有差异，但 `apply=false`（零写入的刻意结果）
 * - `already_applied`   `apply=true`，但落盘前它已是设计签名（幂等重放）
 * - `apply_failed`      `apply=true`，但逐项落地失败（冲突 / 写不进去 —— 见 `applied.res.items`）
 * - `gate_blocked`      规划 / 语法门 / 写闸**拦截**（一个字节都没落盘，原因见 `gate.error`）
 */
export type RewriteReason =
  | 'path_not_found'
  | 'no_design_copy'
  | 'uncomparable_kind'
  | 'no_diff'
  | 'not_applied'
  | 'already_applied'
  | 'apply_failed'
  | 'gate_blocked';

/** 拦截发生在哪一段 + 原始错误（`error` 原样透出，不重写成"未知错误"） */
export interface RewriteGate {
  stage: 'plan' | 'apply' | 'recheck';
  error: string;
}

export interface RewriteResult {
  feature: string;
  /** ★ 本次是否真的做了事：**有签名差异被 apply 落盘**（有差异但零写入 / 被拦 / 失败 ⇒ false） */
  did_work: boolean;
  /** ★ `did_work:false` 时属于哪种；`did_work:true` ⇒ null */
  reason: RewriteReason | null;
  /** ★ 规划/语法门/写闸拦截（非 null ⇒ 一个字节都没落盘） */
  gate: RewriteGate | null;
  /**
   * ★★★ 2026-10-22（写闸覆盖面 · 回执线）：**任务闸的放行读数**（闸的 `note` 逐字，含豁免点名）。
   * 来源 = `applyRefactorPlan` 回执的 `task_gate`（闸在 `editCode` 里跑，本层只**带出来**）。
   * ★ 零写入 / 被拦 / 幂等全已应用时没有这个字段 —— 那几种处境闸压根没跑。
   */
  task_gate?: string;
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
 *
 * ★ 判成败读 `did_work` + `reason`（`ok` 只表示「这次调用没失败」，不表示做了事）。
 */
export async function rewriteSymbols(args: RewriteArgs): Promise<RewriteResult> {
  const r = await diffSymbols({ projectDir: args.projectDir, onlyFile: args.onlyFile, prefix: args.prefix });
  const uncompared = uncomparedTotal(r.uncompared);
  // ★ 只有 `file=` 才有「这个路径」这回事（`prefix` 是一批文件，不存在单一存在性）
  const fileMissing =
    args.onlyFile !== undefined && !fs.existsSync(path.resolve(args.projectDir, args.onlyFile));

  const out: RewriteResult = {
    feature: args.feature ?? '',
    did_work: false,
    reason: noWorkReason(r, fileMissing),
    gate: null,
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

  // ★★★ 拦截也必须走**标准信封**（2026-10-20）：
  //   语法门 / 定位歧义 / 写闸都是 `throw`，原先直接冒到 `wrapData` 的 catch
  //   ⇒ 只剩一行中文、无表头、无 `---DATA---`，脚本分不出「成功」与「被拦」。
  //   这里接住，转成结构化结论（`gate` + `reason:'gate_blocked'`），由出口照常渲染。
  let stage: RewriteGate['stage'] = 'plan';
  try {
    const plan = await buildRefactorPlan({ project_dir: args.projectDir, targets });
    stage = 'apply';
    const res = await applyRefactorPlan({
      project_dir: args.projectDir,
      plan,
      atomic: true,
      // ★★★ 2026-10-22（写闸覆盖面）：身份与授权一路往下传 —— 闸在 `editCode` 里，不传就等于没接。
      actor: args.actor,
      authorize: args.authorize,
    });
    // ★★★ 落盘后【重算】一次：报告反映「现在」，不拿 apply 前的读数冒充结果
    stage = 'recheck';
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
    // ★ did_work 的口径只有一条：**真有差异被 apply**（不是"跑了 apply"，也不是 `ok`）
    out.did_work = res.applied > 0;
    out.reason = out.did_work ? null : res.already_applied > 0 && res.failed === 0 ? 'already_applied' : 'apply_failed';
    // ★★★ 2026-10-22（写闸覆盖面 · 回执线）：闸判了、豁免了，就必须**带出来** —— 统一走
    //   `attachGateNote`（唯一带出口，不在这里另拼一句话）。
    return attachGateNote(out, res.task_gate);
  } catch (e) {
    out.gate = { stage, error: (e as Error).message };
    out.reason = 'gate_blocked';
    return out;
  }
}

/**
 * 「这次为什么没做事」—— **唯一**判定处（别把这段顺序散进 handler 的中文分支里）。
 *
 * ★ 顺序有讲究：**先问源码在不在**（路径写错是调用方最常犯的错），
 *   再问**设计 DB 有没有副本**（那是 ③ 同步 / ⑤ gen-db 的缺口），最后才看差分读数。
 * ★ 返回 `RewriteReason` 而不是一句中文：中文是渲染，判据是这七个字面量。
 */
function noWorkReason(
  r: Pick<SymbolDiffResult, 'copies' | 'scanned' | 'same' | 'differ' | 'uncompared'>,
  fileMissing: boolean,
): RewriteReason {
  if (fileMissing) return 'path_not_found';
  if (r.copies === 0) return 'no_design_copy';
  if (r.differ.length > 0) return 'not_applied';
  // 有副本、也比了，但**一条可比符号都没有** ⇒ 差异永远发现不了（不是"没事"）
  if (r.scanned > 0 && r.same.length === 0 && uncomparedTotal(r.uncompared) > 0) return 'uncomparable_kind';
  return 'no_diff';
}
