# 现状

> 只有现状。没有历史、没有原话、没有理由。新的东西**改这张表**，不新开文档。

> **产品是什么（2026-11-09 统一口径，详见 `docs/PROJECT-DESIGN.md` §1）**：
> AgentIO 是**由目标驱动、自动理解项目、展开设计、协调实现并验证结果的程序开发引擎**。
> 用户给目标 → 模型作必要的语义判断 → **引擎**负责定位、补全、关联、改写、测试、对账与证据维护。
> 「框架 / 协议 / 库」只在指技术分层时使用，不用来描述产品本身。

## 一、目录

| 路径 | 干什么 |
|---|---|
| `src/domain/` | 纯数据与判据：`task_machine`(状态机) `task_schema`(卡/期望) `geometry`(节点/边) `overlay`(进度底座) `expectation`(判据求值) |
| `src/infrastructure/` | 外面的事：`parse/`(TS/Go 解析) `index/`(`cache.db` 符号表) `storage/`(DSL/overlay 读写) `graph/`(`import_project` 扫描) |
| `src/application/` | 用例：`design/`(设计侧读写 + `design_line`) `refactor/`(改名/移动/编辑) `write_gate`(写闸) `patrol/`(漂移巡检) |
| `src/presentation/` | MCP server + CLI |
| `.agent-io/design/` | 设计侧：`*.dsl.json`（图 + 决策 + 卡 + todo，都在这一份里） |
| `.agent-io/live/` | 实际侧快照（`import_project` 重扫产出，可覆盖） |
| `.agent-io/cache.db` | 索引：符号 / import span / 调用。**不入库** |
| `design-db/` | `.calls.json` 逐文件投影：设计 DB（从 DSL 派生，`gen-db` 全量重写；份数由命令打印） |
| `tests/` | 行为断言（`*.test.ts`，`npm run verify` 的「测试」门**全跑**）。★ 第三套验证 `certs/` 已于 2026-10-31 整目录退役，内容迁到这里 |
| `scripts/` | 运维脚本（verify / gen-db / 各种探针）。**不受写闸管** |
| `docs/` | 见 §五 |

## 二、工具（常用的这些；总数按 `TOOL_DEFS` 现算）

| 工具 | 干什么 |
|---|---|
| `edit_dsl` | 改设计侧：`decision` / `task`(publish·claim·complete·reopen·relaunch·void) / `node` / `todo` |
| `design_line` | 设计链读侧：`report` / `diff` / `rewrite`(只拉签名) / `gen-db` |
| `get_dsl` | 查：`nodes` `node` `edges` `files` `file` `decisions` `pending` `pool` `scope` |
| `edit_code` | 改源码：`replace_text` / `range` / `symbol` / `insert`。**走写闸 + 重建索引** |
| `rename_files` / `move_symbol` | 改名 / 移动符号。**走写闸** |
| `import_project` | 重扫实际侧 → `live/` + `cache.db` |
| `find_references` / `explore_code` | 查引用 / 探索 |

## 三、功能与状态

| 功能 | 干什么 | 状态 |
|---|---|---|
| 任务卡 | 节点上挂卡：`candidate`→`claimed`→`done`；`candidate` 也可直接 `done`（显式收口，owner 可空）；`done` 可 `reopen`，`void` 可 `relaunch`。判据在 `decision.expectations`，`evidence` 记 `by` / `agent`。★ 三条出口别混：`done`=**干完了** · `release`=**放回去**（claimed→candidate，活还在）· `void`=**不做了**（candidate→void，理由必填，判据/证据保留，可 `relaunch` 复活）—— ★ **不许用 `void` 收尾** | ✅ |
| 判据两把尺 | **L1 卡**（decision 无 post 判据）：claim / complete 同读 `constructionVerdict`（方向相反：`false` 可领 / `true` 可收口）；**L2 卡**（有 post 判据）：claim 读 `isClaimable(cardStanding)`、complete 读 `isSatisfied`（同一读数、两个谓词）。★ 跨级才是两把尺，各自显式命名、不互相冒充（L1/L2 交接流待裁：`todo_l1-l2-handoff-gap`） | ✅ `tests/p0_zero_criteria_claim`（L1 两段式）· `tests/p0_domain_five_values`（五值） |
| 判据 kind 表 | `file-exists` `symbol-exists` `signature-matches` `edge-exists` `edge-absent` `call-exists` `source-has` `run`（★ 种数与名字**只在** `src/domain/expectation_kinds.ts#KIND_SPECS` 声明，本行不抄数） | ✅ |
| 写闸 | 改源码须有 claimed 卡；`gate:'exempt'` 的节点免闸 | ✅ 已真拦 |
| A7 | 带 `actor` 时 `owner ≠ actor` ⇒ 拒（不传 ⇒ 提醒 + 放行） | ⚠️ 见 §四 |
| 重写 | `design_line rewrite`：只把源码签名拉回设计签名 | ✅ 不生成实现 |
| 设计 DB | `gen-db` 从 DSL 派生（份数由命令打印） | ✅ 有门 `gen-db-check`（序号会漂，别写死） |

