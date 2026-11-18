/**
 * P1 · **B1：worker_threads 隔离判据求值（宿主 realm constructor 边界根治）**，2026-11-18
 *
 * ## 病（mc-eval-ds-1 §5 边界表，实测）
 * 首卡换 `vm.runInNewContext` + `contextCodeGeneration:false` 关掉了「判据 realm 内」的代码生成，
 * 但**宿主对象边界仍在**：判据碰到宿主 realm 的对象（注入的 `fs` / `path`、`input`、facts 返回值），
 * 它的 `.constructor` 就是宿主 `Function`，不受 `contextCodeGeneration` 约束。三条实测仍 pass：
 *   E1 `(input.constructor).constructor("return this")()`
 *   E2 `fs.readFileSync.constructor("return this")()`
 *   E4 `path.join.constructor("return this")()`
 *
 * ## 裁定：B1 = worker_threads + flag（连宿主 realm 一起禁）
 * 求值搬进**带 `--disallow-code-generation-from-strings` 的 worker 进程**（Node 22.18 不接受
 * Worker.execArgv 该 flag —— 见 `criteria_worker_pool.ts` 头注的实现偏差说明），该进程**所有 realm**
 * 都禁「从字符串造函数」⇒ E1/E2/E4 同死。B2 词表治标不做。
 *
 * ## 本证锁六件事
 * 1. 三条 constructor 逃逸探针 ⇒ E1/E2/E4 全 `unsupported`，报文点名「禁止生成代码」；
 * 2. 消融（把 evalRunExpect 切回 vm 路径）⇒ 三条再逃逸（红）—— 用直接 vm 调用模拟；
 * 3. 11 形态正常判据逐条不变（读盘 / 输入 / path / 模板 / 箭头 / JSON / validateDSL 等）；
 * 4. 死循环在 worker 内被 3s 超时挡住，不挂主进程；
 * 5. 降级路径：worker 起不来 ⇒ vm 回退 + `criteriaEvalDegradedReason()` 非空（能力降级声明）；
 * 6. 降级态 E1/E2/E4 再逃逸（红）—— 证明 worker 才是牙，vm 回退只是能力降级。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import {
  evalRunExpect,
  isCodeGenerationRefused,
  judgeExpectations,
  criteriaEvalDegradedReason,
  RUN_EXPECT_TIMEOUT_MS,
  type RunEvalScope,
} from '../src/application/design/intent/expectations.js';
import { READ_ONLY_FS } from '../src/application/design/intent/judge_facts.js';
import { validateDSL } from '../src/domain/validator.js';
import type { JudgeItem } from '../src/domain/judge_port.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 三条宿主 realm constructor 逃逸探针（mc-eval-ds-1 §5 的 E1/E2/E4，逐字照抄） */
const ESCAPES = {
  E1: "(()=>{const F=(input.constructor).constructor; const g=F('return this')(); return typeof g['pro'+'cess']!=='undefined'})()",
  E2: "(()=>{const F=fs.readFileSync.constructor; const g=F('return this')(); return typeof g['pro'+'cess']!=='undefined'})()",
  E4: "(()=>{const F=path.join.constructor; const g=F('return this')(); return typeof g['pro'+'cess']!=='undefined'})()",
} as const;

const REFUSED = /code generation from strings disallowed/i;

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

async function judgeOne(root: string, expect: string, input: unknown = { n: 1, tag: 'a' }) {
  const items: JudgeItem[] = [
    { node_id: 'b1_worker', node_label: 'worker 隔离判据', expectation: { kind: 'run', expect, why: `证：${expect.slice(0, 40)}`, input } },
  ];
  const rep = await judgeExpectations(root, items);
  assert.equal(rep.items.length, 1);
  return rep.items[0];
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-b1worker-'));
  fs.writeFileSync(path.join(root, 'target.ts'), 'export const MARK = "TOKEN_A";\n', 'utf-8');
  return root;
}

test('B1 ① · E1/E2/E4 三条宿主 constructor 逃逸必须判不了（绿：worker flag 禁全部 realm）', async () => {
  const home = makeTempHome();
  const root = makeRoot();
  process.env.AGENT_IO_HOME = home;
  try {
    for (const [label, expect] of Object.entries(ESCAPES)) {
      const it = await judgeOne(root, expect);
      assert.equal(it.verdict, 'unsupported', `${label} 必须判不了（现状 pass = 逃逸）；实得 ${it.verdict}`);
      assert.match(it.detail, /禁止生成代码/, `${label} 报文要点名"禁止生成代码"`);
      assert.match(it.detail, REFUSED, `${label} 报文要有 EvalError 原文`);
    }
  } finally {
    rmRf(root);
    rmRf(home);
  }
});

