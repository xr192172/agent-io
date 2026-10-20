# 讨论记录（DISCUSSION）

> ★ **这份文件是干什么的**：记录「我们想清楚了什么」。
> 它不是待办（待办在 `docs/todo.md`），也不是规格（规格在设计 DSL 的 `decision` 里）。
> ★ **新窗口接手时**：先读 `docs/HANDOFF.md`（现在是什么），**再读本文件**（为什么是这样想）。
> ★ 只追加、不改写历史段落；有新结论就在当天段落后面继续加。

---

## 2026-10-19 · 读数快照 / 三方合并 / 任务系统

### 1. 「读数快照过期，不能重算一遍吗？」

**能，而且我们一直在重算**——跑一次 `judgeExpectations` 只要 18 秒。

问题不在「算不算得出来」，在**「算出来存哪儿」**：

- **存进 DSL** ⇒ 从写入那一刻开始倒计时。10-16 存进去的是「12 条红」，今天实跑是「0 条」。
  它不是算错了，它**只能是当时**。
- **不存，要的时候现算** ⇒ 永远是真的，代价是每次 18 秒。

所以修法不是「定时重算再存一遍」（那只是让倒计时重新开始），而是**根本不存，给一个可复跑的入口**。

### 2. 判别标准只有一条：它记的是「事件」还是「现在」

| 东西 | 记的是什么 | 会过期吗 | 处置 |
|---|---|---|---|
| `baseline/`（fork 点） | 我们从哪里出发 | **不会** | 存，且永不移动 |
| `decision_history`（at + 内容） | 谁在什么时候改了什么 | **不会** | 存 |
| 证据（at + 命令 + 读数） | 某时刻跑过什么、看到什么 | **不会**（它自报时刻） | 存 |
| `reading_now` | 自称「现在是 12 条红」 | **会** | ★ **不许存** |

★ 一句话：**「发生过什么」可以存，「现在是多少」只能现算。**
前者不会因为时间流逝而变成假话，后者会。

### 3. 用户的三方合并比喻 —— 对应关系

用户的比喻：*「实际快照是主分支，设计快照是用来修改的分支，主分支被别人改了就得 diff + merge」*。

对应到本仓：

| Git | 本仓 | 谁在写 |
|---|---|---|
| main | `live/<feature>.dsl.json`（实际 DSL） | **机器**（扫描投影，没人手工提交） |
| 修改分支 | `design/<feature>.dsl.json`（设计 DSL） | **人**（+ LLM） |
| merge-base | `baseline/<feature>.dsl.json`（fork 点） | 一次性写入，**永不移动** |
| `git diff` | `scripts/design-diff.mjs` | 只读 |
| `git merge` | `scripts/merge.mjs` | 零写入，只裁决 |

**有一处偏差值得记住**：Git 里 main 是「别人也在提交」，两边都是**人**；
这里 actual 是「**机器扫出来的事实**」，只有一边有意图。
所以裁决规则不是「谁后提交谁赢」，而是 `docs/MERGE.md` 里那套：
**设计领先 / 实际领先 / 未变 / 冲突**（四种组合，只看存在性）。

★ 还有一条：**这个仓的 diff 有三层，别混用**
| 层 | 比什么 | 工具 | 可信度 |
|---|---|---|---|
| 节点级 | 有没有这个文件/decision | `design-diff` | ✅ |
| 符号级 | 签名文本是否一致 | `design-diff --signature` / `rewrite` | ✅ |
| 语义级 | 意图（decision + expectations）是否被实现 | `judgeExpectations`（518 条） | ✅ |

### 4. 项目结构的真实读数（2026-10-19 实测，别背旧数）

```
源码 475 文件 ─① 扫描→ cache.db（637 节点 / 3135 符号 / 1296 依赖）
             ─② 投影→ live/（637 节点 / 1135 边）
             ─③ fork→ design/（618 节点 · 38 张决策卡 · 518 条判据 · 27 条待办）
             ─④ 人写意图
             ─⑤ 生成→ certs/design-db（331 份，与实际 DB 同构）
             ─⑥ 结构重写→ 源码（★ 只改签名；实现永远人写）
```

**数据只在六个地方**（别找第二份）：
`.agent-io/design/`（手写源，进 git）· `.agent-io/live/`（扫描产物）· `.agent-io/baseline/`（fork 点，永不移动）
` .agent-io/cache.db`（事实库，48MB，不进 git）· `certs/design-db/`（设计 DB）· `certs/design-contracts/`（设计侧 TS 符号）

**四道门**：`tsc 0` · `calls 10/10` · `design:check 10/10` · `design:mutate 613 杀死 / 0 存活`
★ 第四道门的真名是 `npm run design:mutate`（不是 `mutate`，那个不存在）。

### 5. 任务系统为什么绕，以及它缺的那条边

一张卡 = **一个节点的意图 + 一组判据**。状态只有四个：

```
candidate ──claim(判据有红)──→ claimed ──complete(判据全绿)──→ done
    └──────────void（target 在 DB 查不到了）──────────────────→ void
```

**两道闸方向相反、用同一把尺**（`cardStanding`）：
- `claim` 问「有活干吗」——只有 `work` / `violated` 才可领
- `complete` 问「活干完了吗」——只有 `satisfied` 才能收口

★ **所以：判据全绿的 candidate 卡，既领不了（没活干），也收不了口（必须领过）。**
它只能 `void`。这就是 OQ1 一直没拍的那条：**「已满足的卡，自动收口还是只提示？」**

**2026-10-19 第一次实证**：修完 validator 之后立卡，17 条判据全绿 ⇒
`claim` 拒（「只可收口，不可领」）· `complete` 拒（「candidate 没有到 done 的可用迁移」）⇒ 卡在中间。

**代价说明**：这次是「先做后立卡」（探索阶段先改了源码）。按「先立卡 → 领 → 做」本可走通。
⇒ ★ **纪律：立卡要早于动手，否则卡一出生就「没活干」。**
但这在真实开发里很常见（先试一下才知道要做什么），所以 OQ1 仍然需要拍。

### 6. 这一轮修掉的（已提交 `d5c5e06c`）

| 漏洞 | 证据 | 修法 |
|---|---|---|
| 读数快照过期 | `reading_now` 说 12 红，实跑 0 红 | 删掉两个快照字段 |
| 不变量 #2 无法判 | `covered_by: null` | `validator` 新增 `validateNoReadingSnapshots` |
| `green_done` 永远不可达 | 一条 type-only 边恒 unsupported | 删掉那条判据，理由移进 `decision.rationale` |
| 判据路径腐烂 | 两条 cmd 读已删除的 `docs/` | 改指 `.agent-io/design/` |

### 7. 还开着的问题（下次接着聊）

1. **OQ1**：已满足的卡，允许直接标 done 吗？（★ 这一条卡住了任务系统的闭环）
2. **`task_plan` 是三无飞地**：不在 `DesignDSL` 类型里、没有 `edit_dsl` 写端、`validateDSL` 不查它
   ⇒ 改它只能手改 JSON。**它是最该被管的一块，反而是唯一没人管的一块。**
3. **`layers[].count` 也是读数**，但 `ArchLayer.count` 是必填类型字段 ⇒ 删它要连带改类型。
4. **`design-line.mjs` 的 ⑥ 仍写死「未实现」**（实际已闭环）。
5. **`task.expectations` 是 `decision.expectations` 的副本** ⇒ 决策改了它不会跟（本轮撞到 4 条 vs 15 条）。
   这是本仓头号病「同一份判据两处存」的活样本。

### 8. 畅想（还没想清楚，先记下来）

- **如果源码真的变成「编译产物」**：那 ⑥ 就不只是改签名——它要能改结构（加/删函数、改参数表），
  实现部分留 `// TODO(设计)` 桩，由人补。这是不是"设计即真源"的终点？
- **如果判据能从 `acceptance` 自动翻译**：现在 518 条判据是手写的，而 `acceptance` 里的话大部分是可判的
  （todo 里 T331 就是这件事）。翻译得出来，判据就不用"想"了。
- **如果卡和决策卡合一**：现在一张卡是决策卡的副本，副本会过期。能不能让卡**直接引用**决策，
  状态只存「领/完成/作废」三个事件？那样就不存在"副本"这回事了。
- **如果 `task_plan` 也进工具**：它现在是手改的 JSON，没有任何闸。它是"设计意图"的一部分，
  却没被当意图对待。

---

## 2026-10-19 晚 · 用户的「直链模型」 vs 现实

### 1. 用户的模型（逐字整理）

> 一切从 AST 解析出发 → 实际侧（DB + DSL）→ 源码一改，watch 增量重算改过的文件 + 可达闭包，
> **秒级保鲜** → 但实际侧不能直接改，所以要一个"新载体"= 设计 DSL（像 Git 分支）→
> **分叉那一刻两边应该完全相同** → 有差异只可能是"有人绕过监管改了实际侧" → 那就 merge 一下 →
> 设计侧写决策卡 → 挂任务 → 契约演算 → 设计 DB → 源码（AST 增删改查，应该很简单）。

### 2. 这个模型哪里对、哪里不成立

**对的部分（不用改）**：整条链的顺序、fork 的语义、merge 的时机、决策卡的位置——全部成立。

**不成立的那一条**：*「分叉那一刻两边相同，之后只有绕过监管才会不同」*。

真实情况：分叉那一刻**确实相同**（fork 就是拷贝），但**从那一刻起两边往不同方向走**——

| | 实际侧 | 设计侧 |
|---|---|---|
| 谁在改 | 机器（源码变 → live 变） | 人（写意图） |
| 改什么 | 事实（文件/符号/边） | 意图（决策/判据/任务） |
| 结果 | 永远等于源码现状 | ★ 有实际侧**从来没有**的东西 |

⇒ 所以「乱七八糟」只有三个来源，不是六个：

1. **意图层**：`decision` / `expectations` / `task` 在 live 侧**根本没有对应物** ⇒ 不是"两边改同一处产生冲突"，
   而是"**一边多了一整个维度**"。merge 只能裁决"同一份数据的两个版本"，裁决不了"单边存在"。
2. **实现边界**：设计 DB 里**没有函数体**（`DSL 只有结构+意图，没有实现` —— 用户自己定的纪律）。
   ⇒ 回写只能改**结构**（签名/增删符号），**不能生成实现**。这不是工具不足，是纪律的直接后果。
3. **历史包袱**：`observe_*` / `patrol` / `signal_review` / `brickify` / `dsh` / `capability_map` ——
   来自"人机协作平台"的尝试，没搭好 ⇒ 现在是链上的旁路。

### 3. 逐条回答那五个疑问

**Q：「AST → 实际侧，这一步有问题吗？」**
只有一处真问题：**跨文件 `call` 边**。同文件调用可靠，跨文件的 23,345 条 `obj.method()`
解不出来（要类型推断，得接 `tsc` 的 LanguageService）。其余（files / nodes / imports / type_ref / bindings）都可信。
⇒ 实际侧不是"AST 的直接投影"，是"**AST + 半个类型系统**"。

