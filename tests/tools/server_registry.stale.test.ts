/**
 * STALE 检测（档位 A）纯逻辑测试：
 *   - staleBuildWarningFor：dist 重建后(加载早/当前晚) → 结构化告警；否则 null。
 *   - newestMtime：递归取目录最新 mtime；skipGen 排除 *.gen.ts 生成物（防 build 自致误判）。
 *
 * 集成路径（src 比 dist 新 → staleSourceWarning）依赖真实 src/dist 树，由 registerAllTools
 * 在每次工具调用注入；此处覆盖其核心判定原语，避免脆弱地依赖构建时序。
 *
 * ★ P-F（§16.6）：判定原语的产物已是**结构化告警** `{code, summary, detail, fix}`（不是 message），
 *   分级呈现（首次全文/后续摘要）不在这里考，见 tests/registry/tool_warnings.test.ts 与
 *   tests/registry/warning_noise_gate.test.ts。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { staleBuildWarningFor, staleSourceWarningFor, newestMtime } from '../../src/presentation/mcp/server_registry.js';

describe('staleBuildWarningFor（纯函数）', () => {
  it('dist 重建后（加载早、当前晚）→ 返回重启告警（码/摘要/说明/修复俱全）', () => {
    const w = staleBuildWarningFor(1000, 2000);
    expect(w?.code).toBe('STALE_BUILD');
    expect(w?.summary).toContain('旧代码');
    expect(w?.fix).toContain('重启');
    expect(w?.detail).toBeTruthy();
  });
  it('加载晚/当前早或相等 → null（不误报）', () => {
    expect(staleBuildWarningFor(2000, 1000)).toBeNull();
    expect(staleBuildWarningFor(2000, 2000)).toBeNull();
  });
  it('任一未知 → null（禁环境静默禁用）', () => {
    expect(staleBuildWarningFor(null, 1000)).toBeNull();
    expect(staleBuildWarningFor(1000, null)).toBeNull();
  });
});

describe('staleSourceWarningFor（纯函数）', () => {
  it('src 比 dist 新 → 结构化告警；含"先 build 再重启"的可执行修复', () => {
    const w = staleSourceWarningFor(2000, 1000);
    expect(w?.code).toBe('STALE_SOURCE');
    expect(w?.summary).toContain('dist');
    expect(w?.fix).toContain('npm run build');
    expect(w?.detail).toBeTruthy();
  });
  it('dist 不旧 / 相等 → null；任一未知 → null（静默禁用，不误报）', () => {
    expect(staleSourceWarningFor(1000, 2000)).toBeNull();
    expect(staleSourceWarningFor(1000, 1000)).toBeNull();
    expect(staleSourceWarningFor(null, 1000)).toBeNull();
    expect(staleSourceWarningFor(1000, null)).toBeNull();
  });
});

describe('newestMtime（递归 + skipGen）', () => {
  it('递归取最新 mtime；skipGen 排除 .gen.ts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-'));
    try {
      fs.mkdirSync(path.join(root, 'sub'));
      const xPath = path.join(root, 'x.ts');
      const yPath = path.join(root, 'sub', 'y.ts');
      fs.writeFileSync(xPath, '// x\n');
      fs.writeFileSync(yPath, '// y\n');
      // 把所有普通源文件 mtime 调到过去，制造「.gen.ts 是唯一更新」的对比（避免同毫秒的时序脆弱）
      const past = (Date.now() - 3000) / 1000;
      fs.utimesSync(xPath, past, past);
      fs.utimesSync(yPath, past, past);
      // 新增一个更新的生成物（skipGen 应忽略它）
      fs.writeFileSync(path.join(root, 'z.gen.ts'), '// gen\n');

      const withGen = newestMtime(root, false)!; // 含 .gen.ts → 取到最新(gen)
      const skipGen = newestMtime(root, true)!; // 跳过 .gen.ts → 取到旧 y/x
      expect(withGen).toBeGreaterThan(skipGen); // gen 更新 ⇒ withGen 更大
      expect(newestMtime(root, true)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('目录缺失/空 → null', () => {
    expect(newestMtime(path.join(os.tmpdir(), 'no-such-dir-xyz'), false)).toBeNull();
  });
});