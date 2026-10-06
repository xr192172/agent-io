# observe 合一化：Go 子实现降级为「语言包」

> 起因（2026-10-05，用户裁定）：`go-observe/` 与 TS 版 `analysis/observe/` 是同一个东西的两套实现，
> 源于一次历史事故 —— **当时只打算做一个 observe，但会话同时管理两个项目、混淆了需求，
> 因为上下文窗口的原因做了两个一样的东西（只是语言不同）**。
> 目标：**合一化 + 按语言加载语言包 + 注册工具只做路由转发薄壳**（与本仓其它多语言工具同构）。

## 一、先把边界划清（逐符号清点，不是印象）

### Go 侧独有、TS 架构上做不到 ⇒ 必须留

| 能力 | 位置 | 为什么 TS 不行 |
|---|---|---|
| Go 源码 AST 插桩 | `internal/instrument/instrument.go`（908 行） | 需 `go/ast` + **Go 编译期合法性规则**：`terminatesFunction:347`（missing-return）、`isSideEffectFree:600`（`<-ch` 不可二次求值）、`cleanupTrailingProbes:859`（块末探针会破坏终止性） |
| 编译进**被测进程内**的采集 runtime | `probe/global.go:14-94`、`probe/probe.go:59-401`（环形缓冲 64MB / 6 文件轮转 / 每探针 token bucket）、`probe/tiered.go`（counter+histogram）、`probe/export.go:102`（黑匣子） | 必须与被测代码**同一编译单元** |
| `context.Context` 传播 trace 三元组 | `probe/trace.go:51-142` | Go 惯用法（该文件 `:3-6` 明说"否决全局变量隐式传递 —— goroutine/async 下不成立"） |

### ★ 一个曾被误判的前提（已核实）

**Go 侧没有任何进程注入 / 调试器能力。** 穷举 `os/exec` / `syscall` / `ptrace` / `--inspect` attach /
读他人进程内存 ⇒ **0 真实命中**（27 处命中全是 `ast.Inspect`、英文注释 `SetJudge attaches`、`runtime.ReadMemStats` 测试）。
`go.mod` 只有标准库、无 `require` ⇒ 也不含 delve/gdb 类依赖。
⇒ **"Go 负责运行时"这个印象不成立**；Go 真正独有的只有"**源码级插桩 + 同编译单元 runtime**"两项。

### 两边重复、且**已经漂移** ⇒ 合一化的真正对象

| 重复物 | Go | TS | 已发生的漂移 |
|---|---|---|---|
| `SilentErrorDiscard` | `contract.go:91-106` | `judge.ts:28-45` **和** `contract.ts:216-236`（**3 份**） | `benign` 严格性：Go 严格 `== true`；TS `judge.ts:38` **真值即算** |
| `RebuildChains` | `chain.go:52-142` | `chain.ts:50-122` | 时间精度：Go `UnixNano()`；TS `Date.parse` 毫秒 ⇒ 亚毫秒同刻帧序退化 |
| `isSubsequence` / `subsequencePrefixLen` | `chain.go:146` / `:190` | `chain.ts:125` / `:155` | Go 侧自己也有两份（`isSubsequence` 是转调） |
| `matchChainDecl` | `chain.go:165-187` | `chain.ts:142-152` | 字段一一对应，无实质漂移 |
| 预算 512 / 4096 / 128 | `chain.go:44-48` | `chain.ts:42-44` | 字面量全同 |
| `Comparator` 三段对比 | `comparator.go:88-187` | `contract.ts:121-212` | **语义分叉**：TS `:137` 跳过链路声明、Go 不跳；TS `:168` 把链路探针算已覆盖、Go `:140` 会误报 `undesigned` |
| `DeviationKind` 四态 | `comparator.go:24-29` | `contract.ts:36` | 四个串全同 |
| 报告标签 | `[链断裂]` / 标题 `Observe 偏差报告` | `[链路断裂]` / `TS 哨兵偏差报告` | 文案分叉 |
| `RenderReport` | `contract.go:109-139` | `judge_service.ts:138-156` | `✓ 所有观测值符合契约` 等串逐字相同，标题不同 |
| `dslLog`（`--file` 过滤） | `dsl_cli.go:508-639` | `log_query.ts:48-102` | 三条件同构 |
| 插桩标记 3 常量 | `instrument.go:80/83/89` | `instrument.ts:140/144/147` | 三串逐字相同 |

