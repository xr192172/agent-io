/**
 * discussion_log.ts —— **讨论登记格**（`TaskDiscussion`）的**纯函数**：微缩渲染 + 展开判定。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的节点 `file_src_domain_discussion_log_ts`
 * （`decision.expectations` 要求本文件存在且含 `renderMicro` / `shouldExpand`；
 * `decision.acceptance` 要求「展开条件是机器可判的（领取时 / 判失败需裁决时 / expand=discussion）」；
 * `semantic.files` 的责任 = 「讨论登记：微缩在前、按需展开、版本链」）。
 *
 * ## 它治什么病（一句话）
 * ★ **「结论没有住处」**。用户逐字批评 ——
 * *"我记得我们之前应该有一段很长的关于这个任务系统的讨论的呀，为什么你这又要我重新去复述？
 * 难道那个没有登记到设计 DSL 里或者是角色卡里吗？"* ⇒ 实测检索历史会话 **0 命中**
 * （`docs/discussion-log.md` §② 有读数）⇒ **那次讨论确实没被登记** ⇒ 我一直在重新发现、重新问。
 * 本文件给出登记格的**最小机制**：**微缩（默认展示）+ 原话与结论（按需展开）**。
 *
 * ## ★★ 铁律一：本文件住 `src/domain/` ⇒ **不许 import `src/application/` 任何东西**
 * （裁定 `OQ9`（2026-10-16）：**抽 domain 纯函数** —— domain 定"怎么判"、application 管"去哪取"。
 * 本文件 **不判** `expectations`、**不读** `cache.db`、**不写**盘、**不开**文件。）
 *
 * ## ★★ 铁律二：两个导出都是**纯函数**（输入 → 输出，无 IO）
 * - {@link renderMicro}`(discussion)` → 微缩一行 + `open` 计数；★ **`user_quote` 不出现在输出里**；
 * - {@link shouldExpand}`(discussion, ctx)` → `boolean`，触发条件**机器可判**（见 {@link ExpandTrigger}）。
 *
 * ## ★ 版本链（`decided_at` / `supersedes`）
 * 两键的形状住在 `task_schema.ts#TaskDiscussion`（不在此处另立一套）。
 * ★ **本文件不做链序**（"后定的覆盖先定的"这类**排序 / diff**）—— 目前**无消费方**
 * ⇒ 不写没人读的函数；该事的归属见设计 DSL 的 `task_plan.open_questions` 的 **OQ4**
 * （"discussion 版本链要不要可 diff"）。
 */
import type { TaskDiscussion } from './task_schema.js';

/**
 * ★ **微缩态允许出现的键**（白名单）—— `renderMicro` 的输出**只有**这两键。
 * ★ 白名单是**穷举**的：不在表里的字段**结构上**到不了默认视野（不是靠人自觉不带）。
 */
export const MICRO_KEYS = ['micro', 'open_count'] as const;

/** 微缩态允许出现的键之一。 */
export type MicroKey = (typeof MICRO_KEYS)[number];

/**
 * ★★ **只按需展开才渲染的字段**（`user_quote` 领衔）—— `renderMicro` **刻意不带**。
 *
 * ★ 为什么单独列成一张表（而不是"随手没带"）：这是「**不直接展示**」那句话的**机制**。
 * 用户原话是**逐字引文**（`docs/discussion-log.md` 体例："★ 逐字引用，不许改写"），
 * 把它塞进默认视野 = 默认视野失效；默认视野要的是 **10 秒可读的微缩**。
 * ⇒ **excludedFields** 让"我排除了什么"变成**可查的读数**，而不是一句注释。
 */
export const EXPAND_ONLY_FIELDS = ['user_quote', 'conclusion', 'decided_at', 'supersedes'] as const;

/** 只在展开态渲染的字段之一。 */
export type ExpandOnlyField = (typeof EXPAND_ONLY_FIELDS)[number];

/** {@link renderMicro} 的输出 —— ★ **只有** {@link MICRO_KEYS} 这两键。 */
export interface DiscussionMicro {
  /** 微缩：10 秒可读的一行（★ 逐字取 `discussion.micro`，**不改写**） */
  micro: string;
  /**
   * ★ **未定项计数**（`open.length`）—— 只给计数、**不给内容**。
   * 为什么：未定项本身就是"要看全文"的东西；默认视野只需知道"有几条还没定"。
   */
  open_count: number;
}

