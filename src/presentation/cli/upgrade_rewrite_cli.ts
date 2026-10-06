/**
 * upgrade_rewrite_cli —— 版本升级契约差 · 局部重写闭环 CLI
 *
 * ★ 2026-10-06（T15）：能力归位到 `application/meta/upgrade/upgrade.ts`
 *   （与 MCP 工具 `upgrade` 的 `action=apply` **同一个实现**）。本文件只剩
 *   "argv → 读编辑 → 调用 → 打印"；★ 唯一留在壳里的是**从哪个文件读编辑**（那是 argv 侧的事）。
 *
 * 用法：
 *   node dist/src/tools/upgrade_rewrite_cli.js <root>
 *        [--apply <edits.json>]  进入闭环：应用编辑（JSON 形如 [{file, from, to}]）
 *        [--skip-verify]         跳过验证阶段（未验证则不自动提交）
 *        [--json]                末尾输出结构化报告
 *
 * 闭环阶段（实现在能力层）：差异报告 → 局部重写建议 → 应用 → 改前基线提交 → 验证 → 提交/回退。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runUpgradeApplyLoop, runUpgradePlanReport } from '../../application/meta/upgrade/upgrade.js';
import type { PlanEdit } from '../../infrastructure/authoring/version_upgrade/rewrite.js';

function readArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(name);

function print(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

async function main(): Promise<number> {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const json = has('--json');
  const editsFile = readArg('--apply');

  // ── 仅报告模式（不带 --apply）──
  if (!editsFile) {
    const r = runUpgradePlanReport(root);
    for (const l of r.lines) print(l);
    print('\n（仅报告模式。加 --apply <edits.json> 进入 git 验证回退闭环；编辑 JSON: [{"file":"...","from":"...","to":"..."}]）');
    if (json) print(JSON.stringify(r.report, null, 2));
    return r.ok ? 0 : 1;
  }

  // ── 闭环：编辑从文件来（★ 结构复核在能力层 —— MCP 面走的是同一条复核）──
  let edits: PlanEdit[];
  try {
    edits = JSON.parse(fs.readFileSync(editsFile, 'utf-8')) as PlanEdit[];
  } catch (e) {
    print('✗ 编辑文件非法:', (e as Error).message);
    return 1;
  }

  const r = await runUpgradeApplyLoop(root, edits, has('--skip-verify'));
  for (const l of r.lines) print(l);
  if (json) print(JSON.stringify(r.report, null, 2));
  return r.ok ? 0 : 1;
}

main().then((code) => process.exit(code));