**Q：「watch 增量，秒级保鲜按理说能做到？」**
**速度不是问题**：全量扫 528 个文件 = **973ms**（今天实测），秒级完全够。
问题在**触发**：`watch_project` 是一个**要手动 `start` 的 MCP 工具**，不是默认常驻。
★ 未验证：`live/` 的 mtime 是 19:03:51，比最后一次手动 `import_project`（18:40）晚很多，
说明有东西在动它；但**不能据此断定"秒级"**。验证方法：改一个源文件，记时间，看 live 多久变。

**Q：「分叉那一刻应该相同，怎么会有那么多奇怪的东西？」**
见 §2。分叉那一刻**是相同的**；奇怪的东西是**分叉之后**长出来的，而且只在设计侧。

**Q：「就算有区别，merge 一下就好，为什么牵扯那么多？」**
因为 merge 对的是**同一份数据的两个版本**。而设计侧的「意图」在实际侧**不存在**，
那不是冲突、是**单边存在**。所以 `merge.mjs` 的输出是四种组合（设计领先 / 实际领先 / 未变 / 冲突），
其中"设计领先"要靠 **⑥ 回写** 落地，不是靠 merge。

**Q：「设计 DB → 源码，AST 增删改查，应该挺简单？」**
**对符号确实简单**——`buildRefactorPlan`（语法门 + plan_id）+ `applyRefactorPlan`（幂等）今天刚闭环，
注入一条签名差异能改、重复跑不重复改。
但**函数体不在设计 DB 里** ⇒ 能删函数、改签名，**不能凭空生成实现**。
⇒ 这一层的天花板是「结构重写」，不是「代码生成」。**这是你那句纪律定的，不是工具没做好。**

### 4. 一句话总结

> 你的直链**本身没有错**。错的只有一条假设：「分支之后两边还应该一样」。
> 分支之后两边**必然**不一样，因为一边只有事实、另一边多了意图。
> 所谓"乱七八糟"，是**意图层 + 实现边界 + 历史包袱**三样，不是整条链设计错了。

### 5. 下次要聊的

- **历史包袱怎么清**：`observe_*` / `patrol` / `signal_review` / `brickify` / `dsh` ——
  哪些还在用、哪些早没人用但没人敢删？（★ 这是"砍掉一半工具面"的前提）
- **watch 到底在不在跑**：一次可复现的对照（改文件 → 记时间 → 看 live）。
- **94% 没有意图的节点**：是"还没写"，还是"本来就不该进设计 DSL"？

---

## 2026-10-19 晚（二）· observe 线在这条链上的位置 —— 以及「run 契约」的真相

### 1. 用户的问题
> 「observe 线是插桩跑运行契约的，但 DSL 里好像已经有另一种契约了：直接一句话编写契约，
> 然后一次性测试。」

### 2. ★★ 先纠正一个事实：`run` 里只有 7 条真在跑

```
run 类判据 43 条
├─ 读源码文本（readFileSync + includes）  36 条   ← 84%
└─ 真调用函数（跑代码看返回值）            7 条
```

**两种东西套了同一个 `kind`**：

| 形态 | 例子 | 判的是什么 |
|---|---|---|
| 真执行 | `validateDSL(input).keys.some(k => k === 'dangling_edge:...')` | **行为**：给输入，看输出对不对 |
| 读文本 | `fs.readFileSync(f).includes('resolved: false') && ...` | **实现细节**：源码里有没有这句话 |

后者的问题（不是小问题）：
1. **重构就红**：改变量名 / 换写法，行为没变，判据红 ⇒ **假阳性**
2. **判的是实现细节，不是意图** —— 与"DSL 只有结构 + 意图"直接冲突
3. **它会让人以为"测过了"** —— 最难查的一种绿

★ 而且仓里本来就有 `source-has` 这个 kind（4 条），专门干"文本在不在"这件事。
⇒ **这 36 条是 `kind` 装错了**：`run` 的语义是"执行"，它们干的是 `source-has` 的活。
（名称不是同义 —— 又一个实例。）

### 3. observe 在这条链上的真实位置

```
⑥（设计 → 实际）     回写：设计 DB 改源码
observe（实际 → 设计） 回流：跑起来的行为 ≠ 设计 ⇒ 提提案
```

`observe_proposals` 就是**回流通道**：`list / show / approve / reject`，
`approve` 过四层门（L1 规则回归 → L2 LLM 复核 → L3 覆盖校验 → L4 定稿），任一层不过即**冻结**（失败方向恒为"拒"）。
确认人是**下一个接手的 Agent**（与 `review_changes` 同一条规矩）。

**这正是「有人绕过监管改了实际侧」的正式出口** —— 而且比 merge 更早发现：
merge 要比两边的**结构**，observe 直接看**跑起来的行为**。

★ **但它是空转的**：`observe_proposals action=list` ⇒ **0 条**。
回执自己写着："0 条 ≠ 都没问题，只代表没人提过"。

### 4. run 与 observe 的分工（不是替代）

| | `run`（真执行的那 7 条） | observe |
|---|---|---|
| 视角 | **黑盒**：给输入，看输出 | **白盒**：看内部怎么跑 |
| 成本 | 低（跑一个函数） | 高（要插桩 + 真实流量 + 收事件） |
| 能判 | 结果对不对 | 调用路径 / 入参出参 / 耗时 / 缺帧 / 内存 |
| 现状 | 7 条 | 0 条提案 |

⇒ **判结果用 `run`，判过程用 observe**。项目的 43 条契约里，36 条连"结果"都没判。

### 5. 64 个工具按链路位置分类

| 位置 | 工具 | 数 |
|---|---|---|
| ① 扫描/索引 | `import_project` `index_integrity` `code_health` | 3 |
| ② 投影 | `render_design` `get_dsl` | 2 |
| ③ 分支/对拍 | `consistency_check` `detect_drift` `sync_contracts` | 3 |
| ④ 写意图 | `edit_dsl` `design_intent` | 2 |
| ⑤ 设计 DB | `extract_contracts` `contract_page` | 2 |
| ⑥ 回写 | `edit_code` `plan_refactor` `apply_refactor_plan` `snapshot` | 4 |
| ⑥ 扩展（结构重写） | `rename_*` `move_*` `remove_dead_imports` `deprecate_offline` `refactor_pipeline` `refactor_judge` `annotate_functions` `archive` | 10 |
| 对拍/影响面 | `diff_views` `impact_analysis` `find_references` | 3 |
| 门/审核 | `review_changes` `rules` | 2 |
| **observe（实际→设计回流）** | `observe_instrument` `observe_trace` `observe_log` `observe_judge` `observe_proposals` `recommend_observe_points` `behavior_baseline` `feature_line` `memory_observe` `reconcile_chain` `reconcile_effects` | **11** |
| 辅助/自省 | `suggest_renames` `find_similar_names` `structure_gap` `diagnose` `diagnose_loop` `upgrade` `gateway_provider` `tool_usage` `capability_map` `capability_audit` `next_hop_args` `first_hop_args` | 12 |
| 其他 | `canvas_notes` `narrate_step` `read_project_docs` `run_tests` `translate_go_ts` `go_originals` `cross_repo_symbol_index` `harvest_decisions` `harvest_closure` | 9 |

★ 结论：**链上必需的约 31 个**（①②③④⑤⑥ + 对拍 + 门），其余 33 个里，
11 个是 observe（有用但空转），22 个是辅助/历史。

### 6. 我的判断（待用户确认）

1. **`run` 的 36 条读文本判据应该改成 `source-has`** —— 它们不是测试，是文本断言。
   混在 `run` 里会让人以为"行为被测过了"。
2. **observe 值得留，但要用对地方**：只在"过程本身是需求"时才用
   （例：这个操作必须走 3 步、必须不重试、必须不超 200ms）。
   日常"结果对不对"用 `run` 就够，别为它插桩。
3. **回流通道（`observe_proposals`）现在 0 条，不是"没问题"，是没人跑。**
   如果这条链要闭环，它必须被真的用起来——否则"实际侧改了设计不知道"永远无解。

---

## 2026-10-19 晚（三）· 修正：「36 条是 grep」不是装错 kind，是**没得选**

### 1. 上一节的判断要改
上一节我写「那 36 条装错了 kind（该是 `source-has`）」。**这个判断不准。**
看过实现后，真正的原因是**能力缺口**，不是写的人偷懒：

```js
new Function('input', 'root', 'validateDSL', 'fs', 'path', `"use strict"; return (${e.expect});`)
```

`expect` 的求值域**只有这 5 个名字**：
`input` · `root` · `validateDSL`（★ 硬编码注入的唯一可调函数）· `fs` · `path`

**没有 `import` / `require` ⇒ 调不到项目里任何模块。**

所以 43 条的分布是被这个约束**完全决定**的：

| 写法 | 条数 | 原因 |
|---|---|---|
| `validateDSL(input).keys.some(...)` | **7** | 唯一能调的函数 |
| `fs.readFileSync(f).includes('...')` | **36** | 调不了 ⇒ 只能读文件 |

★ 而且 2026-10-18 有一条注释自己写着：*「求值域扩到 fs / path —— "读文件 / grep" 类债也能配 run」*
⇒ 那次扩展等于**官方承认了「跑不起来就读文件」**。

### 2. `run` 的语义只兑现了一半

| | 内容 |
|---|---|
| 设计注释写的 | 「所有行为契约的本质 = **给输入 ⇒ 断言输出**」 |
| 实现做到的 | 「给输入 ⇒ 对 **`validateDSL`** 或 **文件文本** 断言」 |

⇒ 用户要的「喂边界值测它」，**现在结构上做不到**：不能 import 目标模块，就没有"它"可测。

### 3. 要补的话，缺的是 `target`

```json
{ "kind": "run",
  "target": { "module": "src/domain/task_machine.ts", "fn": "isClaimable" },
  "input": "satisfied",
  "expect": "result === false",
  "why": "已满足的卡不可领" }
```

判定器：`await import(module)` → `fn(input)` → 把 `result` 注入求值域。
边界值覆盖 = **一条边界一条判据**：

```
"satisfied" → false ／ "work" → true ／ "violated" → true ／ "done" → false ／ null → ？（空值）
```

### 4. 但更深的坑：有些模块**根本没有可测接口**

能被这样测的，只有**导出且无副作用**的函数。
那 36 条 `readFileSync` 判据对应的目标，很多是**内部语句**（例：`dsl.annotations.push(...)`），
不是导出函数 ⇒ 即使给 `run` 加上 `target`，它们**依然测不了**。

⇒ 所以有两层缺口，不能混为一谈：
1. **判据层**：`run` 的求值域太窄（可修，加 `target`）
2. **模块层**：没有留下"从外面调用"的纯函数接口（要改代码结构，代价大）

★ 第 2 层才是根本：**"设计说必须有这句话"和"这个行为可以被调用验证"是两件事。**
现在的 518 条判据里，大部分只能验前者。

---

## 2026-10-19 晚（四）· 契约能不能从 AST 自动抽出来？—— 能，实测了

### 1. 用户的问题
> 「契约就是一个函数：它声明需要什么、吐出什么。能不能在 AST → DB 中间加一个环节，
> 让 DB 直接拥有这个契约？」

### 2. 实测：AST 里本来就有，只是没人抽

用 `parseAstRoot` 现场解析 `src/application/design/api_signature.ts`：

```json
{ "name": "extractFuncName",
  "params": [{ "name": "sig", "type": ": string", "optional": false }],
  "returns": ": string" }
```

