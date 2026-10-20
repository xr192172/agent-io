/**
 * task_schema.ts —— **任务格**（挂在设计侧节点上的任务对象）的形状。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的节点 `file_src_domain_task_schema_ts`
 * （其 `decision.expectations` 要求本文件存在，且含 `TaskState` / `TaskSpec` 两个符号）。
 *
 * ## 它是什么（一句话）
 * **任务 = 意图 ⇒ 住设计侧**（住 `design/<f>.dsl.json` 的节点上，**不挂 overlay**）。
 * 本文件只管**形状**（类型 + 常量 + 形状守卫），不含任何判定逻辑 ——
 * 判定住 `task_machine.ts`（状态机），事实住 `cache.db`（索引）。
 *
 * ## ★★ 铁律（写在这里，因为它约束的是**字段集**，而字段集就长在本文件里）
 * 1. **只落"意图与事件"，不落读数快照、不落校验结果** ——
 *    `state` / `owner` / `claimed_at` 是**事件**，DB 算不出来 ⇒ 可落盘；
 *    而"checked=6 passed=3"这类**对拍读数**必陈旧 ⇒ **不许**进这里。
 * 2. **设计侧不复制事实** —— 任何能由 `cache.db` 现算的字段（`line` / `loc` / `hash` /
 *    `reads` / `call_count`）**一律不许出现**在本文件导出的形状里。
 *    ★ 这条不是口号：`docs/task-system-plan.dsl.json` 的 `invariant_checks` 里有一条
 *      机器可跑的检查专门钉它（`red_when: task 格落了快照、复制了事实`）。
 * 3. **`evidence` 不是 `ProgressEvidence` 原样** —— 后者是「三档证据」（`overlay.ts`，
 *    含 `reading.observed` 这类**读数**）；本格只留 `{kind, at, by, verdict}` 四键，
 *    ★ **读数永远现算**（见 `TaskEvidenceRecord`）。
 */
import type { Expectation } from './expectation.js';
import { postExpectations } from './expectation.js';
import type { ProgressEvidence } from './overlay.js';
import type { DiagramStatus } from './geometry.js';

/**
 * 五态（★ 要**显式类型**，不许散落字符串）。
 *
 * | 态 | 含义 |
 * |---|---|
 * | `candidate` | 候选（还没人领） |
 * | `claimed` | 已领（有 owner + claimed_at） |
 * | `done` | 已完成 |
 * | `void` | 失效（target 在 DB 已查不到 —— ★ 与 `done` 是**两种不同结局**） |
 *
 * ★ 五态与 `docs/task-system-plan.dsl.json` 的 `task_plan.state_machine.states` **逐字一致**；
 *   这里是**唯一住处**，别处不许再抄一份字面量。
 */
export const TASK_STATES = ['candidate', 'claimed', 'done', 'void'] as const;

/** 四态中某一态。 */
export type TaskState = (typeof TASK_STATES)[number];

/**
 * **已了结**的状态（★ 只此一处；`isClosedTaskState` 是它的唯一读法）。
 *
 * ★★★ 2026-10-20 改名（dogfood #20；同时新增 `t_relaunch`）：
 *   原名叫 `TERMINAL_TASK_STATES = ['void']`，而 `isTerminalTaskState` 判的是 `done | void`
 *   —— **同一个概念两个答案**（C2：终态集合有两个家）。
 *   ★ 想"把字面量对齐成 done|void"是错的方向：那天加了 `t_relaunch`（void → candidate），
 *     `done` 又早有 `t_reopen`（done → claimed）⇒ **本仓已经没有"终态"这回事**
 *     （每个状态都有可用出边）。
 *   ⇒ 真正被消费的那个概念是「**这张卡还开着吗 / 还要不要巡**」——
 *     消费点只有 patrol（`task_drift.ts`：已了结的卡不判、不报 missed_close）。
 *   ⇒ 名字改成 `CLOSED`：`done` / `void` 是**两种结局**，都能被重开/重生，但都**不再是活**。
 */
export const CLOSED_TASK_STATES = ['done', 'void'] as const;

