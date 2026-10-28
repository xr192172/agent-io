#!/usr/bin/env node
/**
 * dogfood:coverage —— **工具使用覆盖读数**（死工具 / 过期记录）
 *
 * ## 为什么是脚本而不是工具（2026-10-28 从 `tool_usage` 迁出）
 * 这份读数回答的是「**烟测（dogfood）跑过哪些工具**」，属于**开发期审计**，
 * 模型在写代码时不需要在会话里调它一次 —— 它是一次性/周期性的体检，天然属于脚本。
 * 原来它占着一个 MCP 工具位（`tool_usage`），现在工具删掉、能力搬到这里：
 * **一行统计都不重造**，仍然复用 `computeDogfoodCoverage` / `renderDogfoodCoverage`。
 *
 * ## 口径（继承原工具，未改）
 * · 「用过」= `usage.jsonl` 里出现过的 tool（默认**排除** `via=sweep|gate`：扫射/门跑不算用过）
 * · 「死工具」= 注册表 − 用过
 * · 「过期记录」= 用过 − 注册表
 * · 两个集合的权威来源都印在输出里（注册表 = `TOOL_DEFS` 唯一汇总点）
 *
 * ## 用法
 *   npm run build && node scripts/dogfood-coverage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = pathToFileURL(path.join(ROOT, 'dist/src')).href + '/';

const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const { computeDogfoodCoverage, renderDogfoodCoverage } = await import(D + 'infrastructure/dogfood_coverage.js');

const registry = TOOL_DEFS.map((t) => t.name);
const c = computeDogfoodCoverage(registry, 'src/application/tool_registry.ts 的 TOOL_DEFS（工具注册唯一汇总点）');
console.log(renderDogfoodCoverage(c));

// ★ 明确的退出码约定：本脚本**只报告不判定**（死工具 ≠ 错误；可能是刚加还没跑过）
process.exit(0);
