# AOCI / aoci-code 学习笔记

> 对象：GitHub `aoci-spec/aoci-code`（AOCI-CODE，当前 RC = `v0.1.0-rc17`）。
> 取证方式：**clone 真源码读到一手材料**（commit `fdb4cb9`，落盘 `D:/project_develop/_research/aoci-code/`）+ 两个二手页面。
> 每条论断都标了证据级别（直接读过 / 二手 / 推断），见 §7、§8。
> 用途：回答"它到底怎么做的 / 我们能学什么 / 不该抄什么 / 我们哪里已经更好"。
> 本文只读它们，**未改动 design-canvas 仓库任何文件**（除本笔记）。

---

## 0. 先给结论（TL;DR）

- AOCI-CODE 是一套**"给 LLM 读的、纯文本的、随代码演进的仓库认知索引"**：一个 `aoci.txt` 系列纯文本文件 + 一个 `aoci` 命令行/MCP 程序。它把"理解一个仓库需要知道什么"压成**每个文件一行**，写得极省 token，让 Agent 动手前先"读地图"。
- 它和我们的**目标高度重叠**（都是"把代码变成 Agent 能用的结构/认知"），但**落点不同层**：它的索引是**描述性认知压缩**（不可执行、不生成语义、无几何层、不改代码）；我们的 DSL 是**可执行结构 + 人审意图**（几何 + 语义 + 契约，驱动 scaffold/edit_code/consistency_check）。
- 最值得学的一条是它的**"条目独立"设计性质**——每个条目只依赖自己那个文件，于是改 k 个文件只重算 k 条；我们目前改一个文件会牵动"引用方重开 + 跨文件解析"这套更重的机制（见 `docs/index-locality-design.md`）。
- 许可证不是"NOASSERTION"：**真实文件是 FSL-1.1-MIT**（Fair Source，非 OSI 开源，带"竞争性使用"限制，2 年后转 MIT）。**机制/思路可学，源码不可搬**——详见 §6。

---

## 1. 一句话：AOCI 是什么

**AOCI（AI-Oriented Cognition Infrastructure / AI 面向的认知基础设施）** 是"夹在 AI Agent 和软件系统中间的一层"。用大白话说：

> 大模型负责推理、Agent 负责动手，**AOCI 负责在 Agent 动手之前，把整个仓库"此刻长什么样"整理成一份它能一遍读完、且与代码同步的说明书**。

**AOCI-CODE** 是这套方法的产品实现：一个叫 `aoci` 的**单文件可执行程序**（Go 写的），它维护一组**纯文本索引文件**（能进 Git、能 diff、能回滚），并通过 **stdio MCP** 把这份索引喂给 Codex / Claude Code / Cursor / OpenCode 这类宿主 Agent。

---

## 2. 两处必须先更正的事

### 2.1 许可证：不是 NOASSERTION，是 FSL-1.1-MIT

- **一手证据**：`_research/aoci-code/LICENSE` 第 1 行 = `# Functional Source License, Version 1.1, MIT Future License`，缩写 `FSL-1.1-MIT`，`Copyright 2026 Liu JinShi`；`NOTICE` 明写 `License: ... License identifier: FSL-1.1-MIT`。
- GitHub 把它显示成 `NOASSERTION`（未识别）只是因为它的 SPDX 分类器不认 FSL 这个 id，**不代表没有许可证**。
- 关键条款（`LICENSE` 原文）：
  - `Permitted Purpose` = 除 `Competing Use` 外的任何用途；**非商业教育、非商业研究、内部使用、给被许可方提供专业服务**都明确允许。
  - `Competing Use` = 把本软件放进一个**商业产品或服务**对外提供，且该产品或服务 (1) 替代本软件；或 (2) 替代官方用本软件提供的其它产品/服务；或 (3) 提供**与本软件相同或实质相似的功能**。
  - 有 **2 年后自动转为 MIT** 的承诺（`Grant of Future License`）。
- 结论：**读它、学它的机制（思想本身不受版权保护）没问题**；但**把它的代码搬进我们的商业产品、或做成"竞争性"的同类工具，在 2 年内不允许**。详见 §6。

### 2.2 增量复杂度：论文评述页写的是 O(1)，正确说法应是 O(k)

- **二手页（themoonlight 评述）原文写法**：「当 k 个文件修改时，只有 k 个条目重新生成，时间复杂度为 O(1)，与代码库总大小无关」。
- 这句话**表述不严谨**：正确应是 **O(k)**（重算数 = 改动文件数，与仓库总规模无关）。它想表达的是"**不随仓库大小增长**"，这个性质是对的。
- **一手依据（证明这个性质成立）**：`spec/public/aoci-index-format-v1.txt` 第 140-142 行规定"一个被管对象 = 一行"，条目 `object_name[tag]: F..|R..|A..|S..` 只描述自己；`spec/public/aoci-object-fras-v2.txt` 第 42-49 行规定 R 只是"精确身份引用"、不是完整依赖图。**条目本身不缓存别人的东西 ⇒ 改一个文件天然只需重算这一条。**

---

## 3. 机制解剖

### 3.1 索引长什么样（直接抄真样例，标出处）

一次 `aoci init` 会生成一组文件，它们的分工（一手：`README.md` 第 390-406 行）：

