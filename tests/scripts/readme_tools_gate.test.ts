/**
 * readme_tools_gate —— README 工具数自愈+遗漏提示 测试
 *
 * 覆盖 analyzeReadmeTools 核心：数字一致/漂移时自愈、零提及工具收集、占位缺失报错。
 */
import { describe, it, expect } from 'vitest';
import { analyzeReadmeTools, registryToolNames, readToolSources } from '../../scripts/readme_tools_gate.mjs';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('readme_tools_gate', () => {
  it('registryToolNames：从 server_registry 源码提取 name 集合', () => {
    const reg = "const a={name:'get_dsl'};const b={name:'edit_dsl',x:1};const c={name:'find_ref',y:'name:'};";
    const names = registryToolNames(reg);
    expect(names.has('get_dsl')).toBe(true);
    expect(names.has('edit_dsl')).toBe(true);
    expect(names.has('find_ref')).toBe(true);
    expect(names.size).toBe(3);
  });

  it('analyzeReadmeTools：数字一致 → changed=false，updatedReadme 不变', () => {
    const reg = "name:'a';name:'b'";
    const readme = '共注册 **2 个 MCP 工具\n\n`a` 和 `b` 都是工具';
    const r = analyzeReadmeTools(reg, readme);
    expect(r.claimed).toBe(2);
    expect(r.actual).toBe(2);
    expect(r.changed).toBe(false);
    expect(r.updatedReadme).toBe(readme);
    expect(r.missingFromReadme).toEqual([]);
  });

  it('analyzeReadmeTools：数字漂移 → changed=true，updatedReadme 自愈数字', () => {
    const reg = "name:'a';name:'b';name:'c'"; // 真实 3
    const readme = '共注册 **2 个 MCP 工具\n\n`a` 和 `b` 可用'; // 声称 2
    const r = analyzeReadmeTools(reg, readme);
    expect(r.claimed).toBe(2);
    expect(r.actual).toBe(3);
    expect(r.changed).toBe(true);
    expect(r.updatedReadme).toContain('共注册 **3 个 MCP 工具');
    // c 未在 README 提及 → 零提及
    expect(r.missingFromReadme).toContain('c');
  });

  it('analyzeReadmeTools：零提及只收已注册名，忽略非注册 backtick', () => {
    const reg = "name:'real_tool'";
    const readme = '共注册 **1 个 MCP 工具\n\n`real_tool` 与 `fake_tool` 不同';
    const r = analyzeReadmeTools(reg, readme);
    expect(r.missingFromReadme).toEqual([]); // real_tool 被提及，fake_tool 非注册名
  });

  it('analyzeReadmeTools：README 缺占位 → 抛错', () => {
    const reg = "name:'a'";
    expect(() => analyzeReadmeTools(reg, '# 无工具占位')).toThrow(/共注册/);
  });

  it('self dogfood：真实工具定义源与 README 数字一致', () => {
    // ★ P1b（2026-09-28）：工具定义已从 server_registry.ts 搬进 src/registry/lanes/*.ts。
    //   本用例原先直接读 server_registry.ts ⇒ lane 拆分后扫出 0 个工具、误报红。
    //   改用 readToolSources（扫目录）—— 门不该跟着被搬走的代码一起失效。
    const regSrc = readToolSources(repoRoot);
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf-8');
    const r = analyzeReadmeTools(regSrc, readme);
    expect(r.changed).toBe(false); // README 数字已与注册表一致，防回归漂移
    // ★ 2026-10-02：原为 `expect(r.actual).toBe(58)` —— 那是个**会过期的人工数字**（新增工具即红，
    //   且与 G1 快照、README、capability_map 各存一份 ⇒ 同一判据的 N 份副本）。
    //   改为与**运行时注册数**比对：这条交叉验证才有独立价值 ——
    //   `r.actual` 来自对**源码文本**的解析，`TOOL_DEFS.length` 来自**运行时**，
    //   两者相等说明"文本解析器"没坏（而不是"我抄的数字对上了"）。
    expect(r.actual).toBe(TOOL_DEFS.length);
  });
});