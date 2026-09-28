/**
 * R5（archify 渲染线）隔离开关 —— 单点控制，供该线全部测试引用。
 *
 * 背景（2026-09-15 用户拍板）：
 *   archify 及其基础上开发的组件（= R5 线）**保留在仓内**，但**暂不继续开发**。
 *   为了让这条线"既留着、又不拖累主线"，需要一个**单点开关**：
 *     - 默认（不设变量）= **照常跑**，R5 的测试与自检都生效（保持回归保护）；
 *     - 设 `AGENT_IO_R5_SKIP=1` = **整线跳过**，R5 的测试全部 skip，
 *       主线开发者在 R5 出问题（上游漂移 / node 升级 / 环境差异）时可以一键绕开，
 *       不必删代码、不必改断言、不必让 CI 变红。
 *
 * 设计纪律：
 *   1. **不删除、不注释**：R5 代码与测试原样保留 ⇒ 随时可以恢复继续开发；
 *   2. **默认开启**：静默跳过会隐瞒问题（我们最反对的"静默给旧答案"）⇒
 *      必须显式设 `AGENT_IO_R5_SKIP=1` 才跳过，且 skip 原因写进用例名，测试报告里看得见；
 *   3. **单点**：全线的判断都从这里读，避免各文件各自解析环境变量产生漂移。
 *
 * 用法：
 *   - 测试文件顶部：`import { r5Describe } from '../helpers/r5_gate';`
 *     然后把 `describe(...)` 换成 `r5Describe(...)`；
 *   - 命令行临时绕过：`AGENT_IO_R5_SKIP=1 npm test`；
 *   - CI 想临时摘掉这条线：在 job 里加 `env: { AGENT_IO_R5_SKIP: '1' }`（不推荐长期如此）。
 */
import { describe } from 'vitest';

/** 是否跳过整条 R5 线。仅当显式置为真值串时跳过。 */
export const R5_SKIPPED: boolean = (() => {
  const v = (process.env.AGENT_IO_R5_SKIP ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
})();

/** skip 时附加在用例名后的可见标记（让"为什么没跑"出现在报告里，而非静默消失）。 */
export const R5_SKIP_REASON = '（R5 线已由 AGENT_IO_R5_SKIP 挂起，设 AGENT_IO_R5_SKIP=0 恢复）';

/**
 * R5 线的 `describe`：
 *   - 未挂起 → 行为与原生 `describe` 完全一致；
 *   - 已挂起 → 变成 `describe.skip`，且组名带挂起标记。
 *
 * 说明：用显式 `describe.skip` 而不是 `describe.skipIf`，是为了让 vitest 把该组
 * 记成 "skipped"（在报告里可见），而不是静默不收集。
 */
export function r5Describe(name: string, fn: () => void): void {
  if (R5_SKIPPED) {
    // eslint-disable-next-line no-restricted-syntax -- 有意用 skip 让挂起状态在报告中可见
    describe.skip(name + ' ' + R5_SKIP_REASON, fn);
  } else {
    describe(name, fn);
  }
}
