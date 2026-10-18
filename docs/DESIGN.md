# 任务系统 · 设计文档

> ★★★ **2026-10-17 重写，本文件是唯一活文档。**
> 老的 54 个 md（handoff / replan / decision-sheet / review-3models / todo / 各种 discussion）**已清理** ——
> **git 有完整历史**（`git log -- docs/<老文件>`），项目外另有一份整目录备份。
> ★ **理由**：文档兼任"考古"的结果是**谁都不读**；而窗口装不下 3.3MB 的考古。

**目录**：0 三十秒 · 1 五条原则 · 2 全貌 · 3 当前真相 · 4 已知缺陷 · 5 每笔怎么做 · 6 欠账

---

## 0 · 三十秒读懂

**这是什么**：把"设计意图"变成"可判任务"的系统。

**一句话流程**：
```
设计写在 DSL 里（节点的 decision.expectations）
   → 对拍（judgeExpectations 真去读代码）→ 红
   → 红 = 任务 → publish 成卡 → claim 领 → 做 → 回执 → 验收
```

**它想防的病**：设计说了、代码没做，而没人知道。

**现在什么状态**：★ 骨架在、闸有了、但**覆盖面只有 1.7%**，且**闸管不到绕过它的人**（见 §4）。

---

## 1 · 五条原则（每条都带判据，不是口号）

### P1 · 闸是**校验器**，不是关卡
> 遇到"不通过"先问：**它会损坏数据吗？**
> · **不会** ⇒ **提醒 + 放行 + 留痕**（"没在账上"是记录问题，不是数据问题）
> · **会** ⇒ 阻断
> ★ **不问就阻断 = 造死循环。**

三种职责：**校验**（主体，输出通过/不通过+判据）· **提醒**（无害时放行）· **阻断**（例外）。
★ 每个环节要有**独立入口**；若某入口"必须有下游产物才能进"⇒ **那不是闸，是环**。

### P2 · 不打补丁，**收归进结构**
> 有补丁说明原设计有问题 ⇒ 连补丁一起重新设计。

**认补丁的四条判据**：
| 症状 | 说明它是补丁 |
|---|---|
| 别处要"记得"配合它 | 规则没进结构 |
| 它生活在目标结构"外面"（另建清单 / 另写 runner / 另挂字段） | 不是原生属性 |
| 同类问题再来一次要"再加一条" | ★ 结构缺**一维** |
| 需要注释解释"为什么要这样" | 与结构不自然 |

★ **收归 = 让错误组合在类型上无法表达**（例：`TransitionState` 三值必填，取代 `enabled` + `blocked_by_open_question`）。

### P3 · **提醒必须稀缺**
> 覆盖率 1.7% 时若每笔都提醒 ⇒ 98.3% 的操作都在响 ⇒ 半小时内学会忽略 ⇒ **噪音比没有更坏**（它看起来在工作）。

⇒ hook 每会话每文件**只提醒一次**。

### P4 · 判据必须有**执行者**
> "判据没有执行者 = 等于没有。"

每条判据三态：**machine**（有 cmd/runner）· **review**（有 `by` + `where`）· **unjudged**（★ 明确承认没人判，**不许当成"已经保证了"**）。
★ 新登记的判据**不许**是 `unjudged`。读数：`node scripts/plan-assertions.mjs`

### P5 · **一维一处**
同一件事不许两个字段/两处表达。今天的三个实例：
- `enabled` + `blocked_by_open_question` → `TransitionState`（已收）
- 设计的 `blocked_by_open_question` vs 代码的 `enabled`（已收）
- `own/foreign/orphan` 三个局部变量 → `RedAttribution`（已收）

---

## 2 · 全貌

### 2.1 代码索引（9 个文件 ≈ 3539 行）

| 文件 | 职责 | 行数 |
|---|---|---|
| `src/domain/task_schema.ts` | 任务格结构（五态 / `TaskSpec`） | 203 |
| `src/domain/task_machine.ts` | 状态机 · `cardStanding` 五值 · `RED_DISPOSITION` · `TransitionState` · TTL | 520 |
| `src/domain/expectation.ts` | 六种 kind · `phase`(pre/post) · 判定入口 | 207 |
| `src/domain/geometry.ts` | 节点/边（`path` 是正式字段） | 432 |
| `src/domain/discussion_log.ts` | 讨论登记格 | 153 |
| `src/application/design/dsl_ops/task_ops.ts` | publish / claim / release / complete | 671 |
| `src/application/design/dsl_ops/node_ops.ts` | 节点 add/update（含 decision 写入） | 504 |
| `src/application/patrol/task_drift.ts` | 漂移巡检 | 197 |
| `src/application/write_gate.ts` | 写源码前的任务闸 | 1125 |

★ 更细的符号行号见 `node scripts/…`（索引由代码生成，不手写）。

### 2.2 七步服务流程

