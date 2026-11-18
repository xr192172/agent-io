/**
 * 卡3 · jfacts：Java 语义事实抽取器的**真跑**判据（册上写不出这种判据 —— 它要真起 JVM）。
 *
 * touches: src/infrastructure/index/jfacts/JFacts.java, src/infrastructure/index/semantic_facts.ts
 *
 * ★ `touches:` 不是装饰：内环（`npm run verify:changed`）靠它把「改了哪个源文件」归因到「该跑哪支测试」。
 *   缺它 ⇒ 改 `JFacts.java` 时这支测试**不被选中** ⇒ 改了抽取器却没人验（实测第一版就漏了这条）。
 *
 * ## 为什么必须是测试而不是册上的 `run`
 * 抽取器是**独立进程 + javac attribution**：册上 `run` 的求值域只有 `input/root/validateDSL/fs/path/facts`，
 * 既不能 spawn 子进程也不能加载 JDK ⇒ 这类判据只能住 `npm test` 门。
 *
 * ## 三条用例各自的鉴别力（说得出"什么情形下会红"）
 * ① **无 classpath ⇒ ok:false 且零事实**：把 `JFacts.java` 里那段 `if (!hadCp && !allowNoCp)` 删掉
 *    （或改成 best-effort 输出）⇒ 它变 `ok:true` 且 fields 非空 ⇒ **红**。这条是整个抽取器最重要的纪律：
 *    缺依赖时**不许**产出装作精确的事实。
 * ② **有 classpath ⇒ ok:true 且真抽出字段/方法/归属**：把 `task.analyze()` 注释掉（只 parse 不 attribution）
 *    ⇒ fields/funcs 归零 ⇒ **红**；把 selection 那段删掉 ⇒ occurrences 归零 ⇒ **红**。
 * ③ **外部类型不进归属账**：`System.out.println` 的主人 `java.io.PrintStream` 在仓外 ⇒ 不许出现在 occurrences。
 *    把 `isProjectType` 那道过滤去掉 ⇒ occurrences 里出现 `java.io.PrintStream.println` ⇒ **红**。
 *
 * ## 环境依赖（不满足即 skip 并由门的汇总行报出分母，不是静默通过）
 * 需要 JDK（`javac`/`java`）。本仓 `npm run env:check` 已把手上有无 JDK 作为前置；这里按 `javacPath` 缺失直接跳过。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const JFACTS_SRC = path.join(ROOT, 'src/infrastructure/index/jfacts/JFacts.java');

/** 工作区内的临时目录（系统 Temp 在某些沙箱下 EPERM ⇒ 必须落仓内） */
function mkScratch(): string {
  const base = path.join(ROOT, '.agent-io', 'scratch', 'jfacts-test');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'fx-'));
}

/** 找一个可用的 JDK bin 目录（返回 null ⇒ 本机没有 JDK，用例 skip 而非假绿） */
function findJdkBin(): string | null {
  const cands = [
    process.env.AGENT_IO_JDK_HOME,
    process.env.JAVA_HOME,
    path.join('D:', 'dev_hzy', 'devkit', 'jdk17', 'jdk-17.0.21+9'),
  ].filter(Boolean) as string[];
  const exe = process.platform === 'win32' ? 'javac.exe' : 'javac';
  for (const home of cands) {
    const bin = path.join(home, 'bin');
    if (fs.existsSync(path.join(bin, exe))) return bin;
  }
  return null;
}

