# 数据流水账（data ledger）—— 每份数据由谁管

> 用户提出（2026-10-01）：「每一个项目有一个对应的数据库…数据的内容不是实时的、不是一次性完成的，
> 而是**调用每一个工具的时候它从里面取数据和存数据**，然后**哪个数据少了，它就再自动往下一层级去调取
> 这个工具去取数据、存数据**…需要你去设立一张完整的这个**数据流的字段**：有什么数据、需要什么数据、
> **每个数据由什么工具管控**。」
>
> 本文件就是那张表。**口径**：
> · **"谁产/谁消"是量出来的**（到 `文件:行`）—— 来自 5 份只读盘点（DSL 三态 / cache.db / 文件系统 store /
>   观测仓 / 横向 ensure 面）＋ **我逐条抽验**（抽验中改正了 3 处子代理结论，见文末）。
> · **"怎么补/何时失效"是写的定义**（人负责；像 `INTERNAL_MODULES` 的 `why` 一样带证据，不是裸名单）。

---

## ★★★ 结论一（最要紧）：**「每项目一个数据库」目前只对 `cache.db` 成立**

`getDataHome()` 的真实语义（`src/infrastructure/storage.ts:60`）：

```
process.env.AGENT_IO_HOME  ??  getPackageRoot()（自省包根，与 cwd 无关）
```

⇒ `getStorageRoot() = <包根>/.agent-io`，**默认不是项目根**。于是现在**三种根并存**：

| 数据 | 实际根 | 是"每项目一份"吗 |
|---|---|---|
| 符号索引 `cache.db` | `<projectRoot>/.agent-io/`（`index/db.ts:146`） | ✅ 是 |
| DSL 三态（live/baseline/features） | `<dataHome>/.agent-io/`（`storage.ts:66,76,90`） | ❌ **否**（全局） |
| 健康缓存 | **`<cwd>/.agent-io/cache/health`**（`health_cache.ts:27`） | ❌ 否（且**跨项目串**） |
| 读侧兜底 | `<cwd>/.agent-io/cache.db`（`function_outline.ts:70`） | ❌ 第三处 |

⇒ **这是"越兜越多"的真正机制**：不是数据杂，是**"这份数据归哪个根"没人定**。

> ### ★ 2026-10-01 更新（本节的表述**已被处置**，别照旧读）
> 上面这张表是**当天上午的实测快照**，保留作为"病根长什么样"的记录。到当天下午：
> - **健康缓存**：根已改由**调用方显式传**（`health_cache.ts#healthCacheDir(root)`，不再写死 `cwd`）⇒ **不再是第三处根**。
> - **读侧兜底**：`function_outline.ts:70` 那份候选已并入**唯一权威** `db.ts#findCacheDb`（§44.25，20 处副本 → 4 个具名函数）。
> - ★ **"根没人定"这件事本身已被处置**：新增登记表 `tests/fixtures/stage_registry.json` +
>   门 `tests/registry/root_declaration.test.ts` —— **每份数据必须声明 `owner`，且声明要能被"两个根跑一遍"证伪**。
>   ⇒ 本节标题「目前只对 `cache.db` 成立」**不再成立**：现在**每一份**数据都在册，`owner='project'` 的
>   由**行为**校验（拿两个不同的根调它的解析器，结果必须不同），`owner='dataHome'` 的由解析器白名单校验。

## ★★★ 结论二：**同一份数据、两个根 → 直读直空**（硬 bug）

> ### ★ 2026-10-01 更新：**已修**（`97c9d55`）
> 写侧（`serve.ts`）从 `process.cwd()` 改到 `getStorageRoot()`；读侧并入 `db.ts#findCacheDb` 的第一级候选。
> ⇒ 现在**单一根 = `dataHome`**（登记表里 `import_cache` 那一行记了为什么归 dataHome 而不是 project：
> 这个库以 **feature 名**为键，而 feature 这个名字空间本身就是 dataHome 的）。
> 下面的分析保留作为"写读不碰面"这个失败模式的样本。

`import_cache_<feature>.db`：

- **写**：`presentation/http/serve.ts:392` 与 `:441` → `path.join(process.cwd(), DATA_DIR_NAME, …)`
- **读**：`infrastructure/index/function_outline.ts:68` → `path.join(getStorageRoot(), …)`（= 包根）
- 同族读者还有 `meta/overview.ts:155`、`meta/derive_mind_map.ts:904`（都用包根）

⇒ **只要 `cwd ≠ 包根`，就是"一边写、另一边读到空"**。且读侧还有一条**三级查找顺序**
（`function_outline.ts:66-70`：`import_cache_<f>.db`(包根) > `<source_root>/.agent-io/cache.db` > `<cwd>/.agent-io/cache.db`）
—— 三份候选、**无同步关系**。

## ★★★ 结论三：两处**功能级断裂**（观测侧，已逐条抽验）

