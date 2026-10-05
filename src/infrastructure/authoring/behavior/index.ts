/**
 * behavior —— 行为基线（金丝雀测试对比）
 *
 * 从契约（签名骨架）出发给目标函数生成金丝雀 harness，改动前后各跑一次，
 * 对比行为差异——验证"跑得对不对"。动态闸只答"跑得动不炸"，补不了这个缺口：
 * 改完还能跑、但返回值/副作用悄悄变了，只有行为基线能抓到。
 *
 * 工作流（capture → 改代码 → verify）：
 *   1. capture：对目标文件的目标函数生成 harness，用样例输入跑一次，
 *      记录返回值（规范化 repr）、stdout 痕迹与函数源码快照 → 存为基线 JSON。
 *   2. 用户改动（版本升级 / 重构 / 局部重写）目标代码。
 *   3. verify：用同一份 harness 对"当前磁盘"的目标文件再跑一次，
 *      与基线逐 case 对齐对比 → 判定 same / diff。
 *
 * 语言支持：
 *   - python（.py）：金丝雀 harness 直跑解释器（顶层 exec 整文件，模块级依赖可用）。
 *   - node 家族（.ts/.tsx/.js/.jsx/.mjs/.cjs）：typescript.transpileModule 转 CJS 后
 *     由 node 子进程整体 require（顶层模块代码运行，等价于 python 的顶层 exec）。
 *
 * v1 边界（诚实标注）：
 *   - 目标函数须自包含：python 顶层 exec 整文件；node 转译后的 CJS 整体 require——
 *     模块级常量/同文件其它函数可用；跨文件 import 不在支持范围（node 侧解析不到即报错、
 *     python 侧不拦截），留待项目级验证。
 *   - 返回值对比 = 规范化 repr；set 排序化（python）、Set/Map 排序化（node），dict/对象保留插入序。
 *   - 样例输入由调用方显式提供（capture 的 cases 参数）；不自动生成（v2 可加 fuzz）。
 *   - node 的 kwargs（JS 无关键字实参概念）以单个尾部 options 对象传入；无 kwargs 则不传。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { NODE_RUNNABLE_EXTS } from '../../parse/index.js';
import { missingLanguageHint } from '../../parse/lang_hint.js';


/** Windows 常只有 python；POSIX 约定 python3（与动态闸 python 适配器一致） */
const PY = process.platform === 'win32' ? 'python' : 'python3';

/** node 家族扩展名（typescript.transpileModule 转 CJS 后由 node 子进程执行）
 *  ★ 清单来自内核唯一权威 `NODE_RUNNABLE_EXTS`（`ts_kernel/source_exts.ts`）—— 不再就地手写。 */
const NODE_EXTS = NODE_RUNNABLE_EXTS;

/** 编译语言扩展名（反射 harness：写临时工程 → go run / javac+java / dotnet run；缺工具链报不可用） */
const GO_EXTS = ['.go'];
const JAVA_EXTS = ['.java'];
const CS_EXTS = ['.cs'];
const C_EXTS = ['.c', '.h'];

export type BehaviorLang = 'python' | 'node' | 'go' | 'java' | 'csharp' | 'c';

/** 按文件扩展名判定 harness 语言（未知扩展 → 抛错，不静默猜）
 *  ★ P11（2026-09-29）：抛错文案追加**可执行**提示（装什么包 / 照哪份清单 / 现缺口多少）。
 *    `behavior_baseline` 要的不是 tree-sitter 解析器，而是该语言的**工具链 + harness**，
 *    所以提示里的"装包"会指向该能力的清单小节（§2.10），而不是让人去装个 tree-sitter 包。 */

export type BehaviorVerdict = 'same' | 'diff' | 'error';

/** 金丝雀用例：一个样例输入 */
export interface BehaviorCase {
  name: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
}

/** 一次行为基线任务（capture 与 verify 共用同一份 spec） */
export interface BehaviorSpec {
  /** 项目根目录（用于把 file 解析为绝对路径 + 定位默认基线目录） */
  project_dir: string;
  /** 相对 project_dir 的目标文件（.py / .ts / .tsx / .js / .jsx / .mjs / .cjs） */
  file: string;
  /** 目标顶层函数名 */
  function: string;
  /** 样例输入（capture 必需） */
  cases: BehaviorCase[];
  /** 单次运行超时（毫秒，默认 60_000） */
  timeout_ms?: number;
}

/** 单个样例的执行结果 */
export interface BehaviorSampleResult {
  case: string;
  ok: boolean;
  /** ok 时：规范化 repr 的返回值 */
  ret?: string;
  /** !ok 时：异常摘要（Type: message） */
  error?: string;
}

/** 一次 harness 运行（capture 与 verify 共用的可对比载体） */
export interface BehaviorRun {
  file_abs: string;
  /** 目标文件 sha256 前 12 位（信息性：哪个版本产出本快照） */
  file_hash: string;
  /** 目标函数源码快照（python: inspect.getsource；node: Function.prototype.toString） */
  source: string;
  /** 顶层 exec + 函数调用的 stdout 痕迹（print/console 副作用也入基线） */
  stdout: string;
  results: BehaviorSampleResult[];
  /** 进程级失败（解释器不可用 / 超时 / 函数缺失 / 解析失败）→ 无法对比 */
  error?: string;
}

/** 落盘的基线 */
export interface BehaviorBaseline {
  spec: Omit<BehaviorSpec, 'project_dir'>;
  file_hash: string;
  generated_at: string;
  source: string;
  stdout: string;
  results: BehaviorSampleResult[];
  baseline_path: string;
}

/** 逐 case 的对比条目 */
export interface CaseDiff {
  case: string;
  status: 'same' | 'changed';
  before?: string;
  after?: string;
  before_error?: string;
  after_error?: string;
}

export interface BehaviorDiff {
  verdict: BehaviorVerdict;
  /** 基线里的 case 总数 */
  matched: number;
  /** 变化的 case 数 */
  changed: number;
  details: CaseDiff[];
  message: string;
}

// ── harness 生成：python ────────────────────────────────────

/**
 * 生成金丝雀 harness（Python 脚本）。纯函数便于单测。
 * 运行期行为：读 TARGET_FILE 当前磁盘内容 → ast 校验顶层函数存在 →
 * 重定向 stdout 后顶层 exec → 逐 case 调目标函数 → 输出单行 JSON
 * { source, stdout, results }（进程级失败时输出 { error }）。
 * 始终读"当前磁盘"，故 capture 与 verify 用同一份 harness 各自跑即可对比。
 */
