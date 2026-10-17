# 任务系统 · 多方案讨论（第 1 场）

> 本场目标不是"给一个方案"，而是**穷举方向 + 每个方向 2–3 个可判方案 + 取舍**。
> 权威顺序：`docs/task-system-plan.dsl.json` 的 `task_plan` > `docs/board.md` > 本文件。
> ★ 本文件**不改任何 DSL**；它是一份"可并入 DSL 的补丁清单"（§4），每条带 4 个字段：**放哪 / 加什么 / 为什么 / 判据**。

---

## 0. 本场的规矩与现场读数

### 0.1 我读了什么（按权威顺序）

| # | 文件 | 用它回答什么 | 读数 |
|---|---|---|---|
| 1 | `docs/task-system-plan.dsl.json`（`task_plan`） | 哪些维**已定**、哪些维**只有名字没有判据** | 974 行；`open_questions` 11 条（OQ1–OQ11，OQ10/OQ11 已就地标注落地） |
| 2 | `docs/board.md` | 榜单现在是怎么维护的、它自己承认什么 | 76 行；:9 自认"手写版"；:43 表头 **4 列**，:53 的 T10 行是 **5 列** ⇒ 结构漂移 |
| 3 | `docs/frictions.jsonl` | 哪些滞涩**已经**是决策卡的来源 | **29 条**（★ `wc -l` 报 30 —— 那是**换行符**个数，末尾空行也算；`filter(Boolean)` 后 29 ⇒ 派活说的 29 是对的，我第一次读数读错了。本场追加 **2** 条 ⇒ 现 **31** 条，逐行 `JSON.parse` 全过） |
| 4 | `docs/preflight-checklist.md` | 回执/门/只读的硬约束 | 110 行；B.3（真仓只读）、C.1（五栏）、元规范 12 |
| 5 | `src/domain/task_schema.ts` · `task_machine.ts` · `dsl_ops/task_ops.ts` · `write_gate.ts` | 设计**落地到什么程度**（否则我在讨论一张不存在的图） | 见 0.2 |

### 0.2 现场读数（每条都能被重跑）

| # | 读数 | 命令 / 位置 | 它意味着什么 |
|---|---|---|---|
| R1 | `valid = true`，`问题数 = 0` | `node certs/.work/probe-validate-plan.mjs` | DSL 形状自洽（**本场没改它**，这只是基线） |
| R2 | `t_void` 的 `from` **只有** `candidate` | `task_machine.ts:207-214` | claimed 卡的 target 没了 ⇒ **无路可走** |
| R3 | `t_supersede` 的 `from` **只有** `candidate` | `task_machine.ts:255-262` | done 卡被判据变更覆盖 ⇒ 只能"被吞掉"，done 事实丢失 |
| R4 | `existsTarget` 在 `src/` 里 **0 命中** | `grep -rn existsTarget src/` | ★ `t_void` 的判据**今天没有实现**（不只是"没写清楚"） |
| R5 | `TaskSpec` 无 `void_reason` / `events` / `blocked_by` / `level` / `requires` / `renewed_at` / `verified_by` / `follows_up` / `disposition` / `touches` / `priority` | 逐键 grep 三个文件 = 0 | 下面 §1 的多数维**没有落点**（不是"没想"，是"没处放"） |
| R6 | `canClaim` 要求后态判据 **failed === 0** | `task_machine.ts:90`；`task_ops.ts:284` | ★★ **只有"已经做完"的卡才领得到** |
| R7 | 闸只认 `task.state === 'claimed'` | `write_gate.ts:676-678` | ★★ 与 R6 互锁 ⇒ 见 0.3 |
| R8 | 新文件**不拦**（不是任何 feature 节点 ⇒ `continue`） | `write_gate.ts:672` | 今天唯一畅通的写路径是"新文件" |
| R9 | `saveDSL(applyOverlay(...))` 单参调用 | `task_ops.ts:135` | 乐观锁 `base_dsl_rev` **从未被传入**（`storage.ts:587` 只在传了才检查） |
| R10 | `releaseIfExpired` 在 `src/` 的调用点 = 0 | `grep -rn releaseIfExpired src/` | TTL 今天不生效（patrol 未建） |
| R11 | `claimTask` 会把 `release_reason/released_by/released_at` **置 undefined** | `task_ops.ts:307-309` | 释放历史被下一次领取抹掉 ⇒ 追溯断裂 |
| R12 | `src/` 里无 board 读端（只有注释提 T8） | `grep -rln board src/` | 榜单不存在"读出来的"版本 |
| R13 | `docs/board.md` 中 T10 出现 **2 次**（:29 §一·五、:53 §二），且 :53 列数 5 ≠ 表头 4 | `board.md:43` vs `:53` | 手写榜的漂移是**已发生的事实**，不是担心 |

### 0.3 ★★★ 一个必须先说的死锁（本场第一发现）

三条各自"正确"的判据，合起来使系统无法前进：

1. **改已存在的文件 ⇒ 必须先有 claimed 卡**（R7，OQ10 裁定）；
2. **claim ⇒ 后态判据必须全过**（R6，照 `t_claim` 逐字实现）；
3. **只要那张卡上有红（要做的事），后态判据就 `failed > 0`** ⇒ claim 必拒。

∴ **"有活要干的卡"永远领不到；能领的只有"活已经干完"的卡。** 今天真正可写的只有新文件（R8 的放行），这解释了 `frictions.jsonl` #5 里"第一块最后走了 scaffoldCore 通道"——那不是绕路，那是**唯一活路**。

★ 这不是"实现 bug"，是**两把同形的尺**（领取闸 = 收口闸）造成的语义坍缩，`OQ8` 已经把它写出来了，但**没人把它当成"系统不可用"来看**，而是当成"一处待裁的措辞差异"。本场把它列为 **P01（最高优先）**。

---

## 1. 十一个维度（逐条，不合并）

每条的骨架固定：**现状读数 → 方案 A/B(/C) → 每案一句判据 → 推荐 + 一句取舍**。

---

### D1 · 任务怎么来

**现状**：唯一入口 = `publish`（翻决策卡）；`source` 五类（doc/utterance/thought/friction/defect）**只有设计，没有字段**（R5：`TaskSpec` 无 `source`）。

| 方案 | 一句话 | 判据（怎么判它对不对） |
|---|---|---|
| **A · 单入口 + 先建模** | 任何来源都必须先落成"某节点上的 decision"，再 `publish` 翻它；用户直说"这东西坏了"时，我先找/建节点 | 全库不存在"卡的内容与 `node.decision` 不深等"的非终态卡（扫描 0 条）⇒ 说明卡**都**来自 decision |
| **B · 双入口** | 增 `intake`（∅→candidate，`anchor` 为空，禁止 claim 直到挂上节点） | `anchor` 为空的卡 `claim` 必拒（一条断言）；且 intake 卡必须带 `source` |
| **C · 单入口 + source 多态（七类）** | 入口只有 `publish`，来源靠 `source.kind` 表达；"找不到落点"**本身**是第一张 L1 卡（其 anchor = 该 feature 的设计根节点） | 每张非终态卡都能答三问：`source.kind ∈ 七类` · `source.ref` 可解析 · `anchor` 存在；"答不出"的卡数 == 0 |

**推荐 C。** 取舍：多一类 `source` 的代价（一个枚举值）远小于多一个写端的代价（`intake` 会是第二个状态轴，正是 `task_home.why_single_writer` 要防的病）；★ 但 C 里"最接近的节点"是人的判断，必须用"anchor 必须存在"这条硬判据兜住，否则它会退化成"随手挂"。

