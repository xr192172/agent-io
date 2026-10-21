/**
 * task_drift.ts —— **漂移巡检**（live 每次重算后跑）。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的节点
 * `file_src_application_patrol_task_drift_ts`（`decision.summary` 逐字）：
 * 「live 重算后对所有非 done 的卡跑 judgeExpectations ⇒ 抓「漏收口」与「应转失效」」。
 * 同节点的 `decision.acceptance`：「两类异常都有计数出口；红时给出卡 id」。
 *
 * ## 为什么它只"报"，不"改"
 * 收口/失效是**状态迁移**，唯一合法写端是 `edit_dsl {type:'task'}`（`task_ops.ts` 文件头）。
 * 巡检若自己把卡改成 done/void，就是**第二处权威** —— 本 DSL 的 invariant 明写「一处权威 + 一处渲染」。
 * ⇒ 本文件**纯读**：产出 `DriftReport`（机器可读），由榜单/人来决定下一步动作。
 *
 * ## 输入为什么必须经 `renderLiveFromDb`
 * 巡检判的是"**此刻的代码**"与卡片判据之间的差。live 视图是"从 DB 现渲染的实际图"，
 * 它同时给出两样本文件不该自己拼的东西：
 *   · 扫描面（哪些节点在 live 里还有）—— 设计侧有卡、live 里没有 ⇒ `vanished`（应转失效的候选）；
 *   · 唯一性（本仓不许再造第三个"读 DB 拼图"的入口）。
 * `renderLiveFromDb` 返回 `null` 时**不判**（无 live 图 ⇒ 判不了，不把"读不到"读成"没有漂移"）。
 *
 * ## 判据分工（★ 两遍不是重复，是两个问题）
 *   · `judgeExpectations` —— 回答「**哪条判据红了**」（报告要能点名，计数不够）；
 *   · `isSatisfied`（`task_machine`）—— 回答「**这张卡该收口了吗**」（状态判据只许经状态机）。
 * ★ 若把后者简化成"后态全过"，就会放行 `violated` 卡（前态越权）—— 那是 `t_done_from_claimed` 明令禁止的。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDesignSheet } from '../../infrastructure/storage.js';
import { renderLiveFromDb } from '../../infrastructure/index/live_render.js';
import { scanRevOf, type ScanRev } from '../../infrastructure/index/scan_rev.js';
import { judgeExpectations } from '../design/intent/expectations.js';
import { isSatisfied, releaseIfExpired, type CardStanding, type LeaseReleaseEvent } from '../../domain/task_machine.js';
import { expectationsOf, isClosedTaskState, type TaskSpec, type TaskState } from '../../domain/task_schema.js';
import { expectationPhase } from '../../domain/expectation.js';

/** 一条红判据的**点名**（不是计数 —— 计数说不出"哪条"）。 */
export interface DriftRed {
  kind: string;
  /** 人话：为什么红（判定器原样细节） */
  detail: string;
}

/** 单卡读数。 */
export interface DriftCard {
  id: string;
  state: TaskState;
  standing: CardStanding;
  /** 后态判据的红（★ 这是"有活干"的那一侧） */
  red: DriftRed[];
  /** 前态判据的红（★ 违约侧：`violated` 的来源） */
  violation_red: DriftRed[];
  /** 判不了的条数（★ 既不算过也不算不过 —— 不许并进红，也不许并进绿） */
  unsupported: number;
}

/**
 * ★ 机器可读出口（`decision.expectations` 的 `symbol-exists DriftReport`）。
 * 全部字段可 JSON 序列化；本文件**不打印、不落盘**。
 */
export interface DriftReport {
  feature: string;
  root: string;
  /** 报告铸上的扫描版本（`scanRevOf`）—— 没有它就会拿旧实际判红 */
  scan_rev: ScanRev;
  /** 判定时刻（epoch ms，调用方显式传入 ⇒ 可复现） */
  scanned_at: number;
  ttl_ms: number;
  /** live 里的节点数（扫描面大小；读不到 live 时为 0） */
  live_nodes: number;
  cards: DriftCard[];
  /** ★ 异常一：**漏收口**（状态机判可收口，但卡不在终态）—— 给卡 id */
  missed_close: string[];
  /** ★ 异常二：**应转失效**（前态违约 / 设计侧有卡而 live 里已无该节点）—— 给卡 id */
  should_void: string[];
  /** 设计侧有卡、live 图里已无对应节点（`should_void` 的一种来源，单列以便对账） */
  vanished: string[];
  /** TTL 租约过期事件（`releaseIfExpired` 原样产出；★ 只是事件，不改 state） */
  expired: LeaseReleaseEvent[];
  /**
   * ★★★ 2026-10-18（todos 的读端）：**预决策待人设计** —— todo 有 `node_id`（指向某节点）
   * 但还 `candidate`（没人领）⇒ 那个节点的设计"该改还没改"。
   * ★ 它是 todo.link 写进 `node_id` 之后的**唯一读端** —— 没它，"指向"就没人看得见。
   */
  pending_design: { node_id: string; todos: string[] }[];
  /** 判不了的原因（`null` = 判了） */
  unavailable: string | null;
}

