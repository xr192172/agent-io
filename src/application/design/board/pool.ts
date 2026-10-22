/**
 * pool.ts —— **任务池的读端**（`board_pool` 节点）。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的节点 `file_src_application_design_board_pool_ts`
 * - `decision.summary`：「把各节点 task 格按 state 收集成"池"：一条只读调用就能看到 candidate / claimed / done」
 * - `decision.acceptance`：「`listPool` 返回 `BoardView{byState,total,folded}` 且 `shown+folded==total`；能经 `get_dsl` 的查询触达」
 *
 * ## ★ 读哪一份（这是本文件最容易搞错的一处）
 * 它读 **`getDSL(feature)` = `.agent-io/design/<f>.dsl.json`（设计侧，2026-10-18 统一）**。
 * 理由：它要的是 **`task`（卡的实际状态）**，而 `task` 就住在设计侧的节点上（卡跟图纸走）；
 * 设计侧持有的是 `decision`（意图）。两者的分工见 `DESIGN.md §8`。
 *
 * ## 为什么要有它
 * 没有它，看"池子里有什么"只能 `node -e` 手工拼 —— ★ 那是第二个"读 DB 拼图"的入口，
 * 本仓明令不许。所以这个文件是**唯一**的池读端。
 *
 * ## 纯读
 * 不写任何文件、不改 `task`、不碰 overlay。
 */
import { getDSL } from '../../../infrastructure/storage.js';
// ★ 2026-10-22（D-T8 上架读端）：卡的列表要回答「谁占着 / 挂了多久」⇒ 租约判据**借** domain 那两把尺，
//   不在这里再写一遍 `now - claimed_at > ttl`（那会是第二份口径，两处迟早对不上）。
import { isLeaseExpired, leaseAgeHours } from '../../../domain/task_machine.js';
// ★ 节点卡「占着什么文件」用 `nodePath`（`path` 优先、`description` 回落）—— 那是全仓唯一一把尺
//   （`write_gate.ts#nodeFilePath` / `overlay.ts#nodePath` 同口径），本文件**不复制第三份**。
import { nodePath } from '../../../domain/overlay.js';
import type { TaskSpec, TaskState } from '../../../domain/task_schema.js';

/** 卡的全部可能状态（★ 与 `task_schema.ts#TASK_STATES` 同源：`superseded` 已于 2026-10-17 删除） */
const ALL_STATES: TaskState[] = ['candidate', 'claimed', 'done', 'void'];

/**
 * 卡挂在**哪儿** —— 池里的卡有两个来源（★ 2026-10-22 实测：只看 `geometry.nodes` 会漏掉全部 todo 卡）。
 * · `node` = `geometry.nodes[].task`（文件/目录节点上的任务格，占**文件写权**的那张）；
 * · `todo` = `todos[]`（预决策卡，`edit_dsl type=todo` 建的那些）。
 */
export type PoolCardSource = 'node' | 'todo';

/**
 * 池里的**一张卡**（★ 「看得见」的全部：谁占着 / 挂了多久 / 读集多大）。
 *
 * ★ 为什么要有它（D-T8 的原话）：此前 `BoardView` 只有 `byState` 计数 ⇒
 *   「卡挂了以后只能 `node -e` 读到 state=candidate，没有任何读端」—— 计数回答了「几张」，
 *   **没回答「是哪几张、谁占的、占多久了」**。要回答后三个问题就得有这一格。
 * ★ 全部字段都是**现算**（`claimed_at` 是落盘的唯一输入，`age_hours` / `overdue` 由它推）
 *   ⇒ 删掉一张卡，下一次读**必须**看不见它（没有缓存）。
 */
