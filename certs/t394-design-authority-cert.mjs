#!/usr/bin/env node
/**
 * ★★★ cert T394 —— **设计期权威**：偏差必须**算得出**、并**记成设计缺口**（2026-10-28 · 用户）
 *
 * ## 用户的话
 * 「设计期按理来说是**权威**，如果设计期设计的有问题才会出现这种情况吧。然后探索其实是坍缩的误打」
 *
 * ⇒ 两条推论，本证各钉一条：
 * ① **偏差不是"对账信息"，是"设计漏了"** —— 而且必须**可算**（点名到符号），不能是一句"可能有计划外改动"。
 *    做法：画布冻结时记每个顶层符号的 `body_hash`（`fps_at_freeze`）；
 *    改完某符号的 `body_hash` 变了、又不在 `entries` 里 ⇒ `changed_unplanned`（= 设计漏了）。
 * ② **不许"留个警告算了"**：`sync_status` 把 `changed_unplanned` **吸收进画布**，
 *    追加成一条 **缺 `judgement_ref`** 的 entry ⇒ `planGaps` 会一直点名，直到有人把设计补全。
 *
 * ## 判据（每条亲手跑）
 *   ① 冻结后改了**计划内**符号 ⇒ **不算** `changed_unplanned`（有计划就不叫"漏"）；
 *   ② 冻结后改了**计划外**符号 ⇒ `changed_unplanned` **点名到符号**；
 *   ③ 画布**没记** `fps_at_freeze` ⇒ 这一条**不判**（如实降级，不猜 —— 老画布不会突然全红）；
 *   ④ `sync_status=true` 真跑：`changed_unplanned` 被**吸收**成 entry（`detail` 写明"设计漏了"、
 *      `judgement_ref` 空）⇒ 随后 `planGaps` **点名缺判据引用**（= 设计缺口被记账，闸不会自己变绿）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只比 `body_hash`（符号体），**签名/注释变了但体没变**不算"改了"——够用且不误报，但也不完整；
 *   · **[未核]** "探索"这一环：用户说"探索其实是坍缩的误打"，本证不建模探索（改集只认画布）。
 *
 * ## 用法
 *   node certs/t394-design-authority-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, plan_exit_check.ts, src/application/design/index.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp394auth-'));
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
  'export function f(): number {\n  return 1;\n}\n\nexport function g(): number {\n  return 2;\n}\n',
);
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { checkRewriteExit } = await import(D + 'application/design/db/plan_exit_check.js');
const { writeRewritePlan, readRewritePlan, planGaps } = await import(D + 'application/design/db/rewrite_plan.js');
const { symbolFpsOf } = await import(D + 'application/write_gate.js');
const { contentHash, syncFile } = await import(D + 'infrastructure/index/symbols.js');
const { getProjectCacheDb } = await import(D + 'infrastructure/index/db.js');

await importProject({ project_dir: PROJ, feature: 't394' });

const E = (sym) => ({
  anchor: { symbol: sym },
  kind: 'rewrite',
  detail: 'x',
  judgement_ref: 'cert:t394#①',
  judgement_kind: 'behavior-cases',
  status: 'open',
});

// 冻结：f 有计划、g 没有（但都在 symbols_at_freeze 里）
const h0 = contentHash(fs.readFileSync(path.join(PROJ, REL), 'utf-8'));
const fps0 = symbolFpsOf(PROJ, REL).fps; // ★ 2026-10-31：symbolFpsOf 改回 {ok,fps,reason}（0.12）—— 只取 .fps，断言不改
writeRewritePlan(PROJ, {
  path: REL,
  frozen_at: new Date().toISOString(),
  base: { content_hash: h0 },
  entries: [E('f')],
  untouched_default: { why: '夹具：只计划改 f' },
  symbols_at_freeze: ['f', 'g'],
  fps_at_freeze: fps0,
});
chk(Object.keys(fps0).length === 2, '⓪ 冻结时记下了每个顶层符号的 `body_hash`', Object.keys(fps0).join(','));

// 改 f（计划内）+ 改 g（计划外）
fs.writeFileSync(
  path.join(PROJ, REL),
  'export function f(): number {\n  return 11;\n}\n\nexport function g(): number {\n  return 22;\n}\n',
);
await syncFile(getProjectCacheDb(PROJ), PROJ, path.join(PROJ, REL));

// ── ①② 偏差点名 ────────────────────────────────────────
{
  const r = checkRewriteExit(PROJ, REL);
  chk(!r.changed_unplanned.includes('f'), '① **计划内**的符号改了 ⇒ 不算"漏"（不点名）', JSON.stringify(r.changed_unplanned));
  chk(r.changed_unplanned.includes('g'), '② **计划外**的符号改了 ⇒ `changed_unplanned` 点名到 `g`', JSON.stringify(r.changed_unplanned));
}

// ── ③ 没记 fps ⇒ 不判 ───────────────────────────────────
{
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: h0 },
    entries: [E('f')],
    untouched_default: { why: '老画布（没 fps）' },
    symbols_at_freeze: ['f', 'g'],
  });
  const r = checkRewriteExit(PROJ, REL);
  chk(r.changed_unplanned.length === 0, '③ 画布没记 `fps_at_freeze` ⇒ 这一条**不判**（老画布不会突然全红）');
}

// ── ④ 吸收成设计缺口（闸不会自己变绿）────────────────────
{
  // 恢复带 fps 的画布，再跑 sync_status
  writeRewritePlan(PROJ, {
    path: REL,
    frozen_at: new Date().toISOString(),
    base: { content_hash: h0 },
    entries: [E('f')],
    untouched_default: { why: '夹具' },
    symbols_at_freeze: ['f', 'g'],
    fps_at_freeze: fps0,
  });
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
  const j = readRewritePlan(PROJ, REL);
  const g = j.entries.find((e) => e.anchor?.symbol === 'g');
  chk(!!g, '④ 计划外的 `g` **被吸收进画布**（不是只留一条警告）', JSON.stringify(g ?? null).slice(0, 140));
  chk(!!g && /设计漏了/.test(String(g.detail)) && !g.judgement_ref, '④-b 吸收的条目写明"设计漏了"，且**缺判据引用**');
  const gaps = planGaps(j);
  chk(gaps.some((x) => /judgement_ref/.test(x)), '④-c ⇒ `planGaps` **点名缺 judgement_ref**（闸不会自己变绿，等人补设计）', gaps.find((x) => /judgement_ref/.test(x))?.slice(0, 100) ?? '');
  chk(/设计漏了|待补设计/.test(out), '④-d 回执里也看得到（不是静默吸收）', out.split('\n').find((l) => /设计漏了|待补设计/.test(l))?.trim().slice(0, 110) ?? '(没这行)');
}

console.log(`\n═══ T394 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
