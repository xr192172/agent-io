# 应该是什么

> 只有现状与目标。`✅` 已成立 / `⚠️` 部分成立 / `❌` 未成立。两处说法冲突的放 §冲突，待裁。

| 功能 | 应该是什么 | 现在 |
|---|---|---|
| 渐进式披露 | DSL（浅）→ 设计 DB（深一层）→ 源码（最深）；DSL 不装深的东西，越深越交给 DB 与源码 | ✅ `get_dsl{query:'calls'}` 读索引 |
| 实际侧 | 源码往上抽象成 live DSL + 符号库；重扫即可重算 | ✅ `import_project` → `.agent-io/live/` + `cache.db` |
| 实际侧会被重扫覆盖 | 所以设计侧 fork 一份；源码只有一份，设计侧不留源码副本 | ✅ `.agent-io/design/*.dsl.json`，无源码副本 |
| 事实不分支 | 设计侧可分支（意图）；实际侧不分支（事实），事实只能被观察 | ✅ `live/` 与 `cache.db` 每次重扫重建 |
| 设计方向 | 意图 → 约束 → 依赖 → 源码，与实际侧反着来 | ⚠️ ① `decision` ② `expectations` 有落点；③ 依赖层是派生的（见 §冲突） |
| 三层载体 | 符号级 `.d.ts`（`tsc` 免费判）· 结构级 JSON · 行为级 判据 + 夹具 | ❌ 只有结构级；符号级无载体，行为级无夹具 |
| 结构级对拍 | 节点 + 边 + 调用逐条 diff；只显示"改过的那几处"，不报进度百分比 | ⚠️ `design_line action=diff` 可跑（边可比）；`npm run diff` 指向缺失脚本 |
| 重写 | 只把源码签名拉回设计签名；不生成实现、不写函数体、不改设计侧 | ✅ `design_line action=sync-signatures` |
| 重写的方向 | 渐进深入（意图 → DSL → DB → 源码），重算逐层返回（源码 → 实际 DB → 实际 DSL） | ✅ 两段都在（`gen-db` / `import_project`） |
| 一致即证明 | 对拍 → 改源码 → 重算 → 再对拍一致 ⇒ 实现与设计对得上 | ✅ 四段都可跑 |
| 决策卡 | 登记表：编号 / 申请人 / 事由 / 依据 / 交办 / 材料 / 经办 / 状态 / 结果 | ⚠️ 有 summary / acceptance / expectations / owner / state；缺 creator / source / handoff / result |
| 决策卡自足 | 无上下文的 agent 只看一张卡，就知道做什么、做到什么程度、交给谁 | ❌ 缺 `handoff` ⇒ 单子停在填单人手里 |
| 分工 | 填单人只写要什么；补判据是下一棒；写代码再下一棒；验收是巡检/人 | ⚠️ 字段支持，无强制 |
| 决策卡作用域 | 一张卡管一群互相连通的点（一个功能牵动的那一片） | ❌ `decision.scope` 只是一行字符串；连通点不落库 |
| 任务卡 | 节点上挂卡：candidate → claimed → done / void；判据在 `decision.expectations` | ✅ 迁移表唯一 = `TRANSITIONS` |
| 卡的两个级别 | 无可判判据 ⇒ L1 建构卡；有后态判据 ⇒ L2 实现卡 | ⚠️ L1 收口走 `constructionVerdict` 旁路；巡检看不见（DESIGN A5） |
| 领卡 | 有活可干才可领（work / violated）；**判据已全过的文件仍可被领走改**（satisfied + `intent:'modify'`，取写权） | ✅ `isClaimable(standing, intent)` |
| 无节点任务 | `todos[]` 与 task 同一套状态机、同一套 op、同一个池子 | ✅ `todo` 走 claim / release / complete / void |
| todo 的验收 | 没有 expectations（判不了），只收 attestation | ⚠️ 实际三档 evidence 都收 |
| todo 的巡检 | patrol 把 todos 一起判（漏收口 / 应作废同样适用） | ❌ patrol 只判节点卡；todos 只出 `pending_design` |
| 待办账 | 拿到一条先校验"症状还在不在"；不在了就 void（常见原因不是修好，是被后来的功能覆盖） | ✅ `void` / `relaunch` 能表达 |
| 写闸 | 改源码须有 claimed 卡；不损坏数据 ⇒ 提醒 + 放行 + 留痕，会损坏才阻断 | ✅ 默认提醒；`AGENT_IO_ACTOR_STRICT=1` 才阻断 |
| 身份 | 每次写都要有 actor；actor 不许手填、不许从卡 owner 反推 | ⚠️ 有 actor 维度；无运行时入口负责设置 |
| 提醒 | 每会话每文件只提醒一次（噪音比没有更坏） | ✅ |
| 判据 | 每条都要有执行者：machine / review / unjudged；新登记不许 unjudged | ✅ 三态，读数 `node scripts/plan-assertions.mjs` |
| 一维一处 | 同一件事只在一个字段、一处表达 | ✅ 收归 `TransitionState` / `RedAttribution` / `CLOSED_TASK_STATES` |
| 不打补丁 | 修一处就整块重写；补丁说明结构缺一维 | ✅ 规矩（无可判形态） |
| 三个工具 | 智能读 / 智能编辑 / 智能重写直接操作源码，依赖关系由它们处理 | ✅ `explore_code` / `edit_code` / `apply_refactor_plan` |
| 设计侧写入口 | 改设计走工具，不靠脚本脚手架；节点 / 边 / 判据都能加 | ⚠️ `edit_dsl` 有 decision / expectation / node / edge / todo op；依赖层仍靠 `scripts/dep.mjs`（见 §冲突） |
| 影响面 | 设计侧 DB 要能回答"改这里会炸哪里" | ❌ `design-db` 只有 symbols / imports / calls，无闭包 |
| 影响面的来源 | 设计侧自足算（`calls` 反向闭包）或接 `impact_analysis`（带证据行 + 风险排序） | ⚠️ 两条都没接 |
| 设计 DB 的形态 | 全量副本 + 只写增量；"没动的部分" = 设计认可现状 | ⚠️ `gen-db` 按事实全量重写；`dep` 的增删会被冲掉 |
| 文档 | 只留现状；历史交给 git | ✅ |

## 冲突

### `design-db/*.calls.json`：只读镜像，还是可写的设计意图？

```
gen_db.ts 头注：全量镜像、"不许手改，改了下次生成就冲掉"
scripts/dep.mjs：在 calls 上 --add / --remove，作为"设计说该有 / 不该有"
⇒ 两者同时存在 ⇒ dep 的增删会被下一次 gen-db 覆盖
```

待裁：

- **A**：`calls` 只读（事实镜像）；意图只住 `requirements_calls` ⇒ `dep` 退场
- **B**：`calls` 可写；`gen-db` 保留 `removed` 与新增条目，不整份覆盖
