# 根布局规范（ROOTS）· 2026-10-26 修订版

> **模型：一个项目独立拥有三个侧。**（乙方案）
> ★ 术语更正：此前文档写的"三本册"是**语音把「侧」误识别成「册」**。正确口径是 **侧**：
> **设计侧 / 实际侧 / 翻译侧**。一个项目一份，不共享。

---

## 0. 三侧 + 一个跨项目任务系统

```
<project>/.agent-io/
├─ design/          ← 设计侧：意图（决策卡 / 期望 / 判据 / 人写的 why）
├─ live/            ← 实际侧：代码现在长什么样（由源码现算）
├─ baseline/        ← 实际侧：上一次扫描的基线
├─ cache.db         ← 实际侧：符号索引（事实，可重建）
├─ code-snapshots/  ← 实际侧：写闸快照
├─ observe/ impact/ ← 实际侧：观测与影响链
└─ translate/       ← 翻译侧：跨语言映射（Go→TS 等）
```

**任务系统不属于任何一个侧**（它是 agent 接任务的，天然跨项目）：
- 目标形态：`<project>/.agent-io/tasks.db`（活卡 + 历史**同一个库**）+ 数据仓里的**项目注册表**用于聚合
- 现状：`todos[]` 住在 DSL 里（**任务系统被塞进了设计侧**），了结的卡搬去数据仓 `task-history.db`
  ⇒ **同一个任务系统，活的一半在设计侧、死的一半在数据仓**。这是"分类不干净"的根。

---

## 1. 两个物理根

| 根 | 路径 | 现在实际 | 目标 |
|---|---|---|---|
| **项目根** | `<projectRoot>/.agent-io` | 存在（review-hub / dsh-brain 都有） | 不变 |
| **数据仓** | 见下方四候选（本仓 = `<包根>/.agentio-data`） | 存在 | 只留**项目注册表** + 可重建缓存 |

**数据仓解析链**（`storage.ts#getStorageRoot`，**唯一**；别再在别处拼 `<dataHome>/.agent-io`）：

1. `AGENT_IO_DATA_ROOT` —— 显式点明**数据仓本身**（Maven 的 `-Dmaven.repo.local`：位置随你）
2. `AGENT_IO_HOME` —— 显式点明"放着 `.agent-io` 的那个目录"（既有语义；**必须**排在 3 之前，
   否则 35 张证各自的临时 home 会被本仓的约定目录抢走）
3. `<包根>/.agentio-data` —— **存在就用**：与项目同根、**单独一级**（用户 2026-10-27 口径：
   "能不能放现在的项目本体根目录作为单独一级，同目录更好管理吧"）
4. `<dataHome>/.agent-io` —— `os.homedir()`，Maven `~/.m2` 模型（**已安装 / 无项目**场景）

`dataHome` 自身的老解析链（`getDataHome`，只在候选 4 生效）：`AGENT_IO_HOME` → `~` →
迁移期兜底（`~/.agent-io` 不存在而 `<包根>/.agent-io` 有数据 ⇒ 用包根 + 每进程一次告警）。

★ **两个根必须不同名**：`<root>/.agent-io/` 装**这个项目自己的**东西（design / live / baseline /
cache / tasks），`<root>/.agentio-data/` 装**跨项目**的东西（projects.json / judge-cache /
dogfood 日志 / 旧 task-history）。同名合并 = T-#98 之前那种"一个名字下住着两份归属"。
★ 本仓 2026-10-27 起默认走候选 3 ⇒ **跨项目数据不再落 `~`**（取证：`certs/t370-data-root-cert.mjs`）。

---

## 2. 角色表（10 项，标注"已接 / 未接"）

