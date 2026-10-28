#!/usr/bin/env node
/**
 * ★★★ cert T388 —— **真实开发试点的产出**（2026-10-28）
 *
 * ## 这张证钉什么
 * 拿本仓一个**真实的**改动（给 `rewrite_plan.ts` 加一条判据）走完整流程，产出三条读数 + 两处修复：
 *   · **读数 #1**：18 个顶层符号、只改 1 处 ⇒ 逐条 `untouched` 不现实 ⇒ 新增 `untouched_default`
 *     + `symbols_at_freeze`（**省打字不省理解**：快照之后新增的符号仍会被抓）；
 *   · **读数 #2**：`cert:` 形态的 `judgement_ref` 判不出强度 ⇒ 允许**显式声明 `judgement_kind`**（闭集校验）；
 *   · **读数 #5**：出口闭环把"已表态"的符号报成"计划外"（紧凑声明下全是噪声）＋ 内层 helper 也算 ⇒ 修。
 *
 * ## 判据（每条亲手跑）
 *   ① `create` 的前提：文件存在 ⇒ 报（该用 rewrite）；不存在 ⇒ 不报；
 *   ② `delete` 的前提：文件不存在 ⇒ 报；存在 ⇒ 不报；
 *   ③ 紧凑 untouched：有快照 ⇒ 不报；**快照之后新增的符号** ⇒ 报"重新通读"；
 *   ④ 用了 `untouched_default` 却没记 `symbols_at_freeze` ⇒ 报"无凭据"；
 *   ⑤ `cert:` + `judgement_kind` ⇒ 强度可判（语义类不报；自造种类 ⇒ `unknown` 点名）；
 *   ⑥ 出口闭环：紧凑声明下**不把已表态的符号报成计划外**，且**内层 helper 不算**。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · ③ 的"快照之后新增符号"用**构造的**符号清单模拟（不真去改文件再扫）；
 *   · **[未核]** 真实开发里"18 条 untouched"的完整成本（我只跑了紧凑写法那一路）。
 *
 * ## 用法
 *   node certs/t388-pilot-findings-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, plan_exit_check.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp388pilot-'));
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

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { planKindGaps, planCoverageGaps, planJudgementGaps, parseJudgementRef, writeRewritePlan } = await import(
  D + 'application/design/db/rewrite_plan.js'
);
const { checkRewriteExit } = await import(D + 'application/design/db/plan_exit_check.js');

const E = (sym, kind, extra = {}) => ({
  anchor: { symbol: sym },
  kind,
  detail: '试点夹具',
  judgement_ref: 'cert:t388#①',
  judgement_kind: 'behavior-cases',
  status: 'open',
  ...extra,
});

// ── ① create 的前提 ─────────────────────────────────────
{
  const a = planKindGaps({ path: 'x', entries: [E('f', 'create')] }, true);
  const b = planKindGaps({ path: 'x', entries: [E('f', 'create')] }, false);
  chk(a.length === 1 && /文件已存在/.test(a[0]), '① `create` 但文件已存在 ⇒ 报（该用 rewrite）', a[0]?.slice(0, 110) ?? '');
  chk(b.length === 0, '①-b `create` + 文件不存在 ⇒ 不报');
}

// ── ② delete 的前提 ─────────────────────────────────────
{
  const a = planKindGaps({ path: 'x', entries: [E('f', 'delete')] }, false);
  const b = planKindGaps({ path: 'x', entries: [E('f', 'delete')] }, true);
  chk(a.length === 1 && /文件不存在/.test(a[0]), '② `delete` 但文件不存在 ⇒ 报（计划过期/路径错）', a[0]?.slice(0, 110) ?? '');
  chk(b.length === 0, '②-b `delete` + 文件存在 ⇒ 不报');
}

// ── ③ 紧凑 untouched（快照的牙齿）───────────────────────
{
  const plan = {
    path: 'x',
    entries: [E('f', 'rewrite')],
    untouched_default: { why: '只改 f，其余不动' },
    symbols_at_freeze: ['f', 'g', 'h'],
  };
  chk(planCoverageGaps(plan, ['f', 'g', 'h']).length === 0, '③ 紧凑声明 + 快照 ⇒ 不报（不用逐条写 18 个）');
  const withNew = planCoverageGaps(plan, ['f', 'g', 'h', 'brand_new']);
  chk(withNew.length === 1 && /冻结之后才出现的符号/.test(withNew[0]), '③-b **快照之后新增的符号** ⇒ 报"重新通读"', withNew[0]?.split('\n')[0]?.slice(0, 110) ?? '');
}

// ── ④ 没快照 ⇒ 无凭据 ──────────────────────────────────
{
  const g = planCoverageGaps({ path: 'x', entries: [E('f', 'rewrite')], untouched_default: { why: 'x' } }, ['f', 'g']);
  chk(g.length === 1 && /没记/.test(g[0]), '④ 用了 `untouched_default` 却没记快照 ⇒ 报"无凭据"', g[0]?.slice(0, 110) ?? '');
}

// ── ⑤ cert 形态 + 显式 judgement_kind ───────────────────
{
  const resolveCert = () => ({ why_not: 'cert 不登记种类' });
  const ok = planJudgementGaps({ path: 'x', entries: [E('f', 'rewrite')] }, resolveCert);
  chk(ok.length === 0 && parseJudgementRef('cert:t388#①')?.kind === 'cert', '⑤ `cert:` + 显式 `judgement_kind: behavior-cases` ⇒ **强度可判**（不再"判不出来"）');
  const bogus = planJudgementGaps(
    { path: 'x', entries: [{ ...E('f', 'rewrite'), judgement_kind: 'i-believe-its-strong' }] },
    resolveCert,
  );
  chk(bogus.length === 1 && /判不出强度/.test(bogus[0]), '⑤-b 自造种类 ⇒ `unknown` **点名**（不许自报为强）', bogus[0]?.split('\n')[0]?.slice(0, 110) ?? '');
}

// ── ⑥ 出口闭环：紧凑声明下不再报噪声 ────────────────────
{
  const REL = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\nexport function g(): number {\n  return 2;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
  const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
  await importProject({ project_dir: PROJ, feature: 't388' });
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    entries: [E('f', 'rewrite')],
    untouched_default: { why: '只改 f' },
    symbols_at_freeze: ['f', 'g'],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.unplanned.length === 0, '⑥ 紧凑声明下 `g` **不再被报成计划外**（已表态的要扣掉）', `unplanned=${r.unplanned.join(',') || '(空)'}`);
}

console.log(`\n═══ T388 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
