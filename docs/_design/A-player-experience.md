# A · 玩家体验 / 进度系统 —— 设计稿

> 立场：**把 LLM 当玩家、把项目当游戏**。任务与节点一路排布，玩家每次开工都知道"我现在该做什么"。
> 纪律（沿用 `docs/replan-2026-10-15.md` §0.5 读数纪律）：报"某处有某字段"必贴**读到的原文**；
> 只有 DSL 里看不到的（写入口 / 调用方 / 实现细节）才 grep 源码，且**先说明为什么 DSL 看不到**。
> ★ 本稿 grep 源码的理由：`progress` / `requires` / `progress_evidence` / 写端 / `pending` 查询
> 在 `.agent-io` 全部快照里**无一个实例**（进度轴 T328/T332 是 2026-10-15 新加，晚于最后一份 live 快照
> `self-2026-10-15.dsl.json` Oct 15 01:20；`pending` 是查询实现）⇒ 属"DSL 看不到的东西"。
> ★ 已实测采信（用户给的事实，我未复跑）：证书 t326–t332 六张全绿。

---

## 1. 玩家（LLM）在这个游戏里"看到什么"

**主张：眼前不是一块新面板，是"一屏已有文本"——方向读投影，动作读住处，叙述读入口，对拍当尺。**

| 玩家眼前 | 是什么 | 投影还是住处 | 原文依据 |
|---|---|---|---|
| ① 方向（往哪走） | `get_dsl{view:"live"}` 的 `meta.goals` | **投影** | `src/domain/overlay.ts:247`：「`applyOverlay` 把它投影进 base 的 `meta.function_tags`（与 `goals → meta.goals` 同款），让 `get_dsl` 当下即可读到」；`overlay.ts:230`：「结构化目标/方向（缺口④）：全局性设计意图，LLM 开发时作为方向信号读」 |
| ② 欠账（现在能干什么） | `query=pending` | **直读住处** | `src/application/meta/explore/query_feature.ts:1314`：「数据来源 = overlay **权威**（不是 base 上那份被投影出来的 `status`）；每次**现算**、**不落盘**」 |
| ③ 唯一下一步 | 入口文档 §0.5 | 叙述权威（文档） | `docs/replan-2026-10-15.md` §0.5：「现在在哪（★ **唯一裁决**；新会话只看这一段 + §0 就能开工）」+「下一步（**唯一**，不许并列）」 |
| ④ 尺（我以为的 vs 实际的） | `diff_views`（`get_dsl{view:"live"}` vs `{view:"design"}`） | 对拍 | 用户已实测事实：「现成封装 `diff_views`」 |

**住处 vs 投影的判真假边界**（这条是玩家体验的地基）：
- **住处** = `<feature>.overlay.json`：不可再生、权威、写端唯一。原文 `src/application/write_gate.ts:528`：「写端只有一个：`status_tools.updateStatus`（经 `edit_dsl` 的 `{type:'status'}` 操作进入）。」
- **投影** = base DSL 的 `meta.goals` / `geometry.nodes[].status`：可再生成、随读随现。玩家**读投影省 token，写必须落到住处**。
- ★ 为什么"要证据的视图只能读住处"——原文 `query_feature.ts:1304`：「`applyOverlay` 只把 `progress → base.status` **投影**，`progress_evidence` **不投影**……⇒ ★ 任何**要证据**的视图，读 base 都拿不到 evidence ⇒ 只能读 `<feature>.overlay.json` 本体」。

**判据（可判真假）**：`get_dsl{view:"live"}` 的输出里**没有** `progress_evidence`（投影不带它）；`query=pending` 的输出里**有**（每条形如 `evidence: {...}`，原文 `query_feature.ts:1352`：「`evidence: ${d.progress_evidence ? JSON.stringify(d.progress_evidence) : '(无)'}`」）。两者对同一节点给出的 `progress` 值必须一致——不一致 ⇒ 投影链坏了，玩家看到的就是假的。
[未核] `meta.goals` 投影在现有 live 快照里**无实例**（最后快照早于该投影行为）；我只有代码注释声称（`overlay.ts:247`），没跑到真输出。

---

## 2. "任务"该怎么排布：按**可做集合**，不按节点、不按 feature

**主张：任务的排布单位 = 可做集合（actionable set）= `query=pending` 的候选 ∩ write_gate 的前置放行。**

- **不按节点**：节点是扫描产出的**几何/依赖事实**，不是任务序。原文 `src/domain/overlay.ts:277`：「本仓的 edge 默认装的是 **import 依赖**（`Edge.intent` / 扫描产出的依赖边）—— ★ 它**不等于任务前置**」。⇒ 按节点排 = 把 import 图当关卡图，玩家会被"全仓依赖"淹死。
- **不按 feature**：feature 是覆盖面，goal 是"方向信号"（`overlay.ts:230`），**不是优先级**。一个 feature 里多条 `active` goal 并列时，玩家仍不知道先动哪个。
- **按可做集合**：玩家问的从来不是"有哪些节点"，是"**我现在能合法地改哪段代码**"——这正是 write_gate 判据算的东西。

