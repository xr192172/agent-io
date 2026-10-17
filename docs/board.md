# 任务榜单（board）

> ★★★ **用户 2026-10-16 定的规矩**：*"应该比直接的 ToDo 文档是要好的，因为它**强制**你管理……
> 我发现你有的时候 ToDo 做完了之后**不勾掉**，也**不验收**，**验收的话也可能验收错**。"*
>
> **三条强制**：**① 上过榜单的任务必须有终态 · ② done 必须有验收读数 · ③ 验收要双验（榜单验 + 自己再验）**。
> ★ **未上榜单 = 不算在办**；★ **未领取不得开工**；★ **完成判定者是榜单，不是做的人**。
>
> ★ **本榜单目前是「手写版」**（组件未建）；★ 等 `board` 组件落地后，改由它自动维护。
> ★ **列 ≠ 状态**：`待发布 / 已发布(候选) / 已领 / 待验 / 已收口 / 已退回`

---

## 一、已收口（★ 附**验收读数**，不是"我觉得好了"）

| # | 任务 | 领取者 | 回执（做了什么） | ★ 验收读数 | ★ 双验（我自己再验） |
|---|---|---|---|---|---|
| T1 | **第一块**：`task_schema.ts` + `task_machine.ts` | 子代理 | 两个新文件（130+292 行）；`NEGATIVE_KINDS`/`positiveExpectations`/`canClaim`/`releaseIfExpired` | 该块 **0红/9绿**，其他块 5/7/3 红不变；build ✓ · verify 4/4 ✓ · 十九证 19/19 | ★ **我逮到它报过头**：称"真绿, unsupported 0"，实测 **`unsupported=2`**（⇒ **判为"7 绿 + 2 判不了"**，不算全绿） |
| T2 | **第二块**：`discussion_log.ts` | 子代理 | `renderMicro`（白名单只出 `micro`+`open_count`）· `shouldExpand`（三触发） | 该块 **3红→0红**；★ 端到端：`user_quote` **三段子串全 false（连键名也 false）**；★ **先验了引文真实性**（逐字在 md 中 = true） | ★ 我核了：**真仓 4 文件 mtime+md5 逐字相同**；★ 并**问清了 `unsupported=2` 的来源**（索引未刷新 ⇒ **重算后 0**） |
| T3 | ★★★ **修 G2**：`expectations.ts:335-337` type-only 排解的扩展名口径（`.ts` basename vs `.js` 说明符）⇒ 死代码 ⇒ 假红 | 子代理 | `rawHit = raw.find(r => baseNoExt(r.source) === baseNoExt(to))`（+18/−1）；并把那条边补进设计 DSL（+1 期望） | ★ **fail → unsupported（不是 pass）**：修前 `[fail] edge-exists discussion_log→task_schema` ⇒ 修后 `[unsupported]`（detail 写明"type-only ⇒ 按设计不建边 ⇒ 判不了"）；全量 diff **只差 2 行**（1–24 条逐字相同）· 新证 **t346 PASS=10/FAIL=0**（含 (a) 真 type-only⇒unsupported / (b) 真有边⇒pass 双对照）· 20 张证全绿 · verify 4/4 | ★ **我自跑：`checked 25/passed 10/failed 12/unsupported 3`**（`discussion` 块 3绿→4绿、unsupported 2→3）⇒ **与回执数字一致**；★ 它自报的 `[未核]`：basename 去扩展名的唯一性未在全仓枚举同名不同目录（**已在代码注释声明限度**） |

---

## 一·五、待验（★ 已交回执 · 等「不是做的人」双验 —— ★ 依 §四 第 3 条，做的人不许自己填双验）

