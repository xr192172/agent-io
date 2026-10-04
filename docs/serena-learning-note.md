# Serena 学习笔记（工具面视角）

> 对象：`oraios/serena`（GitHub）。一手源码：`D:\project_develop\_research\serena`（`git clone --depth 1`，2026-10-05）。
> 用途：它是本仓一直以来的**同层对照物**——同样通过 MCP 给 LLM 提供「读代码 / 改代码」能力。
> 本文重点是**工具级差异**（逐条对照本仓 56 个工具），不是它的功能宣传。

---

## 0. 一句话

Serena 是一个**基于 MCP 的编码工具箱**：把「按符号读 / 按符号改」的能力拆成一组 MCP 工具交给 LLM，底层**每种语言起一个 LSP server** 拿语义（Python 实现）。它和我们同层同构，区别在**取信息的内核**和**业务代码放在哪一层**。

---

## 1. 先取证：许可证（分组件）

Serena 不是单一许可证，**按目录分**（权威文件 `LICENSE`，另有 `LICENSES/GPL-3.0-or-later.txt`、`LICENSES/MIT.txt`）：

| 组件 | 路径 | 许可证 |
|---|---|---|
| **SolidLSP**（语言服务客户端库，即它的"代码智能内核"） | `src/solidlsp/`、`test/solidlsp/` | **MIT**（可独立提取、单独按 MIT 使用） |
| **Serena 应用本体**（agent / tools / MCP server / prompts / scripts / docs） | `src/serena/`、`src/interprompt/`、`scripts/`、`test/serena/` | **GPL-3.0-or-later** |

- 两者合在一起分发（如 `serena-agent` 包）整体按 **GPL-3.0-or-later** 走（`LICENSE:7-11`）。
- **历史 cutoff**（`LICENSE:51-66`）：v1.7.0 及之前的提交是 **MIT**；`v2` 起应用本体转 GPL。
- ⇒ 结论：**机制可借鉴**（思想/编排形态不受许可证约束）；**`src/serena/` 下的代码不可直接搬进本仓（GPL 传染）**；`src/solidlsp/` 的代码 MIT，理论可搬，但本仓不用 LSP，实际用不上。

---

## 2. 它的工具面（共 **53** 个）

**数法**（写清口径）：数 `src/serena/tools/*.py` 里**自带 `apply()` 的 `Tool` 子类**（注册表 `ToolRegistry` 的入选条件是 `"apply" in c.__dict__`，见 `tools_base.py:489`）。工具名由类名去 `Tool` 后缀 + snake_case 得到（`tools_base.py:161-168`）。
逐模块：cmd 1 + config 4 + file 10 + jetbrains 13 + memory 6 + query_project 2 + repl 1 + symbol 13 + workflow 3 = **53**。
（`tools_base.py` 里另有 1 个 `\bdef apply`，是 `apply_ex` 中央信封，**不算工具**。）

按能力分组的 53 个工具（名字 + 干什么）：

**A. 文件 / 文本（10）** — `file_tools.py`
`read_file` 读文件（行区间）· `create_text_file` 新建/覆盖 · `list_dir` 列目录（可递归）· `find_file` 按文件名/mask 找 · `replace_content` 单文件替换（literal/regex）· `replace_in_files` **跨文件替换**（dry-run + 选中 occurrence_id + `expected_count` 计数守卫）· `delete_lines` 删行区间（可选）· `replace_lines` 替换行区间（可选）· `insert_at_line` 某行插入（可选）· `search_for_pattern` 正则全文搜索（上下文行 + glob）

**B. 符号·读（8）** — `symbol_tools.py`
`get_symbols_overview` 文件顶层符号概览 · `find_symbol` 按 name_path 搜符号 · `find_referencing_symbols` 找引用 · `find_implementations` 找实现 · `find_declaration` 按正则找声明 · `get_diagnostics_for_file` 文件诊断（按符号分组）· `get_diagnostics_for_symbol` 符号诊断（可选）· `restart_language_server` 重启 LSP（可选）

**C. 符号·写（5）** — `symbol_tools.py`
`replace_symbol_body` 替换符号体 · `insert_after_symbol` / `insert_before_symbol` 符号前后插入 · `rename_symbol` 跨库重命名（LSP refactor）· `safe_delete_symbol` 无引用才删

**D. 项目记忆（6）** — `memory_tools.py`
`write_memory` / `read_memory` / `list_memories` / `delete_memory` / `rename_memory` / `edit_memory`（md 形式的项目知识，供后续任务读）

