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

### 批次 0 · 止血 + 最小仪器

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 0.1 | `edit_code` **批量幂等** | 同一 `targets` 连跑两次 ⇒ 第二次全 `already_applied` + 文件 sha256 不变（今天会插两次 ⇒ 静默重复代码） | 写 | 🔄 |
| 0.2 | `npm run verify:clean`：干净数据目录 + 无 `cache.db`/`design-db/`/`COGNITION.txt` 逐门报「红/绿/unsupported + 缺什么」 | 一条命令复现 CI 的红 | 写 | ⏳ |

### 批次 1 · 收逻辑写口（12 → 1）

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 1.1 | 写口 ③–⑥：`import_project`(先定性) · `sync_contracts` · `opl` · `arch_layer` | 每入口定性（收/非写端/必须独立+理由） | 写 | ⏳ |
| 1.2 | 写口 ⑦–⑩：`check_monolith` · `overview` · `derive_anim_flow` · `derive_algorithm`+`derive_chain` | 同上 | 写 | ⏳ |
| 1.3 | 写口 ⑪ `observe reconcile`；收编 `openPlansForRead`（第 3 套开库口径） | `openTasksDbForRead` 成唯一读口 | 写 | ⏳ |

### 批次 2 · 工具面收束（44 → 16）

| # | 任务 | 判据 | 派法 | 状态 |
|---|---|---|---|---|
| 2.1 | 删 6：`diff_views` `contract_page` `annotate_functions` `diagnose_loop` `go_originals` `first_hop_args`+`next_hop_args` | 每个"原场景谁接住"具体到 query/action；wire 下降；`承诺−契约` 差集仍空 | 写 | ⏳ |
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
判据总数        **473 条** 0 红      ← 掉了 = 被 decision.update 全量覆盖
测试            **59 文件 / 273 用例**
待收写口        12 → **9**（①design_intent ✓ ②archive ✓ ⑫serve 实为误判）
全量 verify     **383 s**  ｜ 增量 **4.8 s**（82×）
CI              **从 10-27 起每次 failure**（archify 死步骤 + 数据不在 git）
备份            `C:\agentio-backup\dotgit-20261102-1540`（57.3 MB，**已验证可恢复** 2010=2010）
远端            origin/main = 本地 HEAD（410 提交已推）
```
