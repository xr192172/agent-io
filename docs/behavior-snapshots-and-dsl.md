# 三种「快照」与 DSL 的实际视图（2026-10-08 查证）

> 起因：用户问 *「我们的 DSL 体系当时设计得挺好，现在可能已经废置了。
> 有没有办法做一个通用型的、保留代码功能快照，快速布下探针看是否和原来一样？」*
> 本文回答两件事：**DSL 到底废置了没有**；以及**仓里三个都叫"快照"的东西各是什么**。

## 一、DSL 体系：**没废置**，而且它**本来就有"实际代码快照"那一层**

`src/application/design/`（`bricks/ derive/ dsl_ops/ intent/ lifecycle/ workbench/ handlers.ts`）
对外导出 **`DESIGN_TOOLS: ToolDef[]`**，且**已注册进 MCP**
（`src/application/tool_registry.ts:46` → `['design', DESIGN_TOOLS]`；现行工具面实测 **61 个工具**，其中 design 车道 **12 个**）：

```
get_dsl  edit_dsl  manage_feature  render_design  render_brickwork  signal_review
split_stage  scaffold  consistency_check  detect_drift  import_project  design_intent
```

★★ **关键**：DSL 里的 `view` 参数有**两档** —— `design`（人写的设计视图）与 **`live`（实际代码快照，只读，拒绝写入）**；
`import_project` 带 `live_only=true` 时**只写 `live/`**，用途原文写着：
「供 **🎭设计 / ⚡实际 双视图对比**」。配套工具就是 **`consistency_check`**（一致性）与 **`detect_drift`**（漂移）。

⇒ **用户记忆里的"代码快照"确实存在，就在 DSL 体系里**（不是废弃，是"设计意图 vs 代码现状"的对照机制）。

## 二、★ 仓里三个"快照"—— **同名不同义，务必分清**（本仓最忌同名两义）

| 名字 | 住在哪 | 记的是**什么** | 用途 | 谁写 |
|---|---|---|---|---|
| `code-snapshots/` | `<proj>/.agent-io/code-snapshots/<id>/{meta.json,files/<rel>}` | **文件内容**（逐文件文本） | **回滚 / 改前备份**（默认留最近 20 份） | `application/refactor/snapshot/file_snapshot.ts`（rename 等写） |
| DSL `live` 视图 | `<proj>/live/` | **代码结构**（实际视图，只读） | **🎭设计 vs ⚡实际 对照** ⇒ `consistency_check` / `detect_drift` | `import_project --live_only` |
| **`snap:*`**（本次新建） | `.snapshots/behavior.json`（**进仓**） | **函数行为**（指纹） | **改前 vs 改后 对照** | `scripts/snapshot.mjs` |

★ **三者互补，不重叠**：
结构（DSL `live`）管"**代码长成什么样**"，行为（`snap:*`）管"**函数算出来是什么**"，
内容（`code-snapshots`）管"**改了能回滚**"。
⇒ 缺任何一角，另一角都替不了它。

## 三、本次补上的：**工具面纳入行为快照**

- 新观测点 **`tool-surface`**：61 个工具的 `name` / `title` / `description` / 入参键
  ⇒ **LLM 看到的全部就是它**，可是此前**没有任何东西钉住它**。
- 与门「**MCP 工具签名**」的**意图区别**（不许互相替代）：
  - 门（`scripts/mcp/mcp_scan.mjs`）验**当下签名合法/能跑**，输出写 `.inspect/mcp_scan.json`
    —— 而 `.inspect/` **被 gitignore** ⇒ **它不是基线**，没有"跟上次比"的能力。
  - 观测点记**契约文本指纹**，供 `snap:diff` **与上次比**。
- ★ **出生证**（注入 ⇒ 变红 ⇒ 还原）：
  ```
  注入：get_dsl 的 description 加四个字「（注入测试）」
    ❌ tool-surface  **1 处差异**
         tools[23].description
            旧: "统一只读入口：通过 query 参数查询 DSL 数据。query: dsl（…"
            新: "统一只读入口：通过 query 参数查询 DSL 数据。（注入测试）query: dsl（…"
  还原：✅ 5 个观测点全部与快照一致
  ```
  ⇒ 反证了缺口是真的：**早先我改 `get_dsl` 描述时，没有任何东西会变红。**

## 四、顺带记下一处漂移（待处理）

门「MCP 工具签名」的 `why` 文本写着「**59 个工具**的入参/出参契约」，而**实测工具面是 61 个**。
⇒ 文本与事实已差 2 个（工具面在长，那句话没跟）。**本笔只记录，未改**（改它要顺带确认那 2 个是什么）。

## 五、没做

- DSL 的 12 个工具**能不能真跑通**（`get_dsl` / `consistency_check` / `detect_drift` 在夹具上实际跑一遍）**没验** ——
  本次只钉住了它们的**契约文本**，没验**行为**。
- `scaffold/sc_bf/`（含 `INVARIANTS.md` + `a.ts`）看着像夹具，**没确认它是否可作 DSL 的夹具**。
- 门那句 "59" 的漂移**没修**。
