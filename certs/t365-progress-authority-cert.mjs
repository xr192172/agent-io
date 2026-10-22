#!/usr/bin/env node
/**
 * ★★★ cert T365 —— **progress 的权威归一**（2026-10-22 · 卡 `todo_2026-10-22-排查结论-矛盾一-progress-的权威住了两处-src`）
 *
 * ## 它治的病（两处给了两个答案，实测）
 * · `application/design/dsl_ops/file_ops.ts` 的注释：进度权威 = `overlay.progress`；
 * · `application/write_gate.ts#effectiveProgress`：有 task ⇒ `progressOf(task)`，没有才回落 overlay；
 * · `domain/overlay.ts#applyOverlay` 里又自写两份（几何层 + semantic 层）。
 * ⇒ 同一个问句**至少三个答案**。实测 task-system-plan：「有卡且锚点登记过进度」的 26 个节点里 **11 个**
 *   overlay 说 `done` 而卡是 `candidate`（overlay 是交接期的影子副本，会过期）。
 *
 * ## 本笔新增的方向（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   新入口 `domain/task_schema.ts#progressOfNode(node, anchor, todos)` —— 判据住一处；
 *   读端全部改调它：`applyOverlay`（两处投影）/ `write_gate`（前置闸）/ `query_feature`（`query='pending'`）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **两个读端同答案**：`task.state=done` 而 `overlay.progress=draft` ⇒ 两个读端都必须报 `done`
 *      （overlay 落后不是权威）；反向再验一次（下一条）。
 *   ② **反证（最贵的一条）**：`overlay.progress=done` 而 `task.state=candidate` ⇒ 两个读端都必须报
 *      `draft`（**不是** `done`）—— 这正是真仓 11 个节点的方向。
 *   ③ **回落必须带「可能过期」标记**（不许静默）：节点**没有卡**而 `overlay.progress=draft` ⇒ 两个读端
 *      都给 `draft`，且**都把它标成 overlay 回落**（闸的报文写「可能过期」，欠账视图写 `possibly_stale`）。
 *   ④ **`void` 不硬塞值**：卡是 `void` ⇒ 两个读端都给「无值」（不是 `draft`，也不是 `done`）。
 *
 * ## 三个读端（不是两个：`pending` 也是人真在看的那一个）
 *   R1 `applyOverlay`（投影 ⇒ `get_dsl` 看到的就是它）
 *   R2 `write_gate#assertSourceWriteRegistered` 的前置闸报文
 *   R3 `query_feature {query:'pending'}` 的欠账视图
 *
 * ## 用法
 *   node certs/t365-progress-authority-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 夹具用 mkdtempSync（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸，rmSync 会让本证假红。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp365prog-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), 'export const a = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/b.ts'), 'export const b = 2;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { saveOverlay, loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { applyOverlay } = await import('../dist/src/domain/overlay.js');
const { assertSourceWriteRegistered } = await import('../dist/src/application/write_gate.js');
const { queryFeature } = await import('../dist/src/application/meta/explore/query_feature.js');

const FEAT = 't365prog';

/** 造一版夹具：`a` 是"被前置"的节点（可带/不带卡），`b` 靠 `requires:[a]` 才能写。 */
const build = ({ taskA, overlayProgress }) => {
  saveDSL({
    id: `feature_${FEAT}`,
    type: 'feature_diagram',
    feature: FEAT,
    version: '1.0.0',
    title: FEAT,
    source_root: ROOT,
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [
        { id: 'file_a', type: 'file', path: 'src/a.ts', description: 'src/a.ts', ...(taskA ? { task: taskA } : {}) },
        { id: 'file_b', type: 'file', path: 'src/b.ts', description: 'src/b.ts' },
      ],
      edges: [{ id: 'e_ab', from: 'file_b', to: 'file_a', type: 'depends' }],
    },
    semantic: { files: [] },
    layers: {},
    annotations: [],
  });
  saveOverlay({
    version: 1,
    feature: FEAT,
    anchors: {
      file_a: { path: 'src/a.ts', kind: 'file', ...(overlayProgress ? { progress: overlayProgress } : {}) },
      file_b: { path: 'src/b.ts', kind: 'file' },
    },
    edges: { e_ab: { from: 'file_b', to: 'file_a', requires: ['file_a'], reason: 'T365 夹具：b 须等 a' } },
  });
};

/** R1：投影读数（= `get_dsl` 看到的那一份） */
const readR1 = () => {
  const merged = applyOverlay(getDSL(FEAT), loadOverlay(FEAT));
  const node = merged.geometry.nodes.find((n) => n.id === 'file_a');
  return { status: node.status, raw: node.status === undefined ? '(无值)' : String(node.status) };
};

/** R2：写闸前置闸报文（拒 = 抛；报文里带 `progress=...`） */
const readR2 = () => {
  try {
    assertSourceWriteRegistered(ROOT, ['src/b.ts']);
    return { blocked: false, msg: '' };
  } catch (e) {
    return { blocked: true, msg: e.message };
  }
};

/** R3：欠账视图里 `file_a` 的读数（不在列表里 = 认为它已 done / 不欠） */
const readR3 = () => {
  const r = queryFeature({ query: 'pending', feature: FEAT });
  const hit = (r.data ?? []).find((d) => d.id === 'file_a');
  return { inDebts: !!hit, progress: hit?.progress, stale: hit?.possibly_stale, source: hit?.progress_source, text: r.message };
};

