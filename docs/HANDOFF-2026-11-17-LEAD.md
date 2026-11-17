# HANDOFF · lead 主控交接（2026-11-17，持续更新）

> **本文 = 新会话/新席/新机器的唯一交接源**。开场提示词只指到这里，不重复内容。
> ★ 本身是快照件（文件名带日期）但**持续更新**——每次阶段 push 前刷新「当前状态」段。

## 0. 开场提示词（新会话第一句粘贴这个）

```
你是 AgentIO 仓库的主控（lead）。先完整读一遍 docs/HANDOFF-2026-11-17-LEAD.md
（含常设纪律、模型路由协议、当前状态、执行队列），然后按其中的「执行队列」继续推进。
所有任务以 docs/todo.md 的 §H/§I 台账为唯一任务源；每完成一个稳定阶段 commit + push。
```

## 1. 环境与身份

- 仓：`D:\agentio\dev\agent-io`（软链 → `D:\Projects\ai\agentio\dev\agent-io`；**用软链形态**，注册表/册按此登记；⚠️ 有软链形态陷阱见 §5）
- 每条 pwsh 命令先加：`$env:PATH = 'D:\Program Files\nodejs;D:\Program Files\Git\cmd;' + $env:PATH`
- SSH push 已通：本机密钥 `~/.ssh/id_ed25519`（用户已加 GitHub；`auto_free` 旧钥已退役）；HTTPS CA 已切 schannel
- Windows 两坑：**JSON 一律写文件用 `[IO.File]::WriteAllText(path, text, UTF8Encoding($false))` + CLI `--input 文件`**（PS 吃引号，实测多次）；ps 嵌套引号构造 payload 改用 node 脚本文件（见 E4/L1 实例）
- 重启后恢复：`npm run env:check`（每条带修法）→ 在途子代理**持久化可续**（send_message 让它继续）

## 2. 常设纪律（全部经用户拍板，见 docs/todo.md §H/§I 对应行）

### 模型路由
- **三席制**：DS（`workbuddy/cn:deepseek-v4.1-flash`，付费最稳、沙箱预验证习惯）、混元（`workbuddy/cn:hy4flash-free`，敢反驳设计稿）、AGNES（`agnes/agnes-3.0-flash`，间歇熔断——**派单前先小探针测试**，挂了就双模）。MiMo 已由用户开通但**白名单只在会话创建瞬间生效**——新会话先 `list_subagent_models` 看 mimo 是否在；在 ⇒ 三席恢复；不在 ⇒ 双模。
- **派单语法**：`subagent` 工具 + `provider: "workbuddy"` + `model: "cn:deepseek-v4.1-flash"`（⚠️ model 不带 provider 前缀，拼重会被拒）。
- **子代理持久化**：DSH 重启后席不丢，`send_message` 让它继续即可，不用重派。
- **网检常设**：每席派单带独立检索渠道（DS=GitHub API+web_fetch / 混元=arXiv+Crossref / AGNES=Wikipedia+StackExchange，可轮换），报告必含「检索渠道与方法 + 来源清单」；渠道失效如实换源并注明。

### 交付框架（命名即框架）
- 席交付物 = **结构化重写提案**（不叫补丁）：design_line 计划形态——`entries`（anchor.symbol + kind + detail + judgement_ref）+ `untouched_default.why` + 每条 entry 的**红→绿验收判据** + **二阶三阶影响段**（必填）+ **最强反对者段**（必填）+ 待论证点。依据 T-#TEN-DISCIPLINES #3/#4/#6。
- lead 合并 = **entries 级合并**（锚点冲突检测、选优吸收次优）；落地一律走狗粮链（下条），**不许绕闸直写**。

### 自举狗粮链（T-#SELF-DOGFOOD）
- 改已有文件 = `edit_code`；新建文件/结构变更 = 设计链：§I 挂账 → edit_dsl 提案 → 领卡 → 施工 → 判据验收 → complete 销账。
- **闸的报错自带修法**（E-CLAIM-001/016/018、E-PLAN-021、E-TASK-008 全都教正确姿势）——被拦不是敌人，照修就行。
- 无设计节点的文件领不了卡（T-#NODELESS-FILE-CHAIN 已挂账）⇒ 只能 direct:true 直通车（受无卡写账门配额约束）——作为缺口记录而非默认路径。
- 完成卡：`complete` 的 evidence 用 `kind:'reading'`，command/observed 按 E-TASK-008 的要求格式（judge 类要含 `design_line action=judge` + 「N pass / M fail」读数原文）。

### 台账（两个真相存储 → 引擎化中）
- **真相**：① 设计册 `.agent-io/design/*.dsl.json`（节点/卡/判据/画布）② 台账引擎 tasks.db `ledger_rows/ledger_events`（L1 已落地，见 `src/application/ledger/ledger.ts`；append-only 触发器）。docs/todo.md 当前仍是手写真相，L2/L3 切换后降为派生视图。
- **PR 链**：台账行 = 一条 PR——挂账带「问题+解法」，后席对照后交「发现+解法+反驳」（追加不改写），lead 写 verdict，验收证据回填。**开工先查台账相关行；完工核销；没做完留册。**
- **三层矛盾检测**：存储约束（写入打回）→ subject 锚点关系层（L2：同 subject 不许两条 active）→ 事实/观点分轴（批注多声部合法，verdict 收敛）。
- **台词条目格式**（§H/§I 表格行）：`| **T-#ID** | 任务一句话 | 当前裁定 | 待论证点 |`——⚠️ 编辑 docs/todo.md 时**新增行用"在锚点行后插入"，不要 replace 锚点行**（lead 已三次犯"吞行"错）。

