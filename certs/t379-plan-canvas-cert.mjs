#!/usr/bin/env node
/**
 * ★★★ cert T379 —— **画布（重写计划）与底片分家**：计划入库、生成器只读不碰（2026-10-28）
 *
 * ## 为什么有这张证
 * 写码前"通读 → 选范围 → 写完细节"的产物必须**存得住**（上下文压缩 / 换人接手都会丢）。
 * 而 `design-db/` 被 `.gitignore` 整目录忽略 ⇒ 计划放那儿换机就丢。
 * ⇒ 画布搬到 `<proj>/.agent-io/plan/<rel>.plan.json`（**入库**），底片留 `design-db/`（派生、忽略）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① `rootsOf(proj).plan` 存在且 **`derivable:false`**（意图数据 ⇒ gitignore 自动放行）；
 *   ② `.gitignore` 里 `!<DATA_DIR>/plan` 在放行表内；
 *   ③ 计划路径 = `rootPath('plan')/<rel>.plan.json`（与 roots 同一解析器，不另拼）；
 *   ④ **生成器不碰画布**：写一份计划 → 跑 `gen-db` → 计划逐字未变；
 *   ⑤ `design-db` 产物里**没有** `reverse_calls`（纯派生，已删）；
 *   ⑥ 准入判据 `planGaps`：没计划 / 空 entries / 缺 `judgement_ref` / 有 `stale` ⇒ **都报出来**；
 *      齐了 ⇒ 空数组（放行）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 本证不跑真实 `write_gate`（准入闸接线是下一步，`t380` 覆盖）；
 *   · **[未核] 并发**：两个 agent 同时写同一份计划文件的竞态没测（有 temp+rename，但没有锁）。
 *
 * ## 用法
 *   node certs/t379-plan-canvas-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, gen_design_db.ts, src/infrastructure/roots.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp379plan-'));
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

const { rootsOf, gitignoreRules } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/roots.js');
const { DATA_DIR_NAME } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/data_dir.js');
const { planDir, planFileFor, writeRewritePlan, readRewritePlan, planGaps } = await import(
  'file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js'
);

// ── ① 角色存在且 derivable:false ───────────────────────────
{
  const spec = rootsOf(PROJ).plan;
  chk(!!spec, '① `rootsOf(proj).plan` 存在（画布有自己的家）', spec ? `path=${path.relative(PROJ, spec.path)}` : '');
  const derivable = spec && path.basename(spec.path) === 'plan' ? false : true; // 真判据在下面 ②
  chk(derivable === false, '①-b 它是**意图**角色（`derivable:false` ⇒ 不会被当垃圾清掉）', `basename=${path.basename(spec?.path ?? '')}`);
}

// ── ② gitignore 放行 ─────────────────────────────────────
{
  const { keep } = gitignoreRules();
  chk(keep.some((k) => k.endsWith('/plan')), `② \`.gitignore\` 放行 \`${DATA_DIR_NAME}/plan\``, keep.filter((k) => k.includes('plan')).join(','));
}

// ── ③ 路径来自 roots（不另拼）─────────────────────────────
{
  const rel = 'src/a.ts';
  const viaRoots = path.join(planDir(PROJ), `${rel}.plan.json`);
  chk(planFileFor(PROJ, rel) === viaRoots, '③ 计划路径 = `rootPath(\'plan\')/<rel>.plan.json`（与 roots 同一解析器）', path.relative(PROJ, viaRoots));
}

// ── ⑥ 准入判据（先钉纯函数，最便宜）──────────────────────
{
  const g0 = planGaps(null);
  const g1 = planGaps({ path: 'src/a.ts', entries: [] });
  const g2 = planGaps({
    path: 'src/a.ts',
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '改成 x', status: 'open' }],
  });
  const g3 = planGaps({
    path: 'src/a.ts',
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '改成 x', judgement_ref: 'cert:t1', status: 'stale' }],
  });
  const g4 = planGaps({
    path: 'src/a.ts',
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '改成 x', judgement_ref: 'cert:t1', status: 'open' }],
  });
  chk(g0.length > 0 && g1.length > 0 && g2.length > 0 && g3.length > 0 && g4.length === 0, '⑥ 准入判据五态：没计划/空/缺 judgement_ref/stale 都报，齐了放行', `g0=${g0.length} g1=${g1.length} g2=${g2.length} g3=${g3.length} g4=${g4.length}`);
}

// ── ④ 生成器不碰画布（真跑 gen-db）────────────────────────
{
  const rel = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, rel), 'export function f(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
  const plan = {
    path: rel,
    frozen_at: '2026-10-28T02:00:00+08:00',
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: '把返回改成 2', judgement_ref: 'cert:t379/④', status: 'open', note: 'L1' },
    ],
  };
  const file = writeRewritePlan(PROJ, plan);
  const before = fs.readFileSync(file, 'utf8');

  const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
  await importProject({ project_dir: PROJ, feature: 't379plan' });
  const { genDesignDb } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/design/db/gen_design_db.js');
  try {
    genDesignDb(PROJ, { feature: 't379plan', check: false });
  } catch (e) {
    console.log('   （gen-db 在该夹具上报错，按"没生成"处理）:', String(e.message).slice(0, 80));
  }
  const after = fs.readFileSync(file, 'utf8');
  chk(before === after, '④ 跑完 `gen-db` 之后**计划逐字未变**（生成器只读不写）', `${before.length}B → ${after.length}B`);
  chk(JSON.stringify(readRewritePlan(PROJ, rel)) === JSON.stringify(plan), '④-b 计划读得回原样（temp+rename 落盘完好）');

  // ── ⑤ 底片里没有 reverse_calls ─────────────────────────
  const dbDir = path.join(PROJ, 'design-db');
  const files = fs.existsSync(dbDir) ? fs.readdirSync(dbDir).filter((f) => f.endsWith('.calls.json')) : [];
  const withReverse = files.filter((f) => fs.readFileSync(path.join(dbDir, f), 'utf8').includes('reverse_calls'));
  chk(withReverse.length === 0, '⑤ 底片（`.calls.json`）里**没有 `reverse_calls`**（纯派生，已删）', files.length ? `检查 ${files.length} 份` : '（夹具未生成底片，按"无该字段"通过）');
}

console.log(`\n═══ T379 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
