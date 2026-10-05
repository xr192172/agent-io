# agent-io 目录归位与数据流转 逐文件扫描报告

> **日期** 2026-10-05 ｜ **依据** `git ls-files` 500 个受管文件全量清点 + 三个只读子代理逐文件枚举 + 主线程逐条复核
> **口径** 不读文档、不看 README，只看"文件在哪、谁 import 谁、数据落在哪"

---

## 一、两条总判

**分门别类：依赖方向干净，位置有硬伤。**
四层（domain / application / infrastructure / presentation）在**依赖方向上实测是干净的**——`application → presentation` 的 import 全仓 **0 条**；`infrastructure → application/presentation` **1 条**，且是 `import type`（`graph/dead_deps.ts:38`）。318 个 src 文件没有一个漂在层根。**这比多数项目干净。**

但"这个文件该不该在这"有三处硬伤（§2.1 / §2.2 / §2.3），代价都落在同一条判据上：**你要找某个东西，得先猜它属于哪个域。**

**数据传递：单点收口的意图很好，落实漏了 4 个文件 + 1 个缺淘汰的缓存 + 3 类没挂表的数据。**
`DATA_DIR_NAME`（目录名唯一真相）、`stage_registry.STAGES`（中间数据唯一落点）、`b_terms.ts`（字段名唯一真相）—— **三张单点表都建立了，而且 STAGES 对"哪 7 个工序还没有产者"写得极其诚实**。但：`.agent` 与 `.agent-io` 两套目录名同时存在于运行中的代码里；体检缓存 2014 个文件零淘汰；规则库/棘轮/词典三类落盘数据完全不在 STAGES 里。

---

## 二、分门别类

### 2.0 做得对的地方（有证据）

| 事实 | 核实方式 |
|---|---|
| `application → presentation` import = **0 条** | 104 个文件全量扫 import |
| `infrastructure → 上层` = **1 条**且是 `import type` | `graph/dead_deps.ts:38`（`ExternalDep`） |
| `code_health` 报"0 分层违规 / 0 循环依赖"**没说谎** | 逐条复核后确认 |
| `infrastructure/` 根级 12 个文件全是真·横切设施 | `storage` / `git` / `llm_focus` / `alert_inbox` / `data_dir` / `exec_guard` / `dictionary` / `verify_refactor` / `project_view` / `scan_bounds` / `storage_overlay` / `dogfood_stats` |
| `domain/` 15 个文件**零 I/O、零 infrastructure 依赖** | 真·领域层：纯类型 + 纯函数 + 两张受控表（`b_terms` / `chain_wiring`） |
| `third_party/archify` 与 `src/**` **零 import 耦合** | 只通过 `spawnSync` 调 CLI（`cli/archify_cli.ts:57`） |

---

### 2.1 ★★★ `infrastructure/analysis/` 是筐，不是"分析"（109/162 = 67%）

17 个子目录里，**至少 4 个是产品功能，不是分析**：

| 子目录 | 规模 | 实质 |
|---|---|---|
| `analysis/translate/` | 14 文件 / 2672 行 | Go→TS 翻译，**一个完整的用户可见能力**（有自己的 tool.ts / fill.ts / llm.ts / project.ts / verify_behavior.ts） |
| `analysis/version_upgrade/` | 14 文件 / 1107 行 | 升级门（静态门 / 动态门 / 6 语言适配器表） |
| `analysis/refactor/` | 7 文件 / 372 行 | 重构管线的**执行器注册表**（TS/Go/Python/Java 各自一套） |
| `analysis/behavior/` | 1 文件 / 1054 行 | 起子进程跑 6 种语言的 harness |

真·分析（`health` / `impact` / `structure` / `diagnosis` / `deadcode` / `contract_gate` / `cross_repo` / `capability`）只占一半。

**代价**：一个 agent 想找"Go 翻译怎么实现的"，会去 `analysis/` 下面翻半天。这直接违反本仓自己的判据——"**一眼能看出现在是什么层级、应该去哪个位置找另一个层级**"。

---

### 2.2 ★★★ `application/handlers.ts`：6 个 lane 的共同枢纽 + 目录级环 + 放错了层

