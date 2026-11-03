/**
 * payload_budget —— 「输出不许撑爆上下文」的**载荷策略**（零依赖纯函数）。
 *
 * 三个动词，各只许一处实现：
 *   ① `utf8Bytes` —— 量**字节**（不是字符：一个中文字符 3 字节，按字符量会把中文载荷低估约 1.6 倍）；
 *   ② `fitWithinBudget` —— 预算内最多填几条（逐条字节的前缀和）；
 *   ③ `limitNotice` / `truncationNotice` —— 截断必须**带分母 + 给出路**（AGENTS-RULES 0.12 第 3 条：
 *      「只给分子等于没验」）。
 *
 * ★ 为什么住 `domain` 且**零 import**：`behavior-cases` 判据的 harness 把目标文件单独转译再 import
 *   ⇒ 目标必须零依赖（`docs/SUBAGENT-HANDBOOK.md` §8）。预算口径恰恰最该被行为判住 ——
 *   它坏起来**没有声音**：「多列 5 行」与「预算根本没生效」在回执上长得一模一样。
 *
 * ★ 为什么不许各出口自己写一句截断文案（历史代价）：两个出口各写一份 ⇒ 一份带分母一份不带，
 *   而两份都能"看起来正常"。
 */

// ★ 「百分比怎么印」不在这里：唯一实现住 `./rate.js` 的 `ratioPercent`（一位小数；分母为 0 回 `—`）。
//   两处各写一份取整口径的后果是「一份印 0.0、一份印 —」，而两个出口都看起来正常。
import { ratioPercent } from './rate.js';

/** UTF-8 字节数 —— 载荷预算的**唯一**度量（★ 不是字符数：中文一字 3 字节）。 */
export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** 人类可读的字节数（1024 进制、整档）：32768→`32KB`、524288→`512KB`、2097152→`2MB`。 */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/** 截断说明的入参：`unit` = 被截断的那个东西的单位（个函数 / 条问题 / 个目录）。 */
export interface LimitNoticeInput {
  shown: number;
  total: number;
  unit: string;
  /** 为什么停在这里（`预算 32KB 用尽` / `每组只列前 10 条`） */
  reason: string;
  /** 出路 = 用户**照抄即用**的参数（dir=… / files=… / budget=… / detail=true） */
  routes: string;
  /** 可选：本次范围（让人知道分母是"整体"还是"筛过的一片"） */
  scope?: string;
}

/**
 * 「截断必须带分母 + 出路」的**唯一措辞**：
 * `已列 164/3238 个函数（5.1%），预算 32KB 用尽；取更多：dir=src/domain / files=a.ts,b.ts / budget=131072`
 */
export function limitNotice(o: LimitNoticeInput): string {
  const scope = o.scope ? `（范围 ${o.scope}）` : '';
  return (
    `已列 ${o.shown}/${o.total} ${o.unit}（${ratioPercent(o.shown, o.total)}%）${scope}，` +
    `${o.reason}；取更多：${o.routes}`
  );
}

/** 预算型截断 = `limitNotice` 的固定 reason（预算数字统一走 `formatBytes`，别在各处手拼 KB）。 */
export function truncationNotice(o: {
  shown: number;
  total: number;
  unit: string;
  budget: number;
  routes: string;
  scope?: string;
}): string {
  return limitNotice({
    shown: o.shown,
    total: o.total,
    unit: o.unit,
    reason: `预算 ${formatBytes(o.budget)} 用尽`,
    routes: o.routes,
    scope: o.scope,
  });
}

/**
 * 预算内最多能填几条：`sizes` 是**逐条字节**（调用方按"要列的顺序"给），返回前缀和 ≤ `budget` 的最长前缀长度。
 * ★ 边界口径（三条都判过）：空列表 ⇒ 0；`budget <= 0` ⇒ 0（**不是**"全给" —— 没预算就别假装列了）；
 *   某条尺寸为负 = 调用方的 bug ⇒ 到此为止（不静默跳过它继续数）。
 */
export function fitWithinBudget(sizes: readonly number[], budget: number): number {
  if (!(budget > 0)) return 0;
  let used = 0;
  let k = 0;
  for (const s of sizes) {
    if (!(s >= 0)) break;
    if (used + s > budget) break;
    used += s;
    k += 1;
  }
  return k;
}
