# T11 身份普查 · `src/tools/` 123 个顶层文件的定性结果

> 本表由 **6 个子代理并发**产出（只读分析），**主 agent 用机读事实 + 机械核验器复核后**汇总。

> 事实来源：`.inspect/tools_facts.json`（谁 import 它 / 按层计数 / 是否只被测试引用）

> 分片成果（未改写的原文）：`.inspect/t11_out_1..6.md`

条目：**123**


## 1. 类别分布

| 类别 | 个数 |
|---|---|
| 工具间共享 | 41 |
| 算法内核 | 33 |
| 工具实现 | 30 |
| 死代码候选 | 10 |
| 旧世代遗留 | 8 |
| 待裁决 | 1 |

## 2. 落点桶（归一化后）

| 桶 | 个数 | 明细 |
|---|---|---|
| ① 删（死代码） | 10 | `collect_functions.ts` `deprecate_offline.ts` `derive_algorithm.ts` `derive_anim_flow.ts` `derive_split.ts` `observe_chain_view.ts` `render_cluster_workbench.ts` `run_narrate.ts` `trace_reasoning.ts` `view_inputs.ts` |
| ② 下沉 application | 2 | `register_capabilities.ts` `watch_project_tool.ts` |
| ② 下沉 application/design | 19 | `brick_bag.ts` `brickify.ts` `classify_bricks.ts` `classify_tools.ts` `cluster_narrator.ts` `consistency.ts` `dag_layout.ts` `detect_drift.ts` `edge_ops.ts` `feature_ops.ts` `file_ops.ts` `node_ops.ts` `role_title.ts` `signal_review.ts` `simulation.ts` `snapshot.ts` `split_stage.ts` `status_tools.ts` `update_feature.ts` |
| ② 下沉 application/harvest | 2 | `harvest_decisions.ts` `sync_contracts.ts` |
| ② 下沉 application/meta | 6 | `cli_extract.ts` `impact_ledger_store.ts` `impact_report.ts` `overview.ts` `query_feature.ts` `semantic_search.ts` |
| ② 下沉 application/observe | 2 | `observe_trace.ts` `reconcile_chain.ts` |
| ② 下沉 application/opl | 1 | `opl.ts` |
| ② 下沉 application/refactor | 9 | `diff_views.ts` `field_refs.ts` `package_migration.ts` `protect.ts` `refactor_langs.ts` `refactor_report.ts` `rename_file.ts` `rename_local.ts` `rename_symbol.ts` |
| ② 下沉 application/render | 2 | `wizard_steps.ts` `workbench_data.ts` |
| ② 下沉 application/shared | 13 | `annotation_tools.ts` `api_ops.ts` `approval.ts` `arch_layer.ts` `derive_chain.ts` `derive_feature_tree.ts` `edit_result.ts` `explain_gen.ts` `reason_validator.ts` `taxonomy.ts` `templates.ts` `trace_evidence.ts` `write_gate.ts` |
| ② 下沉 infrastructure | 4 | `alert_inbox.ts` `dictionary.ts` `diff.ts` `export.ts` |
| ② 下沉 infrastructure/analysis | 14 | `analyze_monolith.ts` `capability_matrix.ts` `contract_gate.ts` `dead_statements.ts` `detect_dead_imports.ts` `diff_impact.ts` `feature_map.ts` `language_concepts.ts` `layer_detect.ts` `monolith.ts` `run_trace_replay.ts` `snapshot_needle.ts` `submit_gate.ts` `trace_exec.ts` |
| ② 下沉 infrastructure/cache | 1 | `health_cache.ts` |
| ② 下沉 infrastructure/edit | 1 | `fuzzy_match.ts` |
| ② 下沉 infrastructure/exec | 1 | `exec_guard.ts` |
| ② 下沉 infrastructure/git | 1 | `git.ts` |
| ② 下沉 infrastructure/graph | 1 | `guided_tour.ts` |
| ② 下沉 infrastructure/index | 4 | `function_outline.ts` `index_backfill.ts` `index_freshness.ts` `watch_project.ts` |
| ② 下沉 infrastructure/llm | 1 | `llm_focus.ts` |
| ② 下沉 infrastructure/observability | 1 | `dogfood_stats.ts` |
| ② 下沉 infrastructure/package | 1 | `npm_mod.ts` |
| ② 下沉 infrastructure/parse | 6 | `ast_parser.ts` `ast_rename.ts` `go_mod.ts` `lang_hint.ts` `registry_extract.ts` `ts_slim.ts` |
| ② 下沉 infrastructure/refactor | 1 | `rule_match.ts` |
| ② 下沉 infrastructure/render | 1 | `inject_replay.ts` |
| ② 下沉 infrastructure/shared | 1 | `verify_refactor.ts` |
| ② 下沉 infrastructure/store | 1 | `registry.ts` |
| ② 下沉 infrastructure/text | 3 | `arg_suggest.ts` `line_utils.ts` `rule_tokens.ts` |
| ② 下沉 presentation/cli | 6 | `render_anatomy.ts` `render_dep_canvas.ts` `render_mindmap.ts` `render_tools_map.ts` `render_wizard.ts` `render_workbench.ts` |
| ③ 保持 src/tools 待定 | 6 | `archify_mappers.ts` `archify_pipeline.ts` `archify_project.ts` `archify_semantics.ts` `dict_gen.ts` `get_dsl.ts` |
| ④ 其它：**删**（官方 §42 D 类 + §1275 | 1 | `batch_ops.ts` |
| ④ 其它：随 render_workbench（静态资产） | 1 | `workbench_shell_css.ts` |

## 3. ★ 机械核验：落点违反分层的（必须**先解 import 倒挂**，不能硬搬）

- `lang_hint.ts`：建议落点 **infrastructure**，但它 **import 了 presentation** ⇒ 落下去就是"下层依赖上层"。
  ⇒ 处置：**先把它依赖的那一小块抽到更底层**（同 template_compat / register_capabilities 的做法：抽到更底层的共享模块，两边都引它），再搬；或改判到 ≥ presentation。
- `sync_contracts.ts`：建议落点 **application**，但它 **import 了 presentation** ⇒ 落下去就是"下层依赖上层"。
  ⇒ 处置：**先把它依赖的那一小块抽到更底层**（同 template_compat / register_capabilities 的做法：抽到更底层的共享模块，两边都引它），再搬；或改判到 ≥ presentation。

## 4. 死代码候选（逐个判死前必须做的两件事）

1. **grep `scripts/` 有没有 `readFileSync` 读它**（文本消费看不见 —— `register_capabilities` 就是这样被差点判死的）；
2. **确认它不是"空壳 action"**（注册了但没调实现 = 对 agent 说谎，属 G7 门的地盘，处置是"补实现或删声明"，不是单纯删文件）。

- `batch_ops.ts`（高）— 批量节点操作：batch_move_nodes / batch_update_style / batch_delete_nodes ｜ 建议：**删**（官方 §42 D 类 + §1275「真残留⇒可删」）
- `derive_algorithm.ts`（中）— 函数体 → 算法控制流图（CFG）的 detail 层生成（与 derive_chain 互补：函数内 vs 函数间） ｜ 建议：删函数体，`KIND_SHAPE` 迁入 derive_chain
- `derive_anim_flow.ts`（高）— 把调用链+CFG 自动转成 `animations_v2.flows`（L3 分支/L4 函数绑定的生成层） ｜ 建议：删（或确认是暂未接线的 WIP）
- `get_dsl.ts`（中）— 旧的 get_dsl 独立工具实现：读已保存 DSL JSON 返回 ｜ 建议：**删**（已被 `tools/query_feature.ts` 合并，见下"值得单独说的"）
- `observe_chain_view.ts`（中）— 链路契约 + chain-broken 偏差的自包含 HTML 渲染（纯渲染） ｜ 建议：删 / 接入 application/observe（reconcile_chain 视图）前保持待定
- `refactor_report.ts`（中）— runRefactorPipeline 结果的机器可读报表物化（buildRefactorReport/writeRefactorReport） ｜ 建议：并入 application/refactor（若接入 CLI/dogfood）否则删
- `render_cluster_workbench.ts`（中）— 簇级协作工作台 HTML（簇节点卡+真实依赖边+人话叙事+点击详情） ｜ 建议：删 / 合并进 render_dep_canvas（见"值得单独说的"第 1 条）
- `run_narrate.ts`（高）— 环节旁白解析器：把现成函数注释加工成"这一步做了什么"的人话 ｜ 建议：删
- `trace_reasoning.ts`（中）— 零接触自动插桩记录器：自动发现调用链→包装→真跑→产出 reasoning DSL ｜ 建议：删；删前先把 `TraceRecord` 类型迁出（trace_evidence 依赖它）
- `view_inputs.ts`（中）— 5 种图（architecture/workflow/sequence/dataflow/lifecycle）的中性"渲染输入"结构 ｜ 建议：删（archify 族：仅测试引用）

