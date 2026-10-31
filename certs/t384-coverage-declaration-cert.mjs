#!/usr/bin/env node
/**
 * ★★★ cert T384 —— **"通读"的可判形态**（2026-10-28 · 迭代 ③ · 用户："模型喜欢补丁式修改"）
 *
 * ## 用户的设想 vs 原来的现实
 * 「这套流程会**强迫全貌浏览**，然后结构化重写」—— 但只有 `entries` 的话，
 * 模型可以"计划里只列 1 个符号、也只改这 1 个符号"，**全程合规**，而文件里其他符号它根本没看。
 * ⇒ 补一格：`untouched[]`（我看过、不动，为什么）+ 判据 `planCoverageGaps`（每个符号必须表态）。
 *
 * ## 判据（每条亲手跑）
 *   ① 计划只列 1 个符号、文件里有 2 个 ⇒ **报"未表态"**（这就是"没看"被抓的形态）；
 *   ② 显式写进 `untouched` ⇒ **不再报**（看过就算表态）；
 *   ③ `untouched` 缺 `why` ⇒ 报（空理由 = 没表态）；
 *   ④ **写闸真的用了这条判据**：没表态的文件 ⇒ `warnings` 里出现"没表态"；
 *   ⑤ 索引不可用（没有 cache.db）⇒ **不判**（如实降级，不猜 —— 不许假红也不许假绿）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只按 `file_path` 取顶层符号（`kind != 'file'`）；嵌套成员算在 `members` 里，不单独要求表态；
 *   · **[未核] "表态质量"**：写 `untouched:{symbol:'f', why:'不想动'}` 也算表态 —— 判据只管"有没有说"，不管"说得对不对"。
 *
 * ## 用法
 *   node certs/t384-coverage-declaration-cert.mjs      # ★ 先 npm run build
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
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp384cov-'));
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
fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\n\nexport function g(): number {\n  return 9;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { planCoverageGaps, planUntouchedGaps, writeRewritePlan } = await import(
  'file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js'
);
const { assertSourceWriteRegistered } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/write_gate.js');
const { getDSL, saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't384' });
// 夹具是量具 ⇒ 设计侧声明豁免写闸（只测计划判据，不测任务闸）
{
  const dsl = getDSL('t384');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

const entryF = {
  anchor: { symbol: 'f' },
  kind: 'rewrite',
  detail: '返回 2',
  judgement_ref: 'cert:t384/①',
  status: 'open',
};

// ── ① 只列 1 个符号 ⇒ 报"未表态" ────────────────────────
{
  const gaps = planCoverageGaps({ path: REL, entries: [entryF] }, ['f', 'g']);
  chk(gaps.length === 1 && /没表态/.test(gaps[0]) && /g/.test(gaps[0]), '① 文件里 `g` 没表态 ⇒ **报出来**（"没看"有了形态）', gaps[0]?.split('\n')[0] ?? '');
}

// ── ② 写进 untouched ⇒ 不报 ─────────────────────────────
{
  const gaps = planCoverageGaps({ path: REL, entries: [entryF], untouched: [{ symbol: 'g', why: '只读展示，本轮不动' }] }, ['f', 'g']);
  chk(gaps.length === 0, '② 显式写进 `untouched` ⇒ **不再报**（看过就算表态）');
}

// ── ③ untouched 缺 why ⇒ 报 ─────────────────────────────
{
  const g1 = planUntouchedGaps({ path: REL, entries: [], untouched: [{ symbol: 'g', why: '' }] });
  chk(g1.length === 1 && /没表态/.test(g1[0]), '③ `untouched` 缺 `why` ⇒ 报（空理由 = 没表态）', g1[0] ?? '');
}

// ── ④ 写闸真的用了这条判据 ──────────────────────────────
{
  writeRewritePlan(PROJ, { path: REL, entries: [entryF] }); // 只列 f，g 没表态
  const out = assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  const hit = (out.warnings ?? []).find((w) => /没表态/.test(w));
  chk(!!hit, '④ 写闸的 `warnings` 里出现"没表态"（判据真的接上了）', (hit ?? '').split('\n')[0]?.slice(0, 120) ?? '(没接上)');
}

// ── ⑤ 索引不可用 ⇒ 不判（不假红也不假绿）────────────────
{
  const empty = planCoverageGaps({ path: REL, entries: [entryF] }, []); // 空清单 = 取不到符号
  chk(empty.length === 0, '⑤ 符号清单取不到（空）⇒ **不判**（如实降级，不猜）');
}

console.log(`\n═══ T384 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