**事实链**：
- 5 个 lane 的 `index.ts` 全部 `import '../handlers.js'`：`design:50` / `harvest:35` / `meta:58` / `observe:40` / `refactor:56`
- `handlers.ts` 反向 import：`design/`（4 处）、`meta/`（4 处）、`observe/`（5 处）、`harvest/`（1 处）、`refactor/`（1 处）

⇒ `application/design/` **既是提供方又是消费方**。文件级无环（`code_health` 报 0 是对的），**但目录级有环**，而目录才是人导航的单位。

**更本质的错位**：19 个 `*Handler` 干的事是"从 args 取值 + `requireStr` 守卫 + `wrapData` 包壳 + 拼中文错误文案"—— 这是**入参适配层**，和 `presentation/mcp/server_registry.ts` 是同一个角色。

⇒ **同一个角色，两个家，两种规模**：

| 面 | handler 在哪 | 规模 |
|---|---|---|
| MCP | `src/application/handlers.ts` | 19 个 handler / **533 行** / 在 **application** 层 |
| HTTP | 内联在 `src/presentation/http/serve.ts` | 44 条路由 / 194 处 `/api/` / **2964 行** / 在 presentation 层 |

一个 533 行一个 2964 行，一个在 application 一个在 presentation。**这不是"分门别类"，是"同一个东西随手放"。**

---

### 2.3 ★★ `observe/runtime/write_gate.ts`：名字和位置都在骗人

它被 **11 个文件、跨 4 个 lane** 引用：

| 引用方 | 文件数 |
|---|---|
| refactor（`rename_file` / `rename_local` / `rename_symbols` / `symbol_move` / `edit_code` / `apply_writes` / `remove_dead_imports` / `refactor_pipeline`） | 8 |
| design（`scaffold` / `code_workbench`） | 2 |
| meta（`index_integrity`） | 1 |

它是"**全项目的写盘闸门 + 索引写穿**"——每个改名、每次编辑、每条管线落盘都过它。但它住在 `observe/runtime/` 下。

⇒ 任何人问"改完文件索引怎么同步"，会先翻 `observe/`。而它的真身是**所有写操作的公共通道**。

---

### 2.4 ★★ 命名规则有两套，而且交叉

| 范围 | 规则 | 例 |
|---|---|---|
| 6 个 lane 根 | `index.ts` | `design/index.ts` 566 行 |
| infrastructure 的单文件目录 | `index.ts` | `analysis/behavior/index.ts` 1054 行、`analysis/project_root/index.ts` **1279 行** |
| infrastructure/daemon | **`client.ts`**（不叫 index） | `daemon/client.ts` 120 行 |
| application 的子域目录 | 一律 `<name>.ts` | `meta/archive/archive_node.ts`、`meta/docs/project_docs.ts`、`meta/integrity/index_integrity.ts`、`refactor/snapshot/file_snapshot.ts`、`refactor/annotate/function_annotation.ts` |
| application 的"目录名=文件名" | 混用 | `refactor/diff_views/diff_views.ts` 939 行（同名）vs `analysis/behavior/index.ts`（index） |

⇒ **分门别类做到了目录，没做到命名。** 你要找 `X` 的入口，得先知道 `X` 属于哪一套。

---

### 2.5 ★ 10 个"单文件目录"

`analysis/behavior/`、`analysis/project_root/`、`analysis/cross_repo/`、`analysis/submit_gate/`、`application/meta/archive/`、`application/meta/docs/`、`application/meta/integrity/`、`application/refactor/annotate/`、`application/refactor/snapshot/`、`application/refactor/parse_capability/`

每个只放一个文件。**多花一层路径，不多一分导航**——按本仓自己的形状判据，这一层是纯成本。

---

### 2.6 ★★★ `go-observe/`：同一件事的第二套实现（仓库级"两处落点"）

42 个 Go 文件，与 TS 版 `analysis/observe/` **同名符号至少 18 个**：

