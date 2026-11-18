/**
 * P1 · **判据执行点禁代码生成**（maker-checker 结构首卡，2026-11-18）
 *
 * ## 病（审计 T4 的一行旁路，实测）
 * `decision.expectations[]` 里 `kind === 'run'` 的 `expect` 是**任意 JS**，执行核曾是**宿主 realm** 的
 * `new Function('input','root','validateDSL','fs','path','facts', …)`，防御全靠两张词表
 * （`ENV_STATE_TOKENS` 7 条 · `ESCAPE_TOKENS` 4 条）。下面这一行把两张表**一起**绕过，
 * 并且在真实判定链上**真的跑出** `process`（实测读到 `v22.18.0`）：
 *
 * ```js
 * (()=>{const F=(function(){}).constructor;const g=F("return this")();
 *   return typeof g["pro"+"cess"]!=="undefined"})()
 * ```
 *
 * · `.constructor` 后面**不跟 `(`** ⇒ 不命中 `.constructor(`、也不命中 `.constructor.constructor`；
 * · `"pro"+"cess"` 是两段字符串相加 ⇒ 不命中 `\bprocess\b`。
 * ⇒ **逃逸成功 = `READ_ONLY_FS` 那道结构防御整个白做**：只读白名单保证的是"注入的 `fs` 上
 *   没有写函数"，而它拿到的是 **`process`**（写盘、起进程、读环境变量全都回来了）。
 *
 * ## 裁定：换结构，不加词
 * 执行核换成 `vm.runInNewContext` + `contextCodeGeneration: { strings: false, wasm: false }`
 * （本仓 `infrastructure/parse/kernel.ts` 求值常量表达式时**已在用**这条路 —— 先例在仓内，不是新发明）。
 * 词表**保留**为纵深第一层（它的价值是"报错更友好 + 拦常见拼法"），结构层才是牙。
 *
 * ## 本证锁七件事（每条都能证红 —— 见各 case 的「改前」注释）
 * 1. **逃逸必须判不了**（`unsupported`，**不是** `fail`；报文要点名"禁止生成代码"）；
 * 2. **代码生成的四条常见写法全拒**（`new Function` / `eval` / `Function(...)` / `x.constructor(...)`）；
 * 3. **存量正常判据照常过**（七形态：读盘 / 输入 / path / 模板 / 箭头 / JSON / `validateDSL`）；
 * 4. **这个旁路是真逃逸**（同一进程里用 `new Function` 跑它**能读到 `process.pid`**）——
 *    ★ 这是 ① 的**非空转证明**：把执行核改回 `new Function` ⇒ ① 立刻红（消融）；
 *    ④ 保证"红得有理"，否则 ① 的 `unsupported` 可能只是"表达式本来就算不出来"；
 * 5. **求值域只有 6 个名字**（`process` / `require` / `module` 不可达）；
 * 6. **一 realm 一条判据**（前一条判据往 `globalThis` 里装的东西，下一条看不见）；
 * 7. **死循环被超时挡住**（旧实现里一条 `while(true)` ⇒ `judge-all` 整个挂住）；
 *    外加 **`this` / `arguments` 语义与 `new Function` 逐字相同**（换成脚本后包了一层函数体）。
 *
 * ## 边界（不冒充"根治了全部逃逸面" —— 0.17①）
 * `vm` 官方明说它**不是安全沙箱**：判据若拿到**宿主 realm 的对象**（注入的 `input`、`fs` 上的宿主函数、
 * `facts.*` 的返回值、`fs` 抛出的 `Error`），它的 `.constructor` 就是**宿主**的 `Function`，
 * **那一层不受 `contextCodeGeneration` 约束**。⇒ 该档仍由第一层词表兜着；要让成结构得换
 * worker/进程边界（`--disallow-code-generation-from-strings`），**另卡**。
 * 本证只锁「判据 realm 内禁代码生成」这一层 —— 说得出边界，才不是假绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  evalRunExpect,
  isCodeGenerationRefused,
  judgeExpectations,
  type RunEvalScope,
} from '../src/application/design/intent/expectations.js';
import { READ_ONLY_FS } from '../src/application/design/intent/judge_facts.js';
import { validateDSL } from '../src/domain/validator.js';
import type { JudgeItem } from '../src/domain/judge_port.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** ★ T4 的一行旁路（`.constructor` 不跟 `(` + `"pro"+"cess"` 拆串） */
const BYPASS = '(()=>{const F=(function(){}).constructor;const g=F("return this")();return typeof g["pro"+"cess"]!=="undefined"})()';
/** 同上，但把 `process.pid` 当断言结果带出来（证明"读到的是本进程"） */
const BYPASS_PID = '(()=>{const F=(function(){}).constructor;const g=F("return this")();return g["pro"+"cess"].pid > 0})()';

/** V8 在 `contextCodeGeneration.strings = false` 下给的固定报文（判据 realm 的 `EvalError`） */
const REFUSED = /code generation from strings disallowed for this context/i;