| # | 步 | 输入 → 输出 | 门槛（判据） |
|---|---|---|---|
| 1 | 填表 | 讨论/文档/滞涩/缺陷 → `node.decision` | 有 decision 且 expectations 可判 |
| 2 | 交表 | decision → `task{state:candidate}` | ★ 无 decision / 太粗 ⇒ **生成 L1 建构卡**（不拒） |
| 3 | 上架 | 卡 → 池 | ★ **读端未建**（欠账 D-T8） |
| 4 | 接取 | 无主卡 → `claimed + owner` | ★ `cardStanding ∈ {work, violated}`（`isClaimable`）—— ★ 不是"至少一条后态判据没过"：那**双向都错**（violated 后态全过也可领；blocked 后态有红但不能领） |
| 5 | 做事 | 已领卡 → 代码 | 闸放行（该节点有 claimed 卡，★ owner 未校验） |
| 6 | 回执 | 事 → 五栏 + 读数 | `check-receipt` 五栏齐 |
| 7 | 验收 | 回执 → 读数 | 红变绿 + `unsupported=0` ★ 双验无角色（D-verifier-role） |

★★ **四条死锁的共同形态**：不是"状态不够"，而是**异常/重入分支**与**角色**两样没定义。

### 2.3 状态机：迁移**能不能走**是 `TransitionState`

```ts
{ kind: 'ready' } | { kind: 'blocked', by: OQ编号 } | { kind: 'unimplemented', why }
```
| 迁移 | 状态 |
|---|---|
| `t_claim` candidate→claimed | ready |
| `t_release` claimed→candidate | ready |
| `t_done_from_claimed` claimed→done | ready |
| `t_done_from_candidate` | ★ **blocked（OQ1 未拍）** |
| `t_void` | ★ **unimplemented**（没有代码写 `state:"void"`） |
| `t_supersede` | ★ **unimplemented**（`replaces` 无写入方也无读取方） |

★ `applicableTransitions(state)` 只返回 `ready` ⇒ **不再宣告"可走"然后撞"不支持"**。

### 2.4 卡的五个读数（`cardStanding`）

| 值 | 含义 | 可领？ |
|---|---|---|
| `work` | 有红且**本卡能改**（own 或 orphan） | ✓ |
| `violated` | 后态全过、**前态有红**（越权/非法依赖） | ✓（去拆），**不许收口** |
| `blocked` | 红**没有一条本卡能改**（全落在别人节点上） | ✗ |
| `satisfied` | 后态全过 ∧ 前态无红 | ✗（只可收口） |
| `unknowable` | 后态判不了 / 一条不剩 | ✗ |

★ **红的归属**：`RedAttribution = own | orphan | dep-pending{nodeId} | dep-done{nodeId}`
★ **处置表** `RED_DISPOSITION`：`own/orphan → claim`，`dep-pending/dep-done → wait`
★ **为什么 dep-done 也算 wait**：闸只认"**该节点**有 claimed 卡"，已 done 也一样改不动 ⇒ 处置是**重开那张卡**。

### 2.5 判据的六种 kind（都对着**代码**判）

| kind | 必填 | phase |
|---|---|---|
| `file-exists` | path | post |
| `symbol-exists` | path + symbol | post |
| `signature-matches` | path + symbol + signature | post |
| `edge-exists` | from + to | post |
| `call-exists` | path + symbol + target | post |
| `edge-absent` | from + to | ★ **pre（前态）** |

★★ **选错的后果不是报错，是【假绿】**：
- `file-exists` 证明不了"实现了什么"
- ★ **`edge-exists` 证明不了"用了对的那个符号"**（实测：要 `math.add`、写成 `mul`，边还在 ⇒ 全绿）
- ★★★ **`edge-absent` 是 pre**：未施工时天然成立 ⇒ 混进满足度会让卡显示"已满足"而实际没做

### 2.6 词表（填卡前查，别拟造）

- **出处** `provenance.source`：`doc` · `utterance`（逐字，不许改写）· `thought`（要写"何时因何想起"）· `friction`（真被卡过）· `defect`（对拍的红/体检发现）
- **判据三态** `assertion.kind`：`machine` · `review` · `unjudged`
- ★ **查不到的合法值 ⇒ 枚举不全 ⇒ 那是 L1 建构任务，不是自己拟造**

---

## 3 · 当前真相（2026-10-17 23:45 读数）

| 项 | 读数 |
|---|---|
| 设计 DSL | **11 节点** · **15 边** · **46 条期望** · task_plan 29 段 |
| 对拍 | `checked 46 / passed 41 / failed 3 / unsupported 2` |
| 判据清点 | **51 条** · machine **30** · review **4** · **unjudged 17**（17 条全部带 `debt` 编号） |
| 不变量 | **4/4 PASS** |
| 证 | 可收集 **72** 张 · 唯一机器可读 `touches` 在 `t354` |
| 覆盖 | 任务系统 9 个文件 **9/9 有节点**；★ 但 `overlay.ts` / `expectations.ts` / `status_tools.ts` 三个待改文件**无节点**（D1 的分母漏） |

★ **3 条红** = `board/pool.ts` 的 3 条（`BoardView` / `listPool` 等，文件还没建 —— 这是唯一真该写代码的地方）。
★ **2 条 unsupported**：类型判定取不到事实（原 3 条，M4 修好后降为 2）。

