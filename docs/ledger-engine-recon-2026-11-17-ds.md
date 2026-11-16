# 侦察报告 · T-#LEDGER-ENGINE（台账引擎化）

- 席位：侦察席（只读；未改任何仓内文件、未跑重门）
- 仓：`D:\agentio\dev\agent-io` → `D:\Projects\ai\agentio\dev\agent-io`（软链已验证：`LinkType=Junction`，`Target=D:\Projects\ai\agentio\dev\agent-io`）
- HEAD：`647436ac docs(ledger): hang T-#LEDGER-ENGINE …`（干净）
- 时间：2026-11-17

---

## 0. 结论先行（三句话）

1. **`todo_journal.ts` 不是半个引擎**——它是**设计册卡**的物理删除墓碑（`<feature>.journal.jsonl`），与 `docs/todo.md` 台账行**不是同一个实体**，全仓没有任何代码在 `docs/todo.md` 与它之间做同步。所以本卡不是"接线"，而是要**新建**；但"防第二处权威"这个担心应该改个对象：仓里已经有三份 append-only 机制（`todo_journal` / `decision_history` 侧车 / `task_history` 表），台账引擎会是**第 4 份**，真正该防的是**第 4 种形态**，不是"第 2 处权威"。
2. **卡片 ④「挂 CLI 还是 MCP」是个假二分**：`src/presentation/cli/cli.ts` 是 `TOOL_DEFS` 的**纯投影**（文件头 :1-33 与 :93 明说，没有 per-action 注册表），MCP 面投影同一份 ⇒ 加一个 `ToolDef` 两面同时有。真正的成本是**工具面字节棘轮**（40 工具 / 154034 B，`mcp_scan --update` 才能变大）+ `TOOL_ANNOTATIONS` 缺键即抛。
3. **`tasks.db` 被 `.gitignore:239` 忽略**——这是本卡最大的、卡片未提的结构性约束：真相搬进引擎后，**"台账在 git 里"这件事只剩 MD 视图这一个载体**，于是"MD 进不进 Git"从"可选"变成"必须"，且视图的 `--check` 必须**挡门**而不是只警告。

---

## 1. 卡片前提纠错（照 AGENTS §五：先核再动）

| # | 卡片原话 | 实测 | 影响 |
|---|---|---|---|
| 1 | `src/infrastructure/todo_journal.ts` | **该路径不存在**。真实位置 `src/application/design/board/todo_journal.ts`（96 行）。`Get-ChildItem src\infrastructure\todo_journal.ts` ⇒ `PathNotFound` | 照着卡片给的路径开工会直接开错文件 |
| 2 | `task_schema.ts:915-932 压栈` 归给 `decision_history` | `src/domain/task_schema.ts:914-932` 是 **`TaskSpec.history`**（卡上修订栈），不是 `decision_history`。`decision_history` 在外置侧车 `src/infrastructure/decision_history.ts`（338 行），节点级 | 批注形状该抄哪一个，卡片指错了对象 |
| 3 | `TASKS_SCHEMA_SQL`（无行号）、`migratePlansColumns` 在 `task_history.ts:72/:91` | `:72` 是 `getTasksDbFile`；`TASKS_SCHEMA_SQL` 在 **`:91-154`**；`PLANS_ADDED_COLUMNS` 在 **`:85-88`**；`migratePlansColumns` 在 **`:186-197`**（ALTER 循环在 `:191-195`） | 行号基本对，但"迁移模式"的**可抄部分**是 `:186-197` + `:206-207` 的调用点，不是 `:91` |
| 4 | `patrol ledgerCheck` 在 `patrol.mjs:101-125` | `:101-125` 是 git 近期改动 + 上次巡检时刻。`ledgerCheck` 在 **`scripts/patrol.mjs:170-194`**，调用在 `:196`，排版在 `:225-236` | 死行号：按 :101-125 改会改到利息维度去 |
| 5 | `src/infrastructure/task_schema.ts`（隐含） | 真实位置 `src/domain/task_schema.ts`（1078 行） | 同上 |
| 6 | MD 现状「335 KB / 553 行」（引自普查件） | 实测 **348280 B / 625 行**（非空 550） | 普查读数已过期 72 行；importer 不许按行号硬编码 |

---

## 2. `todo_journal.ts` 全貌（最高优先）

### 2.1 它是什么
`src/application/design/board/todo_journal.ts:1-96`。

- **实体**：设计册里的一张 **todo 卡**（`TaskSpec`，住 `design/<feature>.dsl.json` 的 `todos[]`），不是 `docs/todo.md` 的行。
- **触发**：只有一个写端——`todo.delete` op（`task_ops.ts:4037-4043`），且被 `:4018-4030` 严格限流：**只有「candidate ∧ 从未被 claim ∧ evidence 0 条」才放行**。曾经生效过的卡走 `todo.retire`（state=void，卡留册）。
- **存储**：`<baseDir>/.agent-io/design/<feature>.journal.jsonl`，路径唯一出处 `todoJournalFile()` `:60-62`（从 `getDesignSheetFile` 取目录，不二次拼 `.agent-io/design`——`:56-58` 记了设计册搬家的病史）。
- **API 形状**（全部 2 个函数 + 1 个接口）：
  - `appendTodoTombstone(feature, t): string` `:65-70` —— `appendFileSync` 一行 JSON，**只加不减**。
  - `readTodoTombstones(feature): {entries, bad_lines}` `:79-96` —— 全量读、**坏行计数返回**（`:75-76`：「不许把读不到读成没有」）。
  - `TodoTombstone {kind:'todo.delete', at, by?, reason, card: TaskSpec}` `:42-53` —— **整张卡原样**（`:39-41`：「摘要等于把答案也删了」）。
