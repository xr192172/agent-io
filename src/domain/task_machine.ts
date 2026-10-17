/**
 * task_machine.ts —— 任务状态机：**状态迁移与可领性判定**。
 *
 * 设计出处：`docs/task-system-plan.dsl.json` 的节点 `file_src_domain_task_machine_ts`
 * （`task_plan.state_machine` 的 `transitions` / `patrols` 是本文件的语义来源）。
 *
 * ## ★★ 前态判据（`phase='pre'`，如 `edge-absent`）由「期望自带」—— 本文件**不再有任何清单**
 * 「前态判据」= 在**未施工**时**天然成立**的判据（`edge-absent`："不许依赖 X" —— 还没写当然不依赖）。
 * ⇒ 若拿它们一起判"是否已满足"，**每一张刚出生的卡都会「全过」** ⇒
 *   ★ **任务还没领就被误收口**。所以判定前必须先**选取后态判据**（按期望自带的 `phase`）。
 *
 * ★★★ 2026-10-16（T10 · `docs/principle-rewrite-not-patch.md` §四）：**这一段原先是一处补丁**——
 *   本文件曾自带一份清单 `NEGATIVE_KINDS = ['edge-absent']` + `positiveExpectations()`（"判定前记得剔除"）。
 *   ★ 它是"补丁"的三个特征都占：① 别处要**记得**剔；② 同类问题再来一次要**再加一条**；③ 需注释解释缘由。
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
 * ## 判定器复用（★ 不新造第二把尺）
 * 判据的判定一律走既有 `judgeExpectations`（`application/design/intent/expectations.ts`）——
 * 它已经会区分 `pass / fail / unsupported`，且 `unsupported` **不算通过**。
 * 本文件**只**做四件事：① 按 phase 分区 ② 编排判定 ③ 派生五值 ④ 出迁移判据 / 租约回收。
 *
 * ## 迁移表（★ 逐条照设计 DSL；`candidate → done` **不实现**）
 * 见 {@link TRANSITIONS}。其中 `t_done_from_candidate` 带
 * `blocked_by_open_question: 'OQ1'` ⇒ **声明为存在但 `enabled:false`**：
 * ★ **没有任何代码路径**能执行它，等用户裁定（"『已满足』的卡：自动收口还是只提示"）。
 */
import { judgeExpectations, type ExpectationsReport } from '../application/design/intent/expectations.js';
import { expectationPhase, expectationSubjectPath, normPath, postExpectations, type Expectation } from './expectation.js';
import { isTaskState, type TaskSpec, type TaskState } from './task_schema.js';

/**
 * ★★★ 一张卡的**五值读数**（`docs/_extract/task-system-discussion-2.md` §5.1 `P30` 的裁决）。
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
 *   · `satisfied` —— 后态全过 ∧ 前态无红 ⇒ ★ **只可收口，不可领**（没活干）；
 *   · `unknowable`—— 后态一条不剩 / 后态有 unsupported / 后态全过但前态判不了 ⇒ ★ 拒（判不了）。
 *
 * ## ★ 两个读数轴是**分开**的（这是 `phase` 唯一的用处）
 *   · **满足度**（`satisfaction`）**只**由后态判据算出 —— 前态判据**不参与** `satisfied` 的计算；
 *   · **违约轴**（`violation`）**只**由前态判据算出。
 * ⇒ 所以 `satisfied` 要求"后态全过 ∧ 前态无红"，而不是"把前态并进后态一起数条数"。
 *   ★ 这两句话不是同义的：前者让 `edge-absent` 的**失败**有处置（violated），
 *     又不让它把**满足度**污染成"天然成立"。
 */
export type CardStanding = 'work' | 'violated' | 'blocked' | 'satisfied' | 'unknowable';

/** 归属分类里要用到的「设计节点」（★ 只取三样 ⇒ 不把整张 DSL 塞进判据）。 */
export interface StandingNode {
  id: string;
  path?: string;
  task?: TaskSpec;
}

export interface StandingInput {
  /** 被分析项目的根（`judgeExpectations` 要拿它去读代码 / 索引） */
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
}

