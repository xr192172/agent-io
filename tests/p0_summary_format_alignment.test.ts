/**
 * 守两件"两个文件必须对齐、而对不上时没人会红"的事（0.25①）。
 *
 * ★ 为什么需要（2026-11-05 实测的两处**假绿入口**）：
 *   1. `scripts/verify-changed.mjs` 原先用正则从 `scripts/run-tests.mjs` 的输出里取
 *      「测试门：文件 N / 用例 M / 通过 P / 失败 F / 跳过 S」。`run-tests` 后来在 `用例 M` 后面加了
 *      `（源码声明 K）`，**正则没跟着改** ⇒ `hasSummary` 恒 false ⇒ `fail` 恒 null ⇒ 所有测试落进
 *      `nosummary`。红还能靠 `rc!==0` 兜住，但"跑了几条、过了几条"这个能力整个丢了（违反 0.12 带分母）。
 *   2. `verify-changed.mjs` 自己写了一份「只扫顶层」的测试文件收集器（82 个），
 *      而 `run-tests.mjs` 是**递归**（85 个）⇒ `tests/{budget,locate,rate}/` 三个文件
 *      **在内环里永远选不中，而它自己不知道**。注释当时还写着"收集规则与 run-tests.mjs 一致"。
 *
 * ★★ Slice 1 演进（批调用 + --json）：node 段消费方从"正则解析文本汇总行"换成"解析 runner `--json`
 *   回执文档"。文本汇总行格式契约仍由 runner 自己守（① 渲染模板）；新增 ⑤ 守 runner JSON 字段 ↔
 *   verify-changed 消费字段对齐（改坏任一侧字段名必须能判红）；③ 唯一收集实现继续守，反向鉴别力不降。
 *
 * ★ 本文件**不跑**那两个脚本（它们是重活，且本文件不该顺手跑别的证）——
 *   它只做**静态对齐**断言，而这恰好是那两个缺陷的**唯一共同形态**：
 *   「A 产出的格式/字段」与「B 消费它的规则」必须能对上；「同一份清单」只能有**一个**收集实现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 `run-tests.mjs` 里取出「测试门：…」那一条**模板字面量**，并用样例数渲染出来 */
function renderSummaryFormat() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/run-tests.mjs'), 'utf8');
  const lines = src.split(/\r?\n/);
  const line = lines.find((l) => l.includes('测试门：文件') && l.includes('${'));
  assert.ok(line, '★ run-tests.mjs 里找不到「测试门：文件 … ${…}」那条模板字面量 —— 本断言的前提没了，请同步更新本测试');
  const bt = line.indexOf('`');
  const btEnd = line.lastIndexOf('`');
  assert.ok(bt >= 0 && btEnd > bt, '★ 该行不是模板字面量（找不到成对反引号）');
  const tpl = line.slice(bt + 1, btEnd);
  // 按出现顺序喂样例数：文件 / 用例 / 源码声明 / 通过 / 失败 / 跳过
  const samples = [3, 11, 11, 10, 1, 0];
  let i = 0;
  return tpl.replace(/\$\{[^}]*\}/g, () => String(samples[i++] ?? 0));
}

test('① runner 文本汇总模板仍在（文本汇总契约继续守；样例渲染逐字成形）', () => {
  const rendered = renderSummaryFormat();
  assert.match(
    rendered,
    /^测试门：文件 3 \/ 用例 11（源码声明 11）\/ 通过 10 \/ 失败 1 \/ 跳过 0$/,
    '★ runner 汇总模板渲染不出固定形状（格式被改坏 ⇒ 文本档判据锚点漂移）：' + JSON.stringify(rendered),
  );
});

test('② 反向：缺字段的一行不许被当成汇总行（鉴别力不降）', () => {
  const rendered = renderSummaryFormat();
  assert.equal(rendered.startsWith('测试门：'), true, '汇总行前缀必须是「测试门：」');
  // 反向鉴别：少了 通过/失败/跳过 的残行不是汇总行（不许用宽松匹配把它当读数）
  assert.notEqual('测试门：什么都没打印', rendered, '残行不得冒充汇总行');
  assert.ok(!/通过 \d+ \/ 失败 \d+ \/ 跳过 \d+/.test('随便一行：文件 3 / 用例 11'), '缺 通过/失败/跳过 的行不得匹配汇总形状');
});