## 四、未完成

| 什么 | 在哪 |
|---|---|
| ~~A7 在 4 条写路没接 `actor`~~ 已修：`rename_file`/`rename_files`/`symbol_move`/`apply_refactor_plan` 全接 | ✅ |
| A7 默认仍是"提醒+放行"（`AGENT_IO_ACTOR_STRICT=1` 才拦） | `write_gate.ts` |
| 自报拦不住冒充（stdio 拿不到可信身份） | 架构限制，非缺陷 |
| **L1/L2 交接**（诊断 §6-2）：级别是派生值 ⇒ L1 卡一旦补上 post 判据就**当场变 L2**（`complete` 按 L2 判）；旧的「L1 done → publish 升 L2」两步流**不存在**。当前交接 = `release`（卡回 candidate）→ 下一个人 `claim` 时已是 L2。★ 这条流要不要保留？待裁：`todo_l1-l2-handoff-gap` | `task_ops.ts` · `task_schema.ts#taskLevel` |
| ~~`satisfied` / `done` 锁死文件~~ 已修：`claim` 加 `intent=work\|modify`（done 走 t_reopen+t_claim 一步，须给 reason，evidence 保留） | ✅ |
| ~~`edit_code` 接受空操作~~ 已修：判据是"替换后内容是否变了"，报"空操作"且不重建索引 | ✅ |
| ~~`refactor_pipeline` 不走闸~~ 已修（`t357` 23/0）；`diagnose` / `upgrade apply` 仍未过闸（分层障碍：`infrastructure → application`，要注入 `beforeWrite` 而非 import） | 见 §六 |
| `deprecate_offline` 的物理删除（`fs.rmSync`）仍不过闸 | `deprecate_offline.ts` |
| 4 个脚本仍 import `dist`（tsx 已装未用） | `scripts/` |
| `hook-task-gate.mjs` 是死闸（读不存在的文件 + 按 `path` 匹配而节点无 `path`） | `scripts/` |
| `docs/gate-principle.md` 不存在（已收口：`src/` 死引用 0，权威改指 `docs/GUIDE-GATE.md`；只剩已退役的 `scripts/hook-task-gate.mjs` 两处自述） | 引用点 |
| 12~25 个节点指向盘上不存在的路径 | `.agent-io/design/` |
| 写闸只拦 MCP 工具面，`bash` 直写不拦；**仓库里已无任何 git hook**（2026-11-04：`.githooks/pre-commit` 随 `gen_agents` 一起退役，它当时也只跑生成器） | 覆盖面 |
| 覆盖是 **98%**（337/341 个 `src/` 文件在设计侧），但 claimed 卡只覆盖 **4 个 `src/` 文件**（另有 3 个 `scripts/*`）⇒ 闸一开，改绝大多数已纳设计的文件都会被拒，除非领卡或 `authorize` | `.agent-io/design/` |
| `task_plan` 仍是工具面外的飞地：不在 `DesignDSL` 类型、没有 `edit_dsl` op（`design-check` 直接读 JSON）⇒ 改它只能手改 | `.agent-io/design/` |
| `run` 缺 `target` / `cases`（求值域没有 `import`）⇒ 调不到被测模块；`parse/params.ts` 与 `ParsedSymbol.exported` 也未做 ⇒ 契约测试生成器拼不起来。且多数读文本判据的目标是**内部语句**，没有可测的导出接口（模块层缺口，要改代码结构） | `expectations.ts` · `parse/` |
| 跨文件 `obj.method()` 不建调用边（v1 保守标 `external`，不做接收者类型推断）⇒ 跨文件方法调用的 `call-exists` 判不了 | `index/symbols.ts#resolveCrossFileCalls` |
| `observe_proposals` 是「实际 → 设计」的回流通道，但没有生产使用（0 提案）。定位仍是：判结果用 `run`，判过程（步数 / 耗时 / 重试）才插桩 | `.agent-io/observe/` |
| 批量删孤儿节点无一键路径（**有意**）：只能逐条走 `edit_dsl`；不得绕过它直接调 `updateFeature` | `edit_dsl` |
| 全语言通用 = 语言能力表（`parser` / `compiler` / `testRunner` / `probes`），不是"多支持几门语言"；增量编译是 TS 专属，不进通用层 | `parse/languages.ts` · `verify.mjs` |
| ~~`task.expectations` 是 `decision.expectations` 的副本~~ 已修：`TaskSpec` 无该字段，判据只住 decision（`task_schema.ts#expectationsOf`）；旧 A6 闸随副本删除，写端改为结构断言 | ✅ |
| `reopen` 的闸只堵"零动作"：伪造 `evidence.at` 时间戳仍能过 | `task_ops.ts#reopenGate` |