**★ 合法性规则（我的裁定，可被判据推翻）**：合法来源 = 七类枚举内 + `source.ref` 可解析。**"我不知道为什么做"不算来源**——那是 `thought` 类，但 `thought` 必须写"何时、因何想起"（DSL 已定）。**别的 agent 留的任务**合法（`peer_agent`，ref = 卡 id + agent 身份），但**它不能替我 claim**（见 D3-E）。**临时插单**不是新来源，是 `priority:'user'` + 排队规则（见 D11）。

---

### D2 · 任务怎么分

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 一节点一卡**（现状落地） | 卡 `id` = `node_id`，同节点非终态卡 ≤ 1 | 同一 `node_id` 上 `state ∉ terminal` 的卡数 ≤ 1（全库扫描） |
| **B · 一卡一期望** | 卡只带 1 条 expectation，节点红被拆成 N 张卡 | 每张卡 `expectations.length === 1`；节点红数 == 卡数 |
| **C · 卡组 `parts[]`** | 一张卡带多个 part，各自有判据与完成标记 | part 全 pass 才算 done；且 `claim` 只接受卡 id、接受 part id 必拒 |

**推荐 A**，组只做**读端聚簇**（按 `touches` 交集或 `source.ref` 聚成"一批"，不落 `batch` 字段）。判据：卡上无 `batch/parts` 字段（grep 0），组视图由纯函数 `clusterBy(touches)` 产出。
取舍：A 让"卡 id = 判据对象 id"（验收对象天然唯一，`judgeExpectations` 的入参同形），代价是跨节点的一件活要拆多卡 —— 用 `blocked_by` 串起来，而不是新造容器。B 会让"半修"合法化（3/5 各自 done），C 会让"claim 的单位"与"验收的单位"分叉。

**★ L1/L2 能否混在一批：不能。**
- 判据（可判）：一次 `edit_dsl` 的 `operations[]` 里 `level` 集合的 size ≤ 1；且 L2 卡的 `level_from` 指向的 L1 卡必须 `state === 'done'`。
- 理由不是洁癖：两级的**尺不同**（L1 看"DSL 建构完整"，L2 看"红变绿"），混批时**没有任何一把尺能收口整批** ⇒ 必然出现"按 L1 的尺收 L2 的卡"（今天 `board` 的"验收读数"列已经混着两种读数）。

---

### D3 · 任务怎么领

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 自领**（现状） | `claim` 带 `data.owner`，工具不替你编身份 | `claimed` 卡 `owner` 非空；`owner` 缺失 ⇒ 拒（现状已有） |
| **B · 派给子代理** | `publish/claim` 时写 `owner=子代理`，另落 `delegated_by` | `owner !== delegated_by` 时，回执的 `evidence.by` 必须 == `owner`（否则 done 拒） |
| **C · 抢（CAS）** | 并发两人抢同一卡，只有一个成功 | 并发两次 claim ⇒ 成功 1 / 拒 1，且失败方拿到"当前 owner=X"的**读数**（不是静默覆盖） |
| **D · 交接转手 `handoff`** | 旧 owner → 新 owner，**state 不变**，写 `handoff_from/handoff_at`，**不写 `released_*`** | handoff 后 `state` 仍 `claimed`、`released_at` 仍空、`owner` 已换；旧 owner 的 evidence 保留 |
| **E · 权限不足** | `task.requires: ('user_ruling'\|'src_write'\|'verify_only')[]`，claim 时校验 | 缺 `requires` 的 claim 必拒，且文案点名缺哪一项；`user_ruling` 卡只能由 human 身份领 |

**★ C 的现状必须更正**（R9 + R6）：今天的 "CAS" 是**进程内 read-then-write**（`task_ops.ts:284` 判 → `:135` 写，中间无锁、写时不带 `base_dsl_rev`）⇒ 两个进程**都能成功**。所以 C 不是"已有"，是"**待实现**"。

**推荐 A + C + D + E**（B 是 A 的补字段，不是独立方案）。
取舍：`handoff` 必须是**一个 action**，而不是"release 再 claim"——后者中间会出现 `candidate` 空窗（别人可以抢走），而且会把"谁做过"截成两段（R11 已经证明 release 痕迹会被抹）。代价是多一个 action、多两个字段，换来"转手不丢历史"。

**领了不干**：`releaseIfExpired` 存在但**无调用方**（R10）⇒ TTL 今天等于不存在。方案：A 只靠 TTL（粗，且改表就能回收别人的卡）· B TTL + 续租 `renewed_at`（判定用 `max(renewed_at, claimed_at)`）· C 心跳写进 evidence（污染证据，否）。**推荐 B**；判据：回收判据只读 `max(renewed_at, claimed_at)`，且一条夹具证明"续租过的卡不被回收"。

---

### D4 · 任务怎么做

**依赖顺序**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 不落依赖** | 靠 `touches` 冲突自然串行 | 答不出"这张卡为什么现在不能开工" ⇒ 缺读数（不满足） |
| **B · `blocked_by: node_id[]`** | claim 前要求全部 `done` | blocked 卡 claim 必拒且列出阻塞卡；`blocked_by` 指向不存在的卡 ⇒ 立卡被拒（防悬空，同 `blocked_by_open_question` 的消费方纪律） |
| **C · 从 expectations 推导** | 期望指向的文件不存在 ⇒ 被"造它的卡"阻塞 | 无字段也能给原因；但同一文件多卡时推导不唯一 ⇒ 判据会自相矛盾 |

**推荐 B。** 取舍：多一个字段，换来"为什么不能开工"从"我记得"变成"读得出"；C 看着优雅，但它的推导在热点文件上不唯一（本仓 `overlay.ts` 就被多张卡碰过）。

**并行边界（同文件不可并行）**

- 关键事实：卡挂在**节点**上，节点 ≈ 文件但不必是文件（一个节点也可以是文件里的一个符号）；两个不同节点可以指向同一文件。
- A **文件级互斥**：`touches` 从 expectations 的 `path`/`from`/`to` **派生**（六类里四类直接给 path；edge 类给 from/to），**不落盘**；claim 时与所有 claimed 卡的 `touches` 求交，非空 ⇒ 拒。
  判据：全库"两张 claimed 卡 `touches` 交集非空"的计数 == 0。
- B 目录级互斥（粗，误伤同目录不同文件）—— 判据：交集按目录前缀算；代价是并行度骤降。
- C 不互斥，靠写冲突事后发现 —— 判据：冲突报错必须点名两张卡；否则就是静默覆盖（R9 证明今天连报错都没有）。

**推荐 A。** 取舍：`touches` 可派生 ⇒ 零新字段（守"不复制事实"）；B 会把"同一目录"当成"同一资源"，而本仓 `dsl_ops/` 下天天并行改文件。

**阻塞时怎么办**：A 等 · B 按"可开工"重排（读端排序）· C 允许**只读准备**（读代码、写文档不受闸限）。
**推荐 B + C**；判据：`focus` 视图里"可开工"集合 = `candidate ∧ 未 blocked ∧ touches 无冲突`（纯函数，可单测）。

---

### D5 · 任务怎么完

**收口的最终权归谁**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 榜单（机器）终审** | `judgeExpectations` 全过 + 有 evidence ⇒ done | 全库 done 卡都有 ≥1 条 evidence 且 `failed == 0` |
| **B · 用户终审** | 机器过只到"待验"，用户点头才 done | done 卡必须有 `approved_by=user` |
| **C · 双签** | 机器过 + **非做者**再验一次，且 `verifier ≠ owner` | 不存在 done 且（`verifier` 缺 ∨ `verifier == owner`）的卡；且 done 卡 `evidence.by` 去重后 size ≥ 2 |

