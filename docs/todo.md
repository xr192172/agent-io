# 待办（**唯一权威**）

> ## 维护纪律（这几条比清单本身重要）
>
> 1. **做完的直接删**，不留 ✅ 行 —— 历史在 `git log -- docs/todo.md`。留着的代价是**漂移**
>    （实证：`T-#KILL-LEGACY` 曾在这份文件里出现**两次**，同一件事两个条目）。
> 2. **被新决策覆盖的**：要么改写成新任务，要么删。**不许让旧描述继续存在**。
> 3. **每次动它都整份重排**（顺序按依赖与危害重排），不是往后追加。
> 4. **执行顺序也住这里**（§一），不另开 schedule 文件 —— 两个文件就是第二处权威。
> 5. 「标题只剩半句、正文在 git」的条目**已删**（它们无法判断，只制造噪音）。

---

## 一、当前批次（执行顺序 · 含判据与派法）

> 主进程只做：**排班 · 派活 · 验收**。派出去后不操心实现，子代理自己读 `AGENTS.md` / `AGENTS-RULES.md`。
> 批次间**严格串行**（单写者：共享 `dist/` / `cache.db` / `.agent-io/design/`）；批次内 1 写 + ≤2 读。
> 排序原则：**止血 → 仪器 → 收束主线 → 正确性 → 测试体系 → 大件 → 治理**。

### ★ 主线回路（2026-11-02 用户定义 · **本轮所有新任务都落在这里**）

> 用户原话：*「设计 DSL 是缩略版的设计 DB，你能在里面定位到设计 DB 里那个权威功能在哪，然后直接找过去。
> 要改/加功能，就对需要变的那段设计线做结构化重写。重写后设计 DB 里这条线的设计就变了，
> 实际重写依托它，**只测一次**。」*
> **对拍配对（已确认）**：设计 DB ↔watch↔ 实际 DB · **设计 DSL ↔对拍↔ 实际 DSL**
> ★ 我 21:00 前把它搞成"设计 DSL ↔ 实际 DB"，**那是错的，已撤回**；且 `diff_views` **不能删**（它就是对拍端）。

| 步 | 环节 | 现状 | 断在哪（已实测） | 判据 |
|---|---|---|---|---|
| **①** | **定位**（功能 → 设计侧权威） | 🔄 `613a8652` 在跑（`get_dsl query=locate`） | **能力原本不存在**：`explore_code` 12 个 action 里没有"功能→在哪"这个方向；`get_dsl query=files` 要 feature、`brief` 要 node_id、`capability_map` 只到目录级 | 三组已知重复（读三入口 / 搬家四件套 / 两个对拍）必须互相返回为 top 候选；**空匹配必须显式说"无"**；输出必须带"这是候选不是判定" |
| **②** | **设计侧结构化重写** | ⏳ 依赖 ① | 定位不到 ⇒ 第一步只能"新建" ⇒ **12 写口 / 4 个新 domain 模块 / 45 次人工修整运动**（`RETIRED.md` 记账）都是这么来的 | 卡里必须写「我定位到的原节点是 X，为什么不能改它」；**答不出不许开工** |
| **③** | **⑤ 投影忠实**（DSL→DB） | ⏳ 新账 | **DSL 319 条判据 → DB 只接住 96 条（30.1%）**，且只有 `kind=call-exists` 一种；其余 223 条（file-exists / symbol-exists / signature-matches / source-has / run / behavior-cases / edge-*）**DB 里一条没有** | DB 判据数 == DSL `expectations` 数（现 96 vs 319） |
| **④** | **⑥ 实际重写**（DB→源码） | ⏳ 新账 | 覆盖 **82.1%**（384/468）；**沉默缺口 87 个**（盘上有 ∧ 册上无 ∧ 无 excluded_reason），含 `design_db_projection.ts`、`judgement_run.ts`、`plan_exit_check.ts`（**设计 DB 自己的实现**）；`conflict=1` ⇒ **基线不可前移** | 沉默缺口 → 0（逐个裁"纳入 / 显式排除+理由"）；`conflict` → 0 且基线可前移 |
| **⑤** | **对拍**（设计 DSL ↔ 实际 DSL） | ⏳ 需改口径 | `diff_views` 是**全 feature 全量比**（446 vs 555 文件 ⇒ 新增 110 / 修改 141）⇒ 噪音吞掉信号；且**按"相等"对拍永远不可能成功**（域不同 · 粒度不同：差异 86% 来自文件数差 109，不是同文件符号差） | **域** = 设计侧声明域（其余进"未覆盖"，不算差异）；**粒度** = 只比声明过的符号；**关系 = 声明 ⊆ 实际**（设计是实际的**下界**不是镜像）；输出**三态**（未实现 / 已实现 / 未声明实现），**零"说不清"** |

