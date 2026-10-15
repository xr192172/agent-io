# C · 关卡 / 内容生产 —— 把"内容产不出来"当唯一的产能问题

> 视角：**关卡 / 内容生产**。游戏公司最怕的不是没玩家，是**内容产不出来**（设计了一堆关卡，没有一关能上线）。
> 玩家 = LLM；关卡 = 任务；GM = 用户；本文只谈**内容供给侧**，不谈进度系统与防作弊（见 A / B / D）。
> 纪律：报"某处有某字段"必贴原文；判不了的明说"判不了"；**不改任何既有文件**（本文是新文件）。

---

## 0. 先贴现状（读 DSL 的原文，不从实现推形状）

### 0.1 顶层形状（实测 10 份 `.agent-io/live/*.dsl.json` 的键并集）

```json
TOP:     id, type, feature, version, title, source_root, status, geometry, semantic, layers, _dsl_rev, _sync
NODE:    id, label, x, y, width, height, type, style, status, description, arch_layer
EDGE:    id, from, to, label, type, style
FILE:    id, path, responsibility, status, expected_apis, actual_apis, lines, actual_deps, layer, symbols
SEMANTIC: files          ← 只有这一个键
计数: 847 节点 / 1436 边 / 692 文件
```

`.agent-io/live/d1.dsl.json:86-113` 原文（文件项长什么样，任务要挂的东西就在这里）：
```json
"files": [{ "id": "file_src_a_ts", "path": "src/a.ts",
  "responsibility": "核心层 · src — 1 个 API（导入自 1 个模块）", "status": "done",
  "expected_apis": [{ "signature": "useA(): number", "line": 2, "end_line": 4, "notes": "L2-4" }],
  "actual_apis":   [{ "signature": "useA(): number", "line": 2, "end_line": 4, "notes": "L2-4" }],
  "lines": 4, "actual_deps": ["src/b.ts"], "layer": "core" }]
```

**三条从形状直接读出来的事实（不是推测）**：
1. ★ **DSL 里没有"任务"这种东西**：全仓 `grep -rn "\"tasks\"\|tasks?:" --include=*.ts src/` ⇒ **0 命中**；DSL 顶层 12 个键、`semantic` 只有 `files` 一个键 ⇒ **今天的形状里没有任务这个概念**。
2. ★ **1436 条边里 `requires` 出现 0 次**（逐文件统计 `edges.filter(e=>e.requires).length` 全为 0）；8 份 overlay 的 `edges` 键**全为 0 条** ⇒ 前置图今天**完全不存在**。
3. ★ **`expected_apis` 在真实大 feature 上总条数 = 0**：`self-2026-10-15` 479 文件 / 0 条、`run82` 200 文件 / 0 条；只有夹具 `d1`（2 文件 / 2 条）有。
   ⇒ 落盘读数印证：`.agent-io/drift/run82.drift.json` 逐字 `"status":"no_comparison"`、`"compared":0`。

### 0.2 差异块：块名已稳定，判据只有一处（这是本文的地基）

`src/domain/diff_blocks.ts:12-14` 原文：
> 「★★★ **块名必须稳定**：块名**只用 `formatScope` 生成**（`domain/scope.ts` 是它唯一的文法落点）。⇒ 同一片区域，今天叫 `arch_layer:service`，明天还叫 `arch_layer:service`」

`diff_blocks.ts:35-39` 原文（"什么算差异" = 唯一的 `hasDiff`）：
> `return f.retire !== undefined || f.missing + f.mismatched + f.unexpected + (f.expectation_failures ?? 0) > 0;`

`diff_blocks.ts:189` 原文（★ 这句话决定了本文的答案）：
> 「★★ 本次差异**全部来自"人写的验收"**……扫描侧对账是干净的 —— ★ 这是常态：**设计 DSL 的结构是从扫描 fork 的**，expected_apis 与代码同源 ⇒ 它那一路对出来必然一致；真正会不一样的只有**人写的意图**（决策卡上的验收）。」

调用方只有一处：`src/application/design/handlers.ts:198`
`const d = buildDiffBlocks(files, sc.scope, narrower ? 'scope' : 'arch_layer', scopeCompared);`

### 0.3 人写"料"的实测密度（这是产能的真瓶颈）