/**
 * 运行期形状守卫：`unknown` ⇒ `TaskState`。
 * ★ 为什么需要它（不是形式主义）：任务格会被**读回**（JSON 反序列化 / 设计 DSL 落盘再读），
 *   那时值的静态类型已经**不再有保证** ⇒ 需要一个"此刻这个字符串是不是五态之一"的**真判据**。
 */
export function isTaskState(v: unknown): v is TaskState {
  return typeof v === 'string' && (TASK_STATES as readonly string[]).includes(v);
}

/**
 * 这张卡**已了结**吗（= `state` 落在 `CLOSED_TASK_STATES` 里）。
 *
 * ★ 判据**只读那个常量**（不在这里再写一遍 `done`/`void` 字面量 —— 那就是 C2 的原病）。
 * ★ 注意它**不**等于"不能迁移"：`done` 能 `t_reopen`、`void` 能 `t_relaunch`。
 *   它回答的是巡航问题："这张卡还要不要判 / 要不要报 missed_close"。
 */
export function isClosedTaskState(s: TaskState): boolean {
  return (CLOSED_TASK_STATES as readonly TaskState[]).includes(s);
}

/**
 * ★★★ **两轴消歧的唯一映射**（2026-10-17 · `task_plan.task_home.axis_dedup`）：
 * 任务态（五值）⇒ 进度（三值 `DiagramStatus`）的**派生值**。
 *
 * ## 为什么是派生，而不是落盘
 * 收归前：`progress`（三轴）与 `task.state`（五轴）**并存且无映射** ⇒ 同一件事两处权威。
 * 裁定：**单一权威 = `task.state`**；`progress` **读时现算**（本函数），**不再落盘**。
 * ★ 若把它做成"写 task 时顺手写一份 progress"⇒ 就是**用新补丁换旧补丁**（本仓 2026-10-16 已裁过）。
 *
 * ## 映射表（逐字照设计 DSL；★ 缺一不可）
 * | state | progress |
 * |---|---|
 * | `candidate` | `draft` |
 * | `claimed` | `in_progress` |
 * | `done` | `done` |
 * | `void` | **`undefined`**（不映射进三轴） |
 *
 * ★★★ `void`（以及已退场的 `superseded`）**不许硬塞一个值**（如塞 `draft`）—— 那会让"失效"看起来像"还没开始"，
 *   是**新的补丁**。⇒ 返回 `undefined`，由读端如实呈现"这一轴没有值"。
 */
export function progressOf(task: Pick<TaskSpec, 'state'> | null | undefined): DiagramStatus | undefined {
  if (!task) return undefined;
  // ★ 运行期守卫：state 从 JSON 读回时静态类型不再有保证 ⇒ 认不出的态一律"无值"（不猜）
  if (!isTaskState(task.state)) return undefined;
  switch (task.state) {
    case 'candidate':
      return 'draft';
    case 'claimed':
      return 'in_progress';
    case 'done':
      return 'done';
    case 'void':
      return undefined;
  }
}

/** 讨论登记格（★ "不直接展示"的机制：默认只渲染 `micro` 一行 + `open.length`）。 */
export interface TaskDiscussion {
  /** 微缩：10 秒可读的一行（★ 默认只渲染这个） */
  micro: string;
  /** 用户设想（逐字原话；★ 展开时才渲染） */
  user_quote?: string;
  /** 整理结果 + 出处 */
  conclusion?: string;
  /** 未定 / 待拍 */
  open?: string[];
  /** ★ 定下来的时间（评审补） */
  decided_at?: string;
  /** ★ 推翻了哪一条讨论（版本链；评审补） */
  supersedes?: string;
}

/**
 * 证据记录 —— ★ **不是** `ProgressEvidence` 原样（见文件头铁律 3）。
 *
 * 落盘只允许这四键：`kind`（复用既有三档枚举，不新造第四档）· `at`（何时）·
 * `by`（谁，仅口供有）· `verdict`（那次判定的结论）。
 * ★ **不落 `observed` / 不落 `passed` / `failed` 计数** —— 那是**读数快照**，必陈旧。
 */