| # | 角色 | 属于哪侧 | 现状住哪 | 目标住哪 | 已接 `rootsOf` |
|---|---|---|---|---|---|
| 1 | `design` | 设计侧 | **数据仓**（按 feature） | **项目内** | ✗ |
| 2 | `judgeCache` | 设计侧 | 数据仓 | 项目内 | ✗ |
| 3 | `cache` | 实际侧 | **项目内** | 项目内 | ✅ |
| 4 | `live` | 实际侧 | **项目内**（T-#98：`rootPath('live', 项目根)`） | 项目内 | ✅ |
| 5 | `baseline` | 实际侧 | **项目内**（同上；`rootPath('baseline', 项目根)`） | 项目内 | ✅ |
| 6 | `snapshot` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 7 | `observe` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 8 | `impact` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 9 | `translate` | 翻译侧 | **不存在**（三个项目全无该目录） | 项目内 | ✗ |
| 10 | `history` | 任务系统 | 数据仓 | 项目内 `tasks.db` | ✗（slice 3 退场） |
| 11 | `tasks` | 任务系统 | **不存在**（卡还在册上 `todos[]`） | **项目内** `<proj>/.agent-io/tasks.db`（活卡+历史同库） | ✅ 2026-10-27（T-#368 / 步 6 slice 1：影子同步） |

★ **`featureCache` 已于 2026-10-26 删除**（实测三个工作区 0 个 `import_cache_*.db`，且 HTTP 面是可视化预留、没人用）
  ⇒ 角色数 **11 → 10**。
★ **2026-10-27 又加回一格**：`tasks`（用户拍板走**乙方案**：每项目一库 + 注册表聚合）⇒ 角色数 **10 → 11**；同日 slice 3 让 `history` 退场 ⇒ **回到 10**。
  它与 `history` 是**同一件事的两个阶段**（历史迟早并进 `tasks.db`），所以并存的这段是迁移态，不是两个角色各管一摊。

★ **"未核实"= 我没读决定它位置的那段代码**，只从"目录出现在哪"推的。
  这正是今天犯过的错（用观察推规范）⇒ 实施时**先读代码再定**，别照表抄。
★ **`live`/`baseline` 的"现状住数据仓"曾是实证**：旧 getter = `baseDir ?? getDataHome()`
  ⇒ 归属由**每次调用**决定，所以 `live/` 同时出现在数据仓和两个项目目录里。
  **2026-10-27（T-#98）已收口**：两者都只问 `rootPath(role, 项目根)`，`projectRoot` 必填（详见 §7.7）。
★ **`translate` 是"未落地"而不是"未核实"**：三个项目的 `.agent-io/translate/` 全不存在、`*translate*` 落盘文件 0 个。

★ **代码里早就记着同一个坑**（2026-10-26 发现）：`stage_registry.ts` 的 `dsl_live` 条目 `why` 写着
  「带 `baseDir` 可覆盖（watch 时会落到被监听项目的根）⇒ 接之前必须先定"写读两侧怎么保证同一个根"」——
  **这就是今天从磁盘盘点重新发现的 live 归属问题**。⇒ 记在注释里**没有生效**，还是得靠判据。


---

## 3. 裁定记录

| 日期 | 问题 | 结论 |
|---|---|---|
| 2026-10-26 | 索引（`cache.db`）住哪 | **项目内**（寄风："一点硬盘空间的代价比性能和稳定性/可扩展性比起来不算什么"） |
| 2026-10-26 | 实际侧根（`live`/`baseline`）住哪 | **项目内** |
| 2026-10-26 | 册/侧的总体模型 | **乙方案：一个项目独立拥有三个侧** |
| 2026-10-26 | `project_dir` 能不能填子目录 | **不允许**；但**不报错**——自动上溯到真项目根（`resolveProjectRoot`），已实施 |
| 2026-10-26 | 任务系统住哪 | 倾向**每项目一库 + 注册表聚合**（"聚合说明本身是解耦的"）；**待最终确认** |
| 2026-10-27 | 同上，**用户拍板** | **乙方案**：每项目 `<proj>/.agent-io/tasks.db`（活卡+历史同库），跨项目卡按 §5 自动消解 |

---

## 4. 实施清单（按"能独立验证"排，不按重要性排）

