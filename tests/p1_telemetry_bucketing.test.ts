/**
 * telemetry 分桶回归 —— 审计 D4-6 修复的检测点（2026-11-16 恢复事故批次）。
 *
 * 钉的行为：**遥测按项目根分桶落各自的 events.jsonl，不跨项目串写**。
 *
 * 改前的病（为什么这条测试有牙）：`_capture` 是模块级单例，以**第一次**调用的
 * eventsPath 固化 —— 同一进程内第二个项目 emit 时，事件写进第一个项目的文件。
 * 消融验证：把 emitTelemetry 退回"单例 + 忽略路径"的写法 ⇒ 用例② 红
 * （rootB 的 events.jsonl 里出现 rootA 的 probe，或 rootB 根本没有事件）。
 *
 * 附带钉：丢帧计数（审计 D4-8）——emit 失败（目录不可建）不抛，但计数递增。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { emitTelemetry, telemetryCachedRoots, telemetryDroppedFrames, TELEMETRY_STAGES } from '../src/application/telemetry.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 等待 fire-and-forget 的遥测链走完（初始化 + emit 都是同步 append，一个宏任务够） */
const flush = () => new Promise<void>((r) => setTimeout(r, 120));

const readEvents = (root: string): string[] => {
  const p = path.join(root, '.agent-io', 'observe', 'events.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()) : [];
};

test('telemetry 分桶 · ①两个根各自落盘，互不串写', { timeout: 15_000 }, async () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-b-'));
  try {
    emitTelemetry(rootA, TELEMETRY_STAGES.claim, { text: 'A 领卡', data: { project: 'A' } });
    emitTelemetry(rootB, TELEMETRY_STAGES.judge, { text: 'B 判定', data: { project: 'B' } });
    await flush();

    const linesA = readEvents(rootA);
    const linesB = readEvents(rootB);
    assert.ok(linesA.length >= 1, `rootA 应有至少 1 条事件（实得 ${linesA.length}）`);
    assert.ok(linesB.length >= 1, `rootB 应有至少 1 条事件（实得 ${linesB.length}）——改前单例会把 B 的帧写进 A 的文件`);
    assert.ok(linesA.every((l) => l.includes('dev-telemetry') && !l.includes('telemetry.judge') === false || !l.includes('"project":"B"')), 'A 桶不收 B 的帧');
    assert.ok(linesA.join('\n').includes('"project":"A"'), 'A 的事件内容在 A');
    assert.ok(linesB.join('\n').includes('"project":"B"'), 'B 的事件内容在 B');
    assert.ok(!linesA.join('\n').includes('"project":"B"'), '★ 不许串写：A 的文件里没有 B 的帧');
    assert.ok(!linesB.join('\n').includes('"project":"A"'), '★ 不许串写：B 的文件里没有 A 的帧');
    // 分桶读数包含两个根（桶键 = 各自的 events.jsonl 路径）
    const roots = telemetryCachedRoots();
    assert.ok(roots.some((r) => r.includes('telemetry-a') && r.endsWith('events.jsonl')), '分桶读数含 rootA 的 events 路径');
    assert.ok(roots.some((r) => r.includes('telemetry-b') && r.endsWith('events.jsonl')), '分桶读数含 rootB 的 events 路径');
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('telemetry 分桶 · ②emit 失败不抛，但丢帧计数递增', { timeout: 15_000 }, async () => {
  // 父路径是一个**文件** ⇒ 其下的 .agent-io/observe 目录永远建不出来 ⇒ appendFileSync 必失败
  const blockingFile = path.join(os.tmpdir(), `telemetry-block-${Date.now()}.txt`);
  fs.writeFileSync(blockingFile, 'not a dir', 'utf8');
  const fakeRoot = path.join(blockingFile, 'sub', 'project');
  try {
    const before = telemetryDroppedFrames();
    assert.doesNotThrow(() => emitTelemetry(fakeRoot, TELEMETRY_STAGES.gate, { text: '这一帧应该丢' }), '丢帧不许抛（遥测绝不阻断主操作）');
    await flush();
    assert.ok(telemetryDroppedFrames() > before, `丢帧计数应递增（before=${before}）——丢帧不抛 ≠ 丢帧不可见`);
  } finally {
    fs.rmSync(blockingFile, { force: true });
  }
});