## 5. 待裁决 / 低置信（需人定，不照单执行）

- `dict_gen.ts`（待裁决·低）— 伪维基词典的 LLM 后端：classifyTerm(通用/专有) + generateDictEntry(三档解释) ｜ 谁在用：{presentation:1, tests:1}；唯一生产消费者 `presentation/http/serve.ts` ｜ 建议：见下「判不了的」

## 6. 全表（123 行，按类别分组）


### 工具间共享（41）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `alert_inbox.ts` | 全局未读影响提醒收件箱 + daemon 游标日志（push/take/alertsSince/appendPendingAlerts），供工具响应 piggyback 注入 | tools:1 infrastructure:1 application:1 presentation:2 tests:6；关键：`infrastructure/daemon/dispatch`、`application/refactor/refactor_judge`、`presentation/daemon/*`、`tools/watch_project_tool` | ② 下沉 infrastructure | 高 |
| `annotation_tools.ts` | 人审标注操作：list_annotations / resolve_annotation / add_annotation（读写 DSL annotations） | tools:2；`tools/query_feature`、`tools/update_feature`（get_dsl / edit_dsl 的 [B]） | ② 下沉 application/shared | 中 |
| `api_ops.ts` | 预期 API 操作：add/update/delete_expected_api + set_node_semantic（读写 semantic.files） | tools:1 tests:1；仅 `tools/update_feature`（edit_dsl 的 [B]）生产消费 | ② 下沉 application/shared | 中 |
| `approval.ts` | 人审/审批工作流：submit_approval / review_annotation / list_approvals / get_approval_history | tools:2；`tools/query_feature`、`tools/update_feature` | ② 下沉 application/shared | 中 |
| `arch_layer.ts` | 架构分层分析（启发式定层 + 层间违规/引用矩阵，带 health 缓存，可选写回 DSL） | application:1 presentation:1 tests:1；`application/meta/explore_code`、`presentation/http/serve` | ② 下沉 application/shared | 中 |
| `brick_bag.ts` | BrickBag 投影组装：feature_map → 积木集合（积木间 similar/call peers），不重造解析 | application:1 tools:1；`application/design/render_brickwork`（在册 MCP 工具）、`tools/brickify` | ② 下沉 application/design | 高 |
| `brickify.ts` | 依赖驱动积木化管线（文件级依赖边→混合文件信号→功能社区聚类，全链路） | application:1 presentation:2 tools:12 tests:6（共 21）；`application/design/render_brickwork`、`presentation/cli/brickify_cli`、`signal_review_cli` + 12 个 render/classify 工具 | ② 下沉 application/design | 高 |
| `classify_bricks.ts` | 分类官：把功能簇归入软件解剖学槽位（LLM 主路径 + 关键词规则降级） | presentation:1 tools:3 tests:1；`presentation/cli/brickify_cli`（真消费）+ render_workbench/anatomy/workbench_data(**仅 type**) | ② 下沉 application/design | 中 |
| `classify_tools.ts` | 工具标注官：给功能条目打 domain/tier/slot/kind 四维标签（LLM + 规则降级） | presentation:1 tools:1 tests:1；`presentation/cli/brickify_cli`（真消费）+ render_tools_map(**仅 type**) | ② 下沉 application/design | 中 |
| `cli_extract.ts` | CLI 入口提取器：扫 `*_cli.ts`，抽 name/desc/usage + 相对 import 连线（纯确定性） | presentation:1 tools:1；`presentation/cli/brickify_cli`（真消费）+ `tools/collect_functions`(**仅 type**) | ② 下沉 application/meta | 中 |
| `cluster_narrator.ts` | 簇级人话翻译层：LLM 把「一伙文件干什么」译成人话（白名单校验 + 规则降级） | presentation:1 tools:6 tests:1；`presentation/cli/brickify_cli`（真消费）+ 6 个 render/workbench 工具(**仅 type**) | ② 下沉 application/design | 中 |
| `derive_chain.ts` | 函数调用链引擎：TreeSitter 骨架+文本调用图 → detail 层节点/边；另导出 buildCallGraph/walkChain/pickEntry | {application:1, presentation:1, tools:3, tests:2}；`application/meta/explore_code.ts`、`presentation/http/serve.ts`、`tools/reconcile_chain.ts`、`tools/trace_reasoning.ts`、`tools/derive_anim_flow.ts` | ② 下沉 application/shared | 中 |
| `derive_feature_tree.ts` | 项目→功能→社区→文件 的功能树生成（社区二次归并，可选 LLM 命名） | {infrastructure:1, tools:1}；`infrastructure/graph/import_project.ts`、`tools/overview.ts` | ② 下沉 application/shared | 中 |
| `edit_result.ts` | edit 操作统一返回类型 `EditResult` | {tools:7}；`api_ops/batch_ops/edge_ops/feature_ops/file_ops/node_ops/update_feature.ts` | ② 下沉 application/shared | 高 |
| `exec_guard.ts` | 外部命令可用性守卫：先 fs 查 PATH、存在才 spawn 一次 `--version` 复核，结果每进程记忆化（防"缺 git 时 spawn 白等 ~5s"） | byLayer tools:1 application:2 tests:1；关键 importer：`tools/harvest_decisions.ts`、`application/harvest/harvest_from_url.ts`、`application/cross/project_root.ts` | ② 下沉 infrastructure/exec | 高 |
| `explain_gen.ts` | 讲解导览的角色化 LLM 文案后端：配 DeepSeek/Agnes（`loadExplainConfig`）+ 抽 JSON（`extractJsonObject`）+ 生成三档文案并落盘 | byLayer tools:8 application:1 presentation:1 tests:1；关键：`tools/{role_title,cluster_narrator,classify_bricks,classify_tools,derive_feature_tree,dict_gen,overview,signal_review}.ts`、`application/meta/derive_mind_map.ts`、`presentation/http/serve.ts` | ② 下沉 application/shared | 中 |
| `git.ts` | 闭环 git 封装：基线快照/精确提交（只 add 补丁文件）/回退（checkout） | byLayer presentation:2；关键：`presentation/cli/diagnose_loop_cli.ts:40`、`presentation/cli/upgrade_rewrite_cli.ts:27` | ② 下沉 infrastructure/git | 高 |
| `health_cache.ts` | 体检缓存：`(rel,size,mtime)` 指纹 + 带 key 的缓存读写（失败静默降级） | byLayer tools:2；关键：`tools/arch_layer.ts:31`、`tools/monolith.ts:26` | ② 下沉 infrastructure/cache | 高 |
| `index_backfill.ts` | 索引后台续建：前台建块后分小批可中断地补齐全项目（单飞锁/setTimeout 让出事件循环） | byLayer tools:2 application:2 presentation:1 tests:4；关键：`tools/watch_project.ts:37`、`tools/write_gate.ts:57`、`presentation/mcp/server_registry.ts:23`、`application/meta/{explore_code,index_integrity}.ts` | ② 下沉 infrastructure/index | 中 |
| `index_freshness.ts` | 索引自动保鲜 + 冷启 bootstrap + 拼图式局部建块（种子 BFS + 文本反查入边 + 预算/时长上限），诚实标 state | byLayer application:5 infrastructure:1 presentation:1 tools:3 tests:4；关键：`application/refactor/find_references.ts`、`application/meta/{explore_code,index_integrity}.ts`、`application/observe/index.ts`、`application/harvest/index.ts`、`infrastructure/analysis/diagnosis/diagnose.ts`、`tools/{watch_project,semantic_search,index_backfill}.ts` | ② 下沉 infrastructure/index | 中 |
| `llm_focus.ts` | LLM 配置解析 + `callChat` 调用 + `pickKeyNodes` 关键节点选择 | importers 20：tools:10, application:5, infrastructure:3, presentation:1, tests:1（`application/meta/{llm_decider,derive_mind_map}.ts`、`infrastructure/analysis/diagnosis/repair.ts`、多处 tools） | ② 下沉 infrastructure/llm | 中 |
| `monolith.ts` | check_monolith 单文件体检 + 拆分建议；同时对外提供 `countLines/assessLines/buildSplitPreviewDsl` 共享 | byLayer application:1, infrastructure:1, presentation:1, tests:1；`application/meta/explore_code.ts`(action=check_monolith)、`infrastructure/graph/import_project.ts`、`presentation/http/serve.ts` | ② 下沉 infrastructure/analysis | 中 |
| `protect.ts` | rename 套件的"冻结行"保护（loadRenameProtect/createProtectGuard） | byLayer application:1, tools:2, tests:1；`tools/rename_symbol.ts`、`tools/rename_file.ts`、`application/refactor/rename_symbols.ts` | ② 下沉 application/refactor | 高 |
| `reason_validator.ts` | 变更原因"四层抗偷懒"校验（纯函数，无 import） | byLayer application:1, presentation:1, tools:1, tests:1；`application/handlers.ts`、`presentation/mcp/server_registry.ts`、`tools/trace_evidence.ts` | ② 下沉 application/shared | 中 |
| `refactor_langs.ts` | 多语言重构执行器契约 + 注册表 + 目录语言命中探测 | byLayer application:1, infrastructure:2, tools:2, tests:2；`application/refactor/refactor_pipeline.ts`、`infrastructure/analysis/java_refactor/{layering,executor}.ts`、`tools/package_migration.ts`、`tools/python_refactor/index.ts` | ② 下沉 application/refactor | 中 |
| `register_capabilities.ts` | 能力矩阵的默认登记（side-effect `declareCapability`，exportCount=0） | byLayer **presentation:1（facts 漏计）**, tests:1；生产 importer=`presentation/cli/capability_cli.ts:25` 的 bare `import './register_capabilities.js'` | ② 下沉 application | 中 |
| `registry.ts` | 产物注册表（`<dataHome>/output/.registry.json` 的增删查） | byLayer presentation:2；`presentation/http/serve.ts`(readRegistry/updateArtifact)、`presentation/cli/brickify_cli.ts`(registerArtifact) | ② 下沉 infrastructure/store | 中 |
| `rename_file.ts` | 文件级安全改名：算影响面→迁移文件→改写全项目 import→重索引 | byLayer application:2 (application/design/code_workbench.ts, application/refactor/rename_files.ts) tools:1 (tools/rename_symbol.ts) tests:1；跨 design+refactor 两线 | ② 下沉 application/refactor | 高 |
| `rename_symbol.ts` | 跨文件模块级符号改名引擎；并导出 analyzeModuleSource/resolveRel/expandClosure 供多线复用 | byLayer application:4 (cross/project_root, refactor/find_references, refactor/rename_symbols, refactor/symbol_move) tests:3；跨 cross+refactor 两线 | ② 下沉 application/refactor | 高 |
| `semantic_search.ts` | 全项目符号语义搜索（bge-m3 向量 top-k，失败降级 FTS trigram） | byLayer application:1 (meta/explore_code) presentation:1 (presentation/http/serve.ts) tests:2 | ② 下沉 application/meta | 高 |
| `signal_review.ts` | 混合文件信号的 LLM 复核（逐簇判"采纳/驳回"，三判据） | byLayer presentation:1 (cli/signal_review_cli) tools:1 (tools/split_stage.ts) tests:1 | ② 下沉 application/design | 中 |
| `simulation.ts` | 仿真器适配：按 feature 取 DSL → SimulationEngine（带进程内引擎缓存） | byLayer application:1 (meta/explore_code) tools:2 (query_feature, update_feature) | ② 下沉 application/design | 中 |
| `snapshot.ts` | DSL 版本快照：存/列/回滚/自动快照/裁剪（.agent-io/snapshots） | byLayer presentation:1 (http/serve.ts) tools:2 (query_feature, update_feature) tests:2 | ② 下沉 application/design | 中 |
| `taxonomy.ts` | 软件解剖学分类法（7 槽位 pipeline-v1）——纯定义 + `slotIndex` | byLayer tools:2（classify_bricks.ts、classify_tools.ts）+ tests:1 | ② 下沉 application/shared | 中 |
| `templates.ts` | 预置架构模板库（crud/event_driven/microservice/pipeline）+ `list_templates`/`create_from_template` | byLayer application:1（design/manage_feature.ts→createFromTemplate）+ tools:1（query_feature.ts→listTemplates） | ② 下沉 application/shared | 中 |
| `trace_evidence.ts` | L4 证据回溯的"真实可复算"校验引擎：从真实 trace 复算验证证据 | byLayer application:1(handlers.ts) + presentation:1(server_registry.ts) + tests:1；服务 edit_dsl 的 L4 resolver | ② 下沉 application/shared | 中 |
| `verify_refactor.ts` | 改前/改后验证闭环：baseline→apply→after，回归则回滚；纯命令化 | byLayer application:2 + **infrastructure:5**（version_upgrade/adapters/{types,node,csharp,c}、java_refactor/executor）+ presentation:1(upgrade_rewrite_cli) + tools:4 + tests:2 | ② 下沉 infrastructure/shared | 高 |
| `wizard_steps.ts` | 新功能向导七步定义（积木→契约→胶水），每步绑定真实工具名 | byLayer tools:1（render_wizard.ts→wizardSteps/ROLE_LABEL） | ② 下沉 application/render | 中 |
| `workbench_data.ts` | DSL 协作工作台的数据契约层（WorkbenchData 定义 + buildWorkbenchData + 落盘） | byLayer presentation:1(cli/brickify_cli.ts) + tools:1(render_workbench.ts) | ② 下沉 application/render | 中 |
| `workbench_shell_css.ts` | mock 工作台壳的 CSS 原样快照（`WORKBENCH_SHELL_CSS` 常量） | byLayer tools:1（render_workbench.ts） | ④ 其它：随 render_workbench（静态资产） | 中 |
| `write_gate.ts` | 统一写入闸：快照→真写→索引写穿，保证"读到的索引绝不撒谎" | byLayer **application:8**（refactor/edit_code、apply_writes、rename_symbols、symbol_move、remove_dead_imports、refactor_pipeline、scaffold、meta/index_integrity）+ presentation:1(server_registry) + tools:3 + tests:5 | ② 下沉 application/shared | 高 |