| 步 | 动作 | 状态 |
|---|---|---|
| 1 | 索引根上溯到真项目根 + 响亮标注 | ✅ `2893f2da` |
| 2 | `code_health` 标 `noAutoFresh`（它不读 cache.db，为它建索引纯属白建） | ✅ `5f91fe2e` |
| 3 | 根偏离检测（`findStrayDataDirs` → `index_integrity`） | ✅ `f53d65ee` |
| 4 | 根清单按**三个侧**分组渲染 | ✅ 本次 |
| 5 | 建**项目注册表**（`projects.json`）+ 读入口 | ✅ 2026-10-26（T-#27 读端接线 / T-#29 迁移）：写端=`import_project`→`registerFeature`，读端=`getDesignSheetFile`→`projectRootOf`；本机已有 4 条登记（agent-io / agent-io-toolface / review-hub / task-system-plan） |
| 6 | `todos[]` 从 DSL 搬出 → `<proj>/.agent-io/tasks.db`（活卡+历史同库） | 🔄 **最大一次**，分三片：slice 1 ✅ 2026-10-27（角色 `tasks` + 建库 + `syncTasksFromDsl` 影子同步 + `parityTasks` 对拍，证 `t368` PASS=9/0，**读写路径一字节未改**）· slice 2a ✅ 2026-10-27（册落盘即投影，证 `t369` 8/0，`task_ops` 一行未改）· slice 2b ✅ 2026-10-27（**读走库**：`getDesignSheet` 读出端 hydrate，`task_ops` 20+ 处读点一处未改，证 `t371` 6/0）· slice 2c ✅ 2026-10-27（**册不再写卡**：`withoutTodos` + 角色改 `derivable:false` + 文本载体 `tasks.jsonl` 进 git、`.db` 忽略；证 `t373` 8/0，`design_line` 的卡数读数改问库）· slice 3 ✅ 2026-10-27（**历史并入同库**：`task_history` 表就在 `tasks.db` 里，读写按 feature 找项目根；旧「数据仓一个大库」与 `history` 角色退场；文本载体统一 `tasks.jsonl`（live + history 两种行）；证 `t375` 7/0）——**乙方案完结** |
| 7 | `getLiveDir`/`getBaselineDir` 的根改**必填**（路径只问 `rootPath`）；`getDesignDir` **不**改必填，改由注册表解析（`getDSL` 拿不到根，见 §7.1） | ✅ T-#98 |
| 8 | 聚合视图（`overview`/`query=todo` 扫注册表） | ⬜（**设计册那一路已通**：`listDesignSheets` 改扫注册表，T-#98b） |
| 9 | 清 stray 目录（71.7MB，`index_integrity` 已能报） | 🔄 **2026-10-27 改由 watch 兼任**：`data_uniqueness.ts#ensureProjectDataUniqueness` 在 watch 的 `doWork` 里节流跑（首次 + 每 10 分钟），派生 stray 自动清、含意图数据的只报；证 `t374` 7/0。历史那 8 个目录仍待一次性人清（不自动删非本项目的东西） |
| 10 | **清过期注释**（`import_cache` / "两级候选" 仍写在 7 处） | ✅ 2026-10-27（T-#10）：`db.ts`（`findCacheDb` 的权威 doc）/ `function_outline.ts`（头注 + 缺库提示）/ `scan_rev.ts`（头注 + `@param`）/ `file_facts.ts`（头注 + 连接池说明）/ `live_render.ts`（取库那行）/ `serve.ts`（`/api/function-outline` 注释）/ `design/index.ts:166`（**用户可见**的工具参数描述）。剩下的 `import_cache` 命中**全是退场登记**（"已删/已退场/原先"），故意留。★ 另外两处**已无需再做**：`stage_registry` 的"从不产物的流水阶段"`import_cache` 早在 2026-10-26（T-#9）删掉了，本行原先把它记成待办 |

---

## 5. 三条待裁定的**判定结果**（2026-10-26，取证后）

判据：**真没用就删 —— 和结构化重写同一个道理**（不留没用的东西）。