## 五、文档

| 文件 | 是什么 |
|---|---|
| `INDEX.md`（本文件） | **唯一入口** |
| `AGENTS.md` | **开发纪律（唯一住处 · 必读）**：29 条规则「零」节 + 六节环境知识。★ **手写件，直接改它**（2026-11-04 起）—— `gen_agents.mjs` 与「动作 → 工具」表**均已退役**（工具面 = 唯一权威，导航用 `capability_map`）；退役缘由见 `RETIRED.md` |
| `README.md` / `README.en.md` | 项目是什么 + 怎么跑 |
| `CONTRIBUTING.md` | 加/删工具要动哪几处 |
| `GOAL.md` | 为什么做这个 |
| `VISION.md` | 用户对每个功能的描述（原话） |
| `DESIGN.md` | 缺陷台账（A/C/D 节） |
| `AGENTS-RATIONALE.md` | **本规则的论证 / 实证 / 用户原话**（`docs/AGENTS-RATIONALE.md`）—— 是**说明，不是第二处权威**；★ 原 `../AGENTS-RULES.md` 已于 2026-11-04 并入 `AGENTS.md`（旧名不再存在，别去找） |
| `GUIDE-GATE.md` | 门的清单（`verify` 的门 · 判据 kind · 写门规矩；条数看 `scripts/verify.mjs#GATES`，不抄数字） |
| `FACTS-VS-DESIGN.md` | **事实册 ↔ 设计册**：两层（语法/语义）分工 + 三体同构规则（键集合相等 / id 同源 / 人只写意图）+ 补齐清单 |
| `ONE-AUTHORITY.md` | **一处权威**设计提案：同域同一行为只能有一个权威处；含"按文本查重抓不到"的实测与三条落地做法 |
| `METHOD-DEBUG-BY-SAMPLING.md` | **调试方法（固定）**：抽查真实报错 → 读那一行 → 并排读 Go 原文 → 结构化重写；含"症状→病因"判别表与 7 条坑 |
| `tool-convergence.md` | **读数层工具收敛台账**：11 个读数工具吸收到哪 / 需要什么 / 执行顺序（★ 先收敛后补证的依据） |
| `RETIRED.md` | **删除台账**：删了什么 / 凭什么删 / 现在用什么 / 代价（防"重新发明"，与证分工见其开头） |
| `PITCH.md` | **卖点合集（活文档）**：每条卖点挂**一个可复现读数**（`tests/` 用例或一条命令）；收官材料，新功能就追加一条 |
| `GUIDE-USAGE.md` | 工具与流程（工具表 / 典型流程 / 派子代理） |
| `dogfood.md` | 用本仓工具时的体验（表） |
| `DISCUSSION.md` | 讨论留下的判断（**别处没有且仍成立**的：直链边界 / DSL 全量+笔迹 / 语义不可代验）；历史过程在 git |
| `todo.md` / `PITFALLS.md` / `MERGE.md` / `ARBITRATION.md` | 见其自身第一行 |

## 六、规矩

1. **判据只住一处**（同一口径不许住两处）
2. **失败就抛**（不许静默兜底）
3. **写文档 = 改这张表**（不新开、不追加）
4. **没做完的写进 §四**（不另开文档）
5. **读数与派生量不落盘**（"发生过什么"可存，"现在是多少"只能现算；能由事实现算的不存）
6. **判据只住 `src`**（`scripts/` 可以是薄投影，不能持有判据）