/** 满足度（★ **只**由后态判据得出） */
export interface SatisfactionCounts {
  checked: number;
  passed: number;
  failed: number;
  unsupported: number;
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
 * ★★★ **五值读数**（唯一的判据编排处；设计 DSL：`task_machine` 节点的 `cardStanding`）。
 *
 * ## 编排（★ 三件事，不造第二把尺）
 * 1. 按期望**自带的 `phase`** 分成两批（`postExpectations` + `phase==='pre'`，★ T10 的收归）；
 * 2. 两批各跑**同一个** `judgeExpectations`（`pass / fail / unsupported` 只有它一套）；
 * 3. 由两份报告**派生**五值 + 归属（`own / foreign / orphan`，用既有 `expectationSubjectPath`）。
 *
 * ## 判定顺序（= 优先级；每一格都有夹具，见 `certs/t351-card-standing-cert.mjs`）
 * ```
 * 后态一条不剩              ⇒ unknowable（空集不按"全过"算）
 * 后态 unsupported > 0      ⇒ unknowable（判不了 ≠ 有活 ≠ 没活）
 * 后态 failed === 0 ∧ 前态 failed > 0   ⇒ violated
 * 后态 failed === 0 ∧ 前态 unsupported > 0 ⇒ unknowable（满足度成立，但不敢说"没有违约"）
 * 后态 failed === 0 ∧ 前态无红           ⇒ satisfied
 * 后态有红 ∧ 无 own ∧ 全是 foreign 且那些节点都没 done ⇒ blocked（点名 dep）
 * 后态有红 ∧ 其余                        ⇒ work
 * ```
 *
 * @param card 任务格（`state` 不参与判定；★ 状态迁移由调用方先过 `applicableTransitions`）
 */
export async function cardStanding(card: TaskSpec, opts: StandingInput): Promise<StandingVerdict> {
  // ★ 分区只在这里做一次（phase 是期望自带的属性 ⇒ 不需要任何清单，"记得剔除"这一步已不存在）
  const post = postExpectations(card.expectations);
  const pre = card.expectations.filter((e) => expectationPhase(e) === 'pre');
  const items = (xs: readonly Expectation[]) =>
    xs.map((expectation) => ({ node_id: card.id, node_label: card.summary, expectation }));

  // ★ 两批各判一次（空批也交判定器 ⇒ 计数口径仍只有一处）
  const report = await judgeExpectations(opts.root, items(post));
  const preReport = pre.length ? await judgeExpectations(opts.root, items(pre)) : undefined;

  const satisfaction: SatisfactionCounts = {
    checked: report.checked,
    passed: report.passed,
    failed: report.failed,
    unsupported: report.unsupported,
  };
  const violation: ViolationCounts = {
    checked: pre.length,
    failed: preReport?.failed ?? 0,
    unsupported: preReport?.unsupported ?? 0,
  };
  const redSeen = satisfaction.failed + violation.failed;
  const base = { satisfaction, violation, report, preReport, judged: { post, pre }, redSeen };

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
        ` ⇒ **只可收口，不可领**（没活干）`,
    };
  }

  // ── ④ 后态有红：看红的主体落在谁的 path 上（own / foreign / orphan）
  const self = opts.nodes.find((n) => n.id === card.id);
  const selfPath = self?.path ? normPath(self.path) : '';
  const isForeign = (e: Expectation): StandingNode | undefined => {
    const p = expectationSubjectPath(e);
    if (selfPath && p === selfPath) return undefined; // own
    return opts.nodes.find((n) => n.id !== card.id && n.path && normPath(n.path) === p);
  };
  const reds = report.items.filter((i) => i.verdict === 'fail').map((i) => i.expectation);
  const own = reds.filter((e) => selfPath !== '' && expectationSubjectPath(e) === selfPath);
  const foreignOwners = reds.filter((e) => own.indexOf(e) === -1).map(isForeign).filter((n): n is StandingNode => !!n);
  const orphan = reds.length - own.length - foreignOwners.length;
  // ★ 去重 + 稳定排序（★ 不用 localeCompare：跨 locale 坐标会变，见 B.4）
  const depIds = [...new Set(foreignOwners.map((n) => n.id))].sort();
  const pendingDeps = depIds.filter((id) => opts.nodes.find((n) => n.id === id)?.task?.state !== 'done');

  // ★★★ 2026-10-17（静态分析，两路独立撞到）：blocked 的判据原来只对了"dep 全 pending"这一半 ⇒ 两头都漏。
  //   ① 漏 `orphan`：有 orphan 红时也判 blocked ⇒ reason 还谎称"主体**全落在** dep 的 path 上"（实际只有一部分）
  //      ⇒ ★ 那张卡其实有本卡该干的活（orphan），却被劝"等别人" ⇒ 活永远没人干。
  //   ② 漏"部分 pending"：一条红落在未完成 dep、别的落在已 done dep ⇒ 判 work
  //      ⇒ ★ 但落在未完成 dep 上的那条，领了也改不动（闸只认该节点的 claimed 卡）⇒ 假"有活干"。
  //   ⇒ 现在：blocked ⟺ 没有 own ∧ 没有 orphan ∧ 【存在】pending dep（不要求"全部"）。
  //     理由：只要有活落在"别人未完成"的节点上，本卡的闸就改不动它 —— 那一条就足以构成"等别人"。
  if (own.length === 0 && orphan === 0 && pendingDeps.length > 0) {
    const doneDeps = depIds.filter((id) => !pendingDeps.includes(id));
    return {
      ...base,
      standing: 'blocked',
      blockedBy: pendingDeps,
      reason:
        `等别人：后态判据红 ${satisfaction.failed} 条，主体落在节点 ${pendingDeps.join(' / ')} 的 path 上，` +
        `且它们都**没有 done 的卡** ⇒ 领这张卡改不动那些文件（闸只认该节点的 claimed 卡）` +
        (doneDeps.length > 0 ? `；另有 ${doneDeps.length} 个节点（${doneDeps.join(' / ')}）已 done，它们的红是旧判据/漂移` : ''),
    };
  }

  if (own.length > 0) {
    return {
      ...base,
      standing: 'work',
      reason:
        `有活干：后态判据红 ${satisfaction.failed} 条，其中 ${own.length} 条的主体是**本节点**（${selfPath}` +
        `${orphan > 0 ? `；另 ${orphan} 条不对应任何节点` : ''}）`,
    };
  }
  if (depIds.length > 0) {
    // ★ 红在别人节点上，但**本卡也还有 orphan 红**（或那些节点已 done）⇒ 不是"纯等它"，仍算本卡有活。
    // ★★ 2026-10-17（夹具1 实测抓到）：本分支原先把 reason 写死成"它们**已有 done 的卡**" ——
    //    但 `orphan > 0` 的路径会把【未完成】的 dep 带进来 ⇒ 那句话就成了假话（nodeC 没有 task 却说它 done）。
    //    ⇒ 现在按 pendingDeps 实际为空/非空分两句，**两边都不许撒谎**。
    const stillPending = depIds.filter((id) => pendingDeps.includes(id));
    const doneDeps = depIds.filter((id) => !pendingDeps.includes(id));
    return {
      ...base,
      standing: 'work',
      reason:
        stillPending.length === 0
          ? `有活干：后态判据红 ${satisfaction.failed} 条，主体落在节点 ${doneDeps.join(' / ')} 上，` +
            `但它们**已有 done 的卡** ⇒ 不构成「等依赖」（红是旧判据/漂移，要本卡处置）`
          : `有活干：后态判据红 ${satisfaction.failed} 条，其中 ${orphan} 条**不对应任何设计节点**（本卡该处置）；` +
            `另有红落在**未完成**节点 ${stillPending.join(' / ')} 上（那部分领了也改不动，但本卡不是"纯等它"）` +
            (doneDeps.length > 0 ? `；还有 ${doneDeps.length} 个节点（${doneDeps.join(' / ')}）已 done，其红是旧判据/漂移` : ''),
    };
  }
  return {
    ...base,
    standing: 'work',
    reason:
      `有活干：后态判据红 ${satisfaction.failed} 条，主体**不对应任何设计节点**（orphan_path）` +
      ` ⇒ 没有"该等谁"，按本卡有活处置`,
  };
}

