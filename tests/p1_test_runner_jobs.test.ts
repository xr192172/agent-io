/**
 * P1 · 测试门的 **`--jobs N` 并发档**（增量化第一批 · 项 1 的检测点）
 *
 * ## 它挡的事故
 * 逐文件 spawn 是这道门的主要成本（135 个文件 = 135 次 `node --import tsx --test`）。加并发是"省时间"，
 * 而**省钱的动作最容易顺手把钱以外的性质也改掉**：本门有两个性质**以"确定的执行顺序"为前提** ——
 * ① 报红时点的是"哪个文件"（逐文件一行）；② 产者护栏点的是"哪一次测试写的"（跑一个、拍一次指纹、比一次）。
 * ⇒ 这条卡只允许"快"，不允许把这两件事改出声。
 *
 * ## 判据（本文件真跑**真脚本**，不测桩）
 * · R1 **顺序**：`--jobs N` 下逐文件行仍按**文件原顺序**打印（构造"先跑的最慢"的夹具 ⇒ 完成序必然 ≠ 文件序）
 * · R2 **判定不变**：同一份夹具在 `--jobs 1` 与 `--jobs N` 下，逐文件行（去掉耗时）与汇总行**逐字相同**
 * · R3 **静态守卫也走并行档**：0 字节的 `.test.ts` 在并行档同样被判红并点名（不许因并发被跳过）
 * · R4 **默认档没有并行横幅**（`--jobs` 缺省 = 原串行行为；横向提示只在显式 `--jobs >1` 时出现）
 * · R5 **非法 `--jobs` 响亮判红**（`0` / `abc`），且**一个文件都不跑**（不许"看不懂就当 1"）
 * · R6 **槽位固定**：`--jobs 2` 跑 4 个文件 ⇒ 数据根的 `w<槽位>` 只落在 {0,1}，且 4 个根**互不相同**
 * · R7 **`--jobs 1` 实时**：第一行必须在进程结束**之前**到达（不是"跑完再一次性吐"）
 *
 * ## 为什么**不** import `run-tests.mjs` 来单测池函数（★ 本卡明确取舍，与"混元席补丁"的三处问题对照）
 * `scripts/run-tests.mjs` 是**入口脚本**：它没有 main-module 守卫，顶层就扫 `tests/` + 逐个 spawn。
 * ⇒ 为"能单测池函数"而把它改成"导出 + `if (isMain) main()`"，等于**给门的最关键入口新增一层
 *   判定**（软链/`argv[1]` 形态一变，`npm test` 就会静默什么都不跑 —— 本仓 2026-11-16 在
 *   `verify.mjs` / `gen_cognition.mjs` 上刚踩过一次同款事故，见 `scripts/lib/path_identity.mjs`）。
 * ⇒ 本卡**不动入口形态**，改判"**真脚本跑真夹具**"：拷真脚本进夹具根（`import.meta.url` 定 ROOT
 *   ⇒ 扫夹具的 `tests/`，仓里一个字节不碰），于是"池 / 缓冲 / 槽位 / 实时"全部是**可观测行为**，
 *   而不是"导入后调一个内部函数"。代价：本文件的判据依赖"夹具能起来"（环境坏了会一起红）——
 *   这一点由 ⑥ 的结构断言兜住（如实标注，不冒充行为断言）。
 *
 * ## 消融口径（改坏实现时哪条红）
 * · 并行档改成"按完成序打印" ⇒ R1 红（夹具里最慢的排第一）
 * · 并行档自己写一套判定（漏 underRun / skip / todo） ⇒ R2 红
 * · 并行档跳过静态守卫（只跑不判） ⇒ R3 红
 * · 把并行横幅也印在默认档 ⇒ R4 红
 * · `--jobs` 非法值静默回落 1 ⇒ R5 红
 * · 槽位改用"函数属性 / 闭包累加器" ⇒ R6 红（并发交错自增 ⇒ 槽位 >1 或两根相同）
 * · 默认档也走"缓冲到全部跑完" ⇒ R7 红（第一行与进程结束同时到达）
 *
 * ## 夹具口径（★ 抄 `p0_no_false_green_gates.test.ts` ② 的手法，理由同它）
 * · 夹具根落在 `.agent-io/gate-fixture-jobs-*`：**必须在仓内** —— `run-tests` 用 `--import tsx` 起子进程，
 *   `tsx` 要靠 `node_modules` 逐级上溯；放到系统 temp ⇒ 每个文件「计数缺失」，测出来的是环境噪音。
 * · 把**真脚本原样**拷进 `scripts/`（它用 `import.meta.url` 定 ROOT ⇒ 扫的是夹具的 `tests/`，仓里的一个字节不碰）；
 *   连它的唯一依赖 `scripts/lib/test_files.mjs` 一起拷（少了它脚本一加载就崩 ⇒ 看到"输出为空"而误判）。
 * · ★ 夹具根里**没有 src/** ⇒ 真册探针问不到 ⇒ 产者护栏自报"判不了" ⇒ **退出码必然非 0**。
 *   ⇒ 本用例**不拿退出码当判据**（那样测的是"夹具缺 src"），只判逐文件行 / 汇总行 / 该红的那几行。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_TESTS = path.join(REPO, 'scripts', 'run-tests.mjs');

/** 去 ANSI（门的输出是彩色的；判据只认文字） */
const plain = (s: string): string => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