/** 造一个最小的两文件 Java 项目（Person 有字段/方法；Main 调它的方法） */
function makeFixture(dir: string): void {
  const demo = path.join(dir, 'demo');
  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(
    path.join(demo, 'Person.java'),
    [
      'package demo;',
      'public class Person {',
      '    private String name;',
      '    private int age;',
      '    public String getName() { return name; }',
      '    public void setName(String n) { this.name = n; }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(demo, 'Main.java'),
    [
      'package demo;',
      'public class Main {',
      '    public static void main(String[] a) {',
      '        Person p = new Person();',
      '        p.setName("x");',
      '        String n = p.getName();',
      '        System.out.println(n);',
      '    }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** 编译抽取器到 classesDir；返回错误串（成功返回 null） */
function buildJFacts(jdkBin: string, classesDir: string): string | null {
  fs.mkdirSync(classesDir, { recursive: true });
  const r = spawnSync(path.join(jdkBin, process.platform === 'win32' ? 'javac.exe' : 'javac'), [
    '-encoding', 'UTF-8', '-d', classesDir, JFACTS_SRC,
  ], { encoding: 'utf8', timeout: 120_000 });
  return r.status === 0 ? null : `javac 失败：${String(r.stderr ?? r.stdout).slice(0, 600)}`;
}

/** 跑抽取器，返回解析后的 JSON（必须恰好一行） */
function runJFacts(
  jdkBin: string,
  classesDir: string,
  projectRoot: string,
  extra: string[] = [],
): Record<string, unknown> {
  const r = spawnSync(
    path.join(jdkBin, process.platform === 'win32' ? 'java.exe' : 'java'),
    ['-cp', classesDir, 'JFacts', projectRoot, ...extra],
    { encoding: 'utf8', timeout: 180_000, maxBuffer: 64 << 20 },
  );
  const stdout = String(r.stdout ?? '').trim();
  assert.notEqual(stdout, '', `抽取器没有输出（exit=${r.status}，stderr=${String(r.stderr ?? '').slice(0, 400)}）`);
  const lines = stdout.split('\n');
  assert.equal(lines.length, 1, `协议是**恰好一行** JSON，实得 ${lines.length} 行（多行会让调用方的 .pop() 取错）`);
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

const jdkBin = findJdkBin();
const skip = jdkBin === null ? '本机没有可用 JDK（javac 不在 AGENT_IO_JDK_HOME / JAVA_HOME / devkit/jdk17 下）' : false;

test('① 无 classpath ⇒ ok:false 且零事实（缺依赖不许冒充精确）', { skip }, () => {
  const scratch = mkScratch();
  try {
    makeFixture(scratch);
    const classes = path.join(scratch, '_classes');
    const buildErr = buildJFacts(jdkBin!, classes);
    assert.equal(buildErr, null, buildErr ?? '');

    // 不带 --classpath ⇒ 必须显式拒绝
    const out = runJFacts(jdkBin!, classes, scratch);
    assert.equal(out.ok, false, '没有 classpath 时**必须** ok:false —— 否则就是产出了装作精确的事实');
    assert.match(String(out.reason), /classpath/, `reason 要点名缺的是 classpath，实得：${String(out.reason)}`);
    assert.deepEqual(out.fields, [], 'ok:false 时不许带任何字段事实');
    assert.deepEqual(out.funcs, [], 'ok:false 时不许带任何方法事实');
    assert.deepEqual(out.occurrences, [], 'ok:false 时不许带任何归属事实');
    // ★ 但"看到了多少"要如实报（否则读的人分不清"没有源码"与"有源码但没判"）
    assert.ok(Number(out.files) >= 2, `files 应报出解析到的源文件数（实得 ${String(out.files)}）`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('② 有 classpath ⇒ ok:true，且抽出字段 / 方法 / 项目内归属', { skip }, () => {
  const scratch = mkScratch();
  try {
    makeFixture(scratch);
    const classes = path.join(scratch, '_classes');
    const buildErr = buildJFacts(jdkBin!, classes);
    assert.equal(buildErr, null, buildErr ?? '');

    const out = runJFacts(jdkBin!, classes, scratch, ['--classpath', classes]);
    assert.equal(out.ok, true, `带 classpath 时应成功，实得 reason=${String(out.reason)}`);

    const fields = out.fields as Array<{ name: string; structure: string }>;
    assert.ok(Array.isArray(fields) && fields.length >= 2, `应抽出 Person 的 2 个字段，实得 ${fields?.length}`);
    const names = fields.map((f) => f.name).sort();
    assert.deepEqual(names, ['age', 'name'], `字段名对不上：${JSON.stringify(names)}`);

    const funcs = out.funcs as Array<{ name: string }>;
    assert.ok(funcs.length >= 4, `应抽出 4 个方法（getName/setName/main + 构造器），实得 ${funcs.length}`);

    // ★ 归属：p.setName / p.getName 必须解析到 demo.Person（这是 LSP 给不了、只有 javac 有的那一层）
    const occ = out.occurrences as Array<{ symbolId: string; member: string }>;
    const members = occ.map((o) => o.symbolId);
    assert.ok(
      members.includes('demo.Person.setName'),
      `p.setName 应归属到 demo.Person.setName，实得：${JSON.stringify(members)}`,
    );
    assert.ok(
      members.includes('demo.Person.getName'),
      `p.getName 应归属到 demo.Person.getName，实得：${JSON.stringify(members)}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('③ 仓外类型的调用不许进归属账（只记项目内符号）', { skip }, () => {
  const scratch = mkScratch();
  try {
    makeFixture(scratch);
    const classes = path.join(scratch, '_classes');
    const buildErr = buildJFacts(jdkBin!, classes);
    assert.equal(buildErr, null, buildErr ?? '');

    const out = runJFacts(jdkBin!, classes, scratch, ['--classpath', classes]);
    const occ = (out.occurrences ?? []) as Array<{ symbolId: string }>;
    const ids = occ.map((o) => o.symbolId);
    // System.out.println 的主人是 java.io.PrintStream —— 仓外，不该出现在本仓符号账里
    assert.ok(
      !ids.some((x) => x.startsWith('java.')),
      `仓外 JDK 类型不该进归属账（它会让"本仓有什么符号"被外部库污染），实得：${JSON.stringify(ids)}`,
    );
    // 反证：项目内的仍然在（否则"全过滤掉"也能让上一条绿）
    assert.ok(
      ids.some((x) => x.startsWith('demo.')),
      `项目内归属必须仍在，否则「不许 java.*」这条会退化成永远绿：${JSON.stringify(ids)}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
