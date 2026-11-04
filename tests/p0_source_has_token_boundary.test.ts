/**
 * P0 · `source-has` 匹配核的 **token 边界**（`domain/expectation_kinds.ts#matchSourceHas`）。
 *
 * ## 它钉的是什么（这是一个"错而没有声音"的 P0）
 * 册里 **119 条 `source-has` 判据**共用这一个匹配核。它此前是**纯 `includes`** ⇒ 裸名针会被
 * **更大的标识符**满足：
 * ```
 * must:["restore"]  vs  `function restored()`            ⇒ 命中（该 miss）
 * must:["foo"]      vs  `fooBar` / `myfoo`              ⇒ 命中（该 miss）
 * mustNot:["skip"]  vs  `tot.skipped`                    ⇒ 报违规（**假红**）
 * ```
 * 用**真判定核** `judgeExpectations`（不是 `matchSourceHas` 模拟）实测：`scripts/impl-mutate.mjs`
 * 的 `restore → restored`（名 + 全部调用点）变体此前 **pass**。
 * ⇒ 根治：**按针形分档**，裸标识符走 `hasIdentifierToken`（完整 token），其余保持 `includes`。
 *
 * ## ★ 这个核**能**保证什么、**不能**保证什么（写死在判据里，防下一个人高估它）
 * ```
 * 能：① 裸名被更大的标识符满足 ⇒ 不命中（restore vs restored / foo vs fooBar）
 *     ② 裸名被更小的标识符包含 ⇒ 不算违规（mustNot skip vs tot.skipped）
 * 不能：③ 「整段删掉 `function restore(){}`、只留调用点 `restore()`」⇒ 仍然**命中**
 *        —— 因为调用点里的 `restore` 就是一个**完整 token**。
 *        "这是声明还是使用" 是**结构问题**（0.18：判结构走 AST），不是边界问题；
 *        也拿不到 AST（判据可以指向 .md / 片段文本，见 text_strip.ts#isIdentifierChar 的注释）。
 *        ⇒ 这类破坏要靠**换锚点**：`must:["function restore("]`（文本定义形态）或
 *          `symbol-exists{symbol:"restore"}`（结构形态）。⑦ 把这条差异同时钉住。
 * ```
 *
 * ## 为什么住 `npm test` 而不是册里的 `behavior-cases`
 * 两个谓词（`isIdentifierNeedle` / `hasIdentifierToken`）**已经在册里**有 `behavior-cases`
 * （`file_src_domain_text_strip_ts` #3/#4）—— 那是纯谓词层。
 * 这一层钉的是**端到端**（真判定核 + 真文件读取 + 变异体）与**消融**，`behavior-cases`
 * 的求值域装不下（要落临时文件、要跑判定核）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchSourceHas } from '../src/domain/expectation_kinds.js';
import { hasIdentifierToken, isIdentifierNeedle } from '../src/domain/text_strip.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 今天那份"只 includes"的口径 —— 只用于**消融对照**，**任何生产路径都不许用它** */
const naiveIncludes = (hay: string, needle: string): boolean => hay.includes(needle);

const misses = (hay: string, must: string[]): string[] => matchSourceHas(hay, must, []).missMust;
const hitNot = (hay: string, mustNot: string[]): string[] => matchSourceHas(hay, [], mustNot).hitMustNot;

// ── ① 分档（分错档 = 大面积误红，这是本卡的第二个失效面） ─────────────────
test('① isIdentifierNeedle：裸标识符档 true / 代码片段·SQL·散文档 false（0.14 双向）', () => {
  for (const yes of ['foo', 'fooBar', '_x', '$x', 'path_base', 'AGENT_IO_HOME', 'restore', 'x1']) {
    assert.equal(isIdentifierNeedle(yes), true, `应判为裸标识符：${JSON.stringify(yes)}`);
  }
  for (const no of ['fs.renameSync(tmp, file)', '不是项目根', 'SELECT file, structure FROM t', '', '1foo', 'a-b', 'a.b', 'foo bar', ' foo']) {
    assert.equal(isIdentifierNeedle(no), false, `不应判为裸标识符：${JSON.stringify(no)}`);
  }
});

// ── ② 异义必不命中（must 方向） ────────────────────────────────────────
test('② must 的裸名必须整词命中：restored / fooBar / myfoo / path_base_source 都不算', () => {
  const cases: Array<[string, string]> = [
    ['function restored() {\n  return 1;\n}', 'restore'],
    ['const fooBar = 1;', 'foo'],
    ['const myfoo = 1;', 'foo'],
    ['const path_base_source = 1;', 'path_base'],
    ['const tot = { skipped: 3 };', 'skip'],
    ['const skipAll = 1;', 'skip'],
    ['x = renameSync2(tmp);', 'renameSync'],
  ];
  for (const [hay, needle] of cases) {
    assert.deepEqual(misses(hay, [needle]), [needle], `「${needle}」不该被 ${JSON.stringify(hay)} 满足（切开了 token）`);
  }
});