- **读端**：`get_dsl query=todo` 的 `deleted` 段（`query_feature.ts:1895`, `:2013-2018`, `:2044`），以及两条错误文案里的指路（`task_ops.ts:3849`, `:4321`）。

### 2.2 与 `docs/todo.md` 的关系
**零关系。** 实测证据：

- `grep 'docs/todo\.md' src/` 命中 45 处，**全部是注释/错误文案里的指针**（`task_schema.ts:895`、`write_log.ts:4`、`chain_wiring.ts:366` …），**没有一处读写它**。
- `scripts/` 里引用 `docs/todo.md` 的 13 个脚本，逐条核过：**只有 `patrol.mjs` 真读它的字节**（`patrol.mjs:171-174`）；其余 12 处全是注释里指路（`gen_manifest.mjs:4`、`gen_cognition.mjs:4`、`run-tests.mjs:574,668`、`verify.mjs:436,458`、`write-log-audit.mjs:3,243`、`history-search.mjs:5`、`probe-gate-cov.mjs:5`、`audit-tool-certs.mjs:15`、`lint-prose-as-structure.mjs:438-441` 那是「守卫表」里的一条**文件名常量**）。
- ⇒ **`docs/todo.md` 今天没有写端，也没有第二个读端。它是纯手写文档 + 一处文本启发式检查。** 这就是本卡的出发点，成立。

### 2.3 判定：是不是"半个引擎"
| 引擎要素 | `todo_journal.ts` 有没有 |
|---|---|
| 挂账（提案） | ✗（它只记录**已经删掉**的） |
| 批注（追加不改写） | 半 ✓（append-only 形态在，但**没有批注语义**——一行一事件 = 一次删除） |
| 逻辑删除 | ✗ **反向**：它是**物理删除**的留痕，是物理删的补偿机制，不是替代 |
| 查询（活跃集默认滤已销账） | ✗（读端是"把全部墓碑吐出来"，无过滤、无状态、无路径/kind 检索） |
| 裁定（verdict） | ✗ |
| 与 MD 的同步 | ✗（无） |

**裁定：不是半个引擎。它是"一次不可逆操作的接住网"。** 按 AGENTS §十二 五档：这是**第 4 档（确实没有）**，不是第 1/2 档。但在开工前必须回答卡片没问的那个问题——**为什么不能是第 2 档（接线）**：因为**实体不同**（`TaskSpec` 卡 vs 台账行），把台账行塞进 `.journal.jsonl` 会让两条线（设计册卡 / 台账行）共用一个文件，而 `todoJournalFile` 是 per-feature 的、台账是**项目级**的（见 §3 的"每项目一库"裁定 `task_history.ts:16-18`）⇒ 目录归属直接打架。

---

## 3. `tasks.db` 现有表与迁移模式

### 3.1 库与路径
- `getTasksDbFile(projectRoot) = rootPath('tasks', projectRoot)` = `<proj>/.agent-io/tasks.db`（`task_history.ts:72-74`）。实测存在，**1077248 B**。
- `roots.ts:97`：`{ role:'tasks', kind:'project', derivable:false, fileName:'tasks.db', carrier:'tasks.jsonl' }` —— **`derivable:false` + `carrier`**，两个字段都关键：不可推导 ⇒ 不许进 `cache.db`；`carrier` ⇒ 二进制 .db 不进 git 时，可 diff 的那份是 `tasks.jsonl`（`roots.ts:95`、`gen_manifest.mjs:160`）。

### 3.2 现有 4 张表（`TASKS_SCHEMA_SQL` `task_history.ts:91-154`）
| 表 | 主键 | 语义 |
|---|---|---|
| `live_cards` | `(feature, id)` | `dsl.todos[]` 的投影（活卡） |
| `task_history` | `(feature, id, moved_at)` | 已了结卡；`moved_at` 进主键 ⇒ **同 id 可多条**（`task_history.ts:27`） |
| `plans` | `(feature, card_id, file)` | 重写计划画布（三键，`:115` 记了为什么必须三键） |
| `write_log` | `id INTEGER PK` | 写审计账（`at, file, actor, card_id, card_feature, kind, source, gate_branch`） |

### 3.3 迁移模式（可抄的两条纪律）
```
PLANS_ADDED_COLUMNS = [['dissolved_at','TEXT'], ['dissolve_reason','TEXT']]   // :85-88  列名只写一遍
TASKS_SCHEMA_SQL 里 … ${PLANS_ADDED_COLUMNS.map(([n,t]) => `  ${n.padEnd(22)} ${t},`).join('\n')}  // :131
migratePlansColumns(db)  // :186-197：PRAGMA table_info 现查缺哪列 ⇒ 逐列 ALTER TABLE … ADD COLUMN
openTasksDb()            // :200-209：mkdirSync → new DatabaseSync → exec(SCHEMA) → migratePlansColumns
```
- **不变量 ①**（`migratePlansColumns` 文档 `:176-185`）：幂等；**只 ALTER**（纯元数据动作，不重写行）；**只在写端跑**（读端只读连接改不动 schema）。
- **不变量 ②**（`:206-207`）：「建表语句对**老库**是 no-op（`IF NOT EXISTS`）⇒ 后加列必须在此显式补」——这是本仓踩过的**静默失配**坑，新表如果也要加列，必须走同一处。
- **不变量 ③**（`openTasksDbForRead` `:229-246`）：**读端不建库不建目录不建表**（`:220-224` 记了实测：拿写端当读端，0 字节库读一次变 40960 B）；并且**表名是硬编码 union**。

