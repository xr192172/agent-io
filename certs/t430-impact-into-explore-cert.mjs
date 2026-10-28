#!/usr/bin/env node
/**
 * ★★★ cert T430 —— **`impact_analysis` 并入 `explore_code action=impact`**（2026-10-28）
 *
 * ## 为什么搬回"理解代码"这条线
 * `explore_code` 原本有 `diff_impact`，2026-10-21 因"实测 146–179 次调用、成功 0–3 次"被移走，
 * 影响面改用独立工具 `impact_analysis` ⇒ 同一件事分了两处。
 * 现在判定：**"我要改这里会炸哪里"属于代码理解**（本工具就是"理解代码/结构"的统一入口）
 * ⇒ 搬回来做 `action=impact`，与旧工具**同一对执行核 + 同一套文案**（`analyzeHubs` / `analyzeImpact`）。
 *
 * ## 判据（每条亲手跑 · **冻结夹具 + 手算期望**）
 * 为什么不用"与旧工具逐字对比"：第一版证就是那么写的，结果**假红**——因为两次运行之间仓里多了
 * 一个文件（632 → 633 文件、1458 → 1460 边），项目级读数天然在动。
 * ⇒ 改成在**固定夹具**上验证**闭包结论本身对不对**（手算：`lib/a.ts` 被 `b`、`c` 直接引用，`d` 经 `b` 间接）：
 *   ① `impact_analysis` **不在注册表**；工具面 **49 → 48**；
 *   ② 夹具闭包 = **{b:1, c:1, d:2}**，`total=3` / `direct=2`（与手算一致）；
 *   ③ 符号级变更点（`a.ts#f`）也给出闭包（不是"未定位到变更点"）；
 *   ④ 热区模式把 `lib/a.ts`（被 2 个文件依赖）列进前几名；
 *   ⑤ 执行核仍在，且 `explore_code` 里确有 impact 分支。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **[未核] 与旧工具的逐字等价**：旧工具已删、仓在变动 ⇒ 只证"闭包结论正确"，不证"字节相同"；
 *     等价性的根据是**同一执行核同一文案**（`analyzeHubs` / `analyzeImpact` 未改一行）；
 *   · **[未核] 写闸自动附带波及【本笔未做】**：让 `edit_dsl` / `edit_code` 写入时自动算波及并
 *     对高风险要求 L4 证据，是**独立的、更危险的一步** ⇒ 单独立项 `T-#GATE-IMPACT`；
 *   · `max_depth` / `fell_back`（符号级消费方解析失败降级）分支未在本证覆盖。
 *
 * ## 用法
 *   node certs/t430-impact-into-explore-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const ec = TOOL_DEFS.find((t) => t.name === 'explore_code');

function unwrap(r) {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  if (i < 0) return { msg: t.trim(), data: undefined };
  let data;
  try {
    data = JSON.parse(t.slice(i + 10).trim());
  } catch {
    data = undefined;
  }
  return { msg: t.slice(0, i).trim(), data };
}

// ── 冻结夹具（手算期望的根据）──────────────────────────
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'impfx-'));
fs.mkdirSync(path.join(proj, 'lib'), { recursive: true });
fs.writeFileSync(path.join(proj, 'lib/a.ts'), 'export function f(): number { return 1; }\n');
fs.writeFileSync(path.join(proj, 'lib/b.ts'), "import { f } from './a';\nexport function g(): number { return f() + 1; }\n");
fs.writeFileSync(path.join(proj, 'lib/c.ts'), "import { f } from './a';\nexport function h(): number { return f() + 2; }\n");
fs.writeFileSync(path.join(proj, 'lib/d.ts'), "import { g } from './b';\nexport function k(): number { return g() + 3; }\n");
// 手算：改 a.ts ⇒ 直接消费方 b、c（depth 1）；d 经 b 间接（depth 2）⇒ total=3 / direct=2

// ── ① 旧工具已不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('impact_analysis'), '① `impact_analysis` **不在注册表**');
  chk(names.length <= 48, '①-b 工具面 **49 → 48**（只降不升）', `实际 ${names.length}`);
}

// ── ② 整文件变更点：闭包与手算一致 ─────────────────────
{
  const { msg, data } = unwrap(await ec.handler({ action: 'impact', project_dir: proj, change_points: [{ file: 'lib/a.ts' }] }));
  const got = Object.fromEntries((data?.files ?? []).map((f) => [f.file.replace(/\\/g, '/'), f.depth]));
  chk(data?.total === 3 && data?.direct === 2, '② `total=3` / `direct=2`（与手算一致）', `实际 total=${data?.total} direct=${data?.direct}`);
  chk(got['lib/b.ts'] === 1 && got['lib/c.ts'] === 1 && got['lib/d.ts'] === 2, '②-b 闭包 = **{b:1, c:1, d:2}**（直接两个 + 间接一个）', JSON.stringify(got));
  chk(/影响面报告/.test(msg), '②-c 回执是人读报告（不是空话）', msg.split('\n')[1]?.slice(0, 90));
}

// ── ③ 符号级变更点 ────────────────────────────────────
{
  const { msg, data } = unwrap(
    await ec.handler({ action: 'impact', project_dir: proj, change_points: [{ file: 'lib/a.ts', symbol: 'f' }] }),
  );
  chk((data?.total ?? 0) > 0, '③ 符号级变更点（`a.ts#f`）**也给出闭包**', `total=${data?.total} direct=${data?.direct}`);
  chk(!/未定位到变更点/.test(msg), '③-b 没有"未定位到变更点"告警（符号真被定位到了）');
}

// ── ④ 热区模式 ────────────────────────────────────────
{
  const { data } = unwrap(await ec.handler({ action: 'impact', project_dir: proj, hubs: true, top: 10 }));
  const top = (data?.files ?? []).map((f) => `${f.file.replace(/\\/g, '/')}×${f.dependents}`);
  chk(top.some((x) => x.startsWith('lib/a.ts')), '④ 热区把 `lib/a.ts`（被 2 个文件依赖）列出来', top.slice(0, 4).join(', '));
  const deps = (data?.files ?? []).map((f) => f.dependents);
  chk(deps.every((d, i) => i === 0 || deps[i - 1] >= d), '④-b 热区按"被依赖数"**降序**（排序没坏）', deps.slice(0, 6).join(','));
}

// ── ⑤ 执行核仍在 ─────────────────────────────────────
{
  const core = fs.readFileSync(path.join(ROOT, 'src/infrastructure/analysis/impact/index.ts'), 'utf8');
  chk(/export async function analyzeImpact/.test(core), '⑤ 执行核 `analyzeImpact` **仍在**（未改一行）');
  chk(/analyzeHubs/.test(core), '⑤-b 热区执行核 `analyzeHubs` **仍在**');
  chk(/case 'impact'/.test(fs.readFileSync(path.join(ROOT, 'src/application/meta/explore/explore_code.ts'), 'utf8')), '⑤-c `explore_code` 里**确有 impact 分支**');
}

console.log(`\n═══ T430 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
