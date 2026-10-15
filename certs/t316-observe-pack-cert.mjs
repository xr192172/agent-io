#!/usr/bin/env node
/**
 * cert T316 —— **observe 语言包出生证**（TS/JS · Python · Go 三份）。
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
 *
 * ## ★ 环境约束（如实记，2026-10-15 实测）
 * 本证**单独跑 14/14**；但在 `npm run certs`（36 张）里跑时**被宿主的安全删除闸拦下**：
 *   `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {count:56, threshold:50, scope:"turn"}`
 *   —— 那道闸按**「一个对话回合内的删除【操作】数」**累计（阈值 50），**与删了多少文件无关**。
 *   ⇒ 36 张证合计的删除操作数**必然**越过 50，**最后跑的那张会被拦**（本次是 t316，因为它按名字排最后）。
 *   ⇒ ★ **这不是本证或产品的缺陷**，是「全量套件 × 宿主删除闸」的组合；单独跑即绿。
 *   ⇒ 本证为此**把清理压到 1 次操作**（原本每节各删一次 + 末尾再删一次 = 4 次），给套件留余量。
 *   ⇒ ★ 根治要在**跑套件那一层**（给 certs 跑批关掉/抬高该闸），不在单张证里 —— 单张证**不该**
 *     去改宿主的进程环境（那等于"自己把安全阀拆了"，正是本仓最反对的形态）。
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
const instrGo = require(path.join(REPO, 'dist/src/infrastructure/analysis/observe/go_instrument.js'));
const instrJava = require(path.join(REPO, 'dist/src/infrastructure/analysis/observe/instrument_java.js'));

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
  console.log('\n── [1/5] TS/JS 包（8 扩展名里的 JS 家族 + TS 家族）──');
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
}

// ══════════ 2) T314 语法分叉 ══════════
{
  console.log('\n── [2/5] T314：注入文本必须随【宿主语法】分叉 ──');
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
}

// ══════════ 3) Python 包 ══════════
{
  console.log('\n── [3/5] Python 包 ──');
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
}

// ══════════ 4) Go 包 ══════════
// ★ Go 与上面两门**架构完全不同**：插桩器是**独立的 Go 程序**（`go run ./cmd/instrument`），
//   探针包要**拷进被测工程**（`internal/camprobe/`），注入的 import 指向它。
//   ⇒ 这一节要额外证明"**拷进来的探针包 + 注入的 import 真的能编译能跑**"——
//     那正是 T268 之后最容易悄悄坏掉的一环（换个机器/换盘符就失效的老路已废）。
{
  console.log('\n── [4/5] Go 包（外部进程 + 探针包拷入被测工程）──');
  const work = fs.mkdtempSync(path.join(TMP_BASE, 'go-'));
  const MODULE = 'camfixture';
  const GO_FILES = {
    'go.mod': `module ${MODULE}\n\ngo 1.21\n`,
    'main.go': `package main

import "fmt"

func add(a, b int) int { return a + b }

func sign(n int) string {
	if n > 0 {
		return "pos"
	}
	return "neg"
}

// 命名返回值 + defer/recover（T279 那条路的现场）
func risky(x int) (out string) {
	defer func() {
		if r := recover(); r != nil {
			out = "recovered"
		}
	}()
	if x < 0 {
		panic("neg")
	}
	return "ok"
}

func main() {
	fmt.Println(add(1, 2), sign(-1), risky(5), risky(-1))
}
`,
  };
  mk(work, GO_FILES);
  const before = snap(work, GO_FILES);
  const go = (args) => spawnSync('go', args, { cwd: work, encoding: 'utf8' });

  const base = go(['run', '.']);
  check('① 基线可跑（先证明夹具本身是好的）', base.status === 0, `exit=${base.status} ${(base.stderr || '').split('\n')[0]}`);

  const out = await instrGo.instrumentGoProject(work, { dryRun: false });
  const sites = out.files.reduce((n, f) => n + (f.sites?.length ?? 0), 0);
  const errs = out.files.filter((f) => f.error);
  check('插桩：有探针点且无文件报错', sites > 0 && errs.length === 0, `sites=${sites} 文件=${out.files.length} 报错=${errs.length}`);

  const after = go(['run', '.']);
  check('① 插桩后宿主仍跑得起来（探针不打断宿主）', after.status === 0, `exit=${after.status} ${(after.stderr || '').split('\n')[0].slice(0, 160)}`);
  check('② 插桩后 stdout 逐字不变', after.stdout === base.stdout, `base=${JSON.stringify(base.stdout.trim())} now=${JSON.stringify(after.stdout.trim())}`);

  // ③ 接 sink ⇒ 真出事件。★ 用被测工程**自己**的 go test 驱动：探针包已拷进它 ⇒ 它能直接 import。
  const ev = path.join(work, 'events.jsonl');
  fs.writeFileSync(
    path.join(work, 'sink_cert_test.go'),
    `package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	// 【本证自己撞上过的坑，故在此标明】
	// 必须起**显式别名** camprobe：探针落在 internal/camprobe/ 目录，但里面声明的是 package probe
	// ⇒ 目录名 != 包名；不起别名会报 imported as probe and not used（T319）。
	camprobe "${MODULE}/internal/camprobe"
)

func TestGoSinkCaptures(t *testing.T) {
	ev := ${JSON.stringify(ev.replaceAll('\\', '/'))}
	s, err := camprobe.NewSink(ev)
	if err != nil {
		t.Fatal(err)
	}
	camprobe.SetGlobalSink(s)
	add(1, 2)
	sign(-1)
	risky(5)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(ev)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "\\n") == 0 {
		t.Fatal("接 sink 后零事件（探针就位 ≠ 有数据）")
	}
	t.Logf("事件行数=%d", strings.Count(string(data), "\\n"))
	_ = filepath.Join
	_ = os.Getenv
}
`,
    'utf8',
  );
  const goTest = go(['test', '.', '-run', 'TestGoSinkCaptures', '-count=1', '-v']);
  check('③ 接 sink ⇒ events 行数 > 0', goTest.status === 0 && lines(ev) > 0, `exit=${goTest.status} 行数=${lines(ev)} ${(goTest.stderr || '').split('\n')[0].slice(0, 140)}`);

  await instrGo.restoreGoProject(work);
  const bad = changed(before, snap(work, GO_FILES));
  check('④ 还原逐字节相同', bad.length === 0, bad.join(',') || '全部相同');
  // ★ T296：拷进去的探针包必须**连目录一起**删掉（它是生成物，不该留在被测工程里）
  check('④ 拷入的探针包已删除（连空掉的 internal/ 一起）', !fs.existsSync(path.join(work, 'internal')), fs.existsSync(path.join(work, 'internal')) ? 'internal/ 仍在' : '已清理');
}

// ══════════ 5) Java 包 ══════════
// ★ 第 4 门语言，**整份由 `npm run new-observe-lang` 的填空题填出来**（只填 ①/②/⑥ + 两个语句渲染件）
//   ⇒ 这一节是"补一门语言到底要多久"的判据，而**不是**再证明一次"骨架能用"。
// ★ 接线方式（Java 版）：探针类是 default package ⇒ **同包同目录零 import**
//   ⇒ 夹具把 `observe-lang-java/` 整个目录拷进来当被测工程（已记 T320：语言包自己不拷），
//     且**不显式传 projectRoot** —— 让"项目根路标推断"也在这节里被真跑一次。
// ★ 夹具刻意覆盖的形态（都是 2026-10-15 出生证第一次跑撞出来的）：
//   · 无大括号 guard return（`if (n > 0) return 1;`）—— 必须包块，否则探针逃逸成无条件；
//   · then 无大括号 + else 有大括号的混合形态 —— 两个分支两种改写，都不能错；
//   · 单行体方法（`int oneLine(int n) { … }`）—— enter/return 改写都应保持单行合法；
//   · lambda / 匿名类里的 return —— 不得误记成外层方法的 exit 探针；
//   · 重载方法 —— 探针名不得撞车（T303 同族）。
{
  console.log('\n── [5/5] Java 包（第 4 门：由填空题填出）──');
  const work = fs.mkdtempSync(path.join(TMP_BASE, 'java-'));
  const JAVA_FILES = {
    'Box.java': `public class Box {
    private int v;
    public Box(int v) { this.v = v; }
    public int get() { return v; }
    public static int twice(int n) { return n * 2; }
    int guarded(int n) {
        if (n > 0) return 1;
        return 0;
    }
    // 混合形态：then 无大括号 + else 有大括号 ⇒ 两个分支的 return 形态不同，探针都不能逃逸
    int mixed(int n) {
        if (n > 0) return 1; else { return 2; }
    }
    // 单行体方法：enter 与两处 return 改写都应保持单行且合法
    int oneLine(int n) { if (n > 0) return n; return -n; }
    // Java 重载：同名不同参 ⇒ 探针名必须区分（T303 同族），否则撞车
    String show(int n) { return "i" + n; }
    String show(String s) { return "s" + s; }
}
`,
    'Main.java': `public class Main {
    public static void main(String[] args) throws Exception {
        if (args.length > 0) Camprobe.setGlobalSink(new Camprobe.JsonlSink(args[0]));
        Box b = new Box(7);
        // lambda / 匿名类里的 return：不观测，但【不得误记】成 Main.main 的探针
        java.util.function.Supplier<Integer> s = () -> { return 5; };
        Runnable r = new Runnable() { public void run() { return; } };
        r.run();
        System.out.println(b.get() + " " + Box.twice(3) + " " + b.guarded(-1) + " " + b.mixed(3) + " " + b.oneLine(-4) + " " + b.show(1) + b.show("x") + " " + s.get());
    }
}
`,
  };
  mk(work, JAVA_FILES);
  // 探针运行时整个目录拷进被测工程（同包零 import）—— 由夹具代做，语言包自己不拷（T320）
  fs.cpSync(path.join(REPO, 'observe-lang-java'), path.join(work, 'observe-lang-java'), { recursive: true });
  const probeSrc = fs.readFileSync(path.join(work, 'observe-lang-java/Camprobe.java'), 'utf8');
  const before = snap(work, JAVA_FILES);
  const javac = () => spawnSync('javac', ['-encoding', 'UTF-8', '-d', '.', 'Box.java', 'Main.java', 'observe-lang-java/Camprobe.java'], { cwd: work, encoding: 'utf8' });
  const runMain = (extra = []) => spawnSync('java', ['Main', ...extra], { cwd: work, encoding: 'utf8' });

  const c0 = javac();
  check('① 基线可编译', c0.status === 0, `javac exit=${c0.status} ${(c0.stderr || '').split('\n')[0]}`);
  const base = runMain();
  // ★ 基线必须**真的打印东西** —— 否则下面"stdout 逐字不变"会在两个空串之间恒真（判据装饰）
  check('① 基线可跑（先证明夹具本身是好的）', base.status === 0 && base.stdout.trim().length > 0, `exit=${base.status} stdout=${JSON.stringify(base.stdout.trim())} ${(base.stderr || '').split('\n')[0]}`);

  // ★ 不传 projectRoot ⇒ 项目根靠路标 `observe-lang-java/Camprobe.java` 推断（推断失败会响亮抛）
  const out = await instrJava.instrumentJavaProject(work, { write: true });
  const sites = out.reduce((n, r) => n + r.sites.length, 0);
  const errs = out.filter((r) => r.error);
  check('插桩：有探针点且无文件报错', sites > 0 && errs.length === 0, `sites=${sites} 文件=${out.length} 报错=${errs.length}`);

  const c1 = javac();
  check('① 插桩后仍能编译（探针不打断宿主）', c1.status === 0, `javac exit=${c1.status} ${(c1.stderr || '').split('\n')[0].slice(0, 200)}`);
  const after = runMain();
  check('② 插桩后 stdout 逐字不变', after.stdout === base.stdout, `base=${JSON.stringify(base.stdout.trim())} now=${JSON.stringify(after.stdout.trim())}`);

  const ev = path.join(work, 'events.jsonl');
  const sinkRun = runMain([ev]);
  check('③ 接 sink ⇒ events 行数 > 0', sinkRun.status === 0 && lines(ev) > 0, `exit=${sinkRun.status} 行数=${lines(ev)}`);

  // Java 重载必须区分（T303 同族）：两个 show 不得撞成同一个探针名
  // ★ 判据数的是【方法基名】（剥掉 .enter/.exit）—— 每个方法有 enter+exit 两条探针，
  //   直接数探针名会把 2 个方法数成 4 条（出生证第一次跑就把这道检查本身写错了）。
  const names = new Set(out.flatMap((f) => f.sites.map((s) => s.probe)));
  const showBases = new Set([...names].filter((n) => n.includes('.show')).map((n) => n.replace(/\.(enter|exit)$/, '')));
  check('重载方法探针名互不撞车（T303 同族）', showBases.size === 2, [...showBases].join(' | '));

  // lambda / 匿名内部类内的 return 不得被误记成外层方法的探针（误记比不观测更坏）
  const mainExits = [...names].filter((n) => n === 'Main.main.exit');
  check('lambda/匿名类内的 return 不误记成 Main.main.exit', mainExits.length === 0, mainExits.join(',') || '无（main 无 return，本就不该有 exit 探针）');

  // 探针运行时自身不被插桩（排除判据：文件名 Camprobe.java）—— 与仓内原件逐字相同
  check('探针运行时自身不被插桩', fs.readFileSync(path.join(work, 'observe-lang-java/Camprobe.java'), 'utf8') === probeSrc, '与仓内原件逐字相同');

  instr.restoreInstrumented(work); // 备份/台账语言无关（.agent-io 同一套）⇒ 复用 TS 侧实现
  const bad = changed(before, snap(work, JAVA_FILES));
  check('④ 还原逐字节相同', bad.length === 0, bad.join(',') || '全部相同');
}

try {
  fs.rmSync(TMP_BASE, { recursive: true, force: true });
} catch {
  /* 有人还在用就算了 */
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
console.log('★ 四份语言包（TS/JS · Python · Go · Java）都满足：能跑 / 不改行为 / 真出事件 / 可还原。');
console.log('★ Java 那份是**填空题填出来的**（只填 ①/②/⑥ + 两个语句渲染件）⇒ 这就是"补语言只补填空"的实测。');