**推荐 C。** 取舍：A 已经被实测证伪两次（"报真绿而 `unsupported=2`"、"十九证全绿 ≠ 本笔被验"）；B 会让"用户不在场"变成"任务永远没有终态"，直接违反榜单第一条强制（必须有终态）。C 是唯一同时满足"必须有终态"与"验收会错"的方案——代价是每个 done 要两条证据，但那条"非做者"可以是我（验子代理的卡），不必是用户。

**★ 但 C 有一个没人提的洞**：单 agent 仓里"非做者"可能**不存在**（见 X4）。所以 C 必须带**降级规则**（P17）：`verifier_kind ∈ {human, other_agent, machine_channel}`，`machine_channel` 只允许"换一条判据通道重算"（如 `judgeExpectations` 之外再用 `git diff` 对照），且必须显式记录 —— 不允许"没别人所以自己签"。

**半修回退**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 回退代码** | `release(rollback:true)` 必须把工作区退回 | 回退后 `git diff --stat` 为空（一条读数） |
| **B · 不回退但钉住** | 停在 `claimed` + `half_fix:true`，且禁止碰同文件别的卡 | `half_fix` 卡与任何卡 `touches` 交集 == 0 |
| **C · 停手报告** | 卡回 `candidate` + `release_reason=blocked:<why>` + **把缺的那一维钉进 DSL** | release_reason 非空；且同轮 DSL 有对应补丁（可判：diff 里存在该节点的 decision 变更） |

**推荐 C，B 兜底。** 取舍：本仓铁律是"半修比不修更坏"（preflight B.2），而 T5 已经证明 C 是**正确结果不是失败**；A 在受保护文件（`.agent-io/features/*.json`）上做不到，所以要 B 兜。

---

### D6 · 任务怎么败（★ 本场最明确的缺口：`void` 与 `superseded` 只有名字，没有判据）

**现状读数**：R2（void 只从 candidate）· R3（superseded 只从 candidate）· R4（`existsTarget` 不存在）· R5（无 `void_reason`/`superseded_reason`）。

**语义分层（这是判据的前提，必须先分清）**

| | `void` | `superseded` |
|---|---|---|
| 变的是 | **对象**（target 没了） | **"应该"**（判据变了） |
| 处置方向 | 该从图上**删/退**节点 | 该**保留**节点、改 decision |
| 是否"做过" | 与做没做无关 | 与做没做无关（所以不许吞掉 done） |
| 谁发起 | 系统（patrol 的 `should_void`） | 人/agent（新卡带 `replaces`） |

**方案**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 按"对象在不在"分** | void = 对象没了；superseded = 对象在但应该变了 | **void**：卡的全部 target 对 `existsTarget` 为 false，且**两次独立扫描**（不同 `scanRev`）一致；`void_reason ∈ {target_missing, feature_retired}`。**superseded**：存在新卡 `replaces=old`，且 `old.state ∈ {candidate, claimed}`，且新旧 expectations **不 deep-equal** |
| **B · 按"谁发起"分** | void 由系统发起、superseded 由人发起 | void 卡 `voided_by='patrol'` 且 evidence 含两条 target-missing 读数；superseded 卡必须有 `replaces` 边 |
| **C · 合并成 `retired` + reason** | 少一个状态 | 只有 4 态；但 `retired.reason` 必须能区分两类 ⇒ **等于把状态改了个名**，且处置信息（删节点 vs 改判据）在读端丢失 |

**推荐 A（语义）+ B（发起者），两条一起用。** 取舍：C 省一个状态但把"处置方向相反"的两件事塞进一个字段，读端每次都要再分一次；A+B 各自只判一件事，**判据不会互相污染**。

**★ 四条补充判据（我认为缺了就会误杀）**

1. **`retarget ≠ void`**：target 从 A 移到 B（rename/move）时，正确结局是 `superseded(reason=retarget)` + 新卡 `replaces`。
   判据：rename 夹具下 `void` 计数 == 0、`superseded` 计数 == 1。
2. **done 卡不许被 supersede**：done 是历史事实；判据再变只能开**新卡**（`follows_up`）。
   判据：全库"`state=done` 且被 `replaces` 指向"的卡数 == 0。
3. **void 必须是"判不了"的产物，不是"判失败"的产物**：target 消失时，期望会从 pass/fail **变成 unsupported**（读不到文件），而不是 fail。
   判据：void 卡的 evidence `verdict` 不含 `fail`（只允许 `unsupported` 或 `target-missing` 读数）。
4. **单次索引陈旧不得触发 void**：本仓实测过——索引陈旧会把 pass 刷成 unsupported（`frictions` #28、T12），蓝屏重启也会造出"空返回"（preflight 0.2）。
   判据：void 必须两条**不同 `scanRev`** 的缺 target 读数；只有一条 ⇒ 判"暂缓"（新的中间结论，不是终态）。
5. **superseded 不许静默**：`superseded_reason ∈ {decision_changed, retarget, duplicate}` + `superseded_by=<新卡 id>`。
   判据：superseded 卡这两字段非空。

---

### D7 · 任务怎么看见

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 手写榜**（现状，`board.md:9` 自认） | 人抄"待发布/已收口" | ★ 已证伪：T10 在 `:29` 与 `:53` **各出现一次**，且 `:53` 列数 5 ≠ 表头 4 ⇒ 手写榜**已经**同时出现"重复"与"结构漂移" |
| **B · 读端自动生成** | 榜单 = `f(红列表, task 格)`，每次读时现算，**状态表不落盘** | 仓库内不存在第二份榜单**数据**（只有渲染输出）；输出必带 `scanRev` + 生成时刻 |
| **C · 落盘快照** | 落一份可 diff 的榜 | 快照带 `scanRev`；读时 `scanRev` 不同 ⇒ 报 `stale` 并拒绝展示为"当前" |

**推荐 B**，只额外落**事件行**（append-only，收口/失效/取代时追加一行，带 task id + scanRev + verdict 级读数，不含 `observed` 数值）。
取舍：B 是唯一满足"一处权威 + 一处渲染"的形态；C 的"可 diff"是伪需求——`task` 格本身就在 `design/*.dsl.json` 里，**git 已经**能 diff。代价：B 每次读要跑一次对拍 ⇒ 必须配**微缩**（下条），否则读一次榜单要几十秒。

**微缩 / 按需展开**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 全量** | 一屏 N 行 | 行数 == 卡数（必然淹没；今天 25 条期望就能刷屏） |
| **B · 三层** | 焦点（≤5）→ 分区计数 → 全量（`--all`） | 默认视图行数 ≤ 5，且每行命中下面三类谓词之一 |
| **C · 只看我的** | `owner == me` 才算 | 别人的卡不可见 ⇒ **冲突预警失效**（直接与 D4 的 `touches` 互斥打架） |

**推荐 B。**

**哪些不该干扰我**（可见性谓词，三类，必须写死）：
1. 我自己 `claimed` 的（含 TTL 余量）；
2. 与我在做卡的 `touches` **相交**的 candidate（冲突/前置预警）；
3. 等我裁/等我完的：`requires:user_ruling` ∨ `blocked_by` 指向我的卡。
**判据**：`focus` 每条都命中三类之一（纯函数返回 `{shown, foldedBy}`），且 `shown + folded == total`（守恒）。

---

### D8 · 任务怎么追溯

**现状**：`provenance` 只回答"卡从哪来"；**没有**回答"卡经历了什么"。更糟：`claimTask` 会把 `released_by/at/reason` **清空**（R11）⇒ 每领一次，"上次为什么退"就没了。

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 只留最终态**（现状） | 卡上只有当前 owner/state | 答不出"这张卡被退过几次"（读数为空）⇒ 不满足追溯 |
| **B · 卡内嵌 `history[]`** | append-only，只落**决策事件** | `history` 的 `at` 单调不减；state 变更次数 == 历史迁移数；且不含 `observed/passed/failed` 键（守 invariant） |
| **C · 事件外置** | 事件进 append-only 日志/表，卡上不留 | 卡内无 history；日志每行带 `dsl_rev` 可与卡对账 |