`.agent-io/features/run82.overlay.json` 实测：73 锚点（`file` 10 + `symbol` 63）· 72 张决策卡 · **带 `acceptance` 10 张** · **带 `expectations` 1 张** · 带 `lifecycle` **0** · 带 `progress` **0**。
8 份 overlay 的 `anchors` 分布：5 / 73 / 其余 6 份全 **0**；`goals` 只有 `run82` 有 9 条。
`src/domain/expectation.ts:54` 原文 —— 可写的验收只有 6 种，**全是结构事实**：
`['file-exists','symbol-exists','signature-matches','edge-exists','edge-absent','call-exists']`

---

## 1. ★ "任务"从哪来 —— 三条路径 + 哪条最便宜

| 路径 | 产出者 | 任务 id | 今天的实测产量 | 边际成本 |
|---|---|---|---|---|
| **P1 从对拍差异块自动生成** | 机器（`consistency_check{scope}` → `blocks[].region`） | `region` 逐字 | **0 条**（下面证明） | **0**：不新增存储、不新增判据、块名已稳定、纯函数 |
| **P2 从 overlay 欠账生成** | 人先登记 → 机器读（`query=pending`） | 锚点 id | **0 条**（8 份 overlay 的 `progress` 登记数实测全 0） | 1 次登记/条 |
| **P3 从退役流生成** | 人先标 `lifecycle` → 机器读 `retireFlow` | 文件 id | **0 条**（`lifecycle` 登记实测全 0） | 1 次标记/条 |

### 1.1 用户例题的直接回答：**能**从差异块自动生成任务，但**在本仓会产出 0 条**

**判据（静态可判，不用起服务）**：`hasDiff` 的五项里，`missing/mismatched/unexpected` 全部由 `expected_apis` 对账产生（`handlers.ts:171-174`：`fr.apis.filter(x => x.status === 'missing')` 等）；而 `expected_apis` 总条数实测 = 0（§0.1 第 3 条）⇒ **这三项恒为 0**。
⇒ `hasDiff ≡ (expectation_failures > 0) ∨ (retire !== undefined)`。
⇒ 而实测：`expectations` 只有 1 条（`run82`，且挂在 `tool_faces.ts` 的 `facesOf` 上）、`lifecycle` 0 条。
⇒ **推论（可判）：在 `self-2026-10-15` / `run82` 上跑 `consistency_check{scope:...}`，`blocks` 必然为空或只有那 1 条 expectations 所在文件的块。**
⇒ ★ 所以准确的说法是：**机制成立（块名稳定、判据唯一），原料为空**。

**"最便宜"的判法要给三个维度，否则是空话**：
- 按**边际成本**：**P1 最便宜，且是唯一"零新增"的一条** —— `buildDiffBlocks` 是纯函数（`diff_blocks.ts:17` 纪律 3「不读盘、不看时间」）、块名由 `formatScope` 唯一生成、"有差异"的判据只有 `hasDiff` 一处、调用方只有 `handlers.ts:198` 一处。P2/P3 都要先有人写一行字。
- 按**今天的实际产量**：**三条都是 0**，所以"最便宜"不能按产量选。
- 按**端到端可跑通**：**只有 P1 不需要人先登记任何东西**（原料 = base + 盘上的代码，都已存在）。
⇒ **结论：P1 是唯一一条"今天就能端到端跑、且一旦有人写 expectations 就立刻有内容"的管线；瓶颈不在管道，在原料。**

### 1.2 ★ 内容产不出来的**根因**（本文最重要的一句）

**不是"没做任务系统"，是"没人写 `expectations`"。**
判据：`expectations` 的 6 种 kind（`expectation.ts:54`）**全是结构事实**（文件在不在、符号在不在、签名一不一样、边在不在）——
**没有一条能表达"这一片该被重写"**。而"该被重写"恰恰是差异块的唯一合法来源（§0.2 的 `diff_blocks.ts:189`）。
⇒ 玩家拿到一块 `arch_layer:service` 的差异清单，逐条问"这条要我干什么"，答不上来 ⇒ **关卡有名字、没有内容**。
⇒ ★ **可判的最小修法（不新增存储）**：给 `expectations` 补一种 kind（`region-rewritten`，主体 = 一个 scope 行，判据 = 该 scope 内 `clean_files` 集合与基线一致）。
**判真假**：能写出一条 `region-rewritten` 并让 `hasDiff` 认它 ⇒ 有内容；写不出 ⇒ 这条设计判为**做不到**（因为"重写完了"这件事本仓**没有任何机器可读的证据面**，最接近的 `diff_views` 三方对比里也没有"意图是否兑现"这一栏 —— `diff_views.ts:14-17` 原文只有文件/符号/API/依赖/行数五类）。

