/**
 * P0 · **edit_dsl 回执的「核销提示」**（销账三层机制的 L2：`src/application/design/unsettled_hint.ts`）
 *
 * ## 它守的是哪条规则
 * 「改完册就走」是本仓最贵的一种静默：**你动了某个节点，那上面还挂着一张 claimed 卡**，
 * 而回执里一个字都不提 ⇒ 下一个人只能靠"想起来去 `get_dsl query=todo`"才发现。
 * 本证锁这条提示的四件事：
 * ① **干净册不刷噪声**：本批没碰节点 / 碰到的节点上没有非终态卡 ⇒ 返回 `''`（0.16：宁可少一行）；
 * ② **点名 + 带分母**：「N 个节点，其中 M 个挂着非终态卡」，每张卡给 `state · owner · age`；
 * ③ **只报事实行**：不出现 `satisfied` / `can-close` / 「已满足」这类**结论词**（判"能不能收口"要 `judge`，
 *    90–105s 的热路径禁入）；
 * ④ **判不了必须出声**：池读不到 ⇒ 一条「判不了」行（**不许静默省略** —— 那会把"看不到"读成"没有"）。
 *
 * ## 租约那一格的口径（★ 别在这里重新发明）
 * `overdue` 由 `board/pool#listPool` 调 `domain/task_machine#isLeaseExpired` 得出，TTL = `LEASE_TTL_MS`
 * （**env 口径**：`AGENT_IO_LEASE_TTL_MINUTES` / `AGENT_IO_LEASE_TTL_HOURS`）。本证的 ③ 用
 * `LEASE_TTL_MS ± 1min` 造反例 ⇒ **谁把 TTL 写死成 2h/24h，这一条立刻红**。
 *
 * ## 消融
 * 把 `renderUnsettledHint` 里 `if (!open.length) return '';` 删掉 ⇒ ① 组红（干净册开始刷噪声）；
 * 把 `try { pool = readPool(…) } catch { … }` 的 catch 改成 `return ''` ⇒ ④ 组红（判不了被静默吞掉）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hitNodeIdsOf, renderUnsettledHint } from '../src/application/design/unsettled_hint.js';
import { LEASE_TTL_MS, isLeaseExpired } from '../src/domain/task_machine.js';
import type { BoardView, PoolCard } from '../src/application/design/board/pool.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 一张池里的卡（只填本证用得到的字段；其余按 `PoolCard` 的形状给缺省） */
function card(over: Partial<PoolCard> & { id: string; state: PoolCard['state'] }): PoolCard {
  return {
    source: 'todo',
    label: over.id,
    owner: null,
    claimed_at: null,
    age_hours: null,
    overdue: false,
    read_set: null,
    ...over,
  } as PoolCard;
}
const poolOf = (cards: PoolCard[]): BoardView => ({
  byState: {} as BoardView['byState'],
  total: cards.length,
  shown: cards.length,
  folded: 0,
  archived: 0,
  bySource: { node: cards.length, todo: 0 },
  cards,
});
const render = (over: Partial<Parameters<typeof renderUnsettledHint>[0]> = {}): string =>
  renderUnsettledHint({
    feature: 'f',
    operations: [{ type: 'node', op: 'update', id: 'n_a' }],
    nowMs: Date.parse('2026-11-16T12:00:00.000Z'),
    readPool: () => poolOf([card({ id: 'n_a', state: 'claimed', owner: 'workbuddy', age_hours: 0.4 })]),
    ...over,
  });

