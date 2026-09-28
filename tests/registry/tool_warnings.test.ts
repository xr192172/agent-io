/**
 * 告警结构化 + 两级呈现（P-F，规划书 §16.6 / §16.8）—— 纯模块测试
 *
 * 守两条要求：
 *   ① 首次出现给**全文**，之后给**一行摘要**（不是静默 —— 静默就是把"少做了什么"藏起来，§2d）；
 *   ② **结构化**成 `warnings: [{code, summary, detail, fix}]` —— **可被程序判定**。
 *
 * 判定依据（"首次/后续"的状态位）：`registry/tool_warnings.ts` 的进程内 `Set<键>`，键 = `code@scope`。
 * 本文件直接注入自己的 `ledger` 来验这条逻辑（不必依赖真实跨轮调用），集成路径另由
 * tests/registry/warning_noise_gate.test.ts 用真实 stale 项目跑。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  emitWarnings,
  renderWarningText,
  tierWarnings,
  warningBlock,
  resetWarningDelivery,
  WARNINGS_MARKER,
  type ToolWarning,
} from '../../src/registry/tool_warnings';

/** 造一条"生产方产物"（全字段都在） */
function w(code: string, scope?: string): ToolWarning {
  return { code, summary: `${code} 的一行摘要`, detail: `${code} 的完整说明（长文本）`, fix: `修 ${code} 的办法`, scope };
}

describe('tierWarnings（首次全文 / 后续摘要）', () => {
  it('同一键：第一次带 detail+fix，之后只剩 summary（不静默）', () => {
    const ledger = new Set<string>();
    const first = tierWarnings([w('STALE_INDEX')], ledger);
    expect(first[0]).toEqual({
      code: 'STALE_INDEX',
      summary: 'STALE_INDEX 的一行摘要',
      detail: 'STALE_INDEX 的完整说明（长文本）',
      fix: '修 STALE_INDEX 的办法',
    });

    const second = tierWarnings([w('STALE_INDEX')], ledger);
    expect(second[0].code).toBe('STALE_INDEX');
    expect(second[0].summary).toBe('STALE_INDEX 的一行摘要'); // ★ 摘要还在（不静默）
    expect(second[0].detail).toBeNull(); // ★ 长文本不再重复
    expect(second[0].fix).toBeNull();
    expect(Object.keys(second[0]).sort()).toEqual(['code', 'detail', 'fix', 'summary']); // 形状不变
  });

  it('键含 scope：不同 scope 各自算"首次"', () => {
    const ledger = new Set<string>();
    expect(tierWarnings([w('STALE_INDEX', 'C:/p1')], ledger)[0].detail).toBeTruthy();
    expect(tierWarnings([w('STALE_INDEX', 'C:/p1')], ledger)[0].detail).toBeNull();
    expect(tierWarnings([w('STALE_INDEX', 'C:/p2')], ledger)[0].detail).toBeTruthy(); // 另一个根 ⇒ 仍是首次
  });

  it('不同 code 互不影响', () => {
    const ledger = new Set<string>();
    tierWarnings([w('STALE_SOURCE')], ledger);
    expect(tierWarnings([w('STALE_BUILD')], ledger)[0].detail).toBeTruthy();
  });

  it('粘性：某键投递过全文后，即使"消失再出现"也只给摘要（同进程不重发全文）', () => {
    const ledger = new Set<string>();
    tierWarnings([w('STALE_SOURCE')], ledger); // 首次全文
    tierWarnings([], ledger); // 健康（本轮无该告警）
    expect(tierWarnings([w('STALE_SOURCE')], ledger)[0].detail).toBeNull(); // 再出现 ⇒ 摘要
  });

  it('resetWarningDelivery ⇒ 重新算首次（模拟"新进程"）', () => {
    expect(tierWarnings([w('STALE_SOURCE')])[0].detail).toBeTruthy(); // 用默认进程级 ledger
    expect(tierWarnings([w('STALE_SOURCE')])[0].detail).toBeNull();
    resetWarningDelivery();
    expect(tierWarnings([w('STALE_SOURCE')])[0].detail).toBeTruthy();
    resetWarningDelivery(); // 收尾：别把记账留给别的用例
  });
});

describe('renderWarningText / warningBlock（文本与机器通道）', () => {
  it('全文 = 三行（摘要+说明+修复）；摘要投递 = **一行**', () => {
    const full = renderWarningText([{ code: 'X', summary: 'S', detail: 'D', fix: 'F' }]);
    expect(full.trim().split('\n').length).toBe(3);
    expect(full).toContain('X：S');
    expect(full).toContain('D');
    expect(full).toContain('F');

    const brief = renderWarningText([{ code: 'X', summary: 'S', detail: null, fix: null }]);
    expect(brief.trim().split('\n').length).toBe(1);
    expect(brief).toContain('X：S');
  });

  it('无告警 ⇒ 文本与机器块都是空串（**不追加空块**）', () => {
    expect(renderWarningText([])).toBe('');
    expect(warningBlock([])).toBe('');
  });

  it('机器块：标记 + JSON 数组，`split(marker)[1]` 可直接 JSON.parse（形状恰好四键）', () => {
    const block = warningBlock([{ code: 'STALE_INDEX', summary: 'S', detail: null, fix: null }]);
    const tail = (block + '\n后面的东西').split(WARNINGS_MARKER)[1];
    // ★ 断言"块在最末时是纯 JSON"（调用方按此约定解析）；这里模拟"块之后还有别的东西"会解析失败
    expect(() => JSON.parse(tail)).toThrow();
    const parsed = JSON.parse(block.split(WARNINGS_MARKER)[1]) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].code).toBe('STALE_INDEX');
    expect(parsed[0].detail).toBeNull();
    expect(Object.keys(parsed[0]).sort()).toEqual(['code', 'detail', 'fix', 'summary']);
  });
});

describe('emitWarnings（唯一入口）', () => {
  beforeEach(() => resetWarningDelivery());

  it('null 生产者被跳过；结构化数组/文本/机器块三者一致', () => {
    const e1 = emitWarnings([null, w('STALE_SOURCE'), undefined]);
    expect(e1.warnings).toHaveLength(1);
    expect(e1.warnings[0].code).toBe('STALE_SOURCE');
    expect(e1.text).toContain('STALE_SOURCE');
    const parsed = JSON.parse(e1.block.split(WARNINGS_MARKER)[1]) as unknown[];
    expect(parsed).toEqual(e1.warnings); // 机器块与结构化数组**逐字一致**

    // 第二轮：同一个键 ⇒ 摘要（长文本不进文本、也不进机器块）
    const e2 = emitWarnings([null, w('STALE_SOURCE'), undefined]);
    expect(e2.warnings[0].detail).toBeNull();
    expect(e2.text.trim().split('\n').length).toBe(1);
    expect(e2.block).not.toContain('完整说明');
  });

  it('无告警 ⇒ 三样都空（文本不变长、不追加机器块）', () => {
    const e = emitWarnings([null, undefined]);
    expect(e.warnings).toEqual([]);
    expect(e.text).toBe('');
    expect(e.block).toBe('');
  });
});
