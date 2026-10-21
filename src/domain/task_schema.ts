/**
 * task_schema.ts —— **任务格**（挂在设计侧节点上的任务对象）的形状。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的节点 `file_src_domain_task_schema_ts`
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
 *    ★ 这条不是口号：`.agent-io/design/task-system-plan.dsl.json` 的 `invariant_checks` 里有一条
 *      机器可跑的检查专门钉它（`red_when: task 格落了快照、复制了事实`）。
 * 3. **`evidence` 不是 `ProgressEvidence` 原样** —— 后者是「三档证据」（`overlay.ts`，
 *    含 `reading.observed` 这类**读数**）；本格只留 `{kind, at, by, verdict}` 四键，
 *    ★ **读数永远现算**（见 `TaskEvidenceRecord`）。
 */
import { createHash } from 'node:crypto';
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
 * ★ 五态与 `.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.state_machine.states` **逐字一致**；
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
  /**
   * ★★★ 2026-10-21：**代码指纹** —— 这份证据「**还作数吗**」的机器判据（形状见 `TaskEvidenceFingerprint`）。
   * ★ 缺省 / `null` = **历史证据**（指纹上线之前落的那些）⇒ 读端一律判 `unverifiable`，
   *   ★ **不回填**：回填等于替历史编一个"当时那份代码长什么样"，那是假读数。
   */
  fingerprint?: TaskEvidenceFingerprint | null;
}

/**
 * 收不进代码指纹的文件占位 —— 文件的**出现 / 消失**也必须让指纹变
 * （否则"被覆盖的文件被删了"会伪装成"没变过"，正是本仓最反对的假绿灯）。
 */
export const ABSENT_FILE_HASH = '<absent>';

/**
 * 证据的**代码指纹**（2026-10-21）—— 「增量测试」的地基。
 *
 * ## 一句话语义
 * `code` 没变 ⇒ 这份证据**仍有效** ⇒ **不重跑**；`code` 变了 ⇒ **自动失效** ⇒ 只重跑这一处。
 * ★ 形状**照抄本仓已验证过的先例**（`index_integrity`：索引 schema v12 ≠ 当前 v13 ⇒ 判「不可信」⇒ 需重建）——
 *   都是"拿当时记下的指纹 / 此刻现算的指纹"比一次，**不另设计一套判据**。
 *
 * ## 为什么它不是"复制事实"（与文件头铁律 2 的边界）
 * 铁律 2 禁的是**能由 `cache.db` 现算的当前值**（`line` / `loc` / 当前 `hash`）。
 * 而指纹记的是**那一刻**的代码长什么样 —— `cache.db` 只存"此刻"，**永远算不出"当时"**
 * ⇒ 它是**事件**（与同一条记录里的 `at` 同族），不是事实的副本。
 *
 * ## 四件（用户 2026-10-21 裁定的形状）
 * | 要的 | 落在哪 |
 * |---|---|
 * | 跑的是什么 | `what` |
 * | 输入指纹 | `input`（判据集合的规范化指纹：**判据一变，这条判定就不再对应眼前的判据**）|
 * | 输出 | 顶层 `verdict` —— ★ **不在这里再抄一份**（一事实两处 = 本仓头号病）|
 * | 代码指纹 | `code` ＋ `covers`（**算在哪些文件上**必须一起落，否则读端无从复算）|
 */
export interface TaskEvidenceFingerprint {
  /** 跑的是什么（命令原文 / `judgeExpectations:<node_id>` / `attestation:<by>`） */
  what: string;
  /** 输入指纹：**判据集合**的规范化指纹 */
  input?: string;
  /** 代码指纹：`covers` 这批文件的内容哈希聚合（sha1） */
  code?: string;
  /**
   * 指纹算在**哪些文件**上（仓库相对路径，已排序）。
   * ★ 空 / 缺省 = **覆盖集未知** ⇒ 该证据**不可判有效**（见 `evidenceFreshness`）。
   * ★ 不许用"全仓指纹"顶替：那会让"改任何文件都失效" = 没有增量效果。
   */
  covers?: string[];
}

/**
 * 内容指纹（sha1）。
 * ★ 只回答"两串东西一样吗"；**文件哈希语义的唯一住处**仍是 `index/symbols.ts#contentHash`
 *   （索引 / 写闸 / 对拍都用那一把）—— 这里不重定义"什么算文件变了"，只做聚合。
 */