**配对的推论（要写进设计，别再搞错）**：
```
设计册装**意图**：146 decision 的 reason + 319 条判据 + layers(8) + overlay + 84 张 task
设计 DB 装**结构**：symbols 5,047 · expected_symbols 3,278 · calls · imports   ⇒ ⑥ 结构重写够用
⇒ 「DSL 没用」的感觉 = ③ 投影不全（30.1%）+ ⑥ 之后只读 DB 的错觉，**不是 DSL 冗余**
```

---

### 支撑队列（原「批次 0–6」· 编号不变 · 归属变化见下）

> **编号保留**是为了不丢已交付的账（0.1/0.2/0.3/1.0/1.2 都已 ✅ 并带读数）。
> **归属变化**（本轮新增/覆盖，勿重复做）：
> ```
> · 2.1 里的 `diff_views` **不删**（它是对拍端）—— 删掉的那 5 个照旧
> · 1.1（最小权限）与 6.2（行为卡卡位）与 T-#PLAN-CARD-MULTIFILE ⇒ **同一件事**，合并进「写闸 = scope ⊆ 坍缩集」
> · 批次 5（slice3 S1/S2/S3）⇒ 口径被 `docs/DESIGN-ARCH-REDESIGN.md` 修正为**册变投影（事件为源）**，降级到主线⑤之后
> · 4.3（声明覆盖率）⇒ 并入主线③（判据投影）
> · 新增：**CodeHealth 重设计**（四类：克隆 / 文件级规模 / 耦合与不稳定度 / 设计坏味道）—— 见 §二 支撑治理
> ```

### 批次 0 · 止血 + 最小仪器

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 0.1 | ✅ **`edit_code` 批量幂等** | 已交付：根因=`already_applied` 只在 old 找不到时才被问，而插入式替换 old⊂new ⇒ 永远"还在" ⇒ 再插一遍。读数：改前行数 4→5 + sha 变 + 同一行两遍 → 改后 `applied:[]` / `already_applied:1` / sha 不变；真歧义仍拒。新证 4/4 | 写 | ✅ |
| 0.2 | ✅ **`npm run verify:clean`** | 已交付：`git clone --no-hardlinks` + `npm ci` + 三条保真断言；**复用 `verify.mjs` 的 `GATES`/`run()`**（门名单一处权威）；`ci.yml` 的 `run:` 是扫出来的。读数：干净环境 **15/19 步可绿（红 4）** | 写 | ✅ |
| 0.3 | ✅ **单条 `replace_text` 的同族洞** | 已交付：判据抬进 `planReplaceText`（单条 / `targets[]` 批量 / `apply_refactor_plan` 的**唯一汇合处**）⇒ 单条那条腿也问 `classifyReplaceTextApply`，批量的私货调用已删（`edit_code.ts` 里调用点 2→1）。读数：改前 RUN2 `written=true` · 行 2→3 · sha 5fb142c2→647be80d · `B` 出现 2 次 → 改后 RUN2 `written=false` · `already_applied={line:1,how:inside-new-text}` · sha 不变 · 仍 1 次；真歧义仍拒 / 真不匹配仍报未找到。新证 6/6 | 写 | ✅ |
| 0.4 | 新测试 `p0_edit_code_batch_idempotent.test.ts` **没有 DSL 节点卡**（既有测试多数有） | 给它建节点 + 至少 1 条语义判据 | 写 | ⏳ |
| 0.5 | ★ **`实现夹具` 门会抖（真 bug）**：冷 `cache.db` 下 `fileFacts().deps` 为空 ⇒ `impl-fixture.mjs:47` `realDep=undefined` ⇒ `normPath` 崩溃（删 cache.db 后 **3/3 必崩**）；而 `MCP 工具签名` 会顺手建出 60.7MB 的它 ⇒ **红绿取决于门序（3 次里 1 次红）** | 删 `cache.db` 后连跑 3 次 ⇒ 3 次同结论（不许靠门序）；缺数据要**报 unsupported + 说缺什么**，不许崩 | 写 | ⏳ |

### 批次 1 · ~~收逻辑写口 12 → 1~~ ⇒ **最小权限（只读工具不得写）**

