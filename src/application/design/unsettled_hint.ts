/**
 * unsettled_hint.ts —— **edit_dsl 回执里的「核销提示」**（销账三层机制的 L2）
 *
 * ## 它回答的唯一问题
 * 「这一批设计册改动**碰到了哪些还开着的卡**？」—— 让"改完册就走"的人当场看见
 * 「你刚动的这个节点上还挂着 claimed 卡 / 它的租约已经僵了」，从而要么去收口、要么去释放。
 *
 * ## ★★★ 为什么住这里（不搬进 `cascade.ts`）
 * ① `cascade.ts` 的入参只有 `(root, feature, ops)` —— **拿不到卡**（卡住 `.agent-io/design/<f>.dsl.json`
 *    的 `todos[]` / 节点 `task`，要另读一次池）⇒ 硬塞进去就得给它开第二个读取口；
 * ② **一个函数不答两个问题**：cascade 答"三个文档产物刷新了没有"，本文件答"有没有卡挂在你改的地方"；
 *    两者失败语义也不同（cascade 抛错要响亮警告但不阻断；本文件读不到池只出一行"判不了"）；
 * ③ ★ D4-9 刚把 cascade 收口（root 空串必须 skip、不许落回宿主 cwd），**本轮不动它**。
 * 放在 handlers 同族旁（`design/unsettled_hint.ts`）而不是 handlers.ts 里内联：handlers.ts 已 57KB，
 * 且这一段要能被**不启动 handler** 的测试直接咬。
 *
 * ## 三条硬边界（写在判据里，不是注释里）
 * ① **不跑 `judgeExpectations`**（90–105s 热路径禁入）⇒ 只给**事实行**：谁挂着 / 挂多久 / 闸在哪；
 *    输出里**不出现** `satisfied` / `can-close` / 「可以收口了」这类**结论词**（那要 judge 才敢说）。
 * ② **无内容不输出**（`cascade.ts#renderCascade` 的 `''` 惯例）：本批 ops 没碰到节点、或碰到的节点上
 *    **没有**非终态卡 ⇒ 返回 `''`（不刷噪声 —— 0.16：宁可少一行，也不许让人习惯性忽略它）。
 * ③ **判不了必须出声**：池读不到 ⇒ 出一条「判不了」行（**不许静默省略**，那会把"看不到"读成"没有"）。
 *
 * ## 租约口径（★ 不写死）
 * `overdue` 这一格**不是**本文件算的：它由 `board/pool#listPool` 调 `domain/task_machine#isLeaseExpired`
 * 得出，TTL = `LEASE_TTL_MS`（**env 口径**：`AGENT_IO_LEASE_TTL_MINUTES` / `AGENT_IO_LEASE_TTL_HOURS`）。
 * 本文件只**引用** `LEASE_TTL_MS` 把它印在回执上（"闸在哪"），**一个数字都不自己写**。
 */

import { listPool, type BoardView, type PoolCard } from './board/pool.js';
import { LEASE_TTL_MS } from '../../domain/task_machine.js';
import { isClosedTaskState } from '../../domain/task_schema.js';

/**
 * 「这个 op 的 `id` 就是**节点 id**」的那几类 —— ★ 口径照抄 `dsl_ops/update_feature#touchedNodeIds`
 * （`node` / `binding` / `status` / `task`；`decision` 的 id 可能是路径，需要解析，这里不收）。
 * ★ 为什么不 import 那个函数：它没导出，且它要 `UpdateFeatureInput` + 回读 DSL（落定后才准）；
 *   本文件要的是**本批 ops 声明的**目标，不是"落定后还在的节点"（后者会把 op=delete 的节点剔掉，
 *   而"删了节点却把卡留在 claimed"恰恰是最该被看见的一种）。
 */
const NODE_ID_OPS = new Set(['node', 'binding', 'status', 'task']);

