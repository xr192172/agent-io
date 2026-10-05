# [B] 契约术语表（**受控词表**）

> 权威定义在 **`src/domain/b_terms.ts`**（`B_TERMS` + `Touched`）。
> ★★ **本文件不是纯生成的**：生成器（`node scripts/measure_b_contract.mjs --glossary`）只产出
>   下面「## 术语表」那一节；**开头这几段与「三条读法 / 为什么要它」是手写的**（用户 2026-10-01 裁定）。
>   ⇒ **不要直接 `--glossary > docs/glossary.md`** —— 那会把上面几段**静默冲掉**
>   （2026-10-05 实测丢过一次：10703 → 8915 字节）。**安全重生成** = 只替换「## 术语表」那一节，
>   手写部分原样保留（`head -n <术语表前一行> 旧文件 > 新 && 生成器输出 >> 新`）。
> 生成器**直读源码 AST**（不依赖构建 ⇒ 不会读到陈旧 dist）。
>
> ## 三条读法（用户 2026-10-01 裁定）
> 1. **含义栏是规范性的**：「**从此以后**要求这个词是什么意思」，**不是对现状的描述**。
>    现状（42 个 [B] 实际怎么用）见 `docs/b-field-dictionary.md`（机器生成）。
> 2. `★` = **债**：现状与定义不符、或一个名字多种含义。**拆清之前不许再新增使用者**。
>    债务条数由生成器统计（棘轮：只许减不许增）。
> 3. ★★ **新写 [B] 时，字段名从这个表里选**。表里没有 ⇒ 要么加进来（并写含义），
>    要么它只服务你这一个 [B]（**私有字段，不进表** —— 实测私有字段占 80%）。
>
> ## 为什么要它
> 用户原话：「**制定一张术语表**，制定一张术语表之后，再去重构整个这些工具的逻辑。
> 因为以后也是要做的，这是**技术债**，你不还完的话，以后只会在这个地方**越兜越那个**。」
>
> 数据支撑（`docs/b-field-dictionary.md`）：42 个 [B] 的产物共 189 个字段名，
> **80% 只服务 1 个 [B]**；共用那批里又有 21 个是"同一个词指不同东西"
> （`files` 一个名字 **6 种类型**、`stats` **5 种**、`written` 是 `boolean` 与 `string[]` 混用）。
> ⇒ 想统一形态**只能新增语义唯一的字段**，不能复用/合并既有名字。

---

## 术语表（**规范定义**；生成：`node scripts/measure_b_contract.mjs --glossary`）

> ★ 含义栏是**"从此以后要求它是什么"**，不是现状；现状见 `docs/b-field-dictionary.md`。
> 覆盖范围：出现在 **≥2 个 [B]** 里的字段名（只服务 1 个 [B] 的私有字段不受约束 —— 实测占 80%）。
> ★★ **新写 [B] 时字段名从本表选**；表里没有 ⇒ 要么加进来（写含义），要么它是你这个 [B] 的私有字段。

**机检**：共用字段名 **42** 个 ｜ 表里有定义 **42** ｜ ★ 未定义 **0**

**债务**：`debt: true` **34** 条（棘轮：只许减不许增）。

### anchor —— 链的接口（下游能拿它当原料）

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `feature` | `string` | DSL 的 feature 名（活文档单元） |  |
| `project_dir` | `string` | 被分析/改动的**项目根**（一个仓库的根目录）；不是盒根、不是子目录 |  |
| `written_files` ★ | `string[]` | 被**写入/改动**的文件（仓库相对路径，`/` 分隔）。★ 只列「**本次操作对被操作对象产生的工作产物**」；★ **排除工具自有的状态/账本/索引目录**（如被分析项目内的 `.agent-io/**`）——那是工具的内部数据，不是工作产物；★ 写在 `<dataHome>`（工具数据主目录）下的 DSL/存档/导图 JSON **本就不是仓库相对** ⇒ 从来不给。 | **新词，尚无使用者；由 ④-b refactor 族起逐族采用** |
| `symbols` ★ | `string[]` | 涉及到的符号 `qualified_name` | **新词，尚无使用者；与旧 `symbol: string`（单个）并存期间禁止混用** |
| `nodes` ★ | `string[]` | 涉及到的 DSL 节点 id | **新词，尚无使用者；与旧 `node_id: string`（单个）并存期间禁止混用** |
| `file` | `string` | **通用单数定位器**：一个文件（仓库相对路径）。★ 产物侧的同一件事见 `Touched.file`（本次操作的那个对象所在的文件）；★ 与 `written_files`（**写过的**）/ `read_files`（**读过的**，已退役）同族但**不同义** —— 那两个各带加工语义。 |  |
| `node_id` ★ | `string` | **单个** DSL 节点 id；同一族的复数形式是 `nodes` | **新写 [B] 一律用 `nodes: string[]`** |
| `symbol` ★ | `string` | **单个**符号 `qualified_name`；同一族的复数形式是 `symbols` | **新写 [B] 一律用 `symbols: string[]`** |

