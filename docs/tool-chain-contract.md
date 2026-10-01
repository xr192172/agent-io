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
