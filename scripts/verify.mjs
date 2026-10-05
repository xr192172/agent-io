#!/usr/bin/env node
/**
 * verify —— **本仓唯一的总门**（2026-10-05 新增，此前没有）
 *
 * ★ 为什么加它（不是"锦上添花"，是补一个结构性缺口）：
 *   加它之前，本仓 26 条 npm script 里**没有 `test`，也没有任何测试框架**；
 *   实际能挡住回归的只有 `tsc` 与 `mcp_scan` 两道，而**每次都是人手敲**——
 *   于是"跑一遍看看"没有单一入口，漏跑不会有人知道。
 *   这直接解释了本仓多起"声明了但没人接线"的问题：704 行 TS 移植从未接线、
 *   `SilentErrorDiscard` 三份、`go-observe/build/` 死路径、缺二进制时 `loop-skipped` 静默失效
 *   —— **这些全都可能是"没人跑门"的结果，而不是"跑了没发现"。**
 *
 * ★ 三态而不是两态（本仓反复犯的病是"缺工具链就静默跳过 ⇒ 假绿灯"，这里不能重犯）：
 *     PASS  门通过
 *     FAIL  门失败 ⇒ 退出码 1
 *     SKIP  门**跑不了**（缺工具链等）⇒ 退出码 **2**（刻意与 PASS 的 0 区分开）
 *   ⇒ **`npm run verify` 返回 0 的含义被收紧为"每一道门都真的跑过并通过"**，
 *     含 Go 的机器才能拿到 0；没装 Go 的机器拿到 2，而不是"看起来全绿"。
 *
 * ★ 刻意**不**把 `structure_gap` 算进判定：实测它的结尾是 `process.exit(0)`（无条件）
 *   —— 把它当门会给 CI 一种"结构已核对"的假安全感。它只作为**报告**打印（--report-only 之外也打）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

/** @typedef {{name:string, cmd:string, args:string[], cwd?:string, kind:'gate'|'report', need?:string, why:string}} Gate */

/** @type {Gate[]} */
const GATES = [
  { name: 'ts 类型', kind: 'gate', cmd: 'npx', args: ['tsc', '--noEmit'], why: '类型错 ⇒ 运行时必错' },
  { name: 'MCP 工具签名', kind: 'gate', cmd: 'node', args: ['scripts/mcp/mcp_scan.mjs'], why: '59 个工具的入参/出参契约（坏签名 ⇒ LLM 一定调错）' },
  { name: 'b 项契约占位符', kind: 'gate', cmd: 'node', args: ['scripts/measure_b_contract.mjs'], why: '量具：有未定义占位符即失败' },
  { name: 'Go 编译', kind: 'gate', cmd: 'go', args: ['build', './...'], cwd: 'go-observe', need: 'go', why: '★ go-observe 此前**零门**：它一直是 TS 侧之外的盲区（go.mod 无 require ⇒ 标准库项目）' },
  { name: 'Go 静态检查', kind: 'gate', cmd: 'go', args: ['vet', './...'], cwd: 'go-observe', need: 'go', why: '同上；vet 过了才谈得上"改 Go 代码有反馈"' },
  { name: '结构意图 gap', kind: 'report', cmd: 'node', args: ['scripts/structure_gap.mjs'], why: '★ 只作报告：它的结尾是 process.exit(0)，**永远不可能失败** ⇒ 不计入判定' },
];

const has = (b) => { try { return spawnSync(b, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0; } catch { return false; } };

function run(g) {
  if (g.need && !has(g.need)) return { state: 'SKIP', why: `缺 ${g.need} 工具链` };
  const cwd = g.cwd ? path.join(ROOT, g.cwd) : ROOT;
  if (g.cwd && !existsSync(cwd)) return { state: 'SKIP', why: `目录不存在：${g.cwd}` };
  const r = spawnSync(g.cmd, g.args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { state: 'FAIL', why: r.error.message, out };
  if (r.status !== 0) return { state: 'FAIL', why: `退出码 ${r.status}`, out };
  return { state: 'PASS', why: '', out };
}

console.log(`${C.b}verify —— 本仓唯一的总门${C.x}  ${C.d}（三态；返回 0 = 每一道门都真跑过并通过）${C.x}\n`);

let fail = 0;
let skip = 0;
const tail = [];
for (const g of GATES) {
  const t0 = Date.now();
  const r = run(g);
  const ms = Date.now() - t0;
  const tag = r.state === 'PASS' ? `${C.g}PASS${C.x}` : r.state === 'FAIL' ? `${C.r}FAIL${C.x}` : `${C.y}SKIP${C.x}`;
  const label = (g.kind === 'report' ? `${C.d}[报告]${C.x} ` : '') + g.name;
  console.log(`  ${tag}  ${label.padEnd(20)} ${C.d}${String(ms).padStart(5)}ms  ${r.why}${C.x}`);
  if (r.state === 'FAIL') { fail++; if (r.out) tail.push(`${C.r}── ${g.name} 输出 ──${C.x}\n${r.out.slice(0, 4000)}`); }
  if (r.state === 'SKIP') skip++;
  if (r.state === 'PASS' && g.kind === 'report' && r.out) tail.push(`${C.d}── ${g.name}（报告，不计入判定）──${C.x}\n${r.out.slice(0, 3000)}`);
}

console.log('');
if (tail.length) console.log(tail.join('\n\n') + '\n');

const total = GATES.filter((g) => g.kind === 'gate').length;
const line = fail ? `${C.r}${fail} 道门失败${C.x}` : skip ? `${C.y}${skip} 道门没跑成（SKIP）${C.x}` : `${C.g}全部 ${total} 道门通过${C.x}`;
console.log(line);
if (fail) process.exit(1);
if (skip) {
  console.log(`${C.y}⇒ 退出码 2（刻意区别于 0）：有门没跑成，不等于"没问题"。${C.x}`);
  process.exit(2);
}