// ════════════════════════════════════════════════════════════════════
// ① 无内容不输出（不刷噪声）
// ════════════════════════════════════════════════════════════════════
test('① 干净册 / 没碰节点 ⇒ 返回空串（本批不该为"没有欠账"付一行回执）', () => {
  // 本批 ops 完全不含节点 id（snapshot / layout 之类）
  assert.equal(render({ operations: [{ type: 'snapshot', op: 'save', id: 'snap_1' }] }), '');
  assert.equal(hitNodeIdsOf([{ type: 'snapshot', op: 'save', id: 'snap_1' }]).length, 0);

  // 到了节点上，但那上面的卡已经了结（done / void）⇒ 也没有可提示的
  assert.equal(
    render({ readPool: () => poolOf([card({ id: 'n_a', state: 'done', owner: 'x', age_hours: 3 })]) }),
    '',
    '卡已了结还提示 ⇒ 这行会变成永远亮的灯（0.16）',
  );
  // 节点在册里但压根没有卡
  assert.equal(render({ readPool: () => poolOf([]) }), '');
});

// ════════════════════════════════════════════════════════════════════
// ② ops 命中 claimed 卡 ⇒ 点名 + 分母 + age
// ════════════════════════════════════════════════════════════════════
test('② 命中非终态卡 ⇒ 点名 id / state / owner / age，且给"N 个节点里 M 个"的分母', () => {
  const out = render({
    operations: [
      { type: 'node', op: 'update', id: 'n_a' },
      { type: 'task', op: 'claim', id: 'n_b' },
      { type: 'todo', op: 'add', data: { node_id: 'n_c' } },
      { type: 'edge', op: 'update', id: 'e_1' }, // 边 → 不是节点
    ],
    readPool: () =>
      poolOf([
        card({ id: 'n_a', state: 'claimed', owner: 'workbuddy', age_hours: 0.4 }),
        card({ id: 'n_b', state: 'candidate' }),
        // n_c 没有卡
      ]),
  });
  assert.match(out, /── 核销提示（只报，不代判）──/);
  assert.match(out, /本批改动触及 3 个节点，其中 2 个挂着非终态卡/, '分母（触及几个）与分子（几个挂着）都要给');
  assert.match(out, /n_a\(claimed · workbuddy · 0\.4h\)/);
  assert.match(out, /n_b\(candidate · 无主 · —（无 claimed_at）\)/, '没有 claimed_at ⇒ 印 "—"，不印 0h');
  assert.doesNotMatch(out, /e_1/, '边的 id 不是节点 —— 不许当成"碰到的节点"');
  assert.match(out, /超租约：0 \/ 2 张/);
  assert.match(out, /design_line action=judge/);
  assert.match(out, /edit_dsl \{type:'task',op:'complete'\}/);

  // ③ 只报事实行：没有结论词
  assert.doesNotMatch(out, /satisfied|can[-_]?close|已满足|判据全过/);
});

// ════════════════════════════════════════════════════════════════════
// ③ 超租约：TTL 用 env 口径（★ 写死就红）
// ════════════════════════════════════════════════════════════════════
test('③ 超租约：判据是 `isLeaseExpired` + `LEASE_TTL_MS`（env 口径），本文件里没有写死的 TTL', () => {
  const now = Date.parse('2026-11-16T12:00:00.000Z');
  const at = (ms: number): string => new Date(now - ms).toISOString();
  // 边界用 `LEASE_TTL_MS` 本身 ⇒ 换 `AGENT_IO_LEASE_TTL_MINUTES` 后这一条照样成立（且写死 2h/24h 会红）
  const justOver = { id: 'n_a', state: 'claimed' as const, claimed_at: at(LEASE_TTL_MS + 60_000) };
  const justUnder = { id: 'n_a', state: 'claimed' as const, claimed_at: at(LEASE_TTL_MS - 60_000) };
  assert.equal(isLeaseExpired(justOver as never, now), true, `超 ${LEASE_TTL_MS / 60000} 分钟 + 1 分钟 ⇒ 必须判过期`);
  assert.equal(isLeaseExpired(justUnder as never, now), false, `差 1 分钟 ⇒ 不许判过期（边界的另一半）`);

  const overdueOut = render({
    nowMs: now,
    readPool: () =>
      poolOf([card({ id: 'n_a', state: 'claimed', owner: 'ghost', age_hours: 3, claimed_at: at(LEASE_TTL_MS + 60_000), overdue: true })]),
  });
  assert.match(overdueOut, /超租约（\d+ 分钟 = AGENT_IO_LEASE_TTL_MINUTES 口径）：n_a/);
  assert.match(overdueOut, /claim 接管|release/);

  const freshOut = render({
    nowMs: now,
    readPool: () => poolOf([card({ id: 'n_a', state: 'claimed', owner: 'alive', age_hours: 0.1, claimed_at: at(60_000), overdue: false })]),
  });
  assert.match(freshOut, /超租约：0 \/ 1 张/);

  // 结构判据：TTL 只能从 `LEASE_TTL_MS` 来（不许在本文件里另立一个数）
  const src = fs.readFileSync(path.join(REPO, 'src/application/design/unsettled_hint.ts'), 'utf8');
  assert.match(src, /LEASE_TTL_MS/, 'TTL 必须引用 domain 那一个常量（env 口径）');
  assert.doesNotMatch(src, /\b(600_000|3_600_000|3600000)\b/, '★ 不许出现写死的 TTL 毫秒数');
  assert.doesNotMatch(src, /LEASE_TTL_MS\s*=/, '★ 不许在本文件里重新定义 TTL');
});