---

## 2. 任务该排在哪里 —— 主张：**挂 scope（块名），一处都不挂第二处**

**主张：任务的排布单位 = 差异块的 `region`（= `formatScope` 的输出行）；任务不落新存储，只作视图。**

- **不挂节点**：节点 id 形如 `file_src_a_ts`（实测 479 个文件节点），一个块里有 N 个文件 ⇒ 挂节点 = 一件事住 N 处，正是本仓头号病（"同一件事住两处"）。且节点级**已经有**一个权威（`overlay.anchors[id].progress`），再挂一份任务 = 第二个表达。
- **不挂 feature**：`run82` 实测 9 条 `active/done` goal 并列（`g-tool-face-converge` 等），它们是方向，不是关卡；按 feature 排 = 一屏 200 个文件（实测 `run82` 200 文件 / 400 节点）。
- **挂 scope 的三个理由**：① 块名**已稳定**（`formatScope` 唯一落点）⇒ 任务 id 天生稳定，不需要新的命名纪律；② 块与文件是**多对多**（`DiffBlock.files: string[]`），scope 正好是那个多对多的天然容器；③ 它是**纯函数输出**，重跑即得，**不需要对账**（不落库的东西不会过期 —— 这是它对"账比现实旧"这道病（`replan` §1 观测 4）的根治价值）。

**★ 会不会造重复？会，而且只有一个地方会：**
- **会重复的写法**：把任务同时挂 scope（一块一个任务）**和**节点（一文件一个任务）⇒ 同一件事两个 id。
  **判据**：全仓"任务"的表达数 == 1。可机判：`grep -rn "tasks\?:" src/` 命中集合必须只有一个落点。今天命中 0 ⇒ **加的时候只能加一处**。
- **不会重复的写法**：任务 id = `region` 逐字（**不加前缀**）。判据：`region` 必含 `:`（`arch_layer:` / `files:` / `nodes:` / `subtree:`，`formatScope:113-123`），节点 id 实测一律不含 `:` ⇒ **两类 id 天然不撞**，加前缀反而多一次映射（= 多一份判据）。
- **二次生成的重复**：同一 scope 跑两次 ⇒ 同一 id 出现两次。**判据**：`buildDiffBlocks` 纪律 1「同一片区域，今天叫 X 明天还叫 X」⇒ 任务 id 逐字相同 ⇒ 按 id 去重即消。**不需要新判据**，这一条是白送的。

---

## 3. 关卡设计 —— 让"一屏任务"真的可完成

**主张：一屏 = 一个块；块太大就沿 `subtree` 下钻，绝不沿 `arch_layer` 平铺。**

### 3.1 为什么不能按 `arch_layer` 平铺（实测否决）

`self-2026-10-15` 479 个文件的 `layer` 分布：
```
arch_layer:core 381 (79.5%)   entry 32 (6.7%)   ui 28 (5.8%)   service 25 (5.2%)
api 5   data 4   types 2   utility 2          → 8 层
```
⇒ 按 `arch_layer` 切，一屏就是 **381 个文件**。这不是关卡，这是**整个游戏**。
⇒ 反过来：**7 个非 core 层合起来只覆盖 98 个文件（20.5%）** —— 按层切，**80% 的内容永远挤在一屏里**。

### 3.2 为什么 `subtree` 是能切的轴（实测支撑）

`self-2026-10-15` 有 **104 个 `module` 节点**（节点类型分布：`module` 104 / `file` 479）。沿 `contains` 边数每个子树的文件数：
```
1 个文件: 25   |  2-5: 34   |  6-10: 20   |  11-20: 10   |  21-50: 11   | >50: 4
最大的 8 个: dir_src:342  dir_src_infrastructure:177  dir_src_application:118
             dir_src_infrastructure_analysis:89  dir_certs:46  dir_scripts:42 …
```
⇒ **中位子树规模落在 2-10 个文件**（54/104）⇒ 一屏 10 个文件是**这个仓的天然尺度**，不是拍脑袋定的数。

