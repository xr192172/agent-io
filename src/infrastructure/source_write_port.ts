/**
 * source_write_port —— **源码写的端口**（infrastructure 侧只有「类型 + 唯一的兜底判定」，没有实现）
 *
 * ## 为什么需要它（2026-10-22 实测的病灶，不是推测）
 * 写闸 / 写前快照 / 自写登记的唯一落点是 `application/source_writer`，
 * 而**算内容的引擎住在 infrastructure**（5 个语言包改名器、插桩骨架、补丁应用、版本升级重写）。
 * 而 `infrastructure/` **不能 import** `application/`（倒挂 —— 本仓在 bea663df 刚拆掉唯一一处同形倒挂）。
 * ⇒ 引擎侧只拿一个**函数**：`(abs, content) => void`。本文件就是那个函数类型 + 它的唯一兜底判定。
 *
 * ## 判据（机械可查）
 * · 本文件**不 import 任何 `application/`** —— 它是端口，不是实现（实现方把 `txn.commit` 注进来）。
 * · 引擎侧对**用户源码**的落盘只许经 {@link commitSourceWrite}。
 * · 不过闸的两种**非写路**字节移动，各有专名，别混进这里：
 *     ① **回滚**（把删之前读到的原样放回）⇒ `application/source_writer#restoreSourceBytes`；
 *     ② **探针/临时目录**（`os.tmpdir()` 下的编译与试跑文件）⇒ 压根不是用户源码，不必过闸
 *        （判据见 `application/write_gate#classifyWriteSubject`）。
 */

/** 一次「把内容写回某个源码文件」的**注入点**（项目绝对路径 → 内容） */
export type SourceWriteHook = (abs: string, content: string) => void;

/**
 * ★ 引擎里**唯一**的落盘调用。没注入就**抛**（不回落裸 `fs.writeFileSync`）。
 *
 * ★ 为什么抛而不是「警告 + 自己写」：可选参数一忘传，就静默回到「谁都能改用户源码」——
 *   那正是这张卡要消掉的东西。宁可整批失败（一个字节都没落），也不许「闸缺席但写成功」。
 */
export function commitSourceWrite(hook: SourceWriteHook | undefined, abs: string, content: string): void {
  if (!hook) {
    throw new Error(
      `拒绝落盘（引擎）：\`${abs}\` 有改动要写，但本次调用**没有注入 \`write(abs, content)\`**。\n` +
        '  ★ 写用户源码只许经 `src/application/source_writer.ts` 的事务（闸 / 快照 / 自写登记的唯一组合点）。\n' +
        '  ★ 引擎自己直写 = 闸被绕开 ⇒ 这里选择失败，不降级。\n' +
        '  ★ 怎么办：调用方把 `txn.commit` 作为 `write` 注进来（样本见 `rename/rename_symbols.ts` 的 `doWrite(write)`）。',
    );
  }
  hook(abs, content);
}
