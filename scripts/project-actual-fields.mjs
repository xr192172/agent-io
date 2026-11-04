#!/usr/bin/env node
/**
 * project-actual-fields —— `projectActualFields` 的可复跑入口（**量具**，节点 gate=exempt）
 *
 * 为什么要有这个脚本（而不是把它注册成 MCP 工具）：
 *   `scripts/mcp/mcp_scan.mjs` 的「工具面固定开销棘轮」是**只许不增长**（工具数 ≤ 基线、
 *   tools 块字节 ≤ 基线）⇒ 新增一个 MCP 工具会直接让门红。本派生写端不是"用户面能力"，
 *   它是一次**结构性派生**（实际册 → 设计册），按「量具/脚本/生成物不该立卡」走 scripts/。
 *
 * 用法：
 *   node scripts/project-actual-fields.mjs <feature> [--dry-run] [--files a.ts,b.ts]
 *   node scripts/project-actual-fields.mjs --all [--dry-run]      # 全部 feature
 *
 * ★ 幂等：同一次 scan 下重跑 ⇒ `filled=0 · skipped_nonempty=0 · unchanged=N`，册**零 diff**。
 * ★ 只填空值：已有值的字段（派生过 / 人改过）**一个字都不动** —— 这是它不违反 T85/D1 的判据。
 * ★ 本文件**零业务逻辑**：解析 argv → 调 `projectActualFields` → 打印回执。判定全在 src 里。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENTRY = path.join(ROOT, 'dist/src/application/meta/registry/project_actual_fields.js');
const STORAGE = path.join(ROOT, 'dist/src/infrastructure/storage.js');
const DESIGN_DIR = path.join(ROOT, '.agent-io/design');

/**
 * 逐 feature 跑投影，**失败逐个点名**（0.12：不许"跳过当没事"）。
 * @returns {Promise<number>} 失败个数（0 = 全成）
 */
async function runProjectActualFields(features, opts) {
  const { projectActualFields } = await import(pathToFileURL(ENTRY).href);
  let failed = 0;
  for (const feature of features) {
    try {
      const r = projectActualFields({
        feature,
        dry_run: opts.dryRun === true,
        ...(opts.files ? { files: opts.files } : {}),
      });
      console.log(r.message);
      console.log('');
    } catch (e) {
      failed++;
      console.error(`✗ ${feature}：${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
  return failed;
}

/** `--all` 时的 feature 清单：从设计册目录**现取**（不维护第二份清单） */
async function allFeatures() {
  const fs = await import('node:fs');
  const { getDSL } = await import(pathToFileURL(STORAGE).href);
  return fs
    .readdirSync(DESIGN_DIR)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .filter((f) => getDSL(f) !== null);
}

/** 解析 argv：位置参数 = feature 名（跳过 `--xxx` 与 `--files` 的取值） */
function parseArgs(argv) {
  const filesIdx = argv.indexOf('--files');
  const filesArg = filesIdx >= 0 ? argv[filesIdx + 1] : undefined;
  const features = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--files') {
      i++;
      continue;
    }
    if (argv[i].startsWith('--')) continue;
    features.push(argv[i]);
  }
  return {
    all: argv.includes('--all'),
    dryRun: argv.includes('--dry-run'),
    files: filesArg ? filesArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    features,
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.all && args.features.length === 0) {
  console.error('用法：node scripts/project-actual-fields.mjs <feature> [--dry-run] [--files a,b] | --all [--dry-run]');
  process.exit(2);
}
const list = args.all ? await allFeatures() : args.features;
const failed = await runProjectActualFields(list, { dryRun: args.dryRun, files: args.files });
process.exit(failed > 0 ? 1 : 0);
