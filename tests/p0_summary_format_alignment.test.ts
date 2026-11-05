/**
 * 守两件"两个文件必须对齐、而对不上时没人会红"的事（0.25①）。
 *
 * ★ 为什么需要（2026-11-05 实测的两处**假绿入口**）：
 *   1. `scripts/verify-changed.mjs` 用正则从 `scripts/run-tests.mjs` 的输出里取「测试门：文件 N / 用例 M / 通过 P / 失败 F / 跳过 S」。
 *      `run-tests` 后来在 `用例 M` 后面加了 `（源码声明 K）`，**正则没跟着改** ⇒ `hasSummary` 恒 false
 *      ⇒ `fail` 恒 null ⇒ 所有测试落进 `nosummary`。红还能靠 `rc!==0` 兜住，
 *      但"跑了几条、过了几条"这个能力**整个丢了**（违反它自己引的 0.12 带分母）。
 *   2. `verify-changed.mjs` 自己写了一份「只扫顶层」的测试文件收集器（82 个），
 *      而 `run-tests.mjs` 是**递归**（85 个）⇒ `tests/{budget,locate,rate}/` 三个文件
 *      **在内环里永远选不中，而它自己不知道**。注释当时还写着"收集规则与 run-tests.mjs 一致"。
 *
 * ★ 本文件**不跑**那两个脚本（它们是重活，且本文件不该顺手跑别的证）——
 *   它只做两件**静态对齐**断言，而这恰好是那两个缺陷的**唯一共同形态**：
 *   「A 产出的格式」与「B 消费它的规则」必须能对上；「同一份清单」只能有**一个**收集实现。
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

/** 从 `verify-changed.mjs` 里取出那条汇总正则的**源码字面量** */
function extractSummaryRegex() {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/verify-changed.mjs'), 'utf8');
  const at = src.indexOf('out.match(/测试门：文件');
  assert.ok(at >= 0, '★ verify-changed.mjs 里找不到 `out.match(/测试门：文件…` —— 本断言的前提没了');
  const start = src.indexOf('/', at);
  // 正则字面量内 `/` 会被写成 `\/` ⇒ 从后往前找那个**未转义**的收尾斜杠
  let end = -1;
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '/') { end = j; break; }
    if (src[j] === '\n') break;
  }
  assert.ok(end > start, '★ 解析不出正则字面量的收尾 `/`');
  return src.slice(start + 1, end);
}

test('① 汇总正则必须能匹配 run-tests 的真实输出格式（含可选的「（源码声明 N）」）', () => {
  const rendered = renderSummaryFormat();
  const re = new RegExp(extractSummaryRegex());
  const m = rendered.match(re);
  assert.ok(
    m,
    '★★ 汇总正则匹配不上 run-tests 的真实输出 ⇒ hasSummary 会恒 false、fail 恒 null、所有测试落 nosummary。\n' +
      '   真实输出形如：' + JSON.stringify(rendered) + '\n' + '   当前正则：' + re,
  );
  // 捕获组要**位置正确**（文件 / 用例 / 通过 / 失败 / 跳过），不能只是"匹配上了"
  assert.equal(m[1], '3', '文件数捕获错位');
  assert.equal(m[2], '11', '用例数捕获错位');
  assert.equal(m[3], '10', '通过数捕获错位（★ 中间那个「（源码声明 N）」必须被可选组吃掉，不能把通过数挤到错误的下标）');
  assert.equal(m[4], '1', '失败数捕获错位');
  assert.equal(m[5], '0', '跳过数捕获错位');
});

test('② 反向：「汇总行不存在」时不许假装匹配（鉴别力）', () => {
  const re = new RegExp(extractSummaryRegex());
  assert.equal(re.test('测试门：什么都没打印'), false, '★ 正则太松：不该匹配不含汇总行的输出');
  assert.equal(re.test('随便一行：文件 3 / 用例 11'), false, '★ 正则太松：缺 通过/失败/跳过 也应不匹配');
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
  //   ★ 试过 `stripCommentsSync`（仓里的 AST 权威）：它对 `.mjs` 返回 **null**（只认 TS/TSX 语法）
  //     ⇒ 那是它的能力边界，本测试**不靠它**（也不自己再造一个剥注释实现 —— 0.9.1）。
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
