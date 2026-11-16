# 总任务台账 · 侦察席（台账侧）

**卡的请求**：把仓里所有「待办任务源」翻出来，编一份总任务台账。
**范围（本席）**：`docs/todo.md`（335 KB / 553 行）· 三册 `.agent-io/design/*.dsl.json` 的活卡 · `docs/PROJECT-DESIGN.md` 未完节 ·（补）`docs/INDEX.md §四 未完成` · `task_plan.open_questions`。
**纪律**：只读侦察 —— 未改任何仓内文件、未跑重门（只跑 node 只读探针读 JSON/SQL 文本）。
**仓**：`D:\agentio\dev\agent-io` → `D:\Projects\ai\agentio\dev\agent-io`（软链已验证 `LINK-OK`）。

## 0. 口径与方法（先交口径，再交清单）

1. **动词扫描**（按卡的判据）：`待做|未做|仍未|还需|还要|要改|要补|下一步|已派|待派|等待|未提交` 全量扫 553 行 ⇒ **27 命中**。但**27 条远不够**：todo.md 的活任务绝大多数写成**表格行**（`| T-#… |` / `| F# |` / `| 2.5 |`），行内不带这些动词。⇒ 本席的扫描面扩成「动词行 + 全部表格行 + `§` 标题段」，再人工按「是否已了结」筛。
2. **假阳纪律（2026-11-05 那 15 条假阳）**：对每条命中同时数 `✅` 数 / `「` 数 / 反引号数。实测本轮 27 条里只有 **1 条**（L350 R58）带 `✅`（1 个，且在「已收的」列表语义里），其余 26 条 `✅=0` ⇒ **本轮假阳面的主要风险不是引文里的 ✅，而是「段落标题里的动词」**（如 L77 `2 编辑：人只改需要改的部分`、L205 `§C … 未做条目`）—— 这两条按标题计入，未当任务。
3. **活卡口径 = `taskOfNode`**（`src/domain/task_schema.ts:294-304`）：`todos[]` 里 `node_id===node.id` 优先，否则回落 `node.task`。**实测三册都没有 `todos[]` 数组键**（只探到 `geometry.nodes[].task`）⇒ 三册的卡权威**就是 `node.task` 投影**，没有迁移层。`state ∈ {candidate, claimed}` 计为活卡，共 **37 张**（agent-io 18 / task-system-plan 18 / toolface 1）。
4. **`task_plan.open_debts[]` 不存在**（`task-system-plan.dsl.json` 的 `task_plan` 33 个键里无此名）；等价物是 **`task_plan.open_questions`（7 条 OQ1–OQ7，全部待裁）** 与 `design_completeness.criteria[].unjudged`，已全收（H8/H9）。
5. **优先级判据**：按 **WSJF = Cost of Delay ÷ Job Size**（SAFe；Cost of Delay = 用户价值 + 时间紧迫性 + 风险降低）—— 见文末「网检依据」。本台账的 P 栏：**P1 = CoD 高且 size 小-中**（假绿/安全/闸失效/单点权威断裂）· **P2 = CoD 中或 size 大**（结构性、需设计） · **P3 = 大件 / 需先裁 / 人写 / 可延**。
6. **规模**：**S = <1h** · **M = <半天** · **L = ≥半天**（本席估计，未实测工时）。

---

## 1. 总任务台账（64 条，按来源分组）

