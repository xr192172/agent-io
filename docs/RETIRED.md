# RETIRED.md — 删除台账（活文档）

> **为什么单独一份**：删干净的东西**不会自己复发**，但会被人**重新发明**。
> 台账回答"这做过吗、为什么砍的、当时凭什么判断"——比"它现在不在"有信息量。
>
> **与证的分工（别混）**
> · **证**（如 `t424`）防**意外复活**：旧分支 merge 回来、`git revert`、残留 import、批量恢复。
> · **台账**（本文件）防**重新发明**：想做同一能力时，先读到这里。
>
> ## ★ 退役有四种性质，别一视同仁（2026-10-28 用户提醒）
> 「有些退役只是做得不够好或者重复发明了，可能以后还会加回来，真实开发中也是。」
>
> | 性质 | 含义 | 该不该回来 |
> |---|---|---|
> | **① 被取代** | 有更上游的载体表达了同一件事（设计侧 / 判据 / 另一个工具） | **不该**——回来就是第二处权威 |
> | **② 做得不够好** | 需求真实存在，但当时那版实现错了/越权/难用 | **可能回炉**——砍的是实现，不是需求 |
> | **③ 重复发明** | 同一生态位出现了第二个，合并掉了 | **不该**——除非合并本身失败了 |
> | **④ 死代码** | 产者/消费者都没了，链已断 | 视情况——若需求重现，按"新需求"重做 |
>
> ⇒ 每条都要写清**性质**；性质是 ②/④ 的，再写**回炉条件 + 重做时的设计约束**。
>
> **纪律**
> 1. 退役任何能力 ⇒ 记一条，写**判据**（凭什么判定"可以删"），不写"觉得没用了"；
> 2. 写**替代路径**（现在该用什么）——否则下一个人只会再造一遍；
> 3. 有代价就写**丢了什么**；
> 4. 性质 ②/④ 的，写**回炉条件**（什么情况下值得重做）+ **设计约束**（重做时别重犯哪个错）。

---

## 台账