| # | 断裂 | 证据 |
|---|---|---|
| 1 | **官方 setup 产的事件，对账工具永远发现不了** | 写：`scripts/setup.mjs:39`(`EVENT_DIRS_TPL`) / `:264` → **`.agent/camera`**、`.agent-io/camera`；读：`observe/reconcile_effects.ts:111` → **`.agent/observe`** + `.agent-io/observe` ⇒ **完全不重叠**。根因：改名 `camera → observe` 时 `setup.mjs` **漏改**（`docs/tool-convergence.md:160` 记了那次改名） |
| 2 | **写端与读端用两个不同的 env 名，且无桥接** | 激活/写：**`OBSERVE_EVENTS_FILE`**（`observe/run_sentinel.ts:26`、`index/watch_project_tool.ts:346`）；读端自动发现：**`DS_OBSERVE_EVENTS`**（`observe/observe_trace.ts:43`、`trace_evidence.ts:120`）⇒ 按文档设了也白设，必须手工传 `events_path` |

## ★★ 结论四：三处"只写不读" / 死代码（写进去没人用）

| 项 | 证据 |
|---|---|
| `project_metadata` 表 | `index/schema.ts:197` 建表；**全仓零读写** |
| `observe-ledger.json` | MCP 写（`handlers.ts:508`）；**只有 CLI `--ledger` 读**（`instrument_cli.ts:83`）⇒ MCP 侧只写不读 |
| `observe-points.json` | `observe_points.ts:431` 写；**仓内无 reader**（靠人工中转） |
| `getArchiveEntry`（`storage.ts:246`）、`deleteDSL`（`storage.ts:404`） | **全仓只有定义** |
| `server_registry.ts:26,79` | 5 个符号（`listFileSnapshots`/`rollbackFileSnapshot`/`captureBaseline`/`verifyBaseline`/`baselinePathFor`）**各只出现 1 次 = 死导入** |
| `package.json:55` `dogfood` 脚本 | 指向 `dist/src/tools/dogfood_stats.js`；源码已搬到 `src/infrastructure/` ⇒ **该 dist 还在（陈旧）⇒ 静默跑旧代码**，clean build 后才直接断 |

## ★★ 结论五：`embedding_cache` 无失效、无淘汰

`semantic_search.ts:162` 写 / `:123` 读；**没有 TTL、没有淘汰、schema 迁移也不清**（`schema.ts:101`）⇒ 只增不减。

---

## 主表（每份数据一行）