| 文件 | 角色 |
|---|---|
| `aoci.txt` | **Root**：只声明"当前有哪些卷参与、谁是入口"。**唯一发现入口**。 |
| `aoci.meta.txt` | **Meta**：标签字典 + FRAS 规则 + 配额 + 写作契约。 |
| `aoci.code.txt` | **Code**：每个代码/仓库资产的条目。 |
| `aoci.database.txt` | **Database**：可选的表级条目，默认不存在。 |

**真实样例 1 —— Root**（一手：仓库根 `aoci.txt`，全文）：

```text
#AOCI-ROOT-MANIFEST: 1
#Format-Version: cognition-volumes/v1
#Locale: en-US
#Project: public-candidate
#Global-Invariants: -
#Volume: id=meta kind=meta path=aoci.meta.txt format=meta-v1 depends=- state=enabled
#Volume: id=code kind=code path=aoci.code.txt format=object-fras-v2 depends=meta state=enabled
```

**真实样例 2 —— Meta 的标签字典**（一手：仓库根 `aoci.meta.txt`，节选）：

```text
#AOCI-META-VOLUME: 1
#Object-Protocol: repository-cognition-object/v2
#FRAS-Discipline: 2
#FRAS-v2-Limits-Authority: machine-contract
#S-Admission: non-inferable-and-error-preventing
#S quota: C9-8≤600 C7-4≤200 C3-1≤50
#Object-Kinds: code=file database=table
#Canonical-Tag-Authoring: compact A+B+C+[D]+E; dotted form is read compatibility only
#Code canonical identity example: code:path/to/file.go
#Code Entry example: file.go[CG7T]: F:Runs the example application | R:- | A:- | S:-
#[Tag dictionary: code]
#A Layer: C-Code
#B Module: G-General
#C Importance: 9-core 8-high-frequency 7-business 5-routine 3-supporting 1-edge
#E Scale: L-large>400 M-medium200-400 S-small100-200 T-tiny<100
```

**真实样例 3 —— 条目（给模型看的"一行一个文件"）**（一手：仓库根 `aoci.code.txt` 第 4-20 行，节选）：

```text
.gitattributes[CG3T]: F:Normalizes repository text line endings for deterministic hashes and cross-platform collaboration | R:- | A:- | S:autocrlf rewrites would mark the whole tree stale
AGENTS.md[CG8S]: F:Defines repository integration plus AOCI cognition establishment, reuse, maintenance, task-closing, verification, and index-admission rules for agents | R:code:docs/contract-authority.md,code:docs/zh-cn-contract-authority.md,code:scripts/blackbox/README.md,code:Makefile | A:- | S:Live Guide, tool schema, Spec, and Validator remain authoritative over this integration block; ...; make verify is the one-shot closure command and never replaces the per-change table
go.mod[CG8T]: F:Declares the canonical Go module, exact Go version, and pinned runtime graph, including the official openGauss Connector identity and reviewed local replacement | R:code:third_party/openGauss-connector-go-pq/go.mod,code:third_party/openGauss-connector-go-pq.PROVENANCE.md,code:THIRD-PARTY-NOTICES | A:Go module dependency graph | S:The exact local replace keeps builds off unpatched upstream; ...
```

> 注意：这个仓库是**它自己吃自己**——根目录的 `aoci.txt / aoci.meta.txt / aoci.code.txt` 就是 AOCI-CODE 给自己的仓库建的索引（一手可读）。这对我们是件好事：**它给出了"真实项目跑完长什么样"的第一手样本**，而不是只有宣传。

**条目格式规范**（一手：`spec/public/aoci-index-format-v1.txt` 第 137-149 行）：

```
object_name[tag]: F:... | R:... | A:... | S:...
```

`F`=核心职责、`R`=强关系、`A`=对外接口/契约、`S`=非显然的维护约束。

### 3.2 标签层（方括号里那截）每一维的真实含义

标签的规范形态是 **compact `A+B+C+[D]+E`**（一手：`aoci-object-fras-v2.txt` 第 9-11 行）。用 starter 字典读 `[CG9L]` = `C`(SharedFoundation 层) + `G`(CrossDomain 模块) + `9`(最高重要度) + `L`(大文件)——没有 D。

| 维 | 含义 | starter 取值（一手：`README.md` 第 516-519 行） |
|---|---|---|
| **A** | 架构层 | C-SharedFoundation / E-EntryBoundary / A-ApplicationOrchestration / D-DomainLogic / K-AlgorithmComputation / M-Middleware / P-Persistence / … / Z-Other |
| **B** | 功能模块（业务域） | G-CrossDomain / U-UserInteraction / B-CoreBusiness / I-IdentityAccess / … / Z-Other |
| **C** | 重要度 | starter 是 **1–9 九级**（`9-highest … 1-lowest`） |
| **D** | 可选的技术特性 | starter **默认不给 D 字典**；只有当前 Meta 声明了才可用 |
| **E** | 代码规模（按行数） | L>400 / M 200-400 / S 100-200 / T<100 |

★ 两个必须讲清的细节：

1. **"C 是六级非均匀 9,8,7,5,3,1"这个说法，来自它自己仓库的 Meta，不是通用规范**。
   - 一手：本项目自己的 `aoci.meta.txt` 用的是 `9-core 8-high-frequency 7-business 5-routine 3-supporting 1-edge`（六级，跳 6/4/2）。
   - 一手：而 README 里贴的 **starter 模板**（`textassets/en-US/templates/volume-meta.txt.tmpl`）用的是 **1–9 九级均匀**。
   - 一手：`aoci-object-fras-v2.txt` 第 24-25 行明说"字典按仓库自定，旧仓库的 Meta 永远对它的仓库权威"。
   - ⇒ 结论：**标签字典是每仓自定的**。六级那套是"它自己给自己定的"，不是协议常量。