**两边注释互指"逐条对齐"，而对齐早已不成立** —— `contract.ts:118-119` 写「语义与 Go Comparator 对齐 / **逐段对齐**」，
`judge_service.ts:9` 写「与 Go contract.go（observe-dsl loop 权威）**逐条对齐**」。

### ★ 两条「悬空能力」：既没消费者，也没人知道

- **`design:impact-known-spread`**：Go `ledger_loader.go:164` 生成、approve 进 `dsl.json`（`proposal.go:210`），
  但**两侧判定器都不消费**（`judge.ts:85` 的 `impactUnplannedSpread` 不读 `dsl.json`）。
  Go 注释 `ledger_loader.go:162-163` 声称"impact.spread 判定时不再算计划外"，**该消费逻辑未实现**。
- **`impact-unplanned-spread`**：TS `judge.ts:85-102` 会判，但 Go 的 `defaultRulePredicates()`
  （`comparator.go:81-85`）与 `judge_client.go:52` **都只注册 1 条** ⇒ 写进 `dsl.json` Go 也判不了。
- **`IMPACT_BLAST_RADIUS_LIMIT=50`**：TS 独有，Go 全仓 0 命中 ⇒ 同样进不了 Go 的判定链。

⇒ **三条判定规则（known-spread / unplanned-spread / blast-radius）各自只在一边存在，且都不完整。**

★ **2026-10-06 已解决，且原判断被修正了一半**（详见文末「七、P5 实际落地」）：
`unplanned-spread` / `blast-radius` 的"不完备"是**Go 侧单边缺失**，随 P2/P6 删掉 Go 判定层后不复存在；
而 `known-spread` **不是"缺一条规则"**，它是 `unplanned-spread` 的**减项**（判定消费端缺失）——
把它当"第 4 条规则"注册，会让同一条事件被两条规则**反着判**。

### 构建与运行耦合（决定"能不能自动化验证"）

- `go.mod:9` = `module go-observe`（**非可解析路径，无 domain 前缀**）；`:11` = `go 1.26`；**无 `require`**。
- `package.json` 24 条 script、`scripts/**` ⇒ **零引用 Go**（`tree-sitter-go` 那条是依赖名，误报）。
  ⇒ **`npm test` 不编译、不测 Go。**
- **`go-observe/build/` 不存在，且没有任何脚本产出它**（`e2e_smoke.ps1:18` 输出到 `$env:TEMP`）；
  `.gitignore:6 build/` + `:38 *.exe` 双忽略。
  ⇒ **`daemon.ts:201` 的候选路径是死路径**；实际生效的只有 `AGENT_IO_OBSERVE_DSL_BIN` 或 `PATH`。
- 缺二进制时 `daemon.ts:238-244` 把 ENOENT 与"事件流不存在"混为一谈 ⇒ `broadcast('loop-skipped')`
  **静默失效，无日志无告警**。
  （对照：`go_instrument.ts` 三种失败都**响亮** —— `:65` throw、`:86` reject、`:74` 超时 kill+reject。）

## 二、合一后的形状

**判定层合一（一份，与语言无关） · 插桩层按语言分包** —— 不是"二选一"。

