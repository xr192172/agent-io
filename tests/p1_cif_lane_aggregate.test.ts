/**
 * P1 · **CI-fix O-1 把守**：车道汇总退出码修法 a + 防稀释护栏（env_contract#aggregateLane）。
 *
 * ## 背景（Main 裁决 O-1）
 * 修法前车道外预期 SKIP 也计入 skip 计数 ⇒ 退 2，即使车道内全 PASS，linux/windows job 仍非零即红，
 * 与规划 GO 判据「ubuntu job 全绿」接线缺口。
 *
 * ## 修法 a（逐字落实）
 * · 车道模式仅 **manifest gates 节声明的本车道门**计入 fail/skip；manifest 声明车道外门从汇总退出码排除
 *   （预期排除，本车道不运行），单列 offLane 不折 PASS。
 * · **防稀释护栏**：车道内任何 SKIP/unsupported 仍判红（退 2）——不得把车道内 unexpected SKIP 也排除。
 * · 逐门三态（§13.5）不动；只改车道聚合退出码哪些门计入。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 车道内全 PASS ⇒ RC0（linux/windows 各验）；车道外预期 SKIP 不贡献退出码。
 * ② 车道内 unexpected SKIP ⇒ 非零（退 2），防稀释护栏生效。
 * ③ manifest 外门不计：车道外预期 SKIP 不影响 RC0，单列 offLane。
 * ④ 坏 --lane fail-closed RC1 既有把守不破（契约层，见 p1_cif_env_contract ⑤⑨；本文件补聚合政策）。
 * 突变牙：manifest gates 把车道内门误标车道外 ⇒ 护栏被绕过 ⇒ 车道内 SKIP 被错误排除 ⇒ code 0（错误态），还原绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, gatesForLane, aggregateLane, validateContract } from '../scripts/lib/env_contract.mjs';
import { GATES } from '../scripts/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const c = loadContract(ROOT);
const linux = gatesForLane(c, 'linux');
const win = gatesForLane(c, 'windows');
/** GATES 定型门名（与 verify.mjs 同一权威表）。 */
const gateNames = GATES.map((g) => (typeof g === 'function' ? g(ROOT).name : g.name));

/** 构造逐门三态；override: 门名 → state。 */
function doneWith(override = {}) {
  return gateNames.map((name) => ({ name, state: override[name] ?? 'PASS' }));
}

test('① 车道内全 PASS ⇒ RC0（linux/windows 各验），车道外 SKIP 不计码', () => {
  // 车道外门在真实 verify 里记 SKIP；这里显式标 SKIP，断言它不贡献退出码。
  const offLinux = gateNames.filter((n) => !linux.has(n));
  const linuxDone = doneWith(Object.fromEntries(offLinux.map((n) => [n, 'SKIP'])));
  const la = aggregateLane(linuxDone, linux);
  assert.equal(la.code, 0, `linux 车道内全 PASS 应 RC0，实得 code=${la.code} fail=${la.fail} skip=${la.skip}`);
  assert.equal(la.fail, 0);
  assert.equal(la.skip, 0);
  assert.equal(la.offLane, offLinux.length);

  const offWin = gateNames.filter((n) => !win.has(n));
  const winDone = doneWith(Object.fromEntries(offWin.map((n) => [n, 'SKIP'])));
  const wa = aggregateLane(winDone, win);
  assert.equal(wa.code, 0, `windows 车道内全 PASS 应 RC0，实得 code=${wa.code}`);
  assert.equal(wa.skip, 0);
  assert.equal(wa.offLane, offWin.length);
});

test('② 车道内 unexpected SKIP ⇒ 退 2（防稀释护栏生效，不随车道外门排除）', () => {
  // linux 车道内一门 SKIP；车道外门也 SKIP。车道内 SKIP 必须仍判红。
  const innerSkip = 'ts 类型';
  assert.ok(linux.has(innerSkip), '前置：ts 类型应在 linux 车道内');
  const offLinux = gateNames.filter((n) => !linux.has(n));
  const d = doneWith({
    [innerSkip]: 'SKIP',
    ...Object.fromEntries(offLinux.map((n) => [n, 'SKIP'])),
  });
  const a = aggregateLane(d, linux);
  assert.equal(a.code, 2, `车道内 SKIP 应退 2，实得 code=${a.code}`);
  assert.equal(a.skip, 1);
  assert.deepEqual(a.skipNames, [innerSkip]);
  // 车道外 SKIP 不混入车道内 skip 名单。
  for (const n of offLinux) assert.ok(!a.skipNames.includes(n), `车道外 ${n} 不应计入车道内 SKIP`);
});