⇒ **参数名 / 类型 / 可选性 / 返回类型，AST 一次就能给全。**
不是"能不能抽"，是"抽出来了没人用"。

### 3. 但**不该**存进 DB

★ 理由就是今天刚学到的那条：**结构化契约是 `signature` 的派生量**。
- DB 里已有完整签名（2379 个 function，**无签名 0**）
- 再存一份解析结果 ⇒ 两份会不同步（活样本：`task.expectations` 是 `decision.expectations` 的副本，一个 4 条一个 15 条）

⇒ 正确落点：**`parse/` 里加一个与 `type_members.ts` 并列的函数**，需要时现场抽。

```
parse/
├─ kernel.ts          signature（字符串，已有）
├─ type_members.ts    类型的字段/方法（已有）
└─ params.ts          函数的形参/返回  ← 只差这一个
```

★ 而 `type_members.ts` 的「已知边界」里**自己写着**：
> *「方法的形参不在这里 …… 形参列表/参数类型【未提取】」*

⇒ **这不是新需求，是已登记、只做了一半的活。**

### 4. 还差一块：`exported`

要有形参还不够——能 `import` 才谈得上"喂输入"。而 `ParsedSymbol` **没有 `exported` 字段**。
⇒ 三个字段凑齐（`params` + `returns` + `exported`）才构成可执行的契约。

### 5. 拼起来就是「契约测试生成器」

```
params + returns + exported
        ↓  生成调用代码（import → fn(边界值)）
        ↓  观测输出
   不崩 / 类型对 / 语义对
```

- **能自动的**：边界值构造（空串 / 0 / 最大值 / 类型错）、调用、捕获异常、类型检查、纯性检查
- **必须人写的**：语义期望（`"f(a)"` 该返回 `"f"` 还是 `"f("`，只有人知道）

⇒ 完整形态：**机器造边界值并跑，人只写"这个输入应该输出什么"**。
那句人写的话，正是现在 `run.expect` 在做的事——只是它现在**没有东西可跑**。

### 6. 覆盖面（实测）
```
2379 个 function，签名全部完整
├─ 886 个（37.2%）参数全是简单类型  ← 立刻可自动做
├─ 1300 个 参数含对象/复杂类型      ← 要先造夹具
└─ 207 个 返回 void                 ← 只能看副作用
```

---

## 2026-10-19 晚（五）· `run` 会不会被替代？签名算意图还是事实？

### 1. `run` 的存废：**概念留，实现扔**

| | 契约测试（自动） | `run`（人写） |
|---|---|---|
| 知道什么 | 只知签名 | 知道**意图** |
| 能抓 | 崩 / 类型错 / 不纯 | **语义错** |
| 抓不到 | `extractFuncName("f(a)")` 返回 `"x"`（类型对但答案是错的） | 形状问题 |

⇒ 一个函数可以「形状全对、语义全错」，契约测试永远抓不到。
⇒ `run` 的「给输入 ⇒ 断言输出」**不可替代**；该扔的是它的**实现**（`new Function` + 5 个名字）。

替换后的形态：
```
契约执行器（params + returns + exported → 生成调用 → 跑）
        ↓ 把 result 注入求值域
run.expect = "result === 'f'"     ← run 还在，但终于在做名字说的事
```
★ **抽出来的是「执行能力」，不是「这个 kind」。**

### 2. 签名是「意图」还是「事实」？—— 是**意图**

- 设计侧写 `cardStanding(card: TaskSpec): Standing` = **它应该长这样**
- 源码里的实际签名 = **事实**
- 两者一比，差的就是要重写的地方（`rewrite` 已闭环）

⇒ 设计 DSL **该存签名**；不该存的是"从源码抽出来的结构化契约"（派生量，会不同步）。

### 3. ★★ 但由此浮出一个更麻烦的事：**94% 的节点可能就是"事实的副本"**

不变量 #4 写着：**「设计侧不复制事实（能由 DB 现算的字段不许落盘）」**。

而 618 个设计节点里，约 580 个是 fork 那一刻从源码**拷过来的**——名字、路径、符号、边，之后没人碰过。
它们与不变量 #4 **直接冲突**。

**为什么一直没被发现**：因为「拷贝的事实」和「意图」**长得一模一样**——
都是 `signature: "extractFuncName(sig: string): string"`。从字段形状上，分不出
"我想让它这样"（意图）和"它本来就这样"（事实）。

⇒ 所以用户那个问题（94% 空白是"还没写"还是"不需要写"）**可能是第三种答案**：
**那 94% 现在是一份事实的副本，既不是意图，也不该算"设计"。**

如果这个判断成立，结构该变成：**没被改过的节点不该是"节点"，只是"引用"**
（像 Git 不会把没改过的文件存两份）。

★ 不确定的地方（七成把握）：`geometry` 里的 `x / y / label` **确实是人的劳动**（摆画布也是设计），
所以"纯拷贝"和"被摆过"的边界在哪，还没想清楚。**这条待定，不要当成结论用。**

### 4. ★★★ 实测结果：上一个"不确定"有答案了

对比 `design/` 与 `baseline/`（fork 点）的 `geometry.nodes`：

```
baseline 640 节点 · design 618 节点
├─ 内容 + 布局都一模一样   580   ← 连 x/y 都没动过
├─ 只动了布局               0    ← "摆画布"这件事根本没发生过
├─ 内容改过（有意图）       37
└─ fork 后新增              1
```

⇒ **设计 DSL 的真实形态 = 实际 DSL 的全量副本 + 37 处批注。**

- `x/y` 不是人摆的（否则"只动布局"不会恰好是 0），是扫描时算的
- 那 580 个节点**自 fork 以来一个字节都没变**
- ⇒ 用户问的「94% 是还没写还是不需要写」，答案是**第三种**：
  **它们是一份事实的副本，既不是意图，也不该算设计。**

★ 而且这与不变量 #4「设计侧不复制事实」**直接冲突** —— DSL 第二次违反了自己写的规矩
（第一次是读数快照）。

### 5. Git 比喻唯一不成立的地方：**Git 只存差异，这里存全量**

| | Git 的分支 | 这个设计 DSL |
|---|---|---|
| 存什么 | **只存差异**（对象共享，没改的不重复存） | **全量拷贝** |
| 改 37 处之后 | 37 个新对象 + 指针 | 618 个节点，581 个是副本 |
| 代价 | 几乎为零 | 4.5 MB，且"哪些是意图"看不出来 |

⇒ Git 干净不是因为 merge 强，是因为它**从不复制没变的东西**。
这个 DSL 每次 fork 把整个实际侧搬一遍 ⇒ 意图与事实混在一个文件里，字段形状还完全一样。

---

## 2026-10-19 晚（六）· `run` 的正确定位：它补的是「值对不对」

### 1. 四层分工（用户的话，精确化后）

| 层 | 验什么 | 谁做 | 例子 |
|---|---|---|---|
| 1 | **不崩** | 机器（自动） | `fn('')` 不抛异常 |
| 2 | **类型对** | 机器（自动） | 返回的确实是 `string`，不是 `undefined` |
| 3 | **值对** | **人（`run`）** | `fn('f(a)') === 'f'` |
| 4 | **纯** | 机器（自动） | 同输入两次，结果一样 |

★ 用户原话：*「如果没有补的话，就只能证明这个项目没有崩坏、没有裂变、只是实现了功能，
但不能证明这个契约是完全正确的，需要我们手写一份这个预期的返回类型。」*

**这句是准确的**，只把「返回类型」改成「返回值」：**类型是机器验的，值是人写的。**

### 2. 由此得出 `run` 的形态：人写三条，机器补十条

```json
{ "kind": "run",
  "target": { "module": "src/application/design/api_signature.ts", "fn": "extractFuncName" },
  "cases": [
    { "input": "f(a)",  "expect": "f" },       ← 人写：正常路径
    { "input": "",      "expect": "" },        ← 人写：空值边界
    { "input": "无括号", "expect": "无括号" },    ← 人写：退化形态
    { "input": null },                         ← 机器补：类型错，只要求"不崩"
    { "input": 123 },                          ← 机器补：同上
    { "input": "x".repeat(1e6) }               ← 机器补：超长，只要求"不崩"
  ] }
```

**判据**：有 `expect` ⇒ 必须相等；没 `expect` ⇒ 只要求不崩 / 类型对。

⇒ **穷举交给机器，判断交给人。** 人的工作量是"想清楚 3 个有意义的样例"，不是"穷举所有边界"。

### 3. 这也解释了那 36 条 `readFileSync` 为什么别扭

它们是在**没有执行能力**的前提下，被迫用"看代码"代替"看结果"。
有了执行能力，其中大部分应该重写成 `cases`。

---

## 2026-10-19 晚（七）· ★ 修正：我上一条说错了 —— 「存差异」是把查询当成了结构

### 1. 用户的反驳（逐字）

> 「你说设计 DSL 应该像 Git……但如果它像 Git 一样，那你能看见原设计的整个全貌、然后再改吗？
> 那你还不是只能自己想当然地往上改。我拿 Git 对比，只是因为它**在合并、冲突的处理上**有相似的地方。」

### 2. 错在哪：把「存储」和「视图」混成一件事

- Git 的**仓库**只存差异（对象共享）
- Git 的**工作区**是全貌（你打开文件看到的）
- `git diff` 看"改了什么"，`cat` 看"现在什么样" —— **这两件事 Git 本来就分开**

而设计 DSL 的工作方式是**工作区**：要改一个签名，得先看见它现在的符号、边、布局。
**看不到全貌就没法设计。** ⇒ **全量不是浪费，是工作区。**

### 3. 修正后的分工

| 维度 | 做法 |
|---|---|
| 给人看 / 改 | **全量**（用户对） |
| 判断"哪些是人写的" | 每次拿 `baseline` **现算**，**不落字段** |

`baseline/` 是 fork 那一刻的全貌，**永不移动** ⇒ "这个节点被改过吗" = `design[i]` vs `baseline[i]`。
这是**派生量** ⇒ 符合「读数不落盘」（今天刚立的纪律）。

★ 而且这件事**已经在做**了（就是上一节的 580 / 37 统计）。

**所以：不加字段、不删节点。**
我上一节说「删掉没意图的、只存差异」，是把一个**查询**当成了**结构**——
查询随时能做，结构一改就回不去。

### 4. 顺手补了 merge 的短板

`merge.mjs` 现在只能裁决「存在性四组合」，因为它比不了内容（`semantic.files` 是旧快照）。
但 `geometry.nodes` **是可比的**（HANDOFF §4 标 ✅）。

⇒ 以 `baseline` 为基准，merge 能回答现在答不了的问题：

> **「这个节点，设计侧动过、实际侧动过、还是两边都动过？」**

这才是三方合并真正需要的信息。现在的 merge 只知道"有没有"，不知道"谁动的"。

### 5. 最终结论（替换上一节的结论）

> **94% 是 fork 带来的底色，7% 是人的笔迹。**
> **底色不是违规；违规的是"分不出笔迹"。**

- 全量拷贝**保留**（工作区必须看得见全貌）
- 笔迹**用 baseline 现算**（不落字段，避免过期）
- 我之前那句「94% 是副本、违反不变量 #4」**撤回**：不变量 #4 针对的是
  *"能由 DB 现算的字段落盘"*（如 `reading_now`），而节点全量属于**工作区**，不是快照。

