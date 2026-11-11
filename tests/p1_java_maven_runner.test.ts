/**
 * Java LanguagePack ②（第⑬项队列）—— maven/gradle runner 的机器回归。
 *
 * 验收（lead 三条）：runner 识别（假 root，不依赖真 mvn）/ scanTestObjects 扫 Java 形态 /
 * XML 归因的正则解析。集成验收（真 mvn test 对夹具）由主控跑（Maven 3.9.9 已装）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanTestObjects, JAVA_TEST_OBJECT_RE } from '../src/application/design/verified_snapshot.js';
import { detectRunner } from '../src/application/verify/verify_project.js';

test('java-pack② · ①scanTestObjects：surefire 约定形态（src/test/java/**/*Test.java）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvn-scan-'));
  try {
    // 主代码（不是测试对象）+ 测试代码（是）+ 非约定命名（不是）
    fs.mkdirSync(path.join(root, 'src', 'main', 'java', 'com', 'example'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'test', 'java', 'com', 'example'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'main', 'java', 'com', 'example', 'Greeter.java'), 'class Greeter {}');
    fs.writeFileSync(path.join(root, 'src', 'test', 'java', 'com', 'example', 'GreeterImplTest.java'), 'class GreeterImplTest {}');
    fs.writeFileSync(path.join(root, 'src', 'test', 'java', 'com', 'example', 'HelperTests.java'), 'class HelperTests {}');
    fs.writeFileSync(path.join(root, 'src', 'test', 'java', 'com', 'example', 'NotATest.java'), 'class NotATest {}');
    fs.writeFileSync(path.join(root, 'src', 'test', 'java', 'com', 'example', 'Util.java'), 'class Util {}');
    const scanned = scanTestObjects(root);
    assert.ok(scanned.some((s) => s.endsWith('GreeterImplTest.java')), '约定命名 *Test.java 扫到');
    assert.ok(scanned.some((s) => s.endsWith('HelperTests.java')), '*Tests.java 扫到');
    // ★ 反例修正（2026-11-11 lead 验收）：`NotATest.java` 以 `Test` **结尾** ⇒ surefire 约定 *会* 命中
    //   （`(\w+(Test|Tests|TestCase))\.java$` 只看结尾形态）——它不是反例！真反例 = 不以约定后缀结尾的（Util.java）。
    assert.ok(scanned.some((s) => s.endsWith('NotATest.java')), 'NotATest 以 Test 结尾 ⇒ 按约定形态扫到（非反例）');
    assert.ok(!scanned.some((s) => s.endsWith('Util.java')), '非约定命名（Util.java 不以 Test/Tests/TestCase 结尾）不扫');
    assert.ok(!scanned.some((s) => s.endsWith('Greeter.java')), 'main 源码不是测试对象');
    // 正则单点
    assert.ok(JAVA_TEST_OBJECT_RE.test('src/test/java/com/example/AxTest.java'), '正则命中');
    assert.ok(!JAVA_TEST_OBJECT_RE.test('src/main/java/com/example/AxTest.java'), 'main 下不命中');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('java-pack② · ②detectRunner：pom.xml + mvn 可用性两态（假 root，mvn 探测真实执行）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvn-detect-'));
  try {
    // 无 pom.xml ⇒ 不是 maven（掉到 node-test 兜底或其它）
    const r0 = detectRunner(root);
    assert.notEqual(r0.runner?.kind, 'maven', '无 pom ⇒ 不识别为 maven');
    // 有 pom.xml ⇒ 探测 mvn（本机 3.9.9 已装 ⇒ maven；未装 ⇒ null + 如实 why——两态都合法）
    fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
    const r1 = detectRunner(root);
    if (r1.runner?.kind === 'maven') {
      // ★ why 文案含反引号（'`mvn -v` 可用'）——断言锚用「Maven runner」这个稳定短语
      assert.match(r1.why, /Maven runner/, '识别为 maven 时 why 说明探测依据');
    } else {
      assert.equal(r1.runner, null, 'mvn 不可用 ⇒ runner=null');
      assert.match(r1.why, /mvn -v 不可用/, 'why 如实说明 mvn 不在 PATH');
    }
    // gradlew 存在 ⇒ gradle（wrapper 不要求全局 gradle）
    fs.writeFileSync(path.join(root, 'gradlew.bat'), '@echo off');
    fs.writeFileSync(path.join(root, 'gradlew'), '#!/bin/sh');
    // ★ 修（2026-11-11 lead 验收）：原写法 `{...root} as never` 把**字符串展开成字符对象**传参 ⇒
    //   detectRunner 内部 path.join 失败/行为不定。pom.xml 仍存在 ⇒ maven 优先（顺序兜底约定）。
    const r2 = detectRunner(root);
    if (r2.runner) assert.notEqual(r2.runner.kind, 'gradle', 'pom 存在时 maven 优先（顺序兜底）');
    // 删掉 pom ⇒ gradle 识别（wrapper 存在即认，不探测全局 gradle）
    fs.unlinkSync(path.join(root, 'pom.xml'));
    const r3 = detectRunner(root);
    assert.equal(r3.runner?.kind, 'gradle', 'gradlew 存在 ⇒ gradle runner');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('java-pack② · ③归因映射：测试文件 → 全限定类名（javaTestClassOf 的同款正则）', () => {
  // javaTestClassOf 是 verify_project.ts 的模块私有函数 ⇒ 用**字面量锚定**钉住映射行为
  // （改 verify_project 的映射必须同步这里——防映射漂移）
  const s = fs.readFileSync(new URL('../src/application/verify/verify_project.ts', import.meta.url), 'utf8');
  // ★ 锚的转义层数（2026-11-11 修正）：源文件里正则字面量文本 = `match(/^src\/test\/java\/(.+)\.java$)`
  //   （每处分隔符前是**一个**反斜杠字符）。测试串在 TS 双引号里 `\\/` 解析为反斜杠+斜杠 ✓；原先写
  //   `\\\\/`（4 个字符）解析成两个反斜杠 ⇒ 比源码多一倍 ⇒ 恒 false（实测）。
  assert.ok(s.includes('match(/^src\\/test\\/java\\/(.+)\\.java$/)'), '映射正则必须在（剥 src/test/java 前缀）');
  assert.ok(s.includes("replace(/\\//g, '.')"), '斜杠转点必须在（包路径）');
  assert.ok(s.includes('-Dtest='), 'maven 的 -Dtest 必须在');
  assert.ok(s.includes('surefire-reports'), 'surefire XML 归因必须在');
});
