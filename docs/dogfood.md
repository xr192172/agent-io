# 用本仓工具时的体验

> 只记**还没解决的**。解决了就删这一行。不写"为什么"，不写原话。

## 真 bug

| 什么 | 在哪 |
|---|---|
| `edit_code` 接受空操作（`old_text == new_text` 也回 ✓ 并重建索引） | `edit_code.ts` |
| `remove_dead_imports` 不能按文件调（必填 `dead` 列表，得先有别的工具算） | `remove_dead_imports.ts` |
| `claim` 对 `todo` 走 `geometry.nodes` 定位（陈旧 todo 销不了账） | `task_ops.ts` |
| `todo.add` 不查同名（重复条目） | `task_ops.ts` |
| `todo` 的 summary 截断后无补救（没有 `update type=todo`） | `task_ops.ts` |

## 结构

| 什么 | 在哪 |
|---|---|
| L1 建构卡收不了口（`publish` 只能立 L1，`complete` 要求建构完整 ⇒ 只能 release） | `task_ops.ts` |
| `satisfied` 的卡锁死文件（`claim` 拒"没活干"，写闸只认 claimed） | `task_ops.ts` |
| `hook-task-gate.mjs` 是死闸（读不存在的文件；按 `path` 匹配而节点无 `path`） | `scripts/` |
| `docs/gate-principle.md` 不存在但被 9~21 处引用 | 引用点 |
| 12~25 个节点指向盘上不存在的路径 | `.agent-io/design/` |
| `t337` 前提已破（两个 writer 写同一文件） | `certs/` |

## 运维

| 什么 | 在哪 |
|---|---|
| 改完源码不 build，工具跑的还是旧 `dist`；`STALE_SOURCE` 没说"现在看到的是旧逻辑" | `cli` / MCP |
| `verify` 会偶发 FAIL（夹具 `database is locked`），重跑即绿 | `scripts/verify.mjs` |
| 3 个脚本 import `dist`（tsx 已装未用） | `scripts/` |
| 没有"这个文件受不受闸 / 归谁的卡"的查询工具（只能自己读 JSON） | 工具面缺 |
| `watch` / `impact` 假报"改 A 报 B" | `import_project` |

## 输入

| 什么 | 在哪 |
|---|---|
| `edit_dsl` 参数互斥很脆（`project_dir` 要放进 JSON，混用报"歧义"） | `design/index.ts` |
| `edit_dsl` 的 L3 拒因太泛（`reason` 里要带实体，但提示是【被拒之后】才教） | `reason` 校验 |
| CLI 传中文/引号只能整段 `--json`，手写易错（反引号会被 bash 吃） | `cli` |
| `publish` 收 `data.reason` 就整批回滚，与同文件另一处提示矛盾 | `task_ops.ts` |

---

## 已修（一行一条，便于对照）

`design_line ok:true 语义过载`（→ `did_work`+`reason`）· `写闸看不见 feature`（→ `listDesignSheets`）· `edit_code 扔掉闸的 note`（→ `gate_note`）· `A7 恒 null`（→ `actor` 入参）· `saveDSL 不 mkdir` · `TERMINAL_TASK_STATES` 两套答案（→ `CLOSED_TASK_STATES`）· `design-db 路径写两处`（→ `designDbDir()`）· `gen-db check 假门`（→ `planDesignDb` + 第 6 道门）
