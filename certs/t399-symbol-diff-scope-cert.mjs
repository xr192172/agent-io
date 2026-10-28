#!/usr/bin/env node
/**
 * ★★★ cert T399 —— **T150**：`symbol_diff` 重复记账（文件级读数挂在条目级）（2026-10-28）
 *
 * ## 复现出来的账实不符
 * 同一文件 2 项 `replace_text` ⇒ 逐项都报 `{added:1,removed:0,changed:1}`，加起来 `added 2`，
 * 实况 `added 1`。**不是算了两遍，是文件级读数被挂到每一条目上**。
 *
 * ## 修法（读数回到它的作用域）
 * - `domain/batch_diff.ts#planBatchDiffReport`（**叶子纯函数**，零依赖 ⇒ 判据执行核可加载）：
 *   `files` 每文件一条；`perItem[i]` **仅在该文件整批内唯一**时才带；输出键序规范化；
 * - `edit_code` 批量回执新增 `files[]`（唯一出处），条目级不再各挂文件 diff；
 * - `refactor_plan` 的 `ApplyPlanResult` 带 `files[]`。
 *
 * ## 判据（每条亲手跑）
 *   ① 纯函数：同文件两项 ⇒ `files` 一条 + `perItem` 全 `null`；
 *   ② 纯函数：该文件唯一一项 ⇒ `perItem` 带 diff（不丢信息）；
 *   ③ 端到端（`apply_refactor_plan`，同文件 2 项）⇒ 回执 `files[]` **只有一条**，
 *      且**逐项 `symbol_diff` 之和 ≠ 重复计数**（没有条目再带文件级 diff）；
 *   ④ 键序规范化：入参键序打乱 ⇒ 输出 repr 不变（否则判据时对时错，实测算过）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `replace_text` 批量路；`edit_code` 的单文件路本来就是文件级、不涉及重复；
 *   · **[未核]** `rename_symbols` 的读数（它走 `filesWritten` 计数，形态不同）。
 *
 * ## 用法
 *   node certs/t399-symbol-diff-scope-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/domain/batch_diff.ts, edit_code.ts, refactor_plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp399diff-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { planBatchDiffReport } = await import(D + 'domain/batch_diff.js');

// ── ① 同文件两项 ───────────────────────────────────────
{
  const r = planBatchDiffReport({ 'src/a.ts': { added: 1, removed: 0, changed: 1 } }, ['src/a.ts', 'src/a.ts']);
  chk(r.files.length === 1 && r.perItem.every((x) => x === null), '① 同文件两项 ⇒ **files 一条 + perItem 全 null**（不重复记账）', JSON.stringify(r));
}

// ── ② 该文件唯一一项 ───────────────────────────────────
{
  const r = planBatchDiffReport({ 'src/a.ts': { added: 1, removed: 0, changed: 1 } }, ['src/a.ts']);
  chk(!!r.perItem[0] && r.perItem[0].added === 1, '② 该文件唯一一项 ⇒ perItem **带 diff**（不丢信息）', JSON.stringify(r.perItem));
}

// ── ④ 键序规范化 ───────────────────────────────────────
{
  const a = JSON.stringify(planBatchDiffReport({ 'x.ts': { added: 1, removed: 0, changed: 1 } }, ['x.ts']));
  const b = JSON.stringify(planBatchDiffReport({ 'x.ts': { changed: 1, added: 1, removed: 0 } }, ['x.ts']));
  chk(a === b, '④ 入参键序打乱 ⇒ 输出 repr **不变**（规范化；实测这条被 behavior-cases 抓到过）', `${a} vs ${b}`);
}

// ── ③ 端到端 ───────────────────────────────────────────
{
  const REL = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, REL), 'export function fa(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

  const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
  const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
  const { buildRefactorPlan, applyRefactorPlan } = await import(D + 'application/refactor/pipeline/refactor_plan.js');

  await importProject({ project_dir: PROJ, feature: 't399' });
  {
    const dsl = getDSL('t399');
    for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
    saveDSL(dsl, PROJ);
  }

  const plan = await buildRefactorPlan({
    project_dir: PROJ,
    targets: [
      {
        file: REL,
        old_text: 'export function fa(): number {',
        new_text: 'export function fb(): number {\n  return 2;\n}\n\nexport function fa(): number {',
      },
      { file: REL, old_text: '  return 1;\n}', new_text: '  return 11;\n}' },
    ],
  });
  const apply = await applyRefactorPlan({ project_dir: PROJ, plan, reason: 't399 夹具', actor: 'agent:t399' });
  const d = apply.data ?? apply;
  const files = d.files ?? [];
  const sumItems = (d.items ?? []).reduce((a, it) => a + (it.symbol_diff?.added ?? 0), 0);
  const sumFiles = files.reduce((a, f) => a + f.symbol_diff.added, 0);
  chk(files.length === 1, '③ 端到端：`files[]` **只有一条**（该文件）', JSON.stringify(files));
  chk(sumItems === 0 && sumFiles === 1, '③-b 逐项之和 0 · 文件级 added 1 ⇒ **没有重复记账**', `items=${sumItems} files=${sumFiles}`);
}

console.log(`\n═══ T399 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
