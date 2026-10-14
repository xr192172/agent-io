#!/usr/bin/env node
/**
 * cert T316 —— **observe 语言包出生证**（TS/JS 与 Python 两份；Go 待 T311）。
 *
 * ## 为什么要有它（本仓的"语言包"到底该被什么判住）
 * 骨架（`instrument_skeleton.ts`）把**语言无关**的部分收成一份之后，"加一门语言"只剩
 *   **语言包**（① 命名 / ② 遍历 / ⑥ 取值 + 语法管道）。⇒ 于是需要一个**与语言无关的判据**
 *   来回答："这个包，**插出来的代码真的能跑吗**？"
 * ★ 而这正是**原先没人问的问题** —— 2026-10-15 本证第一次跑就抓到 T314：
 *   插桩往 `.js/.mjs/.cjs/.jsx` 里注入 `(e as Error)`（TS 专属）⇒ **插完的代码根本不能解析**，
 *   而插桩回执 **`sites>0`、无 error、文件已写盘** ⇒ **静默产出一份跑不起来的代码**。
 *
 * ## 判据（四条，全部看**事实**，不看回执）
 *   ① **能跑**：插桩后宿主进程 **exit 0**（探针没打断宿主）；
 *   ② **不改行为**：插桩后 stdout 与插桩前**逐字相同**；
 *   ③ **真能观测**：接上 sink ⇒ events 文件**行数 > 0**（"探针就位"与"有数据"是两件事）；
 *   ④ **可还原**：`restoreInstrumented` 之后源文件**逐字节相同**。
 *   另加 T314 的**语法分叉**判据：JS 宿主注入文本**不含** `as`；TS 宿主**保留** `as Error`
 *   （TS 的 catch 变量是 `unknown` ⇒ 去掉 `as` 会让宿主 `tsc` 报错 —— 两边要求相反）。
 *
 * ## 用法
 *   node certs/t316-observe-pack-cert.mjs
 * ★ 夹具**必须与仓库同盘**：注入的 import 是 `path.relative` 算出来的，跨盘算不出相对说明符
 *   （T315 已改成响亮抛）。本证把夹具放在 `certs/.work/tmp/`，天然同盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const instr = require(path.join(REPO, 'dist/src/infrastructure/analysis/observe/instrument.js'));
const instrPy = require(path.join(REPO, 'dist/src/infrastructure/analysis/observe/instrument_py.js'));

const TMP_BASE = path.join(HERE, '.work/tmp');
fs.mkdirSync(TMP_BASE, { recursive: true });

let P = 0;
let F = 0;
const check = (name, ok, detail) => {
  if (ok) P++;
  else F++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

// ── TS/JS 夹具：覆盖 get/set 同名 · #private · 箭头表达式体 · switch 同行多 return ·
//    无括号 guard + else-if 链 · Unicode 标识符 · try/catch/finally · 嵌套函数 —— 都是历史坑位 ──
const TS_FILES = {
  'getset.mjs': `export class Box {\n  #v = 0;\n  get value() { return this.#v; }\n  set value(v) { this.#v = v; }\n}\n`,
  'arrow.mjs': `export const double = (x) => x * 2;\nexport const pick = (c) => c ? 'pos' : 'neg';\nexport function caller(x) { return double(x) + pick(x > 0); }\n`,
  'switchy.mjs': `export function grade(n) {\n  switch (n) {\n    case 1: return 'a';\n    case 2: return 'b';\n    default: return 'z';\n  }\n}\n`,
  'guard.mjs': `export function sign(n) {\n  if (n > 0) return 'pos';\n  else if (n < 0) return 'neg';\n  return 'zero';\n}\n`,
  'unicode.mjs': `export function 计算(数) { return 数 + 1; }\n`,
  'tryfin.mjs': `export function risky(x) {\n  try { if (x < 0) throw new Error('neg'); return 'ok'; }\n  catch (e) { return 'caught'; }\n  finally { /* noop */ }\n}\n`,
  'nested.mjs': `export function outer(a) {\n  function inner(b) { return b + 1; }\n  const lam = (c) => c + 2;\n  return inner(a) + lam(a);\n}\n`,
  'main.mjs': `import { Box } from './getset.mjs';\nimport { double, pick } from './arrow.mjs';\nimport { grade } from './switchy.mjs';\nimport { sign } from './guard.mjs';\nimport { 计算 } from './unicode.mjs';\nimport { risky } from './tryfin.mjs';\nimport { outer } from './nested.mjs';\n\nconst b = new Box(); b.value = 7;\nconsole.log(JSON.stringify([b.value, double(3), pick(true), grade(2), sign(-1), 计算(1), risky(5), outer(1)]));\n`,
};

// ── Python 夹具：覆盖 缩进 · 单行 suite · lambda · 多返回值 · 裸 return · 生成器 ──
const PY_FILES = {
  'basics.py': `def add(a, b):\n    return a + b\n\n\ndef multi(a, b):\n    return a + b, a - b\n\n\ndef bare(x):\n    if x:\n        return\n    print('no-return')\n\n\ndef single_line(x): return 'pos' if x > 0 else 'neg'\n\n\ndef gen(n):\n    for i in range(n):\n        yield i\n\n\nf = lambda x: x * 2\n`,
  'main.py': `from basics import add, multi, bare, single_line, gen, f\n\nprint(add(1, 2), multi(5, 1), bare(0), single_line(-3), list(gen(3)), f(4))\n`,
};

const mk = (dir, files) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c, 'utf8');
};
const snap = (dir, files) => Object.fromEntries(Object.keys(files).map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]));
const changed = (a, b) => Object.keys(a).filter((n) => a[n] !== b[n]);
const lines = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).length : 0);

console.log('=== T316 · observe 语言包出生证 ===');

// ══════════ 1) TS/JS 包 ══════════
{
  console.log('\n── [1/3] TS/JS 包（8 扩展名里的 JS 家族 + TS 家族）──');
  const work = fs.mkdtempSync(path.join(TMP_BASE, 'ts-'));
  mk(work, TS_FILES);
  const before = snap(work, TS_FILES);
  const run = (script) => spawnSync(process.execPath, [script], { cwd: work, encoding: 'utf8' });

  const base = run('main.mjs');
  check('① 基线可跑（先证明夹具本身是好的）', base.status === 0, `exit=${base.status} ${(base.stderr || '').split('\n')[0]}`);

  const res = await instr.instrumentProject(work, { projectRoot: REPO, write: true });
  const sites = res.reduce((n, r) => n + r.sites.length, 0);
  const fns = res.reduce((n, r) => n + (r.functions ?? 0), 0);
  const errs = res.filter((r) => r.error);
  check('插桩：有探针点且无文件报错', sites > 0 && errs.length === 0, `sites=${sites} functions=${fns} 文件=${res.length} 报错=${errs.length}`);

  const after = run('main.mjs');
  check('① 插桩后宿主仍跑得起来（探针不打断宿主）', after.status === 0, `exit=${after.status} ${(after.stderr || '').split('\n')[0]}`);
  check('② 插桩后 stdout 逐字不变', after.stdout === base.stdout, `base=${JSON.stringify(base.stdout.trim())} now=${JSON.stringify(after.stdout.trim())}`);

  // ③ 接 sink ⇒ 真出事件
  const ev = path.join(work, 'events.jsonl');
  const probeUrl = pathToFileURL(path.join(REPO, 'dist/src/infrastructure/analysis/observe/probe.js')).href;
  fs.writeFileSync(
    path.join(work, 'sinkmain.mjs'),
    `import { setGlobalProbeSink, TSProbeCapture } from ${JSON.stringify(probeUrl)};\n` +
      `setGlobalProbeSink(new TSProbeCapture(${JSON.stringify(ev.replaceAll('\\', '/'))}));\n` +
      `await import('./main.mjs');\n`,
    'utf8',
  );
  const sinkRun = run('sinkmain.mjs');
  check('③ 接 sink ⇒ events 行数 > 0（"探针就位"≠"有数据"）', sinkRun.status === 0 && lines(ev) > 0, `exit=${sinkRun.status} 行数=${lines(ev)}`);

  instr.restoreInstrumented(work);
  const bad = changed(before, snap(work, TS_FILES));
  check('④ 还原逐字节相同', bad.length === 0, bad.join(',') || '全部相同');
  fs.rmSync(work, { recursive: true, force: true });
}

// ══════════ 2) T314 语法分叉 ══════════
{
  console.log('\n── [2/3] T314：注入文本必须随【宿主语法】分叉 ──');
  const work = fs.mkdtempSync(path.join(TMP_BASE, 'syn-'));
  const body = `export function f(x) {\n  try { return x; } catch (e) { return 'c'; }\n}\n`;
  fs.writeFileSync(path.join(work, 'a.mjs'), body, 'utf8');
  fs.writeFileSync(path.join(work, 'b.ts'), body, 'utf8');
  await instr.instrumentProject(work, { projectRoot: REPO, write: true });
  const js = fs.readFileSync(path.join(work, 'a.mjs'), 'utf8');
  const ts = fs.readFileSync(path.join(work, 'b.ts'), 'utf8');
  check('JS 宿主：注入文本**不含** TS 专属 `as`（否则 SyntaxError）', !/\bas\s+(Error|any)\b/.test(js), /\bas\s+(Error|any)\b/.test(js) ? '仍含 as' : '干净');
  check('TS 宿主：注入文本**保留** `as Error`（否则宿主 tsc 报 unknown）', /as Error/.test(ts), /as Error/.test(ts) ? 'ok' : '缺 as Error');
  instr.restoreInstrumented(work);
  fs.rmSync(work, { recursive: true, force: true });
}

// ══════════ 3) Python 包 ══════════
{
  console.log('\n── [3/3] Python 包 ──');
  const work = fs.mkdtempSync(path.join(TMP_BASE, 'py-'));
  mk(work, PY_FILES);
  const before = snap(work, PY_FILES);
  const run = (script) => spawnSync('python', [script], { cwd: work, encoding: 'utf8' });

  const base = run('main.py');
  check('① 基线可跑', base.status === 0, `exit=${base.status} ${(base.stderr || '').split('\n')[0]}`);

  const res = await instrPy.instrumentPyProject(work, { projectRoot: REPO, write: true });
  const sites = res.reduce((n, r) => n + r.sites.length, 0);
  const fns = res.reduce((n, r) => n + (r.functions ?? 0), 0);
  check('插桩：有探针点', sites > 0, `sites=${sites} functions=${fns} 文件=${res.length}`);

  const after = run('main.py');
  check('① 插桩后宿主仍跑得起来', after.status === 0, `exit=${after.status} ${(after.stderr || '').split('\n')[0]}`);
  check('② 插桩后 stdout 逐字不变', after.stdout === base.stdout, `base=${JSON.stringify(base.stdout.trim())} now=${JSON.stringify(after.stdout.trim())}`);

  // ③ 接 sink ⇒ 真出事件（Python 侧原先没有这张证，T313 点名要）
  const ev = path.join(work, 'events.jsonl');
  const probeDir = path.join(REPO, 'observe-lang-py').replaceAll('\\', '/');
  fs.writeFileSync(
    path.join(work, 'sinkmain.py'),
    `import os, sys\nsys.path.insert(0, ${JSON.stringify(probeDir)})\n` +
      `from camprobe import set_global_probe_sink, JsonlSink\n` +
      `set_global_probe_sink(JsonlSink(${JSON.stringify(ev.replaceAll('\\', '/'))}))\n` +
      `import main\n`,
    'utf8',
  );
  const sinkRun = run('sinkmain.py');
  check('③ 接 sink ⇒ events 行数 > 0', sinkRun.status === 0 && lines(ev) > 0, `exit=${sinkRun.status} 行数=${lines(ev)}`);

  instr.restoreInstrumented(work);
  const bad = changed(before, snap(work, PY_FILES));
  check('④ 还原逐字节相同', bad.length === 0, bad.join(',') || '全部相同');
  fs.rmSync(work, { recursive: true, force: true });
}

try {
  fs.rmSync(TMP_BASE, { recursive: true, force: true });
} catch {
  /* 有人还在用就算了 */
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
console.log('★ 两份语言包都满足：能跑 / 不改行为 / 真出事件 / 可还原 —— 骨架的「语言包契约」成立。');
