# INDEX.md — 现状与文档图

> 只写当前能力和权威。数字不抄；命令现算。历史在 git 与 ledger，不在当前树。

## 1. 产品与闭环

AgentIO 是由目标驱动的程序开发引擎。一个真实开发任务应走：

```text
理解 → 设计 → 改造 → 对账
```

事实来自源码与索引；意图住设计侧；执行事件住台账；文档是派生说明，不是第二真相。

## 2. 权威地图

| 问题 | 唯一权威 / 查询入口 |
|---|---|
| 工具能做什么、何时用 | `ToolDef.description`；导航用 `capability_map` |
| 当前门与判据行为 | `scripts/verify.mjs#GATES`；`src/domain/expectation_kinds.ts#KIND_SPECS`；`docs/GUIDE-GATE.md` |
| 当前文件/符号/调用事实 | 源码 + 项目索引；`index_integrity` 判新鲜度 |
| 设计意图、决策、判据、**节点卡**、计划 | `.agent-io/design/*.dsl.json`；`get_dsl` / `edit_dsl` / `design_line` |
| **todo 卡**（在册任务卡的当前载体） | `.agent-io/tasks.db` 的 `live_cards`；读册时补回 `todos[]`；写走 `task_ops` |
| 一张卡活没活 / 全部卡的下落 | `cardLivesOf`（`live_cards ∪ task_history ∪ 设计册 nodes[].task`）；池与待办视图走 `listPool` |
| 当前任务、事件、裁定、销账 | `.agent-io/tasks.db` 的 `ledger_*` 表（**不是** `live_cards`）；`ledger` 工具 |
| 人读任务视图 | `docs/todo.md`，由 `npm run ledger:render` 生成；`npm run ledger:check` 验新鲜度 |
| 当前支持语言与能力档位 | `capability_audit` 现算；不写死语言数 |
| 路径身份 | `scripts/lib/path_identity.mjs#samePath` |
| 用户愿景原话 | `docs/VISION-ORIGINAL.md` |
| 当前仍有效的否决与回炉条件 | `docs/RETIRED.md` |

## 3. 能力边界

- **已具备**：设计册、判据、写闸、台账、增量验证、多模型席位协作、AST 辅助改写、按需运行观测。
- **不是承诺**：不是所有语言同精度；编译通过不等于行为等价；结构一致不等于设计优秀；工具数/判据数不是成功指标。
- **写入边界**：仓内写工具过闸；shell / 普通编辑器直写绕过写闸，只能事后对账发现。
- **语言边界**：按语法 / 语义 / 构建测试 / 运行观测逐格声明；能力不足时降级为 syntax-only 或 unsupported，不猜。
- **外部项目边界**：官方 DSH 完整源码的独立 checkout 是当前试点，但全链闭环尚未验收；运行中的 DSH 安装目录不是改造源。

## 4. 文档图

| 文档 | 用途 |
|---|---|
| `README.md` / `README.en.md` | 项目是什么、怎么开始 |
| `AGENTS.md` | 开发纪律（唯一住处） |
| `CONTRIBUTING.md` | 加/删工具与提交前检查 |
| `docs/INDEX.md` | 当前现状与权威地图 |
| `docs/PROJECT-DESIGN.md` | 目标设计、非目标、阶段出口 |
| `docs/GUIDE-USAGE.md` | 安装、环境、使用、Tailscale 安全 |
| `docs/DEVELOPMENT.md` | 开发、验证、席制、当前下一卡 |
| `docs/GUIDE-GATE.md` | 门、判据、四态与失败语义 |
| `docs/FIELD-ALIGNMENT.md` | 字段 ↔ 源码/存储对齐 |
| `docs/ROOTS.md` | 目录、数据根与权威边界 |
| `docs/PITFALLS.md` | 撞门/环境故障的现行处置 |
| `docs/GUIDE-LANGUAGE.md` | 加语言 / 加 AST 的边界与验货 |
| `docs/VISION-ORIGINAL.md` | 用户愿景原文 |
| `docs/RETIRED.md` | 当前仍有效的否决与回炉条件 |
| `docs/todo.md` | ledger 生成视图；不手改 |
| `docs/plans/` | 冻结企划 / 审计映射 / 加速度曲线 / S-EXEC 草案 / E-2 企划 / 审计交接简报的只读归档原件（SHA256 与原件一致；历史存档，非当前基线） |

## 5. 当前下一方向