2. **S 的配额按 C 档分**：`C9-8≤600 / C7-4≤200 / C3-1≤50`（字符/码点上限，越重要能写越长）。

### 3.3 语义层 F / R / A / S 各自是什么

一手依据集中在 `spec/public/aoci-object-fras-v2.txt` §2 与 `spec/public/s-field-discipline.txt`：

- **F（Function）**：一句话核心职责。"不是清单"，通常是**一个命题**，不写"实现 X 并提供 Y"这种模板句。
- **R（Relations）**：**"理解或安全修改这个对象时必须一并看"的强关系**，用精确身份写（`code:<仓库相对路径>` / `database://<源>/<库>/<表>`），无则写 `-`。**明确不是完整依赖图**；工具性依赖（日志/框架自带）不列。
- **A（API）**：对外暴露的、可被依赖的**稳定契约**（接口 / 命令 / 格式）。**不是**罗列全部方法、字段、调用方。无则 `-`。
- **S（约束）**：**高熵的、非显然的系统约束**。这是它整篇文档着墨最多的地方。准入要过**双重自问**：
  1. 前四层（文件名+标签+F+R+A）**真的推不出**吗？
  2. 不写这句，**模型会不会做错事**？
  两问都"是"才写。等价口诀：「**不写这句，模型会做错事吗？**」

> ★ 一个必须指出的**版本漂移**：二手论文评述页把 S 叫 **"synopsis（摘要）：把高熵实现细节压成密集关键词"**；而**当前源码规范**把 S 定义为 **"non-inferable constraints（不可推断的约束）"**。
> 两者不完全一样：论文那版强调"压缩细节"，产品这版强调"**只写会导致改错的坑**"，且明确**禁止**把 S 写成摘要/规格复述。
> ⇒ 看二手页时要小心：**S 的语义已经演进**，以当前 `aoci.meta.txt` / `s-field-discipline.txt` 为准。

### 3.4 为什么"条目独立"能让增量更新是 O(k)

- **一手（格式即证据）**：格式规定"一个对象 = 一行"，每行的 F/R/A/S 只讲它自己；`R` 里写的是**别的对象的身份**（引用），**不是把别人的内容拷进来**。
- **一手（写作纪律）**：`s-field-discipline.txt` 第 23-26 行明确：**禁止用 AST、符号提取、import 扫描、正则、模板等机器手段生成/预填语义**，语义必须由模型读源码后写。这条的副作用正是：**没有"全局派生缓存"**，因此没有"牵一发动全身"的重算。
- ⇒ 改文件 A ⇒ 只需重写 A 那一条；**不需要**重新计算任何跨文件聚合结果。
- **二手（论文评述）**称这是 O(k)/O(1)；**我的判断**：性质成立（O(k)），因为它**用"运行时读索引时由模型/Transformer 自己重建依赖"**替代了"离线预计算一张全局静态图"。
- **★ 与我们最不同的一点（一手佐证在 AOCI 侧 README）**：AOCI **明确不做预计算静态依赖图**——
  `README.md` 第 823、925 行：`not a knowledge-graph system`、`does not generate semantic relationships automatically from imports, SQL, filenames, or similarity`、`Impact traverses only explicit model-authored R relationships`。
  ⇒ 它的"关系"靠**模型手写的 R 线索** + **读的时候现推**；我们的 `impact_analysis` 靠**预建好的 `edges(import/call/type_ref)` 图**（`cache.db`）。**这是两种根本不同的取舍**（见 §4）。

### 3.5 三段工作流 + 九个 MCP 工具

**三段工作流**（一手：`README.md` 第 113-117 行；`docs/getting-started.md`）：

1. **建立认知（Build under governance）**：模型读源码 → 给每个 `index` 角色的对象写 FRAS → AOCI 负责"治理"（源绑定、校验、CAS、原子写、Baseline、回滚）。命令线：`aoci init` → `aoci scan` → 宿主 Agent 走 live Guide → `aoci_maintain`（无参）发整批 → `aoci_update_entry` 提交整批 → `aoci verify` → `aoci check`。
2. **交付认知（Read before acting）**：Agent 先读项目规则 + 当前 Whole-Index（Root+Meta+各卷），再去看真实源码。
3. **维护认知（Maintain after verified change）**：代码/测试稳定后，宿主经 MCP 更新受影响条目，回到 `aligned`。

**九个 MCP 工具**（一手：`spec/public/aoci-mcp-runtime-v1.txt` 第 18-26 行；README 第 871 行"exactly nine tools"）：

- 读：`aoci_rules`、`aoci_overview`、`aoci_get_entries`、`aoci_search`
- 写/维护：`aoci_maintain`、`aoci_update_entry`、`aoci_remove_entry`
- 证据/支撑：`aoci_header`、`aoci_report`

**派生观察（不是新事实源）**（一手：`README.md` 第 790-823 行）：`cognition system lineage / relations / impact / snapshot / evolution`——全部 `derived=true`，关系投影还额外标 `authoritative=false`，**"与权威资产冲突时，权威资产赢"**。

---

## 4. ★★ 与我们（agent-io）逐项对照

### 4.1 对照总表

> 我们侧的证据出处见括号内文件；AOCI 侧出处见上一节。

