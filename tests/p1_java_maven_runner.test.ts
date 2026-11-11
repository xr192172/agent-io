/**
 * Java LanguagePack ②（第⑬项队列）—— maven/gradle runner 的机器回归。
 *
 * 覆盖：
 * ① scanTestObjects 扫 Java 形态（约定命名 / main 下不扫 / 非约定不扫）
 * ② detectRunner 的 maven / gradle 两态识别
 * ③ **路径 → 全限定类名的映射**（真跑：映射错了 mvn 一个测试也跑不到，pass 必为 0）
 * ④ ★ 审计 D4-3（P1）：**陈旧 surefire XML 不得冒充本次结果**——预埋一份"旧绿"再让 mvn 失败，
 *    判定不得返回旧 pass（真 mvn 跑编译失败 + 盘上假绿 XML）
 * ⑤ 对照正例：真跑通过的 mvn ⇒ 本次 XML 新鲜 ⇒ pass 数**来自本次**（否则"④ 永远返回 0"也能过，
 *    那④就没有鉴别力了）
 * ⑥ 新鲜度判据的三态单点（fresh / stale / missing，直接调 `readSurefireAttribution`）
 *
 * ★ 环境：本机 Maven 3.9.9 + JDK 17 已装、`~/.m2` 有 junit-jupiter 5.10.2 ⇒ 真跑。
 *   缺 mvn/java 时**明示 skip**（skip 不是 pass：TAP 里单独计数，不会变成假绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanTestObjects, JAVA_TEST_OBJECT_RE } from '../src/application/design/verified_snapshot.js';
import { detectRunner, readSurefireAttribution } from '../src/application/verify/verify_project.js';

// ───────── 夹具：一个最小可跑 maven 工程（junit5 + surefire 3.2.5，与本仓 tests/fixtures/java-proj 同版本）─────────
const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>mvn-runner-fixture</artifactId>
  <version>0.0.1</version>
  <packaging>jar</packaging>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`;

/** 造一个临时 maven 工程（返根目录）；`testSrc` 写进 src/test/java/com/example/<cls>.java */
function makeMavenProject(cls: string, testSrc: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvn-runner-'));
  fs.writeFileSync(path.join(root, 'pom.xml'), POM);
  const dir = path.join(root, 'src', 'test', 'java', 'com', 'example');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cls}.java`), testSrc);
  return root;
}

/** 一条 surefire testsuite XML（`tests` 条全过 —— 用来伪造"上一次的绿"） */
function fakeGreenXml(tests: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="com.example.X" time="0.012" tests="${tests}" errors="0" skipped="0" failures="0">
  <testcase name="ok" classname="com.example.X" time="0.001"/>
</testsuite>
`;
}

/** 本机有没有 mvn（跑不了就明示 skip，不假装） */
function mvnAvailable(root: string): boolean {
  return detectRunner(root).runner?.kind === 'maven';
}

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

