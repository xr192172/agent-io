# 任务系统 · 结构索引（供每个子代理开发前先读）

> ★★★ 2026-10-17 用户定：**每次开发前，先让子代理读这一段**，再动手。
> ★ 本文件是**索引**，不是替代品：先读它知道"有什么、在哪"，需要细节时**按行号展开原文**。
> ★★ 三者定位：**索引**=知道在哪（便宜）· **直读**=知道为什么这样、哪里错（贵但准）· **脚本**=只做能在 1 秒内验的机械判据（不能替代理解）。

| # | 文件 | 职责 | 行数 | 关键导出（行号） |
|---|---|---|---|---|
| 1 | `src/domain/task_schema.ts` | 任务格的结构（五态/字段/TaskSpec） | 203 | TASK_STATES(43) · TaskState(46) · TERMINAL_TASK_STATES(49) · isTaskState(56) · isTerminalTaskState(61) · progressOf(93) · TaskDiscussion(111) · TaskEvidenceRecord(133) · TaskSpec(149) · taskLevel(200) |
| 2 | `src/domain/task_machine.ts` | 状态机 + cardStanding 五值 + 迁移表 + TTL 回收 | 520 | CardStanding(70) · StandingNode(73) · StandingInput(79) · SatisfactionCounts(96) · ViolationCounts(104) · StandingVerdict(110) · RedAttribution(142) · RedDisposition(149) · RED_DISPOSITION(162) · cardStanding(192) · …共18 |
| 3 | `src/domain/expectation.ts` | 期望的六种 kind + phase（pre/post）+ 判定入口 | 207 | Expectation(35) · EXPECTATION_KINDS(54) · ExpectationPhase(88) · expectationPhase(109) · postExpectations(120) · normPath(125) · normSignature(130) · describeExpectation(135) · assertValidExpectations(147) · expectationSubjectPath(189) · …共12 |
| 4 | `src/domain/geometry.ts` | 节点/边的结构（path 字段） | 432 | DiagramStatus(11) · resolveDiagramStatus(23) · NodeLayer(34) · NodeStyle(37) · BlockStyle(59) · ContentBlock(69) · NodeContent(107) · Node(115) · DecisionAuthor(213) · NodeDecision(216) · …共17 |
| 5 | `src/domain/discussion_log.ts` | 讨论登记格（micro 渲染） | 153 | MICRO_KEYS(36) · MicroKey(39) · EXPAND_ONLY_FIELDS(49) · ExpandOnlyField(52) · DiscussionMicro(55) · renderMicro(74) · excludedFields(87) · ExpandTrigger(103) · EXPAND_TRIGGERS(106) · ExpandContext(112) · …共12 |
| 6 | `src/application/design/dsl_ops/task_ops.ts` | publish / claim / release / complete 四个动作 | 671 | TaskOpRequest(52) · TaskOpInput(59) · publishTask(253) · claimTask(419) · releaseTask(513) · completeTask(559) · applyTaskOp(640) |
| 7 | `src/application/design/dsl_ops/node_ops.ts` | 节点的 add/update（含 decision 写入） | 505 | PATH_NODE_KINDS(48) · PathNodeKind(49) · AddNodeInput(98) · addNode(137) · UpdateNodeInput(242) · applyDecisionWrite(290) · updateNode(358) · DeleteNodeInput(469) · deleteNode(474) |
| 8 | `src/application/patrol/task_drift.ts` | 漂移巡检（missed_close / should_void / lease_ttl） | 198 | DriftRed(37) · DriftCard(44) · DriftReport(60) · PatrolOptions(83) · patrolDrift(97) |
| 9 | `src/application/write_gate.ts` | 写源码前的任务闸（覆盖检查） | 1126 | WriteThroughOutcome(77) · SourceWriteReport(107) · hasLiveIndex(136) · SELF_WRITE_MAX(157) · recordSelfWrite(186) · syncSelfWrites(217) · syncSelfWritesSync(388) · TaskGateOutcome(482) · TaskGateBasis(515) · GateCoverageFeature(523) · …共18 |

## 设计 DSL

`docs/task-system-plan.dsl.json`（94KB / 6 节点 / 3 边 / 29 段 task_plan / 31 条期望）

- 期望判定：`node certs/.work/probe-plan-detail.mjs`（★ 读数：checked/passed/failed/unsupported）
- 判据清点：`node scripts/plan-assertions.mjs`（★ 49/13/1/35，`--fail-on-debt` 红时 exit 1）
- 词表：`node scripts/vocabulary.mjs`（★ 合法取值 + 强度，填卡前查）

## 已知缺陷（第 1 轮静态审查，详见 `static-review-1.md`）

★ 最重的两条**同源**：`patrolDrift` 零调用（A1）⇒ 卡永不过期 ⇒ 写闸只认"有 claimed 卡"而不认人（A7）⇒ 别人领的卡 = 永久万能钥匙。
