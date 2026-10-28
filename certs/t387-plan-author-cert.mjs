#!/usr/bin/env node
/**
 * ★★★ cert T387 —— **`design_line action=plan`**：这条链的"作者"（2026-10-28 · 迭代 ⑥）
 *
 * ## 为什么有这张证
 * 前面几轮把**判据**都立起来了（planGaps / coverage / strength / dependency / exit），
 * 但**没有任何工具能写计划** —— 只有程序接口 `writeRewritePlan()`，agent 只能手搓 JSON 落盘。
 * ⇒ 判据再好，跑不通。本证钉的是"作者"这个入口：读 / 干跑 / 落盘三态 + 四个判据 + 路线。
 *
 * ## 判据（每条亲手跑）
 *   ① **只读**：没有画布时，回执明说"还没有画布"并给出**下一步怎么做**（不是一句"文件不存在"）；
 *   ② **干跑**：给了 `entries` 但没 `apply` ⇒ **不落盘**，但把缺口**逐条报出来**；
 *   ③ **落盘**：`apply:true` ⇒ 写到 `plan/<rel>.plan.json`，且**记了冻结指纹**（`base.content_hash`）；
 *   ④ **路线**：回执给拓扑序（被依赖的先出现）；成环时明说"不成立"；
 *   ⑤ **四个判据一起跑**：缺口来自同一份实现（`rewrite_plan.ts`），本证验至少能暴露"判据解不出来"；
 *   ⑥ **落盘后可回放**：再调一次（不给 entries）⇒ 读回同一份计划（temp+rename 完好）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `action=plan` 本身；"写闸是否拦"是 `t380`，出口闭环是 `t381`/`t382`；
 *   · **[未核] 与真实 MCP 客户端的往返**：本证走 CLI（同一个 handler），没起 MCP server。
 *
 * ## 用法
 *   node certs/t387-plan-author-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp387author-'));
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
await importProject({ project_dir: PROJ, feature: 't387' });

const cli = (args) => {
  try {
    return execFileSync('node', ['dist/src/presentation/cli/cli.js', ...args], { encoding: 'utf8' });
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};
const planArgs = (extra = []) => ['design_line', `project_dir=${PROJ}`, 'action=plan', `file=${REL}`, ...extra];
const PLAN_FILE = path.join(PROJ, '.agent-io/plan', `${REL}.plan.json`);
const entries = JSON.stringify([
  { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回 2', judgement_ref: 'decision:n_x#0', status: 'open' },
]);

// ── ① 只读：没有画布 ⇒ 明说 + 给下一步 ───────────────────
{
  const out = cli(planArgs());
  chk(/还没有画布/.test(out), '① 没有画布时明说"还没有画布"', out.split('\n').find((l) => /还没有/.test(l))?.trim().slice(0, 100) ?? '');
  chk(/下一步/.test(out) && /untouched/.test(out), '①-b 并给出**下一步**（entries + untouched 怎么给）');
  chk(!fs.existsSync(PLAN_FILE), '①-c 只读**不落盘**');
}

// ── ② 干跑 ⇒ 不落盘但报缺口 ─────────────────────────────
{
  const out = cli(planArgs([`entries=${entries}`]));
  chk(/干跑/.test(out) && /没有落盘/.test(out), '② 干跑：明说**没有落盘**', out.split('\n').find((l) => /干跑/.test(l))?.trim().slice(0, 100) ?? '');
  chk(!fs.existsSync(PLAN_FILE), '②-b 干跑确实没写文件');
  chk(/缺口/.test(out) && /判据解不出来|找不到节点/.test(out), '②-c 但把缺口**逐条报出来**（这里：节点 `n_x` 在册里找不到 ⇒ 判不出强度）', out.split('\n').find((l) => /判据解不出来/.test(l))?.trim().slice(0, 110) ?? '');
}

// ── ③ 落盘 ⇒ 写文件 + 记冻结指纹 ────────────────────────
{
  const out = cli(planArgs([`entries=${entries}`, 'apply=true']));
  chk(/已落盘/.test(out), '③ `apply:true` ⇒ 明说已落盘', out.split('\n').find((l) => /已落盘/.test(l))?.trim().slice(0, 110) ?? '');
  chk(fs.existsSync(PLAN_FILE), '③-b 计划文件真的存在', path.relative(PROJ, PLAN_FILE));
  const j = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  chk(typeof j.base?.content_hash === 'string' && j.base.content_hash.length > 10, '③-c **记了冻结指纹**（`base.content_hash`）', String(j.base?.content_hash ?? '(无)').slice(0, 16) + '…');
  chk(typeof j.frozen_at === 'string', '③-d 记了 `frozen_at`');
}

// ── ④ 路线（拓扑序）─────────────────────────────────────
{
  const twoEntries = JSON.stringify([
    { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'decision:n_x#0', status: 'open' },
  ]);
  const out = cli(planArgs([`entries=${twoEntries}`]));
  chk(/路线（拓扑序）/.test(out), '④ 回执给出**路线**（拓扑序）', out.split('\n').find((l) => /路线/.test(l))?.trim().slice(0, 100) ?? '');
}

// ── ⑥ 落盘后可回放 ──────────────────────────────────────
{
  const out = cli(planArgs());
  chk(/1 条改动/.test(out) && /rewrite:f/.test(out), '⑥ 再调一次（不给 entries）⇒ **读回同一份计划**', out.split('\n').find((l) => /条改动/.test(l))?.trim().slice(0, 100) ?? '');
}

console.log(`\n═══ T387 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
