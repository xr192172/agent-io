# ④ [B] 的契约形状 —— 设计与证据

> ④ = 台账 §19.2/§20.3 里"做链的前提"：**[B] 之间要有统一的中间数据形态**（B₂ 能接 B₁ 的产物）。
> 本文是 ④ 的**开工第一步：量现状 + 定形状**。★ 数据可复跑：`node scripts/measure_b_contract.mjs`。
> 2026-10-01。

## 1. 现状数据（复跑命令在文件头）

| 量 | 值 |
|---|---|
| 人群（[B] = `application/**` 里"函数名 == 文件名 camelCase"的导出函数） | **42** |
| 入参形态 | `typed` 30 ｜ `inline` 6 ｜ `positional` 5 ｜ `none` 1 ｜ **`bag`（`Record<string,unknown>` 袋子）0** |
| 产物形态 | **`structured` 42 ｜ `message-only` 0 ｜ `void` 0** |
| 入参**类型名** | **32 种 / 42 个 [B]**（几乎 1:1 ⇒ 各写各的） |
| 产物**字段组合** | **37 种 / 42 个 [B]**；被 ≥2 个 [B] 共用的只有 **1 种**（`{data, message}` ×6） |
| 产物里**没有任何"锚点候选"字段**的 [B] | **15 / 42**（`exploreCode` `editCode` `diffViews` `queryFeature` `runTests` `classifyBricks` … ） |

## 2. ★ 纠正台账里的两句前提（实测推翻）

台账 §20.2 写：「57 个 `[B]` 各自定义入参、**各自返回 `message`**」。
**实测：不成立。** 42/42 的产物**类型都是结构化的**，`message-only` 一个也没有；
**袋子入参也是 0**（`Record<string, unknown>` 那类在 [B] 层已经不存在）。

★ 但台账的**结论方向是对的**，只是描述不准。准确的说法是：

> **[B] 之间没有共同形态**：32 种入参类型名、37 种产物字段组合，仅 1 种组合被 ≥2 个 [B] 共用。

## 3. ★★ 关键发现：不是"异名"，是**同名不同义**

第一版量具只比**字段名**，把 `filesWritten` 当成 `files` 的同义名 ⇒ **产出 32 条假阳性**。
把**类型**摆出来后就露馅了（`node scripts/measure_b_contract.mjs --anchors`）：

| 字段 | 实测类型 | 语义 | 若当"同义"改名会怎样 |
|---|---|---|---|
| `renameFiles.filesWritten` | **`number`** | 写盘**计数** | 会被改成"文件列表" ⇒ **语义被篡改** |
| `assembleBricks.written` | **`boolean`** | **是否落盘** | 同上 |
| `extractContracts.files` | `FileContractReport[]` | **逐文件报告** | 会被当成"路径列表" |
| `searchBricks.box_dir` | `string` | **积木盒根**（`<storage>/bricks`） | 会被当成 `project_dir` |
| `runTests.success` | `boolean` | **"测试全过"的领域判定**（与 `ok` 并存且不同义） | 会被当成 `ok` 同义 |

⇒ ★★ **"[B] 产物里连字段名这一层都不可信"** —— 同一个名字在不同 [B] 里含义不同。
⇒ 因此 **"把现有字段改名/合并来统一"这条路是错的**：它会把不同语义的东西搅在一起，
   正是本仓头号病根（判据分叉）的翻版。

★ 纪律（新增，值得记住）：**"名字像" ≠ "同义"**。任何"合并同义字段/常量"的动作，
  必须先看**类型 + 语义**；不看就合并 = 制造判据分叉。

## 4. 形状提案：**加一个语义唯一、类型钉死的锚点**（不动现有领域字段）

既有字段语义各异 ⇒ **不碰它们**（改了无收益、有风险）。
改为**新增**一个约定字段，让每个 [B] 显式声明"我动了哪些对象"——

### 4.0 先看机器生成的**字段字典**：`docs/b-field-dictionary.md`
（重生成：`node scripts/measure_b_contract.mjs --dict > docs/b-field-dictionary.md`）