/** 造一个夹具根（仓内，见文件头"夹具口径"）+ 拷真脚本 */
function makeRoot(tag: string): string {
  const root = path.join(REPO, '.agent-io', `gate-fixture-jobs-${tag}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.copyFileSync(RUN_TESTS, path.join(root, 'scripts', 'run-tests.mjs'));
  fs.copyFileSync(
    path.join(REPO, 'scripts', 'lib', 'test_files.mjs'),
    path.join(root, 'scripts', 'lib', 'test_files.mjs'),
  );
  return root;
}

/** 一个**只有一个用例**的最小测试文件（`sleepMs` 用来制造"慢文件"） */
function writeTestFile(root: string, name: string, sleepMs = 0): void {
  const body =
    sleepMs > 0
      ? `import { test } from 'node:test';\ntest('${name}', async () => { await new Promise((r) => setTimeout(r, ${sleepMs})); });\n`
      : `import { test } from 'node:test';\ntest('${name}', () => {});\n`;
  fs.writeFileSync(path.join(root, 'tests', name), body, 'utf8');
}

/** 跑夹具里的**真** run-tests（缺省参数 = 默认档） */
function runRunner(root: string, extraArgs: string[] = []): { status: number | null; out: string } {
  // ★★ 必须摘掉 `NODE_TEST_CONTEXT`：本证自己就跑在 `node --test` 里，那个变量会被子进程继承
  //   ⇒ 子进程的 `node --test` 认为这是**嵌套 run**，直接「skipping running files」
  //   （实测：不摘掉时被 spawn 的 run-tests 每个文件都「计数缺失」⇒ 测出来的是噪音，不是被检查的门）。
  //   同一坑见 `p0_no_false_green_gates.test.ts` 的 `run()`（那里也是这么修的）。
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-tests.mjs'), ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
    env: base,
  });
  return { status: r.status, out: plain(`${r.stdout ?? ''}${r.stderr ?? ''}`) };
}

/**
 * 逐文件行（**剥掉耗时**后再比 —— 耗时是唯一允许不同的那一列）。
 * 覆盖两种形状：跑过的（`PASS/FAIL  <file>  <n>ms  用例 x/y`）与静态守卫的（`FAIL  <file>  源码 0 条用例`）。
 */
function fileLines(out: string): string[] {
  return out
    .split(/\r?\n/)
    .filter((l) => /\.test\.ts/.test(l) && /\b(?:PASS|FAIL)\b/.test(l))
    .map((l) => l.replace(/\d+ms/, '<ms>').replace(/\s+/g, ' ').trim());
}

/** 汇总行（机器读的那一行；格式由 `p0_summary_format_alignment.test.ts` 另行守着） */
function summaryLine(out: string): string {
  return (out.split(/\r?\n/).find((l) => l.startsWith('测试门：')) ?? '').trim();
}

function rmRf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 });
  } catch {
    /* 删不掉不影响判定（夹具在 .agent-io 下，本来就不进 git） */
  }
}

test('① 并行档：逐文件行仍按**文件原顺序**打印（最慢的文件排第一 ⇒ 完成序必然是反的）', () => {
  const root = makeRoot('order');
  try {
    // ★ 判别力所在：`a_slow` 睡 800ms，后两个几乎瞬时 ⇒ 按完成序打印时它会**掉到最后**
    writeTestFile(root, 'a_slow.test.ts', 800);
    writeTestFile(root, 'b_fast.test.ts');
    writeTestFile(root, 'c_fast.test.ts');

    const serial = runRunner(root);
    const parallel = runRunner(root, ['--jobs', '3']);

    const want = ['a_slow.test.ts', 'b_fast.test.ts', 'c_fast.test.ts'];
    const namesOf = (lines: string[]): string[] => lines.map((l) => (/[\w.-]+\.test\.ts/.exec(l) ?? [''])[0]);
    assert.deepEqual(namesOf(fileLines(serial.out)), want, `默认档应当按文件顺序打印：\n${serial.out}`);
    assert.deepEqual(
      namesOf(fileLines(parallel.out)),
      want,
      `★ 并行档必须**按文件原顺序**打印（完成序会让逐文件行与 TAP 汇总对不上号）：\n${parallel.out}`,
    );

    // R2：两份读数的**逐文件行（去耗时）+ 汇总行**必须一模一样
    assert.deepEqual(fileLines(parallel.out), fileLines(serial.out), `串行/并行的逐文件行必须逐字相同：\n${parallel.out}`);
    assert.equal(summaryLine(parallel.out), summaryLine(serial.out), '串行/并行的汇总行必须逐字相同');
    assert.match(summaryLine(parallel.out), /^测试门：文件 3 \/ 用例 3（源码声明 3）\/ 通过 3 \/ 失败 0 \/ 跳过 0$/, '汇总读数对不上');
  } finally {
    rmRf(root);
  }
});

test('② 并行档不跳过静态守卫：0 字节的 .test.ts 一样判红并点名', () => {
  const root = makeRoot('static');
  try {
    writeTestFile(root, 'a_ok.test.ts');
    fs.writeFileSync(path.join(root, 'tests', 'b_empty.test.ts'), '', 'utf8'); // 文件在、用例没了
    writeTestFile(root, 'c_ok.test.ts');

    const parallel = runRunner(root, ['--jobs', '2']);
    const serial = runRunner(root);

    assert.match(parallel.out, /b_empty\.test\.ts/, `并行档也必须点名那个 0 用例的文件：\n${parallel.out}`);
    assert.match(parallel.out, /源码 0 条用例/, `并行档必须说清红在哪（文件在、用例没了）：\n${parallel.out}`);
    // ★ 0 用例的文件**不进汇总的用例数**（与默认档同口径：它不跑，因此不贡献 tests/pass）
    assert.match(
      summaryLine(parallel.out),
      /^测试门：文件 3 \/ 用例 2（源码声明 2）\/ 通过 2 \/ 失败 0 \/ 跳过 0$/,
      `并行档的汇总与默认档同口径（0 用例的文件不跑、不计数）：\n${parallel.out}`,
    );
    assert.deepEqual(fileLines(parallel.out), fileLines(serial.out), `静态守卫那一行也必须与默认档逐字相同：\n${serial.out}`);
  } finally {
    rmRf(root);
  }
});

test('③ 并行档照常判红失败用例（逐文件点名 + 汇总失败数）', () => {
  const root = makeRoot('fail');
  try {
    writeTestFile(root, 'a_ok.test.ts');
    fs.writeFileSync(
      path.join(root, 'tests', 'b_bad.test.ts'),
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('boom', () => { assert.equal(1, 2); });\n",
      'utf8',
    );
    const r = runRunner(root, ['--jobs', '2']);
    assert.notEqual(r.status, 0, `有失败用例 ⇒ 必须非 0 退出：\n${r.out}`);
    assert.match(r.out, /FAIL.*b_bad\.test\.ts/, `必须点名失败的那个文件：\n${r.out}`);
    assert.match(r.out, /✗ boom/, `必须给出失败用例名：\n${r.out}`);
    assert.match(summaryLine(r.out), /通过 1 \/ 失败 1/, `汇总必须带上失败数：\n${r.out}`);
  } finally {
    rmRf(root);
  }
});

test('④ 默认档（缺 --jobs）没有并行横幅；`--jobs >1` 才有（且写明护栏降级）', () => {
  const root = makeRoot('banner');
  try {
    writeTestFile(root, 'a.test.ts');
    const serial = runRunner(root);
    assert.doesNotMatch(serial.out, /并行 --jobs/, `默认档不许出现并行横幅（默认行为零变化）：\n${serial.out}`);
    assert.doesNotMatch(serial.out, /产者护栏降级/, `默认档不许出现护栏降级说明：\n${serial.out}`);

    const parallel = runRunner(root, ['--jobs', '2']);
    assert.match(parallel.out, /并行 --jobs 2/, `--jobs >1 必须自报并行档：\n${parallel.out}`);
    // ★ 0.12：并行时产者护栏**判不了是谁**，这条自白必须在开跑前就说出来
    assert.match(parallel.out, /产者护栏降级/, `并行档必须自白"判不了是谁改的"：\n${parallel.out}`);
  } finally {
    rmRf(root);
  }
});

test('⑤ 非法 --jobs 响亮判红，且一个文件都不跑（不许"看不懂就当 1"）', () => {
  const root = makeRoot('bad');
  try {
    writeTestFile(root, 'a.test.ts');
    for (const bad of ['0', 'abc']) {
      const r = runRunner(root, ['--jobs', bad]);
      assert.notEqual(r.status, 0, `--jobs ${bad} 必须非 0 退出：\n${r.out}`);
      assert.match(r.out, /--jobs 后面必须跟 ≥1 的整数/, `--jobs ${bad} 必须说清为什么拒跑：\n${r.out}`);
      assert.deepEqual(fileLines(r.out), [], `--jobs ${bad} 时**一个文件都不许跑**：\n${r.out}`);
      assert.equal(summaryLine(r.out), '', `--jobs ${bad} 时不许印汇总行（那是"跑过"的读数）：\n${r.out}`);
    }
  } finally {
    rmRf(root);
  }
});

test('⑥ 结构性断言：源码里确实有 worker 池 + 按 index 缓冲（行为判据的兜底，如实标注）', () => {
  // ★ 为什么还要这一条：上面几条都依赖"夹具能起来"。若有一天夹具起不来（环境问题），
  //   本文件仍是**有鉴别力**的（删掉池/缓冲 ⇒ 这里立刻红）。它是结构断言，**不冒充**行为断言。
  const src = fs.readFileSync(RUN_TESTS, 'utf8');
  assert.match(src, /async function runPool\(/, 'run-tests.mjs 里找不到 worker 池 `runPool`');
  assert.match(src, /await runPool\(todo, jobs,/, '并行分支没有走 worker 池');
  assert.match(src, /results\[i\] = await runOne\(`tests\/\$\{files\[i\]\}`, slot\)/, '并行分支没有按 index 缓冲结果');
  assert.match(src, /按文件原顺序/, '源码里没有"按文件原顺序打印"这条口径（注释即契约）');
  assert.match(src, /无法点名污染者/, '并行档的产者护栏降级说明失踪了（0.12：判不了要说判不了）');
  // 默认档必须是**串行**路径（而不是"池里 1 个 worker"的等价物 —— 那样逐文件行会变成跑完才印）
  assert.match(src, /for \(const f of files\) \{[\s\S]{0,500}?await runOne\(rel\)/, '默认档不再是"跑一个、判一个、当场一行"的串行路径');
});

test('⑦ worker **槽位固定**、数据根仍**每文件独立**（槽位不许用累加器/函数属性现加）', () => {
  // ★ 这条挡的是"双计错位"：槽位若靠"函数上的计数器"或闭包里现 `+=`，并发下会被交错自增 ⇒
  //   两个 worker 拿到同一个号（互踩同一个数据根），或同一 worker 的两个文件分到两个号（槽位数 > 并发度）。
  //   判据：4 个文件、`--jobs 2` ⇒ 槽位只能落在 {0,1}，且**4 个数据根互不相同**。
  const root = makeRoot('slots');
  try {
    const homes = path.join(root, 'homes');
    fs.mkdirSync(homes, { recursive: true });
    for (const name of ['a', 'b', 'c', 'd']) {
      fs.writeFileSync(
        path.join(root, 'tests', `${name}.test.ts`),
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n" +
          `test('home-${name}', () => {\n` +
          `  const home = String(process.env.AGENT_IO_HOME ?? process.env.AGENT_IO_DATA_ROOT ?? '');\n` +
          `  assert.match(home, /[\\\\/]w\\d+[\\\\/]/, '注入的数据根必须带 worker 槽位（w<槽位>）');\n` +
          `  fs.writeFileSync(${JSON.stringify(path.join(homes, `${name}.txt`))}, home, 'utf8');\n` +
          `});\n`,
        'utf8',
      );
    }
    const r = runRunner(root, ['--jobs', '2']);
    assert.match(summaryLine(r.out), /通过 4 \/ 失败 0/, `4 个文件都该通过（含槽位形状断言）：\n${r.out}`);
    const seen = ['a', 'b', 'c', 'd'].map((n) => fs.readFileSync(path.join(homes, `${n}.txt`), 'utf8').trim());
    assert.equal(new Set(seen).size, 4, `**每文件一个数据根** ⇒ 4 个必须互不相同（实际：${JSON.stringify(seen)}）`);
    const slots = seen.map((h) => Number(/[\\/]w(\d+)[\\/]/.exec(h)?.[1] ?? '-1'));
    assert.deepEqual(
      slots.filter((s) => s < 0),
      [],
      `数据根里必须带 w<槽位>（实际：${JSON.stringify(seen)}）`,
    );
    assert.ok(
      slots.every((s) => s >= 0 && s < 2),
      `--jobs 2 ⇒ 槽位只能在 {0,1}（>1 就是"双计错位"：槽位数跑到了并发度之外）：${JSON.stringify(slots)}`,
    );
    assert.deepEqual([...new Set(slots)].sort(), [0, 1], `两个 worker 都该用到（实际槽位：${JSON.stringify(slots)}）`);
  } finally {
    rmRf(root);
  }
});

test('⑧ `--jobs 1`（默认档）必须是**实时逐文件打印**（不是"跑完再一次性吐"）', async () => {
  // ★ 判据 = **时间**：串行档下第一个文件的行必须在**进程结束之前**就到达 stdout。
  //   若默认档也走"缓冲到全部跑完再按序印"，那一行会与进程结束同时到达（gap ≈ 0）⇒ 本用例红。
  //   （实测口径：a/b 各睡 700ms ⇒ gap 期望 ≈ 700ms；缓冲实现下 gap ≈ 0。）
  const root = makeRoot('realtime');
  try {
    writeTestFile(root, 'a_slow.test.ts', 700);
    writeTestFile(root, 'b_slow.test.ts', 700);
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base.NODE_TEST_CONTEXT;
    const t0 = Date.now();
    const chunks: Array<{ at: number; text: string }> = [];
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'run-tests.mjs')], { cwd: root, env: base });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => chunks.push({ at: Date.now() - t0, text: s }));
    child.stderr.on('data', (s: string) => chunks.push({ at: Date.now() - t0, text: s }));
    await new Promise<void>((resolve) => child.on('close', () => resolve()));
    const endAt = Date.now() - t0;
    const first = chunks.find((c) => /a_slow\.test\.ts/.test(plain(c.text)));
    assert.ok(first, `没等到 a_slow 那一行（chunks=${chunks.length}）`);
    const gap = endAt - first!.at;
    assert.ok(
      gap >= 300,
      `★ 默认档必须**实时**打印：第一行到达后到进程结束间隔 ${gap}ms（<300ms 说明它被缓冲到"全部跑完"才吐）`,
    );
  } finally {
    rmRf(root);
  }
});