/** 本批 ops 命中的节点 id（含 `todo` 卡 `data.node_id` 指向的节点） */
export function hitNodeIdsOf(
  operations: ReadonlyArray<{ type?: string; id?: string; data?: Record<string, unknown> }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: unknown): void => {
    if (typeof id !== 'string' || !id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const op of operations) {
    const type = String(op.type ?? '');
    if (NODE_ID_OPS.has(type)) add(op.id);
    // ★ todo 卡住在 `todos[]` 里，但它若指向某节点（`data.node_id`）就等于"碰到了那个节点"
    else if (type === 'todo') add(op.data?.['node_id']);
  }
  return out;
}

export interface UnsettledHintInput {
  feature: string;
  operations: ReadonlyArray<{ type?: string; id?: string; data?: Record<string, unknown> }>;
  nowMs?: number;
  /** 池读端（默认 `board/pool#listPool`；★ 测试的唯一注入点） */
  readPool?: (feature: string, nowMs: number) => BoardView;
}

/** 年龄一格（小时，1 位小数）；判不了 ⇒ `—`（★ 不印 `0h`：那会把"不知道"说成"刚领"） */
function ageText(c: PoolCard): string {
  return c.age_hours === null ? '—（无 claimed_at）' : `${c.age_hours}h`;
}

/** 一张卡的一行人读：谁 / 什么状态 / 挂了多久 */
function cardText(c: PoolCard): string {
  return `${c.id}(${c.state} · ${c.owner ?? '无主'} · ${ageText(c)})`;
}

/**
 * 渲染「核销提示」段（`''` = 这一批没有可提示的内容）。
 * ★ 返回的是**回执行**（以 `\n` 开头，与 `renderCascade` 同一惯例）⇒ 调用方只做字符串拼接。
 */
export function renderUnsettledHint(input: UnsettledHintInput): string {
  const ids = hitNodeIdsOf(input.operations);
  if (!ids.length) return ''; // ★ 本批没碰到节点 ⇒ 这一行没有任何信息（0.16）
  const nowMs = input.nowMs ?? Date.now();
  const readPool = input.readPool ?? listPool;
  const ttlMin = Math.round(LEASE_TTL_MS / 60_000);
  const head = '\n── 核销提示（只报，不代判）──';
  const pointer = `  · 判「能不能收口」：**design_line action=judge**（判据现判）→ 能收就 **edit_dsl {type:'task',op:'complete'}**`;

  let pool: BoardView;
  try {
    pool = readPool(input.feature, nowMs);
  } catch (e) {
    // ★ 判不了 ⇒ 必须出声（不许静默省略：那会把"看不到"读成"没有卡挂着"）
    return [head, `  ★ 判不了：读不到池（${(e as Error).message.slice(0, 120)}）—— 本批改到的节点上**还挂着什么卡，这一轮看不到**`, pointer].join('\n');
  }

  const byId = new Map(pool.cards.map((c) => [c.id, c]));
  const hit = ids.map((id) => byId.get(id)).filter((c): c is PoolCard => !!c);
  const open = hit.filter((c) => !isClosedTaskState(c.state));
  if (!open.length) return ''; // ★ 到了节点上却没有开着的卡 ⇒ 无内容（干净的册不刷噪声）

  const shown = open.slice(0, 6);
  const more = open.length - shown.length;
  const overdue = open.filter((c) => c.overdue);
  const lines: string[] = [
    head,
    `  · 本批改动触及 ${ids.length} 个节点，其中 ${open.length} 个挂着非终态卡：` +
      shown.map(cardText).join(' · ') +
      (more > 0 ? ` · …… 另有 ${more} 张` : ''),
    overdue.length
      ? `  · 超租约（${ttlMin} 分钟 = AGENT_IO_LEASE_TTL_MINUTES 口径）：` +
        overdue.slice(0, 4).map(cardText).join(' · ') +
        ` ⇒ 别人可 claim 接管；不打算做了就 edit_dsl {type:'task',op:'release'} 显式销账`
      : `  · 超租约：0 / ${open.length} 张（${ttlMin} 分钟口径）`,
    pointer,
  ];
  return lines.join('\n');
}