export function fingerprintOf(parts: readonly string[]): string {
  return createHash('sha1').update(parts.join('\u0000'), 'utf-8').digest('hex');
}

/**
 * 把一组「文件 → 内容哈希」聚成一个代码指纹。
 * ★ 先**按路径排序**再聚合：同一批文件换个遍历顺序不得换指纹（否则假失效 = 白白重跑）。
 */
export function codeFingerprintOf(
  entries: ReadonlyArray<{ path: string; hash: string }>,
): { code: string; covers: string[] } {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const covers = sorted.map((e) => e.path);
  return { code: fingerprintOf(sorted.map((e) => `${e.path}:${e.hash}`)), covers };
}

/** 一条证据相对"此刻的代码"的处境（★ 唯一判据见 `evidenceFreshness`） */
export type EvidenceFreshness = 'valid' | 'stale' | 'unverifiable';

/**
 * 这条证据**相对此刻**还作数吗 —— ★ 唯一判据（别处不许再写一套比较）。
 *
 * | 结论 | 含义 | 该做什么 |
 * |---|---|---|
 * | `valid` | 输入指纹与代码指纹都相同 | **不重跑** |
 * | `stale` | 判据换了 / 代码动过 / 覆盖集变了 | **只重跑这一处** |
 * | `unverifiable` | 没有指纹（历史证据）或覆盖集算不出来 | 要读数就重跑；★ **不许**当"有效"用 |
 *
 * ## 为什么**两个**指纹都要比（少比一个就有一类假有效）
 * · 只比代码：`publish` 原地换判据后，文件一个字节没动 ⇒ 旧证据（在**旧判据**下全绿）
 *   会被判"有效" ⇒ 新判据**一次都没跑过**却看着有证据。
 * · 只比判据：判据没换但文件改了 ⇒ 那条"全绿"是新代码之前的读数。
 * ⇒ 两个都要，任一不同即 `stale`。
 *
 * ★ `unverifiable` 必须与 `stale` **分开**：前者是"当年没记"，后者是"记了、但已不同"。
 *   合并会让"没指纹的老证据"看起来像"需要重跑的坏证据"；更糟的是它会让"覆盖集未知"
 *   静默变成"通过"（= 增量测试里最典型的假绿灯）。
 *
 * @param current 此刻现算的输入指纹与代码指纹（`covers` 必须与记录里的**同一批文件**，否则判 `stale`）
 */
export function evidenceFreshness(
  rec: Pick<TaskEvidenceRecord, 'fingerprint'>,
  current: { code: string; covers: readonly string[]; input?: string } | null | undefined,
): EvidenceFreshness {
  const fp = rec.fingerprint;
  if (!fp || !fp.code || !fp.covers?.length) return 'unverifiable';
  if (!current || !current.code) return 'unverifiable';
  // ① 判据换了 ⇒ 这条判定不再对应眼前的判据（哪怕代码一个字节没动）
  if (current.input !== undefined && fp.input !== undefined && current.input !== fp.input) return 'stale';
  // ② 覆盖集变了 ⇒ 两边比的对不是同一批文件，比出来的"相同"没有意义
  const sameSet =
    current.covers.length === fp.covers.length && fp.covers.every((p, i) => p === current.covers[i]);
  if (!sameSet) return 'stale';
  return current.code === fp.code ? 'valid' : 'stale';
}

/**
 * **任务格**（`design/<f>.dsl.json` 的 `geometry.nodes[].task`）的结构。
 *
 * ★ `id` = `node_id`（任务与它挂在的节点**同一个 id**，不另立第二套 id 体系）。
 * ★ `expectations` 是**六类可判期望**（`domain/expectation.ts`），这里只是**引用**——
 *   判定器住 `application/design/intent/expectations.ts#judgeExpectations`（唯一一把尺）。
 */
/**
 * **一条内容修订**（`TaskSpec.history[]` 的元素）—— `todo.update` 的旧值栈。
 *
 * ★ 为什么是 `{from, to}` 而不是「存一份旧的 TaskSpec 全文」（`DecisionHistoryEntry` 存的是旧决策全文）：
 *   任务卡**可改的内容只有 `summary`** 一句人话（判据 `expectations` 由 `publish` 从 decision 翻来，
 *   不从 `todo.update` 改）⇒ 存全文是**多余**，而且会让人以为「判据也变过」。
 *   ★ 但 `from` / `to` 必须**逐字**（不是「改了什么」的描述）—— 那是能被对拍的事实。
 */
