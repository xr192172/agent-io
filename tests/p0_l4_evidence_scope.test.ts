/**
 * P0 · **L4「证据可回溯」的判定范围** —— `node.add` 建**新节点**时，不许因为"它还不存在"被打回。
 *
 * ## 病（实测，改前）
 * `edit_dsl {type:'node', op:'add'}`：`data.decision.expectations` 已写 `file-exists`（路径真实存在）、
 * 顶层 `evidence` 也指向同一条路径 ⇒ **L4 仍打回**「evidence 无法回溯：node "<path>" 不存在或对不上」
 * ⇒ 那张卡只能把 `weight` 降到 `routine` **绕过 L4** 才落盘。
 * ★ 更坏的一层：**同一条报文对"路径真实存在"与"路径根本不存在"完全一样**（改前四条探针字面相同）
 *   ⇒ 这条闸当时**没有任何鉴别力**。一条永远过不去的闸 = 被关掉的闸（AGENTS-RULES 0.16）。
 *
 * ## 根因（不是"证据编造"，是**判定范围**取错）
 * 旧 `existsFn` 只认"**已经存在**"：册里已有的 node id / `cache.db` 里查得到的文件 / T20 判过的
 * `notIndexed`。而**本批正在新建的节点**在册里必然还没有、新建的文件在索引里必然还没有。
 * 第二处：`notIndexed` 只由 `type=file|api` 的断言 op 触发计算（`targetFiles`）⇒ 一批**只有** `node.add`
 * 时它恒为空 ⇒ 本批 `declaredNew`（node.add 声明过的 file-exists 路径）**算了却没人用**。
 *
 * ## 判据（一条一条对着测，a 是"该绿的绿"，b 是"该红的仍红"）
 * | # | 输入 | 改前 | 改后 |
 * |---|---|---|---|
 * | a1 | node.add + evidence 指向**磁盘上真实存在、索引里没有**的路径 | 拒 | **放行** |
 * | a2 | node.add 声明 `file-exists`（本批要**新建**、磁盘上还没有的文件）+ evidence 指向它 | 拒 | **放行** |
 * | a3 | node.add + evidence 指向**本批新建的那个 node id** | 拒 | **放行** |
 * | b1 | evidence 指向**谁也没声明、磁盘也没有**的路径 | 拒 | **仍拒** |
 * | b1b | node.add 只在 `data.path` 写个路径、**没带 file-exists 期望** ⇒ evidence 指向它 | 拒 | **仍拒** |
 * | b2 | evidence 指向**本批之外**、册里也没有的 node id | 拒 | **仍拒** |
 * | c1 | **既有节点** update + evidence = 已有 node id | 放行 | **放行（同结论）** |
 * | c2 | **既有节点** update + evidence = **索引里查得到**的文件 | 放行 | **放行（同结论）** |
 *
 * ## 消融（b 必须能抓"为了修 a 把 L4 改成啥都过"）
 * 把 `src/application/observe/reconcile/reason_validator.ts#isTraceableRef` 的
 * `return hit(facts.known) || hit(facts.declared);` 改成 `return true;`
 * ⇒ **用例 2/8 失败**（b1 / b1b / b2 三条同时红），exit 1；还原 ⇒ **8/8 全绿**。
 * 反向：把 `handlers.ts#editDslHandler` 的 `declared: declaredEntities` 删掉（只留 `known`）
 * ⇒ **用例 3/8 失败**（a2 / a3 红）—— 证明"本批声明"这一档真的在承重。
 *
 * ## 边界（诚实清单）
 * · 不写仓内任何文件：`AGENT_IO_HOME` = 临时 home，代码根 = 临时根；
 * · **`source_root` 缺失时不做磁盘盘查**（`ref` 无从解析）⇒ 该档不生效，与既有"不给根就不判"同口径 [未核]；
 * · MCP 传输层 [未核]：直接 import `editDslHandler`（与 `tests/i1_edit_dsl_orphan.test.ts` 同一层）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ★ 必须在**任何** storage 调用之前（`getDataHome()` 每次调用现读 env）
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { saveDSL, getDSL } from '../src/infrastructure/storage.js';
import { editDslHandler } from '../src/application/design/handlers.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';

const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
/**
 * 夹具：这个文件**磁盘上真实存在**，但 ROOT 下没有 `.agent-io/cache.db` ⇒ `fileFacts` 查不到它
 * （= `.md` / 未入库新文件的那种状态：`matched_path === null`。★ 它**不是"不存在"**）。
 */
