# MERGE —— 设计侧 × 实际侧的三方合并

> ★ 2026-10-19（用户原话）：
> "设计会持续偏离实际本身不是问题，因为我们要做的是对拍，本身就是要偏离的。
> 问题在于有时候 Agent 不会按照我们设想好的路来走，它会直接去改源代码，而且不用我们的工具去改
> ⇒ 这就会导致设计会和实际偏离。就像 Git 里有一个人 fork 了你的项目，然后去修改了，他领先了你很多，
> 但是你自己这里又有它独有的，我们需要的是怎么把它 merge 进去。"

---

## 0 · 要解决的问题（一句话）

**Agent 绕过工具直接改源码 ⇒ 实际侧（`live/`）领先；而设计侧（`design/`）有它独有的意图。**
**两条线各自前进，需要一个"三方合并"把它们汇到一起。**

★ 这**不是**"让设计不偏离实际" —— 偏离是**正常的**（对拍就是要看偏离）。
要解决的是：**偏离之后，怎么把双方的独有部分都保住。**

---

## 1 · 三方（零件已存在）

| 角色 | 文件 | 谁写 | 会移动吗 |
|---|---|---|---|
| **base**（共同祖先） | `.agent-io/baseline/<f>.dsl.json`（1.8 MB） | `ensureBaseline`（首次 fork 时） | ★ **永不移动**（除非显式重建） |
| **ours**（设计） | `.agent-io/design/<f>.dsl.json` | 人（`edit_dsl` / `design_intent`） | 每次写意图 |
| **theirs**（实际） | `.agent-io/live/<f>.dsl.json` | `import_project` / `renderLiveFromDb` | 每次扫描 |

★ `storage.ts:279-288` 已经把这套 Git 语义写进注释了：
```
baseline → design = 意图增量
baseline → live   = 实现增量
diff_views 的三方对比据此裁决
```

---

## 2 · 三种差异（`diff_views` 已经能给）

`src/application/refactor/diff_views/diff_views.ts:732`
input: `{ feature }` → output: `FileDiff[]`（`added` / `removed` / `modified` / `unchanged`）

| 情形 | 含义 | 该做什么 |
|---|---|---|
| **只 ours 变** | 设计领先（人写了意图，代码没跟） | ★ **待重写**（⑥：design → 源码） |
| **只 theirs 变** | 实际领先（Agent 改了源码，设计不知道） | ★ **待同步**（③ sync：live → design，只补结构） |
| **两边都变** | ★ **冲突** | ★ **人裁决**（见 §3） |

---

## 3 · 粒度与裁决规则（这是"新写"的部分）

| 粒度 | 自动接受 | ★ 必须人工 |
|---|---|---|
| **文件增删** | theirs 新增文件 ⇒ 收进 design（事实） | ours 删了而 theirs 还在 ⇒ **问**（是"设计不要了"还是"没同步"？） |
| **API / 签名** | — | ★ **一律人工**：`decision.expectations` 可能依赖这个签名 |
| **调用边** | theirs 新增调用 ⇒ 收进 design（事实） | theirs 删了而 ours 的 `call-exists` 指着它 ⇒ **标"失效"**（不删，见下） |
| **`decision`** | ★ **永不自动改**（它是意图） | 人的裁决才动 |
| **`expectations`** | 结构类（`file-exists`/`symbol-exists`）可随 theirs 更新 | 行为类（`call-exists`）指向的东西消失 ⇒ ★ **标 `stale`，不删**（"设计说的还在，只是代码暂时没有"） |

★★★ **一条硬规则**：**`decision` 和 `expectations` 永远不被 `theirs` 覆盖。**
它们是"设计为什么这样"的记录；**theirs 是"代码现在怎样"的事实** —— 事实可以更新，意图不能。

---

## 4 · 三条路（各自负责一个方向）

```
③ sync    ：theirs → ours    只补【结构】（文件/符号/调用边），不碰 decision
⑥ rewrite ：ours   → 源码    按设计 DB 重写（将来接重构线）
merge     ：两边都变          生成"待裁决清单" → 人裁决 → 写回 design
```

### `merge` 的输出（新工具/新脚本）

```json
{
  "feature": "task-system-plan",
  "base": "baseline/task-system-plan.dsl.json",
  "conflicts": [
    {
      "kind": "file-modified",
      "file": "src/application/design/dsl_ops/task_ops.ts",
      "ours_change": "decision.status 从 open → done（人写的）",
      "theirs_change": "新增 clampRelease 函数（Agent 改的）",
      "suggestion": "两边改动不重叠 ⇒ 可自动合并"
    },
    {
      "kind": "expectation-stale",
      "file": "src/domain/task_machine.ts",
      "symbol": "claimTask",
      "expectation": "call-exists → cardStanding",
      "issue": "★ theirs 里 claimTask 已不再调 cardStanding ⇒ 判据失效",
      "action": "标 stale / 人确认后删或改"
    }
  ]
}
```

---

## 5 · 为什么不做"自动 merge"

```
Git 的自动 merge 靠"行级 diff"，而我们的粒度是【符号 + 调用 + 意图】
⇒ 自动合并会把"意图"和"事实"混在一起（那正是今天删掉的"双写"病）
⇒ ★ 所以 design 只收【结构事实】，decision/expectations 只由人写
⇒ "自动"只做两件：① theirs 新增的文件/调用收进 design ② 判据失效标记
```

---

## 6 · 现状与缺口

| 零件 | 状态 |
|---|---|
| `baseline`（三方共同祖先） | ✅ 已有（`task-system-plan.dsl.json` 1.8 MB） |
| `diff_views`（三方对比） | ✅ 已有（文件语义级：行数/层级/符号/API） |
| **`merge`（裁决清单）** | ★ **缺** —— 本文档定义它 |
| **`sync`（③）** | ★ **缺** —— 它其实是 `merge` 的"无冲突子集" |
| **`rewrite`（⑥）** | ★ **缺** —— 接重构线（`VISION.md §6`） |

★ **下一步**：先写 `merge` 的**只读版**（生成裁决清单，不写任何东西）⇒
人看清单 ⇒ 再决定要不要 `apply`。
★ **理由**：`merge` 一旦能自动写 design，就又有"第二处写 decision"的风险 —— 所以它**先只读**。