| 数据项 | 存哪（根） | 谁**产** | 谁**消** | 缺了怎么**补** | 什么触发**失效** |
|---|---|---|---|---|---|
| 符号索引 `nodes/edges/files/imports/unresolved_refs/symbol_diffs/nodes_fts` | `<projectRoot>/.agent-io/cache.db` | `symbols.ts:213 applyParsedToIndex` ← `syncFile`(453) / `syncProject`(581)；上游 `index_freshness.ts:411,537,611`、`index_backfill.ts:117,221`、`edit_code`、`rename_file.ts:378`、`write_gate.ts:289` | 17+ 工具直读（`diff_impact` / `derive_mind_map` / `function_outline` / `observe_points` / `project_root` / `extract_contracts` / `harvest_closure` / `index_integrity` …） | `ensureProjectIndex` / `ensureFreshIndex` / `ensureIndexAroundSeed` —— **各调用点自己记得调**（`server_registry.ts:543` 只在 `hasLiveIndex && !isIndexIncomplete` 时调） | content-hash / mtime+size；`detectStaleIndex`（`index_freshness.ts:200`）**只 stat 不修** |
| `embedding_cache` | 同上 | `semantic_search.ts:162` | `semantic_search.ts:123` | 无（miss 就调 API） | ★ **无** |
| `import_cache_<feature>.db`（同构副本） | **两个根**：`<cwd>`(serve) / `<包根>`(function_outline,overview,derive_mind_map) | `serve.ts:392,441` | `function_outline.ts:68`、`overview.ts:155`、`derive_mind_map.ts:904` | 无 | ★ **无同步** |
| 活态 DSL（全局单文件） | `<dataHome>/agent-io.json` | `storage.ts:304 saveDSL`（全仓 ~50 处调用） | `getDSL`(348) / HTTP `handleApiLoad` | 无（回退 `features/<f>.json`） | 无 TTL；仅乐观锁(`storage.ts:307`) |
| live 快照（per-feature） | `<baseDir?dataHome>/.agent-io/live/<f>.dsl.json` | `storage.ts:105 saveLiveFeature` ← **唯一产者 `import_project.ts:1417,1427,1466,1474`** | `getLiveFeature`(118) ← `serve.ts:321`、`diff_views.ts:237` | 无（须 rebuild） | 无 TTL；`watch_project` 增量重建 |
| design 存档 | `<dataHome>/.agent-io/features/<f>.json` | `storage.ts:319` | `getDSL` 回退(364)、`listFeatures`(383) | 仅写时建目录 | 无 |
| DSL 基线 | `<baseDir?dataHome>/.agent-io/baseline/<f>.dsl.json` | `ensureBaseline`(`storage.ts:181`) ← **只有 `import_project.ts:1479` 一处调** | `getBaselineFeature`(167) ← `diff_views.ts:238`（唯一读者） | **有**（ensureBaseline）但**单点** | 无 TTL（刻意） |
| 下线库归档 | `<baseDir?dataHome>/.agent-io/archive/<f>/<id>.json` | `storage.ts:237` ← `archive_node.ts:47` | `getArchiveEntryByPath`(273)、`listArchiveEntries`(257) | 无 | 无 |
| 代码快照 | `<projectRoot>/.agent-io/code-snapshots/<id>/` | `refactor/file_snapshot.ts` ← `snapshot` 工具 | `listFileSnapshots`（**只剩死导入**） | 无 | **保留最近 20**（`MAX_FILE_SNAPSHOTS`） |
| 行为基线 | `<project_dir>/.agent-io/behavior/<file>__<func>.json` | `analysis/behavior/index.ts` `captureBaseline` | `verifyBaseline`（**只剩死导入**） | 无 | 无 TTL |
| 健康缓存 | **`<cwd>/.agent-io/cache/health`** | `analysis/health_cache.ts:27` | 同 | 无 | mtime 指纹 |
| dogfood 统计 | `<dataHome>/.agent-io/dogfood/usage.jsonl` | `infrastructure/dogfood_stats.ts` | `npm run dogfood`（**陈旧 dist**） | — | 无 |
| 设计 DSL 仓（Go 权威） | `<proj>/.agent/observe/{dsl.json,dsl.history.jsonl,proposals/}` | **Go CLI `observe-dsl`**（TS 不写） | `daemon.ts:216-217` | 无 | `dsl.json` 覆盖写；`history` append-only |
| 运行时 sink 事件 | `<projectRoot>/.agent-io/observe/events.jsonl` | `index/watch_project_tool.ts:348` | `daemon.ts:218` → Go loop | 无 | append-only；**无生产清理 ⇒ 无限增长**；★ **全局单 sink**（`observe/probe.ts:29` 挂 `globalThis`）⇒ 多项目互污 |
| 对账读的事件 | `.agent/observe/events-*.jsonl` + 回落 `.agent-io/observe` | ★ **写这的不在仓内**（`setup.mjs` 写 `.agent/camera` ⇒ 不通） | `reconcile_effects.ts:111`、`reconcile_chain.ts:104`、`reconcile_brick.ts:113` | 无（报"未发现事件文件"） | append-only |
| 录制事件（observe_trace） | `DS_OBSERVE_EVENTS` > `tmpdir/dsh_events.jsonl` > `cwd/runs.jsonl` | 外部 DSH / Go `observev2-record` | `observe_trace.ts:41-47`、`trace_evidence.ts:125`（L4） | **抛错**（提示先录一发） | append-only | 
| 探针台账 | `<被插桩根>/.agent-io/observe-ledger.json` | `instrument.ts:262` | **只有 CLI `--ledger`** | 无 | 覆盖写；uninstrument 删 |
| 观测点清单 | `<project_dir>/.agent-io/observe-points.json` | `observe_points.ts:431` | **无 in-repo reader** | 无 | 覆盖写 |

> `fail-fast 口径`：`.agent-io` 字面量在**代码里**只有少数几处（`instrument.ts:148,151`、
> `reconcile_*.ts:104/111/113` 的 `dirRel`、`protect.ts:46,67` 的 `.agent-io.json`）；
> 136 行命中里绝大多数是**注释/描述**。⇒ **"字面量被抄多份"不是主要问题**，
> **"接到哪个根"才是**（见结论一/二）。

---

## 抽验记录（我改正子代理的 3 处）

| 子代理结论 | 抽验结果 |
|---|---|
| `hasChanges` 「定义后零调用、死导出」 | ⚠️ **要更正**：`tests/tools/index_freshness.test.ts:114,129,170,189` 在用 ⇒ 准确是「**生产零调用、仅测试在用**」 |
| 事件路径「三重分裂、三者互不重叠」 | ⚠️ **要更正**：`watch_project_tool.ts:340` 写的 `.agent-io/observe/events.jsonl` **落在对账的回落目录里 ⇒ 能被发现**。准确是「**两处写端：一处通、一处断**」 |
| `package.json` dogfood「指向已不存在」 | ⚠️ **要更正**：`dist/src/tools/dogfood_stats.js` **还存在**（陈旧构建产物）⇒ **静默跑旧码**，比"断"更坏 |
| `project_metadata` 死表 / `import_cache_` 同名两根 / `serve.ts:222` 绕过 accessor / `env 名不一致` / `setup.mjs 仍写 camera` / 5 个死导入 | ✅ **逐条坐实** |

## 下一步（对应 docs/todo.md）