| 能力 | AOCI（aoci-code） | 我们（agent-io） | 谁更好 / 为什么 |
|---|---|---|---|
| **从代码建立结构** | `code-to-index`：**模型读源码手写** FRAS；**禁止** AST/正则生成语义（`s-field-discipline.txt`） | `import_project`：**机器自动扫**代码 → 生成几何节点/边 + `SemanticFile`（含 `expected_apis`/`symbols`/`lines`/`layer`）；底层用 tree-sitter（`src/infrastructure/graph/import_project.ts`） | **口径不同**。我们要的是"确定性地建出可执行结构"，它要的是"模型写出人类/LLM 认知"。**自动 vs 手写**各有代价：我们省人力但语义靠后续 LLM 补；它语义质量高但每仓都得模型逐文件写 |
| **单文件的"一行认知"** | `object_name[tag]: F|R|A|S`（纯文本一行，token 极省） | `SemanticFile { responsibility, expected_apis, expected_deps, expected_behavior, status, layer, contract, lifecycle }`（`src/domain/semantic.ts:63`） | **我们的字段更多、可执行**（expected_apis 直接喂 `consistency_check`）；**它的单行更省 token、更适合塞进 LLM 上下文**。我们若想省 token，可考虑导出"一行摘要视图" |
| **对外契约** | `A` 字段（自然语言列举，**不可判定**） | `expected_apis: ExpectedApi[]`（`name/signature/line/end_line`）+ `BrickContract`（role/shapes/effects，来自 `src/domain/contract.ts`） | **我们更硬**：expected_apis 能被 `consistency_check` 逐签名对账；它的 A 只是给模型看的文字，**没有机器判据** |
| **影响面 / 依赖** | `R` 手写强关系 + `cognition system impact` **只沿 R 遍历**；**不做预计算静态图**（README 823/925） | `impact_analysis` 基于**预建的 `edges(import/call/type_ref)`** 算 direct/indirect 文件与符号（`src/application/meta/impact/impact_report.ts`、`.../analysis/impact/diff_impact.ts`） | **我们更精确、可自动化**（能算 N 跳波及、符号级）；**它更便宜**（改一个文件不牵动全局）。它的 impact 会漏掉"模型没在 R 里写、但代码里真实存在"的依赖——**它有这个自认的边界** |
| **漂移 / 一致性** | `align / verify / check`：判 `Missing / Orphan / Stale / Unbaselined / 行尾变化 / curation 差异`——**索引相对源码的"陈旧"** | `consistency_check`（expected_apis vs 实际 AST：缺失/不匹配/新增）+ `detect_drift`（`design_stale` / `missing_impl` / `clean`） | **语义方向不同、我们更"双向"**：我们把"设计先立契约(缺实现)"和"代码先跑(设计过时)"**分开判**；它主要判"描述过没过时"。**它的优势是"漂移即事实、带 Baseline 指纹"**，治理更严 |
| **唯一真相源** | **认知资产是纯文本**（可 git diff/回滚）；机器治理状态在 `.aoci/*.json`（`baseline.json` 实测 446KB、`config.json`），通常 gitignore | **多代表**：`cache.db`（SQLite，**代码事实的唯一权威**）+ DSL 镜像（json，意图）+ `expected_apis`（契约）。AGENTS.md 第 74 行："ts_kernel 是符号/import/调用边/类型引用的唯一权威来源" | **各有取舍**。它：**认知可读可 diff、但治理状态是二进制 JSON**。我们：**事实权威单点 + 意图单点，但事实库是二进制、不能 git diff**。**我们已经在做"事实的出处留在 DSL、事实本身走唯一入口"这条纪律**（见 `semantic.ts:79-84` 的注释），方向上和它"不让索引变成第二真相源"是一致的 |
| **"契约形状"议题（T18）** | 行格式规范（`aoci-index-format-v1.txt`）：**对外可互操作的文本边界** | T18 = `[B]`（工具函数）之间**统一的中间产物形态**，`Touched` 锚点（`docs/tool-chain-contract.md`） | **不是同一件事**。它的行格式是"**人和 LLM 读的索引**"的序列化；我们的 T18 是"**工具链内部数据流**"的接口。可借鉴的只是"**给跨切面数据定一个语义唯一、类型钉死的锚点**"这条思路（我们 T18 已经得出这个结论） |
| **增量更新** | 条目独立 ⇒ **O(k)**；R 靠读时重建 | 四档增量（mtime/size → content_hash → 单文件重解析 → 跨文件引用只查符号表）；但为保正确性要"**重开引用方**"，实测范围 = 改动文件 + 引用方（`docs/index-locality-design.md` §8） | **它更省**（天生 O(k)），**我们更准**（能保证引用不漏）。我们的重是**买正确性**：旧口径实测漏 100 条引用（§8.4），新口径多花 91ms 把它补回来 |
| **动作能力** | **不改代码**。只维护认知；改代码交给宿主 Agent | `edit_code`（符号级编辑）/ `rename_*`（跨文件重命名）/ `refactor_pipeline`（改前 diff 审批 + 失败回滚），Rename 安全边界靠 `find_references` | **我们多一层**：它明确"只做认知、不做改造"；我们的 DSL 是**可驱动改造**的。这是我们的**结构性优势**（认知→动作闭环），但也意味着**更大的失败面**（改错代码 vs 写错描述） |
| **运行时验证** | **无**（不跑代码；`observe` 概念它不做） | `observe_instrument`/`observe_judge`/`reconcile_*`：用真实运行探针对账契约与行为基线，**验证通过才提交、失败回滚** | **我们独有**。它把"验证"完全交给宿主和测试；我们把运行时观测接进了契约闭环。**这是我们做得更好、且它没有的地方** |
| **可执行结构** | 无（明确 `not an AST replacement`） | 几何层（nodes/edges/位置）+ `scaffold` 从 DSL 生成代码骨架 + `render_design` 导出 mindmap/svg/markdown | **我们独有**。它的索引是"读的地图"，我们的 DSL 是"读的地图 + 能照着施工的图纸" |
| **可视化 / 人审** | AOCI panel（`aoci ui`），但主要是索引浏览 | 独立前端 dsl-workbench（沙盘/版本对比/问题清单/探针/契约/代码审批）；人机共享同一份 DSL JSON | **我们更偏"人机协作画布"**，它更偏"给 Agent 读的文本层 + 一个面板" |
| **宿主前提** | 必须是 MCP 宿主（Codex/Claude Code/Cursor/OpenCode）；它自己**不是 Agent** | 我们是标准 MCP server（也可 CLI/HTTP）；不绑定特定宿主 | 双方都不绑定模型、都走 MCP。**它更明确地"寄生"在宿主 Agent 之下** |
| **许可证** | **FSL-1.1-MIT**（Fair Source，非 OSI，带竞争限制，2 年转 MIT） | **MIT**（本仓 `LICENSE`，最宽松） | **我们更开放**。也因此**我们不能搬它的代码**，只能学机制（§6） |
| **成熟度** | 单 Go 二进制；黑盒套件 46+64+（生命周期的 3 个 fixture）；有论文+工业评测 | Node/TS；自身逻辑复杂（42 个 `[B]`、多代表、cache.db）；有大量"阵亡记录/实测数据" | **它更"薄而稳"（治理讲得很细）**；**我们更"厚而广"（能力面更宽）**。它把"写一条索引"这件事做到了工程化极致；我们把"从认知到改造到验证"做成了链 |