| 侧 | 字段名总数 | 真·共用（同名 + 同型 + ≥2 个 [B]） | ★ 同名不同型 | **只服务 1 个 [B]** |
|---|---:|---:|---:|---:|
| 入参 | 134 | 24 | 8 | **102（76%）** |
| 产物 | 189 | 16 | 21 | **152（80%）** |

⇒ ★ **80% 的产物字段是私有的** —— 数据印证了"这些字段只为它这一个功能服务"。
⇒ ★ 而共用那批里还有 **21 个是"同名不同型"**（`files` 一个名字**6 种类型**、`stats` 5 种、`written` 是
   `boolean`×4 与 `string[]`×1 混用）⇒ **不能靠"名字通用"来造通用层**。

### 4.1 ★ `Touched` 定稿（每个字段都写明**数据依据**）

```ts
/**
 * 链的接口：一次 [B] 调用**动了哪些对象**。
 * ★★ 语义唯一、类型钉死；下游 [B] 只从这里取原料，不再各自发明词。
 * ★ 只收"**被数据证明真通用**"或"**语义唯一的新名**"两类，其余一律不收。
 */
export interface Touched {
  /** 作用到的 feature —— 数据依据：入参侧 18 个 [B]、产物侧 12 个 [B] 已用 `feature: string`（同名同型，真共用） */
  feature?: string;
  /** 作用到的项目根 —— 数据依据：入参侧 17 个 [B] 已用 `project_dir: string`（同名同型，真共用）。
   *  ★ **不并** `box_dir`(5) / `brick_dir` / `slim_dir` / `target_dir` —— 实测它们是**盒根**，不是项目根，
   *    名字像但语义不同（§3 的反例）。 */
  project_dir?: string;
  /** 被**写入/改动**的文件（仓库相对路径）。
   *  ★ 用**新名**：`files` 在产物侧有 **6 种不同语义**（`string[]` / 各类 Report 数组），已被污染，不可复用；
   *    `filesWritten` 是 `number`（计数）、`written` 是 `boolean`（是否落盘）——也都不能用。 */
  written_files?: string[];
  /** 被**读取**当作输入的文件。★ 与 `written_files` 分开：现有 `files` 恰恰是"报告/路径"混用才坏的。 */
  read_files?: string[];
  /** 改动/定位到的符号 qualified_name。
   *  ★ 用**新名**：既有 `symbol` 是 `string`（单个）；一次调用常涉及多个，链需要全部。 */
  symbols?: string[];
  /** 作用到的 DSL 节点 id。★ 同上：既有 `node_id` 是 `string`（单个）。 */
  nodes?: string[];
}
```

**每个 [B] 的产物增加 `touched?: Touched`**（可选起步；棘轮收紧：**新增 [B] 必须给**）。

★ 为什么不是"把现有字段改名成统一名"：见 §3 —— 那会把不同语义搅在一起。
★ 为什么 `Touched` 里字段这么少：**上表 80% 的字段是私有的**，通用层只该放那 16/189 里语义真的通的。

## 5. 目标链（形状的验收对象 —— 没有链，统一形态就是为统一而统一）

天然的 refactor 链：
```
find_references  →  rename_symbols  →  edit_code  →  run_tests
（定位影响面）      （改符号）          （补代码）     （验）
```
**现在为什么接不上**（实测类型）：
- `rename_symbols` 产物给的是 `filesWritten: number`、`applied: Array<{…}>`、`symbol: string`
  —— **没有一处能直接喂** `edit_code` 的入参（它要 `file` + 符号/区间）。
- 有 `Touched` 后：`rename_symbols` 给 `touched.written_files` + `touched.symbols`
  ⇒ `edit_code` 能按"同一个符号、同一个文件"接上，**链在类型上成立**。

## 6. 落地顺序（一族一提交，G1/G8 守边界）