| 问题 | 取证 | 判定 |
|---|---|---|
| **`featureCache` 还要不要？** | 三个工作区全盘扫 `import_cache_*.db` ⇒ **0 个**（agent-io / dsh-brain / review-hub 的数据仓都没有）⇒ 这条路径**从未产生过任何产物** | **该删**（唯一消费者是 `serve.ts:435/484` 两个 HTTP 调用点；正确做法是改用该 feature 的**项目索引** `<source_root>/.agent-io/cache.db`，而不是在数据仓另建一个） |
| **`translate` 侧进不进 git？** | 三个项目的 `.agent-io/translate/` **全不存在**，`*translate*` 落盘文件 **0 个** ⇒ 翻译侧**从未落过盘** | **不是"进不进 git"的问题 —— 它是规划中的侧，还没落地。** 表里应标「未落地」而非「未核实」 |
| **跨项目卡怎么表达？** | — | **自动消解**：乙方案下每个项目一个 `tasks.db`，跨项目卡**不可能存在** ⇒ 一张跨两仓的卡**拆成两张**。不需要新字段 |

★ 这三条的共性：**前两条是"规划了但没落地"，第三条是"问题在新模型下不成立"**。
  —— 都不是需要你拍板的选择题，是取证后能直接判的。

### 5.1 `featureCache` 的删除为什么还没做

它连着 **HTTP 面**（`serve.ts:435/484` 用 `openDb(featureCacheDbPath(feature))`）——
删它 = **删一个产品面**（`npm run serve` 的 feature 级缓存），要同时把这两处改成"读该 feature 的 `source_root` 项目索引"。
这不是纯代码清理，所以单独一批做，不夹在文档修订里。


---

## 6. 四条硬纪律（今天用血换的）

1. **可选参数 = 两个归属 = 迟早分叉。** `baseDir?` 这种"不给就默认 dataHome"的写法，就是 `live/` 同时出现在三处的成因。要项目内的角色，参数必须**必填**。
2. **算不出来的东西不许留空白。** 清单里算不出的角色要显式写"（需 feature）"，否则读起来像"没有这个根"。
3. **根和范围是两个概念。** `project_dir` = 哪个项目；"分析范围"是另一个参数。今天的 71.7MB stray **全部**来自"拿范围当根"。
4. **上溯必须响亮。** 自动上溯到真根时，响应里必须写 `索引根已上溯：<given> → <root>`，不许静默换根。

---

## 7. 项目注册表（`feature → 项目根`）

### 7.1 为什么必须有它（实证，2026-10-26）

```ts
export function getDSL(feature: string): DesignDSL | null     // ★ 没有 baseDir 参数
export function getDesignDir(baseDir?: string)                // ★ baseDir ?? getDataHome()
```

⇒ `getDSL(feature)` **拿不到项目根** ⇒ 只能落到 `getDataHome()` ⇒ **每个 feature 的册都住在 agent-io 的数据家里**。

实测后果：`D:/agentio/dev/review-hub/.agent-io/design` **不存在**，而 `review-hub.dsl.json` 住在
`D:/agentio/dev/agent-io/.agent-io/design/`。同一现象的更严重后果是 `design-db/` 里混进了
**4 个项目**（agent-shell 500 份 / archify 33 份 / 别的 packages 76 份），而且全部进了 git。

★ 这正是 §6.1 的实证：**可选参数 = 两个归属 = 迟早分叉。**
★ 但**只把 4 个 getter 的 `baseDir` 改成必填是无效的** —— 真锁在 `getDSL`：它不传 `baseDir`，
  所以上游怎么改都白改。而给 `getDSL` 加参数 = ~200 个调用点全部要传 ⇒ 不可接受。
⇒ **所以必须先有注册表**：`getDSL` 内部查表拿项目根，调用点一个都不用改。

### 7.2 形状（唯一一处，别再加第二份）

住 **`<数据仓>/projects.json`**（数据仓解析见 §1 四候选；本仓 = `<包根>/.agentio-data`），扁平 `feature → 项目根`：

```jsonc
{
  "version": 1,
  "features": {
    "agent-io":          { "project_root": "D:/agentio/dev/agent-io", "registered_at": "…", "registered_by": "import_project" },
    "task-system-plan":  { "project_root": "D:/agentio/dev/agent-io" },
    "agent-io-toolface": { "project_root": "D:/agentio/dev/agent-io" },
    "review-hub":        { "project_root": "D:/agentio/dev/review-hub" }
  }
}
```

