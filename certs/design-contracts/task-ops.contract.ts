/**
 * ★★★ 设计侧契约（符号级）—— task_ops
 *
 * ## 这是什么
 * **「设计 DSL 的符号层」**，用 TypeScript 写 —— **LLM 天生会写 TS**，不用学我们那套 JSON DSL；
 * 而 **`tsc` 就是免费的校验器**（不用自写 `validateDSL` / `judgeExpectations`）。
 *
 * ## 它判什么（只判符号级）
 * ① **符号存在** ② **签名兼容** ③ **用法成立**（设计说的"怎么调用"在实际代码上能否编译）
 * ⇒ ★ 编译通过 = 设计要的用法成立；**编译不过 = "设计有、实际没有"**（D8 表达不了的那类）。
 *
 * ## ★★★ 它证明过的两件事（2026-10-18）
 * 1. **我第一次写这份契约时漏了 `TaskOpRequest.type`** —— `tsc` 当场报 `Property 'type' is missing`。
 *    ⇒ **"设计方以为自己知道实际的样子"这件事，只有编译能纠。**
 * 2. **它一开始放在 `certs/` 而主 tsconfig 的 include 只有 `src` 一棵树 ⇒ 根本没被编译 ⇒ "0 错误"是假绿。**
 *    ★（本行原本直接引了那个 glob，结果里面的星号加斜杠把这段块注释提前闭合了 ⇒ 语法错。教训：块注释里别写 glob。）
 *    ⇒ ★ 所以现在有独立的 `tsconfig.contract.json`，**它必须能被单独编**。
 *
 * ## 边界（明说，不假装）
 * ★ **只判形状，不判值**：`TaskOpRequest.type` / `op` 是 `string` 而不是字面量联合
 *   ⇒ 契约拦不住 `op: 'cliam'`（拼错）—— 那要靠 `OP_SPECS` 的运行时校验。
 * ★ **不判行为**（"blocked 卡必须拒领"）—— 那要夹具。
 * ★ **不判调用关系**（"谁调它"）—— 那在 `cache.db`。
 */
import {
  applyTaskOp,
  publishTask,
  type TaskOpInput,
  type TaskOpRequest,
} from '../../src/application/design/dsl_ops/task_ops.js';

// ─────────────────────────────────────────────────────────────
// ① 立卡：设计说「只给 feature + node_id」—— 内容从 decision 翻，publish 不收 data
// ─────────────────────────────────────────────────────────────
export const 立卡 = publishTask({ feature: 'task-system-plan', node_id: 'file_x' });

// ② 设计说「publish 的输入可以带 agent（发起者身份，工具不伪造）」
export const 立卡带身份: TaskOpInput = { feature: 'f', node_id: 'n', agent: 'me' };

// ─────────────────────────────────────────────────────────────
// ③ 四个动作的【唯一入口】：applyTaskOp(feature, op, agent?) ⇒ Promise
//    ★ 设计说：claim / release / complete 都不单独导出，统一走这个分发。
//    ★ 注意 `type` 字段 —— 我第一次就漏了它（契约当场抓住）。
// ─────────────────────────────────────────────────────────────
export async function 一个动作都不能少(): Promise<void> {
  const claim: TaskOpRequest = { type: 'task', op: 'claim', id: 'file_x', data: { owner: 'agent' } };
  await applyTaskOp('task-system-plan', claim, 'agent');

  await applyTaskOp('task-system-plan', {
    type: 'task',
    op: 'release',
    id: 'file_x',
    data: { reason: '不做了' },
  });

  await applyTaskOp('task-system-plan', {
    type: 'task',
    op: 'complete',
    id: 'file_x',
    data: {
      evidence: {
        kind: 'attestation',
        by: 'design-contract',
        at: new Date().toISOString(),
        verdict: 'pass',
        why: '契约用它证明 complete 的 evidence 形状能编译',
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// ④ 设计说「publish 是同步的、applyTaskOp 是异步的」——
//    哪天真把 publish 改成 async，第一行就会红。
// ─────────────────────────────────────────────────────────────
type PublishReturn = ReturnType<typeof publishTask>;
type ApplyReturn = ReturnType<typeof applyTaskOp>;

export const publishIsSync: PublishReturn extends Promise<unknown> ? never : 'sync' = 'sync';
export const applyIsAsync: ApplyReturn extends Promise<unknown> ? 'async' : never = 'async';
