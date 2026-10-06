# 原子工具与「工具面」：先例检索（2026-10-06）

> **触发**：用户提出「先别继续编排，**先把原工具做得更好**」并指定「参考之前说的那两个参考项目 + 自己找新的」。
> **方法**：按 `oss-prior-art-first` 技能 —— ①本地 → ②GitHub → ③论文；先定位**共享层**；证据分级见 §7。
> **结论一句话**：先例**支持**我们的方向（结构化交接 / 链 / 渐进披露），但也给出**一条与我们正面冲突的设计主张**（§4）；
> 而"把工具做得更好"这件事，**当下最大的一格不是单个工具的实现，是「披露量」**（§3 有量化）。

---

## 1. 两个本地参考（一手：`D:/project_develop/_research/` 已 clone）

| | **Serena**（`oraios/serena`） | **AOCI / aoci-code**（`aoci-spec/aoci-code`） |
|---|---|---|
| 是什么 | 基于 MCP 的**编码工具箱**，53 个工具（`Tool` 子类带 `apply()`），**每种语言起一个 LSP server** 取语义 | **给 LLM 读的纯文本仓库认知索引**：一个 `aoci.txt` 系列 + 一个 Go 写的 `aoci` 程序，每文件一行 |
| 共享层 | ★ **同层同构**（MCP 给 LLM 读/改代码）⇒ **可直接比优劣** | ⚠ **看起来像、其实不同层**：它是**描述性认知压缩**（不可执行、不生成语义、不改代码）⇒ 只能 **compose**，不能互换 |
| 许可证 | 本体 **GPL-3.0-or-later**（`src/serena/`）· 内置 `src/solidlsp/` **MIT** | **FSL-1.1-MIT**（Fair Source，带"竞争性使用"限制，2 年后转 MIT） |
| 可搬代码？ | ❌ `src/serena/` 不可搬（GPL 传染）；`solidlsp` 是 MIT 但本仓不用 LSP | ❌ 不可搬（FSL 限制竞争性使用） |
| **可借鉴的机制** | ① **`initial_instructions` / `onboarding` / `serena_info(topic)`** —— 它**专门有"取使用手册"的工具**（正解「任务语言不对齐」）<br>② **可选工具标注**（默认不暴露）—— **"不暴露全部"的现成先例**<br>③ **`serena_repl`**：绕过逐个 MCP 工具，直接调全部能力 —— **raw face 的现成先例**<br>④ `replace_in_files`：dry-run + occurrence 选择 + `expected_count` 计数守卫 | ★ **条目独立**：每个条目只描述自己那个文件 ⇒ **改 k 个文件只重算 k 条（O(k)）**，不随仓库规模增长，<br>而本仓现在改一个文件会牵动"引用方重开 + 跨文件解析"（见 `docs/index-locality-design.md`） |

★ 反向证据（技能 §3.6）：**我今天修的两类缺陷，它们会不会有？**
- 「判据从散文派生」（我的 `meaning.includes('已退役')`）—— Serena/AOCI 的笔记里未见同类；**我不能断定它们没有**（未核实，见 §7）。
- 「门登记了却永不设退出码」—— 如果它们把"判据"交给上游/生态，这类洞**结构上更少**；但**未核实**。

---

## 2. 新查到的先例（②③，带 URL 与"我读到的是哪一层"）

| # | 来源 | 我读到的是哪一层 |
|---|---|---|
| 1 | `bex.co/blog/.../mcp-progressive-discovery-100-tool-servers` | 博客（转述多个 benchmark 的数） |
| 2 | `agentmarketcap.ai/blog/.../mcp-production-roadmap-2026-...` | 博客（含 MCP 2026 roadmap / SEP-1576） |
| 3 | `toolrouter.com/blog/too-many-mcp-tools` | 博客（**逐条转述 Anthropic 官方文档与实测**） |
| 4 | `ai-pm.cc/.../progressive-tool-disclosure.html` | 知识库页（转述 Klavis **Strata** 基准） |
| 5 | `www.dainemawer.com/mcp-context-window-bloat` | 博客（含 Cloudflare **Code Mode** 自述） |
| 6 | `www.agentensemble.net/blog/tool-pipelines` | **框架文档**（ToolPipeline 的 API 与语义） |
| 7 | `www.alphaxiv.org/overview/2606.13663v1`（**HyperTool**，北航） | **论文摘要 + AI overview**（未读全文） |
| 8 | `callsphere.ai/blog/sequential-agent-chaining-...` | 博客（OpenAI Agents SDK 的 `output_type` 结构化交接） |
| 9 | `prakashkagitha.github.io/llm-stack-book/...` | 教科书页（ReAct / ToolLLM / Gorilla / BFCL 索引） |

