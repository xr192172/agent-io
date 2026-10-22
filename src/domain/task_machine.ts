/**
 * task_machine.ts —— 任务状态机：**状态迁移与可领性判定**。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的节点 `file_src_domain_task_machine_ts`
 * （`task_plan.state_machine` 的 `transitions` / `patrols` 是本文件的语义来源）。
 *
 * ## ★★ 前态判据（`phase='pre'`，如 `edge-absent`）由「期望自带」—— 本文件**不再有任何清单**
 * 「前态判据」= 在**未施工**时**天然成立**的判据（`edge-absent`："不许依赖 X" —— 还没写当然不依赖）。
 * ⇒ 若拿它们一起判"是否已满足"，**每一张刚出生的卡都会「全过」** ⇒
 *   ★ **任务还没领就被误收口**。所以判定前必须先**选取后态判据**（按期望自带的 `phase`）。
 *
 * ★★★ 2026-10-16（T10）：**这一段原先是一处补丁**——
 *   本文件曾自带一份清单 `NEGATIVE_KINDS = ['edge-absent']` + `positiveExpectations()`（"判定前记得剔除"）。
 *   ★ 判据（2026-10-16 用户「不打补丁，收归原生结构」原话；原文随 54 份老文档清理删除、未进 `docs/DESIGN.md`，
 *     故结论就地留在这里，不再指向任何文档路径）：
 *     「**不要打补丁，而是直接重写**……**有补丁说明你原来的设计有问题**，那你就**重新连同这个补丁一起重新去设计
 *      这个东西**。**补丁只是一个兜底性的东西**……**你以后改的话可能会漏看这个补丁**，但是你把它**重新结构写进去了，
 *      你会得到一个更好、更优、更优雅的一个项目**。」
 *   ★ 按它判，下面这三点它都占：① 别处要**记得**剔；② 同类问题再来一次要**再加一条**；③ 需注释解释缘由。
 *   ⇒ 已**收归进原生结构**：`Expectation` 现在**自带 `phase` 维度**
 *     （`domain/expectation.ts#expectationPhase` / `#postExpectations`）——
 *     **分类由 phase 决定**，本文件里"前态判据"这件事**已从 phase 派生**（不再有自己的清单）。
 * ★ 残留（如实报）：`cardStanding` 仍要**选取**后态判据（`postExpectations`）才能算满足度 —— ★ 这一步**删不掉**：
 *   前态判据本身也可能判成 `unsupported`（依赖事实取不到），若把它们并进后态报告会**改变 satisfied 的结论**。
 *   ⇒ 收归改变的是"它**怎么被认出来**"（由期望自带的 phase），不是"要不要选"。
 *   ★ 但 `unsupported` 的**处置**已经分开：前态判不了 ⇒ `violated` 轴判不了（`unknowable`），
 *     而不是像收归前那样"整张卡的 ok 被前态的 unsupported 拉红"。
 *
 * ## ★★ 两把尺 ⇒ 一个读数 + 两个谓词（2026-10-17 · 讨论 2 / P30）
 * 收归前 `canClaim` 被 `claim` 与 `complete` **同一个函数**共用（`task_ops.ts` 两处）⇒
 * 一处判据两用：要么"没活干也能领"，要么"有红也能收口"，二者必居其一。
 * ⇒ 现在：`cardStanding` 出**五值**，`isClaimable` 与 `isSatisfied` 各读一侧。
 *
 * ## 判定器复用（★ 不新造第二把尺；★★ 也不向上 import）
 * 判据的判定一律走**注入的** `Judge`（端口 = `domain/judge_port.ts`；实现 = `application/design/intent/expectations.ts#judgeExpectations`）——
 * 它已经会区分 `pass / fail / unsupported / pending`，且 `unsupported` **不算通过**。
 * ★★★ 2026-10-21（D-judge-port）：本文件**曾经**直接 `import judgeExpectations` —— 那是全仓唯一一条
 *   `domain → application`（向上）依赖。约束「domain 不许 import infrastructure」被满足了，「**不许向上**」被违反了
 *   ⇒ **规则满足一半 = 没满足**。现在判定器是一个**端口**（`StandingInput.judge` 必填注入），
 *   本文件的 import 全在同层 ⇒ 那条倒挂从「本该记得别写」变成「写不出来」。
 * 本文件**只**做四件事：① 按 phase 分区 ② 编排判定 ③ 派生五值 ④ 出迁移判据 / 租约回收。
 *
 * ## 迁移表（★ 逐条照设计 DSL）
 * 见 {@link TRANSITIONS}。★ 2026-10-20：`candidate → done`（`t_done_from_candidate`）已按 OQ1
 * 裁定实现为「主体显式收口」；同一天新增 `t_relaunch`（`void → candidate`，重新立卡）。
 * ★ 因此**没有真正的终态**了：`done` 能 `t_reopen`、`void` 能 `t_relaunch`。
 *   "这个状态还开着吗"由 `task_schema.ts#isClosedTaskState` 回答（done / void 已了结，不再巡）。
 *
 * ★★★ 2026-10-22（三条出口的语义写死，判据在 `TRANSITIONS.t_void` 的 clauses 里）：
 *   · `done`    = **干完了**（收口：`t_done_from_claimed` / `t_done_from_candidate`，要 isSatisfied + 证据）；
 *   · `release` = **放回去**（`claimed → candidate`：活还在，别人还能领）；
 *   · `void`    = **不做了**（弃做：`candidate → void`，理由必填）。
 *   ⇒ ★ **不许用 `void` 收尾**：它既不是"完成"，也不是"关掉这张卡"的快捷方式 ——
 *     「已完成」只能由 done 表达，「暂时不做」用 release，「永远不做」才是 void。
 */
