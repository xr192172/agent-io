/**
 * P0 · `run` 的 `expect` 不许含环境态（**写入时拒**）+ 存量不崩（**读取不校验**）+ 消融
 *
 * ## 它钉的是哪一档假绿（AGENTS 0.12 第 2 条，逐字要求「写入时拒」）
 * `run` 的 `expect` 是**任意 JS**，由 `new Function` 求值 ⇒
 * · `Date.now() > 0` **永远为真**：判据绿，而它什么也没验；
 * · `fs.readdirSync(d)[0] === 'a.ts'` **顺序依赖**：同一份代码在两个平台上结论不同。
 * 两种都「绿着撒谎」，读数上却与真判据长得一模一样 ⇒ 只能在**写入那一刻**拒
 * （0.9.4③：让它在结构上写不进来，不靠"记得别这么写"）。
 *
 * ## 为什么还要住 `npm test`（册里的 `behavior-cases` 不够）
 * 册里那条（`decision:file_src_domain_expectation_kinds_ts#4`）判的是**词表判得对不对**；
 * 这里补的是**它必须真的拦得住**：端到端（`validateExpectation` 真的拒）+ **消融**
 * （把声明摘掉再加载一次模块 ⇒ 同一批输入全部放行）。消融要"改声明 + 重新 import"，
 * 一条 `expect` 表达不了（`T-#BEHAVIOR-CASES-CANT-EXPRESS-THROW` 同族）。
 *
 * ## 边界（0.12 第 2 条自己划的线，② 那组就守着它）
 * `fs.existsSync(目标)` / `fs.readFileSync(目标)` / `validateDSL(...)` / `input.*` 是
 * 「**目标内容**」与「**显式输入**」，不是环境态 ⇒ **必须放行**；
 * 把它们也拒了 = 把判据逼成没法写（实测本仓 75 处 `existsSync` 全属这一类）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = path.join(HERE, '..', 'src', 'domain');

const { ENV_STATE_TOKENS, validateExpectation } = await import('../src/domain/expectation_kinds.js');
const { getDesignSheet, getDesignSheetFile } = await import('../src/infrastructure/storage.js');

/** 一条 `run` 判据的写入结果（`null` = 放行，字符串 = 拒绝文案） */
const writeRun = (expect: string): string | null =>
  validateExpectation({ kind: 'run', expect, why: `夹具：${expect}` }, 'expectations[0]');

/**
 * ① 那一组 —— **每一条都必须被拒**（也是消融用的同一批：摘掉声明它就必须全部放行）。
 * ★ 五条各点名一个**不同**的词，避免"只拦住了 Date"冒充"五个都拦"。
 */
const BANNED_SAMPLES: readonly { expect: string; token: string }[] = [
  { expect: 'Date.now() > 0', token: 'Date' },
  { expect: 'Math.random() > 0.5', token: 'Math.random' },
  { expect: 'performance.now() >= 0', token: 'performance' },
  { expect: "fs.readdirSync('src')[0] === 'a.ts'", token: 'readdir' },
  { expect: 'process.env.AGENT_IO_ACTOR === "x"', token: 'process' },
];

/**
 * ② 反向那一组 —— **一条都不许拒**。分界就是 0.12 第 2 条那句：
 * 「这条线画在**是不是目标文件的内容**，不是是不是在文件系统里」。
 */
const ALLOWED_SAMPLES: readonly string[] = [
  'input.n === 2',
  'validateDSL(input.dsl).ok === true',
  "fs.existsSync('a')",
  "fs.readFileSync('a', 'utf8').length >= 0",
  // ★ 词边界：`updatedAt` 里的 `Date` 不是 `Date` 这个词 ⇒ 不许误伤普通变量名
  'const updatedAt = input.at + 1; updatedAt > 0',
];