---

## 3. ★★ 量化事实（这些是我们**没有**的读数）

| 事实 | 数 | 级别 |
|---|---|---|
| 工具选择准确率随工具数**崩塌** | **43% → <14%**（RAG-MCP） | ⚠️ **二手**（博客转述） |
| 4 工具 vs 46 工具 | **~95% vs ~71%**（Nebula）—— 24 点差**纯粹来自上下文膨胀** | ⚠️ 二手 |
| Anthropic 官方阈值 | **30–50 个可见工具**之后"显著退化" | ⚠️ 二手（我**未读** Anthropic 原文） |
| 58 工具的开销 | **~55,000 tokens**（GitHub 35 工具 ≈26k） | ⚠️ 二手 |
| Anthropic **Tool Search Tool** | 前面只留一个搜索助手（~500 tok）+ 按需加载 3–5 个（~3K）⇒ **~8.7K**（**-85%**）；MCP-eval：Opus 4 **49%→74%**、Opus 4.5 **79.5%→88.1%** | ⚠️ 二手 |
| ★★ **链一长就崩** | **TaskBench (NeurIPS 2024)：1 工具 96% → 8 工具链 25%** | ⚠️ 二手（论文名可核） |
| 渐进披露（Strata 模式） | **+15%** 准确率；Intent → Categories → Actions → Details → Execute | ⚠️ 二手 |
| **Code Mode / 代码执行** | Anthropic Drive→Salesforce：**150K → ~2K tokens（-98.7%）**；Cloudflare 2,500 端点 **-99.9%**；某基准 **58%→92.8%** | ⚠️ 二手 |
| Claude Code 的 Skills 分组 | 系统提示里**只放 skill 摘要**，判定相关才读全文 | ⚠️ 二手 |

★ 注意：**我们 61 个工具、59/61 全量广播** ⇒ 按上面的阈值，我们**在上限之外**。
★ 但我**没有**我们的实测读数（"选错工具的回合数"从未量过）⇒ 上面那些数**只能当方向，不能当我们的结论**。

---

## 4. ★★★ 一条与我们**正面冲突**的设计主张

| | 先例（HyperTool / ToolPipeline / Code Mode） | 本仓现行设计 |
|---|---|---|
| 主张 | **确定性链不该对模型可见** —— 把子步骤折叠进**一次外层调用 / 一段代码**，中间值**局部传递**，模型只做高层判断。原话：*"the LLM must act as the glue between tools for **deterministic** operations that could be handled more efficiently by code"* | 每一步**都是**模型可见的一调用，靠 `touched` 交接、靠「下一棒提示」提醒 |
| 读数 | HyperTool：MCP-Universe **15.69% → 35.29%**（Qwen3-32B） | 我们**没有**读数 |
| 机制 | ToolPipeline 的 **adapter = 普通代码，不是 LLM 调用** | 目前"适配"由调用方（LLM）手工做 |

★★ **调和点（我认为这是本次检索最值钱的一句）**：
本仓的 `chainExprOf` **已经**把边分成两类 ——
- `cardinality: 'single'` ⇒ `touched.<键>`（**集合确定只有一个 ⇒ 取即确定 ⇒ 无需判断**）
- `cardinality: 'pick'` ⇒ `touched.<键>[i]`（**可能需要选 ⇒ 语义判断 ⇒ 必须留给调用方**）

⇒ **`single` 的那些段正是"可以折叠"的**（确定性、无判断）；**`pick` 的必须保持可见**。
这与先例的主张**并不矛盾** —— 先例说的是"**确定性**的部分不该占模型的决策"，而 `pick` **不是确定性的**。
⇒ 结论：**折叠的边界 = `cardinality`**，而这条边界**我们已经有数据**（不是新发明的判据）。

---