fs.writeFileSync(path.join(ROOT, 'src/real.ts'), 'export const r = 1;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME;
after(() => rmRf(TMP));

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

const seed = (feature: string, nodes: AnyRec[], root = ROOT) =>
  saveDSL({
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature,
    source_root: root,
    geometry: { layout: 'free', width: 400, height: 300, nodes, edges: [] },
    semantic: { files: [] },
    layers: {},
    annotations: [],
  } as never);

/** 理由必须过 L1（≥6 字）/ L2（非套话）/ L3（含实体：这里是文件路径）—— 本文件只测 L4 */
const reasonFor = (p: string) => `为 ${p} 建节点：下游设计要引用它的契约（上一批 3 个节点只能降 weight=routine 才落盘）`;

/** 调真写入端：拒 = isError，放行 = 无 isError 且有 text */
async function call(arg: AnyRec): Promise<{ rejected: boolean; text: string }> {
  const r: any = await editDslHandler(arg as never);
  return { rejected: r?.isError === true, text: String(r?.text ?? '') };
}

const nodeIdsOf = (feature: string): string[] =>
  (((getDSL(feature) as AnyRec)?.geometry?.nodes ?? []) as AnyRec[]).map((n) => String(n.id));

const fileExistence = (p: string): AnyRec[] => [{ kind: 'file-exists', path: p, why: `夹具：${p} 应该存在` }];

// ════════════════════════════════════════════════════════════════════
// a：该绿的绿（三条都是"本批正在新建 ⇒ 册里/索引里必然还没有"）
// ════════════════════════════════════════════════════════════════════
test('a1 node.add + evidence 指向【磁盘上有、索引里没有】的路径 ⇒ 必须放行（改前：拒「不存在或对不上」）', async () => {
  const F = 'p0l4a1';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/real.ts'),
    evidence: [{ type: 'node', ref: 'src/real.ts' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'node_a1',
        data: {
          type: 'step',
          label: 'a1',
          decision: { summary: 's', rationale: 'r', expectations: fileExistence('src/real.ts') },
        },
      },
    ],
  });
  assert.ok(
    !r.rejected && nodeIdsOf(F).includes('node_a1'),
    `a1 必须**放行并真的写进 DSL**（磁盘上真实存在的文件就是可追溯的证据；索引里没有 ≠ 不存在）：rejected=${r.rejected} nodes=${JSON.stringify(nodeIdsOf(F))} text=${r.text.split('\n')[0]}`,
  );
});

test('a2 node.add 声明 file-exists（本批要**新建**、磁盘上还没有的文件）⇒ evidence 指向它必须放行', async () => {
  const F = 'p0l4a2';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/born.ts'),
    evidence: [{ type: 'node', ref: 'src/born.ts' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'file_src_born_ts',
        data: {
          type: 'file',
          label: 'born.ts',
          path: 'src/born.ts',
          decision: { summary: 's', rationale: 'r', expectations: fileExistence('src/born.ts') },
        },
      },
    ],
  });
  assert.ok(
    !r.rejected && nodeIdsOf(F).includes('file_src_born_ts'),
    `a2 必须放行（「它应该存在」就是本批写下的依据，不是豁免）：rejected=${r.rejected} nodes=${JSON.stringify(nodeIdsOf(F))} text=${r.text.split('\n')[0]}`,
  );
});

