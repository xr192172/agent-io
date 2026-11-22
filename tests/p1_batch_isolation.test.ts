/**
 * T6 · 批处理数据隔离（Slice 1 · 企划 §4.6 / §7 T6）。
 *
 * 批调用不改变既有隔离口径（R6 平移）：每文件 home 互异、槽位建池固定、INJECT_VAR 优先级、
 * 自钉 HOME 赢、并行降级自白横幅。隔离实现住在 runner 里，本证静态锚定 + 平移既有 R6 口径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = fs.readFileSync(path.join(REPO, 'scripts', 'run-tests.mjs'), 'utf8');

test('T6-① 每文件数据根互异：home 路径含 w<槽位> + 文件名单独子目录', () => {
  assert.match(runner, /function testDataHome\(rel, slot = 0\)/, 'testDataHome 必须在');
  assert.match(runner, /RUN_HOME_ROOT,\s*`w\$\{slot\}`/, '路径必须按固定槽位分 w<槽位>');
  assert.match(runner, /rel\.replace\(/, '文件名必须单独成子目录（每文件一根）');
});

test('T6-② 槽位建池固定：worker 数 = min(jobs, n)，槽位随 worker 固定，不用全量 Promise.all 拉进程', () => {
  assert.match(runner, /Math\.max\(1,\s*Math\.min\(concurrency,\s*indices\.length\)\)/, '池大小必须受 jobs 与清单数双重夹取');
  assert.match(runner, /const worker = async \(slot\)/, '槽位由建池时固定传入');
  // 注释行/块注释（论证散文）不计入代码判据；代码里不许 Promise.all 一次性 map 全部进程（Windows 句柄风险）
  const code = runner.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/Promise\.all\((files|todo)\.map/.test(code), '不许 Promise.all 一次性拉起全部进程（Windows 句柄风险）');
});

test('T6-③ INJECT_VAR 优先级：外层 DATA_ROOT 优先注入，否则 HOME；测试自钉 HOME 不被抢', () => {
  assert.match(runner, /process\.env\.AGENT_IO_DATA_ROOT\?\.trim\(\)\s*\?\s*'AGENT_IO_DATA_ROOT'\s*:\s*'AGENT_IO_HOME'/,
    'INJECT_VAR 必须 DATA_ROOT 优先、HOME 兜底');
  assert.match(runner, /env:\s*\{\s*\.\.\.process\.env,\s*\[INJECT_VAR\]/, '注入必须保留既有环境（自钉值不被覆盖）');
});

test('T6-④ 并行档降级自白横幅；默认档无并行横幅（R4 平移）', () => {
  assert.match(runner, /PARALLEL/, '必须有并行档判定');
  assert.match(runner, /判不了是谁改的|无法点名污染者/, '并行护栏降级必须自白');
  // 默认档 jobs=1 ⇒ PARALLEL=false，横幅分支不进
  assert.match(runner, /const PARALLEL = jobs > 1/, '并行横幅只在 jobs>1 出现');
});

test('T6-⑤ 批调用（显式清单/--json）不绕过隔离：runner 仍给每文件注数据根', () => {
  // 显式清单只是收窄选中集；执行隔离仍走 runOne 的 env 注入，未新增第二套起进程路径
  assert.match(runner, /runOne\(`tests\/\$\{files\[i\]\}`, slot\)/, '并行批路径仍经 runOne 注入隔离环境');
  assert.match(runner, /const r = await runOne\(rel\)/, '串行批路径仍经 runOne 注入隔离环境');
});
