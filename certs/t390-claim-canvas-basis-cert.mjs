#!/usr/bin/env node
/**
 * ★★★ cert T390 —— **画布坍缩集接管并发读集**（2026-10-28 · 用户："设计完后应该坍缩成被改动的节点"）
 *
 * ## 为什么
 * 画布的**展开态**（`untouched` / `symbols_at_freeze` / 判据细节）是给"通读 + 想清楚"用的；
 * 而"我要碰什么"只取决于**要改的那几个符号**。拿展开态去比并发冲突，会把"我只是看过"也算成争用
 * ⇒ 两张卡明明不打架却被判冲突（**假阻塞比漏判更打击积极性**）。
 * ⇒ 坍缩集 `planChangeSet(plan)` = `entries` 里 `status !== 'done'` 的符号。
 *
 * ## 判据（每条亲手跑）
 *   ① 坍缩集只含**未完成**的条目（`done` 的不算）；
 *   ② `claim` 算读集时**画布那一级真的接上了**：`basis` 含 `canvas`，符号数与坍缩集一致；
 *   ③ 基准**二选一**（2026-10-30 新口径）：画布非空 ⇒ 只用画布，显式声明与判据点名**一律不参与**；
 *      卡没有画布时才回到「声明 → 判据 → 节点文件」；
 *   ④ 端到端阻塞：画布坍缩集与另一张已 claim 卡的读集相交 ⇒ `detectClaimConflicts` 报冲突。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 画布坏了（JSON 坏）⇒ 跳过这一级（不把 claim 拖死），本证不覆盖该分支；
 *   · **[未核] 跨文件**：画布是单文件一份；任务碰多个文件时，只有节点 `path` 指到的那份参与。
 *
 * ## 用法
 *   node certs/t390-claim-canvas-basis-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/claim_conflict.ts, src/application/design/db/rewrite_plan.ts, src/domain/task_schema.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp390claim-'));
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
fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\nexport function g(): number {\n  return 2;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { planChangeSet, writeRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
const { computeClaimReadSet, claimBasisLine } = await import(D + 'application/claim_conflict.js');

await importProject({ project_dir: PROJ, feature: 't390' });

const plan = {
  path: REL,
  frozen_at: new Date().toISOString(),
  entries: [
    { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'cert:t390#①', judgement_kind: 'behavior-cases', status: 'open' },
    { anchor: { symbol: 'g' }, kind: 'rewrite', detail: 'y', judgement_ref: 'cert:t390#①', judgement_kind: 'behavior-cases', status: 'done' },
  ],
  untouched_default: { why: '夹具：只改 f' },
  symbols_at_freeze: ['f', 'g'],
};
writeRewritePlan(PROJ, plan);

// ── ① 坍缩集只含未完成的 ────────────────────────────────
{
  const cs = planChangeSet(plan);
  chk(cs.length === 1 && cs[0].symbol === 'f' && cs[0].file === REL, '① 坍缩集只含**未完成**的条目（`done` 的不算）', JSON.stringify(cs));
}

// ── ② claim 读集接上画布这一级 ───────────────────────────
{
  const r = computeClaimReadSet({ root: PROJ, cardId: 'n1', node: { id: 'n1', path: REL } });
  const basis = r.readSet.basis ?? [];
  chk(basis.includes('canvas'), '② 读集 **basis 含 `canvas`**（画布那一级真接上了）', `basis=${basis.join('+')}`);
  chk(
    r.readSet.symbols.length === 1 && r.readSet.symbols[0].name === 'f',
    '②-b 读集符号 = 坍缩集（只有 `f`，`g` 因为 done 而不再占位）',
    r.readSet.symbols.map((s) => s.name).join(',') || '(空)',
  );
}

// ── ③ 基准二选一：画布非空 ⇒ **只用画布**（声明被忽略；2026-10-30 口径） ──
{
  const r = computeClaimReadSet({
    root: PROJ,
    cardId: 'n2',
    node: { id: 'n2', path: REL },
    declared: { symbols: [{ file: REL, name: 'g' }] },
  });
  const names = r.readSet.symbols.map((s) => s.name).sort().join(',');
  const basis = (r.readSet.basis ?? []).join('+');
  chk(
    !names.includes('g') && basis === 'canvas' && r.basisReading.decidedBy === 'canvas',
    '③ 画布非空 ⇒ 声明**被忽略**（`g` 不进读集；basis=canvas / decidedBy=canvas）',
    `names=${names} basis=${basis} decidedBy=${r.basisReading.decidedBy}`,
  );
  const line = claimBasisLine(r.basisReading);
  chk(/冲突基准 = canvas/.test(line), '③-b 回执那行说清「冲突基准 = canvas（改集 N 个符号）」', line);
}

// ── ④ 端到端：坍缩集与别人相交 ⇒ 冲突 ────────────────────
{
  const { detectClaimConflicts } = await import(D + 'application/claim_conflict.js');
  const mine = computeClaimReadSet({ root: PROJ, cardId: 'n3', node: { id: 'n3', path: REL } });
  const other = {
    claims: [
      {
        feature: 't390',
        id: 'n_other',
        owner: 'agent:other',
        read_set: { symbols: [{ file: REL, name: 'f', fp: '' }], files: [{ path: REL, content_hash: '' }], computed_at: new Date().toISOString(), basis: ['canvas'] },
      },
    ],
    notCompared: [],
    unchecked: [],
    features: ['t390'],
    skippedStale: [],
  };
  const rep = detectClaimConflicts(mine.readSet, other.claims, other);
  chk((rep.conflicts ?? []).length > 0, '④ 画布坍缩集与别人的读集相交 ⇒ **报冲突**（并发闸真的用上了画布）', JSON.stringify(rep.conflicts?.[0] ?? null).slice(0, 140));
}

console.log(`\n═══ T390 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