### 工具面（T-#FACE-STABILITY，已松绑版）
- 稳定优先、变化自由、有意识通道：面变化走 `mcp_scan --update` + 台账变更说明；新工具提案过论证（为什么不挂既有工具）；用户侧"重认面"由 capability_map 现扫 + `@authority` 陈旧标记承担。

### 十 prompts 纪律（T-#TEN-DISCIPLINES）
#1 第一性原理（闸报错自带修法）· #2 先问清再出三版 · #3 不默认用户的概念定义（更正到权威表述）· #4 二阶三阶影响必填 · #5 跨领域网检 · #6 最强反对者必填 · #7 Git 历史考古+包袱清点 · #8 定期新眼评审 · #9 慢 PR 分析（低优）· #10 复盘当天落账。

## 3. 当前状态快照（2026-11-17 15:00 · push 到 `5372d9cc`+）

- **HEAD 链**：`5ee226ab`（销账三层）→ `410bd8b1`（引擎 L1）→ `41b6029b`（B 批增量化：--jobs 2.04×/tsc 增量/cognition 复用）→ `5120bba0`（judge 基线 816）→ `86751739`（小件三连：S4/kind 口径/writes 旗标）→ `fc3a619c`/`5372d9cc`（A12/H1 收口）→ `36933357`/`50e52969`（十纪律+部署批）→ `28bc861d`/`660b9a3b`/`ff186c16`（原则行）
- **验收基线**：142 文件 / 834 用例全绿 · judge 816/816 · lint 双路径绿 · mcp_scan 棘轮 0 增长
- **在途**：L2 统一实现席（`l2-impl-ds`）——合并裁定版（单表 record_kind + subject 双列分层约束 + migrateLedgerColumns 建序 + §F 拆 3 key + 散文收录 + E7 补两设计节点）
- **已收口**：A12（前提证伪：接线 11-09 已在，N1 第四例）/ H1（4 张 t48 卡全部销账）/ N1 三方对账 / 小件三连 / R55 部署批 / 十纪律
- **已知残留红源**：无（judge 816/816 全绿）

## 4. 执行队列（用户拍板顺序 · 语言面冻结给用户侧）

1. **L2 落地**（在途）→ 2. **L3**（MD 降派生视图 + --check 门 + DO NOT EDIT 头）→ 3. **L4**（patrol ledgerCheck 迁移读引擎）→ 4. T-#HEARTBEAT-DERIVED（心跳根治 derived scope，一处修 8-11 工具）→ 5. T-#NODELESS-FILE-CHAIN → 6. T-#MUTATE-DET（变异抽样可复现）+ T-#SOFT-KIND-RATCHET（软判据棘轮）→ 7. N4 判据编译器接线 + N5 裁定 + kind 尾巴（journey-cases 0 消费）→ 8. INC-JUDGE-SEL/GENDB/VERIFY 增量化 → 9. T-#A8A9-CROSS-BOOK 跨册统一大件 → 穿插：N2 registry 消音 / SHEET-DIFFSCOPE 溯因 / E10 / E12 / dangling-ref 29 人工过 / T-#TESTCARD-STRONG-CRITERIA（重狗粮）/ T-#COMPLETE-OWNER-MISMATCH / T-#E3-CANVAS-FP / T-#MINIPROGRAM-ADAPT（等用户项目实测读数）。

## 5. 已知陷阱清单（踩过的坑，别再踩）

- **junction 假绿**：脚本入口守卫裸比 argv[1] vs import.meta.url 在软链下恒 false ⇒ 静默 exit 0。已修：verify/gen_cognition/mutate/lint-prose（samePath）；**其余脚本待 grep 排查**（T-#JUNCTION-SCRIPT-NOOP 行）。跑 lint 必须确认真执行（有输出）。
- **openTasksDb 建序**：先建引用新列的索引再 ALTER ⇒ `no such column` 炸全仓 tasks.db 使用者 ⇒ 新列走声明式迁移、索引后置。
- **JSON payload 构造**：PS 内联引号必炸 ⇒ node 脚本文件构造（JSON.stringify 处理转义）或 `[IO.File]::WriteAllText`。
- **docs/todo.md 编辑吞行**：replace 锚点行会吞掉相邻行——新增用插入式锚点（行后追加）。
- **无卡写账门**：`write-log-baseline.json` max_no_card=1 已被占 ⇒ 直通车写 src 会红 verify ⇒ 优先领卡。
- **structure-gaps-baseline 空**：新 scripts/src 文件无设计节点 ⇒ structure-gate 恒红 ⇒ 新文件必须同卡补节点（E7 序列）。
- **judge 全绿后仍要跑**：判据会抓"改 A 坏 B"（run 判据红 = 注释插入破坏相邻性的实例）。
- **N2**：20 条不可达 registry 登记每次 CLI 调用刷 stderr 7-20 遍——读输出时过滤，别被淹没。

## 6. 用户偏好速记

- 台账 = 共享论证面（PR 链）+ 活账（开工查账/完工核销/未完留册）+ 引擎化（三层矛盾检测）；真相在引擎，MD 是提醒与派生视图。
- 唯易不易：规则皆可论证推翻——破规则要写明理由；引用仓规是倾向不是禁令。
- 交付质量优先 + 功能链条全；每阶段 push；不赶工期。
- 用户概念是理解入口：要更正到更权威的表述（并如实告知）。
- 评审席/三席能上就上；AGNES 挂了先探针再决定双模。