### 两道验收闸的记录

| 闸 | 结论 |
|---|---|
| **第一道（我审）** | ★ "看不出毛病了" —— **但漏了 18 条** |
| **第二道（不知情子代理）** | ★★ **18 条**（A6/B7/C5），已修 16 条；M1/M6 标"源码待跟" |
| **第三道（复审核修复）** | 进行中 |

★★★ **"我看不出" ≠ "没有"** —— 差多少，现在是有数的（18 条）。

---

## 4 · 已知缺陷（还活着的 12 条；**已修的不列在这里**）

### ★ 最近修好的（2026-10-17，只记结果，过程见 git）
- **A2 `cardStanding` 的红归属**：`blocked` 两头都漏（漏 orphan ⇒ 假 blocked 且 reason 撒谎；漏"部分 pending" ⇒ 假 work）⇒ 重写成 **`RedAttribution` + `RED_DISPOSITION`** 穷尽表；★ 顺带想清 **`dep-done` 也算 wait**（闸只认该节点的卡）。
- **B3 `t_void` / `t_supersede`**：标着"可走"但全仓没有代码写那两个 state ⇒ 改为 **`unimplemented`**，不再宣告"可走"然后撞"不支持"。
- **A7 写闸的「谁在写」**：原来只认"有 claimed 卡"，不认人 ⇒ 加 `WriteActor` / `resolveActor` / `assertSourceWriteRegisteredFor`；★ **三种情形三种处置**（匹配放行 / 不匹配阻断 / 无 actor 提醒+放行）。实测：`34/26/5/3` → `34/28/3/3`，`t352` 18/0。
- **B4 `blocked_by_open_question` 只有一半消费**：与 `enabled` 合成 **`TransitionState`**（三值必填）⇒ **"声明可走却挂着未决项"这个组合在类型上不存在**。

### A 级（会让人做错事 / 数据不一致）

| # | 位置 | 缺陷 | 怎么判 |
|---|---|---|---|
| **A1** | ✅ **已销（2026-10-18）**：`npm run patrol` 是运行时入口（TS 入度对运行时入口不适用）；★ 本行与 §6 的 A1 是同一问题的两种说法，已合并 | ★★★ **`patrolDrift` 全仓零调用方** ⇒ 巡检一次都不跑 ⇒ `lease_ttl` 永不回收 ⇒ `claimed_at` 成死锁字段 | 该文件每个 export 至少要有 1 条 call 边；今天 0 |
| **A3** | `task_ops.ts:462` | claim 是 check-then-act（读→判→写，中间夹异步 `cardStanding`，无锁） | 静态判"写前是否重读并比对 state/owner" —— 不成立 |
| **A4** | `task_ops.ts:601` | ★★ 证据闸只校验**形状**：L1 卡可用手填 `{all_green:true}` 收口，**从不与真实判定对账** | L1 遇 `kind:'expectations'` 直接拒；L2 断言与本次 report 一致 |
| **A5** | `task_drift.ts:168` | L1 卡永远进不了 `missed_close` | ★ **真根因见 §6「L1 判据缺口」** |
| **A6** | `node_ops.ts:419` | 已领卡的 decision 可静默漂移（第四条死锁成因没有执行者） | `claimed/done` 的 L2 卡：`card.expectations` 必须深等于 `node.decision.expectations` |


★★ **A1 + A7 叠加才致命**：巡检不跑 ⇒ 卡不过期 ⇒ 写闸的"有 claimed 卡"**永不过期** ⇒ **别人领的卡 = 永久万能钥匙**。
★ 实测样本（只读）：`write_gate.ts` 归 `agent-t352`、`task_drift.ts` 归 `agent-flowcheck-1`。

### B 级
- **B1** `task_drift.ts:179/181` 两个计数器口径与设计不一致（`should_void` 把"该去修"和"该 void"装进一个数组）
- **B2** DSL 里的读数已过期（写 `25/12/12`，实跑 `31/27/3`），而 `invariants` 第一条就是"不落读数快照"
- **B5** `discussion_log.ts` 的 `renderMicro`/`shouldExpand` **src 里零调用**（唯一调用方是探针）
- **B6** `edit_dsl` 整批回滚只恢复 **base** 快照，overlay（进度轴权威）不在回滚范围

### C 级
- **C1** 注释里计数过期（`expectation.ts:25` 写"五种 kind"，实为六种；`task_ops.ts:667` 写"三个 op"，实为四个）
- **C2** 终态集合有两个家（`TERMINAL_TASK_STATES` 零使用 + `isTerminalTaskState` 里三个字面量）

---

## 5 · 每笔怎么做（操作清单，六条）