**可做集合的算法（全部用现成件，不发明存储）**：
1. 候选 C = `query=pending`。口径原文 `query_feature.ts:1311`：「判据逐字 = `a.progress !== undefined && a.progress !== 'done'`（★ **不是**裸 `!== 'done'`，那会把"从没人认领的锚点"也卷进来）」。
2. 从 C 中剔除被前置闸挡住的：以 write_gate 同一判据（`write_gate.ts:569-582`）检查每个候选节点作为 `from` 的 edge intent 的 `requires`。
3. 排序 = 入口 §0.5 的"唯一下一步"——**人/开发者声明的优先级，机器不重新发明**。

**判据（可判真假）**：对任一节点 N，`query=pending` 列出它 ∧ 以 write_gate 口径查得它的 `requires` 全部 `done` ⇒ N 在可做集合里，玩家改它的源码**不会**被 `assertSourceWriteRegistered` 拒绝；反之若 N 的 `requires` 有未 done 节点，试改必得拒绝回执（原文见 §3）。两条都可当场跑。
[未核] 可做集合今天**没有单一条命令**直接输出（`pending` 不判 `requires`；`requires` 只在 write_gate 被写触发时才算）⇒ 判据靠"两命令拼 + 子代理试写"补（见 §4）。

---

## 3. 进度系统：三态够；奖励/解锁/成就的对应物全在现有字段里

**主张：`draft/in_progress/done` 三态够，且不许加第四态。奖励/解锁/成就不发明新存储，用现有字段表达。**

### 3.1 三态为什么够
原文 `src/domain/overlay.ts:197-201`：「本仓**已有的** `status?: 'open' | 'resolved'`……挂在 **`OverlayEdgeIntent`** 上……`OverlayGoal.status` 另是一套（`active|done|parked|dropped`）。它问的是「**这条意图还需不需要处理**」（存活），本条问的是 「**这个实现做完了没有**」（进度）。⇒ ★ **同一字段名 = 一个名字两个问句 = 本仓正在治的那个病**」。
⇒ 判据：三个状态轴各答一个问句（节点进度 / 意图存活 / 目标方向），已闭环；**再加第四态 = 又一个名字两个问句**，直接判它错。

### 3.2 奖励/解锁/成就的对应物（★ 不发明新存储）
| 游戏概念 | 本系统对应物 | 原文依据 |
|---|---|---|
| **解锁**（完成 A 才准碰 B） | `OverlayEdgeIntent.requires` + write_gate 前置闸 | `overlay.ts:273-274`：「★★★ **任务前置（显式声明，T332）** —— 引**节点 id**，语义 = 这些节点须先 `progress === 'done'`，本边的**源节点 `from` 的源码**才允许被 `write_gate` 落盘」；`write_gate.ts:624`：「**完成 A 才准开始 B**」 |
| **拒绝反馈**（撞墙的手感） | 拒绝回执自带"怎么办（二选一）" | `write_gate.ts:626-633`：「★ 怎么办（二选一）：① 先完成前置节点……② 若这个前置判断已过时 ⇒ 用 `design_intent` 显式**解除**它」 |
| **奖励/结算画面** | `progress_evidence` 三档——置 `done` 必须留下"我怎么知道的" | `overlay.ts:81-87`：`{kind:'expectations', all_green:true, unsupported:0}`（机器判）/ `{kind:'reading', command, observed, at}`（可复跑读数）/ `{kind:'attestation', by:'human'\|'llm', at, why}`（显式人工确认署名） |
| **成就**（一个方向达成） | `OverlayGoal.status: 'done'`（feature 级） | `overlay.ts:259`：「active=推进中 · done=完成 · parked=暂缓 · dropped=放弃」；实例 `run82.overlay.json:1383`：`"status": "done"`（`g-retire-flow`） |

**判据（可判真假，可当场测）**：`validateProgressEvidence`（T328 唯一校验器，`overlay.ts:98`）——`progress='done'` 且 `evidence=undefined` ⇒ 拒绝，且原文 `overlay.ts:93-96`：「**不静默、不自动补**：本函数**不**替调用方造一条证据，也**不**把 `done` 悄悄降级成 `in_progress` —— 拒绝就是拒绝」。构造反例跑一遍即可验；★ `write_gate.ts:634` 对前置闸同款：「本闸**不会替你登记进度、不会自动补前置、也不会降级放行**」。
⇒ 玩家体验结论：**这个游戏的"撞墙"从不静默**——每次撞墙都附带下一条合法动作。