export interface TaskEvidenceRecord {
  /** ★ 复用 `ProgressEvidence` 的三档枚举（`expectations` / `reading` / `attestation`），不另立一套 */
  kind: ProgressEvidence['kind'];
  at: string;
  by?: 'human' | 'llm';
  /**
   * ★ 2026-10-20（OQ1 的另一半）：**具体是谁宣布的**（agent 名，如 `workbuddy`）。
   *
   * `by` 只分"人/机器"两档 ⇒ 记不下"哪一个"。而 OQ1 裁定「显式收口」的核心是
   * **状态变化要有主体宣布** —— 主体不记名字，"显式"和"自动"就没有区别了。
   */
  agent?: string;
  /** 那次判定的结论（★ 结论可落，"读数"不落） */
  verdict: 'pass' | 'fail' | 'unsupported';
}

/**
 * **任务格**（`design/<f>.dsl.json` 的 `geometry.nodes[].task`）的结构。
 *
 * ★ `id` = `node_id`（任务与它挂在的节点**同一个 id**，不另立第二套 id 体系）。
 * ★ `expectations` 是**六类可判期望**（`domain/expectation.ts`），这里只是**引用**——
 *   判定器住 `application/design/intent/expectations.ts#judgeExpectations`（唯一一把尺）。
 */
export interface TaskSpec {
  /** 任务 id（= 它挂的那个节点的 id） */
  id: string;
  /** 要做什么（人读一句） */
  summary: string;
  /** 判据（六类，对着 DB 判） */
  expectations: Expectation[];
  /** 五态之一 */
  state: TaskState;
  /**
   * ★★★ **仅 todo 用**：这张预决策归哪个节点（`file_xxx`）。
   * ★ 语义（2026-10-18 用户校准）：**不是"建卡"，是"指向"** ——
   *   预决策只挂「决策 + 现象」；**落地人**看这个 node_id 去读那里的设计 DSL、**重新设计**，
   *   改完再 `publish` 挂载（建卡是 publish 的事）。
   * ★ 缺省 ⇒ 无节点任务（在 todos[] 里凭 attestation 完成）。
   */
  node_id?: string;
  /** ★ 谁领的（CAS 写；未领 ⇒ `null` / 缺省） */
  owner?: string | null;
  /** ★ 何时领的（ISO 8601；TTL 回收要靠它 —— 没有它 `releaseIfExpired` 判不了） */
  claimed_at?: string | null;
  /** 释放 / 失效原因（可选） */
  release_reason?: string;
  /**
   * ★ **谁释放的 / 何时释放的**（2026-10-17）—— 与 `release_reason` 同属**一个 release 事件**。
   * 为什么必须落：`t_release` 的 guard 逐字要求「显式 release 事件（**带 by + reason**）」——
   * 只有 `release_reason` 时，"谁放的"**没有落点**（回执里说完就没了）。★ 三问（谁/何时/为何）同住一处，
   * 不另建事件表（那是又一维；本笔只补这一维）。
   */
  released_by?: string | null;
  /** 释放时刻（ISO 8601；与 `released_by` 同生共死） */
  released_at?: string | null;
  /**
   * ★★★ **重开账本**（2026-10-20）：这张卡被 `reopen` 的时刻；**结清后置 `null`**。
   *
   * ## 它堵的是什么（白洞）
   * 收归前 `reopen` 只写 `{state:'claimed', owner, claimed_at}` —— **不改判据、不清 evidence**
   * ⇒ 旧判据仍然全绿 ⇒ **立刻 `complete` 就能再 done 一次，什么都没做**（0 工作量完成）。
   *
   * ## 语义（一句话）
   * `reopened_at != null` ⇔ **这笔重开还没结清**：自那以后判据没换过、也没有带时间的新证据
   * ⇒ `complete` 必须拒（"旧判据再跑一遍"不是新证据）。
   * 结清只有两条路：① `publish` 在 claimed 上**真的换了判据**（写盘时置 `null`）；
   * ② `complete` 带一条 `reading` / `attestation`，其 `at` **不早于** `reopened_at`。
   *
   * ## ★ 为什么是卡级事件字段，而不是给 expectation 加 `stale`
   * `Expectation` 是 decision 与 task **共用**的形状；往里加 `stale` 会让判定器必须"记得忽略它"
   * （= 又一处补丁），而清除者还要再定义一份。`reopened_at` 是**事件**，
   * 而 `expectations` 的唯一写端是 `publish` ⇒ 结清者天然唯一（不必第二处权威）。
   */
  reopened_at?: string | null;
  /**
   * ★★★ **重开时上一轮的 owner**（2026-10-20 · `done` 卡被下一轮接手）。
   *
   * `done` 卡的 `owner` 是**上一个干完的人**，不是「正在办的人」⇒ 重开必须**换手**
   * （否则 A7 会让新接手人写不了自己刚领的文件）。换手这件事要**留痕**：原 owner 记在这里。
   * ★ 它不是新状态：重开仍只走 `t_reopen`（done → claimed），本字段只回答「这一轮从谁手里接的」。
   */
  reopened_from?: string | null;
  /**
   * ★★★ **为什么重开**（2026-10-20）：与 `reopened_at` **同生共死**（一次重开 = 一个时刻 + 一个理由）。
   *
   * ★ 为什么必须落盘：`reopen` 原先只把理由放进**回执**（会丢），卡上查不到「上一轮为什么又开」——
   *   而 `done` 卡的 owner 是上一个人，「换手 + 为什么换手」如果只活在一行回执里，审计就断在这里。
   * ★ 与 `release_reason` 同族（那一个是「为什么放回去」）—— 两个事件、两个字段，不合并（时点不同）。
   */
  reopen_reason?: string | null;
  /**
   * ★ **未实现**（2026-10-18 标）：原设计是「新卡带 replaces ⇒ 旧卡转 superseded」，
   * 而 superseded 状态已于 2026-10-17 删除 ⇒ **本字段目前无状态可转、无读取方** ⇒ 死字段。
   * ★ 要复活它，先回答「取代后旧卡变成什么」（目前只有 done / void 两个终态）。
   */
  replaces?: string;
  /** ★ 证据记录（只落 `{kind, at, by, verdict}`，不落读数） */
  evidence?: TaskEvidenceRecord[];
  /** 讨论登记格（默认只渲染 `micro`） */
  discussion?: TaskDiscussion;
}

