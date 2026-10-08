# DSL 的原始设计意图、代码现状、以及「验收进 DSL」的落点（2026-10-08）

> 起因：用户口述了当年的设计 ——*「一个直接复写带项目现状的 DSL，以及一个设计中的 DSL。这是两个，还有第三个 DSL，
> 我直接忘记了是什么……每一个决策都应该先建 DSL，在设计 DSL 上面挂载新的决策和决策历史……
> 是不是还需要再有一个自动测试，也可以直接放在 DSL 里面，和它关联，从 DSL 里面读，然后去测这种。」*
> 目的：**用代码事实（带行号）把"第三个"考证出来**，并给出「验收进 DSL」的落点与形状。
> ★ **本轮还做了一次实跑**（不是只读代码）：scratch 项目 3 文件走完
> `import_project → design_intent → edit_dsl(决策卡含 acceptance) → get_dsl 读回 → consistency_check → detect_drift → render`，
> 并**注入真实漂移**看它变不变红。结论见 §三「实跑验证」。

## 一、★★ 三个 DSL —— 第三个是**决策层**（不是另一个视图）

线索来自代码自己的措辞（不是我的推断）：

| # | 用户的说法 | 代码里的东西 | 落盘 | 关键性质 |
|---|---|---|---|---|
| ① | "直接复写带项目现状的 DSL" | **`live` 视图** | `live/` 目录 | **只读**；`import_project --live_only` 写；「实际代码快照」 |
| ② | "设计中的 DSL" | **base（设计 DSL 主体）** | 设计 DSL 文件 | ★ **可再生成**（从实际派生 / 随手写） |
| ③ | ★ **"我忘了的第三个"** | **`overlay`（设计意图层）** | `<features>/<feature>.overlay.json` | ★★ **独立保留**（不随 base 重生成而丢） |

**决定性证据**（`src/infrastructure/storage_overlay.ts:4` 的原文）：
```
存储：<features>/<feature>.overlay.json（与 base 分离，base 可再生成，overlay 独立保留）
```
⇒ ★ **第三个存在的理由就是"base 会被重新生成，人写的决策不能被覆盖"** —— 它是**决策的家**，不是一个视图。

★ 另有**第四样**（不在"三个 DSL"里）：**`archive`（下线库）**——把要下线的文件/节点孤立起来、
「存档完整 DSL 快照（**含决策卡**）」作为历史研究材料。
★ **更正（同一轮自查）**：本文件初稿把 `archive` 的出处写成 `src/application/design/index.ts` —— **错了**。
`grep -rn "name: 'archive'" src/` ⇒ 实为 **`src/application/meta/index.ts:138`**（**meta 线，不是 design 线**）。
design 线**恰好 12 个**工具（`src/application/design/index.ts` 的 `name:` 计数 = 12；
六条线 4+12+3+11+12+19 = **61**，与 `cli list` 报的 61 一致）。
⇒ 错因：我按"它讲的是 DSL 的事"就把它归进 design 线，**没查定义文件**。
★ 通则：**"它属于哪条线"看定义在哪个 `index.ts`，不看它在讲什么话题。**

## 二、用户口述的设计意图 vs 代码现状（逐条对照）