---

## 2026-10-19 晚（八）· merge 做完了：从「看起来在工作」到「真判据」

### 1. 动手前的判断（用户）
> 「不能静默合并——那样会导致静默地合并别人的信息，而且完全绕过任务系统，
> 既做不到协作，也没有理由，只仅仅修改了源码，一点可追溯的方向都没有。」

⇒ 这条决定了 merge 的形态：**只判、只列待裁，不做合并**。

### 2. ★ 前四版在骗人（全部实测）

| # | 病 | 后果 |
|---|---|---|
| 1 | 只比「有没有这个文件」 | 37 个内容被改过的节点**一个都没报**；屏幕显示「0 冲突 / 354 未变」 |
| 2 | `startsWith('src/')` | `certs/` `scripts/` `third_party/` 的 **178 个文件（35%）直接不比较** |
| 3 | 「都有 = 未变」 | 内容变化被吞掉 |
| 4 | `label` 不剥派生 | `"node_ops.ts · 2 APIs"` 里的 `·2 APIs` 是派生的 ⇒ 把"实际侧新增了函数"误报成"设计改过" |
| 5 | `base` 缺位时不判新增 | `pool.ts` 实测 `base=null`、design 有意图、live 有 ⇒ 被误报成**冲突** |

★ 第 5 条是今天最典型的一次：**`base` 不存在时，三态比较根本没有基准**，
而代码默认把它当"两边都改了"。修法是先判"有没有共同祖先"，再判"谁改的"。

### 3. 新版判据

每一侧相对 base 只有三态 `absent / same / changed` ⇒ 9 种组合归成 10 类：
`designAhead` `onlyOurs` `designDeleted` `actualAhead` `onlyTheirs` `actualDeleted`
`conflict` `converged` `bothAdded` `unchanged`

- 内容字段 = `label`（剥掉 `· N APIs`）/ `type` / `status` / `description` / `content` / `attributes` / `sub_dsl`
- **`decision` / `task` 不参与**（天然只住设计侧；参与的话 38 个节点全会假"设计改过"）
- **全量比较**（不再默认 `src/`），`--dir=` 可限定

### 4. 读数（2026-10-19 19:55）

```
base 531 · ours 509 · theirs 528 · 并集 551 个文件节点
设计领先 11 · 真冲突 0 · 实际新增 19 · fork 后新增 1 · 未变 497
```

★ **19 条「实际新增」全是今天写的 `scripts/*.mjs` + 2 个 `.tmp-*.mjs`**
—— `scripts/merge.mjs` **自己也在里面**（自指）。这说明判据确实在数全量，不是在数"它以为该数的"。

### 5. 立刻暴露的一个尴尬

这次改的是 `scripts/merge.mjs`，但**设计侧没有这个文件的节点** ⇒ **挂不上任务卡**。
而它恰好就是"待裁 19 条"里的一条 —— **第一件要办的事，就是决定这些工具脚本要不要进设计**。

★ 这就是 dogfooding：**你想给工具走流程，工具说"你自己还没入册"。**

---

## 2026-10-19 晚（九）· 概念澄清：三方是「三份 DSL」，不是「三份 DB」

用户问：*「每一次生成设计 DSL 的时候都保存一版基线 DSL 吗？基线保存原来的原 DB？
实际侧保鲜的时候还要和原 DB 对比，是这意思吗？」*

**三处都要纠正**：

| 问的 | 实际 |
|---|---|
| 「每一次都存一版基线」 | **只有 fork 那一次**，之后 baseline 永不写 |
| 「基线保存原 **DB**」 | 存的是 **DSL**（`live/<f>.dsl.json` 的副本） |
| 「保鲜时和原 DB 对比」 | **不比**。保鲜是单向流水线 |

### 1. 时间轴

```
t0 (fork)：源码 → cache.db → live ─┬─ 复制 → design/
                                  └─ 复制 → baseline/   ← 从此不再写
t1 (现在)：源码变 → cache.db → live（变）   ·   design 被改（变）   ·   baseline 不变
```

### 2. 保鲜 vs 对比（两件不同的事）

```
保鲜（单向，一直在跑）        对比（按需，读的时候才跑）
源码 → cache.db → live         live   vs baseline ⇒ 实际动过没
                               design vs baseline ⇒ 设计动过没
```

★ **保鲜从不看 baseline**。若它看了并照着改，就是"自动同步"⇒ 差异消失 ⇒ 设计不存在了。
（这正是用户前面否掉的那个方案。）

### 3. 为什么 baseline 必须"永不移动"

如果 baseline 跟着实际侧更新，那"实际侧动了没"就永远量不出来——因为它每次都不等于"现在"。
**这仍是同一条纪律：事件可以存（fork 点），读数不能存（现在是多少）。**

★ 实例：`board/pool.ts` 在 baseline 里**不存在**（fork 后才加的文件）⇒ 尺子没有原点 ⇒
三方判定退化成"两边各自新增"（第一版误判成冲突）。**尺子只有自己不动才量得准。**

### 4. 三种对比，三个粒度（别混）

| 工具 | 比谁 | 粒度 |
|---|---|---|
| `merge` | live vs baseline、design vs baseline | **文件级内容**（label/status/description） |
| `design-diff` | design vs live | **节点 / decision 级** |
| `rewrite` | 设计 DB vs 源码现场解析 | **符号级**（签名） |

⇒ 「三方」= **live / design / baseline** 三份 **DSL**。
DB 只有两份：`cache.db`（实际）与 `certs/design-db`（设计）。

### 5. 纠正：基线侧**也有 DB**，而且「函数签名不缺参数」

`ls .agent-io/baseline/` 实测：

```
task-system-plan.dsl.json     1.8MB   10-18 00:51
task-system-plan.facts.json   367KB   10-18 00:51   ← 基线 DB
```

`facts.json` 结构：`{ version, feature, saved_at, source_root, files: { 路径: { apis: [...], deps: [...] } } }`，
**443 个文件，`apis` 里是完整签名**。⇒ 三侧都有 DSL + DB，用户说得对。

★★ **但「cache.db 的签名丢了参数」是个误读，要纠正**：

```
function  cardStanding    cardStanding(card: TaskSpec, opts: StandingInput): Promise<StandingVerdict>  ✅ 完整
function  extractFuncName extractFuncName(sig: string): string                                          ✅ 完整
class     Camprobe        Camprobe()                                                                    ← 退化
```

- **函数签名两侧都完整**（cache.db 与 baseline.facts 一样）
- **只有 `class` / `interface` / `type` 退化成 `Name()`** —— 这是内核的归一化，不是"丢参数"
- ⇒ 「基线 DB 比实际 DB 更可信」**不成立**；那 1,180 条「不可比」的真正来源是**类型成员拿不到**，
  也正是 `type_members.ts` 存在的理由

### 6. ★ 基线什么时候移动（用户裁定，精确化）

用户原话：*「实际侧和基线的差异为零。设计侧可能还有没做完的设计，但是实际侧的修改全都被合并进去了
以后，这个基线就应该移动了。因为基线还是要立足实际的，它只是为了保证实际受到改动后你能发觉到。」*

判据：

```
baseline 可前移到 live ⟺
  actualAhead == 0  ∧  conflict == 0  ∧  onlyTheirs == 0  ∧  actualDeleted == 0

★ designAhead / onlyOurs 不算（那是 ⑥ 还没落地的活，不阻塞基线）
```

**为什么**：baseline 的职责是"发现实际侧被动过"。一旦每处实际改动都被设计侧回应，
旧出发点就没用了——留着只会让下一次 merge 把"已经处理过的事"再报一遍。

**当前读数**：`actualAhead 0 · conflict 0 · actualDeleted 0 · onlyTheirs 19`
⇒ **只差那 19 条**，而它们全是今天写的 `scripts/*.mjs` + 2 个 `.tmp-*.mjs`。
⇒ **卡住基线移动的，正是"工具脚本算不算产品"这个问题。**

---

## 2026-10-19 晚（十）· 工具面收敛：第 1 步做完，第 2 步发现「两个实现对同一问题给出不同答案」

### 1. 工具面审计（64 脚本 × 64 工具）

| 类别 | 例 | 结论 |
|---|---|---|
| **壳脚本**（工具完全覆盖） | `impact.mjs` / `structure_gap.mjs` / `snapshot.mjs` | ✅ **已删**（第 1 步） |
| **同能力两实现** | `design-diff.mjs` ↔ `diff_views` · `contract-calls.mjs` ↔ `consistency_check` | ★ 见下文 |
| **设计链核心（无工具）** | `fork-design` `sync` `merge` `rewrite` `gen-design-db` `design-line` `verify` | 第 3 步要收成 1 个工具 |
| 一次性摆证 | 11 个 `probe_*.mjs` | 应移出 `scripts/` |

### 2. ★★ 第 2 步的反转：`diff_views` 已实现三方，但判据有误

`diff_views`（工具）**早就有三方对比**，比我新写的 `merge.mjs` 功能更全（文件/符号/API/依赖/行数五层）。
但对同一份数据，两个结论不同：

| | `diff_views` | `merge.mjs` |
|---|---|---|
| 冲突 | **3** | 0 |
| 修改 | **58** | 11 |

**取证**（`src/domain/expectation.ts`）：

```
base  : lines 206, 4 symbols, label "expectation.ts · 9 APIs"
ours  : lines 206, 4 symbols, label "期望（判据的类型定义处）"   ← 设计只改了 label
theirs: lines 281, 4 symbols, label "expectation.ts · 9 APIs"   ← 实际涨了 75 行
```

⇒ 设计侧**只改名字**、实际侧**只改内容**——这是**两个维度**，不是冲突。
而 `diff_views` 三个"冲突"全是这个形状（`design_lines == baseline_lines`，`live_lines` 变了）。

⇒ **两个实现各错一半**：

| | 比 label | 比行数/符号 | 冲突判定 |
|---|---|---|---|
| `diff_views` | ✅ 算改动 | ✅ 算改动 | **过宽**（不同维度也判冲突） |
| `merge.mjs` | ✅ 算改动 | ❌ 不比 | **过窄**（实际改行数不报） |

### 3. 正确的判据：按维度分别判

```
命名维度（label / description / status）     ← 人改的
结构维度（lines / symbols / apis / deps）    ← 机器扫的
符号维度（signature，按 kind 决定可比）       ← rewrite 已经在做

同一维度两边都改且不同  ⇒ 真冲突
不同维度各自改          ⇒ 两条独立待裁项（不冲突）
```

★ 这跟 `design-diff` 的 `COMPARABLE` 表（按 kind 决定可比性）是**同一个抽象**。
我们已经有对的写法，只是**没推广到 merge**。

⇒ 所以第 2 步不是"删一个留一个"，而是 **把"按维度判"这条判据统一进 `diff_views`**，
再删掉 `merge.mjs` / `design-diff.mjs` 两边的重复实现。

### 4. 第 1 步的成果（已提交 `6d8471fc`）

删 `impact.mjs` / `structure_gap.mjs` / `snapshot.mjs`；npm 入口保留但改指 CLI。
`scripts/*.mjs` 58 → 55。门全绿（tsc 0 · calls 10/10 · design:check 10/10 · mutate 613/0）。

---