**E. 配置 / 会话（4）** — `config_tools.py`
`open_dashboard` 打开 web 面板（可选）· `activate_project` 激活项目 · `remove_project` 移除项目（可选）· `get_current_config` 打印当前配置

**F. 工作流（3）** — `workflow_tools.py`
`onboarding` 项目结构上手 · `initial_instructions` 取"使用手册" · `serena_info` 按主题取进阶信息（可选）

**G. 命令（1）** — `execute_shell_command`（`cmd_tools.py`）

**H. 跨项目（2，可选）** — `list_queryable_projects` / `query_project`（在**别的**项目上下文里跑只读工具）

**I. REPL（1，可选/beta）** — `serena_repl`：执行 Python，通过对象 `s.<facade>` 直接调它的全部能力（绕过逐个 MCP 工具）

**J. JetBrains 后端（13，全部可选）** — `jet_brains_find_symbol` / `move` / `safe_delete` / `inline_symbol` / `find_referencing_symbols` / `get_symbols_overview` / `type_hierarchy` / `find_declaration` / `find_implementations` / `rename` / `debug` / `run_inspections` / `list_inspections`

> 注：J 组是 B/C 两组在 **JetBrains 插件后端**下的平行实现，且明确用 `ToolMarkerOptional` 默认关闭（`jetbrains_tools.py` 每个类都带该标记）。这套 IDE 后端给了它 B/C 组没有的能力：`move` / `inline_symbol` / `type_hierarchy` / `debug` / `inspections`。

---

## 3. ★ 工具级对照表（本文核心）

> 我们侧 56 个工具的权威清单来自 `src/application/*/index.ts`（`grep "^    name: '"` 实测，2026-10-05）。

| 能力簇 | Serena 工具 | 我们的对应物 | 差异 / 谁更强 |
|---|---|---|---|
| 读文件 / 列目录 / 找文件 | `read_file` `list_dir` `find_file` | **无对应** | 我们假定宿主（编码客户端）自带 Read/Glob/Grep，**不做 fs 层**。Serena 自带，是"host 无关"取舍 |
| 全文正则搜索 | `search_for_pattern` | `explore_code`（`action=read/搜索`） | 相近；它有上下文行参数，我们偏语义 action |
| 单文件替换 | `replace_content` | `edit_code`（replace） | 相近；都用 literal/regex |
| **跨文件批量替换** | `replace_in_files`（dry-run + occurrence_id 选择 + `expected_count` 守卫） | **`plan_refactor` + `apply_refactor_plan`** | ★ 强对应、含金量高。我们更重：**幂等**（重复 apply 不重复改）+ **plan_id 指纹**（不符即报错）；它更轻：一次调用内 dry-run→选 id→落盘 |
| 符号概览 / 搜索 | `get_symbols_overview` `find_symbol` | `explore_code` | 它的 `find_symbol` 支持 name_path 模式 + kinds 过滤 + `max_matches`；我们靠 tree-sitter 符号表 + 启发式 |
| **找引用** | `find_referencing_symbols` | **`find_references`** | ★ **我们更强**：它有字段级（读/构造/解构/声明点）、类型模式、`report_literals` 扫 snake 变体字面量；它只有"引用符号"一档 |
| 找实现 / 找声明 | `find_implementations` `find_declaration` | **无直接对应** | ★ **语义缺口**：LSP 能答"谁实现了这个接口"；tree-sitter 只有语法。我们 `mode=type` 自认是"启发式，非类型求解器" |
| 运行诊断 | `get_diagnostics_for_file` `get_diagnostics_for_symbol` | `code_health` `consistency_check` `detect_drift` `index_integrity` | 形态不同：它取**编译器/LSP 真诊断**；我们是**项目级体检/对账**（死代码、分层违规、设计漂移） |
| 符号级写 | `replace_symbol_body` `insert_after_symbol` `insert_before_symbol` | `edit_code`（insert/replace/delete/range） | 相当；我们统一入口 + 索引重建，它按符号体粒度 |
| **重命名** | `rename_symbol`（LSP，跨库、能含重载签名） | **`rename_symbols`**（scope=module/local）`rename_files` `move_symbol` `suggest_renames` `find_similar_names` | ★ 各有强项：它**语义准**（含重载）；我们**面更宽**（模块级/局部绑定/文件改名/移动/相似名消歧） |
| 安全删除 | `safe_delete_symbol` | 无直接 | 我们有 `impact_analysis`（改前风险闭包）+ `remove_dead_imports`，但没有"无引用才删一符号"的原子入口 |
| 项目记忆 | `write/read/list/delete/rename/edit_memory` | `read_project_docs`（读侧）+ `canvas_notes`/`design_intent`/`harvest_decisions` | 部分对应；**写侧缺一个"给未来任务留知识"的通用 memory 工具** |
| 会话 / 配置 | `activate_project` `get_current_config` `remove_project` | `import_project` `gateway_provider` | 相近（项目注册与管理） |
| 上手 / 导航 | `onboarding` `initial_instructions` | **`capability_map`** | ★ 强对应：都是"能力线导航 + 上手手册" |
| 跑命令 | `execute_shell_command` | `run_tests`（定向） | 我们有定向测试定位，**无通用 shell 工具** |
| 跨项目查询 | `query_project` `list_queryable_projects` | `cross_repo_symbol_index` | 形态不同：它是"在别的项目里跑只读工具"；我们是"两项目符号集求交/差" |
| **IDE 深度重构** | `jet_brains_move` `inline_symbol` `type_hierarchy` `debug` `run_inspections` … | **无** | ★ **我们完全缺失的一类**：移动/内联/类型层级/调试/IDE 检查 |
| REPL 直达 | `serena_repl`（`s.<facade>`） | 无 | 用一段 Python 把 N 个工具编排成一次调用 |
| **设计 / DSL 层** | **无** | `get_dsl` `edit_dsl` `scaffold` `consistency_check` `design_intent` `observe_*` `reconcile_*` … | ★ **它完全没有**：无"设计真相/契约/运行时对账/受控改造流水线"概念 |