test('a3 node.add + evidence 指向**本批新建的那个 node id** ⇒ 必须放行', async () => {
  const F = 'p0l4a3';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/real.ts'),
    evidence: [{ type: 'node', ref: 'node_a3' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'node_a3',
        data: {
          type: 'step',
          label: 'a3',
          decision: { summary: 's', rationale: 'r', expectations: fileExistence('src/real.ts') },
        },
      },
    ],
  });
  assert.ok(
    !r.rejected && nodeIdsOf(F).includes('node_a3'),
    `a3 必须放行（引用本批产物 = 引用一个**本批正在创建**的实体）：rejected=${r.rejected} nodes=${JSON.stringify(nodeIdsOf(F))} text=${r.text.split('\n')[0]}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// b：该红的仍红（★ 这三条是"为了修 a 把 L4 改成啥都过"的消融）
// ════════════════════════════════════════════════════════════════════
test('b1 evidence 指向【谁也没声明、磁盘也没有】的路径 ⇒ 仍必须拒', async () => {
  const F = 'p0l4b1';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/absent.ts'),
    evidence: [{ type: 'node', ref: 'src/absent.ts' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'node_b1',
        data: {
          type: 'step',
          label: 'b1',
          decision: { summary: 's', rationale: 'r', expectations: fileExistence('src/real.ts') },
        },
      },
    ],
  });
  assert.ok(
    r.rejected && /evidence 无法回溯/.test(r.text),
    `b1 必须**仍拒**「evidence 无法回溯」（不声明的路径不许过 L4）：rejected=${r.rejected} text=${r.text.split('\n')[0]}`,
  );
  assert.ok(!nodeIdsOf(F).includes('node_b1'), 'b1 拒了就不许有半落盘（node_b1 不该出现在 DSL 里）');
});

test('b1b node.add 只在 data.path 写个路径、**没带 file-exists 期望** ⇒ evidence 指向它仍必须拒', async () => {
  const F = 'p0l4b1b';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/undeclared.ts'),
    evidence: [{ type: 'node', ref: 'src/undeclared.ts' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'file_src_undeclared_ts',
        data: { type: 'file', label: 'undeclared.ts', path: 'src/undeclared.ts', decision: { summary: 's', rationale: 'r' } },
      },
    ],
  });
  assert.ok(
    r.rejected && /evidence 无法回溯/.test(r.text),
    `b1b 必须**仍拒**：光在 data.path 里写个路径**不构成依据**（否则"编个路径"就能过 L4）：rejected=${r.rejected} text=${r.text.split('\n')[0]}`,
  );
});

test('b2 evidence 指向**本批之外**、册里也没有的 node id ⇒ 仍必须拒', async () => {
  const F = 'p0l4b2';
  seed(F, [{ id: 'n_existing', type: 'step', label: 'x' }]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/real.ts'),
    evidence: [{ type: 'node', ref: 'node_ghost' }],
    operations: [
      {
        type: 'node',
        op: 'add',
        id: 'node_b2',
        data: { type: 'step', label: 'b2', decision: { summary: 's', rationale: 'r', expectations: fileExistence('src/real.ts') } },
      },
    ],
  });
  assert.ok(
    r.rejected && /evidence 无法回溯/.test(r.text),
    `b2 必须**仍拒**（本批没建、册里没有的 node id 不是可追溯证据）：rejected=${r.rejected} text=${r.text.split('\n')[0]}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// c：既有节点走同一条闸，行为不变
// ════════════════════════════════════════════════════════════════════
test('c1 既有节点 update + evidence = 已有 node id ⇒ 放行（与改前同结论）', async () => {
  const F = 'p0l4c1';
  seed(F, [
    { id: 'n_existing', type: 'step', label: 'x' },
    { id: 'n_cited', type: 'step', label: 'cited' },
  ]);
  const r = await call({
    feature: F,
    reason: reasonFor('src/real.ts'),
    evidence: [{ type: 'node', ref: 'n_cited' }],
    operations: [{ type: 'node', op: 'update', id: 'n_existing', data: { label: 'renamed' } }],
  });
  const label = ((getDSL(F) as AnyRec)?.geometry?.nodes ?? []).find((n: AnyRec) => n.id === 'n_existing')?.label;
  assert.ok(
    !r.rejected && label === 'renamed',
    `c1 必须放行且真的改到（既有节点那条路一字未动）：rejected=${r.rejected} label=${String(label)} text=${r.text.split('\n')[0]}`,
  );
});

test('c2 既有节点 update + evidence = 【索引里查得到】的文件 ⇒ 放行（现取事实那一支没被打断）', async () => {
  const ROOT2 = path.join(TMP, 'root2');
  fs.mkdirSync(path.join(ROOT2, 'src'), { recursive: true });
  fs.writeFileSync(path.join(ROOT2, 'src/x.ts'), 'export const x = 1;\n', 'utf-8');
  const F2 = 'p0l4c2';
  await importProject({ project_dir: ROOT2, feature: F2, source_root: ROOT2 } as never);
  const fileNode = ((getDSL(F2) as AnyRec)?.geometry?.nodes ?? []).find((n: AnyRec) => n.type === 'file');
  assert.ok(fileNode, `c2 夹具异常：import_project 之后必须有文件节点（实得 ${JSON.stringify(nodeIdsOf(F2))}）`);

  const r = await call({
    feature: F2,
    reason: reasonFor('src/x.ts'),
    evidence: [{ type: 'node', ref: 'src/x.ts' }],
    operations: [{ type: 'node', op: 'update', id: String(fileNode.id), data: { label: 'x.ts（改后）' } }],
  });
  assert.ok(
    !r.rejected,
    `c2 必须放行（cache.db 里查得到的文件一直是可追溯证据 —— 新加的那一支不许把这一支挤掉）：rejected=${r.rejected} text=${r.text.split('\n')[0]}`,
  );
});