### A. `docs/todo.md` §A · P0 主线回路（15 条）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| A1 | `docs/todo.md:25-26` | 设计侧 A 类投影补齐：`expected_apis` 0% / `expected_deps` 0.4%，从 `nodes.signature`、`edges(kind=import)+imports` 投影 | L | P1 | 册卡 `project_actual_fields.ts`（candidate，派生写端「只填空、不覆盖」） | 走派生写端，不新建字段；A 类补完 ⇒ `drift` 不再 `no_comparison` | 派生写端是否已产出非空读数（本席只读到卡，未验读数） |
| A2 | `docs/todo.md:27-28` | `title` 3.7% / `rationale` 5.4% 人写补齐 | L | P3 | — | 人写，不机械造（`docstring` 只做半自动） | 与 §6.4「槽位必须声明」的关系：哪些可声明为槽位而不是缺口 |
| A3 | `docs/todo.md:31-32` | 事实侧 B/C 类：`contracts`/`fields` 表 0 行（采集从未跑）；`parent` 8.1% / `members` 13.1% 提取没写全 | M | P2 | 与 §E R66「三张语义表裁定」同源 | R66 已逐张裁：先证活读者再建；`kernel.ts` 已能提取 `type_members` 只是没调 | `kernel.ts#members` 接上后是否有消费者（否则是「没有消费者的第二处」） |
| A4 | `docs/todo.md:33` | D 语义层未接（`unresolved_refs` 3.7 万）；`return_type` 尾部是**分母错配**不是缺口 | L | P2 | **K6 LSP 融合** | 先按 kind 域现算，禁止为百分比去接语义层 | tsc Checker vs LSP 库（F5 已裁「用库不用协议 server」）是否同一条腿 |
| A5 | `docs/todo.md:34-39` | 非机械事实缺口三件：E 运行时 `contract.runtime` 未跑 / F 类人写字段 / G 类要先扩 schema（错误契约·非目标·性能·并发） | L | P3 | — | F 类「占位值不算已填」已立判据（`responsibilityVerdict`）；G 类须先答「现对象为什么表达不了」 | `observe_proposals` 0 提案（INDEX:71）是否已足以否决 E 线 |
| A6 | `docs/todo.md:46` | M1b（design-db 扩形状装其余 9 种 kind）已挂**触发条件**，不现在建 | — | P3（不做） | — | 触发条件 = 出现第 2 个需跨序列化边界读判据的消费者 | 该触发条件是否已被 R66/`runtime` 那 1 条满足 |
| A7 | `docs/todo.md:47` | `domain-independent` 57 条 + `edge-*` 6 条的域/边载体仍未建（靠 judge 现算可达） | M | P2 | — | 0.17① 已声明边界，用 `judged` 列盯住 | judge 若改按 `path` 收集会落空 —— 这个耦合有没有断言保护 |
| A8 | `docs/todo.md:58` + `:176` | 「同一 path 归谁」三种语义并存（写闸=任一 covering feature 有 claimed 卡 · gen-db=按 path 合并 · 归属账=唯一断言者）⇒ M2c 统一；`assertion_owner_book` 落成读数 | M | P1 | §C **6.2** 同项 | 统一到单一权威（`taskOfNode` 式「只此一处」） | 以哪一种为准（三种都有活消费者）；推不出来就只能「试错后搬判据」 |
| A9 | `docs/todo.md:60` + `:179` | 「每文件唯一册节点」没有权威；同一 node id 跨册重复 ⇒ 卡永远收不了口 | L | P1 | 与 A8/A17 同根 | 修法：node id 用 `path` 派生 或 `judgement_ref` 接受 `feature` 限定 | 迁移成本 vs 双门互锁的持续成本 —— **有活实例，见 H4/H1** |
| A10 | `docs/todo.md:62` | `lineReport` 的 excluded 只读本 feature 册 ⇒ 改用已有 `excludedPathsOf`（`gen_design_db.ts:296`） | S | P1 | 附带必修 | 改（权威函数已存在、零风险） | 无（唯一需要确认的是两册读数是否同时归零） |
| A11 | `docs/todo.md:94-97` | 闭环三个待建零件：①「哪些字段是槽位」的声明表 ②画布级 supersedes ③消解+灌入的单一入口 | ①M ②M ③L | P1/P1/P2 | ② = §B **F2** | ①§6.4 已定设计、实现无 ②用户裁定「后来者申请修改前面」延伸到画布层 ③现在消解与填充是两件互不知道的事 | ③ 是否已被 `plan_exit_check` 部分覆盖（与 A12 冲突，需先裁） |
| A12 | `docs/todo.md:98,115,158` | **验证** `plan_exit_check` 真能核销（判什么/漏什么 · 与 evidence 闸关系 · 画布消解谁触发）；不新造核销 | M | P1 | 对应册卡 `plan_exit_check.ts`（claimed, t48, ev=0） | 「核销机器早已存在」是 2026-11-04 的核心裁定；两天在 `diff_views` 上是 Means-End Inversion | **它自己声明只证明锚点存在与发生变化，行为判据需另跑**（`PROJECT-DESIGN.md:938`）⇒「能核销」这句话的边界必须先说清 |
| A13 | `docs/todo.md:113,133` + `:117` | 「主干 vs 细节」分界未定（决定核销判什么）；「增量派生」（只派生缺的部分、不冲掉人写意图）未验证 | S(裁) / M(验) | P2 | — | 待裁，不许拍脑袋（候选口径已写） | 候选口径「主干=文件集合+主要导出符号+关键契约签名」是否够判；增量派生走 `rebuild_design` 够不够 |
| A14 | `docs/todo.md:167-169` | `diff_views` 三处病：toolface 册 12/12 全假（`src/…` vs 裸名）· 零测试覆盖 · `scan_changes` 645 行有数据无读者 | M | P2 | 与 §B **F6/F7** 同族 | 先修保鲜（F7），或至少让它显形；否则在比两个时刻 | `diff_views` 该修还是该退役（R53「声明了机制而实现不存在」同类判据） |
| A15 | `docs/todo.md:178` | 不在 `geometry.nodes` 的文件**物理上改不了**（`roots.ts` 实证）⇒ 册与仓不同构 | M | P1 | 与 §B **F1b** 同族 | 要么册覆盖 `src/` 全部（自动建 `type=file` 节点），要么 `publish` 给可执行补救指令 | 自动建节点会不会把册灌成噪音（与 R54 册膨胀冲突） |

### B. `docs/todo.md` §B · P1 框架托管项目（5 条，F5 归入已知队列）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| B1 | `docs/todo.md:187-188` | F1/F1b：`write_log` 对账接「自动开 candidate 卡」，堵「无卡也能改」的洞（`write_gate.ts:2088-2099` 点名+放行） | M | P1 | 与 §C **6.1/6.2**、§E G12 相关 | 只开 `candidate`，**绝不自动认领**；主路不靠 watch（`source_writer.ts` 是唯一写原语） | `edit`/pwsh 直写不过 `source_writer` ⇒ 兜底层到底归谁（G12 同问） |
| B2 | `docs/todo.md:189-190` | F2/F3：画布级 supersedes + 卡结案自动消解（挂 `complete`/`patrol`，`complete` evidence 带 `dissolved: N`） | M | P1 | = A11 ②③ | 用户裁定正解；「判断有了、动作有了、触发没有」 | 挂 `complete` 还是挂 `sync_status`/`patrol` 三处都挂 |
| B3 | `docs/todo.md:191` | F4：卡 done/void ⇒ 进 `task_history`（现 0 行；空 = 红灯） | S-M | P1 | 与 `T-#NODECARD-NOT-IN-DB` 同族 | 空 = 红灯（不许当「没有历史」） | 节点卡不进库的吞卡步（`withCardWritten` 只写 `node.task`）是否已修 |
| B4 | `docs/todo.md:193-194` | F6/F7：增量选择换源（`verify:changed` 从 git 换 cache.db 变更集 + 符号级）；变更账复活 + 停摆告警 | L | P1 | **K2 增量化批次（进行中）** | 0.19② 「全量只用于建账」；R69/R71 已证伪现有增量入口 | 与 R71「`verify:changed` 是假绿入口」是否同一条账（R71 推翻了 R69 的建议） |
| B5 | `docs/todo.md:192` | F5：LSP 库接主链（go/types spike 已通未接） | L | P2 | **K6 LSP 融合** | 用库不用协议 server（用户裁定） | 与 A4（tsc Checker）是不是同一条腿；`go/types` spike 产物在哪 |

