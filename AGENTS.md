# AGENTS.md — 开发动作 → 必用工具

> 由 `scripts/gen_agents.mjs` 从 `TRIGGER_ROWS` + 本文件模板生成。改映射改源头，不手改产物。
> `npm run build` / pre-commit 会重建；`node scripts/gen_agents.mjs --check` 只比对。

## 一、动作 → 工具

| 开发动作                                | 必用工具                                         | 说明                                                                                                                            |
| --------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 不确定用哪个工具                        | `capability_map`                                 | 能力线 × 线内工具 × 何时用；`lane=<线>` 只看一条                                                                                |
| 开工前看 / 改设计侧                     | `get_dsl` / `edit_dsl` / `render_design`         | 读、写、导出（mindmap / svg / markdown）设计侧                                                                                  |
| 读设计链 / 重生成设计 DB                | `design_line`                                    | `action=report` / `diff` / `rewrite`（只拉签名）/ `gen-db`                                                                      |
| 记录目标 / 方向 / 边级意图              | `design_intent action=set`                       | 写 goals + edge_intents，落进 base 的 `meta.goals` / `edge.intent`                                                              |
| 日常维护（补节点 / 改描述 / 加标注）    | `edit_dsl weight=routine`                        | 跳过 L4 证据回溯，仍留 L1–L3；改架构 / 契约用缺省 `normal`                                                                     |
| 改模块级符号名（单条或批量）            | `rename_symbols`（`scope=module`）               | 自动定根 + 闭包 + 跨语言；先 `dry_run`                                                                                          |
| 改文件内局部变量 / 形参                 | `rename_symbols scope=local`                     | 作用域隔离；逐项独立，跳过项逐条可见                                                                                            |
| 改对外契约名 / MCP 工具名               | `rename_symbols report_literals=true`            | 扫旧名 snake 变体字面量，按 kind 分治；契约变更才跟文档                                                                         |
| 改文件名并联动全仓 import（单条或批量） | `rename_files`                                   | 整体先 `dry_run`，全部可落盘才落                                                                                                |
| 整块搬一个域到新位置                    | `move_domain`                                    | 先改 `structure.domains.json` 的 `dir`，再一次搬完全部源码 + 改写 import；搬什么由 `structure_gap` 判                           |
| 改一段代码（函数体 / range）            | `edit_code`                                      | 按符号 / 行号 / range 定位；走写闸 + 重建索引                                                                                   |
| 批量串替换先算清单                      | `plan_refactor` → `apply_refactor_plan`         | 清单含 plan id + 命中级别 + diff；apply 幂等，指纹不符即报错                                                                    |
| 回滚代码改动                            | `snapshot action=rollback`                       | 落盘前自动存快照；回滚立即写盘、不回滚本身、不可再撤回                                                                          |
| 理解代码 / 结构                         | `explore_code`                                   | 只读：语义搜索、分层、拆分建议、数据流                                                                                          |
| 清理无效 import                         | `remove_dead_imports`                            | 删 dead_deps                                                                                                                    |
| 废弃 / 下线一个自研模块                 | `deprecate_offline`                              | 判据：自研 + 无活跃消费（编译级验收，回归回滚）；缺省 `dry_run`，落盘给 `dry_run:false`，物理删再加 `remove_file:true`          |
| 补 / 维护函数语义注释                   | `annotate_functions`                             | `mode=scan/dry_run/apply`；`@fnhash` 随 body 变而过期                                                                           |
| 搭功能主链 / 沿线看流程                 | `feature_line`                                   | 每功能挑入口沿调用边走成主链；`target` 留空返全功能总览                                                                         |
| 改设计意图(why)前先提 PR                | `design_intent action=propose`                   | 只算 intent diff 不写盘；接手方 `review_changes approve` 后才写 DSL                                                             |
| 接手时先看待确认提案                    | `review_changes action=list`                     | 确认人是下一个接手的 Agent；list / show / comment / approve / reject；必须署名，不许自批                                        |
| 看待确认的 observe 提案                 | `observe_proposals action=list`                  | 同 `review_changes`；approve 过四层门（规则 / LLM 复核 / 覆盖 / 定稿），任一层不过即 `frozen`（DSL 不动）；`use_llm` 缺省 false |
| 查谁引用 / 调用了 X                     | `find_references`                                | 只读；`mode=field` 报字段读取与构造点                                                                                           |
| 加字段 / 改签名前查波及面               | `find_references mode=type`                      | 读 / 构 / 解 / 声明四类 AST + 行内上下文                                                                                        |
| 跑测试 / 回归                           | `run_tests`                                      | 结构化失败定位；`filter` 定向或全量                                                                                             |
| 改完看设计是否过时 / 欠实现             | `detect_drift`                                   | 代码变更 → DSL 需同步；`mode=status` 复读台账                                                                                  |
| 常驻盯漂移                              | `explore_code action=watch drift_on_change=true` | 文件一变即 rebuild + 过时判定 + pushAlert                                                                                       |
| 提交前健康检查                          | `consistency_check` / `sync_contracts`           | 契约与一致性                                                                                                                    |
| 改前看影响面                            | `impact_analysis hubs=true`                      | 反向可达闭包 + 风险排序                                                                                                         |
| 对账设计视图 / 实际视图                 | `diff_views` / `reconcile_chain`                 | 波及方向                                                                                                                        |
| 两仓合并 / 迁移查撞名                   | `cross_repo_symbol_index`                        | 顶层符号求交 = 冲突，求差 = 迁移范围                                                                                            |
| Go → TS 翻译                           | `translate_go_ts`                                | 机械骨架 + 验证闸；`fill` 逐孔填函数体；`verify` 行为对拍                                                                       |
| 改完函数验证行为                        | `behavior_baseline`                              | `capture` 存快照，改后 `verify` 对比                                                                                            |
| 项目体检                                | `code_health`                                    | 死代码 / 圈复杂度 / 分层违规 → 健康分 + 清单                                                                                   |
| 查语言支持度 / 缺口                     | `capability_audit`                               | 语言 × 功能的 AST 覆盖缺口（只读）；与 `capability_map`（工具导航）不同                                                         |
| 查工具使用 / 死工具 / 过期记录          | `tool_usage`                                     | 只读：使用与覆盖读数、注册了没被用、用过但已不在注册表                                                                          |
| 升级语言 / 工具链版本                   | `upgrade`                                        | `scan` 只读报契约差（可选 `gate` / `dynamic`）；`apply` = 串替换 → 基线提交 → 验证 → 失败回退（需 git）                      |
| 一次修复沉淀成规则                      | `rules action=export/apply/check`                | export 过出生回归 / 反例 / 幂等三关才落盘；apply 三态 `applied` / `todo` / `clean`（缺省 dry-run）；check 只在新命中上 fail     |
| 症状 → 根因 → 修复                    | `diagnose` / `diagnose_loop`                     | `diagnose_loop` 缺省 `apply=false`，不提交 git                                                                                  |

