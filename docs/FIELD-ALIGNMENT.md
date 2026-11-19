# FIELD-ALIGNMENT.md — 字段 ↔ 源码 / 存储对齐

> 本文只描述字段的权威住处与派生关系。字段名以当前代码/schema 为准；不抄数量、不抄百分比。

## 1. 三层数据

| 层 | 住处 | 写入者 | 不得复制为 |
|---|---|---|---|
| 实际事实 | 源码 + 索引（`cache.db` / live） | import / sync | 可编辑设计事实 |
| 设计意图 | `.agent-io/design/*.dsl.json` | `edit_dsl` | 工具描述 / 手写清单 |
| 执行事件 | tasks.db ledger / task_history | ledger 工具 / 写端 | 当前事实字段 |

## 2. 设计侧字段

| 字段 | 权威住处 | 派生/消费者 |
|---|---|---|
| `geometry.nodes[]` | 设计册 JSON | `get_dsl` / `design_line` / gen-db |
| `decision.summary` | 节点 decision | `get_dsl query=decisions`、设计读视图 |
| `decision.expectations[]` | 节点 decision | `judgeExpectations`、`design_line judge`、claim/complete |
| `task.state/owner/evidence` | 节点 task（经 TaskSpec） | `task_ops` 状态机、写闸 |
| `semantic.files[].path` | 设计册语义层 | 写闸路径定位、`design_line`、结构检查 |
| `expected_apis` | 设计册，但派生条目由源码事实重算 | 派生门、签名对拍；人改后要有签名/行为判据支撑 |
| `excluded[]` | 设计册 / 归属域表 | structure-gate；必须带 reason，且不能与节点声明并存 |

判据只住 `decision.expectations`；任务卡不自持判据。

## 3. 判据字段

| 字段 | 含义 |
|---|---|
| `kind` | 判据类型；种类与名字只在 `expectation_kinds.ts#KIND_SPECS` |
| `path` / `symbol` | 主体定位；不是独立预期 |
| `cases[].given/expect` | 独立输入输出；`behavior-cases` 的核心 |
| `must` / `mustNot` | 文本约束；剥注释后判定；不能替代行为判据 |
| `why` | 人/模型写的理由；不是判定本身 |
| `judgement_ref` | 计划到判据的稳定引用：`decision:<node>#<index>` 形式由现有对象定义 |

## 4. 台账字段

| 字段 | 权威住处 | 语义 |
|---|---|---|
| `ledger_rows.state` | tasks.db | `active` / `done` / `void` |
| `ledger_rows.superseded_by` | tasks.db | 取代关系，不是状态；旧行仍 active |
| `ledger_rows.closed_reason/closed_evidence` | tasks.db | 销账时必须非空；历史由 close 事件逐字保留 |
| `ledger_events` | tasks.db | append-only；禁止 UPDATE/DELETE |
| `ledger_review_queue` | tasks.db | 机器判不了的未消项；resolve 只记人已裁，不自动消矛盾 |

当前任务 = `state='active' ∧ superseded_by IS NULL ∧ record_kind='task'`；是否纳入某视图由该视图显式声明，不能多处口径漂移。

## 5. 事实新鲜度

| 状态 | 含义 |
|---|---|
| fresh | 索引对应当前源码版本 |
| stale | 索引落后；依赖它的判据为不可判定 |
| unsupported | 前置能力缺失或无法比较 |
| pending | 等待外部执行/条件 |

新鲜度由 `index_integrity/fileFacts/indexStaleFor` 一类现有路径现算；不手写 SQL 或正则替代。

## 6. 对齐原则

1. 从事实能现算的，不存成第二份可编辑意图。
2. 人写字段必须有真实消费者；没有消费者就不要求填写。
3. 占位值不算已填：文件名回显、自动统计文案不是职责。
4. 百分比只能是日志；判据只回答通过/不通过。
5. 字段迁移先问现有对象为什么表达不了，新增字段必须指名消费者与反例。