export interface PoolCard {
  /** 卡 id（节点卡 = 节点 id；todo 卡 = todo id） */
  id: string;
  /** 这张卡住哪儿（见 {@link PoolCardSource}） */
  source: PoolCardSource;
  /** 人读一格：节点卡给路径（`nodePath`），todo 卡给 summary 首行 */
  label: string;
  /** 四态之一（`isTaskState` 判过——垃圾 state 不进池，不猜） */
  state: TaskState;
  /** 谁占着；`null` = 没人领 */
  owner: string | null;
  /** claim 的时刻（ISO 8601）；`null` = 没领过 / 已释放 */
  claimed_at: string | null;
  /** 领了多久（小时，1 位小数）；没有合法 `claimed_at` ⇒ `null`（★ 不猜，读成 0 会把「不知道」说成「刚领」） */
  age_hours: number | null;
  /** 租约是否已过期（判据唯一出处 = `domain/task_machine#isLeaseExpired`，不在这里重写 age>ttl） */
  overdue: boolean;
  /**
   * 读集大小（claim 时算的那一份：文件数 / 符号数 / 判据出处 / 算的时刻）。
   * ★ `null` = 这张卡**没有**读集（老卡 / L1 卡 / claim 时没算）—— 与「读集是空集」不是一回事。
   */
  read_set: { files: number; symbols: number; basis: string[]; computed_at: string } | null;
}

/** todo 卡没有路径 ⇒ 人读一格给 summary 的第一行（★ 只截一行：池是索引，不是正文） */
function firstLine(s: string | undefined): string {
  const first = String(s ?? '').split(String.fromCharCode(10)).find((l) => l.trim()) ?? '';
  return first.trim().slice(0, 80);
}

/**
 * 池的读数（★ 具名类型，不许散装对象 —— 否则又是"形状没人定"）。
 *
 * `shown + folded === total` 是**恒等式**，由 `listPool` 保证（`acceptance` 的第 1 句）。
 */
export interface BoardView {
  /**
   * 每个状态各几张卡（没有就是 0 —— 形状固定，读端不用判 undefined）。
   *
   * ★★★ 2026-10-18：**债已还** —— `superseded` 已从 `task_schema.ts#TASK_STATES` 删除（`apply_refactor_plan` 落盘），
   *   所以这里改回了 `Record<TaskState, number>`（下面那段历史保留，说明它曾经为什么是 `Partial`）。
   *
   * ★★ 用 `Partial<TaskState>` 而不是 `TaskState`，**是因为一个真实的矛盾**（不是偷懒）：
   *   - **设计侧**（`docs/…dsl.json` 的 `state_machine.states`）已于 2026-10-17 **删掉 `superseded`**；
   *   - 而**源码**的 `task_schema.ts#TaskState` **还留着它**（`TASK_STATES` 五态）。
   *   ⇒ 写 `Record<TaskState, number>` 会被 `tsc` 拒（"缺 superseded"）—— ★ **那正是它在尽职**。
   *   ⇒ 过渡期用 `Partial` 绕开，**同时挂债**：`D-superseded-remove`（删源码的那个死状态）。
   *   ★ 债还了之后，这里应改回 `Record<TaskState, number>`。
   */
  byState: Record<TaskState, number>;
  /** 总卡数 */
  total: number;
  /** 展开显示的（= `total - folded`） */
  shown: number;
  /**
   * 折叠的：**已了结**（`done` / `void`）。
   * ★ **不是「终态」**（2026-10-22）：`done` 能 `t_reopen`、`void` 能 `t_relaunch` ⇒ 两者都可重新打开；
   *   折叠只是"默认不占视线"，不表示这张卡不能再动。
   * ★ 折叠不是"看不见"，是"默认不占视线" —— 所以它仍计入 `total`。
   */
  folded: number;
  /**
   * 两个来源**各**多少张卡（`node` = 节点卡 / `todo` = `todos[]`）。
   * ★ 有它才能把「节点卡 N / todo 卡 M」分别引用出来 —— 上面 `byState` 是两者**合计**。
   */
  bySource: Record<PoolCardSource, number>;
  /**
   * ★★★ 2026-10-22（D-T8）：**卡的列表**（不只是计数）。
   * ★ 全量 = 节点卡 + todo 卡，与 `byState` / `total` **同一份枚举**（不是第二次扫描）。
   * ★ 现算、不落盘、不缓存 ⇒ 删掉一张卡，下一次调用就看不见它（这是验收 A/B 的判据）。
   */
  cards: PoolCard[];
}

