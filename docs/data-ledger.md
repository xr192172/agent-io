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
