/**
 * 任务 A 调整形态 b 步——Mapper↔XML 一致性契约的机器回归。
 *
 * ★★ 2026-11-12 审计 D4-2 重写：原文件自带**第二份交叉实现**（`replayCross`）+ **字面量锚定**
 * （`readFileSync('…/mybatis_contracts.ts').includes(...)`）。后果有两个，都不可接受：
 *   ① 改坏 `mapperConsistency` 的真实实现（例如把双向交叉删掉一半）⇒ 本文件照样全绿；
 *   ② 那个绝对路径 `D:/agentio/…` 在别处跑会因读不到文件而红，与被测对象无关。
 * 现在：**只调真函数** `mapperConsistency`（交叉/降级/注入面全在它里面），执行器经 `deps.exec` 注入；
 * 另外**真跑一遍 Java 端到端**（javac 编译接口 + 真 execJavaTool + 官方 XMLMapperBuilder），
 * 让"接口侧反射 / JSON 解析 / 类路径接线"这些只有真跑才暴露的环节进判决。
 *
 * 判据分工（两条腿都要动才算修复）：
 *   · 假执行器用例 ⇒ 钉**判定逻辑**（交叉规则、降级口径、渲染）；
 *   · 真执行用例 ⇒ 钉**接线**（工具源路径、classpath、反射、JSON），打断任一处必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { DUMP_TOOL_REL, mapperConsistency, type JavaToolExec } from '../src/application/java_tools/mybatis_contracts.js';
// ★ maven 本地仓库 / mybatis jar 定位的**唯一实现**（候选探测；别在测试里另写一份，见 ⑥ 的注释）
import { findMybatisJar, mavenLocalRepoCandidates } from '../src/infrastructure/java_tools/exec_java_tool.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_TOOL = path.join(REPO, 'tests', 'fixtures', 'java-proj', DUMP_TOOL_REL);

/** 假执行器：把给定 dump 塞进 stdout（前导一行非 JSON，验证"只认 JSON 行"） */
function execReturning(dump: unknown, seen?: { args?: readonly string[]; className?: string; cp?: readonly string[] }): JavaToolExec {
  return (_root, _toolSrc, className, cp, args) => {
    if (seen) {
      seen.args = args;
      seen.className = className;
      seen.cp = cp;
    }
    return { ok: true, stdout: `[java] 启动 MyBatisMapperDump\n${JSON.stringify(dump)}\n`, stderr: '' };
  };
}

const st = (id: string, dollarBrace = 0) => ({ id, kind: 'select', dollarBrace, hashBrace: 0 });

test('mybatis-consistency · ①双向交叉：接口有 XML 无 ⇒ xml-missing-statement', () => {
  const r = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: execReturning({ namespace: 'com.example.M', statements: [st('findByName')], interfaces: ['findByName', 'findByNameUnsafe'] }),
  });
  assert.equal(r.ok, true, '工具跑成功 ⇒ ok');
  assert.equal(r.interfaceSide, true, '接口侧可用');
  assert.equal(r.namespace, 'com.example.M', 'namespace 原样带出');
  assert.deepEqual(
    r.issues.map((i) => `${i.kind}:${i.target}`),
    ['xml-missing-statement:findByNameUnsafe'],
    `只应报"接口有 XML 无"这一条，实得 ${JSON.stringify(r.issues.map((i) => `${i.kind}:${i.target}`))}`,
  );
  assert.match(r.rendered, /xml-missing-statement/, '渲染里点名缺失语句');
});

test('mybatis-consistency · ②XML 有接口无 ⇒ xml-extra-statement（死语句/动态 SQL）', () => {
  const r = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: execReturning({ namespace: 'com.example.M', statements: [st('findByName'), st('legacySql')], interfaces: ['findByName'] }),
  });
  assert.deepEqual(
    r.issues.map((i) => `${i.kind}:${i.target}`),
    ['xml-extra-statement:legacySql'],
    'XML 多余语句 ⇒ extra',
  );
});

test('mybatis-consistency · ③注入面：dollarBrace>0 定位到具体语句 id', () => {
  const r = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: execReturning({ namespace: 'com.example.M', statements: [st('safe', 0), st('unsafe', 1)], interfaces: ['safe', 'unsafe'] }),
  });
  assert.equal(r.interfaceSide, true, '一致性也判了（两边都有）');
  const inj = r.issues.filter((i) => i.kind === 'dollar-injection');
  assert.equal(inj.length, 1, `仅 unsafe 一条注入面，实得 ${inj.length}`);
  assert.equal(inj[0].target, 'unsafe', '定位到语句 id（不是文件级）');
  assert.match(r.rendered, /dollar-injection/, '渲染里点名注入面');
});

