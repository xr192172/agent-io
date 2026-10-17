#!/usr/bin/env node
/**
 * ★★★ cert T352 —— **写闸的 `applicable:false` 只许表示「本项目不用任务系统」**
 * （2026-10-17 · service_flow 第⑤步「做事」的闸 · `docs/_extract/flow-check-1.md` F7）。
 *
 * ## 本笔新增的**方向**（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ① 新读数 `TaskGateBasis`（`no-files` / `no-feature-for-root` / `files-not-in-design` / `covered`）；
 *   ② 新入口 `collectGateCoverage` —— **收集与判定分家**：收集失败在放行之前**抛**；
 *   ③ `nodeFilePath`：`path` 优先、回落 `description`（`path` 型节点不再被漏掉）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **洞真的堵了**：一个 **path 型**（只有 `path`、无 `description`、无 `semantic.files`）的
 *      文件节点 + **没有 claimed 卡** ⇒ 旧口径 `applicable:false`（放行），新口径**抛"未领任务"**；
 *      同一夹具 `publish`+`claim` 后 ⇒ **放行**（`basis=covered`）—— 证明拒是因为"看见了节点"。
 *   ② **合法的"不用任务系统"仍能 `applicable:false`**：0 条 feature 指到根 ⇒
 *      `basis=no-feature-for-root`，note 点名"0 条 / 根路径"。
 *   ③ **收集失败必须点名**：文件节点**既无 path 也无 description** ⇒ 抛错并点出 node_id，
 *      **不许**混进 `applicable:false`。
 *   ④ **"自己坏"对照**：用旧口径（只认 description）重算同一批夹具 ⇒ 0 条 coverage
 *      ⇒ 若有人把 `path` 回落删掉，①的"抛未领任务"会退化成"静默放行"，本证当场红。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home，代码根 = 临时根；
 *   · **MCP 传输层 [未核]**：直接 import `assertSourceWriteRegistered` / `editDslHandler`；
 *   · **`semantic.files` 兜底 [未核]**：本证的三条夹具都不给 `semantic.files`（正是要证明
 *     "只靠几何层 path 也能被收集"）；兜底那一路由既有仓内 feature 日常覆盖；
 *   · **多 feature 任一 claimed 即通过 [未核]**：本证只造单 feature。
 *
 * ## 用法
 *   node certs/t352-write-gate-coverage-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 夹具用 `mkdtempSync`（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸
//   （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），`rmSync` 会让本证在批量跑里崩成假红。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp352wg-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
const OTHER_ROOT = path.join(TMP, 'other-root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.mkdirSync(path.join(OTHER_ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), 'export const a = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/other.ts'), 'export const other = 2;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL, listFeatures } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { assertSourceWriteRegistered, collectGateCoverage } = await import('../dist/src/application/write_gate.js');

const FEAT = 't352gate';
const seed = (nodes, { root = ROOT, files = [] } = {}) =>
  saveDSL({
    id: `feature_${FEAT}`,
    type: 'feature_diagram',
    feature: FEAT,
    version: '1.0.0',
    title: FEAT,
    source_root: root,
    geometry: { layout: 'free', width: 400, height: 300, nodes, edges: [] },
    semantic: { files },
    layers: {},
    annotations: [],
  });

/** 闸的读数（拒 = 抛；放行 = outcome） */
const gate = (rel) => {
  try {
    return { threw: false, out: assertSourceWriteRegistered(ROOT, [rel]) };
  } catch (e) {
    return { threw: true, msg: e.message };
  }
};

/**
 * ★ 旧口径的**逐字复刻**（改前 `coveringFeatures`：只认 `description`、`if (byPath.size)` 静默跳过）。
 * ★ 它的唯一用途是"自己坏"对照：若新实现退回旧口径，①的拒会变回静默放行。
 */
const oldCollect = (root) => {
  const out = [];
  for (const d of listFeatures()) {
    if (!d.source_root || path.resolve(d.source_root) !== root) continue;
    const byPath = new Map();
    for (const n of d.geometry?.nodes ?? []) {
      if (n.type !== 'file') continue;
      if (typeof n.description !== 'string' || !n.description) continue;
      byPath.set(n.description.split(path.sep).join('/'), n.id);
    }
    for (const f of d.semantic?.files ?? []) {
      if (f.path && !byPath.has(f.path)) byPath.set(f.path.split(path.sep).join('/'), f.id);
    }
    if (byPath.size) out.push(d.feature);
  }
  return out;
};

const DECISION = (why) => ({
  summary: `T352 夹具：${why}`,
  expectations: [{ kind: 'file-exists', path: 'src/missing-own.ts', why: 'T352 夹具：后态判据红 ⇒ 卡可领（work）' }],
});