/**
 * ★ **微缩渲染**（设计 DSL：`discussion_log` 节点的 `renderMicro`）。
 *
 * 输入 `TaskDiscussion` ⇒ 输出 {@link DiscussionMicro}（`micro` + `open_count`）。
 * ★ **`user_quote` / `conclusion` / `decided_at` / `supersedes` 一律不出现在输出里**
 *   —— 字段级排除（见 {@link EXPAND_ONLY_FIELDS}），这是"不直接展示"的**机制**。
 *
 * 纯函数：同一输入必得同一输出；不读盘、不看时间、不摸全局。
 */
export function renderMicro(discussion: TaskDiscussion): DiscussionMicro {
  return {
    micro: discussion.micro,
    open_count: discussion.open?.length ?? 0,
  };
}

/**
 * ★ **本条讨论里，被 {@link renderMicro} 刻意排除、且确实有值的字段**（读数是**键名**，不是内容）。
 *
 * 用途：把"排除"这件事变成**可查的证据**（谁被挡在默认视野外）——
 * ★ 它**不是** `renderMicro` 的返回值的一部分（返回值只有 {@link MICRO_KEYS} 两键）。
 */
export function excludedFields(discussion: TaskDiscussion): ExpandOnlyField[] {
  return EXPAND_ONLY_FIELDS.filter(
    (k) => discussion[k] !== undefined && discussion[k] !== null,
  );
}

/**
 * ★★ **展开的三个触发条件**（**机器可判** —— 设计 DSL 的 `decision.acceptance`：
 * "展开条件是机器可判的（**领取时** / **判失败需裁决时** / **expand=discussion**）"）。
 *
 * | 触发 | 何时 | 谁给 |
 * |---|---|---|
 * | `claim` | **闸内领取该卡时**（`isClaimable(cardStanding(...))` / claim 路径上） | `task_machine` 侧 |
 * | `judge-failed` | **`judgeExpectations` 判失败、需人工裁决时** | 判定器报告（`failed > 0`） |
 * | `explicit` | **调用方显式 `expand='discussion'`** | 调用方逐字传 |
 */
export type ExpandTrigger = 'claim' | 'judge-failed' | 'explicit';

/** 三种触发的穷举清单（★ 与 {@link ExpandTrigger} 同一批，别处不许再抄一份字面量）。 */
export const EXPAND_TRIGGERS = ['claim', 'judge-failed', 'explicit'] as const;

/**
 * {@link shouldExpand} 的入参 —— ★ **必须能表达那三种触发**（这是设计 DSL 的要求）。
 * ★ 三个字段**互相独立**：任一为真即展开；全不为真即不展开（默认只看微缩）。
 */
export interface ExpandContext {
  /** ① **闸内领取该卡时**（`isClaimable(cardStanding(...))` / claim 路径上；见 `src/domain/task_machine.ts`） */
  claiming?: boolean;
  /** ② **`judgeExpectations` 判失败、需人工裁决时**（★ 传"判失败"这一事实，不必传报告） */
  judgeFailed?: boolean;
  /** ③ **调用方显式 `expand='discussion'`** —— ★ **逐字**比较，别的值**不算**触发 */
  expand?: string | null;
}

/**
 * ★ **命中的触发条件**（可能多条同时命中；空数组 = 不展开）。
 *
 * 拆出来单列，是为了让"**为什么展开**"可读 —— 只返回 boolean 时，展开与不展开都看不出由头。
 */
export function matchedExpandTriggers(ctx?: ExpandContext | null): ExpandTrigger[] {
  const hit: ExpandTrigger[] = [];
  if (ctx?.claiming === true) hit.push('claim');
  if (ctx?.judgeFailed === true) hit.push('judge-failed');
  if (ctx?.expand === 'discussion') hit.push('explicit');
  return hit;
}

/**
 * ★★ **该不该展开**（设计 DSL：`discussion_log` 节点的 `shouldExpand`）。
 *
 * ## 判据（**机器可判**，不靠人记）
 * 1. **没有登记**（`discussion` 为空）⇒ `false`（无可展开，与触发条件无关）；
 * 2. 否则：{@link matchedExpandTriggers} **非空** ⇒ `true`；**空** ⇒ `false`（默认只出微缩）。
 *
 * ## ★ 纯函数
 * 输入 → 输出；不读盘、不看时间、不看全局。同一 `(discussion, ctx)` 必得同一结果。
 * ★ 判定器（`judgeExpectations`）**不在这里**被调用 —— 调用方把"判失败"这一**事实**
 *   放进 `ctx.judgeFailed`（裁定 OQ9：domain 只判、application 去取）。
 */
export function shouldExpand(
  discussion?: TaskDiscussion | null,
  ctx?: ExpandContext | null,
): boolean {
  if (!discussion) return false;
  return matchedExpandTriggers(ctx).length > 0;
}