1. **先读结构**：知道改的东西在哪、谁消费它（别信旧结论 —— 现状必须带 `file:line`）。
2. **领卡**：核对这张卡赖以成立的东西全不全（无 decision / 判据无归属 / 文件不在任何 `expectation.path` / 上游是环）⇒ 不全就**先补全**，再做事。
3. **动手**：按 §1 的 P2 —— 要改的是**缺的那一维**，不是加一条 if。
4. **验**：build · 期望对拍 · 证逐张 · `plan-assertions --fail-on-debt` · 不变量。
5. **回执**：五栏（做了什么 / 判据读数 / `[未核]` / 行为改变 / 滞涩）⇒ `docs/frictions.jsonl`。
6. **说清不确定**：给不出 `file:line` 的现状标「待核」；没跑过的写"未验证"。

★ **改中文文本用精确编辑工具**（python 引号、shell 反引号，今天各踩两次）。

---

## 6 · 欠账

★★★ **2026-10-18：本表的「待做」已批量迁成 `todos[]` 里的卡**（`todo_D-xxx`）—— **活的在 `todos[]`（能 claim/complete/void），本表保留作历史**。
★ 看活的：读 `.agent-io/design/<f>.dsl.json` 的 `todos[]`，或 `get_dsl`。

| 编号 | 内容 | 状态 |
|---|---|---|
| **A1** | `patrolDrift` 挂上 live 重算（否则巡检永不跑） | ✅ **已销（2026-10-18）**：`npm run patrol` 是运行时入口（实测 `cards:0 / missed_close:0` 能跑）；★ 原"零调用方"是 TS 入度不适用运行时入口 |
| **A7** | 写闸加 `actor` 维度（已挂卡，2 条判据真红） | ★ **形式上 done、可追溯上没完成** —— 见 `D-actor-wire` |
| **D-T8** | 上架读端（`board/pool.ts`：`BoardView` + `listPool`） | ✅ **已销（2026-10-18）**：`pool.ts` 已建，`BoardView` + `listPool` 都在；`tsc` 0 错 |
| **D-T8-wire** | 上架读端的**接入点**（`queryFeature` 住哪个文件未核） | 待核 |
| **D-verifier-role** | 第 7 步"双验"没有角色（单 agent 时无解） | 待裁 |
| ★ **L1 判据缺口** | 6 种 kind 全对着代码判 ⇒ 表达不了"DSL 自己全不全" ⇒ L1 卡建不出来。解药：`Expectation` 与 `invariant` 合成同一个可执行抽象 | 待做（**卡住 L1**） |
| ★ **D8 · kind 表达力缺口** | 表达不了"应该有人调用 X，但现在没有"（`call-exists` 要 from=调用者，而调用者不存在） | 待做 |
| **D-judge-port** | 抽 `JudgePort` 破 domain→application 倒挂（用户 2026-10-17 拍 A） | 待做（重构） |
| **D-invariant-0** | 不变量「任务=意图住设计侧」没有 check | ✅ **不是债（2026-10-18）**：`publishTask` 只读 `decision`、显式拒手写内容 ⇒ 不变量已有执行者 |
| **D-invariant-1** | 不变量「不落读数快照」—— ★ **DSL 自己违反了**（`reading_now` / `block_readings` 都是快照） | 待做 |
| **D-target-exists** | `t_claim` 的「target 在 DB 存在」无执行者（全仓 0 处） | 待做 |
| **D-release-by** | `t_release` 的「带 by」无执行者（`releaseTask` 是 `input.agent ?? null`） | 待做 |
| **D-dual-write** | `dual_write` 的三个前提都不存在（`OverlayAnchor` 无 `updated_at` / `DriftReport` 无 `authority_unknown`） | 待做 |
| **D-actor-wire** | `assertSourceWriteRegisteredFor` 零调用 + `AGENT_IO_ACTOR` 全仓无赋值 ⇒ **A7 的阻断永不触发** | ✅ **已销（2026-10-18）**：5 个生产写链已改走 `For(…, resolveActor())`，对拍 7531/7531 全绿 |
| **★★ D-updatefeature-writes-on-fail** | 子代理 B 实测：**updateFeature 任何一次调用（含失败回滚）都会重写 base** —— 把 `_sync` 整块删掉并追加 `_dsl_rev: 1` ⇒ **操作失败、数据却被动过**（回滚只回滚已应用的变更，没回滚落盘本身）。★ 严重：它让「失败」不等于「没发生」 | ✅ **已销（2026-10-18）**：回滚改成 `restoreRaw`（写回原始字节），验收 sha 不变 |
| **★★ D-complete-nonatomic** | `completeTask` 是**写一半再报错**：先 `writeTask`（写 done）再 `updateStatus`（投影），后者失败 ⇒ **状态已变 done 但调用报错**（今天 Q5 实测：todo 不在 geometry ⇒ updateStatus 报节点未找到，而 done 已落盘）。★ Q2 只修了 `updateFeature` 的回滚，**这条路径没覆盖** | ⚠️ **防御性已修（2026-10-18）**：完工前备份原始字节，失败则写回。★ **无实证**（Q5 已封 todo 路径，节点任务路径无触发场景） |
| **★ D-actor-entry** | ★★ **真正的缺陷不是"5 个写链没传 actor"，是「没人负责设置 `AGENT_IO_ACTOR`」** —— 那是一个**运行时入口**，而入口不存在。★ 而 `calls` 格式**表达不了"入口"**（它只有函数调用）⇒ **这是设计格式的缺口**，要新增一块（`runtime_entries`）才能表达。★ 已写进 `write_gate` 的 `decision.summary`（含"绝不许从卡的 owner 反推 —— 循环论证"） | 待做（**先补格式，再实现**） |
| **D-validate-decision** | `validateDSL` 不看 `decision`（M1）⇒ D3 的"✓"是假绿 | 待做（源码） |
| **D-kind-expressiveness** | 同 D8 | 待做 |
| **D-anti-decoration** | 11/15 条边没有判据 | 待做 |
| **D-parallel** | "两两交集为空"算不出来（path 覆盖率不够） | 待做 |
| **D-claim-incomplete** | "领到先查依据"由人执行，无机器检查器 | 待做 |
| **D-design-completeness** | D1–D9 本身没有检查器 | 待做 |
| — | `touches` 覆盖率 1/72（唯一机器可读声明在 `t354`） | 待补 |
| — | 历史读数快照需标 `as_of`（N5） | 待做 |
| **D-gate-text** | `task_home.gate` / `what_a_card_proves.layers[*].gate` —— 读起来像要求，但不是判据（`gate` 不在 CLAIM_KEYS） | 待做 |
| **D-edge-id-unique** | `validator.ts:73-85` 只查 `nodes.id` 唯一、**不查 `edges.id`** ⇒ 重复 id 能过校验，而 `overlay.edges` 按 id 键控会串 | 待做（源码） |

