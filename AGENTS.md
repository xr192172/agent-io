# AGENTS.md — 开发动作 → 必用工具

> 由 `scripts/gen_agents.mjs` 从 `TRIGGER_ROWS` + 本文件模板生成。改映射改源头，不手改产物。
> `npm run build` / pre-commit 会重建；`node scripts/gen_agents.mjs --check` 只比对。

## 零、开发纪律（必读 · 违反必回退）

> 本节是**硬纪律**，全部来自实测翻车，不是道理。详细论证：
> `docs/METHOD.md`（六条判据）· `docs/METHOD-DEBUG-BY-SAMPLING.md`（抽查处 → 结构化重写）·
> `docs/FACTS-VS-DESIGN.md`（两层事实 + 事实册↔设计册同构）· `docs/ONE-AUTHORITY.md`（一处权威）。
> 正文源文件：`AGENTS-RULES.md`（本节的唯一住处，生成器自动包含）。

### 0.1 改代码一律走设计线（**不许 `write` 直接改 `src/`**）

```
edit_dsl（给节点写判据）→ design_line action=plan（四条判据全过才冻结）
  → edit_dsl claim（领卡）→ edit_code（落盘：模糊级联 + 语法门 + 原子性）
  → design_line action=judge（框架自验）→ edit_dsl complete（带 evidence）
```

- `evidence` 必须含 `command` + `observed`：**写不出读数就收不了口**；
- 卡已是 `done` 又要改新目标：直接 `claim`（带 `data.reason`），**别再 `publish`**（会被拒）；
- 这条线**实际挡下过**：判据强度不足、语法错（模板字符串里的反引号）、原子性半落盘、`unsupported` 双向拦。

### 0.2 判据的三条硬要求

1. **必须当场可判**：`unsupported` 会**双向拦**（`claim` 与 `complete` 都拒）⇒
   先用 `symbol-exists` 把代码写进去，再把判据升级为 `behavior-cases` / `call-exists`。
2. **强度要够**：`source-has` 属存在类，**永远发现不了逻辑错**（计划闸会点名）。
   能写 `behavior-cases`（给输入比输出）/ `call-exists` / `cert`（跑证）就别用 `source-has`。
3. **改判据后必须全量重生成设计 DB：`npm run design:gen-db`**（或 `design_line action=gen-db` **不带 `feature`**），
   否则 `npm run verify` 的「设计 DB 结构」会红。
   ★ **要全量，理由在读数里**：带 `feature` 只重生成那一个切片的投影，`//source` 与「持有者列表」对不上
   ⇒ `npm run verify` 的同一道门实测报 **陈旧 361 / 缺 2 / 多 159**（2026-10-30 撞到）；全量 = `features=3 / files=746`。

### 0.3 计划（画布）三个坑

- **画布改完即过期**（`symbols_at_freeze` 的 body_hash 变了）⇒ 每轮改完**重新**
  `design_line action=plan --apply:true`，否则下一次 `edit_code` 被拒；
- `plan.card` 要填**任务卡 id**（节点 id 形态），不是 `T-#XXX` 标签；`untouched_default` 是 **boolean**；
- 计划闸不认 `cert:` 引用（判「解不出来」）⇒ 只能靠证判的改动才用迁移开关 `AGENT_IO_REQUIRE_PLAN=0`。

### 0.4 调试方法：**读代码 > 任何统计**

- 先读 2 行错代码（tsc 报错自带行列），再考虑任何读数；
- 量具只用于**事后确认**与**护栏**，**不用来选活**；
- 判据必须用**已知答案**验收 —— 「能数出来」≠「数得对」；
- **脚本 `String.replace` 是静默 no-op**（锚点不符就什么都不做）⇒ 改完必须**看产物或看数字**。

### 0.5 验收：双棘轮 + 已知答案

```
AGENT_IO_REPLAY_ONLY=1 AGENT_IO_TSC_FIX=1 → 全仓 5~8 秒
要求：errors 不升 **且** holes（TODO 空孔）不升
t453 守双棘轮 · t454 守双实现分叉账
```

★ 错误数**暴跌**可能是"函数体退化成空孔"（实测 431→22 是丢了 409 个体）⇒ 永远两个数一起看。

