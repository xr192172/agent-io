# DSL 的原始设计意图、代码现状、以及「验收进 DSL」的落点（2026-10-08）

> 起因：用户口述了当年的设计 ——*「一个直接复写带项目现状的 DSL，以及一个设计中的 DSL。这是两个，还有第三个 DSL，
> 我直接忘记了是什么……每一个决策都应该先建 DSL，在设计 DSL 上面挂载新的决策和决策历史……
> 是不是还需要再有一个自动测试，也可以直接放在 DSL 里面，和它关联，从 DSL 里面读，然后去测这种。」*
> 目的：**用代码事实（带行号）把"第三个"考证出来**，并给出「验收进 DSL」的落点与形状。

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
「存档完整 DSL 快照（**含决策卡**）」作为历史研究材料（`src/application/design/index.ts` 的 `archive` 工具描述）。

## 二、用户口述的设计意图 vs 代码现状（逐条对照）

| 用户说的 | 代码里有没有 | 证据 |
|---|---|---|
| 设计 DSL 可**从实际派生** | ✅ | `import_project`；`src/domain/overlay.ts` 的 `seedOverlayFromDsl` |
| 设计 DSL 也可**从头手写** | ✅ | `createFeature` / `manage_feature(action=template)`（`dsl_ops/feature_ops.ts`） |
| 每个决策**先建 DSL** | ✅ | `design_intent`：`action=propose` 是 `set` 的「**先请人批再落**」前置闸；`index.ts:488`「**不写盘不碰 DSL**；人 approve 后才真正写入 overlay + base」 |
| 在设计 DSL 上**挂载决策** | ✅ | `OverlayAnchor.decision`（决策卡：**结论/理由/替代/后果/验收**） |
| 挂载**决策历史** | ✅ | `OverlayAnchor.decision_history`（**决策卡·版本栈**） |
| **趋近**：照设计 DSL 重写实际项目，直到两者趋近 | ✅（报告式） | `consistency_check`（75 字）/ `detect_drift`（249 字）；`overlay` 的 `stale` / `orphaned` 对账标记：「真相面路径在、签名变 ⇒ 设计过期，需复核（**不丢弃**）」「真相面已删 ⇒ 暂存待决（**不静默丢**）」 |

⇒ ★ **你记得的差不多全对**，而且比你记的多一层：`decision` 卡里**已经有"验收"这一格**。

## 三、★★「自动测试放进 DSL」—— 落点**已经存在**，缺的是"可跑"

**关键发现**：`OverlayAnchor.decision` 的决策卡字段是 **`结论 / 理由 / 替代 / 后果 / 验收`**。
⇒ 你说的"测试和 DSL 关联、从 DSL 读然后去测" —— **`验收` 就是那个挂点**，不必新造。

**现状的两个缺口**（都可判定）：
1. `验收` 是**自由文本** ⇒ 不能被程序读、也不会被判成败；
2. 因此它**没有执行者** —— `consistency_check` / `detect_drift` 是**报告漂移**（advisory），不判 pass/fail。

### 建议形状：把「验收」从自由文本升级为**可判定的检查项**（与 goal/edge_intent 同级复用锚点）
```ts
// 概念草案 —— 落点就在 OverlayAnchor.decision 里，不新开一层
type Expectation =
  | { kind: 'edge-exists';      from: string; to: string; why: string }
  | { kind: 'edge-absent';      from: string; to: string; why: string }   // ★ "边界归属"最需要这条
  | { kind: 'symbol-exists';    path: string; symbol: string; why: string }
  | { kind: 'file-exists';      path: string; why: string }
  | { kind: 'signature-matches'; path: string; signature: string; why: string }; // 复用 OverlayAnchor.signature
```

**为什么这个形状是对的（三条依据）**：
1. **判据都在手边**：`edge-exists/absent` 用**依赖图**（本仓已有：`probe:edges` 那套 + `resolveImportTarget`）；
   `symbol-exists` 用**符号表**；`signature-matches` 直接**复用 overlay 已有的 `signature`**。
   ⇒ **不用新造解析**，也就不会新造判据分叉。
2. **与 `consistency_check`/`detect_drift` 分工清楚**（同源不同用）：
   那两个**报漂移**（"设计 vs 实际差在哪"，给人看）；
   `expectations` **判成败**（"这条意图还成立吗"，给门/流水线）。
3. ★★ **正好落在本仓已确立的那条线上**：**可判定的**（edge/symbol/file/signature）⇒ 能进**门**；
   **不可判定的**（`goals` 的自然语言、`intents` 的职责描述）⇒ 保持 **advisory**，当**给 LLM 的提示**
   （本仓 §4 判据 vs §6.4「消费者可以不是运行时，而是人/LLM」）。

### 它与我这几轮建的东西怎么接
- 判据实现复用：`probe_edge_diff`（依赖图）+ `probe_xfile_resolve`（跨文件解析）
- **观测**接 `npm run snap:*`：把"某 feature 的 expectations 全过"记成观测点 ⇒ **漂移/回归会当场变红**
- **不新造门**（本仓铁律：不建"免疫系统"）⇒ `expectations` 先作**报告 + 可选门**，由裁定决定是否进门。

## 四、没做 / 未验

- **全是考证与设计判断，没有一行实现**（`Expectation` 是草案，未落代码）。
- `archive` 与"设计存档"到底是不是同一个东西，**没查死**（`manage_feature` 描述里并列写着"设计存档 + 实际快照 + 活态视图"，
  而 `archive` 工具自称"下线库" ⇒ 两者**可能不同**，本轮**未追**）。
- `decision_history` 的**写入时机**（谁在什么时候 push 版本栈）**没查**。
- 「趋近」有没有**量化口径**（比如"差异低于 N 条即视为趋近"）**没查**。
- `验收` 字段目前在**真实数据里有没有内容**、长什么样，**没查**（没有可用的 feature 数据）。
