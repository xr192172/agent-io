/**
 * P0 · **自指度量污染**（规则 H）—— 计数型判据的载体包含它自己数的那串文本
 *
 * ## 它守的缺陷（2026-11-05 R73 实测，逐字）
 * `scripts/verify.mjs` 的 typedef 注释里写下「本表条数不变（`kind: 'gate'` 的计数前后一致）」——
 * 那句话**本身就含那个字面串** ⇒ 同一个 `grep -c` 从 15 变 16
 * ⇒ **用来证明"没加门"的量具，被自己写进去的注释抬高了一格**，而读数照样是"对的数"。
 * ★ 当时**只靠人眼 + 再数一遍**发现（AGENTS 0.4），没有任何机器检测点 ⇒ 本证就是那个检测点（0.25①）。
 *
 * ## 四条判据（缺一条这条守卫就会退化成"永远会亮的灯"或"永远绿"）
 * ① **真造一次自污染**：造一个真在数某串的脚本 + 一行含该串的注释 ⇒ 必须红，且点名文件 + 针 + 注释行号；
 * ② **消融**：把 H 的判定那一行摘掉 ⇒ 同一份输入必须变绿（证明是**它**抓的，不是别的东西）；
 * ③ **异义必不命中**：注释里出现**别的**串 ⇒ 不许红；不数任何文本的脚本 ⇒ 不许被算进分母；
 * ④ **分母**：扫了几个文件 / 几个计数点 / 几个纯字面针 / 几个文件真有计数点 —— 四个数都要在。
 *
 * ## 已声明的边界（0.17①，锁成用例而不是写在注释里就完）
 * · needle 落在**字符串字面量**里 ⇒ **不判**（仓里没有「这段字符串是散文还是数据」的权威；
 *   靠启发式会把"数据里本来就有这个串"全判红 ⇒ 0.16）。下面的 `⑤` 就是这个边界的**行为**锁。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkSelfPollutingCounts } from '../scripts/lint-prose-as-structure.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** 在临时根里造文件（键 = 仓库相对路径，正斜杠）⇒ 返回根 */
function rootWith(files: Record<string, string>): string {
  // ★ 临时根必须落在**仓内**：`script_tiers.mjs` 改用 AST 后 `import 'typescript'`，
  //    而 Node 的模块解析要从临时根往上找 `<repo>/node_modules` —— 放 `os.tmpdir()` 会永远找不到
  //    （2026-11-06 实测：消融用例因此红，且是**改了 B 的修法**带出来的连带伤）。
  const scratch = path.join(REPO, '.agent-io', 'scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'self-count-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }
  return root;
}