/**
 * ★★★ T-19（2026-11-06）：**逃逸面**那一组 —— 每一条都必须被拒。
 *
 * 与上面 ① 那一组的区别（不是重复，是**另一类病**）：
 * ① 组治的是「结论随机器变」（绿着撒谎）；本组治的是「**求值域边界被绕过**」——
 * `facts.constructor` 就是 `Function` ⇒ `facts.constructor.constructor('return process')()`。
 * ★ 3 条各点名一种**写法**（调用 / 字符串索引 / 解引用），避免"只拦住了点号写法"冒充"全都拦"。
 */
const ESCAPE_SAMPLES: readonly { expect: string; token: string }[] = [
  { expect: "input.a.constructor.constructor('return 1')()", token: '.constructor(' },
  { expect: "([])['constructor']('return 1')()", token: "['constructor']" },
  { expect: "globalThis['AGENT_IO_ACTOR'] === 'x'", token: 'globalThis' },
];

/**
 * ★★★ T-19：**不误伤**那一组 —— 一条都不许拒（0.12：误伤比漏防更坏）。
 *
 * 前半是**正常写法**（读一个对象的 `constructor.name` —— 词表若只认 `constructor` 这个词就废了）；
 * 后半是「**判据在读别人写的字**」：本仓真有一条这样的判据
 * （`file_src_application_design_dsl_ops_update_feature_ts#4` 用 `s.includes('fs.writeFileSync(designFile, rawBackup')`
 * 断回滚要写回原始字节）—— 词表法分不清"自己要写"与"读到别人写的字"，所以**不许按裸词拒**。
 */
const ESCAPE_ALLOWED: readonly string[] = [
  'input.obj.constructor.name === "Foo"',
  'Object.getPrototypeOf(input.x).constructor.name === "Bar"',
  "fs.readFileSync('src/a.ts', 'utf8').includes('fs.writeFileSync(designFile')",
  "fs.readFileSync('src/a.ts', 'utf8').includes('constructor.constructor')",
];

/** 把 domain 的两个文件拷进 tmp（`./text_strip.js` 是**相对** import ⇒ 必须同目录成对拷） */
function copyDomainToTmp(strip: RegExp | null): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-run-env-'));
  for (const f of ['expectation_kinds.ts', 'text_strip.ts']) {
    fs.copyFileSync(path.join(DOMAIN_DIR, f), path.join(tmp, f));
  }
  if (strip) {
    const target = path.join(tmp, 'expectation_kinds.ts');
    const src = fs.readFileSync(target, 'utf8');
    const out = src.replace(strip, '');
    // ★ 消融必须**真的**改到东西：锚点没命中就静默放行 = 消融没做（0.4：replace 是静默 no-op）
    assert.notEqual(out, src, `消融锚点没命中（/${strip.source}/）⇒ 消融无效`);
    fs.writeFileSync(target, out, 'utf8');
  }
  return tmp;
}

// ════════════════════════════════════════════════════════════════════
// ① 正向：五个词各一条 ⇒ 每条都被拒，且文案**点名那个词**
// ════════════════════════════════════════════════════════════════════
test('① 正向拒：Date / Math.random / performance / readdir / process 各一条 ⇒ 每条都被拒且文案点名该词', () => {
  assert.equal(BANNED_SAMPLES.length, 5, '①a 样本必须是五个词各一条（少一条 = 少一个词没验）');
  for (const { expect, token } of BANNED_SAMPLES) {
    const msg = writeRun(expect);
    assert.ok(msg, `①b \`${expect}\` **必须**被拒（换台机器 / 换个时刻结论就变）—— 实际放行了`);
    assert.ok(String(msg).includes(token), `①c 拒绝文案必须点名命中的词「${token}」：实际是 ${msg}`);
    assert.match(
      String(msg),
      /expectations\[0\]\.expect/,
      '①d 文案必须说清**是哪条判据的哪一格**（0.12 第 4 条：拒绝必须可定位）',
    );
    assert.match(String(msg), /input/, '①e 文案必须给出路（把输入钉成常量、用 input 读）—— 只说"不许"等于把人堵死');
  }
});