★ **判据（M18 的原话）：`debt` 值必须能在本表里查到** —— 否则它只是一句没人读的字符串。
★ **2026-10-17 补登 12 个**（N4 指出：本轮新挂的 7 个 + 修复前的 5 个，此前全仓 grep 0 命中）。

---

### ★★★ 工具审计（2026-10-18；用户要求：「结构重构过多次，工具可能是早期遗留，都看看」）

★★ **审计口径**：找一切"指向已退场路径"的东西 —— `features/`（已删）、`agent-io.json`（已停写）、`docs/*.dsl.json`（已移走）。
★ **也包括"工具对用户说的说明"** —— 因为它比代码更能误导人。

| # | 位置 | 问题 | 状态 |
|---|---|---|---|
| **1** | `stage_registry.ts:46 / :316` | import 着没用到的 `getFeatureFile`；`note` 写的是「活态 agent-io.json / 存档 features/」 | ✅ 已修（改成 `.agent-io/design/<f>.dsl.json`） |
| **2** | `board/pool.ts:9` | **我自己写的注释说「读 features/」**，而实际读 `getDSL` = design | ✅ 已修 |
| **3** | `capability_map.ts:225` | 对用户说「真相是 `features/<f>.json`」 | ✅ 已修 |
| **4** | ★★ `presentation/http/serve.ts:90` | `const LIVE_FILE = getLiveDslFile()` ⇒ **HTTP 服务读已停写的 agent-io.json** ⇒ **界面看到的是冻结数据**（`:244/:248` 与 `:2675/:2676` 两处读它） | ⬜ **待修**（要先看两处的 feature 上下文） |
| **5** | `dsl_ops/*.ts`（annotation/api/file/edge/node/feature/status/update_feature） | 全部 `getDSL`/`saveDSL` —— 这层已随 storage 改为读写 design ✓，但**没验过一条完整的 op** | ⚠️ **待验**（一次 edit_dsl 改字段 ⇒ 看 design 的 sha 变没变） |
| **6** | `design/intent/detect_drift.ts:83` | 注释里提 `getFeatureFile` | ⬜ 文案（低） |
| **7** | `meta/explore/query_feature.ts:98` | 那个 `features` 是 **query 名**（不是路径） | ✅ 无问题 |
| **8** | `refactor/diff_views/diff_views.ts:196` | 注释里引 `features/<f>.json`（历史说明） | ⬜ 文案（低） |

★★ **结论**：**代码层大多已随 `storage` 一起指向 design ✓**，但有三处**不是代码错、是"话说错了"**（1/2/3 —— 已修），
而 **4 是功能性 bug**（HTTP 界面冻结），**5 是未知**（没验过）。

★ **这条审计要持续**：以后新增任何"读 DSL"的地方，都必须问一句「**读的是 design 侧吗**」。

## 7 · 文件地图（★ 2026-10-18 统一：**设计侧只有一处**）

★★★ **此前有过两处（`docs/` 和 `.agent-io/design/`），语义盘根错节。用户要求统一 ⇒ 现在只有一处。**

| 文件 | 是什么 | 谁读它 | 进 git |
|---|---|---|---|
| **`.agent-io/design/<f>.dsl.json`** | ★★★ **设计 DSL（唯一权威）** —— 手写；结构 = fork 自实际侧 + 我改的那几处（带 `decision`） | `storage.ts#getDesignSheet` · `scripts/design-diff.mjs` | ✅ **白名单**（见下） |
| `.agent-io/live/<f>.dsl.json` | **实际 DSL**（扫描产物） | `getLiveFeatureResolved` | ❌ |
| `.agent-io/features/<f>.json` | **派生**（扫描 ⊕ overlay 合并） | `getDSL` / `edit_dsl` / 写闸 / 巡检 | ❌ |
| `.agent-io/cache.db` | 符号 / 调用 / import（`edges.kind = call 7528 · type_ref 4832 · import 1223`） | `get_dsl{query:'calls'}` 等 | ❌ |
| `docs/DESIGN.md` | 设计文档（人读） | 人 | ✅ |