1. **定"根"**：一份数据只属于一个根 —— 这是本表暴露的头号问题，也是用户"每项目一份"模型的落地前提。
2. 修两处**功能级断裂**（`setup.mjs` 的 camera→observe；env 名统一/桥接）。
3. `import_cache_` 的同名两根合一。
4. 加一扇**"根的选择"门**（不是"字面量门" —— 实测字面量已单点）。

---

# 附：**工序模型（Stage）** —— 把账本变成"缺了就往上溯源"的链

> 用户原话（2026-10-01）：「有很多**单向的单写或者单读者**功能被重复实现了…
> 你就只需要**剔除**，并且**抽**，就是**抽出来这一部分功能，把它作为真正的接口**。…
> 只要**每一项数据的这个形成是正确的**就行了。比如最开始最基础就是 **DSL 的解析**，解析之后我们要实时的
> **盯 TTL**，把解析数据**存档**起来；然后每一个功能要怎么样，就**在它上面加一步、再加一步、再加一步**；
> 最后我们只需要把这里面产生的数据**转发出来**即可。**这个数据没有，就往上面去溯源上一级的加工工序**，再往上这样溯源。」
>
> ★ 这也是**对我 §19 那次"抽接口"的纠正**：我当时把"接口"理解成"抽 [B] 纯函数"，于是得出"实测无事可做 ⇒ 撤销"。
> **抽错了对象**。要抽的是**每一份数据的加工工序**（上面那句话里的"加一步"）。

## 形状（一句话：每份数据 = 一道工序）

```ts
interface Stage<T> {
  id: string;                    // 数据项 id —— ★ 就是本账本表格里的"数据项"那一列
  owner: 'project' | 'dataHome' | 'userHome';   // ★ 属于哪个根（**唯一**；对应 T19 的"定根"）
  inputs: string[];              // 上游数据项 id（★ 溯源图；空数组 = 源工序）
  fresh(ctx): boolean;           // 新鲜判据（TTL / mtime / 内容指纹 / schema 版本）
  produce(ctx): Promise<T>;      // 加工（**唯一产者**）
}
```

读取 = `ensureStage(id)`：

```
ensureStage(id):
  if fresh(id) return read(id)          // 有且新鲜 ⇒ 直接用
  for up of inputs(id): ensureStage(up) // ★ 缺了就往上溯源上一级加工工序
  produce(id)                            // 本道工序加工并落盘
```

⇒ 这正是用户那句「**数据没有，就往上面去溯源上一级的加工工序，再往上溯源**」，
而且**仓里已经有一道工序天然长这样**：`ensureProjectIndex → ensureFreshIndex → syncFile`
（`source_files` 变 → 重解析 → 写 `symbol_index`）。所以**不是发明新机制，而是把已有的这一道推广到每一份数据**。

## 工序清单

> ### ★★ 2026-10-01：**本节那张手抄表已删** —— 它是第二份副本
> 唯一数据源 = **`src/application/stage_registry.ts` 的 `STAGES`**（一张 typed 表）。
> 要读表 ⇒ 调 `renderStageTable()`（**它就是本节的渲染器**，不再手抄）；要改 ⇒ 改代码，编译器会管。
>
> ★ 为什么删：本仓反复栽在"同一份知识两处落点"（§2b 判据分叉）。手抄表在**当天下午就已经过期**了
> （它还把 `health_cache` 的根写成 `<cwd>`、把 `import_cache` 写成"两个根"—— 那些**当天上午就修了**）。
> ★★ 判据：**文档里"手抄一份机器可读的表"，等于给自己造一个必然腐烂的副本。**

## 剔除清单（"重复实现"与"孤儿"）

| 项 | 判定 | 处置 |
|---|---|---|
| `dsl_features` / `<dataHome>/agent-io.json` / `dsl_live` **三份同内容** | 重复 | **归一**：`dsl_features` 为源，`dsl_live` 为派生（带 TTL）；`agent-io.json` 这个"全局单文件"淘汰 |
| `import_cache_<feature>.db` **两处根** | 重复 | **归一**到 `owner: project` |
| `health_cache` 用 `cwd` | 根错 | 改为 `owner: project` |
| `observe_ledger` / `observe_points` / `dogfood`(MCP 侧) | **只写不读** | 要么删，要么接一个消费者（按"每份数据必须有人消"） |
| `project_metadata` 表 / `getArchiveEntry` / `deleteDSL` / 5 个死导入 | 死物 | ✅ **本笔已剔** |

## 落地顺序（一笔一刀）

1. ✅ **剔死物**（本笔）：`project_metadata` 表、`getArchiveEntry`、`deleteDSL`、`server_registry` 5 个死导入、
   `package.json` dogfood 脚本路径（**它指向陈旧 dist ⇒ 静默跑旧码**）。
2. **归一 DSL 三份**（用户点名的第一条：解析 → 盯 TTL → 存档）。
3. **归一 `import_cache` 两根** + `health_cache` 改根。
4. **抽第一道真工序并接上溯源**：让 `dsl_baseline` / `dsl_live` 的**读者**在缺时自动 `ensureStage`
   （现在只有写侧单点补，读侧拿到 null/404 就完事）。