### 3.3 分页 / 筛选 / 排序三条主张（各带判据）

| 主张 | 内容 | 判据（可复跑） |
|---|---|---|
| **分页** | **一屏 ≤ 10 个文件**；超了**必须能报下一层子块**（沿 `contains` 下钻），不许只说"还有 381 个" | 脚本量测每个块的文件数：>10 的块**必须**存在可下钻的子块候选（`subtree:<dir_id>` 逐个量），否则这个块**不许出现在一屏**。今天实测：104 个子树里 79 个 ≤10 个 ⇒ 阈值 10 时 **76% 的子树单屏可完成** |
| **筛选** | 默认**只显示"判得了的"**：`unsupported` 既不算通过也不算欠账，**不进一屏** | 原文 `handlers.ts:250-255`：「另有 **N 条判不了（unsupported）**，**没进块** —— ★ 它们**不是"要改的"、也不是"通过"**」⇒ 判据：一屏里 `unsupported` 条数恒为 0（可当场构造一条 unsupported 验证它不进块） |
| **排序** | **只用稳定量**：块内按"差异总数 ↓，同数按文件名字典序"；块间沿用 `diff_blocks` 已有的排序纪律，**不许自创** | 原文 `diff_blocks.ts:172-173`：「★ 排序键必须**只由稳定量**构成……★ 不许用"插入顺序"或"文件数"当第一键 —— 那会让块的顺序随无关改动漂」⇒ 判据：无关改动（改一个文件的注释）前后，块序列与块内序列**逐字相同** |

### 3.4 一屏该长什么样（不新增存储的版式）

```
关卡名 := region（= formatScope 的输出，逐字）
本关内容 := DiffBlock.files（≤10，超了给下一层子块）
本关判据 := hasDiff 的五项分别多少（missing/mismatched/unexpected/expectation_failures/retire_files）
本关做完了吗 := 该 region 内每个文件的 overlay progress === 'done' ∧ 各自带 evidence（判据已存在，见 B）
```
⇒ ★ 注意最后一行：**"做完没有"已经住 overlay 了** ⇒ 关卡**不需要新的进度存储**，它只提供"这一关有哪些文件"。

---

## 4. ★ 最可能卡住的一步

**答：`requires`（任务前置）要人手写 —— 但它卡住的不是"内容产出"，是"关卡顺序"。真正卡内容产出的是 §1.2 的 `expectations`。**
两件事必须分开说，否则会砍错：

| 卡点 | 卡的是哪一层 | 实测读数 | 判据 |
|---|---|---|---|
| ★★ **主瓶颈：`expectations` 只有 6 种结构 kind，人写不出"该重写"** | **内容**（关卡里有没有事可做） | `run82` 72 张卡 / 1 条 expectations / 0 条 lifecycle | 造一条 `region-rewritten` 或等价 kind 并让 `hasDiff` 认它 ⇒ 有内容。**写不出 ⇒ 判"做不到"**（理由见 §1.2：`diff_views` 五类对比里没有"意图兑现"这一栏） |
| **次瓶颈：`requires` 要人手写** | **顺序**（关卡能不能连成线） | 1436 条边 `requires` 命中 **0**；8 份 overlay 的 `edges` 全 **0 条** | `replan` §0.5 已把它列为"未做、最贵"（"贵：需先建 `goal ↔ 节点` 映射，今天没有"）⇒ 本文不重复主张，只补一条判据：**`requires` 不能从 import 边自动推** —— `overlay.ts:277` 原文「本仓的 edge 默认装的是 **import 依赖**……★ 它**不等于任务前置**」；1436 条边若自动成前置 ⇒ 1436 道闸 ⇒ 玩家寸步难行 |
| **不成立的担心：差异块要人判** | — | `buildDiffBlocks` 纯函数、无 IO、块名稳定、判据唯一 | 不需要人判。**这条我从担心清单里划掉**（省下的力气全投给上面两条） |