| # | 任务 | 领取者 | 回执（做了什么） | ★ 验收读数 | ★ 双验（★ 必须由**不是做的人**填） |
|---|---|---|---|---|---|
| T4 | ★★★ **给 `invariant_checks` 做 runner**（G5） | 主代理（2026-10-16 小会） | 新增 `scripts/run-invariant-checks.mjs`（逐条**原样**跑 `task_plan.invariant_checks[i].cmd`，exit 0⇒PASS / 非 0⇒FAIL，**无 cmd 亦判 FAIL**）· `package.json` 加 `npm run invariants` · DSL 加 `task_plan.invariant_checks_runner` | 真仓读数：`npm run invariants` ⇒ `checks=4 PASS=4 FAIL=0`（exit 0）；★ **抓坏证明**：改坏夹具（第0条期望加一个不存在的标记 `NOT_A_REAL_KIND`）⇒ `checks=4 PASS=3 FAIL=1`（exit 1），且 runner 打出被改坏 cmd 的 marker `MARKER:tampered-cmd-ran` ⇒ **证明它真在跑 `cmd` 字段**；另：删掉第3条 `cmd` ⇒ FAIL=1（"无执行者"守门）· validateDSL valid=true 问题数 0 | ⏳ **待填**（★ 由非做的人：逐条比对 `cmd` 原文与 runner 输出、复核夹具是否真被改坏） |
| **T10** | ★★★ **把 `NEGATIVE_KINDS` 收归成 `Expectation.phase`** | 子代理 | ★ **收归成「派生维」而非落盘字段**：`src/domain/expectation.ts` 新增 `ExpectationPhase` + `PHASE_BY_KIND`（`Record<Expectation['kind'],…>`，编译器穷尽）+ `expectationPhase()` / `postExpectations()`；★ **删补丁**：`task_machine.ts` 的 `NEGATIVE_KINDS` / `NegativeKind` / `isNegativeExpectation` / `positiveExpectations` **全删**，`canClaim` 改为 `postExpectations(card.expectations)`（从 phase 派生）；★ 连带改设计 DSL 2 处**反钉点**（`symbol-exists NEGATIVE_KINDS` 期望 → `symbol-exists expectationPhase@expectation.ts`；`invariant_checks[0].cmd` 重钉到 phase） | ★ ①结构：`ExpectationPhase`/`PHASE_BY_KIND` 见 `expectation.ts:35-110`（新增一种前态判据 = **改 1 处**：`PHASE_BY_KIND` 里它那一行）；★ ②补丁删除证明：`task_machine.ts:63-66`（`const judged = postExpectations(card.expectations)`）—— 全仓 `grep` 无 `NEGATIVE_KINDS/positiveExpectations/isNegativeExpectation` 的**导出**；★ ③同底对拍（`certs/.work/probe-t348-compare.mjs`，两侧各自现算索引）：before `checked 25/passed 12/failed 12/unsupported 1` ≡ after，**逐条只差第 5 条**（`NEGATIVE_KINDS@task_machine` pass → `expectationPhase@expectation` pass，**设计重钉**，非逻辑变化）；★ 真仓 root 直接跑因**索引陈旧**漂成 `10/12/3`（已分辨并留痕）；★ ④新证 `certs/t348-phase-classification-cert.mjs` = **PASS=17 FAIL=0**（含反例：只有 `edge-absent` 的未领卡 ⇒ `canClaim.ok===false`；前提自证：该判据单独判 = pass ⇒ 不排除必假绿；工具层：`edit_dsl` 写 `edge-absent` 成功且**无 phase 字段**）；★ ⑤`npm run build` ✓ · `npm run verify` **4/4** ✓ · 证 **22 张**（t326–t348）全绿 · `npm run invariants` **4/4** ✓ · validateDSL valid=true 问题数 0；★ ⑥真仓保护：`features/self-2026-10-15.json`(11:01:53, md5 0e9fa610…) 与 `live/self-2026-10-15.dsl.json`(00:19:48, md5 8eedb524…) **mtime+md5 未变**；★ 但 `cache.db` 主库被探针以读写开过一次（21:09:26→23:34:10，B3 留痕，数据未改） | ⏳ **待填**（★ 由非做的人：复核 ③ 的"逐条只差第 5 条"与 ② 的"导出不存在"，并独立判定 `phase` 该不该落盘） |
| **T5** | ★★★ **第三块 `task_ops.ts`（claim/release/complete）** —— ★ **开工前核出阻塞 ⇒ 停手报告**（不动源码） | 主代理 | ★ **没做任何源码改动**（判据：`task_ops.ts` 不存在、本块仍 5 红）。★ 核出的阻塞 = 该节点的 design 只钉「动作存在 + 调谁」，**没钉「状态写到哪」这一维**：① 任务格**无家**（`TaskSpec` 消费点只有 `task_machine.ts`；`Node` 无 `task` 字段；schema/DB 无 `tasks` 表）；② **claim 的状态迁移无 sanctioned 写端**（`updateStatus` 写的是 `progress` 三值轴，task 态是**另一条五值轴**，无映射 ⇒ 一件事两处权威）；③ 要让动作可调用就得进 `edit_dsl` op 家族（**≥4 处**协同）。⇒ 照现状必得**半修**。 | ★ **停手前读数（真仓 root，同一入口 probe-plan-detail）**：`checked 25 · passed 12 · failed 12 · unsupported 1`；**本块 task_ops = 5红/0绿**（item10 file-exists · item11 claimTask→canClaim · item12 edge task_ops→task_machine · item13 completeTask→validateProgressEvidence · item14 completeTask→updateStatus），**其他块逐字不变**（task 格 0/3 · 状态机 0/6 · discussion 0/4 · task_drift 7/0）。★ **⑧重算后**（临时目录 + 独立 AGENT_IO_HOME，`probe-block1-recompute`）读数**逐字相同** ⇒ 5 红是**真红**、非索引陈旧。★ 未跑 t349（**未新增方向 ⇒ 不新增证**，B1）。★ 阻塞发现已落 **OQ11**（设计 DSL `open_questions`，validateDSL **valid=true 问题数 0**）。 | ⏳ **待填**（★ 由非做的人：独立复核「任务格无家 / 两轴无映射 / op 家族 ≥4 处」三条读数，并**裁定 OQ11 走 (A) 收归进 progress 单轴 还是 (B) 给 task 格立原生家 + 唯一写端**） |
| **T11** | ★★★ **收归第二刀（OQ11=B）：给 task 格立原生家 + 唯一写端** | 主代理（2026-10-17） | ★ **收归（非打补丁）**，按 `task_home` 逐条：① **家** = `geometry.nodes[].task`（`geometry.ts` 的 `Node.task?: TaskSpec` + `schema/design_dsl.schema.json` 的 `task`）；② **唯一写端** = `edit_dsl {type:'task'}`（`dsl_ops/task_ops.ts` 的 `claimTask`/`releaseTask`/`completeTask`；op 家族四处同改：`index.ts` 的 op/type enum · `update_feature.ts` 的联合 + `applyOperation case`（写链改 async）· `op_data_spec.ts` 的 `OP_SPECS` + `TYPE_KNOWN_KEYS`）；③ **两轴消歧** = `task_schema.ts#progressOf`（派生）+ `overlay.ts#applyOverlay` 派生优先 + `seedOverlayFromDsl` 不播种派生值；④ **闸换判据** = `write_gate.ts#assertSourceWriteRegistered` 读 `node.task.state==='claimed'`。★ 第 ④ 步（overlay 的 progress 退役）**未做**，另上榜单。 | ★ ①**本块 5红→0红**（同一入口 `certs/.work/probe-plan-detail.mjs`，临时根重算）：`checked 25 · passed 12→17 · failed 12→7 · unsupported 1`（恒定，那一条 = discussion_log 的 type-only 边，与本块无关）；**其他块逐字不变**（task 0/3 · 状态机 0/6 · task_drift 7/0 · discussion 0/4）。★ ②两轴：(a) `claimed ⇒ progress='in_progress'`；(b) `void ⇒ undefined`（不许硬塞；`superseded` 同）。★ ③闸：(a) 无 task ⇒ 拒；(b) 有 claimed ⇒ 放行；★(c) **播种了 overlay.progress='done' 但无 task ⇒ 仍拒**（能自己坏的对照）。★ ④新证 `certs/t349-task-home-cert.mjs` = **PASS=34 FAIL=0**（含工具层 claim/complete/release、旧写端改不动派生值）。★ ⑤门：build ✓ · verify **4/4** ✓ · invariants **4/4** ✓ · validateDSL valid=true 问题数 0 · **证 23 张（t326–t349）全绿**（t326–t347 一批 21 张 · t348/t349 各单跑 —— ★ 宿主删除闸按「每回合 50 次删除」计，`rmSync` 夹具在四五十次后会抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`，与本笔代码无关）· 两个**既有**红 `t197sub-flow`(22/6) / `t198sub-approval`(7/8) 读数未变（改前既有）。★ 另按新契约**更新了既有证夹具**：t329/t330 的 `updateFeature` 调用加 `await`（写链改 async）· t332 的「登记」改为立卡+claim · t326 基线 +852 字符（全部落在 edit_dsl 的新 op 契约）。 | ⏳ **待填**（★ 由非做的人：独立复核「闸两对照 + 播种 progress 仍拒」、`progressOf` 的 void/superseded、以及 `task_ops` 块 5红→0红 的同一入口读数；并裁定「立卡无写端（归 board T8）」这个缺口是否要现在补） |

---

## 二、待发布（★ 已抽出，未上榜单 = 不算在办）

| # | 任务 | 为什么排这个位 | 抽自 |
|---|---|---|---|
| **T12** | ★★★ **补 `publish`（立卡）—— 最高优先**：T11 落地后闸变严，而真仓节点**一张 task 都没有** ⇒ **改任何源码都会被拒**（闸把仓锁死了）⇒ 加 `edit_dsl{type:'task', op:'publish'}`（`data.summary/expectations`），并把"从设计 DSL 抽出这块 ⇒ 立卡"接进 `board` 的发布 | ★ T11 自报"缺一维"（`task_home` 只有 claim/release/complete）· ★ **不选"闸只告警"那种退法**（那等于闸失效） | 设计 DSL `task_home` + T11 回执 |
| ~~T4~~ | ~~给 `invariant_checks` 做 runner（G5）~~ | ★ 已做完 ⇒ **移入 §一·五 待验**（★ 榜单规矩：做完不许留在这里不勾） | §83.4 G5 |
| ~~T5~~ | ~~**第三块 `task_ops.ts`**（5红）~~ | ★ **已领取 ⇒ 开工前核出阻塞 ⇒ 停手**（见 §一·五 T5） | 设计 DSL 的 `block_order` |
| T6 | **第四块 `task_drift.ts`**（7红） | 要跑 live 重算，最重 | 同上 |
| T7 | **OQ9 重构**：`task_machine` 抽成 domain 纯函数（`{facts, expectations}`） | ★ 已裁定未做；且**让判定可单测** | `rulings_2026_10_16` |
| T8 | **`board` 组件**（★ 本榜单的自动化版） | 治"做完不勾/不验收/验错" | `task_plan.board` |
| T9 | ★★★ **给设计 DSL 做健康检查**（消"图本身可能是错的"这个不确定）：① 反装饰（每条边/断言有判据吗）② 反空谈（每个承诺有判据钉吗）③ ★ **反空转（每条判据都在跑吗）** | ★★ 用户 2026-10-16 提出的核心疑虑；★ 实测依据：我今天写 DSL 错了 **7 处，0 处是"自己读一遍看出来的"** | 设计 DSL `design_dsl_health`（五层：形状/语义/事实/反向/盲点） |
| ~~T11~~ | ~~★★★ **收归第二刀（OQ11=B）：给 task 格立原生家 + 唯一写端**~~ | ★ **已领取并做完** ⇒ **移入 §一·五 待验**（★ 榜单规矩：做完不许留在这里不勾） | §一·五 |
| T10 | ★★★ **收归：`NEGATIVE_KINDS` → `Expectation` 原生 phase**（`docs/principle-rewrite-not-patch.md`） | 子代理 | 把「前态/后态」从外部清单改成 **`kind ⇒ phase` 派生**（★ **唯一权威处**，且 **`tsc` 保证漏标编不过**）；★ **`NEGATIVE_KINDS` 从代码里消失**；`canClaim` 改为 `postExpectations(...)`（`task_machine.ts:66`） | ★ **结构判据①：新增一种前态判据只改 1 处**（它自己的 kind⇒phase 标注）· ★ 全量对拍 `passed 10→12 · unsupported 3→1` · 新证 `t348 PASS=17/FAIL=0` · 22 张证全绿 · verify 4/4 · invariants 4/4 · validateDSL 0 问题 | ★ **我核**：① `phase` 确由 kind 派生（**不是**落盘字段 ⇒ 避开"存两处"= 本仓头号病）② `NEGATIVE_KINDS` 只剩注释里的历史说明 ③ 我自跑对拍与它一致；★ 它**如实报了一条残留**：`canClaim` 仍要"选取"后态判据 —— ★ **而这判断正确**（选取是按自带属性筛选，不是"记得剔除") |

---

## 三、★★ 历史欠账（★ 榜单最该先治的：挂了一整天没人管）

| # | 任务 | 现状 | ★ 处置（按榜单规矩：**必须有终态**） |
|---|---|---|---|
| D1 | `src/application/design/derive/opl.ts` | ★ `progress = in_progress`，**挂了约 6 小时** | ⏳ **待处置**：交回执 ⇒ 通过则 `done`；否则 **退回候选**（★ 不许继续挂） |
| D2 | `src/application/refactor/rename/rename_files.ts` | ★ 同上 | ⏳ 待处置 |
| D3 | `src/domain/overlay.ts` | ★ 同上（★ 但注意：它的 `judgeExpectations` 是**已实现且在用的**） | ⏳ 待处置 |

★ **这三条是今天"不勾掉"的实证** —— ★ **榜单的第一件事就是让它们有终态。**

---

## 四、★ 本榜单自身的验收判据（★ 免得它变成"又一个装饰"）

★ **判据（可判）**：
1. **任何"已收口"行必须有"验收读数"列非空**（★ 空 ⇒ 视为未验收，退回待验）；
2. **任何 `in_progress` 超过一个工作时段 ⇒ 必须出现在"历史欠账"区**（★ 不许静默挂着）；
3. ★★ **"双验"列必须由「不是做的人」填**（★ 今天实测：验收会错 2 次 ⇒ 所以双验不是形式）；
4. ★ **本榜单若连续多笔不更新 ⇒ 它自己就是欠账**（★ 用 `_sync.age` 那套判新旧）。