5. ✅ **已落**（2026-10-01，§44.26）：给 `Stage` 表加了一扇门 —— **每份数据必须声明 `owner` + `inputs` + `fresh`**，
   而且 `owner` 是**可证伪**的（拿两个不同的根跑它的解析器，结果必须不同）⇒ 这才是 T19 说的"根的选择"门。
   登记表 `tests/fixtures/stage_registry.json`（15 道工序）+ 门 `tests/registry/root_declaration.test.ts`。

---

# 附二：**两份数据与"绑定点"** —— 用户提议的评估（2026-10-01）

> 用户提议：「是否需要**同时配备两份数据**？一份是 **DSL 的数据**，一份是**同步的那个整个的 tree-sitter 解析的数据**…
> **有些工具需要精确数据就直接读解析出来的原数据**；**不需要精确、只要了解大概，就给它 DSL 的数据**。
> 然后**两份数据是双向绑定的**，是否这样会更好？」
> ★ 并更正我上一轮的误读：他一开始说的「**区set / QSET**」指的是 **那份解析数据**（我一直当成了 DSL）。

## 结论：**方向对，而且大部分已经在跑了**；但"双向绑定"要改一个说法

### ① 两份数据已在，且**已经可以按精度分级消费**
| 数据 | 层 | 消费者举例 |
|---|---|---|
| `cache.db`（`nodes/edges/files/imports`，源自 tree-sitter） | **事实（精确）** | `find_references` / `diff_impact` / `function_outline` / `analyze_monolith` / `observe_points` … |
| DSL（`semantic.files[]` 等） | **意图（大概）** | `query_feature` / `diff_views` / `detect_drift` / `consistency_check` |

⇒ 你说的"按需选精度"**不是要新做的东西，是现状**。

### ② ★★ 绑定点**已经在"文件"这一层** —— 而且比"两份平等数据互相绑"更准
`semantic.files[]` 的同一条目里**同时放两侧**：
- **意图**：`expected_apis`（人/LLM 写；`sync_contracts` 用注册表回填签名）
- **事实**：`actual_apis`（由 `scaffold action=backfill` **从解析回填**）、`actual_deps`（`import_project.ts:1277` 回填**真实 import 事实**）

⇒ 绑定点 = **文件路径**（`semantic.files[].path` ⟷ `cache.db.files.path`），
**配对方式 = 同一条目里 expected/actual 并存**；`detect_drift` 比的正是这一对。

### ③ 所以"双向绑定"应改成：**方向明确的双向派生 + 对账**（写权限不能是双向的）
| 方向 | 谁 | 说明 |
|---|---|---|
| 代码 → DSL | `import_project`（生成）、`scaffold action=backfill`（回填 `actual_apis`）、`sync_contracts`（回填签名） | **派生/回填** |
| DSL → 代码 | `scaffold action=generate` | **生成**（产物应标"生成物"） |
| 对账（**不写**） | `detect_drift` / `consistency_check` | 只报漂移 |

★ 纪律：**任一时刻都要能回答"这条事实的权威在哪边"** —— 意图侧权威在 DSL，事实侧权威在解析。
若允许"任一边都能改另一边"，就是本仓头号病根（**判据分叉**）：同一条事实两处可写 ⇒ 必然漂移。

### ④ ★ 真正缺的是**符号级绑定点**
现在只到**文件级**（`semantic.files[].path`）。符号级**没有稳定键**：
DSL 侧是 `expected_apis[].signature`（**文本**），解析侧是 `nodes.qualified_name`（**模块级裸名 / `Class.method`**）
⇒ 只能按名字/文本**近似**匹配。
★ 这与 ④ 里发现的「**本仓符号身份 = (file, name)，不是全局唯一 id**」是**同一个根问题**。
⇒ **要补的是"符号级稳定键"**，不是再加一层数据。

## ★ 更正：撤回"DSL 三份重复"（我上一轮的过度指控）
读过 `storage.ts` 后确认，那三份**不是重复，是三种语义**：
| 文件 | 语义 |
|---|---|
| `<dataHome>/agent-io.json`（`getLiveDslFile`） | **活态**：当前正在编辑的那个 feature（`getDSL` 用 `feature ===` **严格比对**才用） |
| `<dataHome>/.agent-io/features/<f>.json` | **存档** |
| `<dataHome>/.agent-io/live/<f>.dsl.json` | **代码现状快照**（只读；供"设计 vs 代码"对比） |
⇒ 由 `getDSLByView(feature, 'design'|'live')` 的**视图分层**承载。
★ 因此原计划 **(2) 归一 DSL 三份 —— 撤回**；留下的**小问题**只是：`agent-io.json` 是**全局单文件**
（多 feature 时只能装"最后编辑的那个"）。
★ 这是本笔**第二次**因"只看名字/只看调用面"而过度指控"重复"（第一次是 `.agent-io` 字面量）。
  **规律：指控"重复"之前，必须读两侧的语义（视图/生命周期），不能只看"内容像"。**

