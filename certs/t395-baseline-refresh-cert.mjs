#!/usr/bin/env node
/**
 * ★★★ cert T395 —— **画布基线的新陈代谢**：写穿后吸收设计缺口 + 基线挪到写后（2026-10-28）
 *
 * ## 自查发现的"真会堵死路"的洞
 * 出口闭环必须用**写之前**的冻结基线（否则判不出"改了却没计划"），但写完**基线没往前挪**
 * ⇒ 严格档（已默认开）下同一个文件**只能改一次**：第二次写被判"画布过期"直接拒。
 * 实测：`写前闸=放行 → 写一次 → 写后闸=拒写（画布过期）` —— 任务被锁死。
 *
 * ## 修法（唯一一处，所有写路径共用 `finishWriteThrough`）
 * 顺序必须是：① 用**旧**基线跑出口闭环（才知道 `changed_unplanned`）
 * → ② 把"改了却没计划"的符号**吸收进画布**（追加缺 `judgement_ref` 的 entry）
 * → ③ 基线（`base.content_hash` / `fps_at_freeze` / `frozen_at`）**挪到写后**。
 *
 * ## 判据（每条亲手跑）
 *   ① 写穿回执里出现「**基线已挪到写后**」（不静默）；
 *   ② 写完之后画布 `base.content_hash` **等于当前文件**（不再过期）；
 *   ③ **严格档下第二次写放行**（洞修好了：一个任务能改多次）；
 *   ④ 写穿发现"计划外的符号也改了" ⇒ 回执点名「**记成设计缺口**」；
 *   ⑤ 该缺口**进了画布**（`entries` 里多一条、`judgement_ref` 空、`detail` 写明"设计漏了"）；
 *   ⑥ 随后 `planGaps` **点名缺 judgement_ref**（闸不会自己变绿）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 `applyWrites` 这条（它经 `finishWriteThrough`）；`edit_code` 走同一处（未单独跑）；
 *   · 刷新基线**会丢掉**上一轮 `changed_unplanned` 的可比性（已吸收成 entry，所以不丢信息）。
 *
 * ## 用法
 *   node certs/t395-baseline-refresh-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/write_gate.ts, src/application/design/db/rewrite_plan.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp395base-'));
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
const SRC1 = 'export function f(): number {\n  return 1;\n}\n\nexport function g(): number {\n  return 2;\n}\n';
const SRC2 = 'export function f(): number {\n  return 10;\n}\n\nexport function g(): number {\n  return 20;\n}\n';
fs.writeFileSync(path.join(PROJ, REL), SRC1);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { writeRewritePlan, readRewritePlan, planGaps } = await import(D + 'application/design/db/rewrite_plan.js');
const { symbolFpsOf, assertSourceWriteRegistered } = await import(D + 'application/write_gate.js');
const { applyWrites } = await import(D + 'application/refactor/edit/apply_writes.js');
const { contentHash } = await import(D + 'infrastructure/index/symbols.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't395' });
{
  const dsl = getDSL('t395');
  for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

// 画布：只计划 f；g **不在** entries（= 设计漏了它）
writeRewritePlan(PROJ, {
  path: REL,
  frozen_at: new Date().toISOString(),
  base: { content_hash: contentHash(SRC1) },
  entries: [
    { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '返回 10', judgement_ref: 'cert:t395#①', judgement_kind: 'behavior-cases', status: 'open' },
  ],
  untouched_default: { why: '夹具：计划里只有 f' },
  symbols_at_freeze: ['f', 'g'],
  // ★ 2026-10-31：`symbolFpsOf` 改回 `{ok,fps,reason}`（0.12：失败必须与「没有符号」可区分）—— 只取 `.fps`，断言不改
  fps_at_freeze: symbolFpsOf(PROJ, REL).fps,
});

// 真写穿：f 和 g **都**改了（g 是计划外的）
const receipt = await applyWrites(PROJ, [{ file: path.join(PROJ, REL), content: SRC2 }], {
  note: 't395 夹具',
  actor: 'agent:t395',
});

// ── ①③ 回执与第二次写 ─────────────────────────────────
{
  const joined = (receipt.plan_baseline ?? []).join('\n');
  chk(/基线已挪到写后/.test(joined), '① 写穿回执出现「**基线已挪到写后**」（不静默）', joined.split('\n')[0]?.slice(0, 110) ?? '(没有)');
  const plan = readRewritePlan(PROJ, REL);
  const nowHash = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
  chk(plan.base?.content_hash === nowHash, '② 写完之后画布基线 **= 当前文件**（不再过期）');
  process.env.AGENT_IO_REQUIRE_PLAN = '1';
  let blocked = '';
  try {
    assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  } catch (e) {
    blocked = e.message;
  }
  process.env.AGENT_IO_REQUIRE_PLAN = '0';
  // ★ 实测：吸收缺口之后，严格档**仍然会拦** —— 但拦的理由从"画布过期"变成"**设计缺判据**"。
  //   这正是要的牙齿：洞（改一次就锁死）修好了，同时设计缺口不会被放过。
  chk(/judgement_ref|没有够格的重写计划/.test(blocked) && !/画布过期/.test(blocked), '③ 吸收缺口后严格档**仍拦**，但理由已不是"画布过期"（改为"设计缺判据"）', blocked.split('\n')[0]?.slice(0, 110) ?? '(没拦 —— 反而漏了缺口)');
}

// ── ④⑤⑥ 设计缺口被吸收 ────────────────────────────────
{
  const joined = (receipt.plan_baseline ?? []).join('\n');
  chk(/记成设计缺口/.test(joined), '④ 回执点名「**记成设计缺口**」', joined.split('\n').find((l) => /记成设计缺口/.test(l))?.slice(0, 110) ?? '(没有)');
  const plan = readRewritePlan(PROJ, REL);
  const gEntry = plan.entries.find((e) => e.anchor?.symbol === 'g');
  chk(!!gEntry && /设计漏了/.test(String(gEntry.detail)), '⑤ 缺口**进了画布**（`g` 成了一条 entry，写明"设计漏了"）', JSON.stringify(gEntry ?? null).slice(0, 120));
  chk(!!gEntry && !gEntry.judgement_ref, '⑤-b 该条目 **`judgement_ref` 为空**（等人补设计）');
  const gaps = planGaps(plan);
  chk(gaps.some((x) => /judgement_ref/.test(x)), '⑥ `planGaps` **点名缺 judgement_ref**（闸不会自己变绿）', gaps.find((x) => /judgement_ref/.test(x))?.slice(0, 90) ?? '');
}

// ── ⑦ 补全设计之后，第二次写**真的放行**（洞修好的正向证明）──────
{
  const plan = readRewritePlan(PROJ, REL);
  const fixed = {
    ...plan,
    entries: plan.entries.map((e) =>
      e.anchor?.symbol === 'g'
        ? { ...e, judgement_ref: 'cert:t395#⑦', judgement_kind: 'behavior-cases' }
        : e,
    ),
  };
  writeRewritePlan(PROJ, fixed);
  process.env.AGENT_IO_REQUIRE_PLAN = '1';
  let blocked = '';
  try {
    assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  } catch (e) {
    blocked = e.message;
  }
  process.env.AGENT_IO_REQUIRE_PLAN = '0';
  chk(blocked === '', '⑦ 把 `g` 的判据引用补上之后，**第二次写真放行**（一个任务能改多次）', blocked.split('\n')[0]?.slice(0, 110) ?? '');
}

console.log(`\n═══ T395 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
