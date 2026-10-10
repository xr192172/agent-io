#!/usr/bin/env node
/**
 * verify —— **本仓唯一的总门**（2026-10-05 新增，此前没有）
 *
 * ★ 为什么加它（不是"锦上添花"，是补一个结构性缺口）：
 *   加它之前，本仓 26 条 npm script 里**没有 `test`，也没有任何测试框架**；
 *   实际能挡住回归的只有 `tsc` 与 `mcp_scan` 两道，而**每次都是人手敲**——
 *   于是"跑一遍看看"没有单一入口，漏跑不会有人知道。
 *   这直接解释了本仓多起"声明了但没人接线"的问题：704 行 TS 移植从未接线、
 *   `SilentErrorDiscard` 三份、`observe-lang-go/build/` 死路径、缺二进制时 `loop-skipped` 静默失效
 *   —— **这些全都可能是"没人跑门"的结果，而不是"跑了没发现"。**
 *
 * ★ 三态而不是两态（本仓反复犯的病是"缺工具链就静默跳过 ⇒ 假绿灯"，这里不能重犯）：
 *     PASS  门通过
 *     FAIL  门失败 ⇒ 退出码 1
 *     SKIP  门**跑不了**（缺工具链等）⇒ 退出码 **2**（刻意与 PASS 的 0 区分开）
 *   ⇒ **`npm run verify` 返回 0 的含义被收紧为"每一道门都真的跑过并通过"**，
 *     含 Go 的机器才能拿到 0；没装 Go 的机器拿到 2，而不是"看起来全绿"。
 *
 * ★ 2026-10-10 订正（原文写「刻意不把 `structure_gap` 算进判定：它的结尾是 `process.exit(0)`（无条件）
 *   ⇒ 永远不可能失败」——**该前提已不成立**）：`structure_gap.mjs` 现在**按判据（`clean`）退非 0**。
 *   它仍列在**报告区**（`kind:'report'`）只为两件事：① 通过时打印它的正文；② **门计数仍是 5**
 *   （`total` 只数 `kind:'gate'`）。★ 但它的 FAIL **照常计入** —— 计数循环对 FAIL **一律** `fail++`（与 `kind` 无关）
 *   ⇒ **结构不一致时，verify 会退 1**（这正是不再给"结构已核对"假安全感）。
 *
 * ★★ 2026-10-06（T61）ts 门**不再走 `npx`**：实测 `typescript` 未安装时 `npx tsc` 会取到 npm 上
 *   同名的 **`tsc` 占位包**（只打印「This is not the tsc command you are looking for」）并**退出 0**
 *   ⇒ 这道门会**报 PASS 却什么都没编译**（本仓最反对的假绿灯，而且发生在**总门自己**身上）。
 *   现改为直接调**本地编译器**（路径见 `localTsc`），且拿不到编译器时 **FAIL 而不是 SKIP**：
 *   SKIP（退出 2）是留给**可选的外部工具链**（如 Go）的，而 typescript 是**本仓自己的 devDependency**，
 *   缺它 = 依赖没装 = 环境坏了 ⇒ 总门必须响。
 *   ★★ **不要"顺手加个 npx 兜底"** —— 那等于把假绿灯装回来。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

/** @typedef {{name:string, cmd?:string, args?:string[], cwd?:string, kind:'gate'|'report', need?:string, why?:string, fail?:string, shell?:boolean}} Gate */

/** 以**本文件**为基准做模块解析（与 `npm run` 的 cwd 无关）。 */
const requireFromHere = createRequire(import.meta.url);

