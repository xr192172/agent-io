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
import type { ProgressEvidence } from './overlay.js';

/**
 * 五态（★ 要**显式类型**，不许散落字符串）。
 *
 * | 态 | 含义 |
 * |---|---|
 * | `candidate` | 候选（还没人领） |
 * | `claimed` | 已领（有 owner + claimed_at） |
 * | `done` | 已完成 |
 * | `void` | 失效（target 在 DB 已查不到 —— ★ 与 `done` 是**两种不同结局**） |
 * | `superseded` | 被取代（新卡带 `replaces`） |
 *
 * ★ 五态与 `docs/task-system-plan.dsl.json` 的 `task_plan.state_machine.states` **逐字一致**；
 *   这里是**唯一住处**，别处不许再抄一份字面量。
 */
export const TASK_STATES = ['candidate', 'claimed', 'done', 'void', 'superseded'] as const;

/** 五态中某一态。 */
export type TaskState = (typeof TASK_STATES)[number];

/** 终态（迁移表里 `terminal_states` 的同一批，★ 只此一处）。 */
export const TERMINAL_TASK_STATES = ['done', 'void', 'superseded'] as const;

/**
 * 运行期形状守卫：`unknown` ⇒ `TaskState`。
 * ★ 为什么需要它（不是形式主义）：任务格会被**读回**（JSON 反序列化 / 设计 DSL 落盘再读），
 *   那时值的静态类型已经**不再有保证** ⇒ 需要一个"此刻这个字符串是不是五态之一"的**真判据**。
 */
export function isTaskState(v: unknown): v is TaskState {
  return typeof v === 'string' && (TASK_STATES as readonly string[]).includes(v);
}

/** 是不是终态（终态不再迁移 —— 见 `task_machine.TRANSITIONS`）。 */
export function isTerminalTaskState(s: TaskState): boolean {
  switch (s) {
    case 'done':
    case 'void':
    case 'superseded':
      return true;
    default:
      return false;
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
  /** ★ 谁领的（CAS 写；未领 ⇒ `null` / 缺省） */
  owner?: string | null;
  /** ★ 何时领的（ISO 8601；TTL 回收要靠它 —— 没有它 `releaseIfExpired` 判不了） */
  claimed_at?: string | null;
  /** 释放 / 失效原因（可选） */
  release_reason?: string;
  /** ★ 取代了哪张卡（新卡带 `replaces: <old_id>` ⇒ 旧卡转 `superseded`） */
  replaces?: string;
  /** ★ 证据记录（只落 `{kind, at, by, verdict}`，不落读数） */
  evidence?: TaskEvidenceRecord[];
  /** 讨论登记格（默认只渲染 `micro`） */
  discussion?: TaskDiscussion;
}