| 序 | 改谁 | 为什么这个序 |
|---|---|---|
| **④-a** | `domain/` 建 `Touched` 类型（**与第一个采用者同笔落**，否则是墓碑） | 不留过渡物 |
| **④-b** | **refactor 族**：`rename_file` `rename_files` `rename_symbol` `rename_symbols`（+`find_references`） | 链价值最高；且它们的产品字段最乱（`filesWritten: number` / `applied` / `moved`） |
| ④-c | `design` 族 | 量大，但锚点已多是 `feature`，改动小 |
| ④-d | `harvest` 族（`box_dir`/`brick_dir`/`slim_dir` → `root`） | 根别名最多 |
| ④-e | 剩下各族 + 棘轮收紧（新 [B] 必须有 `touched`） | 最后才收紧 |

**每笔的验收**：`tsc` 0 ｜ `arch` 0 ｜ 全量 0 失败 ｜ G1 快照（描述若提到字段才动）｜
G8 行为快照 `UPDATE_TOOL_BEHAVIOR=1` **并记账**。

## 7. 不做的事

- ✗ **不把现有字段改名/合并**（§3 的反例：会改错语义）。
- ✗ 不做"万能中间层"（§19.3 的老教训：复杂度集中到一个新巨型文件）。
- ✗ 不给 `Touched` 塞工具自有的领域字段 —— 它只放**下游真能用的锚点**。
- ✗ 不在第一笔就全量铺开（42 个 [B] × G1/G8 ⇒ 必须按族）。

---

## 8. 追加记录：`read_files` 撤出 `Touched`（2026-10-05）

> ★ 本节是**追加记录**（§4.1 那段定义保留原貌 —— 它记的是当时的判断）；结论在此更新。

**改了什么**：`Touched` 去掉 `read_files` 字段（§4.1 里的那一栏**不再成立**）；词表 `b_terms.ts` 里
`read_files` 由 `kind: 'anchor'` **改判为 `context` 并标"已退役（产物侧）"**。
原 5 个产者（`find_references` / `extract_contracts` / `reconcile_effects` / `reconcile_chain` /
`harvest_decisions`）各自那段聚合**一并删除**（不留死代码）。`Touched` 现存字段：
`feature` / `project_dir` / `written_files` / `symbols` / `nodes` / `file`
（★ 末项 2026-10-05 由 `definition_file` **改名**为 `file` —— 目的：让 `touched.file` 与下游入参
`rename_symbols.renames[].file` **逐字同名、零字段名翻译**；该边已真跑并升级 `verified`）。

**为什么**（用户 2026-10-05 的两类判据）：

> **有可被再利用的价值时，才有被当做『出参』的意义。否则把它当变量、当剪贴板直接剪贴给下一个。**

判据 = **下游若不用它，是不是得从头重算一遍？** 重算贵 ⇒ **出参**（进 `Touched`）；
下游自己轻松能得到 ⇒ **剪贴板 / 变量**（原样传下去，**不该占链的接口**那一格）。

按此判 `read_files`：**下游自己读/扫就行**（读工具只吃路径，**不关心是源码还是事件**）⇒ **剪贴板**。
★ 它的病根正是"**是剪贴板、却占了链的接口的位置**" ⇒ 所以**从来没有消费者**从它那儿接
（实测：全仓 **0 个** `touched.read_files` 读取点）。

**同批被顺带消掉的**：`harvest_decisions` 的 `read_files` 曾**违反词表定义**
（词表写"仓库相对路径"，而它的路径基准是 `process.cwd()`）—— 该出口撤出后，这个违反**不再存在**。

**✅ 该格已于 2026-10-06 补上名字** —— 见 §9：`touched.<键>[i]` 就是"挑出来的那个值"的**表达式**，
且由 `chain_wiring.ts` 的 `chainExprOf()` **一处生成**（不再"没有任何实体承载"）。

---

## 9. 追加记录：§5 那条链**真跑验收** + 「选一个」的明文表达（2026-10-06）

