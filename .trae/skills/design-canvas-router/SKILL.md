---
name: "design-canvas-router"
description: "design-canvas 渐进披露路由。遇到『画图/看代码/重构/对账/查真跑/自查/出图』一类诉求时，先按本 skill 分层定位『该调哪个工具、别造新工具』。与 design-canvas-mind（心智外衣）配合：mind 讲方法论，router 讲『这个问题 → 哪只手』。"
---

# design-canvas 路由 / 渐进披露

拿到一个愿望或一句含糊问题，先跑这套**分层路由**：逐层缩小，直到落到该调的那个工具。**没把握时就先查，不猜，更不为小愿望手写新工具。**

判断顺序固定为「先粗后细」——每一层都问一句，答不上再下一层。

## 第零层：先认「三个层」—— **同一个"DSL"其实是三样东西**

★ 最常见的心智错误：以为"DSL"是**一个**文件。所以先在脑子里分清层，再去选工具。
（★ 2026-10-08 实测：这条心智此前**只住在 `src/infrastructure/storage_overlay.ts` 的注释里** ——
README / 本 router / mind 都**没写过一次** ⇒ **谁都不会想到"有三个"**。现在写在这里。）

| 层 | 是什么 | 会不会被重新生成 | 你什么时候碰它 |
|---|---|---|---|
| ① **实际视图 live** | 扫描**真实代码**得到的快照，**只读** | ✅ **每次扫描重建** | 问"代码现在长什么样" |
| ② **base 设计 DSL** | 设计主体：文件 / 节点 / 边 / 职责 | ✅ **可再生成**（从实际派生，或手写） | 改结构、改职责、出图 |
| ③ **overlay 设计意图层** | **人写的决策**：goals / edge_intents / 决策卡（含**验收**） | ❌ **独立保留，不被 base 重生成覆盖** | 写 why、定边界、留决策与验收 |
| 另 · **archive 下线库** | 下线节点 + **完整 DSL 快照（含决策卡）** | ❌ 只增 | 查"当年为什么这么设计 / 为什么下线" |

★ **为什么必须分开**：② 会被重新生成 ⇒ **人的决策不能住在 ②** ⇒ 才有 ③。
★ 由此得到一条操作纪律：**"为什么"写 ③（`design_intent`）；"是什么"改 ②（`edit_dsl`）。**
★ `archive` 的 `action=node` **不可逆**（立即落盘、**没有 dry_run 预览**）——别当预览用。

## 第一层：这是哪类诉求？

| 你手里的愿望（听关键词） | 该去哪个出口 | 走人 |
|---|---|---|
| 要把结构/数据画成图给人类看（设计图/思维导图/架构图/流程） | **画图** | 见第二层 · A |
| 要理解一份已有代码/工程（依赖、影响面、怎么拆、算法怎么流） | **代码理解** | 见第二层 · B |
| 要从设计图生成代码 / 让实现状态回填设计 / 对比契约是否一致 | **生成/回填/一致性** | 见第二层 · C |
| 要做一次重构或改名，想安全落地不死人 | **重构防线** | 见第二层 · D |
| 要看代码『真跑起来』的行为，或用埋点对账实际 vs 设计 | **插桩/摄像头** | 见第二层 · E |
| 想知道这套工具本身多语言支持到哪、还差哪些 | **能力矩阵** | `npm run capability` / `npm run doctor` |

## 第二层：落到工具

### A · 画图 / 活文档
- 原始诉求是「建底 / 出图 / 全项目对账」→ `import_project` → `render_design` → `reconcile_effects`
- 只是「改一版图 / 查当前图」→ `get_dsl`（读）+ `edit_dsl`（写，批量操作，原子回滚）
- **要写"为什么"（目标 / 方向 / "A 为何依赖 B" / 边界归属）→ `design_intent`**（落到 ③ overlay）。
  ★ 改 why、改方向这类**该由人拍板**的变更走 `action=propose`（**只出 before/after 提案、不写盘**，
  人 approve 才落）；确定要改的直接 `action=set`。→ 见第零层那张表
- **要挂"决策卡"（结论/理由/替代/后果/验收）→ `edit_dsl`** 的 `op=update, type=node, data.decision`
  （旧版自动压进 `decision_history`）
- 新建/克隆/删一个 feature → `manage_feature`
- 想换输出格式（html/svg/markdown）→ `render_design format=…`
- 别手写渲染器/新布局脚本——编辑类动作都收进 `edit_dsl` 的 `operations[]`。

### B · 代码理解（全走 `explore_code`，用 `action` 分发）
| action | 当你想… |
|---|---|
| `import` | 把一份真实工程导入成 live 快照 |
| `semantic_search` | 用自然语言搜这块代码里"做了什么/在哪" |
| `diff_impact` | 改动会波及哪些文件/符号 |
| `arch_layer` | 看分层/架构 |
| `check_monolith` / `analyze_monolith` / `derive_split` | 混沌是坨屎山？哪些能拆、怎么拆 |
| `derive_detail_chain` / `derive_algorithm` | 把一条调用链/一段算法流程推导出来 |
| `inject_replay` / `run_simulation` / `reset_simulation` | 对流程做数据流仿真 |
| `watch` | 让 live 快照随代码变化自动更新 |