// ★★★ 2026-10-21（D-judge-port）：**不再 import application** —— 判定器收成端口（`./judge_port.js`），
//   由调用方注入。本文件现在的 import 全在同层：`./expectation.js` / `./judge_port.js` / `./task_schema.js`。
import { type ExpectationsReport, type Judge } from './judge_port.js';
import { expectationPhase, expectationSubjectPath, normPath, postExpectations, type Expectation } from './expectation.js';
import { isTaskState, type TaskSpec, type TaskState } from './task_schema.js';

/**
 * ★★★ 一张卡的**五值读数**（讨论 2 · `P30` 的裁决 —— 裁决已落进设计侧，不必回讨论稿：
 * `.agent-io/design/task-system-plan.dsl.json` 的节点 `file_src_domain_task_machine_ts` ·
 * `decision.expectations` 里 `cardStanding` / `isSatisfied` 那两条 `why` 就是裁决原文）。
 *
 * ★ P30 的【为什么】（原文摘句；讨论稿本身已不在盘上，原文出处 = commit e3fb5d2c）：
 *   `complete` 调的**就是** `canClaim`；只改一处会把收口闸放行红卡（比现状更坏）
 *   ⇒ 必须拆成「**一个读数** + **两个谓词**」，而不是"两把同形的尺"。
 *
 * ## 它收归的是什么（铁律 3：补丁 ⇒ 结构）
 * 收归前，"这张卡现在能干什么"被**四处各判一次**：
 *   ① `canClaim` 的 `unsupported > 0`；② 同一函数的 `failed > 0`；
 *   ③ `complete` 调**同一个** `canClaim`（`task_ops.ts` 两处共用一把尺）；
 *   ④ 前态判据（`edge-absent`）**没有任何一处判**（`task_machine.ts` 只取 post）。
 * ⇒ 缺的那一维是：**「这张卡此刻处在哪种处境」没有一个具名读数** ——
 *   于是"接取闸"与"收口闸"只能共用一条布尔，必然一处判两用。
 * ⇒ 收归成**一个读数**（本函数）+ **两个谓词**（`isClaimable` / `isSatisfied`）：
 *   谁要用哪一侧，就调哪个谓词；**五值的语义只在这里派生一次**。
 *
 * ## 语义（逐条按裁决，不许在调用处再解释一遍）
 *   · `work`      —— 后态判据有红，且红里有**本节点**的（或不对应任何节点）⇒ ★ 可领；
 *   · `violated`  —— 后态全过、**前态有红**（非法依赖/边界越权）⇒ ★ 可领（去拆），★ **不许收口**；
 *   · `blocked`   —— 后态有红，且**全部**落在**别的未完成节点**上 ⇒ ★ 拒（依赖未做，领了也改不动）；
 *   · `satisfied` —— 后态全过 ∧ 前态无红 ⇒ ★ **默认只可收口、不可领**（没活干）；
 *     ★★ 2026-10-20：`intent='modify'` 时可领 —— **「没活干」≠「文件不可改」**（见下「写权 ≠ 卡的活跃度」）。
 *   · `unknowable`—— 后态一条不剩 / 后态有 unsupported / 后态全过但前态判不了 ⇒ ★ 拒（判不了）。
 *
 * ## ★ 两个读数轴是**分开**的（这是 `phase` 唯一的用处）
 *   · **满足度**（`satisfaction`）**只**由后态判据算出 —— 前态判据**不参与** `satisfied` 的计算；
 *   · **违约轴**（`violation`）**只**由前态判据算出。
 * ⇒ 所以 `satisfied` 要求"后态全过 ∧ 前态无红"，而不是"把前态并进后态一起数条数"。
 *   ★ 这两句话不是同义的：前者让 `edge-absent` 的**失败**有处置（violated），
 *     又不让它把**满足度**污染成"天然成立"。
 *
 * ## ★★★ 写权 ≠ 卡的活跃度（2026-10-20 · 结构性修复）
 * 病（用户原话）：*「一个任务已完结之后为什么会直接锁文件，而不是持续让它像**没有下过任务的文件**一样，
 * 让它能够继续被下一个任务承载？」*
 * 链路：`satisfied` ⇒ `claim` 拒 ⇒ **写闸只认 `claimed`** ⇒ 这个文件的任何改动都做不了（改一行注释都不行）。
 * ⇒ 结构错误：把「**我有活要干**」（`claim` 的语义）与「**允许写这个文件**」（写闸的语义）绑成一件事。
 * ⇒ 修法：`claim` 多一个**意图**维度（{@link ClaimIntent}）——
 *   · `work`（缺省）= 判据有红，来补红（原语义**逐字不变**）；
 *   · `modify`    = **判据已全过**，仍要改文件（改判据 / 重构 / 改注释）—— 取的是**写权**，不是补红；
 *   ⇒ 「文件可写」只要求"有人声明了要写它"，不再要求"这张卡还有红"。
 * ★ `blocked` / `unknowable` **连 modify 也拒**：那不是"卡不活跃"，是"改了也改不动 / 判不了"（依赖未做 / 判不了）。
 * ★★ `done` 卡**走** claim，但只在**重开语义**下（2026-10-20 · 第二笔）：
 *   `state === done` ⇒ `claim` 内部 = `t_reopen` + `t_claim`（**一步对外，两步对内**）——
 *   ① `reason` 必填（`t_reopen` 第 4 条：无理由的重开等于把「完成」当摆设）；
 *   ② `intent=modify` 不判判据（与 `t_reopen` 一致：重开不改判据，也不拿判据决定能不能重开）；
 *      `intent=work` 仍按 `isClaimable` 判（判据全过 ⇒ 没红可修 ⇒ 拒；节点后来退化了 ⇒ 放行）；
 *   ③ owner **换手**（上一轮的 owner 记进 `reopened_from`），否则 A7 会让新接手人写不了自己领的文件；
 *   ④ 原 `evidence[]` **逐条保留**（上一轮干过什么），新账另起（`reopened_at` / `reopen_reason`）。
 * ★ `void` 卡**仍不走 claim**：它只有 `t_relaunch`（void → candidate，判据由 publish 重给）——
 *   `void` 的判据已**作废**，`modify` 若放行 = 拿作废的判据去写文件（且 complete 会把它当「干完了」）。
 */
