/**
 * T182 出生证：**「待删标记」活得过重建**吗？
 *
 * ## 判据（照 T100 逐字立的，不是新规矩）
 * *"★★ **`import_project` 重建后标记仍在**"*
 *
 * ## 被测的那一行
 * `import_project.ts:1069` 逐字：`const { dsl: designDsl, message: ovMsg } = mergeDesignLayer(layered);`
 *   ⇒ ★ **重建的收口就是 `mergeDesignLayer`**。本脚本就打在**这个边界**上。
 *
 * ## 为什么用一个"模拟的扫描产物"而不是真跑 `import_project`
 * 真跑要重扫 400 个文件 + 可能要 LLM 生成职责标题 ⇒ **慢且会改写整个 base**。
 * 而"重建"对 base 做的事**已由 `:1066` 逐字说清**：*"真相刷新只替换 base"* ——
 * 扫描**产不出** `lifecycle`（它是人写的意图）⇒ ★ **"新的 base = 旧 base 去掉 lifecycle"** 就是
 * 一次重建对 `lifecycle` 的**全部影响**。⇒ 这是一个**faithful 的替身**，且没有任何副作用。
 * ★ 诚实标注：本脚本**没有**跑真的 `import_project` —— 它验的是**重建所依赖的那个函数**。
 *
 * ## 反例（★ 先问"凭什么变红"）
 * 只有"重建后还在"不算证据 —— 我可能把标记硬编码进了结果。
 * ⇒ 必须同时证明**它能区分**：把 overlay 里的标记也拿掉 ⇒ **重建后必须【不在】**。
 */
import fs from 'node:fs';
import { getDSL } from '../dist/src/infrastructure/storage.js';
import { loadOverlay } from '../dist/src/infrastructure/storage_overlay.js';
import { mergeDesignLayer } from '../dist/src/infrastructure/storage_overlay.js';

const FEATURE = 'run82';
const FILE_ID = 'file_dogfood_build_cache_mjs';
const OVERLAY = `.agent-io/features/${FEATURE}.overlay.json`;

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

const lcOf = (dsl) => (dsl.semantic?.files ?? []).find((f) => f.id === FILE_ID)?.lifecycle;
const overlayLc = () => loadOverlay(FEATURE)?.anchors?.[FILE_ID]?.lifecycle;

console.log('════ ① 写前：两层都该是干净的（确认起点已知）');
check(lcOf(getDSL(FEATURE)) === undefined, 'base 无 lifecycle', JSON.stringify(lcOf(getDSL(FEATURE))));
check(overlayLc() === undefined, 'overlay 无 lifecycle', JSON.stringify(overlayLc()));

console.log('\n════ ② 写一笔「待删标记」（走真实入口：edit_dsl type=file op=update）');
const { execFileSync } = await import('node:child_process');
const R = 'T182 出生证：对 dogfood/build_cache.mjs 标记待删';
const args = JSON.stringify({
  feature: FEATURE,
  reason: R,
  weight: 'routine',
  evidence: [{ type: 'diff', ref: 'dogfood/build_cache.mjs' }],
  operations: [{
    type: 'file', op: 'update', id: FILE_ID,
    data: { lifecycle: { status: 'deprecated', retire_reason: 'T182 出生证：验证标记活过重建' } },
  }],
});
const out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'edit_dsl', args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
check(!out.includes('isError=true'), 'edit_dsl 写入成功', out.replace(/\n/g, ' ').slice(0, 120));

console.log('\n════ ③ ★ T182 的第一半：标记有没有落进 overlay（改之前：没有）');
const ovLc = overlayLc();
check(ovLc?.status === 'deprecated', `overlay 拿到 lifecycle`, JSON.stringify(ovLc));
check(ovLc?.retire_reason === 'T182 出生证：验证标记活过重建', 'overlay 也留住了 retire_reason（不是空壳状态）');

/** ★ 一次重建交给 `mergeDesignLayer` 的"扫描产物" = 现在的 base **去掉 lifecycle**
 *  （扫描产不出人写的意图 —— 这就是 `:1066` "真相刷新只替换 base" 对 lifecycle 的全部影响）。 */
const scannerOutput = () => {
  const d = JSON.parse(JSON.stringify(getDSL(FEATURE)));
  d.semantic.files = d.semantic.files.map((f) => { const { lifecycle, ...rest } = f; return rest; });
  return d;
};

console.log('\n════ ④ ★ T182 的第二半：**重建之后标记还在吗**（这是判据本体）');
const kept = lcOf(mergeDesignLayer(scannerOutput()).dsl);
check(kept?.status === 'deprecated', '★ 重建后 base 里**标记仍在**', JSON.stringify(kept));
check(kept?.retire_reason === 'T182 出生证：验证标记活过重建', '★ 重建后 `retire_reason` 也仍在（反例：别只留个 status 壳）', JSON.stringify(kept?.retire_reason));

console.log('\n════ ⑤ ★ 反例：把标记从 overlay 里拿掉 ⇒ 重建后【必须不在】');
//   ★★ 第一版这条【假红】了 —— 我传的是**当前 base**（还带着步骤②写进去的 lifecycle）
//     ⇒ 标记是从【base 自己】活下来的，**根本没经过 overlay** ⇒ 那个"反例"什么也没证明。
//     ⇒ 必须传**同一个 `scannerOutput()`**（去掉 lifecycle 的 base），才真的是"重建"。
const ovRaw = JSON.parse(fs.readFileSync(OVERLAY, 'utf8'));
const saved = JSON.stringify(ovRaw, null, 2);
delete ovRaw.anchors[FILE_ID].lifecycle;
if (Object.keys(ovRaw.anchors[FILE_ID]).filter((k) => !['path', 'kind'].includes(k)).length === 0) {
  delete ovRaw.anchors[FILE_ID]; // 只剩空壳 ⇒ 一起去掉（与 prune 纪律一致）
}
fs.writeFileSync(OVERLAY, JSON.stringify(ovRaw, null, 2), 'utf8');
const after = mergeDesignLayer(scannerOutput()).dsl;
check(lcOf(after) === undefined, '★ overlay 里没有 ⇒ 重建后**确实没有**（判据能区分，不是恒真）', JSON.stringify(lcOf(after)));
fs.writeFileSync(OVERLAY, saved, 'utf8'); // 还原

console.log(`\n════ 汇总：PASS=${pass}  FAIL=${fail}`);
