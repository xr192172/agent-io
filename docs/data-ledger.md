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

## ★★★ 结论二：**同一份数据、两个根 → 直读直空**（硬 bug）

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

## 工序清单（从本账本导出；★ = 缺东西）

| 工序 id | 根 | 上游 | 新鲜判据 | 唯一产者 | 缺什么 |
|---|---|---|---|---|---|
| `source_files` | project | —（源） | mtime | `ProjectView` | ✅ 已是工序形状 |
| `symbol_index` | project | `source_files` | hash/mtime | `syncFile` | ✅ 已能被 `ensure*` 递归补齐 |
| `dsl_features`（DSL 解析/存档） | dataHome | —（源） | 文件 mtime | `saveDSL` | ★ 无 fresh 判据（无 TTL） |
| `dsl_live`（活态快照） | dataHome | `dsl_features` | ★ **无** | `saveLiveFeature`（**产者只有 `import_project`**） | ★★ **缺了没人补**（读者拿到 404） |
| `dsl_baseline` | dataHome | `dsl_features` | ★ 无 | `ensureBaseline`（**只有 `import_project.ts:1479` 一处调**） | ★★ 缺了只有 import_project 补 |
| `archive`（下线库） | dataHome | — | 无 | `saveArchiveEntry` | ★ 无 fresh |
| `code_snapshots` | project | — | 保留最近 20 | `snapshotBeforeWrite` | ✅ 有保留策略 |
| `behavior_baseline` | project | —（源：跑函数） | ★ 无 | `captureBaseline` | ★ 缺了 `verify` 直接 throw |
| `health_cache` | ★ **cwd** | `source_files` | mtime 指纹 | `writeHealthCache` | ★★ **唯一已经是 `miss→重算→store` 的**（形状对、**根错**） |
| `dogfood` | dataHome | — | 无 | `recordDogfoodUsage` | ★ MCP 侧无读者 |
| `observe_events` | project | —（源：探针） | 无 | `watch_project_tool.ts:348` | ★ 全局单 sink |
| `observe_ledger` | project | `observe_events` | 无 | `saveProbeLedger` | ★ MCP 只写不读 |
| `observe_points` | project | `source_files` | 无 | `recommend_observe_points` | ★ 无 reader |
| `import_cache` | ★ **两个根** | `source_files` | 无 | `serve.ts`(cwd) **/** `function_outline.ts`(包根) | ★★ 同名两根 |

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
5. 给 `Stage` 表加一扇门：**每份数据必须声明 `owner` + `inputs` + `fresh`**（这才是 T19 说的"根的选择"门）。

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