export type CardStanding = 'work' | 'violated' | 'blocked' | 'satisfied' | 'unknowable';

/** 归属分类里要用到的「设计节点」（★ 只取三样 ⇒ 不把整张 DSL 塞进判据）。 */
export interface StandingNode {
  id: string;
  path?: string;
  task?: TaskSpec;
}

export interface StandingInput {
  /** 被分析项目的根 —— ★ 对 domain 是**不透明字符串**（只原样转交给 `judge`，本层不读盘、不拼路径） */
  root: string;
  /**
   * ★ **全部**设计节点（`geometry.nodes`）。
   * 为什么必须在这里：`blocked` 的定义是"红**全落在别人未完成的节点**上"，
   * 而"别人是谁 / 做完没有"只能由节点表回答。★ 只给本节点是不够的；
   * ★ 给半份表会把 `foreign` 读成 `orphan`（= 把"等别人"误读成"有活干"）。
   * ★★ 已知限度（如实声明）：归属用的是 `expectationSubjectPath` 与**节点的 `path`** 比对；
   *   若某节点**没有 `path`**（只有 `description`/`semantic.files`），它既不是 own 也不是 foreign
   *   ⇒ 那些红按 `orphan` 归到 `work`。今天 `geometry.nodes[].path` 是设计侧的正规字段
   *   （`Node.path`），但**没有再加一层"必须填 path"的校验** —— 那会变成第二处判据（校验住 A.3）。
   */
  nodes: readonly StandingNode[];
  /**
   * ★★★ **判定器端口**（2026-10-21 · D-judge-port）—— **必填，没有默认实现**。
   *
   * 为什么必填：给它一个默认值（`= judgeExpectations`）就等于本文件又回头 import application，
   * 倒挂原地复活；而「可选 + 缺了判不了」会把漏接线变成**静默 unknowable**（也算一种不报错）。
   * ⇒ 必填：`.ts` 调用方漏接 ⇒ `tsc` 逐点报错；`.mjs` 证书漏接 ⇒ 运行时 `TypeError`。两条都响亮。
   *
   * ★ 实现住 `application/design/intent/expectations.ts#judgeExpectations`，接线由 application 做
   *   （`claim` / `complete` / patrol 三处）；本文件只把 `root` 原样转交给它 —— **不读盘、不拼路径**。
   * ★ 端口契约（四值原样穿过 / `checked` 必须等于提交条数 / `pending` 在 domain 侧尚未处置）见 `judge_port.ts`。
   */
  judge: Judge;
}

/** 满足度（★ **只**由后态判据得出） */
export interface SatisfactionCounts {
  checked: number;
  passed: number;
  failed: number;
  unsupported: number;
  /**
   * ★★★ 2026-10-22：**在等前置的条数**（`Verdict.pending`）。
   * ★ 为什么必须有这一格：`satisfied` 的条件是 `failed === 0 && violation.*`——
   *   若 pending 不计数，一张**只有 pending 后态判据**的卡会判 `satisfied`（可收口），
   *   而它其实还没干完。这是「判不了被读成没问题」，本仓最忌的那类绿。
   */
  pending: number;
}

/** 违约轴（★ **只**由前态判据得出） */
export interface ViolationCounts {
  checked: number;
  failed: number;
  unsupported: number;
}

export interface StandingVerdict {
  standing: CardStanding;
  /** ★ 人话拒因/放行因（★ 五值**各有各的句子**，不许共用——否则回执里看不出是哪种处境） */
  reason: string;
  /** 满足度（后态） */
  satisfaction: SatisfactionCounts;
  /** 违约轴（前态） */
  violation: ViolationCounts;
  /** 后态判定器原样报告（★ 不落盘、不缓存 —— 读数永远现算） */
  report: ExpectationsReport;
  /** 前态判定器原样报告（★ 没有前态判据时为 undefined） */
  preReport?: ExpectationsReport;
  /** 参与判定的两批（★ 分区只在这里做一次） */
  judged: { post: readonly Expectation[]; pre: readonly Expectation[] };
  /** ★ 判不了时也报"看到几条红"（`unknowable` 不许把红吞掉 —— 讨论 2 的 R2） */
  redSeen: number;
  /** `blocked` 时点名的依赖节点（★ 拒因必须能指出是谁） */
  blockedBy?: string[];
}

/**
 * ★★★ **一条红的归属**（2026-10-17 重写：这一维原本不存在，所以每遇到一种新情况都要"再加一条 if"）。
 *
 * ## 它收归的是什么（判据 = 「补丁的三条特征」：别处要**记得**配合 / 同类问题再来一次要**再加一条** /
 * 需要注释解释**为什么这样** —— 2026-10-16 用户原话「有补丁说明你原来的设计有问题」，原文已随老文档清理删除）
 * 收归前，"红落在谁那儿"用 `own / foreignOwners / orphan` **三个局部变量 + 四段 if** 表达，
 * 而"每种归属意味着什么（可领 / 等谁 / 只是漂移）"**散在四段 reason 文案里**。于是：
 *   · ★ 加一类归属 ⇒ 要**再加一条 if** 并**再写一遍 reason**（= 补丁的定义）；
 *   · ★ 漏一类 ⇒ **静默错判，且 reason 会撒谎**（2026-10-17 两路独立撞到：假 `blocked` 与假 `work` 各一次）；
 *   · ★ orphan 只能是"减出来的余数"（`reds.length - own - foreign`），**它没有名字**，所以永远想不周全。
 * ⇒ 现在：归属是**具名类型**，处置是**一张穷尽表**（{@link RED_DISPOSITION}），reason 由归属计数生成。
 *   ★ 加一类归属**只加一个枚举值 + 表里一行**，不可能忘（漏标 ⇒ `Record` 让人编不过）。
 */