**推荐 B。** 取舍：卡随 DSL 走 ⇒ `git diff` 可 review、可回滚、多机不会分叉；C 在多 agent/多机下必然出现"日志与卡谁对"的第二次裁决。代价：卡变重 ⇒ 必须配 D14 的体积上限（只落 7 种事件，每条 ≤ 200 字节）。

**"谁做过、为什么退"是不是卡的一部分** ⇒ **是，但必须与 `source` 分两段**：
- `source`（出生证明，**不可变**）：改 source ⇒ 拒（判据：一条断言）；
- `history`（经历，**只增**）：长度单调不减（判据：一条断言）。
理由：把两者混在一处，就会出现"改出处时把历史洗掉"或"追加历史时改了出处"——这是本仓头号病（同一判据住两处）的又一种形态。

---

### D9 · 任务怎么防漂移

**核心问题一：决策卡变了 ⇒ 已领 / 已完成的卡要不要作废？**

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 自动作废** | decision 变了 ⇒ 旧卡 `superseded` | decision 变更后旧卡 `superseded` + 新卡 `replaces`；★ 代价：正在做的人被打断，已落代码成为半修 |
| **B · 标 stale + 阻断收口 + 允许重翻** | `cardStaleness(card, node)` 读时现算（纯派生，**不落盘**）；stale ⇒ complete 必拒；release(reason=stale) 后可重新 publish | ① stale 卡 `complete` 必拒（一条断言）；② `decision` 变更后，"done 且 stale"的卡数 == 新开 candidate 卡数（1:1） |
| **C · 卡带 `decision_rev`** | 卡记住它翻自哪个版本 | 卡能指出翻自哪个 rev；★ 但 rev/hash 是**快照** ⇒ 违反"设计侧不复制事实"（除非同时存档 decision 历史 = 新增一维存储） |

**推荐 B。** 取舍：B 不新增任何存储（staleness = `deepEqual(card.expectations, node.decision.expectations)` ∧ `summary` 相等），代价是放弃"知道卡翻自哪个版本"。★ 但 A 的"打断"代价更大：它把"正在做的人"变成"半修制造者"，而本仓铁律是半修比不修更坏。

**★ 已完成的卡怎么办（B 的关键一半）**：**不撤 done**（那是历史事实），自动开一张 `follows_up` 新卡。
判据：每次 decision 变更后，`done ∧ stale` 的卡 → 新 `candidate` 卡 1:1，且新卡 `follows_up = 旧卡 id`、旧卡 state 仍 `done`。

**核心问题二：DSL 变了 ⇒ 怎么回流成新卡？**

| DSL 的变化 | 正确结局 | 判据 |
|---|---|---|
| 新增节点（有 decision + 有红） | 进 **pool**（不是自动 publish —— 见 D11） | pool 里该节点的红有一条对应条目 |
| 删除节点 | `void(target_missing)`，但需两次扫描 | 同 D6-4 |
| **改名** | ★ 陷阱：卡 `id == node_id` ⇒ id 变了 ⇒ 历史断链。正确结局 = `superseded(retarget)` + 新卡 `replaces` | 改名夹具下：旧卡 superseded、新卡 replaces 指向它；且**手改 id**（diff 里 id 变而 task 未 supersede）⇒ patrol 报 `orphan_task > 0` |
| 合并两个节点 | 两张卡都 superseded(retarget)，新卡 replaces 两张 | `replaces` 允许数组（或两条新卡各 replaces 一张） |

**★ 改名这一维不能靠"我记住要 supersede"**：必须让 rename 走 `edit_dsl` 的 rename 操作（一次性产出 supersede 事件）。判据：`orphan_task` 计数 == 0（patrol 可查）。

---

### D10 · L1 的验收判据（"建构完整"到底怎么判）

**现状**：`validateDSL` 通过 + 至少一条 expectation。**不够**，四个反例都能通过：

| # | 反例 | 为什么它能通过现状 |
|---|---|---|
| 1 | expectation 写 `file-exists` 指向**已存在**的文件 | 现状只要求 ≥1 条 post，不要求"当前是红的" ⇒ 卡一立就全绿，且**立刻可 claim、可过闸**（R6） |
| 2 | 全是 pre-phase（`edge-absent`） | `publish` 有守卫会拒（已实现），但 **L1 的"完整"判据本身**没写这一条 ⇒ 判据靠某个函数"记得"拦 |
| 3 | 孤立节点（无任何边） | 图不连，实现时找不到入口；validateDSL 不查连通性 |
| 4 | expectation 的 path 拼错（指向不存在的目录） | 永远 fail ⇒ 看起来"有活"，实际是**假红**（本仓已有假绿/假红双史） |

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 现状两条** | validateDSL + ≥1 expectation | 可判，但反例 1–4 全部通过 ⇒ **判据不足（有反例即证伪）** |
| **B · 五条** | 见下 | 五条全过才算 L1 完成；任一条不过 ⇒ 拒收口并点名哪条（一条命令输出五个布尔） |
| **C · B + 语义一致** | 再加"summary 与 expectation 语义一致"+"path 存在于本仓" | 路径存在性可判；**语义一致性机器判不了** ⇒ 这部分属"此处缺一维，需要用户裁定" |

**B 的五条（每条都可判）**：
1. `validateDSL` valid（形状）；
2. **至少一条 post 期望，且此刻至少一条 fail** —— 这才是 provenance ④"天然差异"的可判形式；全绿 ⇒ 这卡**没有活**，不该 publish（应走"已满足"分支）；
3. 非孤立：节点至少一条边连到既有节点（反孤立）；
4. 每条期望都能判成 pass/fail（`unsupported == 0`，或卡上显式 `unsupported_ok` + 理由）；
5. `source` 非空（有出处，否则是"想法没写原因"）。

**推荐 B。** 取舍：B 会挡住今天很多"粗卡"——但 L1 的活**本来就是**"把粗卡变可判"，挡住的正是"看似有卡、其实判不了"。C 的后半条（语义一致）硬做成判据只会得到一个假信号，故不并入。

---

### D11 · 任务的代价与取舍

**现状**：`board.precondition` 写的是"红 ⇒ 先写 DSL ⇒ 挂任务 ⇒ claim"，没有"红线"，也没有"我可以不做"的出口 ⇒ 红会**无限堆积**（本 DSL 今天 7 红，加上 T6/T7/T9 与若干 OQ，池子只会变大）。

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 红优先全量入榜** | 红 ⇒ 自动 candidate | 红数 == 非终态卡数（1:1）；★ 后果：入榜零成本 ⇒ "榜单"退化成"红的镜像"，`state` 失去意义 |
| **B · 两级池** | 红 ⇒ **pool**（自动、零成本）；pool ⇒ **board** 需 `disposition=do` + 一句 why + 谁定的 | pool 里 `disposition` 缺失数 == 0；board 候选数 ≤ WIP 上限 |
| **C · 预算制** | 每轮 claimed ≤ N（默认 2），红按排序键排队 | claimed 数 ≤ N；排序输出带解释串 |

**推荐 B + C。** 判据（合并成一条）：board 的 `doing` 集合满足 (i) `size ≤ WIP` (ii) 每条 `disposition=do` (iii) 排序键可复现。

