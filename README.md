# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

> 让代码工程自带「活文档」与「质量防线」。以标准 MCP server 的形式，将设计与契约编码为结构化的 DSL JSON——随代码演进自动回填、永不陈旧；同时把 LLM 的代码改造变成「准确编辑、运行时验证、失败可回滚」的受控流水线。

[中文](README.md) · [English](README.en.md)

![agent-io 配套前端 dsl-workbench 沙盘视图（真实 DSL 实时渲染）](assets/demo-workbench.png)

## 背景与定位

两个长期困扰工程协作的问题，agent-io 同时给出解法：

**问题一：文档漂移。** 任何设计文档、架构图都会在代码演进后过期，最终没人敢信。agent-io 把「设计真相」编码为**结构化的 DSL JSON**，随代码一起演进：语义层记录文件契约（files / apis / decisions），由 `scaffold`（action=backfill）从实现自动回填、由运行时观测（Observe）自动校正——**文档不再会过期**。

**问题二：改动失控。** LLM 改代码经常改错位置、改坏文件、无法验证，只能返工。agent-io 提供一条受控的改造流水线：符号级准确编辑（`edit_code`）→ 改前真实 diff 审批 → 运行时探针对账验证 → 通过才提交、失败自动回滚——**改动不再靠赌**。

DSL 双层结构是两者的共同根基：

* **`geometry`（几何层）**：节点位置与连线，描述"长什么样"；

* **`semantic`（语义层）**：节点含义、契约与决策，描述"为什么这么做"。

人机协作是这套机制的载体而非全部：LLM 与人类共享同一份 DSL JSON，前端将其渲染为可交互图形，供审阅、标注与修改。

本项目遵循**前后端分离**架构：