### 3.1 最关键的三条差异（核实后）

1. **多语言适配：LSP（语义）vs tree-sitter（语法）。**
   Serena：`src/solidlsp/language_servers/` 下 **76 个语言服务模块**，`Language` 枚举 **75 个成员**——**每种语言一个 LSP server**，进程管理/启动代价大（`ls_process.py` 830 行 + `ls_utils.py` 866 行 ≈ **1,696 行**）。
   我们：`src/infrastructure/parse/languages.ts` 一张 **55 条语言登记表**（tree-sitter 节点类型映射，装了对应 npm 包才启用）。
   ⇒ 性质差异：**LSP 有语义**（找实现、类型层级、真诊断），**tree-sitter 只有语法**（符号/import/调用边/文本）。我们的"找实现/类型"只能拿**引用图 + 字面量启发式**补，且自己标注"非类型求解器"。
   注：本仓 `architecture-refactor-plan.md:1667` 记的"Serena 花了 ~1,700 行 Windows 进程管理"——**未在源码里定位到"Windows 专属"的 1,700 行**；我实测到的 1,696 行是 **`ls_process.py`+`ls_utils.py` 的通用进程/子进程管理**（非 Windows 专属）。此数**存疑，标二手**。

2. **编排形态：工具薄、业务在 facade（我们抄对了一半）。**
   Serena 的每个工具 `apply()` 几乎都是一行转发：`return self._api().find_symbol(...)`——业务实现在 **facade 层** `src/serena/repl/api/`（`lsp_api` `edit_api` `fs_api` `cfg_api` `jb_api` `mem_api` `shell_api` `ext_api` 共 8 个），由 `apply_ex()`（`tools_base.py:301`）统一做**横切关注**：日志、异常 → `ToolCallError`、LSP 崩溃自动重启重试、超时、结果长度限制、usage 记录。
   它还提供 **modes × contexts** 用 YAML 组合开关工具（`config/context_mode.py`）。
   ⇒ `architecture-refactor-plan.md` §15.6 说"**抄编排形态，不是语言服务**""**别把 N 个工作台换成 N 个工具**"——**源码支持这个判断**：Serena 53 个工具能薄，正因为业务沉在 8 个 facade 里；我们的工具是"业务在工具层"，这才是体量差的来源。**这条我们抄对了方向、但落地程度不足。**
   另：`ToolRegistry._deleted_tools`（`tools_base.py:478-485`）是一份**墓碑清单**（6 个旧工具名），改名/合并后老会话调用得到 warning 而非 unknown——**可直接借鉴的机制**（本仓 `architecture-refactor-plan.md:634` 的 F2 待办即此）。

3. **改名/重构：语义 vs 覆盖面。**
   它 `rename_symbol` 走 LSP，**跨库且能处理重载签名**（"语义准"）；我们 `rename_symbols` + `rename_files` + `move_symbol` + `suggest_renames` + `find_similar_names` **面更宽**（含 module/local 双 scope、文本/字面量/snake 变体、相似名消歧）。⇒ **不是谁全胜**：语义路径它准，工程化/文本路径我们宽。

### 3.2 我们完全缺失、值得警惕的能力类别