### 3.4 新 ledger 表怎么加才不撞门
| 门 | 会不会红 | 证据 |
|---|---|---|
| `manifest:check` | **不会**——它只枚举 `.agent-io/` **顶层条目**（`verify.mjs:566-567` 原文「顶层每个条目都得是某卷的 probe，或登记在 NON_VOLUME_ENTRIES」），`tasks.db` 早已是卷 `id='tasks'`（`gen_manifest.mjs:119`）。**加表不产生新条目** ⇒ 门看不见 | `gen_manifest.mjs:119`, `verify.mjs:566-574` |
| `T-#DBSYNC-CREATES-SHELL` 先例 | **要防的是"新库文件"和"只读探查留空壳"**：`new DatabaseSync(不存在的路径)` 会造 0 B 文件并撞红（`docs/todo.md:467` 原文）。⇒ 新表**必须**住已有 `tasks.db`；只读探查**必须** `fs.existsSync` 先行（`task_history.ts:236` 已是这个写法） | `docs/todo.md:467` |
| 静默 `no-table` | **会静默**：`openTasksDbForRead(projectRoot, table)` 的 `table` 是**闭集字面量 union** `'live_cards'|'task_history'|'plans'|'write_log'`（`:231`）⇒ 忘了加 `'ledger_*'` ⇒ 读端拿 `no-table` 按 0 行计，**只在 stderr 留一行**（`:248-256`）。**这是本卡最容易漏的接线点** | `task_history.ts:231` |

---

## 4. `decision_history` 的追加不改写机制（批注形状该抄谁）

### 4.1 两套都在
| | `decision_history`（节点级） | `TaskSpec.history`（卡级） |
|---|---|---|
| 家 | **外置侧车** `<f>.history.jsonl`（`decision_history.ts:86-88`） | **卡上数组**（`task_schema.ts:932`） |
| 写端 | `appendHistoryEntries` `:96-115` / `appendHistoryClear` `:118-124` | `task_ops.ts:3902` `const history = [...(card.history ?? []), entry]` |
| "减"的唯一合法形态 | `kind:'clear'` **标记行**（`:26-28`：不是删行，是**有留痕的清空**） | 无减（卡被物理删则随卡进墓碑，`task_schema.ts:922-924`） |
| 读端 | `readHistoryLog` `:145-183` → `HistoryIndex{byNode,bad_lines,missing,lines,clears}` | `?? []` |
| 一致性判据 | `resolveHistory` `:220-238` **四态**：`inline / sidecar / both / unreadable / none`；`both` **必须报错**（`:196-197`, `:250-257`） | 无 |

### 4.2 三条不变量（`decision_history.ts:24-32`，本卡应原样继承）
1. **只加不减**（唯一的减是 `clear` 标记行）；
2. **不解释、不规范化**（`entry` 原样 `JSON.stringify`；实测历史里带当前类型没有的字段 `provenance` 250 条 —— 「任何"过一遍类型/白名单/默认值"的实现都会静默丢掉它们」）；
3. **坏行不静默吞**（计数返回，读端必须报）。

### 4.3 已知代价（`:34-36`，**这条决定批注该不该复用侧车**）
> 「它**没有**册的 `_dsl_rev` 乐观锁 ⇒ 并发靠**单写者**（`edit_dsl` 的 `runDslWriteScope` / daemon 单写口串行）。代价是"两个进程同时 append 可能交错"；对策是**坏行计数**，不是假设不会发生。」

**判定：批注线程不要复用它那个 JSONL 文件，要复用它的语义。** 理由是可判读的：台账的批注要**按 row_id 排序 + 按 kind 检索 + 多席并发追加**（§H 的 PR 链纪律就是多席），而侧车形态的并发对策是"交错就坏行计数"——把 PR 链交给坏行计数，等于把评审纪律建在一个会被交错打断的介质上。`tasks.db` 有事务 +（可加）唯一索引，且台账本来就要按 state/path/kind 检索。

---

## 5. CLI / MCP 工具面注册模式（成本核算）

### 5.1 事实：CLI 没有 per-action 注册点
`src/presentation/cli/cli.ts`（322 行）结构：
- `:36` `import { TOOL_DEFS } from '../../application/tool_registry.js'`
- `:93` `const found = TOOL_DEFS.find(d => d.name === cmd)` —— **按工具名寻址**，`cmd` 就是工具名（`snapshot` / `get_dsl` / `design_line`…）。**没有 switch / case / handlers 表**。
- `:300` `await invokeTool(def, args, 'cli')` —— 与 MCP 面**同一入口**（`:14-18` 记了理由：手写 CLI 全都缺保鲜/告警/狗食）。
- `action` 是**该工具 inputSchema 里的一个参数**：`package.json` 的 `snap:list` = `cli.js snapshot action=list project_dir=.`。

⇒ **「挂 CLI 还是 MCP」不是选择**：加一个 `ToolDef` 到某条 lane 的 `index.ts`，两个面同时出现。要做的只有 4 件事（`tool_registry.ts:46-52` + `:54-66`）：
1. 在 `application/<lane>/index.ts` 的 `*_TOOLS` 数组加一项（`meta` 线现有 10 个：`explore_code diagnose diagnose_loop capability_map capability_audit sync_contracts index_integrity upgrade contract_page chain_hop_args`）；
2. 在 `application/tool_annotations.ts` 的 `TOOL_ANNOTATIONS` 加一条 —— **缺键即抛**：`tool_registry.ts:58-64` 原文「TOOL_ANNOTATIONS 缺少 N 个工具的注解 ⇒ throw」；
3. 若工具**写册**，`writes` 字段进 `bindWritesOf`（`:92`）；
4. 工具名进基线。