test('③ manifest 外门单列 offLane 不计入退出码', () => {
  const offLinux = gateNames.filter((n) => !linux.has(n));
  const d = doneWith(Object.fromEntries(offLinux.map((n) => [n, 'SKIP'])));
  const a = aggregateLane(d, linux);
  assert.equal(a.code, 0);
  assert.equal(a.offLane, offLinux.length);
  assert.deepEqual([...a.offLaneNames].sort(), [...offLinux].sort());
  // 测试门仅 windows；cache/tasks.db 门不入任何车道。
  assert.ok(a.offLaneNames.includes('测试'));
  for (const n of ['派生条目要求权', '索引可信度', '任务镜像对账']) assert.ok(a.offLaneNames.includes(n));
});

test('④ 非车道模式（laneSet=null）全部门计入，现状不变', () => {
  const d = doneWith({ 'ts 类型': 'SKIP' });
  const a = aggregateLane(d, null);
  assert.equal(a.code, 2);
  assert.equal(a.offLane, 0);
  assert.equal(a.skip, 1);
  const allPass = aggregateLane(doneWith(), null);
  assert.equal(allPass.code, 0);
});

test('突变牙：受保护门被误标车道外（manifest 篡改）⇒ 契约校验 fail-closed 点名（不进聚合层凑绿）', () => {
  const innerSkip = 'ts 类型';
  // 正确契约：该门在 linux 车道内，SKIP 必须判红。
  const good = gatesForLane(c, 'linux');
  const d = doneWith({ [innerSkip]: 'SKIP' });
  assert.equal(aggregateLane(d, good).code, 2, '正确契约下车道内 SKIP 应退 2');

  // 突变：受保护门 lanes 改空（误标车道外）⇒ 契约层 validateContract 点名拒绝（H4 护栏），
  // 不把它放行进聚合层被错误排除成 offLane 凑 RC0。
  const mutant = JSON.parse(JSON.stringify(c));
  mutant.gates[innerSkip].lanes = [];
  const problems = validateContract(mutant);
  assert.ok(
    problems.some((p) => p.includes(innerSkip) && p.includes('不得移出')),
    `应点名受保护门 ${innerSkip} 移出所有车道，实得 ${problems.join('；')}`,
  );

  // 还原正确契约 ⇒ 护栏恢复，code 2 绿。
  const restored = aggregateLane(d, good);
  assert.equal(restored.code, 2);
});

test('⑤ 空车道（laneSet 空集）⇒ fail-closed 退 2，不许空车道凑绿', () => {
  const d = doneWith();
  const a = aggregateLane(d, new Set());
  assert.equal(a.emptyLane, true);
  assert.equal(a.code, 2, `空车道应退 2，实得 code=${a.code}`);
});

test('⑥ 应跑门漏跑（missingInRun）⇒ 退 2 并单列差集，不折 PASS', () => {
  // 车道内应跑两门；done 只出现一门，另一门漏跑。
  const expected = new Set(['ts 类型', '工具链完整']);
  const d = [{ name: 'ts 类型', state: 'PASS' }];
  const a = aggregateLane(d, expected);
  assert.deepEqual(a.missingInRun, ['工具链完整']);
  assert.equal(a.code, 2, `漏跑应退 2，实得 code=${a.code}`);
  // 全部门都在 done ⇒ 无 missing。
  const full = aggregateLane([{ name: 'ts 类型', state: 'PASS' }, { name: '工具链完整', state: 'PASS' }], expected);
  assert.deepEqual(full.missingInRun, []);
  assert.equal(full.code, 0);
});
