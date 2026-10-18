/**
 * pool.ts —— **任务池的读端**（`board_pool` 节点）。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的节点 `file_src_application_design_board_pool_ts`
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
import type { TaskState } from '../../../domain/task_schema.js';

/** 卡的全部可能状态（★ 与 `task_schema.ts#TASK_STATES` 同源：`superseded` 已于 2026-10-17 删除） */
const ALL_STATES: TaskState[] = ['candidate', 'claimed', 'done', 'void'];

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
   * 折叠的：**终态**（`done` / `void`）。
   * ★ 折叠不是"看不见"，是"默认不占视线" —— 所以它仍计入 `total`。
   */
  folded: number;
}

/**
 * 池读端（★ 唯一入口）。
 *
 * @param feature 设计 DSL 的 feature 名
 * @returns 池的读数；`feature` 不存在 ⇒ 抛（★ 不静默返回空池 —— "读不到"不许读成"没有卡"）
 */
export function listPool(feature: string): BoardView {
  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(
      `feature "${feature}" 不存在 ⇒ 读不到池。\n` +
        `★ 这里**故意不返回空池**：空池会被读成"没有卡"，而真相是"没有这个 feature"。`,
    );
  }

  const byState: Record<TaskState, number> = { candidate: 0, claimed: 0, done: 0, void: 0 };
  let total = 0;
  for (const node of dsl.geometry?.nodes ?? []) {
    const state = node.task?.state;
    // ★ 没有卡（无 task）不计入池 —— 池是"卡"的集合，不是"节点"的集合
    if (!state || !ALL_STATES.includes(state)) continue;
    byState[state]++;
    total++;
  }

  const folded = byState.done + byState.void;
  return { byState, total, shown: total - folded, folded };
}