> ★ **2026-11-02 20:15 结论修正（主控自查，推翻原计划）**
> 原计划"收逻辑写口 12 → 1"**测错了对象**。真相（已核）：
> ```
> · 写授权**早就唯一**：saveDSL#assertDslWriteAllowed（注释明写"唯一住处，别在别处再判一次"）
> · DslWriteVia 是**四值闭集**：edit_dsl / import / tool / derived —— 每类都有语义，
>   派生写端为什么不能只靠 tool，理由写在 dsl_write_scope.ts:52-58（serve.ts 直接 import 它们，
>   走 HTTP 时没有 invokeTool 作用域）
> · server_registry.ts:856 **无条件**给每个 MCP 工具发 via:'tool' 授权
> ⇒ 那"12 个入口"不是 12 个后门，是 **4 类合法写端**
> ```
> **我原计划的错**：把"不经过 L1–L4"当成"没门禁"。而 L1–L4 是**变更理由**闸——
> 派生写（dag_layout/opl/snapshot/arch_layer/monolith）与扫描写（import）**没有人给理由可填**，
> 要求它们填理由 = **逼它们造假理由**（比不填更坏）。
>
> **真正的问题（更准、且可机械验证）**：**最小权限缺口** —— 只读工具也持有写授权。
> 只读工具的 bug 能写册，只在事后 `_sync.via` 留名，**不能事前拦住**。

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 1.0 | ✅ **写口 ③–⑥ 定性**（原计划的那一步） | 四条**全 C（必须独立）**，无一该收：③ `import_project`(`via:'import'` @1378，640 节点扫描产物无 op 可表达) · ④ `sync_contracts`(`via:'tool'`，**唯一真缺口已修**) · ⑤ `opl`(`derived`，实现体在 impl_root 不在索引 ⇒ 走 `type=file/add` 会被 T20 拒) · ⑥ `arch_layer`(`derived`，`persist=false` 默认不写)。★ 独立复现：普查列的行号里 **3 个是注释**。新判据 `tests/p0_dsl_write_ends.test.ts` **改前 3/5 → 改后 5/5** | 写 | ✅ |
| 1.1 | 给每个 MCP 工具标 **`writes: true\|false`**（一处权威，住 `ToolDef`），并断言 `writes:false` 的工具在 `saveDSL` 处**抛** | 拿一个只读工具（如 `get_dsl`）在夹具里让它写册 ⇒ **必须抛且点名**；改前会成功并只在 `_sync.via` 留名 | 写 | ⏳ |
| 1.2 | ✅ **四类 via 的边界已核**（"写口归属"的唯一清单不再手维护）：`grep runDslWriteScope(` 实测 **12 处** = edit_dsl 1 · import 1 · tool 2（server_registry + sync_contracts）· derived 8 | 清单由 grep 产出、与代码同步；`edit_dsl` 是 **intent 写**的唯一一处 | 读 | ✅ |
| 1.3 | 收编 `openPlansForRead`（第 3 套开库口径） | `openTasksDbForRead` 成唯一读口 | 写 | ⏳ |
| 1.4 | **`dsl_write_scope.ts:15-20` 头注表漏登记**：该表自己写着「只有这几处，加一处就要在这里登记」，而 1.0 新增的 `sync_contracts.ts:174` 没登记 | 表与 `grep runDslWriteScope(` 结果逐条对得上（12 处全在表里） | 写 | ⏳ |

### 批次 2 · 工具面收束（44 → 16）

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 2.1 | 删 **5**：`contract_page` `annotate_functions` `diagnose_loop` `go_originals` `first_hop_args`+`next_hop_args` ★ **`diff_views` 撤回不删**（2026-11-02：它是对拍端，见 §一 主线⑤） | 每个"原场景谁接住"具体到 query/action；wire 下降；`承诺−契约` 差集仍空 | 写 | ⏳ |
| 2.2 | 搬家四件套并 1（`rename_symbols`/`rename_files`/`move_symbol`/`move_domain` → `move`） | 先录等价基线；四个旧名能力逐条可复现 | 写 | ⏳ |
| 2.3 | **事实册读端合并**（`read`/`facts`/`search`/`refs`/`symbols` → 一个，3+1 的第 4 入口） | 同一查询新旧两路 deep-equal | 写 | ⏳ |
| 2.4 | 删 `capability_map.WHEN_OVERRIDES`（37/44 手写描述**已漂**，`refactor_judge` 那条写错） | 导航描述一律从 `ToolDef` 派生 | 写 | ⏳ |
| 2.5 | **分母口径**：每个覆盖率/规模数必须自带"回答哪个问题"；同一问题两处出现即红 | 95.3% 与 82.1% 不再都被叫"覆盖率" | 写 | ⏳ |

