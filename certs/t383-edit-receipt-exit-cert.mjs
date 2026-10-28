#!/usr/bin/env node
/**
 * ★★★ cert T383 —— **编辑回执里的出口闭环那一行**（2026-10-28 · 迭代 ①）
 *
 * ## 为什么要有这一层（回答"模型需要吗"）
 * 回执的读者**就是 agent 自己**。结构化字段（`plan_exit`）没人打印 = 写了没人读
 * （本仓判据：**写而无人读 = 等于没写**）。但也不能刷屏（今晚刚为 40 行散文减过版面）
 * ⇒ **只在有异常时出声**：有 `not_yet` / `stale_anchor` / `unjudgeable` / 计划外符号 才出一行。
 *
 * ## 判据（每条亲手跑）
 *   ① 有画布 ∧ 计划已落地（全 realized、无计划外）⇒ 回执**不出现**该行（全绿不吵）；
 *   ② 有画布 ∧ 有 `not_yet`（文件没变/锚点没兑现）⇒ 回执**出现一行**，点名 not_yet；
 *   ③ 有画布 ∧ 计划外符号 ⇒ 回执出现，且点名"计划外符号"；
 *   ④ **没有画布** ⇒ 回执不出现（写前的 `planGate` 已经点名，不重复）；
 *   ⑤ 只出声**一行**（不把整份对账表贴进回执）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `edit_code` 的 `replace_text` 一条路径（其余 4 处共用同一个 `planExitNote`）；
 *   · **[未核] 其它写工具**（`apply_writes` / `remove_dead_imports`）：它们走 `WriteThroughOutcome.plan_exit`
 *     （结构化字段），文本渲染尚未接。
 *
 * ## 用法
 *   node certs/t383-edit-receipt-exit-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/refactor/edit/edit_code.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp383note-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
// ★ 2026-10-28：本证测的不是计划闸，而严格档已改**默认开** ⇒ 显式关档
process.env.AGENT_IO_REQUIRE_PLAN = '0';
process.env.AGENT_IO_HOME = HOME;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const REL = 'src/a.ts';
const SRC = 'export function f(): number {\n  return 1;\n}\n\nexport function g(): number {\n  return 9;\n}\n';
fs.writeFileSync(path.join(PROJ, REL), SRC);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { editCode } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/refactor/edit/edit_code.js');
const { writeRewritePlan } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js');
const { contentHash } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');
const { getDSL, saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't383' });
// 夹具文件是量具 ⇒ 设计侧声明豁免写闸
{
  const dsl = getDSL('t383');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}
const h0 = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));

const doEdit = async (what) => {
  const r = await editCode({
    project_dir: PROJ,
    file: REL,
    symbol: 'g',
    code: 'export function g(): number {\n  return 8;\n}\n',
    reason: `t383 夹具：${what}`,
    actor: 'agent:t383',
  });
  return String(r?.message ?? '');
};

// ── ④ 没有画布 ⇒ 不出现 ──────────────────────────────────
{
  const msg = await doEdit('没画布');
  chk(!/出口闭环/.test(msg), '④ 没有画布 ⇒ 回执**不出现**出口行（写前 planGate 已点名）', msg.split('\n').slice(0, 2).join(' / ').slice(0, 120));
}

// ── ② 有画布但锚点没兑现 ⇒ 出一行点名 not_yet ─────────────
{
  // 画布说要改 f（但本次改的是 g）⇒ f 的哈希/状态与计划不符
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: h0 },
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回 2', judgement_ref: 'cert:t383/②', status: 'open' }],
  });
  const msg = await doEdit('有画布但改的不是计划里的符号');
  chk(/出口闭环/.test(msg), '② 有画布 ∧ 计划没兑现 ⇒ 回执**出现一行**', msg.split('\n').filter((l) => /出口闭环/.test(l))[0]?.slice(0, 130) ?? '');
  chk(/计划外符号/.test(msg), '③ 并且点名**计划外符号**（改了 `g` 却不在画布里）', msg.split('\n').filter((l) => /计划外/.test(l))[0]?.slice(0, 130) ?? '');
  chk(msg.split('\n').filter((l) => /出口闭环/.test(l)).length === 1, '⑤ 只出声**一行**（不贴整份对账表）');
}

// ── ① 计划已落地 ⇒ 不吵 ──────────────────────────────────
{
  // ★ 先把这个文件收敛成**只有一个符号**（否则"另一个符号没进画布"永远算计划外 ⇒ 这一条测不到"全绿不吵"）
  fs.writeFileSync(path.join(PROJ, REL), 'export function g(): number {\n  return 9;\n}\n');
  {
    const { syncFile } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');
    const { getProjectCacheDb } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/db.js');
    await syncFile(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));
  }
  // 把画布改成"改 g"，且冻结指纹用**改之前**的 hash；再改一次 g ⇒ realized
  const hBefore = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: hBefore },
    entries: [{ anchor: { symbol: 'g' }, kind: 'rewrite', detail: '返回 7', judgement_ref: 'cert:t383/①', status: 'open' }],
  });
  const msg = await doEdit('计划已落地');
  chk(!/出口闭环/.test(msg), '① 计划全落地（无 not_yet、无计划外）⇒ 回执**不出声**（全绿不吵）', msg.split('\n').slice(0, 2).join(' / ').slice(0, 120));
}

console.log(`\n═══ T383 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
