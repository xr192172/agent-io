# 现状

> 只有现状。没有历史、没有原话、没有理由。新的东西**改这张表**，不新开文档。

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
| `design-db/` | 344 份 `.calls.json`：设计 DB（从 DSL 派生，`gen-db` 全量重写） |
| `certs/` | 证（`t*-cert.mjs`）+ 量具 + 夹具。**不受写闸管** |
| `scripts/` | 运维脚本（verify / gen-db / 各种探针）。**不受写闸管** |
| `docs/` | 见 §五 |

## 二、工具（65 个，常用的这些）

| 工具 | 干什么 |
|---|---|
| `edit_dsl` | 改设计侧：`decision` / `task`(publish·claim·complete·reopen·relaunch·void) / `node` / `todo` |
| `design_line` | 设计链读侧：`report` / `diff` / `rewrite`(只拉签名) / `gen-db` |
| `get_dsl` | 查：`nodes` `node` `edges` `files` `file` `decisions` `pending` `pool` `scope` |
| `edit_code` | 改源码：`replace_text` / `range` / `symbol` / `insert`。**走写闸 + 重建索引** |
| `rename_files` / `move_symbol` | 改名 / 移动符号。**走写闸** |
| `import_project` | 重扫实际侧 → `live/` + `cache.db` |
| `find_references` / `explore_code` | 查引用 / 探索 |
| `review_changes` | PR 流程：`list` / `show` / `approve` / `reject` |
| `consistency_check` / `detect_drift` | 一致性 / 漂移 |

## 三、功能与状态

| 功能 | 干什么 | 状态 |
|---|---|---|
| 任务卡 | 节点上挂卡：`candidate`→`claimed`→`done`，判据在 `decision.expectations` | ✅ |
| 判据 8 kind | `file-exists` `symbol-exists` `signature-matches` `edge-exists` `edge-absent` `call-exists` `source-has` `run` | ✅ |
| 写闸 | 改源码须有 claimed 卡；`gate:'exempt'` 的节点免闸 | ✅ 已真拦 |
| A7 | `owner ≠ actor` ⇒ 拒 | ⚠️ 见 §四 |
| 重写 | `design_line rewrite`：只把源码签名拉回设计签名 | ✅ 不生成实现 |
| 设计 DB | `gen-db` 从 DSL 派生 344 份 | ✅ 有第 6 道门 `gen-db-check` |

## 四、未完成

| 什么 | 在哪 |
|---|---|
| A7 在 4 条写路没接 `actor`（`rename_file`/`rename_files`/`symbol_move`/`apply_refactor_plan`） | 那三个文件被 `codebuddy-deepseek` claim 着，先 release |
| A7 默认仍是"提醒+放行"（`AGENT_IO_ACTOR_STRICT=1` 才拦） | `write_gate.ts` |
| 自报拦不住冒充（stdio 拿不到可信身份） | 架构限制，非缺陷 |
| L1 建构卡收不了口（`publish` 只能立 L1，`complete` 要求建构完整） | `task_ops.ts` |
| ~~`satisfied` 锁死文件~~ 已修：`claim` 加 `intent=work|modify` | ✅ |
| `edit_code` 接受空操作（`old_text == new_text` 也回 ✓） | `edit_code.ts` |
| 4 个脚本仍 import `dist`（tsx 已装未用） | `scripts/` |
| `hook-task-gate.mjs` 是死闸（读不存在的文件 + 按 `path` 匹配而节点无 `path`） | `scripts/` |
| `docs/gate-principle.md` 不存在，却仍被多处引用（grep 便知） | 引用点 |
| 12~25 个节点指向盘上不存在的路径 | `.agent-io/design/` |
| `t337` 前提已破（两个 writer 写同一文件） | `certs/` |
| 写闸只拦 MCP 工具面，`bash` 直写不拦；`.githooks/pre-commit` 只跑 `gen_agents` | 覆盖面 |
| 93% 的 `src/` 文件不在任何 feature 的节点里 ⇒ 改它们走"无任务可挂、放行" | `.agent-io/design/` |

## 五、文档

| 文件 | 是什么 |
|---|---|
| `INDEX.md`（本文件） | **唯一入口** |
| `AGENTS.md` | 开发动作 → 必用工具（**由 `scripts/gen_agents.mjs` 从 `TRIGGER_ROWS` 生成，别手改**） |
| `README.md` / `README.en.md` | 项目是什么 + 怎么跑 |
| `CONTRIBUTING.md` | 加/删工具要动哪几处 |
| `GOAL.md` | 为什么做这个 |
| `VISION.md` | 用户对每个功能的描述（原话） |
| `DESIGN.md` | 缺陷台账（A/C/D 节） |
| `GUIDE-GATE.md` | 门的清单（verify 6 道门 / 证的四态 / 判据 8 kind） |
| `GUIDE-USAGE.md` | 工具与流程（工具表 / 典型流程 / 派子代理） |
| `dogfood.md` | 用本仓工具时的体验（表） |
| `DISCUSSION.md` | 讨论日志（**只读，不是权威**） |
| `todo.md` / `certs-4-ways.md` / `PITFALLS.md` / `HANDOFF.md` / `MERGE.md` / `ARBITRATION.md` | 见其自身第一行 |

## 六、规矩

1. **判据只住一处**（同一口径不许住两处）
2. **失败就抛**（不许静默兜底）
3. **写文档 = 改这张表**（不新开、不追加）
4. **没做完的写进 §四**（不另开文档）
