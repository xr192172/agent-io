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
| T-#DTS-INDEX-DRIFT | ★★★ **活的 bug（清点抓到的真漂移）**：「这个文件该不该进索引」有两处且已分叉 —— 权威 `source_exts.ts:274 NOISE_FILE_RE` 含 `\.d\.[cm]?ts$`（T302 扩过），而 `index/watch_project.ts` 的 `SKIP_FILE_RE` 仍只有 `\.d\.ts$`；`import_project.ts:395` 走权威、`shouldSyncRel` 走副本 ⇒ **`.d.mts` / `.d.cts` 一条进索引、一条不进**（`instrument.ts:438` 明确依赖权威那份的覆盖）。**修法**：`SKIP_FILE_RE` 删掉，改 import 权威 | `source_exts.ts` · `index/watch_project.ts` |
| T-#EXT-TABLE-THREE | **同一集合三处落点**（已发生过漂移）：`source_exts.ts:36 TS_JS_EXTS` / `ast_node.ts:32 TS_EXTS:Set`（同 8 项）/ `import_resolve.ts:46 IMPORT_EXTS`（同 8 项，顺序=优先级）；`import_resolve.ts:38-39` 自述漂移史「漏了 .mts/.cts，T36 补齐」。★ 另有**同名不同义**：`ast_node.ts:32 TS_EXTS`=8 项 vs `source_exts.ts:49 TS_EXTS`=4 项（管"插桩能否用 as"）⇒ 取错静默放宽/收窄，**必须改名** | `source_exts.ts` · `ast_node.ts` · `import_resolve.ts` |
| T-#T447-DEAD-CRITERIA | ★★ **死判据（translate 清点时发现）**：`T-#KILL-LEGACY` 的验收条件「保持 t447+t441 双绿」**已不可执行** —— `certs/` 整目录在提交 `72335634`「删掉第三套验证」里被删，`t447/t454/t450/t445/t448` 只出现在 docs 与 src 注释里，**仓里无文件载体**。⇒ 一条验收条件指向不存在的文件 = 死判据。**修法**：改成 `scripts/audit-mech-parity.mjs` 对拍 + 一条 e2e | `docs/todo.md` · `scripts/` |
| T-#LEDGER-CORRUPT-LOSES-DATA | ★★★ **静默丢数据（机制里的，未修）**：`readLedger` 遇到坏 JSON ⇒ 只打 ⚠ 后「**按空台账重扫**」，而 `--submit` 仍会写盘 ⇒ **一次提交把整本已清点表单覆盖成空台账**。★ 这与当初"册损坏必须显形拒覆盖"是**同一个病**（册上修过、台账上又犯一次）⇒ 修法同款：坏 JSON ⇒ **拒绝任何写盘**并点名路径 + 备份原件 | `scripts/inventory-sweep.mjs` |
| T-#PITCH-STALE-CMD | 文档里的命令已漂：`docs/PITCH.md:345` 仍写 `npm run inventory`，现必须 `npm run inventory -- --dir … --ext …`（`--dir` 已改必填）。★ 典型「指针复述目标」⇒ 复述必漂 | `docs/PITCH.md` |
| T-#INVENTORY-TAKEBATCH-EXPECT | `[未核]` 机制里 `takeBatch` 的 3 条 DSL `behavior-cases` 的 `expect` 是"对象的 JSON 字符串"，修复代理本地回放**形态不符**（代码没动，属既有）；其余 12 条回放全过 ⇒ judge 自己的比较口径可能有问题 | `src/**` 判据 · judge 比较口径 |
| T-#SHAPE-DOMAIN-THREE | ★★★ **活的功能缺陷（清点 dsl_ops 时发现，已漂移）**：`shape` 值域三处 —— 权威 `src/domain/geometry.ts:40` 是 **8 值**（含 parallelogram / hexagon / triangle），而 `node_ops.ts:161`、`:385` 手抄 **5 值**，`op_data_spec.ts:89` 的 note 串里又抄 5 值 ⇒ **那三种形状走 `edit_dsl` 在 TS 层就进不来**（tsc 只钉键名 `NODE_DATA_KEYS`，钉不到值域）。**成因**：`node_ops.ts` 被 `tests/p0_incremental_verify.test.ts:63` 登记为 **UNCOVERED_FIXTURE**（无 p0_ 用例）⇒ **无覆盖 ⇒ 漂移无人发现** | `geometry.ts` · `node_ops.ts` · `op_data_spec.ts` |
| T-#OP-SPEC-NOT-SOLE | ★★ **`OP_SPECS` 不是 op 形状的唯一判据**（清点实测，5 处第二检查）：`update_feature.ts:1131-1133`（decision 的 op 白名单手写 + throw）· `task_ops.ts:3168-3170`（task_plan 只许 update + throw）· `task_ops.ts:4325-4327`（todo op 清单第二份 + 兜底 throw）· ★ 另有 **`update_feature.ts:914-916` 是空壳 `if`（无 throw）** —— T170 收敛后的残留，**读起来像判据其实什么都不做 = 假判据**。★ 已确认唯一权威的四处（好消息）：`lifecycle` 只 `assertLifecycle` · `gate` 只 `NODE_GATES` · 进度证据只 `validateProgressEvidence` · dsl_ops 层写授权只 `update_feature.ts:251` 一处 | `op_data_spec.ts` · `update_feature.ts` · `task_ops.ts` |
| T-#READING-SCOPE-PRECISION | ★ 读数必须自带**范围/分母**（A4 的实例）：清点代理写"**全仓**只有 `update_feature.ts:251` 一处 `runDslWriteScope`"，而实测**全仓 12 处**（它其实只在说 `dsl_ops` 层）。⇒ 措辞不精确的读数比没有读数更危险（会被当成"全仓唯一"引用） | 全仓读数口径 |
| T-#CORRUPT-AS-EMPTY-FAMILY | ★★★★ **这不是一个 bug，是一个模式（已三处同型）**：「**读失败 ⇒ 当空 ⇒ 整份覆盖**」——① 设计册（早先修过）② 清点台账 `readLedger`（今天修）③ **产物注册表 `registry.ts:62-64/:121-123`（未修）**：坏注册表 ⇒ `[]` ⇒ `registerArtifactTo` 以「空 + 新条目」**整文件重写** ⇒ **一次注册抹掉其余条目**。★ 结论：**逐处修是错的修法**，应建一条门扫全仓这个模式（判据：对每个 `catch/*坏*/⇒ 空/默认` 的写端，注入坏输入 ⇒ 必须拒写且原文件字节不变） | 全仓（写端） |
| T-#THREE-WALKERS | ★★ **三个走查器、三种口径**（同一问题"磁盘上哪些源码"）：`index_freshness.ts:547/574/602 walkFiles(root,false,false)`（**不传 gitignore**）· `live_render.ts:118-119 walkFiles(…, collectGitignore(root))`（传）· `index_backfill.ts:118/193 getProjectView().sourceFiles`（= `refs_text.ts:64 walkSourceFiles`，**另一套 SKIP_DIR/SRC_EXT**）⇒ **分母各不相同**（backfill 的 total/done ≠ freshness 的 checked） | `index_freshness.ts` · `live_render.ts` · `index_backfill.ts` · `refs_text.ts` |
| T-#SYMBOLS-SILENT-EMPTY | ★★ `symbols.ts` 多处「读失败 ⇒ 空」且后果是**静默缺边**：`:2185-2189`/`:2212-2219`/`:2889-2900`（bindings 坏 JSON 跳过/用原名 ⇒ "读不出绑定"="没有绑定"）· ★ `:1340-1347 changedSymbolNames` 坏列跳过 + 整读失败⇒`[]` ⇒ `refsReopened=0`（消费方 `index_freshness.ts:694`、`watch_project.ts:215`）⇒ **引用方永不重解析** · `:3126-3132 getFileParse` 把「未索引/上次失败/无 file 节点」三态折成 null ⇒ `live_render.ts:139-142` 当"空 API 面"继续 | `symbols.ts` · `index_freshness.ts` · `live_render.ts` |
| T-#INDEX-POLICY-DUP | 索引策略清单**第二份副本**：`watch_project.ts:46 IGNORE_DIRS`（6 项）vs `source_exts.ts:336 INDEX_SKIP_DIR_EXTRA`（同 6 项 + `.idea/.vscode/.backup`）；另 `registry.ts:56-65 readRegistry()` vs `:116-124 readFileEntries(file)` **逐字同体**（只差路径来源） | `watch_project.ts` · `source_exts.ts` · `registry.ts` |
| T-#CALLEXISTS-CONST-HANDLER | ★★ **判据种类能力缺陷（静默失效）**：`call-exists` 对 **const 箭头 handler 恒 fail** —— 索引 `nodes` 里没有 `editDslHandler` 这类"const = 箭头函数"的 function 节点 ⇒ 想断言"谁调了 handler"写不出来，只能退化成 `run` 表达式（L4 卡实测如此）。⇒ **一种判据在整类目标上不可用，但不报错、只是恒 fail**（会被误当成"代码真没调用"） | 判据种类 `call-exists` · 索引 nodes |
| T-#CANVAS-CROSS-BOOK | `handlers.ts` 的画布登记在 `feature=task-system-plan`（该册持有此文件），**不是** `agent-io` ⇒ 跨册持有：卡在 A 册、画布在 B 册。需确认这是不是设计使然（若是，`planChangeSetOfCard` 的坍缩集算法要能跨册读） | `tasks.db#plans` · 册持有关系 |：`unused_export` `unused_import` `orphan_file` `high_complexity`（**函数级**圈复杂度）`layer_violation` `circular_dependency` `sibling_import`。**缺的恰恰是本仓最痛的**：① 多处权威/重复实现（克隆 Type-1/2/3 可判、Type-4 只给候选）② **文件级**规模与复杂度（122KB 的 `refactor/index.ts`、8.8MB 的册；不是"函数内分支数"）③ 耦合与不稳定度（Martin Ca/Ce/I/A/主序列距离 D=\|A+I−1\|；CK 的 CBO/RFC/LCOM）④ 设计坏味道（**Shotgun Surgery / Divergent Change**，判据用「**指针复述目标而不是指向目标** ⇒ 复述必漂」—— 这条直接量我们的册）。★ 讽刺点：`cross_repo_symbol_index` 早报"双胞胎（同名同签）"，能力在隔壁、只查同名、没进 code_health | `src/domain/health_spec.ts` · `src/application/cross/index.ts` |
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