| 日期 | 退役对象 | 性质 | 判据（凭什么删） | 现在用什么 | 代价 |
|---|---|---|---|---|---|
| 2026-10-30 | 翻译册 `symbols[].to`（**单串投影**，如 `"src/user.ts#Add"`） | **① 被取代** | `book.ts` 头注释（L85）实测：一个字符串塞了三件事（目标文件 / 命名规则 `Type_Method` / 符号名），任何一件要改都得拆字符串 ⇒ 换成结构化 `symbols[].targets.ts = {file, name}`（`book.ts#generateBook` L998 用 `tsPath` + `tsSymbolName` 现算，与 fill 管线同一把尺）。`tests/translate_book_go_ts.test.ts` 里 3 条 `to === 'src/user.ts#Add'` 断言测的正是这个退役字段（实测该字段恒 `undefined`） | `symbols[].targets.ts.file` / `.name`；prompt 侧 `attachBookFacts` 的行格式由 `${from} → ${to}` 改成 `${from} → ${tsTargetName(hit)} · ${state}`（不再带目标文件路径） | 外部读取方不能再靠一个字符串同时拿到文件名与符号名，要文件得读 `targets.ts.file`。★ `types[].to`（术语表"真没有对应"）语义不变，不动 |
| 2026-10-30 | 翻译册「**外部硬依赖 ⇒ blocked**」（`blockedByExternalDep` 那一档） | **① 被取代** | 2026-10-29 `bdec9da9`（「名词层一次性填完 —— blocked 90 → 0」）定下的口径：名词层已决定"用什么替身"，剩下是结构层的事 ⇒ 外部依赖不再单独 block，降为 pending（`book.ts` L1091 注释原文）。实测同一夹具：`pending 4→5 / blocked 2→1 / blockedByExternalDep 1→0`，`Raw` 由 blocked 变 pending 且不再挂 `/外部硬依赖/` note | 外部依赖进 `external_deps` 区块（`buildExternalDeps`：`from` / `strategy` / `usedBy`），由模型按 `strategy` 定替身 | `blocked` 只剩 `term_null` / `collision` 两类；「这个包没有 TS 等价物」不再自动挡翻译 —— 判据从"先解决依赖"改成"依赖是策略问题，不是能不能翻的问题" |
| 2026-10-30 | 判据 `update_feature_ts#0` 的 `source-has must:["live_only","两层闸"]`（注释不变量判据） | **① 被取代** | 原判据锚在**注释散文**上（`src/application/design/dsl_ops/update_feature.ts` L873-874 两行注释）。`source-has` 自 2026-10-30 起**匹配前剥注释**（`src/domain/text_strip.ts#stripComments`）⇒ 这条恒红。而「两层闸确实存在」在代码里有真身：`src/infrastructure/graph/import_project.ts#importProject` 调 `importProject.isScannedNodeId`（L1073 定义 / L1237 调用）+ `allow_design_drop` / `lostIntent`（L1294 / L1298） | `call-exists`（importProject → `carryOverNodeGates`，L1331；★ target 必须是**顶层**符号 —— gen-db 的 `requirements_calls` 只认 `parent IS NULL`，写局部箭头函数会解析不到家、投影恒空）+ `source-has must:["allow_design_drop","lostIntent"]`（L1294/L1298 钉住意图级那层），两条都挂 `file_src_application_design_dsl_ops_update_feature_ts` | 少了「注释必须指向现状」这条**文档不变量**的自动检查。★ 教训：**要断言「注释里某句不变量存在」= 判错了对象** —— 剥注释后它没有主体、必然恒红；要么锚代码（`call-exists`），要么改代码 |
| 2026-10-28 | `code_workbench.ts`（代码变更提案 + `pending-changes`）· `llm_decider.ts` | **② 做得不够好 + ④ 死代码** | 做了"提案队列 + 等人审批"，而**这条链从没有审阅人**（`approveChange` 零调用方、页签退役、HTTP 无路由），产者 `canvas_notes` 也已删 ⇒ 双重死。`deprecate_offline` dry-run 判为下线候选 | 直接改：`edit_code` / `rename_files`（写闸 + 快照 + 可回滚）。"判据过就写"的范式见 `opl`（`oplIntegrate`：`status=checked` + 契约不自源守卫 ⇒ 直接写册，**无人审批**） | 少了"**先出预览、后落盘**"的两步式代码变更（`proposeChange` 的 dry-run 预览随之消失） |
| 2026-10-23 | `canvas_notes` 工具（read/mark/decide）· 批注层 / 审批层（`APPROVAL_STATUSES` + approval ops） | **① 被取代** | 用户裁定：**前端只是显示屏、人不直接插手** ⇒ 批注与"基于批注的审批"整体退场 | 设计意图 `design_intent action=set`；提案 `observe action=proposals` | 少了"人点一下批注"的交互面。★ 教训：**交互层退场会把它上面的审批流一起变成死链** —— 当时没顺手清，`code_workbench` 多活 5 天 |
| 2026-10-22 | `design_intent action=propose`（分支） | **② 做得不够好** | PR 式退役，改走 publish 立卡 | `action=set` 直接写 overlay；要"先请人批再落"走 `opl` / `observe action=proposals` | ★ **代价惨重**：删分支但**没删 enum 与描述** ⇒ `propose` 被**当成 `set` 直接写盘**（越权），而描述写着"永不直接落盘"。5 天后由 `t423` 抓出。教训：**退役要连 enum / 描述 / AGENTS 触发行一起改** |
| 2026-10-28 | `observe_log` / `observe_trace` / `observe_judge` / `observe_instrument` / `observe_proposals` 五个独立工具 | **③ 重复发明 → 合并** | 同一生态位收敛成单入口 + `action`；合并前先立**等价性基线证** | `observe`（`action=log/trace/judge/instrument/uninstrument/restore/ledger/proposals`） | 单入口必须自己守住"参数传错要响亮"（`t408` 6/0），否则 5 个明确报错会变成 1 个含糊报错 |
| 2026-10-28 | `plan_refactor`（合并进 `apply_refactor_plan`） | **③ 重复发明 → 合并** | 两者是**同一操作对象的两个半**：同一份清单、同一个 `plan_id`、同一套定位实现（`edit_code replace_text` 的 4 级模糊级联）⇒ 拆两个只多一次往返 + 多一处描述漂移 | `apply_refactor_plan` 单入口两形态：给 `targets` ⇒ 算清单（只读）；给回执的 `plan` ⇒ 落盘（幂等）。证 `t425` **13/0**（含逐字段等价基线） | 代价：调用方要记住"同一个工具两种形态"；★ 合并前**先录基线**（`certs/baselines/refactor-plan-baseline.json`）再删旧工具 —— 这条流程后面所有合并照抄 |
| 2026-10-28 | `render_design`（并入 `get_dsl`） | **③ 重复发明 → 合并** | 与 `get_dsl` 同为**设计侧只读查询**，差别只是产出形态（JSON vs 图/文档） | `get_dsl query=render` + `format=mindmap\|svg\|markdown`。证 `t426` 15/0（三种格式回执逐字 + 产物 sha 相同） | 代价：`get_dsl` 的 schema 多了两个参数 |
| 2026-10-28 | `feature_line`（并入 `observe action=line`） | **③ 重复发明 → 合并** | 功能主链是**观测侧读数**，与 `trace` 同族 ⇒ 该进观测单入口 | `observe action=line`（`target` / `max_steps`）。证 `t426` 15/0（data 逐字段相同） | ★ 教训：本工具 handler **不走 wrap**（各分支自产 `text`）⇒ 新分支必须自己拼 `---DATA---`，否则输出会被当"没有 text"丢掉（实测空白） |
| 2026-10-28 | `consistency_check`（能力**搬进** `design_line action=judge`） | **① 被覆盖 + ② 宿主搬错** | 它干两件事：① `expected_apis vs 代码` 报表 —— **已被判据覆盖**（`symbol-exists`/`signature-matches`/`edge-*`/`call-*`）；② 决策卡 `expectations` **整批判定** —— 是唯一入口，删了会真丢能力 | ② 搬进 `design_line action=judge`（设计链第 ⑤ 步）；① 交给判据。证 `t427` 9/0。★ **执行核 `checkConsistencyReport` 保留** —— `detect_drift` 与 HTTP `serve.ts` 仍在用 | 代价：`data` 形状变了（不再复刻对账报表）；★ 教训：**"某个工具已被覆盖"不等于"它的每件事都有人做"** —— 得逐个能力核对，否则删掉的正是唯一入口 |
| 2026-10-28 | `detect_drift`（并入 `design_line action=drift`） | **③ 重复发明 → 合并** | 与 `consistency_check` **同一执行核**（`consistency.ts:154` 自述"共用同一套对账三态术语"）；独有增量只有两层：**四态含 `no_comparison`** + **漂移台账** | `design_line action=drift`（`drift_mode=status` 复读台账）。证 `t428` 11/0（台账按 `getStorageRoot()/drift/` 定位并核字段）。执行核 `detectDrift` 与台账**都不动** | ★ 证里两次自伤都值得记：① 覆盖 `AGENT_IO_HOME` ⇒ DSL 找不到（`feature 不存在`）；② 复原逻辑**误删别的证留下的台账**（`run82`/`t178probe`/`hb_probe`）⇒ 改成"只登记本次 feature 的那一个、且原本不存在才删" |
| 2026-10-28 | `tool_usage`（迁出为 `npm run dogfood:coverage` 脚本） | **④ 宿主搬错**（能力真实、工具面不是它的家） | 它答的是「**烟测跑过哪些工具**」= 开发期审计读数，模型写代码时不会在会话里调它 ⇒ 不该占 MCP 工具位 | `npm run dogfood:coverage`（`scripts/dogfood-coverage.mjs`）；执行核 `dogfood_coverage.ts` 一行不改。证 `t429` 10/0 | ★ **更正我先前的过头话**：我说过"它连谁在用都答不准"——**不对**，`snapshotDogfoodStats` 默认排除 `via=sweep\|gate`，口径是成立的；真实问题只是"读数归属错了地方" |
| 2026-10-28 | `impact_analysis`（并入 `explore_code action=impact`） | **③ 重复发明 → 合并** | `explore_code` 原本就有 `diff_impact`，2026-10-21 因"146–179 次调用只有 0–3 次成功"被移走、影响面另立工具 ⇒ **同一件事分两处**。"我要改这里会炸哪里"本就是**代码理解** | `explore_code action=impact`（`hubs=true` 切热区盘点）；执行核 `analyzeHubs` / `analyzeImpact` 未改一行。证 `t430` 12/0（冻结夹具 + 手算闭包 {b:1,c:1,d:2}） | 代价：写闸**自动**附带波及**仍未做** ⇒ 单独立项 `T-#GATE-IMPACT`；★ 教训：**项目级读数不能当等价基准**——两次运行之间仓里多了一个文件就让第一版证假红（632→633 文件） |
| 2026-10-28 | `suggest_renames` + `find_similar_names`（并入 `rename_symbols analyze=`） | **③ 重复发明 → 合并** | 旧 `rename_symbols` 描述里自己写着"**suggest_renames / find_similar_names 是它的上游只读分析层**" ⇒ 同一件事分了三处 | `rename_symbols analyze=suggest\|similar`（只读，产出 items 可直接喂 scope=local）。证 `t431` 14/0（含只读性 sha 不变） | 代价：改名工具的 schema 多了 analyze 一族参数 |
| 2026-10-28 | `read_project_docs`（并入 `explore_code action=docs`） | **③ 重复发明 → 合并** | 与 `read`（读源码）/ `facts`（读索引事实）同属「读」这条线 | `explore_code action=docs`（清单 / 单篇 / targets 命中）。证 `t431` 14/0 | 代价：`explore_code` 的动作面又宽了一格（但同一入口按动作分派是既定形态） |
| 2026-10-28 | `translate_book`（并入 `translate_go_ts book=true`） | **③ 重复发明 → 合并**（且是**全仓唯一**"被宣传但没人用"的工具） | 三口径测量（`scripts/audit-tool-reach.mjs`）：真调用 **0**（17 次全是 `via=sweep\|gate`）· 代码引用 **0** · 文档提及 1。它本身是 `translate_go_ts` 的**第一步**（没册子就没有骨架/填孔/对拍；两者操作同一个 `.translate.json`） | `translate_go_ts book=true`（沿用该工具的 flag 风格，不另造 action）。证 `t432` 8/0（含"缺册时响亮报错、不返回空账"） | ★ 教训：**"零真调用"要三个口径一起看才敢下判断** —— 只看日志会误杀"还没到用的时候"的工具（`translate_go_ts` / `cross_repo_symbol_index` 同样零真调用，但有内部耦合 ⇒ 保留 + 补证） |
| 2026-10-28 | 工具名 `translate_go_ts` → **`translate`**（语言对变参数） | **② 做得不够好**（命名把**数据**写死） | 本仓翻译架构本来就是「映射表 + 通用翻译器」：`pairs.ts` 注释原话「全语言泛化的壳：新 (src,dst) 映射**只在这里挂一张表**，核心零改动」。而工具名把语言对写死 ⇒ 加一对就得加一个工具名，等于把注册表降级成"工具名枚举"；且 `book`（重算翻译册）**语言无关**，却被塞进这个 pair 专属名字底下 | `translate`（`from`/`to` 走 `TRANSLATE_PAIRS` 查表；不支持的对**响亮报错并列出已注册对**）。证 `t433` 14/0 | 代价：契约改名（README / AGENTS / capability_map 同步）；★ 教训：**语言对是数据，不是工具名** —— 名字里写死维度，就等于把这个维度封死 |
| （更早） | `harvest` 整条线（3 工具）· `narrate_step` · `review_changes` · `behavior_baseline` | ①/③ 混合 | 设计侧已取代（判据 / DSL 能表达同一件事）；`review_changes` 因审批层退场而无审阅人 | 判据生态（`behavior-cases` 等）· `observe action=proposals` | 教训：**被取代的工具拆注册不拆执行核** —— 行为场景改用判据表达，别把执行核也扔了 |
| 2026-10-30 | **5 个零 import 死文件**：`src/application/design/dsl_ops/feature_ops.ts`（`createFeature`/`cloneFeature`）· `src/infrastructure/analysis/structure/feature_map.ts`（`buildFeatureMap`）· `src/infrastructure/render/inject_replay.ts`（`injectReplay`）· `src/infrastructure/authoring/translate/go_body_codegen.ts`（`renderGoBody`/`goExpr`）· `.../go_codegen.ts`（`renderGoType`/`goSignatureFromPivot`） | **④ 死代码**（其中两个是「双权威里死的那一份」） | 判据 = **模块级 import 计数归零**：`from '…<mod>'` / `import('…<mod>')` / `require('…<mod>')` 在 `src/ scripts/ certs/ tests/` **641 个文件里 0 命中**；全串命中只剩注释 / 字符串 / 自身 / 已删证的历史说明（逐条列过）。★ 上一轮卡住的原因是**工具口径缺口**：`deprecate_offline` 的候选来自 `detectDeadImports`（"imported 但未使用"），**看不见"整个模块无人 import"** ⇒ 本次按用户授权直接 `Remove-Item`，同步摘 `agent-io` 册里 3 个节点（`file_src_…_feature_ops_ts` / `…_feature_map_ts` / `…_inject_replay_ts`） | 设计册里的同类能力：feature 建档=`import_project`；结构分组=`structure_gap` + `code_health`；注入回放**无继任**（`explore_code` 的 5 个 derive_* 一并退役）；Go 渲染=`ts_codegen#renderTsType`（pivot→TS 单向，见 `t447`） | 失去 **Go 侧回译渲染器**（`t446`/`t449` 已随它退役）与"文件结构→功能地图"这一读数。★ **回炉条件**：出现真有生产消费者的 Go 渲染器 / 功能地图需求；**设计约束**：对手方必须是**活着且有生产消费者**的实现，别拿死代码当基准 |
| 2026-10-30 | **7 张证**：`t198-status` · `t197c-approvals-cert` · `t198sub-approval-cert` · `t197sub-flow-cert`（**批注/审批层**）· `t205-splitchain` · `t212-regex-vs-ast` · `t213-must-export`（**`split_stage` + `bricks/signal_review`**） | ① **被取代/对象没了** | 它们测的对象**全部已退役**：`src/domain/annotation.ts`（`APPROVAL_STATUSES`）与 `get_dsl query=approvals` / `approval.*` ops 随批注审批层于 2026-10-23 退场（`storage.ts:197` 逐字记着删除清单）；`split_stage` / `signal_review` / `bricks/` 于 2026-10-30 批 1 删除。实测这 7 张**全部 exit≠0 且失败项全是"工具/模块不存在"**，非产品缺陷 | 批注=无（人不直接插手，见 2026-10-23 条）；"混合文件拆分"= `refactor_pipeline`（`dead_imports` / `dead_statements`）+ `rules`；`t212`/`t213` 想守的"剥注释后判引用 / 摘走符号要补 export"现由 `refactor_pipeline` 的自执行逻辑承载 | 失去"审批状态词表防漂移"与"拆分后 TS6133/TS2459 两类编译格"的回归网。★ **回炉条件**：`t212`/`t213` 值得重写成挂 `refactor_pipeline` 的证（判定逻辑仍在 `ts_kernel`）；`t197c`/`t198*` 不回炉（对象已退场） |
| 2026-10-30 | 证里**写死计数的断言** 5 条：`t195`「门数 5→4」+「[报告] 区还在」· `t407`「工具数===55」· `t424`「工具面仍是 55」· `t429`「工具面 50→49」 | **④ 坏判据**（不是证坏了，是判据抄了一份会漂的东西） | 工具面 57→55→54→50→49→44 一路缩、verify 门 5→10 且报告档整体退场 ⇒ 这些断言**必红且不指向任何真缺陷**。它们的值是"当时那一刻的快照"，而真值由注册表 / `npm run verify` 现取（`capability_map`、MCP 工具签名门） | 删断言、保留同证其余仍有效的判据；`t326` 的「dist 不比 src 旧」改成读 `dist/.build-manifest.json`（唯一每轮都重写的产物）——原来拿单个 `.js` 的 mtime 判，`tsc --incremental` 不重写未变文件 ⇒ **假红** | 少掉"某天工具数恰好是多少"这一句。★ 教训：**证不许抄读数** —— 抄一次就得跟一辈子 |