### 5.2 MCP 面的真实成本 = 字节棘轮
`scripts/mcp/tool-surface-baseline.json`：`{"tools":40,"bytes":154034,"totalBytes":154119,"capturedAt":"2026-11-10"}`，判据写在 `note` 里：
> 「判据只有一条方向：**当前 ≤ 基线**；要变大必须显式 `node scripts/mcp/mcp_scan.mjs --update`（有意识动作，且只许在**本次无失败**时写盘）」

- 基线 `top10` 里最大的是 `get_dsl 13939 B`。一个 `ledger` 工具带 action 枚举 + 用法说明，粗估 **2–4 KB wire 字节**（与 `capability_map 6360` / `rules 5745` 同档）。
- ⇒ **成本是"必须解释为什么工具面变大"**，不是"技术不允许"。这本身是好事：它逼着把 action 面收敛成一个工具而不是五个。
- 命名风险：`ledger` 一词已被 `scanLedgerStaleness`（`src/application/patrol/ledger_staleness.ts`，28228 B，patrol 的 L1「账本陈旧三判据」）占用，语义是「设计册声明陈旧」。**台账引擎若也叫 ledger，两个"账本"会在同一个代码库里指不同东西** —— 这是本卡必须显式裁的命名问题（建议：引擎工具叫 `ledger`（它才是真账本），patrol 那个改称 `staleness`/`S1-S3`，或反过来叫 `backlog`）。

---

## 6. MD 视图再生成：`renderCognition` / `gen_cognition` 模式怎么套

### 6.1 现成模式（三条，逐条可抄）
`scripts/gen_cognition.mjs`（289 行）：
1. **同一渲染器，不许第二份实现**（`:12-14`）：脚本**不自己排版**，而是 `execFileSync(node, [cli.js, 'get_dsl', '--json', '{query:"digest",feature,view:"design"}'])` 把产品自己的输出取回来（`:135-142`）⇒「与 `query=digest` 逐字一致」是**结构保证**。`renderCognition(sections)` `:192-213` 只加段头（`===feature X=== dsl_rev=N sha256=H`）与固定 header。
2. **带派生指纹，过期即标**（`:15-20`）：`sha256=<body 的哈希>`，`sha()` = `:126`（取前 16 位）。★ 关键设计：**哈希"渲染出来的 body"而不是源文件** —— 「改个坐标，body 一字不变 ⇒ 这份快照仍然准确」。
3. **`--check` 只对账**（`checkCognition` `:220-247`）：从盘上正则抓 `===feature (\S+)=== dsl_rev=(\d+) sha256=(\w+)`（`:226`），与现算的 `Map` 三向比 —— `stale` / `missing` / `extra`，加 `failed`（取不到 digest）。**`failed.length > 0` 时判红且 why 写「这不是"一致"，是没验"**（`:237-238`）。

**两个已修的真 bug，直接是本卡的坑：**
- `:186-188`：失败时原来 `hash = sha('')` ⇒ 与"空快照"相等 ⇒ `--check` 报"一致（最新）"，**门绿而一行都没投影**。修法：失败段 `sha('ERROR:'+error)`，永不等于真实 body。
- `:103-108` + `:110-124`：枚举源失效（读已退场的 `features/`）⇒ 读到 0 个 feature ⇒ 写出**空**文件，而 `--check` 因为"自己那半边也空"照样绿。修法：**一个都没有时抛错**。

### 6.2 落点建议
- 渲染器住 **application**（`src/application/.../ledger/` 下 `render_ledger_view.ts`），不写在 `scripts/`：因为 `--check` 与 `patrol` 与未来 `capability_map` 都要调它；`scripts/` 只做"spawn CLI + 三向对账 + 退出码"。
- `--check` 的门位：`verify.mjs:300-308` 的**「文档与事实」**门已经在聚合 `lint:prose / gen-facts:check / manifest:check / cognition:check`（聚合器 `scripts/docs-facts-check.mjs`，`verify.mjs:297`）⇒ `ledger:check` **挂进这个聚合器**，不新开门（AGENTS §六「检测点入口数不增」）。

### 6.3 §A-§I 一次性 importer 的解析难点（实测行型三分类）

`docs/todo.md` 实测（node 逐行分类，625 行）：

| 行型 | 条数 | 解析难度 |
|---|---|---|
| 表格行 | **345** | 主体。首列是 id：`T-#XXX`（**加粗 33**）/ `R31` / `T###` / `D-#` / `GAP-*` / `#` / `A1` |
| 表格分隔行 | 9 | 跳过 |
| 散文行（非空、无前缀） | 117 | §A 前置硬门槛的短列表续行、§E 的段落 |
| 列表行 `- / *` | 23 | 同上 |
| 加粗段首 `**M0 字段地基**` | 11 | 段标题，不是任务 |
| 引用 `>` | 21 | §H/§I 的纪律段（**批注形态的现成范本**） |
| 标题 `#` | 24 | §A…§I + 子节 |

**三类难点（卡片要求的三类，实测后精确化）：**