## 二、改名

一律走 `rename_symbols` / `rename_files`，不用 grep + 正则手改。

1. `dry_run:true` 先看结构化 diff（每文件 `ops[{old,new}]`）
2. diff 对得上再落盘
3. 文件名 = 符号名时，条目加 `rename_file_if_matching:true`
4. 局部名走 `rename_symbols scope=local`，不手改

例外：非 TS/JS/Go/Python 文件，且工具不支持时。

## 三、写代码前后

| 时点 | 做什么 |
|---|---|
| 改了 `src/`，调工具前 | `npm run build` —— 工具跑 `dist/`，不 build 就是旧逻辑 |
| 并行作业 | 不许并行 `npm run build`（共写 `dist/`）；验证可写库外 loader 直跑 `src/`，用完清探针产物 |
| 提交前 | `npm run verify`（门清单见 `docs/GUIDE-GATE.md`） |
| 改完只想跑受影响的证 | `npm run verify:changed` —— **增量入口**（按改动集挑证 + 契约；★ 它不是闸，是内环） |
| 想查陈旧租约 / 漏收口 | `npm run patrol` —— **只报告不改 state**（TTL 到期、claimed 超期、missed_close） |
| 调工具前查入参 | `npm run tool -- <工具名> --schema` |

## 四、判据与数据

- 判语法结构走 AST（`ts_kernel`）；正则只用于「文本形状本身就是答案」的场合，并在注释写明为什么
- 能现取（AST / 运行时数据 / 结构化 API）就不落第二份；必须留的进 `stage_registry.STAGES`，带 `owner` / `inputs` / `fresh` / `produce`，且只留一处
- 不新造字段 / 表：先挂进已有载体（`cache.db` / `B_TERMS` / `chain_wiring`）
- 不加新门：不写拦截脚本、对账判据、棘轮 / 基线 / 豁免清单；脚本只提示不产出 ⇒ 删
- 门 / 判据 / 读数四态的规矩只住 `docs/GUIDE-GATE.md`，本文件不复述

## 五、交付

- 做完一项 ⇒ 写回执（commit message + `.workbuddy/memory/YYYY-MM-DD.md`）+ 从 `docs/todo.md` 删掉那一行；清单清空即删文件
- 契约变更（工具名 / 签名 / 对外行为 / MCP 注册名）⇒ 同步 `README.md` / `README.en.md` / 本表；实现变更不碰文档
- 新增代码 / 注释 / 文档不出现旧品牌串：`design-canvas` / `DESIGN_CANVAS` / `design_canvas` / `DesignCanvas`
- 旧品牌串现查：`grep -rn "design-canvas\|DesignCanvas" src/ docs/`

## 六、派子代理

| 环节 | 派法 |
|---|---|
| 大范围侦察 / 波及面量化 / 长尾静默失效 | 派；互不重叠则并行投 |
| 独立核验 | 派，且不给它看结论，让它从源码自己清点 |
| 单文件小改 / 需连续上下文的设计决策 / 会写共享产物 | 不派 |

- 派活先写判据，要求「先回报再动手」；回报含「核了什么、读数是什么」
- 关键结论换一种口径再数一遍，回到原始数据复核

## 七、文档

| 文件 | 是什么 |
|---|---|
| `docs/INDEX.md` | 唯一入口：目录 / 工具 / 状态 / 未完成 |
| `docs/GUIDE-GATE.md` | 门、证、判据、写门规矩 |
| `CONTRIBUTING.md` | 加 / 删工具要动哪几处 |
| `README.md` / `README.en.md` | 项目是什么 + 怎么跑 |