// ── ③ 同义必命中（排版变体不许误伤） ───────────────────────────────────
test('③ must 的裸名在完整 token 上必命中：函数声明/调用/简写属性/CRLF/缩进', () => {
  const cases: Array<[string, string]> = [
    ['function restore() {\n  return 1;\n}', 'restore'],
    ['foo(x);', 'foo'],
    ['const o = { foo };', 'foo'],
    ['\r\n    restore();\r\n', 'restore'],
    ['\t\tfoo   ( 1 );', 'foo'],
    ['const $x = 1;', '$x'],
    ['function restore() {}', 'restore'],
  ];
  for (const [hay, needle] of cases) {
    assert.deepEqual(misses(hay, [needle]), [], `「${needle}」应命中 ${JSON.stringify(hay)}`);
  }
});

// ── ④ mustNot 的**相反方向**（今天正在发生的假红） ───────────────────────
test('④ mustNot 的裸名 = 不得作为完整 token：tot.skipped / skipped 不违规，var skip = 1 违规', () => {
  assert.deepEqual(hitNot('const tot = { skipped: 3 };', ['skip']), [], '`skip` 落在 `tot.skipped` 里 ⇒ 不违规（今天的假红）');
  assert.deepEqual(hitNot('const skipped = 3;', ['skip']), [], '`skip` 落在 `skipped` 里 ⇒ 不违规');
  assert.deepEqual(hitNot('var skip = 1;', ['skip']), ['skip'], '`skip` 是完整 token ⇒ 违规');
  assert.deepEqual(hitNot('if (skip) { go(); }', ['skip']), ['skip'], '括号两侧仍是完整 token ⇒ 违规');
});

// ── ⑤ 非标识符针保持原语义（不许被 token 规则误伤） ───────────────────────
test('⑤ 代码片段 / 中文散文 / SQL 针仍按 includes 命中（token 规则不适用于它们的边界）', () => {
  for (const [hay, needle] of [
    ['  fs.renameSync(tmp, file);\n', 'fs.renameSync(tmp, file)'],
    ['抛错：不是项目根，请检查', '不是项目根'],
    ['const q = "SELECT file, structure FROM t";', 'SELECT file, structure FROM t'],
    ['.build-manifest.json', '.build-manifest.json'],
  ] as Array<[string, string]>) {
    assert.deepEqual(misses(hay, [needle]), [], `非裸名针必须命中：${JSON.stringify(needle)}`);
  }
  // 反向：非裸名针**不因**"出现在更大串里"而失配（旧语义 = 子串即可）
  assert.deepEqual(misses(['xfs.renameSync(tmp, file)y'], ['fs.renameSync(tmp, file)']), [], '非裸名针两端相接仍算命中（旧语义不变）');
});

// ── ⑥ 真判定核 + 变异体（核心验收：不是推演，是 verdict） ──────────────────
/** 与 `scripts/impl-mutate.mjs` 同形的夹具：一个函数 + 两处调用点 */
const FIXTURE = [
  '#!/usr/bin/env node',
  'let state = null;',
  'function extractMutants(src) { return [src]; }',
  'function restore() {',
  "  if (state) require('node:fs').writeFileSync('x', state);",
  '  state = null;',
  '}',
  'try {',
  '  const m = extractMutants("x");',
  '  restore();',
  '} finally {',
  '  restore();',
  '}',
  '',
].join('\n');

function dropFunction(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `夹具里必须有 function ${name}( —— 否则这条用例什么都没测`);
  const open = src.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(0, at) + src.slice(i + 1);
}

/**
 * 把一份文本当某个相对路径喂**真判定核**（落 os.tmpdir，**不碰仓库任何文件**）。
 * ★ 判定核会自己在该 root 下建 `.agent-io/cache.db`（新鲜度检查），sqlite 句柄可能还没释放 ⇒
 *   收尾是**尽力而为**：删不掉就把目录留给 OS 的 tmp 清理，**不许**因此让断言假红（那是"清理失败"
 *   冒充"判据失败"，0.12 的同一个病）。
 */
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-src-has-'));
test.after?.(() => {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* 句柄未释放 ⇒ 留给 OS 清理；不影响任何断言 */
  }
});
let judgeSeq = 0;
async function judgeText(text: string, expectation: Record<string, unknown>): Promise<string> {
  const rel = `fixture-${++judgeSeq}.mjs`;
  fs.writeFileSync(path.join(TMP_ROOT, rel), text, 'utf-8');
  const rep: any = await judgeExpectations(TMP_ROOT, [
    { node_id: 'fixture', node_label: 'fixture', expectation: { ...expectation, path: rel, why: 'p0_source_has_token_boundary 夹具' } as any },
  ]);
  return String(((rep.items ?? [])[0] as any)?.verdict ?? 'MISSING');
}