// ── ② 反证：overlay=done，卡=candidate ⇒ 两个读端都必须报 draft（不是 done）
console.log('\n══ ② 反证：overlay.progress=done · task.state=candidate ══');
build({ taskA: { id: 'file_a', summary: 'A', state: 'candidate' }, overlayProgress: 'done' });
{
  const r1 = readR1();
  const r2 = readR2();
  const r3 = readR3();
  console.log(`   R1 applyOverlay  → status=${r1.raw}`);
  console.log(`   R2 写闸前置闸    → blocked=${r2.blocked}${r2.blocked ? ` · ${/file_a（progress=[^）]*）/.exec(r2.msg)?.[0] ?? '(无 progress 字样)'}` : ''}`);
  console.log(`   R3 欠账视图      → ${r3.inDebts ? `progress=${r3.progress} · possibly_stale=${r3.stale} · source=${r3.source}` : '不在欠账列表里'}`);
  chk(r1.status === 'draft', 'R1 报 draft（不是 done）', `status=${r1.raw}`);
  chk(r2.blocked && r2.msg.includes('progress="draft"'), 'R2 报 draft（不是 done）', r2.blocked ? '前置闸拦住了' : '★ 没拦 ⇒ 判据失效');
  chk(r2.msg.includes('来自 task'), 'R2 把来源说出来了（来自 task）');
  chk(r3.inDebts && r3.progress === 'draft', 'R3 报 draft（不是 done）', `progress=${String(r3.progress)}`);
  chk(r3.stale === false && r3.source === 'task', 'R3 标成 task 派生（不是 overlay 回落）', `stale=${String(r3.stale)} source=${String(r3.source)}`);
  chk(r1.status === r3.progress, '★ 两个读端同答案（R1 === R3）', `${r1.raw} / ${String(r3.progress)}`);
}

// ── ① 反向：overlay=draft，卡=done ⇒ 两个读端都必须报 done（overlay 落后不是权威）
console.log('\n══ ① overlay.progress=draft · task.state=done ══');
build({ taskA: { id: 'file_a', summary: 'A', state: 'done' }, overlayProgress: 'draft' });
{
  const r1 = readR1();
  const r2 = readR2();
  const r3 = readR3();
  console.log(`   R1 applyOverlay  → status=${r1.raw}`);
  console.log(`   R2 写闸前置闸    → blocked=${r2.blocked}（done ⇒ 前置满足，不该被前置闸拦）`);
  console.log(`   R3 欠账视图      → ${r3.inDebts ? `progress=${r3.progress}` : '不在欠账列表里（= 视为 done）'}`);
  chk(r1.status === 'done', 'R1 报 done（overlay 的 draft 不作数）', `status=${r1.raw}`);
  chk(!r2.msg.includes('前置闸'), 'R2 不以前置闸为由拦（= 它读到的也是 done）');
  chk(!r3.inDebts, 'R3 不把已 done 的节点算成欠账（overlay 的 draft 不作数）');
}

// ── ③ 回落必须带「可能过期」标记（没有卡 ⇒ 读 overlay，但不许静默）
console.log('\n══ ③ 没有卡 · overlay.progress=draft ⇒ 回落 + 必须标「可能过期」══');
build({ taskA: null, overlayProgress: 'draft' });
{
  const r1 = readR1();
  const r2 = readR2();
  const r3 = readR3();
  console.log(`   R1 applyOverlay  → status=${r1.raw}`);
  console.log(`   R2 写闸前置闸    → ${/可能过期/.test(r2.msg) ? '报文里写了「可能过期」' : '★ 报里没有「可能过期」'}`);
  console.log(`   R3 欠账视图      → ${r3.inDebts ? `progress=${r3.progress} · possibly_stale=${r3.stale}` : '不在欠账列表里'}`);
  chk(r1.status === 'draft', 'R1 回落 overlay 得 draft', `status=${r1.raw}`);
  chk(r2.blocked && r2.msg.includes('可能过期'), 'R2 回落时**明说可能过期**（不静默）');
  chk(r3.inDebts && r3.stale === true, 'R3 回落时 possibly_stale=true（不静默）', `stale=${String(r3.stale)}`);
  chk(r1.status === r3.progress, '★ 两个读端同答案（R1 === R3）', `${r1.raw} / ${String(r3.progress)}`);
}

// ── ④ `void` 不硬塞值（卡失效 ≠ 还没开始）
console.log('\n══ ④ task.state=void（overlay=done 也不许冒充）══');
build({ taskA: { id: 'file_a', summary: 'A', state: 'void' }, overlayProgress: 'done' });
{
  const r1 = readR1();
  const r2 = readR2();
  const r3 = readR3();
  console.log(`   R1 applyOverlay  → status=${r1.raw}`);
  console.log(`   R2 写闸前置闸    → ${/progress=undefined/.test(r2.msg) ? 'progress=undefined（无值）' : r2.msg.split('\n')[1] ?? ''}`);
  console.log(`   R3 欠账视图      → ${r3.inDebts ? `progress=${String(r3.progress)}` : '不在欠账列表里'}`);
  chk(r1.status === undefined, 'R1 给「无值」（不是 done、也不是 draft）', `status=${r1.raw}`);
  chk(!r3.inDebts, 'R3 不把 void 算成欠账（无值 ⇒ 不欠）');
}

console.log(`\n汇总：PASS=${P} FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
