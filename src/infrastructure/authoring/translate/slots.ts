/**
 * ★★★ 2026-10-29（T-#SLOT-SHIM）：**槽的垫片实现**（"拿原生组件去顶"的产物）。
 *
 * ## 定位
 * 有些语义槽目标语言**原生没有**，但可以写一个**该语言自己的原生实现**去顶。
 * 这些模块是**按槽**组织的（不是按语言对）⇒ 任何源语言用到同一个槽，都顶同一个模块。
 *
 * ## 纪律
 * · 每个 shim 必须有一张**一致性证**（含反向控制），证号登记在 `CAPABILITIES[lang].shims`；
 * · 生成到产物 `<outDir>/_slots/<name>.ts`，与 `_go_std/`（按 Go 包组织的适配）区分开：
 *   `_go_std` 是"Go 生态位的替代品"，`_slots` 是"**语义槽**的替代品"——后者才是跨源语言复用的。
 */

/** 已实现的槽 → 生成源码。新增槽在这里加一支即可。 */
export function renderSlotShim(slot: string): string | null {
  switch (slot) {
    case 'mut.value':
      return `/**
 * _slots/value.ts —— \`mut.value\` 槽的 TS 原生实现（证 t448 背书）。
 *
 * ## 为什么需要它
 * Go 的 struct **按值**传递（赋值/传参/返回都是复制）；TS 对象是**引用别名**。
 * 这是 \`t445\` 测出的**唯一 100% 覆盖**的语义偏离（每个翻译单元都带一条）。
 * 用 \`copy()\` 在"Go 会复制"的位置显式复制，就能把这个偏离顶掉。
 *
 * ## 边界（如实）
 * · \`structuredClone\` 不支持函数/DOM/类原型 ⇒ 含这些的对象会在运行时抛错（**不静默错**）；
 * · Go 的浅拷贝 vs 深拷贝：Go struct 赋值是**逐字段浅拷贝**（字段里的指针仍共享）。
 *   这里是**深拷贝** ⇒ 比 Go 更安全，但在"本该共享子对象"的代码里会改变行为。
 *   \`[未核]\` 需要按 pivot 的 TypeRef 区分"值字段/指针字段"，只对值字段深拷贝。
 */
export function copy<T>(v: T): T {
  return structuredClone(v);
}

/** 显式共享（反向对照用）：返回同一个引用，**不做复制** */
export function share<T>(v: T): T {
  return v;
}
`;
    default:
      return null;
  }
}

/** 该槽对应的产物文件名（不含扩展名） */
export function slotShimModule(slot: string): string | null {
  return slot === 'mut.value' ? '_slots/value' : null;
}