## 5. 对两个待办的判读（哪格该抄 / 哪格该自造）

| 待办 | 这一层有人做完了吗 | 动作 |
|---|---|---|
| **「面」= 管控披露量** | ★ **有**（Progressive Disclosure 已有成体系做法：Tool Search / Skills 分组 / Strata 分层 / 可选工具标注 —— Serena 有现成先例） | **借协议**：分级披露 + 一个"搜索工具"的逃生口；**不必自造** |
| **每条工具描述/产物形态** | 有**原则**（schema 要好："名字反映任务边界 / 描述带例子与边界 / 用 enum / **返回高信噪比输出，别 dump 原始数据**"） | **借用原则**，逐条自查 |
| ★ **「管道/链」的确定性折叠** | **有**（HyperTool / ToolPipeline / Code Mode / 结构化交接 `output_type`） | **借用机制**；**判据用我们自己的 `cardinality`** |
| ★ **"选一个"由调用方给** | ❌ **没见到等价物**（先例一律折叠掉） | ★ **这一格可能真是我们的格子** —— 但也可能只是"我们还没折叠"（见 §6 最小验证） |
| **索引的增量复杂度 O(k)** | AOCI 有（条目独立） | **借协议**（条目独立）；本仓走"引用方重开"更重 ⇒ 值得单开一条 |

★ 技能 §2 的判据对照：**L1–L3（题库/隔离/循环）我们一个问题都不在这些里**；
我们真正在自造的是 **L4（本项目特有的旋钮：`cardinality`、`touched` 键表）+ L5（真实踩过的坑）** —— **这个定位是对的**。

---

## 6. 最小验证动作（半天内、零/低成本）—— 按优先级

1. ★★ **「未列出的工具还能不能调」冒烟测试**（`MCP listTools` 裁掉一个 → 看 `callTool` 是否仍成功）。
   **这是"面"这条路的前提**：不通 ⇒ 多视图当场作废（我已经欠它两轮了）。
2. ★ **量一次我们自己的"选错工具"读数**：同一个任务分别走「全量 61」与「导航 + 6 direct」，
   比**选对所需回合数** ⇒ 把 §3 那些二手数字换成**我们的**一手数字。
3. **折叠可行性**：挑一条 `single` 段（如 `find_references.file → rename_symbols.renames[].file`）问：
   能不能把它做成"一次调用"而中间不做判断？—— 若能 ⇒ 先例的主张对我们成立。
4. **AOCI 的 O(k)**：核一下本仓"改一个文件"实际重算了多少（引用方重开的规模）。

---

## 7. 证据分级与**未核实清单**（不许把二手写成事实）

| 论断 | 级别 | 怎么核 |
|---|---|---|
| Serena 53 工具 / 许可证按目录分 / 有 `initial_instructions` / `serena_repl` | ✅ **一手**（本地笔记记的是 clone 真源码 + 行号） | `_research/serena` 可直接读 |
| AOCI 条目独立 ⇒ O(k)；FSL-1.1-MIT | ✅ **一手**（同上） | `_research/aoci-code` 的 `spec/public/*.txt` |
| §3 里**每一格数字** | ⚠️ **二手**（博客/知识库转述） | ★ **我未读** RAG-MCP / Nebula / TaskBench / Anthropic 官方原文中的任何一篇 |
| Anthropic "30–50 工具"阈值 | ⚠️ **二手** | 读 Anthropic 官方 tool-use 文档原文 |
| HyperTool 的 15.69%→35.29% | ⚠️ **二手**（我读的是 **alphaxiv 摘要 + AI overview**，**未读全文**） | 读 arXiv `2606.13663` 全文；注意它是 **MCP-Universe 上的特定模型** |
| 「Serena / AOCI 也可能有"散文判据/永不设退出码"这两类洞」 | ❌ **推断，未验证** | Grep 它们的判据脚本；看有没有"从不返回非零"的检查 |
| 「折叠边界 = `cardinality`」 | ❌ **我的判断**（由本仓数据 + 先例主张推出） | §6 第 3 条实验 |

★ 特别声明：**本仓自己一次读数都没有**（没量过"选错工具的回合数"、没量过 61 个工具的 token 开销）。
⇒ 本文件的作用是**给方向**，**不能**当作"我们已经证明披露过多有害"的依据。
