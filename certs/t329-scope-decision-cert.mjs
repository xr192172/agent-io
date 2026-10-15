#!/usr/bin/env node
/**
 * ★★★ cert T329 —— **范围型决策（决策卡加 `scope` 引用）的出生证**（2026-10-15）。
 *
 * ## 这张证要钉住什么（`docs/todo.md` T329 · `docs/replan-2026-10-15.md` §25）
 * "范围"此前**没有字段可存**：决策卡 `NodeDecision`（`domain/geometry.ts:185`）**挂在单个节点上**
 * （`Node.decision`，1:1），而一片范围可能是**泳道 / 架构层 / 子树 / 一组文件** ——
 * `swimlane:` / `arch_layer:` 甚至是**分组谓词**（`Swimlane.id` / `ArchLayer.id`，**不是** node id），
 * 压根没有节点可挂。"范围"因此只能靠"挂范围根节点"**近似**（对泳道/架构层根本不成立）。
 * ⇒ T329 给决策卡加**一个可选字符串** `NodeDecision.scope`：
 *   ★ 文法与解析的**唯一落点**是 `src/domain/scope.ts`（`parseScope` / `resolveScope`）；
 *   ★ **只存那一行字符串** —— **绝不把解析出的节点 id 列表落库**（那是可重算的派生量 = 第二份真相）。
 *
 * ## 四条判据（★ 全部只看**事实**：落盘文件 / 抛没抛 / 回读，不看回执文案吹牛）
 *   **① 登记带 `scope` 的决策 ⇒ 成功**（两条写路径各一：`decision` op 与 `node` op 的内联 `decision`）。
 *   **② 非法 `scope` ⇒ 被拒**（`swimlane:` 空 id / 未知种类）—— 且**拒了不许偷偷写**。
 *   **③ `query=decisions` 按范围过滤**：给一个 scope ⇒ 只列"管这一片"的决策（含"未标 scope 不参与"）。
 *   **④ 存储里没有节点集副本**：落盘 JSON 里该决策的 `scope` **只有一个字符串**（无 node_ids 数组等）。
 *
 * ## 用法
 *   node certs/t329-scope-decision-cert.mjs
 * ★ 夹具住 `certs/.work/tmp`（`AGENT_IO_HOME` 也指到那里 ⇒ 不碰真仓的 `.agent-io/`）。
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
/** 跑一段"应当抛"的代码，返回错误文案（没抛 ⇒ 返回空串） */
const catchMsg = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**。
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getDSL, getFeatureFile } = await import('../dist/src/infrastructure/storage.js');
const { updateFeature } = await import('../dist/src/application/design/dsl_ops/update_feature.js');
const { queryFeature } = await import('../dist/src/application/meta/explore/query_feature.js');

// ── 夹具：一棵子树（mod_root → child_a / child_b）+ 一个孤立文件节点 other_c ─────────────
const FEAT = 't329';
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
      { id: 'mod_root', type: 'doc', description: 'docs/root.md', label: 'root 文档' },
      { id: 'child_a', type: 'file', description: 'src/a.ts', label: 'a' },
      { id: 'child_b', type: 'file', description: 'src/b.ts', label: 'b' },
      { id: 'other_c', type: 'file', description: 'src/c.ts', label: 'c' },
    ],
    edges: [
      { from: 'mod_root', to: 'child_a', label: 'contains' },
      { from: 'mod_root', to: 'child_b', label: 'contains' },
    ],
  },
  semantic: {
    files: [
      { id: 'child_a', path: 'src/a.ts' },
      { id: 'child_b', path: 'src/b.ts' },
      { id: 'other_c', path: 'src/c.ts' },
    ],
  },
});
/** 便捷：取某节点当前的 decision.scope */
const scopeOf = (id) => getDSL(FEAT)?.geometry?.nodes?.find((n) => n.id === id)?.decision?.scope;

