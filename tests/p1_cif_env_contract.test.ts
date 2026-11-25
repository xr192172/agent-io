/**
 * P1 · **CI-fix C3 把守**：仓根 env-contract.json 单一契约结构合规 + 漂移 fail-closed。
 *
 * ## 背景（诊断 §5.1 / 规划 §3.2）
 * 工具命令 / 版本下限 / 平台子集 / 派生库归属原先散在 env-check.mjs 私写阈值里。现收口到
 * 仓根 `env-contract.json`，本地 harness 与 CI workflow 共读一份；契约漂移（缺工具 / 平台引用
 * 未登记工具 / 版本形状坏 / JSON 坏）即红。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 仓根契约可加载且 validateContract 无问题。
 * ② 六个工具键齐全；windows/linux 平台子集引用的工具都在 tools 内。
 * ③ node/java 版本阈值形状合法（major_min 数字；node 带 minor_min）。
 * ④ 契约 node 下限与 package.json engines 同源（>=22.5）。
 * ⑤ 坏 JSON / 结构不符 ⇒ loadContract 抛错（fail-closed，不回退内置默认）。
 * ⑥ 突变把守：平台引用未登记工具 ⇒ validateContract 点名报问题。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, validateContract, toolSpec, gateSpec, gatesForLane } from '../scripts/lib/env_contract.mjs';
import { GATES } from '../scripts/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** GATES 定型后的门名清单（函数门先调用定型；与 verify.mjs 同一权威表）。 */
const gateNames = GATES.map((g) => (typeof g === 'function' ? g(ROOT).name : g.name));

test('① 仓根契约可加载且结构合规', () => {
  const c = loadContract(ROOT);
  assert.deepEqual(validateContract(c), []);
});

test('② 六工具齐全；平台子集引用工具均在册', () => {
  const c = loadContract(ROOT);
  for (const k of ['node', 'npm', 'git', 'java', 'maven', 'go']) {
    assert.ok(toolSpec(c, k), `工具 ${k} 未登记`);
    assert.equal(typeof toolSpec(c, k).command, 'string');
    assert.equal(typeof toolSpec(c, k).required, 'boolean');
  }
  for (const plat of ['windows', 'linux']) {
    for (const t of c.platforms[plat].tools) {
      assert.ok(toolSpec(c, t), `平台 ${plat} 引用未登记工具 ${t}`);
    }
  }
});

test('③ node/java 版本阈值形状合法', () => {
  const c = loadContract(ROOT);
  assert.equal(c.tools.node.version.major_min, 22);
  assert.equal(c.tools.node.version.minor_min, 5);
  assert.equal(c.tools.java.version.major_min, 17);
});

test('④ 契约 node 下限与 package.json engines 同源', () => {
  const c = loadContract(ROOT);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const m = /^>=\s*(\d+)(?:\.(\d+))?/.exec(pkg.engines?.node ?? '');
  assert.ok(m, 'package.json engines.node 缺版本下限');
  assert.equal(Number(m[1]), c.tools.node.version.major_min);
  assert.equal(Number(m[2] ?? 0), c.tools.node.version.minor_min ?? 0);
});

test('⑤ fail-closed：坏 JSON / 结构不符 ⇒ loadContract 抛错', () => {
  assert.throws(() => loadContract(path.join(ROOT, 'tests', 'fixtures')));
  const bad = { schema: 'env-contract/1', tools: 'not-an-object' };
  assert.ok(validateContract(bad).length > 0);
});

test('⑥ 突变把守：平台引用未登记工具 ⇒ validateContract 点名', () => {
  const c = loadContract(ROOT);
  const mutant = JSON.parse(JSON.stringify(c));
  mutant.platforms.linux.tools.push('rust');
  const problems = validateContract(mutant);
  assert.ok(problems.some((p) => p.includes('rust')), `应点名未登记工具 rust，实得 ${problems.join('；')}`);
});

test('⑦ gates 登记与 GATES 门名一一对应（无漏登/多登）', () => {
  const c = loadContract(ROOT);
  assert.deepEqual(Object.keys(c.gates).sort(), [...gateNames].sort());
});

test('⑧ 车道归属：弱代理/派生门不入 CI lane；Go 两门 needs=go', () => {
  const c = loadContract(ROOT);
  // ★ 2026-11-25（P3 施工批 · Main 裁①）：测试 / 判据突变 / 无卡写账 / 文档派生投影 归 offLane（lanes=[]），
  //   与既有 cache/tasks.db 弱代理门同口径；本地全量 laneSet=null 仍强制核。
  for (const n of ['测试', '判据突变', '无卡写账', '文档派生投影', '派生条目要求权', '索引可信度', '任务镜像对账']) {
    assert.deepEqual(gateSpec(c, n).lanes, [], `${n} 不应进任何 CI 车道`);
  }
  assert.deepEqual(gateSpec(c, 'Go 编译').needs, ['go']);
  assert.deepEqual(gateSpec(c, 'Go 静态检查').needs, ['go']);
  assert.deepEqual(gateSpec(c, '设计 DB 结构').derived, ['design_db']);
  const linux = gatesForLane(c, 'linux');
  assert.ok(linux.has('ts 类型'));
  assert.ok(!linux.has('测试'));
  const win = gatesForLane(c, 'windows');
  assert.ok(!win.has('测试'));
});

test('⑨ 突变把守：门 lanes 引用未登记平台 ⇒ validateContract 点名', () => {
  const c = loadContract(ROOT);
  const mutant = JSON.parse(JSON.stringify(c));
  mutant.gates['ts 类型'].lanes.push('darwin');
  const problems = validateContract(mutant);
  assert.ok(problems.some((p) => p.includes('darwin')), `应点名未登记平台 darwin，实得 ${problems.join('；')}`);
});

test('⑩ H4：车道外门缺 exclusion 三要素 ⇒ validateContract 点名', () => {
  const c = loadContract(ROOT);
  const mutant = JSON.parse(JSON.stringify(c));
  delete mutant.gates['测试'].exclusion;
  const problems = validateContract(mutant);
  assert.ok(problems.some((p) => p.includes('测试') && p.includes('exclusion')), `应点名「测试」缺排除登记，实得 ${problems.join('；')}`);
});

test('⑪ H4：exclusion 缺键 / 空串 ⇒ validateContract 点名', () => {
  const c = loadContract(ROOT);
  const mutant = JSON.parse(JSON.stringify(c));
  mutant.gates['测试'].exclusion = { reason: 'x', alternative: '', expires: 'P3' };
  const problems = validateContract(mutant);
  assert.ok(problems.some((p) => p.includes('alternative')), `应点名 alternative 空串，实得 ${problems.join('；')}`);
});

test('⑫ H4：受保护集引用未登记门 / 受保护门被移出所有车道 ⇒ validateContract 点名', () => {
  const c = loadContract(ROOT);
  const unknown = JSON.parse(JSON.stringify(c));
  unknown.protected_gates.push('不存在的门');
  assert.ok(validateContract(unknown).some((p) => p.includes('不存在的门')));

  const moved = JSON.parse(JSON.stringify(c));
  moved.gates['ts 类型'].lanes = [];
  const problems = validateContract(moved);
  assert.ok(problems.some((p) => p.includes('ts 类型') && p.includes('不得移出')), `应点名受保护门移出车道，实得 ${problems.join('；')}`);
});
