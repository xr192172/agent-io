/**
 * T184b 探针：**显式重建之后，②（`consistency_check`）还看得见那个"墓碑"吗？**
 *
 * ## 两态实测（★ `guard-blindspot-diagnosis` 要求：先证明它真的看不见，别只读码）
 * · **态 A** 文件在 base 里、标着 `deprecated` ⇒ ② 应当报 `awaiting_delete` / `ready_to_archive`（已工作）
 * · **态 B** **显式重建**（文件从 base 消失，而 overlay 锚点留着标记）⇒ ★ ② 报**什么**
 *
 * ## 重建怎么模拟才**忠实**（★ 不是"顺手造个状态"）
 * `import_project.ts:1069` 逐字是：`const { dsl: designDsl } = mergeDesignLayer(layered);` 然后 `saveDSL(designDsl);`
 * ⇒ 本探针**调同一行**（`mergeDesignLayer`）+ 同样 `saveDSL`，喂进去的 `layered` = **扫描产物**：
 *   "当前 base **去掉那个文件**"（扫描产不出 `lifecycle`，也不会保留一个代码里没有的文件）。
 */
import fs from 'node:fs';
import { getDSL, saveDSL } from '../dist/src/infrastructure/storage.js';
import { mergeDesignLayer, loadOverlay, syncLifecycleToOverlay } from '../dist/src/infrastructure/storage_overlay.js';
import { checkConsistencyReport } from '../dist/src/application/design/intent/consistency.js';

const FEATURE = 'run82';
const TARGET = 'dogfood/build_cache.mjs';
const TARGET_ID = 'file_dogfood_build_cache_mjs';

const dsl = getDSL(FEATURE);
const file = dsl.semantic.files.find((f) => f.path === TARGET);

console.log('════ ⓪ 前提：把 TARGET 标成 deprecated（写进 base，再同步进 overlay）');
file.lifecycle = { status: 'deprecated', retire_reason: 'T184b 探针：验证重建后的可见性' };
saveDSL(dsl);
syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
console.log('  base 里有 lifecycle :', JSON.stringify(getDSL(FEATURE).semantic.files.find((f) => f.path === TARGET)?.lifecycle));
console.log('  overlay 里有 lifecycle:', JSON.stringify(loadOverlay(FEATURE)?.anchors?.[TARGET_ID]?.lifecycle));

console.log('\n════ ① 态 A（未重建）：② 看得见吗');
const a = await checkConsistencyReport({ feature: FEATURE });
console.log('  retireFlow =', JSON.stringify(a.retireFlow));

console.log('\n════ ② 态 B：**显式重建**（喂"扫描产物"= base 去掉那个文件；调的就是 :1069 那一行）');
const scanned = JSON.parse(JSON.stringify(getDSL(FEATURE)));
scanned.semantic.files = scanned.semantic.files.filter((f) => f.id !== TARGET_ID);
const merged = mergeDesignLayer(scanned);
saveDSL(merged.dsl); // ★ 与 import_project 同款：重建后落盘
console.log('  重建后 base 里有这个文件吗 :', !!getDSL(FEATURE).semantic.files.find((f) => f.id === TARGET_ID));
console.log('  重建后 overlay 锚点还在吗  :', !!loadOverlay(FEATURE)?.anchors?.[TARGET_ID]);
console.log('  它的 lifecycle             :', JSON.stringify(loadOverlay(FEATURE)?.anchors?.[TARGET_ID]?.lifecycle));

console.log('\n════ ③ ★★ 关键读数：态 B 下 ② 报什么（★ 这就是本条的判据）');
const b = await checkConsistencyReport({ feature: FEATURE });
console.log('  retireFlow =', JSON.stringify(b.retireFlow));
console.log(
  '  ⇒',
  (b.retireFlow ?? []).length === 0
    ? '★ **看不见**（retireFlow 空）—— 而 overlay 里那个墓碑**明明还在** ⇒ 静默漏报'
    : '★ 看得见（本条已修好）',
);
console.log('  ② 扫的 `semantic.files` 条数 =', b.summary.total_files);

// ★ 还原：把态压回（下游还要跑别的证）
file.lifecycle = { status: 'deprecated', retire_reason: 'T184b 探针：验证重建后的可见性' };
const back = getDSL(FEATURE);
back.semantic.files.push(file);
saveDSL(back);
console.log('\n（已把那个文件放回 base；完整还原由 certs/t185-reset.mjs 做）');