---

## 4. 新玩家第一次打开：怎么知道"我现在该做什么"（★ 可复跑判据）

**主张：新手引导关 = 入口文档 §0.5，它已经存在；缺的不是新面板，是一条三步可复跑的判据。**

现状原文 `docs/replan-2026-10-15.md` §0.5：「现在在哪（★ **唯一裁决**；新会话只看这一段 + §0 就能开工）」；同文档 §3 主线 A 判据：「一个新会话**只读本文档 + 跑一条命令** ⇒ 能说出"下一步做什么、判据是什么"。★ 这条判据**可当场测**（让一个子代理只读本文档，问它"下一步做什么"，对不上就是没写清）。」

**我给的判据（三步，全部现成件，可复跑）**：
1. **叙述关**：起一个新子代理会话，**只给入口文档**（不给任何别的东西），问「下一步做什么、判据是什么」。必须答出 §0.5 的唯一下一步及其判据。答不出 ⇒ 入口没写清（这条是 replan 原文判据，我原样采信）。
2. **欠账关**：同会话跑 `query=pending`（feature = 当前主线 feature），必须列出候选节点清单（口径见 §2 步 1）。
3. **解锁关**：对候选逐个按 write_gate 口径验 `requires`（或试触发一次 write_gate 看拒绝/放行回执），得出可做集合。
**通过条件**：步 1 答出的"下一步" ∈ 步 3 的可做集合。三者矛盾任意一处 ⇒ "新玩家知道该做什么"这件事**不成立**，先修入口/账，不许开工。
[未核] 步 3 今天没有只读单命令直接输出"可做集合"（`requires` 判定只长在 write_gate 写路径上；`pending` 视图不判它）⇒ 现判据靠"子代理试写"补；**我不主张为此新建命令**（见 §5 第 4 条），但如实记：可做集合目前**无单命令判据**。

---

## 5. 我会砍掉什么（游戏设计里最重要的决定是"不做什么"）

1. **砍任务看板 / Kanban 可视化**。理由：进度已有唯一权威写端与文本视图（`write_gate.ts:528`「写端只有一个」；`query=pending` 现成），再看板 = **同一信息第二住处** = 本仓头号病（判据住两处）。判据：看板上的每个数都必须能由 `query=pending` 逐字复现，不能 ⇒ 它就是新腐源。
2. **砍第四种进度态**（如 `blocked` / `review`）。`blocked` 已由 `requires` + write_gate 表达（§3）；`review` 没有判据（谁审？多久算审过？）。判据：`src/domain/geometry.ts:10` 原文 `export type DiagramStatus = 'draft' | 'in_progress' | 'done';` —— 要加第四态，先过"一个名字几个问句"的质问（`overlay.ts:197-201`），过不了就不加。
3. **砍成就系统（积分 / 连续完成 streak / 排行榜）**。理由：没有判据判真假——"完成了 3 个节点"不说明任何事；且要新存储。对应物已存在：`goal.status='done'` + `progress_evidence`（§3.2）。判据：任何一个"成就"若能由这两个字段推出，就不该有独立存储；推不出 ⇒ 它没有判断力，不做。
4. **砍机器自动排程**（机器决定玩家下一步做什么）。"下一步唯一"是人的声明（replan §0.5：「下一步（**唯一**，不许并列）」），机器只算**可做集合**（合法动作，纯函数、可复跑）。判据：优先级排序写不出可复跑的函数（它取决于人的取舍）⇒ **判不了 ⇒ 不做**；反之可做集合判据已在 §2 给出。

---

## 6. 诚实清单

- **[未核]** `meta.goals` 投影无 live 实例（快照早于投影行为）；依据仅为 `overlay.ts:247` 代码注释。
- **[未核]** 可做集合无单命令判据（§4 步 3 靠子代理试写补）。
- **[未核]** 证书 t326–t332 六张全绿 = 用户给的已实测事实，我未复跑。
- **[未核]** 入口 §0.5 当前的"唯一下一步"指向"现状复核"（旧轴写入点 / progress 写端 / 四证）；本稿**不改变**该下一步，只给它加判据。
- **已核（贴过原文）**：`OverlayGoal`（`overlay.ts:253-260` + `run82.overlay.json:1330-1384` 实例）· `OverlayAnchor.progress`（`overlay.ts:195-209`）· `ProgressEvidence` 三档（`overlay.ts:81-87`）· `requires` 语义与"只认显式"（`overlay.ts:272-284`）· write_gate 双闸判据与回执（`write_gate.ts:528-637`）· `query=pending` 口径（`query_feature.ts:1298-1357`）· DSL 顶层形状（`.agent-io/live/t192flow.dsl.json`：`geometry.nodes/edges` · `semantic.files` · `layers` · `_sync`）。
