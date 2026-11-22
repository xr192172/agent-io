/**
 * ledger 工具的**元数据面**：动作闭集 / 入参 schema / description —— 零实现依赖的叶子模块。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：这些常量原先住 `tool.ts`（与 handler 同文件）。
 *   `meta/index.ts` 的 ToolDef 字面量在**模块求值期**就要它们，而 `tool.ts` 的运行时闭包会拉进
 *   台账引擎 + storage（实测 69 个 dist 模块）⇒ 一个 schema 把实现图拖进了 `--help` 的加载路径。
 *   搬到叶子后：**仍是一处权威**（动作闭集 / 参数 / 语义说明三者不分离，只是从 handler 文件里分出来），
 *   `tool.ts` re-export ⇒ 公开 API 与工具面**一字不变**。
 */
import { z } from 'zod';

/**
 * 台账动作闭集 —— **唯一住处**（`ToolDef.inputSchema` 的 `z.enum` 由它派生，别手抄第二份）。
 * 与引擎的对应（一眼可核，改一处必须改这里）：
 *   hang→`hangRow` · annotate→`annotateRow` · close→`closeRow` · reopen→`reopenRow` ·
 *   supersede→`supersedeRow` · verdict→`writeVerdict` · list→`listActive`+`ledgerAvailability` ·
 *   get→`getRow`+`ledgerAvailability` · conflicts→`subjectConflicts` ·
 *   review_queue→`readReviewQueue` · resolve_review→`resolveReview`
 */
export const LEDGER_ACTIONS = [
  'hang',
  'annotate',
  'close',
  'reopen',
  'supersede',
  'verdict',
  'list',
  'get',
  'conflicts',
  'review_queue',
  'resolve_review',
] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

/**
 * 台账只读 action（只触 listActive / getRow / subjectConflicts / readReviewQueue）；
 * 其余闭集动作触引擎写 API。**由 LEDGER_ACTIONS 派生**，不是第二份判据 —— 动作级
 * 效果表在 `meta/index.ts` ledger ToolDef 的 `actions` 里直接展开消费这两个闭集
 * （read = safe-read / write = may-write）；判定权仍在引擎 handler，此处只提供面的形状。
 */
export const LEDGER_READ_ACTIONS = ['list', 'get', 'conflicts', 'review_queue'] as const;
export const LEDGER_WRITE_ACTIONS = LEDGER_ACTIONS.filter(
  (a): a is LedgerAction => !(LEDGER_READ_ACTIONS as readonly string[]).includes(a),
);

/**
 * 值域**镜像**（引擎只导出类型、没导出值数组 ⇒ zod 这边只能列一遍）。
 * ★ 改引擎闭集时这几行必须一起改；**判定权仍在引擎**（handler 不拿它们判语义，
 *   只用来把 zod 的窄类型接过去）—— 所以它们是"面的形状"，不是"第二份判据"。
 */
export const RECORD_KINDS = ['task', 'prose', 'ruling', 'discipline', 'meta'] as const;
const REVIEW_REASONS = ['half-escaped', 'subject-conflict', 'multi-anchor', 'ragged', 'drift'] as const;

/**
 * 工具面 schema —— 与 handler **住同一个文件**（一处权威：动作、参数、语义说明不分离）。
 * ★ 描述刻意极短：工具面是**每个请求重付**的固定成本（`mcp_scan` 的字节棘轮），
 *   长文只许有一处 —— `LEDGER_TOOL_DESCRIPTION` 与本文件头注。
 */
export const LEDGER_INPUT_SCHEMA: Record<string, z.ZodType> = {
  // ★ describe 必须**列全 enum 取值**（`tests/i1_doc_alignment.test.ts` 的那条判据：枚举里有、
  //   describe 里没有 ⇒ 模型在 `tools/list` 上读不到这个取值）。由 LEDGER_ACTIONS 派生，别手抄。
  action: z.enum(LEDGER_ACTIONS).describe(`动作：${LEDGER_ACTIONS.join(' / ')}`),
  project_dir: z.string().describe('台账库所在项目根（`<root>/.agent-io/tasks.db`）'),
  ref_id: z.string().optional().describe('台账 id（除 list / conflicts / review_queue 外必填；活跃期唯一）'),
  section: z.string().optional().describe('章节，如 §I'),
  title: z.string().optional().describe('标题（hang 必填）'),
  problem: z.string().optional().describe('原问题（逐字）'),
  proposal: z.string().optional().describe('原提案（逐字）'),
  by: z.string().optional().describe('署名（写动作必填）'),
  body: z.string().optional().describe('正文（逐字存）'),
  state: z.enum(['done', 'void']).optional().describe('close 结局：只有 done / void（无 wontfix）'),
  reason: z.string().optional().describe('close 必填：为什么销（逐字入事件）'),
  evidence: z.string().optional().describe('close 必填：证据（逐字入事件）'),
  superseded_by: z.string().optional().describe('取代者 ref_id（不能自指）'),
  subject_path: z.string().optional().describe('关系锚点：仓库相对路径'),
  subject_symbol: z.string().optional().describe('锚点符号（须与 path 同给）'),
  declare_supersedes: z.string().optional().describe('hang：显式取代谁（同 subject 冲突时唯一出路）'),
  record_kind: z
    .enum([...RECORD_KINDS, 'all'])
    .optional()
    .describe(`行种类：${RECORD_KINDS.join(' / ')}（默认 task；all 只给 list）`),
  // ★ `origin` **故意不声明**（二席驳斥 #1）：工具面只许造 engine 行；import 行只能由 importer 产生。
  //   键不给、handler 还拦（`originGuardOf`）—— 因为 schema 是 loose object，光删键拦不住直调。
  include_superseded: z.boolean().optional().describe('list: include superseded active rows (default false = current only)'),
  include_closed: z.boolean().optional().describe('list：附 closed_count'),
  review_reason: z.enum(REVIEW_REASONS).optional().describe(`队列原因过滤：${REVIEW_REASONS.join(' / ')}`),
  open_only: z.boolean().optional().describe('缺省 true = 只看未消项'),
  review_id: z.number().int().optional().describe('队列项 id'),
};

/**
 * 台账工具的 `description` —— **模型读的那一面**。
 * ★ 语义口径的唯一住处就这两处（本常量 + 文件头注）；**各动作的必填键不在这里复述**
 *   （它们住在 schema 的 `describe` 里）—— 工具面是每请求重付的固定成本，字节棘轮会看着它。
 */
export const LEDGER_TOOL_DESCRIPTION =
  '**台账唯一入口**：单工具 + action 枚举，每个 action **直映一个引擎 API**（纯透传 + 参数校验）。' +
  '台账住 `<project_dir>/.agent-io/tasks.db`，**不是**设计册 ⇒ `writes:false`。' +
  '★ **销账 = 状态翻转**（`close` 置 state=done/void + `closed_*` + close 事件）；' +
  '**`annotate` 不改 state** —— 只挂批注的账永远留在活跃集（实测 315 行全 active）。' +
  '★ `close` 结局**闭集只有 done / void**（DB CHECK）：**没有 wontfix** —— ' +
  '不做 / 不修 ⇒ void，理由写 `reason`（与 `evidence` 均必填、逐字留痕）。' +
  '★ 台账写 = **真相状态变更**，不是日志：`write_log` / dogfood 账本不覆盖它' +
  '（审计链 = `tasks.db` 的 append-only 事件）。' +
  '★ 读动作同时给 `availability`（ok 以外都不是"0 条"）；★ 拒绝报文逐字来自引擎。';
