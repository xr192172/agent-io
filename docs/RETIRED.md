# RETIRED.md — 当前仍有效的否决与回炉条件

> 只记当前仍会阻止重新发明的否决。完整历史在 Git 与 ledger，不在当前树堆档案。

| 日期 | 退役对象 | 性质 | 判据 | 现在用什么 | 代价 |
|---|---|---|---|---|---|
| 2026-11-18 | `task-system-plan` 计划册整册作为活册 | ① 被取代 | owns、path 节点、判据、多册持有、属主错位与孤儿卡均已归零后，不得把空壳复活成第三本活册 | 活册仅 `agent-io` + `agent-io-toolface`；原资产原样留在 `.agent-io/design/archived/task-system-plan.dsl.json`，redirect 与同 SHA 约束见 archived README | 不再为空壳付读取与分母成本；其 invariant / feature_tree / history / annotations 仍由现存消费者读归档件 |
| 2026-11-02 | `rename_files` 目录假读数的历史说明 | ⑤ 故事搬家 | 传目录若被当成文件接受，会返回 `ok:true` + 空 `references`，据此落盘可能静默改断目录内 import；失效形态必须仍可由工具描述定位到本行 | 守卫住 `rename_files.ts#renameFiles`：from 必须是文件，目录一律拒；工具描述保留失效形态与本行指针 | tools/list 不再携带整段历史，但行为守卫和回归判据不丢 |
| 2026-11-04 | `AGENTS.md` 的「动作 → 工具」表、生成器与 `--check` 门 | ③ 重复发明 | 同一工具事实不得再有第二份可写表 | `ToolDef.description`；`capability_map` 导航 | 手工映射不再提供；无独立回炉需求 |
| 2026-10-23 | 画布批注 / on-canvas approval 作为权威审批层 | ① 被取代 | 前端不得另写设计/审批真相 | decision/review queue、ledger 裁定、写闸 | 人不能直接在画布批注；出现独立人审契约时另立项 |
| 2026-10-22 | 任务状态 `superseded` | ③ 重复发明 | 状态词表不得新增同义状态 | `superseded_by` + supersede 事件；旧行不再是 current | 无；取代是关系，不是状态 |
| 2026-10-31 | `certs/` 作为第三套验证体系 | ③ 重复发明 | 新行为必须进入统一测试/判据门 | `tests/` 与 `npm run verify` | 无独立 runner；不回炉 |
| 2026-10-28 | 独立 `observe_log` / `observe_trace` / `observe_proposals` 等多入口 | ③ 重复发明 | 同对象观察不得新增平行入口 | 单一 `observe` action | 只有现有 action 无法表达的新观察形态才另立项 |
| 2026-10-29 | 单语言对下扩大体 IR / 双渲染器 | ② 做得不够好 | 单语言对未证明质量收益时不得扩大 | 名词/概念层、提取完整性、术语决策、行为对拍 | 冻结当前覆盖；回炉见 **R1** |
| 2026-11-19 | 把手机/远程 UI 当 AgentIO 第二控制面或第二真相源 | ① 被取代 | 写路径只能引用唯一权威，不得另存会话/审批真相 | 通用宿主无关层 + 当前账本/设计册 | 当前不做 DSH 专属插件；通用层与真实项目验收后另议 |
| 2026-11-17 | 手写 `docs/todo.md` 当前任务清单 | ① 被取代 | 生成视图不得被手改 | ledger + `ledger:render` / `ledger:check` | 无；手改生成物会形成第二真相 |

## 回炉登记

### R1 · 体 IR / 双渲染器

只有至少三种语言、或出现明确跨语言复用需求时才重新评估；先证明事实提取和术语层无法承载，再决定是否扩大，不以“更完美”为理由。

## 写入规则

新增退役项必须同时在 ledger 留事件：对象、性质、判据、替代路径、代价、回炉条件。当前树只保留仍会约束后续设计的极薄条目。