---

# 附三：**意图 vs 事实** —— "意图册里有一项本来就是代码的权威"（用户 2026-10-01 指出）

> 用户原话：「**意图册有三项东西，但是有一项东西其实本身就是代码的权威吧**。
> 然后…**主要是编辑人都是同一个**，他当然知道自己编辑的是哪一份了。
> **你只需要在他编辑的时候，让他强制读完双编**不就可以了吗？」

## ① 三项的定性（取证）

| 项 | 权威在**哪边** | 现在**存在哪** | 谁写 |
|---|---|---|---|
| `semantic.files[].expected_apis` | ★ **意图**（人/LLM） | DSL | `sync_contracts`（回填**签名**）/ `edit_dsl` |
| `semantic.files[].actual_apis` | ★★ **代码**（tree-sitter 解析） | **DSL（镜像！）** | `scaffold action=backfill`（`backfill.ts:287`） |
| `semantic.files[].actual_deps` | ★★ **代码** | **DSL（镜像！）** | `import_project`（`import_project.ts:1856`，注释自陈"**语义层持有真实 import 事实**"） |

⇒ **你说对了**：三项里有**两项**（`actual_*`）**本来就是代码的权威**，却被**镜像进意图册**。
而**镜像 = 第二份可写副本 = 判据分叉的温床**（本仓头号病根）。

## ② 好消息：对账**不依赖**镜像
`detect_drift` 跑的是 `checkConsistency` **直接对代码**（`detect_drift.ts:8`："expected_apis vs 实际代码"）
⇒ **摘掉镜像不会伤对账** ✓

## ③ 镜像的读者（= 迁移清单，摘字段前必须先改它们）

| 读者 | 位置 | 读它做什么 |
|---|---|---|
| `derive_mind_map` | `:122,123,2112,2125` | mind map 的 `apis` / `actual_deps`（★ 已写 `actual_apis ?? expected_apis` **降级**） |
| `overview` | `:204` | 摘要里的 API 签名材料 |
| `query_feature` | `:563,581,615,618` | 查询返回的 `actualCount` 与清单 |
| `opl` | `:322,407` | raw view 与渲染文案 |
| `archify_semantics` | `:92` | 用 `actual_deps` 建**真实 import 边** |

⇒ 它们改读**解析数据**（`cache.db`）即可 —— 那本来就是事实的所在地。

## ④ ★★ 一个漂亮的推论：**`scaffold action=backfill` 整个存在意义 = 维护这份镜像**
`backfill` 的职责就是"LLM 写完代码后，解析实现文件把签名回填到 DSL 的 `actual_apis`"（`design/index.ts:213`）
—— **镜像去掉，它就没有存在意义了** ⇒ 按"无下游不做兼容层、不留墓碑"⇒ **应剔除**。
★ 这正是你说的「**剔除**」：不是把镜像改名，是**把它和它的产者一起拿掉**。

## ⑤ ★★ 一致性怎么保证：靠**编辑时强制读双份**，不靠"双向同步"
你的判断：**编辑人是同一个，他知道自己改的是哪一份** ⇒ 不需要同步机制。
⇒ **一致性 = 一个"先读后改"的门**：
- 本仓**已有同款**：`explore_code action=read` 是 `edit_code` 的"**先读后改**"前置（`explore_code.ts:312`）；
- ⇒ 给 **`edit_dsl` 也加同款前置**：改 `semantic.files` 前**必须已读该文件的事实**（从解析数据现取）。
★ 这样**没有任何"两份数据要同步"的状态**：意图权威在 DSL、事实权威在解析，
  **编辑者每次都在看到事实的前提下写意图** ⇒ **漂移在入口就被挡住**（而不是事后靠 `detect_drift` 发现）。

## ⑥ 施工顺序（**不能反**）
1. **先改读者**（5 处读镜像 → 改读解析数据）——否则摘字段后它们读空；
2. **再摘字段**（`actual_apis` / `actual_deps` 从 `domain/semantic.ts` 与 DSL schema 移除）；
3. **最后删产者**（`scaffold action=backfill`；`import_project` 里回填 `actual_deps` 的那段）；
4. **加 `edit_dsl` 的"先读后改"门**（与 `edit_code` 同款；复用 `evidence`/L4 那条机制而不是另发明）。

---

# 附四：**独立核验**（子代理清点 vs 我的抽验）—— 2026-10-01

### 为什么要做这一步

新建的「根声明门」自己声明了**限度一**：*登记表要人写，门能查"写了的是不是真的"，**查不了"有没有漏写的"***。
⇒ 那就**不能只写在纸上承认** —— 派了一个**独立子代理**（不给它看本账本、也不给它看登记表）
从 `src/` 源码自己清点一遍"落盘数据 + 根归属"。

### 结论：限度一**不是理论**，是实测

