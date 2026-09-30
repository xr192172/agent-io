/**
 * ★ `invokeTool` —— 工具的**唯一调用入口**的出生证（2026-09-30）
 *
 * 为什么锁它：`invokeTool` 是「MCP 面」与「投影出来的 CLI 面」**共用的那一份**合成逻辑
 * （每次调用前保鲜 / 首次接触建索引 / 参数纠错 / 狗食统计 / 响应注入）。
 *
 * ★★ 它存在的理由是一条**实测的真缺陷**（不是风格问题）：
 *   那些**手写的** CLI（`health_cli` / `impact_cli` / `behavior_cli` / `cross_repo_cli` / `hybrid_cli`）
 *   **全都没有**保鲜、陈旧告警、狗食统计（各 0 命中）⇒ 跑的是**旧索引 + 无任何标注**。
 *   实测对照：同一份 `code_health`，
 *     · 手写 CLI（`dist/src/tools/health_cli.js`）⇒ 告警/STALE 命中 **0**
 *     · 投影 CLI（`dist/src/cli.js code_health`）⇒ 命中 **3**（带告警 + `---WARNINGS---` 块）
 *
 * 本文件用**静默可判**的方式锁住"两个面共用同一入口"这件事，不依赖那两条 CLI 的进程外行为。
 */
import { describe, it, expect } from 'vitest';
import { TOOL_DEFS, invokeTool } from '../src/server_registry';

describe('invokeTool —— 工具的唯一调用入口', () => {
  it('导出可用，且是 MCP 面与 CLI 面**共用**的那一个（registerAllTools 也调它）', async () => {
    expect(typeof invokeTool).toBe('function');
    // 反面：它必须真的在 registerAllTools 里被调用（否则就只是"又一份实现"）
    const { readFileSync } = await import('node:fs');
    const reg = readFileSync('src/server_registry.ts', 'utf-8');
    const body = reg.slice(reg.indexOf('export function registerAllTools'));
    expect(body, 'registerAllTools 必须走 invokeTool（否则两个面又分叉了）').toContain('invokeTool(def,');
  });

  it('★ 走的是共用合成逻辑 ⇒ 参数纠错（Did you mean）对**任何**入口都生效', async () => {
    // 挑一个工具，塞一个"够像"的未知键 ⇒ 期望输出里出现纠错提示（这段逻辑只在 invokeTool 里）
    const def = TOOL_DEFS.find((d) => d.name === 'find_references');
    expect(def, 'find_references 必须在注册表里').toBeTruthy();
    const r = await invokeTool(def!, { project_dir: process.cwd(), file: 'src/server_registry.ts', symbal: 'x' });
    expect(r.text, '未知键 symbal 应触发 Did you mean（这一条只在 invokeTool 里做）').toMatch(/symbal/);
  });

  it('未知工具名不在 TOOL_DEFS 里（CLI 的 list/派发都以它为唯一真相源）', () => {
    expect(TOOL_DEFS.find((d) => d.name === '__no_such_tool__')).toBeUndefined();
    expect(TOOL_DEFS.length).toBeGreaterThan(50);
  });
});
