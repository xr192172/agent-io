/**
 * P1 · **CI-fix C1 把守**：esbuild 可选二进制包名按平台/架构推导，不硬编码 win32-x64。
 *
 * ## 背景（诊断 §4.1）
 * 原 `check-toolchain-intact.mjs` CRITICAL 清单写死 `@esbuild/win32-x64` ⇒ Linux runner 上
 * 这道断言必红（linux 装 `@esbuild/linux-x64`，win32 包 npm 根本不装）。根治为按
 * `process.platform`/`process.arch` 推导当前平台包；别平台二进制是 optional，本机不出现不算坏。
 *
 * ## 判据（破坏哪一条都会红）
 * ① 各 platform/arch 组合映射到对应 `@esbuild/<platform>-<arch>` 包名。
 * ② Linux 平台推导结果**不含** win32（回退硬编码 win32-x64 ⇒ 此条红，突变牙）。
 * ③ 默认参数取当前 process.platform/arch。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esbuildOptionalPkg } from '../scripts/check-toolchain-intact.mjs';

test('① 平台/架构组合映射到对应 esbuild 可选包名', () => {
  assert.equal(esbuildOptionalPkg('win32', 'x64'), '@esbuild/win32-x64');
  assert.equal(esbuildOptionalPkg('win32', 'arm64'), '@esbuild/win32-arm64');
  assert.equal(esbuildOptionalPkg('linux', 'x64'), '@esbuild/linux-x64');
  assert.equal(esbuildOptionalPkg('linux', 'arm64'), '@esbuild/linux-arm64');
  assert.equal(esbuildOptionalPkg('darwin', 'x64'), '@esbuild/darwin-x64');
  assert.equal(esbuildOptionalPkg('darwin', 'arm64'), '@esbuild/darwin-arm64');
});

test('② 突变把守：Linux 平台推导结果不含 win32（回退硬编码 ⇒ 红）', () => {
  for (const arch of ['x64', 'arm64']) {
    const pkg = esbuildOptionalPkg('linux', arch);
    assert.ok(pkg.startsWith('@esbuild/linux-'), `linux/${arch} 应为 linux 包，实得 ${pkg}`);
    assert.ok(!pkg.includes('win32'), `linux 包名不得含 win32，实得 ${pkg}`);
  }
});

test('③ 默认参数取当前进程平台/架构', () => {
  const expect = `@esbuild/${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch}`;
  assert.equal(esbuildOptionalPkg(), expect);
});