---

| 2026-10-30 | `chain_wiring` 的两条 `consistency_check→edit_code` / `→archive` 边 | **① 被取代 + ④ 死数据** | 继任者 `design_line action=judge` 的产物是 `{feature,root,tally,items}`，**没有 `scope_files`** ⇒ 改指向等于谎报交接物（"改了哪些文件"）。差异面锚点本身随 `consistency_check` 退役 | 差异面改用 `git diff --name-only` 现取；`retire-flow` 的 ②→③ 交接从此**由人递路径** | 少一处自动交接，多一次人工传参 |
| 2026-10-30 | `certs/t189-sweep.mjs`（"69 个工具逐个真跑"的**扫掠量具**） | **④ 坏量具**（不产 PASS/FAIL，且**无法隔离**） | ① 它是量具不是证（runner 头注自称"不判红"，跳过不损失判断力）；② **隔离做不到**：`getDesignSheetFile(f)` = `projectRootOf(f) ?? getDataHome()`（`dist/src/infrastructure/storage.js:365-375`）⇒ 用**真 feature 名**跑全表时 `AGENT_IO_HOME` 挡不住写完真仓；③ 实测代价：2026-10-30 20:28 它把 `sync_contracts` 带 `feature:'run82'` + 真仓目录 ⇒ 写出 `.agent-io/design/run82.dsl.json`（**768 节点 / 667 文件**，`_sync.via='tool:sync_contracts'`）⇒ `design:gen-db` 一度报 `features=4 / files=1136`（应为 3 / 745） | `npm run dogfood:coverage`（"哪些工具被真用过"）+ `capability_map`（现核注册表，实测 **44 个**）+ 每个工具自己的证 | 失去"全部工具挨个冒烟一次"这一个读数。★ **回炉条件**：只有当"注册表 → 夹具"能真正隔离（feature 名不落进真仓项目根）时才值得重做；**设计约束**：不许用真 feature 名跑全表，必须在 temp 项目根下 |
| 2026-10-30 | `certs/t182-cert.mjs`（`import_project` 重建后 `deprecated` 标记仍在 —— `mergeDesignLayer` 那一层） | **④ 夹具死** | 它读根 `agent-io.json` + `.agent-io/features/run82.json`：前者既是**活态单文件视图**（2026-10-23 随 `getLiveDslFile()` 删除，`src/infrastructure/storage.ts:134` 逐字"已随…一并删除"）又被 `.gitignore:56` 挡在 git 外；后者所在目录 `.agent-io/features/` 在本 checkout **整个不存在** ⇒ 开跑即 `ENOENT`，**必然红** | `-`（该重建层的真实消费者是 `import_project` 本身，由 `design_line action=diff` / `drift` 现看） | 少了"重建不抹设计层标记"的回归网。★ **回炉条件**：先重建 run82 夹具（`.agent-io/features/` + `certs/t185-base/agent-io.json`）才可复证；**别留红证占位**（必然红的证不是资产，是负债） |
| 2026-10-30 | `certs/t182b-tombstone-cert.mjs`（"文件已不在 base 的待删标记必须留作墓碑、不许当僵尸清掉"） | **④ 夹具死** | 同 t182：`SNAP = [agent-io.json, .agent-io/features/run82.json, *.overlay.json]` 三样在本 checkout 全缺 ⇒ 文件头 `fs.readFileSync` 即崩（本次实测 `exit=1`） | `-` | 少了"墓碑 vs 僵尸"这条判据的回归网。★ **回炉条件**：见 t182 的夹具重建前提 |
| 2026-10-30 | `certs/t183-cert.mjs`（`'archived'` 是**不可达**状态 ⇒ 已从类型里删掉；运行期写它必须红且**指路 `archive`**） | **④ 夹具死**（★ 能力**仍在**，只是证依赖 run82） | 它的 ① 静态取证 / ② 类型层(`TS2367`) / ③ 运行期拦 都用 `FEATURE='run82'` + `agent-io.json`；而 `assertLifecycle`（`src/domain/semantic.ts`）与 `archive` 工具都还活着 ⇒ 死的是**夹具**不是能力 | 能力现由 `assertLifecycle` + `archive`（`action=node/list`）承载，`node dist/src/presentation/cli/cli.js archive --schema` 现核 | 少了"`archived` 不可达 + `archive_id` 已删"这两条回归网。★ **回炉条件很便宜**：改用**临时 feature**（`mkdtemp` + `saveDSL`，像 `t330`/`t349` 那种自摆夹具）即可复证，**不需要** run82 |
| 2026-10-30 | `certs/t184-cert.mjs`（三步流②：对拍"设计说该删、实现删完了没" ⇒ `retire_pending` / `retire_ready`） | **④ 夹具死** | 头一行 `const SNAPSHOT = [LIVE='agent-io.json', FEATFILE='.agent-io/features/run82.json', OVERLAY].map(p => fs.readFileSync(p))` ⇒ 三样在本 checkout 全缺，开跑即崩（本次实测 `exit=1`）；它判的执行核 `checkConsistencyReport` **仍在** | 执行核仍活（`detect_drift` / `design_line action=drift` 同源）；读数改看 `design_line action=drift` | 少了"② 完成度"的两个计数回归网。★ **回炉条件**：见 t182 夹具重建；**设计约束**：新证别再读根 `agent-io.json`（那个视图已不存在） |
| 2026-10-30 | `certs/t184b-cert.mjs`（**重建后仍看得见 overlay 墓碑**，且 `exists` 现取磁盘） | **④ 夹具死** | 它调 `checkConsistencyReport`（**执行核还活着**）但夹具走 `.agent-io/features/run82.json`；其第 ④ 段还调已删的 `consistency_check` 工具（本次已先按"能力已退役"删段，随后整张证仍因夹具缺而崩 `exit=1`） | 执行核仍在（`consistency.ts#checkConsistencyReport`）；墓碑可见性由 `design_line action=drift` 的台账现看 | 少了"重建后墓碑仍报 + 来源如实标注"这条最有价值的回归网。★ **回炉条件**：夹具重建后**值得重写**（它测的是真缺陷盲区）；**设计约束**：第 ④ 段不要复活（`scope_files` 交接已退役，见本表 2026-10-30 `chain_wiring` 条） |
| 2026-10-30 | `certs/t185-cert.mjs`（**移除文件节点**的"三清"判据收成一处 + `archive` 收口意图层） | **④ 夹具死** | 它建在 run82 的 400 文件夹具上（`t185-reset` 整份还原）；本 checkout 无夹具 ⇒ 崩。它判的 `deleteFile` / `removeFileFromDsl` / `archive` **都还活着** | 能力仍在：`archive action=node/list`；`node dist/src/presentation/cli/cli.js archive --schema` 现核 | 少了"删 A 之后 B 的语义/几何都在（定向删 ≠ 清空）"这条回归网。★ **回炉条件**：用临时 feature 重写即可（同 t183），**不必** run82 |
| 2026-10-30 | `certs/t185-reset.mjs`（**整份还原** run82 夹具：活态 · 存档 · overlay · 归档库） | **④ 夹具死** | 它的 `TARGETS[0]` 是 `agent-io.json → certs/t185-base/agent-io.json`，而**活态单文件视图本身已删**（2026-10-23）；基线副本又被 `.gitignore:56` 挡在 git 外 ⇒ 任何 checkout 里都缺 ⇒ 一跑 `exit=1`。它的存在只服务于 run82 家族证，那些证已同批删除 | `-`（`run-all-certs.mjs` 的"跑前还原"与 `scripts/verify-changed.mjs` 的同名调用已一并摘掉；每张证自己负责还原） | 少了"一个已知 good 状态的整份还原点"。★ **回炉条件**：只有 run82 夹具被整体重建时才需要它；**设计约束**：复位脚本只能还原**存在的东西**（别再把已删的活态视图写进 `TARGETS`） |
| 2026-10-30 | `certs/t186-cert.mjs`（**PR 的确认人是下一个接手的 Agent**：`submitter` 落盘 / 不许自批 / 开会累积 / approve 落盘 / reject 不落盘 / 判不了要说出来） | **④ 死代码 + ② 做得不够好** | 它调的三个东西**全退役**：`code_workbench.ts`（2026-10-28 删）· `design_intent action=propose`（2026-10-22 删，现调它响亮报错零副作用）· `review_changes`（2026-10-28 删）；且它依赖 run82 夹具与本 checkout 缺的 `agent-io.json` ⇒ 开跑即崩 | `observe action=proposals`（`op=list/show/approve/reject`）—— 四层门与"不许自批只能部分判、判不了要明说"由 `certs/t186b-cert.mjs` 覆盖（本次已改指向继任工具） | 少了"工作台审批层"那套语义的回归网 —— 它随能力一起退役（审批层整体退场，无人审阅）。★ **回炉条件**：不提 |
| 2026-10-30 | `certs/t187-probe.mjs`（退役流 **②→③ 接得上**：`consistency_check` → `archive`） | **④ 死代码** | ① 它调 `consistency_check`，该工具已并入 `design_line action=judge`，而继任者产物 `{feature,root,tally,items}` **没有 `scope_files`** ⇒ 改指向就是谎报交接物（本表 2026-10-30 `chain_wiring` 条同一判据）；② 它的起点/收尾都靠已删的 `t185-reset` | `archive action=node/list` 仍活；差异面改用 `git diff --name-only` 现取，②→③ 交接**由人递路径** | 少了"②→③ 端到端"的证；该交接本身已判退役，所以丢的是**退役物的证** |
| 2026-10-30 | `certs/t200-goals.mjs`（9 条目标证据更新到"现在" + 计数不许写死） | **④ 夹具死** | 它整篇 `get_dsl feature='run82' query='goals'`，且第 ④ 段先跑 `t185-reset`（已删）再断言"仍 9 条" ⇒ 夹具缺 + 依赖已删脚本，**必然崩** | 目标读数改看本仓自己的 feature：`node dist/src/presentation/cli/cli.js get_dsl --json '{"feature":"agent-io","query":"goals"}'` | 少了"目标文案里不许写死计数（如 `61 个工具`）"这条机器检查。★ **回炉条件**：改成读**本仓 feature**（`agent-io`）而非 run82，即与 run82 解耦 |
| 2026-10-30 | `certs/t446-pivot-roundtrip-probe.mjs`（**类型穿过轴心无损**：Go → pivot → Go 回译文本必须出现在源侧签名里） | **④ 死代码**（对手方是死渲染器） | 它 `import { renderGoType, goSignatureFromPivot } from go_codegen.js` —— 该模块在 `src/` 内 **importers = 0**（唯一消费者就是本证）；且默认册 `D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json` 在本机不存在（本次实测 `ENOENT` ⇒ `exit=1`）。**无继任可改指**：现存渲染核 `ts_codegen#renderTsType` 是 pivot→TS，而 `book_ts#tsSignatureFromPivot` 内部就调它 ⇒ 拿它跟 `targets.ts.signature` 比是**恒真**（同一把尺算两边）= 装饰判据 | `certs/t444`（`tsSignatureFromPivot(pivot) === signature` **逐字相等** + 反向控制 ⇒ 类型不是第二处权威）+ `certs/t461`（extractor 签名 vs `go/types` 语义层对拍） | 少了"Go 侧回译"这一维读数。★ **回炉条件**：需要一个**独立且真有生产消费者**的 Go 渲染器；**设计约束**：别把"同一条渲染路算两边"当回译 |
| 2026-10-30 | `certs/t449-body-roundtrip-cert.mjs`（**函数体 IR → Go → IR 等构**，删前实测 **PASS=2 FAIL=0 · 236 条体等构**） | **④ 死代码**（★ 真绿的证，但对手方是死渲染器） | 它 `import { renderGoBody } from go_body_codegen.js` —— 该模块在 `src/` 内 **importers = 0**（唯一消费者就是本证）⇒ 实现一删它必红；**无继任**：TS 侧只有单向 `body_pivot#projectTsBody`，**没有 TS→IR 的 lift** ⇒ IR→TS→IR 回环不成立 | `certs/t447`（`liftGoBody → projectTsBody` 与 legacy **逐字等价** + 覆盖率 + 反向控制）+ `certs/t441`（`translateGoBodyMech` 与 Go **行为对拍**）覆盖"体层不丢信息"能覆盖的那一半 | 失去"IR→源语言→IR 等构"这条最强读数（236 条）。★ **回炉条件**：等 **TS→IR 的 lift** 出现，那时用 `liftTsBody` 当对手方；**设计约束**：对手方必须是**活着且有生产消费者**的渲染器 |