/**
 * ★★ **"可领"谓词**（`claim` 侧唯一的读法）：`work` 与 `violated` 都可领。
 * ★ 只此一处允许把"哪几个值算可领"写出来 —— 调用方**不许**自己写 `=== 'work'`。
 */
export function isClaimable(standing: CardStanding): boolean {
  return standing === 'work' || standing === 'violated';
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
export async function isSatisfied(card: TaskSpec, opts: StandingInput): Promise<SatisfactionVerdict> {
  const verdict = await cardStanding(card, opts);
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

/** 一条迁移（`guard.clauses` 是**人读判据**；机器可判的那部分由本模块的函数实现）。 */
export interface TaskTransition {
  id: string;
  from: TaskState;
  to: TaskState;
  /**
   * ★ `false` ⇒ **本笔没有实现它**，`applicableTransitions` 不会返回它。
   *   用到它的唯一情形是被未决项挡住（见 `blocked_by_open_question`）。
   */
  enabled: boolean;
  guard: {
    clauses: readonly string[];
    /** ★ 该迁移被哪条未决项挡住（未结题 ⇒ 不许启用） */
    blocked_by_open_question?: string;
  };
}

/**
 * ★★ **迁移表**（唯一住处；读处见 {@link applicableTransitions}）。
 *
 * ★ `t_done_from_candidate`（`candidate → done`）带 `blocked_by_open_question: 'OQ1'`
 *   ⇒ **`enabled: false`**：设计 DSL 明写"仅当 OQ1 裁定为『自动收口』才允许存在；否则此迁移必须不存在"，
 *   而 OQ1 **用户尚未拍** ⇒ ★ **本笔不实现它**（没有任何代码路径会执行它）。
 *   ★ 它留在表里 = 让"被未决项挡住的迁移"**可见**（否则"少了一条迁移"与"没想到"分不清）。
 */
export const TRANSITIONS: readonly TaskTransition[] = [
  {
    id: 't_claim',
    from: 'candidate',
    to: 'claimed',
    enabled: true,
    guard: {
      clauses: [
        'isClaimable(cardStanding(card)) === true（★ 取五值里的 work / violated 两格 —— 有活干、或有违约要拆）',
        '★ 按期望自带的 phase 分区（phase=post 供满足度，phase=pre 供违约轴）后：work = 后态有本节点的红；violated = 后态全过 ∧ 前态有红',
        '★ satisfied 不在可领之列（没活干不许领）；blocked / unknowable 都拒（依赖未做 / 判不了）',
        'target 在 DB 存在（不存在则走 t_void）',
        'CAS：state=candidate ∧ owner IS NULL 时才写 owner（changes === 1）',
      ],
    },
  },
  {
    id: 't_void',
    from: 'candidate',
    to: 'void',
    enabled: true,
    guard: {
      clauses: ['target 在 DB 查不到（files / edges 任一查无此 target）'],
    },
  },
  {
    id: 't_release',
    from: 'claimed',
    to: 'candidate',
    enabled: true,
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
    enabled: true,
    guard: {
      clauses: [
        'owner !== null（★ 必须已领）',
        'isSatisfied(card) === true（= cardStanding === \'satisfied\'：后态全过 ∧ 前态无红；★ 与 t_claim 的谓词**不是同一个**）',
        'validateProgressEvidence 过（★ 复用既有证据闸，不新造第二把尺）',
      ],
    },
  },
  {
    id: 't_done_from_candidate',
    from: 'candidate',
    to: 'done',
    // ★★ OQ1 未拍 ⇒ 不实现（设计 DSL 逐字："否则此迁移必须不存在"）
    enabled: false,
    guard: {
      blocked_by_open_question: 'OQ1',
      clauses: [
        '仅当 OQ1 裁定为「自动收口」才允许存在；否则此迁移必须不存在',
        '即便允许，也只能由 patrol drift 的 missed_close **提示**，不得由 patrol 直接置 done',
      ],
    },
  },
  {
    id: 't_supersede',
    from: 'candidate',
    to: 'superseded',
    enabled: true,
    guard: {
      clauses: ['新卡带 replaces: <old_id>，且 old_id 在卡集里存在'],
    },
  },
];

/**
 * 某个状态**此刻可走**的迁移（★ 读处：`enabled:false` 的与终态出发的一律不返回）。
 *
 * ★ 为什么要有它，而不是让调用方自己 `TRANSITIONS.filter(...)`：
 *   漏掉 `enabled` 这一条判断 ⇒ **被 OQ1 挡住的 `candidate → done` 会被当成可走**
 *   ⇒ 那正是设计 DSL 要防的"未领就被收口"。判据只住一处。
 */
export function applicableTransitions(from: TaskState): TaskTransition[] {
  return TRANSITIONS.filter((t) => t.enabled && t.from === from);
}