/** 一个**真在数某个字面串**的脚本：`split(针).length - 1` 是最普遍的计数形态 */
function countingScript(extra: string): string {
  return [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    extra,
    "const raw = fs.readFileSync('scripts/x.mjs', 'utf8');",
    "const gates = raw.split(\"kind: 'gate'\").length - 1;",
    'if (gates !== 15) process.exit(1);',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

test('① 真造一次自污染 ⇒ 红，并点名「文件 + 针 + 注释行号」', () => {
  const root = rootWith({
    'scripts/probe.mjs': countingScript("// 本表条数不变（kind: 'gate' 的计数前后一致）"),
  });
  const r = checkSelfPollutingCounts(root);
  assert.equal(r.problems.length, 1, `应当恰好 1 处自污染，实得 ${JSON.stringify(r.problems)}`);
  const p = r.problems[0];
  assert.equal(p.rule, 'H');
  assert.equal(p.file, 'scripts/probe.mjs');
  assert.match(p.msg, /kind: 'gate'/, '必须点名是哪个 needle');
  assert.match(p.msg, /3 行/, '必须点名注释在哪一行');
  assert.equal(p.line, 5, '计数点在第 5 行（注释占了第 3 行）');
  // 分母（0.12③）：四个数都要在
  assert.equal(r.scanned, 1, '扫了 1 个文件');
  assert.equal(r.skipped, 0, '没有判不了的文件');
  assert.equal(r.points.length, 1, '1 个计数型判据点');
  assert.equal(r.plainPoints.length, 1, '其中 1 个是纯字面针');
  assert.equal(r.filesWithPoints, 1, '真有计数点的文件 1 个');
});

test('② 消融：把 H 的判定那一行摘掉 ⇒ 同一份输入必须变绿', async () => {
  // 复制成一个**同一相对结构**的临时模块树（保持 `../src/…` 与 `./lib/…` 的指向不变）
  // ★ 同 ①：临时模块树必须落在**仓内**，否则复制过去的 `scripts/lib/script_tiers.mjs`
  //    会 `import 'typescript'` 解析不到（2026-11-06 实测红）。
  const ablateScratch = path.join(REPO, '.agent-io', 'scratch');
  fs.mkdirSync(ablateScratch, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(ablateScratch, 'self-count-ablate-'));
  const src = path.join(REPO, 'scripts/lint-prose-as-structure.mjs');
  const dst = path.join(tmp, 'scripts/lint-prose-as-structure.mjs');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const code = fs.readFileSync(src, 'utf8');
  const lever = 'if (commentLines.length === 0) continue;';
  assert.ok(code.includes(lever), `消融锚点不见了（${lever}）—— 改了 H 的判定就得同步改这条用例`);
  fs.writeFileSync(dst, code.replace(lever, 'if (commentLines.length >= 0) continue; // 消融：永远跳过判定'), 'utf8');
  fs.mkdirSync(path.join(tmp, 'scripts/lib'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'scripts/lib'))) {
    fs.copyFileSync(path.join(REPO, 'scripts/lib', f), path.join(tmp, 'scripts/lib', f));
  }
  fs.mkdirSync(path.join(tmp, 'src/domain'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'src/domain/text_strip.ts'), path.join(tmp, 'src/domain/text_strip.ts'));

  const ablated = await import(pathToFileURL(dst).href);
  const root = rootWith({
    'scripts/probe.mjs': countingScript("// 本表条数不变（kind: 'gate' 的计数前后一致）"),
  });

  const real = checkSelfPollutingCounts(root);
  const cut = ablated.checkSelfPollutingCounts(root);
  assert.equal(real.problems.length, 1, '原判定必须红（否则消融证明不了任何事）');
  assert.equal(cut.problems.length, 0, '摘掉判定后必须变绿 ⇒ 红是**这一行**抓的，不是别的东西');
  assert.equal(cut.points.length, real.points.length, '消融只摘判定、不动分母（计数点照样被找到）');
});

test('③ 异义必不命中：注释里是**别的**串 ⇒ 不许红', () => {
  const root = rootWith({
    'scripts/probe.mjs': countingScript('// 这里说的是另一件事（other: thing 的计数）'),
  });
  const r = checkSelfPollutingCounts(root);
  assert.equal(r.problems.length, 0, `异义被误判成自污染：${JSON.stringify(r.problems)}`);
  assert.equal(r.points.length, 1, '计数点仍应被找到（分母不受影响）');
});

test('③ 不数任何文本的脚本：不许被算进分母、也不许红', () => {
  const root = rootWith({
    'scripts/plain.mjs': [
      '#!/usr/bin/env node',
      "// 纯判定脚本：注释里随便写 kind: 'gate' 也不会把自己抬高",
      "const ok = process.argv.includes('--json');",
      'process.exit(ok ? 0 : 1);',
      '',
    ].join('\n'),
  });
  const r = checkSelfPollutingCounts(root);
  assert.equal(r.problems.length, 0);
  assert.equal(r.points.length, 0, '它不是计数型判据点');
  assert.equal(r.filesWithPoints, 0, '真有计数点的文件数必须是 0（不许被扫进这个分母）');
  assert.equal(r.scanned, 1, '但它确实被扫过（扫描分母与判据分母是两个数）');
});

test('⑤ 已声明边界：needle 只在**字符串字面量**里 ⇒ 不判（不是漏，是声明）', () => {
  const root = rootWith({
    'scripts/probe.mjs': [
      '#!/usr/bin/env node',
      "import fs from 'node:fs';",
      "const NOTE = \"提示串里提到 kind: 'gate' 也不算注释\";",
      "const raw = fs.readFileSync('scripts/x.mjs', 'utf8');",
      "const gates = raw.split(\"kind: 'gate'\").length - 1;",
      'if (gates !== 15) process.exit(1);',
      '',
    ].join('\n'),
  });
  const r = checkSelfPollutingCounts(root);
  assert.equal(r.problems.length, 0, '字符串字面量这一档**显式不判**（见文件头「已声明的边界」）');
  assert.equal(r.plainPoints.length, 1, '针本身仍是纯字面针 ⇒ 分母照常');
});

test('④ 真仓现跑：0 处自污染（不是"永远会亮的灯"，0.16）且分母非零', () => {
  const r = checkSelfPollutingCounts(REPO);
  assert.equal(r.problems.length, 0, `真仓出现自污染：${JSON.stringify(r.problems)}`);
  assert.ok(r.scanned > 100, `扫过的文件数太少（${r.scanned}）—— 分母不像真的`);
  assert.equal(r.skipped, 0, `有 ${r.skipped} 个文件判不了（剥注释后行数不守恒）`);
});
