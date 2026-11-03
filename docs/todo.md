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

#### ★★ 验收怎么做（2026-11-02 修正：我一直在"自己动手"，那是错的）

> 用户原话：*「要么疑人不用用人不疑，要么你就让别的子代理交叉验证。你自己去老动手做啥。」*

**病**：我采信一半，于是自己跑 `verify` / 自己 grep / 自己核读数 —— 两头不讨好：
既没做到用人不疑，也没让对方独立复算，还烧掉自己的上下文。
**而今天至少 6 次被纠正，没有一次是我自己反省出来的** ⇒ 我自己复核 = 用同一套被污染的假设再想一遍。

| 卡的类型 | 验收方式 | 我做什么 |
|---|---|---|
| **常规卡** | **用人不疑**：采信回报 → 记录 → 派下一张 | **不跑命令、不 grep** |
| **关健卡**（**闸 / 写盘 / 数据丢失 / 架构** 四类之一） | **派验收席**（`seat_acceptance` 或独立只读子代理）：只给「判据 + 产物在哪」，**不给结论、不给我的推理** | 读它的裁决 |

**我动手只保留两处**：① 判"这份回报自洽吗"（只读它的读数，不跑命令）② 需要拍板时（如零值表 `'null'` vs `null` 这类语义裁决）。

★ 为什么必须这样：本仓**已经有** `seat_acceptance`（只读工具面 + **不能向下委派** ⇒ 独立性靠机制，不靠它自觉），
  而我一次没用过 —— 一直用"我自己跑一遍"冒充"独立复核"。

**★★ 派卡模板三条（2026-11-03 定 · 三条都来自当天实测）**
1. **长任务分三段，每段跑完立刻 `send_message` 回报** —— 别全压到最后一次性交。
   实测：`75cfe8f6` 断网时已跑完 build/gate，但因为它攒着没报，我一度以为读数全丢。分段后即使死在中途也只丢最后一组。
2. **"无遗言失败" ⇒ 先 `send_message` 续，不要重派** —— 多半只是断网。
   实测两次：`029135c9` 其实活着并交付了；`75cfe8f6` 只是断网，续上后 9 条读数全部跑完。
3. **验收拆两个角色**（见 `T-#SEAT-NO-SHELL`）：`seat_acceptance` 判**语义真假**（无 shell，跑不了门）
   ＋ 派"读数员"只跑命令抄原始读数（**不做判断、不许修红**）。
   ★ 首次实测：席 **12 PASS / 0 FAIL / 5 UNKNOWN**，那 5 条 UNKNOWN 全是"跑不了命令"，不是卡的问题。
   ★ 且读数员必须**只跑不判**：两位读数员给出的 `git status` 逐行相同 ⇒ 工作区状态被交叉验证。


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
| **③** | **⑤ 投影忠实**（DSL→DB） | ⏳ 新账 | **DSL 的判据在投影进 DB 时大面积丢失**（只接住约三成），且**只有 `kind=call-exists` 一种**进了 DB；其余 kind（file-exists / symbol-exists / signature-matches / source-has / run / behavior-cases / edge-*）**一条都没有** —— ★ 两个数都必须**现算**：比 `.agent-io/design/*.dsl.json` 的 `expectations` 总数 与 `design-db/*.json` 的 `requirements` 总数 | DB 判据数 == DSL `expectations` 数（**现算，脚本给数；别抄**） |
| **④** | **⑥ 实际重写**（DB→源码） | ⏳ 新账 | 覆盖 **82.1%**（384/468）；**沉默缺口 87 个**（盘上有 ∧ 册上无 ∧ 无 excluded_reason），含 `design_db_projection.ts`、`judgement_run.ts`、`plan_exit_check.ts`（**设计 DB 自己的实现**）；`conflict=1` ⇒ **基线不可前移** | 沉默缺口 → 0（逐个裁"纳入 / 显式排除+理由"）；`conflict` → 0 且基线可前移 |
| **⑤** | **对拍**（设计 DSL ↔ 实际 DSL） | ⏳ 需改口径 | `diff_views` 是**全 feature 全量比**（446 vs 555 文件 ⇒ 新增 110 / 修改 141）⇒ 噪音吞掉信号；且**按"相等"对拍永远不可能成功**（域不同 · 粒度不同：差异 86% 来自文件数差 109，不是同文件符号差） | **域** = 设计侧声明域（其余进"未覆盖"，不算差异）；**粒度** = 只比声明过的符号；**关系 = 声明 ⊆ 实际**（设计是实际的**下界**不是镜像）；输出**三态**（未实现 / 已实现 / 未声明实现），**零"说不清"** |

