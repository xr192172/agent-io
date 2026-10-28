#!/usr/bin/env node
/**
 * ★★★ cert T401 —— **逐文件读数不许在中间层蒸发**（T-#RP-3 续）（2026-10-28）
 *
 * ## 复现出来的账实不符（第 4 类：读数在但没人喂）
 * `apply_writes` 的回执报 `index_synced: [{file:'src/a.ts', updated:false}]`，
 * 而同一份回执里 `index.synced = 1`（文件**真的**同步了）—— 两个读数**自相矛盾**。
 * 根因：`source_writer.close()` 调 `syncSelfWritesSync(root, written)` 时**没传 `opts.onFile`**，
 * 而 `SourceWriteCtx.onFile` 正是 `apply_writes` 拿逐文件 `updated` 的通道 ⇒ **它从来没被调用过**。
 *
 * ★ 与 T150（重复记账）、T245（批级读数到不了）同一族：**读数在中间层被丢**，不是算错。
 *
 * ## 判据（每条亲手跑）
 *   ① `apply_writes` 真写一次 ⇒ `index_synced[0].updated === true`（修前恒 `false`）；
 *   ② 与 `index.synced` **不矛盾**：`synced > 0` ⇒ 至少一条 `updated:true`；
 *   ③ 结构：`source_writer.close()` 把 `ctx.onFile` 传给 `syncSelfWritesSync`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 `apply_writes` 这条消费者；`writeSourceFile/Batch` 的 `index` 上**没有**逐文件明细
 *     （那是另一件事：`WriteThroughOutcome` 目前不带 `byFile`，属批量路合并的前置，见 T-#RP-3）；
 *   · **[未核]** `ignored` / `failed` 两种状态的回调路径（本证只跑 `updated`）。
 *
 * ## 用法
 *   node certs/t401-onfile-not-dropped-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/source_writer.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp401onfile-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ── ③ 结构断言 ─────────────────────────────────────────
{
  const src = fs.readFileSync('D:/agentio/dev/agent-io/src/application/source_writer.ts', 'utf8');
  chk(/syncSelfWritesSync\(root, written, \{[^}]*onFile/.test(src), '③ `close()` 把 `ctx.onFile` 传给 `syncSelfWritesSync`（不再丢读数）');
}

// ── ①② 端到端 ─────────────────────────────────────────
{
  const REL = 'src/a.ts';
  fs.writeFileSync(path.join(PROJ, REL), 'export function fa(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

  const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
  const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
  const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
  const { applyWrites } = await import(D + 'application/refactor/edit/apply_writes.js');

  await importProject({ project_dir: PROJ, feature: 't401' });
  {
    const dsl = getDSL('t401');
    for (const n of dsl.geometry.nodes ?? []) if (n.path === REL || n.description === REL) n.gate = 'exempt';
    saveDSL(dsl, PROJ);
  }

  const r = await applyWrites(
    PROJ,
    [{ file: path.join(PROJ, REL), content: 'export function fa(): number {\n  return 7;\n}\n' }],
    { note: 't401 夹具', actor: 'agent:t401' },
  );
  const synced = r.index_synced ?? [];
  chk(synced.length === 1 && synced[0].updated === true, '① `index_synced[0].updated === true`（修前恒 false）', JSON.stringify(synced));
  const mode = r.index?.mode;
  const n = r.index?.synced ?? 0;
  chk(!(mode === 'synced' && n > 0 && synced.every((x) => !x.updated)), '② 与 `index.synced` **不矛盾**（synced>0 ⇒ 至少一条 updated:true）', `mode=${mode} synced=${n} updated=${synced.map((x) => x.updated).join(',')}`);
}

console.log(`\n═══ T401 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