### 4.2 ★ 关键判断：它的"索引"和我们的"DSL"是同一层吗？

**答：不是同一层，但有一块重叠。** 依据如下（先说人话，再给依据）：

**人话**

- 它的索引 = **给 LLM 读的"认知压缩"**：目标是"让模型一遍读完就懂仓库"，**不执行、不生成代码、不做机器语义推导**。它是**描述**（description）。
- 我们的 DSL = **可执行的结构 + 人审的意图**：几何层可渲染、`scaffold` 能照着生成代码、`expected_apis` 能被 `consistency_check` 逐签名对账、`edit_code` 能照着改。它是**规格 + 可执行物**（specification + executable artifact）。
- 更准确地说，我们的东西**分了三份**：`cache.db`（代码事实权威，机器算）· DSL 语义层（设计意图 + 契约，人/LLM 写）· `expected_apis`（可判定的契约）。而它**只有一份**：纯文本索引（+ 治理用的 JSON 状态）。

**依据**

1. **能力边界的一手文字**：
   - 它自陈 `not an AST replacement`、`not a CodeGraph replacement`、`AOCI-CODE helps them reuse repository-level understanding and govern candidate cognition before it becomes formal`（`docs/getting-started.md` 第 13-17 行）。
   - 它自陈**只治理候选认知的落盘**，`does not assemble FRAS from filenames, paths, extensions, ASTs, or templates`（README 第 368 行）。
   - 它自陈**关系不做预计算图**、`Impact traverses only explicit model-authored R relationships`（README 第 851 行）。
2. **我们侧的一手文字**：
   - `cache.db` 是**代码事实的唯一权威**（AGENTS.md 第 74 行；`semantic.ts:79-84` 明确"要事实请走唯一入口 `file_facts`"）。
   - DSL 的几何层是"长什么样"、语义层是"为什么这么做"，且 `scaffold` 能**从 DSL 生成代码骨架**、`edit_code` 能**按符号改代码**（README 能力表）。
3. **重叠的那一块**：它的 `F`（职责）和 `A`（对外契约）**约等于**我们 `SemanticFile.responsibility` + `expected_apis`——都是"这个文件是干什么的、对外承诺什么"。**但它们对这块的用法不同**：它写成**给人/LLM 读的一行文字**，我们写成**能被机器对账的结构**。

⇒ **一句话判断**：**它的索引 ≈ 我们 DSL 语义层里"职责 + 契约"的"只读文本投影"**；但它**没有**我们的几何层、没有 `cache.db` 这个代码事实权威、没有可执行生成/改造/运行时验证。**所以不能互换，只能互补：它给 Agent 一张省 token 的地图；我们给"地图 + 施工图 + 质检线"。**

---

## 5. 我们可以学的（按"便宜 → 贵"排序）

> 每条给：学什么 / 为什么值得 / 大致代价。

### 5.1 【最便宜｜半天级】把"一行认知视图"做成导出格式

- **学什么**：它那条 `object_name[tag]: F | R | A | S` 的单行格式，token 极省、可直接塞进上下文。
- **为什么值得**：我们 `SemanticFile` 字段多、是 JSON，**塞给 LLM 前要做投影**。加一个 `render_design(format=index-lines)` 之类的**只读导出**，就能在"上下文紧张"时给 Agent 一份压缩视图（也方便人 grep/diff）。
- **代价**：低。只是把已有 DSL 语义层**渲染成文本**，**不引入新真相源**（渲染产物可随时重生成，正好符合我们"派生输出可删可重算"的纪律）。
- **风险**：必须明确"这是**派生视图**，权威仍是 DSL/cache.db"，避免变成第二份可写副本。