**"我能不能自己否掉一条红"** ⇒ **能，但只能 `wontfix`，不能 `void`**：
- `wontfix` 必须带 `why` + `recheck_at`（到期自动回 pool，防止永久埋掉）；
- `void` **只能**由 target 消失产生（D6，系统发起）；
- 判据（守恒）：不存在"红既不在 pool、也不在终态、也无 disposition"的卡。即 `red_count == pool + doing + done_from_red + void + superseded + wontfix + defer` 的差额 == 0（一条纯函数 `accounting(reds, cards)`）。

**优先级由谁定**（不是单一数）：
1. 用户可置顶 `priority:'user'`（只能由 `source.kind=utterance` 设）；
2. 阻塞系数：被多少卡 `blocked_by`（**派生**，不落盘）；
3. 代价：`touches` 文件数（**派生**）。
判据：排序函数是纯函数（同输入同输出）；top-3 必须附带解释串（如"它解锁 4 张卡"）。

**★ 临时插单的规则（否则它会变成后门）**：插单只能插 **candidate 队首**，**不得抢占 claimed**。抢占需要显式 `preempt` 事件 + 理由 + 被抢占者的时间记账。
判据：一次插单操作后，所有 claimed 卡的 `owner` 与 `claimed_at` 不变（一条断言）。

---

## 2. 补维度（11 条之外，5 条）

> 每条都必须回答"为什么会漏掉它"——否则它只是"又想到一条"。

### D12 · 并发与幂等（★ 为什么会漏：`CAS` 这句话是从旧方案逐字搬来的）

- **漏掉的原因**：`t_claim` 的 guard 写的是 `UPDATE tasks SET ... changes === 1` —— 那是 **SQL 表**的 CAS。等 `OQ11=B` 把"家"从 DB 表搬到 `geometry.nodes[].task`（JSON 文件）之后，**没有人回头问"这句话在这个家上是什么"**。而且单 agent 时代"并发"看起来不存在——但本仓已有 daemon + watch + 子代理并行（`frictions` #23 的 async 上浮、#25 的全量证跑崩）。
- **读数**：R9（`task_ops.ts:135` 单参 `saveDSL`）⇒ 乐观锁**从未启用**；`task_ops.ts:284` 判 → `:135` 写 ⇒ TOCTOU 窗口。
- **方案**：A 每次写带 `base_dsl_rev`（**既有原语**，`storage.ts:587`）· B 单写者队列（daemon 串行）· C 文件锁。
- **判据**：A —— 并发两 claim 夹具：成功 1 / 冲突拒 1，失败方错误里含"当前 rev"；B —— 并发 N 写后 `dsl_rev` 增量 == N（无丢失更新）。
- **推荐 A + B 兜底**。取舍：A 要在每个 op 里传递 rev（一次改动面），但**不新造锁**；C 会引入一个必须被清理的锁文件（本仓已有"批量删除闸"这类环境坑，不想再加一个）。

### D13 · 时钟与时间语义（★ 为什么会漏：TTL 被当成"一个数字"）

- **漏掉的原因**：`OQ2`（TTL 取值）与 `OQ6`（按卡类分档）都在争"**取多少**"，**没人问"拿什么钟量、钟被拨了怎么办"**。而本仓实测过蓝屏重启（preflight 0.2 的教训），`claimed_at` 只是一根 ISO 字符串。
- **方案**：A 本机墙钟 + TTL · B 单调时钟 + 持久化 `boot_id`（重启即"全部过期"或"全部续期"，二选一并写清）· C 不设 TTL（已被 DSL 判为不可接受："死锁字段"）。
- **判据**：A —— 把系统时间前拨 1 天 ⇒ 批量回收（判据变红 ⇒ 证明 A 不安全）；B —— 改墙钟不影响回收判定，且"重启后行为"由一条显式规则决定（不允许自然发生）。
- **推荐 B**。取舍：多一个字段，换来"时间不可被伪造"；A 的代价是**改表就能回收别人的卡**（这不是理论风险，TTL 的整个目的就是对付"人跑了"，而"人"也能改钟）。

### D14 · 卡自身的体积与渲染成本（★ 为什么会漏：讨论都在"怎么管任务"）

- **漏掉的原因**：本仓的头号病是"结论没有住处"⇒ 天然倾向把一切都塞进卡（expectations + evidence + history + discussion）。**没有人问"一张卡要花多少上下文"**。一张卡 5 KB，20 张就是 100 KB。
- **方案**：A 不限 · B 默认渲染白名单（`summary/state/owner/counts`）+ 落盘上限（如 16 KB/卡）· C 卡只存指针（判据在节点、历史在日志）。
- **判据**：B —— 默认渲染的键集合 == 白名单（一条断言）；超限卡 `publish/claim` 必拒并提示"拆卡"；C —— 卡体积恒定，但"读一张卡要三处"⇒ 违反一处权威。
- **推荐 B**（与 `discussion` 的 `MICRO_KEYS` 同一手法：字段级白名单）。

### D15 · 终态卡的归档（★ 为什么会漏："必须有终态"解决了前半句）

- **漏掉的原因**：榜单第一条强制是"上过榜单必须有终态"，**解决了"不勾掉"，没人问"勾掉之后放哪"**。终态卡留在 `geometry.nodes[].task` 里 ⇒ ① DSL 线性变大（重建/validate/渲染都变慢）② 污染统计（红绿计数、L1 的"全绿"判定）③ 节点一旦删除，卡与历史一起消失。
- **方案**：A 永久留在节点上 · B 终态卡超过 K 笔或跨 M 个 `dsl_rev` ⇒ 归档到 append-only 日志并从 DSL 移除（归档行是**事实**，不是渲染） · C 转成节点上的只读 `task_history[]`。
- **判据**：B —— 归档后 DSL 字节回到基线附近（可测），且按 id 仍能查到完整历史（一条查询）；C —— 历史还在 DSL 里 ⇒ 膨胀未解。
- **推荐 B**，但必须与 D6 联立（否则会和"删节点"重复归档同一张卡）。

### D16 · 反形式主义：卡会不会变成新的补丁（★ 为什么会漏：我们只设计了"怎么强制有卡"）

- **漏掉的原因**：闸的存在本身**制造了造假动机**——为过闸而造一张"全绿的卡"。而 `publish` 的守卫只挡"无 decision"，**挡不住**"decision 的 expectations 全是已绿的"（R6 的反例 1：这卡一立就能 claim、就能过闸）。
- **方案**：A 不检查（信任） · B 体检指标（`publish 时已全绿` 占比 · `claim→complete < X 且 diff 为空` 的卡数 · 卡数/实际 diff 行数） · C 机器强制（publish 时全绿 ⇒ 拒）。
- **判据**：B —— 三个指标都有读数出口，任一超阈值 ⇒ 体检红（不是断言失败）；C —— publish 必拒，但会误伤"确实已经做完只是没立卡"⇒ 需要 `attestation` 出口。
- **推荐 B + C 的窄版**：全绿卡**允许 publish 但标记 `already_green:true`，且不得计入进度**（不许当业绩）；体检指标常驻。

---

## 3. 矛盾（维度之间打架的地方）

> 这一节是本场另一半价值：不是"补更多"，而是"哪些补丁会互相抵消"。

### X1 · 领取闸 × 收口闸（★★★ 已在代码里互锁，见 0.3）

`canClaim` 用"全过"（R6）⇒ 领取闸 = 收口闸的同形副本 ⇒ 与闸（改码需 claimed，R7）互锁。
**代价**：系统今天只能写新文件；改旧文件的活开不了工。
**解**：P01（把 `t_claim` 的判据翻成"至少一条 fail"，另立 `isSatisfied` 给收口与 `missed_close` 用）。★ 这条要用户裁，因为它是 `OQ8` 里"两种相反写法"的二选一。

### X2 · 红优先 × 取舍权

