#!/usr/bin/env node
/**
 * ★★★ cert T340 —— **「改设计即校验自洽」的出生证**（2026-10-16）。
 *
 * ## 这一笔要钉住什么
 *   `validateDSL`（`src/domain/validator.ts:159`，查 `dangling_edge` / `duplicate_id` / `anchor_broken` /
 *   reasoning 引用）★ **全仓只被已退役的 `presentation/http/serve.ts:194` 用** ⇒ **今天没有任何活的入口
 *   会跑它** ⇒ 用户那句"设计 DSL 天然应该是逻辑自洽的"目前是**零执行**。
 *   ⇒ 本笔把它接到 **`edit_dsl` 的提交前**（`update_feature.ts` 的 `updateFeatureCore`：全量 op 应用完 ⇒
 *     回读落定后的 DSL 跑 `validateDSL`；**本次新引入错误** ⇒ 恢复 backup + 抛）—— **不改 `validateDSL` 判定、不改 schema**。
 *
 * ## ★★ 第 0 步（先找既有解法，不新造）—— "写入前先校验，不过就拒"本仓 ≥2 处
 *   · ① `application/write_gate.ts:543 assertSourceWriteRegistered` —— 落盘**前**（`writeSourceFiles:766`
 *     在快照/真写前调）判"未登记/前置未满足" ⇒ **抛错拒绝落盘**，错里给"怎么登记"（工具名 + 最小参数）。
 *   · ② `application/design/dsl_ops/op_data_spec.ts:385 checkOpSpec` —— `applyOperation` 写前的键校验，
 *     不合法⇒抛，并**点名该给哪些键**（"错误信息就是最好的文档"）—— ★ 本笔的"只拦本次"口径也取自它。
 *   · ③ `application/design/dsl_ops/status_tools.ts:81-83` —— **先过闸再落盘**：`validateProgressEvidence`
 *     不过 ⇒ `throw`（判据唯一住处 = `domain/overlay.ts:104`）。
 *   · ④ `infrastructure/graph/import_project.ts:1055 allow_design_drop` —— 重建前闸，**点名**要丢哪些节点 + 三选一。
 *   ⇒ ★ 本笔照它们的口径：**拒绝时给 error 原文 + "怎么改"**（见 `update_feature.ts` 的 `prefixFix` 映射）。
 *
 * ## ★★ 拦的范围 = **只拦"本次新引入的"错误**（不是"拦全部"）—— 理由是实测"现状并非全过"
 *   （★ 判据来源：`certs/.work/probe-validate.mjs` 的全量扫描 + 既有证实测）
 *   · 真仓 feature `observe-skeleton`：**现状本就 5 条 `[anchor_broken]`**（`semantic.files` 无几何节点）。
 *   · 既有证 `t329` / `t330` 的**夹具 DSL 本身不满足 schema**（edges 缺 `id` / files 缺 `responsibility`）。
 *   ⇒ 若"拦全部"，这些**与本次改动无关的既有错**会被算到本次头上 ⇒ **拦住一切写入**（含 t329/t330，
 *     违反"既有十三证不许红"）。⇒ 判据取 `after.errors − 调用前 errors`：**本次没新增 ⇒ 放行**。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① 造一条 `edge.to` 指向不存在节点的**悬空边**状态（存成快照）⇒ **经工具层** `edit_dsl` 回滚到它
 *      ⇒ **被拒**，回执原文含 **`[dangling_edge]`**；且**被拒后没有偷偷落盘**（DSL 仍自洽）。
 *   ② **合法写入**（`node/add` 一个有效节点）⇒ **经工具层照常成功**（不误伤）。
 *   ③ ★ **对照**：**绕过 `edit_dsl` 的这道闸**（直调底层 `rollbackSnapshot`）⇒ **同一条悬空边会被写进去**
 *      （读落盘 DSL ⇒ 悬空边在场、`validateDSL` 报 `[dangling_edge]`）⇒ 证明这道闸**真的在起作用**。
 *   ④ ★ **自证走的是工具层**：① 的那次 `edit_dsl` 被拒，③ 的**同一操作**却成功落盘 ⇒ 拒绝只能来自
 *      `edit_dsl` 路径（`updateFeatureCore`），不是底层 `rollbackSnapshot` 本身。
 *   ⑤ ★ **「只拦新增」语义**：调用前的既有错**不背在本次头上**（合法写入放行）；本次**新引入**的错误才被拒
 *      （只点名本次那一条）—— 这是"现状并非全过"下**不误伤既有数据**的判据。
 *
 * ## ★★ 诚实清单（[未核] · 不许把推测写成实测）
 *   · ★ **悬空边在 `edit_dsl` 的常规写边路径上进不来**（本证复核实测）：`addEdge` 自带端点检查
 *     （`edge_ops.ts:32-37`）、`deleteNode` 级联删边（`node_ops.ts:410-411`）、`removeFileFromDsl`
 *     级联删边（`domain/dsl_removal.ts:51`）⇒ 能**经 `edit_dsl`** 把悬空边引入落定态的**唯一**路径是
 *     `snapshot op=rollback`（复原一份含悬空边的旧快照）。本证①③走的就是这条。
 *   · **`[anchor_broken]` 那条更易触发**（`file/add` 只进 `semantic.files`、不建几何节点）—— 本证**未单列**。
 *   · **MCP 传输 / `tools/list` schema 层 [未核]**：直接 import `editDslHandler`，没经 MCP server 协议。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · **真 feature [未核]**：本证全程**夹具**（`AGENT_IO_HOME` 指到临时目录），真仓 `.agent-io/` **只读不碰**。
 *   · ★ **不声称"没有行为改变"**：接上本闸后，**任何"让设计变得比调用前更不自洽"的 `edit_dsl` 都会开始被拒**
 *     （本次新引入 `dangling_edge` / `duplicate_id` / `anchor_broken` / reasoning 引用错其一即拒）。
 *     而**调用前就有的**错**不被算作本次新增**（见"拦的范围"）⇒ 对 `observe-skeleton` / `t329` / `t330`
 *     这类**基线本就不自洽**的数据，只要本次不新增错，**照旧放行**。
 *
 * ## 用法
 *   node certs/t340-edit-dsl-validate-gate-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp340`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按删除【操作】数累计，阈值 50）——
 *   故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp340');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const dump = (label, text) => {
  console.log(`   ── ${label} ──`);
  for (const line of String(text).split('\n')) console.log(`     ${line}`);
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { saveSnapshot, rollbackSnapshot } = await import('../dist/src/application/design/lifecycle/snapshot.js');
const { validateDSL } = await import('../dist/src/domain/validator.js');

const FEAT = 't340';

// ── 夹具：**自洽**的基线（A、B 两节点 + 一条 A→B 的边）──
const validDsl = () => ({
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
      { id: 'node_a', type: 'file', label: 'A', x: 10, y: 10, width: 100, height: 40, description: 'src/a.ts' },
      { id: 'node_b', type: 'file', label: 'B', x: 200, y: 10, width: 100, height: 40, description: 'src/b.ts' },
    ],
    edges: [{ id: 'edge_ab', from: 'node_a', to: 'node_b' }],
  },
  semantic: {
    files: [
      { id: 'node_a', path: 'src/a.ts', responsibility: 'A 的职责' },
      { id: 'node_b', path: 'src/b.ts', responsibility: 'B 的职责' },
    ],
  },
});
// ── 夹具：「悬空边」状态（node_b 被摘掉，但 edge_ab 仍指向它）──
const danglingDsl = () => {
  const d = validDsl();
  d.geometry.nodes = d.geometry.nodes.filter((n) => n.id !== 'node_b');
  d.semantic.files = d.semantic.files.filter((f) => f.id !== 'node_b');
  return d; // edge_ab.to = node_b，而 node_b 已不在 nodes[] ⇒ 悬空
};

console.log('════ 0. 夹具就位：自洽基线 + 一条"悬空边"旧状态 ════');
saveDSL(validDsl());
{
  const v = validateDSL(getDSL(FEAT));
  chk(v.valid === true, '0 基线自洽：`validateDSL` 对夹具基线返回 valid=true', `valid=${v.valid} · errors=${JSON.stringify(v.errors)}`);
}
saveDSL(danglingDsl());
let snap = null;
{
  const v = validateDSL(getDSL(FEAT));
  chk(
    v.valid === false && v.errors.some((e) => e.startsWith('[dangling_edge]')),
    '0-b 悬空边确凿：那条旧状态的 `validateDSL` 报 **`[dangling_edge]`**（⇒ 后面被拒的理由就是它）',
    `valid=${v.valid} · errors=${JSON.stringify(v.errors)}`,
  );
  snap = saveSnapshot({ feature: FEAT, label: 'legacy-dangling' });
  chk(!!snap?.snapshot_id, '0-c 把这条悬空状态存成快照（模拟"旧数据里的坏边"）', `snapshot_id=${snap?.snapshot_id}`);
}
saveDSL(validDsl());
{
  const v = validateDSL(getDSL(FEAT));
  chk(v.valid === true, '0-d 复位：把基线恢复为自洽（此后 edit_dsl 面对的是一份干净设计）', `valid=${v.valid}`);
}

// ════ ① 经工具层 edit_dsl 回滚到那条悬空快照 ⇒ 被拒（须含 [dangling_edge]）════
console.log('\n════ ① 经工具层（edit_dsl）回滚到悬空快照 ⇒ 被拒 ════');
const res1 = await editDslHandler({
  feature: FEAT,
  weight: 'routine',
  reason: `回滚到快照 legacy-dangling 以复核 node_a / edge_ab 的旧版形态（T340 工具层判据）`,
  operations: [{ type: 'snapshot', op: 'rollback', data: { snapshot_id: snap.snapshot_id } }],
});
dump('工具回执原文（edit_dsl → editDslHandler）', res1.text);
chk(
  res1.isError === true && /拒绝提交/.test(res1.text) && /\[dangling_edge\]/.test(res1.text),
  '① ★★ 悬空边经 `edit_dsl` ⇒ **被拒**，回执原文含 **`[dangling_edge]`**（错误原文，不是 warning）',
  res1.isError ? '（见上）' : '★★ 没被拒（静默接受了悬空边）',
);
chk(
  res1.isError === true && /怎么改/.test(res1.text) && /edge\.from \/ edge\.to/.test(res1.text),
  '①-b 被拒时**说清怎么改**（点名 `[dangling_edge]` 的对策）—— 照 `checkOpSpec` / `allow_design_drop` 既有口径',
  res1.isError ? res1.text.split('\n').filter((l) => /怎么改|edge\./.test(l)).join(' | ') : '★★ 没被拒',
);
{
  // ★ 被拒后**没有偷偷落盘**：DSL 仍自洽（回滚到调用前状态）
  const dsl = getDSL(FEAT);
  const v = validateDSL(dsl);
  const nodeIds = new Set((dsl.geometry?.nodes ?? []).map((n) => n.id));
  chk(
    v.valid === true && nodeIds.has('node_b') && (dsl.geometry?.edges ?? []).every((e) => nodeIds.has(e.from) && nodeIds.has(e.to)),
    '①-c 被拒后**没有偷偷落盘**：DSL 仍自洽（`node_b` 在场、边不悬空）',
    `valid=${v.valid} · nodes=${JSON.stringify([...nodeIds])} · errors=${JSON.stringify(v.errors)}`,
  );
}

// ════ ② 合法写入经工具层 ⇒ 照常成功 ════
console.log('\n════ ② 合法写入（node/add）经工具层 ⇒ 成功（不误伤）════');
const res2 = await editDslHandler({
  feature: FEAT,
  weight: 'routine',
  reason: `新增 node_c 以记录 src/c.ts 的设计职责（T340 合法写入判据）`,
  operations: [{ type: 'node', op: 'add', id: 'node_c', data: { type: 'file', label: 'C', description: 'src/c.ts' } }],
});
dump('工具回执原文', res2.text);
{
  const dsl = getDSL(FEAT);
  const v = validateDSL(dsl);
  chk(
    res2.isError !== true && (dsl.geometry?.nodes ?? []).some((n) => n.id === 'node_c') && v.valid === true,
    '② ★ 合法写入**照常成功**（不误伤）：`node_c` 落地且整份 DSL 仍自洽',
    res2.isError ? `★ 被拒：${res2.text.split('\n').slice(-1)[0]}` : `回执首行 = ${res2.text.split('\n')[0]} · valid=${v.valid}`,
  );
}

// ════ ③ 对照：绕过 edit_dsl 的闸（直调底层 rollbackSnapshot）⇒ 悬空边会被写进去 ════
console.log('\n════ ③ 对照：不接校验（直调底层 `rollbackSnapshot`）⇒ 同一条悬空边**被写进去** ════');
rollbackSnapshot({ feature: FEAT, snapshot_id: snap.snapshot_id }); // ★ 绕过 updateFeatureCore 的那道闸
{
  const dsl = getDSL(FEAT);
  const v = validateDSL(dsl);
  const nodeIds = new Set((dsl.geometry?.nodes ?? []).map((n) => n.id));
  const dangling = (dsl.geometry?.edges ?? []).filter((e) => !nodeIds.has(e.from) || !nodeIds.has(e.to));
  dump('落盘 DSL 原文里的那条边 + node_b 是否在场', `edge_ab = ${JSON.stringify((dsl.geometry?.edges ?? []).find((e) => e.id === 'edge_ab'))} · node_b 在场 = ${nodeIds.has('node_b')}`);
  chk(
    dangling.length >= 1 && v.valid === false && v.errors.some((e) => e.startsWith('[dangling_edge]')),
    '③ ★★ 对照成立：**绕过这道闸**，同一条悬空边**真的落进了 DSL**（`validateDSL` 当场判 `[dangling_edge]`）⇒ 证明这道闸在起作用',
    `悬空边数=${dangling.length} · valid=${v.valid} · ${v.errors.find((e) => e.startsWith('[dangling_edge]')) ?? ''}`,
  );
}
// 复原夹具（不把坏状态留给后续判据）
saveDSL(validDsl());

// ════ ④ 自证走工具层：把坏状态塞回 `nodes[]`（id 缺失）经工具层 ⇒ 被 schema 点名 ════
console.log('\n════ ④ 自证走的是工具层（不是直调底层纯函数）════');
{
  // ① 经 edit_dsl 被拒、③ 同一操作直调底层却成功 ⇒ 拒绝只能来自 edit_dsl 路径。
  // 再补一条硬证据：edit_dsl 对**未知键**会用 `checkOpSpec` 点名（证明真的穿过了工具层）。
  const res4 = await editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: `验证 edit_dsl 走的是工具层（node_a 的未知键判据，T340）`,
    operations: [{ type: 'node', op: 'add', id: 'node_d', data: { label: 'D', definitely_bogus_key: 1 } }],
  });
  dump('未知键回执原文', res4.text);
  chk(
    res4.isError === true && /不被认的键/.test(res4.text) && /definitely_bogus_key/.test(res4.text),
    '④ ★ 未知键 ⇒ 被 `checkOpSpec` 点名「不被认的键」（⇒ 本证确实在工具层之后，不是直调底层）',
    res4.isError ? res4.text.split('\n').find((l) => /不被认的键/.test(l)) ?? '' : '★★ 没被拒',
  );
}

// ════ ⑤ 「只拦本次新引入的」语义：调用前的既有错**不算在本次头上**（现状并非全过）════
console.log('\n════ ⑤ 只拦新增：既有错不背在本次头上（现状并非全过 ⇒ 才这么定）════');
const FEAT2 = 't340b';
{
  // 夹具：一份**基线就有错**的设计（`semantic.files` 里塞一个没有几何节点的 id ⇒ `[anchor_broken]`）
  const withLegacyError = () => ({
    ...validDsl(),
    feature: FEAT2,
    id: `feature_${FEAT2}`,
    title: FEAT2,
    semantic: {
      files: [
        { id: 'node_a', path: 'src/a.ts', responsibility: 'A 的职责' },
        { id: 'node_b', path: 'src/b.ts', responsibility: 'B 的职责' },
        { id: 'orphan_legacy', path: 'src/legacy.ts', responsibility: '基线就断锚的条目' }, // ← 既有错
      ],
    },
  });
  saveDSL(withLegacyError());
  const before = validateDSL(getDSL(FEAT2));
  chk(
    before.valid === false && before.errors.some((e) => e.startsWith('[anchor_broken]')),
    '⑤-0 夹具：基线本身就有 1 条 `[anchor_broken]`（`orphan_legacy` 无几何节点）',
    `valid=${before.valid} · errors=${JSON.stringify(before.errors)}`,
  );
  // ① 一次**不碰那条既有错**的合法写入 ⇒ 应**放行**（既有错不算本次新增）
  const r1 = await editDslHandler({
    feature: FEAT2,
    weight: 'routine',
    reason: `给 node_a 新增一个无关节点 node_ok 以记录 src/ok.ts（T340 只拦新增判据）`,
    operations: [{ type: 'node', op: 'add', id: 'node_ok', data: { type: 'file', label: 'OK', description: 'src/ok.ts' } }],
  });
  const after1 = validateDSL(getDSL(FEAT2));
  chk(
    r1.isError !== true && (getDSL(FEAT2)?.geometry?.nodes ?? []).some((n) => n.id === 'node_ok') &&
      after1.errors.some((e) => e.startsWith('[anchor_broken]')),
    '⑤-1 ★ 合法写入经工具层**放行**：既有 `[anchor_broken]` **未被算作"本次新增"**（错误集未变 ⇒ 不误伤）',
    r1.isError ? `★ 被拒：${r1.text.split('\n').slice(-1)[0]}` : `回执首行 = ${r1.text.split('\n')[0]} · 既有错仍在 = ${after1.errors.some((e) => e.startsWith('[anchor_broken]'))}`,
  );
  // ② 一次**新引入**错误的写入（`file/add` 一个没有几何节点的 id）⇒ 应**被拒**
  const r2 = await editDslHandler({
    feature: FEAT2,
    weight: 'routine',
    reason: `向 node_a 相关设计新增文件 src/new.ts 以记录新职责（T340 新引入错误判据）`,
    operations: [{ type: 'file', op: 'add', id: 'orphan_new', data: { path: 'src/new.ts', responsibility: '新条目（无几何节点）' } }],
  });
  dump('工具回执原文 · 本次新引入 `[anchor_broken]`', r2.text);
  chk(
    r2.isError === true && /新增 1 条/.test(r2.text) && /\[anchor_broken\]/.test(r2.text) && /orphan_new/.test(r2.text),
    '⑤-2 ★★ 本次**新引入**的错误 ⇒ **被拒**且只点名**本次那一条**（既有 `orphan_legacy` 不在新增名单里）',
    r2.isError ? `新增名单 = ${r2.text.split('\n').filter((l) => /anchor_broken/.test(l)).join(' | ')}` : '★★ 没被拒',
  );
  chk(
    !(getDSL(FEAT2)?.semantic?.files ?? []).some((f) => f.id === 'orphan_new'),
    '⑤-3 被拒后**没有偷偷落盘**（`orphan_new` 未进 semantic.files）',
    `semantic.files = ${JSON.stringify((getDSL(FEAT2)?.semantic?.files ?? []).map((f) => f.id))}`,
  );
}
saveDSL(validDsl()); // 复原主夹具

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp340 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