### 5.2 【便宜｜1-2 天级】给"认知条目"补一份纯文本可 diff 的镜像

- **学什么**：它的**认知资产是纯文本、能 git diff/回滚**；我们的 `cache.db` 是二进制、DSL 是 json。
- **为什么值得**：`cache.db` 二进制**无法 code review**——改了什么看在眼里是一团黑。若把"文件级结构化事实"（path/layer/关键符号/行范围）稳定导出一份**排序确定的纯文本**进 Git，就能获得：**diff 可审、回滚可读、跨机器可比**。
- **代价**：中低。要保证**排序确定 + 稳定序列化**（否则 diff 噪音大）。
- **注意**：这**不是**要取代 `cache.db`（仍是唯一事实权威），而是给它加一份"**只读、可再生的文本投影**"。⚠️ 必须写清"镜像的权威在 cache.db"，否则就是我们最忌的**判据分叉**。

### 5.3 【中｜数天级】学"条目独立 ⇒ O(k)"这个设计性质

- **学什么**：它靠"条目只依赖自己那个文件"换来天生 O(k)。我们的增量虽已分四档，但**为保正确性要"重开引用方 + 跨文件解析"**，范围 = 改动文件 ∪ 引用方（`docs/index-locality-design.md` §8）。
- **为什么值得**：`index-locality` 文档实测：**旧口径漏 100 条引用**才换来"更快"。这正是"独立 vs 正确"的张力。可以问一句：**我们的哪些派生数据是"能独立重算"的、哪些是"必须追引用方"的？**把前者做成"独立条目"（O(k)），只把后者留成"要追引用方"的少数。
- **代价**：中。需要重新审视 `edges`/`unresolved_refs`/`symbol_diffs` 的依赖结构，区分"自包含派生"与"跨文件派生"。
- **★ 但别照抄它的结论**：它敢 O(k)，是因为它**放弃预计算静态图、把重建推给读时**；我们**不能放弃精确图**（`impact_analysis`/`find_references` 靠它）。**我们只能学"独立条目"这一半，不能学"不做静态图"那一半。**

### 5.4 【中｜数天级】`index-first` 模式 —— 我们有没有对应物？

- **学什么**：论文提的两种模式——`code-to-index`（读已有代码→出索引）与 **`index-first`（先说需求→先出完整系统索引当架构蓝图→再写代码）**。
- **★ 我们其实已经有对应物**：
  - `scaffold`：从 DSL 语义层**生成代码骨架**（设计在前、代码在后）。
  - `design_intent` / `expected_deps` / `expected_behavior`（`src/domain/semantic.ts:73-76`）：**先写意图、后实现**，`status: draft/in_progress/done` 就是"设计先立"的状态机。
  - `detect_drift` 的 `missing_impl` 分支：**"设计先立了契约、实现还没跟上"**——这正是 index-first 阶段。
- **为什么值得**：它的 index-first 是"**用索引当蓝图**"；我们的 index-first 是"**用 DSL 当蓝图、并能真的生成代码**"。**我们已经比它多走了"生成"这一步**。值得做的是**把这条路径显式化**（文档/工具入口），而不是新增机制。
- **代价**：低到中（多为"把已有能力串成一条显式工作流"）。

### 5.5 【较贵｜需判断级】S 元素（高熵设计决策）才是信息价值大头 —— 对 T18 的启示

- **学什么**：
  - **二手（论文评述）**：消融实验里**移除 S 元素，性能下降最显著（Overall −20.07%）**；移除 R 主要伤 What 任务；标签层 ABCDE 在 QA 上**没有统一增益**，但在端到端开发里承担"导航/优先级/增量路由"。
  - **一手（产品规范）**：`s-field-discipline.txt` 用整篇规定 S 的准入（双重自问）、内容清单、字数配额、以及"**错误的 S 比缺失的 S 更有害**——因为模型会信任它并跳过取证"。
- **为什么值得（对 T18 的启示）**：我们的 T18 正在给 `[B]` 定"契约形状"（`Touched`）。它的实证结论提示一条**取舍原则**：
  - **"可机器推导的字段"信息价值低**（文件名/标签/import 这类，别塞进契约）；
  - **"高熵、非显然、违反就出错"的内容才是价值大头**（对应我们 `BrickContract.effects` 里的"不可逆 effect"/"必须成对的两处常量"/跨文件隐性契约）。
  - ⇒ **T18 的锚点字段应倾向"下游真能拿来做判断"的高熵信息，少放"能自动算出来"的结构字段。** 这和 T18 现有的"只收被数据证明真通用 or 语义唯一的新名"原则**方向一致**，可以互相印证。
- **代价**：不是新增代码，而是**在 T18 字段取舍时用这条实证做依据**。

### 5.6 【值得抄的"软"东西】治理纪律（不是代码）

- **Delivery attestation**（chunk/cursor/receipt/challenge 证明"整份索引被完整交付"）、**Baseline 指纹**、**CAS + 原子写 + 可回滚的整批提交**、**`all-green ≠ 语义正确`**的自我声明（README 第 384 行）。这些是**写作/治理纪律**，可以照搬到我们的文档规范里（思想层面）。

---

## 6. 不该抄的 / 抄不了的

### 6.1 许可证约束（★ 分列：可借鉴的机制 vs 不可搬运的代码）

