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
| T-#REF-TYPES | 引用改写覆盖率 15.1% → 更高：用册子 `sigTs` 的**返回类型**给「局部变量 = 函数调用」补类型，再改写（现在只认参数/局部注解/interface 字段） | `translate/ref_rewrite.ts` + 册子 | 未开工 |
| T-#BUILD-VAR | **Go build tag 变体未建模**：`local_embedder_nocgo.go` 与 `local_embedder.go` 各定义一次 `LocalEmbedder` ⇒ 反向映射 7 组同名、输出 `TS2300`（Duplicate identifier）×9 | `translate/book.ts` | 未开工（证 t443 逼出来的） |
| T-#PIVOT-TYPEREF-IDS | `pivot` 里的 `ident.name` 仍是**源侧文本**，未解析成轴心 `id` ⇒ 跨语言重名解析不了（第三语言到来前必须解决） | `translate/book_ts.ts` | 未开工 |
| T-#PIVOT-RESULTNAMES | 轴心不存**结果名**（Go 命名结果 `(principle, fix string)` 名字丢失）—— 文档性信息缺失，回译探针已如实标注 | `translate/book_ts.ts` | 未开工（小） |
| T-#PIVOT-LIFTPROJ | 轴心第 5 步：把 `body_mech` 拆成 `lift_go` + `project_ts`，让**函数体也走轴心**（现在 body 是 Go→TS 直连，绕开轴心） | `translate/{body_mech,go_codegen}.ts` | 未开工（最后一步） |
| T-#CERT-1 | **20 个无证工具**（`scripts/audit-tool-certs.mjs`，量具已修为以注册表为真源：55 工具 / 35 提到 / **20 无证**）。★ **顺序已纠正**（2026-10-28 用户："A 这批几乎全部可以吸收进设计侧"）⇒ **先收敛、后补证**：A 档 11 个读数工具几乎全可吸收/合并（见 `docs/tool-convergence.md`），给"注定要合并的工具"写证是浪费。**步 1** 纯工具内合并（`plan_refactor`→`apply_refactor_plan`、`render_design`+`feature_line`→`get_dsl`、`find_similar_names`+`suggest_renames`→`rename_symbols`、`tool_usage`+`capability_audit`→`capability_map`）；**步 2** 变判据（`code_health`→`domain-independent`+新 `dead-code`+新 `metric`；`impact_analysis`→写闸前置；`detect_drift` 复核后退役）；**步 3** 只给幸存者补证（预计 5–6 张） | `docs/tool-convergence.md` · 各线 index.ts | 顺序已定（步 1 未开工） |
| T-#RP-1 | **重写计划闸**：默认已翻（2026-10-28，`AGENT_IO_REQUIRE_PLAN` 三态，`=0` 只报）· 回执渲染✅ · 其它写工具文本渲染✅。**剩**：① 拿真实任务量一次严格档的误报率（本仓会被任务闸先拦 ⇒ 需要一张真领的卡）② 调 `planGaps` 粒度 | `src/application/write_gate.ts` · `design/db/rewrite_plan.ts` | 迭代中 |
| T-#98d-old | 三条门类证跑不起来（已修，保留一行说明去向：t352 ✓ 17/0 · t332 ✓ 10/0 · t353 仅剩 T-#98d-2 那 6 条） | `certs/` | ✅ 已修 |
| T285 | Go `uninstrument` 后残留空 `internal/` | `observe-lang-go` | 未做 |
| T305 | `lint` 对「打断宿主」类问题 | `observe-lang-*` | 未做 |
| T308 | Go 侧区间替换重叠 | `observe-lang-go` | 未做 |
| T309 | 插桩报告把「0 探针文件」算进「已跳过」 | `observe-lang-*` | 未做 |
| T310 | Go ledger 无 `functions` 计数 | `observe-lang-go` | 未做 |
| T312 | Python scope / deep 模式未实现 | `observe-lang-py` | 未做 |
| T313 | Python 侧没有 certs | `observe-lang-py` · `certs/` | 未做 |
| T318 | `npm run certs` 全量在 WorkBuddy 环境 | `certs/run-all-certs.mjs` | 未做 |
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
