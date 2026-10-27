#!/usr/bin/env node
/**
 * ★★★ cert T381 —— **出口闭环**：写完之后，源码与画布逐条对得上吗？（2026-10-28 · 第 4 步）
 *
 * ## 为什么有这张证
 * 计划写完 ≠ 改到位。没有这一环，"设计完成"与"代码正确"永远是两句话。
 * 本证钉的是 `plan_exit_check.ts` 的三类判定 + 一条**诚实边界**。
 *
 * ## 判据（每条亲手跑）
 *   ① `rewrite` 类：锚点在 ∧ 文件自冻结以来**改过** ⇒ `realized`；
 *   ② `rewrite` 类：锚点在、但文件**没变过** ⇒ `not_yet`（"计划说了没做"）；
 *   ③ 锚点**找不到**（改名/删了）⇒ `stale_anchor`（只标，不自动改计划）；
 *   ④ `delete` 类：符号已消失 ⇒ `realized`；还在 ⇒ `not_yet`；
 *   ⑤ **计划外符号**必须报出来（改了却没计划 = 静默风险的唯一出口）；
 *   ⑥ ★ **判不了就明说**：画布没记冻结指纹 ⇒ `unjudgeable`，且 `judgement_ref_runs_needed`
 *      把"判据得另跑"如实列出来（本模块**不假装**判过判据）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 索引不可用时整份结果降级为 `unjudgeable` 并带 `error`（不猜）——本证在索引可用的路径上跑；
 *   · **[未核] 哈希只证明"变了"，不证明"变成想要的"** —— 这是本模块的**边界**，不是缺陷，
 *     要判"对"还得跑 `judgement_ref` 指的那套判据。
 *
 * ## 用法
 *   node certs/t381-exit-loop-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/plan_exit_check.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp381exit-'));
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

const REL = 'src/a.ts';
const writeSrc = (body) => fs.writeFileSync(path.join(PROJ, REL), body);
const writePlan = (plan) => {
  const file = path.join(PROJ, '.agent-io/plan', `${REL}.plan.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(plan, null, 2));
};

writeSrc('export function f(): number {\n  return 1;\n}\n\nexport function g(): number {\n  return 9;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { checkRewriteExit, renderExitCheck } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/design/db/plan_exit_check.js');
const { contentHash } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');

await importProject({ project_dir: PROJ, feature: 't381exit' });
const frozenHash = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));

// ── ② 计划说改、文件却没变 ⇒ not_yet ──────────────────────
{
  writePlan({
    path: REL,
    frozen_at: '2026-10-28T03:00:00+08:00',
    base: { content_hash: frozenHash },
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回 2', judgement_ref: 'cert:t381/②', status: 'open' },
    ],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.entries[0]?.verdict === 'not_yet', '② 锚点在、但文件**自冻结以来没变** ⇒ `not_yet`（计划说了没做）', r.entries[0]?.why ?? '');
}

// ── ① 改了文件 ⇒ realized ────────────────────────────────
{
  writeSrc('export function f(): number {\n  return 2;\n}\n\nexport function g(): number {\n  return 9;\n}\n');
  const { syncFileSync } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');
  const { getProjectCacheDb } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/db.js');
  syncFileSync(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));
  const r = checkRewriteExit(PROJ, REL);
  chk(r.entries[0]?.verdict === 'realized', '① 锚点在 ∧ 哈希变了 ⇒ `realized`', r.entries[0]?.why ?? '');
}

// ── ③ 锚点找不到 ⇒ stale_anchor ─────────────────────────
{
  writePlan({
    path: REL,
    base: { content_hash: frozenHash },
    entries: [
      { anchor: { symbol: 'noSuchSymbol' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t381/③', status: 'open' },
    ],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.entries[0]?.verdict === 'stale_anchor', '③ 锚点在文件里找不到 ⇒ `stale_anchor`（只标不改计划）', r.entries[0]?.why ?? '');
}

// ── ④ delete 类：还在 ⇒ not_yet ─────────────────────────
{
  writePlan({
    path: REL,
    base: { content_hash: frozenHash },
    entries: [
      { anchor: { symbol: 'g' }, kind: 'delete', detail: '删掉 g', judgement_ref: 'cert:t381/④', status: 'open' },
    ],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.entries[0]?.verdict === 'not_yet', '④-a `delete` 类：符号还在 ⇒ `not_yet`', r.entries[0]?.why ?? '');
  // 真删掉 g 再核
  writeSrc('export function f(): number {\n  return 2;\n}\n');
  const { syncFileSync } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/symbols.js');
  const { getProjectCacheDb } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/index/db.js');
  syncFileSync(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));
  const r2 = checkRewriteExit(PROJ, REL);
  chk(r2.entries[0]?.verdict === 'realized', '④-b 真删掉之后 ⇒ `realized`', r2.entries[0]?.why ?? '');
}

// ── ⑤ 计划外符号要报出来 ─────────────────────────────────
{
  const r = checkRewriteExit(PROJ, REL);
  chk(r.unplanned.includes('f'), '⑤ **计划外符号**报出来（`f` 改了却没进计划）', `unplanned=${r.unplanned.join(',') || '(空)'}`);
}

// ── ⑥ 没有冻结指纹 ⇒ unjudgeable（不许假装判过）──────────
{
  writePlan({
    path: REL,
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t381/⑥', status: 'open' },
    ],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.entries[0]?.verdict === 'unjudgeable', '⑥ 画布没记冻结指纹 ⇒ `unjudgeable`（不假装判过）', r.entries[0]?.why ?? '');
  chk(r.judgement_ref_runs_needed.length === 1, '⑥-b `judgement_ref` 如实列进"需另跑"清单（本模块不执行判据）', r.judgement_ref_runs_needed.join(','));
  console.log(`   ${renderExitCheck(r)}`);
}

console.log(`\n═══ T381 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