**为什么是扁平 `feature → 项目根`**（不是 `项目 → features[]`）：一个 feature **只属于一个**项目根；
反过来"一个项目有多个 feature"是常态（agent-io 就有 3 个）。⇒ 扁平表是**函数**，反向表是**索引**；
函数只有一个真相，索引可以现算。

### 7.3 三条裁定

| # | 裁定 | 理由 |
|---|---|---|
| **①** | 它**必须每台机器唯一**（跨项目索引**不能**每个项目各一份） | 它的职责就是"跨项目"。**但"唯一"不等于"必须住 `~`"** —— 2026-10-27 起可住 `<包根>/.agentio-data`（§1 候选 3）：仍是同一份，只是位置随人 |
| **②** | 它**不进 git**（机器本地路径） | 路径含盘符/用户名 ⇒ 换机器即错；它是**本机登记**，不是设计 |
| **③** | **写端 = `import_project`**（唯一） | 它同时知道 `project_dir` 与 `feature` —— 唯一天然的登记时刻。别处再写 = 第二个真相 |

### 7.4 读端顺序（**不许回落 data home 当默认**）

```
getDSL(feature)
  ① 查注册表 ⇒ project_root ⇒ <root>/.agent-io/design/<feature>.dsl.json
  ② 注册表没有 ⇒ 查 <dataHome>/.agent-io/design/<feature>.dsl.json（旧位置的存量）
       命中 ⇒ 一次性自动登记 + 回执点名"已登记 <feature> → <root>"
  ③ 都没有 ⇒ 报错并提示"先 import_project"
★ ② 是迁移通道，不是兜底：它写注册表（把存量转成 ① 的常态），且每次命中都要点名。
★ 禁止：注册表没有、旧位置也没有 ⇒ 直接读 data home 当默认（那正是今天的分叉来源）。
```

### 7.5 迁移（一次性，可验证）

1. 扫 `<dataHome>/.agent-io/design/*.dsl.json`，读每份顶层 `source_root` ⇒ 写注册表
2. 按注册表把册搬到 `<project_root>/.agent-io/design/`（`git mv` 语义，保留历史）
3. `designDb` 也按同一张表落到 `<project_root>/.agent-io/design-db/`（它现在是仓根硬编码）
4. 验收：`review-hub` 的册出现在 `<review-hub>/.agent-io/design/`，且 agent-io 家只剩自己的 3 个

### 7.6 做完之后

**每个项目的册 + design-db 都在自己的 `.agent-io/` 里** ⇒ git 各自管各自的，
**不会再出现"4 个项目混一个 `design-db/`"**（今天 1057→380 那次清理正是这个病的症状）。

### 7.7 步 7 落地读数（T-#98，2026-10-27）

**改了什么**（判据仍是 §6.1「可选参数 = 两个归属」）：

| 处 | 改法 |
|---|---|
| `roots.ts#rootPath(role, projectRoot)` | 新增：目录 getter 的**唯一**实现（原先 `storage.ts` 里 3 个 getter 各拼一遍 `path.join(baseDir ?? getDataHome(), '.agent-io', …)`） |
| `getLiveDir` / `getBaselineDir` 及其文件族 | `projectRoot` **必填** ⇒ 不传是**编译错**，不是"静默落到数据家" |
| `saveBaselineFactsIfAbsent` | 删掉第 5 个可选根参数（同一函数两个根 = 头号病），只认 `sourceRoot` |
| `viewBaseDirCandidates` | 候选链末尾的 `getDataHome()` **删** ⇒ 链空 = "不知道这个 feature 的根" |
| `import_project` | 删 `live_dir` 入参（全仓一次没传过；它就是那个洞的开关），一律落 `rootPath(role, project_dir)` |
| 调用点 | `watch_project` / `stage_registry`（`dsl_baseline` 读写两侧）/ `consistency.ts` / `serve.ts#/api/live` |

