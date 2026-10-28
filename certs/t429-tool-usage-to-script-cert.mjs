#!/usr/bin/env node
/**
 * ★★★ cert T429 —— **`tool_usage` 从工具面迁出，变成 `npm run dogfood:coverage` 脚本**（2026-10-28）
 *
 * ## 更正一条我先前的过头话
 * 我一开始说"`tool_usage` 连谁在用都答不准"——**这话不对**。查过才知道：
 * `snapshotDogfoodStats` **默认排除 `via=sweep|gate`**（扫射 / 门跑不算"用过"），
 * 所以它的口径是成立的。真实问题只有一个：**它是"烟测覆盖读数"，属于开发期审计，不该占 MCP 工具位**
 * —— 模型写代码时不会在会话里调它；它是一次性/周期性体检。
 *
 * ## 处置（能力搬迁，不是删能力）
 * · 工具 `tool_usage` 删掉；能力搬进 `scripts/dogfood-coverage.mjs`（`npm run dogfood:coverage`）；
 * · 执行核 `infrastructure/dogfood_coverage.ts` **一行不改**（`computeDogfoodCoverage` / `renderDogfoodCoverage`）；
 * · 口径不变：死工具 = 注册表 − 用过；过期记录 = 用过 − 注册表；两侧数据源都印在输出里。
 *
 * ## 判据（每条亲手跑）
 *   ① `tool_usage` **不在注册表**；工具面 **50 → 49**；
 *   ② `npm run dogfood:coverage` **能跑**（退出码 0）且**产出三段读数**
 *      （注册表/用过/死工具/过期记录计数 + 死工具清单 + 数据源路径）；
 *   ③ 执行核仍在（`dogfood_coverage.ts` 导出未变）；
 *   ④ **口径未退化**：`dogfood_stats.ts` 里 `via=sweep|gate` 的排除仍在（这是它读数的可信度来源）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只证脚本能产读数；**[未核]** 死工具清单在长期运维里是否会被当作"该删"的信号（现在是纯报告，不判定）；
 *   · **[未核]** `usage.jsonl` 只反映本机 dogfood 跑过什么，不代表 MCP 外部调用者。
 *
 * ## 用法
 *   node certs/t429-tool-usage-to-script-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

// ── ① 工具已不在 ─────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('tool_usage'), '① `tool_usage` **不在注册表**');
  chk(names.length === 49, '①-b 工具面 **50 → 49**', `实际 ${names.length}`);
}

// ── ② 脚本能跑且产出三段读数 ──────────────────────────
{
  let out = '';
  let ok = false;
  try {
    out = execFileSync(process.execPath, ['scripts/dogfood-coverage.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32e6,
    });
    ok = true;
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  chk(ok, '② `npm run dogfood:coverage`（脚本）**能跑**，退出码 0');
  chk(/死工具/.test(out) && /过期记录/.test(out), '②-b 产出**死工具**与**过期记录**两维（集合差，不是一句总结）');
  chk(/注册表\s*\d+\s*个工具/.test(out), '②-c 印出**注册表工具数**（与注册表同源，不自己拼一份）', out.split('\n').find((l) => /注册表\s*\d+\s*个工具/.test(l))?.slice(0, 130));
  chk(/usage\.jsonl/.test(out), '②-d 印出**数据源路径**（读数可追溯）');
}

// ── ③ 执行核仍在 ─────────────────────────────────────
{
  const core = fs.readFileSync(path.join(ROOT, 'src/infrastructure/dogfood_coverage.ts'), 'utf8');
  chk(/export function computeDogfoodCoverage/.test(core), '③ 执行核 `computeDogfoodCoverage` **仍在**（拆注册不拆执行核）');
  chk(/export function renderDogfoodCoverage/.test(core), '③-b 渲染器 `renderDogfoodCoverage` **仍在**');
}

// ── ④ 口径未退化 ─────────────────────────────────────
{
  const stats = fs.readFileSync(path.join(ROOT, 'src/infrastructure/dogfood_stats.ts'), 'utf8');
  chk(/sweep|gate/.test(stats), '④ `via=sweep|gate` 的**排除口径仍在**（扫射/门跑不算"用过"——这是读数可信度的来源）');
  chk(/includeSweeps/.test(stats), '④-b `--all`（含扫射）仍可达，口径可对照');
}

console.log(`\n═══ T429 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