### 0.6 事实分两层（别混）

- **语法层**：tree-sitter，51 语言，**永远可用** ⇒ 翻译前端必须留在这里（要翻的代码常常编译不过）；
- **语义层**：`go/packages` / tsc `Checker`，给绑定、字段选择、类型 ⇒ 只做事实上游；
- 语义层失败 ⇒ 标 `syntax-only`、判据转 `unsupported`，**不许假装精确**。

### 0.7 三条会自动咬人的小事

- `docs/*` 在 `.gitignore` 里 ⇒ 新增文档要 `git add -f`；
- `design_intent.goals` 是**全量替换** ⇒ 一律「读旧 → 合并 → 写全量」，只写增量会**冲掉历史意图**；
- **模板字符串里禁止裸反引号**（`schema.ts` 的 SQL 注释与 `gen_agents.mjs` 的模板都踩过）⇒
  长文本一律放独立 `.md` 由生成器 include，不塞进模板字面量。

### 0.8 重生成翻译产物：**只有一条命令**

```bash
node scripts/regen-translate.mjs          # = npm run regen:translate
```

- 它自己生成（`projectDir` + `outDir` + **`fill:true`** 是唯一能写出**带函数体**产物的路径；
  单文件 `out` 模式会被骨架验证闸拦、不落盘）、
  自己读数（files / holes / errors）、**变差就非零退出**、读数落 `.agent-io/regen-report.json`；
- ★★ **`fill:true` 不是可选项**：`project.ts` 里 **mechBody + 填空缓存**整块都在 `if (opts.fill)` 内。
  不传 ⇒ 那条确定性回放完全不执行 ⇒ 产物全是 TODO 孔（实测：不传 = 617 孔/48 错；传 = **164 孔/22 错**）。
  回放模式（`AGENT_IO_REPLAY_ONLY=1`）下 LLM 部分会被优雅跳过，只做 mechBody + 缓存回放；
- **产物目录不在 git 里** ⇒ 覆盖即不可回滚。脚本先写**同盘临时目录**、再把旧目录改成 `src.bak-<ts>` 备份 ⇒ 手工可回滚
  （2026-10-30 就是因为"猜着跑、无备份"把 188 孔基线毁成 617 且不可恢复）；
- **绝不要**用 `npm run tool -- translate --json ...` 手工拼参数去覆盖产物目录（我踩过两次）。


### 0.9 三条规范（决定"该不该做"时先过这三条）

1. **一处权威**：同一件事只许有一个住处（字段 / 表 / 常量 / 文档 / 脚本）。
   发现第二处 ⇒ **先删第二处**，再谈功能。
   判据：同一事实在两处出现，且改一处不改另一处仍"看起来正常" ⇒ 已违规。
2. **不许补丁式加功能**：加之前先问"这是**新能力**，还是**旧能力没做对**"。若是后者 ⇒ 改旧的，不加新的。
   判据：新代码的存在理由是"让旧代码别出错" ⇒ 它是补丁。
3. **不许补丁式修复**：修之前先问"这东西**该不该存在**"。若新加的东西是为了让旧东西别撒谎 ⇒ **删旧的**。
   判据：同一条路径上出现第 3 层（A 加护栏 → 给护栏再加护栏 → …）⇒ 回退到第 1 层重新判断。

### 0.10 写作规范：写**规则**，不写**故事**

三个载体分工，写错地方等于制造噪音：

| 载体 | 只写 | 不写 |
|---|---|---|
| **代码注释** | **不变量**：什么条件会坏、为什么必须这样 | "谁在什么时候因为什么事裁定" |
| `docs/RETIRED.md` / commit message | 来龙去脉、决策历史、**代价** | — |
| 本文件（`AGENTS-RULES.md`） | 规则本身，每条**可判真假** | 举例式的叙述、口头禅 |

**自查问句**（每写一句就问一次）：
> 把这句话**单独拿出来**给一个没有上下文的 agent 看，它能照着**判对错**吗？

不能 ⇒ 它是故事不是规则：把结论提炼成一句可判的话，把过程搬去 `RETIRED.md` / commit。

