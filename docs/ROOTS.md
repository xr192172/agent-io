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
| **数据仓** | `<dataHome>/.agent-io` | 存在 | 只留**项目注册表** + 可重建缓存 |

`dataHome` 解析链（`storage.ts#getDataHome`）：
1. `AGENT_IO_HOME`（显式声明，部署推荐）
2. `os.homedir()` ⇒ `~/.agent-io`（Maven 的 `~/.m2` 模型）
3. 迁移期兜底：`~/.agent-io` 不存在而 `<包根>/.agent-io` 有数据 ⇒ 继续用包根 + 每进程一次告警（**不许静默换家**）

★ 现在 agent-io 自己的 `AGENT_IO_HOME` 钉在包根 ⇒ 项目根与数据仓是同一个目录。**清单会如实显示两者同路径。**

---

## 2. 角色表（10 项，标注"已接 / 未接"）

| # | 角色 | 属于哪侧 | 现状住哪 | 目标住哪 | 已接 `rootsOf` |
|---|---|---|---|---|---|
| 1 | `design` | 设计侧 | **数据仓**（按 feature） | **项目内** | ✗ |
| 2 | `judgeCache` | 设计侧 | 数据仓 | 项目内 | ✗ |
| 3 | `cache` | 实际侧 | **项目内** | 项目内 | ✅ |
| 4 | `live` | 实际侧 | **数据仓**（`baseDir ?? getDataHome()`） | **项目内** | ✗ |
| 5 | `baseline` | 实际侧 | 数据仓（同上） | 项目内 | ✗ |
| 6 | `snapshot` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 7 | `observe` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 8 | `impact` | 实际侧 | 项目内（**未核实**） | 项目内 | ✗ |
| 9 | `translate` | 翻译侧 | **不存在**（三个项目全无该目录） | 项目内 | ✗ |
| 10 | `history` | 任务系统 | 数据仓 | 项目内 `tasks.db` | ✗ |

★ **`featureCache` 已于 2026-10-26 删除**（实测三个工作区 0 个 `import_cache_*.db`，且 HTTP 面是可视化预留、没人用）
  ⇒ 角色数 **11 → 10**。取证见 §5。

★ **"未核实"= 我没读决定它位置的那段代码**，只从"目录出现在哪"推的。
  这正是今天犯过的错（用观察推规范）⇒ 实施时**先读代码再定**，别照表抄。
★ **`live`/`baseline` 的"现状住数据仓"是实证**：`getLiveDir/getBaselineDir` = `baseDir ?? getDataHome()`
  ⇒ 归属由**每次调用**决定，所以 `live/` 同时出现在数据仓和两个项目目录里。
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

---

## 4. 实施清单（按"能独立验证"排，不按重要性排）

| 步 | 动作 | 状态 |
|---|---|---|
| 1 | 索引根上溯到真项目根 + 响亮标注 | ✅ `2893f2da` |
| 2 | `code_health` 标 `noAutoFresh`（它不读 cache.db，为它建索引纯属白建） | ✅ `5f91fe2e` |
| 3 | 根偏离检测（`findStrayDataDirs` → `index_integrity`） | ✅ `f53d65ee` |
| 4 | 根清单按**三个侧**分组渲染 | ✅ 本次 |
| 5 | 建**项目注册表**（`projects.json`）+ 读入口 | ⬜ |
| 6 | `todos[]` 从 DSL 搬出 → `<proj>/.agent-io/tasks.db`（活卡+历史同库） | ⬜ **最大一次** |
| 7 | `getLiveDir/getBaselineDir/getDesignDir` 的 `baseDir` 改**必填**，调用点补 `source_root` | ⬜ |
| 8 | 聚合视图（`overview`/`query=todo` 扫注册表） | ⬜ |
| 9 | 清 8 个 stray 目录（71.7MB，`index_integrity` 已能报） | ⬜ 等尘埃落定 |
| 10 | **清过期注释**（`import_cache` / "两级候选" 仍写在 7 处）：`db.ts:152`（`findCacheDb` 的**权威 doc** 还说"两级"）、`function_outline.ts:2/10/197`、`scan_rev.ts:13/46`、`file_facts.ts:25/72`、`live_render.ts:111`、`design/index.ts:166`（工具参数描述，**用户可见**）、`serve.ts:875`、`stage_registry.ts`（声明了一个**从不产物的流水阶段** `import_cache`） | ⬜ **欠账** |

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

住 **`<dataHome>/.agent-io/projects.json`**，扁平 `feature → 项目根`：

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
| **①** | 它**必须全局唯一**（跨项目索引**不能**住任何项目里） | 它的职责就是"跨项目"。住进某个项目 ⇒ 那个项目一删全表没了 |
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
