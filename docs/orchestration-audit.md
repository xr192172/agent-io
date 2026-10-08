# 编排体检（2026-10-08）：面是"投影"，编排是"接线"——本仓只接了 refactor 一条线

> 起因（用户）：*"我们那个 MCP 工具面是从权威源投影的，它里面只投影已经写好的工具。
> 现在这些工具还有一些没有编排好，编排你懂？就是说你自己去看一下那些工具之间的差异，
> 你应该大概就知道编排是什么意思了。"*
> 本文**先把"编排"定义成可判定的东西**，再用本仓已有的量具去数，最后指出缺口**具体在哪一格**。

## 0. "编排"是什么 —— 一句可判定的话

**编排 = 让上一步的产物，能被下一步的入参直接接住**，不必由调用方手工拼字段名、数下标。

本仓已有一套完整的机器判据（不是新造的）：

| 机制 | 位置 | 回答什么 |
|---|---|---|
| `Touched` | `src/domain/b_terms.ts` | **产物端**：这次"动了什么"（六个锚点键） |
| `CHAIN_EDGES` | `src/domain/chain_wiring.ts` | **接法表**：上游 `touched.<键>` → 下游入参的哪个位置 |
| `CHAINS` | 同上 | 命名的**链**（几步、每步有没有已验证的边） |
| `deriveObjectChains()` | 同上 | 从接法表**算**出「谁还能接谁」 |
| `measure_b_contract.mjs` | `scripts/` | 两端**覆盖率**：产物有多少给锚点、入参有多少收锚点 |

**"编排好"的完整定义 = 三件事同时成立**（下面 §3 用 refactor 线当样板验证过）：
① 上游**有明确的产物锚点**；② 下游**有位置接它**；③ **选择点被显式命名**（多个时谁选、怎么选）。

## 1. 完成度（实测，`scripts/measure_b_contract.mjs`）

★ 先分清两层：**工具 61 个 ≠ `[B]` 38 个**（`[B]` = `application/**` 里"函数名 == 文件名 camelCase"的导出函数）。

| 读数 | 值 |
|---|---|
| `[B]` 总数 | **38** |
| 入参类型：不同名字数 | **29 种 / 38 个 [B]** ⇒ "各写各的" |
| 产物字段组合：不同组合数 | **34 种 / 38 个 [B]** |
| **产物端** `touched` 已接 | **31 / 38**（登记例外 7，**真债 0**）|
| **入参端收 `touched` 的 [B]** | **0** |

★★ **决定性两行**（量具原话，不是我转述）：

> 入参端**没有一个**收 `touched` 这个对象；两端只共享**扁平字段名**（project_dir / feature …）
> ⇒ 产物端把作用域塞进 `touched`，入参端却只认平铺的 — **这正是"链要手工拼"的地方**。

对象类接力键的两端覆盖（同一把尺）：

| 键 | 入参端收 | 产物端给 |
|---|---|---|
| `feature` | 19 | 13 |
| `project_dir` | 18 | 6 |
| `file` | 3 | 1 |
| `node_id` | 4 | 2 |
| `symbol` | 2 | 1 |
| `symbols` | **1** | **0** |
| `written_files` | **0** | **2** |
| `nodes` | **0** | **0** |

⇒ **结论一句话：产物端统一了（`touched` 31/38），入参端没统一（0/38）。"一切皆产物"只做了一半。**

## 2. 链的实际覆盖（实测，从构建产物读 `CHAIN_EDGES`）

- 链边 **11 条** = 2 条**通配**（`project_dir` / `feature`，`ANY_TOOL → ANY_TOOL`）+ **9 条对象类**。
- 9 条对象类边只涉及 **5 个工具 / 61**：
  - 作上游：`find_references` · `move_symbol` · `rename_symbols`
  - 作下游：`rename_symbols` · `move_symbol` · `impact_analysis` · `edit_code`
- ★★ **design 线 12 个工具：作上游 0 个、作下游 0 个。**（一条对象类边都不占）
- `deriveObjectChains()` 派生出的工具也是**同样那 5 个**（全是 refactor 线）。
- `CHAINS` 只有 2 条，且**两条都不在 design 线上**：
  - `refactor` = `find_references → rename_symbols → edit_code → run_tests`（`verified`，
    但第 4 段是**能力缺口**：`run_tests.filter` 要**测试**文件，`written_files` 给的是**源**文件 ——
    "源文件 → 对应测试"的映射**今天没有工具给**）；
  - `design-import` = `import_project → extract_contracts → find_references`（**断在第 2 段**；
    注释自己写着"★ 它**根本不是一条链**：`extract_contracts` 是终端分析工具，交接不出对象"）。
    ⇒ 这条链在本表里的身份是**反例**（"看起来连得上 ≠ 是链"）。

