#!/usr/bin/env node
/**
 * ts_kernel 单文件解析探针 —— 给定 (扩展名, 源码) 打印**内核真实读数**。
 *
 * 为什么留在仓里：补一门语言时，"这个扩展名到底解析出什么"是唯一的判据，
 * 而手搓 `node -e "…parseFileFull…"` 每次都要重写（还要躲开 ESM 裸包解析、
 * dist 路径、32KB 限制）。本脚本把它固化成一条命令，**路径无关**
 * （从脚本自身位置找仓根，不依赖 cwd / 不硬编码本仓路径）。
 *
 * 用法：
 *   node scripts/ts_kernel_probe.mjs <ext|文件名> [源码]
 *   node scripts/ts_kernel_probe.mjs .cpp 'int main(){ helper(); }'
 *   node scripts/ts_kernel_probe.mjs a.rb 'def main; helper; end'
 *   node scripts/ts_kernel_probe.mjs a.kt -        # 源码从 stdin 读
 *   node scripts/ts_kernel_probe.mjs --file path/to/src.cpp
 *   node scripts/ts_kernel_probe.mjs .cpp '…' --json
 *
 * 打印：symbols / imports / calls / type_refs 四个产出的逐条读数 + error（若有）。
 * 判据（补语言时）：一段含"定义 + 跨函数调用"的样本 ⇒ symbols 非空 **且** calls 非空。
 *
 * ★ 读的是 dist（与 MCP 工具同一条产物链）⇒ 改了 src 必须先 `npm run build`，
 *   否则看到的是旧逻辑（STALE BUILD，见 AGENTS.md「工具自检」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // 仓根 = 本脚本的上一级（路径无关）

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');

function usage(msg) {
  if (msg) console.error(`✗ ${msg}\n`);
  console.error(
    [
      '用法: node scripts/ts_kernel_probe.mjs <ext|文件名> [源码| - ] [--json]',
      '      node scripts/ts_kernel_probe.mjs --file <源文件路径> [--json]',
      '',
      "例:   node scripts/ts_kernel_probe.mjs .cpp 'int main(){ helper(); }'",
      "      node scripts/ts_kernel_probe.mjs a.rb 'def main; helper; end'",
      '      node scripts/ts_kernel_probe.mjs a.kt -   # 源码从 stdin 读',
    ].join('\n')
  );
  process.exit(2);
}

let filePath;
let source;

if (args[0] === '--file') {
  const p = args[1];
  if (!p) usage('--file 需要路径');
  filePath = path.basename(p);
  source = fs.readFileSync(p, 'utf-8');
} else {
  const target = args[0];
  if (!target) usage('缺 <ext|文件名>');
  // 只有扩展名（'.cpp'）时补一个虚拟文件名，让 parseFileFull 的 ext 判定有意义
  filePath = target.startsWith('.') && !target.includes('/') && !target.includes('\\') ? `probe${target}` : path.basename(target);
  const src = args[1];
  if (src === undefined) usage(`缺源码（或传 '-' 从 stdin 读）：${target}`);
  source = src === '-' ? fs.readFileSync(0, 'utf-8') : src;
}

// 动态 import（好让 STALE BUILD 的报错更清楚）
const entry = path.join(root, 'dist', 'src', 'tools', 'ts_kernel', 'index.js');
if (!fs.existsSync(entry)) {
  console.error(`✗ 找不到 ${entry}\n  先跑 npm run build（本探针读 dist，与 MCP 工具同一条产物链）。`);
  process.exit(2);
}
const { parseFileFull } = await import(pathToFileURL(entry).href);

const res = await parseFileFull(filePath, source);

if (asJson) {
  console.log(JSON.stringify({ file: filePath, ...res }, null, 2));
} else {
  const line = '─'.repeat(64);
  console.log(`${line}\nfile: ${filePath}   (${source.split('\n').length} 行 / ${source.length} 字符)`);
  if (res.error) console.log(`error: ${res.error}`);
  console.log(`\n[symbols] ${res.symbols.length} 条`);
  for (const s of res.symbols) {
    console.log(`  · ${s.qualified_name}  <${s.kind}>  L${s.start_line}-${s.end_line}  sig=${JSON.stringify(s.signature)}${s.parent ? `  parent=${s.parent}` : ''}${s.is_closure ? '  [closure]' : ''}`);
  }
  console.log(`\n[imports] ${res.imports.length} 条`);
  for (const i of res.imports) {
    console.log(`  · ${i.source}  <${i.kind}>  L${i.line}${i.type_only ? '  type_only' : ''}${i.bindings ? `  bindings=${JSON.stringify(i.bindings)}` : ''}`);
  }
  console.log(`\n[calls] ${res.calls.length} 条`);
  for (const c of res.calls) {
    console.log(`  · ${c.caller} -> ${c.callee}${c.callee_expr && c.callee_expr !== c.callee ? ` (expr=${c.callee_expr})` : ''}  L${c.line}  resolved=${c.resolved}${c.callee_qn ? `  qn=${c.callee_qn}` : ''}`);
  }
  console.log(`\n[type_refs] ${res.type_refs.length} 条`);
  for (const t of res.type_refs) {
    console.log(`  · ${t.referrer} -> ${t.type_name}  L${t.line}  resolved=${t.resolved}${t.target_qn ? `  qn=${t.target_qn}` : ''}`);
  }
  console.log(line);
}