### 算法内核（33）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `analyze_monolith.ts` | 读 cache.db 调用边，用锚点+标签传播做跨文件【功能社区】圈定（Louvain 式），纯分析 | infrastructure:1 tools:1 tests:1；关键：`infrastructure/graph/import_project`（function 模式的动态 import）、`tools/derive_feature_tree` | ② 下沉 infrastructure/analysis | 高 |
| `arg_suggest.ts` | 参数纠错「Did you mean?」：自实现 Levenshtein + 未知参数提示渲染 | presentation:1 tests:1；仅 `presentation/mcp/server_registry`（分发中间件） | ② 下沉 infrastructure/text | 中 |
| `ast_parser.ts` | 【兼容层】把 `infrastructure/parse` 的 async 接口包成旧 sync 形态（isSupportedFile/parseFileSymbols） | application:1 tools:1；`application/design/backfill`、`tools/consistency` | ② 下沉 infrastructure/parse | 高 |
| `ast_rename.ts` | 作用域感知的局部变量重命名引擎（名字绑定解析，**只算不写**，无文件 IO） | application:2 presentation:1 tools:1 tests:2；`application/refactor/ast_suggest`、`similar_names`、`presentation/mcp/server_registry`、`tools/rename_local` | ② 下沉 infrastructure/parse | 高 |
| `capability_matrix.ts` | 「功能 × 语言 × 支持度」能力矩阵：契约声明 + 缺口自检（纯数据+纯函数，零 IO） | presentation:1 tools:2 tests:2；`presentation/cli/capability_cli`、`tools/lang_hint`、`tools/register_capabilities` | ② 下沉 infrastructure/analysis | 中 |
| `contract_gate.ts` | 契约对账闸门：扫描改动文件的 `X.` 裸标识符有无定义来源，产出契约失配清单 | {application:1, tests:1}；`application/refactor/refactor_pipeline.ts` | ② 下沉 infrastructure/analysis | 中 |
| `dead_statements.ts` | 语句级死代码检测 + 保守删除（块内终止语句后的不可达兄弟语句） | {application:1, tests:1}；`application/refactor/refactor_pipeline.ts` | ② 下沉 infrastructure/analysis | 中 |
| `detect_dead_imports.ts` | 文件级死 import 检测（剥离 import 语句后本地绑定零出现即死） | {application:2, tools:4, tests:1}；`application/refactor/{function_annotation,refactor_pipeline}.ts`、`tools/{brickify,brick_bag,deprecate_offline,feature_map}.ts` | ② 下沉 infrastructure/analysis | 高 |
| `dictionary.ts` | 双层术语词典数据层（全局 dict.global.json / 项目 dict.project.json + 互链高亮） | {presentation:1, tools:1, tests:2}；`presentation/http/serve.ts`、`tools/dict_gen.ts` | ② 下沉 infrastructure | 中 |
| `diff.ts` | 对比两个 feature 的 DSL 差异（`diff_features` 动作） | {tools:1, tests:1}；`tools/query_feature.ts` | ② 下沉 infrastructure | 中 |
| `diff_impact.ts` | 变更影响分析：沿 call/type_ref/import 三类边做反向可达闭包 | {application:1, infrastructure:1, presentation:1, tools:2, tests:3}；`application/meta/explore_code.ts`、`infrastructure/analysis/diagnosis/impact_analyzer.ts`、`tools/impact_report.ts`、`tools/watch_project_tool.ts` | ② 下沉 infrastructure/analysis | 中 |
| `dogfood_stats.ts` | 工具调用使用统计：server_registry 每次调用落 JSONL，并聚合渲染；另含 `npm run dogfood` CLI 入口 | {presentation:1, tests:1}；`presentation/mcp/server_registry.ts`（recordDogfoodUsage） | ② 下沉 infrastructure/observability | 中 |
| `feature_map.ts` | 可视化地基：文件结构→功能→前端/后端→相似功能→废弃证据的确定性聚合（复用 layer_detect / detect_dead_imports） | byLayer tools:2 application:1 tests:1；关键：`application/design/render_brickwork.ts`、`tools/brick_bag.ts`、`tools/brickify.ts` | ② 下沉 infrastructure/analysis | 中 |
| `field_refs.ts` | find_references 的 field/type 结构引用引擎：tree-sitter AST 分类读取/构造/解构/声明点，跳注释与字符串 | byLayer application:1；关键：`application/refactor/find_references.ts:25` | ② 下沉 application/refactor | 中 |
| `function_outline.ts` | 函数级大纲：从 cache.db/import_cache 汇聚"目录→文件→函数"+调用/被调用/递归，并 join DSL feature 与源码注释（只读投影） | byLayer tools:1 application:1 presentation:1 tests:2；关键：`tools/query_feature.ts:47`、`application/observe/feature_line.ts:11`、`presentation/http/serve.ts:49` | ② 下沉 infrastructure/index | 中 |
| `fuzzy_match.ts` | replace_text 的 4 级降级文本定位（exact→空白归一→缩进弹性→省略号占位），歧义即停 | byLayer application:2；关键：`application/refactor/edit_code.ts:53`、`application/refactor/refactor_plan.ts:34` | ② 下沉 infrastructure/edit | 高 |
| `go_mod.ts` | go.mod `require` 解析 + 闭包三方依赖归并（最长前缀对齐）+ 近似 MVS 版本比较（纯函数） | byLayer application:3 tests:1；关键：`application/harvest/harvest_from_url.ts:34`、`application/harvest/slim_brick.ts:36`、`application/harvest/assemble_bricks.ts:48` | ② 下沉 infrastructure/parse | 高 |
| `guided_tour.ts` | Guided Tours：按依赖边 Kahn 拓扑排序产出线性学习路径（跳过 contains 边），只读不写 DSL | byLayer tools:1 application:1 presentation:1 tests:1；关键：`application/meta/explore_code.ts:24`（action='guided_tour'）、`tools/overview.ts:21`、`presentation/http/serve.ts:38` | ② 下沉 infrastructure/graph | 中 |
| `inject_replay.ts` | D3 注入回放：静态推演一次 flow（注入值→异常分类→分支求值→形状质检），不跑真实代码、不改 DSL | byLayer application:1 tests:1；关键：`application/meta/explore_code.ts:26`（action='inject_replay'） | ② 下沉 infrastructure/render | 中 |
| `lang_hint.ts` | "缺失语言/能力"的可执行提示（一句四要件：缺什么/装什么包/照哪份清单/缺口数），纯函数零副作用 | byLayer infrastructure:3 tools:2 application:1 tests:1；关键：`infrastructure/parse/kernel.ts:28`、`infrastructure/analysis/behavior/index.ts:37`、`infrastructure/analysis/version_upgrade/adapters/registry.ts:15`、`application/refactor/parse_capability.ts:23`、`tools/{rename_symbol,contract_gate}.ts` | ② 下沉 infrastructure/parse | 中 |
| `language_concepts.ts` | 语言级编程模式识别（泛型/闭包/装饰器…）——纯启发式读 cache.db nodes，只读、不改 DSL | byLayer presentation:1, tests:1；关键 importer `presentation/http/serve.ts`（`languageConcepts`） | ② 下沉 infrastructure/analysis | 高 |
| `layer_detect.ts` | 启发式架构分层 + 层间违规检测（纯函数，入 DSL 出加工副本） | byLayer application:1, infrastructure:1, tools:3, tests:1；`application/meta/explore_code.ts`、`infrastructure/graph/import_project.ts`、`tools/{arch_layer,feature_map,brickify}.ts` | ② 下沉 infrastructure/analysis | 高 |
| `line_utils.ts` | 行分割/行尾/EOL 的"单一基准"（splitKeepEnds/detectEol/isBlankLine），零依赖 | byLayer application:4（`application/refactor/{edit_code,symbol_move,refactor_plan}.ts`、`application/meta/explore_code.ts`） | ② 下沉 infrastructure/text | 高 |
| `npm_mod.ts` | package.json 依赖存档 + 三方依赖归并（纯函数，零 I/O） | byLayer application:3, tests:1；`application/harvest/{harvest_from_url,assemble_bricks,slim_brick}.ts` | ② 下沉 infrastructure/package | 中 |
| `package_migration.ts` | 包改名/提级的纯计算计划（computeMigrationPlan，绝不落盘） | byLayer application:1, tests:1；唯一 importer `application/refactor/refactor_pipeline.ts` | ② 下沉 application/refactor | 中 |
| `registry_extract.ts` | MCP 工具注册表提取器（解析 server_registry 的 TOOL_DEFS，零 LLM） | byLayer presentation:1, tools:1, tests:1；`presentation/cli/brickify_cli.ts`、`tools/collect_functions.ts` | ② 下沉 infrastructure/parse | 中 |
| `rule_match.ts` | `$hole` 元变量 + 模糊级联的规则匹配器（块级粗筛+窗口精配，纯 AST/token 匹配） | byLayer application:2 (refactor/rule_apply, refactor/rule_extract) tests:1 | ② 下沉 infrastructure/refactor | 高 |
| `rule_tokens.ts` | 行/token 文本小工具（splitLines/fold/leadingWs/keyedLines） | byLayer application:2 (rule_apply, rule_extract) tools:1 (rule_match) | ② 下沉 infrastructure/text | 高 |
| `run_trace_replay.ts` | 录制帧（runs.jsonl）→ 按 trace_id/parent_id 重建调用树 RunTrace[]（纯解析） | byLayer tools:2 (tools/observe_trace.ts, tools/snapshot_needle.ts) tests:2 | ② 下沉 infrastructure/analysis | 高 |
| `snapshot_needle.ts` | "一整针"世界快照采样器：对 RunTrace 做代表性判定，命中整针保留/否则整针丢 | byLayer tools:1 (tools/observe_trace.ts) tests:1 | ② 下沉 infrastructure/analysis | 中 |
| `submit_gate.ts` | 提交层完整性自检：扫 `//go:embed` 声明，查产物是否在盘/是否已进 git 索引（防"新克隆即坏"） | byLayer application:1；importer = application/refactor/refactor_pipeline.ts | ② 下沉 infrastructure/analysis | 高 |
| `trace_exec.ts` | 真实执行引擎：喂真实输入让链上函数真跑（TS/Python/Go），出真实输出 | byLayer presentation:1(presentation/http/serve.ts) + tests:2 | ② 下沉 infrastructure/analysis | 中 |
| `watch_project.ts` | 项目文件实时监听增量同步到 cache.db：watchProject + flushBatch + reconcileProject | byLayer presentation:1(serve.ts) + tools:1(watch_project_tool.ts) + tests:1 | ② 下沉 infrastructure/index | 中 |