/**
 * ★★★ **任务卡的两级：L1 建构卡 / L2 实现卡**（2026-10-17 · `docs/task-system-plan.dsl.json`
 * 的 `task_plan.two_level_tasks` + `publish_rule.corrected`）。
 *
 * ## 语义（逐字来自设计 DSL）
 * · **L1 建构**：输入 = 一张很粗的决策卡（"我要实现 X"）；输出 = **可判的期望**；
 *   判据 = **DSL 建构完整**（★ **不是**代码跑通）；
 * · **L2 实现**：输入 = L1 产出的那条红；输出 = 代码；判据 = 对拍红变绿。
 *
 * ## ★★★ 为什么是**派生值**，不是落盘字段
 * "这张卡是 L1 还是 L2"**完全等价于**"它有没有可判的后态判据"——
 * 有 ⇒ 能按对拍判（L2）；没有 ⇒ 只能判"DSL 建起来了没有"（L1）。
 * ⇒ 若再落一个 `level` 字段，就会出现"level=L2 而 expectations 空"这种**两处权威**（本仓头号病）。
 * ★ 所以唯一判据住这里，调用方（publish / claim / complete）都读它，别各自写 `post.length > 0`。
 *
 * ★ 与设计 DSL 的对应：`publish_rule.corrected` 写着"无 decision / decision 太粗 ⇒ L1；
 *   已有**可判的** expectations ⇒ L2"——"太粗"的可判形态就是**没有后态判据**
 *   （全 `phase='pre'` 的卡按 `cardStanding` 必 `unknowable` ⇒ 翻成 L2 也**必然领不了**）。
 */
export function taskLevel(card: Pick<TaskSpec, 'expectations'>): 'L1' | 'L2' {
  return postExpectations(card.expectations ?? []).length > 0 ? 'L2' : 'L1';
}