| 用户说的 | 代码里有没有 | 证据 |
|---|---|---|
| 设计 DSL 可**从实际派生** | ✅ | `import_project`；`src/domain/overlay.ts` 的 `seedOverlayFromDsl` |
| 设计 DSL 也可**从头手写** | ✅ | `createFeature` / `manage_feature(action=template)`（`dsl_ops/feature_ops.ts`） |
| 每个决策**先建 DSL** | ✅ | `design_intent`：`action=propose` 是 `set` 的「**先请人批再落**」前置闸；`index.ts:488`「**不写盘不碰 DSL**；人 approve 后才真正写入 overlay + base」 |
| 在设计 DSL 上**挂载决策** | ✅ | `OverlayAnchor.decision: NodeDecision`（决策卡：**结论/理由/替代/后果/验收**）—— 类型在 **`src/domain/geometry.ts:154`**；写在 `dsl_ops/node_ops.ts:176` `applyDecisionWrite` |
| 挂载**决策历史** | ✅ | `OverlayAnchor.decision_history: DecisionHistoryEntry[]`（**决策卡·版本栈**，`geometry.ts:178`；**首版不压栈**，旧版才压） |
| **趋近**：照设计 DSL 重写实际项目，直到两者趋近 | ✅（报告式） | `consistency_check`（75 字）/ `detect_drift`（249 字）；`overlay` 的 `stale` / `orphaned` 对账标记：「真相面路径在、签名变 ⇒ 设计过期，需复核（**不丢弃**）」「真相面已删 ⇒ 暂存待决（**不静默丢**）」 |

⇒ ★ **你记得的差不多全对**，而且比你记的多一层：`decision` 卡里**已经有"验收"这一格**。

## 三、★★「自动测试放进 DSL」—— 落点**已经存在**，缺的是"可跑"

**关键发现**：决策卡的字段是 **`结论 / 理由 / 替代 / 后果 / 验收`** —— 类型在
`src/domain/geometry.ts:154` 的 `NodeDecision`（**不是** `overlay.ts`；`overlay.ts:42` 只是锚点上那一行的注释）：

| 卡片格 | 真字段名 | 声明原文（`geometry.ts`） |
|---|---|---|
| 结论 | `summary` | 这个设计是什么（一句话） |
| 理由 | `rationale?` | 为什么这么定（含定量依据） |
| 替代 | `alternatives?: {option, rejected_because}[]` | 被否掉的替代方案及否决原因 |
| 后果 | `consequences?` | 这么定的代价 |
| ★ **验收** | **`acceptance?`** | 「验收标准：怎么算做好了（**可观测**）」 |

⇒ 你说的"测试和 DSL 关联、从 DSL 读然后去测" —— **`acceptance` 就是那个挂点**，不必新造。
★ 而且**它自己的注释就写着"可观测"** —— 现字段名是自由文本 `string`，**声明与实现已经分裂**：
"可观测"是可被程序读的意思，`string` 不是。⇒ **这条升级不是我新加的意图，是把声明兑现。**

### ★★ 实跑验证（2026-10-08，本仓 CLI，scratch 项目 3 文件）
| 判据 | 实测 |
|---|---|
| 12 个 design 工具**能不能跑通** | ✅ **12/12** 全部加载并分派（空参时给**各自具体**的可行动错误，无原始异常、无 `unknown tool`） |
| 端到端链路 | ✅ `import_project`(3 文件→6 节点/5 符号/2 依赖边) → `design_intent action=set` → `edit_dsl` 写**含 `acceptance` 的决策卡** → `get_dsl query=decisions` **读回** → `consistency_check` → `detect_drift` → `render_design`/`render_brickwork` 全部成功 |
| 决策卡与版本栈真的会写吗 | ✅ `dsl_ops/node_ops.ts:176` `applyDecisionWrite`（**首版不压栈**、旧版压入 `decision_history`、`author`/`updated_at` 由该纯函数打） |
| ★ **注入真实漂移会不会变红** | 删掉 2 个真实函数后：`consistency_check` 报 **❌ 缺失: 2**、`detect_drift` 报 **欠实现文件(2)** —— **判据准**；但两者**退出码都是 0** |

**⇒ 所以缺口不是"没有判据"，是"判据没有失败通路"**（实测坐实）：
1. `acceptance` 是 `string`，**没有任何工具读它、解析它、执行它** ⇒ 写了等于没写；
2. `consistency_check` 的全量入参只有 `feature` + `code_dir`（**没有阈值/门参数**），
   漂移再严重也**恒退出 0** ⇒ 它是**报告**，不是**门**（对照：工具抛错时 CLI 退出码 **1**，
   说明非零通路本身是通的，只是没接）。