## 2026-10-19 晚（十一）· 第 2 步：判据按维度拆开（commit `cdadaea5`）

### 1. 真正的病根（比"两个实现"更准）

`diff_views` 里：

```js
desChanged = fileChanged(...) || fileDecisionChanged(...) || symbolsDecisionChanged(...);
desEqLiv   = 结构相等 && !symbolsDecisionChanged(des, liv);
// 两个布尔一相与 ⇒ conflict
```

**`decision` 天然只住设计侧。** 把它算进"内容是否一致"，等于：
**只要这张卡有决策卡、实际侧又动过 ⇒ 一定冲突** —— 38 张卡里谁动谁中。

### 2. 修法

- 新增 `metaChanged`（命名维度：`layer` + `responsibility`，★ 剥掉 `— N 个 API` 派生段）
- 新增 `structChanged`（结构维度：`lines` / `symbols` / `apis`）
- `ThreeWayState` 新增 **`both_moved`**：两侧动的是不同维度 ⇒ 两条独立待裁项，**不是冲突**
- `conflict` 只在【同一维度】两边都改时成立

### 3. 读数

```
conflict 3 → 0 ／ both_moved 3 ／ 意图增量 25 / 实现增量 34 不变
三态验证：改前 3 条判据全红 → 改后全绿
门：tsc 0 · calls 10/10 · design:check 10/10 · design:mutate 616 杀死 / 0 存活
```

### 4. ★★ 第一次走通完整任务生命周期（先卡后改）

```
决策卡（summary / rationale / consequences / acceptance + 3 条可判判据）
  → publish   （candidate，判据 3 红 ⇒ 有活干）
  → claim     （work，owner=workbuddy）
  → 改代码
  → judge     （3 绿 ⇒ satisfied）
  → complete  （L2，evidence=expectations）
```

★ 与今天上午那次**反序**（先改代码、后立卡 ⇒ 一出生就 satisfied ⇒ 撞 OQ1 死锁）形成对照：
**顺序本身就是判据。** 先立卡 ⇒ 判据必然是红的 ⇒ 任务有活 ⇒ 走完全程。

### 5. 第 2 步还差最后一下

判据修好了，但两个实现**仍并存**：
`merge.mjs`（文件级、带"待裁"语义、带基线移动判据）与 `diff_views`（五层、工具面）。
⇒ 要么把"待裁 + 基线移动判据"加进 `diff_views`，要么让 `merge` 只做视图层。
**下一步要选一个，不能两个都留着。**

---

## 2026-10-19 晚（十二）· 收尾：合并语义并入 `diff_views`，删除 `merge.mjs`（`3939b636`）

### 1. 并入的两块语义

```ts
baselineAdvanceBlockers(summary): string[]
// 基线可前移 ⟺ live_only=0 ∧ conflict=0 ∧ both_moved=0 ∧ deleted_from_live=0
// design_only / added / removed 不阻塞（那是 ⑥ 未落地的活）
```

输出加 `three_way.baseline_can_advance{ok, blockers, note}`，文本直接给阻塞项：

```
★ 基线不可前移：live_only=34（实际改了，设计没跟）· both_moved=3 · deleted_from_live=2
```

★ **只判不写** —— 前移等于"宣布新出发点"，必须有决策卡。

### 2. 删 `merge.mjs` 后的口径变化（重要）

`diff_views` 报 `live_only=34`，而 `merge.mjs` 报 `onlyTheirs=19`。
**差在 15 个"实际改了内容、但文件没增删"的**——`merge.mjs` 只比文件级字段，漏了行数变化。
⇒ **工具的宽口径更准**（"实际侧被动过"就该报）。

### 3. ★ 撞到两个结构问题

**① `done` 的卡不能重翻**
`publish` 被拒：*"覆盖它等于把已完成/正在做的判据换掉"*；而 `release` 只能 `claimed → candidate`。
⇒ **同一节点的第二个工作项无处安放**（节点一卡、卡只四态）。
本次绕开：`decision` 更新到 5 条判据，`task` 卡停在 3 条 —— **如实记录不一致，不假装同步**。

**② `decision update` 的 `expectations` 是整体替换**
只传 2 条 ⇒ 静默冲掉之前 3 条（实测：5 条变 2 条，无任何报错）。
⇒ ★ **纪律：改 `expectations` 必须传全量。** 这是"合并语义只覆盖了顶层字段、子字段仍整体替换"的坑。

---

## 2026-10-19 晚（十三）· 第 3 步开张：`design_line` 工具 + ⑥ 变成真读数

### 1. 搬完第一个 action

`scripts/design-line.mjs`（105 行，纯读）→ 工具 `design_line`：
- `lineReport(root, feature)` 是**纯函数**（给 root + feature，返回结构化读数）；handler 只做入参适配
- 六步各给 `{id, name, by, status, reading}` + `tally{ok, missing, pending}`
- **只读**：不碰 DSL、不碰源码

### 2. ★ ⑥ 从「未实现」变成读数

旧脚本对 ⑥ 只能打印：`未实现 —— 这是 VISION.md §6 的"接入重构线"`。**那是一句装饰**：读的人拿不到任何数。

现在：

```
覆盖：设计 DB 338 份 / 源码 459 文件 = 73.6%；★ 未覆盖 128 个
```

★ 这是**计数级**，不是符号级（符号级差分归 `rewrite` / `design-diff`）—— 边界写进 description，不让读的人以为它全比了。

### 3. ★ T20 闸的「鸡生蛋」

T20 要求：写 `semantic.files` 前必须**现取该文件的事实**（cache.db 里有 `matched_path`）。
但**新文件还不存在 ⇒ 取不到事实**。而"设计先行"恰恰要在实现之前写设计。

⇒ 这一轮绕开方式：**先建空壳文件（一行注释）→ 重扫 → cache.db 有行 → 建节点 → 立卡 → 实现**。
⇒ ★ 记一笔：**这条闸让"新建文件的设计"必须先有文件，与"设计先行"有张力**（未改闸，先记）。

### 4. 第二次走完整生命周期

```
空壳 → node.add + file.add（两个 op 必须同批，否则 anchor_broken）
→ decision（3 条判据）→ publish（file-exists 绿 / 2 条 symbol 红 ⇒ 有活）
→ claim → 实现 → judge 3 绿 → complete（L2）
```

### 5. 顺带踩的两个坑

- `node.layer` 只认 `main|error|detail`（**不是** `core`）；`arch_layer` **不是** node 的合法键
- `file.add` 需要 `id`（约定 `file_<路径的 / 和 . 换成 _>`），且必须与 `node.add` **同批**

### 6. 进度

工具面 **64 → 65**。设计链 6 个脚本已搬 1 个（`design-line` → `design_line`），
剩 5 个：`fork-design` / `sync` / `design-diff` / `gen-design-db` / `rewrite`。

---

## 2026-10-19 晚（十四）· T20 到底在防什么？—— 以及它为什么挡得住「新建文件」

### 1. T20 的用途（读代码得到，不是猜）

`fileFacts(root, file)` 从 **cache.db** 取该文件的**事实**：

```
apis[]       顶层 API（name / signature / start_line / end_line）
deps[]       本文件 import 了谁
matched_path 实际命中的 file_path（null = 库里没有这个文件）
```

T20 要求：**改 `semantic.files` 之前，`matched_path` 必须非 null，且该路径要在 `evidence` 里声明。**

为什么？因为设计 DSL **不再存事实镜像**（`actual_apis` / `actual_deps` 已移除）。
⇒ 你写 `expected_apis`（"它该有哪些 API"）时，如果没先读"它现在有哪些"，
**你写的就是想象，不是设计**。用户 2026-10-01 原话：*「编辑时强制读双编」*。

### 2. 它为什么挡得住「新建一个文件」

闸的隐含假设是：**所有文件都已经存在**。
新文件不在 cache.db ⇒ `matched_path` 为 null ⇒ 被判「凭空写」。

而「设计先行」恰恰要在实现之前写设计——**这时"凭空"是必然的**。

### 3. 我的判断：不该按"必须有现状"，该按"必须有依据"

- 闸的本意是**拦"没有依据"**，不是拦"凭空"
- 对新建文件，唯一可能的依据就是**期望本身**
- ⇒ 正确判据：**新建的设计节点必须带一条 `file-exists` 期望**（"我期望它存在"）

这样依据从「现状」变成「期望」，而期望正是设计。**这条我还没改**（改闸是另一件事，要单独一卡）。

### 4. 本轮顺手做掉的一件（`3e38223e`）

`design_line` 的 ⑥ 覆盖率原本从副本首行 `//` 注释里正则抠路径 —— **那是给人看的，格式一变读数就断**。
⇒ 让 `gen-design-db` 输出 `path` 字段，消费者读字段（旧产物仍可退回注释解析）。

```
覆盖：设计 DB 339 份 / 源码 459 文件 = 73.9%（此前 338 / 73.6%）
★ 341 个文件的 diff 只有一种变化：每份多一行 "path"
```

---

## 2026-10-19 晚（十五）· 修 T20（`14cf4d3b`）—— 充分条件被当成必要条件

### 1. 用户问「为什么会出现这种情况」

```
本闸想拦的：  没有依据就写设计
它实际用的判据：fileFacts(p).matched_path !== null（库里有这个文件）

「库里有该文件」⇒「有依据」    ✅ 大致成立
「有依据」     ⇒「库里有该文件」 ❌ 不成立 —— 新建时依据是【期望】，库里必然没有
```

⇒ **一个充分条件被当成了必要条件。**

为什么会写成这样：T20 是 2026-10-05 在**移除事实镜像**之后加的，当时要治的病是
“有人不看代码就写 `expected_apis`”。**“新建文件”这个场景当时没被想到**，
它的适用边界（只覆盖“改已有文件”）从来没写进代码。

### 2. 三处修正

| # | 改什么 | 为什么 |
|---|---|---|
| 1 | **新建放行**：`库里没有 + 已声明` ⇒ 放行，记进 `notIndexed`，**回执点名**「已按【新建】处理，不代表读过现状」 | 新建没有现状可读；硬拦只会逼人造空壳骗闸（**仪式，不是纪律**） |
| 2 | **`delete` 不参与本闸** | add 断言「它该存在」· update 断言「它是什么」（要看现状）· delete 断言「它**不该**存在」（**不需要现状**） |
| 3 | **L4 复用同一判断**：`existsFn` 加 `notIndexed.includes(ref)` | 不加这条，新建的 evidence 会被 L4 打回 —— ★ **同一个假设（文件必须已存在）住在两处** |

第 3 条是这次最值得记的：**T20 和 L4 是同一道墙的两段**。修的时候不能只修一段，
但也不能两边各判一次 —— 让 T20 判一次，L4 吃结论（**一处判断、两处消费**）。

### 3. 四个场景都真跑过（不是推演）

```
A 新建 + evidence        ⇒ 通过 + 回执点名「按【新建】处理」     ✅
B 新建 无 evidence       ⇒ 拒（缺「现取到事实 + 在 evidence 里声明」）✅
C 改已有文件 无 evidence ⇒ 拒                                     ✅
D 删从未索引的路径        ⇒ 通过（不再被 T20 拦）                  ✅
```

★ 场景 D 是改的过程中才发现的：**清理一个从未入库的探针节点，也会被本闸拦**，
只能编一条 evidence 才过得去 —— 那是**为流程服务的假证据**。