| 符号 | Go | TS |
|---|---|---|
| `baseProbeName` | `probe/chain.go:26` | `chain.ts:23` |
| `RebuildChains` | `probe/chain.go:52` | `chain.ts:50` |
| `isSubsequence` / `matchChainDecl` / `subsequencePrefixLen` | `chain.go:146/165/190` | `chain.ts:125/142/155` |
| 链预算 `512 / 4096 / 128` | `chain.go:45-47`（私有） | `chain.ts:42-44`（导出） |
| `SilentErrorDiscard` | `probe/contract.go:91` | `contract.ts:216` / `judge.ts:28` |
| `JudgeEvent` / `Verdict` | `contract.go:42/15` | `judge.ts:108/15` |
| `DeviationKind` 四态 | `comparator.go:25-28` | `contract.ts:36` |
| `DSLDecl` / `DesignDSLDoc` | `llm_judge.go:45` / `dsl_store.go:30` | `contract.ts:18/29` |

**判定规则两边各自写死字面量，不共享**：
- TS 的 `IMPACT_BLAST_RADIUS_LIMIT = 50`（`judge.ts:55`）—— **Go 侧全仓 0 命中**
- Go 的 `design:impact-known-spread`（`ledger_loader.go:164`）—— TS 侧没有
- 两边**注释互指**（"与 Go SilentErrorDiscard 语义对齐"）⇒ **语义对齐靠人工逐字比对**

**而且它不在任何自动化里**：`go-observe/go.mod` 存在，但 `package.json` 零引用、`scripts/**` 零引用 ⇒ `npm test` 不编译它、不测它。TS 侧 barrel 自己招了：`analysis/observe/index.ts:29-33` 写着 v2 分级采集的 TS 移植（704 行）"是从 go-observe 移植……**但从未接线**……死的是这份 TS 移植"。

**判断**：这不是归位问题，是"**该不该有两套**"没决断。放着不管，两边规则会各自漂移，而且**没有一条 CI 会发现**。

---

## 三、数据的传递

### 3.0 做得对的地方

| 事实 |
|---|
| `data_dir.ts` 把目录名从"193 处硬写 / 130 个文件"收成单点，方向完全正确 |
| `STAGES` 18 个工序，**4 个已接产者、7 个标 `pending` 并逐个写清"欠产者 + 为什么"** —— 这份诚实度罕见，`renderStageTable()` 可直接当文档 |
| `cache.db` + `symbol_index` 是真·现取（ts_kernel），无镜像副本 |
| `b_terms.ts` 受控词表 + `measure_b_contract.mjs` 量具配套 |

`STAGES` 的诚实样例（这就是它值得抄的地方）：

```
| embedding_cache | pending | ★ 欠产者：产者是语义搜索的 miss 路径（边查边填）…且无 TTL、无淘汰 ⇒ 真要接，得先定失效判据。
| dsl_live        | pending | ★ 且它带 baseDir 可覆盖（watch 时会落到被监听项目的根）⇒ 接之前必须先定"写读两侧怎么保证同一个根"，否则接上就是接一个更快的分叉。
```

### 3.1 ★★★ `.agent` 与 `.agent-io` 两套目录名同时在跑

`data_dir.ts:20` 白纸黑字：

> ★ 不变量：`DATA_DIR_NAME` 是唯一真相。**任何地方再写一次这个目录名字面量就是副本**

**实测 4 处违反**：

| 位置 | 内容 |
|---|---|
| `presentation/daemon/daemon.ts:215` | `path.join(projectDir, '.agent', 'observe')` |
| `presentation/daemon/daemon.ts:218-219` | **紧接两行**用 `DATA_DIR_NAME` 拼 `observe/events.jsonl` 和 `impact/ledger.json` |
| `application/observe/reconcile/reconcile_effects.ts:114` | `for (const dirRel of ['.agent/observe', '.agent-io/observe'])` |
| `application/observe/reconcile/reconcile_chain.ts:105` | 同上同一个双元素数组 |
| `application/observe/reconcile/reconcile_effects.ts:192` | 错误文案里印着 `.agent` |

⇒ **`daemon.ts` 一个函数内两套目录名**（215 行 vs 218 行）。⇒ 两个 reconcile 工具**两个名字都试一遍**。

**而 `data_dir.ts:13-18` 恰恰写过一条相反的判据**：