### ★ `.gitignore` 的写法（有坑，写死）
```
.agent-io/*                   ← 先忽略内容
!.agent-io/design/            ← 再白名单目录本身
!.agent-io/design/**          ← 以及它的内容
certs/*/.agent-io/            ← 测试夹具里的 cache.db 也不进
```
★★ **为什么不能写 `.agent-io/`（忽略整个目录）**：git 的规矩是**父目录被忽略时，子目录的 `!` 白名单无效** ⇒ 设计侧永远进不了 git。★ 这是踩过的坑。

### 三条命令（都在这份 document 之外，靠工具）
| 命令 | 判什么 |
|---|---|
| `npm run diff` | ★ **设计侧 × 实际侧的 diff**（`+` 要建 · `-` 要补设计 · `~` 我改过的 · 边差异） |
| `npm run contract` | 符号级契约（`tsc`）—— 符号 / 签名 / 用法 |
| `npm run contract:calls` | 结构级契约（`cache.db`）—— 谁调谁（含"零调用方"反查） |
| `npm run patrol` | 漂移巡检（`cards: 0` 是诚实的：还没立卡） |

### ★★★ 对拍 = `git diff`，不是覆盖率报告
```
设计侧 = fork(实际侧) ⇒ 两边本来就该一样
⇒ "没动过"【不是差异】（两边一样，git diff 不显示）
⇒ 只显示：+ 只在设计侧 · - 只在实际侧 · ~ 两边都有但内容不同
```
★ **所以不要"进度百分比"** —— 设计不是"把 N 个都设计一遍"，是**只改自己要改的那几处**。


## 8 · 设计 DSL 的规范（★ 2026-10-18 第二版：三层三种格式）

★★★ **为什么改两版**：第一版写「三层：文件 / 符号 / 判据」——方向对，但**符号层用"JSON 里加一段"是错的**。
用户指出了两件事，把答案逼出来了：
1. **"DB 和 DSL 本来就是同一个模型"** ⇒ 符号层**不该是"外部事实 + 新增一段"，而是 DSL 的一层**；
2. **"有没有 LLM 天生就认识的格式"** ⇒ **有：TypeScript 声明**。用它，LLM 不用学我们这套 DSL。

### 8.1 三层三种格式（每层用它的**最优载体**，不强行统一）

| 层 | 载体 | ★ 为什么是它 |
|---|---|---|
| **符号级** | ★★★ `design/<f>.d.ts` | **LLM 天生会写**（不用重学）· **`tsc --noEmit` 免费校验**（不用自写 `validateDSL`）· 与已有的 `signature-matches` **天然对齐** |
| **结构级** | `design/<f>.json` | 文件 / 边 / 调用 —— ★ **类型系统表达不了**（它只有"导出/引用"，没有"调用"） |
| **行为级** | `design/<f>.cases.json` | 判据 + 夹具 —— ★ 类型系统**表达不了"5 个分支都对"** |

★★★ **"DB 和 DSL 合并"的落点就在这里**：`cache.db` 不再是"外部事实"，而是**符号级的解析产物**。

```
设计侧.d.ts = 人手写                （意图：我要这些导出、这些签名、这些依赖）
实际侧.d.ts = project(cache.db)     （事实：代码里真有哪些导出/签名/依赖）
⇒ ★ 对拍 = 两份 .d.ts 比，用 tsc
```

### 8.2 对拍三条线（每条用**现成工具**，不自写）

| 线 | 设计侧 | 实际侧 | ★ 用什么判 |
|---|---|---|---|
| **① 符号** | `design/<f>.d.ts` | `tsc` 产物 / `cache.db` 投影 | ★★ **`tsc --noEmit`**（免费） |
| **② 结构** | `design/<f>.json` | `live/<f>.dsl.json` | 逐条比（节点 / 边 / 调用） |
| **③ 行为** | `design/<f>.cases.json` | 跑代码 | 夹具（输入 → 期望输出） |

★ **②的现状（今天实测）**：节点 **10/11 能比**（真差异 1 = `board_pool`）；**边不能比**（live 的边是 `contains`，设计的是 `imports`）；**调用**在 `cache.db` 里是齐的（`calls` 45 条带行号）——
★ 所以**②的"调用"部分应该对 `cache.db` 比，不对 live 比**。

### 8.3 为什么 `.d.ts` 是关键 —— 它一次解决今天三个"表达不了"