---

## 2026-10-19 晚（十六）· 第 3 步第 2 个 action：`gen-db`

### 1. 搬家的判据是「逐字相同」，不是「看起来对」

```
旧 scripts/gen-design-db.mjs 跑一遍 → 340 份 md5 → hash-old
新 design_line action=gen-db 跑一遍 → 340 份 md5 → hash-new
diff = 0
```

★ 为此一个格式细节都没"顺手优化"：`JSON.stringify(…, 2) + '\n'`、键的插入顺序、
`outNameOf` 的替换规则、可选字段"空就不写"。

### 2. `design_line` 变成 action 分派

```
action=report（默认）  只读六步读数
action=gen-db          写 certs/design-db/；check=true 只比对不写、也不清理陈旧
```

剩下的 `fork` / `sync` / `diff` / `rewrite` 都按这个形状加。

### 3. ★ T20 修复的第一次真实使用

给 `gen_design_db.ts` 建节点时**文件还不存在** —— 旧闸会拒（必须先造空壳）。
现在直接通过，回执点名「已按【新建】处理」。**不用再造仪式性的空壳文件。**

### 4. 边界（写进代码注释，不让调用方以为它全管）

- 只处理 `description` 以 `src/` 开头的节点（其他目录不进设计 DB）
- `symbols` / `imports` / `calls` 的事实取自 `cache.db`（设计 DSL 不存符号级事实）
- `check=true` 不写盘、不清理陈旧

### 5. 进度

设计链 6 个脚本：搬完 **2**（`design-line` → `report`、`gen-design-db` → `gen-db`）。
`scripts/*.mjs` 58 → **53**。工具面 65（`design_line` 一个工具承载两个 action）。
门：tsc 0 · calls 10/10 · design:check 10/10 · mutate **626** / 0 存活。

---

## 2026-10-19 晚（十七）· 先搬「判据」而不是「脚本」

### 1. 为什么顺序反了

准备搬 `rewrite` 时发现它 `import './lib/symbol-diff.mjs'` —— **判据住在 `scripts/lib/`**。
而 ⑥ 的执行器在 `src/application/design/` ⇒ **src 不能反向依赖 scripts**。

⇒ **判据住在 scripts，等于"工具面没有判据"。** 所以这一卡先搬判据，编排下一卡再搬。

### 2. 搬家判据：读数**逐项相同**

```
OLD(scripts/lib):        scanned 333 · same 2386 · differ 0 · uncompared 1972
  按 kind              const 693 / interface 996 / type 179 / interface(局部) 12 / method 82 / class 10
NEW(src/…/symbol_diff.ts) 完全一致（逐项）
```

判定逻辑**一个 if 都没改**，三条纪律原样保留：
① 可比性由 `kind` 决定 · ② `uncompared` 显式报数 · ③ 按 `line 距离最近` 配对。

### 3. 顺手改对的一处（且证明等价）

`sourceRelOf` 改为**优先读 `path` 字段**（今天刚让 `gen-design-db` 写它），
只在旧产物没该字段时才退回解析首行 `//` 注释。

★ 读数**不变**（333/2386/0/1972）⇒ 这条改动等价，不是"顺便改了行为"。

### 4. 两个消费者的 import 改指向 dist，然后删 lib

`scripts/rewrite.mjs` · `scripts/design-diff.mjs` → 动态 `import(dist)`。
删 `scripts/lib/symbol-diff.mjs`（目录一并删空）。删后两个脚本读数仍 2386 / 0 / 1972。

★ 这条纪律值得单独立住：**判据只能住在 src**。scripts 可以是"薄投影"，但**不能持有判据**——
否则"谁在判"这件事就有两个答案。

---

## 2026-10-19 晚（十八）· 第 3 步第 3 个 action：`rewrite`

### 1. 判据：零写入读数与脚本完全一致

```
旧 scripts/rewrite.mjs:  2390 same · 0 differ · 1980 uncompared · 0 designOnly · 0 sourceOnly
新 action=rewrite:       完全相同
```

（数字从 2386 涨到 2390，是因为中途多搬了两个文件节点的副本，不是行为变化。）

### 2. 编排只做四件事

```
diffSymbols → 三种结论分类 → buildRefactorPlan（语法门 + plan_id）
            → applyRefactorPlan（幂等）→ ★ 落盘后重算复核
```

★ 后两个函数**照搬不另造**：⑥ 的落盘纪律（原子性 / 幂等 / 篡改检出）已经住在那里，
重写一遍就会分叉。

### 3. ★ 默认零写入

`apply` 不传 = 只看。**一个会把源码改掉的动作，默认必须是"只看"。**
`apply=true` 才落盘；落盘后 `diffSymbols` 再跑一次，`afterDiffer > 0` ⇒ `ok=false`（不能算成功）。

### 4. `design_line` 现在是三个 action

| action | 干什么 | 写盘？ |
|---|---|---|
| `report` | 六步读数 | ❌ 只读 |
| `gen-db` | 设计 DSL → 设计 DB | ✅ 写 `certs/design-db/` |
| `rewrite` | ⑥ 设计 DB → 源码 | ✅ **但需 `apply=true`** |

### 5. 一个反复踩的坑

python 三引号里的 `\\n` 会被解释成**真换行**，拼进 TS 就变成未闭合字符串。
连续踩两次（`gen-db` 那次 + 这次）。★ **以后改 TS 里的 `\n` 一律用 Edit，不用脚本拼。**

---

## 2026-10-19 晚（十九）· 第 3 步第 4 个 action：`diff`（这一卡踩了三个坑）

### 1. 读数与旧脚本完全一致

```
只在设计侧 4 · 只在实际侧 17 · 内容不同 46
边：扫描遗漏 22 · 真要建 0 · 只在实际侧 25
```

★ 搬家纪律：`checkEdgeInSource` 的**浅正原样保留**（它自己写着“不做完整 AST”）——
换 AST 会改行为，那不是搬家。`--write-plan` 不搬（清单现在由 `buildRefactorPlan` 现算）。

### 2. ★ 坑一：判据写弱了 = 恒真

第三条写成 `source-has must: ['diff']` —— 那个字符串在 `index.ts` 里到处都是
（`diff_views`、注释里都有）⇒ **判据恒真** ⇒ 卡一出生就 `satisfied` ⇒ 又撞“没活干”。

⇒ 改成 `must: ['designDiff', 'design_diff']` —— **只有注册了才会出现的标识符**。

> **判据必须「只有做了才会绿」，不然就是装饰。** 这是今天第二次撞到同一件事
> （上一次是 `design-line` 的 ⑥ 写死“未实现”）。

### 3. ★ 坑二：我把顺序做反了

先写了实现、后立卡 ⇒ 判据只剩“注册”这一步能红。**如实记录，没有为了凑绿灯去造判据。**

### 4. ★ 坑三：`edit_code` 依赖 `dist`，而 `dist` 被我编译坏了

TS 报错时 `dist/` 里留下了语法错的 `index.js` ⇒ **连编辑工具自己都加载不起来**（鸡生蛋）。
只能先用 Edit 手修源文件、再重建 dist。

⇒ **改 TS 里的 `\n` 一律别用脚本拼** —— python / node 的转义层级太容易叠错，
这次连 `String.fromCharCode(10)` 都绕进去了。

### 5. `design_line` 现在四个 action

| action | 干什么 | 写盘 |
|---|---|---|
| `report` | 六步读数 | ❌ |
| `gen-db` | 设计 DSL → 设计 DB | ✅ |
| `rewrite` | ⑥ 设计 DB → 源码 | ✅ 需 `apply=true` |
| `diff` | 节点级 diff（+/-/~） | ❌ |

---

## 2026-10-19 深夜（二十）· 设计链 6 个脚本：4 个搬进工具，2 个删除

### 1. 最终处置

| 脚本 | 处置 | 理由 |
|---|---|---|
| `design-line.mjs` | → `action=report` | 纯读，最好搬 |
| `gen-design-db.mjs` | → `action=gen-db` | 读 DSL + cache.db，写生成物；输出逐字相同 |
| `rewrite.mjs` | → `action=rewrite` | 编排只有四步；判据已先在 src |
| `design-diff.mjs` | → `action=diff` | 节点级 id 列表是它独有的 |
| `fork-design.mjs` | ★ **删除** | 三步全废，且第③步会毁 design-db |
| `sync.mjs` | ★ **删除** | `--apply` 绕过 `edit_dsl` 的全部闸 |

### 2. ★ `fork-design` 为什么该删（不是搬）

它的三步分别被替代，而第③步**有害**：

```
③ 调用 fork：写 certs/design-db/<a-b>.calls.json 的 {calls, removed}
   而 gen-design-db 写同一批文件的 {path, symbols, imports, calls, requirements}
   ⇒ 同名同目录、格式不同 ⇒ 跑一次就把 366 份覆盖成"只剩 calls"
```

**证据**：现有 366 份里「有 `removed` 字段的 = 0」「有 `symbols` 的 = 343」
⇒ ③ **从来没跑过**（跑了就会留下 `removed`，且 `symbols` 会消失）。

### 3. ★ `sync` 为什么该删（比上面更严重）

```js
const { updateFeature } = await import(dist/.../update_feature.js);   // 直接调底层
await updateFeature({ feature, agent: 'sync-script', operations: [...] });
```

**没有 `reason`、没有 `evidence`、不过 T20、不过 L4** —— 静默删设计节点，无审计、无理由。
`edit_dsl` 上那三道闸（变更原因 / 证据可回溯 / 先取事实）在这条路径上**全部失效**。

而它的读数部分（待补/待清）已被 `action=diff` 覆盖，且 diff 是**全量**（它只比 `src/`）。

### 4. 留下的缺口（如实记录）

> **「批量删孤儿节点」现在没有安全的一键路径** —— 只能逐条走 `edit_dsl`（带 reason + evidence）。

★ 这是**有意的**：删设计节点是危险动作，它就该有理由、有证据、有审计。
要恢复一键能力，应该**做一个走 `edit_dsl` 的工具**，而不是绕过它调 `updateFeature`。

### 5. 这一轮的收尾数

```
scripts/*.mjs        58 → 49（9 个脚本消失）
design_line          4 个 action（report / gen-db / rewrite / diff）
工具面               65
门                   tsc 0 · calls 10/10 · design:check 10/10 · mutate 636 / 0 存活
备份                 _labs/dsl.backup-20261019-224322.json（md5 0da15f80，623 节点 / 45 decision）
```

---

## 2026-10-19 深夜（二一）· T20 正式化：从「豁免」到「依据」（`7702b91c`）

### 1. 上午那版只是豁免

```
库里没有 + 已在 evidence 声明 ⇒ 放行 + 回执点名
```

那只是"允许你过去"，**没有回答"你凭什么说它该存在"**。

### 2. 正式化

> **本批 `node.add` 的 `data.decision.expectations` 里必须有一条 `file-exists` 指向该路径。**

那是"它应该存在"的**依据** —— 也正是「设计先行」该有的样子。

★ 为什么要求**同一批**：`node.add` 的 data 可以直接带 decision；若分成两批
（先 node 后 decision），T20 跑的时候 DSL 里还没有那个节点 ⇒ 查不到期望。

### 3. 两场景真跑过