### C. `docs/todo.md` §C · P2 批次表未做条目（6 条，原 19 条合并同类）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| C1 | `docs/todo.md:213,211,187` | 6.1 任务面普查 + 6.2 非文件级改动卡位 + M2 归属权威 | M | P1 | = A8/B1 交汇 | 卡活不活**只许问 `cardLivesOf`**（第三把尺已酿过事故） | 三态读数（`sheets_ok`）是否已经进了所有读端 |
| C2 | `docs/todo.md:210,236` | 3.5 `storage.ts` 注册表拒绝+点名 + 同文件两种口径统一（`getLiveFeature⇒null` vs `⇒抛`；`^[a-zA-Z0-9_-]+$` 逐字 6 遍 + 第 3 变体） | M | P2 | 与 §G `T-#CORRUPT-AS-EMPTY-FAMILY` 同族 | 同一文件先统一到**最严**那一档，再把复述校验抽成一处 | 逐处修 vs 建一条门扫全仓这个模式（账上已判「逐处修是错的修法」） |
| C3 | `docs/todo.md:209,214,215,216` | 2.5 分母口径收全（`rateOf`）· 2.4 删 `WHEN_OVERRIDES` · 1.3 收编 `openPlansForRead`（第 3 套开库口径）· 1.4 `dsl_write_scope` 头注表漏登记 | M | P2 | — | 分母口径与「两把尺」同族，先收口径再收账 | 2.4 剩半（`DECISION-RESOLVE-CROSS-BOOK`）与 A8 是否重复 |
| C4 | `docs/todo.md:217-228` | 2.1 删 5 个死工具 · 2.2 搬家四件套并 1 · 3.1–3.4（drift 3 处 + `code_dir` / fuzzy 四件 / `editCodeBody` 单文件回滚 / `db.ts` 四处死导出） | M | P2 | **K3 P2 批量**（`scripts` 死变量同族） | 死导出真删，不委托；无消费者 = 零风险 | `HISTORY-DEAD-EXPORT` 并入 3.4 后 **G5 的死导出仍在**（见 G5） |
| C5 | `docs/todo.md:223-226` | 4.1 修 CI（删死步骤 archify）· 4.2 时长棘轮 + test smells · 4.3 声明覆盖率 · 4.5 变异分数 | M | P2/P3 | **K10 D7/D9 变异抽样**（4.5） | 4.5 归变异抽样线，不单独立项 | 4.3「声明覆盖率」的分母是否也是「两把尺」（A8 同病） |
| C6 | `docs/todo.md:212,227-228` | 6.3 daemon 启动自检 + **常驻** · 6.4 备份真恢复演练 · 6.6 测试八条规约 | M-L | P2 | — | 6.3 是删 `reconcile` 的**前置**（§E `RECONCILE-IS-PERIODIC-FULL-SCAN`：先常驻才能把周期全量降为「启动补一次」） | 本机无常驻 daemon（实测只有 MCP server）⇒ 6.3 是硬前置还是可绕 |

### D. `docs/todo.md` §D · P3 翻译/机械翻产品线（2 条，36 条单列不按条数算）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| D1 | `docs/todo.md:246-292` | 翻译线 36 条（`T-#KILL-LEGACY` 最大结构债 ~500 行两套并存；`MECH-METHOD-CALL` TS2339×250；`SHIM-VALUE` TS2304×789…） | L | P3 | 已知队列未覆盖（新增发现） | 全部 KEEP，按「每铺一类保 t447+t441 双绿」推进 | **t447/t441 已不存在**（`certs/` 整目录在 `72335634` 被删）⇒ 验收条件本身是死判据（D2） |
| D2 | `docs/todo.md:292` | `T-#T447-DEAD-CRITERIA`：`KILL-LEGACY` 的验收条件「保持 t447+t441 双绿」**已不可执行** | S-M | P1 | — | 死判据：一条验收条件指向不存在的文件 | 改 `scripts/audit-mech-parity.mjs` 对拍 + 一条 e2e —— 工作量是否被低估 |