1. **表格行**（345）：列数分布 `3 列 258 / 4 列 45 / 5 列 20 / 2 列 11 / 其它 11`。`§I` 各表是 4 列（编号/任务/当前裁定/待论证点），`§G` KEEP 是 3 列（编号/任务/来源），`§H` 是 5 列（+规模）。⇒ **不能按列数定 schema，要按"表头行"取**。
2. **散文行**（117+23+11）：**没有 id**。§A 的硬门槛是 `**M0**` / `**实际侧缺**` / `- expected_apis 0% ← …` 这种，§F 是**围栏代码块** `KEY  one-line-verdict`（`docs/todo.md:390-399`）。⇒ §F 其实是**第三个实体**（裁决留档：`SYM-HASH-VS-BODY-HASH` / `ZERO-VALUE-TWO` … 一行一条）——它**天然是 `verdict` 的存量数据**，import 时该进"裁定"列而不是"任务"列。
3. **多栏脏行**（11 行，列数 6/7/8/10/11/16/23/27/28/30）：**这些不是真的 30 列**，是单元格内容里含裸 `|`（路径/嵌套表格/内联表格）。⇒ **朴素 `split('|')` 会把这 11 行错切**。importer 必须用"`code span` 感知的切分"或把这 11 行标 `needs_human`，禁止静默切错。

---

## 7. `patrol` 的 `ledgerCheck` 改造

### 7.1 现状判据（`scripts/patrol.mjs:170-194`）
```
LEDGER_REL = 'docs/todo.md'          // :136
LEDGER_MAX_ROW = 1800                // :137
LEDGER_CLOSED = /✅|已了结|已收口|已结案|已闭合/   // :139
LEDGER_OPEN_WORK = /待做|未做|仍未|还需|还要|要改|要补|下一步|规格全文见|已派|待派|等待|未提交/  // :150
closedOutsideQuotes(s)               // :160-168  引文奇偶启发式（「」配对 + 反引号偶数）
```
输出三段：`closed`（结案词 ∧ 无未完成词 ⇒ 该删）、`closedMarked`（信息档）、`long`（>1800 字符）。**带分母**（`:189` `scanned`），**只报不改**（`:131-132`）。

### 7.2 三个判据的迁移判据
| 现判据 | 引擎化之后 | 迁移动作 |
|---|---|---|
| `closed`（该删没删） | 变成**矛盾检测**：`state ∈ {active}` 但 body 出现结案词且无未完成词；`state=done` 但 `evidence` 空 | **保留语义，换输入**（引擎列而不是行文本） |
| `closedMarked`（信息档） | **消失**——"一行挂多个子项"的病根是"一行承载多个子任务"；引擎里它们本来就是多行 | **删掉**（这正是 0.16「不许永远亮的灯」） |
| `closedOutsideQuotes` 引文奇偶 | **退役**：批注独立成行（§H 的 `> ↳ 席名 日期：…` 形态）⇒ 引述别人的 ✅ 不再与被述行同处一行 | **删**（并留一条反例：旧判据红、新判据不红的同一输入） |
| `long`（>1800 字符） | 变成 `length(detail) > 1800`（引擎列） | 保留，读引擎列 |

### 7.3 必须守住的两条（否则改造即假绿）
1. **「读不到 ≠ 干净」**：`patrol.mjs:226-227` 现在就有这句（`!ledger.ok` ⇒ 印"判不了"）。改读引擎后，`openTasksDbForRead` 的 `no-db` / `no-table` / `unreachable` 三态必须**逐态区分**——`no-table`（表还没建）**不许**印"0 条欠账"。
2. **视图过期要单独一行**：如果 `ledgerCheck` 改读**生成的视图**，它就把视图的陈旧性继承成了自己的判据（视图过期 ⇒ 判据测的是旧账）。⇒ **读引擎（权威）+ 单独报视图 `--check` 的结果**，两件事不许压成一个红绿。

---

## 8. 最小落地切分（4 个子卡 + 验收判据）

> 判据写法遵守 AGENTS §二：写"能力在不在/反例还红不红"，不写"某处数 == N"。

### L1 · 引擎表 + 写端（挂账 / 批注 / 销账）+ 只读查询
**范围**：`TASKS_SCHEMA_SQL` 加 `ledger_entries` + `ledger_events`（同 `tasks.db`，**不新建库文件**）；`openTasksDbForRead` 的表 union 加两个名字；`ledger` ToolDef（`action: add|annotate|void|query|verdict`）挂 meta 线 + `TOOL_ANNOTATIONS` + `mcp_scan --update`。
**不做**：importer、MD 视图、patrol 改造。

验收判据
1. **销账不是删**：一条 `state=done` 的行，`action=query state=all` 仍能逐字取回原 body；把实现改成 `DELETE FROM ledger_entries` ⇒ 一条行为用例必红。
2. **活跃集默认过滤**：给 1 条 active + 1 条 done，`action=query`（不带 state）**不含** done 那条；带 `state=all` **含**。反例：把过滤去掉 ⇒ 用例红。
3. **重复销账被拒**：同一 id 第二次 `void` 报错并指出首次销账的时刻/证据（不是静默覆盖）。
4. **`manifest:check` 仍绿**（证明只加表、没加文件）；打开一个不存在的 `tasks.db` 做只读查询 ⇒ **不产生 0 字节文件**。
5. **批注不改写**：对同一行两次 `annotate`，第一次的 body 逐字仍在（按 `seq` 排序可取回全部），且 `annotate` 不接受"改已有事件"的参数。

### L2 · 一次性 importer + 双向对账（MD → 引擎；MD 暂时不动）
**范围**：解析 `§A-§I` 三类行；未带 id 的散文行进 `notes`（挂 section 路径）；§F 代码块进 `verdicts`。

