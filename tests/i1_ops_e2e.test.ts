/**
 * I1 · 第 6/7 条：expectations 写入时预判 + decision.update 接受 service 节点（端到端，走真 updateFeature）。
 *
 * 判据：
 * · 预判：写判据的同一批，先判一遍；「现在就红」的在回执 warning 点名（**不拒**）；无 source_root ⇒ note 说明。
 * · service：`type=service` 的节点能挂决策卡（此前被「不是文件/文档节点」一概拒掉）；
 *   非法类型（如 ui）仍拒。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-i1-ops-'));
process.env.AGENT_IO_HOME = HOME; // 必须在 import storage 之前

const { writeMinimalFeature, readFeature, rmRf } = await import('./helpers/i1_fixture.js');
const { updateFeature } = await import('../src/application/design/dsl_ops/update_feature.js');

const projRoot = path.join(HOME, 'proj');
fs.mkdirSync(projRoot, { recursive: true });
fs.writeFileSync(path.join(projRoot, 'calc.ts'), 'export function existingFn() { return 1; }\n', 'utf-8');

before(() => {
  writeMinimalFeature(HOME, 'i1-ops', { source_root: projRoot });
  writeMinimalFeature(HOME, 'i1-ops-nosrc', {});
});

after(() => rmRf(HOME));

test('service 节点能挂决策卡（I1 放开）', async () => {
  const r = await updateFeature({
    feature: 'i1-ops',
    reason: '给 service 节点挂决策卡',
    operations: [{ op: 'update', type: 'decision', id: 'svc_1', data: { summary: '服务为何存在' } }],
  } as never);
  assert.match(r.message, /全部成功/);
  const dsl = readFeature(HOME, 'i1-ops');
  const node = dsl.geometry.nodes.find((n) => n.id === 'svc_1') as { decision?: { summary?: string } };
  assert.equal(node.decision?.summary, '服务为何存在');
});

test('非法类型（ui）仍拒：报错点名类型与三类合法目标', async () => {
  writeMinimalFeature(HOME, 'i1-ops-ui', { nodeType: 'ui', nodeId: 'ui_1' });
  await assert.rejects(
    () =>
      updateFeature({
        feature: 'i1-ops-ui',
        reason: '试图挂到 ui 节点',
        operations: [{ op: 'update', type: 'decision', id: 'ui_1', data: { summary: 'x' } }],
      } as never),
    /不是文件\/文档\/service/,
  );
});

test('expectations 写入时预判：「现在就红」的条目在回执 warning 点名（不拒，写入照常成功）', async () => {
  const r = await updateFeature({
    feature: 'i1-ops',
    reason: '写一条注定红的判据（验收还没写的函数）',
    operations: [
      {
        op: 'update',
        type: 'decision',
        id: 'svc_1',
        data: {
          summary: '服务为何存在',
          expectations: [{ kind: 'symbol-exists', path: 'calc.ts', symbol: 'notYetWritten', why: '二期要补的函数' }],
        },
      },
    ],
  } as never);
  assert.match(r.message, /全部成功/); // ★ 不拒
  assert.match(r.message, /现在就红/);
  assert.match(r.message, /notYetWritten/);
});

test('写入预判：全绿的判据给"0 红"读数；判不了（unsupported）单独计数不冒充通过', async () => {
  const r = await updateFeature({
    feature: 'i1-ops',
    reason: '写一条当场就能绿的判据',
    operations: [
      {
        op: 'update',
        type: 'decision',
        id: 'svc_1',
        data: {
          summary: '服务为何存在',
          expectations: [{ kind: 'symbol-exists', path: 'calc.ts', symbol: 'existingFn', why: '一期已有' }],
        },
      },
    ],
  } as never);
  assert.match(r.message, /0 红/);
});

test('无 source_root ⇒ 预判不跑但说明（不静默、不拦）', async () => {
  const r = await updateFeature({
    feature: 'i1-ops-nosrc',
    reason: '纯设计 feature 写判据',
    operations: [
      {
        op: 'update',
        type: 'decision',
        id: 'svc_1',
        data: {
          summary: '纯设计',
          expectations: [{ kind: 'file-exists', path: 'a.ts', why: '未来会有' }],
        },
      },
    ],
  } as never);
  assert.match(r.message, /全部成功/);
  assert.match(r.message, /写入预判/);
  assert.match(r.message, /source_root/);
});

test('node.update.data.decision 替换语义：逐字段合并（没给的保留）+ decision:null 清除', async () => {
  // 先经 decision 写入口给全字段
  await updateFeature({
    feature: 'i1-ops',
    reason: '铺底：完整决策卡',
    operations: [
      { op: 'update', type: 'decision', id: 'svc_1', data: { summary: '完整卡', rationale: '为什么' } },
    ],
  } as never);
  // node.update 只给 summary ⇒ rationale 应保留（合并，不是整体替换丢失）
  await updateFeature({
    feature: 'i1-ops',
    reason: 'node.update 只改 summary',
    operations: [{ op: 'update', type: 'node', id: 'svc_1', data: { decision: { summary: '经 node.update 改' } } }],
  } as never);
  let node = (readFeature(HOME, 'i1-ops').geometry.nodes as Array<{ id: string; decision?: Record<string, unknown> }>).find((n) => n.id === 'svc_1');
  assert.equal(node?.decision?.summary, '经 node.update 改');
  assert.equal(node?.decision?.rationale, '为什么');

  // decision:null ⇒ 整卡清除
  await updateFeature({
    feature: 'i1-ops',
    reason: '清除决策卡',
    operations: [{ op: 'update', type: 'node', id: 'svc_1', data: { decision: null } }],
  } as never);
  node = (readFeature(HOME, 'i1-ops').geometry.nodes as Array<{ id: string; decision?: Record<string, unknown> }>).find((n) => n.id === 'svc_1');
  assert.equal(node?.decision, undefined);
});