**验收读数**（脚本 `.agent-io/scratch/verify-t98-roots.mjs`，隔离 home + express 真项目，PASS=12 FAIL=0）：

```
① 项目内落 live        <proj>/.agent-io/live/proj-express-t98.dsl.json
② 项目内落 baseline    <proj>/.agent-io/baseline/proj-express-t98.dsl.json
③ 项目内落 baseline 事实 <proj>/.agent-io/baseline/proj-express-t98.facts.json
④ 数据家里**没有** live 目录      ⑤ 数据家里**没有** baseline 目录
⑥⑦⑧ 往数据家塞一份旧副本 ⇒ 读端仍读到项目内那份，候选链里没有数据家
⑩⑪⑫ 陌生 feature ⇒ 链空 ⇒ 返回 null（不再拿数据家冒充）
```

**为什么 `getDesignDir` 不一起改必填**：设计侧的唯一入口是 `getDSL(feature)` —— 它**拿不到项目根**
（§7.1 的原始病历），所以设计侧的正确解是**注册表**（§7.4 ①），不是必填参数。
`<dataHome>/.agent-io/design` 只剩**迁移通道**（命中就点名 + 自动登记），不是默认落点。

**留下的两笔账**（别当它已清）：

- ~~`listDesignSheets()` 仍只扫 `<dataHome>/.agent-io/design`~~ ⇒ **已清（T-#98b）**：枚举源改成
  **注册表**（`feature → 项目根`）优先 + 数据家旧目录只作**迁移通道**（未登记的存量）；
  实测本仓由 3 份变 4 份（`review-hub` 的册终于被看见）。
- 数据家里还有 `review-hub.dsl.json`（live + baseline）等**旧落点副本** —— 现在读不到，
  属 stray，归**步 9 清理**。

---

## 8. 退场登记（**别把"计划"写成"现状"**）

### 8.1 画布三格 / 批注层（2026-10-23，整体退场）

用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」。

**三步走完了前两步，第三步从未做**：

| 步 | 内容 | 状态 |
|---|---|---|
| ① | `annotations` / `canvas_notes` / `user_nodes` 三格从 `DesignDSL` 移除 | ✅ 已做 |
| ② | HTTP 端点（`/api/annotations` · `/api/user_nodes` · `/api/canvas-notes`）删除 | ✅ 已做 |
| ③ | 建 `canvas_store.ts` 承接（`.agent-io/canvas/<f>.json`） | ❌ **从未做** |

⇒ **`src/infrastructure/canvas_store.ts` 不存在**（`src`/`dist` 里零文件），`.agent-io/canvas/` 也不存在。

**★ 曾有一段时间，`src/` 里 12 处注释（7 个文件）写着"搬去 `canvas_store`"** —— 那是把**计划**写成了**现状**。
其中 `serve.ts` 的 3 处尤其自相矛盾：**"落点改为 `canvas_store`" 紧跟一行 "端点已删除"**。
2026-10-26 全部改成一行现状 + 指向本节。

### 8.2 一句话判据

> **一个模块只有在 `src/` 里 grep 得到时，才许在注释里说"读写走它"。**

（同族的另外三次"散文当结构"：`design-check` 拿 `description` 当 path · `write_gate` 回落 `description` ·
`gen-db` 拿 `description` 当文件名 —— 都已在 2026-10-26 对齐到"`path` 优先"。）

### 8.3 `featureCache`：**已核，债已清**（原先记的"待核"是假警报）

写这一节时我怀疑：`featureCacheDbPath` 删了，而 `serve.ts` 里那两处 `openDb(...)` 没跟着改。**核完了**：

- `serve.ts:437` / `:489` 都是 **`openDb(projectCacheDbPath(...))`** —— 项目本地缓存，**正确**
- `src/` 里 `featureCache` 的 7 处命中**全是注释**（说明"已删除"），**零代码引用**

⇒ **债不存在。**

★ 教训：**"我记得有条债"也要核。** 记一条**不存在**的债，和漏一条真债一样有害 ——
前者会浪费下一个人去看，而且会让人**不再相信这份登记**。