### 工具实现（30）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `consistency.ts` | `consistency_check` 工具引擎：DSL expected_apis vs 实际代码签名的一致性检查 | {application:1, presentation:2, tools:1, tests:2}；`application/handlers.ts`(consistencyHandler)、`presentation/mcp/server_registry.ts`、`presentation/http/serve.ts`、`tools/detect_drift.ts` | ② 下沉 application/design | 高 |
| `dag_layout.ts` | `edit_dsl` 的 layout 动作实现：DAG 拓扑/力导向/网格对齐三种布局写回 DSL | {presentation:1, tools:1}；`tools/update_feature.ts`、`presentation/http/serve.ts` | ② 下沉 application/design | 中 |
| `detect_drift.ts` | `detect_drift` 工具：复用 checkConsistency + git 变更作用域 + 漂移台账 | {application:1, presentation:1, tools:1, tests:1}；`application/handlers.ts`(detectDriftHandler)、`presentation/mcp/server_registry.ts`、`tools/watch_project_tool.ts` | ② 下沉 application/design | 高 |
| `diff_views.ts` | `diff_views` 工具：design/live/baseline 三视图 DSL 双栏 + 三方对比 | {application:1, presentation:2, tools:1, tests:4}；`application/handlers.ts`(diffViewsHandler)、`presentation/mcp/server_registry.ts`、`presentation/http/serve.ts`、`tools/watch_project_tool.ts` | ② 下沉 application/refactor | 高 |
| `edge_ops.ts` | `edit_dsl` 的边操作子模块：add_edge / delete_edge | {tools:1, tests:1}；`tools/update_feature.ts` | ② 下沉 application/design | 中 |
| `export.ts` | `export_svg` / `export_markdown`：DSL→独立 SVG 文件 / Markdown 设计文档（现作为 `render_design` 的 `format=svg\ | markdown` 被调用） | ② 下沉 infrastructure | 并入 `application/design`（render 线） |
| `feature_ops.ts` | `create_feature` / `clone_feature` 两个 DSL feature 级动作的实现（manage_feature 聚合工具的动作子模块，非独立 ToolDef） | byLayer application:1 tests:9；关键：`application/design/manage_feature.ts:8` | ② 下沉 application/design | 中 |
| `file_ops.ts` | `add_file` / `update_file` / `delete_file` 三个语义文件动作的实现（update_feature 工具的动作子模块，非独立 ToolDef） | byLayer tools:1 tests:4；关键：`tools/update_feature.ts:21` | ② 下沉 application/design | 中 |
| `harvest_decisions.ts` | `harvest_decisions` 工具实现：从 docs/git log/注释提取设计意图线索，产出 draft 决策卡候选（不写 DSL） | byLayer application:1 presentation:1 tests:1；关键：`application/handlers.ts:31/287`、`presentation/mcp/server_registry.ts:46`；**ToolDef 直指**：`application/harvest/index.ts:46 name='harvest_decisions'` | ② 下沉 application/harvest | 高 |
| `impact_ledger_store.ts` | Impact Ledger 持久化：declare 落盘（pending→ok/violated→resolved/expired）+ TTL/裁剪 + resolve 过门 | byLayer tools:1 tests:1；关键：`tools/watch_project_tool.ts:26`（watch 工具 declare/ledger/resolve action 的实现，非独立 ToolDef） | ② 下沉 application/meta | 中 |
| `impact_report.ts` | 变更影响报告：runImpactReport（跑 diffImpact→落盘 rp-<seq>.json→返回一行摘要）/按序号读/列最近 N | byLayer tools:1 tests:2；关键：`tools/watch_project_tool.ts:24`（watch 工具 action='impact' 的实现，非独立 ToolDef） | ② 下沉 application/meta | 中 |
| `node_ops.ts` | edit_dsl 的节点增删改实现（addNode/updateNode/deleteNode） | byLayer tools:1, tests:7；唯一生产 importer `tools/update_feature.ts`（= edit_dsl handler 的实现体） | ② 下沉 application/design | 中 |
| `observe_trace.ts` | observe_trace 工具：从录制事件(JSONL)重建结构化调用树 | byLayer application:1, presentation:1, tests:1；`application/handlers.ts`(observeTraceHandler)、`presentation/mcp/server_registry.ts` | ② 下沉 application/observe | 高 |
| `opl.ts` | OPL 自驱闭环流水线（人提愿望→下探→改码→对账→接图）；**HTTP-HUB 能力，非 MCP ToolDef** | byLayer presentation:1；唯一 importer `presentation/http/serve.ts`（oplAdd/oplAuto…） | ② 下沉 application/opl | 中 |
| `overview.ts` | overview 小白视图数据组装（summary + mind_map + first_steps）；**HTTP-HUB 能力，非 MCP ToolDef** | byLayer presentation:1；唯一 importer `presentation/http/serve.ts`（`getOverview`） | ② 下沉 application/meta | 中 |
| `query_feature.ts` | get_dsl 工具：统一读操作入口（合并原 9 个查询工具） | byLayer application:1, presentation:1, tests:3；`application/handlers.ts`(getDslHandler=wrapData(queryFeature))、`presentation/mcp/server_registry.ts` | ② 下沉 application/meta | 高 |
| `reconcile_chain.ts` | reconcile_chain 工具：按单条链"真跑+查数据+对账" | byLayer application:1, presentation:2, tests:1；`application/handlers.ts`(reconcileChainHandler)、`presentation/mcp/server_registry.ts`、`presentation/http/serve.ts` | ② 下沉 application/observe | 高 |
| `rename_local.ts` | `rename_symbols` 的 scope=local 分支：文件内局部作用域批量改名（复用 ast_rename） | byLayer application:1 (application/refactor/rename_symbols.ts) tests:1 | ② 下沉 application/refactor | 中 |
| `render_anatomy.ts` | 泳道解剖视图 HTML（槽位→积木→簇→文件 四级下钻） | byLayer presentation:1 (presentation/cli/brickify_cli.ts --anatomy) tests:1 (classify_bricks.test) | ② 下沉 presentation/cli | 中 |
| `render_dep_canvas.ts` | 依赖图画布 HTML：SCC 缩点+最长路径分层（layoutCanvas）+程序生成贝塞尔+小地图/缩放 | byLayer presentation:1 (brickify_cli --sandbox) tests:1 (render_dep_canvas.test) | ② 下沉 presentation/cli | 中 |
| `render_mindmap.ts` | 分层导图 HTML：项目→社区→积木→小簇→文件 五层可展开树 | byLayer presentation:1 (brickify_cli --mindmap) | ② 下沉 presentation/cli | 中 |
| `render_tools_map.ts` | 功能中心多维地图 HTML（能力域/分级/槽位/入口形态 四维切换） | byLayer presentation:1 (brickify_cli --tools-map) tests:1 | ② 下沉 presentation/cli | 中 |
| `render_wizard.ts` | 新功能向导前端 HTML（七步 stepper+节点画布+模拟运行） | byLayer presentation:1 (brickify_cli --wizard) | ② 下沉 presentation/cli | 中 |
| `render_workbench.ts` | 契约投影工作台渲染层：WorkbenchData → 壳 HTML（二期分层版） | byLayer presentation:1 (brickify_cli --dsl-workbench) | ② 下沉 presentation/cli | 中 |
| `role_title.ts` | 用 LLM 为每个源文件批量生成一句中文职责摘要（import_project 的节点标题） | byLayer infrastructure:1 (infrastructure/graph/import_project.ts) tests:1 | ② 下沉 application/design | 中 |
| `split_stage.ts` | 拆分执行器：把 signal_review 采纳的簇 → derive_split 执行拆（编译/测试验收+回滚） | byLayer presentation:1 (cli/split_stage_cli) tests:1 | ② 下沉 application/design | 中 |
| `status_tools.ts` | edit_dsl 的 `status` 操作实现：`update_status` 手动改节点/文件状态 + `check_status` 扫 TODO 残留推断状态 | byLayer tools:1；唯 importer = update_feature.ts（调 updateStatus）。**checkStatus 全仓无人调用** | ② 下沉 application/design | 中 |
| `sync_contracts.ts` | 以 server_registry 的 zod schema 为唯一源，回填 DSL `expected_apis` | byLayer application:1(handlers.ts) + presentation:1(server_registry.ts) + tests:1；已注册工具名 `sync_contracts`（harvest 线） | ② 下沉 application/harvest | 高 |
| `update_feature.ts` | edit_dsl 的主实现：16 个写操作聚合为 operations 批量提交 + 失败整体回滚 | byLayer application:1(handlers.ts editDslHandler) + presentation:2(mcp/server_registry.ts、daemon/daemon.ts) + tests:1 | ② 下沉 application/design | 高 |
| `watch_project_tool.ts` | watch_project MCP 工具：常驻监听 + rebuild/drift/impact + Impact Ledger（declare/ledger） | byLayer infrastructure:1(daemon/dispatch.ts) + presentation:3(mcp/server.ts、daemon/daemon.ts、http/serve.ts) + tests:5 | ② 下沉 application | 高 |