test('①b 词表本身：`ENV_STATE_TOKENS` 与 0.12 第 2 条逐字对齐（漏一个 = 那个词没人拦）', () => {
  const tokens = ENV_STATE_TOKENS.map((t) => t.token);
  assert.deepEqual(
    [...tokens],
    ['Date', 'Math.random', 'performance', 'readdir', 'process', 'require(', 'import('],
    `①b 词表必须与 AGENTS 0.12 第 2 条逐字对齐：实际 ${tokens.join(' / ')}`,
  );
  // ★ 后两个（运行期取模块）不在上面五个样本里 —— 在这里单独验，避免"词表有、判据没覆盖"
  const moduleLoads: readonly { expect: string; token: string }[] = [
    { expect: "require('node:fs')", token: 'require(' },
    { expect: "import('./x.js')", token: 'import(' },
  ];
  for (const { expect, token } of moduleLoads) {
    const msg = writeRun(expect);
    assert.ok(msg, `①c \`${expect}\` 运行期取模块必须被拒`);
    assert.ok(String(msg).includes(token), `①d 文案必须点名「${token}」：实际 ${msg}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② 反向：目标内容 / 显式输入必须放行（不许过度拒绝）
// ════════════════════════════════════════════════════════════════════
test('② 反向放行：input.* / validateDSL / fs.existsSync / fs.readFileSync / 词边界 ⇒ 一条都不许拒', () => {
  for (const expect of ALLOWED_SAMPLES) {
    assert.equal(
      writeRun(expect),
      null,
      `② \`${expect}\` **必须放行**：它是「目标内容」或「显式输入」（0.12 第 2 条），拒它 = 把判据逼成没法写`,
    );
  }
});

test('②b 只拒 `run` 的 expect：同一个词出现在别的 kind / 散文里必须放行（不许顺手扩大判定面）', () => {
  const sourceHas = validateExpectation(
    { kind: 'source-has', path: 'src/a.ts', must: ['Date.now()'], why: '夹具：断的是目标文件里的字' },
    'expectations[0]',
  );
  assert.equal(sourceHas, null, '②b `source-has` 的 must 里出现同一个词必须放行（它断的是目标文件里的字）');
  const proseWhy = validateExpectation(
    { kind: 'run', expect: 'input.n === 2', why: '原断言（扫 process.env 的赋值行）已作废：环境态不是判据' },
    'expectations[0]',
  );
  assert.equal(proseWhy, null, '②c `why` 是散文，必须能写"这条环境态断言已作废"这类病史 —— 只扫 expect 那一格');
});