### E. `docs/todo.md` §E · 治理（12 条，覆盖 G2–G15 + R1–R76 共 69 行；**该段 96 KB 里只有约 1/5 是活任务**）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| E1 | `docs/todo.md:301,306` | G2/G6：临时件自动落 `scratch`（写 `.agent-io/` 根 ⇒ 拒并提示路径）+ scratch 升格带淘汰、按代理隔离 | S-M | P1 | 与 §G `T-#MANIFEST-MESSAGE-FIX-3LINES`/`SCRATCH-*` 同族 | 「三行改动能永久止住」（`gen_manifest.mjs` 红字只给两个选项 ⇒ 全仓都选「加理由」） | 27 条 `NON_VOLUME_ENTRIES` 是否已降；一次递归删掉两张在飞卡成品的事故要不要检测点 |
| E2 | `docs/todo.md:302,321,331` | G3：`plans` 删除/取代入口（op=supersede）+ 租约单点 expire；R19：`0.27④` 临时件收口无检测点（八张卡积 317 个文件） | M | P1 | = A11② / B2 | 「工具面设计的不是怎么顺理成章」的具体例 | 过期租约接管（`E-CLAIM-016`）与 supersede 是不是同一个动作的两面 |
| E3 | `docs/todo.md:303,331` | G4：`E-CLAIM-016/017/018` 透传 `errors` 详情 + `E-PLAN-022` 缺参不静默回放；R35：`edit_dsl node` op 键表缺 `arch_layer`（改名丢字段） | S-M | P1 | — | 零依赖纯函数 `validateSupersedes` 已返回 `{ok,errors}`，只是没透传 | 报错不透传 = 用户猜门；这一族还有几处（R42 desc 说谎同型） |
| E4 | `docs/todo.md:304` | G5：`task-history` 旧路径 8 处改口径 + 死导出删除 | S | P1 | §C **3.4** | 死导出无消费者 ⇒ 零风险删 | **现算：`getTaskHistoryFile` 仍在 `src/infrastructure/task_history.ts:514`，全仓 1 命中（=定义处）⇒ 与台账「已并 3.4」不符** |
| E5 | `docs/todo.md:307` | G12：并发写者无检测（两张卡同碰 `design_line.ts`，租约没拦住） | M | P1 | — | 疑点：第二张卡可能 claim 的是别的节点，写闸按「文件→卡」判 | 租约/文件占位的判据到底是 node 还是 file（与 6.2 同问） |
| E6 | `docs/todo.md:308` | G14：门本身不确定（`behavior-cases` 起真子进程，60s 超时 ⇒ 机器压满时偶发 `unsupported`）| M | P2 | — | 「一条永远会亮的告警等于被关掉的告警」 | flaky 与「真 unsupported」怎么在读数上分开（R15 环境态普查同问） |
| E7 | `docs/todo.md:309` | G15：`structure.domains.json` 有读者无写者 ⇒ 结构意图唯一权威只能手改 JSON | M | P2 | **K3 P2 批量（structure.domains 陈旧指针）** | 要么给它写端，要么降级为派生 | 陈旧指针是「没写者」的后果还是另一件事 |
| E8 | `docs/todo.md:310,311,337` | R1/R2/R44 规则纪律族：规则族合并（先数「第 N 条」引用）· `lint:prose` 盲区（`AGENTS.md` 不在扫描范围、`928 条` 不在量词表）· 写死计数守卫只拦「数字+闭集量词」 | M | P2 | — | 「注释里的等式和数字一样是快照」 | 合并规则族的收益是否覆盖「23 处第 N 条错位」的风险 |
| E9 | `docs/todo.md:333,334,335` | 判据强度族：20 条裸名 `source-has` 可能在用「词出现过」冒充「定义还在」· `.java` 不在 `isCodeText` 的 `CODE_EXTS` 里（判据可被注释满足）· `symbol-exists` desc 仍写「按 AST 判导出」而实现不过滤 | M | P1 | — | 第一级（变红的 1 条已改 `fs.renameSync`）；第二级「不变红但同样坏」才是重点 | 第二级要不要一次普查（它靠边界规则永远发现不了）；`CODE_EXTS` 现算仍缺 `.java`（本席未逐语言核） |
| E10 | `docs/todo.md:344,345,349` | **安全面三连**：R52 三处把不可信输入拼进 shell（`detect_drift.ts:94`/`run_tests.ts:88,181`/`git.ts`）· R53 MCP `instructions` 教模型用**不存在的工具**（`server.ts:48-50`）· R57 `diagnose_loop` 默认 `verify=true` 在被分析仓库执行 test | S-M | **P1** | 已知队列未覆盖（新增发现） | 主控已逐处核实成立；R53 最严重的一处是模型读到的第一屏 | 三处 shell 拼接的修法（白名单 vs 参数化 exec）是否一次性统一；`instructions` 与 `TOOL_DEFS` 之间要不要一条一致性判据 |
| E11 | `docs/todo.md:347,348,355,356` | 工件与量具族：R55 索引/垃圾无限增长（`cache.db` 106 MB + 122 MB `.bak-*` 残留）· R56 44 条 tool description ≈37 KB/会话固定成本 · R63 语法门只保证「能解析」 · R61 量具只扫 19.4% 文件被读成「0 命中」 | M-L | P2 | **K5 env.manifest+版本池**（部分） | R61 定性为「今晚最严重的一次量具失效被读成事实」 | 真递归普查要不要成为一条常设探针（现靠人手写 `-Recurse`） |
| E12 | `docs/todo.md:313,351,354` | **判据完整性族**：R9 判据的「前提」一等公民（`pass` = 查了 ∧ 前提成立）· R59 `decision.update` 的 `expectations` 全量替换已第 3 次冲掉判据 · R62 **判据总数没有任何断言保护**（647→648 无感） | L | P1 | **K3（台账 R9-a）** | R9 用户已裁「那就这么办」；规格全文在 `.workbuddy/memory/2026-11-05-specs-index.md` | 三件是否同一根因（替换语义 vs 总数无断言）；「总数断言」放哪一道门 |

### F. `docs/todo.md` §F · 裁决留档（1 条）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| F1 | `docs/todo.md:390-399` | 8 条裁决**已定、只防误修**；唯一仍挂的是 `CANVAS-CROSS-BOOK`：`handlers.ts` 的画布登记在 `task-system-plan`（该册持有此文件）—— 待 M2 一并解 | S | P2 | = A8/A9 | `SYM-HASH-VS-BODY-HASH` / `ZERO-VALUE-TWO` 永远不许合并（最高优先留档） | M2 解的是「归属」还是「画布册」；两者若不拆会互相复活 |

### G. `docs/todo.md` §G · KEEP 83 条（7 条；本席对其中 9 条做了现算复核，**台账本身已过时**）

