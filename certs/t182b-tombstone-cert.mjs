/**
 * T182b（后半）出生证：**"文件已不在 base"的待删标记必须留作墓碑，不许当僵尸清掉**。
 *
 * ## 判据（先问"凭什么变红"）
 *   · 文件**不在** base + overlay 里有标记 ⇒ ★ **必须保留**（它是三步流②的"可归档"信号）
 *   · 文件**在** base + 它的 `lifecycle` 没了  ⇒ **必须清掉**（防僵尸 —— 这条是原纪律，不许丢）
 * ★ 反例：把"文件不在 base"的情形也清了 ⇒ 步骤②刚说出的"可归档"，被下一次 `edit_dsl` 抹掉
 *   ⇒ **用户永远看不到那句话、步骤③永远不会被触发**。
 *
 * ## 为什么这件事值得单独立证（不是钻牛角尖）
 * 这是本仓最贵的一课的**镜像**：我一路上都在追求"清干净 / 不留僵尸"，
 * 而**这一次"清干净"恰好毁掉流程自己的信号** —— ★ 纪律要看**往哪边错**，不能只背结论。
 */
import fs from 'node:fs';
import { getDSL } from '../dist/src/infrastructure/storage.js';
import { loadOverlay, syncLifecycleToOverlay } from '../dist/src/infrastructure/storage_overlay.js';

const FEATURE = 'run82';
const LIVE = 'agent-io.json';
const FEATFILE = `.agent-io/features/${FEATURE}.json`;
const OVERLAY = `.agent-io/features/${FEATURE}.overlay.json`;
const FILE_ID = 'file_dogfood_build_cache_mjs';
const FILE_PATH = 'dogfood/build_cache.mjs';
const SNAP = [LIVE, FEATFILE, OVERLAY].map((p) => [p, fs.readFileSync(p, 'utf8')]);
const restore = () => { for (const [p, s] of SNAP) fs.writeFileSync(p, s, 'utf8'); };

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 直接摆布三层，造出要测的状态 */
const writeBase = (mutate) => {
  for (const p of [LIVE, FEATFILE]) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    mutate(d);
    fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
  }
};
const overlayLc = () => loadOverlay(FEATURE)?.anchors?.[FILE_ID]?.lifecycle;

restore();

console.log('════ 准备：把标记写进 base + overlay（模拟"已标过 ①"）');
writeBase((d) => {
  const f = d.semantic.files.find((x) => x.path === FILE_PATH);
  f.lifecycle = { status: 'deprecated', retire_reason: 'T182b 墓碑出生证' };
});
syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
chk(overlayLc()?.status === 'deprecated', 'overlay 先拿到了标记', JSON.stringify(overlayLc()));

console.log('\n════ ① ★ 文件【不在】base（模拟一次 rebuild 后文件从 DSL 里没了）⇒ 必须留墓碑');
writeBase((d) => {
  d.semantic.files = d.semantic.files.filter((x) => x.path !== FILE_PATH);
});
syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
const kept = overlayLc();
chk(kept?.status === 'deprecated', '★ 墓碑**仍在**（没被当僵尸清掉）', JSON.stringify(kept));
chk(kept?.retire_reason === 'T182b 墓碑出生证', '★ 理由也仍在（墓碑要能考古）');

console.log('\n════ ② 反例：文件【在】base、但 lifecycle 没了 ⇒ 必须清掉（原纪律不许丢）');
restore();
writeBase((d) => {
  const f = d.semantic.files.find((x) => x.path === FILE_PATH);
  f.lifecycle = { status: 'deprecated', retire_reason: '待清的僵尸' };
});
syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
const r = syncLifecycleToOverlay(FEATURE, getDSL(FEATURE)); // 此时 base=overlay，无变化
writeBase((d) => {
  const f = d.semantic.files.find((x) => x.path === FILE_PATH);
  delete f.lifecycle; // ★ 文件还在、标记没了（带外改过 JSON 的样子）
});
const r2 = syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
chk(overlayLc() === undefined, '★ 僵尸被清掉了（原纪律生效）', JSON.stringify(overlayLc() ?? null));
chk(r2.cleared === 1, '且**报出了**清除数（不静默）', `cleared=${r2.cleared}`);

console.log('\n════ ③ 墓碑会被【报出来】（不是悄悄保留）');
// ★ 第一版这条【假红】了：我直接造了"base 里没这个文件"的状态，**却从没把标记写进 overlay**
//   ⇒ overlay 本来就是空的 ⇒ 没东西可留，断言自然不成立 —— ★ 又是"起点没摆对"。
//   ⇒ 必须走完 ① 的那两步（先同步进 overlay，再让文件从 base 消失）。
restore();
writeBase((d) => {
  d.semantic.files.find((x) => x.path === FILE_PATH).lifecycle = { status: 'deprecated', retire_reason: '墓碑' };
});
syncLifecycleToOverlay(FEATURE, getDSL(FEATURE)); // ① 先让 overlay 拿到
chk(overlayLc()?.status === 'deprecated', '（前置）overlay 里已有标记', JSON.stringify(overlayLc()?.status));
writeBase((d) => {
  d.semantic.files = d.semantic.files.filter((x) => x.path !== FILE_PATH); // ② 再让文件从 base 消失
});
const r3 = syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
chk(overlayLc()?.status === 'deprecated', '文件不在 base ⇒ overlay 里留着', JSON.stringify(overlayLc()?.status));
const notesTxt = (r3.notes ?? []).join(' | ');
chk(/墓碑/.test(notesTxt), '★ 并把"保留为墓碑"**写进 notes**（不是悄悄保留）', notesTxt.slice(0, 200));

restore();
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('（已还原三层）');