console.log('════ ① 登记带 scope 的决策 ⇒ 成功（两条写路径）════');
// ①-a：`decision` op（`update_feature.ts` 的决策写入口）
{
  const r = updateFeature({
    feature: FEAT,
    operations: [{ type: 'decision', op: 'update', id: 'mod_root', data: { summary: '模块根的决策', scope: 'subtree:mod_root' } }],
  });
  chk(scopeOf('mod_root') === 'subtree:mod_root', '①-a decision op 写入 scope=subtree:mod_root ⇒ 落盘', `落盘 scope=${JSON.stringify(scopeOf('mod_root'))} · 回执首行: ${String(r.message).split('\n')[0]}`);
}
// ①-b：`node` op 的内联 `decision`，且**规范化**（files 列表排序）—— 同一片写同一个名（scope.ts 纪律#1）
{
  updateFeature({
    feature: FEAT,
    operations: [
      { type: 'node', op: 'update', id: 'child_b', data: { decision: { summary: '文件B的决策', scope: 'files:src/b.ts,src/a.ts' } } },
    ],
  });
  chk(scopeOf('child_b') === 'files:src/a.ts,src/b.ts', '①-b node op 内联 decision 写入 scope，且**规范化**为排序后的单串', `输入 files:src/b.ts,src/a.ts ⇒ 落盘 ${JSON.stringify(scopeOf('child_b'))}`);
}
// ①-c：**不带** scope 的决策（用于 ③ 验证"未标范围不参与范围过滤"）
{
  updateFeature({
    feature: FEAT,
    operations: [{ type: 'decision', op: 'update', id: 'child_a', data: { summary: '文件A的决策（未标范围）' } }],
  });
  chk(scopeOf('child_a') === undefined, '①-c 不传 scope ⇒ 该决策无 scope 字段（可选、不强制）', `child_a.scope=${JSON.stringify(scopeOf('child_a'))}`);
}

/** 从（可能被包裹的）错误文案里挑出**说清理由**的那一行 */
const reasonLine = (msg, re) => (String(msg).split('\n').find((l) => re.test(l)) || String(msg).split('\n')[0] || '');

console.log('\n════ ② 非法 scope ⇒ 被拒（贴错误原文）════');
// ②-a：swimlane 空 id
{
  const msg = catchMsg(() =>
    updateFeature({
      feature: FEAT,
      operations: [{ type: 'decision', op: 'update', id: 'mod_root', data: { summary: '坏范围', scope: 'swimlane:' } }],
    }),
  );
  const before = scopeOf('mod_root');
  chk(msg !== '' && /缺参数/.test(msg), '②-a scope="swimlane:"（空 id）⇒ 被拒', msg === '' ? '★ 没抛（静默接受了非法 scope）' : reasonLine(msg, /缺参数/));
  chk(before === 'subtree:mod_root', '②-a2 被拒后**没有偷偷改写**已存的 scope（不静默、不自动改）', `mod_root.scope 仍=${JSON.stringify(before)}`);
}
// ②-b：未知种类（语法不存在）
{
  const msg = catchMsg(() =>
    updateFeature({
      feature: FEAT,
      operations: [{ type: 'node', op: 'update', id: 'other_c', data: { decision: { summary: '坏种类', scope: 'totally:bogus' } } }],
    }),
  );
  chk(msg !== '' && /未知 scope 种类/.test(msg), '②-b scope="totally:bogus"（未知种类）⇒ 被拒', msg === '' ? '★ 没抛' : reasonLine(msg, /未知 scope 种类/));
}

