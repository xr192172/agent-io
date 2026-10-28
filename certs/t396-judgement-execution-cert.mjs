#!/usr/bin/env node
/**
 * ★★★ cert T396 —— **判据真的被执行**（2026-10-28 · "能发现逻辑 bug"的最后一里）
 *
 * ## 为什么
 * 前面把"判据**强不强**"判清楚了，但**判据本身从来没跑过** —— 出口闭环只吐一句"判据需另跑"。
 * 声明得再强，不跑就等于"验过了"的幻觉。⇒ `runPlanJudgements` 把画布条目接到**既有执行核**上。
 *
 * ## 判据（每条亲手跑）
 *   ① `decision:` 指向 `behavior-cases` 且实现**正确** ⇒ `pass`（真跑 `runHarness`）；
 *   ② 实现**错** ⇒ `fail`，且 detail 里能看到期望/实际；
 *   ③ `cert:` 形态 ⇒ `unresolved`（**没有执行核，不假装跑过**）；
 *   ④ 引用指不到册里的判据 ⇒ `unresolved` + 说明原因；
 *   ⑤ 全绿 ⇒ `renderJudgementLine` **返回 null**（闭嘴，不刷屏）；
 *   ⑥ 端到端：`design_line action=plan` 回执里出现「**判据执行 … 未通过**」。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · `behavior-cases` 用 **MJS 夹具 + `runHarness`**；其它 7 种 kind 的执行由 `judgeExpectations` 负责，
 *     本证只验"接线对不对"，不逐 kind 复测（那是既有证的活）；
 *   · **[未核]** 判据执行**不进**写穿回执（只在 `design_line action=plan` 只读模式下跑）—— 成本考虑。
 *
 * ## 用法
 *   node certs/t396-judgement-execution-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/judgement_run.ts, src/application/design/index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp396judge-'));
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

const REL = 'src/m.ts'; // ★ 夹具用 TS：执行核走 TS 内核（.mjs 会被当 CJS 加载 ⇒ Unexpected token 'export'）
const srcGood = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
fs.writeFileSync(path.join(PROJ, REL), srcGood);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { runPlanJudgements, renderJudgementLine } = await import(D + 'application/design/db/judgement_run.js');
const { writeRewritePlan } = await import(D + 'application/design/db/rewrite_plan.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't396' });
{
  const dsl = getDSL('t396');
  const nodes = dsl.geometry.nodes ?? [];
  const fileNode = nodes.find((n) => n.path === REL || n.description === REL);
  if (!fileNode) throw new Error('夹具：找不到文件节点');
  fileNode.id = 'n396';
  fileNode.gate = 'exempt';
  fileNode.decision = {
    summary: 't396：add 必须真的相加',
    expectations: [
      { kind: 'behavior-cases', path: REL, symbol: 'add', cases: [{ given: [2, 3], expect: '5' }], why: '行为契约' },
    ],
  };
  saveDSL(dsl, PROJ);
}

const plan = (ref, sym = 'add') => ({
  path: REL,
  entries: [{ anchor: { symbol: sym }, kind: 'rewrite', detail: 'x', judgement_ref: ref, judgement_kind: 'behavior-cases', status: 'open' }],
});

// ── ① 正确实现 ⇒ pass ───────────────────────────────────
{
  const vs = await runPlanJudgements(PROJ, plan('decision:n396#0'));
  chk(vs.length === 1 && vs[0].verdict === 'pass', '① `behavior-cases` 且实现正确 ⇒ **pass**（真跑 runHarness）', JSON.stringify(vs[0] ?? null).slice(0, 140));
}

// ── ② 错误实现 ⇒ fail（还看得到期望/实际）──────────────
{
  fs.writeFileSync(path.join(PROJ, REL), 'export function add(a: number, b: number): number {\n  return a - b;\n}\n');
  await importProject({ project_dir: PROJ, feature: 't396' });
  const vs = await runPlanJudgements(PROJ, plan('decision:n396#0'));
  chk(vs.length === 1 && vs[0].verdict === 'fail', '② 实现写错 ⇒ **fail**', JSON.stringify(vs[0] ?? null).slice(0, 160));
  chk(/5|-1|期望|实际|不等/.test(String(vs[0]?.detail)), '②-b detail 里能看出期望/实际', String(vs[0]?.detail ?? '').slice(0, 140));
}

// ── ③ cert 形态 ⇒ unresolved ────────────────────────────
{
  const vs = await runPlanJudgements(PROJ, plan('cert:t396#①'));
  chk(vs.length === 1 && vs[0].verdict === 'unresolved', '③ `cert:` 形态 ⇒ **unresolved**（不假装跑过）', String(vs[0]?.detail ?? '').slice(0, 110));
}

// ── ④ 引用指不到 ⇒ unresolved ───────────────────────────
{
  const vs = await runPlanJudgements(PROJ, plan('decision:n_ghost#7'));
  chk(vs.length === 1 && vs[0].verdict === 'unresolved' && /找不到/.test(String(vs[0].detail)), '④ 引用指不到册里的判据 ⇒ **unresolved** + 说明', String(vs[0]?.detail ?? '').slice(0, 110));
}

// ── ⑤ 全绿 ⇒ 闭嘴 ──────────────────────────────────────
{
  fs.writeFileSync(path.join(PROJ, REL), srcGood);
  await importProject({ project_dir: PROJ, feature: 't396' });
  const vs = await runPlanJudgements(PROJ, plan('decision:n396#0'));
  chk(vs[0]?.verdict === 'pass' && renderJudgementLine(vs) === null, '⑤ 全绿 ⇒ `renderJudgementLine` **返回 null**（不刷屏）', String(renderJudgementLine(vs)).slice(0, 60));
}

// ── ⑥ 端到端：回执里出现"判据执行 … 未通过" ──────────────
{
  fs.writeFileSync(path.join(PROJ, REL), 'export function add(a: number, b: number): number {\n  return a * b;\n}\n');
  await importProject({ project_dir: PROJ, feature: 't396' });
  writeRewritePlan(PROJ, { ...plan('decision:n396#0'), frozen_at: new Date().toISOString() });
  const out = (() => {
    try {
      return execFileSync(
        'node',
        ['dist/src/presentation/cli/cli.js', 'design_line', `project_dir=${PROJ}`, 'action=plan', `file=${REL}`],
        { encoding: 'utf8', cwd: 'D:/agentio/dev/agent-io', env: { ...process.env, AGENT_IO_REQUIRE_PLAN: '0' } },
      );
    } catch (e) {
      return String(e.stdout ?? '') + String(e.stderr ?? '');
    }
  })();
  const line = out.split('\n').find((l) => /判据执行/.test(l));
  chk(!!line && /未通过|fail/.test(out), '⑥ 端到端：回执里出现「**判据执行 … 未通过**」', line?.trim().slice(0, 120) ?? '(没有)');
  chk(/\[fail\]/.test(out), '⑥-b 明细里带 `[fail]` 与判据引用', out.split('\n').find((l) => /\[fail\]/.test(l))?.trim().slice(0, 130) ?? '(没有)');
}

console.log(`\n═══ T396 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