export function harnessSource(spec: BehaviorSpec): string {
  const targetAbs = path.resolve(spec.project_dir, spec.file);
  return `# -*- coding: utf-8 -*-
import json, sys, io, ast, inspect, contextlib

TARGET_FILE = ${JSON.stringify(targetAbs)}
FUNC_NAME = ${JSON.stringify(spec.function)}
CASES = ${JSON.stringify(spec.cases)}

def _norm(v):
    # 规范化 repr：set/frozenset 排序化（repr 顺序不稳定）；
    # 其余 str/int/float/bool/None/list/tuple/dict 的 repr 在 3.7+ 确定性稳定（dict 保留插入序）
    if isinstance(v, (set, frozenset)):
        return "set(" + repr(sorted(list(v), key=repr)) + ")"
    return repr(v)

def main():
    try:
        with open(TARGET_FILE, encoding="utf-8") as f:
            src = f.read()
    except OSError as e:
        print(json.dumps({"error": "cannot read target file: " + str(e)}))
        return 1
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        print(json.dumps({"error": "target syntax error: " + str(e)}))
        return 1
    names = {n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    if FUNC_NAME not in names:
        print(json.dumps({"error": "top-level function not found: " + FUNC_NAME}))
        return 1
    ns = {}
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        exec(compile(src, TARGET_FILE, "exec"), ns)
        results = []
        for c in CASES:
            try:
                r = ns[FUNC_NAME](*c.get("args", []), **c.get("kwargs", {}))
                results.append({"case": c["name"], "ok": True, "ret": _norm(r)})
            except Exception as e:
                results.append({"case": c["name"], "ok": False,
                                "error": type(e).__name__ + ": " + str(e)})
    source = ""
    try:
        source = inspect.getsource(ns[FUNC_NAME])
    except Exception:
        source = "(unavailable)"
    print(json.dumps({"source": source, "stdout": buf.getvalue(), "results": results}))
    return 0

sys.exit(main())
`;
}

// ── harness 生成：node 家族 ─────────────────────────────────

/**
 * 把目标 TS/JS 源码转成 CommonJS（ts.transpileModule 单文件转译）。
 * 跨文件 import 会留下 require(...) 调用——子进程里解析不到即报错（v1 边界：须自包含）。
 * 返回 { js } 或 { error }（语法/转译失败）。
 */
export function transpileToCjs(abs: string, src: string): { js: string } | { error: string } {
  const out = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      allowJs: true,
      isolatedModules: true,
    },
    fileName: abs,
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length > 0) {
    const msg = errs
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0])
      .join('; ');
    return { error: `目标文件转译失败: ${msg}` };
  }
  return { js: out.outputText };
}

/**
 * 生成金丝雀 runner（Node .mjs 脚本）。纯函数便于单测。
 * 运行期行为：createRequire 加载 TARGET_CJS（argv[2]，父进程已转译好的 CJS，读"当前磁盘"）→
 * 定位顶层函数 → 重定向 console 后逐 case 调用（async 自动 await；kwargs 以尾部 options 对象传入）→
 * 输出单行 JSON { source, stdout, results }（进程级失败时输出 { error }）。
 */
export function nodeRunnerSource(spec: BehaviorSpec): string {
  return `import { createRequire } from 'node:module';

const FUNC_NAME = ${JSON.stringify(spec.function)};
const CASES = ${JSON.stringify(spec.cases)};

function _sk(x) {
  if (x === null || x === undefined) return '';
  if (x instanceof Date) return x.toISOString();
  return typeof x === 'string' ? x : String(x);
}

function _norm(v) {
  // 规范化 repr：Set/Map 按键排序化（迭代序不稳定）；对象/数组保留插入序（JSON.stringify）
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    return JSON.stringify(v);
  }
  if (t === 'bigint') return v.toString() + 'n';
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return String(v);
  if (t === 'function') return v.toString();
  if (v instanceof Date) return 'Date(' + v.toISOString() + ')';
  if (v instanceof RegExp) return v.toString();
  if (v instanceof Error) return v.name + ': ' + v.message;
  if (v instanceof Set) {
    try {
      return 'Set(' + JSON.stringify([...v].sort((a, b) => (_sk(a) < _sk(b) ? -1 : _sk(a) > _sk(b) ? 1 : 0))) + ')';
    } catch { return String(v); }
  }
  if (v instanceof Map) {
    try {
      return 'Map(' + JSON.stringify([...v.entries()].sort((a, b) => (_sk(a[0]) < _sk(b[0]) ? -1 : _sk(a[0]) > _sk(b[0]) ? 1 : 0))) + ')';
    } catch { return String(v); }
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

// console 痕迹捕获（模块加载 + 逐 case 调用的 stdout 副作用都入基线）
const _origConsole = {};
for (const k of ['log', 'info', 'warn', 'error', 'debug']) _origConsole[k] = console[k];
let _logs = [];
function _capStart() {
  _logs = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    console[k] = (...a) => {
      _logs.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' '));
    };
  }
}
function _capEnd() {
  for (const k of Object.keys(_origConsole)) console[k] = _origConsole[k];
  return _logs.join('\\n');
}

let mod;
let loadStdout = '';
try {
  _capStart();
  try {
    mod = createRequire(import.meta.url)(process.argv[2]);
  } finally {
    loadStdout = _capEnd();
  }
} catch (e) {
  const msg = String((e && e.message) || e);
  const boundary = /Cannot find module|Cannot use import statement|require is not defined|ERR_UNKNOWN_FILE_EXTENSION/.test(msg);
  process.stdout.write(JSON.stringify({ error: (boundary ? '跨文件 import / 模块解析失败（v1 边界：目标文件须自包含）: ' : '目标文件加载失败: ') + msg }));
  process.exit(1);
}

let fn = null;
if (mod) {
  if (typeof mod[FUNC_NAME] === 'function') fn = mod[FUNC_NAME];
  else if (mod && mod.default) {
    if (typeof mod.default === 'function' && FUNC_NAME === 'default') fn = mod.default;
    else if (mod.default && typeof mod.default[FUNC_NAME] === 'function') fn = mod.default[FUNC_NAME];
  }
}
if (typeof fn !== 'function') {
  process.stdout.write(JSON.stringify({ error: 'top-level function not found: ' + FUNC_NAME }));
  process.exit(1);
}
const source = fn.toString();

const results = [];
_capStart();
try {
  for (const c of CASES) {
    try {
      let r = fn(...(c.args || []), ...(c.kwargs && Object.keys(c.kwargs).length ? [c.kwargs] : []));
      if (r && typeof r.then === 'function') r = await r;
      results.push({ case: c.name, ok: true, ret: _norm(r) });
    } catch (e) {
      results.push({ case: c.name, ok: false, error: ((e && e.name) || 'Error') + ': ' + String((e && e.message) || e) });
    }
  }
} finally {
  const callStdout = _capEnd();
  process.stdout.write(JSON.stringify({ source, stdout: (loadStdout + '\\n' + callStdout).replace(/^\\n/, ''), results }));
}
`;
}