console.log('\n════ ③ query=decisions 按范围过滤（实测输出）════');
// ③-a：同片互查 —— 给决策自己的 scope（subtree:mod_root）⇒ 必命中它自己
{
  const r = queryFeature({ query: 'decisions', feature: FEAT, scope: 'subtree:mod_root' });
  const ids = (r.data ?? []).map((e) => e.node_id);
  const hit = (r.data ?? []).find((e) => e.node_id === 'mod_root');
  chk(
    ids.includes('mod_root') && hit?.scope === 'subtree:mod_root',
    '③-a query decisions scope=subtree:mod_root ⇒ 命中 mod_root（同片互查）',
    `命中 node_id=[${ids.join(', ')}]`,
  );
}
// ③-a2：**交集**口径 —— 给 subtree:child_a ⇒ 命中"管这一片"的 mod_root（其 subtree:mod_root 含 child_a）
{
  const r = queryFeature({ query: 'decisions', feature: FEAT, scope: 'subtree:child_a' });
  const ids = (r.data ?? []).map((e) => e.node_id);
  chk(
    ids.includes('mod_root'),
    '③-a2 query decisions scope=subtree:child_a ⇒ 命中 mod_root（子集也管到这片）',
    `命中 node_id=[${ids.join(', ')}] · 各 scope=${JSON.stringify((r.data ?? []).map((e) => e.scope))}`,
  );
}
// ③-b：files:src/a.ts ⇒ 命中 child_b（files 含 src/a.ts）；**未标 scope 的 child_a 不参与**
{
  const r = queryFeature({ query: 'decisions', feature: FEAT, scope: 'files:src/a.ts' });
  const ids = (r.data ?? []).map((e) => e.node_id);
  chk(
    ids.includes('child_b') && !ids.includes('child_a'),
    '③-b query decisions scope=files:src/a.ts ⇒ 命中 child_b（files:src/a.ts,src/b.ts）；**未标 scope 的 child_a 不参与**',
    `命中 node_id=[${ids.join(', ')}]`,
  );
}
// ③-c：nodes:other_c ⇒ 无决策命中（既没标范围、也没有管的）
{
  const r = queryFeature({ query: 'decisions', feature: FEAT, scope: 'nodes:other_c' });
  const ids = (r.data ?? []).map((e) => e.node_id);
  chk(ids.length === 0, '③-c query decisions scope=nodes:other_c ⇒ 0 命中（无决策管这一片）', `命中 node_id=[${ids.join(', ')}] · 回执首行: ${String(r.message).split('\n')[0]}`);
  // 贴一次**人读输出**（含范围过滤口径行）——证明过滤是"看得见"的
  const rShow = queryFeature({ query: 'decisions', feature: FEAT, scope: 'subtree:mod_root' });
  console.log('     —— 人读回执（scope=subtree:mod_root）——');
  for (const l of String(rShow.message).split('\n').slice(0, 6)) console.log(`     ${l}`);
}

console.log('\n════ ④ 存储里没有节点集副本（落盘 JSON 原文）════');
{
  const raw = fs.readFileSync(getFeatureFile(FEAT), 'utf-8');
  const parsed = JSON.parse(raw);
  const modRoot = parsed.geometry.nodes.find((n) => n.id === 'mod_root');
  const childB = parsed.geometry.nodes.find((n) => n.id === 'child_b');
  // 落盘原文里的 scope 片段（正则从**原始文本**抠出，不是回读对象）
  const mMod = raw.match(/"scope"\s*:\s*"subtree:mod_root"/);
  const mChB = raw.match(/"scope"\s*:\s*"files:src\/a\.ts,src\/b\.ts"/);
  // 决策对象里除 scope 外**不许多出**节点集副本键
  const forbidden = ['node_ids', 'nodes', 'file_ids', 'paths', 'resolved'];
  const extraKeys = [...forbidden].filter((k) => Object.prototype.hasOwnProperty.call(modRoot.decision, k));
  chk(
    mMod !== null && mChB !== null,
    '④-a 落盘 JSON 原文里 scope 就是**一个字符串**（正则从原始文本抠出）',
    `原文含：${mMod ? mMod[0] : '（未命中）'} · ${mChB ? mChB[0] : '（未命中）'}`,
  );
  chk(
    typeof modRoot.decision.scope === 'string' && modRoot.decision.scope === 'subtree:mod_root' && extraKeys.length === 0,
    '④-b 决策卡上 scope 类型=string，且**没有** node_ids/nodes/paths 等节点集副本键',
    `typeof scope=${typeof modRoot.decision.scope} · decision 全部的键=${JSON.stringify(Object.keys(modRoot.decision))} · 违禁键=${JSON.stringify(extraKeys)}`,
  );
  // 附：把孩子决策的 decision 原文打印出来（人眼可见"只有一个字符串"）
  console.log(`     child_b.decision 落盘原文 = ${JSON.stringify(childB.decision)}`);
}

// ★ 清理：1 次删除（本仓有"宿主删除闸"前科，见 t328/t316 头注释）—— 拦下 ≠ 本证判红，但**不许静默**。
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