**支撑文件（一手）**：`_research/aoci-code/LICENSE`（= FSL-1.1-MIT）、`NOTICE`、`PATENTS`、`TRADEMARKS`、`THIRD-PARTY-NOTICES`。

| | 内容 | 依据 |
|---|---|---|
| ✅ **可借鉴的机制** | 纯文本索引格式的**思想**、条目独立/O(k) 的**设计性质**、FRAS 四要素的**信息分工**、S 的双重自问**纪律**、三段工作流、Whole-Index 分卷、Baseline/漂移/整批提交的**治理思路**。**思想与算法本身不受版权保护**；且 FSL 明确允许"非商业教育/研究"用途。 | `LICENSE`：`Permitted Purposes specifically include ... 2. for non-commercial education; 3. for non-commercial research` |
| ❌ **不可搬运的代码** | 它的 **Go 源码**（`internal/**`、`cmd/**`）、它的**命令/工具命名**在**商业竞争性产品**里的复用、它的**品牌/商标**。**在 2 年 FSL 窗口内**，把它的代码放进"与本软件相同或实质相似功能"的商业产品/服务 = `Competing Use`，**不允许**。 | `LICENSE`：`Competing Use means making the Software available to others in a commercial product or service that ... 3. offers the same or substantially similar functionality` |
| ❌ **不可用它的商标** | `TRADEMARKS` 明写：除"标识来源"外无商标使用权。 | `TRADEMARKS`（一手） |
| ⏳ **2 年后** | `Grant of Future License`：每个版本**首发 2 周年后**可改用 MIT。 | `LICENSE` 第 87-97 行 |
| ⚠️ ** redistribute 义务** | 若真要分发它的任何拷贝/修改/衍生，必须附带许可证条款、保留版权声明。 | `LICENSE`：`Redistribution` 段 |

⇒ **对我们的操作结论**：**读它、学它的机制、在文档里讨论它——没问题；把它的 Go 代码拷进 design-canvas——不行**（我们是 MIT 商业向项目，它带竞争限制；且两边语言/架构完全不同，本来也没有可搬运的代码）。**我们只学它的"设计性质与纪律"，不碰它的源码。**

### 6.2 它的前提（我们不一定满足）

- **必须有一个 MCP 宿主 Agent**（Codex / Claude Code / Cursor / OpenCode）来**读源码、写 FRAS**。它自己**不产生语义**。README 第 134-137 行："integrates with the MCP host, not with a model-provider API"。
  ⇒ 这个前提我们**部分满足**（我们也是 MCP server），但我们还多了"自动扫描建结构"的能力，不完全依赖宿主。

### 6.3 它明确**不做**什么（一手自陈，抄"不做"也要抄对）

`docs/getting-started.md` 第 13-17 行 + `README.md`：

- **不是 AI Agent**；**不是 RAG 替代**；**不是 AST 替代**；**不是 CodeGraph 替代**；**不是向量库**；**不是守护进程（daemon）**；**不是云服务**。
- **不做预计算静态依赖图**；**不从 import/SQL/文件名/相似度自动生成语义关系**；**不替代精确 call graph**。
- **输出 `derived=true / authoritative=false`**，与权威资产冲突时**权威资产赢**。

⇒ 我们**不要**在这些地方跟它"对齐"（比如**不要**为了 O(k) 而放弃我们的精确图与运行时验证）。

---

## 7. 证据分级

**图例**：✅直接读过（能指出文件/行）· 📄二手（写明页面）· ❓推断（未验证）

