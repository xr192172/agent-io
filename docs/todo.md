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
| T-#CERT-1 | **29 个工具没有任何证**（2026-10-28 盘点：`node scripts/audit-tool-certs.mjs`，64 个工具里 35 个被证提到过、29 个一次都没出现）。★ 口径：提到≠验过，但**没提到的必定没验** ⇒ 无证清单是可靠欠账。**按风险排序建议**：① 破坏性优先（`move_domain` / `move_symbol` / `deprecate_offline` / `upgrade` / `sync_contracts`）② 读数为核心的（`code_health` / `run_tests` / `impact_analysis` / `detect_drift` —— 它们撒谎会影响别人的判断）③ 生成类（`translate_go_ts` / `translate_book`，215KB 子系统目前 0 证） | `certs/` · `scripts/audit-tool-certs.mjs` | 未做（清单已可复跑） |
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