/**
 * 取本地 `tsc` 的绝对路径；拿不到返回 `null`（= 依赖没装）。
 *
 * ★ 为什么不硬编码 `node_modules/typescript/bin/tsc`：依赖被 hoist 到上层、或用 pnpm 的
 *   符号链接布局时会指错。交给 Node 的模块解析，三种布局都对。
 * ★ 也**不**直取子路径 `typescript/bin/tsc`（虽然当前可用）：那押注"typescript 将来不加 `exports`"，
 *   一旦它加了且未导出 `./bin/tsc` 就会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
 *   而 `resolve('typescript')` 走**主入口**（`main` 或 `exports['.']` 都命中）⇒ 长期可解析。
 *   再按"`bin/` 与 `lib/` 是兄弟目录"这一极稳定的布局取 `../bin/tsc`，并用 `existsSync` 兜底。
 */
function localTsc() {
  try {
    const entry = requireFromHere.resolve('typescript'); // .../typescript/lib/typescript.js
    const bin = path.resolve(path.dirname(entry), '..', 'bin', 'tsc');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * ts 门（**惰性构造**：命令要按环境解析 —— 找不到编译器时直接给出 `fail`，见 {@link localTsc}）。
 *
 * 命令用 `process.execPath` 跑 tsc 的 JS 入口：**不经 `.bin` shim、不经 shell**
 * （Windows 上少两层可控性；shim 缺失也不会误判成"没装编译器"）。
 */
function tsGate() {
  const tsc = localTsc();
  if (!tsc) {
    return {
      name: 'ts 类型',
      kind: 'gate',
      fail:
        'typescript 未安装（本仓 devDependency，不是可选工具链）⇒ 先跑 `npm install`。' +
        '★ 不要改成 `npx tsc` 兜底：typescript 缺失时 npx 会取到 npm 上的 **tsc 占位包**并以 0 退出 ⇒ 假绿灯（T61）。',
    };
  }
  return {
    name: 'ts 类型',
    kind: 'gate',
    cmd: process.execPath,
    args: [tsc, '--noEmit'],
    // ★★ `shell: false` 是**必须的，不要删**（2026-10-06 实测撞出来）：
    //   本仓其余门在 Windows 上需要 `shell:true`（`go` / `npx` 是 `.cmd`/`.bat`，不带 shell 找不到），
    //   但这一门用的是 `process.execPath` —— 它在本机是 `C:\Program Files\nodejs\node.exe`，
    //   **路径含空格**，经 cmd.exe 会被截成 `C:\Program` ⇒ 报「'C:\Program' is not recognized…」、
    //   门在 13ms 内以"退出码 1"失败（看着像类型错，其实是**没跑起来**）。
    //   直接 spawn（不走 shell、参数逐项传递）⇒ 含空格的路径安全。
    shell: false,
    why: '类型错 ⇒ 运行时必错（本地编译器，非 npx）',
  };
}

/** ★ 元素可以是 `Gate`，也可以是 `() => Gate`（惰性：命令要按环境解析）。 */
/** @type {Array<Gate|(() => Gate)>} */
const GATES = [
  tsGate, // ★ 惰性：tsc 路径按环境解析；拿不到编译器 ⇒ 该门 `fail`（T61）
  { name: 'MCP 工具签名', kind: 'gate', cmd: 'node', args: ['scripts/mcp/mcp_scan.mjs'], why: '61 个工具的入参/出参契约（坏签名 ⇒ LLM 一定调错）。★ 需先有 dist/：它走 CLI 入口（CLI 不做 zod 校验，守卫接没接上只有这里看得见）。★ 2026-10-08 更正 why 里的旧数 59（实测 61）。' },
  { name: 'b 项契约占位符', kind: 'gate', cmd: 'node', args: ['scripts/measure_b_contract.mjs'], why: '量具：有未定义占位符即失败' },
  { name: 'Go 编译', kind: 'gate', cmd: 'go', args: ['build', './...'], cwd: 'observe-lang-go', need: 'go', why: '★ Go 语言包（observe-lang-go）此前**零门**：它一直是 TS 侧之外的盲区（go.mod 无 require ⇒ 标准库项目）' },
  { name: 'Go 静态检查', kind: 'gate', cmd: 'go', args: ['vet', './...'], cwd: 'observe-lang-go', need: 'go', why: '同上；vet 过了才谈得上"改 Go 代码有反馈"' },
  { name: '结构意图 gap', kind: 'report', cmd: 'node', args: ['scripts/structure_gap.mjs'], why: '★ 2026-10-10 起**能失败**：它已按判据（clean）退非 0。列在报告区=通过时打印正文、且不进"5 道门"计数；但 FAIL 照常计入（结构不一致 ⇒ verify 退 1）' },
];

const has = (b) => { try { return spawnSync(b, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0; } catch { return false; } };

function run(g) {
  // ★ 构造期已注定失败的门（如"本地编译器没装"）—— 优先于 need，且**是 FAIL 不是 SKIP**
  if (g.fail) return { state: 'FAIL', why: g.fail, out: '' };
  if (g.need && !has(g.need)) return { state: 'SKIP', why: `缺 ${g.need} 工具链` };
  const cwd = g.cwd ? path.join(ROOT, g.cwd) : ROOT;
  if (g.cwd && !existsSync(cwd)) return { state: 'SKIP', why: `目录不存在：${g.cwd}` };
  // ★ 逐门可覆盖 `shell`：默认在 Windows 上开（`go`/`npx` 是 `.cmd`，不带 shell 找不到），
  //   但含空格的绝对路径（如 `process.execPath`）必须 `shell:false`，否则被 cmd 截断 —— 见 `tsGate`。
  const shell = g.shell ?? process.platform === 'win32';
  const r = spawnSync(g.cmd, g.args, { cwd, encoding: 'utf8', shell, maxBuffer: 32 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { state: 'FAIL', why: r.error.message, out };
  if (r.status !== 0) return { state: 'FAIL', why: `退出码 ${r.status}`, out };
  return { state: 'PASS', why: '', out };
}

console.log(`${C.b}verify —— 本仓唯一的总门${C.x}  ${C.d}（三态；返回 0 = 每一道门都真跑过并通过）${C.x}\n`);

// 惰性门在此刻定型（元素可能是函数）；此后一律按定型后的数组走。
const gates = GATES.map((g) => (typeof g === 'function' ? g() : g));

let fail = 0;
let skip = 0;
const tail = [];
for (const g of gates) {
  const t0 = Date.now();
  const r = run(g);
  const ms = Date.now() - t0;
  const tag = r.state === 'PASS' ? `${C.g}PASS${C.x}` : r.state === 'FAIL' ? `${C.r}FAIL${C.x}` : `${C.y}SKIP${C.x}`;
  const label = (g.kind === 'report' ? `${C.d}[报告]${C.x} ` : '') + g.name;
  console.log(`  ${tag}  ${label.padEnd(20)} ${C.d}${String(ms).padStart(5)}ms  ${r.why}${C.x}`);
  if (r.state === 'FAIL') { fail++; if (r.out) tail.push(`${C.r}── ${g.name} 输出 ──${C.x}\n${r.out.slice(0, 4000)}`); }
  if (r.state === 'SKIP') skip++;
  if (r.state === 'PASS' && g.kind === 'report' && r.out) tail.push(`${C.d}── ${g.name}（报告区：通过时打印正文；失败照常计入）──${C.x}\n${r.out.slice(0, 3000)}`);
}

console.log('');
if (tail.length) console.log(tail.join('\n\n') + '\n');

const total = gates.filter((g) => g.kind === 'gate').length;
const line = fail ? `${C.r}${fail} 道门失败${C.x}` : skip ? `${C.y}${skip} 道门没跑成（SKIP）${C.x}` : `${C.g}全部 ${total} 道门通过${C.x}`;
console.log(line);
if (fail) process.exit(1);
if (skip) {
  console.log(`${C.y}⇒ 退出码 2（刻意区别于 0）：有门没跑成，不等于"没问题"。${C.x}`);
  process.exit(2);
}