| # | 论断 | 级别 | 出处 / 依据 |
|---|---|---|---|
| 1 | 许可证是 FSL-1.1-MIT（非 NOASSERTION、非 OSI 开源、2 年转 MIT） | ✅ | `LICENSE` 第 1/11/87-97 行；`NOTICE` |
| 2 | 认知资产是纯文本、治理状态在 `.aoci/*.json` | ✅ | 根 `aoci.txt`/`aoci.meta.txt`/`aoci.code.txt` 实读；`.aoci/` 下有 `baseline.json`(446KB)/`config.json` |
| 3 | 条目格式 `object_name[tag]: F|R|A|S` | ✅ | `spec/public/aoci-index-format-v1.txt` 第 140-142 行 |
| 4 | 标签 compact `A+B+C+[D]+E`；starter 字典取值 | ✅ | `aoci-object-fras-v2.txt` 第 9-11 行；`README.md` 第 512-525 行 |
| 5 | **C 在它自己仓库是六级 9,8,7,5,3,1；starter 模板是 1-9 九级** | ✅ | 根 `aoci.meta.txt` 第 14/19 行 vs `README.md` 第 518 行 |
| 6 | S = 不可推断的约束（非摘要），双重自问 | ✅ | `s-field-discipline.txt` 第 51-63 行；`aoci-object-fras-v2.txt` 第 55-66 行 |
| 7 | **论文评述把 S 叫 "synopsis"，与当前产品定义不同** | ✅（差异本身直接可核） | 📄 themoonlight 评述 vs ✅ `aoci.meta.txt`/`s-field-discipline.txt` |
| 8 | 条目独立 ⇒ 增量 O(k) | ✅（性质）/ 📄（复杂度表述） | 一手：格式"一对象一行"；📄：themoonlight 评述（其写 O(1)，我判断应为 O(k)） |
| 9 | **不做预计算静态依赖图、不从 import 自动生成关系** | ✅ | `README.md` 第 823/925/851 行 |
| 10 | 三段工作流 | ✅ | `README.md` 第 113-117 行 |
| 11 | 九个 MCP 工具的确切名称 | ✅ | `spec/public/aoci-mcp-runtime-v1.txt` 第 18-26 行 |
| 12 | "不是 Agent / RAG / AST / CodeGraph / 向量库 / daemon / 云服务" | ✅ | `docs/getting-started.md` 第 13-17 行 |
| 13 | S 元素消融 −20.07%、Where 97.67%、token 20.25%、工业 19 任务 0 缺陷 vs 39 缺陷 | 📄 | themoonlight 论文评述页（**未读 arXiv 原文**） |
| 14 | 索引每文件一行、token 50-200 | 📄 | themoonlight 评述 / imtaqin 介绍页 |
| 15 | 我们的 `import_project` 扫码→DSL | ✅ | `src/infrastructure/graph/import_project.ts` |
| 16 | 我们的 `SemanticFile` 字段 | ✅ | `src/domain/semantic.ts` 第 63-95 行 |
| 17 | `cache.db` 是代码事实唯一权威 | ✅ | `AGENTS.md` 第 74 行；`semantic.ts` 第 79-84 行 |
| 18 | `consistency_check` 对账 expected_apis vs 实际 AST | ✅ | `src/application/design/intent/consistency.ts` 头部注释 |
| 19 | `detect_drift` 判 design_stale / missing_impl | ✅ | `src/application/design/intent/detect_drift.ts` 头部 + `DriftStatus` |
| 20 | `impact_analysis` 基于预建 edges | ✅ | `src/application/meta/impact/impact_report.ts`；`.../analysis/impact/diff_impact.ts` |
| 21 | 我们的增量四档 + "重开引用方" | ✅ | `docs/index-locality-design.md` §8（含实测 294 vs 51 文件、漏 100 条） |
| 22 | T18 = `[B]` 契约形状 / `Touched` 锚点 | ✅ | `docs/tool-chain-contract.md`；`docs/todo.md` 第 141 行 |
| 23 | 我们的 LICENSE = MIT | ✅ | 本仓 `LICENSE` |

---

## 8. 我明确**没核实**的东西 + 怎么核实

1. **论文原文（arXiv）没读**。§7 里第 13-14 行的所有数字（97.67% / 20.25% / 39 缺陷 / −20.07%）**全部只来自 themoonlight 的评述页（二手）**。
   - 核实法：找到并读 arXiv 原文（评述页指向 `arxiv.org/pdf/2605.02421`），**特别核对**：评测口径、Oracle 定义、消融的对照条件、工业任务的样本量与裁决流程。**在读到原文前，这些数字不能在内部材料里当事实引用。**
2. **"运行时由 Transformer 自注意力从 R 线索重建全局依赖"**——这句是 📄 二手（themoonlight）的表述。
   - 一手能佐证的只有"AOCI **不做预计算静态图**、关系只来自模型手写的 R"（✅ README）。**"用 Transformer 自注意力重建"是论文的实现细节，我没在源码里找到对应说明**（源码是 Go 治理内核，不含模型推理）。
   - 核实法：读论文的方法章节；或看它的 `spec/public/aoci-system-cognition-runtime-v1.txt` 是否描述读时重建语义。
3. **`aoci-spec` 组织下是否还有别的仓库（如纯规范仓 `aoci-spec/aoci`）及其许可证**——我只 clone 了 `aoci-code`。
   - 核实法：访问 GitHub org `aoci-spec` 列仓库，逐个看 `LICENSE`。**如果存在另一份许可证，§6.1 的结论要按最严的那份复核。**
4. **`aoci` 自举索引里那句 `===/home/alkor2000/...===` 的历史绝对路径**——规范说这是"历史坐标、不是运行时路径"（`aoci-index-format-v1.txt` 第 26-54 行），但我**没有实测**"clone 到别的路径后它能否正确重定位"。
   - 核实法：把 `_research/aoci-code` 复制到另一路径，按 CLI 契约跑一个读命令，看是否要求重写索引（这也是它的公开契约之一）。
5. **它的工业评测"0 缺陷 / 39 缺陷"是评述页转述**，我没有独立的裁决证据链。
   - 核实法：读论文的工业基准章节；查是否公开了任务集与裁决记录。
6. **黑盒套件数量在 README 与 imtaqin 页不一致**（README 说 46 + 64 + 3 fixture + 48 升级轴；imtaqin 页说 46 + 38）——说明**二手页面会滞后于源码**。
   - 核实法：以 clone 的 `scripts/blackbox/README.md` 为准（我**未逐个点数**）。
7. **`.aoci/baseline.json` 内部结构**（446KB）我只看了存在与大小，没解析其字段含义。
   - 核实法：读 `src/.../baseline*` 或 spec。

---

## 9. 一句话收束

> AOCI-CODE 把"**给 LLM 读的仓库认知**"做成了**纯文本、条目独立、可 git 版本化**的工程样板——**最值得学的是"条目独立 ⇒ O(k)"这条设计性质，和"S 才是信息价值大头"这个实证取舍**。
> 但它**停在"描述 + 治理"**：不做图、不做生成、不改代码、不做运行时验证。
> 而 agent-io 的 DSL 是"**描述 + 可执行结构 + 改造 + 运行时验证**"的闭环——**我们的层比它高一层，不该向它看齐，只该在"认知压缩与增量"这两点上向它借镜。**