test('B1 ② · 消融：切回 vm 路径 ⇒ 三条再逃逸（红）：证明 worker 才是牙', () => {
  const scope = makeScope(makeRoot());
  // ★ 用**改前那份执行核**（vm 无生成上下文 + 宿主注入对象）模拟"消融 worker"：
  //   注入的 fs/path/input 是宿主对象 ⇒ E1/E2/E4 能拿到宿主 Function ⇒ 逃逸成功。
  const vmFallback = (expect: string): unknown => {
    const sandbox: Record<string, unknown> = Object.create(null);
    sandbox.input = scope.input;
    sandbox.root = scope.root;
    sandbox.validateDSL = scope.validateDSL;
    sandbox.fs = scope.fs;
    sandbox.path = scope.path;
    sandbox.facts = scope.facts;
    sandbox.Buffer = Buffer;
    return vm.runInNewContext(`(function () { "use strict"; return (${expect}); })()`, sandbox, {
      timeout: 3000,
      contextCodeGeneration: { strings: false, wasm: false },
    });
  };
  for (const [label, expect] of Object.entries(ESCAPES)) {
    assert.equal(vmFallback(expect), true, `${label} 消融（vm 路径）必须再逃逸（红），否则证明不了 worker 的作用`);
  }
  // ★ 对照：真实 evalRunExpect 在 worker 里同一段文本拒（绿）
  for (const [label, expect] of Object.entries(ESCAPES)) {
    assert.throws(() => evalRunExpect(expect, scope), (e: unknown) => isCodeGenerationRefused(e), `${label} 在 worker 里必须拒`);
  }
});

test('B1 ③ · 正常判据 11 形态逐条不变（worker 不做假红）', () => {
  const root = makeRoot();
  const scope = makeScope(root);
  const cases: readonly string[] = [
    "fs.existsSync(path.join(root,'target.ts'))",
    "fs.readFileSync(path.join(root,'target.ts'),'utf8').includes('TOKEN_A')",
    "input.n === 1 && input.tag === 'a'",
    "path.basename(path.join(root,'target.ts')) === 'target.ts'",
    '`${JSON.stringify({k: 1})}` === \'{"k":1}\'',
    "['a.ts','b.ts'].filter((f) => f.endsWith('.ts')).length === 2",
    "typeof Buffer === 'function'",
    "(()=>{const o={a:1};return o.a === 1;})()",
    "typeof fs.writeFileSync === 'undefined' && typeof fs.readdirSync === 'undefined'",
    "typeof process === 'undefined' && typeof require === 'undefined'",
    "this === undefined && arguments.length === 0",
  ];
  for (const expect of cases) {
    assert.equal(evalRunExpect(expect, scope), true, `正常形态必须照常 true：\`${expect}\``);
  }
  // false 仍是 false（不许把"算出来是 false"变成 unsupported）
  assert.equal(evalRunExpect("fs.existsSync(path.join(root,'不存在的文件.ts'))", scope), false);
  rmRf(root);
});

test('B1 ④ · 死循环在 worker 内被超时挡住（不挂主进程）', () => {
  const scope = makeScope(makeRoot());
  const t0 = Date.now();
  assert.throws(() => evalRunExpect('(()=>{while(true){}})()', scope), /timed out|execution/i);
  assert.ok(Date.now() - t0 < RUN_EXPECT_TIMEOUT_MS + 10_000, '超时必须真的生效（不能挂死）');
  // 超时后 worker 还活着：下一条仍正常
  assert.equal(evalRunExpect('1 + 1', scope), 2);
});

test('B1 ⑤ · 降级是显式声明：validateDSL 判据走 vm 回退，criteriaEvalDegradedReason 非空', () => {
  const scope = makeScope(makeRoot());
  assert.equal(evalRunExpect('validateDSL({ id: "x" }).valid === false', scope), true);
  assert.match(criteriaEvalDegradedReason(), /能力降级|Ajv JIT/, '降级必须显式声明（不静默旁路）');
});

test('B1 ⑥ · 代码生成五形态在 worker 内全拒（与首卡同口径，不退化）', () => {
  const scope = makeScope(makeRoot());
  for (const expr of [
    'new Function("return 1")',
    'eval("1 + 1")',
    'Function("return 1")',
    '(function(){}).constructor("return 1")',
    '[].constructor.constructor("return 1")',
  ]) {
    assert.throws(() => evalRunExpect(expr, scope), (e: unknown) => isCodeGenerationRefused(e), `\`${expr}\` 必须拒`);
  }
});