若"红 ⇒ 自动入榜"，则"我可以否掉一条红"与"红必须入榜"直接冲突；而 `board` 说"完成判定者是榜单"，**取舍的判定者是谁没写**。
**解**：把"入池"与"入榜"分开（P21/P22）：红 ⇒ pool 自动；pool ⇒ board 需 `disposition=do`。冲突消解后，"我否掉一条红"= 在 pool 里置 `wontfix`，它**仍在 pool 里可见**（只是不计入 doing）。

### X3 · 读端自动生成 × 哪些不该干扰我

"自动生成"的完整性要求全量可见；"不干扰"要求默认折叠 ⇒ 同一份数据的两种可见性。
**解**：**一份数据、两个视图**（P15）：`focus ⊆ full`，且 `shown + folded == total`（守恒判据）。禁止出现"第二份数据"（那就是 C 方案，已否）。

### X4 · 双验 × 单 agent

"双验必须由不是做的人填"（`board.md:74`）——但主代理常常是唯一在场的 agent ⇒ done **永远无法达成** ⇒ 榜单死锁。
**解**：P17 定义 `verifier_kind ∈ {human, other_agent, machine_channel}`；`machine_channel` = 换一条判据通道重算（如 `judgeExpectations` 之外再用 `git diff`/`npm run verify` 对照），且必须显式记录、`verifier ≠ owner`。★ 不允许"没别人所以自己签"——那是把双验改成单验还不说。

### X5 · 并行边界 × 强制领取（热点文件）

改文件要先 claim；同文件不可并行 ⇒ 第二个想改同一文件的人**只能等**。若他等的卡又 `blocked_by` 第一张，就形成"等 + 阻塞"的双重等待。
**解**：`touches` 冲突时允许 **claim 但排队**（`serialized_on`），或区分"读意图"（不占锁）与"写意图"（占锁）。判据：排队中的卡 `state=claimed` 但不计入 `doing` 的 WIP 预算（否则预算被排队者吃光）。

### X6 · "不落读数快照" × "done 必须有验收读数"

invariant 禁止落读数（`line/hash/reads/call_count`），而榜单强制"done 必须有验收读数"。
**解**：读数**落命令 + verdict**，不落 `observed` 数值（`TaskEvidenceRecord` 已经是这个形状：`{kind, at, by, verdict}`）。判据：evidence 里不出现 `observed/passed/failed` 键（一条断言）——这样"有读数"= "有一条可重跑的命令 + 它的结论"，而不是"存了一份会过期的数字"。

---

## 4. 可并入 DSL 的补丁清单（29 条）

> 每条 4 字段。`P` 编号稳定，便于在 DSL 里回引（`open_questions` 与 `blocked_by_open_question` 可指它）。
> ★ 标 **【裁】** 的 = 需用户拍；标 **【前置】** 的 = 不做则后续补丁无可判意义。

### 4.1 `state_machine`（7 条）

**P01 【裁】【前置】领取闸与收口闸分家**
- **放哪**：`task_plan.state_machine.transitions[t_claim].guard.clauses[1]`（改）+ 新增 `isSatisfied(card)`
- **加什么**：`t_claim` 第 2 条改为「后态判据里**至少一条 fail**（= 还有活）且 `unsupported == 0`」；另立 `isSatisfied` 专供 `t_done_from_claimed` 与 `patrol.drift.missed_close`
- **为什么**：现状"全过才能领"使有活的卡永远领不到，与闸互锁（R6/R7，0.3）
- **判据**：双向夹具——`canClaim(含1条fail的卡).ok === true` ∧ `isSatisfied(同卡) === false`；`canClaim(全绿卡).ok === false`。两向都过才算

**P02 【前置】`void` 从 `claimed` 也可达 + 判据补齐**
- **放哪**：`state_machine.transitions[]` 新增 `t_void_from_claimed`；`t_void.guard.clauses` 扩写
- **加什么**：guard = 「全部 target 对 `existsTarget` 为 false」∧「**两条不同 `scanRev`** 的独立读数一致」∧ `void_reason ∈ {target_missing, feature_retired}`；`voided_by` 只允许 `patrol`
- **为什么**：R2（claimed 无路可走）+ R4（`existsTarget` 根本不存在）+ 本仓实测过"索引陈旧把 pass 刷成 unsupported"（`frictions` #28）⇒ 单次读数会把"重算中"误判成"对象没了"
- **判据**：① `grep -rn existsTarget src/` ≥ 1 且该函数被 `t_void` 的 guard 消费；② 夹具：删文件后**单次**扫描 ⇒ `void` 计数 == 0（判"暂缓"）；**两次不同 scanRev** ⇒ == 1

**P03 `superseded` 的判据（今天只有名字）**
- **放哪**：`t_supersede.guard.clauses`
- **加什么**：「新卡带 `replaces`」∧「`old.state ∈ {candidate, claimed}`」∧「**新旧 expectations 不 deep-equal**」∧ `superseded_reason ∈ {decision_changed, retarget, duplicate}` ∧ `superseded_by`
- **为什么**：R3 + R5；不做则"重复卡"会被当成"取代"（两张一样的卡也能 supersede），而 done 卡会被吞掉
- **判据**：夹具三连——(a) 新卡 expectations 与旧卡全等 ⇒ 立卡**拒**（不是 supersede）；(b) 旧卡 done ⇒ supersede 拒；(c) 正常取代 ⇒ 两字段非空

**P04 【裁】`follows_up`（done 卡被改判据时的唯一出口）**
- **放哪**：`state_machine.transitions[]` 新增 `t_follow_up`（不改旧卡态，只允许新卡 `follows_up`）
- **加什么**：新卡 `follows_up=<旧卡 id>`；旧卡保持 `done`；guard 要求旧卡 `state === 'done'` ∧ 新卡 expectations 与旧卡不 deep-equal
- **为什么**：`replaces` 语义是"旧卡不该存在"，而 done 卡**存在过**是事实（D9 的核心一半）
- **判据**：全库"`state=done` 且被 `replaces` 指向"的卡数 == 0；且改 decision 后 `done→新 candidate` 1:1

**P05 `t_release` 的 reason 枚举**
- **放哪**：`t_release.guard.clauses`
- **加什么**：`release_reason ∈ {lease_ttl, stale_decision, blocked, handoff_abort, manual}`；`stale_decision` 是 P08 的唯一入口
- **为什么**：今天 reason 是自由字符串 ⇒ "为什么退"不可统计（D8）
- **判据**：release 传枚举外字符串 ⇒ 拒；全库 `release_reason` 的取值集合 ⊆ 五值

**P06 `t_claim` 的 CAS 措辞改成 JSON 家上的原语**
- **放哪**：`t_claim.guard.clauses[4]`
- **加什么**：把「`UPDATE tasks ... changes === 1`」改为「写盘带 `base_dsl_rev`（读到的 rev），冲突即拒并回报当前 rev」
- **为什么**：R9 —— 家是 JSON，"SQL 的 CAS"在这没有落点，而**唯一可用的原语**（`storage.ts:587` 的乐观锁）从未被传入
- **判据**：并发两 claim 夹具：成功 1 / 拒 1，拒的那条错误含 `当前 rev`

**P07 空集与"判不了"的三分**
- **放哪**：`t_claim` / `t_done_from_claimed` 的 guard
- **加什么**：显式三分——`judged.length === 0`（判不了）· `unsupported > 0`（判不了）· `failed > 0`（还有活）。三者都不得被读成"通过"
- **为什么**：`OQ5` 只讨论了空集，没讨论"空集与 unsupported 的区别"；而 `unsupported` 误报真绿已经发生两次
- **判据**：三条夹具各自给出不同的 reason 字符串（不许三条共用一个）

### 4.2 `task_home`（3 条）

