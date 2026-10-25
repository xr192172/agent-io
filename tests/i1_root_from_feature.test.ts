/**
 * I1 · 第 5 条：NO_PROJECT_ROOT 假警报修 —— feature 能经 DSL `source_root` 定位项目根时**不报**。
 *
 * 判据：`resolveRootFromArgs` 加**级 3**：入参只带 `feature` ⇒ 读该 feature 设计 DSL 的
 * `source_root`（必须是真实存在的目录）；取不到才返回 null（真警报不灭）。
 * 唯一实现 = `server_registry.ts#rootFromFeatureArg`（导出供测试）。
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-i1-root-'));
process.env.AGENT_IO_HOME = HOME; // 必须在 import storage 之前

const { writeMinimalFeature, rmRf } = await import('./helpers/i1_fixture.js');
const { rootFromFeatureArg, resolveRootFromArgs } = await import('../src/presentation/mcp/server_registry.js');

const projRoot = path.join(HOME, 'proj');
fs.mkdirSync(projRoot, { recursive: true });

beforeEach(() => {
  writeMinimalFeature(HOME, 'i1-root-fixture', { source_root: projRoot });
});

after(() => rmRf(HOME));

test('rootFromFeatureArg：feature 的 source_root 是真实目录 ⇒ 返回它', () => {
  assert.equal(rootFromFeatureArg('i1-root-fixture'), path.resolve(projRoot));
});

test('rootFromFeatureArg：feature 不存在 / 无 source_root / source_root 不存在 ⇒ null（真警报不灭）', () => {
  assert.equal(rootFromFeatureArg('no-such-feature'), null);
  assert.equal(rootFromFeatureArg(undefined), null);
  assert.equal(rootFromFeatureArg(''), null);
  writeMinimalFeature(HOME, 'i1-nosrc', {}); // 无 source_root
  assert.equal(rootFromFeatureArg('i1-nosrc'), null);
  writeMinimalFeature(HOME, 'i1-badsrc', { source_root: path.join(HOME, 'not-exist-dir') });
  assert.equal(rootFromFeatureArg('i1-badsrc'), null);
});

test('resolveRootFromArgs：只带 feature 的调用（edit_dsl 形状）⇒ 经级 3 解析到根（不再假报 NO_PROJECT_ROOT）', () => {
  const root = resolveRootFromArgs({ feature: 'i1-root-fixture', reason: 'x', operations: [] });
  assert.equal(root, path.resolve(projRoot));
});

test('resolveRootFromArgs：无 feature 无路径 ⇒ 仍为 null（该报的警报照旧）', () => {
  assert.equal(resolveRootFromArgs({ query: 'features' }), null);
});