| 层            | 职责                                                          | 载体                                                               |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| **数据 / 协议层** | DSL 存取、代码理解、生成/回填/一致性、积木体系、运行时验证、诊断闭环，对外提供 MCP 工具与 HTTP API | 本仓库（MCP server）                                                  |
| **可视化协作前端**  | 将实时 DSL 渲染为可交互工作台（沙盘、版本对比、问题清单、探针、契约、代码审批）                  | [dsl-workbench](https://github.com/xr192172/dsl-workbench)（独立仓库） |
| **可视化协作前端**  | 将实时 DSL 渲染为可交互工作台（沙盘、版本对比、问题清单、探针、契约、代码审批）                  | [dsl-workbench](https://github.com/xr192172/dsl-workbench)（独立仓库） |

> ★ 2026-09-30：原「内置渲染器（`render_design` 的 `format=html`，把单张 DSL 渲成**自包含单文件 HTML**）」**已删除** ——
> 渲染效果差、且 lane 自己就标注"仅调试用"；可视化统一由上面的 [dsl-workbench](https://github.com/xr192172/dsl-workbench) 承担。
> `render_design` 仍在，但只保留 **mindmap / svg / markdown** 三种从存储读取的导出。

## 核心能力

一条主线贯穿全局：**任意代码 → 积木（原料端）→ 可信组合（质检端）**。「契约」是两端共享的唯一接口——积木线负责生产契约，验证线负责验证契约。

| 能力                | 说明                                             | 代表工具                                                                                                              |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **可视化协议层**        | DSL 读写编辑、设计视图与实际代码快照对比、思维导图/矢量图/文档导出                  | `get_dsl` / `edit_dsl` / `manage_feature` / `render_design` / `diff_views`                                        |
| **代码理解**          | 工程导入、语义搜索、影响分析、架构分层、单体拆分、算法/数据流推导              | `import_project` / `explore_code`                                                                                 |
| **代码积木体系**        | 从任意来源收割代码为带契约的积木：抽契约、拎 import 闭包、补决策卡（积木盒/拼装族已于 2026-10-05 删除，设计文档留在 `docs/`） | `harvest_closure` / `extract_contracts` / `harvest_decisions`                                                     |
| **运行时验证**         | 以实际运行观测对账契约与行为基线，形成「验证通过才提交，失败回滚」的防线           | `observe_instrument` / `observe_judge` / `reconcile_chain` / `reconcile_effects`                                  |
| **生成 / 回填 / 一致性** | 从 DSL 生成代码骨架，解析实现回填契约，输出一致性报告                  | `scaffold` / `consistency_check`                                                                                  |
| **确定性改造（防返工）**    | 符号级代码编辑（绝不匹配错）、批量/跨文件重命名、死代码清理、改前 diff 审批、失败回滚 | `edit_code` / `rename_*` / `refactor_pipeline`                                                                    |
| **诊断闭环**          | 症状 → 根因 → 修复 → 验证 → 提交（或回退）的完整链路               | `diagnose` / `refactor_judge` / `diagnose-loop`(CLI)                                                              |
| **多语言 AST 根基**    | 基于 tree-sitter 的符号 / import / 调用边 / 类型引用统一产出   | `ts_kernel` / `package_migration`                                                                                 |

## 快速开始

```bash
# 1. 将代码克隆到本地（首次）
git clone https://github.com/xr192172/agent-io.git
cd agent-io

# 2. 安装依赖
npm install

# 3. 构建
npm run build

# 4. 启动 MCP server（stdio 模式）
npm start
```

在 MCP client 配置中注册：

```json
{
  "mcpServers": {
    "agent-io": {
      "command": "node",
      "args": ["/path/to/agent-io/dist/src/server.js"]
    }
  }
}
```

也可以一键分发到各主流 MCP client（Claude / Cursor / VS Code / Codex / Copilot / Gemini / Windsurf / Cline）：

```bash
node scripts/install_mcp.mjs            # 写入全部已安装 client 的配置（自动合并 + 备份）
node scripts/install_mcp.mjs --list     # 查看各平台配置路径与写入状态
node scripts/install_mcp.mjs --dry-run  # 预览将写入的内容（不落盘）
node scripts/install_mcp.mjs --target claude  # 只写指定平台
```

### 一键体验（黄金演示路径）

想先看它长什么样？一条命令即可看到完整工作台——构建、注入内置示例、起服务、打开浏览器：

```bash
npm run demo                # 完整演示：渲染示例 → 启动服务 → 打开 /workbench
npm run demo -- 8081        # 指定端口
npm run demo -- --prepare   # 只准备示例（构建+渲染+注册），不起服务
```

浏览器会自动打开 `http://localhost:3000/workbench`：左侧画布是示例 DSL 渲染的可交互图（点击节点查看详情、条件分支动画流），右侧是沙盘反馈与代码审批。已有同名 feature 时自动跳过，不会覆盖你的数据。

> 完整可视化协作前端见 [dsl-workbench](https://github.com/xr192172/dsl-workbench)（独立仓库，本仓作为其后端）。
> ★ 本仓**不再自产**自包含 HTML 预览（2026-09-30 删除，见上方说明）。

## MCP 工具参考

共注册 **61 个 MCP 工具**，按「主工具 + 专项工具」组织：主工具承担统一入口，专项工具各司其职。

### 能力导航（1 个）

| 工具               | 用途                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `capability_map` | 能力线导航：6 条能力线（design/refactor/observe/harvest/cross/meta）× 线内工具与适用时机，agent 分层定位后进入具体工具；高频工具可绕过导航直接调用 |

**使用示例**

```json
// 1. 无参调用：返回全部 6 条能力线的地图（推荐：agent 开工前先定位）
{}

// 2. 只看某条能力线（如重构/改名线）
{ "lane": "refactor" }

// 3. lane 合法取值
{ "lane": "design" }    // 设计 / 活文档
{ "lane": "refactor" }  // 重构 / 改名
{ "lane": "observe" }   // 观测 / 验证
{ "lane": "harvest" }   // 契约 / 闭包采集
{ "lane": "cross" }     // 跨仓 / 翻译 / 健康
{ "lane": "meta" }      // 元信息 / 探索
```

> 用法提示：`capability_map` 是只读导航，无副作用。返回内容即「线 → 线内工具 → 何时用它」的三级地图，agent 据此选工具后再进入具体工具。高频工具（`get_dsl` / `edit_dsl` / `explore_code` / `rename_symbols` / `rename_files` / `find_references`）直接可用，无需先经本工具。
>
> 目录**由工具注册表自动派生**（`src/tools/capability_map.ts` 的 `LANE_OF` 只写「工具 → 线」归属，`when` 缺省取注册描述首句）：新增工具只需补一行归属，不会与注册表脱节；漏标的工具会在输出里单列「未归线」段显式暴露，不会静默消失。一致性由 `tests/tools/capability_map.test.ts` 对真实 `TOOL_DEFS` 断言兜底。

### 主工具（7 个）

| 主工具                 | 用途                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------- |
| `get_dsl`           | 统一只读入口：DSL / 节点 / 边 / 文件 / 决策 / 批注 / 快照 / 仿真状态 / 差异等查询，支持 `view`（design/live）与过滤参数 |
| `edit_dsl`          | 统一写入口：`operations[]` 批量增删改、语义绑定、状态更新、标注、审批、自动布局，按序执行、任一失败全量回滚（原子）                  |
| `manage_feature`    | 功能生命周期管理：create / clone / template / list / delete                                 |
| `render_design`     | 渲染入口：mindmap（默认）/ svg / markdown，均从存储按 `feature` 读取；`output_path` 指定输出路径                                |
| `scaffold`          | 脚手架统一入口：`action=generate`（从 DSL 语义层生成代码骨架，vue / react / html + 状态推断）/ `action=backfill`（解析实现代码 API 签名回填 actual\_apis，输出差异报告） |
| `consistency_check` | 对比预期契约与实际代码，输出一致性报告与跨文件不变式（只读）                                                     |
| `explore_code`      | 代码理解入口：语义搜索、影响分析、架构分层、单体检测、拆分建议、算法/数据流推导、仿真回放等                                     |

### 专项工具

> ★ **下表是按主题分组的精选子集**（便于检索，**不等同于全量清单**）；**权威计数以 `TOOL_DEFS` 为准**
> （`README.en.md` 一直这么声明）。
> ★ **2026-10-06：标题里的数字已去掉** —— 它作为"精选子集"的计数**必然与行数不等**，
>   而手维护的数字只会持续漂（这个位置先后写过 **34 / 41 / 51**，没有一次等于当时行数）。
>   要总数请看 `capability_map`（由注册表自动派生，不会漂）。

**代码理解**

| 工具                 | 用途                                             |
| ------------------ | ---------------------------------------------- |
| `import_project`   | 导入代码项目为 DSL（支持本地绝对路径与浏览器上传，遵循 `.gitignore` 过滤） |
| `diff_views`       | 对比设计视图与 live 代码快照                              |
| `render_brickwork` | 渲染依赖驱动的功能社区工作台（积木化预览）                          |
| `find_references`  | 查符号/字段引用（引用视角：改前看波及面），只读                       |
| `detect_drift`     | 对照代码变更，检查设计是否过时 / 欠实现                          |

**积木体系**

| 工具                  | 用途                                                              |
| ------------------- | --------------------------------------------------------------- |
| `harvest_closure`   | 连同传递 import 闭包收割积木                                              |
| `extract_contracts` | 抽取积木契约（role / shapes / effects）                                 |
| `reconcile_effects` | 用运行时观测对账 effect 候选                                              |
| `narrate_step`      | 将流水线步骤叙述为受治理的叙述积木                                               |
| `harvest_decisions` | 从项目记录反向采集设计决策                                                   |
| `signal_review`     | 混合文件解耦信号的 **LLM 复核**（拆分链第一棒）：取 brickify 的 `mixed_files` → 逐信号喂 LLM → 逐簇【采纳/驳回 + 功能名 + 理由】；LLM 不可用时**诚实降级**（不伪造结论）；`report_path` 落盘可直接喂 `split_stage` |
| `split_stage`       | 拆分执行器（拆分链最后一棒）：消费 `signal_review` 报告，把采纳簇按簇切出独立文件。**默认 dry-run**，`apply=true` 才落盘（编译/测试级验收 + 失败回滚兜底） |

**运行时验证（Observe）**

| 工具                   | 用途                                      |
| -------------------- | --------------------------------------- |
| `observe_instrument` | 自动插桩 / 还原 TS 项目，写盘后生成探针台账与统计            |
| `observe_log`        | 按文件查询运行时日志                              |
| `observe_judge`      | 批量裁决运行时事件                               |
| `observe_trace`      | 读录制调用链回放：从 events.jsonl 重建结构化调用树（纯后端，LLM 分析用） |
| `feature_line`       | 功能线：每个功能搭一条主链（功能→入口→调用节点），供沿线单步运行/投大屏点位 |
| `reconcile_chain`    | 将宿主链与其真实运行事件对账                          |
| `run_tests`          | 跑测试返回结构化失败定位（filter 定向 / 全量）            |

**确定性改造**

| 工具                    | 用途                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `edit_code`           | 符号级代码编辑（replace / insert / delete / range）                                                                  |
| `rename_symbols`      | 标识符改名**统一入口**：`scope=module`（缺省）改跨文件模块级符号、全批原子；`scope=local` 改文件内局部绑定、作用域隔离、逐项独立。`renames=[{file,symbol,to,decl_line?}]`，整体先 `dry_run` 预览 |
| `rename_files`        | 批量文件重命名（单条或批量统一入口，整体先 dry-run）                                                                              |
| `remove_dead_imports` | 移除失效 import                                                                                                 |
| `plan_refactor`       | **先算清单**（只读）：把一批 `file`+`old_text`+`new_text` 算成可审、可复跑、可入账的清单（plan id + 命中级别 + diff 预览），把"算清单"放回工具体内 |
| `apply_refactor_plan` | 按 `plan_refactor` 的清单落盘（**幂等**：重复 apply 不重复改；`plan_id` 指纹不符即报错）                                            |
| `snapshot`            | 代码快照**统一入口**（`action=list` / `rollback`）：列快照（每次 `edit_code` / `rename_files` / `move_symbol` 落盘前自动存一份的撤回点），或回滚到某一份（省略 = 最近一份，`file` 可只回滚单文件）。★ 回滚**立即落盘、没有 dry-run 预览**，且回滚本身不留快照 ⇒ **不可再撤回**（与 DSL 设计快照不同，后者走 `get_dsl(query="snapshots")`） |
| `refactor_pipeline`   | 确定性重构流水线（死代码清理 + 包迁移 + 函数语义注释；按项目探测语言并跑语言专属 stage——Java 工程自动触发 Spring MVC 分层迁移、Python 走其死代码清理，落盘/验证/回滚统一闭环） |
| `annotate_functions`  | 函数语义注释（TS/JS + Go）：扫覆盖→缺失用 LLM 补→`@fnhash` body 指纹同步过期；mode=scan/dry\_run/apply                             |
| `suggest_renames`     | 为短名 / 无意义变量建议语义化名字（含混淆/压缩代码的短名还原可读）                                                                         |
| `find_similar_names`  | 检测易混淆相似名并消歧                                                                                                 |

> **反混淆边界**：完整"解混淆"是启发/LLM 级的非确定性还原，不适合作为确定性重构管线的
> 基础工具。可逆的那半（保结构改名）走 `suggest_renames` + `rename_symbols`（可回滚）；
> 字符串加密/扁平化等不可逆或不可判定的，留给人 / LLM —— 别指望"编译→反汇编"能救可读（可读信息在编译期已丢）。

**规则库（修复 → 规则沉淀）**

把**一次实际修复**沉淀成可复跑的规则，下次自动拦住同类回归。规则 = 一个自包含 `.md`
（frontmatter + 说明 + `pattern`/`replace` + 正/反例夹具），住在 `<project>/.agent-io/rules/`。

| 工具                      | 用途                                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules`                 | 规则库**统一入口**（`action=export` / `apply` / `check`）。`export`：从 before/after **自动萃取**规则——标识符抽象成 `$hole`，自动生成正/反例夹具，过「出生回归 / 反例不命中 / 幂等」三关才准落盘（不过关则如实降级为字面量规则，且 `dry_run=false` 也不写盘）；`apply`：把规则库批量应用到源码，**三态**：`applied`（唯一命中 ⇒ 改写）/ `todo`（歧义 ⇒ 插 TODO 注释，不失败）/ `clean`，默认 dry-run，`dry_run=false` 才落盘（走写闸）；`check`：把规则库当 lint 跑，带 **CI 棘轮**——只在「新增命中」上 fail（存量不拦），`update_baseline=true` 收紧基线，同时自检每条规则的夹具 |

> **与 Grit/GritQL 的差异**：形态（md 载体、`$hole`、棘轮、`todo()` 半修）对齐，但两处是我们独有 ——
> ① **反例夹具**（Grit stdlib 零反例，缺阴性对照就无法证明「只在该改的地方改」）；
> ② **萃取动作**（Grit 的 pattern 全靠专家手写，没有「从改动本身长出规则」的路径）。

**诊断与审阅**

| 工具               | 用途                                         |
| ---------------- | ------------------------------------------ |
| `refactor_judge` | LLM 审裁决门：采纳 / 驳回 / 上抛不确定项                  |
| `diagnose`       | 症状 → 根因分析：定位候选 → 调用链追溯 → 影响面 → 根因聚合 → 验证建议 |
| `capability_audit` | **能力矩阵自检**（只读、纯计算）：语言 × 功能的 AST 覆盖缺口清单 ⇒ "补哪个功能、补哪门语言"的决策输入。★ 与 `capability_map` 不是一回事（那是**工具导航**，本工具审**语言支持度**） |

| `upgrade` | **版本升级契约差**（单入口两动作）：`scan`（只读）报「工具链声明 vs 本机 / 语言特性超标 / 废弃-移除 API / 未覆盖扩展名（没被检查的要说清）」，可选 `gate`（编译级）/ `dynamic`（运行级，★ 真跑源码）两闸；`apply` 走闭环：精确串替换 → 改前基线提交 → 验证 → **通过则提交、失败则 git 回退**（★ 前置：`project_dir` 须是 git 仓库；基线会把工作区**原有改动一并提交**）|

**设计意图（overlay）**

| 工具               | 用途                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design_intent` | 设计意图(why)统一入口（`action=set` / `propose`）。`set`：直接写 goals（结构化目标/方向）+ edge\_intents（「A 为何依赖 B」/边界归属）到设计意图 overlay，随即落进 base 的 `meta.goals` / `edge.intent` 供 LLM 与读端消费；`propose`：LLM 代拟「设计意图改写」审批卡，只算前后 intent diff **不写盘**，人在工作台「代码审批」approve 后才真写 DSL（reject 则丢弃，人只做决策审批） |

**画布批注**

| 工具               | 用途                                                                 |
| ---------------- | ------------------------------------------------------------------ |
| `canvas_notes`   | 画布批注统一入口（read=读成语义工单 / mark=更新状态 / decide=LLM 决策）                 |
| `archive`        | 下线库统一入口（node=把文件下线归档·写且不可逆 / list=列出已归档条目·只读）                      |
| `sync_contracts` | 以 server\_registry schema 为源，回填 DSL 契约                            |

**LLM 网关**

| 工具                 | 用途                                                      |
| ------------------ | ------------------------------------------------------- |
| `gateway_provider` | LLM 供应商/用量统一入口（list / upsert / delete / stats 四 action） |

**项目文档**

| 工具                  | 用途                       |
| ------------------- | ------------------------ |
| `read_project_docs` | 读取项目 `docs/` 目录下的文档清单与正文 |

**迁移与评估**

| 工具                        | 用途                                                   |
| ------------------------- | ---------------------------------------------------- |
| `impact_analysis`         | 改前风险闭包报告：变更点→反向可达闭包，输出受影响文件与风险排序（`hubs=true` 热区盘点）   |
| `cross_repo_symbol_index` | 跨项目符号索引：两仓顶层符号求交=冲突/双胞胎、求差=迁移范围                      |
| `behavior_baseline`       | 行为基线：金丝雀 harness 跑样例记录快照，改后对比验证「跑得对不对」               |
| `code_health`             | 代码健康度：死代码 / 圈复杂度 / 分层违规 → 健康分 + 问题清单                 |

### `view` 参数

* `design`（默认）：设计视图——活跃 DSL + 功能存档，是 LLM 主动设计与迭代的对象，对应浏览器「设计」视图；

* `live`：实际视图——只读的代码快照，由 `import_project` / `explore_code` 重建，对应浏览器「实际」视图。

设计视图是迭代的对象，实际视图是代码的现状，二者通过 `diff_views` 对比。

## 能力矩阵与多语言支持

工具基于 **tree-sitter** 的按需语言解析器。

> ★★ **2026-10-08 更正**：此处原写「**168+ 语言 AST 解析器**」——**这个数没有出处**。
> 实测（`git clone tree-sitter.wiki.git` 的 `List-of-parsers.md`，即官方文档站所指向的那份清单）：
> **表 509 行 / 440 个去重解析器名 / 482 个仓库**；其中 **227 个在 npm 上有包、213 个只能在 GitHub 拿源码**。
> 而**本仓注册表只登记了 55 条**，且其中 **11 条**的包名与 npm 事实不符（已用 `pkgSpec` 显式声明，
> `npm run lang:check` 可复跑核对）⇒ **别拿上游的量级描述本仓的能力**。

核心通用根基 `ts_kernel` 对**已安装且可用**的语言提供符号 / import / 调用边 / 类型引用；部分改造类功能按语言分级落地：

* **full\_ast**：Go / TypeScript / JS 家族全量；Python 视功能而定

* **regex\_fallback**：少数功能对个别语言回退到正则

* **unimplemented**：未落地的「功能 × 语言」对——显式登记，可见、可排期

体检时自动扫描缺口：

```bash
npm run doctor        # 环境就绪检查 + 能力矩阵缺口自检
npm run capability    # 单独输出能力缺口（JSON / 人类可读）
```

## 诊断闭环（CLI）

`diagnose-loop` 将诊断从「只给建议」升级为「闭环执行」：诊断 → 修复 → 验证 → 提交（或回退）。

```bash
npm run diagnose-loop -- --project <项目目录> --symptom "<症状>"
```

| 参数                     | 说明                           |
| ---------------------- | ---------------------------- |
| `--project <dir>`      | 目标项目（必须是 git 仓库，回退依赖 git 还原） |
| `--symptom "<症状>"`     | 症状描述（报错信息 / 现象）              |
| `--auto`               | 全自动：基线提交 + 跳过补丁审批 + 验证通过自动提交 |
| `--apply`              | 跳过补丁审批直接应用（仍先打印待审批真实 diff）   |
| `--skip-verify`        | 跳过验证阶段                       |
| `--verify-timeout <秒>` | 验证命令超时（默认 300s）              |

执行流程：基线快照（改前自动提交）→ 建立符号缓存 → 诊断（规则 + LLM 双引擎）→ LLM 行级补丁（修改白名单 + 行号越界校验 + 审批展示真实 diff）→ 运行项目测试验证：通过则精确提交补丁文件，失败则自动回退。

## 验证方式

本项目**不设单元测试套件**（2026-10-04 裁定）。验证靠三条，全部零测试框架依赖：

```bash
npm run build                            # 类型检查 + 构建（tsc 是第一道闸门）
npm run doctor                           # 环境体检 + 能力缺口
npm run tool -- <工具名> --json '{...}'   # 真调一个工具 —— 这才是唯一有意义的验收
```

CI 另跑 `archify vendor doctor`（守第三方 vendor 的 renderer + schema + example 三件套完整）
与 Go 语言包（observe-lang-go）的编译与测试。

## 挂起的线

* **R5（archify 渲染线）已挂起**：保留在仓内、暂不开发，以免影响主线。
  **对外契约（`/api/archify-demo`）与中性数据层（`view_inputs.ts`）不受挂起影响。**
  详见 [docs/r5-archify-hung.md](docs/r5-archify-hung.md)。

## 技术栈

* **MCP server**：TypeScript + [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

* **AST 解析**：tree-sitter（Go / TypeScript / Python / JavaScript），动态检测语言包

* **渲染器**：HTML 字符串拼接（零构建链，产物单文件自包含）

* **Schema 校验**：ajv + ajv-formats

## Agent 指引

仓库内置面向 Agent 的 skill（`.trae/skills/`）：

* **agent-io-router**：渐进披露路由，按「遇到什么问题 → 调哪个工具」分层定位，先查询已有能力再决定是否新建工具；

* **agent-io-mind**：心智外衣，提供能力地图、需求到工具链的编排、工具调用缓存与诚实交付纪律。

使用本工具链前建议先加载这两个 skill，避免重复造轮子。

## License

MIT