### 批次 3 · 正确性缺陷

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 3.1 | `drift` 3 处 + `design_line` schema 补 `code_dir` | 异机 `source_root` 夹具下 `path_base===project_dir`；删文件 ⇒ missing | 写 | ⏳ |
| 3.2 | `fuzzy` 四件：正则点名 · **唯一性跨级合并**（L2⊆L3，代价 0.98%）· 后门带 `fuzzy_mode` · 改掉钉住错误行为的测试 | 同内容两处缩进不同 ⇒ 报歧义；消融后有用例变红 | 写 | ⏳ |
| 3.3 | `editCodeBody` 单文件回滚（5 落点 → `land()`；`close()` 进 `finally`）+ `getLiveFeature` 的 `catch→null` | 注入"写半截再抛" ⇒ 逐字节还原；全仓 0 处沉默折叠 | 写 | ⏳ |
| 3.4 | `db.ts` 四处：mkdir/PRAGMA 进 try · 按 errcode 分派文案 · `schema_versions` 证据可改 · 死导出真删 | 四夹具文案两两不同且各含路径 | 写 | ⏳ |
| 3.5 | `storage.ts:523/585` 缺注册表**拒绝+点名**；`listArchiveEntries` 分母进 payload | 三态文案互不混同 | 写 | ⏳ |

### 批次 4 · 测试体系

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 4.1 | **修 CI**（依赖 0.2）：删死步骤 `archify`（`third_party/archify` 不在仓里）；"输入不在 git"三类逐一处置；失败打印「哪道门 + 缺什么」 | CI 三平台绿；红时可直接定位 | 写 | ⏳ |
| 4.2 | **时长棘轮** + **test smells 静态检测**（AR/DA/MNT/ET） | 中位数 × 相对阈值；smells 零执行秒级 | 写 | ⏳ |
| 4.3 | **声明覆盖率**（册 `expectations` ∪ `tests`）：两者都没有的模块 ⇒ 红 | 给出"既没判据也没测试"的模块数与名单 | 写 | ⏳ |
| 4.4 | **静态可达闭包 → 增量选择 L1/L2**（`touches:` 靠手写是漏的：实测 3 文件改动命中 **0**） | 选中集非空且给分母；共享资源强制全量 | 写 | ⏳ |
| 4.5 | **变异分数**（`mutate.mjs` 从判据扩到测试套件，只跑闭包内） | 先量当前 mutation score | 写 | ⏳ |

### 批次 5 · 架构（大件）

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 5.1 | `decision_history` 拆出（占册 **55%**，12.44MB → ~6.5MB） | `exportBook` 逐字节等值；记 `history_pos` | 写 | ⏳ |
| 5.2 | slice 3 **S1 影子库** | 4 本册逐行 sha256 全绿；回滚 = `rm design.db` | 写 | ⏳ |
| 5.3 | slice 3 **S2 读按实体**（9 调用点） | 新旧读者 deep-equal | 写 | ⏳ |
| 5.4 | slice 3 **S3 写进库 + 册变导出物 + `_dsl_rev` 退役** | `exportBook` sha256 等值；**同 feature 两卡两进程同时写都成功** | 写 | ⏳ |

### 批次 6 · 任务面 + 治理

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 6.1 | **任务面普查**：72 张 `candidate` 卡是什么 · 完成的卡去哪了 · "节点有工作" vs "待办卡"要不要拆字段 | 三问各给读数 | 读 | ⏳ |
| 6.2 | **非文件级改动的卡位**（写闸只认文件节点 ⇒ 跨文件行为无卡承载） | 方案 + 判据 | 读 | ⏳ |
| 6.3 | **daemon 启动自检**（`STALE_BUILD` 今天复发 3 次） | 陈旧即拒服务并打印原因 | 写 | ⏳ |
| 6.4 | **备份自动化**（`.git` 复制 + **真恢复演练**；`bundle` 在 shallow 仓上是**假备份**） | 恢复后提交数一致 | 写 | ⏳ |
| 6.5 | `index_integrity` 判据范围（`untrusted` 永远清不掉） | 正常态可绿；改 `.ts` 红、改 `.md` 不许红 | 写 | ⏳ |
| 6.6 | `AGENTS-TESTS.md`（测试八条规约）+ `docs/SPEC-test-quality-framework.md` | 每条可判真假 | 写 | ⏳ |

---

## 二、欠账（按主线四段分组 · 只列**没做**的）

### ① 设计（册 / 判据 / 契约 / 归位）