export interface TaskHistoryEntry {
  /** 改动时刻（ISO 8601） */
  at: string;
  /** 改前的 `summary`（逐字） */
  from: string;
  /** 改后的 `summary`（逐字） */
  to: string;
  /** 为什么改（**必填** —— 无理由地改判据就是「悄悄改判据」，那是本仓最恨的静默） */
  reason: string;
  /** 谁改的（agent 名；缺省 ⇒ 未署名 —— 工具不伪造，同 `TaskEvidenceRecord.agent`） */
  by?: string;
}

/**
 * ★★★ **卡上的读集**（2026-10-21 · 并发控制·读集比对）—— 这张卡**这一次**要碰什么。
 *
 * ## 它回答的问题（与 `assumption_check` 是**两个**问题，别合并）
 * | 时机 | 问题 | 强度 | 字段 |
 * |---|---|---|---|
 * | `claim`（还没开工） | **我要碰的东西，是不是已经被别的卡占了？** | **阻塞**（拒领） | `read_set` + 回执 `claim_conflict` |
 * | 写前（已经干了一半） | 我**读**的东西，是不是在这之后变了？ | **只报**（照常落盘） | `read_set.ts` 的 `assumption_check` |
 *
 * ★ 两种强度不是风格差异，是**成本不对称**：领卡时拒了没损失（换个卡/等一等）；写前拦住会丢掉
 *   已经做完的那一半。⇒ 判据各住一处，**不许**把两者合成一个“冲突检查”。
 *
 * ## ★★★ 为什么【覆盖】，不是压栈（这一点写在这里，因为它约束的是存储语义）
 * 用户 2026-10-21 原话：「**读集只取最后一次**，就像我们的角色卡的 history 一样」——
 * 而 `TaskSpec.history` 是**压栈**（那是“同一句话被改过几次”的账）。两者的差别不是笔误：
 *   · 读集回答的是「**这张卡现在要碰什么**」⇒ 天然是**最新值**；
 *   · 若 append，它回答的就变成「**这张卡历史上碰过什么**」⇒ 两件不同的事被塞进同一个字段：
 *     ① 一张改过三轮的卡会永远占着第一轮碰过、后来根本不再碰的符号（幽灵占位 ⇒ 误拒别人）；
 *     ② 体积随领取次数单调增长（下面有读数）；③ 释放再领（`release → claim`）会变成 `A∪B`，
 *     而它的语义应当是「**这一轮**占的就是 B」。
 *   ⇒ 唯一写时机 = **claim**；写法 = **整体替换**。`release` **不清**它（它仍是“最后一次领的时候
 *     占过什么”这个事实），但比对**只读 `state==='claimed'`** 的卡 ⇒ 释放即不再占位。
 *
 * ## 为什么允许把指纹落在卡上（与文件头铁律 1 的边界）
 * 铁律 1 禁的是**能由 `cache.db` 现算的当前值**（`line` / `loc` / 当前 `hash`）。
 * 这里落的 `fp` / `content_hash` 是**那一刻**的样子 —— 索引只存“此刻”，**永远算不出“当时”**
 * ⇒ 它和 `TaskEvidenceRecord.fingerprint` 同族：是**事件**（“领这张卡时我认定的是这一版”），不是事实的副本。
 * ★ 读它的地方：冲突报文（两边同一符号但指纹不同 ⇒ 说明中间已经有改动落地了）。
 *
 * ## ★ 体积（实测读数，见本笔回执）
 * 一条符号 ≈ 80~110 字节（全量 40 位 sha1）；一张 23 条判据的卡 ≈ 1.8 KB。
 * ⇒ 上限 `MAX_CARD_SYMBOLS=200` / `MAX_CARD_FILES=100`（`application/claim_conflict.ts`）：
 *   超限**拒 claim 并让人缩小声明或拆卡**，不静默截断 —— 截断的读集 = 漏掉的冲突。
 */
export interface TaskReadSetSymbol {
  /** 仓库相对 posix 路径（索引键口径） */
  file: string;
  /** `qualified_name` 优先；调用方显式声明时也可给短名 */
  name: string;
  /** `sym_hash`（全量 sha1）；`''` = 此刻还不存在（这张卡要**新建**它） */
  fp: string;
}

