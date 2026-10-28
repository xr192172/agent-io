#!/usr/bin/env node
/**
 * ★★★ cert T398 —— **T245**：写路回执的计划读数只许有一份实现（2026-10-28）
 *
 * ## 查出来的真身（T245 原写"两条写路仍是两份实现"，待查）
 * 写盘其实早已收口（`source_writer` 唯一原语，`rename_symbols` 只剩"没项目根"的降级直写）。
 * 真正的两份实现在**回执组装**：
 * - `apply_writes` 从写穿结果读 `plan_exit` / `plan_baseline`；
 * - `edit_code` 却**自己再调一遍 `checkRewriteExit`**（写完之后重算），而且把
 *   `plan_baseline`（"吸收设计缺口 / 基线已挪到写后"）**整个丢掉** —— 因为 `txn.commit()` 的返回值被丢弃。
 *
 * ## 修法
 * `write_gate#renderPlanReadings(out)` = **唯一渲染器**（只读写穿结果，不重算）；
 * `edit_code` 接住 `commit` 的回执（`_lastRec`）并用它渲染 ⇒ 两条写路口径一致。
 *
 * ## 判据（每条亲手跑）
 *   ① 源码里 **不再有** `checkRewriteExit(`（edit_code 不再自己重算）；
 *   ② `renderPlanReadings` **只有一处实现**（`write_gate.ts`），`edit_code` 只 import 调用；
 *   ③ 端到端：`edit_code` 改一次 ⇒ 回执里出现**画布新陈代谢读数**（"基线已挪到写后"或"记成设计缺口"）
 *      —— 修前这条读数在 `edit_code` 这条路上是**完全看不到**的。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `edit_code` 与 `apply_writes` 两条；`rename_symbols` 走同一写原语，未单独核其回执字段；
 *   · **[未核]** `plan_exit` 与 `plan_baseline` 的**文案质量**（本证只核"有没有出现"）。
 *
 * ## 用法
 *   node certs/t398-single-plan-render-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/write_gate.ts, src/application/refactor/edit/edit_code.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp398single-'));
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
const EDIT = path.join(ROOT, 'src/application/refactor/edit/edit_code.ts');
const WG = path.join(ROOT, 'src/application/write_gate.ts');
const editSrc = fs.readFileSync(EDIT, 'utf8');
const wgSrc = fs.readFileSync(WG, 'utf8');

// ── ① 不再自己重算 ─────────────────────────────────────
chk(!/checkRewriteExit\(/.test(editSrc), '① `edit_code` 里**不再有** `checkRewriteExit(`（不再自己重算出口闭环）');

// ── ② 唯一实现 ─────────────────────────────────────────
{
  const impls = [
    ['write_gate.ts', (wgSrc.match(/export function renderPlanReadings/g) ?? []).length],
    ['edit_code.ts', (editSrc.match(/export function renderPlanReadings/g) ?? []).length],
  ];
  chk(impls[0][1] === 1 && impls[1][1] === 0, '② `renderPlanReadings` **只有一处实现**（write_gate），edit_code 只有 import', JSON.stringify(impls));
  chk(/import \{ renderPlanReadings \} from '\.\.\/\.\.\/write_gate\.js'/.test(editSrc), '②-b edit_code 从 write_gate **引入**这一个实现');
}

// ── ③ 端到端：回执里能看到画布新陈代谢 ──────────────────
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

  await importProject({ project_dir: PROJ, feature: 't398' });
  {
    const dsl = getDSL('t398');
    for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
    saveDSL(dsl, PROJ);
  }
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf8')) },
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t398#③', judgement_kind: 'behavior-cases', status: 'open' },
    ],
    untouched_default: { why: '夹具' },
    symbols_at_freeze: ['f'],
  });

  const out = await editCode(
    { project_dir: PROJ, op: 'replace_text', file: REL, old_text: 'return 1;', new_text: 'return 2;', reason: 't398 夹具', actor: 'agent:t398' },
    {},
  );
  const msg = String(out?.message ?? '');
  chk(/出口闭环/.test(msg), '③ `edit_code` 回执里**仍有出口闭环读数**（换成唯一渲染器后没丢）', msg.split('\n').find((l) => /出口闭环/.test(l))?.trim().slice(0, 120) ?? '(没有)');

  // ③-b 渲染器**优先用写穿读数**（有就不现算）；拿不到才回退（回退的判据仍是同一实现）
  const { renderPlanReadings } = await import(D + 'application/write_gate.js');
  const prefer = renderPlanReadings({ plan_exit: ['★ 写穿读数-A'], plan_baseline: ['★ 写穿读数-B'] }, { root: PROJ, rel: REL });
  chk(/写穿读数-A/.test(prefer) && /写穿读数-B/.test(prefer) && !/出口闭环/.test(prefer), '③-b 有写穿读数时**优先用它**（不现算、不重复）', prefer.replace(/\n/g, ' | ').slice(0, 120));
}

console.log(`\n═══ T398 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
