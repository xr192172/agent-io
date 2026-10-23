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
| T287 | `edit_code replace_text` 回执说「未找到」而实际写入 | `src/application/refactor/edit/edit_code.ts` | 未复核（与 T288「误判」冲突） |
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
| T245 | 两条写路仍是两份实现 | `src/application/write_gate.ts` · `apply_writes.ts` | 待查 |
| T231 | 注释 / 字样一并改的默认要不要出声 | `rename_symbols` | 未决 |
| T152 | 注释算不算引用 | `rename_symbols report_literals` | 未决 |
| T150 | `apply_refactor_plan` 的 `symbol_diff` 读数不一致 | `src/application/refactor/pipeline/refactor_plan.ts` | 待查 |
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

## 四、证与探针

| 编号 | 待办 | 在哪 | 状态 |
|---|---|---|---|
| T332 | 证夹具没跟上设计侧搬家（`run82` 取不到 DSL） | `certs/` · `.agent-io/design/` | 未修（`run82.dsl.json` 不存在） |
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
