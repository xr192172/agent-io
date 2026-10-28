#!/usr/bin/env node
/**
 * ★★★ cert T391 —— **坍缩集自转**：出口闭环驱动条目状态（2026-10-28）
 *
 * ## 为什么
 * 用户点出「设计完后应该坍缩成被改动的节点」之后，又暴露一个死角：**活干完了，`status` 还是 `open`**
 * ⇒ 坍缩集永远停在"设计时的样子" ⇒ 并发闸会一直挡着已经做完的符号。
 * ⇒ `syncPlanStatuses`：按出口闭环结论推进状态（`realized ⇒ done`、`stale_anchor ⇒ stale`），**只推进不倒退**。
 *
 * ## 判据（每条亲手跑）
 *   ① `realized` + `open` ⇒ **`done`**（并记 `done_at`）；
 *   ② `stale_anchor` + `open` ⇒ **`stale`**（只标，不删不改锚点）；
 *   ③ `not_yet` / `unjudgeable` ⇒ **不动**（没落地就不许标完成）；
 *   ④ **只推进不倒退**：已是 `done` 的条目即使这次判 `not_yet` 也**不回退**；
 *   ⑤ 端到端：推进后 `planChangeSet` **少一个符号**（并发读集随之收缩）；
 *   ⑥ `design_line action=plan,sync_status=true` 真跑：回执点名推进了几条、写回后能读回 `done`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只推进 `open` 的条目；`stale` 的条目**不会**自动变 `done`（要先人工核对锚点）；
 *   · **[未核]** `done` 之后锚点又消失的场景：出口闭环会报 `stale_anchor`，但状态不回退（设计如此）。
 *
 * ## 用法
 *   node certs/t391-status-advance-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, plan_exit_check.ts, src/application/design/index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp391adv-'));
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
const { syncPlanStatuses, planChangeSet, writeRewritePlan, readRewritePlan } = await import(
  D + 'application/design/db/rewrite_plan.js'
);

await importProject({ project_dir: PROJ, feature: 't391' });

const E = (sym, status = 'open') => ({
  anchor: { symbol: sym },
  kind: 'rewrite',
  detail: 'x',
  judgement_ref: 'cert:t391#①',
  judgement_kind: 'behavior-cases',
  status,
});

// ── ①②③④ 纯函数四态 ────────────────────────────────────
{
  const plan = { path: REL, entries: [E('f'), E('g'), E('h'), E('i', 'done')] };
  const r = syncPlanStatuses(plan, [
    { index: 0, verdict: 'realized' },
    { index: 1, verdict: 'stale_anchor' },
    { index: 2, verdict: 'not_yet' },
    { index: 3, verdict: 'realized' }, // 已经 done，不该再变
  ]);
  chk(r.plan.entries[0].status === 'done' && !!r.plan.entries[0].done_at, '① realized + open ⇒ **done**（并记 done_at）', JSON.stringify(r.plan.entries[0]).slice(0, 120));
  chk(r.plan.entries[1].status === 'stale', '② stale_anchor + open ⇒ **stale**（只标不删）');
  chk(r.plan.entries[2].status === 'open', '③ not_yet ⇒ **不动**（没落地不许标完成）');
  chk(r.plan.entries[3].status === 'done' && r.changes.length === 2, '④ 已 done 的不回退；本次共推进 2 条', `changes=${JSON.stringify(r.changes)}`);
  chk(syncPlanStatuses(plan, [{ index: 0, verdict: 'not_yet' }]).plan.entries[0].status === 'open', '④-b 只推进不倒退（open 判 not_yet 仍是 open）');
}

// ── ⑤ 推进后坍缩集收缩 ──────────────────────────────────
{
  const plan = { path: REL, entries: [E('f'), E('g')] };
  const before = planChangeSet(plan).length;
  const { plan: after } = syncPlanStatuses(plan, [{ index: 0, verdict: 'realized' }]);
  const afterN = planChangeSet(after).length;
  chk(before === 2 && afterN === 1, '⑤ 推进后**坍缩集少一个符号**（并发读集随之收缩）', `${before} → ${afterN}`);
}

// ── ⑥ 端到端：design_line action=plan sync_status=true ──
{
  // 夹具：画布说 f 要改，冻结指纹取**改之前**；然后真改文件 ⇒ 出口闭环 realized ⇒ 应自动标 done
  const { contentHash } = await import(D + 'infrastructure/index/symbols.js');
  const h0 = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: h0 },
    entries: [E('f')],
    untouched_default: { why: '夹具：只改 f' },
    symbols_at_freeze: ['f'],
  });
  fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 42;\n}\n');
  // 索引同步（真流程里由写路径做；这里手工补）
  const { getProjectCacheDb } = await import(D + 'infrastructure/index/db.js');
  const { syncFile } = await import(D + 'infrastructure/index/symbols.js');
  await syncFile(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));

  const out = (() => {
    try {
      return execFileSync(
        'node',
        ['dist/src/presentation/cli/cli.js', 'design_line', `project_dir=${PROJ}`, 'action=plan', `file=${REL}`, 'sync_status=true'],
        { encoding: 'utf8', cwd: 'D:/agentio/dev/agent-io' },
      );
    } catch (e) {
      return String(e.stdout ?? '') + String(e.stderr ?? '');
    }
  })();
  const line = out.split('\n').find((l) => /状态推进|状态无需推进/.test(l));
  chk(!!line && /f open→done/.test(line), '⑥ `sync_status=true` 真跑：回执点名 `f open→done`', line?.trim().slice(0, 120) ?? '(没这行)');
  const j = readRewritePlan(PROJ, REL);
  chk(j?.entries?.[0]?.status === 'done', '⑥-b 写回后能读回 `done`', `status=${j?.entries?.[0]?.status}`);
}

console.log(`\n═══ T391 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