| 今天撞的墙 | `.d.ts` 怎么解 |
|---|---|
| **D8**：`call-exists` 要 `from`=调用者，而调用者不存在 ⇒ 写不出"应该有人调 X" | ★ **换问题**：`.d.ts` 只声明"谁**导出**什么"（这个写得出来），**"谁调它"交给结构级**（`cache.db` 有事实）⇒ **不再需要那种 kind** |
| **M4**："复用 `TaskDiscussion` 的类型"只能判"文件间有 import" | ★ `.d.ts` 里 `import type { TaskDiscussion }` **就是复用** ⇒ **`tsc` 直接判** |
| **M1**：`validateDSL` 根本不看 `decision` | ★ 符号级**不再靠 `validateDSL`**，靠 `tsc`（它本来就只看类型） |

★★ 而 `signature-matches` 这个 kind **从此有了免费实现**：**它就是"设计 `.d.ts` 的签名 vs 实际声明"** —— 不需要自写比较器。

### 8.4 版本化：设计可分支、**事实不分支**

```
设计侧 = fork(实际.geometry) + decision + 结构/符号/行为三层   ← 可分支（意图）
实际侧 = cache.db + live + tsc 产物                          ← ★ 不分支（事实）
对拍   = 设计侧 × 实际侧（三条线）
merge  = 三条线全绿 ⇒ 分支意图被主支实现
```

★★★ **"事实不分支"和 git 不分支工作区是同一个道理** —— 事实**只能被观察，不能被设计**。
★ 所以"分支 DB"不行；但 **"设计侧要有符号级意图"是对的** —— 只是它的载体是 **`.d.ts`**，不是"另一份 DB"。

### 8.5 规范 vs 当前实现（这才是"重写"的工作量）

| 规范要求 | 当前 | 差距 |
|---|---|---|
| **符号级 = `.d.ts`** | 无（只有 6 种 kind 的零星 `symbol-exists`） | ❌ **整层没有** |
| 理想：`tsc` 对拍 | 自写 `validateDSL`（且不看 decision） | ❌ |
| 结构级可对拍 | 节点 ✅ / **边 ❌（语义不同）** / 调用（在 `cache.db`，没接） | ⚠️ 半 |
| 行为级 = 判据 + 夹具 | 46 条 expectations（无夹具） | ⚠️ 半 |
| 设计侧进 git、事实不进 | `docs/` vs `.agent-io/` | ✅ 已对 |
| `get_dsl` / `edit_dsl` 读写设计侧 | ★ 读写 `features/`（派生） | ❌ **两套世界** |
| `rebuild_design` 能 fork 自实际 | ★ 调了**没生效** | ❌ **未做成** |

★★★ **这七条就是重写的工作量** —— 而**第 1 条（符号级换成 `.d.ts`）是根，其余六条都在它下面**。

## 9 · 设计的四层（★ 2026-10-18 用户定义 —— 「改设计」到底改几层）

★★★ **用户原话**：
> "改设计并不是让你只碰 decision。初步改功能是先决策上加一个功能，然后向下补齐这个功能需要什么样的约束，
> 再向下补齐它和现有功能的依赖关系，再向下延伸到源码 —— **就是和实际是反着来**。
> 实际是有源码，然后从代码上计算出它的依赖等一切，再去形成这一份设计 DSL。
> **我们要做的就是逆着再回去，把它从设计变为源码**。"

### 两个方向，同一棵链

```
实际侧（推算，向上）：  ④ 源码  →  ③ 依赖  →  ② 约束  →  ① 意图
设计侧（设计，向下）：  ① 意图  →  ② 约束  →  ③ 依赖  →  ④ 源码
                       ↑ 改设计改这三层 ↑                  ↑ 这是"实现"
```

| 层 | 是什么 | 在 DSL 里 | 改它的工具 |
|---|---|---|---|
| **① 意图** | 加一个功能，做什么 | `decision.summary` / `acceptance` | ✅ `npm run dec` |
| **② 约束** | 这个功能需要什么符号 / 签名 / 行为 | `decision.expectations`（6 种 kind） | ✅ `npm run dec --add-expectation` |
| **③ 依赖** | 它和现有功能的关系（谁依赖谁、谁调谁） | `geometry.edges`（文件级）· 设计 DB 的 `calls`（符号级） | ❌ **没有工具**（★ 缺） |
| **④ 源码** | 逆着再回去，把设计变成代码 | —（不是 DSL） | ✍️ **写代码**（不是工具） |

★★★ **所以「改整个设计」= 改 ①②③ 三层** —— **而 ④ 是"实现"，它靠写代码，不靠工具。**
★ **而 `npm run dec` 只做了 ①（和一点 ②）** ⇒ **③ 是当前缺的那一层。**

### ★ 为什么 ③ 必须显式设计（不能靠 ④ 反推）

如果只在 ① 写"要一个 `listPool`"，② 写"它返回 `BoardView`" ——
**那"它依赖谁"就只能等写完代码再扫出来** ⇒ **设计就不完整了**（回到"实际侧推算"那条路）。
⇒ **③ 必须在设计侧显式写下来**：`listPool` 依赖 `task_schema.ts#TaskState`、依赖 `storage.ts#getDSL`。
★ 而它已经有一个现成的载体：**设计 DB 的 `*.calls.json`**（现在是从实际 fork 来的**事实副本**）——
**"改设计"就是在这份副本上【加 / 删】**：
```
删一条 calls  ⇒ 设计说"这个调用不该有" ⇒ 实际还有 ⇒ ★ 差异（要改代码）
加一条 calls  ⇒ 设计说"这个调用必须有" ⇒ 实际没有 ⇒ ★ 差异（要接线）
```