### 建议形状：把「验收」从自由文本升级为**可判定的检查项**（与 goal/edge_intent 同级复用锚点）
```ts
// 概念草案 —— 落点就在 NodeDecision.acceptance 里，不新开一层
type Expectation =
  | { kind: 'edge-exists';      from: string; to: string; why: string }
  | { kind: 'edge-absent';      from: string; to: string; why: string }   // ★ "边界归属"最需要这条
  | { kind: 'symbol-exists';    path: string; symbol: string; why: string }
  | { kind: 'file-exists';      path: string; why: string }
  | { kind: 'signature-matches'; path: string; signature: string; why: string };
```

**为什么这个形状是对的（三条依据，均已用代码核对）**：
1. **判据都在手边，且不是我要新写的**：
   `signature-matches` —— `consistency_check` **已经在做**（`expected_apis[].signature` ↔ `actual_signature`，
   实测输出 `status:"matched", match_score:100`）⇒ **复用它**，只是把口径从"import 时记下的"扩到"人写的设计意图"；
   `symbol-exists` 用**符号表**（`cache.db`）；`edge-exists/absent` 用**依赖图**（`probe:edges` / `resolveImportTarget`）。
   ⇒ **不用新造解析，也就不会新造判据分叉**。
2. **与 `consistency_check`/`detect_drift` 分工清楚**（同源不同用）：
   那两个**报漂移**（"设计与实际差在哪"，给人看）；
   `expectations` **判成败**（"这条意图还成立吗"，给门/流水线）。
   ★ 实测印证分工的必要性：前者的口径**只能来自 import 快照**（所以只能问"实现了吗"），
   **问不出"这个依赖本不该存在"**（`edge-absent`）—— 而那正是"边界归属"要的东西。
3. ★★ **正好落在本仓已确立的那条线上**：**可判定的**（edge/symbol/file/signature）⇒ 能进**门**；
   **不可判定的**（`goals` 的自然语言、`intents` 的职责描述）⇒ 保持 **advisory**，当**给 LLM 的提示**
   （本仓 §4 判据 vs §6.4「消费者可以不是运行时，而是人/LLM」）。

### 它与我这几轮建的东西怎么接
- 判据实现复用：`probe_edge_diff`（依赖图）+ `probe_xfile_resolve`（跨文件解析）+ `consistency_check`（签名比对）
- **观测**接 `npm run snap:*`：把"某 feature 的 expectations 全过"记成观测点 ⇒ **漂移/回归会当场变红**
- **不新造门**（本仓铁律：不建"免疫系统"）⇒ `expectations` 先作**报告 + 可选门**，由裁定决定是否进门。

## 四、没做 / 未验

- **全是考证与设计判断，没有一行实现**（`Expectation` 是草案，未落代码）。
  本轮的实现性产出**只有**：两个文档 + 一次 scratch 端到端实跑（产物已清理，未留 litter）。
- `archive` 与"设计存档"到底是不是同一个东西，**没查死**（`manage_feature` 描述里并列写着"设计存档 + 实际快照 + 活态视图"，
  而 `archive` 工具自称"下线库" ⇒ 两者**可能不同**，本轮**未追**）。
- `decision_history` 的**写入时机**已查（`applyDecisionWrite`），但**谁在真实流程里调它**（哪条工具路径）**未追**。
- 「趋近」有没有**量化口径**（比如"差异低于 N 条即视为趋近"）**没查**。
- `acceptance` 在**真实 feature 数据里有没有内容**：本仓 5 个现存 feature 的
  `get_dsl query=features` 一律报 **0 决策** ⇒ **真实数据里它目前是空的**（不是"没查"，是查了，是 0）。
- 未验：`edge-absent` 需要的"基座边集合"到底取哪一份（设计 DSL 的边 / 索引库的边）——**两处都有边，取错就是判据分叉**。
