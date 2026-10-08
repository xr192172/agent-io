# 引导体检（2026-10-08）：为什么"想不到去用它"

> 起因（用户原话要点）：*"其实还是一个心智问题。首先你不会想到去用它，然后你不会想到它有三个不同的东西，
> 就是说你对它的了解也不够全面……我们的任务引导或者说是工具引导不够，而且这个 DSL 也不够直观。"*
> 本轮**不把它当"心智问题"来感叹，而是当可判定问题去数** —— 结论：
> 它是**三个可数的缺口**（两个在"面"上，一个在"文件格式"上），**不是记性问题**。

## 一、★ "想不到去用它" = 编排面上**没有门，也没有地图**（机械原因）

读数（`facesOf(catalogOf(TOOL_DEFS), LANE_META.flatMap(m => m.direct))`，本人当场跑）：

| 面 | 工具数 | design 线露了哪几个 |
|---|---|---|
| 原子面 `atomic` | 61 | 全 12 个 |
| 编排面 `composed`（改前） | 9 | **只有 `get_dsl` / `edit_dsl`** |

改前的编排面上：
- **入口 `import_project` 不在面上**（它既不在 `direct`、也不在 `deriveObjectChains()`）；
- **决策闸 `design_intent` 不在面上**；
- ★ **导航工具 `capability_map` 自己也不在面上** —— 而它的描述写着"agent 开工前先定位"。

⇒ 面对编排面，调用方看到的是"**能读能写**"，看不到"**从哪进**""**有几层**""**该走哪条线**"。
要拿到那张地图，得先 `atomic_call(action=list)` 列 61 个 → `describe` → `call` ——
**用 4 跳去换一个"省跳数"的工具**，方向正好相反。

★★ 结构性判据（不是偏好）：**面无门 ⇒ 该线不可达**；**面不含地图 ⇒ 地图在它自己设计的场景里不可见。**

**已修**：`LANE_META` 补 3 个 —— `import_project`、`design_intent` → design；`capability_map` → meta。
同一把尺（`name` + `title` + `description`）：

| | 工具数 | 契约文本载荷 | 降幅 | design 线在面上 |
|---|---|---|---|---|
| 改前 | 9 | 8,402 字符 | −75.5% | 2 / 12 |
| 改后 | **12** | **10,497 字符** | **−69.3%** | **4 / 12** |

★ **明确代价**：载荷多 2,095 字符。判断：**没有门的房间，省下的那 25% 字不是省，是躲。**
★ 口径声明：上表用 `name+title+description`，与 docs 里旧记的 `87,379 → 19,681`（**含 JSON schema 的 MCP 原样载荷**）
**不同尺，不可直接比**。

## 二、★★ "想不到有三个" = 这条心智**只住在源码注释里**

grep 读数（全仓）：

| 载体 | `overlay 独立保留` / `base 可再生成` | `三个` | `acceptance` | `设计意图层` |
|---|---|---|---|---|
| `src/infrastructure/storage_overlay.ts` | ✅ **唯一一处** | — | — | — |
| `README.md` | ❌ | **0** | **0** | 0 |
| `.trae/skills/design-canvas-router` | ❌ | **0** | 0 | 0 |
| `.trae/skills/design-canvas-mind` | ❌ | **0** | 0 | 0 |

⇒ **"你不会想到它有三个"不是记性，是它没被写在任何调用方会读的地方。**

**已修**：router 新增「**第零层：先认三个层**」——

| 层 | 会被重新生成吗 | 什么时候碰 |
|---|---|---|
| ① 实际视图 `live`（只读） | ✅ 每次扫描重建 | 问"代码现在长什么样" |
| ② base 设计 DSL | ✅ **可再生成** | 改结构、改职责、出图 |
| ③ overlay 设计意图层 | ❌ **独立保留** | 写 why、定边界、留决策与**验收** |
| 另 · `archive` 下线库 | ❌ 只增（且**不可逆**，无 dry_run） | 查"当年为什么这么设计/为什么下线" |

加一条操作纪律：**"为什么"写 ③（`design_intent`）；"是什么"改 ②（`edit_dsl`）。**
★ mind 里**只放指针**，不复制那张表 —— **同一条规则只写一处**（复制必漂）。

## 三、★★★ 比"不够"更严重的一件：引导**指着已拆掉的房子**

量法：把两个 skill 里所有 `` `反引号` `` 标识符与 61 个**真工具名**对一次。
21 个"像工具名"的标识符里，**9 个指向不存在的东西**，而且**混了三种层级**：

| 类型 | 例子 | 真相 |
|---|---|---|
| 真工具，但**已改名** | `rename_symbol` / `rename_file` | 现名 `rename_symbols` / `rename_files` |
| **是参数**，不是工具 | `rename_file_if_matching` | `rename_symbols` 的布尔参数 |
| **是 infrastructure 模块** | `verify_refactor` / `contract_gate` / `submit_gate` / `log_query` | 住在 `src/infrastructure/**`；`judge` 干脆无此名（真名 `observe_judge`） |

⇒ 代价：照着走会撞 `unknown tool`；**撞一次之后，这份引导就不再被信** ——
这恰好解释了"想不到去用它"的**心理后果**（不是不肯用，是**用一次就不敢用**）。

**已修**：router §D / §E、mind §三 逐条改成真名，或**显式标注**"这是参数 / 这是内部模块"；
并在 router「自查提示」立一条通用判据：
**"我引用的这个名字，到底是工具、参数，还是内部目录？"** 拿不准就用 `capability_map` 核
（它的名单从注册表派生 ⇒ **不会漂**）。