export type RedAttribution =
  | { kind: 'own' }
  | { kind: 'orphan' }
  | { kind: 'dep-pending'; nodeId: string }
  | { kind: 'dep-done'; nodeId: string };

/** 归属的处置只有两种：本卡能改（claim）/ 改不动（wait）。 */
export type RedDisposition = 'claim' | 'wait';

/**
 * ★★★ **归属 ⇒ 处置**（唯一的判据住处）。
 *
 * ★ `Record<RedAttribution['kind'], RedDisposition>` ⇒ **新增归属漏标就编不过**
 *   —— 与 `expectation.ts#PHASE_BY_KIND` 同一手法（穷尽性由编译器钉死，不靠"记得补"）。
 *
 * ★★ 为什么 `dep-done` 也归 `wait`（2026-10-17 重写时想清的一层）：
 *   写闸只认「**该节点**有 claimed 卡」⇒ 别的节点哪怕是 `done`，本卡也**改不动它路径上的文件**。
 *   ⇒ 红落在已 done 的节点上时，本卡能做的只有"**重开那张卡**"，那仍是"等/换一张卡"，不是"本卡能改"。
 *   （收归前这里判 `work`，理由是"红是旧判据/漂移，要本卡处置"—— ★ 但本卡其实处置不了。）
 */
export const RED_DISPOSITION: Record<RedAttribution['kind'], RedDisposition> = {
  own: 'claim',
  orphan: 'claim',
  'dep-pending': 'wait',
  'dep-done': 'wait',
};

/**
 * ★★★ **五值读数**（唯一的判据编排处；设计 DSL：`task_machine` 节点的 `cardStanding`）。
 *
 * ## 编排（★ 三件事，不造第二把尺）
 * 1. 按期望**自带的 `phase`** 分成两批（`postExpectations` + `phase==='pre'`，★ T10 的收归）；
 * 2. 两批各跑**同一个**注入的 `Judge`（`pass / fail / unsupported / pending` 只有它一套）；
 * 3. 由两份报告**派生**五值 + 归属（`own / foreign / orphan`，用既有 `expectationSubjectPath`）。
 *
 * ## 判定顺序（= 优先级；每一格都有夹具：t351 = 五值主表，t353 = 端口纯度 + 残报守卫）
 * ```
 * 判定器只回了部分条目（report.checked ≠ items.length） ⇒ unknowable（★ 残报不算全过，2026-10-21）
 * 后态一条不剩              ⇒ unknowable（空集不按"全过"算）
 * 后态 unsupported > 0      ⇒ unknowable（判不了 ≠ 有活 ≠ 没活）
 * 后态 failed === 0 ∧ 前态 failed > 0   ⇒ violated
 * 后态 failed === 0 ∧ 前态 unsupported > 0 ⇒ unknowable（满足度成立，但不敢说"没有违约"）
 * 后态 failed === 0 ∧ 前态无红           ⇒ satisfied
 * 后态有红 ∧ 没有一条「本卡能改」（`RED_DISPOSITION` 全为 `wait`） ⇒ blocked（点名 dep）
 *   ★ 含已 `done` 的 dep —— 闸只认该节点的 claimed 卡，本卡改不动它，处置方式是【重开那张卡】
 * 后态有红 ∧ 至少一条「本卡能改」                          ⇒ work
 *   ★ 但若同时有 pending dep，reason 会明说"即便做完全部也收不了口"（不假装能做干净）
 * ```
 *
 * @param card 任务格（`state` 不参与判定；★ 状态迁移由调用方先过 `applicableTransitions`）
 * @param expectations 这张卡的判据 —— ★ **调用方按 `expectationsOf(node)` 现取**（`task_schema.ts`），
 *   本函数**不读卡**（任务格不自持判据；`task.expectations` 副本已删）
 */
