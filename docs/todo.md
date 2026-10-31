# 待办

> 只有未做的。做完的删掉；标题只剩半句的，正文在 git。

---

## 〇、2026-10-23 交接（新会话从这里读起）

**今天做完的三条线**（提交 `d775381c` … `7ab953f0`）：

| 线 | 结果 |
|---|---|
| **① 卡模型** | `intent:modify` 可领 satisfied 卡；`candidate` 可直接收口（`t_done_from_candidate` 早就有，代码没接） |
| **② 前端切割** | 批注层整体退场（622 行 5 文件）+ archify 自包含 HTML 管线（1151 行 + 2.4MB） |
| **③ 写路接线** | `self-writes` 澄清为设计使然（不是缺陷）；`edit_code` 真因是"开了事务没 close" |

**新加的两个读数工具**（`design_line` 的 action）：

| action | 给什么 |
|---|---|
| `brief` | **一个节点/文件**：设计要什么 + 缺哪个符号 + 设计 DB 投影 + 改它波及多少文件 |
| `report` | 六步读数（①②③④⑤⑥ 各自 ok/missing/pending + 带数字的读数） |

**任务历史已独立成库**：`.agent-io/task-history.db`（**不是** `cache.db` —— 那个可重建）
`edit_dsl todo.move_to_history` 移入；`get_dsl query=history` 查。

### 下一步（按依赖顺序）

1. **`brief` 挂到 `edit_code` 前面**：只挂**符号差**（毫秒级），**别挂影响面** —— 实测逐卡算影响面 = O(卡数 × 全仓图)，84 张跑 4 分 56 秒没完
2. **`analyzeImpact` 全量重算**：`buildImpactGraph` 每次 `Promise.all(files.map(parseFileFull))` —— **重新解析全仓**，而 `cache.db` 里早有 symbols/calls/imports ⇒ 同一判据住两处
3. **`constructBasis` 的 L1 建卡该关掉**：它把"67 个目录的 responsibility 是机器串"翻译成了 67 张卡（已置 void 并移入 history）；缺口应该只在 `design_line report` 里当一个读数
4. **`brief` 报"缺"的 4 个待修**：`handlers.ts`(`manageFeatureHandler`) / `derive_mind_map.ts`(批注层 6 个) / `write_gate.ts`(`writeSourceFiles` 等 3 个) / `server.ts`(`resolved`,`digest`) —— 都是**设计册写了个已不存在的符号**
5. ~~`query=history` 概览/详情两级~~ ✅ **2026-10-24 完成**：history 缺省概览行（data 27KB，整卡仅 detail=true/card_id 时返回）；新增 `query=overview` 跨库总账（features×活卡/done/void/归档/history/欠账）；欠账口径抽 `computePendingDebts` 与 pending 共用。npm run verify 9/9，真调 dist 五项读数全绿。决策卡已落（query_feature.ts / index.ts 两节点）。
6. ~~剩余 93 张 done 卡移入 task-history-db~~ ✅ **2026-10-24 完成**：20 处活卡引用先摘链，93 张一次全量入史；验收 done=0/活卡 77/链完好/history 181；裁定已落决策卡（task_ops.ts 节点）
7. **鉴权（令牌账号）**：`session_id` 只是个**便宜身份层**（`sha256(AGENT_IO_SESSION_TOKEN).slice(0,12)` → 卡的 `claimed_session`），**同一 host 内所有子代理共享同一个 id**（stdio 一根管道，服务端看不见调用者）⇒ 它只做**归属与审计**，**不做授权**。真正的鉴权（谁能以谁的账号动手）**尚未实现** —— 需要 host 侧把可信身份注进连接，而不是靠自报

### 关键文件在哪

```
设计册（人机共写）      .agent-io/design/task-system-plan.dsl.json
设计 DB 投影            design-db/<rel>.calls.json       （gen-design-db 生成，别手改）
实际索引（可重建）      .agent-io/cache.db
任务历史（不可重建）    .agent-io/task-history.db        ← 今天新建
设计线读数/简报         src/application/design/line/design_line.ts（briefReport / mustHaveFor）
卡状态机               src/domain/task_machine.ts（TRANSITIONS / isClaimable / cardStanding）
卡的 op                src/application/design/dsl_ops/task_ops.ts
```

★ **纪律提醒**：`brief` 里的 `expectations` 是**设计要求原文**，**不是**"未满足"（这个函数不判满没满）；验收归 `edit_dsl` 收口闸。

---

## 一、任务系统

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T331 | `acceptance` 没翻成 `expectations` 就永远不会被做；普查其余 acceptance | `src/application/meta/explore/query_feature.ts` | 未做（该文件无 decision；`board/pool.ts` 卡只有 4 条结构判据） |
| T329 | 决策卡加 `scope` 引用 | `geometry.nodes[].decision` | 未做（50 张 0 张有 scope） |
| T118 | 决策卡记「是谁提的」 | `geometry.nodes[].decision` | 部分（12 张有 `author`，49 张有 `agent`） |
| T175b | `edit_dsl` 描述太长、关键段靠后 | `src/application/design/index.ts` | 未做 |
| T127 | 一致性闸门的「谁会信它」 | `src/application/design/intent/consistency.ts` | 未做 |
| T153 | DSL 走查结果 | — | 未做 |
| T148 | 「卡几次」随数得细不细而变，不是精确尺 | — | 方法论 |
| T146 | 给常见任务各编一条链 | — | 未做 |
| T237 | `.inspect/` 一个目录干两件事（语法采集 + 摆证残留） | `.inspect/` | 未做 |
| T43 | 通用多语言组件框架 | — | 研究 |

## 二、工具面

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T162 | `edit_code` 是否进 refactor 的 `direct` 名单 | `src/presentation/mcp/server_registry.ts` | 未决 |
| T259 | 判据够不着接口成员 / 对象键 | `src/application/design/intent/expectations.ts` | 未做 |
| T261 | `edge-absent` 当「不许合并」的代理，间接且脆 | 同上 | 未做 |
| T262 | `type-only import` 不建边，相关断言不可表达 | `src/infrastructure/index/` | 设计边界 |
| T240 | `apply_literals` 不在工具 schema | `src/application/refactor/rename/rename_symbols.ts` | 未做（只有 `report_literals`） |
| T231 | 注释 / 字样一并改的默认要不要出声 | `rename_symbols` | 未决 |
| T152 | 注释算不算引用 | `rename_symbols report_literals` | 未决 |
| T151 | 没有「跑本仓唯一总门」的工具 | `scripts/verify.mjs` | 未做 |
| T126 | `Touched` 是否加「类型」锚点 | — | 未决 |
| T125 | 「备菜」+ `mode=field` 缺「所属」限定 | `src/application/refactor/` | 未做 |
| T119 | 统一的「这次处理哪些」入参 | — | 未做 |
| T15 | CLI-only 能力注册为 MCP 工具 | `server_registry.ts` | 未做 |
| T107 | 意图 / 搬运 / 关联三层判据 | — | 未做 |
| T156/T158/T159/T168/T163/T236/T121/T124/T123/T120/T113/T112/T106/T54/T19/T63/T139/T134/T64/T96/T69/T70/T71/T108/T327/T326 | 标题只剩半句，正文见 git | — | 无法判断 |

## 三、索引与数据

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T149 | 索引候选序非确定性 | `src/infrastructure/index/` | 未做 |
| T132 | 索引读数 429/424（索引数 > 磁盘数），缺「文档」桶 | `src/infrastructure/index/` | 未做 |
| T242 | 索引「保鲜 / 完整性」判据收口 | `src/infrastructure/index/index_freshness.ts` | 未做 |
| T66 | 入口保鲜与陈旧告警 | 同上 | 未做 |
| T49 | 写用户源码没有单一可检查通道 | `src/application/refactor/edit/apply_writes.ts` | 未做 |
| T333 | `fork` 没工具化；`_forked_from` 无 TS 源写入 | `package.json` · `.agent-io/design/` | 未做（`npm run fork` 指向的脚本不存在） |
| T328 | 进度轴收归到 `progress`@overlay | `src/infrastructure/storage_overlay.ts` | 未做 |
| T-#98c | 数据家里还留着旧落点副本（`review-hub.dsl.json` 的 live + baseline 等），现在读不到 = stray | `<数据仓>/live` · `baseline` | 🔄 逐字节相同的由 watch 自动清（t374），**不一致的只报** ⇒ 这两份要人看一眼 |
| ~~T-#GC~~ | ~~数据仓卫生（全局 GC）~~ ⇒ **用户口径更正**：GC 的对象只是**工具使用账本**（`dogfood/usage.jsonl`，只加不减，实测一晚 61KB→141KB）。机制已落：保留期（默认 30 天）+ 把更老的行折成 `usage-rollup.json` 的（日×工具×来源×动作）计数桶 ⇒ 次数/成功失败/下一棒**守恒**，`snapshotDogfoodStats` 连 rollup 一起算 ⇒ **读数不缩水**；默认 dry-run，`--apply` 前过守恒校验，落盘原子，**坏行原样留着**。**design / tasks / history 不在 GC 范围内**（意图数据只报告，永不自动删） | `src/infrastructure/dogfood_stats.ts` · `scripts/gc.mjs` | ✅ 2026-10-27（证 `t372` PASS=10/0；`npm run gc` 默认 dry-run） |