| 编号 | 欠什么 | 在哪 |
|---|---|---|
| T-#DECISION-IN-BOOK | 改动判据要写成册里的 `decision expectation`（`cert:` 形态不登记判据种类 ⇒ 强度按 unknown，画布永远留 1 个缺口） | `docs` + `edit_dsl` |
| D-#EXPECTATION-VOCAB | 判据词表与宿主不可见：`decision.expectations` 只在 `type=node`；`evidence` 形状应全部进 `--schema` | `dsl_ops/op_data_spec.ts` |
| D-#EDIT-DSL-ERR-LAYER | `edit_dsl` 报错**不说"在哪一层"**（`edge.add 需要 id` 连报 3 次，id 实际在 op 信封） | `dsl_ops/*` |
| D-#GOALS-SHAPE-DOC | `goals` 真实形状 `{id?,title*,description?,status?}` 没文档，与直觉 `{id,text,why}` 不符 | `design_intent` |
| D-#EDGE-INTENT-MATCH | `edge_intents` 用 `from`+`to` 匹配不到新加的边，必须用边 id ⇒ 3/3 全"未匹配" | `design_intent.ts` |
| D-#SCHEMA-FULL | `tool --schema` 输出被截断，关键信息在工具描述里 | `presentation/cli/*` |
| D-#PLAN-CERT-REF | 计划闸不认 `cert:` 引用 ⇒ 只能靠 `AGENT_IO_REQUIRE_PLAN=0` 放行 | `rewrite_plan.ts#planJudgementGaps` |
| D-#CERT-EXP-UNSUPPORTED | kind=`cert` 在 `judgeExpectations` 里判 unsupported（证独立跑 4/0）⇒ 卡无法用它收口 | 判据执行核 cert 分支 |
| D-#BOOK-MIRROR | 设计册与事实册同构（R1 键集合相等 / R2 id 同源 / R3 人只写意图） | `gen-db` + DSL schema |
| D-#ONE-AUTHORITY | 同域同一行为只能一个权威处（`range/switch/append/delete/len` 各有两份实现，一天三次"修一份等于没修"） | 判据派生 + write_gate |
| T-#GATE-IMPACT | 写闸自动附带波及（现靠模型自觉）；先只读数，再升级为"高风险必须带 evidence" | `rewrite/*` · `edit_code` |
| T259 | 判据够不着接口成员 / 对象键 | `intent/expectations.ts` |
| T261 | `edge-absent` 当"不许合并"的代理，间接且脆 | 同上 |
| T262 | `type-only import` 不建边，相关断言不可表达 | `index/` |
| T331 | `acceptance` 没翻成 `expectations` 就永远不会被做 | `query_feature.ts` |
| T329 | 决策卡加 `scope` 引用（50 张 0 张有） | `geometry.nodes[].decision` |
| T118 | 决策卡记"是谁提的"（12 张有 `author`，49 张有 `agent`） | 同上 |
| T127 | 一致性闸门的"谁会信它" | `intent/consistency.ts` |
| T107 | 意图 / 搬运 / 关联三层判据 | — |
| T146 | 给常见任务各编一条链 | — |
| T43 | 通用多语言组件框架（研究） | — |

### ② 改写（改代码 / 重构 / 写闸）

| 编号 | 欠什么 | 在哪 |
|---|---|---|
| T-#RP-1 | 重写计划闸：① 拿真实任务量一次严格档的**误报率** ② 调 `planGaps` 粒度 | `write_gate.ts` · `rewrite_plan.ts` |
| T49 | 写用户源码没有单一可检查通道 | `apply_writes.ts` |
| T162 | `edit_code` 是否进 refactor 的 `direct` 名单 | `server_registry.ts` |
| T240 | `apply_literals` 不在工具 schema（只有 `report_literals`） | `rename_symbols.ts` |
| T231 / T152 | 注释 / 字样一并改要不要出声；注释算不算引用 | `rename_symbols` |
| T126 | `Touched` 是否加「类型」锚点 | — |
| T125 | 「备菜」+ `mode=field` 缺「所属」限定 | `refactor/` |
| T119 | 统一的「这次处理哪些」入参 | — |
| T-#CERT-1 | 无证工具补证 —— **顺序已纠正：先收敛后补证**（收敛在批次 2） | `docs/tool-convergence.md` |
| T235 | `docs/*.md` 的目录分组口径 + 2 处功能线 thread | `docs/` |

### ③ 翻译（Go→TS）

