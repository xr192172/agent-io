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

**机检**：共用字段名 **42** 个 ｜ 表里有定义 **40** ｜ ★ 未定义 **2**

⚠️ 未定义的共用字段名：`error` `touched`

**债务**：`debt: true` **38** 条（棘轮：只许减不许增）。

### anchor —— 链的接口（下游能拿它当原料）

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `feature` | `string` | DSL 的 feature 名（活文档单元） |  |
| `project_dir` | `string` | 被分析/改动的**项目根**（一个仓库的根目录）；不是盒根、不是子目录 |  |
| `written_files` ★ | `string[]` | 被**写入/改动**的文件（仓库相对路径，`/` 分隔） | **新词，尚无使用者；由 ④-b refactor 族起逐族采用** |
| `read_files` ★ | `string[]` | 被**读取**作为输入的文件（仓库相对路径） | **新词，尚无使用者** |
| `symbols` ★ | `string[]` | 涉及到的符号 `qualified_name` | **新词，尚无使用者；与旧 `symbol: string`（单个）并存期间禁止混用** |
| `nodes` ★ | `string[]` | 涉及到的 DSL 节点 id | **新词，尚无使用者；与旧 `node_id: string`（单个）并存期间禁止混用** |

### receipt —— 回执（人读）

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `message` | `string` | 一行人读摘要。★ 不是数据：下游禁止从它解析 |  |
| `limitations` | `string[]` | 本次调用**做不到什么**（诚实列，不留白） |  |
| `stats` ★ | `Record<string, number>` | 本领域的**计数汇总** | **★ 现状 **5 种**互不相同的对象 ⇒ 各领域改名为 `<领域>_stats`** |
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
| `effect_events` | `number` | 对账到的事件条数 |  |
| `indexWriteThrough` | `WriteThroughOutcome` | 索引写穿结果（快照 + 索引是否同步成功） |  |
| `written_to_dsl` | `boolean` | 本次结果**是否写进了 DSL**（领域状态，不等于落盘） |  |
| `written` ★ | `boolean` | 本次是否**落盘** | **★ 现状 `boolean`×4（是否落盘）与 `string[]`×1（文件表）**同名两义** ⇒ 拆：落盘用 `dry_run` 的反面表达，文件表用 `written_files`** |
| `filesWritten` ★ | `number` | 写入文件的**数量**（计数，不是列表） | **改名 `written_file_count`（避免与 `written_files`/`files` 混读）** |
| `previews` ★ | `unknown[]` | 预演结果（逐条） | **★ 现状与 `applied` 平行两套（file 版 / symbol 版）⇒ 统一** |
| `applied` ★ | `unknown[]` | 已落盘的逐条结果 | **★ 同 `previews`：两套平行形状 ⇒ 统一** |

### context —— 上下文

| 术语 | 类型 | 定义 | 债 |
|---|---|---|---|
| `file` | `string` | **单个**文件（仓库相对路径）；多个用 `written_files`/`read_files` |  |
| `files` ★ | `string[]` | ★ **已被污染**：产物侧一个名字有 **6 种类型**（`string[]` / `FileContractReport[]` / `BrickFileReconcileReport[]` / `SlimFileReport[]` / `FileReconcileReport[]` / `FileRemoval[]`） | **★ **拆名**：路径表 → `written_files`/`read_files`；报告数组 → `<领域>_reports`（如 `contract_reports`）** |
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
| `node_id` ★ | `string` | **单个** DSL 节点 id；多个用 `nodes` | **新写 [B] 一律用 `nodes: string[]`** |
| `symbol` ★ | `string` | **单个**符号 `qualified_name`；多个用 `symbols` | **新写 [B] 一律用 `symbols: string[]`** |
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