```
A 新建 + file-exists 期望 ⇒ 通过   ✓
B 新建 + 无期望          ⇒ 被拒   ✓（报错文案已补一句指向该做法）
```

### 4. ★ 这一笔没有任务卡 —— 缺口有了真实成本

`handlers.ts` 上那张卡（T20 的边界）已经 **done**，而：

```
publish 对 done 卡：拒（"覆盖它等于把已完成/正在做的判据换掉"）
release：只能 claimed → candidate
⇒ 同一节点的第二个工作项，无处安放
```

上午记这个缺口时它还是个"理论问题"；今晚它挡住了一笔真实改动。
**我没有为了凑流程去伪造一张卡** —— 等"done 卡可重开"补上，这一笔该补卡。

★ 这给下一步排了序：**`done` 卡可重开 > `task_plan` 写端**。
理由：写端影响的是一块数据，重开影响的是**每一条后续改动能不能有卡**。

---

## 2026-10-19 深夜（二二）· `done` 可重开（`cf8e9b1f`）—— 以及门第一次先于我

### 1. `t_reopen`（done → claimed）

```
guard：owner 必填（谁接手）· reason 必填（为什么重开）· CAS state=done
```

`TERMINAL_TASK_STATES` 从 `['done','void']` 改成 `['void']`（done 可迁出了）。
★ 顺带发现：这个常量**此前零消费者**（grep 只命中定义行）—— 一直是装饰。

### 2. ★ `edit_dsl` 的 op 判据原来有**三份**，而且已经漂了

| 住处 | 状态 |
|---|---|
| `OP_SPECS` | 真判据 |
| zod 的 `z.enum([...])` | 硬编码，**缺 `void`** ⇒ 该操作根本调不通 |
| 两处手写文案 | 各写一份，互不一致 |

漂的后果：报错只说「类型/取值不符：operations」，**不说是哪个 op**。

⇒ zod 改成 `z.string()`，判据回到 `OP_SPECS` 一处（`checkOpSpec` 报错会列全合法值）。
★ 代价：MCP 面的“可选项自动补全”没了 —— 但那份可选项本来就是第二份判据。

### 3. ★★ design:check 第一次先于我发现自己漏了

加完 `t_reopen` 后 **D4b 红了**：

> 每条 `ready` 迁移必须有 `executor`（指向 `task_ops.ts` 里的真实函数）

我漏了 ⇒ 补 `executor: "reopenTask"`；**D9**（程序自洽：有判据 fail 就不算自洽）随之转绿。

**这是今天唯一一次“门比我先发现问题”。** 之前所有缺陷都是我撞出来的 —— 这次是门抓的。

### 4. ★★ OQ1 的影响面比原来估计的大

实测链：

```
reopen  ✓
release ✓
publish ✓（重翻 3 条判据）
claim     ✗ 拒（satisfied，没活干）
complete  ✗ 拒（candidate → done 被 OQ1 blocked）
```

⇒ **OQ1 不只挡“先做后立卡”，还挡「重开一个已经干完的活」。**

当前：`handlers.ts` 的卡停在 **candidate + satisfied**，无路可走 —— 如实留在那儿等 OQ1。

★ 这反过来印证了 OQ1 的优先级：它现在同时挡住**新活的追溯**和**旧活的补账**。

---

## 2026-10-20 早（二三）· OQ1 裁定：显式收口，以及「判据能自动化到哪一层」

### 1. 用户的问题引出了今天最重要的一张表

> "程序对任务的判断准确性到多少？如果每环节都做得更完美，能不能避免风险？"

**不能。** 因为「完美」需要一把尺去量，而**那一层的尺不存在**。但程序的判断力是**分层**的：

| 层 | 能自动判吗 | 谁在判 | 证据 |
|---|---|---|---|
| 事实在不在（文件/符号/调用） | **能，接近 100%** | 文件系统 / AST | 昨天 3 条判据全绿无争议 |
| 判据有没有被写死 | **能** | `mutate` | 637 杀死 / 0 存活 |
| **判据选的「尺」对不对** | **不能** | 只有意图（人/LLM） | `'diff'` 恒真，mutate 是绿的 |
| 判据实现（`isSatisfied` 这类） | **部分**（要另做实现层变异） | — | 未覆盖 |

### 2. 量化「尺选得宽不宽」

`source-has` 判据的 `must` 串在目标文件里出现几次 —— 这是可以数的：

```
both_moved   11 次   ← 11 次都在讲同一个分类 ⇒ 判据可能仍然有效
diff         21 次   ← 大部分与"action=diff 已注册"无关 ⇒ 判据无效（恒真）
designDiff    2 次   ← 可用
declaredNew   3 次   ← 可用
```

⇒ **计数能报警，不能判定**。「这 11 次是不是同一件事」需要语义理解 —— 那是 LLM 的事。

⇒ 完整的自动化形态：

```
程序：判事实 · 数次数 · 跑突变 · 报"尺可能太宽"
LLM ：选尺 · 复核报警 · 宣布完成
```

**全程没有人，但每一步都有主体。** 这不叫「人不负责」，叫「责任链没有断点」。

### 3. OQ1 裁定（`81139d84`）

> 原问法：自动收口 还是 只提示？
> **裁定：显式收口** —— `complete` 允许从 `candidate` 起步。

三个理由：

1. 一张卡若一出生就 `satisfied`，则「领」没有意义（`claim` 会拒它）⇒ 必须留一条「不领也能收口」的路
2. 那条迁移**原本的第二条 guard 就写着**「不得由 patrol 直接置 done」—— 自动收口恰恰把主体拿掉了
3. 而「显式」的主体**可以是 LLM** ⇒ 与「全自动」并不矛盾

### 4. ★ 顺带补上的追溯缺口

`evidence` 此前**只在 attestation 时记 `by`** ⇒ expectations 收口的卡看不出「谁宣布的」。
现在所有 kind 都记：

```json
{ "kind": "expectations", "at": "...", "by": "llm", "agent": "workbuddy", "verdict": "pass" }
```

★ 没有这个字段，「显式」和「自动」在数据上**无法区分** —— 那裁定就落不到实处。

### 5. 实测

```
reopen ✓ → release ✓（candidate + owner=null）→ complete ✓（done + owner 仍 null）
```

一张**从没被领过**的卡，现在可以收口，而且能查出是谁收的。

★ 过程中 L3 闸两次拦住我（`release` 的 reason 没写实体名）—— 不是 bug，是它在尽职。

---

## 2026-10-20 早（二四）· 实现层变异：先夹具，再变异（`6d3554da`）

### 1. 用户问「变异是怎么个变异法」

**不是「删掉已有代码」**，是**改一个运算符**：

```
'&&'   → '||'      后态全过 ∧ 前态无红  →  或
'every'→ 'some'
'==='  → '!=='
```

但真正的问题不是「怎么改坏」，而是 —— **改坏之后谁来发现？**

现有 `design:check` 不碰它，`mutate` 只测 DSL 判据 ⇒ **改坏了没有任何东西会红**。
⇒ 所以顺序必须是：**夹具 → 变异 → 看红**。没有夹具的变异，测的是「有没有人看」。

### 2. 夹具（`npm run design:fixture`，4 场景）

对着 `cardStanding` 的 4 个分支各写一条，**只钉 `standing`，不钉 `reason` 文案**（文案会改，判据不会）：

| # | 场景 | 期望 |
|---|---|---|
| F1 | 后态全过 + 前态无红 | `satisfied` |
| F2 | 后态有红 | `work` |
| F3 | 后态全过 + 前态红（`edge-absent` 但边存在） | `violated` |
| F4 | 零判据 | `unknowable` |

### 3. ★ 第一版夹具写错了 —— 而错法和昨天那条判据是同一族

我拿 DSL 的一条边（`from`/`to` 是**节点 id**，如 `file_src_xxx`）去造 `edge-absent`：

```
判据"通过" ⇒ 拿到 satisfied（期望 violated）
```

根因：`edge-absent` 比的是 `fileFacts(from).deps` —— **解析后的文件路径**，
节点 id 永远不在里面。

> **DSL 边的 `from`/`to` 与文件依赖的 `from`/`to` 长得一模一样，语义完全不同。**

这是「名字像 ≠ 同义」的又一例。改用 `fileFacts(HANDLERS).deps[0]` 才通。

### 4. 变异验证

```
=== → !==   ⇒  F1 satisfied→blocked ✗ · F2 work→satisfied ✗ · F3 violated→blocked ✗ · F4 不变 ✓
3/4 红 = 变异被杀死 ⇒ 夹具对该实现敏感
还原后 4/4，grep MUTANT = 0
```

### 5. 这一补的边界（不吹）

昨天那张表里「判据实现」是**部分（未覆盖）**。现在它有了**一个可跑的夹具 + 一次变异验证**
——但只是 **`cardStanding` 的一个分支条件**这一点，不是整格。

`claimTask` / `completeTask` / `releaseIfExpired` / `redAttribution` 这些实现**还没有夹具**。
⇒ 这一格的路是「逐个补」，不是「一次点亮」。

---

## 2026-10-20 早（二五）· 分层验证：平时跑契约，收口时跑变异（`9c6c0a51`）

### 1. 用户提的方案

> "源码编译就一次就够了吧。就是交任务的那一次，对它进行局部的单点式的单元测试，
> 然后平时的话就是跑契约，看看它有没有回归。"

**方向对**，实测成本也支持：

```
全量 tsc              7.4 秒
交任务时 3 个变异点   ≈ 22 秒（一次性，可接受）
平时                  不编译
```

### 2. 但有一个洞：平时跑契约，抓不到「实现回归」

| 门 | 抓什么 |
|---|---|
| `contract:calls` | 调用边**在不在**（结构） |
| `design:check` | 迁移/判据自洽（设计） |
| `design:mutate` | 判据**恒不恒真**（判据） |
| **都不抓「实现逻辑对不对」** | ← 洞 |

⇒ 补法很便宜：**把夹具也放进 `verify`**（`ts` 门已经在前面 ⇒ `dist` 是新的，夹具只要 134ms）。

现在两层齐了：

| 层 | 跑什么 | 抓什么 |
|---|---|---|
| 平时 `verify` | ts · 工具签名 · Go×2 · **实现夹具** | 结构 / 契约 / **实现（已覆盖部分）** |
| 交任务 `complete` | + **局部变异**（改这个文件的运算符 → 跑夹具 → 必须红） | **这个改动被测到了** |

### 3. ★★ 顺手撞出的账：总门一直是红的

加夹具门后跑 `npm run verify`，`结构意图 gap` **FAIL**：

```
Error: Cannot find module 'scripts/structure_gap.mjs'
```

那个脚本 **2026-10-19 已随「它只指向已删的 tests/」一起删掉**，而 `verify.mjs` 里那道门没删
⇒ **这道门从此永远 FAIL**。

> **更值得记的是：昨天我只跑了自己挑的 4 道门（tsc / calls / design:check / mutate），
> 就宣布「全绿」——而总门 `npm run verify` 一直是红的。**

「没报错」与「没跑」长得一样。**以后报账一律以 `npm run verify` 为准，不再自己挑子集。**

### 4. 当前总门（5 道，全部真跑过）

```
PASS  ts 类型          4977ms
PASS  MCP 工具签名      862ms
PASS  Go 编译           682ms
PASS  Go 静态检查       275ms
PASS  实现夹具          148ms   ← 新增
```

