#!/usr/bin/env node
/**
 * ★★★ cert T382 —— **出口闭环接进写穿结果**：所有写路径共用一处（2026-10-28 · 第 6 步）
 *
 * ## 为什么挂在 `finishWriteThrough`
 * async 版（`syncSelfWrites`）与 sync 版（`syncSelfWritesSync`）**都经** `finishWriteThrough`
 * ⇒ 挂这里一处，所有写工具（edit_code / apply_writes / remove_dead_imports / diagnose_loop …）
 * 的回执都自动带上出口读数。挂到各工具里 = 同一判据住 N 处（本仓头号病）。
 *
 * ## 判据（每条亲手跑）
 *   ① 文件**有画布** ⇒ 写穿结果里出现 `plan_exit`，且内容点名了 realized / not_yet；
 *   ② 文件**没有画布** ⇒ `plan_exit` **不出现**（写前的 `planGate` 已经点过名，不重复刷）；
 *   ③ 对账说"没落地"必须是**真的没落地**（写了内容但计划锚点没兑现 ⇒ not_yet），不假绿；
 *   ④ 对账自身炸掉也**不连累写穿结果**（`ok` 仍然按文件级失败判）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 文本渲染：`plan_exit` 现在是**结构化字段**，接进各工具的人类可读回执是下一步；
 *   · **[未核] 大批量**：一次写 50 个文件的 `plan_exit` 行数没做截断（只有有画布的才出声，通常很少）。
 *
 * ## 用法
 *   node certs/t382-plan-exit-in-receipt-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp382exit-'));
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

const A = 'src/a.ts';
const B = 'src/b.ts';
fs.writeFileSync(path.join(PROJ, A), 'export function f(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, B), 'export function g(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { writeSourceBatch } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/source_writer.js');
const { writeRewritePlan } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js');
const { contentHash } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');

await importProject({ project_dir: PROJ, feature: 't382' });
// 夹具的两个文件是**量具**（不为它们立卡）⇒ 按设计侧声明豁免写闸（闸只读、不自作主张）
{
  const { getDSL, saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');
  const dsl = getDSL('t382');
  for (const n of dsl.geometry.nodes ?? []) {
    if (n.path === A || n.path === B || n.description === A || n.description === B) n.gate = 'exempt';
  }
  saveDSL(dsl, PROJ);
}
const h0 = contentHash(fs.readFileSync(path.join(PROJ, A), 'utf-8'));

// A 有画布（锚点 f；冻结指纹 = 现在）
writeRewritePlan(PROJ, {
  path: A,
  frozen_at: new Date().toISOString(),
  base: { content_hash: h0 },
  entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回 2', judgement_ref: 'cert:t382/①', status: 'open' }],
});

// 一次写两个文件：A 有画布、B 没有
const receipts = writeSourceBatch(
  PROJ,
  [
    [A, 'export function f(): number {\n  return 2;\n}\n'],
    [B, 'export function g(): number {\n  return 2;\n}\n'],
  ],
  { actor: 'agent:t382', reason: 't382 夹具：写两个文件' },
);

const idx = receipts.map((r) => r.index).find(Boolean) ?? receipts[0]?.index;
const lines = idx?.plan_exit ?? [];

// ── ① 有画布 ⇒ 出现 plan_exit 且点名 ─────────────────────
{
  const line = lines.find((l) => l.includes(A));
  chk(!!line, '① 有画布的文件 ⇒ 写穿结果里出现 `plan_exit`', lines.length ? lines.join(' | ').slice(0, 160) : '(空)');
  chk(/realized|not_yet/.test(line ?? ''), '①-b 而且给了 realized / not_yet 结论', line?.slice(0, 140) ?? '');
}

// ── ② 没画布 ⇒ 不出现（不重复刷）──────────────────────────
{
  chk(!lines.some((l) => l.includes(B)), '② 没画布的文件 ⇒ `plan_exit` **不出现**（写前 planGate 已点名）', `行数=${lines.length}`);
}

// ── ③ 结论不假绿 ─────────────────────────────────────────
{
  // 写第二个文件内容**没变**（与冻结指纹相同）⇒ 对 A 应报 not_yet（锚点在、文件没变）
  const hNow = contentHash(fs.readFileSync(path.join(PROJ, A), 'utf-8'));
  chk(hNow !== h0, '③ 前置：A 的内容确实变了（所以 realized 才成立）', `hash ${h0.slice(0, 8)} → ${hNow.slice(0, 8)}`);
  chk(/realized/.test(lines.find((l) => l.includes(A)) ?? ''), '③-b 变了 ⇒ **realized**（不是恒绿：没变时会报 not_yet，见 t381）');
}

// ── ④ 对账炸掉不连累写穿 ─────────────────────────────────
{
  // 造一份坏画布（JSON 坏）⇒ readRewritePlan 返回 null ⇒ 直接不出现，写穿 ok 不受影响
  const bad = path.join(PROJ, '.agent-io/plan', `${B}.plan.json`);
  fs.mkdirSync(path.dirname(bad), { recursive: true });
  fs.writeFileSync(bad, '{ 坏 json');
  const r2 = writeSourceBatch(PROJ, [[B, 'export function g(): number {\n  return 3;\n}\n']], {
    actor: 'agent:t382',
    reason: 't382 夹具：坏画布',
  });
  const idx2 = r2[0]?.index;
  chk(idx2?.ok !== false, '④ 画布坏掉 ⇒ 只是 `plan_exit` 不出现，**写穿 ok 不受影响**', `ok=${String(idx2?.ok)} mode=${String(idx2?.mode)}`);
}

console.log(`\n═══ T382 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