> **复核结论（现算，不抄台账）**：已修/已落地 3 条 —— `T-#RUNTIME-KIND-UNUSED`（册里 `runtime` **现 1 条**/816，不再是 0）、`T-#LEDGER-CORRUPT-LOSES-DATA`（`scripts/inventory-sweep.mjs:46` 已改成「台账不可读 ⇒ 拒绝一切写盘 + 非零退出」`refuseBrokenLedger`）、`T-#HISTORY-DEAD-EXPORT`（仍开，见 E4）。仍开 6 条：`KIND-PHASE-DUP`（`PHASE_BY_KIND` 仍在 `src/domain/expectation.ts`）· `COMMENT-STRIP-4`（剥注释多档仍在 8 个文件）· `ATOMIC-WRITE-THREE`（`writeAtomic` 在 6 个文件）· `EXT-TABLE-THREE`（`CODE_EXTS/TS_EXTS` 命中 19 个文件）· `SKIPLHS-GO-TABLE`（`contract_gate/languages/ts.ts` 仍用 `SKIP_LHS`）· `SAME-LIST-TWO-HOMES`（`LANE_IDS`/`LANE_META` 在 `capability_map.ts` ×12）。

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| G1 | `todo.md:424,440,451,428,453,462` | 「同一概念多份实现」族 6 条：`kind→phase` 两处 · 剥注释 4 档 · 原子写三份 · 扩展名三处 · `SKIP_LHS` 用 Go 表做 TS 过滤 · `LANE_IDS`/`LANE_META` 各写一份 | M-L | P2 | 与 `PROJECT-DESIGN §13.5`「能机械发现候选、不能机械判语义相同」同一政策 | 「一处权威」；本席现算：**6 条全部仍开**，无一被合并 | 机械候选发现做成了吗（§13.5 声称能发现）；哪些是「同语义不许合」的假候选 |
| G2 | `todo.md:421,432,441,480,484` | 闸与准入门族：L1 卡立卡后无法 release/void（永久 `preparing`）· `OP_SPECS` 不是 op 形状唯一判据（5 处第二检查）· 「自称与 X 对齐」无验证 · 闸丢了「文件→卡」映射 · 计划闸要求 `judgement_*` 而量具类改动结构上无法满足 | M | P1 | 与 §G `T-#PLAN-GATE-NEEDS-DECISION`、R12「不归册管的四种形态」同族 | R12 已在查四种豁免形态（存量实证 74 处） | L1 死卡与 R12④ 清 128 条是同一批吗（R33 说会误删 62 个合法声明） |
| G3 | `todo.md:427,429,431,442,455,476` | 清点机制族 6 条：`validateForm` 判 `closed.includes(w)` 口径错 · `npm run inventory` 不转发参数（机制假绿）· `takeBatch` 的 `expect` 是 JSON 字符串 · `--batch` 一次吐 40KB+ · 「带前提的相同判决」无处记 · 测试绕过 `invokeTool` 直连 handler | M | P2 | — | 「输入可以造，历史不能造」（用户裁定）；测试绕过 `invokeTool` ⇒ 所有 `runDslWriteScope` 闸在测试里形同虚设 | 清点机制本身还值不值得修（它的产出正在被 todo.md §G 消化） |
| G4 | `todo.md:437,443,447,450,493` | 静默失败族：observe 层 15 处「读失败⇒当空」· `src/` 单行 `catch{return[]}` 0 处但多行版仍在 · `write_gate.hasLiveIndex catch⇒false`（锁/坏库与「没有索引」同形）· 网关 stats 持久化写 0 · `T-#GW-STATS` 同源 | M | P1 | 与 §E R22「token 闸 skipped 且照常写盘」同族 | 0.12：把「坏」与「没有」分开，`ok:false` 只许走拒绝路径 | 建一条门扫「catch⇒空⇒整份覆盖」模式（`CORRUPT-AS-EMPTY-FAMILY` 已判「逐处修是错的修法」）—— 门本身怎么造反例 |
| G5 | `todo.md:439,464,477,483` | 假绿/恒绿族：`design_diff.ts:101` 一条「永远绿」的判据 · `expected_deps` 对拍是**恒等式** · 覆盖率分子不是分母子集（可 >100%，同函数两口径）· 自己拼的覆盖 vs 权威函数差 54（108%） | M | P1 | 与 §E R62/R71 同族 | 「一条永远绿的判据」= 被关掉的告警；算进一致是最坏的谎 | 恒等式对拍那条该删还是该换成真比较（`symbol_diff.ts` 已有符号级判据） |
| G6 | `todo.md:445,460,461,463,468,469` | 读数与路径权威族：`storage.ts:1574` 枚举「本仓有哪些册」有两个答案 · `capability_map.ts:869` 缺口检查器查不到就报「不算缺口」 · `registry_extract.ts` 用正则切 `server_registry.ts` 文本 · `catalogOf` 逐字段搬运漏字段 · `cache.db` 路径 4 处手拼 · `design/<f>.dsl.json` 5 处手拼 + 1 处自蛋 readdir | M | P2 | — | 判事实先找权威函数（0.9.1 一处权威） | 路径口收口是否与「K3 册 source_root 反斜杠」同一条修（本席现算：`agent-io.dsl.json` 的 `source_root` 是 `D:\\agentio\\...` 反斜杠，另两册是正斜杠 ⇒ 同一族的活证据） |
| G7 | `todo.md:457,467,471,474,482` | 构建与产物纪律族：`npm run build` 不含 `cognition`（两处定义「构建完成」）· `new DatabaseSync(不存在路径)` 造 0 字节空壳撞 `manifest:check` · 用目录 mtime 判 build 是错的 · `T-#SMALL-FIX-NEVER-GETS-MADE`（成本随卡大小缩放、收益不缩放 ⇒ 小改动永远不做）· 审计账绝不能住 `cache.db` | M | P2 | — | 0.21 已免掉纯文案那一半；**「删临时件/搬文件/改配置」那一半仍排队** | 小修快速通道的判据（四条）是否要扩到「删/搬/改配置」；扩了会不会把闸废掉 |

