# TOOL-CONVERGENCE — 读数层工具的收敛台账

> **一句话**：读数类工具的输出**不是让人看的报表，而是判据的输入**。
> 所以它们最终该变成 **判据（设计侧）** 或 **另一个工具的参数/模式**，而不是 11 个并列工具。
>
> 本文只记"**吸收到哪、需要什么、什么顺序**"。判据规矩住 `docs/GUIDE-GATE.md`；退役记录住 `docs/RETIRED.md`。

---

## 0. 为什么先收敛、后补证（顺序纠正）

原本 `T-#CERT-1` 的计划是"给 20 个无证工具各补一张最小契约证"。
**但 A 档这 11 个几乎全都要被吸收/合并** ⇒ 给它们写证是浪费：证会随合并失效，且证的成本比合并更高。

**正确顺序**：
```
① 收敛（吸收进设计侧 / 合并进既有入口）
② 只给**幸存者**写证（预计 5–6 张，而不是 20 张）
③ 顺手产出退役候选（无调用方 + 需外部前提 + 无证）
```

---

## 1. A 档 11 个读数工具的吸收表

| 工具 | 现状输出 | 吸收去向 | 需要什么 | 结论 |
|---|---|---|---|---|
| `code_health` | 死代码 / 圈复杂度 / 分层违规 → 健康分 + 清单 | **拆成判据**：分层违规 = 已有 `domain-independent`；死代码 = 新 kind `dead-code`；复杂度 = 新 kind `metric` | 2 个新判据 kind（现在加一个只改注册表 1 处）；"健康分"退化为**汇总视图**（跑那批判据），不是新事实 | 工具退场，能力进设计侧 |
| `capability_audit` | 语言 × 功能 AST 覆盖缺口 | 并入 **`capability_map`**（同一生态位：能力导航）作为一列读数 | `capability_map` 加 `lane=tools` 时附覆盖率 | 合并 |
| `impact_analysis` | 反向可达闭包 + 风险排序 | **写闸前置自动读数**：`edit_dsl` / `edit_code` 写入时自动算波及，高风险挂 L4 证据要求 | 写闸里加一次波及计算（图已有） | 工具退场，能力进闸 |
| `detect_drift` | 代码变更 → DSL 是否过时 | **能力已在别处**：`edit_dsl` 写入预判 / `patrol` / `design_line` 都判同一件事 | 无（复核覆盖度即可） | **直接退役候选** |
| `feature_line` | 功能主链 | 并入 **`get_dsl`**（`view=chain`）或 `design_line action=report` | 一个视图参数 | 合并 |
| `find_similar_names` | 孪生名（typo / 大小写 / 数字后缀） | 并入 **`rename_symbols`**：`dry_run` 时附"你可能想改这些" | rename 的 dry_run 输出加一段建议 | 合并（同一生态位：改名） |
| `suggest_renames` | 短名 / 无意义局部变量建议 | 并入 **`rename_symbols`**（同上） | 同上 | 合并 |
| `plan_refactor` | 批量替换清单（plan id + 命中级别 + diff） | 并入 **`apply_refactor_plan`** 的 `dry_run` 模式 | 已有 dry_run 语义，只需合并入口 | 合并（一对工具合一） |
| `read_project_docs` | 项目文档正文 / 清单 | 并入 **`explore_code`**（`kind=docs`） | 一个 kind | 合并（可延后：模型常直接要文档） |
| `render_design` | mindmap / svg / markdown | 并入 **`get_dsl`**（`format=mindmap\|svg\|md`） | 一个 format 参数 | 合并 |
| `tool_usage` | 使用与覆盖读数 / 死工具 / 过期记录 | 并入 **`capability_map`**（工具线读数）+ `scripts/audit-tool-certs.mjs`（已有） | 无 | 合并；★ 注意**使用日志被批量烟测污染**（每工具恰 17 次同日）⇒ 不能当"有人用"的证据 |

**净效果**：11 个工具 ⇒ **0 个新工具**，合并进 5 个既有入口（`get_dsl` / `rename_symbols` / `apply_refactor_plan` / `capability_map` / `explore_code`）+ 2 个新判据 kind。
工具面 **55 → 52 → 约 44**（已完成 3 笔）。

---

## 2. 执行顺序（按"最便宜先做"）

| 步 | 内容 | 涉及判据 | 代价 |
|---|---|---|---|
| **1** | 纯工具内合并（不动判据）：**`plan_refactor`→`apply_refactor_plan` ✅ 已完成（证 `t425` 13/0，工具面 55→54）** · `render_design`→`get_dsl` · `feature_line`→`get_dsl` · `find_similar_names`+`suggest_renames`→`rename_symbols` · `tool_usage`→`capability_map` · `capability_audit`→`capability_map` | 无 | 每合并**先立等价性基线证**（照 `t407` 的做法） |
| **2** | 变判据：`code_health` 拆成 `domain-independent`（分层）+ 新 `dead-code` + 新 `metric`（复杂度）；`impact_analysis` 变写闸前置；`detect_drift` 复核后退役 | 新增 2 个 kind（注册表 1 处） | 要写"判据覆盖了原来工具的全部读数"的对账 |
| **3** | 只给**幸存者**补证（预计 5–6 张） | 无 | 小 |

---

## 3. 风险与不做的部分

- **不能吸收的**：`read_project_docs` 是"输入侧"读物（模型要读文档正文），并进 `explore_code` 只是入口合并，**能力必须完整保留**；
- **`code_health` 的"健康分"是伪指标**：它是多个判据的加权汇总，**不要**让分数本身成为判据（会诱导"刷分"）⇒ 只保留逐条判据的红绿；
- **`capability_audit` 是框架自述**（我们支持什么），不是对项目的裁决 ⇒ 归 `capability_map`，**不要**做成项目判据；
- **每步合并都要等价性证**：合并前把旧工具的读数录成基线，合并后逐项比对（`t407` 已在 `observe` 五合一时验证过这条路）。
