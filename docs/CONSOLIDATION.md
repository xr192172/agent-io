# CONSOLIDATION —— 工具面生态位普查与收敛（I4，2026-10-25）

> 收敛原则（AGENTS.md）：同生态位出现更高级工具 → 吸收旧的，全方面只留一个，最终吸收进设计侧。
> 本文是**首次系统性生态位普查**的产物。工具清单事实源 = `src/application/tool_registry.ts`（6 条能力线数组汇总），提取方法 = AST 解析各 `src/application/<线>/index.ts` 的 ToolDef 字面量。

## 收敛前后对比

| 项 | 改前 | 改后 |
|---|---|---|
| 原子工具数（all 面，`TOOL_DEFS`） | 64 | **63** |
| 分线 | observe 11 / cross 5 / design 9 / meta 16 / refactor 20 / harvest 3 | observe 11 / cross 5 / design 9 / meta 16 / refactor **19** / harvest 3 |
| 编排入口 `atomic_call` | 只在 composed/minimal 注册（不变） | 同左 |

对拍：`tsc --noEmit` 改前后逐字一致（2 个既有 TS2307，见"诚实清单"）；全部测试 pass/fail 与基线一致（24 pass / 2 fail，fail 均为已知 test_contract 缺失根因）。

## 本次吸收（1 个）

| 被吸收者 | 吸收者 | 理由 | 证据 |
|---|---|---|---|
| `remove_dead_imports`（refactor 线） | `refactor_pipeline` 的 `dead_imports` 步 | ① 同一份执行内核（管线复用 `edit/remove_dead_imports.ts` 的执行函数，**实现保留**）；② 显式 dead 清单入参同形状（`steps.dead_imports.dead` = 原 `dead: DeadDepCandidate[]`）；③ 不给清单时自动检测（`detectDeadImports`，TS/Go）比原描述指向的 `dead_deps`（**该工具已不在注册表，注册 0 命中**）更直接；④ `verify: true \| {commands}` 与原工具验证闭环逐字同语义（改前基线 + 改后重验 + 回归自动回滚）；⑤ `chain_wiring` / `tool_faces` / `tests/` 对该工具名 0 引用 | `src/application/refactor/pipeline/refactor_pipeline.ts:18-28,108-110,124-125,201-209`；原 def 已从 `src/application/refactor/index.ts` 移除（头部留有吸收说明注释） |

随吸收同步更新：
- `capability_map.ts#WHEN_OVERRIDES`：删 `remove_dead_imports` 条目；`refactor_pipeline` 条目补"含 dead_imports 步"。
- `refactor/index.ts` `deprecate_offline` 描述：原"承接 dead_deps / brickify 的废弃证据"（幻影上游）改为"自 `detectDeadImports` 取证"；"与 remove_dead_imports 是两个对象"改为"与 refactor_pipeline 的 dead_imports 步"。
- `presentation/mcp/server.ts` 能力导览文案去掉 `remove_dead_imports`。
- 实现模块 `src/application/refactor/edit/remove_dead_imports.ts` **原样保留**（`deprecate_offline` 的写路 `removeDeadImportsWithVerify` 仍用它）。

## 既有收敛案例核对（说 vs 做）——全部一致 ✓

| 收敛案例 | 声称 | 核对 |
|---|---|---|
| `gateway_provider` | 吸收 4 个 gateway_* | 注册表仅 1 个，无 gateway_* 残留 ✓ |
| `rules` | 3 入口 → 1 | ✓ |
| `edit_dsl` | 吸收多写入口 | ✓（task 系/审批/布局均是其 op） |
| `design_intent` | 2→1 | ✓ |
| `snapshot` | 2→1 | ✓ |
| `archive` | 2→1 | ✓ |
| `rename_files` | 并入原 rename_file | ✓ |
| `rename_symbols` | module/local 两粒度合一 | ✓ |
| `explore_code` | 吸收 diff_impact / derive_* 等 | ✓（描述明示，注册无残留） |
| `behavior_baseline` | I2b 已拆注册 | ✓（注册 0 命中；WHEN_OVERRIDES 条目已随 I2b 删除） |

## 待定（5 组 9 工具，全部保留注册，不动）

| 组 | 生态位 | 不动手的原因 |
|---|---|---|
| `diagnose` / `diagnose_loop` | 症状诊断 vs 诊断闭环 | 分工在注册描述与 WHEN_OVERRIDES 双处明写（loop=闭环，diagnose=只诊断不写盘）；且 `diagnose_loop` 当前因 `test_contract` 模块缺失 import 断裂——把另一个工具吸收进一个跑不起来的入口不安全 |
| `first_hop_args` / `next_hop_args` | 链入参装配（起手 vs 接续） | 同族互补（capability_map.ts 注释明写"同族"），合并需动 chain_wiring 对外口径，收益/风险比不划算 |
| `consistency_check` / `detect_drift` | DSL expected_apis vs 代码 | 同读一对事实但产物不同：差异块+跨文件不变式（喂"分区域重写"工作流）vs 漂移台账+git changed 范围；实现两处（`intent/consistency.ts` / `intent/detect_drift.ts`），合并是一次设计决策不是普查可拍板的 |
| `observe_log` / `observe_trace` / `observe_judge` | events.jsonl 三视图（原始查询/调用树/偏差判定） | 同数据源不同视图，聚合需一次设计决策；当前各自语义清晰无互相说谎 |
| `suggest_renames` / `find_similar_names` | 改名建议 | 缺陷类不同（短名/无意义 vs 孪生名消歧），WHEN_OVERRIDES 各有策展口径 |

