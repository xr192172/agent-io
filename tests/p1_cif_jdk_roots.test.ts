/**
 * P1 · **CI-fix C2 把守**：JDK 候选根按环境契约 + 平台标准位置枚举，不硬编码私有 devkit 路径。
 *
 * ## 背景（诊断 §4.2）
 * 原 `jdk.ts:224` 候选根写死 `D:/dev_hzy/devkit`、`C:/dev_hzy/devkit` ⇒ Linux runner 上枚举不到
 * 任何标准位置。根治为 `jdkCandidateRoots(env, platform)` 纯函数：显式环境
 * （AGENT_IO_JDK_HOME/JAVA_HOME）→ AGENT_IO_JDK_ROOTS 补充根 → 平台标准位置；私有布局走环境注入。
 *
 * ## 判据（破坏哪一条都会红）
 * ① Windows 候选含标准 Program Files 位，不含私有 dev_hzy 路径。
 * ② Linux 候选含 /usr/lib/jvm，不含 Windows 盘符路径，不含 dev_hzy（回退硬编码 ⇒ 红，突变牙）。
 * ③ macOS 候选含 /Library/Java/JavaVirtualMachines。
 * ④ AGENT_IO_JDK_ROOTS 按 `;`/`:` 分隔补充，且去重。
 * ⑤ 显式环境 AGENT_IO_JDK_HOME / JAVA_HOME 排在标准位置之前。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdkCandidateRoots } from '../src/infrastructure/index/jfacts/jdk.js';

test('① Windows 候选含标准 Program Files 位，不含私有 dev_hzy', () => {
  const roots = jdkCandidateRoots({}, 'win32');
  assert.ok(roots.some((r) => r.startsWith('C:/Program Files/Java')));
  assert.ok(roots.some((r) => r.startsWith('C:/Program Files/Eclipse Adoptium')));
  for (const r of roots) {
    assert.ok(!r.includes('dev_hzy'), `Windows 候选不得含 dev_hzy，实得 ${r}`);
  }
});

test('② 突变把守：Linux 候选含 /usr/lib/jvm，不含盘符路径与 dev_hzy', () => {
  const roots = jdkCandidateRoots({}, 'linux');
  assert.ok(roots.includes('/usr/lib/jvm'));
  for (const r of roots) {
    assert.ok(!/^[A-Za-z]:\//.test(r), `Linux 候选不得含 Windows 盘符，实得 ${r}`);
    assert.ok(!r.includes('dev_hzy'), `Linux 候选不得含 dev_hzy，实得 ${r}`);
  }
});

test('③ macOS 候选含系统 JVM 目录', () => {
  const roots = jdkCandidateRoots({}, 'darwin');
  assert.ok(roots.includes('/Library/Java/JavaVirtualMachines'));
});

test('④ AGENT_IO_JDK_ROOTS 按 ;/: 分隔补充且去重', () => {
  const roots = jdkCandidateRoots({ AGENT_IO_JDK_ROOTS: '/opt/my-jdk17;/opt/my-jdk21:/opt/my-jdk17' }, 'linux');
  assert.ok(roots.includes('/opt/my-jdk17'));
  assert.ok(roots.includes('/opt/my-jdk21'));
  assert.equal(roots.filter((r) => r === '/opt/my-jdk17').length, 1);
});

test('⑤ 显式环境排在标准位置之前', () => {
  const roots = jdkCandidateRoots({ AGENT_IO_JDK_HOME: '/env/jdk-home', JAVA_HOME: '/env/java-home' }, 'linux');
  assert.equal(roots[0], '/env/jdk-home');
  assert.equal(roots[1], '/env/java-home');
  const stdIdx = roots.indexOf('/usr/lib/jvm');
  assert.ok(stdIdx > 1, '标准位置应在显式环境之后');
});