export async function cardStanding(
  card: TaskSpec,
  expectations: readonly Expectation[],
  opts: StandingInput,
): Promise<StandingVerdict> {
  // ★ 分区只在这里做一次（phase 是期望自带的属性 ⇒ 不需要任何清单，"记得剔除"这一步已不存在）
  const post = postExpectations(expectations);
  const pre = expectations.filter((e) => expectationPhase(e) === 'pre');
  const items = (xs: readonly Expectation[]) =>
    xs.map((expectation) => ({ node_id: card.id, node_label: card.summary, expectation }));

  // ★ 两批各判一次（空批也交判定器 ⇒ 计数口径仍只有一处）
  // ★★ 判定器由调用方**注入**（`opts.judge`）：本层不再 import application —— 端口见 `domain/judge_port.ts`
  const report = await opts.judge(opts.root, items(post));
  const preReport = pre.length ? await opts.judge(opts.root, items(pre)) : undefined;

  const satisfaction: SatisfactionCounts = {
    checked: report.checked,
    passed: report.passed,
    failed: report.failed,
    unsupported: report.unsupported,
    // ★★★ 2026-10-22：**从 `items` 数，不信 `report.pending`**。
    //   为什么：`report.pending` 是**声称**的计数，而假 judge / 旧实现可能根本不填它
    //   ⇒ 判据会静默失效（实测：`certs/t358` 的假 judge 不填 ⇒ 我的第一版判据看不见 pending）。
    //   `checked === items.length` 那道守卫已经把「items 是唯一权威」立起来了 ⇒ 这里顺着它数。
    //   ★ 这也守住一条：**别让"上游没填字段"变成"判据不生效"**（那就是换了个形状的假绿）。
    pending: (report.items ?? []).filter((i) => i.verdict === 'pending').length,
  };
  const violation: ViolationCounts = {
    checked: pre.length,
    failed: preReport?.failed ?? 0,
    unsupported: preReport?.unsupported ?? 0,
  };
  const redSeen = satisfaction.failed + violation.failed;
  const base = { satisfaction, violation, report, preReport, judged: { post, pre }, redSeen };

  // ── ⓪ 判定器**没把提交的每一条都判回来** ⇒ 残报不许当「全过」（2026-10-21 · D-judge-port）
  //   ★ 这是端口化**新开**的一条假绿通道：拆分前报告的唯一生产者是真 judge；拆分后任何人都可以注入一个
  //     `() => ({checked:0, items:[]})` —— 而 `failed === 0 ∧ unsupported === 0` 会直接判 `satisfied`
  //     ⇒ 「一条没判」被读成「全部通过」。（本仓最忌的就是这一类绿。）
  //   ★ 对**真** judge **不可达**：`judgeExpectations` 对 8 个 kind 的每条路径都恰好 push 一次
  //     ⇒ `checked === items.length` 恒成立 ⇒ 这条守卫**不改任何现有结论**，只封口子（夹具见 certs/t353）。
  //   ★ 契约出处：`judge_port.ts` 第 2 条（「`checked` 必须 === 提交的 `items.length`」）——
  //     边界上的承诺**要有人验**，否则端口只是一句口号。
  if (report.checked !== post.length || (preReport && preReport.checked !== pre.length)) {
    const got =
      `后态 ${report.checked}/${post.length}` + (preReport ? `、前态 ${preReport.checked}/${pre.length}` : '');
    return {
      ...base,
      standing: 'unknowable',
      reason:
        `判定器**只回了部分条目**（${got}）⇒ 残缺报告不算「全过」（★ 少判的那几条不是"没问题"）`,
    };
  }

  // ── ① 后态一条不剩：没有"施工后才可能成立"的判据 ⇒ 判不了（真空真会误收口，见 OQ5）
  if (post.length === 0) {
    return {
      ...base,
      standing: 'unknowable',
      reason: '后态判据（phase=post）一条不剩（空集不按「全过」算）⇒ 判不了「有没有活 / 收没收口」',
    };
  }

  // ── ② 后态判不了：压过一切（★ 但把"另外看到几条红"带出来，不吞）
  if (satisfaction.unsupported > 0) {
    return {
      ...base,
      standing: 'unknowable',
      reason:
        `后态判据里 ${satisfaction.unsupported} 条**判不了**（unsupported 既不算过也不算不过）⇒ 判不了` +
        (redSeen > 0 ? `；★ 同时看到 ${redSeen} 条红，不许当成「没活」` : ''),
    };
  }

  // ── ②.5 后态**在等前置**（pending）：也压过 satisfied（★★ 2026-10-22 补的一个假绿口子）
  //   为什么与 ② unsupported 分开：`unsupported` = 「**这个判据**我判不了」（工具/索引不够）；
  //   `pending` = 「**这活**还没干完，卡在某处」—— 卡在哪写在 `blocked_by` 里，**必须读得出来**。
  //   两者都**不许**被读成「全过」，但只有 pending 需要把 blocked_by 原文带进 reason。
  //   ★ 这条不补的后果就是：一张只有 `run{blocked_by:'等 X'}` 后态判据的卡被判 satisfied（可收口）。
  if (satisfaction.pending > 0) {
    const blocked = report.items
      .filter((i) => i.verdict === 'pending')
      .map((i) => (i.expectation.kind === 'run' ? String(i.expectation.blocked_by ?? '').trim() : ''))
      .filter(Boolean);
    return {
      ...base,
      standing: 'unknowable',
      reason:
        `后态判据里 ${satisfaction.pending} 条**在等前置**（pending：活还没干完，卡在某处）` +
        `⇒ 判不了「收没收口」` +
        (blocked.length ? `：\n${[...new Set(blocked)].map((b) => `  · 等：${b}`).join('\n')}` : '') +
        (redSeen > 0 ? `\n★ 同时看到 ${redSeen} 条红，不许当成「没活」` : ''),
    };
  }

  // ── ③ 后态全过：分 satisfied / violated / unknowable（前态只决定"违约轴"）
  if (satisfaction.failed === 0) {
    if (violation.failed > 0) {
      return {
        ...base,
        standing: 'violated',
        reason:
          `违约：后态判据 ${satisfaction.passed} 条全过，但**前态判据** ${violation.failed} 条红` +
          `（边界越权/非法依赖）⇒ 可领（去拆），★ **不许收口**`,
      };
    }
    if (violation.unsupported > 0) {
      return {
        ...base,
        standing: 'unknowable',
        reason:
          `满足度已成立，但前态判据 ${violation.unsupported} 条**判不了** ⇒ 无法确认「没有违约」` +
          `（不敢说 satisfied，也不许说 violated）`,
      };
    }
    return {
      ...base,
      standing: 'satisfied',
      reason:
        `已满足：后态判据 ${satisfaction.passed} 条全过、前态判据 ${violation.checked} 条无红` +
        ` ⇒ **只可收口**（没活干；★ 要改这个文件 —— 改判据 / 重构 / 改注释 —— 用 claim intent:modify）`,
    };
  }

  // ── ④ 后态有红：每条红先给【归属】，再由归属的处置派生 standing（★ 判据只住 RED_DISPOSITION 一处）
  const self = opts.nodes.find((n) => n.id === card.id);
  const selfPath = self?.path ? normPath(self.path) : '';

  const classifyRed = (e: Expectation): RedAttribution => {
    const p = expectationSubjectPath(e);
    if (selfPath && p === selfPath) return { kind: 'own' };
    const owner = opts.nodes.find((n) => n.id !== card.id && n.path && normPath(n.path) === p);
    if (!owner) return { kind: 'orphan' };
    return owner.task?.state === 'done'
      ? { kind: 'dep-done', nodeId: owner.id }
      : { kind: 'dep-pending', nodeId: owner.id };
  };

  const reds = report.items.filter((i) => i.verdict === 'fail').map((i) => i.expectation);
  const attrs = reds.map(classifyRed);
  const count = (k: RedAttribution['kind']) => attrs.filter((a) => a.kind === k).length;
  const idsOf = (k: 'dep-pending' | 'dep-done'): string[] =>
    [...new Set(attrs.flatMap((a) => (a.kind === k ? [a.nodeId] : [])))].sort();

  const mine = attrs.filter((a) => RED_DISPOSITION[a.kind] === 'claim').length;
  const pendingIds = idsOf('dep-pending');
  const doneIds = idsOf('dep-done');

  // ── ⑤ 处置：没有一条本卡能改 ⇒ 等别人（blocked）；否则有活干（work）──
  if (mine === 0) {
    return {
      ...base,
      standing: 'blocked',
      blockedBy: [...pendingIds, ...doneIds].sort(),
      reason:
        `等别人：后态判据红 ${satisfaction.failed} 条，**没有一条是本卡能改的**` +
        `（闸只认本节点 ${selfPath || '（本节点没有 path）'} 的 claimed 卡）` +
        (pendingIds.length ? `；未完成节点 ${pendingIds.join(' / ')}` : '') +
        (doneIds.length ? `；已 done 的节点 ${doneIds.join(' / ')} —— 它们的红是旧判据/漂移，要处置得先重开那张卡` : ''),
    };
  }

  return {
    ...base,
    standing: 'work',
    reason:
      `有活干：后态判据红 ${satisfaction.failed} 条，其中 ${mine} 条本卡能改` +
      (count('own') ? `（本节点 ${selfPath}）` : '') +
      (count('orphan') ? `（含 ${count('orphan')} 条不对应任何节点）` : '') +
      (pendingIds.length ? `；另 ${pendingIds.join(' / ')} 未完成 ⇒ 那部分改不动，本卡即便做完全部也收不了口` : '') +
      (doneIds.length ? `；${doneIds.join(' / ')} 已 done，其红是旧判据/漂移` : ''),
  };
}