> ★ 本节是**追加记录**（§5 那段"现在为什么接不上 / 有 `Touched` 后链在类型上成立"保留原貌 ——
> 它记的是当时的判断）；结论在此更新。
>
> ★ 判据的**源头**是用户 2026-10-05 的原话（照录，别转述）：
> 「**有可被再利用的价值时，才有被当做『出参』的意义。否则把它当变量、当剪贴板直接剪贴给下一个。**」
> 「**通用工具本身可以读所有的文件吧？不管它是事件集还是源码集**」＋「**为什么不直接从 AST 里读呢？**」

**做了什么**：把 §5 那条链（`find_references → rename_symbols → edit_code → run_tests`）**真跑了一遍**，
逐条核 `src/domain/chain_wiring.ts` 里挂着的那三条 `pending` 边。夹具 `$TEMP/t54chain`
（2 个 TS 文件 + 一个恒过 `scripts.test`；不进仓、用完即删），全程**零字段名翻译**
（上游 `touched` 的键名**逐字**当下游入参名）。

| 边 | 结果 |
|---|---|
| `rename_symbols.written_files → edit_code.file` | ✅ **成立**（挑 `[1]` 放进 `file` + `op=replace_text` ⇒ `ok=true`） |
| `rename_symbols.symbols → edit_code.symbol` | ✅ **成立**（`symbols[0]` + `op=replace` ⇒ `ok=true`） |
| `edit_code.written_files → run_tests.project_dir` | ❌ **证伪、撤掉**（把**文件**当**根**传 ⇒ `无法读取目标项目 package.json（…\src\b.ts\package.json）`） |

`rename_symbols`（`Kk → KkRenamed`，真落盘 2 文件）给出的 `touched`：
`{project_dir, symbols:["KkRenamed"], written_files:["src/a.ts","src/b.ts"]}`。

★ **两个必须先说的前提**（否则**静默改错文件**）：
- `edit_code.file` 是**相对 `project_dir`** 解析的，而 `written_files` 是**仓库相对** ⇒
  **必须同时把 `touched.project_dir`（通用边）传过去**，让两者同基准。
- `run_tests.project_dir` 要的是**根**：正确接法是 `touched.project_dir`（通用边，已 `verified`）——
  §5 把它写成"从 `written_files` 接"，**形态上就不成立**。

**「选一个」这一格（旧称"剪贴板 / 变量"）今天的形态 = 一个表达式，不是一个新字段**：

```
cardinality: 'single'  ⇒  touched.<键>        // 集合确定只有一个 ⇒ 取即确定
cardinality: 'pick'    ⇒  touched.<键>[i]     // 可能有多个    ⇒ 下标由调用方给
```

★ 由 `chain_wiring.ts` 的 `chainExprOf()` **一处生成**（`renderChainWiring` 也用它 ⇒ 读数里直接印表达式）。
★ **它不进 `Touched`**：那是"**怎么引用**"，不是"**多一个字段**"—— 加字段会再造一个"通用袋子"。
★ **为什么"选"永远由调用方给**：选择是**语义判断**、不是数据搬运（Unix 的"万能"同样不包括自动选 ——
`grep` 就是在选，`$1` / `xargs` 也都是调用方给的）。我们只负责给它**一个统一的名字**。

**已知的能力缺口（★ 不是命名问题，别用改字段名去凑）**：§5 想要的那件事——
"**只跑本次改动相关的测试**"——今天接不上：`run_tests.filter` 要的是**测试文件 / 名称**，
而 `written_files` 是**源文件** ⇒ 中间缺一步"**源文件 → 对应测试**"的映射（今天没有任何工具给这个映射）。

**没做的**：`get_dsl(query='files')` 只给 `symbolCount` **不给符号名** ⇒ `find_references.symbol` 无从填。
★ 但它卡在一个**更大的决策**上：`SemanticFile.path` 是 `schema/design_dsl.schema.json` 钉死的
**对外契约**字段，而受控词表里"文件路径"这个词是 `file` ⇒ **先定"文件路径全仓统一叫什么"，
再谈让 `get_dsl` 投影跟随**；★ **在此之前不动**（见清单 T54）。
