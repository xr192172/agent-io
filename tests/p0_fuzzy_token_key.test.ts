/**
 * P0-2 · 容错键的**双向**判据（`AGENTS.md` 0.14（旧名 `AGENTS-RULES.md`） 的样板：同义必命中 / 异义必不命中）
 *
 * ## 它挡的事故（第二轮外审 P0-2，已实测）
 * `src/infrastructure/parse/fuzzy_match.ts` 的 L2 `keyWhitespace` 与 L3 `keyIndentFree` 共用一把
 * **字符级去空白**的键 ⇒ "内容不同"被当成"排版不同"：
 * ```
 * 'helloworld' → 'hello world' · a - -b → a--b · const foo Bar = 1; → const fooBar = 1;
 * ```
 * 不抛错、不告警、回执照旧说成功 —— 把**另一段文本**替上去。
 * ★ 而全仓**没有任何测试文件 import 它**（`grep -l fuzzy_match tests/*.ts` 当时是空）。
 *
 * ## 五组断言（少一组就有一向没有鉴别力 —— 0.14）
 * ① **同义必命中**：缩进 / 行尾空白 / CRLF / 空行 / 行内空格加宽 / 运算符紧凑 ⇒ 全部 `level >= 2` 且**唯一**；
 * ② **异义必不命中**：标识符中间插空格 / 字符串内容差空格 / 两 token 合并 / 运算符粘连 ⇒ 全部 `level === 0`；
 *    ★ 反例**按整行写**：`a--1` 单独当 old_text 其实是 L1 都不命中（缺上下文），复现不了 bug；
 * ③ **表自身**：多字符算子表里每一项都必须切成**恰好一个** token，表外的相邻字符必须保持**两个** token，
 *    且必须**最长优先**（否则 `--` 被切成两个 `-`，`a--b` 又会与 `a - -b` 等价）；
 * ④ **三处共用一把键（消融）**：把 `fuzzyLineKey` 的 token 腿改歪（换回旧的字符级去空白）⇒
 *    L2、L3、L4 三条路径必须**一起**变红 —— 证明没有第二把键（只改一级等于没改）；
 * ⑤ **`already_applied` 两向**：`new_text` 字节级出现 **1** 次 ⇒ `already_applied`；**>1** 次 ⇒ `ambiguous`；
 *    **0** 次 ⇒ `not_found`（旧实现拿四级级联判 `new_text`，两个方向都错：假 `already_applied` + 出现两次反而报 `not_found`）。
 *
 * ★ 为什么消融要**自己造一份改歪的副本**而不是改仓库源码：本文件必须能在**没改任何 src** 的情况下证明
 *   "打断这条腿会有用例变红"（0.14 的自查问句）。改歪副本住 `.agent-io/scratch/`（gitignored），跑完即删。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_REL = 'src/infrastructure/parse/fuzzy_match.ts';
const SRC_ABS = path.join(ROOT, SRC_REL);

// ★ 缺省档（tolerant）是本文件所有"应当"断言的口径；设成别的档必须由用例自己显式改并还原。
process.env.AGENT_IO_FUZZY_KEY = 'tolerant';

const { locateReplaceText, fuzzyTokens, MULTI_CHAR_OPERATORS, FUZZY_KEY_MODES, fuzzyKeyMode, classifyReplaceTextMiss } =
  await import('../src/infrastructure/parse/fuzzy_match.js');
const classify = classifyReplaceTextMiss;

type Loc = ReturnType<typeof locateReplaceText>;

/** 只有一处命中且级别 >= 2（= 模糊级接住了"排版不同"） */
function assertFuzzyHit(content: string, oldText: string, why: string): void {
  const r: Loc = locateReplaceText(content, oldText);
  assert.equal(r.candidates.length, 1, `${why}：必须恰好 1 处命中（实得 ${r.candidates.length} 处，行号 ${r.candidates.map((c) => c.startLine).join(',')}）`);
  assert.ok(r.level >= 2, `${why}：必须是模糊级（L2/L3/L4）命中，实得 L${r.level}`);
}

/** 至少命中（前置用：原行本来就该逐字命中，L1 才算"前置成立"） */
function assertHitAtAll(content: string, oldText: string, why: string): void {
  const r: Loc = locateReplaceText(content, oldText);
  assert.ok(r.level >= 1, `${why}：前置必须命中，实得 L0`);
  assert.equal(r.candidates.length, 1, `${why}：前置必须恰好 1 处命中（实得 ${r.candidates.length}）`);
}