验收判据
1. **双向对账**：`grep -oE 'T-#[A-Z0-9-]+' docs/todo.md | sort -u` 的 id 集合 == 引擎 `ledger_entries` 的 id 集合（双向差集必须空）；造一条"册里有、引擎没有"和一条"引擎有、册里没有" ⇒ 对账各红一次并**点名 id**。
2. **多栏脏行不错切**：那 11 行（列数 6..30）必须逐行进 `needs_human` 清单落盘，**不许**被静默切成错列；断言"引擎里没有任何 entry 的 `detail` 以 `|` 开头或结尾"。
3. **散文行不进行表**：断言 `notes` 表里能找到 §A 的 `**M0 字段地基**`，且 `ledger_entries` 里**没有**任何 summary 等于某个 heading 文本。
4. **幂等**：连跑两遍，第二遍 `added=0 / skipped=N`，且全库 sha256 逐字节不变。
5. **不许手抄计数**：importer 报"迁入 N / 跳过 M / 三类各多少"，但不把 N 写进任何判据。

### L3 · MD 视图再生成 + `--check` 门
**范围**：`render_ledger_view()` 住 application；`npm run ledger`（生成）+ `npm run ledger:check`（对账，挂 `scripts/docs-facts-check.mjs` 聚合器）；`docs/todo.md` 改由生成器写。

验收判据
1. **手改即红**：手工改视图一行 ⇒ `ledger:check` 非零退出并点名"已过期，请重生成"。
2. **引擎改了没重生成即红**（这是真判据：视图是派生）。
3. **生成失败 ≠ 一致**：故意让渲染抛错 ⇒ check 红，且输出**不含**"一致（最新）"（抄 `gen_cognition.mjs:186-188` 的 ERROR-hash 修法）。
4. **同一渲染器**：视图 body 与 `ledger action=query` 的文本逐字一致（**结构保证**：生成器 spawn CLI，不自己排版）；反例：在生成器里另写一段排版 ⇒ 一条"逐字一致"用例必红。
5. **进 Git**：`git check-ignore docs/todo.md` 退出 1（现在是**已跟踪**，`git ls-files` 命中）；且 `--check` 在视图有未提交改动时**显式声明**而不是误判过期。

### L4 · patrol 判据迁移 + 旧判据退役
**范围**：`ledgerCheck()` 改读引擎；删 `closedOutsideQuotes` / `LEDGER_CLOSED` / `LEDGER_OPEN_WORK`。

验收判据
1. **新判据有牙**：造一条 `state=done` 但 `evidence` 空 ⇒ patrol 红并点名 id。
2. **旧判据退役有证据**：同一个输入（行尾有 ✅、body 里无未完成词、`state=active`）——**旧判据红、新判据不红**，两条断言同时存在（否则"删掉判据"与"判据修好"读起来一样）。
3. **读不到 ≠ 干净**：`tasks.db` 不存在 / 表不存在 / 根不可达，三态各印各的话，**都不印 0 条**。
4. **视图陈旧独立报**：视图过期时 patrol 仍能正确判引擎，只是多一行"视图已过期"。

### 依赖顺序
`L1 → L2 → L3 → L4`（L2 要求 L1 的表在；L3 要求 L2 的数据在；L4 只能最后，否则旧判据在新数据上会乱报）。**每个子卡都可独立验收**：L1 做完，MD 一字不动、patrol 一字不动，世界仍然自洽。

---

## 9. 五个待论证点（逐条回答，带证据）

### ① `todo_journal.ts` 撞不撞面 ⇒ **不撞实体，撞形态；本卡是"新建"，但形态不许新造第 4 种**
- 证据：`todo_journal.ts` 的实体是 `TaskSpec`（设计册卡），路径 per-feature（`todoJournalFile` `:60-62`），写端唯一且被"从未生效"限流（`task_ops.ts:4018-4030`），读端只有 `get_dsl query=todo` 的 `deleted` 段。台账行是**项目级**的（`task_history.ts:16-18`：「`.agent-io/` 本来就是每个项目一份」）。
- 裁定：**不接线到它**（实体/归属/生命周期/读者四项全不同 ⇒ 接了就是 AGENTS §十二 第 5 档"两边都活着"）；**但要抄它的形态**（append-only + 一行一事件 + 坏行计数 + "路径只一个出处"）。第 4 种形态是不许的：仓里已有三份（`todo_journal` JSONL / `decision_history` 侧车 / `task_history` 表），台账应是**第三种（SQL 表）的第二个用户**，不是第四种介质。

### ② MD 视图进不进 Git ⇒ **进，而且必须进；理由是卡片没看到的那个约束**
- 证据：真相要住 `tasks.db`，而 `.gitignore:239` = `**/.agent-io/tasks.db`（`git check-ignore -v` 实测命中）⇒ **库不进 git**。若视图也不进 git，则**关于台账的一切在 git 里一个字都没有**。这正是 `.gitignore:31` 自己记的那类病（T223：「git 里一个字都看不到 ⇒ 我把它误判成环境噪声」）。
- churn 判据（`gen_manifest.mjs:40-42`）：声明 = 低 churn 进 git（`MANIFEST.txt`）；快照 = 高 churn 不进（`COGNITION.txt`）。台账行核销是**低频事件**（一天几条），比 COGNITION（每次代码改动都变）低两个量级 ⇒ **低 churn ⇒ 进 git**。
- 附带：`docs/todo.md` **今天已跟踪**（`git ls-files docs` 命中，`.gitignore:163` 有 `!docs/todo.md`），改成生成文件不改变跟踪状态；`.gitignore` 不用动。
- 补一条卡片的倾向没说到的：`tasks.db` 有**文本载体先例** `tasks.jsonl`（`roots.ts:97 carrier`，`.gitignore:242 !/.agent-io/tasks.jsonl`，实测 146915 B / 86 行，`{kind,feature,id,state,card,updated_at}`）。若担心"真相不在 git"，可选加一份 ledger 的 jsonl 载体——但那会是**第二处真相的诱惑**，建议**不加**，让 MD 视图当唯一的 git 审计面。