### 死代码候选（10）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `batch_ops.ts` | 批量节点操作：batch_move_nodes / batch_update_style / batch_delete_nodes | tests:1（testOnly）；**无任何生产 importer** | ④ 其它：**删**（官方 §42 D 类 + §1275 | 高 |
| `derive_algorithm.ts` | 函数体 → 算法控制流图（CFG）的 detail 层生成（与 derive_chain 互补：函数内 vs 函数间） | {tools:1, tests:1}；`tools/derive_chain.ts`（**仅** `KIND_SHAPE` 常量）、`tests/tools/derive_algorithm.test.ts`。主函数 `deriveAlgorithm` 生产环境零调用 | ① 删（死代码） | 中 |
| `derive_anim_flow.ts` | 把调用链+CFG 自动转成 `animations_v2.flows`（L3 分支/L4 函数绑定的生成层） | {tests:1}，`testOnly=true`，仅 `tests/tools/derive_anim_flow.test.ts` | ① 删（死代码） | 高 |
| `get_dsl.ts` | 旧的 get_dsl 独立工具实现：读已保存 DSL JSON 返回 | byLayer **tests:1（testOnly，无生产 importer）** | ③ 保持 src/tools 待定 | 中 |
| `observe_chain_view.ts` | 链路契约 + chain-broken 偏差的自包含 HTML 渲染（纯渲染） | byLayer tests:1；**无生产 importer**，仅 `tests/tools/observe_chain_view.test.ts` | ① 删（死代码） | 中 |
| `refactor_report.ts` | runRefactorPipeline 结果的机器可读报表物化（buildRefactorReport/writeRefactorReport） | byLayer tests:1；**无生产 importer**，仅测试 | ② 下沉 application/refactor | 中 |
| `render_cluster_workbench.ts` | 簇级协作工作台 HTML（簇节点卡+真实依赖边+人话叙事+点击详情） | byLayer presentation:1 (brickify_cli --workbench) tests:1 (cluster_narrator.test 调 clusterEdgesOf) | ① 删（死代码） | 中 |
| `run_narrate.ts` | 环节旁白解析器：把现成函数注释加工成"这一步做了什么"的人话 | byLayer tests:1，testOnly=true，**生产代码零引用**（§42 D 名单已列） | ① 删（死代码） | 高 |
| `trace_reasoning.ts` | 零接触自动插桩记录器：自动发现调用链→包装→真跑→产出 reasoning DSL | byLayer tools:1（trace_evidence 仅 import **type** `TraceRecord`）+ tests:2；**函数 `traceReasoning` 无任何生产调用方/无 ToolDef 注册** | ① 删（死代码） | 中 |
| `view_inputs.ts` | 5 种图（architecture/workflow/sequence/dataflow/lifecycle）的中性"渲染输入"结构 | byLayer tests:1，**testOnly=true，无生产消费者**；属 archify_* 渲染族 | ① 删（死代码） | 中 |

