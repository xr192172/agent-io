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