### receipt —— 回执（人读）

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `message` | `string` | 一行人读摘要。★ 不是数据：下游禁止从它解析 |  |
| `limitations` | `string[]` | 本次调用**做不到什么**（诚实列，不留白） |  |
| `touched` | `Touched（本文件导出的接口；6 个字段全可选）` | **本次调用"动了什么"的统一小票**（T18）：跨 [B] 的**唯一收据**，供下游接链 | **新接 [B] 一律 `withTouched(r, touchedOf(input, r))`（单构造点）；★ **纯数据 / 纯计算 [B] 例外**（它们没有"本次动了什么"）** |
| `stats` | `Record<string, number>` | ★ **已退役**（2026-10-05）：全仓 [B] 已清零，**禁止再新增使用者** | **各领域改名为 `<领域>_stats`（如 `contract_stats` / `closure_stats` / `algorithm_stats`）** |
| `summary` ★ | `string` | 一段**人读**总结 | **★ 现状 `string` 与一个大对象混用 ⇒ 人读用 `message`/`summary: string`，对象改 `<领域>_summary`** |

### state —— 状态

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `ok` | `boolean` | 本次调用**是否成功完成**（领域失败也给 false，理由进 `blocked`） |  |
| `blocked` | `string[]` | 被**阻断**的逐条原因（未落盘时必填，不许空手失败） |  |
| `dry_run` | `boolean` | 本次是**预演**（未落盘） |  |
| `dryRun` ★ | `boolean` | 与 `dry_run` **同义** | **并入 `dry_run`（命名统一；全仓只用 `dry_run`）** |
| `skipped` ★ | `{ item: string; why: string }[]` | 被**有意跳过**的条目 + 原因 | **★ 现状 3 种形状（`{seeds,reason}[]` / `string[]` / `{path,why}[]`）⇒ 统一到定义的形状** |
| `incomplete` ★ | `{ item: string; kind: string; why: string }[]` | **未完成**的部分 + 原因 | **★ 现状 2 种形状（`brick_path` 版 / `dsl_path` 版）⇒ 统一到定义的形状** |
| `pending` ★ | `string[]` | **尚未处理**的条目 | **★ 现状 `number`（计数）与 `string[]`（列表）混用 ⇒ 统一为列表；计数另立 `*_count`** |
| `error` | `string | undefined` | 失败原因（**人话**，给人 / LLM 读；**不是**异常对象） |  |
| `effect_events` | `number` | 对账到的事件条数 |  |
| `indexWriteThrough` | `WriteThroughOutcome` | 索引写穿结果（快照 + 索引是否同步成功） |  |
| `written_to_dsl` | `boolean` | 本次结果**是否写进了 DSL**（领域状态，不等于落盘） |  |
| `written` | `boolean` | ★ **已退役**（2026-10-05）：全仓 [B] 已清零，**禁止再新增使用者** | **文件表用 `written_files`；"是否落盘"用 `dry_run` 的反面表达（或直接报 `written_files` 的有无）** |
| `filesWritten` ★ | `number` | 写入文件的**数量**（计数，不是列表） | **改名 `written_file_count`（避免与 `written_files`/`files` 混读）** |
| `previews` ★ | `unknown[]` | 预演结果（逐条） | **★ 现状与 `applied` 平行两套（file 版 / symbol 版）⇒ 统一** |
| `applied` ★ | `unknown[]` | 已落盘的逐条结果 | **★ 同 `previews`：两套平行形状 ⇒ 统一** |

