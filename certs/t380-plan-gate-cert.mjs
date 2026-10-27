#!/usr/bin/env node
/**
 * ★★★ cert T380 —— **重写计划闸**：没计划就点名；严格档才拦（2026-10-28 · 第 3 步）
 *
 * ## 为什么有这张证
 * 「先通读 → 选范围 → 写完细节」若只靠自觉，`write_gate` 就只管"有没有卡"，不管"你想清楚了没有"。
 * ⇒ 与任务闸**并列**加一条：要写的文件必须有**够格的重写计划**（判据唯一实现在 `planGaps`）。
 *
 * ## 为什么默认只点名（不是一上来就拦）
 * 本仓此刻**一份计划都没有** ⇒ 硬拦等于所有源码都改不动（闸堵死流程）。⇒ 与 T360 的 `judge_gate`
 * 同一路数：**存量先记账，新规矩从人明确打开那一刻生效**（`AGENT_IO_REQUIRE_PLAN=1` 才拦）。
 *
 * ## 判据（每条亲手跑）
 *   ① **没计划** ⇒ 落盘**成功**（默认档），但回执里**逐文件点名**（`warnings` 有该文件 + 原因 + 怎么办）；
 *   ② **计划够格** ⇒ `warnings` 里**没有**该文件（放行且不吵）；
 *   ③ **严格档**（`AGENT_IO_REQUIRE_PLAN=1`）没计划 ⇒ **抛**（拒写），且错误里带"怎么办"；
 *   ④ 严格档 + 计划够格 ⇒ **不抛**（闸不是无差别拦）；
 *   ⑤ `stale` 条目 ⇒ 默认档也点名（"锚点过期"必须被看见）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `assertSourceWriteRegistered` 这一条咽喉；`edit_dsl`（写册不是写源码）不过这道闸；
 *   · **[未核] 迁移后的默认值**：严格档该在什么时候成为默认，是人的决定（这里只提供开关）。
 *
 * ## 用法
 *   node certs/t380-plan-gate-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp380gate-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
process.env.AGENT_IO_HOME = HOME;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');
const { assertSourceWriteRegistered } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/write_gate.js');
const { writeRewritePlan } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js');

// 夹具：一个项目根 + 一个 file 节点（path 指向 src/a.ts）+ 已 claim 的卡（先过任务闸，只看计划闸）
const REL = 'src/a.ts';
fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\n');
saveDSL(
  {
    id: 'feature_g380',
    type: 'feature_diagram',
    feature: 'g380',
    version: '1.0.0',
    title: 'g380',
    source_root: PROJ,
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [{ id: 'file_src_a_ts', type: 'file', path: REL, description: 'a' }],
      edges: [],
    },
    semantic: { files: [] },
  },
  PROJ,
);
// 给节点挂一张 claimed 卡（绕过任务闸，只测计划闸）
{
  const { getDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');
  const dsl = getDSL('g380');
  dsl.geometry.nodes[0].task = { id: 'file_src_a_ts', summary: 'T380 夹具', state: 'claimed', owner: 'agent:g380' };
  dsl.geometry.nodes[0].decision = {
    summary: 'T380 夹具判据',
    expectations: [{ kind: 'file-exists', path: `${REL}.todo`, why: '未满足 ⇒ 可领' }],
  };
  saveDSL(dsl, PROJ);
}

const run = (needPlan) => {
  if (needPlan) process.env.AGENT_IO_REQUIRE_PLAN = '1';
  else delete process.env.AGENT_IO_REQUIRE_PLAN;
  try {
    const out = assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
    return { threw: false, warnings: out.warnings ?? [] };
  } catch (e) {
    return { threw: true, msg: e.message, warnings: [] };
  }
};

// ── ① 没计划 + 默认档 ⇒ 放行但点名 ────────────────────────
{
  const r = run(false);
  const hit = (r.warnings ?? []).find((w) => w.includes('没有够格的重写计划'));
  chk(!r.threw, '① 没计划 + 默认档 ⇒ **放行**（不堵流程）', r.threw ? String(r.msg).slice(0, 100) : '');
  chk(!!hit && /没有够格的重写计划/.test(hit ?? ''), '①-b 但**逐文件点名**（不静默）', (hit ?? '').split('\n')[0]?.slice(0, 110) ?? '(没点名)');
  chk(/怎么办/.test(hit ?? '') && /plan\.json/.test(hit ?? ''), '①-c 点名里带**怎么办**（写到哪个文件、长什么样）');
}

// ── ③ 严格档 + 没计划 ⇒ 拒写 ─────────────────────────────
{
  const r = run(true);
  chk(r.threw && /重写计划闸/.test(String(r.msg)), '③ 严格档（`AGENT_IO_REQUIRE_PLAN=1`）+ 没计划 ⇒ **拒写**', (String(r.msg).split('\n')[0] ?? '').slice(0, 110));
  chk(/怎么办/.test(String(r.msg)) && /planGaps/.test(String(r.msg)), '③-b 拒绝信息给出判据与出路');
}

// ── ② 计划够格 ⇒ 不点名（放行且不吵）────────────────────
{
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: '2026-10-28T02:30:00+08:00',
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回值改成 2', judgement_ref: 'cert:t380/②', status: 'open' },
    ],
  });
  const r = run(false);
  chk(!r.threw && !(r.warnings ?? []).some((w) => w.includes('没有够格的重写计划')), '② 有计划且够格 ⇒ **不点名**（放行且不吵）', `warnings=${(r.warnings ?? []).length}`);
}

// ── ④ 严格档 + 计划够格 ⇒ 不抛 ───────────────────────────
{
  const r = run(true);
  chk(!r.threw, '④ 严格档 + 计划够格 ⇒ **不抛**（闸不是无差别拦）', r.threw ? String(r.msg).slice(0, 100) : '');
}

// ── ⑤ stale ⇒ 默认档也点名 ───────────────────────────────
{
  writeRewritePlan(PROJ, {
    path: REL,
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回值改成 2', judgement_ref: 'cert:t380/⑤', status: 'stale' },
    ],
  });
  const r = run(false);
  const hit = (r.warnings ?? []).find((w) => w.includes('没有够格的重写计划'));
  chk(!r.threw && !!hit && /过期/.test(hit ?? ''), '⑤ `stale` 条目 ⇒ 默认档**也点名**（锚点过期必须被看见）', (hit ?? '').split('\n')[1]?.trim().slice(0, 100) ?? '(没点名)');
}

console.log(`\n═══ T380 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