/** 直接求值用的求值域（与 `case 'run'` 注入的**同一组值**，只是 `facts` 用桩） */
function makeScope(root: string): RunEvalScope {
  return {
    input: { n: 1, tag: 'a' },
    root,
    validateDSL,
    fs: READ_ONLY_FS,
    path,
    facts: {
      exportedApisOf: () => ({ ok: false, why: '桩：本证不碰索引' }),
      stalenessOf: () => ({ stale: [], unknown: [] }),
    },
  };
}

/** 走**真实判定链**（`judgeExpectations` 的 `case 'run'`）判一条判据 */
async function judgeOne(root: string, expect: string, input: unknown = { n: 1, tag: 'a' }) {
  const items: JudgeItem[] = [
    { node_id: 'p1_sandbox', node_label: '判据执行沙箱', expectation: { kind: 'run', expect, why: `证：${expect.slice(0, 40)}`, input } },
  ];
  const rep = await judgeExpectations(root, items);
  assert.equal(rep.items.length, 1, '必须恰好判到一条');
  return rep.items[0];
}

/** 造一个临时项目根（判据要读盘时用） */
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-criteriasandbox-'));
  fs.writeFileSync(path.join(root, 'target.ts'), 'export const MARK = "TOKEN_A";\n', 'utf-8');
  return root;
}

test('P1-sandbox ① · T4 旁路在执行点必须判不了（unsupported，不是 fail；改前：pass = 逃逸成功）', async () => {
  const home = makeTempHome();
  const root = makeRoot();
  process.env.AGENT_IO_HOME = home;
  try {
    const it = await judgeOne(root, BYPASS);
    assert.equal(
      it.verdict,
      'unsupported',
      `旁路必须判不了（改前实测 = pass = 真的跑出了 process）；实得 ${it.verdict}`,
    );
    // 报文要点名**这一档**（不是"表达式写坏了"）：读端一眼分得出"想执行任意代码"
    assert.match(it.detail, /禁止生成代码/);
    assert.match(it.detail, /code generation from strings disallowed/i);

    const itPid = await judgeOne(root, BYPASS_PID);
    assert.equal(itPid.verdict, 'unsupported', '读 process.pid 的那一版同样必须判不了');
  } finally {
    rmRf(root);
    rmRf(home);
  }
});

test('P1-sandbox ② · 代码生成的四条常见写法全拒（结构层，不经词表）', () => {
  const scope = makeScope(makeRoot());
  const spines: readonly { label: string; expr: string }[] = [
    { label: 'new Function', expr: 'new Function("return 1")' },
    { label: 'eval', expr: 'eval("1 + 1")' },
    { label: 'Function(...)', expr: 'Function("return 1")' },
    { label: 'realm 内的 x.constructor(...)', expr: '(function(){}).constructor("return 1")' },
    { label: 'realm 内的两级链', expr: '[].constructor.constructor("return 1")' },
  ];
  for (const s of spines) {
    assert.throws(() => evalRunExpect(s.expr, scope), REFUSED, `\`${s.label}\` 必须被结构层拒（判据拿不到 process 的前提）`);
  }
  // ★ 反向：这三条**不是**代码生成，必须照跑（否则就是把"禁 eval"做成"禁一切"）
  assert.equal(evalRunExpect("typeof ({}) === 'object'", scope), true);
  assert.equal(evalRunExpect("(()=>{const o={a:1};return o.a === 1;})()", scope), true);
  assert.equal(evalRunExpect("'constructor' === 'constructor'", scope), true);
});

test('P1-sandbox ③ · 存量正常判据照常过（七形态，改前改后必须逐条相同）', async () => {
  const home = makeTempHome();
  const root = makeRoot();
  process.env.AGENT_IO_HOME = home;
  try {
    const cases: readonly string[] = [
      "fs.existsSync(path.join(root,'target.ts'))",
      "fs.readFileSync(path.join(root,'target.ts'),'utf8').includes('TOKEN_A')",
      "input.n === 1 && input.tag === 'a'",
      "path.basename(path.join(root,'target.ts')) === 'target.ts'",
      '`${JSON.stringify({k: 1})}` === \'{"k":1}\'',
      "['a.ts','b.ts'].filter((f) => f.endsWith('.ts')).length === 2",
      "validateDSL({ id: 'x' }).valid === false",
    ];
    for (const expect of cases) {
      const it = await judgeOne(root, expect);
      assert.equal(it.verdict, 'pass', `存量形态必须照常过：\`${expect}\` ⇒ ${it.verdict}（${it.detail}）`);
    }
    // ★ 假那一半也必须还是 fail（不许把"表达式算出来是 false"也变成 unsupported）
    const itFalse = await judgeOne(root, "fs.existsSync(path.join(root,'不存在的文件.ts'))");
    assert.equal(itFalse.verdict, 'fail', '算出来是 false ⇒ 仍必须是 fail（不是 unsupported）');
  } finally {
    rmRf(root);
    rmRf(home);
  }
});