### H. 三册活卡（9 条，覆盖 37 张 `candidate/claimed`；`todos[]` 不存在 ⇒ 权威 = `node.task`）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| H1 | `agent-io.dsl.json` 4 张 claimed | `task_ops.ts`(t48) · `plan_exit_check.ts`(t48) · `complete_canvas_gate.ts`(t48) · `write_gate.ts`(t35, ev=10)；**t48 三张 `ev=0`（证据 0 条）但工件已落盘**（`complete_canvas_gate.ts` 15 KB @11-07 14:54 · `plan_exit_check.ts` 10.6 KB @14:54 · `tests/p0_complete_canvas_gate.test.ts` 19 KB @14:56） | S | **P1** | 与 A12 同一张卡 | AGENTS §三「收尾三问」第②问：**改动落了地、卡却停在 claimed ⇒ 谁在办/办完没办完读不出来** | 是「卡忘了收」还是「收不了口」（`complete` 被 A12 的未知挡住）—— 这一条决定 A12 的优先级 |
| H2 | `agent-io.dsl.json` 8 张 "L1 待建构" 模板卡 | `query_feature.ts` · `tool_faces.ts` · `write_gate.ts` · `cli.ts` · `server.ts` · `symbols.ts` · `db.ts` · `source_exts.ts` · `serve.ts` —— summary 是生成模板（「N 个函数（导入自 M 个模块）」） | — | P3（结构噪音） | — | 卡摘要不可读 ⇒ 池/overview 里看不出「这卡要干什么」 | `candidate` 到底是「待认领」还是「待建构」—— **语义混在一格里**，H3 的实义卡与它同状态 |
| H3 | 索引/事实线 candidate 5 张 | `index/symbols.ts`（三路 RRF：精确名 + FTS bm25 + 子串兜底，R65①②）· `index/schema.ts`（`identifiers` 表 + 4 个消费者）· `parse/kernel.ts`（`nodes.members` 没调 `type_members`）· `parse/source_exts.ts` · `index/db.ts` | M-L | P1 | 与 A1/A3、R65 同源 | 「能力在、没接上」的典型（`type_members` 已能提取只是没调） | `identifiers` 表建了谁读；建了不接 = R53 同型（声明了机制而实现不存在） |
| H4 | `agent-io` × `task-system-plan` **同 id 双册开放卡 2 张** | `file_src_application_write_gate_ts`（A 册 candidate / T 册 claimed-t35）· `file_src_domain_expectation_ts`（两册都 candidate）—— 同 id、同 path、**两张都开着** | S | P1 | = A9/A8 | 台账 `docs/todo.md:179` 已判「两册同名节点 ⇒ 卡永远收不了口，只能 `release` 不许硬收口」 | **这是该账的活实例（可复算）**：全仓 498 个 node id 跨册重复、414 个 path 在 >1 册（上一行 `500/97%` 的口径仍成立，但两张 open 卡是新的具体坐标） |
| H5 | `agent-io.dsl.json` 设计域 candidate 5 张 | `overlay.ts` · `geometry.ts` · `design_sheet.ts` · `discussion_log.ts` · `chain_wiring.ts`/`b_terms.ts` —— summary 全是「唯一住处」类声明 | M | P2 | 与 `PROJECT-DESIGN §13.4 接线证明` 同一判据 | 「注册了、写了、建了」不等于成立（§13.4） | 这些「唯一住处」有没有反向反例（打断它测试会红吗） |
| H6 | `agent-io.dsl.json` 任务/写闸 candidate 4 张 | `task_ops.ts`(claimed 见 H1) · `write_gate.ts` · `query_feature.ts` · `board/pool.ts` —— **`board/pool.ts` 实况已实现且被 3 处消费**（`query_feature.ts:74`、`unsettled_hint.ts:25`、`write_gate.ts:104`） | S-M | P1 | = §C 6.1/6.2 | **册/代码/台账三处读数不一致**：`task-system-plan.dsl.json` 的 `task_plan.service_flow.steps[2].unjudged` 仍写「`board/pool.ts` 未实现 ⇒ 第 3 步没有读端」，而文件存在且有三个消费者 | 谁该改：册（卡该 done）还是 `task_plan` 文案（该删「未实现」）—— 这是**台账自我过时**的最小可修样本 |
| H7 | `agent-io-toolface.dsl.json` 1 张 | `file_tool_faces_ts`（candidate）：工具面是 `TOOL_DEFS` 的视图，唯一手写名单是 `MINIMAL_FACE_TOOLS` | S | P2 | = A14（toolface 册 12/12 全假） | 全册只有 6 节点 ⇒ 它是不是「第二份清单」 | 三册里同一 path（`tool_faces.ts`）出现 3 次 ⇒ 该并入 agent-io 还是保留切片 |
| H8 | `task-system-plan.dsl.json` `task_plan.open_questions` | **OQ1–OQ6 待裁**：①「已满足」卡自动收口还是只提示（`t_done_from_candidate` 正卡在这里）②TTL 取值 ③void 是否留档 ④discussion 版本链可 diff ⑤空集「全过」算不算真（vacuous truth）⑥TTL 应否按卡类分档 | S（裁决） | P1 | — | 这 6 条是**状态机的空挡**，不是文档问题 | ⑤ 空集语义会决定「未领卡会不会被自动收口」—— 与 H1 的「卡停在 claimed」可能同因 |
| H9 | 同一 `task_plan` 的 `unjudged` 欠账 | OQ7 连线方向未定（live 触发 patrol vs patrol 自取 live）· `D-judge-port` 欠账（**全仓 `JudgePort` 0 命中 ⇒ 裁定从未落地**）· 「target 被删的卡：void 未实现、done 不可能、superseded 无迁移 ⇒ 永远没有终态」 | S-M | P1 | — | `D-T8 榜单读端` 已过期（`pool.ts` 已存在） | `JudgePort` 这条要不要正式作废（P4 判据：裁定从未落地且无载体） |

### I. `docs/PROJECT-DESIGN.md` · 设计已定、实现未落（5 条）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| I1 | `PROJECT-DESIGN.md:620-625`（§9.5.5 第 2 条） | 「接入计划与核销」：生成的契约带稳定引用，plan 不复制判据正文，**complete 只读实际执行 verdict** | M | **P1** | = A12 的下游 | 设计已定；实现**自认未做** —— 证据 `src/domain/behavior_contract.ts:221`：`delegated: '未实现：§9.5.5 第 2 条「接入计划与核销」'`（★ 卡里给的路径是 `behavior_compile.ts:221`，实际在 `domain/behavior_contract.ts:221`） | 「只读实际 verdict」要否一条判据（否则 complete 仍可手写 evidence —— 见 INDEX:75 `reopen` 可伪造 `evidence.at`） |
| I2 | `PROJECT-DESIGN.md:598-611`（§9.5.3 第 7 步「真跑并产生 verdict」） | 编译流水线第 7 步：真跑并产生 verdict + 执行证据；第 8 步交给 ChangeSet/plan/complete | M | P1 | = §15 阶段 C 第 4 项 | `planContractCompile` 把第 7/8 步显式 `ok:null + delegated` 移交（不算绿也不算红，符合纪律） | **消费点只有 `scripts/pilot/behavior_pilot.mjs`**：`compileBehaviorContracts` 全仓 5 处命中 = `behavior_compile.ts:170`（定义/自引）+ `behavior_contract.ts:217`（委托字符串）+ pilot 脚本 3 处；单测 `p0_behavior_contract_compile.test.ts:29` 只测 `planContractCompile` ⇒ 没有工具面入口 = 「pilot 之外没接线」 |
| I3 | `PROJECT-DESIGN.md:322-332`（§6.4 槽位必须声明） | 「空槽位是设计的一部分，但必须有声明：主干必填 vs 声明为槽位」 | M | P1 | = A11① | 设计已定，实现**无**（`docs/todo.md:95`「现在没有 ⇒ 无法区分槽位空与主干缺」） | 声明表住哪（册字段 vs `task_plan`）；它与 A2（title 3.7%）谁先动 |
| I4 | `PROJECT-DESIGN.md:914-922`（§15 阶段 C 出口） | 阶段 C 出口「没有本次变更时，用户不需要为维持 DSL 而做手工同步」—— 5 项里第 4 项（行为契约编译器）未闭环，第 1–3 项待验 | L | P1 | = I1/I2 | AGENTS 零：出口没过就不是过；不许用自编指标替代 | 阶段 C 的 5 项各自有没有「会红」的检测点（否则出口判不了） |
| I5 | `PROJECT-DESIGN.md:944-951`（§16 明确未决 6 问） | ①ChangeSet 与 decision/plan/task 的最小映射 ②功能子图边界与上下文体积 ③意图移动/合并时稳定标识 ④核销要哪些证据组合 ⑤无语义信息时哪些工作项必须停 ⑥首用是否需理解内部 DSL | M（裁） | P2 | 与 `task_plan.open_questions` 部分重叠 | 全文定位为「必须通过实现与真实任务回答」，不是指标 | ③ 稳定标识正是 A9（node id 跨册）的上位问题；④ 与 A12/A13 同一个问题 |