**★ 最贵的那一步（本文点名的）**：把 `expectations` 从"结构事实"扩到"区域重写"。判它值不值：**只需一条 kind + 一处判据落点**（不许写在第二处），就能把 8 条自动路径从 0 产量变成有产量 ⇒ 性价比高于任何新面板/新存储。

---

## 5. 我会砍掉什么

1. **砍"任务"作为一等存储**（不建 `tasks` 表、不加 DSL 顶层 `tasks` 键、不加 `docs/_design/tasks.md`）。
   理由：实测 DSL 顶层 12 键里没有它、全仓 `tasks?:` 0 命中 ⇒ 它是**新的第二份表达**；而"任务"完全可以由 `consistency_check` 的 `blocks` **现算**，落库只会带来"账比现实旧"（`replan` §1 观测 4，一天逮到两例）。
2. **砍"关卡完成度百分比 / 经验值 / 等级"这类数字**。理由：`progress` 是唯一权威（`replan` §0.5：权威写端 1 个）⇒ 任何"完成度"是第二份派生的账，要它就得再养一个对账机制。
3. **砍"按 `arch_layer` 分关卡"**。理由：实测 `core` 占 79.5%（381/479）⇒ 一屏 = 整个游戏。`arch_layer` 保留为**差异块的默认归块轴**（`buildDiffBlocks` 默认值），但**不是关卡轴**。
4. **砍"从 import 边自动推 `requires`"**。理由：`overlay.ts:277` 原文 + 1436 条边的量。
5. **砍"一屏给 50 个任务"的分页**。理由：§3.2 实测 —— 这个仓 76% 的子树天然 ≤10 个文件，50 是拍脑袋的。
6. **不砍**：`scope.ts` 的文法（它已经是唯一落点，是本文第 2 节的地基）；`hasDiff` 的单点判据；`region` 稳定命名。

---

## 6. 诚实清单

- `[未核]` **我没有真跑 `consistency_check{scope}` / `query=pending`**（需要起 MCP 服务 + `cache.db` 46MB 索引）。§1.1 那条"blocks 必然为空"是**静态推论**：`expected_apis` 总条数 0（实读三个 JSON）+ `hasDiff` 判据（实读 `diff_blocks.ts:35-39`）+ `handlers.ts:171-174` 的计数来源 —— 三处都是原文，但**没有端到端跑过**。
- `[未核]` `chain_wiring.ts` 的边数：我用 `from:\s*'[a-z_]+'` 数到 **18** 个 `from`，文档（`docs/chain-coverage-report.md:38`）说 **19 条**（已验 18 + 待验 1）⇒ 差的那 1 条**可能**是 `from` 侧为通配或格式不同，我没逐条核。`evidence` 我数到 verified 25 / pending 1，与文档口径不同（我数的是字符串出现次数，不是边数）⇒ **以文档为准，我这份数不作判据**。
- `[未核]` `retireFlow` 在真实 feature 上的实例数：我只确认了 `lifecycle` 在 8 份 overlay 里登记 **0** 条（`OverlayAnchor.lifecycle` 是它唯一的权威落点，`overlay.ts:193`）⇒ 推出 `retire` 标记为 0；**没跑** `consistency_check` 的退役流输出。
- `[未核]` `progress` 权威写端"只有 1 个"：引自 `replan` §0.5 基线（自称实测），我**没有**逐个追 `anchor.progress =` 的全部写入点。
- **判不了**：任务（块粒度，多对一）与 `progress`（文件粒度）是两个粒度，"一个块算不算做完"要一个**块级完成判据** —— 今天**没有任何机器可读面**能判它（`diff_views` 五类对比不含"意图兑现"）。⇒ 要么 GM 口头裁定，要么**承认它判不了并写进回执**（不许默认"块内文件全 done ⇒ 块完成"，那是静默推论）。
- **判不了**：`region-rewritten` 这条 kind 到底能不能写出来 —— 我判不出"能不能"，只判出"**缺它则产量为 0**"。若 §1.2 那条最小修法被否，则本文的**关卡轴整体作废**（剩下 8 条自动路径全是 0 产量），这一条要交给 GM 裁。
- 本文所有"贴原文"均来自 2026-10-15 工作区实读文件；行号以当日为准，后续提交会漂。