#!/usr/bin/env node
/**
 * ★★★ cert T330 —— **欠账视图（`query=pending`）的出生证**（2026-10-15）。
 *
 * ## 这张证要钉住什么（全景判据⑤的便宜那一半）
 * 「欠账」= 尚未做完的锚点。它**必须直读 overlay 权威**（`<feature>.overlay.json` 锚点的
 * `progress`），因为 `applyOverlay` **只把 `progress → base.status` 投影，`progress_evidence`
 * 不投影**（`domain/overlay.ts:481/500` 逐字核过）⇒ ★ 只看 base 的 `status` **永远读不到证据**。
 *
 * ## 三条判据（★ 全部只看**事实**：回读 overlay / 目录 diff，不看回执文案吹牛）
 *   **① 只列未 done + 带出它的 evidence**：2 个锚点（一个 `in_progress`、一个 `done`）⇒
 *      新 query **只列出未 done 的那个**，且**带出它的 `progress_evidence`**（原文贴在输出里）。
 *      ★ 另证"证据只在 overlay 里"：base（`getDSL`）上 done 节点的 `status` 是投影、
 *        **没有** evidence 字段 —— 这正是"必须直读 overlay"的理由本身。
 *   **② `progress='done'` 的不出现在欠账里**；**未登记 `progress` 的锚点也不算欠账**（口径二选一，本处选"不算"）。
 *   **③ 不落盘**：跑完新 query 后 `<dataHome>` 下**没有新增文件**（前后目录清单逐字对比）。
 *
 * ## 用法
 *   node certs/t330-pending-view-cert.mjs
 * ★ 夹具住 `certs/.work/tmp`（`AGENT_IO_HOME` 也指到那里 ⇒ 不碰真仓的 `.agent-io/`）。
 * ★★ 全证只有 1 次删除操作（末尾清理）—— 本仓有"宿主删除闸"前科（见 t328/t316 头注释），
 *    拦下 ≠ 本证判红（判据是 ①/②/③ 三条业务事实），但**不许静默**。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**。
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { updateFeature } = await import('../dist/src/application/design/dsl_ops/update_feature.js');
const { updateStatus } = await import('../dist/src/application/design/dsl_ops/status_tools.js');
const { queryFeature } = await import('../dist/src/application/meta/explore/query_feature.js');

const FEAT = 't330';
const A = 'file_a'; // in_progress（欠账）· 带 decision.scope（T329）
const B = 'file_b'; // done（**不算欠账**）· 带 attestation 证据
const C = 'file_c'; // 有决策卡、**没有 progress**（★ 未登记 ⇒ 不算欠账）

// ── 夹具：三个文件节点 ──────────────────────────────────────────────────────
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [
      { id: A, type: 'file', description: 'src/a.ts', label: 'a' },
      { id: B, type: 'file', description: 'src/b.ts', label: 'b' },
      { id: C, type: 'file', description: 'src/c.ts', label: 'c' },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: A, path: 'src/a.ts' },
      { id: B, path: 'src/b.ts' },
      { id: C, path: 'src/c.ts' },
    ],
  },
});

// C：挂一张带 scope 的决策卡，但**不登记任何 progress**（锚点会存在、但没有 progress）
await updateFeature({
  feature: FEAT,
  operations: [{ type: 'decision', op: 'update', id: C, data: { summary: 'C 有决策但没进度', scope: 'files:src/c.ts' } }],
});
// A：登记 in_progress，**并附一条 reading 证据**（★ 见头注：evidence 在非 done 上也允许，
//   本处刻意放一条 ⇒ 用来证明"该视图是从 overlay 把证据**带出来**的"）
updateStatus({
  feature: FEAT,
  node_id: A,
  status: 'in_progress',
  evidence: { kind: 'reading', command: 'npm run build', observed: 'exit 0（T330 夹具）', at: '2026-10-15T00:00:00.000Z' },
});
// A：再挂 scope（证明欠账项会带出 decision_scope）
await updateFeature({
  feature: FEAT,
  operations: [{ type: 'decision', op: 'update', id: A, data: { summary: 'A 的范围决策', scope: 'files:src/a.ts' } }],
});
// B：置 done，**必须带证据**（attestation）
updateStatus({
  feature: FEAT,
  node_id: B,
  status: 'done',
  evidence: { kind: 'attestation', by: 'human', at: '2026-10-15T00:00:00.000Z', why: '我亲手核过（T330 证书夹具）' },
});

// ── ③ 的基准：跑 query **之前**的 `<dataHome>` 目录清单 ──────────────────────
const walk = (d, base = '') => {
  const out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p, base ? `${base}/${e.name}` : e.name));
    else out.push(base ? `${base}/${e.name}` : e.name);
  }
  return out;
};
const beforeList = walk(HOME).sort();

console.log('════ ① query=pending 只列未 done 的那个，且带出它的 evidence ════');
const r = queryFeature({ query: 'pending', feature: FEAT });
const ids = (r.data ?? []).map((d) => d.id);
const aItem = (r.data ?? []).find((d) => d.id === A);
chk(
  ids.length === 1 && ids[0] === A,
  '①-a 只列出未 done 的那一个（3 个候选锚点 ⇒ 只出 A）',
  `欠账 id=[${ids.join(', ')}] · progress=${JSON.stringify((r.data ?? []).map((d) => d.progress))}`,
);
chk(
  aItem?.progress === 'in_progress' &&
    aItem?.progress_evidence?.kind === 'reading' &&
    aItem?.progress_evidence?.command === 'npm run build',
  '①-b 带出它的 **progress_evidence**（原文=overlay 锚点上的那条）',
  `progress_evidence=${JSON.stringify(aItem?.progress_evidence)}`,
);
chk(aItem?.decision_scope === 'files:src/a.ts', '①-c 决策卡带 scope 时一并出 decision_scope（T329 字段）', `decision_scope=${JSON.stringify(aItem?.decision_scope)}`);
// ★ 证据只在 overlay：base（getDSL）上 done 节点 status 是投影、**没有** evidence 字段
const baseB = getDSL(FEAT)?.geometry?.nodes?.find((n) => n.id === B);
chk(
  baseB?.status === 'done' && baseB?.progress_evidence === undefined,
  '①-d 证据**只在 overlay**：base 上 done 节点的 status 是投影、无 evidence（⇒ 必须直读 overlay）',
  `base node_b.status=${JSON.stringify(baseB?.status)} · base node_b.progress_evidence=${JSON.stringify(baseB?.progress_evidence)}`,
);

console.log('\n════ ② done 的不出现；未登记 progress 的也不算欠账 ════');
chk(!ids.includes(B), '②-a progress=done 的锚点**不出现**在欠账里', `欠账 id=[${ids.join(', ')}] · B 在 overlay.progress=${JSON.stringify(loadOverlay(FEAT)?.anchors?.[B]?.progress)}`);
chk(
  !ids.includes(C) && loadOverlay(FEAT)?.anchors?.[C]?.progress === undefined,
  '②-b 有锚点但**未登记 progress** 的（C）**不算欠账**（口径：未登记 ≠ 欠账）',
  `C 是锚点=${!!loadOverlay(FEAT)?.anchors?.[C]} · C.progress=${JSON.stringify(loadOverlay(FEAT)?.anchors?.[C]?.progress)} · C 在欠账=${ids.includes(C)}`,
);

console.log('\n════ ③ 不落盘：跑完 query 后 <dataHome> 无新增文件 ════');
const afterList = walk(HOME).sort();
const added = afterList.filter((f) => !beforeList.includes(f));
chk(
  added.length === 0 && beforeList.length === afterList.length,
  '③ 跑完 query 后 `<dataHome>` 下**无新增文件**（前后目录清单逐字对比）',
  `前 ${beforeList.length} 个 → 后 ${afterList.length} 个 · 新增=[${added.join(', ')}]`,
);

// ── 人读回执原文（证明口径行与字段都"看得见"）──────────────────────────────
console.log('\n     —— 人读回执（query=pending）——');
for (const l of String(r.message).split('\n')) console.log(`     ${l}`);
console.log(`\n     data=${JSON.stringify(r.data)}`);

// ★ 清理：全证只此 1 次删除操作 —— 拦下 ≠ 本证判红，但**不许静默**。
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
