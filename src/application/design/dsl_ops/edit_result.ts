/**
 * 编辑操作统一返回类型
 */

/** 所有 edit 操作的统一返回：人话消息 + 目标 feature */
export interface EditResult {
  message: string;
  feature: string;
  /**
   * ★ 2026-10-11（T160）：**结构化产物**（可选）。
   * ★ 为什么加它：`wrap()` 本来就会把 `r.data` 送进 `---DATA---` 机器通道
   *   （`plumbing.ts` 的 `machinePayload`）—— 此前 `EditResult` **没有 data 字段**
   *   ⇒ 那些已经算出结构化结果的 op（如"整块重写契约"的增删清单）**只能压成散文**，
   *   agent 得正则解析。★ 这正是本仓 §5 纪律①「产物结构化，非 message 串」的落点。
   * ★ 可选 ⇒ **不破坏任何既有 op**（不填就不出 DATA 段）。
   */
  data?: unknown;
}