| 编号 | 欠什么 | 在哪 |
|---|---|---|
| T-#MECH-METHOD-CALL | **最大剩余簇**：`TS2339 ×250` + `TS2304 ×108`（方法调用没改写）。**先读 3 处产物 + Go 原文再定** | `body_pivot.ts` + `ts_codegen` |
| T-#TSC-DRIVEN-FIX | 用 tsc 报错当接收者类型口径，确定性改写 `recv.Prop(args)` → `Type_Prop(recv,args)`（预期打掉 ~265） | 新增后处理 |
| T-#LEGACY-IF-INIT | legacy 丢 `if err := f(); err != nil` 的 init（128 个 TS2304） | `body_mech.ts` |
| T-#KILL-LEGACY | **最大结构债**：`body_mech` 两套路径并存（pivot + legacy ~500 行）；按规则组迁完删 legacy，保持 `t447`+`t441` 双绿 | `body_mech.ts` |
| T-#BOOK-STALE | ★★★ 册子是**隐藏的过期层**：`translatorFp` 必填 + `writeBook` 校验 + `loadFreshBooks()` 不符即拒用 | `book.ts` + `project.ts` + `fingerprint.ts` |
| T-#REGEN-NONDET-DIAGNOSED | 抖动根因 = `AGENT_IO_TSC_FIX=1` 把修好的体写回缓存 ⇒ **评测一律 `--no-fix`**；fix 结果要进独立层 | `regen-translate.mjs` |
| T-#NAMED-RESULTS | 命名返回值没建模（`alive, dead []string` ⇒ TS2304 + 裸 `return` 丢返回值） | `go_extractor.ts` + body |
| T-#EMBEDDED-FIELD / -2 | Go 嵌入字段没建模（`CachedNode.graphNode` 整行丢失）；**改动走的是幽灵路径，先用探针证明"改这里会改变产物"** | `go_extractor.ts` |
| T-#MECH-TYPES | 机械翻缺**类型环境**（`/` 整型 vs 浮点） | `body_mech.ts` |
| T-#SHIM-VALUE | 垫片只收类型位置的 `pkg.Name`，体内值位置收不到（TS2304 ×789） | `project.ts` |
| T-#METHOD-CALL | Go 方法被翻成自由函数但**调用点没改写**（TS2339 ×457） | `body_mech.ts` |
| T-#LAYER1-WIRE | 第 2 层消费册子（`types` → `renderTsType`；`external_deps.strategy` → import 行） | `ts_codegen/project/body_mech` |
| T-#ONE-ASSEMBLY | 单文件模式与项目模式是**两条装配路径**，册子消费只接了后者 | `tool.ts`/`project.ts` |
| T-#MECH-ANON-STRUCT | 匿名 struct 位置式字面量（TS1005 已归零）；**省 `as struct{}` 断言不行**（试过 22→372 / 22→535，已撤回） | `body_pivot.ts` |
| T-#TS2304-REMAIN | 补 import 后剩 90 条：`contractGatePolicy`(const) / `cancel` / `_`(空白标识符) / `httpResp`(局部) | `body_pivot.ts` |
| T-#BODY-IR-EXPAND | 体 IR 扩面（竖切 90/624 = 14.4%），每铺一类保 `t447`+`t441` 双绿 | `body_pivot.ts` |
| T-#SHIM-SITES | `copy()` 真正的位置（现 0/109：机制通了数据没生效） | `body_pivot/body_mech` |
| T-#SHIM-MORE | 更多槽垫片：`conc.csp` / `err.tuple` / `null.explicit` | `slots.ts` |
| T-#STD-TAIL | std 余下小包适配（11/33 已完成，覆盖 ~86% 引用） | `go_std.ts` |
| T-#PIVOT-TYPEREF-IDS | pivot 的 `ident.name` 仍是源侧文本，未解析成轴心 id（第三语言到来前必须解决） | `book_ts.ts` |
| T-#PIVOT-RESULTNAMES | 轴心不存结果名（Go 命名结果名字丢失） | `book_ts.ts` |
| T-#FEATURE-MATRIX | 特色矩阵（8 语言 × ~30 构造）：发现轴心的 **Go 偏心**，按"多少语言需要"重排铺面 | `docs/` + `pivot.ts` |
| T-#EXTRACTOR-IFACE-METHOD | 接口方法不产出 unit（43 条）—— 要不要覆盖 = 产品决策 | `go_extractor.ts` |
| T-#T461-TIDY | t461 比对口径待收净（多半是口径问题不是代码问题） | `certs/t461` |
| T-#FILL-RUN | 全仓 LLM 填孔试跑（单文件已通） | `translate` |
| T-#FILL-MISS | 填孔失败集中在批中缺块 ⇒ 失败后自动降级单孔重试 | `fill.ts` |
| T-#TRANS-STAGE | 翻译册登记进 `stage_registry`（现在不参与保鲜链，代码变了它静默过期） | `stage_registry.ts` |
| T-#TRANS-GEN | `ts_codegen` 两处漏映射（泛型实参 / 参数名当类型）；孔体应改 `throw TODO(translate)` | `ts_codegen.ts` |
| T-#TERM-46 | 册子 46 个未覆盖术语待人定 | 语料册 |
| T-#BOOK-DUPLICATE-AUTHORITY | **两处册子**（语料侧 vs 仓里）⇒ 迟早分叉，待决策归属 | `.agent-io/design` |
| T-#CORPUS-DB-SEMANTIC | 语义事实补齐是**一次性手工动作**，没进自动流程 | `semantic_facts.ts` |
| T-#PKG-BARREL-NEXT | barrel 之后下一批缺名（`memory`/`norm` 等包级引用） | `project.ts` |
| T-#SHADOW-USES | 裸写 `Error(...)` 在别名后静默命中 JS 全局 | `fixers.ts` |
| T-#LEN-MAP-TYPED | `len(x)` 要区分 Map(`.size`)/Array(`.length`)；内联三元实测更差（546→584） | `translate/` |
| T-#BASELINE-1010 | 把「零 LLM 回放 = 1010 错」定为**棘轮基线** | `certs/` |

