#!/usr/bin/env node
/**
 * ★★★ cert T389 —— **画布冻结指纹接管"防覆盖"**（2026-10-28 · 用户提议"读集限制改成画布限制"）
 *
 * ## 为什么
 * 读集的前提是"有人**读过**"（`ReadSetEntry` 由读工具登记）⇒ 没读过就 `checked:0`，
 * 于是"用旧认知覆盖别人刚写的代码"**零提示**（实测：`edit_code` 用旧 body 覆盖了 4 分钟前加的修复，
 * 回执只说"文件符号 20 → 20"）。画布的 `base.content_hash` 是**显式冻结**的，不依赖"你读没读"。
 *
 * ## 判据（每条亲手跑）
 *   ① 画布冻结后**文件被改过** ⇒ 一条 `stale`，`via:'canvas'`、`reader:'canvas'`
 *      （★ 即使**没有任何人读过**这个文件 —— 这正是读集做不到的）；
 *   ② 文件没变 ⇒ **不报**（不制造假警报 —— 假警报一多就没人看了）；
 *   ③ **没有画布** ⇒ 这一路不参与（`checked` 不增加），读集那一路行为逐字不变；
 *   ④ 端到端：`write_gate` 的 `assumption_check.stale` 里能读到这条（不是只在单测里成立）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只比**文件级**内容哈希（画布记的就是文件级）；符号级仍由读集那一路负责（`via` 缺省）。
 *   · **不拦**：与读集同口径（用户 2026-10-21："只报，不拦"）—— 但它现在**一定**会出现，不再静默。
 *
 * ## 用法
 *   node certs/t389-canvas-assumption-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/read_set.ts, src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp389canvas-'));
// ★ 2026-10-28：本证测的不是计划闸，而严格档已改**默认开** ⇒ 显式关档
process.env.AGENT_IO_REQUIRE_PLAN = '0';
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

const REL = 'src/a.ts';
fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { checkAssumptions } = await import(D + 'application/read_set.js');
const { writeRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
const { contentHash } = await import(D + 'infrastructure/index/symbols.js');
const { assertSourceWriteRegistered } = await import(D + 'application/write_gate.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't389' });
{
  const dsl = getDSL('t389');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

const h0 = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
writeRewritePlan(PROJ, {
  path: REL,
  frozen_at: new Date().toISOString(),
  base: { content_hash: h0 },
  types_unused: undefined,
  entries: [
    { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t389#①', judgement_kind: 'behavior-cases', status: 'open' },
  ],
  untouched_default: { why: '夹具：只改 f' },
  symbols_at_freeze: ['f'],
});

// ── ② 文件没变 ⇒ 不报 ───────────────────────────────────
{
  const ac = checkAssumptions({ projectRoot: PROJ, files: [REL], canvas: [{ file: REL, content_hash: h0 }] });
  chk(!(ac.stale ?? []).some((s) => s.via === 'canvas'), '② 文件未变 ⇒ 画布这一路**不报**（不造假警报）', `stale=${ac.stale.length} checked=${ac.checked}`);
}

// ── ① 文件变了 ⇒ 报（且没有读集也能报）──────────────────
{
  fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 999;\n}\n');
  const ac = checkAssumptions({ projectRoot: PROJ, files: [REL], canvas: [{ file: REL, content_hash: h0 }] });
  const hit = (ac.stale ?? []).find((s) => s.via === 'canvas');
  chk(!!hit && hit.reader === 'canvas', '① 画布冻结后文件被改 ⇒ 一条 `stale`（`via=canvas` · `reader=canvas`）', JSON.stringify(hit ?? null).slice(0, 140));
  chk(ac.checked >= 1, '①-b **即使没有任何读集**也 checked≥1（这正是读集做不到的）', `checked=${ac.checked}`);
}

// ── ③ 没画布 ⇒ 不参与 ──────────────────────────────────
{
  const ac = checkAssumptions({ projectRoot: PROJ, files: [REL] });
  chk(!(ac.stale ?? []).some((s) => s.via === 'canvas'), '③ 不给 canvas ⇒ 这一路不参与（读集那一路行为不变）', `checked=${ac.checked}`);
}

// ── ④ 端到端：写闸的 assumption_check 里读得到 ──────────
{
  const out = assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  const hit = (out.assumption_check?.stale ?? []).find((s) => s.via === 'canvas');
  chk(!!hit, '④ 端到端：`write_gate` 的 `assumption_check.stale` 里有这条', JSON.stringify(hit ?? null).slice(0, 140));
}

console.log(`\n═══ T389 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