test('mybatis-consistency · ④降级：接口类不在 classpath ⇒ interfaceSide=false（只判注入面，不假装一致性）', () => {
  const r = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.Missing', {
    // 接口方法全缺 + 一条注入面：降级时**不许**把"接口方法全缺"报成 missing（那是接口侧不可用，不是 XML 缺语句）
    exec: execReturning({ namespace: 'com.example.M', statements: [st('findByName', 1)], interfaces: ['__CLASS_NOT_FOUND__'] }),
  });
  assert.equal(r.ok, true, '工具本身跑成功');
  assert.equal(r.interfaceSide, false, '接口侧降级');
  assert.deepEqual(r.interfaces, [], '__CLASS_NOT_FOUND__ 不混进接口方法清单');
  assert.deepEqual(
    r.issues.map((i) => i.kind),
    ['dollar-injection'],
    `降级时只判注入面（实得 ${JSON.stringify(r.issues.map((i) => i.kind))}）`,
  );
  assert.match(r.rendered, /接口侧不可用/, '渲染里如实说明降级');
});

test('mybatis-consistency · ⑤工具失败 / 输出不是 JSON / JSON 形状不对 ⇒ ok=false 且 issues 为空（不假装判过）', () => {
  const failed = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: () => ({ ok: false, stdout: '', stderr: 'javac 编译失败：cannot find symbol mybatis' }),
  });
  assert.equal(failed.ok, false, '工具失败 ⇒ ok=false');
  assert.deepEqual(failed.issues, [], '没判过 ⇒ 不许有任何 issue（不能凭空造结论）');
  assert.match(failed.rendered, /工具执行失败/, `渲染要说明跳过原因，实得：${failed.rendered}`);

  // ② 一个 JSON 都没有（只有构建日志）
  const noJson = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: () => ({ ok: true, stdout: 'BUILD SUCCESS\n', stderr: '' }),
  });
  assert.equal(noJson.ok, false, '没有 JSON 行 ⇒ ok=false');
  assert.deepEqual(noJson.issues, [], '同样不许凭空造结论');
  assert.match(noJson.rendered, /形状不对|不是 JSON/, `渲染要说明拿不到 dump，实得：${noJson.rendered}`);

  // ③ 是 JSON 但坏了（解析失败）
  const broken = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: () => ({ ok: true, stdout: '{"namespace": "x", "statements": [\n', stderr: '' }),
  });
  assert.equal(broken.ok, false, 'JSON 解析失败 ⇒ ok=false（不是抛异常）');
  assert.match(broken.rendered, /不是 JSON/, `渲染要说明解析失败，实得：${broken.rendered}`);

  // ④ 合法 JSON 但形状不对（原实现在这里**崩**：`Cannot read properties of undefined (reading 'includes')`）
  const wrongShape = mapperConsistency('C:/proj', 'src/main/resources/mapper/M.xml', 'com.example.M', {
    exec: () => ({ ok: true, stdout: '{"foo":1}\n', stderr: '' }),
  });
  assert.equal(wrongShape.ok, false, '形状不对 ⇒ ok=false（降级，不许抛）');
  assert.deepEqual(wrongShape.issues, [], '形状不对 ⇒ 没有结论');
  assert.match(wrongShape.rendered, /形状不对/, `渲染要点明要什么形状，实得：${wrongShape.rendered}`);
});

