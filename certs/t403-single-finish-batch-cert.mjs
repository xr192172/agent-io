#!/usr/bin/env node
/**
 * ★★★ cert T403 —— **两条收尾合一**（T-#RP-3 最后一步）（2026-10-28）
 *
 * ## 之前
 * · 单文件路：逐分支 `commit` + `syncFile`，**已在 T-#RP-3 前半合并**为"正文只落盘 + 外层统一 `close()`"；
 * · 批量路：**直到今天仍是**"逐文件 `commit` + 逐文件 `await syncFile` + 逐文件 `reopen`"
 *   ⇒ 批级计划读数（`plan_exit` / `plan_baseline`）在批量路上**完全没有**。
 *
 * ## 现在
 * 批量路也是"先全部 `commit` → **一次** `close()` → 逐文件事实从 `byFile` 取"。
 *
 * ## 判据（每条亲手跑）
 *   ① 批量回执的 `files[]` **仍在**且带 `symbol_diff`（读数从 `byFile` 供，没蒸发）；
 *   ② 批量回执**首次**带出批级计划读数：有画布时出现「画布基线已挪到写后」；
 *   ③ 结构：`edit_code.ts` 里 `close()` 出现 **≥2** 次（单文件 wrapper + 批量路），
 *      且批量块里**不再有** `const sync = await syncFile(`（逐文件 sync 已删）；
 *   ④ T150 的不变式仍成立：同文件两项 ⇒ 条目级不带 diff、`files[]` 一条。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · `byFile` 只在 **sync** 版（`syncSelfWritesSync`）里填；async 版（`syncSelfWrites`）仍只走 `onFile` 回调；
 *   · **[未核]** 批量路去掉逐文件 `reopenAndResolveAfterWrite` 后，`reopenNote` 的读数不再进 `index_synced`
 *     —— 它现在只有 `status`（引用方重算由 `close()` 内部统一做，读数在 `outcome.refsReopened`）。
 *
 * ## 用法
 *   node certs/t403-single-finish-batch-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/refactor/edit/edit_code.ts, write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp403batch-'));
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

const ROOT = 'D:/agentio/dev/agent-io';
const SRC = fs.readFileSync(path.join(ROOT, 'src/application/refactor/edit/edit_code.ts'), 'utf8');

// ── ③ 结构断言 ─────────────────────────────────────────
{
  const closeCount = (SRC.match(/\.close\(\)/g) ?? []).length;
  chk(closeCount >= 2, '③ `close()` 出现 ≥2 次（单文件 wrapper + 批量路）', `出现 ${closeCount} 次`);
  chk(!/symbolDiffByFile\.set\(absPath, sync\.symbol_diff\)/.test(SRC), '③-b 批量路"逐文件 sync 结果写 Map"的模式**已删**（改从 `byFile` 取）');
}

// ── ①②④ 端到端 ───────────────────────────────────────
{
  const REL = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, REL), 'export function fa(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
  const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
  const { writeRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
  const { contentHash } = await import(D + 'infrastructure/index/symbols.js');
  const { editCode } = await import(D + 'application/refactor/edit/edit_code.js');

  await importProject({ project_dir: PROJ, feature: 't403' });
  {
    const dsl = getDSL('t403');
    for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
    saveDSL(dsl, PROJ);
  }
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf8')) },
    entries: [
      { anchor: { symbol: 'fa' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t403#①', judgement_kind: 'behavior-cases', status: 'open' },
    ],
    untouched_default: { why: '夹具' },
    symbols_at_freeze: ['fa'],
  });

  const r = await editCode(
    {
      project_dir: PROJ,
      op: 'replace_text',
      targets: [
        { file: REL, old_text: 'export function fa(): number {', new_text: 'export function fb(): number {\n  return 2;\n}\n\nexport function fa(): number {' },
        { file: REL, old_text: '  return 1;\n}', new_text: '  return 11;\n}' },
      ],
      reason: 't403 夹具（批量）',
      actor: 'agent:t403',
    },
    {},
  );
  const d = r?.data ?? {};
  const files = d.files ?? [];
  chk(files.length === 1 && !!files[0].symbol_diff, '① 批量回执 `files[]` **仍在**且带 `symbol_diff`（从 `byFile` 供）', JSON.stringify(files));
  chk((d.items ?? []).every((it) => !it.symbol_diff), '④ T150 不变式仍成立：同文件两项 ⇒ 条目级**不带** diff');
  const msg = String(r?.message ?? '');
  chk(/画布基线已挪到写后/.test(msg), '② 批量回执**首次**带出批级计划读数（修前批量路完全没有）', msg.split('\n').find((l) => /画布基线/.test(l))?.trim().slice(0, 120) ?? '(没有)');
  chk(!!(d.plan_baseline || d.plan_exit), '②-b 机器侧也有（`plan_baseline` / `plan_exit`）', JSON.stringify(d.plan_baseline ?? d.plan_exit ?? null).slice(0, 110));
}

console.log(`\n═══ T403 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
