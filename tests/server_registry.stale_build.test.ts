/**
 * 结构性摩擦 F（改码→对账需重启）修复回归测试
 *
 * 修复内容：陈旧构建警告（STALE BUILD）改为由 registerAllTools 统一注入，
 * 覆盖全部工具（此前仅 wrap/wrapData 包装的内联主工具有警告，独立工具模块
 * 改码后无提示返回旧逻辑）。
 * 本测试：① staleBuildWarningFor 纯函数全分支；② 统一注入路径覆盖所有注册工具。
 *
 * ★ P-F（§16.6）：产物已是**结构化告警**（`ToolWarning | null`），且注入分两级 ——
 *   首次全文 / 之后一行摘要 + `---WARNINGS---` 机器块。分级逻辑见 tests/registry/tool_warnings.test.ts。
 */
import { describe, it, expect } from 'vitest';
import { registerAllTools, TOOL_DEFS, staleBuildWarningFor } from '../src/server_registry';
import { WARNINGS_MARKER } from '../src/registry/tool_warnings';

describe('staleBuildWarningFor（陈旧构建判定纯函数）', () => {
  it('当前 mtime 晚于加载 mtime → 结构化告警（含码/摘要/修复）', () => {
    const w = staleBuildWarningFor(1000, 2000);
    expect(w?.code).toBe('STALE_BUILD');
    expect(w?.summary).toContain('旧代码');
    expect(w?.fix).toContain('重启');
    expect(w?.detail).toBeTruthy();
  });

  it('当前 mtime 不晚于加载 mtime → null（进程运行的是最新代码）', () => {
    expect(staleBuildWarningFor(2000, 1000)).toBeNull();
    expect(staleBuildWarningFor(1000, 1000)).toBeNull();
  });

  it('任一侧 mtime 未知（非编译产物环境）→ null，静默禁用', () => {
    expect(staleBuildWarningFor(null, 2000)).toBeNull();
    expect(staleBuildWarningFor(1000, null)).toBeNull();
    expect(staleBuildWarningFor(null, null)).toBeNull();
  });
});

describe('registerAllTools 统一响应注入（摩擦 F）', () => {
  /**
   * 有副作用 / 长跑的工具：本用例的意图是"**统一注入通道**能正常执行、不抛未捕获异常"，
   * 不是"验证每个工具的业务逻辑"。无参调用它们会真的干活：
   *   - `run_tests({})` 会跑**整个测试套件**（实测 120s）—— 那是它的正常职责，不该由本用例驱动。
   * 其余工具无参调用都会快速返回（实测最慢 ~214ms，全循环约 2s）。
   * 这些工具**仍然**被下面的"注册覆盖"断言覆盖，所以不存在"用排除表掩盖坏工具"的漏洞。
   */
  const SIDE_EFFECT_TOOLS = new Set(['run_tests']);

  it('全部工具经统一路径注册，且统一注入通道可正常执行（防 wrap 清理后响应破坏）', async () => {
    const captured: Array<{ name: string; cb: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }> }> = [];
    const fakeServer = {
      registerTool: (name: string, _config: unknown, cb: (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>) => {
        captured.push({ name, cb });
      },
    };

    registerAllTools(fakeServer as never);

    // 注册覆盖全部 TOOL_DEFS（防漏注册回归）
    expect(new Set(captured.map((c) => c.name))).toEqual(new Set(TOOL_DEFS.map((d) => d.name)));
    // 排除表不许漂移：里面每个名字都必须真的存在于注册表（否则就是写错了/用排除掩盖问题）
    for (const n of SIDE_EFFECT_TOOLS) expect(captured.some((c) => c.name === n)).toBe(true);

    // 统一路径逐一执行：无未捕获异常、text 可读；正常态（非 stale）下响应既不含 STALE_BUILD 标记、
    // 也不含 `---WARNINGS---` 机器块
    const broken: string[] = [];
    const staleLeak: string[] = [];
    for (const c of captured) {
      if (SIDE_EFFECT_TOOLS.has(c.name)) continue;
      try {
        const r = await c.cb({});
        const text = r?.content?.[0]?.text ?? '';
        if (typeof text !== 'string') broken.push(`${c.name}: text 非字符串`);
        // ★ P-F：码变成 STALE_BUILD（下划线），且正常情况下**连机器块都不该出现**（空告警不追加空块）
        if (text.includes('STALE_BUILD') || text.includes(WARNINGS_MARKER)) {
          staleLeak.push(`${c.name}: 正常态泄漏陈旧告警标记`);
        }
      } catch (e) {
        broken.push(`${c.name}: 统一路径抛未捕获异常 — ${(e as Error).message}`);
      }
    }
    expect(broken, `统一注入路径故障：\n${broken.join('\n')}`).toEqual([]);
    // 正常态（进程加载后 dist 未重建）不应出现陈旧告警 —— 若 wrap 残留重复追加会在此暴露
    expect(staleLeak, `重复/泄漏注入：\n${staleLeak.join('\n')}`).toEqual([]);
  }, 30_000);
});