### 旧世代遗留（8）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `archify_mappers.ts` | 把 SemanticSurface 映射成 5 类图的官方 candidate（architecture/workflow/sequence/dataflow/lifecycle） | tools:1 tests:1；仅 `tools/archify_pipeline` + archify 测试 | ③ 保持 src/tools 待定 | 高 |
| `archify_pipeline.ts` | R5 渲染编排：deriveSemantics → 5 mapper → 官方 validate/deliver → manifest | presentation:1 tests:1；`presentation/http/serve` 的 `/api/archify-demo` + archify 测试 | ③ 保持 src/tools 待定 | 高 |
| `archify_project.ts` | 编辑 IR 树 ↔ Archify 数据层契约的适配 + 角色/颜色令牌（纯函数，只读） | presentation:1 tools:2 tests:5（测试最重）；`presentation/http/serve`、`tools/archify_pipeline`、`tools/archify_semantics` | ③ 保持 src/tools 待定 | 高 |
| `archify_semantics.ts` | 从编辑 IR 树提炼与图类型无关的「语义面」（节点/边/主路径/分组） | tools:3 tests:3；`archify_mappers`、`archify_pipeline`、`tools/view_inputs`(type-only) | ③ 保持 src/tools 待定 | 高 |
| `collect_functions.ts` | 把 MCP 工具清单与 CLI 命令清单合并成统一功能注册面（brickify 功能清单基石） | {presentation:1, tools:1, tests:1}；importer：`presentation/cli/brickify_cli.ts`、`tools/classify_tools.ts`（均 brickify 族） | ① 删（死代码） | 中 |
| `deprecate_offline.ts` | 废弃积木下线链：承接 brickify/feature_map 的废弃证据，清死 import / 可选物理删文件 | {presentation:1, tests:1}；`presentation/cli/deprecate_offline_cli.ts` | ① 删（死代码） | 中 |
| `derive_split.ts` | 执行文件拆分：把次社区符号抽到新兄弟文件并接线 import（brickify/signal_review split 引擎） | {tools:1, tests:1}；`tools/split_stage.ts` | ① 删（死代码） | 中 |
| `ts_slim.ts` | TS/JS 瘦身剪刀（Brick Harvest Phase 7，与 go-slim 同族）：白名单剪枝死声明/import | byLayer application:1（application/harvest/slim_brick.ts）+ tests:1 | ② 下沉 infrastructure/parse | 中 |

### 待裁决（1）

| 文件 | 职责 | 谁在用它 | 落点桶 | 置信 |
|---|---|---|---|---|
| `dict_gen.ts` | 伪维基词典的 LLM 后端：classifyTerm(通用/专有) + generateDictEntry(三档解释) | {presentation:1, tests:1}；唯一生产消费者 `presentation/http/serve.ts` | ③ 保持 src/tools 待定 | 低 |

## 7. 子代理单独点名的事项（**原文，未改写**）