/**
 * 池读端（★ 唯一入口）—— 计数 + **卡的列表**。
 *
 * @param feature 设计 DSL 的 feature 名
 * @param nowMs 判定时刻（epoch ms；★ 默认取 `Date.now()`，显式传入只为可复现 —— 年龄/过期都按它算）
 * @returns 池的读数；`feature` 不存在 ⇒ 抛（★ 不静默返回空池 —— "读不到"不许读成"没有卡"）
 *
 * ## ★★★ 2026-10-22（D-T8）改了两件事，都是"卡挂了看不见"的直接成因
 * ① **有了 `cards`**：以前只有 `byState` 计数 ⇒ 知道"3 张 claimed"，不知道"谁占着哪个文件、占了多久"。
 *   现在每张卡带 `owner` / `age_hours` / `overdue` / `read_set` 大小 ⇒ 一条只读调用回答完。
 * ② **枚举从一处变两处**：`geometry.nodes[].task` **和** `todos[]`。
 *   此前只走 nodes ⇒ 140 张 todo 卡**根本不进池**，而 `query=todo` 又只读 `todos[]`
 *   ⇒ **两半各看不见另一半**（今天 3 张 claimed 的节点卡在 todo 视图里完全不存在）。
 *   ★ 这个"两处都可能有 claimed"的口径不是新定的 —— `task_ops#expireTasks` 早就是这么扫的
 *     （注释逐字：「节点卡 + todo 卡**都扫**」），这里只是让**读端**跟上写端。
 */
export function listPool(feature: string, nowMs: number = Date.now()): BoardView {
  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(
      `feature "${feature}" 不存在 ⇒ 读不到池。\n` +
        `★ 这里**故意不返回空池**：空池会被读成"没有卡"，而真相是"没有这个 feature"。`,
    );
  }

  const byState: Record<TaskState, number> = { candidate: 0, claimed: 0, done: 0, void: 0 };
  const bySource: Record<PoolCardSource, number> = { node: 0, todo: 0 };
  const cards: PoolCard[] = [];
  let total = 0;

  /** 收一张卡（★ 计数与列表**同一处**产生 ⇒ 不会出现"计数 3、列表 2"的静默不一致） */
  const take = (card: TaskSpec, source: PoolCardSource, label: string): void => {
    // ★ 运行期守卫：state 从 JSON 读回时静态类型不再有保证 ⇒ 不认识的 state **不计**
    //   （不猜、也不塞进 candidate —— "读不懂"不许读成某个具体状态）
    if (!ALL_STATES.includes(card.state)) return;
    cards.push({
      id: card.id,
      source,
      label,
      state: card.state,
      owner: card.owner ?? null,
      claimed_at: card.claimed_at ?? null,
      age_hours: leaseAgeHours(card, nowMs),
      // ★ 过期判据**只调** domain 那一把尺（`claimed` 之外恒 false，由它自己判）
      overdue: isLeaseExpired(card, nowMs),
      read_set: card.read_set
        ? {
            files: card.read_set.files?.length ?? 0,
            symbols: card.read_set.symbols?.length ?? 0,
            basis: [...(card.read_set.basis ?? [])],
            computed_at: card.read_set.computed_at,
          }
        : null,
    });
    bySource[source]++;
    byState[card.state]++;
    total++;
  };

  for (const node of dsl.geometry?.nodes ?? []) {
    // ★ 没有卡（无 task）不计入池 —— 池是"卡"的集合，不是"节点"的集合
    if (!node.task) continue;
    take(node.task as TaskSpec, 'node', nodePath(node));
  }
  for (const todo of dsl.todos ?? []) take(todo as unknown as TaskSpec, 'todo', firstLine(todo.summary));

  const folded = byState.done + byState.void;
  return { byState, total, shown: total - folded, folded, bySource, cards };
}
