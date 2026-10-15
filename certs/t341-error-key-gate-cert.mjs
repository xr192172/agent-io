#!/usr/bin/env node
/**
 * ★★★ cert T341 —— **「本次新引入的错」判据：从**文本差集**改为**错误键**」的出生证**（2026-10-16）。
 *
 * ## 这一笔要钉住什么
 *   T340 把 `validateDSL` 接到 `edit_dsl` 提交前。它判"**本次新引入的错**"用的是
 *   `after.errors − 调用前 errors` 的**字符串差集**（`update_feature.ts`）。
 *   ★ **脆弱点**（T340 自己报的）：**若某次编辑使"既有错的文本"发生变化**（典型：**重命名**"被指向的名字"）
 *     ⇒ 旧错文本消失、新文本出现 ⇒ **被字符串差集当成"本次新增"** ⇒ **误拦合法编辑**。
 *   ⇒ 本笔把判据改成按**稳定的"错误键"**比较（键 = code + **出错位置/主体**，★ 不含"被指向的对方名字"）。
 *
 * ## ★★ 第 0 步（先找既有解法，不新造）—— "怎么判断某个错是**同一条错**（而不是新增的）"本仓 ≥2 处
 *   · ① `domain/overlay.ts:406` `byPath.get(a.path)` + `:429` `_migratedFrom` —— 重建设计时给设计锚点**认亲**：
 *     按 **path / 接口签名**（**稳定身份**）对账，**改名**走 `_migratedFrom` 记"从谁迁来的"，
 *     而不是拿"整段记录文本"比对。
 *   · ② `infrastructure/graph/import_project.ts:1055 allow_design_drop` —— 判定"哪些节点会被丢掉"时
 *     **点名到 id**（`willDrop` = 按 `node.id` 与 `isScannedNodeId` 前缀算差集），**不是比文本**。
 *   · ③ `application/design/dsl_ops/op_data_spec.ts:385 checkOpSpec` —— 判"本次"只看**本次入参**，
 *     按**键名**（`OP_SPECS` 的表）比对，不看历史文本。
 *   ⇒ ★ 本笔照它们的口径：**按稳定键（位置/主体）对账**。这些既有解都要一个"稳定的名字/路径/id"作判据，
 *     ★ 而定 **`validateDSL` 的 error 产物**此前**只有文本、没有键** ⇒ 本笔**附加**一个键字段（**不改判定**）。
 *
 * ## ★★ 关键前提：`validateDSL` 的 error **是什么形状**？（决定"按错误键比较"能不能直接做）
 *   · 读处：**真仓** `src/domain/validator.ts`（`validateDSL` 定义在 `:159`；`ValidationResult` 定义在其上方）：
 *       `export interface ValidationResult { valid: boolean; errors: string[]; }`  ⇒ ★ **纯字符串数组**（无 code / 无结构化字段）。
 *     文本形如 `[dangling_edge] edge "edge_ab".to "node_b" 在 geometry.nodes 中找不到`
 *     —— ★ `[dangling_edge]` 只是**文本前缀**，`edge_ab` / `node_b` 也只是**文本里的名字**，**不是结构化字段**。
 *   · ⇒ 结论：**现状是纯字符串、不带键**。★ 但**允许**在 error 产物上**附加**一个稳定键字段（本笔就是）——
 *     ★ **判定逻辑（判什么 / 判几条 / 文本）一字未改**，只是每条错**另产出** `key`（见 `validator.ts` 的 `ValidationErrorItem`）。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ **核心场景（造那个误判）**：让一条**既有错**的文本变化（悬空边 `edge_ab.to` 的**被指向名字**
 *      由 `"node_bb"` 变为 `"node_b"`，**错误条数/性质不变**，仍是那一条 `[dangling_edge]`）
 *      ⇒ 经工具层 `edit_dsl`（`snapshot rollback`）**必须不被判为"本次新增"**（放行）。
 *      ★ 同处贴出 **旧口径（文本差集）** 会算出 ≥1 条"新增"（⇒ 证明旧口径**确实会误拦**）—— **对照**。
 *   ② **真新引入的错仍被拦**（经工具层 `edit_dsl`；拒绝原文须含 `[dangling_edge]`）。
 *   ③ **合法写入仍成功**（经工具层 `edit_dsl`；不误伤）。
 *   ④ **键与文本的契约**：`validateDSL(...).keys` 与 `.errors` **同长同序**；且**错误文本逐字未改**（比对已知原文）。
 *   ⑤ **键确实稳定**：重命名前后那条错的**键相同**（`dangling_edge:edge:edge_ab:to`，★ 不含名字）。
 *
 * ## ★★ 诚实清单（[未核] · 不许把推测写成实测）
 *   · ★ **悬空边在 `edit_dsl` 的常规写边路径上进不来**（同 T340）：`addEdge` 自带端点检查
 *     （`edge_ops.ts:32-37`）⇒ 能**经 `edit_dsl`** 把悬空边引入落定态的**唯一**路径是 `snapshot op=rollback`。
 *     本证①③②走的就是这条。
 *   · **schema 类错误的键 [未核]**：本证只跑**语义**类（`dangling_edge`）。`formatAjvErrors` 的键口径
 *     （`schema:<keyword>:<path>:<message>`）**未单列取证** —— 其 message 是 ajv 模板（非实例文本），
 *     但**未实测**"改实例取值不改其键"。
 *   · **MCP 传输 / `tools/list` schema 层 [未核]**：直接 import `editDslHandler`，没经 MCP server 协议。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · **真 feature [未核]**：本证全程**夹具**（`AGENT_IO_HOME` 指到临时目录），真仓 `.agent-io/` **只读不碰**。
 *   · ★ **不声称"没有行为改变"**（逐条列，见下）：
 *       1. `validateDSL` 的**返回对象多了一个 `keys` 字段**（`errors` / `valid` / 判定 / 文本**逐字未改**）；
 *       2. `update_feature.ts` 的"本次新增"判据**由文本差集改为键差集** ⇒ **改变的可观测行为**：
 *          · 既有错的**文本**变了但**键未变** ⇒ **不再被拦**（本笔要修的病）；
 *          · 若一次编辑让某条错的**键**变了（例：**那条错的 edge.id / file.id 本身被改名**）⇒
 *            **仍会被判为"本次新增"**（★ 键按"出错主体"认亲，主体改名 = 换了一条错，这与 ①②③ 的口径一致）。
 *       3. `validateDSLJson` 的 `json_parse` 分支补了一个常量键 `'json_parse'`（返回值新增字段，行为不变）。
 *
 * ## 用法
 *   node certs/t341-error-key-gate-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp341`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**。
 * ★★ 全证**只 1 次删除操作**（末尾清理）—— 故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp341');
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
const { saveSnapshot } = await import('../dist/src/application/design/lifecycle/snapshot.js');
const { validateDSL } = await import('../dist/src/domain/validator.js');

const FEAT = 't341';

// ── 夹具：**自洽**基线（A、B 两节点 + 一条 A→B 的边 + 两条 semantic.files）──
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
// ── 夹具：「悬空边」旧状态 —— `edge_ab.to` 指向**已被摘掉的** node；`to` 的名字可调（模拟"被指向的名字"）──
const danglingTo = (target) => {
  const d = validDsl();
  d.geometry.nodes = d.geometry.nodes.filter((n) => n.id !== 'node_b');
  d.semantic.files = d.semantic.files.filter((f) => f.id !== 'node_b');
  d.geometry.edges = [{ id: 'edge_ab', from: 'node_a', to: target }]; // 悬空：target 不在 nodes[]
  return d;
};

console.log('════ 0. 夹具就位 + `validateDSL` 的 error 形状（纯字符串 + 附加键）════');
saveDSL(validDsl());
{
  const v = validateDSL(getDSL(FEAT));
  chk(v.valid === true, '0 基线自洽：`validateDSL` 对夹具基线返回 valid=true', `valid=${v.valid} · errors=${JSON.stringify(v.errors)}`);
}
{
  // ★ 核 error 形状：errors 是**字符串数组**（真仓类型 = ValidationResult.errors: string[]）；
  //   keys 是本次**附加**的稳定键，与 errors **同长同序**。
  const d = danglingTo('node_b');
  const v = validateDSL(d);
  dump('danglingTo("node_b") 的 validateDSL 读数', `valid=${v.valid}\nerrors=${JSON.stringify(v.errors)}\nkeys  =${JSON.stringify(v.keys)}`);
  chk(
    v.valid === false && Array.isArray(v.errors) && v.errors.every((e) => typeof e === 'string'),
    '0-b error 形状：`errors` 是**纯字符串数组**（无 code / 无结构化字段）—— 见真仓 `validator.ts` 的 `ValidationResult`',
    `errors 元素类型全为 string = ${v.errors.every((e) => typeof e === 'string')}`,
  );
  chk(
    Array.isArray(v.keys) && v.keys.length === v.errors.length && v.errors.length === 1,
    '0-c ★ 附加键：`keys` 与 `errors` **同长同序**（`errors[i] ↔ keys[i]`），本条 1:1',
    `errors.length=${v.errors.length} · keys.length=${v.keys.length} · keys=${JSON.stringify(v.keys)}`,
  );
  chk(
    v.errors[0] === '[dangling_edge] edge "edge_ab".to "node_b" 在 geometry.nodes 中找不到',
    '0-d ★ 文本逐字未改：本条错原文与 T340 之前**完全一致**（判定/文本一个字未改）',
    `原文 = ${JSON.stringify(v.errors[0])}`,
  );
  chk(
    v.keys[0] === 'dangling_edge:edge:edge_ab:to',
    '0-e ★ 键的口径：`dangling_edge:edge:<edge.id>:<端点>` —— ★ **不含**被指向的名字（`node_b`）',
    `key = ${JSON.stringify(v.keys[0])}`,
  );
}

// ════ ① 核心场景：既有错的**文本变了**（名字改掉）⇒ **不得**被判"本次新增" ════
console.log('\n════ ① ★★ 既有 `[dangling_edge]` 的文本变化（"node_bb" → "node_b"）⇒ 不得判为本次新增 ════');
{
  // 布置：先存一份"悬空指向 node_b"的旧态并快照；再让落定态变成"悬空指向 node_bb"（模拟改名后的现状）
  saveDSL(danglingTo('node_b'));
  const snap = saveSnapshot({ feature: FEAT, label: 'dangling-to-node_b' });
  saveDSL(danglingTo('node_bb')); // ← 调用前落定态：同一条边，被指向的名字 = "node_bb"
  const before = validateDSL(getDSL(FEAT));
  dump('调用前 (to="node_bb") 读数', `errors=${JSON.stringify(before.errors)}\nkeys  =${JSON.stringify(before.keys)}`);

  // ★ 经工具层 edit_dsl：回滚到"to=node_b"那份快照 ⇒ 文本由 "node_bb" 变为 "node_b"（同一条错、同性质、同条数）
  const res = await editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: '回滚到快照 dangling-to-node_b 以复核 node_a / edge_ab 的旧版形态（T341 核心判据）',
    operations: [{ type: 'snapshot', op: 'rollback', data: { snapshot_id: snap.snapshot_id } }],
  });
  dump('工具回执原文（edit_dsl → editDslHandler）', res.text);
  const after = validateDSL(getDSL(FEAT));
  dump('调用后 (落定 to="node_b") 读数', `errors=${JSON.stringify(after.errors)}\nkeys  =${JSON.stringify(after.keys)}`);

  chk(
    after.errors.length === 1 && after.errors[0].includes('"node_b"') && after.errors[0].startsWith('[dangling_edge]'),
    '①-0 场景确凿：编辑确实**让既有错的文本变了**（`"node_bb"` → `"node_b"`），**仍是那一条** `[dangling_edge]`、**条数不变**',
    `before = ${JSON.stringify(before.errors)} · after = ${JSON.stringify(after.errors)}`,
  );
  chk(
    res.isError !== true,
    '① ★★ **修好**：经工具层 `edit_dsl` **未被拦**（文本变了但"键"未变 ⇒ 认作同一条既有错 ⇒ 放行）',
    res.isError ? `★★ 仍被拦（未修好）：${res.text.split('\n')[0]}` : `回执首行 = ${res.text.split('\n')[0]}`,
  );
  chk(
    after.keys.length === before.keys.length && after.keys.every((k) => before.keys.includes(k)),
    '①-b ★ 键稳定：重命名前后那条错的**键相同**（键**不含**被指向的名字）',
    `before.keys=${JSON.stringify(before.keys)} · after.keys=${JSON.stringify(after.keys)}`,
  );
  // ── ④ 对照：**旧口径（文本差集）** 在同一次读数上会算出 ≥1 条"新增" ⇒ 会误拦 ──
  const oldNew = after.errors.filter((e) => !new Set(before.errors).has(e));
  chk(
    oldNew.length >= 1,
    '④ ★★ **对照（旧口径会误拦）**：`after.errors − before.errors` 的**文本差集**在同一次读数上算出 ≥1 条"新增" ⇒ 旧口径**确实会拦下这条合法编辑**',
    `旧口径新增=${JSON.stringify(oldNew)} · （真仓修前实测：编辑被拒，原文含「新增 1 条」+ 该 dangling 原文）`,
  );
}

// ════ ② 真新引入的错仍被拦（经工具层，拒绝原文含 `[dangling_edge]`）════
console.log('\n════ ② 真新引入的错 ⇒ 仍被拦（经工具层 `edit_dsl`，拒绝原文须含 `[dangling_edge]`）════');
{
  // 干净基线（0 错）→ 一份含悬空边的快照 → 再回滚到它 ⇒ 相对基线**新引入** 1 条 dangling_edge
  saveDSL(validDsl());
  saveDSL(danglingTo('node_zzz'));
  const snapBad = saveSnapshot({ feature: FEAT, label: 'dangling-to-node_zzz' });
  saveDSL(validDsl()); // 落定态恢复为自洽（基线 0 错）
  const before = validateDSL(getDSL(FEAT));
  chk(before.valid === true, '②-0 基线自洽（0 错）⇒ 回滚引入的 dangling_edge 是**真·本次新增**', `valid=${before.valid}`);

  const res = await editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: '回滚到快照 dangling-to-node_zzz 以复核 node_a / edge_ab 的坏版形态（T341 新引入判据）',
    operations: [{ type: 'snapshot', op: 'rollback', data: { snapshot_id: snapBad.snapshot_id } }],
  });
  dump('工具回执原文 · 本次新引入 dangling_edge', res.text);
  chk(
    res.isError === true && /拒绝提交/.test(res.text) && /\[dangling_edge\]/.test(res.text) && /新增 1 条/.test(res.text),
    '② ★★ 真新引入的错误 ⇒ **被拒**，拒绝原文含 **`[dangling_edge]`**（错误原文，不是 warning）',
    res.isError ? `命中：${res.text.split('\n').find((l) => /\[dangling_edge\]/.test(l)) ?? ''}` : '★★ 没被拒',
  );
  {
    const dsl = getDSL(FEAT);
    const v = validateDSL(dsl);
    chk(v.valid === true, '②-b 被拒后**没有偷偷落盘**：DSL 仍自洽（回滚到调用前状态）', `valid=${v.valid} · errors=${JSON.stringify(v.errors)}`);
  }
}

// ════ ③ 合法写入仍成功（经工具层，不误伤）════
console.log('\n════ ③ 合法写入（node/add）经工具层 ⇒ 成功（不误伤）════');
{
  saveDSL(validDsl());
  const res = await editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: '新增 node_c 以记录 src/c.ts 的设计职责（T341 合法写入判据）',
    operations: [{ type: 'node', op: 'add', id: 'node_c', data: { type: 'file', label: 'C', description: 'src/c.ts' } }],
  });
  dump('工具回执原文', res.text);
  const dsl = getDSL(FEAT);
  const v = validateDSL(dsl);
  chk(
    res.isError !== true && (dsl.geometry?.nodes ?? []).some((n) => n.id === 'node_c') && v.valid === true,
    '③ ★ 合法写入**照常成功**（不误伤）：`node_c` 落地且整份 DSL 仍自洽',
    res.isError ? `★ 被拒：${res.text.split('\n').slice(-1)[0]}` : `回执首行 = ${res.text.split('\n')[0]} · valid=${v.valid}`,
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp341 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
