/**
 * upgrade_cli：版本升级契约差检测 · CLI 入口
 *
 * ★ 2026-10-06（T15）：本文件已**退化成薄壳** —— 能力（五阶段检测 + 渲染 + 结构化产物）归位到
 *   `application/meta/upgrade/upgrade.ts`，与 MCP 工具 `upgrade`（`action=scan`）**同一个实现**。
 *   ⇒ 本文件只做"argv → 调用 → 打印"，**不再持有任何判据**（留一份在这里就是第二份口径）。
 *
 * 用法：
 *   node dist/src/tools/upgrade_cli.js [root] [--json] [--gate] [--dynamic]
 *
 * 能力（五阶段，逐条见能力层头注）：
 *   阶段 A 工具链版本盘点 · 阶段 B 语言特性契约差 · 阶段 C 废弃/移除 API
 *   · 阶段 D（--gate）静态闸 · 阶段 E（--dynamic）动态闸。
 *   只做报告、不做改写 —— 改写走 `upgrade_rewrite_cli` / MCP 的 `action=apply`。
 */
import path from 'node:path';
import { runUpgradeScan } from '../../application/meta/upgrade/upgrade.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] ?? process.cwd());
  const r = await runUpgradeScan(root, { gate: args.includes('--gate'), dynamic: args.includes('--dynamic') });
  // eslint-disable-next-line no-console
  console.log(args.includes('--json') ? JSON.stringify(r.data, null, 2) : r.lines.join('\n'));
}

void main();
