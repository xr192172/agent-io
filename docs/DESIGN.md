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
| **A1** | `task_drift.ts:97` | ★★★ **`patrolDrift` 全仓零调用方** ⇒ 巡检一次都不跑 ⇒ `lease_ttl` 永不回收 ⇒ `claimed_at` 成死锁字段 | 该文件每个 export 至少要有 1 条 call 边；今天 0 |
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

| 编号 | 内容 | 状态 |
|---|---|---|
| **A1** | `patrolDrift` 挂上 live 重算（否则巡检永不跑） | 待做（最致命） |
| **A7** | 写闸加 `actor` 维度（已挂卡，2 条判据真红） | ★ **形式上 done、可追溯上没完成** —— 见 `D-actor-wire` |
| **D-T8** | 上架读端（`board/pool.ts`：`BoardView` + `listPool`） | 待做（3 红） |
| **D-T8-wire** | 上架读端的**接入点**（`queryFeature` 住哪个文件未核） | 待核 |
| **D-verifier-role** | 第 7 步"双验"没有角色（单 agent 时无解） | 待裁 |
| ★ **L1 判据缺口** | 6 种 kind 全对着代码判 ⇒ 表达不了"DSL 自己全不全" ⇒ L1 卡建不出来。解药：`Expectation` 与 `invariant` 合成同一个可执行抽象 | 待做（**卡住 L1**） |
| ★ **D8 · kind 表达力缺口** | 表达不了"应该有人调用 X，但现在没有"（`call-exists` 要 from=调用者，而调用者不存在） | 待做 |
| **D-judge-port** | 抽 `JudgePort` 破 domain→application 倒挂（用户 2026-10-17 拍 A） | 待做（重构） |
| **D-invariant-0** | 不变量「任务=意图住设计侧」没有 check | 待做 |
| **D-invariant-1** | 不变量「不落读数快照」—— ★ **DSL 自己违反了**（`reading_now` / `block_readings` 都是快照） | 待做 |
| **D-target-exists** | `t_claim` 的「target 在 DB 存在」无执行者（全仓 0 处） | 待做 |
| **D-release-by** | `t_release` 的「带 by」无执行者（`releaseTask` 是 `input.agent ?? null`） | 待做 |
| **D-dual-write** | `dual_write` 的三个前提都不存在（`OverlayAnchor` 无 `updated_at` / `DriftReport` 无 `authority_unknown`） | 待做 |
| **D-actor-wire** | `assertSourceWriteRegisteredFor` 零调用 + `AGENT_IO_ACTOR` 全仓无赋值 ⇒ **A7 的阻断永不触发** | 待做（源码） |
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

## 7 · 文件地图（★ 四份东西，别混）

★★★ **2026-10-18 查清并写死** —— 此前一直混着用，导致"在错的对象上做验证"。

| 文件 | 是什么 | 谁读它 | 存在吗 |
|---|---|---|---|
| **`docs/task-system-plan.dsl.json`** | ★★★ **讨论桌 / 方案文档**（人写，用 DSL 语法承载讨论，为让分歧显形）。★ **commit 749beb4（2026-10-16）建它时就说清了："方案写成 DSL""讨论产物"** | 只有 `certs/.work/probe-plan-detail.mjs` 这类**探针**；**本仓工具从不读** | ✅ 11 节点 |
| **`<baseDir>/.agent-io/design/<f>.dsl.json`** | ★★★ **真·设计 DSL**（**手写**，与 live 同 schema） | `storage.ts#getDesignSheet` | ❌ **目录不存在** |
| **`<baseDir>/.agent-io/live/<f>.dsl.json`** | ★★★ **真·实际 DSL**（**扫描产物**） | `storage.ts#getLiveFeatureResolved` | ✅ 10 个，但**没有 `task-system-plan`** |
| **`<dataHome>/.agent-io/features/<f>.json`** | **派生结果**（扫描 ⊕ overlay **合并**） | `getDSL` / `edit_dsl` / 写闸 / 巡检 | ⚠️ 只有 cwd 残留（5 节点，10-17 15:49），`~/.agent-io` 下没有 |

★★★ **因此：「设计 DSL × 实际 DSL 对拍」在本仓【从未发生过】**（`design/` 一份都没有、`task-system-plan` 也没有 live）。
★ 而**今天所有"对拍绿了"** —— 比的是「**讨论桌里的期望 × 代码**」，**不是**「设计 DSL × 实际 DSL」。

### 对拍应该怎么跑（正路）
```
① 把结论落成 <baseDir>/.agent-io/design/<f>.dsl.json（手写，schema 同 live）
② import_project 生成 <baseDir>/.agent-io/live/<f>.dsl.json（扫描）
③ get_dsl { query:'diff', feature_a, feature_b, view_b:'live' }  ⇒ 差异 = 要挂的任务
```

★ **`<dataHome>` 的解析**：`AGENT_IO_HOME ?? os.homedir()`（`storage.ts:63`）⇒ 本机默认 `C:\Users\Admin`。
★★ 已知坑：`handlers.ts:616` 把 `liveDir` 传给 `getDesignSheet(feature, liveDir)`，而 `getDesignSheetFile` 内部又走 `getDesignDir(baseDir)` ⇒ **路径可能双重嵌套**（`live/.agent-io/design/`）。★ **待核**（未实测）。

## 附 · 文件约定

- **`docs/task-system-plan.dsl.json`** —— 设计数据（不是文档）
- **`docs/frictions.jsonl`** —— 滞涩台账（程序读；也是 `provenance.kind='friction'` 的出处）
- **`docs/discussion-log.md`** —— 讨论登记（`provenance.kind='doc'` 的出处）
- **本文件** —— 唯一的文档。★ 新增内容进这里，**不要再开新 md**。