/**
 * ★★ **"可领"谓词**（`claim` 侧唯一的读法）：`work` / `violated` 恒可领；`satisfied` **只有 `modify` 意图**可领。
 * ★ 只此一处允许把"哪几个值算可领"写出来 —— 调用方**不许**自己写 `=== 'work'`。
 *
 * ## 为什么带 `intent`（2026-10-20 · 见文件头「写权 ≠ 卡的活跃度」）
 * `claim` 原本只表达一件事 ——「**我有活要干**」—— 而写闸只认 `claimed` ⇒
 *   一张 `satisfied` 的卡（判据全过、没活干）**永远领不到** ⇒ **它指向的文件永久只读**。
 * ⇒ 把两件事分开：`work` = 来补红（缺省，判据必须没全过）；`modify` = 来改文件（判据可以全过，取写权）。
 *   ★ 缺省仍是 `work` ⇒ **老调用方的行为逐字不变**（单参形态的语义没变）。
 *   ★ `blocked` / `unknowable` 一律拒：那不是"没活干"，是"改不动 / 判不了"—— `modify` 也不行。
 */
export type ClaimIntent = 'work' | 'modify';

export function isClaimable(standing: CardStanding, intent: ClaimIntent = 'work'): boolean {
  if (standing === 'work' || standing === 'violated') return true;
  return intent === 'modify' && standing === 'satisfied';
}

export interface SatisfactionVerdict {
  /** ★ 可收口（= `cardStanding === 'satisfied'`；★ 不许把它简化成"后态全过"——那会放行 violated 卡） */
  satisfied: boolean;
  standing: CardStanding;
  reason: string;
  verdict: StandingVerdict;
}

/**
 * ★★ **"可收口"判定**（`complete` / patrol 的 `missed_close` 侧唯一的读法）。
 *
 * ★ 为什么它必须是**独立函数**（而不是 `cardStanding` 里顺手带出来的一个布尔）：
 *   收口闸的使用者不止 `completeTask` 一个（patrol 的 `missed_close` 也要问"这张卡是不是
 *   该收而没收"），若那个布尔只活在 `cardStanding` 的返回值里，"谁问收口"就会各自拼条件。
 * ★ 它与 `isClaimable` **同源**（都读 `cardStanding`）⇒ 一处判据、两个方向，不是两把尺。
 */
export async function isSatisfied(
  card: TaskSpec,
  expectations: readonly Expectation[],
  opts: StandingInput,
): Promise<SatisfactionVerdict> {
  const verdict = await cardStanding(card, expectations, opts);
  return { satisfied: verdict.standing === 'satisfied', standing: verdict.standing, reason: verdict.reason, verdict };
}

// ─────────────────────────────────────────────────────────────
// 租约回收（TTL）
// ─────────────────────────────────────────────────────────────

/** 一次**租约过期**（`claimed_at` 太久没人续）—— ★ 它是一个**事件**，不是一个状态改动。 */
export interface LeaseReleaseEvent {
  id: string;
  reason: 'lease_ttl';
  /** 判定时刻（ISO 8601） */
  at: string;
  /** 领取时刻（原样带出，便于对账） */
  claimed_at: string;
  age_ms: number;
  ttl_ms: number;
}

