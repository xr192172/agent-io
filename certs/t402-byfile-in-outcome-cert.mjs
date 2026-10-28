#!/usr/bin/env node
/**
 * ★★★ cert T402 —— **逐文件事实进批级结果**（T-#RP-3 前置）（2026-10-28）
 *
 * ## 为什么先做这个，而不是直接合并两条收尾
 * 合并（`edit_code` 的逐分支 sync → 统一 `close()`）之前，逐文件事实只活在**调用方自己的 Map** 里
 * （`symbolDiffByFile` / `indexStatusByFile`）。一改成统一 `close()`，那些 Map 就没了
 * ⇒ `files[]`（T150 刚立起来的）**当场蒸发**。
 * ⇒ 顺序必须是：**先把逐文件事实放进批级结果（`byFile`），再谈合并**。
 *
 * ## 判据（每条亲手跑）
 *   ① 写一次 ⇒ 批级结果 `index.byFile[rel].status` 有值（不是空）；
 *   ② `apply_writes` 的 `index_synced` **来自 `byFile`**（与它一致），不再只依赖调用方的 Map；
 *   ③ 多文件一次写 ⇒ `byFile` 里**每个文件各一条**（不是只有最后一条）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 sync 版（`syncSelfWritesSync`）；async 版（`syncSelfWrites`）本轮**未加** `byFile`
 *     —— 它的逐文件回调 `onFile` 已在，且当前无消费者需要明细；
 *   · **[未核]** `removeFile` 分支的 `status:'removed'`（本证没造删除场景）。
 *
 * ## 用法
 *   node certs/t402-byfile-in-outcome-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/write_gate.ts, src/application/refactor/edit/apply_writes.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp402byfile-'));
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

const A = 'src/a.ts';
const B = 'src/b.ts';
fs.writeFileSync(path.join(PROJ, A), 'export function fa(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, B), 'export function fb(): number {\n  return 2;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const { getDSL, saveDSL } = await import(D + 'infrastructure/storage.js');
const { applyWrites } = await import(D + 'application/refactor/edit/apply_writes.js');

await importProject({ project_dir: PROJ, feature: 't402' });
{
  const dsl = getDSL('t402');
  for (const n of dsl.geometry.nodes ?? []) if ([A, B].includes(n.path) || [A, B].includes(n.description)) n.gate = 'exempt';
  saveDSL(dsl, PROJ);
}

const r = await applyWrites(
  PROJ,
  [
    { file: path.join(PROJ, A), content: 'export function fa(): number {\n  return 11;\n}\n' },
    { file: path.join(PROJ, B), content: 'export function fb(): number {\n  return 22;\n}\n' },
  ],
  { note: 't402 夹具', actor: 'agent:t402' },
);

const byFile = r.index?.byFile ?? null;
chk(!!byFile && !!byFile[A]?.status, '① 批级结果 `index.byFile[rel].status` 有值（逐文件事实进批级）', JSON.stringify(byFile ?? null).slice(0, 160));
chk(
  !!byFile && Object.keys(byFile).length === 2 && !!byFile[A] && !!byFile[B],
  '③ 多文件一次写 ⇒ `byFile` **每个文件各一条**（不是只有最后一条）',
  byFile ? Object.keys(byFile).join(', ') : '(无)',
);
const synced = r.index_synced ?? [];
chk(
  synced.length === 2 && synced.every((x) => x.updated === (byFile?.[x.file]?.status === 'updated')),
  '② `index_synced` 与 `byFile` **一致**（不再只依赖调用方 Map）',
  `${JSON.stringify(synced)} vs byFile`,
);

console.log(`\n═══ T402 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