★★ **这解释了上一轮那个现象**：工具面是从权威源投影的 —— **投影没错**，
但"投影出什么"取决于 **`direct` 白名单 ∪ 派生链**；而派生链只覆盖 refactor 那 5 个
⇒ **design 线本来就不在编排面上，只能靠手写 `direct` 硬塞进去**。
⇒ 面反映的是**注册表**；编排反映的是**接线**。**注册齐了 ≠ 接上了。**

## 3. "编排好"长什么样 —— 用 refactor 线当样板（三段式）

以 `find_references → rename_symbols` 为例，三件事齐备：

| 要件 | 实例 | 落地形态 |
|---|---|---|
| ① 产物锚点 | `find_references.touched.file`（`single`，确定只有一个） | `Touched.file` |
| ② 下游入参位置 | `renames[].file`（**数组元素里**） | `toPath` 支持 `[]` 点路径 |
| ③ 选择点命名 | `symbols` 是集合 ⇒ `cardinality: 'pick'` = 「**从上一步的列表里选一个，下标由你给**」 | 表达式 `touched.symbols[i]` |

★ 第三条是本仓**唯一"要调用方动手"的地方**，且理由写死在本仓：**选择是语义判断、不是数据搬运**
（Unix 的 `grep` 也是在选）—— 我们只给它**一个统一的名字**，不替它选。

## 4. design 线为什么编不起来：逐条对照

| 要件 | refactor 线 | design 线 |
|---|---|---|
| ① 产物锚点 | `file` / `symbols` / `written_files` 都有 | **基本只有 `feature`**（`updateFeature` 的产物锚点候选 = `['feature']`）|
| ② 下游同名入参 | `renames[].file` / `change_points[].symbol` … | **没有**：design 线入参锚点只有 `feature` / `project_dir` |
| ③ 选择点 | 已命名（`single` / `pick`） | 无从谈起（连集合都没有） |

**具体到键的缺口（都有读数撑着）**：
- ★ `scaffold` 产出 `written_files`，而**全仓入参端 0 个 `[B]` 收 `written_files`** ⇒ **接不出去**。
- ★ `manageFeature`（feature 生命周期）**连 `touched` 都没有** —— 它登记在
  `B_TOUCHED_EXEMPT` 的 [C] 分派器例外里。★ 而该表自己写了正确做法：
  「`touched` 由**被分派到的真 [B]** 携带，分派器**转发**即可」——**它到底转发了没有，本轮未验**。
- ★ `deriveAlgorithm` 产出 `nodes_created` / `edges_created` —— 那两个键**不在 `Touched` 六键里**
  ⇒ 它们是 `AnatomyResult` 层的"锚点候选"，**不是链锚点**。
  这正是 §1 要警惕的：**"锚点候选字段" ≠ "链锚点"**（`[B]` 38 个里，**产物没有任何锚点候选字段的 8 个**）。
- ★ `deriveSplit` 入参收 `symbols` —— 而全仓**入参端只有 1 个 [B] 收 `symbols`**。

## 5. 结论 = 执行序列 ④ 的判据（可判定，不用"感觉"）

本仓既定的下一步是 ④「统一 `[B]` 契约形状（入参/产物结构化）」。本文给它**三个可判定的完成判据**：

1. **`入参端收 touched 的 [B] 数` > 0**（现在 **0**）—— 这是"链要不要手工拼"的总闸；
2. **`CHAIN_EDGES` 里出现至少一条 design 线的对象类边**（现在 **0**）；
3. **`CHAINS` 的 `design-import` 不再是"反例"**，而是每段都有 `verified` 边。

★ 三条都是**读数**，不是"改完看着顺眼了"。★ 也正因为有这三条，④ 才**可以在改之前就宣称要做完什么**。

## 6. 没做 / 未验（诚实清单）

- **只量了，一行代码没改**（本轮产物只有本文 + 一条 DSL 格式对照）。
- **`manageFeature` 的"分派器转发 touched"未验**（它现在是"没有 touched"，是转发失败还是本就不转发，没测）。
- 未量 **`deriveObjectChains()` 的边是否与 `CHAIN_EDGES` 一一对应**（两处都有"谁能接谁"，是同一份还是两份，未查）。
- 未核 **`docs/tool-chain-contract.md` §5** 与 `CHAINS` 是否已经漂移（§5 是散文版，`CHAINS` 是可消费版）。
- 本文 §1 的读数取自 `measure_b_contract.mjs`（本仓已有量具）；§2 取自构建产物 —— **两处口径不同，别混着念**。
