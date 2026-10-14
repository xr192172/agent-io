#!/usr/bin/env node
/**
 * cert: 骨架「④ sink 契约 + ⑤ 错误传播」的可执行验收
 *
 * ## 为什么有这个脚本（而不是"两边各写单测"）
 * 本仓 **TS 侧没有任何测试框架**（26 条 npm script 里没有 `test`，总门 `verify.mjs` 只有 `tsc` + `mcp_scan`）
 * ⇒ "两边各写单测"在 TS 侧**做不到**。
 * ⇒ 而本仓**已有范式**：`certs/*.mjs`（可执行验收脚本）⇒ 本脚本就是它的一员。
 *
 * ## 验的是哪两格（骨架六格里的 ④⑤）
 *   ④ **接 sink 契约**：**探针就位 ≠ 有数据** —— 无 sink 时 `captureProbe`/`Capture` 是 **no-op**（0 事件、不报错）；
 *      接上 sink 才出事件。
 *   ⑤ **错误传播**：**探针不许抛错，但错误必须可见** —— 宿主不能因探针抛错而崩；
 *      而"sink 写不出去"这件事**必须说出来**（stderr），不许静默吞。
 *
 * ## 判据（每条都直接看"事实"，不看回执）
 *   · 无 sink ⇒ events 文件**不存在**；
 *   · 有 sink ⇒ events 文件**存在且行数 > 0**；
 *   · sink 不可写 ⇒ **宿主退出码 0**（不崩）**且 stderr 有输出**（可见）。
 *
 * 用法：`node certs/observe-skeleton-cert.mjs`
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 必须转成 file:// URL —— ESM 的 import 不支持 Windows 绝对路径（`D:\…`）
//   （实测：直接写绝对路径会 ERR_UNSUPPORTED_ESM_URL_SCHEME ⇒ 本脚本第一版就栽在这）
const PROBE = pathToFileURL(path.join(REPO, 'dist/src/infrastructure/analysis/observe/probe.js')).href;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
}

// 用**临时目录**当工作区（不污染仓库）；★ 用 os.tmpdir() 而非 /tmp（Git Bash 的 /tmp 是 MSYS 虚拟路径）
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'observe-skeleton-cert-'));

function runCase(label, sinkPath) {
  const runner = path.join(work, `runner-${label}.mjs`);
  fs.writeFileSync(
    runner,
    `import { setGlobalProbeSink, captureProbe, TSProbeCapture } from ${JSON.stringify(PROBE)};\n` +
      (sinkPath
        ? `setGlobalProbeSink(new TSProbeCapture(${JSON.stringify(sinkPath)}));\n`
        : '') +
      `captureProbe('cert.probe', { a: 1 });\n` +
      `console.log('HOST_OK');\n`,
    'utf8',
  );
  const r = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  // ★ 失败时把 stderr 打出来 —— 否则"脚本自己坏了"会被误读成"产品坏了"（本脚本第一版就是这样）
  if (r.status !== 0 && !(r.stdout ?? '').includes('HOST_OK')) {
    console.log(`    [诊断] runner(${label}) exit=${r.status}`);
    console.log(`    [诊断] stderr 首行: ${(r.stderr ?? '').split('\n')[0]}`);
  }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

console.log('=== 骨架验收：④ sink 契约 + ⑤ 错误传播（TS 侧）===');

// ── ④-1：无 sink ⇒ 零事件、不报错 ──
{
  const noSinkEvents = path.join(work, 'no-sink.jsonl');
  const r = runCase('nosink', null);
  check(
    '④-1 无 sink ⇒ 不产生 events 文件（"探针就位 ≠ 有数据"）',
    !fs.existsSync(noSinkEvents) && r.code === 0,
    `exit=${r.code} events存在=${fs.existsSync(noSinkEvents)}`,
  );
}

// ── ④-2：有 sink ⇒ 出事件 ──
{
  const okEvents = path.join(work, 'ok.jsonl');
  const r = runCase('ok', okEvents);
  const lines = fs.existsSync(okEvents) ? fs.readFileSync(okEvents, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  check('④-2 接 sink ⇒ 出事件（行数 > 0）', r.code === 0 && lines > 0, `exit=${r.code} 行数=${lines}`);
}

// ── ⑤：sink 不可写 ⇒ 宿主不崩 且 stderr 有输出 ──
{
  // 把一个【已存在的文件】当目录用 ⇒ mkdir 必失败 ⇒ sink.emit 抛错
  const blocker = path.join(work, 'blocker-file');
  fs.writeFileSync(blocker, 'x', 'utf8');
  const badSink = path.join(blocker, 'events.jsonl');
  const r = runCase('badsink', badSink);
  const hostOk = r.code === 0 && r.stdout.includes('HOST_OK');
  const visible = r.stderr.includes('发不出去') || r.stderr.includes('probe');
  check('⑤-1 sink 不可写 ⇒ 宿主**不崩**（探针不许抛错）', hostOk, `exit=${r.code} stdout含HOST_OK=${r.stdout.includes('HOST_OK')}`);
  check('⑤-2 sink 不可写 ⇒ 错误**可见**（stderr 有输出，不静默吞）', visible, `stderr长度=${r.stderr.length}`);
}

fs.rmSync(work, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 结果：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  ✗ ${f.name} —— ${f.detail}`);
  process.exit(1);
}
console.log('★ ④ sink 契约与 ⑤ 错误传播两格：**行为符合骨架**。');
