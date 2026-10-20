# 缺陷

> 只有现状。状态三种：`未修` / `部分` / `已修`。改状态就改这张表，不记历史、不写推导。
> 已修的全部收进 §末，一行一条。A/B/C/D 台账之外的欠账进 `INDEX.md §四`，不进本表。

| # | 现象（一句话） | 在哪 | 状态 |
|---|---|---|---|
| A1 | 巡检只有手动入口 `npm run patrol`，无调度；不跑就没人发现漏收口 / 过期租约 | `scripts/patrol.mjs` | 部分 |
| A3 | `claim` 是 check-then-act：CAS 判的是开头加载的内存 `card`，不重读盘 ⇒ 并发领同一张卡可互相覆盖 | `task_ops.ts#claimTask` | 未修 |
| A4 | 证据闸只验形状：`evidence.all_green` 手填即收，从不与判定结果对账 | `overlay.ts#validateProgressEvidence` | 部分 |
| A5 | L1 卡（0 条期望）恒判 `unknowable` ⇒ 永不进 `missed_close`，巡检看不见"该收口的建构卡" | `task_drift.ts#patrolDrift` | 未修 |
| A7 | `owner ≠ actor` 默认只提醒 + 放行；`AGENT_IO_ACTOR` 全仓无赋值 ⇒ 阻断面在生产不可达 | `write_gate.ts#resolveActor` | 部分 |
| B1 | 巡检两个计数与设计 DSL 口径不一致：`missed_close` 只报 claimed；`should_void` 混装"卡多余 / 违约 / 节点消失" | `task_drift.ts` | 未修 |
| B5 | `renderMicro` / `shouldExpand` 在 `src/` 零调用（只有探针调） | `discussion_log.ts` | 未修 |
| B6 | `edit_dsl` 整批失败只回滚 DSL 字节，不回滚 overlay（进度权威） | `update_feature.ts#restoreRaw` | 未修 |
| C1 | 注释里的判据种类数过期：写"五种""六种"，实为 8 种 | `expectation.ts:25` `design_sheet.ts:13` `design_sheet.ts:149` | 未修 |
| D-verifier-role | 第 7 步"双验"无角色：单 agent 只能自验 | `task_ops.ts#completeTask` | 未修 |
| D-L1 | 没有 expectation kind 能表达"DSL 建构完整"；L1 只能靠 `constructionVerdict` 旁路判 | `task_ops.ts#constructionVerdict` | 部分 |
| D8 | 表达不了"应该有人调用 X，而现在没有"（`call-exists` 要 from=调用者；`edge-absent` 只到文件级） | `expectation.ts` | 未修 |
| D-judge-port | domain 直接 import application（`task_machine` → `expectations`），倒挂未拆 | `task_machine.ts:40` | 未修 |
| D-actor-entry | 没有运行时入口负责设置 `AGENT_IO_ACTOR`；`calls` 格式表达不了"入口" | `write_gate.ts` `scripts/install_mcp.mjs` | 未修 |
| D-validate-decision | `validateDSL` 不看 `decision`（不在 schema 里）⇒ 决策卡写坏不进结构校验 | `validator.ts` | 未修 |
| D-anti-decoration | 边几乎没有判据：`edge-exists` 只有个位数，其余靠节点上的判据顺带证明 | `.agent-io/design/task-system-plan.dsl.json` | 未修 |
| D-parallel | "两两交集为空"算不出来（path 覆盖率不够） | — | 未修 |
| D-claim-incomplete | "领到先查依据"只由人执行，无机器检查器 | `task_ops.ts#claimTask` | 未修 |
| D-must-have-bindings | `must_have` 的兜底来源 `semantic.files.symbols` 是**顶层绑定**，不是 API 面（`.mjs` 的 const 一律 `kind:'type'`、无 `exported`）⇒ 局部量也进清单 | `design_line.ts#mustHaveFor` | 未修 |
| D-touches | 机器可读的 `touches` 声明只有 `t354` 一张 | `certs/` | 未修 |
| D-npm-scripts | `npm run diff` / `npm run fork` 指向不存在的脚本 | `package.json:107` `package.json:108` | 未修 |
| D-http-multi-feature | HTTP 界面只读一个 feature（`AGENT_IO_FEATURE`，缺省 `task-system-plan`） | `serve.ts#LIVE_FILE` | 未修 |
| D-decision-fields | 决策卡缺 `creator` / `source` / `handoff`（`NodeDecision` 无此三字段），但 `op_data_spec` 宣称可传 ⇒ 静默落库、零读端 | `geometry.ts#NodeDecision` `op_data_spec.ts:206` | 未修 |
| D-symbol-layer | 没有符号级对拍载体（设计侧无 `.d.ts`，`tsc` 未接） | — | 未修 |
| D-dsl-ops | `edit_dsl` 各 op 没验过一条完整链（改字段 ⇒ design 字节变没变） | `dsl_ops/*` | 未修 |
| D-stale-comments | 注释仍引已退场的 `features/<f>.json` 单文件形态 | `diff_views.ts:201` | 未修 |

## 已修

- A2 红归属收成 `RedAttribution` + `RED_DISPOSITION` 穷尽表（`task_machine.ts`）
- A6 已领/已完成 L2 卡的判据改动被拒（`node_ops.ts#assertCardCriteriaUnchanged`）
- B2 读数快照已从 DSL 删除，且 `validateDSL` 见 `reading_now` / `block_readings` 即报（`validator.ts#validateNoReadingSnapshots`）
- B3 `t_void` 有写端；`t_supersede` 已退场；不可走的迁移标 `unimplemented`（`task_machine.ts#TRANSITIONS`）
- B4 `enabled` + `blocked_by_open_question` 合为三值 `TransitionState`
- C2 终态概念换成 `CLOSED_TASK_STATES` / `isClosedTaskState`，字面量只住一处（`task_schema.ts`）
- D-T8 上架读端 `listPool` / `BoardView` 已建（`board/pool.ts`）
- D-T8-wire 读端已接进 `get_dsl` 的 `pool` 查询（`query_feature.ts`）
- D-invariant-0 不变量有执行者：`publish` 只读 `decision`，不收手写 summary
- D-invariant-1 由 `validateNoReadingSnapshots` 执行（不再是"没人判"）
- D-target-exists `claim` 走 `loadTask`，卡不存在即抛
- D-release-by `releaseTask` 落 `released_by`
- D-actor-wire 生产写链已改走 `resolveActor()`（`edit_code` 两处 / `rename_file` / `rename_files` / `symbol_move`）
- A7-写路 4 条写路（`rename_file` / `rename_files` / `symbol_move` / `apply_refactor_plan`）全部**显式收 `actor`** 并往下传
- D-updatefeature-writes-on-fail 失败回滚改写回原始字节（`update_feature.ts#restoreRaw`）
- D-complete-nonatomic 投影失败时写回调用前字节（`task_ops.ts#completeTask`）
- D-edge-id-unique `edges.id` 重复进校验（`validator.ts`，键 `duplicate_id:edge:*`）
- D-gate-text 不是债：三个 `gate` 是命名问题，非判据
- 审计 1–3 `stage_registry` / `board/pool` / `capability_map` 的文案已指向 `design/`
- 审计 4 HTTP 活态 DSL 改读 `getDesignSheetFile`，不再读停写的 `agent-io.json`
- D-design-completeness `design-check.mjs` 执行 `task_plan.design_completeness.criteria`（D1–D9 + D4b/D5b）
- D-dual-write `dual_write` metric 随 overlay 去掉 `decision` 一并移除（全仓无引用）