// ── harness 执行 ─────────────────────────────────────────────

/** 写临时 python harness 并真跑目标文件，解析单行 JSON 输出 */

/**
 * node 家族：父进程转译 TS/JS → CJS（读"当前磁盘"），写临时 CJS + runner，
 * spawn node 子进程执行，解析单行 JSON 输出。与 python 分支同一份输出契约，diff 共用。
 */

// ── harness 生成：编译语言（Go/Java/C#/C）───────────────
//
// 编译语言无动态调用，采用「反射 + 临时工程」：
//   1. 把目标文件拷进临时模块/工程（Go 重写 package 为占位、Java/C# 保持类名一致）
//   2. 生成一个 runner：反射定位目标函数 → 按函数签名把 JSON 参数强转 → 调用 → 输出单行 JSON
//   3. go run / javac+java / dotnet run / cc 执行；缺工具链 → 报"工具链不可用"（error，不静默）
// 适用面（诚实标注）：仅自包含、参/返为可 JSON 的基本类型（int/float/string/bool/数组）的函数。

/** 把源文件最顶部的 package 声明改写为指定包名（无 package 行则前置） */
function rewritePackageClause(src: string, pkg: string): string {
  // Go 的 package 行通常无分号（`package util`），兼容带分号写法
  const m = src.match(/^\s*package\s+[\w.]+\s*;?(?=\n|$)/m);
  if (m) {
    const idx = m.index ?? 0;
    return src.slice(0, idx) + `package ${pkg}` + src.slice(idx + m[0].length);
  }
  return `package ${pkg};\n` + src;
}

/** Go 反射 runner：函数名内联为 `target.NAME`，参数按签名强转 */
function goRunnerSource(spec: BehaviorSpec): string {
  return `package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	target "harness/x"
)

var CASES_JSON = ${JSON.stringify(JSON.stringify(spec.cases))}

func main() {
	fn := reflect.ValueOf(target.${spec.function})
	fnT := fn.Type()
	var cases []map[string]interface{}
	if err := json.Unmarshal([]byte(CASES_JSON), &cases); err != nil {
		e, _ := json.Marshal(map[string]interface{}{"error": "cases json: " + err.Error()})
		fmt.Println(string(e))
		return
	}
	results := []map[string]interface{}{}
	for _, c := range cases {
		entry := map[string]interface{}{"case": c["name"], "ok": true}
		raw, _ := c["args"].([]interface{})
		if len(raw) < fnT.NumIn() {
			entry["ok"] = false
			entry["error"] = "argc mismatch"
		} else {
			call := make([]reflect.Value, fnT.NumIn())
			bad := ""
			for i := 0; i < fnT.NumIn() && bad == ""; i++ {
				rv, err := coerce(raw[i], fnT.In(i))
				if err != nil {
					bad = err.Error()
					break
				}
				call[i] = rv
			}
			if bad != "" {
				entry["ok"] = false
				entry["error"] = bad
			} else {
				out := fn.Call(call)
				if len(out) == 0 {
					entry["ret"] = "null"
				} else {
					entry["ret"] = normRet(out[0])
				}
			}
		}
		results = append(results, entry)
	}
	j, _ := json.Marshal(map[string]interface{}{"results": results})
	fmt.Println(string(j))
}

func coerce(v interface{}, pt reflect.Type) (reflect.Value, error) {
	if v == nil {
		return reflect.Zero(pt), nil
	}
	switch pt.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		f, _ := v.(float64)
		return reflect.ValueOf(int(f)).Convert(pt), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		f, _ := v.(float64)
		return reflect.ValueOf(uint(f)).Convert(pt), nil
	case reflect.Float32, reflect.Float64:
		f, _ := v.(float64)
		return reflect.ValueOf(f).Convert(pt), nil
	case reflect.String:
		s, _ := v.(string)
		rv := reflect.New(pt).Elem()
		rv.SetString(s)
		return rv, nil
	case reflect.Bool:
		b, _ := v.(bool)
		return reflect.ValueOf(b), nil
	}
	return reflect.Value{}, fmt.Errorf("unsupported param type %v", pt)
}

func normRet(rv reflect.Value) string {
	if !rv.IsValid() {
		return "null"
	}
	if rv.Kind() == reflect.String {
		b, _ := json.Marshal(rv.String())
		return string(b)
	}
	b, err := json.Marshal(rv.Interface())
	if err != nil {
		return fmt.Sprint(rv.Interface())
	}
	return string(b)
}
`;
}

/** 工具链探测：命令存在且可执行（**不判版本** —— 保持"有/没有"这个判据本身简单）。 */
function toolAvailable(cmd: string): boolean {
  return toolchainIssue(cmd, undefined) === null;
}

/**
 * 工具链可用性：存在 **且版本够**。
 *
 * ★ 2026-10-05 收紧：原先只看"命令存在"。那样会出现一种**最难查的情况** ——
 *   项目要求 Go 1.22（`go.mod` 的 `go 1.22`）、机器上是 1.20 ⇒ 探测判"可用"
 *   ⇒ 跑下去给用户一坨编译错误，而真实原因是**版本不够**。
 *   用户看到编译错误只会去改代码，不会想到"该升 Go"。
 *   ⇒ 判据仍是"有/没有"这一个布尔（**不引入第三态**），只是把"有"的定义收紧为"够用"。
 *   两种情况都报"工具链不可用"，只是**文案要说清是没装还是版本不够**。
 *
 * @returns null = 可用；否则返回可执行的原因说明
 */
