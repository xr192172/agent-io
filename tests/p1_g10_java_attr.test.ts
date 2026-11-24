/**
 * G10 把守测试 · Java 夹具路径归因退化闭合（2026-11-24，阶段 1 静态缺口闭合 G-3 批）。
 *
 * 覆盖：
 * ① 路径 → FQCN：仓根级 / 子项目 repo-relative / 嵌套子项目任意前缀段，均能剥到 `src/test/java/` 段；
 *    反例（main 下、非 .java、缺约定段）⇒ null（不猜类名）。
 * ② 归因三字段：真跑 mvn 的结果同时回填 fqcn / xml_path / report_dir（不假绿、可复核）。
 * ③ 夹具清单只读探针：嵌套聚合工程 + 自定义 surefire 报告目录结构就位；自定义目录可注入归因。
 * ④ 鲜度闸②-b：除 mtime 外比对 XML 内 `timestamp` 属性——旧 timestamp 即便 mtime 新也判 stale；
 *    timestamp 缺失/不可解析不据此放宽（mtime 闸兜底，fail-closed）。
 *
 * ★ 真跑用例沿用 p1_java_maven_runner 口径：缺 mvn 明示 skip（skip ≠ pass）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectRunner, readSurefireAttribution, javaFqcnOfPath } from '../src/application/verify/verify_project.js';

// ───────── ① 纯函数：路径 → FQCN（不碰磁盘）─────────
test('G10 · ①javaFqcnOfPath：仓根级 / 子项目 repo-relative / 嵌套子项目任意前缀段', () => {
  // 仓根级（旧实现就支持）
  assert.equal(
    javaFqcnOfPath('src/test/java/com/example/AxTest.java'),
    'com.example.AxTest',
    '仓根级 src/test/java 映射 FQCN',
  );
  // 子项目委托：repo-relative（subRoot 之上有 tests/fixtures/... 前缀）—— G10 病根场景
  assert.equal(
    javaFqcnOfPath('tests/fixtures/java-proj/src/test/java/com/example/GreeterImplTest.java'),
    'com.example.GreeterImplTest',
    'repo-relative 子项目路径：剥任意目录前缀后映射 FQCN',
  );
  // 嵌套聚合工程：modules/foo 之下再有 src/test/java 段
  assert.equal(
    javaFqcnOfPath('tests/fixtures/java-multi/modules/foo/src/test/java/com/foo/FooNestedTest.java'),
    'com.foo.FooNestedTest',
    '嵌套子项目：多级前缀后映射 FQCN',
  );
  // Windows 反斜杠归一
  assert.equal(
    javaFqcnOfPath('tests\\fixtures\\java-multi\\modules\\foo\\src\\test\\java\\com\\foo\\FooNestedTest.java'),
    'com.foo.FooNestedTest',
    '反斜杠路径归一后映射',
  );
});

test('G10 · ①javaFqcnOfPath：反例 ⇒ null（不猜类名）', () => {
  assert.equal(javaFqcnOfPath('src/main/java/com/example/Greeter.java'), null, 'main 源码不是测试类 ⇒ null');
  assert.equal(javaFqcnOfPath('src/test/resources/GreeterMapper.xml'), null, '非 .java ⇒ null');
  assert.equal(javaFqcnOfPath('tests/fixtures/java-proj/tools/MyBatisMapperDump.java'), null, '无 src/test/java 段 ⇒ null');
  assert.equal(javaFqcnOfPath(''), null, '空路径 ⇒ null');
});

// ───────── ③ 夹具清单只读探针：嵌套子项目 + 自定义报告目录 ─────────
test('G10 · ③夹具清单：嵌套聚合工程结构就位（只读断言，不真跑）', () => {
  const fx = path.join('tests', 'fixtures', 'java-multi');
  assert.ok(fs.existsSync(path.join(fx, 'pom.xml')), '聚合 pom.xml 存在');
  assert.ok(fs.existsSync(path.join(fx, 'modules', 'foo', 'pom.xml')), '子项目 pom.xml 存在');
  const testRel = path.join('modules', 'foo', 'src', 'test', 'java', 'com', 'foo', 'FooNestedTest.java');
  assert.ok(fs.existsSync(path.join(fx, testRel)), '嵌套测试类就位');
  // 子 pom 自定义报告目录：reportsDirectory = target/custom-reports（非默认 surefire-reports）
  const childPom = fs.readFileSync(path.join(fx, 'modules', 'foo', 'pom.xml'), 'utf8');
  assert.match(childPom, /reportsDirectory>\$\{project\.build\.directory\}\/custom-reports/, '子 pom 声明自定义报告目录');
  // 清单锚点：嵌套测试类经纯函数映射得 com.foo.FooNestedTest
  assert.equal(
    javaFqcnOfPath(path.join(fx, testRel)),
    'com.foo.FooNestedTest',
    '夹具清单路径与 FQCN 映射自洽',
  );
});

test('G10 · ③自定义报告目录可注入归因（readSurefireAttribution reportDir 参数）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g10-custom-reports-'));
  try {
    const customDir = path.join('target', 'custom-reports');
    const fqcn = 'com.example.CustomDirTest';
    const xmlPath = path.join(root, customDir, `TEST-${fqcn}.xml`);
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    fs.writeFileSync(
      xmlPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${fqcn}" time="0.01" tests="2" errors="0" skipped="0" failures="0" timestamp="${new Date().toISOString()}">
  <testcase name="a" classname="${fqcn}" time="0.001"/>
  <testcase name="b" classname="${fqcn}" time="0.001"/>
</testsuite>
`,
    );
    const fresh = readSurefireAttribution(root, fqcn, Date.now(), customDir);
    assert.equal(fresh.kind, 'fresh', `自定义目录下的本次 XML 可读（实得 ${JSON.stringify(fresh)}）`);
    assert.deepEqual(fresh, { kind: 'fresh', tests: 2, failures: 0 }, '自定义目录归因计数正确');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ───────── ④ 鲜度闸②-b：XML 内 timestamp 属性比对 ─────────
function stampXml(tests: number, stamp: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.StampTest" time="0.01" tests="${tests}" errors="0" skipped="0" failures="0" timestamp="${stamp}">
  <testcase name="ok" classname="com.example.StampTest" time="0.001"/>
</testsuite>
`;
}

test('G10 · ④timestamp 旧于本次启动 ⇒ stale（即便 mtime 新，闸②-b 拦住旧产物）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g10-stamp-old-'));
  try {
    const fqcn = 'com.example.StampTest';
    const xmlPath = path.join(root, 'target', 'surefire-reports', `TEST-${fqcn}.xml`);
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    // timestamp = 一小时前；mtime 由 writeFileSync 取当前（旧 mtime 闸拦不住）
    fs.writeFileSync(xmlPath, stampXml(3, new Date(Date.now() - 3600_000).toISOString()));
    const stale = readSurefireAttribution(root, fqcn, Date.now(), 'target/surefire-reports');
    assert.equal(stale.kind, 'stale', `XML 内 timestamp 早于启动 ⇒ stale（实得 ${JSON.stringify(stale)}）`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('G10 · ④timestamp 为本次时刻 ⇒ fresh；timestamp 缺失不据此放宽（mtime 兜底）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g10-stamp-new-'));
  try {
    const fqcn = 'com.example.StampTest';
    const rel = 'target/surefire-reports';
    const xmlPath = path.join(root, rel, `TEST-${fqcn}.xml`);
    fs.mkdirSync(path.dirname(xmlPath), { recursive: true });
    fs.writeFileSync(xmlPath, stampXml(2, new Date().toISOString()));
    const fresh = readSurefireAttribution(root, fqcn, Date.now(), rel);
    assert.equal(fresh.kind, 'fresh', `本次 timestamp ⇒ fresh（实得 ${JSON.stringify(fresh)}）`);

    // timestamp 不可解析（坏字符串）⇒ 不据此判 stale，落 mtime 闸：刚写下的 ⇒ fresh（不假拦）
    fs.writeFileSync(xmlPath, stampXml(2, 'not-a-timestamp'));
    const badStamp = readSurefireAttribution(root, fqcn, Date.now(), rel);
    assert.equal(badStamp.kind, 'fresh', 'timestamp 不可解析 ⇒ 不据此放宽也不据此误杀，mtime 兜底 fresh');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ───────── ② 归因三字段：真跑 mvn 结果回填 fqcn / xml_path / report_dir ─────────
const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>g10-attr-fixture</artifactId>
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

function makeMavenProject(cls: string, testSrc: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g10-attr-'));
  fs.writeFileSync(path.join(root, 'pom.xml'), POM);
  const dir = path.join(root, 'src', 'test', 'java', 'com', 'example');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${cls}.java`), testSrc);
  return root;
}

test('G10 · ②真跑：归因结果并列给出 fqcn / xml_path / report_dir', { timeout: 180_000 }, (t) => {
  const root = makeMavenProject(
    'AttrFieldsTest',
    `package com.example;
public class AttrFieldsTest {
  @org.junit.jupiter.api.Test
  void ok() { org.junit.jupiter.api.Assertions.assertEquals(2, 1 + 1); }
}
`,
  );
  try {
    if (detectRunner(root).runner?.kind !== 'maven') {
      t.skip('本机 mvn 不可用 ⇒ 真跑类不可判（skip ≠ pass）');
      return;
    }
    const rel = 'src/test/java/com/example/AttrFieldsTest.java';
    const [res] = detectRunner(root).runner!.run([rel]);
    assert.equal(res.verdict, 'pass', `可归因 ⇒ pass（tail=${res.tail}）`);
    assert.equal(res.fqcn, 'com.example.AttrFieldsTest', '归因回填 fqcn');
    assert.equal(res.report_dir, 'target/surefire-reports', '归因回填报告目录');
    assert.ok(
      res.xml_path && res.xml_path.endsWith(path.join('target', 'surefire-reports', 'TEST-com.example.AttrFieldsTest.xml')),
      `归因回填 XML 绝对路径（实得 ${res.xml_path}）`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
