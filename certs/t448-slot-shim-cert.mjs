#!/usr/bin/env node
/**
 * ★★★ cert T448 —— **槽垫片 `mut.value` 真的顶住了"值语义"吗**（2026-10-29 · `T-#SLOT-SHIM`）
 *
 * ## 判什么
 * `t445` 测出唯一 **100% 覆盖**的语义偏离：Go struct 按值复制 vs TS 对象是引用别名。
 * 用户提出的解法是「写一个目标语言的原生组件去顶那个生态位」。本证判这个**顶替物本身**成立：
 * `copy()` 之后，改副本**不得**影响原件。
 *
 * ## 判据
 *   ① **值语义成立**：`const b = copy(a); b.x = 2` ⇒ `a.x` 不变（含嵌套结构）；
 *   ② **反向控制**：不复制直接别名，改副本**必须**影响原件 —— 证判据能区分两种语义，
 *      不是"两条都通过"的空判据；
 *   ③ **账目诚实**：`ts` 能力里 `mut.value` shim 虽 `certified: true`，但 `applied: false`
 *      ⇒ `lossOfSlot(mut)` 必须**仍然**返回 `mut-value-copy`。
 *      （这条防的是我今天反复打的假绿：**shim 存在 ≠ 语义已被顶掉**。）
 *
 * ## 边界（写清楚，别当它是万能的）
 *   · `structuredClone` 不支持函数/类原型/DOM；含这些的对象运行时会抛错（不静默错）；
 *   · Go 的 struct 赋值是**逐字段浅拷贝**，这里是**深拷贝** ⇒ 比 Go 更安全，
 *     但在"本该共享子对象"的代码里会改变行为。`[未核]` 要按 `TypeRef` 区分值字段/指针字段；
 *   · 本证不证明"渲染器已在正确位置插入"（那是 ③ 的 `applied` 与后续渲染器证的事）。
 *
 * ## 用法
 *   npm run build && node certs/t448-slot-shim-cert.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { renderSlotShim } = await import(D + 'infrastructure/authoring/translate/slots.js');
const { CAPABILITIES, lossOfSlot } = await import(D + 'infrastructure/authoring/translate/pivot.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// 把 shim 源码落到临时文件再 import（**验的是生成出来的东西**，不是源码字符串）
const src = renderSlotShim('mut.value');
if (!src) {
  console.log('✗ 没有 mut.value 的 shim 实现');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-'));
const file = path.join(dir, 'value.mjs');
// 去掉 TS 类型标注后作为 ESM 运行（保持实现体一致）
fs.writeFileSync(
  file,
  src.replace(/export function copy<T>\(v: T\): T \{/, 'export function copy(v) {').replace(/export function share<T>\(v: T\): T \{/, 'export function share(v) {'),
  'utf8',
);
const mod = await import('file:///' + file.replace(/\\/g, '/'));

// ① 值语义
{
  const a = { x: 1, nested: { y: [1, 2, 3] } };
  const b = mod.copy(a);
  b.x = 2;
  b.nested.y.push(4);
  chk(a.x === 1 && a.nested.y.length === 3, '① **值语义成立**：改副本（含嵌套）不影响原件', `a.x=${a.x} · a.nested.y=[${a.nested.y}]`);
}

// ② 反向控制
{
  const a = { x: 1 };
  const b = mod.share(a);
  b.x = 2;
  chk(a.x === 2, '② **反向控制**：不复制（share）时改副本**必须**影响原件（判据能区分两种语义）', `a.x=${a.x}`);
}

// ③ 账目诚实：certified 但未 applied ⇒ 仍然是 mut-value-copy
{
  const ts = CAPABILITIES['ts'];
  const entry = lossOfSlot({ axis: 'mut', form: '*' }, ts);
  const shim = ts.shims?.['mut.value'];
  chk(
    entry.loss === 'mut-value-copy',
    '③ **账目诚实**：shim 已认证但渲染器未插入（applied=false）⇒ 失真**不得**变绿',
    `shim: certified=${shim?.certified} applied=${shim?.applied} ⇒ loss=${entry.loss}\n     why: ${entry.why}`,
  );
}

// ④ 反向控制（机制层）：把 applied 改成 true，账必须变成 exact
{
  const ts = CAPABILITIES['ts'];
  const shim = ts.shims['mut.value'];
  shim.applied = true;
  const entry = lossOfSlot({ axis: 'mut', form: '*' }, ts);
  shim.applied = false; // 还原
  chk(entry.loss === 'exact', '④ **反向控制（机制层）**：applied=true 时账才变 `exact`（证明判据读的是状态，不是写死）', `loss=${entry.loss}`);
}

console.log(`\n═══ T448 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