## 一、动作 → 工具

| 开发动作                                     | 必用工具                                                    | 说明                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 不确定用哪个工具                             | `capability_map`                                            | 能力线 × 线内工具 × 何时用；`lane=<线>` 只看一条                                                                                                                                                                                                             |
| 开工前看 / 改设计侧                          | `get_dsl` / `edit_dsl`                                      | 读、写、导出（mindmap / svg / markdown）设计侧                                                                                                                                                                                                               |
| 读设计链 / 重生成设计 DB                     | `design_line`                                               | `action=report` / `diff` / `rewrite`（只拉签名）/ `gen-db`                                                                                                                                                                                                   |
| 记录目标 / 方向 / 边级意图                   | `design_intent action=set`                                  | 写 goals + edge_intents，落进 base 的 `meta.goals` / `edge.intent`                                                                                                                                                                                           |
| 日常维护（补节点 / 改描述 / 加标注）         | `edit_dsl weight=routine`                                   | 跳过 L4 证据回溯，仍留 L1–L3；改架构 / 契约用缺省 `normal`                                                                                                                                                                                                  |
| 改模块级符号名（单条或批量）                 | `rename_symbols`（`scope=module`）                          | 自动定根 + 闭包 + 跨语言；先 `dry_run`                                                                                                                                                                                                                       |
| 改文件内局部变量 / 形参                      | `rename_symbols scope=local`                                | 作用域隔离；逐项独立，跳过项逐条可见                                                                                                                                                                                                                         |
| 改对外契约名 / MCP 工具名                    | `rename_symbols report_literals=true`                       | 扫旧名 snake 变体字面量，按 kind 分治；契约变更才跟文档                                                                                                                                                                                                      |
| 改文件名并联动全仓 import（单条或批量）      | `rename_files`                                              | 整体先 `dry_run`，全部可落盘才落                                                                                                                                                                                                                             |
| 整块搬一个域到新位置                         | `move_domain`                                               | 先改 `structure.domains.json` 的 `dir`，再一次搬完全部源码 + 改写 import；搬什么由 `structure_gap` 判                                                                                                                                                        |
| 把一个模块级符号搬到别的文件（文件不变）     | `move_symbol`                                               | 搬的是**符号**不是文件（与 `move_domain` 不同生态位）：自动把「仅引入该符号」的 importer 目标改到 `to_file`；v1 只 TS/JS，撞名 / namespace / `export *` 一律整体不动                                                                                         |
| 看已记录的调用链 / 查运行时事件 / 判一批事件 | `observe`（`action=trace` / `log` / `judge`）               | 只读三合一（2026-10-28 合并）：`trace` 重建调用树排查「走了哪条链」，`log` 查 events.jsonl，`judge` 逐事件偏差判定（可带 `decls` 做链路契约）。插桩/还原/台账用 `action=instrument/uninstrument/restore/ledger`，提案四层门用 `action=proposals`（`op=…`）  |
| 建议 / 消歧易混名                            | `rename_symbols analyze=similar|suggest`                    | 前者给短名/无意义局部变量出建议（带理由），后者找孪生名（大小写 / 数字后缀 / 换位 typo）并按连通块聚类给 basis                                                                                                                                               |
| 读项目文档（没有文档就写）                   | `explore_code action=docs`                                  | 不带 `name` 返清单（供挑）；带 `name` 返全文；带 `targets` 返命中该目标集的文档正文                                                                                                                                                                          |
| 配 LLM 供应商 / Key 池 / 看用量              | `gateway_provider`                                          | 单入口（原 `gateway_*` 4 个收敛成 1）；★ Key 的**家在这里**（`gateway.json`），环境变量只是导入源                                                                                                                                                           |
| 决定在哪打观测点（不做全量插桩）             | `recommend_observe_points` → `observe action=instrument`   | 用索引/图 + AST 算「该在哪打日志」：高入度 / 最近真改 / 副作用边界 / 静默吞错 / 复杂度高地 / 文件热点；清单落 `.agent-io/observe-points.json` ⇒ 再 `observe action=instrument contract_from_points=true` **只插这些点**（推荐器与插桩器同源同命名，不漂移） |
| 重构后让 LLM 判一轮（拿不定的上抛给人）      | `refactor_judge`                                            | 逐条裁 adopt / reject / uncertain（带置信度 + 理由）；uncertain 经 `alert_inbox` 入箱，下一次工具响应自动附带                                                                                                                                                |
| 重算翻译册（Go→TS 全量符号账）              | `translate book=true`                                       | 从事实库重算 `.agent-io/design/<f>.translate.json`（pending / blocked / judgments / external_deps 一次算清）；人写的 types / atoms / unknowns 原样保留。★ 2026-10-28 吸收 `translate_book`（它是本工具的第一步：没册子就没有骨架/填孔/对拍）                |
| 改一段代码（函数体 / range）                 | `edit_code`                                                 | 按符号 / 行号 / range 定位；走写闸 + 重建索引                                                                                                                                                                                                                |
| 批量串替换（先算清单 → 再落盘）             | `apply_refactor_plan`                                       | 单一入口两种形态：给 `targets` ⇒ **只算清单**（只读：plan id + 命中级别 + diff）；给回执里的 `plan` ⇒ **落盘**（幂等，plan_id 指纹不符即报错）。★ 2026-10-28 合并 `plan_refactor`                                                                         |
| 回滚代码改动                                 | `snapshot action=rollback`                                  | 落盘前自动存快照；回滚立即写盘、不回滚本身、不可再撤回                                                                                                                                                                                                       |
| 理解代码 / 结构                              | `explore_code`                                              | 只读：语义搜索、分层、拆分建议、数据流                                                                                                                                                                                                                       |
| 清理无效 import                              | `remove_dead_imports`                                       | 删 dead_deps                                                                                                                                                                                                                                                 |
| 废弃 / 下线一个自研模块                      | `deprecate_offline`                                         | 判据：自研 + 无活跃消费（编译级验收，回归回滚）；缺省 `dry_run`，落盘给 `dry_run:false`，物理删再加 `remove_file:true`                                                                                                                                       |
| 补 / 维护函数语义注释                        | `annotate_functions`                                        | `mode=scan/dry_run/apply`；`@fnhash` 随 body 变而过期                                                                                                                                                                                                        |
| 搭功能主链 / 沿线看流程                      | `observe action=line`                                       | 每功能挑入口沿调用边走成主链；`target` 留空返全功能总览                                                                                                                                                                                                      |
| 改设计意图(why)                              | `design_intent action=set`                                  | 直接写 overlay（goals + edge_intents）并 apply 回 base。★ **`action=propose` 已退役**（2026-10-22 删分支，此前调它会**被当成 set 直接写盘**）⇒ 现在**响亮报错零副作用**；要「先请人批再落」走 `observe action=proposals`                                   |
| 看待确认的 observe 提案                      | `observe action=proposals`（`op=list/show/approve/reject`） | ★ 提案的唯一产者是 `run_loop`（累犯波及模式）；approve 过四层门（规则 / LLM 复核 / 覆盖 / 定稿），任一层不过即 `frozen`（DSL 不动）；`use_llm` 缺省 false                                                                                                   |
| 查谁引用 / 调用了 X                          | `find_references`                                           | 只读；`mode=field` 报字段读取与构造点                                                                                                                                                                                                                        |
| 加字段 / 改签名前查波及面                    | `find_references mode=type`                                 | 读 / 构 / 解 / 声明四类 AST + 行内上下文                                                                                                                                                                                                                     |
| 跑测试 / 回归                                | `run_tests`                                                 | 结构化失败定位；`filter` 定向或全量                                                                                                                                                                                                                          |
| 改完看设计是否过时 / 欠实现                  | `design_line action=drift`                                  | 对比 expected_apis 与真实代码，四态含 `no_comparison`（没得比≠对齐）；`drift_mode=status` 复读台账。★ 2026-10-28 吸收 `detect_drift`                                                                                                                       |
| 常驻盯漂移                                   | `explore_code action=watch drift_on_change=true`            | 文件一变即 rebuild + 过时判定 + pushAlert                                                                                                                                                                                                                    |
| 提交前健康检查                               | `design_line action=judge` / `sync_contracts`               | 跑整册判据批（四态：unsupported=判不了≠通过）+ 契约同步。★ 2026-10-28 吸收 `consistency_check`（其对账报表已被判据覆盖）                                                                                                                                   |
| 改前看影响面                                 | `explore_code action=impact`                                | 反向可达闭包 + 风险排序（`hubs=true` 切热区盘点）。★ 2026-10-28 吸收 `impact_analysis`；★ 写闸**自动**附带波及仍待做（T-#GATE-IMPACT）                                                                                                                     |
| 对账设计视图 / 实际视图                      | `diff_views` / `reconcile_chain`                            | 波及方向                                                                                                                                                                                                                                                     |
| 两仓合并 / 迁移查撞名                        | `cross_repo_symbol_index`                                   | 顶层符号求交 = 冲突，求差 = 迁移范围                                                                                                                                                                                                                         |
| 跨语言翻译（骨架 / 填孔 / 对拍）             | `translate`（`from`/`to`）                                  | ★ 语言对是**数据**：`from`/`to` 查 `TRANSLATE_PAIRS`（目前仅 `go-ts`）；不支持的对报错并列出已注册对。机械骨架 + 验证闸；`fill` 逐孔填函数体；`verify` 行为对拍；`book=true` 重算翻译册                                                                     |
| 改完函数验证行为                             | `edit_dsl`（decision expectation `behavior-cases`）         | 行为基线已并入判据生态（I2b）：期望输出写在 behavior-cases 判据里（同一执行核 runHarness），不再用 capture/verify 快照工具                                                                                                                                   |
| 项目体检                                     | `code_health`                                               | 死代码 / 圈复杂度 / 分层违规 → 健康分 + 清单                                                                                                                                                                                                                |
| 查语言支持度 / 缺口                          | `capability_audit`                                          | 语言 × 功能的 AST 覆盖缺口（只读）；与 `capability_map`（工具导航）不同                                                                                                                                                                                      |
| 查工具使用 / 死工具 / 过期记录               | `npm run dogfood:coverage`（脚本）                          | ★ 2026-10-28 从 `tool_usage` 迁出：烟测覆盖读数（死工具 / 过期记录）属开发期审计，不该占 MCP 工具位；口径未变（默认排除 via=sweep|gate）                                                                                                                    |
| 升级语言 / 工具链版本                        | `upgrade`                                                   | `scan` 只读报契约差（可选 `gate` / `dynamic`）；`apply` = 串替换 → 基线提交 → 验证 → 失败回退（需 git）                                                                                                                                                   |
| 一次修复沉淀成规则                           | `rules action=export/apply/check`                           | export 过出生回归 / 反例 / 幂等三关才落盘；apply 三态 `applied` / `todo` / `clean`（缺省 dry-run）；check 只在新命中上 fail                                                                                                                                  |
| 症状 → 根因 → 修复                         | `diagnose` / `diagnose_loop`                                | `diagnose_loop` 缺省 `apply=false`，不提交 git                                                                                                                                                                                                               |

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
- **工具面收敛原则**：同一生态位出现更高级工具 ⇒ **吸收旧的**，全方面只留一个，最终吸收进设计侧（判据/DSL）——被吸收的工具拆注册不拆执行核，行为场景改用判据表达（例：`behavior_baseline` 已并入 `behavior-cases` 判据生态）
- 门 / 判据 / 读数四态的规矩只住 `docs/GUIDE-GATE.md`，本文件不复述

## 五、交付

- 做完一项 ⇒ 写回执（commit message + `.workbuddy/memory/YYYY-MM-DD.md`）+ 从 `docs/todo.md` 删掉那一行；清单清空即删文件
- **新增功能 ⇒ 在 `docs/PITCH.md` 追加一条卖点**（每条必须挂一张证 + 一个可复现读数；有边界就如实写 `[未核]`）——这份活文档就是收官材料，别等最后凭记忆补
- **退役任何能力（工具 / 文件 / 链路 / action）⇒ 在 `docs/RETIRED.md` 记一条**：判据 + 现在用什么 + 代价；★ 退役要连 **enum / 描述 / AGENTS 触发行** 一起改，否则"退役"会变成"改语义"
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