/** 零命中（= "内容不同"没有被当成"排版不同"） */
function assertNoHit(content: string, oldText: string, why: string): void {
  const r: Loc = locateReplaceText(content, oldText);
  assert.equal(r.level, 0, `${why}：\`${oldText.split('\n')[0]}\` 不许命中，实得 L${r.level}（候选行号 ${r.candidates.map((c) => c.startLine).join(',')}）`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 同义必命中：只是排版不同 ⇒ 仍要命中
// ═══════════════════════════════════════════════════════════════════════════

const MULTILINE = 'function add(a, b) {\n  return a - b;\n}';
const SINGLE = 'const total = count + offset;';

test('① 同义必命中：缩进 +4（L3）', () => {
  assertFuzzyHit(MULTILINE + '\n', '    ' + MULTILINE.replace('\n', '\n    '), '整块缩进层级不同');
});

test('① 同义必命中：行尾空白（L2）', () => {
  const old = SINGLE.replace(';', ';   ');
  assertFuzzyHit(SINGLE + '\n', old, '行尾多了空格');
});

test('① 同义必命中：CRLF（L2）', () => {
  assertFuzzyHit(MULTILINE + '\n', MULTILINE.replace(/\n/g, '\r\n'), 'old_text 用 CRLF');
});

test('① 同义必命中：插空行（L3 忽略空行）', () => {
  const old = MULTILINE.replace('\n', '\n\n');
  assertFuzzyHit(MULTILINE + '\n', old, '整行空行插入');
});

test('① 同义必命中：行内空格加宽（L2）', () => {
  const old = 'const total   =   count   +   offset;';
  assertFuzzyHit(SINGLE + '\n', old, '行内空白宽窄不同');
});

test('① 同义必命中：运算符紧凑（L2，同 token 流）', () => {
  const old = 'const total=count+offset;';
  assertFuzzyHit(SINGLE + '\n', old, '`a - b` ↔ `a-b` 类：token 流没变');
  assertFuzzyHit(MULTILINE + '\n', 'function add(a, b) {\n  return a-b;\n}', '二元运算符两侧空白被去掉');
});

// ═══════════════════════════════════════════════════════════════════════════
// ② 异义必不命中：内容不同 ⇒ 不许命中（★ 反例按**整行**写）
// ═══════════════════════════════════════════════════════════════════════════

test('② 异义必不命中：标识符中间插空格', () => {
  assertNoHit(SINGLE + '\n', 'const to tal = count + offset;', '`total` 被切成 `to tal`');
  assertNoHit(MULTILINE + '\n', 'function add(a, b) {\n  return a - b;\n}'.replace('return', 'ret urn'), '`return` 被切成 `ret urn`');
});

test('② 异义必不命中：字符串内容差一个空格（引号内一字不动）', () => {
  const content = 'const msg = "hello world";\n';
  assertHitAtAll(content, 'const msg = "hello world";', '前置：同一行逐字命中');
  assertNoHit(content, 'const msg = "hello  world";', '字符串内容多一个空格');
  assertNoHit(content, 'const msg = "helloworld";', '字符串内容少一个空格');
});

test('② 异义必不命中：两个 token 合并成一个', () => {
  assertNoHit(SINGLE + '\n', 'consttotal = count + offset;', '`const total` 合并成 `consttotal`');
  assertNoHit(MULTILINE + '\n', 'function add(a, b) {\n  returna - b;\n}', '`return a` 合并成 `returna`');
});

test('② 异义必不命中：运算符粘连（同字符对 ≠ 同 token 流）', () => {
  // ★ 四对都必须**整行**写：单写 `a--1` 之类在文件里根本不存在，L0 是必然结果，复现不了 bug。
  const pairs: Array<[string, string, string]> = [
    ['let x = a--1;', 'let x = a - -1;', '`--` ≠ `- -`'],
    ['const f = (a) => a;', 'const f = (a) = > a;', '`=>` ≠ `= >`'],
    ['const v = a?.b;', 'const v = a ? . b;', '`?.` ≠ `? .`'],
    ['const n = 1.5;', 'const n = 1 . 5;', '`1.5` ≠ `1 . 5`'],
    ['const w = a << 2;', 'const w = a < < 2;', '`<<` ≠ `< <`'],
    ['const u = a !== b;', 'const u = a ! == b;', '`!==` ≠ `! ==`'],
  ];
  for (const [line, old, why] of pairs) {
    const content = line + '\n';
    assertHitAtAll(content, line, `前置：${why} 的原行逐字命中`);
    assertNoHit(content, old, why);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ③ 表自身：多字符算子表是有看守的（表内必须合并 / 表外不许合并 / 最长优先）
// ═══════════════════════════════════════════════════════════════════════════

test('③ 多字符算子表：每一项都切成**恰好一个** token', () => {
  assert.ok(MULTI_CHAR_OPERATORS.length >= 20, `表太小（${MULTI_CHAR_OPERATORS.length} 项）⇒ 覆盖不到真实算子`);
  for (const op of MULTI_CHAR_OPERATORS) {
    assert.deepEqual(fuzzyTokens(op), [op], `表项 \`${op}\` 必须切成恰好一个 token（否则它的"粘连 ≠ 分离"判据失效）`);
  }
});

test('③ 多字符算子表：表外的相邻非词字符必须保持两个 token（不发明合并）', () => {
  assert.equal(new Set(MULTI_CHAR_OPERATORS).size, MULTI_CHAR_OPERATORS.length, '表里不许有重复项');
  const pool = ['@', '#', ';', ',', '%', '!', '~', '&', '|', '<', '>', '?', '.', '-', '+', '=', '*', '/', ':'];
  let checked = 0;
  for (const a of pool) {
    for (const b of pool) {
      const pair = a + b;
      if (MULTI_CHAR_OPERATORS.includes(pair)) continue;
      checked++;
      assert.deepEqual(fuzzyTokens(pair), [a, b], `表外字符对 \`${pair}\` 必须切成两个 token（未知 ⇒ 保守 ⇒ 只漏不错）`);
    }
  }
  assert.ok(checked > 100, `样本太少（${checked} 对）⇒ 这条断言没有覆盖面`);
});

test('③ 多字符算子表：最长优先（不是最短）', () => {
  assert.deepEqual(fuzzyTokens('a--b'), ['a', '--', 'b'], '`--` 必须整体成一个 token');
  assert.deepEqual(fuzzyTokens('a===b'), ['a', '===', 'b'], '`===` 必须整体成一个 token（不能切成 `==`+`=`）');
  assert.deepEqual(fuzzyTokens('a>>>=b'), ['a', '>>>=', 'b'], '四字符算子也必须整体');
  assert.deepEqual(fuzzyTokens('a??=b'), ['a', '??=', 'b'], '`??=` 必须整体成一个 token（不能切成 `??`+`=`）');
});

test('③ 引号段：内部空白一字不动，含转义与三种引号', () => {
  assert.deepEqual(fuzzyTokens(`'hello world'`), [`'hello world'`]);
  assert.deepEqual(fuzzyTokens(`"hello  world"`), [`"hello  world"`]);
  assert.deepEqual(fuzzyTokens('`a b ${x} c`'), ['`a b ${x} c`']);
  assert.deepEqual(fuzzyTokens(`'it\\'s ok'`), [`'it\\'s ok'`], '引号内的转义不许提前闭合');
  assert.notDeepEqual(fuzzyTokens(`'a b'`), fuzzyTokens(`'ab'`), '引号内空白差一个 ⇒ 必须是两个不同的 token');
});

// ═══════════════════════════════════════════════════════════════════════════
// ④ 三处共用一把键（消融）：把键改歪 ⇒ L2 / L3 / L4 必须**一起**变红
// ═══════════════════════════════════════════════════════════════════════════

test('④ 消融：键改歪 ⇒ L2/L3/L4 三条路径一起变红（证明只有一把键）', async () => {
  const srcText = fs.readFileSync(SRC_ABS, 'utf8');
  const ANCHOR = 'return JSON.stringify(opts.keepIndent ? [lead, ...parts] : parts);';
  const occurrences = srcText.split(ANCHOR).length - 1;
  // ★ 锚点必须是**恰好一处**：不然 replace 会静默 no-op（0.4），消融用例会假绿。
  assert.equal(occurrences, 1, `消融锚点必须恰好出现 1 次（实得 ${occurrences}）—— 键实现被改写过就同步这条用例`);

  const ABLATED = 'return JSON.stringify(opts.keepIndent ? [lead, body.replace(/[ \\t]+/g, \'\')] : body.replace(/[ \\t]+/g, \'\')); // ABLATION';
  const mutated = srcText.replace(ANCHOR, ABLATED);
  assert.notEqual(mutated, srcText, '消融必须真的改到了源码（否则这条用例在验证空气）');

  const dir = path.join(ROOT, '.agent-io', 'scratch');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `ablate-fuzzy-${process.pid}-${Date.now()}.ts`);
  fs.writeFileSync(tmp, mutated, 'utf8');
  try {
    const ablated = (await import(pathToFileURL(tmp).href)) as {
      locateReplaceText: typeof locateReplaceText;
    };
    assert.notEqual(ablated.locateReplaceText, locateReplaceText, '★ 必须加载到**改歪的副本**，而不是同一个模块实例');

    // L2 路径：行内缩进不变、只有标识符被切开（旧键会接住）
    const l2Content = SINGLE + '\n';
    const l2Old = 'const to tal = count + offset;';
    // L3 路径：缩进也变了（L2 必定不中 ⇒ 走的就是 L3 那条腿）
    const l3Content = '    ' + SINGLE + '\n';
    const l3Old = 'const to tal = count + offset;';
    // L4 路径：带省略号（走的是 L4 那条腿）
    const l4Content = 'function f() {\n  const total = count + offset;\n  return total;\n}\n';
    const l4Old = 'function f() {\n  const to tal = count + offset;\n...';

    // 先确认三条腿在**真实现**上都是 L0（否则下面的"变红"无从谈起）
    assert.equal(locateReplaceText(l2Content, l2Old).level, 0, '真实现：L2 这条腿必须判不命中');
    assert.equal(locateReplaceText(l3Content, l3Old).level, 0, '真实现：L3 这条腿必须判不命中');
    assert.equal(locateReplaceText(l4Content, l4Old).level, 0, '真实现：L4 这条腿必须判不命中');

    // 再确认三条腿在**改歪的副本**上一起变红（= 三处确实共用同一把键）
    for (const [name, content, old] of [
      ['L2', l2Content, l2Old],
      ['L3', l3Content, l3Old],
      ['L4', l4Content, l4Old],
    ] as const) {
      const r = ablated.locateReplaceText(content, old);
      assert.ok(
        r.level >= 2,
        `消融后 ${name} 这条腿必须变红（键被改歪 ⇒ 异义被当同义），实得 L${r.level} ⇒ ` +
          '要么该级没走 fuzzyLineKey（第二把键），要么消融没打中',
      );
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑤ already_applied 两向（只认 L1 字节级出现次数）
// ═══════════════════════════════════════════════════════════════════════════

test('⑤ already_applied：new_text 出现 1 次 ⇒ already_applied（附行号）', () => {
  const content = 'const a = 1;\nconst b = 2;\n';
  const r = classify(content, 'const zzz = 9;', 'const a = 1;');
  assert.deepEqual(r, { kind: 'already_applied', line: 1 });
});

test('⑤ already_applied：new_text 出现 2 次 ⇒ ambiguous（旧实现在这里报 not_found）', () => {
  const content = 'const a = 1;\nconst b = 2;\n';
  const r = classify(content, 'const zzz = 9;', 'const');
  assert.equal(r.kind, 'ambiguous', `出现两次必须报歧义，实得 ${JSON.stringify(r)}`);
  assert.equal((r as { count: number }).count, 2);
  assert.deepEqual((r as { lines: number[] }).lines, [1, 2]);
});

test('⑤ already_applied：new_text 不在 ⇒ not_found（旧实现会把"排版不同"当成已应用）', () => {
  const content = 'const fooBar = 1;\n';
  // ★ 这一条正是旧行为的**假 already_applied**：`const foo Bar = 1;` 在旧 L2 键下与文件行同键。
  const r = classify(content, 'const zzz = 9;', 'const foo Bar = 1;');
  assert.equal(r.kind, 'not_found', `new_text 不在文件里就必须是 not_found，实得 ${JSON.stringify(r)}`);
});

test('⑤ already_applied：空 new_text 不算"已应用"（删除操作本来就没新文本）', () => {
  const content = 'const a = 1;\n';
  assert.equal(classify(content, 'const zzz = 9;', '').kind, 'not_found');
  assert.equal(classify(content, 'const zzz = 9;', '   ').kind, 'not_found');
});

// ═══════════════════════════════════════════════════════════════════════════
// 开关：三档必须真的存在，且 `old` 真的是旧行为（回滚通道不是口号）
// ═══════════════════════════════════════════════════════════════════════════

test('开关：缺省 tolerant · 非法值直接抛（不静默回落）· old 复现旧误命中', () => {
  const content = SINGLE + '\n';
  const bad = 'const to tal = count + offset;';

  const saved = process.env.AGENT_IO_FUZZY_KEY;
  try {
    delete process.env.AGENT_IO_FUZZY_KEY;
    assert.equal(fuzzyKeyMode(), 'tolerant', '不设开关 = tolerant');

    process.env.AGENT_IO_FUZZY_KEY = 'nope';
    assert.throws(() => fuzzyKeyMode(), /不是合法值/, '非法值必须抛（静默回落会让"设错了"与"没设"同形）');

    process.env.AGENT_IO_FUZZY_KEY = 'old';
    assert.equal(fuzzyKeyMode(), 'old');
    // `old` = 旧行为：它**必须**把"内容不同"接住 —— 这正是要被它取代的那条腿（也是回滚通道的价值）。
    assert.ok(locateReplaceText(content, bad).level >= 2, 'old 档必须复现旧误命中（否则"回滚"是假的）');
  } finally {
    if (saved === undefined) process.env.AGENT_IO_FUZZY_KEY = 'tolerant';
    else process.env.AGENT_IO_FUZZY_KEY = saved;
  }

  // 还原后 tolerant 口径必须回来
  assert.equal(locateReplaceText(content, bad).level, 0, '还原成 tolerant 后异义必须不命中');
});

test('开关：三档都在 FUZZY_KEY_MODES 里（没有第二份清单）', () => {
  assert.deepEqual([...FUZZY_KEY_MODES], ['tolerant', 'strict', 'old']);
});

test('strict 比 tolerant 更紧：算子邻空白不一致 ⇒ 不命中', () => {
  // strict 只对**算子**看邻空白；用它证明"更紧"这一档是真的在起作用（默认可不开）。
  const content = 'const total = count + offset;\n';
  const saved = process.env.AGENT_IO_FUZZY_KEY;
  try {
    process.env.AGENT_IO_FUZZY_KEY = 'strict';
    assert.ok(locateReplaceText(content, 'const total  =  count + offset;').level >= 2, 'strict：非算子旁的空白宽窄仍容忍');
    assert.equal(locateReplaceText(content, 'const total=count+offset;').level, 0, 'strict：算子两侧空白全去掉 ⇒ 不命中');
  } finally {
    if (saved === undefined) process.env.AGENT_IO_FUZZY_KEY = 'tolerant';
    else process.env.AGENT_IO_FUZZY_KEY = saved;
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// [已知洞]（钉住现状，**不是**"判据通过"）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 这条断言**不是在说这是对的**：它是把"已知边界"钉在读数上。
 * 病：**多行字面量的中间行**（JS 模板串 / Python 三引号 / Go 裸串）行内没有引号字符，
 *     逐行 tokenize 无从知道"这一行在字符串里" ⇒ 那里的空白仍会被折叠（**错**的方向）。
 * 为什么不顺手修：要判"这一行位于未闭合引号内"就得先能识别注释里的撇号（`// don't`），
 *     正则硬上会把整段代码误标成字符串 ⇒ 变成大面积**漏命中**（比错更糟的是不可见）。
 * ★ 谁把跨行字面量收口了，这条会红：那时必须同步改 `fuzzy_match.ts` 文件头的「已知洞」段。
 */
test('[已知洞] 多行字面量中间行：内部空白仍被判等价（收口时本用例应变红）', () => {
  const content = 'const t = `\n  a b\n`;\n';
  assert.equal(
    locateReplaceText(content, 'const t = `\n  a  b\n`;').level,
    2,
    '[已知洞] 现状：模板串中间行的空白差被当成排版差（L2）—— 修掉跨行字面量判定后改成 0',
  );
});