test('P1-sandbox ④ · 这个旁路是**真逃逸**（同进程 new Function 跑得出 process.pid）—— ① 的非空转证明', () => {
  // 用**改前的那份执行核**跑同一段文本：能跑出 true ⇒ ① 的 unsupported 不是"文本本来就算不出来"
  // eslint-disable-next-line no-new-func
  const oldKernel = new Function(
    'input',
    'root',
    'validateDSL',
    'fs',
    'path',
    'facts',
    `"use strict"; return (${BYPASS_PID});`,
  );
  const escaped = oldKernel({ n: 1, tag: 'a' }, '.', validateDSL, READ_ONLY_FS, path, null);
  assert.equal(escaped, true, '改前的执行核必须能跑出 process.pid（否则 ① 证明不了"结构层挡住了什么"）');
  // 同一段文本交给新执行核 ⇒ 拒
  assert.throws(() => evalRunExpect(BYPASS_PID, makeScope('.')), REFUSED);
});

test('P1-sandbox ⑤ · 求值域恰 6 个名字：process / require / module / globalThis.process 不可达', () => {
  const scope = makeScope('.');
  assert.equal(
    evalRunExpect(
      "typeof process === 'undefined' && typeof require === 'undefined' && typeof module === 'undefined' && typeof globalThis.process === 'undefined'",
      scope,
    ),
    true,
    '沙箱里不许有宿主的能力面（require / process / module）',
  );
  // ★ 六个名字一个都不能少（少一个 ⇒ 存量判据 ReferenceError ⇒ 假红）
  assert.equal(
    evalRunExpect(
      "typeof input === 'object' && typeof root === 'string' && typeof validateDSL === 'function' && typeof fs === 'object' && typeof path === 'object' && typeof facts === 'object'",
      scope,
    ),
    true,
    '求值域必须恰是 input/root/validateDSL/fs/path/facts',
  );
  // ★ 注入的 fs 仍是只读白名单（T-19 的结构防御不许被这次改动削弱）
  assert.equal(evalRunExpect("typeof fs.writeFileSync === 'undefined' && typeof fs.readdirSync === 'undefined'", scope), true);
});

test('P1-sandbox ⑥ · 一 realm 一条判据（前一条给 globalThis 装的东西，下一条看不见）', () => {
  const scope = makeScope('.');
  assert.equal(evalRunExpect('(globalThis.__leak = 1, true)', scope), true, '写全局本身不该抛');
  assert.equal(evalRunExpect('typeof globalThis.__leak', scope), 'undefined', '下一条判据不许看见上一条的全局污染');
});

test('P1-sandbox ⑦ · 死循环被超时挡住；this/arguments 语义与 new Function 逐字相同', () => {
  // ★ 改前：一条 `while(true)` ⇒ 判定线程整个挂住（judge-all 会卡死）
  assert.throws(() => evalRunExpect('(()=>{while(true){}})()', makeScope('.')), /timed out|execution/i);
  const scope = makeScope('.');
  // ★ 换成"脚本 + 包一层函数体"之后，严格模式语义必须与 `new Function` 的调用形态一致
  assert.equal(evalRunExpect('this === undefined', scope), true, '严格模式下 this 仍是 undefined');
  assert.equal(evalRunExpect('arguments.length === 0', scope), true, 'arguments 仍是空表');
});

test('P1-sandbox ⑧ · 报文不误伤：普通抛错仍走"判不了"通用档，不许冒充"想逃逸"', async () => {
  const home = makeTempHome();
  const root = makeRoot();
  process.env.AGENT_IO_HOME = home;
  try {
    // ① 普通抛错（读一个不存在的文件）⇒ 通用报文，**不许**被归到"禁止生成代码"那一档
    const it = await judgeOne(root, "fs.readFileSync(path.join(root,'nope.txt'),'utf8')");
    assert.equal(it.verdict, 'unsupported');
    assert.doesNotMatch(it.detail, /禁止生成代码/, '普通 ENOENT 不许冒充"判据想逃逸"（误伤比漏防更坏）');
    // ② 分类器的双向：只有 `EvalError + 那条固定报文` 才算"被结构层拒"
    assert.equal(isCodeGenerationRefused(new Error('boom')), false, '普通 Error 不算');
    assert.equal(
      isCodeGenerationRefused(Object.assign(new Error('Code generation from strings disallowed'), { name: 'EvalError' })),
      true,
      '判据 realm 的 EvalError（跨 realm ⇒ 不是宿主 Error）必须认出来',
    );
    // ★ 判据自己 `throw new Error('Code generation…')` 不算被结构层拒？—— 认名字 + 报文，
    //   而"判据自己抛的那条"本来也只会落到通用档（下面这行钉住"不会误伤成逃逸"）
    assert.equal(isCodeGenerationRefused(Object.assign(new Error('别的问题'), { name: 'EvalError' })), false);
  } finally {
    rmRf(root);
    rmRf(home);
  }
});