- [值得单独说的] - **`batch_ops.ts` 是本分片唯一确凿死代码**：`tools_facts` 标 `testOnly: true`，全仓精确 grep **零生产 importer**；架构计划 §42 D 类与 §1275 逐字点名「`batch_ops`(103) … 真残留 ⇒ 可删」。其余 3 个同类 per-op 模块（annotation_tools / api_ops / approval）**是活的**（被 query_feature/update_feature 消费）—— 别一起删。
- [值得单独说的] - **「brickify 那一族像上一代工具」的假设与证据相冲突，请以我的判定复核**：`docs/todo.md` §89 只是**待办里的猜测**（"像上一代"），但硬证据是反的 —— ① `brickify`/`brick_bag` 被**在册 MCP 工具** `render_brickwork`（`application/design/index.ts:179`）消费；② `docs/todo.md` **T15** 明写：「`brickify_cli`（11 个输出产物的积木工作台）… **不是别的工具的 CLI，是独立能力**」⇒ 主张**注册为 MCP**。故我把 brickify / brick_bag / classify_bricks / classify_tools / cluster_narrator / cli_extract 判为**工具间共享（活）**，而非旧世代。**唯一存疑**：classify_*/cluster_narrator/cli_extract 的**真实生产消费者只有 `brickify_cli` 一个**（其余 6 个工具只是 `import type`）—— 若 team-lead 采信"工作台 CLI 属上一代"，则这 4 个可改判 `旧世代遗留`。这是本分片最需要裁决的一条。
- [值得单独说的] - **archify_* 四件 = R5 挂起线（已裁定）**：`docs/r5-archify-hung.md` 逐字列名 `archify_semantics/archify_project/archify_mappers`（适配/语义层）+ `archify_pipeline`（渲染编排层）为 R5；`package.json` 的 `test:main` **显式排除** `tests/tools/archify_*.test.ts`。⇒ 判 `旧世代遗留`、**保持 src/tools 待定**（文档要求主线别动）。
- [值得单独说的] - **`archify_pipeline` 有一处真缺陷**（plan §239）：它 import `presentation/cli/archify_cli` —— **库反向依赖自己的 CLI 壳**，属架构违规，R5 恢复时须修。
- [值得单独说的] - **主线对 R5 有一条 type-only 依赖**：`tools/view_inputs.ts`（R5 文档钦定的**主线资产**）`import type { SemanticSurface,... } from './archify_semantics.js'`。⇒ 想删/移 archify_semantics 前，必须先处理 view_inputs 的这条类型依赖（否则误伤主线）。这是**同型重复/耦合**的风险点，不是本分片的死代码。
- [值得单独说的] - **ast_parser.ts 是「兼容层」而非纯内核**：文件头逐字写「让旧代码继续用 sync 接口」。它本身无算法，只是 `infrastructure/parse` 的壳；判 `算法内核`→`infrastructure/parse`，但真实处置应是**迁走 async 调用方后收掉**（调用方仅 backfill、consistency 两处）。
- [值得单独说的] - **annotation_tools / api_ops / approval 有"上一代结构痕迹"**：它们的命名与函数（list_annotations / add_expected_api / batch_move_nodes / submit_approval…）正是**收敛前那批独立 MCP 工具**的名字；收敛进 `get_dsl`/`edit_dsl` 后，这些 per-op 模块保留为 [B]。**功能活、结构旧** ⇒ 我不判旧世代（不可删），但建议随 edit_dsl 实现一并并入 `application/design`。
- [判不了的（待裁决）] - **classify_bricks / classify_tools / cluster_narrator / cli_extract（brickwork 工作台族）**：缺 **team-lead 对"工作台 CLI 是否算上一代"的裁定**。我手上的客观事实是：真实生产消费者**只有 `brickify_cli` 一个**（其余引用全是 `import type`），而 `todo.md` T15 又把 brickify_cli 当成"应注册为 MCP 的独立能力"。两种读法各有据 ⇒ 我默认按"活"判（工具间共享），如需按"上一代"归档请回信，我一分钟内可改表。
- [值得单独说的] - **derive_algorithm.ts 是「半死」**：主函数 `deriveAlgorithm`（67 行起）全仓只有 `tests/tools/derive_algorithm.test.ts` 调用；
- [值得单独说的] - **derive_anim_flow.ts 完全 testOnly**（`byLayer={tests:1}`，无任何生产引用；`explore_code.ts` 对应 case 亦为桩）。
- [值得单独说的] - **diff.ts 与 diff_views.ts 语义相邻但不认定为同型重复**：`diff.ts` 对比**两个 feature**（diff_features，被 query_feature 消费）；
- [值得单独说的] - **web-only 词典簇**：`dictionary.ts` / `dict_gen.ts`（本分片）与 `language_concepts.ts`（非本分片）三者**均只被 `presentation/http/serve.ts` 消费、无任何 MCP 工具注册**，
- [值得单独说的] - **dogfood_stats.ts 与 7 类口径不完全对齐**（见待裁决外的诚实标注）：它不是算法，而是**可观测性基建**（被调度咽喉 server_registry 每次调用写入），
- [判不了的（待裁决）] - **dict_gen.ts**：唯一生产消费者是 `presentation/http/serve.ts`，**无 MCP 工具注册、无 application 层归属**。
- [值得单独说的] - **`get_dsl.ts` 是被合并掉的旧实现（死代码候选），不是"旧世代遗留"。**
- [值得单独说的] - **`feature_map.ts` 不是"旧世代遗留"，别误判。** 它同时喂**旧**的 `brickify.ts`/`brick_bag.ts`（brick 旧族）与**新**的 `application/design/render_brickwork.ts`（已分层的新线），是跨代共享的分析内核。判 `算法内核`，落点 infra/analysis。
- [值得单独说的] - **`lang_hint.ts` 带上了一条 `infrastructure → presentation` 的倒挂依赖。** `lang_hint.ts:39` `import { PACK_PINS } from '../presentation/cli/install_package_cli.js'`。它本身是纯函数（`算法内核`），但**只要这条 import 还在，就不能下沉 infrastructure**（方向倒挂）。要下沉必须先给 `PACK_PINS` 找一个 infra/domain 的家。请 team-lead 记一条前置动作。
- [值得单独说的] - **`index_freshness` ⇄ `index_backfill` ⇄ `write_gate` 是一个三角循环 import（实锤）：**
- [值得单独说的] - **`git.ts` 与 `exec_guard.ts` 是"同目的、不同纪律"的同型不一致（非重复实现，但值得记一笔）：** `exec_guard` 存在的全部理由是"防缺命令时 spawn 白等 5s"；而 `git.ts`（同类 git 封装）用**裸 `execSync`**，未过 `exec_guard`。因 `git.ts` 仅被两个 **CLI**（`diagnose_loop_cli` / `upgrade_rewrite_cli`）使用、不在 MCP 热路径，实际影响有限 —— 但两者都想收进 `infrastructure`，建议同批议定"是否统一走 exec_guard"。
- [值得单独说的] - **`feature_ops.ts` / `file_ops.ts` 与（本分片外的）`edit_result.ts` 同属"DSL 编辑动作实现"族**（create/clone/delete/update + add/update/delete file…）。它们是 `manage_feature` / `update_feature` 聚合工具的**动作子模块，不是独立 ToolDef**。若 team 认定"工具实现"必须 ToolDef 直指，则这两个（以及下面两个）应改判为其宿主工具的"实现子模块"。建议整族一起并入 `application/design`。
- [值得单独说的] - **`impact_report.ts` / `impact_ledger_store.ts` 只被 `tools/watch_project_tool.ts` 一个工具消费**（`byLayer` 均 tools:1）。它们是 `watch_project`（**meta 线**：见 `application/meta/index.ts:85-87` 对 declare/ledger 的策展说明）的子实现。故落点建议 `application/meta`，与 harvest 线区分开。二者"报告引擎 vs 纯存储"性质不同，但都归 watch 工具实现族。
- [值得单独说的] - **`presentation/mcp/server_registry.ts:29` 对 `exportSvg/exportMarkdown` 的 import 疑为未使用**（全仓 grep `exportSvg|exportMarkdown` 仅在本 import 行与该函数的定义/`handlers.ts` 调用处出现，`server_registry` 内无使用点）。属独立卫生问题，不影响 `export.ts` 定性。
- [判不了的（待裁决）] - `explain_gen.ts`：**落点**待定，缺 `tools/llm_focus.ts`（本分片外）的落点 —— `explain_gen` 依赖 `llm_focus` 的 `configFileReadPath`，两者须同批定去向（同去 `application/shared` 或同去 infra）。
- [判不了的（待裁决）] - `feature_map.ts`：**落点**待定，缺 `layer_detect` / `detect_dead_imports` / `python_refactor/dead_imports` 三者（均本分片外）的落点 —— 它们不下沉，`feature_map` 就进不了 infrastructure。
- [判不了的（待裁决）] - `index_backfill.ts` / `index_freshness.ts`：**落点**待定，缺 `write_gate.ts`（本分片外）的落点与三者的依赖方向决策（三角循环，见上）。
- [判不了的（待裁决）] - `lang_hint.ts`：**落点**待定，缺 `PACK_PINS` 的归属决策（presentation/cli → infra/domain 的搬迁由谁做）。
- [值得单独说的] - **`monolith.ts` 与 `analyze_monolith.ts`（后者不在本片）不是同型重复**。依据：`analyze_monolith.ts` 文件头逐字写明二者分工——`check_monolith`=单文件内文本引用近似（无跨文件、无功能锚点）；`analyze_monolith`=读 cache.db 的 `kind='call'`（含 cross 边）+ 锚点标签传播。两者输入源不同（源文本 vs cache.db 调用边）、产出不同。**不代表可合并**，仅提示命名邻近，复审时别误合。
- [值得单独说的] - **`facts.json` 的 side-effect import 盲区**：`register_capabilities.ts` 在 facts 里是 `tests:1 / testOnly:true`，但实际 `presentation/cli/capability_cli.ts:25` 用 `import './register_capabilities.js';`（无 `from`，无绑定符号）触发登记——**它并非死代码**。这类 bare import 其它文件很可能也存在，建议其它分片对"testOnly=true"的条目手工复核一遍，别直接判死。
- [值得单独说的] - **两个"仅测试引用"的死代码候选**：`observe_chain_view.ts`（HTML 渲染，仅单测断言结构）、`refactor_report.ts`（报表物化，仅单测）。两者都有完整单测但无生产调用点；`observe_chain_view` 的语义被 `reconcile_chain.ts` 注释引用（仅注释，非代码）。落地前需产品确认"是否接入"。
- [值得单独说的] - **7 类口径缺"HTTP-HUB 业务能力"槽位**：`opl.ts` / `overview.ts` 只被 `presentation/http/serve.ts` 调用，无 MCP ToolDef（server_registry 不 import 它们）。按定义 `工具实现`要求 handler 指向它，严格说不满足；本片按"能力实现体"归入 `工具实现` 并标注，**建议 team-lead 统一口径**（是新增一类，还是认可 HTTP-HUB 也算"工具实现"）。
- [值得单独说的] - **基础设施→tools 的分层倒置（下沉反而修好）**：`infrastructure/` 有 3 处 import `tools/llm_focus`（`analysis/diagnosis/root_cause_aggregator.ts`、`analysis/diagnosis/repair.ts`、`analysis/observe/judge_service.ts`）、2 处 import `tools/refactor_langs`（`analysis/java_refactor/{layering,executor}.ts`）、`infrastructure/graph/import_project.ts` import `tools/{layer_detect,monolith}`。这**支持**把 `layer_detect/monolith/llm_focus/refactor_langs` 下沉到 infrastructure/application，倒置会自动消失。
- [值得单独说的] - **同名不同物，勿混**：`registry.ts`（产物注册表，本片）与 `registry_extract.ts`（MCP 工具注册表提取器）以及 `infrastructure/.../adapters/registry.ts`（版本升级适配器注册）三者在 grep 里都会命中 "registry"，属完全不同的东西。
- [判不了的（待裁决）] - 本片 21 个文件均给出了判断，无 `待裁决` 条目。
- [判不了的（待裁决）] - 唯一需 team-lead 裁决的是**口径**而非文件：`opl.ts` / `overview.ts`（HTTP-HUB 业务能力，非 MCP ToolDef）在 7 类里无精确对应槽位（详见上一条），本片暂按 `工具实现` 归类。
- [值得单独说的] - 两者都消费 `(BrickifyResult, ClusterNarratives)`，都产出"簇节点卡 + 真实依赖边 + 人话叙事 + 点击详情悬窗"的自包含 HTML。
- [值得单独说的] - 边聚合算法**逐字同型**：`render_cluster_workbench.ts:40-50` 的 `clusterEdgesOf`（`fileToCluster` → 按 `file_deps` 累加 `count`）与 `render_dep_canvas.ts:252-257` 的内联边构建完全同构。
- [值得单独说的] - `render_dep_canvas` 是 `render_cluster_workbench` 的**超集**：多了 SCC 缩点+最长路径分层（`layoutCanvas`）、程序生成贝塞尔连线、lucide 内联图标、缩放/平移/小地图。两者只差"社区分行布局" vs "有向分层布局"。
- [值得单独说的] - ⇒ 判 `render_cluster_workbench` 为死代码候选；但它**当前仍被 `brickify_cli --workbench` 接线**，删前需确认该 flag 无消费者。
- [值得单独说的] - 依据：`package.json` scripts 有声明入口 `"brickify": "node dist/src/presentation/cli/brickify_cli.js"`；`docs/architecture-refactor-plan.md:3791` 明确把 `brickify_cli` 归为"**更大的『工作台 CLI』**，只是**部分**共享实现"（区别于 7 个"与 MCP 工具同源、可删"的 CLI）；`src/tools/brickify.ts` 最后改动是 **2026-09-30**（不是冻结遗产）。
- [值得单独说的] - 本片**没有** archify_*/ts_slim/go-slim 族文件，故 `旧世代遗留` 计数为 0。
- [判不了的（待裁决）] - 无（本片 21 个均能给出落点）。唯一需要外部拍板的是 `render_cluster_workbench.ts` 的**删除时机**，取决于 `brickify_cli --workbench` 是否还有人调用——这是"消费者意图"信息，读代码读不出来。
- [值得单独说的] - **trace 链半接线（trace_reasoning ↔ trace_evidence）**：消费者 `trace_evidence.ts` 已接入 edit_dsl 的 L4 resolver（handlers.ts + server_registry.ts）；但生产者 `trace_reasoning.traceReasoning()` **全仓无生产调用方**（只有 2 个测试 import，唯一生产引用是 `trace_evidence` 对 `TraceRecord` 的 **type** 导入，故 `testOnly=false`）。⇒ 整条"真实 trace 生成 → L4 复算"目前**只有半条闭合**。要么给 trace_reasoning 补入口（转正），要么承认 L4 trace 证据链是半成品。判"死代码候选"取的是函数无调用方这一事实，类型依赖需先迁移。
- [值得单独说的] - **view_inputs.ts 与 archify_* 同族且仅测试引用**：`view_inputs` 只 `tests:1`（testOnly），它 `import type` 自 `archify_semantics`。archify 族（archify_semantics/archify_mappers/archify_pipeline/archify_project）是本仓点名的旧世代线索族。**依据**：无生产 importer + 属 archify 渲染族 → 死代码候选。
- [值得单独说的] - **status_tools 半死**：只有 `updateStatus` 被 update_feature.ts（edit_dsl）用；`checkStatus`（扫 TODO 推断状态）**全仓无调用方**（仅 backfill.ts 注释提及）。落点随 edit_dsl，但 check_status 半边应清理。
- [值得单独说的] - **sync_contracts 的反向依赖**：它 `import { TOOL_DEFS } from '../presentation/mcp/server_registry.js'` —— **向上依赖 presentation**。所以它**不是**可下沉的内核，而是"接线型"工具实现（文件头也自述 ESM 循环 import 安全）。落 application/harvest 时该依赖仍是向上的，需复核是否要把 TOOL_DEFS 的读取抽到更低的注册中心。
- [值得单独说的] - **verify_refactor 被 infrastructure 反向引用**：`infrastructure/analysis/version_upgrade/adapters/*` 与 `java_refactor/executor.ts` 共 5 处 import 它。⇒ 它**只能落 infrastructure**，落 application/shared 会造成 infrastructure→application 的反向依赖。
- [值得单独说的] - **write_gate 同理但方向相反**：它 import `application/refactor/file_snapshot`，⇒ **不能下沉 infrastructure**，只能留 application（application/shared 或 refactor）。
- [值得单独说的] - **wizard_steps / workbench_shell_css 严格口径存疑（单消费者）**：二者各只有 1 个 importer（分别 render_wizard.ts、render_workbench.ts），严格按"被 ≥2 个工具共用"不满足 `工具间共享`。判为 `工具间共享` 的依据是它们是"渲染能力"的内部数据/静态资产，与渲染器同生共死；**若按严格口径，可另立或降为渲染器内部实现**。workbench_data 有 2 个 importer（brickify_cli + render_workbench），无此问题。
- [值得单独说的] - **brickify 是否"旧世代"存疑（影响 workbench_data/wizard_steps/workbench_shell_css/taxonomy 的判定）**：团队线索把 `brickify` 列为旧世代，但实测 **brickify 仍被现行 MCP 工具 render_brickwork（application/design）消费**，`package.json` 也有 `npm run brickify`；`docs/tool-convergence.md`§草丛工具评估（2026-09）明确把 `render_workbench` 等判为"内部实现、零转正"。故本分片**未**把这几个 workbench/wizard 文件判为旧世代，而判为 `工具间共享`。若团队已确认 brickify 工作台族退役，这几个（含 taxonomy、wizard_steps、workbench_*）应改判 `旧世代遗留`。
- [判不了的（待裁决）] - （无）本分片 18 个逐个给出了判定。上列"存疑"项已在"值得单独说"写明反证与改判条件，非无法判定。
## 附：实际落点（2026-10-01 搬迁后**回填**，替代上面的"计划"）

