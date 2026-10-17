# 静态审查 · 第 1 轮（不知情子代理，2026-10-17）

> ★★ 方法：**不给它任何已有结论**，只给范围（9 个文件 ≈ 3539 行 + 设计 DSL）。
> 它通读 5397 行，产出 15 条（A7 / B6 / C2）。
> ★ 对照结果：它独立发现了 **A2**（我和我自己的读法**方向相反**），并抓到 **A1 / A4 / A7** 三条我完全没看见的。

---

## A 级（会让人做错事 / 数据不一致）

### A1 · `patrolDrift` 全仓零调用方
`src/application/patrol/task_drift.ts:97`
它是 `releaseIfExpired` 的**唯一**生产调用点（`:194`），但 grep 只有定义 + 注释。
⇒ **巡检一次都不跑** ⇒ `lease_ttl` 永远不回收 ⇒ `claimed_at` 成死锁字段（该文件自己的注释就这么说）。
**怎么判**：对 `task_drift.ts` 每个 export 断言至少 1 条 cache.db call 边；今天 0 条 ⇒ 红。

### A2 · `blocked` 判据两头都漏（★ 两路独立撞到，方向相反）
`src/domain/task_machine.ts:241`
- 原条件 `pendingDeps.length === depIds.length` 只要求"依赖**全部**未完成"；
- 同时 `:236` 算出的 `orphan` 在这条分支里**被完全忽略**，而 reason 却断言"主体**全落在**节点 X 的 path 上"。

| 场景 | 旧行为 | 应为 |
|---|---|---|
| 1 条红落在未完成 dep + 1 条 orphan | ★ **blocked**（谎称"全落在"） | work（orphan 是本卡的活） |
| 1 条红落在已 done dep + 1 条落在未完成 dep | ★ **work**（假活，未完成那条领了改不动） | blocked（点名待完成 dep） |

**已修**（2026-10-17）：`blocked ⟺ own===0 ∧ orphan===0 ∧ 【存在】pending dep`；两处 reason 都按实际分句，不再撒谎。
★ 夹具实测：夹具1 → work（reason 正确）· 夹具2 → blocked（blockedBy=["nodeC"]）。
★ **过程教训**：修 blocked 的 reason 时，把谎话搬到了 work 分支（`:261` 仍写死"它们已有 done 的卡"）—— **被夹具1 抓到并二次修正**。

### A3 · claim 不是真 CAS，是 check-then-act
`src/application/design/dsl_ops/task_ops.ts:462`（配合 `:427` 读 / `:450` await / `:470` 写）
读与写之间夹一次异步 `cardStanding`；全仓无锁；`saveDSL` 只有 tmp+rename，**没有条件写**。
⇒ 共享同一 `.agent-io` 的两条写链同时 claim 时，双方都能过 `:462` ⇒ 后写覆盖先写。
**怎么判**：静态可判"写前是否重读并与判定时的 state/owner 比对"—— 不成立（`writeTask` 在 `:135` 重读但不比对）。

### A4 · 证据闸只校验形状，可与真实判定脱钩
`task_ops.ts:601`（+ `overlay.ts:140-147`）
`kind:'expectations'` 时只读调用方填的 `all_green:true / unsupported:0`，**从不与任何一次真实判定对账**；
L1 分支（`:573-585`）根本不跑 `judgeExpectations`，却照收该证据，写进卡的 verdict 恒为 `'pass'`（`:610`）。
⇒ **一张 L1 卡可用手填证据"自证"收口。**
**怎么判**：① L1 遇 `kind:'expectations'` 直接拒；② L2 断言证据与本次 report 一致（`failed===0 ∧ unsupported===0 ∧ post.length>0`）。

### A5 · 收口判据有两把尺：L1 卡永远进不了 `missed_close`
`task_drift.ts:168`（对照 `task_ops.ts:573`）
claim/complete 对 L1 卡用 `constructionVerdict`；patrol 对**所有**非终态卡一律用 `isSatisfied`；
L1 期望为空 ⇒ `cardStanding` 必给 `unknowable` ⇒ `satisfied=false` ⇒ **永远进不了 missed_close**。
★ 实测：`isSatisfied({expectations:[]})` → `satisfied=false / standing=unknowable`。
**怎么判**：夹具 —— L1 卡 + decision 已完整 ⇒ `patrolDrift().missed_close` 应含它。