> ★ **刻意不做兼容层**（2026-09-28 用户纠正）：我起初预留了 `DATA_DIR_NAME_LEGACY` + 新旧并列的跳过集合 + 回退函数……**那是为不存在的下游写脚手架**……实测那批预留**出生即死代码**（引用数全为 0）⇒ 已全部剪掉。⇒ 纪律：**没有下游就不要兼容层**

⇒ **同一条判据，两次相反的执行**。2026-09-28 在 `data_dir.ts` 剪掉兼容层（理由：没有下游）；现在 `reconcile_effects.ts:114` / `reconcile_chain.ts:105` 又长出一个双目录名兼容数组。

**这不只是风格问题。** 上一轮实测我就撞上了：我按子代理报的位置把事件文件放在 `.agent/observe/` 下，而 `probe.ts:18` 的 sink 注释明写"`<dataHome>/.agent-io/observe/events.jsonl`" —— **两个目录真的同时存在**，任何走"自动找事件路径"的逻辑只会找 `.agent-io`。

---

### 3.2 ★★★ 体检缓存 2014 个文件，零淘汰

`.agent-io/` 实测 **2933 个文件**：

| 类别 | 数量 | 占比 |
|---|---|---|
| `cache/`（全是 `cache/health/`） | **2014** | 69% |
| `code-snapshots/` | 895 | 31% |
| 其余（features/baseline/live/cache.db/drift/gateway.json/dogfood） | 24 | 1% |

`health_cache.ts` 全文只有 5 个导出：`healthCacheDir` / `fileFingerprint` / `singleFileFingerprint` / `readHealthCache` / `writeHealthCache` / `healthKey` —— **没有任何 prune / 淘汰 / 上限**。

**对照（项目知道怎么写有界缓存）**：
- `design/lifecycle/snapshot.ts` → `pruneSnapshots`
- `refactor/snapshot/file_snapshot.ts` → `pruneFileSnapshots` + `MAX_FILE_SNAPSHOTS = 20`
- 实测 `code-snapshots/` 22 个子目录 ⇒ **淘汰确实生效**

**我实测过 4 次连跑**：文件数稳定在 2014，**缓存确实命中**（不是失效）。所以问题**不是"缓存不生效"，是"没有淘汰"**：cache key 里含 `fileFingerprint`（`(rel, size, mtimeMs)` 的 sha1）⇒ 任何一次保存 / 切分支 / `git checkout` 都产生一个新 key，旧 key 的文件永久留下。

`STAGES` 里 `health_cache` 被归为 `pending`，理由是"它是各体检工具的**副产物**" ⇒ **归成副产物，就没人管它的生命周期了**。

---

### 3.3 ★★ STAGES 覆盖不到一半，且缺席的正好是"有落盘数据"的

7 个 `pending` 之外，还有**实际落在盘上、却完全不在 STAGES 里**的：

| 落盘数据 | 定义在 | STAGES 里有吗 |
|---|---|---|
| 规则库 `rules/` | `refactor/rule_library/rule_library.ts` 的 `rulesDir` | **无** |
| 棘轮基线 | 同上 `baselinePath`（`ratchetDelta` / `writeBaseline`） | **无** |
| 全局术语词典 `dict.global.json` | `infrastructure/dictionary.ts:125` | **无** |
| 项目术语词典 `dict.project.json` | `infrastructure/dictionary.ts:131` | **无** |

AGENTS 的判据是"**必须留 ⇒ 必须挂进 `STAGES`（带 owner/inputs/fresh/produce），且只留一处**"。规则库 / 棘轮 / 词典这三条**留了、也没挂**。而"棘轮"这个词本身在 AGENTS.md 里是被判过"不养"的。

---

### 3.4 ★★ 同一份文件路径被两个模块各拼一次

`impact/ledger.json`：

```
presentation/daemon/daemon.ts:219          path.join(projectDir,          DATA_DIR_NAME, 'impact', 'ledger.json')
application/meta/impact/impact_ledger_store.ts:86   path.join(path.resolve(projectRoot), DATA_DIR_NAME, 'impact', 'ledger.json')
```