// ════════════════════════════════════════════════════════════════════
console.log('════ ① path 型节点：旧口径静默放行 ⇒ 新口径点名"未领任务" ════');
const PATH_NODE = { id: 'file_src_a_ts', type: 'file', label: 'a.ts', path: 'src/a.ts' };
{
  seed([{ ...PATH_NODE, decision: DECISION('path 型节点（只有 path、无 description、无 semantic.files）') }]);
  // ★ 先看旧口径：同一夹具，旧收集器一条也收不到
  const old = oldCollect(ROOT);
  const covBefore = collectGateCoverage(ROOT);
  const before = gate('src/a.ts');
  chk(old.length === 0, '①a 旧口径：0 条 feature 收集到（⇒ 旧行为会走 applicable:false 放行）', `oldCollect=${JSON.stringify(old)}`);
  chk(
    before.threw && /没有挂到任何已领取的任务上/.test(before.msg),
    '①b 新口径：同一夹具**抛"未领任务"**（不是 applicable:false）',
    before.threw ? before.msg.split('\n')[0] : JSON.stringify(before.out),
  );
  chk(
    covBefore.features.some((f) => f.byPath.get('src/a.ts') === 'file_src_a_ts'),
    '①c 拒的理由是**看见了节点**（collect 的 byPath 里有 src/a.ts → file_src_a_ts）',
    `byPath=${JSON.stringify(covBefore.features.map((f) => [...f.byPath]))}`,
  );

  // ★ 同一夹具：publish + claim 后必须放行（否则 ①b 可能是"什么都拒"）
  const edit = (ops, reason) =>
    editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t352', reason, operations: ops });
  const pub = await edit([{ type: 'task', op: 'publish', id: 'file_src_a_ts' }], 'T352 夹具：从决策卡立卡 file_src_a_ts');
  const cla = await edit(
    [{ type: 'task', op: 'claim', id: 'file_src_a_ts', data: { owner: 'agent-t352' } }],
    'T352 夹具：领取 file_src_a_ts（path 型节点）',
  );
  const state = (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === 'file_src_a_ts')?.task?.state;
  const after = gate('src/a.ts');
  chk(pub?.isError !== true && cla?.isError !== true && state === 'claimed', '①d publish→claim 走通，task.state=claimed', `state=${state}`);
  chk(
    !after.threw && after.out.applicable === true && after.out.basis === 'covered',
    '①e 有 claimed 卡 ⇒ **放行**（basis=covered）—— 证明 ①b 的拒不是"什么都拒"',
    after.threw ? after.msg.split('\n')[0] : JSON.stringify(after.out),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 合法的"本项目不用任务系统"仍能 applicable:false ════');
{
  seed([{ ...PATH_NODE }], { root: OTHER_ROOT });
  const r = gate('src/a.ts');
  chk(
    !r.threw && r.out.applicable === false && r.out.basis === 'no-feature-for-root',
    '②a 0 条 feature 指到根 ⇒ applicable:false · basis=no-feature-for-root',
    r.threw ? r.msg.split('\n')[0] : JSON.stringify(r.out),
  );
  chk(
    !r.threw && /\*\*0 条\*\*/.test(r.out.note) && r.out.note.includes(ROOT),
    '②b note **点名依据**（"0 条" + 项目根路径），不是一句"不适用"',
    r.threw ? '' : r.out.note,
  );

  const nf = assertSourceWriteRegistered(ROOT, ['../outside-repo.ts']);
  chk(nf.applicable === false && nf.basis === 'no-files', '②c 入参 0 个文件落在根内 ⇒ basis=no-files', JSON.stringify(nf));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 收集失败必须点名（不许混进 applicable:false）════');
{
  seed([{ id: 'file_src_a_ts', type: 'file', label: 'a.ts' }]); // ★ 既无 path 也无 description
  const r = gate('src/a.ts');
  chk(r.threw && /收集失败/.test(r.msg), '③a 抛"收集失败"（不是 applicable:false）', r.threw ? r.msg.split('\n')[0] : JSON.stringify(r.out));
  chk(r.threw && r.msg.includes('file_src_a_ts') && /既无 path 也无 description/.test(r.msg), '③b **点名**哪个节点缺 path/description', r.threw ? r.msg.split('\n')[1].trim() : '');
  chk(r.threw && !/不适用（放行）/.test(r.msg), '③c 错误文案里**没有**"不适用（放行）"的措辞（两件事不许混）');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ 合法放行：本项目有任务系统、但这条路径不在设计里 ════');
{
  seed([{ ...PATH_NODE }]);
  const r = gate('src/other.ts');
  chk(
    !r.threw && r.out.applicable === true && r.out.basis === 'files-not-in-design',
    '④a 文件不在任何 covering feature 里 ⇒ 放行 · basis=files-not-in-design',
    r.threw ? r.msg.split('\n')[0] : JSON.stringify({ applicable: r.out.applicable, basis: r.out.basis }),
  );
  chk(!r.threw && r.out.note.includes('src/other.ts'), '④b note **逐个点名**那个文件（不是"另有 N 个不计"）', r.threw ? '' : r.out.note.split('\n')[0]);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ "自己坏"对照：旧口径在两种夹具上都"看不见" ════');
{
  // A：path 型节点
  seed([{ ...PATH_NODE, decision: DECISION('path 型节点') }]);
  const oldA = oldCollect(ROOT);
  chk(oldA.length === 0, '⑤a 旧口径在 path 型夹具上 0 条 ⇒ 若删掉 path 回落，①b 会退化成静默放行（本证会红）', `oldCollect=${JSON.stringify(oldA)}`);

  // B：节点不可寻址
  seed([{ id: 'file_src_a_ts', type: 'file', label: 'a.ts' }]);
  const oldB = oldCollect(ROOT);
  chk(oldB.length === 0, '⑤b 旧口径在"缺 path/description"夹具上也是 0 条 ⇒ 这就是当年"收集失败"被读成"不适用"的机制', `oldCollect=${JSON.stringify(oldB)}`);
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