---

## 2026-10-20 早（二六）· 增量编译（`07442d45`）+ 「全语言通用」的方向

### 1. 干了什么（一行配置）

```
tsconfig: "incremental": true · tsBuildInfoFile → node_modules/.cache/（已 gitignore）
```

| | 之前 | 之后 |
|---|---|---|
| 全量 tsc | 7375 ms | — |
| 增量 tsc | — | **2241 ms** |
| verify 里的 ts 门 | 4957 ms | **1547 ms** |
| verify 总 | ~7 s | **4413 ms** |

### 2. ★ 先验证它没漏错

"变快"也可能是"没真编"。所以注入 `const __probe: number = 'oops';`：

```
src/_probe_bad.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
```

删掉后无输出。⇒ 增量没漏。

★ 这条纪律来自本仓最贵的一课：**「没报错」与「没跑」长得一样**。

### 3. ★★ 用户的要求：「这个项目要全语言通用」

这直接决定了 C1 **该怎么写**：

> 增量是 **tsc 专属**能力 ⇒ **不许塞进通用层（verify / gates）**。

现在 C1 只是 `tsconfig` 里的一行 + 一句注释（写明"这是 TS provider 的实现细节"）。

**现状盘点**（老实说）：

| 已经有 | 还没有 |
|---|---|
| `verify` 的 `GATES` 是数组，TS 门与 Go 门**并列** ⇒ 多语言形态 | 「编译」这个动作**没有抽象** |
| `parse/languages.ts` 已有语言表（扩展名 / 解析器 / 语言包） | 语言表里**没有**「编译器」「测试运行器」这两列 |

**因此真正的「全语言通用」不是"支持更多语言"，而是"把语言能力做成一张表"**：

```
语言能力表（每行一种语言）
  ext[]        扩展名
  parser       解析器（tree-sitter-<lang>；加载失败要显式报）
  compiler     编译器（TS: tsc --incremental · Go: go build · Python: 无）
  testRunner   测试运行器（TS: node --experimental-strip-types · Go: go test）
  probes       该语言支持的探针（observe 用）
```

★ 这一步**没做**，只记方向。它的前提是"先有 C2 的变异链"——
因为只有真的跑起来，才知道 `testRunner` 那一列到底需要什么形状。

---

## 2026-10-20 早（二七）· 体检「还有多少正则」+ 可变异点抽取（`msg46` 那笔）

### 1. 用户问：还有多少功能是正则解析、建在 DB 上、或有漏字段？

扫描候选（同时有 `readFileSync` + 正则匹配）**12 个**。但扫描器只是候选生成器，逐条判：

| 文件 | 用正则干什么 | 判定 |
|---|---|---|
| `refactor/edit/remove_dead_imports.ts` | 匹配 `import ... from "X"` 并**删除** | ★ **真问题**：改代码用正则，字符串/注释里的 import 也会命中 |
| `refactor/find/find_references.ts` | `\bneedle\b` 找引用 | ★ **真问题**：漏（别名/解构/动态）+ 误报（注释） |
| `refactor/find/field_refs.ts` | `\.field\b` 找字段 | ★ **真问题**：同上 |
| `design/derive/*`（3 个）· `meta/registry/*`（2 个）· 其余 | 读 JSON / 生成文本 | 合理（不是解析源码） |

⇒ **结论：12 个候选里 3 个是真问题**，且全在 `refactor/` 下（**改代码**和**找引用**这两类最不能靠正则）。

★ 已知的第四处是 `design/line/design_diff.ts#checkEdgeInSource`（浅正则判"源码里有没有引用"）——
它自己在注释里写着"不清 AST"，属于**已声明的债**。

### 2. C2a：从树里抽可变异点

`src/infrastructure/parse/mutants.ts` + `kernel.ts#parseTreeForFile`（5 行薄入口）。

**树本来就现成**：`parseFileFull` 每次解析都拿到，抽完 4 类就丢了；
`binary_expression` 在 `kernel.ts` 里**此前出现 0 次** ⇒ 是**没抄**，不是 AST 给不了。

### 3. ★★ 分水岭，用数据说话

```
task_machine.ts
  可变异点（AST）：19 个 · 偏移全部命中（slice 出来正好是运算符）
  全文 ===/!== ：33 次
  ⇒ 差 14 处，在【注释/字符串】里
```

**正则会把那 14 处也改掉；AST 只给真的运算符。**

### 4. 边界（写进注释，不假装全语言）

- `binary_expression` 是 tree-sitter-javascript/typescript 的叫法；Python 是 `comparison_operator`
  ⇒ **其他语言要各自一张表**，「全语言通用」在这里的落点就是这张表
- 只抽比较运算符；`&&`/`||`、常量、返回值是后续算子
- **不动 `ParsedFile` 契约**（550 个消费者）

### 5. 顺带：T20 正式化第一次拦住我

建 `mutants.ts` 节点时忘了在同批 `node.add` 的 data 里带 `file-exists` ⇒ **被拒**。
补上后放行，回执点名「已按【新建】处理」。**门槛按设计工作了。**

---

## 2026-10-20 早（二八）· 实现层变异器 —— 第一次量出「覆盖率 47%」

### 1. 工具

```
scripts/impl-mutate.mjs（npm run design:impl-mutate）
  extractMutants（AST）→ 改一个 → 增量编译 → 跑夹具 → 必须先红 → 还原
  默认前 3 点 · --line=N 试 N±3 · --all 全跑
  ★ 还原在 finally 里兜一次；跑完比对 md5（byte-for-byte）
```

### 2. ★★ 第一次量出真实覆盖率

```
task_machine.ts · 19 个可变异点
  杀死 9 · 存活 10        ⇒ 覆盖 47%
  还原 ✓ byte-for-byte
```

**那 10 个存活点全在 `claimTask` / `releaseIfExpired` / `redAttribution` 一带** ——
正好是我昨天说过"还没有夹具"的那几块。**工具没骗人，它把欠账指出来了。**

⇒ 这就是「程序托管」需要的度量：**不是"有没有测"，是"测到了百分之几"**。

### 3. ★ 一个我自己判错的地方（订正）

第一版把「变异体编译不过」单列成 `broken` —— **既不杀也不活，等于把它放过了**。

⇒ 订正：**编译不过 = 程序起不来 = 被检出 = 杀死**（错误第一行仍打印，便于区分类型错与真异常）。

订正后：`杀死 7→9 · 存活 10 · broken 2→0`。

★ 这个错误和本仓反复出现的那族一样：**多出来的一个中间态，往往就是"放过了"**。

### 4. 关于「AST 中心」的三个实测（回答用户 2026-10-20 的设想）

| 设想 | 实测 |
|---|---|
| 全量树存一层，工具直接运算 | `parse` 单文件 **2.2ms**（550 文件约 1.2s）；树 `JSON.stringify` 能出 80KB，但 `children` 是 getter ⇒ **还原不成树**。**重新 parse 比读 JSON + 重建更快** |
| 比写文件快得多 | 变异本身**不写文件**（`applyMutant` 纯函数）；但**执行**必须落盘（Node 从文件系统加载） |
| 所有语言翻译成同一门语言 | 统一的是**形状**，不是节点名（TS `binary_expression` / Python `comparison_operator`）⇒ 像 LLVM IR：形状统一、指令集不同 |

⇒ 结论：**树值得"内存缓存"，不值得"持久化"**；真正的收益是**一致性**（一套遍历 API），不是速度。

### 5. 边界（不吹）

- `extractMutants` 只认 TS 的 `binary_expression`；其他语言要各自节点表
- 只变异比较运算符（`&&` / 常量 / 返回值是后续算子）
- **没挂 `complete`**（改闸风险大，下一步）

---

## 2026-10-20 早（二九）· 补 `nodes.members` —— 以及「判据绿了但数据是空的」

### 1. 补了什么

`type`/`interface` 的 `signature` 一直是 `Name()`（成员全丢），而 `parse/type_members.ts`
**早就能提取** —— `kernel` 抽 symbols 时**没调它**。⇒ 接上，落 `nodes.members`（JSON）。

### 2. ★ 两个坑（都不是代码 bug，是默认值）

| 坑 | 表现 | 正解 |
|---|---|---|
| `import_project` 的 `max_files` **默认 200** | 清库后只回填 200 个文件，`task_machine.ts` 不在里面 | 传 `max_files=10000` |
| `SCHEMA_VERSION` 升了**不一定清库** | 第一次跑已把 10 写进 `schema_versions` ⇒ 再跑 `v < V` 不成立 ⇒ 523 个文件命中旧缓存 | **直接 `DELETE FROM nodes/files/...`** |

★ 这条值得记：**"升版本号"不等于"重建索引"** —— 它只在**版本真的变大**那一次生效。

### 3. ★★ 一个判据教训（比功能本身重要）

那一刻 3 条判据**全绿**：

```
pass  source-has  typeMembersOf
pass  source-has  members TEXT
pass  source-has  ADD COLUMN members
```

而**数据是空的**（`task_machine.ts` 0/20）。

> `source-has` 只能证明"**代码里调了这个函数**"，证明不了"**数据真的落库**"。

这类验收**判据表达不了**（`judgeExpectations` 的求值域里没有 SQL）⇒ 只能人/LLM 验。

**我没有因为判据绿了就 complete** —— 直到全量重建、确认 `1038 / 1017` 才收口。

### 4. 结果

```
全量重建：命中 0 / 重解析 525
有 members 的节点：1038 ／ interface 总数 1017（100%，多的是 class/type）
StandingNode: [{"name":"id","type":": string"},{"name":"path","type":": string","optional":true}]
```

### 5. 没做

`gen_design_db` 把 members 拷进设计 DB —— 它的卡已 `done`，要 reopen 才能改。

---

## 2026-10-20 早（三十）· 设计 DB 拷 members（`6f7a259f`）

### 1. 改动与验证

```
gen_design_db 的 SELECT 加 members → payload 还原成数组
certs/design-db/domain-task_machine.calls.json
  StandingNode : [{"name":"id","type":": string"},{"name":"path",...}]   ✓
  cardStanding : 无 members（function 本来就没有）                        ✓
```

★ 验证看的是**产物**，不是代码。

### 2. ★ 「done 卡改判据」的完整路径走通了（第二次）

```
reopen（done→claimed）→ release（claimed→candidate）
→ 改 decision（3 条 → 4 条，加 source-has members）
→ publish 重翻 → claim → 改 → complete
```

**这次没有沿用旧判据**——旧 3 条不含 `members`，绿了也说明不了新功能。
今天上午刚栽过一次「判据绿但数据空」，没再重犯。

### 3. 一个小坑

手写 JSON 时混进英文双引号（`"重写源码"`）⇒ 解析失败。用 node 生成 JSON，不手拼。

### 4. 现在 DB 层的状态

| | 之前 | 现在 |
|---|---|---|
| `nodes.signature`（function） | 完整 | 完整（不变） |
| `nodes.signature`（type/interface） | `Name()` | `Name()`（不变） |
| **`nodes.members`**（type/interface） | **不存在** | **1038 个节点有**（1017 interface 全覆盖） |
| 设计 DB 的 interface 副本 | 只有 `Name()` | **带 members** |