### J. 补：`docs/INDEX.md §四 未完成`（另一本账，2 条合并）

| # | 来源 | 任务（一句话） | 规模 | P | 与已知队列 | 当前裁定 | 待论证点 |
|---|---|---|---|---|---|---|---|
| J1 | `INDEX.md:55-56,75` | A7 默认仍是「提醒+放行」（`AGENT_IO_ACTOR_STRICT=1` 才拦）· 自报身份拦不住冒充（架构限制）· `reopen` 的闸只堵「零动作」，伪造 `evidence.at` 仍能过 | M | **P1** | 与 B1/§E R12「actor 来源」同族 | 「自报拦不住冒充」已定性为架构限制、非缺陷 | 既然不可信 ⇒ 写闸的信任模型该写在 `PROJECT-DESIGN` 哪一节（现在只在 INDEX 备注里） |
| J2 | `INDEX.md:60-73` | 未过闸的两条写路（`diagnose`/`upgrade apply`/`deprecate_offline`）· 4 个脚本仍 import `dist` · `hook-task-gate.mjs` 是死闸 · 12~25 节点指向盘上不存在的路径 · `task_plan` 是工具面外飞地 · `run` 缺 `target`/`cases` · 跨文件 `obj.method()` 不建边 · `observe_proposals` 0 提案 · 覆盖 98% 但 claimed 卡只覆盖 4 个文件 | M-L | P2 | = A3/A4/A15 的事实侧 | 「闸一开，改绝大多数已纳设计的文件都会被拒，除非领卡或 authorize」⇒ 这是**当前闸不可常开**的真因 | 覆盖 98% × claimed 4 文件 的落差要先补哪一侧（覆盖 vs 领卡成本） |

---

## 2. 与已知队列的去重映射（只标注，不重复列）

| 已知队列 | 台账里对应行 | 状态 |
|---|---|---|
| 销账三层（S1/S2/S3 stale patrol + 级联未了结提示 + AGENTS 收尾三问） | 无对应行（commit `5ee226ab` 已落地） | **已完成**，不列 |
| 增量化批次（进行中） | **B4**（F6/F7）、A14（`scan_changes` 无读者）、§E R69/R71 已并入 | 进行中，本席只补「谁欠谁」的依赖 |
| P2 批量（台账 R9-a / `structure.domains` 陈旧指针 / `scripts` 死变量 / 册 `source_root` 反斜杠） | **E12**（R9-a）、**E7**（G15 structure.domains）、**C4**（scripts 死变量）、**G6**（路径权威；现算 `agent-io.dsl.json` 的 `source_root` = `D:\agentio\...` 反斜杠，另两册正斜杠 ⇒ K3 这一条可定位到具体册） | 已知，本席只补活证据 |
| CLI 逃生舱三件套（`key=@file` / `key=@-` / `cli exec` 批量）+ 脚本标签检索（`@agentio-tag` + `script-registry` + `script_search`）+ 下载安装包管理 | **E10/R76**（安装器写的是「当前工作目录解析到的 `node_modules`」⇒ 装两个互相干坏）；todo.md §E 里**没有**「CLI 逃生舱三件套」与「脚本标签检索」的行 ⇒ 这两件在 todo.md 台账里**缺账** | 已知外**缺账**：请另一席确认是否只存在于 `HANDOFF-*.md` |
| `env.manifest` + 版本池 | **E11**（部分：R55 索引膨胀 / env 面） | 已知，本席未展开 |
| LSP 融合 | **B5（F5）** + **A4**（tsc Checker） | 已知；两条要合并成一条腿 |
| 前端路径 | 无对应行（todo.md 与三册都无「前端」活任务） | 已知外**无账** |
| MyBatis 接线决策 | 无对应行（git `0ad36b56` 提到 `mybatis experimental marking`，台账未记） | 已知外**缺账** |
| D1 册缺 `diff_scope.ts` | 无对应行（§A 的「97 个盘上未映射文件」在 `docs/todo.md:51-53` 只统计到 3 个 category） | 已知，本席未核 |
| D7/D9 变异抽样 | **C5（4.5 变异分数）** | 已知 |

---

## 3. 你发现的、已知队列之外的「新大陆」

**① 台账/册/代码三处读数互不一致，且有可复算的最小样本（最值得先修）。**
三条现算反例：`runtime` kind 台账写「0 条在用」，册里实际 **1/816**；`board/pool.ts` 被 `task_plan.service_flow.steps[2].unjudged` 写「未实现 ⇒ 第 3 步没有读端」，而文件存在且被 `query_feature.ts:74` / `unsettled_hint.ts:25` / `write_gate.ts:104` 三处消费；`T-#LEDGER-CORRUPT-LOSES-DATA` 台账说「静默丢数据（未修）」，`scripts/inventory-sweep.mjs:46` 已改成「台账不可读 ⇒ 拒绝一切写盘 + 非零退出」。⇒ **这不是三条 bug，是一个读数权威缺失**：`docs/todo.md` 的行没有「谁在什么时候把它标成已了结」的机制，于是它只会单向增长（正是 §E R31 自己写下的病灶：「`docs/todo.md` 没有归档动作 ⇒ 长成第二份规格库」）。**§E 段约 100 KB / 69 个表格行（G2–G15 + R1–R76）里，约 47 行是规格全文或「详见 `.workbuddy/memory/*-spec.md`」指针，只有约 1/5 是活任务。**

**② 4 张 claimed 卡里 3 张是「工件已落盘、证据 0 条」（`agent=t48`，2026-11-07 14:54–14:56 落盘，`claimed_at` 06:52–06:56）。**
`complete_canvas_gate.ts`（15 KB）+ `plan_exit_check.ts`（10.6 KB）+ `tests/p0_complete_canvas_gate.test.ts`（19 KB）都在盘上，卡却停在 claimed 且 `evidence=[]`。这正好命中 AGENTS §三「收尾三问」第②问，也说明 **A12（验证 `plan_exit_check` 能核销）可能就是这 3 张卡收不了口的原因** —— 先有 A12 才有它们的 `complete`。