### ③ 批注存储 ⇒ **新表，抄 `decision_history` 的语义不抄它的文件**
- 形状：`ledger_events(row_id, seq, kind ∈ {proposal, annotate_support, annotate_rebut, verdict, void}, at, by, body, supersedes_event_id?)`。
- 抄什么：三条不变量（只加不减 / 不过类型 / 坏行不静默 → SQL 表里对应"json 列不解释"与"坏行计数=0 因为 schema 强制"）；`clear` 型"有留痕的作废"语义；`resolveHistory` 的**四态**（`both` 必须报错 = 同一事实两住处；`unreadable` ≠ 没有）。
- 不抄什么：JSONL 侧车的**单写者假设**（`decision_history.ts:34-36` 自己写了代价）。§H 的 PR 链是**多席并发追加**，坏行计数兜不住"评审链被交错"。
- §H 已把形态写好了（`docs/todo.md:500-508`）：`> ↳ <席名> <日期>：…` 追加不改写 + lead 裁定也追加在行内 ⇒ 引擎里就是 `kind='annotate'` / `kind='verdict'` 两种事件，**MD 渲染时把事件串渲染成引用块**（视图负责形态，引擎负责真相）。
- 命名建议：**别用 `state=superseded` 表示"被取代"**——`done/void` 是**结局**，`superseded` 是**关系**；把它做成 `superseded_by` 指针列（谁取代了它才是可查的），否则"谁取代了这张卡"要扫事件表。这条有外部支撑（见 §10 的 Lobu）。

### ④ 入口 ⇒ **假二分；真成本是字节棘轮 + 命名撞车**
- 证据：`cli.ts` 无 per-action 注册（`:93` 按 `d.name` 找）；MCP 与 CLI 投影同一份 `TOOL_DEFS`（`tool_registry.ts:46-66`）；加工具的 4 个动作见 §5.1。
- 裁定：**一个 `ledger` 工具 + `action` 枚举**（照 `snapshot`/`design_line` 的既有形态，不新造 5 个工具），挂 `meta` 线。成本 = `TOOL_ANNOTATIONS` 一条（缺则抛）+ 基线 `154034 B` 上浮 2–4 KB（须 `mcp_scan --update`，这是**有意识动作**，正好是评审面）。
- **命名必须先裁**：`ledger` 一词现在指 `scanLedgerStaleness`（patrol 的"设计册声明陈旧"三判据，`src/application/patrol/ledger_staleness.ts`）。同一仓库两个"ledger"是两个东西 ⇒ 建议引擎叫 `ledger`（它才是账），patrol 那个改称 `staleness` / `S1-S3`。

### ⑤ 迁移策略 ⇒ **一次切换 + 双向对账，不双写**
- 理由（本仓自己的裁决）：双写 = 同一事实两住处，而本仓已有"both ⇒ 必须报错"的成文判据（`decision_history.ts:196-197`, `:250-257`「不许"取其中之一"——那正是 0.9.1 要禁的"同一事实两住处"」）。
- 形态（4 步，每步可验）：
  1. importer **只读入库**（MD 不动）→ 双向 id 对账绿（L2 判据 1）；
  2. 生成视图写回 `docs/todo.md`，**与原 MD 做一次人工评审的逐段 diff**（判据：§A-§I 段标题与现有逐字一致；行集合相等）；
  3. 之后 MD **只由生成器写**（手改由 `ledger:check` 抓）；
  4. patrol 改读引擎（L4）。
- 回滚：`docs/todo.md` 在 git 里，任何一步都能 `git checkout` 回去；引擎侧是**加表**（不动既有 4 张表），回滚 = 不读它。

---

## 10. 网检（渠道：`web_search` + `web_fetch`（raw.githubusercontent 即 GitHub 原始文件通道）；两查均成功，无失效替换）

### 10.1 查一：event sourcing 与软删除的审计账设计

**来源 1 — awcms ADR-0005《Soft delete for master/config, immutability for posted data》**
<https://raw.githubusercontent.com/ahliweb/awcms/75f94b04cd76491693d584e437bd2f11eef21830/docs/adr/0005-soft-delete-and-immutability.md>
- 原文：「fill in `deleted_at`, `deleted_by`, `delete_reason`; **list/detail queries filter `deleted_at IS NULL` by default**; restore/purge are high-risk actions (they need a permission and are audited)」；「a partial unique index `WHERE deleted_at IS NULL` for business keys that may be reused after being archived」。
- **支持**卡的三件事：① 逻辑删除三件套（时刻/谁/为何）正是卡写的"state+时刻+证据"；② **默认过滤**是行业标准做法，卡的"活跃集默认滤已销账"不是发明；③ 低频事件的"deleted_at NULL"过滤必须配**部分唯一索引**，否则查询要兜。
- **修正两点**：(a) 卡只有"销账"，**没有 restore**——而本仓 task 侧已有 `t_reopen`/`t_relaunch` 的先例（`task_schema.ts:911` 提到"本仓已没有「终态」这回事"）⇒ 台账也该有"重开"，并且重开本身要留痕（否则"这张卡又被捡回来了"这个事实无处可查）；(b) `T-#X` 这样的业务键 **被 void 后不许新行复用同一 id**——用部分唯一索引 `WHERE state='active'` 表达，比"靠自觉不复用"硬。