- **IDE 后端重构（`jet_brains_*`）**：move / inline / type hierarchy / debug / inspections——tree-sitter 方案天然给不了，**要么补 LSP，要么明确放弃**。
- **项目记忆的写侧**：它有一整族 memory 工具（6 个）；我们只有读侧 `read_project_docs` + 决策类，缺"给未来任务留知识"的通用写入口。
- **REPL facade**：它用一个 `serena_repl` 把 N 个工具收成"一段 Python"，与我们 §16.3 记的"缺工具链编排入口"是同一个问题的另一种解。

---

## 4. 值得抄的 / 不该抄的

**值得抄（机制层，不受 GPL 约束）**
1. **`apply_ex` 中央信封**：横切关注只写一次（我们的回执/成败判定正是 §16.1 的头号痛点——"靠解析自然语言文本判成败"，Serena 用 `ToolCallError` + 稳定返回把这件事收进信封）。
2. **`_deleted_tools` 墓碑清单**：改名不炸老会话（= 本仓 F2）。
3. **工具薄 + facade 唯一实现 + 多表面**：正是 §15.6 要抄的"编排形态"，能让"同一意图多份实现"结构上不可能发生。
4. **`replace_in_files` 的 `occurrence_id` + `expected_count` 守卫**：轻量、可复用的"批量替换安全网"，可作为我们 `plan_refactor` 的补充形态。
5. **modes × contexts（YAML 组合开关工具）**：按场景裁工具面，比运行时全量暴露更省 context。

**不该抄 / 抄不动**
1. **`src/serena/` 的代码（GPL-3.0-or-later）**：不可 copy 进本仓（传染）。要复用只能**读机制、重写**。
2. **"每种语言一个 LSP server"**：本仓内核是 tree-sitter，"内化语言服务"成本极高（每语言一个进程 + 生命周期 + 崩溃重试），与我们的架构路线相悖。
3. **把业务塞进工具层**：它反着来（业务在 facade），我们若照抄成"N 个业务工具"反而是重复代码。

---

## 5. 证据分级

**直接读过（可指出文件）**
- 工具枚举与命名：`src/serena/tools/{file,symbol,memory,config,workflow,cmd,query_project,repl,jetbrains}_tools.py`；注册条件与墓碑：`tools_base.py:489 / 478-485`；名字生成 `tools_base.py:161-168`。
- 中央信封：`tools_base.py:301-408`（`apply_ex`）。
- facade 层：`src/serena/repl/api/*.py`（8 个）+ `repl/facade.py`。
- modes/contexts：`src/serena/config/context_mode.py`。
- 许可证：`LICENSE`、`docs/01-about/060_license.md`。
- 多语言：`src/solidlsp/language_servers/`（76 个 .py）、`src/solidlsp/ls_config.py`（`Language` 75 成员）、`ls_process.py`(830) / `ls_utils.py`(866)。
- 我们侧：`src/application/*/index.ts`（56 工具名实测）、`README.md` 工具表、`src/infrastructure/parse/languages.ts`（55 条语言登记）、`docs/architecture-refactor-plan.md` §15.6 / §16 / 第 634、1667 行。

**二手**
- "一页学习文档/用户对照需求"来自 team-lead 转述。
- §15.6 的"53 vs 67"、第 1667 行的"~1,700 行 Windows 进程管理"来自本仓既有文档，非我实测。

**推断（标"未验证"）**
- 我们"无 fs 层"是**设计取舍而非遗漏**——依据是 README 把项目定位为"数据/协议层 MCP server"，但**未找到明文声明**。
- 它对标工具"更强/更弱"的结论基于**工具签名与 docstring**，**未跑任何真实调用对比**。

**我明确没核实的 + 怎么核实**
1. **~1,700 行 Windows 进程管理**：未定位到 Windows 专属文件。核实法：`grep -rn "CREATE_NEW_PROCESS_GROUP\|win32" src/solidlsp/` 逐文件看平台分支，或看 Serena 的 CHANGELOG/提交历史里 Windows 相关改动规模。
2. **JetBrains 后端工具的实际可用性**：13 个全 `optional`，未验是否需要独立插件/IDE 才能用。核实法：读 `src/serena/jetbrains/` + `docs/` 中 JetBrains 章节。
3. **我们的工具与 Serena 逐一对跑的等价性**：均为静态对照。核实法：各挑 3 组（如 rename / find_references / replace_in_files）在同一 fixture 上各跑一次，比命中与回执。
4. **Serena 是否有"我们完全缺失"的更多类别**：本次按模块清点，未逐一读每个工具的实现细节。核实法：读 `src/serena/repl/api/*` 全部方法，那才是它的**真实能力面**（工具只是薄壳）。