/**
 * ★★ **TTL 超时回收**（设计 DSL：`task_machine` 节点的 `releaseIfExpired`）。
 *
 * ## 为什么非有它不可
 * `claimed_at` **不配超时就是死锁字段**：领了卡不走（人跑了 / 进程死了）⇒ 卡永远停在 `claimed`，
 * 谁也领不走。`patrols.lease_ttl` 的红判据就是它（`count(...) > 0` ⇒ 红）。
 *
 * ## 形态（★ 两条都是**有意**的）
 * 1. **纯函数**：只**产出事件**，**不改任何 state** ——
 *    设计 DSL 的 `t_release` guard 逐字写着"由 `releaseIfExpired` 产出 release 事件后再回 candidate，
 *    ★ **不得静默改 state**"（静默改 = 第二处权威）。
 * 2. **判不了就不判**：`state !== 'claimed'` / 缺 `claimed_at` / `claimed_at` 不是合法时间
 *    ⇒ **跳过**（不把"取不到"读成"没超时"，也不读成"超时了"）。
 *
 * @param cards 全部任务格
 * @param nowMs 判定时刻（epoch ms；★ 显式传入而**不在函数里取 now** ⇒ 可复现）
 * @param ttlMs 租约时长（★ 取值待裁，见 OQ2/OQ6 —— 本函数**不写死**任何默认值）
 */
