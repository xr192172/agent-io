#!/usr/bin/env node
/**
 * ★★★ cert T393 —— **卡挂在画布上，改集跨文件**（2026-10-28 · 用户）
 *
 * ## 用户的话
 * 「任务卡挂单文件节点是不是不太对，后续应该挂在**画布**和**探索后的改集**上吧」
 * —— 对：一个任务天然跨文件（"加一条判据" = `rewrite_plan.ts` + `write_gate.ts` + 证），
 * 而卡挂在**单文件节点**上 ⇒ 读集只覆盖"节点指到的那一份"，其余文件对并发闸是**瞎的**。
 *
 * ## 判据（每条亲手跑）
 *   ① 一张卡**两份画布** ⇒ `planChangeSetOfCard` 给出**两个文件**的改集（并集、去重）；
 *   ② **只认 `card` 字段**：别的卡的画布 / 没卡的画布**都不算**（不按目录猜）；
 *   ③ 全 `done` 的条目**不进改集**（坍缩集语义不变）；
 *   ④ claim 读集用得上：`basis` 含 `canvas`，符号来自**两个文件**（不再只有一个）；
 *   ⑤ 卡没登记任何画布 ⇒ **回落**"节点 path 那一份"（兼容旧用法，不静默归零）；
 *   ⑥ `design_line action=plan` 回执把**卡的改集**印出来（人一眼看出跨几个文件）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 卡的**身份**仍是 DSL 节点 id（改这一点要动 `TaskSpec` 的 schema）——本证只把"卡拥有多份画布"接上；
 *   · **[未核] 竞态**：两份画布的 `card` 字段先后写入不在同一事务里（画布是独立文件）。
 *
 * ## 用法
 *   node certs/t393-card-change-set-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, claim_conflict.ts, src/application/design/index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp393card-'));
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

const A = 'src/a.ts';
const B = 'src/b.ts';
fs.writeFileSync(path.join(PROJ, A), 'export function fa(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, B), 'export function fb(): number {\n  return 2;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { planChangeSetOfCard, planFilesForCard, writeRewritePlan, planChangeSet } = await import(
  D + 'application/design/db/rewrite_plan.js'
);
const { computeClaimReadSet } = await import(D + 'application/claim_conflict.js');

await importProject({ project_dir: PROJ, feature: 't393' });

const E = (sym, status = 'open') => ({
  anchor: { symbol: sym },
  kind: 'rewrite',
  detail: 'x',
  judgement_ref: 'cert:t393#①',
  judgement_kind: 'behavior-cases',
  status,
});

// 同一张卡的两份画布 + 别人的一份 + 没卡的一份
writeRewritePlan(PROJ, { path: A, card: 'card-1', frozen_at: new Date().toISOString(), entries: [E('fa')] });
writeRewritePlan(PROJ, { path: B, card: 'card-1', frozen_at: new Date().toISOString(), entries: [E('fb'), E('fa', 'done')] });
writeRewritePlan(PROJ, { path: 'src/other.ts', card: 'card-2', frozen_at: new Date().toISOString(), entries: [E('zz')] });
writeRewritePlan(PROJ, { path: 'src/nocard.ts', frozen_at: new Date().toISOString(), entries: [E('yy')] });

// ── ①②③ 卡级改集 ──────────────────────────────────────
{
  const files = planFilesForCard(PROJ, 'card-1');
  chk(files.length === 2 && files.includes(A) && files.includes(B), '① 一张卡找到**两份画布**', JSON.stringify(files));
  const cs = planChangeSetOfCard(PROJ, 'card-1');
  const key = cs.map((c) => `${c.file}#${c.symbol}`).sort();
  chk(
    key.length === 2 && key.includes(`${A}#fa`) && key.includes(`${B}#fb`),
    '①-b 改集跨**两个文件**（并集去重）',
    JSON.stringify(key),
  );
  chk(!key.some((k) => k.startsWith('src/other') || k.startsWith('src/nocard')), '② **只认 `card` 字段**（别人的、没卡的都不算）');
  chk(!key.some((k) => k.endsWith('#fa') && k.startsWith(B)), '③ `done` 条目**不进改集**（B#fa 已 done）');
}

// ── ④ claim 读集跨文件 ──────────────────────────────────
{
  const r = computeClaimReadSet({ root: PROJ, cardId: 'card-1', node: { id: 'card-1', path: A } });
  const fileSet = new Set(r.readSet.symbols.map((s) => s.file));
  chk((r.readSet.basis ?? []).includes('canvas'), '④ claim 读集 `basis` 含 `canvas`', (r.readSet.basis ?? []).join('+'));
  chk(fileSet.size === 2, '④-b 读集符号**来自两个文件**（并发闸不再只对一个文件有效）', [...fileSet].join(', '));
}

// ── ⑤ 卡没画布 ⇒ 回落节点那份 ───────────────────────────
{
  const r = computeClaimReadSet({ root: PROJ, cardId: 'card-none', node: { id: 'card-none', path: A } });
  const names = r.readSet.symbols.map((s) => s.name).join(',');
  chk(names.includes('fa'), '⑤ 卡没登记画布 ⇒ **回落**"节点 path 那一份"（不静默归零）', `names=${names} basis=${(r.readSet.basis ?? []).join('+')}`);
}

// ── ⑥ 回执印出卡的改集 ─────────────────────────────────
{
  const out = (() => {
    try {
      return execFileSync(
        'node',
        ['dist/src/presentation/cli/cli.js', 'design_line', `project_dir=${PROJ}`, 'action=plan', `file=${A}`],
        { encoding: 'utf8', cwd: 'D:/agentio/dev/agent-io', env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' } },
      );
    } catch (e) {
      return String(e.stdout ?? '') + String(e.stderr ?? '');
    }
  })();
  const line = out.split('\n').find((l) => /的\*\*改集\*\*/.test(l));
  chk(!!line && /src\/a\.ts#fa/.test(line) && /src\/b\.ts#fb/.test(line), '⑥ 回执把**卡的改集**印出来（跨文件一眼可见）', line?.trim().slice(0, 130) ?? '(没有这行)');
}

console.log(`\n═══ T393 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
