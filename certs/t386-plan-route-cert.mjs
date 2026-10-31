#!/usr/bin/env node
/**
 * ★★★ cert T386 —— **路线**：依赖成不成立、顺序有没有被违反（2026-10-28 · 迭代 ⑤）
 *
 * ## 用户的设想
 * 「设计阶段就了解一个功能的**整条路线**」⇒ 结构化重写是**有序**的：改签名 → 改调用方 → 改测试。
 * 原来"顺序"只住在模型脑子里（上下文一压缩就没了）⇒ 现在写进 `depends_on`，并由本证的四条判据把守。
 *
 * ## 判据（每条亲手跑）
 *   ① 合法 DAG ⇒ 无缺口，且 `planTopoOrder` 给出**拓扑序**（被依赖的先出现）；
 *   ② 依赖指向**不存在的锚点** ⇒ 报（路线是假的）；
 *   ③ **成环** ⇒ `planTopoOrder` 返回 `null`（**不编一个序出来**）且报"成环"；
 *   ④ **自依赖** ⇒ 报；
 *   ⑤ **顺序被违反**：某条 `done` 而它依赖的还 `open` ⇒ 报（"先做的没完成就往下做 = 赌编译"）；
 *   ⑥ 写闸 `warnings` 里真的出现这些点名。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 依赖粒度是**符号级**（`anchor.symbol`）；跨文件依赖（"先改 A 文件再改 B 文件"）目前表达不了 ——
 *     需要时把 `depends_on` 扩成 `file#symbol` 形式；
 *   · **[未核] 与真实编译的顺序一致性**：本证只判"计划自称的顺序"，不判"这个顺序确实能编译"。
 *
 * ## 用法
 *   node certs/t386-plan-route-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★★★ 2026-10-31（迁移开关，见 `AGENTS-RULES.md` 0.3）：本证用**证判**（`cert:`）而不是画布判据，
//   而计划闸**解不出 `cert:` 引用** ⇒ 严格档会把它要观察的那一步（"放行"）先拦掉，证就观察不到自己该验的东西。
//   ⇒ 只在本证内把严格档关掉（**只报不拦**）：闸本身照旧跑、warnings 照旧出，本证断言一字未改。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp386route-'));
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
fs.writeFileSync(
  path.join(PROJ, REL),
  'export function sig(): number {\n  return 1;\n}\n\nexport function caller(): number {\n  return sig();\n}\n',
);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { planTopoOrder, planDependencyGaps, writeRewritePlan } = await import(
  'file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js'
);
const { assertSourceWriteRegistered } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/write_gate.js');
const { getDSL, saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't386' });
{
  const dsl = getDSL('t386');
  for (const n of dsl.geometry.nodes ?? []) {
    if (n.path === REL || n.description === REL) {
      n.gate = 'exempt';
      n.decision = {
        summary: 't386 判据',
        expectations: [{ kind: 'call-exists', path: REL, symbol: 'caller', target: 'sig', why: 'caller 必须调 sig' }],
      };
    }
  }
  saveDSL(dsl, PROJ);
}

const mk = (sym, deps, status = 'open') => ({
  anchor: { symbol: sym },
  kind: 'rewrite',
  detail: `${sym} 改一下`,
  judgement_ref: 'decision:n386#0',
  status,
  ...(deps ? { depends_on: deps } : {}),
});
// 把节点 id 对齐成 n386（与 judgement_ref 的 node 名一致）
{
  const dsl = getDSL('t386');
  for (const n of dsl.geometry.nodes ?? []) if (n.gate === 'exempt') n.id = 'n386';
  saveDSL(dsl, PROJ);
}

// ── ① 合法 DAG ⇒ 无缺口 + 拓扑序正确 ─────────────────────
{
  const plan = { path: REL, entries: [mk('sig'), mk('caller', ['sig'])] };
  const gaps = planDependencyGaps(plan);
  const order = planTopoOrder(plan);
  chk(gaps.length === 0, '① 合法 DAG ⇒ **无缺口**', gaps.join(' | ').slice(0, 120) || '(空)');
  chk(
    Array.isArray(order) && order.indexOf('sig') < order.indexOf('caller'),
    '①-b 拓扑序里**被依赖的先出现**（sig 在 caller 前）',
    JSON.stringify(order),
  );
}

// ── ② 依赖指向不存在的锚点 ⇒ 报 ──────────────────────────
{
  const gaps = planDependencyGaps({ path: REL, entries: [mk('sig', ['ghost'])] });
  chk(gaps.length === 1 && /没有这个锚点/.test(gaps[0]), '② 依赖一个**不存在的锚点** ⇒ 报（路线是假的）', gaps[0]?.slice(0, 120) ?? '');
}

// ── ③ 成环 ⇒ topoOrder = null + 报"成环" ────────────────
{
  const plan = { path: REL, entries: [mk('sig', ['caller']), mk('caller', ['sig'])] };
  const order = planTopoOrder(plan);
  const gaps = planDependencyGaps(plan);
  chk(order === null, '③ 成环 ⇒ `planTopoOrder` 返回 **null**（不编一个序出来）', String(order));
  chk(gaps.some((g) => /成环/.test(g)), '③-b 并报"依赖成环"（路线不成立）', gaps.find((g) => /成环/.test(g))?.split('\n')[0]?.slice(0, 110) ?? '');
}

// ── ④ 自依赖 ⇒ 报 ───────────────────────────────────────
{
  const gaps = planDependencyGaps({ path: REL, entries: [mk('sig', ['sig'])] });
  chk(gaps.some((g) => /自依赖/.test(g)), '④ 自依赖 ⇒ 报', gaps.find((g) => /自依赖/.test(g))?.slice(0, 110) ?? '');
}

// ── ⑤ 顺序被违反 ⇒ 报 ──────────────────────────────────
{
  const plan = { path: REL, entries: [mk('sig', undefined, 'open'), mk('caller', ['sig'], 'done')] };
  const gaps = planDependencyGaps(plan);
  chk(
    gaps.some((g) => /顺序被违反/.test(g)),
    '⑤ 某条 `done` 而它依赖的还 `open` ⇒ 报（先做的没完成就往下做 = 赌编译）',
    gaps.find((g) => /顺序被违反/.test(g))?.split('\n')[0]?.slice(0, 120) ?? '',
  );
}

// ── ⑥ 写闸真的接上了 ────────────────────────────────────
{
  writeRewritePlan(PROJ, { path: REL, entries: [mk('sig', ['ghost']), { ...mk('caller'), depends_on: undefined }] });
  const out = assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  const hit = (out.warnings ?? []).find((w) => /没有这个锚点/.test(w));
  chk(!!hit, '⑥ 写闸 `warnings` 里出现依赖点名（判据真的接上了）', (hit ?? '').split('\n').find((l) => /没有这个锚点/.test(l))?.trim().slice(0, 120) ?? '(没接上)');
}

console.log(`\n═══ T386 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
