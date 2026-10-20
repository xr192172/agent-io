/**
 * gate_note —— 任务闸放行读数的**唯一带出口**（2026-10-20）。
 *
 * ## 它补的是什么
 * `write_gate#assertSourceWriteRegisteredFor` 一直返回 `{ note, exempted, warnings, ... }`
 * （"凭什么放行 / 豁免了谁"），但只有 `edit_code` 把返回值放进了回执；
 * `rename_file` / `rename_files` / `symbol_move` 三条写路**调完就丢** ⇒
 * 闸判了、豁免生效了、回执里一个字都没有（"做了不说"）。
 *
 * ## 形状（照抄 `edit_code`，不另发明）
 * · 机器侧：`receipt.task_gate = gate.note`（逐字，不改写）；
 * · 人读侧：`gateHumanLines(receipt.task_gate)` —— 只把闸给的 note 原样搬到消息里，
 *   **不在本文件重新判"是不是豁免"**（豁免的渲染唯一住处 = `write_gate#exemptionLines`，
 *   note 已含它）。
 *
 * ## 为什么放在 refactor/ 根
 * 三条写路都在 `refactor/rename/` 下，共同层就是 `refactor/`；本文件只依赖 `write_gate`，
 * 不被 `write_gate` 依赖 ⇒ **无环**（`write_gate` 不 import refactor 的任何东西）。
 */
import type { TaskGateOutcome } from '../write_gate.js';

/** 任何带 `task_gate` 字段的回执（三条写路的 Result 都满足） */
export interface GateNoteCarrier {
  /** ★ 闸的放行读数（`TaskGateOutcome.note` 逐字；被拒时不会走到这里 —— 闸直接抛） */
  task_gate?: string;
}

/**
 * 闸读数的**两种来源**（同一句话 `note` 的两个携带者）：
 * · `TaskGateOutcome` —— 直接调 `assertSourceWriteRegistered*` 的写路（rename_file / rename_files / symbol_move / edit_code）；
 * · `string` —— 走 `writeSourceFiles` 的写路，闸把 `note` **逐字**放在 `SourceWriteReport.task_gate` 里。
 * ★ `undefined` 仍然合法：dry_run / 未定位项目根时闸压根没跑，回执不该凭空多一个字段。
 */
export type GateNoteSource = Pick<TaskGateOutcome, 'note' | 'exempted'> | string | undefined;

/**
 * 把闸的放行读数挂到回执上。
 *
 * ★ `gate` 可为 `undefined`：dry_run 分支根本没跑闸，那时回执不该凭空多一个字段。
 */
export function attachGateNote<T extends object>(
  receipt: T,
  gate: GateNoteSource,
): T & GateNoteCarrier {
  // ★ 两种来源归一成**同一句话**（`note`），不各写一份取法：
  //   · 直接调闸的写路 → `TaskGateOutcome.note`；
  //   · 走 `writeSourceFiles` 的写路 → `SourceWriteReport.task_gate`（闸已经把 `note` 逐字存在这里）。
  const note = typeof gate === 'string' ? gate : gate?.note;
  if (note) (receipt as T & GateNoteCarrier).task_gate = note;
  return receipt as T & GateNoteCarrier;
}

/**
 * 人读侧：把 `task_gate` 变成消息里的一段（空 = 不加噪声）。
 *
 * ★ 逐字转发闸的 note —— 豁免点名（`exemptionLines`）已经在 note 里，
 *   所以这里**不重新判断/重新拼豁免**（否则就是第二份渲染）。
 * ★ 前缀只加一次（`★ 任务闸：`），缩进保持原样。
 */
export function gateHumanLines(taskGate?: string): string {
  if (!taskGate) return '';
  return `★ 任务闸：${taskGate}`;
}