一个用 `projectDir`（可能相对）、一个用 `path.resolve(...)`。**不一致就是写读分叉。**

`observe` 侧同类：
- `instrument.ts:151` → `const LEDGER_FILE = '.agent-io/observe-ledger.json'`（**相对字面量**）
- `probe.ts:276` → 自己拼 `path.join(observeDir, 'events.jsonl')`
- `daemon.ts:218` → 再拼一次

---

### 3.5 ★★★ "这是哪个项目"有 17 个文件各自猜

`process.cwd()` 在 **`application/**` 出现 17 个文件 / 30 处**：

| 文件 | 处数 | 性质 |
|---|---|---|
| `harvest/harvest_decisions.ts` | 6 | 含 2 处注释 |
| `observe/capture/observe_trace.ts` | 4 | **全是默认参数 `cwd = process.cwd()`** |
| `meta/view/derive_anim_flow.ts` | 3 | 含 2 处注释 |
| `design/intent/detect_drift.ts` | 2 | |
| `design/derive/derive_chain.ts` | 2 | |
| `refactor/find/find_references.ts` | 2 | |
| `refactor/rename/symbol_move.ts` | 2 | |
| 其余 10 个文件各 1 处 | 10 | `consistency` / `scaffold` / `derive_algorithm` / `status_tools` / `meta/index` / `memory_observe` / `trace_evidence` / `run_tests` / `rename_symbols` / `rename_files` |

`storage.ts:74-86` 已经把这条判据写清楚了：

> `xxx ?? process.cwd()` | ★★ **换题** | **删掉 ⇒ 改成本函数（硬失败）**

⇒ 判据在，**17 个文件没跟上**。上一轮已确认其中 3 处（`derive_chain` / `derive_algorithm` / `derive_anim_flow`）会真去读**另一个项目**的文件。

---

## 四、我建议的顺序（按"值不值"排，不是清单）

| # | 动作 | 依据 | 成本 |
|---|---|---|---|
| 1 | **`.agent` → `.agent-io` 收口 4 处**，删掉两个双目录名兼容数组 | §3.1，判据现成（`data_dir.ts:20`），后果最直接 | 4 行 |
| 2 | **`application/handlers.ts` 挪到 presentation，或每 lane 自带 handler** | §2.2，解开 6 个 lane 的目录级环 + 角色错位 | 中 |
| 3 | **`analysis/` 拆出 `translate/` `version_upgrade/` `behavior/`** | §2.1，67% 的 infrastructure 挤在叫"分析"的筐里 | 中 |
| 4 | **体检缓存加淘汰**（照抄 `pruneFileSnapshots` 的形状）+ rules/baseline/dict 挂进 STAGES | §3.2 + §3.3，2014 → 有界 | 小 |
| 5 | **`write_gate.ts` 换名换位**（`observe/runtime/` → 公共写通道该在的地方） | §2.3，11 处跨 4 lane 引用 | 小 |
| 6 | **`go-observe` 做一次决断**：要么明确"规则以 Go 为权威"、要么删掉 TS 侧 704 行死移植 | §2.6，两套规则各自漂移 + 零 CI | 大（是决策不是搬砖） |
| 7 | 命名二选一：域目录一律 `<dir>.ts` 或一律 `index.ts` | §2.4 | 小 |
| 8 | 10 个单文件目录拍平 | §2.5 | 小 |

---

## 五、一句话

**依赖方向是干净的（这条做得比多数项目好），位置有三处硬伤；单点收口的意图很好，落实漏了 4 个文件、1 个没淘汰的缓存、3 类没挂表的数据。**

这个仓最可贵的不是架构，是**它把自己的判据写在了出事的地方**——`data_dir.ts:20` 写"再写一次字面量就是副本"，`storage.ts:86` 写"cwd 是换题不是兜底"，`health_cache.ts:10-13` 写"用哪个根要在调用点一眼可见"，`derive_anim_flow.ts:500` 写"cwd 是另一个项目，不许兜底"。

**问题是一律的：判据在，受判据约束的代码没跟上。** 这不是缺判据，是判据没有强制力——和上一轮"zod required 服务端不强制"是同一个病：**声明式的东西不落地**。