export interface PatrolOptions {
  /** 被分析项目根（`judgeExpectations` 读代码 / 索引的锚点） */
  root: string;
  /** 判定时刻（epoch ms；★ 显式传入，不在函数里取 now） */
  now_ms: number;
  /** 租约时长（★ 取值待裁 —— 本文件不写死默认值，见 `task_machine.releaseIfExpired`） */
  ttl_ms: number;
}

/**
 * 巡检入口（★ 唯一）：对所有**非终态**的卡跑判定器，产出一份 `DriftReport`。
 *
 * 判不了的情形（都返回 `unavailable` 而非空报告）：live 图读不到 / 设计 DSL 读不到。
 */
export async function patrolDrift(feature: string, opts: PatrolOptions): Promise<DriftReport> {
  const report: DriftReport = {
    feature,
    root: opts.root,
    // ★ 先铸扫描版本：报告上的每个读数都属于这一刻
    scan_rev: scanRevOf({ feature, sourceRoot: opts.root }),
    scanned_at: opts.now_ms,
    ttl_ms: opts.ttl_ms,
    live_nodes: 0,
    cards: [],
    missed_close: [],
    should_void: [],
    vanished: [],
    expired: [],
    pending_design: [],
    unavailable: null,
  };

  // ── 1. 输入 = live 图（★ 唯一来源）。读不到 ⇒ 判不了，不造空图 ──
  const live = renderLiveFromDb(feature);
  const design = getDesignSheet(feature); // ★ 2026-10-18：读【设计侧】—— 卡在 design/ 上（不是派生 features/）
  if (!live) {
    report.unavailable = `feature "${feature}" 的 live 图读不到（无 source_root / 无 cache.db / 库里查不到源文件）⇒ 判不了漂移`;
    return report;
  }
  if (!design) {
    report.unavailable = `feature "${feature}" 的设计 DSL 读不到 ⇒ 没有卡可巡`;
    return report;
  }
  report.live_nodes = (live.geometry.nodes ?? []).length;
  const liveIds = new Set((live.geometry.nodes ?? []).map((n) => n.id));

  // ── 2. 卡 = 设计侧节点上的 task 格；只巡**非终态** ──
  // ★ 同时记住"卡 → 该节点的 path"：判 `vanished` 要读**盘上的事实**，不能只读 live 图
  //   （live 图可能是旧索引 ⇒ 新文件"不在图里"但**在盘上**，那是索引陈旧，不是节点消失）。
  const cards: TaskSpec[] = [];
  const pathByCard = new Map<string, string>();
  /** card.id → 它挂的那个节点 —— ★ 判据从这里的 `decision.expectations` 现取（任务格不自持） */
  const nodeByCard = new Map<string, (typeof design.geometry.nodes)[number]>();
  for (const n of design.geometry.nodes ?? []) {
    if (!n.task) continue;
    cards.push(n.task);
    nodeByCard.set(n.task.id, n);
    const p = (n as { path?: string }).path;
    if (p) pathByCard.set(n.task.id, p);
  }
  // ★ 2026-10-20：`isTerminalTaskState` → `isClosedTaskState` —— done/void 都能被重开/重生，
  //   所以这里问的不是"能不能迁移"，而是"这张卡还开着吗"（已了结的不判、不报 missed_close）。
  const open = cards.filter((c) => !isClosedTaskState(c.state));

  // ── 3. 判定器：一次批量，把"哪条判据红"点名出来（★ 判据只有这一把尺） ──
  const items = open.flatMap((c) =>
    expectationsOf(nodeByCard.get(c.id)).map((e) => ({ node_id: c.id, node_label: c.summary, expectation: e })),
  );
  const judged = await judgeExpectations(opts.root, items);
  const redBy = new Map<string, { post: DriftRed[]; pre: DriftRed[]; unsupported: number }>();
  for (const it of judged.items) {
    const bucket = redBy.get(it.node_id) ?? { post: [], pre: [], unsupported: 0 };
    const isPre = expectationPhase(it.expectation) === 'pre';
    if (it.verdict === 'fail') {
      const red: DriftRed = { kind: it.expectation.kind, detail: it.detail };
      (isPre ? bucket.pre : bucket.post).push(red);
    } else if (it.verdict === 'unsupported') {
      bucket.unsupported += 1;
    }
    redBy.set(it.node_id, bucket);
  }

  // ── 4. 状态机：回答"该收口了吗 / 违约了吗"（★ 状态判据只许经状态机） ──
  // ★ `Node` 类型没声明 `path`（设计 DSL 里却普遍用 `path`）⇒ 这里按结构读它，不新增字段。
  const standingNodes = (design.geometry.nodes ?? []).map((n) => ({
    id: n.id,
    path: (n as { path?: string }).path,
    task: n.task,
  }));
  for (const card of open) {
    const bucket = redBy.get(card.id) ?? { post: [], pre: [], unsupported: 0 };
    // ★ 2026-10-21（D-judge-port）：判定器**注入**进状态机（domain 不再向上 import application）——
    //   本文件已经 import 了同一个 `judgeExpectations`（上面那一次批量判定用的就是它），所以注入的
    //   与批量判定**是同一把尺**（不是另起一个实现）。
    const verdict = await isSatisfied(card, expectationsOf(nodeByCard.get(card.id)), {
      root: opts.root,
      nodes: standingNodes,
      judge: judgeExpectations,
    });
    report.cards.push({
      id: card.id,
      state: card.state,
      standing: verdict.standing,
      red: bucket.post,
      violation_red: bucket.pre,
      unsupported: bucket.unsupported,
    });

    // ★ 异常一：漏收口 —— 状态机说"可收口"，卡却还没进终态
    // ★★★ 2026-10-18（Q3）：**只在 claimed 时报** —— candidate 的卡"满足"是【正常】的
    //   （还没人领，不该收口；它要么该被领，要么该被作废）。此前不看 state ⇒ 把"代码先于卡存在"
    //   的 candidate 卡也报成漏收口 ⇒ 那是今天死锁的来源之一。
    if (verdict.satisfied && card.state === "claimed") report.missed_close.push(card.id);
    // ★ 而 candidate + satisfied ⇒ **活已在代码里，卡是多余的** ⇒ 该作废（不是漏收口）
    else if (verdict.satisfied && card.state === "candidate") {
      if (!report.should_void.includes(card.id)) report.should_void.push(card.id);
    }
    // ★ 异常二：违约 —— 前态判据被越权（收口不能放行它）
    if (verdict.standing === 'violated') report.should_void.push(card.id);
    // ★ 异常二（另一来源）：设计侧有卡，**盘上也没有**该文件 ⇒ 目标真不在了
    //   ★★ 判据必须是"盘上不在"（`fs.existsSync`），不是"live 图里不在"：
    //   live 图读索引，新文件还没进索引时"不在图里"但**在盘上** ⇒ 那是索引陈旧，不是消失。
    const rel = pathByCard.get(card.id);
    const onDisk = rel ? fs.existsSync(path.join(opts.root, rel)) : undefined;
    if (!liveIds.has(card.id) && onDisk === false) {
      report.vanished.push(card.id);
      if (!report.should_void.includes(card.id)) report.should_void.push(card.id);
    }
  }

  // ── 4b. 预决策待人设计（★ todos 的 node_id 读端）──
  //   判据：todo 有 node_id（指向某节点）且 state 还 candidate（没人领）⇒ 那个节点的设计"该改还没改"。
  //   ★ 只看 candidate：claimed 说明有人在做；done/void 是终态。
  const pendingByNode = new Map<string, string[]>();
  for (const t of design.todos ?? []) {
    if (t.node_id && t.state === 'candidate') {
      if (!pendingByNode.has(t.node_id)) pendingByNode.set(t.node_id, []);
      pendingByNode.get(t.node_id)!.push(t.id);
    }
  }
  report.pending_design = [...pendingByNode.entries()].map(([node_id, todos]) => ({ node_id, todos }));

  // ── 5. 租约：只产出事件（★ 不静默改 state） ──
  report.expired = releaseIfExpired(cards, opts.now_ms, opts.ttl_ms);

  return report;
}