### context —— 上下文

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `read_files` | `string[]` | 被**读取**作为输入的文件（仓库相对路径）。★ **已退役（产物侧，2026-10-05，T56 ④-1）**：它是**剪贴板 / 变量**，**不该占「链的接口」**这一格 —— 下游要文件列表自己读/扫即可（读工具只吃路径，不关心是源码还是事件）⇒ 已从 `Touched` 撤出；**禁止在产物里新增使用者**。 | **2026-10-05 撤出 `Touched`：原 5 个产者（`find_references` / `extract_contracts` / `reconcile_effects` / `reconcile_chain` / `harvest_decisions`）已全部移除该项；其值改由调用方**从上游产物的自有字段里取**（= "剪贴板"那一格，见 T56 ④-2）。** |
| `files` | `string[]` | ★ **入参侧**：本次操作**限定在这几个文件**上（输入范围，仓库相对路径）—— 这是**合法**的用法。★ **产物侧**：**已退役**（2026-10-05）—— 产物里表达"改了哪些文件"必须用 `written_files`（"读了哪些"现已是"剪贴板"、不进产物：`read_files` 亦已退役）；**禁止在产物里新增使用者**。 | **★ 2026-10-05 更正：原写"全仓 [B] 已清零、禁止再新增使用者"，**那句话只对产物成立** —— 实测入参侧仍有 3 个 [B] 在用（`extract_contracts` / `harvest_closure` / `watch_project_tool`），那是"限定范围"的正当输入，**不退役**。产物侧：路径表 → `written_files`（`read_files` 已退役）；报告数组 → `<领域>_reports`。** |
| `project_root` ★ | `string` | 与 `project_dir` **同义** | **并入 `project_dir`** |
| `source_path` | `string` | 输入物的来源路径（文件或 URL） |  |
| `events_files` | `string[]` | 观测事件（JSONL）文件路径表 |  |
| `data` ★ | `unknown` | 工具响应的**载荷**（[C] 层通道用） | **★ 现状 6 个 [B] 用它当逃生口（`unknown`）⇒ 逐族收窄成具体类型，禁止新增 `data: unknown`** |
| `meta` ★ | `Record<string, unknown>` | 本次调用的**元信息**（怎么算的、用了什么策略） | **★ 现状 3 种形状 ⇒ 各领域改名 `<领域>_meta`** |
| `contracts` | `Record<string, BrickContract>` | 积木契约表（键 = 契约名） |  |
| `brick` ★ | `string` | 积木名（标识）；★ 不是对象 | **★ 现状 `string` 与一个对象混用 ⇒ 对象改 `brick_detail`** |
| `bricks` ★ | `BrickSpec[]` | 积木表（装配用规格） | **★ 现状入参 `string[] | BrickSpec[]`、产物两种 Report ⇒ 各按语义拆名** |
| `renames` ★ | `RenameItem[]` | 批量改名条目表 | **★ 现状 `FileRenameItem[]` 与 `RenameSymbolsItem[]` 两种 ⇒ 统一到 `RenameItem`** |
| `definition` ★ | `{ file: string; kind: string; refs: ReferenceSite[] }` | 符号的**定义点** | **★ 现状 2 种形状 ⇒ 统一** |
| `importers` ★ | `ReferenceFile[]` | **谁 import 了**目标（文件 + 引用点） | **★ 现状 `ReferenceFile[]` 与 `RenameSymbolFileInfo[]` 同义不同型 ⇒ 统一** |
| `externalRefs` | `ExternalRef[]` | 跨包/跨仓的外部引用 |  |
| `entries` ★ | `unknown[]` | 条目表 | **★ 现状两种不同条目 ⇒ 各领域改名** |
| `literals` ★ | `unknown[]` | 字符串字面量命中表 | **★ 现状两种形状 ⇒ 统一** |
| `tools` ★ | `unknown[]` | 工具清单（含各自元信息） | **★ 现状 `WizardTool[]` 与 `MappedTool[]` ⇒ 各领域改名** |
| `detail` ★ | `unknown` | 细节开关/细节内容 | **★ 现状 `boolean` 与 `string` 混用 ⇒ 拆：开关用 `with_detail`** |
| `view` ★ | `string` | 视图名（渲染/查询维度） | **★ 现状 3 种枚举 ⇒ 各领域改名（如 `render_view` / `query_view`）** |
| `mode` ★ | `string` | 运行模式（本工具自己的枚举） | **★ 现状 3 组互不相同的枚举 ⇒ 各领域改名（如 `classify_mode` / `rename_scope`）** |
| `scope` ★ | `string` | 作用范围（本工具自己的枚举） | **★ 现状 3 组互不相同的枚举 ⇒ 各领域改名** |
| `action` ★ | `string` | **面分发参数**：选哪个子动作（属 [C] 层入参，不是领域字段） | **保留语义，但**不得**用它当产物的领域字段** |
| `query` ★ | `string` | 查询意图/查询串（本工具自己的口径） | **★ 现状 `string` 与 19 个枚举混用 ⇒ 各领域改名** |
| `brick_name` ★ | `string` | 积木名（与 `brick` 同指时用本词） | **与 `brick` 二选一** |
| `to` | `string` | 目标值（新名/新路径） |  |
| `name` | `string` | 名称（本工具自己指的那个对象的名字） |  |
| `limit` | `number` | 返回条目上限 |  |
| `max_depth` | `number` | 遍历深度上限 |  |
| `max_steps` | `number` | 步数上限 |  |
| `write` | `boolean` | **是否真的落盘**（= `dry_run` 的反面）；★ 与 `dry_run` 二选一 |  |
| `write_dsl` | `boolean` | 是否写进 DSL（领域开关，不等于落盘） |  |
| `report_literals` | `boolean` | 是否一并报告字符串字面量命中 |  |
| `args` ★ | `unknown` | 子动作的参数袋子（★ 只允许在 [C] 分发层出现） | **禁止渗进 [B]** |
| `opts` ★ | `unknown` | 选项袋子（★ 泛型丢失，待类型化） | **类型化后按语义改名** |
| `r` ★ | `unknown` | 值占位（★ 名字无语义） | **按语义改名** |