### ④ 重写（从册生成）

| 编号 | 欠什么 | 在哪 |
|---|---|---|
| T-#FIELD-LEDGER | 字段账入库（`fields` 表）+ 设计 DB 展示 + "声明了但从未写/读"判据。★ **明确不做**字段级流转链（B 档，数周） | `certs/t457` · `go_extractor` · schema |
| T-#GO-FACTS | 用语义层（`go/types`）当 oracle 替代手写解析：spike 已通（`defs 5704 / uses 23532 / selections 4427`）；入库 + 对拍未做 | `go_extractor` · `index/schema` |
| D-#EDGE-DERIVE | 边派生已退役 ⇒ **不要**把 1382 条 import 边灌进 DSL；正解是按需派生视图 | `design/derive/*` |

### 支撑 / 治理（不是主线四段，但要有人管）

| 编号 | 欠什么 | 在哪 |
|---|---|---|
| T-#TASK-L1-RELEASE | ★ **L1 卡（无 decision 的节点）立卡后无法 release/void** ⇒ 卡永久卡在 `preparing`（占位死卡） | `task_machine.ts` + task 写端 |
| T-#NODECARD-NOT-IN-DB | ★★★ **账目错误（2026-11-02 普查实测）**：今天 **22 张 done 卡全部落在设计册 `geometry.nodes[].task`，不进库也不进历史** —— `live_cards` 只有 3/22，agent-io 的 83 张节点卡 **0 张在库**，`task_history` **0 行**。吞卡步：`withCardWritten:402-419`（`todos[]` 无同 id ⇒ **只写 `node.task`**）+ `shadowSyncTasks`(storage.ts:518-534) 只同步 `dsl.todos`，而 `dsl.todos` 又从库读回(storage.ts:584) ⇒ **库↔册闭环，`node.task` 永远进不了库** ⇒ 任务面所有计数（overview / pending / pool）都**漏掉节点卡** | `task_ops.ts` + `storage.ts` |
| T-#NO-CARD-INVISIBLE | ★★ **85% 的节点既没卡也没进度锚点，系统看不见"有活没立卡"**：agent-io 546 节点 / 83 有卡 / 81 有 overlay 锚点 ⇒ **464 个（85%）两样都没有**；`pending` 口径明写"未登记 progress 的锚点不算欠账" ⇒ 这批活**永远不进欠账** | `task_schema.ts#progressOfNode` + `pending` 口径 |
| T-#PLAN-CARD-MULTIFILE | 行为卡无卡位 = **设计使然**（卡主键=节点 id，`write_gate.ts:1924-1931` 逐文件查 claimed 卡）；**但 `plans` 已支持一卡多文件**（PK=(feature, card_id, **file**)，46 卡/68 行，最多 8 文件/张）⇒ 现成能力没接上。最小改法：`write_gate.ts:1919-1932` 增加来源「该文件在 `plans` 有行 ∧ card_id 已 claimed ∧ owner===actor」，A7 的 owner/代际/心跳三段原样复用 + 消融证（owner 不匹配仍拒） | `write_gate.ts` · `rewrite_plan.ts` |
| T-#CODEHEALTH-DIRECTION | ★★ **CodeHealth 方向错了（实测 7 个 kind 全是局部/表层）**：`unused_export` `unused_import` `orphan_file` `high_complexity`（**函数级**圈复杂度）`layer_violation` `circular_dependency` `sibling_import`。**缺的恰恰是本仓最痛的**：① 多处权威/重复实现（克隆 Type-1/2/3 可判、Type-4 只给候选）② **文件级**规模与复杂度（122KB 的 `refactor/index.ts`、8.8MB 的册；不是"函数内分支数"）③ 耦合与不稳定度（Martin Ca/Ce/I/A/主序列距离 D=\|A+I−1\|；CK 的 CBO/RFC/LCOM）④ 设计坏味道（**Shotgun Surgery / Divergent Change**，判据用「**指针复述目标而不是指向目标** ⇒ 复述必漂」—— 这条直接量我们的册）。★ 讽刺点：`cross_repo_symbol_index` 早报"双胞胎（同名同签）"，能力在隔壁、只查同名、没进 code_health | `src/domain/health_spec.ts` · `src/application/cross/index.ts` |
| T-#GW-STATS | 网关 stats 持久化写 0（内存对、文件 0）⇒ **该文件不能当进度读数**；我据此误判过并杀掉进程 | `llm_gateway.ts` |
| T333 | `fork` 没工具化；`npm run fork` 指向的脚本不存在 | `package.json` |
| T328 | 进度轴收归 `progress`@overlay | `storage_overlay.ts` |
| T-#98c | 数据家里旧落点副本（逐字节相同的由 watch 自动清；**不一致的只报** ⇒ 这两份要人看一眼） | 数据仓 |
| T149 | 索引候选序非确定性 | `index/` |
| T132 | 索引读数 429/424（索引数 > 磁盘数），缺「文档」桶 | `index/` |
| T242 | 索引「保鲜 / 完整性」判据收口 | `index_freshness.ts` |
| T66 | 入口保鲜与陈旧告警 | 同上 |
| T153 | DSL 走查结果 | — |
| T148 | 「卡几次」随数得细不细而变，不是精确尺（方法论） | — |
| T237 | `.inspect/` 一个目录干两件事（语法采集 + 摆证残留） | `.inspect/` |
| T-#94d | 浏览器 bundle 里 `typeof X === "function"` 的宿主名靠表兜 | `symbols.ts` |
| T-#94f | IIFE bundle ⇒ 契约面为空（`is_closure` 全打上） | `import_project.ts` · `kernel.ts` |