原始 123 个：**已搬 115** ｜ **已删 5** ｜ **未搬 3**

### 已删（判死后删除）

- `batch_ops.ts`
- `get_dsl.ts`
- `observe_chain_view.ts`
- `refactor_report.ts`
- `run_narrate.ts`

### 未搬（有明确裁决前置，不是漏搬）

- `sync_contracts.ts` —— ④-2：import `presentation/mcp/server_registry` 的 `TOOL_DEFS` ⇒ 落哪都违规，要先解环
- `trace_reasoning.ts` —— 产品裁决：**活链的生产端**（`application/observe/trace_evidence` 消费），删它 = 砍半条链
- `view_inputs.ts` —— ★ `README.md:325` + 规划书 §11.5 **逐字钦定"不删"**，且 `src/` 零消费者

### 已搬（按落点分组）

| 落点 | 个数 | 文件 |
|---|---|---|
| `src/application/design/` | 28 | `annotation_tools` `api_ops` `brick_bag` `brickify` `classify_bricks` `cluster_narrator` `consistency` `dag_layout` `derive_algorithm` `derive_chain` `derive_split` `detect_drift` `edge_ops` `edit_result` `feature_ops` `file_ops` `node_ops` `opl` `signal_review` `simulation` `snapshot` `split_stage` `status_tools` `taxonomy` `templates` `update_feature` `wizard_steps` `workbench_data` |
| `src/application/meta/` | 11 | `classify_tools` `cli_extract` `collect_functions` `derive_anim_flow` `explain_gen` `impact_ledger_store` `impact_report` `overview` `query_feature` `registry_extract` `semantic_search` |
| `src/application/observe/` | 7 | `approval` `harvest_decisions` `observe_trace` `reason_validator` `reconcile_chain` `trace_evidence` `write_gate` |
| `src/application/refactor/` | 7 | `diff_views` `field_refs` `package_migration` `protect` `rename_file` `rename_local` `rename_symbol` |
| `src/infrastructure/` | 7 | `alert_inbox` `dictionary` `dogfood_stats` `exec_guard` `git` `llm_focus` `verify_refactor` |
| `src/infrastructure/analysis/` | 20 | `analyze_monolith` `arch_layer` `capability_matrix` `contract_gate` `dead_statements` `derive_feature_tree` `detect_dead_imports` `diff` `diff_impact` `feature_map` `health_cache` `language_concepts` `layer_detect` `monolith` `refactor_langs` `role_title` `run_trace_replay` `snapshot_needle` `submit_gate` `trace_exec` |
| `src/infrastructure/index/` | 7 | `function_outline` `guided_tour` `index_backfill` `index_freshness` `registry` `watch_project` `watch_project_tool` |
| `src/infrastructure/parse/` | 12 | `arg_suggest` `ast_parser` `ast_rename` `fuzzy_match` `go_mod` `lang_hint` `line_utils` `npm_mod` `rule_match` `rule_tokens` `ts_slim` | `register_capabilities` |
| `src/infrastructure/render/` | 2 | `export` `inject_replay` |
| `src/presentation/cli/` | 9 | `deprecate_offline` `render_anatomy` `render_cluster_workbench` `render_dep_canvas` `render_mindmap` `render_tools_map` `render_wizard` `render_workbench` `workbench_shell_css` |
| `src/presentation/http/` | 1 | `dict_gen` |
| `src/presentation/http/archify/` | 4 | `archify_mappers` `archify_pipeline` `archify_project` `archify_semantics` |