// ════════════════════════════════════════════════════════════════════
// ④ 判不了必须出声
// ════════════════════════════════════════════════════════════════════
test('④ 池读不到 ⇒ 出"判不了"行（不许静默省略：那会把"看不到"读成"没有卡"）', () => {
  const out = render({
    readPool: () => {
      throw new Error('feature "no-such" 不存在 ⇒ 读不到池');
    },
  });
  assert.notEqual(out, '', '判不了却返回空串 ⇒ 读者会以为"这里没有卡"');
  assert.match(out, /判不了/);
  assert.match(out, /读不到池/);
  assert.match(out, /no-such/, '判不了的原因要点名到**哪个 feature**（可定位）');
  assert.match(out, /design_line action=judge/, '判不了也照样给"怎么判"的指针');
});

// ════════════════════════════════════════════════════════════════════
// ⑤ handlers 接线：落在 cascade 之后、两个返回点零改动（静态读法，如实声明）
// ════════════════════════════════════════════════════════════════════
test('⑤ 接线形状：提示在 cascade 的 try/catch **之后**（级联抛错时照样出），两个返回点未改', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/application/design/handlers.ts'), 'utf8');
  const handlerAt = src.indexOf('export const editDslHandler');
  const cascadeCatchAt = src.indexOf('级联跑不了');
  const hintAt = src.indexOf('renderUnsettledHint(');
  assert.ok(handlerAt > 0, 'edit_dsl 的 handler 不见了');
  assert.ok(cascadeCatchAt > handlerAt, 'cascade 的 catch 不在 edit_dsl handler 里 ⇒ 本证的前提变了');
  assert.ok(hintAt > cascadeCatchAt, '★ 核销提示必须在 cascade 的 try/catch **之后**：级联抛错时它照样要出');
  // 两个返回点（`notIndexed` 为空 / 非空）仍然是"拼 cascadeNote"那两处 —— 本轮**零改动**
  const returns = src.match(/result\.message \+ cascadeNote/g) ?? [];
  assert.ok(returns.length >= 2, `两个返回点必须仍然拼 cascadeNote（实得 ${returns.length} 处）`);
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 不跑 judge（热路径禁入）—— 结构判据
// ════════════════════════════════════════════════════════════════════
test('⑥ 热路径禁入 `judgeExpectations`（90–105s）：提示渲染只读池 + 事实，不重判判据', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/application/design/unsettled_hint.ts'), 'utf8');
  // ★ 只看**代码**：注释里出现「不跑 judgeExpectations」正是这条纪律的说明（拿全文匹配会把说明当成违规）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
  assert.doesNotMatch(code, /judgeExpectations|isSatisfied|cardStanding/, '只报事实行的提示不许把判定器拖进回执热路径');
});