function toolchainIssue(cmd: string, minVersion: string | undefined, probeArgs?: string[]): string | null {
  // ★ Windows 上必须带 shell：Node 不带 shell **找不到 `.cmd`/`.bat`**（scoop/winget/自建 wrapper 都是这种）
  const shell = process.platform === 'win32';
  const args = probeArgs ?? TOOLCHAIN_PROBE[cmd] ?? ['--version'];
  const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 15_000, windowsHide: true, shell });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

  // ① 存在性：**不靠 `r.error`**。带 shell 时 cmd.exe 本身会成功执行、内层命令失败时
  //    `r.error` 仍是 null（实测：不存在的命令会走到这里被判成"可用" ⇒ 假绿灯）。
  //    改为要求"能解析出版本号" —— 只有真工具链才会应答我们用的那个子命令。
  const got = /(\d+)\.(\d+)/.exec(out);
  if (!got) {
    // ★ **两处刻意不按文案判"没装"**，因为文案在这台机器上不可靠：
    //   ① Windows 用 OEM 代码页输出**本地化**消息，Node 按 UTF-8 解码成乱码
    //      （实测 `no-such-tool-xyz` 的"不是内部或外部命令"解出来是一片乱码）
    //      ⇒ 按中/英文案匹配会**静默失效**（我先写了正则，测出来才发现不匹配）。
    //   ② 各语言"没装"的措辞本身就不同。
    //   改用**结构性事实**。这也是为什么上面要有 `TOOLCHAIN_PROBE` 表：
    //   配对了子命令后，真工具链必然退出 0（实测 `go version`→0、`node --version`→0），找不到则退出 1。
    if (r.error || r.status !== 0) return '未安装';
    // 退出码 0 却认不出版本 ⇒ 工具在、但没按我们问的方式应答 ⇒ **仍不判为可用**（宁可误报不可用）
    return '已找到但认不出版本';
  }
  if (!minVersion) return null;
  const [ma, mi] = minVersion.split('.').map((n) => Number(n) || 0);
  const [ga, gi] = [Number(got[1]), Number(got[2])];
  if (ga > ma || (ga === ma && gi >= mi)) return null;
  return `版本 ${got[1]}.${got[2]}，低于需要的 ${minVersion}`;
}

/**
 * 「没有对应工具链」的可执行提示（2026-10-05）。
 *
 * ★ 形态**刻意照抄** `infrastructure/parse/lang_hint.ts` 的"可执行提示"四要件：
 *   ① 缺哪个语言的哪个能力 ② 装什么 ③ 照哪份清单补 ④ 现场事实
 *   **不新增任何持久状态** —— 与 tree-sitter 缺失提示同一种形态（无状态、按次判定：
 *   对上了就不报）。★ 这一点是 2026-10-05 讨论的结论：曾提议过做
 *   `available/degraded/unavailable` 三态以便"度量缺口"，**被否** ——
 *   那要为每个工具的结果类型、每个调用方、每份报告都加字段，
 *   而产出的数字没人要；**这是"能报"被升级成"要记账"的典型反面案例**。
 *
 * @param lang     语言 id（如 `go`）
 * @param reason   `toolchainIssue` 的返回值；`null` 表示可用（本函数不处理）
 * @param install  该语言的安装指引（一句话，含官方渠道）
 */
export function missingToolchainHint(lang: string, reason: string, install: string): string {
  return (
    `此工具没有 ${lang} 对应的**工具链**（${reason}）⇒ 无法运行 ${lang} 行为基线。\n` +
    `  装什么：${install}\n` +
    `  照哪份清单补：docs/adding-a-language.md §2.10（behavior_baseline 的 harness 与工具链）\n` +
    `  ★ 这不是"${lang} 门没实现"—— 门实现了，缺的是这台机器上的 ${lang} 工具链。`
  );
}

/**
 * 各语言的**探测子命令**与版本解析。
 * ★ 为什么要按语言给不同 args：`--version` 并非 universally supported ——
 *   实测真 `go --version` **退出码 2**（Go 只有 `go version`），若拿退出码判存在性就会误判。
 * ★ 与 `TOOLCHAIN_INSTALL` 并列单点维护，避免每个 harness 各写一遍。
 */
const TOOLCHAIN_PROBE: Record<string, string[]> = {
  go: ['version'],        // go version go1.22.0 linux/amd64
  java: ['-version'],     // javac 21.0.1
  csharp: ['--version'],   // 8.0.100
  python: ['--version'],   // Python 3.11.7
  node: ['--version'],     // v20.11.0
  c: ['--version'],        // gcc (GCC) 13.2.0
};

/** 各语言的工具链安装指引（单点维护，避免每个 harness 各写一遍）。 */
const TOOLCHAIN_INSTALL: Record<string, string> = {
  go: 'https://go.dev/dl/ （或 `mise use go@latest`；已有项目请尊重其 go.mod 声明的版本）',
  python: 'https://docs.python.org/3/using/windows.html ｜ `uv python install`（PEP 723 脚本可零安装运行）',
  node: '已随本仓运行（node）；若缺：https://nodejs.org/ ｜ `mise use node@lts`',
  java: 'https://adoptium.net/ （Temurin JDK）｜ `mise use java@lts`',
  csharp: 'https://dotnet.microsoft.com/download ｜ `mise use dotnet@lts`',
};

/** Go：临时模块 + 目标文件(改写为 package x) + 反射 main；`go run .` */

/** 把 BehaviorCase 数组转成 Java/C# 的 Object[][] 字面量（数字→Double、字符串/布尔原样） */
function javaLiteralArgs(cases: BehaviorCase[]): string {
  const esc = (s: string) => JSON.stringify(s);
  const pieces = cases.map((c) => {
    const args = (c.args ?? []).map((a) => {
      if (typeof a === 'number') return `Double.valueOf(${a})`;
      if (typeof a === 'string') return esc(a);
      if (typeof a === 'boolean') return `Boolean.valueOf(${a})`;
      return 'null';
    }).join(', ');
    return `{ ${esc(c.name)}, new Object[]{${args}} }`;
  });
  return `{ ${pieces.join(', ')} }`;
}

/** C# 版 Object[][] 字面量（数字/布尔原样、字符串转义；与 Java 的 Double.valueOf 不同） */
function csLiteralArgs(cases: BehaviorCase[]): string {
  return cases.map((c) => {
    const args = (c.args ?? []).map((a) => {
      if (typeof a === 'string') return JSON.stringify(a);
      if (typeof a === 'boolean' || typeof a === 'number') return String(a);
      return 'null';
    }).join(', ');
    return `new object[]{ ${JSON.stringify(c.name)}, new object[]{ ${args} } }`;
  }).join(', ');
}

