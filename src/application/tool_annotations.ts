/**
 * tool_annotations —— 43 工具的 **MCP ToolAnnotations** 逐工具声明（第⑥项，用户裁定全标）。
 *
 * ## 为什么单独一张表（不是塞进 ToolDef 字面量）
 * 43 个工具的注解是**一份逐工具清单**（每行一条、可 grep、可 diff）；塞进各 index.ts 的字面量
 * 就是把清单摊到 10+ 个文件里（对账靠翻文件）。本表 = 清单唯一住处；`ToolDef.annotations` 是类型，
 * `tool_registry` 汇总时从这里取。
 *
 * ## 口径（lead 裁定 2026-11-10）
 * · 只读（get_dsl/explore_code/capability_map/find_references…）⇒ `readOnlyHint: true`
 * · 写源码（edit_code / rename 系 / move 系 / observe_instrument 等 apply 类）⇒ `readOnlyHint: false`
 * · 写设计册不写源码（edit_dsl/design_line）⇒ `readOnlyHint: true`（写的是设计侧状态，不是环境）+ destructiveHint 视情况
 * · 覆盖文件（fakes 路径 effects / apply_refactor_plan）⇒ `destructiveHint: true`
 * · 幂等可重跑（rename/move/patch）⇒ `idempotentHint: true`
 * · 需要外部项目状态才能判定（diagnose/observe）⇒ `openWorldHint: true`
 * ★ 规范语义：全部是 hints 不是安全保证——本仓写闸判定仍住 `ToolDef.writes`（saveDSL 闸），两层共存。
 * ★ 层位：application（注解的是 application 的 ToolDefs；infrastructure 倒挂被卡过一次，实测 Move-Item 被拒后确认）。
 */
import type { ToolDef } from './types.js';

export type ToolAnnotations = NonNullable<ToolDef['annotations']>;

/** 逐工具注解（★ 键必须覆盖全部工具——tool_registry 汇总时缺键即报，防漂） */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // ── 只读：查/看/索引（不碰用户环境）──
  // （memory_observe 已退役——注解键删除，见文件尾注）
  observe: { readOnlyHint: false, openWorldHint: true }, // action=instrument 会改用户源码（插桩）
  recommend_observe_points: { readOnlyHint: true }, // 写 observe-points.json（工具自有状态，非用户环境）
  run_tests: { readOnlyHint: false, openWorldHint: true }, // 跑测试会执行用户代码（副作用不可控）
  recover_run: { readOnlyHint: true, openWorldHint: true }, // ★ P2 只读恢复：读任务/事件/证据/Git 现场，不写权、不 claim
  translate: { readOnlyHint: false }, // 单文件模式可写 out 文件
  go_originals: { readOnlyHint: true },
  cross_repo_symbol_index: { readOnlyHint: true },
  code_health: { readOnlyHint: true },
  get_dsl: { readOnlyHint: true },
  design_line: { readOnlyHint: true, openWorldHint: true }, // action=judge/compile 会真跑判据；plan 写画布、sync-signatures(apply) 写源码签名、compile(apply) 写 decision.expectations（全是设计侧状态）
  import_project: { readOnlyHint: false, destructiveHint: true }, // fork/重建会**重建设计册**
  explore_code: { readOnlyHint: true },
  diagnose: { readOnlyHint: false, openWorldHint: true }, // apply=true 时出补丁可写源码
  diagnose_loop: { readOnlyHint: false, openWorldHint: true },
  // （gateway_provider 已退役——注解键删除，见文件尾注）
  capability_map: { readOnlyHint: true },
  capability_audit: { readOnlyHint: true },
  sync_contracts: { readOnlyHint: false }, // 写设计册 expected_apis
  index_integrity: { readOnlyHint: true }, // refresh 会重建索引（工具自有状态）
  upgrade: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }, // apply 会改源码+git 提交
  contract_page: { readOnlyHint: true },
  chain_hop_args: { readOnlyHint: true }, // ★ 第⑬项：first/next_hop_args 的合并入口（两旧名已退役出 MCP 面）
  // （first_hop_args / next_hop_args / gateway_provider / memory_observe 已退役——注解键随之删除，
  //   RETIRED_TOOLS 记录去向；防漂门只查"TOOL_DEFS ⊆ TOOL_ANNOTATIONS"，孤儿键删除即干净。）
  diff_views: { readOnlyHint: true },
  edit_code: { readOnlyHint: false, destructiveHint: true }, // 写源码（有快照可回滚）
  rename_symbols: { readOnlyHint: false, idempotentHint: true }, // 跨文件引用改写（幂等：改完再跑无变化）
  rename_files: { readOnlyHint: false, idempotentHint: true },
  move_domain: { readOnlyHint: false, idempotentHint: true },
  move_symbol: { readOnlyHint: false, idempotentHint: true },
  find_references: { readOnlyHint: true },
  structure_gap: { readOnlyHint: true },
  deprecate_offline: { readOnlyHint: false, destructiveHint: true }, // 删除死代码（有 dry_run 前置）
  annotate_functions: { readOnlyHint: false, idempotentHint: true }, // 注释注入（幂等：已有注解跳过）
  refactor_pipeline: { readOnlyHint: false, destructiveHint: true }, // 改源码 + 验证回滚
  refactor_judge: { readOnlyHint: true },
  snapshot: { readOnlyHint: true }, // list 只读；rollback 写快照恢复（工具自有状态）
  rules: { readOnlyHint: true }, // check 只读；export/apply 写规则库（工具自有状态）
  apply_refactor_plan: { readOnlyHint: false, destructiveHint: true }, // 批量文本替换（原子全成或全不成）
  reconcile_effects: { readOnlyHint: false }, // 写设计册 contract（观测转正）
  reconcile_chain: { readOnlyHint: true },
  edit_dsl: { readOnlyHint: true, idempotentHint: true }, // 写**设计册**（设计侧状态，非用户源码环境）
  // ★★★ 2026-11-18（台账写面）：7 写 3 读（写 `tasks.db` 的台账）/ **不写设计册**（`ToolDef.writes:false`）
  ledger: { readOnlyHint: false, idempotentHint: false },
  design_intent: { readOnlyHint: true, idempotentHint: true }, // 同上（overlay/意图层）
  opl: { readOnlyHint: false }, // advance 会写源码（implement 步）
};