/** 读集里的一个文件（`content_hash`：`''` = 此刻还不存在） */
export interface TaskReadSetFile {
  path: string;
  /** `contentHash`（全量 sha1）；`''` = 文件此刻还不存在 */
  content_hash: string;
}

/**
 * 读集的**判据出处**（★ 落盘，别让读端猜“这个读集可信吗”）。
 * · `declared`   = 调用方在 claim 时显式声明的（最准：它就是要干活的那个人）；
 * · `expectations` = 从卡上判据里点名的 `symbol-exists` / `signature-matches` / `call-exists`（机械可算）；
 * · `node-path` = 节点自己的文件（最粗的兜底，只有到文件级）。
 * ★ 优先序 = 上面这个顺序；可以**同时存在**（显式声明为主，其余补齐）。
 */
export type TaskReadSetBasis = 'declared' | 'expectations' | 'node-path';

/** 一张卡**上一次 claim** 时算出的读集（形状与语义见 `TaskReadSetSymbol` 上方那段） */
export interface TaskReadSet {
  symbols: TaskReadSetSymbol[];
  files: TaskReadSetFile[];
  /** 算的时刻（ISO 8601） */
  computed_at: string;
  /** 判据出处（见 {@link TaskReadSetBasis}）—— 读端据此判断这份占位有多可信 */
  basis: TaskReadSetBasis[];
  /** 退化/截断说明（没有索引、符号此刻不存在、L1 卡且节点没有路径 …）—— **不许静默** */
  note?: string;
}

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
  /**
   * ★★★ **跑环继任链**（2026-10-21）：这张 todo 的**上一环**是哪张 todo（`todos[]` 里另一张卡的 id）。
   *
   * ## 它是什么（用户原话）
   * 「有些任务要不要设计成**跑环任务**？完成一环、完成二环、完成三环……做完了之后发现还有新的，
   *   那就**直接再在这个下面登记第二步、第三步**」
   * ⇒ `follows` 指向**父 todo 的 id**，形成 `一环 → 二环 → 三环` 的一条链。
   *
   * ## 为什么是**单指针**（一条链，不是一棵树）
   * 「上一环」必须唯一 —— 否则「第几环」会有两个答案（一团浆糊）。单指针下每个环最多一个爹，
   * `depth` 沿父指针一数就是答案（`domain/todo_chain.ts#buildTodoChains`，现算、不落盘）。
   * ★ **但允许一个父有多个子环**（"做完一环发现两个新问题"是常态）：那不会让环次含糊，
   *   只会产生支线；展示时**主链 = 每一环取册上最早登记的那个子环**（同一处定义）。
   *
   * ## 约束（写端唯一判据 = `domain/todo_chain.ts#assertFollowsTarget`）
   * · 指向的 id **必须在本 feature 的 `todos[]` 里**（悬挂 ⇒ 拒）；
   * · **不能自指**、**不能接在作废（void）的卡下面**、**不能成环**；
   * · ★ 链**必须无环**：环会让「第几环」永远算不出来（`docs/GUIDE-GATE.md §4.8` 留给自写门的，
   *   正是「图的**无环**」这一类编译器查不了的东西）。
   *
   * ## ★ 不级联作废
   * 上一环 `todo.retire`（→ `void`）后，**本环仍在册、仍然有效** —— 只在展示里标一句
   * 「上一环已作废」。自动级联会杀掉可能仍然有效的活（用户 2026-10-21 明确否掉）。
   * ★ 与 `done` 的差别：`done` 是正常走过的环，链照常往下走，不算断。
   *
   * ★ 只有 `todos[]` 的卡用它（`publish` 出来的节点任务不接链）；缺省 = 链根。
   */
  follows?: string;
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
  /**
   * ★★★ **改内容的旧值栈**（2026-10-21）：`todo.update` 每次改 `summary` 都把
   * 「旧值 → 新值 + 为什么改」压进来（栈底最老、栈顶最近）—— ★ **不是覆盖**。
   *
   * ## 为什么必须留旧值（用户 2026-10-21 原话）
   * 「不然的话，**以后有变化、或者说旧的怎么样新的怎么样，你怎么去做**？」
   * ⇒ 只留新值 = 判据被**悄悄改掉**，下一个接手的人看不出「这条 todo 原来要求什么」。
   *
   * ## 为什么住**卡上**（而不是单独的表 / cache.db）
   * · 它与「这张卡」**同生共死**：卡在册 ⇒ 历史在；卡被 `delete` 物理删 ⇒ 历史随卡进墓碑
   *   （`board/todo_journal.ts`）—— 不需要第二处对账。
   * · 本仓已有**同形先例**：`Node.decision_history`（`DecisionHistoryEntry[]`，压栈不覆盖）
   *   ⇒ 不发明第二套（同一个词：修订史 = 卡上的数组）。
   * · 文件头铁律 1「只落意图与事件」：修订是**事件**（带 at / 谁 / 为何），不是可现算的读数
   *   ⇒ 该落设计侧；`cache.db` 是**可重建的事实索引**，落那里等于让它被一次重建冲掉。
   *
   * ★ 老 DSL 里没有这个键 ⇒ 读端一律 `?? []`（**不许**要求它存在 —— 向后兼容是硬约束）。
   */
  history?: TaskHistoryEntry[];
  /**
   * ★★★ **为什么作废**（2026-10-21）：`todo.retire` 的必填理由 —— ★ 落在**卡上**，不只在回执里
   * （回执会丢；卡不会）。
   *
   * ## 语义（照 `design-principles` §6.7 的三步退役流，不发明第二套）
   * 文件那边是 `lifecycle = {status:"deprecated", retire_reason:"…"}`；这里同一个词、同一条纪律：
   * **作废 ≠ 删掉** —— 「这条曾经有效，被新的取代了」⇒ 卡**留在册里**（可考古），只是不再出现在待办里。
   * ★ 与 `delete` 的分界（写在这里，也渲染进 `edit_dsl` 描述）：
   *   `retire` = 曾经有效、被取代（历史有价值）· `delete` = 从未生效、纯粹误建（历史无价值，物理删 + 墓碑）。
   *
   * ## 与 `state` 的关系（★ 别误会成第 5 个状态）
   * `retire` 把 `state` 置 **`void`**（复用既有终态），**不新造状态**：设计册
   * `task_plan.state_machine.states` 是那四个值的副本，加一个态就得同步改它，而 `task_plan`
   * **没有 `edit_dsl` 写入口**（`TYPE_KNOWN_KEYS` 里没有它）⇒ 只能手改设计册 = 绕过唯一写端。
   * ⇒ 判据：`state==='void'` ∧ 有 `retire_reason` = **被取代**作废（区别于 t_void 的「target 消失」）。
   */
  retire_reason?: string;
  /** 作废时刻（ISO 8601）；与 `retire_reason` 同生共死（三问「谁/何时/为何」同住一处，照 `released_at`） */
  retired_at?: string | null;
  /** 谁作废的（agent 名；缺省 ⇒ 未署名 —— 工具不伪造，同 `released_by`） */
  retired_by?: string | null;
  /** ★ 证据记录（只落 `{kind, at, by, verdict}`，不落读数） */
  evidence?: TaskEvidenceRecord[];
  /** 讨论登记格（默认只渲染 `micro`） */
  discussion?: TaskDiscussion;
  /**
   * ★★★ **上一次 `claim` 时算出的读集**（形状/语义/为什么不累积见 {@link TaskReadSet} 上方那段）。
   *
   * · 唯一写时机 = `claim`（**整体覆盖**）⇒ 它回答「这张卡**这一轮**要碰什么」；
   * · 读它判定占位的场合只有一个：**别的卡 claim 时**拿它与自己的读集比交 —— 相交即**拒领**；
   * · `release` **不清**它：它仍是“最后一次领的时候占过什么”这个事实；但比对只读 `state==='claimed'`
   *   ⇒ 释放后**不再占位**（下一次 claim 重算并覆盖）。
   * ★ 缺省（老卡）= 没有读集 ⇒ 冲突检测把它记为“**没比**”（回执里 `claim_conflict.unchecked` 点名），
   *   不假装它“不冲突”。
   */
  read_set?: TaskReadSet;
}

/**
 * ★★★ **任务卡的两级：L1 建构卡 / L2 实现卡**（2026-10-17 · `.agent-io/design/task-system-plan.dsl.json`
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