/** Java 反射 runner（包 p；目标类名=文件名；静态方法反射调用；输出 name|ok|value 管道行协议） */
function javaRunnerSource(spec: BehaviorSpec, className: string): string {
  return `package p;
import java.lang.reflect.*;
import java.util.*;
public class Main {
  static final Object[][] CASES = ${javaLiteralArgs(spec.cases)};
  static String CLS = ${JSON.stringify('p.' + className)};
  static String FUNC = ${JSON.stringify(spec.function)};
  public static void main(String[] x) throws Exception {
    Class<?> k = Class.forName(CLS);
    Method fn = null;
    for (Method m : k.getDeclaredMethods()) if (m.getName().equals(FUNC)) { fn = m; break; }
    if (fn == null) { System.out.println("ERR|fn-not-found"); return; }
    Class<?>[] pts = fn.getParameterTypes();
    for (Object[] row : CASES) {
      Object[] args = cvtArgs((Object[]) row[1], pts);
      try {
        Object ret = fn.invoke(null, args);
        System.out.println(safe(row[0]) + "|1|" + safe(String.valueOf(ret)));
      } catch (InvocationTargetException it) {
        System.out.println(safe(row[0]) + "|0|" + safe(String.valueOf(it.getCause())));
      } catch (Exception ex) {
        System.out.println(safe(row[0]) + "|0|" + safe(String.valueOf(ex)));
      }
    }
  }
  static Object[] cvtArgs(Object[] src, Class<?>[] pts) {
    Object[] out = new Object[pts.length];
    for (int i = 0; i < pts.length; i++) {
      Object v = (i < src.length) ? src[i] : null;
      Class<?> pt = pts[i];
      if (v == null) { out[i] = pt.isPrimitive() ? zero(pt) : null; }
      else if (pt == int.class) out[i] = ((Number) v).intValue();
      else if (pt == long.class) out[i] = ((Number) v).longValue();
      else if (pt == double.class) out[i] = ((Number) v).doubleValue();
      else if (pt == float.class) out[i] = ((Number) v).floatValue();
      else if (pt == boolean.class) out[i] = v;
      else if (pt == String.class) out[i] = String.valueOf(v);
      else out[i] = v;
    }
    return out;
  }
  static Object zero(Class<?> pt) { if (pt == boolean.class) return Boolean.FALSE; if (pt == char.class) return (char) 0; return 0; }
  static String safe(Object o) {
    if (o == null) return "";
    return String.valueOf(o).replace((char) 10, ' ').replace((char) 13, ' ').replace('|', '/');
  }
}
`;
}

/** 解析管道行协议输出 → BehaviorSampleResult[] */
function parsePipeLines(stdout: string): BehaviorSampleResult[] {
  const out: BehaviorSampleResult[] = [];
  for (const raw of stdout.split(/\r?\n/).filter(Boolean)) {
    const line = raw.trim();
    if (line === 'ERR|fn-not-found') continue;
    const parts = line.split('|');
    if (parts.length < 2) continue;
    const name = parts[0];
    const ok = parts[1] === '1';
    const value = parts.slice(2).join('|');
    if (ok) out.push({ case: name, ok: true, ret: value });
    else out.push({ case: name, ok: false, error: value });
  }
  return out;
}

/** Java：临时包 p + 目标类 + Main；javac -d + java */

/** C#：临时 csproj + 目标类 + Program.cs（反射 assembly 按名定位静态方法）；dotnet run */
function csProjSource(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AssemblyName>harness</AssemblyName>
  </PropertyGroup>
</Project>
`;
}
function csRunnerSource(spec: BehaviorSpec, className: string): string {
  return `using System;
using System.Reflection;
using System.Collections.Generic;
public class MainClass {
  static readonly object[][] Cases = new object[][] { ${csLiteralArgs(spec.cases)} };
  static string FnName = ${JSON.stringify(spec.function)};
  public static void Main(string[] args) {
    MethodInfo fn = null;
    foreach (var t in typeof(MainClass).Assembly.GetTypes())
      foreach (var m in t.GetMethods(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Static|BindingFlags.Instance))
        if (m.Name == FnName) { fn = m; break; }
    if (fn == null) { Console.WriteLine("ERR|fn-not-found"); return; }
    var p = fn.GetParameters();
    foreach (var row in Cases) {
      try {
        var call = new object[p.Length];
        var src = (object[]) row[1];
        for (int i = 0; i < p.Length; i++) call[i] = cvt(i < src.Length ? src[i] : null, p[i].ParameterType);
        var ret = fn.Invoke(null, call);
        Console.WriteLine(Safe(row[0]) + "|1|" + Safe(Convert.ToString(ret)));
      } catch (TargetInvocationException ex) { Console.WriteLine(Safe(row[0]) + "|0|" + Safe(Convert.ToString(ex.InnerException))); }
        catch (Exception ex) { Console.WriteLine(Safe(row[0]) + "|0|" + Safe(Convert.ToString(ex))); }
    }
  }
  static object cvt(object v, Type pt) {
    if (pt.IsByRef) pt = pt.GetElementType();
    if (pt == typeof(int)) return Convert.ToInt32(v);
    if (pt == typeof(long)) return Convert.ToInt64(v);
    if (pt == typeof(double)) return Convert.ToDouble(v);
    if (pt == typeof(float)) return Convert.ToSingle(v);
    if (pt == typeof(bool)) return Convert.ToBoolean(v);
    if (pt == typeof(string)) return Convert.ToString(v);
    return v;
  }
  static string Safe(object o) {
    if (o == null) return "";
    return Convert.ToString(o).Replace((char) 10, ' ').Replace((char) 13, ' ').Replace('|', '/');
  }
}
`;
}

/** C：同步正则推断目标函数参数类型（保持 runHarness 同步签名，与 Go/Java/C# 一致） */
export function cParamTypes(source: string, funcName: string): string[] {
  const re = new RegExp(`[\\w\\s*]+\\b${funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([^)]*)\\)`);
  const m = source.match(re);
  if (!m) return [];
  const params = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  const types: string[] = [];
  for (const p of params) {
    if (p === 'void') continue;
    const pm = p.match(/^(.+?)(?:\s+(\*+))?\s+[A-Za-z_]\w*$/);
    types.push(pm ? (pm[1] + (pm[2] || '')).replace(/\s+/g, ' ').trim() : p);
  }
  return types;
}

/** 把 JS 值按 C 参数类型生成 C 字面量（带类型强转，编译器按声明类型校验） */
export function cArgLiteral(v: unknown, type: string): string {
  const t = type.replace(/^(const|volatile|restrict|register)\s+/, '').trim();
  if (/^(?:const\s+)?char\s*\*/.test(t)) return v == null ? '((char*)0)' : `((char*) "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
  if (/^bool$|^_Bool$/.test(t)) return v ? 'true' : 'false';
  if (/^char$/.test(t)) {
    const s = String(v ?? '');
    return s.length > 0 ? `'${s[0].replace("'", "\\'")}'` : '0';
  }
  if (/^(?:unsigned\s+|signed\s+)?(?:long\s+|long\s*long\s+|short\s+)?int\b|^long(?: long)?\b|^short\b|^(?:unsigned|signed)\b/.test(t)) {
    return `((${type}) ${String(Math.trunc(Number(v) || 0))})`;
  }
  if (/^(?:float|double)\b/.test(t)) return `((${type}) ${String(Number(v) || 0)})`;
  if (/^void\b/.test(t)) return '((void) 0)';
  // 指针 / struct / 未知 → 0 强转，由编译期 flag -Werror 之外的常规编译兜底（不自作聪明）
  return `((${type}) 0)`;
}