## 四、"DSL 不直观"有数：**28.9% 是画布坐标与颜色**

`d1.json`（3,254 字符）逐段测量：

| 段 | 字符 | 占比 | 装什么 |
|---|---|---|---|
| `geometry` | 939 | **28.9%** | 坐标 / 尺寸 / 颜色 / 圆角 / 连线样式 |
| `semantic` | 640 | 19.7% | 路径 / 职责 / expected_apis / 层次 |

一个 node 的原文：
```json
{"id":"dir_src","label":"📁 src","x":60,"y":60,"width":630,"height":134,
 "type":"module","style":{"bg":"#152141","color":"#90caf9","borderRadius":8}}
```
⇒ **渲染模型与语义模型焊在同一个文件里**：人/LLM 为了读懂"结构"，必须先趟过像素。

★★★ **但本节初稿写错了，这里更正（当天自查，也是本文最重要的一处）**：

初稿我写「工具层已经好了一半：`get_dsl query=dsl` 输出了几何层/语义层两段人读视图」，
并建议「给 `get_dsl` 加一个 `query=outline`：只出 `path → 职责 → API 签名`，**零坐标**」。

**那是重复造已存在的东西。** 实测（`get_dsl --json '{"query":"digest","feature":"..."}'` 真跑）：

```
══ feature "wga_syncwarm_2" 一行式认知索引（语义层派生视图·只读·不落盘）══
src/auth.ts[core]:     F:核心层 · src — 1 个 API（导入自 0 个模块） | A:login(user: string): boolean
src/service.ts[service]: F:服务层 · src — 1 个 API（导入自 1 个模块） | R:src/auth.ts | A:handle(u: string): boolean
```

**`query=digest` 就是 AOCI 形状的 F/R/A/S 视图，四个段全都实现好了** —— 源码注释（`meta/explore/query_feature.ts:718`）
自己写着「一行式认知索引（**AOCI 形状**的派生视图：只读、不落盘、不新增真相源）」，并给出逐段映射：
`F:` ← `responsibility`；`R:` ← `expected_deps ∪ cache.db import 事实`（走 `fileFacts` 唯一入口，**不新算**）；
`A:` ← `expected_apis` 签名；`S:` ← 高熵字段（`expected_behavior` / `contract` / 非活跃 `lifecycle`）；
标签位 `[layer]` **等价 AOCI 的标签槽**；**段缺则省略（宁缺毋造）**。

⇒ **所以"DSL 不直观"不是缺能力 —— 是那个能力没被任何一处点名**：

| 载体 | 点了 `digest` 的名吗 |
|---|---|
| `get_dsl` 的 query 描述 | 20 个 query 值挤在**一个字符串**里，`digest` 排第 9 |
| `capability_map` 的策展文本（`WHEN_OVERRIDES`） | ❌ 手挑了 4 个（`DSL/features/decisions/simulation_state`），**digest 不在其中** |
| `README.md` 的 `get_dsl` 行 | ❌ |
| `.trae/skills/design-canvas-router` | ❌ |

★ 这是个**比"不够"更贵的错**：能力建好了、能用、还建得挺对，**但三处引导全都没点名** ⇒
**连我（写引导体检的人）都会提议再造一个**。**少点名的代价 > 多写几个字的代价。**

**已修（本轮）**：`WHEN_OVERRIDES.get_dsl` 点名 `digest`；README 的 `get_dsl` 行点名；
router §A 新增一行「"这些文件都是干什么的" → `get_dsl query=digest`」。

**仍未修**（原候选 ② 仍在，且与 `digest` 无关）：
- 节点 id 是 `file_src_core_format_ts` 这种拼接串 —— 读到要先解码，而人读的名字在 `label` 里；
  `digest` 这一路已经用 `path` 回避了它，**但 `---DATA---` 原始载荷与其他 query 仍未回避**。
- `---DATA---` 原始载荷里坐标与颜色仍占大头（LLM 真去动手时吃的那份）。

## 五、没做 / 未验（诚实清单）

- **DSL 的"读法"本身一行代码没改** —— 但改的是**引导**：`digest` 这条已经存在的好视图，
  原先三处引导全不点名，现已补上（§四更正）。★ 真正的候选（节点 id 与人读名解耦）**未动**。
- ★★ **我犯了一次"重复造轮子"**（就在本文 §四）：先看不见 `digest`、再提议造 `outline`。
  根因正是本仓那条老纪律 —— **说"没有"之前先 grep/翻 docs**（§2.7）。**本轮我自己违了一次。**
- 引导的**其余载体没全量核名**：README 的 61 工具表、`docs/tool-handbook.md` 都还没逐个对过真名。
- ★ ★ **快照抓不到本次改动**：`tool-surface` 观测点量的是 `TOOL_DEFS`（61 个工具的契约），
  **不含 `facesOf` 的面成员** ⇒ "哪几个工具露给 LLM"变了，**没有任何东西会变红**
  （实测 `npm run snap:diff` **6/6 全绿**，而面上的工具数已从 9 变 12）。**记账，未补**（本仓铁律：不建免疫系统）。
- 编排面的 `direct` 白名单**仍无用量依据**（`tool_faces.ts` 自己写着"2026-08 手写策展，无用量依据"）；
  本次补的 3 个用的是**结构性判据**（面无门 ⇒ 不可达），不是用量。