它清出 **≈18 项我没有登记**的数据，以及 **3 处"同一份数据两个根"**（其中 1 处是**真 bug**）。
★ 这正面说明：**一扇门只保护它册上的东西**。

### 我逐条抽验的结果（★ 不许只信子代理的总结）

| # | 子代理的指控 | 我的抽验 | 处置 |
|---|---|---|---|
| ① | `features/<f>.json` **写 dataHome、读 cwd** | ✅ **坐实（真 bug）**：写 = `storage.ts:71 getFeaturesDir()` → `<dataHome>`；读 = `serve.ts:222` → `process.cwd()/.agent-io/features`。与结论二**同型**（`cwd ≠ 包根` ⇒ `/api/features` 永远空）。★ 且 `getFeaturesDir()` 的**注释自己写的是 `<cwd>`**（与实现不符）—— 错注释本身就是一种判据分叉。 | **已修**：读侧改走同一个 accessor `getFeaturesDir()`；注释一并更正 |
| ② | `live/<f>.dsl.json` / `baseline/<f>.dsl.json` **两个根** | ✅ **坐实**：`watch_project_tool.ts:430` 显式传 `live_dir: entry.project_dir` ⇒ 落**被监听项目的根**；其余调用点不传 ⇒ 落 `dataHome`；`getLiveFeature(feature)` 读时也不传。★ 但 `live_dir` 是**有意留的可覆盖参数**（`design/index.ts:290` 的 schema 就写着"默认 dataHome"）⇒ 风险不在参数，在**没有任何一处保证写读两侧传同一个值**。 | **入册为 `rootConflict`**（不再是散的散文） |
| ③ | `archive/<f>/<id>.json` 写读不对称 | ✅ **坐实**：`archive_node.ts:73` **写时根本不传 baseDir**（永远 dataHome），`:146` **读时接受 `live_dir`** ⇒ 传了 `live_dir` 的读方**永远读不到**。且工具描述（`meta/index.ts:92`）写的是"条目住在 `<live_dir>/…`"—— **文档与实现不一致**。 | **入册为 `rootConflict`** |
| ④ | `cache.db` 的三个根（`getDbFile` dataHome / `projectCacheDbPath` project / `findCacheDb` 第三级 cwd） | ✅ 与我 §44.25 的结论一致；第三级 `cwd` 兜底**目前不动**（改它要连"没索引的项目该不该读到 cwd 那个项目的库"一起定） | 已在 §44.25「遗留」记着 |
| ⑤ | 其余约 15 项（`output/*.js` 构建产物、`bricks/`、`overlay`、`snapshots/`、一族摘要缓存、`config.json` userHome、`heap-*.heapsnapshot` 只写不读…） | ⚠️ **未逐条抽验**（时间与范围所限）—— **如实标注，不当事实用** | 进登记表的 **`notRegisteredYet` 清单**（带证据、**棘轮只许减**） |

### 这一笔对「账本」自己的更正

- **结论二有两处同型兄弟**，不止 `import_cache_` 一处：`features/`（①）与 `archive/`（③）。
  ① 已修；③ 已入册。⇒ ★ **教训：查"写读不碰面"不能只查当时发现的那一处 —— 要按"同一个 accessor 有没有被绕开"横扫。**
- 本账本**主表/工序表**仍少列了 ①③ 这两项（已由登记表接管，见摊开的 `notRegisteredYet`）。

### 对「门」的加固（本笔已落）

1. 登记表 15 → **18 道工序**（补 `self_writes` / `impact_ledger` / `output_registry`）。
2. 新增 **`rootConflict`** 字段 + **棘轮**（当前 3 条：`dsl_live` / `dsl_baseline` / `archive`）
   —— 根冲突**没法用 `owner` 单值表达**（它本来就是两个根），所以必须**可计数**；写进散文里没人会看见。
3. 新增 **`notRegisteredYet`** 清单 + **棘轮**（当前 18 条）—— 把"漏写"从**暗处**搬到**明处并计数**。

---

# 附五：**删兜底**（用户一句「越兜越多」）—— 2026-10-01

### 用户的那句话

我在汇报完"给『根』加门"之后，用户只回了四个字：**「越兜越多。」**

★ 这是**对着我自己的做法**说的，而且说对了。我在那两笔里干了三件"越兜越多"的事：
1. 把 `findCacheDb` 的**三级候选链固化成"权威"**，还配了一扇门去**保它** —— 把兜底提升成了受保护的设计；
2. `health_cache` 的兜底我**只是从函数里搬到调用点**（`?? process.cwd()`），还把它叫"显式"；
3. 又加了 `notRegisteredYet` —— 一张"**没登记的先记着**"的清单。**那就是新兜底。**

### 机制：兜底是「没有生产者」的代偿