/**
 * 生成 C 行为 harness（纯函数）：目标函数 + 参数类型声明后移 + main 逐 case 调用（管道行协议）。
 * 适用面（诚实标注）：自包含的顶层函数、参/返可为整/浮/字符/字符串/指针；返回值统一 %zu 打印。
 */
export function cHarnessSource(spec: BehaviorSpec, paramTypes: string[]): string {
  const cases = spec.cases.map((c) => {
    const args = (c.args ?? []).map((a, i) => cArgLiteral(a, paramTypes[i] ?? 'int')).join(', ');
    // C 字符串字面量：只转义双引号，保留单个反斜杠的 \n（C 换行转义）；不用 JSON.stringify（会把 \ 变 \\）
    const fmt = `"${String(c.name).replace(/"/g, '\\"')}|1|%zu\\n"`;
    return `  printf(${fmt}, (size_t) (${spec.function}(${args})));`;
  }).join('\n');
  return `#include <stdio.h>
#include <stddef.h>
#include <stdint.h>

/* 目标函数由同目录 target.c 提供 */
int main(void) {
${cases}
  return 0;
}
`;
}

/** C：生成 harness.c + 目标函数一起编译运行；无 cc/gcc → 报不可用 */

/** 按目标文件语言分支执行 harness */

// ── 基线路径规则 ─────────────────────────────────────────────

/** 默认基线路径：<project_dir>/.agent-io/behavior/<file>__<func>.json */
export function baselinePathFor(project_dir: string, file: string, func: string): string {
  const safe = file.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/\.[^.]+$/, '');
  return path.join(project_dir, DATA_DIR_NAME, 'behavior', `${safe}__${func}.json`);
}

// ── capture / verify ─────────────────────────────────────────

/** capture：真跑一次当前代码，把行为快照落盘为基线 */
export function captureBaseline(spec: BehaviorSpec, baselinePath?: string): BehaviorBaseline {
  if (spec.cases.length === 0) {
    throw new Error('capture 需要至少一个金丝雀用例（cases）：没有样例输入，行为无从定义。');
  }
  const run = runHarness(spec);
  if (run.error) throw new Error(`capture 失败：${run.error}`);
  const bp = path.resolve(baselinePath ?? baselinePathFor(spec.project_dir, spec.file, spec.function));
  const { project_dir: _pd, ...specRest } = spec;
  const baseline: BehaviorBaseline = {
    spec: specRest,
    file_hash: run.file_hash,
    generated_at: new Date().toISOString(),
    source: run.source,
    stdout: run.stdout,
    results: run.results,
    baseline_path: bp,
  };
  fs.mkdirSync(path.dirname(bp), { recursive: true });
  fs.writeFileSync(bp, JSON.stringify(baseline, null, 2), 'utf-8');
  return baseline;
}

export interface VerifyResult {
  baseline: BehaviorBaseline;
  run: BehaviorRun;
  diff: BehaviorDiff;
  baseline_path: string;
}

/** verify：读基线 + 对当前磁盘再跑同一份 harness，逐 case 对比 */
export function verifyBaseline(spec: BehaviorSpec, baselinePath?: string): VerifyResult {
  const bp = path.resolve(baselinePath ?? baselinePathFor(spec.project_dir, spec.file, spec.function));
  if (!fs.existsSync(bp)) {
    throw new Error(`行为基线不存在：${bp}。请先对同一 file+function 执行 capture。`);
  }
  const baseline = JSON.parse(fs.readFileSync(bp, 'utf-8')) as BehaviorBaseline;
  const run = runHarness(spec);
  const before: BehaviorRun = {
    file_abs: run.file_abs,
    file_hash: baseline.file_hash,
    source: baseline.source,
    stdout: baseline.stdout,
    results: baseline.results,
  };
  return { baseline, run, diff: diffRuns(before, run), baseline_path: bp };
}

// ── 纯函数 diff（可单测，不碰进程） ──────────────────────────

/** 对比两次 harness 运行。逐 case 对齐（按 case 名），stdout 痕迹另算一条。 */
export function diffRuns(before: BehaviorRun, after: BehaviorRun): BehaviorDiff {
  if (before.error || after.error) {
    const e = before.error ?? after.error;
    return { verdict: 'error', matched: 0, changed: 0, details: [], message: `存在进程级失败，无法对比：${e}` };
  }
  const details: CaseDiff[] = [];
  const byName = new Map(after.results.map((r) => [r.case, r]));
  for (const b of before.results) {
    const a = byName.get(b.case);
    if (!a) {
      details.push({ case: b.case, status: 'changed', before: b.ok ? b.ret : b.error, before_error: b.ok ? undefined : b.error, after_error: 'verify 未跑该 case' });
      continue;
    }
    if (b.ok !== a.ok) {
      details.push({
        case: b.case, status: 'changed',
        before: b.ok ? b.ret : undefined, before_error: b.ok ? undefined : b.error,
        after: a.ok ? a.ret : undefined, after_error: a.ok ? undefined : a.error,
      });
    } else if (b.ok && b.ret !== a.ret) {
      details.push({ case: b.case, status: 'changed', before: b.ret, after: a.ret });
    } else if (!b.ok && b.error !== a.error) {
      details.push({ case: b.case, status: 'changed', before_error: b.error, after_error: a.error });
    } else {
      details.push({ case: b.case, status: 'same' });
    }
  }
  // stdout 痕迹（print 副作用）也算行为：变了 → 归 diff
  if (before.stdout !== after.stdout) {
    details.push({ case: '(stdout)', status: 'changed', before: before.stdout, after: after.stdout });
  }
  const changed = details.filter((d) => d.status === 'changed').length;
  const matched = before.results.length;
  const verdict: BehaviorVerdict = changed > 0 ? 'diff' : 'same';
  const message =
    verdict === 'same' ? `行为一致：${matched} 个 case 全部 same（含 stdout）` : `行为差异：${changed}/${matched} 个 case 变化`;
  return { verdict, matched, changed, details, message };
}


