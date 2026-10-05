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
| **P0 已落** | **立语言包缝**：`observe_langs.ts`（`ObserveLangPack` + `ObserveLangRegistry`，照 `refactor_langs` 形状）；handler 从硬编码 `if (isGoProject)` 改成挑包 + 一份渲染 | 低 | ✅ 本笔 |
| **P1** | 收掉 `SilentErrorDiscard` 的**第 3 份**（`contract.ts:216-236` 删，引用改指 `judge.ts`）；顺手统一 `benign` 严格性（采 Go 的严格 `== true`） | 低 | 待做 |
| **P2** | **让 Go 的远端判定成为唯一路径**（`judge_client.go`：无 `OBSERVE_JUDGE_URL` 时**响亮失败**而不是落回本地），然后删 Go 本地判定（`contract.go` 的 `JudgeEvent`/`SilentErrorDiscard`/`RenderReport`、`comparator.go` 的 `Compare`/`DeviationKind`） | **中**（Go 无 CI 验证 ⇒ 只能靠"跑得起来"证明） | 待做 |
| **P3** | 删 TS 侧重复：链重建保留一份（`chain.ts` 为 canonical，Go 侧删）；**裁决两处语义分叉**（TS 跳过链路声明 / 链路探针算已覆盖 —— 我建议**采 TS 行为**，因为它是已在 59 工具里跑通的那个） | 中 | 待做 |
| **P4** | `loop` 从 Go 搬到 TS（`ledger.json` 折叠 + 提案生成 + 阈值 0.1/1/2）；顺带消掉**悬空的 known-spread**（要么补 TS 消费端，要么连提案一起搬过来并接上） | 中 | 待做 |
| **P5** | 裁决三条只在一边存在的规则：`known-spread` / `unplanned-spread` / `blast-radius` —— 目标是**三者在同一份注册表里都能被声明与判定** | 中 | 待决断 |
| **P6** | Go 侧只剩「语言包」两件事：`internal/instrument`（插桩）+ `probe`（同编译单元 runtime）。`dsl_cli.go` 瘦身为 `instrument` 一条子命令（或直接删，让 `go_instrument.ts` 走 `go run ./cmd/instrument` —— **它现在就是这么跑的**） | 中 | 待做 |
| **P7** | **把 Go 纳入门禁** ⇒ ✅ **已落**（`scripts/verify.mjs` + `npm run verify`，三态 PASS/FAIL/SKIP⇒0/1/2） | 低 | ✅ 本笔 |

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
