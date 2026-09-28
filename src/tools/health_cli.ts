/**
 * health_cli —— 代码健康度 CLI（死代码 / 复杂度 / 分层违规）
 *
 * 用法：
 *   node dist/src/tools/health_cli.js <root> [--threshold N] [--top N] [--json <out>]
 *
 * 选项：
 *   --threshold N  圈复杂度阈值（默认 10）
 *   --top N        复杂度清单最多列前 N（默认 10）
 *   --json <out>   同时把完整报告写入 JSON 文件
 *
 * 输出：健康分/等级 + 分层统计（含「积木层中未分类」）+ 可达根 + 问题清单（按严重度）+ 最高复杂度 Top。
 *       问题行前缀：✗ error / ! warn / · info。
 *
 * ★ 2026-09-28（P0-②③④，见 docs/architecture-refactor-plan.md）：
 *   · root 必须真实存在，否则 **exit 2** —— 不再把"没输入"读成"健康分 100（A）"；
 *   · 可达根自动从 package.json 探测后喂给分析器（入口不再报孤儿/假违规）；
 *   · 评分改分档、单维扣分有上限 ⇒ 不再饱和成 0（0 个源文件时 grade=N/A）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { analyzeHealth } from '../health/index.js';
import { detectReachableRoots } from './project_root.js';

function readArg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intArg(name: string, def: number): number {
  const v = readArg(name);
  const n = v == null ? Number.NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const SEV_MARK: Record<string, string> = { error: '✗', warn: '!', info: '·' };

async function main(): Promise<void> {
  const root = process.argv[2] ?? '.';

  // P0-④ 配套：先校验 root 真实存在。
  // 旧行为：`node health_cli.js --help` 把 `--help` 当 root ⇒ 0 个文件 ⇒ 报「健康分 100（A）」。
  // "没输入"被读成"满分健康"是比低分更危险的失真 —— 一个错路径会被当成一次"体检通过"。
  // 路径不存在 ⇒ 明确报错退出，不给出任何分数。
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`[health] root 不存在或不是目录：${path.resolve(root)}`);
    console.error(`[health] 用法：node dist/src/tools/health_cli.js <rootDir> [--threshold N] [--top N] [--json <out>]`);
    process.exit(2);
  }

  // P0-②：可达根（package.json 的 bin / main / `node <路径>` script）显式喂给分析器。
  // 探测放这里而不放分析器里 —— `analyzeHealth` 保持纯函数（只吃 options，不读 package.json）。
  const reachableRoots = detectReachableRoots(root);

  const r = await analyzeHealth(root, {
    complexityThreshold: intArg('--threshold', 10),
    top: intArg('--top', 10),
    reachableRoots: reachableRoots.roots,
  });

  const lines: string[] = [];
  lines.push(`代码健康度报告 · ${r.root}`);
  lines.push(`${r.fileCount} 个文件 → 健康分 ${r.score}（${r.grade}）`);
  lines.push(
    `分层：胶水 ${r.layers.glue} / 积木 ${r.layers.brick}（其中未分类 ${r.layers.unclassified}）/ 契约 ${r.layers.contract} / 分层违规 ${r.layers.violations}`,
  );
  if (reachableRoots.roots.length > 0) {
    lines.push(`可达根 ${reachableRoots.roots.length} 个（入口按胶水层算，不计孤儿）：${reachableRoots.roots.join(', ')}`);
  }
  lines.push(r.summary);
  lines.push('');
  lines.push('—— 问题清单 ——');
  if (r.issues.length === 0) {
    lines.push('（无问题）');
  }
  for (const i of r.issues) {
    const loc = `${i.file}${i.line ? `:${i.line}` : ''}${i.symbol ? ` ${i.symbol}` : ''}`;
    lines.push(`${SEV_MARK[i.severity]} [${i.kind}] ${loc}`);
    lines.push(`      ${i.message}`);
  }
  lines.push('');
  lines.push(`—— 最高复杂度 Top ${r.complexity.length} ——`);
  for (const c of r.complexity) {
    lines.push(`  ${c.complexity}  ${c.file}:${c.line}  ${c.symbol}`);
  }
  console.log(lines.join('\n'));

  const jsonOut = readArg('--json');
  if (jsonOut) {
    const abs = path.resolve(jsonOut);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(r, null, 2), 'utf-8');
    console.log(`\n[health] JSON → ${abs}`);
  }
}

main().catch((e) => {
  console.error(`[health] 失败: ${(e as Error).message}`);
  process.exit(1);
});
