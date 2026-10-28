#!/usr/bin/env node
/**
 * ★★★ cert T392 —— `sync_status` 成默认 + 严格档下**画布过期就拦**（2026-10-28 · T-#RP-2 收尾）
 *
 * ## 两件事
 * ① **推进默认化**：`design_line action=plan` 在**只读模式**（没给 `entries`）下默认跑
 *    `sync_status`（只前进不倒退，低风险）；**写模式（给了 entries）不推进** ——
 *    调用方写 entries 时说的是"我要做这些"，不是"这些已经做完了"。
 * ② **严格档拦画布过期**：`AGENT_IO_REQUIRE_PLAN=1` 且 `via=canvas` 的 stale 非空 ⇒ **拒写**。
 *    严格档本来就是人开的；开了还放过"你的计划是对着旧内容写的"，那严格档等于没开。默认档仍**只报不拦**。
 *
 * ## 判据（每条亲手跑）
 *   ① 只读模式（不给 entries）⇒ 自动推进并写回（回执点名）；
 *   ② 写模式（给 entries + apply）⇒ **不自动推进**（新写的计划保持 `open`）；
 *   ③ 严格档 + 画布过期 ⇒ **拒写**，错误里点名文件与"怎么办"；
 *   ④ 默认档 + 画布过期 ⇒ **只报不拦**（落盘成功，`assumption_check` 里有 canvas stale）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · ① 依赖出口闭环判定（文件确实变了且锚点在）—— 夹具用真改文件 + 索引同步来造；
 *   · **[未核]** 严格档与"任务闸"同时不满足时的先后：任务闸在前（实测），本证夹具已豁免任务闸。
 *
 * ## 用法
 *   node certs/t392-sync-default-strict-canvas-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/index.ts, src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp392sync-'));
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
const write = (n) => fs.writeFileSync(path.join(PROJ, REL), `export function f(): number {\n  return ${n};\n}\n`);
write(1);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { writeRewritePlan, readRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
const { contentHash, syncFile } = await import(D + 'infrastructure/index/symbols.js');
const { getProjectCacheDb } = await import(D + 'infrastructure/index/db.js');
const { assertSourceWriteRegistered } = await import(D + 'application/write_gate.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't392' });
{
  const dsl = getDSL('t392');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

const cli = (args, env = {}) => {
  try {
    return execFileSync('node', ['dist/src/presentation/cli/cli.js', ...args], {
      encoding: 'utf8',
      cwd: 'D:/agentio/dev/agent-io',
      env: { ...process.env, ...env },
    });
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};
const E = (status = 'open') => ({
  anchor: { symbol: 'f' },
  kind: 'rewrite',
  detail: '返回 42',
  judgement_ref: 'cert:t392#①',
  judgement_kind: 'behavior-cases',
  status,
});

// ── ② 写模式（给 entries）⇒ 不自动推进 ─────────────────
{
  const out = cli([
    'design_line',
    `project_dir=${PROJ}`,
    'action=plan',
    `file=${REL}`,
    `entries=${JSON.stringify([E()])}`,
    'apply=true',
  ]);
  const j = readRewritePlan(PROJ, REL);
  chk(j?.entries?.[0]?.status === 'open', '② 写模式不自动推进（新写的计划保持 `open`）', `status=${j?.entries?.[0]?.status}`);
  chk(/已落盘/.test(out) && !/状态推进 [1-9]/.test(out), '②-b 回执里没有"状态推进"那一行');
}

// ── ① 只读模式 ⇒ 自动推进（先把文件真改掉、索引同步）─────
{
  const h0 = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: h0 },
    entries: [E()],
    untouched_default: { why: '夹具：只改 f' },
    symbols_at_freeze: ['f'],
  });
  write(42);
  await syncFile(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));
  const out = cli(['design_line', `project_dir=${PROJ}`, 'action=plan', `file=${REL}`]);
  const line = out.split('\n').find((l) => /状态推进/.test(l));
  chk(!!line && /f open→done/.test(line), '① 只读模式**默认推进**并点名', line?.trim().slice(0, 110) ?? '(没有这行)');
  chk(readRewritePlan(PROJ, REL)?.entries?.[0]?.status === 'done', '①-b 推进已写回画布（读回是 `done`）');
}

// ── ③④ 画布过期：严格档拦 / 默认档只报 ─────────────────
{
  // 造"画布过期"：再改一次文件（画布快照停在上一版）
  write(77);
  await syncFile(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));

  let thrown = '';
  process.env.AGENT_IO_REQUIRE_PLAN = '0'; // ★ 默认已开 ⇒ 这一条要显式关档才是"默认档"
  try {
    assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  } catch (e) {
    thrown = e.message;
  }
  chk(thrown === '', '④ 默认档：画布过期**只报不拦**（落盘放行）');

  process.env.AGENT_IO_REQUIRE_PLAN = '1';
  let thrown2 = '';
  try {
    assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  } catch (e) {
    thrown2 = e.message;
  }
  delete process.env.AGENT_IO_REQUIRE_PLAN;
  chk(/拒绝落盘（画布过期）/.test(thrown2), '③ 严格档：画布过期 ⇒ **拒写**', thrown2.split('\n')[0]?.slice(0, 110) ?? '(没拦)');
  chk(/怎么办/.test(thrown2) && new RegExp(REL).test(thrown2), '③-b 错误里点名文件 + 给出"怎么办"');
}

console.log(`\n═══ T392 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