## 四、证与探针

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T332 | 证夹具没跟上设计侧搬家（`run82` 取不到 DSL） | `certs/` · `.agent-io/design/` | 未修（`run82.dsl.json` 不存在） |
| T-#98d-1 | ★ **`requires` 前置闸曾是死闸**（修 T-#98d 时挖到）：edge 意图 2026-10-23 并入设计册后，`applyOverlay` 投影只带 `reason`/`boundary`（把 `requires`/`status` 丢了），`loadOverlay` 也不重建 `edges` ⇒ `write_gate` 读到的 `overlay.edges` **恒空** ⇒ 谁写 `requires` 都不生效 | `src/domain/overlay.ts` · `storage_overlay.ts` · `geometry.ts` | ✅ 已修（投影带全字段 · loadOverlay 重建 · 契约补 `requires`/`status`）；证 `t332` **10/0** |
| T-#98d-3 | `t352` / `t353` 的「留痕」判据改口径：批注层 2026-10-23 退场 ⇒ 不再落 `dsl.annotations` | `certs/t352` · `t353` | ✅ `t352` **17/0**；`t353` 33/6（6 条即 T-#98d-2） |
| T-#DOMAIN-2 | ✅ **域级判据落地并铺开**（2026-10-28）：判据 kind + 求值器 + schema 两处 + 形状校验（共 4 处）；放开 `module` 决策卡；**层序律机械推导并写入 55 个域**（60 域 − 3 个顶层 presentation − 2 个无 module 节点），全册 55 条判据一次跑 **55 pass / 0 fail**；`GUIDE-GATE` 8 → 10 kind。证 `t404` 6/0。★ 律的来源是**层序**（domain<infra<app<presentation），不是"某两个域之间有边"——后者是凭空造红（见 §23.4 的自我纠正）。**剩**：`must_not_import` 逐域枚举到 36 个 id（体量涨 1755 行）⇒ 若"层"成为一等概念可缩到 1 行，属新词汇，另议 | `structure.domains.json` · 设计册 | 完成（铺开） |
| T-#DOMAIN-4 | ✅ **封装已修**（2026-10-28）：`application/observe/reconcile` 的 4 个文件此前直接引用 `infrastructure/analysis/observe` 的 6 个内部模块；现**只补真有跨域使用者的符号**进 `observe/index.ts`（不做 `export *`，那等于取消封装），4 个文件改走公开入口 ⇒ **绕过 index 的引用 = 0 处**。★ 边界律（`domain-independent`）不覆盖这条（它是域对级），所以先修事实、不硬造判据 | `src/infrastructure/analysis/observe/index.ts` · `reconcile/*` | 完成 |
| T-#PARAM-1 | ✅ **`observe` 的参数声明收成一处**（2026-10-28，证 `t422` **8/0**）：原来**三处**在声明"这个 action 认哪些参数" —— zod `inputSchema`、入口的 `SPEC`/`NEED` 两张手写表、以及一条**魔法白名单** `['project_dir','feature','agent','dry_run','use_llm']`（对所有 action 放行 ⇒ 守卫形同虚设）。现在只有一张 **`ACTION_SPEC`**（`fields`+`need`），SPEC/NEED 由它派生，魔法清单删除、只留显式 `COMMON_FIELDS=['agent']`。★ **结构检查当场抓出两个真 bug**：① `contract_probes` 在 schema+handler 里都有、**唯独没进 SPEC** ⇒ 被当"陌生人点名"拒（我今天踩过）；② `observe action=proposals` 的 **`project_dir`/`feature` 从未在 schema 里声明**（全文那两处属于别的工具）⇒ 实际调用**根本传不进来**。**剩**：① ①的检查靠**读源码文本**（正则）而非运行时反射，schema 写法变了要同步 ② 与提案库合并（`T-#OBSERVE-2/3`，两套库未并） | `observe/index.ts` · `certs/t422` | 完成 |
| T-#OBSERVE-9 | ✅ **死链已退役**（2026-10-28，证 `t424` **8/0**）：`code_workbench`（代码变更提案）+ `llm_decider`（唯一产者）删除，`meta/index.ts` 的死 import 摘掉，3 处误导注释修正，`design_intent` 描述与 `capability_map` 里"propose 永不直接落盘 / 审批台账 / 审批列表"等**已不成立的承诺**全部删除。★ 工具面**仍是 55**（删死链不动工具面）。★ 我一度写好 `applyChange`（过闸即落）+ `blocked` 三态 + `applied_by` 台账 + `approveChange` 别名，**全部撤回** —— 给空房子装门就是新脚手架。**结论**：`pending-changes` = **无产者 + 无审阅人**（`canvas_notes` 2026-10-23 已删、`approveChange` 零调用方、HTTP 无 `/api/code/*`）⇒ 按"无活跃消费"退役；仓里现存唯一同类活路径是 `opl`（判据过就写，无人审批） | `code_workbench.ts`(删) · `llm_decider.ts`(删) · `design/index.ts` · `certs/t424` | 完成 |
| T-#OBSERVE-2 | ✅ **已收，但真相与旧账不同**（证 `t423` **9/0**）：旧账说"propose 提了没人能批"，实证**更糟** —— `propose` 分支早在 2026-10-22 就删了，而 handler 里 `action` **读出来就没用过** ⇒ `action=propose` 会被**当成 `set` 直接写盘**（描述里"propose 永不直接落盘"的承诺**正好是反的** = 越权写盘）。修：**响亮报错 + 零副作用**（实测落盘文件数不变），并给替代路径（`opl` 立卡 / `observe action=proposals`）；描述 / enum 文案 / `AGENTS.md` 触发行同步。★ **「两套提案库」故意不合并**：`pending-changes.json` 存**代码 diff**（★ 审阅人**不存在** —— 工作台页签已退役、HTTP 无 `/api/code/*` 路由、`approveChange` 零调用方）、`observe proposals` 存**DSL 声明**（四层门现行），payload 与审阅人都不同。**剩**：工作台 approve 路径无自动化证（前端） | `design/index.ts` · `gen_agents.mjs` · `certs/t423` | 完成 |
| T-#KIND-1 | ✅ **判据 kind 注册表落地**（2026-10-28，证 `t413` **8/0**）：唯一事实源 = `src/domain/expectation_kinds.ts#KIND_SPECS`（每 kind 一条：`phase`/`fields`/`render`/`subject`/`axis`，**零依赖**，不引 zod 以保 domain 纯净）。由它派生：`EXPECTATION_KINDS` · `validateExpectation`（形状校验）· `renderExpectation` · `subjectPathOf`/`pathsOf` · **JSON Schema 两处 anyOf**（新 `scripts/gen-expectation-schema.mjs`，已接进 `npm run build`）。求值器**故意**留一处 `switch`（要 fs/db，属 application 层，且编译器兜底）。读数：`expectation.ts` 里逐 kind 的 12 分支 switch **已消失**（证 ⑥ 静态检查为 0）；加 kind 现在只改 **1 个文件 + 求值器 1 处**。★ 顺手修掉一个坑：生成器的匹配若只看 `kind.const` 会**误改证据联合体**（`expectations`/`reading`/`attestation` 也有 kind.const）⇒ 已收窄。**剩**：`T-#KIND-2` 的三处位置/命名问题 | `domain/expectation_kinds.ts`(新) · `scripts/gen-expectation-schema.mjs`(新) · `certs/t413` | 完成 |
| T-#KIND-2 | ✅ **三处结构归位**（2026-10-28，证 `t414` **13/0**）：① `probeRunEnv()` 从 `authoring/behavior/index.ts` 搬到 **`observe/run_env.ts`**（跨切面能力：任何"我们起的进程"共用），并补 `probeLoaderPath()` / `frameworkDistRoot()` 命名常量；② `transpileToCjs(…,{esm})` → **`transpileForHarness(…,{module})`**（名字说真话；`module:'esm'` 为默认方向），version_upgrade 适配器同步改名；③ `probe_hooks` 手算的 `resolve(…,'..','..','..')` → 语义名 `selfRoot` + **`AGENT_IO_PROBE_SELF_ROOT` 可覆盖**。回归 `t411` 8/0 · `t412` 8/0 全绿。**剩**：`run_tests` 尚未接 `probeRunEnv`（会改变"跑测试"的行为，需单独一张证）；`AGENT_IO_PROBE_SELF_ROOT` 只证了"可设置"，没证"指错会怎样" | `observe/run_env.ts`(新) · `authoring/behavior/index.ts` · `probe_hooks.ts` · `certs/t414` | 完成 |
| T-#OBSERVE-7 | ✅ **观测数据归属与保留已定并钉住**（2026-10-28，证 `t415` **8/0**）：按"谁的事实"分 —— 运行时事件属**项目**（`<proj>/.agent/observe/`，判据零配置从此读）、判据属**项目册**（`.agent-io/design/`，进 git）、插桩备份属项目中间态（`.agent-io/*` 已排除）、**框架自证（`certs/`）不随项目走**。★ 本仓 `.gitignore` **早已**排除 `.agent/`（第 58 行"运行时数据不入库"）⇒ 我原打算改它，**撤销**（与既有policy一致才对）。真正缺的是**保留策略**：`run_env.pruneEvents()` 只留最近 N 份 `events-*.jsonl`（默认 20，`AGENT_IO_EVENTS_KEEP` 可调），**只碰这个命名模式**（`dsl.json`/别的文件绝不删），且 **best-effort**（清理失败不影响 spawn）。**剩**：① **跨版本可比性**没机制（事件内容随项目演进，"同一判据去年的事件"怎么比——未解）② `AGENT_IO_EVENTS_KEEP` 极端值未逐值证 | `observe/run_env.ts` · `.gitignore`(既有) · `certs/t415` | 完成（保留策略已落） |
| T-#OBSERVE-6 | ✅ **零污染插桩（B）端到端闭环**（2026-10-28）：`t411` **8/0**（loader 层面：源码零改动/输出一致/事件含 args+ret/不设 sink 即 no-op/无插桩点照跑）+ `t412` **8/0**（判据链层面：**一条真 `behavior-cases` 判据**跑完，事件落到 `<project>/.agent/observe/`，用户代码被插桩、L3 零配置可读）。★ **过程中抓到两个真 bug**：① `behavior-cases` 对 **`.mjs` 目标本来就挂**（TS 尊重 `.mjs` 的 ESM 格式 ⇒ `module:CommonJS` 也不转 ⇒ require 报 `Unexpected token 'export'`；本仓 128 张证全是 `.mjs`）② **ESM loader hooks 不拦截 CJS `require`** ⇒ harness 转 CJS 再 require 会把用户代码挡在观测之外。修法：harness 改跑 **ESM 目标**（`target.mjs` + `await import()`），并把 `.mjs` 的 transpile fileName 去 ESM 后缀。另加 `AGENT_IO_PROBE_OFF=1` 总开关（观测可一键关）。**剩**：`.ts` 不在 v1（需宿主 transpiler）；`run_tests` 作第二落点 | `observe/probe_loader.ts` · `probe_hooks.ts` · `authoring/behavior/index.ts` · `certs/t411`·`t412` | 完成 |
| T-#OBSERVE-5 | **零污染插桩（方案 ④）**。✅ **步①已完成**（2026-10-28，证 `t410` **7/0**）：插桩骨架本来就把流程拆成 `collectSites → applyInsertions → [写盘]`，唯独 `write:false` 时**把算好的改写文本扔了**（又是"读数在中间层蒸发"）⇒ 现 `InstrumentFileResult.content` 交出改写全文（无需改动时 `undefined`= 有意义的"没变化"信号）。实测 **"内存落地"与"落盘落地"产出逐字节相等**（没有第二套改写逻辑）。**剩**：② TS loader（`module.register`）+ **启动器** `agent-io run -- <cmd>`（★ 仓里现在**完全没有** loader/runner 基础设施；且用户跑法要改 = 组织阻力最大）③ Go 用 `go build -overlay`（源码不动）。★ 阻力另见 `docs/plans` §28.1 | `instrument_skeleton.ts` · `certs/t410` | 步①完成（②③ 待批） |
| T-#OBSERVE-4 | ✅ **桩点三处账实不符全部收口**：① 命名契约 → 按 `rule` 选（`t416` 6/0）；② 台账 ≡ 源码（`t419` 6/0 + `t420` 7/0，根因是表达式体箭头**缺 template**）；③ **推荐器 → 插桩器接上**（`t421` 7/0）：`contract_probes` 早已存在但**只认内联数组**，推荐清单落 `.agent-io/observe-points.json` 却没人读 ⇒ 新增 `contract_from_points=true` 直读清单 `points[].key`（与插桩器**同源同命名**，零漂移）；★ 清单缺失/为空 ⇒ **报错不插，绝不静默退回全量**；工具已正式声明这两个参数、SPEC 放行、`AGENTS.md` 的触发行改成一条工作流（`recommend_observe_points` → `observe action=instrument contract_from_points=true`） | `observe/handlers.ts` · `observe/index.ts` · `gen_agents.mjs` · `certs/t421` | 完成 |
| T-#OBSERVE-8 | ✅ **L3 观测入口 + 探针依赖闭包排除**（2026-10-28）：① 入口 `npm run observe:collect -- <cmd>`（证 `t417` **9/0**：注入生效/退出码透传/PROBE_OFF 退化/采到即判 pass）；② **闭包排除**（证 `t418` **7/0**）—— 新增 `probe_closure.ts` 按 import 图算**探针可达闭包**，闭包内绝不插桩、闭包外可插 ⇒ **框架自己的 dist 也第一次能被观测**。实测：一次真跑 **456 条事件 / 11 个文件**（含 `expectations.js`/`judge.js`/`db.js`），框架规则 `design:silent-error-discard` 判 **456 条全 ok**，册里那条判据随之覆盖全仓。★ 关键认知：静默自伤的真凶**不是探针本体**（只 import node 内置），而是**插桩器的依赖**（`ts_kernel` 那批跑在 hooks 线程里）⇒ 必须两条闭包都排。**剩**：① Go/Python 的零污染机制（Go 用 `-overlay`）② 闭包靠静态扫描相对 import，动态拼路径会漏（留 `AGENT_IO_PROBE_SELF_ROOT` 兜底）③ 整 dist 插桩的性能代价只在小夹具上量过（一次真跑 2.9s，未做大项目评估） | `observe/probe_closure.ts`(新) · `probe_hooks.ts` · `run_env.ts` · `certs/t417`·`t418` | 完成 |
| T-#OBSERVE-3 | **回流审批（proposals + 四层门）该保留到什么程度**（2026-10-28 分析，待裁）：**规矩必要**（改册必须留痕 + 不许自批 + **失败方向恒为"拒"**）；**但机制目前空转** —— 本仓 **0 条提案**，唯一产者是 `run_loop` 的"累犯波及模式"一种。★ 结构性理由：新模型里"运行时偏离"的自然归宿是**判据红**（`runtime` 判据 fail）⇒ 人再决定"改代码还是改册"，比"提案库 + 四层门"少一层状态机。建议：保留三条规矩，把提案库降级为 `run_loop` 内部实现（不对外暴露 approve/reject），或等 `runtime` 判据上线后再定 | `infrastructure/analysis/observe/run_loop.ts` · `approve_gated.ts` | 待裁 |
| T-#OBSERVE-1 | ✅ **L3 运行时判据已落地**（2026-10-28，证 `t409` **9/0**）：第 12 种 kind `runtime {probe, expect?: ok|deviation|absent, events?}` —— **零配置**自动找 `<root>/.agent/observe/events*.jsonl`（取 mtime 最新），复用**同一套** `judgeEvent` 规则；四态齐（无文件/无该 probe/空文件 ⇒ unsupported）。框架自此三层闭环：L1 静态 7 种 · L2 `behavior-cases` · L3 `runtime`，共用 `judgeExpectations` 与 4 个自动触发点。**剩**：① `decls`（链路契约）那一半仍要 `observe action=judge` 手工带 ⇒ 下一步把册里的 chain 声明渲染成 decls ② 真项目上写第一条 runtime 判据（本仓目前没有 events，需先插桩） | `domain/expectation.ts` · `design/intent/expectations.ts` · `certs/t409` | 完成（待采用） |
| T-#SURFACE-4 | ✅ **`observe` 单入口可用性已修**（2026-10-28，证 `t408` **6/0**）：实测两个真缺陷 —— ① 传错参数（`action=log` 给 `events_path`）只报"缺 events_file"，不说"你给的是 trace 的参数"；② 下游报错会漏出**已摘掉的旧工具名**。修法：入口加**按 action 的参数守卫**（白名单 + 陌生人点名 + 缺必填列清单），且**顺序**先报"传错"再报"缺什么"（实测反了会误导）。**剩**：`proposals` 的 approve/reject（写盘）与 `instrument` 真插桩属另一张证 | `src/application/observe/index.ts` · `certs/t408` | 完成 |
| T-#SURFACE-3 | **工具重合/可吸收度已是读数**（`node scripts/audit-tool-overlap.mjs`，2026-10-28）：重合 = 入参 Jaccard + 共享字段数（≥2 且非单参数工具，否则虚高）；可吸收 = 副作用形态 / 前置条件 / 无自查 `action` 三条相容。终态：57 工具 → 15 对高相似 → **8 对可吸收候选 / 7 对被否**。**剩**：加**执行核重合度**（handler 传递闭包 ∩ handler 传递闭包，用符号级 call edges）——它是"能不能吸收"的最后一道判据（`rename_symbols ↔ rename_files` 相似 0.667 但执行核不同，只能靠它否掉） | `scripts/audit-tool-overlap.mjs` · `cache.db` call edges | 迭代中（候选已可复跑） |
| T-#SURFACE-2 | ✅ **`observe_*` 五合一完成**（2026-10-28，按用户裁定"**效果可替代就替代，接口形状不是约束，可以重写**"）：`observe { action: log | trace | judge | instrument | uninstrument | restore | ledger | proposals }`（proposals 子动作走 `op`）。执行核**一份**：`log/trace/judge` 原样留在 `observe/handlers.ts`；`observe_proposals` 从 `meta/index.ts` 内联 handler **抽出**到 `meta/proposals/handler.ts`（抽出而非复制）。验收 = 等价性证 `t407` **5/0**：**7 个场景**（含 instrument 的 ledger/dry、proposals 的 list）`data` 逐字段相等，仅排除已声明 wall-clock 字段。工具数 57 → **55**。★ 教训：先按"形状"判断会得出"只能并 3 个"，按"**效果可替代**"判断才能并 5 个 —— 判据选错会直接改变结论 | `src/application/observe/index.ts` · `meta/proposals/handler.ts` · `certs/t407` | 完成 |
| T-#DOMAIN-1 | ✅ **域表假账已清 + 漏登记的已补**（2026-10-28）：删 `design-bricks` / `archify-r5`（`dir` 不存在、0 源码）⇒ 又由 `structure_gap` 挖出 **`harvest` 域仍在表里（目录已随整线退役删除）**，一并删；补 **3 个"在但没登记"**的目录（`design-db` / `design-line` / `design-rewrite`，其中 `design-db` 正是这几轮改的地方）。★ `role` 是闭集（capability/analysis/engine/adapter），我第一版写 `derive` 被**当场拒**（"写错 = 该域静默退出判定 = 假绿"）；按惯例（`application/design/*` 全是 capability）修正。终态：**60 域 · 待搬 0 · 待定归属 0 · 待建域 0 · 声明与位置打架 0 · 未标 role 0**。★ 顺带清掉设计册里 **12 个 harvest 残留节点**（两个 feature 各 6 个）⇒ 册内"指向不存在文件的节点" **10 → 0** | `structure.domains.json` · 设计册 | 完成 |
| T-#GATE-IMPACT | **写闸自动附带波及**：`edit_dsl` / `edit_code` 写入时**自动**算影响面（深度 1 直接消费方 + 风险），高风险时要求 L4 证据 —— 现在"改前看影响面"仍靠模型自觉。★ 分两步：先只加读数不阻断，跑一轮确认不误伤；再升级为"高风险必须带 evidence" | `src/application/design/rewrite/*` · `edit_code` 写路径 | 未开工（`impact_analysis` 已并入 `explore_code action=impact`，按需查有了） |
| T-#TRANS-STAGE | **翻译册登记进 `stage_registry`**（带 `isFresh` 比 `meta.baseline.scanRev`）：现在册子**不参与保鲜链**，代码变了它静默过期（`dsl_live`/`dsl_features` 都有 stage，册子没有）。★ 原料已备：册子里已写 `scanRev` / `dbSchemaVersion` | `src/application/stage_registry.ts` · `translate/book.ts` | 未开工 |
| T-#TRANS-GEN | **`ts_codegen` 两处漏映射**（实测打穿 5/55 文件 / 35 error）：① Go 泛型实参 `Channel<struct{}>` 直接抄进 TS；② 函数类型把**参数名当类型** `(arg: pattern, …)`。另：孔体是空函数体（编译得过、运行时静默 undefined）⇒ 应改 `throw new Error('TODO(translate)')` | `src/infrastructure/authoring/translate/ts_codegen.ts` | 未开工（有实测证据） |
| T-#TERM-PARSE | ✅ **已完成**（2026-10-28，证 `t437` **14/0**）：新增 `typeIdents()` —— 按 Go 类型文法分词 + 递归下降，只收**类型位置**标识符（形参名/字段名/方法名不收），`unmappedGoTypes` 改吃它。8 个刁钻样本逐条钉住；防过度修复（`Channel` 仍被抓）与不回归（`T` 不算术语）同证。★ [未核] 类型约束联合 `~int | ~string` / 嵌套匿名 struct tag | `translate/book.ts` | 完成 |
| T-#TYPE-AST | ✅ **已完成**（2026-10-28，证 ``t439`` **12/0**）：``TypeRef`` 结构化类型树 + ``typeRefFromNode``（AST 直出）+ ``renderTsType``（零 exec/match，按 kind 分派）；5 处接线，**重构不改行为**（55 文件逐字与基线相同）。★ 遗留：``mapGoType(string)`` 留作 fallback（册子 ``sig`` / cache.db ``params[].type`` 仍只有字符串）；**[未核]** 联合约束 ``~int | ~string`` / 方法值 / 内嵌接口 | ``translate/{unit,go_extractor,ts_codegen}.ts`` | 完成 |
| T-#STD-SHIM | ✅ **已完成**（2026-10-28，证 ``t440`` **10/0**）：Go 限定名垫片（每模块 ``declare namespace``，只声明不实现）；从**类型树**收集（``collectQualified``）；**TS2503 127 → 0**、总错误 544 → 423、语法类仍 0。★ 剩 TS2554×339（填孔阶段）/ TS2695×51 / TS2304×12 | ``translate/{ts_codegen,project,go_extractor}.ts`` | 完成 |
| T-#FILL-RUN | **LLM 填孔全仓试跑**：`fill` 单文件已通（`rrf.go` 1/1、7s、语义忠实）；下一步对 agent-memory 51 模块跑 fill，把 423 → ？的读数拿到，并抽检 5 个填出来的函数语义 | `translate` · `scripts/audit-llm-fill.mjs` | 单文件已通，全仓未跑 |
| T-#GW-STATS | **网关 stats 持久化写 0**：24 次真实调用后 `gateway.stats.json` 仍为 0（内存 `getStats()` 才对）⇒ 该文件**不能当进度读数**；我据此误判「全仓卡住」并杀掉了正在跑的进程 | `src/infrastructure/llm_gateway.ts` | 未修 |
| T-#FILL-MISS | 填孔失败集中在**批中缺块**（LLM 少输出某些 `<unit>` 块）⇒ 失败后**自动降级为单孔重试**，不要整批再试 | `translate/fill.ts` | 未开工 |
| T-#MECH-BODY | ✅ 首版已落（2026-10-29）：`body_mech.ts` 机械翻函数体 + extractor 产出 `mechBody` + project 优先用机械体；5 文件实测机械 16 个 / **fail 8→0** / 408s→352s。**覆盖仅 16%**（天花板 72.6%）⇒ 待补：三式 for 的 init/post、`_ = x`、切片/map 操作、errors 传播；每补一个形态都要对拍验 | `translate/body_mech.ts` | 进行中 |
| T-#MECH-TYPES | 机械翻缺**类型环境**：/ % 整型 vs 浮点语义不同 ⇒ 现在一律交 LLM（覆盖率 81.9%→80.1% 的代价）。解法：把签名里的 param/return 类型（	ypeRef）传进 ody_mech，即可翻 
/2→Math.trunc(n/2)、int(x) 精确化 | `translate/body_mech.ts` | 未开工 |
| T-#SHIM-VALUE | 垫片只收集**类型位置**的 `pkg.Name`，函数体里**值位置**的（`filepath.Join`/`os.OpenFile`）收不到 ⇒ tsc TS2304 ×789。解法：从 AST 收集 `selector_expression` 的 pkg 前缀 | `translate/project.ts` | 未开工 |
| T-#METHOD-CALL | Go 方法被翻成自由函数（接收者→首参），但**调用点没改写**：`st.Load()` 应成 `SkillTree_Load(st, …)` ⇒ tsc TS2339 ×457。解法：用最小类型环境判接收者类型后改写调用 | `translate/body_mech.ts` | 未开工 |
| T-#LAYER1-WIRE | **第 2 层消费册子**：`book.types` → `renderTsType(ref, termMap)`；`external_deps.strategy` → import 行；`book.symbols` → `x.M()`→`T_M(x)` 改写 | `translate/{ts_codegen,project,body_mech}.ts` | 未开工 |
| T-#TERM-46 | 册子 46 个**未覆盖术语**（Go→TS 名词）待人定：填补 `types` 表 | `agent-memory/.agent-io/design/memory.translate.json` | 待人工 |
| T-#ONE-ASSEMBLY | 单文件模式（`tool.ts`）与项目模式（`project.ts`）是**两条装配路径**，册子消费只接了后者 ⇒ 收口成一条 | `translate/{tool,project}.ts` | 未开工 |
| T-#STD-TAIL | std 余下小包适配：`slices` `signal` `syscall` `atomic` `heap` `unicode` `strconv` `math` `sha256` `hex` `fnv` `bytes` `bufio` `runtime` `norm` `exec` `io` `sql` `http` `mem`（各 1–12 个成员） | `translate/go_std.ts` | 进行中（11/33 包已完成，覆盖 ~86% 引用） |
| T-#PIVOT-TYPEREF-IDS | `pivot` 里的 `ident.name` 仍是**源侧文本**，未解析成轴心 `id` ⇒ 跨语言重名解析不了（第三语言到来前必须解决） | `translate/book_ts.ts` | 未开工 |
| T-#PIVOT-RESULTNAMES | 轴心不存**结果名**（Go 命名结果 `(principle, fix string)` 名字丢失）—— 文档性信息缺失，回译探针已如实标注 | `translate/book_ts.ts` | 未开工（小） |
| T-#BODY-IR-EXPAND | 体 IR 扩面：竖切已通（90/624 = 14.4%，`t447` 等价）。继续铺 `if`/`for`/`switch`/`defer`/字面量集合，每铺一类必须保 `t447` + `t441` 双绿 | `translate/body_pivot.ts` | 进行中 |
| T-#SHIM-MORE | 更多槽垫片：`conc.csp`（调度公平性有证才敢 certified）、`err.tuple`、`null.explicit` | `translate/slots.ts` | 未开工 |
| T-#SHIM-SITES | copy() 真正的位置：① 值类型 struct 参数**函数入口** ② 返回 struct 值 ③ `append(slice, structVal)` ④ 字段赋值。每接一处须报"插了多少处"（现在是 0/109，机制通了但数据没生效） | `translate/{body_pivot,body_mech}.ts` | 未开工 |
| T-#KILL-LEGACY | **最大结构债**：`body_mech` 两套路径并存（pivot + legacy ~500 行）。按规则组迁进 lift/project，每组 `t447`+`t441` 双绿，迁完删 legacy | `translate/{body_mech,body_pivot}.ts` | 未开工（下一步） |
| T-#FEATURE-MATRIX | **特色矩阵**（8 语言 × ~30 构造，三态 ✓/~ /✗）：发现轴心的 **Go 偏心**（哪一维只有 Go 是 ✓），并按"多少语言需要"重排铺面。不做"更完美的语言"，做"缺口显式" | `docs/` + `translate/pivot.ts` | 未开工 |
| T-#FREEZE-BODYIR | 按 `docs/PIVOT-VERDICT.md`：体 IR **冻结在 38%**，不再铺面（单语言对无收益）；未来做第三种语言时才继续 | `translate/body_pivot.ts` | 已决定 |
| T-#KILL-LEGACY | `body_mech.ts` 有**两条并行体路径**（pivot + legacy ~500 行）。`if init` 只修了 pivot 一侧，legacy 同样丢 ⇒ 同一事实两份实现。移植规则组到 lift/project 后删 legacy，保持 t447+t441 双绿 | `translate/body_mech.ts` | 未开工 |
| T-#BASELINE-1010 | 把「零 LLM 回放 = **1010 错**」定为**棘轮基线**（确定性层改动不得让它上升；replayOnly 5 秒可测） | certs/ | 未开工 |
| D-#EDGE-DERIVE | 边派生已退役 ⇒ **不要**把 1382 条 import 边灌进 DSL（可随时从 AST 重算，写进去只会漂移成假账）。正解：**按需派生视图**（脚本/AST 现算），DSL 只留**不可派生的语义边**。参考实现 .agent-io/scratch/derive-edges.mjs（1 秒算出全仓 1382 条） | design/derive/* | 方案已定，待落成工具 |
| D-#EDIT-DSL-ERR-LAYER | `edit_dsl` 报错**不说"在哪一层"**：`edge.add 需要 id` 连报 3 次，id 实际在 **op 信封**（不在 `data`，`EDGE_DATA_KEYS` 里也没有）；`design_intent` 的 `goals` 只报「类型/取值不符」不说哪个键（实际 `{id?,title*,description?,status?}`）。应在错误里给出**期望形状 + 层级** | `application/design/dsl_ops/*` | 未开工 |
| D-#SCHEMA-FULL | `npm run tool -- <t> --schema` 输出被截断，而关键信息在**工具描述**里（`edit_dsl` 描述 12990 字写着「唯一判据表在 `dsl_ops/op_data_spec.ts`」）。给出 `--schema --full` 或直接把 zod 展开/json schema 打全 | `presentation/cli/*` | 未开工 |
| D-#EDGE-INTENT-MATCH | `design_intent.edge_intents` 用 `from`+`to`（文件路径）**匹配不到新加的边**，必须用边 id ⇒ 3/3 全"未匹配"。应兼容路径匹配，或在回执里直接给出可用的边 id 列表 | `application/design/design_intent.ts` | 未开工 |
| D-#GOALS-SHAPE-DOC | `design_intent.goals` 的真实形状 `{id?, title*, description?, status?}` **没有文档**，且与直觉 `{id,text,why}` 不符 —— 我按直觉写浪费两次调用。应在工具描述里给出可复制样例 | `application/design/design_intent.ts` | 未开工 |
| ~~T-#BASELINE-CERT~~ 已完成 | `certs/t453-replay-baseline-cert.mjs`（4/0）：基线 1010 棘轮 + 反向控制 + 可追溯 | certs/ | 已完成 |
| T-#DECISION-IN-BOOK | 把改动判据写成设计册里的 **decision expectation**（`edit_dsl` behavior-cases 那套），才能用规范形态 `decision:<node_id>#<index>` 申报。原因：`cert:` 形态不登记判据种类 ⇒ 强度按 unknown（`rewrite_plan.ts:216` 明写），画布永远留 1 个缺口 | docs + edit_dsl | 未开工（高优先） |
| D-#EXPECTATION-VOCAB | **判据词表与宿主不可见**：`decision.expectations[]`（8 种 kind）**只在 type=node 上**；`type=file` 只认 `path/responsibility/expected_apis/expected_deps/expected_behavior/status/lifecycle`（**没有 decision**）；`evidence` 形状是 `{type: trace|diff|node|edge|metric, ref}`。应全部进 `--schema`，带可复制样例 | `design/dsl_ops/op_data_spec.ts` | 未开工 |
| T-#SHADOW-USES | `T-#SHADOW` 的残留：body 里裸写 `Error(...)`（本意 logging.Error）在别名后会静默命中 JS 全局。彻底解法：把体内限定引用一并改写，或让 Go 侧 `logging.Error` 保留命名空间形态 | `translate/fixers.ts` | 未开工 |
| T-#LEGACY-IF-INIT | **legacy 丢 if-init**：`if err := f(); err != nil` 的 init 在 `body_mech.ts` 的 legacy 分支被丢弃 ⇒ `err×62 + ok×39 + existing×27 = 128` 个 TS2304（样本 `builder.ts:348`）。修法：给 legacy 的 `if_statement` 分支补 init 发射（pivot 侧已在 §157 修好） | `translate/body_mech.ts` | 未开工（高优先） |
| T-#TSC-DRIVEN-FIX | **用 tsc 报错当接收者类型口径**：TS2339 报错自带（文件/行/列/属性/接收者类型）⇒ 把 `recv.Prop(args)` 确定性改写成 `Prop` 对应的自由函数 `Type_Prop(recv, args)`。不需要类型推断、不需要猜覆盖、找不到函数就不改（绝不半改）。预期打掉 ~265 个 TS2339（样本 builder.ts:172/180/187） | `translate/` 新增后处理 | 未开工（高优先） |
| T-#LEN-MAP-TYPED | `len(x)` 在 TS 侧要区分 Map(`.size`)/Array(`.length`)。**内联三元已实测更差**（546→584：接收者重复求值 + 复合表达式）。正解：用**类型环境**（册子/pivot 类型槽）或 tsc 报错驱动改写。同族：`cap`、`append` 到 Map 的场景 | `translate/` | 未开工 |
| D-#TASK-L1-RELEASE | ★ **L1 卡（无 decision 的节点）立卡后无法 release/void**：publish 从"决策卡"立 L1，但节点没有 `decision` ⇒ `release` 报「快照是从 decision 拍的 ⇒ 无法把判据写回」；`void` 又因为 `preparing` 只有 →claimed/→candidate 两条迁移而拒绝 ⇒ **卡永久卡在 preparing**（等于占位死卡）。建议：L1 卡的 `prepared_snapshot` 在无 decision 时记 `null` 并允许 release 直接回 candidate；或允许 `preparing → void` | src/domain/task_machine.ts + task 写端 | 未开工 |
| T-#NAMED-RESULTS | ★ **命名返回值（named results）完全没建模**，实测 9 个函数同形。Go：`func (es *ExplorationState) FilterDeadEnds(ids []string) (alive, dead []string) { … dead = append(dead, id) …; return }`；产物：`export function ExplorationState_FilterDeadEnds(ids: string[]): [string[], string[]] { … dead = [...dead, id]; return; }`⇒ ① `alive`/`dead` **从未声明**（Go 里它们是零值变量）⇒ TS2304 ×N；② **裸 `return` 丢了返回值**（签名要元组，body 给 `return;`）。修法（三层，缺一不可）：**extractor** 把命名结果记进单元（名字 + 类型 + 顺序）；**body 前置**每个命名结果落 `let x: T = 零值`（slice→`[]`、map→`new Map()`、string→`""`、number→`0`、bool→`false`、指针/错误→`null`）；**裸 return** 折成 `return [按声明顺序的命名结果]`（★ 顺序按声明，不是字母序）。判据要语义类：`behavior-cases` 对 `FilterDeadEnds(["a"])` 断言返回 `[[], ["a"]]`。| translate/go_extractor.ts + body 渲染 + book | 未开工（规范已定，见 memory §199） |
| T-#EMBEDDED-FIELD | ★ **Go 嵌入字段（embedded field）没建模**，实测 `CachedNode` 的 `graphNode` **整行丢失**。Go：`type CachedNode struct { graphNode; Dirty bool; … }`（首行是匿名嵌入）⇒ `node.Type` 是**提升字段**（promoted），`node.graphNode.Type` 是显式路径。产物：interface 里既没有 `graphNode`，也没有 `Type` ⇒ `Property Type does not exist on type CachedNode`。修法（结构层决策）：嵌入式在 TS 里用**组合 + 提升字段镜像**：① 照常发 `graphNode: graphNode;`；② 若嵌入类型**同文件已声明**，把它的字段**平铺**进本 interface（等价于 Go 的提升；同名冲突时自有字段优先）。判据要语义类：`behavior-cases`（对 `CachedNode` 的构造/读取给用例）或 `call-exists`；先以 `symbol-exists` 落代码再升级。| translate/go_extractor.ts（struct 字段渲染） | 未开工（规范已定） |
| T-#EMBEDDED-FIELD2 | 嵌入字段的代码已改（`embeddedFieldName` + `unitFromTypeSpec` 落成员），但产物仍无该字段，**且已排除缓存**（键已含翻译器指纹后仍 336→336）⇒ 结论：**改动走的是幽灵路径**——`CachedNode` 的 `fields` 不是由 `unitFromTypeSpec` 里那段循环产出的（或 `extractGo` 的单元结构另有来路）。下一步：先用探针打印 `extractGo()` 返回里 `CachedNode` 的 `fields`（本次探针两次写错：`extractGo` 签名没吃准），**确认字段从哪来**再动代码。★ 硬规矩：动渲染/提取前，先用探针证明「改这里会改变产物」。 | translate/go_extractor.ts + project.ts | 代码已入（inert）/ 待定位 |
| T-#BOOK-STALE | ★★★ **册子（book）是隐藏的过期层**，要**结构性**修（不是补丁）：`project.ts:755` `u.skeleton = skeletonFromSigTs(symSig, u)`，`symSig` 来自册子 ⇒ 改 extractor/codegen 后册子不重算，产物永远旧。链条已三步验证：① `extractGoFromFile` 的 `CachedNode.fields` **有** `graphNode`；② `renderTsSkeleton` 出 `graphNode: graphNode;`；③ 删掉产物重建仍**没有**。**结构性要求**：① `TranslateBook.translatorFp` **必填**（类型上写不出无指纹册子）；② 生成点 `rebuildBook` 盖章、写入点 `writeBook` 再校；③ 消费只走 `loadFreshBooks()`，不符即**拒用**（不是报警继续用旧的）。④ 指纹**唯一来源** = `translate/fingerprint.ts`，`project.ts`/`book.ts` 都从它取。★ 本轮进度：`fingerprint.ts` 已写好待落盘（`create` 计划被判 `stale`：新符号还没有 body_hash 可冻），⇒ 下一步改用**把指纹作为参数传给 `rebuildBook`**（避免 `book.ts → project.ts` 循环依赖），再统一改两个调用点。| translate/book.ts + project.ts + fingerprint.ts | 未开工（结构方案已定，卡在 create 计划的 stale 判定） |
★ 验收仪器已就位：`certs/t457-field-ledger-cert.mjs`（跨语言字段对账，118 结构体 · 当前只报 `CachedNode.graphNode` 一处）。修好后 t457 必须转绿。
| D-#ONE-AUTHORITY | ★★ **一处权威**：同域同一行为只能有一个权威处。实测 `translate/` 里 `range/switch/append/delete/len` **各有两份实现**（pivot 7 处理点 / legacy 10），导致一天内**三次**"修一份等于没修"。★ 关键实测：**按函数体文本查重 = 0 簇**（同行为 ≠ 同文字）⇒ 必须建在"行为"层。落地：① 用现有 `call-exists` 声明"legacy 必须委托 projectTsBody"（今天就能判）；② 新增派生器：按**输入构造集合**找疑似双权威（给设计侧判，不自动改）；③ 同域出现第二个独立实现 ⇒ 写闸拒（给"权威处是 X，请委托"）。边界 [未核]：跨语言/跨域是否算同一行为未定；纯函数等价实现需"合理性例外"通道。详见 `docs/ONE-AUTHORITY.md`。| design（判据派生）+ write_gate | 提案已写，未开工 |
| T-#FIELD-LEDGER | ★★ 字段账（A 档）：`certs/t457` 已做**跨语言字段对账**（Go 结构体声明 vs 生成的 TS 接口成员）——实测 **118 个同名结构体，只有 1 个字段丢**（`CachedNode.graphNode`）。三态：Go 有 TS 无（红）/ TS 有 Go 无（红）/ 齐。下一步（按用户"列字段"的诉求）：① 把字段账落进 `cache.db`（`fields(structure, name, type, written_in[], read_in[])`）；② 设计 DB 展示字段；③ 加"声明了但从未写入/读取"判据（免费的 A 档就能算，能抓死字段与漏写）。★ 明确不做：字段级**流转链**（B 档，别名/动态/路径/流程，数周且需语料验证；触发条件见 `docs/ONE-AUTHORITY.md` §十四/§十五）。| certs/t457 · translate/go_extractor.ts · cache.db schema | 对账已绿/红可判；入库与判据未做 |
| T-#GO-FACTS | ★★★ **用语义层做 oracle，替代手写的符号/字段解析**。spike 已通（`.agent-io/scratch/gofacts`，`go run . <dir>`）：`packages=5 files=48 **defs=5704 uses=23532 selections=4427**`；其中 **`memory.graphNode` 被选中 6 次**、**`memory.Type` 22 次**（★ **提升字段也被正确归因**）、`time.Format` 47 次。离线可用前提：`GOFLAGS=-mod=mod GOPROXY=off GOSUMDB=off`（x/tools@v0.46.0 在模块缓存里；`go/pointer` 已被移除 ⇒ 深度别名分析没有免费版）。落地顺序：① 新增 `occurrences(file,line,col,symbol_id,role=def|use|selection)` + `fields(structure,name,ordinal,type)` 两张表（与既有 nodes/edges 并列，**不替换**）；② Go 侧由 `go/packages` 填、TS 侧由 tsc `Checker` + `findReferences` 填；③ 新证 `t458` 做**对拍**：我们 extractor 的类型/字段推断 vs `go/types`，出分叉账（同 t454 口径）；④ 只替换"被证明我们错"的那部分手写逻辑，逐条；⑤ 项目不能 type-check 时**回落到 tree-sitter 并标 syntax-only**（不许假装精确）。★ 不清算的部分：翻译前端（AST→pivot IR）、body 渲染器、槽位、册子、DSL 判据 —— 语义库给不了这些。| translate/go_extractor.ts · index/schema.ts · certs/t458 | spike 已通，入库与对拍未做 |
| D-#BOOK-MIRROR | ★★★ **设计册与事实册同构**（用户：设计册要和实际册一模一样）：设计册 = 事实册投影 + 意图叠加。三规则（机器可判）：R1 键集合相等（事实有设计无=未设计红；设计有事实无=幻觉红，只能登记放行）；R2 **id 同源**（由事实册派生 `file_…`/`symbol_…`，不手起名）；R3 **人只写意图**（decision/expectations/goals/status），其余投影生成。能消灭的病：`go_std.ts` 这类"**没有设计节点=没有验收标准**"的文件在结构上不再出现。落地 F3：从事实册投影节点骨架 + 保留人工叠加；证 `t459` 做键集合对账（missing/extra 全登记）。★ 不推倒重来：现库有 12 证 / 9 门 / 336·195 双棘轮 / 124 判据，**验证是最贵资产**。详见 `docs/FACTS-VS-DESIGN.md`。| design/gen-db + DSL schema + certs/t459 | 未开工（规则已定） |
| D-#DESIGN-DECISIONS-IN-DSL | ★ 纪律：**设计决定必须落设计侧**（`design_intent goals` + 节点 `decision.expectations`），markdown 只留叙事与边界。原因：markdown 里的话判据看不见、闸管不着。已落 4 条新 goals（facts-two-layer / facts-design-mirror / no-rewrite-incremental / one-authority）。★ 坑：`design_intent.goals` 是**全量替换**（写增量会冲掉旧意图）⇒ 一律「读旧 + 合并 + 写全量」。| design（DSL）+ docs | 已落 / 纪律已记 |
| D-#PLAN-CERT-REF | ★ 计划闸 `planJudgementGaps` **不认 `cert:` 引用**（判"解不出来"）⇒ 凡"只能靠证判"的改动（如 SQL schema）**永远过不了计划闸**，只能靠 `AGENT_IO_REQUIRE_PLAN=0` 的迁移开关放行。建议：`cert:` 引用按其"证里声明的强度"参与判定（证本身若含语义类判据即视为强）。| design/db/rewrite_plan.ts#planJudgementGaps | 未开工 |
| D-#CERT-EXP-UNSUPPORTED | ★ 判据 kind=`cert` 在 `judgeExpectations` 里被判 **unsupported**（我们刚写的 `t458` 明明独立跑 4/0）⇒ 卡无法用它收口，只能退回 `source-has`（弱判据）。待查：证发现/执行/解析汇总行的哪一步失败（回执没给 why_not）。| 判据执行核（judgeExpectations 的 cert 分支） | 未开工 |
| T-#FACTS-PROVENANCE-DONE | ★ **已修（且假设被证伪）**：原以为 extractor 把 build tag 互斥变体`并集`，实测 extractor 是对的（`local_embedder.go`→{tok,session,maxLen} / `local_embedder_nocgo.go`→{vocabPath,ortDLLPath,modelPath} 各自正确）——真因是**证据侧缺出处**：`fields` 表没有 `file` 列，t460 按结构体名聚合 ⇒ 并集。已修：`fields` 加 `file` 列 + 主键 (file,structure,name)；gofacts 输出 file；semantic_facts 插入 file；t460 按 (file,structure) 对拍。结果：分叉 6 → 3（3 条 build tag 假分叉全部消失），t460 4/0。★ 教训：**事实必须带出处**，否则同名即并集。| index/schema.ts · index/db.ts · index/gofacts · certs/t460 | 已完成 |
| T-#T460-CLEAN | ★ **已清零**（2026-10-30）：`t460` 分叉 6 → 0（`missing=0 extra=0 type-diff=0`，116 对 (file,structure) / 740 字段）。两条成因都已修，且**判断被更正**：① `Builder.syncNotifier` 不是"我们渲染错"，而是**存的展示文本是源码原文**（`func(pattern, brain string)`），TypeRef 侧本来就是展开的 ⇒ 对拍前做 **Go 语法规范化**（分组形参展开）即可；② `embedAPIResponse.*` 是 **tag 剥除顺序**错（go/types 的 tag 是 `json:\"x\"` 带转义引号，先剥 `"[^"]*"` 会错配）⇒ 改为「转义引号→单引号占位 → 剥反引号串 → 剥双引号串 → 剥单引号串」。★ 边界：本账**只覆盖结构体字段账**；方法集/函数签名/参数顺序/返回值个数**尚未纳入对拍**。 | certs/t460 + .agent-io/extractor-divergences.json | 已完成（范围有边界） |
| T-#EXTRACTOR-IFACE-METHOD | 范围缺口（t461 记 43 条）：我们的 extractor **不为 interface 的方法**产出 unit，而 go/types 的方法集包含它们。影响：接口方法的签名不在翻译账里（跨语言契约会漏）。要不要覆盖 = 产品决策（不可盲目加）。| translate/go_extractor.ts | 已记账 / 待决策 |
| T-#T461-TIDY | t461 证书口径待收：`param-type`（包短名 vs 全路径归一化未净）、`unknown-extra` 36 / `build-tag-variant` 等。★ 这些多半是**比对口径**问题而非代码问题；收干净后 t461 才能像 t460 一样给出"清白"读数。当前 126 条已全登记（③④ 可过）。| certs/t461-signature-parity-cert.mjs | 已记账 / 未收净 |
| T-#EXTRACTOR-NAMEDRESULT-DONE | ★ **已修（t461 抓到、已清零）**：Go 的**分组声明** `(a, b T)` 类型只写在最后一个名字上；旧 `normResult` 逐项剥名 + `paramRefsFromList` 遇到"只有名字"的声明原样 push ⇒ 类型被推成名字（`distillSkill(...) (principle, fix string)` 产出 `(principle, string)`）。修法：**攒 pending 名字、遇到带类型的声明统一赋值**（Go 规范）。读数：`distillSkill` 现在 `(string, string)`、resultRef tuple 正确；t461 named-result-slot 10→0、param-type 13→0；t453 双棘轮 4/0 不涨。| translate/go_extractor.ts | 已完成 |
| T-#FACTS-DECL-ROW | ★ **已修（框架级真相）**：签名表是「一个形参/返回值一行」⇒ **零参零返回的函数一行都不插**，整条签名从库里消失（实测：`GraphWriter.Stop()` / `func main()` / `Vocabulary()` 全都凭空不见，而 gofacts 的 JSON 里明明有 633 funcs、3 个 Stop）。修：零参零返回时补一行 `kind=decl` 的**存在足迹**；t461 分组时 decl 不计入 params/results。★ 教训：**「每项一行」的表结构必须同时记录「有这一项」** —— 否则空集合 = 不存在，事实被静默吞掉。| index/schema.ts + semantic_facts.ts + certs/t461 | 已完成 |
| T-#T461-EXTRA-DONE | ★ **已查清（2026-10-30）**：77 条分叉全部有解释，本类**无代码 bug**：interface-method 43（语义侧有·范围外）· interface-method(ours-only) 10（我们有·形态差）· build-tag-variant 24（cgo/!cgo 变体）。过程收货：修掉「零参零返回函数不落地」的框架级 bug（T-#FACTS-DECL-ROW）。接口方法是否进翻译账 = 产品决策（T-#EXTRACTOR-IFACE-METHOD）。| certs/t461 + index/semantic_facts.ts | 已完成 |
| D-#IFACE-POLICY | ★ **接口政策已定（2026-10-30）**：接口是**契约不是实现**。① 接口方法无函数体 ⇒ **不做翻译单元**（t461 的 33 条 missing 是预期）；② **0 实现的接口不许静默存在**（删或标 reserved 带期限）；③ 实现者用**编译期断言**钉住（Go `var _ I = (*T)(nil)` / TS `const _: I = impl`）。事实基线：语料 16 interface / 33 方法；15/16 作字段、15/16 作形参返回；仅 LLMClient·Embedder 跨包；**接口已在翻译**（产物 135 interface 含 16 个来自 Go）。| design（goal: interface-contract-policy）+ certs/t461 | 政策已定 / 语料未清理 |
| T-#IFACE-AUDIT | ★ **已做成可重复读数**（不是手动改语料）：新证 `certs/t462-interface-contract-cert.mjs` + 事实表 `contracts(file,name,methods,impls)`。读数：**16 接口 / 33 方法 / 3 条契约问题**——`MemorySource` 0 实现 · `SessionRepository` 0 实现 · `LLMClient ≡ sender` 方法集重复（one-authority 违反）。三条已登记 `.agent-io/contract-audit.json`（带 reason + disposition + until 2026-12-31）。★ 语料在项目根外 ⇒ **写闸拒绝改语料**（快照进不去）⇒ 处置由语料属主执行，我们只出账。| index/gofacts · semantic_facts · schema · certs/t462 | 已完成 |
| T-#BODY-MULTIVAL | ★ **已完成（lift 层实测）**：多值短声明 `d, ok := f()` 与多目标赋值 `a, b = f()`。旧实现要求 lhs 恰好 1 个 ⇒ **静默 return null**（连原因都不记）⇒ 直方图只看到语句级兜底。读数：`lift 成功 281 → 391`（+110 体）· 失败 343 → 233；连带把 `if x, ok := …; ok`（55 条）也修好了（if-init 复用同一 liftStmt）。| translate/body_pivot.ts | lift 侧完成 / **产物侧未验证**（见 T-#REPLAY-REGEN） |
| T-#REPLAY-REGEN-DONE | ★★★ **已收口（2026-10-30）**：产物重生成固化 = `node scripts/regen-translate.mjs`（`npm run regen:translate`）。**根因**：`project.ts` 里 **mechBody + 填空缓存整块都在 `if (opts.fill)` 内**，我此前没传 `fill` ⇒ 确定性回放完全没执行 ⇒ 全孔；再加上缓存 key 版本升级缺迁移（834 条旧体不可达）。两处都修了。**读数**：`files=42 · holes 195 → 164 · errors 336 → 22`（两个数都降 ⇒ 真改进，非"丢体假绿"：抽查 `b.skillSender = s;` / `if (b.nrem !== null)` 是真翻译体）。基线已重设 `22/164`；产物备份 `src.bak-<ts>` 可回滚。纪律见 `AGENTS-RULES.md` §0.8。| scripts/regen-translate.mjs · translate/project.ts · AGENTS-RULES.md | 已完成 |
| T-#SYNTAX-MASKS-SEMANTIC | ★★★ **量具缺陷（已修）**：`tsc` **有语法错时会跳过语义检查** ⇒ "22 个错"是**被遮挡的读数**，修掉语法错后浮出 **372 条语义错**。`scripts/regen-translate.mjs` 现在**分开报** `语法 / 语义`，并在语法错 > 0 时标注"语义数不可用于比较"。★ 这是"假绿"家族的第三种形态：① 孔暴涨（丢体）② 缓存失效（旧体不可达）③ **语法错遮挡语义检查**。 | scripts/regen-translate.mjs | 已完成 |
| T-#MECH-ANON-STRUCT | ★ 已修（真因）：匿名 struct 的**位置式**字面量 `struct{A int;B string}{1,"x"}` 被渲染成 `{ undefined: v0, undefined: v1 }` ⇒ TS1005。修法：类型节点是 `struct_type` 时按声明顺序取字段名逐位补键 ⇒ 现产物 `{ Entries: s.Entries, Skills: s.Skills }`，**TS1005 归零**。★ 附记（**两次失败如实留痕**）：想顺手去掉 `as struct { Go 语法 }` 这半，试过「含空白就跳过」与「struct|map[|chan|[] 前缀就跳过」，errors 分别 22→372 / 22→535 ⇒ 已撤回。结论：**省断言不行**，要修得让 `typeText` 本身成为 TS 可写类型（类型渲染器的活）。 | translate/body_pivot.ts | 部分完成 |
| T-#MECH-METHOD-CALL | ★★ **最大的剩余簇（372 条里的主力）**：`TS2339 ×250` + `TS2304 ×108` —— 产物把 Go **方法调用**当对象方法用，而我们把方法翻成了**自由函数** `NremReplay_SetDreamSender(...)`：例 `Property SetDreamSender does not exist on type NremReplay`、`Cannot find name SkillTree_gatePolicy`。⇒ 要么给类型补方法声明，要么把调用点改写成自由函数调用。**先读 3 处产物 + Go 原文再定，别猜。** | translate/body_pivot.ts + ts_codegen | 未开工 |
| T-#REGEN-CACHE-CARRY | ★ 已修：regen 生成到**临时目录** ⇒ 看不到 `src/.fill-cache.json` ⇒ 每次冷启动（834 条历史体全丢，读数在 372/450 漂移）。修法：生成前把旧缓存复制进 tmp（生成后随 tmp 进目标 ⇒ 缓存自然延续）。`scripts/regen-translate.mjs`。 | scripts/regen-translate.mjs | 已完成 |
| T-#BODY-CROSS-IMPORT-DONE | ★★★ **已成对落地（2026-10-30）**：① 字段链改写（喂入本模块 type 单元文本集字段类型）② **改写后补 import**（改写产生的 `Recv_Method` 用单元表反查定义文件）。读数（好的一轮）：**语义错 533 → 360**，其中 `TS2339 163 → 95` · `TS2304 202 → 90`；holes 不变 164；语法 0。副作用教训：① 嵌套调用编辑重叠曾把文本切成 `...b.filter())ter(b));`（已按"外层优先 + 再跑一轮"修）② 两处代码**不在同一作用域**（`TS2304: introducedNames`）⇒ 用 WeakMap 挂在模块对象上。| translate/ref_rewrite.ts + translate/project.ts | 已完成（读数受 T-#REGEN-NONDET 干扰） |
| T-#TS2304-REMAIN | 补 import 后剩下的 90 条 `TS2304` 已是**另一类**：`contractGatePolicy`（const）、`cancel`（ctx cancel 变量）、`_`（空白标识符）、`httpResp`（局部）。⇒ 前两类是**常量/局部未产出或未改写**，`_` 是 Go 空白标识符被当变量用。按纪律：先各读 2 处产物 + Go 原文再定。 | translate/body_pivot.ts + project.ts | 未开工 |
| T-#BOOK-FIELDS | ★★ **已落地**：册子符号行现在带 `fields`（语义层 `fields` 表：structure/name/ordinal/type/json_tag/embedded）。读数：语料册 **793 符号 / 129 个带 fields**（例 `builder.go#Builder → retrievers: []…Retriever · heatStore: *…HeatStore`）。★ 缺口：类型仍是**全限定 Go 串**（`*github.com/jifeng/agent-memory.HeatStore`）⇒ 需一层 Go→TS 类型映射才能进骨架。 | translate/book.ts | 已完成（类型映射待做） |
| T-#CORPUS-DB-SEMANTIC | ★★★ **发现的断链（已补）**：语料 cache.db 原来 `nodes=875` 但 `occurrences/fields/signatures/contracts` **全是 0** ⇒ 语义层根本没进语料库，册子自然只能吃符号级。已跑 `fillSemanticFacts` 补齐：`occurrences 33576 · fields 740 · signatures 1396 · contracts 16`。★ 该补是**一次性手工动作**，没进任何自动流程 ⇒ 待做：`translate book=true` 前自动确保语义事实已刷新（或 import_project 覆盖）。 | semantic_facts.ts + 语料库 | 已补数据 / 自动化未做 |
| T-#BOOK-DUPLICATE-AUTHORITY | ★★ **两处册子（违反一处权威）**：`agent-io/.agent-io/design/task-system-plan.translate.json` 与 `agent-memory/.agent-io/design/…` 同时存在；生成读**语料侧**那份（带 fields），drift 等工具读**仓里**那份（无 fields）⇒ 迟早分叉。待定：册子归语料（描述语料的东西放语料侧）还是归仓。 | .agent-io/design | 待决策 |
| T-#FIELD-TYPE-TS-MAP-DONE | ★★ **已完成**：限定类型名收成**一处权威** `qualifiedTypeName`（`ts_codegen.ts`）：模块路径含 `/` ⇒ 剥成裸名；单段包名（`sync.Mutex`）保留给 stdlib 层。`renderTsType` 的 `qualified` 分支与 `mapGoType` 的兜底**都调它**（原来两处各自拼 `${pkg}.${name}`）。册子字段现在同时记 `type`（Go 全限定）与 **`tsType`（`Retriever[]` / `HeatStore`）**，走 `mapGoType` 同一处。读数：产物里 `github.com/jifeng` 出现 **0 次**；册子 `builder.go#Builder` 三字段 `tsType` 正确。 | ts_codegen.ts + book.ts | 已完成 |
| T-#SKELETON-FROM-BOOK-FIELDS-DONE | ★★★ **已完成（2026-10-30）**：① 结构体 interface **由册子字段出**（`renderTypeSkeleton` 优先 `u.bookFieldTypes`，AST 作回落）② 填空 prompt 带上**字段表**（名/TS 类型/json tag/是否嵌入）。读数：`骨架签名来源：册子 sigTs 769 · 回落 AST 64 · **结构体字段来自册子 124**`。产物实例：`interface Builder { retrievers: Retriever[]; heatStore: HeatStore; pendingErrors: Map<string,string>; … }`（语义层类型，不再是 AST 文本）。★ 关键教训：**只覆盖渲染，不动 `u.fields`** —— 直接覆盖会让导入表收不到类型引用，`TS2304 90 → 300`。 | translate/ts_codegen.ts + project.ts + book.ts | 已完成 |
| T-#REGEN-NONDET-DIAGNOSED | ★★★ **根因找到**：抖动来自 **`AGENT_IO_TSC_FIX=1` 把修好的体写回缓存** ⇒ 下一次命中"已修/未修"两种体。证据：`--no-fix` 连跑两次**完全相同**（630 / 164）；带 fix 则在 460~649 之间跳。⇒ **评测一律用 `node scripts/regen-translate.mjs --no-fix`**（决定论模式），基线 630/164。待做：让 fix 结果进**独立层**（`fixes/`，可审计可丢弃），而不是污染填空缓存。 | scripts/regen-translate.mjs + translate/project.ts | 已定位 / 隔离未做 |
| T-#PKG-BARREL | ★★★ **已完成（2026-10-30）**：补上结构缺失的那件东西 —— **Go 包 → TS barrel**。Go 的「包 = 命名空间」（一目录 N 文件共享），TS 的「模块 = 文件」⇒ 映射需要一个 `<pkg>/index.ts` 桶。读数：`Cannot find name 'logging' 90 → 0`，总错 **630 → 540**（--no-fix 决定论模式，复跑一致）。★ 踩的坑：① 仓内包被册子记成 external_dep 且 target 空 ⇒ 原分支直接 `continue` 永不 import ⇒ **仓内判断必须放在 depTable 之前**；② `usedPkgs` 只收类型位置，**体内的包级调用**（`logging.Warn(...)`）收不到 ⇒ 扫描正文里 `小写标识符.` 且命中产出目录名。| translate/project.ts | 已完成 |
| T-#PKG-BARREL-NEXT | barrel 立起来后，下一批缺名是**同类**：`memory`（httpapi/openai.go）、`norm`（wordpiece.go）等 —— 语料里还有别的包级引用没落地。判据：再跑 `node scripts/regen-translate.mjs --no-fix` 看 `Cannot find name` top10，若仍是包名 ⇒ 同一修法覆盖（可能只需把 barrel 也生成到子目录层）。 | translate/project.ts | 未开工 |
| T-#CALL-IMPORT | ✅ **已完成（2026-10-30，随 T-#PIPELINE-ONE-PLACE 一起落地）**：晚到 import 名改为**从最终正文反查**（`module_build#importNamesFromBody` ∩ `defined`，排除本文件 / `__multi__` / JS 内置 / 已 import 的名字），并在**拼 m.ts 之前**并入 `m.imports`。读数：TS2304 **209 → 97**，其中 `Type_Method` 形态（`HeatStore_UpsertSkill`…）**101 → 0**（60 个名字清零）；总错 **540 → 435**；holes **164 不变**。 | translate/project.ts · translate/module_build.ts | ✅ 已完成 |
| T-#PIPELINE-ONE-PLACE | ✅ **已完成（2026-10-30）**：`assembleModule` 成为「算导入 / 生成正文 / 拼 m.ts」的唯一出口 —— 签名收 `defined` + `pkgDirs` 两个**入参**（删掉 `INTRODUCED_BY_MODULE` / `PKG_DIRS` 两个进程级可变全局，顺带修并发污染），删三处死码（册子字段名正则段 / `INTRODUCED_BY_MODULE` 段 / 装配后补刀块），晚到名字也从正文反查。判据：`source-has`（三个旧载体全文 0 命中）+ 2 条 `call-exists`（`assembleModule→importNamesFromBody` / `→ownerFileOf`）。 | translate/project.ts · translate/module_build.ts | ✅ 已完成 |
| T-#CERT-1 | **20 个无证工具**（`scripts/audit-tool-certs.mjs`，量具已修为以注册表为真源：55 工具 / 35 提到 / **20 无证**）。★ **顺序已纠正**（2026-10-28 用户："A 这批几乎全部可以吸收进设计侧"）⇒ **先收敛、后补证**：A 档 11 个读数工具几乎全可吸收/合并（见 `docs/tool-convergence.md`），给"注定要合并的工具"写证是浪费。**步 1** 纯工具内合并（`plan_refactor`→`apply_refactor_plan`、`render_design`+`feature_line`→`get_dsl`、`find_similar_names`+`suggest_renames`→`rename_symbols`、`tool_usage`+`capability_audit`→`capability_map`）；**步 2** 变判据（`code_health`→`domain-independent`+新 `dead-code`+新 `metric`；`impact_analysis`→写闸前置；`detect_drift` 复核后退役）；**步 3** 只给幸存者补证（预计 5–6 张） | `docs/tool-convergence.md` · 各线 index.ts | 顺序已定（步 1 未开工） |
| T-#RP-1 | **重写计划闸**：默认已翻（2026-10-28，`AGENT_IO_REQUIRE_PLAN` 三态，`=0` 只报）· 回执渲染✅ · 其它写工具文本渲染✅。**剩**：① 拿真实任务量一次严格档的误报率（本仓会被任务闸先拦 ⇒ 需要一张真领的卡）② 调 `planGaps` 粒度 | `src/application/write_gate.ts` · `design/db/rewrite_plan.ts` | 迭代中 |
| T-#98d-old | 三条门类证跑不起来（已修，保留一行说明去向：t352 ✓ 17/0 · t332 ✓ 10/0 · t353 仅剩 T-#98d-2 那 6 条） | `certs/` | ✅ 已修 |
| T285 | Go `uninstrument` 后残留空 `internal/` | `observe-lang-go` | 未做 |
| T305 | `lint` 对「打断宿主」类问题 | `observe-lang-*` | 未做 |
| T308 | Go 侧区间替换重叠 | `observe-lang-go` | 未做 |
| T309 | 插桩报告把「0 探针文件」算进「已跳过」 | `observe-lang-*` | 未做 |
| T310 | Go ledger 无 `functions` 计数 | `observe-lang-go` | 未做 |
| T312 | Python scope / deep 模式未实现 | `observe-lang-py` | 未做 |
| T313 | Python 侧没有行为证（`tests/` 下无对应 `*.test.ts`） | `observe-lang-py` · `tests/` | 未做 |
| T320 | 探针运行时不会自动拷进被测工程 | `observe-lang-*` | 未做 |
| T282 | class getter/setter 同名探针 | `observe-lang-*` | 未做 |
| T284 | class 静态块 / 字段初始化器未插桩 | `observe-lang-*` | 未做 |