## 保留工具的生态位一览（63 个）

- **design（9）**：`import_project`（建档入口）/ `get_dsl`（统一读）/ `edit_dsl`（统一写）/ `render_design`（渲染）/ `consistency_check` / `detect_drift` / `design_line`（六步读数）/ `design_intent`（why 闸）/ `opl`（愿望→产线自驱）
- **meta（16）**：`explore_code`（代码理解大入口）/ `capability_map`（导航）/ `capability_audit`（语言覆盖审计）/ `tool_usage`（使用读数）/ `contract_page`（符号六块一次给全）/ `read_project_docs` / `index_integrity`（索引自检）/ `sync_contracts`（契约回填）/ `diagnose` / `diagnose_loop` / `gateway_provider` / `observe_proposals` / `upgrade`（版本契约差）/ `archive` / `first_hop_args` / `next_hop_args`
- **refactor（19）**：`edit_code`（符号级编辑）/ `rename_symbols` / `rename_files` / `move_symbol` / `move_domain` / `plan_refactor` + `apply_refactor_plan`（两半成对）/ `refactor_pipeline`（含 dead_imports 步）/ `deprecate_offline` / `find_references` / `impact_analysis` / `structure_gap` / `diff_views` / `annotate_functions` / `suggest_renames` / `find_similar_names` / `refactor_judge` / `rules` / `snapshot`
- **observe（11）**：`observe_instrument`（插桩执行）/ `recommend_observe_points`（选点）/ `observe_log` / `observe_trace` / `observe_judge` / `reconcile_chain` / `reconcile_effects` / `run_tests` / `feature_line` / `memory_observe`（CDP 外部内存观测）/ `narrate_step`
- **cross（5）**：`translate_go_ts`（Go→TS 骨架+验证闸）/ `translate_book`（翻译册重算）/ `go_originals`（Go 原文 ground truth）/ `cross_repo_symbol_index`（撞名预检）/ `code_health`（三层体检）
- **harvest（3）**：`harvest_closure`（拎取闭包）/ `extract_contracts`（契约提取）/ `harvest_decisions`（决策卡补录）

正交性说明（易误判的三对）：
- `find_references`（改/删前看波及）vs `impact_analysis`（反向可达闭包+风险排序）vs `harvest_closure`（正向"拎走要带什么"）——方向与粒度不同，`harvest_closure` 描述明写"与 impact_analysis 正交"。
- `diff_views`（design vs live 两册 DSL 比对）vs `consistency_check`/`detect_drift`（DSL vs 代码）——比对对象不同。
- `capability_map`（工具导航）vs `capability_audit`（语言×功能覆盖矩阵）vs `tool_usage`（用量/死工具）——三者回答的问题互不重叠，`capability_audit` 描述明写"与 capability_map 不是一回事"。

## 附带清理（说=做一致性）

`capability_map.ts#WHEN_OVERRIDES` 里 4 条指向**已不存在工具**的陈旧策展条目（本文件 §staleWhen 纪律："工具删了、策展文本忘了删 ⇒ 删条目"）一并删除：`manage_feature`、`render_brickwork`、`scaffold`、`review_changes`（四者在 src 注册均 0 命中）。

## 诚实清单（本次普查没做/没做成的）

1. **`test_contract` 模块缺失比"测试红"更重**：`meta/index.ts:49` 静态 import `diagnosis/diagnose_loop.ts` ⇒ 该模块缺失使 `tool_registry` 整体 import 失败 ⇒ **从 src 起 MCP server / 跑 capability_map / validateLanes / tools/list 全都起不来**（本次普查的运行时提取被迫改用 AST 静态提取）。dist 旧产物不受影响，故线上 64 工具"看起来正常"。已知红，未修（不属本任务）。
2. 运行时自检（validateLanes 的 staleWhen/stale）因此**无法跑通**；陈旧条目判定改由 grep 注册表 0 命中佐证。
3. 基础设施注释里仍有少量提及 `remove_dead_imports` 的文字（`write_gate.ts`、`index_freshness.ts`、`schema.ts`、`refactor_langs.ts`）——它们指向的是**实现模块与同步写路机制**（保留），不是工具面，未逐条改写。
4. 剩余 5 组待定项见上表，均**保留注册**，等设计决策。