**P08 已领卡的 decision 变更通道（防漂移的主开关）**
- **放哪**：`task_home` 新增 `stale_policy`
- **加什么**：`cardStaleness(card,node) → fresh | stale(summary|expectations)`，**纯派生、不落盘**；stale 时 `complete` 必拒；`release(reason=stale_decision)` 后可重翻
- **为什么**：`publish` 对 claimed+ 拒覆盖（现状）⇒ claimed 卡**永远停在旧判据**上，静默漂移（D9）
- **判据**：改 decision 后：① `complete` 必拒（一条断言）；② `cardStaleness` 在两个节点上分别返回 fresh/stale（能区分）；③ 卡上**没有** hash/rev 字段（守 invariant）

**P09 改名/合并的处置（卡 id = node id 的陷阱）**
- **放哪**：`task_home` 新增 `anchor_integrity`
- **加什么**：rename 必须走 `edit_dsl` 的 rename 操作，一次性产出 `superseded(retarget)`；禁止手改 id；patrol 增 `orphan_task`
- **为什么**：卡 id = `node_id` 是优点（判据对象天然唯一）也是陷阱（改名 = 换任务，历史断链）
- **判据**：rename 夹具 ⇒ 旧卡 superseded、新卡 replaces；**手改 id** ⇒ `orphan_task > 0`

**P10 单卡体积上限 + 默认渲染白名单**
- **放哪**：`task_home` 新增 `card_budget`
- **加什么**：默认渲染键 = `{summary, state, owner, counts}`；落盘上限 16 KB/卡；超限 ⇒ publish/claim 拒并提示拆卡
- **为什么**：D14 —— 卡会变成"什么都塞"的容器，而上下文是有成本的
- **判据**：渲染函数的键集合 == 白名单（断言）；超限夹具 ⇒ 拒

### 4.3 `provenance`（3 条）

**P11 `source` 落成字段 + 七类**
- **放哪**：`provenance.decision_card.source_kinds`（扩）+ `TaskSpec.source`
- **加什么**：`source: {kind, ref, at}`，`kind ∈ {doc, utterance, thought, friction, defect, peer_agent, interrupt}`；`source` 必填、**不可变**
- **为什么**：R5（今天 `source` 只是设计文字，没有字段）；且 `peer_agent`/`interrupt` 是用户点名要有的来源
- **判据**：① 无 `source` 的卡 publish 拒；② 改 `source` 的下一次写拒；③ 全库 `source.kind` ⊆ 七值

**P12 `source` 与 `history` 分家**
- **放哪**：`provenance` 新增 `history` 子段 + `TaskSpec.history[]`
- **加什么**：`history` 只落 7 种决策事件（publish/claim/release/handoff/complete/void/supersede），每条 `{kind, at, by, reason?}`，≤200 字节/条
- **为什么**：R11（claim 会把 release 痕迹抹掉）⇒ "谁做过、为什么退"今天**答不出**（D8）
- **判据**：① `at` 单调不减；② state 变更次数 == 事件数；③ 不含 `observed/passed/failed` 键

**P13 `source.ref` 可解析**
- **放哪**：`provenance.decision_card.source_kinds[*].where`（改成判据）
- **加什么**：`doc` ⇒ 文件 + 行号；`utterance` ⇒ **逐字**引文（可在流水账里 grep 到）；`friction` ⇒ `frictions.jsonl` 的行号/id；`defect` ⇒ 一条读数命令 + 其输出
- **为什么**：`source` 只写"用户说的"仍然追不到（用户原话必须逐字，DSL 已定但没判据）
- **判据**：每条 `source.ref` 都能被一条命令验证（utterance 用 grep 命中、friction 用 id 命中）；验证失败 ⇒ 卡降级为 `thought` 并点名

### 4.4 `board`（6 条）

**P14 【裁】榜单是读端，状态表不落盘**
- **放哪**：`board` 新增 `surface`
- **加什么**：`board = f(red_list, task_cells)`，读时现算；仓库内**不存**榜单状态文件；只存 append-only **事件行**
- **为什么**：R12（无读端）+ R13（手写榜已重复/漂移）+ `board.md:9` 自认
- **判据**：① 全仓不存在"榜单状态"数据文件（只有渲染输出）；② 输出带 `scanRev` + 生成时刻；③ `docs/board.md` 的表格不再由人手改（改由生成物覆盖或删除）

**P15 `focus` / `full` 双视图 + 守恒**
- **放哪**：`board.surface.views`
- **加什么**：两视图同源；`focus ⊆ full`；`shown + folded == total`
- **为什么**：X3 —— "自动生成"与"别干扰我"的唯一不冲突解
- **判据**：守恒等式在任意卡集上成立（纯函数，可单测）

**P16 可见性谓词（三类）**
- **放哪**：`board.surface.focus_predicate`
- **加什么**：`mine(claimed)` ∨ `touches ∩ 我的 claimed` ∨ `requires:user_ruling / blocked_by → 我`
- **为什么**：D7 —— "哪些不该干扰我"必须可判，否则默认视图迟早被塞满
- **判据**：focus 每条都命中三类之一；任一不命中 ⇒ 测试红

**P17 【裁】收口双签 + 单 agent 降级**
- **放哪**：`board.roles.verifier` + `state_machine.transitions[t_done_from_claimed].guard`
- **加什么**：done 需 `verified_by ≠ owner` ∧ `verifier_kind ∈ {human, other_agent, machine_channel}`；`machine_channel` 必须记录"换了哪条通道"
- **为什么**：X4 —— 双验在单 agent 下**无解**，不写降级就等于"done 永远达不成"
- **判据**：① 全库不存在 `done ∧ verifier==owner`；② `verifier_kind=machine_channel` 的卡必须带 `channel` 字段；③ 缺 verifier ⇒ done 拒

**P18 回执是 done 的前置（机器证据 + 回执证据）**
- **放哪**：`board.flow[4][5]`（把"回执"与"验收"接起来）
- **加什么**：done 的 evidence 至少两条且 `kind` 不同（`expectations` 机器 + `attestation`/`reading` 回执）
- **为什么**：今天"回执"与"验收"是两条平行叙述，没有一条判据要求"回执里的读数 == 验收的读数"
- **判据**：done 卡 `evidence` 的 `kind` 去重后 size ≥ 2；只有一条 ⇒ done 拒

**P19 【裁】`pool` 与 `disposition`（红的取舍闸）**
- **放哪**：`board` 新增 `intake` 子段
- **加什么**：红 ⇒ pool 自动；`disposition ∈ {do, defer, wontfix, duplicate}` + `why` + `recheck_at`；只有 `do` 能 publish；`void` 不允许人工置
- **为什么**：D11 —— 否则红无限堆积；且"我否掉一条红"今天没有出口
- **判据**：① pool 里 `disposition` 缺失数 == 0；② `disposition=void` 被拒（void 只能由 target 消失产生）；③ 守恒差额 == 0

### 4.5 `two_level_tasks`（3 条）

**P20 `level` 字段（publish 时刻钉住）**
- **放哪**：`two_level_tasks` + `TaskSpec.level`
- **加什么**：`level ∈ {L1, L2}`，publish 时按"decision 是否已可判"钉住；`level_from` 指向 L1 卡（L2 才需要）
- **为什么**：level 在实现后会变（L1 卡做完后 decision 就"可判"了）⇒ 不能用当前状态派生，必须钉在**事件时刻**
- **判据**：① L2 卡的 `level_from` 指向的卡 `state === 'done'`；② 同一次 `operations[]` 内 `level` 集合 size ≤ 1