| 2026-10-30 | `manage_feature`（顶层 action=create/clone/template） | **③ 重复发明 → 合并** | 它是"建档 + 克隆 + 套模板"三件事挤在一个工具里，与 `import_project`（从实际 fork 出设计册）+ `edit_dsl op=add type=node`（建/改节点）职责重叠；2026-10-30 前已被 `c73a7c0c` 删除但**台账漏记**，且 9 处错误文案仍在教人"先 manage_feature action=create" | `import_project`（建档唯一入口）+ `edit_dsl`（节点/边/文件增删改） | 建档与建节点从"一个工具三个 action"变成"两个工具各管一段"，调用方要多想一步 |

## 回炉登记（性质 ②/④：需求还在，可能重做）

> 这一节的意义：**别把该回来的东西也埋了**。重做时按这里的"设计约束"走，才不会重犯同一个错。

### R1 · 代码变更的「先预览、后落盘」
- **需求是否还在**：在。模型批量改代码前，"先看一版 diff 再决定"是真需求（`edit_code` 的 `dry_run` 只覆盖单次编辑）。
- **回炉条件**：出现"要一次预览多个文件的连锁改动"的场景；或 `plan_refactor` 的清单需要"可保存、可复查"。
- **设计约束（重做时别重犯）**：
  1. **不要再造审批队列**——调用者是模型，模型不排队；队列必然成死信箱（本仓已证两次）；
  2. 做成 **`preview` 能力**挂在既有工具上（`edit_code` / `plan_refactor`），**不要新开 store**；
  3. 落盘前**过闸**（语法门 / 影响面 / 写闸 / 册写门），过则落 + 记 `applied_by/applied_at/gate`；
  4. 闸不过 ⇒ `blocked`（可修后重提），不是 `pending`（无限重试）也不是 `rejected`（挡住修正）。