### C · 生成 / 回填 / 一致性 / 漂移
- 生成骨架 → `scaffold`
- 代码已实现，想回填 expected→actual 差异 → `scaffold`（action=backfill）
- 纯对比契约，不写盘 → `consistency_check`（只读）
- 想知道「设计 vs 代码**漂到哪了**」→ `detect_drift`（比 `consistency_check` 更偏"台账/增量"）
- ★ **这两个都只是"报告"**：实测注入真实漂移后会报 `❌缺失: 2`，但 **退出码仍是 0**
  ⇒ **它们是给人看的读数，不是判成败的门**。要判成败得自己按 `---DATA---` 里的计数下判据。

### D · 重构防线
- **改名优先走 `rename_*` 工具组**（别 grep+正则手改，那是归位失败）：
  - 改**一个**模块级符号 → `rename_symbols`（`scope=module`，`renames` 传单条；先 `dry_run=true` 看结构化 diff）
  - 批量改多个模块级符号 → `rename_symbols`（先整体 dry-run，全部可落盘才落盘）
  - ★ `rename_file_if_matching` **不是工具，是 `rename_symbols` 的一个参数**（`scope=module` 时 true=符号是文件主导出则联动改文件名）
  - 改文件名并联动全仓 import → `rename_files`；文件内局部变量/形参批量改名（作用域隔离）→ `rename_symbols scope=local`（`renames=[{file,symbol,to}]`；同名遮蔽时补 `decl_line`，逐项独立、跳过项逐条可见）
  - 改**对外契约名 / MCP 工具名**（如 `render_dsl`→`render_design`）→ 在 `rename_symbols` 加 **`report_literals=true`**：扫旧名 snake 变体在文本的字面量清单，按 `kind` 分治——`contract`(server_registry `name:`) 会破坏契约需人审、`history`(tool-convergence) 保留原貌、`docs`/`test`/`code` 决定是否同步。**契约变更才跟文档，实现变更不碰文档。**
  - 跨文件搬一个符号 → `move_symbol`；先算计划不落盘 → `plan_refactor` → `apply_refactor_plan`
- 安全重构/改名（自身带基线验证→落盘→重验→回滚）→ **`refactor_pipeline`**
  （★ `verify_refactor` / `submit_gate` / `contract_gate` **都不是工具名**——它们是 `infrastructure/` 下的**内部模块**，
  被 `refactor_pipeline` 调用；旧版本 skill 把它们当工具写，是**指错了路**）
- 提级/包改名（含别名清洗）→ **`refactor_pipeline` 的 `packageRename` 参数**（已 AST 作用域守卫，不会误扫局部变量）
- 重构后怀疑符号失配 → `extract_contracts`（提契约）→ `reconcile_effects`（动静对账）；
  工具契约与 DSL 期望对账 → `sync_contracts`
- 审重构提案 / 卡点裁决 → `refactor_judge`

### E · 插桩 / 摄像头
- 给代码动态插桩采集真实行为 → `observe_instrument`（TS/Go；实现住在 `src/infrastructure/analysis/observe/` 与 `observe-lang-go/`，**那两条是目录，不是工具名**）
- 用真跑事件对账实际 vs 设计 DSL → `reconcile_chain`（会自动前置、缓存跳过、诚实标 `not_run`）
- 审事件 / 判定偏差 → `observe_log`（按文件查运行日志）→ `observe_judge`（批量判定）
  ★ 旧版 skill 写的 `log_query` / `judge` **都不是工具名**（前者是 `infrastructure/` 里的模块，后者无此名）——已更正
- 还想不插桩就采行为 → `behavior_baseline`（行为基线捕获/比对）、`observe_trace`（读已录调用链）、`recommend_observe_points`（该埋哪儿）

## 第三层：都定位不到？→ 三连招

1. **先拼**：用上面已列工具即席编排能覆盖，就当场跑通，不固化。
2. **再查**：翻 `explore_code` 的 `action` 清单 / `get_dsl` 的 `query` 清单，看是不是已有参数化入口被我漏了。
3. **才造**：同一编排被**复用 ≥2 次**且是稳定流程，才来讨论固化成新工具。（一步步都会收到"先注入 mind → 先编排 → 才固化 → 诚实交付"的纪律约束。）

## 自查提示

- 我把『画图/看码/重构/对账』的诉求，落到**既有工具**了吗？（没落 = 还没定位完）
- ★ **我引用的这个名字，到底是"工具"、"参数"，还是"内部目录"？**（2026-10-08 修了一批把三者混写的指路：
  `verify_refactor`/`contract_gate`/`submit_gate`/`log_query` 其实是 `infrastructure/` 里的**模块名**，
  `rename_file_if_matching` 是**参数**，`rename_symbol`/`rename_file` 是真工具但**已改名**为 `rename_symbols`/`rename_files`。
  混写的代价：照着走会撞 `unknown tool`，**撞一次之后这份引导就不再被信**。）
  → 拿不准就用 `capability_map` 核一遍名字（它是从注册表派生的，**不会漂**）。
- 我为一次性小愿望写新工具/新脚本了吗？（写了 = 越界，回退）
- 无真数据时我伪造/降级冒充了吗？（伪造 = 违反诚实纪律）

> 方法论点这里够用了；每个愿望的『先注入活 DSL + 能力地图 → 先编排 → 才固化 → 诚实交付』完整纪律见 design-canvas-mind 心智外衣。