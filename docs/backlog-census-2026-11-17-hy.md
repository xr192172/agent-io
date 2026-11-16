# 总任务台账 · 文档侧（bklog-recon-hy 的一半）

> 侦察口径：只读，不改仓文件、不跑重门。跑过的只读脚本：`write-log-audit.mjs --json`、`patrol.mjs --json`、`design-check.mjs --json` + 自写只读对账脚本。
> 样本时间：2026-11-17（Asia/Shanghai）。行 34 ≤ 40。
> 优先级依据 Tracy 框架（业务驱动技术债 triage）：**operational × core × high-usage ⇒ P1**，`legacy / to-be` 或"只报不拦"⇒ P3；判 P1 的三类 = ① 门已红/将红 ② 每次写都在刷的摩擦 ③ 状态机最后一格空着。来源：[Business-Driven Technical Debt Prioritization: An Industrial Case Study (arXiv:2010.09711)](https://ar5iv.labs.arxiv.org/html/2010.09711)（Tracy 的 priority canvas：oper/core/high=1，legacy/other/low=10；论文实测技术优先级与业务优先级只有 36% 对齐 ⇒ 优先级列须带"当前裁定/待论证点"而非只写数字）、[Technical Debt Prioritization using Predictive Analytics (DOI 10.1145/2889160.2892643)](https://dlnext.acm.org/doi/epdf/10.1145/2889160.2892643#1)（principal/interest：越晚修越贵）。

| # | 来源 file:line | 任务（一句话） | 规模 | 优先级 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|
| 1 | docs/RETIRED.md:112-119 (R1) | 做挂在 `edit_code`/`plan_refactor` 的 `preview` 能力（多文件 diff 先看后落 + 过闸记 `applied_by/applied_at/gate`），不新开 store | L | P2 | 需求仍在、回炉条件未触发、未实现；`edit_code` 只有单次 `dry_run` | 真有"一次预览多个文件连锁改动"的场景吗？`blocked` 态与画布/写闸如何共存 |
| 2 | docs/RETIRED.md:121-125 (R2) | 给 `design_intent`/`edit_dsl` 加 `dry_run`（返回 before/after + 判据结论，不新增 action 语义） | M | P2 | 部分在、未实现 | 人拍板场景是否真需要先看 diff，还是一句"就这么改"即可；如何避免 enum/分支漂移重演 |
| 3 | docs/RETIRED.md:127-130 (R3) | 无当前任务（仅留条件触发） | S | P3 | 已闭合：需求否（前端只显示屏） | 若产品重新纳入"人直接插手标注"：谁是审批人？若无人 ⇒ 只做标注不做审批 |
| 4 | docs/RETIRED.md:134-139（待观察表） | 复评 `T-#CERT-1`（约 23 个"无证工具"）在 `certs/` 整目录退役后是否还成立；评 `approve_gated` 四层门长期 0 提案是否退场 | S | P3 | 表未随 certs 退役更新，已陈旧 | certs 已删，"补证"还有意义吗？0 提案是"没跑 daemon"还是"这条链不需要存在" |
| 5 | docs/GUIDE-GATE.md:23 · scripts/write-log-baseline.json:3-49 | **维持**无卡写账门棘轮：当前 7/7 全挂账（6 `acknowledged` + 1 `rows`，`max_no_card=1` 额度已用尽，新增即红）；本项**无"未挂账⇒要销账"任务** | S | P1 | 门在、分子全有主、新写塞不进来；门读数仍原样报 7（不打折） | 6 条 acknowledged 的处置卡是否真闭合（其中"造已认账档"那张在 patrol S2 里 evidence `unverifiable`）？1/1 额度永久占用可接受吗 |
| 6 | GUIDE-GATE.md:23 · write-log-audit / patrol 每次启动输出 | 清 20 条 `project_registry` 不可达登记（`registry_repair.mjs` dry-run → `--apply` 或 `unregisterFeature`）：vp-life-* ×13 / hub-* ×5 / opl-entry-t / tk-cases | S | P1 | "只报不删"，登记仍有效但目录 missing；**每次写都刷一遍同句警告** = operational 摩擦 | 这 20 个 feature 真永久删了吗（换机后路径未恢复？），删登记会不会丢历史归属 |
| 7 | patrol `stale.s1.superseded[0..2]`（task_plan.patrols[0].unjudged / [1].metrics[0..1]） | 把 3 处 "patrolDrift 全仓零调用（A1）" 的 superseded 声明改成现况或 void（实已接线，证据 `src/application/patrol/ledger_staleness.ts:247`） | S | P2 | S1 判 superseded，册在说旧事实（非 still_true） | 改文案 vs 删 claims 哪个符合"只有现状"纪律？改完 D1 的 need/have 口径受影响吗 |
| 8 | patrol `stale.s2.stale[]` · `file_scripts_verify-changed_mjs` | 为 `scripts/verify-changed.mjs` 重跑并登记证据（指纹已变） | S | P2 | done 卡、证据旧 | 重跑后 standing 是否仍 satisfied；`--json` 的 `uncovered` 分母口径变了吗 |
| 9 | patrol S2 · `file_src_application_design_dsl_ops_file_ops_ts` | 为 `file_ops.ts` 重跑证据 | S | P2 | done 卡、指纹变 | 该文件节点后态判据是否仍覆盖现状 |
| 10 | patrol S2 · `file_src_application_design_dsl_ops_op_data_spec_ts` | 为 `op_data_spec.ts` 重跑证据 | S | P2 | done 卡、指纹变（2026-10-24 的老证据） | data 键闸的已知键清单是否已随新 op 增长 |
| 11 | patrol S2 · `file_src_application_design_dsl_ops_task_ops_ts` | 为 `task_ops.ts`+`task_machine.ts` 重跑证据（卡已 void，可只清不补） | S | P3 | void 卡 + stale 证据 | 作废卡留 stale 证据是噪音还是无害？该清还是该留痕 |
| 12 | patrol S2 · `file_src_application_design_dsl_ops_update_feature_ts` | 为 `update_feature.ts` 重跑证据 | S | P2 | done 卡、指纹变 | L1–L4 闸与 `call-exists` 连线是否仍成立 |
| 13 | patrol S2 · `file_src_application_design_intent_expectations_ts` | 为 `expectations.ts` 重跑证据 | S | P2 | done 卡、指纹变 | `EXPECTATION_KINDS` 权威注入是否仍生效 |
| 14 | patrol S2 · `file_src_application_meta_explore_query_feature_ts` | 为 `query_feature.ts` 重跑证据 | S | P2 | done 卡、指纹变 | `query` 分支与已退役枚举是否对齐 |
| 15 | patrol S2 · `file_src_application_meta_registry_capability_map_ts` | 核对该卡的覆盖集：卡名 `capability_map.ts`，实际 `covers` 却是 `scan_authorities.ts` —— 重跑前先确认是不是挂错卡 | S | P2 | done 卡、指纹变 + **卡名/覆盖集不符** | 这是证据陈旧还是一开始就挂错主体？改 covers 会不会暴露第二处权威 |
| 16 | patrol S2 · `file_src_application_plumbing_ts` | 为 `plumbing.ts`+`rejection_kind.ts`+`server_registry.ts` 三文件重跑证据 | M | P2 | done 卡、3 文件指纹全变 | 三文件里 `rejection_kind.ts` 正是无卡写 1 条的主角，两处债是否一起收 |
| 17 | patrol S2 · `file_src_application_refactor_diff_views_diff_views_ts` | 为 `diff_views.ts`+`diff_scope.ts` 重跑证据；**与 #28 的 D1 同一根**，应合批处置 | S | P1 | done 卡、指纹变；`diff_scope.ts` 同时是 D1 唯一缺路径 | 补 `task-system-plan` 节点后这张卡的 covers 是否自动闭合 |
| 18 | patrol S2 · `file_src_domain_validator_ts` | 为 `validator.ts` 重跑证据 | S | P2 | done 卡、指纹变 | 判据四态口径是否仍一致 |
| 19 | patrol S2 · `file_src_infrastructure_analysis_deadcode_detect_dead_imports_ts` | 为 `detect_dead_imports.ts` 重跑证据 | S | P2 | done 卡、指纹变 | `@authority-via` 只在注释那条 `includeComments` 用例是否仍绿 |
| 20 | patrol S2 · `file_src_infrastructure_index_index_freshness_ts` | 为 `index_freshness.ts` 重跑证据 | S | P2 | done 卡、指纹变 | 保鲜窗口口径与 D1 的 `freshnessVerdict` 是否同源 |
| 21 | patrol S2 · `file_src_infrastructure_index_symbols_ts` | 为 `symbols.ts` 重跑证据 | S | P2 | done 卡、指纹变 | 符号导出投影是否与 `signature-matches` 一致 |
| 22 | patrol S2 · `file_src_presentation_mcp_server_ts` | 为 `server.ts` 重跑证据 | S | P2 | done 卡、指纹变 | MCP instructions 里死工具（`scaffold`/`harvest_*`）那条 R53 是否已修 |
| 23 | patrol S2 · `file_src_presentation_mcp_server_registry_ts` | 为 `server_registry.ts` 重跑证据（卡已 void，可只清） | S | P3 | void 卡 + stale 证据 | 同 #11：作废卡的证据处置口径 |
| 24 | patrol S2 · `file_src_application_design_line_design_line_ts` | 为 `design_line.ts` 重跑证据 | S | P2 | done 卡、指纹变（2026-10-24 老证据） | `action=judge` / `action=diff` 的回执字段是否仍与证据一致 |
| 25 | patrol S2 · `file_src_domain_task_gate_basis_ts` | 为 `task_gate_basis.ts` 重跑证据 | S | P2 | done 卡、指纹变 | `countsAsNoCardWrite` 口径变了没有（直接决定 #5 的分子） |
| 26 | patrol S2 · `file_scripts_slot-stats_mjs` | 为 `scripts/slot-stats.mjs` 重跑证据 | S | P2 | done 卡、指纹变 | 量具改了会不会影响门读数（它刻意不进门） |
| 27 | patrol `drift.missed_close` / `stale.s3.missed_close[0]` · `file_src_application_write_gate_ts` | 用 `edit_dsl {type:'task',op:'complete'}` 给这张卡销账（状态机判可收口，卡却自 2026-11-06 停在 claimed，`lease_ttl` 已过期） | S | P1 | 可收口未收 —— 状态机最后一格空着 | `complete` 会不会撞 `T-#NODE-IN-TWO-BOOKS-UNCLEANABLE`（跨册同名节点锁死）？先核 `write_gate` 节点是否两册都有 |
| 28 | patrol `stale.s3.no_card_write[0..6]`（7 条） | **非新增欠账**（已在 #5 挂账）：`rejection_kind.ts`(t36) 1 条 + `judge_facts.ts`(t18) 5 条 + `strip_comment_sites.ts`(r6-strip) 1 条 | S | P3 | 6 acknowledged + 1 rows = 7，全在 baseline 内；门读数不打折 | 6 张处置卡是否真"闭合"？`strip_comment_sites` 那条永久占 `max_no_card=1` 是否可接受 |
| 29 | scripts/design-check.mjs · task_plan `criteria[D1]`（expect_file D1:15） | 消除 D1 唯一缺路径：给 `task-system-plan` 册补 `file_src_domain_diff_scope_ts` 节点，或把 4 条 `behavior-cases` 的 `path` 改挂已入册节点 | S | P1 | **现算：need 44 / have 426 / missing 1** = `src/domain/diff_scope.ts`（4 条期望全挂在 `diff_views` 节点；磁盘存在 9479B，`agent-io` 册已入册，`task-system-plan` 册缺） | 补节点（会与 agent-io 册同名 ⇒ #27 的跨册锁死风险）vs 改 path（改判据主体算不算偷改尺）——按"一维一处"选哪个 |
| 30 | scripts/design-check.mjs · criteria[D7]/[D9]（expect_file D7:1 / D9:1） | 让 `mutateReport` 读数稳定（`mutate` 随机抽样 ⇒ `survived=0 ∧ unsupported=0 ∧ killed>0` 偶发不满足，D7/D9 红） | M | P2 | 两判据只依赖 mutateReport；同册 D1 是稳定红，这两条是**偶发** | 固定抽样种子/样本下限，还是改判据阈值？不许把门改成恒绿（GUIDE-GATE 4.6 / 0.16） |
| 31 | scripts/test-baseline.json:3-5 + docs/ENVIRONMENT.md:121 | 把 ENVIRONMENT.md:121 的 "130 文件 / 768 用例" 更新为 test-baseline 的 **135 / 793**（`capturedAt:2026-11-17`），与磁盘 135 个 `*.test.ts` 一致 | S | P3 | **棘轮本身新鲜、与磁盘吻合**（本轮只读核了文件数），债在文档快照过期 | 793 用例数本轮未现算（只核文件数），更新文档时是否要同步核一次 TAP 汇总 |
| 32 | scripts/judge-baseline.json:3,94 · docs/RETIRED.md:102 | 对账"存在类判据整类退役"：基线 `total=816` 与三册现算 **816 逐 kind 相等**，但 `file-exists` 31 + `symbol-exists` 34 = **65 条仍在册** | M | P2 | 基线闭合（不是债）；RETIRED.md:102 声称 574 条已清 —— 说的是"留 kind 清数据"，实际数据没退干净 | 这 65 条是退役后新增还是从未清？清掉要同步更新 judge-baseline（只许降需走写基线流程），会不会触发"判据数不许掉"红 |
| 33 | docs/VISION.md:12-13,18,20,26 | 扫尾 VISION ❌ 行：三层载体 / 结构级对拍（`npm run diff` 指向缺失脚本）/ 决策卡自足 / 决策卡作用域 / todo 巡检（patrol 只判节点卡）——与另一席 todo.md / PROJECT-DESIGN 重叠，本席只报源不裁决 | M | P2 | VISION 自标 ❌ 未成立 | 哪些已被另一席活卡覆盖？避免重复立卡；`npm run diff` 缺脚本是否仍存在 |
| 34 | docs/VISION.md:36-37 · docs/RETIRED.md:60 (T-#GATE-IMPACT) | 影响面闭包：接 `explore_code action=impact`，或给 `design-db` 补 `calls` 反向闭包 | M | P2 | 未接；RETIRED.md:60 明写"写闸自动附带波及仍未做 ⇒ 单独立项 T-#GATE-IMPACT" | 写闸自动附带波及是否仍是当前需求？`calls` 反向闭包按 GUIDE-GATE:212 属"不可判定"，该选精确读集比对吗 |

## 新大陆（本轮 6 个非显然结论）

1. **D1 只有 1 条缺路径，不是一批**：`src/domain/diff_scope.ts`；4 条 `behavior-cases` 全挂在 `diff_views` 节点上，文件在磁盘、在 `agent-io` 册，只缺 `task-system-plan` 册 —— 补节点会撞台账里 `T-#NODE-IN-TWO-BOOKS-UNCLEANABLE` 的跨册锁死；改 `path` 又可能被判"偷改尺"。这是 P1 但要裁定先于动手。
2. **无卡写账"要销账"任务为 0**：7 条读数一条不漏地挂在 baseline（6 acknowledged + 1 rows），`max_no_card=1` 已被 `strip_comment_sites.ts` 那笔真实流程违例占满 ⇒ 门是"新写即红"的活牙，不是欠账清单。真正待论证的是 6 张处置卡是否闭合。
3. **审计脚本顺手炸出 20 条 `project_registry` 不可达登记**：`write-log-audit` 与 `patrol` 每次启动都刷同一句 20 个 feature 名，登记"只报不删"——这是本轮唯一"每次写都在付"的 operational 摩擦，按 Tracy 应排 P1。
4. **judge-baseline 816 对账完全一致，但退役记录与数据分叉**：RETIRED.md:102 说 `file-exists`/`symbol-exists` 574 条整类退役，现算仍有 65 条（31+34），且 kind 还在 `EXPECTATION_KINDS` —— 属"留 kind 清数据"没做完，不是基线失真。
5. **test-baseline 不滞后**：`135/793`、`capturedAt:2026-11-17`、磁盘 135 个测试文件三者吻合；滞后的是 `ENVIRONMENT.md:121` 的旧快照 `130/768`。这与 `docs/todo.md` 的 `T-#TEST-BASELINE-LAG` 记录的状态不同，需同步给另一席。
6. **patrol 第一次产出 23 条行动项**：S1 三条同源（patrolDrift 已接线），S2 十九条 stale 证据（其中 `capability_map` 卡的 `covers` 指向 `scan_authorities.ts`，卡名与覆盖集不符；2 张 void 卡的 stale 证据可只清），S3 一条 `missed_close` + 七条已挂账无卡写。另 S2 有 6 条 `unverifiable`（当年没记 covers，复算不了），本台账未逐条列（不在 stale 段，属独立盲区）。

## 交叉引用

- 另一席负责：`docs/todo.md` 台账、三册活卡、`PROJECT-DESIGN`；本台账 #33 与其重叠处只报源不裁决。
- 只读复核命令（可复现）：`node scripts/write-log-audit.mjs --json` · `node scripts/patrol.mjs --json` · `node scripts/design-check.mjs --json`；D1 对账脚本逻辑 = D1 expect 原文（need=所有 `e.path`，have=`n.path ∪ semantic.files[].path`）。