// ════════════════════════════════════════════════════════════════════
// ③ 消融：把「声明」摘掉 ⇒ ① 那一组必须整组放行（证明是这条闸在拦）
// ════════════════════════════════════════════════════════════════════
test('③ 消融：摘掉 `forbidsEnvState` 声明 ⇒ 同一批输入全部放行（① 整组变红）', async () => {
  // 先确认这批输入在**真模块**上确实被拒 —— 否则下面"全部放行"什么也没证明
  const real = BANNED_SAMPLES.map(({ expect }) => (writeRun(expect) === null ? 'pass' : 'reject'));
  assert.deepEqual(
    real,
    BANNED_SAMPLES.map(() => 'reject'),
    '③a 真模块上这五条必须全被拒（消融的另一半证据）',
  );

  const tmp = copyDomainToTmp(/forbidsEnvState: true,/);
  try {
    const ablated = await import(pathToFileURL(path.join(tmp, 'expectation_kinds.ts')).href);
    for (const { expect } of BANNED_SAMPLES) {
      assert.equal(
        ablated.validateExpectation({ kind: 'run', expect, why: '消融夹具' }, 'expectations[0]'),
        null,
        `③b 摘掉声明后 \`${expect}\` 必须放行 —— 若它仍被拒，说明拒绝来自别处，这条闸不是它拦的`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ 读取路径**不校验** ⇒ 存量含该词的判据读到不崩（这就是不需要宽限名单的理由）
// ════════════════════════════════════════════════════════════════════
test('④ 存量不崩：册里已有含该词的 run 判据 ⇒ 读到原样保留、不抛（写入才拒，读取不校验）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-run-env-read-'));
  try {
    const file = getDesignSheetFile('legacy', dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacyExpect = "fs.readdirSync('src').length >= 0";
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          id: 'legacy',
          feature: 'legacy',
          type: 'feature_diagram',
          geometry: {
            nodes: [
              {
                id: 'n1',
                label: 'n1',
                x: 0,
                y: 0,
                width: 100,
                height: 60,
                type: 'file',
                path: 'src/a.ts',
                decision: {
                  summary: '夹具：一本**存量**册子，里面躺着一条含 readdirSync 的 run 判据',
                  expectations: [
                    { kind: 'run', why: '存量：顺序无关的目录枚举（祖父条款样本）', expect: legacyExpect },
                  ],
                },
              },
            ],
          },
          semantic: { files: [{ id: 'n1', path: 'src/a.ts', responsibility: '夹具' }] },
        },
        null,
        2,
      ),
      'utf8',
    );
    const got = getDesignSheet('legacy', dir);
    assert.ok(got, '④a 读册不许抛、也不许当成"册坏了"（写入才拒 ⇒ 读取路径不该有这条闸）');
    assert.equal(
      got.geometry.nodes[0].decision.expectations?.[0]?.expect,
      legacyExpect,
      '④b 存量判据必须**原样**读回来（读端不许顺手改写 / 丢弃）',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ T-19 逃逸面：4 条窄形态必拒 / 正常写法与"读别人写的字"必放行 / 消融
// ════════════════════════════════════════════════════════════════════
test('⑤ 逃逸面（双向）：.constructor( / [\'constructor\'] / globalThis ⇒ 拒；x.constructor.name 与源码字面量 ⇒ 放行；摘声明 ⇒ 全放行', async () => {
  for (const { expect, token } of ESCAPE_SAMPLES) {
    const msg = writeRun(expect);
    assert.ok(msg, `⑤a \`${expect}\` **必须**被拒（它能把注入的求值域变回任意代码）—— 实际放行了`);
    assert.ok(String(msg).includes(token), `⑤b 拒绝文案必须点名命中的形态「${token}」：实际是 ${msg}`);
    assert.match(
      String(msg),
      /expectations\[0\]\.expect/,
      '⑤c 文案必须说清**是哪条判据的哪一格**（0.12 第 4 条：拒绝必须可定位）',
    );
  }
  for (const expect of ESCAPE_ALLOWED) {
    assert.equal(
      writeRun(expect),
      null,
      `⑤d \`${expect}\` **必须放行**：要么是正常写法（读 constructor.name），要么断的是**目标文件里的字**` +
        `（本仓真有这种判据 ⇒ 按裸词拒就是误伤；0.12：误伤比漏防更坏）`,
    );
  }
  // ★ 消融：摘掉 `forbidsEnvState` 声明 ⇒ 同一批输入必须全部放行（证明拦它们的**就是这道闸**）
  const tmp = copyDomainToTmp(/forbidsEnvState: true,/);
  try {
    const ablated = await import(pathToFileURL(path.join(tmp, 'expectation_kinds.ts')).href);
    for (const { expect } of ESCAPE_SAMPLES) {
      assert.equal(
        ablated.validateExpectation({ kind: 'run', expect, why: '消融夹具' }, 'expectations[0]'),
        null,
        `⑤e 摘掉声明后 \`${expect}\` 必须放行 —— 若仍被拒，说明拒绝来自别处，这条闸不是它拦的`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ T-19 facts 门面：面锁死 · 只读（结构上无写原语）· 「查成了没有」与「没查成」可区分
// ════════════════════════════════════════════════════════════════════
test('⑥ facts 门面：面恰两方法 · 口径=isApiSymbol · ok:false（判不了）≠ 空数组 · 只读 fs 上无写原语', async () => {
  const { createJudgeFacts, READ_ONLY_FS } = await import('../src/application/design/intent/judge_facts.js');
  const { DatabaseSync } = await import('node:sqlite');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-judge-facts-'));
  try {
    fs.writeFileSync(path.join(root, 'x.ts'), 'export function keep() {}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'empty.ts'), 'const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'notindexed.ts'), 'export function y() {}\n', 'utf8');
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE files (path TEXT PRIMARY KEY, content_hash TEXT);' +
        'CREATE TABLE nodes (file_path TEXT, name TEXT, kind TEXT, signature TEXT, modifiers TEXT, language TEXT, is_closure INTEGER, start_line INTEGER);',
    );
    const insFile = db.prepare('INSERT INTO files VALUES (?, ?)');
    insFile.run('x.ts', 'h');
    insFile.run('empty.ts', 'h');
    const insNode = db.prepare('INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insNode.run('x.ts', 'keep', 'function', 'keep()', JSON.stringify(['export']), 'ts', 0, 1);
    // ★ 下面三条都必须被口径排除（数据常量 / 非导出 / 闭包）—— 口径 = isApiSymbol，与派生写端同一把尺
    insNode.run('x.ts', 'DATA', 'const', 'const DATA = { a: 1 }', JSON.stringify(['export']), 'ts', 0, 2);
    insNode.run('x.ts', 'hidden', 'function', 'hidden()', JSON.stringify([]), 'ts', 0, 3);
    insNode.run('x.ts', 'inner', 'function', 'inner()', JSON.stringify(['export']), 'ts', 1, 4);

    const facts = createJudgeFacts(root, { db, staleOf: () => null });
    // ① 面被锁死：**恰**两个方法。以后谁加第三个 ⇒ 这条红（新口子必须有人看着）
    assert.deepEqual(Object.keys(facts), ['exportedApisOf', 'stalenessOf'], '⑥a 门面的面必须恰为两个方法');

    // ② 口径
    const x = facts.exportedApisOf('x.ts');
    assert.equal(x.ok, true, '⑥b 索引里有的文件必须 ok:true');
    assert.deepEqual(
      (x as { symbols: { name: string }[] }).symbols.map((s) => s.name),
      ['keep'],
      '⑥c 口径：数据常量 / 非导出 / 闭包都不算导出 API（与 isApiSymbol 同一把尺）',
    );

    // ③ 「查成了、确实没有导出」≠「没查成」（0.12：判不了 ≠ 通过）
    const e = facts.exportedApisOf('empty.ts');
    assert.equal(e.ok, true, '⑥d 索引里有的空文件 ⇒ ok:true + 空数组');
    assert.deepEqual((e as { symbols: unknown[] }).symbols, []);
    assert.equal(facts.exportedApisOf('nope.ts').ok, false, '⑥e 盘上没有 ⇒ 判不了，不许冒充"没有导出"');
    assert.equal(facts.exportedApisOf('notindexed.ts').ok, false, '⑥f 索引里没有 ⇒ 判不了（不是"没有导出"）');
    const staleFacts = createJudgeFacts(root, { db, staleOf: () => '索引与源码不一致：夹具' });
    assert.equal(staleFacts.exportedApisOf('x.ts').ok, false, '⑥g 索引陈旧 ⇒ 判不了（不许拿旧事实说绿）');

    // ④ stalenessOf 带分类（判据据此把结论写成"判不了"）
    assert.deepEqual(facts.stalenessOf(['x.ts', 'nope.ts']), { stale: [], unknown: ['nope.ts'] });

    // ⑤ 注入的 fs 是只读白名单：写能力**结构上不存在**（不是靠词表劝住 —— 词表分不清"自己要写"与"读到别人写的字"）
    assert.equal(typeof READ_ONLY_FS.readFileSync, 'function', '⑥h 读原语必须在');
    assert.equal(typeof READ_ONLY_FS.existsSync, 'function', '⑥i existsSync 必须在');
    for (const w of [
      'writeFileSync',
      'appendFileSync',
      'unlinkSync',
      'rmSync',
      'mkdirSync',
      'renameSync',
      'copyFileSync',
    ]) {
      assert.equal(w in READ_ONLY_FS, false, `⑥j 只读 fs 上不许有写原语 ${w}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