// ─────────────────────────────────────────────────────────────
// 语言包（2026-10-05，P6 之后的可扩展性收口）
//
// 动机是**实打实的重复成本**：2026-10-05 那次"把工具链缺失提示改好"要改 **5 个调用点**
// —— 因为 6 个 harness 各自抄了一份「读文件→算 hash→查工具链→建临时工程→跑→解析→清理→拼返回」。
// ⇒ 收成「**共享执行器（纪律）+ 语言包（差异）**」。与 `refactor_langs` / `observe_langs` 同一形态。
//
// ★ 结构性收益一（**这是本笔的真正价值，不是省行数**）：
//   原先 **3 个 harness 缺 `r.signal` 检查**（go / csharp / c）。而 python 那里写着：
//     「超时被终止时 Node 会同时置 error=ETIMEDOUT 与 signal=SIGTERM —— 必须先判 signal」
//   ⇒ 那 3 个语言会把**超时误报成"执行异常"**，且没有任何测试能发现（都要真跑一遍才撞上）。
//   现在 signal-then-error 的顺序**只存在于共享执行器里一处** ⇒ 这种分叉**不可能再发生**。
//
// ★ 结构性收益二：加一门语言 = **加一个包对象**（不是改 switch + 改 if 链 + 改 5 处提示文案）。
//   仍需新写的只有**该语言的金丝雀反射源码**（`harnessSource` 那类）—— 那是真正不可复用的部分。
// ─────────────────────────────────────────────────────────────

/** 一门语言在"行为基线"里的适配包。 */
interface BehaviorLangPack {
  lang: BehaviorLang;
  /** 命中的扩展名（`langOfFile` 与 `missingLanguageHint` 都读它 ⇒ 单一事实源） */
  exts: string[];
  /** 工具链探测：null = 可用；否则给出可执行原因（进 `missingToolchainHint`）。 */
  toolchain(): string | null;
  /** 该语言的默认超时（Go 编译慢，单独放宽）。 */
  timeoutMs(spec: BehaviorSpec): number;
  /** 写临时工程 → 返回「可选编译步骤 + 怎么跑」。 */
  build(ctx: BuildCtx): BuiltPlan;
  /** 解析 harness 输出。返回 `{error}` 即视为失败。 */
  parse(stdout: string): BehaviorSampleResult[] | { error: string };
  /** 跑挂（spawn 层面失败）时的文案。 */
  execError(e: unknown): string;
  /** 语言专属的前置检查（如 C# 缺输出有效性）。返回错误串则直接失败。 */
  postCheck?(stdout: string): string | null;
}

interface BuildCtx {
  /** 临时目录（执行器已建好）。 */
  tmp: string;
  spec: BehaviorSpec;
  /** 目标文件全文（不存在则空串）。 */
  content: string;
  /** 目标文件绝对路径。 */
  targetAbs: string;
  /** 写文件（相对临时目录，**自动建父目录**）。 */
  write(rel: string, content: string): void;
}

interface BuiltPlan {
  /** 可选的编译/构建步骤（javac / cc）。 */
  compile?: { cmd: string; args: string[]; errPrefix: string };
  run: { cmd: string; args: string[]; cwd?: string };
}

/** 失败时的统一返回形状（6 处曾各抄一份）。 */
function failRun(fileAbs: string, hash: string, error: string): BehaviorRun {
  return { file_abs: fileAbs, file_hash: hash, source: '', stdout: '', results: [], error };
}

/**
 * 共享执行器：所有语言跑 harness 的**同一条纪律**。
 * 顺序是刻意排的，见 {@link BehaviorLangPack} 上方关于 `r.signal` 的说明。
 */