export function releaseIfExpired(
  cards: readonly TaskSpec[],
  nowMs: number,
  ttlMs: number,
): LeaseReleaseEvent[] {
  const out: LeaseReleaseEvent[] = [];
  for (const card of cards) {
    // ★ 运行期守卫：状态从 JSON 读回时静态类型不再有保证
    if (!isTaskState(card.state) || card.state !== 'claimed') continue;
    if (!card.claimed_at) continue; // 没有 claimed_at ⇒ 判不了，不当过期（不静默改 state）
    const claimedMs = Date.parse(card.claimed_at);
    if (!Number.isFinite(claimedMs)) continue; // 时间不合法 ⇒ 同上
    const ageMs = nowMs - claimedMs;
    if (ageMs > ttlMs) {
      out.push({
        id: card.id,
        reason: 'lease_ttl',
        at: new Date(nowMs).toISOString(),
        claimed_at: card.claimed_at,
        age_ms: ageMs,
        ttl_ms: ttlMs,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 迁移表（★ 逐条照设计 DSL 的 task_plan.state_machine.transitions）
// ─────────────────────────────────────────────────────────────

/**
 * ★★★ 一条迁移**能不能走**（2026-10-17 重写：这一维原本有两个字段表达同一件事，且设计↔代码不一致）。
 *
 * ## 收归前（两处形状）
 * · 代码：`enabled: boolean`（`applicableTransitions` 唯一读它）+ `guard.blocked_by_open_question`（★ **没有读者**）
 * · 设计 DSL：6 条迁移**都没有 `enabled`**，只有 `t_done_from_candidate` 有 `blocked_by_open_question`
 * ⇒ ★ 同一件事（能不能走）：**设计用 A 表达、代码用 B 表达**，而代码那半边 `blocked_by_open_question` 没人读
 *   ⇒ 把 `enabled` 改 `true`、OQ1 仍开放，4 条不变量照样全 PASS（2026-10-17 实测）。
 * ★ 用"再加一条不变量"去补 = **补丁**（事后检查）；**改成一个字段 = 结构上不可能**。
 *
 * ## 现在（一维一处）
 * `state` 是**必填**的联合类型 ⇒ 每条迁移**必须**声明自己处在哪一格，漏声明**编不过**；
 * 且 `blocked` 自带 OQ 编号 ⇒ **不存在**"声明可走却挂着一个未决项"这种组合（那个字段已不存在）。
 *
 * ★ `unimplemented` 这一格是**诚实**用的：迁移表里有这一条，但**没有代码会执行它**
 *   ⇒ `applicableTransitions` 不返回它 ⇒ 调用方不会以为"可走"然后撞到"不支持操作"。
 */
export type TransitionState =
  | { kind: 'ready' }
  | { kind: 'blocked'; by: string }
  | { kind: 'unimplemented'; why: string };

/** 一条迁移（`guard.clauses` 是**人读判据**；机器可判的那部分由本模块的函数实现）。 */
export interface TaskTransition {
  id: string;
  from: TaskState;
  to: TaskState;
  /** ★ 能不能走（**唯一**表达；`applicableTransitions` 只认 `kind === 'ready'`） */
  state: TransitionState;
  guard: {
    clauses: readonly string[];
  };
}

/**
 * ★★ **迁移表**（唯一住处；读处见 {@link applicableTransitions}）。
 *
 * ★ 2026-10-20：`t_done_from_candidate`（`candidate → done`）**已实现**（OQ1 裁定：主体显式收口，
 *   不许 patrol 自动置 done）；同日新增 `t_relaunch`（`void → candidate`）。
 * ★ 两条"回头路"并存，别混：`t_reopen` = 接手（判据不变）· `t_relaunch` = 重新立卡（判据重给）。
 */
export const TRANSITIONS: readonly TaskTransition[] = [
  {
    id: 't_claim',
    from: 'candidate',
    to: 'claimed',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        'isClaimable(cardStanding(card), intent) === true（★ 取五值里的 work / violated 两格 —— 有活干、或有违约要拆；★ 另有 satisfied ∧ intent=modify）',
        '★ 按期望自带的 phase 分区（phase=post 供满足度，phase=pre 供违约轴）后：work = 后态有本节点的红；violated = 后态全过 ∧ 前态有红',
        '★ satisfied 默认不可领（没活干）；★ 但 data.intent=modify 可领 —— 已完成 / 已满足的文件仍要能被下一个任务承载（改判据 / 重构 / 改注释），**写权不该由卡的活跃度决定**（2026-10-20）；blocked / unknowable 连 modify 也拒（依赖未做 / 判不了）',
        'target 在 DB 存在（不存在则走 t_void）',
        '★ state=candidate ⇒ CAS：owner IS NULL 时才写 owner（changes === 1）',
        '★★ state=done ⇒ 本迁移不直接执行：先走 t_reopen（reason 必填、owner 换手、reopened_at / reopen_reason / reopened_from 记账、evidence 保留），再写 owner —— 一步对外（claim intent=modify）两步对内；intent=work 时仍要 isClaimable 放行（判据后来退化了才有活）',
        '★ state=void 不走这里（t_relaunch → candidate → publish → claim）',
      ],
    },
  },
  {
    id: 't_void',
    from: 'candidate',
    to: 'void',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        'target 在 DB 查不到（files / edges 任一查无此 target）',
        '★★ 2026-10-22 语义（唯一住处 = 这四条）：void = 「这事**不做了**」（弃做）—— **不是「干完了」**（done），也**不是「放回去」**（release）；收尾只能走 t_done_from_claimed / t_done_from_candidate',
        '★ 单向闸：**只有 candidate 能进**（claimed 必须先 t_release）—— 理由不是风格：作废一张在办的卡会让「谁领的、干到哪」凭空断掉',
        '★ 但**不是终态**：void 有且只有一条出边 t_relaunch（void → candidate，reason 必填）⇒ 「弃做」可撤销，而「完成」不能被 void 冒充',
        '★ 作废的是「这活要做」，不是「这活存在过」：判据住 decision（不随卡走）⇒ void **不改也不删判据**；summary / evidence 保留',
      ],
    },
  },
  {
    id: 't_release',
    from: 'claimed',
    to: 'candidate',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        '显式 release 事件（带 by + reason），或',
        'now - claimed_at > TTL：由 releaseIfExpired 产出 release 事件后再回 candidate，★ 不得静默改 state',
      ],
    },
  },
  {
    id: 't_done_from_claimed',
    from: 'claimed',
    to: 'done',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        'owner !== null（★ 必须已领）',
        'isSatisfied(card) === true（= cardStanding === \'satisfied\'：后态全过 ∧ 前态无红；★ 与 t_claim 的谓词**不是同一个**）',
        'validateProgressEvidence 过（★ 复用既有证据闸，不新造第二把尺）',
      ],
    },
  },
  {
    id: 't_reopen',
    from: 'done',
    to: 'claimed',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        '★ 用户 2026-10-19 裁定：done 是终态时，同一节点的【第二个工作项无处安放】—— publish 拒、release 只能 claimed→candidate',
        '而"一个文件会被反复改"是常态 ⇒ 必须有重开路径',
        'owner 必填（谁来重开 = 谁接手）',
        'reason 必填（为什么重开）—— ★ 无理由的重开等于把"完成"当摆设',
        '★ 重开不改判据（判据就住在 decision 里，重开不碰它）；要换判据请走 reopen → 改 decision → publish{reason}',
        '★ 同一件事有两个入口：`reopen`（显式两步）与 `claim intent=modify`（一步对外，内部 = 本迁移 + t_claim）',
        '★ 落 `reopened_from`（上一轮 owner）与 `reopen_reason`（为什么又开）—— 换手要留痕，理由不能只活在回执里',
        'CAS：state=done 时才写（防并发）',
      ],
    },
  },
  {
    id: 't_relaunch',
    from: 'void',
    to: 'candidate',
    state: { kind: 'ready' },
    guard: {
      clauses: [
        '★ 用户 2026-10-20 裁定：「void 是『这事不做了』，不是『这事不存在过』」⇒ 必须能重新立卡，而不是另开节点',
        '★★ 与 t_reopen 的分界（同一个词的两种活）：t_reopen = done → claimed「接手」（判据不变，原卡继续）；t_relaunch = void → candidate「重新立卡」（判据要重给，卡回到没人领）',
        'reason 必填（为什么重新立卡）—— ★ 无理由的复活等于把「作废」当摆设',
        '★ 判据不自持：relaunch 既清不掉也改不了判据（唯一住处 = decision）；卡回到 candidate 后，若 decision 的判据已全绿，claim 会提示 intent:modify ⇒ 要重给判据就改 decision，再 publish',
        '★ 判据不在这里重给：relaunch 只把卡放回 candidate，重给判据的唯一入口仍是 publish（从 decision 翻）',
        '★ summary / evidence 保留（「这活存在过」的历史不删）；owner / claimed_at 必须为空（void 只能从 candidate 来，而 candidate 不持 owner）',
        'CAS：state=void 时才写（防并发）',
      ],
    },
  },
  {
    id: 't_done_from_candidate',
    from: 'candidate',
    to: 'done',
    // ★★★ 2026-10-20（OQ1）：**显式收口**，不是"自动收口"
    //   —— 一张卡若一出生就 satisfied，则"领"没有意义（claim 会拒它）；
    //     但必须留一条"不领也能收口"的路，否则它永远停在 candidate（实测死锁）。
    state: { kind: 'ready' },
    guard: {
      clauses: [
        '★ 用户 2026-10-20 裁定（OQ1）：允许 complete 从 candidate 起步 —— 由【主体显式宣布】，不是自动置 done',
        '★ 仍排除自动：不得由 patrol 直接置 done（状态变化要有主体宣布，这是 OQ1 的第二条 guard 原意）',
        '必须 isSatisfied(card)：后态全过 ∧ 前态无红（判据同 t_done_from_claimed，不另写一把尺）',
        '★ owner 可以为空：这张卡可能从没被领过（一出生就满足），收口不要求曾经领过',
      ],
    },
  },
];

/**
 * 某个状态**此刻可走**的迁移（★ 读处：只返回 `state.kind === 'ready'` 的；`blocked` / `unimplemented` 一律不返回）。
 *
 * ★ 为什么要有它，而不是让调用方自己 `TRANSITIONS.filter(...)`：
 *   漏掉 `state.kind === 'ready'` 这一条判断 ⇒ **被未决项挡住 / 未实现的迁移会被当成可走**
 *   （例：`t_done_from_candidate` 曾在 OQ1 未拍时挂着 `blocked`）⇒ 调用方会以为能走、然后撞"不支持"。判据只住一处。
 */
export function applicableTransitions(from: TaskState): TaskTransition[] {
  return TRANSITIONS.filter((t) => t.state.kind === 'ready' && t.from === from);
}