**P21 L1 的五条验收判据**
- **放哪**：`two_level_tasks.L1_construct.criteria`（替换"validateDSL 通过 + 至少一条 expectation"）
- **加什么**：见 D10 五条（含"至少一条 post 且**此刻至少一条 fail**"）
- **为什么**：四个反例都能过现状；而"全绿卡可 publish 且可 claim"正是 D16 的造假入口
- **判据**：一条命令输出五个布尔；五条全 true 才算 L1 完成；任一 false ⇒ 拒收口并点名

**P22 L1 的"语义一致"列为判不了（不许假装能判）**
- **放哪**：`two_level_tasks.L1_construct.criteria` 的 `unsupported`
- **加什么**：显式写"summary 与 expectation 的语义一致性 **机器判不了** ⇒ 属人裁"；列入 `invariant_unjudgeable`
- **为什么**：本仓已有"判不了 ≠ 通过"的纪律；把它写成判据会得到假信号
- **判据**：该条**不出现**在任何 `invariant_checks[*].cmd` 里（grep 0），且出现在 `invariant_unjudgeable`

### 4.6 新增子段（7 条）

**P23 并发：`base_dsl_rev` 一路传**
- **放哪**：`task_home` 新增 `concurrency`
- **加什么**：所有 task 写都传 `base_dsl_rev`；冲突 ⇒ 拒 + 报当前 rev；daemon 侧单写者兜底
- **为什么**：D12 / R9
- **判据**：并发 N 写后 `dsl_rev` 增量 == N；冲突夹具含当前 rev

**P24 时钟：`boot_id` + 重启规则**
- **放哪**：`task_home` 新增 `lease_clock`
- **加什么**：回收判定用单调来源；`boot_id` 变化 ⇒ 由一条**显式规则**决定全部回收/全部续期（写死，不许"自然发生"）
- **为什么**：D13；`OQ2/OQ6` 争的是"取多少"，而这维是"拿什么量"
- **判据**：改墙钟 ⇒ 回收判定不变；重启夹具 ⇒ 走显式规则且报告里点名

**P25 依赖：`blocked_by`**
- **放哪**：`task_plan` 新增 `depends` 子段 + `TaskSpec.blocked_by[]`
- **加什么**：只有 `done` 解锁；`void/superseded` 不解锁（需人裁）；指向不存在的卡 ⇒ 立卡拒
- **为什么**：D4；`blocked_by_open_question` 已有"悬空引用必须变红"的先例，可复用同一纪律
- **判据**：blocked 卡 claim 拒且列出阻塞卡；悬空 `blocked_by` ⇒ 立卡拒

**P26 并行边界：`touches` 派生 + 冲突守卫**
- **放哪**：`task_home` 新增 `parallelism`
- **加什么**：`touches` 从 expectations 的 `path/from/to` **派生**（不落盘）；claim 时求交，非空 ⇒ 拒或排队（`serialized_on`）
- **为什么**：D4 / X5；`touches` 可派生 ⇒ 不违反"不复制事实"
- **判据**：全库"两张 claimed 卡 `touches` 交集非空"计数 == 0；`serialized_on` 的卡不计入 WIP

**P27 优先级：三键排序**
- **放哪**：`board` 新增 `priority`
- **加什么**：`user` 置顶 > 阻塞系数（派生）> 代价（`touches` 数，派生）；插单只能插队首，**不得抢占 claimed**
- **为什么**：D11；"临时插单"若允许抢占，等于允许任何人打断任何人
- **判据**：插单后所有 claimed 卡 `owner/claimed_at` 不变；排序函数纯（同输入同输出）+ top-3 带解释串

**P28 归档：终态卡出 DSL**
- **放哪**：`task_home` 新增 `retention`
- **加什么**：终态卡超过 K 笔或跨 M 个 `dsl_rev` ⇒ 归档到 append-only（带全字段快照 + `dsl_rev`），节点上移除
- **为什么**：D15；不归档则 DSL 线性膨胀，且终态卡污染"红绿统计"
- **判据**：归档后 DSL 字节回到基线附近；按 id 仍能查到完整历史（一条查询）

**P29 【裁】`open_questions` 追加 OQ12–OQ16（并绑定消费方）**
- **放哪**：`task_plan.open_questions`
- **加什么**：OQ12 领取判据（P01）· OQ13 done 卡被改判据是否续办（P04）· OQ14 双验在单 agent 下如何降级（P17）· OQ15 归档保留期（P28）· OQ16 插单可否抢占 claimed（P27）
- **为什么**：这五条今天**没有编号**，于是"讨论过"与"没讨论过"分不清（`blocked_by_open_question` 也没有消费方可指）
- **判据**：每条 OQ 都被至少一条 transition 的 `blocked_by_open_question` 引用，且该引用在 OQ 结题后**必红**（复用现有 invariant 的纪律）

---

## 5. 需要用户裁定的维（★ 不许我拍）

| # | 问题（一句话，可直接答） | 选 A 的后果 | 选 B 的后果 |
|---|---|---|---|
| 1 | **P01** 领取的判据是"还有活（至少一条 fail）"还是"全过（可收口）"？ | 系统可开工（现状死锁解除） | 保持与 `t_claim` 逐字一致，但改码必须先把活做完（逻辑矛盾） |
| 2 | **P04** done 卡被判据变更覆盖时，是"开新卡续办"还是"旧卡 superseded"？ | 保留 done 事实（历史完整） | 历史被改写（done 消失） |
| 3 | **P17** 单 agent 时双验可否降级为 `machine_channel`？ | done 可达（但需显式记录通道） | done 永不可达（榜单死锁） |
| 4 | **P19** 我能否把一条红置 `wontfix`（带复查期）？ | 红池可收敛 | 红池只增不减（你原话担心的"无限堆积"） |
| 5 | **P29-OQ16** 临时插单能否抢占已 claimed 的卡？ | 响应快，但正在做的人被打断（半修风险） | 只能排队首（安全，但"插单"名不副实） |

★ 其余 24 条补丁**不需要裁定**（它们是"把已有语义补成判据"，不是"选一条路"）。

---

## 6. 本场的 `[未核]`

★ **已核更正（写在这里，因为它是本场唯一的自我纠错）**：我第一读把 `frictions.jsonl` 记成"30 条（派活说 29）"，实际是 **`wc -l` 数换行符** ⇒ 29 条 + 末尾空行 = 30 个换行。派活是对的，我的读数是错的（同族教训：**"行数"不是"条目数"**，`filter(Boolean)` 才算）。

1. **`touches` 的派生完整性**：六类期望里，`edge-exists/edge-absent` 的 `from/to` 是**路径**（DSL 里逐字是 `src/...`），但 `judgeExpectations` 内部对 `from/to` 做了 `normPath`；我没验证"节点 id 与路径混用"时 `touches` 会不会漏项。⇒ P26 的判据要加一条"同一 target 两种写法归一"的夹具。
2. **`existsTarget` 的语义**：R4 只证明"符号不存在"，没证明"该怎么实现"（按 `files`/`edges` 两表查、还是按 `cache.db` 的 target 表查）。P02 的判据写的是"全部 target 对 existsTarget 为 false"，但**target 集合的定义**（卡上哪些字段算 target）我没钉死 —— 这是 P02 落地前的第一个问题。
3. **`docs/board.md` 的生成替换**：P14 要求"不再手改"，但我没核"生成物覆盖 md 会不会破坏 :3-:10 那段用户原话引用"（那是要保留的）。⇒ 需要"生成区 + 手写区"分段（像 `MANIFEST.txt` 那种）。
4. **并发/时钟两维的严重度**：我给了 R9/R10 两条读数，但**没有实测**"两个进程同时 claim 会怎样"（只读了代码路径）。⇒ D12 的严重度是**推断**（按 0.2 的纪律：没排除过就写"待查"）。
