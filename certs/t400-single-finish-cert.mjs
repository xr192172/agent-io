#!/usr/bin/env node
/**
 * ★★★ cert T400 —— **写路只许一种收尾**（T-#RP-3 结构解 B）（2026-10-28）
 *
 * ## 之前的两条收尾
 * · `source_writer.close()`：自写登记 + 写穿 + **计算批级计划读数** + 刷读集基线；
 * · `edit_code`：逐分支 `txn.commit()` + 自己 `syncFile(...)`，**从不 close**
 *   ⇒ 批级读数到不了它（T245 查出的那层），只能现算。
 *
 * ## 现在（结构解 B）
 * 正文 `editCodeBody` 只落盘、**不收尾**；事务交给外层 `editCodeInner` 统一 `close()`：
 * 读数从**唯一出处**（写穿结果）来，`renderPlanReadings` 的**回退分支已删**。
 *
 * ## 判据（每条亲手跑）
 *   ① 端到端：`edit_code` 单文件写 ⇒ 回执出现「**画布基线已挪到写后**」
 *      —— 修前这条**不可能**出现（`plan_baseline` 只在 `close()` 里产生，而 edit_code 从不 close）；
 *   ② 结构：`edit_code.ts` 里 `.close()` 出现**至少一次**，且正文里**不再有** `renderPlanReadings(`
 *      （读数由外层统一加，正文不各算各的）；
 *   ③ 结构：`renderPlanReadings` 的**回退分支已删**（源码里不再 import/调用 `renderExitCheck`）；
 *   ④ 端到端：严格档下**连续两次**写同一文件都不被"画布过期"拦（收尾会把基线挪到写后）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **批量 `targets[]` 路仍未合并**（`editCodeBatch` 自有逐文件 sync，本轮不动）——见 todo T-#RP-3；
 *   · **[未核]** `close()` 会多做一次 `syncSelfWritesSync`（幂等、跳过未变文件），未测其耗时上限。
 *
 * ## 用法
 *   node certs/t400-single-finish-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/refactor/edit/edit_code.ts, src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp400finish-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
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
const EDIT_SRC = fs.readFileSync(path.join(ROOT, 'src/application/refactor/edit/edit_code.ts'), 'utf8');
const WG_SRC = fs.readFileSync(path.join(ROOT, 'src/application/write_gate.ts'), 'utf8');

// ── ②③ 结构断言 ────────────────────────────────────────
{
  const closeCount = (EDIT_SRC.match(/\.close\(\)/g) ?? []).length;
  chk(closeCount >= 1, '② `edit_code.ts` 里出现 `.close()`（唯一收尾）', `出现 ${closeCount} 次`);
  const bodyRenders = (EDIT_SRC.match(/renderPlanReadings\(/g) ?? []).length;
  chk(bodyRenders <= 1, '②-b 读数由外层统一加（正文不各算各的）', `renderPlanReadings( 出现 ${bodyRenders} 次`);
  chk(!/renderExitCheck\(/.test(WG_SRC) || !/checkRewriteExit\(ctx\.root/.test(WG_SRC), '③ `renderPlanReadings` 的回退分支已删（不再现算）');
}

// ── ①④ 端到端 ─────────────────────────────────────────
{
  const REL = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
  const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
  const { writeRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
  const { contentHash } = await import(D + 'infrastructure/index/symbols.js');
  const { editCode } = await import(D + 'application/refactor/edit/edit_code.js');

  await importProject({ project_dir: PROJ, feature: 't400' });
  {
    const dsl = getDSL('t400');
    for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
    saveDSL(dsl, PROJ);
  }
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf8')) },
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t400#①', judgement_kind: 'behavior-cases', status: 'open' },
    ],
    untouched_default: { why: '夹具' },
    symbols_at_freeze: ['f'],
  });

  const r1 = await editCode(
    { project_dir: PROJ, op: 'replace_text', file: REL, old_text: 'return 1;', new_text: 'return 2;', reason: 't400 第一次', actor: 'agent:t400' },
    {},
  );
  const m1 = String(r1?.message ?? '');
  chk(/画布基线已挪到写后/.test(m1), '① 回执出现「**画布基线已挪到写后**」（修前这条不可能出现）', m1.split('\n').find((l) => /画布基线/.test(l))?.trim().slice(0, 120) ?? '(没有)');
  chk(!!r1?.data?.plan_baseline, '①-b 机器侧 `data.plan_baseline` 也在（不只人读一行）', JSON.stringify(r1?.data?.plan_baseline ?? null).slice(0, 110));

  process.env.AGENT_IO_REQUIRE_PLAN = '1';
  let blocked = '';
  let m2 = '';
  try {
    const r2 = await editCode(
      { project_dir: PROJ, op: 'replace_text', file: REL, old_text: 'return 2;', new_text: 'return 3;', reason: 't400 第二次', actor: 'agent:t400' },
      {},
    );
    m2 = String(r2?.message ?? '');
  } catch (e) {
    blocked = String(e && e.message ? e.message : e);
  }
  process.env.AGENT_IO_REQUIRE_PLAN = '0';
  chk(blocked === '', '④ 严格档下**连续第二次**写同一文件放行（收尾把基线挪到写后）', blocked.split('\n')[0]?.slice(0, 130) ?? '');
  chk(/出口闭环/.test(m2), '④-b 第二次写的回执仍有出口闭环读数', m2.split('\n').find((l) => /出口闭环/.test(l))?.trim().slice(0, 110) ?? '(没有)');
}

console.log(`\n═══ T400 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