**③ 「两册同 id 双册开放卡」有 2 张活实例（台账上只是文字警告）。**
`file_src_application_write_gate_ts` 在 `agent-io.dsl.json` 是 candidate、在 `task-system-plan.dsl.json` 是 claimed(t35)；`file_src_domain_expectation_ts` 两册都 candidate。全仓 **498 个 node id 跨册重复 / 414 个 path 在 >1 册**（`docs/todo.md:56` 的「500 个同名 node id 100% 同 path」口径仍成立 —— 即重复本身是**有意切片**，但「哪册是这个 path 的断言者」仍无权威）。⇒ A9 不是理论风险，是**此刻就有 2 张卡被锁死**。

**④ `§9.5.5 第 2 条` 的真实落点与卡里写的不同，而且整条契约编译器只有 `scripts/pilot/` 一个出口。**
自认未实现的字符串在 `src/domain/behavior_contract.ts:221`（不在 `behavior_compile.ts:221`）；`compileBehaviorContracts` 的消费者 = 自身 + `scripts/pilot/behavior_pilot.mjs` + 一条单测 ⇒ **没有工具面入口**。所以 §15 阶段 C 第 4 项不是「没写」，而是「**写成了 pilot，没接成能力**」—— 这是 AGENTS §十二 第 2 档（有但未接线），修法成本比第 4 档（新增）低一个数量级。

**⑤ 一条从未落地的裁定：`JudgePort` 全仓 0 命中。**
`task_plan.rulings_2026_10_17_judge_port.design_impact[3]` 自述「全仓 `grep JudgePort = 0` ⇒ 裁定从未落地 ⇒ 欠账 `D-judge-port`」。这是台账体系里**裁定与落地之间没有闭环**的直接证据（与 ④ 互补：一个是写成 pilot，一个是写成文字）。

**⑥ `docs/todo.md` §D 的验收条件指向已删目录（死判据）。**
`T-#KILL-LEGACY` 的「保持 t447+t441 双绿」在 `certs/` 被 `72335634` 删除后**不可执行**；同一段里 36 条翻译任务都挂着这个验收条件。⇒ 整条 P3 产品线的**完成定义**目前是空的，不是「没做完」。

**⑦ 最小可修的「台账自我过时」样本（建议作为第一批销账）。**
`task_plan.service_flow.steps[2].unjudged` 那句「`board/pool.ts` 未实现」（已被 3 处消费）+ `T-#RUNTIME-KIND-UNUSED`（现 1 条）+ `T-#LEDGER-CORRUPT-LOSES-DATA`（已修）+ `HISTORY-DEAD-EXPORT`（`getTaskHistoryFile` 仍在 `task_history.ts:514`，1 命中即定义处）。四条都是 S 规模、判据现成，一次能清 4 条假账 —— 且**修的是「台账可信度」这个元问题**，收益不随条目大小缩放。

---

## 4. 网检依据（支撑 P 栏的判据）

优先级用 **WSJF = Cost of Delay ÷ Job Duration**，其中 **Cost of Delay = User-Business Value + Time Criticality + Risk Reduction**（SAFe 口径，Fibonacci 打分；WSJF 也适用于 SAFe 之外，本质是经济决策工具）：

- [Prioritization Frameworks（awslabs/aidlc-workflows）](https://github.com/awslabs/aidlc-workflows/blob/50a9e926c38fc8a24b386c656f8102fd1034d403/core/knowledge/aidlc-product-agent/prioritization-frameworks.md) —— 「WSJF = Cost of Delay / Job Duration；Cost of Delay = User-Business Value + Time Criticality + Risk Reduction；每项按 1–10 或 Fibonacci 相对打分」。
- [Product Backlog Prioritization: 5 Frameworks That Work（Tempo）](https://www.tempo.io/guides/how-to-avoid-common-product-backlog-prioritization-pitfalls#4.-kano-model) —— 「Cost of Delay 问的是『现在不做会怎样』：价值随时间衰减的条目 CoD 高；WSJF 用 CoD / duration 排序」。
- [prioritize-wsjf.md（orchestkit）](https://github.com/yonatangross/orchestkit/blob/83dab3d5db15c1b3a4c84c8b04065e91cf6d9e62/plugins/ork/skills/prioritization/rules/prioritize-wsjf.md#1) —— 「Higher WSJF = do first；Job Size 用相对规模」。
- [multi-metric-evaluation-methodology（claude-night-market）](https://github.com/athola/claude-night-market/blob/master/plugins/imbue/skills/feature-review/modules/multi-metric-evaluation-methodology.md#1) —— WSJF 与 RICE 的差别：RICE 乘 Reach/Confidence，WSJF 只除 effort ⇒ **本项目这种单团队、单仓、无「触及用户数」的场景，WSJF 比 RICE 合适**。

**我怎么用它（本台账的 P 栏就是这张表的落用）**：
- **Risk Reduction 在本仓权重最高**（用户价值 = 「框架能托管项目」而不是某个功能），所以**「假绿 / 恒绿判据 / 静默失败 / 安全拼接」一律给高 CoD** ⇒ E10、G5、G4、E12、H1 进 P1，即使它们的「功能价值」看起来是零。
- **Time Criticality**：账已停摆/读数已过时的条目，`docs/todo.md` 自己会继续长（R31）⇒ 越晚修越贵 ⇒ 台账自我过时类（新大陆 ⑦）给 P1。
- **Job Size**：S 规模高 CoD 的条目**必须排在大件前面**（这正是 WSJF 与「先做最大的」相反的直觉）—— 所以 A10（S，P1）、E4（S，P1）、H1（S，P1）、D2（S-M，P1）都排在 L 规模的 A1/A4 前面。

**已知的判据弱点（请下一席反驳）**：本节无法量化「用户价值」—— 本仓没有用户在打分，我用的是**替身**：① 有没有活检测点会红 ② 修不好会写到哪份文档/哪张卡里。这两条都是我可复算的，但它测的是**框架可靠性**，不是**产品价值**。