**来源 2 — Lobu《Spec: `git push` → append-only events》**
<https://raw.githubusercontent.com/lobu-ai/lobu/4b791f2b50a236f8ae66e49aa29e8391e5e5d6ae/docs/plans/push-to-events.md>
- 原文：「**Never DELETE; supersede with a tombstone row that points at the original via `supersedes_event_id`**」；「the "current" projection is the view `current_event_records`: a row is current iff `NOT EXISTS (newer WHERE newer.supersedes_event_id = e.id)`」；「At-most-one-superseder invariant: `CREATE UNIQUE INDEX … ON events (supersedes_event_id) WHERE supersedes_event_id IS NOT NULL` … Two writers can't both supersede the same base event — loser gets SQLSTATE 23505」；「DELETE a file — never `DELETE FROM events`. Soft-delete entity (`deleted_at`) + tombstone lifecycle event」。
- **支持**：卡把"取代"当成**追加一条指向原件的事件**而不是改原件，这条有直接同构先例；而且它给出了本卡缺的**并发原语**（`supersedes_event_id` 的部分唯一索引 ⇒ 两席同时销账同一行，后者必须失败并报冲突）。**这正好补上 §9③ 的建议：把 `superseded` 从 state 挪成 `superseded_by` 指针列，同一个唯一索引既能表达"只许一人取代"又能直接回答"谁取代了它"。**
- **修正**：卡把 `superseded` 与 `done/void` 并列成 4 个 state，是把**关系**塞进**状态**（本仓 T-#KIND-PHASE-DUP 那类"同一事实两住处"的镜像）。
- **补充视角**：TDCommons 的技术披露把"不可变"做成**存储引擎级**约束（DB trigger 拦 UPDATE/DELETE），而不是应用层约定 <https://www.tdcommons.org/cgi/viewcontent.cgi?article=12189&context=dpubs_series> —— 对本仓的修正：`todo_journal` 的"只加不减"目前只是注释+"没人写删的代码"，没有判据。台账表至少要有一条**打断即红**的用例（改成 DELETE/UPDATE 就红），而不是靠"我们不会那么写"。

### 10.2 查二：markdown 作为 generated view 的 doc-as-code 实践

**来源 3 — tetherto/mdk《A single source of truth vision》**
<https://raw.githubusercontent.com/tetherto/mdk/refs/heads/main/docs/reference/maintainers/single-source-of-truth.md>
- 原文：「Generated docs are a **checked projection of the facts that ship**, not a second hand-maintained copy that can drift. A generator reads the canonical source and rewrites its projection; **hand-edits do not survive the next run**.」；「Exit codes: `0` every checked projection is current, `3` committed generated files are stale, `1` generation itself broke.」；「Report mode **declines to run when a generated file already carries uncommitted edits**, because it cannot tell a stale page from work in progress.」；「a skipped target … in CI treated as a failure」；「Each Markdown target repeats its command in a `DO NOT EDIT` header, which travels with the page a person is looking at.」；「The `check:usage-proptables` gate stops new hand-authored props tables from becoming competing sources of truth: **existing debt is baselined, removals are allowed, additions or swaps fail**」。
- **强烈支持** `gen_cognition` 那套（同一渲染器 + sha256 逐段 + `--check`）与卡的"MD 降为派生视图"。
- **四条可抄的修正**：
  1. **退出码三态**（0=最新 / 3=过期 / 1=生成坏了）比本仓现在 `cognition:check` 的 0/1 强——它把"视图过期"和"生成器炸了"分开，而这两件事的处置完全不同。`ledger:check` 应照抄。
  2. **`--check` 遇到未提交的生成文件要拒绝跑**——本仓视图进 git 之后，工作区脏时 `--check` 会把 WIP 判成"过期"（假红）。这条是"视图进 git"的**必付代价**，卡片②只算了 churn，没算这一条。
  3. **`DO NOT EDIT` 头随页面走**——`gen_cognition.mjs:199` 已经有等价物（「⚠ **会过期**：改过 DSL 后请重跑…」），台账视图必须照办，否则下一个人会直接手改 MD。
  4. **存量债用 monotonicity 基线而不是一次全绿**：本仓台账有 49 条历史账区（`docs/todo.md:569`）+ §G 83 条 KEEP ⇒ 一次迁移全绿是假目标；"新增行必须结构化、存量行基线免红、删行放行"才是可执行的棘轮。
- **反方及其被驳回的理由**：threadplane《Agent-First Docs》主张「**advisory drift reporting rather than CI gates**」<https://github.com/cacheplane/threadplane/blob/213242e4a2486ce058f5e544f85a16b365e6ca53/docs/superpowers/plans/2026-03-21-agent-first-docs.md>。**不采纳**的理由是可判读的：drift 只警告的前提是"机器判不准"，而本仓**判得准**（sha256 逐段相等，`gen_cognition.mjs:126,226-234` 已实证）⇒ 判得准的东西只警告 = 造一盏"永远不亮的灯"（0.16 的反面）。但它的另一半是对的：**判据只该挡"可机器判"的那部分**，语义判断（哪一行该迁去哪）仍然回人 —— 这正是 patrol 现在"只报不改"的边界（`patrol.mjs:131-132`），L4 不许越过它。

---

## 11. 未做 / 边界（如实声明）
- **未跑任何重门**（`verify` / `npm test` / `judge-all` / `build`）：按要求。⇒ 本报告里"门会红/不会红"的结论均来自**读源码判据 + 既有实测记录**，不是跑出来的。
- **未验证 `ledger` 工具的 wire 字节增量**（2–4 KB 是估），要实测只能改代码后跑 `mcp_scan.mjs`。
- **未逐行核对 §A-§I 每一行能否映射成一条 ledger entry**（那是 L2 的活）；本报告只给了行型分类与三类难点。
- **`docs/todo.md` 行数**我用 node 现算（625 行 / 348280 B）；普查件写的 553 行/335 KB 已过期 —— 两者的差 72 行本身是一条读数（可能有新增未同步进普查件）。
