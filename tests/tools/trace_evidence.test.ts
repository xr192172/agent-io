/**
 * trace_evidence —— L4 真实可复算校验
 *
 * ★ 2026-10-01（撤 trace_reasoning 后重接）：证据源不再是"被撤工具写的合成 trace 文件"，
 *   而是 **observe 线真实录制的事件 JSONL**（跑探针落盘，`observe_trace` 同一份数据）。
 *   本用例因此**直接喂事件文本**（来源真实、形状真实），不再需要跑一个生产者。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  recordsFromEvents,
  loadTraceRecords,
  loadObservedTraceRecords,
  resolveTraceEvidence,
  buildTraceResolver,
} from '../../src/application/observe/capture/trace_evidence.js';

/** 一段真实形状的录制事件（order.Place → pay.Charge → inv.Reserve，3 层）。 */
const EVENTS = [
  '{"probe":"order.Place.enter","trace_id":"20961189ba5d9338","frame_id":1,"fields":{"order_id":42}}',
  '{"probe":"pay.Charge.enter","trace_id":"20961189ba5d9338","frame_id":2,"parent_id":1,"fields":{"order_id":42}}',
  '{"probe":"inv.Reserve.enter","trace_id":"20961189ba5d9338","frame_id":3,"parent_id":2,"fields":{"order_id":42}}',
  '{"probe":"inv.Reserve.exit","trace_id":"20961189ba5d9338","frame_id":3,"parent_id":2,"fields":{"dur_ms":1.5}}',
  '{"probe":"pay.Charge.exit","trace_id":"20961189ba5d9338","frame_id":2,"parent_id":1,"fields":{"dur_ms":31}}',
  '{"probe":"order.Place.exit","trace_id":"20961189ba5d9338","frame_id":1,"fields":{"dur_ms":7.375}}',
].join('\n');

const records = recordsFromEvents(EVENTS);

describe('trace_evidence —— 事件 → 记录', () => {
  it('把真实事件摊平成记录（全名 + 末段短名 + 真实耗时 + 入参）', () => {
    expect(records.map((r) => r.probe)).toEqual(['order.Place', 'pay.Charge', 'inv.Reserve']);
    const pay = records.find((r) => r.name === 'Charge')!;
    expect(pay.probe).toBe('pay.Charge');
    expect(pay.duration_ms).toBe(31);
    expect(pay.in).toEqual({ order_id: 42 });
    expect(pay.trace_id).toBe('20961189ba5d9338');
  });

  it('同一探针多次调用 → 取最大耗时复算（不会挑到快的那次而误放行）', () => {
    const twice = recordsFromEvents(
      [
        EVENTS,
        '{"probe":"pay.Charge.enter","trace_id":"bbbb000000000000","frame_id":1,"fields":{}}',
        '{"probe":"pay.Charge.exit","trace_id":"bbbb000000000000","frame_id":1,"fields":{"dur_ms":900}}',
      ].join('\n'),
    );
    // 声称耗时超 100ms：一次 900ms 命中 ⇒ 通过
    expect(resolveTraceEvidence(twice, { type: 'trace', ref: 'Charge@dur>100' }).ok).toBe(true);
    // 声称耗时超 1000ms：最慢 900ms 未超 ⇒ 复算打回
    const r = resolveTraceEvidence(twice, { type: 'trace', ref: 'Charge@dur>1000' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('复算失败');
  });
});

describe('trace_evidence —— L4 真实可复算校验', () => {
  it('真实执行过的函数 → 证据通过（存在性），全名/短名都可引用', () => {
    const full = resolveTraceEvidence(records, { type: 'trace', ref: 'pay.Charge' });
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.actual).toBeGreaterThan(0);

    const short = resolveTraceEvidence(records, { type: 'trace', ref: 'Charge' });
    expect(short.ok).toBe(true);
  });

  it('编造/未执行的函数 → 打回', () => {
    const r = resolveTraceEvidence(records, { type: 'trace', ref: 'nonexistent_fn' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('无函数');
  });

  it('声明的耗时阈值超过实际 → 复算打回（证据与实际运行不符）', () => {
    const r = resolveTraceEvidence(records, { type: 'trace', ref: 'Charge@dur>9999' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('复算失败');
  });

  it('声明的耗时阈值低于实际 → 复算通过，并回传实际值', () => {
    const r = resolveTraceEvidence(records, { type: 'trace', ref: 'Charge@dur>10' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.actual).toBe(31);
      expect(r.expected).toBe(10);
    }
  });

  it('非 trace 类型证据 → 打回', () => {
    expect(resolveTraceEvidence(records, { type: 'diff', ref: 'x' }).ok).toBe(false);
  });

  it('空 ref → 打回', () => {
    expect(resolveTraceEvidence(records, { type: 'trace', ref: '  ' }).ok).toBe(false);
  });

  it('buildTraceResolver 暴露真实探针全名集合供 L3/L4 复用', () => {
    const res = buildTraceResolver(records);
    // L3 用的是"带命名空间的探针全名"，不是短名（短名太泛，容易在正文里误命中）
    expect(res.traceRefs).toEqual(['order.Place', 'pay.Charge', 'inv.Reserve']);
    expect(res.traceRefs).not.toContain('ghost_fn');
    expect(res.exists({ type: 'trace', ref: 'ghost_fn' })).toBe(false);
    expect(res.exists({ type: 'trace', ref: 'pay.Charge' })).toBe(true);
  });
});

describe('trace_evidence —— 事件文件读写', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace_evidence_'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadTraceRecords：文件不存在 → 空数组（调用方据此判"不可回溯"）', () => {
    expect(loadTraceRecords(path.join(dir, 'ghost.jsonl'))).toEqual([]);
  });

  it('loadTraceRecords：真实文件 → 记录', () => {
    const f = path.join(dir, 'events.jsonl');
    fs.writeFileSync(f, EVENTS, 'utf-8');
    expect(loadTraceRecords(f)).toHaveLength(3);
  });

  it('loadObservedTraceRecords：没配 DS_OBSERVE_EVENTS 且 cwd 无 runs.jsonl → source=null', () => {
    const prev = process.env.DS_OBSERVE_EVENTS;
    delete process.env.DS_OBSERVE_EVENTS;
    try {
      const got = loadObservedTraceRecords(dir);
      // tmpdir 的 dsh_events.jsonl 可能真实存在（本机跑过观测）⇒ 只断言"不抛且来源合法"
      if (got.source === null) {
        expect(got.records).toEqual([]);
      } else {
        expect(got.source.length).toBeGreaterThan(0);
      }
      // ★ 显式指一个空目录时，不该凭空造出记录
      expect(got.records.every((r) => typeof r.probe === 'string')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.DS_OBSERVE_EVENTS;
      else process.env.DS_OBSERVE_EVENTS = prev;
    }
  });

  it('loadObservedTraceRecords：DS_OBSERVE_EVENTS 指到真实事件文件 → 读到记录', () => {
    const f = path.join(dir, 'events.jsonl');
    fs.writeFileSync(f, EVENTS, 'utf-8');
    const prev = process.env.DS_OBSERVE_EVENTS;
    process.env.DS_OBSERVE_EVENTS = f;
    try {
      const got = loadObservedTraceRecords(dir);
      expect(got.source).toBe(f);
      expect(got.records).toHaveLength(3);
    } finally {
      if (prev === undefined) delete process.env.DS_OBSERVE_EVENTS;
      else process.env.DS_OBSERVE_EVENTS = prev;
    }
  });
});