## 五、文档

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T235 | `docs/*.md` 的目录分组口径 + 2 处功能线 thread | `docs/` | 未做 |

## 六、前提已变（别再按原文做）

| 编号 | 原文说的 | 现状 |
|---|---|---|
| T154 | 把现有 37 篇文档… | `docs/` 12 份 md |
| T94 | `glossary.md` 落后 | 文件不存在 |
| T109 | `votes` 全 = 1/3 | 50 张决策 0 张有 votes |

---

## 七、真项目实测留下的缺口（2026-10-27，七个 npm 包各数一遍）

> 口径：`.agent-io/scratch/probe-many.mjs <项目根> <标签>`，隔离 home 在 `D:\agentio\dev\_fixtures\`。
> 现状（2026-10-27 收盘）：
> · **JS 系七个**：express 4.21.2 · commander 11 · chalk 5 · axios 1.7 · zod 3 · lodash 4.17 · socket.io 4
>   ⇒ `failed` **全 0**、相对导入落地率 **全 100%**
> · **换语言两个**：gin 1.10（Go）`failed 0`（2026-10-27 T-#95b/#95c 后：原 12）· flask 3.0（Python）`failed 1`
>   ⇒ import 边：gin **188**（原先 0）· flask **177/182 = 97.3%**（原先 0）
>   ⇒ gin 的 call 边 **425**（T-#95b/#95c 后：原 413）· 解析到 **206**（原 196）
>   ⇒ flask 那 1 条是 `sansio/app.py:534 DispatchingJinjaLoader`：该文件**没有 import 它**
>     （只有 `flask/app.py` 里 import）⇒ 按"能证明才建边"的纪律落 failed 是对的，属上游可疑写法

| 编号 | 缺口 | 证据 | 在哪 |
|---|---|---|---|
| T-#94d | 浏览器 bundle 里 `typeof X === "function"` 引用的**宿主名**靠表兜 | socket.io `addEventListener` 已补进 `JS_HOST_GLOBALS`；同类名字会继续冒（`postMessage`/`Worker`…） —— 想清楚要不要按"宿主声明来源"成批登记 | `index/symbols.ts` |
| T-#94f | **IIFE 里的 bundle ⇒ 契约面为空**（`is_closure` 全打上） | socket.io `client-dist/socket.io.js` 104 个符号全 `is_closure` ⇒ 空索引守卫曾误拒（已改成数总数）；这类仓库的"对外 API"只能在 `wrapper.mjs` 那层看见 | `graph/import_project.ts` · `parse/kernel.ts` |