### 所以「逆着回去」的完整动作（设计侧）

```
① npm run dec --node X --summary "我要加一个能力"
② npm run dec --node X --add-expectation '{kind,path,symbol,why}'
③ ★ npm run dep --from <fileA#fn> --to <fileB#fn> --why "…"     ← 缺，要做
④ 写代码（实现）→ npm run contract / contract:calls / diff / patrol 验
```

★ 而 **`git diff .agent-io/design/`** 就是这条链的版本控制 —— **每一步都能回退**。


## 10 · 决策卡 = 任务工会的登记表（★ 2026-10-18 用户定义）

★★★ **用户原话**：
> "每一个 Agent 来了之后要填一张表单，决策卡 —— 创办人是谁（自动获取 Agent 编号），
> 设计来源是文档还是用户的某一段话。然后把那部分 DSL 进行修改，或者角色卡就挂在这里也可以。
> **只决策卡，然后留待下一个子代理根据决策卡和要求进行设计。**
> 就像是任务工会……你觉得需要有什么栏目，你就迁移到这里。"

### 一张表（照现实办事大厅的栏目迁）

| 工会栏目 | 决策卡字段 | 谁填 | 现状 |
|---|---|---|---|
| **办事编号** | `node.id` | 系统 | ✅ |
| ★ **申请人** | `decision.creator`（**Agent / 子 Agent 编号，自动获取，不许手填**） | 系统 | ❌ **缺** |
| **事由** | `decision.summary` | 填单人 | ✅ |
| ★ **依据** | `decision.source`（`{kind:'doc'\|'user', ref:'…'}` —— 文档出处 / 用户原话） | 填单人 | ❌ **缺** |
| **受理窗口** | `decision.scope`（功能线 / 模块） | 填单人 | ❌ 缺 |
| ★★ **交办** | `decision.handoff`（下一棒：`design` \| `impl` \| `verify` + 要求） | 填单人 | ❌ **缺** |
| **材料清单** | `decision.expectations` | ★ **设计的人**（**不是**填单人） | ✅ |
| **经办人** | `task.owner` | claim 的人 | ✅ |
| **状态** | `task.state` | 系统 | ✅ |
| **时限** | `decision.deadline` / `task.ttl` | 填单人 | ❌ 缺 |
| **结果** | `decision.result`（办成了什么 / 交付物） | 办结的人 | ❌ 缺 |
| **备注** | `decision.notes` / 卡上的 `frictions` | 任何人 | ⚠️ 部分 |

### ★★★ 而这张表的核心语义，是**分工**而不是**信息**

```
"只决策卡，然后留待下一个子代理根据决策卡和要求进行设计"
⇒ ★ 填单人【只写要什么】（summary + source + scope）
⇒ ★ 设计（补 expectations + calls）是【下一棒】的活
⇒ ★ 实现（写代码）是【再下一棒】
⇒ ★ 验收（judge + 收口）是【巡检/人】
```

★★★ **所以 `handoff` 是必须的栏目** —— **没有它，单子就停在填单人手里**（而今天所有的卡都是这样：填了 summary，没人接着设计）。

### 和现有字段的关系（不新造一套）

| 已有 | 归到哪个栏目 |
|---|---|
| `decision.summary` | 事由 |
| `decision.acceptance` | ★ **交办要求**（"办到什么程度算成"）—— 它其实是 `handoff` 的一部分 |
| `decision.expectations` | 材料清单（判据） |
| `decision.agent` | ★ **申请人**（现在只在 `edit_dsl` 里写，而且叫 `agent` 不叫 `creator`） |
| `task.owner` | 经办人 |

★ **所以要补的只有 3 个字段**：`creator`（= 现成的 `agent` 改名/固化）、`source`、`handoff`。
★ 而 `scope` / `deadline` / `result` 可以先不做（不是每张单都需要）。

### ★ 一个判断：`creator` 必须**自动获取**，不许手填

★ 理由和 `actor` 一样：**手填的申请人 = 自报家门**。
★ 而它和 `actor` 的区别：`creator` 是**填这张单的人**（一次），`actor` 是**写代码的人**（每次）—— 两者可以不同（填单人 ≠ 实现人），★ **而 `handoff` 就是它们之间的桥**。


## 附 · 文件约定

- **`docs/task-system-plan.dsl.json`** —— 设计数据（不是文档）
- **`docs/frictions.jsonl`** —— 滞涩台账（程序读；也是 `provenance.kind='friction'` 的出处）
- **`docs/discussion-log.md`** —— 讨论登记（`provenance.kind='doc'` 的出处）
- **本文件** —— 唯一的文档。★ 新增内容进这里，**不要再开新 md**。
