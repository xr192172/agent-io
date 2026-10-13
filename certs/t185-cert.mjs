/**
 * T185 出生证：**移除文件节点**的判据收成一处。
 *
 * ① `deleteFile` 不再"静默半删"（改之前：只删语义侧 ⇒ 幽灵几何节点，没有任何东西报）
 * ② `deleteFile` / `archive` 共用一个"三清"判据 `removeFileFromDsl`（domain）
 * ③ `archive` 作为**终态**要收口意图层（清掉待删标记 + 同步合并溯源）
 * ④ ★★ 顺带修掉一条**我在 T181 引入的回归**（`archive --merged_into` 被打回，见 §⑤）
 *
 * ## 反例
 *  · 删 A 之后 **B 的语义/几何都必须在**（证明是定向删、不是清空）
 *  · ★ archive 之后 overlay 里那笔标记**必须真的没了**
 *
 * ## ★ 为什么写成 node 而不是 bash（血泪）
 * 前几版用 bash + `grep`/`JSON.parse('$1')` 的组合，**反复被 shell 吃掉反斜杠**
 * （`"\"null\""` 被 bash 在双引号里还原成 `""null""` ⇒ 非法 JSON ⇒ 一片假红）。
 * ⇒ **量具自己别引入变量**：断言与取数全在 node 里做，只把 mcp_call 当黑盒调。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getDSL } from '../dist/src/infrastructure/storage.js';
import { loadOverlay } from '../dist/src/infrastructure/storage_overlay.js';

const FEATURE = 'run82';
const A = 'file_dogfood_build_cache_mjs';
const B = 'file_dogfood_check_cache_mjs';
const PA = 'dogfood/build_cache.mjs';
const PB = 'dogfood/check_cache.mjs';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const call = (tool, args) =>
  execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
const edit = (ops, reason) =>
  call('edit_dsl', { feature: FEATURE, reason, weight: 'routine', evidence: [{ type: 'diff', ref: PA }], operations: ops });
const mark = (path, reason) =>
  edit([{ type: 'file', op: 'update', id: A, data: { lifecycle: { status: 'deprecated', retire_reason: reason } } }], reason);

const reset = () => execFileSync('node', ['certs/t185-reset.mjs'], { encoding: 'utf8' });
const st = () => {
  const d = getDSL(FEATURE);
  const ov = loadOverlay(FEATURE);
  return {
    semA: !!d.semantic.files.find((f) => f.id === A),
    nodeA: !!d.geometry.nodes.find((n) => n.id === A),
    semB: !!d.semantic.files.find((f) => f.id === B),
    nodeB: !!d.geometry.nodes.find((n) => n.id === B),
    ovA: ov?.anchors?.[A]?.lifecycle ?? null,
    ovB: ov?.anchors?.[B]?.lifecycle ?? null,
    files: d.semantic.files.length, nodes: d.geometry.nodes.length, edges: d.geometry.edges.length,
  };
};

console.log('════ ⓪ 起点：A 在语义层 + 几何层都有（★ 有节点 ⇒ 幽灵才可观测）');
reset();
let s = st();
chk(s.semA && s.nodeA, 'A 两层都在');
chk(s.semB && s.nodeB, '旁观者 B 两层都在');
console.log(`     （起点：files=${s.files} nodes=${s.nodes} edges=${s.edges}）`);

console.log('\n════ ① deleteFile：必须【三清】+ 首行自足');
mark(PA, 'T185 出生证①：先标待删');
s = st();
chk(s.ovA?.status === 'deprecated', '（前置）overlay 里已有待删标记', JSON.stringify(s.ovA));
const dOut = edit([{ type: 'file', op: 'delete', id: A }], `T185 出生证：删除 ${PA}`);
s = st();
chk(!s.semA, '语义层已无 A');
chk(!s.nodeA, '★ 几何节点也已无 A（这就是 T180 的幽灵）');
chk(s.ovA === null, '★ 意图层那笔标记也被清掉（摘文件的人负责收口）');
// ★ `edit_dsl` 的汇总只取**首行**（`update_feature.ts:148-151`）⇒ 判据落在首行
const first = dOut.split('\n').find((l) => l.includes('[1/1]')) ?? '';
chk(first.includes('三清: 语义文件 1 + 几何节点 1 + 边 1'), '★ 首行说清三清', first.trim());
chk(first.includes('不留历史'), '★ 首行标明"不留历史"（不让调用方以为等于归档）');
chk(first.includes('意图层标记已清'), '★ 首行报出意图层已收口');

console.log('\n════ ② 反例：定向删 —— 旁观者 B 一个都不能少');
chk(s.semB, 'B 仍在语义层');
chk(s.nodeB, 'B 仍在几何层');
chk(s.nodes === 595 && s.edges === 921, '★ 只少了 1 个节点 / 1 条边（不是清空）', `nodes=${s.nodes} edges=${s.edges}`);

console.log('\n════ ③ archive 是【终态】⇒ 意图层必须收口');
reset();
mark(PA, 'T185 出生证③');
chk(st().ovA?.status === 'deprecated', '（前置）overlay 里有待删标记');
const aOut = call('archive', { action: 'node', feature: FEATURE, file_path: PA, retire_reason: 'T185：走三步流的③' });
s = st();
chk(!s.semA && !s.nodeA, '三清：语义 + 几何都没了');
chk(s.ovA === null, '★★ overlay 里的待删标记**已被清掉**（终态不留僵尸）');
chk(aOut.split('\n')[0].includes('三清: 语义文件 1 + 几何节点 1 + 边 1'), '★ 首行报出三清', aOut.split('\n')[0]);
chk(aOut.split('\n')[0].includes('意图层待删标记已清'), '★ 首行报出意图层收口');
chk(aOut.includes('清掉该文件的待删标记 ✓'), '★ 明细行给出意图层结论（archive 是独立工具，全文可见）');

console.log('\n════ ④ 合并场景：目标文件的 merged_from 必须同步进 overlay');
reset();
const mOut = call('archive', { action: 'node', feature: FEATURE, file_path: PA, retire_reason: 'T185：A 并进 B', merged_into: PB });
s = st();
chk(s.ovB?.status === 'merged', '★ overlay 里 B 拿到了 lifecycle', JSON.stringify(s.ovB));
chk((s.ovB?.merged_from ?? []).includes(PA), '★ 且带上了 merged_from 溯源（含 A）');
chk(mOut.includes('合并溯源同步进 overlay ✓'), '★ 回执报出合并溯源已同步');

console.log('\n════ ⑤ ★★ 回归修复：`merged` 的判据（我在 T181 写错过，这里立证）');
// 病根：`archive` 的合并分支给**目标**文件写 `status:'merged'` + `merged_from`，
//       而 `merged_into` 显式为 undefined（那是"清掉可能继承来的值"）——
//       我 T181 的校验器要求"merged 必须有 merged_into" ⇒ ★ **把这条通路直接打回**。
//       ★ T181 的出生证只测了 `edit_dsl` 那一侧 ⇒ 没覆盖到这个分支 ⇒ 没红。
// 判据：`merged` 要**至少一头**（merged_into 或 merged_from）。
const { assertLifecycle } = await import('../dist/src/domain/semantic.js');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
chk(!throws(() => assertLifecycle({ status: 'merged', merged_from: [PA] }, { allowArchived: true })),
  '★ 只有 merged_from（**目标**那头的真实形状）⇒ 放行（改之前：被拒 = 回归）');
chk(!throws(() => assertLifecycle({ status: 'merged', merged_into: PB }, { allowArchived: true })),
  '  只有 merged_into（源那头）⇒ 放行');
chk(throws(() => assertLifecycle({ status: 'merged' }, { allowArchived: true })),
  '★ 反例：两头都没有 ⇒ **必须拒**（判据没被放宽成"永远放行"）');

reset();
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('（已整份还原：活态 · 存档 · overlay · 归档库）');