### 探针与语言包（`observe-lang-*`）

| 编号 | 欠什么 |
|---|---|
| T285 | Go `uninstrument` 后残留空 `internal/` |
| T305 | `lint` 对「打断宿主」类问题 |
| T308 | Go 侧区间替换重叠 |
| T309 | 插桩报告把「0 探针文件」算进「已跳过」 |
| T310 | Go ledger 无 `functions` 计数 |
| T312 | Python scope / deep 模式未实现 |
| T313 | Python 侧没有行为证 |
| T320 | 探针运行时不会自动拷进被测工程 |
| T282 | class getter/setter 同名探针 |
| T284 | class 静态块 / 字段初始化器未插桩 |

---

## 三、已裁定**不归本仓**（记着别捡回来）

```
无限递归子代理 / 三席 / 交接单   → DSH 插件侧
判据自进化                      → 记忆库侧
沙箱 / 题集 / runner            → 沙箱 + 换代侧
蓝绿换代                        → 换代侧（不是现在）
事故台账                        → 撤（记忆库侧做）
```

## 四、基线读数（别漂；掉了就是回归）

```
工具面 wire     215,158 → **162,299 B**（−24%）
判据总数        **475 条** 0 红      ← 掉了 = 被 decision.update 全量覆盖
测试            **61 文件 / 282 用例**（0.1 后 +1/+4 · 1.0 后 +1/+5）
待收写口        12 → **9**（①design_intent ✓ ②archive ✓ ⑫serve 实为误判）
全量 verify     **383 s**  ｜ 增量 **4.8 s**（82×）
CI              **从 10-27 起每次 failure**（archify 死步骤 + 数据不在 git）
备份            `C:\agentio-backup\dotgit-20261102-1540`（57.3 MB，**已验证可恢复** 2010=2010）
远端            origin/main = 本地 HEAD（410 提交已推）
```