### A6 · 已领卡的决策可以静默漂移（第四条死锁成因没有执行者）
`node_ops.ts:419`（对照 `task_ops.ts:299-311`）
`decision.update` 可在**任意**卡状态下改，没有地方比对"卡上的 expectations"与"节点 decision.expectations"；
而 publish 对 claimed 卡的重翻是明令拒绝的（理由正是"会把正在做的判据换掉"）。
**怎么判**：对每个 feature，`state ∈ {claimed,done}` 的 L2 卡，`card.expectations` 必须深等于 `node.decision.expectations`。纯 JSON 比较。

### A7 · 写闸只认"有 claimed 卡"，不认人、不认时效
`src/application/write_gate.ts:894`（函数 `:750`）
唯一判据是"覆盖该文件的节点上存在 `state==='claimed'` 的卡"；`assertSourceWriteRegistered(projectRoot, files)` 签名里**根本没有"谁在写"**。
⇒ 任何人改该文件都放行 ⇒ **一张别人领的、永不过期的卡 = 永久万能钥匙**。
★ **实测样本（只读）**：
- `self-2026-10-15` / `src/application/write_gate.ts` → 卡 `state=claimed owner=agent-t352`
- `task-system-plan` / `src/application/patrol/task_drift.ts` → 卡 `state=claimed owner=agent-flowcheck-1`

★★ **A1 + A7 叠加才致命**：巡检不跑 ⇒ 卡不过期 ⇒ 写闸的"有 claimed 卡"永远不会失效。

---

## B 级（摘要）

- **B1** `task_drift.ts:179/:181` 两个计数器口径与设计不一致：`missed_close` 混了 candidate+claimed；`should_void` 把 `violated`（该去修）与 `vanished`（该 void）装进一个数组 —— 处置相反。
- **B2** 设计 DSL 里的读数已过期（写 `25/12/12`，实跑 `31/27/3`），而 `invariants` 第一条就是"不落读数快照"。
- **B3** `t_void` / `t_supersede` 标 `enabled:true` 但全仓无写 `'void'`/`'superseded'` 的代码；`replaces` 无写入方。
- **B4** `blocked_by_open_question` 只有一半消费：代码只读 `enabled`，invariant 只查 OQ 还在不在；把 `enabled` 改 true、OQ1 仍开放，4 条不变量照样全 PASS（实跑 4/4）。
- **B5** `discussion_log.ts` 的 `renderMicro` / `shouldExpand` 等 **src 里零调用**（唯一调用方是探针），三个展开触发里两个零生产。
- **B6** `edit_dsl` 整批回滚只恢复 **base** 快照，overlay（进度轴权威）不在回滚范围 ⇒ 报"已回滚全部"但 overlay 里 progress=done 留着。

## C 级（摘要）

- **C1** 注释里计数过期：`expectation.ts:25` 写"五种 kind"（实为六种）；`task_ops.ts:667` 报错文案写"只有三个 op"（OP_SPECS 是四个）。
- **C2** 终态集合有两个家：`TERMINAL_TASK_STATES`（export，零使用）与 `isTerminalTaskState` 里三个字面量；且该函数收 `TaskState` 而唯一调用方喂的是 JSON 读回的裸 `state`，没走守卫。

---

## ★ 我的判断（lead）

**A1 + A7 是同一个洞的两头**，且合起来才致命：
> 巡检不跑（A1）⇒ 卡永不过期 ⇒ 写闸的"有 claimed 卡"（A7）成了永久万能钥匙
> ⇒ **"改源码前先挂任务"这条，实际上只拦住了"完全没卡"，拦不住"卡不是你的"。**

**建议顺序**：A2（已修）→ B4（一行不变量，最便宜）→ A1（把 patrol 挂上 live 重算）→ A7（给写链加身份维度，需要设计裁定）。