### R2 · 设计意图的「先看 before/after 再落」
- **需求是否还在**：部分在。改 why / 方向本该"人拍板"，但**人拍板 ≠ 要有审批队列**——人可以直接说"就这么改"。
- **回炉条件**：确有"意图改动需要先复核 diff"的场景（例如 `design_intent` 与 `edit_dsl` 同时改多节点）。
- **设计约束**：只做 **`dry_run` 参数**（返回 before/after + 判据结论），**不要新增 action 语义**；
  否则又会重演"enum 里有、分支里没有"的歧义（`t423` 的病根）。

### R3 · 批注 / 审批交互层
- **需求是否还在**：否（当前裁定：前端只是显示屏）。
- **回炉条件**：产品范围重新包含"人直接插手标注"。
- **设计约束**：若回来，**先想清"谁是审批人"**——若答案是"没有人"，那就只做**标注**、不做**审批**。

---

## 待观察（还没删，但在排队）

| 对象 | 现状 | 需要什么才能下判断 |
|---|---|---|
| 无证工具（`T-#CERT-1`，约 23 个） | 无证 ⇒ **不清楚是否还有人用** | 先补证；无证的下一步就是无消费 ⇒ 可删 |
| `approve_gated.ts` 四层门 | **现行**（`observe action=proposals` 在用），但产者在 daemon 的 `runLoop`、工具面不可达 ⇒ 本仓 0 提案 | 跑 daemon 才有事可审；长期 0 提案就要问"这条链还需不需要存在" |
