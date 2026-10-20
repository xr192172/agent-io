# LLM 怎么写一个新功能（渐进式重写的手册）

> ★ 前提更正（2026-10-20）：本仓文档里的"人写实现"，**"人" = LLM / agent，不是真人类**。
> 所以不存在"必须有人手敲"的环节 —— 实现由 LLM 按设计意图写，工具负责**定位、约束、验证**。

---

## 一、为什么不是一个"一键重写"

设计侧只有**结构和意图**（符号 / 签名 / 成员 / 引用 / import span），没有函数体。
⇒ 实现必须由 LLM 推理生成 —— 这不是缺陷，是**分工**：

| 谁 | 干什么 |
|---|---|
| DSL（设计侧） | 说清**有什么**（符号、签名、成员、依赖、判据） |
| 工具 | 算出**差在哪**、**改得对不对**、**回执说清改了什么** |
| **LLM** | **写实现**（用工具落地，不手改文件） |

---

## 二、链路（实测可用，2026-10-20）

### 第 1 步：看缺什么

```bash
node dist/src/presentation/cli/cli.js design_line project_dir=. feature=<feature> action=diff
```

实测输出（今天）：
```
设计 625 节点 · 1134 边    实际 637 节点 · 1139 边
+ 只在设计侧（设计了、实际还没有）：4 个
    + dir_src_application_design_bricks
    + dir_src_presentation_cli_render
    + file_scripts_snapshot_mjs
    + file_scripts_structure_gap_mjs
- 只在实际侧（实际有、设计没收录）：16 个
```

★ **"只在设计侧"就是待实现清单**（渐进式重写的入口）。
★ "只在实际侧"是**设计漏了**（要走 sync，不是写代码）。

### 第 2 步：看这个节点该长什么样

```bash
node dist/src/presentation/cli/cli.js get_dsl project_dir=. feature=<feature> query=node node_id=<节点id>
```

★ **注意**：取单个节点用 `query=node`（单数）+ `node_id`；
`query=nodes` 是列表，**会忽略 `node_id`**（今天踩过）。

从节点详情里能拿到：`scope`（要建哪些文件）、`decision`（判据）、以及与它相连的边
（⇒ **这个节点该依赖谁、被谁依赖**）。

### 第 3 步：建新文件（骨架）

```bash
node dist/src/presentation/cli/cli.js edit_code project_dir=. file=<相对路径> op=insert code="..."
```

★ `edit_code` 的 `insert` 会**先建目录再落盘**（`write_gate.ts:1148` 的同一做法）。

### 第 4 步：写实现

```bash
# 按符号整块替换（推荐：能带上契约）
node dist/src/presentation/cli/cli.js edit_code project_dir=. file=<路径> op=symbol symbol=<名字> code="..."
# 或按文本替换
node dist/src/presentation/cli/cli.js edit_code project_dir=. file=<路径> op=replace_text old_text="..." new_text="..."
```

★ **这是 LLM 唯一"创造"的地方** —— 工具不替你写实现，但它会：
- **语法门**：写进去的代码语法坏了 ⇒ 不落盘
- **索引重建**：落盘后自动 `syncFile` ⇒ 后续读数是最新的
- **回执**：`匹配 L1·exact` + 行号 + diff + 符号 diff（`+0 -0 ~1`）

### 第 5 步：签名对齐（收尾，可选）

```bash
node dist/src/presentation/cli/cli.js design_line project_dir=. feature=<feature> action=rewrite apply=true
```

★ 这一步**只做一件事**：源码签名与设计签名不一致时，**把源码改回设计**。
它**不生成实现**。**名字骗人**（dogfood #29：`ok:true` 在四种情况下都一样）。

---

## 三、这套东西现在的真实边界（别假装它更强）

| 能力 | 有吗 | 说明 |
|---|---|---|
| 算"缺哪些节点" | ✅ | `action=diff`（节点级） |
| 算"签名差在哪" | ✅ | `action=rewrite`（**只 function**；const/type/interface 在 `uncompared`） |
| 查节点意图 | ✅ | `get_dsl query=node` |
| 建新文件 | ✅ | `edit_code op=insert` |
| 写实现 | ✅ | `edit_code op=symbol`（**LLM 自己推理**） |
| 语法校验 | ✅ | 语法门（坏了不落盘） |
| 索引同步 | ✅ | `edit_code` 落盘后自动重建 |
| **按设计生成实现** | ❌ | DSL 没有函数体 ⇒ **只能 LLM 写** |
| **算"这个新文件里该有哪些符号"** | ⚠️ | 节点详情里有 `scope` / 边，但**没有"必含符号清单"** |
| 一键重写整个文件 | ❌ | 没有；**也不该有**（实现要 LLM 写） |

---

## 四、派子代理做这类活的硬约束

见 `docs/subagent-template.md`：**改代码只许 `edit_code` / `design_line`，禁 `Write` / `Edit`**。

理由：`edit_code` 会重建索引，`Write` 不会；写闸只装在仓内工具。
