/**
 * exec_guard 测试 —— 外部命令可用性守卫
 *
 * 背景（为什么必须有它）：Windows 上 spawn 一个**不在 PATH 上**的命令要白等约 5.1 秒
 * （不是"立刻失败"）。实测它一次牵出三个"神秘 5 秒"：
 *   resolveProjectRoot 5112ms / harvest_decisions 5169ms / harvest_from_url 5183ms，
 *   并把 tests/server_registry.stale_build 的 5s 超时打爆。
 *
 * 覆盖：
 *   - findOnPath：真实存在的命令能找到；瞎编的返回 null
 *   - commandAvailable：不存在的命令 ⇒ false 且**被缓存**（第二次调用零 spawn）
 *   - probeArgs:null ⇒ 只查 PATH 不复核
 *   - clearCommandAvailabilityCache ⇒ 缓存真的可清（测试隔离）
 */
import { describe, it, expect } from 'vitest';
import { findOnPath, commandAvailable, clearCommandAvailabilityCache, gitAvailable } from '../../src/infrastructure/exec_guard.js';
import { execSync } from 'node:child_process';

const BOGUS = 'definitely-not-a-command-xyz-9f3a';

describe('findOnPath（纯 fs，不 spawn）', () => {
  it('真实存在的命令能找到（node 一定在，测试进程就是它）', () => {
    expect(findOnPath('node')).toBeTruthy();
  });

  it('瞎编的命令返回 null', () => {
    expect(findOnPath(BOGUS)).toBeNull();
    expect(findOnPath('')).toBeNull();
  });
});

describe('commandAvailable（带记忆化）', () => {
  it('不存在的命令 ⇒ false，且重复调用结果一致（不会反复 spawn）', () => {
    clearCommandAvailabilityCache();
    expect(commandAvailable(BOGUS)).toBe(false);
    expect(commandAvailable(BOGUS)).toBe(false);
    expect(commandAvailable(BOGUS, { probeArgs: null })).toBe(false);
  });

  it('存在但不复核（probeArgs:null）⇒ true；node 本身可复核 ⇒ true', () => {
    clearCommandAvailabilityCache();
    expect(commandAvailable('node', { probeArgs: null })).toBe(true);
    expect(commandAvailable('node')).toBe(true);
  });

  it('clearCommandAvailabilityCache 后结论可重建（不残留旧值）', () => {
    clearCommandAvailabilityCache();
    expect(commandAvailable(BOGUS)).toBe(false);
    clearCommandAvailabilityCache();
    expect(commandAvailable(BOGUS)).toBe(false);
  });
});

describe('gitAvailable', () => {
  it('与"环境里是否真有 git"一致（不猜，用真实环境校准）', () => {
    clearCommandAvailabilityCache();
    let really = false;
    try {
      execSync('git --version', { stdio: 'ignore', timeout: 10_000 });
      really = true;
    } catch {
      really = false;
    }
    expect(gitAvailable()).toBe(really);
  });
});