**配对的推论（要写进设计，别再搞错）**：
```
设计册装**意图**：decision 的 reason（为什么）+ expectations（什么算对）+ layers + overlay + task 卡
设计 DB 装**结构**：symbols / expected_symbols / calls / imports   ⇒ ⑥ 结构重写够用
★ 两者的**条数一律现算**（设计册读 `.agent-io/design/*.dsl.json`，设计 DB 读 `design-db/*.json`）—— 别在文档里抄数字
⇒ 「DSL 没用」的感觉 = ③ 投影不全 + ⑥ 之后只读 DB 的错觉，**不是 DSL 冗余**
```

---

### 清点作业（①b）的代价与工程形态 —— **已定，不再讨论**

> 用户 2026-11-02：*「我是个人开发，我要对整个项目负责，所以我们是全部扫。」*
> 并给出比例：本会话已用 ~495M tok，全扫 ~7.0M（优化后 ~2.7M）⇒ **1.4% / 0.5%，就是"多跑一轮子代理"**。

```
① scope **默认全项目**（个人负责全项目的场景）；"分部件"只是集体开发场景的用法
② 台账**全项目一本**——不许按部件分账，否则"跨部件重复"永远对不上
   ★ 重复最容易发生在**跨目录**（今天 4 个新 domain 模块的重复对象都在别处）
   ⇒ **跨目录必须比全量**；"目录内先比、跨目录只比代表项"是错的（会专门漏掉真重复）
③ 省成本靠「**候选只给符号表**」（签名 + 一行职责），不靠"少比"
   只有进 top-3、需确认时才读候选全文 ⇒ 全仓 ~7.0M → ~2.7M，覆盖不减
④ 工程形态 = **可断点续跑的后台作业**（台账 + 分批 + 进度 + 失败可重入）
   每批写**自己的 append-only 台账文件** ⇒ 不争写权，可与别的卡并行；主控只做进度 + 验收
⑤ ★ **机制自己的适应度函数 = 弯路率**：每 N 个提交统计"同一问题的第二处实现新增了几个"，
   台账建立后该数应趋 0。**它不降 ⇒ 台账没起作用，不是台账不够全**
```

**"值不值"的判据（已成立，不再重算）**：台账的钱 < 弯路的钱 ——
今天可数的弯路：写口普查前提错（3 个行号是注释）· 定位不到原权威而新建（后证多为重复）·
重复造 git-net（仓里早有 `net_probe.mjs`）· 6 次被外部纠正 · 45 次人工修整运动。

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
| 0.6 | ★ **同一事实两个结论**：`new-text-present`（新内容已在文件里）在**单条**是 `throw code=ALREADY_APPLIED`（错误），在**批量**是 `already_applied`（成功项）⇒ 两个出口对同一事实给两种结论（`0.16` 那一类） | 同一夹具：单条与批量对"new 已在但 old 不在"必须给**同一结论**（都成功项或都拒），且回执形状一致 | 写 | ⏳ |
| 0.7 | ★ **门失败时必须留得下门名**：`0.3` 卡实测"提交后第一次 verify 报 1 道门失败，**输出被截断、未留下门名**"⇒ 原因无法定位 | 注入一道必红的门 ⇒ `verify` 的**最后一行**必须列出失败门名（现在只给"1 道门失败"）；截断只许截门的输出，不许截门名 | 写 | ⏳ |

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
| T-#DEDUP-NEEDS-REGISTRY | ★★★ **查重不能靠相似度，只能靠封闭清单（2026-11-02 被 locate 自己证伪）**：`get_dsl query=locate`（VSM/TF-IDF）在 d 组实测**帮不上"防重复新建"** —— 四个新 domain 模块按功能描述查 4/4 指不到，且 git 考古确认**当时册里四个都不在**；同族证据：`diff_views` ↔ `drift` 词汇零重叠 ⇒ 纯词法抓不到语义克隆（Type-4 仍是开放问题）。**对照**：工具面有 `TOOL_DEFS`（封闭⇒可枚举⇒合并运动做得成）· 判据有册的 `expectations`（⇒ 能查"归属重复 0"）；而 **domain 模块 / scripts / tests 没有封闭清单** ⇒ 45 次人工修整运动主要就在这三类。★ **最小修法**：`structure.domains.json` + `structure_gap.unlisted` **已经在**，只是不当红灯 ⇒ **把 `unlisted` 变红**（比造相似度查重可靠且便宜） | `structure.domains.json` · `structure_gap` |
| T-#EXPECTED-DEPS-EMPTY | ★★ **第三处投影缺失**：`semantic.files` 的 **`expected_deps` 全 0**（主控复算：446 个文件里有 expected_deps 的 = 0）⇒ "设计意图侧的消费者"恒 0 条 —— **不是没查，是册里根本没写**。与主线③（319→96 判据丢失）同族 | `.agent-io/design/*.dsl.json` · `gen_design_db.ts` |
| T-#SEARCH-FIXTURE-HIJACK | `explore_code search` 的排位被 `examples/search/` **同名 fixture 目录**挤占（组1 实测 `search` 那次 top-1 是目录本身）⇒ 需要路径排除规则；★ 但排除清单不能散在工具里（会成第二处权威），该挂到域表/排除清单的一处 | `explore_code` · `structure.domains.json` |
| T-#KIND-PHASE-DUP | ★★ **`kind → phase` 同一事实住了两处，且两处注释都自称唯一**（清点机制在 40 项里抓到的第一处真重复，两个独立代理都命中）：`expectation.ts:211 PHASE_BY_KIND`（注释「唯一权威处」，`expectationPhase` 有 4 个调用者）vs `expectation_kinds.ts:71 KIND_SPECS[].phase`（注释「★ 11 种判据的唯一声明处」，导出的 `phaseOfKind()`:203 **零调用者**）。改后者不改任何判定 ⇒ 命中 0.9。**修法**：`PHASE_BY_KIND` 由 `KIND_SPECS` 派生（或反之），**删掉零调用的 `phaseOfKind`** | `expectation.ts` · `expectation_kinds.ts` |
| T-#INVENTORY-FORM-FORMAT | 机制 `validateForm` 判 `closed.includes(w)`，而 `closed` = `listItems()` 的**完整仓库相对路径** ⇒ `overlap.with` / `merge_into` 必须是 `src/domain/xxx.ts` 全路径。但脚本头注只写"只能取这里的项"，没写格式 ⇒ 我派卡时写成了裸模块名（被机制拒）。**修法**：头注写明「**完整仓库相对路径**」+ 一条夹具（裸名必被 `unknown_with` 拒） | `scripts/inventory-sweep.mjs` |
| T-#INVENTORY-NPM-ARGS | ★★★ **机制假绿（实测复现）**：`npm run inventory --dir X --ext .ts` **不转发参数**（npm 把它当位置参数）⇒ 脚本用默认 `src/domain` ⇒ 实测打印 `total=40 done=40 ✓`（**别人的台账**）。正确写法要 `npm run inventory -- --dir …`。⇒ **一条验收命令会静默跑错数据集并报绿**，铺到全仓时每个代理都会假绿。★ 副作用：跑一次会改写**别的目录**台账的 `updated_at`（我实测把 src-domain 台账 sha BAC1A02C 改成 57F98D7D）⇒ 必须还原。**修法**：脚本读不到 `--dir` 时报错退出（不许落默认值），或把默认值删掉 | `scripts/inventory-sweep.mjs` |
| T-#INVENTORY-MERGE-DIR | **机制缺陷**：`validateForm(form, closed)` 拿不到"本项路径"，于是用 `merge_into === with` 冒充"自己吞自己" ⇒ **「A 并入 B」这个自然方向无法表达**，只能反过来记在存活方。三个代理独立踩到（parse 1 次 / translate 2 次）。**修法**：把本项路径传进 `validateForm`，判 `merge_into === 本项路径` 才是自吞 | `scripts/inventory-sweep.mjs` |
| T-#EXT-TABLE-THREE | **同一集合三处落点**（已发生过漂移）：`source_exts.ts:36 TS_JS_EXTS` / `ast_node.ts:32 TS_EXTS:Set`（同 8 项）/ `import_resolve.ts:46 IMPORT_EXTS`（同 8 项，顺序=优先级）；`import_resolve.ts:38-39` 自述漂移史「漏了 .mts/.cts，T36 补齐」。★ 另有**同名不同义**：`ast_node.ts:32 TS_EXTS`=8 项 vs `source_exts.ts:49 TS_EXTS`=4 项（管"插桩能否用 as"）⇒ 取错静默放宽/收窄，**必须改名** | `source_exts.ts` · `ast_node.ts` · `import_resolve.ts` |
| T-#T447-DEAD-CRITERIA | ★★ **死判据（translate 清点时发现）**：`T-#KILL-LEGACY` 的验收条件「保持 t447+t441 双绿」**已不可执行** —— `certs/` 整目录在提交 `72335634`「删掉第三套验证」里被删，`t447/t454/t450/t445/t448` 只出现在 docs 与 src 注释里，**仓里无文件载体**。⇒ 一条验收条件指向不存在的文件 = 死判据。**修法**：改成 `scripts/audit-mech-parity.mjs` 对拍 + 一条 e2e | `docs/todo.md` · `scripts/` |
| T-#LEDGER-CORRUPT-LOSES-DATA | ★★★ **静默丢数据（机制里的，未修）**：`readLedger` 遇到坏 JSON ⇒ 只打 ⚠ 后「**按空台账重扫**」，而 `--submit` 仍会写盘 ⇒ **一次提交把整本已清点表单覆盖成空台账**。★ 这与当初"册损坏必须显形拒覆盖"是**同一个病**（册上修过、台账上又犯一次）⇒ 修法同款：坏 JSON ⇒ **拒绝任何写盘**并点名路径 + 备份原件 | `scripts/inventory-sweep.mjs` |
| T-#PITCH-STALE-CMD | 文档里的命令已漂：`docs/PITCH.md:345` 仍写 `npm run inventory`，现必须 `npm run inventory -- --dir … --ext …`（`--dir` 已改必填）。★ 典型「指针复述目标」⇒ 复述必漂 | `docs/PITCH.md` |
| T-#INVENTORY-TAKEBATCH-EXPECT | `[未核]` 机制里 `takeBatch` 的 3 条 DSL `behavior-cases` 的 `expect` 是"对象的 JSON 字符串"，修复代理本地回放**形态不符**（代码没动，属既有）；其余 12 条回放全过 ⇒ judge 自己的比较口径可能有问题 | `src/**` 判据 · judge 比较口径 |
| T-#OP-SPEC-NOT-SOLE | ★★ **`OP_SPECS` 不是 op 形状的唯一判据**（清点实测，5 处第二检查）：`update_feature.ts:1131-1133`（decision 的 op 白名单手写 + throw）· `task_ops.ts:3168-3170`（task_plan 只许 update + throw）· `task_ops.ts:4325-4327`（todo op 清单第二份 + 兜底 throw）· ★ 另有 **`update_feature.ts:914-916` 是空壳 `if`（无 throw）** —— T170 收敛后的残留，**读起来像判据其实什么都不做 = 假判据**。★ 已确认唯一权威的四处（好消息）：`lifecycle` 只 `assertLifecycle` · `gate` 只 `NODE_GATES` · 进度证据只 `validateProgressEvidence` · dsl_ops 层写授权只 `update_feature.ts:251` 一处 | `op_data_spec.ts` · `update_feature.ts` · `task_ops.ts` |
| T-#READING-SCOPE-PRECISION | ★ 读数必须自带**范围/分母**（A4 的实例）：清点代理写"**全仓**只有 `update_feature.ts:251` 一处 `runDslWriteScope`"，而实测**全仓 12 处**（它其实只在说 `dsl_ops` 层）。⇒ 措辞不精确的读数比没有读数更危险（会被当成"全仓唯一"引用） | 全仓读数口径 |
| T-#CORRUPT-AS-EMPTY-FAMILY | ★★★★ **这不是一个 bug，是一个模式（已三处同型）**：「**读失败 ⇒ 当空 ⇒ 整份覆盖**」——① 设计册（早先修过）② 清点台账 `readLedger`（今天修）③ **产物注册表 `registry.ts:62-64/:121-123`（未修）**：坏注册表 ⇒ `[]` ⇒ `registerArtifactTo` 以「空 + 新条目」**整文件重写** ⇒ **一次注册抹掉其余条目**。★ 结论：**逐处修是错的修法**，应建一条门扫全仓这个模式（判据：对每个 `catch/*坏*/⇒ 空/默认` 的写端，注入坏输入 ⇒ 必须拒写且原文件字节不变） | 全仓（写端） |
| T-#THREE-WALKERS | ★★ **三个走查器、三种口径**（同一问题"磁盘上哪些源码"）：`index_freshness.ts:547/574/602 walkFiles(root,false,false)`（**不传 gitignore**）· `live_render.ts:118-119 walkFiles(…, collectGitignore(root))`（传）· `index_backfill.ts:118/193 getProjectView().sourceFiles`（= `refs_text.ts:64 walkSourceFiles`，**另一套 SKIP_DIR/SRC_EXT**）⇒ **分母各不相同**（backfill 的 total/done ≠ freshness 的 checked） | `index_freshness.ts` · `live_render.ts` · `index_backfill.ts` · `refs_text.ts` |
| T-#SYMBOLS-SILENT-EMPTY | ★ **剩下的一处**：`getFileParse` 把「未索引 / 上次失败 / 无 file 节点」三态折成 null ⇒ `live_render.ts:139-142` 当"空 API 面"继续（读失败与"没有"仍不可区分）。★ 同族其余四处 **2026-11-03 已修**（卡 `file_src_infrastructure_index_symbols_ts` / `…_index_freshness_ts` / `…_watch_project_ts`）：bindings 坏 JSON（原 `:2185-2189`/`:2212-2219`/`:2889-2900`）与 `changedSymbolNames`（原 `:1340-1347`，坏列跳过 + 整读失败 ⇒ `[]`）现在**一律抛 `IndexReadError`**（点名 表[.列] + 文件 + 错误首行）；两个消费方拿不到变更集时写 `report.error` / `summary.error`，不再静默成 `refsReopened=0`。判据 = `tests/p0_change_set_truth.test.ts`（消融①只 ③ 红 / 消融② ①②③④⑤ 红）。★ 仍未碰（同族、形状容忍而非读失败）：`resolveCrossFileCalls` 里 `genericParamsByFile` / `localBindingsByFile` / `priorVerdict` 三处坏 JSON 仍 `continue` —— 它们容忍的是历史形状，改它们会放大影响面，故**留在这张单上** | `symbols.ts` · `live_render.ts` |
| T-#TEST-BASELINE-LAG | ★★ **① 已修 / ② 只修到"看得见"，数字没动（2026-11-03 `subagent:fix-ratchet`，只改 `scripts/run-tests.mjs`）**。① **定向跑恒红 —— 已修**：规模判据（原 `run-tests.mjs:555`）现在**只对全量跑生效**；`--filter` 时**不判规模**（子集天然小于全量 ⇒ 判了就恒红，0.16 的那种恒亮灯），改为打印覆盖缺口「本次 N 个文件 / 全量 M 个文件 ⇒ 未覆盖 M−N 个」，退出码**只看用例通过/失败**（有用例真失败仍 exit 1，实测夹具）。读数：`--filter p0_change_set_truth.test.ts` 改前 **exit 1**（「✗ 测试规模低于基线：文件 1（基线 58）」而用例 9/9 全 PASS）→ 改后 **exit 0** + 「未覆盖 66 个（全量 67 − 本次 1）」。② **基线滞后 —— 只做到"显形 + 拒降"，基线数字仍滞后，等人工在有证据时更新**：`--update-baseline` 写低于当前值 ⇒ **拒绝 + exit 1 + 文件一字节不动**（要降必须显式 `--allow-lower`，降幅大字打印 + 点名新增/消失文件，靠基线的 `fileList` 字段）；全量跑若实测 > 基线 ⇒ 打印「基线落后：实测 67 文件 / 324 用例 vs 基线 58 文件 / 267 用例 ⇒ 差 9 文件 / 57 用例」，**不报错不 exit 1**。★ **未做（有意）**：`scripts/test-baseline.json` 的 58/267 **没动** —— 用户裁定②不许用 `--update-baseline` 直接修（若此前已有人删过测试，更新基线等于把偷掉的牙永久合法化）⇒ **剩余那一步是另一张卡**：先证「67/324 是真的」，再由人跑 `--update-baseline` | `scripts/run-tests.mjs` · `scripts/test-baseline.json` |
| T-#VERDICT-DEAD | ★★★★ **`index_integrity` 的总判 `verdict` 已经死了（恒 `untrusted`），而且**没有任何用例守它**。实测（2026-11-03，`refresh:true`，干净工作区）：`verdict=untrusted`，唯一 blocker = 既有的 `files_not_fresh`（**7 项**已索引文件与磁盘不一致，且全部**不在保鲜重解析范围内** —— `.md`/tests 不在代码类走查里）⇒ 任何人**只看总判就等于什么都没看**；下面那些仍有信息量的读数（`self_writes_pending 3` / `test_not_indexed 8` / `stray_data_dirs 3` / `absolute_path_literal 5`）**全被一个恒红的总判盖住** ⇒ 这是 0.16 名单上最坏的一条：其余三条（`STALE_BUILD` / 判据突变 / 孤儿 31）是**单项**噪音，这一条把**整张读数**一起废掉。★ **修它必须先裁决语义**（`.md` / `tests` 到底算不算"该保鲜"）—— 那会动清点/对拍的既有读数，**不能在本卡顺手改**。★ 本卡的声明限界（不要读成"验过 verdict"）：`p0_change_set_truth` 用例⑨ 只断言 `refresh_receipt.error === null` + `changeset_unreadable === 0` + 人读无「变更集读不出」，**不覆盖 verdict**（它已被既有 blocker 占死） | `src/application/meta/integrity/index_integrity.ts` · `src/infrastructure/index/index_freshness.ts` |
| T-#MIGRATION-DANGLING-VIEW | ★★★ **改口：「v15→v16 会中」不成立；真命题是「v16+ 的库再有一次改名/删表迁移必中」**。★ 实测（2026-11-03，用 **git 原文 DDL** 而非手造）：`git show 28eba7f8^:src/infrastructure/index/schema.ts`（该版 `SCHEMA_VERSION = 15`）建库 ⇒ **视图数 = 0** → 用当前 `openDb` **真跑迁移** ⇒ **4 个视图全部可查、全部指向新表**（`JOIN files f ON f.id = i.file_id`）、行数不变、`schema_versions 15→17`。★ `git grep "CREATE VIEW" 28eba7f8^ -- src scripts tests` = **0 命中** ⇒ **4 个视图是 v16 那一笔 `28eba7f8` 自己引入的**，v15 库**无视图可改写**。★ **机制本身为真**（植入视图后复现）：迁移后 `sqlite_master` 里视图 SQL 已被改写成 `FROM "identifiers_v15"`，4 个视图全部报 `no such table: main.identifiers_v15` ⇒ 所以护栏的价值是「**v16+ 的库一旦再有一次改名/删表迁移**」的**前置不变量**，不是修一个已发生的 bug。**修法**：`migrateV15ToV16` 的 `BEGIN` 后、第一句 `ALTER` **前** `DROP VIEW IF EXISTS`，**视图名从 `SCHEMA_SQL` 自身解析、不另立清单**（另立 = 第二处权威）；夹具用 **git 原文**建 v15 ＋ **植入视图并在头注写明「真实 v15 无视图，本夹具代表 v16+ 库再改名」**（见 `T-#FIXTURE-MUST-BE-STATIC`）。★ 之前那版"必中"的"实测"是**往 v15 形状里植入视图的合成库** —— 编造历史，**该结论已作废** | `index/db.ts` 迁移 · `index/schema.ts` |
| T-#OBSERVE-SILENT-EMPTY-15 | ★★★ **observe 层同族普查：12 处「读失败⇒当空/默认」＋3 处"解析失败当一个值" = 15 处**（2026-11-03 清点）。★ **最刺眼的一处**：`instrument_skeleton.ts:483` `readdirSync` 失败 ⇒ `return`（**整棵子树静默跳过**）—— 而 `go_instrument.ts:34-47` 里的**同一个 catch 已被明令删掉** ⇒ **当初那次修复只修了那一处，没修模式**。其余重点：`probe.ts:387 loadTSEvents` 文件不存在 ⇒ `{events:[],skipped:0}`（与"零事件"同形，**层内主事件读入口**）· `probe.ts:396` 坏行只 `skipped++`（无行号/原因）· ★`probe_closure.ts:50 importsOf` 失败 ⇒ `[]`（文件漏出闭包 ⇒ 可被插桩 ⇒ **自伤复发路径**）· `go_instrument.ts:136-138` · `instrument.ts:370-375/475` · `dsl_store.ts:137/144` · `proposal_store.ts:191/198` · `probe_hooks.ts:86` · `run_env.ts:85/103` · +3 处"解析失败当一个值"（`snapshot_needle.ts:44` / `trace_exec.ts:286` / `ledger_fold.ts:112`）。★ **正确写法模板**：`dsl_store.ts:178` 解析失败**抛** · `go_instrument.ts:189` null⇒**抛** · `decl_review.ts:82/102/109` **返回 error 让上层冻结** | `src/infrastructure/analysis/observe/**` |
| T-#LLM-FAIL-INCONSISTENT | **同一层里同一个失败两种处理**：`judge_service.ts:118` LLM 失败 ⇒ **静默降级（字段无痕）** vs `run_loop.ts:179` `llmDegraded=true`（**留痕**）⇒ 消费者无法区分"没降级"与"降级了但没说" ⇒ 0.12。**修法**：统一走一个"降级必留痕"的返回形状 | `judge_service.ts` · `run_loop.ts` |
| T-#DESIGN-DIFF-DEAD-JUDGEMENT | ★★★★ **一条"永远绿"的判据（0.16 落到判据层）**：`src/application/design/line/design_diff.ts:101` 与 `domain/design_sheet.ts#diffDesignSheet` 是同一「`design/<f>.dsl.json` × `live/<f>.dsl.json` 节点对拍」的两份实现，**各持一份字段白名单**（`DESIGN_SHEET_NODE_KEYS:50` vs `MEANINGFUL:76`），而后者**仍写着 2026-10-27 已删除的 `Node.description`** ⇒ 两边都是 `undefined` ⇒ **恒 `null == null` ⇒ 永远不产差异 ⇒ 那条判据永远通过**。★ 永远亮的告警是噪音，**永远通过的判据更坏：它看起来在守什么**。**修法**：节点级判定归 `design_sheet`（含"已认亲"），`design_diff` 只留 must_have + imports 边核验；★ 合并前须先补 design_diff 独有的 must_have / imports 边核验（design_sheet 没有），且白名单改成**从 `Node` 类型派生**（不再手抄字段名） | `design_diff.ts` · `design_sheet.ts` |
| T-#COMMENT-STRIP-4 | ★★ **注释剥离有 4 档实现**（同一问题四份答案）：`domain/text_strip.ts`（手写扫描器，权威）· `parse/comments.ts`（AST 区间）· ★`index/symbols.ts:1779`（**私有正则，其自身注释 1773-1777 记的病正是"注释里的示例被当成真转发"**）· ★`authoring/translate/book.ts:354-355`（**更弱：连 `http://` 保护都没有**，正对 text_strip 头注第 19 行声明要保住的东西）。**修法**：后两处正则版并入 `text_strip`（infra→domain 合法）；AST 版语义不同可留但两边头注互指 | `text_strip.ts` · `symbols.ts` · `book.ts` · `comments.ts` |
| T-#SELF-CLAIMED-PARITY | **"自称与 X 对齐"但没有任何东西验证它**（两例）：① `anim_core#validateValueSchema` 手写 JSON-Schema 子集、注释自称"与 ajv 对齐"，**零判据**；② `expect_expr` 的 `EXPECT_EVAL_PARAMS` 只覆盖 design-check 方言，而 run-kind 求值域是**另一套 5 个名字**（`expectations.ts:486`）⇒ 同一概念两套参数表。**修法**：① 要么删掉"对齐"这句话，要么加一条对拍判据（同一 schema 喂两者比结果）；② 两套方言要么合并成一张表，要么在头注写明"哪套管哪种 kind" | `anim_core.ts` · `expect_expr.ts` · `expectations.ts` |
| T-#WORKFILES-DEFAULT-SCRATCH | ★★ **代理自造目录撞门（实测 2026-11-03）**：3 个清点代理把工作件写到 **`.agent-io/tmp-inventory/`**（7 个文件：additions/submit-1/submit-2/head-ledger/snap.cjs/make-submit.cjs）⇒ 撞 `manifest:check`「`.agent-io/` 下有没人认领的条目」⇒ **`npm run verify` 的「文档与事实」门红**（另一个正在收口的卡因此被误当成"它自己的红"）。★ **门是对的**（0.16 问句"这条灯拦下过真事故吗" ⇒ 今天有答案：拦下过一次），所以**不改门**。★ `grep tmp-inventory scripts/inventory-sweep.mjs` 零命中 ⇒ **不是脚本行为，是代理自己造的**。**修法**：① 清点/任何代理的工作件**默认落 `.agent-io/scratch/`**（已被 gitignore、不进卷表）—— 写进派卡模板；② 脚本若需要临时目录，自己 `mkdir` 到 scratch 而不要落在 `.agent-io/` 根下 | `.agent-io/scratch/` · `scripts/inventory-sweep.mjs` · 派卡模板 |
| T-#INVENTORY-MECH-NITS | 清点机制的 3 个卡点（实测，非抱怨）：① `--batch` 切片一次性吐 40KB+（每项带全量 symbols/consumers/form_template），而 fill 只需 path+symbols ⇒ 建议 `--lean`；② 读数模式每次都打一大段「indexed_at 解析不出来」名单（含本层 20+ 项及全仓其它文件）⇒ **与本层无关的纯噪音**（同族于 `T-#VERDICT-DEAD`：一个永远亮的名单）；③ `--validate-only` 只校验台账里**已 done** 的项 ⇒ **待提交的 JSON 无处预演**，形状错误只能靠提交才发现 | `scripts/inventory-sweep.mjs` |
| T-#CATCH-VARIANT-SWEEP | ★★★ **清理按"形态"做的铁证**（2026-11-03 实测）：`src/` 里**单行** `catch { return [] }` = **0 处**（8 条命中全是注释里的历史记录），而**多行** `catch ⇒ return []/{}/null/0` **仍 82 处**（`plumbing.ts:130` · `design/derive/opl.ts:505` · `node_ops.ts:43` · `judge_cache.ts:223` · `index_integrity.ts:291/331` · `overview.ts:60/125` …）。⇒ **清掉的是"单行那个形态"，多行的没清** ⇒ 「修的是形态，不是模式」今日第 N 次。★ 82 处里**哪些构成"整份写回"没人分类** ⇒ 那正是 `T-#CORRUPT-AS-EMPTY-FAMILY` 那条门该做的（注入坏输入 ⇒ 必须拒写且原文件字节不变）；本项 = **那条门的第一步：把 82 处按"是否写端"分类** | `src/**`（多行 catch） |
| T-#VERIFY-RED-NO-DOORNAME | ★★ **verify 偶发红，但输出被截断 ⇒ 留不下门名**（2026-11-03 实测）：第 2 次跑报「**2 道门失败**」，明细未留存；随后连跑两次 **10/10 全 PASS**。疑为同刻并行代理写 `.agent-io`/`cache.db` 的锁竞争。★ 这是 `0.7`（门失败留不下门名）的**并发实例**：红的时候说不清哪道门红 ⇒ 无法区分"真回归"与"锁竞争假红" ⇒ 又一条"永远说不清"的灯。**修法**：门失败时**先把门名 + 首行错误刷成一行**再吞明细；并发锁竞争应报 `unsupported`/`retry`，**不许折成 `FAIL`** | `scripts/verify.mjs` · `scripts/verify-clean.mjs` |
| T-#DISPATCH-PAYLOAD-SIZE | **派卡知识（环境限制，实测 2 次）**：子代理的 tool 调用 **arguments 会被截断** —— 实测 `edit_dsl decision` 首写丢掉 rationale 之后的**全部字段**；`complete` 首次丢掉 `op`/`type`。⇒ 派卡必须写死两条：① **关键键写在前面**（`op`/`type`/`id` 先行，长文本在后）；② **单次 payload 压到 ~1KB 以内**，超了拆多次。★ 这类截断**不报错**，只表现为"字段莫名丢了" ⇒ 极易被误判成"模型不听话" | 派卡模板 |
| T-#SHEETS-LIST-TWO-ANSWERS | ★★★★ **"本仓有哪些册"有两个答案，且**反向也漏**（实测 2026-11-03）**：`storage.ts:1574-1575` 枚举源是 `readRegistry().features`（跨项目注册表 `<storageRoot>/projects.json`），第二通道指向 data home 的 `design/`（本机**不存在**）。实跑 `listDesignSheets().length` = **11**（agent-io / agent-io-toolface / ds / iso / memory / proj-express-t98 / review-hub / sp / t192flow / task-system-plan / tp），而本仓 `<repo>/.agent-io/design/*.dsl.json` 实有 **3** 本 ⇒ **同一句"本仓有哪些册"两个答案：11 vs 3**。★ 11 条对应 **9 个项目根**（不是 5），其中 **5 个是 Temp 下的幽灵根**（triso · dsgn · terms · typeparse · t192）⇒ **临时目录被登记成正式项目根**。★ **反向漏**（更坏）：`take()` 只遍历注册表键 ⇒ **盘上有、注册表没有的册永远看不见** ⇒ 「缺失」与「枚举不到」同形。★ **语义错位**：4 个消费者里前 3 个各自 `if (!isSameProject(...)) continue` **后置过滤** ⇒ **枚举是跨项目的、过滤靠每个消费者自己记得补** = 规则不是机制。**修法**：`listDesignSheets` 本体按 `project_root` 过滤（跨项目注册表只用于"找别的项目"，**不能用来定义"本仓"**）＋ 注册表里 5 个 Temp 幽灵根要清；另把 `.agentio-data/`（数据家，含 `projects.json`/`gateway.json`）与 `.agent-io/`（项目目录，含 `design/`/`COGNITION.txt`/`cache.db`）在 `docs/INDEX.md` 显式区分 | `src/infrastructure/storage.ts:1574` · `<dataHome>/projects.json` |
| T-#ZERO-VALUE-TWO | **★ 裁决：判「不同」是对的，不许合并**（已拍板，留档防误修）：`go_extractor.ts:511 zeroValueOf(typeText: string): string`（**文本版**：`[]`→`[]` · `map[`→`new Map()` · `string`→`''` · 未知→`'null'` 字符串字面量）vs `body_mech.ts:264 zeroValueOf(typeNode): string\|null`（**节点版**：`string`→`""` · 未知→`null` = **不翻** · 无 `[]`/`map` 分支）。两者**职责不同**：前者产出**声明文本**（`let x = …`），后者产出**体重写文本**且未知类型**选择不翻**。⇒ **合并会把"声明"与"翻译"两种语义搅在一起**。**只统一其中相同的 numeric/string/bool 映射**，未知类型那条**保持按用途区分**；两处头注互相指路 | `go_extractor.ts` · `body_mech.ts` |
| T-#GATE-SILENT-ON-READ-FAIL | ★★★★ **两处"闸的依据"在读失败时静默降级（比普通静默失败严重）**：① ★ `write_gate.ts:214 hasLiveIndex` `catch ⇒ false` ⇒ **锁/坏库 与「没有索引」同形** ⇒ **A7「每个符号都要表态」整格静默失效** ⇒ 谁能制造索引读失败，谁就**绕过写闸**（★ 同文件**其余 12 处已按 0.12 改成带 reason，只这一处还是布尔**）② ★ `claim_conflict.ts:280 / :289` `catch{}` ⇒ **画布坍缩集扫描失败 与「卡没有画布」同形** ⇒ **basis 静默退回 read-set** ⇒ **并发闸的依据静默降级**。**修法**：两处都改三档（有/无/判不了），"判不了"必须 blocking 或至少 `unsupported`，不许折成 false/空 | `write_gate.ts:214` · `claim_conflict.ts:280/289` |
| T-#CYCLE-FORCES-DUP | ★★★ **"重复"的一个新成因：想共用但共用不了（循环依赖）**。`design/db/plan_exit_check.ts:97` + `:175` **重抄** `write_gate.ts:1207 symbolFpsOf` / `:1238 symbolsInFileOf` 那两条 SQL（`SELECT name[,body_hash] FROM nodes WHERE file_path=? AND kind!='file' AND parent IS NULL`），它 94 行注释自认「与 write_gate#symbolsInFileOf 同一把尺」——**真因是 write_gate 已 import plan_exit_check，反向 import 会成环**。⇒ **吞并方向不是"让 A 指向 B"**（环还在），而是**把这 pair 读原语下沉 `infrastructure/index`，两处共用**。★ 同一谓词已被**第三次**复述：`design/db/design_db_projection.ts:70`（投影目的不同，台账判"不同"，但**谓词该由一处产出**）。★ 另两处手抄：`observe/index.ts:260/:268` 写死 `\n---DATA---\n`（权威 `plumbing.ts:89 DATA_MARKER`，注释明写"单点"）· `claim_conflict.ts:562 shortFp` ⇄ `read_set.ts:533`（12 位显示口径两份）。★ 结论：**这类重复加清单清不掉，必须动结构** | `plan_exit_check.ts` · `write_gate.ts` · `design_db_projection.ts` · `observe/index.ts` |
| T-#SYM-HASH-VS-BODY-HASH | ★★★★ **裁决：不是重复，且永远不许合并**（防误合并，最高优先留档）：`read_set.loadFileFacts` 读 **`sym_hash`（归一化后）** vs `write_gate.symbolFpsOf` 读 **`body_hash`（原文）** —— **同一张 `nodes` 表两种口径，不可互换**。⇒ 若按"清点发现重复 ⇒ 合并"的直线逻辑处理，**写闸判定就错了**。★ 这是清点机制的**边界案例**：它只问"是不是同一件事"，而这类"长得一样但语义不可换"恰好在边界上。★ 该代理主动标了「非重复但易混」（派卡模板没要求）⇒ **派卡模板应加一条：清点必须区分"重复"与"同表不同口径"** | `read_set.ts` · `write_gate.ts` |
| T-#GW-STATS-ROOT-CAUSE | ★★★ **旧谜解开：`T-#GW-STATS`「网关 stats 持久化写 0（内存对、文件 0）⇒ 该文件不能当进度读数；我据此误判过并杀掉进程」的真因** = `llm_gateway.ts:325` `catch ⇒ []`（**用量读失败就当空 ⇒ 归零**）。当年以为是"写 0 的 bug"，其实是**读的时候把它当空吞了**。★ 同族三处会凭空变小/同形：`dogfood_stats.ts:154`（rollup 损坏→空桶 ⇒ **GC 后读数凭空变小**）· `verify_refactor.ts:103`（package.json 读失败⇒`scripts=undefined` ⇒ **「不可验证」与「没配 test」同形**）· `roots.ts:280`（readdir 失败→跳过该目录 ⇒ **stray 少报且无计数**）。**修法**：四处一律三态（有/无/判不了），"判不了"必须留痕 | `llm_gateway.ts:325` · `dogfood_stats.ts:154` · `verify_refactor.ts:103` · `roots.ts:280` |
| T-#SAME-FILE-TWO-POLICIES | ★★★★ **同一个文件内部两种相反口径（违反的那处一直没被发现）**：`storage.ts:346-350 getLiveFeature ⇒ null`（把"坏"说成"没有"）vs `storage.ts:870-876/:932-940 ⇒ 抛`，且后者的注释**明写**「把文件损坏与还没有混成一个值是本仓禁止的失败模式」⇒ **同一文件自相矛盾**。同型三例：`task_history.ts:386-392`（**有** stderr）vs `:669-673`（**静默**）· `dogfood_stats.ts:203`（会 `broken++`）vs `:409`（跳过且不计数）· `storage.ts` 的 `feature` 名校验 `^[a-zA-Z0-9_-]+$` **逐字写 6 遍**（216/400/819/860/1157/1160），`:1168` 还有**第三种变体**（替换而非拒绝）。**修法**：同一文件内先统一到**最严**的那一档，再把复述的校验/解析抽成一处 | `storage.ts` · `task_history.ts` · `dogfood_stats.ts` |
| T-#ATOMIC-WRITE-THREE | ★★ **原子写三份同名同体**：`storage.ts:1394-1398`（saveDSL 内联闭包 `writeAtomic`）· `dogfood_stats.ts:269-273`（compactUsageLog 内联闭包，**同名同 4 行**）· `project_registry.ts:213-223`（`tmpPathFor` + rename）⇒ 权威应是 storage 那个（或抽独立原语并导出），另两处改 import。★ 而 `storage.ts:1386` 的注释写「全仓 `renameSync` **0** 处」—— **已不成立（今 3 处）**，注释在复述一个已经变假的事实 | `storage.ts:1394` · `dogfood_stats.ts:269` · `project_registry.ts:213` |
| T-#ROLE-SUBDIR-DRIFTED | ★★★ **角色→子目录表已漂移**：`roots.ts:104-114 ROLE_SUBDIR`（权威）vs `data_uniqueness.ts:50 ROLE_SUBDIR_OF`（**手抄子集**，注释自认「避免 import 内部表」）⇒ **`tasks: '.'` vs `tasks: 'tasks.db'` 已分叉**。★ 同型：跳过目录表 `source_exts.ts#SKIP_DIR_BASE`（20 项，权威）vs `roots.ts:285` 手写 `node_modules`/`.git` **两项**。★ 另一处性能型：`exec_guard.ts#commandAvailable`（先查 PATH，0ms）vs `git.ts:15` 直接 `execSync` **不过闸** ⇒ 缺 git 时按 exec_guard 文件头实测**白等 ~5.1s**。**修法**：`ROLE_SUBDIR` 导出供 import（注释里"避免 import 内部表"这个理由要删掉——它就是第二处权威的许可证）；`roots.ts:285` 改用 `skipDirSet`；`git.ts` 的 run() 先过闸 | `roots.ts` · `data_uniqueness.ts` · `git.ts` · `exec_guard.ts` |
| T-#COMPILER-AS-ORACLE | ★★★★ **方法论规则：判断"这段代码合法/非法"必须用编译器实测，不许推理**。实测翻车（2026-11-03）：我断言「`1_000` 走 legacy 路径会产出 **TS1121 非法**」，而代理用**真 tsc 跑 13 个边界案**实测 ⇒ **`1_000` 完全合法**（ES2021 数字分隔符）；真正非法的是 `0_644`(TS6188) · `0_`(TS6188) · `05`(TS1121)。⇒ 病是真的（同一段体产出不同字节 + 三个形状真非法），**但我举的那个例子是错的**，而如果它照我的话写判据，判据本身就是假的。**规则**：① 凡"合法/非法/能否编译"一律以 `tsc`/`go build`/运行器输出为准；② 派卡时若我给了具体例子，标注「这是我的推理，**你必须用编译器验证**，错了以你的实测为准」；③ 合并类改动必须有"合并前后同一批输入"的编译器读数（合并后必须 0 案非法）。★ 这是 0.4「读代码 > 任何统计」的加强版：**编译器 > 推理**，因为推理会自信地错 | 全仓（判据与派卡模板） |
| T-#SKIPLHS-GO-TABLE | ★★★ **活的 bug：TS/JS 家族在用一张 Go 的关键字+内建表做「`.` 左侧过滤」**。`contract_gate/languages/ts.ts:19 SKIP_LHS`（49 项）是 `go.ts:6 GO_RESERVED`（27 项）的**严格超集** —— 实测 GO_RESERVED **100% 落在** SKIP_LHS 里，多出的 22 项全是 **Go 内建**：`append/int/int64/uint/string/bool/byte/rune/float64/error/len/cap/new/make/delete/copy/close/panic/recover/complex/real/imag`。★ 危害：`error` / `string` / `len` 在 JS 里是**极常见变量名** ⇒ `.error` 这类属性访问的左侧被当"保留字"跳过 ⇒ **漏报引用**。★ 根因（拆分前就有）：单文件里其余 5 语言各有 `if (lang===…) return <X>_RESERVED`，**TS 走的是兜底 `return SKIP_LHS`**；拆分只把这个既有错误**逐字保留**（`ts.ts:18` 注释还写"保留字/关键字"却没说**是谁的**关键字）。**修法**：给 TS 一张真正的 TS/JS 保留字表（`SKIP_LHS` 显式改为 TS 语义），并把"兜底 = 借用别语言表"这个洞补掉 | `contract_gate/languages/ts.ts:19` · `go.ts:6` |
| T-#THREE-LANG-PACKAGES | ★★★★ **同一门语言本仓有 3 套语言包**：`contract_gate/languages`（6 文件）· `rename_symbol/languages`（6 文件）· `package_migration/languages`（3 文件），**文件名与 exts 逐字相同**（`c/cs/go/java/py/ts` + `registry`）。★ 而 3 张 registry 表的头注**都自称「唯一调度表」**（`registry.ts:21 CG_LANG_PACKAGES` · `rename_symbol/…/registry.ts:53 LANG_PACKAGES` · `package_migration/…/registry.ts:23 PM_LANG_PACKAGES`），后两者还明写「与前者同形」⇒ **两处注释都自称唯一**（同 `T-#KIND-PHASE-DUP` 那个模式）。★ 这一层还各有：`reserved`×6 · `globals`×4 · `exts`×5 字面量（真权威 `parse/languages.ts:109-129 LANG_ENTRIES`）· `skipLine`×2（`java.ts:56` / `cs.ts:57`，且**没有任何登记处**记录"哪门语言有 skipLine"）· 语言名单×4（`parts.ts:11 Lang` + 三处）。★ 唯一没抄的一类：**注释语法表**（本层不解析注释）。**修法**：先决定"语言包"是一套还是三套 —— 若一套则合并目录；若三套则**必须有一处登记表说明各自职责差异**，而不是三张表都写"唯一" | `{contract_gate,rename_symbol,package_migration}/languages/**` |
| T-#OVERLAP-NEEDS-PRECONDITION | ★★ **清点机制的缺口："相同"判决带前提时无处记**。实测（`T-#THREE-LANG-PACKAGES` 那批）：台账判 3 条 `verdict:'相同' merge_into: globals.ts`，但那判决**带前提**——「**ts 必须先搬 16 个宿主名进权威，否则删表即丢名字**」。⇒ 表单闭集里只有 `with/verdict/why/merge_into`，**没有 precondition 字段** ⇒ 前提只能塞进 `why` 的自然语言里 ⇒ 下一个拿着台账去合并的人**可能先删表后补权威**，直接丢名字。**修法**：`verdict:'相同'` 增加可选 `precondition`（字符串或结构化步骤），且**校验要求"相同"且存在 `merge_into` 时 precondition 不得为空**（若确无前提，显式写 `"无"`）—— 与"判相同必须给 merge_into"同一条思路 | `scripts/inventory-sweep.mjs` 表单闭集 |
| T-#PIVOT-MECH-NO-FILE-NODE | ★★★★ **`body_pivot.ts` / `body_mech.ts` 没有自己的 file 节点 ⇒ 写闸的 `authorize` 对它们无从判起**。精确读数（2026-11-03 实测）：① 节点 id `file_src_infrastructure_authoring_translate_body_{pivot,mech}_ts` 在全部册里 = **0**；② `semantic.files` 三册合计 **0 条**（agent-io 447 + task-system-plan 434 + toolface 6）；③ 但它们的 **path 字符串在别的节点里出现 32 处**（作为 `path` 值与 note 文本）。⇒ translate 卡用 `authorize:'files:src/infrastructure/authoring/translate/'` 时按「路径 → **节点**」反查，**找不到节点 ⇒ 覆盖不到整批**（该卡只能逐个文件声明）。★ 这是 `T-#NO-CARD-INVISIBLE`（464/546 无卡无锚点）的具体样本，含义比"没卡"更重：**写闸对没有 file 节点的文件是被绕过的**。**修法**：把"没有 file 节点的源文件"变成**可见的红**（同 `structure_gap.unlisted` 的思路），而不是等某张卡撞上授权失败才发现 | `.agent-io/design/*.dsl.json` · `write_gate` authorize 反查 |
| T-#MENTIONED-IS-NOT-REGISTERED | ★★★ **方法论规则：「提到」≠「在册」**（2026-11-03 我差点据此记错一条）：验证"某文件在不在册"时，我用 `grep 'body_pivot\.ts'` 得 **32 命中**，差点写成"代理说错了"；实查才发现 **节点 id 0 个 · `semantic.files` 0 条 · 那 32 处全是别的节点的 path 值与 note 文本**。⇒ **数"名字出现几次"不能回答"实体登记了几条"** —— 与"同名可查、同语义不可查"是同一个错。**规则**：判"在不在册"必须查**结构化字段**（`semantic.files[].path` / 节点 id），不许 grep 文本；判"谁引用了它"必须走 `find_references`（AST），不许 grep。★ 这类错最危险处：grep 结果**看起来很有说服力**（32 > 0），足以推翻一个正确结论 | 全仓（读数纪律） |
| T-#COGNITION-NOT-IN-BUILD | ★★ **"什么算构建完成"有两处定义**：`npm run build` = `gen_agents && gen-expectation-schema && tsc && clean_dist` —— **不含 cognition / gen-facts / docs-facts**；而"改设计册判据 ⇒ 必须重生成 `COGNITION.txt`"只在 verify 的「文档与事实」门才现形 ⇒ **build 绿而 verify 红**。★ 读数员硬证实：`.agent-io/COGNITION.txt` 在 build 前/后 **mtime 都是 2:11:10、Length 158602 不变 ⇒ build 零写入**。**修法**：要么把 `cognition:check` 并进 build 的收尾（build 只该产出一个"一致"状态），要么明确写进 build 的**声明边界**（"改判据后必须另跑 cognition"） | `package.json` build 链 · `scripts/docs-facts-check.mjs` |
| T-#INDEX-POLICY-DUP | 索引策略清单**第二份副本**：`watch_project.ts:46 IGNORE_DIRS`（6 项）vs `source_exts.ts:336 INDEX_SKIP_DIR_EXTRA`（同 6 项 + `.idea/.vscode/.backup`）⇒ watch 会同步索引器明确跳过的三个目录。★ **本行原先还记着 `registry.ts:56-65 readRegistry()` vs `:116-124 readFileEntries(file)` 逐字同体 —— 该半已于 `aae3fdd5` 修掉**（两个旧函数已删，收成 `readRegistry(file=…)/writeRegistry(file,entries)`），剩这半未修 | `watch_project.ts` · `source_exts.ts` |
| T-#FIXTURE-MUST-BE-STATIC | ★★★★ **方法论规则：输入可以造，历史不能造**（用户 2026-11-03 裁定：「你就不能用这框架自己的静态的吗？夹具永远会飘 … 夹具救了你很多次，但是夹具害了你非常多次」）。**分界线**：① **模拟历史/外部状态 ⇒ 必须取仓内静态原件**（`git show <v15 时代的 commit>:src/infrastructure/index/schema.ts` 的 DDL 原文 · 真数据副本 · 现成 fixture），**不许手写编造** —— 因为"编出来的 v15"只是我对 v15 的想象，用它跑迁移 = 测我的想象是否自洽，不是测真实升级路径；② **隔离被测逻辑的输入 ⇒ 夹具仍必要且有效**（今日正例：`A2` 用 `1==2` 断言证明判据没被整个关掉 · `B1/B2` 用基线夹具证明"拒降"与 `--allow-lower` 都对）。★ **今日受害三例**：`p0_change_set_truth` 的 `a.ts`（只 bump mtime、内容不变）**会收敛** ⇒ 让验收席和我先后判错（**同一个夹具害了两次**）；若按我"`1_000` 非法"的推理写夹具，夹具本身是假的（被 `tsc` 拦下，见 `T-#COMPILER-AS-ORACLE`）；"12 个写口"那张卡的前提整段是编的。★ **判据**：夹具里的**时间/版本/历史状态**若来自手写，一律标 `[未核]` 并在回报里写"这形状是我反推的" | 全仓（判据与派卡模板） |
| T-#GAP-CHECKER-LIES | ★★★★ **"缺口检查器"在查不到时报告"不算缺口"（与 A7 静默失效同级）**：`capability_map.ts:869` `catalog.find(...)?.inputKeys ?? []` ⇒ `wants=[]` ⇒ `:893` 判 **`no-need`** ⇒ **工具查不到 ⇒ 当成"这工具不需要对象入参" ⇒ 真链条缺口被判定成"不算缺口"**。★ 而 `CHAIN_EDGES` 端点**有没有测试把守 = 0**（`grep CHAINS\|chainVerdicts` 于 `tests/scripts` 空）⇒ **工具改名/下线即静默假绿**。**修法**：`find` 落空必须产出"查不到"这一档（不许 `?? []` 折成"不需要"），并**给 CHAINS 端点加把守**（至少一条"端点工具必须存在"的存在性判据） | `capability_map.ts:869/893` |
| T-#REGISTRY-EXTRACT-REGEX-DEAD | ★★★ **用正则在源码上解析，而运行期有类型数据**：`registry_extract.ts:69-112` 用**正则切 `server_registry.ts` 文本**来取工具清单，而权威是 `capability_map.ts listToolDefs()/catalogOf()` 的**运行期 `ToolDef[]`** ⇒ **整份可下线**（前提：其独有半 `implModules` 全仓 grep=0）。★ 该文件 **`importer`=0** ⇒ 连带 `cli_extract` / `collect_functions` 成**死岛**。★ 性质：**有类型数据不用去解析源码文本** —— 正则一定漂、类型不会；且 `:65` 还有 **5000 字静默截断**、`:44/:60` 正则 miss ⇒ `return ''`。**修法**：确认 `implModules` 无消费者后整份删；`cli_extract`/`collect_functions` 一并判死或并入 `capability_map` | `registry_extract.ts` · `cli_extract.ts` · `collect_functions.ts` |
| T-#SAME-LIST-TWO-HOMES | ★★★ **"同一份清单登记两处"三例，改一处另一处静默不报**：① `capability_map.ts` 的 `LANE_IDS`(:52) 与 `LANE_META`(:123) **各写一份线清单** ⇒ 只改一侧两种都静默（漏渲染 / 单线视图空体），**无断言**；② `tool_faces.ts` minimal 面 desc(:132-136) **硬编码那 6 个名字** vs `MINIMAL_FACE_TOOLS`(:65)（唯一被单测钉住的）⇒ 改名单忘改描述**不会有断言红**；③ `capability_map.ts:72 ToolCatalogEntry.requiredKeys` **只写不读**（真消费者已换 `declaredRequiredMembersOf`）。★ 另有一条**潜伏**：`WHEN_OVERRIDES` vs lane 文件的 `LaneAssign.when` —— **后者胜出会静默遮蔽前者**，而 `staleWhen` 只看注册表；当前无 lane 写 `when`，**一旦有人写就静默生效**。**修法**：三例一律收成一处（`LANE_META` 从 `LANE_IDS` 派生 / desc 从常量派生 / `requiredKeys` 要么删要么真读）；`LaneAssign.when` 要么删，要么与 `WHEN_OVERRIDES` 合并并让 `staleWhen` 两边都看 | `capability_map.ts` · `tool_faces.ts` |
| T-#CATALOGOF-DROPS-FIELDS | ★★★ **逐字段搬运漏字段（今日第二例，与 `receiptOf` 漏 `error` 同病）**：`capability_map.ts:857-864 catalogOf` 只手搬 `name/title/description`（+派生 `inputKeys/requiredKeys`），**丢掉 `ToolDef.noAutoFresh` / `trustAnnotated`** ⇒ **工具加元信息时投影静默不跟**。★ 同类其余搬运点已逐个核对**未发现漏字段**：`registry_extract:102-108` · `tool_faces mk:107` · `collect_functions:54-62` · `sync_contracts expected_apis`。**修法**：投影改成**从 `ToolDef` 类型派生**（`Omit`/映射）而不是手列字段，或加一条"`ToolDef` 新增键必须出现在 catalog 里"的断言 | `capability_map.ts:857` |
| T-#CONTRACT-DEPS-FACE-EMPTY | ★★★★ **「自动追溯 + 自动写测试」缺失的地基**（2026-11-03 实测，回答"框架是不是还没做完"）：`semantic.files[i]` 的键**只有 6 个** —— `id / path / responsibility / symbols / lines / layer` ⇒ **`expected_apis` / `expected_deps` 根本不在这层**；全文 `expected_deps` **0 次**、`expected_apis` **1 次**。★ 对照：**契约的"判据面"很实** —— 决策卡 `expectations` **1889 条** / 11 种 kind（`source-has` 506 · `call-exists` 375 · `run` 309 · **`behavior-cases` 290** · `domain-independent` 167 · `symbol-exists` 136 · `file-exists` 55 · `signature-matches` 33 · `edge-exists` 10 · `edge-absent` 6 · `cert` 2）。★ **后果链**：`design_line action=drift`「对比 `expected_apis` 与真实代码」**无对象可比**；"谁该依赖谁"没写 ⇒ **AST 追溯没有目标** ⇒ **自动写测试无从谈起**。★ 而且 `autoTest`/`generateTest`/`scaffoldTest`/`writeTest` 全仓 **0 命中** ⇒ 那个能力**从未建过**（不是坏了，是不存在）。**缺口分层（按存在度）**：① 判据面 ✅ ② 接口/依赖面 ❌ ③ AST 追溯：工具有、**对象无** ④ LSP ❌（用 tree-sitter + tsc） ⑤ 自动写测试 ❌ ⑥ 增量：半个（`verify:changed` 今天才通，来源仍是 git）。**修法顺序**：**先补 `expected_deps`**（"这个文件该 import 谁"可从 AST 反推 + 人工确认）⇒ 有了对象，`drift` 与追溯才成立 ⇒ 再谈自动写测试 | `semantic.files` 契约面 · `design_line drift` · `sync_contracts` |
| T-#DRIFT-DEPS-IS-SELF-COPY | ★★★★ **"设计↔实际的依赖对拍"是**恒等的**（0.16 反面：一条永远绿的判据）**。试点实测（2026-11-03，6 文件）：写完 15 条 `expected_deps` 后 `design_line action=drift` **仍 `no_comparison` / compared=0**（新鲜 dist CLI 复跑同结论）。**根因两层**：① `consistency.ts:1148-1152` 的 `compared` **只数 `expected_apis`**，`expected_deps` **全文无任何对拍器**（读端只有 `query=file` 的「依赖:」段 / digest 的 R 行 / `locate_feature` 反查）；② ★ **更根本**：`import_project` 把**实际直接 fork 成设计** ⇒ design 与 live 对这 6 个文件各有**同一组 11 条边** ⇒ `diff_views` 的依赖层**永远绿** ⇒ **它在"对拍自己"**。★ 这直接打穿产品模型「设计 DSL ↔对拍↔ 实际 DSL」：设计若从实际复制，对拍结构上不可能发现漂移。**修法**：在 `consistency` 加第三条线「`expected_deps` vs `cache.db` 实际 import」，并让 `import_project` 对**已存在的设计**永不用实际覆盖设计侧（现状已如此，但需一条判据把守"设计依赖边不是实际的自拷贝"） | `consistency.ts` · `detect_drift.ts` · `import_project` |
| T-#HISTORY-STORE-UNUSED | ★★★★ **我有可 grep 的历史库，却一整天没用它**（2026-11-03 实测）：① `.workbuddy/memory/*.md` = **437.9 KB / 6 天**，纯 markdown，**现在就能 grep**（实测命中：`夹具` 24 处 · `坍缩集` 8 处 · `A7` 2 处 · `1_000` 2 处）；② `~/.dsh/sessions/--D-agentio--/session-*/session.v4.jsonl.zstd` = **原始会话全文**（最大 19–28 MB，**5860 个 zstd 帧**，需逐帧解）。★ **而 `2026-11-03.md` 只有 3.2 KB、最后写成 00:32** ⇒ 这会话从 03:00 干到 11:00、几十个提交、**一条都没进**（`grep 跨目录\|清点` 在 memory 里 **0 命中**）。⇒ **AGENTS.md §五 要求"做完一项 ⇒ 写回执 + `.workbuddy/memory/YYYY-MM-DD.md`"，今天没人（包括我）执行** ⇒ 代价就是"8 次预判被推翻""反复忘掉前面定的规矩"。**修法**：① 每完成一张卡就 append 一段（含 commit hash + 读数 + 判断）；② **需要回忆时先 grep memory，再动脑**，不许直接靠压缩摘要；③ 原始会话多帧 zstd 可写一个只读 reader（5860 帧已数清，`zstdDecompressSync` 只解第一帧 ⇒ 必须逐帧解） | `.workbuddy/memory/` · `~/.dsh/sessions/` |
| T-#DECISION-RESOLVE-CROSS-BOOK | ★★★★ **判据引用会「跨册按同名取」，且不报"归属不唯一"（静默）**（2026-11-03 实测，迁移卡撞到）：`resolveDecisionExpectation` 按「同名节点」跨册解析 `decision:<node_id>#i`。而 `file_src_infrastructure_index_schema_ts` / `..._db_ts` **在 task-system-plan 册里也有同名节点**；收窄规则 = 「该节点自己那个 path 的**唯一**断言者」⇒ schema.ts 的断言被判归 **task-system-plan**（它 3 条 / agent-io 0 条）⇒ **静默读了那边 3 条 `source-has`**，把新写的 4 条判据**全判成"存在类"**（真实意图是 `call-exists`），**而不是报"归属不唯一"**。⇒ **你写的判据可能被别的册的同名节点顶掉，且一声不响** ⇒ 与 `T-#SHEETS-LIST-TWO-ANSWERS`（"本仓有哪些册" 11 vs 3）**同源：跨册污染本仓读数**。★ 该代理的绕过：改挂 `db.ts` 节点（db.ts 的断言 100% 归 agent-io）才解开；`schema.ts` 节点的卡已 `release` 回 candidate、3 条 expectation 已撤回、**`schema.ts` 一个字没动**。**修法**：① 遇"同名多册都有断言"**必须报归属不唯一**并列出候选（册名 + 条数），不许按"唯一断言者"静默选边；② `feature` 应作为**显式限定**参与解析。★ 附带：`plans` 表按 `(feature, card, file)` 主键 ⇒ 错锚点会留下**孤儿空画布**（本次 schema.ts 一份 0 entry）⇒ 需要"空画布清理"或在校验时报出来 | `resolveDecisionExpectation` · `tasks.db#plans` |
| T-#RUNTIME-KIND-UNUSED | ★★★ **第 12 种判据 kind `runtime` 建了，但 0 条在用**（2026-11-03 实测）：`src/domain/expectation_kinds.ts` 里 `runtime` **存在**（6 处），`## 58` 记录它 2026-10-28 落地且有证（t409 9/0），语义是 `{probe, expect: ok\|deviation\|absent, events?}` —— 零配置找 `.agent/observe/events*.jsonl` → 复用 `judgeEvent` → 四态。★ 而本仓册里实际出现的 11 种 kind **不含 runtime**（`runtime` = **0 条**），其余 1_921 条：`source-has` 523 · `call-exists` 390 · `run` 309 · `behavior-cases` 290 · `domain-independent` 167 · `symbol-exists` 137 · `file-exists` 55 · `signature-matches` 33 · `edge-exists` 10 · `edge-absent` 6 · `cert` 2。⇒ **建了没人用 = 一条永远不亮的灯**（0.16 的镜像）：L3 运行时层名义上闭环，实际**零覆盖**。★ 配套缺口（记录里已点）：`decls`（链路契约 chain）仍要手工带 ⇒ 下一步该把册里的 chain 声明渲染成 `decls` | `expectation_kinds.ts` · `.agent/observe/` |
| T-#CANVAS-FREEZES-NO-DEPS | ★★★★ **用户模型：只有画布可写，其余设计 DB 只读；对拍 = 坍缩集 × (实际节点 + 所化依赖)。实测：节点那半成立、依赖那半不成立**（2026-11-03）。★ 画布 `plans` 表 12 个字段 `feature, card_id, file, entries_json, untouched_json, untouched_default_json, symbols_at_freeze_json, fps_json, base_hash, frozen_at, created_at, updated_at` —— **没有任何 dep 字段**。⇒ 冻结了三样：符号名全集（`symbols_at_freeze_json`）+ 每符号 `body_hash`（`fps_json`）+ 文件级 `base_hash`；`plan_exit_check.ts` 按 `nodes.body_hash` 比 ⇒ 四态 `realized/not_yet/stale_anchor/unjudgeable` **＋ `changed_unplanned`**（**"改了却没计划的符号"= 越界检测，已存在**）。⇒ **节点对拍成立 ✅ · 依赖对拍不成立 ❌**（没有意图可对）。**修法**：画布冻结时**同时冻依赖**（`deps_json`：锚点所属文件的外部 import 目标集合），出口闭环加两档 `dep_added` / `dep_removed` ⇒ 对拍才两半都成立。★★ **同时改口我自己的方案**：上午提的"补全仓 `expected_deps`"**粒度错**（把可写区扩到整片设计 DB，且要求每改一处声明全仓依赖）—— 对拍的载体应是**画布（坍缩集）**；已写进 `semantic.files` 的 15 条（`capability_map.ts` 7 · `collect_functions.ts` 2 · `sync_contracts.ts` 5 · `tool_faces.ts` 1）**应撤回或降级为全仓意图账**，不进本次对拍 | `tasks.db#plans` · `plan_exit_check.ts` · `rewrite_plan.ts` |
| T-#CANVAS-NEVER-DISSOLVES | ★★★★ **用户模型的状态机只实现了中间一步：画布永不消解**（2026-11-03 实测）。用户模型（原话）：「只要设计册被编辑了，那被编辑的那一块就是画布，直到对拍之后发现两边对拍完成，然后画布的**设计性就自动消解，因为它已经是实际了**」。⇒ 状态机 = `实际册(稳态) →编辑→ 画布(差集·可编辑) →实现+对拍→ 差集空 ⇒ 画布消解 → 设计册≡实际册`（后者正是用户 2026-10-30「两个册一模一样」）。**实测只到第②步**：① 画布靠人调 `design_line action=plan` 生成（**不是"编辑即自动"**）；② 对拍**节点半成立**（`fps_json`/`body_hash` 四态 + `changed_unplanned`）、**依赖半缺**（见 `T-#CANVAS-FREEZES-NO-DEPS`）；③ **消解缺两段**：**(a) verdict→status 回写机制存在但 opt-in**（`sync_status`: realized ⇒ open→done）⇒ 15+ 张卡今天都 complete 且 `not_yet 0`，而画布 status 停在 open ⇒ 实测 **94 份画布 / 232 entry：open 229 · done 2 · 全 done 的画布 1/93**；**(b) 差集空 ⇒ 画布删除/归档：完全没有** ⇒ **94 份只增不减**（agent-io 88 · task-system-plan 6 · 最老 frozen_at **64 小时** · 中位 22 小时）。★ **后果**：收敛的"判断"有了、收敛的"动作"没有 ⇒ 差集永远消不掉 ⇒ **"设计册 ≡ 实际册"永远不可能达成**。**修法**：① `sync_status` 默认开（或 complete 时强制跑一次）；② 差集空（全 entry done 且 `changed_unplanned` 空）⇒ 画布**自动归档/删除**并留一条"已消解"记录；③ 编辑设计册时**自动**产生/更新画布（不要人手调 plan） | `tasks.db#plans` · `design_line action=plan` · `plan_exit_check.ts` |
| T-#SCAN-LEDGER-STALLED | ★★★★ **变更账停摆：`scan_runs` 最新停在 2026-11-02T04:56，今天零记录**（2026-11-03 实测）★ 结构：`scan_runs`(57 行 `id, at, files_before/after, added, changed, removed`) ← `scan_changes`(645 行 `scan_id, path, kind, before_hash, after_hash`) · `symbol_diffs`(199 行 `file_id, from_hash, to_hash, added/removed/changed, updated_at`)。⇒ 从 11-02 04:56 到 11-03 11:30 **一条 scan run 都没有** ⇒ 今天几十次改动**零记录**。★ **三重后果**：① **增量机制的前提不存在** —— `verify:changed` 只能用 git，不是"没想到用 cache.db"，而是**这张表不更新**；② ★ **陈旧画布判不了** —— 区分"我改完了(realized)"vs"别人二次改了"(需作废) 依赖"变更发生在何时"，账停了 ⇒ **无依据 ⇒ 只能作废+归档+标"判不了"，不许补推 done**（那是把假账洗成真账）；③ 我早上修的 `changedSymbolNames`（读这张表）**读到的是昨天的账** ⇒ 那次只修了"读端不出错"，**数据源本身是死的**。★ **覆盖窗口**：账覆盖 10-27 07:56 → 11-02 04:56；画布 `frozen_at` 跨 10-31 19:30 → 11-03 11:30 ⇒ **落窗内的部分可判、落窗后的全判不了**。**待查**：谁该写 `scan_runs`（`watch_project` flush？`import_project`？）—— 若只有 watch 写 ⇒ **watch 没跑 ⇒ 账永久停摆**。**修法**：① `import_project`/`refresh` **也写一条 run**（不只 watch）；② `scan_runs` 加"最后一次 run 距今多久 ⇒ 超阈值报警"（否则账停了没人知道）；③ `verify:changed` 回执里写明「变更集来源=git，因 cache.db 变更账停在 <时间>」 | `.agent-io/cache.db` · `watch_project.ts` · `import_project` |
| T-#CARD-CLOSED-NO-TRACE | ★★★★ **结案的卡不留痕：`task_history` = 0 行，而 NOT_FOUND 画布里有 0 小时前冻结的**（2026-11-03 实测）。`tasks.db` 只有三张表：`live_cards`(77 行 `id, feature, state, card_json, updated_at`) · `task_history`(**0 行** `id, feature, node_id, state, summary, card_json, moved_at, reason`) · `plans`(92 行)。★ `live_cards.state` = `candidate 70 · void 3 · done 3 · in_progress 1`；`plans` 引用 **59 个不同 card_id**（`file_src` 52 · `file_scripts` 4 · `todo` 2 · 空 1），而 `live_cards` 里 `file_src` 只有 **18 个** ⇒ **34 个消失了而历史库空**。★ **94 份画布按卡状态**：`NOT_FOUND 84 · live:void 3 · live:done 3 · live:candidate 1 · no_card_id 1` ⇒ **可消解 91 / 必须保留 1**。★★ NOT_FOUND 那 84 份**年龄 0h~64h（中位 24h）含今天刚冻结的 0h 份** ⇒ **"卡完成后从 `live_cards` 直接删、不写 `task_history`"是现行行为** ⇒ `NOT_FOUND ≈ 已结案但没留痕`（不是"判不了"）。**后果**：① "按卡结案判断画布可否消解"只能靠 `NOT_FOUND` **反推**，不能直接查；② 是 `T-#NO-CARD-INVISIBLE`（无卡不可见）的成因之一；③ `AGENTS.md §五`「做完一项 ⇒ 写回执 + 从 docs/todo.md 删掉那一行」——**删了就查不到**。**修法**：卡 `done`/`void` ⇒ **必须进 `task_history`**（`todo.move_to_history`），不许直接从 `live_cards` 删；**`task_history` 为空 = 红灯**（现在正是空的） | `tasks.db#live_cards` · `tasks.db#task_history` |
| T-#CALLEXISTS-CONST-HANDLER | ★★ **判据种类能力缺陷（静默失效）**：`call-exists` 对 **const 箭头 handler 恒 fail** —— 索引 `nodes` 里没有 `editDslHandler` 这类"const = 箭头函数"的 function 节点 ⇒ 想断言"谁调了 handler"写不出来，只能退化成 `run` 表达式（L4 卡实测如此）。⇒ **一种判据在整类目标上不可用，但不报错、只是恒 fail**（会被误当成"代码真没调用"） | 判据种类 `call-exists` · 索引 nodes |
| T-#CANVAS-CROSS-BOOK | `handlers.ts` 的画布登记在 `feature=task-system-plan`（该册持有此文件），**不是** `agent-io` ⇒ 跨册持有：卡在 A 册、画布在 B 册。需确认这是不是设计使然（若是，`planChangeSetOfCard` 的坍缩集算法要能跨册读） | `tasks.db#plans` · 册持有关系 |
| T-#SCRATCH-BLIND-SPOT | ★★★★ **唯一的盲区：`.agent-io/scratch/`（被 `.gitignore:37` 忽略）**——现算：`ls .agent-io/scratch \| wc -l`（**别抄数字**）。实测跨 7 天、含 `fix-*` / `land-*` / `v-*.log` / `probe-*` / `snip-mem-*` 等家族，最大单文件 4 MB。**含义**：每个一次性脚本 = **一次绕过**（绕过写闸 / 设计线 / 语法门 / 一处权威），因为"写个临时脚本比走 write/edit 快"。⇒ **scratch 是绕道的沉淀池，且 `git status` / `verify` / 清点**全都看不见它**。**要做**：① 每代理一个子目录 + TTL（如 7 天）② 一次性脚本必须**声明用途与判定结果**（否则它和"我随手改的"无法区分）③ 先查 `src/` 里那几处提到 `scratch` 的**是不是真依赖**（若是，它就不是"临时的"，属第二处权威） | `.agent-io/scratch/` · `.gitignore` |
| T-#SEAT-NO-SHELL | ★★ **验收席缺 shell（仪器缺口）**：`seat_acceptance` 只有 read/glob/grep + MCP（design_line/get_dsl/snapshot/index_integrity/run_tests），**跑不了任何命令** ⇒ verify / npm test / lint:prose / git status 全 `UNKNOWN`（`run_tests` 还连超时 4 次）。实测第一次用它：**12 PASS / 0 FAIL / 5 UNKNOWN，那 5 条全是"跑不了命令"**。⇒ 正解不是"回退成我自己跑"，而是**拆两个角色**：席判语义真假 + 派"读数员"只抄读数 | `seat_acceptance` 工具面 |
| T-#DERIVE-TREE-4TH-REGEX | **第四份测试物正则**：`derive_feature_tree.ts:126` 的 `/_test\.(go\|ts\|js\|tsx\|jsx)$/i` —— 「一处权威」卡在收拢索引准入判定时，**交付方的"未合并清单"漏了它**，由验收席抓出（它问的是 feature tree 归类，语义确实不同，但**必须显式列入"不合并清单"**，否则下一轮又会被当成漏网） | `derive_feature_tree.ts` |
| T-#COUNT-NOT-EXACT | **"读数不精确"又一例**：交付方称两份正则「其余 **14 段**逐字相同」——"只有两处差异"成立，但 **14 这个数字不实**（席抽样核实）。⇒ 计数型断言必须**给分母与现算方式**，不许凭印象给数 | 全仓读数口径 |
| T-#TODO-ROW-FUSION | ★★ **`docs/todo.md` 行粘连（重复故障，我自己造成的）**：用 `edit` 时 `old_string` 只取行首一小段 ⇒ 新内容被塞进行中，把后一行的尾巴留在同一行（本次 309 行 = scratch 行 + CODEHEALTH 行残片）。**今日第 2 次**（前一次是整行被吃掉）。⇒ 硬判据：**改完必须回读该行**，且 `lint:prose` 之外再加一条"表格行数 = `^\| T-#` 行数且每行以 `\|` 结尾"的自检 | `docs/todo.md` 编辑纪律 |
| T-#CODEHEALTH-DIRECTION | ★★ **CodeHealth 方向错了（实测 7 个 kind 全是局部/表层）**：`unused_export` `unused_import` `orphan_file` `high_complexity`（**函数级**圈复杂度）`layer_violation` `circular_dependency` `sibling_import`。**缺的恰恰是本仓最痛的**：① 多处权威/重复实现（克隆 Type-1/2/3 可判、Type-4 只给候选）② **文件级**规模与复杂度（不是"函数内分支数"）③ 耦合与不稳定度（Martin Ca/Ce/I/A/主序列距离 D=\|A+I−1\|；CK 的 CBO/RFC/LCOM）④ 设计坏味道（**Shotgun Surgery / Divergent Change**，判据用「**指针复述目标而不是指向目标** ⇒ 复述必漂」—— 这条直接量我们的册）。★ 讽刺点：`cross_repo_symbol_index` 早报"双胞胎（同名同签）"，能力在隔壁、只查同名、没进 code_health | `src/domain/health_spec.ts` · `src/application/cross/index.ts` |
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