完成本基线后，优先在**官方 DSH 完整源码的独立 checkout** 上把 `import_project → 设计册 → 领卡 → 施工 → 判据验收 → 销账` 全链闭环跑通，并记录机制维护成本是否超过它减少的返工。首刀限插件管理器安装流程的行为保持重构；试点不等于做 DSH 专属引擎或插件。

## 6. 规矩

1. 同一事实只有一个可写权威。
2. 判据只住一处；不抄数字、不造第二套门。
3. 读不到 ≠ 没有；判不了 ≠ 通过。
4. 写文档先改既有入口，不新开平行说明。
5. 历史由 git 与 ledger 保存；当前树只放可执行的现在。
6. 任务卡分载体：节点卡在册、todo 卡在库；清点全部卡只用 `cardLivesOf`，不用 `live_cards` 单表（口径见 `docs/ROOTS.md` §3）。

<!-- DOC:GEN:index.tools:BEGIN source=index.tools@eeda5c6983b3da1f cmd="npm run doc:render" format=docs-view-v1 generator=docs-view.render@0.1.3 body_sha256=f447f4ebdf3571aa -->
| 工具 | 线 | 说明 |
|---|---|---|
| `annotate_functions` | refactor | 让"函数做什么"由源码自带语义注释承载，而非每次由 LLM 从中重新提取。 |
| `apply_refactor_plan` | refactor | 「先算清单 → 预览 → 批量落盘」的**第二半**（规划书 §16.3 P-C）：按本工具 `targets` 形态产出的清单落盘（不重算清单、不再要 old_text）。 |
| `capability_audit` | meta | **能力矩阵自检**（缺口清单 |
| `capability_map` | meta | 统一能力线入口（只读导航，无副作用）。 |
| `chain_hop_args` | meta | **生成链上某一跳的可跑入参**（只读）：按 `direction` 分两档—— · `direction='first'`（缺省）：给**链名** `chain` 或**起点工具名** `t… |
| `code_health` | cross | 代码健康度（选材体检）：对 project_dir 全项目做三层体检，输出健康分 + 问题清单。 |
| `contract_page` | meta | **契约页 / 类型页**（只读）：给一个**符号名或类型名**，**一次给全**六块 —— 调用方**不用再调别的工具**：① 定义在哪（文件:行 + 签名，来自内核 AST） |
| `cross_repo_symbol_index` | cross | 跨项目符号索引（杂交前"会不会撞名"）：对两个项目根各建顶层符号集合，再求交/求差。 |
| `deprecate_offline` | refactor | 废弃积木**下线链**（C 链）：废弃证据自取（`detectDeadImports` 全量扫 + 编译级验收），把**项目内自研源码模块**真正下线。 |
| `design_intent` | design | 「设计意图（why）」统一入口：**没有独立工具** —— 读 intent 走 `get_dsl`（query=goals / edge_intents），写 intent 走本入口 act… |
| `design_line` | design | 设计链【六步读数】：源码 →① 实际 DB →② 实际 DSL →③ 设计 DSL →④ 人写意图 →⑤ 设计 DB →⑥ 设计签名 → 源码。 |
| `diagnose` | meta | ★ **诊断统一入口**（2026-11-09 收敛试点）：`apply` 缺省/false ⇒ **只读诊断**（不写盘）：症状解析 → 符号定位（cache.db）→ 调用链追溯 → 影响… |
| `diagnose_loop` | meta | ★ **兼容别名**：与 `diagnose` **共用同一个 handler**，行为逐字相同 —— 只为不断旧调用方与旧链（chain_wiring 的产物边）。 |
| `diff_views` | refactor | 覆盖体检（**不是核销**）：比 design 与 live 两份 DSL，报「设计册待填充」——文件层 / 符号·API 层 / 边层 / 已声明排除 / 视图陈旧。 |
| `edit_code` | refactor | 符号级语义编辑：按 文件+符号名 定位函数/方法/类/接口，AST 确定边界后整体替换/插入/删除。 |
| `edit_dsl` | design | 统一写入口：通过 operations 列表批量执行节点/边/文件/API 的增删改、节点平移、语义绑定、状态更新，以及快照/自动布局/仿真重置。 |
| `explore_code` | meta | 代码理解统一入口：通过 action 参数化执行各类分析（动作清单见 `action` 字段的 describe）。 |
| `find_references` | refactor | 查找符号/字段的引用——改/删前看波及面。 |
| `get_dsl` | design | 统一只读入口：通过 query 参数查询 DSL 数据。 |
| `go_originals` | cross | 解析单个 Go 源码文件，返回其中每个顶层符号(func/const/var/type)的 Go 原文片段(srcSnippet)与起始行(srcLine)。 |
| `import_project` | design | 扫描代码项目（.go/.ts/.py/.js 等）生成 DSL：文件节点 + 调用边 + 符号/API 语义层，写入 agent-io 存储。 |
| `index_integrity` | meta | 只读自检：回答"我眼下读到的索引能不能当真"。 |
| `ledger` | meta | **台账唯一入口**：单工具 + action 枚举，每个 action **直映一个引擎 API**（纯透传 + 参数校验）。 |
| `move_domain` | refactor | ★ **一次搬完一个域**（整块搬迁，T166）：按**域表声明的变化**把旧家那一整块搬到新家，并**逐个改写 import**。 |
| `move_symbol` | refactor | 跨文件移动模块级符号（语义重构第一棒）：把 file 里的模块级符号 symbol 搬到 to_file，并自动把工作区内所有「仅引入该符号」的 import/再导出目标从源文件重定向到 to… |
| `observe` | observe | ★ 观察线只读三合一入口：**没有独立工具**（`observe_log` / `observe_trace` / `observe_judge` 都不存在）——三个只读动作都在本入口的 ac… |
| `opl` | design | propose：由项目事实出候选 ChangeSet + 确认清单（只读）。 |
| `recommend_observe_points` | observe | ★ 观测点推荐器：**不做全量插桩**，而是先用索引/图 + AST 语义算出「该在哪打日志」，只在推荐点上插。 |
| `reconcile_chain` | observe | 中观档对账（工具可用性复盘缺口 C）：按「文件/宿主节点」一条命令的真跑 + 查数据 + 对账，填补宏观（整项目对账）与微观（trace-exec 纯函数子集）之间的空档。 |
| `reconcile_effects` | observe | 积木契约动静对账（Brick Harvest Phase 2c 合龙）：读 <project>/.agent/observe/events-*.jsonl 中的 effect 事件（Go 语言… |
| `recover_run` | observe | ★ P2 引擎原生可恢复执行的**只读**恢复入口：不依赖聊天上下文，现场组合任务（目标/owner/代际/租约）、Run/Attempt 事件流 fold 出的 checkpoint、既有证… |
| `refactor_judge` | refactor | LLM 审闭环的裁决门：接受候选问题清单，逐条裁【采纳/驳回/不确定(+置信度+理由)】，把"拿不定主意"的（uncertain）上抛回控制台/上下文（经 alert_inbox 入箱，下一次… |
| `refactor_pipeline` | refactor | 确定性重构管线：把可自动执行的瘦身改写串成一条链，一次调用按序执行、统一增量验证、失败只回滚到最近绿点。 |
| `rename_files` | refactor | 文件改名/移动（单条或批量统一入口）并联动全仓 import 引用改写，对标脚本效率（消除"70 文件改名=70 次调用"的粒度问题）。 |
| `rename_symbols` | refactor | 标识符改名**统一入口**：一个工具、两种作用域粒度，用 scope 选 |
| `rules` | refactor | 规则库统一入口：**没有独立工具** —— 导出 / 应用 / 检查分别是 action=export / apply / check（三者操作的是**同一个库**）。 |
| `run_tests` | observe | 跑目标项目的测试（走 package.json 的 scripts.test，以退出码判成败，退出码 0 ⇒ 成功）。 |
| `snapshot` | refactor | 代码快照统一入口：**没有独立工具** —— 列快照走 action=list、回滚走 action=rollback（两者操作的是同一个快照库）。 |
| `structure_gap` | refactor | 结构意图 vs 现状**六态**读数：读 `<project_dir>/structure.domains.json`（**域 = 能力的家**，声明"哪个目录算哪个域"）与磁盘现状对账，回答… |
| `sync_contracts` | meta | 契约回填（修复契约漂移）：以注册表的 zod schema 为唯一事实源，把每个已注册工具的输入契约生成签名回填到 DSL semantic.files 的 expected_apis。 |
| `translate` | cross | 把 Go 源文件机械生成 TS 骨架 + 验证闸（默认），并给出一份**回执**：known（AST/常量/import/调用边的事实）/ unknowns（推测的惯用法映射、缺库、行为假设… |
| `upgrade` | meta | **版本升级契约差**（一个入口两个动作）。 |
<!-- DOC:GEN:index.tools:END body_sha256=f447f4ebdf3571aa -->