test('java-pack② · ③路径→全限定类名（真跑）：映射错了 mvn 一个测试也跑不到 ⇒ pass=0', { timeout: 180_000 }, (t) => {
  // ★ 2026-11-12：原写法是**字面量锚**（读源码文本断言含 `-Dtest=` / 正则字面量）——
  //   存在类判据，改坏映射逻辑它照样绿。现改为**真跑**：测试类在 src/test/java/com/example/MappedTest.java，
  //   runner 必须由路径推对 FQCN，mvn 才能跑它并从 TEST-com.example.MappedTest.xml 归因出 pass=1。
  const root = makeMavenProject(
    'MappedTest',
    `package com.example;
public class MappedTest {
  @org.junit.jupiter.api.Test
  void ok() { org.junit.jupiter.api.Assertions.assertEquals(2, 1 + 1); }
}
`,
  );
  try {
    if (!mvnAvailable(root)) {
      t.skip('本机 mvn 不可用 ⇒ 真跑类不可判（skip ≠ pass）');
      return;
    }
    const rel = 'src/test/java/com/example/MappedTest.java';
    const [res] = detectRunner(root).runner!.run([rel]);
    assert.equal(res.file, rel, '逐文件归因：file 原样回填');
    assert.equal(res.rc, 0, `映射正确 ⇒ mvn 绿（tail=${res.tail}）`);
    assert.equal(res.pass, 1, `pass 数来自本次 XML（应 1，实得 ${res.pass}）`);
    assert.equal(res.fail, 0, '无失败');
    assert.equal(res.verdict, 'pass', '可归因 ⇒ verdict=pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('java-pack② · ④★审计 D4-3：mvn 失败但盘上有旧绿 XML ⇒ 不得返回旧 pass（真跑）', { timeout: 180_000 }, (t) => {
  // 场景（审计原样）：磁盘上留着**上一次**的 TEST-<fqcn>.xml；本次 mvn 因编译失败**没跑起来**。
  // 旧实现：读到旧 XML 的 tests=7/failures=0 ⇒ pass=7 + rc=0 ⇒ 假绿。
  const root = makeMavenProject(
    'StaleTest',
    `package com.example;
public class StaleTest {
  @org.junit.jupiter.api.Test
  void broken() { int x = "这不是 int"; } // ★ 编译失败 ⇒ mvn test 必红、必不产出 XML
}
`,
  );
  try {
    if (!mvnAvailable(root)) {
      t.skip('本机 mvn 不可用 ⇒ 真跑类不可判（skip ≠ pass）');
      return;
    }
    const rel = 'src/test/java/com/example/StaleTest.java';
    const fqcn = 'com.example.StaleTest';
    const xmlPath = path.join(root, 'target', 'surefire-reports', `TEST-${fqcn}.xml`);
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    // ★ 埋一份"刚写下的绿"（mtime = 现在）—— 只靠时间戳闸**拦不住**它（在容差内），
    //   必须靠"跑前按类清旧"那道闸 ⇒ 这条用例真正钉的是**清旧**这一步。
    fs.writeFileSync(xmlPath, fakeGreenXml(7));
    assert.ok(fs.existsSync(xmlPath), '预置条件：盘上有一份旧绿 XML');

    const [res] = detectRunner(root).runner!.run([rel]);

    assert.equal(res.pass, 0, `★ 不得返回旧 pass（旧 XML 说 7 条全过），实得 pass=${res.pass}`);
    assert.equal(res.fail, 0, '也不许伪造失败数（不可归因）');
    assert.notEqual(res.rc, 0, 'mvn 编译失败 ⇒ rc 按进程退出码如实（非 0）');
    assert.equal(res.verdict, 'unsupported', '不可归因 ⇒ verdict=unsupported（不是 pass，也不是 fail）');
    assert.match(res.tail, /陈旧产物|不可归因/, `tail 要说清为什么不可归因，实得：${res.tail}`);
    assert.ok(!fs.existsSync(xmlPath), '闸①：本次目标类的旧 XML 必须在跑前被清掉');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('java-pack② · ⑤对照正例：mvn 真通过 ⇒ 本次 XML 新鲜 ⇒ pass 来自本次（④的鉴别力靠它）', { timeout: 180_000 }, (t) => {
  const root = makeMavenProject(
    'GreenTest',
    `package com.example;
public class GreenTest {
  @org.junit.jupiter.api.Test
  void a() { org.junit.jupiter.api.Assertions.assertTrue(true); }
  @org.junit.jupiter.api.Test
  void b() { org.junit.jupiter.api.Assertions.assertEquals(3, 1 + 2); }
}
`,
  );
  try {
    if (!mvnAvailable(root)) {
      t.skip('本机 mvn 不可用 ⇒ 真跑类不可判（skip ≠ pass）');
      return;
    }
    const rel = 'src/test/java/com/example/GreenTest.java';
    // 同一条路径上先埋一份**假的** 99 条绿：真跑必须覆盖它（说明读数来自本次、不是残留）
    const xmlPath = path.join(root, 'target', 'surefire-reports', 'TEST-com.example.GreenTest.xml');
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    fs.writeFileSync(xmlPath, fakeGreenXml(99));

    const [res] = detectRunner(root).runner!.run([rel]);

    assert.equal(res.rc, 0, `mvn 绿（tail=${res.tail}）`);
    assert.equal(res.pass, 2, `pass 来自本次 XML（本类 2 条，而不是残留的 99），实得 ${res.pass}`);
    assert.equal(res.fail, 0, '无失败');
    assert.equal(res.verdict, 'pass', '可归因 ⇒ verdict=pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('java-pack② · ⑥新鲜度判据三态单点：fresh / stale / missing（陈旧产物不得冒充本次结果）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvn-fresh-'));
  try {
    const reportDir = path.join('target', 'surefire-reports');
    const xmlPath = path.join(root, reportDir, 'TEST-com.example.FreshTest.xml');
    const startedAt = Date.now();

    // missing：文件不在
    assert.deepEqual(
      readSurefireAttribution(root, 'com.example.FreshTest', startedAt, reportDir),
      { kind: 'missing' },
      '没有 XML ⇒ missing（不可归因，不是"0 条通过"）',
    );

    // fresh：本次写下的（mtime 在 startedAt 之后）
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    fs.writeFileSync(xmlPath, fakeGreenXml(3));
    const fresh = readSurefireAttribution(root, 'com.example.FreshTest', startedAt, reportDir);
    assert.equal(fresh.kind, 'fresh', `mtime ≥ 启动时刻 ⇒ fresh（实得 ${JSON.stringify(fresh)}）`);
    assert.deepEqual(fresh, { kind: 'fresh', tests: 3, failures: 0 }, '正则在本次产物上抽到 tests=3/failures=0');

    // stale：把 mtime 拨回一小时前（= 上一次跑的产物）
    const anHourAgo = new Date(Date.now() - 3600_000);
    fs.utimesSync(xmlPath, anHourAgo, anHourAgo);
    const stale = readSurefireAttribution(root, 'com.example.FreshTest', Date.now(), reportDir);
    assert.equal(stale.kind, 'stale', `mtime 早于启动时刻 ⇒ stale（实得 ${JSON.stringify(stale)}）—— 不许读它的计数`);

    // failures/errors 累加口径（fresh 时）
    fs.writeFileSync(
      xmlPath,
      fakeGreenXml(4).replace('failures="0"', 'failures="1"').replace('errors="0"', 'errors="2"'),
    );
    const bad = readSurefireAttribution(root, 'com.example.FreshTest', startedAt, reportDir);
    assert.deepEqual(bad, { kind: 'fresh', tests: 4, failures: 3 }, 'failures 与 errors 累加（1+2）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