```
数据没有 ⇒ 加一层兜底（没给 project_dir 就用 cwd）
        ⇒ "反正总有一个能用" ⇒ 没人去保证【正确的那个】存在
        ⇒ 缺数据不再是问题，是常态 ⇒ 下一个人再加一层
```
★ **兜底会自我繁殖。** 而只要有了"缺了就往上溯源加工"的链（T19 第 (4) 步的 `ensureStage`），
兜底就能删 —— 因为**缺**变成一个**能被补上**的状态，而不是一个**要蒙混过去**的状态。
★★ **响亮是接上溯源的前提**：只有"缺"得响亮，才知道该补**哪一道工序**。

### 判据：三类分，**不按"有没有 `??`"分**

| 形态 | 性质 | 处置 |
|---|---|---|
| `baseDir ?? getDataHome()`（3 处：live/baseline/archive） | **默认值** —— dataHome 是这份数据的**合法归属**，同一件事 | **留**（代码里已注明"这是默认值不是兜底"） |
| `input.source_root ?? input.project_dir`（`query_feature` 3 处等） | **两个来源、一个语义** —— 都是"被分析项目的根" | **留** |
| `dsl.source_root ?? process.cwd()`（**11 处**） | ★★★ **换题** —— cwd 与被分析项目**没有任何关系** | **删** |

★★★ **一句话**：**`?? process.cwd()` 不是"退而求其次"，是"答错了还装作答对了"。**
cwd 和目标项目**没有强弱关系** —— 它们是**两个不同的项目的根**。所以这不是降级，是**换题**。

### 逐点的处置（11 处全部删掉，**没有一处改成另一个兜底**）

| 位置 | 这件事的性质 | 处置 |
|---|---|---|
| `arch_layer.ts` 体检缓存 ×2 | **可选工序**（缓存） | **跳过**：没根就不读也不写缓存（本模块本来就把 source_root 当可选，`srcFp` 那行就是 `? … : 'noscan'`） |
| `monolith.ts` 体检缓存 ×2 | **可选工序**（`project_dir` 在 files 模式下**本来就可选**） | **跳过**：不读缓存，且把 `cacheKey` 置 null 免得写侧拿 undefined 去写 |
| `monolith.ts` `baseDir` | **必须有**（要读源文件） | **抛** |
| `overview.ts` ×2 | deriveFeatureTree / 签名材料 | **放弃**（前者保持"静默失败＝保持平铺"的契约；后者是可选增强） |
| `handlers.ts` / `design/index.ts` | **必须有**（被当作项目根用） | **抛** |
| `serve.ts` ×2 | HTTP 入口 | **400 + 说清缺什么**（不要 500 栈，也不要静默用错值） |
| `db.ts#findCacheDb` 第三级 `<cwd>` | 换题 | **删**（两级就是两级，都没有 ⇒ 响亮返回 null） |

★★ 顺手把区分钉进代码：`storage.ts` 那 3 处 `baseDir ?? getDataHome()` 各加了一行注释
「这是**默认值**、不是兜底；而 `?? process.cwd()` 是**换题**」——
否则下一个人会把"默认值"当兜底一起清掉，或者**照着加更多 cwd 兜底**（因为他看不出差别）。

### 方法：编译器当量具 + 测试失败是**证据**

- **11 处改动 ⇒ `tsc` 精确报出 11 处缺 import**，一处不多一处不少。**grep 列不出"我漏了什么"，编译器能。**
- ★★ 删完之后 **4 条测试红了**（`monolith` ×3 + G8 行为快照 ×1）。**这不是障碍，是证据：**
  - `monolith` ×3：它们**根本没传 `project_dir`**，靠 cwd 兜到了测试进程自己的目录
    ⇒ 相当于在验证一个**可选缓存**是否命中 —— 而"没有根"本来就该跳过。
  - ★★★ **G8 行为快照**：那条基线里的 `feature_line` 输出，是工具**通过 cwd 兜底读到了本仓自己的
    `.agent-io/cache.db`**（32MB，确实存在）后产生的 —— 即 **G8 把"读到别的项目的索引"这个 bug
    录成了"不退化"的基准**。删掉 cwd 候选后它如实报"未找到函数索引"。
    ⇒ **这不是回归，是基线在替 bug 作证。** 处置：按 G8 自己的规程 `UPDATE_TOOL_BEHAVIOR=1` 更新基线
    （diff 恰好只动 `feature_line` 一条），并**记账**（见 §44.28）。

### 验证

`tsc` 0 ｜ `arch` 312 modules / 0 违规 ｜ 全量 `test:main` **234 文件通过 / 1 跳过 ｜ 2427 项通过 / 5 跳过 ｜ 0 失败**。

### 仍未做

- 本笔**只删了 11 处 `?? process.cwd()`**。`notRegisteredYet` 里那 18 项**仍在**（它也是兜底的一种），
  以及 `archive` 写侧不传 baseDir 那个实现问题。
- ★ **删兜底 ≠ 收口**：现在"缺"是响亮的，但**还没有人去补**。真正收口是 T19 第 (4) 步
  （抽第一道真工序 + 接上溯源）——**本笔只是把"蒙混"换成了"响亮"，让第 (4) 步有据可依。**