```
observe_instrument（注册工具 = 薄壳路由）
  └─ observeLangs.pick(root)  ← 照 refactor_langs 的形状：manifest 优先（package.json / go.mod），
     │                            判不出再退到「目录里有没有该语言源文件」（复用它的 dirHasSource）
     ├─ ts_js 包（inProcess: true）  instrument.ts（ts_kernel AST）+ 探针台账
     └─ go   包（inProcess: false） go_instrument.ts（go/ast，必须越界进程）+ go.mod 前提自检

判定（与语言无关，一份就够）        ← 这一层就是要收拢的重复
  ├─ judge_events        （canonical 放 TS；Go 侧改走已有的 judgeRemote）
  ├─ rebuild_chains      （canonical TS）
  ├─ compare(d, observed)（canonical TS；★ 顺带裁决两处语义分叉）
  └─ loop(events, dsl, ledger)  ← 从 Go 搬过来（TS 侧现无；触发源 daemon 的 ledger-violated）

## 三、★ 好消息：要做的"路由薄壳"有一半已经存在

`go-observe/probe/judge_client.go:126-190` 的 `judgeRemote` 已经会
`POST {OBSERVE_JUDGE_URL}`（env `judge_client.go:28`）→ TS `serve.ts:2744-2746`
→ `handleApiObserveJudge`（`:286`）→ `judge_service.ts:68/79`。
未配置 env 时 `judge_client.go:58 IsRemote()==false` ⇒ 落回**本地规则判定**（`:75-77`、`:82-88`）。

⇒ **"Go 把判定交给 TS"这条路已经通了**，只是本地那份还在竞争。
⇒ 收拢的正确顺序是**先让远端成为唯一路径、再删本地那份**，而不是两边同时改（否则中途无判定可用）。

## 四、分阶段计划（每阶段都以 tsc + 59 工具签名 + 真调为闸门）

| 阶段 | 做什么 | 风险 | 状态 |
|---|---|---|---|
| **P0** | **立语言包缝**：`observe_langs.ts`（`ObserveLangPack` + `ObserveLangRegistry`，照 `refactor_langs` 形状）；handler 从硬编码 `if (isGoProject)` 改成挑包 + 一份渲染 | 低 | ✅ |
| **P1** | 收掉 `SilentErrorDiscard` 的**第 3 份**（`contract.ts:216-236` 删，引用改指 `judge.ts`）；顺手统一 `benign` 严格性（采 Go 的严格 `== true`） | 低 | ✅ |
| **P2** | **让 Go 的远端判定成为唯一路径**（`judge_client.go`：无 `OBSERVE_JUDGE_URL` 时**响亮失败**而不是落回本地），然后删 Go 本地判定（`contract.go` 的 `JudgeEvent`/`SilentErrorDiscard`/`RenderReport`、`comparator.go` 的 `Compare`/`DeviationKind`） | **中**（Go 无 CI 验证 ⇒ 只能靠"跑得起来"证明） | ✅ |
| **P3** | 删 TS 侧重复：链重建保留一份（`chain.ts` 为 canonical，Go 侧删）；**裁决两处语义分叉**（TS 跳过链路声明 / 链路探针算已覆盖 —— 采 TS 行为，因为它是已在 59 工具里跑通的那个） | 中 | ✅ |
| **P4** | `loop` 从 Go 搬到 TS（`ledger.json` 折叠 + 提案生成 + 阈值 0.1/1/2） | 中 | ✅ |
| **P5** | ★★ **原目标已被修正**（见 §七）：原写"裁决三条只在一边存在的规则，目标是三者在同一份注册表里都能被声明与判定"。实情是 `unplanned-spread` / `blast-radius` **本来就是表内的活规则**（删它们是减能力），而 `known-spread` **不该是第 4 条规则** —— 它是 `unplanned-spread` 的**减项** ⇒ 要补的是它的**判定消费端** | 中 | ✅ |
| **P6** | Go 侧只剩「语言包」两件事：`internal/instrument`（插桩）+ `probe`（同编译单元 runtime）。`dsl_cli.go` 瘦身为 `instrument` 一条子命令（或直接删）—— ★ 实际做法是**整删**（`e9a31a7`）：插桩走 `go_instrument.ts` 的 `go run ./cmd/instrument`，本就不依赖它 | 中 | ✅ |
| **P7** | **把 Go 纳入门禁**（`scripts/verify.mjs` + `npm run verify`，三态 PASS/FAIL/SKIP⇒0/1/2） | 低 | ✅ |

⇒ **P0–P7 全部已落** —— `observe-lang-go/` 从 42 个文件降到 21 个（只剩插桩 + 进程内采集 runtime），
判定层 / DSL 仓库 / 审批 / loop 全在 TS 侧，且 TS 侧**已能独立完成「事件 → 偏差 → 提案 → 审批 → 定稿」闭环**。

## 五、需要人拍板的三件事（✅ 2026-10-05 全部已裁定，见各条）

1. **两处语义分叉采哪边**（P3）：TS 侧「跳过链路声明 + 链路探针算已覆盖」vs Go 侧不这么做。
   我建议采 TS —— 它是**已在 59 工具里真跑通**的那个行为，改它要动已验证的路径。
2. ~~**`observe-dsl` 的去留**~~ ⇒ ✅ **2026-10-05 已核实并修正**：它既不是人用的入口，也**不是插桩的后端**。
   - 零 CLI/MCP/HTTP 暴露，`package.json` 0 命中；唯一执行者是 `daemon.ts:223`（防抖 10s 自动触发）。
   - daemon **只调 `loop` 一条**；真插桩走 `go_instrument.ts:70` 的 `go run ./cmd/instrument`，与该二进制无关。
   - 它真正独有的是**提案工作流 + 版本化 DSL 存储**：`proposal.go` 385 + `dsl_store.go` 236 + `loop.go` 254 +
     `ledger_loader.go` 211 ≈ **1086 行，含 `VerifyRuleRegression` / `verifyLLMCoverage` 两个验证门**
     （`DesignDSLStore` / `dsl.history.jsonl` / `ApproveGated` / `mergeLoopDecls` 在 TS 侧精确为 0）。
   - ★ 且 `reconcile_chain.ts:107` 与 `reconcile_effects.ts:130` 注释明写「`.agent/` 是 **go-observe 自己的** DSL 仓库」
     ⇒ **TS 侧有两个 reconcile 工具正在读 Go 侧拥有的数据格式**。
   ⇒ **裁定：不能直接删；必须先做 P4 搬迁，搬完才删。**（P6 相应顺延到 P4 之后）
3. ~~**三条悬空规则的取舍**~~ ⇒ ✅ **裁定：都留，判定统一到 `judge.ts:110` 那张表**（该表已存在：`rules: Array<...> = [...]`）。
   - `blast-radius` 与 `unplanned-spread` **已是表内的活规则**（真在产出发现）⇒ 删它们是**减能力**。
   - `known-spread` 不是"悬空该删"，而是**跟着 `loop` 一起搬**（`impact/ledger.json` 是它唯一数据源）⇒ 搬完自然有消费者。
   ⇒ 落地成本比预想低：加一条规则 = 往那张表里加一个函数，不是改控制流。

## 六、本笔（P0）实测证据

- `tsc --noEmit` EXIT=0；`npm run build` 通过；`mcp_scan` **59 工具零坏签名**；量具五态全 0。
- handler **240 → 188 行**（净减 52：两段逐字重复的报告渲染收成一份）。
- 四条分支真调（隔离 `AGENT_IO_HOME` + 临时夹具）：
  · Go 包 dry-run ⇒ `语言包：go · 扫描 1 个源文件 … 将注入 4 探针点` + go.mod 前提提示（端到端跑通）
  · TS 包 dry-run ⇒ `语言包：ts_js · 扫描 5 个源文件 … 共 12 探针点`
  · 无匹配 ⇒ **不静默**，列出已注册语言包 + 告诉人"要支持新语言去哪注册"
  · Go 还原 ⇒ `一键全拔（go）：未找到备份与台账`
- ★ 顺带验证了一个失败路径：Go 夹具被我写坏时（PowerShell 转义把 `\` 写进 `.go`），
  工具**逐文件报出解析错误并计入"1 失败"，没有抛异常** —— 这正是统一形状想要的行为。

## 七、P5 实际落地（2026-10-06）：`known-spread` 是 `unplanned-spread` 的**减项**，不是第 4 条规则

### 症状（搬迁后的形态，与搬迁前同病不同位）

`design:impact-known-spread` 声明**有生成、有审批、有存储，就是没有判定消费**：

- 生成：`ledger_fold.knownSpreadDecl()` ← `run_loop` 6b（台账累犯模式回流）
- 审批：`approve_gated`
- 存储：权威 `dsl.json`
- 判定：**零消费** —— 它不在 `OBSERVE_RULE_TABLE`（表里 3 条），`compare` 第 1 段拿到它走
  `if (!pred) continue`（`contract.ts`）⇒ **既不判违反**；第 2 段因 `probe='impact.spread'`
  命中而被算"已覆盖"；第 3 段无 `chain` 跳过。
- ⇒ 后果：声明写了**等于没写**。下次同一源又波及同一文件，`impactUnplannedSpread`
  照样喊「计划外扩散」⇒ 用户每次被同一件事叫醒。

### ★ 关键判断修正（原目标错在哪）

原计划（§四 P5 行）写的是「裁决三条规则，目标是**三者在同一份注册表里都能被声明与判定**」。
**这句话本身是错的** —— 它把一体两面当成了两条并列规则：

| | 问的问题 |
|---|---|
| `unplanned-spread` | 「越界了吗？」 |
| `known-spread` 声明 | 「这部分越界**我认了**」 |

⇒ 若把 known-spread 注册成第 4 条谓词，**同一条事件会被两条规则各判一次、结论相反**
（unplanned 报违反 / known 报 ok）⇒ 又一次判据分叉（本仓头号病根）。
⇒ 真正要改的是 `unplanned-spread` 的**判定输入**：已承认的越界要**扣除**后再看净越界。

### 落点（形状 1）

| 改动 | 文件 | 说明 |
|---|---|---|
| `ObserveRuleCtx`（谓词**可选**上下文） | `judge.ts` | 放的是**领域数据** `acknowledgedSpreads: Map<source, Set<file>>`，**不是 `TSDLDecl[]`** ⇒ judge 层不认识 DSL 类型（① 避免与 `contract.ts` 成环 import；② 避免同一份类型出现第二份定义） |
| 扣减逻辑 | `judge.ts` `impactUnplannedSpread(ev, ctx?)` | 净越界 = `unexpected_files − 已承认耦合`；净空 ⇒ `ok`，非空 ⇒ `deviation`（文案标出"另有 N 个已承认，已扣除"） |
| 适配层 | `ledger_fold.ts` `knownSpreadIndex(decls)` | 声明 → 领域数据。**不看 `status`**（权威 `dsl.json` 只装已批准声明，读到即"已承认"；再按 status 过滤就是给同一判据造第二条口径） |
| 构造 ctx | `contract.ts` `compare` | 循环**外**构造一次（纯计算、不落盘） |
| 透传 | `judge_service.ts` `judgeEvents(events, ctx?)` / `judgeEventsWithLLM(events, useLlm, ctx?)` | |
| ★ 顺序修正 | `handlers.ts` `observeJudgeHandler` | **decls 的计算从"判定之后"上移到"判定之前"** —— 原先顺序下扣减**永远拿不到输入**（功能形同不存在） |
| loop | `run_loop.ts` | LLM 复核那步传 ctx |

### ★ `undefined` 与"空 Map"是两件事（不许混为一谈）

- `ctx` / `acknowledgedSpreads` 为 **`undefined`** = **拿不到声明侧信息**（实时逐事件 / 日志查询路径
  没有 `dsl.json`）⇒ 规则按原样判，但**文案必须明说**「⚠ 未扣已承认耦合：无声明集」（不许静默）；
- **空 Map** = **已对账**，结论就是"没有任何已承认耦合" ⇒ 文案**不**提示未扣减。

### ★ 必要配套：`verify_gate` 的 `DATA_DECL_RULES`

不做它则**整条链空转**：known-spread 无谓词 ⇒ 审批时被判 `uncovered` ⇒ 默认（无 LLM）
**直接冻结** ⇒ 声明永远进不了权威 `dsl.json` ⇒ 上面那条扣减的**输入恒为空**。
⇒ 登记为**数据型声明规则**：与谓词规则一样算"可确定性判定"（判定发生在**消费它的那条规则**里），
但 `verified_by` 记 `data-consumed`（不是 `rule-regression`）—— 不能借用"有谓词判它"那个词。

### 定位方式**不是启发式**（一处本来就容易搞错的地方）

一开始怀疑"`impact.spread` 事件没有 `source` ⇒ 声明与事件对不上号 ⇒ 只能启发式桥接"。
**核实后不成立**：`source` 的定义就是"某条 ledger 条目 `declared_files` 里的一个成员"
（`foldEntries` 逐字如此），而事件**自带 `declared_files`**（`watch_project_tool.ts` 写入）
⇒ `event.declared_files × ctx.acknowledgedSpreads` 是**精确桥**（同一份数据、同一个名字）。
⇒ 因此**不需要**给事件补字段、也不改 `observe_contract.schema.json`。

### 实测（真调，非读码声称）

| 档 | 输入 | 结果 |
|---|---|---|
| 1 | 声明 `source=src/a.ts, spread=[src/x.ts]` + 事件越界 `[src/x.ts]` | `deviation=0`、`diff.violated=0` ⇒ **扣减生效**（不再报） |
| 2 | **同一事件**但不给声明集（对照） | `deviation=1`、rule=`impact-unplanned-spread`，文案带「⚠ 未扣已承认耦合：无声明集」|
| 3 | 同声明 + 事件越界 `[src/x.ts, src/z.ts]` | `deviation=1`，**只报 `src/z.ts`**，文案带「另有 1 个已由设计契约承认，已扣除」|
| 配套 A | `verifyRuleRegression([known-spread 声明])` | `uncovered=[]`、`covered=1` ⇒ 不再被判"需 LLM 复核" |
| 配套 B | `finalizeDecls` | `verified_by=data-consumed`、`status=verified` |
| 配套 C | 同 source 两条声明 | 索引取**并集** `["src/x.ts","src/y.ts"]` |
| 配套 D | 无 known-spread 的声明集 | 索引 `size=0`（空 Map ≠ undefined） |
| 回归 | `silent-error-discard`（`op=writefile, err=ENOENT`） | 仍 `deviation=1`，文案不变 |
| 端到端 | `runLoop` 跑一轮 | `triggered=true violated=0 undesigned=1`（未坏） |
| 总门 | `npm run verify` | **五道全 PASS / exit 0** |

### 顺带清掉的两样零消费者物（不留墓碑）

- `judgeEvent(ev, rules?)` 的 **`rules` 形参**：全仓**零调用方**（所有调用点都是 `judgeEvent(ev)`），
  留着它还会逼出 `judgeEvent(ev, undefined, ctx)` 这种占位调用 ⇒ 删；
- 随之零消费者的 `DEFAULT_OBSERVE_RULES` ⇒ 一并删（规则链顺序的唯一来源 = `OBSERVE_RULE_TABLE`）。

### ⚠ 如实登记：`compare` 是**声明驱动**，与本笔的扣减只有一半交集

`compare` 第 1 段是「**遍历 DSL 里的声明**，逐条跑它 rule 的谓词」⇒ 若 DSL 里**没有**
`design:impact-unplanned-spread` 声明，`compare` 根本不会调用该谓词（因此也不会报它）。
所以扣减在 `compare` 路径上"当且仅当 DSL 里有那条声明时"才可见 —— 这是**既有语义**（本笔未改）。
本笔真正让扣减可见的主路径是 **`judgeEvents`**（`observe_judge` 的逐事件报告，实测档 1–3 就是它）。
两条路径语义不同（一条规则驱动、一条声明驱动）这件事**登记在此**，留给后续判断要不要收口。

### 本笔撞到的两处环境事实（不属本笔代码，但影响验证读数）

- **`node_modules` 当时是空的**（0 个包）⇒ `npm run build` 直接失败、`mcp_scan` /
  `measure_b_contract` 报 `ERR_MODULE_NOT_FOUND`。**那两道门不是代码红，是依赖缺失**；
  装齐依赖后总门五道全 PASS。
- ★★ **`scripts/verify.mjs` 的 ts 门曾有假绿灯** —— **2026-10-06 已修（T61）**：
  它原调 `npx tsc --noEmit`，而在 `typescript` 未安装时 `npx` 会取到 npm 上的 **`tsc` 占位包**
  （输出「This is not the tsc command you are looking for」）并**退出 0** ⇒ 总门报 `PASS`
  却**什么都没编译**（与它自己设计的三态「缺工具链 ⇒ SKIP / 退出 2」自相矛盾）。
  ⇒ 现改为直接调**本地编译器**：`localTsc()` 用 `createRequire().resolve('typescript')` 取主入口
  再拼 `../bin/tsc`（**不硬编码路径** —— hoist / pnpm / 嵌套三种布局都对），命令用
  `process.execPath` 跑它的 JS 入口；**拿不到编译器时 FAIL 而不是 SKIP**
  （SKIP 留给可选外部工具链如 Go；typescript 是本仓 devDependency，缺它 = 依赖没装）。
  ★ 修的过程中实测撞出第二个坑，已写进代码注释：`process.execPath` 在本机是
  `C:\Program Files\nodejs\node.exe`（**含空格**），经 `shell:true`（cmd.exe）会被截成
  `C:\Program` ⇒ 门在 **13ms** 内以"退出码 1"失败、**看着像类型错其实是没跑起来**
  ⇒ 该门显式 `shell:false`（本仓其余门仍需 `shell:true`，因为 `go`/`npx` 是 `.cmd`）。

## 八、T62：补上「审批入口」—— 这一步不做，P5 等于没做（2026-10-06）

### 症状（比"没有只读出口"严重得多）

`approveGated`（P4 步骤 5 的审批编排）**全仓零调用方** —— 引用只有定义与注释；
59 个 MCP 工具里 `proposal` / `approve` **零命中**；`serve.ts` 的 `/api/code/approve|reject`
是 **`design_intent` 的"代码审批"**（`code_workbench.js`），与 observe 提案无关。

⇒ **observe 闭环断在倒数第二步**：loop 能产提案（daemon 自动跑），但**没有任何入口能批准/驳回**
⇒ 提案永远停在 `pending` ⇒ 声明永远进不了权威 `dsl.json`。

### ★ 它让已落地的 P5 在真实运行下不生效（真跑量化）

| | 读数 |
|---|---|
| loop 产提案 | `proposals=1`、`status=pending`、`proposal_decls=[design:impact-known-spread]` |
| 权威 `dsl.json` | `decls=[design:silent-error-discard]`（**没有** known-spread） |
| `knownSpreadIndex(权威).size` | **0** ⇒ 扣减输入恒为空 |
| 同一事件判定 | **真实链路 `deviation`** ／ 假如已审批 `ok` |

⚠ 此前 P5 的"三档验证"是**直接给 `decls`**、**绕过了提案链路** —— 那是验证盲点。
⚠ 同时更正一句说过头的话：「TS 侧已能独立完成 事件→偏差→提案→**审批→定稿** 闭环」
—— 审批与定稿**都没有入口**，实际只到"提案"。（与 P4 收尾时发现 `DesignDSLStore`
没暴露给任何 handler **同族**：搬了没出口。）

### 落地（2026-10-06 用户拍板：选 (a)；★ 并明确"目标是 AI 自动化、未来要增补第三方会话审批"）

开在 **HTTP**（照 `code_workbench` 的形状），**不做成 MCP 工具**：

| 路由 | 作用 |
|---|---|
| `GET /api/observe/proposals?project_dir=…` | 列出提案（含 `verified_by` / `verification` 证据）—— ★ 补回 Go `dsl_cli list/show` 丢掉的出口 |
| `POST /api/observe/proposals/approve` | `{project_dir, id, reviewer, use_llm?}` ⇒ 走 `approveGated` 四层门 |
| `POST /api/observe/proposals/reject` | `{project_dir, id, reviewer}` ⇒ 仅 pending 可拒，**权威不动** |

★ **`reviewer` 自由文本且必填** —— 它记的就是"**哪个会话 / 哪个系统批的**"。
`approveGated(…, reviewer)` 与 `Proposal.reviewer` 本就为此存在（Go 时代就有）
⇒ 将来接第三方（别的会话、IM、CI）**只需按同一 body 调**，本层不必改。
★ 不做 MCP 工具的理由：那会退化成"**agent 批准自己的提案**"，语义弱。
★ 安全：三条路由都进 `isWriteApi`（浏览器跨域写入须过 Origin 校验）；
而 `isSafeOrigin(undefined) === true`（源码原文"非浏览器直接请求（curl/self）放行"）
⇒ **无 Origin 头的第三方会话可直调** —— 与目标一致。
★ 状态码口径与 `/api/code/*` 的"catch 全 500"**有意不同**（已在代码里写明）：
参数/路径错 ⇒ **400**；状态机冲突（非 pending / 不存在）⇒ **409**；其余 ⇒ 500。

### 实测（起真 serve + 真 HTTP，端到端）

| 步骤 | 读数 |
|---|---|
| `GET /api/observe/proposals` | `count=1`、`status=pending`、`rule=design:impact-known-spread` |
| `POST …/approve`（**缺 `reviewer`**） | **400** + 文案「审批必须声明审批者身份（会话 id / 系统名 / 用户名）」 |
| `POST …/approve`（**缺 `expect` 的畸形声明**） | **409**「审批未通过：第 1 条声明缺少 expect」⇒ ★ **`validateDecls` 那道门真在工作**，且权威未被动 |
| `POST …/approve`（正常，`reviewer=session:dsh-42`） | `success=true`、`frozen=false`、`version=1`、`reviewer=session:dsh-42` |
| 权威 `dsl.json` | `rules=design:impact-known-spread`、`verified_by=data-consumed` / `status=verified` |
| ★ **扣减是否生效** | `knownSpreadIndex.size=1`、判定 **`ok`（fully acknowledged）**（此前是 `deviation`） |
| `POST …/reject`（`reviewer=session:im-7`） | `success=true`、`status=rejected`、`reviewer=session:im-7` |
| 重复 `reject` | **409**（状态机守卫） |

⇒ ★★ **P5 至此才真正闭环**：提案 → 审批（HTTP）→ 权威 `dsl.json`（带 `data-consumed`）
→ 扣减生效（同一事件由 `deviation` 变 `ok`）。

### 连带修掉的一处（否则又是"声明与实际不符"）

`daemon` 的 loop 回流提示：上一笔刚把它从**假工具名**（`reconcile_proposals` —— 从未注册过，
`760dc63` 改文案时编的名字）改成"如实说明没有入口"；**本笔有了真出口** ⇒ 提示改指这两条 HTTP 路由。
