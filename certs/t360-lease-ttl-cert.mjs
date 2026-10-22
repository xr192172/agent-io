#!/usr/bin/env node
/**
 * cert T360 —— **租约熔断**（2026-10-22 · 用户裁定）
 *
 * ## 用户原话（这张证存在的理由）
 * *「正常的互联网的租约不是过了一段时间会自己断掉的吗？也就是说 Agent 在对文件不再进行操作的情况下
 *   租约就应该断了…应该有一个这样的中断机制，熔断机制，要不然 agent 一直不回报，
 *   那岂不是任务一直卡别人的线程」*
 *
 * ## 它守的是什么（实测现场）
 * 2026-10-22 实测：**29 个文件节点被 10~27 小时前的租约锁着**，锁住 `write_gate.ts` / `edit_code.ts` /
 * `server_registry.ts` / `index/db.ts` / `parse/kernel.ts` ⇒ **整个仓改不动**（A7 一律拒）。
 * 而 `releaseIfExpired` 早就写好了、`scripts/patrol.mjs` 也能跑 —— 但 `ttl_ms` **从来没被定值**
 * （源码注释"取值待裁"）、patrol **不在 verify 里** ⇒ **判据在、函数在、就是没人触发**。
 *
 * ## 三条断言（★ 必须能分辨，不许恒真）
 * ① 3h 前领的卡 ⇒ **别人能接管**，且 task 上有 `taken_over_from`（旧 owner / 旧 claimed_at / age≈3h）
 * ② 刚领的卡   ⇒ 别人 claim **被拒**（租约未到期，不许抢）
 * ③ 自己重复领 ⇒ **也被拒**（否则等于靠 claim 刷新租约，熔断永远看不见停工）
 *
 * ## 不碰真册
 * 把真册 **copy 到临时 home** 再跑（`AGENT_IO_HOME` 在动态 import 之前设），跑完临时目录留着不删
 * （宿主有"每回合 50 次删除"的闸，见 `t351` 同款注释）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp360-'));
const HOME = path.join(TMP, 'home');
const SRC = path.join(REPO, '.agent-io/design');

// ★ 把真册整片 copy 过去（设计册 + overlay 都在里面）
fs.cpSync(SRC, path.join(HOME, '.agent-io/design'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

const P = path.join(HOME, '.agent-io/design/task-system-plan.dsl.json');
const { applyTaskOp } = await import('file://' + REPO.replace(/\\/g, '/') + '/dist/src/application/design/dsl_ops/task_ops.js');
const { isLeaseExpired, leaseAgeHours, LEASE_TTL_MS } = await import('file://' + REPO.replace(/\\/g, '/') + '/dist/src/domain/task_machine.js');

let P_ = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  ok ? P_++ : F++;
};
const read = () => JSON.parse(fs.readFileSync(P, 'utf-8'));
const setClaimedAt = (id, iso, owner) => {
  const d = read();
  const t = (d.todos ?? []).find((x) => x.id === id);
  if (!t) throw new Error('找不到卡 ' + id);
  t.state = 'claimed';
  t.owner = owner;
  t.claimed_at = iso;
  fs.writeFileSync(P, JSON.stringify(d, null, 2));
};
const taskOf = (id) => ((read().todos ?? []).find((x) => x.id === id) ?? {});

console.log(`══ T360 · 租约熔断（TTL=${Math.round(LEASE_TTL_MS / 3.6e6)}h，可用 AGENT_IO_LEASE_TTL_HOURS 覆盖）══`);

const card = (read().todos ?? []).find((t) => t.state === 'candidate');
if (!card) throw new Error('夹具要求册里至少有一张 candidate 卡');
console.log('夹具卡:', card.id);

// ── ① 过期 ⇒ 可接管
console.log('\n════ ① 3h 前的租约 ⇒ 别人能接管 ════');
setClaimedAt(card.id, new Date(Date.now() - 3 * 3600_000).toISOString(), 'agent:stale-agent');
chk(isLeaseExpired({ state: 'claimed', claimed_at: taskOf(card.id).claimed_at }, Date.now()) === true, '①a isLeaseExpired 判 3h 为过期');
chk(leaseAgeHours({ claimed_at: taskOf(card.id).claimed_at }, Date.now()) >= 2.9, '①b leaseAgeHours ≈ 3');
let took = null;
try {
  took = await applyTaskOp('task-system-plan', { op: 'claim', id: card.id, data: { owner: 'agent:newcomer', reason: '租约已过期3h，接管验证' } }, 'agent:newcomer');
  chk(true, '①c claim 成功（接管）');
} catch (e) {
  chk(false, '①c claim 成功（实际被拒）', String(e.message).split('\n')[0].slice(0, 110));
}
const t1 = taskOf(card.id);
chk(t1.owner === 'agent:newcomer', '①d 新 owner 生效', `owner=${t1.owner}`);
chk(t1.taken_over_from?.from_owner === 'agent:stale-agent', '①e 接管痕迹记了旧 owner（不静默接手）', JSON.stringify(t1.taken_over_from));
chk(Math.abs((t1.taken_over_from?.age_hours ?? 0) - 3) < 0.2, '①f age_hours ≈ 3');

// ── ② 未到期 ⇒ 不许抢
console.log('\n════ ② 刚领的 ⇒ 别人不许抢 ════');
setClaimedAt(card.id, new Date().toISOString(), 'agent:fresh-owner');
chk(isLeaseExpired({ state: 'claimed', claimed_at: taskOf(card.id).claimed_at }, Date.now()) === false, '②a isLeaseExpired 判"刚领"为未过期');
try {
  await applyTaskOp('task-system-plan', { op: 'claim', id: card.id, data: { owner: 'agent:other', reason: '不该成功' } }, 'agent:other');
  chk(false, '②b 应被拒（实际成功 ✗ 熔断太松）');
} catch (e) {
  chk(/已经在办|未到期/.test(String(e.message)), '②b 被拒（租约未到期）', String(e.message).split('\n')[0].slice(0, 80));
}
chk(taskOf(card.id).owner === 'agent:fresh-owner', '②c owner 没被抢走');

// ── ③ 自己重复领 ⇒ 也拒（不许靠 claim 刷新租约）
console.log('\n════ ③ 自己重复领 ⇒ 也拒（不许刷新租约）════');
try {
  await applyTaskOp('task-system-plan', { op: 'claim', id: card.id, data: { owner: 'agent:fresh-owner', reason: '重复领' } }, 'agent:fresh-owner');
  chk(false, '③ 应被拒（实际成功 ✗ 会重置租约）');
} catch (e) {
  chk(/不幂等|已经在办/.test(String(e.message)), '③ 被拒（不重置租约）');
}

// ── ④ 反向对照：缺 claimed_at / 坏时间 ⇒ 不当过期（不许把"判不了"读成"没人占"）
console.log('\n════ ④ 判不了 ⇒ 不当过期（不静默放行）════');
chk(isLeaseExpired({ state: 'claimed' }, Date.now()) === false, '④a 缺 claimed_at ⇒ false');
chk(isLeaseExpired({ state: 'claimed', claimed_at: 'not-a-date' }, Date.now()) === false, '④b 坏时间 ⇒ false');
chk(isLeaseExpired({ state: 'candidate', claimed_at: new Date(0).toISOString() }, Date.now()) === false, '④c 非 claimed ⇒ false');

// ── ⑤ 续租：未过期 + 是自己的 ⇒ 成功，且计数 +1
console.log('\n════ ⑤ renew：续租是合法路径（与"重复 claim 被拒"不矛盾）════');
setClaimedAt(card.id, new Date(Date.now() - 30 * 60_000).toISOString(), 'agent:worker');
const t5a = taskOf(card.id);
let r5 = null;
try {
  r5 = await applyTaskOp('task-system-plan', { op: 'renew', id: card.id, data: { owner: 'agent:worker' } }, 'agent:worker');
  chk(true, '⑤a 自己的卡 + 未过期 ⇒ 续租成功');
} catch (e) {
  chk(false, '⑤a 续租成功（实际被拒）', String(e.message).split('\n')[0].slice(0, 100));
}
const t5 = taskOf(card.id);
chk(t5.renewed_count === 1, '⑤b renewed_count=1', String(t5.renewed_count));
chk(Date.parse(t5.claimed_at) > Date.parse(t5a.claimed_at), '⑤c claimed_at 被刷新（确实续上了）');
chk(/续租|renew/.test(String(r5?.message ?? '')), '⑤d 回执说清是续租');

// ── ⑥ 续别人的卡 ⇒ 拒
console.log('\n════ ⑥ 不许替别人续命 ════');
try {
  await applyTaskOp('task-system-plan', { op: 'renew', id: card.id, data: { owner: 'agent:stranger' } }, 'agent:stranger');
  chk(false, '⑥ 应被拒（实际成功 ✗）');
} catch (e) {
  chk(/不是你领的/.test(String(e.message)), '⑥ 被拒（不是你领的）', String(e.message).split('\n')[0].slice(0, 70));
}

// ── ⑦ 过期后不许自己续（熔断的边界）
console.log('\n════ ⑦ 过期后不能续 ⇒ 只能接管 ════');
setClaimedAt(card.id, new Date(Date.now() - 5 * 3600_000).toISOString(), 'agent:worker');
try {
  await applyTaskOp('task-system-plan', { op: 'renew', id: card.id, data: { owner: 'agent:worker' } }, 'agent:worker');
  chk(false, '⑦ 应被拒（实际成功 ✗ 过期还能续活，熔断就是装饰）');
} catch (e) {
  chk(/已经过期/.test(String(e.message)), '⑦ 被拒（已经过期，不许自己续活）', String(e.message).split('\n')[0].slice(0, 80));
}

// ── ⑧ expire：主动回收（没人来也会回 candidate）
console.log('\n════ ⑧ expire：自己过期回 candidate ════');
const d8 = read();
const stock = (d8.todos ?? []).filter((t) => t.state === 'candidate').slice(0, 2);
if (stock.length < 2) throw new Error('夹具要求 ≥2 张 candidate 卡');
setClaimedAt(stock[0].id, new Date(Date.now() - 5 * 3600_000).toISOString(), 'agent:gone-1');
setClaimedAt(stock[1].id, new Date().toISOString(), 'agent:alive'); // 这张不该被收
let r8 = null;
try {
  r8 = await applyTaskOp('task-system-plan', { op: 'expire' }, 'subagent:gc');
  chk(true, '⑧a expire 跑通（不需要 id，批量）');
} catch (e) {
  chk(false, '⑧a expire 跑通（实际抛错）', String(e.message).split('\n')[0].slice(0, 100));
}
const e0 = taskOf(stock[0].id);
const e1 = taskOf(stock[1].id);
chk(e0.state === 'candidate', '⑧b 过期的那张回 candidate', `state=${e0.state}`);
chk(e0.owner === null && e0.claimed_at === null, '⑧c owner / claimed_at 被清空');
chk(e0.expired_from?.owner === 'agent:gone-1' && Math.abs((e0.expired_from?.age_hours ?? 0) - 5) < 0.2,
  '⑧d expired_from 记了原 owner + age≈5h', JSON.stringify(e0.expired_from));
chk(e0.expired_from?.ttl_ms === LEASE_TTL_MS, '⑧e 记了当时的 TTL 口径（可配的值要留档）');
chk(e1.state === 'claimed', '⑧f 未到期的那张**没被误收**', `state=${e1.state}`);
chk(String(r8?.message ?? '').includes(stock[0].id), '⑧g 回执点名了被收的那张');

console.log(`\n════ 汇总：PASS=${P_}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