test('⑥ 真判定核 · 裸名针：原样 pass；restore→restored 与 extractMutants 改名必须 fail', async () => {
  const MUST = { kind: 'source-has', must: ['restore', 'extractMutants'] };
  assert.equal(await judgeText(FIXTURE, MUST), 'pass', '原样必须 pass（反向：不许为了收紧把对的判红）');

  const renamed = FIXTURE.replace(/\brestore\b/g, 'restored');
  assert.equal(await judgeText(renamed, MUST), 'fail', '`restore`→`restored`（名 + 全部调用点）必须 fail');

  const renamedFn = FIXTURE.replace(/\bextractMutants\b/g, 'extractMutantsOld');
  assert.equal(await judgeText(renamedFn, MUST), 'fail', '`extractMutants`→`extractMutantsOld` 必须 fail');
});

// ── ⑦ 边界只在"整词性"上：删函数留调用 ⇒ 裸名针**抓不住**，换锚点才抓住 ────
test('⑦ ★ 锚点效应：删掉 `function restore()` 只留调用点 ⇒ 裸名针 pass（已知边界），定义锚点必须 fail', async () => {
  const dropped = dropFunction(FIXTURE, 'restore');
  assert.ok(!/function restore\(/.test(dropped), '夹具构造失败：函数没被删掉');

  // ① 裸名针：调用点里的 `restore` 仍是完整 token ⇒ **仍然命中**。
  //    ★ 这条**不是**缺陷、是刻意的边界声明（见文件头「不能保证什么」③）：
  //      判"这是声明还是使用"要 AST，而本核只拿得到一段文本。
  assert.equal(
    await judgeText(dropped, { kind: 'source-has', must: ['restore'] }),
    'pass',
    '裸名针抓不住"删函数留调用"—— 若这里变 fail，说明有人把边界规则扩成了结构判定（越界）',
  );

  // ② 换**文本定义锚点** ⇒ 必须红
  assert.equal(
    await judgeText(dropped, { kind: 'source-has', must: ['function restore('] }),
    'fail',
    '`must:["function restore("]` 在函数被删后必须 fail',
  );
  assert.equal(
    await judgeText(FIXTURE, { kind: 'source-has', must: ['function restore('] }),
    'pass',
    '`must:["function restore("]` 在原样文件上必须 pass（否则锚点写错）',
  );

  // ③ 换**结构锚点** ⇒ 必须红（`scripts/impl-mutate.mjs` 的两条判据就是升级成这个）
  assert.equal(await judgeText(dropped, { kind: 'symbol-exists', symbol: 'restore' }), 'fail', '`symbol-exists{restore}` 在函数被删后必须 fail');
  assert.equal(await judgeText(FIXTURE, { kind: 'symbol-exists', symbol: 'restore' }), 'pass', '`symbol-exists{restore}` 在原样文件上必须 pass');
  assert.equal(
    await judgeText(FIXTURE.replace(/\brestore\b/g, 'restored'), { kind: 'symbol-exists', symbol: 'restore' }),
    'fail',
    '`symbol-exists{restore}` 在改名后必须 fail',
  );
});

// ── ⑧ 消融：内置"只 includes"对照 —— 没有它，上面几条证明不了边界腿在起作用 ──
test('⑧ 消融对照：naive includes 在所有异义用例上都会判命中 ⇒ 这些用例有鉴别力', () => {
  const pairs: Array<[string, string]> = [
    ['function restored() {}', 'restore'],
    ['const fooBar = 1;', 'foo'],
    ['const myfoo = 1;', 'foo'],
    ['const path_base_source = 1;', 'path_base'],
    ['const tot = { skipped: 3 };', 'skip'],
  ];
  for (const [hay, needle] of pairs) {
    assert.equal(naiveIncludes(hay, needle), true, `消融对照失效：naive includes 竟然不命中 ${JSON.stringify(needle)}`);
    assert.equal(misses(hay, [needle]).length, 1, `边界腿失效：matchSourceHas 竟然判命中 ${JSON.stringify(needle)}`);
  }
  // mustNot 方向的同一消融：naive 会把 `tot.skipped` 判成违规（今天的假红），本核不判
  assert.equal(naiveIncludes('const tot = { skipped: 3 };', 'skip'), true, '消融对照失效（mustNot 方向）');
  assert.deepEqual(hitNot('const tot = { skipped: 3 };', ['skip']), [], '边界腿失效（mustNot 方向）');
});

// ── ⑨ 谓词级补充：hasIdentifierToken 的边界情形 ──────────────────────────
test('⑨ hasIdentifierToken 的边界：空针 / 首尾贴边 / 只命中一部分', () => {
  assert.equal(hasIdentifierToken('anything', ''), false, '空针必须 false（否则 must 恒绿、mustNot 恒红）');
  assert.equal(hasIdentifierToken('restore', 'restore'), true, '整串即 token');
  assert.equal(hasIdentifierToken('foo(1)', 'foo'), true, '后接标点');
  assert.equal(hasIdentifierToken('$foo', 'foo'), false, '`$` 是标识符字符 ⇒ 切开 token');
  assert.equal(hasIdentifierToken('foo$', 'foo'), false, '尾部 `$` 同理');
  assert.equal(hasIdentifierToken('a foo b fooBar c foo', 'foo'), true, '至少一处完整即命中');
  assert.equal(hasIdentifierToken('a fooBar b myfoo', 'foo'), false, '全部都在更大 token 里 ⇒ miss');
});