test('③ 测试文件清单只能有【一个】收集实现（两处都调 collectTestFiles）', () => {
  const runTests = fs.readFileSync(path.join(ROOT, 'scripts/run-tests.mjs'), 'utf8');
  const changed = fs.readFileSync(path.join(ROOT, 'scripts/verify-changed.mjs'), 'utf8');
  assert.match(runTests, /import\s*\{\s*collectTestFiles\s*\}\s*from\s*'\.\/lib\/test_files\.mjs'/, 'run-tests.mjs 没从共享模块 import collectTestFiles');
  assert.match(changed, /import\s*\{\s*collectTestFiles\s*\}\s*from\s*'\.\/lib\/test_files\.mjs'/, 'verify-changed.mjs 没从共享模块 import collectTestFiles');
  assert.ok(runTests.includes('collectTestFiles('), 'run-tests.mjs 没调用 collectTestFiles');
  assert.ok(changed.includes('collectTestFiles('), 'verify-changed.mjs 没调用 collectTestFiles');
  // ★ 反向：不许再出现"自己 walk 一遍"的痕迹。
  //   ★ 判据形态选「**赋值语句**」而不是裸调用 —— 散文里可以引用 `fs.readdirSync(TESTS)`（本仓就这么留痕的），
  //     但不会写出 `const testFiles = fs.readdirSync(...)` ⇒ 这个断言**不需要剥注释**也不会被散文骗到。
  const changedCode = fs.readFileSync(path.join(ROOT, 'scripts/verify-changed.mjs'), 'utf8');
  const runTestsCode = fs.readFileSync(path.join(ROOT, 'scripts/run-tests.mjs'), 'utf8');
  assert.ok(
    !/const\s+testFiles\s*=\s*[^;]*readdirSync/.test(changedCode),
    '★ verify-changed.mjs 又在自己 walk 测试清单（`const testFiles = …readdirSync…`）⇒ 必须改调 collectTestFiles',
  );
  assert.ok(
    !/const\s+dir\s*=\s*path\.join\(ROOT,\s*'tests'\)\s*;[\s\S]{0,400}readdirSync\(path\.join\(dir/.test(runTestsCode),
    '★ run-tests.mjs 又在自己 walk 测试清单 ⇒ 必须改调 collectTestFiles',
  );
});

test('④ 共享收集器确实递归（子目录里的用例必须被收进来）', async () => {
  const { collectTestFiles } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/test_files.mjs')).href);
  const files = collectTestFiles(path.join(ROOT, 'tests'));
  assert.ok(files.length > 0, '收集器返回空清单');
  const nested = files.filter((f) => f.includes('/'));
  assert.ok(
    nested.length > 0,
    '★ 收集器没递归：tests/ 下明明有子目录用例（tests/budget/ 等），却一个都没被收进来 ⇒ 只扫顶层的老 bug 回来了',
  );
  // 确定性：同样输入两次结果逐字相同
  assert.deepEqual(collectTestFiles(path.join(ROOT, 'tests')), files, '收集器不确定（两次结果不同）');
});

/**
 * ⑤ runner `--json` 回执字段 ↔ verify-changed 消费字段对齐（Slice 1 新契约）。
 *   改坏任一侧字段名（emit 删字段 / consume 读错键）⇒ 本条必须红。
 */
test('⑤ runner JSON 回执字段与 verify-changed 消费字段逐一对齐', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/run-tests.mjs'), 'utf8');
  const changed = fs.readFileSync(path.join(ROOT, 'scripts/verify-changed.mjs'), 'utf8');

  // runner 回执条目必须产出这些键（buildJson / classifyRecord / reportStaticFail）
  const emitted = ['rel', 'ms', 'status', 'tests', 'pass', 'fail', 'skipped', 'todo', 'staticDeclared', 'ok', 'kind'];
  for (const key of emitted) {
    assert.match(runner, new RegExp(`\\b${key}\\s*:`), `runner 回执条目缺少字段 \`${key}\``);
  }
  // verify-changed 必须消费同一批键（ent.xxx 映射进 testRuns）
  for (const key of ['rel', 'ms', 'status', 'tests', 'pass', 'fail', 'kind', 'ok']) {
    assert.match(changed, new RegExp(`ent\\.${key}\\b`), `verify-changed 没消费 runner 回执的 \`${key}\` 字段`);
  }
  // 汇总对齐：runner summary.files/tests/pass/fail/skipped/todo/staticDeclared；消费方按 summary.files 对账
  for (const key of ['files', 'tests', 'pass', 'fail', 'skipped', 'todo', 'staticDeclared']) {
    assert.match(runner, new RegExp(`summary:[\\s\\S]*\\b${key}:`), `runner summary 缺字段 \`${key}\``);
  }
  assert.match(changed, /summary\.files/, 'verify-changed 必须用 runner summary.files 做汇总对账（不一致 fail-closed）');
  // kind 映射 fail-closed：static-fail→red、crash→crash、ok=false→red，不留 nosummary 洞
  assert.match(changed, /ent\.kind === 'static-fail'/, 'static-fail 必须映射为 red');
  assert.match(changed, /ent\.kind === 'crash'/, 'crash 条目必须保持 crash');
  assert.match(changed, /ent\.ok === false/, 'ok=false 必须判 red');
});