test('mybatis-consistency · ⑥真端到端：javac 编译接口 + 真 execJavaTool + 官方 XMLMapperBuilder', { timeout: 180_000 }, (t) => {
  // 这条钉的是"接线"：工具源路径（tools/MyBatisMapperDump.java）、classpath（target/classes）、
  // 接口反射、JSON 解析——假执行器用例一个也覆盖不到。
  const probe = spawnSync(process.platform === 'win32' ? 'javac.exe' : 'javac', ['-version'], { encoding: 'utf-8' });
  if (probe.status !== 0) {
    t.skip('本机 javac 不可用 ⇒ 真端到端不可判（skip ≠ pass）');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybatis-e2e-'));
  try {
    // ① 工具源（夹具里的真实现，依赖 mybatis jar；缺 jar 就明示 skip）
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.copyFileSync(FIXTURE_TOOL, path.join(root, DUMP_TOOL_REL));
    // ★★ 2026-11-16（恢复事故）：jar 定位**不许在这里另写一份**（旧代码硬编码 `os.homedir()/.m2`，
    //   而本机 maven 本地仓库在项目级 `.m2repo` ⇒ 误判"没有 jar" ⇒ t.skip() ⇒ 测试门（禁止 skip）直接红）。
    //   唯一实现 = `exec_java_tool#findMybatisJar`（候选探测：AGENT_IO_M2_REPO / MAVEN_OPTS / settings.xml /
    //   ~/.m2 / 逐级 `.m2repo`）。这里只消费它，并把"用的是哪个仓库"报出来（不静默假设）。
    const jarHit = findMybatisJar(root);
    if (!jarHit) {
      t.skip(
        `maven 本地仓库里没有 mybatis jar ⇒ 真端到端不可判（skip ≠ pass）；已探测：${mavenLocalRepoCandidates(root).join(' | ')}`,
      );
      return;
    }
    // ② mapper XML（一条 #{} 安全、一条 ${} 注入面）
    const xmlRel = 'src/main/resources/mapper/GreeterMapper.xml';
    fs.mkdirSync(path.join(root, path.dirname(xmlRel)), { recursive: true });
    fs.writeFileSync(
      path.join(root, xmlRel),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.example.GreeterMapper">
  <select id="findByName" resultType="string">SELECT name FROM greeter WHERE name = #{name}</select>
  <select id="findByNameUnsafe" resultType="string">SELECT name FROM greeter WHERE name = '\${name}'</select>
</mapper>
`,
    );
    // ③ 接口（两个方法都对得上 ⇒ 一致性绿；注入面仍红）
    const ifaceRel = 'src/main/java/com/example/GreeterMapper.java';
    fs.mkdirSync(path.join(root, path.dirname(ifaceRel)), { recursive: true });
    fs.writeFileSync(
      path.join(root, ifaceRel),
      `package com.example;
import java.util.List;
public interface GreeterMapper {
    List<String> findByName(String name);
    List<String> findByNameUnsafe(String name);
}
`,
    );
    // ④ 编译接口到 target/classes（mapperConsistency 把 target/classes 当接口侧 classpath）
    const classesDir = path.join(root, 'target', 'classes');
    fs.mkdirSync(classesDir, { recursive: true });
    const javac = spawnSync(process.platform === 'win32' ? 'javac.exe' : 'javac', ['-encoding', 'UTF-8', '-d', classesDir, path.join(root, ifaceRel)], {
      encoding: 'utf-8',
    });
    assert.equal(javac.status, 0, `接口必须能编译（stderr=${String(javac.stderr ?? '').slice(0, 300)}）`);

    // ⑤ 真跑（默认 exec = execJavaTool）
    const r = mapperConsistency(root, xmlRel, 'com.example.GreeterMapper');
    assert.equal(r.ok, true, `真工具必须跑通，实得 rendered=${r.rendered}`);
    assert.equal(r.namespace, 'com.example.GreeterMapper', '官方解析器读出的 namespace');
    assert.equal(r.interfaceSide, true, '接口类在 classpath ⇒ 反射拿到方法');
    assert.deepEqual(r.interfaces.sort(), ['findByName', 'findByNameUnsafe'], '接口方法名（反射）');
    assert.deepEqual(r.statements.map((s) => s.id).sort(), ['findByName', 'findByNameUnsafe'], 'XML 语句 id（官方解析器）');
    // 一致性两边对得上 ⇒ 没有 missing/extra；只有那条 ${}
    assert.deepEqual(
      r.issues.map((i) => `${i.kind}:${i.target}`),
      ['dollar-injection:findByNameUnsafe'],
      `真跑结论：实得 ${JSON.stringify(r.issues.map((i) => `${i.kind}:${i.target}`))}`,
    );

    // ⑥ 反例：接口删掉一个方法 ⇒ 真跑必须报 xml-extra-statement（证明交叉不是靠假 dump 才成立）
    fs.writeFileSync(
      path.join(root, ifaceRel),
      `package com.example;
import java.util.List;
public interface GreeterMapper {
    List<String> findByName(String name);
}
`,
    );
    fs.rmSync(path.join(classesDir, 'com', 'example', 'GreeterMapper.class'), { force: true });
    const javac2 = spawnSync(process.platform === 'win32' ? 'javac.exe' : 'javac', ['-encoding', 'UTF-8', '-d', classesDir, path.join(root, ifaceRel)], {
      encoding: 'utf-8',
    });
    assert.equal(javac2.status, 0, '改后的接口也要编译过');
    const r2 = mapperConsistency(root, xmlRel, 'com.example.GreeterMapper');
    assert.ok(
      r2.issues.some((i) => i.kind === 'xml-extra-statement' && i.target === 'findByNameUnsafe'),
      `接口少一个方法 ⇒ 真跑必须报 extra，实得 ${JSON.stringify(r2.issues.map((i) => `${i.kind}:${i.target}`))}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