function runWithLangPack(spec: BehaviorSpec, pack: BehaviorLangPack): BehaviorRun {
  const targetAbs = path.resolve(spec.project_dir, spec.file);
  let content = '';
  try {
    content = fs.readFileSync(targetAbs, 'utf-8');
  } catch {
    // 文件缺失：哈希取空串，进程级失败信息由 harness 自身给出（6 个 harness 原本都是这个约定）
  }
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);

  const issue = pack.toolchain();
  if (issue) return failRun(targetAbs, hash, missingToolchainHint(pack.lang, issue, TOOLCHAIN_INSTALL[pack.lang] ?? ''));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dc-beh-${pack.lang}-`));
  try {
    const plan = pack.build({ tmp, spec, content, targetAbs, write: (rel, c) => {
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c, 'utf-8');
      } });

    if (plan.compile) {
      const c = spawnSync(plan.compile.cmd, plan.compile.args, { cwd: tmp, encoding: 'utf-8', timeout: pack.timeoutMs(spec), windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      if (c.status !== 0) {
        return failRun(targetAbs, hash, `${plan.compile.errPrefix}失败: ${firstLine(c.stderr) || firstLine(c.stdout) || `退出码 ${c.status}`}`);
      }
    }

    const r = spawnSync(plan.run.cmd, plan.run.args, { cwd: plan.run.cwd ?? tmp, encoding: 'utf-8', timeout: pack.timeoutMs(spec), windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

    // ★ 顺序要紧：超时被终止时 Node **同时**置 error=ETIMEDOUT 与 signal=SIGTERM。
    //   先判 error 会把"死循环/环境卡顿"这个硬信号误报成"语言不可用"（python 处的原注释）。
    if (r.signal) return failRun(targetAbs, hash, `运行超时被终止（${r.signal}）—— 目标函数可能是死循环或环境卡顿`);
    if (r.error) return failRun(targetAbs, hash, pack.execError(r.error));

    const stdout = `${r.stdout || ''}`;
    const post = pack.postCheck?.(stdout);
    if (post) return failRun(targetAbs, hash, post);

    const parsed = pack.parse(stdout);
    if ('error' in parsed) return failRun(targetAbs, hash, parsed.error);
    return { file_abs: targetAbs, file_hash: hash, source: '', stdout: '', results: parsed };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Windows 留给 OS
    }
  }
}

function firstLine(s: string | undefined | null): string {
  return `${s ?? ''}`.trim().split(/\r?\n/).filter(Boolean)[0] ?? '';
}

/** 末行 JSON 解析（python / node / go / java 原本各抄一份）。 */
function parseJsonTail(stdout: string, langLabel: string): BehaviorSampleResult[] | { error: string } {
  const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let parsed: { results?: BehaviorSampleResult[]; error?: string };
  try {
    parsed = JSON.parse(last);
  } catch {
    return { error: `${langLabel} harness 输出解析失败: ${last.slice(0, 160)}` };
  }
  if (parsed.error) return { error: parsed.error };
  return parsed.results ?? [];
}

// ── 六个包 ─────────────────────────────────────────────────────────────

const pythonPack: BehaviorLangPack = {
  lang: 'python',
  exts: ['.py'],
  toolchain: () => toolchainIssue('python', undefined),
  timeoutMs: (spec) => spec.timeout_ms ?? 60_000,
  build: ({ spec, write }) => {
    // 单文件形态：harness 源码内联目标文件整体（顶层 exec，模块级依赖可用）
    write('main.py', harnessSource(spec));
    return { run: { cmd: PY, args: ['main.py'] } };
  },
  parse: (s) => parseJsonTail(s, 'python'),
  execError: (e) => `python 不可用/执行异常: ${(e as Error).message}`,
};

const nodePack: BehaviorLangPack = {
  lang: 'node',
  exts: [...NODE_EXTS],
  toolchain: () => toolchainIssue('node', undefined),
  timeoutMs: (spec) => spec.timeout_ms ?? 60_000,
  build: ({ spec, content, targetAbs, write }) => {
    const tr = transpileToCjs(targetAbs, content);
    if ('error' in tr) throw new Error(tr.error); // 交由执行器的 finally 清理
    write('target.cjs', tr.js);
    write('runner.mjs', nodeRunnerSource(spec));
    return { run: { cmd: process.execPath, args: ['runner.mjs', 'target.cjs'] } };
  },
  parse: (s) => parseJsonTail(s, 'node'),
  execError: (e) => `node 不可用/执行异常: ${(e as Error).message}`,
};

const goPack: BehaviorLangPack = {
  lang: 'go',
  exts: [...GO_EXTS],
  toolchain: () => toolchainIssue('go', '1.21'),
  timeoutMs: (spec) => spec.timeout_ms ?? 120_000, // 编译慢，单独放宽
  build: ({ spec, content, write }) => {
    write('go.mod', 'module harness\n\ngo 1.21\n');
    write('x/x.go', rewritePackageClause(content, 'x'));
    write('main.go', goRunnerSource(spec));
    return { run: { cmd: 'go', args: ['run', '.'] } };
  },
  parse: (s) => parseJsonTail(s, 'go'),
  execError: (e) => `go 执行异常: ${(e as Error).message}`,
};

const javaPack: BehaviorLangPack = {
  lang: 'java',
  exts: [...JAVA_EXTS],
  toolchain: () => toolchainIssue('java', '1.8'),
  timeoutMs: (spec) => spec.timeout_ms ?? 60_000,
  build: ({ spec, content, targetAbs, write }) => {
    const className = path.basename(targetAbs).replace(/\.java$/i, '');
    write(`p/${className}.java`, rewritePackageClause(content, 'p'));
    write('p/Main.java', javaRunnerSource(spec, className));
    return {
      compile: { cmd: 'javac', args: ['-encoding', 'UTF-8', '-d', 'p', `p/${className}.java`, 'p/Main.java'], errPrefix: 'Java 编译' },
      run: { cmd: 'java', args: ['-cp', 'p', 'p.Main'] },
    };
  },
  parse: (s) => parseJsonTail(s, 'java'),
  execError: (e) => `java 不可用/执行异常: ${(e as Error).message}`,
};

const csharpPack: BehaviorLangPack = {
  lang: 'csharp',
  exts: [...CS_EXTS],
  toolchain: () => toolchainIssue('csharp', '6.0'),
  timeoutMs: (spec) => spec.timeout_ms ?? 120_000, // dotnet 首次还原慢
  build: ({ spec, content, targetAbs, write }) => {
    const className = path.basename(targetAbs).replace(/\.cs$/i, '') || 'Target';
    write('harness.csproj', csProjSource());
    write('Target.cs', content);
    write('Program.cs', csRunnerSource(spec, className));
    return { run: { cmd: 'dotnet', args: ['run', '--project', '.', '-v', 'q'] } };
  },
  // C# 走管道行协议（不是末行 JSON）—— 原实现如此，保持不变
  parse: (s) => parsePipeLines(s),
  execError: (e) => `dotnet 执行异常: ${(e as Error).message}`,
  postCheck: (s) => {
    if (s.includes('ERR|fn-not-found')) return 'top-level function not found（该语言要求顶层函数）';
    if (s.trim() !== '' && !s.includes('|')) return 'dotnet harness 无有效输出';
    return null;
  },
};

const cPack: BehaviorLangPack = {
  lang: 'c',
  exts: [...C_EXTS],
  // C 认 cc 或 gcc（任一可用即可）—— 保留原有的"二选一"语义
  toolchain: () => (toolAvailable('cc') || toolAvailable('gcc') ? null : '未安装'),
  timeoutMs: (spec) => spec.timeout_ms ?? 60_000,
  build: ({ spec, content, targetAbs, tmp, write }) => {
    const fn = path.basename(targetAbs);
    const paramTypes = cParamTypes(content, spec.function);
    if (!paramTypes.length) throw new Error(`无法从源码推断目标函数 ${spec.function} 的参数类型（C 无类型反射）`);
    write('target.c', content);
    write('harness.c', cHarnessSource(spec, paramTypes));
    return {
      compile: { cmd: toolAvailable('cc') ? 'cc' : 'gcc', args: ['-w', '-o', 'a.out', 'harness.c', 'target.c'], errPrefix: 'C 编译' },
      run: { cmd: path.join(tmp, 'a.out'), args: [], cwd: tmp },
    };
  },
  parse: (s) => parsePipeLines(s),
  execError: (e) => `C 运行失败: ${(e as Error).message}`,
};

/** 全部语言包（★ 单一事实源：扩展名、工具链、跑法、解析法都在这里）。 */
const BEHAVIOR_PACKS: readonly BehaviorLangPack[] = [pythonPack, nodePack, goPack, javaPack, csharpPack, cPack];

function packOf(lang: BehaviorLang): BehaviorLangPack {
  const p = BEHAVIOR_PACKS.find((x) => x.lang === lang);
  if (!p) throw new Error(`内部不一致：语言包表里没有 ${lang}`);
  return p;
}

/** 按文件扩展名判定 harness 语言（未知扩展 → 抛错，不静默猜）。 */
export function langOfFile(file: string): BehaviorLang {
  const ext = path.extname(file).toLowerCase();
  for (const p of BEHAVIOR_PACKS) if (p.exts.includes(ext)) return p.lang;
  const supported = BEHAVIOR_PACKS.map((p) => p.exts.map((e) => (e === '.py' || e === '.go' || e === '.java' || e === '.cs' || e === '.c' ? e : e)).join(' / ')).join(' / ');
  throw new Error(
    `不支持的脚本语言（${ext}）：行为基线支持 ${supported}。${missingLanguageHint(ext, 'behavior_baseline')}`,
  );
}

/** 按目标文件语言分支执行 harness（★ 表驱动，不再是 switch）。 */
export function runHarness(spec: BehaviorSpec): BehaviorRun {
  return runWithLangPack(spec, packOf(langOfFile(spec.file)));
}
